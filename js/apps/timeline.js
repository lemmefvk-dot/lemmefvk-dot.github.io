/* ============================================================
   timeline.js — Timeline: dated events on a line you scroll along.

   Add an event with a title and a date; the line lays them out in order
   and spreads the cards above and below so none overlap. Dates are written
   the way a history book writes them (core/timeline.js reads them):
     1066     14 Oct 1066     October 1066     44 BCE     c. 1500
   and a period with a dash: 1914–1918, 431–404 BCE, 500 BCE to 400 CE.
   There is no year 0 (1 BCE is followed by 1 CE) and the line is continuous
   across the two eras; BCE years are labelled on the axis.

   Zoom in for months, out for centuries. Click an event (or Tab to it and
   press Enter) to change or remove it; Left and Right move between events
   in date order.
     Ctrl+Z / Ctrl+Shift+Z undo, redo      Ctrl+S save      + −  zoom

   A timeline is a file: ~/Documents/<name>.timeline (JSON). PNG and SVG
   export the whole line as a picture into ~/Pictures; To Notes writes the
   events as a list into Notes so it can sit beside a study sheet.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import { parseSpan, formatSpan, formatDate, layout as lay, pos } from '../core/timeline.js';
import { saveDoc, exportSvg, exportPng, readText } from '../core/diagramout.js';
import * as NF from '../core/notesfmt.js';

export const COLORS = ['#9fb6ff', '#ff9db0', '#ffc58a', '#ffe27a', '#9be3b0', '#8fd6f0', '#d2aaff', '#e3e7f2'];
const COLOR_NAMES = ['Blue', 'Rose', 'Orange', 'Yellow', 'Green', 'Cyan', 'Violet', 'Grey'];
const FONT = '600 13px Inter, system-ui, sans-serif';
const INK = '#1d1a26', AXIS = '#4a4a5a';
const PPY_MIN = 0.005, PPY_MAX = 800;

let mctx = null;
const textW = t => { mctx = mctx || document.createElement('canvas').getContext('2d'); mctx.font = FONT; return mctx.measureText(t).width; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (t, w) => { if (textW(t) <= w) return t; let s = t; while (s.length > 1 && textW(s + '…') > w) s = s.slice(0, -1); return s + '…'; };
const r1 = n => Math.round(n * 10) / 10;

/** the line as standalone SVG markup; `sel` is the selected event's id (on screen only) */
export function drawing(events, L, title, { sel = null, ids = false } = {}) {
  const byId = new Map(events.map(e => [e.id, e]));
  const parts = [];
  if (title) parts.push(`<text x="24" y="38" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="700" fill="${INK}" class="tl-title">${esc(title)}</text>`);
  const ay = L.axisY;
  parts.push(`<line class="tl-axis" x1="${r1(L.X(L.min) - 30)}" y1="${ay}" x2="${L.width - 30}" y2="${ay}" stroke="${AXIS}" stroke-width="2.5" stroke-linecap="round"/>`);
  if (L.crossesEra && L.max > 1) { const bx = L.X(1); parts.push(`<line class="tl-axis" x1="${r1(bx)}" y1="${ay - 14}" x2="${r1(bx)}" y2="${ay + 14}" stroke="${AXIS}" stroke-width="1.5" stroke-dasharray="3 3"/>`); }
  for (const m of L.minor) {
    parts.push(`<line class="tl-axis" x1="${r1(m.x)}" y1="${ay - 4}" x2="${r1(m.x)}" y2="${ay + 4}" stroke="${AXIS}" stroke-width="1"/>`);
    if (m.label) parts.push(`<text class="tl-tick" x="${r1(m.x)}" y="${ay + 28}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="10" fill="${AXIS}">${m.label}</text>`);
  }
  for (const t of L.ticks) {
    parts.push(`<line class="tl-axis" x1="${r1(t.x)}" y1="${ay - 7}" x2="${r1(t.x)}" y2="${ay + 7}" stroke="${AXIS}" stroke-width="1.5"/>`);
    parts.push(`<text class="tl-tick" x="${r1(t.x)}" y="${ay + 24}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${AXIS}">${esc(t.label)}</text>`);
  }
  for (const it of L.items) {
    const e = byId.get(it.id);
    const fill = COLORS[e.color] || COLORS[0];
    const cardH = 40, x = it.cx - it.w / 2, y = it.cy - cardH / 2;
    const edgeY = it.side < 0 ? y + cardH : y;
    const isSel = sel === e.id;
    let g = `<line class="tl-leader" x1="${r1(it.cx)}" y1="${r1(edgeY)}" x2="${r1(it.cx)}" y2="${ay}" stroke="${AXIS}" stroke-width="1.2"/>`;
    if (it.x2 !== null) g += `<rect x="${r1(it.x)}" y="${ay - 5}" width="${r1(it.x2 - it.x)}" height="10" rx="5" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width="1.2"/>`;
    else g += `<circle cx="${r1(it.x)}" cy="${ay}" r="6.5" fill="${fill}" stroke="rgba(0,0,0,.45)" stroke-width="1.5"/>`;
    g += `<rect class="tl__card" x="${r1(x)}" y="${r1(y)}" width="${it.w}" height="${cardH}" rx="9" fill="${fill}" stroke="${isSel ? 'var(--accent, #4a55d6)' : 'rgba(0,0,0,.3)'}" stroke-width="${isSel ? 3.5 : 1.3}"/>`;
    g += `<text x="${r1(it.cx)}" y="${r1(y + 17)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="700" fill="${INK}">${esc(clip(e.title, it.w - 14))}</text>`;
    g += `<text x="${r1(it.cx)}" y="${r1(y + 32)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#3a3a4a">${esc(formatSpan(e.start, e.end))}</text>`;
    parts.push(ids ? `<g class="tl__ev${isSel ? ' is-sel' : ''}" data-id="${e.id}" tabindex="0" role="button" aria-label="${esc(`${e.title}, ${formatSpan(e.start, e.end)}`)}" ${isSel ? 'aria-pressed="true"' : ''}>${g}</g>` : `<g>${g}</g>`);
  }
  return parts.join('');
}

