/* ============================================================
   desktop.js — the layer under everything: the procedural
   wallpaper stack, the desktop icon grid and the desktop
   context menu. Mounted as the first child of #os.
   ============================================================ */
import { h, on } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as WP from '../portal/wallpapers.js';
import * as SEASON from '../core/season.js';
import * as deskterm from './deskterm.js';
import { launchItem } from '../core/launch.js';
import { ARCADE } from '../arcade/index.js';
import * as fileimport from '../core/fileimport.js';
import * as Desktops from '../core/desktops.js';
import * as ROTATE from '../core/wprotate.js';
import { appTile } from '../core/appart.js';
import * as L from '../core/layers.js';
import * as wm from '../core/wm.js';
import * as FS from '../core/deskfs.js';
import * as TB from './trashbin.js';
import { mountIconLayer, SIZES } from './deskicons.js';
import * as SAVER from '../core/datasaver.js';
import { t } from '../core/i18n.js';
import { appShortcutId, openAppShortcut } from '../core/shortcuts.js';
import { getApp } from '../core/registry.js';

const arcadeHue = new Map(ARCADE.map(g => [g.id, g.hue]));

const SHORTCUTS = [
  { id: 'drive', label: t('Static Drive'), icon: 'hard-drive', path: '/' },
  { id: 'home', label: t('Home'), icon: 'home', path: null },   /* null → vfs.HOME */
  { id: 'trash', label: t('Trash'), icon: 'trash', trash: true },
];

