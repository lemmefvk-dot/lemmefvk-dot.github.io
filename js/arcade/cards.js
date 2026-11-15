/* ============================================================
   arcade/cards.js — Solitaire, Spider and FreeCell for Static Arcade.

   The rules are in ./cardrules.js; this is the table: a canvas
   (DPR-aware, so Static Replay can record it) under a small bar for
   the variant (Draw 1 / Draw 3, 1 / 2 / 4 suits, FreeCell's deal
   number), the clock, the move count, Undo, New deal and Stats.

   Every card is drawn here with canvas paths — pips, corner indices,
   plain geometric court cards and a patterned back. No card art is
   copied from anywhere.

   Play
   · drag a card (and the cards on it) to a pile; an illegal drop
     slides back where it came from;
   · click a card to send it to a legal place — a foundation first,
     then a column, then an empty column, then a free cell; so a
     double-click sends a card home, and its second click (the
     browser's click count says which it is) is not read as a click
     on the card the first one uncovered;
   · click the stock to turn cards over (Klondike) or deal a row
     (Spider — every column needs a card first);
   · keyboard: arrows choose a pile (↑ ↓ change rows), Enter or Space
     picks the pile's cards up and puts them down on the chosen pile
     (as many as fit there), Esc puts them back, U or Z undoes, F
     sends the chosen pile's card to a foundation. A controller does
     the same through the Arcade's key bridge (D-pad, A, X).
   · Undo has no limit. When the rest of a game needs no choices
     (every card face up and each can go home in turn) it finishes
     by itself.

   The clock starts with the first move and stops while paused or
   while the stats are open. A win plays the bouncing-cards finale
   (a short glow with reduced motion; any key or click skips it) and
   then reports { score: seconds (to 0.1 s), won: true } to the Arcade.

   Stats are this device's only, per variant, in store
   'portal.arcadeCards' { draw, suits, stats: { [variant]: { played,
   won, best, pts } } }: a deal counts as played from its first move,
   won when the last card goes home, best is the fastest win in ms,
   pts Solitaire's best points (cardrules.js scoring, points only).

   Also in that store:
   · daily: { [kind]: { last, streak, best, days: { [day]: ms } } } —
     Today's deal (Solitaire and FreeCell): the same deal for everyone
     on the same date (the shuffle, or FreeCell's deal number, comes
     from the date), and the streak of days won in a row, kept on this
     device only;
   · won: [deal numbers] — the FreeCell deals won here, newest first,
     each one a click away in Stats;
   · undo: 'any' | '5' | 'off' — Spider's undo allowance per deal;
   · saved: { [kind]: … } — the deal in progress, so closing the
     window (or switching games) keeps it; it comes back as it was,
     with its clock, moves and the last 60 undo steps;
   · look — the Table look shared by all five card games (./cardlook.js:
     back, colour, felt, larger cards, left-handed).
   Show moves (M) points at the moves worth making, one per press; a
   game won with it never sets a best.

   Tests: peek() is a read-only snapshot (pile contents and where
   every card is on the canvas). setNextDeal(kind, layout) lays out
   the next deal of that game by hand, once (cardrules.fromLayout;
   layout.daily: true counts it as today's deal); nothing in StaticOS
   calls it, so in normal use it does nothing.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import * as R from './cardrules.js';
import { readLook, backHue, feltColors, lookCard } from './cardlook.js';
import { dayKey, addDays } from './stars.js';

const PREF = 'portal.arcadeCards';
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const ASPECT = 1.4;
const GAP = 0.16;

const GAMES = {
  klondike: { title: 'Solitaire', hue: 150, cols: 7 },
  spider: { title: 'Spider', hue: 265, cols: 10 },
  freecell: { title: 'FreeCell', hue: 205, cols: 8 },
};
export const VARIANTS = [
  { key: 'klondike-d1', kind: 'klondike', opt: { draw: 1 }, label: 'Solitaire · Draw 1' },
  { key: 'klondike-d3', kind: 'klondike', opt: { draw: 3 }, label: 'Solitaire · Draw 3' },
  { key: 'spider-s1', kind: 'spider', opt: { suits: 1 }, label: 'Spider · 1 suit' },
  { key: 'spider-s2', kind: 'spider', opt: { suits: 2 }, label: 'Spider · 2 suits' },
  { key: 'spider-s4', kind: 'spider', opt: { suits: 4 }, label: 'Spider · 4 suits' },
  { key: 'freecell', kind: 'freecell', opt: {}, label: 'FreeCell' },
];
export const variantKey = st => (st.kind === 'klondike' ? `klondike-d${st.draw}` : st.kind === 'spider' ? `spider-s${st.suits}` : 'freecell');

const readPref = () => { const v = store.get(PREF); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const writePref = patch => store.set(PREF, { ...readPref(), ...patch });
export function readStats() {
  const raw = readPref().stats;
  const out = {};
  for (const v of VARIANTS) {
    const s = raw && typeof raw === 'object' ? raw[v.key] : null;
    const n = x => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    out[v.key] = { played: n(s?.played), won: Math.min(n(s?.won), n(s?.played)), best: Number.isFinite(s?.best) && s.best > 0 ? s.best : null };
  }
  return out;
}
function bumpStats(key, fn) {
  const all = readStats();
  all[key] = fn({ ...all[key] });
  writePref({ stats: all });
}
/* best points per Solitaire variant (only Klondike scores points) */
const bestPts = key => { const v = readPref().stats?.[key]?.pts; return Number.isFinite(v) && v >= 0 ? v : null; };

/* ---- Today's deal: one per date, the same for everyone ---- */
const fnv = str => { let x = 0x811c9dc5; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x >>> 0; };
export const dailySeed = (kind, day) => fnv(`staticos-${kind}-${day}`);
/* FreeCell's daily deal is a Microsoft deal number from 1 to 32,000 — but
   never #11982, the one deal of those that can't be won */
export function dailyDeal(day) { const n = 1 + (dailySeed('freecell', day) % 32000); return n === 11982 ? 11983 : n; }
export function readDaily(kind) {
  const d = readPref().daily?.[kind];
  const days = d && typeof d.days === 'object' && d.days ? d.days : {};
  return { last: typeof d?.last === 'string' ? d.last : null, streak: Math.max(0, d?.streak | 0), best: Math.max(0, d?.best | 0), days };
}
/** the streak as it stands today: still alive if the last win was today or yesterday */
export function streakNow(kind, today = dayKey()) {
  const d = readDaily(kind);
  return d.last === today || d.last === addDays(today, -1) ? d.streak : 0;
}
function winDaily(kind, day, ms) {
  const d = readDaily(kind);
  if (d.days[day]) return d;                       /* already won that day: once is the streak */
  const streak = d.last === addDays(day, -1) ? d.streak + 1 : d.last === day ? d.streak : 1;
  const days = { ...d.days, [day]: ms };
  for (const k of Object.keys(days).sort().slice(0, -60)) delete days[k];
  const next = { last: day, streak, best: Math.max(d.best, streak), days };
  writePref({ daily: { ...(readPref().daily || {}), [kind]: next } });
  return next;
}
/* ---- FreeCell deals won here ---- */
export const wonDeals = () => (Array.isArray(readPref().won) ? readPref().won.filter(n => Number.isInteger(n) && n >= 1 && n <= R.FREECELL_MAX) : []);
const addWon = n => writePref({ won: [n, ...wonDeals().filter(x => x !== n)].slice(0, 400) });
/* ---- Spider's undo allowance ---- */
const UNDO = { any: Infinity, 5: 5, off: 0 };
const undoPref = () => (['any', '5', 'off'].includes(readPref().undo) ? readPref().undo : 'any');
/* ---- the deal in progress, per game ---- */
const savedOf = kind => { const v = readPref().saved?.[kind]; return v && typeof v === 'object' && v.snap ? v : null; };
const putSaved = (kind, v) => { const all = { ...(readPref().saved || {}) }; if (v) all[kind] = v; else delete all[kind]; writePref({ saved: all }); };

