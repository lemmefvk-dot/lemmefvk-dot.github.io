/* ============================================================
   wpweather.js — the real weather, for the wallpaper.

   Settings › Wallpaper › Weather on the wallpaper (prefs.wpWeather,
   off by default) lays rain, snow, cloud, fog or sun glare over the
   wallpaper to match the weather where you are. "Where you are" is
   only ever the place Weather already has (prefs.wxPlace): a city
   you searched for, or "Use my location" after the browser asked
   you. With no place there is nothing to show and Settings says so;
   this module never asks for a location itself.

   The reading comes from Open-Meteo, through the same fetch the
   Weather app uses (core/openmeteo.js), at most once every 30
   minutes — the last answer, or the last failure, is kept in
   portal.wpWeather with its time, so a reload doesn't ask again.
   A new place in Weather is asked about at once.

   Honest when it can't know: a failed request with no reading from
   the last hour for this place shows no effect at all, and the
   reason, in words ("Weather unavailable — Couldn't reach
   Open-Meteo"). Nothing is guessed or made up.

     status() -> { on, place, effect, amount, label, at, err, next, stale }
     effectOf(code, isDay) -> { effect, amount }
   The overlay itself is js/shell/wallplus.js.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { FC_URL, getJSON, describe, cond, keyOf, validPlace } from './openmeteo.js';

export const KEY = 'portal.wpWeather';
export const EVERY = 30 * 60 * 1000;      /* never asks more often than this */
const LIVE = 60 * 60 * 1000;              /* past this, a reading is not "now" any more */

export const on = () => store.get('prefs.wpWeather') === true;
export const place = () => { const p = store.get('prefs.wxPlace', null); return validPlace(p) ? p : null; };

/** What to draw for a WMO code: effect 'rain'|'snow'|'sleet'|'clouds'|'sun'|'fog'|'storm'|'none', amount 0–1. */
export function effectOf(code, isDay) {
  const c = cond(code, isDay);
  const n = Number(code);
  switch (c.fam) {
    case 'clear': return { effect: c.day ? 'sun' : 'none', amount: 1 };
    case 'mostly': return { effect: c.day ? 'sun' : 'clouds', amount: c.day ? 0.75 : 0.3 };
    case 'partly': return { effect: 'clouds', amount: 0.5 };
    case 'cloudy': return { effect: 'clouds', amount: 1 };
    case 'fog': return { effect: 'fog', amount: n === 48 ? 1 : 0.8 };
    case 'drizzle': return { effect: 'rain', amount: n === 55 ? 0.5 : 0.3 };
    case 'rain': return { effect: 'rain', amount: [61, 80].includes(n) ? 0.55 : [63, 81].includes(n) ? 0.8 : 1 };
    case 'sleet': return { effect: 'sleet', amount: [57, 67].includes(n) ? 0.9 : 0.6 };
    case 'snow': return { effect: 'snow', amount: [71, 77].includes(n) ? 0.5 : [73, 85].includes(n) ? 0.75 : 1 };
    case 'storm': return { effect: 'storm', amount: 1 };
    default: return { effect: 'none', amount: 0 };
  }
}

export const EFFECT_NAME = {
  rain: 'Rain', snow: 'Snow', sleet: 'Sleet', clouds: 'Clouds', sun: 'Sun glare', fog: 'Fog', storm: 'Storm', none: 'Nothing to add',
};

const read = () => { const s = store.get(KEY, null); return s && typeof s === 'object' ? s : null; };

/** Everything the overlay and Settings need to know, right now. */
export function status(now = Date.now()) {
  const p = place();
  const s = read();
  const mine = !!(p && s && s.key === keyOf(p));
  const reading = mine && s.reading && now - s.reading.at < LIVE ? s.reading : null;
  const err = mine && s.err && (!s.reading || s.err.at > s.reading.at) ? s.err : null;
  const fx = reading ? effectOf(reading.code, reading.isDay) : { effect: 'none', amount: 0 };
  return {
    on: on(), place: p,
    reading,
    effect: on() && reading ? fx.effect : 'none',
    amount: fx.amount,
    label: reading ? cond(reading.code, reading.isDay).label : null,
    err,
    unavailable: on() && !!p && !reading && (!!err || (mine && !!s.reading)),
    asked: mine ? s.at : 0,
    next: mine ? new Date(s.at + EVERY) : null,
  };
}

let busy = null;
/** Ask Open-Meteo, unless it was asked about this place in the last 30 minutes. */
export function refresh() {
  if (busy || !on()) return busy;
  const p = place();
  if (!p) return null;
  const s = read();
  if (s && s.key === keyOf(p) && Date.now() - s.at < EVERY) return null;
  const key = keyOf(p);
  busy = (async () => {
    const at = Date.now();
    const prev = s && s.key === key ? s : null;
    try {
      const j = await getJSON(`${FC_URL}?latitude=${(+p.lat).toFixed(4)}&longitude=${(+p.lon).toFixed(4)}`
        + '&current=weather_code,is_day,cloud_cover,precipitation&timezone=auto&forecast_days=1');
      const cur = j && j.current;
      if (!cur || !Number.isFinite(cur.weather_code)) throw Object.assign(new Error('no current reading'), { kind: 'parse' });
      store.set(KEY, { key, name: p.name, at, reading: { at, code: cur.weather_code, isDay: cur.is_day === 0 ? 0 : 1, cloud: cur.cloud_cover, precip: cur.precipitation }, err: null });
    } catch (e) {
      const d = describe(e);
      store.set(KEY, { key, name: p.name, at, reading: prev?.reading || null, err: { at, title: d.title, short: d.short } });
    } finally {
      busy = null;
      bus.emit('wpweather:change');
    }
  })();
  return busy;
}

let inited = false;
export function init() {
  if (inited) return;
  inited = true;
  refresh();
  /* the switch, or a new place in Weather */
  const sig = () => `${on()}|${place() ? keyOf(place()) : ''}`;
  let last = sig();
  store.sub('prefs', () => {
    if (sig() === last) return;
    last = sig();
    refresh();
    bus.emit('wpweather:change');
  });
  /* the half-hour comes round; a reading also goes stale after an hour */
  bus.on('tick:5s', () => { if (on() && !(typeof document !== 'undefined' && document.hidden)) refresh(); });
}

export default { KEY, EVERY, EFFECT_NAME, on, place, effectOf, status, refresh, init };
