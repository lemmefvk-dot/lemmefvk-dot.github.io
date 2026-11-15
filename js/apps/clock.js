/* ============================================================
   clock.js — Clock: World, Meet, Stopwatch, Timers, Alarm, Countdown
   and Focus in one window.

   Honest time tools that share one window and one lifecycle.
   Focus (Pomodoro sessions) is the face of js/core/focus.js, and the
   named timers and the alarms are the face of js/core/alarms.js: both
   keep their time and ring with this window closed; opts.tab opens
   the window on a tab (the top bar's focus indicator asks for it).

   Design notes worth keeping:
   · The Stopwatch measures with performance.now(), never Date.now() —
     a monotonic clock that no NTP correction or DST jump can drag
     backwards, so a running lap can't suddenly show negative time.
     Timers keep a wall-clock end time instead, so they survive a
     reload (core/alarms.js).
   · Everything the page CAN'T truthfully promise is stated plainly:
     an alarm/timer can only fire while StaticOS is the open page — a
     backgrounded tab cannot wake itself, so we say so instead of
     pretending to be a real OS alarm.
   · World: sunrise and sunset only for a place that is saved — one
     you looked up here, or one of Weather's — and only from data
     Open-Meteo really sent (Weather's saved forecast, or a fetch made
     here); never worked out or guessed. A big full-screen clock for a
     classroom wall.
   · Countdown: days to Static Study's exams and to dates you add
     (fixed-date holidays one click away), counted in calendar days.
   · One 1s interval drives the wall-clock faces; a rAF pump (started
     only while a counter runs) drives the sub-second stopwatch/timer
     readouts, and paints only the tab you're actually looking at.
     Both are killed in teardown.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as FOCUS from '../core/focus.js';
import * as MEET from '../core/meeting.js';
import * as AL from '../core/alarms.js';
import * as sfx from '../core/sfx.js';
import * as EX from '../core/exams.js';
import { kv } from '../core/db.js';
import { GEO_URL, FC_URL, keyOf, validPlace, getJSON, describe } from '../core/openmeteo.js';
import { t as tr, plural, locale } from '../core/i18n.js';

/* This app ships its own stylesheet. index.html should link it (see the
   integration hook), but we self-inject when it hasn't, guarded by id so
   a later <link> never double-loads it — keeps the app working standalone. */
if (typeof document !== 'undefined' && !document.getElementById('feat-clock-css')) {
  const l = document.createElement('link');
  l.id = 'feat-clock-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-clock.css';
  document.head.appendChild(l);
}

const TABS = [
  ['world', tr('World'), 'globe'],
  ['meet', tr('Meet'), 'users'],
  ['stopwatch', tr('Stopwatch'), 'activity'],
  ['timer', tr('Timers'), 'gauge'],
  ['alarm', tr('Alarm'), 'bell'],
  ['countdown', tr('Countdown'), 'calendar'],
  ['focus', tr('Focus'), 'flame'],
];

/* Holidays on the same date every year, one click from a countdown. Ones
   that move (Easter, Thanksgiving, school breaks) are yours to add by date. */
const HOLIDAYS = [['New Year’s Day', 1, 1], ['Valentine’s Day', 2, 14], ['Halloween', 10, 31], ['Christmas Day', 12, 25]];
const CD_KEY = 'prefs.clock.countdowns';      /* [{ id, name, date 'YYYY-MM-DD', time 'HH:MM' | '', yearly }] */
const SUN_KEY = 'prefs.clock.sun';            /* { placeKey: { tz, name, at, days: { ymd: [rise, set, daylight s] } } } */
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_CITIES = [
  { tz: 'America/New_York', label: tr('New York') },
  { tz: 'Europe/London', label: tr('London') },
  { tz: 'Asia/Tokyo', label: tr('Tokyo') },
];

/* A curated fallback for engines without Intl.supportedValuesOf. */
const FALLBACK_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai',
  'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Singapore',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
];

const pad2 = n => String(n).padStart(2, '0');
const cityFromTz = tz => tz.split('/').pop().replace(/_/g, ' ');

/* ms → H:MM:SS.cs for the stopwatch (centiseconds keep it readable). */
function fmtSW(ms) {
  const t = Math.max(0, ms);
  const cs = Math.floor((t % 1000) / 10);
  const s = Math.floor(t / 1000) % 60;
  const m = Math.floor(t / 60000) % 60;
  const hr = Math.floor(t / 3600000);
  return (hr ? hr + ':' + pad2(m) : m + '') + ':' + pad2(s) + '.' + pad2(cs);
}

/* ms → H:MM:SS (ceil so a timer shows 0:01 until it truly hits zero). */
function fmtTimer(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const s = t % 60, m = Math.floor(t / 60) % 60, hr = Math.floor(t / 3600);
  return (hr ? hr + ':' + pad2(m) : m + '') + ':' + pad2(s);
}

