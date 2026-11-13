/* ============================================================
   deskwidgets.more.js — the desktop widgets that have settings or
   talk to something outside themselves. The frame (moving,
   resizing, removing, the ⚙ that flips a widget to its settings)
   is js/shell/deskwidgets.js; each builder here gets
     (body, w, ctx)   w.cfg — this widget's own saved settings
                      ctx.editing — draw the settings, not the widget
                      ctx.save(patch) / ctx.edit(on) / ctx.rebuild()
   and returns its teardown.

   clock     analog or digital, this computer's time or any IANA
             time zone the browser knows (Intl), with how far ahead
             or behind it is.
   weather   Open-Meteo (keyless): a place found by its geocoding
             search, or this device's position — only after the
             browser's own permission prompt, rounded to about a
             kilometre, and sent nowhere but Open-Meteo. °F/°C is
             prefs.weatherUnit, shared with the Weather app. Every
             failure says what failed; nothing is ever estimated.
   music     Now Playing: whatever Static Music or Static Radio last
             announced on the media bus (media:track), with
             previous / play-pause / next sent back over the bus.
   tasks     To-dos: one of Static Tasks' lists (js/core/tasks.js),
             checked off, added to and reordered right here.
   upnext    Up next: Calendar's coming events (js/core/calendar.js).
   classes   Now and next: what's on in your Static Study timetable, and what
             comes after (js/core/timetable.js).
   countdown Days to (or since) a date you pick, in whole local calendar
             days. It changes at midnight: one timer to the next midnight
             and nothing running every second. No hours are shown.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as CAL from '../core/calendar.js';
import * as TASKS from '../core/tasks.js';
import * as TT from '../core/timetable.js';
import * as HW from '../core/homework.js';

const pad2 = n => String(n).padStart(2, '0');
const h24 = () => !!store.get('prefs.h24');

/* What Music or Radio last said is playing. Listened to from load, so a
   Now Playing widget added later still knows the track. */
let lastTrack = null;
bus.on('media:track', t => { lastTrack = t && typeof t === 'object' ? { ...t } : null; });
export const nowTrack = () => lastTrack;

/* a small segmented control: [[value, label], …] */
function seg(h, items, value, onPick, fk) {
  return h('div.dw-seg', { role: 'radiogroup' }, items.map(([v, label]) => h('button.dw-seg__b', {
    type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'is-on' : null,
    dataset: { fk: `${fk}-${v}` }, onclick: () => onPick(v),
  }, label)));
}
const doneBtn = (h, icon, ctx, fk) => h('button.btn.btn--sm.btn--primary.dw-cfg__done', { type: 'button', dataset: { fk }, onclick: () => ctx.edit(false) }, icon('check'), 'Done');

/* ================================================================
   Clock
   ================================================================ */
