# Obsidian

Obsidian is an over-the-counter dark pool that uses zero-knowledge proofs to hide order details. When a user submits an order, it shows up on the block explorer as a blind 32-byte hash instead of cleartext. An off-chain matchmaker couples buyers and sellers privately. Then, our smart contract cryptographically verifies that the assets match and the prices overlap without revealing the actual numbers. After a match, the contract deletes the active order slots from the ledger and inserts an encrypted compliance payload for audit purposes.


| Directory                | Purpose                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `[frontend/](frontend/)` | React + Vite trader UI (Lace wallet, order ticket, activity-driven txn flow) |
| `[core/](core/)`         | Compact contract, Vitest harness, Docker devnet, matching relayer, CLI tools |
| `[backend/](backend/)`   | Relayer architecture and multi-browser dev guide                             |


## How it works

Traders publish only **32-byte commitments** and **nullifiers** on-chain (`submit_order`). Asset, side, and price bounds stay off-chain in the relayer intent pool until a matchmaker runs `propose_match` → `atomic_settle`.

Contract: `[core/contracts/obsidian.compact](core/contracts/obsidian.compact)`

## Preview deployment

Obsidian is deployed on the **Midnight preview** public testnet (Lace default network).

| | |
| --- | --- |
| **Network** | `preview` |
| **Contract address** | `bfa7c0324bf1b322fd51093594109b0afda7ca13f404a5068f63f972afff198f` |
| **Explorer** | [explorer.preview.midnight.network](https://explorer.preview.midnight.network/) |

Set in `.env` for the UI and relayer:

```bash
OBSIDIAN_CONTRACT_ADDRESS=bfa7c0324bf1b322fd51093594109b0afda7ca13f404a5068f63f972afff198f
```

For the frontend, use Lace on **preview** and optionally `VITE_MIDNIGHT_NETWORK_ID=preview` when running `yarn frontend:dev`.

Redeploy to preview: `yarn deploy:preview` (see [Midnight network endpoints](https://docs.midnight.network/relnotes/network)).

### end to end flow

```mermaid
sequenceDiagram
  participant T as Trader browser
  participant R as Relayer
  participant L as Ledger / indexer
  participant O as Operator wallet

  T->>L: submit_order(commitment, nullifier)
  T->>R: POST /intent { side, assetId, bound price }
  R->>L: poll order_commitments
  Note over R: Crossing BUY + SELL in intent pool
  R->>O: propose_match(...)
  O->>L: ZK tx finalized
  R->>O: atomic_settle(..., compliance)
  O->>L: ZK tx finalized
  R->>R: append match.settle_ok → activity.jsonl
  T->>R: GET /activity (txn loading labels)
  T->>L: poll match_log / audit_ciphertexts
```



## Prerequisites

- Node.js 22+, Yarn 1.x (core), npm (frontend)
- Docker (local devnet + proof server)
- Lace wallet (Midnight-capable) for the UI

## Quick start

```bash
# 1. Install
cd core && yarn install
cd ../frontend && npm install

# 2. Devnet
yarn env:up

# 3. Deploy contract
yarn deploy:contracts
cp .env.example .env
# set OBSIDIAN_CONTRACT_ADDRESS=<hex printed above>

# 4. UI (terminal 3)
yarn frontend:dev
# → http://localhost:5173 — Connect Lace (undeployed preset)

```

## Environment


| Variable                     | Description                       |
| ---------------------------- | --------------------------------- |
| `OBSIDIAN_CONTRACT_ADDRESS`  | Deployed contract hex (required)  |
| `DEPLOY_SEED`                | Wallet seed for `yarn deploy:contracts` |
| `RELAYER_SEED`               | Operator wallet seed (relayer)    |
| `OBSIDIAN_RELAYER_HTTP_PORT` | Relayer API port (default `3033`) |


## Scripts


| Script                          | Action                            |
| ------------------------------- | --------------------------------- |
| `yarn env:up` / `yarn env:down` | Docker devnet                     |
| `yarn frontend:dev`             | Vite UI on :5173                  |
| `yarn deploy:contracts`         | Deploy contract to local devnet     |
| `yarn deploy:preview`           | Deploy contract to preview testnet  |
| `yarn deploy:preprod`           | Deploy contract to preprod          |
| `yarn submit:pair`              | CLI BUY + SELL + match/settle     |
| `yarn relayer`                  | Matching relayer + HTTP API       |
| `yarn test:local`               | Vitest on local devnet            |


## References

- [Midnight network endpoints](https://docs.midnight.network/relnotes/network) (preview, preprod, mainnet)
- [Midnight local network](https://docs.midnight.network/guides/midnight-local-network)
- [Midnight Hello World](https://docs.midnight.network/getting-started/hello-world)

