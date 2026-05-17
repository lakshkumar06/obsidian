import { ledger } from '@obsidian/managed-contract';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

import { hexToBytes32 } from './obsidianBytes';
import type { LedgerOrderStatus, OrderRow } from './types';

export type LedgerPollResult = {
  status: LedgerOrderStatus;
  indexerError: string | null;
};

export async function pollOrderLedgerStatus(
  providers: MidnightProviders,
  contractAddress: ContractAddress,
  order: OrderRow,
): Promise<LedgerPollResult> {
  if (!order.commitmentHex) {
    return {
      status: { ...emptyLedgerStatus(), pollError: 'No commitment hex on row' },
      indexerError: null,
    };
  }

  try {
    const commitment = hexToBytes32(order.commitmentHex);
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    if (!state) {
      return {
        status: {
          ...emptyLedgerStatus(),
          pollError: 'Indexer returned no contract state',
        },
        indexerError: 'No contract state',
      };
    }

    const view = ledger(state.data);
    const commitmentActive = view.order_commitments.member(commitment);
    const inMatchLog =
      order.side === 'BUY' ? view.match_log.member(commitment) : false;
    let auditPresent = false;
    let auditCiphertext: string | undefined;
    if (order.side === 'BUY') {
      try {
        const ciphertext = view.audit_ciphertexts.lookup(commitment);
        auditPresent = true;
        auditCiphertext = ciphertext;
      } catch {
        auditPresent = false;
      }
    }

    return {
      status: {
        commitmentActive,
        inMatchLog,
        auditPresent,
        auditCiphertext,
        polledAt: new Date().toISOString(),
        pollError: null,
      },
      indexerError: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: { ...emptyLedgerStatus(), pollError: msg },
      indexerError: msg,
    };
  }
}

function emptyLedgerStatus(): LedgerOrderStatus {
  return {
    commitmentActive: null,
    inMatchLog: false,
    auditPresent: false,
    polledAt: undefined,
    pollError: null,
  };
}

function buyerPeerForSell(sell: OrderRow, buyers: OrderRow[]): OrderRow | undefined {
  if (sell.counterpartyOrderId) {
    const byId = buyers.find((b) => b.id === sell.counterpartyOrderId);
    if (byId) {
      return byId;
    }
  }
  const hinted = sell.ledgerStatus?.pairedBuyerCommitmentHex;
  if (hinted) {
    const byHex = buyers.find((b) => b.commitmentHex === hinted);
    if (byHex) {
      return byHex;
    }
  }
  return undefined;
}

/** Link SELL rows to their matched BUY peer only (never any random settled buyer on same asset). */
export function enrichOrderLedgerStatuses(orders: OrderRow[]): OrderRow[] {
  const buyers = orders.filter((o) => o.side === 'BUY' && o.ledgerStatus);

  return orders.map((order) => {
    if (order.side !== 'SELL' || !order.ledgerStatus || !order.assetIdHex) {
      return order;
    }

    const peerBuyer = buyerPeerForSell(order, buyers.filter((b) => b.assetIdHex === order.assetIdHex));
    if (!peerBuyer?.ledgerStatus) {
      return {
        ...order,
        ledgerStatus: {
          ...order.ledgerStatus,
          pairedSettled: false,
          pairedMatchPending: false,
          pairedBuyerCommitmentHex: undefined,
          pairedAuditCiphertext: undefined,
        },
      };
    }

    if (peerBuyer.ledgerStatus.auditPresent) {
      return {
        ...order,
        ledgerStatus: {
          ...order.ledgerStatus,
          pairedSettled: true,
          pairedBuyerCommitmentHex: peerBuyer.commitmentHex,
          pairedAuditCiphertext: peerBuyer.ledgerStatus.auditCiphertext,
        },
      };
    }

    if (peerBuyer.ledgerStatus.inMatchLog && order.ledgerStatus.commitmentActive) {
      return {
        ...order,
        ledgerStatus: {
          ...order.ledgerStatus,
          pairedMatchPending: true,
          pairedBuyerCommitmentHex: peerBuyer.commitmentHex,
        },
      };
    }

    return order;
  });
}

export function formatLifecyclePhase(order: OrderRow): string {
  if (order.queueStatus === 'matching') {
    return 'auto-matching (propose_match)…';
  }
  if (order.queueStatus === 'settling') {
    return 'auto-settling (atomic_settle)…';
  }
  if (order.matchError) {
    const short =
      order.matchError.length > 56 ? `${order.matchError.slice(0, 56)}…` : order.matchError;
    return `match error: ${short}`;
  }
  const ls = order.ledgerStatus;
  if (!ls) {
    return order.queueStatus === 'queued' ? 'queued (awaiting cross)' : order.status || 'submitted';
  }
  if (ls.pollError) {
    return `indexer: ${ls.pollError}`;
  }
  if (ls.auditPresent || ls.pairedSettled) {
    return 'settled (audit on-chain)';
  }
  if (ls.inMatchLog || ls.pairedMatchPending) {
    return 'matched (awaiting settle)';
  }
  if (ls.commitmentActive === true) {
    return order.queueStatus === 'queued'
      ? 'queued on-chain (awaiting cross)'
      : 'on-chain (active commitment)';
  }
  if (ls.commitmentActive === false && !ls.auditPresent && order.side === 'BUY') {
    return 'cleared (no audit on this commitment — may be a different pair)';
  }
  if (ls.commitmentActive === false) {
    return 'cleared from order_commitments';
  }
  return order.status || 'unknown';
}
