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
import { enrichOrderLedgerStatuses, pollOrderLedgerStatus } from '../ledgerStatus';
import { reconcileQueueStatus } from '../orderMatcher';
import { registerOrderWithRelayer } from '../registerRelayerIntent';
import { assetIdFromSymbol, parseLimitPriceToUint64 } from '../obsidianBytes';
import { isSuccessTerminal, watchTxnActivity, type TxnFlowTerminal } from '../txnActivity';
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

const POST_SUBMIT_RELAYER_GRACE_MS = 120_000;

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
  const [asset, setAsset] = useState('');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [ticketOrderId, setTicketOrderId] = useState<string | null>(null);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnStatusLabel, setTxnStatusLabel] = useState('Submitting order');
  const submitFlowBusyRef = useRef(false);
  const txnWatcherRef = useRef<ReturnType<typeof watchTxnActivity> | null>(null);

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
    asset.trim().length > 0 &&
    qty.trim().length > 0 &&
    price.trim().length > 0;

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
      setOrders(enrichOrderLedgerStatuses(merged));
    } catch {
      /* ignore poll errors */
    }
  }, [midnightProviders, trimmedAddr, setOrders]);

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

  async function waitForRelayerOutcome(
    orderId: string,
    contractAddress: ContractAddress,
    watcher: ReturnType<typeof watchTxnActivity>,
    relayerTerminal: { current: TxnFlowTerminal | null },
  ): Promise<'settled' | 'queued'> {
    watcher.pushLocal({ type: 'tx.finding_match', detail: 'Relayer matching pool' });

    const refreshSubmittedOrder = async (): Promise<OrderRow> => {
      const row = ordersRef.current.find((o) => o.id === orderId);
      if (!row || !midnightProviders) {
        throw new Error('Order not found');
      }
      const { status } = await pollOrderLedgerStatus(midnightProviders, contractAddress, row);
      const updated = reconcileQueueStatus({ ...row, ledgerStatus: status });
      const merged = enrichOrderLedgerStatuses(
        ordersRef.current.map((o) => (o.id === orderId ? updated : o)),
      );
      ordersRef.current = merged;
      setOrders(merged);
      return merged.find((o) => o.id === orderId) ?? updated;
    };

    const started = Date.now();
    while (Date.now() - started < POST_SUBMIT_RELAYER_GRACE_MS) {
      const fresh = await refreshSubmittedOrder();
      if (orderTicketStatus(fresh) === 'settled') {
        relayerTerminal.current = 'complete';
        break;
      }
      if (relayerTerminal.current && isSuccessTerminal(relayerTerminal.current)) {
        break;
      }
      if (relayerTerminal.current === 'failed') {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const finalRow = ordersRef.current.find((o) => o.id === orderId);
    if (finalRow && orderTicketStatus(finalRow) === 'settled') {
      watcher.pushLocal({ type: 'tx.complete' });
      return 'settled';
    }
    if (relayerTerminal.current === 'complete') {
      watcher.pushLocal({ type: 'tx.complete' });
      return 'settled';
    }
    watcher.pushLocal({ type: 'tx.queued' });
    return 'queued';
  }

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

    const assetSymbol = asset.trim();
    if (!assetSymbol) {
      setSubmitError('Asset symbol is required');
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
      const assetId = await assetIdFromSymbol(assetSymbol);
      const orderId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : btoa(Math.random().toString()).substring(0, 12);

      txnWatcherRef.current?.stop();
      const relayerTerminal = { current: null as TxnFlowTerminal | null };
      const watcher = watchTxnActivity(commitmentHex, setTxnStatusLabel, (t) => {
        relayerTerminal.current = t;
      });
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
        asset: assetSymbol,
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

      await waitForRelayerOutcome(orderId, contractAddress, watcher, relayerTerminal);

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
            <input
              className="swap-select"
              type="text"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              placeholder="Asset"
              aria-label="Asset symbol"
              required
            />
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
          onClick={
            !isConnected
              ? (e) => {
                  e.preventDefault();
                  onConnectClick();
                }
              : undefined
          }
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
