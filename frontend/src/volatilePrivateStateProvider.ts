/**
 * Minimal in-browser PrivateStateProvider: RAM-backed, scoped via setContractAddress.
 * Export/import paths are deliberately unsupported — official providers pull Node crypto.
 */

import type { ContractAddress, SigningKey } from '@midnight-ntwrk/compact-runtime';
import type {
  ExportPrivateStatesOptions,
  ExportSigningKeysOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateProvider,
  PrivateStateId,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';

export function volatilePrivateStateProvider(): PrivateStateProvider {
  const states = new Map<string, unknown>();
  const signingKeys: Partial<Record<string, SigningKey>> = {};
  let scope: ContractAddress | null = null;

  function scopedKey(id: PrivateStateId): string {
    if (!scope) {
      throw new Error('[Obsidian UI] Private state scoped before ContractAddress set.');
    }
    return `${scope}§${id}`;
  }

  function unsupported(op: string): never {
    throw new Error(
      `${op} unsupported in volatilePrivateStateProvider (session RAM only). Desktop wallets use encrypted persistence.`,
    );
  }

  const provider: PrivateStateProvider = {
    setContractAddress(address: ContractAddress) {
      scope = address;
    },

    async set(privateStateId, state) {
      states.set(scopedKey(privateStateId), state);
    },

    async get(privateStateId) {
      const v = states.get(scopedKey(privateStateId));
      return Promise.resolve(v === undefined ? null : v);
    },

    async remove(privateStateId) {
      states.delete(scopedKey(privateStateId));
    },

    async clear() {
      if (!scope) {
        throw new Error('[Obsidian UI] clear without contract scope');
      }
      const prefix = `${scope}§`;
      for (const k of [...states.keys()]) {
        if (k.startsWith(prefix)) {
          states.delete(k);
        }
      }
      return Promise.resolve();
    },

    async setSigningKey(address, signingKey) {
      signingKeys[address] = signingKey;
    },

    async getSigningKey(address) {
      return signingKeys[address] ?? null;
    },

    async removeSigningKey(address) {
      delete signingKeys[address];
    },

    async clearSigningKeys() {
      Object.keys(signingKeys).forEach((k) => {
        delete signingKeys[k];
      });
    },

    exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      return Promise.resolve().then(() => unsupported('exportPrivateStates'));
    },

    importPrivateStates(
      _exportData: PrivateStateExport,
      _options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      return Promise.resolve().then(() => unsupported('importPrivateStates'));
    },

    exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      return Promise.resolve().then(() => unsupported('exportSigningKeys'));
    },

    importSigningKeys(
      _exportData: SigningKeyExport,
      _options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      return Promise.resolve().then(() => unsupported('importSigningKeys'));
    },
  };

  return provider;
}
