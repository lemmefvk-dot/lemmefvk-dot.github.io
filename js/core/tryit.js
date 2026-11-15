/* ============================================================
   tryit.js — the "Try it" checklist: a few things worth trying once,
   each ticked by the real event when you do it.

   Nothing is ticked by hand and nothing is ticked for what StaticOS
   does by itself at start-up: every item waits for the bus event its
   own feature emits (and only once the desktop is up).

     spotlight:shown   Search: Spotlight opened (shell/spotlight.js)
     win:snap          Snap a window to a side or corner
     tabs:join         Drag one window onto another to make tabs
     reopen:done       Reopen Closed Window brought one back
     desktops:change   { kind: 'add' }  a second desktop
     deskwidgets:added a widget put on the desktop
     focus:change      the Focus timer running
     power:lock        the screen locked by you

   Saved in session.tryit = { done: { id: at }, hidden: bool } — per
   person (the store keeps session.* with their profile). The Try it
   card in the widget rail (shell/widgets.js) draws it.

   API: ITEMS, items(), isDone(id), progress(), complete(), hidden(),
        setHidden(on), reset(), init()      bus out: tryit:change
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { globalRows, keysText } from './keymap.js';

const KEY = 'session.tryit';

/* a shortcut as this person has it, or '' when the row is gone */
const key = label => {
  try {
    const r = globalRows().find(x => x.label === label || x.label.startsWith(label));
    return r ? keysText(r.keys.split(' / ')[0]) : '';
  } catch (e) { return ''; }
};
const via = (text, k) => (k ? `${text} (${k})` : text);

/** `how`: what to do, written when asked so shortcuts follow Settings › Shortcuts. */
export const ITEMS = [
  { id: 'search',  label: 'Search with Spotlight', icon: 'search',     how: () => via('Search apps, files, settings and games', key('Static Search')) },
  { id: 'snap',    label: 'Snap a window',         icon: 'layers',     how: () => via('Drag a window to a screen edge, or use snap layouts', key('Snap layouts for the front window')) },
  { id: 'tabs',    label: 'Make window tabs',      icon: 'layers',     how: () => 'Drag one window by its title bar onto another window’s title bar' },
  { id: 'reopen',  label: 'Reopen a closed window', icon: 'window',    how: () => via('Close a window, then use Window › Reopen Closed Window', key('Reopen the last closed window')) },
  { id: 'desktop', label: 'Add a second desktop',  icon: 'grid-9',     how: () => via('Open the overview and press the + for a new desktop', key('Window overview')) },
  { id: 'widget',  label: 'Put a widget on the desktop', icon: 'grid', how: () => 'Right-click the desktop › Add Widget…' },
  { id: 'focus',   label: 'Start a Focus session', icon: 'clock',      how: () => 'Open Clock › Focus and press Start' },
  { id: 'lock',    label: 'Lock the screen',       icon: 'lock',       how: () => via('Step away safely', key('Lock the screen')) },
];

const blank = () => ({ done: {}, hidden: false });
function read() {
  const v = store.get(KEY, null);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return blank();
  const done = {};
  for (const it of ITEMS) if (Number.isFinite(v.done?.[it.id])) done[it.id] = v.done[it.id];
  return { done, hidden: v.hidden === true };
}
const write = v => { store.set(KEY, { done: { ...v.done }, hidden: v.hidden }); bus.emit('tryit:change'); };

export const items = () => { const s = read(); return ITEMS.map(it => ({ ...it, how: it.how(), done: !!s.done[it.id], at: s.done[it.id] || null })); };
export const isDone = id => !!read().done[id];
export const progress = () => { const n = Object.keys(read().done).length; return { done: n, total: ITEMS.length }; };
export const complete = () => { const p = progress(); return p.done >= p.total; };
export const hidden = () => read().hidden;
export const setHidden = on => { const s = read(); if (s.hidden !== !!on) write({ ...s, hidden: !!on }); };
export function reset() { write(blank()); }

const desktopUp = () => typeof document !== 'undefined' && document.body?.dataset.ready === '1';
function tick(id) {
  if (!desktopUp()) return;
  const s = read();
  if (s.done[id]) return;
  write({ ...s, done: { ...s.done, [id]: Date.now() } });
}

let wired = false;
export function init() {
  if (wired) return;
  wired = true;
  bus.on('spotlight:shown', () => tick('search'));
  bus.on('win:snap', () => tick('snap'));
  bus.on('tabs:join', () => tick('tabs'));
  bus.on('reopen:done', () => tick('reopen'));
  bus.on('desktops:change', e => { if (e?.kind === 'add') tick('desktop'); });
  bus.on('deskwidgets:added', () => tick('widget'));
  bus.on('focus:change', s => { if (s?.status === 'running') tick('focus'); });
  bus.on('power:lock', () => tick('lock'));
}

export default { ITEMS, items, isDone, progress, complete, hidden, setHidden, reset, init };
