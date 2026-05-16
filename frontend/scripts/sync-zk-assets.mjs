/**
 * Copies compact compiler outputs into Vite static assets so UrlZkConfigProvider can fetch keys/zkir in the browser.
 * Run from frontend/: `yarn sync:zk`
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const srcRoot = path.resolve(frontendRoot, '..', 'core', 'contracts', 'managed', 'obsidian');
const destRoot = path.resolve(frontendRoot, 'public', 'zk');

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await pathExists(srcRoot))) {
    throw new Error(
      `Missing compiled contract assets at:\n  ${srcRoot}\nBuild managed outputs in core first (compact compile), then rerun sync:zk.`,
    );
  }
  await fs.mkdir(destRoot, { recursive: true });
  for (const sub of ['keys', 'zkir']) {
    const from = path.join(srcRoot, sub);
    const to = path.join(destRoot, sub);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(from, to, { recursive: true });
  }
  console.info(`Copied ZK artifacts to ${destRoot}`);
}

void main();
