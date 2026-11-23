// Main pages: Today, Add, Words (sections + details), Search, Settings.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, useApp, useStore, Meaning, Modal, Segmented, Highlight, go, download } from './ui.js';
import { db, save, patch, softDelete, uuid, nowIso, todayStr, useLive, allSections, allWords, updateSettings } from './db.js';
import { newProgress, isDue, stageFor, addDays, MAX_LEVEL } from './srs.js';
import { runQueue, regenerate, onQueue } from './enrich.js';
import { recordNewWord, history, streak, dayTotals, reminderIcs, refreshCompletion } from './checkin.js';
import { fuzzy, synonymSearch } from './search.js';
import { syncConfigured, onSync, signIn, signUp, signOut, syncNow } from './sync.js';
import { enableBadge, badgeEnabled, updateBadge } from './badge.js';

// ====================== Today ======================
export function Today() {
  const { settings, t, online } = useApp();
  const queue = useStore(onQueue);
  const data = useLive(async () => {
    const today = todayStr();
    const words = await allWords();
    const ready = words.filter((w) => w.status === 'ready');
    const due = ready.filter((w) => isDue(w, settings.review_mode, today));
    const hist = await history();
    return {
      due1: due.filter((w) => stageFor(w, settings.review_mode) === 1).length,
      due2: due.filter((w) => stageFor(w, settings.review_mode) === 2).length,
      pending: words.filter((w) => w.status === 'pending' || (settings.lang === 'zh' && w.status === 'ready' && w.zh_status !== 'done')).length,
      total: words.length,
      hist,
      streak: streak(hist, today),
      todayT: await dayTotals(today),
    };
  }, [settings.review_mode, settings.lang]);

  useEffect(() => { refreshCompletion(); }, []);
  if (!data) return null;
  const done = data.todayT.completed;
  const dueTotal = data.due1 + data.due2;

  return html`
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${new Date().toLocaleDateString(settings.lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1>${t.navToday}</h1>
      </header>

      ${!done && html`<div class="banner">${t.nudge}</div>`}

      <div class="today-grid">
        <div class="panel hero">
          <div class="streak">
            <span class=${'check ' + (done ? 'on' : '')}>${done ? '✓' : '○'}</span>
            <div>
              <div class="strong">${done ? t.checkedIn : t.notCheckedIn}</div>
              <div class="muted small">${t.streak(data.streak)}</div>
            </div>
          </div>
          <div class="stats">
            <div><span class="num">${dueTotal}</span><span class="lbl">${t.dueTotal}</span></div>
            <div><span class="num">${data.todayT.reviewed}</span><span class="lbl">${t.reviewedToday}</span></div>
            <div><span class="num">${data.todayT.added}</span><span class="lbl">${t.addedToday}</span></div>
          </div>
          <div class="split muted small">
            <span>${t.dueStage1}: <b>${data.due1}</b></span>
            <span>${t.dueStage2}: <b>${data.due2}</b></span>
            <span>${t.goal}: <b>${settings.daily_goal}</b></span>
          </div>
          <label class="field-label">${t.reviewMode}</label>
          <select value=${settings.review_mode} onChange=${(e) => updateSettings({ review_mode: e.target.value })}>
            <option value="default">${t.modeDefault}</option>
            <option value="stage1_all">${t.modeStage1}</option>
            <option value="stage2_all">${t.modeStage2}</option>
          </select>
          ${dueTotal
            ? html`<button class="primary wide big" onClick=${() => go('review')}>${t.startReview} · ${dueTotal}</button>`
            : html`<p class="muted">${t.nothingDue}</p>`}
          ${data.pending > 0 && html`<p class="muted small">${online ? t.pendingGen(data.pending) + (queue.running ? ' …' : '') : t.offlineWait}</p>`}
          ${queue.message === 'quota' && html`<p class="warn small">${t.quota}</p>`}
        </div>

        <div class="panel">
          <h3>${t.history}</h3>
          <${Heatmap} hist=${data.hist} />
        </div>
      </div>
    </section>`;
}

