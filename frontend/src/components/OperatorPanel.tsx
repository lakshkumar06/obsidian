import { useEffect, useState } from 'react';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';

import { executeAtomicSettle, executeProposeMatch } from '../darkPoolCircuits';
import { formatMidnightError } from '../formatMidnightError';
import { assetIdFromSymbol, parseLimitPriceToUint64 } from '../obsidianBytes';
import type { MatchedPair } from '../orderMatcher';
import type { OrderRow } from '../types';

type OperatorProps = {
  orders: OrderRow[];
  midnightProviders: MidnightProviders | null;
  contractAddressDraft: string;
  providersBusy: boolean;
};

export function OperatorPanel({
  orders,
  midnightProviders,
  contractAddressDraft,
  providersBusy,
}: OperatorProps) {
  const trimmed = contractAddressDraft.trim();

  const [buyerHex, setBuyerHex] = useState('');
  const [sellerHex, setSellerHex] = useState('');
  const [buyerMax, setBuyerMax] = useState('100');
  const [sellerMin, setSellerMin] = useState('80');
  const [assetSymbol, setAssetSymbol] = useState('wETH');
  const [assetIdHex, setAssetIdHex] = useState('');
  const [complianceData, setComplianceData] = useState(() => `enc:audit:ui:${Date.now()}`);

  const [busy, setBusy] = useState<'match' | 'settle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await assetIdFromSymbol(assetSymbol);
      if (!cancelled) {
        setAssetIdHex(toHex(id));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetSymbol]);

  async function handleProposeMatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastTx(null);
    if (!midnightProviders) {
      window.alert('Connect Lace and wait for the proving stack.');
      return;
    }
    try {
      assertIsContractAddress(trimmed);
    } catch {
      window.alert('Paste a valid contract address first.');
      return;
    }
    setBusy('match');
    try {
      const assetId = await assetIdFromSymbol(assetSymbol);
      const pair: MatchedPair = {
        buyer: {
          id: 'manual-buyer',
          asset: assetSymbol,
          qty: '0',
          price: buyerMax,
          side: 'BUY',
          commitmentHex: buyerHex,
          boundPrice: buyerMax,
          assetIdHex: toHex(assetId),
          status: 'manual',
        },
        seller: {
          id: 'manual-seller',
          asset: assetSymbol,
          qty: '0',
          price: sellerMin,
          side: 'SELL',
          commitmentHex: sellerHex,
          boundPrice: sellerMin,
          assetIdHex: toHex(assetId),
          status: 'manual',
        },
        buyerMax: parseLimitPriceToUint64(buyerMax),
        sellerMin: parseLimitPriceToUint64(sellerMin),
      };
      const txId = await executeProposeMatch(
        midnightProviders,
        trimmed as ContractAddress,
        pair,
      );
      setLastTx(txId);
    } catch (err) {
      setError(formatMidnightError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleAtomicSettle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastTx(null);
    if (!midnightProviders) {
      window.alert('Connect Lace and wait for the proving stack.');
      return;
    }
    try {
      assertIsContractAddress(trimmed);
    } catch {
      window.alert('Paste a valid contract address first.');
      return;
    }
    const payload = complianceData.trim();
    if (payload.length === 0) {
      setError('Compliance ciphertext string is required');
      return;
    }
    setBusy('settle');
    try {
      const txId = await executeAtomicSettle(
        midnightProviders,
        trimmed as ContractAddress,
        buyerHex,
        sellerHex,
        payload,
      );
      setLastTx(txId);
    } catch (err) {
      setError(formatMidnightError(err));
    } finally {
      setBusy(null);
    }
  }

  const panelStyle: React.CSSProperties = {
    marginTop: '24px',
    background: '#FFF',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  };

  return (
    <div style={panelStyle}>
      <h3>Manual override — match &amp; settle</h3>
      <p style={{ fontSize: '12px', color: '#444', marginBottom: '12px' }}>
        Normal flow auto-matches after submit. Use this only for debugging or when auto-match was
        skipped. Buyer commitment anchors <code>match_log</code> / <code>audit_ciphertexts</code>.
      </p>

      {orders.some((o) => o.commitmentHex) ? (
        <div style={{ marginBottom: '14px', fontSize: '11px' }}>
          <span style={{ marginRight: '8px' }}>Fill from session orders:</span>
          {orders
            .filter((o) => o.commitmentHex)
            .map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  if (o.side === 'BUY' && o.commitmentHex) {
                    setBuyerHex(o.commitmentHex);
                    if (o.boundPrice) {
                      setBuyerMax(o.boundPrice);
                    }
                  } else if (o.side === 'SELL' && o.commitmentHex) {
                    setSellerHex(o.commitmentHex);
                    if (o.boundPrice) {
                      setSellerMin(o.boundPrice);
                    }
                  }
                  setAssetSymbol(o.asset);
                }}
                style={{ marginRight: '6px', marginBottom: '6px', fontSize: '10px', padding: '3px 6px' }}
              >
                {o.side} {o.asset.slice(0, 4)}…
              </button>
            ))}
        </div>
      ) : null}

      <form
        onSubmit={(ev) => void handleProposeMatch(ev)}
        style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '560px' }}
      >
        <label>
          Buyer commitment (32-byte hex)
          <input
            value={buyerHex}
            onChange={(e) => setBuyerHex(e.target.value.trim())}
            placeholder="64 hex chars"
            spellCheck={false}
            required
            style={{ display: 'block', width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: '11px' }}
          />
        </label>
        <label>
          Seller commitment (32-byte hex)
          <input
            value={sellerHex}
            onChange={(e) => setSellerHex(e.target.value.trim())}
            placeholder="64 hex chars"
            spellCheck={false}
            required
            style={{ display: 'block', width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: '11px' }}
          />
        </label>
        <MatchPriceFields
          buyerMax={buyerMax}
          sellerMin={sellerMin}
          assetSymbol={assetSymbol}
          onBuyerMax={setBuyerMax}
          onSellerMin={setSellerMin}
          onAsset={setAssetSymbol}
        />
        <button
          type="submit"
          disabled={busy !== null || providersBusy || !midnightProviders || trimmed.length === 0}
          style={primaryButton(busy === 'match')}
        >
          {busy === 'match' ? 'Proving propose_match…' : 'Run propose_match'}
        </button>
      </form>

      <form
        onSubmit={(ev) => void handleAtomicSettle(ev)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          maxWidth: '560px',
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid #E0DED8',
        }}
      >
        <label>
          Encrypted compliance payload (opaque string)
          <input
            value={complianceData}
            onChange={(e) => setComplianceData(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: '11px' }}
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null || providersBusy || !midnightProviders || trimmed.length === 0}
          style={{ ...primaryButton(busy === 'settle'), background: busy === 'settle' ? '#7a8490' : '#4A3F7A' }}
        >
          {busy === 'settle' ? 'Proving atomic_settle…' : 'Run atomic_settle'}
        </button>
      </form>

      {error ? (
        <p style={{ fontSize: '12px', color: '#8B2942', marginTop: '12px' }} role="alert">
          {error}
        </p>
      ) : null}
      {lastTx ? (
        <p style={{ fontSize: '12px', color: '#1D6E56', marginTop: '8px' }}>
          Last tx / status: <code style={{ fontSize: '11px' }}>{lastTx}</code>
        </p>
      ) : null}

      {assetIdHex ? (
        <p style={{ fontSize: '11px', color: '#666', marginTop: '14px' }}>
          Asset id for <code>{assetSymbol}</code>:{' '}
          <code style={{ fontSize: '10px', wordBreak: 'break-all' }}>{assetIdHex}</code>
        </p>
      ) : null}
    </div>
  );
}

