import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type StoredOrder = {
  id: string;
  asset: string;
  qty: string;
  price: string;
  side: 'BUY' | 'SELL';
  assetIdHex: string;
  boundPrice: string;
  commitmentHex: string;
  nullifierHex?: string;
  txId?: string;
  status?: string;
  createdAt: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultLogPath = path.resolve(__dirname, '..', '..', '.obsidian', 'orders.jsonl');

let logPath = process.env['OBSIDIAN_ORDERS_LOG']?.trim() || defaultLogPath;

export function setOrdersLogPath(file: string): void {
  logPath = file;
}

export function getOrdersLogPath(): string {
  return logPath;
}

export function upsertOrder(order: StoredOrder): void {
  const existing = readAllOrders();
  const byCommitment = new Map(existing.map((o) => [o.commitmentHex.toLowerCase(), o]));
  byCommitment.set(order.commitmentHex.toLowerCase(), order);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const lines = [...byCommitment.values()].map((o) => JSON.stringify(o));
  fs.writeFileSync(logPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
}

export function readAllOrders(): StoredOrder[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const byCommitment = new Map<string, StoredOrder>();
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as StoredOrder;
      if (row.commitmentHex) {
        byCommitment.set(row.commitmentHex.toLowerCase(), row);
      }
    } catch {
      /* skip corrupt line */
    }
  }
  return [...byCommitment.values()].sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
}
