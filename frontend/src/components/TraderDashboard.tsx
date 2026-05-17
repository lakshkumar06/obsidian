import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';

import { CompiledObsidianContract } from '../compiledObsidian';
import {
  ensureObsidianCallPrivateState,
  OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
} from '../ensureObsidianCallPrivateState';
import { formatMidnightError } from '../formatMidnightError';
import {
  enrichOrderLedgerStatuses,
  pollOrderLedgerStatus,
} from '../ledgerStatus';
import { tryAutoMatchAndSettle, tryAutoSettlePendingMatch } from '../autoMatch';
import { findCounterparty } from '../orderMatcher';
import { explainQueueNoMatch, isQueuedInPool, reconcileQueueStatus } from '../orderMatcher';
import { registerOrderWithRelayer } from '../registerRelayerIntent';
import { assetIdFromSymbol, parseLimitPriceToUint64 } from '../obsidianBytes';
import { watchTxnActivity, type TxnActivityWatcher } from '../txnActivity';
import type { AutoMatchStep } from '../autoMatch';
import type { OrderRow, OrderSide } from '../types';
import { IconChevronDown } from './icons';
import { OrderTicket, orderPlacedTagline, orderTicketStatus } from './OrderTicket';
import { TxnLoadingScreen } from './TxnLoadingScreen';

type DashboardProps = {
  orders: OrderRow[];
  setOrders: Dispatch<SetStateAction<OrderRow[]>>;
  midnightProviders: MidnightProviders | null;
  contractAddressDraft: string;
  providersBusy: boolean;
  isConnected: boolean;
  onConnectClick: () => void;
  onOrderPlacedVisible?: (visible: boolean) => void;
  onTxnLoadingVisible?: (visible: boolean) => void;
};

const MATCH_STEP_ACTIVITY: Partial<Record<AutoMatchStep, string>> = {
  'settle-check': 'tx.settling',
  'find-pair': 'tx.finding_match',
  propose_match: 'tx.propose_match',
  atomic_settle: 'tx.settling',
  poll: 'tx.settling',
};

function randomBytes32(): Uint8Array {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return buf;
}

