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
};

export function RegulatorPanel({
  midnightProviders,
  contractAddressDraft,
  providersBusy,
}: RegulatorProps) {
  const [rows, setRows] = useState<AuditLedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmed = contractAddressDraft.trim();

  async function handleLoad() {
    setError(null);
    setRows([]);
    if (!midnightProviders) {
      setError('Connect wallet first');
      return;
    }

    try {
      assertIsContractAddress(trimmed);
    } catch {
      setError('Contract not configured');
      return;
    }

    setLoading(true);
    try {
      const state = await midnightProviders.publicDataProvider.queryContractState(
        trimmed as ContractAddress,
      );
      if (!state) {
        setError('No contract state from indexer');
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="regulator-card">
      <button
        type="button"
        className={`btn-primary ready`}
        style={{ marginTop: 0, marginBottom: 20 }}
        disabled={loading || providersBusy || !midnightProviders}
        onClick={() => void handleLoad()}
      >
        {loading ? 'Loading…' : 'Load audit records'}
      </button>

      {error ? <p className="status-line error">{error}</p> : null}

      {rows.length === 0 && !error && !loading ? (
        <p className="history-empty" style={{ padding: '24px 0' }}>
          No audit payloads on-chain yet
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.pairCommitmentHex} className="regulator-row">
            <div style={{ color: 'var(--text)', marginBottom: 6, fontSize: 14 }}>
              {row.pairCommitmentHex.slice(0, 20)}…
            </div>
            <div>{row.auditCiphertext}</div>
          </div>
        ))
      )}
    </div>
  );
}
