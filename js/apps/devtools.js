/* ============================================================
   devtools.js — Static Developer: StaticOS inspecting itself.

   A developer-mode inspector for testing StaticOS, shaped like a
   browser's devtools crossed with Activity Monitor: a rail of panes,
   a dense toolbar, monospace tables and trees, a status bar.

     Console      what the page logged. js/core/devlog.js captures it
                  from boot: levels, text filter, repeat counts,
                  expandable values and the real calling file:line.
                  There is no input line — this inspects, it never
                  runs code.
     Events       the OS bus. devlog's tap records only while this pane
                  is showing, or while recording is pinned; otherwise
                  it is off and costs nothing.
     Network      the browser's Resource Timing entries plus devlog's
                  observer, so requests after the timing buffer fills
                  still appear.
     App State    the store tree, read-only, with JSON sizes, live
                  change flashes and per-root "Copy JSON".
     Storage      localStorage, sessionStorage, the quota estimate,
                  IndexedDB (db.js), Cache Storage, service workers.
     Files        the virtual filesystem as a tree, sizes and mtimes.
     Windows      the window manager's list in z-order, live.
     Performance  measured frame rate, long tasks, JS heap (Chromium
                  only), DOM size, open windows.
     Status       real checks, run when the pane opens or on demand.
     Labs         the experimental prefs Settings › Labs switches.

   Design notes
   · Honesty: every number is read from an API when it is shown. Where
     the browser won't say (heap outside Chromium, listener and timer
     counts, cross-origin sizes) the pane says so in words.
   · Nothing leaves the device. The only requests this app makes are
     the Status checks — build.json and one HEAD to the free AI host —
     when that pane opens or "Check again" is pressed.
   · Secrets: values under secret-looking keys, and long random strings,
     are masked everywhere here, copied JSON included.
   · Cost: only the pane on screen does work. Minimising the window,
     hiding the browser tab or covering the sheet (phones) disposes the
     pane's scope — listeners, timers, frame loop, observers — and the
     pane is rebuilt from the data when it shows again. Closing the
     window tears everything down; devlog's ring buffers are all that
     keep running (plus the bus tap, only if recording was pinned).
   · Long lists render the newest few hundred rows, with "Show more".
   · All DOM is built with h() and textContent. A hostile string in a
     log line, a store key or a file name is shown as text, never
     parsed as markup.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as DL from '../core/devlog.js';
import * as profiles from '../core/profiles.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-devtools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-devtools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-devtools.css';
  document.head.appendChild(l);
}

const TABS = [
  { id: 'console', label: 'Console', icon: 'terminal', group: 'Runtime' },
  { id: 'events', label: 'Events', icon: 'activity', group: 'Runtime' },
  { id: 'network', label: 'Network', icon: 'globe', group: 'Runtime' },
  { id: 'state', label: 'App State', icon: 'layers', group: 'Data' },
  { id: 'storage', label: 'Storage', icon: 'database', group: 'Data' },
  { id: 'files', label: 'Files', icon: 'folder', group: 'Data' },
  { id: 'windows', label: 'Windows', icon: 'window', group: 'System' },
  { id: 'performance', label: 'Performance', icon: 'gauge', group: 'System' },
  { id: 'status', label: 'Status', icon: 'check-circle', group: 'System' },
  { id: 'labs', label: 'Labs', icon: 'zap', group: 'System' },
];
const TAB = Object.fromEntries(TABS.map(t => [t.id, t]));
const ALIAS = {
  logs: 'console', log: 'console', bus: 'events', net: 'network', appstate: 'state', 'app-state': 'state', store: 'state',
  vfs: 'files', fs: 'files', wm: 'windows', perf: 'performance', api: 'status', experimental: 'labs', experiments: 'labs',
};
const canonTab = t => (TAB[t] ? t : ALIAS[String(t || '').toLowerCase()] || null);

/* the experimental prefs Settings › Labs presents (js/apps/settings.js, SET table) */
const LABS = [
  { key: 'labStaticumAI', label: 'Staticum answers anything', desc: 'When none of Staticum’s skills fit, it asks the free AI model. Answers can be wrong; the question is sent to text.pollinations.ai.', applied: () => null, appliedNote: 'Takes effect when Staticum gets a question none of its skills handle — nothing on screen to check.' },
  { key: 'labFps', label: 'Frame-rate counter', desc: 'A small fps readout in the corner, measured from real animation frames.', applied: () => !!document.querySelector('.lab-fps'), appliedNote: 'Looks for the .lab-fps readout js/core/labs.js adds.' },
  { key: 'labCompact', label: 'Compact title bars', desc: 'Shorter window title bars for more room on small screens.', applied: () => document.documentElement.dataset.titlebars === 'compact', appliedNote: 'Reads html[data-titlebars], which js/core/labs.js sets.' },
];

const AI_URL = 'https://text.pollinations.ai/';

/* Survives the window closing, for the rest of this page's life: the
   last pane, the recording switches and each pane's filters. */
const MEM = { tab: 'console', recording: true, pinned: false, st: {} };
const DEFAULTS = {
  console: () => ({ q: '', levels: { error: true, warn: true, info: true, log: true, debug: true }, limit: 250 }),
  events: () => ({ q: '', beat: false }),
  network: () => ({ q: '', type: 'all', sort: 'start', dir: 1, limit: 300, open: new Set() }),
  state: () => ({ q: '', open: new Set(), limits: new Map() }),
  storage: () => ({}),
  files: () => ({ q: '', open: new Set(['/', '/home', '/home/static']), limits: new Map() }),
  windows: () => ({}),
  performance: () => ({ fps: [], frame: [], heap: [], dom: [], lt: [], ltKeys: new Set() }),
  status: () => ({ results: {}, ranAt: 0 }),
  labs: () => ({}),
};
const stOf = id => MEM.st[id] || (MEM.st[id] = DEFAULTS[id]());

