/* ============================================================
   season.js — when StaticOS dresses up, and in what.

   A small registry of seasons, each on this computer's own
   calendar:

     spooky   October 24 – the end of November 1
     winter   December 1 – the end of January 1

   While one runs (and nobody has turned it off) <html> carries
   data-<season>="on" — data-spooky, data-winter — and its
   stylesheet (css/feat-spooky.css, css/feat-winter.css) paints
   the accent, the wallpaper and the rest from that one
   attribute. Everything else a season adds — the countdown
   widget, the leaves or the snow, the sound pack, the advent
   calendar — asks part(season, feature) (or the spooky() /
   winter() shorthands) before it does anything, so turning a
   season off puts StaticOS back exactly as it was.

   No DOM work here beyond the attributes: this module is safe to
   import from main.js before anything has mounted, which is what
   lets the very first painted frame be the right one.

   Preferences (all under prefs.*):
     spookyTheme      true   spooky season as a whole — its master switch
     spookyCountdown  true   the Halloween countdown on the desktop
     spookyEffects    true   falling leaves and bats over the wallpaper
     spookyWallpaper  true   the haunted house in place of the wallpaper;
                             picking a wallpaper in season turns it off
     spookySounds     false  creak / boo / cackle — opt-in
     spookyVolume     70     the pack's own level, 0–100, under the
                             system volume and Mute
     ghostHunt        true   13 little ghosts to find around StaticOS
                             (js/core/ghosts.js); its switch lives in
                             Settings › Halloween fun
     winterTheme      true   winter as a whole — its master switch
     winterCountdown  true   the Christmas countdown on the desktop
     winterSnow       true   snow falling over the wallpaper
     winterWallpaper  true   the snowy village in place of the wallpaper;
                             picking a wallpaper in season turns it off
     winterAdvent     true   the advent calendar in the dock (js/core/winter.js)
     newyearTheme     true   New Year's as a whole (Dec 31 from 6 pm – the end of Jan 1)
     newyearCountdown true   the last ten minutes, counted down on the desktop
     newyearFireworks true   fireworks at midnight, once
     birthdayTheme    true   your birthday as a whole (needs prefs.birthday, 'MM-DD')
     birthdayConfetti true   confetti, once, on the day
     birthdayCard     true   the card, once a year
     valentineTheme   true   Valentine's, February 1–14 (rose accent)
     valentineHearts  true   hearts drifting over the wallpaper
     springTheme      true   spring, March 1 – April 30 (leaf-and-blossom accent)
     springBlossoms   true   cherry blossoms drifting over the wallpaper
   The four newer ones live in js/shell/celebrate.js, which keeps one
   canvas for all of them (see there for who wins when they overlap).
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const DEFAULTS = {
  spookyTheme: true,
  spookyCountdown: true,
  spookyEffects: true,
  spookyWallpaper: true,
  spookySounds: false,
  spookyVolume: 70,
  ghostHunt: true,
  winterTheme: true,
  winterCountdown: true,
  winterSnow: true,
  winterWallpaper: true,
  winterAdvent: true,
  newyearTheme: true,
  newyearCountdown: true,
  newyearFireworks: true,
  birthdayTheme: true,
  birthdayConfetti: true,
  birthdayCard: true,
  valentineTheme: true,
  valentineHearts: true,
  springTheme: true,
  springBlossoms: true,
};

const pref = k => store.get('prefs.' + k, DEFAULTS[k]);

/** October 24 – November 1, inclusive, by the local date. */
export function isSpookySeason(d = new Date()) {
  const m = d.getMonth(), day = d.getDate();
  return (m === 9 && day >= 24) || (m === 10 && day === 1);
}

/** December 1 – January 1, inclusive, by the local date. */
export function isWinterSeason(d = new Date()) {
  return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() === 1);
}

/** New Year's: from 6 pm on December 31 through the end of January 1, by the
    local clock. (Winter also covers these days; the two layer, they don't clash.) */
export function isNewYearSeason(d = new Date()) {
  return (d.getMonth() === 11 && d.getDate() === 31 && d.getHours() >= 18) || (d.getMonth() === 0 && d.getDate() === 1);
}

/** Valentine's: February 1 – 14, inclusive. */
export const isValentineSeason = (d = new Date()) => d.getMonth() === 1 && d.getDate() <= 14;

/** Spring: March 1 – April 30, inclusive. */
export const isSpringSeason = (d = new Date()) => d.getMonth() === 2 || d.getMonth() === 3;

/** The saved birthday as [month 1–12, day], or null. Month and day only, no
    year, kept in prefs.birthday as 'MM-DD' and never sent anywhere. */
export function parseBirthday(v) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const mo = +m[1], da = +m[2];
  if (mo < 1 || mo > 12 || da < 1 || da > new Date(2024, mo, 0).getDate()) return null;   /* 2024 is a leap year: Feb 29 is allowed */
  return [mo, da];
}
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** The day the birthday is kept in `year`: February 29 falls on February 28
    in a year that has no 29th, so it is still kept in February. */
export function birthdayIn(year, v = store.get('prefs.birthday', '')) {
  const b = parseBirthday(v);
  if (!b) return null;
  return b[0] === 2 && b[1] === 29 && !isLeap(year) ? [2, 28] : b;
}
/** Is d the birthday (the whole local day)? false when none is set. */
export function isBirthday(d = new Date()) {
  const b = birthdayIn(d.getFullYear());
  return !!b && d.getMonth() + 1 === b[0] && d.getDate() === b[1];
}

/** The same window under the name Static Play's Halloween shelf uses: the
    shelf follows the calendar, not the theme switch. */
export const inHalloween = isSpookySeason;

