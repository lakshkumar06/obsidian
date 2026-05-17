import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';

import { CompiledObsidianContract } from './compiledObsidian';
import {
  ensureObsidianCallPrivateState,
  OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
} from './ensureObsidianCallPrivateState';
import { hexToBytes32 } from './obsidianBytes';
import type { MatchedPair } from './orderMatcher';

export async function executeProposeMatch(
  providers: MidnightProviders,
  contractAddress: ContractAddress,
  pair: MatchedPair,
): Promise<string> {
  await ensureObsidianCallPrivateState(providers, contractAddress);
  const buyerCommitment = hexToBytes32(pair.buyer.commitmentHex!);
  const sellerCommitment = hexToBytes32(pair.seller.commitmentHex!);
  const assetId = hexToBytes32(pair.buyer.assetIdHex!);

  const finalized = await submitCallTx(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
    circuitId: 'propose_match',
    args: [
      buyerCommitment,
      sellerCommitment,
      pair.buyerMax,
      pair.sellerMin,
      assetId,
      assetId,
    ],
  } as never);

  return String(finalized.public.txId ?? finalized.public.status);
}

export async function executeAtomicSettle(
  providers: MidnightProviders,
  contractAddress: ContractAddress,
  buyerCommitmentHex: string,
  sellerCommitmentHex: string,
  compliancePayload?: string,
): Promise<string> {
  await ensureObsidianCallPrivateState(providers, contractAddress);
  const payload =
    compliancePayload ?? `enc:audit:auto:${buyerCommitmentHex.slice(0, 16)}:${Date.now()}`;

  const finalized = await submitCallTx(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: OBSIDIAN_BROWSER_PRIVATE_STATE_ID,
    circuitId: 'atomic_settle',
    args: [hexToBytes32(buyerCommitmentHex), hexToBytes32(sellerCommitmentHex), payload],
  } as never);

  return String(finalized.public.txId ?? finalized.public.status);
}
