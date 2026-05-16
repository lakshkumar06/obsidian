# Obsidian (Midnight)

Compact contract and TypeScript harness for an Obsidian-style dark pool flow on Midnight local devnet: `submit_order`, `propose_match`, and `atomic_settle`.

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

From the project root:

```bash
yarn env:up
```

Keep this running. Start the proof server and local node as provided by the compose setup.

## Tests

With devnet up:

```bash
yarn test:local
```

This runs [`src/test/obsidian.test.ts`](src/test/obsidian.test.ts) against the local network.

## References

- [Midnight docs — Hello World / getting started](https://docs.midnight.network/getting-started/hello-world) (tooling baseline for this repo)