const CSS = `
.tl{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.tl *{box-sizing:border-box}
.tl__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.tl__b,.tl__sel,.tl__fld{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.tl__sel{padding:0 4px}
.tl__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.tl__b:disabled{opacity:.4;cursor:default}
.tl__b--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
.tl__b--go:hover:not(:disabled){background:var(--accent);color:var(--accent-ink,#fff);filter:brightness(1.08)}
.tl__fld{width:100%;padding:0 8px;color:var(--ink-0);white-space:normal}
.tl__fld:focus-visible,.tl__ta:focus-visible{outline:2px solid var(--accent);outline-offset:0}
.tl__name{width:190px;height:28px;padding:0 8px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-0);font-size:var(--fs-13);font-weight:600;border:1px solid var(--line-0)}
.tl__name:focus-visible{outline:2px solid var(--accent)}
.tl__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.tl__mid{flex:1;min-height:0;display:flex}
.tl__scroll{position:relative;flex:1;min-width:0;overflow:auto;background:var(--fill-0);outline:none}
.tl__scroll:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.tl__svg{display:block;max-width:none}
.tl__ev{cursor:pointer;outline:none}
.tl__ev:focus-visible .tl__card{stroke:var(--ink-0);stroke-width:3.5}
.tl__svg .tl-axis,.tl__svg .tl-leader{stroke:var(--ink-2)}
.tl__svg .tl-tick{fill:var(--ink-2)}
.tl__svg .tl-title{fill:var(--ink-0)}
.tl__hint{position:absolute;left:0;right:0;top:34%;display:grid;place-content:center;text-align:center;color:var(--ink-3);font-size:var(--fs-13);gap:8px;padding:0 var(--sp-5)}
.tl__hint[hidden]{display:none}
.tl__side{flex:0 0 280px;display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-4);border-left:1px solid var(--line-1);overflow:auto;font-size:var(--fs-12)}
.tl__side label{display:flex;flex-direction:column;gap:3px;color:var(--ink-2)}
.tl__ta{width:100%;min-height:54px;resize:vertical;border-radius:var(--r-sm);border:1px solid var(--line-0);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-12);padding:6px 8px}
.tl__row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tl__read{min-height:1.4em;color:var(--ink-2)}
.tl__read.is-bad{color:#ff7a8a}
.tl__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto}
.tl__list button{width:100%;text-align:left;padding:5px 8px;border-radius:var(--r-sm);color:var(--ink-1);font-size:var(--fs-12);display:flex;gap:8px;justify-content:space-between;align-items:baseline}
.tl__list button:hover,.tl__list button[aria-pressed=true]{background:var(--fill-2);color:var(--ink-0)}
.tl__list small{color:var(--ink-3);white-space:nowrap}
.tl__keys{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.tl__keys kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-1)}
.tl__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:760px){.tl__mid{flex-direction:column}.tl__side{flex:0 0 auto;border-left:0;border-top:1px solid var(--line-1);max-height:55%}}
`;

