/* ============================================================
   polls.js — the rules for polls in Static Social's live rooms.

   Pure logic, no DOM, no network: what a poll, a vote and a close
   message must look like, and how votes are counted.

   On the wire (the room's topic, next to ordinary chat; every
   message also carries id/name/color/at/mid like chat does):
     poll  { pid, q, opts:[2-10 strings], multi, anon, dur }
     vote  { pid, ch:[option numbers], n }
     close { pid }
   `dur` is a length in ms (0 = until the author ends it), not a
   clock time, so the two devices' clocks never have to agree: each
   side starts counting when the poll reaches it.

   Counting is honest and simple:
     · one vote per voter id per poll; a later vote (higher `n`,
       the voter's own counter) replaces the earlier one; the same
       or an older `n` is ignored, so a replayed or forged duplicate
       changes nothing;
     · a vote must name real options, no repeats, one only unless the
       poll is multiple choice; anything else is ignored whole;
     · votes after the poll is closed or has run out are ignored,
       and only the author's id can close it;
     · counts and percentages come only from votes this device
       received. Percent is of the people who voted.
   Ids are NOT verified (public channel, no accounts): someone who
   copies another device's id could vote as it. Anonymous mode only
   hides names on screen; it does not hide anything on the wire.
   ============================================================ */
import { cleanText } from './roomcode.js';

export const LIMITS = { Q: 140, OPT: 60, MIN: 2, MAX: 10, VOTERS: 500, DUR_MAX: 7 * 86400000, PID: /^[a-z0-9]{6,24}$/ };

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** A poll body from someone else's message -> a cleaned copy, or null. */
export function parsePoll(p) {
  if (!isObj(p) || typeof p.pid !== 'string' || !LIMITS.PID.test(p.pid)) return null;
  const q = cleanText(p.q, LIMITS.Q);
  if (!q || !Array.isArray(p.opts) || p.opts.length < LIMITS.MIN || p.opts.length > LIMITS.MAX) return null;
  const opts = p.opts.map(o => (typeof o === 'string' ? cleanText(o, LIMITS.OPT) : ''));
  if (opts.some(o => !o)) return null;
  const dur = Number.isFinite(p.dur) ? Math.max(0, Math.min(LIMITS.DUR_MAX, Math.round(p.dur))) : 0;
  return { pid: p.pid, q, opts, multi: p.multi === true, anon: p.anon === true, dur };
}

/** A vote body -> { pid, ch, n } or null (shape only; applyVote checks it against the poll). */
export function parseVote(v) {
  if (!isObj(v) || typeof v.pid !== 'string' || !LIMITS.PID.test(v.pid)) return null;
  if (!Array.isArray(v.ch) || v.ch.length > LIMITS.MAX || !Number.isSafeInteger(v.n) || v.n < 0) return null;
  if (!v.ch.every(c => Number.isInteger(c) && c >= 0 && c < LIMITS.MAX)) return null;
  return { pid: v.pid, ch: v.ch.slice(), n: v.n };
}

export function parseClose(c) {
  return isObj(c) && typeof c.pid === 'string' && LIMITS.PID.test(c.pid) ? { pid: c.pid } : null;
}

/** The state both sides keep for one poll. `at` is when it reached this device. */
export function newPoll(meta, author, room, at) {
  return {
    ...meta, room, from: author.id, name: author.name, color: author.color, at,
    endsAt: meta.dur ? at + meta.dur : 0, closed: false, myN: 0,
    votes: new Map(),               /* voter id -> { ch, n, name } */
  };
}

export const isOpen = (P, now = Date.now()) => !P.closed && !(P.endsAt && now >= P.endsAt);

/** -> 'ok' | 'closed' | 'stale' | 'invalid' | 'full' */
export function applyVote(P, voter, vote, now = Date.now()) {
  if (!isOpen(P, now)) return 'closed';
  const ch = vote.ch;
  if (new Set(ch).size !== ch.length || ch.some(c => c >= P.opts.length)) return 'invalid';
  if (!P.multi && ch.length > 1) return 'invalid';
  const prev = P.votes.get(voter.id);
  if (prev && vote.n <= prev.n) return 'stale';
  if (!prev && P.votes.size >= LIMITS.VOTERS) return 'full';
  P.votes.set(voter.id, { ch: ch.slice().sort((a, b) => a - b), n: vote.n, name: voter.name });
  return 'ok';
}

/** Only the author's id can end a poll. */
export function applyClose(P, from) {
  if (from !== P.from || P.closed) return false;
  P.closed = true;
  return true;
}

/** Counts from the votes received. `pct` is a share of the people who voted (0 when nobody has). */
export function tally(P) {
  const counts = P.opts.map(() => 0);
  const who = P.opts.map(() => []);
  for (const [id, v] of P.votes) v.ch.forEach(c => { counts[c]++; who[c].push(v.name || id.slice(0, 4)); });
  const voters = [...P.votes.values()].filter(v => v.ch.length).length;
  const pct = counts.map(c => (voters ? Math.round((c / voters) * 100) : 0));
  return { counts, pct, who, voters, total: counts.reduce((a, b) => a + b, 0) };
}

export default { LIMITS, parsePoll, parseVote, parseClose, newPoll, isOpen, applyVote, applyClose, tally };
