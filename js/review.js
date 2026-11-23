// Review session: stage 1 (see word → rate → see meaning) and stage 2 (fill the blank).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, useApp, Meaning, Highlight, shuffle, go } from './ui.js';
import { db, patch, todayStr } from './db.js';
import { rate, stageFor, isDue } from './srs.js';
import { makeCloze, grade } from './cloze.js';
import { recordReview } from './checkin.js';
import { updateBadge } from './badge.js';

export function Review() {
  const { settings, t } = useApp();
  const [queue, setQueue] = useState(null);
  const [idx, setIdx] = useState(0);
  const [words, setWords] = useState({});
  const [sections, setSections] = useState({});
  const reviewed = useRef(new Set());
  const requeued = useRef(new Set());

  useEffect(() => {
    (async () => {
      const today = todayStr();
      const all = await db.words.filter((w) => !w.deleted && w.status === 'ready').toArray();
      const due = all.filter((w) => isDue(w, settings.review_mode, today));
      const secs = await db.sections.toArray();
      setSections(Object.fromEntries(secs.map((s) => [s.id, s.name])));
      setWords(Object.fromEntries(all.map((w) => [w.id, w])));
      // Stage-1 cards first, then stage-2, each shuffled.
      const q1 = shuffle(due.filter((w) => stageFor(w, settings.review_mode) === 1));
      const q2 = shuffle(due.filter((w) => stageFor(w, settings.review_mode) === 2));
      setQueue([...q1, ...q2].map((w) => ({ id: w.id, stage: stageFor(w, settings.review_mode) })));
    })();
  }, []);

  if (!queue) return html`<div class="review"><p class="muted center">…</p></div>`;

  const exit = html`<button class="ghost exit" onClick=${() => go('today')}>✕ ${t.exit}</button>`;

  if (!queue.length) {
    return html`<div class="review">${exit}<div class="card done"><h2>${t.nothingDue}</h2>
      <button class="primary" onClick=${() => go('today')}>${t.back}</button></div></div>`;
  }

  if (idx >= queue.length) {
    return html`<div class="review">
      <div class="card done">
        <div class="done-mark">✓</div>
        <h2>${t.done}</h2>
        <p class="muted">${t.doneSub(reviewed.current.size)}</p>
        <button class="primary" onClick=${() => go('today')}>${t.finish}</button>
      </div></div>`;
  }

  const item = queue[idx];
  const word = words[item.id];

  async function onRated(rating) {
    const res = rate(word, item.stage, rating, settings.review_mode, todayStr());
    const updated = await patch('words', word.id, { stage: res.stage, s1: res.s1, s2: res.s2 });
    setWords((m) => ({ ...m, [word.id]: updated }));
    reviewed.current.add(word.id);
    await recordReview(word.id);
    if (res.requeue && !requeued.current.has(word.id)) {
      requeued.current.add(word.id);
      setQueue((q) => [...q, { id: word.id, stage: item.stage }]);
    }
    updateBadge();
    return res;
  }

  const next = () => setIdx((i) => i + 1);

  return html`
    <div class="review">
      <div class="review-top">
        ${exit}
        <span class="muted">${t.progress(idx + 1, queue.length)}</span>
      </div>
      <div class="bar"><div style=${{ width: `${(idx / queue.length) * 100}%` }}></div></div>
      ${item.stage === 1
        ? html`<${Stage1} key=${idx} word=${word} section=${sections[word.section_id]} onRated=${onRated} onNext=${next} />`
        : html`<${Stage2} key=${idx} word=${word} section=${sections[word.section_id]} onRated=${onRated} onNext=${next} />`}
    </div>`;
}

