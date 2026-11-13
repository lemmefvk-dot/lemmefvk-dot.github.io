/* ============================================================
   celebrate-pane.js — Settings › Celebrations.

   New Year's, your birthday, Valentine's and spring: each has a
   switch for the whole thing and one for each of its parts, dimmed
   while the whole is off, like Winter. The pane is always listed,
   because the birthday is yours to set on any day of the year.

   Your birthday: a month and a day, no year, in prefs.birthday as
   'MM-DD'. It is read here and by js/core/season.js and nowhere
   else — never sent to presence, friends or any live channel.

   pane(kit) -> nodes for Settings' pane column (the same kit
   winter-pane.js takes: api, caption, group, srow, note, prefSwitch,
   pref, repaint).
   ============================================================ */
import * as SEASON from '../core/season.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* 2024 is a leap year: February offers a 29th */
const daysIn = m => (m ? new Date(2024, m, 0).getDate() : 31);

export function pane(kit) {
  const { api, caption, group, srow, note, prefSwitch, pref, repaint } = kit;
  const { h, icon, store } = api;
  const now = new Date();
  const out = [];

  /* a master switch, its parts dimmed while it is off, and where the season stands */
  const block = (id, title, parts) => {
    const master = SEASON.SEASONS[id].master;
    const on = pref(master) !== false;
    const live = SEASON.inSeason(id, now);
    const part = key => {
      const r = srow(key, prefSwitch(key));
      if (!on) { r.classList.add('is-dim'); r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; }); }
      return r;
    };
    out.push(
      caption(title),
      group(
        srow(master, prefSwitch(master, () => repaint()), h('span.badge' + (live && on ? '.badge--accent' : ''), { text: live ? (on ? 'On now' : 'Off') : 'Resting' })),
        ...parts.map(part)),
    );
  };

  /* ---- your birthday ---- */
  const have = SEASON.parseBirthday(pref('birthday', ''));
  let m = have ? have[0] : 0, d = have ? have[1] : 0;
  const mon = h('select.select', { 'aria-label': 'Birthday month', onchange: e => { m = +e.target.value; if (d > daysIn(m)) d = 0; fillDays(); save(); } },
    h('option', { value: '0', text: 'Month' }),
    ...MONTHS.map((n, i) => h('option', { value: String(i + 1), text: n, selected: m === i + 1 })));
  const day = h('select.select', { 'aria-label': 'Birthday day', onchange: e => { d = +e.target.value; save(); } });
  function fillDays() {
    day.replaceChildren(h('option', { value: '0', text: 'Day' }),
      ...Array.from({ length: daysIn(m) }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: d === i + 1 })));
    day.value = String(d);
  }
  fillDays();
  const status = h('small.bd-status', { 'aria-live': 'polite' });
  function paintStatus() {
    const b = SEASON.birthdayIn(new Date().getFullYear(), store.get('prefs.birthday', ''));
    status.textContent = !b ? 'No birthday set.'
      : SEASON.isBirthday(new Date()) ? 'Today is your birthday!'
        : `Next: ${MONTHS[b[0] - 1]} ${b[1]}.`;
  }
  function save() {
    /* nothing is saved until both are chosen */
    if (m && d) store.set('prefs.birthday', `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    else if (!m && !d) store.set('prefs.birthday', '');
    paintStatus();
  }
  paintStatus();
  const clear = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Forget my birthday', onclick: () => { m = 0; d = 0; mon.value = '0'; fillDays(); save(); } }, icon('rotate-ccw'), h('span', { text: 'Forget it' }));

  const bOn = pref('birthdayTheme') !== false;
  const bpart = key => {
    const r = srow(key, prefSwitch(key));
    if (!bOn) { r.classList.add('is-dim'); r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; }); }
    return r;
  };
  out.push(
    caption('Your birthday'),
    group(
      srow('bd.date', mon, day, clear),
      srow('birthdayTheme', prefSwitch('birthdayTheme', () => repaint()),
        h('span.badge' + (SEASON.isBirthday(now) && bOn ? '.badge--accent' : ''), { text: SEASON.isBirthday(now) ? (bOn ? 'Today' : 'Off') : 'Resting' })),
      bpart('birthdayConfetti'),
      bpart('birthdayCard')),
    h('div.st-note', icon('lock'), status, h('small', { text: ' Stays on this device.' })));

  block('newyear', 'New Year’s', ['newyearCountdown', 'newyearFireworks']);
  block('valentine', 'Valentine’s', ['valentineHearts']);
  block('spring', 'Spring', ['springBlossoms']);

  const rm = document.body.classList.contains('reduce-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (rm) out.push(note('Reduce motion is on, so fireworks, confetti, hearts and blossoms show as still pictures instead of moving.', 'activity'));
  return out.filter(Boolean);
}

export default { pane };
