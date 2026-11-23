// Shared UI helpers and components.
import { h, createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { findTarget } from './cloze.js';

export const html = htm.bind(h);
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

export function useHashRoute() {
  const get = () => (location.hash.replace(/^#\/?/, '') || 'today');
  const [r, setR] = useState(get());
  useEffect(() => {
    const on = () => setR(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path) => { location.hash = '#/' + path; };

export function useStore(subscribe) {
  const [v, setV] = useState({});
  useEffect(() => subscribe(setV), []);
  return v;
}

/** Example sentence with the target word highlighted. */
export function Highlight({ text, target }) {
  if (!text) return null;
  const spans = findTarget(text, target);
  if (!spans) return text;
  const parts = [];
  let pos = 0;
  spans.forEach((s, i) => {
    parts.push(text.slice(pos, s.start));
    parts.push(html`<mark key=${i}>${text.slice(s.start, s.end)}</mark>`);
    pos = s.end;
  });
  parts.push(text.slice(pos));
  return parts;
}

/** Meanings + examples, shown on the back of the card and in word details. */
export function Meaning({ word, compact = false }) {
  const { settings, t } = useApp();
  const zh = settings.lang === 'zh';
  if (word.status !== 'ready' || !(word.senses || []).length) {
    return html`<p class="muted">${word.status === 'failed' ? t.status_failed : t.noDefYet}</p>`;
  }
  const senses = compact ? word.senses.slice(0, 1) : word.senses;
  return html`
    <div class="meaning">
      ${zh && word.gloss_zh && html`<p class="gloss">${word.gloss_zh}</p>`}
      <ol class="senses">
        ${senses.map((s, i) => html`
          <li key=${i}>
            <div class="def">
              ${s.pos && html`<span class="pos">${s.pos}</span>`}
              ${zh && s.def_zh ? html`<span>${s.def_zh}</span>` : html`<span>${s.def_en}</span>`}
            </div>
            ${zh && s.def_zh && s.def_en && html`<div class="def-en">${s.def_en}</div>`}
            ${s.example_en && html`
              <div class="example">
                <div><${Highlight} text=${s.example_en} target=${word.text} /></div>
                ${zh && s.example_zh && html`<div class="example-zh">${s.example_zh}</div>`}
              </div>`}
          </li>`)}
      </ol>
    </div>`;
}

export function Modal({ onClose, children, wide = false }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">${children}</div>
    </div>`;
}

export function Segmented({ value, options, onChange }) {
  return html`
    <div class="segmented" role="radiogroup">
      ${options.map((o) => html`
        <button type="button" role="radio" aria-checked=${value === o.value}
          class=${value === o.value ? 'on' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
    </div>`;
}

export function Icon({ name }) {
  const P = {
    today: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4',
    add: 'M12 5v14M5 12h14',
    words: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
    search: 'M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14zM20 20l-4-4',
    settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  };
  return html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d=${P[name]} /></svg>`;
}

export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
