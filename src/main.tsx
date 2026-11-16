/** Webview entry point. */

// First, so the flag is set before OpenUI's module body runs (see the file).
import './openui-devtools-off';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { bootStorage } from './lib/db/boot';
import { invokeCommand, isDesktop } from './lib/ipc';
import './styles.css';

/**
 * Let the backend put down its heavy services when the window goes away.
 *
 * The scan worker holds a Python process with Surya and torch, and the embedding server holds a
 * loaded model — hundreds of megabytes to gigabytes. When the reader switches away, the app
 * asks the backend to release them; the next scan respawns them. The backend's own watchdog is
 * the backstop for a window that is never hidden.
 */
function releaseOnHide(): void {
  if (!isDesktop()) {
    return;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void invokeCommand('services_idle', {});
    }
  });
}

/**
 * Open the database before the first render.
 *
 * The in-memory stores hydrate from it synchronously once boot returns, and rendering first
 * would flash seed data that is about to be replaced by what is actually there. Boot never
 * throws — in a plain browser it simply does nothing — so the interface always opens.
 */
async function start(): Promise<void> {
  await bootStorage();
  releaseOnHide();

  const container = document.getElementById('root');
  if (!container) {
    throw new Error('the #root element is missing from index.html');
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
