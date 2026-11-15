/* ============================================================
   slidesdraw.js — a deck, its themes, and one drawing routine.

   Static Slides draws every slide with drawSlide(): the editor's preview and
   thumbnails, the full screen show, the presenter view and the PDF export all
   come from it, so what you see is what is shown and what is printed.

     DECK     { v: 1, title, theme, slides: [slide] }
     slide    { layout: 'title' | 'bullets' | 'picture', title, body, notes, img }
                body  text, one line per row; a row that starts with "- " or "* " is a bullet
                img   a path in Files (a picture), for the 'picture' layout
     newDeck(title), newSlide(layout), parseDeck(text) / stringifyDeck(deck)
     THEMES, themeOf(id)
     drawSlide(ctx, slide, deck, { w, h, n, total, images })  -> draws at w x h pixels
        images: Map(path -> an image that has loaded), looked up for the 'picture' layout

   A slide is 1280 x 720 in its own units and is scaled to whatever w x h it is
   drawn at. Text that would run off the slide is made smaller (down to a limit),
   never cut off silently: past the limit it is clipped at the slide's edge.
   ============================================================ */

export const W0 = 1280, H0 = 720;
export const LAYOUTS = [['title', 'Title'], ['bullets', 'Title and text'], ['picture', 'Title and picture']];

const SANS = '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

/* each theme: a background (one colour, or two for a diagonal fade), the title and text colours, an accent for the
   bar and bullets, and a typeface */
export const THEMES = [
  { id: 'paper',  name: 'Paper',  bg: ['#ffffff'],            title: '#17202e', text: '#2c3648', accent: '#2f6fed', font: SANS },
  { id: 'night',  name: 'Night',  bg: ['#10131c', '#1c2336'], title: '#f4f6fb', text: '#c9d0e0', accent: '#7aa2ff', font: SANS },
  { id: 'ocean',  name: 'Ocean',  bg: ['#0b3c5d', '#0f6b8a'], title: '#ffffff', text: '#dff3fa', accent: '#ffd166', font: SANS },
  { id: 'sunset', name: 'Sunset', bg: ['#3a1c4a', '#c2410c'], title: '#fff7ed', text: '#fde4cf', accent: '#fbbf24', font: SANS },
  { id: 'forest', name: 'Forest', bg: ['#f2f7ee'],            title: '#1f3d2b', text: '#33493a', accent: '#3f8f4f', font: SERIF },
  { id: 'mono',   name: 'Mono',   bg: ['#f1f1ee'],            title: '#111111', text: '#333333', accent: '#111111', font: SERIF },
];
export const themeOf = id => THEMES.find(t => t.id === id) || THEMES[0];

export const newSlide = (layout = 'bullets') => ({ layout, title: '', body: '', notes: '', img: '' });
export function newDeck(title = 'Untitled slides') {
  return {
    v: 1, title, theme: 'paper',
    slides: [
      { layout: 'title', title, body: 'Your name', notes: 'Welcome everyone. Say what this talk is about in one sentence.', img: '' },
      { layout: 'bullets', title: 'First point', body: '- One idea per slide\n- Keep each line short\n- Say the rest out loud', notes: 'Notes show only in the presenter view.', img: '' },
    ],
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
/** A deck from a file's text. Throws Error with a plain sentence when it isn't one. */
export function parseDeck(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error('This file isn’t a Slides deck: it can’t be read.'); }
  if (!d || typeof d !== 'object' || !Array.isArray(d.slides)) throw new Error('This file isn’t a Slides deck: it has no slides in it.');
  const slides = d.slides.slice(0, 300).map(s => ({
    layout: LAYOUTS.some(l => l[0] === (s && s.layout)) ? s.layout : 'bullets',
    title: str(s && s.title, 300), body: str(s && s.body, 6000), notes: str(s && s.notes, 6000), img: str(s && s.img, 500),
  }));
  if (!slides.length) slides.push(newSlide('title'));
  return { v: 1, title: str(d.title, 200) || 'Untitled slides', theme: themeOf(d.theme).id, slides };
}
export const stringifyDeck = deck => JSON.stringify({ v: 1, title: deck.title, theme: deck.theme, slides: deck.slides }, null, 1);

/* ---- text layout ---- */
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/** Lay the body rows out at one size: [{ text, bullet }] wrapped, and the height they take. */
function layoutBody(ctx, body, size, maxW, lineK) {
  ctx.font = `${size}px ${ctx.__family}`;
  const rows = [];
  for (const raw of String(body).split('\n')) {
    const m = /^\s*[-*•]\s+(.*)$/.exec(raw);
    const text = m ? m[1] : raw;
    const indent = m ? size * 1.1 : 0;
    const lines = wrap(ctx, text, maxW - indent);
    lines.forEach((ln, i) => rows.push({ text: ln, bullet: !!m && i === 0, indent, gap: i === 0 ? size * 0.35 : 0 }));
  }
  const h = rows.reduce((a, r) => a + size * lineK + r.gap, 0);
  return { rows, h };
}

function fitBody(ctx, body, maxW, maxH, from, to) {
  for (let size = from; size >= to; size -= 2) {
    const L = layoutBody(ctx, body, size, maxW, 1.25);
    if (L.h <= maxH) return { ...L, size };
  }
  return { ...layoutBody(ctx, body, to, maxW, 1.25), size: to };
}

function fillBg(ctx, theme, w, h) {
  if (theme.bg.length > 1) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, theme.bg[0]); g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
  } else ctx.fillStyle = theme.bg[0];
  ctx.fillRect(0, 0, w, h);
}

