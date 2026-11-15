/* ============================================================
   arcade/race.js — the online race kit: the same puzzle (or course)
   on two screens, each person on their own board, and the results
   compared on each device.

   The games listed in RACES don't talk to their twin themselves (Block
   Fit and 2048 do, see their files): the Arcade shell runs this kit
   beside the game. Both sides get the room's seed, so the puzzle is
   the same (each game uses its standard mode in a race), and the game
   only says how it is going and how it ended:
     ctx.online.progress(p)          0–1: how much of the puzzle is done
     ctx.onScore(n)                  the live score (score races)
     ctx.onEnd({ …, race: result })  result = { done, ms, err, mv, sc, n, p, w }
       done  solved (false: gave up, timed out or hit a mine)
       ms    time taken · err mistakes · mv moves · sc score
       n     a second number (words found, accuracy) · p progress 0–1
       w     the words found (Letter Grid), space-separated
   Every field is checked here before it is believed; a missing one
   counts as 0. Each screen reports its own result: nothing here can
   check that the other side's time is true, so a race is as fair as
   the friend you play.

   PROTOCOL — game data on the room ({ t, … } inside room.js's 'g'):
     k.p { p, sc }       how it is going (at most ~3 a second, and a
                         beat every 1.5 s so a lost one is mended)
     k.f { r }           my result, on every beat until…
     k.a {}              …the other side says it has it
   Data for an older round never arrives (room.js drops it).

     raceKit(spec, send) -> { progress(p), score(n), finish(r), take(d),
                              mine, theirs, live, outcome(), on(fn), stop() }
   ============================================================ */

/* rank: how two results compare.
     time   solved beats not; then the lower time, each mistake adding
            `pen` seconds; unsolved: further along wins
     moves  solved beats not; then fewer moves, then the faster
     score  the higher score, then the higher n
   bar: the progress strip compares scores (a course) rather than 0–100 %. */
export const RACES = {
  sudoku:     { rank: 'time', pen: 10, standard: 'Medium, classic 9×9' },
  sumgrid:    { rank: 'time', pen: 10, standard: 'Medium 6×6' },
  nonogram:   { rank: 'time', standard: 'a 10×10 picture' },
  crossword:  { rank: 'time', standard: 'one of the fifty minis' },
  mines:      { rank: 'time', standard: 'Beginner 9×9, 10 mines' },
  sliding:    { rank: 'moves', standard: '4×4 numbers' },
  lightsout:  { rank: 'moves', standard: 'a level from the main set' },
  pipelink:   { rank: 'moves', standard: 'a 6×6 level' },
  memory:     { rank: 'moves', standard: '4×4 cards, 8 pairs' },
  lettergrid: { rank: 'score', words: true, standard: '4×4, three minutes' },
  typing:     { rank: 'score', standard: '30 seconds' },
  unscramble: { rank: 'score', standard: 'two minutes, growing words' },
  flap:       { rank: 'score', bar: true, standard: 'the same pipes' },
  racer:      { rank: 'score', bar: true, standard: 'the same traffic' },
  runner:     { rank: 'score', bar: true, standard: 'the same obstacles' },
  tileslide:  { rank: 'score', standard: 'the same 5×5 board, twenty moves' },
  numberchain: { rank: 'score', standard: 'the same digits, one minute' },
};
export const raceOf = id => (typeof id === 'string' && Object.hasOwn(RACES, id) ? RACES[id] : null);

const BEAT = 1500;
const LIVE_GAP = 330;
const W_MAX = 1500;
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : 0);
const num = (v, lim) => (Number.isFinite(v) && Math.abs(v) < lim ? v : 0);
const frac = v => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** a result from a game or the wire, cleaned: never trusts a field it did not check */
export function cleanResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const w = typeof r.w === 'string' ? r.w.toUpperCase().replace(/[^A-Z ]/g, '').replace(/ +/g, ' ').trim().slice(0, W_MAX) : '';
  return {
    done: r.done === true,
    ms: int(Math.round(Number(r.ms)), 0, 86400000),
    err: int(r.err, 0, 9999), mv: int(r.mv, 0, 1e6),
    sc: num(r.sc, 1e9), n: num(r.n, 1e6),
    p: r.done === true ? 1 : frac(r.p),
    ...(w ? { w } : {}),
  };
}

/** 1: a wins, -1: b wins, 0: a draw */
export function compare(spec, a, b) {
  const sgn = d => (d > 0 ? 1 : d < 0 ? -1 : 0);
  if (spec.rank === 'score') return sgn(a.sc - b.sc) || sgn(a.n - b.n);
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (!a.done) return sgn(a.p - b.p);
  if (spec.rank === 'moves') return sgn(b.mv - a.mv) || sgn(b.ms - a.ms);
  const pen = (spec.pen || 0) * 1000;
  return sgn((b.ms + pen * b.err) - (a.ms + pen * a.err));
}

