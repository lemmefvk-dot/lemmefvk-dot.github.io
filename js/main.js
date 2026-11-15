/* ============================================================
   main.js — bring up StaticOS
   Boot order: prefs → wallpaper → window layer → app list →
   boot splash, playing while the shell surfaces and tick loops
   load under it → session restore.
   Every module is loaded dynamically so one broken part cannot
   take down the whole desktop; failures are reported instead.
   Apps are declared from js/apps/manifest.js and each one's code
   loads the first time it opens (js/core/apploader.js). Work that
   can wait — the Watch engine, the offline copy — waits until the
   desktop is up.
   ============================================================ */
import { covered } from './core/cover.js';
/* first, so its Escape listener runs before every surface's own: one
   Escape closes only the topmost menu / panel (see core/layers.js) */
import './core/layers.js';
import * as deskterm from './shell/deskterm.js';
import { h, q } from './core/dom.js';
import { icon } from './core/icons.js';
import { bus } from './core/bus.js';
import { store } from './core/store.js';
import * as THEMES from './core/themes.js';
import * as SEASON from './core/season.js';
import * as wm from './core/wm.js';
import api from './core/api.js?v=ps5-cloud-proxy-v11';
import { clamp } from './core/util.js';
import { mountUpdater } from './core/updater.js';
import * as sfx from './core/sfx.js';
import { declareApps, preloadApp } from './core/apploader.js';
import * as appearance from './core/appearance.js';
import * as KM from './core/keymap.js';
import * as profiles from './core/profiles.js';
/* the words: waits for data/i18n/es.json when Spanish is the language, so nothing below draws before it is there */
import * as i18n from './core/i18n.js';

const HOST = q('#os');
const failures = [];

/* Start the developer log before anything else runs, so Static Developer's
   Console tab holds the whole session — including boot output and any
   failure below — rather than only what happened after it was opened.
   init() is idempotent and cheap; the app calls it again when it opens. */
import('./core/devlog.js').then(D => D.init()).catch(() => {});

/* ---------- 1. apply saved preferences ----------------------------- */
function applyPrefs() {
  const p = store.get('prefs');
  const root = document.documentElement;
  root.dataset.theme = p.theme || 'dark';
  THEMES.apply(p.accent, root);
  root.dataset.density = p.density || 'normal';
  root.dataset.icons = ['round', 'sharp', 'flat', 'outline', 'tinted', 'clay'].includes(p.iconStyle) ? p.iconStyle : 'glass';
  /* Night Shift and the colour filters share <html>'s filter: js/core/appearance.js */
  const b = clamp(0.6 + (p.brightness ?? 100) / 100 * 0.4, 0.45, 1);
  HOST.style.filter = b < 0.999 ? `brightness(${b.toFixed(3)})` : '';
  document.body.classList.toggle('reduce-motion', !!p.reduceMotion);
  /* spooky season (Oct 24 – Nov 1): one attribute, read by css/feat-spooky.css
     and by everything the season adds — see js/core/season.js */
  SEASON.applyRoot(root);
}
applyPrefs();
store.sub('prefs', applyPrefs);
/* text scale, contrast, blur, volume … (they used to wait for Settings' code) */
appearance.init();

/* ---------- 2. module loader --------------------------------------- */
async function use(path, fnName, ...args) {
  try {
    const mod = await import(`${path}?v=${APP_ASSET_VERSION}`);
    const fn = mod[fnName] || mod.default;
    if (typeof fn !== 'function') throw new Error(`no export "${fnName}"`);
    return await fn(...args);
  } catch (err) {
    failures.push(`${path} → ${err.message}`);
    console.error(`[StaticOS] ${path} failed:`, err);
    return null;
  }
}

const APP_ASSET_VERSION = 'ps5-home-v3';

/* run fn once the page has a moment to spare (or after `ms` regardless) */
const whenIdle = (fn, ms = 2000) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(() => fn(), { timeout: ms })
  : setTimeout(fn, 200));

