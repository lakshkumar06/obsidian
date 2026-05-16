import * as CompiledContract from '@midnight-ntwrk/compact-js/effect/CompiledContract';

import { Contract } from '@obsidian/managed-contract';

/**
 * Mirrors core/contracts/index.ts — file paths are meaningless in-browser; zk lives under /zk (UrlZkConfigProvider).
 */
export const CompiledObsidianContract = CompiledContract.make('ObsidianContract', Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets('/zk'),
);
