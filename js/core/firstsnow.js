/* ============================================================
   firstsnow.js — "first snow where you live", only with your say-so.

   Off until you turn it on (Settings › Celebrations › First snow).
   It needs a place, and there are two ways to give it one, both yours
   to allow:

     · the place Weather already has (prefs.wxPlace — a city you
       searched for, or your location if you allowed it there), used
       as it is; or
     · "Use my location": the browser asks, and only if you say yes
       is the answer kept, rounded to a tenth of a degree (about
       11 km — a town, not a street) as prefs.snowPlace.

   With a place and the switch on, StaticOS asks Open-Meteo (the same
   keyless service Weather uses) whether it is snowing there — at
   most every three hours, only while this tab is open and visible,
   only from autumn to spring of that place's hemisphere. The first
   time it is (or it snowed there yesterday), the day is marked
   (portal.firstSnow = { at, season, place }) and season.js dresses
   the desktop in falling snow for 24 hours. Once a winter, never
   twice. Nothing is sent but the rounded coordinates, to Open-Meteo,
   the way Weather does it; if StaticOS is closed while it snows, it
   is simply missed.

     place()          -> { lat, lon, name } | null
     askLocation()    -> the place, after the browser's own prompt
     status()         -> what Settings says in words
     check({ force }) -> asks Open-Meteo now (or when it is time)
     init()           arms the check on the 5-second tick
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as OM from './openmeteo.js';
import * as SEASON from './season.js';

export const KEY = 'portal.firstSnow';
export const EVERY_MS = 3 * 3600 * 1000;
/* WMO codes for snow: 71 73 75 snow fall, 77 snow grains, 85 86 snow showers */
export const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

const on = () => store.get('prefs.firstsnowTheme', false) === true;

export function place() {
  const own = store.get('prefs.snowPlace', null);
  if (OM.validPlace(own)) return own;
  const wx = store.get('prefs.wxPlace', null);
  return OM.validPlace(wx) ? wx : null;
}
export const placeSource = () => (OM.validPlace(store.get('prefs.snowPlace', null)) ? 'location' : OM.validPlace(store.get('prefs.wxPlace', null)) ? 'weather' : null);

/** Ask the browser where we are (it shows its own prompt). Rounded, kept as prefs.snowPlace. */
/* why the last ask came to nothing, kept for this session so a redrawn Settings page still says it */
let refused = '';
export function askLocation() {
  return new Promise((resolve, reject0) => {
    const reject = e => { refused = e.message; reject0(e); };
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('This browser can’t share a location.')); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const r = v => Math.round(v * 10) / 10;
      const p = { lat: r(pos.coords.latitude), lon: r(pos.coords.longitude), name: 'Your location' };
      store.set('prefs.snowPlace', p);
      refused = '';
      resolve(p);
    }, err => reject(new Error(err && err.code === 1 ? 'The browser’s location was not allowed, so nothing was kept.' : 'The browser couldn’t find a location.')), { maximumAge: 3600_000, timeout: 15000 });
  });
}
export function forgetLocation() { store.set('prefs.snowPlace', null); refused = ''; }

/** The snow year of a date at a latitude: July–June in the north, the calendar year in the south. */
export const winterOf = (d, lat) => (lat < 0 ? d.getFullYear() : d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
/** Is it the time of year it could snow? October–April north of the equator, April–October south. */
export function snowTime(d, lat) {
  const m = d.getMonth();
  return lat < 0 ? m >= 3 && m <= 9 : m >= 9 || m <= 3;
}

let last = 0;
let err = null;
let busy = null;
let reading = null;

export const state = () => { const v = store.get(KEY, null); return v && typeof v === 'object' ? v : null; };

/** Ask Open-Meteo whether it is snowing at the place. -> 'snow' | 'none' | 'skip' | 'error' */
export function check({ force = false, now = new Date() } = {}) {
  if (!force && (!on() || document.hidden)) return Promise.resolve('skip');
  const p = place();
  if (!p) return Promise.resolve('skip');
  if (!force && (Date.now() - last < EVERY_MS || !snowTime(now, +p.lat))) return Promise.resolve('skip');
  const winter = winterOf(now, +p.lat);
  if (state()?.season === winter) return Promise.resolve('skip');       /* this winter's first snow is already marked */
  if (busy) return busy;
  last = Date.now();
  const url = `${OM.FC_URL}?latitude=${(+p.lat).toFixed(2)}&longitude=${(+p.lon).toFixed(2)}&current=snowfall,weather_code&daily=snowfall_sum&past_days=1&forecast_days=1&timezone=auto`;
  busy = OM.getJSON(url).then(j => {
    err = null;
    const c = j && j.current;
    const code = Number(c && c.weather_code);
    const falling = (Number(c && c.snowfall) > 0) || SNOW_CODES.has(code);
    const ydays = j && j.daily && Array.isArray(j.daily.snowfall_sum) ? j.daily.snowfall_sum : [];
    const yesterday = Number(ydays[0]) > 0;
    reading = { at: Date.now(), falling, yesterday };
    if (!falling && !yesterday) return 'none';
    const at = Date.now();
    store.set(KEY, { at, season: winter, place: p.name });
    bus.emit('firstsnow:found', { at, place: p.name });
    SEASON.applyRoot();
    return 'snow';
  }, e => { err = OM.describe(e); return 'error'; }).finally(() => { busy = null; });
  return busy;
}

/** In words, for Settings. */
export function status() {
  const p = place();
  const st = state();
  const src = placeSource();
  return {
    on: on(), place: p, source: src, reading, err, found: st,
    say: !on() ? 'Off.'
      : !p ? refused || 'No place yet. Use Weather’s place, or let StaticOS use your location.'
      : err ? `Couldn’t check just now — ${err.short}`
      : SEASON.isFirstSnow() ? `It snowed near ${st.place}. The first snow of the winter is on your desktop for today.`
      : st && st.season === winterOf(new Date(), +p.lat) ? `The first snow of this winter was already marked near ${st.place}.`
      : !snowTime(new Date(), +p.lat) ? `Waiting for the snow season near ${p.name}.`
      : reading ? `Checked at ${new Date(reading.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}: no snow near ${p.name} yet. It looks again every few hours while StaticOS is open.`
      : `Watching for snow near ${p.name}.`,
  };
}

let armed = false;
export function init() {
  if (armed) return;
  armed = true;
  bus.on('tick:5s', () => { check(); });
  store.sub('prefs', () => { if (on()) check(); });
}

export default { KEY, EVERY_MS, SNOW_CODES, place, placeSource, askLocation, forgetLocation, winterOf, snowTime, state, check, status, init };
