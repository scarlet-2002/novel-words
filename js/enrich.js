// Generate meanings, examples, Chinese translations and synonyms for new words.
// Words are saved immediately as status 'pending'; this queue fills them in whenever
// the device is online (on launch, on reconnect, when the app comes to the foreground).
import { db, patch, getSettings, getMeta, setMeta, todayStr } from './db.js';

class Offline extends Error {}
class Quota extends Error {}

const MAX_SENSES = 3;

async function getJson(url, timeoutMs = 12000) {
  let res;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try { res = await fetch(url, { signal: ctl.signal }); } catch { throw new Offline('network'); } finally { clearTimeout(timer); }
  if (res.status === 404) return null;
  if (res.status === 429) throw new Quota('rate limited');
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Pick up to 3 main senses: first sense of each part of speech, then fill with ones that have examples. */
function pickSenses(groups) {
  const chosen = [];
  const rest = [];
  for (const g of groups) {
    g.defs.forEach((d, i) => (i === 0 ? chosen : rest).push({ pos: g.pos, ...d }));
  }
  const out = chosen.slice(0, MAX_SENSES);
  rest.sort((a, b) => (b.example_en ? 1 : 0) - (a.example_en ? 1 : 0));
  for (const d of rest) { if (out.length >= MAX_SENSES) break; out.push(d); }
  // If a chosen sense lacks an example, borrow nothing — but make sure at least one example exists if possible.
  if (!out.some((s) => s.example_en)) {
    const withEx = rest.find((d) => d.example_en && !out.includes(d));
    if (withEx) out[out.length - 1] = withEx;
  }
  return out.map((s) => ({ pos: s.pos || '', def_en: s.def_en, def_zh: '', example_en: s.example_en || '', example_zh: '' }));
}

async function fromFreeDictionary(text) {
  const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text.toLowerCase())}`);
  if (!Array.isArray(data) || !data.length) return null;
  const syn = new Set();
  const groups = [];
  for (const entry of data) {
    for (const m of entry.meanings || []) {
      (m.synonyms || []).forEach((s) => syn.add(s));
      const defs = (m.definitions || []).map((d) => {
        (d.synonyms || []).forEach((s) => syn.add(s));
        return { def_en: d.definition, example_en: d.example || '' };
      }).filter((d) => d.def_en);
      if (defs.length) groups.push({ pos: m.partOfSpeech, defs });
    }
  }
  if (!groups.length) return null;
  const phonetic = data.map((e) => e.phonetic || (e.phonetics || []).find((p) => p.text)?.text).find(Boolean) || '';
  return { senses: pickSenses(groups), synonyms: [...syn], phonetic, source: 'dictionaryapi.dev' };
}

const SKIP_DEF = /^(\(?(obsolete|archaic|dated|rare)\b)|^(plural of|alternative (form|spelling) of|obsolete form of)/i;

async function fromWiktionary(text) {
  const title = encodeURIComponent(text.trim().replace(/ /g, '_'));
  let data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${title}`);
  if (!data?.en && text !== text.toLowerCase()) data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(text.toLowerCase().replace(/ /g, '_'))}`);
  if (!data?.en) return null;
  const groups = [];
  for (const g of data.en) {
    const defs = (g.definitions || []).map((d) => {
      const def = stripHtml(d.definition);
      const exs = [
        ...(d.parsedExamples || []).map((e) => stripHtml(e.example)),
        ...(d.examples || []).map(stripHtml),
      ].filter((e) => e && e.length <= 220);
      return { def_en: def, example_en: exs[0] || '' };
    }).filter((d) => d.def_en && !SKIP_DEF.test(d.def_en));
    if (defs.length) groups.push({ pos: (g.partOfSpeech || '').toLowerCase(), defs });
  }
  if (!groups.length) return null;
  return { senses: pickSenses(groups), synonyms: [], phonetic: '', source: 'wiktionary' };
}

async function fromDatamuse(text) {
  const data = await getJson(`https://api.datamuse.com/words?sp=${encodeURIComponent(text.toLowerCase())}&md=d&max=1`);
  const hit = Array.isArray(data) && data[0];
  if (!hit || !hit.defs || hit.word.toLowerCase() !== text.toLowerCase()) return null;
  const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
  const senses = hit.defs.slice(0, MAX_SENSES).map((d) => {
    const [p, def] = d.split('\t');
    return { pos: POS[p] || p, def_en: def, def_zh: '', example_en: '', example_zh: '' };
  });
  return { senses, synonyms: [], phonetic: '', source: 'datamuse' };
}

