/* ============================================================
   Static Store — the catalogue of StaticOS itself (section 32).

   Every item here is something this computer really has and every
   button really does what it says: themes set the accent, wallpapers
   go on the desktop, sound packs change the UI cues, widgets go in
   or out of the rail, layouts rewrite the desktop prefs, games
   launch, apps open and pin to the Dock. Nothing is downloaded,
   so there are no sizes, prices, ratings or install bars — an
   earlier Store faked all four, and the brief is explicit that
   nothing on screen should be made up.

   Community creations are the games published on this device.
   Other people's games need a server, which StaticOS does not
   have; the section says so instead of inventing any.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as THEMES from '../core/themes.js';
import * as WP from '../portal/wallpapers.js';
import sfx from '../core/sfx.js';
import { ARCADE } from '../arcade/index.js';
import { WIDGET_CATALOG, widgetHidden, setWidgetHidden } from '../shell/widgets.js?v=ps5-cloud-proxy-v12';
import { appTile } from '../core/appart.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-store-css')) {
  const l = document.createElement('link');
  l.id = 'feat-store-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-store.css';
  document.head.appendChild(l);
}

const SECTIONS = [
  { id: 'Discover', icon: 'sparkles', group: 'Store' },
  { id: 'Games', icon: 'gamepad', group: 'Play' },
  { id: 'Community', icon: 'users', group: 'Play' },
  { id: 'Apps', icon: 'grid-9', group: 'Software' },
  { id: 'Creator tools', icon: 'wrench', group: 'Software' },
  { id: 'Labs', icon: 'zap', group: 'Software' },
  { id: 'Themes', icon: 'palette', group: 'Make it yours' },
  { id: 'Wallpapers', icon: 'wallpaper', group: 'Make it yours' },
  { id: 'Icons', icon: 'diamond', group: 'Make it yours' },
  { id: 'Widgets', icon: 'layers', group: 'Make it yours' },
  { id: 'Sounds', icon: 'volume-2', group: 'Make it yours' },
  { id: 'Layouts', icon: 'desktop', group: 'Make it yours' },
  { id: 'Updates', icon: 'download', group: 'This computer' },
  { id: 'In use', icon: 'check-circle', group: 'This computer' },
];
/* names older callers pass (About's "Open Store" sends Updates) */
const ALIAS = { Installed: 'In use' };
const canonSec = s => (SECTIONS.some(x => x.id === s) ? s : ALIAS[s] || null);

const CREATOR = ['forge', 'studio', 'assetlab', 'controller', 'code', 'lens', 'profile'];
const GAME_APPS = ['play', 'arcade', 'aether-games'];

const ICON_STYLES = [
  { id: 'glass', name: 'Glass', note: 'Lit, domed tiles with a rounded-square shape. The default.' },
  { id: 'round', name: 'Round', note: 'Every tile a circle.' },
  { id: 'sharp', name: 'Sharp', note: 'Tighter corners, closer to a square.' },
  { id: 'flat', name: 'Flat', note: 'No light, no bevel: just the colour.' },
  { id: 'outline', name: 'Outline', note: 'Hollow tiles, drawn in each app’s colour.' },
  { id: 'tinted', name: 'Tinted', note: 'Every tile in the accent colour, so the whole set matches your theme.' },
];

const LAYOUTS = [
  { id: 'everything', name: 'Everything', icon: 'grid-9',
    note: 'Icons on the desktop, the widget rail open, the clock showing.',
    prefs: { desktopIcons: true, widgetsVisible: true, desktopClock: true, dockMagnify: true } },
  { id: 'clean', name: 'Clean', icon: 'square',
    note: 'Just the wallpaper, the clock and the Dock. Widgets and icons tucked away.',
    prefs: { desktopIcons: false, widgetsVisible: false, desktopClock: true, dockMagnify: true } },
  { id: 'player', name: 'Player', icon: 'gamepad',
    note: 'The Games and Game Mode widgets first in the rail, and Game Mode that turns on when a game opens.',
    prefs: { desktopIcons: true, widgetsVisible: true, desktopClock: true, gameModeAuto: true },
    widgets: ['games', 'gamemode'] },
  { id: 'focus', name: 'Focus', icon: 'moon',
    note: 'Nothing on the desktop at all, and a Dock that stays still.',
    prefs: { desktopIcons: false, widgetsVisible: false, desktopClock: false, dockMagnify: false } },
];

const hueArt = hue => ({ '--g1': `hsl(${hue} 85% 64%)`, '--g2': `hsl(${hue} 70% 26%)` });

/* ---------- look codes --------------------------------------------- *
 * StaticOS has no server, so "share your setup" is a code you copy and
 * send: your accent, light/dark, wallpaper, icon style, sound pack and
 * desktop layout, packed as base64url JSON behind a prefix. Pasting one
 * shows exactly what it will change and can be undone. Decoding is
 * strict — every field is checked against what this build knows, and a
 * custom wallpaper is only accepted as an https image/video URL.
 * ------------------------------------------------------------------- */
const LOOK_PREFIX = 'SLOOK1.';
const LOOK_BOOLS = ['desktopIcons', 'widgetsVisible', 'desktopClock', 'dockMagnify'];
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))));

