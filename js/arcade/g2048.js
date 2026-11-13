/* ============================================================
   arcade/g2048.js — 2048 for Static Arcade.

   Slide every tile with the arrow keys / WASD or a swipe; two tiles
   of the same number merge into their sum. Score = the sum of every
   merge (the usual 2048 scoring). Each move adds a 2 (90 %) or a 4.

   Reaching 2048 is a win: a small card offers "Keep going" (play on
   for bigger tiles, the round keeps its score) or "Finish" (end the
   round here, won). When no move is left the round ends; it still
   counts as won if 2048 was reached along the way.

   The board is drawn on a canvas so Static Replay can record it.
   Tiles slide, merges pop and new tiles grow in over ~0.1 s; with
   reduced motion every change is instant. Turn-based, so there is
   nothing to pause. Follows the module contract in ./index.js.

   Optional ctx.board — a 4×4 array of tile values (0 = empty) — starts
   from that position instead of two random tiles (the Arcade's
   play-tests use it to reach the 2048 card without 1,000 moves).

   UNDO, ONCE: the Undo button (top right), Z, U or Backspace — or a
   controller's X through the Arcade's key bridge — takes back the
   last move, once per round. When the board locks up while the undo
   is still unused, a card offers it before the round ends.

   ONLINE RACE (ctx.online, from the Arcade's room): both players
   start from the same seed, so the new tiles come from the same
   random sequence — the same luck for the same moves. Three minutes,
   no undo; the best score when the clock runs out (or when both
   boards are stuck) wins. Each move travels as one letter, and the
   friend's board on your screen is REPLAYED here with the same rules
   and the same seed: their score is counted on your side, and a move
   that does not change their board voids the race.
   ============================================================ */

const HUE = 35;
const N = 4;
const WIN = 2048;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/* background, ink, glow? */
const TILE = {
  2: ['#2c241a', '#f5e6cf'], 4: ['#3b2e1e', '#f7e3c4'],
  8: ['#f08c3a', '#1f0d00'], 16: ['#f37335', '#1f0800'],
  32: ['#f4543c', '#fff2ec'], 64: ['#ec3357', '#fff0f3'],
  128: ['#f7c948', '#2a1a00', 1], 256: ['#f6b92b', '#2a1700', 1],
  512: ['#f5a524', '#2a1400', 1], 1024: ['#ffd84d', '#2a1a00', 1],
  2048: ['#fff27a', '#2a2000', 1],
};
const BIG = ['#b77dff', '#ffffff', 1];

const DIRS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};
const UNDO_KEYS = new Set(['z', 'u', 'Backspace']);
const RACE_MS = 180_000;
const GRACE_MS = 4000;
const SEND_BACK = 12;
const LETTER = { left: 'l', right: 'r', up: 'u', down: 'd' };
const FROM_LETTER = { l: 'left', r: 'right', u: 'up', d: 'down' };

