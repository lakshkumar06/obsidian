# Obsidian frontend

React + Vite trader UI for the Obsidian dark-pool lifecycle on Midnight local devnet.

## Run

From **repository root** (with `yarn env:up` and `.env` configured):

```bash
yarn frontend:dev
```

Open [http://localhost:5173](http://localhost:5173).

Set `OBSIDIAN_CONTRACT_ADDRESS` in **`../.env`** (from `yarn deploy:contracts`).

## Wallet (Lace)

1. Install Lace with Midnight support (Chromium).
2. Configure for **Undeployed** / local indexer ([Midnight local network](https://docs.midnight.network/guides/midnight-local-network)).
3. Fund **tNIGHT** and register **DUST** for fees.
4. **Connect wallet** — preset **undeployed** unless your profile differs.

## Views

- **Trader** — `submit_order`, auto-match when legs cross, order history
- **Regulator** — `audit_ciphertexts` from indexer
- **Operator** — manual match/settle (debug)
