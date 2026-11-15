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

   A SMART collection has `rule` instead of items: a rule such as
   "web games, Horror, that I've played" or "anime I mark as Watching".
   It stores no items; evaluate() reads the stores again every time
   it is opened, so it is never out of date and never invents a row.
     rule = { src: 'web'|'arcade'|'anime'|'roblox',
              cat?, state?: 'played'|'fav'|'unplayed', status?, players2? }

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
     createSmart(name, rule)    a smart collection; evaluate(col) -> { items, note }
     exportJson(col, items) / parseExport(text)   a collection as a list of ids,
                                never a URL; the receiver looks each up itself
     wireIds(items) / importIds(name, pairs)      the same list, for friends.js
                                and for the file import
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
  const rule = normRule(c.rule);
  return {
    id: c.id, name: cleanName(c.name) || 'Untitled collection', icon: cleanIcon(c.icon),
    createdAt: Number(c.createdAt) || 0, items: rule ? [] : items, ...(rule ? { rule } : {}),
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
    if (c.rule) return null;                       /* a smart collection fills itself */
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
  const cols = read().filter(c => !c.rule);
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
      /* the archive.org identifier opens straight into its emulator */
      return launch('aether-cloud', { url: `static://cloud?play=${encodeURIComponent(it.id)}&t=${encodeURIComponent(it.title || it.id)}` }, 'Static Cloud');
    }
    default: return false;
  }
}

/* ---------------- smart collections ---------------- */
export const RULE_SRC = {
  web:    { label: 'Web games', kind: 'web',    icon: 'globe' },
  arcade: { label: 'Arcade',    kind: 'arcade', icon: 'zap' },
  anime:  { label: 'Anime',     kind: 'anime',  icon: 'star' },
  roblox: { label: 'Roblox',    kind: 'roblox', icon: 'box' },
};
/** The anime statuses Static Anime keeps in portal.anime.status. */
export const ANIME_STATUS = { watching: 'Watching', plan: 'Plan to watch', completed: 'Completed', dropped: 'Dropped' };
export const RULE_STATES = { any: 'any', played: 'I have played', fav: 'in my favorites', unplayed: 'not tried yet' };
const SMART_MAX = 200;

export function normRule(r) {
  if (!r || typeof r !== 'object' || !RULE_SRC[r.src]) return null;
  const out = { src: r.src };
  if (r.src === 'web' && typeof r.cat === 'string' && /^[a-z0-9_-]{1,30}$/i.test(r.cat) && r.cat !== 'all') out.cat = r.cat;
  if (r.src === 'anime') {
    out.status = ANIME_STATUS[r.status] ? r.status : 'watching';
  } else {
    out.state = RULE_STATES[r.state] && r.state !== 'any' ? r.state : 'any';
    if (r.src === 'arcade' && r.players2 === true) out.players2 = true;
    if (r.src === 'roblox' && out.state === 'unplayed') out.state = 'any';
  }
  return out;
}

/** The rule in words, for the page under a smart collection's name. */
export function describeRule(rule, catName = c => c) {
  const r = normRule(rule);
  if (!r) return '';
  if (r.src === 'anime') return `Anime I marked ${ANIME_STATUS[r.status]}`;
  const what = r.src === 'web' ? `${r.cat ? `${catName(r.cat)} ` : ''}web games` : r.src === 'arcade' ? `${r.players2 ? 'two-player ' : ''}Arcade games` : 'Roblox experiences';
  const st = r.state === 'played' ? (r.src === 'roblox' ? ' I opened' : ' I have played') : r.state === 'fav' ? ' in my favorites'
    : r.state === 'unplayed' ? ' I have not tried yet' : '';
  return `${what[0].toUpperCase()}${what.slice(1)}${st}`;
}

export function createSmart(name, rule, { icon: ic } = {}) {
  const all = read();
  if (all.length >= MAX_COLLECTIONS) return null;
  const nm = cleanName(name);
  const r = normRule(rule);
  if (!nm || !r) return null;
  const col = { id: uid(), name: nm, icon: cleanIcon(ic || 'sparkles'), createdAt: Date.now(), items: [], rule: r };
  write([col, ...all]);
  bus.emit('collection:create', { id: col.id, name: col.name, smart: true });
  return { ...col, items: [] };
}

