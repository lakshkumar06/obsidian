import { Fragment, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
  formatLifecyclePhase,
  pollOrderLedgerStatus,
} from '../ledgerStatus';
import { tryAutoMatchAndSettle, tryAutoSettlePendingMatch, type AutoMatchStep } from '../autoMatch';
import { findCounterparty } from '../orderMatcher';
import { explainQueueNoMatch, isQueuedInPool, reconcileQueueStatus } from '../orderMatcher';
import { LACE_SIGNING_EXPLAINER, laceApprovalMessage } from '../laceApprovalHint';
import { fetchRelayerActivity, registerOrderWithRelayer } from '../registerRelayerIntent';
import { setLaceWalletStepListener, type LaceWalletStep } from '../laceMidnightBridge';
import { preflightRetryMatch, type MatchDiagnosticLine } from '../matchDiagnostics';
import { assetIdFromSymbol, parseLimitPriceToUint64 } from '../obsidianBytes';
import type { OrderRow, OrderSide } from '../types';
import { OperatorPanel } from './OperatorPanel';

type DashboardProps = {
  orders: OrderRow[];
  setOrders: Dispatch<SetStateAction<OrderRow[]>>;
  midnightProviders: MidnightProviders | null;
  contractAddressDraft: string;
  providersBusy: boolean;
  providersBlockedReason: string | null;
};

const cardStyle: React.CSSProperties = {
  flex: '1 1 320px',
  background: '#FFF',
  padding: '20px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
};

function randomBytes32(): Uint8Array {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return buf;
}

function relayerIntentSnippet(order: OrderRow): string {
  const record: Record<string, string> = {
    commitmentHex: order.commitmentHex ?? '',
    assetIdHex: order.assetIdHex ?? '',
    side: order.side,
  };
  if (order.side === 'BUY' && order.boundPrice) {
    record.maxPrice = order.boundPrice;
  }
  if (order.side === 'SELL' && order.boundPrice) {
    record.minPrice = order.boundPrice;
  }
  return JSON.stringify(record, null, 2);
}

