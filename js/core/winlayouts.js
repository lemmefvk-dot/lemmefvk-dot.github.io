/* ============================================================
   winlayouts.js — arranging whole sets of windows.

     Show Desktop        everything on this desktop out of the way;
                         again, and it all comes back
     Hide Others         every window but the front one (and its tabs)
     Tile All Windows    every window on this desktop into a grid
     Save Layout…        remember which apps are where, by name (up to
                         12), and put them back later from the Window
                         menu or Spotlight
     Window memory       each app opens where and how big it last was;
                         "Reset window positions" forgets it

   No window of its own: the window manager (js/core/wm.js) does the
   moving. Saved things live in session.winLayouts and session.winGeom,
   so each person has their own. A saved layout holds apps and places,
   not what they were showing: Files comes back as a Files window.
   ============================================================ */
import { bus } from './bus.js';
import { h } from './dom.js';
import { store } from './store.js';
import { getApp } from './registry.js';
import * as wm from './wm.js';
import * as L from './layers.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

export const MAX_LAYOUTS = 12;
export const LAYOUTS_KEY = 'session.winLayouts';
export const GEOM_KEY = 'session.winGeom';
const NAME_MAX = 40;
const phone = () => document.body.classList.contains('is-mobile');
const say = t => bus.emit('a11y:say', t);
const notify = n => bus.emit('noti:push', { app: 'Windows', icon: 'window', timeout: 4500, ...n });
const here = () => wm.onDesktop().filter(w => !w.tabHidden);

/* ---------------- Show Desktop / Hide Others ---------------- */
let cleared = [];
/** Out of the way, or back. Returns 'hidden' | 'restored' | null (nothing to do). */
export function showDesktop() {
  const open = here().filter(w => !w.min);
  if (open.length) {
    cleared = open.map(w => w.id);
    open.forEach(w => wm.minimize(w));
    say('Desktop shown');
    return 'hidden';
  }
  const back = cleared.map(id => wm.get(id)).filter(w => w && w.min);
  cleared = [];
  back.forEach(w => wm.restore(w));
  return back.length ? 'restored' : null;
}
export const desktopShown = () => !here().some(w => !w.min) && cleared.some(id => wm.get(id)?.min);

/** Everything on this desktop except w and the tabs it is grouped with. */
export function hideOthers(w) {
  if (!w) return 0;
  const keep = new Set([w, ...(w.group ? w.group.tabs : [])]);
  const others = here().filter(x => !x.min && !keep.has(x));
  others.forEach(x => wm.minimize(x));
  if (others.length) say(`${others.length} other window${others.length === 1 ? '' : 's'} hidden`);
  return others.length;
}

/* ---------------- tile ---------------- */
/** A grid for n windows inside the work area. Of the ways to cut the screen into
    columns and rows it takes the one where every window gets at least its app's
    smallest size, and of those the one whose cells are closest to a window's own
    shape; the last row is stretched across. mins: [{ w, h }] per window, in order. */
export function gridRects(n, area = wm.workArea(), gap = 6, mins = []) {
  if (n < 1) return [];
  let best = null;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const ch = (area.h - gap * (rows + 1)) / rows;
    let lack = 0;
    for (let i = 0; i < n; i++) {
      const inRow = Math.min(c, n - Math.floor(i / c) * c);
      const cw = (area.w - gap * (inRow + 1)) / inRow;
      const m = mins[i] || { w: 0, h: 0 };
      lack += Math.max(0, m.w - cw) + Math.max(0, m.h - ch);
    }
    const cw0 = (area.w - gap * (c + 1)) / c;
    const shape = Math.abs(Math.log((cw0 / ch) / 1.5));
    const score = lack * 1000 + shape;
    if (!best || score < best.score) best = { c, rows, ch, score };
  }
  const { c, ch } = best;
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / c);
    const inRow = Math.min(c, n - row * c);
    const cw = (area.w - gap * (inRow + 1)) / inRow;
    out.push({ x: area.x + gap + (i % c) * (cw + gap), y: area.y + gap + row * (ch + gap), w: cw, h: ch });
  }
  return out;
}
/** Tile every window on this desktop (hidden ones stay hidden). Returns how many. */
export function tileAll() {
  if (phone()) return 0;
  const list = here().filter(w => !w.min).sort((a, b) => a.x - b.x || a.y - b.y);
  const rects = gridRects(list.length, wm.workArea(), 6, list.map(w => ({ w: w.app.win.minW, h: w.app.win.minH })));
  list.forEach((w, i) => wm.arrange(w, rects[i]));
  if (list.length) say(`${list.length} window${list.length === 1 ? '' : 's'} tiled`);
  return list.length;
}

/* ---------------- layouts ---------------- */
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const num = v => (Number.isFinite(v) ? Math.round(v) : 0);

export function layouts() {
  const v = store.get(LAYOUTS_KEY);
  return (Array.isArray(v) ? v : []).filter(l => l && typeof l.name === 'string' && Array.isArray(l.rows));
}