/* ---------------- formatting ---------------- */
const pad = (n, w = 2) => String(n).padStart(w, '0');
function clock(t, ms = true) {
  const d = new Date(t);
  const s = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return ms ? `${s}.${pad(d.getMilliseconds(), 3)}` : s;
}
function bytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
function msf(v) {
  if (!Number.isFinite(v)) return '—';
  if (v < 10) return `${v.toFixed(1)} ms`;
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}
const num = n => Number(n).toLocaleString();
const count = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || `${one}s`)}`;
const jsonLen = v => { try { const s = JSON.stringify(v); return s === undefined ? 0 : s.length; } catch (e) { return NaN; } };
const lsBytes = (k, v) => ((k || '').length + (v || '').length) * 2;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/* ---------------- lifetimes ----------------
   A scope owns everything a pane (or the window) starts, and dispose()
   stops all of it: unsubscribers, DOM listeners on shared targets,
   animation frames and timers. */
function scope() {
  const offs = new Set();
  const frames = new Map();
  const timers = new Set();
  let alive = true;
  return {
    get alive() { return alive; },
    on(off) { if (typeof off === 'function') { if (alive) offs.add(off); else off(); } return off; },
    listen(target, evt, fn, opt) {
      if (!alive) return;
      target.addEventListener(evt, fn, opt);
      offs.add(() => target.removeEventListener(evt, fn, opt));
    },
    frame(key, fn) {
      if (!alive || frames.has(key)) return;
      frames.set(key, requestAnimationFrame(() => { frames.delete(key); if (alive) fn(); }));
    },
    later(fn, ms) {
      if (!alive) return 0;
      const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms);
      timers.add(t);
      return t;
    },
    cancel(t) { clearTimeout(t); timers.delete(t); },
    dispose() {
      if (!alive) return;
      alive = false;
      for (const off of offs) { try { off(); } catch (e) { /* already gone */ } }
      offs.clear();
      for (const id of frames.values()) cancelAnimationFrame(id);
      frames.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

/* ---------------- serialised values (from devlog) ---------------- */
const VCLS = {
  s: 'str', r: 'str', n: 'num', g: 'num', b: 'kw', u: 'kw', z: 'kw', c: 'kw', get: 'kw', cut: 'kw',
  y: 'fn', f: 'fn', e: 'err', d: 'x', x: 'x', m: 'mask', o: 'obj', a: 'obj', M: 'obj', S: 'obj',
};

function stackLines(n) {
  const lines = String(n && n.stack || '').split('\n').map(s => s.trim()).filter(Boolean);
  const i = lines.findIndex(l => /^at\s/.test(l) || /@.*:\d+:\d+$/.test(l) || /:\d+:\d+\)?$/.test(l));
  return i < 0 ? [] : lines.slice(i);
}

function canExpand(n) {
  if (!n) return false;
  switch (n.t) {
    case 'o': return !!(n.k && n.k.length);
    case 'a': case 'S': return !!(n.i && n.i.length);
    case 'M': return !!(n.e && n.e.length);
    case 'e': return stackLines(n).length > 0 || !!(n.k && n.k.length);
    default: return false;
  }
}

function entryCopyText(e) {
  let s = `${clock(e.t)} ${e.level.toUpperCase().padEnd(5)} ${e.text}`;
  if (e.count > 1) s += `  (×${e.count})`;
  if (e.site) s += `  — ${e.site}`;
  for (const n of e.args) if (n.t === 'e') for (const l of stackLines(n)) s += `\n    ${l}`;
  if (e.stack) for (const l of e.stack.split('\n')) if (l.trim()) s += `\n    ${l.trim()}`;
  return s;
}

defineApp({
  id: 'devtools',
  name: 'Static Developer',
  icon: 'bug',
  g1: '#a5b8ff', g2: '#3730a3',
  category: 'System',
  keywords: ['developer', 'devtools', 'inspector', 'inspect', 'console', 'logs', 'debug', 'bus', 'events', 'network',
    'state', 'store', 'storage', 'indexeddb', 'filesystem', 'vfs', 'windows', 'performance', 'fps', 'status', 'labs'],
  desc: 'Inspect StaticOS from the inside: console, events, network, state, storage and more',
  singleton: true,
  win: { w: 1000, h: 640, minW: 380, minH: 320 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, vfs, fmt } = api;
    const wm = api.wm;

    DL.init();          /* idempotent: boot normally did this already */

    const uid = Math.random().toString(36).slice(2, 8);
    const S = { tab: canonTab(opts?.tab) || MEM.tab || 'console', dead: false, paused: false, inView: true, mounted: false, netDirty: true, netCount: 0 };
    const app = scope();
    let pane = scope();

    const note = (title, message, ic = 'bug') => api.notify({ app: 'Static Developer', icon: ic, title, message, timeout: 2600 });

    /* =============================== chrome =============================== */
    const side = h('aside.app__side.dt-side', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Inspector panes' });
    const bar = h('div.dt-bar');
    const body = h('div.dt-body', { role: 'tabpanel', id: `dt-panel-${uid}` });
    const foot = h('div.dt-foot');
    const appEl = h('div.app.dt', side, h('div.app__main.dt-main', bar, body, foot));
    root.appendChild(appEl);

    const tabBtns = new Map();
    const badges = new Map();
    for (const g of ['Runtime', 'Data', 'System']) {
      const grp = h('div.side__group', h('div.side__label', { text: g }));
      for (const t of TABS.filter(x => x.group === g)) {
        const badge = h('small.dt-badge', { hidden: true });
        const b = h('button.side__item.dt-tab', {
          type: 'button', role: 'tab', id: `dt-tab-${uid}-${t.id}`, 'aria-controls': body.id, dataset: { tab: t.id },
          onclick: () => go(t.id),
        }, icon(t.icon), h('span', { text: t.label }), badge);
        tabBtns.set(t.id, b);
        badges.set(t.id, badge);
        grp.append(b);
      }
      side.append(grp);
    }
    side.addEventListener('keydown', e => {
      const order = TABS.map(t => t.id);
      const i = order.indexOf(document.activeElement?.dataset?.tab);
      if (i < 0) return;
      let j = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % order.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + order.length) % order.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = order.length - 1;
      if (j === null) return;
      e.preventDefault();
      go(order[j]);
      tabBtns.get(order[j]).focus();
    });

    function markSide() {
      for (const [id, b] of tabBtns) {
        const on = id === S.tab;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
      body.setAttribute('aria-labelledby', tabBtns.get(S.tab).id);
    }

    function setBadge(id, text, tone) {
      const b = badges.get(id);
      if (!b) return;
      b.textContent = text || '';
      b.className = `dt-badge${tone ? ` dt-badge--${tone}` : ''}`;
      b.hidden = !text;
    }
    function paintBadges() {
      if (S.dead) return;
      let err = 0;
      let warn = 0;
      for (const e of DL.entries()) { if (e.level === 'error') err++; else if (e.level === 'warn') warn++; }
      setBadge('console', err ? num(err) : warn ? num(warn) : '', err ? 'err' : warn ? 'warn' : '');
      setBadge('events', DL.busTap() ? 'REC' : '', 'rec');
      if (S.netDirty) { S.netCount = netCollect().length; S.netDirty = false; }
      setBadge('network', num(S.netCount || 0), '');
      setBadge('windows', num(wm.list().length), '');
    }
    const badgeSoon = () => { if (S.dead || S.paused) return; app.frame('badges', paintBadges); };

    /* ---- toolbar kit ---- */
    const tbtn = (ic, label, onclick, pressed) => h('button.ibtn.dt-ib', {
      type: 'button', title: label, 'aria-label': label, 'aria-pressed': pressed === undefined ? null : String(!!pressed), onclick,
    }, icon(ic));
    const tsep = () => h('span.dt-sep', { 'aria-hidden': 'true' });
    const grow = () => h('span.grow');
    function filterField(P, placeholder, onchange) {
      const input = h('input', { type: 'search', placeholder, value: P.st.q || '', spellcheck: 'false', autocomplete: 'off', 'aria-label': placeholder });
      let t = 0;
      input.addEventListener('input', () => {
        P.sc.cancel(t);
        t = P.sc.later(() => { P.st.q = input.value.trim(); onchange(); }, 140);
      });
      input.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !input.value) return;
        e.stopPropagation();
        input.value = '';
        P.st.q = '';
        onchange();
      });
      return h('label.field.dt-filter', icon('filter'), input);
    }
    const chip = (label, on, onclick, title) => h('button.dt-chip', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', class: on ? 'is-on' : '', title: title || null, onclick,
    }, label);
    const emptyState = (ic, title, text, ...extra) => h('div.empty.dt-empty', icon(ic), h('b', { text: title }), text ? h('small', { text }) : null, ...extra);
    const footText = (...parts) => h('span.dt-foot__t', { text: parts.filter(Boolean).join('  ·  ') });
    const sec = (title, sub, ...content) => h('section.dt-sec',
      h('header.dt-sec__h', h('h3', { text: title }), sub ? h('span.dt-sec__sub', { text: sub }) : null), ...content);
    const kvTable = rows => h('table.dt-kv', h('tbody', rows.filter(Boolean).map(([k, v, t]) =>
      h('tr', h('th', { scope: 'row', text: k }), h('td', { title: t || null }, v && v.nodeType ? v : String(v ?? '—'))))));
    const th = (text, cls) => h(`th${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`, { scope: 'col', text });
    const reading = () => h('div.dt-dim.dt-pad', { text: 'Reading…' });

    /* value cells for serialised nodes */
    function vEl(n, top, max) {
      const t = n ? n.t : 'u';
      const text = t === 'm' ? `•••• (${num(n.n)} chars)` : DL.preview(n, max || 300, top);
      return h(`span.dt-v.dt-v--${VCLS[t] || 'x'}`, { text, title: t === 'm' ? 'Looks like a secret, so it is masked' : null });
    }
    function treeEl(n, key, sep = ': ') {
      const kids = h('div.dt-kids', { hidden: true });
      let built = false;
      const tog = h('button.dt-tog', {
        type: 'button', 'aria-expanded': 'false',
        onclick: e => {
          e.stopPropagation();
          const open = tog.getAttribute('aria-expanded') !== 'true';
          tog.setAttribute('aria-expanded', String(open));
          if (open && !built) { built = true; kids.append(...kidRows(n)); }
          kids.hidden = !open;
        },
      },
      key !== null && key !== undefined ? h('span.dt-k', { text: key }) : null,
      key !== null && key !== undefined ? h('span.dt-p', { text: sep }) : null,
      n.t === 'e' ? h('span.dt-v.dt-v--err', { text: `${n.name}: ${n.msg}` }) : vEl(n, false, 240));
      return h('span.dt-tree', tog, kids);
    }
    function kidRows(n) {
      const rows = [];
      const add = (k, v, sep) => rows.push(canExpand(v)
        ? h('div.dt-kid', treeEl(v, k, sep))
        : h('div.dt-kid.dt-leaf', h('span.dt-k', { text: k }), h('span.dt-p', { text: sep || ': ' }), vEl(v, false, 2000)));
      if (n.t === 'o') for (const [k, v] of n.k) add(k, v);
      else if (n.t === 'a' || n.t === 'S') n.i.forEach((v, i) => add(String(i), v));
      else if (n.t === 'M') for (const [a, b] of n.e) add(DL.preview(a, 60), b, ' => ');
      else if (n.t === 'e') {
        for (const l of stackLines(n)) rows.push(h('div.dt-frame', { text: l }));
        if (n.k) for (const [k, v] of n.k) add(k, v);
      }
      const shown = n.t === 'o' ? n.k.length : n.t === 'M' ? n.e.length : n.t === 'e' ? 0 : n.i.length;
      if (n.t !== 'e' && n.n > shown) rows.push(h('div.dt-note', { text: `… ${num(n.n - shown)} more, not captured (the log keeps ${shown} per level)` }));
      return rows;
    }

    /* =============================== lifecycle =============================== */
    function isPaused() { return S.dead || document.hidden || !!win.min || !S.inView; }
    function syncPause() {
      const p = isPaused();
      if (p === S.paused) return;
      S.paused = p;
      if (p) { pane.dispose(); pane = scope(); syncTap(); }   /* the DOM stays as it was; nothing runs */
      else show(S.tab, 'resume');                             /* show() calls syncTap() itself */
    }
    /* Recording costs something on every single bus emit, so it follows the
       pane exactly: only while Events is the pane actually on screen. A
       minimised or hidden window records nothing — unless it was pinned,
       which is the one way to ask for recording to outlive the pane. */
    function syncTap() {
      DL.setBusTap(MEM.pinned || (!S.dead && !S.paused && S.tab === 'events' && MEM.recording));
    }
    function go(id) {
      const t = canonTab(id) || 'console';
      if (t === S.tab && S.mounted) return;
      show(t, 'switch');
    }
    function crash(err) {
      pane.dispose();
      pane = scope();
      clear(bar); clear(body); clear(foot);
      body.append(emptyState('alert', 'This pane stopped', String(err && err.message || err),
        h('button.btn.btn--sm', { type: 'button', onclick: () => show(S.tab, 'switch') }, icon('refresh'), h('span', { text: 'Try again' }))));
      try { console.error('[Static Developer]', err); } catch (e) { /* ignore */ }
    }
    function show(id, reason) {
      pane.dispose();
      pane = scope();
      S.tab = id;
      MEM.tab = id;
      S.mounted = true;
      syncTap();
      markSide();
      clear(bar); clear(body); clear(foot);
      body.className = `dt-body dt-body--${id}`;
      win.setSubtitle(TAB[id].label);
      const sc = pane;
      const P = {
        id, reason, st: stOf(id), sc,
        /* a coalesced render that can't loop: a throw disposes the pane */
        frame: (key, fn) => sc.frame(key, () => { try { fn(); } catch (err) { crash(err); } }),
      };
      try { PANES[id](P); } catch (err) { crash(err); }
      paintBadges();
    }

    /* ---- shared network collection (used by the pane and the badge) ---- */
    function netCollect() {
      const seen = new Set();
      const out = [];
      const add = e => {
        const k = `${e.name}|${Math.round(e.startTime * 1000)}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push(e);
      };
      try { performance.getEntriesByType('resource').forEach(add); } catch (e) { /* no Resource Timing */ }
      DL.network().forEach(add);
      return out;
    }

    /* ================================ panes ================================ */
    const PANES = {};

    /* -------------------------------- Console -------------------------------- */
    PANES.console = P => {
      const { st, sc } = P;
      const LV = [['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Info'], ['log', 'Logs'], ['debug', 'Debug']];
      const LVICON = { error: 'x-circle', warn: 'alert', info: 'info', debug: 'bug' };
      const lv = {};
      const levels = h('div.dt-seg', { role: 'group', 'aria-label': 'Message levels' }, LV.map(([k, label]) => {
        const n = h('span.dt-seg__n');
        const b = h(`button.dt-seg__b.dt-seg__b--${k}`, {
          type: 'button', 'aria-pressed': String(!!st.levels[k]), title: `Show ${label.toLowerCase()}`,
          onclick: () => { st.levels[k] = !st.levels[k]; b.setAttribute('aria-pressed', String(st.levels[k])); renderAll(true); },
        }, h('span', { text: label }), n);
        lv[k] = n;
        return b;
      }));
      const copyBtn = tbtn('copy', 'Copy the messages shown', async () => {
        const list = visible();
        const ok = await copyText(list.map(entryCopyText).join('\n'));
        note(ok ? 'Messages copied' : 'Copy failed', ok ? `${count(list.length, 'message')} on the clipboard.` : 'The browser refused clipboard access.');
      });
      bar.append(tbtn('trash', 'Clear console', () => DL.clear()), tsep(), filterField(P, 'Filter messages', () => renderAll(true)), levels, grow(), copyBtn);

      const logEl = h('div.dt-log', { role: 'log', 'aria-live': 'off', 'aria-label': 'Console messages', tabindex: '0' });
      const jumpN = h('span');
      const jump = h('button.dt-jump', { type: 'button', hidden: true, onclick: () => { logEl.scrollTop = logEl.scrollHeight; } }, icon('arrow-down'), jumpN);
      body.append(logEl, jump);
      const footEl = h('span.dt-foot__t');
      foot.append(footEl);

      let unseen = 0;
      let rows = 0;
      const atBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 28;
      logEl.addEventListener('scroll', () => { if (unseen && atBottom()) { unseen = 0; jump.hidden = true; } });

      const pass = e => st.levels[e.level] && (!st.q || `${e.text} ${e.site || ''}`.toLowerCase().includes(st.q.toLowerCase()));
      const visible = () => DL.entries().filter(pass);

      function rowEl(e) {
        const msg = h('div.dt-row__msg');
        e.args.forEach((n, i) => {
          if (i) msg.append(' ');
          if (n.t === 's') msg.append(h('span.dt-s', { text: n.n ? `${n.v}… (${num(n.n)} chars, cut)` : n.v }));
          else if (canExpand(n)) msg.append(treeEl(n, null));
          else msg.append(vEl(n, true, 2000));
        });
        if (e.stack) {
          msg.append(' ', treeEl({ t: 'e', name: 'stack', msg: `${e.stack.split('\n').length} frames`, stack: e.stack }, null));
        }
        const src = e.site
          ? h('span.dt-row__src', { text: e.site, title: e.source === 'console' ? `Logged from ${e.site}` : e.site })
          : e.source === 'resource' ? h('span.dt-row__src', { text: 'resource' }) : null;
        return h(`div.dt-row.dt-row--${e.level}`, { dataset: { id: String(e.id) } },
          h('span.dt-row__ico', LVICON[e.level] ? icon(LVICON[e.level]) : null),
          h('time.dt-row__time', { text: clock(e.t), datetime: new Date(e.t).toISOString() }),
          h('span.dt-count', { text: String(e.count), hidden: e.count < 2, title: `Logged ${e.count} times in a row` }),
          msg, src);
      }

      function paintCounts() {
        const c = { error: 0, warn: 0, info: 0, log: 0, debug: 0 };
        for (const e of DL.entries()) c[e.level] = (c[e.level] || 0) + 1;
        for (const [k] of LV) lv[k].textContent = c[k] ? num(c[k]) : '';
        const s = DL.stats();
        const vis = visible().length;
        const since = s.startedAt ? `capturing since ${clock(s.startedAt, false)} (${(s.startedPerf / 1000).toFixed(1)} s after the page loaded)` : '';
        const shownNote = rows < vis ? `showing the newest ${num(rows)} of ${num(vis)}` : `${count(vis, 'message')} shown`;
        footEl.textContent = [shownNote, `${num(s.console.kept)} kept of ${num(s.console.max)} max`,
          s.console.dropped ? `${num(s.console.dropped)} older dropped` : '', since].filter(Boolean).join('  ·  ');
        copyBtn.disabled = !vis;
      }

      function emptyNow() {
        if (!DL.entries().length) {
          return emptyState('terminal', 'No messages yet',
            'console.log, warnings and errors, scripts or images that fail to load and unhandled promise rejections all land here.');
        }
        return emptyState('filter', 'Nothing matches', 'Every kept message is hidden by the level buttons or the filter.',
          h('button.btn.btn--sm', { type: 'button', onclick: () => { st.q = ''; for (const [k] of LV) st.levels[k] = true; show('console', 'switch'); } }, h('span', { text: 'Show everything' })));
      }

      function renderAll(stick) {
        const list = visible();
        const from = Math.max(0, list.length - st.limit);
        clear(logEl);
        if (from > 0) {
          logEl.append(h('button.dt-more', {
            type: 'button',
            onclick: () => {
              st.limit += 250;
              const fromBottom = logEl.scrollHeight - logEl.scrollTop;
              renderAll(false);
              logEl.scrollTop = logEl.scrollHeight - fromBottom;
            },
          }, `Show ${num(Math.min(250, from))} earlier`));
        }
        const frag = document.createDocumentFragment();
        for (let i = from; i < list.length; i++) frag.append(rowEl(list[i]));
        logEl.append(frag);
        rows = list.length - from;
        if (!list.length) logEl.append(emptyNow());
        paintCounts();
        if (stick) { logEl.scrollTop = logEl.scrollHeight; unseen = 0; jump.hidden = true; }
      }

      const queue = [];
      const reps = new Set();
      let full = false;
      function flush() {
        if (full) { full = false; queue.length = 0; reps.clear(); renderAll(true); return; }
        const stick = atBottom();
        const frag = document.createDocumentFragment();
        let added = 0;
        for (const e of queue) if (pass(e)) { frag.append(rowEl(e)); added++; }
        queue.length = 0;
        if (added) {
          logEl.querySelector('.dt-empty')?.remove();
          logEl.append(frag);
          rows += added;
        }
        for (const e of reps) {
          const c = logEl.querySelector(`.dt-row[data-id="${e.id}"] .dt-count`);
          if (c) { c.textContent = String(e.count); c.hidden = false; c.title = `Logged ${e.count} times in a row`; }
        }
        reps.clear();
        if (rows > st.limit + 100) { renderAll(stick); return; }
        paintCounts();
        if (stick) logEl.scrollTop = logEl.scrollHeight;
        else if (added) { unseen += added; jumpN.textContent = `${num(unseen)} new`; jump.hidden = false; }
      }
      sc.on(DL.onEntry((e, kind) => {
        if (kind === 'clear') full = true;
        else if (kind === 'repeat') reps.add(e);
        else if (e) queue.push(e);
        P.frame('flush', flush);
      }));
      renderAll(true);
    };

    /* -------------------------------- Events -------------------------------- */
    PANES.events = P => {
      const { st, sc } = P;
      const recLabel = h('span');
      const rec = h('button.dt-rec', { type: 'button', onclick: () => { MEM.recording = !MEM.recording; syncTap(); paintRec(); } }, h('i.dt-rec__dot', { 'aria-hidden': 'true' }), recLabel);
      const pin = tbtn('pin', 'Keep recording when this pane is closed', () => { MEM.pinned = !MEM.pinned; syncTap(); paintRec(); }, MEM.pinned);
      const beat = chip('Heartbeat', st.beat, () => { st.beat = !st.beat; beat.classList.toggle('is-on', st.beat); beat.setAttribute('aria-pressed', String(st.beat)); renderAll(true); },
        'Show the OS heartbeat: tick:1s, tick:5s, metrics:tick and the live gauges written every second');
      bar.append(rec, pin, tsep(), filterField(P, 'Filter by event name or payload', () => renderAll(true)), beat, grow(),
        tbtn('trash', 'Clear recorded events', () => DL.clearBus()));

      const list = h('div.dt-log.dt-evlog', { role: 'log', 'aria-live': 'off', 'aria-label': 'OS bus events', tabindex: '0' });
      body.append(h('div.dt-evhead', { 'aria-hidden': 'true' }, h('span', { text: 'Time' }), h('span', { text: 'Event' }), h('span', { text: 'Payload' })), list);
      const footEl = h('span.dt-foot__t');
      foot.append(footEl);

      function paintRec() {
        const on = DL.busTap();
        rec.classList.toggle('is-on', on);
        rec.setAttribute('aria-pressed', String(MEM.recording));
        rec.title = MEM.recording ? 'Recording while this pane is open — press to pause' : 'Paused — press to record';
        recLabel.textContent = on ? 'Recording' : 'Paused';
        pin.setAttribute('aria-pressed', String(MEM.pinned));
        pin.classList.toggle('is-on', MEM.pinned);
        pin.title = MEM.pinned ? 'Pinned: recording continues when this pane or the window is closed' : 'Keep recording when this pane is closed';
        paintFoot();
      }
      const pass = e => (st.beat || !e.beat) && (!st.q || `${e.evt} ${e.text}`.toLowerCase().includes(st.q.toLowerCase()));
      const NAMES = { 'state:change': ['path', 'value'], 'fs:change': ['dir', 'path'] };

      function evRow(e) {
        const kids = h('div.dt-kids.dt-evkids', { hidden: true });
        let built = false;
        const headBtn = h('button.dt-ev__head', {
          type: 'button', 'aria-expanded': 'false',
          onclick: () => {
            const open = headBtn.getAttribute('aria-expanded') !== 'true';
            headBtn.setAttribute('aria-expanded', String(open));
            if (open && !built) {
              built = true;
              const names = NAMES[e.evt] || [];
              if (!e.args.length) kids.append(h('div.dt-note', { text: 'No payload.' }));
              e.args.forEach((n, i) => {
                const k = names[i] || (e.args.length === 1 ? 'payload' : `arg ${i}`);
                kids.append(canExpand(n)
                  ? h('div.dt-kid', treeEl(n, k))
                  : h('div.dt-kid.dt-leaf', h('span.dt-k', { text: k }), h('span.dt-p', { text: ': ' }), vEl(n, false, 4000)));
              });
            }
            kids.hidden = !open;
          },
        },
        h('time.dt-row__time', { text: clock(e.t), datetime: new Date(e.t).toISOString() }),
        h('span.dt-ev__name', { text: e.evt }),
        h('span.dt-ev__args', { text: e.text || '—' }));
        return h('div.dt-ev', { class: e.beat ? 'is-beat' : '', dataset: { id: String(e.id) } }, headBtn, kids);
      }

      function paintFoot() {
        const s = DL.stats();
        const all = DL.busLog();
        const names = new Set(all.map(e => e.evt));
        footEl.textContent = [
          `${count(all.length, 'event')} kept (${num(s.bus.max)} + ${num(s.bus.beatMax)} heartbeat max)`,
          `${count(names.size, 'distinct name')}`,
          s.bus.tap ? `recording since ${clock(s.bus.since, false)}` : 'not recording',
          'subscriber counts aren’t shown: bus.js keeps its listeners private',
        ].join('  ·  ');
      }

      function emptyNow() {
        if (!DL.busTap() && !DL.busLog().length) return emptyState('pause', 'Recording is paused', 'Press Record to watch the OS bus. Nothing is recorded while paused.');
        if (!DL.busLog().length) return emptyState('activity', 'Listening…', 'Open a window, change a setting or save a file and its events appear here.');
        return emptyState('filter', 'Nothing matches', st.beat ? 'The filter hides every recorded event.' : 'Only heartbeat events so far, or the filter hides the rest. Turn on Heartbeat to see the ticks.');
      }

      let rows = 0;
      const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 28;
      function renderAll(stick) {
        clear(list);
        const shown = DL.busLog().filter(pass);
        const frag = document.createDocumentFragment();
        for (const e of shown) frag.append(evRow(e));
        list.append(frag);
        rows = shown.length;
        if (!rows) list.append(emptyNow());
        paintFoot();
        if (stick) list.scrollTop = list.scrollHeight;
      }
      const queue = [];
      let full = false;
      function flush() {
        if (full) { full = false; queue.length = 0; renderAll(true); return; }
        const stick = atBottom();
        const frag = document.createDocumentFragment();
        let added = 0;
        for (const e of queue) if (pass(e)) { frag.append(evRow(e)); added++; }
        queue.length = 0;
        if (added) { list.querySelector('.dt-empty')?.remove(); list.append(frag); rows += added; }
        /* keep the DOM in step with devlog's ring (it holds ~360) */
        while (rows > 420 && list.firstElementChild) { list.firstElementChild.remove(); rows--; }
        paintFoot();
        if (stick) list.scrollTop = list.scrollHeight;
      }
      sc.on(DL.onBus((e, kind) => {
        if (kind === 'tap') { paintRec(); if (!DL.busLog().length) full = true; P.frame('flush', flush); return; }
        if (kind === 'clear') full = true;
        else if (e) queue.push(e);
        P.frame('flush', flush);
      }));
      paintRec();
      renderAll(true);
    };

    /* -------------------------------- Network -------------------------------- */
    PANES.network = P => {
      const { st, sc } = P;
      const TYPES = [
        ['all', 'All', null],
        ['fetch', 'Fetch/XHR', ['fetch', 'xmlhttprequest', 'beacon']],
        ['js', 'JS', ['script']],
        ['css', 'CSS', ['link', 'css']],
        ['img', 'Img', ['img', 'image', 'icon']],
        ['media', 'Media', ['video', 'audio', 'track']],
        ['other', 'Other', null],
      ];
      const known = new Set(TYPES.flatMap(t => t[2] || []));
      const typeBar = h('div.dt-seg', { role: 'group', 'aria-label': 'Request types' }, TYPES.map(([k, label]) => h('button.dt-seg__b', {
        type: 'button', 'aria-pressed': String(st.type === k),
        onclick: () => { st.type = k; for (const b of typeBar.children) b.setAttribute('aria-pressed', String(b.dataset.k === k)); render(); },
        dataset: { k },
      }, h('span', { text: label }))));
      bar.append(filterField(P, 'Filter by URL', () => render()), typeBar, grow(), tbtn('refresh', 'Read the timing buffer again', () => render()));

      const COLS = [
        ['name', 'Name', ''], ['status', 'Status', 'dt-c-status num'], ['type', 'Type', 'dt-c-type'], ['transfer', 'Transfer', 'num'],
        ['size', 'Size', 'num dt-c-size'], ['dur', 'Time', 'num'], ['start', 'Start', 'num dt-c-start'], ['wf', 'Waterfall', 'dt-c-wf'],
      ];
      const headRow = h('tr');
      const thead = h('thead', headRow);
      const tbody = h('tbody');
      const table = h('table.dt-table.dt-table--net', thead, tbody);
      const scroller = h('div.dt-scroll', table);
      body.append(h('div.dt-strip', icon('info'), h('span', { text: 'Cross-origin sizes, status and timings read 0 unless that server sends Timing-Allow-Origin. WebSockets (the live channel, the proxy tunnel) are not listed — the browser does not time them.' })), scroller);
      const footEl = h('span.dt-foot__t');
      foot.append(footEl);

      function paintHead() {
        clear(headRow);
        for (const [k, label, cls] of COLS) {
          if (k === 'wf') { headRow.append(th(label, cls)); continue; }
          const on = st.sort === k;
          headRow.append(h(`th${cls ? `.${cls.split(' ').join('.')}` : ''}`, { scope: 'col', 'aria-sort': on ? (st.dir > 0 ? 'ascending' : 'descending') : null },
            h('button.dt-sort', {
              type: 'button', class: on ? 'is-on' : '',
              onclick: () => { if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'name' || k === 'type' || k === 'start' ? 1 : -1; } render(); },
            }, label, on ? h('span.dt-sort__arrow', { text: st.dir > 0 ? '▲' : '▼', 'aria-hidden': 'true' }) : null)));
        }
      }

      function rowData(e) {
        const url = String(e.name || '');
        let host = '';
        let file = url;
        let path = url;
        try {
          const u = new URL(url, location.href);
          if (u.protocol === 'data:' || u.protocol === 'blob:') { file = `${u.protocol}${url.slice(u.protocol.length, u.protocol.length + 24)}…`; path = ''; }
          else {
            host = u.origin === location.origin ? '' : u.host;
            const seg = u.pathname.split('/').filter(Boolean);
            file = (seg[seg.length - 1] || u.host || '/') + u.search.slice(0, 40);
            path = u.origin === location.origin ? u.pathname : `${u.host}${u.pathname}`;
          }
        } catch (err) { /* keep the raw name */ }
        const transfer = Number(e.transferSize) || 0;
        const decoded = Number(e.decodedBodySize) || 0;
        const encoded = Number(e.encodedBodySize) || 0;
        const cached = e.deliveryType === 'cache' || (transfer === 0 && decoded > 0);
        const hidden = !!host && transfer === 0 && decoded === 0 && encoded === 0;
        const status = Number(e.responseStatus) || 0;
        return { e, url, host, file, path, type: e.initiatorType || 'other', transfer, decoded, cached, hidden, status, dur: e.duration, start: e.startTime };
      }

      function data() {
        const nav = (() => { try { return performance.getEntriesByType('navigation')[0] || null; } catch (e) { return null; } })();
        const list = netCollect().map(rowData);
        if (nav) { const r = rowData(nav); r.type = 'navigation'; r.nav = true; list.unshift(r); }
        return list;
      }
      function passType(r) {
        if (st.type === 'all') return true;
        const t = TYPES.find(x => x[0] === st.type);
        if (st.type === 'other') return !known.has(r.type);
        return t && t[2] ? t[2].includes(r.type) : true;
      }

      function detailRow(r) {
        const e = r.e;
        const span = (a, b) => (e[a] > 0 && e[b] > 0 ? Math.max(0, e[b] - e[a]) : null);
        const t = [
          ['Redirect', span('redirectStart', 'redirectEnd')],
          ['DNS', span('domainLookupStart', 'domainLookupEnd')],
          ['Connect', span('connectStart', 'connectEnd')],
          ['TLS', e.secureConnectionStart > 0 && e.connectEnd > 0 ? Math.max(0, e.connectEnd - e.secureConnectionStart) : null],
          ['Waiting (TTFB)', span('requestStart', 'responseStart')],
          ['Download', span('responseStart', 'responseEnd')],
        ];
        const phases = t.map(([k, v]) => [k, v === null ? (r.host ? 'hidden (cross-origin)' : '0 ms') : msf(v)]);
        return h('tr.dt-detail', h('td', { colspan: String(COLS.length) }, kvTable([
          ['URL', h('span.dt-sel', { text: r.url })],
          ['Initiator', r.type],
          ['Protocol', e.nextHopProtocol || '—'],
          ['Delivered', e.deliveryType === 'cache' ? 'from cache' : r.cached ? 'from cache (0 bytes over the network)' : r.hidden ? 'not reported (cross-origin)' : 'network'],
          ['Sizes', `transfer ${bytes(r.transfer)} · encoded ${bytes(Number(e.encodedBodySize) || 0)} · decoded ${bytes(r.decoded)}`],
          ['Render blocking', e.renderBlockingStatus || '—'],
          ...phases,
        ])));
      }

      function render() {
        const keep = scroller.scrollTop;
        const all = data();
        const q = st.q.toLowerCase();
        const shown = all.filter(r => passType(r) && (!q || r.url.toLowerCase().includes(q)));
        const key = { name: r => r.file.toLowerCase(), status: r => r.status, type: r => r.type, transfer: r => r.transfer, size: r => r.decoded, dur: r => r.dur, start: r => r.start }[st.sort] || (r => r.start);
        shown.sort((a, b) => { const x = key(a); const y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * st.dir; });
        const end = Math.max(1, ...all.map(r => r.start + r.dur));
        paintHead();
        clear(tbody);
        const lim = Math.min(shown.length, st.limit);
        for (let i = 0; i < lim; i++) {
          const r = shown[i];
          const id = `${r.url}|${Math.round(r.start * 1000)}`;
          const open = st.open.has(id);
          const tr = h('tr.dt-nrow', {
            class: `${open ? 'is-open' : ''}${r.status >= 400 ? ' is-bad' : ''}`, tabindex: '0', 'aria-expanded': String(open),
            onclick: () => { if (st.open.has(id)) st.open.delete(id); else st.open.add(id); render(); },
            onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click(); } },
          },
          h('td.dt-c-name', { title: r.url }, h('span.dt-nfile', { text: r.file }), r.host ? h('span.dt-nhost', { text: r.host }) : null),
          h('td.dt-c-status.num', { text: r.status ? String(r.status) : '—', title: r.status ? null : 'Not reported (older browser, or cross-origin without Timing-Allow-Origin)' }),
          h('td.dt-c-type', { text: r.type }),
          h('td.num', { text: r.nav && !r.transfer ? '—' : r.cached ? '(cache)' : r.hidden ? '—' : bytes(r.transfer), title: r.hidden ? 'Hidden: cross-origin without Timing-Allow-Origin' : r.cached ? 'Served from the browser cache' : null }),
          h('td.num.dt-c-size', { text: r.hidden ? '—' : bytes(r.decoded) }),
          h('td.num', { text: msf(r.dur) }),
          h('td.num.dt-c-start', { text: msf(r.start) }),
          h('td.dt-c-wf', h('span.dt-wf', { 'aria-hidden': 'true' }, h('i', { style: { left: `${(r.start / end) * 100}%`, width: `${Math.max(0.4, (r.dur / end) * 100)}%` } }))));
          tbody.append(tr);
          if (open) tbody.append(detailRow(r));
        }
        if (shown.length > lim) {
          tbody.append(h('tr.dt-morerow', h('td', { colspan: String(COLS.length) },
            h('button.dt-more', { type: 'button', onclick: () => { st.limit += 300; render(); } }, `Show ${num(Math.min(300, shown.length - lim))} more of ${num(shown.length - lim)}`))));
        }
        if (!shown.length) {
          tbody.append(h('tr', h('td', { colspan: String(COLS.length) }, emptyState('globe', all.length ? 'Nothing matches' : 'No requests recorded', all.length ? 'The type buttons or the filter hide every request.' : 'This browser has not reported any resource timing entries.'))));
        }
        const res = all.filter(r => !r.nav);
        const tx = res.reduce((a, r) => a + r.transfer, 0);
        const dec = res.reduce((a, r) => a + r.decoded, 0);
        const cachedN = res.filter(r => r.cached).length;
        const hiddenN = res.filter(r => r.hidden).length;
        const nav = all.find(r => r.nav)?.e;
        const s = DL.stats();
        footEl.textContent = [
          shown.length !== res.length + (nav ? 1 : 0) ? `${num(shown.length)} of ${count(res.length, 'request')}` : count(res.length, 'request'),
          `${bytes(tx)} transferred`, `${bytes(dec)} resources`, `${num(cachedN)} from cache`,
          hiddenN ? `${num(hiddenN)} cross-origin without sizes` : '',
          nav && nav.domContentLoadedEventEnd ? `DOMContentLoaded ${msf(nav.domContentLoadedEventEnd)}` : '',
          nav && nav.loadEventEnd ? `Load ${msf(nav.loadEventEnd)}` : '',
          s.net.bufferFull ? 'the browser’s own timing buffer filled; later requests come from Static Developer’s observer' : '',
        ].filter(Boolean).join('  ·  ');
        scroller.scrollTop = keep;
      }

      let last = 0;
      let pending = 0;
      const soon = () => {
        const wait = 500 - (performance.now() - last);
        if (wait <= 0) P.frame('render', () => { last = performance.now(); render(); });
        else if (!pending) pending = sc.later(() => { pending = 0; last = performance.now(); P.frame('render', render); }, wait);
      };
      sc.on(DL.onNetwork(soon));
      last = performance.now();
      render();
    };

    /* -------------------------------- App State -------------------------------- */
    PANES.state = P => {
      const { st, sc } = P;
      const SEP = '␟';
      const dotted = k => k.split(SEP).join('.');
      let persisted = new Set();
      try {
        const raw = profiles.local.getItem(profiles.key('staticos.state.v3'));
        if (raw) persisted = new Set(Object.keys(JSON.parse(raw) || {}));
      } catch (e) { /* unreadable: every root shows as memory */ }
      const sizes = new Map();
      const flashes = new Map();

      bar.append(filterField(P, 'Filter by path or value', () => render()), grow(),
        tbtn('minimize-2', 'Collapse all', () => { st.open.clear(); render(); }));
      const tbody = h('tbody');
      const table = h('table.dt-table.dt-table--tree',
        h('thead', h('tr', th('Key', 'dt-c-name'), th('Value'), th('Type', 'dt-c-type'), th('JSON', 'num dt-c-size'), h('th.dt-c-act', { scope: 'col' }, h('span.sr', { text: 'Actions' })))),
        tbody);
      const scroller = h('div.dt-scroll', table);
      body.append(scroller);
      const footEl = h('span.dt-foot__t');
      foot.append(footEl);

      const secretFor = (key, v) => (DL.isSecretKey(String(key)) && DL.maskable(v)) || DL.looksSecret(v);
      /* a store object keyed BY a token (a cache, a peer map) must not print
         the token as a row label or in a tooltip either */
      const safeKey = k => (DL.looksSecret(String(k)) ? `•••• (${String(k).length} chars)` : String(k));
      const safePath = pk => pk.split(SEP).map(safeKey).join('.');
      /* rows are tagged with an opaque id, not the path: a path can contain a
         token-shaped key, and data-* lands in the DOM, in a saved page and in
         the browser's own element inspector. Only this pane resolves the id,
         and it keeps them so focus survives a re-render. */
      const rowIds = new Map();
      const idOf = pk => { let v = rowIds.get(pk); if (!v) { v = `k${rowIds.size + 1}`; rowIds.set(pk, v); } return v; };
      const sizeOf = (pk, v) => { if (!sizes.has(pk)) sizes.set(pk, jsonLen(v)); return sizes.get(pk); };
      function typeLabel(v, n) {
        if (v === null) return 'null';
        if (Array.isArray(v)) return `Array · ${num(n)}`;
        if (typeof v === 'object') {
          const c = Object.getPrototypeOf(v)?.constructor?.name;
          return `${c && c !== 'Object' ? c : 'Object'} · ${num(n)}`;
        }
        if (typeof v === 'string') return `string · ${num(v.length)}`;
        return typeof v;
      }
      function flashClass(tr, pk) {
        const at = flashes.get(pk);
        if (!at) return;
        const age = performance.now() - at;
        if (age > 900) { flashes.delete(pk); return; }
        tr.classList.add('is-changed');
        tr.style.animationDelay = `-${Math.round(age)}ms`;
      }

      function row(v, key, pk, depth, isRoot, label) {
        const secret = secretFor(key, v);
        const container = !secret && v !== null && typeof v === 'object';
        const n = container ? (Array.isArray(v) ? v.length : Object.keys(v).length) : 0;
        const open = container && n > 0 && st.open.has(pk);
        const tr = h('tr.dt-srow', { dataset: { key: idOf(pk) } });
        flashClass(tr, pk);
        tr.append(
          h('td.dt-c-name', { style: { '--d': String(depth) } },
            container && n > 0
              ? h('button.dt-tog.dt-tog--row', {
                type: 'button', 'aria-expanded': String(open), dataset: { key: idOf(pk) }, 'aria-label': `${open ? 'Collapse' : 'Expand'} ${safePath(pk)}`,
                onclick: () => { if (st.open.has(pk)) st.open.delete(pk); else st.open.add(pk); render(); },
              })
              : h('span.dt-tog.dt-tog--leaf', { 'aria-hidden': 'true' }),
            h('span.dt-k', { text: label || safeKey(key), title: safePath(pk) }),
            isRoot ? h('span.dt-tag', {
              text: persisted.has(key) ? 'saved' : 'memory',
              title: persisted.has(key) ? 'Saved in localStorage (staticos.state.v3) and restored on reload' : 'Lives in memory only; gone on reload',
            }) : null),
          h('td.dt-c-val', secret
            ? h('span.dt-v.dt-v--mask', { text: `•••• (${num(DL.lengthOf(v))} chars)`, title: 'Looks like a secret, so it is masked' })
            : vEl(DL.serialize(v, { top: false, budget: 60, maskValues: true }), false, 220)),
          h('td.dt-c-type', { text: typeLabel(v, n) }),
          h('td.num.dt-c-size', { text: bytes(sizeOf(pk, v)) }),
          h('td.dt-c-act', isRoot ? h('button.ibtn.dt-ib', {
            type: 'button', title: `Copy ${key} as JSON (secrets masked)`, 'aria-label': `Copy ${key} as JSON`, onclick: () => copyRoot(key),
          }, icon('copy')) : null));
        tbody.append(tr);
        if (open) {
          const lim = st.limits.get(pk) || 200;
          const keys = Array.isArray(v) ? null : Object.keys(v);
          const total = keys ? keys.length : v.length;
          for (let i = 0; i < Math.min(total, lim); i++) {
            const k = keys ? keys[i] : String(i);
            row(v[k], k, pk + SEP + k, depth + 1, false);
          }
          if (total > lim) {
            tbody.append(h('tr.dt-morerow', h('td', { colspan: '5', style: { '--d': String(depth + 1) } },
              h('button.dt-more', { type: 'button', onclick: () => { st.limits.set(pk, lim + 200); render(); } }, `Show ${num(Math.min(200, total - lim))} more of ${num(total - lim)}`))));
          }
        }
      }

      function search(state) {
        const q = st.q.toLowerCase();
        const hits = [];
        let visited = 0;
        const walk = (v, key, pk) => {
          if (hits.length >= 300 || visited++ > 25000) return;
          const secret = secretFor(key, v);
          const isObj = !secret && v !== null && typeof v === 'object';
          const prim = !isObj && !secret && v !== undefined ? String(v).toLowerCase() : '';
          if (dotted(pk).toLowerCase().includes(q) || (prim && prim.includes(q))) hits.push([v, key, pk]);
          if (isObj) for (const k of Object.keys(v)) walk(v[k], k, pk + SEP + k);
        };
        for (const k of Object.keys(state)) walk(state[k], k, k);
        for (const [v, key, pk] of hits) row(v, key, pk, 0, false, safePath(pk));
        if (!hits.length) tbody.append(h('tr', h('td', { colspan: '5' }, emptyState('search', 'Nothing matches', `No path or value contains “${st.q}”. Masked values are never searched.`))));
        return hits.length;
      }

      async function copyRoot(k) {
        const text = DL.jsonMasked(store.get(k), 2) ?? 'undefined';
        const ok = await copyText(text);
        note(ok ? `Copied ${k}` : 'Copy failed', ok ? `${bytes(text.length)} of JSON; secret-looking values are masked.` : 'The browser refused clipboard access.', ok ? 'copy' : 'alert');
      }

      function render() {
        const keep = scroller.scrollTop;
        const focusKey = document.activeElement && tbody.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        const state = store.get() || {};
        clear(tbody);
        let hits = null;
        if (st.q) hits = search(state);
        else for (const k of Object.keys(state)) row(state[k], k, k, 0, true);
        const roots = Object.keys(state);
        footEl.textContent = [
          hits !== null ? `${count(hits, 'match', 'matches')}${hits >= 300 ? ' (first 300)' : ''}` : `${count(roots.length, 'root')} · ${roots.filter(k => persisted.has(k)).length} saved`,
          `${bytes(roots.reduce((a, k) => a + (persisted.has(k) ? sizeOf(k, state[k]) || 0 : 0), 0))} of JSON saved to localStorage`,
          'read-only',
          'secret-looking values are masked, here and in copies',
        ].join('  ·  ');
        scroller.scrollTop = keep;
        if (focusKey) tbody.querySelector(`button[data-key="${CSS.escape(focusKey)}"]`)?.focus();
      }

      let last = 0;
      let pending = 0;
      const soon = () => {
        const wait = 450 - (performance.now() - last);
        if (wait <= 0) P.frame('render', () => { last = performance.now(); render(); });
        else if (!pending) pending = sc.later(() => { pending = 0; P.frame('render', () => { last = performance.now(); render(); }); }, wait);
      };
      sc.on(store.sub('*', (value, path) => {
        const p = String(path || '');
        if (p === '*') { sizes.clear(); soon(); return; }
        const parts = p.split('.');
        const pk = parts.join(SEP);
        for (const k of [...sizes.keys()]) if (k === pk || k.startsWith(pk + SEP) || pk.startsWith(k + SEP)) sizes.delete(k);
        const now = performance.now();
        for (let i = 1; i <= parts.length; i++) flashes.set(parts.slice(0, i).join(SEP), now);
        soon();
      }));
      last = performance.now();
      render();
    };

    /* -------------------------------- Storage -------------------------------- */
    PANES.storage = P => {
      const { sc } = P;
      bar.append(h('span.dt-bar__title', { text: 'What StaticOS keeps in this browser' }), grow(), tbtn('refresh', 'Read everything again', () => show('storage', 'switch')));
      const wrap = h('div.dt-scroll.dt-secs');
      body.append(wrap);
      const footEl = footText('Values are not shown here — App State and Files show the two big ones', 'sizes are read now, not estimated from memory');
      foot.append(footEl);

      /* quota */
      const quota = sec('Origin quota', 'navigator.storage.estimate()', reading());
      wrap.append(quota);
      (async () => {
        let content;
        if (!navigator.storage?.estimate) content = h('div.dt-dim.dt-pad', { text: 'This browser does not report a storage estimate to pages.' });
        else {
          try {
            const e = await navigator.storage.estimate();
            const persisted = navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
            const pct = e.quota ? Math.min(100, (e.usage || 0) / e.quota * 100) : 0;
            const det = e.usageDetails ? Object.entries(e.usageDetails).map(([k, v]) => `${k} ${bytes(v)}`).join(' · ') : '';
            content = h('div.dt-pad',
              h('div.dt-meterbar', h('i', { style: { width: `${Math.max(0.5, pct)}%` } })),
              kvTable([
                ['Used', `${bytes(e.usage || 0)} of ${bytes(e.quota || 0)} (${pct < 0.1 && e.usage ? '<0.1' : pct.toFixed(1)}%)`],
                det ? ['Breakdown', det, 'usageDetails — Chromium only'] : null,
                ['Persistent', persisted === null ? 'not reported' : persisted ? 'yes — the browser won’t evict this origin under pressure' : 'no — the browser may evict this origin under storage pressure'],
                ['Note', 'Browsers round and pad this figure on purpose, so it is approximate.'],
              ]));
          } catch (err) { content = h('div.dt-dim.dt-pad', { text: `The estimate failed: ${err.message}` }); }
        }
        if (!sc.alive) return;
        quota.lastChild.replaceWith(content);
      })();

      /* local + session storage */
      function kvStore(title, sub, S0) {
        let rows = [];
        let others = 0;
        try {
          for (let i = 0; i < S0.length; i++) {
            const k = S0.key(i);
            let v = '';
            try { v = S0.getItem(k) || ''; } catch (e) { /* unreadable */ }
            /* another person's data on this computer: counted, never named */
            if (S0 === window.localStorage && profiles.foreign(k)) { others += lsBytes(k, v); continue; }
            rows.push({ k, n: lsBytes(k, v) });
          }
          if (others) rows.push({ k: '(other people on this computer)', n: others });
        } catch (e) { return sec(title, sub, h('div.dt-dim.dt-pad', { text: `Not readable here: ${e.message}` })); }
        rows = rows.sort((a, b) => b.n - a.n);
        const total = rows.reduce((a, r) => a + r.n, 0);
        if (!rows.length) return sec(title, sub, h('div.dt-dim.dt-pad', { text: 'Empty.' }));
        return sec(title, `${sub} · ${count(rows.length, 'key')} · ${bytes(total)}`,
          h('table.dt-table.dt-table--flat',
            h('thead', h('tr', th('Key'), th('Size', 'num'), th('Share', 'dt-c-share'))),
            h('tbody', rows.map(r => h('tr',
              /* keys only — values are never read into the DOM here — and even
                 a key that is itself token-shaped is masked */
              h('td.dt-mono', { text: DL.looksSecret(r.k) ? `•••• (${num(r.k.length)} chars)` : r.k }),
              h('td.num', { text: bytes(r.n) }),
              h('td.dt-c-share', h('span.dt-share', h('i', { style: { width: `${Math.max(0.5, (r.n / (total || 1)) * 100)}%` } }))))))));
      }
      let ls = null;
      let ss = null;
      try { ls = window.localStorage; } catch (e) { /* blocked */ }
      try { ss = window.sessionStorage; } catch (e) { /* blocked */ }
      wrap.append(ls ? kvStore('localStorage', '(key + value) × 2 bytes, as UTF-16 — the limit is about 5 MB and differs by browser', ls) : sec('localStorage', '', h('div.dt-dim.dt-pad', { text: 'Blocked in this browser.' })));
      wrap.append(ss ? kvStore('sessionStorage', 'this tab only', ss) : sec('sessionStorage', '', h('div.dt-dim.dt-pad', { text: 'Blocked in this browser.' })));

      /* IndexedDB */
      const idb = sec('IndexedDB', 'staticos · via js/core/db.js', reading());
      wrap.append(idb);
      (async () => {
        let content;
        try {
          if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser.');
          let dbs = null;
          try { if (indexedDB.databases) dbs = await indexedDB.databases(); } catch (e) { dbs = null; }
          const own = profiles.idbName() || 'staticos';   /* this person's (core/profiles.js) */
          const mine = dbs ? dbs.find(d => d.name === own) : null;
          const others = dbs ? dbs.filter(d => d.name !== own && !profiles.foreign(d.name)) : [];
          const parts = [];
          if (dbs && !mine) {
            parts.push(h('div.dt-dim.dt-pad', { text: 'Not created yet — no app has stored anything in IndexedDB on this device. (Static Developer does not create it just to look.)' }));
          } else {
            const DB = await import('../core/db.js');
            const STORES = ['projects', 'assets', 'clips', 'misc', 'media'];
            const rows = [];
            for (const name of STORES) {
              try {
                const kv = DB.kv(name);
                const keys = await kv.keys();
                const vals = keys.length ? await kv.all() : [];
                rows.push({ name, n: keys.length, size: approxBytes(vals) });
              } catch (err) { rows.push({ name, err: err.message }); }
            }
            parts.push(h('table.dt-table.dt-table--flat',
              h('thead', h('tr', th('Store'), th('Records', 'num'), th('≈ Size', 'num'))),
              h('tbody', rows.map(r => h('tr',
                h('td.dt-mono', { text: r.name }),
                h('td.num', { text: r.err ? '—' : num(r.n) }),
                h('td.num', { text: r.err ? r.err : bytes(r.size), title: 'Blobs count at their byte size; other values are estimated (strings at 2 bytes per character)' }))))));
            if (!DB.persistent) parts.push(h('div.dt-warnline', icon('alert'), h('span', { text: 'db.js fell back to memory: IndexedDB would not open, so nothing stored this session survives a reload.' })));
            if (mine && mine.version > 2) parts.push(h('div.dt-dim.dt-pad', { text: `The database is at version ${mine.version}; this list shows the stores db.js knew about at version 2.` }));
          }
          if (others.length) {
            parts.push(h('div.dt-subhead', { text: 'Other databases on this origin' }),
              h('table.dt-table.dt-table--flat', h('thead', h('tr', th('Name'), th('Version', 'num'))),
                h('tbody', others.map(d => h('tr', h('td.dt-mono', { text: d.name || '(unnamed)' }), h('td.num', { text: String(d.version ?? '—') }))))));
          }
          if (!dbs) parts.push(h('div.dt-dim.dt-pad', { text: 'This browser can’t list databases (indexedDB.databases), so only StaticOS’s own is shown.' }));
          content = h('div', parts);
        } catch (err) { content = h('div.dt-dim.dt-pad', { text: `Could not read IndexedDB: ${err.message}` }); }
        if (!sc.alive) return;
        idb.lastChild.replaceWith(content);
      })();

      /* Cache Storage */
      const cache = sec('Cache Storage', 'caches.keys()', reading());
      wrap.append(cache);
      (async () => {
        let content;
        try {
          if (typeof caches === 'undefined') throw new Error('Cache Storage is not available here (it needs a secure context).');
          const names = await caches.keys();
          if (!names.length) content = h('div.dt-dim.dt-pad', { text: 'No caches on this origin.' });
          else {
            const rows = [];
            for (const n of names) {
              try { rows.push([n, (await (await caches.open(n)).keys()).length]); } catch (e) { rows.push([n, null]); }
            }
            content = h('table.dt-table.dt-table--flat', h('thead', h('tr', th('Cache'), th('Entries', 'num'))),
              h('tbody', rows.map(([n, c]) => h('tr', h('td.dt-mono', { text: n }), h('td.num', { text: c === null ? '—' : num(c) })))));
          }
        } catch (err) { content = h('div.dt-dim.dt-pad', { text: err.message }); }
        if (!sc.alive) return;
        cache.lastChild.replaceWith(content);
      })();

      /* service workers */
      const sw = sec('Service workers', 'navigator.serviceWorker.getRegistrations()', reading());
      wrap.append(sw);
      (async () => {
        let content;
        try {
          if (!('serviceWorker' in navigator)) throw new Error('No service worker support here (it also needs a secure context).');
          const regs = await navigator.serviceWorker.getRegistrations();
          const ctl = navigator.serviceWorker.controller;
          if (!regs.length) content = h('div.dt-dim.dt-pad', { text: 'None registered. StaticOS registers /sw.js (its offline copy, and the proxy) once the desktop has started.' });
          else {
            content = h('table.dt-table.dt-table--flat', h('thead', h('tr', th('Scope'), th('State'), th('Script'), th('Controls this page'))),
              h('tbody', regs.map(r => {
                const w = r.active || r.waiting || r.installing;
                return h('tr', h('td.dt-mono', { text: DL.shortUrl(r.scope) }),
                  h('td', { text: r.active ? `active${r.waiting ? ', update waiting' : ''}` : r.waiting ? 'waiting' : r.installing ? 'installing' : '—' }),
                  h('td.dt-mono', { text: w ? DL.shortUrl(w.scriptURL) : '—' }),
                  h('td', { text: ctl && w && ctl.scriptURL === w.scriptURL ? 'yes' : 'no' }));
              })));
          }
        } catch (err) { content = h('div.dt-dim.dt-pad', { text: err.message }); }
        if (!sc.alive) return;
        sw.lastChild.replaceWith(content);
      })();
    };

    /* rough in-memory size of an IndexedDB value, bounded */
    function approxBytes(v) {
      let budget = 50000;
      const seen = new Set();
      const walk = x => {
        if (budget-- <= 0 || x === null || x === undefined) return 0;
        switch (typeof x) {
          case 'string': return x.length * 2;
          case 'number': return 8;
          case 'boolean': return 4;
          case 'bigint': return 8;
          case 'object': break;
          default: return 0;
        }
        if (typeof Blob !== 'undefined' && x instanceof Blob) return x.size;
        if (x instanceof ArrayBuffer) return x.byteLength;
        if (ArrayBuffer.isView(x)) return x.byteLength;
        if (seen.has(x)) return 0;
        seen.add(x);
        if (Array.isArray(x)) return x.reduce((a, y) => a + walk(y), 0);
        if (x instanceof Map) { let n = 0; for (const [a, b] of x) n += walk(a) + walk(b); return n; }
        if (x instanceof Date) return 8;
        let n = 0;
        for (const k of Object.keys(x)) n += k.length * 2 + walk(x[k]);
        return n;
      };
      return walk(v);
    }

    /* -------------------------------- Files -------------------------------- */
    PANES.files = P => {
      const { st, sc } = P;
      bar.append(filterField(P, 'Find files and folders by name', () => render()), grow(),
        tbtn('minimize-2', 'Collapse all', () => { st.open = new Set(['/']); render(); }),
        tbtn('refresh', 'Read the file system again', () => render()));
      const tbody = h('tbody');
      const table = h('table.dt-table.dt-table--tree.dt-table--files',
        h('thead', h('tr', th('Name', 'dt-c-name'), th('Kind', 'dt-c-type'), th('Size', 'num'), th('Modified', 'dt-c-mtime'), h('th.dt-c-act', { scope: 'col' }, h('span.sr', { text: 'Actions' })))),
        tbody);
      const scroller = h('div.dt-scroll', table);
      body.append(scroller);
      const footEl = h('span.dt-foot__t');
      foot.append(footEl);

      const join = (p, n) => (p === '/' ? `/${n}` : `${p}/${n}`);
      function open(path, n) {
        if (n.type === 'dir') { if (st.open.has(path)) st.open.delete(path); else st.open.add(path); render(); }
        else api.openFile(path);
      }
      function fileRow(n, path, depth, label) {
        const dir = n.type === 'dir';
        const isOpen = dir && st.open.has(path);
        const hidden = n.name.startsWith('.');
        const content = !dir ? String(n.content || '').length : 0;
        const tr = h('tr.dt-frow', { class: hidden ? 'is-hidden' : '', dataset: { key: path }, ondblclick: () => open(path, n) });
        tr.append(
          h('td.dt-c-name', { style: { '--d': String(depth) }, title: path },
            dir && n.children.length
              ? h('button.dt-tog.dt-tog--row', { type: 'button', 'aria-expanded': String(isOpen), dataset: { key: path }, 'aria-label': `${isOpen ? 'Collapse' : 'Expand'} ${path}`, onclick: () => open(path, n) })
              : h('span.dt-tog.dt-tog--leaf', { 'aria-hidden': 'true' }),
            h('span.dt-ficon', { dataset: { kind: dir ? 'dir' : n.kind || 'bin' } }, icon(vfs.iconFor(n))),
            h('span.dt-k', { text: label || n.name || '/' }),
            n.seed ? h('span.dt-tag', { text: 'seed', title: 'Shipped with StaticOS. Its size is what the file system records for it; a seeded placeholder may have no content.' }) : null),
          h('td.dt-c-type', { text: dir ? `folder · ${num(n.children.length)}` : n.kind || '—' }),
          h('td.num', { text: bytes(dir ? vfs.size(n) : Number(n.size) || 0), title: dir ? 'Total of the sizes recorded for everything inside' : `${num(content)} characters of content` }),
          h('td.dt-c-mtime', { text: n.mtime ? fmt.fmtAgo(n.mtime) : '—', title: n.mtime ? new Date(n.mtime).toLocaleString() : null }),
          h('td.dt-c-act', h('button.btn.btn--sm.btn--ghost.dt-open', {
            type: 'button', title: dir ? `Open ${path} in Files` : `Open ${n.name}`, 'aria-label': dir ? `Open ${path} in Files` : `Open ${n.name}`,
            onclick: () => api.openFile(path),
          }, h('span', { text: 'Open' }))));
        tbody.append(tr);
        if (isOpen) {
          const kids = vfs.ls(path, { hidden: true });
          const lim = st.limits.get(path) || 300;
          kids.slice(0, lim).forEach(c => fileRow(c, join(path, c.name), depth + 1));
          if (kids.length > lim) {
            tbody.append(h('tr.dt-morerow', h('td', { colspan: '5', style: { '--d': String(depth + 1) } },
              h('button.dt-more', { type: 'button', onclick: () => { st.limits.set(path, lim + 300); render(); } }, `Show ${num(Math.min(300, kids.length - lim))} more of ${num(kids.length - lim)}`))));
          }
        }
      }
      function render() {
        const keep = scroller.scrollTop;
        const focusKey = document.activeElement && tbody.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        clear(tbody);
        let files = 0;
        let dirs = 0;
        vfs.walk('/', n => { if (n.type === 'dir') dirs++; else files++; }, 64);
        let hits = null;
        if (st.q) {
          const q = st.q.toLowerCase();
          hits = [];
          vfs.walk('/', (n, path) => { if (hits.length < 300 && path !== '/' && n.name.toLowerCase().includes(q)) hits.push([n, path]); }, 64);
          hits.sort((a, b) => a[1].localeCompare(b[1]));
          for (const [n, path] of hits) fileRow(n, path, 0, path);
          if (!hits.length) tbody.append(h('tr', h('td', { colspan: '5' }, emptyState('search', 'Nothing matches', `No file or folder name contains “${st.q}”.`))));
        } else fileRow(vfs.node('/'), '/', 0, '/');
        let snap = 0;
        try {
          const raw = profiles.local.getItem(profiles.key('staticos.vfs.v1'));
          if (raw !== null) snap = lsBytes(profiles.key('staticos.vfs.v1'), raw);
        } catch (e) { /* blocked */ }
        footEl.textContent = [
          hits ? `${count(hits.length, 'match', 'matches')}${hits.length >= 300 ? ' (first 300)' : ''}` : '',
          `${count(files, 'file')} · ${count(dirs, 'folder')}`,
          `home holds ${bytes(vfs.size(vfs.node(vfs.HOME)))} (recorded sizes)`,
          snap ? `saved snapshot ${bytes(snap)} in localStorage` : 'no saved snapshot yet',
          'double-click opens',
        ].filter(Boolean).join('  ·  ');
        scroller.scrollTop = keep;
        if (focusKey) tbody.querySelector(`button[data-key="${CSS.escape(focusKey)}"]`)?.focus();
      }
      sc.on(bus.on('fs:change', () => P.frame('render', render)));
      render();
    };

    /* -------------------------------- Windows -------------------------------- */
    PANES.windows = P => {
      const { sc } = P;
      bar.append(h('span.dt-bar__title', { text: 'Window manager, top of the stack first' }), grow());
      const tbody = h('tbody');
      const table = h('table.dt-table.dt-table--flat.dt-table--wins',
        h('thead', h('tr', th('Z', 'num dt-c-z'), th('App'), th('Title'), th('Id', 'num dt-c-id'), th('Position', 'num dt-c-pos'), th('Size', 'num'), th('State'), h('th.dt-c-wact', { scope: 'col' }, h('span.sr', { text: 'Actions' })))),
        tbody);
      const scroller = h('div.dt-scroll', table);
      body.append(scroller);
      const footEl = h('span.dt-foot__t');
      foot.append(footEl);

      function render() {
        const keep = scroller.scrollTop;
        const list = typeof wm.stacked === 'function' ? wm.stacked() : [...wm.list()].sort((a, b) => b.z - a.z);
        const active = typeof wm.getActive === 'function' ? wm.getActive() : null;
        clear(tbody);
        list.forEach((w, i) => {
          const title = w.el?.getAttribute('aria-label') || w.app?.name || w.appId;
          const sub = w.el?.querySelector('.win__sub')?.textContent || '';
          const states = [w === active ? 'active' : null, w.min ? 'minimised' : null, w.max ? 'maximised' : null].filter(Boolean);
          const self = w === win;
          tbody.append(h('tr', { class: `${w === active ? 'is-active' : ''}${w.min ? ' is-min' : ''}` },
            h('td.num.dt-c-z', { text: String(i + 1), title: `z-index ${w.z}` }),
            h('td', h('span.dt-mono', { text: w.appId }), self ? h('span.dt-tag', { text: 'this window' }) : null),
            h('td', { title: sub ? `${title} — ${sub}` : title }, h('span', { text: title }), sub ? h('span.dt-dim', { text: ` — ${sub}` }) : null),
            h('td.num.dt-c-id', { text: String(w.id) }),
            h('td.num.dt-c-pos', { text: `${w.x}, ${w.y}` }),
            h('td.num', { text: `${w.w} × ${w.h}` }),
            h('td', states.length ? states.map(s => h(`span.dt-state.dt-state--${s}`, { text: s })) : h('span.dt-dim', { text: 'normal' })),
            h('td.dt-c-wact',
              h('button.btn.btn--sm.btn--ghost', { type: 'button', disabled: self && !w.min, onclick: () => { if (w.min) wm.restore(w); else wm.focus(w); } }, h('span', { text: w.min ? 'Restore' : 'Focus' })),
              h('button.btn.btn--sm.btn--ghost', { type: 'button', disabled: w.min, onclick: () => wm.minimize(w) }, h('span', { text: 'Minimise' })),
              h('button.btn.btn--sm.btn--ghost.dt-danger', { type: 'button', onclick: () => wm.close(w.id), 'aria-label': `Close ${title}` }, h('span', { text: 'Close' })))));
        });
        if (!list.length) tbody.append(h('tr', h('td', { colspan: '8' }, emptyState('window', 'No windows', 'Nothing is open.'))));
        const a = wm.workArea();
        footEl.textContent = [
          count(list.length, 'window'),
          `${num(list.filter(w => w.min).length)} minimised`,
          active ? `active: ${active.appId} #${active.id}` : 'no active window',
          `work area ${a.w} × ${a.h} at y ${a.y}`,
        ].join('  ·  ');
        scroller.scrollTop = keep;
      }
      for (const evt of ['win:list', 'win:max', 'win:move', 'win:resize', 'win:title']) sc.on(bus.on(evt, () => P.frame('render', render)));
      render();
    };

    /* -------------------------------- Performance -------------------------------- */
    PANES.performance = P => {
      const { st, sc } = P;
      const N = 60;
      const push = (arr, v) => { arr.push(v); while (arr.length > N) arr.shift(); };
      bar.append(h('span.dt-bar__title', { text: 'Measured in this tab, once a second, while this pane is showing' }), grow());

      const meter = (label) => {
        const v = h('b.dt-meter__v', { text: '—' });
        const s = h('small.dt-meter__s', { text: 'measuring…' });
        const c = h('canvas.dt-spark', { width: '120', height: '28', 'aria-hidden': 'true' });
        return { el: h('div.dt-meter', h('span.dt-meter__k', { text: label }), v, s, c), v, s, c };
      };
      const mFps = meter('Frame rate');
      const mFrame = meter('Worst frame');
      const mHeap = meter('JS heap');
      const mDom = meter('DOM nodes');
      const mWin = meter('Windows');
      const meters = h('div.dt-meters', mFps.el, mFrame.el, mHeap.el, mDom.el, mWin.el);

      const ltBody = h('tbody');
      const ltTable = h('table.dt-table.dt-table--flat', h('thead', h('tr', th('When'), th('Duration', 'num'), th('Blocking', 'num'), th('Source'))), ltBody);
      const types = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];
      const ltType = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
      const ltSec = sec('Long tasks', ltType === 'long-animation-frame' ? 'frames over 50 ms — PerformanceObserver(long-animation-frame)' : ltType ? 'tasks over 50 ms — PerformanceObserver(longtask)' : 'not reported by this browser',
        ltType ? h('div.dt-ltwrap', ltTable) : h('div.dt-dim.dt-pad', { text: 'This browser does not report long tasks to pages (Chromium does).' }));

      const nav = (() => { try { return performance.getEntriesByType('navigation')[0] || null; } catch (e) { return null; } })();
      const s0 = DL.stats();
      const facts = h('div.dt-facts',
        sec('Page load', 'navigation timing', nav ? kvTable([
          ['Navigation', nav.type],
          ['First byte', msf(nav.responseStart)],
          ['DOMContentLoaded', msf(nav.domContentLoadedEventEnd)],
          ['Load event', nav.loadEventEnd ? msf(nav.loadEventEnd) : 'not finished'],
          ['Document', nav.transferSize ? `${bytes(nav.transferSize)} over ${nav.nextHopProtocol || 'the network'}` : 'from cache or not reported'],
          ['Capture started', `${msf(s0.startedPerf)} after navigation`],
        ]) : h('div.dt-dim.dt-pad', { text: 'No navigation timing entry.' })),
        sec('This device', 'as the browser reports it', kvTable([
          ['Logical cores', navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'not reported'],
          ['Device memory', navigator.deviceMemory ? `≈ ${navigator.deviceMemory} GB (rounded by the browser on purpose)` : 'not reported by this browser'],
          ['Pixel ratio', String(window.devicePixelRatio || 1)],
          ['Viewport', `${innerWidth} × ${innerHeight}`],
          ['Screen', `${screen.width} × ${screen.height}`],
        ])),
        sec('Can’t be measured from a page', 'said plainly rather than guessed', kvTable([
          ['Event listeners', 'Browsers don’t let a page count its listeners; getEventListeners() exists only in the browser’s own devtools.'],
          ['Timers', 'Pending setTimeout / setInterval timers can’t be listed from a page.'],
          ['Bus subscribers', 'bus.js keeps its listener map private.'],
          ['CPU and GPU load', 'No browser exposes host CPU or GPU usage to pages.'],
          ['Memory per app', 'The JS heap is one pool for the whole page; it isn’t split by app.'],
        ])));
      const wrap = h('div.dt-scroll.dt-perf', meters, h('div.dt-perf__grid', ltSec, facts));
      body.append(wrap);
      const footEl = footText('Samples are kept while this pane shows; the sparklines hold the last minute of them', 'nothing is sampled while the window is minimised or hidden');
      foot.append(footEl);

      function spark(canvas, vals, lo, hiMin) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth || 120;
        const hh = canvas.clientHeight || 28;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
        const g = canvas.getContext('2d');
        if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, hh);
        const col = getComputedStyle(canvas).color || '#888';
        /* a faint baseline, so an empty or young graph still reads as one */
        g.globalAlpha = 0.22;
        g.fillStyle = col;
        g.fillRect(0, hh - 1, w, 1);
        g.globalAlpha = 1;
        const pts = vals.filter(v => Number.isFinite(v));
        if (pts.length < 2) return;
        const hi = Math.max(hiMin || 0, ...pts) * 1.08 || 1;
        const step = w / (N - 1);
        const x0 = w - (pts.length - 1) * step;
        const y = v => hh - 2 - ((v - lo) / ((hi - lo) || 1)) * (hh - 4);
        g.beginPath();
        pts.forEach((v, i) => { const x = x0 + i * step; if (i) g.lineTo(x, y(v)); else g.moveTo(x, y(v)); });
        g.lineWidth = 1.5;
        g.lineJoin = 'round';
        g.strokeStyle = col;
        g.stroke();
        g.lineTo(w, hh);
        g.lineTo(x0, hh);
        g.closePath();
        g.globalAlpha = 0.16;
        g.fillStyle = col;
        g.fill();
        g.globalAlpha = 1;
      }

      function paint() {
        const last = a => a[a.length - 1];
        const fps = last(st.fps);
        if (Number.isFinite(fps)) {
          mFps.v.textContent = `${Math.round(fps)} fps`;
          const tail = st.fps.slice(-30);
          mFps.s.textContent = `min ${Math.round(Math.min(...tail))} · avg ${Math.round(tail.reduce((a, b) => a + b, 0) / tail.length)} (last ${tail.length} s)`;
          mFps.el.dataset.band = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'low';
        }
        const fr = last(st.frame);
        if (Number.isFinite(fr)) { mFrame.v.textContent = msf(fr); mFrame.s.textContent = 'longest gap between frames in the last second'; }
        if (performance.memory && performance.memory.jsHeapSizeLimit) {
          const m = performance.memory;
          mHeap.v.textContent = bytes(m.usedJSHeapSize);
          mHeap.s.textContent = `${bytes(m.totalJSHeapSize)} allocated · limit ${bytes(m.jsHeapSizeLimit)} · Chromium rounds this`;
        } else {
          mHeap.v.textContent = 'n/a';
          mHeap.s.textContent = 'not exposed — only Chromium reports the JS heap';
          mHeap.c.hidden = true;
        }
        const d = last(st.dom);
        if (Number.isFinite(d)) { mDom.v.textContent = num(d); mDom.s.textContent = 'elements in the document'; }
        const ws = wm.list();
        mWin.v.textContent = num(ws.length);
        mWin.s.textContent = `${num(ws.filter(w => w.min).length)} minimised`;
        spark(mFps.c, st.fps, 0, 60);
        spark(mFrame.c, st.frame, 0, 34);
        if (!mHeap.c.hidden) spark(mHeap.c, st.heap, Math.min(...st.heap.filter(Number.isFinite)) * 0.96 || 0, 0);
        spark(mDom.c, st.dom, 0, 0);
        spark(mWin.c, st.wins || [], 0, 4);
      }

      function sample(fps, worst) {
        push(st.fps, fps);
        push(st.frame, worst);
        if (performance.memory && performance.memory.usedJSHeapSize) push(st.heap, performance.memory.usedJSHeapSize);
        push(st.dom, document.getElementsByTagName('*').length);
        st.wins = st.wins || [];
        push(st.wins, wm.list().length);
        paint();
      }

      /* the frame counter: real animation frames, counted per second */
      let raf = 0;
      let frames = 0;
      let t0 = 0;
      let prev = 0;
      let worst = 0;
      const loop = now => {
        frames++;
        if (prev) worst = Math.max(worst, now - prev);
        prev = now;
        if (!t0) t0 = now;
        else if (now - t0 >= 1000) {
          try { sample((frames - 1) * 1000 / (now - t0), worst); } catch (err) { crash(err); return; }
          frames = 1;
          t0 = now;
          worst = 0;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      sc.on(() => cancelAnimationFrame(raf));

      /* long tasks */
      function ltRow(x) {
        return h('tr', h('td.dt-mono', { text: clock(x.t) }), h('td.num', { text: msf(x.dur) }), h('td.num', { text: Number.isFinite(x.block) ? msf(x.block) : '—' }), h('td.dt-mono', { text: x.src || '—', title: x.src || null }));
      }
      function paintLT() {
        clear(ltBody);
        const rows = st.lt.slice(-50).reverse();
        if (!rows.length) ltBody.append(h('tr', h('td', { colspan: '4' }, h('span.dt-dim', { text: 'None seen yet — nothing has blocked the page for 50 ms or more.' }))));
        else for (const x of rows) ltBody.append(ltRow(x));
      }
      if (ltType) {
        const add = e => {
          const key = `${Math.round(e.startTime)}|${Math.round(e.duration)}`;
          if (st.ltKeys.has(key)) return;
          st.ltKeys.add(key);
          let src = '';
          if (e.entryType === 'long-animation-frame' && e.scripts && e.scripts.length) {
            const s = [...e.scripts].sort((a, b) => b.duration - a.duration)[0];
            src = `${s.sourceURL ? DL.shortUrl(s.sourceURL) : s.invoker || 'script'}${s.sourceFunctionName ? ` · ${s.sourceFunctionName}` : ''}${s.invokerType ? ` (${s.invokerType})` : ''}`;
          } else if (e.entryType === 'long-animation-frame') src = 'rendering / style / layout';
          else if (e.attribution && e.attribution[0]) {
            const a = e.attribution[0];
            src = a.containerType === 'window' && !a.containerSrc ? 'this page' : `${a.containerType || ''} ${a.containerSrc || a.containerName || ''}`.trim();
          }
          st.lt.push({ t: performance.timeOrigin + e.startTime, dur: e.duration, block: e.blockingDuration, src });
          while (st.lt.length > 100) { st.lt.shift(); }
          if (st.ltKeys.size > 400) st.ltKeys = new Set(st.lt.map(x => `${Math.round(x.t - performance.timeOrigin)}|${Math.round(x.dur)}`));
        };
        try {
          const po = new PerformanceObserver(list => { for (const e of list.getEntries()) add(e); P.frame('lt', paintLT); });
          po.observe({ type: ltType, buffered: true });
          sc.on(() => po.disconnect());
        } catch (err) { /* reported as unsupported below */ }
        paintLT();
      }
      paint();
    };

    /* -------------------------------- Status -------------------------------- */
    PANES.status = P => {
      const { st, sc } = P;
      const when = h('span.dt-dim.dt-when');
      const again = h('button.btn.btn--sm', { type: 'button', onclick: () => runAll() }, icon('refresh'), h('span', { text: 'Check again' }));
      bar.append(again, when, grow(), tbtn('copy', 'Copy the report', async () => {
        const text = CHECKS.map(c => { const r = st.results[c.id] || {}; return `${c.label}: ${r.value || '—'}${r.detail ? ` — ${r.detail}` : ''}`; }).join('\n');
        const ok = await copyText(`StaticOS status · ${new Date(st.ranAt || Date.now()).toLocaleString()}\n${text}`);
        note(ok ? 'Report copied' : 'Copy failed', ok ? 'The status report is on the clipboard.' : 'The browser refused clipboard access.');
      }));
      const list = h('div.dt-checks', { role: 'list' });
      body.append(h('div.dt-scroll', list));
      /* the footer describes the checks; "Checked at …" next to the button
         carries when they last ran, because this pane also repaints rows it
         already has (after a resume) rather than re-running them */
      foot.append(footText('Every row is a real check, run when this pane opens and on Check again', 'the only requests are build.json and one HEAD to the AI host', 'nothing is published or sent anywhere'));

      const timeout = (ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };
      const liveResult = s => ({
        idle: { tone: 'info', value: 'Idle', detail: 'Nothing has opened the live channel this session — it connects when chat or broadcasts need it.' },
        connecting: { tone: 'run', value: 'Connecting…', detail: 'Trying a public MQTT broker.' },
        live: { tone: 'ok', value: 'Connected', detail: 'Linked to a public MQTT broker over a WebSocket.' },
        offline: { tone: 'warn', value: 'Offline', detail: 'No broker answered; it retries every few seconds.' },
      }[s] || { tone: 'info', value: String(s), detail: '' });

      const CHECKS = [
        {
          id: 'boot', label: 'Boot', icon: 'power',
          run: () => {
            const B = window.__staticBoot;
            if (!B) return { tone: 'warn', value: 'No boot record', detail: 'window.__staticBoot is missing — index.html’s watchdog did not run.' };
            const fails = Array.isArray(B.failures) ? B.failures : [];
            const errs = Array.isArray(B.errors) ? B.errors : [];
            const value = B.ok ? 'Finished' : B.alive ? 'Shell up, still finishing' : 'Not up';
            const tone = !B.ok && !B.alive ? 'bad' : fails.length || errs.length ? 'warn' : 'ok';
            return { tone, value: fails.length ? `${value} · ${count(fails.length, 'module')} failed` : value, detail: fails.length ? 'These failed to load:' : errs.length ? 'The watchdog saw errors while starting:' : 'Every module loaded.', lines: [...fails, ...errs] };
          },
        },
        {
          id: 'apps', label: 'Apps registered', icon: 'grid-9',
          run: () => {
            const all = api.listApps({ includeHidden: true });
            const hidden = all.filter(a => a.hidden);
            return { tone: all.length ? 'ok' : 'bad', value: count(all.length, 'app'), detail: `${num(all.length - hidden.length)} in the launcher · ${num(hidden.length)} hidden${hidden.length ? ` (${hidden.map(a => a.id).join(', ')})` : ''}` };
          },
        },
        {
          id: 'build', label: 'Build', icon: 'package',
          run: async () => {
            const T = timeout(8000);
            try {
              const t0 = performance.now();
              const r = await fetch('build.json', { cache: 'no-store', signal: T.signal });
              if (!r.ok) return { tone: 'warn', value: `HTTP ${r.status}`, detail: 'build.json is not served here, so the updater falls back to index.html headers.' };
              const b = await r.json();
              const running = window.Static?.updater?.current || null;
              const newer = running && running.build && b.build && running.build !== b.build;
              return {
                tone: newer ? 'warn' : 'ok',
                value: `${b.version || '?'} · ${b.build || 'no id'}`,
                detail: [newer ? `This tab runs ${running.build}; the server now has ${b.build} — reload to update` : running ? 'This tab runs that build' : '',
                  b.stamped ? `stamped ${new Date(b.stamped).toLocaleString()}` : '', b.files ? `${num(b.files)} files` : '', b.bytes ? bytes(b.bytes) : '',
                  `fetched in ${msf(performance.now() - t0)}`].filter(Boolean).join(' · '),
              };
            } catch (err) {
              return { tone: 'bad', value: err.name === 'AbortError' ? 'Timed out' : 'Unreadable', detail: String(err.message || err) };
            } finally { T.done(); }
          },
        },
        {
          id: 'online', label: 'Network', icon: 'wifi',
          run: () => {
            const on = navigator.onLine;
            const c = navigator.connection;
            const parts = [];
            if (c) {
              if (c.effectiveType) parts.push(`${c.effectiveType} class`);
              if (c.rtt) parts.push(`~${c.rtt} ms round trip`);
              if (c.downlink) parts.push(`~${c.downlink} Mb/s down`);
              if (c.saveData) parts.push('Data Saver on');
            }
            return { tone: on ? 'ok' : 'bad', value: on ? 'Online' : 'Offline', detail: `${parts.length ? `${parts.join(' · ')} (the browser’s estimate) · ` : ''}navigator.onLine only means a network is connected, not that the internet answers.` };
          },
        },
        {
          id: 'sw', label: 'Service worker', icon: 'shield',
          run: async () => {
            if (!('serviceWorker' in navigator)) return { tone: 'info', value: 'Not available', detail: 'No service workers here (they need a secure context), so the proxy can’t run.' };
            const regs = await navigator.serviceWorker.getRegistrations();
            const ctl = navigator.serviceWorker.controller;
            if (!regs.length) return { tone: 'info', value: 'None registered', detail: 'StaticOS registers /sw.js (its offline copy, and the proxy) once the desktop has started.' };
            return { tone: 'ok', value: count(regs.length, 'registration'), detail: `${regs.map(r => `${DL.shortUrl(r.scope)} ${(r.active || r.waiting || r.installing)?.state || 'no worker'}`).join(' · ')} · ${ctl ? 'controls this page' : 'not controlling this page'}` };
          },
        },
        {
          id: 'proxy', label: 'Proxy engine', icon: 'globe',
          run: async () => {
            const UV = await import('../portal/uv.js');
            const s = UV.status();
            const sup = UV.isSupported();
            switch (s.phase) {
              case 'ready': return { tone: 'ok', value: `Ready via ${s.wisp?.name || 'a tunnel'}`, detail: `Up since ${s.bootedAt ? clock(s.bootedAt, false) : '—'} · ${s.wisp?.url || ''}` };
              case 'booting': return { tone: 'run', value: 'Starting…', detail: `Tunnel: ${s.wisp?.name || '—'}` };
              case 'failed': return { tone: 'bad', value: 'Failed', detail: String(s.error?.message || s.error || 'unknown error') };
              case 'unsupported': return { tone: 'warn', value: 'Unsupported', detail: sup.why || String(s.error?.message || '') };
              default: return { tone: sup.ok ? 'info' : 'warn', value: 'Idle', detail: sup.ok ? 'Not started this session — it boots the first time a proxied page opens.' : sup.why };
            }
          },
        },
        {
          id: 'live', label: 'Live channel', icon: 'cast',
          run: async () => {
            const L = await import('../portal/live.js');
            return liveResult(L.status());
          },
        },
        {
          id: 'ai', label: 'Free AI endpoint', icon: 'sparkles',
          run: async () => {
            const T = timeout(7000);
            const t0 = performance.now();
            try {
              const r = await fetch(AI_URL, { method: 'HEAD', mode: 'cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: T.signal });
              const took = msf(performance.now() - t0);
              const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
              const tone = r.ok ? 'ok' : r.status >= 500 ? 'bad' : 'warn';
              return {
                tone,
                value: `HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ''}`,
                detail: `${took} · text.pollinations.ai answered${r.ok ? '' : ', but refused this request'}.${!r.ok && local ? ' From localhost that can be the host turning local origins away; check again from the published site.' : ''} Only the host is checked; no prompt is sent.`,
              };
            } catch (err) {
              if (err.name === 'AbortError') return { tone: 'bad', value: 'Timed out', detail: 'No answer from text.pollinations.ai within 7 s.' };
              const T2 = timeout(7000);
              try {
                await fetch(AI_URL, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: T2.signal });
                return { tone: 'warn', value: 'Reachable, status hidden', detail: `The host answered in ${msf(performance.now() - t0)}, but without CORS headers for this page, so the status can’t be read.` };
              } catch (err2) {
                return { tone: 'bad', value: 'Unreachable', detail: `${err.message} — offline, blocked by this network, or the host is down.` };
              } finally { T2.done(); }
            } finally { T.done(); }
          },
        },
        {
          id: 'secure', label: 'Secure context', icon: 'lock',
          run: () => {
            const sec2 = !!window.isSecureContext;
            const subtle = !!(window.crypto && crypto.subtle);
            return { tone: sec2 && subtle ? 'ok' : 'warn', value: sec2 ? 'Yes' : 'No', detail: `crypto.subtle ${subtle ? 'available' : 'missing'} — accounts hash passwords with it, and the proxy’s service worker also needs a secure context.` };
          },
        },
        {
          id: 'idb', label: 'IndexedDB', icon: 'database',
          run: async () => {
            if (typeof indexedDB === 'undefined') return { tone: 'bad', value: 'Unavailable', detail: 'Projects, clips and imported media fall back to memory and are lost on reload.' };
            let dbs = null;
            try { if (indexedDB.databases) dbs = await indexedDB.databases(); } catch (e) { dbs = null; }
            const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
            const mine = dbs ? dbs.find(d => d.name === 'staticos') : null;
            return {
              tone: 'ok',
              value: dbs ? (mine ? `staticos v${mine.version}` : 'Available, not created yet') : 'Available',
              detail: `${dbs ? `${count(dbs.length, 'database')} on this origin` : 'this browser can’t list databases'} · persistent storage ${persisted === null ? 'not reported' : persisted ? 'granted' : 'not granted (the browser may evict under pressure)'}`,
            };
          },
        },
        {
          id: 'capture', label: 'Capture', icon: 'bug',
          run: () => {
            const s = DL.stats();
            const wrapped = !!(console.log && console.log.__devlog);
            return {
              tone: wrapped ? 'ok' : 'warn',
              value: wrapped ? `Since ${clock(s.startedAt, false)}` : 'Console not wrapped',
              detail: `${msf(s.startedPerf)} after navigation · ${num(s.console.seen)} console messages seen · bus tap ${s.bus.tap ? 'on' : 'off'} · ${s.net.observing ? 'network observer on' : 'no network observer'}${s.startedPerf > 15000 ? ' · started late: devlog.init() is meant to run at the top of boot' : ''}`,
            };
          },
        },
      ];

      const rowEls = new Map();
      function checkRow(c) {
        const r = st.results[c.id] || { tone: 'idle' };
        const detail = h('div.dt-check__d', { text: r.detail || '' });
        const el = h('div.dt-check', { role: 'listitem', dataset: { tone: r.tone || 'idle', id: c.id } },
          h('span.dt-dot', { 'aria-hidden': 'true' }),
          h('span.dt-check__ico', icon(c.icon)),
          h('div.dt-check__main',
            h('div.dt-check__top', h('b', { text: c.label }), h('span.dt-check__v', { text: r.tone === 'run' && !r.value ? 'Checking…' : r.value || '—' }), r.tone === 'run' ? h('span.spinner.dt-spin', { 'aria-hidden': 'true' }) : null),
            r.detail ? detail : null,
            r.lines && r.lines.length ? h('ul.dt-check__lines', r.lines.map(l => h('li.dt-mono', { text: l }))) : null),
          h('span.dt-check__ms', { text: Number.isFinite(r.ms) ? msf(r.ms) : '' }));
        el.setAttribute('aria-label', `${c.label}: ${r.value || (r.tone === 'run' ? 'checking' : 'not run')}`);
        return el;
      }
      function paintRow(c) {
        if (!sc.alive) return;
        const next = checkRow(c);
        const old = rowEls.get(c.id);
        if (old && old.parentNode) old.replaceWith(next); else list.append(next);
        rowEls.set(c.id, next);
      }
      function paintAll() {
        clear(list);
        rowEls.clear();
        for (const c of CHECKS) paintRow(c);
        when.textContent = st.ranAt ? `Checked at ${clock(st.ranAt, false)}` : 'Not run yet';
      }
      async function run(c) {
        const t0 = performance.now();
        st.results[c.id] = { tone: 'run' };
        paintRow(c);
        let r;
        try { r = await c.run(); } catch (err) { r = { tone: 'bad', value: 'The check failed', detail: String(err && err.message || err) }; }
        r.ms = performance.now() - t0;
        st.results[c.id] = r;
        paintRow(c);
      }
      async function runAll() {
        st.ranAt = Date.now();
        again.disabled = true;
        paintAll();
        await Promise.all(CHECKS.map(run));
        if (sc.alive) again.disabled = false;
      }

      /* live updates while the pane shows: the channel and online state */
      import('../portal/live.js').then(L => {
        if (!sc.alive) return;
        sc.on(L.onStatus(s => {
          const c = CHECKS.find(x => x.id === 'live');
          const prev = st.results.live;
          st.results.live = { ...liveResult(s), ms: prev && prev.ms };
          paintRow(c);
        }));
      }).catch(() => { /* reported by the check itself */ });
      const onNet = () => run(CHECKS.find(x => x.id === 'online'));
      sc.listen(window, 'online', onNet);
      sc.listen(window, 'offline', onNet);

      if (P.reason === 'switch' || !st.ranAt) runAll();
      else paintAll();
    };

    /* -------------------------------- Labs -------------------------------- */
    PANES.labs = P => {
      const { sc } = P;
      bar.append(h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('settings', { section: 'labs' }) }, icon('settings'), h('span', { text: 'Open Settings › Labs' })), grow());
      const tbody = h('tbody');
      body.append(h('div.dt-scroll', h('table.dt-table.dt-table--flat.dt-table--labs',
        h('thead', h('tr', th('Experiment'), th('Pref', 'dt-c-key'), th('Value'), th('Applied'))), tbody)));
      foot.append(footText('Read-only — Labs are switched in Settings › Labs, and js/core/labs.js applies them', 'a pref nobody has set reads as off'));
      function render() {
        const prefs = store.get('prefs') || {};
        const extra = Object.keys(prefs).filter(k => /^lab[A-Z]/.test(k) && !LABS.some(l => l.key === k))
          .map(k => ({ key: k, label: k, desc: 'Found in prefs, but Settings › Labs doesn’t list it.', applied: () => null, appliedNote: 'Unknown experiment.' }));
        clear(tbody);
        for (const l of [...LABS, ...extra]) {
          const v = prefs[l.key];
          const on = v === true;
          let applied = null;
          try { applied = l.applied(); } catch (e) { applied = null; }
          const mismatch = applied !== null && applied !== on;
          tbody.append(h('tr', { class: mismatch ? 'is-bad' : '' },
            h('td', h('b.dt-lab__t', { text: l.label }), h('div.dt-lab__d', { text: l.desc })),
            h('td.dt-c-key', h('span.dt-mono', { text: `prefs.${l.key}` })),
            /* a lab is meant to be a boolean; anything else is printed through
               the masking stringifier, so an odd value can't leak a secret */
            h('td', h(`span.dt-state.dt-state--${on ? 'on' : 'off'}`, { text: v === undefined ? 'off (unset)' : on ? 'on' : typeof v === 'boolean' ? 'off' : DL.jsonMasked(v, 0) })),
            h('td', { title: l.appliedNote }, applied === null ? h('span.dt-dim', { text: '—' }) : h('span', { text: applied ? 'yes' : 'no' }), mismatch ? h('span.dt-warnword', { text: ' mismatch' }) : null)));
        }
      }
      sc.on(store.sub('prefs', () => P.frame('render', render)));
      render();
    };

    /* =============================== wiring =============================== */
    app.listen(document, 'visibilitychange', syncPause);
    app.on(bus.on('win:minimize', w => { if (w === win) syncPause(); }));
    app.on(bus.on('win:restore', w => { if (w === win) syncPause(); }));
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(es => {
        const e = es[es.length - 1];
        if (!e) return;
        S.inView = e.isIntersecting;
        syncPause();
      });
      io.observe(appEl);
      app.on(() => io.disconnect());
    }
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(es => {
        const w = es[0]?.contentRect?.width || appEl.clientWidth;
        if (!w) return;
        const narrow = w < 600;
        appEl.classList.toggle('is-narrow', narrow);
        appEl.classList.toggle('is-compact', w < 860);
        side.setAttribute('aria-orientation', narrow ? 'horizontal' : 'vertical');
      });
      ro.observe(appEl);
      app.on(() => ro.disconnect());
    }
    app.on(DL.onEntry(badgeSoon));
    app.on(DL.onBus((e, kind) => { if (kind === 'tap') badgeSoon(); }));
    app.on(DL.onNetwork(() => { S.netDirty = true; badgeSoon(); }));
    app.on(bus.on('win:list', badgeSoon));

    win.onReopen(o => {
      const t = canonTab(o?.tab);
      if (t && t !== S.tab) show(t, 'switch');
    });

    S.paused = isPaused();
    show(S.tab, 'switch');
    /* opened straight into a hidden tab or a minimised window: the pane's
       DOM is built so it is there when it shows, but nothing of it runs */
    if (S.paused) { pane.dispose(); pane = scope(); }

    return () => {
      S.dead = true;
      pane.dispose();
      app.dispose();
      DL.setBusTap(MEM.pinned);
    };
  },
});
