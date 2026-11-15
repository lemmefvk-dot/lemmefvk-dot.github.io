/* ============================================================
   seasons-pane.js — the rest of Settings › Celebrations: trying a
   season for a minute, autumn, Lunar New Year, St Patrick's Day,
   Pi Day, Earth Day, summer, back to school and first snow.

   js/apps/celebrate-pane.js calls more(kit, out, block, now) with
   its own `block` (a master switch, its parts dimmed while it is
   off) and the list it is filling; this adds to both. The engines
   are js/core/season.js (dates, switches, the trial), js/core/
   seasonkit.js (the lists and scores), js/core/firstsnow.js, and
   js/shell/seasons-more.js (what is drawn, and the dialogs the
   buttons here open through bus 'seasons:open').
   ============================================================ */
import * as SEASON from '../core/season.js';
import * as KIT from '../core/seasonkit.js';
import * as SNOW from '../core/firstsnow.js';
import { t } from '../core/i18n.js';

const MONTHS = [t('January'), t('February'), t('March'), t('April'), t('May'), t('June'), t('July'), t('August'), t('September'), t('October'), t('November'), t('December')];
const NAME = { spooky: t('Spooky Season'), winter: t('Winter') };
const WHEN = {
  spooky: t('October 24 – November 1'), winter: t('December 1 – January 1'), valentine: t('February 1–14'), spring: t('March and April'),
  autumn: t('November 2–30'), lunar: t('New Year’s Eve to the Lantern Festival'), stpatrick: t('March 10–17'), piday: t('March 14'),
  earth: t('April 20–22'), summer: t('June 1 – August 14'), school: t('August 15 – September 14'), firstsnow: t('the day it snows near you'),
};

