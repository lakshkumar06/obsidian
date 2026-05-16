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

  const trimmedAddr = contractAddressDraft.trim();
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

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
      setOrders((prev) => {
        const merged = prev.map((row) => {
          const hit = updates.find((u) => u.id === row.id);
          if (!hit) {
            return row;
          }
          return { ...row, ledgerStatus: hit.ledgerStatus };
        });
        return enrichOrderLedgerStatuses(merged);
      });
    } finally {
      setPolling(false);
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

    setSubmitting(true);
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
        ledgerStatus: {
          commitmentActive: true,
          inMatchLog: false,
          auditPresent: false,
          pollError: null,
        },
      };
      setOrders((prev) => [...prev, newOrder]);
      setQty('');
      setPrice('');
      void pollOrderLedgerStatus(midnightProviders, contractAddress, newOrder).then(({ status }) => {
        setOrders((prev) =>
          prev.map((row) => (row.id === orderId ? { ...row, ledgerStatus: status } : row)),
        );
      });
    } catch (err) {
      const msg = formatMidnightError(err);
      console.error('[Obsidian] submit_order failed', err);
      if (err instanceof Error && err.cause !== undefined) {
        console.error('[Obsidian] submit_order cause', err.cause);
      }
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
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
          <p style={{ fontSize: '12px', color: '#444', marginBottom: '12px' }}>
            Real ZK proofs (Lace wallet or local proof-server). Quantity / limit are notebook labels;
            on-chain you publish commitment + nullifier only. Side, asset id, and price bound are stored
            locally for relayer matching and operator <code>propose_match</code> — copy commitment hex
            after submit.
          </p>
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
              {submitting ? 'Generating proof & submitting…' : 'Generate ZK proof & submit_order'}
            </button>
          </form>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ margin: 0 }}>Your submitted intents</h3>
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
          </div>
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
