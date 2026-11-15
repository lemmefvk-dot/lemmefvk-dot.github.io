/* ============================================================
   Calendar — month grid, week and day views, an agenda, a
   right-hand day panel, and an event form in that panel.

   Events are made, changed and deleted here; they can last all
   day or have a start (and an optional end), repeat (every day,
   weekday, week — on several weekdays if you like — month or
   year, every few of them, until a day you pick), carry a place,
   notes and a reminder. The events themselves live in
   js/core/calendar.js (store 'portal.calendar'), which the
   desktop's "Up next" widget reads too, and their reminders go
   off through the same engine as Static Automations' reminders
   (js/core/automations.js) — one clock-watcher for the whole OS,
   which only runs while StaticOS is open, and the form says so.

   Also here:
   · Week and day views lay events out by the minute, stretched to
     show anything before 8 AM or after 8 PM in full. Drag an event
     to move it (in the month too), drag its bottom edge to change
     when it ends; one day of a repeating event moves on its own.
   · Terms and breaks: runs of days drawn as banners across the
     month (the core's spans), from the View menu or an .ics file.
   · Layers (View menu): Static Tasks' due tasks, Static Study's
     homework, exams and timetable, and Static Contacts' birthdays,
     read from those apps every time they are drawn
     (js/core/callayers.js). Read-only: clicking one opens it where
     it lives.
   · The day panel shows the forecast for the selected day when
     Weather has one saved for its place (js/core/calweather.js,
     read-only; it never fetches). It says which place, that it is
     Open-Meteo's forecast, and how old it is. View › Weather
     forecast turns it off.
   · Import .ics (js/core/ics.js): the file is read, never run, and
     a list of what will be added — and what is left out, and why —
     comes first. Export .ics writes everything back out.
   · Send to a friend: the event travels inside a link
     (core/sharelink.js packLink). Opening one shows the event and
     adds it only when Add is pressed.
   · Agenda view, search, Go to date, weeks from Monday and week
     numbers, and a days-until countdown on every event.

   It starts empty: an earlier version seeded a month of invented
   meetings "so it always looked lived-in", which is exactly the
   kind of made-up content StaticOS doesn't show.

   Opening it with { date: 'YYYY-MM-DD' } shows that day; with
   { event: id } it opens that event's form on the next day it
   happens (a reminder's "Open" and the Up next widget do this);
   with { shared } it shows a sent event; with { path } (an .ics
   file from Files) it shows that file's import list.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as CAL from '../core/calendar.js';
import * as LAY from '../core/callayers.js';
import * as CW from '../core/calweather.js';
import { t, plural } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-calendar-css')) {
  const l = document.createElement('link');
  l.id = 'feat-calendar-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-calendar.css';
  document.head.appendChild(l);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const H0 = 8, H1 = 20;          /* the hours a week or day shows at least: 8 AM – 9 PM */
const HOUR_PX = 40;
const SNAP = 15;                /* drags land on quarter hours */
const VIEWS = ['month', 'week', 'day', 'agenda'];
const pad2 = n => String(n).padStart(2, '0');
const hhmm = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
/* a weather family (core/openmeteo.js cond) as one of the OS icons */
const WX_ICON = { clear: 'sun', mostly: 'cloud-sun', partly: 'cloud-sun', cloudy: 'cloud', fog: 'cloud', drizzle: 'cloud-rain', rain: 'cloud-rain', sleet: 'cloud-rain', storm: 'cloud-rain', snow: 'cloud-snow' };
const LAYER_ICON = { tasks: 'check-circle', board: 'clipboard', homework: 'clipboard', exams: 'star', studyplan: 'layers', timetable: 'calendar', birthdays: 'gift' };

