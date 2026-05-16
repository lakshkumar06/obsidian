export const LACE_SHUTDOWN_RECOVERY_HINT =
  'The Lace extension closed its connection to this tab (often after a long proof). ' +
  'Unlock Lace, keep the extension popup closed, click Connect wallet again, then retry the transaction. ' +
  'If it keeps failing, reload this page and restart the Lace extension.';

function collectErrorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      if (current.message) {
        parts.push(current.message);
      }
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(' ');
}

/** Lace extension channel died (common after long ZK proving). */
export function isLaceChannelShutdownError(err: unknown): boolean {
  const text = collectErrorText(err).toLowerCase();
  return (
    text.includes('was shutdown') ||
    text.includes('can no longer be used') ||
    text.includes("channel 'midnight-wallet'")
  );
}