function Heatmap({ hist }) {
  const { t } = useApp();
  const weeks = 18;
  const today = todayStr();
  const dow = new Date().getDay();
  const start = addDays(today, -(weeks - 1) * 7 - dow);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      if (date > today) { cells.push(html`<i class="cell future"></i>`); continue; }
      const h = hist[date];
      const n = h ? h.reviewed + h.added : 0;
      let lvl = 0;
      if (h?.completed) lvl = n > 40 ? 4 : n > 20 ? 3 : 2;
      else if (n > 0) lvl = 1;
      cells.push(html`<i class=${'cell l' + lvl + (date === today ? ' today' : '')} title=${`${date}: ${n}${h?.completed ? ' ✓' : ''}`}></i>`);
    }
    cols.push(html`<div class="col">${cells}</div>`);
  }
  return html`
    <div class="heatmap">${cols}</div>
    <div class="legend muted small">${t.less}<i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i>${t.more}</div>`;
}

// ====================== Add ======================
function lastSection() { try { return localStorage.getItem('nv-last-section'); } catch { return null; } }
function rememberSection(id) { try { localStorage.setItem('nv-last-section', id); } catch {} }

export async function createSection(name) {
  const rec = await save('sections', { id: uuid(), name: name.trim(), created_at: nowIso() });
  rememberSection(rec.id);
  return rec;
}

function NewSection({ onCreated, onCancel }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  return html`
    <form class="inline-form" onSubmit=${async (e) => { e.preventDefault(); if (name.trim()) onCreated(await createSection(name)); }}>
      <input autofocus value=${name} onInput=${(e) => setName(e.target.value)} placeholder=${t.sectionName} />
      <button class="primary" type="submit" disabled=${!name.trim()}>${t.create}</button>
      ${onCancel && html`<button type="button" class="ghost" onClick=${onCancel}>${t.cancel}</button>`}
    </form>`;
}

export function Add() {
  const { t } = useApp();
  const sections = useLive(allSections, [], null);
  const [sectionId, setSectionId] = useState(lastSection());
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');
  const [sentence, setSentence] = useState('');
  const [msg, setMsg] = useState('');
  const wordRef = useRef(null);

  const current = sections && (sections.find((s) => s.id === sectionId) || sections[0]);
  const recent = useLive(async () => {
    if (!current) return [];
    const ws = await db.words.where('section_id').equals(current.id).filter((w) => !w.deleted).toArray();
    return ws.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 10);
  }, [current?.id], []);

  if (!sections) return null;

  async function submit(e) {
    e.preventDefault();
    const w = text.trim().replace(/\s+/g, ' ');
    if (!w || !current) return;
    const dup = await db.words.where('section_id').equals(current.id).filter((x) => !x.deleted && x.text.toLowerCase() === w.toLowerCase()).first();
    if (dup) { setMsg(t.duplicate(w)); return; }
    await save('words', {
      id: uuid(), section_id: current.id, text: w, source_sentence: sentence.trim(),
      status: 'pending', senses: [], synonyms: [], gloss_zh: '', zh_status: 'none',
      created_at: nowIso(), ...newProgress(todayStr()),
    });
    rememberSection(current.id);
    await recordNewWord();
    setMsg(t.saved(w));
    setText(''); setSentence('');
    wordRef.current?.focus();
    runQueue();
    updateBadge();
  }

  return html`
    <section class="page">
      <header class="page-head"><h1>${t.navAdd}</h1></header>
      <div class="panel">
        <label class="field-label">${t.section}</label>
        ${!sections.length || creating
          ? html`<${NewSection} onCreated=${(s) => { setSectionId(s.id); setCreating(false); }} onCancel=${sections.length ? () => setCreating(false) : null} />`
          : html`<div class="row">
              <select value=${current?.id} onChange=${(e) => { setSectionId(e.target.value); rememberSection(e.target.value); }}>
                ${sections.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
              </select>
              <button type="button" class="ghost nowrap" onClick=${() => setCreating(true)}>${t.newSection}</button>
            </div>`}

        <form onSubmit=${submit} class="add-form">
          <label class="field-label" for="w">${t.word}</label>
          <input id="w" ref=${wordRef} class="word-input" value=${text} onInput=${(e) => { setText(e.target.value); setMsg(''); }}
            placeholder=${t.wordPh} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" disabled=${!current} />
          <label class="field-label" for="s">${t.sentence}</label>
          <textarea id="s" rows="3" value=${sentence} onInput=${(e) => setSentence(e.target.value)} placeholder=${t.sentencePh} disabled=${!current}
            onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}></textarea>
          <button class="primary wide" type="submit" disabled=${!text.trim() || !current}>${t.save}</button>
          ${msg && html`<p class="toast-inline">${msg}</p>`}
        </form>
      </div>

      ${recent.length > 0 && html`
        <div class="panel">
          <h3>${t.recentIn}</h3>
          <ul class="word-list">${recent.map((w) => html`<${WordRow} word=${w} />`)}</ul>
        </div>`}
    </section>`;
}

