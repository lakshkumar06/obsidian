/**
 * CLI harness: submit BUY + SELL on an existing Obsidian contract, then auto-run
 * propose_match → atomic_settle (no Lace — Node wallet signs everything).
 *
 * Mirrors the browser trader flow for local testing.
 *
 * Prerequisites:
 *   yarn env:up   (from obsidian/ monorepo root)
 *   OBSIDIAN_CONTRACT_ADDRESS in ../.env (from yarn deploy:contracts or your deploy)
 *
 * Usage (from core/):
 *   yarn submit:pair
 *   yarn submit:pair --orders-only     # only submit_order ×2 (leave queued)
 *   yarn submit:pair --sell-first      # SELL then BUY
 *
 * Env:
 *   CLI_SEED — wallet seed (required)
 *   CLI_ASSET — asset symbol (required)
 *   CLI_PRICE — bound price uint64 (required)
 *   OBSIDIAN_CONTRACT_ADDRESS — required
 */
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
import { buildProviders, type ObsidianProviders } from './providers.js';
import {
  assetIdFromSymbol,
  bytesToHex,
  parseLimitPriceToUint64,
  randomBytes32,
} from './obsidian_bytes.js';
import { ensureObsidianCallPrivateState } from './ensure_obsidian_private_state.js';
import { CompiledObsidianContract, ledger, zkConfigPath } from '../contracts/index.js';

// @ts-expect-error WebSocket global for indexer subscriptions
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
const PRIVATE_STATE_ID =
  process.env['CLI_PRIVATE_STATE_ID']?.trim() || 'CliObsidianCrossingPair';

const argv = new Set(process.argv.slice(2));
const ordersOnly = argv.has('--orders-only');
const sellFirst = argv.has('--sell-first');

type Leg = {
  side: 'BUY' | 'SELL';
  commitment: Uint8Array;
  nullifier: Uint8Array;
  commitmentHex: string;
  nullifierHex: string;
};

function relayerJson(leg: Leg, assetIdHex: string, boundPrice: bigint): object {
  if (leg.side === 'BUY') {
    return {
      commitmentHex: leg.commitmentHex,
      assetIdHex,
      side: 'BUY',
      maxPrice: boundPrice.toString(),
    };
  }
  return {
    commitmentHex: leg.commitmentHex,
    assetIdHex,
    side: 'SELL',
    minPrice: boundPrice.toString(),
  };
}

async function queryLedger(
  providers: ObsidianProviders,
  contractAddress: ContractAddress,
) {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (state === null) {
    throw new Error('Contract state unavailable — is docker compose up and indexer synced?');
  }
  return ledger(state.data);
}

function printLegStatus(
  label: string,
  leg: Leg,
  L: ReturnType<typeof ledger>,
  buyerAnchor: string,
): void {
  const active = L.order_commitments.member(leg.commitment);
  const matched = L.match_log.member(leg.commitment);
  const isBuyerAnchor = leg.commitmentHex === buyerAnchor;
  const audit =
    isBuyerAnchor && L.audit_ciphertexts.member(leg.commitment)
      ? L.audit_ciphertexts.lookup(leg.commitment)
      : null;

  console.log(`  ${label} (${leg.side}) ${leg.commitmentHex.slice(0, 16)}…`);
  console.log(`    order_commitments: ${active ? 'active' : 'cleared'}`);
  console.log(`    match_log (buyer anchor only): ${matched ? 'matched' : '—'}`);
  if (audit) {
    console.log(`    audit_ciphertexts: ${audit}`);
  }
}

async function submitOrder(
  providers: ObsidianProviders,
  contractAddress: ContractAddress,
  leg: Leg,
): Promise<void> {
  await ensureObsidianCallPrivateState(providers, contractAddress, PRIVATE_STATE_ID);
  logger.info({ side: leg.side, commitmentHex: leg.commitmentHex }, 'submit_order');
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'submit_order',
    args: [leg.commitment, leg.nullifier],
  });
}