/* the test hook: a hand-made layout for the next deal of one game */
const NEXT = {};
let mounts = 0;
export function setNextDeal(kind, layout) { if (GAMES[kind]) NEXT[kind] = layout || null; }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = k => 1 - (1 - k) ** 3;
const hsl = (hh, s, l, a = 1) => `hsla(${hh},${s}%,${l}%,${a})`;
const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** a finished game's time: tenths under a minute, m:ss after */
export const timeText = ms => (ms < 60000 ? `${(Math.floor(ms / 100) / 10).toFixed(1)} s` : clock(ms));
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const CSS = `
.arx-cd{position:relative;width:100%;height:100%;display:flex;flex-direction:column;font-family:var(--font,system-ui);color:var(--ink-1,#eee);
  background:#05060a;user-select:none;-webkit-user-select:none;container-type:inline-size}
.arx-cd *{box-sizing:border-box}
.arx-cd:focus{outline:none}
.arx-cd__bar{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2,6px);padding:var(--sp-2,6px) var(--sp-3,8px);
  background:rgba(255,255,255,.035);border-bottom:1px solid var(--line-1,rgba(255,255,255,.08))}
.arx-cd__seg{display:inline-flex;padding:3px;border-radius:var(--r-md,11px);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-0,rgba(255,255,255,.05))}
.arx-cd__seg button{font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-2,#aaa);background:none;border:0;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.arx-cd__seg button[aria-pressed="true"]{background:var(--fill-3,rgba(255,255,255,.15));color:var(--ink-0,#fff);box-shadow:var(--sh-1)}
.arx-cd__deal{display:inline-flex;align-items:center;gap:6px;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-2,#aaa)}
.arx-cd__deal input{width:9ch;height:30px;padding:0 8px;border-radius:var(--r-sm,8px);border:1px solid var(--line-2,rgba(255,255,255,.12));background:var(--fill-1,rgba(255,255,255,.06));
  color:var(--ink-0,#fff);font:600 var(--fs-13,13px)/1 var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums}
.arx-cd__grow{flex:1 1 auto}
.arx-cd__read{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));
  border:1px solid var(--line-0,rgba(255,255,255,.05));font:700 var(--fs-13,13px)/1 var(--font,system-ui);color:var(--ink-0,#fff);font-variant-numeric:tabular-nums;white-space:nowrap}
.arx-cd__read small{font-weight:600;color:var(--ink-3,#888)}
.arx-cd__read .icon{width:14px;height:14px;color:var(--ink-3,#888)}
.arx-cd__btn{display:inline-flex;align-items:center;gap:6px;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1,#ddd);background:var(--fill-1,rgba(255,255,255,.06));
  border:1px solid var(--line-1,rgba(255,255,255,.08));padding:7px 10px;border-radius:var(--r-md,11px);cursor:pointer;white-space:nowrap}
.arx-cd__btn .icon{width:14px;height:14px}
.arx-cd__btn[disabled]{opacity:.45;cursor:default}
@media (hover:hover){.arx-cd__btn:not([disabled]):hover,.arx-cd__seg button:hover{background:var(--fill-2,rgba(255,255,255,.1));color:var(--ink-0,#fff)}}
.arx-cd__seg button:focus-visible,.arx-cd__btn:focus-visible,.arx-cd__deal input:focus-visible{outline:2px solid var(--accent,#ff456d);outline-offset:2px}
.arx-cd__table{position:relative;flex:1 1 auto;min-height:0}
.arx-cd__foot{flex:0 0 auto;min-height:28px;display:flex;align-items:center;justify-content:center;padding:4px var(--sp-3,8px);text-align:center;
  font-size:var(--fs-11,11px);color:var(--ink-3,#888);border-top:1px solid var(--line-0,rgba(255,255,255,.05))}
.arx-cd__foot.is-msg{color:var(--ink-0,#fff)}
.arx-cd__foot kbd{font:600 calc(10px * var(--fs-k,1))/1 var(--mono,ui-monospace,monospace);padding:2px 5px;border-radius:4px;border:1px solid var(--line-2,rgba(255,255,255,.14));
  border-bottom-width:2px;background:var(--fill-1,rgba(255,255,255,.05));color:var(--ink-1,#ddd)}
.arx-cd__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.arx-cd__stats{position:absolute;inset:0;z-index:4;display:grid;place-items:center;padding:var(--sp-5,16px);background:rgba(4,4,8,.72);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.arx-cd__card{width:min(560px,100%);max-height:100%;overflow:auto;padding:var(--sp-5,16px) var(--sp-6,20px);border-radius:var(--r-lg,15px);background:var(--glass-3,rgba(29,11,17,.88));
  border:1px solid var(--line-2,rgba(255,255,255,.12));box-shadow:var(--sh-3)}
.arx-cd__card h3{margin:0 0 4px;font-size:var(--fs-15,15px);color:var(--ink-0,#fff)}
.arx-cd__card p{margin:0 0 var(--sp-4,12px);font-size:var(--fs-12,12px);line-height:1.5;color:var(--ink-2,#aaa)}
.arx-cd__card table{width:100%;border-collapse:collapse;font-size:var(--fs-12,12px);font-variant-numeric:tabular-nums}
.arx-cd__card th{text-align:right;font-weight:600;color:var(--ink-3,#888);padding:6px 8px;border-bottom:1px solid var(--line-1,rgba(255,255,255,.08))}
.arx-cd__card td{text-align:right;padding:7px 8px;color:var(--ink-0,#fff);border-bottom:1px solid var(--line-0,rgba(255,255,255,.05))}
.arx-cd__card th:first-child,.arx-cd__card td:first-child{text-align:left}
.arx-cd__card td:first-child{color:var(--ink-1,#ddd)}
.arx-cd__card tr.is-now td:first-child{color:var(--ink-0,#fff);font-weight:700}
.arx-cd__acts{display:flex;justify-content:flex-end;margin-top:var(--sp-4,12px)}
.arx-cd__look{position:absolute;inset:0;z-index:4;display:grid;place-items:center;padding:var(--sp-5,16px);background:rgba(4,4,8,.72);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.arx-cd__look[hidden],.arx-cd__day[hidden]{display:none}
.arx-cd__card h4{margin:var(--sp-4,12px) 0 6px;font-size:var(--fs-12,12px);color:var(--ink-1,#ddd)}
.arx-cd__card .arx-cd__more{margin:0 0 4px}
.arx-cd__won{display:flex;flex-wrap:wrap;gap:5px;max-height:120px;overflow:auto}
.arx-cd__won .arx-cd__btn{padding:5px 8px;font-variant-numeric:tabular-nums}
@container (max-width:560px){.arx-cd__lbl{display:none}.arx-cd__seg button{padding:7px 8px}.arx-cd__btn{padding:7px 8px}.arx-cd__hint{display:none}}
`;

