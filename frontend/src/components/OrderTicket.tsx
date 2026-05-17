import type { OrderRow } from '../types';

export type OrderTicketStatus = 'awaiting_match' | 'matching' | 'settled';

export function orderTicketStatus(order: OrderRow): OrderTicketStatus {
  const ls = order.ledgerStatus;
  if (ls?.auditPresent || ls?.pairedSettled || ls?.commitmentActive === false) {
    return 'settled';
  }
  if (order.queueStatus === 'matching' || order.queueStatus === 'settling' || ls?.inMatchLog) {
    return 'matching';
  }
  return 'awaiting_match';
}

export function ticketStatusLabel(status: OrderTicketStatus): string {
  if (status === 'settled') {
    return 'SETTLED';
  }
  if (status === 'matching') {
    return 'MATCHING';
  }
  return 'QUEUED';
}

/** Short line shown beside the ticket after submit. */
export function orderPlacedTagline(order: OrderRow): string {
  const status = orderTicketStatus(order);
  const bound = order.boundPrice ?? order.price;
  if (status === 'settled') {
    return 'Matched and cleared on-chain. Your ticket has the commitment receipt.';
  }
  if (status === 'matching') {
    return 'A counterparty was found — settlement is in progress.';
  }
  if (order.side === 'BUY') {
    return `Queued in the pool. Waiting for a sell on ${order.asset} at or below ${bound}.`;
  }
  return `Queued in the pool. Waiting for a buy on ${order.asset} at or above ${bound}.`;
}

function shortHex(hex: string | undefined, head = 10, tail = 8): string {
  if (!hex) {
    return '—';
  }
  if (hex.length <= head + tail + 3) {
    return hex;
  }
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function formatSubmitted(iso: string | undefined): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type OrderTicketProps = {
  order: OrderRow;
  onDismiss?: () => void;
  embedded?: boolean;
};

export function OrderTicket({ order, onDismiss, embedded = false }: OrderTicketProps) {
  const status = orderTicketStatus(order);
  const sideLabel = order.side === 'BUY' ? 'Buy' : 'Sell';

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      console.warn(`[Obsidian] copy failed: ${label}`);
    }
  }

  return (
    <article
      className={`order-ticket${embedded ? ' order-ticket--embedded' : ''}`}
      aria-label="Order receipt"
    >
      <div className="order-ticket-body">
        <header className="order-ticket-head">
          <span className={`order-ticket-side order-ticket-side--${order.side.toLowerCase()}`}>
            {sideLabel}
          </span>
          <p className="order-ticket-summary">
            {order.qty} {order.asset}
            <span className="order-ticket-at"> @ </span>
            {order.price}
          </p>
          <p className="order-ticket-meta">Submitted {formatSubmitted(order.createdAt)}</p>
        </header>

        <div className="order-ticket-grid">
          <div className="order-ticket-cell">
            <span className="order-ticket-cell-label">Bound price</span>
            <span className="order-ticket-cell-value">{order.boundPrice ?? '—'}</span>
          </div>
          <div className="order-ticket-cell">
            <span className="order-ticket-cell-label">Asset id</span>
            <span className="order-ticket-cell-value order-ticket-cell-value--mono">
              <code title={order.assetIdHex}>{shortHex(order.assetIdHex, 8, 8)}</code>
            </span>
          </div>
          <div className="order-ticket-cell order-ticket-cell--wide">
            <span className="order-ticket-cell-label">Commitment</span>
            <span className="order-ticket-cell-value order-ticket-cell-value--mono">
              <code title={order.commitmentHex}>{shortHex(order.commitmentHex, 14, 10)}</code>
              {order.commitmentHex ? (
                <button
                  type="button"
                  className="order-ticket-copy"
                  onClick={() => void copyValue('commitment', order.commitmentHex!)}
                >
                  Copy
                </button>
              ) : null}
            </span>
          </div>
          <div className="order-ticket-cell order-ticket-cell--wide">
            <span className="order-ticket-cell-label">Nullifier</span>
            <span className="order-ticket-cell-value order-ticket-cell-value--mono">
              <code title={order.nullifierHex}>{shortHex(order.nullifierHex, 14, 10)}</code>
              {order.nullifierHex ? (
                <button
                  type="button"
                  className="order-ticket-copy"
                  onClick={() => void copyValue('nullifier', order.nullifierHex!)}
                >
                  Copy
                </button>
              ) : null}
            </span>
          </div>
          {order.txId ? (
            <div className="order-ticket-cell order-ticket-cell--wide">
              <span className="order-ticket-cell-label">Transaction</span>
              <span className="order-ticket-cell-value order-ticket-cell-value--mono">
                <code title={order.txId}>{shortHex(order.txId, 12, 12)}</code>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="order-ticket-tear" aria-hidden="true">
        <span className="order-ticket-notch order-ticket-notch--left" />
        <span className="order-ticket-dash" />
        <span className="order-ticket-notch order-ticket-notch--right" />
      </div>

      <div className="order-ticket-stub">
        <p className={`order-ticket-stub-status order-ticket-stub-status--${status}`}>
          {ticketStatusLabel(status)}
        </p>
      </div>

      {onDismiss && !embedded ? (
        <button type="button" className="order-ticket-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </article>
  );
}