defineApp({
  id: 'timeline',
  name: 'Timeline',
  icon: 'clock',
  g1: '#ffd27a', g2: '#d9531e',
  category: 'Create',
  keywords: ['timeline', 'history', 'dates', 'events', 'bce', 'bc', 'ce', 'ancient', 'school', 'homework', 'project', 'picture', 'png'],
  desc: 'Dated events on a scrollable line, BCE dates included; export a picture',
  handles: ['timeline'],
  exts: ['timeline'],
  win: { w: 1020, h: 640, minW: 600, minH: 420 },
  shortcuts: [
    ['Left / Right', 'Move between events in date order'],
    ['Enter', 'Edit the event'],
    ['Plus / -', 'Zoom the line'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z', 'Redo'],
    ['Mod+S', 'Save'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

/* Rome, with the dates a school text gives */
const EXAMPLE = [
  ['Rome is founded (by tradition)', '753 BCE'], ['The Roman Republic begins', '509 BCE'], ['Punic Wars with Carthage', '264–146 BCE'],
  ['Julius Caesar is assassinated', '15 Mar 44 BCE'], ['Augustus becomes first emperor', '27 BCE'], ['The Colosseum opens', '80 CE'],
  ['Constantine legalises Christianity', '313 CE'], ['The western empire falls', '476 CE'],
];

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'clock') => api.notify({ app: 'Timeline', icon, title, message, timeout: 4200 });

  /* ---------------- the model ---------------- */
  let T = { title: '', events: [], ppy: 4 };
  let seq = 0;
  const ev = id => T.events.find(e => e.id === id);
  function load(data) {
    const events = (Array.isArray(data.events) ? data.events : []).map(e => {
      const date = x => (x && Number.isInteger(x.y) && x.y !== 0 && Math.abs(x.y) <= 100000 ? { y: x.y, m: Number.isInteger(x.m) && x.m >= 0 && x.m <= 12 ? x.m : 0, d: Number.isInteger(x.d) && x.d >= 0 && x.d <= 31 ? x.d : 0, approx: !!x.approx } : null);
      const start = date(e && e.start);
      if (!start || typeof e.id !== 'string') return null;
      const end = date(e.end);
      return { id: e.id, title: String(e.title ?? '').slice(0, 80), start, end: end && pos(end) >= pos(start) ? end : null, note: typeof e.note === 'string' ? e.note.slice(0, 600) : '', color: Number.isInteger(e.color) && e.color >= 0 && e.color < COLORS.length ? e.color : 0 };
    }).filter(Boolean);
    T = { title: String(data.title ?? '').slice(0, 60), events, ppy: Number.isFinite(data.ppy) ? Math.min(PPY_MAX, Math.max(PPY_MIN, data.ppy)) : 4 };
    seq = Math.max(seq, ...events.map(e => +/^t(\d+)$/.exec(e.id)?.[1] || 0));
  }
  const plain = () => ({ format: 'staticos-timeline', v: 1, title: T.title, ppy: Number(T.ppy.toPrecision(4)),
    events: T.events.map(({ id, title, start, end, note, color }) => ({ id, title, start, ...(end ? { end } : {}), ...(note ? { note } : {}), color })) });
  const snap = () => JSON.stringify(plain());
  const sorted = () => T.events.slice().sort((a, b) => pos(a.start) - pos(b.start) || a.title.localeCompare(b.title));

  /* ---------------- state ---------------- */
  const st = { sel: null, path: null, dirty: false };
  const undoStack = [], redoStack = [];
  let saveTimer = 0, L = null;
  function checkpoint(pre) { undoStack.push(pre || snap()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; changed(); }
  function restore(json) { const keep = T.ppy; load(JSON.parse(json)); T.ppy = keep; if (st.sel && !ev(st.sel)) st.sel = null; nameIn.value = T.title; changed(); render(); fillForm(); }
  function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); announce('Undone'); }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); announce('Redone'); }
  function changed() {
    st.dirty = true; paintStatus();
    if (st.path) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700); }
  }

  /* ---------------- DOM ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tl__svg'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Timeline');
  const hint = h('div.tl__hint', h('b', { text: 'An empty timeline' }), h('span', { text: 'Give an event a title and a date on the right: 1066, 14 Oct 1066, 44 BCE, 1914–1918.' }), h('button.tl__b', { type: 'button', text: 'Try an example: Ancient Rome', onclick: () => loadExample() }));
  const scroll = h('div.tl__scroll', { tabindex: '-1', dataset: { fk: 'tl-scroll' } }, svg, hint);
  const live = h('div.tl__sr', { role: 'status', 'aria-live': 'polite' });
  const btn = (label, title, fn, extra) => h('button.tl__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const nameIn = h('input.tl__name', { type: 'text', maxlength: '60', placeholder: 'Timeline title', 'aria-label': 'Timeline title', dataset: { fk: 'tl-name' }, oninput: () => { checkpointTitle(); } });
  const B = {
    undo: btn('Undo', 'Undo (Ctrl+Z)', () => undo()),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', () => redo()),
    zout: btn('−', 'Zoom out (−)', () => zoomBy(1 / 1.4)),
    zin: btn('+', 'Zoom in (+)', () => zoomBy(1.4)),
    fit: btn('Fit', 'Fit the whole timeline in the window', () => fit()),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false)),
    png: btn('PNG', 'Export a picture (PNG) to Pictures', () => exportPic('png')),
    svgx: btn('SVG', 'Export a vector picture (SVG) to Pictures', () => exportPic('svg')),
    notes: btn('To Notes', 'Write the events into Notes as a list', () => toNotes()),
  };
  const bar = h('div.tl__bar', { role: 'toolbar', 'aria-label': 'Timeline tools' }, nameIn, h('span.tl__sep'), B.zout, B.zin, B.fit, h('span.tl__sep'), B.undo, B.redo, h('span.tl__sep'), B.save, B.png, B.svgx, B.notes);

  /* the form */
  const fTitle = h('input.tl__fld', { type: 'text', maxlength: '80', 'aria-label': 'Event title', autocomplete: 'off', dataset: { fk: 'tl-title' } });
  const fDate = h('input.tl__fld', { type: 'text', maxlength: '40', 'aria-label': 'Date or period', placeholder: '44 BCE · 14 Oct 1066 · 1914–1918', autocomplete: 'off', spellcheck: 'false', dataset: { fk: 'tl-date' } });
  const fRead = h('div.tl__read', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'tl-read' } });
  const fNote = h('textarea.tl__ta', { 'aria-label': 'Details', maxlength: '600', placeholder: 'Details (optional)' });
  const fColor = h('select.tl__sel', { 'aria-label': 'Colour', dataset: { fk: 'tl-color' } }, ...COLORS.map((c, i) => h('option', { value: String(i), text: COLOR_NAMES[i] })));
  const bAdd = h('button.tl__b.tl__b--go', { type: 'button', text: 'Add event', dataset: { fk: 'tl-add' }, onclick: () => submit() });
  const bDel = h('button.tl__b', { type: 'button', text: 'Delete', onclick: () => removeSel() });
  const bNew = h('button.tl__b', { type: 'button', text: 'New event', title: 'Stop editing this one and start another', onclick: () => { st.sel = null; fillForm(); render(); fTitle.focus(); } });
  const list = h('ul.tl__list', { 'aria-label': 'Events in date order', dataset: { fk: 'tl-list' } });
  const side = h('aside.tl__side', { 'aria-label': 'Events' },
    h('label', { text: 'Title' }, fTitle), h('label', { text: 'Date or period' }, fDate), fRead,
    h('label', { text: 'Details' }, fNote), h('label', { text: 'Colour' }, fColor),
    h('div.tl__row', bAdd, bNew, bDel), list);
  const keys = h('div.tl__keys', ...[['Enter', 'add'], ['←/→', 'between events'], ['+ −', 'zoom'], ['Ctrl+Z', 'undo']].map(([k, t]) => h('span', h('kbd', { text: k }), ' ' + t)));
  root.appendChild(h('div.tl', h('style', { text: CSS }), bar, h('div.tl__mid', scroll, side), keys, live));
  const announce = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };

  /* ---------------- drawing ---------------- */
  const measure = t => textW(t) * 1.0;
  function render() {
    L = lay(T.events, { ppy: T.ppy, measure });
    svg.setAttribute('width', L.width); svg.setAttribute('height', L.height); svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
    const had = document.activeElement?.closest?.('.tl__ev')?.dataset.id;
    svg.innerHTML = drawing(T.events, L, T.title, { sel: st.sel, ids: true });
    hint.hidden = T.events.length > 0;
    list.replaceChildren(...sorted().map(e => h('li', h('button', { type: 'button', 'aria-pressed': String(st.sel === e.id), dataset: { id: e.id }, onclick: () => pick(e.id, true) }, h('span', { text: e.title || '(untitled)' }), h('small', { text: formatSpan(e.start, e.end) })))));
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length;
    B.zout.disabled = T.ppy <= PPY_MIN; B.zin.disabled = T.ppy >= PPY_MAX;
    bDel.disabled = !st.sel; bNew.disabled = !st.sel;
    bAdd.textContent = st.sel ? 'Update event' : 'Add event';
    B.png.disabled = B.svgx.disabled = B.notes.disabled = !T.events.length;
    if (had) svg.querySelector(`[data-id="${had}"]`)?.focus({ preventScroll: true });
  }
  function paintStatus() { win.setSubtitle(`${st.path ? vfs.baseName(st.path) : 'Unsaved timeline'}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`); }
  function zoomBy(f) {
    const mid = scroll.scrollLeft + scroll.clientWidth / 2;
    const yearAtMid = L.min + (mid - 90) / T.ppy;
    T.ppy = Math.min(PPY_MAX, Math.max(PPY_MIN, T.ppy * f));
    render();
    scroll.scrollLeft = 90 + (yearAtMid - L.min) * T.ppy - scroll.clientWidth / 2;
    changed();
  }
  function fit() {
    if (!T.events.length) return;
    const probe = lay(T.events, { ppy: 1, measure });
    const span = (probe.width - 180) / 1;
    T.ppy = Math.min(PPY_MAX, Math.max(PPY_MIN, (Math.max(300, scroll.clientWidth - 200)) / Math.max(1, span)));
    render(); scroll.scrollLeft = 0; changed();
  }

  /* ---------------- the form ---------------- */
  function readDate() {
    const t = fDate.value.trim();
    if (!t) { fRead.textContent = ''; fRead.classList.remove('is-bad'); return null; }
    const sp = parseSpan(t);
    if (!sp) { fRead.textContent = 'I can’t read that date. Try 1066, 14 Oct 1066, 44 BCE or 1914–1918.'; fRead.classList.add('is-bad'); return null; }
    fRead.classList.remove('is-bad');
    fRead.textContent = `Reads as ${formatSpan(sp.start, sp.end)}${sp.end ? ' (a period)' : ''}`;
    return sp;
  }
  function fillForm() {
    const e = st.sel ? ev(st.sel) : null;
    fTitle.value = e ? e.title : ''; fDate.value = e ? formatSpan(e.start, e.end) : ''; fNote.value = e ? e.note : ''; fColor.value = String(e ? e.color : 0);
    readDate();
  }
  on(fDate, 'input', readDate);
  for (const f of [fTitle, fDate]) on(f, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } e.stopPropagation(); });
  on(fNote, 'keydown', e => e.stopPropagation());
  on(nameIn, 'keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); scroll.focus(); } });
  function checkpointTitle() { clearTimeout(titleT); if (!titlePre) titlePre = snap(); T.title = nameIn.value.slice(0, 60); render(); titleT = setTimeout(() => { checkpoint(titlePre); titlePre = null; }, 600); }
  let titleT = 0, titlePre = null;
  function submit() {
    const title = fTitle.value.trim();
    const sp = readDate();
    if (!title) { fRead.textContent = 'Give the event a title.'; fRead.classList.add('is-bad'); fTitle.focus(); return; }
    if (!sp) { if (!fDate.value.trim()) { fRead.textContent = 'Give the event a date.'; fRead.classList.add('is-bad'); } fDate.focus(); return; }
    const pre = snap();
    const data = { title: title.slice(0, 80), start: sp.start, end: sp.end, note: fNote.value.trim().slice(0, 600), color: +fColor.value || 0 };
    let id;
    if (st.sel && ev(st.sel)) { Object.assign(ev(st.sel), data); id = st.sel; announce(`Updated ${title}`); }
    else { id = `t${++seq}`; T.events.push({ id, ...data }); announce(`Added ${title}, ${formatSpan(sp.start, sp.end)}`); }
    checkpoint(pre);
    st.sel = null; fillForm();
    render();
    revealEvent(id);
    fTitle.focus();
  }
  function pick(id, fromList) {
    st.sel = id; fillForm(); render();
    revealEvent(id);
    if (!fromList) fTitle.focus(); else svg.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true });
  }
  function removeSel() {
    const e = st.sel && ev(st.sel);
    if (!e) return;
    const pre = snap();
    T.events = T.events.filter(x => x.id !== e.id);
    st.sel = null; fillForm();
    checkpoint(pre); render();
    announce(`Removed ${e.title}`);
  }
  function revealEvent(id) {
    const it = L.items.find(i => i.id === id);
    if (!it) return;
    if (it.cx < scroll.scrollLeft + 40 || it.cx > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = it.cx - scroll.clientWidth / 2;
  }
  function loadExample() {
    const pre = snap();
    for (const [title, date] of EXAMPLE) { const sp = parseSpan(date); T.events.push({ id: `t${++seq}`, title, start: sp.start, end: sp.end, note: '', color: sp.end ? 2 : 0 }); }
    if (!T.title) { T.title = 'Ancient Rome'; nameIn.value = T.title; }
    checkpoint(pre); render(); fit();
    announce('Example loaded');
  }

  /* ---------------- pointer and keyboard on the line ---------------- */
  on(svg, 'click', e => { const g = e.target.closest?.('.tl__ev'); if (g) pick(g.dataset.id, true); else if (st.sel) { st.sel = null; fillForm(); render(); } });
  on(svg, 'keydown', e => {
    const g = e.target.closest?.('.tl__ev');
    if (!g) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(g.dataset.id, false); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const order = sorted(), i = order.findIndex(x => x.id === g.dataset.id), n = order[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (n) { e.preventDefault(); const el = svg.querySelector(`[data-id="${n.id}"]`); el?.focus({ preventScroll: true }); revealEvent(n.id); announce(`${n.title}, ${formatSpan(n.start, n.end)}`); }
    } else if (e.key === 'Delete') { st.sel = g.dataset.id; removeSel(); }
  });
  on(scroll, 'wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && scroll.scrollHeight <= scroll.clientHeight + 2) { scroll.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  on(root, 'keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); } else if (k === 'y') { redo(); e.preventDefault(); } else if (k === 's') { saveFile(false); e.preventDefault(); }
      return;
    }
    if (e.target.closest?.('input, textarea, select') || e.altKey) return;
    if (e.key === '+' || e.key === '=') zoomBy(1.4); else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.4);
  });

  /* ---------------- files, pictures, Notes ---------------- */
  const stem = () => T.title.trim() || 'Timeline';
  async function saveFile(auto) {
    clearTimeout(saveTimer);
    try {
      const p = await saveDoc(st.path, stem(), 'timeline', JSON.stringify(plain(), null, 1));
      if (!st.path) { st.path = p; win.state.reopen = { path: p }; }
      st.dirty = false; paintStatus();
      if (!auto) say('Saved', p.replace(vfs.HOME, '~'), 'save');
    } catch (err) { say('Could not save', String(err.message || err), 'alert'); }
  }
  /* the whole line, at a width that makes a good picture */
  function picture() {
    if (!T.events.length) return null;
    const probe = lay(T.events, { ppy: 1, measure });
    const span = probe.width - 180;
    const ppy = Math.min(PPY_MAX, Math.max(PPY_MIN, Math.max(T.ppy, 1100 / span)));
    let Lx = lay(T.events, { ppy, measure });
    if (Lx.width > 5000) Lx = lay(T.events, { ppy: ppy * (4800 / Lx.width), measure });
    const body = drawing(T.events, Lx, T.title);
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${Lx.width}" height="${Lx.height}" viewBox="0 0 ${Lx.width} ${Lx.height}"><rect width="${Lx.width}" height="${Lx.height}" fill="#fbfbfd"/>${body}</svg>`;
    return { svgText, W: Lx.width, H: Lx.height };
  }
  async function exportPic(kind) {
    const d = picture();
    if (!d) return say('Nothing to export', 'Add an event first.', 'alert');
    try {
      const r = kind === 'svg' ? await exportSvg(d.svgText, stem()) : await exportPng(d.svgText, d.W, d.H, stem(), d.W > 2400 ? 1 : 2);
      root.dataset.lastExport = JSON.stringify({ kind, path: r.path, w: r.w || d.W, h: r.h || d.H, svgW: d.W, svgH: d.H });
      say(`Exported ${kind.toUpperCase()}`, r.path.replace(vfs.HOME, '~') + (r.w ? ` · ${r.w}×${r.h}` : ''), 'image');
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }
  function toNotes() {
    if (!T.events.length) return;
    const order = sorted();
    const last = order.reduce((m, e) => (pos(e.end || e.start) > pos(m.end || m.start) ? e : m));
    const lines = [`${formatDate(order[0].start)} to ${formatDate(last.end || last.start)}`, '', ...order.map(e => `${formatSpan(e.start, e.end)}: ${e.title}${e.note ? `. ${e.note}` : ''}`)];
    const note = { id: `note-${Date.now().toString(36)}-tl${Math.random().toString(36).slice(2, 5)}`, title: stem().slice(0, 120), body: NF.fromPlain(lines.join('\n')), fmt: NF.FMT, mtime: new Date().toISOString() };
    const cur = api.store.get('notes');
    api.store.set('notes', [...(Array.isArray(cur) ? cur : []), note]);
    if (!(api.store.get('notes') || []).some(n => n && n.id === note.id)) { say('Could not save the note', 'Notes did not take it.', 'alert'); return; }
    root.dataset.lastNote = note.id;
    api.notify({ app: 'Timeline', icon: 'sticky-note', title: 'Saved to Notes', message: `“${note.title}”: ${T.events.length} event${T.events.length === 1 ? '' : 's'}.`, timeout: 9000, actions: [{ label: 'Open in Notes', onClick: () => api.openApp('notes', { noteId: note.id }) }] });
  }

  /* what a test (or a curious person) can ask for */
  root.timelinePeek = () => ({ path: st.path, dirty: st.dirty, sel: st.sel, title: T.title, ppy: T.ppy, width: L.width, height: L.height, ticks: L.ticks.map(t => t.label), crossesEra: L.crossesEra,
    events: sorted().map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, color: e.color, text: formatSpan(e.start, e.end) })),
    items: L.items.map(i => ({ id: i.id, x: i.x, x2: i.x2, cx: i.cx, cy: i.cy, w: i.w, side: i.side, lane: i.lane })), scrollW: scroll.scrollWidth, clientW: scroll.clientWidth });

  /* ---------------- open ---------------- */
  (async () => {
    if (opts && opts.path) {
      try {
        const j = JSON.parse((await readText(opts.path)) || '{}');
        if (!j || !Array.isArray(j.events)) throw new Error('not a timeline');
        load(j); st.path = vfs.norm(opts.path); win.state.reopen = { path: st.path };
        nameIn.value = T.title;
      } catch (err) { say('Could not open that file', `${vfs.baseName(opts.path)} is not a timeline.`, 'alert'); }
    }
    if (dead) return;
    st.dirty = false; paintStatus(); render(); fillForm();
  })();
  paintStatus(); render(); fillForm();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {}) : null;
  ro?.observe(scroll);

  return () => {
    dead = true;
    clearTimeout(saveTimer); clearTimeout(titleT);
    if (st.path && st.dirty) { try { vfs.write(st.path, JSON.stringify(plain(), null, 1)); } catch (e) { /* closing anyway */ } }
    ro?.disconnect();
    offs.splice(0).forEach(f => f());
  };
}
