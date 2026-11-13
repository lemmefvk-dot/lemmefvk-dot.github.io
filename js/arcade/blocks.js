/* ============================================================
   arcade/blocks.js — Block Fit for Static Arcade.

   A 10 × 10 grid and a tray of three shapes. Put every shape
   somewhere on the grid; when all three are down, three new ones
   arrive. A full row or column clears. The round ends when none of
   the shapes left in the tray fits anywhere.

   Score: 1 point per square placed, plus 10 for one line cleared,
   30 for two at once, 60 for three, 100 for four … (10 × n(n+1)/2).

   Controls
   · mouse / touch — drag a shape from the tray onto the grid (on a
     touch screen it rides above your finger so you can see where it
     lands), or tap a shape and then tap the grid where it should go;
   · keyboard — 1 2 3 or Z / X pick a shape, the arrow keys / WASD
     move it, Space or Enter puts it down;
   · controller — through the Arcade's key bridge (core/padmap.js):
     D-pad moves, A places, X / Y switch shapes.
   While a shape hovers over the grid, the rows and columns it would
   complete light up.

   Online race (ctx.online, from the Arcade's room): both players get
   the same shapes in the same order (a shared seed) and race for
   three minutes. Each placement travels as a two-character move; the
   friend's board on your screen is rebuilt here by REPLAYING those
   moves with the same rules, so their score is counted on your side
   and a move that does not fit their board voids the match instead
   of being believed. Highest score when the clock runs out — or when
   both boards are stuck — wins.

   Drawn on a canvas (Static Replay can record it), DPR-aware, frame
   loop only while something moves. Follows ./index.js's contract.
   ============================================================ */

const HUE = 230;
const N = 10;
const RACE_MS = 180_000;
const GRACE_MS = 4000;             /* moves still in flight when the clock runs out */
const SEND_BACK = 8;               /* each move message repeats the last few moves */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "tap" and "drag", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/* ------------------------------ shapes ------------------------------ */
const shape = (id, cells, w, hue) => ({
  id, cells, w, hue,
  rows: Math.max(...cells.map(c => c[0])) + 1,
  cols: Math.max(...cells.map(c => c[1])) + 1,
});
const line = (n, v) => Array.from({ length: n }, (_, i) => (v ? [i, 0] : [0, i]));
export const SHAPES = [
  shape('dot', [[0, 0]], 2, 52),
  shape('i2', line(2), 3, 188), shape('i2v', line(2, true), 3, 188),
  shape('i3', line(3), 3, 148), shape('i3v', line(3, true), 3, 148),
  shape('i4', line(4), 2, 268), shape('i4v', line(4, true), 2, 268),
  shape('i5', line(5), 1, 328), shape('i5v', line(5, true), 1, 328),
  shape('sq2', [[0, 0], [0, 1], [1, 0], [1, 1]], 3, 26),
  shape('sq3', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 1, 2),
  shape('l3a', [[0, 0], [1, 0], [1, 1]], 2, 212), shape('l3b', [[0, 0], [0, 1], [1, 0]], 2, 212),
  shape('l3c', [[0, 0], [0, 1], [1, 1]], 2, 212), shape('l3d', [[0, 1], [1, 0], [1, 1]], 2, 212),
  shape('l5a', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 1, 118), shape('l5b', [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 1, 118),
  shape('l5c', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 1, 118), shape('l5d', [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], 1, 118),
];
const TOTAL_W = SHAPES.reduce((s, x) => s + x.w, 0);

/* ------------------------------ the rules (pure) ------------------------------ */
/* the same code runs your game and replays your friend's */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rnd) {
  let x = rnd() * TOTAL_W;
  for (let i = 0; i < SHAPES.length; i++) { x -= SHAPES[i].w; if (x < 0) return i; }
  return 0;
}
export function fits(board, sh, r, c) {
  for (const [dr, dc] of sh.cells) {
    const y = r + dr, x = c + dc;
    if (y < 0 || x < 0 || y >= N || x >= N || board[y * N + x]) return false;
  }
  return true;
}
const fitsAnywhere = (board, sh) => {
  for (let r = 0; r <= N - sh.rows; r++) for (let c = 0; c <= N - sh.cols; c++) if (fits(board, sh, r, c)) return true;
  return false;
};
const anyFits = st => st.tray.some(id => id !== null && fitsAnywhere(st.board, SHAPES[id]));
const refill = st => { for (let i = 0; i < 3; i++) st.tray[i] = pick(st.rnd); };

