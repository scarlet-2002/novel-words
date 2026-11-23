// App shell: navigation + routing.
import { html, AppCtx, useOnline, useHashRoute, Icon } from './ui.js';
import { useLive, liveSettings } from './db.js';
import { strings } from './i18n.js';
import { Today, Add, Words, Search, Settings } from './pages.js';
import { Review } from './review.js';

const NAV = [
  ['today', 'navToday'], ['add', 'navAdd'], ['words', 'navWords'], ['search', 'navSearch'], ['settings', 'navSettings'],
];

export function App() {
  const settings = useLive(liveSettings, [], null);
  const route = useHashRoute();
  const online = useOnline();
  if (!settings) return null;
  const t = strings(settings.lang);
  document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';

  const [base, arg] = route.split('/');
  let page;
  if (base === 'review') page = html`<${Review} />`;
  else if (base === 'add') page = html`<${Add} />`;
  else if (base === 'words') page = html`<${Words} sectionId=${arg} key=${arg || 'list'} />`;
  else if (base === 'search') page = html`<${Search} />`;
  else if (base === 'settings') page = html`<${Settings} />`;
  else page = html`<${Today} />`;

  return html`
    <${AppCtx.Provider} value=${{ settings, t, online }}>
      ${base === 'review' ? html`<main class="main review-main">${page}</main>` : html`
        <div class="shell">
          <nav class="nav">
            <div class="brand">${t.appName}</div>
            ${NAV.map(([k, label]) => html`
              <a href=${'#/' + k} class=${'nav-item' + (base === k || (!base && k === 'today') ? ' active' : '')}>
                <${Icon} name=${k} /><span>${t[label]}</span>
              </a>`)}
            ${!online && html`<div class="offline-pill">offline</div>`}
          </nav>
          <main class="main">${page}</main>
        </div>`}
    <//>`;
}
