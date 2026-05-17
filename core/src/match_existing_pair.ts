/**
 * Run propose_match + atomic_settle for two commitments already on-chain.
 *
 * Usage (from core/, with env:up and OBSIDIAN_CONTRACT_ADDRESS in ../.env):
 *   yarn match-existing \
 *     bc0ccdd53b89d02aa660b917e81dc417d30f41cc2d7e4e74e55de52e2ce2ee26 \
 *     97698b9701a6184d6b2353d27260be37c57fb5a5ecc23d221d46a4ccca9bc41f \
 *     5 wETH
 *
 * Args: <buyerCommitmentHex> <sellerCommitmentHex> <boundPrice> [assetSymbol]
 */
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
import { buildProviders } from './providers.js';
import { ensureObsidianCallPrivateState } from './ensure_obsidian_private_state.js';
import {
  assetIdFromSymbol,
  hexToBytes32,
  parseLimitPriceToUint64,
} from './obsidian_bytes.js';
import { CompiledObsidianContract, ledger, zkConfigPath } from '../contracts/index.js';

// @ts-expect-error WebSocket for indexer
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const DEFAULT_SEED =
  process.env['CLI_SEED']?.trim() ||
  '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID =
  process.env['CLI_PRIVATE_STATE_ID']?.trim() || 'CliObsidianMatchExisting';

async function main(): Promise<void> {
  const [buyerHex, sellerHex, priceStr, assetSymbol = 'wETH'] = process.argv.slice(2);
  if (!buyerHex || !sellerHex || !priceStr) {
    console.error(
      'Usage: yarn match-existing <buyerCommitmentHex> <sellerCommitmentHex> <boundPrice> [assetSymbol]',
    );
    process.exit(1);
  }

  const contractAddress = process.env['OBSIDIAN_CONTRACT_ADDRESS']?.trim();
  if (!contractAddress) {
    throw new Error('OBSIDIAN_CONTRACT_ADDRESS required in ../.env');
  }

  const buyer = hexToBytes32(buyerHex);
  const seller = hexToBytes32(sellerHex);
  const boundPrice = parseLimitPriceToUint64(priceStr);
  const assetId = assetIdFromSymbol(assetSymbol);
  const addr = contractAddress as ContractAddress;

  const config = getConfig();
  setNetworkId(config.networkId);

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

  const wallet = await MidnightWalletProvider.build(logger, envConfig, DEFAULT_SEED);
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 600_000);
  const providers = buildProviders(wallet, zkConfigPath, config);
  await ensureObsidianCallPrivateState(providers, addr, PRIVATE_STATE_ID);

  const state = await providers.publicDataProvider.queryContractState(addr);
  if (!state) {
    throw new Error('No contract state from indexer');
  }
  const L = ledger(state.data);
  console.log('Before:', {
    buyerActive: L.order_commitments.member(buyer),
    sellerActive: L.order_commitments.member(seller),
    inMatchLog: L.match_log.member(buyer),
  });

  if (!L.order_commitments.member(buyer) || !L.order_commitments.member(seller)) {
    throw new Error('Buyer or seller commitment not active on-chain — already cleared?');
  }

  logger.info('propose_match');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress: addr,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'propose_match',
    args: [buyer, seller, boundPrice, boundPrice, assetId, assetId],
  });

  const compliance = `enc:audit:cli-match:${Date.now()}`;
  logger.info('atomic_settle');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress: addr,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'atomic_settle',
    args: [buyer, seller, compliance],
  });

  const after = ledger((await providers.publicDataProvider.queryContractState(addr))!.data);
  console.log('After:', {
    buyerActive: after.order_commitments.member(buyer),
    sellerActive: after.order_commitments.member(seller),
    audit: after.audit_ciphertexts.lookup(buyer),
  });
  console.log('OK — matched', buyerHex.slice(0, 16), '↔', sellerHex.slice(0, 16));

  await wallet.stop();
}

void main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
