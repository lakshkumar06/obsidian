import { formatLifecyclePhase } from '../ledgerStatus';
import type { OrderRow } from '../types';

function shortStatus(order: OrderRow): string {
  const ls = order.ledgerStatus;
  if (ls?.auditPresent || ls?.pairedSettled) {
    return 'Settled';
  }
  if (ls?.commitmentActive === false) {
    return 'Settled';
  }
  if (ls?.inMatchLog || ls?.pairedMatchPending) {
    return 'Matching';
  }
  const phase = formatLifecyclePhase(order);
  if (phase.includes('settled') || phase.includes('cleared')) {
    return 'Settled';
  }
  if (phase.includes('match')) {
    return 'Matching';
  }
  if (phase.includes('queued') || order.queueStatus === 'queued') {
    return 'Queued';
  }
  if (phase.includes('error')) {
    return 'Failed';
  }
  return 'Active';
}

type OrderHistoryProps = {
  orders: OrderRow[];
};

export function OrderHistory({ orders }: OrderHistoryProps) {
  const sorted = [...orders].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  if (sorted.length === 0) {
    return (
      <div className="history-panel">
        <p className="history-empty">No orders yet</p>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-list">
        {sorted.map((order) => (
          <div key={order.id} className="history-item">
            <div className="history-item-main">
              <div className="history-item-title">
                {order.side} {order.qty} {order.asset}
              </div>
              <div className="history-item-sub">
                Limit {order.price}
                {order.createdAt
                  ? ` · ${new Date(order.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </div>
            </div>
            <span className="history-item-status">{shortStatus(order)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
