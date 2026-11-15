/* ============================================================
   arcade/cardlook.js — how the cards and the table look, the same in
   all five card games (Solitaire, Spider, FreeCell: ./cards.js;
   Crazy Eights, Blackjack: ./cardtable.js).

   Kept per person in store 'portal.arcadeCards' (the solitaires' own
   key) as look: { back, color, felt, big, left }:
     back   'lattice' | 'stripes' | 'dots' | 'plain'   the pattern on the back
     color  'game' | 'red' | 'blue' | 'green' | 'purple' | 'black'
            ('game' = each game's own colour, as before)
     felt   'night' | 'green' | 'blue' | 'red' | 'wood' | 'slate'
            ('night' = the dark table in the game's colour, as before)
     big    larger cards, with bigger corner letters
     left   left-handed: the stock and the buttons on the left

   lookCard({ h, icon, gameHue, feltHue?, paintBack, onChange, onClose })
   builds the Table card a game shows over its table; paintBack(g, w, h,
   back, hue) draws one back (the drawing lives with the cards,
   ./cards.js); feltHue is the hue of the game's own table, when it
   isn't the backs' (Crazy Eights).
   ============================================================ */
import { store } from '../core/store.js';

export const KEY = 'portal.arcadeCards';
export const BACKS = [
  { id: 'lattice', label: 'Lattice' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'dots', label: 'Dots' },
  { id: 'plain', label: 'Plain' },
];
/* hue: null = the game's own */
export const COLORS = [
  { id: 'game', label: 'Game colour', hue: null },
  { id: 'red', label: 'Red', hue: 352 },
  { id: 'blue', label: 'Blue', hue: 214 },
  { id: 'green', label: 'Green', hue: 145 },
  { id: 'purple', label: 'Purple', hue: 275 },
  { id: 'black', label: 'Black', hue: -1 },
];
/* a felt: the middle and the edge of the table's glow (hsl), or null = the game's own dark table */
export const FELTS = [
  { id: 'night', label: 'Night', hsl: null },
  { id: 'green', label: 'Green felt', hsl: [[140, 45, 30], [145, 55, 12]] },
  { id: 'blue', label: 'Blue felt', hsl: [[210, 45, 30], [215, 55, 11]] },
  { id: 'red', label: 'Red felt', hsl: [[355, 42, 28], [355, 50, 10]] },
  { id: 'wood', label: 'Wood', hsl: [[28, 42, 30], [22, 48, 12]] },
  { id: 'slate', label: 'Slate', hsl: [[220, 10, 26], [220, 12, 9]] },
];
const pick = (list, v, d) => (list.some(x => x.id === v) ? v : d);

