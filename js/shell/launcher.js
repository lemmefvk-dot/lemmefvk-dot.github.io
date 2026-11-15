/* ============================================================
   launcher.js — the start menu
   search (apps + files) · pinned grid · all-apps sheet ·
   recents · user footer. Opens on bus 'launcher:toggle',
   closes on 'launcher:close', Escape or an outside pointerdown.

   Two looks, chosen in Settings > Dock (prefs.launcherStyle):
     panel  the default: pinned grid, with an All apps sheet
     start  a Start menu: every app in a list down the left, the
            pinned grid and recent files on the right, opening from
            the bottom-left corner above the Dock or taskbar
   Same search, same keys, same apps; only the arrangement differs.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { listApps, categories } from '../core/registry.js';
import * as L from '../core/layers.js';
import { roving } from '../core/roving.js';
import { appTile } from '../core/appart.js';
import { addAppToDesktop } from '../core/shortcuts.js';
import * as WNB from '../core/wnbadge.js';
import { t as tr } from '../core/i18n.js';

const { h, icon, vfs, fmt, on, clear } = api;

/* pointerdowns inside these never close the panel */
const KEEP = '.launcher,.menu,.spot-wrap,.toast,.dock__item[data-app="launcher"],[data-launcher-toggle]';

export function mountLauncher(host) {
  const S = { q: '', all: false, sel: 0, hits: [] };
  let el = null, input = null, scroll = null;
  let dying = null, dieT = null;
  let release = null;            /* Escape layer + focus return (core/layers.js) */

  /* ---------------- open / close ---------------- */
  function openPanel() {
    if (el) return;
    S.q = ''; S.all = false; S.sel = 0;
    el = build();
    host.appendChild(el);
    /* a dialog: Tab stays inside, Escape closes it and focus goes back to
       whatever opened it (the dock's launcher button, usually) */
    release = L.push({ name: 'launcher', el, trap: true, close: closePanel });
    paint();
    input.focus();
  }

  /** Drop the fading-out panel — on its own timer, or early. */
  function reap() {
    clearTimeout(dieT);
    dieT = null;
    if (dying) { dying.remove(); dying = null; }
  }

  function closePanel() {
    if (!el) return;
    reap();                       /* a fast re-toggle must not leave two panels */
    dying = el;
    el = null; input = null; scroll = null;
    /* the fading panel must not keep focus (or eat keys) while it fades */
    dying.inert = true;
    release?.();
    release = null;
    dying.classList.add('is-closing');
    dieT = setTimeout(reap, 180);
  }

  const launch = fn => { closePanel(); fn(); };
  const startStyle = () => store.get('prefs.launcherStyle') === 'start';

  /* ---------------- chrome ---------------- */
  function build() {
    input = h('input', {
      type: 'search', placeholder: tr('Search apps, settings, files…'),
      spellcheck: 'false', 'aria-label': tr('Search apps, settings and files'),
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'launcher-results',
      oninput: e => { S.q = e.target.value; S.sel = 0; paint(); },
      onkeydown: onKey,
    });
    scroll = h('div.launcher__scroll');
    return h(`section.launcher${startStyle() ? '.launcher--start' : ''}`, { role: 'dialog', 'aria-label': startStyle() ? tr('Start menu') : tr('Launcher') },
      h('div.field.launcher__search', icon('search'), input),
      scroll,
      foot());
  }

  const flat = ic => h('div.glyph.glyph--flat', icon(ic));
  const shortPath = p => (p.startsWith(vfs.HOME) ? `~${p.slice(vfs.HOME.length)}` : p) || '/';

  function foot() {
    /* The signed-in account is who you actually are; the 'user' root is only
       the default StaticOS ships with. Reading just the latter made the
       launcher say "Static" while the dock, the lock screen and Settings all
       said the real name. */
    const acct = store.get('session.user');
    const base = store.get('user') || {};
    const user = {
      name: (acct && acct.name) || base.name || 'Static',
      initials: acct && acct.name
        ? acct.name.trim().charAt(0).toUpperCase()
        : (base.initials || (base.name || 'S').trim().charAt(0).toUpperCase()),
    };
    const openSettings = () => launch(() => api.openApp('settings'));
    const act = (ic, tip, fn) => h('button.ibtn.tip', {
      'data-tip': tip, 'aria-label': tip, onclick: fn,
    }, icon(ic));

    return h('div.launcher__foot',
      h('button.avatar', { 'aria-label': `${user.name || 'User'} account`, onclick: openSettings },
        user.initials || 'A'),
      h('button.launcher__user', { text: user.name || tr('Static'), onclick: openSettings }),
      h('div.launcher__acts',
        act('camera', tr('Screenshot'), () => { closePanel(); shoot(); }),
        act('lock', 'Lock', () => { closePanel(); bus.emit('power:lock'); }),
        act('power', tr('Power'), powerMenu)));
  }

  /** Same as Spotlight's "Take Screenshot": a real PNG of this tab, taken
      with the browser's permission (js/core/screenshot.js). The module is
      loaded with the launcher so the click can call take() synchronously —
      the browser only shows its "share this tab" prompt inside a gesture. */
  const shoot = (() => {
    let shot = null;
    const ready = import('../core/screenshot.js?v=ps5-cloud-proxy-v11').then(m => (shot = m));
    return function shoot() {
      return shot ? shot.take() : ready.then(m => m.take());
    };
  })();

  function powerMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    api.menu([
      { label: tr('Sleep'), icon: 'moon', onClick: () => { closePanel(); bus.emit('power:sleep'); } },
      { label: tr('Restart'), icon: 'refresh', onClick: () => { closePanel(); bus.emit('power:restart'); } },
      '-',
      { label: tr('Shut Down'), icon: 'power', danger: true,
        onClick: () => { closePanel(); bus.emit('power:shutdown'); } },
    ], r.left, r.top);
  }

  /* ---------------- paint ---------------- */
  function paint() {
    if (!scroll) return;
    clear(scroll);
    input?.setAttribute('aria-expanded', 'false');
    input?.removeAttribute('aria-activedescendant');
    if (S.q.trim()) paintSearch();
    else if (S.all) paintAll();
    else paintHome();
  }

  /* the Start menu: all the apps on the left, pinned and recent on the right */
  function paintStartHome() {
    const apps = listApps().filter(a => !a.hidden).slice().sort((a, b) => a.name.localeCompare(b.name));
    const list = h('div.stm__list', { role: 'group', 'aria-label': tr('All apps') });
    let letter = '';
    for (const app of apps) {
      const l = (app.name[0] || '#').toUpperCase();
      if (l !== letter) { letter = l; list.appendChild(h('div.stm__letter', { text: /[A-Z]/.test(l) ? l : '#' })); }
      list.appendChild(h('button.allapps__row', {
        style: { textAlign: 'left' },
        onclick: () => launch(() => api.openApp(app.id)),
        oncontextmenu: e => pinMenu(e, app),
      }, appTile(app), h('div.grow.col', h('b.trunc', { text: app.name }))));
    }
    roving(list, { items: '.allapps__row', orientation: 'vertical', wrap: false });
    scroll.append(h('div.stm',
      h('div.stm__apps', h('div.label', { text: tr('All apps · {length}', { length: apps.length }) }), list),
      h('div.stm__side',
        h('div.launcher__head', h('div.label', { text: tr('Pinned') })),
        pinGrid(4),
        h('div.launcher__head', h('div.label', { text: tr('Recommended') })),
        recGrid())));
  }

  function paintHome() {
    if (startStyle()) { paintStartHome(); return; }
    scroll.append(
      h('div.launcher__head',
        h('div.label', { text: tr('Pinned') }),
        h('button.launcher__all', { onclick: () => { S.all = true; paint(); } },
          tr('All'), icon('chevron-right'))),
      pinGrid(),
      h('div.launcher__head', h('div.label', { text: tr('Recommended') })),
      recGrid());
  }

  function pinGrid(cols = 5) {
    const grid = h('div.launcher__grid', { role: 'group', 'aria-label': tr('Pinned apps') });
    for (const app of listApps().filter(a => a.pinned)) {
      grid.appendChild(h('button.pin', {
        'aria-label': app.name,
        onclick: () => launch(() => api.openApp(app.id)),
        oncontextmenu: e => pinMenu(e, app),
      }, appTile(app), h('div.pin__name', { text: app.name }, app.id === 'whatsnew' ? WNB.mark(h) : null)));
    }
    if (!grid.children.length) grid.appendChild(h('small.dim', { text: tr('Nothing pinned yet.') }));
    /* one Tab stop, arrows in two dimensions — five to a row (shell.css) */
    roving(grid, { items: '.pin', orientation: 'grid', columns: () => cols });
    return grid;
  }

  function recGrid() {
    const box = h('div.launcher__recs', { role: 'group', 'aria-label': tr('Recent files') });
    for (const r of vfs.recent(6)) {
      box.appendChild(h('button.rec', {
        'aria-label': tr('Open {name}', { name: r.node.name }), style: { textAlign: 'left' },
        onclick: () => launch(() => api.openFile(r.path)),
      }, flat(vfs.iconFor(r.node)),
        h('div.rec__t.grow',
          h('div.rec__n', { text: r.node.name }),
          h('div.rec__m', { text: fmt.fmtAgo(r.node.mtime) }))));
    }
    if (!box.children.length) box.appendChild(h('small.dim', { text: tr('No recent files.') }));
    roving(box, { items: '.rec', orientation: 'grid', columns: () => 2 });
    return box;
  }

  function paintAll() {
    scroll.appendChild(h('div.launcher__head',
      h('button.launcher__all', { onclick: () => { S.all = false; paint(); } },
        icon('chevron-left'), tr('Back')),
      h('div.label', { text: `${listApps().length} apps` })));

    const sheet = h('div.allapps', { role: 'group', 'aria-label': tr('All apps') });
    for (const cat of categories()) {
      const list = h('div.allapps__list');
      for (const app of listApps({ category: cat })) {
        list.appendChild(h('button.allapps__row', {
          style: { textAlign: 'left' },
          onclick: () => launch(() => api.openApp(app.id)),
          oncontextmenu: e => pinMenu(e, app),
        }, appTile(app),
          h('div.grow.col',
            h('b.trunc', { text: app.name }, app.id === 'whatsnew' ? WNB.mark(h) : null),
            h('small.trunc', { text: app.desc || cat }))));
      }
      sheet.appendChild(h('div.allapps__cat', h('div.label', { text: cat }), list));
    }
    scroll.appendChild(sheet);
    /* every app, across categories, is one vertical list for the arrows */
    roving(sheet, { items: '.allapps__row', orientation: 'vertical', wrap: false });
  }

  function paintSearch() {
    S.hits = findHits(S.q.trim());
    if (!S.hits.length) {
      scroll.appendChild(h('div.empty', icon('search'),
        h('b', { text: tr('No results') }),
        h('small', { text: `Nothing matches “${S.q.trim()}”.` })));
      return;
    }
    S.sel = Math.min(Math.max(S.sel, 0), S.hits.length - 1);
    const list = h('div.allapps__list#launcher-results', { role: 'listbox', 'aria-label': tr('Results') });
    S.hits.forEach((hit, i) => list.appendChild(hitRow(hit, i)));
    scroll.appendChild(list);
    input?.setAttribute('aria-expanded', 'true');
    input?.setAttribute('aria-activedescendant', `launcher-hit-${S.sel}`);
  }

  function hitRow(hit, i) {
    const row = h('button.allapps__row', {
      id: `launcher-hit-${i}`, role: 'option', 'aria-selected': String(i === S.sel), tabindex: '-1',
      style: { textAlign: 'left', background: i === S.sel ? 'var(--fill-accent)' : null },
      onclick: hit.run,
      oncontextmenu: hit.app ? (e => pinMenu(e, hit.app)) : null,
    }, hit.app ? appTile(hit.app, { icon: hit.icon }) : flat(hit.icon),
      h('div.grow.col',
        h('b.trunc', { text: hit.name }),
        h('small.trunc', { text: hit.sub })));
    if (i === S.sel) requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
    return row;
  }

  /* Rank before capping at 8: results used to come back in registry order, so
     an app whose NAME matched could be pushed out of the list by apps that
     only matched a keyword or category ("forge" put Asset Lab above Static
     Forge). Name matches beat keyword matches, which beat category matches. */
  function scoreApp(a, t) {
    const name = a.name.toLowerCase();
    if (name === t) return 100;
    if (name.startsWith(t)) return 90;
    if (name.split(/[\s-]+/).some(w => w.startsWith(t))) return 80;
    if (name.includes(t)) return 60;
    const kw = a.keywords.map(k => k.toLowerCase());
    if (kw.includes(t)) return 40;
    if (kw.some(k => k.startsWith(t))) return 30;
    if (kw.some(k => k.includes(t))) return 20;
    if (a.category.toLowerCase().includes(t)) return 10;
    return 0;
  }

  function findHits(q) {
    const t = q.toLowerCase().trim();
    const hits = listApps()
      .map(a => ({ a, s: scoreApp(a, t) }))
      .filter(x => x.s > 0)
      .sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name))
      .map(x => x.a)
      .slice(0, 8)
      .map(app => ({ app, name: app.name, sub: tr('{category} · App', { category: app.category }), icon: app.icon,
        run: () => launch(() => api.openApp(app.id)) }));

    for (const f of vfs.search(q, { limit: 8 })) {
      hits.push({ name: f.node.name, sub: shortPath(vfs.parentPath(f.path)),
        icon: vfs.iconFor(f.node), run: () => launch(() => api.openFile(f.path)) });
    }
    return hits;
  }

  function pinMenu(e, app) {
    e.preventDefault();
    const dock = store.get('dock') || [];
    const inDock = dock.includes(app.id);
    api.menu([
      { label: tr('Open'), icon: 'external-link', onClick: () => launch(() => api.openApp(app.id)) },
      { label: inDock ? tr('Remove from Dock') : tr('Add to Dock'), icon: 'pin',
        onClick: () => store.set('dock', inDock ? dock.filter(id => id !== app.id) : [...dock, app.id]) },
      { label: tr('Add to Desktop'), icon: 'monitor', onClick: () => addAppToDesktop(app.id) },
      '-',
      /* a toggle, not a disabled row: right-clicking an unpinned app in the
         all-apps sheet was a dead end with no way back */
      { label: app.pinned ? tr('Unpin') : tr('Pin to Launcher'), icon: app.pinned ? 'x' : 'star',
        onClick: () => { app.pinned = !app.pinned; paint(); } },
    ], e.clientX, e.clientY);
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    const n = S.hits.length;
    /* no query: down-arrow walks from the search field into the grid */
    if (!S.q.trim() && e.key === 'ArrowDown' && scroll) {
      const first = scroll.querySelector('.pin[tabindex="0"], .allapps__row[tabindex="0"], .pin, .allapps__row');
      if (first) { e.preventDefault(); first.focus(); }
      return;
    }
    if (!S.q.trim() || !n) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); S.sel = (S.sel + 1) % n; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.sel = (S.sel - 1 + n) % n; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); S.hits[S.sel].run(); }
  }

  /* ---------------- wiring ---------------- */
  const offs = [
    bus.on('launcher:toggle', () => (el ? closePanel() : openPanel())),
    bus.on('launcher:close', closePanel),
    bus.on('spotlight:open', closePanel),
    bus.on('overview:toggle', closePanel),
    on(window, 'pointerdown', e => {
      if (!el) return;
      if (e.target instanceof Element && e.target.closest(KEEP)) return;
      closePanel();
    }, true),
  ];

  /* nothing unmounts the shell today; the handles are all here if it ever does */
  return () => { offs.forEach(off => off()); closePanel(); reap(); };
}

export default mountLauncher;
