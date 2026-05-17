import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders, PrivateStateId } from '@midnight-ntwrk/midnight-js-types';

/** Seed empty private state before call txs on an existing deployment (same as browser). */
export async function ensureObsidianCallPrivateState(
  providers: MidnightProviders,
  contractAddress: ContractAddress,
  privateStateId: PrivateStateId,
): Promise<void> {
  providers.privateStateProvider.setContractAddress(contractAddress);
  const existing = await providers.privateStateProvider.get(privateStateId);
  if (existing === null) {
    await providers.privateStateProvider.set(privateStateId, {});
  }
}
