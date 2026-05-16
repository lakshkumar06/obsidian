/** Network id passed to `wallet.connect(...)` — must match Lace’s active Midnight profile. */
export type NetworkPresetId = (typeof MIDNIGHT_NETWORK_PRESETS)[number]['id'];

export const MIDNIGHT_NETWORK_PRESETS = [
  {
    id: 'undeployed',
    label: 'undeployed — local Docker Midnight stack (`yarn env:up` from repo)',
  },
  {
    id: 'preview',
    label: 'preview — PUBLIC testnet (common Lace default — try this if mismatch on undeployed)',
  },
  { id: 'preprod', label: 'preprod — Midnight pre-production' },
  { id: 'mainnet', label: 'mainnet' },
] as const;

export function defaultMidnightNetworkId(): string {
  const fromEnv = import.meta.env.VITE_MIDNIGHT_NETWORK_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'undeployed';
}

export function isLikelyNetworkIdMismatch(text: string): boolean {
  const t = text.toLowerCase();
  return (
    (t.includes('network') && t.includes('mismatch')) ||
    t.includes('networkid') ||
    t.includes('network id')
  );
}
