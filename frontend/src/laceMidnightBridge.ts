import type {
  ConnectedAPI,
  Configuration,
  WalletConnectedAPI,
} from '@midnight-ntwrk/dapp-connector-api';
import type {
  MidnightProvider,
  MidnightProviders,
  ProofProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  Transaction,
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  type TransactionId,
} from '@midnight-ntwrk/ledger-v8';
import { Buffer } from 'buffer';

import { formatMidnightError } from './formatMidnightError';
import { isLaceChannelShutdownError } from './laceSession';
import { UrlZkConfigProvider } from './urlZkConfigProvider';
import { volatilePrivateStateProvider } from './volatilePrivateStateProvider';

export type ObsidianProofMode = 'lace-wallet' | 'http-proof-server';

export type ObsidianMidnightStack = MidnightProviders & {
  proofMode: ObsidianProofMode;
  proofServerUrl?: string;
};

/** Same-origin `/zk/` subtree (filled by `yarn sync:zk`) or absolute base URL ending with /. */
export function zkArtifactsBaseHref(): string {
  if (typeof window === 'undefined') {
    return `${import.meta.env.BASE_URL}zk`;
  }
  return new URL('zk/', window.location.href).href;
}

type LaceConnected = ConnectedAPI;

export type GetLaceConnection = () => Promise<LaceConnected>;

export type LaceWalletStep = 'balance' | 'submit';

let laceWalletStepListener: ((step: LaceWalletStep, circuitHint?: string) => void) | null =
  null;

/** UI hook: count Lace popups (balance + submit per on-chain circuit). */
export function setLaceWalletStepListener(
  listener: ((step: LaceWalletStep, circuitHint?: string) => void) | null,
): void {
  laceWalletStepListener = listener;
}

function wrapLaceCall<T>(step: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    throw new Error(`Lace ${step} failed: ${formatMidnightError(err)}`, { cause: err });
  });
}

/** Lace returns balanced tx hex; deserialize for identifiers / Midnight.js types. */
function deserializeBalancedLaceTx(balancedHex: string): FinalizedTransaction {
  const raw = Buffer.from(balancedHex, 'hex');
  try {
    return Transaction.deserialize(
      'signature',
      'proof',
      'binding',
      raw,
    ) as FinalizedTransaction;
  } catch {
    const prebound = Transaction.deserialize('signature', 'proof', 'pre-binding', raw);
    return prebound.bind() as FinalizedTransaction;
  }
}

export class LaceWalletMidnightBridge implements WalletProvider, MidnightProvider {
  /** Hex from the last `balanceUnsealedTransaction` — submit this verbatim to Lace. */
  private lastBalancedTxHex: string | null = null;

  /** Lace handle used for the current balance → submit pair (refreshed per transaction). */
  private activeLace: LaceConnected | null = null;

  constructor(
    private readonly getLace: GetLaceConnection,
    private readonly coinPk: CoinPublicKey,
    private readonly encPk: EncPublicKey,
  ) {}