/** Remember the windows on this desktop, bottom of the stack first. */
export function saveLayout(name) {
  const nm = cleanName(name);
  if (!nm) return null;
  const rows = here().sort((a, b) => a.z - b.z).map(w => {
    const r = w.max ? w.prev || w.rect : w.snapped ? w.free || w.rect : w.rect;
    const cur = w.rect;
    return {
      app: w.appId, min: !!w.min, max: !!w.max && !w.snapped, snapped: w.snapped || null,
      rect: { x: num(w.snapped || w.max ? cur.x : r.x), y: num(w.snapped || w.max ? cur.y : r.y), w: num(w.snapped || w.max ? cur.w : r.w), h: num(w.snapped || w.max ? cur.h : r.h) },
    };
  });
  if (!rows.length) return null;
  const all = layouts().filter(l => l.name.toLowerCase() !== nm.toLowerCase());
  if (all.length >= MAX_LAYOUTS) return null;
  store.set(LAYOUTS_KEY, [...all, { name: nm, rows }]);
  say(`Layout ${nm} saved`);
  return nm;
}
export function deleteLayout(name) {
  store.set(LAYOUTS_KEY, layouts().filter(l => l.name !== name));
}

/** Put a saved layout back on this desktop: windows already open for an app are
    moved, missing ones are opened, the rest are left where they are. */
export function restoreLayout(name) {
  const lay = layouts().find(l => l.name === name);
  if (!lay || phone()) return 0;
  const pool = wm.onDesktop().filter(w => !w.tabHidden);
  const used = new Set();
  const placed = [];
  for (const row of lay.rows) {
    const app = getApp(row.app);
    if (!app) continue;
    let w = pool.find(x => x.appId === row.app && !used.has(x));
    if (!w) w = wm.open(row.app, { ...row.rect });
    if (!w || used.has(w)) continue;
    used.add(w);
    if (w.min && !row.min) wm.restore(w);
    if (row.snapped && wm.snapRect(row.snapped)) { w.quietSnap = true; try { wm.snap(w, row.snapped); } finally { w.quietSnap = false; } }
    else if (row.max) { w.quietSnap = true; try { wm.snap(w, 'max'); } finally { w.quietSnap = false; } }
    else {
      if (w.max) wm.toggleMax(w);
      wm.arrange(w, row.rect);
    }
    placed.push([w, row]);
  }
  /* stack them as they were: lowest first, each brought to the front in turn */
  for (const [w, row] of placed) if (!row.min) wm.focus(w);
  for (const [w, row] of placed) if (row.min && !w.min) wm.minimize(w);
  say(`Layout ${name} restored`);
  return placed.length;
}

/** The little sheet that asks for a name. Resolves the saved name, or null. */
export function askLayoutName() {
  if (!here().length) { notify({ title: t('Nothing to save'), message: t('Open a few windows first, then save where they are.') }); return Promise.resolve(null); }
  return new Promise(resolve => {
    const host = document.getElementById('os') || document.body;
    const taken = layouts();
    const input = h('input.input', { type: 'text', maxlength: String(NAME_MAX), value: `Layout ${taken.length + 1}`, 'aria-label': t('Layout name'), spellcheck: 'false' });
    const note = h('div.muted', { style: { fontSize: 'var(--fs-12)' }, text: `Saves where the ${here().length} window${here().length === 1 ? '' : 's'} on this desktop are.` });
    let done = false, rel = null;
    const finish = v => {
      if (done) return;
      done = true;
      rel?.();
      wrap.remove();
      resolve(v);
    };
    const save = () => {
      const nm = cleanName(input.value);
      if (!nm) { input.focus(); return; }
      const clash = taken.some(l => l.name.toLowerCase() === nm.toLowerCase());
      if (!clash && taken.length >= MAX_LAYOUTS) { note.textContent = t('That is the most layouts ({MAX_LAYOUTS}). Delete one first.', { MAX_LAYOUTS }); return; }
      const saved = saveLayout(nm);
      if (saved) notify({ title: clash ? t('Layout updated') : t('Layout saved'), message: saved });
      finish(saved);
    };
    const card = h('div.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Save window layout'),
      style: { width: 'min(380px,90vw)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' } },
      h('div.h-sec', { text: t('Save this layout') }), input, note,
      h('div.row', { style: { justifyContent: 'flex-end', marginTop: 'var(--sp-2)' } },
        h('button.btn.btn--ghost', { text: t('Cancel'), onclick: () => finish(null) }),
        h('button.btn.btn--primary', { text: t('Save'), onclick: save })));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const wrap = h('div.spot-wrap', { style: { alignItems: 'center', paddingTop: '0' }, onpointerdown: e => { if (e.target === wrap) finish(null); } }, card);
    host.appendChild(wrap);
    rel = L.push({ name: 'winlayout', el: card, trap: true, close: () => finish(null) });
    input.focus({ preventScroll: true });
    input.select();
  });
}

