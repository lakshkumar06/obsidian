import { createHash, randomBytes } from 'node:crypto';

/** Same as frontend `obsidianBytes.ts` — SHA-256 of `obsidian:asset:${symbol}`. */
export function assetIdFromSymbol(symbol: string): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update(`obsidian:asset:${symbol}`, 'utf8').digest(),
  );
}

export function randomBytes32(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`Expected 32-byte hex (64 chars), got length ${clean.length}`);
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
