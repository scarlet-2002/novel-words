// Local-first storage (IndexedDB via Dexie). Every record carries
// id, updated_at (ISO), deleted (0/1) and dirty (0/1 = needs pushing to Supabase).
import Dexie, { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

export const db = new Dexie('novel-vocab');
db.version(1).stores({
  sections: 'id, dirty, updated_at',
  words: 'id, section_id, status, dirty, updated_at',
  checkins: 'id, date, dirty, updated_at',
  settings: 'id, dirty',
  meta: 'key',
});

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

/** Local calendar date as YYYY-MM-DD. */
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function deviceId() {
  let id = null;
  try { id = localStorage.getItem('nv-device'); } catch {}
  if (!id) {
    id = uuid().slice(0, 8);
    try { localStorage.setItem('nv-device', id); } catch {}
  }
  return id;
}

const listeners = new Set();
/** Subscribe to local writes (used by sync to schedule a push). */
export const onLocalChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Save a record, stamping it as changed and dirty. */
export async function save(table, rec) {
  const out = { deleted: 0, ...rec, updated_at: nowIso(), dirty: 1 };
  await db.table(table).put(out);
  listeners.forEach((fn) => fn(table));
  return out;
}

export async function patch(table, id, changes) {
  const cur = await db.table(table).get(id);
  if (!cur) return null;
  return save(table, { ...cur, ...changes });
}

export const softDelete = (table, id) => patch(table, id, { deleted: 1 });

export async function getMeta(key, fallback = null) {
  const r = await db.meta.get(key);
  return r ? r.value : fallback;
}
export const setMeta = (key, value) => db.meta.put({ key, value });

// ---------- Settings ----------
export const DEFAULT_SETTINGS = {
  id: 'main',
  lang: 'zh',               // 'en' = all-English study, 'zh' = Chinese-context study
  review_mode: 'default',   // 'default' | 'stage1_all' | 'stage2_all'
  daily_goal: 20,
  reminder_time: '21:00',
  mymemory_email: '',
};

export async function getSettings() {
  const s = await db.settings.get('main');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function updateSettings(changes) {
  const s = await getSettings();
  return save('settings', { ...s, ...changes });
}

// ---------- Live queries for Preact ----------
export function useLive(fn, deps = [], initial = undefined) {
  const [val, setVal] = useState(initial);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setVal, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, deps);
  return val;
}

export const liveSettings = () => getSettings();
export const allSections = () =>
  db.sections.filter((s) => !s.deleted).toArray().then((a) => a.sort((x, y) => (y.created_at || '').localeCompare(x.created_at || '')));
export const allWords = () => db.words.filter((w) => !w.deleted).toArray();