const ZONES_FALLBACK = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];
let zoneList = null;
function zones() {
  if (zoneList) return zoneList;
  try { zoneList = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ZONES_FALLBACK; }
  catch (e) { zoneList = ZONES_FALLBACK; }
  if (!zoneList.includes('UTC')) zoneList = [...zoneList, 'UTC'];
  return zoneList;
}
export function validZone(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}
/** "Tokyo", "New York", "UTC" */
export const zoneCity = tz => (tz ? String(tz).split('/').pop().replace(/_/g, ' ') : '');
/** Find a zone from what someone typed: an exact id, or a city ("tokyo", "new york"). */
export function findZone(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (validZone(s) && s.includes('/')) return s;
  const want = s.toLowerCase().replace(/\s+/g, '_');
  const all = zones();
  return all.find(z => z.toLowerCase() === want)
    || all.find(z => z.toLowerCase().split('/').pop() === want)
    || (validZone(s) ? s : null);
}
/** The wall clock in a zone: { h, m, s, wd, date } (the browser's own tz data). */
function wallIn(d, tz) {
  const o = { hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric' };
  if (tz) o.timeZone = tz;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', o).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, m: +p.minute, s: +p.second };
}
/** "3 h ahead", "5 h 30 min behind", "same time as here" */
function offsetText(d, tz) {
  const a = wallIn(d, tz), b = wallIn(d, '');
  const diff = Math.round((Date.UTC(a.y, a.mo - 1, a.d, a.h, a.m) - Date.UTC(b.y, b.mo - 1, b.d, b.h, b.m)) / 60000);
  if (!diff) return 'same time as here';
  const abs = Math.abs(diff), hh = Math.floor(abs / 60), mm = abs % 60;
  return `${hh ? `${hh} h` : ''}${hh && mm ? ' ' : ''}${mm ? `${mm} min` : ''} ${diff > 0 ? 'ahead' : 'behind'}`;
}

const FACE = (() => {
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    ticks += `<line class="dw-an__tick${big ? ' is-big' : ''}" x1="50" y1="${big ? 7.5 : 6}" x2="50" y2="${big ? 13 : 9}" transform="rotate(${i * 6} 50 50)"/>`;
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="dw-an__face" cx="50" cy="50" r="47"/>${ticks}`
    + '<line class="dw-an__h" x1="50" y1="54" x2="50" y2="27"/><line class="dw-an__m" x1="50" y1="56" x2="50" y2="15"/>'
    + '<line class="dw-an__s" x1="50" y1="60" x2="50" y2="11"/><circle class="dw-an__pin" cx="50" cy="50" r="2.6"/></svg>';
})();

export function clock(body, w, ctx) {
  const { h, icon } = api;
  const c = { face: 'digital', tz: '', seconds: false, ...(w.cfg || {}) };
  const tz = validZone(c.tz) ? c.tz : '';

  if (ctx.editing) {
    const list = h('datalist', { id: `dwz-${w.uid}` }, zones().map(z => h('option', { value: z })));
    const msg = h('small.dw-cfg__msg', { role: 'status' });
    const tzIn = h('input.dw-cfg__in', {
      type: 'text', value: tz, placeholder: 'This computer’s time — or a city', list: `dwz-${w.uid}`, spellcheck: 'false',
      'aria-label': 'Time zone', dataset: { fk: 'dwc-tz' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); pickZone(); } },
      onchange: () => pickZone(),
    });
    const pickZone = () => {
      const v = tzIn.value.trim();
      if (!v) { ctx.save({ tz: '' }); msg.textContent = 'Showing this computer’s time.'; return; }
      const z = findZone(v);
      if (!z) { msg.textContent = `No time zone called “${v}”. Try a city like Tokyo or an id like Europe/Paris.`; msg.classList.add('is-bad'); return; }
      msg.classList.remove('is-bad');
      tzIn.value = z;
      ctx.save({ tz: z });
      msg.textContent = `${zoneCity(z)} — ${offsetText(new Date(), z)}.`;
    };
    body.replaceChildren(h('div.dw-cfg',
      h('span.dw-cfg__l', { text: 'Face' }),
      seg(h, [['digital', 'Digital'], ['analog', 'Analog']], c.face, v => { ctx.save({ face: v }); ctx.rebuild(); }, 'dwc-face'),
      h('label.dw-cfg__l', { text: 'Time zone', for: `dwzi-${w.uid}` }),
      h('div.field.dw-cfg__field', icon('globe'), Object.assign(tzIn, { id: `dwzi-${w.uid}` })), list, msg,
      h('div.dw-cfg__row',
        h('span', { text: 'Seconds' }),
        h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!c.seconds), class: c.seconds ? 'is-on' : null,
          'aria-label': 'Show seconds', dataset: { fk: 'dwc-sec' }, onclick: () => { ctx.save({ seconds: !c.seconds }); ctx.rebuild(); } })),
      doneBtn(h, icon, ctx, 'dwc-done')));
    return null;
  }

  const name = tz ? zoneCity(tz) : 'Here';
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(tz ? { timeZone: tz } : {}) });
  const t = h('b.dw-clock__t'); const ap = h('small.dw-clock__ap');
  const d = h('small.dw-clock__d'); const z = h('small.dw-clock__z');
  let hands = null;
  if (c.face === 'analog') {
    const face = h('div.dw-an', { html: FACE, role: 'img' });
    hands = { face, h: face.querySelector('.dw-an__h'), m: face.querySelector('.dw-an__m'), s: face.querySelector('.dw-an__s') };
    if (!c.seconds) hands.s.style.display = 'none';
    body.replaceChildren(h('div.dw-clock.dw-clock--analog', face, h('div.dw-clock__cap', h('b.dw-clock__city', { text: name }), d, z)));
  } else {
    body.replaceChildren(h('div.dw-clock', h('div.dw-clock__row', t, ap), d, z));
  }
  const paint = () => {
    const now = new Date();
    const x = wallIn(now, tz);
    const hh = h24() ? pad2(x.h) : String(x.h % 12 || 12);
    const time = `${hh}:${pad2(x.m)}${c.seconds ? `:${pad2(x.s)}` : ''}`;
    d.textContent = dayFmt.format(now);
    z.textContent = tz ? `${name} · ${offsetText(now, tz)}` : '';
    if (hands) {
      hands.h.setAttribute('transform', `rotate(${(x.h % 12) * 30 + x.m * 0.5} 50 50)`);
      hands.m.setAttribute('transform', `rotate(${x.m * 6 + (c.seconds ? x.s * 0.1 : 0)} 50 50)`);
      hands.s.setAttribute('transform', `rotate(${x.s * 6} 50 50)`);
      hands.face.setAttribute('aria-label', `${name}: ${hh}:${pad2(x.m)}${h24() ? '' : ` ${x.h >= 12 ? 'PM' : 'AM'}`}`);
      d.textContent = `${hh}:${pad2(x.m)}${h24() ? '' : ` ${x.h >= 12 ? 'PM' : 'AM'}`} · ${dayFmt.format(now)}`;
    } else {
      t.textContent = time;
      ap.textContent = h24() ? '' : (x.h >= 12 ? 'PM' : 'AM');
    }
  };
  paint();
  return bus.on('tick:1s', paint);
}

/* ================================================================
   Weather (Open-Meteo)
   ================================================================ */
const WX_CACHE = 'portal.deskWeather';      /* { [uid]: { at, unit, key, cur, days } } */
const WX_FRESH = 20 * 60 * 1000;            /* fetch again after this */
const WX_OLD = 60 * 60 * 1000;              /* past this a reading isn't "now" any more */
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FC = 'https://api.open-meteo.com/v1/forecast';
const WMO = {
  0: ['Clear', 'sun'], 1: ['Mainly clear', 'cloud-sun'], 2: ['Partly cloudy', 'cloud-sun'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud'], 48: ['Freezing fog', 'cloud'],
  51: ['Light drizzle', 'cloud-rain'], 53: ['Drizzle', 'cloud-rain'], 55: ['Heavy drizzle', 'cloud-rain'],
  56: ['Freezing drizzle', 'cloud-rain'], 57: ['Freezing drizzle', 'cloud-rain'],
  61: ['Light rain', 'cloud-rain'], 63: ['Rain', 'cloud-rain'], 65: ['Heavy rain', 'cloud-rain'],
  66: ['Freezing rain', 'cloud-rain'], 67: ['Freezing rain', 'cloud-rain'],
  71: ['Light snow', 'cloud-snow'], 73: ['Snow', 'cloud-snow'], 75: ['Heavy snow', 'cloud-snow'], 77: ['Snow grains', 'cloud-snow'],
  80: ['Showers', 'cloud-rain'], 81: ['Showers', 'cloud-rain'], 82: ['Violent showers', 'cloud-rain'],
  85: ['Snow showers', 'cloud-snow'], 86: ['Snow showers', 'cloud-snow'],
  95: ['Thunderstorm', 'cloud-rain'], 96: ['Thunderstorm, hail', 'cloud-rain'], 99: ['Thunderstorm, hail', 'cloud-rain'],
};
const wmo = (code, day = true) => {
  const w = WMO[code];
  if (!w) return [Number.isFinite(code) ? `Weather code ${code}` : 'No reading', 'cloud'];
  return [w[0], !day && w[1] === 'sun' ? 'moon' : w[1]];
};
const unit = () => (store.get('prefs.weatherUnit', 'F') === 'C' ? 'C' : 'F');
const placeKey = p => `${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)}`;
const validPlace = p => !!p && typeof p.name === 'string' && p.name.trim() !== '' && Number.isFinite(+p.lat) && Number.isFinite(+p.lon);

async function getJSON(url, ms = 10000) {
  const ac = new AbortController();
  let late = false;
  const t = setTimeout(() => { late = true; ac.abort(); }, ms);
  try {
    const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    let j = null;
    try { j = await res.json(); } catch (e) { if (res.ok) throw Object.assign(new Error('unreadable'), { kind: 'parse' }); }
    if (!res.ok || (j && j.error)) throw Object.assign(new Error(`HTTP ${res.status}`), { kind: 'http', status: res.status, reason: (j && j.reason) || '' });
    return j;
  } catch (e) {
    if (late) throw Object.assign(new Error('timed out'), { kind: 'timeout' });
    if (e.kind) throw e;
    throw Object.assign(new Error('network'), { kind: navigator.onLine === false ? 'offline' : 'network' });
  } finally { clearTimeout(t); }
}
/** What went wrong, in words: { title, short } */
export function wxProblem(e) {
  const k = (e && e.kind) || (navigator.onLine === false ? 'offline' : 'network');
  if (k === 'offline') return { title: 'You’re offline', short: 'Offline — reconnect to update.' };
  if (k === 'timeout') return { title: 'Open-Meteo didn’t answer', short: 'Open-Meteo took too long to answer.' };
  if (k === 'http' && e.status === 429) return { title: 'Open-Meteo’s free limit was reached', short: 'Open-Meteo’s request limit was reached — try later.' };
  if (k === 'http') return { title: `Open-Meteo returned an error (HTTP ${e.status})`, short: `Open-Meteo error (HTTP ${e.status}).` };
  if (k === 'parse') return { title: 'Open-Meteo sent something unreadable', short: 'Open-Meteo sent an unreadable reply.' };
  return { title: 'Can’t reach Open-Meteo', short: 'Couldn’t reach Open-Meteo — this network may block it.' };
}
const cacheOf = uid => { const all = store.get(WX_CACHE, {}) || {}; return all[uid] || null; };
const setCache = (uid, v) => {
  const all = { ...(store.get(WX_CACHE, {}) || {}) };
  if (v) all[uid] = v; else delete all[uid];
  store.set(WX_CACHE, all);
};
export const dropWeather = uid => { if (cacheOf(uid)) setCache(uid, null); };

export function weather(body, w, ctx) {
  const { h, icon, fmt } = api;
  const place = validPlace(w.cfg && w.cfg.place) ? w.cfg.place : null;
  let dead = false;
  let busy = false;
  let err = null;              /* the last failure, as wxProblem() words */

  /* ---------- choosing a place (first run, or ⚙) ---------- */
  if (ctx.editing || !place) {
    const results = h('div.dw-wx__hits', { role: 'list' });
    const msg = h('small.dw-cfg__msg', { role: 'status' });
    const say = (text, bad) => { msg.textContent = text; msg.classList.toggle('is-bad', !!bad); };
    const q = h('input.dw-cfg__in', { type: 'text', placeholder: 'City or town', spellcheck: 'false', 'aria-label': 'Find a place', dataset: { fk: 'dww-q' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); search(); } } });
    const choose = p => {
      ctx.save({ place: { name: p.name, lat: +(+p.lat).toFixed(4), lon: +(+p.lon).toFixed(4), ...(p.here ? { here: true } : {}) } });
      dropWeather(w.uid);
      ctx.edit(false);
    };
    async function search() {
      const term = q.value.trim();
      if (!term || busy) return;
      busy = true; say('Looking…'); results.replaceChildren();
      try {
        const j = await getJSON(`${GEO}?name=${encodeURIComponent(term)}&count=5&language=en&format=json`);
        if (dead) return;
        const hits = (j && Array.isArray(j.results) ? j.results : []).filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
        if (!hits.length) { say(`No place called “${term}” — check the spelling, or try a bigger town nearby.`, true); return; }
        say(`${hits.length} place${hits.length === 1 ? '' : 's'} found — pick one.`);
        results.replaceChildren(...hits.map((r, i) => {
          const name = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ');
          return h('button.dw-wx__hit', { type: 'button', role: 'listitem', dataset: { fk: `dww-hit-${i}` },
            onclick: () => choose({ name, lat: r.latitude, lon: r.longitude }) },
            icon('map-pin'), h('span', h('b', { text: r.name }), h('small', { text: [r.admin1, r.country].filter(Boolean).join(', ') })));
        }));
      } catch (e) {
        if (!dead) say(`Couldn’t search: ${wxProblem(e).short}`, true);
      } finally { busy = false; }
    }
    let geoGuard = 0;
    function locate() {
      if (!navigator.geolocation) { say('This browser can’t share a location. Search for a city instead.', true); return; }
      say('Asking the browser for your location…');
      const ticket = {};
      locate.t = ticket;
      clearTimeout(geoGuard);
      geoGuard = setTimeout(() => {
        if (dead || locate.t !== ticket) return;
        locate.t = null;
        say('The browser hasn’t answered. Look for a permission prompt by the address bar, or search for a city.', true);
      }, 30000);
      navigator.geolocation.getCurrentPosition(pos => {
        if (dead || locate.t !== ticket) return;
        clearTimeout(geoGuard);
        /* about a kilometre is plenty for a forecast, and all that leaves this computer */
        choose({ name: 'Your location', lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2), here: true });
      }, e => {
        if (dead || locate.t !== ticket) return;
        clearTimeout(geoGuard);
        say(e && e.code === 1 ? 'Location is blocked for this site. Allow it in the browser’s site settings, or search for a city.'
          : e && e.code === 3 ? 'Finding your location took too long. Try again, or search for a city.'
          : 'This device couldn’t work out where it is. Search for a city instead.', true);
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
    }
    const shared = store.get('prefs.wxPlace', null);
    body.replaceChildren(h('div.dw-cfg.dw-wx__setup',
      h('span.dw-cfg__l', { text: place ? `Showing ${place.name}` : 'Where should the forecast be for?' }),
      h('div.dw-cfg__pair',
        h('div.field.dw-cfg__field', icon('search'), q),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'dww-find' }, onclick: search }, 'Find')),
      h('button.btn.btn--sm.dw-wx__here', { type: 'button', dataset: { fk: 'dww-here' }, onclick: locate }, icon('compass'), 'Use my location'),
      validPlace(shared) && (!place || placeKey(shared) !== placeKey(place))
        ? h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'dww-shared' }, onclick: () => choose(shared) }, icon('cloud-sun'), `${shared.name} (from Weather)`) : null,
      msg, results,
      ctx.editing ? h('div.dw-cfg__row', h('span', { text: 'Units' }),
        seg(h, [['F', '°F'], ['C', '°C']], unit(), v => { store.set('prefs.weatherUnit', v); ctx.rebuild(); }, 'dww-unit')) : null,
      ctx.editing && place ? doneBtn(h, icon, ctx, 'dww-done') : null,
      h('small.dw-wx__by', { text: 'Weather data by Open-Meteo.com. Your location is only used if you press “Use my location” and the browser allows it.' })));
    requestAnimationFrame(() => { if (!dead && !place) q.focus({ preventScroll: true }); });
    return () => { dead = true; clearTimeout(geoGuard); };
  }

  /* ---------- the forecast ---------- */
  const fresh = c => c && c.key === placeKey(place) && c.unit === unit() && Date.now() - c.at < WX_FRESH;
  async function load(force) {
    const c = cacheOf(w.uid);
    if (busy || (!force && fresh(c))) return;
    busy = true; err = null; paint();
    const u = unit();
    try {
      const j = await getJSON(`${FC}?latitude=${(+place.lat).toFixed(4)}&longitude=${(+place.lon).toFixed(4)}`
        + '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto'
        + (u === 'C' ? '&temperature_unit=celsius&wind_speed_unit=kmh' : '&temperature_unit=fahrenheit&wind_speed_unit=mph'));
      const cur = j && j.current;
      if (!cur || !Number.isFinite(cur.temperature_2m)) throw Object.assign(new Error('no current reading'), { kind: 'parse' });
      const dd = (j.daily && Array.isArray(j.daily.time)) ? j.daily : { time: [] };
      setCache(w.uid, {
        at: Date.now(), unit: u, key: placeKey(place),
        cur: { temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, day: cur.is_day !== 0, wind: cur.wind_speed_10m, hum: cur.relative_humidity_2m },
        days: dd.time.map((iso, i) => ({ iso, code: dd.weather_code?.[i], hi: dd.temperature_2m_max?.[i], lo: dd.temperature_2m_min?.[i] }))
          .filter(x => Number.isFinite(x.hi) && Number.isFinite(x.lo)),
        /* Open-Meteo writes miles per hour as "mp/h" */
        windUnit: String((j.current_units && j.current_units.wind_speed_10m) || (u === 'C' ? 'km/h' : 'mph')).replace('mp/h', 'mph'),
      });
    } catch (e) {
      err = wxProblem(e);
    } finally {
      busy = false;
      if (!dead) paint();
    }
  }
  const deg = v => (Number.isFinite(v) ? `${Math.round(v)}°` : '—');
  function paint() {
    if (dead) return;
    const c = cacheOf(w.uid);
    const usable = c && c.key === placeKey(place) && c.cur;
    if (!usable) {
      if (busy) { body.replaceChildren(h('div.dw-empty', { text: `Getting the forecast for ${place.name}…` })); return; }
      body.replaceChildren(h('div.dw-wx__err', { role: 'alert' },
        icon('wifi-off'), h('b', { text: err ? err.title : 'No forecast yet' }),
        h('small', { text: err ? `Nothing is shown for ${place.name} until Open-Meteo answers.` : `For ${place.name}.` })),
        h('div.row.dw-cta', { style: { gap: '6px' } },
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'dww-retry' }, onclick: () => load(true) }, icon('refresh'), 'Try again'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => ctx.edit(true) }, 'Change place')));
      return;
    }
    const [label, ic] = wmo(c.cur.code, c.cur.day);
    const today = c.days[0];
    const old = Date.now() - c.at > WX_OLD;
    const wrongUnit = c.unit !== unit();
    const when = new Date(c.at);
    const stamp = `${fmt.fmtClock(when, h24()).time}${h24() ? '' : ` ${fmt.fmtClock(when, false).ap}`}`;
    const dayName = iso => { const d = new Date(`${iso}T12:00:00`); return d.toLocaleDateString(undefined, { weekday: 'short' }); };
    body.replaceChildren(
      h('button.dw-wx', { type: 'button', 'aria-label': `${place.name}: ${deg(c.cur.temp)}${c.unit}, ${label}. Open Weather`, onclick: () => api.openApp('weather') },
        h('span.dw-wx__ic', icon(ic)),
        h('span.dw-wx__now',
          h('b.dw-wx__t', { dataset: { fk: 'dww-temp' }, text: `${deg(c.cur.temp)}${c.unit}` }),
          h('small.dw-wx__c', { text: label })),
        h('span.dw-wx__side',
          h('small.dw-wx__place', { text: place.name }),
          today ? h('small', { text: `H ${deg(today.hi)}  L ${deg(today.lo)}` }) : null,
          h('small', { text: `Feels ${deg(c.cur.feels)} · ${Number.isFinite(c.cur.wind) ? `${Math.round(c.cur.wind)} ${c.windUnit}` : '—'}` }))),
      c.days.length > 1 ? h('div.dw-wx__days', c.days.slice(1, 4).map(x => h('div.dw-wx__day',
        h('small', { text: dayName(x.iso) }), icon(wmo(x.code)[1]), h('b', { text: deg(x.hi) }), h('small', { text: deg(x.lo) })))) : null,
      h('div.dw-wx__foot', { class: old || err || wrongUnit ? 'is-warn' : null },
        h('small', { dataset: { fk: 'dww-foot' }, text: busy ? 'Updating…'
          : err ? `${err.short} Showing ${stamp}.` : wrongUnit ? `In °${c.unit} until it updates.` : old ? `Updated ${stamp} — that’s a while ago.` : `Updated ${stamp} · Open-Meteo` }),
        h('button.dw-wx__re', { type: 'button', 'aria-label': 'Update the forecast now', dataset: { fk: 'dww-refresh' }, disabled: busy, onclick: () => load(true) }, icon('refresh'))));
  }
  paint();
  load(false);
  let n = 0;
  const offTick = bus.on('tick:5s', () => {
    if (++n % 12 || document.visibilityState === 'hidden') return;     /* a check a minute, while it can be seen */
    load(false);
  });
  const offUnit = store.sub('prefs.weatherUnit', () => load(true));
  const onOnline = () => load(true);
  window.addEventListener('online', onOnline);
  return () => { dead = true; offTick(); offUnit(); window.removeEventListener('online', onOnline); };
}

/* ================================================================
   Now Playing
   ================================================================ */
export function music(body) {
  const { h, icon, fmt } = api;
  const paint = () => {
    const t = lastTrack;
    if (!t || !t.source) {
      body.replaceChildren(h('div.dw-np__none',
        h('span.dw-music__art', icon('music')),
        h('span.dw-music__t', h('b', { text: 'Nothing playing' }), h('small', { text: 'Play something in Music or Radio.' }))),
        h('div.row.dw-cta', { style: { gap: '6px' } },
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'np-music' }, onclick: () => api.openApp('music') }, icon('music'), 'Music'),
          api.getApp('radio') ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'np-radio' }, onclick: () => api.openApp('radio') }, icon('cast'), 'Radio') : null));
      return;
    }
    const radio = t.source === 'radio' || !!t.live;
    const pct = t.duration ? Math.max(0, Math.min(1, (t.elapsed || 0) / t.duration)) * 100 : 0;
    body.replaceChildren(
      h('div.dw-music',
        h('span.dw-music__art', { class: t.playing ? 'is-playing' : null }, icon(radio ? 'cast' : 'music')),
        h('span.dw-music__t',
          h('b', { dataset: { fk: 'np-title' }, text: t.title || 'Untitled' }),
          h('small', { text: [t.artist, radio ? 'Radio' : 'Music'].filter(Boolean).join(' · ') }))),
      radio
        ? h('div.dw-np__live', h('span.dw-np__dot', { class: t.playing ? 'is-on' : null }), h('small', { text: t.playing ? 'Live' : 'Paused' }))
        : h('div.dw-np__bar', h('small', { text: fmt.fmtDur(t.elapsed || 0) }), h('span.dw-np__track', h('i', { style: { width: `${pct.toFixed(1)}%` } })), h('small', { text: fmt.fmtDur(t.duration || 0) })),
      h('div.dw-music__ctl',
        h('button.ibtn', { type: 'button', 'aria-label': radio ? 'Previous station' : 'Previous track', dataset: { fk: 'np-prev' }, onclick: () => bus.emit('media:prev') }, icon('skip-back')),
        h('button.ibtn.dw-np__play', { type: 'button', 'aria-label': t.playing ? 'Pause' : 'Play', dataset: { fk: 'np-toggle' },
          onclick: () => bus.emit(t.playing ? 'media:pause' : 'media:play') }, icon(t.playing ? 'pause' : 'play', { fill: true })),
        h('button.ibtn', { type: 'button', 'aria-label': radio ? 'Next station' : 'Next track', dataset: { fk: 'np-next' }, onclick: () => bus.emit('media:next') }, icon('skip-forward'))));
  };
  paint();
  /* the elapsed time ticks in every few announcements; repaint at most a few times a second */
  let pending = 0;
  const off = bus.on('media:track', () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; paint(); }); });
  return () => { off(); cancelAnimationFrame(pending); };
}

/* ================================================================
   To-dos (Static Tasks)
   ================================================================ */
export function tasks(body, w, ctx) {
  const { h, icon } = api;
  const cfg = { list: '', ...(w.cfg || {}) };
  const listOf = data => data.lists.find(l => l.id === cfg.list) || data.lists[0] || null;

  if (ctx.editing) {
    const data = TASKS.read();
    const cur = listOf(data);
    body.replaceChildren(h('div.dw-cfg',
      h('label.dw-cfg__l', { text: 'Which list', for: `dwt-${w.uid}` }),
      data.lists.length
        ? h('select.select.dw-cfg__in', { id: `dwt-${w.uid}`, dataset: { fk: 'dwt-list' }, onchange: e => ctx.save({ list: e.target.value }) },
          data.lists.map(l => h('option', { value: l.id, text: `${l.name} (${l.tasks.filter(t => !t.done).length} left)`, selected: cur && l.id === cur.id })))
        : h('small.dw-cfg__msg', { text: 'Static Tasks has no lists yet.' }),
      h('small.dw-cfg__msg', { text: 'These are Static Tasks’ lists — what you do here shows there too.' }),
      doneBtn(h, icon, ctx, 'dwt-done')));
    return null;
  }

  let mine = null;                          /* the object this widget last wrote */
  const save = data => { mine = TASKS.write(data); };
  const addIn = h('input.dw-todo__in', { type: 'text', placeholder: 'Add a to-do', maxlength: String(TASKS.TEXT_MAX), 'aria-label': 'Add a to-do', dataset: { fk: 'todo-add' },
    onkeydown: e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const text = addIn.value.trim();
      if (!text) return;
      const data = TASKS.read();
      let l = listOf(data);
      if (!l) { l = TASKS.normList({ name: 'To-do' }); data.lists.push(l); data.activeId = l.id; ctx.save({ list: l.id }); cfg.list = l.id; }
      l.tasks.push(TASKS.normTask({ text }));
      addIn.value = '';
      save(data);
      paint();
    } });
  const ul = h('ul.dw-todo', { role: 'list', 'aria-label': 'To-dos' });
  const head = h('div.dw-todo__head');
  const wrap = h('div.dw-todo__wrap', head, ul, h('div.field.dw-todo__field', icon('plus'), addIn));
  body.replaceChildren(wrap);

  /* move a to-do within its list: by `by` places, or to before `beforeId` */
  function move(id, by, beforeId) {
    const data = TASKS.read();
    const l = listOf(data);
    if (!l) return;
    const i = l.tasks.findIndex(t => t.id === id);
    if (i < 0) return;
    const [t] = l.tasks.splice(i, 1);
    let j = by !== undefined ? Math.max(0, Math.min(l.tasks.length, i + by)) : l.tasks.findIndex(x => x.id === beforeId);
    if (j < 0) j = l.tasks.length;
    l.tasks.splice(j, 0, t);
    save(data);
    paint();
    requestAnimationFrame(() => ul.querySelector(`[data-id="${CSS.escape(id)}"] .dw-todo__grip`)?.focus({ preventScroll: true }));
  }
  function toggle(id) {
    const data = TASKS.read();
    const l = listOf(data);
    const t = l && l.tasks.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.updated = Date.now();
    save(data);
    paint();
    requestAnimationFrame(() => ul.querySelector(`[data-id="${CSS.escape(id)}"] .dw-todo__ck`)?.focus({ preventScroll: true }));
  }
  function removeOne(id) {
    const data = TASKS.read();
    const l = listOf(data);
    if (!l) return;
    const i = l.tasks.findIndex(x => x.id === id);
    if (i < 0) return;
    const [gone] = l.tasks.splice(i, 1);
    save(data);
    paint();
    api.notify({ app: 'Static Tasks', icon: 'trash', title: 'To-do removed', message: gone.text, timeout: 6000,
      actions: [{ label: 'Undo', onClick: () => { const d = TASKS.read(); const ll = d.lists.find(x => x.id === l.id); if (!ll) return; ll.tasks.splice(Math.min(i, ll.tasks.length), 0, gone); save(d); paint(); } }] });
  }

  /* drag a row by its grip: rows move under the pointer, the order is saved on release.
     The other rows step around the dragged one — moving the dragged row itself
     would take it out of the page for a moment and lose the pointer. */
  function dragFrom(e, li) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    li.classList.add('is-drag');
    const mv = ev => {
      const rows = [...ul.children];
      const at = rows.indexOf(li);
      const want = rows.filter(r => r !== li && ev.clientY > r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2).length;
      if (want < at) for (let k = at - 1; k >= want; k--) ul.insertBefore(rows[k], li.nextSibling);
      else if (want > at) for (let k = at + 1; k <= want; k++) ul.insertBefore(rows[k], li);
    };
    const up = () => {
      grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      li.classList.remove('is-drag');
      const next = li.nextElementSibling;
      move(li.dataset.id, undefined, next ? next.dataset.id : null);
    };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  }

  function paint() {
    const data = TASKS.read();
    const l = listOf(data);
    if (!l) {
      head.replaceChildren(h('small.dw-todo__count', { text: 'No lists yet — the first to-do starts one.' }));
      ul.replaceChildren();
      return;
    }
    const left = l.tasks.filter(t => !t.done).length;
    head.replaceChildren(h('b.dw-todo__name', { text: l.name }), h('small.dw-todo__count', { dataset: { fk: 'todo-left' }, text: l.tasks.length ? `${left} left` : 'Empty' }));
    ul.replaceChildren(...l.tasks.map((t, i) => {
      const li = h('li.dw-todo__row', { dataset: { id: t.id }, class: t.done ? 'is-done' : null,
        oncontextmenu: e => {
          e.preventDefault(); e.stopPropagation();
          api.menu([
            { label: t.done ? 'Not done' : 'Done', icon: 'check', onClick: () => toggle(t.id) },
            { label: 'Move up', icon: 'chevron-up', disabled: i === 0, onClick: () => move(t.id, -1) },
            { label: 'Move down', icon: 'chevron-down', disabled: i === l.tasks.length - 1, onClick: () => move(t.id, 1) },
            { label: 'Open Static Tasks', icon: 'check-circle', onClick: () => api.openApp('tasks') },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeOne(t.id) },
          ], e.clientX, e.clientY);
        } },
        h('button.dw-todo__ck', { type: 'button', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': t.text,
          onclick: () => toggle(t.id),
          onkeydown: e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); move(t.id, e.key === 'ArrowUp' ? -1 : 1); } } },
          t.done ? icon('check') : null),
        h('span.dw-todo__t', { text: t.text }),
        h('button.dw-todo__grip', { type: 'button', 'aria-label': `Move “${t.text}” — drag, or use the up and down arrows`,
          onpointerdown: e => dragFrom(e, li),
          onkeydown: e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(t.id, e.key === 'ArrowUp' ? -1 : 1); }
          } }, icon('grip-vertical')));
      return li;
    }));
  }
  paint();
  /* Static Tasks (or another To-dos widget) changed the lists */
  const off = store.sub(TASKS.STORE_KEY, v => { if (v !== mine) paint(); });
  return off;
}

/* ================================================================
   Up next (Calendar)
   ================================================================ */
export function upnext(body) {
  const { h, icon } = api;
  const dayLabel = (k, now) => {
    const d = CAL.parseDay(k);
    const t = new Date(now);
    const diff = Math.round((d - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const soon = (o, now) => {
    if (o.now) return o.allDay ? 'today' : 'now';
    const mins = Math.round((o.start - now) / 60000);
    if (o.allDay || mins >= 12 * 60) return '';
    if (mins < 1) return 'in a moment';
    if (mins < 60) return `in ${mins} min`;
    const hh = Math.floor(mins / 60), mm = mins % 60;
    return `in ${hh} h${mm ? ` ${mm} min` : ''}`;
  };
  let sig = '';
  const paint = (force) => {
    const now = Date.now();
    const list = CAL.upcoming(now, { days: 14, limit: 8 });
    const s = `${Math.floor(now / 60000)}|${JSON.stringify(list.map(o => [o.id, o.on, o.title, o.time, o.end, o.tone]))}`;
    if (!force && s === sig) return;
    sig = s;
    if (!list.length) {
      body.replaceChildren(h('div.dw-empty', { text: 'Nothing on the calendar for the next two weeks.' }),
        h('button.btn.btn--sm.dw-cta', { type: 'button', dataset: { fk: 'up-open' }, onclick: () => api.openApp('calendar') }, icon('calendar'), 'Open Calendar'));
      return;
    }
    const out = [];
    let lastDay = '';
    for (const o of list) {
      if (o.on !== lastDay) { lastDay = o.on; out.push(h('div.dw-up__day', { text: dayLabel(o.on, now) })); }
      const when = o.allDay ? 'All day' : o.end ? `${CAL.clockText(o.time)} – ${CAL.clockText(o.end)}` : CAL.clockText(o.time);
      const tag = soon(o, now);
      out.push(h('button.dw-up', { type: 'button', dataset: { ev: o.id, on: o.on }, class: o.now ? 'is-now' : null,
        'aria-label': `${o.title}, ${dayLabel(o.on, now)}, ${when}${tag ? `, ${tag}` : ''}. Open in Calendar`,
        onclick: () => api.openApp('calendar', { event: o.id, date: o.on }) },
        h('i.dw-up__dot', { style: { background: `var(${o.tone})` } }),
        h('span.dw-up__t', h('b', { text: o.title }), h('small', { text: when })),
        tag ? h('small.dw-up__tag', { text: tag }) : null,
        o.repeat === 'weekly' ? h('span.dw-up__ic', { title: 'Every week' }, icon('repeat')) : null));
    }
    body.replaceChildren(h('div.dw-up__list', out));
  };
  paint(true);
  const off = [CAL.onChange(() => paint(true)), bus.on('tick:5s', () => paint(false)), store.sub('prefs.h24', () => paint(true))];
  return () => off.forEach(f => f());
}

/* ================================================================
   Now and next (Static Study's timetable)

   Reads js/core/timetable.js; the times are this computer's local
   time and follow the 12/24-hour setting. It repaints when the
   timetable or the setting changes, and otherwise once a minute —
   on the minute, or at the moment a class starts or ends if that is
   sooner — with a single timer, never one per second. A class that
   starts at 9:30 is "now" from 9:30:00; a class that ends at 9:20 is
   over at 9:20:00.
   ================================================================ */
export function classes(body) {
  const { h, icon } = api;
  let timer = 0;
  const roomOf = c => (c.room ? `${c.room} · ` : '');
  const paint = () => {
    clearTimeout(timer);
    const now = Date.now();
    const data = TT.read();
    if (!data.classes.length) {
      body.replaceChildren(h('div.dw-empty', { dataset: { fk: 'tt-empty' }, text: 'No classes yet. Add your timetable in Static Study.' }),
        h('button.btn.btn--sm.dw-cta', { type: 'button', dataset: { fk: 'tt-open' }, onclick: () => api.openApp('study', { tab: 'timetable' }) }, icon('calendar'), 'Open Timetable'));
      return;
    }
    const st = TT.status(now, data);
    const wk = TT.weekOf(TT.ymd(new Date(now)), data);
    const hdrWeek = wk ? h('small.dw-cls__wk', { dataset: { fk: 'tt-week' }, text: `${wk} week` }) : null;
    const known = HW.read().classes;     /* a subject with a Homework class of the same name takes its colour */
    const dot = c => h('i.dw-up__dot', { style: { background: TT.colorFor(c.subject, known) }, 'aria-hidden': 'true' });
    const nowRows = st.current.length
      ? st.current.map(c => h('div.dw-cls', { class: 'is-now', dataset: { fk: 'tt-now', id: c.id } }, dot(c),
        h('span.dw-up__t', h('b', { text: c.subject }), h('small', { text: `${roomOf(c)}until ${CAL.clockText(c.end)} · ${TT.span(c.endAt - now)} left` }))))
      : [h('div.dw-cls', { dataset: { fk: 'tt-now' } }, h('span.dw-up__t', h('small', { text: 'No class right now' })))];
    const n = st.next;
    const sameDay = n && n.on === TT.ymd(new Date(now));
    let nextRow, gap = null;
    if (n) {
      const day = TT.dayWord(n.on, now);
      nextRow = h('div.dw-cls', { dataset: { fk: 'tt-next', id: n.id } }, dot(n),
        h('span.dw-up__t', h('b', { text: n.subject }),
          h('small', { text: `${roomOf(n)}${sameDay ? `${CAL.clockText(n.start)} · in ${TT.span(n.startAt - now)}` : `${day} ${CAL.clockText(n.start)}`}` })));
      if (!st.current.length) {
        gap = h('div.dw-cls__gap', { dataset: { fk: 'tt-gap' }, text: sameDay ? `Free until ${CAL.clockText(n.start)}` : `Nothing until ${day === 'Tomorrow' ? 'tomorrow' : day} ${CAL.clockText(n.start)}` });
      }
    } else {
      nextRow = h('div.dw-cls', { dataset: { fk: 'tt-next' } }, h('span.dw-up__t', h('small', { text: 'No more classes in the next two weeks' })));
    }
    body.replaceChildren(h('div.dw-cls__list',
      h('div.dw-up__day', { text: 'Now' }), ...nowRows,
      gap,
      h('div.dw-up__day', { text: 'Next' }), nextRow,
      hdrWeek));
    /* the next moment the picture changes: the top of the minute, or a class starting or ending */
    const minute = (Math.floor(now / 60000) + 1) * 60000;
    timer = setTimeout(paint, Math.max(250, Math.min(minute, st.changeAt) - now + 20));
  };
  paint();
  const onVis = () => { if (!document.hidden) paint(); };
  document.addEventListener('visibilitychange', onVis);
  const off = [store.sub(TT.KEY, paint), store.sub('prefs.h24', paint)];
  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); off.forEach(f => f()); };
}


/* ================================================================
   Countdown — days to (or since) a date you pick
   ================================================================ */
export const CD_TITLE_MAX = 60;
const CD_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' as a local calendar date, or null when it isn't a real day (2026-02-30) or is out of range. */
export function parseCountdownDate(s) {
  const m = CD_DATE.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2999) return null;
  const t = new Date(y, mo - 1, d);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? { y, m: mo, d } : null;
}

/** Whole calendar days from today (on this computer's clock) to the date: 3 = three days to go,
    0 = today, -2 = two days ago. Both days are read as year-month-day and counted in UTC days,
    so a 23- or 25-hour day when the clocks change can't move the answer by one. */
export function daysUntil(date, now = new Date()) {
  const t = parseCountdownDate(date);
  if (!t) return null;
  return Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
}

/** Milliseconds until the next local midnight (plus a second, so the day has surely turned). */
export const msToMidnight = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000;

export function countdown(body, w, ctx) {
  const { h, icon } = api;
  const c = { title: '', date: '', ...(w.cfg || {}) };
  const title = String(c.title || '').slice(0, CD_TITLE_MAX);

  if (ctx.editing) {
    const msg = h('small.dw-cfg__msg', { role: 'status' });
    const titleIn = h('input.dw-cfg__in', { type: 'text', value: title, maxlength: String(CD_TITLE_MAX), placeholder: 'Birthday, trip, exam…', 'aria-label': 'Title', dataset: { fk: 'dwc-cd-title' },
      oninput: () => ctx.save({ title: titleIn.value.slice(0, CD_TITLE_MAX) }) });
    const dateIn = h('input.dw-cfg__in', { type: 'date', value: parseCountdownDate(c.date) ? c.date : '', min: '1900-01-01', max: '2999-12-31', 'aria-label': 'Date', dataset: { fk: 'dwc-cd-date' },
      onchange: () => {
        if (!dateIn.value) { msg.textContent = 'Pick a date to count to.'; msg.classList.add('is-bad'); return; }
        if (!parseCountdownDate(dateIn.value)) { msg.textContent = 'That isn’t a date this can count to.'; msg.classList.add('is-bad'); return; }
        msg.classList.remove('is-bad');
        ctx.save({ date: dateIn.value });
        const n = daysUntil(dateIn.value);
        msg.textContent = n > 0 ? `${n} day${n === 1 ? '' : 's'} to go.` : n === 0 ? 'That’s today.' : `${-n} day${n === -1 ? '' : 's'} ago.`;
      } });
    body.replaceChildren(h('div.dw-cfg',
      h('label.dw-cfg__l', { text: 'Title', for: `dwcdt-${w.uid}` }),
      h('div.field.dw-cfg__field', icon('edit-3'), Object.assign(titleIn, { id: `dwcdt-${w.uid}` })),
      h('label.dw-cfg__l', { text: 'Date', for: `dwcdd-${w.uid}` }),
      h('div.field.dw-cfg__field', icon('calendar'), Object.assign(dateIn, { id: `dwcdd-${w.uid}` })), msg,
      doneBtn(h, icon, ctx, 'dwc-done')));
    return null;
  }

  const t = parseCountdownDate(c.date);
  if (!t) {
    body.replaceChildren(h('div.dw-empty', { text: 'Pick a date and a title to count the days.' }),
      h('button.btn.btn--sm.dw-cta', { type: 'button', dataset: { fk: 'cd-setup' }, onclick: () => ctx.edit(true) }, icon('calendar'), 'Set a date'));
    return null;
  }

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateText = dayFmt.format(new Date(t.y, t.m - 1, t.d));
  const name = h('small.dw-cd__t');
  const num = h('b.dw-cd__n');
  const unit = h('small.dw-cd__u');
  const when = h('small.dw-cd__d', { text: dateText });
  const box = h('div.dw-cd', { role: 'group', dataset: { fk: 'cd' } }, name, num, unit, when);
  body.replaceChildren(box);
  let timer = 0;
  let shown = null;
  const paint = () => {
    const n = daysUntil(c.date);
    if (n === shown) return;
    shown = n;
    const label = title || 'Countdown';
    name.textContent = label;
    box.classList.toggle('is-today', n === 0);
    const words = n === 0 ? 'today' : `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} ${n > 0 ? 'left' : 'since'}`;
    if (n === 0) { num.textContent = 'Today'; unit.textContent = ''; }
    else { num.textContent = String(Math.abs(n)); unit.textContent = words.replace(/^\d+ /, ''); }
    box.setAttribute('aria-label', `${label}: ${words}, ${dateText}`);
  };
  /* the answer only changes when the local day does: wake at the next midnight,
     not every second; and look again when the page comes back (a sleeping
     computer or a hidden tab may have slept through midnight) */
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { paint(); arm(); }, msToMidnight()); };
  const wake = () => { if (!document.hidden) { paint(); arm(); } };
  paint();
  arm();
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
}

export default { clock, weather, music, tasks, upnext, classes, countdown, nowTrack, validZone, findZone, zoneCity, wxProblem, dropWeather };
