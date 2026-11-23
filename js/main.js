import { render } from 'preact';
import { html } from './ui.js';
import { App } from './app.js';
import { startQueueTriggers } from './enrich.js';
import { startSync } from './sync.js';
import { updateBadge } from './badge.js';

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
startQueueTriggers();
startSync();
updateBadge();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateBadge(); });
