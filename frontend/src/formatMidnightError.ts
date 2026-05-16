import { isLaceChannelShutdownError, LACE_SHUTDOWN_RECOVERY_HINT } from './laceSession';

/** Unwraps nested Error / wallet-extension failures into a readable string. */
export function formatMidnightError(err: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();

  function walk(e: unknown, depth: number): void {
    if (e === undefined || e === null || seen.has(e) || depth > 8) {
      return;
    }
    seen.add(e);

    if (e instanceof Error) {
      if (e.message && !lines.includes(e.message)) {
        lines.push(e.message);
      }
      if ('cause' in e && e.cause !== undefined) {
        walk(e.cause, depth + 1);
      }
      return;
    }

    if (typeof e === 'object') {
      const record = e as Record<string, unknown>;
      for (const key of ['message', 'reason', 'details', 'info', 'data'] as const) {
        const v = record[key];
        if (typeof v === 'string' && v.length > 0 && !lines.includes(v)) {
          lines.push(v);
        }
      }
      if (typeof record['code'] !== 'undefined') {
        const codeLine = `code: ${String(record['code'])}`;
        if (!lines.includes(codeLine)) {
          lines.push(codeLine);
        }
      }
      try {
        const json = JSON.stringify(e);
        if (json && json !== '{}' && !lines.includes(json)) {
          lines.push(json);
        }
      } catch {
        /* ignore */
      }
      return;
    }

    const s = String(e);
    if (s && s !== '[object Object]' && !lines.includes(s)) {
      lines.push(s);
    }
  }

  walk(err, 0);
  const body =
    lines.length > 0 ? lines.join('\n') : 'Unknown error (no message from wallet or Midnight.js)';

  const lower = body.toLowerCase();
  if (
    lower.includes('insufficient funds') &&
    (lower.includes('dust') || lower.includes('wallet.insufficientfunds'))
  ) {
    return (
      `${body}\n\n` +
      'Your Lace wallet has no (or not enough) DUST to pay fees on undeployed.\n' +
      'This is not Cardano test ADA — fund the Midnight Undeployed profile:\n' +
      '• Midnight local network guide: https://docs.midnight.network/guides/midnight-local-network\n' +
      '• Fund tNIGHT on undeployed, then in Lace generate/register DUST (fee token).\n' +
      '• Or run `yarn demo:contracts` in core/ (CLI wallet is auto-funded) to verify the stack.\n' +
      'Reconnect Lace after funding and check the DUST line shown below your address.'
    );
  }

  if (isLaceChannelShutdownError(err)) {
    return `${body}\n\n${LACE_SHUTDOWN_RECOVERY_HINT}`;
  }

  return body;
}
