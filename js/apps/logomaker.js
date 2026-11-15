/* ============================================================
   logomaker.js — Logo maker: shapes and text on a square, saved as
   SVG or PNG.

   A logo is a list of layers on a 512x512 canvas: rectangle, ellipse,
   triangle, star, ring and text. Click a layer (on the canvas or in the
   Layers list) to change its colour, outline, size, turn and text; drag it
   to move it, or use the arrow keys (Shift: ten at a time). The
   background is a colour or clear.

   The picture is plain SVG built by logoSvg() — every colour is checked as
   a #rrggbb code, every number is clamped, fonts come from a short list and
   text is escaped — so what you see, what is saved as .svg and what is
   drawn into the .png are one string. Text uses the fonts every computer
   has; an SVG opened somewhere without one falls back to a similar face.
   Saved to ~/Pictures/Logos. The work in progress is kept as a draft
   (store key 'portal.logomaker').
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { saveBlob } from '../photos/pt-common.js';
import { makerCss, clamp, stemName } from '../core/makerkit.js';

makerCss();
const KEY = 'portal.logomaker';
const SIZE = 512;
export const FONTS = {
  Sans: 'Helvetica, Arial, sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Rounded: '"Trebuchet MS", Verdana, sans-serif',
  Mono: '"Courier New", monospace',
  Display: 'Impact, "Arial Black", sans-serif',
};
const KINDS = ['rect', 'ellipse', 'triangle', 'star', 'ring', 'text'];
const LABEL = { rect: 'Square', ellipse: 'Circle', triangle: 'Triangle', star: 'Star', ring: 'Ring', text: 'Text' };
const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const num = (v, d, a, b) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, a, b) : d);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let seq = 0;
const uid = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Make any value into a layer the editor can draw (used for drafts as well as new layers). */
export function cleanLayer(l) {
  l = l && typeof l === 'object' ? l : {};
  const type = KINDS.includes(l.type) ? l.type : 'rect';
  return {
    id: typeof l.id === 'string' && /^[\w-]{1,24}$/.test(l.id) ? l.id : uid(), type,
    x: num(l.x, 256, -256, 768), y: num(l.y, 256, -256, 768),
    w: num(l.w, 160, 8, 1024), h: num(l.h, 160, 8, 1024), rot: num(l.rot, 0, -360, 360),
    fill: hexOr(l.fill, '#e5484d'), stroke: hexOr(l.stroke, '#ffffff'), sw: num(l.sw, 0, 0, 60),
    text: typeof l.text === 'string' ? l.text.slice(0, 40) : 'Logo',
    font: FONTS[l.font] ? l.font : 'Sans', bold: l.bold === undefined ? type === 'text' : !!l.bold,
  };
}
export function cleanDoc(d) {
  d = d && typeof d === 'object' ? d : {};
  return { bg: d.bg === null ? null : hexOr(d.bg, '#14161c'), name: stemName(d.name, 'My logo'), layers: (Array.isArray(d.layers) ? d.layers : []).slice(0, 60).map(cleanLayer) };
}

const starPoints = (rx, ry) => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.4 : 1;
    p.push(`${+(Math.cos(a) * rx * r).toFixed(2)},${+(Math.sin(a) * ry * r).toFixed(2)}`);
  }
  return p.join(' ');
};

