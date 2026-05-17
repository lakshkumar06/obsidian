import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/ledger-v8';
import {
  type MidnightProvider,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { type WalletFacade, type FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
  ) {
    this.wallet = wallet;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnboundTransaction,
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );
    return await this.wallet.finalizeRecipe(recipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    seed: string,
  ): Promise<MidnightWalletProvider> {
    const isPreprod = env.networkId === 'preprod';
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      // Preprod deploy txs need higher fee headroom (Midnight deploy guide).
      additionalFeeOverhead: isPreprod ? 300_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };

    const builder = FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions);

    const buildResult = await builder.withSeed(seed).buildWithoutStarting();
    const { wallet, seeds } = buildResult as {
      wallet: WalletFacade;
      seeds: {
        masterSeed: string;
        shielded: Uint8Array;
        dust: Uint8Array;
      };
    };

    logger.info(`Wallet built from seed: ${seeds.masterSeed.slice(0, 8)}...`);

    return new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
    );
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

export type SyncWalletFlags = {
  shielded: boolean;
  unshielded: boolean;
  dust: boolean;
  isSynced: boolean;
};

export function syncWalletFlags(state: FacadeState): SyncWalletFlags {
  const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
  const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
  const dust = isProgressStrictlyComplete(state.dust.state.progress);
  return { shielded, unshielded, dust, isSynced: state.isSynced };
}

export type SyncWalletOptions = {
  timeoutMs?: number;
  /** Throttle progress logs (avoids OOM on chatty preprod indexer streams). */
  logThrottleMs?: number;
};

function formatSyncTimeoutError(
  last: FacadeState | undefined,
  emissionCount: number,
  timeoutMs: number,
  networkId?: string,
): string {
  const flags = last ? syncWalletFlags(last) : null;
  const progress = flags
    ? `shielded=${flags.shielded}, unshielded=${flags.unshielded}, dust=${flags.dust}`
    : 'no state received';
  const lines = [
    `Wallet sync timed out after ${timeoutMs}ms (${emissionCount} state emissions).`,
    `Last progress: ${progress}.`,
  ];
  if (networkId === 'preprod') {
    lines.push(
      'Preprod deploy needs a funded wallet with DUST (gas):',
      '1. Fund tNight — https://faucet.preprod.midnight.network/',
      '2. Register unshielded UTXOs for DUST (see https://docs.midnight.network/guides/deploy-mn-app)',
      '3. Wait until shielded + dust sync complete, then re-run yarn deploy:preprod',
      'Optional: WALLET_SYNC_TIMEOUT_MS=300000 for a longer wait.',
    );
  }
  return lines.join('\n');
}

/** @param optionsOrTimeoutMs number kept for call sites that pass timeout only */
export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  optionsOrTimeoutMs: SyncWalletOptions | number = {},
): Promise<FacadeState> {
  const options: SyncWalletOptions =
    typeof optionsOrTimeoutMs === 'number'
      ? { timeoutMs: optionsOrTimeoutMs }
      : optionsOrTimeoutMs;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const logThrottleMs = options.logThrottleMs ?? 5_000;
  const networkId = process.env['MIDNIGHT_NETWORK']?.trim();

  logger.info({ timeoutMs, logThrottleMs }, 'Syncing wallet...');
  let emissionCount = 0;
  let lastState: FacadeState | undefined;

  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        lastState = state;
      }),
      Rx.throttleTime(logThrottleMs, undefined, { leading: true, trailing: true }),
      Rx.tap((state: FacadeState) => {
        const flags = syncWalletFlags(state);
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${flags.shielded}, unshielded=${flags.unshielded}, dust=${flags.dust}, isSynced=${flags.isSynced}`,
        );
      }),
      Rx.filter((state: FacadeState) => state.isSynced),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeoutMs,
        with: () =>
          Rx.throwError(() =>
            new Error(formatSyncTimeoutError(lastState, emissionCount, timeoutMs, networkId)),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
}