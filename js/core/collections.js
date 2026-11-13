/* ============================================================
   collections.js — personal collections for the Static Library.

   A collection is a named shelf you fill yourself: web games,
   Arcade games, your own creations, anime, Roblox experiences and
   cloud titles, mixed freely. Nothing here fills a collection on
   your behalf — the suggested starters (Games With Friends, Short
   Games, …) are created EMPTY, because only you know what belongs
   in them.

   Store: portal.collections =
     [{ id, name, icon, createdAt,
        items: [{ kind, id, title, art, at }] }]      newest item first

   kind is one of web | arcade | creation | anime | roblox | cloud.
   An item is identified by `${kind}:${id}`. For kind 'anime' the id
   of an anime title is its catalogue id; manga and films are stored
   as 'manga:<id>' / 'movie:<id>' so they never collide with it.
   `at` is when you added it — the only date this module ever shows.

   API
     list()                     every collection (fresh copies)
     get(id)
     create(name, {icon})       -> collection; emits bus 'collection:create'
     rename(id, name)  setIcon(id, icon)  remove(id)
     add(colId, item)           -> true when added, false if already in
     removeItem(colId, item)    -> true when something was removed
     has(item, colId?)          in that collection / in any collection
     containing(item)           ids of the collections holding it
     pickMenu(api, item, x, y)  context menu: toggle membership in each
                                collection, or make a new one
     askName(api, opts)         small accessible naming sheet -> Promise<name|null>
     openItem(api, item)        open the item in the app that owns it
     subscribe(fn)              store subscription; returns unsubscribe

   store.set short-circuits on identical references, so every write
   below builds a NEW array (and new objects for anything changed).
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { h } from './dom.js';
import { icon } from './icons.js';

export const KEY = 'portal.collections';
export const KINDS = ['web', 'arcade', 'creation', 'anime', 'roblox', 'cloud'];

/** How each kind reads in the UI. Shared with the Library. */
export const KIND_META = {
  web:      { label: 'Web game', short: 'Web',      icon: 'globe' },
  arcade:   { label: 'Arcade',   short: 'Arcade',   icon: 'zap' },
  creation: { label: 'Creation', short: 'Creation', icon: 'sparkles' },
  anime:    { label: 'Anime',    short: 'Anime',    icon: 'star' },
  roblox:   { label: 'Roblox',   short: 'Roblox',   icon: 'box' },
  cloud:    { label: 'Cloud',    short: 'Cloud',    icon: 'cast' },
};

/** Icons a collection may wear — all exist in icons.js. */
export const ICONS = ['bookmark', 'heart', 'star', 'users', 'clock', 'zap', 'flame', 'moon', 'sparkles',
  'gamepad', 'trending-up', 'compass', 'music', 'film', 'box', 'diamond', 'folder', 'tag'];

/** Starters offered as one-click creates. They start empty — always. */
export const SUGGESTED = [
  { name: 'Games With Friends', icon: 'users',    blurb: 'For when someone is sitting next to you.' },
  { name: 'Games To Play Later', icon: 'clock',   blurb: 'Spotted something? Park it here.' },
  { name: 'Short Games',        icon: 'zap',      blurb: 'Five minutes between classes.' },
  { name: 'My Creations',       icon: 'sparkles', blurb: 'The games you made, your way.' },
];

const MAX_COLLECTIONS = 60;
const MAX_ITEMS = 500;
const NAME_MAX = 40;

/* self-inject the Library stylesheet: the naming sheet below can be
   opened from Static Games before the Library page has ever loaded */
if (typeof document !== 'undefined' && !document.getElementById('feat-library-css')) {
  const l = document.createElement('link');
  l.id = 'feat-library-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-library.css';
  document.head.appendChild(l);
}

