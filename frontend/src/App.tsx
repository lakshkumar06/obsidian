import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import '@midnight-ntwrk/dapp-connector-api';
import { TraderDashboard } from './components/TraderDashboard';
import { RegulatorPanel } from './components/RegulatorPanel';
import { buildObsidianMidnightProviders, type ObsidianMidnightStack } from './laceMidnightBridge';
import {
  MIDNIGHT_NETWORK_PRESETS,
  defaultMidnightNetworkId,
  isLikelyNetworkIdMismatch,
} from './networkHint';
import {
  contractAddressConfiguredViaEnv,
  persistContractAddress,
  resolveInitialContractAddress,
} from './contractAddress';
import { loadStoredOrders, persistOrders } from './orderStorage';
import type { OrderRow } from './types';
import {
  listMidnightWalletEntries,
  pickDefaultMidnightWallet,
  type WalletEntry,
} from './walletDiscovery';

function walletInstallHelpMessage(): string {
  return [
    'No Midnight wallet found on window.midnight.',
    '',
    'Try:',
    '• Chromium-based browser only (Chrome, Brave, Arc, Edge). Extensions do not inject in Safari/Firefox the same way.',
    '• Install and enable Lace (Midnight-capable build) from the Lace / Midnight documentation.',
    '• Allow the extension on http://localhost:5173 (site access = “On all sites” or localhost allowed).',
    '• Completely quit and reopen the browser after installing, then reload this page.',
    '',
    'If you already installed it: open DevTools Console and type: Object.keys(window.midnight ?? {})',
    'You should see at least one key (not necessarily “mnLace”; we scan all injected wallets).',
    '',
    'https://docs.midnight.network/getting-started/hello-world',
  ].join('\n');
}

