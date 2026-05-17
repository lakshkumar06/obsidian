# Obsidian core (Midnight)

Compact contract and TypeScript harness: `submit_order`, `propose_match`, `atomic_settle` on local devnet.

## Setup

```bash
yarn install
yarn env:up   # from core/ or repo root
```

Contract: [`contracts/obsidian.compact`](contracts/obsidian.compact). Compile from `contracts/`:

```bash
compact compile obsidian.compact managed/obsidian
```

## Relayer

Set `OBSIDIAN_CONTRACT_ADDRESS` in **`../.env`**, then:

```bash
yarn relayer
```

See [`../backend/README.md`](../backend/README.md).

## Deploy & CLI

```bash
yarn deploy:contracts    # deploy + full circuit walkthrough; prints contract address
yarn submit:pair         # BUY + SELL + match/settle (no Lace)
yarn submit:pair --orders-only
yarn submit:pair --sell-first
```

## Tests

```bash
yarn test:local
```

Canonical flow: [`src/test/obsidian.test.ts`](src/test/obsidian.test.ts).

## References

- [Midnight Hello World](https://docs.midnight.network/getting-started/hello-world)
