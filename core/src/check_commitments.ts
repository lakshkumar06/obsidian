/** One-off: check on-chain status for commitment hexes passed as CLI args. */
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

import { getConfig } from './config.js';
import { ledger } from '../contracts/index.js';

// @ts-expect-error WebSocket for indexer
globalThis.WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

async function main(): Promise<void> {
  const addr = process.env['OBSIDIAN_CONTRACT_ADDRESS']?.trim();
  if (!addr) {
    throw new Error('OBSIDIAN_CONTRACT_ADDRESS required');
  }
  const hexes = process.argv.slice(2);
  if (hexes.length === 0) {
    throw new Error('Usage: tsx src/check_commitments.ts <commitmentHex> ...');
  }

  const cfg = getConfig();
  setNetworkId(cfg.networkId);
  const p = indexerPublicDataProvider(cfg.indexer, cfg.indexerWS);
  const state = await p.queryContractState(addr);
  if (!state) {
    console.log('No contract state from indexer');
    process.exit(1);
  }
  const L = ledger(state.data);
  const buyerAnchor = hexes[0] ? hexToBytes32(hexes[0]) : null;

  for (const hex of hexes) {
    const c = hexToBytes32(hex);
    let audit: string | null = null;
    if (buyerAnchor) {
      try {
        audit = L.audit_ciphertexts.lookup(buyerAnchor);
      } catch {
        audit = null;
      }
    }
    console.log(hex.slice(0, 16) + '…', {
      order_commitments: L.order_commitments.member(c),
      match_log_buyer_anchor: buyerAnchor ? L.match_log.member(buyerAnchor) : null,
      audit_on_buyer_anchor: audit,
    });
  }
}

void main();
