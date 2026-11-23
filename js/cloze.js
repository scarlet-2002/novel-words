// Build fill-in-the-blank prompts from example sentences and grade answers. Pure functions.

const BLANK = '_____';

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const IRREGULAR = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'], go: ['goes', 'went', 'gone', 'going'],
  take: ['took', 'taken', 'takes', 'taking'], give: ['gave', 'given'], get: ['got', 'gotten'],
  make: ['made'], come: ['came'], see: ['saw', 'seen'], know: ['knew', 'known'],
  think: ['thought'], bring: ['brought'], buy: ['bought'], catch: ['caught'], teach: ['taught'],
  seek: ['sought'], fight: ['fought'], find: ['found'], tell: ['told'], sell: ['sold'],
  hold: ['held'], stand: ['stood'], understand: ['understood'], keep: ['kept'], sleep: ['slept'],
  feel: ['felt'], leave: ['left'], mean: ['meant'], meet: ['met'], run: ['ran'], sit: ['sat'],
  speak: ['spoke', 'spoken'], break: ['broke', 'broken'], choose: ['chose', 'chosen'],
  forget: ['forgot', 'forgotten'], write: ['wrote', 'written'], ride: ['rode', 'ridden'],
  rise: ['rose', 'risen'], drive: ['drove', 'driven'], fall: ['fell', 'fallen'], eat: ['ate', 'eaten'],
  begin: ['began', 'begun'], drink: ['drank', 'drunk'], swim: ['swam', 'swum'], sing: ['sang', 'sung'],
  lie: ['lay', 'lain', 'lying', 'lied'], lay: ['laid'], pay: ['paid'], say: ['said'], put: ['put'],
  set: ['set'], let: ['let'], cut: ['cut'], hit: ['hit'], bear: ['bore', 'borne'], wear: ['wore', 'worn'],
  tear: ['tore', 'torn'], swear: ['swore', 'sworn'], hide: ['hid', 'hidden'], shake: ['shook', 'shaken'],
  wake: ['woke', 'woken'], throw: ['threw', 'thrown'], grow: ['grew', 'grown'], fly: ['flew', 'flown'],
  draw: ['drew', 'drawn'], dig: ['dug'], cling: ['clung'], fling: ['flung'], wring: ['wrung'],
  slay: ['slew', 'slain'], forsake: ['forsook', 'forsaken'], beget: ['begat', 'begot'],
};

const VOWELS = 'aeiou';

/** Plausible inflected forms of a single word (over-generation is fine). */
export function inflections(word) {
  const w = word.toLowerCase();
  const forms = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'er', w + 'est', w + 'ly', w + "'s"]);
  if (w.endsWith('e')) { forms.add(w.slice(0, -1) + 'ing'); forms.add(w.slice(0, -1) + 'ly'); }
  if (w.endsWith('ie')) forms.add(w.slice(0, -2) + 'ying');
  if (w.endsWith('y') && !VOWELS.includes(w.at(-2))) {
    const b = w.slice(0, -1);
    ['ies', 'ied', 'ier', 'iest', 'ily', 'iness'].forEach((s) => forms.add(b + s));
  }
  if (w.endsWith('le')) forms.add(w.slice(0, -1) + 'y'); // gentle -> gently
  if (w.endsWith('ic')) forms.add(w + 'ally');
  const last = w.at(-1);
  if (w.length >= 3 && !VOWELS.includes(last) && VOWELS.includes(w.at(-2)) && !VOWELS.includes(w.at(-3)) && !'wxy'.includes(last)) {
    forms.add(w + last + 'ed'); forms.add(w + last + 'ing'); forms.add(w + last + 'er');
  }
  (IRREGULAR[w] || []).forEach((f) => forms.add(f));
  return forms;
}

function tokenize(sentence) {
  const out = [];
  const re = /[A-Za-z0-9’']+(?:-[A-Za-z0-9’']+)*/g;
  let m;
  while ((m = re.exec(sentence))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length, norm: normalize(m[0]) });
  return out;
}

function tokenMatches(tok, word) {
  const forms = inflections(word);
  if (forms.has(tok.norm)) return true;
  // Loose prefix match for unusual inflections of longer words (e.g. "acquiesce" -> "acquiesced").
  const stem = word.toLowerCase().replace(/(e|y)$/, '');
  return stem.length >= 5 && tok.norm.startsWith(stem) && tok.norm.length <= word.length + 4;
}

