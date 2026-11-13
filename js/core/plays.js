/* ============================================================
   plays.js — one play history for everything playable.

   Web games (Static Games), built-in Arcade games and your own
   creations (Forge / Studio) all record a launch here, so Static
   Play, the Library, Quick Play, Staticum and achievements share
   one honest history — this device's, nothing invented.

   Entry: { kind: 'web'|'arcade'|'creation', id, title, art, at }
   record(entry)  add a launch (moves it to the front), emits
                  bus 'game:launch' with the entry
   recent(n, kind?)  most recent first, one row per game
   count(kind?)   how many distinct games were ever launched
   total()        total launches recorded (for achievements)
   top(n)         your most-launched games, busiest first, each with
                  `plays` (launches counted on this device) — or null
                  for a game last launched before counting began, which
                  is ranked by how recently it was played instead.
                  countedSince() says when counting began.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

const KEY = 'portal.play';          /* { recent: [...], total, distinct: {kind:id: true}, counts: {kind:id: n}, since } */
const MAX = 80;
const MAX_COUNTS = 400;             /* per-game counters kept; the least-played go first */

const read = () => {
  const v = store.get(KEY, null);
  return v && typeof v === 'object' ? v : { recent: [], total: 0, distinct: {} };
};

export function record(entry) {
  if (!entry || !entry.id) return;
  const e = {
    kind: ['web', 'arcade', 'creation'].includes(entry.kind) ? entry.kind : 'web',
    id: String(entry.id), title: String(entry.title || entry.id).slice(0, 80),
    art: entry.art || null, at: Date.now(),
  };
  const cats = Array.isArray(entry.cats) ? entry.cats.slice(0, 4) : undefined;
  const cur = read();
  const key = `${e.kind}:${e.id}`;
  const recent = [e, ...(cur.recent || []).filter(r => `${r.kind}:${r.id}` !== key)].slice(0, MAX);
  const counts = countsOf(cur);
  counts[key] = (counts[key] || 0) + 1;
  const keys = Object.keys(counts);
  if (keys.length > MAX_COUNTS) {
    keys.sort((a, b) => counts[a] - counts[b]).slice(0, keys.length - MAX_COUNTS)
      .forEach(k => { if (k !== key) delete counts[k]; });
  }
  store.set(KEY, {
    ...cur, recent, total: (cur.total || 0) + 1, distinct: { ...(cur.distinct || {}), [key]: true },
    counts, since: Number(cur.since) > 0 ? cur.since : e.at,
  });
  bus.emit('game:launch', cats ? { ...e, cats } : e);
}

export const recent = (n = 20, kind = null) =>
  (read().recent || []).filter(r => !kind || r.kind === kind).slice(0, n);

export const count = (kind = null) =>
  Object.keys(read().distinct || {}).filter(k => !kind || k.startsWith(kind + ':')).length;

export const total = () => read().total || 0;

/* only whole positive numbers survive: the store is user-editable */
function countsOf(v) {
  const c = v && v.counts && typeof v.counts === 'object' ? v.counts : {};
  const out = {};
  for (const [k, n] of Object.entries(c)) if (Number.isInteger(n) && n > 0) out[k] = n;
  return out;
}

/** When per-game counting began on this device (ms), or null. */
export const countedSince = () => { const s = Number(read().since); return s > 0 ? s : null; };

/** Most-launched games first (then most recent). `plays` is a real count or null. */
export function top(n = 6) {
  const v = read();
  const counts = countsOf(v);
  return (v.recent || [])
    .filter(r => r && r.id)
    .map((r, i) => ({ ...r, plays: counts[`${r.kind}:${r.id}`] || null, _i: i }))
    .sort((a, b) => (b.plays || 0) - (a.plays || 0) || a._i - b._i)
    .slice(0, n)
    .map(({ _i, ...r }) => r);
}

export default { record, recent, count, total, top, countedSince };
