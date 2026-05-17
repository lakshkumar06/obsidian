# Obsidian frontend (demo UI)

React + Vite app for the Obsidian dark-pool lifecycle on Midnight local devnet.

## Run

From **repository root** (with `yarn env:up` and `.env` configured):

```bash
yarn frontend:dev
```

Or from this directory:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

ZK keys sync automatically (`predev` → `scripts/sync-zk-assets.mjs` from `core/contracts/managed/obsidian`).

## Configuration

Set in **`../.env`** at the monorepo root (loaded by Vite):

```bash
OBSIDIAN_CONTRACT_ADDRESS=<hex from yarn demo:contracts>
```

The UI pre-fills and locks the contract field when this is set.

Optional:

- `VITE_MIDNIGHT_NETWORK_ID` — must match Lace’s active Midnight network (default: `undeployed` for local Docker stack).
- `VITE_PROOF_SERVER` — override proof server URL (default: `/midnight-proof` proxy to `127.0.0.1:6300`).

## Wallet (Lace)

1. Install Lace with Midnight support (Chromium browser).
2. Configure Lace for **Undeployed** / local indexer URLs (see [Midnight local network](https://docs.midnight.network/guides/midnight-local-network)).
3. Fund **tNIGHT** and register **DUST** for fees.
4. Click **Connect wallet** — use preset **undeployed** unless your Lace profile uses another id.

**Proving:** if Lace exposes `getProvingProvider`, proofs run in-wallet; otherwise the UI uses the local HTTP proof server (same as `yarn demo:contracts`).

**Stale Lace channel:** after long proofs, if you see `midnight-wallet was shutdown`, click **Reconnect wallet** and retry.

## Views

### Trader

- Submit real `submit_order` transactions (commitment + nullifier on-chain).
- **Auto-match:** after submit, the UI scans the local queue and runs `propose_match` → `atomic_settle` when:
  - Same asset id
  - Opposite side (BUY vs SELL)
  - Buyer max price ≥ seller min price
  - Buy quantity ≤ sell quantity
- If no cross exists, the order stays **queued** until a later submit or indexer poll finds a match.
- Table polls indexer every 12s and retries matching for queued orders.
- Expand a row for commitment hex, relayer JSON, copy buttons.

### Manual override

- Collapsed **Manual override** panel for debugging (`propose_match` / `atomic_settle` without auto-match).

### Regulator

- Loads `audit_ciphertexts` from indexer only (honest supervisory surface).

## Relayer integration

After `submit_order`, copy **Relayer intent JSON** from the order detail row and register in core:

```ts
matchingRelayer.registerLocalIntent(commitmentBytes, {
  assetId, side, maxPrice?, minPrice?,
});
```

Or run `yarn relayer` with intents registered in tests/daemon.

## Build

```bash
npm run build
npm run preview
```

## Key source files

| File | Role |
|------|------|
| `src/App.tsx` | Wallet connect, env contract address, view routing |
| `src/laceMidnightBridge.ts` | Lace balance/submit + proof-server fallback |
| `src/components/TraderDashboard.tsx` | Submit + order table + polling |
| `src/components/OperatorPanel.tsx` | Match / settle circuits |
| `src/components/RegulatorPanel.tsx` | Audit ledger query |
| `src/ledgerStatus.ts` | Indexer lifecycle + SELL/BUY peer enrichment |