defineApp({
  id: 'calendar',
  name: 'Calendar',
  icon: 'calendar',
  g1: '#ff9fb4', g2: '#bb2450',
  category: 'Productivity',
  keywords: ['events', 'month', 'agenda', 'schedule', 'dates', 'reminder', 'repeat', 'weekly', 'daily', 'monthly', 'yearly', 'all day', 'appointment', 'ics', 'import', 'export', 'school calendar', 'term', 'holidays', 'week number'],
  desc: t('Your month, week, day and agenda — repeats, reminders, terms, layers and .ics files'),
  pinned: true, dock: true, singleton: true,
  exts: ['ics'],
  win: { w: 860, h: 560, minW: 600, minH: 400 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Left / Right / Up / Down', t('Previous / next day or week')],
    ['T', t('Today')],
    ['N', t('New event on the selected day')],
    ['M / W / D / A', t('Month, week, day or agenda view')],
    ['G', t('Go to a date')],
    ['F', t('Search events')],
    ['Enter', t('Open the selected day')],
    ['Esc', t('Close the event form')],
  ],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, fmt, store } = api;

    /* ---------------- state ---------------- */
    const som = d => new Date(d.getFullYear(), d.getMonth(), 1);
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const dayOnly = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dkey = CAL.ymd;

    const S = { cur: som(new Date()), sel: dayOnly(new Date()), view: 'month', form: null, span: null, q: '', agendaDays: 60, dead: false };
    let V = LAY.view();
    let cells = new Map();   /* 'YYYY-MM-DD' → the cells that day owns  */
    let heads = new Map();   /* week view column headers, same keying   */
    let h24 = !!store.get('prefs.h24');
    let writing = false;     /* our own writes repaint once, not twice   */
    let grid = null;         /* the time grid on screen: { lo, cols: Map(day → column) } */

    const weekStart = d => addDays(dayOnly(d), -((d.getDay() - (V.mondayFirst ? 1 : 0) + 7) % 7));
    const dowOrder = () => (V.mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]);
    const evOf = d => CAL.onDay(dkey(d));
    const fmtT = t => CAL.clockText(t);
    const hourLabel = hr => (h24 ? `${pad2(hr)}:00` : `${hr % 12 || 12} ${hr >= 12 ? 'PM' : 'AM'}`);
    /* month/week cells are ~100px wide, so they get "9:30a" instead of "9:30 AM" */
    const shortT = t => {
      const [hh, mm] = t.split(':').map(Number);
      if (h24) return mm ? `${pad2(hh)}:${pad2(mm)}` : `${pad2(hh)}h`;
      const ap = hh >= 12 ? 'p' : 'a';
      return mm ? `${hh % 12 || 12}:${pad2(mm)}${ap}` : `${hh % 12 || 12}${ap}`;
    };
    const span = ev => (ev.allDay ? t('All day') : ev.end ? `${fmtT(ev.time)} – ${fmtT(ev.end)}` : fmtT(ev.time));
    const dayShort = k => { const d = CAL.parseDay(k); return `${fmt.dayName(d, 1)}, ${fmt.monthName(d, 1)} ${d.getDate()}`; };
    const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
    const layersFor = (from, to, monthly) => LAY.between(from, to, monthly ? { ...V.layers, timetable: false } : V.layers);

    /* ---------------- chrome --------------- */
    win.setLead(
      h('button.ibtn.tip', { 'data-tip': t('Previous'), 'aria-label': t('Previous'), onclick: () => step(-1) }, icon('chevron-left')),
      h('button.ibtn.tip', {
        'data-tip': t('Jump to today  ·  T'), 'aria-label': t('Today'), text: t('Today'),
        style: { padding: '0 var(--sp-3)', fontSize: 'var(--fs-10)', fontWeight: '600' },
        onclick: () => goToday(),
      }),
      h('button.ibtn.tip', { 'data-tip': t('Next'), 'aria-label': t('Next'), onclick: () => step(1) }, icon('chevron-right')),
    );
    const tabs = h('div.tabs', ...VIEWS.map(v =>
      h('button', { dataset: { view: v }, text: v[0].toUpperCase() + v.slice(1), onclick: () => setView(v) })));
    const viewBtn = h('button.ibtn.tip', { 'data-tip': t('View, layers and files'), 'aria-label': t('View, layers and files'), 'aria-haspopup': 'menu', dataset: { fk: 'cal-menu' },
      onclick: e => viewMenu(e.currentTarget) }, icon('sliders'));
    win.setTools(tabs, viewBtn, h('button.ibtn.tip', {
      'data-tip': t('Add event  ·  N'), 'aria-label': t('Add event'), dataset: { fk: 'cal-new' }, onclick: () => openForm(S.sel),
    }, icon('plus')));

    /* ---------------- layout --------------- */
    const titleEl = h('div.app__title');
    const countEl = h('span.chip');
    const searchIn = h('input.cal-search', { type: 'search', placeholder: t('Search events'), 'aria-label': t('Search events'), dataset: { fk: 'cal-search' }, spellcheck: 'false',
      oninput: e => { S.q = e.target.value; paintBody(); },
      onkeydown: e => { if (e.key === 'Escape' && S.q) { e.preventDefault(); e.stopPropagation(); S.q = ''; e.target.value = ''; paintBody(); } } });
    const gotoIn = h('input.cal-goto', { type: 'date', 'aria-label': t('Go to date'), title: t('Go to a date  ·  G'), dataset: { fk: 'cal-goto' },
      onchange: e => { const d = CAL.parseDay(e.target.value); if (d) { S.q = ''; searchIn.value = ''; jump({ date: e.target.value }); } } });
    const body = h('div.cal');
    const main = h('div.app__main', h('div.app__bar', titleEl, h('div.grow'), h('label.field.cal-searchf', icon('search'), searchIn), gotoIn, countEl), body);
    const side = h('aside.app__side.cal-side', { 'aria-label': t('Selected day') });
    const fileIn = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, 'aria-hidden': 'true', tabindex: '-1', dataset: { fk: 'cal-file' },
      onchange: async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importText(await f.text(), f.name, f.size); } });
    root.appendChild(h('div.app.cal-app', main, side, fileIn));

    /* ---------------- pieces --------------- */
    const dot = tone => h('i.cal-dot', { style: { background: `var(${tone})` } });
    const repWord = ev => (ev.repeat === 'none' ? '' : lower(CAL.repeatText(ev, { until: false })));
    function pill(ev, tight, day) {
      const cls = ev.allDay ? '.cal__ev.is-allday' : '.cal__ev';
      return h(`div${cls}`, {
        dataset: { ev: ev.id, day: day || ev.on || ev.date },
        text: ev.allDay ? ev.title : `${tight ? shortT(ev.time) : fmtT(ev.time)}  ${ev.title}`,
        title: `${ev.title} · ${span(ev)}${ev.repeat !== 'none' ? ` · ${repWord(ev)}` : ''}${ev.location ? ` · ${ev.location}` : ''}${ev.remind !== null ? ' · ' + t('reminder') : ''} — ${t('drag to move')}`,
        style: { '--tone': `var(${ev.tone})` },
      });
    }
    /* something another app keeps: drawn dashed, opens where it lives */
    function layerPill(it, tight) {
      const time = it.allDay ? '' : `${tight ? shortT(it.time) : fmtT(it.time)}  `;
      return h('div.cal__lay', {
        role: 'button', tabindex: '-1', dataset: { layer: it.layer, lid: it.id },
        style: { '--tone': it.color || 'var(--ink-3)' },
        title: t('{title} · {sub} — {opens}', { title: it.title, sub: it.sub, opens: t('opens in {app}', { app: LAY.LAYERS.find(L => L.id === it.layer).app }) }),
        onclick: e => { e.stopPropagation(); openLayer(it); },
      }, icon(LAYER_ICON[it.layer]), h('span', { text: `${time}${it.title}` }));
    }
    function banner(sp, k, rowStart) {
      const first = k === sp.start || rowStart;
      return h('div.cal__span', {
        dataset: { span: sp.id }, role: 'button', tabindex: '-1',
        class: [k === sp.start ? 'is-start' : '', k === sp.end ? 'is-end' : ''].filter(Boolean).join(' ') || null,
        style: { '--tone': `var(${sp.tone})` },
        title: `${sp.title} · ${dayShort(sp.start)} – ${dayShort(sp.end)}`,
        onclick: e => { e.stopPropagation(); openSpan(sp); },
      }, first ? h('span', { text: sp.title }) : null);
    }
    function openLayer(it) {
      api.openApp(it.open.app, it.open.opts);
    }

    const mark = (k, on) => {
      (cells.get(k) || []).forEach(el => el.classList.toggle('is-sel', on));
      const head = heads.get(k);
      if (head) head.classList.toggle('is-sel', on);
    };

    /** A clickable day: single click selects, double click adds an event. */
    function dayCell(d, cls, hr) {
      const k = dkey(d);
      const n = evOf(d).length;
      const cell = h(`button.cal__cell${cls || ''}`, {
        type: 'button',
        dataset: { day: k },
        'aria-label': `${fmt.fmtDateLong(d)}, ${plural(n, '{n} event', '{n} events')}`,
        onclick: () => select(d),
        ondblclick: e => { if (e.target.closest && e.target.closest('.cal__ev,.cal__lay,.cal__span')) return; openForm(d, typeof hr === 'function' ? hr(e) : hr); },
        oncontextmenu: e => dayMenu(e, d),
      });
      cells.set(k, [...(cells.get(k) || []), cell]);
      return cell;
    }

    /* ---------------- views ---------------- */
    function paintMonth() {
      const first = som(S.cur);
      const start = weekStart(first);
      const todayK = dkey(new Date());
      const lay = layersFor(dkey(start), dkey(addDays(start, 41)), true);
      const sps = CAL.spans();
      const cols = V.weekNums ? '30px repeat(7,1fr)' : null;
      const head = h('div.cal__dow', { style: cols ? { gridTemplateColumns: cols } : null },
        V.weekNums ? h('span.cal__wk', { text: t('Wk'), title: t('Week number') }) : null,
        ...dowOrder().map(i => h('span', { text: DOW[i] })));
      const g = h('div.cal__grid', { style: cols ? { gridTemplateColumns: cols } : null });
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i);
        const k = dkey(d);
        if (V.weekNums && i % 7 === 0) {
          const wk = CAL.isoWeek(addDays(d, V.mondayFirst ? 0 : 1));
          g.appendChild(h('div.cal__wkn', { text: String(wk), title: t('Week {wk}', { wk }), 'aria-label': t('Week {wk}', { wk }) }));
        }
        const evs = evOf(d);
        const cell = dayCell(d);
        if (d.getMonth() !== S.cur.getMonth()) cell.classList.add('is-out');
        if (k === todayK) cell.classList.add('is-today');
        cell.appendChild(h('div.cal__n', { text: String(d.getDate()) }));
        for (const sp of CAL.spansOn(k, sps)) cell.appendChild(banner(sp, k, i % 7 === 0));
        const items = [...evs.map(ev => pill(ev, true, k)), ...(lay.get(k) || []).map(it => layerPill(it, true))];
        for (const el of items.slice(0, 3)) cell.appendChild(el);
        /* not .cal__n — on today's cell that class turns into the accent date pill */
        if (items.length > 3) cell.appendChild(h('div.cal__more', { text: t('+{n} more', { n: items.length - 3 }) }));
        g.appendChild(cell);
      }
      body.append(head, g);
    }

    /* the hours a week or day shows: 8 AM–9 PM, stretched to fit anything earlier or later, start to end (#980) */
    function hourRange(days, lay) {
      let lo = H0, hi = H1;
      const fit = (s, e) => { lo = Math.min(lo, Math.floor(s / 60)); hi = Math.max(hi, Math.ceil(e / 60) - 1); };
      for (const d of days) {
        for (const ev of evOf(d)) { if (!ev.allDay) { const m = CAL.minutesSpan(ev); fit(m.start, m.end); } }
        for (const it of lay.get(dkey(d)) || []) if (!it.allDay) { const m = layerSpan(it); fit(m.start, m.end); }
      }
      return [Math.max(0, lo), Math.min(23, hi)];
    }
    const minutesOf = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
    /* a due time has no length: it is drawn as a half-hour mark, labelled with its time */
    const layerSpan = it => { const s = minutesOf(it.time); return { start: s, end: it.end ? minutesOf(it.end) : Math.min(1440, s + 30) }; };

    /** Side by side when they overlap: each item gets { col, cols }. */
    function lanes(items) {
      const sorted = items.slice().sort((a, b) => a.s - b.s || b.e - a.e);
      let group = [], ends = [], groupEnd = -1;
      const flush = () => { for (const it of group) it.cols = ends.length; group = []; ends = []; };
      for (const it of sorted) {
        if (group.length && it.s >= groupEnd) flush();
        let c = ends.findIndex(e => e <= it.s);
        if (c < 0) { c = ends.length; ends.push(it.e); } else ends[c] = it.e;
        it.col = c;
        group.push(it);
        groupEnd = Math.max(groupEnd, it.e);
      }
      flush();
      return sorted;
    }
    const topOf = (m, lo) => ((m - lo * 60) * HOUR_PX) / 60;

    /** Week (seven days) or day (one) as a time grid, laid out by the minute. */
    function paintGrid(days) {
      const n = days.length;
      const cols = `52px repeat(${n},1fr)`;
      const todayK = dkey(new Date());
      const lay = layersFor(dkey(days[0]), dkey(days[n - 1]), false);
      const sps = CAL.spans();
      let head;
      if (n === 1) {
        const evs = evOf(days[0]);
        head = h('div.cal__dow', { style: { gridTemplateColumns: '1fr' } },
          h('span', { text: `${fmt.fmtDateLong(S.sel)} — ${plural(evs.length, '{n} event', '{n} events')}${V.weekNums ? ` · ${t('week {n}', { n: CAL.isoWeek(S.sel) })}` : ''}` }));
      } else {
        head = h('div.cal__dow', { style: { gridTemplateColumns: cols } }, h('span', { text: V.weekNums ? `W${CAL.isoWeek(addDays(days[0], V.mondayFirst ? 0 : 1))}` : '' }));
        for (const d of days) {
          const span2 = h('span', { text: `${DOW[d.getDay()]} ${d.getDate()}`, class: dkey(d) === todayK ? 'is-today' : null });
          heads.set(dkey(d), span2);
          head.appendChild(span2);
        }
      }
      const g = h('div.cal__week', { style: { gridTemplateColumns: cols }, class: n === 1 ? 'is-day' : null });
      /* a row for the all-day events and the terms, then the hours */
      g.appendChild(h('div.cal__hr', { text: t('All day') }));
      for (const [i, d] of days.entries()) {
        const k = dkey(d);
        const cell = dayCell(d, '.cal__cell--allday');
        for (const sp of CAL.spansOn(k, sps)) cell.appendChild(banner(sp, k, i === 0));
        for (const ev of evOf(d).filter(e => e.allDay)) cell.appendChild(pill(ev, true, k));
        for (const it of (lay.get(k) || []).filter(x => x.allDay)) cell.appendChild(layerPill(it, true));
        g.appendChild(cell);
      }
      const [lo, hi] = hourRange(days, lay);
      const height = (hi - lo + 1) * HOUR_PX;
      g.appendChild(h('div.cal__hours', { style: { height: `${height}px` } },
        Array.from({ length: hi - lo + 1 }, (_, i) => h('div.cal__hr', { text: hourLabel(lo + i), style: { height: `${HOUR_PX}px` } }))));
      const colMap = new Map();
      for (const d of days) {
        const k = dkey(d);
        const col = dayCell(d, '.cal__col', e => Math.max(lo, Math.min(hi, lo + Math.floor((e.clientY - col.getBoundingClientRect().top) / HOUR_PX))));
        col.style.height = `${height}px`;
        col.style.setProperty('--hpx', `${HOUR_PX}px`);
        if (k === todayK) col.classList.add('is-today');
        const items = [
          ...evOf(d).filter(e => !e.allDay).map(ev => { const m = CAL.minutesSpan(ev); return { s: m.start, e: m.end, ev }; }),
          ...(lay.get(k) || []).filter(x => !x.allDay).map(it => { const m = layerSpan(it); return { s: m.start, e: m.end, it }; }),
        ];
        for (const x of lanes(items)) col.appendChild(x.ev ? block(x.ev, k, lo, x) : layerBlock(x.it, lo, x));
        colMap.set(k, col);
        g.appendChild(col);
      }
      grid = { lo, hi, cols: colMap };
      body.append(head, h('div.cal__scroll', g));
      paintNow();
    }
    function place(el, s, e, lo, x) {
      el.style.top = `${topOf(s, lo)}px`;
      el.style.height = `${Math.max(18, ((e - s) * HOUR_PX) / 60 - 2)}px`;
      el.style.left = `calc(${(x.col / x.cols) * 100}% + 2px)`;
      el.style.width = `calc(${100 / x.cols}% - 4px)`;
    }
    function block(ev, k, lo, x) {
      const el = h('div.cal__ev.cal__blk', {
        dataset: { ev: ev.id, day: k },
        style: { '--tone': `var(${ev.tone})` },
        title: `${ev.title} · ${span(ev)}${ev.repeat !== 'none' ? ` · ${repWord(ev)}` : ''}${ev.location ? ` · ${ev.location}` : ''} — ${t('drag to move, drag the bottom edge to change the end')}`,
      },
      h('span.cal__blk-t', { text: ev.end ? `${shortT(ev.time)}–${shortT(ev.end)}` : shortT(ev.time) }),
      h('b.cal__blk-n', { text: ev.title }),
      ev.location ? h('span.cal__blk-l', { text: ev.location }) : null,
      h('span.cal__rs', { 'aria-hidden': 'true', title: t('Drag to change when it ends') }));
      place(el, x.s, x.e, lo, x);
      return el;
    }
    function layerBlock(it, lo, x) {
      const el = layerPill(it, true);
      el.classList.add('cal__blk');
      place(el, x.s, x.e, lo, x);
      return el;
    }
    /* the line across today at the time it is now */
    function paintNow() {
      if (!grid) return;
      for (const c of grid.cols.values()) c.querySelector('.cal__nowl')?.remove();
      const col = grid.cols.get(dkey(new Date()));
      if (!col) return;
      const n = new Date();
      const m = n.getHours() * 60 + n.getMinutes();
      if (m < grid.lo * 60 || m > (grid.hi + 1) * 60) return;
      col.appendChild(h('i.cal__nowl', { 'aria-hidden': 'true', style: { top: `${topOf(m, grid.lo)}px` } }));
    }

    function paintWeek() {
      const start = weekStart(S.sel);
      paintGrid(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    }
    function paintDay() { paintGrid([S.sel]); }

    /* ---------------- agenda: what is coming, day by day ---------------- */
    function paintAgenda() {
      const from = S.sel;
      const last = addDays(from, S.agendaDays - 1);
      const lay = layersFor(dkey(from), dkey(last), true);
      const sps = CAL.spans();
      const list = h('div.cal__agenda', { role: 'list', 'aria-label': t('Agenda') });
      let shown = 0;
      for (let i = 0; i < S.agendaDays; i++) {
        const d = addDays(from, i);
        const k = dkey(d);
        const evs = evOf(d);
        const its = lay.get(k) || [];
        const starts = sps.filter(sp => sp.start === k || (i === 0 && sp.start < k && sp.end >= k));
        if (!evs.length && !its.length && !starts.length) continue;
        shown++;
        list.appendChild(h('div.cal__ag-day', { role: 'presentation', class: k === dkey(new Date()) ? 'is-today' : null, dataset: { day: k } },
          h('b', { text: `${fmt.dayName(d)}, ${fmt.monthName(d)} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}` }),
          h('small', { text: CAL.untilText(k) })));
        for (const sp of starts) {
          list.appendChild(h('button.cal__ag.cal__ag--span', { type: 'button', role: 'listitem', dataset: { span: sp.id }, style: { '--tone': `var(${sp.tone})` }, onclick: () => openSpan(sp) },
            h('span.cal__ag-t', { text: t('Runs') }), h('span.cal__ag-b', h('b', { text: sp.title }), h('small', { text: `${dayShort(sp.start)} – ${dayShort(sp.end)}` }))));
        }
        for (const ev of evs) {
          list.appendChild(h('button.cal__ag', { type: 'button', role: 'listitem', dataset: { ev: ev.id, day: k }, style: { '--tone': `var(${ev.tone})` },
            onclick: () => openForm(d, null, ev) },
          h('span.cal__ag-t', { text: ev.allDay ? t('All day') : ev.end ? `${fmtT(ev.time)} – ${fmtT(ev.end)}` : fmtT(ev.time) }),
          h('span.cal__ag-b', h('b', { text: ev.title }),
            ev.location || ev.repeat !== 'none' ? h('small', { text: [ev.location, ev.repeat !== 'none' ? CAL.repeatText(ev) : ''].filter(Boolean).join(' · ') }) : null),
          ev.remind !== null ? h('span.cal-item__ic', { 'aria-label': t('Has a reminder') }, icon('bell')) : null));
        }
        for (const it of its) {
          list.appendChild(h('button.cal__ag.is-layer', { type: 'button', role: 'listitem', dataset: { layer: it.layer, lid: it.id }, style: { '--tone': it.color || 'var(--ink-3)' }, onclick: () => openLayer(it) },
            h('span.cal__ag-t', { text: it.allDay ? (it.layer === 'tasks' || it.layer === 'board' ? t('Due') : t('All day')) : fmtT(it.time) }),
            h('span.cal__ag-b', h('b', { text: it.title }), h('small', { text: t('{sub} · {opens}', { sub: it.sub, opens: t('opens in {app}', { app: LAY.LAYERS.find(L => L.id === it.layer).app }) }) })),
            h('span.cal-item__ic', { 'aria-hidden': 'true' }, icon(LAYER_ICON[it.layer]))));
        }
      }
      const until = `${fmt.monthName(last, 1)} ${last.getDate()}`;
      if (!shown) list.appendChild(h('div.empty.cal-empty', icon('calendar'), h('b', { text: t('Nothing coming up') }),
        h('small', { text: t('Nothing is planned from {from} to {until}.', { from: `${fmt.monthName(from, 1)} ${from.getDate()}`, until }) })));
      if (S.agendaDays < 730) list.appendChild(h('button.btn.btn--sm.cal__ag-more', { type: 'button', dataset: { fk: 'cal-agenda-more' }, onclick: () => { S.agendaDays = Math.min(730, S.agendaDays + 60); paintBody(); } },
        h('span', { text: t('Showing to {until} — show 60 more days', { until }) })));
      body.append(h('div.cal__dow', { style: { gridTemplateColumns: '1fr' } }, h('span', { text: t('From {date}', { date: fmt.fmtDateLong(from) }) })), list);
    }

    /* ---------------- search: every event, by its next day ---------------- */
    function paintSearch() {
      const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      const hay = ev => `${ev.title}\n${ev.location}\n${ev.notes}`.toLowerCase();
      const hits = CAL.events().filter(ev => words.every(w => hay(ev).includes(w)))
        .map(ev => ({ ev, day: CAL.nextDay(ev) })).sort((a, b) => a.day.localeCompare(b.day) || a.ev.title.localeCompare(b.ev.title));
      const spHits = CAL.spans().filter(sp => words.every(w => sp.title.toLowerCase().includes(w)));
      const list = h('div.cal__agenda', { role: 'list', 'aria-label': t('Search results') });
      for (const { ev, day } of hits.slice(0, 200)) {
        list.appendChild(h('button.cal__ag', { type: 'button', role: 'listitem', dataset: { ev: ev.id, day }, style: { '--tone': `var(${ev.tone})` },
          onclick: () => { S.q = ''; searchIn.value = ''; jump({ event: ev.id, date: day }); } },
        h('span.cal__ag-t', { text: dayShort(day) }),
        h('span.cal__ag-b', h('b', { text: ev.title }), h('small', { text: [span(ev), ev.repeat !== 'none' ? CAL.repeatText(ev) : '', ev.location, CAL.untilText(day)].filter(Boolean).join(' · ') }))));
      }
      for (const sp of spHits) {
        list.appendChild(h('button.cal__ag.cal__ag--span', { type: 'button', role: 'listitem', dataset: { span: sp.id }, style: { '--tone': `var(${sp.tone})` }, onclick: () => { S.q = ''; searchIn.value = ''; openSpan(sp); } },
          h('span.cal__ag-t', { text: dayShort(sp.start) }), h('span.cal__ag-b', h('b', { text: sp.title }), h('small', { text: t('Until {date}', { date: dayShort(sp.end) }) }))));
      }
      const n = hits.length + spHits.length;
      if (!n) list.appendChild(h('div.empty.cal-empty', icon('search'), h('b', { text: t('No events match') }), h('small', { text: t('Search looks in names, places and notes.') })));
      body.append(h('div.cal__dow', { style: { gridTemplateColumns: '1fr' } }, h('span', { dataset: { fk: 'cal-search-count' }, text: t('{count} for “{q}”', { count: plural(n, '{n} match', '{n} matches'), q: S.q.trim() }) })), list);
    }

    /* ---------------- side pane ------------- */
    function paintSide() {
      api.clear(side);
      if (S.span) { side.appendChild(spanPanel()); return; }
      const k = dkey(S.sel);
      const evs = evOf(S.sel);
      const its = (layersFor(k, k, false).get(k) || []);
      const sps = CAL.spansOn(k);
      const away = CAL.daysUntil(k);
      const group = h('div.side__group',
        h('div.side__label', h('span', { text: `${fmt.dayName(S.sel, 1)}, ${fmt.monthName(S.sel, 1)} ${S.sel.getDate()}` }),
          away !== 0 ? h('small.cal-until', { dataset: { fk: 'cal-until-day' }, text: CAL.untilText(k) }) : null));
      for (const sp of sps) {
        group.appendChild(h('button.side__item.cal-spanitem', { type: 'button', dataset: { span: sp.id }, style: { '--tone': `var(${sp.tone})` }, onclick: () => openSpan(sp) },
          h('i.cal-bar'), h('span.cal-item__t', h('b', { text: sp.title }), h('small', { text: `${dayShort(sp.start)} – ${dayShort(sp.end)}` }))));
      }
      if (V.forecast && away >= 0) group.appendChild(forecastLine(k));
      if (!evs.length && !its.length) {
        group.appendChild(h('div.empty.cal-empty',
          icon('calendar'), h('b', { text: t('Nothing planned') }),
          h('small', { text: t('Double-click a day, or add one below.') })));
      }
      for (const ev of evs) {
        const away2 = away > 0 ? ` · ${lower(CAL.untilText(k))}` : '';
        group.appendChild(h('button.side__item.cal-item', {
          type: 'button',
          dataset: { ev: ev.id },
          class: S.form && S.form.id === ev.id ? 'is-on' : null,
          title: `${ev.title} · ${span(ev)} — ${t('click to change')}`,
          onclick: () => openForm(S.sel, null, ev),
          oncontextmenu: e => evMenu(e, ev),
        },
          dot(ev.tone),
          h('span.cal-item__t', h('b', { text: ev.title }), h('small', { text: `${span(ev)}${ev.location ? ` · ${ev.location}` : ''}${away2}` })),
          ev.repeat !== 'none' ? h('span.cal-item__ic', { title: CAL.repeatText(ev), 'aria-label': t('Repeats: {when}', { when: CAL.repeatText(ev) }) }, icon('repeat')) : null,
          ev.remind !== null ? h('span.cal-item__ic', { title: CAL.remindLabel(ev.remind, ev.allDay), 'aria-label': t('Reminder: {when}', { when: CAL.remindLabel(ev.remind, ev.allDay) }) }, icon('bell')) : null));
      }
      side.appendChild(group);
      if (its.length) {
        const lg = h('div.side__group.cal-layers', h('div.side__label', { text: t('From your apps') }));
        for (const it of its) {
          lg.appendChild(h('button.side__item.cal-item.is-layer', { type: 'button', dataset: { layer: it.layer, lid: it.id }, style: { '--tone': it.color || 'var(--ink-3)' },
            title: t('Opens in {app}', { app: LAY.LAYERS.find(L => L.id === it.layer).app }), onclick: () => openLayer(it) },
          h('span.cal-item__ic.cal-item__lic', { 'aria-hidden': 'true' }, icon(LAYER_ICON[it.layer])),
          h('span.cal-item__t', h('b', { text: it.title }), h('small', { text: `${it.allDay ? (it.layer === 'tasks' || it.layer === 'board' ? t('Due') : t('All day')) : it.end ? `${fmtT(it.time)} – ${fmtT(it.end)}` : fmtT(it.time)} · ${it.sub}` })),
          h('span.cal-item__ic', { 'aria-hidden': 'true' }, icon('external-link'))));
        }
        side.appendChild(lg);
      }
      side.appendChild(S.form ? formEl() : h('button.btn.btn--sm.btn--block', {
        type: 'button', dataset: { fk: 'cal-add' }, onclick: () => openForm(S.sel),
      }, icon('plus'), t('Add event')));
    }

    /* the saved forecast for a day, filled in once Weather's copy has been read (never fetched) */
    function forecastLine(k) {
      const slot = h('div.cal-wx', { hidden: true, dataset: { fk: 'cal-forecast', day: k } });
      CW.forDay(k).then(f => {
        if (S.dead || !slot.isConnected || !f) return;
        const deg = v => `${Math.round(v) || 0}°`;
        const ago = Math.max(0, Date.now() - f.at);
        const age = ago < 3600e3 ? t('{n} min ago', { n: Math.max(1, Math.round(ago / 60e3)) }) : ago < 86400e3 ? t('{n} h ago', { n: Math.round(ago / 3600e3) }) : plural(Math.round(ago / 86400e3), '{n} day ago', '{n} days ago');
        const rain = f.pop !== null ? t('{pop}% chance of precipitation', { pop: f.pop }) : '';
        api.render(slot, h('button.side__item.cal-item.cal-wx__b', {
          type: 'button', title: t('Opens Weather · the forecast for {place}', { place: f.place }), onclick: () => api.openApp('weather', {}),
          'aria-label': `${t('Forecast for {place}: {label}, high {hi}, low {lo}', { place: f.place, label: f.label, hi: deg(f.hi), lo: deg(f.lo) })}${rain ? `, ${rain}` : ''}. ${t('Open-Meteo forecast, saved {age}', { age })}. ${t('Opens Weather.')}`,
        },
        h('span.cal-item__ic.cal-item__lic', { 'aria-hidden': 'true' }, icon(WX_ICON[f.fam] || 'cloud')),
        h('span.cal-item__t',
          h('b', { text: `${f.label} · ${deg(f.hi)} / ${Math.round(f.lo) || 0}°${f.unit}` }),
          h('small', { text: [rain, f.place.split(',')[0], t('Open-Meteo forecast, saved {age}', { age })].filter(Boolean).join(' · ') }))));
        slot.hidden = false;
      }).catch(() => {});
      return slot;
    }

    /* ---------------- the form -------------- */
    function repeatOptions(date) {
      const d = CAL.parseDay(date);
      const wd = d ? DOW_LONG[d.getDay()] : 'this weekday';
      return [
        ['none', t('Doesn’t repeat')], ['daily', t('Every day')], ['weekdays', t('Every weekday (Mon–Fri)')],
        ['weekly', t('Every week on {day}', { day: wd })], ['monthly', d ? t('Every month on the {day}', { day: CAL.ordinal(d.getDate()) }) : t('Every month')],
        ['yearly', d ? t('Every year on {date}', { date: `${MON[d.getMonth()]} ${d.getDate()}` }) : t('Every year')],
      ];
    }
    function formEl() {
      const f = S.form;
      const probs = f.tried ? CAL.issues({ ...f, every: f.every === '' ? 1 : Number(f.every) }) : [];
      const issue = at => {
        const x = probs.find(p => p.at === at);
        return x ? h('div.cal-issue', { role: 'alert' }, icon('alert'), h('span', { text: x.text })) : null;
      };
      const field = (label, input, at) => h('label.cal-f', h('span.cal-f__l', { text: label }), input, at ? issue(at) : null);

      const tIn = h('input.cal-in', { type: 'text', placeholder: t('Event name'), value: f.title, spellcheck: 'false', maxlength: String(CAL.TITLE_MAX),
        'aria-label': t('Event name'), dataset: { fk: 'cal-title' }, oninput: e => { f.title = e.target.value; } });
      const setDate = v => {
        f.date = v;
        /* the repeat choices name the weekday and date — keep them true without rebuilding the form */
        repeatOptions(f.date).forEach(([, l], i) => { if (rSel.options[i]) rSel.options[i].textContent = l; });
        if (uIn) uIn.min = f.date;
      };
      const dIn = h('input.cal-in', { type: 'date', value: f.date, 'aria-label': t('Day'), dataset: { fk: 'cal-date' },
        oninput: e => setDate(e.target.value),
        /* a weekly event's own weekday is always one of its days: show the new one */
        onchange: e => { setDate(e.target.value); if (f.repeat === 'weekly' && CAL.parseDay(f.date)) { f.refocus = 'cal-date'; paintSide(); } } });
      const allSw = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!f.allDay), class: f.allDay ? 'is-on' : null,
        'aria-label': t('All day'), dataset: { fk: 'cal-allday' },
        onclick: () => {
          f.allDay = !f.allDay;
          /* the reminder choices differ: keep "none", otherwise take the closest sensible one */
          if (f.remind !== null) f.remind = f.allDay ? -540 : 15;
          f.refocus = 'cal-allday';
          paintSide();
        } });
      const sIn = h('input.cal-in', { type: 'time', value: f.time, 'aria-label': t('Starts'), dataset: { fk: 'cal-start' },
        oninput: e => { f.time = e.target.value; }, onchange: e => { f.time = e.target.value; } });
      const eIn = h('input.cal-in', { type: 'time', value: f.end, 'aria-label': t('Ends (optional)'), dataset: { fk: 'cal-end' },
        oninput: e => { f.end = e.target.value; }, onchange: e => { f.end = e.target.value; } });
      const rSel = h('select.select.cal-in', { 'aria-label': t('Repeat'), dataset: { fk: 'cal-repeat' },
        onchange: e => { f.repeat = e.target.value; f.refocus = 'cal-repeat'; paintSide(); } },
        repeatOptions(f.date).map(([v, l]) => h('option', { value: v, text: l, selected: f.repeat === v })));
      const reps = f.repeat !== 'none';
      const unit = CAL.unitOf(f.repeat);
      const nIn = unit ? h('input.cal-in.cal-every', { type: 'number', min: '1', max: String(CAL.EVERY_MAX), step: '1', value: String(f.every || 1), 'aria-label': t('Repeat every how many {unit}s', { unit }), dataset: { fk: 'cal-every' },
        oninput: e => { f.every = e.target.value; unitEl.textContent = Number(e.target.value) === 1 ? unit : `${unit}s`; } }) : null;
      const unitEl = h('span.cal-unit', { text: Number(f.every) === 1 ? unit : `${unit}s` });
      const own = CAL.parseDay(f.date) ? CAL.parseDay(f.date).getDay() : -1;
      const wdays = f.repeat === 'weekly' ? h('div.cal-wds', { role: 'group', 'aria-label': t('On these weekdays') },
        dowOrder().map(d => {
          const on = d === own || f.days.includes(d);
          return h('button.cal-wd', { type: 'button', role: 'checkbox', 'aria-checked': String(on), class: on ? 'is-on' : null, disabled: d === own ? true : null,
            'aria-label': DOW_LONG[d], title: d === own ? t('{day} — the day it starts on', { day: DOW_LONG[d] }) : DOW_LONG[d], dataset: { fk: `cal-wd-${d}` }, text: DOW[d].slice(0, 2),
            onclick: e => {
              f.days = f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d];
              const now = f.days.includes(d);
              e.currentTarget.classList.toggle('is-on', now);
              e.currentTarget.setAttribute('aria-checked', String(now));
            } });
        })) : null;
      const uIn = reps ? h('input.cal-in', { type: 'date', value: f.until || '', min: f.date, 'aria-label': t('Repeat until (optional)'), dataset: { fk: 'cal-until' },
        oninput: e => { f.until = e.target.value; }, onchange: e => { f.until = e.target.value; } }) : null;
      const hint = h('small.cal-hint', { text: t('Goes off as a notification while StaticOS is open in this browser.'), hidden: f.remind === null });
      const mSel = h('select.select.cal-in', { 'aria-label': t('Reminder'), dataset: { fk: 'cal-remind' },
        onchange: e => { f.remind = e.target.value === '' ? null : Number(e.target.value); hint.hidden = f.remind === null; } },
        CAL.remindChoices(!!f.allDay).map(([v, l]) => h('option', { value: v === null ? '' : String(v), text: l, selected: v === f.remind })));
      const lIn = h('input.cal-in', { type: 'text', value: f.location, placeholder: t('Where (optional)'), maxlength: String(CAL.LOCATION_MAX), 'aria-label': t('Location'), dataset: { fk: 'cal-location' },
        oninput: e => { f.location = e.target.value; } });
      const noIn = h('textarea.cal-in.cal-notes', { rows: '3', placeholder: t('Notes (optional)'), maxlength: String(CAL.NOTES_MAX), 'aria-label': t('Notes'), dataset: { fk: 'cal-notes' },
        oninput: e => { f.notes = e.target.value; } });
      noIn.value = f.notes;
      const tones = h('div.cal-tones', { role: 'radiogroup', 'aria-label': t('Colour') },
        CAL.TONES.map((tn, i) => h('button.cal-tone', {
          type: 'button', role: 'radio', 'aria-checked': String(f.tone === tn), 'aria-label': t('Colour {n}', { n: i + 1 }),
          class: f.tone === tn ? 'is-on' : null, style: { '--tone': `var(${tn})` },
          onclick: e => {
            f.tone = tn;
            for (const b of tones.children) { const on = b === e.currentTarget; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); }
          },
        })));

      const editing = !!f.id;
      const ev = editing ? CAL.byId(f.id) : null;
      const repeating = ev && ev.repeat !== 'none';
      const onDay = CAL.parseDay(f.on) || S.sel;
      const awayN = CAL.daysUntil(f.on || f.date);
      const form = h('form.cal-form', {
        'aria-label': editing ? t('Change event') : t('New event'),
        onsubmit: e => { e.preventDefault(); commit(); },
      },
        h('div.side__label', h('span', { text: editing ? t('Change event') : t('New event · {date}', { date: `${fmt.monthName(CAL.parseDay(f.date) || S.sel, 1)} ${(CAL.parseDay(f.date) || S.sel).getDate()}` }) }),
          editing && awayN >= 0 ? h('small.cal-until', { dataset: { fk: 'cal-countdown' }, text: CAL.untilText(f.on || f.date) }) : null),
        field(t('Name'), h('div.field', tIn), 'title'),
        field(t('Day'), h('div.field', dIn), 'date'),
        h('div.cal-f.cal-f--row', h('span.cal-f__l', { text: t('All day') }), allSw),
        f.allDay ? null : h('div.cal-times',
          field(t('Starts'), h('div.field', sIn), 'time'),
          field(t('Ends'), h('div.field', eIn), 'end')),
        field(t('Repeat'), rSel, 'repeat'),
        reps && unit ? h('div.cal-f', h('span.cal-f__l', { text: t('Every') }), h('div.cal-every-row', h('div.field.cal-every-f', nIn), unitEl), issue('every')) : null,
        wdays ? h('div.cal-f', h('span.cal-f__l', { text: t('On') }), wdays) : null,
        reps ? field(t('Until (leave empty for no end)'), h('div.field', uIn), 'until') : null,
        field(t('Reminder'), mSel, 'remind'),
        hint,
        field(t('Location'), h('div.field', lIn)),
        field(t('Notes'), noIn),
        h('div.cal-f', h('span.cal-f__l', { text: t('Colour') }), tones),
        h('div.row.cal-form__go',
          h('button.btn.btn--sm.btn--primary.grow', { type: 'submit', dataset: { fk: 'cal-save' } }, icon('check'), editing ? t('Save') : t('Add')),
          h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': t('Cancel'), 'aria-label': t('Cancel'), dataset: { fk: 'cal-cancel' }, onclick: closeForm }, icon('x'))),
        editing ? h('div.row.cal-form__more',
          h('button.btn.btn--sm.grow', { type: 'button', dataset: { fk: 'cal-duplicate' }, onclick: () => duplicate(ev, onDay) }, icon('copy'), t('Duplicate')),
          h('button.btn.btn--sm.grow', { type: 'button', dataset: { fk: 'cal-send' }, onclick: () => sendEvent(ev) }, icon('send'), t('Send'))) : null,
        editing && repeating ? h('button.btn.btn--sm.btn--block', {
          type: 'button', dataset: { fk: 'cal-delete-one' }, onclick: () => skipOne(f.id, f.on || dkey(S.sel)),
        }, icon('minus'), t('Delete only {date}', { date: `${fmt.monthName(onDay, 1)} ${onDay.getDate()}` })) : null,
        editing ? h('button.btn.btn--sm.btn--danger.btn--block', {
          type: 'button', dataset: { fk: repeating ? 'cal-delete-all' : 'cal-delete' }, onclick: () => removeEv(f.id),
        }, icon('trash'), repeating ? (ev.repeat === 'weekly' && !(ev.every > 1) ? t('Delete every week') : t('Delete every repeat')) : t('Delete event')) : null);
      const back = f.refocus;
      if (back) requestAnimationFrame(() => { if (!S.dead) form.querySelector(`[data-fk="${back}"]`)?.focus(); });
      else if (f.focus !== false) requestAnimationFrame(() => { if (!S.dead && document.contains(tIn) && !side.contains(document.activeElement)) tIn.focus(); });
      f.focus = false;
      f.refocus = null;
      return form;
    }

    /* ---------------- terms and breaks ---------------- */
    function openSpan(sp) {
      S.form = null;
      S.span = { edit: sp ? { id: sp.id, title: sp.title, start: sp.start, end: sp.end, tone: sp.tone, tried: false } : null };
      /* a banner opened from somewhere else (search, the agenda) brings its month along */
      if (sp && S.view === 'month') {
        const a = CAL.parseDay(sp.start), b = CAL.parseDay(sp.end);
        if (b < S.cur || a > new Date(S.cur.getFullYear(), S.cur.getMonth() + 1, 0)) { S.sel = a; S.cur = som(a); paintAll(); return; }
      }
      paintSide();
    }
    function spanPanel() {
      const box = h('div.side__group.cal-spans', { role: 'region', 'aria-label': t('Terms and breaks') },
        h('div.side__label', h('span', { text: t('Terms and breaks') }),
          h('button.ibtn', { type: 'button', 'aria-label': t('Close terms and breaks'), dataset: { fk: 'cal-spans-close' }, onclick: () => { S.span = null; paintSide(); } }, icon('x'))),
        h('small.cal-hint', { text: t('Runs of days, like a school term or a holiday, drawn as a banner across the month. An .ics file’s events that last several days come in as these.') }));
      const all = CAL.spans();
      for (const sp of all) {
        const n = CAL.daysBetween(sp.start, sp.end) + 1;
        box.appendChild(h('button.side__item.cal-spanitem', { type: 'button', dataset: { span: sp.id }, class: S.span.edit && S.span.edit.id === sp.id ? 'is-on' : null, style: { '--tone': `var(${sp.tone})` },
          onclick: () => { S.span = { edit: { id: sp.id, title: sp.title, start: sp.start, end: sp.end, tone: sp.tone, tried: false } }; paintSide(); } },
        h('i.cal-bar'), h('span.cal-item__t', h('b', { text: sp.title }), h('small', { text: `${dayShort(sp.start)} – ${dayShort(sp.end)} · ${plural(n, '{n} day', '{n} days')}` }))));
      }
      if (!all.length && !S.span.edit) box.appendChild(h('p.cal-hint', { text: t('None yet.') }));
      const f = S.span.edit;
      if (!f) {
        box.appendChild(h('button.btn.btn--sm.btn--block', { type: 'button', dataset: { fk: 'cal-span-add' },
          onclick: () => { const k = dkey(S.sel); S.span = { edit: { id: '', title: '', start: k, end: k, tone: CAL.TONES[(all.length + 1) % CAL.TONES.length], tried: false, focus: true } }; paintSide(); } },
        icon('plus'), t('Add a term or break')));
        return box;
      }
      const probs = f.tried ? CAL.spanIssues(f) : [];
      const issue = at => { const x = probs.find(p => p.at === at); return x ? h('div.cal-issue', { role: 'alert' }, icon('alert'), h('span', { text: x.text })) : null; };
      const nIn = h('input.cal-in', { type: 'text', value: f.title, placeholder: t('Autumn term'), maxlength: String(CAL.TITLE_MAX), 'aria-label': t('Name'), dataset: { fk: 'cal-span-title' }, oninput: e => { f.title = e.target.value; } });
      const aIn = h('input.cal-in', { type: 'date', value: f.start, 'aria-label': t('First day'), dataset: { fk: 'cal-span-start' }, oninput: e => { f.start = e.target.value; bIn.min = f.start; }, onchange: e => { f.start = e.target.value; } });
      const bIn = h('input.cal-in', { type: 'date', value: f.end, min: f.start, 'aria-label': t('Last day'), dataset: { fk: 'cal-span-end' }, oninput: e => { f.end = e.target.value; }, onchange: e => { f.end = e.target.value; } });
      const tones = h('div.cal-tones', { role: 'radiogroup', 'aria-label': t('Colour') },
        CAL.TONES.map((tn, i) => h('button.cal-tone', { type: 'button', role: 'radio', 'aria-checked': String(f.tone === tn), 'aria-label': t('Colour {n}', { n: i + 1 }), class: f.tone === tn ? 'is-on' : null, style: { '--tone': `var(${tn})` },
          onclick: e => { f.tone = tn; for (const b of tones.children) { const on = b === e.currentTarget; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); } } })));
      const save = () => {
        writing = true;
        const res = CAL.saveSpan({ id: f.id, title: f.title, start: f.start, end: f.end, tone: f.tone });
        writing = false;
        if (!res.ok) { f.tried = true; paintSide(); return; }
        S.span = { edit: null };
        const d = CAL.parseDay(res.span.start);
        if (d && !f.id) { S.cur = som(d); S.sel = d; }
        paintAll();
        api.notify({ app: 'Calendar', icon: 'calendar', title: f.id ? t('Saved') : t('Added'), message: `${res.span.title} · ${dayShort(res.span.start)} – ${dayShort(res.span.end)}`, timeout: 3200 });
      };
      const form = h('form.cal-form', { 'aria-label': f.id ? t('Change term or break') : t('New term or break'), onsubmit: e => { e.preventDefault(); save(); } },
        h('label.cal-f', h('span.cal-f__l', { text: t('Name') }), h('div.field', nIn), issue('title')),
        h('div.cal-times',
          h('label.cal-f', h('span.cal-f__l', { text: t('First day') }), h('div.field', aIn), issue('start')),
          h('label.cal-f', h('span.cal-f__l', { text: t('Last day') }), h('div.field', bIn), issue('end'))),
        h('div.cal-f', h('span.cal-f__l', { text: t('Colour') }), tones),
        h('div.row.cal-form__go',
          h('button.btn.btn--sm.btn--primary.grow', { type: 'submit', dataset: { fk: 'cal-span-save' } }, icon('check'), f.id ? t('Save') : t('Add')),
          h('button.btn.btn--sm', { type: 'button', 'aria-label': t('Cancel'), onclick: () => { S.span = { edit: null }; paintSide(); } }, icon('x'))),
        f.id ? h('button.btn.btn--sm.btn--danger.btn--block', { type: 'button', dataset: { fk: 'cal-span-delete' }, onclick: () => {
          writing = true; const gone = CAL.removeSpan(f.id); writing = false;
          if (!gone) return;
          S.span = { edit: null };
          paintAll();
          api.notify({ app: 'Calendar', icon: 'trash', title: t('Removed'), message: gone.title, timeout: 6000, actions: [{ label: t('Undo'), onClick: () => { CAL.restoreSpan(gone); } }] });
        } }, icon('trash'), t('Delete')) : null);
      box.appendChild(form);
      if (f.focus) { f.focus = false; requestAnimationFrame(() => { if (!S.dead) nIn.focus(); }); }
      return box;
    }

    /* ---------------- actions --------------- */
    function suggestTime(d) {
      const now = new Date();
      if (dkey(d) !== dkey(now)) return '09:00';
      return `${pad2(Math.min(23, Math.max(H0, now.getHours() + 1)))}:00`;
    }
    function draftFrom(ev, k) {
      return { title: ev.title, date: ev.date, allDay: ev.allDay, time: ev.time || '09:00', end: ev.end || '', repeat: ev.repeat, every: ev.every || 1,
        days: (ev.days || []).slice(), until: ev.until || '', remind: ev.remind, tone: ev.tone, location: ev.location || '', notes: ev.notes || '', on: k, tried: false };
    }
    function openForm(d, hr, ev, copyOf) {
      S.span = null;
      S.sel = dayOnly(d);
      S.cur = som(S.sel);
      const k = dkey(S.sel);
      S.form = ev
        ? { id: ev.id, ...draftFrom(ev, k) }
        : copyOf
          ? { id: null, ...draftFrom(copyOf, k), date: k, repeat: 'none', every: 1, days: [], until: '' }
          : { id: null, on: k, title: '', date: k, allDay: false,
              time: hr === undefined || hr === null ? suggestTime(d) : `${pad2(hr)}:00`, end: '',
              repeat: 'none', every: 1, days: [], until: '', remind: null, tone: CAL.TONES[evOf(d).length % CAL.TONES.length], location: '', notes: '', tried: false };
      paintAll();
    }
    function closeForm() { S.form = null; paintSide(); }
    /* a copy, as a new event on the day you choose: the form opens on it with the Day field ready */
    function duplicate(ev, d) {
      if (!ev) return;
      openForm(d || S.sel, null, null, ev);
      if (S.form) { S.form.refocus = 'cal-date'; paintSide(); }
      api.notify({ app: 'Calendar', icon: 'copy', title: t('Copy of the event'), message: t('Pick the day for the copy of {title}, then press Add.', { title: ev.title }), timeout: 4000 });
    }

    const reminderNote = res => {
      if (res.reminder === 'passed') return ' ' + t('The reminder time has already passed, so no reminder was set.');
      if (res.reminder === 'full') return ' ' + t('Calendar has too many reminders already, so this one wasn’t set.');
      return '';
    };
    function commit() {
      const f = S.form;
      const reps = f.repeat !== 'none';
      const draft = { title: f.title, date: f.date, allDay: !!f.allDay, time: f.time, end: f.allDay ? '' : f.end, repeat: f.repeat, remind: f.remind, tone: f.tone,
        every: reps && CAL.unitOf(f.repeat) ? (f.every === '' ? 1 : Number(f.every)) : 1, days: f.repeat === 'weekly' ? f.days.slice() : [], until: reps ? (f.until || '') : '',
        location: f.location, notes: f.notes };
      writing = true;
      const res = f.id ? CAL.updateEvent(f.id, draft) : CAL.addEvent(draft);
      writing = false;
      if (!res.ok) {
        f.tried = true;
        paintSide();
        const first = (res.issues || [])[0];
        requestAnimationFrame(() => side.querySelector(`[data-fk="cal-${first && first.at === 'time' ? 'start' : (first && first.at) || 'title'}"]`)?.focus());
        return false;
      }
      const ev = res.event;
      S.form = null;
      S.sel = CAL.parseDay(f.id ? (CAL.occursOn(ev, f.on) ? f.on : CAL.nextDay(ev)) : ev.date) || S.sel;
      S.cur = som(S.sel);
      paintAll();
      const extra = reminderNote(res);
      const lbl = CAL.remindLabel(ev.remind, ev.allDay);
      const rem = res.reminder === 'set' ? ` · ${t('reminder {when}', { when: lower(lbl) })}` : '';
      api.notify({ app: 'Calendar', icon: 'calendar', title: f.id ? t('Event saved') : t('Event added'),
        message: `${ev.title} · ${span(ev)}${ev.repeat !== 'none' ? ` · ${repWord(ev)}` : ''}${rem}.${extra}`, timeout: extra ? 7000 : 3200 });
      return true;
    }

    function removeEv(id) {
      writing = true;
      const gone = CAL.removeEvent(id);
      writing = false;
      if (!gone) return;
      S.form = null;
      paintAll();
      api.notify({
        app: 'Calendar', icon: 'trash', title: gone.repeat === 'weekly' && !(gone.every > 1) ? t('Weekly event removed') : gone.repeat !== 'none' ? t('Repeating event removed') : t('Event removed'), message: gone.title, timeout: 6000,
        actions: [{ label: t('Undo'), onClick: () => { CAL.restoreEvent(gone); } }],
      });
    }
    function skipOne(id, day) {
      writing = true;
      const before = CAL.skipDay(id, day);
      writing = false;
      if (!before) return;
      S.form = null;
      paintAll();
      const d = CAL.parseDay(day);
      api.notify({
        app: 'Calendar', icon: 'trash', title: t('Removed one day'), message: `${before.title} · ${fmt.dayName(d, 1)} ${fmt.monthName(d, 1)} ${d.getDate()} — ${before.repeat === 'weekly' && !(before.every > 1) ? t('the other weeks stay.') : t('the other days stay.')}`, timeout: 6000,
        actions: [{ label: t('Undo'), onClick: () => { CAL.replaceEvent(before); } }],
      });
    }
    /* move (or change the end of) one occurrence — from a drag, or the menu */
    function moveTo(ev, day, patch, what) {
      const cur = CAL.byId(ev.id);
      if (!cur) return;
      writing = true;
      const res = cur.repeat === 'none' ? CAL.updateEvent(cur.id, patch) : CAL.moveOne(cur.id, day, patch);
      writing = false;
      if (!res.ok) { paintAll(); api.notify({ app: 'Calendar', icon: 'alert', title: t('It stayed where it was'), message: (res.issues && res.issues[0] && res.issues[0].text) || '', timeout: 5000 }); return; }
      const now = res.event;
      if (!S.form) { S.sel = CAL.parseDay(now.date) || S.sel; if (S.view !== 'month') S.cur = som(S.sel); }
      paintAll();
      const single = cur.repeat !== 'none';
      api.notify({
        app: 'Calendar', icon: 'calendar', title: single ? t('{what} this day only', { what }) : what,
        message: `${now.title} · ${dayShort(now.date)}, ${span(now)}${single ? ' — the other days it repeats on stay as they were.' : ''}`, timeout: 6000,
        actions: [{ label: t('Undo'), onClick: () => {
          if (single) { CAL.removeEvent(now.id); CAL.replaceEvent(res.before); } else CAL.replaceEvent(cur);
        } }],
      });
    }

    async function sendEvent(ev) {
      if (!ev) return;
      const L = await import('../core/sharelink.js');
      const r = await L.packLink('event', CAL.packEvent(ev));
      if (S.dead) return;
      if (!r.ok) { api.notify({ app: 'Calendar', icon: 'alert', title: t('No link was made'), message: r.error, timeout: 7000 }); return; }
      const field = h('input.cal-in.cal-link', { type: 'text', readonly: true, value: r.link, 'aria-label': t('Link to the event'), dataset: { fk: 'cal-link' }, onfocus: e => e.target.select() });
      const ok = await api.confirm({
        title: t('Send “{title}”', { title: ev.title }),
        message: t('The event travels inside this link: no server keeps it. Send it to a friend however you like. Whoever opens it in StaticOS sees the event first and adds it only if they choose. Your reminder and colour stay with you.'),
        body: h('div.field.cal-linkf', field), ok: t('Copy link'), cancel: t('Close'),
      });
      if (!ok) return;
      let copied = false;
      try { await navigator.clipboard.writeText(r.link); copied = true; } catch (e) { copied = false; }
      api.notify({ app: 'Calendar', icon: copied ? 'link' : 'alert', title: copied ? t('Link copied') : t('Copy the link yourself'), message: copied ? t('Send it to whoever you want to have {title}.', { title: ev.title }) : r.link.slice(0, 120), timeout: 5000 });
    }
    async function openShared(frag) {
      const L = await import('../core/sharelink.js');
      const r = await L.unpackLink('event', frag);
      const draft = r.ok ? CAL.unpackEvent(r.data) : null;
      if (S.dead) return;
      if (!draft) { api.notify({ app: 'Calendar', icon: 'alert', title: t('That link wasn’t opened'), message: r.ok ? t('It doesn’t hold an event Calendar can read.') : r.error, timeout: 8000 }); return; }
      const d = CAL.parseDay(draft.date);
      S.sel = d; S.cur = som(d); S.form = null; paintAll();
      const row = (k, v) => (v ? h('div.cal-shared__r', h('small', { text: k }), h('span', { text: v })) : null);
      const card = h('div.cal-shared', { dataset: { fk: 'cal-shared' } },
        h('b.cal-shared__t', { text: draft.title }),
        row(t('When'), `${fmt.fmtDateLong(d)}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''} · ${span(draft)}`),
        row(t('Repeats'), CAL.repeatText(draft)),
        row(t('Where'), draft.location),
        row(t('Notes'), draft.notes));
      const ok = await api.confirm({ title: t('Add this event to your calendar?'), message: t('Someone sent you this event in a link. Nothing is added unless you press Add, and no reminder is set — add one afterwards if you want it.'), body: card, ok: t('Add') });
      if (!ok || S.dead) return;
      writing = true;
      const res = CAL.addEvent(draft);
      writing = false;
      if (!res.ok) { api.notify({ app: 'Calendar', icon: 'alert', title: t('It wasn’t added'), message: res.issues[0].text, timeout: 6000 }); return; }
      S.sel = CAL.parseDay(res.event.date); S.cur = som(S.sel);
      paintAll();
      api.notify({ app: 'Calendar', icon: 'calendar', title: t('Event added'), message: `${res.event.title} · ${dayShort(res.event.date)}`, timeout: 4000 });
    }

    /* ---------------- .ics in and out ---------------- */
    async function importText(text, name, size) {
      const ICS = await import('../core/ics.js');
      if (size && size > ICS.MAX_BYTES) { api.notify({ app: 'Calendar', icon: 'alert', title: t('That file wasn’t imported'), message: `It is bigger than ${ICS.MAX_BYTES / 1048576} MB, more than a calendar file should be.`, timeout: 8000 }); return; }
      const r = ICS.parse(text);
      if (S.dead) return;
      if (!r.ok) { api.notify({ app: 'Calendar', icon: 'alert', title: t('That file wasn’t imported'), message: r.error, timeout: 8000 }); return; }
      const evs = r.items.filter(i => i.kind === 'event');
      const sps = r.items.filter(i => i.kind === 'span');
      const n = r.items.length;
      const listing = h('div.cal-imp', { dataset: { fk: 'cal-import' } });
      if (n) {
        listing.appendChild(h('div.cal-imp__h', { text: t('Will be added ({n})', { n }) }));
        const ul = h('ul.cal-imp__list', { dataset: { fk: 'cal-import-add' } });
        for (const it of r.items) {
          const probe = it.kind === 'event' ? CAL.normEvent({ ...it.draft, id: 'x' }, it.draft.date) : null;
          ul.appendChild(h('li', h('b', { text: it.title }),
            h('small', { text: it.kind === 'span' ? t('{when} · drawn as a banner', { when: it.when }) : [it.when, probe ? CAL.repeatText(probe) : '', it.draft.location].filter(Boolean).join(' · ') }),
            ...it.notes.map(x => h('small.cal-imp__note', { text: x }))));
        }
        listing.appendChild(ul);
      }
      if (r.skipped.length) {
        listing.appendChild(h('div.cal-imp__h', { text: t('Left out ({length})', { length: r.skipped.length }) }));
        listing.appendChild(h('ul.cal-imp__list.is-skipped', { dataset: { fk: 'cal-import-skipped' } },
          r.skipped.map(s => h('li', h('b', { text: s.title }), h('small', { text: s.why })))));
      }
      for (const x of r.notes) listing.appendChild(h('p.cal-hint', { text: x }));
      const what = [evs.length ? `${evs.length} event${evs.length === 1 ? '' : 's'}` : '', sps.length ? `${sps.length} term${sps.length === 1 ? '' : 's'} or break${sps.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
      const ok = await api.confirm({
        title: `Import ${String(name || 'calendar file').slice(0, 60)}`,
        message: n ? `${r.name ? `“${r.name}”: ` : ''}${what} can be added. Nothing in the file is run or opened; it is only read.` : t('Nothing in this file can be added.'),
        body: listing, ok: n ? `Add ${n}` : 'OK', cancel: n ? 'Cancel' : 'Close',
      });
      if (!ok || !n || S.dead) return;
      writing = true;
      const res = CAL.addMany(evs.map(i => i.draft), sps.map(i => i.draft));
      writing = false;
      const first = [...evs.map(i => i.draft.date), ...sps.map(i => i.draft.start)].sort()[0];
      const d = CAL.parseDay(first);
      if (d) { S.sel = d; S.cur = som(d); }
      paintAll();
      const bits = [res.added ? `${res.added} event${res.added === 1 ? '' : 's'}` : '', res.spans ? `${res.spans} term${res.spans === 1 ? '' : 's'} and breaks` : ''].filter(Boolean).join(' and ');
      api.notify({ app: 'Calendar', icon: 'calendar', title: bits ? t('Added {bits}', { bits }) : t('Nothing was added'), message: res.issues.length ? `${res.issues.length} couldn’t be added: ${res.issues[0].text}` : `From ${String(name || 'the file').slice(0, 60)}.`, timeout: 6000 });
    }
    async function importPath(path) {
      try {
        const n = api.vfs.node(path);
        if (!n || n.type === 'dir') return;
        let text = String(n.content || '');
        if (text.startsWith('staticos-media:')) {
          const media = await import('../core/media.js');
          const blob = await media.blobOf(path);
          if (!blob) throw new Error('its bytes are missing');
          if (blob.size > 2 * 1024 * 1024) { importText('', api.vfs.baseName ? api.vfs.baseName(path) : path, blob.size); return; }
          text = await blob.text();
        }
        importText(text, path.split('/').pop());
      } catch (e) {
        api.notify({ app: 'Calendar', icon: 'alert', title: t('That file couldn’t be read'), message: String(e && e.message || e).slice(0, 120), timeout: 6000 });
      }
    }
    async function exportIcs() {
      const evs = CAL.events(), sps = CAL.spans();
      if (!evs.length && !sps.length) { api.notify({ app: 'Calendar', icon: 'calendar', title: t('Nothing to export yet'), message: t('Your calendar is empty.'), timeout: 4000 }); return; }
      const ICS = await import('../core/ics.js');
      const text = ICS.build(evs, sps);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
      const a = h('a', { href: url, download: 'StaticOS Calendar.ics', hidden: true });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      api.notify({ app: 'Calendar', icon: 'download', title: t('Downloading StaticOS Calendar.ics'),
        message: `${evs.length} event${evs.length === 1 ? '' : 's'}${sps.length ? ` and ${sps.length} term${sps.length === 1 ? '' : 's'} or break${sps.length === 1 ? '' : 's'}` : ''}. Other calendar apps can import it. Reminders stay here.`, timeout: 5000 });
      return text;
    }

    /* ---------------- menus ---------------- */
    function viewMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      const toggle = patch => { V = LAY.setView(patch); paintAll(); };
      api.menu([
        { header: true, label: t('Layers') },
        ...LAY.LAYERS.map(L => ({ label: L.id === 'timetable' ? t('{name} (week and day)', { name: L.name }) : L.name, icon: L.icon, checked: !!V.layers[L.id], hint: L.app, onClick: () => toggle({ layers: { [L.id]: !V.layers[L.id] } }) })),
        '-',
        { label: t('Weeks start on Monday'), icon: 'calendar', checked: V.mondayFirst, onClick: () => toggle({ mondayFirst: !V.mondayFirst }) },
        { label: t('Show week numbers'), icon: 'list', checked: V.weekNums, onClick: () => toggle({ weekNums: !V.weekNums }) },
        { label: t('Weather forecast in the day panel'), icon: 'cloud-sun', checked: V.forecast, hint: 'Weather', onClick: () => toggle({ forecast: !V.forecast }) },
        { label: t('Terms and breaks…'), icon: 'layers', onClick: () => openSpan(null) },
        '-',
        { label: t('Import .ics file…'), icon: 'upload', onClick: () => fileIn.click() },
        { label: t('Export .ics file'), icon: 'download', disabled: !CAL.events().length && !CAL.spans().length, onClick: () => exportIcs() },
      ], Math.round(r.right - 240), Math.round(r.bottom + 4), { label: t('Calendar view') });
    }
    function evMenu(e, ev) {
      e.preventDefault(); e.stopPropagation();
      const k = dkey(S.sel);
      api.menu([
        { label: t('Change…'), icon: 'edit-3', onClick: () => openForm(S.sel, null, ev) },
        { label: t('Duplicate…'), icon: 'copy', onClick: () => duplicate(ev, S.sel) },
        ev.repeat !== 'none' ? null : { label: t('Move to next day'), icon: 'chevron-right', onClick: () => moveTo(ev, ev.date, { date: dkey(addDays(CAL.parseDay(ev.date), 1)) }, 'Moved') },
        ev.repeat !== 'none' ? null : { label: t('Move to another day…'), icon: 'calendar', onClick: () => { openForm(S.sel, null, ev); if (S.form) { S.form.refocus = 'cal-date'; paintSide(); } } },
        { label: t('Send to a friend…'), icon: 'send', onClick: () => sendEvent(ev) },
        '-',
        ev.repeat !== 'none' ? { label: t('Delete only this day'), icon: 'minus', onClick: () => skipOne(ev.id, k) } : null,
        { label: ev.repeat !== 'none' ? t('Delete every repeat') : t('Delete event'), icon: 'trash', danger: true, onClick: () => removeEv(ev.id) },
      ].filter(Boolean), e.clientX, e.clientY);
    }

    function dayMenu(e, d) {
      e.preventDefault();
      if (e.target.closest && e.target.closest('.cal__ev[data-ev]')) { const ev = CAL.byId(e.target.closest('.cal__ev').dataset.ev); if (ev) { select(d); evMenu(e, ev); return; } }
      select(d);
      const n = evOf(d).length;
      api.menu([
        { label: t('Add event…'), icon: 'plus', onClick: () => openForm(d) },
        { label: t('Open day view'), icon: 'list', onClick: () => { S.sel = dayOnly(d); setView('day'); } },
        '-',
        { label: `${n} event${n === 1 ? '' : 's'}`, icon: 'calendar', disabled: true },
      ], e.clientX, e.clientY);
    }

    /* ---------------- drag to move, drag the edge to resize (#437) ----------------
       Pointer events, so a mouse, a pen or a finger on a time block all work.
       A press that moves less than 4 px is a click (it opens the event). */
    let drag = null;
    let swallowClick = false;
    const snap = m => Math.round(m / SNAP) * SNAP;
    function colAt(x, y) {
      for (const el of document.elementsFromPoint(x, y)) { if (el.classList && el.classList.contains('cal__col') && body.contains(el)) return el; }
      return null;
    }
    function cellAt(x, y) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (!el.classList || !body.contains(el)) continue;
        if (el.classList.contains('cal__cell') && !el.classList.contains('cal__col')) return el;
      }
      return null;
    }
    function onDown(e) {
      if (e.button !== 0 || drag) return;
      const el = e.target.closest && e.target.closest('.cal__ev[data-ev]');
      if (!el || !body.contains(el)) return;
      const ev = CAL.byId(el.dataset.ev);
      if (!ev) return;
      const timed = el.classList.contains('cal__blk') && grid;
      const m = timed ? CAL.minutesSpan(ev) : null;
      drag = { el, ev, day: el.dataset.day, timed, resize: !!(timed && e.target.closest('.cal__rs')), x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId,
        s: m && m.start, e: m && m.end, grab: timed ? (e.clientY - el.getBoundingClientRect().top) * 60 / HOUR_PX : 0, target: null, ns: null, ne: null };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      if (timed) e.preventDefault();
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
      if (!drag.moved) { drag.moved = true; drag.el.classList.add('is-dragging'); root.classList.add('cal-dragging'); }
      e.preventDefault();
      if (drag.timed) {
        const col = drag.resize ? grid.cols.get(drag.day) : (colAt(e.clientX, e.clientY) || drag.target || grid.cols.get(drag.day));
        if (!col) return;
        const top = col.getBoundingClientRect().top;
        const at = grid.lo * 60 + ((e.clientY - top) * 60) / HOUR_PX;
        if (drag.resize) {
          drag.ns = drag.s;
          drag.ne = Math.max(drag.s + SNAP, Math.min(23 * 60 + 59, snap(at)));
        } else {
          const dur = drag.e - drag.s;
          const latest = drag.ev.end ? 23 * 60 + 59 - dur : 23 * 60 + 45;
          drag.ns = Math.max(0, Math.min(latest, snap(at - drag.grab)));
          drag.ne = drag.ns + dur;
          if (col !== drag.el.parentNode) col.appendChild(drag.el);
          drag.target = col;
          drag.el.style.left = '2px'; drag.el.style.width = 'calc(100% - 4px)';
        }
        drag.el.style.top = `${topOf(drag.ns, grid.lo)}px`;
        drag.el.style.height = `${Math.max(18, ((drag.ne - drag.ns) * HOUR_PX) / 60 - 2)}px`;
        const t = drag.el.querySelector('.cal__blk-t');
        if (t) t.textContent = drag.ev.end || drag.resize ? `${shortT(hhmm(drag.ns))}–${shortT(hhmm(drag.ne))}` : shortT(hhmm(drag.ns));
      } else {
        const cell = cellAt(e.clientX, e.clientY);
        if (drag.target && drag.target !== cell) drag.target.classList.remove('is-drop');
        drag.target = cell;
        if (cell) cell.classList.add('is-drop');
      }
    }
    function endDrag() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      root.classList.remove('cal-dragging');
      if (drag && drag.target && drag.target.classList) drag.target.classList.remove('is-drop');
      const d = drag; drag = null;
      return d;
    }
    function onCancel() { const d = endDrag(); if (d && d.moved) paintAll(); }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = endDrag();
      if (!d.moved) return;
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      if (d.timed) {
        if (d.ns === null) { paintAll(); return; }
        const day = d.resize ? d.day : (d.target ? d.target.dataset.day : d.day);
        const patch = d.resize ? { end: hhmm(d.ne) } : { date: day, time: hhmm(d.ns), end: d.ev.end ? hhmm(d.ne) : '' };
        const same = d.resize ? hhmm(d.ne) === d.ev.end : day === d.day && hhmm(d.ns) === d.ev.time;
        if (same) { paintAll(); return; }
        if (d.ev.repeat === 'none' && !d.resize) patch.date = day;
        moveTo(d.ev, d.day, patch, d.resize ? 'Changed the end' : 'Moved');
        return;
      }
      const day = d.target && d.target.dataset.day;
      if (!day || day === d.day) { paintAll(); return; }
      moveTo(d.ev, d.day, { date: day }, 'Moved');
    }
    body.addEventListener('pointerdown', onDown);
    body.addEventListener('click', e => {
      if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; return; }
      /* a click on an event opens it (the day it was clicked on) */
      const el = e.target.closest && e.target.closest('.cal__ev[data-ev]');
      if (!el || !body.contains(el)) return;
      const ev = CAL.byId(el.dataset.ev);
      const d = CAL.parseDay(el.dataset.day);
      if (!ev || !d) return;
      e.stopPropagation();
      openForm(d, null, ev);
    }, true);

    /** Selecting a day already on screen only moves the highlight — the
        grid must survive the first click so a double-click can land. */
    function select(d) {
      const nd = dayOnly(d);
      const prev = dkey(S.sel);
      if (S.span) S.span = null;
      if (dkey(nd) === prev) { paintSide(); return; }
      const onScreen = cells.has(dkey(nd)) && (S.view !== 'month' || nd.getMonth() === S.cur.getMonth());
      S.sel = nd;
      gotoIn.value = dkey(nd);
      if (S.form && !S.form.id) { S.form.date = dkey(nd); S.form.on = dkey(nd); }
      if (onScreen) {
        if (som(nd).getTime() !== S.cur.getTime()) { S.cur = som(nd); paintHead(); }
        mark(prev, false);
        mark(dkey(nd), true);
        paintSide();
        return;
      }
      S.cur = som(nd);
      paintAll();
    }
    function goToday() { S.sel = dayOnly(new Date()); S.cur = som(S.sel); S.q = ''; searchIn.value = ''; paintAll(); }
    function step(n) {
      if (S.view === 'month') {
        S.cur = new Date(S.cur.getFullYear(), S.cur.getMonth() + n, 1);
        const dim = new Date(S.cur.getFullYear(), S.cur.getMonth() + 1, 0).getDate();
        S.sel = new Date(S.cur.getFullYear(), S.cur.getMonth(), Math.min(S.sel.getDate(), dim));
      } else {
        S.sel = addDays(S.sel, S.view === 'week' ? 7 * n : S.view === 'agenda' ? 30 * n : n);
        S.cur = som(S.sel);
      }
      paintAll();
    }
    function setView(v) { if (S.view === v && !S.q) return; S.view = v; S.q = ''; searchIn.value = ''; paintAll(); }

    /** Open on a day, or on an event (its next day, with its form open). */
    function jump(o) {
      const ev = o && o.event ? CAL.byId(o.event) : null;
      if (ev) {
        const at = Number.isFinite(o.at) ? o.at : Date.now();
        const day = (o.date && CAL.occursOn(ev, o.date)) ? o.date : CAL.nextDay(ev, at);
        openForm(CAL.parseDay(day), null, ev);
        return true;
      }
      const d = o && CAL.parseDay(o.date);
      if (d) { S.sel = d; S.cur = som(d); paintAll(); return true; }
      return false;
    }
    function handle(o) {
      if (!o) return false;
      if (typeof o.shared === 'string' && o.shared) { if (!jump(o)) paintAll(); openShared(o.shared); return true; }
      if (typeof o.path === 'string' && /\.ics$/i.test(o.path)) { if (!jump(o)) paintAll(); importPath(o.path); return true; }
      return jump(o);
    }

    /* ---------------- paint ---------------- */
    function paintHead() {
      for (const b of tabs.children) b.classList.toggle('is-on', b.dataset.view === S.view && !S.q);
      titleEl.textContent = `${fmt.monthName(S.cur)} ${S.cur.getFullYear()}`;
      win.setTitle(`${fmt.monthName(S.cur, 1)} ${S.cur.getFullYear()}`);
      win.setSubtitle(S.view === 'month' ? '' : `— ${S.view} view`);
      const n = CAL.countInMonth(S.cur.getFullYear(), S.cur.getMonth());
      api.render(countEl, icon('calendar'), h('span', { text: `${n} event${n === 1 ? '' : 's'} this month` }));
      if (document.activeElement !== gotoIn) gotoIn.value = dkey(S.sel);
    }
    function paintBody() {
      cells = new Map();
      heads = new Map();
      grid = null;
      api.clear(body);
      body.dataset.view = S.q.trim() ? 'search' : S.view;
      for (const b of tabs.children) b.classList.toggle('is-on', b.dataset.view === S.view && !S.q.trim());
      if (S.q.trim()) paintSearch();
      else if (S.view === 'month') paintMonth();
      else if (S.view === 'week') paintWeek();
      else if (S.view === 'day') paintDay();
      else paintAgenda();
      mark(dkey(S.sel), true);
    }
    function paintAll() {
      paintHead();
      paintBody();
      paintSide();
    }
    if (!handle(opts)) paintAll();

    /* ---------------- wiring ---------------- */
    let lastDay = dkey(new Date());
    let lastMin = -1;
    const offTick = api.bus.on('tick:5s', () => {
      const k = dkey(new Date());
      if (k !== lastDay) { lastDay = k; paintAll(); return; }
      const m = Math.floor(Date.now() / 60000);
      if (m !== lastMin) { lastMin = m; paintNow(); }
    });
    const offPrefs = store.sub('prefs', () => {
      const v = !!store.get('prefs.h24');
      if (v === h24) return;
      h24 = v;
      paintAll();
    });
    /* changes made somewhere else (an Undo in a notification, a restored backup) */
    const offEvents = CAL.onChange(() => {
      if (writing || drag) return;
      if (S.form && S.form.id && !CAL.byId(S.form.id)) S.form = null;
      paintAll();
    });
    /* the layers: what Tasks and Study hold changes while Calendar is open */
    let layerT = 0;
    const offLayers = LAY.KEYS.map(k => store.sub(k, () => {
      clearTimeout(layerT);
      layerT = setTimeout(() => { if (S.dead || drag) return; V = LAY.view(); paintBody(); if (!S.form && !S.span) paintSide(); }, 60);
    }));
    /* Weather saved a new forecast: the day panel's line is read again (after its write has landed) */
    let wxT = 0;
    const offWx = CW.KEYS.map(k => store.sub(k, () => {
      clearTimeout(wxT);
      wxT = setTimeout(() => { if (!S.dead && !drag && !S.form && !S.span && V.forecast) paintSide(); }, 400);
    }));

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const act = document.activeElement;
      const tag = act && act.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape' && S.form) { e.preventDefault(); closeForm(); return; }
      if (e.key === 'Escape' && S.span && !typing) { e.preventDefault(); S.span = null; paintSide(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      /* the form owns the keyboard while you are filling it in */
      if ((S.form || S.span) && act && side.contains(act)) return;
      /* Enter belongs to whatever control has focus — stealing it stops the
         form's Add button, the view tabs and the prev/Today/next buttons
         from ever being activated from the keyboard */
      if (e.key === 'Enter' && act && act.closest && act.closest('button,select,a,[role="button"]')) return;
      const jumpBy = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (jumpBy !== undefined) { e.preventDefault(); select(addDays(S.sel, jumpBy)); return; }
      const k = e.key.toLowerCase();
      if (k === 't') { e.preventDefault(); goToday(); }
      else if (k === 'n') { e.preventDefault(); openForm(S.sel); }
      else if (k === 'm') setView('month');
      else if (k === 'w') setView('week');
      else if (k === 'd') setView('day');
      else if (k === 'a') setView('agenda');
      else if (k === 'g') { e.preventDefault(); gotoIn.focus(); try { gotoIn.showPicker?.(); } catch (err) { /* the field is enough */ } }
      else if (k === 'f' || k === '/') { e.preventDefault(); searchIn.focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); setView('day'); }
    };
    window.addEventListener('keydown', onKey);
    win.onReopen(o => { if (!handle(o)) goToday(); });

    return () => {
      S.dead = true;
      if (drag) endDrag();
      clearTimeout(layerT); clearTimeout(wxT);
      offTick(); offPrefs(); offEvents(); offLayers.forEach(f => f()); offWx.forEach(f => f());
      window.removeEventListener('keydown', onKey);
    };
  },
});