async function main(): Promise<void> {
  const contractAddress = process.env['OBSIDIAN_CONTRACT_ADDRESS']?.trim();
  if (!contractAddress) {
    logger.error('Set OBSIDIAN_CONTRACT_ADDRESS in obsidian/.env');
    process.exit(1);
  }

  const seed = requireEnv('CLI_SEED');
  const assetSymbol = requireEnv('CLI_ASSET');
  const priceStr = requireEnv('CLI_PRICE');
  const boundPrice = parseLimitPriceToUint64(priceStr);
  const assetId = assetIdFromSymbol(assetSymbol);
  const assetIdHex = bytesToHex(assetId);

  const config = getConfig();
  setNetworkId(config.networkId);

  logger.info(
    {
      contractAddress,
      assetSymbol,
      assetIdHex,
      boundPrice: boundPrice.toString(),
      ordersOnly,
      sellFirst,
    },
    'CLI crossing pair — starting',
  );

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

  const wallet = await MidnightWalletProvider.build(logger, envConfig, seed);
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 600_000);
  const providers = buildProviders(wallet, zkConfigPath, config);
  const addr = contractAddress as ContractAddress;

  const buyLeg: Leg = {
    side: 'BUY',
    commitment: randomBytes32(),
    nullifier: randomBytes32(),
    commitmentHex: '',
    nullifierHex: '',
  };
  const sellLeg: Leg = {
    side: 'SELL',
    commitment: randomBytes32(),
    nullifier: randomBytes32(),
    commitmentHex: '',
    nullifierHex: '',
  };
  buyLeg.commitmentHex = bytesToHex(buyLeg.commitment);
  buyLeg.nullifierHex = bytesToHex(buyLeg.nullifier);
  sellLeg.commitmentHex = bytesToHex(sellLeg.commitment);
  sellLeg.nullifierHex = bytesToHex(sellLeg.nullifier);

  const first = sellFirst ? sellLeg : buyLeg;
  const second = sellFirst ? buyLeg : sellLeg;

  console.log('');
  console.log('── Relayer intent JSON (first leg) ──');
  console.log(JSON.stringify(relayerJson(first, assetIdHex, boundPrice), null, 2));
  console.log('');

  await submitOrder(providers, addr, first);
  let L = await queryLedger(providers, addr);
  printLegStatus('First leg', first, L, buyLeg.commitmentHex);
  console.log('');

  console.log('── Relayer intent JSON (second leg) ──');
  console.log(JSON.stringify(relayerJson(second, assetIdHex, boundPrice), null, 2));
  console.log('');

  await submitOrder(providers, addr, second);
  L = await queryLedger(providers, addr);
  printLegStatus('First leg', first, L, buyLeg.commitmentHex);
  printLegStatus('Second leg', second, L, buyLeg.commitmentHex);
  console.log('');

  if (ordersOnly) {
    console.log('── orders-only: both legs on-chain, not matched ──');
    console.log('Run without --orders-only to auto propose_match + atomic_settle.');
    await wallet.stop();
    return;
  }

  const buyer = buyLeg;
  const seller = sellLeg;
  const compliance = `enc:audit:cli:${Date.now()}`;

  logger.info(
    {
      buyer: buyer.commitmentHex,
      seller: seller.commitmentHex,
      buyerMax: boundPrice.toString(),
      sellerMin: boundPrice.toString(),
      assetIdHex,
    },
    'propose_match',
  );

  await ensureObsidianCallPrivateState(providers, addr, PRIVATE_STATE_ID);
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress: addr,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'propose_match',
    args: [
      buyer.commitment,
      seller.commitment,
      boundPrice,
      boundPrice,
      assetId,
      assetId,
    ],
  });

  L = await queryLedger(providers, addr);
  if (!L.match_log.member(buyer.commitment)) {
    throw new Error('propose_match did not record buyer in match_log');
  }
  printLegStatus('After propose_match — BUY', buyer, L, buyer.commitmentHex);
  printLegStatus('After propose_match — SELL', seller, L, buyer.commitmentHex);
  console.log('');

  logger.info({ compliance }, 'atomic_settle');
  await ensureObsidianCallPrivateState(providers, addr, PRIVATE_STATE_ID);
  await (submitCallTx as (p: unknown, o: unknown) => Promise<unknown>)(providers, {
    compiledContract: CompiledObsidianContract,
    contractAddress: addr,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'atomic_settle',
    args: [buyer.commitment, seller.commitment, compliance],
  });

  L = await queryLedger(providers, addr);
  console.log('── Final ledger (both legs should be cleared) ──');
  printLegStatus('BUY', buyer, L, buyer.commitmentHex);
  printLegStatus('SELL', seller, L, buyer.commitmentHex);

  if (L.order_commitments.member(buyer.commitment)) {
    throw new Error('BUY commitment still active after settle — unexpected');
  }
  if (L.order_commitments.member(seller.commitment)) {
    throw new Error('SELL commitment still active after settle — unexpected');
  }

  console.log('');
  console.log('OK — full flow on chain (submit_order ×2 → propose_match → atomic_settle)');
  console.log(`Contract: ${contractAddress}`);
  console.log(`Buyer anchor: ${buyer.commitmentHex}`);
  console.log(`Seller:       ${seller.commitmentHex}`);
  console.log(`Audit:        ${compliance}`);
  console.log('');

  await wallet.stop();
}

void main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