/* ---------------- read / write ---------------- */
const cleanName = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const cleanIcon = s => (ICONS.includes(s) ? s : 'bookmark');
const uid = () => `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const keyOf = it => `${it.kind}:${it.id}`;

/** Normalise anything item-like into the stored shape, or null. */
export function normItem(it) {
  if (!it || typeof it !== 'object') return null;
  const kind = KINDS.includes(it.kind) ? it.kind : null;
  const id = it.id == null ? '' : String(it.id).slice(0, 200);
  if (!kind || !id) return null;
  /* only a link is kept: a data: thumbnail would bloat localStorage, and a
     creation's picture is looked up live from its project instead */
  const art = typeof it.art === 'string' && it.art.length < 600 && /^(https?:|\/|\.\/|assets\/)/.test(it.art) ? it.art : null;
  return {
    kind, id,
    title: String(it.title || id).replace(/\s+/g, ' ').trim().slice(0, 90) || id,
    art,
    at: Number(it.at) || Date.now(),
  };
}

function normCol(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string') return null;
  const seen = new Set();
  const items = (Array.isArray(c.items) ? c.items : []).map(normItem).filter(it => {
    if (!it) return false;
    const k = keyOf(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    id: c.id, name: cleanName(c.name) || 'Untitled collection', icon: cleanIcon(c.icon),
    createdAt: Number(c.createdAt) || 0, items,
  };
}

function read() {
  const v = store.get(KEY, []);
  return Array.isArray(v) ? v.map(normCol).filter(Boolean) : [];
}
const write = list => store.set(KEY, list.map(c => ({ ...c, items: c.items.map(i => ({ ...i })) })));

export const list = () => read();
export const get = id => read().find(c => c.id === id) || null;
export const subscribe = fn => store.sub(KEY, fn);

export function create(name, { icon: ic } = {}) {
  const all = read();
  if (all.length >= MAX_COLLECTIONS) return null;
  const nm = cleanName(name);
  if (!nm) return null;
  const col = { id: uid(), name: nm, icon: cleanIcon(ic || suggestedIcon(nm)), createdAt: Date.now(), items: [] };
  write([col, ...all]);
  bus.emit('collection:create', { id: col.id, name: col.name });
  return { ...col, items: [] };
}

function suggestedIcon(name) {
  const s = SUGGESTED.find(x => x.name.toLowerCase() === name.toLowerCase());
  return s ? s.icon : 'bookmark';
}

function change(id, fn) {
  const all = read();
  const i = all.findIndex(c => c.id === id);
  if (i < 0) return null;
  const next = fn(all[i]);
  if (!next) return null;
  const out = all.slice();
  out[i] = next;
  write(out);
  return next;
}

export function rename(id, name) {
  const nm = cleanName(name);
  if (!nm) return null;
  return change(id, c => ({ ...c, name: nm }));
}

export const setIcon = (id, ic) => change(id, c => ({ ...c, icon: cleanIcon(ic) }));

export function remove(id) {
  const all = read();
  const next = all.filter(c => c.id !== id);
  if (next.length === all.length) return false;
  write(next);
  return true;
}

export function add(colId, item) {
  const it = normItem(item);
  if (!it) return false;
  let added = false;
  change(colId, c => {
    if (c.items.some(x => keyOf(x) === keyOf(it))) return null;
    if (c.items.length >= MAX_ITEMS) return null;
    added = true;
    return { ...c, items: [{ ...it, at: Date.now() }, ...c.items] };
  });
  if (added) bus.emit('collection:add', { id: colId, item: it });
  return added;
}

export function removeItem(colId, item) {
  const k = item && item.kind && item.id != null ? keyOf({ kind: item.kind, id: String(item.id) }) : '';
  let removed = false;
  change(colId, c => {
    const items = c.items.filter(x => keyOf(x) !== k);
    if (items.length === c.items.length) return null;
    removed = true;
    return { ...c, items };
  });
  return removed;
}

export function containing(item) {
  const it = normItem(item);
  if (!it) return [];
  const k = keyOf(it);
  return read().filter(c => c.items.some(x => keyOf(x) === k)).map(c => c.id);
}

export function has(item, colId) {
  const ids = containing(item);
  return colId ? ids.includes(colId) : ids.length > 0;
}

/* ---------------- naming sheet ----------------
   The shell has a yes/no sheet but no text prompt, so this is a small
   one of our own: a labelled input, Enter/Esc, focus returned to where
   it came from, Tab kept inside while it is open. */
let sheetOpen = null;   /* the input of the sheet on screen, if any */
export function askName(api, { title = 'New collection', label = 'Name', value = '', ok = 'Create', hint = '' } = {}) {
  /* one sheet at a time: a double click on "New collection" asks once */
  if (sheetOpen && sheetOpen.isConnected) {
    sheetOpen.focus();
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const prev = document.activeElement;
    const input = h('input.libx-dlg__in', {
      type: 'text', value, maxlength: String(NAME_MAX), spellcheck: 'false', autocomplete: 'off',
      placeholder: 'e.g. Games To Play Later', 'aria-label': label,
    });
    const okBtn = h('button.btn.btn--primary', { type: 'submit', text: ok });
    const cancel = h('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => done(null) });
    const sync = () => { okBtn.disabled = !cleanName(input.value); };
    input.addEventListener('input', sync);
    const card = h('form.libx-dlg__card.glass', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
      onsubmit: e => { e.preventDefault(); const v = cleanName(input.value); if (v) done(v); },
    },
      h('div.libx-dlg__h', icon('bookmark'), h('b', { text: title })),
      h('label.libx-dlg__l', h('span', { text: label }), input),
      hint ? h('small.libx-dlg__hint', { text: hint }) : null,
      h('div.libx-dlg__acts', cancel, okBtn));
    const wrap = h('div.libx-dlg', { onpointerdown: e => { if (e.target === wrap) done(null); } }, card);
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key !== 'Tab') return;
      const f = [...card.querySelectorAll('input,button:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    let closed = false;
    function done(v) {
      if (closed) return;
      closed = true;
      if (sheetOpen === input) sheetOpen = null;
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
      resolve(v);
    }
    sync();
    document.body.appendChild(wrap);
    sheetOpen = input;
    window.addEventListener('keydown', onKey, true);
    input.focus();
    input.select();
  });
}

/* ---------------- the picker menu ---------------- */
export function pickMenu(api, item, x = 0, y = 0) {
  const it = normItem(item);
  if (!it) return;
  const cols = read();
  const k = keyOf(it);
  const short = it.title.length > 28 ? `${it.title.slice(0, 27)}…` : it.title;
  const say = (title, message, ic = 'bookmark') => api.notify({ app: 'Library', icon: ic, title, message, timeout: 3500 });

  const rows = cols.map(c => {
    const inIt = c.items.some(x2 => keyOf(x2) === k);
    return {
      label: c.name, icon: c.icon, checked: inIt,
      /* the tick says it is already in; the hint says what a click does */
      hint: inIt ? 'Remove' : c.items.length ? String(c.items.length) : 'Empty',
      onClick: () => {
        if (inIt) { removeItem(c.id, it); say(`Removed from ${c.name}`, it.title, 'trash'); }
        else if (add(c.id, it)) say(`Added to ${c.name}`, it.title);
        else say(`${c.name} is full`, `A collection holds up to ${MAX_ITEMS} things.`, 'alert');
      },
    };
  });

  api.menu([
    { header: true, label: `Add “${short}” to…` },
    ...(rows.length ? rows : [{ label: 'No collections yet', icon: 'info', disabled: true }]),
    '-',
    {
      label: 'New collection…', icon: 'plus',
      disabled: cols.length >= MAX_COLLECTIONS,
      onClick: async () => {
        const name = await askName(api, { title: 'New collection', ok: 'Create and add',
          hint: `“${short}” goes in first. You can rename it later.` });
        if (!name) return;
        const col = create(name);
        if (col && add(col.id, it)) say(`Added to ${col.name}`, it.title);
      },
    },
  ], x, y);
}

/* ---------------- opening an item ----------------
   Every item opens in the app that owns it. An app that is not part of
   this build (the Arcade and Forge ship separately) gets an honest note
   instead of a dead click. */
export function openItem(api, item) {
  const it = normItem(item);
  if (!it) return false;
  const launch = (appId, opts, name) => {
    const ok = typeof api.getApp === 'function' ? !!api.getApp(appId) : true;
    if (!ok) {
      api.notify({ app: 'Library', icon: 'info', title: `${name} is not in this build`,
        message: `“${it.title}” needs ${name} to open.` });
      return false;
    }
    api.openApp(appId, opts);
    return true;
  };
  switch (it.kind) {
    case 'web': return launch('aether-games', { url: `static://games/${it.id}` }, 'Static Games');
    case 'arcade': return launch('arcade', { game: it.id }, 'Static Arcade');
    case 'creation': return launch('forge', { project: it.id }, 'Static Forge');
    case 'anime': {
      const m = /^(manga|movie):(.+)$/.exec(it.id);
      const path = m ? `${m[1] === 'movie' ? 'movies' : 'manga'}/${m[2]}` : `anime/${it.id}`;
      return launch('aether-anime', { url: `static://${path}` }, 'Static Anime');
    }
    case 'roblox': return launch('aether-roblox', { url: `static://roblox/${it.id}` }, 'Static Roblox');
    case 'cloud': {
      /* Static Cloud has no deep link to one title, so it opens on its home
         (Jump back in and Favourites are the first rows) and says which. */
      const ok = launch('aether-cloud', {}, 'Static Cloud');
      if (ok) api.notify({ app: 'Library', icon: 'cast', title: `Opening Static Cloud`, timeout: 4000,
        message: `Find “${it.title}” under Jump back in or Favourites.` });
      return ok;
    }
    default: return false;
  }
}

export default {
  KEY, KINDS, KIND_META, ICONS, SUGGESTED, keyOf, normItem,
  list, get, create, rename, setIcon, remove, add, removeItem, has, containing,
  pickMenu, askName, openItem, subscribe,
};
