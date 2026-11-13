/* ============================================================
   Weather — the real forecast, from Open-Meteo.

   The old app shipped four hard-coded cities with invented
   temperatures and a seeded "forecast". Everything here now comes
   from Open-Meteo (free, keyless, CORS-open):

   · places are found with its geocoding API, or with the
     browser's own location — rounded to about a kilometre before
     it leaves this computer, and only ever sent to Open-Meteo;
   · the forecast (current conditions, the next 24 hours, 7 days)
     is fetched in the unit set in prefs.weatherUnit, and the page
     is drawn from the units the reply itself declares, so a saved
     reply can never be shown with the wrong unit on it.

   What "now" means on this page. While the last reply is under an
   hour old, the hero, the "Now" hour and the details show its
   current reading. Once it is older — Open-Meteo blocked at school,
   the laptop offline — a reading from yesterday evening is not
   "now" any more, so all three switch together to the saved
   forecast for the current hour (the hourly series carries a twin
   of every current value for this) and say so: "Forecast for 3 PM",
   "Updated yesterday 9:54 PM". When even the saved forecast has run
   out, the page says that instead of drawing old numbers.

   The last forecast for every saved place is kept in IndexedDB
   (kv 'misc'). Offline, or when Open-Meteo cannot be reached, the
   app shows that saved forecast with its age; with nothing saved
   it says plainly what went wrong and what to do.

   The widget rail's Weather card (js/shell/widgets.js) shares
   prefs.wxPlace ({ name, lat, lon }) and prefs.wxCache with this
   app: picking a place in either moves the other. The list of
   saved places is portal.weather ({ v: 2, places }). "Use my
   location" marks one entry here:true; when that entry is a place
   you saved yourself it is also saved:true, and moving elsewhere
   only takes the mark off it — a place you saved is never dropped
   because you walked away from it. Removing a place can be undone
   for a few seconds.

   Layout keeps the old app's structure — places in a sidebar, a
   hero, an hourly strip, a week of ranges and a grid of details —
   and tints the page by the sky it is describing.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { kv } from '../core/db.js';
/* the fetch, its errors in words, the WMO codes and what makes a place
   usable are shared with the weather on the wallpaper (core/wpweather.js) */
import { GEO_URL, FC_URL, keyOf, validPlace, getJSON, describe, cond } from '../core/openmeteo.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-weather-css')) {
  const l = document.createElement('link');
  l.id = 'feat-weather-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-weather.css';
  document.head.appendChild(l);
}

/* ---------------- Open-Meteo ---------------- */
const CURRENT = 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,'
  + 'cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m';
/* the hourly twins of the current values let a saved forecast describe "now" hours later */
const HOURLY = 'temperature_2m,precipitation_probability,weather_code,is_day,uv_index,visibility,pressure_msl,'
  + 'relative_humidity_2m,apparent_temperature,dew_point_2m,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,'
  + 'precipitation_probability_max,precipitation_sum,wind_speed_10m_max';

const WX_PLACE = 'prefs.wxPlace';          /* shared with the widget rail */
const WX_CACHE = 'prefs.wxCache';          /* shared with the widget rail */
const UNIT = 'prefs.weatherUnit';
const MINE = 'portal.weather';             /* { v:2, places:[{ name, lat, lon, here?, saved? }] } */
const FRESH = 15 * 60 * 1000;              /* Open-Meteo's "current" moves every 15 min */
const LIVE = 60 * 60 * 1000;               /* past this, a reading is no longer "now" */
const UNDO_MS = 10 * 1000;
const CACHE_PREFIX = 'weather:';
const HOURS = 24;
const COL_W = 56;                          /* one column of the hourly strip, px */

const store$ = kv('misc');

const unitQS = u => (u === 'C'
  ? '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm'
  : '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch');

const fcURL = (p, u) => `${FC_URL}?latitude=${(+p.lat).toFixed(4)}&longitude=${(+p.lon).toFixed(4)}`
  + `&current=${CURRENT}&hourly=${HOURLY}&daily=${DAILY}&timezone=auto&forecast_days=7${unitQS(u)}`;

/* the widget's own format for a geocoding hit — keep it identical */
const nameOf = r => [r.name, r.admin1, r.country_code].filter(Boolean).join(', ');
/* geocoding hits that would read the same in a list */
const sigOf = r => [r.name, r.admin1, r.country || r.country_code].join('|');

/* ---------------- glyphs ----------------
   Multi-colour weather marks in the OS icon style (stroked, round
   caps). Static path data only; the part behind a cloud is masked
   out so strokes never cross. */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.appendChild(k);
  return el;
}
const GP = {
  sun: 'M12 7.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zM12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6',
  moon: 'M20.2 14.4A8.4 8.4 0 1 1 9.6 3.8a6.6 6.6 0 0 0 10.6 10.6z',
  cloud: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  bolt: 'M13.6 13.2 10 18.6h3.2l-1.6 4.6 4.6-6.4h-3.3l1.7-3.6z',
  fog: 'M4 18.2h12.5M7.5 21.6H20',
  drizzle: 'M8.3 18.3v.9M12.3 18.3v.9M16.3 18.3v.9M10.3 21.3v.9M14.3 21.3v.9',
  rain: 'M8.8 18l-1.3 3.8M12.8 18l-1.3 3.8M16.8 18l-1.3 3.8',
  sleetR: 'M8.8 18l-1.3 3.8M16.8 18l-1.3 3.8',
  sleetS: 'M12.2 19.2h.01M11.4 22.4h.01',
  snow: 'M8 19h.01M12 18.8h.01M16 19h.01M10 22.2h.01M14 22.2h.01',
  rise: 'M3 19.5h18M7 19.5a5 5 0 0 1 10 0M12 3.5v6.5M9.3 6.2 12 3.5l2.7 2.7',
  set: 'M3 19.5h18M7 19.5a5 5 0 0 1 10 0M12 3.5v6.5M9.3 7.3 12 10l2.7-2.7',
  pin: 'M12 21.6s-6.8-5.9-6.8-11.3a6.8 6.8 0 0 1 13.6 0c0 5.4-6.8 11.3-6.8 11.3zM12 7.8a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
};
/* cloud on top, room below for rain / snow / fog marks */
const T_TOP = 'translate(2.4 -1.9) scale(.8)';
let gid = 0;

function glyph(fam, day, cls = '') {
  const id = `wxg${++gid}`;
  const sky = day ? { d: GP.sun, c: 's' } : { d: GP.moon, c: 'm' };
  let back = null, front = null;
  const extra = [];
  switch (fam) {
    case 'clear': extra.push({ ...sky }); break;
    case 'mostly': back = { ...sky, t: 'translate(-.7 -.7) scale(.84)' }; front = { d: GP.cloud, c: 'c', t: 'translate(11.3 12.2) scale(.52)' }; break;
    case 'partly': back = { ...sky, t: 'translate(-.4 -.6) scale(.64)' }; front = { d: GP.cloud, c: 'c', t: 'translate(5.4 6.6) scale(.76)' }; break;
    case 'cloudy': back = { d: GP.cloud, c: 'c2', t: 'translate(9 -.6) scale(.6)' }; front = { d: GP.cloud, c: 'c', t: 'translate(.2 5.2) scale(.8)' }; break;
    case 'fog': front = { d: GP.cloud, c: 'c', t: T_TOP }; extra.push({ d: GP.fog, c: 'f' }); break;
    case 'drizzle': front = { d: GP.cloud, c: 'c', t: T_TOP }; extra.push({ d: GP.drizzle, c: 'r' }); break;
    case 'rain': front = { d: GP.cloud, c: 'c', t: T_TOP }; extra.push({ d: GP.rain, c: 'r' }); break;
    case 'sleet': front = { d: GP.cloud, c: 'c', t: T_TOP }; extra.push({ d: GP.sleetR, c: 'r' }, { d: GP.sleetS, c: 'sn' }); break;
    case 'snow': front = { d: GP.cloud, c: 'c', t: T_TOP }; extra.push({ d: GP.snow, c: 'sn' }); break;
    case 'storm': front = { d: GP.cloud, c: 'c', t: T_TOP }; extra.push({ d: GP.bolt, c: 'z' }); break;
    case 'rise': extra.push({ d: GP.rise, c: 's' }); break;
    case 'set': extra.push({ d: GP.set, c: 's' }); break;
    case 'pin': extra.push({ d: GP.pin, c: 'p' }); break;
    default: front = { d: GP.cloud, c: 'c' };
  }
  const path = p => svgEl('path', { d: p.d, class: p.c, transform: p.t || null });
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  if (back && front) {
    svg.appendChild(svgEl('defs', null, svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: '-4', y: '-4', width: '32', height: '32' },
      svgEl('rect', { x: '-4', y: '-4', width: '32', height: '32', fill: '#fff' }),
      svgEl('path', { d: front.d, transform: front.t || null, class: 'cut' }))));
    svg.appendChild(svgEl('g', { mask: `url(#${id})` }, path(back)));
  }
  if (front) svg.appendChild(path(front));
  extra.forEach(p => svg.appendChild(path(p)));
  const el = document.createElement('span');
  el.className = `wx-g${cls ? ` ${cls}` : ''}`;
  el.dataset.fam = fam;
  el.appendChild(svg);
  return el;
}

/* ---------------- numbers ---------------- */
const pad2 = n => String(n).padStart(2, '0');
const fin = v => typeof v === 'number' && Number.isFinite(v);
const deg = v => (fin(v) ? `${Math.round(v) || 0}°` : '—');
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = d => DIRS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
const uvLabel = u => (u < 2.5 ? 'Low' : u < 5.5 ? 'Moderate' : u < 7.5 ? 'High' : u < 10.5 ? 'Very high' : 'Extreme');
/* a length of time in minutes: "11 h 54 min", "45 min", "3 h" */
const span = min => {
  const t = Math.max(0, Math.round(min)), hh = Math.floor(t / 60), mm = t % 60;
  return hh && mm ? `${hh} h ${mm} min` : hh ? `${hh} h` : `${mm} min`;
};