export function mountDesktop(host) {
  const { icon, vfs, fmt, clear } = api;
  const DESK = `${vfs.HOME}/Desktop`;

  /* ---------------- wallpaper ------------ */
  const grid = h('div.wp__grid');
  const grain = h('div.wp__grain');
  /* Layer order is depth order. The three added layers are the ones the
     brief asks for and the scene was missing: a second star plane so the
     sky has parallax of its own, a slow aurora for the "faint red
     atmospheric lighting", and the planet's reflection in the water —
     which is what makes the lake read as water rather than a dark band. */
  const wp = h('div.wp',
    h('div.wp__sky'),
    h('div.wp__stars'),
    h('div.wp__stars2'),
    h('div.wp__aurora'),
    h('div.wp__planet'),
    h('div.wp__haze'),
    h('div.wp__ridge', h('i'), h('i'), h('i')),
    h('div.wp__lake', h('i.wp__reflect')),
    h('div.wp__vig'),
  );

  /* The procedural scene and a media wallpaper are mutually exclusive: when a
     video/gif/image is chosen the scene layers come out entirely, so nothing
     is painted underneath it for no reason. */
  const SCENE = ['.wp__sky', '.wp__stars', '.wp__stars2', '.wp__aurora',
    '.wp__planet', '.wp__haze', '.wp__ridge', '.wp__lake'];
  let painted = '';
  let fadeNext = false;
  let crossNext = false;
  const MEDIA = ':scope > .wp__video, :scope > .wp__still, :scope > .wp__img, :scope > .wp__preset, :scope > .wp__day, :scope > .wp__live';

  /* Spooky season (js/core/season.js): the haunted house stands in for
     whatever wallpaper is chosen, in three layers that take the same
     parallax as the scene. Opaque, so the scene and any media under it are
     taken out rather than painted (or decoded) for nobody. Drawn by
     tools/spooky-art.mjs; styled in css/feat-spooky.css. */
  const spookyWp = h('div.wp__spooky', { 'aria-hidden': 'true' },
    h('i.wp__spooky-sky'), h('i.wp__spooky-house'), h('i.wp__spooky-fog'), h('i.wp__spooky-front'));
  /* ...and in winter the snowy village does (tools/winter-art.mjs, css/feat-winter.css) */
  const winterWp = h('div.wp__winter', { 'aria-hidden': 'true' },
    h('i.wp__winter-sky'), h('i.wp__winter-village'), h('i.wp__winter-front'));
  const SEASON_WP = { spooky: spookyWp, winter: winterWp };

  /* a desktop can have a wallpaper of its own (overview › right-click a
     desktop › Wallpaper); the rest share the one chosen in Settings */
  const deskPaper = () => {
    const id = Desktops.wallpaperOf();
    return id ? WP.byId(store, id) : null;
  };

  function paintLayers() {
    grid.remove(); grain.remove();

    /* this desktop's own, else rotation's picture (core/wprotate.js), else the chosen one */
    const chosen = deskPaper() || ROTATE.shown() || WP.active(store);
    /* the boot drive's skin only paints over the default (feat-boot.css) */
    document.body.dataset.wp = chosen ? chosen.id : '';
    /* ...and where it does, it is opaque: don't download and decode a 1080p
       loop nobody can see. bootpicker sets data-drive (and asks for a
       repaint when it changes); before that, the saved choice decides. */
    const drive = document.body.dataset.drive || store.get('prefs.bootOS', 'plain');
    const season = Object.keys(SEASON_WP).find(id => document.documentElement.dataset[id] === 'on' && SEASON.part(id, 'wallpaper')) || null;
    const skinned = !season && (drive === 'linux' || drive === 'windows') && chosen?.id === 'canopy';
    const wantsMedia = !!chosen && chosen.kind !== 'scene' && !skinned && !season;

    for (const sel of SCENE) {
      const el = wp.querySelector(sel);
      if (el) el.style.display = wantsMedia || skinned || season ? 'none' : '';
    }
    for (const [id, el] of Object.entries(SEASON_WP)) {
      if (id === season && !el.isConnected) wp.insertBefore(el, wp.querySelector('.wp__vig'));
      else if (id !== season) el.remove();
    }
    /* Settings fires both the store change and 'wallpaper:changed' for one
       pick — build the (possibly 1080p) layer once. A video that fell back
       to its GIF has replaced itself, so look at what is actually in .wp. */
    const key = `${chosen?.id}|${wantsMedia}|${SAVER.on()}`;
    if (key !== painted || (wantsMedia && !wp.querySelector(MEDIA))) {
      const old = [...wp.querySelectorAll(MEDIA)];
      /* rotation cross-fades: the old picture stays under the new one until
         it has faded in (not under reduced motion — that is a cut) */
      const cross = crossNext && !!painted && old.length > 0 && !reduced();
      if (!cross) old.forEach(n => n.remove());
      const media = wantsMedia ? WP.mediaLayer(chosen, h) : null;
      if (media) {
        /* a desktop switch that changes the wallpaper fades the new one in */
        if (painted && fadeNext) media.classList.add('wp-in');
        if (cross) old[old.length - 1].after(media); else wp.insertBefore(media, wp.firstChild);
      }
      if (cross) {
        const done = () => old.forEach(n => n.remove());
        /* fade the new one in over the old — or, back to the drawn scene, the old one out */
        const a = media ? media.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1400, easing: 'ease-in-out' })
          : old[old.length - 1].animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1400, easing: 'ease-in-out', fill: 'forwards' });
        (media || old[old.length - 1]).classList.add('wp-xfade');
        a.finished.then(done, done);
        setTimeout(done, 2500);
      }
      painted = key;
      /* the auto accent (core/wpaccent.js) follows what the person chose to see */
      bus.emit('wallpaper:shown', chosen);
    }

    if (store.get('prefs.wallpaperGrid')) wp.appendChild(grid);
    if (store.get('prefs.wallpaperGrain')) wp.appendChild(grain);
  }

  /* ---------------- parallax ------------ *
   * The brief asks for the desktop to feel like a place rather than an
   * image behind the UI: "it should feel alive when you stare at it. It
   * should not look like a screensaver." So the layers shift by a few
   * pixels with the pointer and nothing else moves — the planet drifts
   * least because it reads as furthest away.
   *
   * Written to CSS custom properties rather than to each layer's style,
   * so one rAF writes once and the compositor does the rest. Off entirely
   * under reduced motion, and off on touch, where there is no hover to
   * drive it and the reads would cost battery for nothing.
   * ------------------------------------- */
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.body.classList.contains('reduce-motion');

  /* ---------------- ambient motion ------------
   * The drifting layers cost real frames. Measured on this page, same
   * machine, same run: 53 fps with the scene still, 35 with it moving —
   * and no single animation is to blame, it is the cumulative cost of
   * compositing several full-screen layers every frame.
   *
   * Section 25 of the brief says this has to stay usable on a weak school
   * machine, so rather than picking between "pretty" and "fast" for
   * everyone, the desktop measures the actual frame rate and decides. The
   * OS already counts real frames for the System Monitor; this just reads
   * the same counter.
   *
   * prefs.wallpaperMotion: 'auto' (default) | 'on' | 'off'
   * ------------------------------------- */
  const MOTION_KEY = 'prefs.wallpaperMotion';
  const VERDICT_KEY = 'session.wallpaperMotionOk';
  const FPS_FLOOR = 40;

  let motionSawReduced = false;      /* what the last applyMotion() went by (the 5 s tick below) */
  function applyMotion() {
    const mode = store.get(MOTION_KEY) || 'auto';
    motionSawReduced = reduced();
    if (motionSawReduced) { wp.classList.add('wp--still'); return; }
    if (mode === 'off') { wp.classList.add('wp--still'); return; }
    if (mode === 'on') { wp.classList.remove('wp--still'); return; }

    /* auto: trust a verdict already reached this session */
    const verdict = store.get(VERDICT_KEY);
    if (verdict === false) { wp.classList.add('wp--still'); return; }
    wp.classList.remove('wp--still');
    if (verdict === true) return;
    measureMotion();
  }

  /* One measurement per session. Samples while the scene is animating and
     turns it off if the machine cannot hold a reasonable rate — then says
     so once, because silently changing how the desktop looks is worse than
     a sentence explaining it. */
  let measuring = false;
  async function measureMotion() {
    if (measuring) return;
    measuring = true;
    try {
      const M = await import('../core/metrics.js');
      /* take our own claim: the sampler is reference-counted, so this keeps
         it alive for the measurement without disturbing anyone else's */
      M.start('motion-check');
      await new Promise(r => setTimeout(r, 4200));
      const samples = M.history().fps.slice(-3);
      M.stop('motion-check');
      if (!samples.length) return;

      const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      const ok = median >= FPS_FLOOR;
      store.set(VERDICT_KEY, ok);
      if (ok) return;

      wp.classList.add('wp--still');
      api.notify({
        app: 'Desktop', icon: 'gauge',
        title: t('Wallpaper motion turned off'),
        message: t('This machine was running at about {median} frames per second with it on. ', { median })
               + t('Turn it back on in Settings → Wallpaper if you would rather have it.'),
        timeout: 9000,
      });
    } catch (err) {
      /* a failed measurement must never cost you the wallpaper */
    } finally {
      measuring = false;
    }
  }

  /* bindParallax re-runs on every prefs change, so the previous pointer
     listener has to come off first — otherwise each visit to Settings
     leaves another one attached to window for the life of the page. */
  let offParallax = null;

  function bindParallax() {
    offParallax?.();
    offParallax = null;
    if (reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) {
      wp.style.removeProperty('--px');
      wp.style.removeProperty('--py');
      return;
    }
    let pending = false;
    let nx = 0;
    let ny = 0;
    const onMove = e => {
      if (document.documentElement.dataset.gamemode === 'on') return;   /* Game Mode: no parallax */
      nx = (e.clientX / innerWidth - 0.5) * 2;      /* -1 … 1 */
      ny = (e.clientY / innerHeight - 0.5) * 2;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        wp.style.setProperty('--px', nx.toFixed(3));
        wp.style.setProperty('--py', ny.toFixed(3));
      });
    };
    offParallax = on(window, 'pointermove', onMove, { passive: true });
  }

  /* ---------------- the clock on the wallpaper ----------------
   * Sits on the desktop itself, behind every window, so it is the first
   * thing on an empty screen and disappears under whatever you open. It
   * is decorative, not interactive: aria-hidden, no pointer events, and
   * the real accessible clock stays in the top bar where a screen reader
   * already expects it. */
  const clockDay = h('div.deskclock__day');
  const clockDate = h('div.deskclock__date');
  const clockTime = h('div.deskclock__time');
  /* Home (brief section 29): one quiet line under the clock that adapts
     to you — the game you played last, and Quick Play. Two small pills,
     never a wall of cards, and only real history: nothing shows until
     you have played something. It rides inside the clock so it shares
     its centring, its entrance and every rule that hides the clock
     (Game Mode, phone layout, the Linux desk terminal, the pref). The
     clock text stays aria-hidden; the pills are real buttons. */
  const deskHome = h('div.deskhome', { role: 'group', 'aria-label': t('Pick up where you left off') });
  const deskClock = h('div.deskclock',
    h('div.deskclock__face', { 'aria-hidden': 'true' }, clockDay, clockDate, clockTime),
    deskHome);

  const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function paintClock() {
    const now = new Date();
    clockDay.textContent = DAYS[now.getDay()];
    clockDate.textContent = `${now.getDate()} ${MONTHS[now.getMonth()]}, ${now.getFullYear()}.`;
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    clockTime.textContent = `- ${hh}:${mm} -`;
  }

  function applyClock() {
    const on = store.get('prefs.desktopClock') !== false;   // default on
    deskClock.hidden = !on;
    if (on) paintClock();
    paintHome();
  }

  const WEEK = 7 * 24 * 3600 * 1000;
  let homeKey = '';
  async function paintHome() {
    const want = store.get('prefs.desktopClock') !== false && store.get('prefs.deskHome') !== false;
    let last = null;
    if (want) {
      try {
        const P = await import('../core/plays.js');
        last = P.recent(1)[0] || null;
      } catch (e) { last = null; }
      if (last && !(Date.now() - (last.at || 0) < WEEK)) last = null;
    }
    const canQuick = want && !!(api.getApp('play') || api.getApp('arcade') || api.getApp('aether-games'));
    const key = `${want}|${last ? `${last.kind}:${last.id}` : ''}|${canQuick}`;
    if (key === homeKey) return;
    homeKey = key;
    clear(deskHome);
    deskHome.hidden = !want || (!last && !canQuick);
    if (deskHome.hidden) return;
    if (last) {
      const a = last.kind === 'arcade' ? ARCADE.find(g => g.id === last.id) : null;
      const art = last.art
        ? h('span.deskhome__art', { style: { backgroundImage: `url("${String(last.art).replace(/"/g, '%22')}")` } })
        : h('span.deskhome__art.deskhome__art--glyph', { style: a ? { '--hue': a.hue } : null }, icon(a ? a.icon : last.kind === 'creation' ? 'sparkles' : 'gamepad'));
      deskHome.appendChild(h('button.deskhome__pill', {
        type: 'button', title: t('Continue {title}', { title: last.title }),
        onclick: () => launchItem({ kind: last.kind, id: last.id, url: last.url }),
      }, art, h('span', { text: t('Continue ') }), h('b', { text: last.title })));
    }
    if (canQuick) {
      deskHome.appendChild(h('button.deskhome__pill.deskhome__pill--quick', {
        type: 'button', title: t('Pick a game for me'),
        onclick: async e => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const Q = await import('../core/quickplay.js');
            await Q.ready();
            const item = Q.pick({ avoidIds: last ? [last.id] : [] });
            if (item && Q.launch(item, api)) {
              api.notify({ app: t('Quick Play'), icon: 'zap', timeout: 4500, title: item.title, message: item.reason });
            }
          } catch (err) {
            api.notify({ app: t('Quick Play'), icon: 'alert', title: t('Quick Play couldn’t pick'), message: String(err?.message || err) });
          } finally { btn.disabled = false; }
        },
      }, icon('zap'), h('span', { text: t('Quick Play') })));
    }
  }

  paintClock();
  /* Tick on the minute rather than every second: the display has no seconds,
     so a per-second timer would wake the page sixty times for nothing. */
  let clockTimer = null;
  const scheduleClock = () => {
    clearTimeout(clockTimer);
    const now = new Date();
    const ms = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    clockTimer = setTimeout(() => { paintClock(); scheduleClock(); }, Math.max(1000, ms));
  };
  scheduleClock();

  /* ---------------- shell ---------------- */
  const iconsEl = h('div.desk-icons');
  const desktop = h('div.desktop', wp, deskClock, iconsEl);
  host.insertBefore(desktop, host.firstChild);
  paintLayers();
  applyClock();
  applyMotion();
  bindParallax();
  store.sub('prefs', () => { applyMotion(); applyClock(); bindParallax(); });
  /* follow the computer's own reduced-motion setting live, both ways — before,
     a prefs change while it was on left the wallpaper still after it was off */
  try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyMotion); } catch (e) { /* old engine */ }
  /* ...and look again every 5 s, for engines that never send that change
     (older Safari has no addEventListener on it; headless Linux Chrome sent
     none when the setting was switched back). Compared with what the
     wallpaper was last set by, not with the previous tick: a switch on and
     back off between two ticks, whose first half a change event had already
     handled, used to leave the wallpaper still for good. */
  bus.on('tick:5s', () => { if (reduced() !== motionSawReduced) applyMotion(); });
  store.sub('portal.play', paintHome);
  /* the apps register after the desktop mounts — look again once they have */
  bus.on('apps:ready', () => { homeKey = ''; paintHome(); });
  store.sub(WP.ACTIVE_KEY, () => {
    /* choosing a wallpaper during a season means the person wants to see it */
    if (SEASON.spookyOn() && store.get('prefs.spookyWallpaper') !== false) store.set('prefs.spookyWallpaper', false);
    if (SEASON.winterOn() && store.get('prefs.winterWallpaper') !== false) store.set('prefs.winterWallpaper', false);
    /* ...and so does choosing one on a desktop that had its own: it follows
       the new choice from now on, or the pick would seem to do nothing */
    if (Desktops.wallpaperOf()) Desktops.setWallpaper(Desktops.current(), null);
    paintLayers();
  });
  bus.on('desktop:switch', () => {
    const before = painted;
    fadeNext = true;
    paintLayers();
    fadeNext = false;
    /* game mode pauses a wallpaper video that comes up while it is on */
    if (painted !== before) bus.emit('wallpaper:changed');
  });
  store.sub('prefs.spookyWallpaper', paintLayers);
  store.sub('prefs.winterWallpaper', paintLayers);
  /* rotation put up the next picture, or was switched on or off */
  bus.on('wallpaper:rotate', () => {
    const before = painted;
    crossNext = true;
    paintLayers();
    crossNext = false;
    if (painted !== before) bus.emit('wallpaper:changed');
  });
  store.sub(WP.LIST_KEY, paintLayers);
  bus.on('wallpaper:changed', paintLayers);
  bus.on('season:change', paintLayers);

  /* ---------------- icons ---------------- */
  /* accent-derived stops only: the --aether-* ramp is fixed and would
     stay pink when data-accent changes (rule 1). Same pair as the
     fallback glyph in notifications.js. */
  const glyph = (name, accent) => h('div.glyph', accent
    ? { style: { '--g1': 'var(--accent-soft)', '--g2': 'var(--accent)' } }
    : { class: 'glyph--flat' }, icon(name));

  /* The layer (shell/deskicons.js) puts the buttons on a grid and handles
     selecting, dragging and renaming; what each icon does is decided here. */
  const layer = mountIconLayer({
    host: iconsEl, desktop, store, bus,
    freeWidth: () => wm.freeWidth(),
    cb: {
      open: it => it.open(),
      menu: (e, it, picked) => itemMenu(e, it, picked),
      rename: (it, next) => renameItem(it, next),
      trash: list => trashItems(list),
      copy: list => copyItems(list),
      paste: () => pasteHere(),
      moveInto: (group, target) => moveInto(group, target),
      canDrop: (group, target) => (target.kind === 'trash' ? group.some(g => g.trashable)
        : group.some(g => g.movable) && !!target.path && !group.some(g => g.path === target.path || target.path.startsWith(g.path + '/'))),
      canDockDrop: (group, appId) => !!api.getApp(appId) && group.every(g => g.kind === 'file' && !g.app),
      dockDrop: (group, appId) => { for (const g of group) { FS.usedApp(appId); api.openFile(g.path, appId); } },
    },
  });

  const plural = TB.plural;
  const badge = n => (n ? h('i.desk-badge', { text: String(n), 'aria-hidden': 'true' }) : null);
  let trashCount = TB.trashItems().length;

  /* Home and Static Drive open Files; a Files window already showing that
     folder just comes forward — "Open in New Window" makes another */
  function openFolder(path, fresh) {
    if (!fresh) {
      const w = wm.byApp('files').find(x => x.state?.reopen?.path === path && x.desk === wm.desktops.current());
      if (w) { if (w.min) wm.restore(w); else wm.focus(w, { lift: true }); return w; }
    }
    return api.openApp('files', { path });
  }

  function shortcut(s) {
    const path = s.trash ? TB.TRASH : s.path || vfs.HOME;
    const n = s.trash ? trashCount : 0;
    const el = h('button.desk-icon', { 'aria-label': n ? `${s.label}, ${plural(n, 'item')}` : s.label },
      appTile({ id: s.icon, icon: s.icon, g1: 'var(--accent-soft)', g2: 'var(--accent)' }), badge(n), h('span', { text: s.label }));
    return {
      key: `sc:${s.id}`, el, name: s.label, kind: s.trash ? 'trash' : 'dir', path, shortcut: s,
      pinned: true, canRename: false, trashable: false, movable: false, sort: { name: s.label, kind: '', mtime: 0 },
      open: () => openFolder(path),
    };
  }

  /* A .staticgame file (or an older .aethergame) is a launcher: it holds the game's id and the URL of
     the host's own title card, which we reference for the icon. */
  function readGame(n) {
    if (n.type !== 'file' || !/\.(static|aether)game$/.test(n.name)) return null;
    try { return JSON.parse(n.content || '{}'); } catch (err) { return null; }
  }

  function gameGlyph(g) {
    /* Arcade games get their cabinet colour; creations their thumbnail */
    const hue = g.kind === 'arcade' ? (arcadeHue.get(g.id) ?? 330) : null;
    const box = h('div.glyph', {
      style: { '--g1': hue != null ? `hsl(${hue} 80% 60%)` : 'var(--accent-soft)',
               '--g2': hue != null ? `hsl(${hue + 30} 70% 34%)` : 'var(--accent)',
               overflow: 'hidden', position: 'relative' },
    }, icon(g.kind === 'arcade' ? 'zap' : g.kind === 'creation' ? 'sparkles' : g.kind === 'collection' ? 'layers' : 'gamepad'));
    if (g.kind === 'creation' && !g.art) g = { ...g, art: (store.get('portal.forge.thumbs', {}) || {})[g.id] || null };
    if (g.art) {
      box.appendChild(h('img', {
        src: g.art, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
        style: { position: 'absolute', inset: '0', width: '100%', height: '100%',
                 objectFit: 'cover', opacity: '0', transition: 'opacity var(--t-med) var(--ease)' },
        onload: e => { e.target.style.opacity = '1'; },
        onerror: e => { e.target.remove(); },
      }));
    }
    return box;
  }

  /* A .staticapp file names an app: its own tile and (translated) name. One whose app is gone
     comes back as a plain file, so it is drawn like any file and says so when opened. */
  function entryApp(n, path) {
    const id = appShortcutId(n);
    const app = id && getApp(id);
    const label = app ? app.name : n.name;
    const el = h('button.desk-icon', { 'aria-label': app ? t('Open {name}', { name: label }) : t('{name}, app not installed', { name: label }) },
      app ? appTile(app) : glyph(vfs.iconFor(n), false), h('span', { text: label }));
    return {
      key: `f:${n.name}`, el, name: label, fileName: n.name, path, app: true, appId: app ? id : null,
      kind: 'file', pinned: false, canRename: false, trashable: true, movable: true,
      sort: { name: label, kind: n.kind || '', mtime: Date.parse(n.mtime) || 0 },
      open: () => openAppShortcut(n, i => api.openApp(i)),
    };
  }

  function entry(n) {
    const path = `${DESK}/${n.name}`;
    if (n.type === 'file' && /\.staticapp$/i.test(n.name)) return entryApp(n, path);
    const game = readGame(n);
    const label = game ? game.title : n.name;
    const el = h('button.desk-icon', { 'aria-label': game ? t('Play {label}', { label }) : n.name },
      game ? gameGlyph(game) : glyph(vfs.iconFor(n), n.type === 'dir'),
      h('span', { text: label }));
    return {
      key: `f:${n.name}`, el, name: label, fileName: n.name, path, game,
      kind: game ? 'game' : n.type === 'dir' ? 'dir' : 'file',
      pinned: false, canRename: !game, trashable: true, movable: true,
      sort: { name: label, kind: n.type === 'dir' ? '' : n.kind || '', mtime: Date.parse(n.mtime) || 0 },
      open: game ? () => launchItem(game) : () => api.openFile(path),
    };
  }

  /* ---------------- what the menus do ---------------- */
  const say = t => bus.emit('a11y:say', t);

  /* Delete means the Trash — never for good — and the notice has an Undo.
     The name it gets in the Trash is worked out the way vfs.rm does it. */
  function trashItems(list) {
    const rows = list.filter(i => i.trashable);
    if (!rows.length) return;
    const trash = vfs.node(TB.TRASH);
    const moved = [];
    for (const it of rows) {
      let as = it.fileName, k = 1;
      while (trash && trash.children.some(c => c.name === as)) as = `${it.fileName} (${++k})`;
      if (vfs.rm(it.path)) moved.push({ orig: it.fileName, as, label: it.name });
    }
    if (!moved.length) return;
    layer.clear();
    api.notify({
      app: 'Desktop', icon: 'trash', title: t('Moved to Trash'), timeout: 9000,
      message: moved.length === 1 ? moved[0].label : t('{length} items', { length: moved.length }),
      actions: [{ label: t('Undo'), onClick: () => undoTrash(moved) }],
    });
  }
  function undoTrash(moved) {
    let back = 0;
    for (const m of moved) {
      const from = `${TB.TRASH}/${m.as}`;
      if (!vfs.node(from) || vfs.node(`${DESK}/${m.as}`)) continue;
      if (!vfs.mv(from, DESK)) continue;
      back++;
      if (m.as !== m.orig && !vfs.node(`${DESK}/${m.orig}`)) vfs.rename(`${DESK}/${m.as}`, m.orig);
    }
    api.notify({ app: 'Desktop', icon: 'undo', title: back ? t('Put back') : t('Couldn’t put back'),
      message: back ? (back === 1 ? moved[0].label : `${back} items`) : t('They are no longer in the Trash.'), timeout: 4000 });
  }

  function renameItem(it, next) {
    if (/[\/\\]/.test(next)) { api.notify({ app: 'Desktop', icon: 'alert', title: t('Can’t use that name'), message: t('A name can’t have a slash in it.') }); return; }
    if (vfs.node(`${DESK}/${next}`)) {
      api.notify({ app: 'Desktop', icon: 'alert', title: t('Name already used'), message: t('The Desktop already has “{next}”.', { next }) });
      return;
    }
    layer.rekey(it.key, `f:${next}`);
    if (!vfs.rename(it.path, next)) layer.rekey(`f:${next}`, it.key);
  }

  function moveInto(group, target) {
    if (target.kind === 'trash') { trashItems(group); return; }
    const dest = target.path;
    const done = [];
    for (const g of group) {
      if (!g.movable || g.path === dest || dest.startsWith(g.path + '/')) continue;
      if (vfs.node(`${dest}/${g.fileName}`)) {
        api.notify({ app: 'Desktop', icon: 'alert', title: t('Not moved'), message: t('{name} already has “{fileName}”.', { name: target.name, fileName: g.fileName }) });
        continue;
      }
      if (vfs.mv(g.path, dest)) done.push(g.name);
    }
    if (!done.length) return;
    layer.clear();
    api.notify({ app: 'Desktop', icon: 'folder', title: t('Moved to {name}', { name: target.name }), timeout: 5000,
      message: done.length === 1 ? done[0] : t('{length} items', { length: done.length }) });
  }

  function copyItems(list) {
    const rows = list.filter(i => i.movable);
    if (!rows.length) return;
    FS.holdCopy(rows.map(i => i.path));
    say(rows.length === 1 ? `Copied ${rows[0].name}` : `Copied ${rows.length} items`);
  }
  function pasteHere() {
    const from = FS.copied();
    if (!from.length) return;
    let made = 0, last = null;
    for (const p of from) { const name = FS.copyInto(p, DESK); if (name) { made++; last = name; } }
    api.notify({ app: 'Desktop', icon: made ? 'copy' : 'alert', timeout: 4000,
      title: made ? t('Pasted') : t('Nothing pasted'), message: made ? (made === 1 ? last : `${made} items`) : t('Those items can’t be copied here.') });
    if (last) layer.select([`f:${last}`]);
  }

  async function copyText(text, what) {
    try { await navigator.clipboard.writeText(text); say(`${what} copied`); }
    catch (e) { api.notify({ app: 'Desktop', icon: 'alert', title: t('Couldn’t copy'), message: t('This browser did not allow it.') }); }
  }

  /* Get Info: the real numbers from the vfs, nothing estimated */
  let infoRel = null;
  function infoSheet(path) {
    const i = FS.info(path);
    if (!i) return;
    infoRel?.();
    const row = (k, v) => h('div.desk-info__row', h('span', { text: k }), h('b', { text: v }));
    const close = () => { infoRel?.(); infoRel = null; wrap.remove(); };
    const card = h('div.glass.desk-info', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('{name} info', { name: i.name }) },
      h('div.h-sec', { text: i.name }),
      row(t('Kind'), i.kind),
      row(t('Size'), i.size),
      row(t('Where'), i.path),
      row(t('Modified'), i.modified ? i.modified.toLocaleString() : t('Not recorded')),
      h('div.row', { style: { justifyContent: 'flex-end', marginTop: 'var(--sp-2)' } },
        h('button.btn.btn--primary', { text: t('Done'), onclick: close })));
    const wrap = h('div.spot-wrap', { style: { alignItems: 'center', paddingTop: '0' },
      onpointerdown: e => { if (e.target === wrap) close(); } }, card);
    host.appendChild(wrap);
    infoRel = L.push({ name: 'info', el: card, trap: true, close });
    card.querySelector('.btn')?.focus({ preventScroll: true });
  }

  function openWithMenu(it) {
    const apps = FS.openWithApps(it.path);
    if (!apps.length) return null;
    const recent = new Set(FS.openWithRecent(it.path).map(a => a.id));
    const mk = a => ({ label: a.name, icon: a.icon, onClick: () => { FS.usedApp(a.id); api.openFile(it.path, a.id); } });
    return { label: t('Open With'), icon: 'external-link', items: [
      ...apps.filter(a => recent.has(a.id)).map(mk),
      recent.size ? '-' : null,
      ...apps.filter(a => !recent.has(a.id)).slice(0, 12).map(mk),
    ].filter(Boolean) };
  }

  function itemMenu(e, it, picked) {
    const many = picked.length > 1;
    const at = [e.clientX, e.clientY];
    /* the Trash */
    if (it.kind === 'trash') {
      api.menu([
        { label: t('Open'), icon: 'folder-open', onClick: it.open },
        { label: t('Open in New Window'), icon: 'plus', onClick: () => openFolder(it.path, true) },
        '-',
        { label: t('Empty Trash'), icon: 'trash', danger: true, disabled: !trashCount, onClick: () => TB.emptyTrash() },
      ], ...at);
      return;
    }
    /* Home and Static Drive */
    if (it.pinned) {
      api.menu([
        { label: t('Open'), icon: 'folder-open', onClick: it.open },
        { label: t('Open in New Window'), icon: 'plus', onClick: () => openFolder(it.path, true) },
        deskterm.available() ? { label: t('Open Terminal Here'), icon: 'terminal', onClick: () => api.openApp('terminal', { cwd: it.path }) } : null,
        '-',
        { label: t('Copy Path'), icon: 'copy', onClick: () => copyText(it.path, t('Path')) },
      ].filter(Boolean), ...at);
      return;
    }
    const trash = { label: many ? t('Move {length} Items to Trash', { length: picked.length }) : t('Move to Trash'), icon: 'trash', danger: true, hint: 'Del', onClick: () => trashItems(picked) };
    if (many) {
      api.menu([
        { label: t('Open {length} Items', { length: picked.length }), icon: 'external-link', onClick: () => picked.forEach(p => p.open()) },
        { label: t('Copy'), icon: 'copy', onClick: () => copyItems(picked) },
        '-', trash,
      ], ...at);
      return;
    }
    const game = it.game;
    api.menu([
      { label: game ? t('Play') : t('Open'), icon: game ? 'play' : it.kind === 'dir' ? 'folder-open' : 'external-link', hint: '↵', onClick: it.open },
      game ? { label: t('Open in Browser'), icon: 'globe',
        onClick: () => api.openApp('browser', { url: game.url || `static://games/${game.id}` }) } : null,
      game ? { label: t('Share…'), icon: 'share',
        onClick: () => bus.emit('share:open', { kind: game.kind || 'web', id: game.id, title: game.title, art: game.art || null }) } : null,
      it.kind === 'file' && !it.app ? openWithMenu(it) : null,
      it.kind === 'dir' ? { label: t('Open in New Window'), icon: 'plus', onClick: () => api.openApp('files', { path: it.path }) } : null,
      '-',
      { label: t('Get Info'), icon: 'info', onClick: () => infoSheet(it.path) },
      { label: t('Copy'), icon: 'copy', onClick: () => copyItems([it]) },
      { label: t('Copy Path'), icon: 'link', onClick: () => copyText(it.path, t('Path')) },
      it.canRename ? { label: t('Rename'), icon: 'edit-3', hint: 'F2', onClick: () => layer.startRename(it.key) } : null,
      '-', trash,
    ].filter(Boolean), ...at);
  }

  function paintIcons() {
    iconsEl.classList.toggle('hidden', !store.get('prefs.desktopIcons'));
    trashCount = TB.trashItems().length;
    layer.paint([...SHORTCUTS.map(shortcut), ...vfs.ls(DESK).map(entry)]);
  }

  /* ---------------- new items ------------ */
  function newFolder() {
    let name = 'untitled folder', i = 1;
    while (vfs.node(`${DESK}/${name}`)) name = `untitled folder ${++i}`;
    vfs.mkdir(`${DESK}/${name}`);
  }
  function newFile() {
    let name = 'untitled.txt', i = 1;
    while (vfs.node(`${DESK}/${name}`)) name = `untitled ${++i}.txt`;
    vfs.touch(`${DESK}/${name}`, '');
  }

  /* ---------------- desktop menu --------- */
  function deskMenu(e) {
    api.menu([
      { label: t('New Folder'), icon: 'plus', onClick: newFolder },
      { label: t('New Text File'), icon: 'file-text', onClick: newFile },
      { label: t('Paste Here'), icon: 'copy', disabled: !FS.copied().length, onClick: pasteHere },
      '-',
      { label: t('Sort By'), icon: 'list', items: [
        ['name', 'Name'], ['kind', 'Kind'], ['date', t('Date Modified')],
      ].map(([how, label]) => ({ label, onClick: () => layer.sortBy(how) })) },
      { label: t('Clean Up'), icon: 'grid', onClick: () => layer.cleanUp() },
      { label: t('Icon Size'), icon: 'maximize', items: Object.entries(SIZES).map(([id, z]) => ({
        label: z.label, checked: (store.get('prefs.deskIconSize') || 'medium') === id,
        onClick: () => store.set('prefs.deskIconSize', id) })) },
      '-',
      /* 'appearance' is where the wallpaper controls live; settings.js
         validates opts.section against its own ids and ignores unknown ones. */
      { label: t('Change Wallpaper…'), icon: 'wallpaper',
        onClick: () => api.openApp('settings', { section: 'appearance' }) },
      { label: t('Add Widget…'), icon: 'plus', onClick: () => bus.emit('deskwidgets:picker') },
      { label: t('Toggle Widget Rail'), icon: 'sidebar',
        onClick: () => store.set('prefs.widgetsVisible', !store.get('prefs.widgetsVisible')) },
      { label: t('Show Overview'), icon: 'grid-9', hint: fmt.modLabel + '`', onClick: () => api.overview() },
      { label: t('New Desktop'), icon: 'layers', disabled: Desktops.count() >= Desktops.MAX,
        onClick: () => { const d = api.wm.addDesktop(); if (d) api.wm.switchDesktop(d.id); } },
      '-',
      /* the terminal only exists on the Linux drive, in the wallpaper */
      deskterm.available()
        ? { label: t('Open Terminal Here'), icon: 'terminal',
          onClick: () => api.openApp('terminal', { cwd: DESK }) }
        : null,
      { label: t('About This Static'), icon: 'info', onClick: () => api.openApp('about') },
    ], e.clientX, e.clientY);
  }

  /* the wallpaper terminal is not "bare desktop": double-click selects a word
     there, right-click is the browser's copy/paste menu */
  const onBare = (e, fn) => { if (!e.target.closest('.desk-icon, .desk-term')) fn(e); };
  desktop.addEventListener('contextmenu', e => onBare(e, () => { e.preventDefault(); deskMenu(e); }));
  desktop.addEventListener('click', e => onBare(e, () => { bus.emit('launcher:close'); if (!layer.swallowClick()) layer.clear(); }));
  desktop.addEventListener('dblclick', e => onBare(e, () => api.overview()));

  /* ---------------- drop files from the computer ------------
   * Files dragged from the real computer onto the wallpaper are saved
   * into ~/Desktop by the same rules as Files' own import
   * (core/fileimport.js): their own names, real sizes, kept in this
   * browser. Windows sit above the desktop in #os, so a drop on a window
   * never lands here — that window (Files, Music…) gets it instead. */
  const dropTitle = h('b');
  const dropNote = h('small');
  const deskDrop = h('div.desk-drop', { 'aria-hidden': 'true' },
    h('div.desk-drop__card', icon('upload'), dropTitle, dropNote));
  desktop.appendChild(deskDrop);
  let dragDepth = 0;
  let importing = false;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  function showDrop() {
    dropTitle.textContent = importing ? 'Still saving the last files…' : t('Drop to save to the Desktop');
    dropNote.textContent = importing ? t('Wait a moment, then drop again.')
      : t('Any file from your computer is kept in this browser, in ~/Desktop. Text up to 200 KB stays editable.');
    desktop.classList.add('is-dropping');
  }
  function hideDrop() { dragDepth = 0; desktop.classList.remove('is-dropping'); }
  desktop.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showDrop(); });
  desktop.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = importing ? 'none' : 'copy';
    if (!desktop.classList.contains('is-dropping')) showDrop();
  });
  desktop.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hideDrop(); });
  desktop.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    hideDrop();
    if (importing) {
      api.notify({ app: 'Desktop', icon: 'alert', title: t('Still saving'), message: t('Wait for the last files to finish, then drop again.') });
      return;
    }
    const { files, folders } = fileimport.fromDrop(e.dataTransfer);
    if (!files.length && !folders.length) return;
    importing = true;
    desktop.classList.add('is-importing');
    let results = [];
    try {
      results = await fileimport.importFiles(DESK, files, {
        folders,
        onProgress: ({ index, total, current }) => {
          dropTitle.textContent = total > 1 ? `Saving to the Desktop — ${index} of ${total}` : t('Saving to the Desktop…');
          dropNote.textContent = current;
        },
      });
    } catch (err) {
      results = files.map(f => ({ ok: false, name: f.name, why: String(err?.message || err) }));
    } finally {
      importing = false;
      desktop.classList.remove('is-importing');
    }
    const saved = results.filter(r => r.ok);
    const refused = results.filter(r => !r.ok);
    const lines = [
      ...saved.slice(0, 3).map(r => `${r.as} — ${fileimport.fmtSize(r.size)}${r.note ? ` (${r.note})` : ''}`),
      ...(saved.length > 3 ? [`and ${saved.length - 3} more`] : []),
      ...refused.slice(0, 3).map(r => t('Not saved: {name} — {why}', { name: r.name, why: r.why })),
    ];
    const first = saved[0];
    api.notify({
      app: 'Desktop', icon: refused.length ? 'alert' : 'upload',
      title: fileimport.summary(results, 'Desktop'),
      message: lines.join('\n'),
      timeout: refused.length || saved.some(r => r.note) ? 0 : 7000,
      actions: first
        ? [{ label: t('Show in Files'), onClick: () => api.openApp('files', { path: first.path }) }, { label: 'OK' }]
        : [{ label: 'OK' }],
    });
    /* the newest arrival is what you'd click next */
    if (first) layer.select([`f:${first.as}`]);
  });

  /* ---------------- wiring --------------- */
  paintIcons();
  /* a file moved to or from the Desktop repaints; anything that changes the Trash's count does too */
  bus.on('fs:change', dir => {
    if (!dir || vfs.norm(dir) === DESK || TB.trashItems().length !== trashCount) paintIcons();
  });
  store.sub('prefs.desktopIcons', paintIcons);
  bus.on('apps:declared', paintIcons);
  /* icon size, the dock's size and the widget rail all change the room the grid has */
  store.sub('prefs', () => layer.relayout());
  store.sub('prefs.wallpaperGrid', paintLayers);
  store.sub('prefs.wallpaperGrain', paintLayers);

  return desktop;
}

export default mountDesktop;
