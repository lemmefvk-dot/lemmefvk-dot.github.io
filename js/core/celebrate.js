/* ============================================================
   celebrate.js — the bookkeeping behind New Year's and birthdays.

   js/core/season.js decides WHEN (the windows, the switches);
   js/shell/celebrate.js draws. This module keeps the two things
   that must be exact and must survive a reload:

   · what has already been played this year. A show or a card is
     claimed the moment it starts, under portal.celebrate, as the
     year it belongs to — so a reload, a second tab's worth of
     clock ticks or a clock set back can never play it twice;
   · where "now" is on New Year's Eve, from the device clock only.

   Nothing here leaves the device: the birthday is prefs.birthday
   ('MM-DD', no year) and the claims are plain years in local
   storage. Neither goes into presence, a friend's view, a
   broadcast or any request.
   ============================================================ */
import { store } from './store.js';
import * as SEASON from './season.js';

const KEY = 'portal.celebrate';

/* the last ten minutes before midnight are counted down on the desktop */
export const COUNTDOWN_S = 600;
/* the fireworks start if the page is up at midnight or opened within this
   long after it; later than that the moment has passed and nothing plays */
export const SHOW_WINDOW_MS = 45_000;
/* how long the fireworks run, in seconds of drawing */
export const FIREWORKS_S = 22;
export const CONFETTI_S = 9;

/** The midnight that starts January 1 nearest to `d` — the one the countdown
    is for: next year's from December 31, this year's on January 1. */
export const midnight = (d = new Date()) => new Date(d.getFullYear() + (d.getMonth() === 11 ? 1 : 0), 0, 1, 0, 0, 0, 0);

/**
 * Where `d` is on New Year's Eve, from the clock alone:
 *   { phase: 'out' }                                  not in the window
 *   { phase: 'eve' }                                  before the last ten minutes
 *   { phase: 'count', secs }                          secs seconds (rounded up) left, 1–600
 *   { phase: 'show', since }                          midnight was `since` ms ago (< SHOW_WINDOW_MS)
 *   { phase: 'after' }                                January 1, the moment has passed
 */
export function nye(d = new Date()) {
  if (!SEASON.isNewYearSeason(d)) return { phase: 'out' };
  const m = midnight(d);
  const ms = m - d;
  if (d.getMonth() === 0) return d - m < SHOW_WINDOW_MS ? { phase: 'show', since: d - m, year: d.getFullYear() } : { phase: 'after', year: d.getFullYear() };
  const secs = Math.ceil(ms / 1000);
  return secs <= COUNTDOWN_S ? { phase: 'count', secs, year: m.getFullYear() } : { phase: 'eve', year: m.getFullYear() };
}

/* ---------- once a year ---------------------------------------------- */
const read = () => { const v = store.get(KEY, null); return v && typeof v === 'object' ? v : {}; };

/** Has `what` ('newyear' | 'confetti' | 'card') already played for `year`? */
export const claimed = (what, year) => read()[what] === year;

/** Claim `what` for `year`. true the first time only. A later year can claim
    again; an earlier year (a clock set back) never can. */
export function claim(what, year) {
  const v = read();
  if (typeof v[what] === 'number' && v[what] >= year) return false;
  store.set(KEY, { ...v, [what]: year });
  return true;
}

export default { COUNTDOWN_S, SHOW_WINDOW_MS, FIREWORKS_S, CONFETTI_S, midnight, nye, claimed, claim };
