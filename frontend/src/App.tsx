import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

import { AppHeader, type AppView } from './components/AppHeader';
import { ConnectSheet } from './components/ConnectSheet';
import { OrderHistory } from './components/OrderHistory';
import { RegulatorPanel } from './components/RegulatorPanel';
import { TraderDashboard } from './components/TraderDashboard';
import { buildObsidianMidnightProviders, type ObsidianMidnightStack } from './laceMidnightBridge';
import {
  MIDNIGHT_NETWORK_PRESETS,
  defaultMidnightNetworkId,
  isLikelyNetworkIdMismatch,
} from './networkHint';
import { resolveInitialContractAddress } from './contractAddress';
import { fetchOrdersFromRelayer } from './relayerOrders';
import type { OrderRow } from './types';
import {
  listMidnightWalletEntries,
  pickDefaultMidnightWallet,
  type WalletEntry,
} from './walletDiscovery';

async function loadDappConnector(): Promise<void> {
  await import('@midnight-ntwrk/dapp-connector-api');
}

export default function App() {
  const envDefaultNetwork = defaultMidnightNetworkId();
  const envIsPreset = MIDNIGHT_NETWORK_PRESETS.some((p) => p.id === envDefaultNetwork);

  const [view, setView] = useState<AppView>('trade');
  const [connectOpen, setConnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [shieldedBundle, setShieldedBundle] = useState<Awaited<
    ReturnType<ConnectedAPI['getShieldedAddresses']>
  > | null>(null);
  const [midnightProviders, setMidnightProviders] = useState<ObsidianMidnightStack | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [detectedWallets, setDetectedWallets] = useState<WalletEntry[]>([]);
  const [chosenWalletKey, setChosenWalletKey] = useState<string | ''>('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderPlacedVisible, setOrderPlacedVisible] = useState(false);
  const [txnLoadingVisible, setTxnLoadingVisible] = useState(false);

  const [networkPreset, setNetworkPreset] = useState<string>(() =>
    envIsPreset ? envDefaultNetwork : 'undeployed',
  );
  const [customNetworkId, setCustomNetworkId] = useState<string>(() =>
    envIsPreset ? '' : envDefaultNetwork,
  );

  const contractAddressDraft = resolveInitialContractAddress();

  const walletApiRef = useRef<InitialAPI | null>(null);
  const networkIdRef = useRef('undeployed');

  const effectiveNetworkId =
    customNetworkId.trim().length > 0 ? customNetworkId.trim() : networkPreset;

  networkIdRef.current = effectiveNetworkId;

  const getFreshLaceConnection = useCallback(async (): Promise<ConnectedAPI> => {
    const wallet = walletApiRef.current;
    if (!wallet) {
      throw new Error('Wallet not connected');
    }
    return wallet.connect(networkIdRef.current);
  }, []);

  useEffect(() => {
    void (async () => {
      const fromRelayer = await fetchOrdersFromRelayer();
      if (fromRelayer.length > 0) {
        setOrders(fromRelayer);
      }
    })();
    const timer = window.setInterval(() => {
      void fetchOrdersFromRelayer().then((rows) => {
        if (rows.length > 0) {
          setOrders((prev) => {
            const byId = new Map(prev.map((o) => [o.id, o]));
            for (const row of rows) {
              const existing = byId.get(row.id);
              byId.set(row.id, existing ? { ...row, ledgerStatus: existing.ledgerStatus, queueStatus: existing.queueStatus } : row);
            }
            return [...byId.values()];
          });
        }
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (view !== 'trade') {
      setOrderPlacedVisible(false);
    }
  }, [view]);

  useEffect(() => {
    void loadDappConnector();
    const entries = listMidnightWalletEntries();
    setDetectedWallets(entries);
    const chosen = pickDefaultMidnightWallet(entries);
    setChosenWalletKey(chosen?.key ?? '');
  }, []);

  useEffect(() => {
    if (!isConnected || !shieldedBundle) {
      setMidnightProviders(null);
      return;
    }

    let cancelled = false;
    setProvidersLoading(true);

    void (async () => {
      try {
        const built = await buildObsidianMidnightProviders(getFreshLaceConnection, shieldedBundle);
        if (!cancelled) {
          setMidnightProviders(built);
        }
      } catch (error) {
        console.error('[Obsidian] provider bootstrap failed', error);
        if (!cancelled) {
          setMidnightProviders(null);
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

  const connectWallet = async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      const entries = listMidnightWalletEntries();
      let wallet = entries.find((e) => e.key === chosenWalletKey)?.api ?? null;
      if (!wallet) {
        wallet = pickDefaultMidnightWallet(entries)?.api ?? null;
      }
      if (!wallet) {
        setWalletError('No Midnight wallet found. Install Lace and reload.');
        return;
      }

      walletApiRef.current = wallet;
      const connected = await wallet.connect(effectiveNetworkId);
      const addresses = await connected.getShieldedAddresses();
      try {
        await connected.getDustBalance();
      } catch {
        /* optional */
      }

      setShieldedBundle(addresses);
      setIsConnected(true);
      setConnectOpen(false);
    } catch (error) {
      const base = error instanceof Error ? error.message : String(error);
      walletApiRef.current = null;
      setShieldedBundle(null);
      setMidnightProviders(null);
      setIsConnected(false);
      if (isLikelyNetworkIdMismatch(base)) {
        setWalletError('Network mismatch — check Lace network matches the selected preset.');
      } else {
        setWalletError(base);
      }
    } finally {
      setConnecting(false);
    }
  };

  const heroTitle =
    view === 'trade'
      ? 'Trade privately, anytime'
      : view === 'history'
        ? 'Order history'
        : 'Audit log';

  return (
    <div className="app-root">
      <AppHeader
        view={view}
        onViewChange={setView}
        isConnected={isConnected}
        onConnectClick={() => setConnectOpen(true)}
      />

      <main
        className={`app-main${orderPlacedVisible || txnLoadingVisible ? ' app-main--order-placed' : ''}`}
      >
        {!(view === 'trade' && (orderPlacedVisible || txnLoadingVisible)) ? (
          <h1 className="hero-title">{heroTitle}</h1>
        ) : null}

        {view === 'trade' ? (
          <TraderDashboard
            orders={orders}
            setOrders={setOrders}
            midnightProviders={midnightProviders}
            contractAddressDraft={contractAddressDraft}
            providersBusy={providersLoading}
            isConnected={isConnected}
            onConnectClick={() => setConnectOpen(true)}
            onOrderPlacedVisible={setOrderPlacedVisible}
            onTxnLoadingVisible={setTxnLoadingVisible}
          />
        ) : null}

        {view === 'history' ? <OrderHistory orders={orders} /> : null}

        {view === 'regulator' ? (
          <RegulatorPanel
            midnightProviders={midnightProviders}
            contractAddressDraft={contractAddressDraft}
            providersBusy={providersLoading}
          />
        ) : null}
      </main>

      <ConnectSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnect={connectWallet}
        connecting={connecting}
        detectedWallets={detectedWallets}
        chosenWalletKey={chosenWalletKey}
        onWalletChange={setChosenWalletKey}
        networkPreset={networkPreset}
        onNetworkPresetChange={setNetworkPreset}
        customNetworkId={customNetworkId}
        onCustomNetworkIdChange={setCustomNetworkId}
        error={walletError}
      />
    </div>
  );
}
