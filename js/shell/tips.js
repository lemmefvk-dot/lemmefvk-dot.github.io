/* ============================================================
   tips.js — one short tip about a real StaticOS feature, at most once a day.

   A small card (lower right, above the dock) once the desktop has settled:
     Show me     opens the app, setting or panel the tip is about
     Next tip    another one right now (it counts as seen too)
     ✕ / Esc     hides it until tomorrow
     Don't show tips   a switch; Settings › Desktop › Startup turns it back on
   (prefs.tips). The tips are in tips.data.js, 70-odd, each with the code
   that makes it true; shortcuts in them are read from js/core/keymap.js.

   A tip never competes with anything else at start-up. The order is:
   first-run setup, the tour, then the video card and What's New, and a
   tip last — and never in the same load as setup, the tour or the What's
   New sheet. So this waits until nothing is covering the desktop (the
   tour, lock and boot screens all count), no card or sheet is up, and
   the What's New check has answered; if setup or the tour ran this load,
   or the sheet appeared, today's tip is simply skipped.

   session.tips = { day: 'YYYY-MM-DD', seen: [ids] }
     day   the last day a tip was shown (local time)
     seen  tips shown since the list last ran out: none repeats until
           every one has been seen
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { covered } from '../core/cover.js';
import { hasIcon } from '../core/icons.js';
import { TIPS } from './tips.data.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-tips-css')) {
  const l = document.createElement('link');
  l.id = 'feat-tips-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-tips.css';
  document.head.appendChild(l);
}

const KEY = 'session.tips';
const PREF = 'prefs.tips';
const SETTLE = 8000;           /* after the desktop is up, before the first look */
const WHATSNEW_WAIT = 20000;   /* longest to wait for the What's New check to answer */
const WAIT_MAX = 10 * 60e3;

const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Tips whose text can be written now (a shortcut row that is gone drops its tip). */
export function usableTips() {
  const out = [];
  for (const t of TIPS) {
    try { const text = t.text(); if (text) out.push({ ...t, now: text }); } catch (e) { /* a row it needs is gone */ }
  }
  return out;
}

/** What "Show me" does for a tip. */
export function showMe(tip) {
  const [kind, a, ...rest] = tip.show;
  if (kind === 'app') api.openApp(a, rest[0] || undefined);
  else if (kind === 'settings') api.openApp('settings', { section: a });
  else if (kind === 'bus') bus.emit(a, ...rest);
}

export function mountTips(host) {
  const { h, icon } = api;
  let card = null, timer = 0, dead = false, bootAt = 0, skipLoad = false, shownThisLoad = false;
  const state = () => { const s = store.get(KEY); return s && typeof s === 'object' ? { day: s.day || '', seen: Array.isArray(s.seen) ? s.seen : [] } : { day: '', seen: [] }; };
  const on = () => store.get(PREF, true) !== false;

  /** Pick one not yet seen (everything seen: start over, but not on the one just shown). */
  function pick(current) {
    const all = usableTips();
    const st = state();
    let pool = all.filter(t => !st.seen.includes(t.id) && t.id !== current);
    if (!pool.length) { st.seen = []; pool = all.filter(t => t.id !== current); }
    const t = pool[Math.floor(Math.random() * pool.length)];
    if (!t) return null;
    st.seen = [...st.seen.filter(id => all.some(x => x.id === id)), t.id];
    store.set(KEY, { day: dayOf(), seen: st.seen });
    return t;
  }

  function hide() {
    if (!card) return;
    const el = card;
    card = null;
    if (el.contains(document.activeElement)) bus.emit('a11y:refocus');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  }

  function paint(tip) {
    const ico = icon(hasIcon('sparkles') ? 'sparkles' : 'info');
    const text = h('p.tipc__t', { id: 'tipc-text', text: tip.now });
    const never = h('button.switch', {
      type: 'button', role: 'switch', 'aria-checked': 'false', id: 'tipc-never', 'aria-labelledby': 'tipc-never-l',
      onclick: () => {
        never.setAttribute('aria-checked', 'true');
        never.classList.add('is-on');
        store.set(PREF, false);
        setTimeout(hide, 700);
      },
    });
    const me = h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => { hide(); showMe(tip); } },
      icon('arrow-right'), 'Show me');
    const nx = h('button.btn.btn--sm', { type: 'button', onclick: () => { const t = pick(tip.id); if (t) { tip = t; text.textContent = t.now; if (card) card.dataset.tip = t.id; } } }, 'Next tip');
    return h('div.tipc', {
      role: 'region', 'aria-label': 'Tip of the day', dataset: { tip: tip.id },
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); } },
    },
      h('div.tipc__head', h('span.tipc__ico', ico), h('span.tipc__k', { text: 'Tip of the day' }), h('div.grow'),
        h('button.tipc__x', { type: 'button', 'aria-label': 'Close tip', onclick: hide }, icon('x'))),
      text,
      h('div.tipc__acts', me, nx),
      h('label.tipc__never', never, h('span#tipc-never-l', { text: 'Don’t show tips' })));
  }

  function show() {
    if (card || dead) return;
    const tip = pick(null);
    if (!tip) return;
    shownThisLoad = true;
    card = paint(tip);
    host.appendChild(card);
  }

  const busy = () => covered()
    || !!document.querySelector('.lock, .ob, .tour, .wn-sheet, .ivid, .bp, .bootos, .boot, .ssaver, .csheet')
    || /^#(game|arcade|app|creation)=/.test(location.hash || '');

  function ready() {
    if (!on() || skipLoad || shownThisLoad) return false;
    if (state().day === dayOf()) return false;
    if (busy()) return false;
    /* What's New decides on its own whether it shows; wait for the answer */
    const wn = window.Static && window.Static.whatsNew;
    if (wn === undefined && Date.now() - bootAt < WHATSNEW_WAIT) return false;
    if (wn === 'shown') { skipLoad = true; return false; }
    return true;
  }

  function look() {
    timer = 0;
    if (dead || !on() || skipLoad || shownThisLoad) return;
    if (state().day === dayOf()) return;
    if (ready()) { show(); return; }
    if (Date.now() - bootAt < WAIT_MAX && !skipLoad) timer = setTimeout(look, 1000);
  }

  const offs = [
    /* setup, the tour or the sheet in this load: no tip until the next one */
    bus.on('onboarding:done', () => { skipLoad = true; }),
    bus.on('tour:open', () => { skipLoad = true; }),
    bus.on('boot:ready', () => {
      bootAt = Date.now();
      if (document.querySelector('.ob')) skipLoad = true;
      timer = setTimeout(look, SETTLE);
    }),
    store.sub(PREF, v => { if (v === false) { clearTimeout(timer); timer = 0; } }),
  ];
  return () => {
    dead = true;
    clearTimeout(timer);
    offs.forEach(off => { try { off?.(); } catch (e) {} });
    card?.remove();
    card = null;
  };
}

export default mountTips;