/* ---------------- suit shapes (unit size, centred) ---------------- */
function suitPath(g, s, x, y, size) {
  const k = size;
  const P = (px, py) => [x + px * k, y + py * k];
  g.beginPath();
  if (s === 2) {                                   /* heart */
    g.moveTo(...P(0, 0.42));
    g.bezierCurveTo(...P(-0.16, 0.27), ...P(-0.5, 0.06), ...P(-0.5, -0.16));
    g.bezierCurveTo(...P(-0.5, -0.36), ...P(-0.36, -0.47), ...P(-0.24, -0.47));
    g.bezierCurveTo(...P(-0.1, -0.47), ...P(-0.02, -0.38), ...P(0, -0.29));
    g.bezierCurveTo(...P(0.02, -0.38), ...P(0.1, -0.47), ...P(0.24, -0.47));
    g.bezierCurveTo(...P(0.36, -0.47), ...P(0.5, -0.36), ...P(0.5, -0.16));
    g.bezierCurveTo(...P(0.5, 0.06), ...P(0.16, 0.27), ...P(0, 0.42));
  } else if (s === 1) {                            /* diamond */
    g.moveTo(...P(0, -0.5));
    g.quadraticCurveTo(...P(0.12, -0.2), ...P(0.38, 0));
    g.quadraticCurveTo(...P(0.12, 0.2), ...P(0, 0.5));
    g.quadraticCurveTo(...P(-0.12, 0.2), ...P(-0.38, 0));
    g.quadraticCurveTo(...P(-0.12, -0.2), ...P(0, -0.5));
  } else if (s === 3) {                            /* spade */
    g.moveTo(...P(0, -0.5));
    g.bezierCurveTo(...P(-0.16, -0.32), ...P(-0.5, -0.12), ...P(-0.5, 0.1));
    g.bezierCurveTo(...P(-0.5, 0.28), ...P(-0.36, 0.38), ...P(-0.24, 0.38));
    g.bezierCurveTo(...P(-0.14, 0.38), ...P(-0.06, 0.33), ...P(-0.03, 0.26));
    g.quadraticCurveTo(...P(-0.06, 0.42), ...P(-0.16, 0.5));
    g.lineTo(...P(0.16, 0.5));
    g.quadraticCurveTo(...P(0.06, 0.42), ...P(0.03, 0.26));
    g.bezierCurveTo(...P(0.06, 0.33), ...P(0.14, 0.38), ...P(0.24, 0.38));
    g.bezierCurveTo(...P(0.36, 0.38), ...P(0.5, 0.28), ...P(0.5, 0.1));
    g.bezierCurveTo(...P(0.5, -0.12), ...P(0.16, -0.32), ...P(0, -0.5));
  } else {                                         /* club */
    const c = (cx, cy, r) => { g.moveTo(...P(cx + r, cy)); g.arc(x + cx * k, y + cy * k, r * k, 0, Math.PI * 2); };
    c(0, -0.24, 0.22);
    c(-0.25, 0.08, 0.22);
    c(0.25, 0.08, 0.22);
    g.moveTo(...P(-0.04, 0.05));
    g.quadraticCurveTo(...P(-0.05, 0.4), ...P(-0.17, 0.5));
    g.lineTo(...P(0.17, 0.5));
    g.quadraticCurveTo(...P(0.05, 0.4), ...P(0.04, 0.05));
    g.closePath();
  }
  g.closePath();
}
function pip(g, s, x, y, size, ink, flip = false) {
  g.save();
  if (flip) { g.translate(x, y); g.rotate(Math.PI); g.translate(-x, -y); }
  g.fillStyle = ink;
  suitPath(g, s, x, y, size);
  g.fill('nonzero');
  g.restore();
}
function rr(g, x, y, w, hh, r) {
  const q = Math.max(0, Math.min(r, w / 2, hh / 2));
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + hh, q);
  g.arcTo(x + w, y + hh, x, y + hh, q);
  g.arcTo(x, y + hh, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

/* pip spots for 2–10, in the card's middle box (0–1) */
const L3 = 0.28, M3 = 0.5, R3 = 0.72;
const PIPS = {
  2: [[M3, 0], [M3, 1]],
  3: [[M3, 0], [M3, 0.5], [M3, 1]],
  4: [[L3, 0], [R3, 0], [L3, 1], [R3, 1]],
  5: [[L3, 0], [R3, 0], [M3, 0.5], [L3, 1], [R3, 1]],
  6: [[L3, 0], [R3, 0], [L3, 0.5], [R3, 0.5], [L3, 1], [R3, 1]],
  7: [[L3, 0], [R3, 0], [M3, 0.25], [L3, 0.5], [R3, 0.5], [L3, 1], [R3, 1]],
  8: [[L3, 0], [R3, 0], [M3, 0.25], [L3, 0.5], [R3, 0.5], [M3, 0.75], [L3, 1], [R3, 1]],
  9: [[L3, 0], [R3, 0], [L3, 1 / 3], [R3, 1 / 3], [M3, 0.5], [L3, 2 / 3], [R3, 2 / 3], [L3, 1], [R3, 1]],
  10: [[L3, 0], [R3, 0], [M3, 1 / 6], [L3, 1 / 3], [R3, 1 / 3], [L3, 2 / 3], [R3, 2 / 3], [M3, 5 / 6], [L3, 1], [R3, 1]],
};

/** One card face, w × h CSS px, onto g (already scaled for the DPR).
    big: the larger corner letters of the "Larger cards" look. */
function drawFace(g, w, hh, r, s, big = false) {
  const ink = R.isRed(s) ? '#c8102e' : '#15151c';
  rr(g, 0.5, 0.5, w - 1, hh - 1, w * 0.075);
  g.fillStyle = '#fbfaf6';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.32)';
  g.lineWidth = 1;
  g.stroke();
  const small = w < 54 || big;
  const label = R.RANKS[r - 1];
  /* the top strip carries rank and suit, so a fanned column still reads */
  const fs = w * (small ? (big ? 0.36 : 0.4) : 0.25);
  g.fillStyle = ink;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.font = `800 ${fs}px ${FONT}`;
  const lx = w * 0.07, ly = hh * 0.035;
  if (label === '10') {
    g.save();
    g.translate(lx, ly);
    g.scale(0.78, 1);
    g.fillText(label, -fs * 0.04, 0);
    g.restore();
  } else g.fillText(label, lx, ly);
  const ps = w * (small ? 0.34 : 0.2);
  pip(g, s, w - w * 0.07 - ps * 0.5, ly + ps * 0.55, ps, ink);
  if (!small) {
    g.save();
    g.translate(w, hh);
    g.rotate(Math.PI);
    g.textAlign = 'left';
    if (label === '10') { g.translate(lx, ly); g.scale(0.78, 1); g.fillText(label, -fs * 0.04, 0); }
    else g.fillText(label, lx, ly);
    g.restore();
  }
  /* the middle */
  if (small || r === 1) {
    pip(g, s, w / 2, hh * (small ? 0.62 : 0.54), w * (small ? 0.46 : 0.42), ink);
    if (!small && r === 1) {
      g.strokeStyle = R.isRed(s) ? 'rgba(200,16,46,.35)' : 'rgba(21,21,28,.3)';
      g.lineWidth = Math.max(1, w * 0.012);
      g.beginPath();
      g.arc(w / 2, hh * 0.54, w * 0.32, 0, Math.PI * 2);
      g.stroke();
    }
    return;
  }
  if (r <= 10) {
    const x0 = w * 0.14, x1 = w * 0.86, y0 = hh * 0.25, y1 = hh * 0.82;
    for (const [px, py] of PIPS[r]) pip(g, s, x0 + (x1 - x0) * px, y0 + (y1 - y0) * py, w * 0.19, ink, py > 0.5);
    return;
  }
  /* court cards: a framed panel, a crown / tiara / plume, the letter, a pip */
  const fx = w * 0.17, fy = hh * 0.22, fw = w * 0.66, fh = hh * 0.66;
  rr(g, fx, fy, fw, fh, w * 0.05);
  g.fillStyle = R.isRed(s) ? 'rgba(200,16,46,.08)' : 'rgba(21,21,28,.07)';
  g.fill();
  g.strokeStyle = R.isRed(s) ? 'rgba(200,16,46,.55)' : 'rgba(21,21,28,.5)';
  g.lineWidth = Math.max(1, w * 0.014);
  g.stroke();
  const cx = w / 2, gold = '#d39b18';
  g.fillStyle = gold;
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1, w * 0.012);
  const ey = fy + fh * 0.2, ew = fw * 0.5, eh = fh * 0.15;
  g.beginPath();
  if (r === 13) {
    g.moveTo(cx - ew / 2, ey + eh);
    g.lineTo(cx - ew / 2, ey);
    g.lineTo(cx - ew / 4, ey + eh * 0.55);
    g.lineTo(cx, ey - eh * 0.15);
    g.lineTo(cx + ew / 4, ey + eh * 0.55);
    g.lineTo(cx + ew / 2, ey);
    g.lineTo(cx + ew / 2, ey + eh);
    g.closePath();
  } else if (r === 12) {
    g.moveTo(cx - ew / 2, ey + eh);
    g.quadraticCurveTo(cx, ey - eh * 0.9, cx + ew / 2, ey + eh);
    g.closePath();
  } else {
    g.ellipse(cx, ey + eh * 0.4, ew * 0.18, eh * 0.75, -0.5, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  if (r === 12) for (const dx of [-0.28, 0, 0.28]) { g.beginPath(); g.arc(cx + dx * ew, ey + eh * (dx ? 0.35 : 0.05), w * 0.022, 0, Math.PI * 2); g.fillStyle = ink; g.fill(); }
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${hh * 0.27}px ${FONT}`;
  g.fillText(label, cx, fy + fh * 0.56);
  pip(g, s, cx, fy + fh * 0.84, w * 0.15, ink);
}

/** The back of every card: a colour (the game's own unless the Table look
    picks another; hue -1 is black), a pattern, a quiet border.
    pattern: lattice (the original) | stripes | dots | plain (./cardlook.js) */
function drawBack(g, w, hh, hue, pattern = 'lattice') {
  const black = hue < 0;
  const tone = (s, l, a = 1) => (black ? hsl(230, 8, l * 0.5, a) : hsl(hue, s, l, a));
  rr(g, 0.5, 0.5, w - 1, hh - 1, w * 0.075);
  const grd = g.createLinearGradient(0, 0, w, hh);
  grd.addColorStop(0, tone(62, 34));
  grd.addColorStop(1, tone(70, 20));
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.4)';
  g.lineWidth = 1;
  g.stroke();
  const m = w * 0.09;
  const line = (a) => (black ? `rgba(220,220,235,${a})` : hsl(hue, 90, 78, a));
  g.save();
  rr(g, m, m, w - m * 2, hh - m * 2, w * 0.04);
  g.clip();
  g.strokeStyle = line(0.22);
  g.fillStyle = line(0.2);
  g.lineWidth = Math.max(1, w * 0.012);
  const step = w * 0.16;
  if (pattern === 'stripes') {
    g.lineWidth = Math.max(1, w * 0.035);
    g.beginPath();
    for (let d = -hh; d < w + hh; d += step * 0.9) { g.moveTo(d, 0); g.lineTo(d + hh, hh); }
    g.stroke();
  } else if (pattern === 'dots') {
    const r0 = Math.max(0.8, w * 0.028);
    for (let y = m + step / 2, row = 0; y < hh - m; y += step * 0.8, row++) {
      for (let x = m + (row % 2 ? step : step / 2); x < w - m; x += step) { g.beginPath(); g.arc(x, y, r0, 0, Math.PI * 2); g.fill(); }
    }
  } else if (pattern !== 'plain') {
    g.beginPath();
    for (let d = -hh; d < w + hh; d += step) { g.moveTo(d, 0); g.lineTo(d + hh, hh); g.moveTo(d + hh, 0); g.lineTo(d, hh); }
    g.stroke();
  }
  g.restore();
  rr(g, m, m, w - m * 2, hh - m * 2, w * 0.04);
  g.strokeStyle = black ? 'rgba(220,220,235,.5)' : hsl(hue, 90, 85, 0.55);
  g.lineWidth = Math.max(1, w * 0.016);
  g.stroke();
  g.fillStyle = black ? 'rgba(230,230,240,.75)' : hsl(hue, 95, 82, 0.8);
  suitPath(g, 1, w / 2, hh / 2, w * 0.26);
  g.fill();
}

/* ==================================================================== */
function mountTable(el, ctx, kind) {
  const G = GAMES[kind];
  const mountId = ++mounts;
  const reduced = !!ctx.reduced;
  const snd = sounder(ctx);
  const now = () => performance.now();
  const pref = readPref();
  let st = null;
  let look = readLook();
  const S = {
    hist: [], started: false, counted: false, startAt: 0, banked: 0, paused: false, statsOpen: false,
    daily: null, shown: 0, showAt: 0, show: null, undos: 0, lookOpen: false,
    won: false, ended: false, dead: false, auto: null, autoTimer: 0, celebrate: null,
    press: null, drag: null, tap: null, dragged: false,
    kbd: false, cur: { row: 1, i: 0 }, held: null,
    anim: new Map(), shakeAt: -1, shakeIds: null, lastSec: -1, msgTimer: 0,
  };

  /* ---------------- chrome ---------------- */
  const live = h('div.arx-cd__sr', { 'aria-live': 'polite' });
  const timeEl = h('b', { text: '0:00' });
  const movesEl = h('b', { text: '0' });
  const segBtns = [];
  const seg = (label, list, cur, pick) => h('div.arx-cd__seg', { role: 'group', 'aria-label': label },
    list.map(([v, text, tip]) => {
      const b = h('button', { type: 'button', dataset: { v: String(v) }, 'aria-pressed': String(v === cur), title: tip, onclick: () => pick(v) }, text);
      segBtns.push(b);
      return b;
    }));
  let variantEl, dealInput = null;
  if (kind === 'klondike') {
    variantEl = seg('Cards turned over at a time', [[1, 'Draw 1', 'Turn over one card at a time'], [3, 'Draw 3', 'Turn over three cards at a time']],
      pref.draw === 3 ? 3 : 1, v => { writePref({ draw: v }); deal({ draw: v }); });
  } else if (kind === 'spider') {
    const cur = [1, 2, 4].includes(pref.suits) ? pref.suits : 1;
    variantEl = seg('Suits', [[1, '1 suit', 'Spades only — the gentlest'], [2, '2 suits', 'Spades and hearts'], [4, '4 suits', 'All four suits — the hardest']],
      cur, v => { writePref({ suits: v }); deal({ suits: v }); });
  } else {
    dealInput = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '7', 'aria-label': `Deal number, 1 to ${R.FREECELL_MAX.toLocaleString()}` });
    variantEl = h('form.arx-cd__deal', { onsubmit: e => {
      e.preventDefault();
      const n = Math.floor(Number(dealInput.value.replace(/[^\d]/g, '')));
      if (n >= 1 && n <= R.FREECELL_MAX) { deal({ deal: n }); dealInput.blur(); }
      else { say(`Deals go from 1 to ${R.FREECELL_MAX.toLocaleString()}.`); dealInput.value = String(st.deal); }
    } }, h('span', { text: 'Deal #' }), dealInput,
      h('button.arx-cd__btn', { type: 'submit', title: 'Play this deal' }, h('span', { text: 'Play' })));
  }
  const undoLbl = h('span.arx-cd__lbl', { text: 'Undo' });
  const undoBtn = h('button.arx-cd__btn', { type: 'button', title: 'Undo (U)', 'aria-label': 'Undo (U)', onclick: () => undo() }, icon('rotate-ccw'), undoLbl);
  /* Spider: how many undos a deal allows */
  let undoSeg = null;
  if (kind === 'spider') {
    const opts = [['any', 'Any undo', 'Undo as often as you like'], ['5', '5 undos', 'Five undos a deal'], ['off', 'No undo', 'No taking back']];
    const btns = opts.map(([v, text, tip]) => h('button', { type: 'button', dataset: { undo: v }, 'aria-pressed': String(v === undoPref()), title: tip, onclick: () => {
      writePref({ undo: v });
      btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.undo === v)));
      say(v === 'any' ? 'Undo as often as you like.' : v === 'off' ? 'No undo in this deal or the next.' : `Five undos a deal${S.undos ? `; ${Math.max(0, 5 - S.undos)} left in this one` : ''}.`);
      paintBar();
    } }, text));
    undoSeg = h('div.arx-cd__seg', { role: 'group', 'aria-label': 'Undos a deal' }, btns);
  }
  const ptsEl = h('b', { text: '0' });
  const ptsRead = kind === 'klondike' ? h('span.arx-cd__read', { title: 'Points: +10 to a foundation, +5 from the waste to a column, +5 for turning a card over, −15 back from a foundation; turning the stock over costs 100 in Draw 1, 20 in Draw 3 after the third time' }, ptsEl, h('small', { text: 'points' })) : null;
  const dayText = h('span', { text: '' });
  const dayRead = h('span.arx-cd__read.arx-cd__day', { hidden: true, title: 'Today’s deal: the same deal for everyone today' }, icon('calendar'), dayText);
  const todayBtn = kind !== 'spider' ? h('button.arx-cd__btn', { type: 'button', title: 'Today’s deal: the same for everyone today. Win it on days in a row for a streak.', dataset: { k: 'today' }, onclick: () => deal({ daily: dayKey() }) },
    icon('calendar'), h('span.arx-cd__lbl', { text: 'Today' })) : null;
  const showBtn = h('button.arx-cd__btn', { type: 'button', title: 'Show a move you can make (M). A game won with it never sets a best.', dataset: { k: 'show' }, onclick: () => showMove() }, icon('eye'), h('span.arx-cd__lbl', { text: 'Show moves' }));
  const lookBtn = h('button.arx-cd__btn', { type: 'button', title: 'Card backs, the table, larger cards, left-handed', 'aria-haspopup': 'dialog', dataset: { k: 'look' }, onclick: () => openLook() }, icon('palette'), h('span.arx-cd__lbl', { text: 'Table' }));
  const newBtn = h('button.arx-cd__btn', { type: 'button', title: kind === 'freecell' ? 'A random deal' : 'A new deal', onclick: () => deal({}) }, icon('shuffle'), h('span.arx-cd__lbl', { text: 'New deal' }));
  const statsBtn = h('button.arx-cd__btn', { type: 'button', title: 'Games played and won on this device', 'aria-haspopup': 'dialog', onclick: () => openStats() }, icon('bar-chart'), h('span.arx-cd__lbl', { text: 'Stats' }));
  const grow = h('div.arx-cd__grow');
  const reads = [h('span.arx-cd__read', { title: 'Time since your first move' }, icon('clock'), timeEl),
    h('span.arx-cd__read', { title: 'Moves' }, movesEl, h('small', { text: 'moves' })), ptsRead, dayRead];
  const acts = [undoBtn, showBtn, todayBtn, newBtn, statsBtn, lookBtn];
  const bar = h('div.arx-cd__bar');
  /* left-handed: the buttons come first, on the left */
  const orderBar = () => bar.replaceChildren(...(look.left ? [...acts, ...reads, grow, variantEl, undoSeg] : [variantEl, undoSeg, grow, ...reads, ...acts]).filter(Boolean));
  orderBar();
  const table = h('div.arx-cd__table');
  const hint = h('span.arx-cd__hint', {},
    'Drag, or click a card to move it · double-click sends it home · ',
    h('kbd', { text: '← → ↑ ↓' }), ' pile ', h('kbd', { text: 'Enter' }), ' pick up / put down ', h('kbd', { text: 'U' }), ' undo ', h('kbd', { text: 'M' }), ' show a move');
  const foot = h('div.arx-cd__foot', hint);
  const statsLayer = h('div.arx-cd__stats', { hidden: true });
  const lookLayer = h('div.arx-cd__look', { hidden: true });
  const root = h('div.arx-cd', { tabindex: '-1', style: { '--h': G.hue } }, h('style', { text: CSS }), bar, table, foot, live, statsLayer, lookLayer);
  el.appendChild(root);
  /* a button clicked with the mouse hands the keys back to the table, so
     Enter picks up cards again instead of pressing that button twice */
  bar.addEventListener('click', e => { if (e.detail > 0 && e.target.closest('button')) root.focus({ preventScroll: true }); });
  const sf = surface(table, `${G.title} table`, () => { sprites.clear(); kick(); });
  const sprites = new Map();

  function say(text, ms = 2600) {
    clearTimeout(S.msgTimer);
    foot.replaceChildren(h('span', { text }));
    foot.classList.add('is-msg');
    live.textContent = text;
    S.msgTimer = setTimeout(() => { if (S.dead) return; foot.replaceChildren(hint); foot.classList.remove('is-msg'); }, ms);
  }

  /* ---------------- dealing ---------------- */
  function deal(change) {
    if (S.dead) return;
    stopAuto();
    S.celebrate = null;
    const p = readPref();
    const day = change.daily || null;
    const opt = {
      draw: change.draw ?? (p.draw === 3 ? 3 : 1),
      suits: change.suits ?? ([1, 2, 4].includes(p.suits) ? p.suits : 1),
      deal: day && kind === 'freecell' ? dailyDeal(day) : change.deal ?? (kind === 'freecell' ? 1 + Math.floor(Math.random() * 32000) : null),
    };
    const hand = change.layout;
    const seed = day ? dailySeed(kind, day) : crypto.getRandomValues(new Uint32Array(1))[0];
    st = hand ? R.fromLayout(kind, { ...opt, ...(hand.opt || {}) }, hand) : R.newGame(kind, opt, seed);
    Object.assign(S, { hist: [], started: false, counted: false, startAt: 0, banked: 0, won: false, ended: false, press: null, drag: null, tap: null, dragged: false, held: null, lastSec: -1, result: null,
      daily: day, shown: 0, showIx: 0, show: null, undos: 0 });
    putSaved(kind, null);                   /* the deal before this one is let go */
    S.anim.clear();
    S.cur = { row: 1, i: 0 };
    for (const b of segBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === (kind === 'klondike' ? st.draw : st.suits)));
    if (dealInput) dealInput.value = String(st.deal);
    paintBar();
    ctx.onScore?.(0);
    live.textContent = day ? `Today’s ${G.title} deal${kind === 'freecell' ? `, number ${st.deal}` : ''}: the same for everyone today.` : kind === 'freecell' ? `FreeCell deal number ${st.deal}.` : `New ${G.title} deal.`;
    if (day) say(`Today’s deal${kind === 'freecell' ? ` (#${st.deal})` : ''} — the same for everyone today. ${streakNow(kind) ? `Your streak: ${streakNow(kind)} ${streakNow(kind) === 1 ? 'day' : 'days'}.` : 'Win it to start a streak.'}`, 4000);
    kick(0.3);
  }

  /* ---------------- keeping the deal (closing the window, switching games) ---------------- */
  function persist() {
    if (!st || !S.started || S.won) return;
    putSaved(kind, {
      v: 1, draw: st.draw, suits: st.suits, deal: st.deal, seed: st.seed, ids: st.cards.map(c => c.id),
      snap: R.snapshot(st), hist: S.hist.slice(-60), ms: Math.round(elapsed()), daily: S.daily, shown: S.shown, undos: S.undos,
    });
  }
  function resumeSaved(v) {
    let s2;
    try {
      s2 = R.newGame(kind, { draw: v.draw, suits: v.suits, deal: v.deal }, v.seed >>> 0);
      if (Array.isArray(v.ids)) { const keep = new Set(v.ids); s2.cards = s2.cards.filter(c => keep.has(c.id)); }
      R.restore(s2, v.snap);
      if (s2.P.reduce((n, pl) => n + pl.c.length, 0) !== s2.cards.length || R.isWon(s2)) throw new Error('not a deal in progress');
      for (const snap of v.hist || []) if (!snap || !Array.isArray(snap.p) || snap.p.length !== s2.P.length) throw new Error('bad undo step');
    } catch (err) { putSaved(kind, null); return false; }
    st = s2;
    Object.assign(S, { hist: (v.hist || []).slice(-60), started: true, counted: true, startAt: now(), banked: Math.max(0, Number(v.ms) || 0), won: false, ended: false,
      press: null, drag: null, tap: null, dragged: false, held: null, lastSec: -1, result: null,
      daily: typeof v.daily === 'string' ? v.daily : null, shown: v.shown | 0, showIx: 0, show: null, undos: v.undos | 0 });
    S.anim.clear();
    S.cur = { row: 1, i: 0 };
    for (const b of segBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === (kind === 'klondike' ? st.draw : st.suits)));
    if (dealInput) dealInput.value = String(st.deal);
    paintBar();
    ctx.onScore?.(Math.floor(S.banked / 1000));
    say(`Your ${G.title} deal from before, as you left it.`, 3500);
    kick(0.3);
    return true;
  }

  /* ---------------- the clock & stats ---------------- */
  const running = () => S.started && !S.won && !S.paused && !S.statsOpen && !S.lookOpen;
  const elapsed = () => S.banked + (running() ? now() - S.startAt : 0);
  function setRunning(fn) { const ms = elapsed(); fn(); S.banked = ms; S.startAt = now(); }
  const undoLeft = () => (kind === 'spider' ? UNDO[undoPref()] - S.undos : Infinity);
  function paintBar() {
    timeEl.textContent = clock(elapsed());
    movesEl.textContent = String(st.moves);
    if (ptsRead) ptsEl.textContent = String(st.points || 0);
    const left = undoLeft();
    undoBtn.disabled = !S.hist.length || S.won || !!S.auto || left <= 0;
    undoLbl.textContent = Number.isFinite(left) ? `Undo (${Math.max(0, left)})` : 'Undo';
    dayRead.hidden = !S.daily;
    if (S.daily) dayText.textContent = `Today${streakNow(kind) ? ` · streak ${streakNow(kind)}` : ''}`;
  }
  const ticker = setInterval(() => {
    if (S.dead || !st) return;
    timeEl.textContent = clock(elapsed());
    const sec = Math.floor(elapsed() / 1000);
    if (sec !== S.lastSec && S.started) { S.lastSec = sec; ctx.onScore?.(sec); }
  }, 250);
  function firstMove() {
    if (S.started) return;
    S.started = true;
    S.startAt = now();
    S.banked = 0;
    if (!S.counted) {
      S.counted = true;
      bumpStats(variantKey(st), s => ({ ...s, played: s.played + 1 }));
    }
  }

  /* ---------------- geometry ---------------- */
  function layout() {
    const W = sf.w, H = sf.h, n = G.cols;
    const pad = clamp(Math.min(W, H) * 0.03, 8, 20);
    /* Larger cards: less room between the columns, and a shorter table allowance */
    const GP = look.big ? 0.07 : GAP;
    let cw = (W - pad * 2) / (n + (n - 1) * GP);
    cw = Math.max(18, Math.floor(Math.min(cw, (H - pad * 2) / (ASPECT * (look.big ? 2.7 : 3.3)), look.big ? 160 : 120)));
    const ch = Math.round(cw * ASPECT), gap = cw * GP;
    const ox = (W - (n * cw + (n - 1) * gap)) / 2;
    return { W, H, n, pad, cw, ch, gap, colX: i => ox + i * (cw + gap), topY: pad, tabY: pad + ch + Math.max(10, gap * 1.6) };
  }
  function slotOf(L, pi) {
    const p = st.P[pi];
    const tabAt = i => ({ x: L.colX(i), y: L.tabY });
    if (p.t === 'tab') return tabAt(p.i);
    /* left-handed: the stock (Spider, Solitaire) or the free cells on the right become the left, and back */
    const lh = look.left;
    if (kind === 'klondike') return { x: L.colX(p.t === 'stock' ? (lh ? 6 : 0) : p.t === 'waste' ? (lh ? 5 : 1) : (lh ? p.i : 3 + p.i)), y: L.topY };
    if (kind === 'freecell') return { x: L.colX(p.t === 'cell' ? (lh ? 4 + p.i : p.i) : (lh ? p.i : 4 + p.i)), y: L.topY };
    return { x: L.colX(p.t === 'stock' ? (lh ? 0 : L.n - 1) : (lh ? L.n - 1 : 0)), y: L.topY };
  }
  function fanOf(L, pi) {
    const c = st.P[pi].c;
    let fd = L.ch * 0.12, fu = L.ch * 0.27, need = 0;
    for (let k = 0; k < c.length - 1; k++) need += c[k].up ? fu : fd;
    const avail = L.H - L.pad - L.tabY - L.ch;
    if (need > avail && need > 0) { const f = Math.max(0.28, avail / need); fd *= f; fu *= f; }
    return { fd, fu };
  }
  /** where every card belongs: id -> { x, y, pi, k } */
  function targets(L) {
    const out = new Map();
    st.P.forEach((p, pi) => {
      const s = slotOf(L, pi), n = p.c.length;
      if (p.t === 'tab') {
        const { fd, fu } = fanOf(L, pi);
        let y = s.y;
        p.c.forEach((c, k) => { out.set(c.id, { x: s.x, y, pi, k }); y += c.up ? fu : fd; });
      } else if (p.t === 'waste') {
        const fan = st.draw === 3 ? Math.min(3, n) : 1;
        const dir = look.left ? -1 : 1;                /* the waste fans away from the stock */
        p.c.forEach((c, k) => out.set(c.id, { x: s.x + dir * Math.max(0, k - (n - fan)) * L.cw * 0.24, y: s.y, pi, k }));
      } else if (p.t === 'done') {
        p.c.forEach((c, k) => out.set(c.id, { x: L.colX(look.left ? L.n - 1 - Math.floor(k / 13) : Math.floor(k / 13)), y: s.y, pi, k }));
      } else if (p.t === 'stock' && kind === 'spider') {
        const deals = Math.ceil(n / 10), dir = look.left ? 1 : -1;
        p.c.forEach((c, k) => out.set(c.id, { x: s.x + dir * (deals - 1 - Math.floor(k / 10)) * L.cw * 0.16, y: s.y, pi, k }));
      } else p.c.forEach((c, k) => out.set(c.id, { x: s.x, y: s.y, pi, k }));
    });
    return out;
  }
  const cardRect = (L, q) => ({ x: q.x, y: q.y, w: L.cw, h: L.ch });
  function stockRect(L, T) {
    const p = st.P[st.ix.stock], s = slotOf(L, st.ix.stock);
    const xs = p.c.map(c => T.get(c.id).x);
    const x0 = Math.min(s.x, ...xs), x1 = Math.max(s.x, ...xs) + L.cw;
    return { x: x0, y: s.y, w: x1 - x0, h: L.ch };
  }
  /** the card (or empty pile, idx -1) under a point */
  function hitAt(L, T, x, y) {
    for (let pi = st.P.length - 1; pi >= 0; pi--) {
      const p = st.P[pi];
      if (p.t === 'done') continue;
      if (p.t === 'stock') { if (inRect(x, y, stockRect(L, T))) return { pi, idx: p.c.length - 1 }; continue; }
      for (let k = p.c.length - 1; k >= 0; k--) if (inRect(x, y, cardRect(L, T.get(p.c[k].id)))) return { pi, idx: k };
      const s = slotOf(L, pi);
      if (!p.c.length && inRect(x, y, { x: s.x, y: s.y, w: L.cw, h: L.ch })) return { pi, idx: -1 };
    }
    return null;
  }
  function zoneOf(L, T, pi) {
    const p = st.P[pi], s = slotOf(L, pi);
    if (p.t === 'tab') {
      if (!p.c.length) return { x: s.x, y: s.y, w: L.cw, h: L.ch };
      const last = T.get(p.c[p.c.length - 1].id);
      return { x: s.x, y: s.y, w: L.cw, h: last.y + L.ch - s.y };
    }
    if (p.t === 'found' || p.t === 'cell') return { x: s.x, y: s.y, w: L.cw, h: L.ch };
    return null;
  }
  function dropTarget(L, T, d) {
    const rect = { x: d.x - d.gx, y: d.y - d.gy, w: L.cw, h: L.ch };
    let best = null, score = 0;
    st.P.forEach((p, pi) => {
      if (!R.canDrop(st, d.pi, d.idx, pi)) return;
      const z = zoneOf(L, T, pi);
      if (!z) return;
      const a = overlap(rect, z) + (inRect(d.x, d.y, z) ? L.cw * L.ch : 0);
      if (a > score) { score = a; best = pi; }
    });
    return best;
  }

  /* ---------------- keyboard rows ---------------- */
  function rows() {
    const top = kind === 'klondike' ? [st.ix.stock, st.ix.waste, ...st.ix.found]
      : kind === 'freecell' ? [...st.ix.cells, ...st.ix.found] : [st.ix.stock];
    /* the keys walk the piles in the order they stand on the table */
    const L = layout();
    top.sort((a, b) => slotOf(L, a).x - slotOf(L, b).x);
    return [top, st.ix.tab];
  }
  const curPile = () => { const rw = rows()[S.cur.row]; return rw[clamp(S.cur.i, 0, rw.length - 1)]; };

  /* ---------------- changes (animated) ---------------- */
  function shown(L, T, t) {
    const out = new Map();
    for (const [id, p] of T) {
      const a = S.anim.get(id);
      if (a) {
        const k = a.dur > 0 ? clamp((t - a.t0) / a.dur, 0, 1) : 1;
        const e = ease(k);
        out.set(id, { x: a.fx + (p.x - a.fx) * e, y: a.fy + (p.y - a.fy) * e, moving: k < 1 });
        if (k >= 1) S.anim.delete(id);
      } else out.set(id, { x: p.x, y: p.y });
    }
    const d = S.drag;
    if (d?.moved) {
      const { fu } = fanOf(L, d.pi);
      d.ids.forEach((id, j) => out.set(id, { x: d.x - d.gx, y: d.y - d.gy + j * fu, dragged: true }));
    }
    return out;
  }
  function change(fn, dur = 150) {
    const L = layout(), t = now();
    const before = shown(L, targets(L), t);
    const res = fn();
    if (!res) return res;
    const after = targets(L);
    for (const [id, p] of after) {
      const b = before.get(id);
      if (b && (Math.abs(b.x - p.x) > 0.5 || Math.abs(b.y - p.y) > 0.5)) S.anim.set(id, { fx: b.x, fy: b.y, t0: t, dur: reduced ? 0 : dur });
    }
    kick(dur / 1000 + 0.05);
    return res;
  }

  /* a user's move: remember it for undo, play it, then see what follows */
  function act(fn, label) {
    if (!st || S.won || S.auto || S.celebrate) return null;
    const snap = R.snapshot(st);
    const res = change(fn);
    if (!res || res.blocked) return res;
    S.hist.push(snap);
    if (S.hist.length > 400) S.hist.splice(0, S.hist.length - 400);
    firstMove();
    if (label) live.textContent = label(res);
    afterChange(res);
    return res;
  }
  function afterChange(res) {
    if (res?.off?.length) { snd.blip(660, 0.08, 'triangle', 0.7); setTimeout(() => snd.blip(990, 0.12, 'triangle', 0.7), 90); }
    S.show = null; S.showIx = 0;
    paintBar();
    if (R.isWon(st)) { win(); return; }
    persist();
    if (!S.auto) {
      const plan = R.autoPlan(st);
      if (plan && plan.length) startAuto(plan);
    }
  }
  function moveCards(from, idx, to, how) {
    const c = st.P[from].c[idx];
    const where = pileName(to);                    /* named before the cards land on it */
    const res = act(() => R.move(st, from, idx, to), r => `${R.nameOf(c)}${r.n > 1 ? ` and ${r.n - 1} more` : ''} to ${where}.${r.flipped ? ` ${R.nameOf(r.flipped)} turned over.` : ''}`);
    if (res) {
      snd.blip(st.P[to].t === 'found' ? 740 : 420, 0.045, 'triangle', 0.5);
      if (how === 'drag' || how === 'click') S.kbd = false;
    }
    return res;
  }
  function pileName(pi) {
    const p = st.P[pi];
    if (p.t === 'found') return 'a foundation';
    if (p.t === 'cell') return 'a free cell';
    if (p.t === 'tab') { const t = p.c[p.c.length - 1]; return t ? `the ${R.nameOf(t)} in column ${p.i + 1}` : `empty column ${p.i + 1}`; }
    return p.t;
  }
  function stock() {
    if (!st || S.won || S.auto) return;
    const res = act(() => R.drawStock(st), r => (r.redeal ? 'The waste went back to the stock.' : r.dealt ? 'Dealt a row.' : `Turned over ${r.drew.map(R.nameOf).join(', ')}.`));
    if (res?.blocked) { bad(); say('Every column needs a card before you deal another row.'); return; }
    if (!res) { bad(); return; }
    snd.blip(res.redeal ? 300 : 520, 0.05, 'triangle', 0.4);
  }
  function undo() {
    if (!S.hist.length || S.won || S.auto || S.celebrate) return;
    if (undoLeft() <= 0) { bad(); say(undoPref() === 'off' ? 'Undo is off for Spider (the Undo setting in the bar).' : 'No undos left in this deal.'); return; }
    if (kind === 'spider') S.undos++;
    S.show = null; S.showIx = 0;
    const snap = S.hist.pop();
    change(() => { R.restore(st, snap); return true; }, 130);
    S.held = null;
    snd.blip(330, 0.04, 'triangle', 0.35);
    live.textContent = Number.isFinite(undoLeft()) ? `Undone. ${Math.max(0, undoLeft())} ${undoLeft() === 1 ? 'undo' : 'undos'} left.` : 'Undone.';
    paintBar();
    persist();
  }

  /* ---------------- show moves ---------------- */
  function describe(mv) {
    if (mv.draw) return kind === 'spider' ? 'Deal a row from the stock.' : st.P[st.ix.stock].c.length ? 'Turn over the stock.' : 'Turn the waste back over.';
    const c = st.P[mv.from].c[mv.idx], n = st.P[mv.from].c.length - mv.idx;
    return `${R.nameOf(c)}${n > 1 ? ` and the ${n - 1 === 1 ? 'card' : `${n - 1} cards`} on it` : ''} to ${pileName(mv.to)}.`;
  }
  function showMove() {
    if (!st || S.won || S.auto || S.celebrate) return;
    const list = R.hints(st);
    if (!list.length) {
      bad();
      say(kind === 'spider' && st.P[st.ix.stock].c.length ? 'No moves on the table — and every column needs a card before you deal a row.' : 'No moves left. Undo, or start a new deal.', 3500);
      return;
    }
    const mv = list[S.showIx % list.length];
    S.showIx++;
    S.shown++;
    S.show = { mv, t0: now() };
    say(`${list.length > 1 ? `${(S.showIx - 1) % list.length + 1} of ${list.length}: ` : ''}${describe(mv)}`, 3000);
    kick(2.6);
    persist();
  }
  function bad(ids) {
    S.shakeAt = reduced ? -1 : now();
    S.shakeIds = ids || null;
    snd.blip(140, 0.1, 'sawtooth', 0.4, 90);
    kick(0.3);
  }

  /* ---------------- finishing by itself ---------------- */
  function startAuto(plan) {
    S.auto = { plan, i: 0 };
    S.held = null;
    say('Finishing by itself…', 4000);
    paintBar();
    const step = () => {
      S.autoTimer = 0;
      if (S.dead || !S.auto) return;
      const mv = S.auto.plan[S.auto.i++];
      if (!mv) { S.auto = null; paintBar(); if (R.isWon(st)) win(); return; }
      change(() => (mv.draw ? R.drawStock(st) : R.move(st, mv.from, mv.idx, mv.to)), 110);
      if (!mv.draw) snd.blip(600 + (S.auto.i % 8) * 40, 0.035, 'triangle', 0.35);
      paintBar();
      S.autoTimer = setTimeout(step, reduced ? 25 : 85);
    };
    S.autoTimer = setTimeout(step, reduced ? 25 : 160);
  }
  function stopAuto() { clearTimeout(S.autoTimer); S.autoTimer = 0; S.auto = null; }

  /* ---------------- winning ---------------- */
  function win() {
    if (S.won) return;
    const ms = Math.max(1, Math.round(elapsed()));
    S.won = true;
    S.banked = ms;
    S.held = null;
    paintBar();
    /* a deal won with Show moves counts as won, but its time isn't a best */
    const helped = S.shown > 0;
    bumpStats(variantKey(st), s => ({ ...s, won: s.won + 1, best: helped ? s.best : s.best === null ? ms : Math.min(s.best, ms),
      ...(kind === 'klondike' && !helped ? { pts: Math.max(bestPts(variantKey(st)) ?? 0, st.points || 0) } : {}) }));
    if (kind === 'freecell') addWon(st.deal);
    const daily = S.daily ? winDaily(kind, S.daily, ms) : null;
    putSaved(kind, null);
    [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => snd.blip(f, 0.16, 'triangle', 0.8), k * 110));
    say(`You won in ${timeText(ms)} and ${st.moves} moves${kind === 'klondike' ? `, with ${st.points || 0} points` : ''}.${daily ? ` Today’s deal: a streak of ${daily.streak} ${daily.streak === 1 ? 'day' : 'days'}.` : ''}`, 15000);
    S.result = { ms, moves: st.moves, points: st.points || 0, helped, daily };
    paintBar();
    celebrate();
  }
  function finishWin() {
    if (S.ended || S.dead) return;
    S.ended = true;
    S.celebrate = null;
    kick();
    const v = VARIANTS.find(x => x.key === variantKey(st));
    const secs = Math.max(0.1, Math.floor(S.result.ms / 100) / 10);
    const R0 = S.result;
    ctx.onEnd?.({ score: secs, won: true, ...(R0.helped ? { assisted: true } : {}),
      detail: `${v.label}${kind === 'freecell' ? ` #${st.deal}` : ''}${R0.daily ? ' · Today’s deal' : ''} · ${R0.moves} moves · ${timeText(R0.ms)}${kind === 'klondike' ? ` · ${R0.points} points` : ''}${R0.daily ? ` · streak ${R0.daily.streak}` : ''}${R0.helped ? ` · Show moves used ${S.shown === 1 ? 'once' : `${S.shown} times`}` : ''}` });
  }
  /* cards leave the foundations one by one and bounce away, leaving trails */
  function celebrate() {
    const L = layout();
    if (reduced) { S.celebrate = { t0: now(), reduced: true, gone: new Set() }; kick(1); setTimeout(finishWin, 900); return; }
    const q = [];
    if (kind === 'spider') {
      const c = st.P[st.ix.done].c;
      for (let r = 12; r >= 0; r--) for (let j = 0; j < c.length / 13; j++) q.push(c[j * 13 + r]);
    } else {
      for (let r = 12; r >= 0; r--) for (const f of st.ix.found) if (st.P[f].c[r]) q.push(st.P[f].c[r]);
    }
    const trail = document.createElement('canvas');
    trail.width = sf.cv.width;
    trail.height = sf.cv.height;
    const T = targets(L);
    S.celebrate = { t0: now(), q, T, fly: [], next: now() + 250, trail, tg: trail.getContext('2d'), gone: new Set(), L };
    kick(12);
  }
  function stepCelebrate(dt) {
    const C = S.celebrate;
    if (!C || C.reduced) return;
    const t = now(), L = C.L, k = L.cw / 70;
    if (t >= C.next && C.q.length) {
      const c = C.q.shift();
      const p = C.T.get(c.id);
      const dir = Math.random() < 0.5 ? -1 : 1;
      C.fly.push({ c, x: p.x, y: p.y, vx: dir * (160 + Math.random() * 260) * k, vy: -(60 + Math.random() * 360) * k });
      C.gone.add(c.id);
      C.next = t + (kind === 'spider' ? 45 : 85);
    }
    const g = C.tg;
    g.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
    const floor = L.H - L.ch;
    for (const f of C.fly) {
      f.vy += 1900 * k * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.y > floor) { f.y = floor; f.vy = -Math.abs(f.vy) * 0.74; }
      g.drawImage(face(f.c, L), f.x, f.y, L.cw, L.ch);
    }
    C.fly = C.fly.filter(f => f.x + L.cw > 0 && f.x < L.W);
    if ((!C.q.length && !C.fly.length) || t - C.t0 > 11000) finishWin();
  }

  /* ---------------- drawing ---------------- */
  function face(c, L) {
    const key = `${c.r}|${c.s}|${L.cw}|${sf.dpr}|${look.big ? 'B' : ''}`;
    let s = sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(L.cw * sf.dpr));
    s.height = Math.max(1, Math.round(L.ch * sf.dpr));
    const g = s.getContext('2d');
    g.scale(sf.dpr, sf.dpr);
    drawFace(g, L.cw, L.ch, c.r, c.s, look.big);
    sprites.set(key, s);
    return s;
  }
  function back(L) {
    const key = `back|${L.cw}|${sf.dpr}|${look.back}|${look.color}`;
    let s = sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(L.cw * sf.dpr));
    s.height = Math.max(1, Math.round(L.ch * sf.dpr));
    const g = s.getContext('2d');
    g.scale(sf.dpr, sf.dpr);
    drawBack(g, L.cw, L.ch, backHue(look, G.hue), look.back);
    sprites.set(key, s);
    return s;
  }
  function slotMark(g, L, pi) {
    const p = st.P[pi], s = slotOf(L, pi);
    rr(g, s.x + 1, s.y + 1, L.cw - 2, L.ch - 2, L.cw * 0.075);
    g.fillStyle = 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.lineWidth = 1.2;
    g.setLineDash([5, 4]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.2)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${L.cw * 0.3}px ${FONT}`;
    const cx = s.x + L.cw / 2, cy = s.y + L.ch / 2;
    if (p.t === 'found') g.fillText('A', cx, cy);
    else if (p.t === 'tab' && kind === 'klondike') g.fillText('K', cx, cy);
    else if (p.t === 'stock' && kind === 'klondike' && st.P[st.ix.waste].c.length) {
      g.strokeStyle = 'rgba(255,255,255,.34)';
      g.lineWidth = Math.max(2, L.cw * 0.05);
      g.beginPath();
      g.arc(cx, cy, L.cw * 0.2, -Math.PI * 0.3, Math.PI * 1.45);
      g.stroke();
    } else if (p.t === 'cell') {
      g.font = `600 ${L.cw * 0.16}px ${FONT}`;
      g.fillText('FREE', cx, cy);
    }
  }
  function cardAt(g, L, c, x, y, lift = 0) {
    if (lift) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,.55)';
      g.shadowBlur = 16;
      g.shadowOffsetY = 6;
    } else {
      g.fillStyle = 'rgba(0,0,0,.28)';
      rr(g, x, y + 1.5, L.cw, L.ch, L.cw * 0.075);
      g.fill();
    }
    g.drawImage(c.up ? face(c, L) : back(L), x, y, L.cw, L.ch);
    if (lift) g.restore();
  }

  function draw() {
    if (S.dead || !st) return;
    const g = sf.g;
    sf.begin();
    const t = now(), L = layout(), T = targets(L), pos = shown(L, T, t);
    const bgd = g.createRadialGradient(L.W / 2, L.H * 0.35, 0, L.W / 2, L.H * 0.35, Math.max(L.W, L.H) * 0.8);
    const felt = feltColors(look);
    bgd.addColorStop(0, felt ? felt[0] : hsl(G.hue, 38, 17));
    bgd.addColorStop(1, felt ? felt[1] : hsl(G.hue, 45, 6));
    g.fillStyle = bgd;
    g.fillRect(0, 0, L.W, L.H);

    st.P.forEach((p, pi) => { if (p.t !== 'done' && !(p.t === 'stock' && kind === 'spider' && p.c.length)) slotMark(g, L, pi); });
    if (kind === 'spider') for (let j = 0; j < 8; j++) {
      if (st.P[st.ix.done].c.length > j * 13) continue;
      rr(g, L.colX(look.left ? L.n - 1 - j : j) + 1, L.topY + 1, L.cw - 2, L.ch - 2, L.cw * 0.075);
      g.strokeStyle = 'rgba(255,255,255,.1)';
      g.lineWidth = 1;
      g.stroke();
    }

    const held = heldView(L, T);
    const hiddenIds = new Set(held ? held.ids : []);
    const C = S.celebrate;
    const late = [];
    const shake = S.shakeAt >= 0 && t - S.shakeAt < 300 ? Math.sin((t - S.shakeAt) / 18) * 5 * (1 - (t - S.shakeAt) / 300) : 0;
    st.P.forEach(p => {
      const n = p.c.length;
      p.c.forEach((c, k) => {
        const q = pos.get(c.id);
        if (!q || hiddenIds.has(c.id) || C?.gone?.has(c.id)) return;
        if (q.moving || q.dragged) { late.push([c, q]); return; }
        /* a stacked pile only needs its top two drawn */
        if ((p.t === 'stock' || p.t === 'found' || p.t === 'cell' || (p.t === 'waste' && st.draw === 1)) && k < n - 2) return;
        if (p.t === 'done' && k % 13 !== 12) return;
        const dx = shake && (!S.shakeIds || S.shakeIds.includes(c.id)) ? shake : 0;
        cardAt(g, L, c, q.x + dx, q.y);
      });
    });
    for (const [c, q] of late.filter(([, q]) => !q.dragged)) cardAt(g, L, c, q.x, q.y);

    /* where a dragged card would land */
    const d = S.drag;
    if (d?.moved) {
      const to = dropTarget(L, T, d);
      if (to !== null) {
        const z = zoneOf(L, T, to);
        const top = st.P[to].c.length && st.P[to].t === 'tab' ? cardRect(L, T.get(st.P[to].c[st.P[to].c.length - 1].id)) : z;
        rr(g, top.x - 3, top.y - 3, top.w + 6, top.h + 6, L.cw * 0.1);
        g.strokeStyle = hsl(140, 90, 62, 0.95);
        g.lineWidth = 2.5;
        g.stroke();
      }
      for (const [c, q] of late.filter(([, q]) => q.dragged)) cardAt(g, L, c, q.x, q.y, 1);
    }

    /* the keyboard's chosen pile, and what is held over it */
    if (S.kbd && !S.won) {
      const pi = curPile();
      const z = pi === st.ix.stock ? stockRect(L, T) : (() => {
        const p = st.P[pi];
        if (p.t === 'tab' && p.c.length) return cardRect(L, T.get(p.c[p.c.length - 1].id));
        const s = slotOf(L, pi);
        return { x: s.x, y: s.y, w: L.cw, h: L.ch };
      })();
      rr(g, z.x - 4, z.y - 4, z.w + 8, z.h + 8, L.cw * 0.11);
      g.strokeStyle = hsl(G.hue, 100, 80, 0.95);
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.stroke();
      g.setLineDash([]);
    }
    /* Show moves: the cards to move and where they go, for a moment */
    if (S.show && t - S.show.t0 < 2500 && !S.won) {
      const mv = S.show.mv;
      const a = 0.95 * Math.min(1, (2500 - (t - S.show.t0)) / 400);
      g.save();
      g.strokeStyle = `rgba(255,214,80,${a})`;
      g.lineWidth = 3;
      g.setLineDash([7, 4]);
      const ring = z => { rr(g, z.x - 4, z.y - 4, z.w + 8, z.h + 8, L.cw * 0.11); g.stroke(); };
      if (mv.draw) ring(stockRect(L, T));
      else {
        const from = st.P[mv.from], q0 = pos.get(from.c[mv.idx].id), q1 = pos.get(from.c[from.c.length - 1].id);
        if (q0 && q1) ring({ x: q0.x, y: q0.y, w: L.cw, h: q1.y + L.ch - q0.y });
        const to = st.P[mv.to];
        const z = to.t === 'tab' && to.c.length ? cardRect(L, T.get(to.c[to.c.length - 1].id)) : { ...slotOf(L, mv.to), w: L.cw, h: L.ch };
        g.strokeStyle = `rgba(110,240,150,${a})`;
        ring(z);
      }
      g.restore();
    }
    if (held) {
      held.cards.forEach((c, j) => cardAt(g, L, c, held.x, held.y + j * held.fu, 1));
      rr(g, held.x - 3, held.y - 3, L.cw + 6, L.ch + 6 + (held.cards.length - 1) * held.fu, L.cw * 0.1);
      g.strokeStyle = held.ok ? hsl(140, 90, 62, 0.95) : 'rgba(255,110,130,.9)';
      g.lineWidth = 2;
      g.stroke();
    }

    if (C && !C.reduced) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(C.trail, 0, 0);
      sf.begin();
    } else if (C?.reduced) {
      const k = clamp((t - C.t0) / 500, 0, 1);
      g.fillStyle = hsl(G.hue, 100, 70, 0.18 * k);
      g.fillRect(0, 0, L.W, L.H);
    }
  }

  /* the cards in the keyboard's hand: lifted over the chosen pile */
  function heldView(L, T) {
    const H = S.held;
    if (!H || !st.P[H.from]) return null;
    const to = curPile();
    const same = to === H.from;
    const idx = same ? R.liftIndex(st, H.from) : R.dropIndex(st, H.from, to);
    const ok = !same && idx >= 0;
    const from = idx >= 0 ? idx : R.liftIndex(st, H.from);
    if (from < 0) return null;
    const cards = st.P[H.from].c.slice(from);
    const fu = L.ch * 0.27;
    let x, y;
    if (same) { const q = T.get(cards[0].id); x = q.x; y = q.y - L.ch * 0.12; }
    else {
      const p = st.P[to];
      if (p.t === 'tab' && p.c.length) { const q = T.get(p.c[p.c.length - 1].id); x = q.x; y = q.y + fanOf(L, to).fu * 0.9; }
      else { const s = to === st.ix.stock ? stockRect(L, T) : slotOf(L, to); x = s.x; y = s.y - L.ch * 0.08; }
    }
    return { cards, ids: cards.map(c => c.id), x, y, fu, ok };
  }

  /* ---------------- frame loop ---------------- */
  let until = 0;
  const loop = looper(dt => {
    stepCelebrate(dt);
    draw();
    const busy = S.anim.size || S.drag || S.celebrate || (S.shakeAt >= 0 && now() - S.shakeAt < 320) || (S.show && now() - S.show.t0 < 2600);
    if (!busy && now() / 1000 > until) loop.stop();
  });
  function kick(extra = 0.05) { until = Math.max(until, now() / 1000 + extra); loop.start(); }

  /* ---------------- pointer ---------------- */
  const local = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = e => {
    if (e.button > 0 || !st) return;
    snd.wake();
    S.dragged = false;
    S.tap = null;
    if (document.activeElement !== root) root.focus({ preventScroll: true });
    if (S.celebrate) { finishWin(); return; }
    if (S.won || S.auto) return;
    const p = local(e);
    const L = layout(), T = targets(L);
    const hit = hitAt(L, T, p.x, p.y);
    if (S.held) { S.held = null; kick(); }
    if (S.kbd) { S.kbd = false; kick(); }
    S.press = hit ? { ...hit, x: p.x, y: p.y, id: e.pointerId, t: now() } : null;
    if (!hit || hit.idx < 0 || st.P[hit.pi].t === 'stock' || !R.canPick(st, hit.pi, hit.idx)) return;
    e.preventDefault();
    const q = T.get(st.P[hit.pi].c[hit.idx].id);
    S.press.gx = p.x - q.x;
    S.press.gy = p.y - q.y;
    try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  };
  const onMove = e => {
    const p = local(e);
    const pr = S.press;
    if (pr && e.pointerId === pr.id && pr.gx !== undefined) {
      if (!S.drag && Math.hypot(p.x - pr.x, p.y - pr.y) > 5 && R.canPick(st, pr.pi, pr.idx)) {
        S.drag = { pi: pr.pi, idx: pr.idx, ids: st.P[pr.pi].c.slice(pr.idx).map(c => c.id), gx: pr.gx, gy: pr.gy, x: p.x, y: p.y, moved: true };
        for (const id of S.drag.ids) S.anim.delete(id);
        sf.cv.style.cursor = 'grabbing';
      }
      if (S.drag) { S.drag.x = p.x; S.drag.y = p.y; kick(); }
      return;
    }
    if (e.pointerType === 'mouse' && !S.drag && st && !S.won) {
      const L = layout();
      const hit = hitAt(L, targets(L), p.x, p.y);
      const can = hit && (st.P[hit.pi].t === 'stock' || (hit.idx >= 0 && R.canPick(st, hit.pi, hit.idx)));
      sf.cv.style.cursor = can ? (st.P[hit.pi].t === 'stock' ? 'pointer' : 'grab') : 'default';
    }
  };
  const onUp = e => {
    const pr = S.press;
    if (!pr || e.pointerId !== pr.id) return;
    S.press = null;
    const p = local(e);
    if (S.drag) {
      const d = S.drag;
      const L = layout(), T = targets(L);
      const to = dropTarget(L, T, d);
      sf.cv.style.cursor = 'grab';
      S.dragged = true;                            /* the click that follows is not a click */
      if (to !== null && moveCards(d.pi, d.idx, to, 'drag')) { S.drag = null; return; }
      /* not legal: slide back */
      const before = shown(L, T, now());
      S.drag = null;
      const t = now();
      for (const id of d.ids) { const b = before.get(id), q = T.get(id); if (b && q) S.anim.set(id, { fx: b.x, fy: b.y, t0: t, dur: reduced ? 0 : 200 }); }
      const home = zoneOf(L, T, d.pi);
      if (!home || !inRect(p.x, p.y, home)) bad(d.ids);      /* dropped back on its own pile: no buzz */
      kick(0.25);
      return;
    }
    S.tap = Math.hypot(p.x - pr.x, p.y - pr.y) <= 8 ? pr : null;
  };
  const onCancel = e => {
    if (S.press?.id !== e.pointerId) return;
    S.press = null;
    if (S.drag) {
      const L = layout(), T = targets(L), before = shown(L, T, now()), d = S.drag;
      S.drag = null;
      for (const id of d.ids) { const b = before.get(id); if (b) S.anim.set(id, { fx: b.x, fy: b.y, t0: now(), dur: reduced ? 0 : 200 }); }
      kick(0.25);
    }
  };
  /* a click sends the card somewhere legal — a foundation first, so a
     double-click sends it home. The second click of a double-click
     (detail 2) lands on whatever the first one uncovered: not a click. */
  const onClick = e => {
    const pr = S.tap;
    S.tap = null;
    if (S.dragged) { S.dragged = false; return; }
    if (!pr || !st || S.won || S.auto || e.detail > 1) return;
    const pile = st.P[pr.pi];
    if (!pile) return;
    if (pile.t === 'stock') { stock(); return; }
    if (pr.idx >= 0 && R.canPick(st, pr.pi, pr.idx)) {
      const to = R.autoTarget(st, pr.pi, pr.idx);
      if (to !== null) moveCards(pr.pi, pr.idx, to, 'click');
      else bad(pile.c.slice(pr.idx).map(c => c.id));
    } else if (pr.idx >= 0) bad([pile.c[pr.idx].id]);
  };

  /* ---------------- keyboard ---------------- */
  const onKey = e => {
    if (!ownsKey(root, e) || !st) return;
    if (S.statsOpen) { if (e.key === 'Escape') { e.preventDefault(); closeStats(); } return; }
    if (S.lookOpen) return;
    const k = e.code;
    if (S.celebrate && (k === 'Enter' || k === 'Space' || k === 'Escape' || k === 'NumpadEnter')) { e.preventDefault(); finishWin(); return; }
    if (S.won || S.auto) return;
    const rw = rows();
    let used = true;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (S.kbd) { const n = rw[S.cur.row].length; S.cur.i = (clamp(S.cur.i, 0, n - 1) + (k === 'ArrowLeft' ? n - 1 : 1)) % n; }
      S.kbd = true;
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      const to = k === 'ArrowUp' ? 0 : 1;
      if (S.kbd && to !== S.cur.row) {
        const L = layout();
        const x = slotOf(L, curPile()).x;
        let best = 0, bd = Infinity;
        rw[to].forEach((pi, i) => { const dd = Math.abs(slotOf(L, pi).x - x); if (dd < bd) { bd = dd; best = i; } });
        S.cur = { row: to, i: best };
      }
      S.kbd = true;
    } else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
      if (e.repeat) { e.preventDefault(); return; }
      if (!S.kbd) { S.kbd = true; }
      else enter();
    } else if (k === 'Escape') {
      if (!S.held) return;                         /* the Arcade's pause */
      S.held = null;
      live.textContent = 'Put back.';
    } else if (k === 'KeyU' || k === 'KeyZ' || k === 'Backspace') {
      undo();
    } else if (k === 'KeyM') {
      showMove();
    } else if (k === 'KeyF') {
      const pi = S.held ? S.held.from : curPile();
      const to = R.foundationFor(st, pi);
      if (to !== null) { S.held = null; moveCards(pi, st.P[pi].c.length - 1, to, 'key'); } else bad();
    } else used = false;
    if (!used) return;
    e.preventDefault();
    snd.wake();
    kick(0.1);
  };
  function enter() {
    const pi = curPile();
    const p = st.P[pi];
    if (!S.held) {
      if (p.t === 'stock') { stock(); return; }
      const idx = R.liftIndex(st, pi);
      if (idx < 0) { bad(); return; }
      S.held = { from: pi };
      live.textContent = `Holding ${R.nameOf(p.c[idx])}${p.c.length - idx > 1 ? ` and ${p.c.length - idx - 1} more` : ''}. Choose a pile and press Enter.`;
      snd.blip(480, 0.03, 'triangle', 0.3);
      return;
    }
    if (pi === S.held.from) { S.held = null; live.textContent = 'Put back.'; return; }
    const idx = R.dropIndex(st, S.held.from, pi);
    if (idx < 0) { bad(); live.textContent = 'Those cards can’t go there.'; return; }
    const from = S.held.from;
    S.held = null;
    moveCards(from, idx, pi, 'key');
  }

  /* ---------------- stats ---------------- */
  function openStats() {
    if (S.statsOpen) return;
    setRunning(() => { S.statsOpen = true; });
    const all = readStats(), cur = st ? variantKey(st) : '';
    const rowsEl = VARIANTS.map(v => {
      const s = all[v.key];
      return h('tr', { class: v.key === cur ? 'is-now' : '', dataset: { variant: v.key } },
        h('td', { text: v.label }),
        h('td', { text: String(s.played) }),
        h('td', { text: String(s.won) }),
        h('td', { text: s.played ? `${Math.round((s.won / s.played) * 100)}%` : '—' }),
        h('td', { text: s.best ? timeText(s.best) : '—' }));
    });
    const close = h('button.arx-cd__btn', { type: 'button', onclick: () => closeStats() }, h('span', { text: 'Close' }));
    statsLayer.replaceChildren(h('div.arx-cd__card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Card game stats' },
      h('h3', { text: 'Card games on this device' }),
      h('p', { text: 'A deal counts as played once you make a move in it. Times run from the first move to the last card home, not counting pauses.' }),
      h('table', h('thead', h('tr', ['Game', 'Played', 'Won', 'Win rate', 'Best time'].map(x => h('th', { text: x })))), h('tbody', rowsEl)),
      extras(),
      h('div.arx-cd__acts', close)));
    statsLayer.hidden = false;
    setTimeout(() => { if (!S.dead && S.statsOpen) close.focus({ preventScroll: true }); }, 30);
  }
  /* under the table: Solitaire's best points, Today's deal, FreeCell's won deals */
  function extras() {
    const out = [];
    if (kind === 'klondike') {
      const d1 = bestPts('klondike-d1'), d3 = bestPts('klondike-d3');
      out.push(h('p.arx-cd__more', { dataset: { k: 'points' }, text: `Best points: Draw 1 ${d1 === null ? '—' : d1.toLocaleString()} · Draw 3 ${d3 === null ? '—' : d3.toLocaleString()}. Points only; a game won with Show moves sets no best.` }));
    }
    if (kind !== 'spider') {
      const d = readDaily(kind), today = dayKey(), now = streakNow(kind, today);
      out.push(h('h4', { text: 'Today’s deal' }),
        h('p.arx-cd__more', { dataset: { k: 'daily' }, text: `${d.days[today] ? `Won today in ${timeText(d.days[today])}.` : 'Not won yet today.'} Streak: ${now} ${now === 1 ? 'day' : 'days'} in a row (best ${d.best}). The same deal for everyone on the same date; the streak is kept on this device.` }));
    }
    if (kind === 'freecell') {
      const list = wonDeals();
      out.push(h('h4', { text: `Deals you’ve won here (${list.length.toLocaleString()})` }),
        list.length
          ? h('div.arx-cd__won', { role: 'list', dataset: { k: 'won' } }, list.slice(0, 120).map(n => h('button.arx-cd__btn', { type: 'button', role: 'listitem', dataset: { deal: String(n) }, title: `Play deal #${n} again`,
            onclick: () => { closeStats(); deal({ deal: n }); } }, `#${n}`)))
          : h('p.arx-cd__more', { text: 'None yet. Any deal from 1 to 1,000,000 can be typed in by the Deal box.' }));
    }
    return out;
  }
  /* ---------------- the Table look (./cardlook.js) ---------------- */
  function openLook() {
    if (S.lookOpen || !st) return;
    setRunning(() => { S.lookOpen = true; });
    const card = lookCard({
      h, icon, gameHue: G.hue, paintBack: (g, w, hh, pattern, hue) => drawBack(g, w, hh, hue, pattern),
      onChange: () => { look = readLook(); sprites.clear(); orderBar(); S.anim.clear(); kick(0.2); },
      onClose: () => closeLook(),
    });
    lookLayer.replaceChildren(card.el);
    lookLayer.hidden = false;
    setTimeout(() => { if (!S.dead && S.lookOpen) card.focus(); }, 30);
  }
  function closeLook() {
    if (!S.lookOpen) return;
    setRunning(() => { S.lookOpen = false; });
    lookLayer.hidden = true;
    lookLayer.replaceChildren();
    lookBtn.focus({ preventScroll: true });
  }
  lookLayer.addEventListener('pointerdown', e => { if (e.target === lookLayer) closeLook(); });
  function closeStats() {
    if (!S.statsOpen) return;
    setRunning(() => { S.statsOpen = false; });
    statsLayer.hidden = true;
    statsLayer.replaceChildren();
    statsBtn.focus({ preventScroll: true });
  }
  statsLayer.addEventListener('pointerdown', e => { if (e.target === statsLayer) closeStats(); });

  /* ---------------- start ---------------- */
  window.addEventListener('keydown', onKey);
  sf.cv.addEventListener('pointerdown', onDown);
  sf.cv.addEventListener('pointermove', onMove);
  sf.cv.addEventListener('pointerup', onUp);
  sf.cv.addEventListener('pointercancel', onCancel);
  sf.cv.addEventListener('click', onClick);
  const hand = NEXT[kind];
  NEXT[kind] = null;
  /* the deal left unfinished last time comes back first */
  const kept = hand ? null : savedOf(kind);
  if (!kept || !resumeSaved(kept)) deal(hand ? { layout: hand, deal: hand.deal, daily: hand.daily ? dayKey() : null } : {});

  return {
    stop() {
      persist();
      S.dead = true;
      stopAuto();
      clearInterval(ticker);
      clearTimeout(S.msgTimer);
      loop.stop();
      window.removeEventListener('keydown', onKey);
      sf.cv.removeEventListener('pointerdown', onDown);
      sf.cv.removeEventListener('pointermove', onMove);
      sf.cv.removeEventListener('pointerup', onUp);
      sf.cv.removeEventListener('pointercancel', onCancel);
      sf.cv.removeEventListener('click', onClick);
      snd.close();
      sprites.clear();
      sf.destroy();
      root.remove();
    },
    pause() { if (!S.paused) setRunning(() => { S.paused = true; }); },
    resume() { if (S.paused) setRunning(() => { S.paused = false; }); kick(); },
    /* a read-only snapshot for automated play-tests (CSS px inside the canvas) */
    peek: () => {
      const L = layout(), T = targets(L);
      return {
        mount: mountId, kind, draw: st.draw, suits: st.suits, deal: st.deal, variant: variantKey(st),
        cw: L.cw, ch: L.ch,
        piles: st.P.map((p, pi) => {
          const s = slotOf(L, pi);
          return { t: p.t, i: p.i, slot: { x: s.x, y: s.y, w: L.cw, h: L.ch },
            cards: p.c.map(c => (c.up ? '' : '!') + R.codeOf(c)),
            at: p.c.map(c => { const q = T.get(c.id); return { x: q.x, y: q.y }; }) };
        }),
        moves: st.moves, time: Math.round(elapsed()), started: S.started, undo: S.hist.length,
        points: st.points || 0, daily: S.daily, shown: S.shown, show: S.show && now() - S.show.t0 < 2500 ? { ...S.show.mv } : null, undos: S.undos, undoLeft: Number.isFinite(undoLeft()) ? undoLeft() : null,
        look: { ...look }, lookOpen: S.lookOpen, saved: !!savedOf(kind), seed: st.seed,
        won: S.won, ended: S.ended, auto: !!S.auto, celebrating: !!S.celebrate, settled: !S.anim.size && !S.drag,
        kbd: S.kbd, cursor: { row: S.cur.row, i: S.cur.i, pile: curPile() }, held: S.held ? { ...S.held } : null,
        stats: readStats(),
      };
    },
  };
}