export function drawSlide(ctx, slide, deck, { w = W0, h = H0, n = 0, total = 0, images = new Map() } = {}) {
  const theme = themeOf(deck && deck.theme);
  const k = w / W0;
  ctx.save();
  ctx.setTransform(k, 0, 0, h / H0, 0, 0);
  ctx.beginPath(); ctx.rect(0, 0, W0, H0); ctx.clip();
  ctx.__family = theme.font;
  fillBg(ctx, theme, W0, H0);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  if (slide.layout === 'title') {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(W0 / 2 - 60, 300, 120, 6);
    ctx.fillStyle = theme.title; ctx.textAlign = 'center';
    let size = 84, lines;
    for (; size >= 36; size -= 4) { ctx.font = `700 ${size}px ${theme.font}`; lines = wrap(ctx, slide.title || ' ', 1040); if (lines.length * size * 1.15 <= 240) break; }
    const top = 280 - (lines.length - 1) * size * 1.15;
    lines.forEach((ln, i) => ctx.fillText(ln, W0 / 2, top + i * size * 1.15));
    ctx.fillStyle = theme.text; ctx.font = `400 36px ${theme.font}`;
    const sub = wrap(ctx, slide.body.replace(/^\s*[-*•]\s+/gm, ''), 1000).slice(0, 4);
    sub.forEach((ln, i) => ctx.fillText(ln, W0 / 2, 380 + i * 48));
  } else {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(0, 0, 14, H0);
    ctx.fillStyle = theme.title;
    let size = 60, lines;
    for (; size >= 32; size -= 4) { ctx.font = `700 ${size}px ${theme.font}`; lines = wrap(ctx, slide.title || ' ', 1100); if (lines.length <= 2) break; }
    lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, 80, 110 + i * size * 1.15));
    const top = 110 + (Math.min(lines.length, 2) - 1) * size * 1.15 + 50;
    ctx.fillStyle = theme.text;
    if (slide.layout === 'bullets') {
      const L = fitBody(ctx, slide.body, 1120, H0 - top - 80, 38, 18);
      ctx.font = `400 ${L.size}px ${theme.font}`;
      let y = top + L.size;
      for (const r of L.rows) {
        y += r.gap;
        if (r.bullet) { ctx.fillStyle = theme.accent; ctx.beginPath(); ctx.arc(86 + L.size * 0.18, y - L.size * 0.3, L.size * 0.13, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = theme.text; }
        ctx.fillText(r.text, 80 + r.indent, y);
        y += L.size * 1.25;
      }
    } else {                                                  /* picture */
      const img = images.get(slide.img);
      const boxX = 80, boxY = top, boxW = 1120, boxH = H0 - top - (slide.body.trim() ? 130 : 70);
      if (img && img.width) {
        const s = Math.min(boxW / img.width, boxH / img.height);
        const iw = img.width * s, ih = img.height * s;
        ctx.drawImage(img, boxX + (boxW - iw) / 2, boxY + (boxH - ih) / 2, iw, ih);
      } else {
        ctx.strokeStyle = theme.accent; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
        ctx.strokeRect(boxX, boxY, boxW, boxH); ctx.setLineDash([]);
        ctx.fillStyle = theme.text; ctx.textAlign = 'center'; ctx.font = `400 32px ${theme.font}`;
        ctx.fillText(slide.img ? 'This picture can’t be found in Files' : 'Choose a picture in the editor', boxX + boxW / 2, boxY + boxH / 2);
        ctx.textAlign = 'left';
      }
      if (slide.body.trim()) {
        ctx.fillStyle = theme.text; ctx.textAlign = 'center'; ctx.font = `italic 400 30px ${theme.font}`;
        wrap(ctx, slide.body.replace(/^\s*[-*•]\s+/gm, ''), 1100).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W0 / 2, H0 - 70 + i * 38));
        ctx.textAlign = 'left';
      }
    }
  }
  if (total > 0 && slide.layout !== 'title') {
    ctx.fillStyle = theme.text; ctx.globalAlpha = 0.6; ctx.font = `400 24px ${theme.font}`; ctx.textAlign = 'right';
    ctx.fillText(`${n} / ${total}`, W0 - 40, H0 - 30);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export default { THEMES, themeOf, LAYOUTS, newDeck, newSlide, parseDeck, stringifyDeck, drawSlide, W0, H0 };
