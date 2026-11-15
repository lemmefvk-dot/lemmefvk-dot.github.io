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
   And the rest of the year (js/shell/seasons-more.js draws them, Settings ›
   Celebrations switches them):
     autumnTheme      true   autumn, November 2–30 (warm accent)
     autumnLeaves     true   leaves falling over the wallpaper
     autumnGratitude  true   the gratitude list (and its card on Thanksgiving)
     lunarTheme       true   Lunar New Year: its eve to the Lantern Festival
     lunarLanterns    true   lanterns rising, fireworks once on the day
     stpatrickTheme   true   St Patrick's Day, March 10–17 (green accent)
     cloverHunt       true   clovers hidden on the desktop, one with four leaves
     pidayTheme       true   Pi Day, March 14
     piChallenge      true   the digit challenge and the little puzzles
     earthTheme       true   Earth Day, April 20–22
     earthSeeds       true   seeds and leaves drifting up
     summerTheme      true   summer, June 1 – August 14 (sea-glass accent)
     summerSparkle    true   sun glints and bubbles drifting up
     summerCountdown  true   the countdown to the holidays, once you set the day
     schoolTheme      true   back to school, August 15 – September 14
     schoolKit        true   the planner kit (a checklist and the study apps)
     firstsnowTheme   false  first snow where you live: opt in, and the place
                             and the weather check are yours to allow
     firstsnowFlakes  true   flakes over the wallpaper for the day it snows
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
  autumnTheme: true,
  autumnLeaves: true,
  autumnGratitude: true,
  lunarTheme: true,
  lunarLanterns: true,
  stpatrickTheme: true,
  cloverHunt: true,
  pidayTheme: true,
  piChallenge: true,
  earthTheme: true,
  earthSeeds: true,
  summerTheme: true,
  summerSparkle: true,
  summerCountdown: true,
  schoolTheme: true,
  schoolKit: true,
  firstsnowTheme: false,
  firstsnowFlakes: true,
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

/** Autumn: November 2 – 30, inclusive (Halloween ends on the 1st, winter starts on December 1). */
export const isAutumnSeason = (d = new Date()) => d.getMonth() === 10 && d.getDate() >= 2;

/** St Patrick's Day: March 10 – 17, inclusive. */
export const isStPatrickSeason = (d = new Date()) => d.getMonth() === 2 && d.getDate() >= 10 && d.getDate() <= 17;

/** Pi Day: March 14. */
export const isPiDay = (d = new Date()) => d.getMonth() === 2 && d.getDate() === 14;

/** Earth Day: April 20 – 22. */
export const isEarthSeason = (d = new Date()) => d.getMonth() === 3 && d.getDate() >= 20 && d.getDate() <= 22;

/** Summer: June 1 – August 14. */
export const isSummerSeason = (d = new Date()) => d.getMonth() === 5 || d.getMonth() === 6 || (d.getMonth() === 7 && d.getDate() <= 14);

/** Back to school: August 15 – September 14. */
export const isSchoolSeason = (d = new Date()) => (d.getMonth() === 7 && d.getDate() >= 15) || (d.getMonth() === 8 && d.getDate() <= 14);

/* Lunar New Year moves: the first day of the first month of the Chinese
   calendar. 2025–2040 are written down (the official dates). For later years
   the browser's own Chinese calendar (Intl) is asked; it works the new moon
   out itself and can be a day out in a year when the moon is within minutes
   of midnight, which is why the table comes first. */