function MatchPriceFields(props: {
  buyerMax: string;
  sellerMin: string;
  assetSymbol: string;
  onBuyerMax: (v: string) => void;
  onSellerMin: (v: string) => void;
  onAsset: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <label style={{ flex: '1 1 120px' }}>
        Buyer max price
        <input
          type="number"
          value={props.buyerMax}
          onChange={(e) => props.onBuyerMax(e.target.value)}
          required
          style={{ display: 'block', width: '100%', padding: '8px' }}
        />
      </label>
      <label style={{ flex: '1 1 120px' }}>
        Seller min price
        <input
          type="number"
          value={props.sellerMin}
          onChange={(e) => props.onSellerMin(e.target.value)}
          required
          style={{ display: 'block', width: '100%', padding: '8px' }}
        />
      </label>
      <label style={{ flex: '1 1 120px' }}>
        Asset (both legs)
        <select
          value={props.assetSymbol}
          onChange={(e) => props.onAsset(e.target.value)}
          style={{ display: 'block', width: '100%', padding: '8px' }}
        >
          <option value="wETH">wETH</option>
          <option value="wADA">wADA</option>
        </select>
      </label>
    </div>
  );
}

function primaryButton(busy: boolean): React.CSSProperties {
  return {
    padding: '10px',
    background: busy ? '#7a8490' : '#0D1B2A',
    color: '#FFF',
    border: 'none',
    borderRadius: '4px',
    cursor: busy ? 'wait' : 'pointer',
    fontWeight: 'bold',
    maxWidth: '280px',
  };
}
