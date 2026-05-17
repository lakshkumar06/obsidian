import type { OrderRow } from './types';

/** Shared dev relayer (`yarn relayer`) — one intent pool for all browser tabs. */
export function relayerHttpBase(): string {
  const fromEnv = import.meta.env.VITE_RELAYER_HTTP?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return new URL('/relayer', window.location.origin).href.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:3033';
}

export async function registerOrderWithRelayer(order: OrderRow): Promise<void> {
  if (!order.commitmentHex || !order.assetIdHex || !order.boundPrice) {
    return;
  }
  const body: Record<string, string> = {
    commitmentHex: order.commitmentHex,
    assetIdHex: order.assetIdHex,
    side: order.side,
  };
  if (order.side === 'BUY') {
    body.maxPrice = order.boundPrice;
  } else {
    body.minPrice = order.boundPrice;
  }

  const base = relayerHttpBase();
  try {
    const res = await fetch(`${base}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      console.warn('[Obsidian] relayer intent register failed', err.error ?? res.status);
      return;
    }
    console.info('[Obsidian] registered intent with relayer', order.commitmentHex.slice(0, 16));
  } catch {
    console.warn('[Obsidian] relayer not reachable at', base, '— run `yarn relayer` for shared matching');
  }
}

export async function fetchRelayerActivity(limit = 100): Promise<unknown[]> {
  const base = relayerHttpBase();
  try {
    const res = await fetch(`${base}/activity?limit=${limit}`);
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { events?: unknown[] };
    return data.events ?? [];
  } catch {
    return [];
  }
}
