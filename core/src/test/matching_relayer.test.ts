import { describe, expect, it } from 'vitest';

import type { Ledger } from '../../contracts/index.js';
import {
  collectActiveCommitmentKeys,
  commitmentKeyHex,
  hexToBytes32,
  newlyAddedCommitmentKeys,
} from '../matching_relayer.js';

function orderMapFrom(
  pairs: readonly (readonly [number, boolean])[],
): Ledger['order_commitments'] {
  const entries = pairs.map(([v, active]) =>
    [new Uint8Array(32).fill(v), active] as [Uint8Array, boolean],
  );
  const iter = (): Iterator<[Uint8Array, boolean]> => entries[Symbol.iterator]() as Iterator<
    [Uint8Array, boolean]
  >;
  return {
    isEmpty(): boolean {
      throw new Error('not implemented');
    },
    size(): bigint {
      throw new Error('not implemented');
    },
    member(_key: Uint8Array): boolean {
      throw new Error('not implemented');
    },
    lookup(_key: Uint8Array): boolean {
      throw new Error('not implemented');
    },
    [Symbol.iterator]: iter,
  };
}

describe('matching_relayer helpers', () => {
  it('collectActiveCommitmentKeys keeps only truthy commitments', () => {
    const m = orderMapFrom([
      [1, true],
      [2, false],
      [3, true],
    ]);
    const keys = collectActiveCommitmentKeys(m);
    expect(keys.size).toBe(2);
    expect(keys.has(commitmentKeyHex(new Uint8Array(32).fill(1)))).toBe(true);
    expect(keys.has(commitmentKeyHex(new Uint8Array(32).fill(3)))).toBe(true);
    expect(keys.has(commitmentKeyHex(new Uint8Array(32).fill(2)))).toBe(false);
  });

  it('newlyAddedCommitmentKeys diffs snapshots', () => {
    const a = new Set(['aa', 'bb']);
    const b = new Set(['aa', 'bb', 'cc']);
    expect(newlyAddedCommitmentKeys(a, b)).toEqual(['cc']);
    expect(newlyAddedCommitmentKeys(b, b)).toEqual([]);
  });

  it('hexToBytes32 round-trips lowercase hex', () => {
    const original = new Uint8Array(32).fill(7);
    const hex = commitmentKeyHex(original);
    expect([...hexToBytes32(hex)]).toEqual([...original]);
  });
});