export function TraderDashboard({
  orders,
  setOrders,
  midnightProviders,
  contractAddressDraft,
  providersBusy,
  providersBlockedReason,
}: DashboardProps) {
  const [asset, setAsset] = useState('wETH');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoMatchMessage, setAutoMatchMessage] = useState<string | null>(null);
  const [autoMatchBusy, setAutoMatchBusy] = useState(false);
  const [matchLog, setMatchLog] = useState<MatchDiagnosticLine[]>([]);
  const [showMatchLog, setShowMatchLog] = useState(true);
  const [laceApprovalHint, setLaceApprovalHint] = useState<string | null>(null);
  const [lacePromptCount, setLacePromptCount] = useState(0);
  const [submitPhase, setSubmitPhase] = useState<string | null>(null);
  const autoMatchBusyRef = useRef(false);
  const pollMatchCooldownRef = useRef(0);

  const trimmedAddr = contractAddressDraft.trim();
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    setLaceWalletStepListener((step: LaceWalletStep) => {
      setLacePromptCount((n) => {
        const next = n + 1;
        const msg = `Lace ${step} (${next} wallet step this session — expect more if match/settle runs)`;
        setLaceApprovalHint(msg);
        console.info(`[Obsidian] ${msg}`);
        return next;
      });
    });
    return () => setLaceWalletStepListener(null);
  }, []);

  const appendMatchLog = useCallback((level: MatchDiagnosticLine['level'], message: string) => {
    const line: MatchDiagnosticLine = {
      at: new Date().toLocaleTimeString(),
      level,
      message,
    };
    console.info(`[Obsidian match] ${line.at} ${message}`);
    setMatchLog((prev) => [...prev.slice(-80), line]);
  }, []);

  const onMatchProgress = useCallback(
    (step: AutoMatchStep, detail: string) => {
      appendMatchLog('info', `[${step}] ${detail}`);
    },
    [appendMatchLog],
  );

  const onWalletApproval = useCallback(
    (circuit: 'propose_match' | 'atomic_settle') => {
      const msg = laceApprovalMessage(circuit, { index: circuit === 'propose_match' ? 2 : 3, total: 3 });
      setLaceApprovalHint(msg);
      appendMatchLog('info', msg);
    },
    [appendMatchLog],
  );

  const runAutoMatch = useCallback(
    async (triggerOrderId?: string, snapshot?: OrderRow[], source = 'auto') => {
      const base = snapshot ?? ordersRef.current;

      if (!midnightProviders) {
        appendMatchLog('error', `${source}: aborted — wallet/proving stack not ready.`);
        setAutoMatchMessage('Connect Lace and wait for “Wallet / proving stack ready”.');
        return;
      }
      if (trimmedAddr.length === 0) {
        appendMatchLog('error', `${source}: aborted — no contract address.`);
        setAutoMatchMessage('Set contract address in .env or header field.');
        return;
      }
      if (autoMatchBusyRef.current) {
        appendMatchLog(
          'warn',
          `${source}: skipped — match already in progress (ZK steps can take 1–3 minutes).`,
        );
        return;
      }
      try {
        assertIsContractAddress(trimmedAddr);
      } catch {
        appendMatchLog('error', `${source}: contract address failed parse.`);
        setAutoMatchMessage('Invalid contract address.');
        return;
      }

      const contractAddress = trimmedAddr as ContractAddress;
      autoMatchBusyRef.current = true;
      setAutoMatchBusy(true);
      appendMatchLog('info', `${source}: starting match pipeline on ${base.length} order(s)…`);

      try {
        let settleResult = await tryAutoSettlePendingMatch({
          providers: midnightProviders,
          contractAddress,
          orders: base,
          onProgress: onMatchProgress,
        });
        let working = settleResult.orders;
        if (settleResult.matched) {
          appendMatchLog('ok', settleResult.message || 'Pending settle completed.');
          setAutoMatchMessage(settleResult.message);
        } else {
          appendMatchLog('info', 'No pending settle — searching for new cross…');
          const matchResult = await tryAutoMatchAndSettle({
            providers: midnightProviders,
            contractAddress,
            orders: working,
            triggerOrderId,
            onProgress: onMatchProgress,
            onWalletApproval,
          });
          working = matchResult.orders;
          appendMatchLog(matchResult.matched ? 'ok' : 'warn', matchResult.message);
          setAutoMatchMessage(matchResult.message);
        }
        setOrders(enrichOrderLedgerStatuses(working));
      } catch (err) {
        const msg = formatMidnightError(err);
        appendMatchLog('error', `${source}: exception — ${msg}`);
        setAutoMatchMessage(msg);
        console.error('[Obsidian] runAutoMatch failed', err);
      } finally {
        autoMatchBusyRef.current = false;
        setAutoMatchBusy(false);
        appendMatchLog('info', `${source}: finished.`);
      }
    },
    [midnightProviders, trimmedAddr, setOrders, appendMatchLog, onMatchProgress, onWalletApproval],
  );

  async function handleLoadRelayerActivity() {
    const events = await fetchRelayerActivity(80);
    if (events.length === 0) {
      appendMatchLog('warn', 'No relayer activity — is `yarn relayer` running on :3033?');
      return;
    }
    appendMatchLog('info', `Relayer activity (${events.length} events, all browsers):`);
    for (const ev of events.slice(-25)) {
      const row = ev as { ts?: string; type?: string; commitmentHex?: string; buyerHex?: string; sellerHex?: string };
      appendMatchLog(
        'info',
        `${row.ts ?? '?'} ${row.type ?? 'event'} ${row.commitmentHex?.slice(0, 12) ?? ''} ${row.buyerHex?.slice(0, 8) ?? ''} ${row.sellerHex?.slice(0, 8) ?? ''}`.trim(),
      );
    }
  }

  function handleRetryMatchClick() {
    const snapshot = ordersRef.current;
    const preflight = preflightRetryMatch({
      hasProviders: Boolean(midnightProviders),
      contractAddress: trimmedAddr,
      alreadyBusy: autoMatchBusyRef.current,
      pool: snapshot,
    });
    setMatchLog(preflight);
    setShowMatchLog(true);
    for (const line of preflight) {
      console.info(`[Obsidian match] ${line.at} ${line.message}`);
    }
    if (preflight.some((l) => l.level === 'error')) {
      setAutoMatchMessage(preflight.find((l) => l.level === 'error')?.message ?? 'Cannot retry.');
      return;
    }
    if (preflight.some((l) => l.level === 'warn' && l.message.includes('already running'))) {
      return;
    }
    void runAutoMatch(undefined, snapshot, 'retry-button');
  }

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
    setPolling(true);
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
      const pollCooldownMs = 90_000;
      if (
        queuedCount >= 2 &&
        diagnosis.includes('Cross found') &&
        !autoMatchBusyRef.current &&
        Date.now() - pollMatchCooldownRef.current > pollCooldownMs
      ) {
        pollMatchCooldownRef.current = Date.now();
        appendMatchLog(
          'warn',
          `Poll: ${queuedCount} queued legs cross but still on-chain — auto-running match…`,
        );
        void runAutoMatch(undefined, enriched, 'poll-cross');
      }
    } finally {
      setPolling(false);
    }
  }, [midnightProviders, trimmedAddr, setOrders, runAutoMatch, appendMatchLog]);

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
    if (orders.length > prevOrderCountRef.current) {
      const snap = ordersRef.current;
      const queued = snap.filter(isQueuedInPool);
      if (queued.length >= 1 && !autoMatchBusyRef.current) {
        void runAutoMatch(undefined, snap, 'new-order');
      }
    }
    prevOrderCountRef.current = orders.length;
  }, [midnightProviders, trimmedAddr, orders.length, runAutoMatch]);

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!midnightProviders) {
      window.alert('Connect Lace and wait for “Wallet / proving stack ready”.');
      return;
    }

    try {
      assertIsContractAddress(trimmedAddr);
    } catch {
      window.alert(`Contract address doesn't parse — paste OBSIDIAN_CONTRACT_ADDRESS from yarn demo:contracts.`);
      return;
    }

    let boundPrice: bigint;
    try {
      boundPrice = parseLimitPriceToUint64(price);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      return;
    }

    const commitment = randomBytes32();
    const nullifier = randomBytes32();
    const assetId = await assetIdFromSymbol(asset);
    const orderId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : btoa(Math.random().toString()).substring(0, 12);

    const draftForPreview: OrderRow = {
      id: 'draft',
      asset,
      qty,
      price,
      side,
      assetIdHex: toHex(assetId),
      boundPrice: boundPrice.toString(),
      status: 'draft',
      queueStatus: 'queued',
    };
    const willCross = findCounterparty(draftForPreview, ordersRef.current) !== null;

    setSubmitting(true);
    setLacePromptCount(0);
    setSubmitPhase(
      willCross
        ? 'Step 1/3: approve submit_order in Lace — then match + settle will auto-run (2 more prompts)'
        : 'Approve submit_order in Lace',
    );
    setLaceApprovalHint(
      willCross
        ? laceApprovalMessage('submit_order', { index: 1, total: 3 }) +
          ' Then keep Lace open for propose_match and atomic_settle.'
        : laceApprovalMessage('submit_order'),
    );
    try {
      const contractAddress = trimmedAddr as ContractAddress;
      await ensureObsidianCallPrivateState(midnightProviders, contractAddress);

      const finalized = await submitCallTx(midnightProviders, {
        compiledContract: CompiledObsidianContract,
        contractAddress,
        privateStateId: OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
        circuitId: 'submit_order',
        args: [commitment, nullifier],
      } as never);

      const newOrder: OrderRow = {
        id: orderId,
        asset,
        qty,
        price,
        side,
        assetIdHex: toHex(assetId),
        boundPrice: boundPrice.toString(),
        status: String(finalized.public.status),
        commitmentHex: toHex(commitment),
        nullifierHex: toHex(nullifier),
        txId: finalized.public.txId,
        createdAt: new Date().toISOString(),
        queueStatus: 'queued',
        ledgerStatus: {
          commitmentActive: true,
          inMatchLog: false,
          auditPresent: false,
          pollError: null,
        },
      };
      setQty('');
      setPrice('');
      const { status } = await pollOrderLedgerStatus(midnightProviders, contractAddress, newOrder);
      const withLedger = {
        ...newOrder,
        ledgerStatus: status,
      };
      const nextOrders = enrichOrderLedgerStatuses([...ordersRef.current, withLedger]);
      setOrders(nextOrders);
      void registerOrderWithRelayer(withLedger);
      if (willCross) {
        setSubmitPhase('Steps 2–3: auto match + settle — watch Lace for propose_match, then atomic_settle');
        setAutoMatchMessage('submit_order done — running propose_match → atomic_settle automatically…');
      } else {
        setAutoMatchMessage('Submitted — queued until a crossing counterparty is submitted.');
      }
      await new Promise((r) => setTimeout(r, 800));
      ordersRef.current = nextOrders;
      await runAutoMatch(orderId, nextOrders, 'after-submit');
    } catch (err) {
      const msg = formatMidnightError(err);
      console.error('[Obsidian] submit_order failed', err);
      if (err instanceof Error && err.cause !== undefined) {
        console.error('[Obsidian] submit_order cause', err.cause);
      }
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
      setSubmitPhase(null);
      setLaceApprovalHint(null);
    }
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <h3>Submit masked order intent (real ledger)</h3>
          <p style={{ fontSize: '12px', color: '#444', marginBottom: '8px' }}>
            {LACE_SIGNING_EXPLAINER}
          </p>
          <p style={{ fontSize: '12px', color: '#444', marginBottom: '12px' }}>
            When a cross exists, this page <strong>automatically</strong> calls{' '}
            <code>propose_match</code> then <code>atomic_settle</code> after your{' '}
            <code>submit_order</code> — but Lace still requires <strong>3 separate approvals</strong>{' '}
            (we cannot sign invisibly).
          </p>
          {laceApprovalHint ? (
            <p
              style={{
                fontSize: '13px',
                fontWeight: 'bold',
                color: '#4A3F7A',
                background: '#F0EEFF',
                border: '1px solid #D4CEED',
                borderRadius: '6px',
                padding: '10px 12px',
                marginBottom: '10px',
              }}
              role="status"
            >
              {laceApprovalHint}
              {lacePromptCount > 0 ? (
                <span style={{ display: 'block', fontWeight: 'normal', marginTop: '6px', fontSize: '12px' }}>
                  Wallet steps this submit: {lacePromptCount}. Full cross ≈ 6 (balance+submit × 3 circuits). If
                  stuck at 1–2, check the match log — auto match likely did not run.
                </span>
              ) : null}
            </p>
          ) : null}
          {submitPhase ? (
            <p style={{ fontSize: '12px', color: '#8C5C0A', marginBottom: '10px' }} role="status">
              {submitPhase}
            </p>
          ) : null}
          {autoMatchMessage ? (
            <p
              style={{
                fontSize: '12px',
                color: autoMatchMessage.toLowerCase().includes('fail') ? '#8B2942' : '#1D6E56',
                marginBottom: '10px',
              }}
              role="status"
            >
              {autoMatchBusy ? '⏳ ' : ''}
              {autoMatchMessage}
            </p>
          ) : null}
          {autoMatchBusy ? (
            <p style={{ fontSize: '11px', color: '#8C5C0A', marginBottom: '8px' }} role="status">
              Match in progress — generating ZK proofs (often 30s–3min). Button stays disabled until
              done; see log below.
            </p>
          ) : null}
          {providersBlockedReason ? (
            <p style={{ fontSize: '12px', color: '#8B2942', marginBottom: '10px' }} role="alert">
              {providersBlockedReason}
            </p>
          ) : null}

          <form
            onSubmit={(ev) => {
              void handleSubmitOrder(ev);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}
          >
            <label htmlFor="obsidian-side">Side</label>
            <select
              id="obsidian-side"
              value={side}
              onChange={(event) => setSide(event.target.value as OrderSide)}
              style={{ padding: '8px' }}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>

            <label htmlFor="obsidian-asset">Asset Pair (label + circuit asset id)</label>
            <select
              id="obsidian-asset"
              value={asset}
              onChange={(event) => setAsset(event.target.value)}
              style={{ padding: '8px' }}
            >
              <option value="wETH">wETH (Wrapped Ethereum)</option>
              <option value="wADA">wADA (Wrapped Cardano)</option>
            </select>

            <label htmlFor="obsidian-qty">Quantity (label only)</label>
            <input
              id="obsidian-qty"
              type="number"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              placeholder="0.00"
              required
              style={{ padding: '8px' }}
            />

            <label htmlFor="obsidian-price">
              Limit price ({side === 'BUY' ? 'max for buyer' : 'min for seller'}, uint64)
            </label>
            <input
              id="obsidian-price"
              type="number"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0.00"
              required
              style={{ padding: '8px' }}
            />

            <button
              type="submit"
              disabled={submitting || providersBusy || !midnightProviders || trimmedAddr.length === 0}
              style={{
                padding: '10px',
                background: submitting || providersBusy ? '#7a8490' : '#0D1B2A',
                color: '#FFF',
                border: 'none',
                borderRadius: '4px',
                cursor: submitting || providersBusy ? 'wait' : 'pointer',
                fontWeight: 'bold',
              }}
            >
              {submitting
                ? submitPhase ?? 'Submitting & auto-matching…'
                : 'Submit order (up to 3 Lace prompts if cross)'}
            </button>
          </form>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ margin: 0 }}>Your submitted intents</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void refreshLedgerStatuses()}
                disabled={polling || !midnightProviders || orders.length === 0}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  background: '#fff',
                  cursor: polling ? 'wait' : 'pointer',
                }}
              >
                {polling ? 'Polling indexer…' : 'Refresh on-chain status'}
              </button>
              <button
                type="button"
                onClick={() => handleRetryMatchClick()}
                disabled={polling || autoMatchBusy || !midnightProviders}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  border: '1px solid #1D6E56',
                  borderRadius: '4px',
                  background: autoMatchBusy ? '#d8ebe4' : '#f0faf6',
                  cursor: autoMatchBusy || polling ? 'wait' : 'pointer',
                  color: '#1D6E56',
                  minWidth: '160px',
                }}
              >
                {autoMatchBusy ? 'Matching… (see log)' : 'Retry match queued orders'}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadRelayerActivity()}
                disabled={!midnightProviders}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  border: '1px solid #4A3F7A',
                  borderRadius: '4px',
                  background: '#f5f3ff',
                  cursor: 'pointer',
                  color: '#4A3F7A',
                }}
                title="Load shared log from yarn relayer (all browsers)"
              >
                Relayer activity
              </button>
            </div>
          </div>
          {matchLog.length > 0 ? (
            <div style={{ marginBottom: '12px' }}>
              <button
                type="button"
                onClick={() => setShowMatchLog((v) => !v)}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  marginBottom: '6px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                {showMatchLog ? 'Hide' : 'Show'} match debug log ({matchLog.length} lines)
              </button>
              {showMatchLog ? (
                <pre
                  style={{
                    margin: 0,
                    padding: '10px',
                    background: '#1a1a1a',
                    color: '#e8e8e8',
                    borderRadius: '6px',
                    maxHeight: '240px',
                    overflowY: 'auto',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '10px',
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {matchLog
                    .map((line) => {
                      const tag =
                        line.level === 'error'
                          ? 'ERR'
                          : line.level === 'warn'
                            ? 'WRN'
                            : line.level === 'ok'
                              ? ' OK'
                              : '   ';
                      return `${line.at} ${tag} ${line.message}`;
                    })
                    .join('\n')}
                </pre>
              ) : null}
            </div>
          ) : null}
          {submitError ? (
            <p style={{ fontSize: '12px', color: '#8B2942', marginBottom: '8px' }} role="alert">
              {submitError}
            </p>
          ) : null}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', marginTop: '16px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0D1B2A', color: '#FFF', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>Ticket</th>
                  <th style={{ padding: '8px' }}>Commitment</th>
                  <th style={{ padding: '8px' }}>Lifecycle</th>
                  <th style={{ padding: '8px' }}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '12px', color: '#666', fontStyle: 'italic' }}>
                      No submits yet — orders persist in this browser (localStorage).
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <Fragment key={order.id}>
                      <tr
                        style={{ borderBottom: '1px solid #E0DED8', cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                      >
                        <td style={{ padding: '8px', fontSize: '12px' }}>
                          <strong>{order.side ?? 'BUY'}</strong> {order.qty} {order.asset} @ {order.price}
                          {order.boundPrice ? (
                            <span style={{ color: '#666', fontSize: '11px' }}>
                              {' '}
                              (bound {order.boundPrice})
                            </span>
                          ) : null}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            color: '#1D6E56',
                            wordBreak: 'break-all',
                          }}
                          title={order.commitmentHex}
                        >
                          {order.commitmentHex ?? '—'}
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#8C5C0A' }}>
                          {formatLifecyclePhase(order)}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            wordBreak: 'break-all',
                          }}
                          title={order.txId}
                        >
                          {order.txId ? `${order.txId.slice(0, 12)}…` : '—'}
                        </td>
                      </tr>
                      {expandedId === order.id ? (
                        <tr>
                          <td colSpan={4} style={{ padding: '12px', background: '#FAFAF8', fontSize: '11px' }}>
                            <p style={{ margin: '0 0 8px' }}>
                              <strong>Nullifier:</strong>{' '}
                              <code style={{ wordBreak: 'break-all' }}>{order.nullifierHex ?? '—'}</code>
                            </p>
                            <p style={{ margin: '0 0 8px' }}>
                              <strong>Asset id (propose_match):</strong>{' '}
                              <code style={{ wordBreak: 'break-all' }}>{order.assetIdHex ?? '—'}</code>
                            </p>
                            {order.ledgerStatus?.auditCiphertext ? (
                              <p>
                                <strong>Audit ciphertext (buyer key):</strong>{' '}
                                <code>{order.ledgerStatus.auditCiphertext}</code>
                              </p>
                            ) : null}
                            {order.ledgerStatus?.pairedAuditCiphertext ? (
                              <p>
                                <strong>Pair audit (buyer anchor):</strong>{' '}
                                <code>{order.ledgerStatus.pairedAuditCiphertext}</code>
                                {order.ledgerStatus.pairedBuyerCommitmentHex ? (
                                  <>
                                    {' '}
                                    · buyer{' '}
                                    <code style={{ fontSize: '10px' }}>
                                      {order.ledgerStatus.pairedBuyerCommitmentHex.slice(0, 16)}…
                                    </code>
                                  </>
                                ) : null}
                              </p>
                            ) : null}
                            <p style={{ margin: '8px 0 4px' }}>
                              <strong>Relayer intent JSON</strong> (register via{' '}
                              <code>MatchingRelayer.registerLocalIntent</code> in core):
                            </p>
                            <pre
                              style={{
                                background: '#eee',
                                padding: '8px',
                                overflow: 'auto',
                                fontSize: '10px',
                              }}
                            >
                              {relayerIntentSnippet(order)}
                            </pre>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (order.commitmentHex) {
                                  copyText(order.commitmentHex);
                                }
                              }}
                              style={{ marginRight: '8px', fontSize: '11px', padding: '4px 8px' }}
                            >
                              Copy commitment hex
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                copyText(relayerIntentSnippet(order));
                              }}
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                            >
                              Copy relayer JSON
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <OperatorPanel
        orders={orders}
        midnightProviders={midnightProviders}
        contractAddressDraft={contractAddressDraft}
        providersBusy={providersBusy}
      />
    </>
  );
}
