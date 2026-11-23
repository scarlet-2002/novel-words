// Two-way sync between local IndexedDB and a single Supabase table `records`.
// Local writes mark records dirty; we push dirty rows and pull rows whose
// server_updated_at is newer than our cursor. Conflicts: last write (updated_at) wins,
// enforced both here and by a trigger on the server.
import { db, getMeta, setMeta, onLocalChange } from './db.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const KINDS = { sections: 'section', words: 'word', checkins: 'checkin', settings: 'settings' };
const TABLE_OF = Object.fromEntries(Object.entries(KINDS).map(([t, k]) => [k, t]));

export const syncConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;
export function client() {
  if (!syncConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('supabase').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }));
  }
  return clientPromise;
}

const state = { user: null, syncing: false, lastSync: null, error: '' };
const subs = new Set();
export const onSync = (fn) => { subs.add(fn); fn({ ...state }); return () => subs.delete(fn); };
const emit = (p) => { Object.assign(state, p); subs.forEach((fn) => fn({ ...state })); };

/** Create an account. Returns true when signed in immediately (email confirmation turned off). */
export async function signUp(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) { emit({ user: data.user }); await syncNow(); return true; }
  return false; // confirmation email sent; sign in after clicking the link
}

export async function signIn(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  emit({ user: data.user });
  await syncNow();
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  await setMeta('pull_cursor', null);
  emit({ user: null });
}

function strip(rec) {
  const { dirty, ...rest } = rec;
  return rest;
}

async function push(sb, userId) {
  for (const [table, kind] of Object.entries(KINDS)) {
    const dirty = await db.table(table).where('dirty').equals(1).toArray();
    for (let i = 0; i < dirty.length; i += 200) {
      const chunk = dirty.slice(i, i + 200);
      const rows = chunk.map((r) => ({
        user_id: userId, kind, id: r.id, updated_at: r.updated_at, deleted: !!r.deleted, data: strip(r),
      }));
      const { error } = await sb.from('records').upsert(rows, { onConflict: 'user_id,kind,id' });
      if (error) throw error;
      await db.transaction('rw', db.table(table), async () => {
        for (const r of chunk) {
          const cur = await db.table(table).get(r.id);
          if (cur && cur.updated_at === r.updated_at) await db.table(table).update(r.id, { dirty: 0 });
        }
      });
    }
  }
}

async function pull(sb) {
  let cursor = await getMeta('pull_cursor');
  // Re-read a small overlap window so rows committed slightly out of order are not missed
  // (applying a row twice is harmless).
  if (cursor) cursor = new Date(new Date(cursor).getTime() - 10_000).toISOString();
  for (;;) {
    let q = sb.from('records').select('kind,id,updated_at,deleted,data,server_updated_at').order('server_updated_at').limit(500);
    if (cursor) q = q.gt('server_updated_at', cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) {
      const table = TABLE_OF[row.kind];
      if (!table) continue;
      const local = await db.table(table).get(row.id);
      if (local && local.dirty && local.updated_at > row.updated_at) continue; // ours is newer; it will be pushed
      await db.table(table).put({ ...row.data, id: row.id, updated_at: row.updated_at, deleted: row.deleted ? 1 : 0, dirty: 0 });
    }
    cursor = data.at(-1).server_updated_at;
    await setMeta('pull_cursor', cursor);
    if (data.length < 500) break;
  }
}

let again = false;
export async function syncNow() {
  if (!syncConfigured() || !navigator.onLine) return;
  if (state.syncing) { again = true; return; }
  const sb = await client();
  const { data } = await sb.auth.getSession();
  const user = data.session?.user || null;
  emit({ user });
  if (!user) return;
  emit({ syncing: true, error: '' });
  try {
    await push(sb, user.id);
    await pull(sb);
    emit({ lastSync: new Date() });
  } catch (e) {
    console.error(e);
    emit({ error: e.message || String(e) });
  } finally {
    emit({ syncing: false });
    if (again) { again = false; setTimeout(syncNow, 300); }
  }
}

let timer = null;
export function startSync() {
  if (!syncConfigured()) return;
  onLocalChange(() => { clearTimeout(timer); timer = setTimeout(syncNow, 2000); });
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);
  syncNow();
}