function game(kind) { return { mount: (el, ctx = {}) => mountTable(el, ctx, kind) }; }
export const klondike = game('klondike');
export const spider = game('spider');
export const freecell = game('freecell');
export { drawFace, drawBack, suitPath };   /* the other card games (Crazy Eights, Blackjack) draw cards the same way: ./cardtable.js */

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
  let armed = false;
  const fit = () => {
    const w = Math.max(1, el.clientWidth), hh = Math.max(1, el.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === s.w && hh === s.h && dpr === s.dpr) return;
    s.w = w; s.h = hh; s.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hh * dpr);
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
   front, not while typing in a field, and Space/Enter on a button (ours
   or the Arcade's) belongs to that button. */
function ownsKey(el, e) {
  if (!el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const win = el.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
    if ((e.key === ' ' || e.key === 'Enter') && t.closest('button,a,[role="button"]')) return false;
  }
  return true;
}

/* Tiny synth blips, made on the first input and closed in stop(). */
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

/* requestAnimationFrame loop with a clamped dt; start/stop. */
function looper(step) {
  let raf = 0, last = 0, on = false;
  const tick = t => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;
    step(dt, t);
  };
  return {
    start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { on = false; cancelAnimationFrame(raf); },
    get on() { return on; },
  };
}