/* ---------------- window memory ---------------- */
const geom = () => { const v = store.get(GEOM_KEY); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const sane = r => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w >= 120 && r.h >= 80;
function recall(appId) {
  if (phone()) return null;
  const r = geom()[appId];
  return sane(r) ? { ...r } : null;
}
function remember(w) {
  if (!w || phone() || w.tabHidden || !wm.get(w.id)) return;
  /* a snapped or maximised window remembers the size it had before */
  const r = w.max || w.snapped ? w.free || w.prev : w.rect;
  if (!sane(r)) return;
  const next = { x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) };
  const was = geom()[w.appId];
  if (was && was.x === next.x && was.y === next.y && was.w === next.w && was.h === next.h) return;
  store.set(GEOM_KEY, { ...geom(), [w.appId]: next });
}
export const hasMemory = () => Object.keys(geom()).length > 0;
export function resetPositions() {
  const n = Object.keys(geom()).length;
  store.set(GEOM_KEY, {});
  say('Window positions reset');
  return n;
}

/* ---------------- menus: the Window menu and Spotlight use these ---------------- */
/** Rows for a Window menu: Show Desktop, Hide Others, Tile All, Layouts. */
export function menuItems(w) {
  const all = layouts();
  const open = here().filter(x => !x.min);
  return [
    { label: t('Show Desktop'), icon: 'desktop', checked: desktopShown() || undefined, disabled: !open.length && !cleared.length, onClick: () => showDesktop() },
    { label: t('Hide Others'), icon: 'eye-off', disabled: !w || !open.some(x => x !== w && !(w.group && w.group.tabs.includes(x))), onClick: () => hideOthers(w) },
    { label: t('Tile All Windows'), icon: 'grid', disabled: open.length < 2, onClick: () => tileAll() },
    { label: t('Layouts'), icon: 'layers', items: [
      ...all.map(l => ({ label: l.name, hint: `${l.rows.length} window${l.rows.length === 1 ? '' : 's'}`, onClick: () => restoreLayout(l.name) })),
      all.length ? '-' : null,
      { label: t('Save Layout…'), icon: 'save', disabled: !here().length, onClick: () => askLayoutName() },
      all.length ? { label: t('Delete Layout'), icon: 'trash', items: all.map(l => ({ label: l.name, danger: true, onClick: () => { deleteLayout(l.name); say(`Layout ${l.name} deleted`); } })) } : null,
    ].filter(Boolean) },
  ];
}

/** The window menu's Transparency row: a slider, 60–100 % opaque (100 is solid). */
export function transparencyItem(w) {
  return { node: () => {
    const say = v => (v >= 100 ? 'Solid' : `${v}% opaque`);
    const out = h('small', { text: say(w.alpha || 100) });
    const input = h('input', { type: 'range', min: '60', max: '100', step: '5', value: String(w.alpha || 100),
      'aria-label': t('Window transparency, percent opaque'), tabindex: '-1' });
    input.addEventListener('input', () => { const v = wm.setOpacity(w, Number(input.value)); out.textContent = say(v); input.setAttribute('aria-valuetext', say(v)); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') e.stopPropagation(); });
    const el = h('div.menu__item.menu__slider', { role: 'menuitem', 'aria-label': t('Transparency') },
      icon('eye'), h('span.grow', { text: t('Transparency') }), input, out);
    el.focus = o => input.focus(o);
    return el;
  } };
}

/** Commands for Spotlight (js/shell/spotlight.js adds these to its own list). */
export function commands() {
  const out = [
    { label: t('Hide Other Windows'), icon: 'eye-off', hint: 'Windows', when: () => !!wm.getActive() && here().filter(x => !x.min).length > 1, run: () => hideOthers(wm.getActive()) },
    { label: t('Tile All Windows'), icon: 'grid', hint: 'Windows', when: () => here().filter(x => !x.min).length > 1, run: tileAll },
    { label: t('Save Window Layout…'), icon: 'save', hint: 'Windows', when: () => here().length > 0, run: () => askLayoutName() },
    { label: t('Reset Window Positions'), icon: 'refresh', hint: 'Windows', when: hasMemory, run: () => { resetPositions(); notify({ title: t('Window positions reset'), message: t('Apps open in their usual places again.') }); } },
  ];
  for (const l of layouts()) out.push({ label: t('Restore Layout: {name}', { name: l.name }), icon: 'layers', hint: `Windows · ${l.rows.length} window${l.rows.length === 1 ? '' : 's'}`, run: () => restoreLayout(l.name) });
  return out;
}

let started = false;
export function init() {
  if (started || typeof window === 'undefined') return;
  started = true;
  wm.useMemory(recall);
  /* the person moved or sized a window: that is where its app opens next time */
  bus.on('win:move', remember);
  bus.on('win:resize', remember);
}

export default { init, transparencyItem, showDesktop, hideOthers, tileAll, saveLayout, restoreLayout, deleteLayout, layouts, menuItems, commands, resetPositions, hasMemory, askLayoutName, gridRects };
