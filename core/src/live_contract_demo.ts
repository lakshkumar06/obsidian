/**
 * Runs the Obsidian Compact flow on LOCAL undeployed devnet — same semantics as Vitest integration tests,
 * but as a standalone process you can watch (proof server + txs on-chain artifacts).
 *
 * Prerequisites: from repo root, `yarn env:up`; from `core/`, deps installed (`yarn install`).
 *
 * Usage:
 *   MIDNIGHT_NETWORK=local yarn deploy:contracts
 *
 * Env:
 *   WALLET_SEED — hex seed (default: same as harness tests)
 */
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
import { buildProviders } from './providers.js';
import { CompiledObsidianContract, ledger, zkConfigPath } from '../contracts/index.js';

// @ts-expect-error WebSocket global assignment for indexer subscriptions (Apollo client)
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const WALLET_SEED =
  process.env['WALLET_SEED']?.trim() ||
  '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID =
  process.env['DEPLOY_PRIVATE_STATE_ID']?.trim() || 'ObsidianDeployAlice';

const bytes32 = (value: number) => new Uint8Array(32).fill(value);

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  setNetworkId(config.networkId);

  logger.info('Deploying contract and running submit_order ×2 → propose_match → atomic_settle');

  const envConfig: EnvironmentConfiguration = {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  const wallet = await MidnightWalletProvider.build(logger, envConfig, WALLET_SEED);
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 600_000);

  const providers = buildProviders(wallet, zkConfigPath, config);

  logger.info({ indexer: config.indexer, proofServer: config.proofServer }, 'Network endpoints');

  const deployed = (await (deployContract as (p: unknown, o: unknown) => Promise<{
    deployTxData: { public: { contractAddress: ContractAddress } };
  }>)(providers, {
    compiledContract: CompiledObsidianContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
    args: [],
  })) as {
    deployTxData: { public: { contractAddress: ContractAddress } };
  };

  const contractAddress = deployed.deployTxData.public.contractAddress;
  logger.info({ contractAddress }, 'Deployed Obsidian');

  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│ Paste this when running the matching relayer (same network): │');
  console.log(`│   OBSIDIAN_CONTRACT_ADDRESS="${contractAddress}" yarn relayer  │`);
  console.log('└─────────────────────────────────────────────────────────────────┘');
  console.log('');

  async function ledgerState() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    assert(state !== null, 'Contract state unavailable from indexer — is compose up & synced?');
    return ledger(state.data);
  }

  const buyerCommitment = bytes32(5);
  const buyerNullifier = bytes32(9);
  const sellerCommitment = bytes32(6);
  const sellerNullifier = bytes32(10);
  const assetA = bytes32(12);
  const assetB = bytes32(13);
  const encryptedComplianceData = `enc:audit:local:${Date.now()}`;

  logger.info('submit_order — buyer leg');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'submit_order',
    args: [buyerCommitment, buyerNullifier],
  });

  logger.info('submit_order — seller leg');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'submit_order',
    args: [sellerCommitment, sellerNullifier],
  });

  let L = await ledgerState();
  assert(L.order_commitments.member(buyerCommitment), 'buyer commitment not on ledger');
  assert(L.order_commitments.member(sellerCommitment), 'seller commitment not on ledger');

  logger.info('propose_match — expect TRADING_ASSET_MISMATCH (different assets)');
  await expectRejected(
    (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
      compiledContract: CompiledObsidianContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'propose_match',
      args: [buyerCommitment, sellerCommitment, 100n, 80n, assetA, assetB],
    }),
    /TRADING_ASSET_MISMATCH/i,
    'asset mismatch should fail circuit',
  );

  logger.info('propose_match — success (same asset, price spread ok)');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'propose_match',
    args: [buyerCommitment, sellerCommitment, 100n, 80n, assetA, assetA],
  });

  L = await ledgerState();
  assert(L.match_log.member(buyerCommitment), 'match_log should record buyer pair hash anchor');

  logger.info('atomic_settle');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'atomic_settle',
    args: [buyerCommitment, sellerCommitment, encryptedComplianceData],
  });

  L = await ledgerState();
  assert(!L.order_commitments.member(buyerCommitment), 'buyer commitment should be consumed');
  assert(!L.order_commitments.member(sellerCommitment), 'seller commitment should be consumed');
  assert(L.audit_ciphertexts.lookup(buyerCommitment) === encryptedComplianceData, 'audit payload on ledger');

  logger.info({ encryptedComplianceData }, 'Done — full dark-pool state machine executed on undeployed');
  await wallet.stop();
}

async function expectRejected(
  promise: Promise<unknown>,
  matcher: RegExp,
  hint: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected rejection (${hint}), but succeeded`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    assert(matcher.test(msg), `${hint}: got unexpected error: ${msg}`);
  }
}

void main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
