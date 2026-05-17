import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders, PrivateStateId } from '@midnight-ntwrk/midnight-js-types';

/** Same id as TraderDashboard — must match across calls in one browser session. */
export const OBSIDIAN_BROWSER_PRIVATE_STATE_ID: PrivateStateId = 'ObsidianBrowserTrader';

/**
 * Midnight.js loads private witness state from the provider before proving.
 * Deploy seeds `{}` via `initialPrivateState`; when attaching to an existing contract
 * (e.g. address from `yarn deploy:contracts`) we must seed the same empty object once.
 */
export async function ensureObsidianCallPrivateState(
  providers: MidnightProviders,
  contractAddress: ContractAddress,
  privateStateId: PrivateStateId = OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
): Promise<void> {
  providers.privateStateProvider.setContractAddress(contractAddress);
  const existing = await providers.privateStateProvider.get(privateStateId);
  if (existing === null) {
    await providers.privateStateProvider.set(privateStateId, {});
  }
}
