/* ============================================================
   arcade/cardtable.js — card pictures for the card games that are not
   the solitaires (Crazy Eights, Blackjack). The faces and backs are
   the ones Solitaire, Spider and FreeCell draw (./cards.js); this only
   adds a size-keyed sprite cache and a few table helpers.

     const book = cardBook(dprGetter);
     book.face(card, w, h) -> canvas     book.back(w, h, hue) -> canvas
     book.clear()                        (when the size or DPR changes)
     SUIT_GLYPHS · suitColor(s)          '♣♦♥♠' and the ink for each
   ============================================================ */
import { drawFace, drawBack, suitPath } from './cards.js';

export const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];
export const suitColor = s => (s === 1 || s === 2 ? '#c8102e' : '#15151c');

export function cardBook(getDpr) {
  const m = new Map();
  const make = (key, w, h, fn) => {
    const dpr = getDpr();
    const k = `${key}|${w}|${h}|${dpr}`;
    let s = m.get(k);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(w * dpr));
    s.height = Math.max(1, Math.round(h * dpr));
    const g = s.getContext('2d');
    g.scale(dpr, dpr);
    fn(g);
    m.set(k, s);
    return s;
  };
  return {
    face: (c, w, h) => make(`f${c.r}.${c.s}`, w, h, g => drawFace(g, w, h, c.r, c.s)),
    back: (w, h, hue = 350) => make(`b${hue}`, w, h, g => drawBack(g, w, h, hue)),
    clear: () => m.clear(),
  };
}

/** a suit shape, filled, centred on (x, y) with the given size */
export function drawSuit(g, s, x, y, size, ink = suitColor(s)) {
  g.save();
  g.fillStyle = ink;
  suitPath(g, s, x, y, size);
  g.fill('nonzero');
  g.restore();
}

export default { cardBook, drawSuit, SUIT_GLYPHS, suitColor };
