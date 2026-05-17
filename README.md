# Obsidian

Midnight Network dark-pool prototype: blind on-chain commitments, off-chain matching, ZK-validated crosses, and atomic settlement with optional audit payloads.

| Directory | Purpose |
|-----------|---------|
| [`frontend/`](frontend/) | React + Vite demo UI (Lace wallet, trader / regulator / operator flows). |
| [`core/`](core/) | Compact contract, Vitest harness, Docker devnet, matching relayer, CLI demos. |
| [`backend/`](backend/) | Relayer architecture and multi-browser dev guide. |

## Architecture (three on-chain steps)

1. **`submit_order`** — publishes 32-byte commitment + nullifier (no cleartext price/size on ledger).
2. **`propose_match`** — matchmaker proves compatible BUY/SELL legs (price/asset as circuit args today).
3. **`atomic_settle`** — clears commitments, writes opaque `audit_ciphertexts` (no shielded token transfer yet).

Off-chain **matching relayer** watches `order_commitments`, holds a shared intent pool, and submits `propose_match` + `atomic_settle` when legs cross.

## Single source of truth (especially with two browsers)

| Layer | Shared? | Role |
|-------|---------|------|
| **On-chain ledger + indexer** | Yes | Authoritative lifecycle |
| **`obsidian/.obsidian/activity.jsonl`** | Yes | Append-only relayer + UI event log (`tail -f` while testing) |
| **Relayer HTTP `:3033`** | Yes | Shared intent pool — browsers auto-`POST /intent` after submit in dev |
| **Browser `localStorage`** | No | Per-browser order table only |

See [`backend/README.md`](backend/README.md) for the recommended two-browser flow (each browser: `submit_order` only; relayer: match + settle).

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

**2. Local devnet (terminal 1, from this directory)**

```bash
yarn env:up
```

**3. Deploy contract and capture address (terminal 2)**

```bash
yarn demo:contracts
```

Copy the printed `OBSIDIAN_CONTRACT_ADDRESS=…` into `.env`:

```bash
cp .env.example .env
# set OBSIDIAN_CONTRACT_ADDRESS=<hex from demo>
```

**4. Demo UI (terminal 3)**

```bash
yarn frontend:dev
```

Open [http://localhost:5173](http://localhost:5173) → **Connect wallet** (Lace preset **undeployed**) → contract address is pre-filled from `.env`.

**5. Matching relayer — recommended for multi-browser demos (terminal 4)**

```bash
yarn relayer
```

In another terminal, tail the shared log:

```bash
tail -f .obsidian/activity.jsonl
```

Each browser submit registers intent at `http://127.0.0.1:3033/intent` (proxied as `/relayer` in Vite dev). When BUY + SELL cross, the relayer runs `propose_match` → `atomic_settle` with the **operator wallet** (no Lace match prompts in the browsers).

## Environment

| Variable | Used by | Description |
|----------|---------|-------------|
| `OBSIDIAN_CONTRACT_ADDRESS` | UI, relayer, CLI | Deployed contract hex |
| `RELAYER_SEED` | relayer | Operator wallet seed (default: test seed) |
| `OBSIDIAN_RELAYER_PRIVATE_STATE_ID` | relayer | Private state id for relayer wallet |
| `OBSIDIAN_RELAYER_HTTP_PORT` | relayer | Intent + activity API (default `3033`) |
| `OBSIDIAN_ACTIVITY_LOG` | relayer | JSONL path (default `.obsidian/activity.jsonl`) |
| `VITE_MIDNIGHT_NETWORK_ID` | frontend | Lace `connect(…)` network id override |
| `VITE_PROOF_SERVER` | frontend | Proof server URL (default: Vite proxy → `:6300`) |
| `VITE_RELAYER_HTTP` | frontend | Relayer base URL (default: `/relayer` in dev) |

Template: [`.env.example`](.env.example). **Do not commit `.env`.**

## Scripts (repo root)

| Script | Action |
|--------|--------|
| `yarn env:up` / `yarn env:down` | Docker compose (`core/compose.yml`) |
| `yarn frontend:dev` | Vite dev server on :5173 |
| `yarn frontend:build` | Production UI build |
| `yarn test:local` | Vitest on local devnet |
| `yarn demo:contracts` | Deploy + full circuit walkthrough |
| `yarn demo:submit-pair` | CLI: BUY + SELL + auto match/settle (no Lace) |
| `yarn relayer` | Relayer daemon + HTTP API + activity log |

From `core/`:

| Script | Action |
|--------|--------|
| `yarn match-existing <buyerHex> <sellerHex> <price> [asset]` | Match two on-chain commitments already submitted |
| `tsx src/check_commitments.ts <hex> …` | Indexer snapshot for commitment(s) |

## Frontend demo

- **Trader** — `submit_order` via Lace; optional in-browser auto-match; indexer polling; match debug log; **Relayer activity** button.
- **Operator** — manual `propose_match` + `atomic_settle` by commitment hex.
- **Regulator** — real `audit_ciphertexts` from indexer.

Orders persist in browser `localStorage` (not shared across browsers). See [`frontend/README.md`](frontend/README.md).

## Tests

With devnet running:

```bash
yarn test:local
```

Canonical flow: [`core/src/test/obsidian.test.ts`](core/src/test/obsidian.test.ts).

## More detail

- [`core/README.md`](core/README.md) — contract compile, CLI demos, relayer
- [`frontend/README.md`](frontend/README.md) — wallet setup, UI flows, troubleshooting
- [`backend/README.md`](backend/README.md) — relayer intent pool, activity log, two-browser flow

## References

- [Midnight local network](https://docs.midnight.network/guides/midnight-local-network)
- [Midnight Hello World](https://docs.midnight.network/getting-started/hello-world)
