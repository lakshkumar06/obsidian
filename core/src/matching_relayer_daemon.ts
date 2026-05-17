/**
 * Long-running process: subscribe to Obsidian contract state via the indexer and run the
 * off-chain matching relayer. Requires local devnet (`yarn env:up`) and a deployed contract.
 *
 * Env:
 *   OBSIDIAN_CONTRACT_ADDRESS — contract bech32/hex from deployment (required)
 *   RELAYER_SEED — hex seed for operator wallet (required)
 *   OBSIDIAN_RELAYER_PRIVATE_STATE_ID — private state id (default: RelayerObsidianState)
 */
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import pino from 'pino';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
import { buildProviders } from './providers.js';
import { zkConfigPath } from '../contracts/index.js';
import { appendActivity, getActivityLogPath } from './activity_log.js';
import { MatchingRelayer } from './matching_relayer.js';
import { startRelayerHttpServer } from './relayer_http.js';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';

// @ts-expect-error WebSocket global assignment for Apollo/indexer subscriptions
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

async function main(): Promise<void> {
  const contractAddress = process.env['OBSIDIAN_CONTRACT_ADDRESS']?.trim();
  if (!contractAddress) {
    logger.error('Set OBSIDIAN_CONTRACT_ADDRESS to the deployed Obsidian contract address.');
    process.exit(1);
  }

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

  const seed = process.env['RELAYER_SEED']?.trim();
  if (!seed) {
    logger.error('Set RELAYER_SEED in ../.env (hex wallet seed for the matching relayer).');
    process.exit(1);
  }
  const privateStateId =
    process.env['OBSIDIAN_RELAYER_PRIVATE_STATE_ID']?.trim() || 'RelayerObsidianState';

  logger.info('Starting relayer wallet…');
  const wallet = await MidnightWalletProvider.build(logger, envConfig, seed);
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 600_000);

  const providers = buildProviders(wallet, zkConfigPath, config);
  const relayer = new MatchingRelayer(
    providers,
    contractAddress as ContractAddress,
    privateStateId,
    logger,
  );

  await relayer.startListening();

  const httpPort = Number(process.env['OBSIDIAN_RELAYER_HTTP_PORT'] ?? '3033');
  const httpServer = startRelayerHttpServer(relayer, logger, httpPort);

  appendActivity({
    source: 'relayer',
    type: 'relayer.started',
    contractAddress,
    activityLog: getActivityLogPath(),
    httpPort,
  });

  logger.info(
    { contractAddress, privateStateId, activityLog: getActivityLogPath(), httpPort },
    'Matching relayer running. Press Ctrl+C to stop.',
  );

  const shutdown = async () => {
    httpServer.close();
    relayer.stop();
    await wallet.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
