import { MIDNIGHT_NETWORK_PRESETS } from '../networkHint';
import type { WalletEntry } from '../walletDiscovery';

type ConnectSheetProps = {
  open: boolean;
  onClose: () => void;
  onConnect: () => void | Promise<void>;
  connecting?: boolean;
  detectedWallets: WalletEntry[];
  chosenWalletKey: string;
  onWalletChange: (key: string) => void;
  networkPreset: string;
  onNetworkPresetChange: (id: string) => void;
  customNetworkId: string;
  onCustomNetworkIdChange: (id: string) => void;
  error: string | null;
};

export function ConnectSheet({
  open,
  onClose,
  onConnect,
  connecting,
  detectedWallets,
  chosenWalletKey,
  onWalletChange,
  networkPreset,
  onNetworkPresetChange,
  customNetworkId,
  onCustomNetworkIdChange,
  error,
}: ConnectSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="sheet-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet-panel">
        <h2 className="sheet-title">Connect wallet</h2>

        {detectedWallets.length > 1 ? (
          <div className="sheet-field">
            <label htmlFor="wallet-pick">Wallet</label>
            <select
              id="wallet-pick"
              value={chosenWalletKey}
              onChange={(e) => onWalletChange(e.target.value)}
            >
              {detectedWallets.map(({ key, api }) => (
                <option key={key} value={key}>
                  {api.name}
                </option>
              ))}
            </select>
          </div>
        ) : detectedWallets.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
            No Midnight wallet detected. Install Lace in Chrome and reload.
          </p>
        ) : null}

        <div className="sheet-field">
          <label htmlFor="network-pick">Network</label>
          <select
            id="network-pick"
            value={networkPreset}
            onChange={(e) => {
              onNetworkPresetChange(e.target.value);
              onCustomNetworkIdChange('');
            }}
          >
            {MIDNIGHT_NETWORK_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sheet-field">
          <label htmlFor="network-custom">Custom network ID (optional)</label>
          <input
            id="network-custom"
            type="text"
            value={customNetworkId}
            onChange={(e) => onCustomNetworkIdChange(e.target.value)}
            placeholder="Override preset"
            spellCheck={false}
          />
        </div>

        {error ? (
          <p className="status-line error" style={{ textAlign: 'left', marginTop: 8 }}>
            {error}
          </p>
        ) : null}

        <div className="sheet-actions">
          <button
            type="button"
            className={`btn-primary ready`}
            style={{ marginTop: 0 }}
            disabled={connecting || detectedWallets.length === 0}
            onClick={() => void onConnect()}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
