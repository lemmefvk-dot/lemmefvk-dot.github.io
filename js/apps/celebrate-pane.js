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
import { more } from './seasons-pane.js';
import { t, plural } from '../core/i18n.js';

const MONTHS = [t('January'), t('February'), t('March'), t('April'), t('May'), t('June'), t('July'), t('August'), t('September'), t('October'), t('November'), t('December')];
/* 2024 is a leap year: February offers a 29th */
const daysIn = m => (m ? new Date(2024, m, 0).getDate() : 31);

export function pane(kit) {
  const { api, caption, group, srow, note, prefSwitch, pref, repaint } = kit;
  const { h, icon, store } = api;
  const now = new Date();
  const out = [];
  /* a master switch, its parts dimmed while it is off, and where the season stands */
  const block = (id, title, parts, extra = []) => {
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
        srow(master, prefSwitch(master, () => repaint()), h('span.badge' + (live && on ? '.badge--accent' : ''), { text: live ? (on ? t('On now') : t('Off')) : t('Resting') })),
        ...parts.map(part), ...extra),
    );
  };

  /* ---- what is on, and when the next season starts ---- */
  {
    const sch = SEASON.schedule(now);
    const dm = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    const nx = sch.next.find(x => x.days > 0);
    const on = sch.now.filter(x => pref(SEASON.SEASONS[x.id].master) !== false);
    const parts = [];
    if (on.length) parts.push(t('On now: {list}.', { list: on.map(x => t('{name} until {date}', { name: x.name, date: dm(x.endsOn) })).join('; ') }));
    if (nx) parts.push(t('Next up: {name} starts on {date}, {when}.', { name: nx.name, date: dm(nx.start), when: nx.days === 1 ? t('tomorrow') : plural(nx.days, 'in {n} day', 'in {n} days') }));
    if (parts.length) out.push(h('div.st-note.st-next', { dataset: { next: nx ? nx.id : '' } }, icon('calendar'), h('small', { text: parts.join(' ') })));
  }

  /* ---- your birthday ---- */
  const have = SEASON.parseBirthday(pref('birthday', ''));
  let m = have ? have[0] : 0, d = have ? have[1] : 0;
  const mon = h('select.select', { 'aria-label': t('Birthday month'), onchange: e => { m = +e.target.value; if (d > daysIn(m)) d = 0; fillDays(); save(); } },
    h('option', { value: '0', text: t('Month') }),
    ...MONTHS.map((n, i) => h('option', { value: String(i + 1), text: n, selected: m === i + 1 })));
  const day = h('select.select', { 'aria-label': t('Birthday day'), onchange: e => { d = +e.target.value; save(); } });
  function fillDays() {
    day.replaceChildren(h('option', { value: '0', text: t('Day') }),
      ...Array.from({ length: daysIn(m) }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: d === i + 1 })));
    day.value = String(d);
  }
  fillDays();
  const status = h('small.bd-status', { 'aria-live': 'polite' });
  function paintStatus() {
    const b = SEASON.birthdayIn(new Date().getFullYear(), store.get('prefs.birthday', ''));
    status.textContent = !b ? t('No birthday set.')
      : SEASON.isBirthday(new Date()) ? t('Today is your birthday!')
        : t('Next: {v} {b}.', { v: MONTHS[b[0] - 1], b: b[1] });
  }
  function save() {
    /* nothing is saved until both are chosen */
    if (m && d) store.set('prefs.birthday', `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    else if (!m && !d) store.set('prefs.birthday', '');
    paintStatus();
  }
  paintStatus();
  const clear = h('button.btn.btn--sm', { type: 'button', 'aria-label': t('Forget my birthday'), onclick: () => { m = 0; d = 0; mon.value = '0'; fillDays(); save(); } }, icon('rotate-ccw'), h('span', { text: t('Forget it') }));

  const bOn = pref('birthdayTheme') !== false;
  const bpart = key => {
    const r = srow(key, prefSwitch(key));
    if (!bOn) { r.classList.add('is-dim'); r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; }); }
    return r;
  };
  out.push(
    caption(t('Your birthday')),
    group(
      srow('bd.date', mon, day, clear),
      srow('birthdayTheme', prefSwitch('birthdayTheme', () => repaint()),
        h('span.badge' + (SEASON.isBirthday(now) && bOn ? '.badge--accent' : ''), { text: SEASON.isBirthday(now) ? (bOn ? t('Today') : t('Off')) : t('Resting') })),
      bpart('birthdayConfetti'),
      bpart('birthdayCard')),
    h('div.st-note', icon('lock'), status, h('small', { text: t(' Stays on this device.') })));

  block('newyear', t('New Year’s'), ['newyearCountdown', 'newyearFireworks']);
  block('valentine', t('Valentine’s'), ['valentineHearts']);
  block('spring', t('Spring'), ['springBlossoms']);
  more(kit, out, block, now);

  const rm = document.body.classList.contains('reduce-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (rm) out.push(note(t('Reduce motion is on, so fireworks, confetti, hearts and blossoms show as still pictures instead of moving.'), 'activity'));
  return out.filter(Boolean);
}

export default { pane };