  getCoinPublicKey(): CoinPublicKey {
    return this.coinPk;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.encPk;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    void ttl;
    const serializedHex = Buffer.from(tx.serialize()).toString('hex');
    laceWalletStepListener?.('balance');

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const lace = await this.getLace();
      try {
        const { tx: balancedHex } = await wrapLaceCall('balanceUnsealedTransaction', () =>
          lace.balanceUnsealedTransaction(serializedHex),
        );
        this.activeLace = lace;
        this.lastBalancedTxHex = balancedHex;
        return deserializeBalancedLaceTx(balancedHex);
      } catch (err) {
        lastErr = err;
        this.activeLace = null;
        if (attempt === 0 && isLaceChannelShutdownError(err)) {
          console.warn('[Obsidian] Lace channel stale — refreshing wallet session before balance…');
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
    const ids = tx.identifiers();
    const first = ids[0];
    if (first === undefined) {
      throw new Error('Transaction identifiers missing before Lace submit');
    }

    const hexToSubmit = this.lastBalancedTxHex ?? Buffer.from(tx.serialize()).toString('hex');
    this.lastBalancedTxHex = null;

    laceWalletStepListener?.('submit');

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const lace = this.activeLace ?? (await this.getLace());
      try {
        await wrapLaceCall('submitTransaction', () => lace.submitTransaction(hexToSubmit));
        this.activeLace = null;
        return first;
      } catch (err) {
        lastErr = err;
        this.activeLace = null;
        if (attempt === 0 && isLaceChannelShutdownError(err)) {
          console.warn('[Obsidian] Lace channel stale — refreshing wallet session before submit…');
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}

async function probeSubmitOrderProverKey(baseHref: string): Promise<void> {
  const root = baseHref.replace(/\/+$/, '');
  const url = `${root}/keys/submit_order.prover`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Missing ZK proving key (${res.status}) at ${url} — run \`yarn sync:zk\` in frontend/, then reload.`,
    );
  }
}

/** Dev: Vite proxies `/midnight-proof` → local proof-server (see vite.config.ts). */
function defaultProofServerBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_PROOF_SERVER?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return new URL('/midnight-proof', window.location.origin).href.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:6300';
}

function resolveProofServerBaseUrl(cfg: Configuration): string {
  const laceUri = cfg.proverServerUri?.trim();
  if (laceUri) {
    return laceUri.replace(/\/+$/, '');
  }
  return defaultProofServerBaseUrl();
}

async function createProofProviderForLace(
  lace: LaceConnected,
  zkConfigProvider: UrlZkConfigProvider,
  cfg: Configuration,
): Promise<{ proofProvider: ProofProvider; proofMode: ObsidianProofMode; proofServerUrl?: string }> {
  if (typeof lace.getProvingProvider === 'function') {
    const ledgerProving = await lace.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
    return { proofProvider: createProofProvider(ledgerProving), proofMode: 'lace-wallet' };
  }

  const proofServerUrl = resolveProofServerBaseUrl(cfg);
  return {
    proofProvider: httpClientProofProvider(proofServerUrl, zkConfigProvider),
    proofMode: 'http-proof-server',
    proofServerUrl,
  };
}

/**
 * Lace balance/submit + indexer from Lace settings.
 * Proving: wallet `getProvingProvider` when present, else HTTP proof-server (same as `yarn demo:contracts` harness).
 */
export async function buildObsidianMidnightProviders(
  getLace: GetLaceConnection,
  addresses: {
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
    shieldedAddress: string;
  },
  opts?: {
    zkBaseHref?: string;
  },
): Promise<ObsidianMidnightStack> {
  const lace = await getLace();
  const hintMethods: Array<keyof WalletConnectedAPI> = [
    'getConfiguration',
    'getShieldedAddresses',
    'balanceUnsealedTransaction',
    'submitTransaction',
  ];
  if (typeof lace.getProvingProvider === 'function') {
    hintMethods.push('getProvingProvider');
  }
  if (typeof lace.hintUsage === 'function') {
    await lace.hintUsage(hintMethods);
  }

  const cfg = await lace.getConfiguration();
  setNetworkId(cfg.networkId);

  const zkBase = opts?.zkBaseHref ?? zkArtifactsBaseHref();
  await probeSubmitOrderProverKey(zkBase);

  const zkConfigProvider = new UrlZkConfigProvider(zkBase);
  const { proofProvider, proofMode, proofServerUrl } = await createProofProviderForLace(
    lace,
    zkConfigProvider,
    cfg,
  );

  if (proofMode === 'http-proof-server') {
    console.info(
      '[Obsidian] Lace has no getProvingProvider — using HTTP proof server at',
      proofServerUrl,
      '(run `yarn env:up` in core/ if proofs fail)',
    );
  }

  const bridge = new LaceWalletMidnightBridge(
    getLace,
    addresses.shieldedCoinPublicKey as CoinPublicKey,
    addresses.shieldedEncryptionPublicKey as EncPublicKey,
  );

  const wsCtor =
    typeof globalThis.WebSocket !== 'undefined' ? globalThis.WebSocket : undefined;

  return {
    privateStateProvider: volatilePrivateStateProvider(),
    publicDataProvider: wsCtor
      ? indexerPublicDataProvider(cfg.indexerUri, cfg.indexerWsUri, wsCtor)
      : indexerPublicDataProvider(cfg.indexerUri, cfg.indexerWsUri),
    zkConfigProvider,
    proofProvider,
    walletProvider: bridge,
    midnightProvider: bridge,
    proofMode,
    proofServerUrl,
  };
}
