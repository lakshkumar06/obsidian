import { useState } from 'react';
import { ledger } from '@obsidian/managed-contract';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';

export type AuditLedgerRow = {
  pairCommitmentHex: string;
  auditCiphertext: string;
};

type RegulatorProps = {
  midnightProviders: MidnightProviders | null;
  contractAddressDraft: string;
  providersBusy: boolean;
  providersBlockedReason: string | null;
};

/** Honest supervisory view: only what the indexer can show — ciphertext blobs keyed by pair commitment. No fake decrypt. */
export function RegulatorPanel({
  midnightProviders,
  contractAddressDraft,
  providersBusy,
  providersBlockedReason,
}: RegulatorProps) {
  const [rows, setRows] = useState<AuditLedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmed = contractAddressDraft.trim();

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRows([]);
    if (!midnightProviders) {
      window.alert('Connect Lace first — we reuse your wallet’s indexer URIs.');
      return;
    }
    try {
      assertIsContractAddress(trimmed);
    } catch {
      window.alert(`Contract address doesn't parse — paste OBSIDIAN_CONTRACT_ADDRESS from yarn demo:contracts.`);
      return;
    }

    setLoading(true);
    try {
      const state = await midnightProviders.publicDataProvider.queryContractState(trimmed as ContractAddress);
      if (!state) {
        setRows([]);
        setError('Indexer returned no contract state (wrong address / not deployed / stalled sync).');
        return;
      }
      const view = ledger(state.data);
      const extracted: AuditLedgerRow[] = [];
      for (const [commitBytes, ciphertext] of view.audit_ciphertexts) {
        extracted.push({
          pairCommitmentHex: toHex(commitBytes),
          auditCiphertext: ciphertext,
        });
      }
      extracted.sort((a, b) => a.pairCommitmentHex.localeCompare(b.pairCommitmentHex));
      setRows(extracted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[Obsidian] regulator fetch failed', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: '#FFF',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
      }}
    >
      <h3>Compliance audit payloads (indexed ledger truth)</h3>
      <p style={{ fontSize: '14px', color: '#4A4A4A', maxWidth: '880px' }}>
        Loads <code style={{ fontSize: '12px' }}>audit_ciphertexts</code> map entries live from the Lace-configured indexer. This is
        the honest supervisory surface: ciphertext strings published by <code>atomic_settle</code>, keyed by hashed pair anchors.
        Regulatory decryption tooling is deliberately not simulated here — nothing below is fabricated.
      </p>

      {providersBlockedReason ? (
        <p style={{ marginTop: '12px', fontSize: '12px', color: '#8B2942' }} role="alert">
          {providersBlockedReason}
        </p>
      ) : null}

      <form onSubmit={(ev) => void handleLoad(ev)} style={{ marginTop: '16px', marginBottom: '20px' }}>
        <button
          type="submit"
          disabled={loading || providersBusy || !midnightProviders || trimmed.length === 0}
          style={{
            padding: '8px 16px',
            background: loading || providersBusy ? '#bdbdbd' : '#4A3F7A',
            color: '#FFF',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Querying indexer…' : 'Refresh audit ciphertext ledger'}
        </button>
      </form>

      {error ? (
        <p style={{ fontSize: '13px', color: '#8B2942', marginBottom: '12px' }} role="alert">
          {error}
        </p>
      ) : null}

      {rows.length === 0 && !loading && !error ? (
        <p style={{ fontSize: '13px', color: '#777' }}>
          No ciphertext rows mapped yet — run atomic settlement on-chain (see core demo / relayer) or refresh after matches settle.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#4A3F7A', color: '#FFF', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Pair commitment (digest)</th>
                <th style={{ padding: '8px' }}>Published audit ciphertext</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pairCommitmentHex} style={{ borderBottom: '1px solid #E0DED8', verticalAlign: 'top' }}>
                  <td
                    style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', width: '36%' }}
                  >
                    {r.pairCommitmentHex}
                  </td>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                    {r.auditCiphertext}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