/* ---------- the registry --------------------------------------------
   name     what Settings calls it (its pane, its notes)
   master   the pref that switches the whole season off
   parts    feature → [pref, default]; a part is live while the season
            runs, its master is on and its own pref isn't off (or, for an
            opt-in part whose default is false, is on) */
export const SEASONS = {
  spooky: {
    id: 'spooky', name: 'Spooky Season', test: isSpookySeason, master: 'spookyTheme',
    parts: {
      countdown: 'spookyCountdown', effects: 'spookyEffects', wallpaper: 'spookyWallpaper',
      sounds: 'spookySounds', ghosts: 'ghostHunt',
    },
  },
  winter: {
    id: 'winter', name: 'Winter', test: isWinterSeason, master: 'winterTheme',
    parts: {
      countdown: 'winterCountdown', effects: 'winterSnow', wallpaper: 'winterWallpaper', advent: 'winterAdvent',
    },
  },
  newyear: {
    id: 'newyear', name: 'New Year’s', test: isNewYearSeason, master: 'newyearTheme',
    parts: { countdown: 'newyearCountdown', effects: 'newyearFireworks' },
  },
  birthday: {
    id: 'birthday', name: 'Birthday', test: isBirthday, master: 'birthdayTheme',
    parts: { effects: 'birthdayConfetti', card: 'birthdayCard' },
  },
  valentine: {
    id: 'valentine', name: 'Valentine’s', test: isValentineSeason, master: 'valentineTheme',
    parts: { effects: 'valentineHearts' },
  },
  spring: {
    id: 'spring', name: 'Spring', test: isSpringSeason, master: 'springTheme',
    parts: { effects: 'springBlossoms' },
  },
};
export const SEASON_IDS = Object.keys(SEASONS);

/** Is the season's stretch of the calendar running? */
export const inSeason = (id, d = new Date()) => !!SEASONS[id]?.test(d);

/** The season is running and the person has not switched it off. */
export const seasonOn = (id, d = new Date()) => inSeason(id, d) && pref(SEASONS[id].master) !== false;

/** Is one part of a season live right now? feature 'theme' is the season itself. */
export function part(id, feature = 'theme', d = new Date()) {
  if (!seasonOn(id, d)) return false;
  if (feature === 'theme') return true;
  const k = SEASONS[id].parts[feature];
  if (!k) return false;
  /* an opt-in part (default false) needs a real yes */
  return DEFAULTS[k] === false ? pref(k) === true : pref(k) !== false;
}

/** The season whose dates are running now (on or switched off), or null. */
export const current = (d = new Date()) => SEASONS[SEASON_IDS.find(id => SEASONS[id].test(d))] || null;

/* ---------- spooky, by its old names ---------------------------------
   feature: 'theme' | 'countdown' | 'effects' | 'wallpaper' | 'sounds' | 'ghosts'
   The haunted house covers the usual wallpaper until the person picks one
   during the season (a carved pumpkin, a treat, anything): their pick wins,
   and Settings › Spooky Season can bring the house back. */
export const spookyOn = (d = new Date()) => seasonOn('spooky', d);
export const spooky = (feature = 'theme', d = new Date()) => part('spooky', feature, d);

/* ---------- winter ----------------------------------------------------
   feature: 'theme' | 'countdown' | 'effects' (the snow) | 'wallpaper' | 'advent' */
export const winterOn = (d = new Date()) => seasonOn('winter', d);
export const winter = (feature = 'theme', d = new Date()) => part('winter', feature, d);

/** The spooky pack's own level, 0–1. */
export const spookyLevel = () => Math.max(0, Math.min(100, Number(pref('spookyVolume')) || 0)) / 100;

/** Time left until `target`. After that moment `passed` is true and the rest are zero. */
export function until(target, d = new Date()) {
  const ms = Math.max(0, target - d);
  const s = Math.floor(ms / 1000);
  return {
    passed: ms === 0,
    ms,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    target,
  };
}

/** Time left until Halloween begins: midnight at the start of October 31, local time. */
export const halloween = (d = new Date()) => until(new Date(d.getFullYear(), 9, 31, 0, 0, 0, 0), d);

/** Time left until Christmas Day begins: midnight at the start of December 25,
    local time. On January 1 that Christmas is the one just gone (passed). */
export const christmas = (d = new Date()) => until(new Date(d.getFullYear() - (d.getMonth() === 0 ? 1 : 0), 11, 25, 0, 0, 0, 0), d);

/* ---------- the attributes on <html> -------------------------------- */
let last = null;

/**
 * Put data-spooky / data-winter on (or off) <html>. Called by main.js on
 * every prefs change and by js/shell/spooky.js as the clock crosses into or
 * out of a season. Emits 'season:change' only when an answer flips, so the
 * desktop, the widgets and the effects repaint once, not every tick.
 * Returns whether spooky season is on (what it always returned).
 */
export function applyRoot(root = typeof document !== 'undefined' ? document.documentElement : null) {
  const on = {};
  for (const id of SEASON_IDS) {
    on[id] = seasonOn(id);
    /* written only when it changes: this runs every few seconds */
    if (root && (root.dataset[id] === 'on') !== on[id]) {
      if (on[id]) root.dataset[id] = 'on';
      else delete root.dataset[id];
    }
  }
  const key = SEASON_IDS.map(id => `${id}:${on[id]}`).join('|');
  if (key !== last) {
    const first = last === null;
    last = key;
    if (!first) bus.emit('season:change', on.spooky, on);
  }
  return on.spooky;
}

export default {
  DEFAULTS, SEASONS, isSpookySeason, isWinterSeason, isNewYearSeason, isValentineSeason, isSpringSeason, isBirthday, birthdayIn, parseBirthday, inHalloween, inSeason, seasonOn, part, current,
  spookyOn, spooky, winterOn, winter, spookyLevel, until, halloween, christmas, applyRoot,
};