/** The units a reply declares (it is the truth, whatever the pref says now). */
function unitsOf(fc) {
  const cu = fc.current_units || {}, hu = fc.hourly_units || {};
  const ws = String(cu.wind_speed_10m || '');
  return {
    t: String(cu.temperature_2m || '').includes('F') ? 'F' : 'C',
    wind: /mp/.test(ws) ? 'mph' : /km/.test(ws) ? 'km/h' : /kn/.test(ws) ? 'kn' : ws || 'km/h',
    rain: /inch/.test(String(cu.precipitation || '')) ? 'in' : 'mm',
    vis: String(hu.visibility || 'm'),
  };
}
const toC = (v, u) => (u.t === 'F' ? (v - 32) * 5 / 9 : v);
/* a trace too small for two decimals is "< 0.01 in", never a flat 0 next to "75% chance" */
function amount(v, u) {
  if (!fin(v)) return '—';
  if (u.rain === 'in') return v <= 0 ? '0 in' : v < 0.005 ? '< 0.01 in' : `${v.toFixed(2)} in`;
  return v <= 0 ? '0 mm' : v < 0.05 ? '< 0.1 mm' : `${v.toFixed(1)} mm`;
}
const speed = (v, u) => (fin(v) ? `${Math.round(v)} ${u.wind}` : '—');
function visibility(v, u) {
  if (!fin(v)) return { text: '—', km: NaN };
  const km = u.vis === 'ft' ? v * 0.0003048 : v / 1000;
  const n = u.t === 'F' ? km / 1.609344 : km;
  const unit = u.t === 'F' ? 'mi' : 'km';
  return { text: `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${unit}`, km };
}
/* Open-Meteo gives pressure in hPa whatever the unit; the °F page reads inches of mercury */
const HPA_INHG = 0.0295300;
const pressure = (hPa, u) => (!fin(hPa) ? '—' : u.t === 'F' ? `${(hPa * HPA_INHG).toFixed(2)} inHg` : `${Math.round(hPa)} hPa`);
const pressureChange = (dp, u) => `${dp > 0 ? '+' : '−'}${u.t === 'F' ? `${Math.abs(dp * HPA_INHG).toFixed(2)} inHg` : `${Math.abs(dp).toFixed(1)} hPa`}`;

/* colour of a temperature (°C), for range bars and the hourly curve */
const TSTOPS = [[-25, [132, 118, 255]], [-10, [102, 146, 255]], [0, [86, 186, 255]], [8, [78, 212, 214]],
  [15, [128, 222, 142]], [21, [240, 212, 92]], [27, [255, 164, 66]], [33, [255, 104, 74]], [40, [232, 56, 98]]];
function tColor(c) {
  if (!fin(c)) return 'rgb(150,150,160)';
  if (c <= TSTOPS[0][0]) return `rgb(${TSTOPS[0][1].join(',')})`;
  for (let i = 1; i < TSTOPS.length; i++) {
    const [t1, a] = TSTOPS[i - 1], [t2, b] = TSTOPS[i];
    if (c <= t2) {
      const k = (c - t1) / (t2 - t1);
      return `rgb(${a.map((x, j) => Math.round(x + (b[j] - x) * k)).join(',')})`;
    }
  }
  return `rgb(${TSTOPS[TSTOPS.length - 1][1].join(',')})`;
}

/* ---------------- time, in the place's own zone ----------------
   Open-Meteo (timezone=auto) returns local wall-clock strings
   "YYYY-MM-DDTHH:MM" and the zone's utc_offset_seconds. */
function placeNow(off) {
  const t = new Date(Date.now() + (off || 0) * 1000);
  const Y = t.getUTCFullYear(), M = pad2(t.getUTCMonth() + 1), D = pad2(t.getUTCDate());
  const hh = t.getUTCHours(), mm = t.getUTCMinutes();
  return { iso: `${Y}-${M}-${D}T${pad2(hh)}:${pad2(mm)}`, hourIso: `${Y}-${M}-${D}T${pad2(hh)}:00`, dateIso: `${Y}-${M}-${D}`, hh, mm };
}
const isoMs = iso => {
  const [d, t = '00:00'] = String(iso).split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, dd, hh, mm);
};
const isoDay = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
const kmBetween = (a, b, c, d) => {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2
    + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
const regionName = cc => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || cc; } catch (e) { return cc; }
};
/** "Paris, Île-de-France, FR" → ["Paris", "Île-de-France, France"] */
function splitName(p) {
  const parts = String(p.name).split(',').map(s => s.trim()).filter(Boolean);
  const head = parts.shift() || 'Unnamed place';
  const rest = parts.filter(s => s !== head).map(s => (/^[A-Z]{2}$/.test(s) ? regionName(s) : s));
  return [head, rest.join(', ')];
}
const coords = p => `${Math.abs(p.lat).toFixed(2)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}° ${p.lon >= 0 ? 'E' : 'W'}`;

/** How a geocoding hit is listed and saved: two hits that would read the same
    get their district (admin2) — or, failing that, their coordinates — so
    they can be told apart. */
function labelFor(r, list) {
  const same = (list || []).filter(x => sigOf(x) === sigOf(r));
  if (same.length < 2) return { name: nameOf(r), extra: null };
  const byDistrict = same.every(x => x.admin2 && x.admin2 !== x.name && x.admin2 !== x.admin1)
    && new Set(same.map(x => x.admin2)).size === same.length;
  if (byDistrict) return { name: [r.name, r.admin2, r.admin1, r.country_code].filter(Boolean).join(', '), extra: r.admin2 };
  return { name: nameOf(r), extra: coords({ lat: r.latitude, lon: r.longitude }) };
}

