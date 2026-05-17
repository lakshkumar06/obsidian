import { fetchRelayerActivity, relayerHttpBase } from './registerRelayerIntent';

export type TxnActivityEvent = {
  ts: string;
  source: string;
  type: string;
  commitmentHex?: string;
  buyerHex?: string;
  sellerHex?: string;
  error?: string;
  detail?: string;
};

export type TxnFlowTerminal = 'complete' | 'queued' | 'failed';

const LABELS: Record<string, string> = {
  'tx.submit_start': 'Submitting order',
  'tx.wallet_confirm': 'Confirm in wallet',
  'tx.submit_ok': 'Order submitted on-chain',
  'intent.registered': 'Registered in matching pool',
  'tx.finding_match': 'Finding counterparty',
  'match.attempt': 'Matching counterparty',
  'tx.propose_match': 'Proposing match',
  'match.propose_ok': 'Match proposed',
  'match.propose_fail': 'Match proposal failed',
  'tx.settling': 'Settling on-chain',
  'match.settle_ok': 'Settlement complete',
  'match.settle_fail': 'Settlement failed',
  'tx.queued': 'Waiting for counterparty',
  'tx.complete': 'Done',
  'tx.failed': 'Transaction failed',
};

const TERMINAL_TYPES = new Set([
  'tx.complete',
  'tx.queued',
  'tx.failed',
  'match.settle_fail',
]);

export function activityStatusLabel(event: TxnActivityEvent): string {
  if (event.detail && typeof event.detail === 'string') {
    return event.detail;
  }
  return LABELS[event.type] ?? event.type.replace(/[._]/g, ' ');
}

export function terminalFromEvent(event: TxnActivityEvent): TxnFlowTerminal | null {
  if (event.type === 'tx.failed' || event.type === 'match.propose_fail' || event.type === 'match.settle_fail') {
    return 'failed';
  }
  if (event.type === 'tx.queued') {
    return 'queued';
  }
  if (event.type === 'tx.complete' || event.type === 'match.settle_ok') {
    return 'complete';
  }
  return null;
}

function eventMatchesCommitment(event: TxnActivityEvent, commitmentHex: string): boolean {
  const key = commitmentHex.toLowerCase();
  if (event.commitmentHex?.toLowerCase() === key) {
    return true;
  }
  if (event.buyerHex?.toLowerCase() === key) {
    return true;
  }
  if (event.sellerHex?.toLowerCase() === key) {
    return true;
  }
  return false;
}

export async function postTxnActivity(
  event: Omit<TxnActivityEvent, 'ts' | 'source'> & { source?: TxnActivityEvent['source'] },
): Promise<void> {
  const base = relayerHttpBase();
  try {
    await fetch(`${base}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: event.source ?? 'ui', ...event }),
    });
  } catch {
    /* relayer optional */
  }
}

export type TxnActivityWatcher = {
  pushLocal: (event: Omit<TxnActivityEvent, 'ts' | 'source'>) => void;
  stop: () => void;
};

/** Poll relayer activity log; also accepts local pushes (same-tab, instant UI). */
export function watchTxnActivity(
  commitmentHex: string,
  onUpdate: (label: string, event: TxnActivityEvent) => void,
  onTerminal?: (terminal: TxnFlowTerminal, event: TxnActivityEvent) => void,
): TxnActivityWatcher {
  const seen = new Set<string>();
  let stopped = false;
  const startMs = Date.now();

  const handle = (raw: TxnActivityEvent) => {
    if (stopped) {
      return;
    }
    if (!eventMatchesCommitment(raw, commitmentHex)) {
      return;
    }
    const dedupeKey = `${raw.ts}:${raw.type}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    onUpdate(activityStatusLabel(raw), raw);
    if (TERMINAL_TYPES.has(raw.type)) {
      const terminal = terminalFromEvent(raw);
      if (terminal) {
        onTerminal?.(terminal, raw);
      }
    }
  };

  const pushLocal = (event: Omit<TxnActivityEvent, 'ts' | 'source'>) => {
    handle({
      ts: new Date().toISOString(),
      source: 'ui',
      ...event,
      commitmentHex: event.commitmentHex ?? commitmentHex,
    });
    void postTxnActivity({ ...event, commitmentHex: event.commitmentHex ?? commitmentHex });
  };

  const poll = async () => {
    if (stopped) {
      return;
    }
    const events = (await fetchRelayerActivity(80)) as TxnActivityEvent[];
    for (const ev of events) {
      if (ev.ts && Date.parse(ev.ts) < startMs - 5000) {
        continue;
      }
      if (eventMatchesCommitment(ev, commitmentHex)) {
        handle(ev);
      }
    }
  };

  const id = window.setInterval(() => void poll(), 450);
  void poll();

  return {
    pushLocal,
    stop: () => {
      stopped = true;
      window.clearInterval(id);
    },
  };
}

export function isSuccessTerminal(terminal: TxnFlowTerminal): boolean {
  return terminal === 'complete' || terminal === 'queued';
}