const LNY_TABLE = { 2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3], 2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8], 2036: [1, 28], 2037: [2, 15], 2038: [2, 4], 2039: [1, 24], 2040: [2, 12] };
const lnyCache = new Map();
/** The date of Lunar New Year's Day in `year`: [month 1–12, day], or null. */
export function lunarNewYear(year) {
  if (lnyCache.has(year)) return lnyCache.get(year);
  let out = LNY_TABLE[year] || null;
  if (!out) try {
    const f = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
    const end = Date.UTC(year, 2, 1);
    for (let t = Date.UTC(year, 0, 19, 4); t < end; t += 86400000) {
      const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
      if (p.month === '1' && p.day === '1') { const u = new Date(t); out = [u.getUTCMonth() + 1, u.getUTCDate()]; break; }
    }
  } catch (e) { out = null; }
  lnyCache.set(year, out);
  return out;
}
/** Lunar New Year's Eve through the Lantern Festival (the 15th day), inclusive. */
export function isLunarSeason(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const m = lunarNewYear(d.getFullYear());
  if (!m) return false;
  const n = Math.round((t - new Date(d.getFullYear(), m[0] - 1, m[1])) / 86400000);
  return n >= -1 && n <= 14;
}
/** Lunar New Year's Day itself (the fireworks' day)? */
export function isLunarDay(d = new Date()) {
  const m = lunarNewYear(d.getFullYear());
  return !!m && d.getMonth() + 1 === m[0] && d.getDate() === m[1];
}
/** The fourth Thursday of November (US Thanksgiving): the day of the month. */
export const thanksgivingDay = year => 1 + ((4 - new Date(year, 10, 1).getDay() + 7) % 7) + 21;
export const isThanksgiving = (d = new Date()) => d.getMonth() === 10 && d.getDate() === thanksgivingDay(d.getFullYear());

/** First snow where you live: the 24 hours after snow was found
    (js/core/firstsnow.js keeps the moment in portal.firstSnow). Never by date. */
export function isFirstSnow(d = new Date()) {
  const v = store.get('portal.firstSnow', null);
  const at = Number(v && v.at);
  const ago = d.getTime() - at;
  return Number.isFinite(at) && at > 0 && ago >= 0 && ago < 24 * 3600 * 1000;
}

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
/* the ones that run on a date, in the order Settings lists them */
Object.assign(SEASONS, {
  autumn: {
    id: 'autumn', name: 'Autumn', test: isAutumnSeason, master: 'autumnTheme',
    parts: { effects: 'autumnLeaves', gratitude: 'autumnGratitude' },
  },
  lunar: {
    id: 'lunar', name: 'Lunar New Year', test: isLunarSeason, master: 'lunarTheme',
    parts: { effects: 'lunarLanterns' },
  },
  stpatrick: {
    id: 'stpatrick', name: 'St Patrick’s Day', test: isStPatrickSeason, master: 'stpatrickTheme',
    parts: { hunt: 'cloverHunt' },
  },
  piday: {
    id: 'piday', name: 'Pi Day', test: isPiDay, master: 'pidayTheme',
    parts: { challenge: 'piChallenge' },
  },
  earth: {
    id: 'earth', name: 'Earth Day', test: isEarthSeason, master: 'earthTheme',
    parts: { effects: 'earthSeeds' },
  },
  summer: {
    id: 'summer', name: 'Summer', test: isSummerSeason, master: 'summerTheme',
    parts: { effects: 'summerSparkle', countdown: 'summerCountdown' },
  },
  school: {
    id: 'school', name: 'Back to school', test: isSchoolSeason, master: 'schoolTheme',
    parts: { kit: 'schoolKit' },
  },
  firstsnow: {
    id: 'firstsnow', name: 'First snow', test: isFirstSnow, master: 'firstsnowTheme',
    parts: { effects: 'firstsnowFlakes' },
  },
});
/* the seasons with a look of their own: the ones Settings can put on for a minute
   (New Year's is a moment at midnight and a birthday is yours, so neither is) */
export const PREVIEWABLE = ['spooky', 'winter', 'valentine', 'spring', 'autumn', 'lunar', 'stpatrick', 'piday', 'earth', 'summer', 'school', 'firstsnow'];
export const SEASON_IDS = Object.keys(SEASONS);

