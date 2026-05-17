import * as Rx from 'rxjs';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress, ContractState } from '@midnight-ntwrk/compact-runtime';
import type { Logger } from 'pino';

import { CompiledObsidianContract, ledger, type Ledger } from '../contracts/index.js';
import { appendActivity } from './activity_log.js';
import { ensureObsidianCallPrivateState } from './ensure_obsidian_private_state.js';
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

export function removedCommitmentKeys(
  previous: Set<string>,
  current: Set<string>,
): string[] {
  const out: string[] = [];
  for (const k of previous) {
    if (!current.has(k)) {
      out.push(k);
    }
  }
  return out;
}

/** Drop pair ids that reference a commitment no longer on-chain. */
export function pairIdsTouchingCommitment(pairIds: Iterable<string>, hex: string): string[] {
  const out: string[] = [];
  for (const id of pairIds) {
    if (id.includes(hex)) {
      out.push(id);
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

  /** Latest snapshot of active `order_commitments` keys from the indexer. */
  private activeCommitmentKeys = new Set<string>();

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
    appendActivity({
      source: 'relayer',
      type: 'intent.registered',
      commitmentHex: key,
      side: record.side,
      maxPrice: record.maxPrice?.toString(),
      minPrice: record.minPrice?.toString(),
      poolSize: this.localizedIntentPool.size,
    });
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
      this.activeCommitmentKeys = collectActiveCommitmentKeys(L.order_commitments);
      this.previousCommitmentKeys = new Set(this.activeCommitmentKeys);
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
    const removedKeys = removedCommitmentKeys(this.previousCommitmentKeys, currentKeys);
    const newKeys = newlyAddedCommitmentKeys(this.previousCommitmentKeys, currentKeys);
    this.previousCommitmentKeys = currentKeys;
    this.activeCommitmentKeys = currentKeys;

    if (removedKeys.length > 0) {
      this.pruneSettledIntents(removedKeys);
    }

    for (const commitmentHex of newKeys) {
      appendActivity({
        source: 'relayer',
        type: 'chain.commitment_added',
        commitmentHex,
        hasLocalIntent: this.localizedIntentPool.has(commitmentHex),
      });
      await this.evaluatePoolForMatches(commitmentHex);
    }
  }

  private pruneSettledIntents(removedHexes: string[]): void {
    for (const hex of removedHexes) {
      if (this.localizedIntentPool.delete(hex)) {
        this.logger.info({ commitment: hex.slice(0, 16) }, 'Removed settled intent from pool');
        appendActivity({
          source: 'relayer',
          type: 'intent.cleared',
          commitmentHex: hex,
          reason: 'settled_or_cleared_on_chain',
        });
      }
      for (const pairId of pairIdsTouchingCommitment(this.attemptedPairs, hex)) {
        this.attemptedPairs.delete(pairId);
      }
    }
  }

  private async evaluatePoolForMatches(newCommitmentHex: string): Promise<void> {
    if (!this.activeCommitmentKeys.has(newCommitmentHex)) {
      return;
    }

    const currentIntent = this.localizedIntentPool.get(newCommitmentHex);
    if (!currentIntent) {
      this.logger.debug(
        { commitment: newCommitmentHex.slice(0, 16) },
        'New on-chain commitment with no local intent metadata; skipping match',
      );
      return;
    }

    const candidates = [...this.localizedIntentPool.entries()]
      .filter(([hex]) => hex !== newCommitmentHex && this.activeCommitmentKeys.has(hex))
      .sort(([a], [b]) => b.localeCompare(a));

    for (const [poolHex, order] of candidates) {
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
      appendActivity({
        source: 'relayer',
        type: 'match.attempt',
        buyerHex,
        sellerHex,
        buyerMax: buyerMax.toString(),
        sellerMin: sellerMin.toString(),
      });

      const matched = await this.executeProposeMatch(
        hexToBytes32(buyerHex),
        hexToBytes32(sellerHex),
        buyerMax,
        sellerMin,
        buyerRecord.assetId,
        sellerRecord.assetId,
      );
      if (!matched) {
        this.attemptedPairs.delete(pairId);
        this.pruneInactiveIntents();
        continue;
      }
      await this.executeAtomicSettle(hexToBytes32(buyerHex), hexToBytes32(sellerHex));
      break;
    }
  }

  private pruneInactiveIntents(): void {
    for (const hex of [...this.localizedIntentPool.keys()]) {
      if (!this.activeCommitmentKeys.has(hex)) {
        this.localizedIntentPool.delete(hex);
      }
    }
  }

  private async executeProposeMatch(
    buyerCommitment: Uint8Array,
    sellerCommitment: Uint8Array,
    buyerMaxPrice: bigint,
    sellerMinPrice: bigint,
    buyerAsset: Uint8Array,
    sellerAsset: Uint8Array,
  ): Promise<boolean> {
    try {
      await ensureObsidianCallPrivateState(
        this.providers,
        this.contractAddress,
        this.privateStateId,
      );
      this.logger.info('Invoking zero-knowledge propose_match circuit (proof server + wallet)…');
      await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(this.providers, {
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
      appendActivity({
        source: 'relayer',
        type: 'match.propose_ok',
        buyerHex: commitmentKeyHex(buyerCommitment),
        sellerHex: commitmentKeyHex(sellerCommitment),
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, 'propose_match failed (circuit or tx rejected)');
      appendActivity({
        source: 'relayer',
        type: 'match.propose_fail',
        buyerHex: commitmentKeyHex(buyerCommitment),
        sellerHex: commitmentKeyHex(sellerCommitment),
        error: msg,
      });
      if (/RECORD_NOT_FOUND/i.test(msg)) {
        this.pruneInactiveIntents();
      }
      return false;
    }
  }

  private async executeAtomicSettle(
    buyerCommitment: Uint8Array,
    sellerCommitment: Uint8Array,
  ): Promise<boolean> {
    const buyerHex = commitmentKeyHex(buyerCommitment);
    const sellerHex = commitmentKeyHex(sellerCommitment);
    const compliance = `enc:audit:relayer:${Date.now()}`;
    try {
      await ensureObsidianCallPrivateState(
        this.providers,
        this.contractAddress,
        this.privateStateId,
      );
      this.logger.info('Invoking atomic_settle…');
      await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(this.providers, {
        compiledContract: CompiledObsidianContract,
        contractAddress: this.contractAddress,
        privateStateId: this.privateStateId,
        circuitId: 'atomic_settle',
        args: [buyerCommitment, sellerCommitment, compliance],
      });
      this.logger.info('atomic_settle transaction finalized on-chain');
      appendActivity({
        source: 'relayer',
        type: 'match.settle_ok',
        buyerHex,
        sellerHex,
        compliance,
      });
      return true;
    } catch (error) {
      this.logger.error({ error }, 'atomic_settle failed');
      appendActivity({
        source: 'relayer',
        type: 'match.settle_fail',
        buyerHex,
        sellerHex,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
