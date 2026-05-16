import * as Rx from 'rxjs';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress, ContractState } from '@midnight-ntwrk/compact-runtime';
import type { Logger } from 'pino';

import { CompiledObsidianContract, ledger, type Ledger } from '../contracts/index.js';
import type { ObsidianProviders } from './providers.js';

export type LocalIntentSide = 'BUY' | 'SELL';

/** Cleartext intent correlated with an on-chain commitment hash (off-chain only). */
export type LocalIntentRecord = {
  assetId: Uint8Array;
  side: LocalIntentSide;
  /** BUY: maximum price (uint64). */
  maxPrice?: bigint;
  /** SELL: minimum acceptable price (uint64). */
  minPrice?: bigint;
};

export function commitmentKeyHex(commitment: Uint8Array): string {
  return Buffer.from(commitment).toString('hex');
}

export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`Expected 32-byte hex string, got length ${clean.length}`);
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

export function collectActiveCommitmentKeys(
  orderCommitments: Ledger['order_commitments'],
): Set<string> {
  const keys = new Set<string>();
  for (const [key, active] of orderCommitments) {
    if (active) {
      keys.add(commitmentKeyHex(key));
    }
  }
  return keys;
}

export function newlyAddedCommitmentKeys(
  previous: Set<string>,
  current: Set<string>,
): string[] {
  const out: string[] = [];
  for (const k of current) {
    if (!previous.has(k)) {
      out.push(k);
    }
  }
  return out;
}

function sortedPairId(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Off-chain “blind” matchmaker: observes `order_commitments` via the indexer, matches using a
 * local intent pool (filled out-of-band), then submits `propose_match` through the wallet.
 */
export class MatchingRelayer {
  private readonly localizedIntentPool = new Map<string, LocalIntentRecord>();

  private previousCommitmentKeys = new Set<string>();

  private readonly attemptedPairs = new Set<string>();

  private subscription?: Rx.Subscription;

  constructor(
    private readonly providers: ObsidianProviders,
    private readonly contractAddress: ContractAddress,
    private readonly privateStateId: string,
    private readonly logger: Logger,
  ) {}

  /** Register cleartext intent for a commitment that was (or will be) published on-chain. */
  registerLocalIntent(commitment: Uint8Array, record: LocalIntentRecord): void {
    const key = commitmentKeyHex(commitment);
    this.localizedIntentPool.set(key, record);
    this.logger.info({ commitment: key.slice(0, 16) }, 'Registered local intent');
    void this.evaluatePoolForMatches(key);
  }

  unregisterLocalIntent(commitment: Uint8Array): void {
    this.localizedIntentPool.delete(commitmentKeyHex(commitment));
  }

  /** Subscribe to indexer contract state; call after wallet/providers are ready. */
  async startListening(): Promise<void> {
    const initial =
      await this.providers.publicDataProvider.queryContractState(this.contractAddress);
    if (initial) {
      const L = ledger(initial.data);
      this.previousCommitmentKeys = collectActiveCommitmentKeys(L.order_commitments);
    }

    this.logger.info(
      `Obsidian blind matchmaker listening (baseline ${this.previousCommitmentKeys.size} on-chain commitment(s); indexer stream)`,
    );

    this.subscription = this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress, { type: 'latest' })
      .pipe(
        Rx.concatMap((state) =>
          Rx.from(this.handleContractState(state).catch((err: unknown) => {
            this.logger.error({ err }, 'Relayer handleContractState failed');
          })),
        ),
      )
      .subscribe({
        error: (err: unknown) => this.logger.error({ err }, 'contractStateObservable error'),
      });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  private async handleContractState(contractState: ContractState): Promise<void> {
    const L = ledger(contractState.data);
    const currentKeys = collectActiveCommitmentKeys(L.order_commitments);
    const newKeys = newlyAddedCommitmentKeys(this.previousCommitmentKeys, currentKeys);
    this.previousCommitmentKeys = currentKeys;

    for (const commitmentHex of newKeys) {
      await this.evaluatePoolForMatches(commitmentHex);
    }
  }

  private async evaluatePoolForMatches(newCommitmentHex: string): Promise<void> {
    const currentIntent = this.localizedIntentPool.get(newCommitmentHex);
    if (!currentIntent) {
      this.logger.debug(
        { commitment: newCommitmentHex.slice(0, 16) },
        'New on-chain commitment with no local intent metadata; skipping match',
      );
      return;
    }

    for (const [poolHex, order] of this.localizedIntentPool.entries()) {
      if (poolHex === newCommitmentHex) {
        continue;
      }

      const sameAsset = Buffer.from(order.assetId).equals(Buffer.from(currentIntent.assetId));
      const oppositeSide = order.side !== currentIntent.side;
      if (!sameAsset || !oppositeSide) {
        continue;
      }

      const buyerRecord = currentIntent.side === 'BUY' ? currentIntent : order;
      const sellerRecord = currentIntent.side === 'SELL' ? currentIntent : order;
      if (buyerRecord.side !== 'BUY' || sellerRecord.side !== 'SELL') {
        continue;
      }

      const buyerMax = buyerRecord.maxPrice;
      const sellerMin = sellerRecord.minPrice;
      if (buyerMax === undefined || sellerMin === undefined) {
        this.logger.warn(
          { buyer: buyerRecord.side, seller: sellerRecord.side },
          'Missing price bounds on local intent; cannot propose_match',
        );
        continue;
      }

      if (buyerMax < sellerMin) {
        this.logger.debug(
          { buyerMax: buyerMax.toString(), sellerMin: sellerMin.toString() },
          'Price spread does not cross; skip',
        );
        continue;
      }

      const buyerHex = currentIntent.side === 'BUY' ? newCommitmentHex : poolHex;
      const sellerHex = currentIntent.side === 'SELL' ? newCommitmentHex : poolHex;
      const pairId = sortedPairId(buyerHex, sellerHex);
      if (this.attemptedPairs.has(pairId)) {
        continue;
      }
      this.attemptedPairs.add(pairId);

      this.logger.info(
        {
          buyer: buyerHex.slice(0, 16),
          seller: sellerHex.slice(0, 16),
        },
        'Potential match — invoking propose_match',
      );

      const matched = await this.executeProposeMatch(
        hexToBytes32(buyerHex),
        hexToBytes32(sellerHex),
        buyerMax,
        sellerMin,
        buyerRecord.assetId,
        sellerRecord.assetId,
      );
      if (matched) {
        await this.executeAtomicSettle(hexToBytes32(buyerHex), hexToBytes32(sellerHex));
      }
      break;
    }
  }

  private async executeProposeMatch(
    buyerCommitment: Uint8Array,
    sellerCommitment: Uint8Array,
    buyerMaxPrice: bigint,
    sellerMinPrice: bigint,
    buyerAsset: Uint8Array,
    sellerAsset: Uint8Array,
  ): Promise<void> {
    try {
      this.logger.info('Invoking zero-knowledge propose_match circuit (proof server + wallet)…');
      await (submitCallTx as any)(this.providers, {
        compiledContract: CompiledObsidianContract,
        contractAddress: this.contractAddress,
        privateStateId: this.privateStateId,
        circuitId: 'propose_match',
        args: [
          buyerCommitment,
          sellerCommitment,
          buyerMaxPrice,
          sellerMinPrice,
          buyerAsset,
          sellerAsset,
        ],
      });
      this.logger.info('propose_match transaction finalized on-chain');
    } catch (error) {
      this.logger.error({ error }, 'propose_match failed (circuit or tx rejected)');
    }
  }
}