/* ---------- 3. bring up the stage ---------------------------------- */
async function boot() {
  /* several people use this computer and this tab has not said who it is:
     the login screen and nothing else — no one's data is loaded until
     someone is picked (js/core/profiles.js, js/shell/users.js) */
  if (profiles.MODE === 'login') { await use('./shell/users.js', 'mountLogin', HOST); return; }

  /* wallpaper first so it sits under everything */
  await use('./shell/desktop.js', 'mountDesktop', HOST);
  if (!q('.desktop', HOST)) HOST.prepend(h('div.desktop', h('div.wp', h('div.wp__sky'), h('div.wp__vig'))));

  /* window layer */
  wm.mountWM(HOST);

  /* every app is known from here on; its code loads when it first opens */
  declareApps();
  bus.emit('apps:ready');
  /* the first window most sessions see, fetched alongside the shell */
  preloadApp(store.get('prefs.bootOS') === 'linux' ? 'terminal' : 'files');

  /* The boot splash (or the boot menu) starts now, over the wallpaper, and
     plays while the rest of the shell loads underneath it: it used to wait
     for the whole shell and then play on top, so every start-up paid for
     the download and the animation one after the other. It only fades once
     the shell is up (shellUp below), so nothing half-built ever shows, and
     cover('boot') keeps the surfaces mounting under it inert. */
  let shellUp;
  const shellReady = new Promise(res => { shellUp = res; });
  const splash = use('./shell/bootpicker.js', 'runBootPicker', HOST, shellReady);

  /* shell surfaces */
  await Promise.all([
    use('./shell/topbar.js', 'mountTopbar', HOST),
    use('./shell/dock.js', 'mountDock', HOST),
    use('./shell/launcher.js', 'mountLauncher', HOST),
    use('./shell/widgets.js', 'mountWidgets', HOST),
    use('./shell/notifications.js', 'mountNotifications', HOST),
    use('./shell/contextmenu.js', 'mountMenus', HOST),
    use('./shell/spotlight.js', 'mountSpotlight', HOST),
    use('./shell/overview.js', 'mountOverview', HOST),
    /* desktops: ⌃←/→, swipes, the HUD — and the snap layouts on the green button */
    use('./shell/desktops.js', 'mountDesktops', HOST),
    use('./shell/snaplayouts.js', 'mountSnapLayouts', HOST),
    use('./shell/snapassist.js', 'mountSnapAssist', HOST),       /* after a snap, pick a window for the rest */
    use('./shell/splitview.js', 'mountSplitView', HOST),         /* drag the line between snapped windows */
    use('./shell/longpress.js', 'mountLongPress', HOST),         /* touch: a long press is a right-click */
    /* push the pointer into a corner: what Settings › Desktop › Hot corners says (all off until chosen) */
    use('./shell/hotcorners.js', 'mountHotCorners', HOST),
    use('./shell/lockscreen.js', 'mountLock', HOST),
    /* Easter eggs bind global key handlers, so they mount with the rest of
       the shell rather than after the splash — otherwise the first few
       seconds of keyboard input go nowhere. */
    use('./shell/eggs.js', 'mountEggs', HOST),
    use('./shell/share.js', 'mountShare', HOST),
    use('./shell/deskwidgets.js', 'mountDeskWidgets', HOST),
    use('./shell/mobile.js', 'mountMobile', HOST),
    /* skip links, the window menu (keyboard move/size), Shift+F10, the
       screen-reader live region — the desktop without a mouse */
    use('./shell/a11y.js', 'mountA11y', HOST),
    use('./shell/account.js', 'mountAccount', HOST),
    /* the beta site only (channel.json says so): banner and developer gate */
    use('./shell/earlyaccess.js', 'mountEarlyAccess', HOST),
    /* several people on one computer: switch user, guest sessions */
    use('./shell/users.js', 'mountUsers', HOST),
    /* backup reminder, the offline banner, daily file snapshots, data saver, install */
    use('./shell/housekeeping.js', 'mountHousekeeping', HOST),
    /* the music visualizer on the wallpaper (off unless Settings › Wallpaper
       turns it on; no canvas and no frames until then) */
    use('./shell/visualizer.js', 'mountVisualizer', HOST),
    /* spooky season: leaves and bats, the sound pack, the clock that
       carries the desktop into and out of the season (off the rest of the year) */
    use('./shell/spooky.js', 'mountSpooky', HOST),
    /* Halloween: stickers, the chosen cursor, the dock pumpkin's tricks,
       "boo" and opt-in jump scares — seasonal parts stay idle out of season */
    use('./shell/halloween-fun.js', 'mountHalloweenFun', HOST),
    /* winter (Dec 1 – Jan 1): snow over the wallpaper and the advent calendar */
    use('./shell/winter.js', 'mountWinter', HOST),
    /* New Year's fireworks, birthdays, Valentine's hearts, spring blossoms: one canvas (js/shell/celebrate.js) */
    use('./shell/celebrate.js', 'mountCelebrate', HOST),
    /* autumn, Lunar New Year, St Patrick's, Pi Day, Earth Day, summer, back to school, first snow (js/shell/seasons-more.js) */
    use('./shell/seasons-more.js', 'mountSeasonsMore', HOST),
    /* the ghost hunt: 13 ghosts hidden around the OS, in season only */
    use('./shell/ghosts.js', 'mountGhosts', HOST),
    /* a little cat (a ghost in spooky season) on the dock — Settings › Desktop */
    use('./shell/pet.js', 'mountPet', HOST),
    /* on Sundays, a card with the week Screen Time measured — Settings › Screen Time */
    use('./shell/recap.js', 'mountRecap', HOST),
    /* once the desktop is up, a card offers the StaticOS video (never autoplays) */
    use('./shell/introvideo.js', 'mountIntroVideo', HOST),
    /* the guided tour (after first-run setup, Help › Take the Tour) and the tip of the day */
    use('./shell/tour.js', 'mountTour', HOST),
    use('./shell/tips.js', 'mountTips', HOST),
    /* hold ⌘ / Ctrl: every shortcut (js/core/keymap.js) */
    use('./shell/cheatsheet.js', 'mountCheatSheet', HOST),
    /* ⌘ / Ctrl + . in a text field: emoji and symbols */
    use('./shell/emoji.js', 'mountEmoji', HOST),
    /* after the idle time Settings › Desktop sets: bubbles, stars or ghosts */
    use('./shell/screensaver.js', 'mountScreensaver', HOST),
    /* Settings › Accessibility › Magnifier and its keys (nothing runs while it is off) */
    use('./shell/magnifier.js', 'mountMagnifier', HOST),
    /* Settings › Accessibility: captions and a flash for sounds, the on-screen keyboard */
    use('./shell/a11yplus.js', 'mountA11yPlus', HOST),
  ]);

  startClocks();
  bindGlobals();
  sfx.init();
  /* the engines that work with their window closed. They used to have the whole splash to
     load in; now that it plays during the shell's own loading, the session is restored
     (below) only once they are all up, so the first window still opens where it was left */
  const engines = [];
  const engine = p => engines.push(p);
  engine(import('./core/gamemode.js').then(G => G.init()).catch(err => console.warn('[StaticOS] game mode', err)));
  engine(import('./core/gamefiles.js').then(G => G.init()).catch(err => console.warn('[StaticOS] game files', err)));
  engine(import('./core/trashexpiry.js').then(T => T.init()).catch(err => console.warn('[StaticOS] trash expiry', err)));   /* the opt-in 30-day Trash (Settings › Storage) */
  engine(import('./core/notehistory.js').then(N => N.init()).catch(err => console.warn('[StaticOS] note history', err)));  /* versions of a note, kept on idle (Notes › History) */
  engine(import('./core/labs.js').then(L => L.init()).catch(err => console.warn('[StaticOS] labs', err)));
  engine(import('./core/achievements.js').then(async A => A.init({ plays: await import('./core/plays.js') })).catch(err => console.warn('[StaticOS] achievements', err)));   /* arms the gesture-unlock and wires open/close/notify cues (opt-in, off by default) */
  engine(import('./core/clipboard.js').then(C => C.init()).catch(err => console.warn('[StaticOS] clipboard', err)));       /* captures copies so Static Clipboard has a history */
  engine(import('./core/automations.js').then(A => A.init()).catch(err => console.warn('[StaticOS] automations', err)));   /* runs the user's own "when … then …" rules */
  engine(import('./core/exams.js').then(E => E.init()).catch(err => console.warn('[StaticOS] exams', err)));              /* keeps exam reminders and "carried over" in step with the clock, window closed */
  engine(import('./core/homework.js').then(H => H.init()).catch(err => console.warn('[StaticOS] homework', err)));   /* the next of a repeating assignment appears on its day, window closed */
  if (store.get('portal.timetable')) engine(import('./core/timetable.js').then(T => T.init()).catch(err => console.warn('[StaticOS] timetable', err)));   /* tops up the "next class" reminders each day, window closed */
  if (store.get('portal.calendar')) engine(import('./core/calendar.js').then(C => C.init()).catch(err => console.warn('[StaticOS] calendar', err)));   /* tops up the reminders of monthly, yearly… events each day */
  if (store.get('portal.contacts')) engine(import('./core/contacts.js').then(C => C.init()).catch(err => console.warn('[StaticOS] contacts', err)));   /* tops up the yearly birthday reminders each day */
  engine(import('./core/focus.js').then(F => F.init()).catch(err => console.warn('[StaticOS] focus timer', err)));       /* Clock › Focus keeps time with its window closed */
  if (store.get('prefs.clock.alarms')?.length || store.get('prefs.clock.timers')?.length) engine(import('./core/alarms.js').then(A => A.init()).catch(err => console.warn('[StaticOS] alarms', err)));   /* Clock's alarms and timers ring with its window closed */
  engine(import('./core/dndsched.js').then(D => D.init()).catch(err => console.warn('[StaticOS] Do Not Disturb schedule', err)));   /* turns Do Not Disturb on and off by Settings › Notifications schedules */
  engine(import('./core/snippets.js').then(S => S.init()).catch(err => console.warn('[StaticOS] text snippets', err)));   /* a short code and a space expands in any text field (Settings › Keyboard › Text snippets) */
  engine(import('./core/screentime.js').then(T => T.init()).catch(err => console.warn('[StaticOS] screen time', err)));  /* Settings › Screen Time: measured here, while open */
  engine(import('./core/reopen.js').then(R => R.init()).catch(err => console.warn('[StaticOS] reopen', err)));             /* remembers closed windows: ⇧⌘T / Ctrl+Shift+T brings them back */
  engine(import('./core/winlayouts.js').then(W => W.init()).catch(err => console.warn('[StaticOS] window layouts', err)));   /* each app opens where it was left; saved layouts */
  engine(import('./core/wintabs.js').then(T => T.init()).catch(err => console.warn('[StaticOS] window tabs', err)));       /* drop a window onto another's title bar: one frame, two tabs */
  window.Static.updater = mountUpdater();   /* see ./watch.sh */

  /* the shell is up: the watchdog in index.html stands down */
  if (window.__staticBoot) { window.__staticBoot.alive = true; window.__staticBoot.aliveMs = Math.round(performance.now()); }   /* the desktop is up: About This Static reads it (js/core/sysinfo.js) */
  /* the Developer Room lists what failed to load */
  if (window.__staticBoot) window.__staticBoot.failures = failures;

  /* the splash can finish now; then the engines it used to give time to */
  shellUp();
  await splash;
  await Promise.all(engines);

  /* First run gets the short setup flow instead of a restored session —
     there is nothing to restore, and landing on a bare desktop with no
     explanation is the worst first impression this thing can make. */
  const onboarding = await import(`./shell/onboarding.js?v=${APP_ASSET_VERSION}`).catch(() => null);
  if (onboarding && !onboarding.onboarded()) {
    await use('./shell/onboarding.js', 'mountOnboarding', HOST);
  }

  /* "Reopen what I had open" (Settings › Desktop › Startup): the windows from last time, else the starter one */
  const resume = await import('./core/resume.js').catch(() => null);
  restoreSession(resume);
  resume?.init();
  showHotkeyHint();
  if (window.__staticBoot) { window.__staticBoot.ok = true; window.__staticBoot.readyMs = Math.round(performance.now()); }
  /* the desktop and the restored session are up: Automations opens your
     startup apps on top, and the wallpaper clip starts downloading */
  bus.emit('boot:ready');
  window.dispatchEvent(new Event('staticos:ready'));
  announceVersion();
  /* a slow device is offered Low graphics mode, once (measures only while you move, drag or scroll) */
  import('./core/smoothcheck.js').then(S => S.init()).catch(err => console.warn('[StaticOS] smooth check', err));
  import('./core/events.js').then(E => E.init()).catch(err => console.warn('[StaticOS] events', err));
  /* Social › Friends: presence for your friends and game-night reminders.
     Only where Friends has been used — otherwise its code never loads. */
  if (store.get('portal.friends')) import('./core/friends.js').then(F => F.init()).catch(err => console.warn('[StaticOS] friends', err));
  /* announcements and events from the developer (data/broadcast.json) */
  import('./core/broadcast.js').then(B => B.init(HOST)).catch(err => console.warn('[StaticOS] broadcast', err));
  /* a #game= / #arcade= / #app= link someone shared opens its thing now */
  import(`./shell/share.js?v=${APP_ASSET_VERSION}`).then(S => S.openDeepLink()).catch(() => {});
  /* Music › Ambient sounds can follow Clock › Focus sessions; only when
     that is switched on does its engine load at start-up */
  if (store.get('portal.ambient')?.focus?.on === true) {
    import('./core/ambient.js').then(A => A.init()).catch(err => console.warn('[StaticOS] ambient sounds', err));
  }
  whenIdle(() => {
    /* select text anywhere → right-click › Read aloud, Ctrl+Alt+S, or
       Spotlight's "read selection" (off the start-up path: nothing needs
       it in the first second) */
    use('./shell/readaloud.js', 'mountReadAloud', HOST);
    /* wallpaper rotation's clock, the Day and Night light, the weather
       overlay and the auto accent. Off the start-up path: the first frame
       is already right without it (the desktop paints rotation's picture and
       the Day and Night light itself; the auto colour is in prefs) */
    use('./shell/wallplus.js', 'mountWallplus', HOST);
    /* remembers where you stopped a video, even with Watch closed */
    import('./apps/watch.js').then(W => W.init()).catch(err => console.warn('[StaticOS] watch engine', err));
    /* keep a copy of StaticOS for next time, and for offline (sw.js) */
    import('./core/offline.js').then(O => O.start()).catch(err => console.warn('[StaticOS] offline copy', err));
  });

  /* An app whose code fails to load says so in its own window when it is
     opened (js/core/apploader.js). Only a broken SHELL surface is worth
     interrupting the user about. */
  if (failures.length) console.warn('[StaticOS] degraded modules:\n' + failures.join('\n'));
  const shellDown = failures.filter(f => f.includes('/shell/'));
  if (shellDown.length) {
    api.notify({
      app: 'StaticOS', icon: 'alert', timeout: 0,
      title: `${shellDown.length} shell module${shellDown.length > 1 ? 's' : ''} failed to load`,
      message: shellDown.slice(0, 2).join(' · ') + ' — see the console.',
    });
  }
  document.body.dataset.ready = '1';
}

