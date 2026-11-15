/* ============================================================
   mindmap.js — Mind Maps: bubbles you drag, ideas you connect.

   An SVG board. Keyboard first:
     Enter        a sibling idea            Tab         a child idea
     F2 / double-click   edit in place      Esc         stop editing
     Arrows       move between ideas        Alt+Arrows  nudge the idea
     Space        collapse / expand         Delete      remove the idea
     1 – 8        recolour                  L           connect to another idea
     + − F        zoom, fit                 Ctrl+Z / Ctrl+Shift+Z   undo, redo
     Ctrl+S       save                      Ctrl+F      search the ideas
     N            notes on the idea

   Drag an idea to move it (its branch comes along); drag the
   background to pan; the wheel zooms. Double-click empty space for a
   free-standing idea.

   An idea can have notes (longer text, shown in the side panel), a
   shape (rounded, box, pill, ellipse or just a line under the words),
   an icon from the StaticOS set, and a link to a note in Notes (opened
   from the panel). Search finds ideas by their words or notes, opens
   the branches they are folded in and goes to each in turn.

   A map is a file: ~/Documents/<name>.mindmap (JSON — ideas, links,
   view). Files from before notes, shapes and icons existed open as they
   always did: an idea without them is a plain rounded idea. Export
   draws the same map as a standalone SVG or a PNG into ~/Pictures
   through core/media.js; Print lays the drawing and the outline out on
   a page.

   More ▾:
     · Make from an outline: pasted lines, indented or bulleted (or
       Markdown headings), become branches. An empty map becomes the
       outline; otherwise it is added under the selected idea.
     · Outline to Notes: the map as a note (headings and bullets, with
       each idea's notes under it) through the Notes store and
       core/notesfmt.js.
     · Flashcards from the leaf ideas: one card per idea at the end of a
       branch, shown before anything is added to Static Study.
   Share live (core/mapshare.js, a pair.js room like Notes' Write
   Together): the ideas and their words travel; notes on ideas, links
   to notes and the connections between branches stay on each device.

   Accessibility: the board is role="tree"; every idea is a treeitem with
   its level, position and expanded state; one idea is in the tab order
   and arrows move between them. Changes are announced in a status line.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import media from '../core/media.js';
import { hasIcon, iconSvg } from '../core/icons.js';
import * as NF from '../core/notesfmt.js';

export const COLORS = ['#e3e7f2', '#ff9db0', '#ffc58a', '#ffe27a', '#9be3b0', '#8fd6f0', '#9fb6ff', '#d2aaff'];
const COLOR_NAMES = ['Grey', 'Rose', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Violet'];
export const SHAPES = [['round', 'Rounded'], ['box', 'Box'], ['pill', 'Pill'], ['ellipse', 'Ellipse'], ['line', 'Underline']];
export const IDEA_ICONS = ['star', 'heart', 'check', 'alert', 'help-circle', 'info', 'flame', 'zap', 'clock', 'calendar', 'map-pin', 'bookmark', 'thumbs-up', 'lock', 'globe', 'music', 'sun', 'moon', 'user', 'sparkles'].filter(hasIcon);
const ICON_LABEL = n => n.replace(/-circle$/, '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const NODE_H = 38, PAD_X = 16, MIN_W = 96, GAP_X = 64, GAP_Y = 14, MAX_LEN = 60, ICON_W = 20, NOTE_MAX = 2000;
const FONT = '600 14px Inter, system-ui, sans-serif';
const DOCS = `${vfs.HOME}/Documents`, PICS = `${vfs.HOME}/Pictures`;
const NS = 'http://www.w3.org/2000/svg';
const INK = '#1d1a26';

let measureCtx = null;
const textWidth = t => {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = FONT;
  return measureCtx.measureText(t).width;
};
const widthOf = (text, icon) => Math.max(MIN_W, Math.ceil(textWidth(text || 'Idea')) + PAD_X * 2 + (icon ? ICON_W : 0));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = (tag, attrs, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
};
/* an icon's paths, from the StaticOS set, as SVG markup in a 24-unit box */
const iconBody = name => (iconSvg(name).match(/<svg[^>]*>([\s\S]*)<\/svg>/) || [])[1] || '';

