# Off-chain backend (matching relayer)

The dark pool **cannot** match on-chain because commitments are opaque. The off-chain **matching relayer** coordinates intent metadata (learned via side channels — for example P2P) with **public `order_commitments`** from the indexer, then submits **`propose_match`** when BUY/SELL legs cross.

- **Implementation:** [`../core/src/matching_relayer.ts`](../core/src/matching_relayer.ts) — `MatchingRelayer` class (indexer-driven).
- **Runnable daemon:** [`../core/src/matching_relayer_daemon.ts`](../core/src/matching_relayer_daemon.ts).

Run after local devnet is up (`yarn env:up` from the repository root) and `OBSIDIAN_CONTRACT_ADDRESS` is set in **`../.env`** (from `yarn demo:contracts`):

```bash
yarn relayer
```

From repo root or `cd core && yarn relayer`. The script reads `../.env` automatically.

Use `RELAYER_SEED`, `OBSIDIAN_RELAYER_PRIVATE_STATE_ID`, and `LOG_LEVEL` as documented in the daemon file header.

Register cleartext intents from your side channel via `matchingRelayer.registerLocalIntent(commitmentBytes, { assetId, side, maxPrice?, minPrice? })` before or after corresponding `submit_order` transactions finalize.

The **browser UI** shows copy-paste relayer JSON per order (commitment hex, asset id hash, side, price bound) in the trader order detail row.