export function more(kit, out, block, now) {
  const { api, caption, group, row, srow, note, btn, prefSwitch, pref, setPref, setLive, repaint } = kit;
  const { h, icon, bus, store } = api;
  const open = which => () => bus.emit('seasons:open', which);
  const extra = (...rows) => rows.filter(Boolean);

  /* ---- try a season for a minute (first in the pane) ---- */
  const trying = SEASON.trying();
  const tryRows = SEASON.PREVIEWABLE.map(id => {
    const on = trying?.id === id;
    return row('eye', NAME[id] || SEASON.SEASONS[id].name, WHEN[id],
      on ? btn('x', t('Stop'), () => { SEASON.stopTrying(); repaint(); }, '.btn--ghost') : null,
      btn('play', on ? t('Another minute') : t('Try it for a minute'), () => { SEASON.tryFor(id); repaint(); }));
  });
  tryRows.forEach((r, i) => { r.dataset.fk = `try-${SEASON.PREVIEWABLE[i]}`; });
  out.unshift(
    caption(t('Try a season')),
    group(...tryRows),
    note(t('One minute, on this tab only, whatever the date. It claims no show, spends no card and keeps nothing; a pill at the bottom of the screen counts it down and ends it early.'), 'eye'));

  /* ---- autumn ---- */
  block('autumn', t('Autumn'), ['autumnLeaves', 'autumnGratitude'], extra(
    row('heart', t('Your gratitude list'), t('{v} on this device.', { v: KIT.gratitude().length }), btn('plus', t('Open the list'), open('gratitude')))));

  /* ---- Lunar New Year ---- */
  const lny = SEASON.lunarNewYear(now.getFullYear());
  const lnyNext = lny && new Date(now.getFullYear(), lny[0] - 1, lny[1] + 14) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
    ? new Date(now.getFullYear(), lny[0] - 1, lny[1])
    : (SEASON.lunarNewYear(now.getFullYear() + 1) ? new Date(now.getFullYear() + 1, SEASON.lunarNewYear(now.getFullYear() + 1)[0] - 1, SEASON.lunarNewYear(now.getFullYear() + 1)[1]) : null);
  block('lunar', t('Lunar New Year'), ['lunarLanterns'], extra(
    lnyNext ? h('div.st-note', icon('calendar'), h('small', { dataset: { fk: 'lny-next' }, text: t('Lunar New Year’s Day: {v} {v2}, {v3}. The season starts the evening before.', { v: MONTHS[lnyNext.getMonth()], v2: lnyNext.getDate(), v3: lnyNext.getFullYear() }) })) : null));

  /* ---- St Patrick's Day ---- */
  const found = KIT.cloversFound(now.getFullYear()).length;
  block('stpatrick', t('St Patrick’s Day'), ['cloverHunt'], extra(
    SEASON.inSeason('stpatrick', now) ? h('div.st-note', icon('search'), h('small', { dataset: { fk: 'clover-count' }, text: t('Found this year: {found} of {CLOVERS}.', { found, CLOVERS: KIT.CLOVERS }) })) : null));

  /* ---- Pi Day ---- */
  block('piday', t('Pi Day'), ['piChallenge'], extra(
    row('calculator', t('The challenge'), KIT.piBest() ? t('Your best: {v} digits of π.', { v: KIT.piBest() }) : t('Type the digits of π you know, then try five circle puzzles.'), btn('play', t('Open'), open('pi')))));

  /* ---- Earth Day ---- */
  block('earth', t('Earth Day'), ['earthSeeds']);

  /* ---- summer ---- */
  const date = h('input', {
    type: 'date', min: '2000-01-01', max: '2999-12-31', value: /^\d{4}-\d{2}-\d{2}$/.test(String(pref('summerBreak', '') || '')) ? pref('summerBreak', '') : '',
    'aria-label': t('First day of the holidays'), dataset: { fk: 'summer-break' },
    onchange: e => { setPref('summerBreak', e.target.value || ''); repaint(); },
  });
  block('summer', t('Summer'), ['summerSparkle', 'summerCountdown'], extra(
    srow('summer.break', date, btn('rotate-ccw', t('Clear'), () => { setPref('summerBreak', ''); repaint(); }, '.btn--ghost'))));

  /* ---- back to school ---- */
  block('school', t('Back to school'), ['schoolKit'], extra(
    row('check', t('The planner kit'), t('{v} of {length} steps done this year.', { v: KIT.kitDone(now.getFullYear()).length, length: KIT.KIT.length }), btn('play', t('Open the kit'), open('kit')))));

  /* ---- first snow where you live ---- */
  const say = h('small', { dataset: { fk: 'snow-status' }, role: 'status' });
  const live = () => {
    const s = SNOW.status();
    say.textContent = s.say;
  };
  live();
  const place = SNOW.place();
  const src = SNOW.placeSource();
  const askBtn = btn('map-pin', t('Use my location'), async () => {
    askBtn.disabled = true;
    try { await SNOW.askLocation(); await SNOW.check({ force: true }); } catch (e) { say.textContent = e.message; askBtn.disabled = false; return; }
    repaint();
  });
  askBtn.dataset.fk = 'snow-locate';
  const on = pref('firstsnowTheme') === true;
  out.push(
    caption(t('First snow where you live')),
    group(
      srow('firstsnowTheme', prefSwitch('firstsnowTheme', v => { if (v) SNOW.check({ force: true }).then(() => repaint(), () => {}); repaint(); }),
        h('span.badge' + (SEASON.isFirstSnow(now) && on ? '.badge--accent' : ''), { text: SEASON.isFirstSnow(now) ? (on ? t('Snowing') : t('Off')) : on ? t('Watching') : t('Off') })),
      on ? [
        row('map-pin', t('Where'), place
          ? `${place.name}${src === 'weather' ? ' — the place Weather has' : ' — your location, kept to about 11 km'}.`
          : t('No place yet. Pick one in Weather, or let this browser share your location (it asks first).'),
        askBtn,
        src === 'location' ? btn('trash', t('Forget it'), () => { SNOW.forgetLocation(); repaint(); }, '.btn--ghost') : null,
        btn('cloud-sun', t('Weather'), () => api.openApp('weather'), '.btn--ghost')),
        h('div.set-row', h('div.set-row__ico', icon('info')), h('div.set-row__t', h('b', { text: t('Right now') }), say),
          h('div.set-row__c', btn('refresh', t('Check now'), () => { SNOW.check({ force: true }).finally(() => { live(); }); }))),
        srow('firstsnowFlakes', prefSwitch('firstsnowFlakes')),
      ] : null),
    note(t('Nothing is asked or sent until you turn this on and give it a place. Then only that place, rounded, goes to Open-Meteo (the same service Weather uses), a few times a day while StaticOS is open. If it is closed while it snows, the day is missed.'), 'lock'));

  /* the snow line and the trial's pill change on their own */
  setLive?.(() => live());
}

export default { more };
