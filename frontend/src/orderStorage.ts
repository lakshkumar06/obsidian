import type { OrderRow } from './types';

const ORDERS_LS_KEY = 'obsidian.ui.orders.v1';

export function loadStoredOrders(): OrderRow[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(ORDERS_LS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isOrderRow).map(normalizeOrderRow);
  } catch {
    return [];
  }
}

export function persistOrders(orders: OrderRow[]): void {
  try {
    window.localStorage.setItem(ORDERS_LS_KEY, JSON.stringify(orders));
  } catch {
    /* quota / private mode */
  }
}

function isOrderRow(value: unknown): value is OrderRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.asset !== 'string') {
    return false;
  }
  return true;
}

function normalizeOrderRow(row: OrderRow): OrderRow {
  return {
    ...row,
    side: row.side === 'SELL' ? 'SELL' : 'BUY',
  };
}
