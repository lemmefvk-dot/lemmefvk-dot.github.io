/* ============================================================
   Calendar — month grid, week and day views, a right-hand day
   panel, and an event form in that panel.

   Events are made, changed and deleted here; they can last all
   day or have a start (and an optional end), repeat every week,
   and carry a reminder. The events themselves live in
   js/core/calendar.js (store 'portal.calendar'), which the
   desktop's "Up next" widget reads too, and their reminders go
   off through the same engine as Static Automations' reminders
   (js/core/automations.js) — one clock-watcher for the whole OS,
   which only runs while StaticOS is open, and the form says so.

   It starts empty: an earlier version seeded a month of invented
   meetings "so it always looked lived-in", which is exactly the
   kind of made-up content StaticOS doesn't show.

   Opening it with { date: 'YYYY-MM-DD' } shows that day; with
   { event: id } it opens that event's form on the next day it
   happens (a reminder's "Open" and the Up next widget do this).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as CAL from '../core/calendar.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-calendar-css')) {
  const l = document.createElement('link');
  l.id = 'feat-calendar-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-calendar.css';
  document.head.appendChild(l);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const H0 = 8, H1 = 20;
const pad2 = n => String(n).padStart(2, '0');

defineApp({
  id: 'calendar',
  name: 'Calendar',
  icon: 'calendar',
  g1: '#ff9fb4', g2: '#bb2450',
  category: 'Productivity',
  keywords: ['events', 'month', 'agenda', 'schedule', 'dates', 'reminder', 'repeat', 'weekly', 'all day', 'appointment'],
  desc: 'Your month, week and day — events, weekly repeats and reminders',
  pinned: true, dock: true, singleton: true,
  win: { w: 860, h: 560, minW: 600, minH: 400 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Left / Right / Up / Down', 'Previous / next day or week'],
    ['T', 'Today'],
    ['N', 'New event on the selected day'],
    ['M / W / D', 'Month, week or day view'],
    ['Enter', 'Open the selected day'],
    ['Esc', 'Close the event form'],
  ],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, fmt, store } = api;

    /* ---------------- state ---------------- */
    const som = d => new Date(d.getFullYear(), d.getMonth(), 1);
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const dayOnly = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dkey = CAL.ymd;

    const S = { cur: som(new Date()), sel: dayOnly(new Date()), view: 'month', form: null, dead: false };
    let cells = new Map();   /* 'YYYY-MM-DD' → the cells that day owns  */
    let heads = new Map();   /* week view column headers, same keying   */
    let h24 = !!store.get('prefs.h24');
    let writing = false;     /* our own writes repaint once, not twice   */

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
    const span = ev => (ev.allDay ? 'All day' : ev.end ? `${fmtT(ev.time)} – ${fmtT(ev.end)}` : fmtT(ev.time));

    /* ---------------- chrome --------------- */
    win.setLead(
      h('button.ibtn.tip', { 'data-tip': 'Previous', 'aria-label': 'Previous', onclick: () => step(-1) }, icon('chevron-left')),
      h('button.ibtn.tip', {
        'data-tip': 'Jump to today  ·  T', 'aria-label': 'Today', text: 'Today',
        style: { padding: '0 var(--sp-3)', fontSize: 'var(--fs-10)', fontWeight: '600' },
        onclick: () => goToday(),
      }),
      h('button.ibtn.tip', { 'data-tip': 'Next', 'aria-label': 'Next', onclick: () => step(1) }, icon('chevron-right')),
    );
    const tabs = h('div.tabs', ...['month', 'week', 'day'].map(v =>
      h('button', { dataset: { view: v }, text: v[0].toUpperCase() + v.slice(1), onclick: () => setView(v) })));
    win.setTools(tabs, h('button.ibtn.tip', {
      'data-tip': 'Add event  ·  N', 'aria-label': 'Add event', dataset: { fk: 'cal-new' }, onclick: () => openForm(S.sel),
    }, icon('plus')));

    /* ---------------- layout --------------- */
    const titleEl = h('div.app__title');
    const countEl = h('span.chip');
    const body = h('div.cal');
    const main = h('div.app__main', h('div.app__bar', titleEl, h('div.grow'), countEl), body);
    const side = h('aside.app__side.cal-side', { 'aria-label': 'Selected day' });
    root.appendChild(h('div.app.cal-app', main, side));

    /* ---------------- pieces --------------- */
    const dot = tone => h('i.cal-dot', { style: { background: `var(${tone})` } });
    function pill(ev, tight) {
      const cls = ev.allDay ? '.cal__ev.is-allday' : '.cal__ev';
      return h(`div${cls}`, {
        dataset: { ev: ev.id },
        text: ev.allDay ? ev.title : `${tight ? shortT(ev.time) : fmtT(ev.time)}  ${ev.title}`,
        title: `${ev.title} · ${span(ev)}${ev.repeat === 'weekly' ? ' · every week' : ''}${ev.remind !== null ? ' · reminder' : ''}`,
        style: { '--tone': `var(${ev.tone})` },
      });
    }

    const mark = (k, on) => {
      (cells.get(k) || []).forEach(el => {
        el.classList.toggle('is-sel', on);
      });
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
        'aria-label': `${fmt.fmtDateLong(d)}, ${n} event${n === 1 ? '' : 's'}`,
        onclick: () => select(d),
        ondblclick: () => openForm(d, hr),
        oncontextmenu: e => dayMenu(e, d),
      });
      cells.set(k, [...(cells.get(k) || []), cell]);
      return cell;
    }

    /* ---------------- views ---------------- */
    function paintMonth() {
      const first = som(S.cur);
      const start = addDays(first, -first.getDay());
      const todayK = dkey(new Date());
      const grid = h('div.cal__grid');
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i);
        const evs = evOf(d);
        const cell = dayCell(d);
        if (d.getMonth() !== S.cur.getMonth()) cell.classList.add('is-out');
        if (dkey(d) === todayK) cell.classList.add('is-today');
        cell.appendChild(h('div.cal__n', { text: String(d.getDate()) }));
        for (const ev of evs.slice(0, 3)) cell.appendChild(pill(ev, true));
        /* not .cal__n — on today's cell that class turns into the accent date pill */
        if (evs.length > 3) cell.appendChild(h('div.cal__more', { text: `+${evs.length - 3} more` }));
        grid.appendChild(cell);
      }
      body.append(h('div.cal__dow', ...DOW.map(n => h('span', { text: n }))), grid);
    }

    /* the hours a week or day shows: 8 AM–8 PM, stretched to fit anything earlier or later */
    function hourRange(days) {
      let lo = H0, hi = H1;
      for (const d of days) for (const ev of evOf(d)) {
        if (ev.allDay) continue;
        const hh = Number(ev.time.slice(0, 2));
        lo = Math.min(lo, hh); hi = Math.max(hi, hh);
      }
      return [lo, hi];
    }
    const hourOf = ev => Number(ev.time.slice(0, 2));

    function paintWeek() {
      const start = addDays(S.sel, -S.sel.getDay());
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const cols = '52px repeat(7,1fr)';
      const todayK = dkey(new Date());
      const head = h('div.cal__dow', { style: { gridTemplateColumns: cols } }, h('span'));
      for (const d of days) {
        const span2 = h('span', { text: `${DOW[d.getDay()]} ${d.getDate()}`, class: dkey(d) === todayK ? 'is-today' : null });
        heads.set(dkey(d), span2);
        head.appendChild(span2);
      }
      const grid = h('div.cal__week', { style: { gridTemplateColumns: cols } });
      /* a row for the all-day events, then one per hour */
      grid.appendChild(h('div.cal__hr', { text: 'All day' }));
      for (const d of days) {
        const cell = dayCell(d, '.cal__cell--allday');
        for (const ev of evOf(d).filter(e => e.allDay)) cell.appendChild(pill(ev, true));
        grid.appendChild(cell);
      }
      const [lo, hi] = hourRange(days);
      for (let hr = lo; hr <= hi; hr++) {
        grid.appendChild(h('div.cal__hr', { text: hourLabel(hr) }));
        for (const d of days) {
          const cell = dayCell(d, '.cal__cell--hour', hr);
          for (const ev of evOf(d).filter(e => !e.allDay && hourOf(e) === hr)) cell.appendChild(pill(ev, true));
          grid.appendChild(cell);
        }
      }
      body.append(head, h('div.cal__scroll', grid));
    }

    function paintDay() {
      const evs = evOf(S.sel);
      const list = h('div.cal__dayl');
      const allDay = evs.filter(e => e.allDay);
      if (allDay.length) {
        const row = h('div.cal__drow.cal__drow--allday', h('div.cal__hr', { text: 'All day' }));
        for (const ev of allDay) row.appendChild(pill(ev));
        list.appendChild(row);
      }
      const [lo, hi] = hourRange([S.sel]);
      for (let hr = lo; hr <= hi; hr++) {
        const mine = evs.filter(e => !e.allDay && hourOf(e) === hr);
        /* one row per hour — not registered as a day cell, so the whole
           agenda does not light up as "the selected day" */
        const row = h('button.cal__drow', {
          type: 'button',
          'aria-label': `${hourLabel(hr)}, ${mine.length} events`,
          ondblclick: () => openForm(S.sel, hr),
        }, h('div.cal__hr', { text: hourLabel(hr) }));
        if (mine.length) for (const ev of mine) row.appendChild(pill(ev));
        else row.appendChild(h('span.cal__free', { text: 'Free' }));
        list.appendChild(row);
      }
      body.append(
        h('div.cal__dow', { style: { gridTemplateColumns: '1fr' } },
          h('span', { text: `${fmt.fmtDateLong(S.sel)} — ${evs.length} event${evs.length === 1 ? '' : 's'}` })),
        list);
    }

    /* ---------------- side pane ------------- */
    function paintSide() {
      api.clear(side);
      const evs = evOf(S.sel);
      const group = h('div.side__group',
        h('div.side__label', { text: `${fmt.dayName(S.sel, 1)}, ${fmt.monthName(S.sel, 1)} ${S.sel.getDate()}` }));
      if (!evs.length) {
        group.appendChild(h('div.empty.cal-empty',
          icon('calendar'), h('b', { text: 'Nothing planned' }),
          h('small', { text: 'Double-click a day, or add one below.' })));
      } else {
        for (const ev of evs) {
          group.appendChild(h('button.side__item.cal-item', {
            type: 'button',
            dataset: { ev: ev.id },
            class: S.form && S.form.id === ev.id ? 'is-on' : null,
            title: `${ev.title} · ${span(ev)} — click to change`,
            onclick: () => openForm(S.sel, null, ev),
            oncontextmenu: e => evMenu(e, ev),
          },
            dot(ev.tone),
            h('span.cal-item__t', h('b', { text: ev.title }), h('small', { text: span(ev) })),
            ev.repeat === 'weekly' ? h('span.cal-item__ic', { title: 'Every week', 'aria-label': 'Repeats every week' }, icon('repeat')) : null,
            ev.remind !== null ? h('span.cal-item__ic', { title: CAL.remindLabel(ev.remind, ev.allDay), 'aria-label': `Reminder: ${CAL.remindLabel(ev.remind, ev.allDay)}` }, icon('bell')) : null));
        }
      }
      side.appendChild(group);
      side.appendChild(S.form ? formEl() : h('button.btn.btn--sm.btn--block', {
        type: 'button', dataset: { fk: 'cal-add' }, onclick: () => openForm(S.sel),
      }, icon('plus'), 'Add event'));
    }

    /* ---------------- the form -------------- */
    function formEl() {
      const f = S.form;
      const probs = f.tried ? CAL.issues(f) : [];
      const issue = at => {
        const x = probs.find(p => p.at === at);
        return x ? h('div.cal-issue', { role: 'alert' }, icon('alert'), h('span', { text: x.text })) : null;
      };
      const field = (label, input, at) => h('label.cal-f', h('span.cal-f__l', { text: label }), input, at ? issue(at) : null);

      const tIn = h('input.cal-in', { type: 'text', placeholder: 'Event name', value: f.title, spellcheck: 'false', maxlength: String(CAL.TITLE_MAX),
        'aria-label': 'Event name', dataset: { fk: 'cal-title' }, oninput: e => { f.title = e.target.value; } });
      const weekdayOf = s => (CAL.parseDay(s) ? DOW_LONG[CAL.parseDay(s).getDay()] : 'this weekday');
      const dIn = h('input.cal-in', { type: 'date', value: f.date, 'aria-label': 'Day', dataset: { fk: 'cal-date' },
        onchange: e => {
          f.date = e.target.value;
          /* the weekly choice names the weekday — keep it true without rebuilding the form */
          rSel.options[1].textContent = `Every week on ${weekdayOf(f.date)}`;
        } });
      const allSw = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!f.allDay), class: f.allDay ? 'is-on' : null,
        'aria-label': 'All day', dataset: { fk: 'cal-allday' },
        onclick: () => {
          f.allDay = !f.allDay;
          /* the reminder choices differ: keep "none", otherwise take the closest sensible one */
          if (f.remind !== null) f.remind = f.allDay ? -540 : 15;
          f.refocus = 'cal-allday';
          paintSide();
        } });
      const sIn = h('input.cal-in', { type: 'time', value: f.time, 'aria-label': 'Starts', dataset: { fk: 'cal-start' },
        oninput: e => { f.time = e.target.value; }, onchange: e => { f.time = e.target.value; } });
      const eIn = h('input.cal-in', { type: 'time', value: f.end, 'aria-label': 'Ends (optional)', dataset: { fk: 'cal-end' },
        oninput: e => { f.end = e.target.value; }, onchange: e => { f.end = e.target.value; } });
      const rSel = h('select.select.cal-in', { 'aria-label': 'Repeat', dataset: { fk: 'cal-repeat' }, onchange: e => { f.repeat = e.target.value; } },
        h('option', { value: 'none', text: 'Doesn’t repeat', selected: f.repeat !== 'weekly' }),
        h('option', { value: 'weekly', text: `Every week on ${weekdayOf(f.date)}`, selected: f.repeat === 'weekly' }));
      const hint = h('small.cal-hint', { text: 'Goes off as a notification while StaticOS is open in this browser.', hidden: f.remind === null });
      const mSel = h('select.select.cal-in', { 'aria-label': 'Reminder', dataset: { fk: 'cal-remind' },
        onchange: e => { f.remind = e.target.value === '' ? null : Number(e.target.value); hint.hidden = f.remind === null; } },
        CAL.remindChoices(!!f.allDay).map(([v, l]) => h('option', { value: v === null ? '' : String(v), text: l, selected: v === f.remind })));
      const tones = h('div.cal-tones', { role: 'radiogroup', 'aria-label': 'Colour' },
        CAL.TONES.map((t, i) => h('button.cal-tone', {
          type: 'button', role: 'radio', 'aria-checked': String(f.tone === t), 'aria-label': `Colour ${i + 1}`,
          class: f.tone === t ? 'is-on' : null, style: { '--tone': `var(${t})` },
          onclick: e => {
            f.tone = t;
            for (const b of tones.children) { const on = b === e.currentTarget; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); }
          },
        })));

      const editing = !!f.id;
      const ev = editing ? CAL.byId(f.id) : null;
      const repeating = ev && ev.repeat === 'weekly';
      const form = h('form.cal-form', {
        'aria-label': editing ? 'Change event' : 'New event',
        onsubmit: e => { e.preventDefault(); commit(); },
      },
        h('div.side__label', { text: editing ? 'Change event' : `New event · ${fmt.monthName(CAL.parseDay(f.date) || S.sel, 1)} ${(CAL.parseDay(f.date) || S.sel).getDate()}` }),
        field('Name', h('div.field', tIn), 'title'),
        field('Day', h('div.field', dIn), 'date'),
        h('div.cal-f.cal-f--row', h('span.cal-f__l', { text: 'All day' }), allSw),
        f.allDay ? null : h('div.cal-times',
          field('Starts', h('div.field', sIn), 'time'),
          field('Ends', h('div.field', eIn), 'end')),
        field('Repeat', rSel, 'repeat'),
        field('Reminder', mSel, 'remind'),
        hint,
        h('div.cal-f', h('span.cal-f__l', { text: 'Colour' }), tones),
        h('div.row.cal-form__go',
          h('button.btn.btn--sm.btn--primary.grow', { type: 'submit', dataset: { fk: 'cal-save' } }, icon('check'), editing ? 'Save' : 'Add'),
          h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': 'Cancel', 'aria-label': 'Cancel', dataset: { fk: 'cal-cancel' }, onclick: closeForm }, icon('x'))),
        editing && repeating ? h('button.btn.btn--sm.btn--block', {
          type: 'button', dataset: { fk: 'cal-delete-one' }, onclick: () => skipOne(f.id, f.on || dkey(S.sel)),
        }, icon('minus'), `Delete only ${fmt.monthName(CAL.parseDay(f.on) || S.sel, 1)} ${(CAL.parseDay(f.on) || S.sel).getDate()}`) : null,
        editing ? h('button.btn.btn--sm.btn--danger.btn--block', {
          type: 'button', dataset: { fk: repeating ? 'cal-delete-all' : 'cal-delete' }, onclick: () => removeEv(f.id),
        }, icon('trash'), repeating ? 'Delete every week' : 'Delete event') : null);
      const back = f.refocus;
      if (back) requestAnimationFrame(() => { if (!S.dead) form.querySelector(`[data-fk="${back}"]`)?.focus(); });
      else if (f.focus !== false) requestAnimationFrame(() => { if (!S.dead && document.contains(tIn) && !side.contains(document.activeElement)) tIn.focus(); });
      f.focus = false;
      f.refocus = null;
      return form;
    }

    /* ---------------- actions --------------- */
    function suggestTime(d) {
      const now = new Date();
      if (dkey(d) !== dkey(now)) return '09:00';
      return `${pad2(Math.min(23, Math.max(H0, now.getHours() + 1)))}:00`;
    }
    function openForm(d, hr, ev) {
      S.sel = dayOnly(d);
      S.cur = som(S.sel);
      const k = dkey(S.sel);
      S.form = ev
        ? { id: ev.id, on: k, title: ev.title, date: ev.date, allDay: ev.allDay, time: ev.time || '09:00', end: ev.end || '',
            repeat: ev.repeat, remind: ev.remind, tone: ev.tone, tried: false }
        : { id: null, on: k, title: '', date: k, allDay: false,
            time: hr === undefined || hr === null ? suggestTime(d) : `${pad2(hr)}:00`, end: '',
            repeat: 'none', remind: null, tone: CAL.TONES[evOf(d).length % CAL.TONES.length], tried: false };
      paintAll();
    }
    function closeForm() { S.form = null; paintSide(); }

    const reminderNote = (res, title) => {
      if (res.reminder === 'passed') return ' The reminder time has already passed, so no reminder was set.';
      if (res.reminder === 'full') return ' Calendar has too many reminders already, so this one wasn’t set.';
      return '';
    };
    function commit() {
      const f = S.form;
      const draft = { title: f.title, date: f.date, allDay: !!f.allDay, time: f.time, end: f.allDay ? '' : f.end, repeat: f.repeat, remind: f.remind, tone: f.tone };
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
      const rem = res.reminder === 'set' ? ` · reminder ${lbl.charAt(0).toLowerCase()}${lbl.slice(1)}` : '';
      api.notify({ app: 'Calendar', icon: 'calendar', title: f.id ? 'Event saved' : 'Event added',
        message: `${ev.title} · ${span(ev)}${ev.repeat === 'weekly' ? ' · every week' : ''}${rem}.${extra}`, timeout: extra ? 7000 : 3200 });
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
        app: 'Calendar', icon: 'trash', title: gone.repeat === 'weekly' ? 'Weekly event removed' : 'Event removed', message: gone.title, timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => { CAL.restoreEvent(gone); } }],
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
        app: 'Calendar', icon: 'trash', title: 'Removed one day', message: `${before.title} · ${fmt.dayName(d, 1)} ${fmt.monthName(d, 1)} ${d.getDate()} — the other weeks stay.`, timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => { CAL.replaceEvent(before); } }],
      });
    }

    function evMenu(e, ev) {
      e.preventDefault(); e.stopPropagation();
      const k = dkey(S.sel);
      api.menu([
        { label: 'Change…', icon: 'edit-3', onClick: () => openForm(S.sel, null, ev) },
        { label: 'Duplicate', icon: 'copy', onClick: () => {
            CAL.addEvent({ ...ev, date: k, repeat: 'none', title: `${ev.title} copy` });
          } },
        ev.repeat === 'weekly' ? null : { label: 'Move to next day', icon: 'chevron-right', onClick: () => {
            S.sel = addDays(S.sel, 1); S.cur = som(S.sel);
            CAL.updateEvent(ev.id, { date: dkey(addDays(CAL.parseDay(ev.date), 1)) });
          } },
        '-',
        ev.repeat === 'weekly' ? { label: 'Delete only this day', icon: 'minus', onClick: () => skipOne(ev.id, k) } : null,
        { label: ev.repeat === 'weekly' ? 'Delete every week' : 'Delete event', icon: 'trash', danger: true, onClick: () => removeEv(ev.id) },
      ].filter(Boolean), e.clientX, e.clientY);
    }

    function dayMenu(e, d) {
      e.preventDefault();
      select(d);
      const n = evOf(d).length;
      api.menu([
        { label: 'Add event…', icon: 'plus', onClick: () => openForm(d) },
        { label: 'Open day view', icon: 'list', onClick: () => { S.sel = dayOnly(d); setView('day'); } },
        '-',
        { label: `${n} event${n === 1 ? '' : 's'}`, icon: 'calendar', disabled: true },
      ], e.clientX, e.clientY);
    }

    /** Selecting a day already on screen only moves the highlight — the
        grid must survive the first click so a double-click can land. */
    function select(d) {
      const nd = dayOnly(d);
      const prev = dkey(S.sel);
      if (dkey(nd) === prev) { paintSide(); return; }
      const onScreen = cells.has(dkey(nd)) && (S.view !== 'month' || nd.getMonth() === S.cur.getMonth());
      S.sel = nd;
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
    function goToday() { S.sel = dayOnly(new Date()); S.cur = som(S.sel); paintAll(); }
    function step(n) {
      if (S.view === 'month') {
        S.cur = new Date(S.cur.getFullYear(), S.cur.getMonth() + n, 1);
        const dim = new Date(S.cur.getFullYear(), S.cur.getMonth() + 1, 0).getDate();
        S.sel = new Date(S.cur.getFullYear(), S.cur.getMonth(), Math.min(S.sel.getDate(), dim));
      } else {
        S.sel = addDays(S.sel, S.view === 'week' ? 7 * n : n);
        S.cur = som(S.sel);
      }
      paintAll();
    }
    function setView(v) { if (S.view === v) return; S.view = v; paintAll(); }

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

    /* ---------------- paint ---------------- */
    function paintHead() {
      for (const b of tabs.children) b.classList.toggle('is-on', b.dataset.view === S.view);
      titleEl.textContent = `${fmt.monthName(S.cur)} ${S.cur.getFullYear()}`;
      win.setTitle(`${fmt.monthName(S.cur, 1)} ${S.cur.getFullYear()}`);
      win.setSubtitle(S.view === 'month' ? '' : `— ${S.view} view`);
      const n = CAL.countInMonth(S.cur.getFullYear(), S.cur.getMonth());
      api.render(countEl, icon('calendar'), h('span', { text: `${n} event${n === 1 ? '' : 's'} this month` }));
    }

    function paintAll() {
      paintHead();
      cells = new Map();
      heads = new Map();
      api.clear(body);
      if (S.view === 'month') paintMonth();
      else if (S.view === 'week') paintWeek();
      else paintDay();
      mark(dkey(S.sel), true);
      paintSide();
    }
    if (!jump(opts)) paintAll();

    /* ---------------- wiring ---------------- */
    let lastDay = dkey(new Date());
    const offTick = api.bus.on('tick:5s', () => {
      const k = dkey(new Date());
      if (k === lastDay) return;
      lastDay = k;
      paintAll();
    });
    const offPrefs = store.sub('prefs', () => {
      const v = !!store.get('prefs.h24');
      if (v === h24) return;
      h24 = v;
      paintAll();
    });
    /* changes made somewhere else (an Undo in a notification, a restored backup) */
    const offEvents = CAL.onChange(() => {
      if (writing) return;
      if (S.form && S.form.id && !CAL.byId(S.form.id)) S.form = null;
      paintAll();
    });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const act = document.activeElement;
      const tag = act && act.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape' && S.form) { e.preventDefault(); closeForm(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      /* the form owns the keyboard while you are filling it in */
      if (S.form && act && side.contains(act)) return;
      /* Enter belongs to whatever control has focus — stealing it stops the
         form's Add button, the view tabs and the prev/Today/next buttons
         from ever being activated from the keyboard */
      if (e.key === 'Enter' && act && act.closest && act.closest('button,select,a,[role="button"]')) return;
      const jumpBy = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (jumpBy !== undefined) { e.preventDefault(); select(addDays(S.sel, jumpBy)); return; }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); goToday(); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openForm(S.sel); }
      else if (e.key === 'm' || e.key === 'M') setView('month');
      else if (e.key === 'w' || e.key === 'W') setView('week');
      else if (e.key === 'd' || e.key === 'D') setView('day');
      else if (e.key === 'Enter') { e.preventDefault(); setView('day'); }
    };
    window.addEventListener('keydown', onKey);
    win.onReopen(o => { if (!jump(o)) goToday(); });

    return () => {
      S.dead = true;
      offTick(); offPrefs(); offEvents();
      window.removeEventListener('keydown', onKey);
    };
  },
});