/** One layer as an SVG element (a string). */
function layerSvg(l) {
  const paint = `fill="${l.fill}"` + (l.sw ? ` stroke="${l.stroke}" stroke-width="${l.sw}" stroke-linejoin="round"` : '');
  const tf = `translate(${l.x} ${l.y})` + (l.rot ? ` rotate(${l.rot})` : '');
  const hw = l.w / 2, hh = l.h / 2;
  let shape;
  if (l.type === 'rect') shape = `<rect x="${-hw}" y="${-hh}" width="${l.w}" height="${l.h}" rx="${Math.min(hw, hh) * 0.12}" ${paint}/>`;
  else if (l.type === 'ellipse') shape = `<ellipse rx="${hw}" ry="${hh}" ${paint}/>`;
  else if (l.type === 'triangle') shape = `<polygon points="0,${-hh} ${hw},${hh} ${-hw},${hh}" ${paint} stroke-linejoin="round"/>`;
  else if (l.type === 'star') shape = `<polygon points="${starPoints(hw, hh)}" ${paint}/>`;
  else if (l.type === 'ring') {
    const t = Math.max(4, Math.min(hw, hh) * 0.28);
    shape = `<ellipse rx="${Math.max(1, hw - t / 2)}" ry="${Math.max(1, hh - t / 2)}" fill="none" stroke="${l.fill}" stroke-width="${t}"/>`;
  } else {
    shape = `<text text-anchor="middle" dominant-baseline="central" font-family="${esc(FONTS[l.font])}" font-size="${l.h}" font-weight="${l.bold ? 700 : 400}" ${paint}>${esc(l.text)}</text>`;
  }
  return `<g data-id="${l.id}" transform="${tf}">${shape}</g>`;
}
/** The whole logo as an SVG document (a string). `px` sets the width and height it is saved at. */
export function logoSvg(doc, px = SIZE) {
  const d = cleanDoc(doc);
  const bg = d.bg ? `<rect width="${SIZE}" height="${SIZE}" fill="${d.bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${px}" height="${px}">${bg}${d.layers.map(layerSvg).join('')}</svg>`;
}

const TEMPLATES = {
  'Badge': () => ({ bg: '#14161c', layers: [
    { type: 'ellipse', x: 256, y: 256, w: 400, h: 400, fill: '#f5a524' }, { type: 'ellipse', x: 256, y: 256, w: 340, h: 340, fill: '#14161c' },
    { type: 'star', x: 256, y: 200, w: 110, h: 110, fill: '#f5a524' }, { type: 'text', text: 'STUDIO', x: 256, y: 320, w: 100, h: 56, fill: '#f6eef1', font: 'Display' }] }),
  'Monogram': () => ({ bg: '#f6eef1', layers: [
    { type: 'rect', x: 256, y: 256, w: 330, h: 330, fill: '#3b82f6', rot: 12 }, { type: 'text', text: 'A', x: 256, y: 262, w: 100, h: 230, fill: '#ffffff', font: 'Serif' }] }),
  'Sunrise': () => ({ bg: '#1b1b1f', layers: [
    { type: 'ellipse', x: 256, y: 290, w: 280, h: 280, fill: '#f7d531' }, { type: 'rect', x: 256, y: 400, w: 512, h: 224, fill: '#1b1b1f' },
    { type: 'ring', x: 256, y: 290, w: 380, h: 380, fill: '#e5484d' }, { type: 'text', text: 'Sunrise', x: 256, y: 420, w: 100, h: 64, fill: '#ffffff', font: 'Rounded' }] }),
};

const SWATCH = ['#e5484d', '#f5a524', '#f7d531', '#3dd68c', '#3b82f6', '#8b5cf6', '#ffffff', '#14161c'];

