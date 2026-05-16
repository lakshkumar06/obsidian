#!/usr/bin/env bash
# Fund accounts.json against the Obsidian local compose (indexer v4).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIDNIGHT_LOCAL_DEV="${MIDNIGHT_LOCAL_DEV:-/tmp/midnight-local-dev}"
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$MIDNIGHT_LOCAL_DEV" ]]; then
  echo "Clone midnight-local-dev first:"
  echo "  git clone https://github.com/midnightntwrk/midnight-local-dev $MIDNIGHT_LOCAL_DEV"
  exit 1
fi

if [[ ! -f "$MIDNIGHT_LOCAL_DEV/node_modules/.package-lock.json" ]] && [[ ! -d "$MIDNIGHT_LOCAL_DEV/node_modules" ]]; then
  echo "Installing midnight-local-dev deps..."
  (cd "$MIDNIGHT_LOCAL_DEV" && npm install)
fi

cp "$TOOL_DIR/accounts.json" "$MIDNIGHT_LOCAL_DEV/accounts.json"
cp "$TOOL_DIR/obsidian-fund.ts" "$MIDNIGHT_LOCAL_DEV/src/obsidian-fund.ts"

(cd "$MIDNIGHT_LOCAL_DEV" && node --experimental-specifier-resolution=node --loader ts-node/esm src/obsidian-fund.ts)

cp "$MIDNIGHT_LOCAL_DEV/obsidian-funded-wallet.json" "$TOOL_DIR/FUNDED_WALLET.json"
echo "Updated $TOOL_DIR/FUNDED_WALLET.json — see FUNDED_WALLET.md for Lace import."