defineApp({
  id: 'clock',
  name: 'Clock',
  icon: 'clock',
  g1: '#7d808b', g2: '#0f1116',
  category: 'Utilities',
  keywords: ['time', 'meeting', 'meeting planner', 'time zones', 'world clock', 'stopwatch', 'timer', 'timers', 'alarm', 'timezone', 'lap', 'countdown', 'focus', 'pomodoro', 'study', 'break',
    'snooze', 'sunrise', 'sunset', 'exam', 'holiday', 'classroom clock', 'full screen clock'],
  desc: tr('World clock with sunrise and sunset, a meeting planner, stopwatch, named timers, alarms, countdowns to exams and holidays, and focus sessions'),
  pinned: true, dock: true, singleton: true,
  win: { w: 600, h: 620, minW: 360, minH: 460 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, render, clear, store, notify } = api;
    const isTab = id => TABS.some(t => t[0] === id);
    AL.init();                       /* alarms and timers ring from here on, window or not */

    /* ------------------------------ state ------------------------------ */
    const S = {
      tab: isTab(opts?.tab) ? opts.tab : store.get('prefs.clock.tab', 'world'),
      dead: false,
      /* stopwatch — base is the performance.now() origin while running */
      sw: { running: false, base: 0, elapsed: 0, laps: [] },
    };

    const cities = () => store.get('prefs.clock.cities', null) || DEFAULT_CITIES;
    const h24 = () => !!store.get('prefs.h24', false);
    /** 'HH:MM' as this person reads clocks: 7:05 AM or 07:05 */
    const clockText = hhmm => { const [H, M] = hhmm.split(':').map(Number); return h24() ? `${pad2(H)}:${pad2(M)}` : `${H % 12 || 12}:${pad2(M)} ${H < 12 ? 'AM' : 'PM'}`; };
    const ymdIn = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    async function copyOut(text, what) {
      try { await navigator.clipboard.writeText(text); notify({ app: 'Clock', icon: 'copy', title: tr('Copied'), message: what, timeout: 2200 }); }
      catch (e) { notify({ app: 'Clock', icon: 'alert', title: tr('Could not copy'), message: tr('The clipboard is unavailable here.') }); }
    }

    /* ------------------------------ shell ------------------------------ */
    const tabsEl = h('div.clk__tabs', { role: 'tablist', 'aria-label': tr('Clock sections') });
    const bodyEl = h('div.clk__body');
    root.appendChild(h('div.app.app--col', h('div.clk', tabsEl, bodyEl)));

    function paintTabs() {
      clear(tabsEl);
      for (const [id, label, ic] of TABS) {
        const on = id === S.tab;
        tabsEl.appendChild(h(on ? 'button.clk__tab.is-on' : 'button.clk__tab', {
          type: 'button', role: 'tab', 'aria-selected': String(on), dataset: { tab: id },
          onclick: () => showTab(id),
        }, icon(ic, { size: 14 }), h('span', { text: label })));
      }
    }
    function showTab(id) {
      if (S.tab === id || !isTab(id)) return;
      S.tab = id; store.set('prefs.clock.tab', id); paintTabs(); paintBody(); pump();
    }
    /* the top bar's focus indicator (and a focus notification) open Clock on Focus */
    win.onReopen(o => { if (o && o.tab) showTab(o.tab); });

    /* R holds live-updatable node refs for the currently mounted tab. */
    let R = {};
    function paintBody() {
      R = {};
      clear(bodyEl);
      if (S.tab === 'world') mountWorld();
      else if (S.tab === 'meet') mountMeet();
      else if (S.tab === 'stopwatch') mountStopwatch();
      else if (S.tab === 'timer') mountTimer();
      else if (S.tab === 'alarm') mountAlarm();
      else if (S.tab === 'countdown') mountCountdown();
      else if (S.tab === 'focus') mountFocus();
    }

    /* ============================== WORLD ============================== */
    function fmtInZone(d, tz) {
      const time = new Intl.DateTimeFormat(undefined, {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(d);
      const day = new Intl.DateTimeFormat(undefined, {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      }).format(d);
      /* day label relative to the viewer's own date */
      const hereYMD = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      const zoneYMD = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      let rel = '';
      if (zoneYMD > hereYMD) rel = tr('Tomorrow');
      else if (zoneYMD < hereYMD) rel = tr('Yesterday');
      return { time, day, rel };
    }

    function mountWorld() {
      const local = h('div.clk__local');
      const localName = h('div.clk__local-name');
      const localTime = h('div.clk__local-time', { 'aria-live': 'off' });
      const localDay = h('div.clk__local-day');
      const localSun = h('div.clk__sun', { dataset: { tz: localZone() } });
      const bigBtn = h('button.clk__btn.clk__bigclock', { type: 'button', 'aria-label': tr('Show a big full-screen clock'), onclick: openClassClock },
        icon('maximize', { size: 14 }), tr('Full-screen clock'));
      local.append(h('div.clk__local-top', localName, bigBtn), localTime, localDay, localSun);

      const list = h('div.clk__cities', { role: 'list' });

      /* add-a-city control: a real timezone list, no invented offsets */
      let zones = FALLBACK_ZONES;
      try { if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone'); } catch (e) { /* fallback stays */ }
      const select = h('select.clk__select', { 'aria-label': tr('Choose a city to add') },
        h('option', { value: '', text: tr('Add a city…') }),
        ...zones.map(tz => h('option', { value: tz, text: `${cityFromTz(tz)} — ${tz}` })));
      const addBtn = h('button.clk__btn.clk__btn--add', {
        type: 'button', 'aria-label': tr('Add selected city'),
        onclick: () => {
          const tz = select.value;
          if (!tz) return;
          const list0 = cities();
          if (list0.some(c => c.tz === tz)) { notify({ app: 'Clock', icon: 'clock', title: tr('Already added'), message: cityFromTz(tz), timeout: 2400 }); return; }
          store.set('prefs.clock.cities', [...list0, { tz, label: cityFromTz(tz) }]); // new array — store.set is identity-gated
          select.value = '';
          paintBody();
        },
      }, icon('plus', { size: 14 }), tr('Add'));

      R.rows = [];
      function drawCities() {
        clear(list);
        R.rows = [];
        const cs = cities();
        if (!cs.length) {
          list.appendChild(h('div.clk__empty', icon('globe', { size: 22 }),
            h('b', { text: tr('No cities yet') }),
            h('small', { text: tr('Pick one below to watch its time here.') })));
          return;
        }
        for (const c of cs) {
          const name = c.label || cityFromTz(c.tz);
          const timeEl = h('div.clk__city-time');
          const dayEl = h('div.clk__city-day');
          const relEl = h('span.clk__city-rel');
          const sunEl = h('div.clk__sun', { dataset: { tz: c.tz } });
          const hasPlace = validPlace(c.place);
          const row = h('div.clk__city', { role: 'listitem', dataset: { tz: c.tz } },
            h('div.clk__city-info',
              h('div.clk__city-name', { text: name }, relEl),
              dayEl, sunEl),
            timeEl,
            h('button.clk__x.clk__sunbtn', {
              type: 'button', class: hasPlace ? 'is-on' : '', 'aria-pressed': String(hasPlace),
              'aria-label': hasPlace ? tr('Stop showing sunrise and sunset for {name}', { name }) : tr('Look up {name} for sunrise and sunset', { name }),
              title: hasPlace ? tr('Sunrise and sunset for {name}. Click to stop.', { name: c.place.name }) : tr('Sunrise and sunset: look this city up on Open-Meteo'),
              onclick: () => (hasPlace ? forgetPlace(c) : lookUpPlace(c)),
            }, icon('sun', { size: 14 })),
            h('button.clk__x', {
              type: 'button', 'aria-label': tr('Remove {name}', { name }),
              onclick: () => { store.set('prefs.clock.cities', cities().filter(x => x.tz !== c.tz)); paintBody(); },
            }, icon('x', { size: 14 })));
          R.rows.push({ tz: c.tz, timeEl, dayEl, relEl });
          list.appendChild(row);
        }
      }
      drawCities();

      R.local = { localName, localTime, localDay };
      R.sunNote = h('p.clk__note.clk__sunnote', { hidden: true });
      bodyEl.append(h('div.clk__world', local, list, h('div.clk__addbar', select, addBtn), R.sunNote));
      tickWorld(); // paint once immediately so there's no blank second
      paintSun();
    }

    /* ---- sunrise and sunset ----
       From Open-Meteo, for saved places only: a city you looked up here
       (its coordinates are kept on the city), or a place saved in Weather
       whose forecast — already fetched by Weather — is for the same time
       zone. Nothing is computed or estimated: no data, no line. */
    const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const sunCache = () => store.get(SUN_KEY, null) || {};
    const SUN = { weather: null, tried: new Set() };   /* this window: Weather's saved forecasts, fetches already made */
    async function weatherSuns() {
      if (SUN.weather) return SUN.weather;
      SUN.weather = [];
      const mine = store.get('portal.weather', null);
      const places = (mine && Array.isArray(mine.places) ? mine.places : []).filter(validPlace);
      const wx = store.get('prefs.wxPlace', null);
      if (validPlace(wx) && !places.some(p => keyOf(p) === keyOf(wx))) places.push(wx);
      const misc = kv('misc');
      for (const p of places.slice(0, 20)) {
        const rec = await misc.get('weather:' + keyOf(p)).catch(() => null);
        const fc = rec && rec.fc;
        if (fc && typeof fc.timezone === 'string' && fc.daily && Array.isArray(fc.daily.time)) SUN.weather.push({ name: p.name, tz: fc.timezone, daily: fc.daily, at: rec.at });
      }
      return SUN.weather;
    }
    /** today's sunrise and sunset in a time zone, from saved data only: { name, rise, set, len, from } | null */
    function sunToday(tz, place) {
      const day = ymdIn(tz);
      if (validPlace(place)) {
        const e = sunCache()[keyOf(place)];
        const d = e && e.tz === tz && e.days && e.days[day];
        return d ? { name: place.name, rise: d[0], set: d[1], len: d[2], from: 'clock' } : null;
      }
      for (const w of SUN.weather || []) {
        if (w.tz !== tz) continue;
        const i = w.daily.time.indexOf(day);
        if (i < 0 || !w.daily.sunrise?.[i] || !w.daily.sunset?.[i]) continue;
        return { name: w.name, rise: w.daily.sunrise[i].slice(11, 16), set: w.daily.sunset[i].slice(11, 16), len: w.daily.daylight_duration?.[i], from: 'weather' };
      }
      return null;
    }
    async function fetchSun(place, tz) {
      const url = `${FC_URL}?latitude=${(+place.lat).toFixed(4)}&longitude=${(+place.lon).toFixed(4)}&daily=sunrise,sunset,daylight_duration&timezone=${encodeURIComponent(tz)}&forecast_days=7`;
      const j = await getJSON(url);
      const t = j && j.daily && j.daily.time;
      if (!Array.isArray(t)) throw Object.assign(new Error('unreadable reply'), { kind: 'parse' });
      const days = {};
      t.forEach((d, i) => {
        const r = j.daily.sunrise?.[i], s = j.daily.sunset?.[i], len = j.daily.daylight_duration?.[i];
        if (typeof d === 'string') days[d] = [typeof r === 'string' ? r.slice(11, 16) : '', typeof s === 'string' ? s.slice(11, 16) : '', Number.isFinite(len) ? len : null];
      });
      store.set(SUN_KEY, { ...sunCache(), [keyOf(place)]: { tz, name: place.name, at: Date.now(), days } });
    }
    function sunLine(el, sun) {
      clear(el);
      el.hidden = !sun;
      if (!sun) return;
      const polar = Number.isFinite(sun.len) && (sun.len <= 0 || sun.len >= 86340);
      if (polar) el.append(icon('sun', { size: 12 }), h('span', { text: sun.len <= 0 ? tr('The sun doesn’t rise today') : tr('The sun doesn’t set today') }));
      else if (sun.rise && sun.set) el.append(icon('sun', { size: 12 }), h('span', { dataset: { rise: sun.rise }, text: tr('Sunrise {time}', { time: clockText(sun.rise) }) }), h('span', { dataset: { set: sun.set }, text: tr('Sunset {time}', { time: clockText(sun.set) }) }));
      else { el.hidden = true; return; }
      el.title = tr('For {name}, from Open-Meteo', { name: sun.name }) + (sun.from === 'weather' ? ' ' + tr('(Weather’s saved forecast)') : '');
    }
    async function paintSun() {
      await weatherSuns();
      if (S.dead || S.tab !== 'world') return;
      let shown = 0;
      const lines = [...bodyEl.querySelectorAll('.clk__sun')];
      for (const el of lines) {
        const tz = el.dataset.tz;
        const city = cities().find(c => c.tz === tz);
        const place = city && validPlace(city.place) ? city.place : null;
        let sun = sunToday(tz, place);
        /* a looked-up place without today's data: fetch it once per window */
        if (!sun && place && !SUN.tried.has(keyOf(place))) {
          SUN.tried.add(keyOf(place));
          try { await fetchSun(place, tz); } catch (e) { notify({ app: 'Clock', icon: 'alert', title: tr('No sunrise and sunset'), message: describe(e).short, timeout: 4000 }); }
          if (S.dead || S.tab !== 'world' || !el.isConnected) return;
          sun = sunToday(tz, place);
        }
        sunLine(el, sun);
        if (sun) shown++;
      }
      if (R.sunNote) {
        R.sunNote.hidden = !shown;
        R.sunNote.textContent = tr('Sunrise and sunset come from Open-Meteo for places you looked up here or saved in Weather, in each place’s own time.');
      }
    }
    async function lookUpPlace(c) {
      const name = c.label || cityFromTz(c.tz);
      try {
        const j = await getJSON(`${GEO_URL}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
        const hit = (j && Array.isArray(j.results) ? j.results : []).find(r => r.timezone === c.tz && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
        if (!hit) { notify({ app: 'Clock', icon: 'sun', title: tr('Couldn’t find {name}', { name }), message: tr('Open-Meteo has no place called “{name}” in the {tz} time zone.', { name, tz: c.tz }), timeout: 5000 }); return; }
        const place = { name: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '), lat: hit.latitude, lon: hit.longitude };
        store.set('prefs.clock.cities', cities().map(x => (x.tz === c.tz ? { ...x, place } : x)));
        SUN.tried.delete(keyOf(place));
        if (!S.dead && S.tab === 'world') paintBody();
      } catch (e) {
        notify({ app: 'Clock', icon: 'alert', title: tr('Couldn’t look it up'), message: describe(e).short, timeout: 4000 });
      }
    }
    function forgetPlace(c) {
      const k = validPlace(c.place) ? keyOf(c.place) : '';
      store.set('prefs.clock.cities', cities().map(x => { if (x.tz !== c.tz) return x; const { place, ...rest } = x; return rest; }));
      if (k && !cities().some(x => validPlace(x.place) && keyOf(x.place) === k)) { const all = { ...sunCache() }; delete all[k]; store.set(SUN_KEY, all); }
      paintBody();
    }

    /* ---- the big full-screen clock (a classroom wall, a projector) ---- */
    let CC = null;
    function openClassClock() {
      if (CC) return;
      const timeEl = h('span.clk__cc-time'), secEl = h('span.clk__cc-sec'), dateEl = h('div.clk__cc-date'), subEl = h('div.clk__cc-sub');
      const el = h('div.clk__cc', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Full-screen clock'), tabindex: '-1' },
        h('button.clk__cc-x', { type: 'button', 'aria-label': tr('Close the full-screen clock'), onclick: () => closeClassClock() }, icon('x', { size: 16 }), tr('Close · Esc')),
        h('div.clk__cc-main', h('div.clk__cc-row', { 'aria-live': 'off' }, timeEl, secEl), dateEl, subEl));
      const paint = () => {
        const d = new Date();
        const H = d.getHours(), M = d.getMinutes();
        timeEl.textContent = h24() ? `${pad2(H)}:${pad2(M)}` : `${H % 12 || 12}:${pad2(M)}`;
        secEl.textContent = h24() ? pad2(d.getSeconds()) : `${pad2(d.getSeconds())} ${H < 12 ? 'AM' : 'PM'}`;
        dateEl.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        /* what is counting down: running timers, a focus session, the next countdown */
        const now = Date.now();
        const bits = AL.timers().filter(t => t.status === 'running').slice(0, 2).map(t => `${t.name} ${fmtTimer(AL.left(t, now))}`);
        const f = FOCUS.state();
        if (f.status === 'running') bits.push(`${f.what || f.label} ${fmtTimer(f.left)}`);
        const next = countdownItems(now).find(x => x.at >= now);
        if (next) bits.push(`${next.name}: ${cdText(next, now).main}`);
        subEl.textContent = bits.join('   ·   ');
      };
      paint();
      const iv = setInterval(paint, 1000);
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeClassClock(); } };
      const onFs = () => { if (CC && CC.fs && !document.fullscreenElement) closeClassClock(); };
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('fullscreenchange', onFs);
      document.body.appendChild(el);
      CC = { el, iv, onKey, onFs, fs: false };
      el.focus();
      try { el.requestFullscreen?.().then(() => { if (CC && CC.el === el) CC.fs = true; }).catch(() => { /* the overlay still fills the page */ }); } catch (e) { /* no Fullscreen API */ }
    }
    function closeClassClock() {
      if (!CC) return;
      const c = CC;
      CC = null;
      clearInterval(c.iv);
      document.removeEventListener('keydown', c.onKey, true);
      document.removeEventListener('fullscreenchange', c.onFs);
      if (document.fullscreenElement === c.el) document.exitFullscreen?.().catch(() => {});
      c.el.remove();
    }

    function tickWorld() {
      if (!R.local) return;
      const d = new Date();
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
      R.local.localName.textContent = cityFromTz(localTz) + '  ·  ' + tr('your time');
      R.local.localTime.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
      R.local.localDay.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
      for (const r of (R.rows || [])) {
        const f = fmtInZone(d, r.tz);
        r.timeEl.textContent = f.time;
        r.dayEl.textContent = f.day;
        r.relEl.textContent = f.rel;
        r.relEl.classList.toggle('is-shown', !!f.rel);
      }
    }

    /* ============================== MEET ==============================
       A meeting planner across time zones (js/core/meeting.js: Intl time
       zone data only, no offsets typed in). The grid has one column per hour
       of the first place's day; pick a column to see that moment everywhere. */
    const MAX_PLACES = 8;
    const meetSaved = () => {
      const o = store.get('prefs.clock.meet', null) || {};
      let places = Array.isArray(o.places) ? [...new Set(o.places.filter(MEET.isZone))].slice(0, MAX_PLACES) : [];
      if (!places.length && !Array.isArray(o.places)) places = [MEET.localZone()];
      const ws = Number(o.work && o.work.start), we = Number(o.work && o.work.end);
      const work = Number.isInteger(ws) && Number.isInteger(we) && ws >= 0 && we <= 24 && ws < we ? { start: ws, end: we } : { ...MEET.DEFAULT_WORK };
      return { places, work };
    };
    const meetSave = m => store.set('prefs.clock.meet', { places: [...m.places], work: { ...m.work } });
    const MEET_STATE = { ymd: null, pick: null };   /* this window only: which day, which moment */
    const CLS_WORD = { work: 'working hours', sleep: 'asleep', free: 'free time' };

    function mountMeet() {
      const m = meetSaved();
      const todayRef = () => MEET.partsOf(Date.now(), m.places[0] || MEET.localZone()).ymd;
      if (!MEET_STATE.ymd || !MEET.validYmd(MEET_STATE.ymd)) MEET_STATE.ymd = todayRef();
      const hour12 = !store.get('prefs.h24', false);
      const when = (ms, tz) => new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12 }).format(new Date(ms));
      const clockOf = c => (hour12 ? `${c.h % 12 || 12}${c.mi ? ':' + pad2(c.mi) : ''}${c.h < 12 ? 'a' : 'p'}` : `${pad2(c.h)}${c.mi ? ':' + pad2(c.mi) : ''}`);

      const wrap = h('div.clk__meet');
      const hrs = Array.from({ length: 25 }, (_, i) => i);
      const hourText = n => (hour12 ? `${n % 12 || 12} ${n % 24 < 12 ? 'AM' : 'PM'}` : `${pad2(n % 24)}:00`);
      const dateIn = h('input.clk__select.clk__meet-date', { type: 'date', value: MEET_STATE.ymd, 'aria-label': tr('Day for the grid'),
        onchange: e => { if (MEET.validYmd(e.target.value)) { MEET_STATE.ymd = e.target.value; MEET_STATE.pick = null; draw(); } } });
      const startSel = h('select.clk__select.clk__meet-ws', { 'aria-label': tr('Working day starts'), onchange: e => setWork(Number(e.target.value), m.work.end) },
        hrs.slice(0, 24).map(n => h('option', { value: n, text: hourText(n), selected: n === m.work.start ? '' : null })));
      const endSel = h('select.clk__select.clk__meet-we', { 'aria-label': tr('Working day ends'), onchange: e => setWork(m.work.start, Number(e.target.value)) },
        hrs.slice(1).map(n => h('option', { value: n, text: hourText(n), selected: n === m.work.end ? '' : null })));
      function setWork(a, b) {
        if (a >= b) { notify({ app: 'Clock', icon: 'clock', title: tr('Working hours'), message: tr('The day has to end after it starts.'), timeout: 2600 }); startSel.value = m.work.start; endSel.value = m.work.end; return; }
        m.work = { start: a, end: b }; meetSave(m); draw();
      }
      const todayBtn = h('button.clk__btn', { type: 'button', onclick: () => { MEET_STATE.ymd = todayRef(); MEET_STATE.pick = null; dateIn.value = MEET_STATE.ymd; draw(); } }, tr('Today'));
      const ctl = h('div.clk__mctl',
        h('label.clk__mlab', h('span', { text: tr('Day') }), dateIn), todayBtn,
        h('label.clk__mlab', h('span', { text: tr('Working') }), startSel, h('span', { text: tr('to') }), endSel));

      /* places */
      const chips = h('div.clk__mchips', { role: 'list', 'aria-label': tr('Places') });
      const zones = MEET.zoneList();
      const filter = h('input.clk__select.clk__meet-find', { type: 'search', placeholder: tr('Find a place…'), 'aria-label': tr('Search places'), maxlength: '40',
        oninput: () => fillZones() });
      const zoneSel = h('select.clk__select.clk__meet-zone', { 'aria-label': tr('Choose a place to add') });
      function fillZones() {
        const q = filter.value.trim().toLowerCase().replace(/\s+/g, '_');
        const list = zones.filter(z => !m.places.includes(z) && (!q || z.toLowerCase().includes(q))).slice(0, 300);
        zoneSel.replaceChildren(h('option', { value: '', text: list.length ? tr('Add a place…') : tr('No place matches') }),
          ...list.map(z => h('option', { value: z, text: `${MEET.cityOf(z)} — ${z}` })));
      }
      const addPlace = () => {
        const tz = zoneSel.value;
        if (!tz || !MEET.isZone(tz) || m.places.includes(tz)) return;
        if (m.places.length >= MAX_PLACES) { notify({ app: 'Clock', icon: 'clock', title: tr('That’s enough places'), message: tr('Up to {MAX_PLACES} fit on the grid.', { MAX_PLACES }), timeout: 3000 }); return; }
        m.places = [...m.places, tz]; meetSave(m); filter.value = ''; draw();
      };
      const addBar = h('div.clk__addbar.clk__meet-add', filter, zoneSel,
        h('button.clk__btn.clk__btn--add', { type: 'button', 'aria-label': tr('Add selected place'), onclick: addPlace }, icon('plus', { size: 14 }), tr('Add')));

      const gridEl = h('div.clk__mgrid', { role: 'grid', 'aria-label': tr('Hours in each place. Choose an hour to see it everywhere') });
      const noteEl = h('div.clk__mnote', { role: 'status' });
      const resEl = h('div.clk__mres', { 'aria-live': 'polite' });
      const legend = h('div.clk__mlegend', ...['work', 'free', 'sleep'].map(c =>
        h('span', h('i.clk__msw', { class: `is-${c}` }), CLS_WORD[c][0].toUpperCase() + CLS_WORD[c].slice(1))));

      let grid = null;
      function removePlace(tz) { m.places = m.places.filter(z => z !== tz); meetSave(m); MEET_STATE.pick = null; draw(); }
      function makeRef(tz) { m.places = [tz, ...m.places.filter(z => z !== tz)]; meetSave(m); MEET_STATE.pick = null; draw(); }

      function pick(ms, focus) {
        MEET_STATE.pick = ms;
        gridEl.querySelectorAll('.clk__mcell.is-pick, .clk__mhead.is-pick').forEach(el => el.classList.remove('is-pick'));
        gridEl.querySelectorAll(`[data-ms="${ms}"]`).forEach(el => { el.classList.add('is-pick'); if (el.tagName === 'BUTTON') el.setAttribute('aria-selected', 'true'); });
        gridEl.querySelectorAll('.clk__mcell:not(.is-pick)').forEach(el => el.removeAttribute('aria-selected'));
        if (focus) gridEl.querySelector(`.clk__mcell[data-ms="${ms}"][data-tz="${CSS.escape(focus)}"]`)?.focus();
        paintResult();
      }
      function paintResult() {
        if (!grid || !m.places.length || MEET_STATE.pick === null) { resEl.replaceChildren(); return; }
        const rows = MEET.chosen(MEET_STATE.pick, m.places, m.work);
        resEl.replaceChildren(
          h('div.clk__mres-h', h('b', { text: tr('That moment in each place') }),
            h('button.clk__btn', { type: 'button', 'aria-label': tr('Copy these times'), onclick: async () => {
              const text = rows.map(r => `${MEET.cityOf(r.tz)}: ${when(MEET_STATE.pick, r.tz)}`).join('\n');
              try { await navigator.clipboard.writeText(text); notify({ app: 'Clock', icon: 'copy', title: tr('Copied'), message: plural(rows.length, '{n} time', '{n} times'), timeout: 2200 }); }
              catch (e) { notify({ app: 'Clock', icon: 'alert', title: tr('Could not copy'), message: tr('The clipboard is unavailable here.') }); }
            } }, icon('copy', { size: 14 }), tr('Copy'))),
          ...rows.map(r => h('div.clk__mrow2', { dataset: { tz: r.tz } },
            h('div.clk__mwho', h('b', { text: MEET.cityOf(r.tz) }), h('small', { text: `${r.tz} · ${MEET.offsetLabel(r.offset)}` })),
            h('div.clk__mwhen', { text: when(MEET_STATE.pick, r.tz) }),
            h('span.clk__mtag', { class: `is-${r.cls}`, text: CLS_WORD[r.cls] }),
            r.dst ? h('span.clk__mtag.is-dst', { title: tr('This place’s clocks change at some point on this day'), text: tr('clocks change this day') }) : null)));
      }

      function draw() {
        chips.replaceChildren(...m.places.map((tz, i) => h('span.clk__mchip', { role: 'listitem', dataset: { tz } },
          h('b', { text: MEET.cityOf(tz) }),
          i === 0 ? h('small', { text: tr('grid follows this day') }) : null,
          i > 0 ? h('button.clk__x', { type: 'button', 'aria-label': tr('Use {name}’s day for the grid', { name: MEET.cityOf(tz) }), title: tr('Use this place’s day for the grid'), onclick: () => makeRef(tz) }, icon('arrow-up', { size: 13 })) : null,
          h('button.clk__x', { type: 'button', 'aria-label': tr('Remove {name}', { name: MEET.cityOf(tz) }), onclick: () => removePlace(tz) }, icon('x', { size: 13 })))));
        fillZones();
        startSel.value = String(m.work.start); endSel.value = String(m.work.end);
        if (!m.places.length) {
          grid = null; gridEl.replaceChildren(); noteEl.textContent = '';
          gridEl.append(h('div.clk__empty', icon('globe', { size: 22 }), h('b', { text: tr('No places yet') }), h('small', { text: tr('Add where people are and the hours line up here.') })));
          paintResult(); return;
        }
        grid = MEET.buildGrid({ ymd: MEET_STATE.ymd, places: m.places, work: m.work });
        const ref = grid.ref;
        const n = grid.cols.length;
        noteEl.textContent = n === 24
          ? tr('{name} has 24 hours on this day.', { name: MEET.cityOf(ref) })
          : tr('{name}’s clocks change on this day, so it has {n} hours.', { name: MEET.cityOf(ref), n });
        noteEl.classList.toggle('is-warn', n !== 24);
        const cols = `minmax(96px,120px) repeat(${n}, minmax(30px,1fr))`;
        const head = h('div.clk__mline.clk__mline--head', { role: 'row', style: { gridTemplateColumns: cols } },
          h('div.clk__mname', { role: 'columnheader', text: tr('{name} (grid)', { name: MEET.cityOf(ref) }) }),
          ...grid.cols.map(ms => { const p = MEET.partsOf(ms, ref); return h('div.clk__mhead', { role: 'columnheader', dataset: { ms: String(ms) }, text: hour12 ? String(p.h % 12 || 12) : pad2(p.h), title: when(ms, ref) }); }));
        const lines = grid.rows.map(row => h('div.clk__mline', { role: 'row', dataset: { tz: row.tz }, style: { gridTemplateColumns: cols } },
          h('div.clk__mname', { role: 'rowheader' }, h('b', { text: MEET.cityOf(row.tz) }), h('small', { text: MEET.offsetLabel(MEET.offsetMin(grid.cols[0], row.tz)) })),
          ...row.cells.map(c => h('button.clk__mcell', {
            type: 'button', role: 'gridcell', class: `is-${c.cls}${c.day ? ' is-other' : ''}`, dataset: { ms: String(c.ms), tz: row.tz, cls: c.cls, hour: `${pad2(c.h)}:${pad2(c.mi)}` },
            tabindex: '-1', 'aria-label': `${MEET.cityOf(row.tz)}: ${when(c.ms, row.tz)}, ${CLS_WORD[c.cls]}`,
            title: when(c.ms, row.tz),
            text: c.h === 0 && c.mi === 0 ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][c.dow] : clockOf(c),
          }))));
        gridEl.replaceChildren(head, ...lines);
        /* one tab stop for the grid; arrow keys move around it */
        const first = gridEl.querySelector('.clk__mcell');
        if (first) first.tabIndex = 0;
        if (MEET_STATE.pick === null || !grid.cols.includes(MEET_STATE.pick)) {
          const now = Date.now();
          const live = grid.cols.filter(ms => ms <= now).pop();
          const at10 = grid.cols.find(ms => MEET.partsOf(ms, ref).h >= 10);
          MEET_STATE.pick = MEET_STATE.ymd === todayRef() && live !== undefined ? live : (at10 ?? grid.cols[0]);
        }
        pick(MEET_STATE.pick);
      }

      /* click or arrow keys choose an hour */
      gridEl.addEventListener('click', e => { const c = e.target.closest('.clk__mcell'); if (c) { gridEl.querySelectorAll('.clk__mcell[tabindex="0"]').forEach(x => { x.tabIndex = -1; }); c.tabIndex = 0; pick(Number(c.dataset.ms)); } });
      gridEl.addEventListener('keydown', e => {
        const c = e.target.closest && e.target.closest('.clk__mcell');
        if (!c) return;
        const lines = [...gridEl.querySelectorAll('.clk__mline:not(.clk__mline--head)')];
        const li = lines.indexOf(c.closest('.clk__mline'));
        const cells = [...lines[li].querySelectorAll('.clk__mcell')];
        const ci = cells.indexOf(c);
        let next = null;
        if (e.key === 'ArrowRight') next = cells[ci + 1];
        else if (e.key === 'ArrowLeft') next = cells[ci - 1];
        else if (e.key === 'ArrowDown') next = lines[li + 1] && lines[li + 1].querySelectorAll('.clk__mcell')[ci];
        else if (e.key === 'ArrowUp') next = lines[li - 1] && lines[li - 1].querySelectorAll('.clk__mcell')[ci];
        else if (e.key === 'Home') next = cells[0];
        else if (e.key === 'End') next = cells[cells.length - 1];
        else return;
        e.preventDefault();
        if (!next) return;
        gridEl.querySelectorAll('.clk__mcell[tabindex="0"]').forEach(x => { x.tabIndex = -1; });
        next.tabIndex = 0; next.focus();
        pick(Number(next.dataset.ms));
      });

      wrap.append(ctl, chips, addBar, noteEl, legend, h('div.clk__mscroll', gridEl), resEl,
        h('p.clk__note', { text: tr('Times come from this browser’s own time zone data, for the day you pick, so daylight saving is right on every date. Nothing is sent anywhere.') }));
      bodyEl.append(wrap);
      draw();
    }

    /* ============================ STOPWATCH ============================ */
    const swNow = () => S.sw.running ? (performance.now() - S.sw.base) : S.sw.elapsed;

    function mountStopwatch() {
      const readout = h('div.clk__readout.clk__mono', { role: 'timer', 'aria-live': 'off', text: fmtSW(swNow()) });
      const lapsEl = h('div.clk__laps', { role: 'list', 'aria-label': tr('Laps') });

      const startBtn = h('button.clk__big.clk__big--go', { type: 'button' });
      const lapResetBtn = h('button.clk__big.clk__big--alt', { type: 'button' });

      function syncButtons() {
        clear(startBtn); clear(lapResetBtn);
        startBtn.classList.toggle('is-stop', S.sw.running);
        startBtn.append(icon(S.sw.running ? 'pause' : 'play', { size: 16 }), S.sw.running ? tr('Stop') : tr('Start'));
        startBtn.setAttribute('aria-label', S.sw.running ? tr('Stop stopwatch') : tr('Start stopwatch'));
        const canLap = S.sw.running;
        lapResetBtn.append(icon(canLap ? 'plus' : 'rotate-ccw', { size: 16 }), canLap ? tr('Lap') : tr('Reset'));
        lapResetBtn.setAttribute('aria-label', canLap ? tr('Record lap') : tr('Reset stopwatch'));
        lapResetBtn.disabled = !S.sw.running && swNow() === 0;
      }

      startBtn.onclick = () => {
        if (S.sw.running) { S.sw.elapsed = swNow(); S.sw.running = false; }
        else { S.sw.base = performance.now() - S.sw.elapsed; S.sw.running = true; }
        syncButtons(); pump();
      };
      lapResetBtn.onclick = () => {
        if (S.sw.running) {
          const t = swNow();
          const prev = S.sw.laps.length ? S.sw.laps[S.sw.laps.length - 1].total : 0;
          S.sw.laps.push({ total: t, split: t - prev });
          drawLaps();
        } else {
          S.sw = { running: false, base: 0, elapsed: 0, laps: [] };
          readout.textContent = fmtSW(0);
          drawLaps(); syncButtons();
        }
      };

      function drawLaps() {
        clear(lapsEl);
        if (copyRow) copyRow.hidden = !S.sw.laps.length;
        if (!S.sw.laps.length) {
          lapsEl.appendChild(h('div.clk__laps-empty', { text: tr('Laps you record appear here.') }));
          return;
        }
        /* fastest / slowest highlight — only meaningful with 2+ laps */
        let fast = Infinity, slow = -Infinity;
        if (S.sw.laps.length > 1) for (const l of S.sw.laps) { fast = Math.min(fast, l.split); slow = Math.max(slow, l.split); }
        S.sw.laps.forEach((l, i) => {
          const cls = S.sw.laps.length > 1 && l.split === fast ? '.is-fast'
            : S.sw.laps.length > 1 && l.split === slow ? '.is-slow' : '';
          lapsEl.appendChild(h('div.clk__lap' + cls, { role: 'listitem' },
            h('span.clk__lap-n', { text: tr('Lap ') + (i + 1) }),
            h('span.clk__lap-split.clk__mono', { text: fmtSW(l.split) }),
            h('span.clk__lap-total.clk__mono', { text: fmtSW(l.total) })));
        });
      }

      /* the laps as text (for a message) or CSV (for a spreadsheet) */
      const lapText = () => ['Lap\tLap time\tTotal', ...S.sw.laps.map((l, i) => `${i + 1}\t${fmtSW(l.split)}\t${fmtSW(l.total)}`)].join('\n');
      const secs = ms => (Math.floor(ms / 10) / 100).toFixed(2);        /* centiseconds, as shown */
      const lapCsv = () => ['Lap,Lap time (s),Total (s)', ...S.sw.laps.map((l, i) => `${i + 1},${secs(l.split)},${secs(l.total)}`)].join('\r\n');
      const copyRow = h('div.clk__lapcopy',
        h('button.clk__btn', { type: 'button', dataset: { act: 'laps-text' }, onclick: () => copyOut(lapText(), plural(S.sw.laps.length, '{n} lap as text', '{n} laps as text')) }, icon('copy', { size: 14 }), tr('Copy as text')),
        h('button.clk__btn', { type: 'button', dataset: { act: 'laps-csv' }, onclick: () => copyOut(lapCsv(), plural(S.sw.laps.length, '{n} lap as CSV', '{n} laps as CSV')) }, icon('table', { size: 14 }), tr('Copy as CSV')));
      R.swReadout = readout;
      drawLaps(); syncButtons();
      R.swSync = syncButtons;
      bodyEl.append(h('div.clk__sw', readout, h('div.clk__row', startBtn, lapResetBtn), lapsEl, copyRow));
    }

    function tickStopwatch() {
      if (R.swReadout) R.swReadout.textContent = fmtSW(swNow());
    }

    /* ============================== TIMERS ==============================
       Several named timers at once (js/core/alarms.js keeps them and rings
       them, window or not); each has its own sound. */
    const soundSelect = (value, label) => h('select.clk__select.clk__sound', { 'aria-label': label },
      ...sfx.ALARMS.map(s => h('option', { value: s.id, text: s.name, selected: s.id === value ? '' : null })));
    const hearBtn = sel => h('button.clk__x.clk__hear', { type: 'button', 'aria-label': tr('Hear this sound'), title: tr('Hear it'), onclick: () => { sfx.unlock(); sfx.alarm(sel.value); } }, icon('volume-2', { size: 14 }));

    /* what is ringing now, with Stop (and Snooze for an alarm) — on the Timers and Alarm tabs */
    function ringBanner(kind) {
      const list = AL.ringing().filter(r => r.kind === kind);
      if (!list.length) return null;
      return h('div.clk__ringing', { role: 'alert' }, ...list.map(r => h('div.clk__ring-row', { dataset: { id: r.id } },
        icon(kind === 'alarm' ? 'bell' : 'clock', { size: 16 }), h('b', { text: r.title }),
        kind === 'alarm' ? h('button.clk__btn', { type: 'button', dataset: { act: 'snooze' }, onclick: () => AL.snooze(r.id) }, tr('Snooze {m} min', { m: (AL.alarms().find(a => a.id === r.id) || { snooze: 10 }).snooze })) : null,
        h('button.clk__btn.clk__btn--add', { type: 'button', dataset: { act: 'stop' }, onclick: () => AL.stop(r.id) }, tr('Stop')))));
    }

    function mountTimer() {
      const inName = h('input.clk__label-in.clk__tname', { type: 'text', maxlength: '40', placeholder: tr('Name, like Pasta or Quiz'), 'aria-label': tr('Timer name') });
      const inH = h('input.clk__num.clk__num--sm', { type: 'number', min: '0', max: '23', value: '0', 'aria-label': tr('Hours') });
      const inM = h('input.clk__num.clk__num--sm', { type: 'number', min: '0', max: '59', value: '5', 'aria-label': tr('Minutes') });
      const inS = h('input.clk__num.clk__num--sm', { type: 'number', min: '0', max: '59', value: '0', 'aria-label': tr('Seconds') });
      const sound = soundSelect(store.get('prefs.clock.timerSound', 'bells'), tr('Timer sound'));
      sound.addEventListener('change', () => store.set('prefs.clock.timerSound', sound.value));
      const clampInt = (el, max) => Math.max(0, Math.min(max, Math.floor(Number(el.value) || 0)));
      const msFromInputs = () => (clampInt(inH, 23) * 3600 + clampInt(inM, 59) * 60 + clampInt(inS, 59)) * 1000;
      function add(start) {
        const ms = msFromInputs();
        if (ms <= 0) { notify({ app: 'Clock', icon: 'gauge', title: tr('Set a time first'), message: tr('Enter hours, minutes or seconds.'), timeout: 2600 }); return; }
        const t = AL.addTimer({ name: inName.value || tr('{len} timer', { len: AL.fmtLen(ms) }), ms, sound: sound.value, start });
        if (!t) { notify({ app: 'Clock', icon: 'gauge', title: tr('That’s a lot of timers'), message: tr('Up to {MAX_TIMERS} at once. Delete one first.', { MAX_TIMERS: AL.MAX_TIMERS }), timeout: 3000 }); return; }
        inName.value = '';
      }
      const presets = h('div.clk__presets', ...[1, 3, 5, 10, 25, 45].map(m => h('button.clk__chip', { type: 'button', text: tr('{m} min', { m }),
        onclick: () => { inH.value = '0'; inM.value = String(m); inS.value = '0'; } })));
      const form = h('div.clk__tform',
        h('div.clk__addbar', inName),
        h('div.clk__setter.clk__setter--row',
          h('label.clk__field', inH, h('span', { text: tr('hrs') })),
          h('label.clk__field', inM, h('span', { text: tr('min') })),
          h('label.clk__field', inS, h('span', { text: tr('sec') })),
          h('div.clk__tsound', sound, hearBtn(sound))),
        presets,
        h('div.clk__row.clk__row--tight',
          h('button.clk__btn.clk__btn--add', { type: 'button', dataset: { act: 'add-start' }, onclick: () => add(true) }, icon('play', { size: 14 }), tr('Start')),
          h('button.clk__btn', { type: 'button', dataset: { act: 'add' }, onclick: () => add(false) }, icon('plus', { size: 14 }), tr('Add for later'))));

      const list = h('div.clk__tlist', { role: 'list', 'aria-label': tr('Timers') });
      const banner = h('div');
      R.timerEls = new Map();
      function draw() {
        render(banner, ringBanner('timer'));
        clear(list);
        R.timerEls.clear();
        const ts = AL.timers();
        if (!ts.length) {
          list.appendChild(h('div.clk__empty', icon('gauge', { size: 22 }), h('b', { text: tr('No timers yet') }), h('small', { text: tr('Name one and give it a time — run as many as you need at once.') })));
          return;
        }
        for (const t of ts) {
          const readout = h('div.clk__tread.clk__mono', { role: 'timer', 'aria-live': 'off' });
          const bar = h('i');
          const state = h('small.clk__tstate');
          const running = t.status === 'running';
          const ring = AL.ringing().some(r => r.id === t.id);
          const card = h('div.clk__tcard', { role: 'listitem', class: `is-${t.status}${ring ? ' is-ringing' : ''}`, dataset: { id: t.id, status: t.status } },
            h('div.clk__thead', h('b.clk__tname2', { text: t.name }), readout),
            h('div.clk__tbar', bar),
            h('div.clk__tfoot', state,
              ring ? h('button.clk__btn.clk__btn--add', { type: 'button', dataset: { act: 'stop' }, onclick: () => AL.stop(t.id) }, tr('Stop')) : null,
              h('button.clk__btn', { type: 'button', dataset: { act: 'go' }, 'aria-label': `${running ? 'Pause' : t.status === 'paused' ? 'Resume' : 'Start'} ${t.name}`,
                onclick: () => (running ? AL.pauseTimer(t.id) : AL.startTimer(t.id)) },
                icon(running ? 'pause' : 'play', { size: 14 }), running ? tr('Pause') : t.status === 'paused' ? tr('Resume') : t.status === 'done' ? tr('Again') : tr('Start')),
              h('button.clk__x', { type: 'button', dataset: { act: 'reset' }, 'aria-label': tr('Reset {name}', { name: t.name }), title: tr('Reset'), onclick: () => AL.resetTimer(t.id) }, icon('rotate-ccw', { size: 14 })),
              h('button.clk__x', { type: 'button', dataset: { act: 'delete' }, 'aria-label': tr('Delete {name}', { name: t.name }), title: tr('Delete'), onclick: () => AL.removeTimer(t.id) }, icon('trash', { size: 14 }))));
          R.timerEls.set(t.id, { readout, bar, state, t });
          list.appendChild(card);
        }
        tickTimers();
      }
      R.timerDraw = draw;
      draw();
      bodyEl.append(h('div.clk__timers', banner, form, list,
        h('p.clk__note', { text: tr('Timers only ring while StaticOS is open — a closed or background tab can’t wake itself. They keep going with this window closed, and the browser lets them make a sound once you have clicked or typed on the page.') })));
    }

    function tickTimers() {
      if (!R.timerEls) return;
      const now = Date.now();
      for (const { readout, bar, state, t } of R.timerEls.values()) {
        const left = AL.left(t, now);
        readout.textContent = fmtTimer(left);
        bar.style.width = `${t.total ? Math.max(0, Math.min(100, (left / t.total) * 100)) : 0}%`;
        state.textContent = t.status === 'running' ? tr('Ends {time} · {len}', { time: new Date(t.endAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24() }), len: AL.fmtLen(t.total) })
          : t.status === 'paused' ? tr('Paused · {len}', { len: AL.fmtLen(t.total) }) : t.status === 'done' ? tr('Done · {len}', { len: AL.fmtLen(t.total) }) : tr('Ready · {len}', { len: AL.fmtLen(t.total) });
      }
    }

    /* ============================== ALARM ==============================
       Kept and rung by js/core/alarms.js. Each alarm has repeat days (none:
       once), a snooze length and a sound. */
    function dayChips(days, onChange, label) {
      const sel = new Set(days);
      const wrap = h('div.clk__days', { role: 'group', 'aria-label': label });
      const say = h('small.clk__daysay');
      const paint = () => {
        for (const b of wrap.querySelectorAll('button')) { const on = sel.has(Number(b.dataset.day)); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
        say.textContent = AL.repeatText([...sel].sort());
      };
      for (const d of [1, 2, 3, 4, 5, 6, 0]) {
        wrap.appendChild(h('button.clk__day', { type: 'button', text: DOW[d], 'aria-label': DOW_NAME[d], dataset: { day: String(d) },
          onclick: () => { if (sel.has(d)) sel.delete(d); else sel.add(d); paint(); onChange([...sel].sort()); } }));
      }
      wrap.appendChild(say);
      paint();
      return wrap;
    }
    const snoozeSelect = (value, label) => h('select.clk__select.clk__snooze', { 'aria-label': label },
      ...AL.SNOOZES.map(m => h('option', { value: String(m), text: tr('Snooze {m} min', { m }), selected: m === value ? '' : null })));

    function mountAlarm() {
      const timeInput = h('input.clk__time', { type: 'time', 'aria-label': tr('Alarm time'), value: nextRoundTime() });
      const labelInput = h('input.clk__label-in', { type: 'text', 'aria-label': tr('Alarm label'), placeholder: tr('Label (optional)'), maxlength: '40' });
      let days = [0, 1, 2, 3, 4, 5, 6];
      const days0 = dayChips(days, d => { days = d; }, tr('Repeat on'));
      const sound = soundSelect(store.get('prefs.clock.alarmSound', 'bells'), tr('Alarm sound'));
      sound.addEventListener('change', () => store.set('prefs.clock.alarmSound', sound.value));
      const snooze = snoozeSelect(10, tr('Snooze length'));
      const addBtn = h('button.clk__btn.clk__btn--add', { type: 'button', 'aria-label': tr('Add alarm'), onclick: addAlarm },
        icon('plus', { size: 14 }), tr('Add'));

      function addAlarm() {
        const time = timeInput.value;
        if (!time) { notify({ app: 'Clock', icon: 'bell', title: tr('Pick a time'), message: tr('Choose an alarm time first.'), timeout: 2400 }); return; }
        const a = AL.addAlarm({ time, label: labelInput.value, days, sound: sound.value, snooze: Number(snooze.value) });
        if (!a) { notify({ app: 'Clock', icon: 'bell', title: tr('Couldn’t add it'), message: tr('That’s the most alarms there can be.'), timeout: 2600 }); return; }
        labelInput.value = '';
      }

      const banner = h('div');
      const list = h('div.clk__alarms', { role: 'list' });
      const open = new Set();
      function drawAlarms() {
        render(banner, ringBanner('alarm'));
        clear(list);
        const as = AL.alarms().sort((x, y) => x.time.localeCompare(y.time));
        if (!as.length) {
          list.appendChild(h('div.clk__empty', icon('bell', { size: 22 }),
            h('b', { text: tr('No alarms set') }),
            h('small', { text: tr('Add one above and it will ring at that minute.') })));
          return;
        }
        for (const a of as) {
          const toggle = h(a.enabled ? 'button.clk__switch.is-on' : 'button.clk__switch', {
            type: 'button', role: 'switch', 'aria-checked': String(a.enabled),
            'aria-label': a.enabled ? tr('Disable alarm at {time}', { time: a.time }) : tr('Enable alarm at {time}', { time: a.time }),
            onclick: () => AL.updateAlarm(a.id, { enabled: !a.enabled, lastFired: '', snoozeUntil: 0 }),
          }, h('span.clk__switch-knob'));
          const soundName = (sfx.ALARMS.find(s => s.id === a.sound) || sfx.ALARMS[0]).name;
          const snoozed = a.snoozeUntil ? ' · ' + tr('snoozed until {time}', { time: new Date(a.snoozeUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24() }) }) : '';
          const isOpen = open.has(a.id);
          const editBtn = h('button.clk__x', { type: 'button', 'aria-expanded': String(isOpen), 'aria-label': tr('Repeat, snooze and sound for the alarm at {time}', { time: a.time }), title: tr('Repeat, snooze and sound'),
            onclick: () => { if (open.has(a.id)) open.delete(a.id); else open.add(a.id); drawAlarms(); } }, icon('sliders', { size: 14 }));
          list.appendChild(h('div.clk__alarm' + (a.enabled ? '' : '.is-off'), { role: 'listitem', dataset: { id: a.id } },
            h('div.clk__alarm-main',
              h('div.clk__alarm-time.clk__mono', { text: clockText(a.time) }),
              a.label ? h('div.clk__alarm-label', { text: a.label }) : h('div.clk__alarm-label.is-muted', { text: tr('Alarm') }),
              h('div.clk__alarm-meta', { text: tr('{repeat} · snooze {min} min · {sound}{snoozed}', { repeat: AL.repeatText(a.days), min: a.snooze, sound: soundName, snoozed }) })),
            toggle, editBtn,
            h('button.clk__x', {
              type: 'button', 'aria-label': tr('Delete alarm at ') + a.time,
              onclick: () => AL.removeAlarm(a.id),
            }, icon('trash', { size: 14 }))));
          if (isOpen) {
            const sSel = soundSelect(a.sound, tr('Sound for the alarm at {time}', { time: a.time }));
            sSel.addEventListener('change', () => AL.updateAlarm(a.id, { sound: sSel.value }));
            const zSel = snoozeSelect(a.snooze, tr('Snooze length for the alarm at {time}', { time: a.time }));
            zSel.addEventListener('change', () => AL.updateAlarm(a.id, { snooze: Number(zSel.value) }));
            list.appendChild(h('div.clk__aedit', { dataset: { id: a.id } },
              dayChips(Array.isArray(a.days) ? a.days : [0, 1, 2, 3, 4, 5, 6], d => AL.updateAlarm(a.id, { days: d, lastFired: '' }), tr('Repeat days for the alarm at {time}', { time: a.time })),
              h('div.clk__aopts', sSel, hearBtn(sSel), zSel)));
          }
        }
      }
      R.alarmDraw = drawAlarms;
      drawAlarms();

      bodyEl.append(h('div.clk__alarm-view',
        banner,
        h('div.clk__aform',
          h('div.clk__addbar.clk__addbar--alarm', timeInput, labelInput, addBtn),
          days0,
          h('div.clk__aopts', sound, hearBtn(sound), snooze)),
        list,
        h('p.clk__note', { text: tr('Alarms only ring while StaticOS is open in this tab — they keep going with this window closed, but a closed or backgrounded page can’t wake itself, and the browser lets it make a sound once you have clicked or typed on the page. Pick no days for an alarm that rings once.') })));
    }

    function nextRoundTime() {
      const d = new Date(Date.now() + 60000); // a minute ahead so a fresh alarm is in the future
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    /* the timers and alarms changed, or began or stopped ringing: redraw what shows them */
    const onAlarms = () => {
      if (S.dead) return;
      if (S.tab === 'timer') R.timerDraw?.();
      if (S.tab === 'alarm') R.alarmDraw?.();
      pump();
    };
    const offAlChange = api.bus.on('clock:change', onAlarms);
    const offAlRing = api.bus.on('clock:ring', onAlarms);

    /* ============================ COUNTDOWN ============================
       Calendar days to a date: Static Study's coming exams (js/core/exams.js),
       and dates you add here — fixed-date holidays one click away, yearly
       ones rolling on to next year. Under two days it counts the time too. */
    const countdowns = () => (Array.isArray(store.get(CD_KEY, null)) ? store.get(CD_KEY) : []).filter(c => c && typeof c.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date));
    const atOf = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [H, M] = time ? time.split(':').map(Number) : [23, 59]; return new Date(y, m - 1, d, H, M, time ? 0 : 59, time ? 0 : 999).getTime(); };
    const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    /** what to count down to, soonest first: { id, name, date, time, at, kind: 'exam' | 'mine', yearly } */
    function countdownItems(now = Date.now()) {
      const out = [];
      for (const e of EX.read().exams) if (!EX.isPast(e, now)) out.push({ id: e.id, name: tr('{subject} test', { subject: e.subject }), date: e.date, time: e.time, at: EX.examAt(e), kind: 'exam' });
      for (const c of countdowns()) {
        let date = c.date;
        if (c.yearly) {
          /* the next time it comes round: this year's, or next year's once it has gone by */
          const [, m, d] = date.split('-').map(Number);
          let y = new Date(now).getFullYear();
          while (atOf(`${y}-${pad2(m)}-${pad2(d)}`, c.time) < now && y < 9999) y++;
          date = ymdOf(new Date(y, m - 1, d));
        }
        out.push({ id: c.id, name: c.name, date, time: c.time || '', at: atOf(date, c.time), kind: 'mine', yearly: !!c.yearly });
      }
      return out.sort((a, b) => (a.at < now) - (b.at < now) || a.at - b.at);
    }
    /** { main: '48 days' | 'Tomorrow' | 'Today' | 'Passed …', live: '5:02:11' | '' } */
    function cdText(x, now = Date.now()) {
      const days = EX.daysBetween(EX.todayOf(now), x.date);
      const left = x.at - now;
      const live = left > 0 && left <= 48 * 3600_000 ? fmtTimer(left) : '';
      if (left < 0) return { main: days === 0 ? tr('Earlier today') : plural(-days, 'Passed {n} day ago', 'Passed {n} days ago'), live: '' };
      return { main: days === 0 ? tr('Today') : days === 1 ? tr('Tomorrow') : plural(days, '{n} day', '{n} days'), live };
    }
    function mountCountdown() {
      const nameIn = h('input.clk__label-in', { type: 'text', maxlength: '40', placeholder: tr('What, like Spring break'), 'aria-label': tr('Countdown name') });
      const dateIn = h('input.clk__time.clk__cddate', { type: 'date', 'aria-label': tr('Date') });
      const timeIn = h('input.clk__time.clk__cdtime', { type: 'time', 'aria-label': tr('Time (optional)') });
      const yearlyIn = h('input', { type: 'checkbox', 'aria-label': tr('Every year') });
      const save = list => store.set(CD_KEY, list.slice(0, 40));
      function add(name, date, time, yearly) {
        const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!n) { notify({ app: 'Clock', icon: 'calendar', title: tr('Name it first'), message: tr('What are you counting down to?'), timeout: 2400 }); return false; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { notify({ app: 'Clock', icon: 'calendar', title: tr('Pick a date'), message: tr('Choose the day it happens.'), timeout: 2400 }); return false; }
        save([...countdowns(), { id: 'c' + Date.now().toString(36), name: n, date, time: /^\d{2}:\d{2}$/.test(time || '') ? time : '', yearly: !!yearly }]);
        return true;
      }
      const have = () => new Set(countdowns().map(c => c.name));
      const chips = h('div.clk__presets');
      const list = h('div.clk__cdlist', { role: 'list', 'aria-label': tr('Countdowns') });
      function draw() {
        const now = Date.now();
        render(chips, HOLIDAYS.filter(([n]) => !have().has(n)).map(([n, m, d]) => h('button.clk__chip', { type: 'button', dataset: { holiday: n },
          'aria-label': tr('Count down to {n}, {d} {month}, every year', { n, d, month: new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: 'long' }) }),
          onclick: () => { if (add(n, `${new Date(now).getFullYear()}-${pad2(m)}-${pad2(d)}`, '', true)) draw(); } }, icon('plus', { size: 12 }), n)));
        clear(list);
        R.cdRows = [];
        const items = countdownItems(now);
        if (!items.length) {
          list.appendChild(h('div.clk__empty', icon('calendar', { size: 22 }), h('b', { text: tr('Nothing to count down to') }),
            h('small', { text: tr('Add a date below, a holiday above, or a test in Static Study › Exams.') })));
          return;
        }
        for (const x of items) {
          const main = h('b.clk__cdmain.clk__mono'), live = h('small.clk__cdlive.clk__mono');
          const when = new Date(x.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (x.time ? ` · ${clockText(x.time)}` : '');
          list.appendChild(h('div.clk__cd', { role: 'listitem', dataset: { id: x.id, kind: x.kind }, class: x.at < now ? 'is-past' : '' },
            h('div.clk__cdinfo', h('b', { text: x.name }), h('small', { text: `${when}${x.kind === 'exam' ? ' · from Static Study' : x.yearly ? ' · every year' : ''}` })),
            h('div.clk__cdleft', main, live),
            x.kind === 'exam'
              ? h('button.clk__x', { type: 'button', 'aria-label': tr('Open {name} in Static Study', { name: x.name }), title: tr('Open in Static Study'), onclick: () => api.openApp('study', { tab: 'exams' }) }, icon('external-link', { size: 14 }))
              : h('button.clk__x', { type: 'button', 'aria-label': tr('Remove {name}', { name: x.name }), onclick: () => { save(countdowns().filter(c => c.id !== x.id)); draw(); } }, icon('x', { size: 14 }))));
          R.cdRows.push({ x, main, live });
        }
        tickCountdown();
      }
      R.cdDraw = draw;
      draw();
      bodyEl.append(h('div.clk__countdown',
        h('div.clk__cdhead', h('span.clk__fhist-h', { text: tr('Holidays on a fixed date') }), chips),
        list,
        h('div.clk__aform',
          h('div.clk__addbar', nameIn),
          h('div.clk__addbar', dateIn, timeIn,
            h('label.clk__check', yearlyIn, h('span', { text: tr('Every year') })),
            h('button.clk__btn.clk__btn--add', { type: 'button', 'aria-label': tr('Add countdown'), onclick: () => { if (add(nameIn.value, dateIn.value, timeIn.value, yearlyIn.checked)) { nameIn.value = ''; dateIn.value = ''; timeIn.value = ''; yearlyIn.checked = false; draw(); } } }, icon('plus', { size: 14 }), tr('Add')))),
        h('p.clk__note', { text: tr('Days are calendar days, counted from today’s date, so a clock change can’t make one early or late. A date with no time counts to the end of that day.') })));
    }
    function tickCountdown() {
      const now = Date.now();
      for (const r of R.cdRows || []) {
        const t = cdText(r.x, now);
        r.main.textContent = t.main;
        r.live.textContent = t.live;
        r.live.hidden = !t.live;
      }
    }

    /* ============================== FOCUS ============================== */
    /* The timer itself lives in js/core/focus.js, so it keeps time, rings
       and silences notifications with this window closed; this tab is its
       face. Every number is read from there: the remaining time from the
       stored end time, the history from completed sessions. */
    const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
    function mountFocus() {
      const R_ = 52, C = 2 * Math.PI * R_;
      const ring = h('circle.clk__ring-fg', { cx: 64, cy: 64, r: R_, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': '0' });
      const readout = h('div.clk__ring-label.clk__mono', { role: 'timer', 'aria-live': 'off' });
      const phaseEl = h('div.clk__fphase', { 'aria-live': 'polite' });
      const dial = h('div.clk__dial.clk__dial--focus',
        h('svg.clk__ring', { viewBox: '0 0 128 128', 'aria-hidden': 'true' }, h('circle.clk__ring-bg', { cx: 64, cy: 64, r: R_ }), ring),
        readout);
      const dots = h('div.clk__fdots', { role: 'img' });

      /* what the next session is for: it is logged under that name, so the
         minutes add up by subject (Static Study and Static Tasks name theirs too) */
      const whatListId = `clk-what-${Math.random().toString(36).slice(2, 8)}`;
      const whatList = h('datalist', { id: whatListId });
      const whatIn = h('input.clk__label-in.clk__fwhat', { type: 'text', maxlength: String(FOCUS.WHAT_MAX || 80), list: whatListId,
        placeholder: tr('What are you focusing on? (optional)'), 'aria-label': tr('What this focus session is for'),
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } } });
      const whatNames = () => {
        const names = Object.keys(FOCUS.onWhat(120));
        for (const e of EX.read().exams) if (!EX.isPast(e)) names.push(e.subject);
        return [...new Set(names)].slice(0, 40);
      };
      function go() {
        const f = FOCUS.state();
        const what = whatIn.value.trim();
        if (f.status === 'ready' && f.phase === 'focus' && what) { FOCUS.startOn(what); whatIn.value = ''; }
        else FOCUS.toggle();
      }
      const goBtn = h('button.clk__big.clk__big--go', { type: 'button', onclick: go });
      const skipBtn = h('button.clk__big.clk__big--alt', { type: 'button', onclick: () => { FOCUS.skip(); } });
      const resetBtn = h('button.clk__big.clk__big--alt', { type: 'button', 'aria-label': tr('Reset focus timer'), onclick: () => { FOCUS.reset(); } },
        icon('rotate-ccw', { size: 16 }), tr('Reset'));

      /* settings: lengths in minutes, the long-break rhythm, focus mode */
      const cfg = FOCUS.config();
      const num = (key, label, max, unit) => {
        const input = h('input.clk__num.clk__num--sm', {
          type: 'number', min: key === 'every' ? '2' : '1', max: String(max), value: String(cfg[key]),
          'aria-label': label, dataset: { focus: key },
          onchange: () => { const v = FOCUS.configure({ [key]: input.value }); input.value = String(v[key]); },
        });
        return h('label.clk__field', input, h('span', { text: unit }));
      };
      const dndSw = h('button.clk__switch', {
        type: 'button', role: 'switch', 'aria-label': tr('Silence notifications while focusing'),
        onclick: () => { FOCUS.configure({ dnd: !FOCUS.config().dnd }); syncDnd(); },
      }, h('span.clk__switch-knob'));
      const syncDnd = () => { const on = FOCUS.config().dnd; dndSw.classList.toggle('is-on', on); dndSw.setAttribute('aria-checked', String(on)); };
      syncDnd();

      const todayEl = h('div.clk__ftoday');
      const weekEl = h('div.clk__fweek', { role: 'list', 'aria-label': tr('Focus minutes and sessions, last 7 days') });
      const subjEl = h('div.clk__fsubj', { role: 'list', 'aria-label': tr('Focus minutes by subject, last 7 days') });

      /* every number here is from the focus log: finished sessions only */
      function paintHistory() {
        const t = FOCUS.today();
        const days = FOCUS.history(7);
        const week = days.reduce((a, d) => ({ n: a.n + d.n, min: a.min + d.min }), { n: 0, min: 0 });
        render(todayEl,
          h('div.clk__fstat', h('b.clk__mono', { text: String(t.n) }), h('small', { text: t.n === 1 ? tr('session today') : tr('sessions today') })),
          h('div.clk__fstat', h('b.clk__mono', { text: fmtMin(t.min) }), h('small', { text: tr('focused today') })),
          h('div.clk__fstat', { dataset: { fk: 'week' } }, h('b.clk__mono', { text: fmtMin(week.min) }), h('small', { text: tr('last 7 days · {sessions}', { sessions: plural(week.n, '{n} session', '{n} sessions') }) })));
        const most = Math.max(1, ...days.map(d => d.min));
        render(weekEl, days.map((d, i) => {
          const date = new Date(`${d.key}T12:00:00`);
          const name = i === days.length - 1 ? tr('Today') : date.toLocaleDateString(undefined, { weekday: 'short' });
          const said = `${name}: ${plural(d.n, '{n} session', '{n} sessions')}, ${d.min} min`;
          return h('div.clk__fday', { role: 'listitem', title: said, 'aria-label': said, class: i === days.length - 1 ? 'is-today' : null, dataset: { day: d.key, min: String(d.min) } },
            h('div.clk__fday-col', h('i', { style: { height: d.min ? `${Math.max(8, Math.round((d.min / most) * 100))}%` : '0' } })),
            h('em', { text: d.min ? `${d.min}m` : '' }),
            h('small', { text: String(d.n) }),
            h('span', { text: name }));
        }));
        const by = FOCUS.onWhat(7), today = FOCUS.onWhat(1);
        const rows = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const top = Math.max(1, ...rows.map(r => r[1]));
        render(subjEl, rows.length ? rows.map(([name, min]) => h('div.clk__fsrow', { role: 'listitem', dataset: { what: name, min: String(min) } },
          h('span.clk__fsname', { text: name }),
          h('span.clk__fsbar', h('i', { style: { width: `${Math.max(3, Math.round(min / top * 100))}%` } })),
          h('small', { text: `${fmtMin(min)}${today[name] ? ' · ' + tr('{time} today', { time: fmtMin(today[name]) }) : ''}` })))
          : h('small.clk__fsnone', { text: tr('Name a session above — or start one on a subject in Static Study or Static Tasks — and its minutes add up here by subject.') }));
        render(whatList, whatNames().map(n => h('option', { value: n })));
      }

      function update() {
        const f = FOCUS.state();
        readout.textContent = fmtTimer(f.left);
        ring.setAttribute('stroke-dashoffset', (C * (1 - (f.len ? f.left / f.len : 0))).toFixed(2));
        dial.classList.toggle('is-break', f.phase !== 'focus');
        /* "Focus on this" from Static Tasks names what the session is for */
        const lbl = f.what ? `${f.label}: ${f.what}` : f.label;
        phaseEl.textContent = f.status === 'paused' ? tr('{label} · paused', { label: lbl }) : lbl;
        whatIn.hidden = !(f.status === 'ready' && f.phase === 'focus');
        clear(goBtn);
        const running = f.status === 'running';
        goBtn.classList.toggle('is-stop', running);
        goBtn.append(icon(running ? 'pause' : 'play', { size: 16 }), running ? tr('Pause') : f.status === 'paused' ? tr('Resume') : tr('Start'));
        goBtn.setAttribute('aria-label', tr('{action} {label}', { action: running ? tr('Pause') : f.status === 'paused' ? tr('Resume') : tr('Start'), label: f.label.toLowerCase() }));
        clear(skipBtn);
        skipBtn.append(icon('skip-forward', { size: 16 }), tr('Skip'));
        skipBtn.setAttribute('aria-label', tr('Skip {label}', { label: f.label.toLowerCase() }));
        /* one dot per focus session until the long break */
        const filled = f.phase === 'focus' ? f.session - 1 : f.session;
        render(dots, Array.from({ length: f.every }, (_, i) => h('i', { class: i < filled ? 'is-on' : null })));
        dots.setAttribute('aria-label', tr('Session {session} of {every}', { session: f.session, every: f.every }));
      }

      R.focusUpdate = update;
      R.focusHistory = paintHistory;
      update(); paintHistory();
      bodyEl.append(h('div.clk__focus',
        phaseEl, dial, dots, whatIn, whatList,
        h('div.clk__row', goBtn, skipBtn, resetBtn),
        h('div.clk__fset',
          h('div.clk__fset-row',
            num('focus', tr('Focus length in minutes'), 180, 'focus'),
            num('short', tr('Break length in minutes'), 60, 'break'),
            num('long', tr('Long break length in minutes'), 90, 'long break'),
            num('every', tr('Long break after this many sessions'), 12, 'sessions')),
          h('div.clk__fdnd', h('div', h('b', { text: tr('Silence notifications while focusing') }),
            h('small', { text: tr('Turns on Do Not Disturb for each focus session and puts it back as it was afterwards. The timer’s own end note still comes through.') })), dndSw)),
        h('div.clk__fhist', h('div.clk__fhist-h', { text: tr('Your focus') }), todayEl, weekEl,
          h('div.clk__fhist-h', { text: tr('By subject, last 7 days') }), subjEl),
        h('p.clk__note', { text: tr('Minutes are counted from completed sessions on this device. The timer keeps time from the clock, so a reload or a sleeping laptop can’t throw it off — but it can only ring while StaticOS is open.') })));
    }

    const offFocus = api.bus.on('focus:change', () => {
      if (S.dead || S.tab !== 'focus') return;
      R.focusUpdate?.();
      R.focusHistory?.();
    });

    /* ============================ lifecycle ============================ */
    /* rAF pump: sub-second readouts for whichever counter is both running
       and on-screen. It only re-arms while something needs it, so an idle
       Clock costs nothing. */
    let rafId = 0;
    function pump() {
      if (S.dead) return;
      cancelAnimationFrame(rafId);
      const timing = () => S.tab === 'timer' && AL.timers().some(t => t.status === 'running');
      const need = (S.tab === 'stopwatch' && S.sw.running) || timing();
      if (!need) { rafId = 0; return; }
      const frame = () => {
        if (S.dead) return;
        if (S.tab === 'stopwatch' && S.sw.running) tickStopwatch();
        else if (S.tab === 'timer' && R.timerEls && [...R.timerEls.values()].some(x => x.t.status === 'running')) tickTimers();
        else { rafId = 0; return; }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
    }

    /* One steady heartbeat for the visible tab's wall clocks. (Alarms and
       timers are checked by js/core/alarms.js, window or not.) */
    let lastDay = new Date().toDateString();
    const beat = setInterval(() => {
      if (S.dead) return;
      if (S.tab === 'world') {
        tickWorld();
        /* a new day: today's sunrise and sunset */
        if (new Date().toDateString() !== lastDay) { lastDay = new Date().toDateString(); paintSun(); }
      }
      if (S.tab === 'focus') R.focusUpdate?.();
      if (S.tab === 'countdown') tickCountdown();
      /* the timers' readouts also refresh here in case rAF is throttled while backgrounded */
      if (S.tab === 'timer') tickTimers();
    }, 1000);

    root.cherriTeardown = () => {
      S.dead = true;
      clearInterval(beat);
      offFocus();
      offAlChange();
      offAlRing();
      closeClassClock();
      cancelAnimationFrame(rafId);
    };

    paintTabs();
    paintBody();
    pump();

    /* Return teardown too — wm invokes returned teardowns on close, which
       is what actually stops our timers (cherriTeardown is belt-and-braces). */
    return root.cherriTeardown;
  },
});