export function newGame(seed) {
  const st = { board: new Uint8Array(N * N), tray: [null, null, null], rnd: rng32(seed), score: 0, lines: 0, placed: 0, moves: '', out: false };
  refill(st);
  st.out = !anyFits(st);
  return st;
}
export const encMove = (slot, r, c) => (slot * 100 + r * N + c).toString(36).padStart(2, '0');
export const decMove = s => {
  const v = parseInt(s, 36);
  if (!Number.isInteger(v) || v < 0 || v >= 300) return null;
  return { slot: Math.floor(v / 100), r: Math.floor((v % 100) / N), c: v % N };
};
/** Wouldn't-it-clear: the full rows / columns after putting `sh` at r,c. */
function fullLines(board, sh, r, c) {
  const b = board.slice();
  for (const [dr, dc] of sh.cells) b[(r + dr) * N + c + dc] = 1;
  const rows = [], cols = [];
  for (let y = 0; y < N; y++) { let full = true; for (let x = 0; x < N; x++) if (!b[y * N + x]) { full = false; break; } if (full) rows.push(y); }
  for (let x = 0; x < N; x++) { let full = true; for (let y = 0; y < N; y++) if (!b[y * N + x]) { full = false; break; } if (full) cols.push(x); }
  return { rows, cols };
}
/** Put tray[slot] at r,c. Returns what happened, or null when the move is not legal. */
export function play(st, slot, r, c) {
  if (st.out || !(slot >= 0 && slot < 3)) return null;
  const id = st.tray[slot];
  if (id === null) return null;
  const sh = SHAPES[id];
  if (!fits(st.board, sh, r, c)) return null;
  const cells = sh.cells.map(([dr, dc]) => (r + dr) * N + c + dc);
  const { rows, cols } = fullLines(st.board, sh, r, c);
  for (const i of cells) st.board[i] = id + 1;
  const gone = new Map();
  for (const y of rows) for (let x = 0; x < N; x++) gone.set(y * N + x, st.board[y * N + x]);
  for (const x of cols) for (let y = 0; y < N; y++) gone.set(y * N + x, st.board[y * N + x]);
  for (const i of gone.keys()) st.board[i] = 0;
  const n = rows.length + cols.length;
  const gained = cells.length + (10 * n * (n + 1)) / 2;
  st.score += gained;
  st.lines += n;
  st.placed++;
  st.tray[slot] = null;
  st.moves += encMove(slot, r, c);
  let refilled = false;
  if (st.tray.every(x => x === null)) { refill(st); refilled = true; }
  st.out = !anyFits(st);
  return { id, cells, rows, cols, gone, gained, n, refilled };
}