/** Change the rule of a smart collection (a manual one is left alone). */
export function setRule(id, rule) {
  const r = normRule(rule);
  if (!r) return null;
  return change(id, c => (c.rule ? { ...c, rule: r } : null));
}

const memo = {};
const lazy = (k, fn) => (memo[k] || (memo[k] = fn().catch(() => null)));
const gamesMod  = () => lazy('games', () => import('../portal/games.data.js').then(m => m.load().then(() => m)));
const robloxMod = () => lazy('roblox', () => import('../portal/roblox.data.js').then(m => m.load().then(() => m)));
const animeMod  = () => lazy('anime', () => import('../portal/anime.data.js').then(m => m.load('anime').then(() => m)));
const arcadeMod = () => lazy('arcade', () => import('../arcade/index.js'));
const playsMod  = () => lazy('plays', () => import('./plays.js'));

/**
 * What a smart collection holds right now -> { items, note }. Read from the
 * stores on every call; nothing is remembered between calls.
 */
export async function evaluate(col) {
  const rule = col && normRule(col.rule);
  if (!rule) return { items: [], note: '' };
  const arrOf = v => (Array.isArray(v) ? v : []);
  const P = await playsMod();
  const playedKeys = P ? P.playedKeys() : new Set();
  const mk = (kind, id, title, art, at = 0) => normItem({ kind, id, title, art, at });
  let items = [];
  const note = '';
  if (rule.src === 'web') {
    const G = await gamesMod();
    if (!G) return { items: [], note: 'The games catalogue did not load.' };
    const favs = new Set(arrOf(store.get('portal.games.favs')).filter(x => typeof x === 'string'));
    /* launches from before plays.js existed still count as played */
    const old = new Map(arrOf(store.get('portal.games.recent')).filter(r => r && typeof r.id === 'string').map(r => [r.id, Number(r.at) || 0]));
    const lastAt = new Map(arrOf(P ? P.recent(80, 'web') : []).map(r => [r.id, Number(r.at) || 0]));
    const played = id => playedKeys.has(`web:${id}`) || old.has(id);
    const rows = G.query({ category: rule.cat || 'all', sort: 'catalogue', perPage: 6000 }).items.filter(g => {
      if (rule.state === 'played') return played(g.id);
      if (rule.state === 'fav') return favs.has(g.id);
      if (rule.state === 'unplayed') return !played(g.id);
      return true;
    });
    if (rule.state === 'played') rows.sort((a, b) => (lastAt.get(b.id) || old.get(b.id) || 0) - (lastAt.get(a.id) || old.get(a.id) || 0));
    items = rows.slice(0, SMART_MAX).map(g => mk('web', g.id, g.title, g.art, lastAt.get(g.id) || old.get(g.id) || 0));
  } else if (rule.src === 'arcade') {
    const A = await arcadeMod();
    const list = A ? arrOf(A.ARCADE) : [];
    const lastAt = new Map(arrOf(P ? P.recent(80, 'arcade') : []).map(r => [r.id, Number(r.at) || 0]));
    items = list.filter(a => {
      if (rule.players2 && !arrOf(a.players).includes(2)) return false;
      if (rule.state === 'played') return playedKeys.has(`arcade:${a.id}`);
      if (rule.state === 'unplayed') return !playedKeys.has(`arcade:${a.id}`);
      return true;
    }).slice(0, SMART_MAX).map(a => mk('arcade', a.id, a.title, null, lastAt.get(a.id) || 0));
  } else if (rule.src === 'roblox') {
    const key = rule.state === 'fav' ? 'portal.roblox.favs' : rule.state === 'played' ? 'portal.roblox.recent' : '';
    const RB = await robloxMod();
    if (!RB) return { items: [], note: 'The Roblox catalogue did not load.' };
    const ids = key ? arrOf(store.get(key)).map(String) : RB.all().map(r => r.id);
    items = ids.map(id => RB.byId(id)).filter(Boolean).slice(0, SMART_MAX).map(r => mk('roblox', r.id, r.name, r.art));
  } else {
    const st = store.get('portal.anime.status', {}) || {};
    const rows = Object.entries(st).filter(([k, v]) => k.startsWith('anime:') && v && v.s === rule.status)
      .sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0));
    if (!rows.length) return { items: [], note: '' };
    const A = await animeMod();
    if (!A) return { items: [], note: 'The anime catalogue did not load, so these titles cannot be listed yet.' };
    items = rows.map(([k, v]) => {
      const rec = A.byId(k.slice(6), 'anime');
      return rec ? mk('anime', rec.id, rec.title, rec.image, Number(v.at) || 0) : null;
    }).filter(Boolean).slice(0, SMART_MAX);
  }
  return { items, note };
}

