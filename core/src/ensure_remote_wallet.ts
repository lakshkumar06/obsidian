/**
 * Fund + DUST setup for preview / preprod CLI deploys.
 * @see https://docs.midnight.network/guides/deploy-mn-app
 */
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

import { isRemoteMidnightNetwork, type NetworkConfig } from './config.js';

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

async function waitForUnshieldedSync(
  logger: Logger,
  wallet: WalletFacade,
  timeoutMs: number,
): Promise<void> {
  logger.info('Waiting for unshielded wallet sync…');
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000, undefined, { leading: true, trailing: true }),
      Rx.tap((state) => {
        const done = isProgressStrictlyComplete(state.unshielded.progress);
        logger.info(`Unshielded sync: complete=${done}`);
      }),
      Rx.filter((state) => isProgressStrictlyComplete(state.unshielded.progress)),
      Rx.timeout({
        each: timeoutMs,
        with: () =>
          Rx.throwError(
            () => new Error(`Unshielded sync timeout after ${timeoutMs}ms`),
          ),
      }),
    ),
  );
}

export async function ensureRemoteWalletReady(
  logger: Logger,
  config: NetworkConfig,
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> {
  if (!isRemoteMidnightNetwork(config.networkId)) {
    return;
  }

  const faucetUi = config.faucet.replace(/\/api\/request-tokens$/, '/');
  const dustUi =
    config.networkId === 'preview'
      ? 'https://dust.preview.midnight.network/'
      : 'https://dust.preprod.midnight.network/';

  await waitForUnshieldedSync(logger, wallet, 120_000);

  const snapshot = await Rx.firstValueFrom(wallet.state());
  const nightTag = unshieldedToken().raw;
  const nightBalance = snapshot.unshielded.balances[nightTag] ?? 0n;
  const address = unshieldedKeystore.getBech32Address();
  console.log(`\nDeploy wallet (preview/preprod) unshielded address:\n  ${address}\n`);

  logger.info({ address, nightBalance: nightBalance.toString() }, 'Unshielded wallet ready');

  if (nightBalance === 0n) {
    throw new Error(
      `Wallet has 0 tNight on ${config.networkId}. Fund it at ${faucetUi} then re-run deploy.`,
    );
  }

  const dustNow = snapshot.dust.walletBalance(new Date());
  if (dustNow > 0n) {
    logger.info({ dustNow: dustNow.toString() }, 'DUST already available');
    return;
  }

  const nightUtxos = snapshot.unshielded.availableCoins.filter(
    (c) => !c.meta?.registeredForDustGeneration,
  );

  if (nightUtxos.length === 0) {
    throw new Error(
      `No unshielded UTXOs to register for DUST on ${config.networkId}. ` +
        `Register at ${dustUi} or wait for faucet funds to confirm.`,
    );
  }

  logger.info(
    { count: nightUtxos.length },
    'Registering unshielded UTXOs for DUST generation…',
  );

  const recipe = await wallet.registerNightUtxosForDustGeneration(
    nightUtxos,
    unshieldedKeystore.getPublicKey(),
    (payload) => unshieldedKeystore.signData(payload),
  );
  await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));

  logger.info('Waiting for DUST balance…');
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000, undefined, { leading: true, trailing: true }),
      Rx.filter((state) => state.dust.walletBalance(new Date()) > 0n),
      Rx.timeout({
        each: 120_000,
        with: () =>
          Rx.throwError(
            () =>
              new Error(
                `DUST not available after registration. Check ${dustUi} or retry deploy.`,
              ),
          ),
      }),
    ),
  );

  logger.info('DUST registration complete');
}