function useKeys(handler, deps) {
  useEffect(() => {
    const k = (e) => { if (!e.metaKey && !e.ctrlKey) handler(e); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, deps);
}

function Stage1({ word, section, onRated, onNext }) {
  const { t } = useApp();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function choose(r) {
    if (busy || result) return;
    setBusy(true);
    const res = await onRated(r);
    setResult({ rating: r, ...res });
    setBusy(false);
  }
  useKeys((e) => {
    if (!result) {
      if (e.key === '1') choose('familiar');
      if (e.key === '2') choose('soso');
      if (e.key === '3') choose('unfamiliar');
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNext(); }
  }, [result, busy]);

  return html`
    <div class="card">
      <div class="card-meta"><span class="chip">${t.dueStage1}</span><span class="muted small">${section}</span></div>
      <div class="headword">${word.text}</div>
      ${word.phonetic && html`<div class="phonetic">${word.phonetic}</div>`}
      ${!result ? html`
        <div class="rate">
          <button class="rate-btn good" onClick=${() => choose('familiar')}><b>${t.familiar}</b><kbd>1</kbd></button>
          <button class="rate-btn mid" onClick=${() => choose('soso')}><b>${t.soso}</b><kbd>2</kbd></button>
          <button class="rate-btn bad" onClick=${() => choose('unfamiliar')}><b>${t.unfamiliar}</b><kbd>3</kbd></button>
        </div>` : html`
        <div class="back">
          <div class=${'verdict ' + result.rating}>${t[result.rating]}</div>
          ${result.promoted && html`<div class="note">${t.promoted}</div>`}
          <${Meaning} word=${word} />
          ${word.source_sentence && html`<blockquote class="source"><${Highlight} text=${word.source_sentence} target=${word.text} /></blockquote>`}
          <button class="primary wide" onClick=${onNext}>${t.next} ↵</button>
        </div>`}
    </div>`;
}

function Stage2({ word, section, onRated, onNext }) {
  const { settings, t } = useApp();
  const cloze = useMemo(() => makeCloze(word), [word.id]);
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const nextRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (result) nextRef.current?.focus(); }, [result]);

  async function submit(dontKnow = false) {
    if (result) return;
    const rating = dontKnow ? 'unfamiliar' : grade(input, cloze, word.text);
    const res = await onRated(rating);
    setResult({ rating, ...res });
  }

  const zh = settings.lang === 'zh';
  const parts = cloze.kind === 'sentence' ? cloze.blanked.split('_____') : [];

  return html`
    <div class="card">
      <div class="card-meta"><span class="chip">${t.dueStage2}</span><span class="muted small">${section}</span></div>
      ${cloze.kind === 'sentence' ? html`
        <p class="cloze">
          ${parts.map((p, i) => html`${p}${i < parts.length - 1 && html`<span class=${'blank' + (result ? ' filled' : '')}>${result ? cloze.answers[i] : ' '.repeat(8)}</span>`}`)}
        </p>
        ${result && zh && cloze.translation && html`<p class="example-zh">${cloze.translation}</p>`}
      ` : html`
        <p class="muted small">${t.defPrompt}</p>
        <p class="cloze">${zh && cloze.promptZh ? cloze.promptZh : cloze.prompt}</p>
        ${zh && cloze.promptZh && cloze.prompt && html`<p class="def-en">${cloze.prompt}</p>`}
      `}
      ${!result ? html`
        <form class="answer" onSubmit=${(e) => { e.preventDefault(); submit(); }}>
          <input ref=${inputRef} value=${input} onInput=${(e) => setInput(e.target.value)}
            placeholder=${t.typeAnswer} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <div class="row">
            <button type="submit" class="primary" disabled=${!input.trim()}>${t.check}</button>
            <button type="button" class="ghost" onClick=${() => submit(true)}>${t.dontKnow}</button>
          </div>
        </form>` : html`
        <div class="back">
          <div class=${'verdict ' + result.rating}>
            ${result.rating === 'familiar' ? t.correct : result.rating === 'soso' ? (input.trim().toLowerCase() === word.text.toLowerCase() ? t.formHint : t.close_) : t.wrong}
            ${result.rating !== 'familiar' && html` ${t.answer}: <b>${cloze.answer}</b>`}
            ${input && result.rating !== 'familiar' && html` <span class="muted">(${input})</span>`}
          </div>
          ${result.demoted && html`<div class="note">${t.demoted}</div>`}
          <div class="headword small">${word.text}</div>
          <${Meaning} word=${word} compact=${true} />
          <button ref=${nextRef} class="primary wide" onClick=${onNext}>${t.next} ↵</button>
        </div>`}
    </div>`;
}
