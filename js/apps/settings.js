/* ============================================================
   Settings — every StaticOS preference in one place.

   Two rules shaped this file more than anything else:

   1. A control that does not change the system is worse than no
      control. Every row here writes something the shell, an app
      or this file itself reads back. The old build shipped fan
      curves, refresh rates, output devices and a disk pie chart
      that were pure decoration — they are gone rather than
      "improved", because a browser tab cannot set any of them.

   2. Where a real number exists, it is read from a real API
      (js/core/metrics.js, navigator.storage, the Resource Timing
      buffer, build.json). Where one does not, the pane says so
      in plain words instead of inventing a figure.

   The preferences this app introduces (text scale, contrast,
   transparency, blur, shadows, focus outlines, mute) are applied
   by js/core/appearance.js, which main.js starts at boot, so they
   hold all session even though Settings is never opened (and this
   app's code only loads when its window does).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { store as GSTORE } from '../core/store.js';
import { chooseBackupFile, exportBackup } from '../core/backup.js';
import { usersPanel } from '../shell/users.js';
import * as SD from './settings-data.js';
import { foreign } from '../core/profiles.js';
import * as WP from '../portal/wallpapers.js';
import * as THEMES from '../core/themes.js';
import * as AIM from '../portal/aimodel.js';
import * as PACKS from '../core/packs.js';
import * as SEASON from '../core/season.js';
import * as M from '../core/metrics.js';
import * as LG from '../core/lowgfx.js';
import * as SMOOTH from '../core/smoothcheck.js';
import * as UV from '../portal/uv.js';
import * as PS from '../portal/proxy.status.js';
import * as PCAT from '../portal/proxy.catalog.js?v=ps5-cloud-proxy-v11';
import { applyOS } from '../shell/bootpicker.js';
import * as HW from '../core/halloween.js';
import * as GHOSTS from '../core/ghosts.js';
import { APPEARANCE_DEFAULTS, mqDark, syncAutoTheme, RECENT_KEY } from '../core/appearance.js';
import * as sfx from '../core/sfx.js';
import * as TAP from '../core/audiotap.js';
import * as SCREENTIME from './screentime-pane.js';
import * as WINTERPANE from './winter-pane.js';
import * as WINTER from '../core/winter.js';
import * as SC from './shortcuts-pane.js';
import { addStarterApps } from '../core/shortcuts.js';
import * as A11Y from './a11y-pane.js';
import * as WPX from './wallplus-pane.js';
import * as LOOKS from './looks-pane.js';
import * as CELPANE from './celebrate-pane.js';
import * as KM from '../core/keymap.js';
import * as SS from '../shell/screensaver.js';
import * as HC from '../shell/hotcorners.js';
import * as WL from '../core/winlayouts.js';
import * as SPEECH from '../core/speech.js';
import * as NP from './settings-notify.js';
import * as QP from './settings-quiet.js';
import * as SETUPS from './setups-pane.js';
import * as I18N from '../core/i18n.js';
import { appTile } from '../core/appart.js';
import { t as tr, plural } from '../core/i18n.js';

/* ============================================================
   Module scope — the parts that must run without a window
   ============================================================ */

/* Defaults for the preferences Settings owns. store.js carries the
   shell's own defaults; these are the ones nothing else knows about,
   so "reset" falls back to here. */
const OWN = {
  ...APPEARANCE_DEFAULTS,          /* text scale, contrast, blur, … mute */
  uiSounds: true,
  uiSoundVolume: 100,         /* the UI cues' own level under the system volume (js/core/sfx.js) */
  clickSounds: false,         /* opt-in: a tap for every click would be a lot */
  notiSounds: true,
  bootSounds: true,
  bootChime: 'glass',         /* the start-up chime: glass classic synth soft retro none (js/core/sfx.js) */
  desktopClock: true,
  deskHome: true,
  devEvents: true,
  soundPack: 'glass',
  iconStyle: 'glass',
  bootOS: 'plain',
  bootSkip: false,
  introVideo: true,
  tips: true,                 /* js/shell/tips.js */
  screensaver: SS.DEFAULT_DELAY,   /* minutes, 0 = off (js/shell/screensaver.js) */
  screensaverStyle: 'auto',        /* ghosts in spooky season, bubbles otherwise */
  screensaverClock: true,          /* the time and your next calendar event over the scene */
  lockClock: 'classic',            /* js/shell/lockscreen.js */
  lockWallpaper: '',               /* '' = the desktop's, shown through the glass */
  /* hot corners (js/shell/hotcorners.js): every corner does nothing until you choose */
  hotCornerTL: 'none', hotCornerTR: 'none', hotCornerBL: 'none', hotCornerBR: 'none',
  deskIconSize: 'medium',     /* Small / Medium / Large desktop icons (js/shell/deskicons.js) */
  wispServer: UV.WISP_SERVERS[0].id,
  weatherUnit: 'F',
  /* spooky season: spookyTheme, spookyCountdown, spookyEffects, spookySounds, spookyVolume, ghostHunt */
  ...SEASON.DEFAULTS,
  jumpScares: false,          /* opt-in only — see js/shell/halloween-fun.js */
  notiTone: 'none',           /* an advent calendar sound for notifications (js/core/winter.js) */
  desktopPet: true,           /* the cat on the dock — js/shell/pet.js */
  petKind: 'cat',             /* 'cat' | 'dog' | 'none' */
  petName: '',                /* what you call it (up to 20 characters) */
  weeklyRecap: true,          /* Sunday's card — js/shell/recap.js */
  wallpaperVisualizer: false, /* opt-in — js/shell/visualizer.js */
  /* looking after your data: settings-data.js */
  autoLock: 0,                /* minutes idle before the lock screen; 0 = never (js/shell/users.js) */
  reopenWindows: false,       /* start with the windows from last time (js/core/resume.js) */
  bootFast: false,            /* skip the boot animation and the disk picker (js/shell/boot.js) */
  backupRemindDays: 0,        /* remind after this many days without a backup; 0 = never (js/core/backup.js) */
  snapshots: true,            /* a daily copy of files and notes (js/core/snapshots.js) */
  keepPrevious: false,        /* keep the build before this one for tr("Use the previous version once") (sw.js) */
  dataSaver: 'auto',          /* 'auto' follows the browser's Data Saver (js/core/datasaver.js) */
  wpRotate: false,            /* js/core/wprotate.js */
  wpWeather: false,           /* js/core/wpweather.js */
  whatsNewAfterUpdate: true,  /* js/shell/whatsnew-sheet.js */
  visualizerStyle: 'bars',
  cursorSkin: 'none',
  /* read aloud (js/core/speech.js): '' is the browser's default voice */
  readVoice: '',
  readRate: 1,
  readPitch: 1,
  stBreakMin: 0,              /* Screen Time: a take-a-break note after this many minutes; 0 = off (js/core/screentime.js) */
  stGoalMin: 0,               /* Screen Time: a daily goal line on the chart; 0 = none */
};

const dflt = key => (OWN[key] !== undefined ? OWN[key] : GSTORE.defaults?.prefs?.[key]);

/* applyChrome, applyVolume, syncAutoTheme and the "recently changed"
   list live in js/core/appearance.js: they act all session, so they
   cannot wait for this app to load. */

/* ============================================================
   The settings index — one table, three jobs:
   it labels rows, it powers search, and it drives reset.
   `p` marks an id that is also a prefs key.
   ============================================================ */
