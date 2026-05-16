/** Copy to midnight-local-dev/src/obsidian-fund.ts when cloning that repo. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import pino from 'pino';
import { type Config } from './config.js';
import {
  buildWalletFromHexSeed,
  closeWallet,
  displayWalletBalances,
  registerNightForDust,
  setLogger,
} from './wallet.js';
import { fundFromConfigFile, setLogger as setFundingLogger } from './funding.js';

const GENESIS_MINT_WALLET_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

class ObsidianConfig implements Config {
  logDir = path.resolve('logs', 'obsidian-fund.log');
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'http://127.0.0.1:6300';
  networkId = 'undeployed';
}

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

async function main(): Promise<void> {
  setNetworkId('undeployed');
  const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
  setLogger(logger);
  setFundingLogger(logger);

  const config = new ObsidianConfig();
  logger.info('Funding against Obsidian compose (indexer v4, undeployed)');

  const masterWallet = await buildWalletFromHexSeed(config, GENESIS_MINT_WALLET_SEED);
  await registerNightForDust(masterWallet);
  await displayWalletBalances(masterWallet, config);

  const funded = await fundFromConfigFile(masterWallet, './accounts.json', config);

  const accountsPath = path.resolve('./accounts.json');
  const raw = await fs.readFile(accountsPath, 'utf-8');
  const { accounts } = JSON.parse(raw) as { accounts: { mnemonic: string }[] };
  const mnemonic = accounts[0]?.mnemonic ?? '';

  const payload = {
    networkId: 'undeployed',
    laceProfile: 'Undeployed',
    mnemonic,
    mnemonicWarning: 'LOCAL DEV ONLY. Import into Lace Undeployed profile.',
    laceIndexer: config.indexer,
    laceIndexerWs: config.indexerWS,
    laceNode: config.node,
    accounts: funded,
  };

  const outJson = path.resolve('obsidian-funded-wallet.json');
  await fs.writeFile(outJson, `${JSON.stringify(payload, jsonReplacer, 2)}\n`, 'utf-8');
  logger.info({ outJson }, 'Wrote funded wallet JSON');

  for (const a of funded) {
    logger.info(`\n=== ${a.name} ===`);
    logger.info(`  Unshielded: ${a.unshieldedAddr}`);
    logger.info(`  Shielded:   ${a.shieldedAddr}`);
    logger.info(`  DUST:       ${a.dustAddr}`);
    logger.info(`  NIGHT:      ${a.nightBalance}`);
    logger.info(`  DUST bal:   ${a.dustBalance}`);
  }

  await closeWallet(masterWallet);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