export default function App() {
  const envDefaultNetwork = defaultMidnightNetworkId();
  const envIsPreset = MIDNIGHT_NETWORK_PRESETS.some((p) => p.id === envDefaultNetwork);

  const [isConnected, setIsConnected] = useState(false);
  const [shieldedAddress, setShieldedAddress] = useState<string | null>(null);
  const [dustBalance, setDustBalance] = useState<{ balance: bigint; cap: bigint } | null>(null);
  const [viewMode, setViewMode] = useState<'trader' | 'regulator'>('trader');
  const [orders, setOrders] = useState<OrderRow[]>(() => loadStoredOrders());
  const [walletError, setWalletError] = useState<string | null>(null);
  const [detectedWallets, setDetectedWallets] = useState<WalletEntry[]>([]);
  const [chosenWalletKey, setChosenWalletKey] = useState<string | ''>('');

  const [networkPreset, setNetworkPreset] = useState<string>(() =>
    envIsPreset ? envDefaultNetwork : 'undeployed',
  );
  const [customNetworkId, setCustomNetworkId] = useState<string>(() =>
    envIsPreset ? '' : envDefaultNetwork,
  );

  const [shieldedBundle, setShieldedBundle] = useState<Awaited<
    ReturnType<ConnectedAPI['getShieldedAddresses']>
  > | null>(null);
  const [midnightProviders, setMidnightProviders] = useState<ObsidianMidnightStack | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providerSetupError, setProviderSetupError] = useState<string | null>(null);

  const [contractAddressDraft, setContractAddressDraft] = useState(resolveInitialContractAddress);
  const contractFromEnv = contractAddressConfiguredViaEnv();

  const walletApiRef = useRef<InitialAPI | null>(null);
  const networkIdRef = useRef('undeployed');

  const effectiveNetworkId =
    customNetworkId.trim().length > 0 ? customNetworkId.trim() : networkPreset;

  networkIdRef.current = effectiveNetworkId;

  const getFreshLaceConnection = useCallback(async (): Promise<ConnectedAPI> => {
    const wallet = walletApiRef.current;
    if (!wallet) {
      throw new Error('Wallet not connected — click Connect wallet.');
    }
    const connected = await wallet.connect(networkIdRef.current);
    try {
      const dust = await connected.getDustBalance();
      setDustBalance(dust);
    } catch {
      /* older Lace builds may omit dust query */
    }
    return connected;
  }, []);

  useEffect(() => {
    persistOrders(orders);
  }, [orders]);

  useEffect(() => {
    const entries = listMidnightWalletEntries();
    setDetectedWallets(entries);
    const chosen = pickDefaultMidnightWallet(entries);
    setChosenWalletKey(chosen?.key ?? '');
  }, []);

  useEffect(() => {
    function refreshInjectors(): void {
      const entries = listMidnightWalletEntries();
      setDetectedWallets(entries);
      setChosenWalletKey((current) =>
        entries.some((e) => e.key === current) ? current : (pickDefaultMidnightWallet(entries)?.key ?? ''),
      );
    }

    window.addEventListener('focus', refreshInjectors);
    document.addEventListener('visibilitychange', refreshInjectors);
    return () => {
      window.removeEventListener('focus', refreshInjectors);
      document.removeEventListener('visibilitychange', refreshInjectors);
    };
  }, []);

  useEffect(() => {
    if (shieldedAddress) {
      setWalletError(null);
    }
  }, [shieldedAddress]);

  useEffect(() => {
    if (!isConnected || !shieldedBundle) {
      setMidnightProviders(null);
      setProviderSetupError(null);
      setProvidersLoading(false);
      return;
    }

    let cancelled = false;
    setProvidersLoading(true);
    setProviderSetupError(null);

    void (async () => {
      try {
        const built = await buildObsidianMidnightProviders(getFreshLaceConnection, shieldedBundle);
        if (!cancelled) {
          setMidnightProviders(built);
        }
      } catch (error) {
        console.error('[Obsidian] midnight provider bootstrap failed', error);
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setMidnightProviders(null);
          setProviderSetupError(message);
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, shieldedBundle, getFreshLaceConnection]);

  const providersBlockedReason =
    providerSetupError ?? (providersLoading ? 'Wallet connected — wiring Lace proving + indexer…' : null);

  const connectWallet = async () => {
    try {
      setWalletError(null);
      setProviderSetupError(null);
      const entries = listMidnightWalletEntries();

      let wallet = entries.find((e) => e.key === chosenWalletKey)?.api ?? null;

      if (!wallet) {
        const fallback = pickDefaultMidnightWallet(entries);
        wallet = fallback?.api ?? null;
      }

      if (!wallet) {
        setDetectedWallets([]);
        window.alert(walletInstallHelpMessage());
        return;
      }

      walletApiRef.current = wallet;
      const connected = await wallet.connect(effectiveNetworkId);
      const addresses = await connected.getShieldedAddresses();
      let dust: { balance: bigint; cap: bigint } | null = null;
      try {
        dust = await connected.getDustBalance();
      } catch {
        /* older Lace builds may omit dust query */
      }

      setShieldedBundle(addresses);
      setDustBalance(dust);

      setShieldedAddress(addresses.shieldedAddress);
      setIsConnected(true);
    } catch (error) {
      console.error('Wallet connectivity failure:', error);
      const base = error instanceof Error ? error.message : String(error);
      walletApiRef.current = null;
      setShieldedBundle(null);
      setDustBalance(null);
      setMidnightProviders(null);
      setIsConnected(false);
      if (isLikelyNetworkIdMismatch(base)) {
        setWalletError(
          `${base} — This page calls connect("${effectiveNetworkId}"). That string must equal ` +
            `the Midnight network ID of your active Lace profile. In Lace open Midnight/developer ` +
            `settings, switch networks or copy the profile’s network ID into “Manual network ID”, ` +
            `then reconnect. For the stock Docker compose in this repo choose undeployed and point ` +
            `Lace at the same indexer/node URLs as that stack.`,
        );
      } else {
        setWalletError(base);
      }
    }
  };

  return (
    <div
      style={{
        padding: '24px',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#F5F4F2',
        minHeight: '100vh',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          borderBottom: '1px solid #E0DED8',
          paddingBottom: '12px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <h2 style={{ margin: 0 }}>OBSIDIAN // ZK Dark Pool</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px' }}>
          {detectedWallets.length > 1 ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              Wallet
              <select
                value={chosenWalletKey}
                onChange={(e) => setChosenWalletKey(e.target.value)}
                style={{ padding: '6px', maxWidth: '220px' }}
              >
                {detectedWallets.map(({ key, api }) => (
                  <option key={key} value={key}>
                    {api.name} · {key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!isConnected && (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '12px',
                width: 'min(340px, 100%)',
              }}
            >
              <span>
                Lace <code style={{ marginLeft: '4px' }}>connect(…)</code> network preset
              </span>
              <select
                value={networkPreset}
                onChange={(e) => {
                  setNetworkPreset(e.target.value);
                  setCustomNetworkId('');
                }}
                style={{ padding: '6px' }}
              >
                {MIDNIGHT_NETWORK_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span style={{ color: '#555' }}>Manual network ID (optional, overrides preset)</span>
              <input
                type="text"
                value={customNetworkId}
                onChange={(e) => setCustomNetworkId(e.target.value)}
                placeholder="Paste exact Lace profile id"
                spellCheck={false}
                style={{ padding: '6px' }}
              />
            </label>
          )}
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '11px',
              width: 'min(420px, 100%)',
            }}
          >
            <span>
              Obsidian contract address
              {contractFromEnv ? (
                <>
                  {' '}
                  — loaded from <code style={{ fontSize: '11px' }}>obsidian/.env</code>
                </>
              ) : (
                <>
                  {' '}
                  — set <code style={{ fontSize: '11px' }}>OBSIDIAN_CONTRACT_ADDRESS</code> in{' '}
                  <code style={{ fontSize: '11px' }}>obsidian/.env</code> or paste after{' '}
                  <code style={{ fontSize: '11px' }}>yarn demo:contracts</code>
                </>
              )}
            </span>
            <input
              type="text"
              value={contractAddressDraft}
              spellCheck={false}
              readOnly={contractFromEnv}
              placeholder="Contract address hex …"
              onChange={(event) => {
                const next = event.target.value;
                setContractAddressDraft(next);
                persistContractAddress(next);
              }}
              style={{
                padding: '7px',
                fontFamily: 'monospace',
                background: contractFromEnv ? '#f4f4f2' : undefined,
              }}
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'trader' ? 'regulator' : 'trader')}
              style={{
                padding: '8px 16px',
                background: '#4A3F7A',
                color: '#FFF',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Switch to {viewMode === 'trader' ? 'Regulator View' : 'Trader View'}
            </button>

            <button
              type="button"
              onClick={() => void connectWallet()}
              style={{
                padding: '8px 16px',
                background: isConnected ? '#1D6E56' : '#0D1B2A',
                color: '#FFF',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {isConnected ? 'Reconnect wallet' : 'Connect wallet'}
            </button>
          </div>
        </div>
      </header>

      <main style={{ marginTop: '24px' }}>
        {detectedWallets.length === 0 && !isConnected && (
          <p
            style={{
              fontSize: '13px',
              color: '#6B5B3D',
              background: '#FFF9F0',
              border: '1px solid #E8DCC8',
              borderRadius: '6px',
              padding: '12px 14px',
              maxWidth: '720px',
            }}
            role="status"
          >
            No <code>window.midnight</code> wallet detected yet. Use a Chromium browser, install Lace
            (Midnight), allow it for this site, then reload. If the extension is installed, check the
            console: <code>{`Object.keys(window.midnight ?? {})`}</code>
          </p>
        )}
        {detectedWallets.length === 1 && !isConnected && (
          <p style={{ fontSize: '12px', color: '#1D6E56' }}>
            Detected midnight wallet injectors: <strong>{detectedWallets[0]?.api.name}</strong> (
            {detectedWallets[0]?.key})
          </p>
        )}
        {!isConnected && detectedWallets.length > 0 && (
          <div style={{ marginBottom: '12px', maxWidth: '720px' }}>
            <p
              style={{
                fontSize: '13px',
                color: '#4A3F7A',
                background: '#F0EEFF',
                border: '1px solid #D4CEED',
                borderRadius: '6px',
                padding: '12px 14px',
              }}
            >
              <strong>Still seeing “Network ID mismatch”?</strong> The presets are only guesses —{' '}
              <code>connect(&quot;…&quot;)</code> must match the Midnight network Lace has{' '}
              <em>actually saved</em> in settings (not merely what network you browse elsewhere).
              <br />
              <br />
              <strong>In Lace:</strong> open the extension → ⚙️ <strong>Settings</strong> →{' '}
              <strong>Wallet / Midnight</strong> (wording varies by Lace build) → select the Midnight
              network that matches Obsidian&apos;s preset (e.g. <strong>Undeployed</strong> for{' '}
              this repo&apos;s Docker stack → then use preset <strong>undeployed</strong> here) → tap{' '}
              <strong>Save configuration</strong>. Unlock the wallet, then <strong>reload this tab</strong>{' '}
              and click Connect again.
              <br />
              <br />
              If Lace shows <strong>Preview</strong> but mismatch on <code>preview</code>, switch Lace
              to another network or copy any &quot;Network ID&quot; / developer string Lace exposes into{' '}
              <strong>Manual network ID</strong>. Common second try: preset <strong>preprod</strong> when
              Lace is on Midnight Preprod.
              <br />
              <br />
              <a
                href="https://docs.midnight.network/guides/midnight-local-network#invalid-wallet-address"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#382a72' }}
              >
                Midnight docs — Lace &quot;Undeployed&quot; configuration
              </a>
              &nbsp;(invalid wallet / Undeployed steps).
            </p>
            <button
              type="button"
              onClick={() => {
                const entry =
                  detectedWallets.find((w) => w.key === chosenWalletKey) ?? detectedWallets[0];
                if (!entry) {
                  return;
                }
                const api = entry.api as Record<string, unknown>;
                const standard = ['name', 'rdns', 'icon', 'apiVersion', 'connect'];
                const extra = Object.keys(api).filter((k) => !standard.includes(k));
                console.info('[Obsidian] Lace injector uuid:', entry.key);
                console.info('[Obsidian] InitialAPI:', {
                  name: api['name'],
                  rdns: api['rdns'],
                  apiVersion: api['apiVersion'],
                });
                console.info('[Obsidian] Extra non-standard keys:', extra);
                extra.forEach((k) => {
                  try {
                    console.info(`  ${k}:`, api[k]);
                  } catch {
                    /* ignore */
                  }
                });
              }}
              style={{
                fontSize: '12px',
                padding: '6px 10px',
                borderRadius: '4px',
                border: '1px solid #bdb6d9',
                background: '#fff',
                cursor: 'pointer',
                color: '#4A3F7A',
              }}
            >
              Log injector details (open DevTools → Console first)
            </button>
          </div>
        )}
        {!isConnected && (
          <p style={{ fontSize: '12px', color: '#4A4A4A' }}>
            Next connect calls <code>{`connect("${effectiveNetworkId}")`}</code>
            {!customNetworkId.trim() ? ' — must match Lace’s active Midnight network id.' : null}
          </p>
        )}
        {isConnected && shieldedAddress && (
          <>
            <p style={{ fontSize: '12px', color: '#4A4A4A' }}>
              <strong>Active Shielded Address:</strong> {shieldedAddress}
            </p>
            {dustBalance !== null && (
              <p
                style={{
                  fontSize: '12px',
                  color: dustBalance.balance > 0n ? '#1D6E56' : '#8B2942',
                }}
              >
                <strong>DUST (fees):</strong> {dustBalance.balance.toString()} / cap{' '}
                {dustBalance.cap.toString()}
                {dustBalance.balance === 0n ? (
                  <>
                    {' '}
                    — balance is zero; fund undeployed tNIGHT and register DUST in Lace before
                    submitting (see{' '}
                    <a
                      href="https://docs.midnight.network/guides/midnight-local-network"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Midnight local network
                    </a>
                    ).
                  </>
                ) : null}
              </p>
            )}
            <p style={{ fontSize: '12px', color: midnightProviders ? '#1D6E56' : '#8C5C0A' }}>
              <strong>Wallet / proving stack:</strong>{' '}
              {providersLoading
                ? 'Preparing Lace + indexer + proving…'
                : midnightProviders
                  ? midnightProviders.proofMode === 'lace-wallet'
                    ? 'Ready — Lace proving, Lace balance/submit, Lace indexer; private-state in tab RAM only.'
                    : `Ready — HTTP proof server (${midnightProviders.proofServerUrl ?? 'local'}), Lace balance/submit, Lace indexer; private-state in tab RAM only.`
                  : providerSetupError
                    ? 'Blocked — inspect error below.'
                    : 'Idle'}
            </p>
          </>
        )}
        {walletError && (
          <p style={{ fontSize: '12px', color: '#8B2942' }} role="alert">
            {walletError}
          </p>
        )}
        {providerSetupError && !providersLoading ? (
          <p style={{ fontSize: '12px', color: '#8B2942', maxWidth: '900px', whiteSpace: 'pre-wrap' }} role="alert">
            Midnight stack bootstrap: {providerSetupError}
          </p>
        ) : null}

        {viewMode === 'trader' ? (
          <TraderDashboard
            orders={orders}
            setOrders={setOrders}
            midnightProviders={midnightProviders}
            contractAddressDraft={contractAddressDraft}
            providersBusy={providersLoading}
            providersBlockedReason={providersBlockedReason}
          />
        ) : (
          <RegulatorPanel
            midnightProviders={midnightProviders}
            contractAddressDraft={contractAddressDraft}
            providersBusy={providersLoading}
            providersBlockedReason={providersBlockedReason}
          />
        )}
      </main>
    </div>
  );
}
