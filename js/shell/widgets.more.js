/* ============================================================
   widgets.more.js — the rail's widgets that read what you keep in
   other apps: homework and tasks due next, the next class, the Focus
   timer, Screen Time, habit streaks, a world clock, a photo frame, the
   quote of the day and the Try it checklist.

   The rail (shell/widgets.js) owns the frame — moving, hiding, resizing —
   and hands each builder what it needs. A builder returns the same shape
   as the others there: { nodes, paint, tick, show, offs }.

   Every number and name comes from the app that owns it (core/homework.js,
   tasks.js, timetable.js, focus.js, screentime.js, habits.js, the vfs for
   pictures). With nothing to show, the card says so and points at the app;
   it never fills in a sample.
   ============================================================ */
import * as HW from '../core/homework.js';
import * as TASKS from '../core/tasks.js';
import * as TT from '../core/timetable.js';
import * as FOCUS from '../core/focus.js';
import * as ST from '../core/screentime.js';
import * as HAB from '../core/habits.js';
import * as LIFE from '../life/data.js';
import * as TRY from '../core/tryit.js';
import { quoteOfDay } from './quotes.data.js';

const PHOTO_KEY = 'prefs.photoFrame';
const CLOCK_KEY = 'prefs.worldClock';
const PHOTO_MS = 12000;

/** Cities for the world clock: a real time zone each (the browser knows their rules). */
export const CITIES = [
  ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Los Angeles', 'America/Los_Angeles'],
  ['Denver', 'America/Denver'], ['Chicago', 'America/Chicago'], ['New York', 'America/New_York'],
  ['Toronto', 'America/Toronto'], ['Mexico City', 'America/Mexico_City'], ['Bogotá', 'America/Bogota'],
  ['São Paulo', 'America/Sao_Paulo'], ['Buenos Aires', 'America/Argentina/Buenos_Aires'],
  ['Reykjavik', 'Atlantic/Reykjavik'], ['London', 'Europe/London'], ['Paris', 'Europe/Paris'],
  ['Berlin', 'Europe/Berlin'], ['Madrid', 'Europe/Madrid'], ['Rome', 'Europe/Rome'], ['Athens', 'Europe/Athens'],
  ['Istanbul', 'Europe/Istanbul'], ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'], ['Nairobi', 'Africa/Nairobi'],
  ['Johannesburg', 'Africa/Johannesburg'], ['Moscow', 'Europe/Moscow'], ['Dubai', 'Asia/Dubai'],
  ['Karachi', 'Asia/Karachi'], ['Delhi', 'Asia/Kolkata'], ['Dhaka', 'Asia/Dhaka'], ['Bangkok', 'Asia/Bangkok'],
  ['Singapore', 'Asia/Singapore'], ['Hong Kong', 'Asia/Hong_Kong'], ['Shanghai', 'Asia/Shanghai'],
  ['Seoul', 'Asia/Seoul'], ['Tokyo', 'Asia/Tokyo'], ['Perth', 'Australia/Perth'], ['Sydney', 'Australia/Sydney'],
  ['Auckland', 'Pacific/Auckland'],
];

/* ---------------- due next ---------------- */
const dayEnd = day => { const d = HW.parseDay(day); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime() : 0; };

/** The next few things due, homework and tasks together, soonest first (overdue leads).
    -> [{ kind: 'homework'|'task', id, title, where, due, at, status, time }] */
export function dueNext(n = 3, now = Date.now()) {
  const out = [];
  try {
    const hw = HW.read();
    const names = new Map(hw.classes.map(c => [c.id, c.name]));
    for (const a of hw.assignments) {
      if (a.done) continue;
      out.push({ kind: 'homework', id: a.id, title: a.title, where: names.get(a.classId) || 'Homework', due: a.due, time: a.time, at: HW.dueAt(a), status: HW.statusOf(a, now) });
    }
  } catch (e) { /* no homework yet */ }
  try {
    const data = TASKS.read();
    const today = TASKS.dayOf(now);
    TASKS.walkTasks(data, (t, list) => {
      if (t.done || !t.due || !t.text.trim()) return;
      out.push({ kind: 'task', id: t.id, title: t.text, where: list.name, due: t.due, time: '', at: dayEnd(t.due),
        status: t.due < today ? 'overdue' : t.due === today ? 'today' : 'soon' });
    });
  } catch (e) { /* no tasks yet */ }
  return out.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title)).slice(0, n);
}