/* smooth path through explicit points (midpoint cubic, no overshoot past neighbours) */
function smooth(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

defineApp({
  id: 'weather',
  name: 'Weather',
  icon: 'cloud-sun',
  g1: '#93d4ff', g2: '#2374cc',
  category: 'Utilities',
  keywords: ['forecast', 'temperature', 'rain', 'hourly', 'cities', 'open-meteo', 'location', 'uv', 'wind'],
  desc: 'Live forecasts from Open-Meteo for the places you save',
  pinned: true,
  singleton: true,
  win: { w: 820, h: 600, minW: 380, minH: 360 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, fmt, store, bus } = api;

    let dead = false;
    const offs = [];
    const uid = `wx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const S = {
      places: [],
      cur: null,          /* key of the place on screen */
      data: null,         /* { at, key, unit, place, fc } — a real reply, maybe from the cache */
      fromCache: false,   /* read from IndexedDB and not yet confirmed by a fetch */
      busy: false,
      error: null,
      offline: navigator.onLine === false,
      minis: new Map(),   /* key → { temp, code, day, unit, at } for the sidebar */
      q: '', results: null, resultsQ: '', sBusy: false, sErr: null, active: -1, pickFirst: false,
      geoBusy: false, geoErr: null, geoInfo: null,
      edit: false,
      openDay: -1,
      hourKey: '',
    };
    let undo = null;      /* { place, index, key, wasCur, mini, timer } — the last removal, still reversible */
    const unit = () => (store.get(UNIT, 'F') === 'C' ? 'C' : 'F');
    const h24 = () => !!store.get('prefs.h24');
    const curPlace = () => S.places.find(p => keyOf(p) === S.cur) || null;
    /* a reading is "now" while it is under an hour old; after that the page uses the hourly forecast */
    const isLive = d => !!d && Date.now() - d.at < LIVE;
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const short = p => splitName(p)[0];

    /* clock strings: the viewer's own clock, and a place's wall clock */
    const myClock = ms => { const c = fmt.fmtClock(new Date(ms), h24()); return h24() ? c.time : `${c.time} ${c.ap}`; };
    /** a moment on the viewer's clock, with its day once it isn't today: "9:54 PM", "yesterday 9:54 PM", "Tue 9:54 PM" */
    const stamp = ms => {
      const t = new Date(ms), n = new Date();
      const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const dd = Math.round((day0(n) - day0(t)) / 86400000);
      const c = myClock(ms);
      if (dd <= 0) return c;
      if (dd === 1) return `yesterday ${c}`;
      if (dd < 7) return `${fmt.dayName(t, true)} ${c}`;
      return `${fmt.monthName(t, true)} ${t.getDate()}, ${c}`;
    };
    const hm = (hh, mm) => (h24() ? `${pad2(hh)}:${pad2(mm)}` : `${hh % 12 || 12}:${pad2(mm)} ${hh >= 12 ? 'PM' : 'AM'}`);
    const isoHM = iso => { const t = String(iso).slice(11, 16).split(':').map(Number); return hm(t[0], t[1]); };
    const isoHour = iso => { const hh = +String(iso).slice(11, 13); return h24() ? pad2(hh) : `${hh % 12 || 12} ${hh >= 12 ? 'PM' : 'AM'}`; };
    /* "3 PM" / "15:00" — an hour said on its own */
    const hourName = iso => (h24() ? `${String(iso).slice(11, 13)}:00` : isoHour(iso));
    const ago = at => {
      const s = Math.max(0, (Date.now() - at) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return `${Math.floor(s / 60)} min ago`;
      if (s < 86400) { const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return `${hh} h${mm ? ` ${mm} min` : ''} ago`; }
      const d = Math.floor(s / 86400);
      return `${d} day${d > 1 ? 's' : ''} ago`;
    };
    const say = msg => { live.textContent = ''; setTimeout(() => { if (!dead) live.textContent = msg; }, 40); };

    /* ---------------- saved places ---------------- */
    const tidy = p => ({ name: p.name, lat: +p.lat, lon: +p.lon, ...(p.here ? { here: true, ...(p.saved ? { saved: true } : {}) } : {}) });
    function readPlaces() {
      const raw = store.get(MINE);
      /* before v2 a location mark could sit on a place the person had saved themselves,
         with no record of it — so an old mark is treated as saved, never as disposable */
      const legacy = !(raw && raw.v >= 2);
      const seen = new Set();
      return (Array.isArray(raw?.places) ? raw.places : [])
        .filter(p => validPlace(p) && !seen.has(keyOf(p)) && seen.add(keyOf(p)))
        .map(p => tidy({ ...p, saved: p.saved || legacy }));
    }
    function savePlaces(list) {
      S.places = list.map(tidy);
      const raw = store.get(MINE);
      store.set(MINE, { ...(raw && typeof raw === 'object' ? raw : {}), v: 2, places: S.places.map(tidy) });
    }
    /** The widget's place is always in the list. (It is usually the place this app gave it,
        so finding it there says nothing about whether the person saved it.) */
    function keep(v) {
      if (!S.places.some(p => keyOf(p) === keyOf(v))) savePlaces([...S.places, { name: v.name, lat: +v.lat, lon: +v.lon }]);
    }
    /** Drop what the app kept for a place that is gone for good. */
    function forget(key) {
      store$.del(CACHE_PREFIX + key).catch(() => {});
      S.minis.delete(key);
    }

    /* the widget's cache format (js/shell/widgets.js), so it can show our reply.
       A missing reading stays missing (null), never a made-up 0°. */
    function widgetCache(d) {
      const fc = d.fc, D = fc.daily || {}, c = fc.current || {};
      const days = (D.time || []).slice(0, 5).map((iso, i) => (fin(D.temperature_2m_max?.[i]) ? {
        d: fmt.dayName(new Date(`${iso}T12:00:00`), true),
        code: D.weather_code?.[i],
        hi: Math.round(D.temperature_2m_max[i]) || 0,
      } : null)).filter(Boolean);
      return { at: d.at, unit: d.unit, name: d.place.name, temp: fin(c.temperature_2m) ? Math.round(c.temperature_2m) || 0 : null, code: c.weather_code, days };
    }
    /** Move the widget to this place — and never leave it showing another place's reading. */
    function pushToWidget(p) {
      const d = S.data;
      const w = store.get(WX_PLACE), wc = store.get(WX_CACHE);
      const moving = !validPlace(w) || keyOf(w) !== keyOf(p) || w.name !== p.name;
      if (d && d.key === keyOf(p) && d.unit === unit() && isLive(d)) {
        if (moving || !wc || wc.name !== p.name || wc.unit !== d.unit || !(wc.at >= d.at)) store.set(WX_CACHE, widgetCache(d));
      } else if (moving) store.set(WX_CACHE, null);
      if (moving) store.set(WX_PLACE, { name: p.name, lat: p.lat, lon: p.lon });
    }

    function select(key, { focus } = {}) {
      const p = S.places.find(x => keyOf(x) === key);
      if (!p) return;
      const same = S.cur === key;
      S.cur = key;
      if (!same) {
        /* the person has moved on: an old location warning no longer applies */
        S.openDay = -1; S.error = null; S.geoErr = null; S.geoInfo = null;
        if (S.data?.key !== key) { S.data = null; S.fromCache = false; }
        scroll.scrollTop = 0;
        pushToWidget(p);
      }
      paintAll();
      if (focus) placesBox.querySelector(`[data-key="${key}"]`)?.focus();
      if (!same) load();
    }

    let infoTimer = 0;
    function addPlace(p, { here = false } = {}) {
      const place = { name: String(p.name), lat: +(+p.lat).toFixed(4), lon: +(+p.lon).toFixed(4) };
      const key = keyOf(place);
      const dropped = [];
      /* one location mark. An entry that only existed because you were there goes (its slot is
         reused); a place you also saved yourself just loses the mark. */
      let list = S.places.map(x => {
        if (!here || !x.here || keyOf(x) === key) return x;
        if (x.saved) return { name: x.name, lat: x.lat, lon: x.lon };
        dropped.push(x);
        return null;
      });
      const at = list.findIndex(x => x && keyOf(x) === key);
      let msg, info = null;
      if (at >= 0) {
        const x = list[at];
        if (here && x.here) { msg = info = `You’re still in ${short(x)}.`; }
        else if (here) { list[at] = { ...x, here: true, saved: true }; msg = `${short(x)} is saved, and now marked as your location.`; }
        else if (x.here && !x.saved) { list[at] = { ...x, saved: true }; msg = `Saved ${short(x)}.`; }
        else msg = `${short(x)} is already saved.`;
      } else {
        const entry = here ? { ...place, here: true } : place;
        const slot = list.indexOf(null);
        if (slot >= 0) list[slot] = entry; else list.push(entry);
        msg = here ? `Added your location, ${short(place)}.` : `Added ${short(place)}.`;
      }
      list = list.filter(Boolean);
      savePlaces(list);
      dropped.forEach(x => forget(keyOf(x)));
      if (!S.minis.has(key)) refreshMinis(true);
      select(key);
      /* after select(), which clears notes */
      S.geoErr = null;
      S.geoInfo = info;
      clearTimeout(infoTimer);
      if (info) infoTimer = setTimeout(() => { if (!dead && S.geoInfo === info) { S.geoInfo = null; paintGeo(); } }, 6000);
      paintGeo();
      say(msg);
    }

    function removePlace(key) {
      const i = S.places.findIndex(p => keyOf(p) === key);
      if (i < 0) return;
      commitUndo();
      const gone = S.places[i];
      const list = S.places.filter((_, j) => j !== i);
      savePlaces(list);
      /* the saved forecast stays in IndexedDB until the chance to undo has passed */
      undo = { place: gone, index: i, key, wasCur: S.cur === key, mini: S.minis.get(key), timer: setTimeout(commitUndo, UNDO_MS) };
      S.minis.delete(key);
      say(`Removed ${short(gone)}. Undo is next to the list for ${UNDO_MS / 1000} seconds.`);
      paintUndo();
      if (S.cur !== key) { paintPlaces(); return; }
      const next = list[Math.min(i, list.length - 1)];
      if (next) { select(keyOf(next)); placesBox.querySelector(`[data-key="${keyOf(next)}"]`)?.focus(); return; }
      S.cur = null; S.data = null; S.error = null;
      ++seq; ac?.abort(); ac = null; S.busy = false;
      store.set(WX_CACHE, null);
      store.set(WX_PLACE, null);
      paintAll();
      undoBtn.focus();
    }
    /** The removal stands: let go of its saved forecast. */
    function commitUndo() {
      if (!undo) return;
      const u = undo;
      undo = null;
      clearTimeout(u.timer);
      if (!S.places.some(p => keyOf(p) === u.key)) store$.del(CACHE_PREFIX + u.key).catch(() => {});
      if (!dead) paintUndo();
    }
    function undoRemove() {
      if (!undo) return;
      const u = undo;
      undo = null;
      clearTimeout(u.timer);
      if (!S.places.some(p => keyOf(p) === u.key)) {
        /* a newer location mark wins; the restored place comes back as a place you saved */
        const place = u.place.here && S.places.some(p => p.here) ? { name: u.place.name, lat: u.place.lat, lon: u.place.lon } : u.place;
        const list = [...S.places];
        list.splice(Math.min(u.index, list.length), 0, place);
        savePlaces(list);
        if (u.mini) S.minis.set(u.key, u.mini);
      }
      say(`Restored ${short(u.place)}.`);
      paintUndo();
      if (u.wasCur || !S.cur) select(u.key);
      else paintPlaces();
      placesBox.querySelector(`[data-key="${u.key}"]`)?.focus();
    }

    function movePlace(key, dir) {
      const i = S.places.findIndex(p => keyOf(p) === key), j = i + dir;
      if (i < 0 || j < 0 || j >= S.places.length) return;
      const list = [...S.places];
      [list[i], list[j]] = [list[j], list[i]];
      savePlaces(list);
      paintPlaces();
      placesBox.querySelector(`[data-key="${key}"]`)?.focus();
      say(`Moved ${short(list[j])} to position ${j + 1} of ${list.length}`);
    }

    /* ---------------- fetching ---------------- */
    let ac = null, seq = 0, failStreak = 0, nextAuto = 0;

    async function load() {
      const key = S.cur;
      if (!key) return;
      if (!S.data || S.data.key !== key) {
        const c = await store$.get(CACHE_PREFIX + key).catch(() => null);
        if (dead || S.cur !== key) return;
        if (c?.fc?.current && c.fc.hourly?.time && c.fc.daily?.time && (!S.data || S.data.key !== key)) {
          S.data = c; S.fromCache = true;
          paintAll();
        }
      }
      refresh(false);
    }

    async function refresh(force) {
      const p = curPlace();
      if (!p || dead) return;
      const key = keyOf(p), want = unit(), d = S.data;
      if (!force && d && d.key === key && d.unit === want && Date.now() - d.at < FRESH) {
        /* nothing to fetch — and a request still out for the other unit must not land on top of this */
        if (ac) { ac.abort(); ac = null; ++seq; S.busy = false; paintBusy(); paintMain(); }
        if (S.fromCache) { S.fromCache = false; pushToWidget(p); paintMain(); }
        return;
      }
      ac?.abort();
      ac = new AbortController();
      const my = ++seq;
      S.busy = true;
      paintBusy();
      if (!d || d.key !== key) paintMain();
      try {
        const fc = await getJSON(fcURL(p, want), ac.signal);
        if (dead || my !== seq) return;
        if (!fc?.current || !Array.isArray(fc.hourly?.time) || !Array.isArray(fc.daily?.time)) {
          throw Object.assign(new Error('incomplete'), { kind: 'parse' });
        }
        const rec = { at: Date.now(), key, unit: want, place: { name: p.name, lat: p.lat, lon: p.lon }, fc };
        S.data = rec; S.fromCache = false; S.error = null; S.offline = false; failStreak = 0;
        S.minis.set(key, { temp: fc.current.temperature_2m, code: fc.current.weather_code, day: fc.current.is_day, unit: want, at: rec.at });
        store$.set(CACHE_PREFIX + key, rec).catch(() => {});
        const w = store.get(WX_PLACE);
        if (validPlace(w) && keyOf(w) === key) store.set(WX_CACHE, widgetCache(rec));
        if (force) say(`Forecast for ${short(p)} updated`);
      } catch (e) {
        if (dead || my !== seq) return;
        S.error = describe(e);
        if (S.error.kind === 'offline') S.offline = true;
        failStreak++;
        say(S.error.short);
      } finally {
        if (!dead && my === seq) {
          S.busy = false; ac = null;
          const wait = S.error ? (S.error.retryMin || Math.min(10, 2 ** Math.min(failStreak, 4))) : 0;
          nextAuto = Date.now() + wait * 60000;
          paintAll();
        }
      }
    }

    /* one request for every saved place's current reading, for the sidebar */
    let miniAc = null, miniAt = 0, miniNext = 0, miniFails = 0;
    async function refreshMinis(force) {
      const list = S.places;
      if (!list.length || dead) return;
      const want = unit();
      if (!force && Date.now() < miniNext) return;
      if (!force && Date.now() - miniAt < FRESH && list.every(p => S.minis.get(keyOf(p))?.unit === want)) {
        miniAc?.abort(); miniAc = null;   /* a request for the other unit must not land on top */
        return;
      }
      miniAc?.abort();
      const mine = miniAc = new AbortController();
      try {
        const j = await getJSON(`${FC_URL}?latitude=${list.map(p => (+p.lat).toFixed(4)).join(',')}`
          + `&longitude=${list.map(p => (+p.lon).toFixed(4)).join(',')}`
          + `&current=temperature_2m,weather_code,is_day&timezone=auto${unitQS(want)}`, mine.signal);
        if (dead || mine !== miniAc) return;
        miniAc = null;
        const arr = Array.isArray(j) ? j : [j];
        const now = Date.now();
        arr.forEach((r, i) => {
          const p = list[i];
          if (p && r?.current) S.minis.set(keyOf(p), { temp: r.current.temperature_2m, code: r.current.weather_code, day: r.current.is_day, unit: want, at: now });
        });
        miniAt = now; miniFails = 0; miniNext = 0;
        paintPlaces();
      } catch (e) {
        /* the list simply shows no reading next to a name; try again later, not every tick */
        if (!dead && mine === miniAc) { miniAc = null; miniNext = Date.now() + Math.min(10, 2 ** Math.min(++miniFails, 4)) * 60000; }
      }
    }

    /* ---------------- search ----------------
       Results belong to the query that produced them (S.resultsQ). While
       the field says something else the old rows are shown faded and
       can't be chosen, and Enter looks the new text up and takes its
       first match — it never adds a place from the previous query. */
    let sTimer = 0, sAc = null, sQ = '';
    const searchText = () => input.value.trim();
    const freshResults = () => !!S.results && S.resultsQ === searchText();
    function onSearchInput() {
      S.q = input.value;
      clearTimeout(sTimer);
      S.pickFirst = false;
      const q = searchText();
      if (q.length < 2) {
        sAc?.abort(); sAc = null;
        S.results = null; S.resultsQ = ''; S.sErr = null; S.sBusy = false; S.active = -1;
        paintResults();
        return;
      }
      if (q === S.resultsQ && S.results && !sAc) {        /* back to what is already listed */
        S.sBusy = false;
        S.active = S.results.length ? Math.max(0, S.active) : -1;
        paintResults();
        return;
      }
      S.sBusy = true;
      paintResults();
      sTimer = setTimeout(() => search(q), 280);
    }
    async function search(q, pickFirst = false) {
      clearTimeout(sTimer);
      if (pickFirst && sAc && sQ === q) { S.pickFirst = true; return; }   /* already on its way: take its first match */
      sAc?.abort();
      const mine = sAc = new AbortController();
      sQ = q;
      S.sBusy = true;
      S.pickFirst = pickFirst;
      paintResults();
      let found = [], err = null;
      try {
        const j = await getJSON(`${GEO_URL}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`, mine.signal);
        found = (j.results || []).filter(r => fin(r.latitude) && fin(r.longitude) && r.name);
      } catch (e) {
        err = `${describe(e).short} Search needs Open-Meteo’s geocoding service.`;
      }
      if (dead || mine !== sAc) return;
      sAc = null;
      const current = searchText() === q;
      const go = S.pickFirst && current;
      S.pickFirst = false;
      S.results = found; S.resultsQ = q;
      S.sErr = err || (found.length ? null : `No places match “${q}”.`);
      S.sBusy = !current && searchText().length >= 2;     /* the field has moved on; its own search is queued */
      S.active = current && found.length ? 0 : -1;
      if (go && found.length) { pick(found[0]); return; }
      paintResults();
      if (current) say(S.sErr || `${found.length} place${found.length === 1 ? '' : 's'} found`);
    }
    function clearSearch() {
      clearTimeout(sTimer);
      sAc?.abort(); sAc = null;
      input.value = ''; S.q = '';
      S.results = null; S.resultsQ = ''; S.sErr = null; S.sBusy = false; S.active = -1; S.pickFirst = false;
      paintResults();
    }
    function pick(r) {
      const { name } = labelFor(r, S.results);
      clearSearch();
      addPlace({ name, lat: r.latitude, lon: r.longitude });
    }

    /* ---------------- my location ---------------- */
    let geoAc = null, geoGuard = 0, geoTicket = 0;
    async function nearestName(lat, lon, signal) {
      /* Open-Meteo has no reverse geocoder: take the city its time zone is
         named after and use it only when it really is where you are. */
      const tz = await getJSON(`${FC_URL}?latitude=${lat}&longitude=${lon}&current=is_day&timezone=auto&forecast_days=1`, signal);
      const city = String(tz.timezone || '').includes('/') ? String(tz.timezone).split('/').pop().replace(/_/g, ' ') : '';
      if (!city) return null;
      const g = await getJSON(`${GEO_URL}?name=${encodeURIComponent(city)}&count=10&language=en&format=json`, signal);
      let best = null, bestKm = Infinity;
      for (const r of g.results || []) {
        const d = kmBetween(lat, lon, r.latitude, r.longitude);
        if (d < bestKm) { bestKm = d; best = r; }
      }
      return best && bestKm <= 30 ? nameOf(best) : null;
    }
    function locate() {
      if (S.geoBusy) return;
      S.geoErr = null; S.geoInfo = null;
      if (!navigator.geolocation) {
        S.geoErr = 'This browser can’t share a location. Search for a city instead.';
        paintGeo(); paintMain(); say(S.geoErr);
        return;
      }
      S.geoBusy = true;
      paintGeo();
      if (!curPlace()) paintMain();
      const ticket = ++geoTicket;
      /* a prompt nobody answers never calls back; don't spin forever */
      clearTimeout(geoGuard);
      geoGuard = setTimeout(() => {
        if (dead || ticket !== geoTicket || !S.geoBusy) return;
        geoTicket++;
        S.geoBusy = false;
        S.geoErr = 'The browser hasn’t answered the location request. Look for a permission prompt near the address bar, or search for a city.';
        paintGeo(); paintMain(); say(S.geoErr);
      }, 30000);
      navigator.geolocation.getCurrentPosition(async pos => {
        if (dead || ticket !== geoTicket) return;
        clearTimeout(geoGuard);
        /* about a kilometre is plenty for a forecast, and all that leaves the computer */
        const lat = +pos.coords.latitude.toFixed(2), lon = +pos.coords.longitude.toFixed(2);
        const known = S.places.find(x => keyOf(x) === keyOf({ lat, lon }));
        let name = known ? known.name : null;
        if (!known) {
          geoAc?.abort();
          const mine = geoAc = new AbortController();
          try { name = await nearestName(lat, lon, mine.signal); } catch (e) { /* a plain "Your location" is still right */ }
          if (dead || ticket !== geoTicket) return;
        }
        S.geoBusy = false;
        addPlace({ name: name || 'Your location', lat, lon }, { here: true });
      }, err => {
        if (dead || ticket !== geoTicket) return;
        clearTimeout(geoGuard);
        S.geoBusy = false;
        S.geoErr = err?.code === 1
          ? 'Location is blocked for this site. Allow it in the browser’s site settings (the icon beside the address), or search for a city instead.'
          : err?.code === 3
            ? 'Finding your location took too long. Try again, or search for a city.'
            : 'Your device couldn’t work out where it is. Search for a city instead.';
        paintGeo(); paintMain(); say(S.geoErr);
        /* the button was pressed to ask for a fresh position, so never accept an old one */
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 });
    }

    /* ---------------- chrome ---------------- */
    const setUnit = u => { if (u !== unit()) store.set(UNIT, u); };
    const unitBtn = u => h('button.tip.tip--below', {
      type: 'button', dataset: { unit: u, tip: `${u === 'F' ? 'Fahrenheit' : 'Celsius'} (${u})` },
      'aria-label': `Degrees ${u === 'F' ? 'Fahrenheit' : 'Celsius'}`, 'aria-keyshortcuts': u,
      onclick: () => setUnit(u),
    }, `°${u}`);
    const tabs = h('div.tabs.wx-units', { role: 'group', 'aria-label': 'Units' }, unitBtn('F'), unitBtn('C'));
    const refreshBtn = h('button.ibtn.tip.tip--below.wx-refresh', {
      type: 'button', 'data-tip': 'Refresh (R)', 'aria-label': 'Refresh forecast', 'aria-keyshortcuts': 'R',
      onclick: () => { refresh(true); refreshMinis(true); },
    }, icon('refresh'));
    function paintTabs() {
      for (const b of tabs.children) {
        const on = b.dataset.unit === unit();
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    win.setTools(tabs, refreshBtn);

    /* ---------------- layout ---------------- */
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const input = h('input', {
      type: 'search', placeholder: 'Search for a city', 'aria-label': 'Search for a city',
      autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-keyshortcuts': '/',
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${uid}-res`,
      oninput: onSearchInput,
      onkeydown: e => {
        const n = freshResults() ? S.results.length : 0;
        if (e.key === 'ArrowDown' && n) { e.preventDefault(); S.active = (S.active + 1) % n; paintResults(); }
        else if (e.key === 'ArrowUp' && n) { e.preventDefault(); S.active = (S.active - 1 + n) % n; paintResults(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const q = searchText();
          if (q.length < 2) return;
          if (n) pick(S.results[Math.max(0, S.active)]);
          else search(q, true);          /* not listed yet: look it up now and add the first match */
        } else if (e.key === 'Escape' && (input.value || S.results || S.sBusy)) { e.preventDefault(); e.stopPropagation(); clearSearch(); }
      },
    });
    const results = h('div.wx-results', { id: `${uid}-res`, role: 'listbox', 'aria-label': 'Places found' });
    const geoBtn = h('button.wx-geo', { type: 'button', onclick: locate });
    const geoText = h('span.grow');
    const geoNote = h('div.wx-note', geoText,
      h('button.ibtn.wx-note__x', {
        type: 'button', 'aria-label': 'Dismiss',
        onclick: () => { S.geoErr = null; S.geoInfo = null; paintGeo(); geoBtn.focus(); },
      }, icon('x')));
    const editBtn = h('button.wx-edit', {
      type: 'button', 'aria-pressed': 'false',
      onclick: () => { S.edit = !S.edit; paintPlaces(); },
    }, 'Edit');
    const placesHead = h('div.wx-places__head', h('div.side__label', { text: 'Places', id: `${uid}-pl` }), editBtn);
    const placesBox = h('div.wx-places', { role: 'list', 'aria-labelledby': `${uid}-pl` });
    const undoText = h('span.wx-undo__t');
    const undoBtn = h('button.btn.btn--sm.wx-undo__b', {
      type: 'button', 'aria-keyshortcuts': fmt.isMac ? 'Meta+Z' : 'Control+Z', onclick: () => undoRemove(),
    }, icon('rotate-ccw'), 'Undo');
    const undoBar = h('div.wx-undo', { hidden: true }, undoText, undoBtn);
    const placesNote = h('div.wx-places__tip');
    const side = h('aside.app__side.wx-side', { 'aria-label': 'Places' },
      h('div.wx-find', h('label.field.wx-search', icon('search'), input), geoBtn),
      geoNote, results, placesHead, placesBox, undoBar, placesNote);
    const scroll = h('div.app__content.wx-scroll', { tabindex: '-1' });
    const main = h('div.app__main.wx-main', { role: 'region', 'aria-label': 'Forecast' }, scroll);
    const app = h('div.app.wx', side, main);
    const host = h('div.wx-host', app, live);
    root.appendChild(host);

    /* ---------------- sidebar ---------------- */
    function paintGeo() {
      const here = S.places.find(p => p.here);
      api.render(geoBtn, S.geoBusy ? icon('refresh', 'wx-spin') : glyph('pin'),
        h('span.wx-geo__t', { text: S.geoBusy ? 'Finding you…' : here ? 'Update my location' : 'Use my location' }));
      geoBtn.setAttribute('aria-busy', S.geoBusy ? 'true' : 'false');
      /* with no place the welcome page says it, in the middle of the window */
      const warn = S.geoErr && curPlace() ? S.geoErr : '';
      geoText.textContent = warn || S.geoInfo || '';
      geoNote.classList.toggle('is-info', !warn);
      geoNote.hidden = !geoText.textContent;
    }

    function paintResults() {
      const q = searchText();
      const list = S.results || [];
      const fresh = freshResults();
      const open = !!(S.sBusy || S.results || S.sErr);
      const hits = fresh ? list.length : 0;
      input.setAttribute('aria-expanded', open && hits ? 'true' : 'false');
      results.hidden = !open;
      results.setAttribute('aria-busy', S.sBusy ? 'true' : 'false');
      side.classList.toggle('is-searching', open);
      api.clear(results);
      if (!open) { input.removeAttribute('aria-activedescendant'); return; }
      if (S.sBusy) results.appendChild(h('div.wx-results__msg', icon('refresh', 'wx-spin'), h('span.trunc', { text: `Searching for “${q}”…` })));
      else if (S.sErr) results.appendChild(h('div.wx-results__msg', { text: S.sErr }));
      list.forEach((r, i) => {
        const saved = S.places.some(p => keyOf(p) === keyOf({ lat: r.latitude, lon: r.longitude }));
        const where = [r.admin1 !== r.name ? r.admin1 : null, r.country || r.country_code].filter(Boolean).join(', ');
        const { extra } = labelFor(r, list);
        const kids = [
          h('div.grow',
            h('b.trunc', { text: r.name }),
            h('small.trunc', { text: [extra, where].filter(Boolean).join(' · ') || coords({ lat: r.latitude, lon: r.longitude }) })),
          saved ? h('span.wx-result__tag', { text: 'Saved' })
            : fin(r.population) && r.population > 0
              ? h('small.wx-result__pop', { text: `pop. ${r.population >= 1e6 ? `${(r.population / 1e6).toFixed(1)}M` : r.population >= 1e3 ? `${Math.round(r.population / 1e3)}K` : r.population}` })
              : null,
        ];
        if (!fresh) {
          /* another query's places: visible while the new one loads, never choosable */
          results.appendChild(h('div.wx-result.is-stale', { 'aria-hidden': 'true' }, ...kids));
          return;
        }
        const opt = h('div.wx-result', {
          id: `${uid}-r${i}`, role: 'option', 'aria-selected': i === S.active ? 'true' : 'false',
          onpointerdown: e => e.preventDefault(),        /* keep the caret in the field */
          onclick: () => pick(r),
          onpointerenter: () => { S.active = i; for (const el of results.querySelectorAll('.wx-result')) el.setAttribute('aria-selected', el === opt ? 'true' : 'false'); },
        }, ...kids);
        results.appendChild(opt);
      });
      if (fresh && S.active >= 0 && hits) {
        input.setAttribute('aria-activedescendant', `${uid}-r${S.active}`);
        results.querySelector(`#${uid}-r${S.active}`)?.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
      if (hits) results.appendChild(h('div.wx-results__hint', { text: '↑ ↓ to choose · Enter to add · Esc to close' }));
    }

    function paintUndo() {
      const had = undoBar.contains(document.activeElement);
      undoBar.hidden = !undo;
      undoText.textContent = undo ? `Removed ${short(undo.place)}` : '';
      if (!undo && had) (placesBox.querySelector('.wx-place.is-on') || input).focus();
    }

    let dragKey = null;
    function paintPlaces() {
      const list = S.places;
      editBtn.hidden = !list.length;
      editBtn.textContent = S.edit ? 'Done' : 'Edit';
      editBtn.setAttribute('aria-pressed', S.edit ? 'true' : 'false');
      placesHead.hidden = !list.length;
      side.classList.toggle('is-editing', S.edit);
      api.clear(placesBox);
      placesNote.textContent = !list.length ? 'No saved places yet. Search for a city or use your location.'
        : !S.edit && list.length > 1 ? `Drag or ${fmt.isMac ? '⌥' : 'Alt+'}↑↓ to reorder · ${fmt.isMac ? '⌘⌫' : 'Del'} removes · right-click for more` : '';
      placesNote.hidden = !placesNote.textContent;
      placesNote.classList.toggle('is-empty', !list.length);
      placesBox.hidden = !list.length;
      if (!list.length) return;
      list.forEach((p, i) => {
        const key = keyOf(p);
        const name = short(p);
        const m = S.minis.get(key);
        const showMini = m && m.unit === unit() && Date.now() - m.at < LIVE && fin(m.temp);
        const c = showMini ? cond(m.code, m.day) : null;
        const on = key === S.cur;
        const item = h('button.side__item.wx-place', {
          type: 'button', dataset: { key },
          'aria-current': on ? 'true' : null,
          'aria-label': `${name}${p.here ? ' (your location)' : ''}${showMini ? `, ${deg(m.temp)} ${c.label}` : ''}`,
          'aria-keyshortcuts': `Delete ${fmt.isMac ? 'Meta+Backspace' : 'Control+Backspace'} Alt+ArrowUp Alt+ArrowDown`,
          title: `${p.name}${showMini ? ` · ${deg(m.temp)} ${c.label} · as of ${myClock(m.at)}` : ''}`,
          draggable: 'true',
          onclick: () => select(key),
          onkeydown: e => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); movePlace(key, e.key === 'ArrowUp' ? -1 : 1); return; }
            if (!e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
              e.preventDefault();
              const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
              const next = list[(i + step + list.length) % list.length];
              select(keyOf(next), { focus: true });
              return;
            }
            /* Delete, or ⌘/Ctrl+Backspace as in Finder — a stray Backspace alone does nothing */
            if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); removePlace(key); }
          },
          oncontextmenu: e => { e.preventDefault(); placeMenu(key, e.clientX, e.clientY); },
          ondragstart: e => { dragKey = key; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.name); } catch (err) {} item.classList.add('is-drag'); },
          ondragend: () => { dragKey = null; item.classList.remove('is-drag'); placesBox.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over')); },
          ondragover: e => { if (dragKey && dragKey !== key) { e.preventDefault(); item.classList.add('is-over'); } },
          ondragleave: () => item.classList.remove('is-over'),
          ondrop: e => {
            e.preventDefault();
            item.classList.remove('is-over');
            if (!dragKey || dragKey === key) return;
            const from = S.places.findIndex(x => keyOf(x) === dragKey);
            const next = [...S.places];
            const [moved] = next.splice(from, 1);
            next.splice(next.findIndex(x => keyOf(x) === key) + (from < i ? 1 : 0), 0, moved);
            savePlaces(next);
            paintPlaces();
          },
        },
          c ? glyph(c.fam, c.day) : glyph('pin', true, 'wx-g--dim'),
          h('span.wx-place__n', { text: name }),
          p.here ? h('span.wx-place__here', { title: 'Your location', 'aria-hidden': 'true' }, glyph('pin')) : null,
          showMini ? h('small.wx-place__t', { text: deg(m.temp) }) : null);
        if (on) item.classList.add('is-on');
        const tools = S.edit ? h('div.wx-place__tools',
          h('button.ibtn', { type: 'button', 'aria-label': `Move ${name} up`, disabled: i === 0, onclick: () => movePlace(key, -1) }, icon('arrow-up', 'wx-v'), icon('arrow-left', 'wx-h')),
          h('button.ibtn', { type: 'button', 'aria-label': `Move ${name} down`, disabled: i === list.length - 1, onclick: () => movePlace(key, 1) }, icon('arrow-down', 'wx-v'), icon('arrow-right', 'wx-h')),
          h('button.ibtn.wx-del', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => removePlace(key) }, icon('trash'))) : null;
        placesBox.appendChild(h('div.wx-place__row', { role: 'listitem' }, item, tools));
      });
    }

    function placeMenu(key, x, y) {
      const i = S.places.findIndex(p => keyOf(p) === key);
      api.menu([
        { label: 'Show forecast', icon: 'cloud-sun', onClick: () => select(key) },
        '-',
        { label: 'Move up', icon: 'arrow-up', disabled: i <= 0, onClick: () => movePlace(key, -1) },
        { label: 'Move down', icon: 'arrow-down', disabled: i >= S.places.length - 1, onClick: () => movePlace(key, 1) },
        '-',
        { label: 'Remove', icon: 'trash', danger: true, hint: fmt.isMac ? '⌘⌫' : 'Del', onClick: () => removePlace(key) },
      ], x, y);
    }

    /* ---------------- main ---------------- */
    function paintBusy() {
      refreshBtn.classList.toggle('is-busy', S.busy);
      refreshBtn.setAttribute('aria-busy', S.busy ? 'true' : 'false');
      scroll.setAttribute('aria-busy', S.busy ? 'true' : 'false');
      refreshBtn.disabled = !curPlace();
    }

    const shown = () => (S.data && S.data.key === S.cur && curPlace() ? S.data : null);

    function paintChrome() {
      const p = curPlace(), d = shown();
      let sky = 'none';
      if (d) {
        const { m } = derive(d);
        if (m) sky = cond(m.code, m.day).sky;
      }
      win.setTitle(p ? short(p) : 'Weather');
      paintSubtitle();
      app.dataset.sky = sky;
      host.classList.toggle('wx--still', reduced());
    }
    /* the title bar says what the hero says — and how old it is, once it is not a live reading */
    let lastSub = null;
    function paintSubtitle() {
      const d = shown();
      let s = '';
      if (d) {
        const { m, live: isNow } = derive(d);
        if (m) {
          const label = cond(m.code, m.day).label;
          s = isNow ? (fin(m.t) ? `${deg(m.t)} · ${label}` : label)
            : `Forecast ${fin(m.t) ? `${deg(m.t)} ` : ''}· updated ${ago(d.at)}`;
        } else s = `Forecast ran out · updated ${ago(d.at)}`;
      }
      if (s !== lastSub) { lastSub = s; win.setSubtitle(s); }
    }

    /* keep focus and the hourly strip's scroll across a repaint */
    function paintMain() {
      const fk = document.activeElement?.closest?.('[data-fk]');
      const fkey = fk && scroll.contains(fk) ? fk.dataset.fk : null;
      const sl = scroll.querySelector('.wx-hours__scroll')?.scrollLeft || 0;
      api.render(scroll, ...viewNodes());
      const strip = scroll.querySelector('.wx-hours__scroll');
      if (strip) strip.scrollLeft = sl;
      if (fkey) scroll.querySelector(`[data-fk="${fkey}"]`)?.focus({ preventScroll: true });
    }

    function viewNodes() {
      const p = curPlace();
      if (!p) return [welcome()];
      const d = shown();
      if (!d) return [S.error && !S.busy ? failed(p) : loading(p)];
      const v = derive(d);
      S.hourKey = `${v.now.hourIso}|${v.live}`;
      if (!v.m) return [ranOut(p, d)];
      return [banner(d, v), hero(p, d, v), hoursCard(d, v), h('div.wx-split', weekCard(d, v), details(d, v)), footer(d)];
    }

    /** What the page describes as "now": the latest reading while it is live,
        otherwise the saved forecast for the current hour (null if it has none). */
    function derive(d) {
      const fc = d.fc, u = unitsOf(fc), now = placeNow(fc.utc_offset_seconds);
      const H = fc.hourly, c = fc.current || {};
      let hi = H.time.indexOf(now.hourIso);
      if (hi < 0 && H.time.length && now.hourIso < H.time[0]) hi = 0;
      const di = fc.daily.time.indexOf(now.dateIso);
      const liveNow = isLive(d);
      let m = null;
      /* a live reply with no temperature in it: this hour's forecast (labelled) says more than a dash */
      if (liveNow && (fin(c.temperature_2m) || hi < 0)) {
        /* the hour the reading belongs to, for the values only the hourly series has (UV, visibility) */
        const ri = H.time.indexOf(`${String(c.time || '').slice(0, 13)}:00`);
        m = { live: true, si: ri >= 0 ? ri : hi, t: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, day: c.is_day,
          rh: c.relative_humidity_2m, dew: c.dew_point_2m, wind: c.wind_speed_10m, dir: c.wind_direction_10m, gust: c.wind_gusts_10m,
          cloud: c.cloud_cover, pres: c.pressure_msl, precip: c.precipitation, interval: c.interval };
      } else if (hi >= 0) {
        const g = k => H[k]?.[hi];
        m = { live: false, si: hi, iso: H.time[hi], t: g('temperature_2m'), feels: g('apparent_temperature'), code: g('weather_code'), day: g('is_day'),
          rh: g('relative_humidity_2m'), dew: g('dew_point_2m'), wind: g('wind_speed_10m'), dir: g('wind_direction_10m'), gust: g('wind_gusts_10m'),
          cloud: g('cloud_cover'), pres: g('pressure_msl') };
      }
      if (m) { m.uv = H.uv_index?.[m.si]; m.vis = H.visibility?.[m.si]; }
      return { fc, u, now, hi, di, live: liveNow, m };
    }

    function welcome() {
      return h('div.wx-state.wx-welcome',
        glyph('partly', true, 'wx-g--hero'),
        h('h2', { text: 'Choose a place' }),
        h('p', { text: 'Search for a city, or let the browser share your location. Forecasts come from Open-Meteo, a free weather service.' }),
        h('div.wx-state__row',
          h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'w-search' }, onclick: () => input.focus() }, icon('search'), 'Search for a city'),
          h('button.btn', { type: 'button', dataset: { fk: 'w-geo' }, onclick: locate }, glyph('pin'), S.geoBusy ? 'Finding you…' : 'Use my location')),
        S.geoErr ? h('p.wx-state__warn', { text: S.geoErr }) : null,
        footer(null));
    }

    function loading(p) {
      return h('div.wx-state',
        icon('refresh', 'wx-spin wx-state__spin'),
        h('h2', { text: short(p) }),
        h('p', { text: 'Getting the forecast from Open-Meteo…' }));
    }

    function failed(p) {
      const e = S.error;
      return h('div.wx-state.wx-state--err',
        icon(e.icon),
        h('h2', { text: e.title }),
        h('p', { text: e.detail }),
        h('p.wx-state__sub', { text: `No saved forecast for ${short(p)} on this computer yet, so there is nothing to show until it can be fetched.` }),
        h('div.wx-state__row',
          h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'retry' }, onclick: () => refresh(true) }, icon('refresh'), 'Try again')),
        footer(null));
    }

    /** The saved forecast no longer reaches the present: say so rather than draw old numbers. */
    function ranOut(p, d) {
      const T = d.fc.daily.time;
      const last = T.length ? isoDay(T[T.length - 1]) : null;
      return h('div.wx-state.wx-state--err',
        icon('clock'),
        h('h2', { text: 'The saved forecast has run out' }),
        h('p', { text: `The forecast for ${short(p)} was fetched ${stamp(d.at)}${last ? ` and only went up to ${fmt.dayName(last)}, ${fmt.monthName(last, true)} ${last.getDate()}` : ''}.` }),
        h('p.wx-state__sub', { text: S.busy ? 'Getting a new one from Open-Meteo…' : S.error ? `${S.error.title}. ${S.error.detail}` : 'Weather fetches a new one as soon as Open-Meteo can be reached.' }),
        h('div.wx-state__row',
          h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'retry' }, disabled: S.busy, onclick: () => refresh(true) }, icon('refresh'), S.busy ? 'Trying…' : 'Try again')),
        footer(null));
    }

    function banner(d, v) {
      const rows = [];
      const saved = `the forecast saved ${ago(d.at)} (${stamp(d.at)})`;
      if (S.error) {
        rows.push(h('div.wx-banner', { role: 'status' },
          icon(S.error.icon),
          h('div.grow', h('b', { text: S.error.kind === 'offline' ? 'You’re offline' : S.error.title }),
            h('span', { text: ` — showing ${saved}.` })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'b-retry' }, onclick: () => refresh(true), disabled: S.busy }, S.busy ? 'Trying…' : 'Try again')));
      } else if (S.offline) {
        rows.push(h('div.wx-banner', { role: 'status' }, icon('wifi-off'),
          h('div.grow', h('b', { text: 'You’re offline' }), h('span', { text: ` — showing ${saved}.` }))));
      }
      if (d.unit !== unit() && !S.busy) {
        rows.push(h('div.wx-banner.wx-banner--info', icon('thermometer'),
          h('div.grow', { text: `This saved forecast is in °${d.unit}. It switches to °${unit()} as soon as Open-Meteo can be reached.` })));
      }
      return rows.length ? h('div.wx-banners', rows) : null;
    }

    function hero(p, d, v) {
      const { fc, u, di, m } = v;
      const k = cond(m.code, m.day);
      const [name, region] = splitName(p);
      const D = fc.daily;
      const offMine = -new Date().getTimezoneOffset() * 60;
      const otherZone = fin(fc.utc_offset_seconds) && fc.utc_offset_seconds !== offMine;
      const unitName = u.t === 'F' ? 'Fahrenheit' : 'Celsius';
      const tOk = fin(m.t);
      return h('section.wx-hero', { 'aria-label': `${m.live ? 'Now' : 'Forecast for now'} in ${name}` },
        h('div.wx-hero__text',
          h('div.wx-hero__place',
            p.here ? h('span.wx-hero__here', { title: 'Your location' }, glyph('pin')) : null,
            h('h2', { text: name })),
          h('div.wx-hero__region', { text: p.here && p.name === 'Your location' ? coords(p) : region || coords(p) }),
          /* not a live reading: the number below is the saved forecast for this hour, and says so */
          m.live ? null : h('div.wx-hero__when', icon('clock'), h('span', { text: `Forecast for ${hourName(m.iso)}` })),
          h('div.wx-hero__temp',
            h('span', { 'aria-hidden': 'true', text: tOk ? String(Math.round(m.t) || 0) : '—' }),
            h('sup', { 'aria-hidden': 'true', text: `°${u.t}` }),
            h('span.sr', { text: tOk ? `${Math.round(m.t) || 0} degrees ${unitName}` : 'No temperature reading' })),
          h('div.wx-hero__cond', { text: k.label }),
          h('div.wx-hero__hl',
            di >= 0 ? h('span', { text: `H ${deg(D.temperature_2m_max[di])}` }) : null,
            di >= 0 ? h('span', { text: `L ${deg(D.temperature_2m_min[di])}` }) : null,
            m.live || fin(m.feels) ? h('span', { text: `Feels like ${deg(m.feels)}` }) : null)),
        glyph(k.fam, k.day, 'wx-g--hero'),
        h('div.wx-hero__meta',
          h('span.wx-chip', icon('refresh'), h('span', { text: `Updated ${stamp(d.at)} · ` }), h('span', { dataset: { ageAt: String(d.at) }, text: ago(d.at) })),
          otherZone ? h('span.wx-chip', icon('clock'),
            h('span', { dataset: { tzOff: String(fc.utc_offset_seconds) }, text: `Local time ${hm(v.now.hh, v.now.mm)}` }),
            fc.timezone_abbreviation ? h('span.wx-chip__dim', { text: ` · ${fc.timezone_abbreviation}` }) : null) : null));
    }

    function hoursCard(d, v) {
      const { fc, u, hi, m } = v;
      const H = fc.hourly;
      if (hi < 0) return null;
      const end = Math.min(H.time.length, hi + HOURS);
      const cols = [];
      for (let i = hi; i < end; i++) cols.push({ kind: 'hour', iso: H.time[i], t: H.temperature_2m[i], code: H.weather_code[i], day: H.is_day[i], pop: H.precipitation_probability?.[i], first: i === hi });
      if (!cols.length) return null;
      /* sunrise and sunset inside the window, as their own columns */
      const endIso = H.time[end] || `${cols[cols.length - 1].iso.slice(0, 11)}23:59`;
      const events = [];
      (fc.daily.time || []).forEach((_, i) => {
        for (const [kind, iso] of [['rise', fc.daily.sunrise?.[i]], ['set', fc.daily.sunset?.[i]]]) {
          if (iso && iso > v.now.iso && iso < endIso) events.push({ kind, iso });
        }
      });
      events.sort((a, b) => (a.iso < b.iso ? -1 : 1)).forEach(ev => {
        let at = 0;
        cols.forEach((c, j) => { if (c.iso <= ev.iso) at = j; });
        cols.splice(at + 1, 0, ev);
      });

      /* "Now" is exactly what the hero shows: the live reading, or this hour's forecast */
      const c0 = cols[0];
      if (m.live) { c0.t = fin(m.t) ? m.t : c0.t; c0.code = m.code ?? c0.code; c0.day = m.day ?? c0.day; }
      const temps = cols.filter(c => c.kind === 'hour' && fin(c.t)).map(c => c.t);
      const tMin = Math.min(...temps), tMax = Math.max(...temps);
      const CH = 38, W = cols.length * COL_W;
      const y = t => 6 + (1 - (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin))) * (CH - 12);
      const pts = [];
      cols.forEach((c, j) => { if (c.kind === 'hour' && fin(c.t)) pts.push([j * COL_W + COL_W / 2, y(c.t), c.t]); });
      const gradId = `${uid}-tg${++gid}`, fadeId = `${uid}-tf${gid}`;
      const curve = pts.length < 2 ? null : svgEl('svg', { class: 'wx-curve', width: String(W), height: String(CH), viewBox: `0 0 ${W} ${CH}`, 'aria-hidden': 'true' },
        svgEl('defs', null,
          svgEl('linearGradient', { id: gradId, x1: '0', x2: String(W), y1: '0', y2: '0', gradientUnits: 'userSpaceOnUse' },
            pts.map(pt => svgEl('stop', { offset: String(pt[0] / W), 'stop-color': tColor(toC(pt[2], u)) }))),
          svgEl('linearGradient', { id: `${fadeId}-g`, x1: '0', x2: '0', y1: '0', y2: '1' },
            svgEl('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '1' }),
            svgEl('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' })),
          svgEl('mask', { id: fadeId, maskContentUnits: 'objectBoundingBox' },
            svgEl('rect', { x: '0', y: '0', width: '1', height: '1', fill: `url(#${fadeId}-g)` }))),
        svgEl('path', { d: `${smooth(pts)} L${pts[pts.length - 1][0]} ${CH} L${pts[0][0]} ${CH} Z`, fill: `url(#${gradId})`, mask: `url(#${fadeId})`, class: 'wx-curve__area' }),
        svgEl('path', { d: smooth(pts), stroke: `url(#${gradId})`, class: 'wx-curve__line' }),
        svgEl('circle', { cx: String(pts[0][0]), cy: String(pts[0][1]), r: '3.5', class: 'wx-curve__now', fill: tColor(toC(pts[0][2], u)) }));

      const nHours = cols.filter(c => c.kind === 'hour').length;
      const track = h('div.wx-hours__track', { role: 'list', style: { width: `${W}px` } },
        cols.map(c => {
          if (c.kind !== 'hour') {
            const label = c.kind === 'rise' ? 'Sunrise' : 'Sunset';
            return h('div.wx-hour.wx-hour--sun', { role: 'listitem', 'aria-label': `${label} ${isoHM(c.iso)}` },
              h('span.wx-hour__time', { text: isoHM(c.iso).replace(/ (AM|PM)$/, '') }),
              glyph(c.kind),
              h('span.wx-hour__sun', { text: label }),
              h('span.wx-hour__gap'),
              h('span.wx-hour__pop'));
          }
          const k = cond(c.code, c.day);
          const pop = fin(c.pop) ? c.pop : null;
          const when = c.first ? (m.live ? 'Now' : `Now (forecast for ${hourName(c.iso)})`) : isoHour(c.iso);
          return h(`div.wx-hour${c.first ? '.is-now' : ''}`, {
            role: 'listitem',
            'aria-label': `${when}: ${deg(c.t)}, ${k.label}${pop !== null ? `, ${pop}% chance of precipitation` : ''}`,
          },
            h('span.wx-hour__time', { text: c.first ? 'Now' : isoHour(c.iso) }),
            glyph(k.fam, k.day),
            h('b.wx-hour__t', { text: deg(c.t) }),
            h('span.wx-hour__gap'),
            h(`span.wx-hour__pop${pop && pop < 20 ? '.is-low' : ''}`, pop ? [h('span.wx-hour__bar', h('i', { style: { height: `${Math.max(10, pop)}%` } })), h('small', { text: `${pop}%` })] : null));
        }),
        curve);
      const stripEl = h('div.wx-hours__scroll', {
        tabindex: '0', dataset: { fk: 'hours' }, 'aria-label': `Next ${nHours} hours, scroll sideways`,
        onwheel: e => {
          const el = e.currentTarget;
          if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
          const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
          const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
          if (atStart || atEnd) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        },
      }, track);
      const nudge = dir => stripEl.scrollBy({ left: dir * Math.max(COL_W * 4, stripEl.clientWidth - COL_W * 2), behavior: reduced() ? 'auto' : 'smooth' });
      const pops = cols.filter(c => c.kind === 'hour' && fin(c.pop)).map(c => c.pop);
      const maxPop = Math.max(0, ...pops);
      const popNote = !pops.length ? '' : maxPop === 0 ? 'No precipitation expected'
        : maxPop < 10 ? 'Little or no precipitation expected' : `Up to ${maxPop}% chance of precipitation`;
      return h('section.wx-sec.wx-hours', { 'aria-label': 'Hourly forecast' },
        h('div.wx-sec__head', icon('clock'), h('h3', { text: nHours === 1 ? 'Next hour' : `Next ${nHours} hours` }),
          popNote ? h('span.wx-sec__note', { text: popNote }) : null,
          h('div.grow'),
          h('button.ibtn', { type: 'button', 'aria-label': 'Earlier hours', onclick: () => nudge(-1) }, icon('chevron-left')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Later hours', onclick: () => nudge(1) }, icon('chevron-right'))),
        stripEl);
    }

    /* open a day's details and bring them into view without scrolling the row itself away */
    function openDay(i, wasOpen) {
      S.openDay = wasOpen ? -1 : i;
      paintMain();
      if (wasOpen) return;
      const row = scroll.querySelector(`[aria-controls="${uid}-d${i}"]`), more = scroll.querySelector(`#${uid}-d${i}`);
      if (!row || !more) return;
      const box = scroll.getBoundingClientRect(), top = row.getBoundingClientRect().top, bottom = more.getBoundingClientRect().bottom;
      const over = bottom - box.bottom + 12;
      if (over > 0) scroll.scrollBy({ top: Math.min(over, Math.max(0, top - box.top - 12)), behavior: reduced() ? 'auto' : 'smooth' });
    }

    function weekCard(d, v) {
      const { fc, u, di, m } = v;
      const D = fc.daily;
      if (di < 0) return null;
      const idx = [];
      for (let i = di; i < D.time.length; i++) if (fin(D.temperature_2m_min[i]) && fin(D.temperature_2m_max[i])) idx.push(i);
      if (!idx.length) return null;
      const lo = Math.min(...idx.map(i => D.temperature_2m_min[i]));
      const hi = Math.max(...idx.map(i => D.temperature_2m_max[i]));
      const range = Math.max(1, hi - lo);
      const pct = t => `${((t - lo) / range) * 100}%`;
      const nowT = m.t;
      const list = h('div.wx-days');
      idx.forEach(i => {
        const k = cond(D.weather_code[i], 1);
        const date = isoDay(D.time[i]);
        const name = i === di ? 'Today' : fmt.dayName(date, true);
        const a = D.temperature_2m_min[i], b = D.temperature_2m_max[i];
        const pop = D.precipitation_probability_max?.[i];
        const open = S.openDay === i;
        const bar = h('span.wx-range', h('i', {
          style: {
            left: pct(a), width: `${Math.max(3, ((b - a) / range) * 100)}%`,
            background: `linear-gradient(90deg, ${tColor(toC(a, u))}, ${tColor(toC(b, u))})`,
          },
        }), i === di && fin(nowT)
          ? h('b.wx-range__now', { title: m.live ? `Now ${deg(nowT)}` : `Forecast for ${hourName(m.iso)}: ${deg(nowT)}`, style: { left: `clamp(0%, ${pct(nowT)}, 100%)` } }) : null);
        const row = h('button.wx-day', {
          type: 'button', dataset: { fk: `day-${D.time[i]}` },
          'aria-expanded': open ? 'true' : 'false', 'aria-controls': `${uid}-d${i}`,
          'aria-label': `${i === di ? 'Today' : fmt.dayName(date)}: ${k.label}, low ${deg(a)}, high ${deg(b)}${fin(pop) ? `, ${pop}% chance of precipitation` : ''}`,
          onclick: () => openDay(i, open),
        },
          h('span.wx-day__n', { text: name }),
          h('span.wx-day__ico', glyph(k.fam, true), fin(pop) && pop >= 10 ? h('small', { text: `${pop}%` }) : null),
          h('span.wx-day__lo', { text: deg(a) }),
          bar,
          h('span.wx-day__hi', { text: deg(b) }),
          icon(open ? 'chevron-up' : 'chevron-down', 'wx-day__chev'));
        list.appendChild(row);
        if (open) {
          const len = fin(isoMs(D.sunset?.[i])) && fin(isoMs(D.sunrise?.[i])) ? (isoMs(D.sunset[i]) - isoMs(D.sunrise[i])) / 60000 : NaN;
          const uv = D.uv_index_max?.[i];
          list.appendChild(h('div.wx-day__more', { id: `${uid}-d${i}`, role: 'region', 'aria-label': `${fmt.dayName(date)} details` },
            h('div.wx-day__date', { text: `${fmt.dayName(date)}, ${fmt.monthName(date)} ${date.getDate()} · ${k.label}` }),
            h('dl',
              h('div', h('dt', { text: 'Sunrise' }), h('dd', { text: D.sunrise?.[i] ? isoHM(D.sunrise[i]) : '—' })),
              h('div', h('dt', { text: 'Sunset' }), h('dd', { text: D.sunset?.[i] ? isoHM(D.sunset[i]) : '—' })),
              h('div', h('dt', { text: 'Daylight' }), h('dd', { text: fin(len) ? span(len) : '—' })),
              h('div', h('dt', { text: 'Precipitation' }), h('dd', { text: `${amount(D.precipitation_sum?.[i], u)}${fin(pop) ? ` · ${pop}%` : ''}` })),
              h('div', h('dt', { text: 'UV max' }), h('dd', { text: fin(uv) ? `${Math.round(uv)} · ${uvLabel(uv)}` : '—' })),
              h('div', h('dt', { text: 'Wind max' }), h('dd', { text: speed(D.wind_speed_10m_max?.[i], u) })))));
        }
      });
      return h('section.wx-sec.wx-week', { 'aria-label': `${idx.length}-day forecast` },
        h('div.wx-sec__head', icon('calendar'), h('h3', { text: `${idx.length}-day forecast` }),
          h('div.grow'), h('span.wx-sec__note', { text: `${deg(lo)} to ${deg(hi)}` })),
        list);
    }

    /* the sun's day as an arc: where it is now, and the elapsed part drawn solid */
    function sunCard(D, di, now) {
      if (di < 0 || !D.sunrise?.[di] || !D.sunset?.[di] || !(isoMs(D.sunset[di]) > isoMs(D.sunrise[di]))) return null;
      const t = isoMs(now.iso);
      const up0 = isoMs(D.sunrise[di]), dn0 = isoMs(D.sunset[di]);
      const after = t > dn0, j = after && D.sunrise?.[di + 1] && D.sunset?.[di + 1] ? di + 1 : di;
      const rise = isoMs(D.sunrise[j]), set = isoMs(D.sunset[j]);
      const up = t >= up0 && t <= dn0;
      const f = up ? (t - up0) / (dn0 - up0) : 0;
      const X = k => 60 - 46 * Math.cos(Math.PI * k), Y = k => 38 - 30 * Math.sin(Math.PI * k);
      const arc = svgEl('svg', { class: 'wx-arc', viewBox: '0 0 120 44', 'aria-hidden': 'true', focusable: 'false' },
        svgEl('path', { d: 'M4 38h112', class: 'wx-arc__horizon' }),
        svgEl('path', { d: 'M14 38A46 30 0 0 1 106 38', class: 'wx-arc__path' }),
        up && f > 0.005 ? svgEl('path', { d: `M14 38A46 30 0 0 1 ${X(f).toFixed(2)} ${Y(f).toFixed(2)}`, class: 'wx-arc__done' }) : null,
        up ? svgEl('circle', { cx: X(f).toFixed(2), cy: Y(f).toFixed(2), r: '4.2', class: 'wx-arc__sun' }) : null);
      const len = (set - rise) / 60000;
      let label, value, sub;
      if (up) { label = 'Sunset'; value = isoHM(D.sunset[di]); sub = `${span((dn0 - t) / 60000)} of daylight left`; }
      else if (!after) { label = 'Sunrise'; value = isoHM(D.sunrise[di]); sub = `${span(len)} of daylight today`; }
      else if (j !== di) { label = 'Sunrise'; value = isoHM(D.sunrise[j]); sub = `Tomorrow · ${span(len)} of daylight`; }
      else { label = 'Sunrise'; value = '—'; sub = `Today’s sunset was ${isoHM(D.sunset[di])}`; }
      return h('section.wx-card.wx-card--wide', { 'aria-label': label, dataset: { card: 'sun' } },
        h('div.wx-card__main',
          h('div.wx-card__k', icon('sun'), h('h4', { text: label })),
          h('div.wx-card__v', { text: value }),
          h('div.wx-card__s', { text: sub })),
        h('div.wx-sun', arc,
          h('div.wx-sun__ends', { 'aria-hidden': 'true' },
            h('span', { text: isoHM(D.sunrise[j]) }), h('span', { text: isoHM(D.sunset[j]) }))));
    }

    function details(d, v) {
      const { fc, u, di, now, m } = v;
      const H = fc.hourly, D = fc.daily;
      const cards = [];
      const card = (key, label, ic, value, sub, visual) => h('section.wx-card', { 'aria-label': label, dataset: { card: key } },
        h('div.wx-card__k', icon(ic), h('h4', { text: label })),
        h('div.wx-card__v', value),
        visual || null,
        sub ? h('div.wx-card__s', { text: sub }) : null);

      /* humidity */
      if (fin(m.rh)) {
        cards.push(card('humidity', 'Humidity', 'droplet', `${Math.round(m.rh)}%`,
          fin(m.dew) ? `Dew point ${deg(m.dew)}` : '',
          h('span.wx-meter', h('i', { style: { width: `${Math.max(0, Math.min(100, m.rh))}%` } }))));
      }
      /* wind */
      if (fin(m.wind)) {
        const dir = m.dir;
        const dial = svgEl('svg', { class: 'wx-dial', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
          svgEl('circle', { cx: '32', cy: '32', r: '27', class: 'wx-dial__ring' }),
          ...[90, 180, 270].map(a => svgEl('path', { d: 'M32 5v5', class: 'wx-dial__tick', transform: `rotate(${a} 32 32)` })),
          fin(dir) ? svgEl('g', { transform: `rotate(${(dir + 180) % 360} 32 32)` },
            svgEl('path', { d: 'M32 14v33', class: 'wx-dial__arrow' }),
            svgEl('path', { d: 'M26.5 20.5 32 14l5.5 6.5', class: 'wx-dial__arrow' }),
            svgEl('circle', { cx: '32', cy: '47', r: '2.6', class: 'wx-dial__tail' })) : null);
        const nLabel = svgEl('text', { x: '32', y: '4.5', class: 'wx-dial__n', 'text-anchor': 'middle', 'dominant-baseline': 'hanging' });
        nLabel.textContent = 'N';
        dial.appendChild(nLabel);
        cards.push(card('wind', 'Wind', 'wind',
          [h('span', { text: String(Math.round(m.wind)) }), h('small', { text: ` ${u.wind}` })],
          [fin(dir) ? `From ${compass(dir)} (${Math.round(dir)}°)` : '', fin(m.gust) ? `gusts ${speed(m.gust, u)}` : ''].filter(Boolean).join(' · '),
          dial));
      }
      /* UV — the forecast for the same hour as everything else here */
      if (fin(m.uv)) {
        const uvMax = di >= 0 ? D.uv_index_max?.[di] : undefined;
        cards.push(card('uv', 'UV index', 'sun', [h('span', { text: String(Math.round(m.uv)) }), h('small', { text: ` ${uvLabel(m.uv)}` })],
          fin(uvMax) ? `Today’s peak ${Math.round(uvMax)} (${uvLabel(uvMax)})` : '',
          h('span.wx-uv', h('i', { style: { left: `${Math.min(100, (m.uv / 11) * 100)}%` } }))));
      }
      /* sun */
      const sun = sunCard(D, di, now);
      if (sun) cards.push(sun);
      /* precipitation: the day's forecast total, and what fell in the last 15 minutes when live */
      if (di >= 0 && fin(D.precipitation_sum?.[di])) {
        const pop = D.precipitation_probability_max?.[di];
        const bits = ['Expected today'];
        if (fin(pop)) bits.push(`${pop}% chance`);
        if (m.live && fin(m.precip) && m.precip > 0) bits.push(`past ${Math.round((m.interval || 900) / 60)} min: ${amount(m.precip, u)}`);
        cards.push(card('precip', 'Precipitation', 'droplet', amount(D.precipitation_sum[di], u), bits.join(' · ')));
      }
      /* pressure, with its trend over the three hours before */
      if (fin(m.pres)) {
        const p0 = H.pressure_msl?.[m.si], p3 = m.si >= 3 ? H.pressure_msl?.[m.si - 3] : undefined;
        let trend = '';
        if (fin(p0) && fin(p3)) {
          const dp = p0 - p3;
          trend = Math.abs(dp) < 0.5 ? 'Steady over the last 3 hours' : `${dp > 0 ? 'Rising' : 'Falling'} over the last 3 hours (${pressureChange(dp, u)})`;
        }
        cards.push(card('pressure', 'Pressure', 'gauge', pressure(m.pres, u), trend || 'At sea level'));
      }
      /* visibility */
      const vis = visibility(m.vis, u);
      if (fin(vis.km)) {
        const q = vis.km >= 20 ? 'Excellent' : vis.km >= 10 ? 'Good' : vis.km >= 4 ? 'Moderate' : vis.km >= 1 ? 'Poor' : 'Very poor';
        cards.push(card('visibility', 'Visibility', 'eye', vis.text, `${q} visibility`));
      }
      /* cloud cover */
      if (fin(m.cloud)) {
        const cc = m.cloud;
        cards.push(card('cloud', 'Cloud cover', 'cloud', `${Math.round(cc)}%`,
          cc < 10 ? 'Clear sky' : cc < 35 ? 'A few clouds' : cc < 65 ? 'Partly covered' : cc < 90 ? 'Mostly covered' : 'Fully covered',
          h('span.wx-meter.wx-meter--cloud', h('i', { style: { width: `${Math.max(0, Math.min(100, cc))}%` } }))));
      }
      if (!cards.length) return null;
      return h('section.wx-details', { 'aria-label': m.live ? 'Current details' : `Forecast details for ${hourName(m.iso)}` },
        h('div.wx-sec__head.wx-sec__head--bare', icon('activity'), h('h3', { text: 'Details' }),
          h('div.grow'), h('span.wx-sec__note', { text: m.live ? `As of ${stamp(d.at)}` : `Forecast for ${hourName(m.iso)}` })),
        h('div.wx-cards', cards));
    }

    function footer(d) {
      const fc = d?.fc;
      return h('footer.wx-foot',
        h('span', 'Weather data by ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener noreferrer', text: 'Open-Meteo.com' })),
        fc && fin(fc.latitude) ? h('span.wx-foot__dim', {
          text: `Model grid point ${coords({ lat: fc.latitude, lon: fc.longitude })}${fin(fc.elevation) ? ` · ${Math.round(fc.elevation)} m above sea level` : ''}`,
        }) : null);
    }

    function paintAll() {
      paintTabs();
      paintChrome();
      paintGeo();
      paintPlaces();
      paintUndo();
      paintResults();
      paintBusy();
      paintMain();
    }

    /* ages and the place's wall clock move without a repaint */
    function paintClocks() {
      for (const el of scroll.querySelectorAll('[data-age-at]')) el.textContent = ago(+el.dataset.ageAt);
      const d = shown();
      if (d) {
        const n = placeNow(d.fc.utc_offset_seconds);
        for (const el of scroll.querySelectorAll('[data-tz-off]')) el.textContent = `Local time ${hm(n.hh, n.mm)}`;
      }
      paintSubtitle();
    }

    /* ---------------- wiring ---------------- */
    S.places = readPlaces();
    const w0 = store.get(WX_PLACE);
    if (validPlace(w0)) {
      keep(w0);
      S.cur = keyOf(w0);
    } else if (S.places.length) {
      S.cur = keyOf(S.places[0]);
      pushToWidget(S.places[0]);
    }
    paintAll();
    if (validPlace(opts?.place)) addPlace(opts.place);
    else if (S.cur) load();
    refreshMinis(false);

    win.onReopen(o => { if (!dead && validPlace(o?.place)) addPlace(o.place); });

    /* the widget (or anything else) picked a place: follow it */
    offs.push(store.sub(WX_PLACE, v => {
      if (dead || !validPlace(v)) return;
      const key = keyOf(v);
      if (key === S.cur) return;
      keep(v);
      S.cur = key; S.openDay = -1; S.error = null; S.geoErr = null; S.geoInfo = null;
      if (S.data?.key !== key) { S.data = null; S.fromCache = false; }
      paintAll();
      load();
    }));
    /* refresh first: it marks the app busy, so the page doesn't flash a "wrong unit" note meanwhile */
    offs.push(store.sub(UNIT, () => { if (dead) return; paintTabs(); refresh(false); refreshMinis(false); paintMain(); }));
    offs.push(store.sub('prefs.h24', () => { if (!dead) { paintMain(); paintSubtitle(); } }));
    offs.push(store.sub('prefs.reduceMotion', () => { if (!dead) paintChrome(); }));

    offs.push(bus.on('tick:5s', () => {
      if (dead) return;
      paintClocks();
      const d = shown();
      if (d) {
        /* a new hour, or the reading turning into history: redraw (focus is kept by paintMain) */
        const v = derive(d);
        if (`${v.now.hourIso}|${v.live}` !== S.hourKey) { paintChrome(); paintMain(); }
      }
      if (document.visibilityState !== 'visible' || S.busy || !curPlace() || navigator.onLine === false) return;
      const stale = !d || d.unit !== unit() || Date.now() - d.at > FRESH;
      if (stale && Date.now() >= nextAuto) refresh(false);
      if (Date.now() - miniAt > FRESH && Date.now() >= miniNext) refreshMinis(false);
    }));

    const onOnline = () => { if (dead) return; S.offline = false; failStreak = 0; nextAuto = 0; refresh(true); refreshMinis(true); };
    const onOffline = () => { if (dead) return; S.offline = true; paintMain(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMq = () => { if (!dead) paintChrome(); };
    mq?.addEventListener?.('change', onMq);

    /* keys: F / C units, R refresh, / search, ↑↓ places, ⌘Z / Ctrl+Z undoes a removal */
    const onKey = e => {
      if (dead || e.defaultPrevented || !win.el.classList.contains('is-active')) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return;
      if (t !== document.body && !win.el.contains(t)) return;
      if (undo && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRemove(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'c') { setUnit(k.toUpperCase()); return; }
      if (k === 'r') { e.preventDefault(); refresh(true); refreshMinis(true); return; }
      if (e.key === '/') { e.preventDefault(); input.focus(); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.places.length > 1
        && (t === document.body || t === win.el || t === scroll)) {
        e.preventDefault();
        const i = S.places.findIndex(p => keyOf(p) === S.cur);
        select(keyOf(S.places[(i + (e.key === 'ArrowDown' ? 1 : -1) + S.places.length) % S.places.length]));
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      dead = true;
      offs.forEach(off => { try { off(); } catch (e) {} });
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      mq?.removeEventListener?.('change', onMq);
      clearTimeout(sTimer); clearTimeout(geoGuard); clearTimeout(infoTimer);
      commitUndo();
      ac?.abort(); sAc?.abort(); miniAc?.abort(); geoAc?.abort();
    };
  },
});
