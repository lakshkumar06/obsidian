import { useEffect, useState } from 'react';

type TxnLoadingScreenProps = {
  statusLabel: string;
};

type LabelAnim = 'idle' | 'exit' | 'enter';

const EXIT_MS = 400;

export function TxnLoadingScreen({ statusLabel }: TxnLoadingScreenProps) {
  const [displayed, setDisplayed] = useState(statusLabel);
  const [anim, setAnim] = useState<LabelAnim>('idle');

  useEffect(() => {
    if (statusLabel === displayed) {
      return;
    }
    setAnim('exit');
    const t = window.setTimeout(() => {
      setDisplayed(statusLabel);
      setAnim('enter');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnim('idle'));
      });
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [statusLabel, displayed]);

  const labelClass =
    anim === 'exit'
      ? 'txn-status-label txn-status-label--exit'
      : anim === 'enter'
        ? 'txn-status-label txn-status-label--enter'
        : 'txn-status-label';

  return (
    <div className="txn-loading-screen" aria-live="polite" aria-busy="true">
      <div className="txn-loading-inner">
        <div className="txn-blob-stage" aria-hidden="true">
          <span className="txn-blob-1" />
          <span className="txn-blob-2" />
        </div>
        <p className={labelClass}>{displayed}</p>
      </div>
    </div>
  );
}