/* ---- the shape of an idea, as SVG markup: used on the board (as nodes) and in exports (as text) ---- */
function shapeMarkup(n, fill, stroke) {
  const w = n.w, hh = n.h;
  if (n.shape === 'ellipse') return `<ellipse class="mm__shape" cx="${w / 2}" cy="${hh / 2}" rx="${w / 2 + 6}" ry="${hh / 2 + 3}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  if (n.shape === 'line') return `<path class="mm__shape" style="--lc:${fill}" d="M2,${hh - 3} L${w - 2},${hh - 3}" fill="none" stroke="${fill}" stroke-width="4" stroke-linecap="round"/>`;
  const rx = n.shape === 'box' ? 3 : n.shape === 'pill' ? hh / 2 : 12;
  return `<rect class="mm__shape" width="${w}" height="${hh}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

/* ---- outlines: pasted text -> a tree of lines; a map -> note blocks ---- */
/** Lines of an outline -> [{ depth, text }]. Understands indentation (spaces or tabs), bullets
    (- * + • and numbers like 1. or a)), Markdown headings (# is the top), and the "– " marks
    an exported outline puts in front of deep ideas. */
export function parseOutline(src) {
  const out = [];
  let base = 0;                  /* the depth headings set for the lines under them */
  let indents = [];              /* indentation widths seen since the last heading, smallest first */
  for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const hd = /^\s*(#{1,6})\s+(.*)$/.exec(raw);
    if (hd) {
      const depth = hd[1].length - 1;
      const text = hd[2].trim();
      if (text) out.push({ depth, text });
      base = depth + 1; indents = [];
      continue;
    }
    const lead = /^[ \t]*/.exec(raw)[0].replace(/\t/g, '    ').length;
    let text = raw.trim().replace(/^([-*+•‣◦▪]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/, '');
    let dashes = 0;
    while (/^– /.test(text)) { text = text.slice(2); dashes++; }
    text = text.replace(/^\[( |x|X)\]\s+/, '').trim();
    if (!text) continue;
    while (indents.length && indents[indents.length - 1] > lead) indents.pop();
    if (!indents.length || indents[indents.length - 1] < lead) indents.push(lead);
    out.push({ depth: base + indents.length - 1 + dashes, text });
    if (out.length >= 500) break;
  }
  return out;
}

const CSS = `
.mm{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.mm *{box-sizing:border-box}
.mm__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.mm__b{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.mm__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.mm__b:disabled{opacity:.4;cursor:default}
.mm__b[aria-pressed=true]{background:var(--fill-accent-hi);border-color:var(--line-accent);color:var(--ink-0)}
.mm__sel{height:28px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);padding:0 4px}
.mm__find{height:28px;width:150px;padding:0 8px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-0);font-size:var(--fs-12);border:1px solid var(--line-0)}
.mm__find:focus{outline:2px solid var(--accent);outline-offset:0}
.mm__count{font-size:var(--fs-11);color:var(--ink-3);min-width:3em}
.mm__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.mm__sw{width:18px;height:18px;border-radius:50%;border:2px solid transparent;box-shadow:0 0 0 1px var(--line-2);padding:0}
.mm__sw:hover{transform:scale(1.15)}
.mm__sw[aria-pressed=true]{border-color:var(--ink-0)}
.mm__mid{flex:1;min-height:0;display:flex}
.mm__board{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;background:var(--fill-0);outline:none}
.mm__svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;
  background-image:radial-gradient(var(--line-2) 1px,transparent 1px);background-size:24px 24px}
.mm__svg.is-pan{cursor:grabbing}
.mm__link{fill:none;stroke:var(--ink-3);stroke-width:2;opacity:.75}
.mm__cross{fill:none;stroke:var(--accent-soft);stroke-width:2;stroke-dasharray:6 5}
.mm__n{cursor:pointer;outline:none}
.mm__n .mm__shape{stroke:rgba(0,0,0,.28);stroke-width:1.5}
.mm__n .mm__hit{fill:transparent;stroke:none}
.mm__n text{font:600 14px Inter,system-ui,sans-serif;fill:#1d1a26;pointer-events:none;user-select:none}
.mm__n.is-line text{fill:var(--ink-0)}
.mm__n.is-sel .mm__shape{stroke:var(--accent);stroke-width:3.5}
.mm__n.is-line .mm__shape{stroke:var(--lc);stroke-width:4}
.mm__n.is-sel.is-line .mm__shape{stroke:var(--accent);stroke-width:6}
.mm__n.is-match.is-line .mm__shape{stroke:#ffb020}
.mm__n.is-from .mm__shape{stroke-dasharray:5 4}
.mm__n:focus-visible .mm__shape{stroke:var(--ink-0);stroke-width:3.5}
.mm__n.is-match .mm__shape{stroke:#ffb020;stroke-width:3.5}
.mm.is-finding .mm__n:not(.is-match){opacity:.35}
.mm__n .mm__ic{fill:none;stroke:#1d1a26;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.mm__n.is-line .mm__ic{stroke:var(--ink-0)}
.mm__n .mm__badge{fill:#1d1a26;stroke:none}
.mm__n .mm__badget{fill:#fff;font-size:calc(11px * var(--fs-k,1))}
.mm__n .mm__mark{fill:var(--accent);stroke:none}
.mm__n .mm__markic{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.mm__in{position:absolute;z-index:3;display:none;border:2px solid var(--accent);border-radius:9px;background:#fff;color:#1d1a26;font:600 14px Inter,system-ui,sans-serif;text-align:center;padding:0 6px;outline:none;transform-origin:center}
.mm__hint{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--ink-3);font-size:var(--fs-13);pointer-events:none;gap:6px}
.mm__side{flex:0 0 280px;display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-4);border-left:1px solid var(--line-1);overflow:auto;font-size:var(--fs-12)}
.mm__side[hidden]{display:none}
.mm__side h3{margin:0;font-size:var(--fs-13);color:var(--ink-0);display:flex;align-items:center;gap:6px}
.mm__side h3 .grow{flex:1}
.mm__side p{margin:0;line-height:1.5;color:var(--ink-2)}
.mm__side textarea,.mm__side input[type=text]{width:100%;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-12);padding:6px 8px}
.mm__side textarea{min-height:110px;resize:vertical;line-height:1.45}
.mm__side .mm__row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mm__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto}
.mm__list button{width:100%;text-align:left;padding:5px 8px;border-radius:var(--r-sm);color:var(--ink-1);font-size:var(--fs-12)}
.mm__list button:hover{background:var(--fill-2)}
.mm__cards{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.mm__cards li{padding:6px 8px;border-radius:var(--r-sm);background:var(--fill-1);border:1px solid var(--line-0);line-height:1.4}
.mm__cards b{color:var(--ink-0)}
.mm__code{display:flex;gap:4px}
.mm__code span{width:28px;height:34px;display:grid;place-items:center;border-radius:6px;background:var(--fill-2);color:var(--ink-0);font:700 18px var(--mono)}
.mm__live{font-size:var(--fs-11);padding:2px 8px;border-radius:var(--r-pill);background:var(--fill-accent-hi);color:var(--ink-0)}
.mm__err{color:#ff7a8a}
.mm__keys{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.mm__keys kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-1)}
.mm__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mm-print{display:none}
@media print{
  html.mm-printing,html.mm-printing body{background:#fff!important;height:auto!important;min-height:0!important;overflow:visible!important;position:static!important}
  html.mm-printing body>:not(.mm-print){display:none!important}
  html.mm-printing .mm-print{display:block!important;color:#000;font:11pt/1.5 system-ui,sans-serif}
  .mm-print h1{font-size:16pt;margin:0 0 8pt}
  .mm-print svg{width:100%;height:auto;max-height:60vh;border:1px solid #999;margin-bottom:10pt}
  .mm-print ul{margin:0 0 0 14pt;padding:0}
  .mm-print li{margin:2pt 0}
  .mm-print .mm-print__note{color:#444;font-size:10pt;white-space:pre-wrap}
}
`;

defineApp({
  id: 'mindmap',
  name: 'Mind Maps',
  icon: 'network',
  g1: '#a7c6ff', g2: '#4a55d6',
  category: 'Productivity',
  keywords: ['mind map', 'mindmap', 'brainstorm', 'ideas', 'diagram', 'concept map', 'bubbles', 'planning', 'notes', 'school', 'study', 'outline', 'flashcards', 'share'],
  desc: 'Drag bubbles, connect ideas, share a map live, and turn it into notes, flashcards or a picture',
  handles: ['mindmap'],
  win: { w: 980, h: 660, minW: 560, minH: 400 },
  shortcuts: [
    ['Enter', 'New sibling idea'],
    ['Tab', 'New child idea'],
    ['F2', 'Edit the idea'],
    ['Left / Right / Up / Down', 'Move between ideas'],
    ['Alt+Left / Alt+Right / Alt+Up / Alt+Down', 'Nudge the idea'],
    ['Space', 'Collapse or expand the branch'],
    ['Delete', 'Remove the idea'],
    ['L', 'Connect to another idea'],
    ['N', 'Notes on the idea'],
    ['Mod+F', 'Search the ideas'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z', 'Redo'],
    ['Mod+S', 'Save'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'network', actions) => api.notify({ app: 'Mind Maps', icon, title, message, timeout: actions ? 9000 : 4200, actions });

  /* ---------------- the model ---------------- */
  let M = { nodes: [], links: [], view: { x: 0, y: 0, k: 1 } };
  let seq = 0;
  const byId = new Map();
  const reindex = () => { byId.clear(); for (const n of M.nodes) byId.set(n.id, n); };
  /* while a map is shared, new ideas carry this session's mark, so two people can't make the same id */
  const newId = () => `n${++seq}${share && share.sess ? `_${share.sess.site}` : ''}`;
  const kids = id => M.nodes.filter(n => n.parent === id);
  const descendants = id => { const out = []; const walk = p => { for (const k of kids(p)) { out.push(k); walk(k.id); } }; walk(id); return out; };
  const roots = () => M.nodes.filter(n => !n.parent || !byId.has(n.parent));
  const sizeNode = n => { n.w = widthOf(n.text, n.icon); n.h = NODE_H; };
  const mk = (text, x, y, parent, color) => { const n = { id: newId(), text, x, y, parent: parent || null, color: color || 0, collapsed: false, shape: 'round', icon: '', note: '', link: null }; sizeNode(n); return n; };
  const bottomOf = n => Math.max(n.y + n.h, ...descendants(n.id).map(d => d.y + d.h));
  const shapeOk = v => (SHAPES.some(s => s[0] === v) ? v : 'round');
  const iconOk = v => (typeof v === 'string' && IDEA_ICONS.includes(v) ? v : '');
  const seqOf = nodes => Math.max(0, ...nodes.map(n => Number(/^n(\d+)(?:_[a-z0-9]+)?$/.exec(n.id)?.[1] || 0)));

  /* a file from any version: ideas without notes, shapes or icons are plain rounded ones */
  function load(data) {
    const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => n && typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))
      .map(n => ({ id: n.id, text: String(n.text ?? '').slice(0, MAX_LEN), x: n.x, y: n.y, parent: typeof n.parent === 'string' ? n.parent : null,
        color: Number.isInteger(n.color) && n.color >= 0 && n.color < COLORS.length ? n.color : 0, collapsed: !!n.collapsed,
        shape: shapeOk(n.shape), icon: iconOk(n.icon), note: typeof n.note === 'string' ? n.note.slice(0, NOTE_MAX) : '', link: typeof n.link === 'string' && n.link ? n.link.slice(0, 80) : null }));
    nodes.forEach(sizeNode);
    const ids = new Set(nodes.map(n => n.id));
    M = { nodes, links: (Array.isArray(data.links) ? data.links : []).filter(l => Array.isArray(l) && ids.has(l[0]) && ids.has(l[1]) && l[0] !== l[1]).map(l => [l[0], l[1]]),
      view: data.view && Number.isFinite(data.view.k) ? { x: data.view.x || 0, y: data.view.y || 0, k: Math.min(3, Math.max(0.25, data.view.k)) } : { x: 0, y: 0, k: 1 } };
    seq = Math.max(seq, seqOf(nodes));
    reindex();
  }
  /* new fields are written only when an idea has them, so a plain map's file stays what it was */
  const plain = () => ({ format: 'staticos-mindmap', v: 2,
    nodes: M.nodes.map(({ id, text, x, y, parent, color, collapsed, shape, icon, note, link }) => ({ id, text, x: Math.round(x), y: Math.round(y), parent, color, collapsed,
      ...(shape && shape !== 'round' ? { shape } : {}), ...(icon ? { icon } : {}), ...(note ? { note } : {}), ...(link ? { link } : {}) })),
    links: M.links, view: { x: Math.round(M.view.x), y: Math.round(M.view.y), k: Number(M.view.k.toFixed(3)) } });
  const snap = () => JSON.stringify(plain());

  /* ---------------- state ---------------- */
  const st = { sel: null, edit: null, from: null, path: null, dirty: false, saved: '', side: null, find: '', hits: [], hitAt: -1 };
  const undoStack = [], redoStack = [];
  let saveTimer = 0;

  function checkpoint(pre) {
    undoStack.push(pre || snap());
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    changed();
  }
  function restore(json) {
    const keep = M.view;
    load(JSON.parse(json));
    M.view = keep;
    if (!byId.has(st.sel)) st.sel = M.nodes[0]?.id || null;
    st.from = null;
    changed();
    render();
  }
  function undo() { if (st.edit) return; if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); say2('Undone'); }
  function redo() { if (st.edit) return; if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); say2('Redone'); }
  /* a change is often announced (checkpoint) just before it is made: what follows from it waits
     for the end of this task, when the change is in the model */
  let afterQ = 0;
  function changed(remote) {
    st.dirty = true;
    paintStatus();
    if (st.path) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700); }
    const first = !afterQ;
    afterQ |= remote ? 1 : 3;          /* 1: look again at a search; 2: send this device's change */
    if (first) queueMicrotask(afterChange);
  }
  function afterChange() {
    const q = afterQ;
    afterQ = 0;
    if (dead || !q) return;
    if (q & 2) shareLocal();
    if (st.find) findNow(false);
  }

  /* ---------------- DOM ---------------- */
  const svg = S('svg', { class: 'mm__svg', role: 'tree', 'aria-label': 'Mind map', 'aria-orientation': 'horizontal' });
  const vp = S('g');
  const linksG = S('g'), nodesG = S('g');
  vp.append(linksG, nodesG);
  svg.append(vp);
  const input = h('input.mm__in', { type: 'text', maxlength: String(MAX_LEN), 'aria-label': 'Idea text', autocomplete: 'off', spellcheck: 'false' });
  const hint = h('div.mm__hint', h('b', { text: 'An empty board' }), h('span', { text: 'Press Enter, or double-click, to add your first idea.' }));
  const live = h('div.mm__sr', { role: 'status', 'aria-live': 'polite' });
  const board = h('div.mm__board', { tabindex: '-1' }, svg, input, hint, live);
  const side = h('aside.mm__side', { hidden: true, 'aria-label': 'Idea details' });

  const btn = (label, title, fn, extra) => h('button.mm__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const B = {
    child: btn('Child', 'New child idea (Tab)', () => addChild()),
    sib: btn('Sibling', 'New sibling idea (Enter)', () => addSibling()),
    del: btn('Delete', 'Remove the idea (Delete)', () => removeSel()),
    conn: btn('Connect', 'Connect the idea to another (L)', () => toggleConnect(), { 'aria-pressed': 'false' }),
    fold: btn('Collapse', 'Collapse or expand the branch (Space)', () => toggleFold()),
    icon: btn('Icon', 'Give the idea an icon', e => iconMenu(e), { dataset: { fk: 'mm-icon' } }),
    undo: btn('Undo', 'Undo (Ctrl+Z)', () => undo()),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', () => redo()),
    zout: btn('−', 'Zoom out', () => zoomBy(1 / 1.25)),
    zin: btn('+', 'Zoom in', () => zoomBy(1.25)),
    fit: btn('Fit', 'Fit the whole map (F)', () => fit()),
    tidy: btn('Tidy', 'Lay the branches out neatly', () => tidy()),
    notes: btn('Notes', 'Notes and a linked note for the idea (N)', () => toggleSide('idea'), { 'aria-pressed': 'false', dataset: { fk: 'mm-notes' } }),
    share: btn('Share', 'Share this map live with a friend', () => toggleSide('share'), { 'aria-pressed': 'false', dataset: { fk: 'mm-share' } }),
    more: btn('More ▾', 'More: make from an outline, outline to Notes, flashcards, print', e => moreMenu(e), { dataset: { fk: 'mm-more' } }),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false)),
    png: btn('PNG', 'Export a picture (PNG) to Pictures', () => exportPng()),
    svgx: btn('SVG', 'Export a vector picture (SVG) to Pictures', () => exportSvg()),
  };
  const shapeSel = h('select.mm__sel', { 'aria-label': 'Shape of the idea', title: 'Shape of the idea', dataset: { fk: 'mm-shape' }, onchange: e => reshape(e.target.value) },
    ...SHAPES.map(([id, name]) => h('option', { value: id, text: name })));
  const find = h('input.mm__find', { type: 'search', placeholder: 'Search ideas', 'aria-label': 'Search the ideas (Ctrl+F)', dataset: { fk: 'mm-find' }, autocomplete: 'off', spellcheck: 'false' });
  const findCount = h('span.mm__count', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'mm-find-count' } });
  const swatches = COLORS.map((c, i) => h('button.mm__sw', { type: 'button', style: { background: c }, title: `${COLOR_NAMES[i]} (${i + 1})`, 'aria-label': `Colour: ${COLOR_NAMES[i]}`, 'aria-pressed': 'false',
    onclick: () => recolour(i) }));
  const sep = () => h('span.mm__sep');
  const liveChip = h('span.mm__live', { hidden: true, dataset: { fk: 'mm-live' } });
  const bar = h('div.mm__bar', { role: 'toolbar', 'aria-label': 'Mind map tools' }, B.child, B.sib, B.del, sep(), B.conn, B.fold, sep(), ...swatches, shapeSel, B.icon, sep(), B.undo, B.redo, sep(),
    B.zout, B.zin, B.fit, B.tidy, sep(), B.notes, find, findCount, sep(), B.save, B.png, B.svgx, B.more, B.share, liveChip);
  const keys = h('div.mm__keys', ...[['Enter', 'sibling'], ['Tab', 'child'], ['F2', 'edit'], ['Space', 'collapse'], ['L', 'connect'], ['N', 'notes'], ['Del', 'remove'], ['1–8', 'colour']].map(([k, t]) => h('span', h('kbd', { text: k }), ' ' + t)));
  const shell = h('div.mm', h('style', { text: CSS }), bar, h('div.mm__mid', board, side), keys);
  root.appendChild(shell);

  const say2 = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };
  function paintStatus() {
    const name = st.path ? vfs.baseName(st.path) : 'Unsaved map';
    win.setSubtitle(`${name}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`);
  }

  /* ---------------- view ---------------- */
  const applyView = () => { vp.setAttribute('transform', `translate(${M.view.x} ${M.view.y}) scale(${M.view.k})`); placeInput(); };
  const boardSize = () => { const r = board.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 500, l: r.left, t: r.top }; };
  const toWorld = (cx, cy) => { const b = boardSize(); return { x: (cx - b.l - M.view.x) / M.view.k, y: (cy - b.t - M.view.y) / M.view.k }; };
  function zoomAt(k, cx, cy) {
    const old = M.view.k;
    k = Math.min(3, Math.max(0.25, k));
    M.view.x = cx - (cx - M.view.x) * (k / old);
    M.view.y = cy - (cy - M.view.y) * (k / old);
    M.view.k = k;
    applyView();
  }
  function zoomBy(f) { const b = boardSize(); zoomAt(M.view.k * f, b.w / 2, b.h / 2); }
  function visibleNodes() {
    const out = [];
    const walk = (n, level, pos, size) => {
      out.push({ n, level, pos, size });
      if (n.collapsed) return;
      const ks = kids(n.id);
      ks.forEach((k, i) => walk(k, level + 1, i + 1, ks.length));
    };
    const rs = roots();
    rs.forEach((r, i) => walk(r, 1, i + 1, rs.length));
    return out;
  }
  function fit() {
    const vis = visibleNodes().map(v => v.n);
    const b = boardSize();
    if (!vis.length) { M.view = { x: b.w / 2, y: b.h / 2, k: 1 }; applyView(); return; }
    const x0 = Math.min(...vis.map(n => n.x)), x1 = Math.max(...vis.map(n => n.x + n.w));
    const y0 = Math.min(...vis.map(n => n.y)), y1 = Math.max(...vis.map(n => n.y + n.h));
    const k = Math.min(1.25, Math.max(0.25, Math.min((b.w - 80) / (x1 - x0), (b.h - 80) / (y1 - y0))));
    M.view = { k, x: b.w / 2 - ((x0 + x1) / 2) * k, y: b.h / 2 - ((y0 + y1) / 2) * k };
    applyView();
  }
  /* the first look: centred on the map at a readable size */
  function centre() {
    const vis = visibleNodes().map(v => v.n);
    if (!vis.length) return fit();
    const b = boardSize();
    const k = M.view.k;
    const x0 = Math.min(...vis.map(n => n.x)), x1 = Math.max(...vis.map(n => n.x + n.w));
    const y0 = Math.min(...vis.map(n => n.y)), y1 = Math.max(...vis.map(n => n.y + n.h));
    M.view.x = b.w / 2 - ((x0 + x1) / 2) * k; M.view.y = b.h / 2 - ((y0 + y1) / 2) * k;
    applyView();
  }
  /* bring one idea to the middle of the board */
  function panTo(n) { const b = boardSize(); M.view.x = b.w / 2 - (n.x + n.w / 2) * M.view.k; M.view.y = b.h / 2 - (n.y + n.h / 2) * M.view.k; applyView(); }

  /* ---------------- drawing ---------------- */
  const sideOf = (a, b) => {
    const ac = a.x + a.w / 2, bc = b.x + b.w / 2;
    return bc >= ac ? [{ x: a.x + a.w, y: a.y + a.h / 2 }, { x: b.x, y: b.y + b.h / 2 }, 1] : [{ x: a.x, y: a.y + a.h / 2 }, { x: b.x + b.w, y: b.y + b.h / 2 }, -1];
  };
  const curve = (p, q, dir) => { const dx = Math.max(30, Math.abs(q.x - p.x) / 2) * dir; return `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`; };
  const hiddenCount = n => (n.collapsed ? descendants(n.id).length : 0);
  const svgFrag = markup => { const g = S('g'); g.innerHTML = markup; return [...g.childNodes]; };
  const noteTitle = id => { const n = notesList().find(x => x.id === id); return n ? (String(n.title || '').trim() || 'Untitled note') : null; };

  function render() {
    const hadFocus = !st.edit && svg.contains(document.activeElement);
    reindex();
    const vis = visibleNodes();
    const shown = new Set(vis.map(v => v.n.id));
    const links = [];
    for (const { n } of vis) if (n.parent && shown.has(n.parent)) { const p = byId.get(n.parent); const [a, b, d] = sideOf(p, n); links.push(S('path', { class: 'mm__link', d: curve(a, b, d) })); }
    for (const [a, b] of M.links) if (shown.has(a) && shown.has(b)) { const [p, q, d] = sideOf(byId.get(a), byId.get(b)); links.push(S('path', { class: 'mm__cross', d: curve(p, q, d), 'data-link': `${a}:${b}` })); }
    linksG.replaceChildren(...links);
    const selOk = shown.has(st.sel);
    if (!selOk) st.sel = vis[0]?.n.id || null;
    const tabbable = st.sel;
    const hits = new Set(st.hits);
    nodesG.replaceChildren(...vis.map(({ n, level, pos, size }) => {
      const hasKids = kids(n.id).length > 0;
      const extra = [n.icon ? `icon ${ICON_LABEL(n.icon)}` : '', n.note ? 'has notes' : '', n.link ? 'linked to a note' : ''].filter(Boolean).join(', ');
      const g = S('g', { class: 'mm__n' + (n.id === st.sel ? ' is-sel' : '') + (n.id === st.from ? ' is-from' : '') + (n.shape === 'line' ? ' is-line' : '') + (hits.has(n.id) ? ' is-match' : ''), transform: `translate(${n.x} ${n.y})`,
        role: 'treeitem', tabindex: n.id === tabbable ? '0' : '-1', 'data-id': n.id, 'data-text': n.text, 'data-color': n.color, 'data-shape': n.shape, 'data-icon': n.icon || null,
        'aria-level': level, 'aria-posinset': pos, 'aria-setsize': size, 'aria-selected': String(n.id === st.sel),
        'aria-expanded': hasKids ? String(!n.collapsed) : null,
        'aria-label': `${n.text || 'Empty idea'}${hasKids ? (n.collapsed ? `, collapsed, ${hiddenCount(n)} hidden` : `, ${kids(n.id).length} child ideas`) : ''}${extra ? `, ${extra}` : ''}` });
      if (n.shape === 'ellipse' || n.shape === 'line') g.append(S('rect', { class: 'mm__hit', width: n.w, height: n.h }));
      g.append(...svgFrag(shapeMarkup(n, COLORS[n.color], 'rgba(0,0,0,.28)')));
      const tx = n.w / 2 + (n.icon ? ICON_W / 2 : 0);
      if (n.icon) { const ig = S('g', { class: 'mm__ic', transform: `translate(${PAD_X - 4} ${n.h / 2 - 8}) scale(${16 / 24})` }); ig.innerHTML = iconBody(n.icon); g.append(ig); }
      g.append(S('text', { x: tx, y: n.h / 2 + 5, 'text-anchor': 'middle' }, n.text || '…'));
      if (n.collapsed && hasKids) g.append(S('circle', { class: 'mm__badge', cx: n.w, cy: 0, r: 11 }), S('text', { class: 'mm__badget', x: n.w, y: 4, 'text-anchor': 'middle' }, String(hiddenCount(n))));
      /* small marks at the bottom right: notes, a linked note */
      let bx = n.w - 4;
      for (const [on1, ic, cls] of [[n.note, 'note', 'mm__mark-note'], [n.link, 'link', 'mm__mark-link']]) {
        if (!on1) continue;
        const mg = S('g', { class: cls, transform: `translate(${bx} ${n.h})` }, S('circle', { class: 'mm__mark', r: 8 }));
        const ig = S('g', { class: 'mm__markic', transform: 'translate(-5 -5) scale(0.42)' }); ig.innerHTML = iconBody(ic); mg.append(ig);
        g.append(mg);
        bx -= 19;
      }
      return g;
    }));
    hint.style.display = vis.length ? 'none' : 'grid';
    const sel = byId.get(st.sel);
    B.del.disabled = !sel;
    B.child.disabled = !sel && M.nodes.length > 0;
    B.fold.disabled = !sel || !kids(sel.id).length;
    B.fold.textContent = sel && sel.collapsed ? 'Expand' : 'Collapse';
    B.conn.setAttribute('aria-pressed', String(!!st.from));
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length;
    B.icon.disabled = !sel; shapeSel.disabled = !sel;
    if (sel) shapeSel.value = sel.shape;
    swatches.forEach((s, i) => s.setAttribute('aria-pressed', String(!!sel && sel.color === i)));
    svg.setAttribute('aria-label', `Mind map: ${roots()[0]?.text || 'untitled'}, ${M.nodes.length} ideas`);
    applyView();
    if (hadFocus) focusSel();
    if (st.side === 'idea' && st.sideFor !== st.sel) paintSide();
  }
  const focusSel = () => { const g = st.sel && nodesG.querySelector(`[data-id="${st.sel}"]`); if (g) g.focus({ preventScroll: true }); else board.focus({ preventScroll: true }); };

  function select(id, announce = true) {
    st.sel = id;
    render();
    focusSel();
    const n = byId.get(id);
    if (n && announce) say2(`${n.text || 'Empty idea'}`);
  }

  /* ---------------- editing the map ---------------- */
  function startEdit(id, isNew, cp = isNew) {
    const n = byId.get(id);
    if (!n) return;
    /* cp: the idea was made by an action that took an undo point of its own */
    st.edit = { id, isNew: !!isNew, cp: !!cp, snap: isNew ? null : snap(), orig: n.text };
    input.value = n.text;
    input.style.display = 'block';
    placeInput();
    input.focus();
    input.select();
  }
  function placeInput() {
    if (!st.edit) return;
    const n = byId.get(st.edit.id);
    if (!n) return;
    const k = M.view.k;
    const w = Math.max(n.w, widthOf(input.value, n.icon)) * k;
    Object.assign(input.style, { left: `${M.view.x + (n.x + n.w / 2) * k - w / 2}px`, top: `${M.view.y + n.y * k}px`, width: `${w}px`, height: `${n.h * k}px`, fontSize: `${14 * k}px` });
  }
  function endEdit(commit) {
    const e = st.edit;
    if (!e) return;
    st.edit = null;
    input.style.display = 'none';
    const n = byId.get(e.id);
    if (n) {
      const text = input.value.trim();
      if (commit && text) {
        const was = n.text;
        n.text = text; sizeNode(n);
        if (!e.isNew && text !== was) checkpoint(e.snap);
        else changed();
      } else if (e.isNew) {
        /* an idea that never got a word is not kept, and its creation is not an undo step */
        if (e.cp) undoStack.pop();
        M.nodes = M.nodes.filter(x => x.id !== n.id);
        st.sel = n.parent && byId.has(n.parent) ? n.parent : M.nodes[0]?.id || null;
        shareLocal();
      } else { n.text = e.orig; sizeNode(n); shareLocal(); }
    }
    render();
    focusSel();
  }
  let typingT = 0;
  on(input, 'input', () => {
    const n = st.edit && byId.get(st.edit.id);
    if (!n) return;
    n.text = input.value; sizeNode(n);
    render();
    /* a friend sees the words as they are typed (a little behind, not every key) */
    if (share && share.sess && input.value.trim()) { clearTimeout(typingT); typingT = setTimeout(() => { if (!dead) shareLocal(); }, 250); }
  });
  on(input, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); const id = st.edit?.id; endEdit(true); if (id && e.shiftKey) addSibling(); }
    else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
    else if (e.key === 'Tab') { e.preventDefault(); const id = st.edit?.id; endEdit(true); if (id && byId.has(id)) { st.sel = id; addChild(); } }
  });
  on(input, 'blur', () => { if (st.edit) endEdit(true); });

  function addChild() {
    if (st.edit) return;
    const p = byId.get(st.sel);
    if (!p) return addFloating(0, 0);
    checkpoint();
    p.collapsed = false;
    const ks = kids(p.id);
    const y = ks.length ? bottomOf(ks[ks.length - 1]) + GAP_Y : p.y + (p.h - NODE_H) / 2;
    const n = mk('', p.x + p.w + GAP_X, y, p.id, p.color);
    M.nodes.push(n);
    st.sel = n.id;
    render();
    startEdit(n.id, true);
    say2('New child idea');
  }
  function addSibling() {
    if (st.edit) return;
    const s = byId.get(st.sel);
    if (!s) return addFloating(0, 0);
    if (!s.parent) return addChild();
    checkpoint();
    const n = mk('', s.x, bottomOf(s) + GAP_Y, s.parent, s.color);
    M.nodes.splice(M.nodes.indexOf(s) + 1 + descendants(s.id).length, 0, n);
    st.sel = n.id;
    render();
    startEdit(n.id, true);
    say2('New sibling idea');
  }
  function addFloating(x, y) {
    if (st.edit) return;
    checkpoint();
    const n = mk('', x - MIN_W / 2, y - NODE_H / 2, null, 0);
    M.nodes.push(n);
    st.sel = n.id;
    render();
    startEdit(n.id, true);
  }
  function removeSel() {
    const n = byId.get(st.sel);
    if (!n || st.edit) return;
    checkpoint();
    const gone = new Set([n.id, ...descendants(n.id).map(d => d.id)]);
    const sibs = kids(n.parent);
    const at = sibs.indexOf(n);
    M.nodes = M.nodes.filter(x => !gone.has(x.id));
    M.links = M.links.filter(([a, b]) => !gone.has(a) && !gone.has(b));
    st.sel = (sibs[at + 1] || sibs[at - 1] || (n.parent && byId.get(n.parent)))?.id || M.nodes[0]?.id || null;
    if (st.sel && gone.has(st.sel)) st.sel = M.nodes[0]?.id || null;
    st.from = null;
    shareLocal();
    render();
    focusSel();
    say2(`Removed ${gone.size > 1 ? gone.size + ' ideas' : 'the idea'}`);
  }
  function toggleFold() {
    const n = byId.get(st.sel);
    if (!n || !kids(n.id).length || st.edit) return;
    checkpoint();
    n.collapsed = !n.collapsed;
    render();
    say2(n.collapsed ? 'Collapsed' : 'Expanded');
  }
  function recolour(i) {
    const n = byId.get(st.sel);
    if (!n || st.edit || n.color === i) return;
    checkpoint();
    n.color = i;
    render();
    say2(COLOR_NAMES[i]);
  }
  function reshape(shape) {
    const n = byId.get(st.sel);
    if (!n || st.edit || n.shape === shape || !SHAPES.some(s => s[0] === shape)) return;
    checkpoint();
    n.shape = shape;
    render();
    say2(`Shape: ${SHAPES.find(s => s[0] === shape)[1]}`);
  }
  function setIcon(icon) {
    const n = byId.get(st.sel);
    if (!n || st.edit || n.icon === icon) return;
    checkpoint();
    n.icon = iconOk(icon);
    sizeNode(n);
    render();
    say2(icon ? `Icon: ${ICON_LABEL(icon)}` : 'No icon');
  }
  function iconMenu(e) {
    const n = byId.get(st.sel);
    if (!n) return;
    const r = B.icon.getBoundingClientRect();
    api.menu([{ label: 'No icon', icon: 'x', disabled: !n.icon, onClick: () => setIcon('') }, '-',
      ...IDEA_ICONS.map(name => ({ label: ICON_LABEL(name), icon: name, onClick: () => setIcon(name) }))], r.left, r.bottom + 4);
  }
  function toggleConnect() {
    if (st.from) { st.from = null; render(); say2('Connect cancelled'); return; }
    if (!st.sel) return;
    st.from = st.sel;
    render();
    focusSel();
    say2('Connecting. Choose another idea, then press Enter, or click it. Escape cancels.');
  }
  function finishConnect(toId) {
    const a = st.from;
    st.from = null;
    if (!a || a === toId || !byId.has(toId)) { render(); return; }
    checkpoint();
    const i = M.links.findIndex(([x, y]) => (x === a && y === toId) || (x === toId && y === a));
    if (i >= 0) { M.links.splice(i, 1); say2('Link removed'); } else { M.links.push([a, toId]); say2('Connected'); }
    st.sel = toId;
    render();
    focusSel();
  }
  /* tree layout: branches left to right, tidy rows */
  function tidy(quiet) {
    if (!M.nodes.length || st.edit) return;
    if (!quiet) checkpoint();
    let y = 0;
    const place = (n, x) => {
      const ks = kids(n.id).filter(() => !n.collapsed);
      n.x = x;
      if (!ks.length) { n.y = y; y += NODE_H + GAP_Y; return; }
      ks.forEach(k => place(k, x + n.w + GAP_X));
      n.y = (ks[0].y + ks[ks.length - 1].y) / 2;
    };
    const rs = roots();
    rs.forEach(r => { place(r, rs.length > 1 ? r.x : 0); y += GAP_Y * 2; });
    if (quiet) changed();
    render();
    fit();
    say2('Tidied');
  }

  /* ---------------- pointer ---------------- */
  let drag = null;
  on(svg, 'pointerdown', e => {
    if (e.button !== 0) return;
    const g = e.target.closest('.mm__n');
    if (st.edit) endEdit(true);
    if (g) {
      const id = g.dataset.id;
      if (st.from) { finishConnect(id); e.preventDefault(); return; }
      st.sel = id;
      const n = byId.get(id);
      const w = toWorld(e.clientX, e.clientY);
      drag = { kind: 'node', id, start: { x: w.x, y: w.y }, orig: new Map([n, ...descendants(id)].map(d => [d.id, { x: d.x, y: d.y }])), moved: false, pre: snap(), pid: e.pointerId };
      svg.setPointerCapture(e.pointerId);
      render();
      focusSel();
      e.preventDefault();
    } else {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: M.view.x, vy: M.view.y, pid: e.pointerId };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('is-pan');
      board.focus({ preventScroll: true });
    }
  });
  on(svg, 'pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'pan') { M.view.x = drag.vx + e.clientX - drag.x; M.view.y = drag.vy + e.clientY - drag.y; applyView(); return; }
    const w = toWorld(e.clientX, e.clientY);
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * M.view.k < 4) return;
    if (!drag.moved) { drag.moved = true; undoStack.push(drag.pre); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    for (const [id, o] of drag.orig) { const n = byId.get(id); if (n) { n.x = o.x + dx; n.y = o.y + dy; } }
    render();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.kind === 'pan') svg.classList.remove('is-pan');
    if (drag.kind === 'node' && drag.moved) { changed(); say2('Moved'); }
    drag = null;
  };
  on(svg, 'pointerup', endDrag);
  on(svg, 'pointercancel', endDrag);
  on(svg, 'dblclick', e => {
    /* hit-test instead of trusting e.target: the pointer was captured, and the ideas are redrawn on every press */
    const g = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.mm__n');
    if (g) { select(g.dataset.id, false); startEdit(g.dataset.id, false); return; }
    const w = toWorld(e.clientX, e.clientY);
    addFloating(w.x, w.y);
  });
  on(svg, 'wheel', e => {
    e.preventDefault();
    const b = boardSize();
    zoomAt(M.view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - b.l, e.clientY - b.t);
  }, { passive: false });

  /* ---------------- keyboard ---------------- */
  function neighbour(dir) {
    const vis = visibleNodes();
    const cur = vis.find(v => v.n.id === st.sel);
    if (!cur) return vis[0]?.n.id;
    const n = cur.n;
    if (dir === 'left') return n.parent && shownHas(vis, n.parent) ? n.parent : null;
    if (dir === 'right') { if (n.collapsed && kids(n.id).length) { n.collapsed = false; render(); } return kids(n.id)[0]?.id || null; }
    const sibs = n.parent && byId.has(n.parent) ? kids(n.parent) : roots();
    const i = sibs.indexOf(n);
    return (dir === 'up' ? sibs[i - 1] : sibs[i + 1])?.id || null;
  }
  const shownHas = (vis, id) => vis.some(v => v.n.id === id);

  on(board, 'keydown', e => {
    if (st.edit || e.target === input) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod) {
      if (k === 's' || k === 'S') { e.preventDefault(); saveFile(false); }
      else if (k === 'z' || k === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y' || k === 'Y') { e.preventDefault(); redo(); }
      else if (k === 'f' || k === 'F') { e.preventDefault(); find.focus(); find.select(); }
      return;
    }
    if (e.altKey && /^Arrow/.test(k) && st.sel) {
      e.preventDefault();
      const n = byId.get(st.sel);
      const step = e.shiftKey ? 40 : 10;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      checkpoint();
      for (const d of [n, ...descendants(n.id)]) { d.x += dx; d.y += dy; }
      render();
      return;
    }
    if (e.altKey) return;
    if (k === 'Enter') {
      e.preventDefault();
      if (st.from && st.sel) finishConnect(st.sel);
      else addSibling();
    } else if (k === 'Tab') { e.preventDefault(); if (!e.shiftKey) addChild(); else if (st.sel) { const p = byId.get(st.sel)?.parent; if (p) select(p); } }
    else if (k === 'F2') { e.preventDefault(); if (st.sel) startEdit(st.sel, false); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSel(); }
    else if (k === ' ') { e.preventDefault(); toggleFold(); }
    else if (k === 'Escape') {
      e.preventDefault();
      if (st.from) toggleConnect();
      else B.child.focus();                 /* the way out of the board for the keyboard */
    } else if (/^Arrow/.test(k)) {
      e.preventDefault();
      const id = neighbour({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[k]);
      if (id) select(id);
    } else if (/^[1-8]$/.test(k)) recolour(Number(k) - 1);
    else if (k === 'l' || k === 'L') toggleConnect();
    else if (k === 'n' || k === 'N') { e.preventDefault(); openSide('idea'); side.querySelector('[data-fk="mm-note"]')?.focus(); }
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(1 / 1.25);
    else if (k === 'f' || k === 'F') fit();
  });
  /* the board itself is only a landing spot: focus goes straight to the selected idea */
  on(board, 'focus', () => { if (!st.edit) { const g = st.sel && nodesG.querySelector(`[data-id="${st.sel}"]`); if (g) g.focus({ preventScroll: true }); } });

  /* ---------------- search ---------------- */
  function findNow(jump) {
    const q = st.find.trim().toLowerCase();
    shell.classList.toggle('is-finding', !!q);
    if (!q) { st.hits = []; st.hitAt = -1; findCount.textContent = ''; render(); return; }
    const before = st.hits[st.hitAt];
    st.hits = M.nodes.filter(n => n.text.toLowerCase().includes(q) || (n.note && n.note.toLowerCase().includes(q))).map(n => n.id);
    st.hitAt = Math.max(0, st.hits.indexOf(before));
    findCount.textContent = st.hits.length ? `${st.hitAt + 1} of ${st.hits.length}` : 'none';
    if (jump && st.hits.length) goToHit(st.hitAt); else render();
  }
  function goToHit(i) {
    if (!st.hits.length) return;
    st.hitAt = (i + st.hits.length) % st.hits.length;
    const n = byId.get(st.hits[st.hitAt]);
    if (!n) return;
    /* open the branches it is folded inside */
    for (let p = n.parent && byId.get(n.parent); p; p = p.parent && byId.get(p.parent)) p.collapsed = false;
    st.sel = n.id;
    findCount.textContent = `${st.hitAt + 1} of ${st.hits.length}`;
    render();
    panTo(n);
    say2(`${n.text}, ${st.hitAt + 1} of ${st.hits.length}`);
  }
  on(find, 'input', () => { st.find = find.value; findNow(true); });
  on(find, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); goToHit(st.hitAt + (e.shiftKey ? -1 : 1) + (st.hitAt < 0 ? 1 : 0)); }
    else if (e.key === 'Escape') { e.preventDefault(); find.value = ''; st.find = ''; findNow(false); focusSel(); }
  });

  /* ---------------- the side panel ---------------- */
  function toggleSide(mode) { if (st.side === mode) closeSide(); else openSide(mode); }
  function openSide(mode) { st.side = mode; side.hidden = false; paintSide(); }
  function closeSide() { st.side = null; side.hidden = true; side.replaceChildren(); B.notes.setAttribute('aria-pressed', 'false'); B.share.setAttribute('aria-pressed', 'false'); focusSel(); }
  const head = (title, fk) => h('h3', h('span.grow', { text: title }), h('button.ibtn', { type: 'button', 'aria-label': 'Close the panel', dataset: { fk: `${fk}-close` }, onclick: closeSide }, api.icon('x')));
  function paintSide() {
    B.notes.setAttribute('aria-pressed', String(st.side === 'idea'));
    B.share.setAttribute('aria-pressed', String(st.side === 'share'));
    if (!st.side) return;
    if (st.side === 'idea') return ideaPanel();
    if (st.side === 'outline') return outlinePanel();
    if (st.side === 'cards') return cardsPanel();
    if (st.side === 'share') return sharePanel();
  }

  /* notes on an idea, and a link to a note in Notes */
  let noteCp = false, linkQ = '';
  const notesList = () => { const v = api.store.get('notes'); return (Array.isArray(v) ? v : []).filter(n => n && n.id && !n.trashed); };
  function ideaPanel() {
    const n = byId.get(st.sel);
    st.sideFor = st.sel;
    noteCp = false;
    if (!n) { side.replaceChildren(head('Notes', 'mm-side'), h('p', { text: 'Choose an idea to write notes on it.' })); return; }
    const ta = h('textarea', { 'aria-label': `Notes on ${n.text || 'the idea'}`, maxlength: String(NOTE_MAX), placeholder: 'Anything that doesn’t fit in the bubble: details, examples, sources…', dataset: { fk: 'mm-note' } });
    ta.value = n.note || '';
    ta.oninput = () => {
      const m = byId.get(n.id);
      if (!m) return;
      if (!noteCp) { checkpoint(); noteCp = true; }
      m.note = ta.value.slice(0, NOTE_MAX);
      changed();
      render();
    };
    ta.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); focusSel(); } e.stopPropagation(); };
    const linked = n.link ? noteTitle(n.link) : null;
    const linkBox = n.link
      ? h('div.mm__row', { dataset: { fk: 'mm-linked' } }, h('span', { text: linked ? `Linked to “${linked}”` : 'Linked to a note that isn’t here any more.' }),
        linked ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'mm-link-open' }, onclick: () => api.openApp('notes', { noteId: n.link }) }, 'Open note') : null,
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'mm-unlink' }, onclick: () => { checkpoint(); n.link = null; render(); paintSide(); } }, 'Unlink'))
      : linkPicker(n);
    side.replaceChildren(...[head(n.text || 'Idea', 'mm-side'), h('p', { text: 'Notes on this idea' }), ta,
      h('p', { text: 'Link to a note in Notes' }), linkBox,
      share && share.sess ? h('p', { text: 'Notes and links stay on this device when the map is shared.' }) : null].filter(Boolean));
  }
  function linkPicker(n) {
    const q = h('input', { type: 'text', placeholder: 'Find a note by its title', 'aria-label': 'Find a note to link', value: linkQ, dataset: { fk: 'mm-link-q' } });
    const list = h('ul.mm__list', { dataset: { fk: 'mm-link-list' } });
    const fill = () => {
      const all = notesList();
      const want = q.value.trim().toLowerCase();
      const hits = all.filter(x => !want || String(x.title || '').toLowerCase().includes(want)).sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || ''))).slice(0, 8);
      list.replaceChildren(...(hits.length ? hits.map(x => h('li', h('button', { type: 'button', dataset: { note: x.id }, text: String(x.title || '').trim() || 'Untitled note',
        onclick: () => { const m = byId.get(n.id); if (!m) return; checkpoint(); m.link = x.id; linkQ = ''; render(); paintSide(); say2(`Linked to ${x.title || 'the note'}`); } })))
        : [h('li', h('small', { text: all.length ? 'No note has that in its title.' : 'There are no notes yet. Write one in Notes first.' }))]));
    };
    q.oninput = () => { linkQ = q.value; fill(); };
    q.onkeydown = e => e.stopPropagation();
    fill();
    return h('div', q, list);
  }

  /* ---------------- make from an outline ---------------- */
  function outlinePanel() {
    const ta = h('textarea', { 'aria-label': 'Outline', placeholder: 'Paste an outline, one idea a line:\nPhotosynthesis\n  Inputs\n    Water\n    Carbon dioxide\n  Outputs\n    Glucose', dataset: { fk: 'mm-outline-text' }, style: { minHeight: '200px' } });
    ta.onkeydown = e => e.stopPropagation();
    const msg = h('p', { role: 'status', dataset: { fk: 'mm-outline-msg' } });
    const blank = isBlank();
    side.replaceChildren(head('Make from an outline', 'mm-outline'),
      h('p', { text: 'Indent with spaces or tabs, or use bullets (-, *, 1.) or headings (#). Each line becomes an idea; a line longer than an idea holds keeps the rest in its notes.' }),
      ta, h('div.mm__row', h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: 'mm-outline-go' }, onclick: () => {
        const r = fromOutline(ta.value);
        if (!r) { msg.textContent = 'There are no lines to make ideas from.'; return; }
        closeSide();
        say('Made from the outline', `${r} idea${r === 1 ? '' : 's'}${blank ? '' : ' added under the selected idea'}.`, 'network');
      } }, blank ? 'Make the map' : 'Add under the selected idea')), msg);
    requestAnimationFrame(() => { if (!dead && ta.isConnected) ta.focus(); });
  }
  const isBlank = () => M.nodes.length === 0 || (M.nodes.length === 1 && !M.nodes[0].text.trim());
  function fromOutline(src) {
    const lines = parseOutline(src);
    if (!lines.length) return 0;
    checkpoint();
    const blank = isBlank();
    const under = blank ? null : byId.get(st.sel) || null;
    if (blank) { M.nodes = []; M.links = []; reindex(); }
    const stack = [];
    let made = 0, first = null;
    for (const { depth, text } of lines) {
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : under;
      const n = mk(text.slice(0, MAX_LEN).trim(), 0, 0, parent ? parent.id : null, parent ? parent.color : 5);
      if (text.length > MAX_LEN) n.note = text.slice(0, NOTE_MAX);
      M.nodes.push(n);
      byId.set(n.id, n);
      stack.push({ depth, node: n });
      first = first || n;
      made++;
    }
    if (under) under.collapsed = false;
    reindex();
    st.sel = (under || first).id;
    tidy(true);
    return made;
  }

  /* ---------------- outline to Notes ---------------- */
  function outlineBlocks() {
    const blocks = [];
    const t = (text, b) => ({ t: b, runs: [{ text, b: false, i: false }] });
    const rs = roots();
    const walk = (n, depth) => {
      if (depth === 0 && rs.length > 1) blocks.push(t(n.text || '…', 'h1'));
      else if (depth === 1) blocks.push(t(n.text || '…', 'h2'));
      else if (depth === 2) blocks.push(t(n.text || '…', 'ul'));
      else if (depth > 2) blocks.push(t(`${'– '.repeat(depth - 2)}${n.text || '…'}`, 'ul'));
      if (n.note) for (const line of n.note.split('\n')) blocks.push(t(line, 'p'));
      for (const k of kids(n.id)) walk(k, depth + 1);
    };
    rs.forEach(r => walk(r, 0));
    return blocks;
  }
  function toNotes() {
    if (!M.nodes.some(n => n.text.trim())) { say('Nothing to export', 'Add an idea first.', 'alert'); return; }
    if (st.edit) endEdit(true);
    const title = (roots().length === 1 ? roots()[0].text : title0()) || 'Mind map';
    const body = [NF.serialize(outlineBlocks()), st.path ? NF.fromPlain(`From the mind map ${st.path.replace(vfs.HOME, '~')}.`) : ''].filter(Boolean).join('\n\n');
    const note = { id: `note-${Date.now().toString(36)}-mm${Math.random().toString(36).slice(2, 5)}`, title: title.slice(0, 120), body, fmt: NF.FMT, mtime: new Date().toISOString() };
    const cur = api.store.get('notes');
    api.store.set('notes', [...(Array.isArray(cur) ? cur : []), note]);
    if (!(api.store.get('notes') || []).some(n => n && n.id === note.id)) { say('Could not save the note', 'Notes did not take it.', 'alert'); return; }
    root.dataset.lastNote = note.id;
    say('Outline saved to Notes', `“${note.title}”: ${M.nodes.length} idea${M.nodes.length === 1 ? '' : 's'}.`, 'sticky-note', [{ label: 'Open in Notes', onClick: () => api.openApp('notes', { noteId: note.id }) }]);
  }
  const title0 = () => roots()[0]?.text || '';

  /* ---------------- flashcards from the leaf ideas ---------------- */
  const pathOf = n => { const out = []; for (let p = n.parent && byId.get(n.parent); p; p = p.parent && byId.get(p.parent)) out.unshift(p.text); return out; };
  /** One card per leaf idea (the end of a branch): its words on the front; on the back, its notes if it
      has any, else what follows "::" or ": " in it, else the branch it sits on. An idea standing alone
      with no notes has nothing to ask, so it makes no card. */
  function leafCards() {
    const out = [];
    for (const n of M.nodes) {
      if (!n.text.trim() || kids(n.id).length) continue;
      const path = pathOf(n);
      const split = /^(.+?)\s*(?:::|:\s)\s*(.+)$/.exec(n.text);
      let front, back;
      if (n.note && n.note.trim()) { front = n.text; back = n.note.trim(); }
      else if (split) { front = split[1].trim(); back = split[2].trim(); }
      else if (path.length) { front = n.text; back = path.join(' › '); }
      else continue;
      out.push({ id: n.id, front: front.slice(0, 1000).trim(), back: back.slice(0, 1000).trim() });
    }
    return out;
  }
  let cardsDone = null;
  function cardsPanel() {
    const cards = leafCards();
    const name = h('input', { type: 'text', 'aria-label': 'Deck name', value: (title0() || 'Mind map').slice(0, 60), dataset: { fk: 'mm-deck' } });
    name.onkeydown = e => e.stopPropagation();
    const kids1 = [head('Flashcards from the leaf ideas', 'mm-cards'),
      h('p', { text: 'One card for each idea at the end of a branch: the idea on the front; on the back its notes, or what comes after “::” or “: ” in it, or else the branch it is on.' })];
    if (!cards.length) kids1.push(h('p', { dataset: { fk: 'mm-cards-none' }, text: 'No leaf ideas to make cards from yet. Add ideas at the ends of branches, or notes on a lone idea.' }));
    else {
      kids1.push(h('ul.mm__cards', { dataset: { fk: 'mm-cards-list', n: String(cards.length) } }, ...cards.slice(0, 40).map(c => h('li', h('b', { text: c.front }), h('br'), h('span', { text: c.back })))),
        cards.length > 40 ? h('p', { text: `…and ${cards.length - 40} more.` }) : null,
        h('label', h('p', { text: 'Deck in Static Study' }), name),
        h('div.mm__row', h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: 'mm-cards-go' }, onclick: () => addCards(cards, name.value) }, `Add ${cards.length} card${cards.length === 1 ? '' : 's'}`)));
    }
    if (cardsDone) kids1.push(h('p', { role: 'status', dataset: { fk: 'mm-cards-done' }, text: cardsDone.msg }),
      h('div.mm__row', h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'mm-study' }, onclick: () => api.openApp('study', { tab: 'cards', deck: cardsDone.deck, start: 'study' }) }, 'Study now'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => api.openApp('study', { tab: 'cards', deck: cardsDone.deck }) }, 'Open deck')));
    side.replaceChildren(...kids1.filter(Boolean));
  }
  async function addCards(cards, deckName) {
    const FC = await import('../core/flashcards.js');
    if (dead) return;
    const data = FC.read();
    const nm = String(deckName || '').trim().slice(0, 60) || 'Mind map';
    let deck = data.decks.find(d => d.name === nm);
    if (!deck) {
      if (data.decks.length >= FC.MAX_DECKS) { cardsDone = null; say('Study has as many decks as it can hold', `Delete one in Study › Flashcards first (the most is ${FC.MAX_DECKS}).`, 'alert'); return; }
      deck = FC.normDeck({ name: nm });
      data.decks.push(deck);
    }
    const have = new Map(deck.cards.map(c => [c.front.trim().toLowerCase(), c]));
    let added = 0, same = 0, full = 0;
    for (const c of cards) {
      const had = have.get(c.front.trim().toLowerCase());
      if (had) { if (had.back !== c.back) had.back = c.back; same++; continue; }
      if (deck.cards.length >= FC.MAX_CARDS) { full++; continue; }
      const card = FC.normCard({ front: c.front, back: c.back });
      deck.cards.push(card);
      have.set(c.front.trim().toLowerCase(), card);
      added++;
    }
    const written = FC.write(data);
    const id = (written.decks.find(d => d.name === nm) || deck).id;
    cardsDone = { deck: id, msg: `${added} card${added === 1 ? '' : 's'} added to “${nm}”${same ? `; ${same} ${same === 1 ? 'was' : 'were'} already there` : ''}${full ? `; ${full} didn’t fit` : ''}.` };
    if (st.side === 'cards') paintSide();
  }

  /* ---------------- print ---------------- */
  let printEl = null;
  function printMap() {
    const d = drawing();
    if (!d) { say('Nothing to print', 'Add an idea first.', 'alert'); return; }
    if (printEl) printEl.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = d.svgText;
    const list = n => h('li', h('span', { text: n.text || '…' }), n.note ? h('div.mm-print__note', { text: n.note }) : null,
      kids(n.id).length ? h('ul', ...kids(n.id).map(list)) : null);
    printEl = h('div.mm-print', { 'aria-hidden': 'true' }, h('h1', { text: title0() || 'Mind map' }), tmp.firstElementChild, h('ul', ...roots().map(list)));
    document.body.appendChild(printEl);
    document.documentElement.classList.add('mm-printing');
    const done = () => { document.documentElement.classList.remove('mm-printing'); printEl?.remove(); printEl = null; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(done, 120000);
    try { window.print(); } catch (e) { done(); }
  }
  win.state.print = printMap;

  function moreMenu() {
    const r = B.more.getBoundingClientRect();
    api.menu([
      { label: 'Make from an outline…', icon: 'list', onClick: () => openSide('outline') },
      { label: 'Outline to Notes', icon: 'sticky-note', onClick: () => toNotes() },
      { label: 'Flashcards from the leaf ideas…', icon: 'layers', onClick: () => { cardsDone = null; openSide('cards'); } },
      '-',
      { label: 'Print…', icon: 'printer', onClick: () => printMap() },
    ], r.left, r.bottom + 4);
  }

  /* ---------------- share live ---------------- */
  const SHARE_ERR = {
    invalid: 'That isn’t a room code — codes are 6 letters and numbers, like K7QM2X.',
    nobody: 'Nobody answered that code. Check it, and that your friend still has the map shared.',
    full: 'That map already has two people on it.',
    insecure: 'Sharing live needs a secure (https) page for its encryption.',
  };
  const inviteLink = code => { try { return `${location.origin}${location.pathname}#map=${code}`; } catch (e) { return ''; } };
  let share = null;                 /* { role, sess, off, phase, peer, err, code } */
  let shareDraft = { role: 'host', code: '', err: '' };
  function shareLocal() {
    if (!share || !share.sess || share.sess.applying) return;
    share.sess.local({ nodes: M.nodes.filter(n => n.text.trim()) });
  }
  async function startShare(role, code = null) {
    if (share) return;
    if (role === 'guest' && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code || '')) { shareDraft.err = SHARE_ERR.invalid; paintSide(); return; }
    const mod = await import('../core/mapshare.js');
    if (dead || share) return;
    if (st.edit) endEdit(true);
    /* joining opens the friend's map here: what was here is saved to Documents first */
    if (role === 'guest' && !isBlank()) saveFile(true);
    share = { role, sess: null, off: null, phase: 'connecting', peer: '' };
    shareDraft.err = '';
    share.sess = mod.shareMap({
      role, code,
      read: () => ({ nodes: M.nodes.filter(n => n.text.trim()) }),
      write: view => applyShared(view),
    });
    share.off = share.sess.on((type, data) => {
      if (dead || !share) return;
      if (type === 'phase') share.phase = data;
      else if (type === 'peer') {
        share.phase = 'paired';
        share.peer = share.sess.peerName || 'Your friend';
        say(role === 'host' ? `${share.peer} joined your map` : `Joined ${share.peer}’s map`, 'Ideas you add, move or rename show up for both of you.', 'users');
      } else if (type === 'ended') { endShare(data); return; }
      paintLive();
      if (st.side === 'share') paintSide();
    });
    if (role === 'guest') {
      /* a fresh map in this window, filled in by the friend's */
      M = { nodes: [], links: [], view: M.view };
      st.path = null; st.dirty = false; win.state.reopen = null;
      undoStack.length = 0; redoStack.length = 0;
      reindex(); render(); paintStatus();
    }
    paintLive();
    paintSide();
  }
  /* the merged ideas, into this window: notes, links to notes, folds and connections stay as they are here */
  function applyShared(view) {
    const prev = new Map(M.nodes.map(n => [n.id, n]));
    const editing = st.edit && prev.get(st.edit.id);
    M.nodes = view.nodes.map(v => {
      const old = prev.get(v.id);
      const n = { id: v.id, text: v.text, x: v.x, y: v.y, parent: v.parent, color: v.color, shape: shapeOk(v.shape), icon: iconOk(v.icon),
        collapsed: old ? old.collapsed : false, note: old ? old.note : '', link: old ? old.link : null };
      if (editing && editing.id === v.id) n.text = editing.text;          /* the words being typed here win until Enter */
      sizeNode(n);
      return n;
    });
    if (editing && !M.nodes.some(n => n.id === editing.id)) M.nodes.push(editing);
    const ids = new Set(M.nodes.map(n => n.id));
    M.links = M.links.filter(([a, b]) => ids.has(a) && ids.has(b));
    seq = Math.max(seq, seqOf(M.nodes));
    /* undo goes back over this device's own changes only until the friend's next one */
    undoStack.length = 0; redoStack.length = 0;
    reindex();
    if (!byId.has(st.sel)) st.sel = M.nodes[0]?.id || null;
    changed(true);
    render();
    if (st.side === 'idea') paintSide();
  }
  function stopShare(reason) { if (share && share.sess) share.sess.leave(); else if (share) endShare(reason); }
  function endShare(reason) {
    const s = share;
    if (!s) return;
    try { s.off && s.off(); } catch (e) { /* gone */ }
    share = null;
    if (dead) return;
    const who = s.peer || 'your friend';
    if (SHARE_ERR[reason]) shareDraft = { role: s.role, code: shareDraft.code, err: SHARE_ERR[reason] };
    else if (reason === 'left' || reason === 'lost touch') say(reason === 'left' ? `${who} left` : `Lost touch with ${who}`, 'The map isn’t shared any more. Your copy stays here as it is now.', 'users');
    else if (reason === 'you left' && s.phase === 'paired') say2('Stopped sharing. Your copy stays here.');
    paintLive();
    if (st.side === 'share') paintSide();
  }
  function paintLive() {
    liveChip.hidden = !share;
    liveChip.textContent = !share ? '' : share.phase === 'paired' ? `Live with ${share.peer}` : share.role === 'host' ? 'Waiting for your friend' : 'Joining…';
  }
  async function copyInvite(code) {
    const link = inviteLink(code);
    try { await navigator.clipboard.writeText(`Work on my mind map with me in Mind Maps — room code ${code}${link ? ` · ${link}` : ''}`); say('Invite copied', `Room code ${code}.`, 'copy'); }
    catch (e) { say(`Room code ${code}`, 'Copying was blocked here — read the code out instead.', 'info'); }
  }
  function sharePanel() {
    const kids1 = [head('Share live', 'mm-share')];
    const what = h('p', { text: 'What travels: the ideas — their words, places, branches, colours, shapes and icons. Notes on ideas, links to notes and the connections between branches stay on each device.' });
    if (!share && shareDraft.role === 'host') {
      kids1.push(h('p', { text: 'Share this map with a friend: you both add, move and rename ideas, and see each other’s changes as they happen.' }), what,
        h('div.mm__row', h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: 'share-go' }, onclick: () => startShare('host') }, api.icon('users'), h('span', { text: 'Start sharing' }))),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'share-swap' }, onclick: () => { shareDraft.role = 'guest'; paintSide(); side.querySelector('[data-fk="share-code"]')?.focus(); } }, 'Or join a friend’s map'));
    } else if (!share) {
      const inp = h('input', { type: 'text', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Friend’s code', 'aria-label': 'Room code from your friend', value: shareDraft.code || '', dataset: { fk: 'share-code' } });
      inp.oninput = () => { shareDraft.code = inp.value; };
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); join(); } };
      const join = () => { const c = inp.value.replace(/[\s-]+/g, '').toUpperCase(); shareDraft.code = c; startShare('guest', c); };
      kids1.push(h('p', { text: 'Type the room code your friend shared, then Join.' }), inp,
        h('div.mm__row', h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: 'share-join' }, onclick: join }, 'Join'),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { shareDraft.role = 'host'; paintSide(); } }, 'Share mine instead')),
        h('p', { text: isBlank() ? 'Joining opens your friend’s map in this window, and it is yours to keep when either of you leaves.' : 'Joining opens your friend’s map in this window. The map here now is saved to Documents first.' }));
    } else if (share.phase === 'paired') {
      kids1.push(h('p', { dataset: { fk: 'share-with' }, text: share.role === 'host' ? `Sharing this map with ${share.peer}.` : `On ${share.peer}’s map.` }), what);
    } else if (share.role === 'host') {
      const code = share.sess.code;
      kids1.push(h('p', { text: 'Your room code' }),
        h('div.mm__code', { role: 'group', 'aria-label': `Room code ${code.split('').join(' ')}`, dataset: { code, fk: 'share-codebox' } }, ...[...code].map(ch => h('span', { text: ch, 'aria-hidden': 'true' }))),
        h('input', { type: 'text', readonly: true, value: inviteLink(code), 'aria-label': 'Invite link', dataset: { fk: 'share-link' }, onfocus: e => e.target.select() }),
        h('div.mm__row', h('button.btn.btn--sm', { type: 'button', onclick: () => copyInvite(code) }, api.icon('copy'), h('span', { text: 'Copy invite' }))),
        h('p', { text: share.phase === 'waiting' ? 'Waiting for your friend — keep working, they’ll get all of it.' : 'Opening the room…' }));
    } else kids1.push(h('p', { text: `Joining ${share.sess.code}…` }));
    if (shareDraft.err && !share) kids1.push(h('p.mm__err', { role: 'alert', dataset: { fk: 'share-err' }, text: shareDraft.err }));
    if (share) kids1.push(h('div.mm__row', h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'share-stop' }, onclick: () => stopShare('you left') }, share.phase === 'paired' ? (share.role === 'host' ? 'Stop sharing' : 'Leave') : 'Cancel')));
    kids1.push(h('p', { text: 'This runs over StaticOS’s live connection, a free public relay. The map is encrypted with the room code before it leaves this device, so anyone watching the relay sees sealed bytes, not your ideas — but the code is short and anyone who has it could join first, so treat it like a password. Sharing stops when either of you leaves or closes the window.' }));
    side.replaceChildren(...kids1);
  }

  /* ---------------- files ---------------- */
  const safeName = t => (String(t || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 40) || 'Mind map');
  function title() { return roots()[0]?.text || ''; }
  function saveFile(auto) {
    clearTimeout(saveTimer);
    if (st.edit && !auto) endEdit(true);
    const json = JSON.stringify(plain(), null, 1);
    try {
      if (!st.path) {
        if (!vfs.node(DOCS)) vfs.mkdir(DOCS);
        const stem = safeName(title());
        let name = `${stem}.mindmap`, i = 2;
        while (vfs.node(`${DOCS}/${name}`)) name = `${stem} ${i++}.mindmap`;
        const node = vfs.write(`${DOCS}/${name}`, json);
        if (!node) throw new Error('Documents is not available.');
        st.path = `${DOCS}/${name}`;
        win.state.reopen = { path: st.path };
      } else vfs.write(st.path, json);
      st.dirty = false;
      st.saved = json;
      paintStatus();
      if (!auto) say('Saved', st.path.replace(vfs.HOME, '~'), 'save');
    } catch (err) {
      say('Could not save', String(err.message || err), 'alert');
    }
  }

  /* ---------------- export ---------------- */
  function drawing(pad = 32) {
    const vis = visibleNodes().map(v => v.n);
    if (!vis.length) return null;
    const x0 = Math.min(...vis.map(n => n.x)), y0 = Math.min(...vis.map(n => n.y));
    const x1 = Math.max(...vis.map(n => n.x + n.w)), y1 = Math.max(...vis.map(n => n.y + n.h));
    const W = Math.ceil(x1 - x0 + pad * 2), H = Math.ceil(y1 - y0 + pad * 2);
    const ox = pad - x0, oy = pad - y0;
    const shown = new Set(vis.map(n => n.id));
    const parts = [];
    for (const n of vis) if (n.parent && shown.has(n.parent)) { const [a, b, d] = sideOf(byId.get(n.parent), n); parts.push(`<path d="${curve(a, b, d)}" fill="none" stroke="#7a7f93" stroke-width="2"/>`); }
    for (const [a, b] of M.links) if (shown.has(a) && shown.has(b)) { const [p, q, d] = sideOf(byId.get(a), byId.get(b)); parts.push(`<path d="${curve(p, q, d)}" fill="none" stroke="#d6336c" stroke-width="2" stroke-dasharray="6 5"/>`); }
    for (const n of vis) {
      const tx = n.w / 2 + (n.icon ? ICON_W / 2 : 0);
      parts.push(`<g transform="translate(${n.x} ${n.y})">${shapeMarkup(n, COLORS[n.color], 'rgba(0,0,0,.28)').replace(' class="mm__shape"', '')}`
        + (n.icon ? `<g transform="translate(${PAD_X - 4} ${n.h / 2 - 8}) scale(${16 / 24})" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconBody(n.icon)}</g>` : '')
        + `<text x="${tx}" y="${n.h / 2 + 5}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600" font-size="14" fill="${INK}">${esc(n.text || '…')}</text>`
        + (n.collapsed && kids(n.id).length ? `<circle cx="${n.w}" cy="0" r="11" fill="${INK}"/><text x="${n.w}" y="4" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#fff">${hiddenCount(n)}</text>` : '')
        + '</g>');
    }
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fbfbfd"/>`
      + `<g transform="translate(${ox} ${oy})">${parts.join('')}</g></svg>`;
    return { svgText, W, H };
  }
  async function exportSvg() {
    const d = drawing();
    if (!d) return say('Nothing to export', 'Add an idea first.', 'alert');
    try {
      const out = await media.save(PICS, `${safeName(title())}.svg`, new Blob([d.svgText], { type: 'image/svg+xml' }));
      say('Exported SVG', out.path.replace(vfs.HOME, '~'), 'image');
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }
  const SCALE = 2;
  async function exportPng() {
    const d = drawing();
    if (!d) return say('Nothing to export', 'Add an idea first.', 'alert');
    try {
      const url = URL.createObjectURL(new Blob([d.svgText], { type: 'image/svg+xml' }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = d.W * SCALE; cv.height = d.H * SCALE;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('The picture could not be made.');
      const out = await media.save(PICS, `${safeName(title())}.png`, blob);
      say('Exported PNG', `${out.path.replace(vfs.HOME, '~')} · ${cv.width}×${cv.height}`, 'image');
      root.dataset.lastExport = JSON.stringify({ path: out.path, w: cv.width, h: cv.height });
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }

  /* what a test (or a curious person) can ask for */
  root.mindmapPeek = () => ({ path: st.path, dirty: st.dirty, sel: st.sel, editing: !!st.edit, side: st.side, hits: st.hits.slice(), share: share ? { role: share.role, phase: share.phase, peer: share.peer, code: share.sess && share.sess.code } : null,
    nodes: M.nodes.map(n => ({ id: n.id, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, parent: n.parent, color: n.color, collapsed: n.collapsed, shape: n.shape, icon: n.icon, note: n.note, link: n.link })),
    links: M.links.slice(), view: { ...M.view }, scale: SCALE, pad: 32, cards: leafCards() });

  /* ---------------- open ---------------- */
  let fresh = true;
  const fileNode = opts && opts.path ? vfs.node(opts.path) : null;
  if (fileNode && fileNode.type === 'file') {
    try {
      const j = JSON.parse(vfs.read(opts.path) || '{}');
      if (j && Array.isArray(j.nodes)) { load(j); st.path = vfs.norm(opts.path); st.saved = snap(); fresh = false; win.state.reopen = { path: st.path }; }
      else throw new Error('not a mind map');
    } catch (err) {
      say('Could not open that file', `${vfs.baseName(opts.path)} is not a mind map.`, 'alert');
    }
  }
  if (fresh) { const r = mk('', 0, 0, null, 5); M.nodes.push(r); }
  reindex();
  st.sel = roots()[0]?.id || null;
  st.dirty = false;
  paintStatus();
  render();
  /* an invite link (#map=CODE) only fills the code in: nothing is joined until Join is pressed */
  const handleOpts = o => {
    if (o && typeof o.mapJoin === 'string') { if (!share) shareDraft = { role: 'guest', code: o.mapJoin, err: '' }; openSide('share'); return true; }
    return false;
  };
  const joining = handleOpts(opts);
  requestAnimationFrame(() => {
    if (dead) return;
    if (fresh) { M.view = { x: 0, y: 0, k: 1 }; centre(); }
    else applyView();
    if (joining) return;
    if (fresh) startEdit(st.sel, true, false); else focusSel();
  });
  win.onReopen?.(o => handleOpts(o));
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeInput()) : null;
  ro?.observe(board);

  return () => {
    dead = true;
    clearTimeout(saveTimer);
    clearTimeout(typingT);
    if (share && share.sess) { try { share.sess.leave(); } catch (e) { /* closing anyway */ } }
    if (st.path && st.dirty) { try { vfs.write(st.path, JSON.stringify(plain(), null, 1)); } catch (e) { /* closing anyway */ } }
    if (printEl) { printEl.remove(); document.documentElement.classList.remove('mm-printing'); }
    ro?.disconnect();
    offs.splice(0).forEach(f => f());
  };
}
