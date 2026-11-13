/* ============================================================
   creator.js — Static Creator: the control center for people who
   make things on StaticOS (brief: "STATIC CREATOR").

   One window. The sidebar holds the sections, and every one is
   built only from what this device really has:

     Overview         real counts — projects, published, drafts,
                      versions kept, versions the AI wrote, and how
                      many of your games are in this device's play
                      history — plus quick actions, the games you
                      touched last and this week's jam.
     My games         every project (projects.js), newest first, with
                      Forge's thumbnail when Forge took one.
     Drafts           the projects that are not published.
     Published        what is in your Workshop: the published version,
                      its category and the update history that
                      projects.publish() keeps.
     Updates          every published.updates entry, as one timeline.
     Assets           every image and sound saved inside a project,
                      with previews; each opens in Asset Lab.
     Game jams        this week's theme (events.js — the same week
                      maths as the jam notification and Forge's jam
                      card), the real time left until Monday 00:00 on
                      this device's clock, and your entries: the
                      projects Static Jam filed under this week in
                      store 'portal.jam' ({ '<year>-W<week>': [id] }).
     Creator profile  a summary, and the way into the Profile app.

   Nothing is invented. There are no follower counts, views,
   ratings or trends, because StaticOS has no server to count them;
   the Overview says its numbers are this device's only, and an
   empty section says so and offers the first step instead.

   Publishing from here makes the same write as Forge's sheet:
   projects.publish() with title, description, controls, category
   and update note, then the published version's id goes into
   'portal.forge.pub' (unpublishing removes it) so Forge's game page
   shows exactly that version. A new thumbnail needs a running
   preview, so taking one stays in Forge; this sheet uses the
   thumbnail that already exists.

   Nothing here touches the network. Project text (names, notes,
   descriptions) is rendered as text only, and an image is only
   ever shown from a data:image URL a project holds.

   Store: 'portal.creator' { sec, sort, kind } — the section, list
   order and asset filter that were open last, on this device.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as P from '../core/projects.js';
import * as Plays from '../core/plays.js';
import { jamTheme, isoWeek } from '../core/events.js';
import { appTile } from '../core/appart.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-creator-css')) {
  const l = document.createElement('link');
  l.id = 'feat-creator-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-creator.css';
  document.head.appendChild(l);
}

const KEY = 'portal.creator';

/* the same list as Forge's publish sheet, so a game published here
   files under a category Forge's Workshop knows */
const CATEGORIES = ['action', 'arcade', 'shooter', 'platformer', 'puzzle', 'racing', 'horror', 'sports', 'strategy', 'casual', 'other'];

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'grid', group: 'Creator' },
  { id: 'games', label: 'My games', icon: 'gamepad', group: 'Games' },
  { id: 'drafts', label: 'Drafts', icon: 'edit-3', group: 'Games' },
  { id: 'published', label: 'Published', icon: 'upload', group: 'Games' },
  { id: 'updates', label: 'Updates', icon: 'tag', group: 'Games' },
  { id: 'assets', label: 'Assets', icon: 'image', group: 'Make' },
  { id: 'jams', label: 'Game jams', icon: 'flame', group: 'Make' },
  { id: 'profile', label: 'Creator profile', icon: 'user', group: 'You' },
];
const ALIAS = { mygames: 'games', 'my-games': 'games', jam: 'jams', 'game-jams': 'jams', stats: 'overview', home: 'overview' };
const canon = s => {
  if (typeof s !== 'string') return null;
  if (SECTIONS.some(x => x.id === s)) return s;
  const k = s.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIAS, k) ? ALIAS[k] : null;
};
const LISTS = ['games', 'drafts', 'published'];

const SORTS = [
  { id: 'new', label: 'Newest first' },
  { id: 'edited', label: 'Last edited' },
  { id: 'name', label: 'Name (A–Z)' },
];
const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Sounds' },
];

/* the apps the quick actions and buttons hand off to */
const APP_NAMES = { forge: 'Static Forge', studio: 'Studio', assetlab: 'Asset Lab', profile: 'Profile', jam: 'Static Jam' };

/* ------------------------------------------------------------------
   Pure helpers (exported so they can be checked on their own)
   ------------------------------------------------------------------ */
const IMG_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml)[;,]/i;
const AUD_RE = /^data:audio\/[\w.+-]+[;,]/i;
/** Only a data: image a project holds is ever shown — never a link. */
export const safeImg = v => (typeof v === 'string' && v.length < 8e6 && IMG_RE.test(v) ? v : '');
export const safeAudio = v => (typeof v === 'string' && v.length < 16e6 && AUD_RE.test(v) ? v : '');

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Local midnight at the start of this ISO week (Monday 00:00). */
export function thisMonday(d = new Date()) {
  const dow = d.getDay() || 7;                                  /* Mon 1 … Sun 7 */
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow - 1), 0, 0, 0, 0);
}
/** Local midnight at the start of next Monday — when the jam week ends. */
export function nextMonday(d = new Date()) {
  const dow = d.getDay() || 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (8 - dow), 0, 0, 0, 0);
}

/** "3 days 4 hours" · "5 hours 12 minutes" · "12 minutes" */
export function fmtLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mi = m % 60;
  if (d > 0) return hr ? `${plural(d, 'day')} ${plural(hr, 'hour')}` : plural(d, 'day');
  if (hr > 0) return mi ? `${plural(hr, 'hour')} ${plural(mi, 'minute')}` : plural(hr, 'hour');
  return mi > 0 ? plural(mi, 'minute') : 'less than a minute';
}

export const weekKey = (d = new Date()) => { const { year, week } = isoWeek(d); return `${year}-W${week}`; };

/** This week's entries in Static Jam's store: 'portal.jam' is
    { '<year>-W<week>': [projectId] } (jam.js). Read defensively (it is
    another app's data) and only as CANDIDATES: the caller keeps the
    ids that are real projects on this device, so nothing can appear
    that isn't your game. */
export function jamEntryIds(raw, d = new Date()) {
  const out = new Set();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const { year, week } = isoWeek(d);
  for (const k of new Set([`${year}-W${week}`, `${year}-W${String(week).padStart(2, '0')}`])) {
    const ids = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : null;
    if (!Array.isArray(ids)) continue;
    for (const id of ids.slice(0, 500)) if (typeof id === 'string' && id && id.length <= 200) out.add(id);
  }
  return out;
}

/** Bytes a data: URL holds (base64 decoded), without decoding it. */
export function approxBytes(url) {
  const s = typeof url === 'string' ? url : '';
  const i = s.indexOf(',');
  if (i < 0) return 0;
  const body = s.length - i - 1;
  if (!/;base64$/i.test(s.slice(0, i))) return body;
  return Math.max(0, Math.floor(body * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0));
}

const hueOf = id => { let x = 7; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };

