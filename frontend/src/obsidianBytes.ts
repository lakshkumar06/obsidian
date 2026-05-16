/** Stable 32-byte asset id for circuit args (same symbol → same bytes on every session). */
export async function assetIdFromSymbol(symbol: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(`obsidian:asset:${symbol}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(digest);
}

export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`Expected 32-byte hex (64 chars), got length ${clean.length}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function parseLimitPriceToUint64(price: string): bigint {
  const trimmed = price.trim();
  if (trimmed.length === 0) {
    throw new Error('Limit price is required');
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Limit price must be a non-negative number');
  }
  return BigInt(Math.floor(n));
}