/* ------------------------------ the game ------------------------------ */
export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const snd = sounder(ctx);
    const now = () => performance.now() / 1000;
    const seed = NET ? NET.seed >>> 0 : (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);
    const st = newGame(seed);
    const S = {
      sel: 0, cur: { r: 3, c: 3 }, kbd: false,
      drag: null, hover: null, back: null,
      pops: [], clears: [], flashes: [], floats: [],
      shakeAt: -1, badSlot: -1, badAt: -1,
      overAt: 0, ended: false, dead: false,
      hint: true,
    };
    /* the race: their game, replayed here from their moves */
    const R = NET ? {
      t0: performance.now(), them: newGame(seed), voided: false,
      lastNeed: 0, lastReply: 0, beat: 0, off: null, shown: -1,
    } : null;
    const sf = surface(el, NET ? 'Block Fit race' : 'Block Fit', () => { sprites.clear(); draw(); });
    const sprites = new Map();
    ctx.onScore(0);
    selectNext(-1);

    /* ------------------------------ moves ------------------------------ */
    function selectNext(from) {
      for (let k = 1; k <= 3; k++) {
        const i = (from + k + 3) % 3;
        if (st.tray[i] !== null) { S.sel = i; clampCursor(); return; }
      }
    }
    function clampCursor() {
      const id = st.tray[S.sel];
      if (id === null) return;
      const sh = SHAPES[id];
      S.cur.r = clamp(S.cur.r, 0, N - sh.rows);
      S.cur.c = clamp(S.cur.c, 0, N - sh.cols);
    }
    const timeLeft = () => (R ? Math.max(0, RACE_MS - (performance.now() - R.t0)) : Infinity);
    const canPlay = () => !S.ended && !st.out && !(R && (timeLeft() <= 0 || R.voided));

    function place(slot, r, c, from) {
      if (!canPlay()) return false;
      const t = now();
      const res = play(st, slot, r, c);
      if (!res) {
        bad(slot);
        return false;
      }
      S.hint = false;
      const sh = SHAPES[res.id];
      for (const i of res.cells) S.pops.push({ i, t0: t });
      for (const [i, v] of res.gone) {
        const y = Math.floor(i / N), x = i % N;
        /* cells go out from the middle of each line */
        let d = 9;
        for (const ry of res.rows) if (ry === y) d = Math.min(d, Math.abs(x - 4.5));
        for (const cx of res.cols) if (cx === x) d = Math.min(d, Math.abs(y - 4.5));
        S.clears.push({ i, v, t0: t + d * 0.018 });
      }
      for (const y of res.rows) S.flashes.push({ row: y, t0: t });
      for (const x of res.cols) S.flashes.push({ col: x, t0: t });
      if (res.n) {
        const L = layout();
        const cy = r + sh.rows / 2, cx = c + sh.cols / 2;
        S.floats.push({ text: `+${res.gained}`, sub: res.n > 1 ? `${res.n} lines` : '', x: L.bx + cx * L.cell, y: L.by + cy * L.cell, t0: t });
        [0, 0.07, 0.14, 0.21].slice(0, Math.min(4, res.n + 1)).forEach((d, k) => setTimeout(() => snd.blip(523 * 2 ** (k * 4 / 12), 0.12, 'triangle', 0.8), d * 1000));
      } else {
        snd.blip(196 + sh.cells.length * 22, 0.05, 'square', 0.45);
      }
      ctx.onScore(st.score);
      if (res.refilled) { S.sel = 0; selectNext(-1); }
      else if (st.tray[S.sel] === null) selectNext(slot);
      else clampCursor();
      if (from === 'drag') { S.cur = { r, c }; clampCursor(); }
      if (NET) sendMoves();
      if (st.out) {
        S.overAt = t + (reduced ? 0.6 : 1.1);
        setTimeout(() => snd.blip(330, 0.35, 'sawtooth', 0.7, 110), 180);
        if (NET) beat();
      }
      kick();
      return true;
    }

    function bad(slot) {
      S.shakeAt = reduced ? -1 : now();
      S.badSlot = slot;
      S.badAt = now();
      snd.blip(130, 0.12, 'sawtooth', 0.5, 90);
      kick();
    }

    /* ------------------------------ the race ------------------------------ */
    function sendMoves() {
      const n = st.moves.length / 2;
      const a = Math.max(0, n - SEND_BACK);
      NET.send({ t: 'mv', a, m: st.moves.slice(a * 2) });
    }
    function beat() {
      if (S.dead) return;
      NET.send({ t: 'st', n: st.moves.length / 2, o: st.out ? 1 : 0 });
    }
    function onNet(d) {
      if (!R || S.dead || !d || typeof d !== 'object') return;
      if (d.t === 'mv') {
        if (!Number.isInteger(d.a) || d.a < 0 || d.a > 5000 || typeof d.m !== 'string' || d.m.length > 1200 || d.m.length % 2 || !/^[0-9a-z]*$/.test(d.m)) return;
        takeMoves(d.a, d.m);
      } else if (d.t === 'st') {
        if (!Number.isInteger(d.n) || d.n < 0 || d.n > 5000) return;
        if (d.n > R.them.moves.length / 2) need();
      } else if (d.t === 'need') {
        if (!Number.isInteger(d.a) || d.a < 0) return;
        const t = performance.now();
        if (t - R.lastReply < 400) return;
        R.lastReply = t;
        const a = Math.min(d.a, st.moves.length / 2);
        NET.send({ t: 'mv', a, m: st.moves.slice(a * 2, a * 2 + 600) });
      }
    }
    function need() {
      const t = performance.now();
      if (t - R.lastNeed < 900) return;
      R.lastNeed = t;
      NET.send({ t: 'need', a: R.them.moves.length / 2 });
    }
    function takeMoves(a, m) {
      if (R.voided) return;
      /* past the clock (plus the grace for moves in flight) nothing counts */
      if (performance.now() - R.t0 > RACE_MS + GRACE_MS) return;
      const have = R.them.moves.length / 2;
      if (a > have) { need(); return; }
      let changed = false;
      for (let k = (have - a) * 2; k < m.length; k += 2) {
        const mv = decMove(m.slice(k, k + 2));
        if (!mv || !play(R.them, mv.slot, mv.r, mv.c)) {
          R.voided = true;
          finish();
          return;
        }
        changed = true;
      }
      if (changed) {
        NET.peerScore?.(R.them.score);
        kick();
      }
    }

    /* ------------------------------ end ------------------------------ */
    function finish() {
      if (S.ended) return;
      S.ended = true;
      S.drag = null;
      const detail = `${st.lines} line${st.lines === 1 ? '' : 's'} cleared · ${st.placed} shapes placed`;
      if (!R) { draw(); ctx.onEnd({ score: st.score, detail }); return; }
      /* the last move message may have been lost: say how many moves there were, a few times */
      beat();
      setTimeout(beat, 700);
      setTimeout(beat, 1800);
      const me = st.score, them = R.them.score;
      if (R.voided) {
        ctx.onEnd({ score: me, won: null, void: true, versus: { me, them }, detail: 'Your friend’s moves stopped matching this game’s shapes, so this race can’t be scored.' });
      } else {
        ctx.onEnd({ score: me, won: me === them ? null : me > them, versus: { me, them }, detail });
      }
      draw();
    }

    /* ------------------------------ loop ------------------------------ */
    let until = 0;
    const loop = looper(() => {
      const t = now();
      draw();
      if (!S.ended) {
        if (!R && st.out && t >= S.overAt) finish();
        if (R) {
          const left = timeLeft();
          if (st.out && R.them.out && t >= S.overAt) finish();
          else if (left <= 0 && performance.now() - R.t0 >= RACE_MS + GRACE_MS) finish();
          if (performance.now() - R.beat > 1500) { R.beat = performance.now(); beat(); }
          const sec = Math.ceil(left / 1000);
          if (sec !== R.shown) { R.shown = sec; if (sec <= 10 && sec > 0) snd.blip(880, 0.04, 'square', 0.35); }
        }
      }
      const busy = S.drag || S.back || S.pops.length || S.clears.length || S.flashes.length || S.floats.length
        || (S.shakeAt >= 0 && t - S.shakeAt < 0.3) || (S.badAt >= 0 && t - S.badAt < 0.5)
        || (!S.ended && (R || st.out));
      if (!busy && t > until) loop.stop();
    });
    function kick(extra = 0.05) { until = Math.max(until, now() + extra); loop.start(); }

    /* ------------------------------ layout ------------------------------ */
    function layout() {
      const W = sf.w, H = sf.h;
      const pad = clamp(Math.min(W, H) * 0.045, 10, 26);
      const race = !!R;
      const hint = H > 300 ? 22 : 0;
      /* tray below the grid, or beside it — whichever gives the bigger grid */
      const kA = 1 + 0.05 + 0.3 + (race ? 0.26 : 0);
      const bA = Math.min(W - pad * 2, (H - pad * 2 - hint) / kA);
      const kB = 1 + 0.05 + 0.3 + (race ? 0.06 + 0.36 : 0);
      const bB = Math.min(H - pad * 2 - hint, (W - pad * 2) / kB);
      const side = bB > bA * 1.04;
      const B = Math.max(120, side ? bB : bA);
      const L = { side, B, cell: B / N, pad, hint };
      if (side) {
        const ox = (W - B * kB) / 2, oy = (H - hint - B) / 2;
        L.bx = ox; L.by = oy;
        const tx = ox + B * 1.05, tw = B * 0.3;
        L.slots = [0, 1, 2].map(i => ({ x: tx, y: oy + (i * B) / 3, w: tw, h: B / 3 }));
        if (race) L.race = { x: tx + tw + B * 0.06, y: oy, w: B * 0.36, h: B, mini: B * 0.36 };
      } else {
        const ox = (W - B) / 2, oy = (H - hint - B * kA) / 2;
        L.bx = ox; L.by = oy + (race ? B * 0.26 : 0);
        const ty = L.by + B * 1.05, th = B * 0.3;
        L.slots = [0, 1, 2].map(i => ({ x: ox + (i * B) / 3, y: ty, w: B / 3, h: th }));
        if (race) L.race = { x: ox, y: oy, w: B, h: B * 0.22, mini: B * 0.22 };
      }
      for (const s of L.slots) s.cell = Math.min(L.cell * 0.62, Math.min(s.w, s.h) / 5.4);
      return L;
    }
    const boardCell = (L, x, y) => {
      const c = Math.floor((x - L.bx) / L.cell), r = Math.floor((y - L.by) / L.cell);
      return r >= 0 && r < N && c >= 0 && c < N ? { r, c } : null;
    };
    const slotAt = (L, x, y) => L.slots.findIndex(s => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);

    /* where a dragged shape would land: its top-left cell, if it fits */
    function dropTarget(L, d) {
      const id = st.tray[d.slot];
      if (id === null) return null;
      const sh = SHAPES[id];
      const left = d.x - (sh.cols * L.cell) / 2, top = d.y + d.lift - (sh.rows * L.cell) / 2;
      const c = Math.round((left - L.bx) / L.cell), r = Math.round((top - L.by) / L.cell);
      return { r, c, ok: fits(st.board, sh, r, c) };
    }

    /* ------------------------------ drawing ------------------------------ */
    function sprite(hue, size) {
      const px = Math.max(2, Math.round(size * sf.dpr));
      const key = `${hue}|${px}`;
      let s = sprites.get(key);
      if (s) return s;
      s = document.createElement('canvas');
      s.width = s.height = px;
      const g = s.getContext('2d');
      const r = px * 0.2, inset = Math.max(1, px * 0.04);
      const grd = g.createLinearGradient(0, 0, 0, px);
      grd.addColorStop(0, hsl(hue, 95, 68));
      grd.addColorStop(0.55, hsl(hue, 85, 54));
      grd.addColorStop(1, hsl(hue, 80, 40));
      g.fillStyle = grd;
      rr(g, inset, inset, px - inset * 2, px - inset * 2, r);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.32)';
      rr(g, px * 0.18, px * 0.14, px * 0.64, px * 0.14, px * 0.07);
      g.fill();
      g.strokeStyle = hsl(hue, 100, 82, 0.55);
      g.lineWidth = Math.max(1, px * 0.04);
      rr(g, inset + 0.5, inset + 0.5, px - inset * 2 - 1, px - inset * 2 - 1, r);
      g.stroke();
      if (sprites.size > 160) sprites.clear();
      sprites.set(key, s);
      return s;
    }
    const block = (g, hue, x, y, size, k = 1, alpha = 1) => {
      if (k <= 0 || alpha <= 0) return;
      const s = size * k;
      g.globalAlpha = alpha;
      g.drawImage(sprite(hue, size), x + (size - s) / 2, y + (size - s) / 2, s, s);
      g.globalAlpha = 1;
    };
    const ease = k => 1 - (1 - k) ** 3;

    function draw() {
      const g = sf.g;
      sf.begin();
      const t = now();
      const L = layout();
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h * 0.45, 0, sf.w / 2, sf.h * 0.45, Math.max(sf.w, sf.h) * 0.7);
      glow.addColorStop(0, hsl(HUE, 90, 35, 0.22));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, sf.w, sf.h);

      /* the board */
      let dx = 0;
      if (S.shakeAt >= 0 && t - S.shakeAt < 0.25) dx = Math.sin((t - S.shakeAt) * 60) * 5 * (1 - (t - S.shakeAt) / 0.25);
      g.save();
      g.translate(dx, 0);
      const { bx, by, B, cell } = L;
      g.save();
      g.shadowBlur = 34;
      g.shadowColor = hsl(HUE, 100, 55, 0.35);
      g.fillStyle = '#0b0d1c';
      rr(g, bx - 6, by - 6, B + 12, B + 12, cell * 0.36);
      g.fill();
      g.restore();
      g.strokeStyle = hsl(HUE, 100, 70, 0.28);
      g.lineWidth = 1.5;
      rr(g, bx - 6, by - 6, B + 12, B + 12, cell * 0.36);
      g.stroke();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        g.fillStyle = (r + c) % 2 ? '#121530' : '#10132a';
        rr(g, bx + c * cell + 1.5, by + r * cell + 1.5, cell - 3, cell - 3, cell * 0.16);
        g.fill();
      }

      /* where the held shape would go, and what it would clear */
      const ghost = ghostNow(L);
      if (ghost && ghost.ok) {
        const lines = fullLines(st.board, ghost.sh, ghost.r, ghost.c);
        g.fillStyle = hsl(ghost.sh.hue, 100, 70, 0.16);
        for (const y of lines.rows) rr(g, bx + 1, by + y * cell + 1, B - 2, cell - 2, cell * 0.16), g.fill();
        for (const x of lines.cols) rr(g, bx + x * cell + 1, by + 1, cell - 2, B - 2, cell * 0.16), g.fill();
      }

      /* placed squares */
      const popT = reduced ? 0 : 0.14;
      const popAt = new Map();
      S.pops = S.pops.filter(p => popT && t - p.t0 < popT);
      for (const p of S.pops) popAt.set(p.i, (t - p.t0) / popT);
      for (let i = 0; i < N * N; i++) {
        const v = st.board[i];
        if (!v) continue;
        const k = popAt.has(i) ? 0.6 + 0.4 * ease(popAt.get(i)) : 1;
        const lineHi = ghost && ghost.ok && ghost.lines && (ghost.lines.rows.includes(Math.floor(i / N)) || ghost.lines.cols.includes(i % N));
        block(g, SHAPES[v - 1].hue, bx + (i % N) * cell, by + Math.floor(i / N) * cell, cell, k, lineHi ? 0.65 : 1);
      }
      if (ghost) {
        for (const [dr, dc] of ghost.sh.cells) {
          const x = bx + (ghost.c + dc) * cell, y = by + (ghost.r + dr) * cell;
          if (ghost.ok) block(g, ghost.sh.hue, x, y, cell, 1, 0.42);
          else if (ghost.r + dr >= 0 && ghost.r + dr < N && ghost.c + dc >= 0 && ghost.c + dc < N) {
            g.strokeStyle = 'rgba(255,90,110,.75)';
            g.lineWidth = 2;
            rr(g, x + 3, y + 3, cell - 6, cell - 6, cell * 0.16);
            g.stroke();
          }
        }
        if (S.kbd && !S.drag) {
          const sh = ghost.sh;
          g.strokeStyle = ghost.ok ? hsl(sh.hue, 100, 80, 0.9) : 'rgba(255,110,130,.9)';
          g.setLineDash([5, 4]);
          g.lineWidth = 1.5;
          rr(g, bx + ghost.c * cell - 2, by + ghost.r * cell - 2, sh.cols * cell + 4, sh.rows * cell + 4, cell * 0.2);
          g.stroke();
          g.setLineDash([]);
        }
      }

      /* clearing lines: a flash, then squares shrink out from the middle */
      const clrT = reduced ? 0 : 0.32;
      S.clears = S.clears.filter(cl => clrT && t - cl.t0 < clrT);
      for (const cl of S.clears) {
        const k = clamp((t - cl.t0) / clrT, 0, 1);
        block(g, SHAPES[cl.v - 1]?.hue ?? HUE, bx + (cl.i % N) * cell, by + Math.floor(cl.i / N) * cell, cell, 1 - ease(k) * 0.9, 1 - k);
      }
      const flT = reduced ? 0.15 : 0.4;
      S.flashes = S.flashes.filter(f => t - f.t0 < flT);
      for (const f of S.flashes) {
        const a = (1 - (t - f.t0) / flT) * 0.5;
        g.fillStyle = `rgba(255,255,255,${a})`;
        if (f.row !== undefined) rr(g, bx, by + f.row * cell, B, cell, cell * 0.2);
        else rr(g, bx + f.col * cell, by, cell, B, cell * 0.2);
        g.fill();
      }
      g.restore();

      /* the tray */
      L.slots.forEach((s, i) => drawSlot(g, L, s, i, t));

      /* score pops */
      S.floats = S.floats.filter(f => t - f.t0 < (reduced ? 0.6 : 0.9));
      for (const f of S.floats) {
        const k = (t - f.t0) / (reduced ? 0.6 : 0.9);
        const y = f.y - (reduced ? 0 : ease(k) * cell * 1.4);
        g.globalAlpha = 1 - k * k;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${Math.round(cell * 0.62)}px ${FONT}`;
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(5,6,13,.85)';
        g.strokeText(f.text, f.x, y);
        g.fillStyle = '#fff6c8';
        g.fillText(f.text, f.x, y);
        if (f.sub) {
          g.font = `700 ${Math.round(cell * 0.32)}px ${FONT}`;
          g.strokeText(f.sub, f.x, y + cell * 0.5);
          g.fillStyle = hsl(HUE, 100, 82);
          g.fillText(f.sub, f.x, y + cell * 0.5);
        }
        g.globalAlpha = 1;
      }

      /* the shape being dragged, at full size */
      if (S.drag && S.drag.moved) {
        const id = st.tray[S.drag.slot];
        if (id !== null) {
          const sh = SHAPES[id];
          const x0 = S.drag.x - (sh.cols * cell) / 2, y0 = S.drag.y + S.drag.lift - (sh.rows * cell) / 2;
          g.save();
          g.shadowBlur = 24;
          g.shadowColor = 'rgba(0,0,0,.6)';
          for (const [dr, dc] of sh.cells) block(g, sh.hue, x0 + dc * cell, y0 + dr * cell, cell, 1.04);
          g.restore();
        }
      }
      if (S.back) {
        const k = clamp((t - S.back.t0) / 0.16, 0, 1);
        const id = st.tray[S.back.slot];
        if (k >= 1 || id === null) S.back = null;
        else {
          const sh = SHAPES[id], s = L.slots[S.back.slot];
          const tc = s.cell + (cell - s.cell) * (1 - ease(k));
          const tx = s.x + s.w / 2, ty = s.y + s.h / 2;
          const cx = S.back.x + (tx - S.back.x) * ease(k), cy = S.back.y + (ty - S.back.y) * ease(k);
          for (const [dr, dc] of sh.cells) block(g, sh.hue, cx - (sh.cols * tc) / 2 + dc * tc, cy - (sh.rows * tc) / 2 + dr * tc, tc);
        }
      }

      if (R) drawRace(g, L, t);

      /* round over */
      if (st.out || (R && (timeLeft() <= 0 || R.voided))) {
        g.fillStyle = 'rgba(5,6,13,.62)';
        rr(g, bx - 6, by - 6, B + 12, B + 12, cell * 0.36);
        g.fill();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#f2f4ff';
        g.font = `800 ${Math.round(B * 0.075)}px ${FONT}`;
        const title = R && R.voided ? 'Race stopped' : R && timeLeft() <= 0 ? 'Time!' : 'No room left';
        g.fillText(title, bx + B / 2, by + B / 2 - (R ? B * 0.04 : 0));
        if (R && !S.ended && !R.voided) {
          g.font = `600 ${Math.round(B * 0.036)}px ${FONT}`;
          g.fillStyle = hsl(HUE, 70, 82, 0.9);
          g.fillText(R.them.out ? 'Both boards are full' : `Waiting for ${NET.peer?.name || 'your friend'}…`, bx + B / 2, by + B / 2 + B * 0.05, B * 0.9);
        }
      }

      /* how to play, when there is room under everything */
      if (L.hint && !S.ended) {
        g.fillStyle = hsl(HUE, 50, 82, 0.5);
        g.font = `500 12px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const msg = coarse()
          ? 'Drag a shape onto the grid, or tap a shape then tap the grid  ·  fill a row or column to clear it'
          : 'Drag a shape onto the grid  ·  or 1 2 3 / Z X pick, arrows move, Space places  ·  full rows and columns clear';
        g.fillText(msg, sf.w / 2, sf.h - L.hint / 2 - 4, sf.w - 20);
      }
    }

    function ghostNow(L) {
      if (!canPlay()) return null;
      if (S.drag && S.drag.moved) {
        const tg = dropTarget(L, S.drag);
        const id = st.tray[S.drag.slot];
        if (!tg || id === null) return null;
        const sh = SHAPES[id];
        /* only show it while the shape is over (or overlapping) the grid */
        if (tg.r + sh.rows <= 0 || tg.c + sh.cols <= 0 || tg.r >= N || tg.c >= N) return null;
        return { sh, r: tg.r, c: tg.c, ok: tg.ok, lines: tg.ok ? fullLines(st.board, sh, tg.r, tg.c) : null };
      }
      if (S.kbd && st.tray[S.sel] !== null) {
        const sh = SHAPES[st.tray[S.sel]];
        const ok = fits(st.board, sh, S.cur.r, S.cur.c);
        return { sh, r: S.cur.r, c: S.cur.c, ok, lines: ok ? fullLines(st.board, sh, S.cur.r, S.cur.c) : null };
      }
      return null;
    }

    function drawSlot(g, L, s, i, t) {
      const id = st.tray[i];
      const on = i === S.sel && id !== null && canPlay();
      const pad = Math.min(s.w, s.h) * 0.07;
      const x = s.x + pad, y = s.y + pad, w = s.w - pad * 2, h = s.h - pad * 2;
      g.fillStyle = on ? hsl(HUE, 80, 30, 0.35) : 'rgba(255,255,255,.025)';
      rr(g, x, y, w, h, Math.min(w, h) * 0.14);
      g.fill();
      g.strokeStyle = on ? hsl(HUE, 100, 75, 0.7) : 'rgba(255,255,255,.07)';
      g.lineWidth = on ? 1.5 : 1;
      g.stroke();
      g.fillStyle = 'rgba(220,225,255,.32)';
      g.font = `700 ${Math.max(9, Math.round(Math.min(w, h) * 0.1))}px ${MONO}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      if (!coarse()) g.fillText(String(i + 1), x + 6, y + 5);
      if (id === null) return;
      if (S.drag && S.drag.slot === i && S.drag.moved) return;
      if (S.back && S.back.slot === i) return;
      const sh = SHAPES[id];
      const stuck = !fitsAnywhere(st.board, sh);
      let k = 1;
      if (S.badSlot === i && S.badAt >= 0 && t - S.badAt < 0.4 && !reduced) k = 1 + Math.sin((t - S.badAt) * 40) * 0.05;
      const tc = s.cell * k;
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      for (const [dr, dc] of sh.cells) block(g, stuck ? 230 : sh.hue, cx - (sh.cols * tc) / 2 + dc * tc, cy - (sh.rows * tc) / 2 + dr * tc, tc, 1, stuck ? 0.28 : 1);
    }

    function drawRace(g, L, t) {
      const P = L.race;
      const them = R.them;
      const name = NET.peer?.name || 'Friend';
      const ph = Number.isFinite(NET.peer?.color) ? NET.peer.color : 330;
      const left = timeLeft();
      const mm = Math.floor(Math.ceil(left / 1000) / 60), ss = Math.ceil(left / 1000) % 60;
      const clock = `${mm}:${String(ss).padStart(2, '0')}`;
      const m = P.mini, mc = m / N;
      /* the friend's grid, rebuilt from their moves */
      const mx = L.side ? P.x : P.x + P.w - m, my = P.y;
      g.fillStyle = '#0b0d1c';
      rr(g, mx - 3, my - 3, m + 6, m + 6, mc * 0.5);
      g.fill();
      g.strokeStyle = hsl(ph, 100, 70, 0.45);
      g.lineWidth = 1.2;
      g.stroke();
      for (let i = 0; i < N * N; i++) {
        const v = them.board[i];
        g.fillStyle = v ? hsl(SHAPES[v - 1].hue, 85, 58) : 'rgba(255,255,255,.045)';
        g.fillRect(mx + (i % N) * mc + 0.6, my + Math.floor(i / N) * mc + 0.6, mc - 1.2, mc - 1.2);
      }
      if (them.out) {
        g.fillStyle = 'rgba(5,6,13,.6)';
        g.fillRect(mx, my, m, m);
      }
      /* clock, name, score, status: a column beside the grid, or two columns above it */
      const status = them.out ? 'out of moves' : `${them.lines} line${them.lines === 1 ? '' : 's'} · playing`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      const txt = (text, x, y, size, weight, color, font = FONT, w = 400) => {
        g.font = `${weight} ${Math.round(size)}px ${font}`;
        g.fillStyle = color;
        g.fillText(text, x, y, w);
      };
      const dim = 'rgba(220,225,255,.5)';
      const clockInk = left <= 10_000 ? '#ff7a8a' : '#f2f4ff';
      if (L.side) {
        const f = clamp(L.B * 0.042, 11, 18), x = P.x, y = my + m + 14, w = P.w;
        txt('RACE · SAME SHAPES', x, y, f * 0.72, 700, dim, FONT, w);
        txt(clock, x, y + f * 1.1, f * 2, 800, clockInk, MONO, w);
        txt(name, x, y + f * 3.5, f, 700, hsl(ph, 100, 76), FONT, w);
        txt(String(them.score), x, y + f * 4.8, f * 1.2, 800, '#f2f4ff', MONO, w);
        txt(status, x, y + f * 6.3, f * 0.8, 600, dim, FONT, w);
      } else {
        const f = clamp(P.h / 5.2, 10, 18), y = P.y + (P.h - f * 3.4) / 2;
        const cw = Math.min(P.w * 0.34, f * 6.5), w2 = P.w - m - cw - 18;
        txt('RACE · SAME SHAPES', P.x, y, f * 0.72, 700, dim, FONT, cw);
        txt(clock, P.x, y + f * 1.0, f * 2.1, 800, clockInk, MONO, cw);
        const x2 = P.x + cw + 8;
        txt(name, x2, y, f, 700, hsl(ph, 100, 76), FONT, w2);
        txt(String(them.score), x2, y + f * 1.25, f * 1.2, 800, '#f2f4ff', MONO, w2);
        txt(status, x2, y + f * 2.7, f * 0.8, 600, dim, FONT, w2);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const local = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0) return;
      snd.wake();
      if (!canPlay()) return;
      const L = layout();
      const p = local(e);
      const i = slotAt(L, p.x, p.y);
      if (i >= 0 && st.tray[i] !== null) {
        e.preventDefault();
        S.sel = i;
        clampCursor();
        const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        const sh = SHAPES[st.tray[i]];
        S.drag = { slot: i, id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, lift: touch ? -(sh.rows * L.cell) / 2 - L.cell * 1.1 : 0 };
        S.back = null;
        try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        sf.cv.style.cursor = 'grabbing';
        kick();
        return;
      }
      const cell = boardCell(L, p.x, p.y);
      if (cell && st.tray[S.sel] !== null) S.tap = { id: e.pointerId, x: p.x, y: p.y, cell };
    };
    const onMove = e => {
      const p = local(e);
      if (S.drag && e.pointerId === S.drag.id) {
        S.drag.x = p.x; S.drag.y = p.y;
        if (!S.drag.moved && Math.hypot(p.x - S.drag.sx, p.y - S.drag.sy) > 6) { S.drag.moved = true; S.kbd = false; }
        kick();
        return;
      }
      if (e.pointerType === 'mouse' && !S.drag) {
        const L = layout();
        const i = slotAt(L, p.x, p.y);
        sf.cv.style.cursor = i >= 0 && st.tray[i] !== null && canPlay() ? 'grab' : 'default';
      }
    };
    const onUp = e => {
      const p = local(e);
      if (S.drag && e.pointerId === S.drag.id) {
        const d = S.drag;
        S.drag = null;
        sf.cv.style.cursor = 'grab';
        if (!d.moved) { kick(); return; }          /* a tap picks the shape; tap the grid next */
        const L = layout();
        const tg = dropTarget(L, { ...d, x: p.x, y: p.y });
        if (tg && tg.ok && place(d.slot, tg.r, tg.c, 'drag')) return;
        if (tg && boardCell(L, p.x, p.y + d.lift)) bad(d.slot);
        S.back = { slot: d.slot, x: p.x, y: p.y + d.lift, t0: now() };
        kick(0.2);
        return;
      }
      if (S.tap && S.tap.id === e.pointerId) {
        const tp = S.tap;
        S.tap = null;
        if (Math.hypot(p.x - tp.x, p.y - tp.y) > 10) return;
        const id = st.tray[S.sel];
        if (id === null) return;
        const sh = SHAPES[id];
        /* the tapped square is the middle of the shape */
        const r = tp.cell.r - Math.floor((sh.rows - 1) / 2), c = tp.cell.c - Math.floor((sh.cols - 1) / 2);
        place(S.sel, r, c, 'tap');
      }
    };
    const onCancel = e => {
      if (S.drag && e.pointerId === S.drag.id) {
        S.back = S.drag.moved ? { slot: S.drag.slot, x: S.drag.x, y: S.drag.y + S.drag.lift, t0: now() } : null;
        S.drag = null;
        kick(0.2);
      }
      S.tap = null;
    };
    const MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], KeyW: [-1, 0], KeyS: [1, 0], KeyA: [0, -1], KeyD: [0, 1] };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const k = e.code;
      let used = true;
      if (MOVES[k]) {
        if (!canPlay()) return void e.preventDefault();
        if (S.kbd) {
          S.cur.r += MOVES[k][0];
          S.cur.c += MOVES[k][1];
        }
        S.kbd = true;
        clampCursor();
      } else if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') {
        if (!canPlay()) { if (k === 'Space') e.preventDefault(); return; }   /* Enter after the round is the shell's */
        if (e.repeat) return void e.preventDefault();
        if (!S.kbd) { S.kbd = true; clampCursor(); }
        else place(S.sel, S.cur.r, S.cur.c, 'key');
      } else if (/^(Digit|Numpad)[123]$/.test(k)) {
        const i = Number(k.slice(-1)) - 1;
        if (st.tray[i] !== null && canPlay()) { S.sel = i; S.kbd = true; clampCursor(); }
      } else if (k === 'KeyZ' || k === 'KeyQ' || k === 'Comma') {
        if (canPlay()) { selectPrev(); S.kbd = true; }
      } else if (k === 'KeyX' || k === 'KeyE' || k === 'Period') {
        if (canPlay()) { selectNext(S.sel); S.kbd = true; }
      } else used = false;
      if (!used) return;
      e.preventDefault();
      snd.wake();
      kick();
    };
    function selectPrev() {
      for (let k = 1; k <= 3; k++) {
        const i = (S.sel - k + 3) % 3;
        if (st.tray[i] !== null) { S.sel = i; clampCursor(); return; }
      }
    }
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onCancel);
    if (R) {
      R.off = NET.on?.(onNet) || null;
      NET.peerScore?.(0);
      beat();
    }

    kick(0.3);

    return {
      stop() {
        S.dead = true;
        S.ended = true;
        loop.stop();
        try { R?.off?.(); } catch (err) { /* already off */ }
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onCancel);
        snd.close();
        sprites.clear();
        sf.destroy();
      },
      /* a read-only snapshot for automated play-tests (CSS px inside the canvas) */
      peek: () => {
        const L = layout();
        return {
          board: Array.from(st.board, v => (v ? 1 : 0)).join(''),
          tray: st.tray.map(id => (id === null ? null : SHAPES[id].id)),
          cells: st.tray.map(id => (id === null ? null : SHAPES[id].cells.map(c => c.slice()))),
          score: st.score, lines: st.lines, placed: st.placed, out: st.out, ended: S.ended,
          sel: S.sel, cur: { ...S.cur }, kbd: S.kbd, moves: st.moves,
          geo: { bx: L.bx, by: L.by, cell: L.cell, slots: L.slots.map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h })) },
          race: R ? { them: R.them.score, theirMoves: R.them.moves.length / 2, theirOut: R.them.out, left: timeLeft(), voided: R.voided, seed } : null,
        };
      },
    };
  },
};

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
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}
