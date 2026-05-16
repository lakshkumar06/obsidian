import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

export type WalletEntry = {
  readonly key: string;
  readonly api: InitialAPI;
};

function isInitialAPI(candidate: unknown): candidate is InitialAPI {
  if (candidate === null || typeof candidate !== 'object') {
    return false;
  }
  const w = candidate as Record<string, unknown>;
  return (
    typeof w.connect === 'function' &&
    typeof w.name === 'string' &&
    typeof w.apiVersion === 'string'
  );
}

/** Every wallet that injected the DApp connector under `window.midnight.<id>`. */
export function listMidnightWalletEntries(): WalletEntry[] {
  const midnight = window.midnight;
  if (!midnight) {
    return [];
  }
  return Object.entries(midnight)
    .filter(([, api]) => isInitialAPI(api))
    .map(([key, api]) => ({ key, api }));
}

/** Prefer Lace; fall back to the only injector; otherwise first entry (caller may show a picker). */
export function pickDefaultMidnightWallet(entries: readonly WalletEntry[]): WalletEntry | null {
  if (entries.length === 0) {
    return null;
  }
  const byStableKey = entries.find((e) => e.key === 'mnLace');
  if (byStableKey) {
    return byStableKey;
  }
  const laceLike = entries.find((e) => {
    const n = `${e.api.name} ${e.api.rdns}`.toLowerCase();
    return n.includes('lace');
  });
  if (laceLike) {
    return laceLike;
  }
  if (entries.length === 1) {
    return entries[0];
  }
  return entries[0];
}
