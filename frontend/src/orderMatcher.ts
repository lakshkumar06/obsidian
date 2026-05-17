import type { OrderRow } from './types';

export type MatchedPair = {
  buyer: OrderRow;
  seller: OrderRow;
  buyerMax: bigint;
  sellerMin: bigint;
};

export function parseOrderQty(qty: string): number | null {
  const n = Number(qty.trim());
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

export function pairKey(buyerCommitmentHex: string, sellerCommitmentHex: string): string {
  return buyerCommitmentHex < sellerCommitmentHex
    ? `${buyerCommitmentHex}:${sellerCommitmentHex}`
    : `${sellerCommitmentHex}:${buyerCommitmentHex}`;
}

/** Order still eligible for the off-chain matching pool. */
export function isMatchEligible(order: OrderRow): boolean {
  if (!order.commitmentHex || !order.assetIdHex) {
    return false;
  }
  if (order.boundPrice === undefined || order.boundPrice === null || order.boundPrice === '') {
    return false;
  }
  if (order.queueStatus === 'matching' || order.queueStatus === 'settling') {
    return false;
  }
  const ls = order.ledgerStatus;
  if (ls?.auditPresent || ls?.pairedSettled) {
    return false;
  }
  if (ls?.inMatchLog) {
    return false;
  }
  if (ls?.commitmentActive === false) {
    return false;
  }
  return true;
}

function priceSpreadCrosses(buyer: OrderRow, seller: OrderRow): boolean {
  const buyerMax = BigInt(buyer.boundPrice ?? '0');
  const sellerMin = BigInt(seller.boundPrice ?? '0');
  return buyerMax >= sellerMin;
}

/** Demo fill rule: buy size must not exceed sell size (partial fill against larger sell). */
function quantityCompatible(buyer: OrderRow, seller: OrderRow): boolean {
  const buyQty = parseOrderQty(buyer.qty);
  const sellQty = parseOrderQty(seller.qty);
  if (buyQty === null && sellQty === null) {
    return true;
  }
  if (buyQty === null || sellQty === null) {
    return true;
  }
  return buyQty <= sellQty;
}

/** Human-readable reason when two legs do not cross (for queued-order UX). */
export function explainMatchBlocker(a: OrderRow, b: OrderRow): string | null {
  if (a.side === b.side) {
    return 'same side';
  }
  const buyer = a.side === 'BUY' ? a : b;
  const seller = a.side === 'SELL' ? a : b;
  if (!isMatchEligible(buyer)) {
    return `buyer not eligible (${buyer.commitmentHex?.slice(0, 8)}…)`;
  }
  if (!isMatchEligible(seller)) {
    return `seller not eligible (${seller.commitmentHex?.slice(0, 8)}…)`;
  }
  if (buyer.assetIdHex !== seller.assetIdHex) {
    return 'different assets';
  }
  if (!priceSpreadCrosses(buyer, seller)) {
    return `price: buyer max ${buyer.boundPrice} < seller min ${seller.boundPrice}`;
  }
  const buyQty = parseOrderQty(buyer.qty);
  const sellQty = parseOrderQty(seller.qty);
  if (buyQty !== null && sellQty !== null && buyQty > sellQty) {
    return `quantity: buy ${buyQty} > sell ${sellQty}`;
  }
  return null;
}

export function isQueuedInPool(order: OrderRow): boolean {
  if (order.queueStatus === 'matching' || order.queueStatus === 'settling') {
    return false;
  }
  if (order.queueStatus !== 'queued') {
    return false;
  }
  return isMatchEligible(order);
}

/** Drop stale queue flag after indexer shows commitment consumed or settled. */
export function reconcileQueueStatus(order: OrderRow): OrderRow {
  const ls = order.ledgerStatus;
  const settled =
    ls?.auditPresent === true ||
    ls?.pairedSettled === true ||
    ls?.commitmentActive === false;

  if (settled) {
    return { ...order, queueStatus: undefined, matchError: undefined };
  }
  if (order.queueStatus !== 'queued') {
    return order;
  }
  if (!isMatchEligible(order)) {
    return { ...order, queueStatus: undefined };
  }
  return order;
}

function describeQueuedLeg(o: OrderRow): string {
  return `${o.side} ${o.qty} ${o.asset} @ bound ${o.boundPrice ?? '?'}`;
}

export function explainQueueNoMatch(pool: OrderRow[]): string {
  const buys = pool.filter((o) => o.side === 'BUY' && isQueuedInPool(o));
  const sells = pool.filter((o) => o.side === 'SELL' && isQueuedInPool(o));
  const settled = pool.filter(
    (o) => o.ledgerStatus?.auditPresent || o.ledgerStatus?.pairedSettled,
  ).length;

  if (buys.length === 0 && sells.length === 0) {
    return `No open queued legs (${pool.length} row(s) in table, ${settled} already settled). Submit a new BUY or SELL.`;
  }
  if (buys.length === 0) {
    const settledBuys = pool.filter((o) => o.side === 'BUY' && o.ledgerStatus?.auditPresent);
    const hint =
      settledBuys.length > 0
        ? ` ${settledBuys.length} BUY row(s) already settled in this browser — they cannot match again.`
        : '';
    const orphan =
      sells.length > 0 && pool.every((o) => o.side !== 'BUY' || !isQueuedInPool(o))
        ? ' Or use Operator panel / `yarn match-existing` if the BUY row is missing but commitments are on-chain.'
        : '';
    return `Have ${sells.length} queued SELL(s) but no queued BUY — submit a new BUY to cross (e.g. ${describeQueuedLeg(sells[0]!)}).${hint}${orphan}`;
  }
  if (sells.length === 0) {
    const legs = buys.map(describeQueuedLeg).join('; ');
    return `Have ${buys.length} queued BUY(s) but no queued SELL — submit a SELL on the same asset to cross (${legs}).`;
  }
  for (const buy of buys) {
    for (const sell of sells) {
      const blocker = explainMatchBlocker(buy, sell);
      if (!blocker) {
        return 'Cross found — matching should run (click Retry match if stuck).';
      }
    }
  }
  const blocker = explainMatchBlocker(buys[0]!, sells[0]!);
  return blocker ?? 'unknown';
}

export function buildMatchedPair(a: OrderRow, b: OrderRow): MatchedPair | null {
  if (a.side === b.side) {
    return null;
  }
  const buyer = a.side === 'BUY' ? a : b;
  const seller = a.side === 'SELL' ? a : b;
  if (!isMatchEligible(buyer) || !isMatchEligible(seller)) {
    return null;
  }
  if (buyer.assetIdHex !== seller.assetIdHex) {
    return null;
  }
  if (!priceSpreadCrosses(buyer, seller) || !quantityCompatible(buyer, seller)) {
    return null;
  }
  return {
    buyer,
    seller,
    buyerMax: BigInt(buyer.boundPrice!),
    sellerMin: BigInt(seller.boundPrice!),
  };
}

/** Best counterparty for `incoming` (newest crossing peer first — matches “BUY then SELL” demos). */
export function findCounterparty(incoming: OrderRow, pool: OrderRow[]): MatchedPair | null {
  if (!isMatchEligible(incoming)) {
    return null;
  }
  const candidates = pool
    .filter((o) => o.id !== incoming.id)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  for (const other of candidates) {
    const pair = buildMatchedPair(incoming, other);
    if (pair) {
      return pair;
    }
  }
  return null;
}

/** Scan pool for a crossing pair; prefer the most recently submitted leg. */
export function findFirstCrossingPair(pool: OrderRow[]): MatchedPair | null {
  const sorted = [...pool].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const pair = buildMatchedPair(sorted[i]!, sorted[j]!);
      if (pair) {
        return pair;
      }
    }
  }
  return null;
}