/* ---------------- sharing: a list of ids, never a link ----------------
   Only kinds the receiver can look up in a catalogue of its own travel:
   web games, Arcade games, Roblox experiences, anime. Your own creations
   and Cloud titles stay on this device. */
const WIRE_KIND = { web: 'w', arcade: 'a', anime: 'n', roblox: 'r' };
const FROM_WIRE = { w: 'web', a: 'arcade', n: 'anime', r: 'roblox' };
const WIRE_ID = /^[A-Za-z0-9_:.-]{1,96}$/;
export const SHARE_MAX = 100;

/** [[code, id], …] for the kinds that can be shared, at most SHARE_MAX. */
export function wireIds(items) {
  return (Array.isArray(items) ? items : []).map(normItem).filter(it => it && WIRE_KIND[it.kind] && WIRE_ID.test(it.id))
    .slice(0, SHARE_MAX).map(it => [WIRE_KIND[it.kind], it.id]);
}

/** Clean a received or pasted list: only known kinds and plain ids survive. */
export function cleanPairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(p) || !FROM_WIRE[p[0]] || typeof p[1] !== 'string' || !WIRE_ID.test(p[1])) continue;
    const k = `${p[0]}:${p[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([p[0], p[1]]);
    if (out.length >= SHARE_MAX) break;
  }
  return out;
}

export function exportJson(col, items) {
  return JSON.stringify({ staticos: 'collection', v: 1, name: cleanName(col.name),
    items: wireIds(items).map(([k, id]) => ({ kind: FROM_WIRE[k], id })) }, null, 2);
}

/** -> { name, pairs } or null when the text is not a collection export. */
export function parseExport(text) {
  let d;
  try { d = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!d || d.staticos !== 'collection' || !Array.isArray(d.items)) return null;
  const pairs = cleanPairs(d.items.map(i => (i && WIRE_KIND[i.kind] ? [WIRE_KIND[i.kind], String(i.id)] : null)).filter(Boolean));
  return { name: cleanName(d.name) || 'Shared collection', pairs };
}

/**
 * Make a collection from a received list. Each id is looked up in THIS
 * device's own catalogues: one it does not have is skipped, and the title and
 * picture come from here, never from the sender.
 * -> { col, added, skipped } or null (full)
 */
export async function importIds(name, pairs) {
  const clean = cleanPairs(pairs);
  const [G, RB, A, AR] = await Promise.all([gamesMod(), robloxMod(), animeMod(), arcadeMod()]);
  const found = [];
  for (const [code, id] of clean) {
    const kind = FROM_WIRE[code];
    let it = null;
    if (kind === 'web') { const g = G && G.byId(id); if (g) it = { kind, id: g.id, title: g.title, art: g.art }; }
    else if (kind === 'roblox') { const r = RB && RB.byId(id); if (r) it = { kind, id: r.id, title: r.name, art: r.art }; }
    else if (kind === 'arcade') { const a = AR && AR.arcadeById && AR.arcadeById(id); if (a) it = { kind, id: a.id, title: a.title, art: null }; }
    else if (kind === 'anime' && /^[0-9]{1,9}$/.test(id)) { const r = A && A.byId(id, 'anime'); if (r) it = { kind, id: r.id, title: r.title, art: r.image }; }
    if (it) found.push(it);
  }
  const col = create(name);
  if (!col) return null;
  for (const it of found.reverse()) add(col.id, it);
  return { col: get(col.id), added: found.length, skipped: clean.length - found.length };
}

export default {
  KEY, KINDS, KIND_META, ICONS, SUGGESTED, keyOf, normItem,
  list, get, create, rename, setIcon, remove, add, removeItem, has, containing,
  pickMenu, askName, openItem, subscribe,
  createSmart, setRule, evaluate, normRule, describeRule, wireIds, cleanPairs, exportJson, parseExport, importIds,
};
