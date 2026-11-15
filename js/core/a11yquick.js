/* ============================================================
   a11yquick.js — the one-click parts of Settings › Accessibility,
   shared by the settings pane and the accessibility button in the
   status bar (js/shell/topbar.js):

     · Reduce clutter — the pet, the widget rail, seasonal effects
       (leaves, snow, fireworks, hearts, blossoms, confetti), the
       music visualiser, weather on the wallpaper and developer
       events go off and Reduce motion comes on, all at once. What it
       changed is remembered (prefs.clutterBackup), so "Bring it back"
       puts exactly those things back and leaves everything else
       alone — including anything you changed after.
     · the text size steps and the colour filter list, so the menu and
       the pane agree.

   Everything is an ordinary preference, so each change is the same
   change Settings would make by hand.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as SEASON from './season.js';

/* what Reduce clutter sets, and what each one is when nobody has chosen */
export const CLUTTER = {
  reduceMotion: [true, false],
  desktopPet: [false, true],
  widgetsVisible: [false, true],
  wallpaperVisualizer: [false, false],
  wpWeather: [false, false],
  devEvents: [false, true],
  jumpScares: [false, false],
  spookyEffects: [false, SEASON.DEFAULTS.spookyEffects],
  winterSnow: [false, SEASON.DEFAULTS.winterSnow],
  newyearFireworks: [false, SEASON.DEFAULTS.newyearFireworks],
  birthdayConfetti: [false, SEASON.DEFAULTS.birthdayConfetti],
  valentineHearts: [false, SEASON.DEFAULTS.valentineHearts],
  springBlossoms: [false, SEASON.DEFAULTS.springBlossoms],
};
const BACKUP = 'prefs.clutterBackup';
const now = k => { const v = store.get('prefs.' + k); return v === undefined ? CLUTTER[k][1] : v; };

/** Is everything Reduce clutter touches already as it leaves it? */
export const isDecluttered = () => Object.keys(CLUTTER).every(k => now(k) === CLUTTER[k][0]);

/** Turn the clutter off. Returns the names of what it changed. */
export function reduceClutter() {
  const before = {};
  for (const k of Object.keys(CLUTTER)) if (now(k) !== CLUTTER[k][0]) before[k] = now(k);
  /* a second press before bringing it back keeps the first backup */
  const prev = store.get(BACKUP);
  store.set(BACKUP, { ...before, ...(prev && typeof prev === 'object' ? prev : {}) });
  for (const k of Object.keys(before)) store.set('prefs.' + k, CLUTTER[k][0]);
  bus.emit('a11y:say', 'Reduce clutter is on: the pet, widgets, seasonal effects and animation are off');
  return Object.keys(before);
}

/** Is there something to bring back? */
export const canRestore = () => {
  const b = store.get(BACKUP);
  return !!b && typeof b === 'object' && Object.keys(b).length > 0;
};

/** Put back what Reduce clutter changed. Returns the names it restored. */
export function restoreClutter() {
  const b = store.get(BACKUP);
  const keys = b && typeof b === 'object' ? Object.keys(b).filter(k => CLUTTER[k]) : [];
  for (const k of keys) store.set('prefs.' + k, b[k]);
  store.set(BACKUP, null);
  bus.emit('a11y:say', 'The pet, widgets and effects are back');
  return keys;
}

export const TEXT_SIZES = [['small', 'Small'], ['normal', 'Default'], ['large', 'Large'], ['larger', 'Largest']];
export const COLOUR_FILTERS = [
  ['none', 'Off'], ['grayscale', 'Grayscale'], ['protan', 'Red-weak'], ['deutan', 'Green-weak'], ['tritan', 'Blue-weak'],
];

export default { CLUTTER, isDecluttered, reduceClutter, canRestore, restoreClutter, TEXT_SIZES, COLOUR_FILTERS };