const SET = {
  /* Appearance */
  theme:          { p: 1, sec: 'appearance', icon: 'moon', label: tr('Appearance mode'), desc: tr('Dark suits the Static wallpaper; light inverts the whole shell.') },
  themeAuto:      { p: 1, sec: 'appearance', icon: 'sun', label: tr('Match system appearance'), desc: tr('Follow the light or dark setting of the computer you are on.') },
  pixelIcons:     { p: 1, sec: 'appearance', icon: 'grid-9', label: tr('Pixel icons'), desc: tr('Draw every icon on a coarse grid with hard edges, in the current colour. Switch it off and the normal icons come straight back.') },
  iconStyle:      { p: 1, sec: 'appearance', icon: 'diamond', label: tr('Icon style'), desc: tr('The shape and finish of every app tile: Glass, Round, Sharp, Flat, Outline, Tinted (in the accent colour) or Clay (soft and puffy).') },
  density:        { p: 1, sec: 'appearance', icon: 'sliders', label: tr('Interface density'), desc: tr('Tightens or relaxes the top bar, dock and widget rail.') },

  /* Themes */
  accent:         { p: 1, sec: 'themes', icon: 'palette', label: tr('Accent colour'), desc: tr('Drives glows, active states and small highlights.') },
  'themes.packs': { sec: 'themes', icon: 'layers', label: tr('Theme packs'), desc: tr('An accent, a wallpaper and an icon style made to go together, in one click — and back again.') },

  /* Spooky Season (October 24 – November 1 only; js/core/season.js) */
  spookyTheme:    { p: 1, sec: 'spooky', icon: 'pumpkin', label: tr('Spooky Season'), desc: tr('An orange and purple accent, a haunted-house wallpaper and a jack-o’-lantern pointer, from October 24 to the end of November 1. Off puts StaticOS back exactly as it is the rest of the year.') },
  spookyCountdown:{ p: 1, sec: 'spooky', icon: 'clock', label: tr('Halloween countdown'), desc: tr('A widget on the desktop counting down to midnight on October 31, then wishing you a happy Halloween.') },
  spookyWallpaper:{ p: 1, sec: 'spooky', icon: 'image', label: tr('Haunted-house wallpaper'), desc: tr('Covers your wallpaper during the season. Picking a wallpaper of your own (a carved pumpkin, a treat…) turns this off so yours shows.') },
  spookyEffects:  { p: 1, sec: 'spooky', icon: 'wind', label: tr('Falling leaves and bats'), desc: tr('Drift across the wallpaper, behind your windows. They pause while the tab is hidden, in Game Mode and when wallpaper motion is off.') },
  spookySounds:   { p: 1, sec: 'spooky', icon: 'ghost', label: tr('Spooky sounds'), desc: tr('A creaky hinge when a window opens, a ghostly “boo” for notifications and a witch’s cackle when the Trash is emptied.') },
  spookyVolume:   { p: 1, sec: 'spooky', icon: 'volume', label: tr('Spooky sound volume'), desc: tr('How loud the spooky sounds are, under the system volume.') },

  /* Wallpaper */
  'wp.active':    { sec: 'wallpaper', icon: 'image', label: tr('Desktop wallpaper'), desc: tr('Built-in scenes, or any video, GIF or image you point it at.') },
  wallpaperGrid:  { p: 1, sec: 'wallpaper', icon: 'grid', label: tr('Wallpaper dot grid'), desc: tr('Static’s signature overlay texture.') },
  wallpaperGrain: { p: 1, sec: 'wallpaper', icon: 'sparkles', label: tr('Wallpaper grain'), desc: tr('A fine film grain over the desktop.') },
  'wp.add':       { sec: 'wallpaper', icon: 'plus', label: tr('Add a wallpaper'), desc: tr('Any https URL. Video loops muted, GIFs animate, stills cover.') },
  wallpaperVisualizer: { p: 1, sec: 'wallpaper', icon: 'activity', label: tr('Music visualizer'), desc: tr('While Music or Static Radio plays, the wallpaper moves with the music, behind your icons and windows. Drawn from the sound itself.') },
  visualizerStyle:{ p: 1, sec: 'wallpaper', icon: 'sliders', label: tr('Visualizer style'), desc: tr('Bars along the bottom, a wave, or particles that rise with the bass — in your accent colour.') },
  'wp.vis':       { sec: 'wallpaper', icon: 'music', label: tr('Visualizer right now'), desc: tr('What it is listening to, or what is in the way.') },
  /* rotation, Day and Night, weather and the auto accent: js/apps/wallplus-pane.js */
  wpRotate:       { p: 1, sec: 'wallpaper', icon: 'shuffle', label: tr('Change the wallpaper by itself'), desc: tr('A new picture every 15 minutes, hour or day, or each time StaticOS starts — from a folder of your pictures, or wallpapers you pick.') },
  'wp.daycycle':  { sec: 'wallpaper', icon: 'sun', label: tr('Day and Night wallpaper'), desc: tr('A lake and a cabin that go from dawn to day to dusk to night with your clock.') },
  wpWeather:      { p: 1, sec: 'wallpaper', icon: 'cloud-rain', label: tr('Weather on the wallpaper'), desc: tr('Rain, snow, clouds, fog or sun glare over any wallpaper, matching the real weather for the place in Weather.') },
  'accent.auto':  { sec: 'themes', icon: 'palette', label: tr('Auto accent from the wallpaper'), desc: tr('Picks the accent colour out of your wallpaper and changes with it.') },

  /* Dock */
  shellLayout:    { p: 1, sec: 'dock', icon: 'monitor', label: tr('Dock or taskbar'), desc: tr('The Dock floats in the middle of the bottom edge. A taskbar runs along the whole bottom edge with a Start button on the left, a name beside each open app and the Trash on the right. Same apps, same menus.') },
  launcherStyle:  { p: 1, sec: 'dock', icon: 'grid-9', label: tr('Launcher style'), desc: tr('A panel with pinned apps, or a Start menu with every app in a list on the left and the pinned ones on the right.') },
  'dock.order':   { sec: 'dock', icon: 'apps', label: tr('Dock apps and order'), desc: tr('What sits beside the launcher, left to right.') },
  dockMagnify:    { p: 1, sec: 'dock', icon: 'maximize-2', label: tr('Dock magnification'), desc: tr('Icons swell as the pointer sweeps across the dock.') },

  /* Desktop */
  desktopIcons:   { p: 1, sec: 'desktop', icon: 'grid-9', label: tr('Desktop icons'), desc: tr('Files and folders shown on the desktop layer.') },
  deskIconSize:   { p: 1, sec: 'desktop', icon: 'grid-9', label: tr('Desktop icon size'), desc: tr('Small, medium or large icons. Right-click the desktop for the same choice, plus Sort By and Clean Up.') },
  deskApps:       { sec: 'desktop', icon: 'monitor', label: tr('Favourite apps'), desc: tr('Puts Static Games, Arcade, Music and Notes on the desktop as shortcuts. Any that are already there are left alone. You can also right-click an app in the Dock or the launcher and choose Add to Desktop.') },
  'win.reset':    { sec: 'desktop', icon: 'window', label: tr('Window positions'), desc: tr('Each app opens where and how big you last left it. This puts them back to their usual places.') },
  widgetsVisible: { p: 1, sec: 'desktop', icon: 'sidebar', label: tr('Widget rail'), desc: tr('Clock, weather and system widgets down the right edge.') },
  desktopClock:   { p: 1, sec: 'desktop', icon: 'clock', label: tr('Clock on the wallpaper'), desc: tr('The big day, date and time in the middle of the desktop.') },
  devEvents:      { p: 1, sec: 'desktop', icon: 'sparkles', label: tr('Events from the developer'), desc: tr('Confetti, snow, disco colours or a shared accent when the developer runs an event. Announcements still show; you can dismiss them.') },
  deskHome:       { p: 1, sec: 'desktop', icon: 'zap', label: tr('Continue and Quick Play'), desc: tr('Under the wallpaper clock: the game you played last, and a button that picks one for you.') },
  lang:           { sec: 'desktop', icon: 'globe', label: tr('Language'), desc: tr('The words StaticOS uses, and how dates and numbers are written. Until you choose, it follows your browser. The page reloads to apply it; your windows come back.') },
  h24:            { p: 1, sec: 'desktop', icon: 'clock', label: tr('24-hour clock'), desc: tr('Used by the menu bar clock, the widget and the lock screen.') },
  weatherUnit:    { p: 1, sec: 'desktop', icon: 'thermometer', label: tr('Temperature unit'), desc: tr('Read by the Weather app and the weather widget.') },
  bootOS:         { p: 1, sec: 'desktop', icon: 'hard-drive', label: tr('Startup disk'), desc: tr('Linux, Windows or plain StaticOS — each boots with its own animation, and restyles the default wallpaper.') },
  bootSkip:       { p: 1, sec: 'desktop', icon: 'skip-forward', label: tr('Skip the disk picker'), desc: tr('Boot the startup disk straight away instead of showing the selector.') },
  autoLock:       { p: 1, sec: 'desktop', icon: 'lock', label: tr('Lock when idle'), desc: tr('Show the lock screen after this long with no key, click or touch. It asks for your PIN if you set one; nothing is closed or saved differently.') },
  reopenWindows:  { p: 1, sec: 'desktop', icon: 'window', label: tr('Reopen what I had open'), desc: tr('Start with the windows from last time, where they were, instead of one starter window. Only what each app can say it was showing comes back, not text you hadn’t saved.') },
  bootFast:       { p: 1, sec: 'desktop', icon: 'zap', label: tr('Skip the boot animation'), desc: tr('Go straight to the desktop: no splash, no disk picker. For slow computers.') },
  introVideo:     { p: 1, sec: 'desktop', icon: 'video', label: tr('Offer the StaticOS video'), desc: tr('When StaticOS starts, a card in the corner offers the two-minute video. It never plays by itself.') },
  tips:           { p: 1, sec: 'desktop', icon: 'sparkles', label: tr('Tip of the day'), desc: tr('At most once a day, a small card shares one short tip about something StaticOS can do. Next tip and Show me are on the card.') },
  stickers:       { sec: 'desktop', icon: 'sparkles', label: tr('Desktop stickers'), desc: tr('30 stickers drawn in StaticOS, free for everyone. Put one on the desktop, then drag it where you like; right-click a sticker to remove it.') },
  screensaver:    { p: 1, sec: 'desktop', icon: 'moon', label: tr('Screensaver'), desc: tr('Starts after this long without a key press or pointer move — never while a video or music plays, a game or anything full screen is in front, or the tab is hidden. Any key or pointer move brings the desktop back.') },
  desktopPet:     { p: 1, sec: 'desktop', icon: 'cat', label: tr('Desktop pet'), desc: tr('A little cat that wanders along the top of the dock (a ghost in spooky season), sits when you stop moving the pointer and naps after a while. Click it and it jumps. It holds still with reduced motion and rests in Game Mode.') },
  hotCornerTL:    { p: 1, sec: 'desktop', icon: 'mouse-pointer', label: tr('Top-left hot corner'), desc: tr('Push the pointer into this corner and hold it there a moment. Never while dragging, in full screen or on a phone; works best with StaticOS in full screen, where the pointer stops at the corner by itself.') },
  hotCornerTR:    { p: 1, sec: 'desktop', icon: 'mouse-pointer', label: tr('Top-right hot corner'), desc: tr('The same, in the top-right corner.') },
  hotCornerBL:    { p: 1, sec: 'desktop', icon: 'mouse-pointer', label: tr('Bottom-left hot corner'), desc: tr('The same, in the bottom-left corner.') },
  hotCornerBR:    { p: 1, sec: 'desktop', icon: 'mouse-pointer', label: tr('Bottom-right hot corner'), desc: tr('The same, in the bottom-right corner.') },
  screensaverClock:{ p: 1, sec: 'desktop', icon: 'clock', label: tr('Screensaver clock and next event'), desc: tr('The time and date over the scene, and the next thing on your Calendar (its title and when). It only reads your own calendar on this computer.') },
  lockClock:      { p: 1, sec: 'desktop', icon: 'clock', label: tr('Lock screen clock'), desc: tr('Classic, Bold, Stacked or Analogue.') },
  lockWallpaper:  { p: 1, sec: 'desktop', icon: 'image', label: tr('Lock screen wallpaper'), desc: tr('A picture just for the lock screen, or the desktop showing through the glass.') },
  snippets:       { sec: 'keyboard', icon: 'type', label: tr('Text snippets'), desc: tr('Type a short code and a space in any text box and it becomes a longer text.') },
  dndAllow:       { sec: 'notifications', icon: 'bell', label: tr('Let through Do Not Disturb'), desc: tr('Apps and friends whose pop-ups still show while Do Not Disturb is on.') },
  screensaverStyle:{ p: 1, sec: 'desktop', icon: 'sparkles', label: tr('Screensaver style'), desc: tr('Floating bubbles, a starfield, an aquarium, 3D pipes or a slow night sky — and ghosts during spooky season. With reduced motion it is a still scene that slowly fades.') },

  /* Windows */
  uiBlur:         { p: 1, sec: 'windows', icon: 'layers', label: tr('Background blur'), desc: tr('The glass effect behind windows, menus and the dock. Turning it off is the single biggest speed-up on a weak machine.') },
  uiShadows:      { p: 1, sec: 'windows', icon: 'box', label: tr('Deep window shadows'), desc: tr('Large soft shadows under floating windows.') },
  'win.actions':  { sec: 'windows', icon: 'window', label: tr('Open windows'), desc: tr('Everything on screen right now.') },

  /* Notifications */
  dnd:            { p: 1, sec: 'notifications', icon: 'dnd', label: tr('Do Not Disturb'), desc: tr('Toasts are silenced; everything still lands in the drawer. Homework reminders and the focus timer’s end note still pop up.') },
  notiApps:       { sec: 'notifications', icon: 'bell', label: tr('Per-app notifications'), desc: tr('Silence one app without silencing the rest.') },
  'noti.test':    { sec: 'notifications', icon: 'bell', label: tr('Send a test notification'), desc: tr('Shows exactly what an alert looks like from here.') },
  'noti.ach':     { sec: 'notifications', icon: 'star', label: tr('Achievement toasts'), desc: tr('A toast when you earn an achievement. Off, they still land in the Notification Centre’s Achievements tab.') },

  /* Keyboard */
  'kb.tester':    { sec: 'keyboard', icon: 'keyboard', label: tr('Key tester'), desc: tr('Press anything to see what the browser reports.') },
  'kb.mod':       { sec: 'keyboard', icon: 'command', label: tr('Modifier key'), desc: tr('Which key Static treats as the command modifier.') },

  /* Shortcuts */
  'sc.list':      { sec: 'shortcuts', icon: 'command', label: tr('System shortcuts'), desc: tr('Every combination Static binds — and Change… to make any of them your own.') },

  /* Accessibility */
  reduceMotion:   { p: 1, sec: 'accessibility', icon: 'activity', label: tr('Reduce motion'), desc: tr('The one switch for movement: window, dock and boot animations become instant, and the video wallpaper, the desktop pet and the screensaver hold still.') },
  textScale:      { p: 1, sec: 'accessibility', icon: 'type', label: tr('Text size'), desc: tr('Scales interface text across the whole system.') },
  contrast:       { p: 1, sec: 'accessibility', icon: 'eye', label: tr('Contrast'), desc: tr('Increased: brighter text, harder borders, less translucency. High contrast: black, white and yellow everywhere, with a plain black desktop.') },
  uiTransparency: { p: 1, sec: 'accessibility', icon: 'square', label: tr('Reduce transparency'), desc: tr('Makes glass surfaces solid so text sits on a flat background.') },
  focusRings:     { p: 1, sec: 'accessibility', icon: 'mouse-pointer', label: tr('Always show focus outline'), desc: tr('Normally the outline appears only for keyboard users.') },
  readVoice:      { p: 1, sec: 'accessibility', icon: 'volume-2', label: tr('Read-aloud voice'), desc: tr('One of the voices this browser offers. “Online” voices need the internet.') },
  readRate:       { p: 1, sec: 'accessibility', icon: 'gauge', label: tr('Reading speed'), desc: tr('1× is the voice’s own pace.') },
  readPitch:      { p: 1, sec: 'accessibility', icon: 'activity', label: tr('Voice pitch'), desc: tr('Lower or higher than the voice’s own.') },
  'read.try':     { sec: 'accessibility', icon: 'play', label: tr('Try it'), desc: tr('Reads a sentence with the voice, speed and pitch above.') },
  'a11y.system':  { sec: 'accessibility', icon: 'info', label: tr('System accessibility settings'), desc: tr('What this computer is already asking for.') },
  /* drawn by js/apps/a11y-pane.js (extras) */
  reduceClutter:  { sec: 'accessibility', icon: 'sparkles', label: tr('Reduce clutter'), desc: tr('Turns off the desktop pet, the widget rail, seasonal effects, the music visualiser, weather on the wallpaper and animation, together. “Bring it back” puts back only what this changed.') },
  largePointer:   { p: 1, sec: 'accessibility', icon: 'mouse-pointer', label: tr('Large pointer'), desc: tr('A bigger arrow, hand and text cursor. A pointer skin you earned keeps its own look.') },
  focusSize:      { p: 1, sec: 'accessibility', icon: 'square', label: tr('Focus outline size'), desc: tr('How thick the outline is round whatever the keyboard has selected.') },
  osk:            { p: 1, sec: 'accessibility', icon: 'keyboard', label: tr('On-screen keyboard'), desc: tr('A keyboard you click or touch. It types into the text field you were last in, and you can drag it out of the way.') },
  soundCaptions:  { p: 1, sec: 'accessibility', icon: 'captions', label: tr('Captions for sounds'), desc: tr('Shows “Notification sound”, “Error sound” or “Timer sound” on screen when StaticOS plays one, even with the sound muted.') },
  flashAlerts:    { p: 1, sec: 'accessibility', icon: 'zap', label: tr('Flash the screen for alerts'), desc: tr('One soft flash at the screen’s edge when a notification, error or timer sound would play. Never more than once a second.') },
  'alert.try':    { sec: 'accessibility', icon: 'play', label: tr('Try the alert'), desc: tr('Shows what you have turned on, as it would for a notification.') },
  videoCaptions:  { p: 1, sec: 'accessibility', icon: 'captions', label: tr('Captions on StaticOS videos'), desc: tr('StaticOS’s own videos (the tour and the seasonal videos) come with captions. This opens them with captions on; Videos has a CC button either way.') },
  a11yMenu:       { p: 1, sec: 'accessibility', icon: 'accessibility', label: tr('Accessibility menu in the status bar'), desc: tr('A button next to the Control Centre with text size, the magnifier, colour filters, contrast, motion and the on-screen keyboard.') },
  magnifier:      { p: 1, sec: 'accessibility', icon: 'zoom-in', label: tr('Magnifier'), desc: tr('A lens that follows the pointer and enlarges what is under it.') },
  magZoom:        { p: 1, sec: 'accessibility', icon: 'search', label: tr('Zoom'), desc: tr('How much the magnifier enlarges.') },
  magSize:        { p: 1, sec: 'accessibility', icon: 'circle', label: tr('Lens size'), desc: tr('Across, in pixels.') },
  magFollow:      { p: 1, sec: 'accessibility', icon: 'mouse-pointer', label: tr('Follows'), desc: tr('Keyboard focus moves it when you Tab or use the arrows.') },
  magMode:        { p: 1, sec: 'accessibility', icon: 'maximize-2', label: tr('View'), desc: tr('A lens, or the whole screen zoomed and panning with the pointer.') },
  colorFilter:    { p: 1, sec: 'accessibility', icon: 'droplet', label: tr('Colour filter'), desc: tr('For colour blindness, or grayscale. Applies to the whole screen.') },
  colorFilterMode: { p: 1, sec: 'accessibility', icon: 'filter', label: tr('Filter kind'), desc: tr('Correct colours to tell them apart, or simulate how they look.') },
  colorFilterStrength: { p: 1, sec: 'accessibility', icon: 'sliders', label: tr('Filter strength'), desc: tr('0% is no change.') },
  fontFace:       { p: 1, sec: 'accessibility', icon: 'type', label: tr('Reading font'), desc: tr('OpenDyslexic is made for dyslexia; Atkinson Hyperlegible for low vision.') },
  lineHeight:     { p: 1, sec: 'accessibility', icon: 'list', label: tr('Line spacing'), desc: tr('Space between lines, in every app.') },
  letterSpacing:  { p: 1, sec: 'accessibility', icon: 'type', label: tr('Letter spacing'), desc: tr('Space between letters, in every app.') },
  wordSpacing:    { p: 1, sec: 'accessibility', icon: 'sliders', label: tr('Word spacing'), desc: tr('Space between words, in every app.') },

  /* Proxy */
  'proxy.state':  { sec: 'proxy', icon: 'shield', label: tr('Proxy status'), desc: tr('Whether the service worker and tunnel are running.') },
  wispServer:     { p: 1, sec: 'proxy', icon: 'network', label: tr('Relay server'), desc: tr('Which public wisp endpoint the tunnel connects through.') },
  'proxy.obs':    { sec: 'proxy', icon: 'list', label: tr('Directory observations'), desc: tr('What the proxy directory has actually seen work.') },

  /* Network */
  dataSaver:      { p: 1, sec: 'network', icon: 'zap', label: tr('Data saver'), desc: tr('No videos that start by themselves, pictures that load as they come into view, and an offline copy that fills in as you go.') },
  'net.state':    { sec: 'network', icon: 'globe', label: tr('Connection'), desc: tr('What the browser will say about this network.') },

  /* Privacy */
  'privacy.data': { sec: 'privacy', icon: 'database', label: tr('Data stored on this device'), desc: tr('Every key Static keeps in this browser profile.') },
  'privacy.sw':   { sec: 'privacy', icon: 'refresh', label: tr('Service workers'), desc: tr('Workers registered on this origin.') },
  'privacy.hosts':{ sec: 'privacy', icon: 'globe', label: tr('Hosts contacted'), desc: tr('Every other origin this tab has loaded from.') },
  'privacy.reset':{ sec: 'privacy', icon: 'trash', label: tr('Erase stored data'), desc: tr('Put StaticOS back to a first-run state.') },

  /* Sound */
  volume:         { p: 1, sec: 'sound', icon: 'volume', label: tr('Output volume'), desc: tr('Applies to audio and video playing inside Static.') },
  muted:          { p: 1, sec: 'sound', icon: 'volume-x', label: tr('Mute'), desc: tr('Silences media Static is playing, without losing the level.') },
  uiSounds:       { p: 1, sec: 'sound', icon: 'volume-2', label: tr('UI sounds'), desc: tr('A soft cue when a window opens or closes, and the click and notification sounds below.') },
  soundPack:      { p: 1, sec: 'sound', icon: 'music', label: tr('Sound pack'), desc: tr('The voice of the UI cues: Glass, 8-Bit, Felt, Switches, Chimes, Typewriter, Nature or Sci-fi. All synthesised as they play. Also in the Store under Sounds.') },
  uiSoundVolume:  { p: 1, sec: 'sound', icon: 'volume', label: tr('UI sound volume'), desc: tr('How loud the UI cues are, under the output volume above.') },
  clickSounds:    { p: 1, sec: 'sound', icon: 'mouse-pointer', label: tr('Click sounds'), desc: tr('A soft tap when you click a button, tab or link, and a tick for a switch. Instruments like Piano and Beats stay out of it.') },
  notiSounds:     { p: 1, sec: 'sound', icon: 'bell', label: tr('Notification sounds'), desc: tr('A chime when a notification arrives. Never in Do Not Disturb or for an app you silenced under Notifications.') },
  bootSounds:     { p: 1, sec: 'sound', icon: 'hard-drive', label: tr('Boot sounds'), desc: tr('Menu beeps, key clicks, the Linux drive hum and each drive\'s start-up chime. Heard once a key is pressed at the boot menu — browsers only allow sound after you interact.') },
  'sound.startup':{ sec: 'sound', icon: 'music', label: tr('Startup chime'), desc: tr('Pick the sound StaticOS plays once the desktop is up: Glass, Classic, Synth, Soft, Retro or None.') },
  'noti.summary': { sec: 'notifications', icon: 'bell', label: tr('Notification summary'), desc: tr('Hold quiet notifications and deliver them together at times you choose.') },
  'dnd.sched':    { sec: 'notifications', icon: 'moon', label: tr('Do Not Disturb schedule'), desc: tr('Turn Do Not Disturb on by itself at night or during school hours.') },
  'sound.mixer':  { sec: 'sound', icon: 'sliders', label: tr('Volume mixer'), desc: tr('A level for each app’s own sound, under the output volume. Only sound StaticOS’s own apps play; never sound inside another site’s page or game.') },
  'sound.devices':{ sec: 'sound', icon: 'cast', label: tr('Audio devices'), desc: tr('What the browser will admit is plugged in.') },

  /* Display */
  brightness:     { p: 1, sec: 'display', icon: 'sun', label: tr('Brightness'), desc: tr('Dims the whole desktop, windows included.') },
  nightShift:     { p: 1, sec: 'display', icon: 'night-shift', label: tr('Night Shift'), desc: tr('Warms the colour of everything on screen.') },
  'display.full': { sec: 'display', icon: 'expand', label: tr('Full screen'), desc: tr('Hand the whole display over to StaticOS.') },
  'display.facts':{ sec: 'display', icon: 'monitor', label: tr('Display information'), desc: tr('Measured from this screen and this window.') },

  /* Performance */
  'perf.live':    { sec: 'performance', icon: 'activity', label: tr('Live readings'), desc: tr('Frame rate, memory and page timing.') },
  'perf.low':     { sec: 'performance', icon: 'zap', label: tr('Low graphics mode'), desc: tr('One switch for every setting that costs frames.') },
  gameMode:       { p: 1, sec: 'performance', icon: 'gamepad', label: tr('Game Mode'), desc: tr('Turns off blur, shadows, shell animations, the wallpaper video and widget updates so a game gets the frames.') },
  labStaticumAI:  { p: 1, sec: 'labs', icon: 'sparkles', label: tr('Staticum asks a free AI when it has no answer'), desc: tr('When none of Staticum’s skills fit a question, it asks a small free AI model (GPT-OSS 20B) instead of saying it can’t help. Answers can be wrong or off the point; your question is sent to text.pollinations.ai.') },
  labFps:         { p: 1, sec: 'labs', icon: 'activity', label: tr('Frame-rate counter'), desc: tr('A small fps readout in the corner, measured from real animation frames — handy while gaming.') },
  labCompact:     { p: 1, sec: 'labs', icon: 'maximize', label: tr('Compact title bars'), desc: tr('Shorter window title bars for more room on small screens.') },
  gameModeAuto:   { p: 1, sec: 'performance', icon: 'gamepad', label: tr('Game Mode while a game is in front'), desc: tr('Switches on by itself when Static Games, Arcade, Play, Forge, Studio, Cloud or Roblox is the active window.') },
  'perf.cant':    { sec: 'performance', icon: 'help-circle', label: tr('What cannot be measured'), desc: tr('The readings no browser will give a page.') },

  /* Storage */
  'storage.apps':   { sec: 'storage', icon: 'package', label: tr('Storage by app'), desc: tr('What Notes, Photos, Music, Videos, projects and clips are each holding, with Clear for each.') },
  'storage.usage':  { sec: 'storage', icon: 'hard-drive', label: tr('Storage in use'), desc: tr('Reported by the browser for this origin.') },
  'storage.persist':{ sec: 'storage', icon: 'lock', label: tr('Keep my data'), desc: tr('Ask the browser not to clear StaticOS’s saved files, notes and settings when the disk gets full.') },
  snapshots:      { p: 1, sec: 'storage', icon: 'camera', label: tr('Daily snapshots'), desc: tr('Once a day, copy your files and notes into your own storage so you can go back to an earlier day.') },
  'backup.last':  { sec: 'privacy', icon: 'clock', label: tr('Last backup'), desc: tr('When you last downloaded a backup, and whether your files or notes changed since.') },
  backupRemindDays: { p: 1, sec: 'privacy', icon: 'bell', label: tr('Remind me to back up'), desc: tr('A notification after this many days without a backup. Do Not Disturb holds it back.') },
  'storage.trash':  { sec: 'storage', icon: 'trash', label: tr('Empty the Trash after 30 days'), desc: tr('Delete Trash items for good once they have been there 30 days.') },
  'storage.caches': { sec: 'storage', icon: 'database', label: tr('Caches and databases'), desc: tr('What the proxy and the apps have cached.') },

  /* Applications */
  'apps.list':    { sec: 'applications', icon: 'package', label: tr('Installed apps'), desc: tr('Everything that registered at boot.') },
  'apps.state':   { sec: 'applications', icon: 'rotate-ccw', label: tr('App preferences'), desc: tr('Reset the state one app has saved.') },

  /* Setups & modes (js/apps/setups-pane.js, js/core/setup.js) */
  'setups.modes': { sec: 'setups', icon: 'moon', label: tr('Modes'), desc: tr('Study, Gaming and Chill: a handful of settings switched together, and put back when you turn the mode off.') },
  'setups.list':  { sec: 'setups', icon: 'layers', label: tr('Your setups'), desc: tr('Keep your settings, Dock and look under a name (Home, School, Night) and switch in one click.') },
  'setups.move':  { sec: 'setups', icon: 'upload', label: tr('Move your settings'), desc: tr('Save your settings to a file and open it on another computer. Only settings: no files, notes or saves.') },
  'changed.all':  { sec: 'changed', icon: 'rotate-ccw', label: tr('Changed from default'), desc: tr('Every setting that is not at its default, each with a Reset.') },

  /* Winter (December 1 – January 1; js/core/season.js, js/core/winter.js, js/apps/winter-pane.js) */
  winterTheme:    { p: 1, sec: 'winter', icon: 'snowflake', label: tr('Winter'), desc: tr('A warm cranberry-and-gold accent and a snowy village wallpaper, from December 1 to the end of January 1. Off puts StaticOS back exactly as it is the rest of the year.') },
  winterWallpaper:{ p: 1, sec: 'winter', icon: 'image', label: tr('Snowy village wallpaper'), desc: tr('Covers your wallpaper during the season. Picking a wallpaper of your own (an advent treat, anything) turns this off so yours shows.') },
  winterCountdown:{ p: 1, sec: 'winter', icon: 'clock', label: tr('Christmas countdown'), desc: tr('A widget on the desktop counting down to midnight on December 25.') },
  winterSnow:     { p: 1, sec: 'winter', icon: 'cloud-snow', label: tr('Falling snow'), desc: tr('Drifts across the wallpaper, behind your windows. It pauses while the tab is hidden, in Game Mode and when wallpaper motion is off.') },
  winterAdvent:   { p: 1, sec: 'winter', icon: 'gift', label: tr('Advent calendar'), desc: tr('A gift in the dock opens 24 doors, one a day from December 1 to 24 by this computer’s date, each with a treat that is yours to keep.') },
  'wn.advent':    { sec: 'winter', icon: 'calendar', label: tr('Doors opened'), desc: tr('Counted on this device. Today’s door and any you missed can be opened; tomorrow’s waits.') },
  'wn.cursor':    { sec: 'winter', icon: 'mouse-pointer', label: tr('Cursor'), desc: tr('A pointer from the advent calendar. Normal puts the usual one back.') },
  'wn.stickers':  { sec: 'winter', icon: 'sparkles', label: tr('Desktop stickers'), desc: tr('Put one on the desktop, then drag it where you like. Right-click a sticker to remove it.') },
  'wn.walls':     { sec: 'winter', icon: 'image', label: tr('Winter wallpapers'), desc: tr('Wallpapers from the advent calendar. They are in the Wallpaper pane too.') },
  notiTone:       { p: 1, sec: 'winter', icon: 'bell', label: tr('Notification sound'), desc: tr('A sound from the advent calendar for every notification instead of your sound pack’s chime. Usual puts the chime back.') },

  /* Celebrations (js/core/season.js, js/shell/celebrate.js, js/apps/celebrate-pane.js) */
  newyearTheme:    { p: 1, sec: 'celebrations', icon: 'sparkles', label: tr('New Year’s'), desc: tr('A countdown for the last ten minutes of December 31 and fireworks at midnight, once. The season runs from 6 pm on December 31 to the end of January 1.') },
  newyearCountdown:{ p: 1, sec: 'celebrations', icon: 'clock', label: tr('New Year countdown'), desc: tr('The last ten minutes before midnight, by this computer’s clock, at the top of the desktop.') },
  newyearFireworks:{ p: 1, sec: 'celebrations', icon: 'zap', label: tr('Midnight fireworks'), desc: tr('Play once at midnight, behind your windows. With reduce motion on you get a still picture instead.') },
  birthdayTheme:   { p: 1, sec: 'celebrations', icon: 'gift', label: tr('Birthday'), desc: tr('Confetti and a card on your birthday, once a year. Needs the date below.') },
  birthdayConfetti:{ p: 1, sec: 'celebrations', icon: 'sparkles', label: tr('Birthday confetti'), desc: tr('Plays once on the day. With reduce motion on you get a still picture instead.') },
  birthdayCard:    { p: 1, sec: 'celebrations', icon: 'gift', label: tr('Birthday card'), desc: tr('A small card, once on the day. Close it and it stays closed, reload included.') },
  'bd.date':       { sec: 'celebrations', icon: 'calendar', label: tr('Your birthday'), desc: tr('Month and day only — no year. Kept in your settings on this device, and never sent to friends, presence, or anywhere online. February 29 is kept on February 28 in years without one.') },
  valentineTheme:  { p: 1, sec: 'celebrations', icon: 'heart', label: tr('Valentine’s'), desc: tr('A rose accent and hearts drifting over the wallpaper, February 1–14. Off puts StaticOS back exactly as it is the rest of the year.') },
  valentineHearts: { p: 1, sec: 'celebrations', icon: 'heart', label: tr('Floating hearts'), desc: tr('Drift up the wallpaper, behind your windows. They pause while the tab is hidden, in Game Mode and when wallpaper motion is off; reduce motion gets a still scatter.') },
  springTheme:     { p: 1, sec: 'celebrations', icon: 'sun', label: tr('Spring'), desc: tr('A fresh green-and-blossom accent and cherry blossoms drifting over the wallpaper, March and April. Off puts StaticOS back exactly as it is the rest of the year.') },
  springBlossoms:  { p: 1, sec: 'celebrations', icon: 'sun', label: tr('Cherry blossoms'), desc: tr('Drift down the wallpaper, behind your windows. They pause while the tab is hidden, in Game Mode and when wallpaper motion is off; reduce motion gets a still scatter.') },

  /* looks: styles, the sun, typing sounds, the CRT start-up (js/apps/looks-pane.js) */
  themeSun:       { p: 1, sec: 'appearance', icon: 'sun', label: tr('Light by day, dark by night'), desc: tr('Switch between light and dark at the real sunrise and sunset of the place Weather has, or at 6:30 and 19:30 without one. Choosing light or dark by hand turns it off.') },
  dockStyle:      { p: 1, sec: 'appearance', icon: 'apps', label: tr('Dock style'), desc: tr('Glass, Solid or Minimal.') },
  barStyle:       { p: 1, sec: 'appearance', icon: 'window', label: tr('Top bar style'), desc: tr('Default, Transparent or Compact.') },
  uiFont:         { p: 1, sec: 'appearance', icon: 'type', label: tr('Interface font'), desc: tr('The typeface the interface is set in: Default, System, Rounded, Serif or Monospace.') },
  typeSounds:     { p: 1, sec: 'sound', icon: 'keyboard', label: tr('Typing sounds'), desc: tr('A soft key sound as you type in a text field, in your sound pack’s voice. Off unless you turn it on.') },
  bootCrt:        { p: 1, sec: 'desktop', icon: 'monitor', label: tr('Retro CRT start-up'), desc: tr('The start-up splash as a green screen that switches on and off.') },

  /* the rest of the year (js/shell/seasons-more.js, js/apps/celebrate-pane.js) — batch "looks" */
  autumnTheme:     { p: 1, sec: 'celebrations', icon: 'sun', label: tr('Autumn'), desc: tr('A warm amber accent and leaves falling over the wallpaper, November 2–30. Off puts StaticOS back exactly as it is the rest of the year.') },
  autumnLeaves:    { p: 1, sec: 'celebrations', icon: 'wind', label: tr('Falling leaves'), desc: tr('Drift down the wallpaper, behind your windows. They pause while the tab is hidden, in Game Mode and when wallpaper motion is off; reduce motion gets a still scatter.') },
  autumnGratitude: { p: 1, sec: 'celebrations', icon: 'heart', label: tr('Gratitude list'), desc: tr('A card on Thanksgiving (the fourth Thursday of November) that opens your list. The list itself is below, any day.') },
  lunarTheme:      { p: 1, sec: 'celebrations', icon: 'sparkles', label: tr('Lunar New Year'), desc: tr('A red-and-gold accent and lanterns rising over the wallpaper, from New Year’s Eve to the Lantern Festival (15 days).') },
  lunarLanterns:   { p: 1, sec: 'celebrations', icon: 'zap', label: tr('Lanterns and fireworks'), desc: tr('Lanterns rise all season; fireworks play once on New Year’s Day, behind your windows. Reduce motion gets still pictures.') },
  stpatrickTheme:  { p: 1, sec: 'celebrations', icon: 'sparkles', label: tr('St Patrick’s Day'), desc: tr('A clover-green accent, March 10–17.') },
  cloverHunt:      { p: 1, sec: 'celebrations', icon: 'search', label: tr('Clover hunt'), desc: tr('Nine clovers lie on the desktop behind your windows, one with four leaves. Click each to collect it; they are in the same places all year.') },
  pidayTheme:      { p: 1, sec: 'celebrations', icon: 'calculator', label: tr('Pi Day'), desc: tr('A blue accent on March 14.') },
  piChallenge:     { p: 1, sec: 'celebrations', icon: 'calculator', label: tr('Pi Day challenge'), desc: tr('A card, once, that opens the digit challenge and five circle puzzles. They are in the pane below any day.') },
  earthTheme:      { p: 1, sec: 'celebrations', icon: 'globe', label: tr('Earth Day'), desc: tr('A blue-green accent, April 20–22.') },
  earthSeeds:      { p: 1, sec: 'celebrations', icon: 'wind', label: tr('Drifting seeds'), desc: tr('Seeds and leaves drift up the wallpaper, behind your windows. Reduce motion gets a still scatter.') },
  summerTheme:     { p: 1, sec: 'celebrations', icon: 'sun', label: tr('Summer'), desc: tr('A sea-glass accent and sun glints and bubbles drifting up the wallpaper, June 1 – August 14.') },
  summerSparkle:   { p: 1, sec: 'celebrations', icon: 'sparkles', label: tr('Glints and bubbles'), desc: tr('Drift up the wallpaper, behind your windows. Reduce motion gets a still scatter.') },
  summerCountdown: { p: 1, sec: 'celebrations', icon: 'clock', label: tr('Countdown to the holidays'), desc: tr('A desktop widget counting down to the day you set below. Nothing shows until you set one.') },
  'summer.break':  { sec: 'celebrations', icon: 'calendar', label: tr('The holidays start'), desc: tr('The first day of your holidays. Kept on this device; the countdown uses this computer’s clock.') },
  schoolTheme:     { p: 1, sec: 'celebrations', icon: 'file-text', label: tr('Back to school'), desc: tr('A pencil-yellow accent, August 15 – September 14.') },
  schoolKit:       { p: 1, sec: 'celebrations', icon: 'check', label: tr('Planner kit'), desc: tr('A card, once, that opens a first-week checklist with the study apps a click away. The kit is below any day.') },
  firstsnowTheme:  { p: 1, sec: 'celebrations', icon: 'snowflake', label: tr('First snow where you live'), desc: tr('Off until you turn it on. It checks Open-Meteo, a few times a day while StaticOS is open, for snow at one place you allow — and the first time it finds some, flakes fall on your desktop for a day.') },
  firstsnowFlakes: { p: 1, sec: 'celebrations', icon: 'snowflake', label: tr('Falling flakes'), desc: tr('Flakes over the wallpaper for the day it snows. Reduce motion gets a still scatter.') },
  'seasons.try':   { sec: 'celebrations', icon: 'eye', label: tr('Try a season'), desc: tr('Put a season on for one minute, whatever the date, to see what it looks like. Nothing is saved and it ends by itself.') },

  /* Screen Time */
  petKind:        { p: 1, sec: 'desktop', icon: 'cat', label: tr('Pet kind'), desc: tr('A cat, a dog, or no pet at all. In spooky season it is still a ghost.') },
  petName:        { p: 1, sec: 'desktop', icon: 'type', label: tr('Pet name'), desc: tr('What you call it. It shows when you hover it and in what it says.') },
  stBreakMin:     { p: 1, sec: 'screentime', icon: 'clock', label: tr('Take a break'), desc: tr('A gentle note after this long using StaticOS without a five-minute break. Only a reminder: nothing is paused or closed.') },
  stGoalMin:      { p: 1, sec: 'screentime', icon: 'bar-chart', label: tr('Daily goal'), desc: tr('Draws a goal line on the Screen Time chart. It never stops anything.') },
  'st.compare':   { sec: 'screentime', icon: 'bar-chart', label: tr('This week against last week'), desc: tr('Your total, and which apps moved most, against the 7 days before.') },
  'st.csv':       { sec: 'screentime', icon: 'download', label: tr('Export as CSV'), desc: tr('The last 56 days, one row per app and game per day, as a file for a spreadsheet.') },
  'a11y.preview': { sec: 'accessibility', icon: 'type', label: tr('Text preview'), desc: tr('Font, size, spacing and contrast together, on real text.') },
  weeklyRecap:    { p: 1, sec: 'screentime', icon: 'calendar', label: tr('Weekly recap'), desc: tr('Every Sunday (or your first visit after it), a card with the week this device measured: time, top apps and games, focus sessions, what you made and badges earned.') },

  /* Halloween */
  'hw.season':    { sec: 'halloween', icon: 'pumpkin', label: tr('Halloween season'), desc: tr('24 October – 1 November, by this computer’s date.') },
  jumpScares:     { p: 1, sec: 'halloween', icon: 'ghost', label: tr('Jump-scare mode'), desc: tr('Off unless you turn it on. Rare spooky pop-ups during Halloween season: never two within six minutes, never while a game is in front, full screen or in Game Mode, never in Do Not Disturb, and calm if you’ve asked for reduced motion.') },
  'hw.preview':   { sec: 'halloween', icon: 'eye', label: tr('Preview a jump scare'), desc: tr('See exactly what one looks like, right now.') },
  ghostHunt:      { p: 1, sec: 'halloween', icon: 'ghost', label: tr('Ghost scavenger hunt'), desc: tr('{TOTAL} little ghosts hide in apps, menus and corners until the end of 1 November. Click one to catch it; catch them all for the Ghost Hunter badge. Off hides every ghost and keeps your progress.', { TOTAL: GHOSTS.TOTAL }) },
  'hw.ghosts':    { sec: 'halloween', icon: 'search', label: tr('Ghosts caught'), desc: tr('Counted on this device, each ghost once.') },
  'hw.days':      { sec: 'halloween', icon: 'candy', label: 'Trick-or-treat', desc: tr('Click the pumpkin in the dock once a day: a treat, or a trick.') },
  cursorSkin:     { p: 1, sec: 'halloween', icon: 'mouse-pointer', label: tr('Cursor'), desc: tr('A pointer you got trick-or-treating. Normal puts the usual one back.') },
  'hw.stickers':  { sec: 'halloween', icon: 'sparkles', label: tr('Desktop stickers'), desc: tr('Put one on the desktop, then drag it where you like. Right-click a sticker to remove it.') },
  'hw.walls':     { sec: 'halloween', icon: 'image', label: tr('Halloween wallpapers'), desc: tr('Wallpapers from the pumpkin. They are in the Wallpaper pane too.') },

  /* About */
  autoUpdate:     { p: 1, sec: 'about', icon: 'download', label: tr('Automatic updates'), desc: tr('StaticOS polls build.json and tells you when a newer build is served.') },
  whatsNewAfterUpdate: { p: 1, sec: 'about', icon: 'sparkles', label: tr('What’s new after updates'), desc: tr('Once after each update, a sheet lists what changed since you last looked. Every release is always in the What’s New app.') },
  keepPrevious:   { p: 1, sec: 'about', icon: 'rotate-ccw', label: tr('Keep the previous version'), desc: tr('After an update, keep the old copy of StaticOS on this device so “Use the previous version once” has something to start. It takes a second copy of the app’s files.') },
  'install.app':  { sec: 'about', icon: 'download', label: tr('Install StaticOS as an app'), desc: tr('Give StaticOS its own window and an icon, if your browser offers it.') },
  'install.phone':{ sec: 'about', icon: 'send', label: tr('Send to my phone'), desc: tr('A QR code or a text with the link to open StaticOS on your phone.') },
  'about.build':  { sec: 'about', icon: 'info', label: tr('Build information'), desc: tr('The fingerprint of the files this tab is running.') },
  'about.reset':  { sec: 'about', icon: 'power', label: tr('Reset StaticOS'), desc: tr('Factory defaults, then reload.') },
};