function encodeLook(store) {
  const p = store.get('prefs', {}) || {};
  const w = WP.active(store);
  const look = {
    a: THEMES.canonId(p.accent),
    m: p.theme === 'light' ? 'light' : 'dark',
    i: ICON_STYLES.some(s => s.id === p.iconStyle) ? p.iconStyle : 'glass',
    s: sfx.PACKS.some(x => x.id === p.soundPack) ? p.soundPack : 'glass',
    d: Object.fromEntries(LOOK_BOOLS.map(k => [k, p[k] !== false])),
  };
  if (w?.built) look.w = { id: w.id };
  else if (w && /^https:\/\//i.test(w.url || '')) look.w = { url: w.url, name: String(w.name || 'Wallpaper').slice(0, 40), kind: w.kind };
  return LOOK_PREFIX + b64u(JSON.stringify(look));
}

/** -> { look, notes[] } or throws with a plain-language reason */
function decodeLook(code) {
  const raw = String(code || '').trim();
  if (!raw.startsWith(LOOK_PREFIX)) throw new Error('That isn’t a StaticOS look code (they start with SLOOK1.).');
  let o;
  try { o = JSON.parse(unb64u(raw.slice(LOOK_PREFIX.length))); } catch (e) { throw new Error('That code is damaged — it may have been cut off when it was copied.'); }
  if (!o || typeof o !== 'object') throw new Error('That code is empty.');
  const look = {};
  if (THEMES.isTheme(o.a) || THEMES.isHex(o.a)) look.accent = THEMES.canonId(o.a);
  if (o.m === 'light' || o.m === 'dark') look.theme = o.m;
  if (ICON_STYLES.some(s => s.id === o.i)) look.iconStyle = o.i;
  if (sfx.PACKS.some(x => x.id === o.s)) look.soundPack = o.s;
  if (o.d && typeof o.d === 'object') {
    look.prefs = {};
    for (const k of LOOK_BOOLS) if (typeof o.d[k] === 'boolean') look.prefs[k] = o.d[k];
  }
  if (o.w && typeof o.w === 'object') {
    if (typeof o.w.id === 'string' && WP.BUILT_IN.some(w => w.id === o.w.id)) look.wallpaper = { id: o.w.id };
    else if (typeof o.w.url === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(o.w.url) && o.w.url.length < 600) {
      look.wallpaper = { url: o.w.url, name: String(o.w.name || 'Shared wallpaper').replace(/[<>]/g, '').slice(0, 40), kind: ['image', 'gif', 'video'].includes(o.w.kind) ? o.w.kind : undefined };
    }
  }
  if (!Object.keys(look).length) throw new Error('That code doesn’t contain anything this version of StaticOS understands.');
  return look;
}

defineApp({
  id: 'store',
  name: 'Static Store',
  icon: 'shopping-bag',
  g1: '#c9a8ff', g2: '#6520d6',
  category: 'System',
  keywords: ['apps', 'market', 'install', 'themes', 'widgets', 'updates', 'wallpapers', 'sounds', 'icons', 'layouts', 'games'],
  desc: 'Games, apps, themes, wallpapers, sounds and more for StaticOS',
  pinned: true, dock: true, singleton: true,
  win: { w: 900, h: 600, minW: 520, minH: 380 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, store, bus, clear } = api;

    const S = { sec: canonSec(opts?.section) || (opts?.look ? 'In use' : 'Discover'), q: '', back: [], fwd: [] };
    let dead = false;
    let changelog = null;          // data/changelog.json, fetched once
    let build = null;              // build.json
    let community = null;          // published projects, loaded on demand

    const prefs = () => store.get('prefs', {}) || {};
    let DESK = null;
    import('../shell/deskwidgets.js?v=ps5-cloud-proxy-v12').then(m => { DESK = m; if (!dead && S.sec === 'Widgets') paint(); }).catch(() => {});
    const setPrefs = patch => store.set('prefs', { ...prefs(), ...patch });
    const note = n => api.notify({ app: 'Static Store', icon: 'shopping-bag', timeout: 3500, ...n });
    const has = id => !!api.getApp(id);

    /* ---------------- chrome --------------- */
    const btnBack = h('button.ibtn.tip', { 'data-tip': 'Back', 'aria-label': 'Back', onclick: () => goBack() }, icon('chevron-left'));
    const btnFwd = h('button.ibtn.tip', { 'data-tip': 'Forward', 'aria-label': 'Forward', onclick: () => goFwd() }, icon('chevron-right'));
    win.setLead(btnBack, btnFwd);

    const search = h('input', {
      type: 'search', placeholder: 'Search the Store…', spellcheck: 'false', 'aria-label': 'Search the Store',
      oninput: e => { S.q = e.target.value.trim().toLowerCase(); paint(); },
      onkeydown: e => { if (e.key === 'Escape') { e.target.value = ''; S.q = ''; paint(); } },
    });
    win.setTools(h('div.field', { style: { width: '190px', height: '24px' } }, icon('search'), search));

    const side = h('aside.app__side.st-side');
    const secTitle = h('div.app__title');
    const secCount = h('span.dim');
    const bar = h('div.app__bar', secTitle, secCount, h('div.grow'));
    const content = h('div.app__content.st');
    root.appendChild(h('div.app', side, h('div.app__main', bar, content)));

    /* ---------------- pieces --------------- */
    const glyph = (ic, style, gs = 42) => h('div.glyph', { style: { '--gs': `${gs}px`, ...style } }, icon(ic));
    const appGlyph = (app, gs = 42) => appTile(app, { gs: `${gs}px` });

    /** A button that runs `run`, repaints after, and never throws at the user. */
    const act = ({ label, ic, primary, run, disabled, tip }) => h(`button.btn.btn--sm${primary ? '.btn--primary' : ''}`, {
      type: 'button', disabled: !!disabled, title: tip || null, 'aria-label': tip || label,
      onclick: async e => {
        e.stopPropagation();
        try { await run(); } catch (err) { note({ icon: 'alert', title: 'That didn’t work', message: String(err?.message || err) }); }
        if (!dead) paint();
      },
    }, ic ? icon(ic) : null, label);

    const tag = (text, ic, accent) => h(`span.st-tag${accent ? '.st-tag--on' : ''}`, ic ? icon(ic) : null, h('span', { text }));

    /** The standard catalogue row. */
    const row = ({ art, name, sub, tags = [], actions = [], on, key, menu }) => h(`div.store__item.st-item${on ? '.is-on' : ''}`, {
      dataset: { item: key || name },
      oncontextmenu: menu ? e => { e.preventDefault(); api.menu(menu(), e.clientX, e.clientY); } : null,
    },
      art,
      h('div.grow.st-item__body',
        h('b', { text: name }),
        sub ? h('small', { text: sub }) : null,
        tags.filter(Boolean).length ? h('div.st-tags', tags.filter(Boolean)) : null),
      actions.filter(Boolean).length ? h('div.st-item__acts', actions.filter(Boolean)) : null);

    const grid = (items, cls = 'grid2') => h(`div.${cls}`, items);
    const shelf = (label, items, more) => (items.length ? h('section.st-shelf',
      h('div.st-shelf__head', h('div.label', { text: label }), h('div.grow'),
        more ? h('button.st-more', { type: 'button', onclick: () => go(more) }, h('span', { text: 'See all' }), icon('chevron-right')) : null),
      grid(items)) : null);
    const empty = (ic, title, text, ...extra) => h('div.empty', icon(ic), h('b', { text: title }), h('small', { text }), ...extra);
    const banner = (ic, text, ...extra) => h('div.st-banner', icon(ic), h('span.grow', { text }), ...extra);

    /* ============== items, one builder per kind ============== */
    function gameItems() {
      const out = [];
      if (has('play')) out.push(appRow(api.getApp('play'), 'Every game on StaticOS in one place: web games, the Arcade and your own.'));
      if (has('aether-games')) out.push(appRow(api.getApp('aether-games'), 'Thousands of web games, with more than one server for each.'));
      for (const g of ARCADE) {
        const style = hueArt(g.hue);
        out.push(row({
          key: `arcade:${g.id}`,
          art: glyph(g.icon, style),
          name: g.title,
          sub: g.blurb,
          tags: [tag('Arcade', 'gamepad'), tag(g.players.includes(2) ? '1–2 players' : '1 player', 'users'), tag(`~${g.minutes} min`, 'clock')],
          actions: [
            act({ label: 'Play', ic: 'play', primary: true, disabled: !has('arcade'), run: () => api.openApp('arcade', { game: g.id }) }),
          ],
          menu: () => [
            { label: 'Play', icon: 'play', disabled: !has('arcade'), onClick: () => api.openApp('arcade', { game: g.id }) },
            { label: 'Add to Desktop', icon: 'monitor', onClick: () => addShortcut({ kind: 'arcade', id: g.id, title: g.title }) },
            { label: 'Share…', icon: 'share', onClick: () => bus.emit('share:open', { kind: 'arcade', id: g.id, title: g.title }) },
          ],
        }));
      }
      return out;
    }

    async function addShortcut(item) {
      const { addToDesktop } = await import('../core/shortcuts.js');
      addToDesktop(item);
    }

    function dockHas(id) { return (store.get('dock') || []).includes(id); }
    function toggleDock(id) {
      const list = (store.get('dock') || []).filter(x => x !== id);
      store.set('dock', dockHas(id) ? list : [...list, id]);
    }

    function appRow(app, sub) {
      const inDock = dockHas(app.id);
      return row({
        key: `app:${app.id}`,
        art: appGlyph(app),
        name: app.name,
        sub: sub || app.desc || '',
        tags: [tag(app.category || 'App', 'tag'), inDock ? tag('In the Dock', 'check', true) : null],
        actions: [
          act({ label: 'Open', ic: 'external-link', primary: true, run: () => api.openApp(app.id) }),
          act({ label: inDock ? 'Unpin' : 'Pin', ic: inDock ? 'minus' : 'pin', tip: inDock ? `Remove ${app.name} from the Dock` : `Keep ${app.name} in the Dock`, run: () => toggleDock(app.id) }),
        ],
      });
    }

    const appsFor = ids => ids.map(id => api.getApp(id)).filter(a => a && !a.hidden);
    function appItems() {
      const skip = new Set([...CREATOR, ...GAME_APPS, 'store']);
      return api.listApps().filter(a => !skip.has(a.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(a => appRow(a));
    }
    const creatorItems = () => appsFor(CREATOR).map(a => appRow(a));

    function themeItems() {
      const cur = THEMES.canonId(prefs().accent);
      const list = THEMES.THEMES.map(t => row({
        key: `theme:${t.id}`,
        on: cur === t.id,
        art: h('div.st-swatch', { style: { background: THEMES.swatch(t.id) } }),
        name: t.name,
        sub: t.note,
        tags: [cur === t.id ? tag('In use', 'check', true) : null],
        actions: [cur === t.id ? null : act({ label: 'Use', ic: 'palette', primary: true, run: () => { setPrefs({ accent: t.id }); } })],
      }));
      /* a custom hex accent is real too — show it so "In use" is never blank */
      if (THEMES.isHex(prefs().accent)) {
        list.unshift(row({
          key: 'theme:custom', on: true,
          art: h('div.st-swatch', { style: { background: THEMES.swatch(prefs().accent) } }),
          name: 'Your colour', sub: `${prefs().accent} — set in Settings › Themes.`,
          tags: [tag('In use', 'check', true)],
        }));
      }
      return list;
    }

    function modeSwitch() {
      const cur = prefs().theme === 'light' ? 'light' : 'dark';
      const b = (id, label, ic) => h(`button.st-seg__b${cur === id ? '.is-on' : ''}`, {
        type: 'button', 'aria-pressed': String(cur === id), onclick: () => { setPrefs({ theme: id }); paint(); },
      }, icon(ic), h('span', { text: label }));
      return h('div.st-modebar', h('span', { text: 'Appearance' }), h('div.st-seg', b('dark', 'Dark', 'moon'), b('light', 'Light', 'sun')),
        h('div.grow'), act({ label: 'Pick any colour', ic: 'sliders', run: () => api.openApp('settings', { section: 'themes' }) }));
    }

    function wallPreview(w) {
      const el = h('div.st-wall__art');
      if (w.poster) el.style.backgroundImage = `url("${w.poster}")`;
      else if (w.kind === 'css' && w.css) el.style.background = w.css;
      else if (w.kind === 'scene') el.classList.add('st-wall__art--scene');
      else if (w.kind === 'image' || w.kind === 'gif') el.style.backgroundImage = `url("${String(w.url).replace(/"/g, '%22')}")`;
      if (w.kind === 'video') el.appendChild(h('span.st-wall__kind', icon('play'), 'Moving'));
      return el;
    }

    function wallItems() {
      const cur = WP.active(store)?.id;
      return WP.list(store).map(w => {
        const on = cur === w.id;
        const theme = w.theme ? THEMES.themeById(w.theme) : null;
        return h(`div.st-wall${on ? '.is-on' : ''}`, { dataset: { item: `wp:${w.id}` } },
          wallPreview(w),
          h('div.st-wall__meta',
            h('div.grow',
              h('b', { text: w.name }),
              h('small', { text: w.blurb || (w.built ? 'Built in.' : w.code ? 'Unlocked with a code.' : 'Added by you.') }),
              theme ? h('div.st-tags', tag(`Brings ${theme.name}`, 'palette')) : null),
            on ? tag('In use', 'check', true)
              : act({ label: 'Use', ic: 'wallpaper', primary: true, run: () => { WP.setActive(store, w.id); } })));
      });
    }

    function redeemBox() {
      const input = h('input', { type: 'text', placeholder: 'Have a code?', spellcheck: 'false', 'aria-label': 'Wallpaper code', maxlength: '40' });
      const go2 = () => {
        const hit = WP.redeem(store, input.value);
        if (!hit) { note({ icon: 'x-circle', title: 'That code doesn’t unlock anything', message: 'Codes are case-insensitive.' }); return; }
        bus.emit('egg:found', { id: `code:${hit.id}` });
        note({ icon: 'wallpaper', title: `${hit.name} unlocked`, message: 'It’s in the list now.' });
        input.value = '';
        paint();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go2(); });
      return h('div.st-redeem', h('div.field', { style: { height: '28px' } }, icon('unlock'), input),
        h('button.btn.btn--sm', { type: 'button', onclick: go2 }, 'Redeem'),
        h('div.grow'),
        act({ label: 'Add your own', ic: 'plus', run: () => api.openApp('settings', { section: 'wallpaper' }) }));
    }

    function iconItems() {
      const cur = ICON_STYLES.some(s => s.id === prefs().iconStyle) ? prefs().iconStyle : 'glass';
      const sample = ['files', 'store', 'settings', 'music'].map(id => api.getApp(id)).filter(Boolean);
      return ICON_STYLES.map(s => row({
        key: `icons:${s.id}`,
        on: cur === s.id,
        art: h('div.st-look', { dataset: { icons: s.id } }, sample.slice(0, 3).map(a => appGlyph(a, 26))),
        name: s.name,
        sub: s.note,
        tags: [cur === s.id ? tag('In use', 'check', true) : null],
        actions: [cur === s.id ? null : act({ label: 'Use', ic: 'diamond', primary: true, run: () => setPrefs({ iconStyle: s.id }) })],
      }));
    }

    function widgetItems() {
      return WIDGET_CATALOG.map(w => {
        const on = !widgetHidden(store, w.id);
        return row({
          key: `widget:${w.id}`,
          on,
          art: glyph(w.icon, { '--g1': 'var(--kind-config, #7dd3fc)', '--g2': 'var(--bg-2, #111)' }),
          name: w.name,
          sub: w.desc,
          tags: [on ? tag('In the rail', 'check', true) : null],
          actions: [act({
            label: on ? 'Remove' : 'Add', ic: on ? 'minus' : 'plus', primary: !on,
            run: () => {
              setWidgetHidden(store, w.id, on);
              if (!on && !prefs().widgetsVisible) setPrefs({ widgetsVisible: true });
            },
          })],
        });
      });
    }

    function deskWidgetItems() {
      if (!DESK) return [h('div.dim', { text: 'Loading…' })];
      return DESK.DESK_WIDGETS.map(d => {
        const n = DESK.deskWidgetCount(d.type);
        return row({
          key: `deskwidget:${d.type}`,
          on: n > 0,
          art: glyph(d.icon, { '--g1': '#fcd34d', '--g2': '#7c2d12' }),
          name: d.name, sub: d.desc,
          tags: [n ? tag(`${n} on the desktop`, 'check', true) : null],
          actions: [act({ label: 'Add to desktop', ic: 'plus', primary: !n, run: () => {
            if (!store.get('session.user')) { bus.emit('deskwidgets:picker'); return; }
            bus.emit('deskwidgets:add', d.type);
            note({ icon: 'layers', title: `${d.name} added`, message: 'It’s on your desktop — drag it by its title bar.' });
          } })],
        });
      });
    }

    function soundItems() {
      const cur = sfx.PACKS.some(p => p.id === prefs().soundPack) ? prefs().soundPack : 'glass';
      return sfx.PACKS.map(p => row({
        key: `sound:${p.id}`,
        on: cur === p.id,
        art: glyph(p.id === 'retro' ? 'gamepad' : p.id === 'mech' ? 'keyboard' : p.id === 'chime' ? 'bell' : p.id === 'soft' ? 'moon' : 'volume-2',
          { '--g1': 'var(--kind-audio, #f0abfc)', '--g2': 'var(--bg-2, #111)' }),
        name: p.name,
        sub: p.note,
        tags: [cur === p.id ? tag('In use', 'check', true) : null],
        actions: [
          act({ label: 'Listen', ic: 'play', tip: `Hear ${p.name}`, run: () => { if (!sfx.preview(p.id)) note({ icon: 'volume-x', title: 'Nothing to hear', message: 'Sound is muted or this browser has no audio.' }); } }),
          cur === p.id ? null : act({ label: 'Use', ic: 'check', primary: true, run: () => setPrefs({ soundPack: p.id, uiSounds: true }) }),
        ],
      }));
    }

    const layoutMatches = L => Object.entries(L.prefs).every(([k, v]) => {
      const p = prefs();
      const d = { desktopIcons: true, widgetsVisible: true, desktopClock: true, dockMagnify: true, gameModeAuto: false };
      return (p[k] === undefined ? d[k] : p[k]) === v;
    }) && (L.widgets || []).every(id => !widgetHidden(store, id));
    /* Player contains everything Everything asks for, so when several match
       the most specific one is the layout in use */
    const layoutOn = L => {
      const hits = LAYOUTS.filter(layoutMatches);
      const weight = x => Object.keys(x.prefs).length + (x.widgets || []).length;
      return hits.length > 0 && hits.reduce((a, b) => (weight(b) > weight(a) ? b : a)) === L;
    };

    function layoutArt(L) {
      const p = L.prefs;
      return h('div.st-lay', { 'aria-hidden': 'true' },
        p.desktopIcons ? h('div.st-lay__icons', h('i'), h('i'), h('i')) : null,
        p.desktopClock ? h('div.st-lay__clock') : null,
        p.widgetsVisible ? h('div.st-lay__rail', h('i'), h('i'), L.widgets ? h('i.is-acc') : h('i')) : null,
        h('div.st-lay__dock'));
    }

    function applyLayout(L) {
      setPrefs(L.prefs);
      if (L.widgets) {
        L.widgets.forEach(id => setWidgetHidden(store, id, false));
        /* ...and first in the rail: layout() appends any id missing from `order` */
        const raw = store.get('prefs.widgetLayout') || {};
        const order = Array.isArray(raw.order) ? raw.order.filter(id => !L.widgets.includes(id)) : [];
        store.set('prefs.widgetLayout', { order: [...L.widgets, ...order], hidden: [...(raw.hidden || [])], h: { ...(raw.h || {}) } });
      }
      note({ icon: 'desktop', title: `${L.name} layout`, message: 'Your desktop has been rearranged. Settings › Desktop has every switch.' });
    }

    function layoutItems() {
      return LAYOUTS.map(L => {
        const on = layoutOn(L);
        return row({
          key: `layout:${L.id}`, on,
          art: layoutArt(L),
          name: L.name, sub: L.note,
          tags: [on ? tag('In use', 'check', true) : null, L.prefs.gameModeAuto ? tag('Auto Game Mode', 'gamepad') : null],
          actions: [on ? null : act({ label: 'Use', ic: 'desktop', primary: true, run: () => applyLayout(L) })],
        });
      });
    }

    const LABS = [
      { key: 'labStaticumAI', name: 'Staticum answers anything', icon: 'sparkles', note: 'Questions no skill covers go to the free AI model instead of a shrug.' },
      { key: 'labFps', name: 'Frame-rate counter', icon: 'gauge', note: 'A small, measured fps reading in the corner of the screen.' },
      { key: 'labCompact', name: 'Compact title bars', icon: 'window', note: 'Thinner window title bars, for more room on small screens.' },
    ];
    function labItems() {
      return LABS.map(l => {
        const on = !!prefs()[l.key];
        return row({
          key: `lab:${l.key}`, on,
          art: glyph(l.icon, { '--g1': '#fde68a', '--g2': '#78350f' }),
          name: l.name, sub: l.note,
          tags: [tag('Experimental', 'zap'), on ? tag('On', 'check', true) : null],
          actions: [act({ label: on ? 'Turn off' : 'Try it', primary: !on, run: () => setPrefs({ [l.key]: !on }) })],
        });
      });
    }

    async function loadCommunity() {
      try {
        const P = await import('../core/projects.js');
        const list = await P.list();
        community = list.filter(p => p.published);
      } catch (e) { community = []; }
      if (!dead && (S.sec === 'Community' || S.sec === 'Discover')) paint();
    }
    function communityItems() {
      return (community || []).map(p => row({
        key: `creation:${p.id}`,
        art: glyph('sparkles', { '--g1': '#a78bfa', '--g2': '#4c1d95' }),
        name: p.published?.title || p.name,
        sub: p.published?.description || 'Made in Static Forge.',
        tags: [tag('Made here', 'user'), p.published?.category ? tag(p.published.category, 'tag') : null],
        actions: [act({ label: 'Play', ic: 'play', primary: true, disabled: !has('forge'), run: () => api.openApp('forge', { project: p.id }) })],
        menu: () => [
          { label: 'Open in Forge', icon: 'sparkles', disabled: !has('forge'), onClick: () => api.openApp('forge', { project: p.id }) },
          { label: 'Add to Desktop', icon: 'monitor', onClick: () => addShortcut({ kind: 'creation', id: p.id, title: p.published?.title || p.name }) },
          { label: 'Share…', icon: 'share', onClick: () => bus.emit('share:open', { kind: 'creation', id: p.id, title: p.published?.title || p.name }) },
        ],
      }));
    }

    /* ============== sections ============== */
    function heroBlock() {
      const top = Array.isArray(changelog) ? changelog[0] : null;
      return h('div.store__hero.st-hero',
        h('div.st-hero__glow'),
        h('div.row', { style: { gap: 'var(--sp-5)', alignItems: 'flex-start', position: 'relative' } },
          h('div.glyph', { style: { '--gs': '56px', '--g1': 'var(--accent-soft)', '--g2': 'var(--aether-800, #3b0716)' } }, icon('diamond')),
          h('div.grow',
            h('div.st-hero__kicker', { text: top ? 'New in this version' : 'StaticOS' }),
            h('h3', { text: top ? `StaticOS ${top.version}${top.name ? ` — ${top.name}` : ''}` : 'Everything on this computer' }),
            h('p', { text: top?.summary || 'Games, apps, looks and sounds. Nothing to download: it is all already here.' }),
            h('div.row', { style: { gap: 'var(--sp-3)', marginTop: 'var(--sp-5)', flexWrap: 'wrap' } },
              has('play') ? act({ label: 'Open Static Play', ic: 'gamepad', primary: true, run: () => api.openApp('play') }) : null,
              has('whatsnew') ? act({ label: 'What’s new', ic: 'sparkles', run: () => api.openApp('whatsnew') }) : null,
              has('forge') ? act({ label: 'Make a game', ic: 'wrench', run: () => api.openApp('forge') }) : null))));
    }

    function pickSome(arr, n, seed) {
      /* stable for the day, so Discover doesn't reshuffle on every repaint */
      const out = [...arr];
      let s = seed;
      for (let i = out.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out.slice(0, n);
    }

    function paintDiscover() {
      const day = Math.floor(Date.now() / 86400000);
      content.append(...[
        heroBlock(),
        shelf('Play something', pickSome(gameItems(), 4, day), 'Games'),
        community?.length ? shelf('Made on this computer', communityItems().slice(0, 4), 'Community') : null,
        shelf('Make things', creatorItems().slice(0, 4), 'Creator tools'),
        shelf('Change the look', [...pickSome(themeItems(), 2, day + 1), ...pickSome(iconItems(), 1, day + 2), ...pickSome(soundItems(), 1, day + 3)], 'Themes'),
      ].filter(Boolean));
      /* wallpapers get picture tiles, not rows */
      const walls = h('div.st-walls', pickSome(wallItems(), 3, day + 4));
      content.append(h('section.st-shelf',
        h('div.st-shelf__head', h('div.label', { text: 'Wallpapers' }), h('div.grow'),
          h('button.st-more', { type: 'button', onclick: () => go('Wallpapers') }, h('span', { text: 'See all' }), icon('chevron-right'))),
        walls));
      if (community === null) loadCommunity();
    }

    function paintCommunity() {
      if (community === null) { content.appendChild(h('div.st-loading', h('div.spinner'), h('span', { text: 'Looking for published games…' }))); loadCommunity(); return; }
      if (community.length) content.appendChild(grid(communityItems()));
      else content.appendChild(empty('sparkles', 'Nothing published on this computer yet',
        'Games you publish from Static Forge show up here.',
        has('forge') ? h('div', { style: { marginTop: 'var(--sp-4)' } }, act({ label: 'Open Static Forge', ic: 'wrench', primary: true, run: () => api.openApp('forge') })) : null));
      content.appendChild(h('p.st-foot', { text: 'Other people’s games need a server to share through, and StaticOS doesn’t have one. To pass a game on, export it from Static Forge and send the file.' }));
    }

    async function loadUpdates() {
      const get = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const [c, b] = await Promise.all([changelog ? changelog : get('data/changelog.json'), build ? build : get('build.json')]);
      changelog = Array.isArray(c) ? c : [];
      build = b || {};
      if (!dead && (S.sec === 'Updates' || S.sec === 'Discover')) paint();
    }

    function paintUpdates() {
      if (!changelog) { content.appendChild(h('div.st-loading', h('div.spinner'), h('span', { text: 'Reading the release notes…' }))); return; }
      const top = changelog[0];
      content.append(h('div.card.st-upd',
        h('div.row', { style: { gap: 'var(--sp-4)' } },
          glyph('diamond', { '--g1': 'var(--accent-soft)', '--g2': 'var(--aether-800, #3b0716)' }, 48),
          h('div.grow',
            h('b', { text: top ? `StaticOS ${top.version}${top.name ? ` — ${top.name}` : ''}` : 'StaticOS' }),
            h('small', { text: build?.build ? `Build ${build.build}${build.built ? ` · ${new Date(build.built).toLocaleString()}` : ''}` : 'Build information unavailable.' })),
          act({ label: 'Check now', ic: 'refresh', primary: true, run: () => bus.emit('update:check') }))),
        h('p.st-foot', { text: 'StaticOS updates itself: when a newer build is published, a notice offers to restart into it. Apps, themes and wallpapers update with it — there is nothing to install one by one.' }));
      if (changelog.length) {
        content.appendChild(h('div.label', { text: 'Release history', style: { margin: 'var(--sp-5) 0 var(--sp-3)' } }));
        content.appendChild(h('div.st-rel', changelog.map(r => h('button.st-rel__i', { type: 'button', onclick: () => api.openApp('whatsnew') },
          h('span.st-rel__v', { text: r.version }),
          h('span.grow', h('b', { text: r.name || `StaticOS ${r.version}` }), h('small', { text: r.summary || '' })),
          h('small.st-rel__d', { text: r.date || '' })))));
      }
    }

    function paintInUse() {
      const p = prefs();
      const t = THEMES.themeById(THEMES.canonId(p.accent));
      const w = WP.active(store);
      const ic = ICON_STYLES.find(s => s.id === p.iconStyle) || ICON_STYLES[0];
      const sp = sfx.PACKS.find(s => s.id === p.soundPack) || sfx.PACKS[0];
      const L = LAYOUTS.find(layoutOn);
      const tile = (label, value, sec, art) => h('button.st-use', { type: 'button', onclick: () => go(sec) },
        art, h('span.grow', h('small', { text: label }), h('b', { text: value })), icon('chevron-right'));
      content.appendChild(h('div.st-uses',
        tile('Theme', `${t.name}${p.theme === 'light' ? ' · Light' : ''}`, 'Themes', h('div.st-swatch.st-swatch--sm', { style: { background: THEMES.swatch(t.id) } })),
        tile('Wallpaper', w?.name || '—', 'Wallpapers', glyph('wallpaper', { '--g1': '#93c5fd', '--g2': '#1e3a8a' }, 30)),
        tile('Icons', ic.name, 'Icons', glyph('diamond', { '--g1': '#c4b5fd', '--g2': '#4c1d95' }, 30)),
        tile('Sounds', p.uiSounds === false ? `${sp.name} · off` : sp.name, 'Sounds', glyph('volume-2', { '--g1': '#f0abfc', '--g2': '#701a75' }, 30)),
        tile('Layout', L ? L.name : 'Your own', 'Layouts', glyph('desktop', { '--g1': '#86efac', '--g2': '#14532d' }, 30)),
        tile('Labs', `${LABS.filter(l => p[l.key]).length} on`, 'Labs', glyph('zap', { '--g1': '#fde68a', '--g2': '#78350f' }, 30))));

      content.appendChild(shareCard());

      const dock = appsFor(store.get('dock') || []);
      if (dock.length) content.appendChild(shelf(`In your Dock · ${dock.length}`, dock.map(a => appRow(a))));
      const ws = WIDGET_CATALOG.filter(x => !widgetHidden(store, x.id));
      content.appendChild(h('section.st-shelf',
        h('div.st-shelf__head', h('div.label', { text: `In the widget rail · ${ws.length}` }), h('div.grow'),
          h('button.st-more', { type: 'button', onclick: () => go('Widgets') }, h('span', { text: 'Change' }), icon('chevron-right'))),
        h('div.st-chips', ws.map(x => tag(x.name, x.icon)))));
    }

    /* ---------------- share your look ---------------- */
    function describeLook(L) {
      const out = [];
      if (L.accent) out.push(`Theme: ${THEMES.themeById(L.accent).name}${THEMES.isHex(L.accent) ? ` (${L.accent})` : ''}`);
      if (L.theme) out.push(`Appearance: ${L.theme === 'light' ? 'Light' : 'Dark'}`);
      if (L.wallpaper) out.push(`Wallpaper: ${L.wallpaper.id ? (WP.byId(store, L.wallpaper.id)?.name || L.wallpaper.id) : `${L.wallpaper.name} (from ${new URL(L.wallpaper.url).hostname})`}`);
      if (L.iconStyle) out.push(`Icons: ${ICON_STYLES.find(s => s.id === L.iconStyle).name}`);
      if (L.soundPack) out.push(`Sounds: ${sfx.PACKS.find(x => x.id === L.soundPack).name}`);
      if (L.prefs && Object.keys(L.prefs).length) {
        const on = k => (L.prefs[k] === false ? 'off' : 'on');
        out.push(`Desktop: icons ${on('desktopIcons')}, widgets ${on('widgetsVisible')}, clock ${on('desktopClock')}`);
      }
      return out;
    }

    function applyLook(L) {
      const before = { prefs: { ...prefs() }, wallpaper: store.get('wallpaper') };
      const patch = { ...(L.prefs || {}) };
      if (L.accent) patch.accent = L.accent;
      if (L.theme) patch.theme = L.theme;
      if (L.iconStyle) patch.iconStyle = L.iconStyle;
      if (L.soundPack) patch.soundPack = L.soundPack;
      setPrefs(patch);
      if (L.wallpaper?.id) WP.setActive(store, L.wallpaper.id);
      else if (L.wallpaper?.url) {
        const existing = WP.custom(store).find(w => w.url === L.wallpaper.url);
        const w = existing || WP.add(store, { name: L.wallpaper.name, url: L.wallpaper.url, kind: L.wallpaper.kind, by: 'look code' });
        WP.setActive(store, w.id);
      }
      /* the accent of a paired wallpaper must not override the code's own accent */
      if (L.accent) setPrefs({ accent: L.accent });
      note({ icon: 'sparkles', title: 'Look applied', message: describeLook(L).join(' · '), timeout: 8000,
        actions: [{ label: 'Undo', onClick: () => { store.set('prefs', before.prefs); if (before.wallpaper) store.set('wallpaper', before.wallpaper); } }] });
    }

    function shareCard() {
      const mine = encodeLook(store);
      const out = h('input.st-code', { type: 'text', readonly: true, value: mine, 'aria-label': 'Your look code', onfocus: e => e.target.select() });
      const paste = h('input.st-code', { type: 'text', placeholder: 'Paste a look code (SLOOK1.…)', spellcheck: 'false', 'aria-label': 'A look code to try' });
      const preview = h('div.st-lookprev', { 'aria-live': 'polite' });
      let pending = null;
      const check = () => {
        clear(preview); pending = null;
        const v = paste.value.trim();
        if (!v) return;
        try {
          pending = decodeLook(v);
          preview.append(h('div.st-lookprev__h', { text: 'This code will change:' }),
            h('ul', describeLook(pending).map(t => h('li', { text: t }))),
            h('div.row', { style: { gap: '6px', marginTop: '8px' } },
              h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => { const L = pending; S.paste = ''; paste.value = ''; clear(preview); applyLook(L); } }, icon('check'), 'Apply'),
              h('button.btn.btn--sm', { type: 'button', onclick: () => { S.paste = ''; paste.value = ''; clear(preview); } }, 'Cancel')));
        } catch (err) {
          preview.appendChild(h('div.st-lookprev__err', icon('alert'), h('span', { text: err.message })));
        }
      };
      /* a repaint (another window changing a setting) must not lose a pasted code */
      paste.addEventListener('input', () => { S.paste = paste.value; check(); });
      if (opts?.look && !S.lookShown) { S.lookShown = true; S.paste = String(opts.look); }
      if (S.paste) { paste.value = S.paste; check(); }
      return h('section.st-share',
        h('div.st-share__col',
          h('div.label', { text: 'Share your look' }),
          h('p.st-foot', { style: { marginTop: '4px' }, text: 'Your theme, wallpaper, icons, sounds and desktop layout as one code. Send it to a friend — there’s no server, so the code is the whole thing.' }),
          h('div.row', { style: { gap: '6px' } }, out,
            h('button.btn.btn--sm', { type: 'button', onclick: async () => {
              try { await navigator.clipboard.writeText(mine); note({ icon: 'copy', title: 'Look code copied' }); }
              catch (e) { out.focus(); out.select(); note({ icon: 'alert', title: 'Copy it by hand', message: 'The clipboard isn’t available here — the code is selected.' }); }
            } }, icon('copy'), 'Copy'))),
        h('div.st-share__col',
          h('div.label', { text: 'Try someone’s look' }),
          h('p.st-foot', { style: { marginTop: '4px' }, text: 'You’ll see exactly what changes before anything does, and you can undo it.' }),
          paste, preview));
    }

    /* every searchable item, built fresh (cheap: a few dozen rows) */
    function searchable() {
      return [
        ...gameItems(), ...communityItems(), ...appItems(), ...creatorItems(), ...labItems(),
        ...themeItems(), ...wallItems(), ...iconItems(), ...widgetItems(), ...soundItems(), ...layoutItems(),
      ];
    }

    const COUNT = {
      Games: () => `${ARCADE.length} built-in games`,
      Apps: () => `${appItems().length} apps`,
      'Creator tools': () => `${creatorItems().length} tools`,
      Themes: () => `${THEMES.THEMES.length} themes`,
      Wallpapers: () => `${WP.list(store).length} wallpapers`,
      Icons: () => `${ICON_STYLES.length} styles`,
      Widgets: () => `${WIDGET_CATALOG.filter(w => !widgetHidden(store, w.id)).length} of ${WIDGET_CATALOG.length} in the rail`,
      Sounds: () => `${sfx.PACKS.length} sound packs`,
      Layouts: () => `${LAYOUTS.length} layouts`,
      Labs: () => `${LABS.filter(l => prefs()[l.key]).length} of ${LABS.length} on`,
      Community: () => (community ? `${community.length} published here` : ''),
    };

    function paintSection() {
      switch (S.sec) {
        case 'Discover': return paintDiscover();
        case 'Games': return content.appendChild(grid(gameItems()));
        case 'Community': return paintCommunity();
        case 'Apps': return content.appendChild(grid(appItems()));
        case 'Creator tools': {
          const items = creatorItems();
          return content.append(items.length ? grid(items) : empty('wrench', 'No creator tools yet', 'They arrive with the next StaticOS update.'));
        }
        case 'Labs':
          content.appendChild(banner('zap', 'Experiments that work but aren’t the default yet. Every one is a single switch — turn it off again any time.'));
          return content.appendChild(grid(labItems()));
        case 'Themes':
          content.appendChild(modeSwitch());
          return content.appendChild(grid(themeItems()));
        case 'Wallpapers':
          content.appendChild(redeemBox());
          return content.appendChild(h('div.st-walls', wallItems()));
        case 'Icons': return content.appendChild(grid(iconItems()));
        case 'Widgets':
          if (!store.get('session.user')) {
            content.appendChild(banner('user', 'Widgets show on the desktop once you’re signed in.',
              h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => bus.emit('account:open', 'in') }, 'Sign in')));
          } else if (!prefs().widgetsVisible) {
            content.appendChild(banner('layers', 'The widget rail is hidden right now.',
              act({ label: 'Show it', primary: true, run: () => setPrefs({ widgetsVisible: true }) })));
          }
          content.appendChild(h('div.label', { text: 'In the widget rail', style: { margin: '0 0 var(--sp-3)' } }));
          content.appendChild(grid(widgetItems()));
          content.appendChild(h('div.label', { text: 'On the desktop — drag them anywhere, resize from the corner', style: { margin: 'var(--sp-6) 0 var(--sp-3)' } }));
          return content.appendChild(grid(deskWidgetItems()));
        case 'Sounds':
          if (prefs().muted) content.appendChild(banner('volume-x', 'Sound is muted, so you won’t hear the previews.'));
          else if (prefs().uiSounds === false) content.appendChild(banner('volume-x', 'Interface sounds are off. Choosing a pack turns them back on.'));
          return content.appendChild(grid(soundItems()));
        case 'Layouts': return content.appendChild(grid(layoutItems()));
        case 'Updates': return paintUpdates();
        case 'In use': return paintInUse();
        default: return null;
      }
    }

    /* ---------------- nav ------------------ */
    const clearQ = () => { if (S.q) { S.q = ''; search.value = ''; } };
    function go(sec) {
      const c = canonSec(sec);
      if (!c || (c === S.sec && !S.q)) return;
      S.back.push(S.sec); S.fwd.length = 0;
      S.sec = c; clearQ();
      paint(true);
    }
    function goBack() { if (S.back.length) { S.fwd.push(S.sec); S.sec = S.back.pop(); clearQ(); paint(true); } }
    function goFwd() { if (S.fwd.length) { S.back.push(S.sec); S.sec = S.fwd.pop(); clearQ(); paint(true); } }

    /* ---------------- paint ---------------- */
    function paintSide() {
      clear(side);
      let group = null, last = '';
      for (const s of SECTIONS) {
        if (s.group !== last) {
          last = s.group;
          group = h('div.side__group', h('div.side__label', { text: s.group }));
          side.appendChild(group);
        }
        const item = h('button.side__item', { type: 'button', onclick: () => go(s.id), 'aria-current': s.id === S.sec && !S.q ? 'page' : null },
          icon(s.icon), h('span', { text: s.id }));
        if (s.id === S.sec && !S.q) item.classList.add('is-on');
        group.appendChild(item);
      }
      const u = store.get('session.user', null);
      side.appendChild(h('div.side__group',
        h('div.side__label', { text: 'Account' }),
        h('div.side__meter',
          h('b', { text: u ? u.name : 'Not signed in' }),
          h('small', { text: u ? `@${u.username} · on this device` : 'Sign in from the bottom-right corner.' }))));
    }

    function paint(resetScroll) {
      if (dead) return;
      const keep = resetScroll ? 0 : content.scrollTop;
      paintSide();
      clear(content);
      if (S.q) {
        const q = S.q;
        /* match on what an item is called and says, not on its button labels */
        const hits = searchable().filter(el => (el.querySelector('.st-item__body, .st-wall__meta')?.textContent || '').toLowerCase().includes(q));
        secTitle.textContent = 'Search';
        secCount.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'} for “${q}”`;
        const rows = hits.filter(el => !el.classList.contains('st-wall'));
        const walls = hits.filter(el => el.classList.contains('st-wall'));
        if (!hits.length) content.appendChild(empty('search', 'No matches', `Nothing in the Store matches “${q}”.`));
        if (rows.length) content.appendChild(grid(rows));
        if (walls.length) content.appendChild(h('div.st-walls', { style: { marginTop: 'var(--sp-5)' } }, walls));
      } else {
        secTitle.textContent = S.sec;
        secCount.textContent = COUNT[S.sec]?.() || '';
        paintSection();
      }
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
      content.scrollTop = keep;
    }

    paint(true);
    loadUpdates();
    win.setSubtitle('StaticOS catalogue');
    win.onReopen(o => {
      const c = canonSec(o?.section);
      if (c) { S.sec = c; clearQ(); }
      paint(true);
    });

    /* anything the Store shows can change from elsewhere (Settings, the
       rail's own menu, another window) — repaint rather than go stale */
    let queued = 0;
    const soon = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; paint(); }); };
    /* prefs also carries things the Store never shows (the notification
       log is written on every notification), so only a change to a pref
       the Store displays repaints it */
    const SHOWN = ['accent', 'theme', 'iconStyle', 'soundPack', 'uiSounds', 'muted', 'desktopIcons', 'widgetsVisible',
      'desktopClock', 'dockMagnify', 'gameModeAuto', 'widgetLayout', 'labStaticumAI', 'labFps', 'labCompact'];
    const sig = () => { const p = prefs(); return JSON.stringify(SHOWN.map(k => p[k])); };
    let lastSig = sig();
    const onPrefs = () => { const n = sig(); if (n !== lastSig) { lastSig = n; soon(); } };
    const offs = [
      store.sub('prefs', onPrefs), store.sub('dock', soon), store.sub('wallpaper', soon), store.sub('prefs.deskWidgets', soon),
      store.sub('portal.wallpapers', soon), store.sub('session.user', soon),
      bus.on('projects:change', () => { community = null; if (S.sec === 'Community' || S.sec === 'Discover') loadCommunity(); }),
    ];

    return () => {
      dead = true;
      cancelAnimationFrame(queued);
      offs.forEach(f => { try { f?.(); } catch (e) {} });
    };
  },
});