/* ---------- the rules on plain numbers: the race's replay runs on these ---------- */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lineCells = (dir, i) => {
  const out = [];
  for (let j = 0; j < N; j++) {
    if (dir === 'left') out.push([i, j]);
    else if (dir === 'right') out.push([i, N - 1 - j]);
    else if (dir === 'up') out.push([j, i]);
    else out.push([N - 1 - j, i]);
  }
  return out;
};
/* empty cells in reading order, then one draw for the cell and one for 2-or-4 */
function spawnValue(grid, rnd) {
  const free = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) free.push([r, c]);
  if (!free.length) return null;
  const [r, c] = free[Math.floor(rnd() * free.length)];
  const v = rnd() < 0.9 ? 2 : 4;
  return { r, c, v };
}
export function slideValues(grid, dir) {
  const next = Array.from({ length: N }, () => Array(N).fill(0));
  let moved = false, gained = 0;
  for (let i = 0; i < N; i++) {
    const cells = lineCells(dir, i);
    const line = cells.map(([r, c]) => ({ v: grid[r][c], r, c })).filter(t => t.v);
    let k = 0;
    for (let j = 0; j < line.length; k++) {
      const a = line[j], b = line[j + 1];
      const [tr, tc] = cells[k];
      if (b && b.v === a.v) { next[tr][tc] = a.v * 2; gained += a.v * 2; moved = true; j += 2; }
      else { if (a.r !== tr || a.c !== tc) moved = true; next[tr][tc] = a.v; j += 1; }
    }
  }
  return { grid: next, moved, gained };
}
const stuckValues = grid => {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = grid[r][c];
    if (!v || (c + 1 < N && grid[r][c + 1] === v) || (r + 1 < N && grid[r + 1][c] === v)) return false;
  }
  return true;
};
/** A whole game on numbers, from a seed: what the race replays the friend's moves on. */
export function newRace(seed) {
  const g = { grid: Array.from({ length: N }, () => Array(N).fill(0)), rnd: rng32(seed), score: 0, moves: '', over: false, top: 0 };
  for (let i = 0; i < 2; i++) { const t = spawnValue(g.grid, g.rnd); if (t) g.grid[t.r][t.c] = t.v; }
  return g;
}
export function raceMove(g, dir) {
  if (g.over || !LETTER[dir]) return false;
  const res = slideValues(g.grid, dir);
  if (!res.moved) return false;
  g.grid = res.grid;
  g.score += res.gained;
  const t = spawnValue(g.grid, g.rnd);
  if (t) g.grid[t.r][t.c] = t.v;
  g.moves += LETTER[dir];
  g.top = Math.max(g.top, ...g.grid.flat());
  g.over = stuckValues(g.grid);
  return true;
}

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const SLIDE = reduced ? 0 : 0.11, POP = reduced ? 0 : 0.15;
    const snd = sounder(ctx);
    const now = () => performance.now() / 1000;
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const rnd = NET ? rng32(NET.seed) : Math.random;
    const S = {
      grid: Array.from({ length: N }, () => Array(N).fill(null)),
      ghosts: [], nextId: 1,
      score: 0, won: false, keepGoing: false,
      over: false, overAt: 0, ended: false,
      animEnd: 0, shake: 0, overlay: null, shakeAt: -1,
      winTimer: 0, focusTimer: 0,
      undoLeft: NET ? 0 : 1, prev: null, moves: '', undoAt: -1,
    };
    /* the race: their game, replayed here from their moves */
    const R = NET ? { t0: performance.now(), them: newRace(NET.seed), voided: false, lastNeed: 0, lastReply: 0, beat: 0, off: null, shown: -1 } : null;
    const sf = surface(el, NET ? '2048 race' : '2048 board', () => draw());
    const undoBtn = NET ? null : mk('button', 'arc-undo', '');
    const undoTxt = document.createElement('span');
    if (undoBtn) {
      undoBtn.type = 'button';
      /* the icon set's corner-up-left arrow, drawn inline (games have no access to the shell's icons) */
      undoBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      undoBtn.appendChild(undoTxt);
      undoBtn.addEventListener('click', () => { undo(); el.closest('[tabindex]')?.focus({ preventScroll: true }); });
      el.appendChild(undoBtn);
    }

    if (NET || !loadBoard(ctx.board)) { spawn(now()); spawn(now()); }
    else if (!canMove()) { S.over = true; S.overAt = now() + POP + 0.6; }
    ctx.onScore(0);
    paintUndo();

    /* ------------------------------ rules ------------------------------ */
    function loadBoard(b) {
      if (!Array.isArray(b) || b.length !== N || !b.every(row => Array.isArray(row) && row.length === N)) return false;
      const ok = v => v === 0 || v === null || (Number.isInteger(v) && v >= 2 && (v & (v - 1)) === 0);
      if (!b.every(row => row.every(ok))) return false;
      const t = now();
      let any = false;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = b[r][c];
        if (!v) continue;
        any = true;
        S.grid[r][c] = { id: S.nextId++, v, r, c, fr: r, fc: c, t0: t, kind: 'new' };
        if (v >= WIN) S.won = true;           /* a position already past 2048 does not re-offer the card */
      }
      S.animEnd = t + POP;
      return any;
    }

    function empties() {
      const out = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!S.grid[r][c]) out.push([r, c]);
      return out;
    }

    /* the same draws as spawnValue(), so a race's replay sees the same tiles */
    function spawn(at) {
      const t = spawnValue(S.grid.map(row => row.map(x => (x ? x.v : 0))), rnd);
      if (!t) return;
      S.grid[t.r][t.c] = { id: S.nextId++, v: t.v, r: t.r, c: t.c, fr: t.r, fc: t.c, t0: at, kind: 'new' };
      S.animEnd = Math.max(S.animEnd, at + POP);
    }
    const values = () => S.grid.map(row => row.map(t => (t ? t.v : 0)));
    const timeLeft = () => (R ? Math.max(0, RACE_MS - (performance.now() - R.t0)) : Infinity);
    const canPlay = () => !S.over && !S.ended && !S.overlay && !(R && (timeLeft() <= 0 || R.voided));

    function canMove() {
      if (empties().length) return true;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = S.grid[r][c].v;
        if ((c + 1 < N && S.grid[r][c + 1].v === v) || (r + 1 < N && S.grid[r + 1][c].v === v)) return true;
      }
      return false;
    }

    /* finish every running animation at once (a new move came in) */
    function settle() {
      S.ghosts = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const t = S.grid[r][c];
        if (t) { t.fr = t.r; t.fc = t.c; t.kind = 'still'; }
      }
    }

    function cellsOf(dir, i) {
      const out = [];
      for (let j = 0; j < N; j++) {
        if (dir === 'left') out.push([i, j]);
        else if (dir === 'right') out.push([i, N - 1 - j]);
        else if (dir === 'up') out.push([j, i]);
        else out.push([N - 1 - j, i]);
      }
      return out;
    }

    function move(dir) {
      if (!canPlay()) return;
      settle();
      const before = { grid: values(), score: S.score, won: S.won };
      const t0 = now();
      const next = Array.from({ length: N }, () => Array(N).fill(null));
      let moved = false, gained = 0, best = 0, hitWin = false;
      for (let i = 0; i < N; i++) {
        const cells = cellsOf(dir, i);
        const line = cells.map(([r, c]) => S.grid[r][c]).filter(Boolean);
        let k = 0;
        for (let j = 0; j < line.length; k++) {
          const a = line[j], b = line[j + 1];
          const [tr, tc] = cells[k];
          if (b && b.v === a.v) {
            const m = { id: S.nextId++, v: a.v * 2, r: tr, c: tc, fr: tr, fc: tc, t0, kind: 'merge' };
            for (const t of [a, b]) S.ghosts.push({ v: t.v, fr: t.r, fc: t.c, r: tr, c: tc, t0 });
            next[tr][tc] = m;
            gained += m.v;
            best = Math.max(best, m.v);
            if (m.v === WIN) hitWin = true;
            moved = true;
            j += 2;
          } else {
            if (a.r !== tr || a.c !== tc) moved = true;
            a.fr = a.r; a.fc = a.c; a.r = tr; a.c = tc; a.t0 = t0; a.kind = 'slide';
            next[tr][tc] = a;
            j += 1;
          }
        }
      }
      if (!moved) {
        S.shakeAt = reduced ? -1 : t0;
        S.shake = dir === 'left' || dir === 'right' ? 1 : 2;
        kick(t0 + 0.18);
        return;
      }
      S.grid = next;
      S.score += gained;
      S.animEnd = t0 + SLIDE + POP;
      spawn(t0 + SLIDE);
      S.moves += LETTER[dir];
      if (!NET) { S.prev = before; paintUndo(); }
      else sendMoves();
      if (gained) {
        ctx.onScore(S.score);
        snd.blip(330 * Math.log2(best) / 3, 0.07, 'triangle', 0.8, 440 * Math.log2(best) / 3);
      } else {
        snd.blip(220, 0.03, 'square', 0.35);
      }
      if (hitWin && !S.won) {
        S.won = true;
        /* a race does not stop for the card */
        if (!NET) S.winTimer = setTimeout(() => { if (!S.ended) showWin(); }, Math.round((SLIDE + POP) * 1000) + 60);
      }
      if (!canMove()) {
        S.over = true;
        S.overAt = t0 + SLIDE + POP + 0.6;
        paintUndo();
        if (NET) beat();
      }
      kick(S.animEnd);
    }

    /* ------------------------------ undo, once ------------------------------ */
    function undo() {
      if (NET || S.ended || S.overlay && !S.overlay.classList.contains('is-stuck')) return;
      if (S.undoLeft <= 0 || !S.prev) {
        S.shakeAt = reduced ? -1 : now();
        S.shake = 1;
        snd.blip(130, 0.08, 'sawtooth', 0.4);
        kick(now() + 0.2);
        return;
      }
      if (S.overlay) { S.overlay.remove(); S.overlay = null; }
      settle();
      const p = S.prev;
      const t = now();
      S.grid = p.grid.map((row, r) => row.map((v, c) => (v ? { id: S.nextId++, v, r, c, fr: r, fc: c, t0: t, kind: 'still' } : null)));
      S.score = p.score;
      S.won = p.won;
      S.over = false;
      S.prev = null;
      S.undoLeft = 0;
      S.undoAt = reduced ? -1 : t;
      S.moves = S.moves.slice(0, -1);
      ctx.onScore(S.score);
      snd.blip(392, 0.09, 'triangle', 0.7, 262);
      paintUndo();
      kick(t + 0.3);
    }
    function paintUndo() {
      if (!undoBtn) return;
      const can = S.undoLeft > 0 && !!S.prev && !S.ended;
      undoBtn.disabled = !can;
      undoTxt.textContent = S.undoLeft > 0 ? 'Undo · 1 left' : 'Undo used';
      undoBtn.title = S.undoLeft > 0 ? (S.prev ? 'Take back your last move (Z). You get one undo per round.' : 'Make a move first. You get one undo per round.') : 'You’ve used this round’s undo.';
      undoBtn.setAttribute('aria-label', S.undoLeft > 0 ? 'Undo the last move (Z). One undo left this round.' : 'Undo used this round');
      undoBtn.hidden = S.ended;
    }
    /* stuck with the undo unused: offer it before the round ends */
    function showStuck() {
      if (S.overlay || S.ended) return;
      const undoB = mk('button', 'arc-ov__btn is-primary', 'Undo last move');
      const endB = mk('button', 'arc-ov__btn', 'End round');
      undoB.type = endB.type = 'button';
      const card = mk('div', 'arc-ov__card',
        mk('div', 'arc-ov__big arc-ov__big--sm', 'No moves left'),
        mk('p', 'arc-ov__text', 'You still have this round’s undo. Take back the last move, or end the round here.'),
        mk('div', 'arc-ov__row', undoB, endB));
      const ov = mk('div', 'arc-ov is-stuck', card);
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-label', 'No moves left');
      ov.style.setProperty('--h', HUE);
      undoB.addEventListener('click', () => { undo(); el.closest('[tabindex]')?.focus({ preventScroll: true }); });
      endB.addEventListener('click', () => { S.overlay?.remove(); S.overlay = null; finish(); });
      el.appendChild(ov);
      S.overlay = ov;
      draw();
      S.focusTimer = setTimeout(() => undoB.focus({ preventScroll: true }), 30);
    }

    /* ------------------------------ the race ------------------------------ */
    function sendMoves() {
      const n = S.moves.length;
      const a = Math.max(0, n - SEND_BACK);
      NET.send({ t: 'mv', a, m: S.moves.slice(a) });
    }
    function beat() {
      if (!R || R.dead) return;
      NET.send({ t: 'st', n: S.moves.length, o: S.over ? 1 : 0 });
    }
    function onNet(d) {
      if (!R || R.dead || !d || typeof d !== 'object') return;
      if (d.t === 'mv') {
        if (!Number.isInteger(d.a) || d.a < 0 || d.a > 20000 || typeof d.m !== 'string' || d.m.length > 1200 || !/^[lrud]*$/.test(d.m)) return;
        takeMoves(d.a, d.m);
      } else if (d.t === 'st') {
        if (!Number.isInteger(d.n) || d.n < 0 || d.n > 20000) return;
        if (d.n > R.them.moves.length) need();
      } else if (d.t === 'need') {
        if (!Number.isInteger(d.a) || d.a < 0) return;
        const t = performance.now();
        if (t - R.lastReply < 400) return;
        R.lastReply = t;
        const a = Math.min(d.a, S.moves.length);
        NET.send({ t: 'mv', a, m: S.moves.slice(a, a + 1000) });
      }
    }
    function need() {
      const t = performance.now();
      if (t - R.lastNeed < 900) return;
      R.lastNeed = t;
      NET.send({ t: 'need', a: R.them.moves.length });
    }
    function takeMoves(a, m) {
      if (R.voided || performance.now() - R.t0 > RACE_MS + GRACE_MS) return;
      const have = R.them.moves.length;
      if (a > have) { need(); return; }
      let changed = false;
      for (let k = have - a; k < m.length; k++) {
        if (!raceMove(R.them, FROM_LETTER[m[k]])) { R.voided = true; finish(); return; }
        changed = true;
      }
      if (changed) { NET.peerScore?.(R.them.score); kick(now() + 0.05); }
    }

    function finish(detail) {
      if (S.ended) return;
      S.ended = true;
      paintUndo();
      let top = 0;
      for (const row of S.grid) for (const t of row) if (t) top = Math.max(top, t.v);
      if (!R) { ctx.onEnd({ score: S.score, won: S.won, detail: detail || `Biggest tile ${top}` }); return; }
      /* the last move message may have been lost: say how many moves there were, a few times */
      beat();
      setTimeout(beat, 700);
      setTimeout(beat, 1800);
      const me = S.score, them = R.them.score;
      if (R.voided) ctx.onEnd({ score: me, won: null, void: true, versus: { me, them }, detail: 'Your friend’s moves stopped matching this board, so this race can’t be scored.' });
      else ctx.onEnd({ score: me, won: me === them ? null : me > them, versus: { me, them }, detail: `Your biggest tile ${top} · theirs ${R.them.top || Math.max(...R.them.grid.flat())}` });
      draw();
    }

    /* ------------------------------ the 2048 card ------------------------------ */
    function showWin() {
      if (S.overlay) return;
      const keep = mk('button', 'arc-ov__btn is-primary', 'Keep going');
      const stopBtn = mk('button', 'arc-ov__btn', 'Finish');
      keep.type = stopBtn.type = 'button';
      const card = mk('div', 'arc-ov__card',
        mk('div', 'arc-ov__big', '2048!'),
        mk('p', 'arc-ov__text', 'You made the 2048 tile. Keep going for a bigger one, or finish the round with this score.'),
        mk('div', 'arc-ov__row', keep, stopBtn));
      const ov = mk('div', 'arc-ov', card);
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-label', 'You made 2048');
      ov.style.setProperty('--h', HUE);
      keep.addEventListener('click', () => { S.keepGoing = true; closeWin(); });
      stopBtn.addEventListener('click', () => { closeWin(); finish('Reached 2048'); });
      el.appendChild(ov);
      S.overlay = ov;
      snd.blip(660, 0.35, 'triangle', 1, 1320);
      S.focusTimer = setTimeout(() => keep.focus({ preventScroll: true }), 30);
    }
    function closeWin() {
      S.overlay?.remove();
      S.overlay = null;
      /* hand the keyboard back to the play area (the shell makes it focusable) */
      el.closest('[tabindex]')?.focus({ preventScroll: true });
      if (S.over) finish();
    }

    /* ------------------------------ loop ------------------------------ */
    let until = 0;
    const loop = looper(() => {
      const t = now();
      draw();
      if (!R && S.over && !S.ended && !S.overlay && t >= S.overAt) {
        if (S.undoLeft > 0 && S.prev) showStuck(); else finish();
      }
      if (R && !S.ended) {
        const left = timeLeft();
        if (S.over && R.them.over && t >= S.overAt) finish();
        else if (left <= 0 && performance.now() - R.t0 >= RACE_MS + GRACE_MS) finish();
        if (performance.now() - R.beat > 1500) { R.beat = performance.now(); beat(); }
        const sec = Math.ceil(left / 1000);
        if (sec !== R.shown) { R.shown = sec; if (sec <= 10 && sec > 0) snd.blip(880, 0.04, 'square', 0.35); }
      }
      if (t > until && !(S.over && !S.ended && !S.overlay) && !(R && !S.ended)) loop.stop();
    });
    function kick(end) { until = Math.max(until, end); loop.start(); }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const pad = Math.max(12, Math.min(sf.w, sf.h) * 0.05);
      if (!R) {
        const size = Math.max(120, Math.min(sf.w, sf.h) - pad * 2);
        const gap = size * 0.028;
        const cell = (size - gap * (N + 1)) / N;
        return { size, gap, cell, ox: (sf.w - size) / 2, oy: (sf.h - size) / 2 };
      }
      /* the race: the friend's board beside yours, or above it */
      const kB = 1.42, kA = 1.3;
      const sB = Math.min(sf.h - pad * 2, (sf.w - pad * 2) / kB), sA = Math.min(sf.w - pad * 2, (sf.h - pad * 2) / kA);
      const side = sB >= sA;
      const size = Math.max(120, side ? sB : sA);
      const gap = size * 0.028;
      const cell = (size - gap * (N + 1)) / N;
      if (side) {
        const ox = (sf.w - size * kB) / 2, oy = (sf.h - size) / 2;
        return { size, gap, cell, ox, oy, race: { side, x: ox + size * 1.06, y: oy, w: size * 0.36, h: size, mini: size * 0.36 } };
      }
      const top = (sf.h - size * kA) / 2;
      return { size, gap, cell, ox: (sf.w - size) / 2, oy: top + size * 0.3, race: { side, x: (sf.w - size) / 2, y: top, w: size, h: size * 0.25, mini: size * 0.25 } };
    }
    const pos = (L, r, c) => ({ x: L.ox + L.gap + c * (L.cell + L.gap), y: L.oy + L.gap + r * (L.cell + L.gap) });
    const ease = k => 1 - (1 - k) ** 3;

    function tile(g, L, v, x, y, scale) {
      const [bg, ink, glow] = TILE[v] || BIG;
      const s = L.cell * scale;
      const cx = x + L.cell / 2, cy = y + L.cell / 2;
      g.save();
      if (glow) { g.shadowBlur = L.cell * 0.35; g.shadowColor = bg; }
      g.fillStyle = bg;
      rr(g, cx - s / 2, cy - s / 2, s, s, L.cell * 0.1 * scale);
      g.fill();
      g.restore();
      if (v <= 4) {
        g.strokeStyle = hsl(HUE, 60, 60, 0.18);
        g.lineWidth = 1;
        rr(g, cx - s / 2 + 0.5, cy - s / 2 + 0.5, s - 1, s - 1, L.cell * 0.1 * scale);
        g.stroke();
      }
      const digits = String(v).length;
      const fs = L.cell * scale * (digits <= 2 ? 0.44 : digits === 3 ? 0.36 : digits === 4 ? 0.29 : 0.24);
      g.fillStyle = ink;
      g.font = `800 ${fs}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(v), cx, cy + fs * 0.04);
    }

    function draw() {
      const g = sf.g;
      sf.begin();
      const t = now();
      g.fillStyle = '#0a0705';
      g.fillRect(0, 0, sf.w, sf.h);
      const warm = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
      warm.addColorStop(0, hsl(HUE, 90, 30, 0.22));
      warm.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = warm;
      g.fillRect(0, 0, sf.w, sf.h);

      const L = layout();
      /* a refused move shakes the board a little along its axis */
      let dx = 0, dy = 0;
      if (S.shakeAt >= 0 && t - S.shakeAt < 0.18) {
        const a = Math.sin((t - S.shakeAt) * 70) * 5 * (1 - (t - S.shakeAt) / 0.18);
        if (S.shake === 1) dx = a; else dy = a;
      }
      g.save();
      g.translate(dx, dy);
      g.save();
      g.shadowBlur = 30;
      g.shadowColor = hsl(HUE, 100, 50, 0.25);
      g.fillStyle = '#16100b';
      rr(g, L.ox, L.oy, L.size, L.size, L.cell * 0.14);
      g.fill();
      g.restore();
      g.strokeStyle = hsl(HUE, 100, 60, 0.25);
      g.lineWidth = 1.5;
      rr(g, L.ox, L.oy, L.size, L.size, L.cell * 0.14);
      g.stroke();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const p = pos(L, r, c);
        g.fillStyle = '#211811';
        rr(g, p.x, p.y, L.cell, L.cell, L.cell * 0.1);
        g.fill();
      }

      /* tiles on their way into a merge */
      S.ghosts = S.ghosts.filter(gh => SLIDE > 0 && t - gh.t0 < SLIDE);
      for (const gh of S.ghosts) {
        const k = ease(clamp((t - gh.t0) / SLIDE, 0, 1));
        const a = pos(L, gh.fr, gh.fc), b = pos(L, gh.r, gh.c);
        tile(g, L, gh.v, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 1);
      }
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const tl = S.grid[r][c];
        if (!tl) continue;
        const b = pos(L, tl.r, tl.c);
        if (tl.kind === 'merge') {
          if (SLIDE && t < tl.t0 + SLIDE) continue;
          const k = POP ? clamp((t - tl.t0 - SLIDE) / POP, 0, 1) : 1;
          tile(g, L, tl.v, b.x, b.y, 1 + Math.sin(Math.PI * k) * 0.12);
        } else if (tl.kind === 'new') {
          if (t < tl.t0) continue;
          const k = POP ? clamp((t - tl.t0) / POP, 0, 1) : 1;
          tile(g, L, tl.v, b.x, b.y, 0.3 + 0.7 * ease(k));
        } else if (tl.kind === 'slide' && SLIDE) {
          const k = ease(clamp((t - tl.t0) / SLIDE, 0, 1));
          const a = pos(L, tl.fr, tl.fc);
          tile(g, L, tl.v, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 1);
        } else {
          tile(g, L, tl.v, b.x, b.y, 1);
        }
      }

      /* an undo just happened: a soft flash on the board */
      if (S.undoAt >= 0 && t - S.undoAt < 0.3) {
        g.fillStyle = `rgba(255,240,210,${0.18 * (1 - (t - S.undoAt) / 0.3)})`;
        rr(g, L.ox, L.oy, L.size, L.size, L.cell * 0.14);
        g.fill();
      }
      const timeUp = R && (timeLeft() <= 0 || R.voided);
      const stuckCard = !!S.overlay?.classList.contains('is-stuck');
      if (((S.over && t >= S.animEnd) || timeUp) && !stuckCard) {
        g.fillStyle = 'rgba(10,7,5,.62)';
        rr(g, L.ox, L.oy, L.size, L.size, L.cell * 0.14);
        g.fill();
        g.fillStyle = '#fff3e0';
        g.font = `800 ${Math.round(L.size * 0.08)}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(R && R.voided ? 'Race stopped' : timeUp && !S.over ? 'Time!' : 'No moves left', L.ox + L.size / 2, L.oy + L.size / 2 - (R ? L.size * 0.04 : 0));
        if (R && !S.ended && !R.voided) {
          g.font = `600 ${Math.round(L.size * 0.038)}px ${FONT}`;
          g.fillStyle = hsl(HUE, 70, 82, 0.9);
          g.fillText(R.them.over ? 'Both boards are stuck' : `Waiting for ${NET.peer?.name || 'your friend'}…`, L.ox + L.size / 2, L.oy + L.size / 2 + L.size * 0.06, L.size * 0.9);
        }
      }
      g.restore();
      if (R) drawRace(g, L);

      /* how to play, when there is room under the board */
      if (!R && sf.h - (L.oy + L.size) > 26) {
        g.fillStyle = hsl(HUE, 50, 80, 0.45);
        g.font = `500 12px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(coarse() ? 'Swipe to slide the tiles  ·  merge equal tiles to reach 2048' : 'Arrow keys, WASD or swipe  ·  Z undoes once  ·  merge equal tiles to reach 2048', sf.w / 2, L.oy + L.size + (sf.h - L.oy - L.size) / 2, sf.w - 20);
      }
    }

    function drawRace(g, L) {
      const P = L.race, them = R.them;
      const name = NET.peer?.name || 'Friend';
      const ph = Number.isFinite(NET.peer?.color) ? NET.peer.color : 330;
      const left = timeLeft();
      const secs = Math.ceil(left / 1000);
      const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const m = P.mini, gap = m * 0.03, mc = (m - gap * (N + 1)) / N;
      const mx = P.side ? P.x : P.x + P.w - m, my = P.y;
      g.fillStyle = '#16100b';
      rr(g, mx, my, m, m, mc * 0.16);
      g.fill();
      g.strokeStyle = hsl(ph, 100, 70, 0.45);
      g.lineWidth = 1.2;
      g.stroke();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = them.grid[r][c];
        const x = mx + gap + c * (mc + gap), y = my + gap + r * (mc + gap);
        g.fillStyle = v ? (TILE[v] || BIG)[0] : '#211811';
        rr(g, x, y, mc, mc, mc * 0.12);
        g.fill();
        if (v) {
          g.fillStyle = (TILE[v] || BIG)[1];
          const d = String(v).length;
          g.font = `800 ${Math.round(mc * (d <= 2 ? 0.42 : d === 3 ? 0.34 : 0.27))}px ${FONT}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(v), x + mc / 2, y + mc / 2 + 1);
        }
      }
      if (them.over) { g.fillStyle = 'rgba(10,7,5,.6)'; rr(g, mx, my, m, m, mc * 0.16); g.fill(); }
      const txt = (text, x, y, size, weight, color, font = FONT, w = 400) => {
        g.font = `${weight} ${Math.round(size)}px ${font}`;
        g.fillStyle = color;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.fillText(text, x, y, w);
      };
      const dim = 'rgba(255,235,210,.5)', MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
      const clockInk = left <= 10_000 ? '#ff7a8a' : '#fff3e0';
      const status = them.over ? 'no moves left' : `biggest tile ${Math.max(...them.grid.flat())} · playing`;
      if (P.side) {
        const f = clamp(L.size * 0.042, 11, 18), x = P.x, y = my + m + 14, w = P.w;
        txt('RACE · SAME TILES', x, y, f * 0.72, 700, dim, FONT, w);
        txt(clock, x, y + f * 1.1, f * 2, 800, clockInk, MONO, w);
        txt(name, x, y + f * 3.5, f, 700, hsl(ph, 100, 76), FONT, w);
        txt(String(them.score), x, y + f * 4.8, f * 1.2, 800, '#fff3e0', MONO, w);
        txt(status, x, y + f * 6.3, f * 0.8, 600, dim, FONT, w);
      } else {
        const f = clamp(P.h / 5.2, 10, 18), y = P.y + (P.h - f * 3.4) / 2;
        const cw = Math.min(P.w * 0.34, f * 6.5), w2 = P.w - m - cw - 18, x2 = P.x + cw + 8;
        txt('RACE · SAME TILES', P.x, y, f * 0.72, 700, dim, FONT, cw);
        txt(clock, P.x, y + f, f * 2.1, 800, clockInk, MONO, cw);
        txt(name, x2, y, f, 700, hsl(ph, 100, 76), FONT, w2);
        txt(String(them.score), x2, y + f * 1.25, f * 1.2, 800, '#fff3e0', MONO, w2);
        txt(status, x2, y + f * 2.7, f * 0.8, 600, dim, FONT, w2);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (UNDO_KEYS.has(key) && !NET) {
        if (S.overlay && !S.overlay.classList.contains('is-stuck')) return;
        e.preventDefault();
        snd.wake();
        undo();
        return;
      }
      const d = DIRS[key];
      if (!d) return;
      if (S.overlay) return;
      e.preventDefault();
      snd.wake();
      move(d);
    };
    let sw = null;
    const onDown = e => {
      if (e.button > 0) return;
      sw = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      snd.wake();
    };
    const onUp = e => {
      if (!sw || sw.id !== e.pointerId) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      sw = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    };
    const onCancel = () => { sw = null; };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onCancel);
    if (R) {
      R.off = NET.on?.(onNet) || null;
      NET.peerScore?.(0);
      beat();
      loop.start();
    }

    kick(now() + POP + 0.05);

    return {
      stop() {
        S.ended = true;
        if (R) { R.dead = true; try { R.off?.(); } catch (err) { /* already off */ } }
        loop.stop();
        clearTimeout(S.winTimer);
        clearTimeout(S.focusTimer);
        undoBtn?.remove();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onCancel);
        S.overlay?.remove();
        snd.close();
        sf.destroy();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        grid: S.grid.map(row => row.map(t => (t ? t.v : 0))),
        score: S.score, won: S.won, keepGoing: S.keepGoing, over: S.over, ended: S.ended, card: !!S.overlay,
        stuckCard: !!S.overlay?.classList.contains('is-stuck'),
        undo: { left: S.undoLeft, ready: S.undoLeft > 0 && !!S.prev }, moves: S.moves,
        race: R ? { them: R.them.score, theirMoves: R.them.moves.length, theirOver: R.them.over, theirGrid: R.them.grid.map(r => r.slice()), left: timeLeft(), voided: R.voided } : null,
      }),
    };
  },
};

