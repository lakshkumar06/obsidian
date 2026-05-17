import {
  explainMatchBlocker,
  explainQueueNoMatch,
  isMatchEligible,
  isQueuedInPool,
} from './orderMatcher';
import type { OrderRow } from './types';

export type MatchDiagnosticLine = {
  at: string;
  level: 'info' | 'warn' | 'error' | 'ok';
  message: string;
};

export function ts(): string {
  return new Date().toLocaleTimeString();
}

export function summarizeOrdersForMatch(pool: OrderRow[]): string[] {
  const lines: string[] = [];
  lines.push(`Pool: ${pool.length} order row(s) in this browser.`);

  for (const o of pool) {
    const ls = o.ledgerStatus;
    lines.push(
      `• ${o.side} ${o.qty} ${o.asset} bound=${o.boundPrice ?? '?'} ` +
        `queue=${o.queueStatus ?? '—'} ` +
        `commitmentActive=${ls?.commitmentActive ?? '?'} ` +
        `inMatchLog=${ls?.inMatchLog ?? false} ` +
        `audit=${ls?.auditPresent ?? false} ` +
        `eligible=${isMatchEligible(o)} ` +
        `queued=${isQueuedInPool(o)} ` +
        `commitment=${o.commitmentHex?.slice(0, 12) ?? '—'}…`,
    );
  }

  const buys = pool.filter((o) => o.side === 'BUY');
  const sells = pool.filter((o) => o.side === 'SELL');
  const queuedBuys = buys.filter(isQueuedInPool);
  const queuedSells = sells.filter(isQueuedInPool);
  lines.push(
    `Sides: ${buys.length} BUY (${queuedBuys.length} queued), ${sells.length} SELL (${queuedSells.length} queued).`,
  );
  lines.push(`Queue diagnosis: ${explainQueueNoMatch(pool)}`);

  if (buys.length > 0 && sells.length > 0) {
    const blocker = explainMatchBlocker(buys[0]!, sells[0]!);
    lines.push(
      blocker
        ? `First BUY×SELL check: blocked — ${blocker}`
        : 'First BUY×SELL check: would cross (match should proceed).',
    );
  }

  return lines;
}

export function preflightRetryMatch(opts: {
  hasProviders: boolean;
  contractAddress: string;
  alreadyBusy: boolean;
  pool: OrderRow[];
}): MatchDiagnosticLine[] {
  const out: MatchDiagnosticLine[] = [];
  const push = (level: MatchDiagnosticLine['level'], message: string) => {
    out.push({ at: ts(), level, message });
  };

  push('info', 'Retry match clicked.');

  if (!opts.hasProviders) {
    push('error', 'Blocked: wallet/proving stack not ready — connect Lace first.');
    return out;
  }
  if (!opts.contractAddress.trim()) {
    push('error', 'Blocked: no contract address (set obsidian/.env or paste address).');
    return out;
  }
  if (opts.alreadyBusy) {
    push(
      'warn',
      'Blocked: a match is already running (ZK proofs can take 1–3 minutes — wait for it to finish).',
    );
    return out;
  }
  if (opts.pool.length === 0) {
    push('error', 'Blocked: no orders in this session.');
    return out;
  }

  const queued = opts.pool.filter(isQueuedInPool);
  if (queued.length < 2) {
    push('warn', `Only ${queued.length} queued/eligible leg(s) — need BUY + SELL in pool.`);
  }

  for (const line of summarizeOrdersForMatch(opts.pool)) {
    push('info', line);
  }

  return out;
}