/* Exported so Spotlight can search real pane ids rather than mirroring
   them in a second list that silently drifts out of step. */
export const SECTIONS = [
  { id: 'appearance',    name: tr('Appearance'),    icon: 'palette',    group: 'Personal', keys: ['dark', 'light', 'colour', 'color', 'density', 'preview', 'sunrise', 'sunset', 'dock style', 'top bar', 'font', 'typeface', 'clay', 'icons'] },
  { id: 'users',         name: tr('Users'),         icon: 'users',      group: 'Personal', keys: ['people', 'profiles', 'switch user', 'guest', 'login', 'sign out', 'pin', 'password', 'family', 'add user', 'delete user'] },
  { id: 'wallpaper',     name: tr('Wallpaper'),     icon: 'wallpaper',  group: 'Personal', keys: ['background', 'video', 'gif', 'image', 'unlock code', 'rotation', 'slideshow', 'time of day', 'weather', 'favourites', 'own picture', 'my picture', 'shuffle', 'rain', 'fireflies', 'city'] },
  { id: 'themes',        name: tr('Themes'),        icon: 'sparkles',   group: 'Personal', keys: ['crimson', 'blue', 'violet', 'emerald', 'amber', 'pink', 'mono', 'theme pack', 'packs', 'night drive', 'glacier', 'autumn', 'deep sea', 'matcha', 'export theme', 'import theme', 'theme file', 'share'] },
  { id: 'setups',        name: tr('Setups & modes'), icon: 'layers',    group: 'Personal', keys: ['modes', 'study', 'gaming', 'chill', 'profile', 'profiles', 'setup', 'home', 'school', 'night', 'export', 'import', 'settings file', 'move settings', 'another computer', 'chromebook', 'backup settings'] },
  /* listed only while the season runs (see shown() below) */
  { id: 'spooky',        name: tr('Spooky Season'), icon: 'pumpkin',    group: 'Personal', season: 'spooky', keys: ['halloween', 'pumpkin', 'jack-o-lantern', 'haunted', 'bats', 'leaves', 'countdown', 'ghost', 'boo', 'creak', 'cackle', 'witch', 'october'] },
  { id: 'winter',        name: tr('Winter'),        icon: 'snowflake',  group: 'Personal', season: 'winter', keys: ['christmas', 'snow', 'advent', 'advent calendar', 'december', 'holiday', 'holidays', 'countdown', 'cozy', 'treats', 'stickers', 'cursor', 'notification sound'] },
  /* always listed: the birthday is yours to set any day of the year */
  { id: 'celebrations',  name: tr('Celebrations'),  icon: 'calendar',   group: 'Personal', keys: ['birthday', 'new year', 'new years', 'fireworks', 'confetti', 'valentine', 'valentines', 'hearts', 'spring', 'blossom', 'cherry', 'countdown', 'february', 'march', 'april', 'january', 'autumn', 'thanksgiving', 'gratitude', 'lunar new year', 'lantern', 'st patrick', 'clover', 'pi day', 'earth day', 'summer', 'back to school', 'first snow', 'try a season', 'preview'] },
  { id: 'halloween',     name: tr('Halloween fun'), icon: 'pumpkin',    group: 'Personal', season: 'treats', keys: ['spooky', 'jump scare', 'scare', 'trick or treat', 'treats', 'cursor', 'stickers', 'pumpkin', 'boo', 'ghost hunt', 'ghosts', 'scavenger hunt'] },
  { id: 'dock',          name: tr('Dock'),          icon: 'apps',       group: 'Desktop',  keys: ['pinned apps', 'reorder', 'magnification'] },
  { id: 'desktop',       name: tr('Desktop'),       icon: 'desktop',    group: 'Desktop',  keys: ['language', 'idioma', 'español', 'spanish', 'icons', 'widgets', 'clock', 'overview', 'startup', 'boot', 'crt', 'retro', 'disk', 'linux', 'windows', 'pet', 'cat', 'hot corners', 'corner'] },
  { id: 'windows',       name: tr('Windows'),       icon: 'window',     group: 'Desktop',  keys: ['blur', 'glass', 'shadow', 'snap', 'minimise', 'minimize'] },
  { id: 'notifications', name: tr('Notifications'), icon: 'bell',       group: 'Desktop',  keys: ['do not disturb', 'alerts', 'toasts', 'badges'] },
  { id: 'keyboard',      name: tr('Keyboard'),      icon: 'keyboard',   group: 'Input',    keys: ['keys', 'modifier', 'command', 'control'] },
  { id: 'shortcuts',     name: tr('Shortcuts'),     icon: 'command',    group: 'Input',    keys: ['hotkeys', 'snap', 'cycle windows', 'lock screen', 'spotlight', 'rebind', 'remap', 'change shortcut', 'custom keys'] },
  { id: 'accessibility', name: tr('Accessibility'), icon: 'eye',        group: 'Input',    keys: ['contrast', 'high contrast', 'clutter', 'captions', 'subtitles', 'flash', 'on-screen keyboard', 'large pointer', 'cursor size', 'focus ring', 'motion', 'text size', 'focus', 'screen reader', 'transparency', 'read aloud', 'text to speech', 'speech', 'voice', 'magnifier', 'zoom', 'colour blind', 'color blind', 'grayscale', 'daltonize', 'dyslexia', 'font', 'spacing'] },
  { id: 'proxy',         name: tr('Proxy'),         icon: 'shield',     group: 'Network',  keys: ['ultraviolet', 'wisp', 'relay', 'tunnel', 'service worker'] },
  { id: 'network',       name: tr('Network'),       icon: 'globe',      group: 'Network',  keys: ['wifi', 'online', 'offline', 'downlink', 'latency', 'connection'] },
  { id: 'privacy',       name: tr('Privacy'),       icon: 'lock',       group: 'Network',  keys: ['data', 'local storage', 'erase', 'tracking', 'cookies'] },
  { id: 'sound',         name: tr('Sound'),         icon: 'volume',     group: 'System',   keys: ['audio', 'volume', 'mute', 'output', 'sound effects', 'boot sounds', 'chime', 'typing', 'typewriter', 'nature', 'sci-fi', 'per sound'] },
  { id: 'display',       name: tr('Display'),       icon: 'monitor',    group: 'System',   keys: ['brightness', 'night shift', 'resolution', 'refresh rate', 'full screen'] },
  { id: 'performance',   name: tr('Performance'),   icon: 'gauge',      group: 'System',   keys: ['fps', 'frame rate', 'memory', 'heap', 'speed', 'slow'] },
  { id: 'screentime',    name: tr('Screen Time'),   icon: 'bar-chart',  group: 'System',   keys: ['usage', 'time spent', 'app usage', 'how long', 'hours', 'games played', 'focus', 'pomodoro', 'daily', 'weekly', 'recap', 'sunday'] },
  { id: 'storage',       name: tr('Storage'),       icon: 'hard-drive', group: 'System',   keys: ['disk', 'quota', 'cache', 'indexeddb', 'free space'] },
  { id: 'applications',  name: tr('Applications'),  icon: 'package',    group: 'System',   keys: ['apps', 'default', 'uninstall', 'installed'] },
  { id: 'ai',            name: tr('AI model'),      icon: 'sparkles',   group: 'System',   keys: ['ai', 'model', 'gpt', 'llm', 'lens', 'openrouter', 'pollinations', 'free ai', 'chatbot'] },
  { id: 'labs',          name: tr('Labs'),          icon: 'zap',        group: 'System',   keys: ['experimental', 'experiments', 'beta', 'fps', 'compact', 'ai', 'staticum'] },
  { id: 'changed',       name: tr('Changed from default'), icon: 'rotate-ccw', group: 'System', keys: ['reset', 'modified', 'differs', 'default', 'filter', 'changed'] },
  { id: 'about',         name: tr('About'),         icon: 'info',       group: 'System',   keys: ['version', 'build', 'update', 'reset', 'system'] },
];

const GROUPS = ['Personal', 'Desktop', 'Input', 'Network', 'System'];
const GROUP_NAME = { Personal: tr('Personal'), Desktop: tr('Desktop'), Input: tr('Input'), Network: tr('Network'), System: tr('System') };
const secById = id => SECTIONS.find(s => s.id === id) || null;

/* Older callers (and older saved state) used a few section ids that have
   since been split up. */
const SEC_ALIAS = { displays: 'display', power: 'performance', 'desktop-dock': 'desktop', keyboardshortcuts: 'shortcuts' };
/* A seasonal pane exists only while its season runs: outside it, Settings
   is exactly what it is the rest of the year — not listed, not searchable,
   and a link to it lands on Appearance like any unknown id. */
const ownsTreats = () => { try { const o = HW.state().owned || {}; return Object.values(o).some(list => Array.isArray(list) && list.length); } catch (e) { return false; } };
/* Halloween fun (jump scares, treats) also stays listed after the season for
   anyone who has treats to manage — the cursors and stickers keep working */
/* Winter is listed through its season, and after it for anyone with advent treats */
const shown = s => !!s && (!s.season
  || (s.season === 'winter' ? SEASON.isWinterSeason() || WINTER.ownsAny()
    : SEASON.isSpookySeason() || (s.season === 'treats' && ownsTreats())));
const canonSec = id => (shown(secById(id)) ? id : (SEC_ALIAS[id] && secById(SEC_ALIAS[id]) ? SEC_ALIAS[id] : null));

const DENSITY = [['compact', tr('Compact')], ['normal', tr('Normal')], ['roomy', tr('Roomy')]];
const TEXT_SCALE = [['small', tr('Small')], ['normal', tr('Default')], ['large', tr('Large')], ['larger', tr('Largest')]];
const CONTRAST = [['normal', tr('Standard')], ['high', tr('Increased')], ['max', 'High contrast (black, white, yellow)']];

/* Everything that costs frames, and what Low graphics mode does to it: js/core/lowgfx.js */

/* ============================================================
   The app
   ============================================================ */
