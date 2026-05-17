import type { OrderRow } from './types';
import { relayerHttpBase } from './registerRelayerIntent';

type StoredOrderPayload = {
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

function storedToOrderRow(row: StoredOrderPayload): OrderRow {
  return {
    id: row.id,
    asset: row.asset,
    qty: row.qty,
    price: row.price,
    side: row.side,
    assetIdHex: row.assetIdHex,
    boundPrice: row.boundPrice,
    commitmentHex: row.commitmentHex,
    nullifierHex: row.nullifierHex,
    txId: row.txId,
    status: row.status ?? 'submitted',
    createdAt: row.createdAt,
    queueStatus: 'queued',
  };
}

export async function fetchOrdersFromRelayer(): Promise<OrderRow[]> {
  const base = relayerHttpBase();
  try {
    const res = await fetch(`${base}/orders`);
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { orders?: StoredOrderPayload[] };
    return (data.orders ?? []).map(storedToOrderRow);
  } catch {
    return [];
  }
}
