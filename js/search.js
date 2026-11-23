// Fuzzy search by spelling or meaning, plus synonym search.
import Fuse from 'fuse';
import { fetchSynonyms } from './enrich.js';

export function fuzzy(words, query) {
  const fuse = new Fuse(words, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.38,
    keys: [
      { name: 'text', weight: 3 },
      { name: 'gloss_zh', weight: 2 },
      { name: 'senses.def_en', weight: 1 },
      { name: 'senses.def_zh', weight: 1.5 },
      { name: 'source_sentence', weight: 0.3 },
    ],
  });
  return fuse.search(query).slice(0, 50).map((r) => r.item);
}

/**
 * Words in the user's list that are synonyms of the query.
 * Offline: uses synonyms stored with each word. Online: also expands the query via Datamuse.
 */
export async function synonymSearch(words, query) {
  const q = query.trim().toLowerCase();
  if (!q || /[一-鿿]/.test(q)) return [];
  let expanded = new Set([q]);
  if (navigator.onLine) {
    try { (await fetchSynonyms(q, 40, 4000)).forEach((w) => expanded.add(w.toLowerCase())); } catch {}
  }
  return words.filter((w) => {
    const t = w.text.toLowerCase();
    if (t === q) return false;
    return expanded.has(t) || (w.synonyms || []).some((s) => s.toLowerCase() === q);
  });
}