// ====================== Words ======================
function WordRow({ word, onOpen, section }) {
  const { settings, t } = useApp();
  const s = (word.senses || [])[0];
  const sub = word.status !== 'ready' ? t['status_' + word.status]
    : settings.lang === 'zh' ? (word.gloss_zh || s?.def_zh || s?.def_en) : s?.def_en;
  return html`
    <li class="word-row" onClick=${onOpen} tabindex=${onOpen ? 0 : -1} onKeyDown=${(e) => onOpen && e.key === 'Enter' && onOpen()}>
      <div class="wr-main">
        <span class="wr-text">${word.text}</span>
        <span class=${'wr-sub' + (word.status !== 'ready' ? ' muted status-' + word.status : '')}>${sub}</span>
        ${section && html`<span class="muted tiny">${section}</span>`}
      </div>
      ${word.status === 'ready' && html`<span class=${'stage-dot s' + (word.stage || 1)} title=${t.stageLabel(word.stage || 1)}>${word.stage === 2 ? 'II' : 'I'}</span>`}
    </li>`;
}

export function Words({ sectionId }) {
  const { t } = useApp();
  const sections = useLive(allSections, [], null);
  const counts = useLive(async () => {
    const m = {};
    await db.words.each((w) => { if (!w.deleted) m[w.section_id] = (m[w.section_id] || 0) + 1; });
    return m;
  }, [], {});
  const [creating, setCreating] = useState(false);

  if (!sections) return null;
  const section = sectionId && sections.find((s) => s.id === sectionId);
  if (section) return html`<${SectionView} section=${section} sections=${sections} />`;

  return html`
    <section class="page">
      <header class="page-head row-between">
        <h1>${t.sections}</h1>
        <button class="ghost" onClick=${() => setCreating(true)}>${t.newSection}</button>
      </header>
      ${creating && html`<div class="panel"><${NewSection} onCreated=${() => setCreating(false)} onCancel=${() => setCreating(false)} /></div>`}
      ${!sections.length && html`<p class="muted">${t.noSections}</p>`}
      <ul class="section-list">
        ${sections.map((s) => html`
          <li><a href=${'#/words/' + s.id} class="section-card">
            <span class="section-name">${s.name}</span>
            <span class="muted small">${t.words(counts[s.id] || 0)}</span>
          </a></li>`)}
      </ul>
    </section>`;
}

function SectionView({ section, sections }) {
  const { t } = useApp();
  const [sort, setSort] = useState('recent');
  const [openId, setOpenId] = useState(null);
  const words = useLive(() => db.words.where('section_id').equals(section.id).filter((w) => !w.deleted).toArray(), [section.id], []);

  const sorted = useMemo(() => {
    const a = [...words];
    if (sort === 'alpha') a.sort((x, y) => x.text.localeCompare(y.text));
    else if (sort === 'due') a.sort((x, y) => ((x.stage === 2 ? x.s2 : x.s1)?.due || '').localeCompare((y.stage === 2 ? y.s2 : y.s1)?.due || ''));
    else a.sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));
    return a;
  }, [words, sort]);

  async function rename() {
    const name = prompt(t.rename, section.name);
    if (name && name.trim()) await patch('sections', section.id, { name: name.trim() });
  }
  async function del() {
    if (!confirm(t.confirmDeleteSection)) return;
    for (const w of words) await softDelete('words', w.id);
    await softDelete('sections', section.id);
    go('words');
  }

  return html`
    <section class="page">
      <a href="#/words" class="back-link">‹ ${t.sections}</a>
      <header class="page-head row-between">
        <div><h1 class="book-title">${section.name}</h1><p class="muted small">${t.words(words.length)}</p></div>
        <div class="row">
          <button class="ghost" onClick=${rename}>${t.rename}</button>
          <button class="ghost danger" onClick=${del}>${t.delete}</button>
        </div>
      </header>
      <${Segmented} value=${sort} onChange=${setSort} options=${[
        { value: 'recent', label: t.sortRecent }, { value: 'alpha', label: t.sortAlpha }, { value: 'due', label: t.sortDue }]} />
      <ul class="word-list">${sorted.map((w) => html`<${WordRow} key=${w.id} word=${w} onOpen=${() => setOpenId(w.id)} />`)}</ul>
      ${openId && html`<${WordDetail} id=${openId} sections=${sections} onClose=${() => setOpenId(null)} />`}
    </section>`;
}

