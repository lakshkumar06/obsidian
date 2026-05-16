import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

if (!('Buffer' in globalThis)) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

const el = document.getElementById('root');
if (!el) {
  throw new Error('Missing #root');
}

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