const readAll = () => { const v = store.get(KEY, null); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
/** the current look, every field filled in */
export function readLook() {
  const l = readAll().look || {};
  return {
    back: pick(BACKS, l.back, 'lattice'),
    color: pick(COLORS, l.color, 'game'),
    felt: pick(FELTS, l.felt, 'night'),
    big: l.big === true,
    left: l.left === true,
  };
}
export function setLook(k, v) {
  const cur = readAll();
  store.set(KEY, { ...cur, look: { ...readLook(), ...(cur.look || {}), [k]: v } });
}
/** the back's hue for a game whose own colour is gameHue (-1 = black) */
export const backHue = (look, gameHue) => { const c = COLORS.find(x => x.id === look.color); return c && c.hue !== null ? c.hue : gameHue; };
const hslCss = ([hh, s, l]) => `hsl(${hh},${s}%,${l}%)`;
/** the felt's two colours [middle, edge] as CSS, or null for the game's own */
export function feltColors(look) {
  const f = FELTS.find(x => x.id === look.felt);
  return f?.hsl ? f.hsl.map(hslCss) : null;
}

/**
 * The Table card: back pattern (drawn previews), back colour, felt,
 * larger cards, left-handed. Every change is saved at once and reported
 * through onChange(key, value) so the game redraws; Esc or Done closes.
 */
export function lookCard({ h, icon, gameHue, feltHue = gameHue, paintBack, onChange, onClose }) {
  let L = readLook();
  const set = (k, v) => { setLook(k, v); L = readLook(); onChange?.(k, v); paint(); };
  const backBtns = BACKS.map(b => {
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 78;
    cv.style.cssText = 'width:28px;height:39px;display:block';
    return h('button.arx-lk__opt', { type: 'button', dataset: { back: b.id }, onclick: () => set('back', b.id), title: b.label }, cv, h('span', { text: b.label }));
  });
  const colorBtns = COLORS.map(c => h('button.arx-lk__sw', { type: 'button', dataset: { color: c.id }, onclick: () => set('color', c.id), title: c.label, 'aria-label': c.label },
    h('span', { style: { background: c.hue === null ? `hsl(${gameHue},62%,34%)` : c.hue < 0 ? '#1d1d24' : `hsl(${c.hue},62%,34%)` } })));
  /* the Night swatch shows the game's own dark table (its hue can differ from the backs': Crazy Eights) */
  const own = [[feltHue, 38, 17], [feltHue, 45, 6]];
  const feltBtns = FELTS.map(f => h('button.arx-lk__sw', { type: 'button', dataset: { felt: f.id }, onclick: () => set('felt', f.id), title: f.label, 'aria-label': f.label },
    h('span', { style: { background: `radial-gradient(circle at 50% 40%, ${hslCss((f.hsl || own)[0])}, ${hslCss((f.hsl || own)[1])})` } })));
  const chk = (k, label, note) => h('label.arx-lk__chk', h('input', { type: 'checkbox', dataset: { look: k }, onchange: e => set(k, e.target.checked) }),
    h('span', h('span', { text: label }), h('small', { text: note })));
  const bigChk = chk('big', 'Larger cards', 'Bigger cards and corner letters, where the table has room');
  const leftChk = chk('left', 'Left-handed', 'The stock and the buttons on the left');
  const done = h('button.arc-ov__btn.is-primary', { type: 'button', onclick: () => onClose?.() }, h('span', { text: 'Done' }));
  function paint() {
    backBtns.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(BACKS[i].id === L.back));
      const cv = b.querySelector('canvas'), g = cv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.scale(2, 2);
      paintBack(g, 28, 39, BACKS[i].id, backHue(L, gameHue));
    });
    colorBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i].id === L.color)));
    feltBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(FELTS[i].id === L.felt)));
    bigChk.querySelector('input').checked = L.big;
    leftChk.querySelector('input').checked = L.left;
  }
  const el = h('div.arc-ov__card.arx-lk', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Table and cards' },
    h('style', { text: LOOK_CSS }),
    h('h3', { text: 'Table and cards' }),
    h('div.arx-lk__lab', { text: 'Card back' }), h('div.arx-lk__row', { role: 'group', 'aria-label': 'Card back' }, backBtns),
    h('div.arx-lk__lab', { text: 'Back colour' }), h('div.arx-lk__row', { role: 'group', 'aria-label': 'Back colour' }, colorBtns),
    h('div.arx-lk__lab', { text: 'Table' }), h('div.arx-lk__row', { role: 'group', 'aria-label': 'Table' }, feltBtns),
    bigChk, leftChk,
    h('p.arx-lk__note', { text: 'The same in all five card games, on this device.' }),
    h('div.arc-ov__row', done));
  el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } });
  paint();
  return { el, focus: () => (el.querySelector('[aria-pressed="true"]') || done).focus({ preventScroll: true }) };
}

const LOOK_CSS = `
.arx-lk{width:min(400px,100%);max-height:100%;overflow:auto;align-items:stretch;text-align:left;gap:6px}
.arx-lk h3{margin:0 0 2px;font-size:var(--fs-15,15px);color:var(--ink-0,#fff)}
.arx-lk__lab{font-size:var(--fs-11,11px);font-weight:650;color:var(--ink-3,#888);text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.arx-lk__row{display:flex;flex-wrap:wrap;gap:6px}
.arx-lk__opt{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 8px 5px;border-radius:10px;border:1px solid var(--line-1,rgba(255,255,255,.1));background:var(--fill-0,rgba(255,255,255,.03));
  color:var(--ink-2,#aaa);font:600 var(--fs-11,11px)/1 var(--font,system-ui);cursor:pointer}
.arx-lk__sw{width:34px;height:34px;padding:3px;border-radius:50%;border:1px solid var(--line-1,rgba(255,255,255,.1));background:none;cursor:pointer}
.arx-lk__sw span{display:block;width:100%;height:100%;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.4)}
.arx-lk__opt[aria-pressed="true"],.arx-lk__sw[aria-pressed="true"]{border-color:hsl(var(--h,200) 90% 66%);box-shadow:0 0 0 2px hsl(var(--h,200) 90% 60% / .45);color:var(--ink-0,#fff)}
.arx-lk__opt:focus-visible,.arx-lk__sw:focus-visible,.arx-lk__chk input:focus-visible{outline:2px solid hsl(var(--h,200) 100% 72%);outline-offset:2px}
.arx-lk__chk{display:flex;align-items:flex-start;gap:9px;padding:5px 2px;font-size:var(--fs-13,13px);color:var(--ink-1,#ddd);cursor:pointer}
.arx-lk__chk input{margin:2px 0 0;width:16px;height:16px;accent-color:hsl(var(--h,200) 90% 60%)}
.arx-lk__chk small{display:block;color:var(--ink-3,#888);font-size:var(--fs-11,11px);margin-top:2px}
.arx-lk__note{margin:2px 0 0;font-size:var(--fs-11,11px);color:var(--ink-3,#888)}
`;

export default { KEY, BACKS, COLORS, FELTS, readLook, setLook, backHue, feltColors, lookCard };