/** "Overdue", "Today 3:30 PM", "Tomorrow", "Fri" — for a due day, from `now`. */
export function dueWord(it, now = Date.now()) {
  if (it.status === 'overdue') return 'Overdue';
  const d = HW.parseDay(it.due);
  if (!d) return '';
  const t = new Date(now);
  const diff = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
  const word = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff < 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!it.time) return word;
  const [hh, mm] = it.time.split(':').map(Number);
  return `${word} ${new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function makeWidgets({ api, rail, store, bus, fmt }) {
  const { h, icon, clear, render } = api;
  const open = (id, o) => () => api.openApp(id, o);
  const emptyWith = (text, label, run) => [
    h('div.wg__empty', { text }),
    h('button.btn.btn--sm.btn--block', { type: 'button', style: { marginTop: 'var(--sp-3)' }, onclick: run }, label),
  ];
  const mine = el => rail.contains(el);
  /* repaint when the minute turns (the rail ticks every second; Game Mode thins that to once a minute) */
  const minuteTick = paint => { let last = -1; return d => { const m = Math.floor(d.getTime() / 60000); if (m !== last) { last = m; paint(); } }; };

  /* ---------------- homework and tasks due next ---------------- */
  const due = () => {
    const body = h('div');
    function paint() {
      clear(body);
      const rows = dueNext(3);
      if (!rows.length) {
        body.append(...emptyWith('Nothing is due. Homework from Static Study and tasks with a due date show up here.', 'Open Study', open('study', { tab: 'homework' })));
        return;
      }
      body.appendChild(h('div.wg-list', rows.map(r => h('button.wg-row.wg-due', {
        type: 'button', class: `is-${r.status}`, dataset: { kind: r.kind, id: r.id },
        'aria-label': `${r.title}, ${dueWord(r)}, open ${r.kind === 'homework' ? 'Study' : 'Tasks'}`,
        onclick: () => (r.kind === 'homework' ? api.openApp('study', { tab: 'homework' }) : api.openApp('tasks')),
      },
        icon(r.kind === 'homework' ? 'clipboard' : 'check-circle', { size: 13 }),
        h('span.grow.wg-due__t', h('b.trunc', { text: r.title }), h('small.trunc', { text: r.where })),
        h('small.wg-due__d', { text: dueWord(r) })))));
    }
    return {
      nodes: [body], paint, tick: minuteTick(paint),
      offs: [store.sub(HW.KEY, () => paint()), store.sub(TASKS.STORE_KEY, () => paint())],
    };
  };

  /* ---------------- next class ---------------- */
  const timetable = () => {
    const body = h('div');
    const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    function paint() {
      clear(body);
      const data = TT.read();
      if (!data.classes.length) {
        body.append(...emptyWith('No classes yet. Add your timetable in Static Study.', 'Open Timetable', open('study', { tab: 'timetable' })));
        return;
      }
      const s = TT.status(Date.now(), data);
      const line = (k, c, sub) => h('div.wg-class', { dataset: { k } },
        h('i.wg-class__dot', { style: { background: TT.colorFor(c.subject, HW.read().classes) } }),
        h('div.grow', h('b.trunc', { text: c.subject }), h('small.trunc', { text: [c.room, sub].filter(Boolean).join(' · ') })));
      if (s.current.length) {
        const c = s.current[0];
        body.appendChild(h('div.wg-class__k', { text: 'Now' }));
        body.appendChild(line('now', c, `until ${clock(c.endAt)}`));
      }
      if (s.next) {
        const c = s.next;
        body.appendChild(h('div.wg-class__k', { text: 'Next' }));
        body.appendChild(line('next', c, `${s.nextDay === TT.ymd(new Date()) ? '' : `${TT.dayWord(s.nextDay)} `}${clock(c.startAt)}`));
      }
      if (!s.current.length && !s.next) body.appendChild(h('div.wg__empty', { text: 'No class coming up in the next two weeks.' }));
      body.appendChild(h('button.btn.btn--sm.btn--block', { type: 'button', style: { marginTop: 'var(--sp-3)' }, onclick: open('study', { tab: 'timetable' }) }, 'Open Timetable'));
    }
    return { nodes: [body], paint, tick: minuteTick(paint), offs: [store.sub(TT.KEY, () => paint())] };
  };

  /* ---------------- Focus timer ---------------- */
  const focus = () => {
    const time = h('div.wg-focus__t', { role: 'timer' });
    const phase = h('div.wg-focus__p');
    const day = h('div.wg__note');
    const go = h('button.btn.btn--sm.btn--primary.grow', { type: 'button', onclick: () => FOCUS.toggle() });
    const stop = h('button.btn.btn--sm', { type: 'button', onclick: () => FOCUS.reset() }, 'Stop');
    const mmss = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    function paint() {
      const s = FOCUS.state();
      const ready = s.status === 'ready';
      time.textContent = mmss(ready ? FOCUS.config()[s.phase] * 60000 : s.left);
      phase.textContent = s.status === 'paused' ? `${s.label} · paused` : s.label;
      go.textContent = s.status === 'running' ? 'Pause' : s.status === 'paused' ? 'Resume' : 'Start';
      go.setAttribute('aria-label', `${go.textContent} the ${s.label.toLowerCase()} timer`);
      stop.disabled = ready;
      const t = FOCUS.today();
      day.textContent = t.n ? `Today: ${t.n} focus session${t.n === 1 ? '' : 's'}, ${t.min} min` : 'No focus sessions yet today.';
    }
    return {
      nodes: [phase, time, h('div.row', { style: { gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' } }, go, stop), day],
      paint, tick: () => { if (FOCUS.state().status === 'running') paint(); },
      offs: [bus.on('focus:change', () => paint())],
    };
  };

  /* ---------------- Screen Time today ---------------- */
  const screentime = () => {
    const body = h('div');
    function paint() {
      clear(body);
      let d = null;
      try { d = ST.day(); } catch (e) { d = null; }
      if (!d || !d.total) {
        body.append(...emptyWith('Nothing measured yet today. Screen Time counts while StaticOS is open and in use.', 'Open Screen Time', () => api.openApp('settings', { section: 'screentime' })));
        return;
      }
      const top = d.apps.slice(0, 4);
      body.appendChild(h('button.wg-st', { type: 'button', 'aria-label': 'Open Screen Time', onclick: () => api.openApp('settings', { section: 'screentime' }) },
        h('div.wg-st__n', { text: ST.fmtDur(d.total) }), h('small', { text: 'in StaticOS today' }),
        h('div.wg-st__rows', top.map(a => {
          const app = api.getApp(a.id);
          return h('div.wg-st__r', { dataset: { app: a.id, sec: String(a.sec) } },
            h('span.trunc', { text: app ? app.name : a.id }),
            h('i', h('b', { style: { width: `${Math.max(4, Math.round(a.sec / top[0].sec * 100))}%` } })),
            h('small', { text: ST.fmtDur(a.sec) }));
        }))));
    }
    return { nodes: [body], paint, offs: [bus.on('tick:5s', () => paint())] };
  };

  /* ---------------- habit streaks (Static Life) ---------------- */
  const habits = () => {
    const body = h('div');
    const list = () => (LIFE.read().habits || []).map(HAB.normHabit).filter(Boolean);
    function toggle(id) {
      const today = HAB.dayKey();
      LIFE.write('habits', list().map(x => (x.id === id ? HAB.toggleDay(x, today, today) : x)));
    }
    function paint() {
      clear(body);
      const all = list();
      if (!all.length) {
        body.append(...emptyWith('No habits yet. Add some in Static Life.', 'Open Static Life', open('life')));
        return;
      }
      const today = HAB.dayKey();
      body.appendChild(h('div.wg-list', all.slice(0, 5).map(x => {
        const s = HAB.streaks(x, today);
        const due = s.scheduledToday;
        return h('div.wg-hab', { dataset: { habit: x.id } },
          h('button.wg-hab__tick', {
            type: 'button', role: 'checkbox', 'aria-checked': String(s.doneToday), disabled: !due,
            'aria-label': `${x.name}: ${s.doneToday ? 'done today' : due ? 'mark done today' : 'not scheduled today'}`,
            onclick: () => toggle(x.id),
          }, s.doneToday ? icon('check', { size: 12 }) : null),
          h('span.grow.trunc', { text: x.name }),
          h('small.wg-hab__s', { text: s.current ? `${s.current}-day streak` : due ? 'no streak yet' : 'rest day' }));
      })));
      if (all.length > 5) body.appendChild(h('div.wg__note', { text: `${all.length - 5} more in Static Life.` }));
    }
    return {
      nodes: [body], paint, tick: d => { if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) paint(); },
      offs: [store.sub(LIFE.KEY, () => paint())],
    };
  };

  /* ---------------- world clock ---------------- */
  const worldClock = () => {
    const body = h('div');
    const picked = () => {
      const v = store.get(CLOCK_KEY, []);
      return (Array.isArray(v) ? v : []).filter(z => CITIES.some(c => c[1] === z)).slice(0, 3);
    };
    const toggle = z => {
      const cur = picked();
      store.set(CLOCK_KEY, cur.includes(z) ? cur.filter(x => x !== z) : [...cur, z].slice(0, 3));
    };
    function choose(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const cur = picked();
      const regions = [['Americas', /^(America|Pacific\/Honolulu)/], ['Europe', /^(Europe|Atlantic)/], ['Africa', /^Africa/], ['Asia', /^Asia/], ['Australia and New Zealand', /^(Australia|Pacific\/Auckland)/]];
      const item = ([name, z]) => ({ label: name, checked: cur.includes(z), disabled: !cur.includes(z) && cur.length >= 3, onClick: () => toggle(z) });
      api.menu([{ header: true, label: cur.length >= 3 ? 'Three cities picked' : 'Pick up to 3 cities' },
        ...regions.map(([label, re]) => ({ label, icon: 'globe', items: CITIES.filter(c => re.test(c[1])).map(item) }))], r.left, r.bottom + 4);
    }
    const dayLabel = (z, now) => {
      const key = tz => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const a = key(z), b = key(Intl.DateTimeFormat().resolvedOptions().timeZone);
      return a === b ? 'Today' : a > b ? 'Tomorrow' : 'Yesterday';
    };
    function paint() {
      clear(body);
      const zs = picked();
      const now = new Date();
      const h24 = !!store.get('prefs.h24');
      if (!zs.length) body.appendChild(h('div.wg__empty', { text: 'Pick two or three cities to see their time.' }));
      for (const z of zs) {
        const name = (CITIES.find(c => c[1] === z) || [z])[0];
        body.appendChild(h('div.wg-wc', { dataset: { zone: z } },
          h('div.grow', h('b.trunc', { text: name }), h('small', { text: dayLabel(z, now) })),
          h('span.wg-wc__t', { text: now.toLocaleTimeString(undefined, { timeZone: z, hour: 'numeric', minute: '2-digit', hour12: !h24 }) })));
      }
      body.appendChild(h('button.btn.btn--sm.btn--block', { type: 'button', style: { marginTop: 'var(--sp-3)' }, 'aria-haspopup': 'menu', onclick: choose }, zs.length ? 'Change cities' : 'Choose cities'));
    }
    return {
      nodes: [body], paint, tick: minuteTick(paint),
      offs: [store.sub(CLOCK_KEY, () => paint()), store.sub('prefs.h24', () => paint())],
    };
  };

  /* ---------------- photo frame ---------------- */
  const photos = () => {
    const frame = h('div.wg-photo__img');
    const cap = h('div.wg-photo__cap');
    const body = h('div');
    let list = [], at = 0, timer = 0, token = 0;
    const base = () => `${api.vfs.HOME}/Pictures`;
    const album = () => { const v = store.get(PHOTO_KEY, null); return v && typeof v.album === 'string' ? v.album : ''; };

    function scan() {
      list = [];
      const dir = album() ? `${base()}/${album()}` : base();
      try {
        api.vfs.walk(dir, (n, p) => {
          if (n.type === 'file' && !p.includes('/.') && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(n.name)) list.push({ path: p, name: n.name });
        });
      } catch (e) { list = []; }
      list.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    }
    async function show(i) {
      if (!list.length) return;
      at = ((i % list.length) + list.length) % list.length;
      const my = ++token;
      const it = list[at];
      let url = null;
      try { url = await (await import('../core/media.js')).urlOf(it.path); } catch (e) { url = null; }
      if (my !== token) return;
      frame.style.backgroundImage = url ? `url("${String(url).replace(/"/g, '%22')}")` : '';
      frame.dataset.path = it.path;
      cap.textContent = `${it.name.replace(/\.[^.]+$/, '')} · ${at + 1} of ${list.length}`;
    }
    function albums() {
      try { return api.vfs.ls(base()).filter(n => n.type === 'dir').map(n => n.name); } catch (e) { return []; }
    }
    function pick(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const cur = album();
      api.menu([{ header: true, label: 'Show pictures from' },
        { label: 'All pictures', checked: !cur, onClick: () => store.set(PHOTO_KEY, { album: '' }) },
        ...albums().map(a => ({ label: a, checked: cur === a, onClick: () => store.set(PHOTO_KEY, { album: a }) }))], r.left, r.bottom + 4);
    }
    function stop() { clearInterval(timer); timer = 0; }
    function paint() {
      clear(body);
      scan();
      if (!list.length) {
        stop();
        body.append(...emptyWith(album() ? `No pictures in “${album()}” yet.` : 'No pictures yet. Add some in Photos.', 'Open Photos', open('photos')));
        return;
      }
      body.append(
        h('button.wg-photo', { type: 'button', 'aria-label': 'Open this picture in Photos', onclick: () => api.openApp('photos', { path: frame.dataset.path }) }, frame),
        h('div.wg-photo__bar', h('small.grow.trunc', cap),
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Next picture', 'aria-label': 'Next picture', onclick: () => show(at + 1) }, icon('skip-forward')),
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Choose album', 'aria-label': 'Choose album', 'aria-haspopup': 'menu', onclick: pick }, icon('image'))));
      show(Math.min(at, list.length - 1));
      stop();
      timer = setInterval(() => { if (mine(body) && list.length > 1 && !document.hidden) show(at + 1); }, PHOTO_MS);
    }
    return {
      nodes: [body], paint,
      offs: [stop, store.sub(PHOTO_KEY, () => { at = 0; paint(); }), bus.on('fs:change', () => paint())],
    };
  };

  /* ---------------- quote of the day ---------------- */
  const quote = () => {
    const body = h('div');
    let day = '';
    function paint(now = new Date()) {
      const key = now.toDateString();
      if (key === day && body.firstChild) return;
      day = key;
      const q = quoteOfDay(now);
      render(body, h('figure.wg-quote', h('blockquote', { text: `“${q.text}”` }),
        h('figcaption', h('b', { text: q.author }), h('small', { text: q.work }))));
    }
    return { nodes: [body], paint, tick: d => { if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) paint(d); } };
  };

  /* ---------------- Try it ---------------- */
  const tryit = () => {
    const body = h('div');
    function paint() {
      clear(body);
      const rows = TRY.items();
      const p = TRY.progress();
      const done = p.done >= p.total;
      body.appendChild(h('div.wg-try__sum', h('b', { text: `${p.done} of ${p.total}` }), h('small', { text: done ? 'all tried' : 'ticked as you do them' }),
        h('i.wg-try__bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.done), 'aria-label': 'Try it progress' }, h('b', { style: { width: `${p.total ? Math.round(p.done / p.total * 100) : 0}%` } }))));
      body.appendChild(h('ul.wg-try', rows.map(r => h('li', { class: r.done ? 'is-done' : null, dataset: { try: r.id }, title: r.how },
        h('span.wg-try__c', { 'aria-hidden': 'true' }, r.done ? icon('check', { size: 11 }) : null),
        h('span.wg-try__x', h('span.wg-try__l', { text: r.label }), r.done ? h('span.sr', { text: ' (done)' }) : h('small', { text: r.how }))))));
      if (done) body.appendChild(h('button.btn.btn--sm.btn--block', { type: 'button', style: { marginTop: 'var(--sp-3)' }, onclick: () => { TRY.setHidden(true); bus.emit('widgets:tryit-hide'); } }, 'Hide this card'));
    }
    return { nodes: [body], paint, offs: [bus.on('tryit:change', () => paint())] };
  };

  return { due, timetable, focus, screentime, habits, worldClock, photos, quote, tryit };
}