defineApp({
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  g1: '#aeb6c7', g2: '#3f4658',
  category: 'System',
  keywords: ['preferences', 'prefs', 'system', 'theme', 'accent', 'display', 'sound', 'proxy', 'about'],
  desc: tr('Tune every part of StaticOS'),
  pinned: true, dock: true, singleton: true,
  win: { w: 860, h: 580, minW: 560, minH: 400 },
  shortcuts: [['Mod+F', tr('Search settings')], ['/', tr('Search settings (when not typing)')]],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, fmt, store } = api;

    const S = {
      sec: canonSec(opts?.section) || 'appearance',
      filter: '',
      group: null,              // sidebar narrowed to one group by a breadcrumb
      noti: { ...(store.get('prefs.notiApps') || {}) },
      back: [], fwd: [],
      live: null,               // per-pane refresher, called on tick:1s
      paint: 0,                 // guards async work against a repaint
      dead: false,
      flash: null,              // label to highlight after the next paint
    };

    const pref = (k, d) => store.get('prefs.' + k, d === undefined ? dflt(k) : d);
    const setPref = (k, v) => store.set('prefs.' + k, v);
    const titleCase = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
    const fresh = my => !S.dead && my === S.paint;

    /* ---------------- kit ------------------ */
    const caption = t => h('div.label', { text: t, style: { padding: '0 var(--sp-2)' } });
    const col = (gap, ...kids) => h('div.col', { style: { gap: `var(${gap})` } }, ...kids);
    const group = (...rows) => h('div.set-group', rows.flat(3).filter(Boolean));

    const row = (ic, label, desc, ...ctrl) => h('div.set-row',
      h('div.set-row__ico', ic && ic.nodeType ? ic : icon(ic)),
      h('div.set-row__t', h('b', { text: label }), desc ? h('small', { text: desc }) : null),
      h('div.set-row__c', ctrl.flat(3).filter(Boolean)));

    /** A row whose label, icon and description come from the index. */
    const srow = (id, ...ctrl) => {
      const d = SET[id];
      const r = row(d.icon, d.label, d.desc, ...ctrl);
      /* a setting that is not at its default says so, and can go back: the link
         is always there and shown only while it applies (refreshResets) */
      if (d.p) {
        r.dataset.pref = id;
        const t = r.querySelector('.set-row__t');
        const link = h('button.st-reset', { type: 'button', hidden: true, 'aria-label': tr('Reset {label} to its default', { label: d.label }), onclick: () => { setPref(id, dflt(id)); paintMain(); } }, tr('Changed · Reset'));
        t?.appendChild(link);
        link.hidden = !SETUPS.isChanged(KIT, id);
      }
      return r;
    };
    function refreshResets() {
      for (const r of api.qa('.set-row[data-pref]', content)) {
        const link = r.querySelector('.st-reset');
        if (link) link.hidden = !SETUPS.isChanged(KIT, r.dataset.pref);
      }
    }

    const note = (text, ic = 'info') => h('div.st-note', icon(ic), h('small', { text }));

    /* While spooky season paints the accent and the wallpaper, say so where
       those are chosen — otherwise picking a colour would seem to do nothing. */
    const seasonNote = what => (SEASON.winter('theme')
      ? h('div.st-note.st-note--season.st-note--winter', icon('snowflake'),
          h('small', { text: what === 'wallpaper'
            ? tr('The snowy village is standing in for your wallpaper until the end of January 1. Yours comes back then, or as soon as Winter is off.')
            : tr('Winter is painting the accent cranberry and gold until the end of January 1. Your colour comes back then, or as soon as Winter is off.') }),
          btn('snowflake', tr('Winter'), () => go('winter'), '.btn--ghost'))
      : SEASON.spooky('theme')
      ? h('div.st-note.st-note--season', icon('pumpkin'),
          h('small', { text: what === 'wallpaper'
            ? tr('The haunted house is standing in for your wallpaper until the end of November 1. Yours comes back then, or as soon as Spooky Season is off.')
            : tr('Spooky Season is painting the accent orange and purple until the end of November 1. Your colour comes back then, or as soon as Spooky Season is off.') }),
          btn('pumpkin', tr('Spooky Season'), () => go('spooky'), '.btn--ghost'))
      : null);

    /* tip stays short — .tip::after is centred and would overflow the
       scroll container if the label were a sentence; aria takes the long form */
    const ibtn = (ic, tip, onClick, disabled, aria) => h('button.ibtn.tip', {
      'data-tip': tip, 'aria-label': aria || tip, disabled: !!disabled, onclick: onClick,
    }, icon(ic));

    const btn = (ic, label, onClick, cls) => h(`button.btn.btn--sm${cls || ''}`, { onclick: onClick },
      icon(ic), h('span', { text: label }));

    const sw = (label, get, set) => {
      const el = h('button.switch', {
        role: 'switch', 'aria-label': label,
        onclick: () => { set(!get()); sync(); },
      });
      const sync = () => {
        const on = !!get();
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-checked', String(on));
      };
      sync();
      return el;
    };
    const prefSwitch = (key, after) =>
      sw(SET[key]?.label || key, () => pref(key), v => { setPref(key, v); after?.(v); });

    const select = (label, items, value, onChange) => h('select.select', {
      'aria-label': label, onchange: e => onChange(e.target.value),
    }, items.map(it => {
      const [v, l] = Array.isArray(it) ? it : [it, it];
      return h('option', { value: v, selected: v === value, text: l });
    }));
    const prefSelect = (key, items, after) =>
      select(SET[key]?.label || key, items, String(pref(key)), v => { setPref(key, v); after?.(v); });

    const tabs = (label, items, value, onChange) => {
      const el = h('div.tabs', { role: 'group', 'aria-label': label });
      const sync = v => [...el.children].forEach(b => {
        const on = b.dataset.v === String(v);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      el.append(...items.map(([v, l]) => h('button', {
        type: 'button', text: l, dataset: { v },
        onclick: () => { onChange(v); sync(v); },
      })));
      sync(value);
      return el;
    };
    const prefTabs = (key, items, after) =>
      tabs(SET[key]?.label || key, items, String(pref(key)), v => { setPref(key, v); after?.(v); });

    const slider = (label, value, onInput, unit = '%') => {
      const out = h('small.dim', { text: `${value}${unit}`,
        style: { width: '38px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
      const input = h('input.slider', {
        type: 'range', min: '0', max: '100', value: String(value), 'aria-label': label,
        style: { flex: '1 1 auto', minWidth: '0' },
        oninput: e => { const v = Number(e.target.value); out.textContent = `${v}${unit}`; onInput(v); },
      });
      return h('div.row', { style: { width: '168px' } }, input, out);
    };

    /* the same helpers, handed to the panes that draw themselves (looks-pane.js) */
    const LK = { api, caption, group, row, srow, note, btn, sw, select, tabs, setPref, pref, repaint: () => paintMain() };

    /** Key/value facts. Rows whose value is missing are dropped, never shown as "—". */
    const factRow = ([k, v]) => h('tr',
      h('td', { text: k, style: { color: 'var(--ink-3)', width: '44%' } }),
      h('td', { text: String(v) }));

    const facts = rows => {
      const keep = rows.filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== '');
      return h('div.set-group', h('table.table', h('tbody', keep.map(factRow))));
    };

    const statGrid = (...kids) => h('div.st-grid', kids.flat(3).filter(Boolean));

    /** Uptime reads better as hours and minutes than as mm:ss. */
    const upFmt = s => (s >= 3600
      ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
      : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

    /** A block that fills itself in once a promise resolves. */
    const async_ = (load, build, pending = tr('Reading…')) => {
      const box = h('div.st-async', h('small.dim', { text: pending }));
      const my = S.paint;
      Promise.resolve().then(load).then(v => {
        if (!fresh(my)) return;
        api.render(box, build(v));
      }).catch(err => {
        if (!fresh(my)) return;
        api.render(box, note(tr('Could not read this: {message}', { message: err.message }), 'alert'));
      });
      return box;
    };

    /* fmt.fmtBytes renders 0 as an em dash, which reads as "unknown".
       A measured zero is a real answer and should look like one. */
    const bytes = n => (Number(n) ? fmt.fmtBytes(Number(n)) : '0 B');
    const pctBar = pct => h('div.bar', h('i', { style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));

    /* everything the setups pane (js/apps/setups-pane.js) needs from here */
    const KIT = { api, caption, group, row, srow, note, btn, sw, select, tabs, slider, prefSwitch, setPref, pref, dflt, SET, async_, bytes,
      repaint: () => paintMain(), go: (...a) => go(...a), secName: id => secById(id)?.name || id, secOf: id => secById(id), shown };

    /* ---------------- chrome --------------- */
    const btnBack = ibtn('chevron-left', tr('Back'), () => goBack());
    const btnFwd = ibtn('chevron-right', tr('Forward'), () => goFwd());
    win.setLead(btnBack, btnFwd);

    const searchInput = h('input', {
      type: 'search', placeholder: tr('Search settings…'), spellcheck: 'false', 'aria-label': tr('Search settings'),
      oninput: e => { S.filter = e.target.value.trim().toLowerCase(); paintSide(); },
      onkeydown: e => {
        if (e.key === 'Escape') { e.target.value = ''; S.filter = ''; paintSide(); }
        if (e.key === 'Enter') {
          const hit = hits()[0];
          if (hit) go(hit.sec, true, hit.label);
        }
      },
    });
    const searchBox = h('div.field', { style: { height: '26px', flex: '0 0 auto' } }, icon('search'), searchInput);

    win.setTools(
      ibtn('search', tr('Search settings'), () => searchInput.focus()),
      ibtn('more-horizontal', tr('More'), e => {
        const r = e.currentTarget.getBoundingClientRect();
        api.menu([
          { label: tr('System Monitor'), icon: 'system-monitor', onClick: () => api.openApp('monitor') },
          { label: tr('Notification Centre'), icon: 'bell', onClick: () => api.bus.emit('noti:toggle') },
          '-',
          { label: tr('Low graphics mode'), icon: 'zap', onClick: () => setLowGfx(true) },
          { label: tr('Reset {v}', { v: secById(S.sec).name }), icon: 'rotate-ccw', onClick: () => resetSection(S.sec) },
          '-',
          { label: tr('Reset StaticOS…'), icon: 'power', danger: true, onClick: resetAll },
        ], r.left - 170, r.bottom + 6);
      }),
    );

    /* ---------------- layout --------------- */
    const sideList = col('--sp-5');
    const side = h('aside.app__side.app__side--wide', searchBox, sideList);
    const bar = h('div.app__bar');
    const content = h('div.app__content');
    /* the switches you chose, above every pane (js/apps/setups-pane.js) */
    const strip = SETUPS.quickStrip(KIT);
    const appEl = h('div.app.st-app', side, h('div.app__main', bar, strip.el, content));
    root.appendChild(appEl);
    /* On a phone (body.is-mobile) Settings is two screens, like a phone's:
       the list of panes, then the pane you picked, with "Settings" in the
       breadcrumbs as the way back. On a desktop both classes do nothing. */
    const setPane = p => { appEl.classList.toggle('is-list', p === 'list'); appEl.classList.toggle('is-detail', p !== 'list'); };
    setPane(opts?.section ? 'detail' : 'list');

    /* ---------------- search --------------- */
    /** Matching individual settings, not just panes. */
    function hits() {
      const f = S.filter;
      if (!f) return [];
      const out = [];
      for (const [id, d] of Object.entries(SET)) {
        if (!shown(secById(d.sec))) continue;
        const hay = `${d.label} ${d.desc || ''}`.toLowerCase();
        if (hay.includes(f)) out.push({ id, sec: d.sec, label: d.label, icon: d.icon });
      }
      /* an exact-ish label match should outrank a description match */
      return out.sort((a, b) => {
        const ai = a.label.toLowerCase().indexOf(f), bi = b.label.toLowerCase().indexOf(f);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
    }

    const secHits = () => {
      const f = S.filter;
      if (!f) return [];
      return SECTIONS.filter(s => shown(s) && (s.name.toLowerCase().includes(f) || s.keys.some(k => k.includes(f))));
    };

    /* ---------------- sidebar -------------- */
    function paintSide() {
      api.clear(sideList);

      if (S.filter) {
        const panes = secHits();
        const items = hits();
        if (!panes.length && !items.length) {
          sideList.appendChild(h('small.dim', {
            text: tr('Nothing matches “{filter}”.', { filter: S.filter }),
            style: { padding: '0 var(--sp-3)', lineHeight: '1.5' },
          }));
          return;
        }
        if (panes.length) {
          const box = h('div.side__group', h('div.side__label', { text: tr('Panes') }));
          for (const s of panes) box.appendChild(sideItem(s));
          sideList.appendChild(box);
        }
        if (items.length) {
          const box = h('div.side__group', h('div.side__label', { text: tr('Settings · {length}', { length: items.length }) }));
          for (const it of items.slice(0, 14)) {
            box.appendChild(h('button.side__item', {
              onclick: () => go(it.sec, true, it.label),
            }, icon(it.icon), h('span', { text: it.label }),
              h('small', { text: secById(it.sec).name })));
          }
          sideList.appendChild(box);
        }
        return;
      }

      for (const g of GROUPS) {
        if (S.group && g !== S.group) continue;
        const inGroup = SECTIONS.filter(s => s.group === g && shown(s));
        const box = h('div.side__group', h('div.side__label', { text: GROUP_NAME[g] || g }));
        for (const s of inGroup) box.appendChild(sideItem(s));
        sideList.appendChild(box);
      }

      if (S.group) {
        sideList.appendChild(h('button.btn.btn--sm.btn--ghost', {
          onclick: () => { S.group = null; paintSide(); },
        }, icon('list'), h('span', { text: tr('Show every pane') })));
      }

      paintRecent();
    }

    function sideItem(s) {
      const item = h('button.side__item', { onclick: () => go(s.id) },
        icon(s.icon), h('span', { text: s.name }));
      if (s.id === 'changed') {
        const n = Object.keys(SET).filter(id => SET[id].p && shown(secById(SET[id].sec)) && SETUPS.isChanged(KIT, id)).length;
        if (n) item.appendChild(h('small', { text: String(n), 'data-changed-count': '' }));
      }
      if (s.id === S.sec) item.classList.add('is-on');
      return item;
    }

    /* ---- recently changed ---- */
    function paintRecent() {
      const list = (store.get(RECENT_KEY, []) || []).filter(r => r && SET[r.id] && shown(secById(SET[r.id].sec)));
      if (!list.length) return;
      const box = h('div.side__group',
        h('div.side__label', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' } },
          h('span', { text: tr('Recently changed') }),
          h('div.grow'),
          h('button.st-mini', {
            'aria-label': tr('Clear the recently changed list'),
            onclick: () => { store.set(RECENT_KEY, []); paintSide(); },
            text: tr('Clear'),
          })));
      for (const r of list.slice(0, 5)) {
        const d = SET[r.id];
        box.appendChild(h('button.side__item.st-recent', {
          onclick: () => go(d.sec, true, d.label),
          title: `${d.label} — ${secById(d.sec).name}`,
        }, icon(d.icon), h('span', { text: d.label }), h('small', { text: ago(r.at) })));
      }
      sideList.appendChild(box);
    }

    const ago = at => {
      const s = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (s < 60) return 'now';
      if (s < 3600) return `${Math.floor(s / 60)}m`;
      if (s < 86400) return `${Math.floor(s / 3600)}h`;
      return `${Math.floor(s / 86400)}d`;
    };

    /* ---------------- navigation ----------- */
    function go(id, record = true, flashLabel = null) {
      const sec = canonSec(id);
      if (!sec) return;
      if (record && sec !== S.sec) { S.back.push(S.sec); S.fwd.length = 0; }
      S.sec = sec;
      S.flash = flashLabel;
      setPane('detail');
      paintSide();
      paintMain();
    }
    function goBack() { if (S.back.length) { S.fwd.push(S.sec); go(S.back.pop(), false); } }
    function goFwd() { if (S.fwd.length) { S.back.push(S.sec); go(S.fwd.pop(), false); } }

    /* breadcrumbs: Settings › group › pane. The first two do something —
       clearing the filter and narrowing the sidebar to one group. */
    function crumbs(sec) {
      return h('div.crumbs',
        h('button.st-crumb-home', {
          text: tr('Settings'),
          onclick: () => {
            S.group = null; S.filter = ''; searchInput.value = '';
            setPane('list');
            paintSide();
            if (document.body.classList.contains('is-mobile')) sideList.querySelector('.side__item.is-on, .side__item')?.focus();
            else searchInput.focus();
          },
        }),
        icon('chevron-right'),
        h('button', {
          text: GROUP_NAME[sec.group] || sec.group,
          onclick: () => { S.group = sec.group; S.filter = ''; searchInput.value = ''; paintSide(); },
        }),
        icon('chevron-right'),
        h('b', { text: sec.name }));
    }

    function paintBar() {
      const sec = secById(S.sec);
      api.render(bar, crumbs(sec), h('div.grow'), TOOLS[sec.id]?.() || null);
    }

    function paintMain() {
      const sec = secById(S.sec);
      S.live = null;
      S.paint++;
      paintBar();
      api.render(content, col('--sp-5', ...PAINT[sec.id]()));
      content.scrollTop = 0;
      win.setSubtitle(sec.name);
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
      if (S.flash) { flashRow(S.flash); S.flash = null; }
      refreshResets();
    }

    /** Scroll a searched-for setting into view and mark it briefly. */
    function flashRow(label) {
      const target = api.qa('.set-row', content)
        .find(r => r.querySelector('.set-row__t b')?.textContent === label);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      target.classList.add('st-flash');
      setTimeout(() => target.classList.remove('st-flash'), 1800);
    }

    /* ---------------- reset ---------------- */
    function resetSection(secId) {
      const ids = Object.entries(SET).filter(([, d]) => d.sec === secId && d.p).map(([id]) => id);
      if (!ids.length) {
        api.notify({ app: tr('Settings'), icon: 'info', title: tr('Nothing to reset'),
          message: tr('{v} has no stored preferences of its own.', { v: secById(secId).name }) });
        return;
      }
      for (const id of ids) setPref(id, dflt(id));
      api.notify({ app: tr('Settings'), icon: 'rotate-ccw', title: tr('{v} reset', { v: secById(secId).name }),
        message: plural(ids.length, '{n} setting is back to the Static default.', '{n} settings are back to the Static default.') });
      paintMain();
    }

    const canReset = secId => Object.values(SET).some(d => d.sec === secId && d.p);

    function setLowGfx(on) {
      LG.set(on);
      api.notify({ app: tr('Settings'), icon: 'zap',
        title: on ? tr('Low graphics mode on') : tr('Low graphics mode off'),
        message: on
          ? tr('Blur, deep shadows, grain and animation are off.')
          : tr('Blur, shadows, grain and animation are back.') });
      paintMain();
    }
    const lowGfxOn = () => LG.isOn();

    function resetAll() {
      api.confirm({
        title: tr('Reset StaticOS?'),
        message: tr('Every preference, note, file and dock change goes back to factory defaults and the desktop reloads. Game projects and clips (kept separately) are not touched.'),
        ok: tr('Reset everything'), cancel: tr('Keep my setup'),
      }).then(ok => {
        if (!ok) return;
        store.reset();
        api.vfs.resetFiles?.();
        location.reload();
      });
    }

    /* ============================================================
       1 · Appearance
       ============================================================ */
    function previewCard() {
      const px = (w, hh, r, bg) => h('i', { style: {
        display: 'block', flex: '0 0 auto', width: w, height: hh, borderRadius: r, background: bg } });

      const stage = h('div.st-preview',
        h('div', { style: { position: 'absolute', inset: '0',
          background: 'radial-gradient(120% 82% at 68% -20%,rgba(var(--accent-rgb)/.30),transparent 58%)' } }),
        pref('wallpaperGrid') && h('div', { style: { position: 'absolute', inset: '0', opacity: '.55',
          backgroundImage: 'radial-gradient(var(--line-2) .6px,transparent .6px)', backgroundSize: '9px 9px' } }),
        h('div', { style: { position: 'absolute', left: '0', right: '0', top: '0', height: '13px',
          display: 'flex', alignItems: 'center', gap: '4px', padding: '0 5px',
          background: 'var(--glass-1)', borderBottom: '1px solid var(--line-0)' } },
          px('5px', '5px', '50%', 'var(--accent)'),
          px('20px', '3px', 'var(--r-pill)', 'var(--fill-3)'),
          h('div.grow'),
          px('9px', '3px', 'var(--r-pill)', 'var(--fill-2)'),
          px('14px', '3px', 'var(--r-pill)', 'var(--fill-2)')),
        h('div', { style: { position: 'absolute', left: '14%', top: '30px', width: '56%', height: '76px',
          borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--glass-2)',
          border: '1px solid var(--line-1)', boxShadow: 'var(--sh-2)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '3px', height: '12px',
            padding: '0 4px', background: 'var(--fill-1)', borderBottom: '1px solid var(--line-0)' } },
            px('4px', '4px', '50%', 'var(--accent)'),
            px('4px', '4px', '50%', 'var(--fill-3)'),
            px('4px', '4px', '50%', 'var(--fill-3)')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px' } },
            px('62%', '4px', 'var(--r-pill)', 'var(--fill-3)'),
            px('88%', '3px', 'var(--r-pill)', 'var(--fill-2)'),
            px('74%', '3px', 'var(--r-pill)', 'var(--fill-2)'),
            px('34%', '8px', 'var(--r-xs)', 'var(--accent)'))),
        h('div', { style: { position: 'absolute', left: '50%', bottom: '7px', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'flex-end', gap: '4px', padding: '4px 6px',
          borderRadius: 'var(--r-sm)', background: 'var(--glass-1)',
          border: '1px solid var(--line-1)', boxShadow: 'var(--sh-2)' } },
          [0, 1, 2, 3, 4].map(i => px('9px', i === 2 ? '13px' : '9px', '3px',
            i === 2 ? 'var(--accent)' : 'var(--fill-3)'))));

      /* the stage is a fixed 248px, so at the minimum window width the
         caption column has to wrap below it rather than push the content
         area into a horizontal scroll */
      return h('div.card', { style: { padding: 'var(--sp-4)', display: 'flex',
        gap: 'var(--sp-5)', alignItems: 'center', flexWrap: 'wrap' } }, stage,
        col('--sp-3',
          h('div.label', { text: tr('Live preview') }),
          h('div.row', { style: { gap: 'var(--sp-2)', flexWrap: 'wrap' } },
            h('span.chip.chip--accent', { text: THEMES.themeById(pref('accent')).name }),
            h('span.chip', { text: titleCase(pref('theme')) }),
            h('span.chip', { text: titleCase(pref('density')) })),
          h('small.dim', { text: tr('Every change here lands on the whole shell the moment you make it.'),
            style: { lineHeight: '1.5' } })));
    }

    /* Named themes rather than bare swatches: a colour with a name is
       something you can ask for. Only the accent set changes between
       them — the layout is shared, which is what keeps every theme
       recognisably Static. */
    const swatchRow = (withNames = true) => {
      const el = h('div.themes', { role: 'radiogroup', 'aria-label': tr('Accent colour') });
      const sync = () => {
        const on = THEMES.canonId(pref('accent'));
        [...el.children].forEach(b => {
          const is = b.dataset.k === on;
          b.classList.toggle('is-on', is);
          b.setAttribute('aria-checked', String(is));
        });
      };
      el.append(...THEMES.THEMES.map(t => h('button.theme', {
        role: 'radio', type: 'button',
        'aria-label': `${t.name} — ${t.note}`,
        title: t.note,
        dataset: { k: t.id },
        onclick: () => { setPref('accent', t.id); THEMES.apply(t.id); sync(); },
      },
        h('i.theme__dot', { style: { background: THEMES.swatch(t.id) } }),
        withNames ? h('span.theme__name', { text: t.name.replace(/^Static\s+/, '') }) : null)));
      sync();
      return el;
    };

    function paintAppearance() {
      return [
        caption(tr('Preview')),
        previewCard(),
        caption(tr('Appearance')),
        group(
          srow('theme', prefTabs('theme', [['dark', tr('Dark')], ['light', tr('Light')]], () => {
            if (pref('themeAuto')) setPref('themeAuto', false);
            if (pref('themeSun')) setPref('themeSun', false);
            paintMain();
          })),
          srow('themeAuto', mqDark
            ? prefSwitch('themeAuto', () => { syncAutoTheme(); paintMain(); })
            : h('span.badge', { text: tr('Not reported here') })),
          LOOKS.sunRow(LK),
          srow('density', prefSelect('density', DENSITY)),
          srow('iconStyle', prefSelect('iconStyle', [['glass', tr('Glass')], ['round', tr('Round')], ['sharp', tr('Sharp')], ['flat', tr('Flat')], ['outline', tr('Outline')], ['tinted', tr('Tinted')], ['clay', tr('Clay')]])),
          srow('pixelIcons', prefSwitch('pixelIcons')),
        ),
        caption(tr('Accent')),
        group(srow('accent', h('div.col', { style: { gap: 'var(--sp-3)', alignItems: 'flex-end' } },
          swatchRow(false),
          btn('sparkles', tr('All themes'), () => go('themes'), '.btn--ghost')))),
        seasonNote('accent'),
        ...LOOKS.styleRows(LK),
        caption(tr('Text and motion')),
        group(
          srow('textScale', prefSelect('textScale', TEXT_SCALE)),
          srow('reduceMotion', prefSwitch('reduceMotion')),
        ),
        SETUPS.textPreview(KIT),
        note(tr('Text size, contrast and motion have a pane of their own under Accessibility.')),
      ];
    }

    /* ============================================================
       2 · Wallpaper
       ============================================================ */
    function wallpaperPicker() {
      const wrap = h('div.col', { style: { gap: 'var(--sp-4)' } });

      const paintPicker = () => {
        const activeId = WP.active(store).id;
        const grid = h('div.wpp');
        for (const w of WP.list(store)) {
          const card = h('button.wpp-card', {
            type: 'button', 'aria-pressed': String(w.id === activeId),
            class: w.id === activeId ? 'is-on' : null,
            onclick: () => { WP.setActive(store, w.id); api.bus.emit('wallpaper:changed'); paintPicker(); },
          });
          const art = h('div.wpp-card__art');
          if (LOOKS.cardArt(art, w)) { /* a live scene or a picture from Files */ }
          else if (w.kind === 'css') art.style.background = w.css;
          else if (w.kind === 'scene') {
            art.style.background =
              'radial-gradient(80% 60% at 50% 70%, rgba(var(--accent-rgb)/.30), transparent 62%),'
              + 'linear-gradient(175deg,#1e1224,#140a18 55%,#08050b)';
          } else if (w.kind === 'video' && w.poster) {
            /* 1080p clips: show the poster, and only fetch and play the video
               while the card is hovered — the picker would otherwise pull
               every wallpaper at full size at once */
            const v = h('video', { poster: w.poster, muted: true, loop: true, playsinline: true,
              preload: 'none', 'aria-hidden': 'true' });
            v.muted = true;
            card.addEventListener('pointerenter', () => {
              if (!v.src) v.src = w.url;
              const p = v.play(); if (p && p.catch) p.catch(() => {});
            });
            card.addEventListener('pointerleave', () => v.pause());
            art.appendChild(v);
          } else if (w.kind === 'video') {
            const v = h('video', { src: w.url, muted: true, loop: true, playsinline: true,
              preload: 'metadata', 'aria-hidden': 'true' });
            v.muted = true;
            v.addEventListener('canplay', () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); },
              { once: true });
            art.appendChild(v);
          } else {
            art.appendChild(h('img', { src: w.url, alt: '', loading: 'lazy',
              referrerpolicy: 'no-referrer', onerror: e => e.target.remove() }));
          }
          card.append(art, LOOKS.favButton(w, LK),
            h('div.wpp-card__b',
              h('div.wpp-card__n', { text: w.name }),
              h('div.wpp-card__k', { text: w.tag || (w.kind === 'css' || w.kind === 'scene' ? 'built in' : w.kind) }),
              w.built ? null : h('span.ibtn.wpp-card__x', {
                role: 'button', tabindex: '0', 'aria-label': tr('Remove {name}', { name: w.name }),
                onclick: e => { e.stopPropagation(); WP.remove(store, w.id);
                  api.bus.emit('wallpaper:changed'); paintPicker(); },
              }, icon('trash'))));
          grid.appendChild(card);
        }

        const nameIn = h('input', { type: 'text', placeholder: tr('Name (optional)'), spellcheck: 'false',
          'aria-label': tr('Wallpaper name') });
        const urlIn = h('input', { type: 'text', placeholder: tr('https://… .mp4  .gif  .png'), spellcheck: 'false',
          'aria-label': tr('Wallpaper URL') });
        const codeIn = h('input', { type: 'text', placeholder: tr('Unlock code (optional)'), spellcheck: 'false',
          'aria-label': tr('Unlock code to attach') });
        const msg = h('small.dim');

        const addOne = () => {
          try {
            const w = WP.add(store, { name: nameIn.value, url: urlIn.value, code: codeIn.value });
            nameIn.value = urlIn.value = codeIn.value = '';
            msg.textContent = w.code
              ? tr('Added “{name}” as a {kind}, locked behind {code}.', { name: w.name, kind: w.kind, code: w.code })
              : tr('Added “{name}” as a {kind}.', { name: w.name, kind: w.kind });
            paintPicker();
          } catch (err) { msg.textContent = err.message; }
        };

        const redeemIn = h('input', { type: 'text', placeholder: tr('Enter a code'), spellcheck: 'false',
          'aria-label': tr('Redeem an unlock code'),
          onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); doRedeem(); } } });
        const doRedeem = () => {
          const w = WP.redeem(store, redeemIn.value);
          if (w) {
            redeemIn.value = '';
            msg.textContent = tr('Unlocked “{name}”.', { name: w.name });
            api.notify({ app: tr('Settings'), icon: 'image', title: tr('Wallpaper unlocked'), message: w.name });
            paintPicker();
          } else { msg.textContent = tr('No wallpaper uses that code.'); }
        };

        api.render(wrap, grid,
          h('div.set-group',
            srow('wp.add'),
            h('div.set-row',
              h('div.wpp-add', { style: { width: '100%' } },
                h('div.row',
                  h('div.field', icon('type'), nameIn),
                  h('div.field', icon('link'), urlIn)),
                h('div.row',
                  h('div.field', icon('lock'), codeIn),
                  h('button.btn.btn--primary', { type: 'button', onclick: addOne },
                    icon('plus', { size: 14 }), tr('Add')),
                  h('div.grow'),
                  h('div.field', icon('unlock'), redeemIn),
                  h('button.btn', { type: 'button', onclick: doRedeem },
                    icon('check', { size: 14 }), tr('Redeem'))),
                msg))));
      };

      paintPicker();
      return wrap;
    }

    function paintWallpaper() {
      const active = WP.active(store);
      /* rotation, Day and Night and the weather overlay (js/apps/wallplus-pane.js) */
      const plus = WPX.wallpaperRows({ api, caption, group, row, srow, note, btn, sw, select, tabs, setPref, pref, repaint: () => { if (S.sec === 'wallpaper') paintMain(); } });
      const out = [
        caption(tr('Current')),
        group(srow('wp.active', h('span.chip.chip--accent', { text: active.name }),
          h('span.badge', { text: tr('{v} available', { v: WP.list(store).length }) }))),
        seasonNote('wallpaper'),
        caption(tr('Choose')),
        wallpaperPicker(),
        ...LOOKS.pictureRows({ ...LK, repaint: () => { if (S.sec === 'wallpaper') paintMain(); } }),
        ...plus.nodes,
        caption(tr('Overlays')),
        group(
          srow('wallpaperGrid', prefSwitch('wallpaperGrid', () => { if (S.sec === 'wallpaper') paintMain(); })),
          srow('wallpaperGrain', prefSwitch('wallpaperGrain')),
        ),
        ...visualizerRows(),
      ];
      const vis = S.live;
      S.live = () => { vis?.(); plus.live(); };
      return out;
    }

    /* The music visualizer (js/shell/visualizer.js). The status line is the
       layer's own word on what it is doing (core/audiotap.js), refreshed
       every second — including, by name, a stream it isn't allowed to read. */
    const VIS_SAY = {
      off: [tr('Off'), ''],
      reduced: [tr('Still'), tr('Reduce motion is on, so the wallpaper stays still. (Settings › Accessibility, or your computer’s own setting.)')],
      phone: [tr('Off here'), tr('Off in the phone layout, to save battery.')],
      unsupported: [tr('Not in this browser'), tr('This browser won’t let a page read its own audio without taking it over, so there is nothing to draw. Brave, Chrome and Edge can.')],
      gamemode: [tr('Paused'), tr('Paused for Game Mode.')],
      hidden: [tr('Paused'), tr('Paused while this tab is hidden.')],
      idle: [tr('Waiting'), tr('Play something in Music or Static Radio.')],
      muted: [tr('Muted'), tr('The sound is muted, so there is nothing to draw.')],
      blocked: [tr('Can’t read this'), ''],
      suspended: [tr('Needs a click'), tr('Click anywhere once — the browser only lets a page listen after you interact with it.')],
      starting: [tr('Starting'), tr('Waiting for the first sound…')],
      silent: [tr('Hearing silence'), tr('Only silence is reaching the visualizer. The music may be quiet right now, or the browser isn’t sharing this sound with the page.')],
      drawing: [tr('Drawing'), ''],
    };
    function visualizerRows() {
      const on = pref('wallpaperVisualizer') === true;
      const badge = h('span.badge');
      const say = h('small.dim', { style: { display: 'block', maxWidth: '420px' } });
      const paintVis = () => {
        const st = TAP.status;
        const state = on ? st.state : 'off';
        const [word, line] = VIS_SAY[state] || [state, ''];
        badge.textContent = state === 'drawing' && st.source ? tr('From {source}', { source: st.source }) : word;
        badge.className = 'badge' + (state === 'drawing' ? ' badge--ok' : state === 'blocked' || state === 'unsupported' ? ' badge--warn' : '');
        say.textContent = state === 'blocked' ? (st.detail || tr('The browser won’t let a page read this sound.')) : line;
        say.hidden = !say.textContent;
      };
      paintVis();
      S.live = paintVis;
      const styleRow = srow('visualizerStyle', prefTabs('visualizerStyle', [['bars', tr('Bars')], ['wave', tr('Wave')], ['particles', tr('Particles')]]));
      if (!on) {
        styleRow.classList.add('is-dim');
        styleRow.querySelectorAll('button').forEach(el => { el.disabled = true; });
      }
      const status = h('div.set-row.st-vis',
        h('div.set-row__ico', icon(SET['wp.vis'].icon)),
        h('div.set-row__t', h('b', { text: SET['wp.vis'].label }), say),
        h('div.set-row__c', badge));
      return [
        caption(tr('Music visualizer')),
        group(
          srow('wallpaperVisualizer', prefSwitch('wallpaperVisualizer', v => {
            /* the switch is a click: let the page's audio start now */
            if (v) sfx.unlock();
            if (S.sec === 'wallpaper') paintMain();
          })),
          styleRow,
          on ? status : null,
        ),
        note(tr('Off by default. It reads the music the way an equaliser does — nothing is recorded or sent anywhere. It pauses while the tab is hidden and in Game Mode, stays still with Reduce motion, and sits under the spooky leaves in season.'), 'music'),
      ];
    }

    /* ============================================================
       3 · Themes
       ============================================================ */
    /* Theme packs: accent + wallpaper + icon style in one click
       (js/core/packs.js). Each card is drawn in its own pack's accent, so
       the Apply button and the icon sample are a preview of the pack. */
    function applyPack(id) {
      const r = PACKS.apply(id);
      if (!r) return;
      const spooky = SEASON.spooky('theme');
      api.notify({
        app: tr('Settings'), icon: 'sparkles', timeout: 9000,
        title: tr('{name} is on', { name: r.pack.name }),
        message: spooky
          ? tr('Wallpaper and icons changed. Spooky Season keeps its orange accent until the end of November 1 — switch the season off to see this one.')
          : tr('Accent, wallpaper and icons changed together.'),
        actions: [{ label: tr('Undo'), onClick: r.undo }],
      });
    }
    function packCards() {
      const cur = PACKS.current();
      const sample = ['files', 'music', 'settings'].map(id => api.getApp(id)).filter(Boolean);
      return h('div.st-packs', { role: 'list', 'aria-label': tr('Theme packs') }, PACKS.PACKS.map(p => {
        const t = THEMES.themeById(p.accent);
        const w = WP.byId(store, p.wallpaper);
        const on = !!cur && cur.id === p.id;
        return h('div.st-pack', {
          role: 'listitem', dataset: { pack: p.id }, class: on ? 'is-on' : null,
          style: { '--accent': t.accent, '--accent-soft': t.soft, '--accent-rgb': t.rgb, '--accent-ink': t.ink },
        },
          h('div.st-pack__art', { style: w ? { backgroundImage: `url("${w.url}")` } : null },
            h('div.st-look.st-pack__icons', { dataset: { icons: p.icons }, 'aria-hidden': 'true' },
              sample.map(a => appTile(a, { gs: '30px' })))),
          h('div.st-pack__b',
            h('b', { text: p.name }),
            h('small', { text: p.blurb }),
            h('div.st-pack__parts',
              h('span.chip', h('i.st-pack__dot'), h('span', { text: t.name })),
              h('span.chip', icon('image'), h('span', { text: w ? w.name : tr('Wallpaper') })),
              h('span.chip', icon('diamond'), h('span', { text: tr('{ICON_STYLES} icons', { ICON_STYLES: PACKS.ICON_STYLES[p.icons] }) }))),
            on
              ? h('span.chip.chip--accent.st-pack__on', icon('check'), h('span', { text: tr('In use') }))
              : h('button.btn.btn--sm.btn--primary.st-pack__go', {
                type: 'button', dataset: { fk: `pack-apply-${p.id}` }, 'aria-label': tr('Apply the {name} pack', { name: p.name }),
                onclick: () => applyPack(p.id),
              }, icon('sparkles'), h('span', { text: tr('Apply') }))));
      }));
    }
    function packBack() {
      const st = PACKS.state();
      if (!st.before) return null;
      return h('div.st-note.st-pack-back',
        icon('rotate-ccw'),
        h('small', h('b', { text: tr('Before the packs: ') }), PACKS.describe(st.before)),
        h('button.btn.btn--sm', {
          type: 'button', dataset: { fk: 'pack-revert' },
          onclick: () => {
            PACKS.revert();
            api.notify({ app: tr('Settings'), icon: 'rotate-ccw', title: tr('Your look is back'), message: PACKS.describe(PACKS.look()), timeout: 5000 });
          },
        }, icon('rotate-ccw'), h('span', { text: tr('Put it back') })));
    }

    function paintThemes() {
      const current = THEMES.canonId(pref('accent'));
      const grid = h('div.st-themes', { role: 'radiogroup', 'aria-label': tr('Theme') });
      const sync = () => [...grid.children].forEach(c => {
        const is = c.dataset.k === THEMES.canonId(pref('accent'));
        c.classList.toggle('is-on', is);
        c.setAttribute('aria-checked', String(is));
      });

      for (const t of THEMES.THEMES) {
        grid.appendChild(h('button.st-theme', {
          type: 'button', role: 'radio', dataset: { k: t.id },
          'aria-checked': String(t.id === current),
          'aria-label': `${t.name} — ${t.note}`,
          onclick: () => { setPref('accent', t.id); THEMES.apply(t.id); sync(); paintBar(); },
        },
          h('i.st-theme__art', { style: { background: THEMES.swatch(t.id) } }),
          h('div.st-theme__b',
            h('b', { text: t.name }),
            h('small', { text: t.note }),
            h('span.chip.mono', { text: t.accent }))));
      }

      /* Custom accent: a hex flows through the theme engine like any named
         theme (see themes.js isHex/deriveTheme), so writing prefs.accent to
         the hex is the whole of it — the picker just needs to stay in step
         with a colour that may have been set from the swatch instead. */
      const cur = pref('accent');
      const customHex = THEMES.isHex(cur) ? cur : '#ff456d';
      const swatchInput = h('input', {
        type: 'color', value: customHex, 'aria-label': tr('Pick a custom accent colour'),
        class: 'st-custom__swatch',
        oninput: e => { hexField.value = e.target.value; applyCustom(e.target.value); },
      });
      const hexField = h('input', {
        type: 'text', value: customHex, spellcheck: 'false', maxlength: '7',
        'aria-label': tr('Accent hex'), class: 'st-custom__hex',
        oninput: e => {
          const v = e.target.value.trim();
          if (THEMES.isHex(v)) { swatchInput.value = v.length === 4
            ? '#' + v.slice(1).split('').map(c => c + c).join('') : v; applyCustom(v); }
        },
      });
      const applyCustom = hex => { setPref('accent', hex.toLowerCase()); THEMES.apply(hex); sync(); paintBar(); };
      /* Auto: the accent picked out of the wallpaper (js/apps/wallplus-pane.js) */
      const auto = WPX.autoCard({ api, setPref, repaint: () => { if (S.sec === 'themes') paintMain(); } });
      S.live = auto.live;

      return [
        seasonNote('accent'),
        caption(tr('Theme packs')),
        packCards(),
        packBack(),
        caption(tr('Theme')),
        grid,
        note(tr('A theme changes the accent set and nothing else. The canvas, the glass, the spacing and the motion are shared, which is what keeps every theme recognisably Static.')),
        caption(tr('From your wallpaper')),
        auto.node,
        caption(tr('Custom accent')),
        h('div.st-custom' + (THEMES.isHex(cur) ? '.is-on' : ''),
          h('i.st-custom__preview', { style: { background: THEMES.swatch(customHex) } }),
          swatchInput,
          h('div.st-custom__b',
            h('b', { text: tr('Any colour you like') }),
            h('small', { text: tr('Drives the same glows and highlights as a named theme.') })),
          hexField),
        ...LOOKS.themeFileRows(LK),
        caption(tr('Mode')),
        group(
          srow('theme', prefTabs('theme', [['dark', tr('Dark')], ['light', tr('Light')]], () => {
            if (pref('themeAuto')) setPref('themeAuto', false);
            if (pref('themeSun')) setPref('themeSun', false);
            paintMain();
          })),
          LOOKS.sunRow(LK),
          srow('themeAuto', mqDark
            ? prefSwitch('themeAuto', () => { syncAutoTheme(); paintMain(); })
            : h('span.badge', { text: tr('Not reported here') })),
        ),
        h('div.row', btn('rotate-ccw', tr('Back to Static Crimson'),
          () => { setPref('accent', dflt('accent')); THEMES.apply(dflt('accent')); paintMain(); }, '.btn--ghost')),
      ];
    }

    /* ============================================================
       4 · Dock
       ============================================================ */
    function dockCard() {
      const ids = (store.get('dock') || []).filter(id => id !== 'launcher' && api.getApp(id) && !api.getApp(id).hidden);
      const list = h('div.list');

      if (!ids.length) {
        list.appendChild(h('div.empty', { style: { height: 'auto', padding: 'var(--sp-6)' } },
          icon('grid-9'), h('b', { text: tr('The dock is empty') }),
          h('small', { text: tr('Add an app below to pin it beside the launcher.') })));
      }

      const move = (i, d) => {
        const next = ids.slice(), j = i + d;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        store.set('dock', next);
      };

      ids.forEach((id, i) => {
        const app = api.getApp(id);
        list.appendChild(h('div.list__item',
          h('span.list__idx', { text: String(i + 1) }),
          appTile(app, { gs: '24px' }),
          h('div.grow', h('b', { text: app.name }), h('small', { text: app.category })),
          ibtn('chevron-up', tr('Up'), () => move(i, -1), i === 0, tr('Move {name} up', { name: app.name })),
          ibtn('chevron-down', tr('Down'), () => move(i, 1), i === ids.length - 1, tr('Move {name} down', { name: app.name })),
          ibtn('minus', tr('Remove'), () => store.set('dock', ids.filter(x => x !== id)), false,
            tr('Remove {name} from the dock', { name: app.name })),
        ));
      });

      const addMenu = e => {
        const free = api.listApps().filter(a => !ids.includes(a.id));
        const r = e.currentTarget.getBoundingClientRect();
        api.menu(free.length
          ? free.map(a => ({ label: a.name, icon: a.icon, hint: a.category,
              onClick: () => store.set('dock', [...ids, a.id]) }))
          : [{ label: tr('Every app is already in the dock'), disabled: true }], r.left, r.bottom + 6);
      };

      return h('div.card', { style: { padding: 'var(--sp-4)' } }, list,
        h('div.row', { style: { marginTop: 'var(--sp-4)' } },
          btn('plus', tr('Add app…'), addMenu),
          h('div.grow'),
          btn('rotate-ccw', tr('Reset dock'),
            /* and no folders (js/shell/dockfolders.js) */
            () => { store.set('session.dockFolders', []); store.set('dock', (store.defaults?.dock || []).slice()); }, '.btn--ghost')));
    }

    function paintDock() {
      return [
        caption(tr('Layout')),
        group(
          srow('shellLayout', prefTabs('shellLayout', [['dock', tr('Dock')], ['taskbar', tr('Taskbar')]], () => paintMain())),
          srow('launcherStyle', prefTabs('launcherStyle', [['panel', tr('Panel')], ['start', tr('Start menu')]]))),
        note(pref('shellLayout') === 'taskbar'
          ? tr('The taskbar is on: it runs along the bottom edge, so the Dock’s position, size and magnification don’t apply. Switch back to Dock any time.')
          : tr('The Dock is the default. The taskbar is the same apps in a bar along the whole bottom edge, if you like that better.'), 'monitor'),
        caption(tr('Behaviour')),
        group(srow('dockMagnify', prefSwitch('dockMagnify'))),
        caption(tr('Apps in the dock')),
        dockCard(),
        note(tr('The launcher keeps the first slot and cannot be removed.')),
      ];
    }

    /* ============================================================
       5 · Desktop
       ============================================================ */
    function paintDesktop() {
      return [
        caption(tr('Desktop layer')),
        group(
          srow('desktopIcons', prefSwitch('desktopIcons')),
          srow('deskIconSize', prefTabs('deskIconSize', [['small', tr('Small')], ['medium', tr('Medium')], ['large', tr('Large')]])),
          srow('widgetsVisible', prefSwitch('widgetsVisible')),
          srow('desktopClock', prefSwitch('desktopClock')),
          srow('deskHome', prefSwitch('deskHome')),
          srow('devEvents', prefSwitch('devEvents')),
        ),
        caption(tr('Apps on the desktop')),
        group(srow('deskApps', btn('plus', tr('Put favourite apps on the desktop'), () => {
          const r = addStarterApps();
          api.notify({ app: tr('Settings'), icon: r.added ? 'monitor' : 'check', timeout: 4000,
            title: r.added ? tr('Apps added to the Desktop') : tr('Already on your Desktop'),
            message: r.added ? tr('Static Games, Arcade, Music and Notes are there now. Ones that were already there stayed as they were.') : tr('Static Games, Arcade, Music and Notes are all on the Desktop already.') });
        }))),
        caption(tr('Windows')),
        group(srow('win.reset', btn('rotate-ccw', tr('Reset window positions'), () => {
          WL.resetPositions();
          api.notify({ app: tr('Settings'), icon: 'window', title: tr('Window positions reset'), message: tr('Apps open in their usual places again.') });
        }))),
        caption(tr('Language')),
        group(srow('lang', select(tr('Language'), I18N.LANGS.map(l => [l.id, l.name]), I18N.lang(), v => {
          /* the words are baked in as the page is built, so a reload applies the change; open windows are restored (the session) */
          if (!I18N.setLang(v)) return;
          setTimeout(() => location.reload(), 120);
        }))),
        caption(tr('Clock and units')),
        group(
          srow('h24', prefSwitch('h24')),
          srow('weatherUnit', prefTabs('weatherUnit', [['F', '°F'], ['C', '°C']])),
        ),
        caption(tr('Startup')),
        group(
          srow('bootOS', prefTabs('bootOS',
            [['linux', 'Linux'], ['windows', 'Windows'], ['plain', 'StaticOS']], v => applyOS(v))),
          srow('bootSkip', prefSwitch('bootSkip')),
          ...SD.startupRows(dataKit()),
          LOOKS.crtRow(LK),
          srow('introVideo', prefSwitch('introVideo')),
          srow('tips', prefSwitch('tips'), btn('sparkles', tr('Replay a tip…'), e => { const r = e.currentTarget.getBoundingClientRect(); api.bus.emit('tips:replay', { x: r.left, y: r.bottom + 4 }); })),
          row('compass', tr('Guided tour'), tr('A short walk round the desktop: the top bar, dock, launcher, search, windows, desktops and more.'), btn('compass', tr('Take the tour'), () => api.bus.emit('tour:start'))),
        ),
        caption(tr('Desktop pet')),
        group((() => {
          const petIt = btn('heart', tr('Pet it'), () => api.bus.emit('pet:pet'));
          petIt.disabled = !pref('desktopPet');
          return srow('desktopPet', prefSwitch('desktopPet', v => { petIt.disabled = !v; }), petIt);
        })(),
          srow('petKind', prefTabs('petKind', [['cat', tr('Cat')], ['dog', tr('Dog')], ['none', tr('None')]])),
          srow('petName', (() => {
            const input = h('input', { type: 'text', value: String(pref('petName') || ''), maxlength: '20', placeholder: tr('No name'), spellcheck: 'false', 'aria-label': tr('Pet name'), autocomplete: 'off' });
            input.addEventListener('change', () => setPref('petName', input.value.replace(/\s+/g, ' ').trim().slice(0, 20)));
            return h('div.field', input);
          })())),
        caption(tr('Hot corners')),
        group(HC.CORNERS.map(([, key]) => srow(key, prefSelect(key, HC.ACTIONS)))),
        caption(tr('Desktop stickers')),
        group((() => {
          const grid = h('div.st-hw__row.st-pp', { role: 'group', 'aria-label': tr('Sticker pack') });
          const wrap = h('div.set-row.st-pp-wrap', { hidden: true }, grid);
          const fill = pack => {
            grid.replaceChildren(...pack.STICKERS.map(t => h('button.st-hw__pick', {
              type: 'button', 'aria-label': tr('Put a {name} sticker on the desktop', { name: t.name }), title: t.name, dataset: { sticker: t.id },
              onclick: () => HW.placeSticker(t.id),
            }, h('img.st-hw__art', { src: pack.artUrl(t.id), alt: '' }))));
          };
          const open = btn('sparkles', tr('Choose a sticker…'), () => {
            wrap.hidden = !wrap.hidden;
            open.setAttribute('aria-expanded', String(!wrap.hidden));
            if (!wrap.hidden && !grid.firstChild) HW.loadPack().then(fill);   /* the art is fetched only now */
          });
          open.setAttribute('aria-expanded', 'false');
          return [
            srow('stickers', open, btn('trash', tr('Clear all'), () => HW.clearStickers(), '.btn--ghost')),
            wrap,
          ];
        })()),
        QP.lockPane({ h, store, group, row, caption, btn, select, api }),
        group(...SD.lockRows(dataKit())),
        caption(tr('Screensaver')),
        group(
          srow('screensaver', select(SET.screensaver.label, SS.DELAYS.map(m => [String(m), m ? plural(m, '{n} minute', '{n} minutes') : tr('Off')]),
            String(SS.delayMinutes()), v => setPref('screensaver', Number(v)))),
          srow('screensaverStyle', select(SET.screensaverStyle.label, SS.styles().map(k => [k, SS.STYLE_NAMES[k]]),
            SS.styleNow(), v => setPref('screensaverStyle', v)),
            btn('play', tr('Preview'), () => api.bus.emit('screensaver:preview'))),
          srow('screensaverClock', prefSwitch('screensaverClock')),
        ),
        caption(tr('Jump to')),
        h('div.row', { style: { flexWrap: 'wrap' } },
          btn('video', tr('StaticOS video'), () => import('../shell/introvideo.js').then(m => m.watch())),
          btn('grid', tr('Window overview'), () => api.overview()),
          btn('wallpaper', tr('Wallpaper…'), () => go('wallpaper')),
          btn('apps', tr('Dock…'), () => go('dock'))),
      ];
    }

    /* ============================================================
       6 · Windows
       ============================================================ */
    function paintWindows() {
      const wins = M.windows();
      const list = h('div.list');
      for (const w of wins.apps) {
        const app = api.getApp(w.app);
        list.appendChild(h('div.list__item',
          appTile(app || { icon: 'window' }, { gs: '22px' }),
          h('div.grow', h('b', { text: app?.name || w.app }),
            h('small', { text: `${w.w}×${w.h}${w.minimised ? ' · minimised' : ''}${w.focused ? ' · focused' : ''}` })),
          w.minimised ? h('span.badge', { text: tr('Minimised') }) : null,
          w.focused ? h('span.badge.badge--accent', { text: tr('Front') }) : null));
      }
      return [
        caption(tr('Appearance')),
        group(
          srow('uiBlur', prefSwitch('uiBlur')),
          srow('uiShadows', prefSwitch('uiShadows')),
          srow('reduceMotion', prefSwitch('reduceMotion')),
        ),
        caption(tr('Open windows · {count}', { count: wins.count })),
        h('div.card', { style: { padding: 'var(--sp-4)' } }, list,
          h('div.row', { style: { marginTop: 'var(--sp-4)', flexWrap: 'wrap' } },
            btn('grid', tr('Overview'), () => api.overview()),
            btn('minimize-2', tr('Minimise all'), () => {
              for (const w of api.wm.list()) if (w.appId !== 'settings') api.wm.minimize(w);
              paintMain();
            }),
            h('div.grow'),
            btn('x', tr('Close all but Settings'), () => {
              for (const w of api.wm.list()) if (w.appId !== 'settings') api.wm.close(w.id);
              paintMain();
            }, '.btn--ghost'))),
        note(tr('Snapping, cycling and closing all have keyboard shortcuts — see the Shortcuts pane.')),
      ];
    }

    /* ============================================================
       7 · Notifications
       ============================================================ */
    const notiOn = id => S.noti[id] !== false;
    const setNoti = (id, v) => {
      S.noti = { ...S.noti, [id]: v };          // new object: the store compares by identity
      store.set('prefs.notiApps', S.noti);
    };

    function paintNotifications() {
      const apps = api.listApps();
      const silenced = apps.filter(a => !notiOn(a.id)).length;

      return [
        caption(tr('Delivery')),
        group(
          srow('dnd', prefSwitch('dnd', () => { if (S.sec === 'notifications') paintMain(); })),
          srow('noti.test', btn('bell', tr('Send one'), () => api.notify({
            app: tr('Settings'), icon: 'bell', title: tr('Test notification'),
            message: pref('dnd')
              ? tr('Do Not Disturb is on — this went straight to the drawer.')
              : tr('Toasts look like this, bottom-right above the dock.'),
            actions: [{ label: tr('Nice') }],
          }))),
          srow('noti.ach', sw(tr('Achievement toasts'), () => notiOn('achievements'), v => setNoti('achievements', v))),
        ),
        NP.summaryPane({ h, icon, store, group, row, caption, btn, sw, note, repaint: paintMain, apps }),
        NP.schedulePane({ h, icon, store, group, row, caption, btn, sw, note, repaint: paintMain }),
        QP.dndExceptionsPane({ h, icon, store, caption, note, select, repaint: paintMain, apps, api }),
        caption(silenced ? tr('Per app · {silenced} silenced', { silenced }) : tr('Per app')),
        group(apps.map(a => row(a.icon, a.name, a.desc || a.category,
          sw(tr('{name} notifications', { name: a.name }), () => notiOn(a.id), v => setNoti(a.id, v))))),
        h('div.row',
          btn('bell', tr('Notification Centre'), () => api.bus.emit('noti:toggle')),
          h('div.grow'),
          btn('rotate-ccw', tr('Allow every app'), () => {
            S.noti = {};
            store.set('prefs.notiApps', {});
            paintMain();
          }, '.btn--ghost')),
      ];
    }

    /* ============================================================
       8 · Keyboard
       ============================================================ */
    function keyTester() {
      const keyEl = h('div.st-key__k', { text: tr('Press a key') });
      const codeEl = h('small.dim', { text: tr('Nothing captured yet') });
      const mods = h('div.row', { style: { gap: 'var(--sp-2)', flexWrap: 'wrap' } });

      const onKey = e => {
        if (S.dead || S.sec !== 'keyboard') return;
        /* do not swallow the key — this pane only watches */
        keyEl.textContent = e.key === ' ' ? tr('Space') : e.key;
        codeEl.textContent = `code ${e.code} · keyCode ${e.keyCode}${e.repeat ? ' · repeating' : ''}`;
        api.render(mods, [
          ['⌘ Meta', e.metaKey], ['⌃ Control', e.ctrlKey], ['⌥ Alt', e.altKey], ['⇧ Shift', e.shiftKey],
        ].map(([label, on]) => h('span' + (on ? '.chip.chip--accent' : '.chip'), { text: label })));
      };
      window.addEventListener('keydown', onKey);
      /* the pane is rebuilt on every navigation, so the previous listener has
         to go with it or they stack up */
      testerOff?.();
      testerOff = () => window.removeEventListener('keydown', onKey);

      return h('div.card.st-key', h('div.card__head', icon('keyboard'),
        h('div.card__t', { text: tr('Key tester') })),
        keyEl, codeEl, mods);
    }
    let testerOff = null;

    function paintKeyboard() {
      const mod = fmt.isMac ? tr('Command (⌘)') : tr('Control');
      return [
        caption(tr('This keyboard')),
        group(
          srow('kb.mod', h('span.chip.chip--accent', { text: mod })),
        ),
        facts([
          [tr('Browser language'), navigator.language || null],
          [tr('Platform'), navigator.userAgentData?.platform || navigator.platform || null],
        ]),
        QP.snippetsPane({ h, icon, caption, note, btn, repaint: paintMain }),
        caption(tr('Test')),
        keyTester(),
        note(tr('Static never remaps keys at the operating-system level — a page cannot. Combinations the browser keeps for itself (⌘T, ⌘N, ⌘Q on some platforms) never reach us at all.')),
        h('div.row', btn('command', tr('All shortcuts'), () => go('shortcuts'))),
      ];
    }

    /* ============================================================
       9 · Shortcuts
       ============================================================ */
    /* js/apps/shortcuts-pane.js: every row from js/core/keymap.js — the list
       the shortcut sheet (hold ⌘ / Ctrl) and Help read — each with Change… */
    const paintShortcuts = () => SC.pane({ api, caption, note, btn, go });

    /* ============================================================
       10 · Accessibility
       ============================================================ */
    const mq = q => (typeof matchMedia === 'function' ? matchMedia(q).matches : null);

    /* Read aloud (js/core/speech.js, js/shell/readaloud.js): the browser's
       own voices, listed as the browser gives them — nothing is offered
       that it can't do. */
    const rangeCtl = (label, R, value, onSet, show) => {
      const v0 = Number.isFinite(Number(value)) ? Number(value) : R.def;
      const out = h('small.dim', { text: show(v0), style: { width: '38px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
      const input = h('input.slider', {
        type: 'range', min: String(R.min), max: String(R.max), step: String(R.step), value: String(v0),
        'aria-label': label, 'aria-valuetext': show(v0), style: { flex: '1 1 auto', minWidth: '0' },
        oninput: e => { const v = Number(e.target.value); out.textContent = show(v); e.target.setAttribute('aria-valuetext', show(v)); onSet(v); },
      });
      return h('div.row', { style: { width: '168px' } }, input, out);
    };
    function readAloud() {
      const keys = KM.hint('readaloud');
      const how = note(tr('Select text in any app, then right-click › Read aloud, press {keys}, or type “read selection” in Search. A small player highlights each sentence as it is read.', { keys }));
      if (!SPEECH.supported()) return [group(row('volume-x', tr('Read aloud isn’t available'), SPEECH.MISSING))];
      const voiceList = list => {
        const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
        const sorted = list.slice().sort((a, b) => ((b.lang || '').toLowerCase().startsWith(lang) - (a.lang || '').toLowerCase().startsWith(lang))
          || String(a.name).localeCompare(String(b.name)));
        const items = [['', tr('Browser default')], ...sorted.map(v => [v.voiceURI, `${v.name} — ${v.lang || '?'}${v.localService === false ? ' (online)' : ''}`])];
        const cur = String(pref('readVoice') || '');
        const has = !cur || list.some(v => v.voiceURI === cur);
        const sel = select(tr('Read-aloud voice'), has ? items : [...items, [cur, tr('A voice this browser no longer has')]], cur, v => setPref('readVoice', v));
        sel.style.maxWidth = '220px';
        return sel;
      };
      return [
        async_(() => SPEECH.whenVoices(1500), list => group(
          list.length ? srow('readVoice', voiceList(list)) : row('alert', tr('No voices in this browser'), SPEECH.NO_VOICES),
          srow('readRate', rangeCtl(tr('Reading speed'), SPEECH.RATE, pref('readRate'), v => setPref('readRate', v), v => `${v.toFixed(1)}×`)),
          srow('readPitch', rangeCtl(tr('Voice pitch'), SPEECH.PITCH, pref('readPitch'), v => setPref('readPitch', v), v => v.toFixed(1))),
          srow('read.try', h('button.btn.btn--sm', { type: 'button', disabled: !list.length,
            onclick: () => api.bus.emit('speech:read', tr('This is how StaticOS reads aloud. Select text in any app, then right-click and choose Read aloud.')) },
          icon('play'), h('span', { text: tr('Read a sample') })))), tr('Asking the browser for its voices…')),
        how,
      ];
    }

    function paintAccessibility() {
      /* js/apps/a11y-pane.js: Reduce clutter, the "?" chip, captions, the keyboard, the status-bar menu */
      const X = A11Y.extras({ api, srow, group, caption, note, select, prefSwitch, pref, setPref, btn, repaint: () => paintMain() });
      return [
        ...X.intro,
        SETUPS.textPreview(KIT),
        caption(tr('Motion')),
        group(srow('reduceMotion', prefSwitch('reduceMotion', () => paintMain()))),
        caption(tr('Sight')),
        group(
          srow('textScale', prefSelect('textScale', TEXT_SCALE, () => paintMain())),
          srow('contrast', prefSelect('contrast', CONTRAST, () => paintMain())),
          srow('uiTransparency', sw(tr('Reduce transparency'),
            () => pref('uiTransparency') === 'reduced',
            v => { setPref('uiTransparency', v ? 'reduced' : 'full'); paintMain(); })),
          ...X.sight,
        ),
        /* magnifier, colour filters, reading font and spacing: js/apps/a11y-pane.js */
        ...A11Y.sections({ srow, group, caption, note, select, prefSwitch, rangeCtl, pref, setPref }),
        caption(tr('Keyboard')),
        group(srow('focusRings', prefSwitch('focusRings')), ...X.keyboard),
        ...X.sounds,
        ...X.bar,
        caption(tr('Read aloud')),
        ...readAloud(),
        caption(tr('What this computer asks for')),
        group(srow('a11y.system', h('span.badge', {
          text: [mq('(prefers-reduced-motion: reduce)') ? 'less motion' : null,
                 mq('(prefers-contrast: more)') ? 'more contrast' : null,
                 mq('(forced-colors: active)') ? 'forced colours' : null,
                 mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
          ].filter(Boolean).join(' · ') })),
        ),
        facts([
          [tr('Reduced motion'), mq('(prefers-reduced-motion: reduce)') === null ? null
            : (mq('(prefers-reduced-motion: reduce)') ? tr('Requested by the system') : tr('Not requested'))],
          [tr('Increased contrast'), mq('(prefers-contrast: more)') === null ? null
            : (mq('(prefers-contrast: more)') ? tr('Requested by the system') : tr('Not requested'))],
          [tr('Forced colours'), mq('(forced-colors: active)') ? tr('Active') : tr('Off')],
          [tr('Colour scheme'), mq('(prefers-color-scheme: dark)') ? tr('Dark') : tr('Light')],
        ]),
        note(tr('Static honours the system request for reduced motion on its own. The switches above are on top of that, for when the computer is not set up the way you need it.')),
      ];
    }

    /* ============================================================
       11 · Proxy
       ============================================================ */
    const PHASE = {
      idle: [tr('Not running'), ''],
      booting: [tr('Starting…'), 'warn'],
      ready: [tr('Running'), 'ok'],
      failed: [tr('Failed'), 'bad'],
      unsupported: [tr('Not available here'), 'bad'],
    };

    function proxyObservations() {
      let entries = [];
      try { entries = PCAT.all(); } catch (err) { entries = []; }
      PS.attach(store);
      const counts = {};
      for (const e of entries) {
        const st = PS.statusOf(e);
        counts[st] = (counts[st] || 0) + 1;
      }
      const order = ['verified', 'reachable', 'untested', 'blocked', 'dead'];
      return { total: entries.length, counts, order };
    }

    function paintProxy() {
      const st = UV.status();
      const sup = UV.isSupported();
      const [phaseLabel, phaseTone] = PHASE[st.phase] || [tr('Unknown'), ''];
      const obs = proxyObservations();
      const chosen = pref('wispServer');

      const relay = select(tr('Relay server'),
        UV.WISP_SERVERS.map(w => [w.id, w.name]),
        UV.WISP_SERVERS.some(w => w.id === chosen) ? chosen : UV.WISP_SERVERS[0].id,
        async v => {
          setPref('wispServer', v);
          /* Only switch live when a tunnel already exists — otherwise
             useWisp() would boot the whole proxy from a dropdown, which is
             not what picking a server from a list should do. */
          if (UV.status().phase === 'ready') {
            await UV.useWisp(v);
            api.notify({ app: tr('Settings'), icon: 'network', title: tr('Relay switched'),
              message: UV.status().wisp?.name || v });
          }
          paintMain();
        });

      const chosenServer = UV.WISP_SERVERS.find(w => w.id === chosen) || UV.WISP_SERVERS[0];

      const start = btn('play', tr('Start the proxy'), async e => {
        const b = e.currentTarget;
        b.disabled = true;
        await UV.boot({ wisp: chosenServer.id });
        if (!S.dead && S.sec === 'proxy') paintMain();
      }, '.btn--primary');

      const stop = btn('rotate-ccw', tr('Unregister and reset'), () => {
        api.confirm({
          title: tr('Reset the proxy?'),
          message: tr('The service worker is unregistered and the tunnel is dropped. Anything open through the proxy stops working until it is started again.'),
          ok: tr('Reset it'), cancel: tr('Leave it running'),
        }).then(async ok => {
          if (!ok) return;
          await UV.reset();
          if (!S.dead && S.sec === 'proxy') paintMain();
        });
      }, '.btn--ghost');

      return [
        caption(tr('Status')),
        group(
          srow('proxy.state',
            h('span.badge' + (phaseTone ? `.badge--${phaseTone}` : ''), { text: phaseLabel })),
          st.phase === 'ready' ? row('network', tr('Connected through'), tr('The tunnel currently carrying traffic.'),
            h('span.chip.chip--accent', { text: st.wisp?.name || tr('unknown') })) : null,
          st.error ? row('alert', tr('Last error'), String(st.error.message || st.error), null) : null,
          row(sup.ok ? 'check-circle' : 'alert', tr('Browser support'),
            sup.ok ? tr('Service workers are available on this origin.') : sup.why,
            h('span.badge' + (sup.ok ? '.badge--ok' : '.badge--bad'), { text: sup.ok ? tr('Supported') : tr('Blocked') })),
        ),
        h('div.row', { style: { flexWrap: 'wrap' } },
          st.phase === 'ready' ? null : start,
          btn('shield', tr('Open Static Proxy'), () => api.openApp('aether-proxy')),
          h('div.grow'),
          stop),
        caption(tr('Relay')),
        group(
          srow('wispServer', relay),
          row('info', chosenServer.name, chosenServer.note,
            h('span.chip.mono', { text: chosenServer.url })),
        ),
        note(tr('These relays are other people’s free infrastructure. Static does not run them, cannot promise any of them will be up, and switches to another automatically when one refuses a connection. Everything you load through the proxy passes through whichever one is selected.'),
          'alert'),
        caption(tr('Directory')),
        group(
          srow('proxy.obs', h('span.badge', { text: tr('{total} entries', { total: obs.total }) })),
          ...obs.order.filter(k => obs.counts[k]).map(k => row(
            k === 'verified' ? 'check-circle' : k === 'dead' || k === 'blocked' ? 'x-circle' : 'circle',
            PS.LABEL[k] || k,
            k === 'verified' ? tr('Seen rendering inside Static by a person.')
              : k === 'reachable' ? tr('The host answered a probe. That is not a promise it will frame.')
              : k === 'untested' ? tr('Never checked from this browser.')
              : k === 'blocked' ? tr('Refused to render in a frame.')
              : tr('No answer from the host.'),
            h('span.badge' + (PS.TONE[k] ? `.badge--${PS.TONE[k]}` : ''), { text: String(obs.counts[k]) }))),
        ),
        h('div.row', btn('trash', tr('Forget observations'), () => {
          PS.attach(store);
          PS.clear();
          paintMain();
        }, '.btn--ghost')),
      ];
    }

    /* ============================================================
       12 · Network
       ============================================================ */
    function paintNetwork() {
      const conn = M.connection();
      const net = M.network();
      const timing = M.timing();
      const online = navigator.onLine;

      const liveBadge = h('span.badge' + (online ? '.badge--ok' : '.badge--bad'),
        { text: online ? tr('Online') : tr('Offline') });
      S.live = () => {
        const on = navigator.onLine;
        liveBadge.className = 'badge ' + (on ? 'badge--ok' : 'badge--bad');
        liveBadge.textContent = on ? tr('Online') : tr('Offline');
      };

      const byType = net && net.byType.length
        ? h('div.set-group', h('table.table',
            h('thead', h('tr', h('th', { text: tr('Kind') }), h('th.num', { text: tr('Transferred') }))),
            /* a zero transfer size is either a cache hit or a cross-origin
               response that withheld its timing — either way, not a zero */
            h('tbody', net.byType.slice(0, 8).map(([k, v]) => h('tr',
              h('td', { text: k }), h('td.num', { text: v ? bytes(v) : tr('not reported') }))))))
        : null;

      return [
        ...SD.saverRows(dataKit()),
        caption(tr('Connection')),
        group(
          srow('net.state', liveBadge),
          conn ? row('trending-up', tr('Connection class'),
            tr('The browser’s own estimate, rounded on purpose.'),
            h('span.chip.chip--accent', { text: conn.type || tr('unknown') })) : null,
        ),
        facts([
          [tr('Downlink estimate'), conn && conn.downlink ? `${conn.downlink} Mb/s` : null],
          [tr('Round trip estimate'), conn && conn.rtt ? `${conn.rtt} ms` : null],
          [tr('Data saver'), conn ? (conn.saveData ? tr('On') : tr('Off')) : null],
          [tr('Requests this session'), net ? net.requests : null],
          [tr('Transferred'), net ? bytes(net.transferred) : null],
          [tr('Served from cache'), net ? tr('{cached} requests · {v} saved', { cached: net.cached, v: bytes(net.saved) }) : null],
          [tr('Time to first byte'), timing ? `${timing.ttfb} ms` : null],
          [tr('Page load'), timing ? `${timing.total} ms` : null],
        ]),
        conn ? null : note(tr('This browser does not expose a connection class. Everything above that is still shown was measured from the requests this tab actually made.')),
        byType ? caption(tr('What was downloaded')) : null,
        byType,
        note(tr('The menu bar’s network icon shows this tab’s real online state and the connection the browser reports. A page cannot see Wi-Fi networks or turn a radio on or off, so StaticOS doesn’t offer to.')),
        h('div.row', btn('shield', tr('Proxy settings'), () => go('proxy'))),
      ];
    }

    /* ============================================================
       13 · Privacy
       ============================================================ */
    function lsKeys() {
      const out = [];
      let others = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = localStorage.getItem(k) || '';
          /* UTF-16 in every engine that ships localStorage, hence ×2 */
          /* another person's keys count toward the space, but are not named */
          if (foreign(k)) others += (k.length + v.length) * 2;
          else out.push([k, (k.length + v.length) * 2]);
        }
      } catch (err) { /* private mode */ }
      if (others) out.push([tr('(other people on this computer)'), others]);
      return out.sort((a, b) => b[1] - a[1]);
    }

    function foreignHosts() {
      const map = new Map();
      let list = [];
      try { list = performance.getEntriesByType('resource') || []; } catch (err) { return []; }
      for (const r of list) {
        try {
          const u = new URL(r.name);
          if (u.origin === location.origin) continue;
          const cur = map.get(u.host) || { n: 0, b: 0 };
          cur.n++; cur.b += r.transferSize || 0;
          map.set(u.host, cur);
        } catch (err) { /* a blob: or data: entry */ }
      }
      return [...map.entries()].sort((a, b) => b[1].n - a[1].n);
    }

    /* the builders settings-data.js needs (the same kit settings-quiet.js is given) */
    const dataKit = extra => ({ h, icon, store, row, srow, group, caption, btn, sw, select, note, async_, api, SET, setPref, prefSwitch,
      repaint: () => { if (!S.dead) paintMain(); }, ...extra });

    function paintPrivacy() {
      const keys = lsKeys();
      const total = keys.reduce((a, k) => a + k[1], 0);
      const hosts = foreignHosts();
      const backupInput = h('input.sr', {
        type: 'file',
        accept: '.json,application/json',
        'aria-label': tr('Choose StaticOS data backup'),
        onchange: () => chooseBackupFile(api, backupInput),
      });

      const keyRows = keys.length
        ? keys.map(([k, size]) => h('tr',
            h('td', { text: k, style: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-10)' } }),
            h('td.num', { text: `≈ ${bytes(size)}` })))
        : [h('tr', h('td', { text: tr('Nothing stored yet') }), h('td.num', { text: '—' }))];

      const hostRows = hosts.length
        ? hosts.slice(0, 12).map(([host, v]) => h('tr',
            h('td', { text: host }),
            h('td.num', { text: tr('{n} req', { n: v.n }) }),
            h('td.num', { text: v.b ? bytes(v.b) : tr('not reported') })))
        : null;

      return [
        caption(tr('On this device')),
        group(srow('privacy.data', h('span.badge', { text: tr('{length} keys · ≈ {v}', { length: keys.length, v: bytes(total) }) }))),
        h('div.set-group', h('table.table',
          h('thead', h('tr', h('th', { text: tr('Storage key') }), h('th.num', { text: tr('Size') }))),
          h('tbody', keyRows))),
        note(tr('All of that lives in this browser profile on this computer. Static has no account system, no server of its own and no analytics — nothing above is uploaded anywhere.')),
        ...SD.backupRows(dataKit({ restoreInput: backupInput })),
        backupInput,
        caption(tr('Download the website')),
        group(row('download', tr('Save StaticOS to USB'), tr('Download the full website bundle. Extract it and serve it over HTTP to run it locally.'),
          h('a.btn.btn--sm', {
            href: 'takeout-staticos.zip',
            download: 'takeout-staticos.zip',
          }, icon('download'), h('span', { text: tr('Download website (.zip)') })))),
        caption(tr('Hosts this tab has contacted')),
        hostRows
          ? h('div.set-group', h('table.table',
              h('thead', h('tr', h('th', { text: tr('Host') }), h('th.num', { text: tr('Requests') }), h('th.num', { text: tr('Transferred') }))),
              h('tbody', hostRows)))
          : note(tr('Nothing outside this origin has been requested in this session.')),
        hosts.length > 12 ? h('small.dim', { text: tr('…and {v} more.', { v: hosts.length - 12 }),
          style: { padding: '0 var(--sp-2)' } }) : null,
        caption(tr('Service workers')),
        async_(
          () => (navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : []),
          regs => (regs.length
            ? group(...regs.map(r => row('refresh', r.scope.replace(location.origin, '') || '/',
                r.active ? tr('Active') : r.installing ? tr('Installing') : tr('Waiting'),
                h('span.badge' + (r.active ? '.badge--ok' : '.badge--warn'),
                  { text: r.active ? tr('active') : tr('idle') }))))
            : group(srow('privacy.sw', h('span.badge', { text: tr('None registered') })))),
          tr('Asking the browser…')),
        note(tr('Static registers one worker, at the site root, once the desktop has started. It keeps an offline copy of StaticOS on this device (so it starts without waiting on the network and works with none), and it is what lets a blocked page render inside Static instead of a new tab.')),
        caption(tr('Erase')),
        group(srow('privacy.reset', btn('power', tr('Reset StaticOS…'), resetAll, '.btn--danger'))),
      ];
    }

    /* ============================================================
       14 · Sound
       ============================================================ */
    const volName = v => (v <= 0 ? 'volume-x' : v < 50 ? 'volume-1' : 'volume');

    function audioDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return Promise.resolve(null);
      }
      return navigator.mediaDevices.enumerateDevices()
        .then(list => list.filter(d => d.kind === 'audiooutput' || d.kind === 'audioinput'));
    }

    function paintSound() {
      const uiOn = pref('uiSounds') !== false;
      const uiPart = (id, ctrl) => {
        const r = srow(id, ctrl);
        if (!uiOn) {
          r.classList.add('is-dim');
          r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; });
        }
        return r;
      };
      let volIco = icon(volName(pref('volume', 62)));
      const volRow = row(volIco, SET.volume.label, SET.volume.desc,
        slider(tr('Output volume'), Math.round(pref('volume', 62)), v => {
          setPref('volume', v);
          const next = icon(volName(v));
          volIco.replaceWith(next);
          volIco = next;
        }));

      const playing = [...document.querySelectorAll('audio,video')]
        .filter(el => !el.paused && !el.ended).length;

      return [
        caption(tr('Output')),
        group(
          volRow,
          srow('muted', prefSwitch('muted')),
        ),
        note(tr('The level applies to every audio and video element Static is playing — the Music player, a video in Files, a proxied page with sound. It cannot change the computer’s own volume.')),
        ...SETUPS.mixerRows(KIT),
        caption(tr('Interface')),
        group(
          /* toggling is itself the user gesture that lets WebAudio start, and
             a preview cue confirms it took */
          srow('uiSounds', prefSwitch('uiSounds', v => {
            sfx.setEnabled(v);
            if (v) sfx.play('open');
            if (S.sec === 'sound') paintMain();
          })),
          /* the pack's parts: dimmed and inert while UI sounds are off */
          uiPart('soundPack', h('div.row', { style: { gap: 'var(--sp-2)' } },
            select(tr('Sound pack'), sfx.PACKS.map(p => [p.id, p.name]), pref('soundPack'), v => {
              setPref('soundPack', v);
              sfx.unlock();
              sfx.preview(v);
            }),
            ibtn('play', tr('Hear it'), () => { sfx.unlock(); sfx.preview(pref('soundPack')); }, false, tr('Hear this sound pack')))),
          uiPart('uiSoundVolume', slider(tr('UI sound volume'), Math.round(Number(pref('uiSoundVolume')) || 0), v => {
            setPref('uiSoundVolume', v);
            /* hear the new level once the slider settles, not on every step */
            clearTimeout(paintSound.t);
            paintSound.t = setTimeout(() => { sfx.unlock(); sfx.play('toggle'); }, 160);
          })),
          uiPart('clickSounds', prefSwitch('clickSounds')),
          uiPart('notiSounds', prefSwitch('notiSounds', v => { if (v) { sfx.unlock(); sfx.play('notify'); } })),
          srow('bootSounds', prefSwitch('bootSounds', v => {
            sfx.unlock();
            if (v) setTimeout(() => sfx.previewChime(sfx.chimeId()), 30);
          })),
          NP.startupRows({ h, icon, store, row, select, ibtn, note, repaint: paintMain }),
        ),
        ...LOOKS.soundRows(LK),
        /* the seasonal pack voices two of these cues while it is on */
        SEASON.spooky('sounds')
          ? h('div.st-note.st-note--season', icon('pumpkin'),
              h('small', { text: tr('Spooky sounds are on: until the end of November 1 a window opening creaks and a notification says “boo” instead of your pack’s cue. Clicks, closing windows and everything else stay in your pack.') }),
              btn('pumpkin', tr('Spooky Season'), () => go('spooky'), '.btn--ghost'))
          : null,
        note(tr('Synthesised on the fly — no audio files, nothing recorded. They obey the output volume and Mute above.')),
        caption(tr('Right now')),
        group(row('music', tr('Media playing'), tr('Elements currently producing sound inside Static.'),
          h('span.badge' + (playing ? '.badge--ok' : ''), { text: String(playing) }))),
        caption(tr('Devices')),
        async_(audioDevices, list => {
          if (list === null) {
            return note(tr('This browser will not enumerate audio devices for a page.'));
          }
          if (!list.length) return note(tr('The browser reported no audio devices.'));
          const named = list.filter(d => d.label).length;
          return h('div.col', { style: { gap: 'var(--sp-4)' } },
            group(...list.map(d => row(d.kind === 'audioinput' ? 'mic' : 'cast',
              d.label || (d.kind === 'audioinput' ? tr('Input device') : tr('Output device')),
              d.label ? d.kind : tr('Name hidden until this page is given microphone permission'),
              h('span.badge', { text: d.kind === 'audioinput' ? tr('in') : tr('out') })))),
            named ? null : note(tr('Browsers hide device names from pages that have never been granted microphone access. The count is real; the names are withheld.')));
        }, tr('Asking the browser…')),
      ];
    }

    /* ============================================================
       15 · Display
       ============================================================ */
    const measureHz = () => SMOOTH.measureHz(60, 800, () => S.dead);   /* js/core/smoothcheck.js */

    function paintDisplay() {
      const hw = M.hardware();
      const hzOut = h('span.badge', { text: tr('not measured') });

      return [
        caption(tr('Brightness and colour')),
        group(
          srow('brightness', slider(tr('Brightness'), Math.round(pref('brightness', 100)),
            v => setPref('brightness', v))),
          srow('nightShift', prefSwitch('nightShift')),
        ),
        note(tr('Both are applied as a filter over the whole desktop. A page cannot reach the backlight, so this dims what Static draws rather than the screen itself.')),
        caption(tr('This display')),
        group(
          srow('display.full', btn(document.fullscreenElement ? 'minimize-2' : 'expand',
            document.fullscreenElement ? tr('Leave full screen') : tr('Go full screen'), () => {
              const p = document.fullscreenElement
                ? document.exitFullscreen?.()
                : document.documentElement.requestFullscreen?.();
              Promise.resolve(p).then(() => { if (!S.dead && S.sec === 'display') paintMain(); })
                .catch(() => api.notify({ app: tr('Settings'), icon: 'alert',
                  title: tr('Full screen refused'), message: tr('The browser would not hand over the display.') }));
            })),
          row('refresh', tr('Refresh rate'), tr('Counted from real animation frames over about half a second.'),
            hzOut,
            btn('activity', tr('Measure'), async e => {
              const b = e.currentTarget;
              b.disabled = true;
              hzOut.textContent = tr('measuring…');
              const hz = await measureHz();
              if (S.dead) return;
              b.disabled = false;
              hzOut.textContent = hz ? `${hz} Hz` : tr('could not measure');
              hzOut.className = 'badge badge--ok';
            })),
        ),
        facts([
          [tr('Screen'), hw.screen],
          [tr('Window'), hw.viewport],
          [tr('Device pixel ratio'), hw.dpr],
          [tr('Colour depth'), screen.colorDepth ? `${screen.colorDepth}-bit` : null],
          [tr('Orientation'), screen.orientation?.type || null],
          [tr('Colour gamut'), mq('(color-gamut: p3)') ? tr('Display P3 or wider') : 'sRGB'],
        ]),
        note(tr('Resolution and refresh rate are set by the computer, not by a web page. What is shown above is what this tab can actually see.')),
      ];
    }

    /* ============================================================
       16 · Performance
       ============================================================ */
    function paintPerformance() {
      /* The frame counter is the one live performance figure a page can
         honestly report. System Monitor stops it when it closes, so the
         tick below starts it again rather than showing a frozen number. */
      M.start('settings');
      const hw = M.hardware();
      const timing = M.timing();

      const fpsV = h('div.st-stat__v', { text: '—' });
      const heapV = h('div.st-stat__v', { text: '—' });
      const heapBar = h('i');
      const winV = h('div.st-stat__v', { text: String(M.windows().count) });

      S.live = () => {
        M.start('settings');
        const fps = M.currentFps();
        fpsV.textContent = fps ? String(fps) : '—';
        const hp = M.heap();
        if (hp) {
          heapV.textContent = bytes(hp.used);
          heapBar.style.width = `${hp.pct}%`;
        }
        winV.textContent = String(M.windows().count);
      };
      S.live();

      /* the screen's refresh rate, counted from real frames; the line only appears once it was measured */
      const hzNote = h('small.dim', { hidden: true, style: { padding: '0 var(--sp-2)', display: 'block' } });
      SMOOTH.measureHz(60, 800, () => S.dead).then(hz => {
        if (S.dead || !hz || hz < 10) return;
        hzNote.textContent = tr('Screen refresh measured here: {hz} Hz. A page cannot draw faster than the screen refreshes, so the most this can show is about {hz}.', { hz });
        hzNote.hidden = false;
      });

      const heap = M.heap();

      return [
        caption(tr('Live')),
        statGrid(
          h('div.st-stat', fpsV, h('div.st-stat__k', { text: tr('frames per second') })),
          heap ? h('div.st-stat', heapV, h('div.st-stat__k', { text: tr('JS heap in use') })) : null,
          h('div.st-stat', winV, h('div.st-stat__k', { text: tr('open windows') })),
        ),
        hzNote,
        heap ? h('div.bar', { style: { marginTop: 'var(--sp-2)' } }, heapBar) : null,
        heap ? h('small.dim', { text: tr('Heap limit {v} — the browser stops the tab above it.', { v: bytes(heap.limit) }),
          style: { padding: '0 var(--sp-2)' } }) : null,
        caption(tr('Gaming')),
        group(
          srow('gameMode', prefSwitch('gameMode')),
          srow('gameModeAuto', prefSwitch('gameModeAuto')),
        ),
        caption(tr('Make it faster')),
        group(
          srow('perf.low', sw(tr('Low graphics mode'), lowGfxOn, v => setLowGfx(v))),
          srow('uiBlur', prefSwitch('uiBlur')),
          srow('uiShadows', prefSwitch('uiShadows')),
          srow('reduceMotion', prefSwitch('reduceMotion')),
          srow('wallpaperGrain', prefSwitch('wallpaperGrain')),
        ),
        caption(tr('This machine')),
        facts([
          [tr('Logical cores'), hw.cores || null],
          [tr('Device memory'), hw.memoryGB ? tr('{memoryGB} GB (browser-rounded)', { memoryGB: hw.memoryGB }) : null],
          [tr('Browser'), hw.browser],
          [tr('Platform'), hw.platform],
          [tr('Device pixel ratio'), hw.dpr],
        ]),
        timing ? caption(tr('How long this page took')) : null,
        timing ? facts([
          ['DNS', `${timing.dns} ms`],
          [tr('Connect'), `${timing.connect} ms`],
          [tr('First byte'), `${timing.ttfb} ms`],
          [tr('Download'), `${timing.download} ms`],
          [tr('Building the DOM'), `${timing.dom} ms`],
          [tr('Total'), `${timing.total} ms`],
        ]) : null,
        caption(tr('What cannot be measured')),
        h('div.set-group', { style: { padding: 'var(--sp-5)' } },
          h('div.st-cant', M.unavailable().map(([k, why]) => h('div.st-cantrow',
            h('b', { text: k }), h('small', { text: why }))))),
        note(tr('No browser exposes host CPU, GPU, fan or disk activity to a page. Anything claiming to show them is drawing a random number. Static shows the frame rate instead, which is measured and is the figure that actually tells you the machine is struggling.')),
      ];
    }

    /* ============================================================
       17 · Storage
       ============================================================ */
    function cacheReport() {
      if (!window.caches?.keys) return Promise.resolve(null);
      return caches.keys().then(names => Promise.all(names.map(n =>
        caches.open(n).then(c => c.keys()).then(k => [n, k.length]).catch(() => [n, null]))));
    }

    /* what each of sw.js's caches is, in words (the raw name stays visible) */
    function cacheLabel(name) {
      if (name.startsWith('staticos-shell-')) return tr('Offline copy of StaticOS · build {v}', { v: name.slice(15) });
      return { 'staticos-data': tr('Catalogues kept for offline use'), 'staticos-fonts': tr('Fonts kept for offline use'),
        'staticos-classics': tr('Free Classics: downloaded game files, shared by everyone on this computer'),
        'staticos-words': tr('Word list for Letter Grid and Unscramble, shared by everyone on this computer'),
        'staticos-meta': tr('Offline copy: which build each tab runs') }[name] || name;
    }

    function offlineReport() {
      return import('../core/offline.js').then(O => O.status()).catch(() => null);
    }

    function dbReport() {
      if (!indexedDB?.databases) return Promise.resolve(null);
      return indexedDB.databases().then(list => list.filter(d => d && d.name && !foreign(d.name))).catch(() => null);
    }

    function paintStorage() {
      const ls = lsKeys();
      const lsTotal = ls.reduce((a, k) => a + k[1], 0);

      return [
        caption(tr('Origin storage')),
        async_(M.storage, est => {
          if (!est) return note(tr('This browser will not report a storage estimate to a page.'));
          const detail = est.detail
            ? Object.entries(est.detail).filter(([, v]) => v).sort((a, b) => b[1] - a[1])
            : [];
          return h('div.col', { style: { gap: 'var(--sp-4)' } },
            h('div.card',
              h('div.card__head', icon('hard-drive'), h('div.card__t', { text: tr('Used by StaticOS') }),
                h('div.grow'),
                h('span.badge' + (est.persisted ? '.badge--ok' : ''),
                  { text: est.persisted ? tr('Persistent') : tr('Evictable') })),
              h('div.row', { style: { alignItems: 'flex-end', marginBottom: 'var(--sp-4)' } },
                h('div.stat', h('div.stat__v', { text: bytes(est.used) }),
                  h('div.stat__k', { text: tr('of {v} the browser will allow', { v: bytes(est.quota) }) })),
                h('div.grow'),
                h('span.chip.chip--accent', { text: `${est.pct}%` })),
              pctBar(est.pct)),
            detail.length
              ? h('div.set-group', h('table.table',
                  h('thead', h('tr', h('th', { text: tr('Kind') }), h('th.num', { text: tr('Size') }))),
                  h('tbody', detail.map(([k, v]) => h('tr',
                    h('td', { text: k }), h('td.num', { text: bytes(v) }))))))
              : null);
        }, tr('Asking the browser…')),
        ...SETUPS.storageByApp(KIT),
        caption(tr('Persistence')),
        ...SD.keepRows(dataKit()),
        caption(tr('Trash')),
        group(srow('storage.trash', sw(SET['storage.trash'].label, () => store.get('prefs.trashAuto') === true,
          v => { setPref('trashAuto', v); if (S.sec === 'storage') paintMain(); }))),
        note(store.get('prefs.trashAuto') === true
          ? tr('On. When StaticOS starts, and once an hour while it is open, anything in the Trash for 30 days or more is deleted from this browser for good, and the space held by its pictures, videos and music is freed. There is no undo. Items put in the Trash before this was turned on were dated when it was switched on, so they get their 30 days from then. Files shows how many days each item has left.')
          : tr('Off. The Trash keeps everything until you empty it yourself. If you turn this on, anything in the Trash for 30 days or more is deleted for good when StaticOS starts (and once an hour while it is open), including the space its pictures, videos and music use. Items already in the Trash start their 30 days the moment you switch it on.'), 'trash'),
        caption(tr('Preferences and notes · ≈ {v}', { v: bytes(lsTotal) })),
        h('div.set-group', h('table.table',
          h('thead', h('tr', h('th', { text: tr('Storage key') }), h('th.num', { text: tr('Size') }))),
          h('tbody', (ls.length ? ls : [[tr('nothing stored yet'), 0]]).map(([k, size]) => h('tr',
            h('td', { text: k, style: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-10)' } }),
            h('td.num', { text: size ? `≈ ${bytes(size)}` : '—' })))))),
        caption(tr('Offline')),
        async_(offlineReport, st => {
          if (!st || !st.supported) return note(tr('This browser cannot keep an offline copy here (it needs a service worker and a secure connection).'));
          const what = st.complete
            ? tr('Ready. StaticOS starts from this device, and the desktop, Files, Notes and the Arcade work with no connection.')
            : st.active ? tr('Saving a copy in the background…')
              : tr('Not set up on this host (it has no build.json to tell versions apart).');
          return group(row('download', tr('Offline copy'), what,
            h('span.badge' + (st.complete ? '.badge--ok' : ''), { text: st.complete ? tr('ready') : st.active ? tr('saving') : tr('off') })));
        }, tr('Asking the offline copy…')),
        ...SD.offlineRows(dataKit()),
        ...SD.snapshotRows(dataKit()),
        caption(tr('Caches and databases')),
        async_(cacheReport, list => {
          if (!list) return note(tr('This browser does not expose the Cache Storage API.'));
          if (!list.length) return note(tr('Nothing is cached yet. The offline copy of StaticOS fills this in after the desktop starts.'));
          return h('div.col', { style: { gap: 'var(--sp-4)' } },
            group(...list.map(([name, n]) => row('database', cacheLabel(name),
              n === null ? tr('{name} · could not be opened', { name }) : plural(n, '{name} · {n} cached response', '{name} · {n} cached responses', { name }),
              btn('trash', tr('Delete'), async () => {
                await caches.delete(name).catch(() => {});
                if (!S.dead && S.sec === 'storage') paintMain();
              }, '.btn--ghost')))));
        }, tr('Listing caches…')),
        async_(dbReport, list => {
          if (!list) return null;
          if (!list.length) return note(tr('No IndexedDB databases on this origin.'));
          return group(...list.map(d => row('database', d.name, tr('version {version}', { version: d.version }),
            h('span.badge', { text: 'IndexedDB' }))));
        }, tr('Listing databases…')),
        h('div.row',
          btn('folder-open', tr('Open Files'), () => api.openApp('files', { path: '/' })),
          h('div.grow'),
          btn('trash', tr('Erase everything…'), resetAll, '.btn--danger')),
      ];
    }

    /* ============================================================
       18 · Applications
       ============================================================ */
    /* Per-app saved state, so "reset this app" can mean something exact. */
    const APP_STATE = {
      files: ['prefs.filesView'],
      chat: ['prefs.chatRail', 'prefs.chatLast'],
      weather: ['prefs.weatherUnit'],
      music: ['prefs.volume'],
      notes: ['notes'],
      settings: [RECENT_KEY],
    };

    /* ============================================================
       Labs — experiments that are real but not the default yet
       ============================================================ */
    /* Which AI model every AI app talks to (js/portal/aimodel.js). */
    function paintAI() {
      const my = S.paint;
      const cur = AIM.describe();
      const status = h('small', { role: 'status', id: 'ai-status', text: tr('Loading the list of free models…') });
      const free = h('div.set-group', { id: 'ai-free', role: 'radiogroup', 'aria-label': tr('Free models, no key needed') });
      const orBox = h('div.set-group', { id: 'ai-or', role: 'radiogroup', 'aria-label': tr('Free OpenRouter models') });
      const sentTo = h('small', { id: 'ai-sentto' });
      const nowTo = () => { const d = AIM.describe(); sentTo.textContent = tr('Now using {name}. What you send to an AI app (your question, or the text it reads) goes to {host}, not to StaticOS.', { name: d.name, host: d.host }); };
      const pickRow = m => {
        const on = AIM.selection().model === m.model && AIM.selection().provider === m.provider;
        return row('sparkles', m.name, tr('Requests go to {host}', { host: m.host }),
          h('button.btn.btn--sm', { type: 'button', role: 'radio', 'aria-checked': String(on), dataset: { model: m.model, provider: m.provider }, 'aria-label': tr('{name}, requests go to {host}', { name: m.name, host: m.host }),
            onclick: () => { AIM.choose(m.provider, m.model, m.name); if (fresh(my)) paintMain(); } }, h('span', { text: on ? tr('In use') : tr('Use') })));
      };
      AIM.anonymousModels().then(r => {
        if (!fresh(my)) return;
        free.replaceChildren(...r.models.map(pickRow));
        status.textContent = r.live ? tr('The free list is live from text.pollinations.ai: only models that work without a key are shown.') : tr('Could not load the live list, so only the built-in default is shown.');
      }).catch(() => {});
      const keyIn = h('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: false, placeholder: AIM.hasKey() ? tr('Key saved on this device') : tr('Paste your OpenRouter key'), 'aria-label': tr('OpenRouter API key'), style: { minWidth: '14rem' } });
      const kmsg = h('small', { role: 'status', id: 'ai-keymsg' });
      const loadOr = () => {
        orBox.replaceChildren();
        if (!AIM.hasKey()) return;
        kmsg.textContent = tr('Loading OpenRouter’s free models…');
        AIM.openrouterFree({ force: true }).then(r => {
          if (!fresh(my)) return;
          orBox.replaceChildren(...r.models.map(pickRow));
          kmsg.textContent = r.live ? tr('{length} models with a price of 0, from openrouter.ai.', { length: r.models.length }) : (r.error || tr('Could not load the list.'));
        }).catch(() => {});
      };
      loadOr();
      nowTo();
      return [
        caption(tr('Free, no key')),
        group(row('sparkles', tr('AI model'), tr('In use: {name}', { name: cur.name }), null)),
        free, status,
        caption(tr('More free models with your own free OpenRouter key')),
        group(row('lock', tr('OpenRouter key'), tr('Free to make at openrouter.ai/keys. Stored on this device for you only, and sent only to openrouter.ai. Free models there allow about 20 requests a minute and 50 a day (more once you have bought credits).'),
          keyIn,
          btn('check', tr('Save key'), () => { const v = keyIn.value.trim(); if (!/^[\w.-]{16,200}$/.test(v)) { kmsg.textContent = tr('That does not look like an OpenRouter key.'); return; } AIM.setKey(v); AIM.forgetLists(); keyIn.value = ''; if (fresh(my)) paintMain(); }),
          AIM.hasKey() ? btn('trash', tr('Remove key'), () => { AIM.clearKey(); AIM.forgetLists(); if (fresh(my)) paintMain(); }, '.btn--danger') : null)),
        kmsg, orBox,
        note(tr('Free models can be slow, busy or wrong. Apps that pick their own model (Forge uses its own OpenRouter key kept in memory) ignore this choice.')),
        h('div.st-note', icon('lock'), sentTo),
      ];
    }

    function paintLabs() {
      return [
        caption(tr('Experiments')),
        group(...SETUPS.labsRows(KIT)),
        note(tr('Labs features work, but they are not finished enough to be on for everyone. Each says what it changes and what turning it off does; none of them touches your files.')),
      ];
    }

    function paintApplications() {
      const apps = api.listApps();
      const dock = store.get('dock') || [];
      const cats = api.categories();

      const blocks = [];
      for (const c of cats) {
        const inCat = apps.filter(a => a.category === c);
        if (!inCat.length) continue;
        blocks.push(caption(`${c} · ${inCat.length}`));
        blocks.push(group(...inCat.map(a => {
          const open = api.wm.byApp(a.id).length;
          return h('div.set-row',
            appTile(a, { gs: '26px' }),
            h('div.set-row__t',
              h('b', { text: a.name }),
              h('small', { text: a.desc || a.category })),
            h('div.set-row__c',
              open ? h('span.badge.badge--accent', { text: tr('{open} open', { open }) }) : null,
              a.handles?.length ? h('span.badge', { text: a.handles.slice(0, 3).join(' ') }) : null,
              sw(tr('{name} in the dock', { name: a.name }), () => (store.get('dock') || []).includes(a.id), v => {
                const cur = (store.get('dock') || []).filter(x => x !== a.id);
                store.set('dock', v ? [...cur, a.id] : cur);
              }),
              ibtn('external-link', tr('Open'), () => api.openApp(a.id), false, tr('Open {name}', { name: a.name })),
              APP_STATE[a.id]
                ? ibtn('rotate-ccw', tr('Reset'), () => resetApp(a), false, tr('Reset {name} preferences', { name: a.name }))
                : null));
        })));
      }

      return [
        caption(tr('Installed')),
        group(srow('apps.list', h('span.badge', { text: tr('{length} apps', { length: apps.length }) }),
          h('span.badge', { text: tr('{n} in dock', { n: dock.filter(id => id !== 'launcher').length }) }))),
        note(tr('Apps register themselves at boot. Anything that failed to load simply does not appear here, in the dock, or in search — the list is what actually registered.')),
        ...blocks,
        caption(tr('Saved state')),
        group(srow('apps.state', h('small.dim', {
          text: tr('{v} apps keep preferences of their own.', { v: Object.keys(APP_STATE).length }) }))),
      ];
    }

    function resetApp(a) {
      const keys = APP_STATE[a.id] || [];
      api.confirm({
        title: tr('Reset {name}?', { name: a.name }),
        message: plural(keys.length, '{n} saved value go back to the default. ', '{n} saved values go back to the default. ')
          + tr('Your files and notes in other apps are untouched.'),
        ok: tr('Reset it'), cancel: tr('Cancel'),
      }).then(ok => {
        if (!ok) return;
        for (const k of keys) {
          if (k.startsWith('prefs.')) store.set(k, dflt(k.slice(6)));
          else store.set(k, store.defaults?.[k] ?? null);
        }
        api.notify({ app: tr('Settings'), icon: 'rotate-ccw', title: tr('{name} reset', { name: a.name }),
          message: tr('Reopen it to see the defaults.') });
        paintMain();
      });
    }

    /* ============================================================
       19 · About
       ============================================================ */
    const buildInfo = () => window.Static?.updater?.current || null;

    const updateChip = () => {
      const u = window.Static?.updater;
      if (u?.pending) return h('span.badge.badge--warn', { text: tr('Update ready') });
      if (pref('autoUpdate', 'notify') === 'off') return h('span.badge', { text: tr('Checks off') });
      return h('span.badge' + (u?.current ? '.badge--ok' : ''),
        { text: u?.current ? tr('Up to date') : tr('Not checked yet') });
    };

    function paintAbout() {
      const b = buildInfo();
      const hw = M.hardware();
      const upEl = h('td', { text: '—' });

      S.live = () => { upEl.textContent = upFmt(Math.round(performance.now() / 1000)); };
      S.live();

      return [
        h('div.about', { style: { padding: 'var(--sp-7) var(--sp-5) var(--sp-5)' } },
          h('div.about__logo', icon('diamond')),
          h('div',
            h('div', { text: 'StaticOS', style: { fontSize: 'var(--fs-24)', fontWeight: '700',
              letterSpacing: '-.6px', color: 'var(--ink-0)' } }),
            h('small.dim', { text: tr('Dark, glassy, and entirely local to this browser.'),
              style: { display: 'block', marginTop: '2px' } })),
          h('div.row', { style: { gap: 'var(--sp-2)', flexWrap: 'wrap', justifyContent: 'center' } },
            h('span.chip.chip--accent.mono', { text: b?.version ? `v${b.version}` : tr('version unstamped') }),
            h('span.chip.mono', { text: b?.build ? tr('build {build}', { build: b.build }) : tr('build unstamped') }),
            updateChip())),

        caption(tr('This build')),
        h('div.set-group', h('table.table', h('tbody',
          [
            [tr('Version'), b?.version],
            [tr('Build'), b?.build],
            [tr('Files served'), b?.files],
            [tr('Payload'), b?.bytes ? bytes(b.bytes) : null],
            [tr('Stamped'), b?.stamped ? new Date(b.stamped).toLocaleString() : null],
            [tr('Apps registered'), api.listApps().length],
            [tr('Themes'), THEMES.THEMES.length],
          ].filter(r => r[1] !== null && r[1] !== undefined)
            .map(([k, v]) => h('tr',
              h('td', { text: k, style: { color: 'var(--ink-3)', width: '44%' } }),
              h('td', { text: String(v) }))),
          h('tr', h('td', { text: tr('This tab has been up'), style: { color: 'var(--ink-3)' } }), upEl)))),
        b ? null : note(tr('build.json has not been read yet, so there is no fingerprint to show. Check for updates to read it.')),

        caption(tr('Where it is running')),
        facts([
          [tr('Browser'), hw.browser],
          [tr('Platform'), hw.platform],
          [tr('Logical cores'), hw.cores || null],
          [tr('Device memory'), hw.memoryGB ? tr('{memoryGB} GB (browser-rounded)', { memoryGB: hw.memoryGB }) : null],
          [tr('Screen'), hw.screen],
          [tr('Window'), hw.viewport],
          [tr('Language'), navigator.language || null],
        ]),
        note(tr('Those are the only facts about this computer a web page is given. StaticOS deliberately does not print a processor model or a kernel version, because it cannot know either one.')),

        ...SD.installRows(dataKit()),
        caption(tr('Updates')),
        group(
          srow('autoUpdate', prefSelect('autoUpdate',
            [['notify', tr('Notify me')], ['reload', tr('Restart automatically')], ['off', tr('Never check')]])),
          srow('whatsNewAfterUpdate', prefSwitch('whatsNewAfterUpdate')),
          srow('about.build', h('span.chip.mono', { text: b?.build || tr('unstamped') })),
          ...SD.updateRows(dataKit()),
        ),
        h('div.row', { style: { flexWrap: 'wrap' } },
          api.getApp('whatsnew') ? btn('sparkles', tr('What’s New'), () => api.openApp('whatsnew')) : null,
          btn('gauge', tr('Performance'), () => go('performance')),
          h('div.grow'),
          btn('power', tr('Reset StaticOS…'), resetAll, '.btn--danger')),
      ];
    }

    /* ============================================================
       Spooky Season — listed only October 24 – November 1
       (js/core/season.js). The first switch is the whole season;
       the rest are its parts, and do nothing while it is off.
       ============================================================ */
    function paintSpooky() {
      const now = new Date();
      const on = pref('spookyTheme') !== false;
      const left = SEASON.halloween(now);
      const when = left.passed
        ? (now.getMonth() === 9 ? tr('Happy Halloween!') : tr('The last night of spooky season.'))
        : left.days >= 2 ? tr('{days} days to Halloween.', { days: left.days })
        : left.days === 1 ? tr('1 day to Halloween.')
        : tr('Halloween starts at midnight.');

      const hero = h('div.st-spooky' + (on ? '' : '.is-off'),
        h('div.st-spooky__art', { 'aria-hidden': 'true' }, icon('pumpkin')),
        h('div.st-spooky__t',
          h('b', { text: tr('Spooky Season') }),
          h('small', { text: on
            ? tr('On until the end of November 1. {when}', { when })
            : tr('Off. StaticOS looks the way it does the rest of the year.') })),
        h('span.badge.st-spooky__state' + (on ? '.badge--accent' : ''), { text: on ? tr('On') : tr('Off') }));

      /* the parts: dimmed and inert while the season is switched off */
      const part = (id, ctrl) => {
        const r = srow(id, ctrl);
        if (!on) {
          r.classList.add('is-dim');
          r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; });
        }
        return r;
      };
      const sfxDo = fn => import('../core/sfx.js').then(fn).catch(() => {});
      const hear = name => sfxDo(m => { m.unlock(); m.spooky(name, SEASON.spookyLevel(), true); });

      const motionOff = !!document.querySelector('.desktop .wp.wp--still');
      const reducedMotion = document.body.classList.contains('reduce-motion')
        || matchMedia('(prefers-reduced-motion: reduce)').matches;

      return [
        hero,
        caption(tr('The season')),
        group(srow('spookyTheme', prefSwitch('spookyTheme'))),
        caption(tr('Extras')),
        group(
          part('spookyWallpaper', prefSwitch('spookyWallpaper')),
          part('spookyCountdown', prefSwitch('spookyCountdown')),
          part('spookyEffects', prefSwitch('spookyEffects')),
        ),
        on && pref('spookyCountdown') && !store.get('session.user')
          ? note(tr('Desktop widgets need a profile on this device, so the countdown appears once you make one (bottom-right corner).'), 'user') : null,
        on && pref('spookyEffects') && reducedMotion
          ? note(tr('Reduce motion is on, so the leaves and bats stay away.'), 'activity') : null,
        on && pref('spookyEffects') && !reducedMotion && motionOff
          ? note(tr('Wallpaper motion is off on this machine, so the leaves and bats are paused with it.'), 'gauge') : null,
        caption(tr('Sound pack')),
        group(
          part('spookySounds', prefSwitch('spookySounds', v => sfxDo(m => { m.unlock(); if (v) m.spooky('creak', SEASON.spookyLevel(), true); }))),
          part('spookyVolume', slider(tr('Spooky sound volume'), Math.round(pref('spookyVolume')), v => setPref('spookyVolume', v))),
          row('play', tr('Hear them'), tr('Each sound once, at the level above.'),
            h('div.row', { style: { gap: 'var(--sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' } },
              btn('play', tr('Creak'), () => hear('creak')),
              btn('play', tr('Boo'), () => hear('boo')),
              btn('play', tr('Cackle'), () => hear('cackle')))),
        ),
        note(tr('Off unless you turn them on. Every sound is synthesised in the browser, like StaticOS’s other cues — nothing is recorded or downloaded — and they follow the system volume and Mute.'), 'volume'),
      ];
    }

    /* ============================================================
       Halloween — the season, jump-scare mode and your treats
       ============================================================ */
    function paintHalloween() {
      const season = HW.inSeason();
      const st = HW.state();
      const days = Object.keys(st.days).length;
      const today = HW.today();
      const cursors = HW.ownedList('cursor');
      const stickers = HW.ownedList('sticker');
      const walls = HW.ownedList('wallpaper');
      const thumb = (type, id, label) => h('img.st-hw__art', { src: HW.artUrl(type, id), alt: label || '' });

      return [
        caption(tr('Season')),
        group(srow('hw.season', h('span.badge' + (season ? '.badge--accent' : ''), { text: season ? tr('On now') : tr('Resting') }))),
        note(season
          ? tr('Until 1 November: a pumpkin in the dock gives one trick or treat a day, there are Halloween badges to earn, and typing a certain spooky word on the desktop does something.')
          : tr('Halloween comes back on 24 October. Treats you already have keep working all year.'), 'pumpkin'),

        caption(tr('Jump-scare mode')),
        group(
          srow('jumpScares', prefSwitch('jumpScares', () => { if (S.sec === 'halloween') paintMain(); })),
          srow('hw.preview', btn('ghost', tr('Show one now'), () => api.bus.emit('spooky:scare', { preview: true }))),
        ),
        pref('jumpScares') && !season
          ? note(tr('Jump-scare mode is on, but it stays quiet until Halloween season starts.'), 'info') : null,

        ...paintGhostHunt(season),

        caption('Trick-or-treat'),
        group(srow('hw.days',
          h('span.badge', { text: plural(days, '{n} day', '{n} days') }),
          today ? h('span.chip', { text: tr('Today: {v}', { v: HW.describe(today) }) })
            : season ? h('span.chip.chip--accent', { text: tr('Not yet today') }) : null)),

        caption(tr('Your treats')),
        cursors.length || stickers.length || walls.length
          ? group(
            cursors.length ? srow('cursorSkin', tabs(tr('Cursor'),
              [['none', tr('Normal')], ...cursors.map(c => [c.id, c.name.replace(/ pointer$/, '')])],
              HW.owns('cursor', pref('cursorSkin')) ? pref('cursorSkin') : 'none',
              v => HW.setCursor(v))) : null,
            stickers.length ? srow('hw.stickers',
              h('div.st-hw__row', stickers.map(t => h('button.st-hw__pick', {
                type: 'button', 'aria-label': tr('Put a {name} sticker on the desktop', { name: t.name }), title: t.name,
                onclick: () => HW.placeSticker(t.id),
              }, thumb('sticker', t.id)))),
              st.stickers.length ? btn('trash', tr('Clear'), () => HW.clearStickers(), '.btn--ghost') : null) : null,
            walls.length ? srow('hw.walls',
              h('div.st-hw__row', walls.map(t => h('button.st-hw__pick.st-hw__pick--wide', {
                type: 'button', 'aria-label': tr('Use the {name} wallpaper', { name: t.name }), title: t.name,
                onclick: () => { HW.useWallpaper(t.id); paintMain(); },
              }, thumb('wallpaper', t.id))))) : null)
          : note(season
            ? tr('Nothing yet — treats from the dock pumpkin land here: wallpapers, cursors and desktop stickers.')
            : tr('Nothing yet. Treats come from the dock pumpkin during Halloween season.'), 'candy'),
      ].filter(Boolean);
    }

    /* The ghost hunt (js/core/ghosts.js): the switch, the real count and
       the places already searched — never the ones still hiding. */
    function paintGhostHunt(season) {
      const st = GHOSTS.state();
      const n = Object.keys(st.found).length, total = GHOSTS.TOTAL;
      const seasonOn = pref('spookyTheme') !== false;
      const huntOn = pref('ghostHunt') !== false;
      const where = GHOSTS.SPOTS.filter(s => st.found[s.id]).map(s => s.where);
      const sw = prefSwitch('ghostHunt', () => { if (S.sec === 'halloween') paintMain(); });
      if (season && !seasonOn) sw.disabled = true;
      const meter = h('div.st-gh', {
        role: 'progressbar', 'aria-label': tr('Ghosts caught'), 'aria-valuemin': '0',
        'aria-valuemax': String(total), 'aria-valuenow': String(n), 'aria-valuetext': tr('{n} of {total}', { n, total }),
      }, h('div.st-gh__bar', h('i', { style: { width: `${(n / total) * 100}%` } })), h('b', { text: tr('{n} of {total}', { n, total }) }));
      return [
        caption(tr('Ghost hunt')),
        group(srow('ghostHunt', sw), srow('hw.ghosts', meter)),
        !season
          ? note(n ? tr('You caught {n} of {total} this year. The ghosts come back on 24 October.', { n, total }) : tr('The ghosts come back on 24 October.'), 'ghost')
          : !seasonOn
            ? h('div.st-note.st-note--season', icon('pumpkin'),
                h('small', { text: tr('Spooky Season is off, so the ghosts are away too. Your catches are kept.') }),
                btn('pumpkin', tr('Spooky Season'), () => go('spooky'), '.btn--ghost'))
            : !huntOn
              ? note(tr('The hunt is off: no ghosts anywhere. Your catches are kept for when you turn it back on.'), 'ghost')
              : n >= total
                ? note(tr('All {total} caught — the Ghost Hunter badge is yours. Happy Halloween!', { total }), 'star')
                : note(n
                  ? tr('Caught {list}. {n} still hiding in apps, menus and corners.', { list: where.join(', '), n: total - n })
                  : tr('None caught yet. Look in apps, menus and corners — they are small and a little see-through.'), 'ghost'),
      ];
    }

    /* ---------------- pane tables ---------- */
    const PAINT = {
      appearance: paintAppearance,
      wallpaper: paintWallpaper,
      themes: paintThemes,
      setups: () => SETUPS.setupsPane(KIT),
      changed: () => SETUPS.changedPane(KIT),
      spooky: paintSpooky,
      /* js/apps/winter-pane.js draws it; js/core/winter.js keeps the advent doors */
      winter: () => WINTERPANE.pane({ api, caption, group, srow, note, btn, tabs, prefSwitch, pref, go,
        repaint: () => paintMain(),
        reducedMotion: () => document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches,
        motionOff: () => !!document.querySelector('.desktop .wp.wp--still') }),
      /* js/apps/celebrate-pane.js: New Year's, your birthday, Valentine's, spring */
      celebrations: () => CELPANE.pane({ api, caption, group, row, srow, note, btn, prefSwitch, pref, setPref, setLive: fn => { S.live = fn; }, repaint: () => paintMain() }),
      halloween: paintHalloween,
      dock: paintDock,
      desktop: paintDesktop,
      windows: paintWindows,
      notifications: paintNotifications,
      keyboard: paintKeyboard,
      shortcuts: paintShortcuts,
      accessibility: paintAccessibility,
      proxy: paintProxy,
      network: paintNetwork,
      privacy: paintPrivacy,
      ai: paintAI,
      users: () => [usersPanel()],
      sound: paintSound,
      display: paintDisplay,
      performance: paintPerformance,
      /* js/apps/screentime-pane.js draws it; js/core/screentime.js measures */
      screentime: () => [
        ...SCREENTIME.pane({ api, setLive: fn => { S.live = fn; }, repaint: () => paintMain() }),
        caption(tr('Weekly recap')),
        group(srow('weeklyRecap', prefSwitch('weeklyRecap'), btn('calendar', tr('Show the last one'), () => api.bus.emit('recap:show')))),
      ],
      storage: paintStorage,
      applications: paintApplications,
      labs: paintLabs,
      about: paintAbout,
    };

    const resetTool = secId => (canReset(secId)
      ? btn('rotate-ccw', tr('Reset'), () => resetSection(secId), '.btn--ghost')
      : null);

    const TOOLS = {
      appearance: () => resetTool('appearance'),
      wallpaper: () => h('span.badge', { text: WP.active(store).name }),
      themes: () => h('span.badge.badge--accent', { text: THEMES.themeById(pref('accent')).name }),
      spooky: () => resetTool('spooky'),
      winter: () => resetTool('winter'),
      celebrations: () => resetTool('celebrations'),
      halloween: () => h('span.badge' + (HW.inSeason() ? '.badge--accent' : ''), { text: HW.inSeason() ? tr('In season') : tr('Off season') }),
      dock: () => h('span.badge', { text:
        tr('{n} in dock', { n: (store.get('dock') || []).filter(id => id !== 'launcher' && api.getApp(id) && !api.getApp(id).hidden).length }) }),
      desktop: () => resetTool('desktop'),
      windows: () => h('span.badge', { text: tr('{v} open', { v: M.windows().count }) }),
      notifications: () => h('span.badge' + (pref('dnd') ? '.badge--warn' : '.badge--ok'),
        { text: pref('dnd') ? tr('Silenced') : tr('Delivering') }),
      keyboard: () => h('span.badge', { text: fmt.isMac ? tr('⌘ Command') : tr('Ctrl') }),
      shortcuts: () => h('span.badge', { text: tr('{v} bindings', { v: SC.count(api) }) }),
      accessibility: () => resetTool('accessibility'),
      proxy: () => {
        const st = UV.status();
        const [label, tone] = PHASE[st.phase] || [tr('Unknown'), ''];
        return h('span.badge' + (tone ? `.badge--${tone}` : ''), { text: label });
      },
      network: () => h('span.badge' + (navigator.onLine ? '.badge--ok' : '.badge--bad'),
        { text: navigator.onLine ? tr('Online') : tr('Offline') }),
      privacy: () => h('span.badge', { text: tr('{v} keys', { v: lsKeys().length }) }),
      ai: () => h('span.badge', { text: AIM.describe().provider === 'openrouter' ? 'OpenRouter' : tr('Free') }),
      sound: () => h('span.badge' + (pref('muted') ? '.badge--warn' : ''),
        { text: pref('muted') ? tr('Muted') : `${Math.round(pref('volume', 62))}%` }),
      display: () => h('span.badge', { text: tr('{n}% bright', { n: Math.round(pref('brightness', 100)) }) }),
      performance: () => h('span.badge' + (lowGfxOn() ? '.badge--accent' : ''),
        { text: lowGfxOn() ? tr('Low graphics') : tr('Full graphics') }),
      storage: () => resetTool('storage'),
      applications: () => h('span.badge', { text: tr('{v} apps', { v: api.listApps().length }) }),
      about: () => (window.Static?.updater?.pending
        ? h('span.badge.badge--warn', { text: tr('Update ready') })
        : h('span.badge.badge--ok', { text: buildInfo()?.build || tr('unstamped') })),
    };

    /* ---------------- boot ----------------- */
    paintSide();
    paintMain();

    /* ---------------- wiring --------------- */
    const repaintIf = (...secs) => () => { if (secs.includes(S.sec)) paintMain(); };
    const offAccent = store.sub('prefs.accent', () => { paintBar(); repaintIf('themes', 'appearance')(); });
    const offTheme = store.sub('prefs.theme', repaintIf('appearance', 'themes'));
    const offDensity = store.sub('prefs.density', repaintIf('appearance'));
    const offDock = store.sub('dock', () => { paintBar(); repaintIf('dock', 'applications')(); });
    const offWall = store.sub('wallpaper', () => { paintBar(); repaintIf('wallpaper', 'themes')(); });
    /* a pack is three settings at once — the Themes pane shows which pack is on */
    const offPack = [api.bus.on('pack:change', repaintIf('themes')), store.sub('prefs.iconStyle', repaintIf('themes'))];
    const offRecent = store.sub(RECENT_KEY, () => { if (!S.filter) paintSide(); });
    const offHw = store.sub('portal.halloween', repaintIf('halloween'));
    const offGhosts = [store.sub('portal.ghosts', repaintIf('halloween')), store.sub('prefs.spookyTheme', repaintIf('halloween'))];
    const offTick = api.bus.on('tick:1s', () => S.live?.());
    const offProxy = UV.onChange(() => { if (S.sec === 'proxy') paintMain(); });
    /* the season starting, ending or being switched: the pane list, the
       Spooky pane itself and the notes on the accent and wallpaper panes */
    const offSeason = api.bus.on('season:change', () => {
      if (!S.filter) paintSide();
      repaintIf('celebrations')();
      if ((S.sec === 'spooky' || S.sec === 'winter') && !shown(secById(S.sec))) { go('appearance', false); return; }
      repaintIf('spooky', 'winter', 'appearance', 'themes', 'wallpaper')();
    });
    /* not the volume: repainting would take the slider out from under the pointer */
    const offSpooky = [store.sub('prefs.spookyCountdown', repaintIf('spooky')), store.sub('prefs.spookyEffects', repaintIf('spooky')), store.sub('prefs.spookyWallpaper', repaintIf('spooky')),
      /* not the cursor or the sound: their tabs follow the click themselves, and a repaint would drop keyboard focus */
      ...['winterTheme', 'winterCountdown', 'winterSnow', 'winterWallpaper', 'winterAdvent'].map(k => store.sub(`prefs.${k}`, repaintIf('winter'))),
      store.sub('portal.winter', () => { if (!S.filter) paintSide(); repaintIf('winter')(); })];
    /* the "Changed · Reset" links follow every setting, wherever it was changed from */
    let resetQ = 0;
    const offResets = store.sub('prefs', () => { if (!resetQ) resetQ = requestAnimationFrame(() => { resetQ = 0; if (!S.dead) { refreshResets(); if (!S.filter) paintSide(); if (S.sec === 'changed') paintMain(); } }); });
    const onNet = () => { if (S.sec === 'network') S.live?.(); paintBar(); };
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);

    win.onReopen(o => { if (o?.section) go(o.section); });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); searchInput.focus(); return; }
      if (e.key === '/' && !typing) { e.preventDefault(); searchInput.focus(); }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      S.dead = true;
      cancelAnimationFrame(resetQ); offResets(); strip.destroy();
      offAccent(); offTheme(); offDensity(); offDock(); offWall(); offRecent(); offTick(); offProxy(); offHw();
      offSeason(); offSpooky.forEach(f => f()); offPack.forEach(f => f()); offGhosts.forEach(f => f());
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      window.removeEventListener('keydown', onKey);
      testerOff?.();
      /* Monitor owns the frame counter too — only stop it if nothing else wants it. */
      M.stop('settings');   /* the sampler is reference-counted now, so no need to guess whether Monitor still wants it */
    };
  },
});