function mk(tag, cls, ...kids) {
  const n = document.createElement(tag);
  n.className = cls;
  for (const k of kids) n.append(k);
  return n;
}

/* ---- module kit (the same few helpers in every built-in Arcade game) ---- */

/* A canvas that fills `el`, backed at devicePixelRatio, refit on resize. */
function surface(el, label, onFit) {
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', label);
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(cv);
  const s = { cv, g: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  let armed = false;                 /* the first fit happens before the game exists */
  const fit = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === s.w && h === s.h && dpr === s.dpr) return;
    s.w = w; s.h = h; s.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    if (armed) onFit?.(s);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(el);
  window.addEventListener('resize', fit);
  fit();
  armed = true;
  s.begin = () => s.g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  s.destroy = () => { ro?.disconnect(); window.removeEventListener('resize', fit); cv.remove(); };
  return s;
}

/* Should this keydown drive the game? Not while another window is in
   front, not while typing in a field, and a Space/Enter aimed at a
   button outside the game belongs to that button. */
function ownsKey(el, e) {
  if (!el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const win = el.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
    if ((e.key === ' ' || e.key === 'Enter') && !el.contains(t) && t.closest('button,a,[role="button"]')) return false;
  }
  return true;
}

/* Tiny synth blips, made on the first input (browsers only start audio
   from a gesture) and closed in stop(). Silent while ctx.sound is off. */
function sounder(ctx) {
  let ac = null, dead = false;
  const get = () => {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  return {
    wake() { get(); },
    blip(freq, dur = 0.07, type = 'square', vol = 1, to = 0) {
      const c = get();
      if (!c || c.state !== 'running') return;
      try {
        const t = c.currentTime, o = c.createOscillator(), gn = c.createGain();
        const peak = 0.05 * vol * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(peak, t + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn).connect(c.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (err) { /* audio can fail at any point; the game goes on */ }
    },
    close() {
      dead = true;
      try { ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      ac = null;
    },
  };
}

/* requestAnimationFrame loop with a clamped dt; start/stop for pause. */
function looper(step) {
  let raf = 0, last = 0, on = false;
  const tick = now => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt, now);
  };
  return {
    start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { on = false; cancelAnimationFrame(raf); },
    get on() { return on; },
  };
}

function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}