export function WordDetail({ id, sections, onClose }) {
  const { settings, t } = useApp();
  const word = useLive(() => db.words.get(id), [id], null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [manual, setManual] = useState({ def: '', ex: '' });
  if (!word) return null;
  const secs = sections || [];

  function startEdit() { setForm({ text: word.text, source_sentence: word.source_sentence || '', section_id: word.section_id }); setEditing(true); }
  async function saveEdit() {
    const textChanged = form.text.trim() && form.text.trim() !== word.text;
    const sentenceChanged = form.source_sentence !== (word.source_sentence || '');
    await patch('words', word.id, {
      text: form.text.trim() || word.text, source_sentence: form.source_sentence.trim(), section_id: form.section_id,
      ...(sentenceChanged ? { source_sentence_zh: '', zh_status: word.status === 'ready' ? 'none' : word.zh_status } : {}),
    });
    setEditing(false);
    if (textChanged) regenerate(word.id); else runQueue();
  }
  async function del() {
    if (!confirm(t.confirmDeleteWord)) return;
    await softDelete('words', word.id);
    onClose();
  }
  async function addManual(e) {
    e.preventDefault();
    const cjk = /[一-鿿]/.test(manual.def);
    await patch('words', word.id, {
      status: 'ready', source: 'manual',
      senses: [{ pos: '', def_en: cjk ? '' : manual.def.trim(), def_zh: cjk ? manual.def.trim() : '', example_en: manual.ex.trim(), example_zh: '' }],
      zh_status: cjk ? 'done' : 'none',
    });
    runQueue();
  }

  const track = word.stage === 2 ? word.s2 : word.s1;
  return html`
    <${Modal} onClose=${onClose}>
      <div class="modal-head">
        ${editing
          ? html`<input class="word-input" value=${form.text} onInput=${(e) => setForm({ ...form, text: e.target.value })} />`
          : html`<div><div class="headword left">${word.text}</div>${word.phonetic && html`<div class="phonetic">${word.phonetic}</div>`}</div>`}
        <button class="ghost" onClick=${onClose} aria-label=${t.close}>✕</button>
      </div>

      ${editing ? html`
        <label class="field-label">${t.section}</label>
        <select value=${form.section_id} onChange=${(e) => setForm({ ...form, section_id: e.target.value })}>
          ${secs.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
        </select>
        <label class="field-label">${t.sentence}</label>
        <textarea rows="3" value=${form.source_sentence} onInput=${(e) => setForm({ ...form, source_sentence: e.target.value })}></textarea>
        <div class="row end">
          <button class="ghost" onClick=${() => setEditing(false)}>${t.cancel}</button>
          <button class="primary" onClick=${saveEdit}>${t.save}</button>
        </div>
      ` : html`
        <div class="chips">
          <span class="chip">${t.stageLabel(word.stage || 1)}</span>
          <span class="chip">${t.level} ${track?.level || 0}/${MAX_LEVEL}</span>
          <span class="chip">${t.nextReview} ${track?.due}</span>
        </div>
        ${word.source_sentence && html`<blockquote class="source"><${Highlight} text=${word.source_sentence} target=${word.text} />
          ${settings.lang === 'zh' && word.source_sentence_zh && html`<div class="example-zh">${word.source_sentence_zh}</div>`}</blockquote>`}
        <${Meaning} word=${word} />
        ${word.status === 'failed' && html`
          <form class="manual" onSubmit=${addManual}>
            <h4>${t.manualDef}</h4>
            <input placeholder=${t.definition} value=${manual.def} onInput=${(e) => setManual({ ...manual, def: e.target.value })} />
            <input placeholder=${t.example} value=${manual.ex} onInput=${(e) => setManual({ ...manual, ex: e.target.value })} />
            <button class="primary" disabled=${!manual.def.trim()}>${t.save}</button>
          </form>`}
        ${(word.synonyms || []).length > 0 && html`
          <h4>${t.synonyms}</h4>
          <div class="chips">${word.synonyms.slice(0, 16).map((s) => html`<span class="chip soft">${s}</span>`)}</div>`}
        ${word.source && html`<p class="muted tiny">${t.source}: ${word.source}</p>`}
        <div class="row end actions">
          <button class="ghost" onClick=${startEdit}>${t.edit}</button>
          <button class="ghost" onClick=${() => regenerate(word.id)}>${t.regenerate}</button>
          <button class="ghost danger" onClick=${del}>${t.delete}</button>
        </div>
      `}
    <//>`;
}

// ====================== Search ======================
export function Search() {
  const { t } = useApp();
  const words = useLive(allWords, [], []);
  const sections = useLive(allSections, [], []);
  const [q, setQ] = useState('');
  const [withSyn, setWithSyn] = useState(true);
  const [syn, setSyn] = useState([]);
  const [openId, setOpenId] = useState(null);

  const results = useMemo(() => (q.trim() ? fuzzy(words, q.trim()) : []), [q, words]);
  useEffect(() => {
    if (!withSyn || !q.trim()) { setSyn([]); return; }
    let live = true;
    const h = setTimeout(async () => {
      const r = await synonymSearch(words, q);
      if (live) setSyn(r.filter((w) => !results.includes(w)));
    }, 350);
    return () => { live = false; clearTimeout(h); };
  }, [q, withSyn, words, results]);

  const secName = Object.fromEntries(sections.map((s) => [s.id, s.name]));
  const list = (arr) => html`<ul class="word-list">${arr.map((w) => html`
    <${WordRow} key=${w.id} word=${w} section=${secName[w.section_id]} onOpen=${() => setOpenId(w.id)} />`)}</ul>`;

  return html`
    <section class="page">
      <header class="page-head"><h1>${t.navSearch}</h1></header>
      <input type="search" class="search-input" autofocus value=${q} onInput=${(e) => setQ(e.target.value)} placeholder=${t.searchPh}
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <label class="check-row"><input type="checkbox" checked=${withSyn} onChange=${(e) => setWithSyn(e.target.checked)} /> ${t.includeSyn}</label>
      ${q.trim() && html`
        <h3>${t.results} <span class="muted">${results.length}</span></h3>
        ${results.length ? list(results) : html`<p class="muted">${t.noResults}</p>`}
        ${withSyn && syn.length > 0 && html`<h3>${t.synResults} <span class="muted">${syn.length}</span></h3>${list(syn)}`}`}
      ${openId && html`<${WordDetail} id=${openId} sections=${sections} onClose=${() => setOpenId(null)} />`}
    </section>`;
}

// ====================== Settings ======================
export function Settings() {
  const { settings, t } = useApp();
  const sync = useStore(onSync);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [msg, setMsg] = useState('');
  const [badgeOn, setBadgeOn] = useState(badgeEnabled());
  const fileRef = useRef(null);

  const set = (k) => (e) => updateSettings({ [k]: e.target.type === 'number' ? Math.max(1, Number(e.target.value) || 1) : e.target.value });

  async function doAuth(e) {
    e.preventDefault(); setMsg('');
    try {
      if (mode === 'signup') {
        const signedIn = await signUp(email.trim(), password);
        if (!signedIn) { setMsg(t.confirmSent); setMode('signin'); }
      } else {
        await signIn(email.trim(), password);
      }
      setPassword('');
    } catch (err) {
      const m = err.message || '';
      setMsg(/not confirmed/i.test(m) ? t.notConfirmed : /invalid login/i.test(m) ? t.badLogin : m);
    }
  }
  async function exportJson() {
    const dump = { app: 'novel-words', version: 1, exported_at: nowIso() };
    for (const tb of ['sections', 'words', 'checkins', 'settings']) dump[tb] = await db.table(tb).toArray();
    download(`novel-words-${todayStr()}.json`, JSON.stringify(dump, null, 1), 'application/json');
  }
  async function importJson(e) {
    const f = e.target.files[0];
    if (!f) return;
    const dump = JSON.parse(await f.text());
    let n = 0;
    for (const tb of ['sections', 'words', 'checkins', 'settings']) {
      for (const r of dump[tb] || []) {
        const cur = await db.table(tb).get(r.id);
        if (!cur || (r.updated_at || '') > (cur.updated_at || '')) { await db.table(tb).put({ ...r, dirty: 1 }); n++; }
      }
    }
    setMsg(t.imported(n));
    e.target.value = '';
    runQueue(); syncNow();
  }
  function calendar() {
    const url = location.href.split('#')[0];
    download('novel-words-reminder.ics', reminderIcs(settings.reminder_time, url, t.reminderTitle, t.reminderBody), 'text/calendar');
  }

  return html`
    <section class="page">
      <header class="page-head"><h1>${t.navSettings}</h1></header>

      <div class="panel">
        <label class="field-label">${t.studyLang}</label>
        <${Segmented} value=${settings.lang} onChange=${(v) => { updateSettings({ lang: v }).then(() => runQueue()); }}
          options=${[{ value: 'en', label: t.langEn }, { value: 'zh', label: t.langZh }]} />
        <label class="field-label">${t.reviewMode}</label>
        <select value=${settings.review_mode} onChange=${set('review_mode')}>
          <option value="default">${t.modeDefault}</option>
          <option value="stage1_all">${t.modeStage1}</option>
          <option value="stage2_all">${t.modeStage2}</option>
        </select>
        <label class="field-label">${t.dailyGoal}</label>
        <input type="number" min="1" max="500" value=${settings.daily_goal} onChange=${set('daily_goal')} />
      </div>

      <div class="panel">
        <h3>${t.reminder}</h3>
        <div class="row">
          <input type="time" value=${settings.reminder_time} onChange=${set('reminder_time')} />
          <button class="ghost nowrap" onClick=${calendar}>${t.addToCalendar}</button>
        </div>
        <p class="muted small">${t.reminderHint}</p>
        <h3>${t.badge}</h3>
        <label class="check-row"><input type="checkbox" checked=${badgeOn} disabled=${badgeOn}
          onChange=${async () => setBadgeOn(await enableBadge())} /> ${t.enableBadge}</label>
        <p class="muted small">${t.badgeHint}</p>
      </div>

      <div class="panel">
        <h3>${t.account}</h3>
        ${!syncConfigured() ? html`<p class="muted small">${t.syncOff}</p>`
          : sync.user ? html`
            <p>${t.signedInAs(sync.user.email)}</p>
            <p class="muted small">${sync.syncing ? t.syncing : sync.lastSync ? `${t.lastSync}: ${sync.lastSync.toLocaleTimeString()}` : ''}</p>
            ${sync.error && html`<p class="warn small">${sync.error}</p>`}
            <div class="row"><button class="ghost" onClick=${syncNow}>${t.syncNow}</button><button class="ghost" onClick=${signOut}>${t.signOut}</button></div>`
          : html`
            <form class="auth-form" onSubmit=${doAuth}>
              <input type="email" required placeholder=${t.email} value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="email" autocapitalize="off" />
              <input type="password" required minlength="6" placeholder=${t.password} value=${password} onInput=${(e) => setPassword(e.target.value)}
                autocomplete=${mode === 'signup' ? 'new-password' : 'current-password'} />
              <button class="primary">${mode === 'signup' ? t.signUp : t.signIn}</button>
              <button type="button" class="link" onClick=${() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg(''); }}>
                ${mode === 'signup' ? t.haveAccount : t.noAccount}</button>
            </form>`}
      </div>

      <div class="panel">
        <h3>${t.translation}</h3>
        <label class="field-label">${t.mmEmail}</label>
        <input type="email" value=${settings.mymemory_email} onChange=${set('mymemory_email')} />
      </div>

      <div class="panel">
        <h3>${t.backup}</h3>
        <div class="row">
          <button class="ghost" onClick=${exportJson}>${t.exportJson}</button>
          <button class="ghost" onClick=${() => fileRef.current.click()}>${t.importJson}</button>
          <input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${importJson} />
        </div>
        <h3>${t.install}</h3>
        <p class="muted small">${t.installHint}</p>
      </div>
      ${msg && html`<p class="toast-inline">${msg}</p>`}
    </section>`;
}
