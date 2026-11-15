/* ============================================================
   spothist.js — what Spotlight remembers on this device:

     recent   the last things you picked, newest first (shown when the
              box is empty)
     counts   how many times you picked each thing (what you pick often
              ranks higher)
     ans      the last answers it gave you (Up arrow brings them back,
              "ans" reuses the newest number)

   All of it lives in prefs.spotHist, so it is per person (core/store.js
   → core/profiles.js) and goes when "Clear history" is pressed. Keys are
   Spotlight's row keys ("app:notes", "file:/home/…"); only a key the
   palette can turn back into a row is remembered.
   ============================================================ */
import { store } from './store.js';

const KEY = 'prefs.spotHist';
export const MAX_RECENT = 8;
export const MAX_COUNTS = 150;
export const MAX_ANS = 12;

const read = () => {
  const v = store.get(KEY);
  const o = v && typeof v === 'object' ? v : {};
  return {
    recent: Array.isArray(o.recent) ? o.recent.filter(r => r && typeof r.key === 'string') : [],
    counts: o.counts && typeof o.counts === 'object' && !Array.isArray(o.counts) ? o.counts : {},
    ans: Array.isArray(o.ans) ? o.ans.filter(a => a && typeof a.q === 'string' && typeof a.v === 'string') : [],
  };
};
const write = h => store.set(KEY, { recent: h.recent, counts: h.counts, ans: h.ans });

/** Remember a pick: it goes to the front of Recent and its count goes up. */
export function record(key, title) {
  if (!key) return;
  const h = read();
  h.recent = [{ key, title: String(title || '').slice(0, 120), at: Date.now() }, ...h.recent.filter(r => r.key !== key)].slice(0, MAX_RECENT * 2);
  h.counts = { ...h.counts, [key]: Math.min(999, (h.counts[key] || 0) + 1) };
  const keys = Object.keys(h.counts);
  if (keys.length > MAX_COUNTS) {
    const keep = keys.sort((a, b) => h.counts[b] - h.counts[a]).slice(0, MAX_COUNTS);
    h.counts = Object.fromEntries(keep.map(k => [k, h.counts[k]]));
  }
  write(h);
}

/** Newest first. */
export const recent = () => read().recent;
export const count = key => read().counts[key] || 0;
/** A small lift for a result you pick often (added to its match score). */
export const boost = key => { const n = count(key); return n ? Math.min(30, 6 * Math.log2(1 + n)) : 0; };
/** Every count at once, for ranking a whole list. */
export const counts = () => read().counts;

/** Remember an answer: the line that asked and the value to reuse. A repeat moves to the front. */
export function noteAnswer(q, v) {
  const line = String(q || '').trim();
  if (!line || v === undefined || v === null || v === '') return;
  const h = read();
  h.ans = [{ q: line, v: String(v) }, ...h.ans.filter(a => a.q !== line)].slice(0, MAX_ANS);
  write(h);
}
export const answers = () => read().ans;
export const lastValue = () => (read().ans[0] || {}).v ?? null;

export function clear() {
  store.set(KEY, { recent: [], counts: {}, ans: [] });
}
export const isEmpty = () => { const h = read(); return !h.recent.length && !Object.keys(h.counts).length && !h.ans.length; };

export default { record, recent, count, counts, boost, noteAnswer, answers, lastValue, clear, isEmpty };
