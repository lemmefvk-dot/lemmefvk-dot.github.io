/* ============================================================
   recap.js — every Sunday, a card with your week.

   On Sunday (local), or the first time StaticOS is opened after
   one, a card above the dock shows that Monday-to-Sunday week as
   this device measured it (js/core/recap.js): total time, the top
   three apps and games with their real time, focus sessions, the
   things you made and the badges you earned. A part with nothing
   measured is left out — never a zero, never a guess — and a week
   with nothing at all gets no card.

   Once per week: portal.recap.shown holds the Sunday last shown.
   prefs.weeklyRecap (default on) turns the card off; Settings ›
   Screen Time has the switch and "Show the last one" (bus
   'recap:show'), which shows the latest week whatever it holds.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { covered } from '../core/cover.js';
import { hasIcon } from '../core/icons.js';
import * as RECAP from '../core/recap.js';
import { fmtDur } from '../core/screentime.js';
import { appTile } from '../core/appart.js';

const PREF = 'prefs.weeklyRecap';
const SHOWN = 'portal.recap';
const RECHECK_MS = 10 * 60e3;      /* an empty week is looked at again this often */

if (typeof document !== 'undefined' && !document.getElementById('feat-recap-css')) {
  document.head.appendChild(Object.assign(document.createElement('link'), { id: 'feat-recap-css', rel: 'stylesheet', href: 'css/feat-recap.css' }));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function mountRecap(host) {
  const { h, icon, getApp } = api;
  let card = null;
  let busy = false;
  let lastLook = { sunday: '', at: 0 };
  let dead = false;

  const ready = () => store.get('session.onboarded', false) && !covered() && !document.querySelector('.lock');

  const glyph = (app, ic) => appTile(app || { g1: 'var(--accent-soft)', g2: 'var(--accent)' }, {
    gs: '26px', attrs: { 'aria-hidden': 'true' },
    icon: ic && hasIcon(ic) ? ic : (app && app.icon) || 'apps',
  });

  const item = (g, name, sec, data) => h('li.recap__row', { dataset: data },
    g, h('span.recap__name', { text: name }), h('b.recap__v', { text: fmtDur(sec) }));

  function hide() {
    if (!card) return;
    const el = card;
    card = null;
    if (el.contains(document.activeElement)) bus.emit('a11y:refocus');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 240);
  }

  function show(r) {
    hide();
    const end = new Date(r.to - 1), start = new Date(r.from);
    const parts = [];
    if (r.time) {
      const t = r.time;
      parts.push(h('section.recap__part', { dataset: { part: 'time' } },
        h('div.recap__big', h('b', { text: fmtDur(t.total) }), h('small', { text: `in StaticOS, on ${plural(t.days, 'day')}` }))));
      if (t.apps.length) {
        parts.push(h('section.recap__part', { dataset: { part: 'apps' } },
          h('div.recap__k', { text: 'Top apps' }),
          h('ol.recap__list', t.apps.map(a => {
            const app = getApp(a.id);
            return item(glyph(app), app ? app.name : a.id, a.sec, { app: a.id, sec: String(a.sec) });
          }))));
      }
      if (t.games.length) {
        parts.push(h('section.recap__part', { dataset: { part: 'games' } },
          h('div.recap__k', { text: 'Top games' }),
          h('ol.recap__list', t.games.map(g => item(glyph(getApp(g.kind === 'arcade' ? 'arcade' : 'aether-games'), g.icon), g.title, g.sec, { game: g.key, sec: String(g.sec) })))));
      }
    }
    if (r.focus) {
      parts.push(h('section.recap__part.recap__line', { dataset: { part: 'focus' } },
        icon('clock'), h('span', { text: `${plural(r.focus.n, 'focus session')} · ${r.focus.min} min of focus` })));
    }
    if (r.made) {
      const bits = [];
      const f = r.made.files;
      if (f.Pictures) bits.push(`${plural(f.Pictures, 'picture')}`);
      if (f.Videos) bits.push(`${plural(f.Videos, 'video')}`);
      if (f.Music) bits.push(`${plural(f.Music, 'song or sound', 'songs or sounds')}`);
      const filesText = bits.length ? `${bits.join(', ')} saved` : '';
      const gamesText = r.made.games ? `${plural(r.made.games, 'game')} made in Forge or Studio` : '';
      parts.push(h('section.recap__part.recap__line', { dataset: { part: 'made' } },
        icon('sparkles'), h('span', { text: [filesText, gamesText].filter(Boolean).join(' · ') })));
    }
    if (r.badges) {
      parts.push(h('section.recap__part', { dataset: { part: 'badges' } },
        h('div.recap__k', { text: r.badges.length === 1 ? 'Badge earned' : 'Badges earned' }),
        h('div.recap__badges', r.badges.map(b => h('span.chip.recap__badge', icon(hasIcon(b.icon) ? b.icon : 'star'), h('span', { text: b.name }))))));
    }
    if (r.empty) {
      parts.push(h('p.recap__none', { dataset: { part: 'none' }, text: 'Nothing was measured on this device that week. Screen Time counts while StaticOS is open and in use.' }));
    }

    card = h('div.recap', {
      role: 'dialog', 'aria-labelledby': 'recap-title', dataset: { sunday: r.sunday },
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); } },
    },
      h('button.recap__x', { type: 'button', 'aria-label': 'Close', onclick: hide }, icon('x')),
      h('div.recap__app', { text: 'Weekly recap' }),
      h('b.recap__t#recap-title', { text: 'Your week' }),
      h('small.recap__when', { text: `${dayFmt.format(start)} – ${dayFmt.format(end)}` }),
      h('div.recap__body', parts),
      h('div.recap__acts',
        h('button.btn.btn--primary.btn--sm.recap__see', { type: 'button', onclick: () => { hide(); api.openApp('settings', { section: 'screentime' }); } }, icon('bar-chart'), 'See Screen Time'),
        h('button.btn.btn--sm.recap__close', { type: 'button', onclick: hide }, 'Close')),
      h('button.recap__never', { type: 'button', onclick: () => { store.set(PREF, false); hide(); } }, 'Don’t show weekly recaps'));
    host.appendChild(card);
    bus.emit('recap:shown', { sunday: r.sunday, empty: r.empty });
  }

  /** Is a recap due, and does its week hold anything? Then show it, once. */
  async function check({ force = false } = {}) {
    if (dead || busy || (card && !force)) return;
    if (!force && store.get(PREF, true) === false) return;
    const sunday = RECAP.lastSunday(new Date());
    if (!force) {
      if ((store.get(SHOWN) || {}).shown === sunday) return;
      if (!ready()) return;
      if (lastLook.sunday === sunday && Date.now() - lastLook.at < RECHECK_MS) return;
    }
    busy = true;
    let r = null;
    try { r = await RECAP.week(sunday); } catch (e) { r = null; } finally { busy = false; }
    if (!r || dead) return;
    lastLook = { sunday, at: Date.now() };
    if (r.empty && !force) return;
    if (!force) store.set(SHOWN, { shown: sunday });
    show(r);
  }

  let n = 0;
  const offs = [
    bus.on('boot:ready', () => setTimeout(() => check(), 1500)),
    /* a tab left open into Sunday, or a lock screen that has just gone */
    bus.on('tick:5s', () => { if (++n % 6 === 0) check(); }),
    bus.on('recap:show', () => check({ force: true })),
    store.sub(PREF, v => { if (v === false) hide(); }),
  ];
  return () => {
    dead = true;
    offs.forEach(f => { try { f?.(); } catch (e) {} });
    card?.remove();
    card = null;
  };
}

export default mountRecap;
