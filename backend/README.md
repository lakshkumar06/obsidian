# Off-chain backend (matching relayer)

The dark pool **cannot** match on-chain because commitments are opaque. The off-chain **matching relayer** coordinates intent metadata with **public `order_commitments`** from the indexer, then submits **`propose_match`** and **`atomic_settle`**.

- **Implementation:** [`../core/src/matching_relayer.ts`](../core/src/matching_relayer.ts)
- **Daemon:** [`../core/src/matching_relayer_daemon.ts`](../core/src/matching_relayer_daemon.ts)

## Single source of truth (multi-browser dev)

| Layer | What it is |
|-------|------------|
| **On-chain ledger + indexer** | Authoritative: which commitments exist, match_log, audit |
| **`obsidian/.obsidian/activity.jsonl`** | Append-only shared event log (relayer writes; tail in terminal) |
| **Relayer HTTP `:3033`** | Shared intent pool — both browsers POST the same relayer JSON after submit |
| **Browser `localStorage`** | Per-tab order table only — **not** shared across browsers |

Run the relayer once; open two browsers; each submit auto-registers intent with the relayer (if dev server proxy is up).

```bash
# terminal 1
yarn env:up
yarn relayer

# terminal 2 — tail shared log
tail -f obsidian/.obsidian/activity.jsonl

# terminal 3 — browsers at http://localhost:5173 (each Lace wallet submits orders)
```

### Relayer HTTP API (127.0.0.1:3033)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/activity?limit=200` | Recent JSONL events (all browsers) |
| `POST` | `/intent` | Register relayer JSON body (same as UI copy-paste) |

Example:

```bash
curl -s http://127.0.0.1:3033/activity | jq '.events[-5:]'

curl -s -X POST http://127.0.0.1:3033/intent -H 'content-type: application/json' \
  -d '{"commitmentHex":"…","assetIdHex":"…","side":"BUY","maxPrice":"5"}'
```

Env: `OBSIDIAN_RELAYER_HTTP_PORT` (default `3033`), `OBSIDIAN_ACTIVITY_LOG` (default `obsidian/.obsidian/activity.jsonl`).

### Recommended two-browser flow

1. **Browser A:** Lace wallet A → submit **BUY** (only `submit_order` in browser — one Lace approval).
2. **Browser B:** Lace wallet B → submit **SELL** (only `submit_order`).
3. **Relayer** (one operator wallet): sees both intents + on-chain commitments → runs **propose_match** + **atomic_settle** (no Lace in browsers for match).
4. Both browsers: **Refresh on-chain status** or **Relayer activity** button — lifecycle from indexer, not local rows.

Disable in-browser auto-match when using relayer-only matching (optional): submit orders only and let relayer handle match/settle.

## Run

```bash
yarn relayer
```

Uses `OBSIDIAN_CONTRACT_ADDRESS` from `../.env`. `RELAYER_SEED`, `OBSIDIAN_RELAYER_PRIVATE_STATE_ID`, `LOG_LEVEL` as needed.

The UI still shows copy-paste relayer JSON per order; with `yarn relayer` running, submits also **POST `/intent` automatically** in dev.
