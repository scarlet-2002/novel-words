// Spaced repetition on an Ebbinghaus-style schedule. Pure functions, no I/O.
//
// Each word has two independent tracks:
//   s1 — stage 1, "see the word, recall the meaning"
//   s2 — stage 2, "fill the blank in an example sentence"
// and `stage` (1 or 2) says which track it is on in the default review mode.

export const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60]; // days after reaching each level
export const MAX_LEVEL = INTERVALS.length - 1;
// Default mode promotes a word to stage 2 once it is solidly known by sight.
export const PROMOTE_STREAK = 2;
export const PROMOTE_LEVEL = 3;
// Stage 2 sends a word back to stage 1 after this many misses in a row.
export const DEMOTE_FAILS = 2;

export const RATINGS = ['familiar', 'soso', 'unfamiliar'];

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function newProgress(today) {
  return {
    stage: 1,
    s1: { level: 0, due: today, streak: 0, reviews: 0, last: null },
    s2: { level: 0, due: today, streak: 0, fails: 0, reviews: 0, last: null },
  };
}

/** Which stage a word is quizzed on under the given review mode. */
export function stageFor(word, mode) {
  if (mode === 'stage1_all') return 1;
  if (mode === 'stage2_all') return 2;
  return word.stage === 2 ? 2 : 1;
}

export function isDue(word, mode, today) {
  const st = stageFor(word, mode);
  const track = st === 1 ? word.s1 : word.s2;
  return !!track && track.due <= today;
}

function step(track, rating, today) {
  const t = { ...track, reviews: (track.reviews || 0) + 1, last: today };
  if (rating === 'familiar') {
    t.level = Math.min((t.level || 0) + 1, MAX_LEVEL);
    t.streak = (t.streak || 0) + 1;
    t.due = addDays(today, INTERVALS[t.level]);
  } else if (rating === 'soso') {
    t.level = Math.max(t.level || 0, 0);
    t.streak = 0;
    t.due = addDays(today, 1);
  } else {
    t.level = 0;
    t.streak = 0;
    t.due = today; // see it again today
  }
  return t;
}

/**
 * Apply a rating. Returns { stage, s1, s2, requeue, promoted, demoted }.
 * `requeue` means the card should come back later in the same session.
 */
export function rate(word, stage, rating, mode, today) {
  let s1 = { ...word.s1 };
  let s2 = { ...word.s2 };
  let next = word.stage === 2 ? 2 : 1;
  let promoted = false;
  let demoted = false;

  if (stage === 1) {
    s1 = step(s1, rating, today);
    if (mode === 'default' && next === 1 && s1.streak >= PROMOTE_STREAK && s1.level >= PROMOTE_LEVEL) {
      next = 2;
      promoted = true;
      s2 = { ...s2, level: 0, streak: 0, fails: 0, due: addDays(today, 1) };
    }
  } else {
    s2 = step(s2, rating, today);
    s2.fails = rating === 'unfamiliar' ? (s2.fails || 0) + 1 : 0;
    if (mode === 'default' && next === 2 && s2.fails >= DEMOTE_FAILS) {
      next = 1;
      demoted = true;
      s1 = { ...s1, level: Math.max(0, (s1.level || 0) - 2), streak: 0, due: addDays(today, 1) };
      s2 = { ...s2, fails: 0 };
    }
  }
  return { stage: next, s1, s2, requeue: rating === 'unfamiliar' && !demoted, promoted, demoted };
}

/** Rough mastery 0..1 for display. */
export function mastery(word) {
  const l1 = word.s1?.level || 0;
  const l2 = word.s2?.level || 0;
  return Math.min(1, (l1 + l2) / (MAX_LEVEL * 2));
}
