/* ============================================================
   devviews.js — what the Developer Room and Static Developer both
   show about StaticOS: the Events on the OS bus, the Storage this
   browser holds, and the Apps that are registered.

   Each app used to draw its own copy of these. The numbers could
   differ — one counted a key's value, the other its key and value;
   one listed another person's keys on a shared computer, the other
   hid them — so a figure in one window could disagree with the same
   figure in the other. Now there is one place that READS each thing
   (the functions that return plain rows) and one place that DRAWS the
   rows (the render functions), and each app hands the renderer its
   own "skin": the class names of its own look. The Developer Room
   keeps its green key/value lines and bars; Static Developer keeps
   its tables and expandable rows. Same data, two looks.

   Reads only. Nothing here changes a setting or sends anything.
   Secret-looking keys are masked (devlog.js), and another person's
   saved data on this computer is counted, never named.
   ============================================================ */
import * as DL from './devlog.js';
import * as profiles from './profiles.js';
import { APP_MODULES } from '../apps/manifest.js';

/* ---------------- formatting (one set, both apps) ---------------- */
const pad = (n, w = 2) => String(n).padStart(w, '0');
export function clock(t, ms = true) {
  const d = new Date(t);
  const s = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return ms ? `${s}.${pad(d.getMilliseconds(), 3)}` : s;
}
export function bytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export const num = n => Number(n).toLocaleString();
export const count = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || `${one}s`)}`;
/* localStorage holds UTF-16: a key and its value take about two bytes a character */
export const lsBytes = (k, v) => ((k || '').length + (v || '').length) * 2;
const jsonBytes = v => { try { return (JSON.stringify(v) || '').length * 2; } catch (e) { return 0; } };
const masked = k => (DL.looksSecret(k) ? `•••• (${num(k.length)} chars)` : k);

/* ================================================================
   EVENTS — the OS bus, recorded by devlog's tap
   ================================================================ */
/* The tap records every bus emit, so it runs only while somebody wants it.
   Each window holds it under its own name; it is on while any claim is held. */
const claims = new Set();
export function holdTap(owner, on) {
  if (on) claims.add(owner); else claims.delete(owner);
  return DL.setBusTap(claims.size > 0);
}
export const tapHolders = () => [...claims];

/** Does this recorded event pass the filter? { q, beat } — beat shows the 1 s heartbeat. */
export const passEvent = (e, { q = '', beat = false } = {}) =>
  (beat || !e.beat) && (!q || `${e.evt} ${e.text}`.toLowerCase().includes(q.toLowerCase()));

/** The recorded events that pass, oldest first. */
export const eventLog = f => DL.busLog().filter(e => passEvent(e, f));

/** How many events were recorded under each name, most first. */
export function eventTally(list = DL.busLog()) {
  const by = new Map();
  for (const e of list) by.set(e.evt, (by.get(e.evt) || 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}

/** The words under a recorded event: what the footer of both apps says. */
export function eventStats() {
  const all = DL.busLog();
  const s = DL.stats();
  return { kept: all.length, names: new Set(all.map(e => e.evt)).size, tap: s.bus.tap, since: s.bus.since, max: s.bus.max, beatMax: s.bus.beatMax };
}

/**
 * One event as a row. `skin` carries the app's own class names:
 *   row, time, name, args   selectors for the parts ('div.dr-ev', 'time', 'b', 'code')
 *   head, kids              (expandable only) the button that opens it and its panel
 * With `detail(e, kidsEl)` the row opens to show the payload; without it the row is flat.
 */
export function eventRow(h, e, skin, detail) {
  const time = h(skin.time, { text: clock(e.t), datetime: new Date(e.t).toISOString() });
  const name = h(skin.name, { text: e.evt });
  const args = h(skin.args, { text: e.text || skin.empty || '' });
  const cls = e.beat ? 'is-beat' : '';
  if (!detail) return h(skin.row, { class: cls, dataset: { id: String(e.id) } }, time, name, args);
  const kids = h(skin.kids, { hidden: true });
  let built = false;
  const head = h(skin.head, {
    type: 'button', 'aria-expanded': 'false',
    onclick: () => {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      if (open && !built) { built = true; detail(e, kids); }
      kids.hidden = !open;
    },
  }, time, name, args);
  return h(skin.row, { class: cls, dataset: { id: String(e.id) } }, head, kids);
}

/* ================================================================
   STORAGE — what StaticOS keeps in this browser
   ================================================================ */
function readStore(S0, { hideOthers = false } = {}) {
  const rows = [];
  let others = 0;
  for (let i = 0; i < S0.length; i++) {
    const k = S0.key(i);
    let v = '';
    try { v = S0.getItem(k) || ''; } catch (e) { /* unreadable */ }
    /* another person's data on this computer: counted, never named */
    if (hideOthers && profiles.foreign(k)) { others += lsBytes(k, v); continue; }
    rows.push({ k, n: lsBytes(k, v), label: masked(k) });
  }
  if (others) rows.push({ k: '(other people on this computer)', n: others, label: '(other people on this computer)', others: true });
  rows.sort((a, b) => b.n - a.n);
  return { rows, total: rows.reduce((a, r) => a + r.n, 0) };
}

/** localStorage, key by key, biggest first. null if the browser blocks it. */
export function localKeys() {
  try { return readStore(window.localStorage, { hideOthers: true }); } catch (e) { return null; }
}
/** sessionStorage (this tab only). */
export function sessionKeys() {
  try { return readStore(window.sessionStorage); } catch (e) { return null; }
}

/**
 * This person's saved state (staticos.state.v3) by top-level root and by
 * portal.* child, biggest first. `container` marks a root that only holds
 * others (portal), which a "largest keys" list leaves out.
 */
export function stateRoots() {
  let state = {};
  try { state = JSON.parse(profiles.local.getItem(profiles.key('staticos.state.v3')) || '{}') || {}; } catch (e) { state = {}; }
  const out = [];
  for (const [k, v] of Object.entries(state)) out.push({ k, n: jsonBytes(v), label: masked(k), container: k === 'portal' });
  if (state.portal && typeof state.portal === 'object') {
    for (const [k, v] of Object.entries(state.portal)) out.push({ k: `portal.${k}`, n: jsonBytes(v), label: masked(`portal.${k}`) });
  }
  out.sort((a, b) => b.n - a.n);
  return out;
}
/** The biggest saved keys (no containers), at most n. */
export const largestKeys = (n = 10) => stateRoots().filter(r => !r.container).slice(0, n);

/**
 * Rows of keys and sizes. layout:
 *   'table'  a table of Key / Size / Share  (skin.table, skin.mono, skin.shareCol, skin.share)
 *   'kv'     one key/value line each        (skin.kv)
 *   'bars'   a bar scaled to the biggest    (skin.bar)
 */
export function keyRows(h, rows, skin) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  const max = Math.max(1, ...rows.map(r => r.n));
  if (skin.layout === 'kv') return rows.map(r => h(skin.kv, h('span', { text: r.label }), h('code', { text: bytes(r.n) })));
  if (skin.layout === 'bars') {
    return rows.map(r => h(skin.bar, h('span', { text: r.label }),
      h('i', h('b', { style: { width: `${Math.max(1, (r.n / max) * 100)}%` } })), h('code', { text: bytes(r.n) })));
  }
  const th = (text, cls) => h(`th${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`, { scope: 'col', text });
  return h(skin.table,
    h('thead', h('tr', th('Key'), th('Size', 'num'), th('Share', skin.shareCol))),
    h('tbody', rows.map(r => h('tr',
      h(`td${skin.mono || ''}`, { text: r.label }),
      h('td.num', { text: bytes(r.n) }),
      h(`td${skin.shareCol ? `.${skin.shareCol}` : ''}`, h(skin.share, h('i', { style: { width: `${Math.max(0.5, (r.n / (total || 1)) * 100)}%` } })))))));
}

/* ---------------- state snapshots and their difference ---------------- */
/** FNV-1a — so two different secrets compare as different without keeping either. */
const hash = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return x >>> 0; };

/**
 * A flat picture of a state tree: Map(path -> { show, h }). `show` is what
 * may be printed (secret-looking values masked, long strings clipped); `h`
 * is a hash of the real value so a changed secret still reads as changed.
 * `skip` leaves out top-level roots (Static Developer skips `live`, the
 * gauges main.js rewrites every second, which would drown real changes).
 * Bounded: at most 20 000 values, 10 levels deep.
 */
export function flattenState(state, { budget = 20000, skip = [] } = {}) {
  const out = new Map();
  let left = budget;
  const leaf = (path, key, v) => {
    if (v === undefined) return;          /* a key set to undefined is not there once the state is saved, so it is not here */
    const secret = (DL.isSecretKey(String(key)) && DL.maskable(v)) || DL.looksSecret(v);
    let raw;
    try { raw = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { raw = String(v); }
    raw = String(raw === undefined ? 'undefined' : raw);
    const show = secret ? `•••• (${num(DL.lengthOf(v))} chars)` : (raw.length > 80 ? `${raw.slice(0, 79)}…` : raw);
    out.set(path, { show, h: hash(raw), secret });
  };
  const walk = (v, path, key, depth) => {
    if (left-- <= 0) return;
    if (v !== null && typeof v === 'object' && depth < 10 && !(DL.isSecretKey(String(key)) && DL.maskable(v))) {
      const keys = Object.keys(v);
      if (!keys.length) { leaf(path, key, Array.isArray(v) ? '[]' : '{}'); return; }
      for (const k of keys) { if (depth === 0 && skip.includes(k)) continue; walk(v[k], path ? `${path}.${k}` : k, k, depth + 1); }
      return;
    }
    leaf(path, key, v);
  };
  walk(state, '', '', 0);
  return out;
}

/** What changed from picture a to picture b: { added, removed, changed } of { path, from, to }. */
export function diffFlat(a, b) {
  const added = [], removed = [], changed = [];
  for (const [p, v] of b) {
    const o = a.get(p);
    if (!o) added.push({ path: p, to: v.show });
    else if (o.h !== v.h) changed.push({ path: p, from: o.show, to: v.show, secret: v.secret || o.secret });
  }
  for (const [p, v] of a) if (!b.has(p)) removed.push({ path: p, from: v.show });
  return { added, removed, changed };
}

/* ================================================================
   APPS — every registered app, what is open, what has gone wrong
   ================================================================ */
const MODULE_OF = new Map();
for (const [mod, list] of APP_MODULES) for (const m of list) MODULE_OF.set(m.id, mod);

/** Console errors per app module, from where each one was logged (js/apps/<module>.js:line). */
export function errorsByModule(entries = DL.entries()) {
  const by = new Map();
  let elsewhere = 0;
  for (const e of entries) {
    if (e.level !== 'error') continue;
    const m = /(?:^|\/)js\/apps\/([^/:?]+)\.js/.exec(String(e.site || ''));
    if (m) by.set(m[1], (by.get(m[1]) || 0) + 1);
    else elsewhere++;
  }
  return { by, elsewhere };
}

/** Every registered app as { id, name, hidden, category, module, windows, errors }. */
export function appRows({ listApps, wm }) {
  const { by } = errorsByModule();
  const wins = wm?.list ? wm.list() : [];
  return listApps({ includeHidden: true }).map(a => {
    const module = MODULE_OF.get(a.id) || null;
    return {
      id: a.id, name: a.name, hidden: !!a.hidden, category: a.category || '', module,
      windows: wins.filter(w => w.appId === a.id).length,
      errors: module ? (by.get(module) || 0) : 0,
      app: a,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The apps as a list or a table. layout:
 *   'list'   a tile, the name and id, tags, an Open button
 *            (skin.wrap, skin.row, skin.tag; `tile(app)` draws the tile)
 *   'table'  Name / Id / Module / Open windows / Errors  (skin.table, skin.mono, skin.tag)
 * `open(id)` is the Open button.
 */
export function appsView(h, rows, skin, { open, tile } = {}) {
  if (skin.layout === 'table') {
    const th = (text, cls) => h(`th${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`, { scope: 'col', text });
    return h(skin.table,
      h('thead', h('tr', th('App'), th('Id'), th('Module'), th('Open', 'num'), th('Errors', 'num'), h('th', { scope: 'col' }, h('span.sr', { text: 'Actions' })))),
      h('tbody', rows.map(r => h('tr', { dataset: { app: r.id }, class: r.errors ? 'is-bad' : '' },
        h('td', h('b', { text: r.name }), r.hidden ? h(skin.tag, { text: 'hidden' }) : null),
        h(`td${skin.mono || ''}`, { text: r.id }),
        h(`td${skin.mono || ''}`, { text: r.module ? `js/apps/${r.module}.js` : '—' }),
        h('td.num', { text: String(r.windows) }),
        h('td.num', { text: String(r.errors), title: r.errors ? 'Console errors logged from this app’s file' : 'No console errors logged from this app’s file' }),
        h('td', open ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => open(r.id) }, h('span', { text: 'Open' })) : null)))));
  }
  return h(skin.wrap, rows.map(r => h(skin.row, { dataset: { app: r.id } },
    tile ? tile(r.app) : null,
    h('div.grow', h('b', { text: r.name }), h('code', { text: r.id })),
    r.hidden ? h(skin.tag, { text: 'hidden' }) : null,
    r.errors ? h(skin.tag, { text: `${r.errors} error${r.errors === 1 ? '' : 's'}`, title: 'Console errors logged from this app’s file' }) : null,
    open ? h('button.btn.btn--sm', { type: 'button', onclick: () => open(r.id) }, 'Open') : null)));
}

/** One line for each app's footer: how many, how many hidden, open windows, errors. */
export function appsSummary(rows) {
  const { elsewhere } = errorsByModule();
  const errs = rows.reduce((a, r) => a + r.errors, 0);
  return {
    apps: rows.length, hidden: rows.filter(r => r.hidden).length,
    windows: rows.reduce((a, r) => a + r.windows, 0),
    errors: errs, elsewhere,
  };
}