defineApp({
  id: 'logomaker',
  name: 'Logo maker',
  icon: 'star',
  g1: '#7ad6ff', g2: '#6a5cff',
  category: 'Create',
  keywords: ['logo', 'badge', 'svg', 'shapes', 'text', 'icon maker', 'brand', 'monogram', 'vector', 'emblem', 'design'],
  desc: 'Put shapes and text together and save the logo as SVG or PNG',
  singleton: true,
  win: { w: 940, h: 660, minW: 640, minH: 480 },
  shortcuts: [
    ['← / ↑ / → / ↓', 'Move the chosen layer (Shift: 10 at a time)'], ['Delete', 'Remove the chosen layer'],
    ['Ctrl+D', 'Copy the chosen layer'], ['[ / ]', 'Send back / bring forward'], ['Tab', 'Next control'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store } = api;

    let doc = cleanDoc(store.get(KEY) || TEMPLATES.Badge());
    let sel = null, drag = null, msg = '', timer = 0, dead = false;
    const layerOf = id => doc.layers.find(l => l.id === id);
    const cur = () => layerOf(sel);

    const stage = h('svg.mk-logo', { viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-label': 'Logo canvas' });
    function paint() {
      stage.innerHTML = logoSvg(doc).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
      stage.style.background = doc.bg || '';
      stage.classList.toggle('is-clear', !doc.bg);
      const l = cur();
      if (l) {
        const g = stage.querySelector(`g[data-id="${l.id}"]`);
        if (g) { const b = g.getBBox(); const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('class', 'mk-logo__sel'); r.setAttribute('x', b.x - 3); r.setAttribute('y', b.y - 3); r.setAttribute('width', b.width + 6); r.setAttribute('height', b.height + 6); g.appendChild(r); }
      }
    }
    const touch = () => { paint(); paintLayers(); clearTimeout(timer); timer = setTimeout(() => { if (!dead) store.set(KEY, doc); }, 500); };
    const say = t => { msg = t; note.textContent = t; };

    /* ---------- the canvas: click to choose, drag to move ---------- */
    const toLogo = e => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) * SIZE / r.width, (e.clientY - r.top) * SIZE / r.height]; };
    stage.addEventListener('pointerdown', e => {
      const g = e.target.closest?.('g[data-id]');
      choose(g ? g.dataset.id : null);
      if (!g) return;
      const [px, py] = toLogo(e), l = cur();
      drag = { dx: l.x - px, dy: l.y - py };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      e.preventDefault();
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const [px, py] = toLogo(e), l = cur();
      l.x = clamp(Math.round(px + drag.dx), -256, 768); l.y = clamp(Math.round(py + drag.dy), -256, 768);
      paint(); syncProps();
    });
    const drop = () => { if (drag) { drag = null; touch(); } };
    stage.addEventListener('pointerup', drop);
    stage.addEventListener('pointercancel', drop);

    /* ---------- layers ---------- */
    function add(type) {
      if (doc.layers.length >= 60) return say('That is plenty of layers. Remove one first.');
      const l = cleanLayer({ type, x: 256, y: 256, w: type === 'text' ? 100 : 160, h: type === 'text' ? 72 : 160, fill: type === 'text' ? '#ffffff' : SWATCH[doc.layers.length % 6] });
      doc.layers.push(l); sel = l.id; touch(); syncProps();
    }
    function choose(id) { sel = id; paint(); paintLayers(); syncProps(); }
    function remove() { const l = cur(); if (!l) return; doc.layers = doc.layers.filter(x => x !== l); sel = null; touch(); syncProps(); }
    function copy() { const l = cur(); if (!l) return; const c = cleanLayer({ ...l, id: null, x: l.x + 20, y: l.y + 20 }); doc.layers.splice(doc.layers.indexOf(l) + 1, 0, c); sel = c.id; touch(); syncProps(); }
    function order(by) {
      const l = cur(); if (!l) return;
      const i = doc.layers.indexOf(l), j = clamp(i + by, 0, doc.layers.length - 1);
      doc.layers.splice(i, 1); doc.layers.splice(j, 0, l); touch();
    }
    const list = h('div.mk-layers', { role: 'listbox', 'aria-label': 'Layers, front first' });
    function paintLayers() {
      list.replaceChildren(...[...doc.layers].reverse().map(l => h('button.mk-layer', {
        type: 'button', role: 'option', 'aria-selected': String(l.id === sel), class: l.id === sel ? 'is-on' : null, dataset: { id: l.id },
        onclick: () => choose(l.id),
      }, h('i', { style: { background: l.fill } }), h('span', { text: l.type === 'text' ? `Text: ${l.text}` : LABEL[l.type] }))));
      if (!doc.layers.length) list.replaceChildren(h('small.mk-hint', { text: 'No layers yet. Add a shape or some text.' }));
    }

    /* ---------- properties ---------- */
    const P = {};
    const field = (name, label, el) => { P[name] = el; return h('label.mk-lbl', label, el); };
    const numIn = (name, label, min, max) => field(name, label, h('input', { type: 'number', min: String(min), max: String(max), 'aria-label': label, onchange: e => setProp(name, e.target.value) }));
    const colIn = (name, label) => field(name, label, h('input', { type: 'color', 'aria-label': label, oninput: e => setProp(name, e.target.value) }));
    function setProp(k, v) {
      const l = cur(); if (!l) return;
      l[k] = v; Object.assign(l, cleanLayer(l)); touch(); syncProps();
    }
    const props = h('div.mk-props',
      numIn('x', 'Across', -256, 768), numIn('y', 'Down', -256, 768), numIn('w', 'Width', 8, 1024), numIn('h', 'Height', 8, 1024), numIn('rot', 'Turn', -360, 360),
      colIn('fill', 'Colour'), colIn('stroke', 'Outline'), numIn('sw', 'Outline size', 0, 60),
      field('text', 'Text', h('input', { type: 'text', maxlength: '40', 'aria-label': 'Text', oninput: e => setProp('text', e.target.value) })),
      field('font', 'Font', h('select', { 'aria-label': 'Font', onchange: e => setProp('font', e.target.value) }, ...Object.keys(FONTS).map(f => h('option', { value: f, text: f })))),
      field('bold', 'Bold', h('input', { type: 'checkbox', 'aria-label': 'Bold', onchange: e => setProp('bold', e.target.checked) })));
    function syncProps() {
      const l = cur();
      props.hidden = !l;
      if (!l) return;
      for (const k of ['x', 'y', 'w', 'h', 'rot', 'sw', 'fill', 'stroke', 'text', 'font']) if (document.activeElement !== P[k]) P[k].value = l[k];
      P.bold.checked = !!l.bold;
      for (const k of ['text', 'font', 'bold']) P[k].closest('label').hidden = l.type !== 'text';
      P.stroke.closest('label').hidden = l.type === 'ring'; P.sw.closest('label').hidden = l.type === 'ring';
    }

    /* ---------- background, templates, saving ---------- */
    const bgIn = h('input', { type: 'color', value: doc.bg || '#14161c', 'aria-label': 'Background colour', oninput: e => { doc.bg = e.target.value; clearBox.checked = false; touch(); } });
    const clearBox = h('input', { type: 'checkbox', checked: !doc.bg, 'aria-label': 'Clear background', onchange: e => { doc.bg = e.target.checked ? null : bgIn.value; touch(); } });
    const nameIn = h('input', { type: 'text', value: doc.name, maxlength: '40', 'aria-label': 'Logo name', oninput: e => { doc.name = stemName(e.target.value, 'My logo'); touch(); } });
    const note = h('small.mk-msg', { role: 'status', 'aria-live': 'polite' });

    async function saveSvg() {
      try {
        const blob = new Blob([logoSvg(doc)], { type: 'image/svg+xml' });
        const path = await saveBlob(api, 'Logo maker', `${api.vfs.HOME}/Pictures/Logos`, `${doc.name}.svg`, blob, { title: 'Logo saved', icon: 'star' });
        say(`Saved ${path.split('/').pop()}.`);
      } catch (err) { say('Couldn’t save the SVG: ' + err.message); }
    }
    async function savePng() {
      try {
        const px = 1024;
        const url = URL.createObjectURL(new Blob([logoSvg(doc, px)], { type: 'image/svg+xml' }));
        const img = new Image(); img.src = url;
        try { await img.decode(); } finally { URL.revokeObjectURL(url); }
        const c = document.createElement('canvas'); c.width = c.height = px;
        c.getContext('2d').drawImage(img, 0, 0, px, px);
        const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('The picture could not be made.'))), 'image/png'));
        const path = await saveBlob(api, 'Logo maker', `${api.vfs.HOME}/Pictures/Logos`, `${doc.name}.png`, blob, { title: 'Logo saved', icon: 'star' });
        say(`Saved ${path.split('/').pop()} (${px} × ${px}).`);
      } catch (err) { say('Couldn’t save the PNG: ' + err.message); }
    }
    function useTemplate(name) {
      doc = cleanDoc({ ...TEMPLATES[name](), name: doc.name }); sel = null;
      bgIn.value = doc.bg || '#14161c'; clearBox.checked = !doc.bg; touch(); syncProps(); say(`Started from “${name}”. Your last logo is replaced.`);
    }
    const btn = (label, ic, fn, extra = {}) => h('button.btn.btn--sm', { type: 'button', onclick: fn, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));

    root.classList.add('mk');
    root.replaceChildren(h('div.mk-main',
      h('div.mk-stage', h('div.mk-paper.mk-paper--sq', stage)),
      h('div.mk-side',
        h('div.mk-group', h('b.label', { text: 'Add' }), h('div.mk-row', ...KINDS.map(k => btn(LABEL[k], null, () => add(k), { dataset: { add: k } })))),
        h('div.mk-group', h('b.label', { text: 'Layers' }), list,
          h('div.mk-row', btn('Copy', 'copy', copy, { title: 'Copy (Ctrl+D)' }), btn('Back', 'arrow-down', () => order(-1), { title: 'Send back ([)' }), btn('Forward', 'arrow-up', () => order(1), { title: 'Bring forward (])' }), btn('Delete', 'trash', remove, { title: 'Delete' }))),
        props,
        h('div.mk-group', h('b.label', { text: 'Canvas' }), h('div.mk-row', h('label.mk-lbl', 'Background', bgIn), h('label.mk-lbl', 'Clear', clearBox)),
          h('label.mk-lbl', 'Start from', h('select', { 'aria-label': 'Start from a template', onchange: e => { if (e.target.value) useTemplate(e.target.value); e.target.value = ''; } }, h('option', { value: '', text: 'Pick a template…' }), ...Object.keys(TEMPLATES).map(t => h('option', { value: t, text: t }))))),
        h('div.mk-group', h('b.label', { text: 'Save' }), h('label.mk-lbl', 'Name', nameIn), h('div.mk-row', btn('Save SVG', 'download', saveSvg), btn('Save PNG', 'image', savePng)), note))));

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const t = document.activeElement, tag = t && t.tagName;
      if (tag === 'INPUT' && t.type !== 'color' && t.type !== 'checkbox') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      const l = cur();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { if (l) { e.preventDefault(); copy(); } return; }
      if (e.metaKey || e.ctrlKey || e.altKey || !l) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') l.x = clamp(l.x - step, -256, 768);
      else if (e.key === 'ArrowRight') l.x = clamp(l.x + step, -256, 768);
      else if (e.key === 'ArrowUp') l.y = clamp(l.y - step, -256, 768);
      else if (e.key === 'ArrowDown') l.y = clamp(l.y + step, -256, 768);
      else if (e.key === 'Delete' || e.key === 'Backspace') return void (e.preventDefault(), remove());
      else if (e.key === '[') return void (e.preventDefault(), order(-1));
      else if (e.key === ']') return void (e.preventDefault(), order(1));
      else return;
      e.preventDefault(); touch(); syncProps();
    };
    window.addEventListener('keydown', onKey);

    paint(); paintLayers(); syncProps();
    if (!store.get(KEY)) store.set(KEY, doc);

    return () => { dead = true; clearTimeout(timer); store.set(KEY, doc); window.removeEventListener('keydown', onKey); };
  },
});