defineApp({
  id: 'creator',
  name: 'Static Creator',
  icon: 'layers',
  g1: '#4a7eec', g2: '#0d2775',
  category: 'Create',
  keywords: ['creator', 'dashboard', 'my games', 'projects', 'drafts', 'published', 'publish', 'release', 'updates',
    'assets', 'sprites', 'sounds', 'jam', 'game jam', 'stats', 'make', 'export'],
  desc: 'Your games, drafts, releases, assets and this week’s jam in one place',
  singleton: true,
  win: { w: 980, h: 650, minW: 460, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, fmt } = api;
    const U = `cr${Math.random().toString(36).slice(2, 7)}`;   /* unique ids for aria wiring */

    let dead = false;
    let list = null;            /* projects (projects.list()), or null while the first read runs */
    let loadErr = '';
    let loadSeq = 0;
    let reloadT = 0;
    let tickT = 0;
    let raf = 0;
    let sheet = null;           /* the open publish sheet: { close } */
    let audio = null;           /* the sound being previewed: { key, el } */
    const timers = new Set();
    const offs = [];

    const saved = store.get(KEY, null) || {};
    const S = {
      sec: canon(opts?.section) || canon(saved.sec) || 'overview',
      sort: SORTS.some(s => s.id === saved.sort) ? saved.sort : 'new',
      kind: KINDS.some(k => k.id === saved.kind) ? saved.kind : 'all',
      q: '',
      history: new Set(),       /* published rows showing their whole update history */
    };
    const remember = () => store.set(KEY, { sec: S.sec, sort: S.sort, kind: S.kind });

    /* ---------------- small helpers ---------------- */
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); return t; };
    const has = id => !!api.getApp(id);
    const note = n => api.notify({ app: 'Static Creator', icon: 'layers', timeout: 5000, ...n });
    function openIn(id, o) {
      if (dead) return null;
      if (!has(id)) { note({ icon: 'info', title: `${APP_NAMES[id] || id} isn’t in this build` }); return null; }
      return api.openApp(id, o);
    }
    const title = p => String(p.published?.title || p.name || 'Untitled game');
    /* headings and toasts get a short form: a project name has no length limit */
    const short = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
    const verN = p => (Number.isInteger(p.head) ? p.head + 1 : p.versions.length);
    const sourceLabel = p => (p.remixCredit || p.source === 'remix' ? 'Remix' : p.source === 'studio' ? 'Studio'
      : /^Imported/.test(p.versions?.[0]?.note || '') ? 'Imported' : 'Forge');
    const getMap = k => { const v = store.get(k, null); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    /* lists show Forge's list thumbnail first (the brief); publishing keeps
       the published one first, as Forge's own sheet does */
    const thumbOf = p => safeImg(getMap('portal.forge.thumbs')[p.id]) || safeImg(p.published?.thumbnail);
    const pubThumbOf = p => safeImg(p.published?.thumbnail) || safeImg(getMap('portal.forge.thumbs')[p.id]);
    const validTime = t => { const n = Number(t); return Number.isFinite(n) && n > 0 && Number.isFinite(new Date(n).getTime()); };
    const ago = t => (validTime(t) ? fmt.fmtAgo(new Date(Number(t)).toISOString()) : '');
    const iso = t => (validTime(t) ? new Date(Number(t)).toISOString() : null);
    const h24 = () => !!store.get('prefs.h24');
    const timeOf = t => new Date(Number(t)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24() });
    const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    function dayLabel(t) {
      const d = new Date(Number(t));
      const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 864e5);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Yesterday';
      return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
    }
    const whenFull = t => `${new Date(Number(t)).toLocaleDateString([], { month: 'short', day: 'numeric', ...(new Date(Number(t)).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })}, ${timeOf(t)}`;
    const num = n => Number(n || 0).toLocaleString();

    /* an announcement for screen readers (what a toast says visually) */
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const announce = t => { live.textContent = ''; later(() => { live.textContent = t; }, 40); };

    const btn = (ic, label, onclick, cls = '', extra = {}) =>
      h(`button.btn.btn--sm${cls}`, { type: 'button', onclick, ...extra }, ic ? icon(ic) : null, label ? h('span', { text: label }) : null);
    const empty = (ic, head, text, ...acts) => h('div.empty.cr-empty', icon(ic), h('b', { text: head }), h('small', { text }),
      acts.filter(Boolean).length ? h('div.cr-empty__acts', acts.filter(Boolean)) : null);

    /* ---------------- chrome ---------------- */
    const side = h('nav.app__side.cr-side', { 'aria-label': 'Static Creator sections' });
    const titleEl = h('h2.app__title.cr-title');
    const countEl = h('span.dim.cr-count');
    const tools = h('div.cr-tools');
    const newBtn = btn('plus', 'New game', () => openIn('forge'), '.btn--primary.cr-new', { title: 'Describe a new game in Static Forge', dataset: { fk: 'bar:new' } });
    const bar = h('div.app__bar.cr-bar', titleEl, countEl, h('div.grow'), tools, newBtn);
    const content = h('div.app__content.cr-content', { tabindex: '-1' });
    const app = h('div.app.cr', side, h('div.app__main.cr-main', bar, content), live);
    root.appendChild(h('div.cr-wrap', app));
    win.setSubtitle?.('On this device');

    /* the sidebar is built once and updated in place, so a background
       refresh never takes keyboard focus off it */
    const sideRefs = new Map();
    {
      let group = '', groupEl = null;
      for (const s of SECTIONS) {
        if (s.group !== group) {
          group = s.group;
          groupEl = h('div.side__group', h('div.side__label', { text: s.group }));
          side.appendChild(groupEl);
        }
        const count = h('small.cr-sidecount');
        const b = h('button.side__item', { type: 'button', title: s.label, dataset: { sec: s.id }, onclick: () => go(s.id) },
          icon(s.icon), h('span', { text: s.label }), count);
        sideRefs.set(s.id, { b, count });
        groupEl.appendChild(b);
      }
      side.appendChild(h('div.side__meter.cr-sidenote',
        h('b', { text: 'This device only' }),
        h('small', { text: 'Everything here is read from this browser. StaticOS has no server, so nothing is uploaded.' })));
    }

    /* search + sort live in the bar and are made once: rebuilding them on
       every refresh would drop the caret out of the search box */
    const search = h('input', {
      type: 'search', spellcheck: 'false', autocomplete: 'off', maxlength: '80',
      oninput: e => { S.q = e.target.value.trim().toLowerCase().slice(0, 80); paintContent(true); },
      onkeydown: e => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; S.q = ''; paintContent(true); } },
    });
    const searchField = h('label.field.cr-search', icon('search'), search);
    const sortLabel = h('span');
    const sortBtn = h('button.btn.btn--sm.btn--ghost.cr-sort', {
      type: 'button', 'aria-haspopup': 'menu', title: 'Change the order',
      onclick: e => { const r = e.currentTarget.getBoundingClientRect(); sortMenu(r.left, r.bottom + 4); },
    }, icon('filter'), sortLabel);

    function sortMenu(x, y) {
      api.menu([{ header: true, label: 'Sort games by' },
        ...SORTS.map(s => ({ label: s.label, checked: S.sort === s.id, onClick: () => { if (dead) return; S.sort = s.id; remember(); paintBar(); paintContent(true); } }))], x, y);
    }

    function paintBar() {
      const s = SECTIONS.find(x => x.id === S.sec);
      titleEl.textContent = s.label;
      clear(tools);
      if (LISTS.includes(S.sec) || S.sec === 'assets') {
        search.placeholder = S.sec === 'assets' ? 'Search assets' : 'Search games';
        search.setAttribute('aria-label', search.placeholder);
        tools.appendChild(searchField);
      }
      if (LISTS.includes(S.sec)) {
        sortLabel.textContent = SORTS.find(x => x.id === S.sort).label;
        sortBtn.setAttribute('aria-label', `Sort: ${sortLabel.textContent}`);
        tools.appendChild(sortBtn);
      }
      newBtn.hidden = S.sec === 'overview';
    }

    function paintSide(st) {
      for (const [id, { b, count }] of sideRefs) {
        const on = id === S.sec;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        const n = st ? { games: st.projects, drafts: st.drafts, published: st.published, updates: st.updates, assets: st.assets }[id] : 0;
        count.textContent = n ? String(n) : '';
      }
    }

    function go(sec) {
      const c = canon(sec);
      if (!c || dead) return;
      if (c !== S.sec) { S.q = ''; search.value = ''; }
      S.sec = c;
      remember();
      paintBar();
      paint(true);
      revealSide(c);
    }

    /* On a phone the sections are a sideways strip: when the section
       changes from elsewhere (a number tile, a reopen) bring its chip into
       view. Only the strip scrolls — scrollIntoView() would also scroll
       every ancestor, the desktop itself included, for a window that
       hangs off the screen. Only on a change, so a refresh never moves it. */
    function revealSide(id) {
      const b = sideRefs.get(id)?.b;
      if (!b || !b.isConnected) return;
      const sr = side.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (br.left < sr.left) side.scrollLeft -= sr.left - br.left + 12;
      else if (br.right > sr.right) side.scrollLeft += br.right - sr.right + 12;
      if (br.top < sr.top) side.scrollTop -= sr.top - br.top + 8;
      else if (br.bottom > sr.bottom) side.scrollTop += br.bottom - sr.bottom + 8;
    }

    /* ---------------- data ---------------- */
    async function load() {
      const seq = ++loadSeq;
      try {
        const ps = await P.list();
        if (dead || seq !== loadSeq) return;
        list = ps.filter(p => p && typeof p.id === 'string' && Array.isArray(p.versions) && p.versions.length);
        loadErr = '';
      } catch (err) {
        if (dead || seq !== loadSeq) return;
        list = list || [];
        loadErr = String(err?.message || err || 'unknown error');
      }
      paint();
    }
    const reload = () => { clearTimeout(reloadT); reloadT = setTimeout(() => { reloadT = 0; if (!dead) load(); }, 160); };
    const soon = () => { if (!raf && !dead) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

    function playedRows() {
      try { return Plays.recent(200, 'creation'); } catch (e) { return []; }
    }

    function stats(ps) {
      const ids = new Set(ps.map(p => p.id));
      const played = playedRows().filter(r => ids.has(r.id));
      let versions = 0, ai = 0, updates = 0, assets = 0, pub = 0;
      /* counted with the same filters the Updates and Assets views use,
         so a sidebar number always matches what its section lists */
      for (const p of ps) {
        versions += p.versions.length;
        for (const v of p.versions) if (v && v.by === 'ai') ai++;
        if (p.published) {
          pub++;
          if (Array.isArray(p.published.updates)) updates += p.published.updates.filter(u => u && validTime(u.at)).length;
        }
        if (Array.isArray(p.assets)) assets += p.assets.filter(a => a && typeof a.id === 'string').length;
      }
      return { projects: ps.length, published: pub, drafts: ps.length - pub, versions, ai, played: played.length, playedMap: new Map(played.map(r => [r.id, r])), updates, assets };
    }

    const matches = (p, q) => [p.name, p.published?.title, p.prompt, p.published?.category, sourceLabel(p)]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
    function sorted(ps) {
      const a = [...ps];
      if (S.sort === 'name') a.sort((x, y) => title(x).localeCompare(title(y), undefined, { sensitivity: 'base' }));
      else if (S.sort === 'edited') a.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
      else a.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
      return a;
    }

    /* the published version, by id when Forge (or this app) recorded one */
    function hasNewer(p) {
      const vid = getMap('portal.forge.pub')[p.id];
      const head = p.versions[p.head];
      if (vid && head) return head.id !== vid;
      return p.head !== p.published?.version;
    }
    function setPub(id, vid) {
      const next = { ...getMap('portal.forge.pub') };
      delete next[id];
      if (vid) next[id] = vid;
      store.set('portal.forge.pub', next);
    }

    /* ---------------- shared pieces ---------------- */
    function thumbEl(p, size, src = thumbOf(p)) {
      return h(`span.cr-thumb${size ? `.cr-thumb--${size}` : ''}${src ? '.has-img' : ''}`, { style: src ? null : { '--h': String(hueOf(p.id)) } },
        src ? h('img', { src, alt: '', decoding: 'async', draggable: 'false' })
          : icon(p.source === 'studio' ? 'code' : p.source === 'remix' || p.remixCredit ? 'git-branch' : 'sparkles'));
    }
    const statusChip = p => (p.published
      ? h('span.cr-chip.cr-chip--pub', icon('upload'), h('span', { text: `Published v${(Number(p.published.version) || 0) + 1}` }))
      : h('span.cr-chip', icon('edit-3'), h('span', { text: 'Draft' })));

    function rowMenu(p, x, y) {
      if (dead) return;
      const t = title(p);
      api.menu([
        { header: true, label: t.length > 32 ? `${t.slice(0, 31)}…` : t },
        { label: 'Open in Static Forge', icon: 'sparkles', disabled: !has('forge'), onClick: () => openIn('forge', { project: p.id }) },
        { label: 'Open in Studio', icon: 'code', disabled: !has('studio'), onClick: () => openIn('studio', { project: p.id }) },
        { label: 'Make assets in Asset Lab', icon: 'image', disabled: !has('assetlab'), onClick: () => openIn('assetlab', { project: p.id }) },
        '-',
        { label: p.published ? 'Publish an update…' : 'Publish…', icon: 'upload', onClick: () => publishSheet(p.id) },
        p.published ? { label: 'Unpublish…', icon: 'x-circle', onClick: () => unpublish(p.id) } : null,
        { label: 'Export .html in Forge', icon: 'download', disabled: !has('forge'), onClick: () => exportIn(p) },
        '-',
        { label: 'Add to Desktop', icon: 'monitor', onClick: () => addDesk(p) },
        { label: 'Add to a collection…', icon: 'bookmark', onClick: () => addCol(p, x, y) },
        { label: 'Share…', icon: 'share', onClick: () => bus.emit('share:open', { kind: 'creation', id: p.id, title: t }) },
      ].filter(Boolean), x, y);
    }
    async function addDesk(p) {
      try { (await import('../core/shortcuts.js')).addToDesktop({ kind: 'creation', id: p.id, title: title(p), art: null }); }
      catch (err) { note({ icon: 'alert', title: 'Couldn’t add it to the Desktop', message: String(err?.message || err) }); }
    }
    async function addCol(p, x, y) {
      try { (await import('../core/collections.js')).pickMenu(api, { kind: 'creation', id: p.id, title: title(p) }, x, y); }
      catch (err) { note({ icon: 'alert', title: 'Collections aren’t available', message: String(err?.message || err) }); }
    }
    function exportIn(p) {
      if (!openIn('forge', { project: p.id })) return;
      note({ icon: 'download', title: `“${short(title(p))}” is open in Static Forge`, message: 'Choose Export there to save it as one .html file that runs in any browser.' });
    }
    function exportMenu(anchor) {
      if (dead || !list?.length) return;
      const r = anchor.getBoundingClientRect();
      const ps = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      api.menu([
        { header: true, label: 'Export which game?' },
        ...ps.slice(0, 12).map(p => ({ label: title(p), icon: 'download', hint: `v${verN(p)}`, onClick: () => exportIn(p) })),
        ...(ps.length > 12 ? ['-', { label: `All ${ps.length} games…`, icon: 'list', onClick: () => go('games') }] : []),
      ], r.left, r.bottom + 4);
    }

    function actions(p) {
      const t = short(title(p));                                  /* only used in tooltips and labels */
      return h('div.cr-acts',
        btn('sparkles', 'Forge', () => openIn('forge', { project: p.id }), '', { title: `Open “${short(t)}” in Static Forge`, dataset: { fk: `forge:${p.id}` } }),
        btn('code', 'Studio', () => openIn('studio', { project: p.id }), '.btn--ghost', { title: `Open “${t}” in Studio`, dataset: { fk: `studio:${p.id}` } }),
        btn('upload', p.published ? 'Update' : 'Publish', () => publishSheet(p.id), p.published ? '' : '.cr-pubbtn',
          { title: p.published ? `Publish an update of “${t}”` : `Publish “${t}” to your Workshop`, dataset: { fk: `pub:${p.id}` } }),
        h('button.ibtn.cr-more', {
          type: 'button', 'aria-label': `More for “${t}”`, title: 'More', 'aria-haspopup': 'menu', dataset: { fk: `more:${p.id}` },
          onclick: e => { const r = e.currentTarget.getBoundingClientRect(); rowMenu(p, r.left, r.bottom + 4); },
        }, icon('more-horizontal')));
    }

    function gameRow(p, st) {
      const t = title(p);
      const played = st.playedMap.get(p.id);
      const meta = [`v${verN(p)}`, plural(p.versions.length, 'version'), sourceLabel(p), p.updatedAt ? `edited ${ago(p.updatedAt)}` : null,
        played ? `played ${ago(played.at)}` : null].filter(Boolean).join(' · ');
      return h('li.cr-row', { dataset: { pid: p.id }, oncontextmenu: e => { e.preventDefault(); rowMenu(p, e.clientX, e.clientY); } },
        h('button.cr-row__art', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: () => openIn('forge', { project: p.id }) }, thumbEl(p)),
        h('div.cr-row__main',
          h('div.cr-row__top',
            h('button.cr-row__name', { type: 'button', text: t, title: `Open “${short(t)}” in Static Forge`, dataset: { fk: `open:${p.id}` }, onclick: () => openIn('forge', { project: p.id }) }),
            statusChip(p)),
          h('div.cr-row__meta', { text: meta })),
        actions(p));
    }

    function pubRow(p, st) {
      const pub = p.published;
      const t = title(p);
      const ups = (Array.isArray(pub.updates) ? pub.updates : []).filter(u => u && validTime(u.at)).sort((a, b) => b.at - a.at);
      const all = S.history.has(p.id);
      const shown = all ? ups : ups.slice(0, 3);
      const newer = hasNewer(p);
      const played = st.playedMap.get(p.id);
      const cat = String(pub.category || 'other');
      return h('li.cr-row.cr-row--pub', { dataset: { pid: p.id }, oncontextmenu: e => { e.preventDefault(); rowMenu(p, e.clientX, e.clientY); } },
        h('button.cr-row__art', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: () => openIn('forge', { project: p.id }) }, thumbEl(p)),
        h('div.cr-row__main',
          h('div.cr-row__top',
            h('button.cr-row__name', { type: 'button', text: t, title: `Open “${short(t)}” in Static Forge`, dataset: { fk: `open:${p.id}` }, onclick: () => openIn('forge', { project: p.id }) }),
            h('span.cr-chip.cr-chip--pub', icon('upload'), h('span', { text: `v${(Number(pub.version) || 0) + 1}` })),
            h('span.cr-chip', icon('tag'), h('span', { text: cat.charAt(0).toUpperCase() + cat.slice(1) }))),
          h('div.cr-row__meta', { text: [validTime(pub.at) ? `published ${ago(pub.at)}` : 'published', plural(ups.length, 'release'),
            played ? `played ${ago(played.at)}` : null].filter(Boolean).join(' · ') }),
          pub.description ? h('p.cr-row__desc', { text: String(pub.description).slice(0, 600) }) : null,
          newer ? h('div.cr-newer', icon('info'),
            h('span', { text: `You’re on v${verN(p)}. v${(Number(pub.version) || 0) + 1} is the published one.` }),
            h('button.cr-link', { type: 'button', text: 'Publish an update', dataset: { fk: `newer:${p.id}` }, onclick: () => publishSheet(p.id) })) : null,
          ups.length ? h('ol.cr-hist', { 'aria-label': `Update history of ${short(t)}` },
            shown.map(u => h('li',
              h('b', { text: `v${(Number(u.version) || 0) + 1}` }),
              h('span.cr-hist__n', { text: String(u.note || 'Updated').slice(0, 140) }),
              h('time', { dateTime: iso(u.at), text: whenFull(u.at) })))) : null,
          ups.length > 3 ? h('button.cr-link.cr-hist__more', {
            type: 'button', dataset: { fk: `hist:${p.id}` }, 'aria-expanded': String(all),
            text: all ? 'Show fewer' : `Show all ${ups.length} releases`,
            onclick: () => { if (all) S.history.delete(p.id); else S.history.add(p.id); paintContent(); },
          }) : null),
        actions(p));
    }

    /* ---------------- sections ---------------- */
    function quickActions() {
      const n = list.length;
      const qa = (key, appId, ic, label, sub, run, off) => {
        const a = api.getApp(appId);
        return h('button.cr-qa', {
          type: 'button', dataset: { fk: `qa:${key}` }, disabled: !!off || !a, onclick: run,
          title: a ? null : `${APP_NAMES[appId]} isn’t in this build`,
        },
          appTile(a || { g1: '#555', g2: '#222' }, { sel: 'span.glyph', gs: '34px', icon: ic }),
          h('span.cr-qa__t', h('b', { text: label }), h('small', { text: sub })));
      };
      return h('section.cr-sec', { 'aria-label': 'Quick actions' },
        h('div.cr-quick',
          qa('new', 'forge', 'sparkles', 'New game', 'Describe it and Forge builds it', () => openIn('forge')),
          qa('scene', 'studio', 'code', 'New scene', 'A platformer to edit in Studio', () => openIn('studio', { template: 'platformer' })),
          qa('assetlab', 'assetlab', 'image', 'Asset Lab', 'Sprites and sound effects', () => openIn('assetlab')),
          qa('export', 'forge', 'download', 'Export a game', n ? 'Save one as an .html file' : 'Make a game first', e => exportMenu(e.currentTarget), !n)));
    }

    function kpis(st) {
      const tile = (label, value, cap, sec, tip) => h(sec ? 'button.cr-kpi' : 'div.cr-kpi',
        sec ? { type: 'button', onclick: () => go(sec), dataset: { fk: `kpi:${sec}` }, title: `Open ${SECTIONS.find(s => s.id === sec).label}` }
          : { title: tip || null },
        h('span.cr-kpi__l', { text: label }),
        h('b.cr-kpi__v', { text: num(value) }),
        h('small.cr-kpi__c', { text: cap }));
      return h('section.cr-sec', { 'aria-labelledby': `${U}-kpi` },
        h('div.cr-sec__head', h('h3.cr-h', { id: `${U}-kpi`, text: 'At a glance' }), h('span.cr-tag', icon('monitor'), h('span', { text: 'This device only' }))),
        h('div.cr-kpis',
          tile('Projects', st.projects, 'games on this device', 'games'),
          tile('Published', st.published, 'in your Workshop', 'published'),
          tile('Drafts', st.drafts, 'not published yet', 'drafts'),
          tile('Versions', st.versions, 'kept in history', null, 'Every saved version of every game, as their histories keep them'),
          tile('AI edits', st.ai, 'versions the AI wrote', null, 'Versions Static Forge’s model wrote (the rest are yours or restores)'),
          tile('Played here', st.played, `of your ${plural(st.projects, 'game')}`, null, 'How many of your games are in this device’s recent play history')),
        h('p.cr-note', { text: 'Counted in this browser only. StaticOS has no server, so none of these numbers include other people or other devices.' }));
    }

    function miniRow(p) {
      return h('li', h('button.cr-mrow', { type: 'button', dataset: { fk: `m:${p.id}` }, title: `Open “${short(title(p))}” in Static Forge`, onclick: () => openIn('forge', { project: p.id }) },
        thumbEl(p, 'sm'),
        h('span.cr-mrow__t', h('b', { text: title(p) }), h('small', { text: [`v${verN(p)}`, p.updatedAt ? `edited ${ago(p.updatedAt)}` : null].filter(Boolean).join(' · ') })),
        statusChip(p)));
    }

    function recentCard() {
      const ps = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4);
      return h('section.cr-card.cr-recent', { 'aria-labelledby': `${U}-recent` },
        h('div.cr-sec__head', h('h3.cr-h', { id: `${U}-recent`, text: 'Recently edited' }),
          h('button.cr-link', { type: 'button', dataset: { fk: 'recent:all' }, onclick: () => go('games') }, h('span', { text: `All ${list.length}` }), icon('chevron-right'))),
        h('ul.cr-mini', ps.map(miniRow)));
    }

    function jamInfo(now = new Date()) {
      const { week } = isoWeek(now);
      const start = thisMonday(now), end = nextMonday(now);
      const span = end - start;
      return {
        week, theme: jamTheme(now), next: jamTheme(new Date(end.getTime() + 36e5)), end,
        left: end - now, frac: span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 0,
      };
    }
    const jamEntries = () => {
      const ids = jamEntryIds(store.get('portal.jam', null));
      return list.filter(p => ids.has(p.id));
    };
    const endLabel = end => `${end.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}, ${timeOf(end.getTime())}`;
    const meter = frac => h('div.cr-meter', {
      role: 'progressbar', 'aria-label': 'Share of the jam week that has gone by', 'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(frac * 100)),
    }, h('span.cr-meter__fill', { style: { width: `${(frac * 100).toFixed(2)}%` } }));
    const jamButtons = (j, compact) => h('div.cr-jam__acts',
      btn('sparkles', 'Start a jam game', () => openIn('forge', { prompt: `A small game for the jam theme "${j.theme}"` }), '.btn--primary',
        { disabled: !has('forge'), dataset: { fk: 'jam:start' } }),
      compact ? h('button.btn.btn--sm.btn--ghost.cr-jam__more', { type: 'button', onclick: () => go('jams'), dataset: { fk: 'jam:more' } },
        h('span', { text: 'Jam details' }), icon('chevron-right'))
        : btn('flame', 'Open Static Jam', () => openIn('jam'), '', { disabled: !has('jam'), title: has('jam') ? null : 'Static Jam isn’t in this build', dataset: { fk: 'jam:open' } }));

    function jamCard() {
      const j = jamInfo();
      const n = jamEntries().length;
      return h('section.cr-card.cr-jam', { 'aria-labelledby': `${U}-jam` },
        h('div.cr-sec__head', h('h3.cr-h', { id: `${U}-jam`, text: 'This week’s jam' }), h('span.cr-fine', { text: `Week ${j.week}` })),
        h('div.cr-jam__theme', { text: j.theme }),
        meter(j.frac),
        h('div.cr-jam__left', h('b.cr-left', { text: `${fmtLeft(j.left)} left` }), h('small', { text: `ends ${endLabel(j.end)}` })),
        h('p.cr-jam__mine', { text: n ? `You entered ${plural(n, 'game')} this week.` : 'No entry from you yet this week.' }),
        jamButtons(j, true));
    }

    function viewOverview(st) {
      countEl.textContent = '';
      if (!list.length) {
        return [
          h('section.cr-first', { 'aria-labelledby': `${U}-first` },
            appTile(api.getApp('forge') || { g1: '#ff9a4a', g2: '#d62f6c' }, { sel: 'span.glyph', gs: '52px', icon: 'sparkles' }),
            h('div.cr-first__t',
              h('h3', { id: `${U}-first`, text: 'Make your first game' }),
              h('p', { text: 'Describe an idea and Static Forge writes the game, or start from a platformer in Studio. Your games, drafts, releases and assets will all show up here.' }),
              h('div.cr-first__acts',
                btn('sparkles', 'Describe a game', () => openIn('forge'), '.btn--primary', { disabled: !has('forge'), dataset: { fk: 'first:forge' } }),
                btn('code', 'Start a platformer', () => openIn('studio', { template: 'platformer' }), '', { disabled: !has('studio'), dataset: { fk: 'first:studio' } })))),
          quickActions(),
          h('div.cr-cols.cr-cols--one', jamCard()),
          h('p.cr-note', { text: 'Counts appear here once you have a game. They are this device’s only — StaticOS has no server, so there are no views, followers or ratings to show.' }),
        ];
      }
      return [quickActions(), kpis(st), h('div.cr-cols', recentCard(), jamCard())];
    }

    function viewList(kind, st) {
      const label = SECTIONS.find(s => s.id === kind).label;
      let ps = kind === 'drafts' ? list.filter(p => !p.published) : kind === 'published' ? list.filter(p => p.published) : list;
      const total = ps.length;
      if (S.q) ps = ps.filter(p => matches(p, S.q));
      ps = sorted(ps);
      countEl.textContent = S.q ? `${ps.length} of ${total}` : plural(total, 'game');
      if (!total) {
        if (!list.length || kind === 'games') {
          return empty('sparkles', 'No games yet', 'Describe a game and Static Forge builds it, or start from a template in Studio. Everything you make shows up here.',
            btn('sparkles', 'New game', () => openIn('forge'), '.btn--primary', { disabled: !has('forge') }),
            btn('code', 'New scene', () => openIn('studio', { template: 'platformer' }), '', { disabled: !has('studio') }));
        }
        if (kind === 'drafts') return empty('check-circle', 'No drafts', 'Every game you’ve made is published.', btn('upload', 'See published games', () => go('published')));
        return empty('upload', 'Nothing published yet', 'Publishing puts a game in your Workshop on this device, with a title, a description and an update history.',
          btn('edit-3', 'See drafts', () => go('drafts'), '.btn--primary'));
      }
      if (!ps.length) return empty('search', 'No matches', `Nothing in ${label} matches “${S.q}”.`);
      return h('ul.cr-list', { 'aria-label': label }, ps.map(p => (kind === 'published' ? pubRow(p, st) : gameRow(p, st))));
    }

    function viewUpdates() {
      const ev = [];
      for (const p of list) {
        const ups = p.published && Array.isArray(p.published.updates) ? p.published.updates : [];
        for (const u of ups) if (u && validTime(u.at)) ev.push({ p, u });
      }
      ev.sort((a, b) => b.u.at - a.u.at);
      countEl.textContent = plural(ev.length, 'release');
      if (!ev.length) {
        return empty('tag', 'No updates yet', 'Each time you publish a game or an update to it, it’s listed here with its version and note.',
          list.some(p => !p.published) ? btn('edit-3', 'See drafts', () => go('drafts'), '.btn--primary') : null);
      }
      const groups = [];
      for (const e of ev) {
        const k = dayStart(new Date(Number(e.u.at)));
        let g = groups[groups.length - 1];
        if (!g || g.k !== k) groups.push(g = { k, label: dayLabel(e.u.at), items: [] });
        g.items.push(e);
      }
      return [
        h('div.cr-tl', groups.map(g => h('section.cr-tl__day',
          h('h3.cr-tl__d', { text: g.label }),
          h('ol.cr-tl__list', g.items.map(({ p, u }) => {
            const first = u.note === 'First release';
            return h('li.cr-tl__i',
              h(`span.cr-tl__dot${first ? '.is-first' : ''}`, icon(first ? 'star' : 'upload')),
              h('div.cr-tl__body',
                h('button.cr-tl__t', { type: 'button', dataset: { fk: `tl:${p.id}:${u.at}` }, title: `Open “${short(title(p))}” in Static Forge`, onclick: () => openIn('forge', { project: p.id }) },
                  h('b', { text: title(p) }), h('span', { text: ` v${(Number(u.version) || 0) + 1}` })),
                h('span.cr-tl__n', { text: String(u.note || 'Updated').slice(0, 140) })),
              h('time', { dateTime: iso(u.at), text: timeOf(u.at) }));
          }))))),
        h('p.cr-note', { text: 'Only games that are still published keep their update history — unpublishing a game clears it.' }),
      ];
    }

    /* ---- assets ---- */
    function stopAudio() {
      if (!audio) return;
      const { el, key } = audio;
      audio = null;
      el.removeEventListener('ended', stopAudio);
      el.removeEventListener('error', stopAudio);
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) { /* already gone */ }
      const b = content.querySelector(`[data-fk="${CSS.escape(`aud:${key}`)}"]`);
      if (b) setPlay(b, false);
    }
    function setPlay(b, on) {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} ${b.dataset.name || 'sound'}`);
      b.replaceChildren(icon(on ? 'pause' : 'play'));
    }
    function toggleAudio(key, url, b) {
      if (audio?.key === key) { stopAudio(); return; }
      stopAudio();
      const el = new Audio();
      audio = { key, el };
      el.addEventListener('ended', stopAudio);
      el.addEventListener('error', stopAudio);
      el.src = url;
      setPlay(b, true);
      el.play().catch(() => {
        if (audio?.el !== el) return;
        stopAudio();
        note({ icon: 'volume-x', title: 'That sound won’t play here', message: 'This browser refused to play it.' });
      });
    }

    function assetTile({ p, a }) {
      const aud = a.kind === 'audio';
      const key = `${p.id}:${a.id}`;
      const name = String(a.name || (aud ? 'sound' : 'image')).slice(0, 80);
      const bytes = approxBytes(a.dataUrl);
      const dims = h('span.cr-asset__dims');
      let prev;
      if (aud) {
        const url = safeAudio(a.dataUrl);
        const on = audio?.key === key;
        prev = h('div.cr-asset__prev.cr-asset__prev--aud',
          h('button.cr-play', {
            type: 'button', disabled: !url, dataset: { fk: `aud:${key}`, name }, 'aria-pressed': String(on),
            'aria-label': `${on ? 'Stop' : 'Play'} ${name}`, onclick: e => toggleAudio(key, url, e.currentTarget),
          }, icon(on ? 'pause' : 'play')));
      } else {
        const src = safeImg(a.dataUrl);
        prev = h('div.cr-asset__prev', src ? h('img', {
          src, alt: '', decoding: 'async', draggable: 'false',
          onload: e => {
            const im = e.currentTarget;
            dims.textContent = `${im.naturalWidth}×${im.naturalHeight}`;
            if (im.naturalWidth && im.naturalWidth <= 128 && im.naturalHeight <= 128) im.classList.add('is-px');
          },
        }) : icon('image'));
      }
      return h('li.cr-asset', { dataset: { asset: a.id } },
        prev,
        h('div.cr-asset__meta',
          h('b', { text: name, title: name }),
          h('small', h('span', { text: `${aud ? 'Sound' : 'Image'}${bytes ? ` · ${fmt.fmtBytes(bytes)}` : ''}` }), aud ? null : dims),
          h('button.cr-asset__game', { type: 'button', text: title(p), title: `Open “${short(title(p))}” in Static Forge`, onclick: () => openIn('forge', { project: p.id }) })),
        btn('external-link', aud ? 'Asset Lab' : 'Edit in Asset Lab',
          () => openIn('assetlab', aud ? { project: p.id, tab: 'library' } : { edit: { project: p.id, asset: a.id } }), '.cr-asset__go',
          { disabled: !has('assetlab'), dataset: { fk: `al:${key}` }, title: aud ? `Open Asset Lab for “${short(title(p))}”` : `Edit ${short(name)} in Asset Lab` }));
    }

    function viewAssets() {
      const all = [];
      for (const p of list) for (const a of (Array.isArray(p.assets) ? p.assets : [])) if (a && typeof a.id === 'string') all.push({ p, a });
      const imgs = all.filter(x => x.a.kind !== 'audio');
      const snds = all.filter(x => x.a.kind === 'audio');
      countEl.textContent = `${plural(imgs.length, 'image')} · ${plural(snds.length, 'sound')}`;
      if (!all.length) {
        return empty('image', 'No assets yet', 'Sprites and sound effects you save to a game in Asset Lab show up here, with the game they belong to.',
          btn('image', 'Open Asset Lab', () => openIn('assetlab'), '.btn--primary', { disabled: !has('assetlab') }));
      }
      let shown = S.kind === 'image' ? imgs : S.kind === 'audio' ? snds : all;
      if (S.q) shown = shown.filter(x => `${x.a.name || ''} ${title(x.p)}`.toLowerCase().includes(S.q));
      const seg = h('div.cr-seg', { role: 'group', 'aria-label': 'Show' }, KINDS.map(k => h(`button.cr-seg__b${S.kind === k.id ? '.is-on' : ''}`, {
        type: 'button', 'aria-pressed': String(S.kind === k.id), dataset: { fk: `kind:${k.id}` },
        onclick: () => { S.kind = k.id; remember(); paintContent(true); },
      }, h('span', { text: k.label }), h('small', { text: String(k.id === 'image' ? imgs.length : k.id === 'audio' ? snds.length : all.length) }))));
      return [seg, shown.length ? h('ul.cr-assets', shown.map(assetTile))
        : empty('search', 'No matches', S.q ? `No ${S.kind === 'audio' ? 'sound' : S.kind === 'image' ? 'image' : 'asset'} matches “${S.q}”.` : `No ${S.kind === 'audio' ? 'sounds' : 'images'} yet.`)];
    }

    function viewJams() {
      const j = jamInfo();
      const mine = jamEntries();
      countEl.textContent = `Week ${j.week}`;
      return [
        h('section.cr-jamhero', { 'aria-labelledby': `${U}-jt` },
          h('span.label', { text: 'This week’s theme' }),
          h('h3.cr-jamhero__theme', { id: `${U}-jt`, text: j.theme }),
          meter(j.frac),
          h('div.cr-jam__left', h('b.cr-left', { text: `${fmtLeft(j.left)} left` }), h('small', { text: `ends ${endLabel(j.end)}, this device’s time` })),
          jamButtons(j, false),
          h('p.cr-fine', { text: `Next week’s theme: ${j.next}.` })),
        h('section.cr-sec', { 'aria-labelledby': `${U}-je` },
          h('div.cr-sec__head', h('h3.cr-h', { id: `${U}-je`, text: 'Your entries this week' }), mine.length ? h('span.cr-fine', { text: String(mine.length) }) : null),
          mine.length ? h('ul.cr-mini.cr-mini--card', mine.map(miniRow))
            : h('div.cr-soft', icon('flame'), h('span', { text: has('jam')
              ? `No entry from you yet. Make a game for “${j.theme}”, then enter it in Static Jam.`
              : `No entry from you yet. Static Jam, where games are entered, isn’t in this build.` }))),
        h('p.cr-note', { text: 'The theme comes from the calendar week, so everyone on StaticOS has the same one this week. Time left counts down to Monday 00:00 on this device’s clock.' }),
      ];
    }

    function viewProfile(st) {
      countEl.textContent = '';
      const u = store.get('session.user', null);
      const nm = u ? String(u.name || u.username || '').slice(0, 60) : '';
      const bio = String((store.get('portal.profile', null) || {}).bio || '').slice(0, 240);
      const stat = (v, l) => h('div', h('b', { text: num(v) }), h('span', { text: l }));
      return [
        h('section.cr-card.cr-prof', { 'aria-label': 'Creator profile' },
          h('div.cr-prof__av', { text: (nm || '?').trim().charAt(0).toUpperCase() || '?' }),
          h('div.cr-prof__who',
            h('b.cr-prof__name', { text: nm || 'Not signed in' }),
            h('small', { text: u?.username ? `@${String(u.username).slice(0, 40)}` : 'Sign in (bottom right) to put your name on your games.' }),
            h(`p.cr-prof__bio${bio ? '' : '.is-empty'}`, { text: bio || 'No description yet — add one in your profile.' })),
          h('div.cr-prof__stats', stat(st.published, 'published'), stat(st.projects, 'projects'), stat(st.updates, 'releases')),
          h('div.cr-prof__acts', btn('user', 'Open Profile', () => openIn('profile'), '.btn--primary', { disabled: !has('profile'), dataset: { fk: 'prof:open' } }))),
        profileGames(),
        h('p.cr-note', { text: 'Your profile lives on this device. Followers and other people’s profiles need accounts on a server, which StaticOS doesn’t have.' }),
      ];
    }

    /* what the Profile app lists under "Published games": the same games,
       newest release first, with the published thumbnail as it uses */
    function profileGames() {
      const pubs = list.filter(p => p.published).sort((a, b) => (Number(b.published.at) || 0) - (Number(a.published.at) || 0));
      const MAX = 8;
      return h('section.cr-sec', { 'aria-labelledby': `${U}-pg` },
        h('div.cr-sec__head',
          h('h3.cr-h', { id: `${U}-pg`, text: 'Published games on your profile' }),
          pubs.length > MAX ? h('button.cr-link', { type: 'button', dataset: { fk: 'pg:all' }, onclick: () => go('published') }, h('span', { text: `All ${pubs.length}` }), icon('chevron-right'))
            : pubs.length ? h('span.cr-fine', { text: String(pubs.length) }) : null),
        pubs.length
          ? h('ul.cr-pgrid', pubs.slice(0, MAX).map(p => {
            const cat = String(p.published.category || 'other');
            return h('li', h('button.cr-pg', { type: 'button', dataset: { fk: `pg:${p.id}` }, title: `Open “${short(title(p))}” in Static Forge`, onclick: () => openIn('forge', { project: p.id }) },
              thumbEl(p, null, pubThumbOf(p)),
              h('b', { text: title(p) }),
              h('small', { text: `v${(Number(p.published.version) || 0) + 1} · ${cat.charAt(0).toUpperCase()}${cat.slice(1)}` })));
          }))
          : h('div.cr-soft', icon('upload'), h('span', { text: list.length
            ? 'Nothing published yet. The games you publish are the ones your profile shows.'
            : 'Nothing here yet. Make a game, publish it, and it shows up on your profile.' })));
    }

    const VIEWS = {
      overview: viewOverview,
      games: st => viewList('games', st),
      drafts: st => viewList('drafts', st),
      published: st => viewList('published', st),
      updates: viewUpdates,
      assets: viewAssets,
      jams: viewJams,
      profile: viewProfile,
    };

    /* ---------------- paint ---------------- */
    function paint(reset) {
      if (dead) return;
      const st = list ? stats(list) : null;
      paintSide(st);
      paintContent(reset, st);
    }

    function paintContent(reset, st = list ? stats(list) : null) {
      if (dead) return;
      const keep = reset ? 0 : content.scrollTop;
      const af = document.activeElement;
      const fk = af && content.contains(af) ? af.dataset?.fk || null : null;
      clear(content);
      if (!list) {
        countEl.textContent = '';
        content.appendChild(h('div.cr-loading', h('div.spinner'), h('span', { text: 'Reading your projects…' })));
        return;
      }
      if (loadErr && !list.length) {
        countEl.textContent = '';
        content.appendChild(empty('alert', 'Couldn’t read your projects', 'This browser blocked the storage StaticOS keeps projects in — private windows sometimes do.',
          btn('refresh', 'Try again', () => { list = null; paint(true); load(); }, '.btn--primary')));
        return;
      }
      const out = VIEWS[S.sec](st);
      for (const n of [out].flat()) if (n) content.appendChild(n);
      content.scrollTop = keep;
      if (fk) {
        const back = content.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
        if (back && !back.disabled) back.focus({ preventScroll: true });
      }
    }

    /* ---------------- publish ---------------- */
    function openSheet(card) {
      closeSheet();
      const opener = document.activeElement;
      const wrap = h('div.cr-sheet', {
        onpointerdown: e => { if (e.target === wrap) close(); },
        onkeydown: e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
          if (e.key !== 'Tab') return;
          const f = [...card.querySelectorAll('button,input,textarea,select')].filter(x => !x.disabled && x.offsetParent);
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        },
      }, card);
      app.appendChild(wrap);
      const s = { close };
      sheet = s;
      function close(quiet) {
        if (sheet !== s) return;
        sheet = null;
        wrap.remove();
        if (!quiet) { try { if (opener?.isConnected) opener.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
      }
      card.querySelector('input,textarea,select')?.focus({ preventScroll: true });
      return s;
    }
    function closeSheet(quiet) { sheet?.close(quiet); }

    async function publishSheet(pid) {
      if (dead) return;
      const p = await P.get(pid).catch(() => null);
      if (dead) return;
      if (!p || !Array.isArray(p.versions) || !p.versions.length) {
        note({ icon: 'alert', title: 'That game is gone', message: 'It may have been deleted in another app.' });
        return;
      }
      const pub = p.published;
      const info = getMap('portal.forge.info')[p.id] || {};
      const fid = n => `${U}-pub-${n}`;
      const field = (n, label, control, hint) => h('div.cr-f',
        h('label.cr-f__l', { for: fid(n), text: label }), control, hint ? h('span.cr-f__h', { text: hint }) : null);

      const tIn = h('input.cr-in', {
        id: fid('t'), type: 'text', maxlength: '60', autocomplete: 'off', required: true,
        oninput: () => { if (tIn.value.trim()) err.textContent = ''; },   /* the "give it a title" note goes once there is one */
      });
      tIn.value = String(pub?.title || p.name || '').slice(0, 60);
      const dIn = h('textarea.cr-in', { id: fid('d'), rows: '3', maxlength: '600', placeholder: 'What is it, and what makes it fun?' });
      dIn.value = String(pub?.description || p.prompt || '').slice(0, 600);
      const cIn = h('input.cr-in', { id: fid('c'), type: 'text', maxlength: '300', autocomplete: 'off', placeholder: 'e.g. Arrow keys to move, Space to jump' });
      cIn.value = String(pub?.controls || info.controls || '').slice(0, 300);
      const cat = h('select.select.cr-in', { id: fid('k') }, CATEGORIES.map(c => h('option', { value: c, text: c.charAt(0).toUpperCase() + c.slice(1) })));
      cat.value = CATEGORIES.includes(pub?.category) ? pub.category : CATEGORIES.includes(info.genre) ? info.genre : 'arcade';
      const nIn = pub ? h('input.cr-in', { id: fid('n'), type: 'text', maxlength: '140', autocomplete: 'off', placeholder: 'What changed in this update?' }) : null;
      const thumb = pubThumbOf(p);
      const err = h('p.cr-sheet__err', { role: 'alert' });
      const vn = verN(p);
      const goBtn = h('button.btn.btn--primary', { type: 'submit' }, icon('upload'), h('span', { text: pub ? `Publish update (v${vn})` : `Publish v${vn}` }));

      const card = h('form.cr-sheet__card', {
        role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': fid('h'), novalidate: true,
        onsubmit: async e => {
          e.preventDefault();
          if (goBtn.disabled) return;
          const tt = tIn.value.replace(/\s+/g, ' ').trim();
          if (!tt) { err.textContent = 'Give it a title first.'; tIn.focus(); return; }
          err.textContent = '';
          goBtn.disabled = true;
          try {
            const fresh = await P.get(p.id);
            if (!fresh) throw new Error('it was deleted in another app');
            const res = await P.publish(fresh.id, {
              title: tt, description: dIn.value.trim(), controls: cIn.value.trim(), category: cat.value,
              thumbnail: pubThumbOf(fresh) || null, note: nIn?.value.replace(/\s+/g, ' ').trim() || undefined,
            });
            if (!res) throw new Error('it was deleted in another app');
            setPub(res.id, res.versions[res.head]?.id || null);
            if (dead) return;
            closeSheet();
            const n = res.head + 1;
            note({ icon: 'upload', title: `Published “${short(tt)}” v${n}`, message: 'It’s in your Workshop on this device. To share it, export it from Static Forge and send the file.' });
            announce(`Published ${short(tt)}, version ${n}.`);
          } catch (e2) {
            if (dead) return;
            goBtn.disabled = false;
            err.textContent = `That didn’t work: ${String(e2?.message || e2)}.`;
          }
        },
      },
        h('div.cr-sheet__head',
          h('h2.cr-sheet__title', { id: fid('h'), text: pub ? `Update “${short(title(p))}”` : `Publish “${short(String(p.name || 'Untitled game'))}”` }),
          h('div.grow'),
          h('button.ibtn', { type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => closeSheet() }, icon('x'))),
        h('p.cr-sheet__sub', { text: `Publishing puts v${vn} in your Workshop on this device. StaticOS has no server, so nobody else can see it online — to share it, export it from Static Forge and send the file.` }),
        h('div.cr-form',
          h('div.cr-form__main',
            field('t', 'Title', tIn),
            field('d', 'Description', dIn),
            field('c', 'Controls', cIn),
            field('k', 'Category', cat),
            nIn ? field('n', 'Update note', nIn, 'Shown in the update history. Leave it empty and it says “Updated”.') : null),
          h('div.cr-form__side',
            h('span.cr-f__l', { text: 'Thumbnail' }),
            h('div.cr-pthumb', thumb ? h('img', { src: thumb, alt: 'Thumbnail' }) : h('span', { text: 'No thumbnail yet' })),
            h('span.cr-f__h', { text: 'Thumbnails are taken from the running game — use Publish in Static Forge to take a new one.' }))),
        err,
        h('div.cr-sheet__foot', h('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => closeSheet() }), goBtn));
      if (dead) return;
      openSheet(card);
    }

    async function unpublish(pid) {
      const p = list?.find(x => x.id === pid);
      if (!p?.published || dead) return;
      const n = Array.isArray(p.published.updates) ? p.published.updates.length : 0;
      const ok = await api.confirm({
        title: `Unpublish “${short(title(p))}”?`,
        message: `It leaves your Workshop and its update history (${plural(n, 'release')}) is cleared. The game and all its versions stay in My games.`,
        ok: 'Unpublish', danger: true,
      });
      if (!ok || dead) return;
      try {
        await P.unpublish(pid);
        setPub(pid, null);
        announce(`Unpublished ${short(title(p))}.`);
      } catch (err) {
        note({ icon: 'alert', title: 'Couldn’t unpublish it', message: String(err?.message || err) });
      }
    }

    /* ---------------- the jam clock ---------------- */
    let wk = weekKey();
    tickT = setInterval(() => {
      if (dead) return;
      const now = new Date();
      if (weekKey(now) !== wk) { wk = weekKey(now); paint(); return; }   /* a new week: new theme, new entries */
      if (S.sec !== 'jams' && S.sec !== 'overview') return;
      const j = jamInfo(now);
      for (const el of content.querySelectorAll('.cr-left')) el.textContent = `${fmtLeft(j.left)} left`;
      for (const m of content.querySelectorAll('.cr-meter')) {
        m.setAttribute('aria-valuenow', String(Math.round(j.frac * 100)));
        if (m.firstChild) m.firstChild.style.width = `${(j.frac * 100).toFixed(2)}%`;
      }
    }, 20000);

    /* ---------------- start ---------------- */
    paintBar();
    paint(true);
    revealSide(S.sec);
    load();

    win.onReopen?.(o => { if (dead) return; const c = canon(o?.section); if (c) go(c); });

    offs.push(
      bus.on('projects:change', reload),
      bus.on('game:launch', soon),
      store.sub('portal.forge.thumbs', soon),
      store.sub('portal.forge.pub', soon),
      store.sub('portal.jam', soon),
      store.sub('session.user', soon),
      store.sub('portal.profile', soon),
      store.sub('prefs.h24', soon),
    );

    return () => {
      if (dead) return;
      dead = true;
      clearTimeout(reloadT);
      clearInterval(tickT);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      stopAudio();
      closeSheet(true);
      offs.forEach(f => { try { f?.(); } catch (e) { /* already off */ } });
      offs.length = 0;
    };
  },
});
