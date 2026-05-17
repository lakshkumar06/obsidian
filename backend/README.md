# Off-chain backend (matching relayer)

The dark pool **cannot** match on-chain because commitments are opaque. The **matching relayer** reads intent metadata + indexer `order_commitments`, then submits **`propose_match`** and **`atomic_settle`**.

- [`../core/src/matching_relayer.ts`](../core/src/matching_relayer.ts)
- [`../core/src/matching_relayer_daemon.ts`](../core/src/matching_relayer_daemon.ts)

## Run

```bash
yarn env:up
yarn relayer
```

Uses `OBSIDIAN_CONTRACT_ADDRESS` from `../.env`.

## Two-browser flow

1. **Browser A:** submit **BUY** (`submit_order` only)
2. **Browser B:** submit **SELL** (`submit_order` only)
3. **Relayer:** crossing intents → `propose_match` → `atomic_settle` (operator wallet)
4. Refresh on-chain status from the indexer in both browsers

## HTTP API (`127.0.0.1:3033`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/activity?limit=200` | Recent JSONL events |
| `POST` | `/intent` | Register order intent after submit |

Submits auto-POST `/intent` in dev when the relayer is running (Vite proxies `/relayer` → `:3033`).
