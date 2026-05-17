import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type ObsidianProviders } from '../providers.js';
import {
  CompiledObsidianContract,
  ledger,
  zkConfigPath,
} from '../../contracts/index.js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const ALICE_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';
const ALICE_PRIVATE_STATE_ID = 'AlicePrivateObsidianState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const bytes32 = (value: number) => new Uint8Array(32).fill(value);

describe('Obsidian Contract', () => {
  let aliceWallet: MidnightWalletProvider;
  let aliceProviders: ObsidianProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();

  async function queryLedger(providers: ObsidianProviders) {
    const state =
      await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  beforeAll(async () => {
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

    aliceWallet = await MidnightWalletProvider.build(logger, envConfig, ALICE_SEED!);
    await aliceWallet.start();
    await syncWallet(logger, aliceWallet.wallet, 600_000);

    aliceProviders = buildProviders(aliceWallet, zkConfigPath, config);
    logger.info(`Providers initialized. Ready to test!`);
  });

  afterAll(async () => {
    if (aliceWallet) {
      logger.info('Stopping Alice wallet...');
      await aliceWallet.stop();
    }
  });

  it('Deploys the contract', async () => {
    logger.info(`Creating private state...`);

    const deployed: any = await (deployContract as any)(aliceProviders, {
      compiledContract: CompiledObsidianContract,
      privateStateId: ALICE_PRIVATE_STATE_ID,
      initialPrivateState: {},
      args: [],
    });

    logger.info(`Setting the contract address...`);
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    const state = await queryLedger(aliceProviders);
    expect(state.order_commitments.size()).toEqual(0n);
    expect(state.nullifiers.size()).toEqual(0n);
    expect(state.match_log.size()).toEqual(0n);
    expect(state.audit_ciphertexts.size()).toEqual(0n);
  });

  it('Executes submit_order, propose_match, and atomic_settle', async () => {
    const buyerCommitment = bytes32(5);
    const buyerNullifier = bytes32(9);
    const sellerCommitment = bytes32(6);
    const sellerNullifier = bytes32(10);
    const assetA = bytes32(12);
    const assetB = bytes32(13);
    const encryptedComplianceData = 'enc:audit:buyer-5:seller-6';

    await (submitCallTx as any)(aliceProviders, {
      compiledContract: CompiledObsidianContract,
      contractAddress,
      privateStateId: ALICE_PRIVATE_STATE_ID,
      circuitId: 'submit_order',
      args: [buyerCommitment, buyerNullifier],
    });

    await (submitCallTx as any)(aliceProviders, {
      compiledContract: CompiledObsidianContract,
      contractAddress,
      privateStateId: ALICE_PRIVATE_STATE_ID,
      circuitId: 'submit_order',
      args: [sellerCommitment, sellerNullifier],
    });

    await expect((submitCallTx as any)(aliceProviders, {
      compiledContract: CompiledObsidianContract,
      contractAddress,
      privateStateId: ALICE_PRIVATE_STATE_ID,
      circuitId: 'propose_match',
      args: [buyerCommitment, sellerCommitment, 100n, 80n, assetA, assetB],
    })).rejects.toThrow('TRADING_ASSET_MISMATCH');

    await (submitCallTx as any)(aliceProviders, {
      compiledContract: CompiledObsidianContract,
      contractAddress,
      privateStateId: ALICE_PRIVATE_STATE_ID,
      circuitId: 'propose_match',
      args: [buyerCommitment, sellerCommitment, 100n, 80n, assetA, assetA],
    });

    let state = await queryLedger(aliceProviders);
    expect(state.match_log.member(buyerCommitment)).toBe(true);

    await (submitCallTx as any)(aliceProviders, {
      compiledContract: CompiledObsidianContract,
      contractAddress,
      privateStateId: ALICE_PRIVATE_STATE_ID,
      circuitId: 'atomic_settle',
      args: [buyerCommitment, sellerCommitment, encryptedComplianceData],
    });

    state = await queryLedger(aliceProviders);
    expect(state.order_commitments.member(buyerCommitment)).toBe(false);
    expect(state.order_commitments.member(sellerCommitment)).toBe(false);
    expect(state.audit_ciphertexts.lookup(buyerCommitment)).toEqual(encryptedComplianceData);
  });
});