/**
 * Find the target word/phrase inside a sentence.
 * Returns an array of {start, end, text} spans (several for split phrases like "put it off"), or null.
 */
export function findTarget(sentence, target) {
  if (!sentence || !target) return null;
  const toks = tokenize(sentence);
  const parts = normalize(target).split(' ').filter(Boolean);
  if (!parts.length) return null;

  if (parts.length === 1) {
    const t = toks.find((tk) => tokenMatches(tk, parts[0]));
    return t ? [{ start: t.start, end: t.end, text: t.text }] : null;
  }

  // Phrase: first word may be inflected, the rest exact (allowing small fillers like "one's" -> "her").
  const FILLER_MAX = 3;
  const isPlaceholder = (p) => ['sb', 'sth', 'someone', 'something', "one's", 'oneself', 'somebody'].includes(p);
  for (let i = 0; i < toks.length; i++) {
    if (!tokenMatches(toks[i], parts[0])) continue;
    const spans = [toks[i]];
    let j = i + 1;
    let ok = true;
    for (let k = 1; k < parts.length; k++) {
      const p = parts[k];
      if (isPlaceholder(p)) { j++; continue; }
      let found = -1;
      for (let g = 0; g <= FILLER_MAX && j + g < toks.length; g++) {
        if (toks[j + g].norm === p || (k === parts.length - 1 && tokenMatches(toks[j + g], p))) { found = j + g; break; }
      }
      if (found < 0) { ok = false; break; }
      spans.push(toks[found]);
      j = found + 1;
    }
    if (ok) {
      // Merge adjacent tokens into contiguous spans.
      const merged = [];
      for (const t of spans) {
        const prev = merged.at(-1);
        if (prev && /^\s*$/.test(sentence.slice(prev.end, t.start))) { prev.end = t.end; prev.text = sentence.slice(prev.start, t.end); }
        else merged.push({ start: t.start, end: t.end, text: t.text });
      }
      return merged;
    }
  }
  return null;
}

/** Blank out spans in a sentence. */
export function blankOut(sentence, spans) {
  let out = '';
  let pos = 0;
  for (const s of spans) { out += sentence.slice(pos, s.start) + BLANK; pos = s.end; }
  return out + sentence.slice(pos);
}

/**
 * Build the stage-2 prompt for a word.
 * Returns { kind: 'sentence', sentence, blanked, answer, translation } or
 *         { kind: 'definition', prompt, promptZh, answer } when no usable sentence exists.
 */
export function makeCloze(word) {
  const candidates = [];
  if (word.source_sentence) candidates.push({ en: word.source_sentence, zh: word.source_sentence_zh || '' });
  for (const s of word.senses || []) if (s.example_en) candidates.push({ en: s.example_en, zh: s.example_zh || '' });
  for (const c of candidates) {
    const spans = findTarget(c.en, word.text);
    if (spans) {
      return {
        kind: 'sentence', sentence: c.en, blanked: blankOut(c.en, spans),
        answer: spans.map((s) => s.text).join(' '), answers: spans.map((s) => s.text), translation: c.zh,
      };
    }
  }
  const s = (word.senses || [])[0] || {};
  return { kind: 'definition', prompt: s.def_en || '', promptZh: s.def_zh || word.gloss_zh || '', answer: word.text };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Grade a typed answer. Returns 'familiar' | 'soso' | 'unfamiliar'.
 * Exact form or base form = familiar; one typo (or a different inflection) = soso.
 */
export function grade(input, cloze, baseText) {
  const got = normalize(input);
  if (!got) return 'unfamiliar';
  const answer = normalize(cloze.answer);
  const base = normalize(baseText);
  if (got === answer) return 'familiar';
  if (cloze.kind === 'definition' && got === base) return 'familiar';
  if (got === base) return 'soso'; // right word, wrong form for this sentence
  const tol = answer.length > 3 ? 1 : 0;
  if (levenshtein(got, answer) <= tol || levenshtein(got, base) <= tol) return 'soso';
  // A different valid inflection of the base word.
  if (base.split(' ').length === 1 && inflections(base).has(got)) return 'soso';
  return 'unfamiliar';
}
