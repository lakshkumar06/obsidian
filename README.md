# Obsidian

Midnight Network dark-pool prototype: blind on-chain commitments, off-chain matching, ZK-validated crosses, and atomic settlement with optional audit payloads.

| Directory | Purpose |
|-----------|---------|
| [`frontend/`](frontend/) | React + Vite demo UI (Lace wallet, trader / regulator / operator flows). |
| [`core/`](core/) | Compact contract, Vitest harness, Docker devnet, matching relayer, `yarn demo:contracts`. |
| [`backend/`](backend/) | Relayer architecture notes (implementation in `core/src/`). |

## Architecture (three on-chain steps)

1. **`submit_order`** — publishes 32-byte commitment + nullifier (no cleartext price/size on ledger).
2. **`propose_match`** — matchmaker proves compatible BUY/SELL legs (price/asset as circuit args today).
3. **`atomic_settle`** — clears commitments, writes opaque `audit_ciphertexts` (no shielded token transfer yet).

Off-chain **matching relayer** watches `order_commitments` and submits `propose_match` when local intent metadata crosses.

## Prerequisites

- Node.js 22+
- Yarn 1.x (core / root scripts)
- npm (frontend)
- Docker (local devnet + proof server)
- Lace wallet (Midnight-capable build) in a Chromium browser for the UI

## Quick start

**1. Install dependencies**

```bash
cd core && yarn install
cd ../frontend && npm install
```

**2. Local devnet (terminal 1, from repo root)**

```bash
yarn env:up
```

**3. Deploy contract and capture address (terminal 2)**

```bash
yarn demo:contracts
```

Copy the printed `OBSIDIAN_CONTRACT_ADDRESS=…` into the repo env file:

```bash
cp .env.example .env
# edit .env — set OBSIDIAN_CONTRACT_ADDRESS=<hex from demo>
```

**4. Demo UI (terminal 3)**

```bash
yarn frontend:dev
```

Open [http://localhost:5173](http://localhost:5173) → **Connect wallet** (Lace preset **undeployed**) → contract address is pre-filled from `.env`.

**5. Optional — matching relayer (terminal 4)**

```bash
yarn relayer
```

Reads `OBSIDIAN_CONTRACT_ADDRESS` from `obsidian/.env` automatically. Register intents with `MatchingRelayer.registerLocalIntent` (see [`backend/README.md`](backend/README.md)) or copy JSON from the UI order detail row.

## Environment

| Variable | Used by | Description |
|----------|---------|-------------|
| `OBSIDIAN_CONTRACT_ADDRESS` | UI (via Vite), relayer | Deployed contract hex from `yarn demo:contracts` |
| `RELAYER_SEED` | relayer | Operator wallet seed (default: test seed) |
| `OBSIDIAN_RELAYER_PRIVATE_STATE_ID` | relayer | Private state id for relayer wallet |
| `VITE_MIDNIGHT_NETWORK_ID` | frontend | Lace `connect(…)` network id override |
| `VITE_PROOF_SERVER` | frontend | Proof server URL (default: Vite proxy → `:6300`) |

Template: [`.env.example`](.env.example). **Do not commit `.env`.**

## Frontend demo (what the UI does)

- **Trader** — `submit_order` with Lace or HTTP proof-server fallback; BUY/SELL, asset id, price bounds stored for relayer matching; indexer polling for lifecycle (`active` → `matched` → `settled`).
- **Operator** — browser `propose_match` + `atomic_settle` (same stack as Vitest).
- **Regulator** — loads real `audit_ciphertexts` from indexer (no fake decrypt).

Orders persist in browser `localStorage`. See [`frontend/README.md`](frontend/README.md).

## Scripts (repo root)

| Script | Action |
|--------|--------|
| `yarn env:up` / `yarn env:down` | Docker compose (`core/compose.yml`) |
| `yarn frontend:dev` | Vite dev server on :5173 |
| `yarn frontend:build` | Production UI build |
| `yarn test:local` | Vitest on local devnet |
| `yarn demo:contracts` | Deploy + full circuit walkthrough |
| `yarn relayer` | Off-chain matching daemon |

## Tests

With devnet running:

```bash
yarn test:local
```

Canonical flow: [`core/src/test/obsidian.test.ts`](core/src/test/obsidian.test.ts).

## More detail

- [`core/README.md`](core/README.md) — contract compile, relayer, demo script
- [`frontend/README.md`](frontend/README.md) — wallet setup, UI flows, troubleshooting
- [`backend/README.md`](backend/README.md) — relayer intent pool

## References

- [Midnight local network](https://docs.midnight.network/guides/midnight-local-network)
- [Midnight Hello World](https://docs.midnight.network/getting-started/hello-world)