/* "1 pipe", "2 pipes" */
export const one = (n, unit) => (n === 1 && /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit);
export const clockText = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** a result in a few words: "3:12 · 1 mistake", "34 moves · 1:05", "62% done" */
export function resultText(spec, r, unit = '') {
  if (!r) return '—';
  if (spec.rank === 'score') return `${Number(r.sc).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${one(r.sc, unit)}` : ''}`;
  if (!r.done) return `${Math.round(r.p * 100)}% done`;
  if (spec.rank === 'moves') return `${r.mv} move${r.mv === 1 ? '' : 's'} · ${clockText(r.ms)}`;
  return `${clockText(r.ms)}${spec.pen && r.err ? ` · ${r.err} mistake${r.err === 1 ? '' : 's'} (+${r.err * spec.pen} s)` : ''}`;
}
/** the number on the result card's big "you – them" line */
export function headline(spec, r) {
  if (!r) return '—';
  if (spec.rank === 'score') return Number(r.sc).toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (!r.done) return `${Math.round(r.p * 100)}%`;
  if (spec.rank === 'moves') return String(r.mv);
  return clockText(r.ms + (spec.pen || 0) * 1000 * r.err);
}

export function raceKit(spec, send) {
  const subs = new Set();
  const K = { mine: null, theirs: null, live: { me: { p: 0, sc: 0 }, them: { p: 0, sc: 0, at: 0 } }, acked: false, dead: false };
  let lastLive = 0, liveT = 0, beatT = 0, sentLive = '';
  const emit = (t, d) => subs.forEach(fn => { try { fn(t, d); } catch (err) { console.error('[race]', err); } });
  const tell = d => { try { return send(d); } catch (err) { return false; } };

  function sendLive(force = false) {
    if (K.dead) return;
    const body = { t: 'k.p', p: Math.round(K.live.me.p * 1000) / 1000, sc: K.live.me.sc };
    const text = JSON.stringify(body);
    const now = performance.now();
    if (!force && text === sentLive) return;
    if (!force && now - lastLive < LIVE_GAP) { clearTimeout(liveT); liveT = setTimeout(() => sendLive(), LIVE_GAP - (now - lastLive) + 5); return; }
    lastLive = now; sentLive = text;
    tell(body);
  }
  let tail = 0;
  function beat() {
    if (K.dead) return;
    sendLive(true);
    if (K.mine && !K.acked) tell({ t: 'k.f', r: K.mine });
    /* both results in and mine received: a few more beats (their ack may be what was lost), then quiet */
    if (K.mine && K.theirs && K.acked && ++tail > 3) clearInterval(beatT);
  }
  beatT = setInterval(beat, BEAT);

  return Object.assign(K, {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    progress(p) { if (K.dead || K.mine) return; K.live.me.p = frac(p); sendLive(); emit('live'); },
    score(n) { if (K.dead || K.mine || !Number.isFinite(n)) return; K.live.me.sc = n; sendLive(); emit('live'); },
    /* my game ended: the result goes out now and on every beat until the friend has it */
    finish(r) {
      if (K.dead || K.mine) return K.mine;
      K.mine = cleanResult(r) || cleanResult({ done: false });
      K.live.me.p = K.mine.p;
      if (spec.rank === 'score') K.live.me.sc = K.mine.sc;
      tell({ t: 'k.f', r: K.mine });
      sendLive(true);
      emit('done', 'me');
      return K.mine;
    },
    /* a message from the friend's kit; true when it was one */
    take(d) {
      if (K.dead || !d || typeof d.t !== 'string' || !d.t.startsWith('k.')) return false;
      if (d.t === 'k.p') {
        if (!K.theirs) {
          K.live.them = { p: frac(d.p), sc: num(d.sc, 1e9), at: performance.now() };
          emit('live');
        }
      } else if (d.t === 'k.f') {
        const r = cleanResult(d.r);
        if (r) {
          tell({ t: 'k.a' });
          if (!K.theirs) {
            K.theirs = r;
            K.live.them = { p: r.p, sc: spec.rank === 'score' ? r.sc : K.live.them.sc, at: performance.now() };
            emit('done', 'them');
          }
        }
      } else if (d.t === 'k.a') {
        K.acked = true;
      }
      return true;
    },
    /* both are in: who won, on this device's own reckoning (the other device makes the same one) */
    outcome() {
      if (!K.mine || !K.theirs) return null;
      const c = compare(spec, K.mine, K.theirs);
      return { won: c > 0 ? true : c < 0 ? false : null };
    },
    stop() { K.dead = true; clearInterval(beatT); clearTimeout(liveT); subs.clear(); },
  });
}

export default { RACES, raceOf, raceKit, compare, cleanResult, resultText, headline, clockText };
