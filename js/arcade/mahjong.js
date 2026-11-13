/* ============================================================
   arcade/mahjong.js — Mahjong Solitaire for Static Arcade.

   Clear the board by taking away matching pairs of free tiles. A tile
   is free when nothing lies on top of it and its left or its right side
   is open (rules in ./mahjong-rules.js). Equal faces match; any flower
   matches any flower and any season any season.

   · Three layouts: Turtle (the classic 144 tiles), Pyramid and Fortress.
     Every deal is solvable: it is dealt backwards from an empty board
     (see mahjong-rules.js), so there is always a way to clear it.
   · Click or tap a free tile, then its partner. A blocked tile shakes and
     says why. Keyboard: arrows move between free tiles, Enter / Space
     pick, H hint, U / Z / Backspace undo, S shuffle.
   · Hint lights a free pair (one on the way to clearing the deal when
     there is one). Undo takes back the last pair, as many times as you
     like. Shuffle remaining deals the tiles still there again, still
     solvable, and adds 30 seconds to your time; you are offered it when
     no pair is left.
   · The score is your time in seconds (lower is better). Each layout's
     best time is kept here (portal.arcadeMahjong) and the Arcade keeps
     the best overall. While paused the tiles are hidden.
   · Tiles are drawn on the canvas: three suits (Coins, Sticks, Leaves),
     winds, dragons, flowers and seasons, all made for StaticOS.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { surface, ownsKey, sounder, looper, rr } from './boardkit.js';
import * as M from './mahjong-rules.js';

const PREF = 'portal.arcadeMahjong';
const PENALTY = 30;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const ASPECT = 1.3;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  const best = {};
  for (const id of M.layoutIds) best[id] = Number.isFinite(p?.best?.[id]) && p.best[id] > 0 ? p.best[id] : null;
  return { layout: M.LAYOUTS[p?.layout] ? p.layout : 'turtle', best };
};
const writePrefs = p => { try { store.set(PREF, p); } catch (err) { /* a convenience */ } };
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const CSS = `
.arx-mj{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:10px 12px;box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#ddd);container-type:size;user-select:none;-webkit-user-select:none}
.arx-mj *{box-sizing:border-box}
.arx-mj__stage{position:relative;flex:1 1 auto;min-height:140px}
.arx-mj__bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 8px;flex:0 0 auto}
.arx-mj__chip,.arx-mj__btn{display:inline-flex;align-items:center;gap:6px;font:600 12px/1 var(--font,system-ui);color:var(--ink-1,#ddd);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.08));padding:8px 11px;border-radius:var(--r-md,11px);cursor:pointer;white-space:nowrap}
.arx-mj__chip[aria-pressed="true"]{background:var(--fill-3,rgba(255,255,255,.16));color:var(--ink-0,#fff);border-color:var(--ink-3,#888)}
.arx-mj__btn:disabled{opacity:.45;cursor:default}
.arx-mj__btn.is-go{background:rgba(255,200,80,.22);border-color:rgba(255,210,100,.7);color:#fff}
@media (hover:hover){.arx-mj__chip:hover,.arx-mj__btn:not(:disabled):hover{background:var(--fill-2,rgba(255,255,255,.1));color:var(--ink-0,#fff)}}
.arx-mj__chip:focus-visible,.arx-mj__btn:focus-visible{outline:2px solid #8ecbff;outline-offset:2px}
.arx-mj__info{font-size:12px;color:var(--ink-2,#aaa);font-variant-numeric:tabular-nums;text-align:center;min-height:16px}
.arx-mj__info b{color:var(--ink-0,#fff);font-weight:700}
.arx-mj__info.is-alert{color:#ffd48a}
.arx-mj__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

/* ------------------------------ tile art ------------------------------ */
const PIPS = {
  1: [[1, 1]], 2: [[1, 0], [1, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]], 7: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]],
  8: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]], 9: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
};
const INK = '#26323b';
function petals(g, x, y, r, n, col, rot = 0) {
  g.fillStyle = col;
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2;
    g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.42, r * 0.26, a, 0, Math.PI * 2); g.fill();
  }
}
function leaf(g, x, y, s, rot, col) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col;
  g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.85, -s * 0.2, 0, s); g.quadraticCurveTo(-s * 0.85, -s * 0.2, 0, -s); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1, s * 0.09);
  g.beginPath(); g.moveTo(0, -s * 0.8); g.lineTo(0, s * 0.8); g.stroke();
  g.restore();
}
/* draw a face inside the box (x, y, w, h) */
function face(g, f, x, y, w, hh) {
  const cx = x + w / 2, cy = y + hh / 2, m = Math.min(w, hh);
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (f < M.WINDS) {
    const suit = Math.floor(f / 9), n = (f % 9) + 1;
    const pips = PIPS[n], big = n <= 2 ? 1.5 : n === 3 ? 1.15 : 1;
    const r = m * 0.17 * big;
    const colors = [['#1b6f8a', '#d1495b'], ['#2b7a3d', '#c4572e'], ['#b8322d', '#2f6f9f']][suit];
    pips.forEach(([c, r2], i) => {
      const px = x + w * (0.2 + 0.3 * c), py = y + hh * (0.18 + 0.32 * r2);
      const col = colors[(i + (n > 4 ? 0 : 1)) % (n > 5 ? 2 : 1)];
      if (suit === 0) {
        g.fillStyle = col; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff6df'; g.beginPath(); g.arc(px, py, r * 0.62, 0, Math.PI * 2); g.fill();
        g.fillStyle = colors[1]; g.beginPath(); g.arc(px, py, r * 0.3, 0, Math.PI * 2); g.fill();
      } else if (suit === 1) {
        g.fillStyle = col; rr(g, px - r * 0.42, py - r * 1.05, r * 0.84, r * 2.1, r * 0.4); g.fill();
        g.fillStyle = '#fff6df'; g.fillRect(px - r * 0.42, py - r * 0.12, r * 0.84, r * 0.24);
      } else {
        leaf(g, px, py, r * 1.05, ((c - 1) * 0.35), col);
      }
    });
  } else if (f < M.DRAGONS) {
    const letter = 'NESW'[f - M.WINDS];
    g.fillStyle = INK;
    g.font = `800 ${Math.round(m * 0.78)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, cx, cy + m * 0.04);
    g.strokeStyle = '#c4572e'; g.lineWidth = Math.max(1.5, m * 0.05);
    const d = m * 0.07, ty = y + hh * 0.1, by = y + hh * 0.9;
    for (const yy of [ty, by]) { g.beginPath(); g.moveTo(cx - m * 0.18, yy); g.lineTo(cx, yy - d); g.lineTo(cx + m * 0.18, yy); g.stroke(); }
  } else if (f < M.FLOWERS) {
    const k = f - M.DRAGONS;
    if (k === 0) {
      g.fillStyle = '#c4302b';
      g.beginPath(); g.moveTo(cx, y + hh * 0.1); g.bezierCurveTo(cx + m * 0.5, y + hh * 0.4, cx + m * 0.42, y + hh * 0.88, cx, y + hh * 0.9);
      g.bezierCurveTo(cx - m * 0.42, y + hh * 0.88, cx - m * 0.5, y + hh * 0.45, cx - m * 0.12, y + hh * 0.34);
      g.bezierCurveTo(cx - m * 0.08, y + hh * 0.22, cx - m * 0.02, y + hh * 0.16, cx, y + hh * 0.1); g.fill();
      g.fillStyle = '#ffb347'; g.beginPath(); g.ellipse(cx, y + hh * 0.68, m * 0.18, m * 0.26, 0, 0, Math.PI * 2); g.fill();
    } else if (k === 1) {
      for (let i = 0; i < 3; i++) leaf(g, cx + (i - 1) * m * 0.3, cy + (i === 1 ? -m * 0.1 : m * 0.1), m * 0.34, (i - 1) * 0.5, '#2b8a4a');
    } else {
      g.strokeStyle = '#3b62a8'; g.lineWidth = m * 0.09;
      rr(g, x + w * 0.16, y + hh * 0.2, w * 0.68, hh * 0.6, m * 0.08); g.stroke();
      g.lineWidth = m * 0.04; rr(g, x + w * 0.3, y + hh * 0.34, w * 0.4, hh * 0.32, m * 0.04); g.stroke();
    }
  } else if (f < M.SEASONS) {
    const k = f - M.FLOWERS;
    const cols = ['#d94f7a', '#e08a1e', '#7a5bd0', '#2a9d8f'];
    petals(g, cx, cy - m * 0.04, m * 0.62, 5 + k, cols[k], k * 0.3);
    g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(cx, cy - m * 0.04, m * 0.12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2b7a3d'; g.lineWidth = m * 0.06; g.beginPath(); g.moveTo(cx, cy + m * 0.3); g.lineTo(cx, y + hh * 0.92); g.stroke();
  } else {
    const k = f - M.SEASONS;
    if (k === 0) {            /* spring: a sprout */
      g.strokeStyle = '#2b8a4a'; g.lineWidth = m * 0.08; g.beginPath(); g.moveTo(cx, y + hh * 0.88); g.lineTo(cx, cy); g.stroke();
      leaf(g, cx - m * 0.22, cy - m * 0.1, m * 0.3, -1.0, '#4fb36a'); leaf(g, cx + m * 0.22, cy - m * 0.2, m * 0.3, 1.0, '#4fb36a');
    } else if (k === 1) {     /* summer: a sun */
      g.strokeStyle = '#f0a020'; g.lineWidth = m * 0.07;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * m * 0.34, cy + Math.sin(a) * m * 0.34); g.lineTo(cx + Math.cos(a) * m * 0.5, cy + Math.sin(a) * m * 0.5); g.stroke(); }
      g.fillStyle = '#ffc233'; g.beginPath(); g.arc(cx, cy, m * 0.26, 0, Math.PI * 2); g.fill();
    } else if (k === 2) {     /* autumn: a turning leaf */
      leaf(g, cx, cy, m * 0.5, 0.6, '#d2691e'); leaf(g, cx + m * 0.05, cy + m * 0.02, m * 0.3, 0.6, '#f0a030');
    } else {                  /* winter: a snowflake */
      g.strokeStyle = '#4a86c5'; g.lineWidth = m * 0.07;
      for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(cx - Math.cos(a) * m * 0.46, cy - Math.sin(a) * m * 0.46); g.lineTo(cx + Math.cos(a) * m * 0.46, cy + Math.sin(a) * m * 0.46); g.stroke(); }
      g.fillStyle = '#4a86c5'; g.beginPath(); g.arc(cx, cy, m * 0.09, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const P = readPrefs();
    let dead = false;
    const S = {
      layout: P.layout, seed: 0, tiles: [], faces: [], order: [], gone: null, removedAt: [], undo: [], sel: -1, cursor: -1, hint: null, hintT: 0,
      shake: { i: -1, t: 0 }, refused: 0, moves: 0, shuffles: 0, banked: 0, since: 0, paused: false, over: false, ended: false, endT: 0,
      geo: { a: 0, ox: 0, oy: 0 }, sorted: [], fresh: 0,
    };

    /* ------------------------------ the page ------------------------------ */
    const stage = h('div.arx-mj__stage');
    const sr = h('div.arx-mj__sr', { 'aria-live': 'polite' });
    const info = h('div.arx-mj__info', { role: 'status' });
    const layBtns = M.layoutIds.map(id => h('button.arx-mj__chip', { type: 'button', title: M.LAYOUTS[id].blurb, dataset: { layout: id }, 'aria-pressed': String(id === S.layout),
      onclick: () => { setLayout(id); refocus(); } }, M.LAYOUTS[id].name));
    const hintBtn = h('button.arx-mj__btn', { type: 'button', title: 'Show a pair (H)', onclick: () => { hint(); refocus(); } }, 'Hint');
    const undoBtn = h('button.arx-mj__btn', { type: 'button', title: 'Take back the last pair (U)', onclick: () => { undo(); refocus(); } }, 'Undo');
    const shuffleBtn = h('button.arx-mj__btn', { type: 'button', title: `Deal the tiles left again — adds ${PENALTY} seconds (S)`, onclick: () => { shuffle(); refocus(); } }, 'Shuffle remaining');
    const newBtn = h('button.arx-mj__btn', { type: 'button', title: 'A new deal of this layout', onclick: () => { newDeal(); refocus(); } }, 'New deal');
    const root = h('div.arx-mj', h('style', { text: CSS }),
      h('div.arx-mj__bar', { role: 'group', 'aria-label': 'Layout' }, layBtns),
      stage, info,
      h('div.arx-mj__bar', hintBtn, undoBtn, shuffleBtn, newBtn), sr);
    el.appendChild(root);
    const sf = surface(stage, 'Mahjong Solitaire board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const say = t => { sr.textContent = t; };

    /* ------------------------------ state ------------------------------ */
    const elapsed = () => S.banked + (S.since && !S.paused && !S.over ? (performance.now() - S.since) / 1000 : 0);
    const left = () => S.tiles.length - S.removedAt.length * 2;
    const pairs = () => M.availablePairs(S.tiles, S.faces, S.gone);

    function deal(layout, seed) {
      const d = M.deal(layout, seed);
      clearTimeout(S.endT);
      S.layout = layout; S.seed = seed;
      S.tiles = d.tiles; S.faces = d.faces; S.order = d.order.map(p => p.slice());
      S.gone = new Uint8Array(d.tiles.length);
      Object.assign(S, { removedAt: [], undo: [], sel: -1, cursor: -1, hint: null, moves: 0, shuffles: 0, banked: 0, since: performance.now(), over: false, ended: false, refused: 0, fresh: 0 });
      S.sorted = d.tiles.map((_, i) => i).sort((a, b) => { const p = S.tiles[a], q = S.tiles[b]; return p.z - q.z || p.y - q.y || p.x - q.x; });
      S.cursor = M.freeList(S.tiles, S.gone)[0] ?? -1;
      ctx.onScore(0);
      paint();
    }
    const newDeal = () => deal(S.layout, randomSeed());
    function setLayout(id) {
      P.layout = id; writePrefs(P);
      layBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === id)));
      deal(id, randomSeed());
    }

    function remove(a, b) {
      S.gone[a] = S.gone[b] = 1;
      S.removedAt.push(performance.now());
      S.undo.push([a, b]);
      S.moves++;
      S.sel = -1; S.hint = null;
      S.fresh = performance.now();
      snd.blip(520, 0.07, 'triangle', 0.8); snd.blip(780, 0.09, 'triangle', 0.7);
      if (!left()) { S.banked = Math.round(elapsed() * 10) / 10; S.over = true; S.since = 0; say('Board cleared!'); S.endT = setTimeout(finish, reduced ? 350 : 1000); }
      else say(`Pair removed. ${left()} tiles left.`);
      if (S.cursor < 0 || S.gone[S.cursor]) S.cursor = M.freeList(S.tiles, S.gone)[0] ?? -1;
      loop.kick(0.5);
      paint();
    }

    function pick(i) {
      if (dead || S.over || S.paused || i < 0 || S.gone[i]) return;
      snd.wake();
      S.cursor = i;
      if (!M.isFree(S.tiles, i, S.gone)) {
        S.refused++;
        S.shake = { i, t: performance.now() };
        snd.blip(150, 0.09, 'sawtooth', 0.4);
        const t = S.tiles[i];
        const covered = S.tiles.some((o, j) => !S.gone[j] && o.z > t.z && Math.abs(o.x - t.x) < 2 && Math.abs(o.y - t.y) < 2);
        const msg = covered ? 'That tile has another on top of it.' : 'That tile is blocked on both sides.';
        info.textContent = msg; info.classList.add('is-alert');
        say(msg);
        loop.kick(0.3);
        return;
      }
      if (S.sel === i) { S.sel = -1; paint(); return; }
      if (S.sel >= 0 && M.matches(S.faces[S.sel], S.faces[i])) { remove(S.sel, i); return; }
      if (S.sel >= 0) { snd.blip(210, 0.07, 'square', 0.4); say('Those do not match.'); }
      S.sel = i;
      paint();
    }

    function undo() {
      if (dead || S.over || S.paused || !S.undo.length) return;
      const [a, b] = S.undo.pop();
      S.gone[a] = S.gone[b] = 0;
      S.removedAt.pop();
      S.sel = -1; S.hint = null; S.cursor = a;
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Pair put back.');
      loop.kick(0.2);
      paint();
    }

    function hint() {
      if (dead || S.over || S.paused) return;
      const av = pairs();
      if (!av.length) { say('No pairs left. Try Shuffle remaining.'); paint(); return; }
      const key = (a, b) => `${a}-${b}`;
      const avSet = new Set(av.map(([a, b]) => key(a, b)));
      /* prefer a pair of the solution the deal was made from, while it still applies */
      let best = null;
      for (const [a, b] of S.order) {
        if (S.gone[a] || S.gone[b]) continue;
        if (avSet.has(key(Math.min(a, b), Math.max(a, b)))) { best = [a, b]; break; }
      }
      S.hint = best || av[0];
      S.hintT = performance.now();
      S.sel = -1;
      say('Hint: the two lit tiles match.');
      loop.kick(2.6);
      paint();
    }

    function shuffle() {
      if (dead || S.over || S.paused || left() < 4) return;
      const r = M.reshuffle(S.tiles, S.faces, S.gone, randomSeed());
      if (!r) return;
      S.faces = r.faces;
      S.order = r.order;
      S.undo = [];
      S.sel = -1; S.hint = null;
      S.shuffles++;
      S.banked += PENALTY;
      snd.blip(260, 0.1, 'square', 0.5, 520);
      say(`Tiles shuffled. ${PENALTY} seconds added.`);
      S.fresh = performance.now();
      loop.kick(0.4);
      paint();
    }

    function finish() {
      if (dead || S.ended || !S.over) return;
      S.ended = true;
      const t = Math.max(1, Math.round(S.banked));
      const prev = P.best[S.layout];
      const nb = prev === null || t < prev;
      if (nb) { P.best[S.layout] = t; writePrefs(P); }
      ctx.onEnd({ score: t, won: true, detail: `${M.LAYOUTS[S.layout].name} cleared in ${fmt(t)}${S.shuffles ? ` with ${S.shuffles} shuffle${S.shuffles > 1 ? 's' : ''}` : ''}${nb ? ' — your best for this layout.' : `. Best here: ${fmt(prev)}.`}` });
    }

    function paint() {
      if (dead) return;
      const av = S.over ? [] : pairs();
      const stuck = !S.over && left() > 0 && !av.length;
      const best = P.best[S.layout];
      info.classList.toggle('is-alert', stuck);
      if (S.over) info.replaceChildren('Cleared in ', h('b', { text: fmt(S.banked) }));
      else if (stuck) info.textContent = 'No pairs left. Shuffle remaining (adds 30 s).';
      else info.replaceChildren(h('b', { text: String(left()) }), ' tiles · ', h('b', { text: String(av.length) }), ` pair${av.length === 1 ? '' : 's'} free · time `, h('b', { text: fmt(elapsed()) }), best ? ` · best here ${fmt(best)}` : '');
      shuffleBtn.classList.toggle('is-go', stuck);
      undoBtn.disabled = !S.undo.length || S.over;
      hintBtn.disabled = S.over || !av.length;
      shuffleBtn.disabled = S.over || left() < 4;
      sf.cv.setAttribute('aria-label', `Mahjong Solitaire, ${M.LAYOUTS[S.layout].name}. ${left()} tiles left, ${av.length} pairs free.`);
      ctx.onScore(Math.floor(elapsed()));
      draw();
    }
    const tick = setInterval(() => { if (!dead && !S.paused && !S.over) paint(); }, 1000);

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      let maxX = 0, maxY = 0, maxZ = 0;
      for (const t of S.tiles) { maxX = Math.max(maxX, t.x + 2); maxY = Math.max(maxY, t.y + 2); maxZ = Math.max(maxZ, t.z); }
      const lift = 0.2;
      const wUnits = maxX + maxZ * lift + 0.5, hUnits = (maxY) * ASPECT + maxZ * lift + 0.5;
      const a = Math.max(6, Math.min((sf.w - 16) / wUnits, (sf.h - 16) / hUnits));
      return { a, lift, ox: Math.round((sf.w - a * wUnits) / 2), oy: Math.round((sf.h - a * hUnits) / 2 + a * maxZ * lift) };
    }
    /* the screen box of tile i's face: { x, y, w, h } */
    const box = (i, L = S.geo) => {
      const t = S.tiles[i], a = L.a;
      return { x: L.ox + t.x * a + t.z * a * L.lift, y: L.oy + t.y * a * ASPECT - t.z * a * L.lift, w: 2 * a, h: 2 * a * ASPECT };
    };

    function drawTile(g, i, state, L) {
      const b = box(i, L), a = L.a, th = a * 0.2;
      const r = a * 0.3;
      /* the edge (teal back) and the shadow */
      g.fillStyle = 'rgba(0,0,0,.28)';
      rr(g, b.x - th + 2, b.y + th + 3, b.w, b.h, r); g.fill();
      g.fillStyle = '#1f7a68';
      rr(g, b.x - th, b.y + th, b.w, b.h, r); g.fill();
      g.strokeStyle = '#0f4a3e'; g.lineWidth = 1; g.stroke();
      /* the ivory face */
      const gr = g.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      gr.addColorStop(0, '#fffaf0'); gr.addColorStop(1, '#efe3c6');
      g.fillStyle = gr;
      rr(g, b.x, b.y, b.w, b.h, r); g.fill();
      g.strokeStyle = 'rgba(80,60,30,.45)'; g.lineWidth = 1; g.stroke();
      face(g, S.faces[i], b.x + b.w * 0.1, b.y + b.h * 0.08, b.w * 0.8, b.h * 0.84);
      if (state.dim) { g.fillStyle = 'rgba(20,30,40,.16)'; rr(g, b.x, b.y, b.w, b.h, r); g.fill(); }
      if (state.sel) { g.fillStyle = 'rgba(255,214,64,.38)'; rr(g, b.x, b.y, b.w, b.h, r); g.fill(); g.strokeStyle = '#ffcc1f'; g.lineWidth = 3; g.stroke(); }
      if (state.hint) {
        const k = reduced ? 1 : 0.55 + 0.45 * Math.sin(performance.now() / 150);
        g.fillStyle = `rgba(80,220,255,${0.3 * k + 0.1})`; rr(g, b.x, b.y, b.w, b.h, r); g.fill();
        g.strokeStyle = `rgba(80,230,255,${0.6 + 0.4 * k})`; g.lineWidth = 3; g.stroke();
      }
      if (state.cursor) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.setLineDash([5, 4]);
        rr(g, b.x - 2, b.y - 2, b.w + 4, b.h + 4, r + 2); g.stroke(); g.setLineDash([]);
      }
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const now = performance.now();
      const L = S.geo = layout();
      const bg = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.7);
      bg.addColorStop(0, '#163b36'); bg.addColorStop(1, '#08130f');
      g.fillStyle = bg; g.fillRect(0, 0, sf.w, sf.h);
      if (S.paused) {
        g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'center'; g.font = `700 ${Math.round(Math.min(40, sf.w / 10))}px ${FONT}`;
        g.fillText('Paused', sf.w / 2, sf.h / 2);
        return;
      }
      const freeSet = new Set(M.freeList(S.tiles, S.gone));
      for (const i of S.sorted) {
        if (S.gone[i]) continue;
        const sh = S.shake.i === i && now - S.shake.t < 260 ? Math.sin((now - S.shake.t) / 22) * L.a * 0.18 * (1 - (now - S.shake.t) / 260) : 0;
        if (sh) { g.save(); g.translate(sh, 0); }
        drawTile(g, i, { dim: !freeSet.has(i), sel: S.sel === i, hint: !!S.hint && now - S.hintT < 2600 && (S.hint[0] === i || S.hint[1] === i), cursor: S.cursor === i }, L);
        if (sh) g.restore();
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function tileAt(x, y) {
      for (let k = S.sorted.length - 1; k >= 0; k--) {
        const i = S.sorted[k];
        if (S.gone[i]) continue;
        const b = box(i);
        if (x >= b.x - b.w * 0.1 && x <= b.x + b.w && y >= b.y && y <= b.y + b.h * 1.08) return i;
      }
      return -1;
    }
    const onDown = e => {
      if (e.button > 0 || dead) return;
      const p = at(e);
      pick(tileAt(p.x, p.y));
    };
    function nav(dx, dy) {
      const fr = M.freeList(S.tiles, S.gone);
      if (!fr.length) return;
      if (S.cursor < 0 || S.gone[S.cursor]) { S.cursor = fr[0]; return; }
      const c = box(S.cursor);
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      let best = -1, bs = Infinity;
      for (const i of fr) {
        if (i === S.cursor) continue;
        const b = box(i);
        const vx = b.x + b.w / 2 - cx, vy = b.y + b.h / 2 - cy;
        const along = vx * dx + vy * dy, perp = Math.abs(vx * dy - vy * dx);
        if (along < c.w * 0.3) continue;
        const sc = along + perp * 2;
        if (sc < bs) { bs = sc; best = i; }
      }
      if (best >= 0) S.cursor = best;
    }
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.paused) return;
      const k = e.key;
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[k]) { e.preventDefault(); snd.wake(); nav(...arrows[k]); draw(); }
      else if (k === 'Enter' || k === ' ') { if (S.over) return; e.preventDefault(); pick(S.cursor); }
      else if (k === 'h' || k === 'H') { e.preventDefault(); hint(); }
      else if (k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
      else if (k === 's' || k === 'S') { e.preventDefault(); shuffle(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);

    deal(S.layout, randomSeed());

    return {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        clearInterval(tick);
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        snd.close();
        sf.destroy();
        root.remove();
      },
      pause() { if (S.paused) return; S.banked = elapsed(); S.since = 0; S.paused = true; paint(); },
      resume() { if (!S.paused) return; S.paused = false; S.since = performance.now(); paint(); },
      /* a read-only snapshot for automated play-tests: every tile with its face, freedom and screen centre */
      peek: () => {
        const L = S.geo;
        const fr = new Set(M.freeList(S.tiles, S.gone));
        const stageBox = stage.getBoundingClientRect();
        return {
          layout: S.layout, seed: S.seed, total: S.tiles.length, remaining: left(), paused: S.paused, over: S.over, ended: S.ended,
          time: Math.round(elapsed() * 10) / 10, banked: S.banked, moves: S.moves, shuffles: S.shuffles, refused: S.refused, sel: S.sel, hint: S.hint, cursor: S.cursor,
          pairs: S.over ? 0 : pairs().length, undoable: S.undo.length, order: S.order.map(p => p.slice()), best: { ...P.best },
          tiles: S.tiles.map((t, i) => { const b = box(i, L); return { i, x: t.x, y: t.y, z: t.z, face: S.faces[i], gone: !!S.gone[i], free: !S.gone[i] && fr.has(i), cx: b.x + b.w / 2, cy: b.y + b.h / 2 }; }),
          stage: { x: stageBox.x, y: stageBox.y },
        };
      },
      /* test hook — nothing in the game calls it: deal({ layout, seed }) · time(seconds) */
      hook(cmd, arg) {
        if (cmd === 'deal' && M.LAYOUTS[arg?.layout]) { deal(arg.layout, arg.seed >>> 0); return true; }
        if (cmd === 'time') { S.banked = Number(arg) || 0; S.since = performance.now(); paint(); return true; }
        return false;
      },
    };
  },
};
