# Obsidian core (Midnight)

Compact contract and TypeScript harness for an Obsidian-style dark pool flow on Midnight local devnet: `submit_order`, `propose_match`, and `atomic_settle`.

All paths below are relative to this directory (`core/`).

## Prerequisites

- Node.js 22+
- Yarn 1.x
- Docker (for local devnet and proof server)

## Setup

```bash
yarn install
```

## Contract

Source: [`contracts/obsidian.compact`](contracts/obsidian.compact).

Compile (from `contracts/`):

```bash
cd contracts
compact compile obsidian.compact managed/obsidian
```

Generated artifacts live under `contracts/managed/obsidian/` (ignored by git; regenerate after pulling).

## Local environment

From this directory:

```bash
yarn env:up
```

Keep this running. Start the proof server and local node as provided by the compose setup.

## Off-chain matching relayer

Indexer-driven coordinator: [`src/matching_relayer.ts`](src/matching_relayer.ts). Runnable daemon: [`src/matching_relayer_daemon.ts`](src/matching_relayer_daemon.ts).

Set `OBSIDIAN_CONTRACT_ADDRESS` in **`../.env`** (see `../.env.example`), then from repo root or **`core/`**:

```bash
yarn relayer
```

The relayer script loads `../.env` via `node --env-file`. Override inline if needed:

```bash
OBSIDIAN_CONTRACT_ADDRESS="<hex>" yarn relayer
```

Use `RELAYER_SEED`, `OBSIDIAN_RELAYER_PRIVATE_STATE_ID`, and `LOG_LEVEL` as needed. Register cleartext legs with `MatchingRelayer.registerLocalIntent`. See [`backend/README.md`](../backend/README.md).

## Demo web UI

The React demo lives next to this folder: [`../frontend/`](../frontend/). From the **repository root**:

```bash
yarn frontend:dev
```

Then open http://localhost:5173 . Configure `OBSIDIAN_CONTRACT_ADDRESS` in `../.env` so the UI pre-fills the contract. Build: `yarn frontend:build`. Details: [`../frontend/README.md`](../frontend/README.md).

## Live contract demo (manual)

Runs the **real** Compact state machine via Node (proof server + wallet SDK), aligned with [`src/test/obsidian.test.ts`](src/test/obsidian.test.ts):

```bash
yarn demo:contracts
```

Run from **`core/`** — or use **`yarn demo:contracts`** from the **repository root** (delegates to `core`). Requires Docker devnet (`yarn env:up`).

The script deploys a **new** contract, runs `submit_order` twice, intentionally fails `propose_match` (`TRADING_ASSET_MISMATCH`), then succeeds `propose_match` → `atomic_settle`, and prints **`OBSIDIAN_CONTRACT_ADDRESS=…`** for the **[matching relayer](src/matching_relayer_daemon.ts)**.

### Submit a crossing BUY + SELL on an existing contract (terminal)

Uses `OBSIDIAN_CONTRACT_ADDRESS` from `../.env` (same as the UI). No Lace — the Node test wallet signs all txs.

```bash
# from obsidian/ monorepo root (after env:up and .env has contract address)
yarn demo:submit-pair

# Only create the two orders (queued on-chain), no match/settle:
yarn demo:submit-pair --orders-only

# SELL first, then BUY (same order you tested in the browser):
yarn demo:submit-pair --sell-first
```

Optional env: `CLI_ASSET=wETH`, `CLI_PRICE=2`, `CLI_SEED=…`, `LOG_LEVEL=debug`.

Optional env: **`DEMO_SEED`**, **`DEMO_PRIVATE_STATE_ID`**.

## Tests

With devnet up:

```bash
yarn test:local
```

This runs [`src/test/obsidian.test.ts`](src/test/obsidian.test.ts) against the local network.

## References

- [Midnight docs — Hello World / getting started](https://docs.midnight.network/getting-started/hello-world) (tooling baseline for this repo)
