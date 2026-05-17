/**
 * Deploy Obsidian to the configured Midnight network and print the contract address.
 *
 * Local: `yarn env:up`, `DEPLOY_SEED` in ../.env, then `yarn deploy:contracts`
 * Preprod: funded wallet + DUST, proof server on :6300, then `yarn deploy:preprod`
 *   https://docs.midnight.network/guides/deploy-mn-app
 */
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
import { buildProviders } from './providers.js';
import { CompiledObsidianContract, zkConfigPath } from '../contracts/index.js';

// @ts-expect-error WebSocket global for indexer subscriptions
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

async function main(): Promise<void> {
  const seed = process.env['DEPLOY_SEED']?.trim();
  if (!seed) {
    logger.error('Set DEPLOY_SEED in ../.env (hex wallet seed for deploy).');
    process.exit(1);
  }

  const privateStateId =
    process.env['DEPLOY_PRIVATE_STATE_ID']?.trim() || 'ObsidianDeployState';

  const config = getConfig();
  setNetworkId(config.networkId);

  const envConfig: EnvironmentConfiguration = {
    walletNetworkId: config.walletNetworkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  if (config.networkId === 'preprod') {
    logger.info(
      {
        faucet: config.faucet,
        proofServer: config.proofServer,
      },
      'Preprod deploy — fund wallet at faucet and ensure proof server is running',
    );
  }

  const wallet = await MidnightWalletProvider.build(logger, envConfig, seed);
  await wallet.start();

  const syncTimeoutMs =
    config.networkId === 'preprod'
      ? Number(process.env['WALLET_SYNC_TIMEOUT_MS'] ?? 180_000)
      : 600_000;

  await syncWallet(logger, wallet.wallet, {
    timeoutMs: syncTimeoutMs,
    logThrottleMs: config.networkId === 'preprod' ? 5_000 : 2_000,
  });

  const providers = buildProviders(wallet, zkConfigPath, config);

  logger.info('Deploying Obsidian contract…');
  const deployed = await (deployContract as (p: unknown, o: unknown) => Promise<{
    deployTxData: { public: { contractAddress: ContractAddress } };
  }>)(providers, {
    compiledContract: CompiledObsidianContract,
    privateStateId,
    initialPrivateState: {},
    args: [],
  });

  const contractAddress = deployed.deployTxData.public.contractAddress;
  logger.info({ contractAddress }, 'Obsidian deployed');
  console.log('\nOBSIDIAN_CONTRACT_ADDRESS=' + contractAddress);
  console.log('Add the line above to obsidian/.env\n');

  await wallet.stop();
}

void main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
