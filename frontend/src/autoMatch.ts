import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

import { executeAtomicSettle, executeProposeMatch } from './darkPoolCircuits';
import { formatMidnightError } from './formatMidnightError';
import { enrichOrderLedgerStatuses, pollOrderLedgerStatus } from './ledgerStatus';
import {
  explainQueueNoMatch,
  findCounterparty,
  findFirstCrossingPair,
  isMatchEligible,
  pairKey,
  type MatchedPair,
} from './orderMatcher';
import type { OrderRow } from './types';

const ATTEMPTED_PAIRS_LS = 'obsidian.ui.attemptedPairs.v1';

function loadAttemptedPairs(): Set<string> {
  try {
    const raw = window.localStorage.getItem(ATTEMPTED_PAIRS_LS);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function saveAttemptedPairs(set: Set<string>): void {
  try {
    window.localStorage.setItem(ATTEMPTED_PAIRS_LS, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function markQueued(order: OrderRow): OrderRow {
  if (order.queueStatus === 'matching' || order.queueStatus === 'settling') {
    return order;
  }
  if (!isMatchEligible(order)) {
    return { ...order, queueStatus: undefined };
  }
  return { ...order, queueStatus: 'queued', matchError: undefined };
}

function markPairStatus(
  pair: MatchedPair,
  queueStatus: OrderRow['queueStatus'],
  extra?: Partial<OrderRow>,
): (row: OrderRow) => OrderRow {
  const ids = new Set([pair.buyer.id, pair.seller.id]);
  return (row) =>
    ids.has(row.id)
      ? {
          ...row,
          queueStatus,
          counterpartyOrderId:
            row.id === pair.buyer.id ? pair.seller.id : pair.buyer.id,
          ...extra,
        }
      : row;
}

export type AutoMatchStep = 'settle-check' | 'find-pair' | 'propose_match' | 'atomic_settle' | 'poll';

export type AutoMatchResult = {
  orders: OrderRow[];
  matched: boolean;
  message: string;
  steps?: string[];
};

export type AutoMatchProgress = (step: AutoMatchStep, detail: string) => void;

export type AutoMatchCallbacks = {
  onProgress?: AutoMatchProgress;
  /** Called immediately before Lace balance/submit for match circuits. */
  onWalletApproval?: (circuit: 'propose_match' | 'atomic_settle') => void;
};

/**
 * After submit (or on poll), try propose_match → atomic_settle for crossing orders.
 * Unmatched orders stay `queueStatus: 'queued'`.
 */
export async function tryAutoMatchAndSettle(opts: {
  providers: MidnightProviders;
  contractAddress: ContractAddress;
  orders: OrderRow[];
  /** Prefer matching this order first (e.g. just submitted). */
  triggerOrderId?: string;
  onProgress?: AutoMatchProgress;
  onWalletApproval?: (circuit: 'propose_match' | 'atomic_settle') => void;
}): Promise<AutoMatchResult> {
  const log = (step: AutoMatchStep, detail: string) => opts.onProgress?.(step, detail);
  const attempted = loadAttemptedPairs();
  let working = opts.orders.map(markQueued);

  log('find-pair', `Scanning ${working.length} order(s) for a cross…`);

  const trigger = opts.triggerOrderId
    ? working.find((o) => o.id === opts.triggerOrderId)
    : undefined;

  let pair: MatchedPair | null = null;
  if (trigger) {
    pair = findCounterparty(trigger, working);
  }
  if (!pair) {
    pair = findFirstCrossingPair(working.filter(isMatchEligible));
  }

  if (!pair) {
    const queued = working.filter((o) => o.queueStatus === 'queued');
    const detail = explainQueueNoMatch(working);
    log('find-pair', `No pair: ${detail}`);
    return {
      orders: working,
      matched: false,
      message:
        queued.length > 0
          ? `${queued.length} queued — ${detail}`
          : 'No crossing orders in queue.',
    };
  }

  const key = pairKey(pair.buyer.commitmentHex!, pair.seller.commitmentHex!);
  if (attempted.has(key)) {
    attempted.delete(key);
  }

  log(
    'find-pair',
    `Pair found — BUY row ${pair.buyer.id} ${pair.buyer.commitmentHex!.slice(0, 10)}… max=${pair.buyerMax} ` +
      `↔ SELL row ${pair.seller.id} ${pair.seller.commitmentHex!.slice(0, 10)}… min=${pair.sellerMin}`,
  );

  working = working.map(markPairStatus(pair, 'matching'));
  attempted.add(key);
  saveAttemptedPairs(attempted);

  try {
    opts.onWalletApproval?.('propose_match');
    log('propose_match', 'Generating proof & balancing tx (Lace) — often 30s–3min…');
    await executeProposeMatch(opts.providers, opts.contractAddress, pair);
    log('propose_match', 'propose_match finalized on-chain.');
    working = working.map(markPairStatus(pair, 'settling'));
    opts.onWalletApproval?.('atomic_settle');
    log('atomic_settle', 'Generating settle proof & submitting…');
    await executeAtomicSettle(
      opts.providers,
      opts.contractAddress,
      pair.buyer.commitmentHex!,
      pair.seller.commitmentHex!,
    );
    log('atomic_settle', 'atomic_settle finalized.');
    working = working.map(
      markPairStatus(pair, undefined, {
        matchError: undefined,
        queueStatus: undefined,
      }),
    );

    log('poll', 'Refreshing indexer state for matched orders…');
    const polled = await Promise.all(
      working.map(async (order) => {
        const { status } = await pollOrderLedgerStatus(
          opts.providers,
          opts.contractAddress,
          order,
        );
        return { id: order.id, ledgerStatus: status };
      }),
    );
    working = enrichOrderLedgerStatuses(
      working.map((row) => {
        const hit = polled.find((p) => p.id === row.id);
        return hit ? { ...row, ledgerStatus: hit.ledgerStatus } : row;
      }),
    );
    log('poll', 'Indexer refresh done.');

    return {
      orders: working,
      matched: true,
      message: `Matched & settled ${pair.buyer.side} ${pair.buyer.qty} ${pair.buyer.asset} ↔ ${pair.seller.side} ${pair.seller.qty} ${pair.seller.asset}.`,
    };
  } catch (err) {
    const msg = formatMidnightError(err);
    log('propose_match', `Failed: ${msg.slice(0, 200)}`);
    attempted.delete(key);
    saveAttemptedPairs(attempted);
    working = working.map(
      markPairStatus(pair, 'queued', {
        matchError: msg,
      }),
    );
    return {
      orders: working,
      matched: false,
      message: `Auto match failed: ${msg}`,
    };
  }
}

/** BUY in match_log but not settled — run atomic_settle when seller peer exists. */
export async function tryAutoSettlePendingMatch(opts: {
  providers: MidnightProviders;
  contractAddress: ContractAddress;
  orders: OrderRow[];
  onProgress?: AutoMatchProgress;
}): Promise<AutoMatchResult> {
  const log = (step: AutoMatchStep, detail: string) => opts.onProgress?.(step, detail);
  let working = opts.orders;
  log('settle-check', 'Checking for BUY in match_log awaiting atomic_settle…');
  const buyer = working.find(
    (o) =>
      o.side === 'BUY' &&
      o.ledgerStatus?.inMatchLog &&
      !o.ledgerStatus?.auditPresent &&
      o.commitmentHex,
  );
  if (!buyer) {
    return { orders: working, matched: false, message: '' };
  }

  const seller = working.find(
    (o) =>
      o.side === 'SELL' &&
      o.assetIdHex === buyer.assetIdHex &&
      o.commitmentHex &&
      o.id !== buyer.id &&
      o.counterpartyOrderId === buyer.id,
  );
  if (!buyer.commitmentHex || !seller?.commitmentHex) {
    return { orders: working, matched: false, message: '' };
  }

  const buyerHex = buyer.commitmentHex;
  const sellerHex = seller.commitmentHex;

  const pair: MatchedPair = {
    buyer,
    seller,
    buyerMax: BigInt(buyer.boundPrice ?? '0'),
    sellerMin: BigInt(seller.boundPrice ?? '0'),
  };

  working = working.map(markPairStatus(pair, 'settling'));
  try {
    await executeAtomicSettle(opts.providers, opts.contractAddress, buyerHex, sellerHex);
    const polled = await Promise.all(
      working.map(async (order) => {
        const { status } = await pollOrderLedgerStatus(
          opts.providers,
          opts.contractAddress,
          order,
        );
        return { id: order.id, ledgerStatus: status };
      }),
    );
    working = enrichOrderLedgerStatuses(
      working.map((row) => {
        const hit = polled.find((p) => p.id === row.id);
        return hit ? { ...row, ledgerStatus: hit.ledgerStatus, queueStatus: undefined } : row;
      }),
    );
    return {
      orders: working,
      matched: true,
      message: 'Completed pending settlement for matched pair.',
    };
  } catch (err) {
    return {
      orders: working.map(markPairStatus(pair, 'queued', { matchError: formatMidnightError(err) })),
      matched: false,
      message: formatMidnightError(err),
    };
  }
}
