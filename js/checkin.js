// Daily check-ins. One record per (date, device) so two devices never overwrite each other;
// a day's totals are the union across devices.
import { db, save, todayStr, deviceId, getSettings } from './db.js';
import { addDays, isDue } from './srs.js';

async function todayRecord() {
  const date = todayStr();
  const id = `${date}_${deviceId()}`;
  return (await db.checkins.get(id)) || { id, date, device: deviceId(), word_ids: [], new_words: 0, completed: false };
}

export async function dueCount(mode, today = todayStr()) {
  const words = await db.words.filter((w) => !w.deleted && w.status === 'ready' && isDue(w, mode, today)).count();
  return words;
}

export async function dayTotals(date) {
  const recs = await db.checkins.where('date').equals(date).filter((r) => !r.deleted).toArray();
  const ids = new Set();
  let added = 0;
  let completed = false;
  for (const r of recs) { (r.word_ids || []).forEach((i) => ids.add(i)); added += r.new_words || 0; completed ||= !!r.completed; }
  return { reviewed: ids.size, added, completed };
}

/** Mark today complete once the goal is met or nothing is left to review. */
export async function refreshCompletion() {
  const settings = await getSettings();
  const t = await dayTotals(todayStr());
  if (t.completed) return true;
  const remaining = await dueCount(settings.review_mode);
  // Checking in means reviewing: hit the daily goal, or clear everything that was due.
  const done = t.reviewed >= settings.daily_goal || (remaining === 0 && t.reviewed > 0);
  if (done) {
    const rec = await todayRecord();
    await save('checkins', { ...rec, completed: true });
  }
  return done;
}

export async function recordReview(wordId) {
  const rec = await todayRecord();
  if (!rec.word_ids.includes(wordId)) {
    await save('checkins', { ...rec, word_ids: [...rec.word_ids, wordId] });
  }
  await refreshCompletion();
}

export async function recordNewWord() {
  const rec = await todayRecord();
  await save('checkins', { ...rec, new_words: (rec.new_words || 0) + 1 });
  await refreshCompletion();
}

/** Map of date -> {reviewed, added, completed} for every day with activity. */
export async function history() {
  const recs = await db.checkins.filter((r) => !r.deleted).toArray();
  const byDate = {};
  for (const r of recs) {
    const d = (byDate[r.date] ||= { ids: new Set(), added: 0, completed: false });
    (r.word_ids || []).forEach((i) => d.ids.add(i));
    d.added += r.new_words || 0;
    d.completed ||= !!r.completed;
  }
  const out = {};
  for (const [k, v] of Object.entries(byDate)) out[k] = { reviewed: v.ids.size, added: v.added, completed: v.completed };
  return out;
}

export function streak(hist, today = todayStr()) {
  let d = hist[today]?.completed ? today : addDays(today, -1);
  let n = 0;
  while (hist[d]?.completed) { n++; d = addDays(d, -1); }
  return n;
}

/** A daily repeating calendar event (with alert) the user can add to Apple Calendar. */
export function reminderIcs(time, appUrl, title, body) {
  const [hh, mm] = (time || '21:00').split(':');
  const start = todayStr().replace(/-/g, '') + `T${hh}${mm}00`;
  const end = todayStr().replace(/-/g, '') + `T${hh}${String(Math.min(59, Number(mm) + 15)).padStart(2, '0')}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Novel Words//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:novel-words-daily-${Date.now()}@novel-words`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`, `DTEND:${end}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${title}`,
    `DESCRIPTION:${body}\\n${appUrl}`,
    `URL:${appUrl}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