/* ---------- when the next season starts -----------------------------
   Worked out from the same date tests the seasons themselves use, a day at
   a time (about a year ahead), so it can never disagree with them. New
   Year's, which turns on at 6 pm, your birthday and first snow (the day it
   snows) have no start date to announce, so they are left out.

   schedule(from?) -> { now: [{ id, name, endsOn: Date }],
                        next: [{ id, name, start: Date, days: number, until: Date }] }
   `days` is how many days from `from` the season starts; `until` is its last day. */
const NOT_ANNOUNCED = ['newyear', 'birthday', 'firstsnow'];
export function schedule(from = new Date()) {
  const at = i => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, 12);
  const now = [], next = [];
  for (const id of SEASON_IDS) {
    if (NOT_ANNOUNCED.includes(id)) continue;
    const S = SEASONS[id];
    let i = 0;
    if (S.test(at(0))) {
      while (i < 400 && S.test(at(i))) i++;
      now.push({ id, name: S.name, endsOn: at(i - 1) });
    }
    for (; i < 400; i++) {
      if (!S.test(at(i))) continue;
      let j = i;
      while (j < i + 60 && S.test(at(j + 1))) j++;
      next.push({ id, name: S.name, start: at(i), days: i, until: at(j) });
      break;
    }
  }
  next.sort((a, b) => a.days - b.days);
  return { now, next };
}

/* ---------- trying a season for a minute -----------------------------
   Settings › Celebrations puts any season in PREVIEWABLE on for one minute,
   whatever the date. It lives only in memory (a reload ends it), is the
   season's own look and nothing more — it claims no show, saves nothing —
   and it ends by itself. */
export const PREVIEW_MS = 60_000;
let tryOut = null;
let tryTimer = 0;
/** The season on trial, { id, until }, or null. */
export const trying = () => (tryOut && Date.now() < tryOut.until ? tryOut : null);
export function tryFor(id, ms = PREVIEW_MS) {
  if (!PREVIEWABLE.includes(id)) return false;
  clearTimeout(tryTimer);
  tryOut = { id, until: Date.now() + ms };
  tryTimer = setTimeout(stopTrying, ms + 20);
  applyRoot();
  bus.emit('season:try', tryOut);
  return true;
}
export function stopTrying() {
  clearTimeout(tryTimer);
  const had = !!tryOut;
  tryOut = null;
  if (had) { applyRoot(); bus.emit('season:try', null); }
}

/** Is the season's stretch of the calendar running? (or on trial) */
export const inSeason = (id, d = new Date()) => trying()?.id === id || !!SEASONS[id]?.test(d);

/** The season is running and the person has not switched it off. A season on
    trial is on whatever its switch says (they asked to see it). */
export const seasonOn = (id, d = new Date()) => trying()?.id === id || (!!SEASONS[id]?.test(d) && pref(SEASONS[id].master) !== false);

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

/** Time left until the holidays begin, for the day set in Settings › Celebrations
    (prefs.summerBreak, 'YYYY-MM-DD'): midnight at the start of it, local time.
    null until a day is set: no day is ever assumed. */
export function holidays(d = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(store.get('prefs.summerBreak', '') || ''));
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  if (t.getFullYear() !== +m[1] || t.getMonth() !== +m[2] - 1 || t.getDate() !== +m[3]) return null;
  return until(t, d);
}

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
  tryFor, stopTrying, trying, PREVIEW_MS, PREVIEWABLE, holidays, lunarNewYear, isLunarSeason, isLunarDay, thanksgivingDay, isThanksgiving, isAutumnSeason, isStPatrickSeason, isPiDay, isEarthSeason, isSummerSeason, isSchoolSeason, isFirstSnow,
  DEFAULTS, SEASONS, isSpookySeason, isWinterSeason, isNewYearSeason, isValentineSeason, isSpringSeason, isBirthday, birthdayIn, parseBirthday, inHalloween, inSeason, seasonOn, part, current,
  spookyOn, spooky, winterOn, winter, spookyLevel, until, halloween, christmas, applyRoot,
};