export async function fetchSynonyms(text, max = 12, timeoutMs = 12000) {
  const q = encodeURIComponent(text.toLowerCase());
  const [syn, ml] = await Promise.all([
    getJson(`https://api.datamuse.com/words?rel_syn=${q}&max=${max}`, timeoutMs),
    getJson(`https://api.datamuse.com/words?ml=${q}&max=${max}`, timeoutMs),
  ]);
  const out = new Set();
  for (const r of [...(syn || []), ...(ml || [])]) if (r.word && r.word !== text.toLowerCase()) out.add(r.word);
  return [...out];
}

// ---------- Translation (MyMemory) ----------
async function translate(text, email) {
  if (!text) return '';
  const u = new URL('https://api.mymemory.translated.net/get');
  u.searchParams.set('q', text.slice(0, 480));
  u.searchParams.set('langpair', 'en|zh-CN');
  if (email) u.searchParams.set('de', email);
  const j = await getJson(u.toString());
  if (!j) return '';
  const t = j.responseData?.translatedText || '';
  if (Number(j.responseStatus) === 429 || /MYMEMORY WARNING|QUOTA|LIMIT EXCEEDED/i.test(t)) throw new Quota('translation quota');
  if (Number(j.responseStatus) !== 200) return '';
  return t;
}

async function translateWord(word, email) {
  const senses = [];
  for (const s of word.senses || []) {
    senses.push({
      ...s,
      def_zh: s.def_zh || await translate(s.def_en, email),
      example_zh: s.example_zh || (s.example_en ? await translate(s.example_en, email) : ''),
    });
  }
  return {
    senses,
    gloss_zh: word.gloss_zh || await translate(word.text, email),
    source_sentence_zh: word.source_sentence ? (word.source_sentence_zh || await translate(word.source_sentence, email)) : '',
    zh_status: 'done',
  };
}

/** Look up one word. Throws Offline when the network is unavailable. */
export async function lookup(text) {
  let r = await fromFreeDictionary(text);
  if (!r || !r.senses.some((s) => s.example_en)) {
    const w = await fromWiktionary(text).catch((e) => { if (e instanceof Offline) throw e; return null; });
    if (w && (!r || w.senses.some((s) => s.example_en))) r = { ...w, synonyms: r?.synonyms || [], phonetic: r?.phonetic || '' };
  }
  if (!r) r = await fromDatamuse(text);
  if (!r) return null;
  const more = await fetchSynonyms(text).catch(() => []);
  r.synonyms = [...new Set([...r.synonyms, ...more])].slice(0, 30);
  return r;
}

// ---------- Queue ----------
const state = { running: false, message: '' };
const subs = new Set();
export const onQueue = (fn) => { subs.add(fn); fn(state); return () => subs.delete(fn); };
const emit = (patchObj) => { Object.assign(state, patchObj); subs.forEach((fn) => fn({ ...state })); };

let again = false;
export async function runQueue() {
  if (state.running) { again = true; return; }
  if (!navigator.onLine) return;
  emit({ running: true, message: '' });
  try {
    const settings = await getSettings();
    const pending = await db.words.filter((w) => !w.deleted && w.status === 'pending').toArray();
    for (const w of pending) {
      const r = await lookup(w.text);
      if (!r) { await patch('words', w.id, { status: 'failed' }); continue; }
      await patch('words', w.id, { status: 'ready', senses: r.senses, synonyms: r.synonyms, phonetic: r.phonetic, source: r.source, zh_status: 'none' });
    }

    if (settings.lang === 'zh') {
      const blockedUntil = await getMeta('translate_blocked_until');
      if (!blockedUntil || blockedUntil <= todayStr()) {
        const need = await db.words.filter((w) => !w.deleted && w.status === 'ready' && w.zh_status !== 'done').toArray();
        for (const w of need) {
          try {
            await patch('words', w.id, await translateWord(w, settings.mymemory_email));
          } catch (e) {
            if (e instanceof Quota) {
              const d = new Date(); d.setDate(d.getDate() + 1);
              await setMeta('translate_blocked_until', todayStr(d));
              emit({ message: 'quota' });
              break;
            }
            throw e;
          }
        }
      }
    }
  } catch (e) {
    if (!(e instanceof Offline)) { console.error(e); emit({ message: 'error' }); }
  } finally {
    emit({ running: false });
    if (again) { again = false; setTimeout(runQueue, 500); }
  }
}

/** Re-generate a word from scratch (keeps review progress). */
export async function regenerate(id) {
  await patch('words', id, { status: 'pending', senses: [], gloss_zh: '', source_sentence_zh: '', zh_status: 'none' });
  runQueue();
}

export function startQueueTriggers() {
  window.addEventListener('online', () => runQueue());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runQueue(); });
  runQueue();
}
