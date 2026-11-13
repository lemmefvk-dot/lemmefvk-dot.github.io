/* ============================================================
   openmeteo.js — talking to Open-Meteo, shared.

   The Weather app (js/apps/weather.js) and the weather on the
   wallpaper (js/core/wpweather.js) ask the same keyless service
   the same way, so the parts they share live here rather than in
   either of them: a fetch with a deadline whose errors say what
   happened, those errors in words, the WMO weather codes, and
   what makes a saved place usable. Moved out of weather.js as is.

   Nothing here asks for a location or reads one: places come
   from prefs.wxPlace, which only Weather (a city you searched
   for, or "Use my location" after the browser asked you) writes.
   ============================================================ */

export const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const FC_URL = 'https://api.open-meteo.com/v1/forecast';

/** Two places closer than ~1 km are the same place. */
export const keyOf = p => `${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)}`;
export const validPlace = p => !!p && typeof p.name === 'string' && p.name.trim() !== ''
  && Number.isFinite(+p.lat) && Number.isFinite(+p.lon);

/** fetch JSON with a deadline, and errors that say what happened. */
export async function getJSON(url, signal, ms = 10000) {
  const ac = new AbortController();
  let late = false;
  const t = setTimeout(() => { late = true; ac.abort(); }, ms);
  const fwd = () => ac.abort();
  signal?.addEventListener('abort', fwd);
  try {
    const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    let j = null;
    try { j = await res.json(); } catch (e) {
      if (res.ok) throw Object.assign(new Error('unreadable reply'), { kind: 'parse' });
    }
    if (!res.ok || j?.error) {
      throw Object.assign(new Error(j?.reason || `HTTP ${res.status}`),
        { kind: 'http', status: res.status, reason: j?.reason || '' });
    }
    return j;
  } catch (e) {
    if (late) throw Object.assign(new Error('timed out'), { kind: 'timeout' });
    if (e.kind || e.name === 'AbortError') throw e;
    throw Object.assign(new Error(e.message || 'network'), { kind: navigator.onLine === false ? 'offline' : 'network' });
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', fwd);
  }
}

export function describe(e) {
  const k = e?.kind || (navigator.onLine === false ? 'offline' : 'network');
  if (k === 'offline') return { kind: k, icon: 'wifi-off', title: 'You’re offline',
    detail: 'A forecast has to come from Open-Meteo over the internet. Reconnect and Weather updates by itself.',
    short: 'You’re offline.' };
  if (k === 'timeout') return { kind: k, icon: 'clock', title: 'Open-Meteo didn’t answer',
    detail: 'The request took longer than 10 seconds. The service or your connection may be slow — try again in a moment.',
    short: 'Open-Meteo took too long to answer.' };
  if (k === 'http') {
    const reason = String(e.reason || '').trim().replace(/[\s.]+$/, '');
    if (e.status === 429) {
      /* the free tier counts requests per network (IP address), per minute, hour and day */
      const per = /minut/i.test(reason) ? 'minute' : /hour/i.test(reason) ? 'hour' : /dai|day/i.test(reason) ? 'day' : '';
      const back = per === 'minute' ? 'in a minute or two' : per === 'hour' ? 'within the hour' : per === 'day' ? 'tomorrow' : 'later';
      return { kind: k, icon: 'clock', title: 'Open-Meteo’s free limit was reached',
        detail: `Open-Meteo allows each network a set number of free requests${per ? ` a ${per}` : ''}, and this network has used them up. It should work again ${back}.`,
        short: 'Open-Meteo’s request limit was reached.', retryMin: per === 'minute' ? 2 : 30 };
    }
    return { kind: k, icon: 'alert', title: 'Open-Meteo returned an error',
      detail: `HTTP ${e.status}${reason ? ` — ${reason}` : ''}.${/try again/i.test(reason) ? '' : ' Try again in a moment.'}`,
      short: `Open-Meteo error (HTTP ${e.status}).` };
  }
  if (k === 'parse') return { kind: k, icon: 'alert', title: 'Unreadable reply',
    detail: 'Open-Meteo sent something this app could not read. Try again in a moment.',
    short: 'Open-Meteo sent an unreadable reply.' };
  return { kind: 'network', icon: 'wifi-off', title: 'Can’t reach Open-Meteo',
    detail: 'The request to open-meteo.com failed. Your connection may be down, or this network may block it (some school and office networks do).',
    short: 'Couldn’t reach Open-Meteo.' };
}

/* ---------------- WMO weather codes ----------------
   [label by day, label by night, glyph family] */
export const WMO = {
  0: ['Sunny', 'Clear', 'clear'], 1: ['Mostly sunny', 'Mostly clear', 'mostly'],
  2: ['Partly cloudy', 'Partly cloudy', 'partly'], 3: ['Overcast', 'Overcast', 'cloudy'],
  45: ['Fog', 'Fog', 'fog'], 48: ['Freezing fog', 'Freezing fog', 'fog'],
  51: ['Light drizzle', 0, 'drizzle'], 53: ['Drizzle', 0, 'drizzle'], 55: ['Heavy drizzle', 0, 'drizzle'],
  56: ['Light freezing drizzle', 0, 'sleet'], 57: ['Freezing drizzle', 0, 'sleet'],
  61: ['Light rain', 0, 'rain'], 63: ['Rain', 0, 'rain'], 65: ['Heavy rain', 0, 'rain'],
  66: ['Light freezing rain', 0, 'sleet'], 67: ['Freezing rain', 0, 'sleet'],
  71: ['Light snow', 0, 'snow'], 73: ['Snow', 0, 'snow'], 75: ['Heavy snow', 0, 'snow'], 77: ['Snow grains', 0, 'snow'],
  80: ['Light showers', 0, 'rain'], 81: ['Showers', 0, 'rain'], 82: ['Violent showers', 0, 'rain'],
  85: ['Snow showers', 0, 'snow'], 86: ['Heavy snow showers', 0, 'snow'],
  95: ['Thunderstorm', 0, 'storm'], 96: ['Thunderstorm with hail', 0, 'storm'], 99: ['Thunderstorm with heavy hail', 0, 'storm'],
};
export function cond(code, isDay) {
  const day = isDay !== 0 && isDay !== false;
  const w = WMO[code];
  if (!w) return { label: Number.isFinite(code) ? `Weather code ${code}` : 'No reading', fam: 'cloudy', day, sky: 'cloudy' };
  const fam = w[2];
  const sky = fam === 'clear' || fam === 'mostly' ? (day ? 'clear-day' : 'clear-night')
    : fam === 'partly' ? (day ? 'partly-day' : 'partly-night')
    : fam === 'drizzle' || fam === 'rain' || fam === 'sleet' ? 'rain'
    : fam;
  return { label: (!day && w[1]) || w[0], fam, day, sky };
}

export default { GEO_URL, FC_URL, keyOf, validPlace, getJSON, describe, WMO, cond };
