/* ============================================================
   clock.js — Clock: World, Meet, Stopwatch, Timer, Alarm, Focus in one window.

   Five honest time tools that share one window and one lifecycle.
   Focus (Pomodoro sessions) is the face of js/core/focus.js, which
   keeps its time and rings with this window closed; opts.tab opens
   the window on a tab (the top bar's focus indicator asks for it).

   Design notes worth keeping:
   · Stopwatch/Timer measure with performance.now(), never Date.now()
     — a monotonic clock that no NTP correction or DST jump can drag
     backwards, so a running lap can't suddenly show negative time.
   · Everything the page CAN'T truthfully promise is stated plainly:
     an alarm/timer can only fire while StaticOS is the open page — a
     backgrounded tab cannot wake itself, so we say so instead of
     pretending to be a real OS alarm.
   · One 1s interval drives the wall-clock faces + the alarm/timer
     minute checks; a rAF pump (started only while a counter runs)
     drives the sub-second stopwatch/timer readouts, and paints only
     the tab you're actually looking at. Both are killed in teardown.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as FOCUS from '../core/focus.js';
import * as MEET from '../core/meeting.js';

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
  ['world', 'World', 'globe'],
  ['meet', 'Meet', 'users'],
  ['stopwatch', 'Stopwatch', 'activity'],
  ['timer', 'Timer', 'gauge'],
  ['alarm', 'Alarm', 'bell'],
  ['focus', 'Focus', 'flame'],
];

const DEFAULT_CITIES = [
  { tz: 'America/New_York', label: 'New York' },
  { tz: 'Europe/London', label: 'London' },
  { tz: 'Asia/Tokyo', label: 'Tokyo' },
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
  keywords: ['time', 'meeting', 'meeting planner', 'time zones', 'world clock', 'stopwatch', 'timer', 'alarm', 'timezone', 'lap', 'countdown', 'focus', 'pomodoro', 'study', 'break'],
  desc: 'World clock, a meeting planner across time zones, stopwatch, timer, alarm and focus sessions',
  pinned: true, dock: true, singleton: true,
  win: { w: 460, h: 560, minW: 360, minH: 460 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, render, clear, store, notify } = api;
    const isTab = id => TABS.some(t => t[0] === id);

    /* ------------------------------ state ------------------------------ */
    const S = {
      tab: isTab(opts?.tab) ? opts.tab : store.get('prefs.clock.tab', 'world'),
      dead: false,
      /* stopwatch — base is the performance.now() origin while running */
      sw: { running: false, base: 0, elapsed: 0, laps: [] },
      /* timer — remaining/total in ms; endAt is a performance.now() deadline */
      timer: { running: false, endAt: 0, remaining: 0, total: 0, fired: false },
    };

    const cities = () => store.get('prefs.clock.cities', null) || DEFAULT_CITIES;
    const alarms = () => store.get('prefs.clock.alarms', null) || [];

    /* ------------------------------ shell ------------------------------ */
    const tabsEl = h('div.clk__tabs', { role: 'tablist', 'aria-label': 'Clock sections' });
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
      if (zoneYMD > hereYMD) rel = 'Tomorrow';
      else if (zoneYMD < hereYMD) rel = 'Yesterday';
      return { time, day, rel };
    }

    function mountWorld() {
      const local = h('div.clk__local');
      const localName = h('div.clk__local-name');
      const localTime = h('div.clk__local-time', { 'aria-live': 'off' });
      const localDay = h('div.clk__local-day');
      local.append(localName, localTime, localDay);

      const list = h('div.clk__cities', { role: 'list' });

      /* add-a-city control: a real timezone list, no invented offsets */
      let zones = FALLBACK_ZONES;
      try { if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone'); } catch (e) { /* fallback stays */ }
      const select = h('select.clk__select', { 'aria-label': 'Choose a city to add' },
        h('option', { value: '', text: 'Add a city…' }),
        ...zones.map(tz => h('option', { value: tz, text: `${cityFromTz(tz)} — ${tz}` })));
      const addBtn = h('button.clk__btn.clk__btn--add', {
        type: 'button', 'aria-label': 'Add selected city',
        onclick: () => {
          const tz = select.value;
          if (!tz) return;
          const list0 = cities();
          if (list0.some(c => c.tz === tz)) { notify({ app: 'Clock', icon: 'clock', title: 'Already added', message: cityFromTz(tz), timeout: 2400 }); return; }
          store.set('prefs.clock.cities', [...list0, { tz, label: cityFromTz(tz) }]); // new array — store.set is identity-gated
          select.value = '';
          paintBody();
        },
      }, icon('plus', { size: 14 }), 'Add');

      R.rows = [];
      function drawCities() {
        clear(list);
        R.rows = [];
        const cs = cities();
        if (!cs.length) {
          list.appendChild(h('div.clk__empty', icon('globe', { size: 22 }),
            h('b', { text: 'No cities yet' }),
            h('small', { text: 'Pick one below to watch its time here.' })));
          return;
        }
        for (const c of cs) {
          const timeEl = h('div.clk__city-time');
          const dayEl = h('div.clk__city-day');
          const relEl = h('span.clk__city-rel');
          const row = h('div.clk__city', { role: 'listitem' },
            h('div.clk__city-info',
              h('div.clk__city-name', { text: c.label || cityFromTz(c.tz) }, relEl),
              dayEl),
            timeEl,
            h('button.clk__x', {
              type: 'button', 'aria-label': `Remove ${c.label || cityFromTz(c.tz)}`,
              onclick: () => { store.set('prefs.clock.cities', cities().filter(x => x.tz !== c.tz)); paintBody(); },
            }, icon('x', { size: 14 })));
          R.rows.push({ tz: c.tz, timeEl, dayEl, relEl });
          list.appendChild(row);
        }
      }
      drawCities();

      R.local = { localName, localTime, localDay };
      bodyEl.append(h('div.clk__world', local, list, h('div.clk__addbar', select, addBtn)));
      tickWorld(); // paint once immediately so there's no blank second
    }

    function tickWorld() {
      if (!R.local) return;
      const d = new Date();
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
      R.local.localName.textContent = cityFromTz(localTz) + '  ·  your time';
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
      const when = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12 }).format(new Date(ms));
      const clockOf = c => (hour12 ? `${c.h % 12 || 12}${c.mi ? ':' + pad2(c.mi) : ''}${c.h < 12 ? 'a' : 'p'}` : `${pad2(c.h)}${c.mi ? ':' + pad2(c.mi) : ''}`);

      const wrap = h('div.clk__meet');
      const hrs = Array.from({ length: 25 }, (_, i) => i);
      const hourText = n => (hour12 ? `${n % 12 || 12} ${n % 24 < 12 ? 'AM' : 'PM'}` : `${pad2(n % 24)}:00`);
      const dateIn = h('input.clk__select.clk__meet-date', { type: 'date', value: MEET_STATE.ymd, 'aria-label': 'Day for the grid',
        onchange: e => { if (MEET.validYmd(e.target.value)) { MEET_STATE.ymd = e.target.value; MEET_STATE.pick = null; draw(); } } });
      const startSel = h('select.clk__select.clk__meet-ws', { 'aria-label': 'Working day starts', onchange: e => setWork(Number(e.target.value), m.work.end) },
        hrs.slice(0, 24).map(n => h('option', { value: n, text: hourText(n), selected: n === m.work.start ? '' : null })));
      const endSel = h('select.clk__select.clk__meet-we', { 'aria-label': 'Working day ends', onchange: e => setWork(m.work.start, Number(e.target.value)) },
        hrs.slice(1).map(n => h('option', { value: n, text: hourText(n), selected: n === m.work.end ? '' : null })));
      function setWork(a, b) {
        if (a >= b) { notify({ app: 'Clock', icon: 'clock', title: 'Working hours', message: 'The day has to end after it starts.', timeout: 2600 }); startSel.value = m.work.start; endSel.value = m.work.end; return; }
        m.work = { start: a, end: b }; meetSave(m); draw();
      }
      const todayBtn = h('button.clk__btn', { type: 'button', onclick: () => { MEET_STATE.ymd = todayRef(); MEET_STATE.pick = null; dateIn.value = MEET_STATE.ymd; draw(); } }, 'Today');
      const ctl = h('div.clk__mctl',
        h('label.clk__mlab', h('span', { text: 'Day' }), dateIn), todayBtn,
        h('label.clk__mlab', h('span', { text: 'Working' }), startSel, h('span', { text: 'to' }), endSel));

      /* places */
      const chips = h('div.clk__mchips', { role: 'list', 'aria-label': 'Places' });
      const zones = MEET.zoneList();
      const filter = h('input.clk__select.clk__meet-find', { type: 'search', placeholder: 'Find a place…', 'aria-label': 'Search places', maxlength: '40',
        oninput: () => fillZones() });
      const zoneSel = h('select.clk__select.clk__meet-zone', { 'aria-label': 'Choose a place to add' });
      function fillZones() {
        const q = filter.value.trim().toLowerCase().replace(/\s+/g, '_');
        const list = zones.filter(z => !m.places.includes(z) && (!q || z.toLowerCase().includes(q))).slice(0, 300);
        zoneSel.replaceChildren(h('option', { value: '', text: list.length ? 'Add a place…' : 'No place matches' }),
          ...list.map(z => h('option', { value: z, text: `${MEET.cityOf(z)} — ${z}` })));
      }
      const addPlace = () => {
        const tz = zoneSel.value;
        if (!tz || !MEET.isZone(tz) || m.places.includes(tz)) return;
        if (m.places.length >= MAX_PLACES) { notify({ app: 'Clock', icon: 'clock', title: 'That’s enough places', message: `Up to ${MAX_PLACES} fit on the grid.`, timeout: 3000 }); return; }
        m.places = [...m.places, tz]; meetSave(m); filter.value = ''; draw();
      };
      const addBar = h('div.clk__addbar.clk__meet-add', filter, zoneSel,
        h('button.clk__btn.clk__btn--add', { type: 'button', 'aria-label': 'Add selected place', onclick: addPlace }, icon('plus', { size: 14 }), 'Add'));

      const gridEl = h('div.clk__mgrid', { role: 'grid', 'aria-label': 'Hours in each place. Choose an hour to see it everywhere' });
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
          h('div.clk__mres-h', h('b', { text: 'That moment in each place' }),
            h('button.clk__btn', { type: 'button', 'aria-label': 'Copy these times', onclick: async () => {
              const text = rows.map(r => `${MEET.cityOf(r.tz)}: ${when(MEET_STATE.pick, r.tz)}`).join('\n');
              try { await navigator.clipboard.writeText(text); notify({ app: 'Clock', icon: 'copy', title: 'Copied', message: `${rows.length} time${rows.length === 1 ? '' : 's'}`, timeout: 2200 }); }
              catch (e) { notify({ app: 'Clock', icon: 'alert', title: 'Could not copy', message: 'The clipboard is unavailable here.' }); }
            } }, icon('copy', { size: 14 }), 'Copy')),
          ...rows.map(r => h('div.clk__mrow2', { dataset: { tz: r.tz } },
            h('div.clk__mwho', h('b', { text: MEET.cityOf(r.tz) }), h('small', { text: `${r.tz} · ${MEET.offsetLabel(r.offset)}` })),
            h('div.clk__mwhen', { text: when(MEET_STATE.pick, r.tz) }),
            h('span.clk__mtag', { class: `is-${r.cls}`, text: CLS_WORD[r.cls] }),
            r.dst ? h('span.clk__mtag.is-dst', { title: 'This place’s clocks change at some point on this day', text: 'clocks change this day' }) : null)));
      }

      function draw() {
        chips.replaceChildren(...m.places.map((tz, i) => h('span.clk__mchip', { role: 'listitem', dataset: { tz } },
          h('b', { text: MEET.cityOf(tz) }),
          i === 0 ? h('small', { text: 'grid follows this day' }) : null,
          i > 0 ? h('button.clk__x', { type: 'button', 'aria-label': `Use ${MEET.cityOf(tz)}’s day for the grid`, title: 'Use this place’s day for the grid', onclick: () => makeRef(tz) }, icon('arrow-up', { size: 13 })) : null,
          h('button.clk__x', { type: 'button', 'aria-label': `Remove ${MEET.cityOf(tz)}`, onclick: () => removePlace(tz) }, icon('x', { size: 13 })))));
        fillZones();
        startSel.value = String(m.work.start); endSel.value = String(m.work.end);
        if (!m.places.length) {
          grid = null; gridEl.replaceChildren(); noteEl.textContent = '';
          gridEl.append(h('div.clk__empty', icon('globe', { size: 22 }), h('b', { text: 'No places yet' }), h('small', { text: 'Add where people are and the hours line up here.' })));
          paintResult(); return;
        }
        grid = MEET.buildGrid({ ymd: MEET_STATE.ymd, places: m.places, work: m.work });
        const ref = grid.ref;
        const n = grid.cols.length;
        noteEl.textContent = n === 24
          ? `${MEET.cityOf(ref)} has 24 hours on this day.`
          : `${MEET.cityOf(ref)}’s clocks change on this day, so it has ${n} hours.`;
        noteEl.classList.toggle('is-warn', n !== 24);
        const cols = `minmax(96px,120px) repeat(${n}, minmax(30px,1fr))`;
        const head = h('div.clk__mline.clk__mline--head', { role: 'row', style: { gridTemplateColumns: cols } },
          h('div.clk__mname', { role: 'columnheader', text: `${MEET.cityOf(ref)} (grid)` }),
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
        h('p.clk__note', { text: 'Times come from this browser’s own time zone data, for the day you pick, so daylight saving is right on every date. Nothing is sent anywhere.' }));
      bodyEl.append(wrap);
      draw();
    }

    /* ============================ STOPWATCH ============================ */
    const swNow = () => S.sw.running ? (performance.now() - S.sw.base) : S.sw.elapsed;

    function mountStopwatch() {
      const readout = h('div.clk__readout.clk__mono', { role: 'timer', 'aria-live': 'off', text: fmtSW(swNow()) });
      const lapsEl = h('div.clk__laps', { role: 'list', 'aria-label': 'Laps' });

      const startBtn = h('button.clk__big.clk__big--go', { type: 'button' });
      const lapResetBtn = h('button.clk__big.clk__big--alt', { type: 'button' });

      function syncButtons() {
        clear(startBtn); clear(lapResetBtn);
        startBtn.classList.toggle('is-stop', S.sw.running);
        startBtn.append(icon(S.sw.running ? 'pause' : 'play', { size: 16 }), S.sw.running ? 'Stop' : 'Start');
        startBtn.setAttribute('aria-label', S.sw.running ? 'Stop stopwatch' : 'Start stopwatch');
        const canLap = S.sw.running;
        lapResetBtn.append(icon(canLap ? 'plus' : 'rotate-ccw', { size: 16 }), canLap ? 'Lap' : 'Reset');
        lapResetBtn.setAttribute('aria-label', canLap ? 'Record lap' : 'Reset stopwatch');
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
        if (!S.sw.laps.length) {
          lapsEl.appendChild(h('div.clk__laps-empty', { text: 'Laps you record appear here.' }));
          return;
        }
        /* fastest / slowest highlight — only meaningful with 2+ laps */
        let fast = Infinity, slow = -Infinity;
        if (S.sw.laps.length > 1) for (const l of S.sw.laps) { fast = Math.min(fast, l.split); slow = Math.max(slow, l.split); }
        S.sw.laps.forEach((l, i) => {
          const cls = S.sw.laps.length > 1 && l.split === fast ? '.is-fast'
            : S.sw.laps.length > 1 && l.split === slow ? '.is-slow' : '';
          lapsEl.appendChild(h('div.clk__lap' + cls, { role: 'listitem' },
            h('span.clk__lap-n', { text: 'Lap ' + (i + 1) }),
            h('span.clk__lap-split.clk__mono', { text: fmtSW(l.split) }),
            h('span.clk__lap-total.clk__mono', { text: fmtSW(l.total) })));
        });
      }

      R.swReadout = readout;
      drawLaps(); syncButtons();
      R.swSync = syncButtons;
      bodyEl.append(h('div.clk__sw', readout, h('div.clk__row', startBtn, lapResetBtn), lapsEl));
    }

    function tickStopwatch() {
      if (R.swReadout) R.swReadout.textContent = fmtSW(swNow());
    }

    /* ============================== TIMER ============================== */
    const timerNow = () => S.timer.running ? Math.max(0, S.timer.endAt - performance.now()) : S.timer.remaining;

    function mountTimer() {
      const t = S.timer;
      const idle = !t.running && t.total === 0;

      /* SVG progress ring — circumference 2πr, r=52 */
      const R_ = 52, C = 2 * Math.PI * R_;
      const ring = h('circle.clk__ring-fg', { cx: 64, cy: 64, r: R_, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': '0' });
      const readout = h('div.clk__ring-label.clk__mono', { role: 'timer', 'aria-live': 'off' });
      const svg = h('svg.clk__ring', { viewBox: '0 0 128 128', 'aria-hidden': 'true' },
        h('circle.clk__ring-bg', { cx: 64, cy: 64, r: R_ }), ring);
      const dial = h('div.clk__dial', svg, readout);

      /* H / M / S steppers, shown only when idle/reset */
      const inH = h('input.clk__num', { type: 'number', min: '0', max: '23', 'aria-label': 'Hours', value: String(Math.floor(t.total / 3600000)) });
      const inM = h('input.clk__num', { type: 'number', min: '0', max: '59', 'aria-label': 'Minutes', value: String(Math.floor(t.total / 60000) % 60) });
      const inS = h('input.clk__num', { type: 'number', min: '0', max: '59', 'aria-label': 'Seconds', value: String(Math.floor(t.total / 1000) % 60) });
      const setter = h('div.clk__setter',
        h('label.clk__field', inH, h('span', { text: 'hrs' })),
        h('label.clk__field', inM, h('span', { text: 'min' })),
        h('label.clk__field', inS, h('span', { text: 'sec' })));

      const goBtn = h('button.clk__big.clk__big--go', { type: 'button' });
      const resetBtn = h('button.clk__big.clk__big--alt', { type: 'button' });

      const clampInt = (el, max) => Math.max(0, Math.min(max, Math.floor(Number(el.value) || 0)));
      const totalFromInputs = () => (clampInt(inH, 23) * 3600 + clampInt(inM, 59) * 60 + clampInt(inS, 59)) * 1000;

      function updateRing() {
        const rem = timerNow();
        readout.textContent = fmtTimer(rem);
        const frac = S.timer.total > 0 ? rem / S.timer.total : (idle ? 1 : 0);
        ring.setAttribute('stroke-dashoffset', (C * (1 - frac)).toFixed(2));
      }

      function syncButtons() {
        clear(goBtn); clear(resetBtn);
        goBtn.classList.toggle('is-stop', S.timer.running);
        goBtn.append(icon(S.timer.running ? 'pause' : 'play', { size: 16 }), S.timer.running ? 'Pause' : 'Start');
        goBtn.setAttribute('aria-label', S.timer.running ? 'Pause timer' : 'Start timer');
        resetBtn.append(icon('rotate-ccw', { size: 16 }), 'Reset');
        resetBtn.setAttribute('aria-label', 'Reset timer');
        setter.classList.toggle('is-hidden', !(!S.timer.running && S.timer.remaining === S.timer.total));
        dial.classList.toggle('is-hidden', !S.timer.running && S.timer.total === 0);
      }

      goBtn.onclick = () => {
        if (S.timer.running) {
          S.timer.remaining = timerNow();
          S.timer.running = false;
        } else {
          /* fresh start reads the inputs; resume keeps the paused remaining */
          if (!(S.timer.remaining > 0 && S.timer.remaining < S.timer.total)) {
            const total = totalFromInputs();
            if (total <= 0) { notify({ app: 'Clock', icon: 'gauge', title: 'Set a time first', message: 'Enter hours, minutes or seconds.', timeout: 2600 }); return; }
            S.timer.total = total; S.timer.remaining = total;
          }
          S.timer.endAt = performance.now() + S.timer.remaining;
          S.timer.running = true; S.timer.fired = false;
        }
        syncButtons(); updateRing(); pump();
      };
      resetBtn.onclick = () => {
        S.timer = { running: false, endAt: 0, remaining: 0, total: 0, fired: false };
        inH.value = '0'; inM.value = '0'; inS.value = '0';
        R.timerIdle = true;
        syncButtons(); updateRing();
      };

      R.timerUpdate = updateRing;
      R.timerSync = syncButtons;
      syncButtons(); updateRing();
      bodyEl.append(h('div.clk__timer', dial, setter,
        h('div.clk__row', goBtn, resetBtn),
        h('p.clk__note', { text: 'The timer only rings while StaticOS is open — a background tab can’t wake itself.' })));
    }

    function tickTimer() {
      if (R.timerUpdate) R.timerUpdate();
    }

    /* Runs on the 1s interval regardless of which tab is visible, so a
       timer set on the Timer tab still fires while you're on World. */
    function checkTimerExpiry() {
      const t = S.timer;
      if (!t.running || t.fired) return;
      if (performance.now() >= t.endAt) {
        t.running = false; t.remaining = 0; t.fired = true;
        notify({ app: 'Clock', icon: 'clock', title: 'Timer done', message: fmtTimer(t.total) + ' is up.', timeout: 0 });
        if (R.timerSync) R.timerSync();
        if (R.timerUpdate) R.timerUpdate();
      }
    }

    /* ============================== ALARM ============================== */
    function mountAlarm() {
      const timeInput = h('input.clk__time', { type: 'time', 'aria-label': 'Alarm time', value: nextRoundTime() });
      const labelInput = h('input.clk__label-in', { type: 'text', 'aria-label': 'Alarm label', placeholder: 'Label (optional)', maxlength: '40' });
      const addBtn = h('button.clk__btn.clk__btn--add', { type: 'button', 'aria-label': 'Add alarm', onclick: addAlarm },
        icon('plus', { size: 14 }), 'Add');

      function addAlarm() {
        const time = timeInput.value;
        if (!time) { notify({ app: 'Clock', icon: 'bell', title: 'Pick a time', message: 'Choose an alarm time first.', timeout: 2400 }); return; }
        const a = { id: 'a' + Date.now().toString(36), time, label: labelInput.value.trim(), enabled: true, lastFired: '' };
        store.set('prefs.clock.alarms', [...alarms(), a]); // new array so the identity-gated store actually writes
        labelInput.value = '';
        paintBody();
      }

      const list = h('div.clk__alarms', { role: 'list' });
      function drawAlarms() {
        clear(list);
        const as = alarms().slice().sort((x, y) => x.time.localeCompare(y.time));
        if (!as.length) {
          list.appendChild(h('div.clk__empty', icon('bell', { size: 22 }),
            h('b', { text: 'No alarms set' }),
            h('small', { text: 'Add one above and it will ring at that minute.' })));
          return;
        }
        for (const a of as) {
          const toggle = h(a.enabled ? 'button.clk__switch.is-on' : 'button.clk__switch', {
            type: 'button', role: 'switch', 'aria-checked': String(a.enabled),
            'aria-label': (a.enabled ? 'Disable' : 'Enable') + ' alarm at ' + a.time,
            onclick: () => {
              store.set('prefs.clock.alarms', alarms().map(x => x.id === a.id ? { ...x, enabled: !x.enabled, lastFired: '' } : x));
              paintBody();
            },
          }, h('span.clk__switch-knob'));
          list.appendChild(h('div.clk__alarm' + (a.enabled ? '' : '.is-off'), { role: 'listitem' },
            h('div.clk__alarm-main',
              h('div.clk__alarm-time.clk__mono', { text: fmtClock12(a.time) }),
              a.label ? h('div.clk__alarm-label', { text: a.label }) : h('div.clk__alarm-label.is-muted', { text: 'Alarm' })),
            toggle,
            h('button.clk__x', {
              type: 'button', 'aria-label': 'Delete alarm at ' + a.time,
              onclick: () => { store.set('prefs.clock.alarms', alarms().filter(x => x.id !== a.id)); paintBody(); },
            }, icon('trash', { size: 14 }))));
        }
      }
      drawAlarms();

      bodyEl.append(h('div.clk__alarm-view',
        h('div.clk__addbar.clk__addbar--alarm', timeInput, labelInput, addBtn),
        list,
        h('p.clk__note', { text: 'Alarms only ring while StaticOS is open in this tab. A closed or backgrounded page can’t wake itself.' })));
    }

    function nextRoundTime() {
      const d = new Date(Date.now() + 60000); // a minute ahead so a fresh alarm is in the future
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function fmtClock12(hhmm) {
      const [H, M] = hhmm.split(':').map(Number);
      const ap = H < 12 ? 'AM' : 'PM';
      const h12 = H % 12 === 0 ? 12 : H % 12;
      return h12 + ':' + pad2(M) + ' ' + ap;
    }

    /* Fires due alarms. Runs every 1s (regardless of visible tab) but only
       acts once per alarm per minute, tracked by a stamped lastFired. */
    function checkAlarms() {
      const now = new Date();
      const hhmm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      const stamp = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM — unique per minute
      let changed = false;
      const next = alarms().map(a => {
        if (a.enabled && a.time === hhmm && a.lastFired !== stamp) {
          notify({ app: 'Clock', icon: 'bell', title: 'Alarm — ' + fmtClock12(a.time), message: a.label || 'Your alarm is ringing.', timeout: 0 });
          changed = true;
          return { ...a, lastFired: stamp };
        }
        return a;
      });
      if (changed) {
        store.set('prefs.clock.alarms', next);
        if (S.tab === 'alarm') paintBody();
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

      const goBtn = h('button.clk__big.clk__big--go', { type: 'button', onclick: () => { FOCUS.toggle(); } });
      const skipBtn = h('button.clk__big.clk__big--alt', { type: 'button', onclick: () => { FOCUS.skip(); } });
      const resetBtn = h('button.clk__big.clk__big--alt', { type: 'button', 'aria-label': 'Reset focus timer', onclick: () => { FOCUS.reset(); } },
        icon('rotate-ccw', { size: 16 }), 'Reset');

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
        type: 'button', role: 'switch', 'aria-label': 'Silence notifications while focusing',
        onclick: () => { FOCUS.configure({ dnd: !FOCUS.config().dnd }); syncDnd(); },
      }, h('span.clk__switch-knob'));
      const syncDnd = () => { const on = FOCUS.config().dnd; dndSw.classList.toggle('is-on', on); dndSw.setAttribute('aria-checked', String(on)); };
      syncDnd();

      const todayEl = h('div.clk__ftoday');
      const weekEl = h('div.clk__fweek', { role: 'list', 'aria-label': 'Focus sessions, last 7 days' });

      function paintHistory() {
        const t = FOCUS.today();
        render(todayEl,
          h('div.clk__fstat', h('b.clk__mono', { text: String(t.n) }), h('small', { text: t.n === 1 ? 'session today' : 'sessions today' })),
          h('div.clk__fstat', h('b.clk__mono', { text: fmtMin(t.min) }), h('small', { text: 'focused today' })));
        const days = FOCUS.history(7);
        const most = Math.max(1, ...days.map(d => d.n));
        render(weekEl, days.map((d, i) => {
          const date = new Date(`${d.key}T12:00:00`);
          const name = i === days.length - 1 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' });
          const said = `${name}: ${d.n} session${d.n === 1 ? '' : 's'}, ${d.min} min`;
          return h('div.clk__fday', { role: 'listitem', title: said, 'aria-label': said, class: i === days.length - 1 ? 'is-today' : null },
            h('div.clk__fday-col', h('i', { style: { height: d.n ? `${Math.max(8, Math.round((d.n / most) * 100))}%` : '0' } })),
            h('small', { text: String(d.n) }),
            h('span', { text: name }));
        }));
      }

      function update() {
        const f = FOCUS.state();
        readout.textContent = fmtTimer(f.left);
        ring.setAttribute('stroke-dashoffset', (C * (1 - (f.len ? f.left / f.len : 0))).toFixed(2));
        dial.classList.toggle('is-break', f.phase !== 'focus');
        phaseEl.textContent = f.status === 'paused' ? `${f.label} · paused` : f.label;
        clear(goBtn);
        const running = f.status === 'running';
        goBtn.classList.toggle('is-stop', running);
        goBtn.append(icon(running ? 'pause' : 'play', { size: 16 }), running ? 'Pause' : f.status === 'paused' ? 'Resume' : 'Start');
        goBtn.setAttribute('aria-label', `${running ? 'Pause' : f.status === 'paused' ? 'Resume' : 'Start'} ${f.label.toLowerCase()}`);
        clear(skipBtn);
        skipBtn.append(icon('skip-forward', { size: 16 }), 'Skip');
        skipBtn.setAttribute('aria-label', `Skip ${f.label.toLowerCase()}`);
        /* one dot per focus session until the long break */
        const filled = f.phase === 'focus' ? f.session - 1 : f.session;
        render(dots, Array.from({ length: f.every }, (_, i) => h('i', { class: i < filled ? 'is-on' : null })));
        dots.setAttribute('aria-label', `Session ${f.session} of ${f.every}`);
      }

      R.focusUpdate = update;
      R.focusHistory = paintHistory;
      update(); paintHistory();
      bodyEl.append(h('div.clk__focus',
        phaseEl, dial, dots,
        h('div.clk__row', goBtn, skipBtn, resetBtn),
        h('div.clk__fset',
          h('div.clk__fset-row',
            num('focus', 'Focus length in minutes', 180, 'focus'),
            num('short', 'Break length in minutes', 60, 'break'),
            num('long', 'Long break length in minutes', 90, 'long break'),
            num('every', 'Long break after this many sessions', 12, 'sessions')),
          h('div.clk__fdnd', h('div', h('b', { text: 'Silence notifications while focusing' }),
            h('small', { text: 'Turns on Do Not Disturb for each focus session and puts it back as it was afterwards. The timer’s own end note still comes through.' })), dndSw)),
        h('div.clk__fhist', h('div.clk__fhist-h', { text: 'Your focus' }), todayEl, weekEl),
        h('p.clk__note', { text: 'Minutes are counted from completed sessions on this device. The timer keeps time from the clock, so a reload or a sleeping laptop can’t throw it off — but it can only ring while StaticOS is open.' })));
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
      const need = (S.tab === 'stopwatch' && S.sw.running) || (S.tab === 'timer' && S.timer.running);
      if (!need) { rafId = 0; return; }
      const frame = () => {
        if (S.dead) return;
        if (S.tab === 'stopwatch' && S.sw.running) tickStopwatch();
        else if (S.tab === 'timer' && S.timer.running) tickTimer();
        else { rafId = 0; return; }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
    }

    /* One steady heartbeat: wall clocks (visible tab only) plus the alarm
       and timer-expiry checks (always, so nothing is missed off-tab). */
    const beat = setInterval(() => {
      if (S.dead) return;
      checkAlarms();
      checkTimerExpiry();
      if (S.tab === 'world') tickWorld();
      if (S.tab === 'focus') R.focusUpdate?.();
      /* a paused/running timer's coarse readout also refreshes here in case
         rAF is throttled by the browser while backgrounded */
      if (S.tab === 'timer' && !S.timer.running) tickTimer();
    }, 1000);

    root.cherriTeardown = () => {
      S.dead = true;
      clearInterval(beat);
      offFocus();
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
