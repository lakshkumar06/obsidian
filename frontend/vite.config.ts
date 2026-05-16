import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, monorepoRoot, '');
  const contractAddress =
    env.VITE_OBSIDIAN_CONTRACT_ADDRESS?.trim() || env.OBSIDIAN_CONTRACT_ADDRESS?.trim() || '';

  return {
  envDir: monorepoRoot,
  define: contractAddress
    ? { 'import.meta.env.VITE_OBSIDIAN_CONTRACT_ADDRESS': JSON.stringify(contractAddress) }
    : {},
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
  ],
  resolve: {
    alias: {
      '@obsidian/managed-contract': path.resolve(
        __dirname,
        '../core/contracts/managed/obsidian/contract/index.js',
      ),
      'isomorphic-ws': path.resolve(__dirname, 'src/isomorphicWs.ts'),
    },
    dedupe: ['@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/ledger-v8'],
  },
  server: {
    port: 5173,
    host: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/midnight-proof': {
        target: 'http://127.0.0.1:6300',
        changeOrigin: true,
        rewrite: (reqPath) => reqPath.replace(/^\/midnight-proof/, '') || '/',
      },
    },
  },
};
});
