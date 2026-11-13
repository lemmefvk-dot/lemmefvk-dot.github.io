/* ============================================================
   life/habits.js — the Habits tab. The rules (what counts toward a
   streak, local calendar days) are in js/core/habits.js and are also
   written out under "How streaks are counted" in the tab itself.

   A reminder is off until you turn it on for that habit. Turning it on
   adds ordinary reminders to Automations › Reminders (js/core/
   automations.js), so they are shown, snoozed and removed there like
   any other, and only go off while StaticOS is open. There are no
   "you missed it" messages anywhere.
   ============================================================ */
import * as H from '../core/habits.js';
import { read, write, uid } from './data.js';

const longDay = key => new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), 12)
  .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SPAN = 14;

export function mountHabits(el, ctx) {
  const { h, icon, confirm } = ctx.api;
  const S = { editing: null, draftDays: [], name: '', error: '', remindOpen: null, focus: '', dead: false };
  let today = H.dayKey();

  const habits = () => (read().habits || []).map(H.normHabit).filter(Boolean);
  const save = list => write('habits', list);
  const replace = (id, fn) => save(habits().map(x => (x.id === id ? fn(x) : x)));

  /* ---------------- reminders (through Automations) ---------------- */
  async function applyReminder(habit, time) {
    const A = await import('../core/automations.js');
    for (const id of habit.remind ? habit.remind.ids : []) A.removeReminder(id);
    if (!time) return null;
    const plan = !habit.days ? [{ repeat: 'daily', date: today }]
      : habit.days.join() === '1,2,3,4,5' ? [{ repeat: 'weekdays', date: today }]
        : habit.days.map(d => {
          let key = today;
          while (H.weekday(key) !== d) key = H.shiftDay(key, 1);
          return { repeat: 'weekly', date: key };
        });
    const ids = [];
    for (const p of plan) {
      const r = A.addReminder({ text: `Habit: ${habit.name}`, time, repeat: p.repeat, date: p.date, enabled: true });
      if (!r.ok) { for (const id of ids) A.removeReminder(id); return { error: r.issues[0].text }; }
      ids.push(r.reminder.id);
    }
    return { time, ids };
  }

  async function setReminder(id, time) {
    const habit = habits().find(x => x.id === id);
    if (!habit) return;
    const res = await applyReminder(habit, time);
    if (S.dead) return;
    if (res && res.error) { S.error = res.error; render(); return; }
    replace(id, x => ({ ...x, remind: res }));
    S.remindOpen = time ? id : null;
    S.error = '';
    render();
  }

  /* ---------------- actions ---------------- */
  async function submit(name, days) {
    name = String(name || '').trim();
    if (!name) { S.error = 'Give the habit a name.'; render(); return; }
    const list = habits();
    if (S.editing) {
      const cur = list.find(x => x.id === S.editing);
      const next = H.normHabit({ ...cur, name, days });
      save(list.map(x => (x.id === S.editing ? next : x)));
      /* a reminder follows the new name and days */
      if (cur.remind) await setReminder(cur.id, cur.remind.time);
      S.editing = null;
    } else {
      if (list.length >= H.MAX_HABITS) { S.error = `You can keep up to ${H.MAX_HABITS} habits.`; render(); return; }
      save([...list, H.normHabit({ id: uid('h'), name, days, created: today, done: [] })]);
    }
    S.draftDays = [];
    S.name = '';
    S.error = '';
    render();
  }

  async function remove(habit) {
    const yes = await confirm({ title: `Delete “${habit.name}”?`, message: 'Its ticks and streak go with it. This can’t be undone.', ok: 'Delete', danger: true });
    if (!yes || S.dead) return;
    if (habit.remind) await applyReminder(habit, null);
    save(habits().filter(x => x.id !== habit.id));
    render();
  }

  const tick = (id, key) => { replace(id, x => H.toggleDay(x, key, today)); S.focus = `[data-habit="${id}"] [data-day="${key}"]`; render(); };

  /* ---------------- drawing ---------------- */
  function dayButton(habit, d) {
    const label = `${longDay(d.key)}${d.scheduled ? '' : ', not scheduled'}: ${d.done ? 'done' : 'not done'}`;
    const date = new Date(+d.key.slice(0, 4), +d.key.slice(5, 7) - 1, +d.key.slice(8, 10), 12);
    return h('button.life-day', {
      type: 'button', 'aria-pressed': d.done ? 'true' : 'false', 'aria-label': label, 'data-day': d.key, title: label,
      class: [d.done ? 'is-done' : '', d.scheduled ? '' : 'is-off', d.key === today ? 'is-today' : ''].filter(Boolean).join(' '),
      onclick: () => tick(habit.id, d.key),
    }, h('small', { text: H.DAY_NAMES[date.getDay()].slice(0, 2) }), h('b', { text: String(date.getDate()) }));
  }

  function card(habit) {
    const st = H.streaks(habit, today);
    const reminder = habit.remind;
    const rem = S.remindOpen === habit.id;
    return h('article.life-card.life-habit', { 'data-habit': habit.id },
      h('div.life-habit__top',
        h('div.life-habit__name', h('b', { text: habit.name }), h('small', { text: H.describeDays(habit) })),
        h('div.life-habit__streak', { 'aria-label': `Current streak ${plural(st.current, 'day')}, best ${plural(st.best, 'day')}` },
          h('b.life-streak', { text: String(st.current) }),
          h('small', { text: st.current === 1 ? 'day streak' : 'day streak' }),
          h('small.life-best', { text: `Best ${st.best}` })),
        h('div.life-habit__act',
          h('button.ibtn', { type: 'button', 'aria-label': `Remind me about ${habit.name}`, 'aria-pressed': reminder ? 'true' : 'false', class: reminder ? 'is-on' : '',
            title: reminder ? `Reminder at ${reminder.time}` : 'Reminder (off)', onclick: () => { S.remindOpen = rem ? null : habit.id; render(); } }, icon('bell')),
          h('button.ibtn', { type: 'button', 'aria-label': `Edit ${habit.name}`, onclick: () => { S.editing = habit.id; S.draftDays = habit.days ? [...habit.days] : []; S.name = habit.name; S.error = ''; S.focus = '.life-form input[type=text]'; render(); } }, icon('edit-3')),
          h('button.ibtn', { type: 'button', 'aria-label': `Delete ${habit.name}`, onclick: () => remove(habit) }, icon('trash')))),
      h('div.life-days', { role: 'group', 'aria-label': `Last ${SPAN} days of ${habit.name}` }, H.week(habit, today, SPAN).map(d => dayButton(habit, d))),
      st.extras ? h('small.life-note', { text: `${plural(st.extras, 'extra tick')} on days it isn’t scheduled; they don’t change the streak.` }) : null,
      rem ? reminderRow(habit) : null);
  }

  function reminderRow(habit) {
    const time = h('input', { type: 'time', value: habit.remind ? habit.remind.time : '09:00', 'aria-label': `Reminder time for ${habit.name}` });
    return h('div.life-remind',
      h('span', { text: habit.remind ? 'Reminding you at' : 'Remind me at' }), time,
      h('button.btn.btn--sm', { type: 'button', onclick: () => setReminder(habit.id, time.value || '09:00') }, h('span', { text: habit.remind ? 'Change' : 'Turn on' })),
      habit.remind ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => setReminder(habit.id, null) }, h('span', { text: 'Turn off' })) : null,
      h('small', { text: 'Shows up in Automations › Reminders, only while StaticOS is open.' }));
  }

  function form() {
    const cur = S.editing ? habits().find(x => x.id === S.editing) : null;
    const name = h('input', { type: 'text', maxlength: '60', placeholder: 'New habit, e.g. Read 10 pages', 'aria-label': 'Habit name', value: S.name,
      oninput: () => { S.name = name.value; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(name.value, [...S.draftDays].sort()); } } });
    const days = h('div.life-pick', { role: 'group', 'aria-label': 'Days of the week (none picked means every day)' },
      H.DAY_NAMES.map((n, i) => h('button', { type: 'button', 'aria-pressed': S.draftDays.includes(i) ? 'true' : 'false', 'aria-label': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i],
        class: S.draftDays.includes(i) ? 'is-on' : '', 'data-dow': String(i),
        onclick: () => { S.draftDays = S.draftDays.includes(i) ? S.draftDays.filter(x => x !== i) : [...S.draftDays, i]; S.focus = `[data-dow="${i}"]`; render(); } }, h('span', { text: n }))));
    return h('div.life-card.life-form',
      h('div.life-form__row', h('div.field', name),
        h('button.btn.btn--primary', { type: 'button', onclick: () => submit(name.value, [...S.draftDays].sort()) }, icon(cur ? 'check' : 'plus'), h('span', { text: cur ? 'Save' : 'Add habit' })),
        cur ? h('button.btn', { type: 'button', onclick: () => { S.editing = null; S.draftDays = []; S.name = ''; S.error = ''; render(); } }, h('span', { text: 'Cancel' })) : null),
      h('div.life-form__row', h('small', { text: 'Repeat on' }), days, h('small', { text: S.draftDays.length ? H.describeDays({ days: [...S.draftDays].sort() }) : 'Every day' })),
      h('p.life-err', { role: 'alert', text: S.error }));
  }

  function render() {
    if (S.dead) return;
    const list = habits();
    el.replaceChildren(
      h('div.life-head', h('div', h('h2', { text: 'Habits' }), h('small', { text: `Today is ${longDay(today)}` }))),
      form(),
      list.length
        ? h('div.life-list', list.map(card))
        : h('div.empty', icon('repeat'), h('b', { text: 'No habits yet' }), h('small', { text: 'Add one above. Pick weekdays, or leave them all off for every day.' })),
      h('details.life-how',
        h('summary', { text: 'How streaks are counted' }),
        h('ul',
          h('li', { text: 'Your streak is how many scheduled days in a row, up to today, you ticked.' }),
          h('li', { text: 'A scheduled day that passed without a tick ends the streak.' }),
          h('li', { text: 'Today doesn’t end it while it is still open: tick it before the day is over.' }),
          h('li', { text: 'A day the habit isn’t scheduled on is skipped: it neither adds to the streak nor breaks it.' }),
          h('li', { text: 'A tick on an unscheduled day is kept as an extra and doesn’t change the streak.' }),
          h('li', { text: 'Days are your computer’s calendar days, so clock changes and travel don’t break a streak.' }))));
    if (S.focus) { const f = el.querySelector(S.focus); S.focus = ''; if (f) f.focus(); }
  }

  /* the day changes under an open window: redraw so "today" moves */
  const check = () => { const k = H.dayKey(); if (k !== today) { today = k; render(); } };
  const iv = setInterval(check, 15000);
  const vis = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', vis);

  render();
  return () => { S.dead = true; clearInterval(iv); document.removeEventListener('visibilitychange', vis); };
}