export function TraderDashboard({
  orders,
  setOrders,
  midnightProviders,
  contractAddressDraft,
  providersBusy,
  isConnected,
  onConnectClick,
  onOrderPlacedVisible,
  onTxnLoadingVisible,
}: DashboardProps) {
  const [asset, setAsset] = useState('wETH');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [ticketOrderId, setTicketOrderId] = useState<string | null>(null);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnStatusLabel, setTxnStatusLabel] = useState('Submitting order');
  const autoMatchBusyRef = useRef(false);
  const submitFlowBusyRef = useRef(false);
  const txnWatcherRef = useRef<TxnActivityWatcher | null>(null);
  const pollMatchCooldownRef = useRef(0);

  const POST_SUBMIT_MATCH_GRACE_MS = 90_000;
  const POST_SUBMIT_QUEUED_GRACE_MS = 12_000;

  const trimmedAddr = contractAddressDraft.trim();
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    onOrderPlacedVisible?.(ticketOrderId !== null);
  }, [ticketOrderId, onOrderPlacedVisible]);

  useEffect(() => {
    onTxnLoadingVisible?.(txnLoading);
  }, [txnLoading, onTxnLoadingVisible]);

  useEffect(() => {
    return () => {
      txnWatcherRef.current?.stop();
    };
  }, []);

  const canSubmit =
    isConnected &&
    Boolean(midnightProviders) &&
    !providersBusy &&
    !submitting &&
    !txnLoading &&
    trimmedAddr.length > 0 &&
    qty.trim().length > 0 &&
    price.trim().length > 0;

  const runAutoMatch = useCallback(
    async (
      triggerOrderId?: string,
      snapshot?: OrderRow[],
      activity?: TxnActivityWatcher | null,
    ): Promise<boolean> => {
      const base = snapshot ?? ordersRef.current;
      if (autoMatchBusyRef.current) {
        return false;
      }

      if (!midnightProviders || trimmedAddr.length === 0) {
        return false;
      }
      try {
        assertIsContractAddress(trimmedAddr);
      } catch {
        return false;
      }

      const contractAddress = trimmedAddr as ContractAddress;
      autoMatchBusyRef.current = true;
      activity?.pushLocal({ type: 'tx.finding_match' });

      let matched = false;
      try {
        const onProgress = (step: AutoMatchStep, detail: string) => {
          const type = MATCH_STEP_ACTIVITY[step] ?? 'tx.finding_match';
          activity?.pushLocal({ type, detail });
        };
        let settleResult = await tryAutoSettlePendingMatch({
          providers: midnightProviders,
          contractAddress,
          orders: base,
          onProgress,
        });
        let working = settleResult.orders;
        if (!settleResult.matched) {
          const matchResult = await tryAutoMatchAndSettle({
            providers: midnightProviders,
            contractAddress,
            orders: working,
            triggerOrderId,
            onProgress,
            onWalletApproval: (circuit) => {
              activity?.pushLocal({
                type: 'tx.wallet_confirm',
                detail:
                  circuit === 'propose_match'
                    ? 'Confirm match in wallet'
                    : 'Confirm settlement in wallet',
              });
            },
          });
          working = matchResult.orders;
          matched = matchResult.matched;
          if (!matchResult.matched && matchResult.message) {
            console.info('[Obsidian]', matchResult.message);
          }
        } else {
          matched = true;
        }
        if (matched) {
          activity?.pushLocal({ type: 'match.settle_ok' });
        }
        setOrders(enrichOrderLedgerStatuses(working));
        return matched;
      } catch (err) {
        console.error('[Obsidian] auto-match', err);
        activity?.pushLocal({
          type: 'tx.failed',
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      } finally {
        autoMatchBusyRef.current = false;
      }
    },
    [midnightProviders, trimmedAddr, setOrders],
  );

  const refreshLedgerStatuses = useCallback(async () => {
    const snapshot = ordersRef.current;
    if (!midnightProviders || trimmedAddr.length === 0 || snapshot.length === 0) {
      return;
    }
    try {
      assertIsContractAddress(trimmedAddr);
    } catch {
      return;
    }
    const contractAddress = trimmedAddr as ContractAddress;
    try {
      const updates = await Promise.all(
        snapshot.map(async (order) => {
          const { status } = await pollOrderLedgerStatus(midnightProviders, contractAddress, order);
          return { id: order.id, ledgerStatus: status };
        }),
      );
      const merged = snapshot.map((row) => {
        const hit = updates.find((u) => u.id === row.id);
        if (!hit) {
          return reconcileQueueStatus(row);
        }
        return reconcileQueueStatus({ ...row, ledgerStatus: hit.ledgerStatus });
      });
      const enriched = enrichOrderLedgerStatuses(merged);
      setOrders(enriched);

      const diagnosis = explainQueueNoMatch(enriched);
      const queuedCount = enriched.filter(isQueuedInPool).length;
      if (
        queuedCount >= 2 &&
        diagnosis.includes('Cross found') &&
        !autoMatchBusyRef.current &&
        Date.now() - pollMatchCooldownRef.current > 90_000
      ) {
        pollMatchCooldownRef.current = Date.now();
        void runAutoMatch(undefined, enriched);
      }
    } catch {
      /* ignore poll errors */
    }
  }, [midnightProviders, trimmedAddr, setOrders, runAutoMatch]);

  useEffect(() => {
    if (!midnightProviders || orders.length === 0 || trimmedAddr.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshLedgerStatuses();
    }, 12_000);
    void refreshLedgerStatuses();
    return () => window.clearInterval(timer);
  }, [midnightProviders, trimmedAddr, orders.length, refreshLedgerStatuses]);

  const prevOrderCountRef = useRef(0);
  useEffect(() => {
    if (!midnightProviders || trimmedAddr.length === 0) {
      prevOrderCountRef.current = orders.length;
      return;
    }
    if (txnLoading || submitFlowBusyRef.current) {
      prevOrderCountRef.current = orders.length;
      return;
    }
    if (orders.length > prevOrderCountRef.current) {
      const snap = ordersRef.current;
      if (snap.filter(isQueuedInPool).length >= 1 && !autoMatchBusyRef.current) {
        void runAutoMatch(undefined, snap);
      }
    }
    prevOrderCountRef.current = orders.length;
  }, [midnightProviders, trimmedAddr, orders.length, runAutoMatch, txnLoading]);

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!isConnected || !midnightProviders) {
      onConnectClick();
      return;
    }

    try {
      assertIsContractAddress(trimmedAddr);
    } catch {
      setSubmitError('Contract not configured');
      return;
    }

    try {
      parseLimitPriceToUint64(price);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      return;
    }

    setSubmitting(true);
    setTxnLoading(true);
    setTxnStatusLabel('Submitting order');
    setStatusHint(null);

    try {
      const contractAddress = trimmedAddr as ContractAddress;
      const boundPrice = parseLimitPriceToUint64(price);
      const commitment = randomBytes32();
      const nullifier = randomBytes32();
      const commitmentHex = toHex(commitment);
      const assetId = await assetIdFromSymbol(asset);
      const orderId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : btoa(Math.random().toString()).substring(0, 12);

      txnWatcherRef.current?.stop();
      const watcher = watchTxnActivity(commitmentHex, setTxnStatusLabel);
      txnWatcherRef.current = watcher;
      submitFlowBusyRef.current = true;
      watcher.pushLocal({ type: 'tx.submit_start' });
      watcher.pushLocal({ type: 'tx.wallet_confirm', detail: 'Confirm order in wallet' });

      await ensureObsidianCallPrivateState(midnightProviders!, contractAddress);

      const finalized = await submitCallTx(midnightProviders!, {
        compiledContract: CompiledObsidianContract,
        contractAddress,
        privateStateId: OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
        circuitId: 'submit_order',
        args: [commitment, nullifier],
      } as never);

      watcher.pushLocal({ type: 'tx.submit_ok' });

      const newOrder: OrderRow = {
        id: orderId,
        asset,
        qty,
        price,
        side,
        assetIdHex: toHex(assetId),
        boundPrice: boundPrice.toString(),
        status: String((finalized as { public?: { status?: string } }).public?.status ?? 'submitted'),
        commitmentHex,
        nullifierHex: toHex(nullifier),
        txId: (finalized as { public?: { txId?: string } }).public?.txId,
        createdAt: new Date().toISOString(),
        queueStatus: 'queued',
        ledgerStatus: {
          commitmentActive: true,
          inMatchLog: false,
          auditPresent: false,
          pollError: null,
        },
      };

      const { status } = await pollOrderLedgerStatus(midnightProviders!, contractAddress, newOrder);
      const withLedger = { ...newOrder, ledgerStatus: status };
      const nextOrders = enrichOrderLedgerStatuses([...ordersRef.current, withLedger]);
      setOrders(nextOrders);
      ordersRef.current = nextOrders;
      await registerOrderWithRelayer(withLedger);

      const tryRunMatch = async (): Promise<boolean> => {
        const snap = ordersRef.current;
        const self = snap.find((o) => o.id === orderId) ?? withLedger;
        if (!findCounterparty(self, snap)) {
          return false;
        }
        watcher.pushLocal({ type: 'tx.finding_match' });
        return runAutoMatch(orderId, snap, watcher);
      };

      const refreshSubmittedOrder = async (): Promise<OrderRow> => {
        const row = ordersRef.current.find((o) => o.id === orderId) ?? withLedger;
        const { status } = await pollOrderLedgerStatus(midnightProviders!, contractAddress, row);
        const updated = reconcileQueueStatus({ ...row, ledgerStatus: status });
        const merged = enrichOrderLedgerStatuses(
          ordersRef.current.map((o) => (o.id === orderId ? updated : o)),
        );
        ordersRef.current = merged;
        setOrders(merged);
        return merged.find((o) => o.id === orderId) ?? updated;
      };

      let outcome: 'settled' | 'queued' = 'queued';
      if (await tryRunMatch()) {
        outcome = 'settled';
      } else {
        const started = Date.now();
        let matchTouched = false;

        while (Date.now() - started < POST_SUBMIT_MATCH_GRACE_MS) {
          const fresh = await refreshSubmittedOrder();
          if (orderTicketStatus(fresh) === 'settled') {
            outcome = 'settled';
            break;
          }
          if (
            fresh.queueStatus === 'matching' ||
            fresh.queueStatus === 'settling' ||
            fresh.ledgerStatus?.inMatchLog
          ) {
            matchTouched = true;
          }

          if (!autoMatchBusyRef.current && (await tryRunMatch())) {
            outcome = 'settled';
            break;
          }

          const poolMayMatch = explainQueueNoMatch(ordersRef.current).includes('Cross found');
          if (
            !matchTouched &&
            !poolMayMatch &&
            Date.now() - started > POST_SUBMIT_QUEUED_GRACE_MS
          ) {
            outcome = 'queued';
            break;
          }

          await new Promise((r) => setTimeout(r, 500));
        }

        if (orderTicketStatus(ordersRef.current.find((o) => o.id === orderId) ?? withLedger) === 'settled') {
          outcome = 'settled';
        }
      }

      watcher.pushLocal({ type: outcome === 'settled' ? 'tx.complete' : 'tx.queued' });
      await new Promise((r) => setTimeout(r, 400));

      setQty('');
      setPrice('');
      setTicketOrderId(orderId);
    } catch (err) {
      txnWatcherRef.current?.pushLocal({
        type: 'tx.failed',
        error: err instanceof Error ? err.message : String(err),
      });
      setSubmitError(formatMidnightError(err));
    } finally {
      submitFlowBusyRef.current = false;
      txnWatcherRef.current?.stop();
      txnWatcherRef.current = null;
      setTxnLoading(false);
      setSubmitting(false);
    }
  }

  const ticketOrder = ticketOrderId ? orders.find((o) => o.id === ticketOrderId) : null;

  const primaryLabel = !isConnected
    ? 'Connect wallet'
    : providersBusy
      ? 'Loading…'
      : side === 'BUY'
        ? 'Place buy order'
        : 'Place sell order';

  if (txnLoading) {
    return <TxnLoadingScreen statusLabel={txnStatusLabel} />;
  }

  if (ticketOrder) {
    return (
      <div className="order-placed-screen" aria-live="polite">
        <div className="order-placed-layout">
          <div className="order-placed-copy">
           
            <h2 className="order-placed-title">Order placed</h2>
            <p className="order-placed-tagline">{orderPlacedTagline(ticketOrder)}</p>
            
            {statusHint ? <p className="order-placed-status">{statusHint}</p> : null}
          </div>
          <div className="order-placed-ticket-wrap">
            <OrderTicket
              order={ticketOrder}
              embedded
              onDismiss={() => setTicketOrderId(null)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <form className="swap-card" onSubmit={(ev) => void handleSubmitOrder(ev)}>
        <div className="side-toggle">
          <button
            type="button"
            className={side === 'BUY' ? 'active' : ''}
            onClick={() => setSide('BUY')}
          >
            Buy
          </button>
          <button
            type="button"
            className={side === 'SELL' ? 'active' : ''}
            onClick={() => setSide('SELL')}
          >
            Sell
          </button>
        </div>

        <div className="swap-section">
          <div className="swap-label">Amount</div>
          <div className="swap-input-row">
            <input
              className="swap-amount"
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              required
            />
            <select
              className="swap-select"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              aria-label="Asset"
            >
              <option value="wETH">wETH</option>
              <option value="wADA">wADA</option>
            </select>
          </div>
        </div>

        <div className="swap-divider">
          <span className="swap-divider-btn" aria-hidden>
            <IconChevronDown />
          </span>
        </div>

        <div className="swap-section">
          <div className="swap-label">Limit price</div>
          <div className="swap-input-row">
            <input
              className="swap-amount"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
              required
              style={{ fontSize: 28 }}
            />
          </div>
        </div>

        <button
          type="submit"
          className={`btn-primary ${canSubmit || !isConnected ? 'ready' : ''}`}
          disabled={isConnected && !canSubmit}
          onClick={!isConnected ? (e) => { e.preventDefault(); onConnectClick(); } : undefined}
        >
          {primaryLabel}
        </button>
      </form>

      <p className={`status-line ${submitError ? 'error' : ''}`}>
        {submitError ?? statusHint ?? ''}
      </p>
    </>
  );
}
