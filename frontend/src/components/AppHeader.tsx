import { IconHistory, IconShield } from './icons';

export type AppView = 'trade' | 'history' | 'regulator';

type HeaderProps = {
  view: AppView;
  onViewChange: (v: AppView) => void;
  isConnected: boolean;
  onConnectClick: () => void;
};

export function AppHeader({ view, onViewChange, isConnected, onConnectClick }: HeaderProps) {
  return (
    <header className="app-header" style={{ position: 'relative' }}>
      <div className="header-brand">
        <span style={{ opacity: 0.9 }}>◆</span> Obsidian
      </div>

      <nav className="header-nav" aria-label="Main">
        <button type="button" className={view === 'trade' ? 'active' : ''} onClick={() => onViewChange('trade')}>
          Trade
        </button>
        <button
          type="button"
          className={view === 'history' ? 'active' : ''}
          onClick={() => onViewChange('history')}
        >
          History
        </button>
        <button
          type="button"
          className={view === 'regulator' ? 'active' : ''}
          onClick={() => onViewChange('regulator')}
        >
          Audit
        </button>
      </nav>

      <div className="header-actions">
        <button
          type="button"
          className={`icon-btn ${view === 'history' ? 'active' : ''}`}
          onClick={() => onViewChange('history')}
          aria-label="Order history"
          title="History"
        >
          <IconHistory />
        </button>
        <button
          type="button"
          className={`icon-btn ${view === 'regulator' ? 'active' : ''}`}
          onClick={() => onViewChange('regulator')}
          aria-label="Audit log"
          title="Audit"
        >
          <IconShield />
        </button>
        <button
          type="button"
          className={isConnected ? 'btn-connect connected' : 'btn-connect'}
          onClick={onConnectClick}
        >
          {isConnected ? 'Connected' : 'Connect'}
        </button>
      </div>
    </header>
  );
}