/* ---------- 4. the heartbeat --------------------------------------- */
function startClocks() {
  let n = 0;
  setInterval(() => {
    n++;
    const d = new Date();
    bus.emit('tick:1s', d);
    if (n % 5 === 0) bus.emit('tick:5s', d);
  }, 1000);
}

/* ---------- 5. global keys + gestures ------------------------------ */
function bindGlobals() {
  window.addEventListener('keydown', e => {
    if (covered()) return;   /* boot / lock screen owns the keyboard */
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

    /* the keys are the person's own (Settings › Shortcuts): js/core/keymap.js */
    if (KM.matches(e, 'win.cycle')) { e.preventDefault(); wm.cycle(e.shiftKey ? -1 : 1); return; }
    if (KM.matches(e, 'lock')) { e.preventDefault(); bus.emit('power:lock'); return; }
    if (e.key === 'Escape') { bus.emit('launcher:close'); return; }
    if (!typing && KM.matches(e, 'hint')) { e.preventDefault(); showHotkeyHint(6000); }

    /* Window management (Ctrl+Alt by default). Snapping and Enter stay live
       even in a text field — Ctrl+Alt with an arrow types nothing on any
       layout, and a snap that stops working the moment you click into Notes
       is not a snap. The letter and digit ones defer to typing: on several
       layouts AltGr is literally Ctrl+Alt, so Ctrl+Alt+digit is how people
       type. Stealing that would break writing to save a keystroke.
       (Minimise is core/wm.js's, with its other keys.) */
    const w = wm.getActive();
    if (!w) return;
    const SNAPS = { 'snap.left': 'left', 'snap.right': 'right', 'snap.top': 'up', 'snap.bottom': 'down' };
    for (const id in SNAPS) if (KM.matches(e, id)) { e.preventDefault(); wm.snap(w, SNAPS[id]); return; }
    if (KM.matches(e, 'win.max')) { e.preventDefault(); wm.toggleMax(w); return; }
    if (typing) return;

    const CORNERS = { 'snap.tl': 'tl', 'snap.tr': 'tr', 'snap.bl': 'bl', 'snap.br': 'br' };
    for (const id in CORNERS) if (KM.matches(e, id)) { e.preventDefault(); wm.snap(w, CORNERS[id]); return; }
    if (KM.matches(e, 'win.close.alt')) { e.preventDefault(); wm.close(w.id); return; }
    if (KM.matches(e, 'win.full')) {
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else w.el.requestFullscreen?.().catch(() => {});
    }
  });

  /* the desktop owns its own context menu; kill the browser's everywhere else
     except in text fields, where the native menu is genuinely useful */
  window.addEventListener('contextmenu', e => {
    const el = e.target;
    if (el.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
    if (el.closest('[data-native-menu]')) return;
    e.preventDefault();
  });

  /* never let a stray drag navigate the page away */
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  /* small-screen gate */
  const tooSmall = q('#too-small');
  const gate = () => {
    if (sessionStorage.getItem('aether.ignoreSize')) { tooSmall.classList.add('hidden'); return; }
    /* phones get the real mobile shell (js/shell/mobile.js); only genuinely
       tiny viewports still see the gate */
    tooSmall.classList.toggle('hidden', window.innerWidth >= 380);
  };
  q('#ts-anyway')?.addEventListener('click', () => {
    try { sessionStorage.setItem('aether.ignoreSize', '1'); } catch (err) {}
    tooSmall.classList.add('hidden');
  });
  window.addEventListener('resize', gate);
  gate();
}

/* ---------- 6. first impression ------------------------------------ */
function restoreSession(resume = null) {
  const a = wm.workArea();
  /* On the Linux drive the desktop's own terminal is the first thing to
     see; a Files window would sit on top of it. */
  const linuxDesk = deskterm.available();
  /* a phone starts on its home screen, like a phone (js/shell/mobile.js) */
  if (document.body.classList.contains('is-mobile')) return;
  if (resume && resume.restore()) return;
  /* restore: true — if Files was on another desktop when the page went away, it goes back there */
  if (a.w < 900) { if (!linuxDesk) wm.open('files', { restore: true }); return; }

  if (!linuxDesk) {
    wm.open('files', {
      restore: true,
      /* clear of the launcher on its left and the widget rail on its right,
         which it would otherwise cut through the clock of */
      w: Math.min(736, a.w - 460, Math.max(480, wm.freeWidth() - Math.round(a.w * 0.30) - 16)), h: Math.min(520, a.h - 120),
      x: Math.round(a.w * 0.30), y: a.y + 36,
    });
  }

  const first = !store.get('session.launched');
  if (first) {
    store.set('session.launched', true);
    setTimeout(() => bus.emit('launcher:toggle'), 460);
  }
}

/* After an update: the What's New sheet, once, listing the releases this
   person hasn't seen (js/shell/whatsnew-sheet.js). A first visit just
   records where they start — there is nothing to announce yet. */
async function announceVersion() {
  try {
    const W = await import(`./shell/whatsnew-sheet.js?v=${APP_ASSET_VERSION}`);
    window.Static.whatsNew = await W.checkAfterUpdate(HOST);
  } catch (err) { /* offline, or the sheet failed — the What's New app still has the notes */ }
}

function showHotkeyHint(ms = 4200) {
  let el = q('.hotkeys', HOST);
  if (!el) HOST.appendChild(el = h('div.hotkeys'));
  /* the rows js/core/keymap.js marks with a hint word, as this person has
     them (Settings › Shortcuts): first keys of the first row for each word */
  const kb = r => h('span.row', h('span.kbd', { text: KM.keysText(r.keys.split(' / ')[0]) }), h('span', { text: r.hint }));
  el.replaceChildren(...KM.globalRows().filter((r, i, all) => r.hint && all.findIndex(x => x.hint === r.hint) === i).map(kb));
  el.classList.add('is-on');
  clearTimeout(showHotkeyHint._t);
  showHotkeyHint._t = setTimeout(() => el.classList.remove('is-on'), ms);
}

/* ---------- 7. console conveniences -------------------------------- */
window.Static = {
  api, wm, store, bus, icon, h, failures, updater: null, offline: null, i18n,
  reset: () => { store.reset(); location.reload(); },
};

/* a start-up that throws gets the recovery screen, never a blank page */
boot().catch(err => {
  console.error('[StaticOS] boot failed', err);
  window.__staticBoot?.recover?.(err?.message || String(err));
});
