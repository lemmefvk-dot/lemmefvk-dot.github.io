/* ============================================================
   whatsnew-sheet.js — "What's new" once, after an update.

   When the build this browser boots with (build.json, stamped by
   tools/bump.mjs on every deploy) is not the one it booted with last
   time, and data/changelog.json has releases newer than the newest
   this person has already been shown, a sheet lists them — once.
   It closes with Got it, the ×, Esc or a click outside, and
   "Don't show this after updates" turns it off for good
   (prefs.whatsNewAfterUpdate; Settings › About turns it back on).
   The full history is always in the What's New app.

   A first visit shows nothing: there is nothing to be new *since*,
   and onboarding is the better welcome. It only records where this
   person starts from. Someone who used StaticOS before this sheet
   existed starts from the version the old "Updated to…" notice
   recorded (session.seenVersion), so they still see this release.

   session.whatsNew = { build, seen }
     build  the build id this browser booted with last time
     seen   the newest release version this person has been shown
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { store } from '../core/store.js';
import { covered } from '../core/cover.js';

const KEY = 'session.whatsNew';
const PREF = 'prefs.whatsNewAfterUpdate';

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('feat-whatsnew-css')) return;
  const l = document.createElement('link');
  l.id = 'feat-whatsnew-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-whatsnew.css';
  document.head.appendChild(l);
}

/** '4.10' > '4.9' > '4' — numeric, part by part. */
export function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const getJSON = url => fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
  .then(r => (r.ok ? r.json() : null)).catch(() => null);

/**
 * Called once the desktop is up. Returns what it decided, for tests and
 * the console: 'no-build' | 'same-build' | 'first-visit' | 'nothing-new' |
 * 'opted-out' | 'shown'.
 */
export async function checkAfterUpdate(host) {
  const stamp = await getJSON('build.json');
  if (!stamp || !stamp.build) return 'no-build';           /* unstamped (a local copy) or offline */
  const rec = store.get(KEY) || {};
  /* the terminal and older code read the running version from here */
  if (stamp.version) store.set('session.seenVersion', String(stamp.version));
  if (rec.build === stamp.build) return 'same-build';

  const log = await getJSON('data/changelog.json');
  const releases = Array.isArray(log) ? log.filter(r => r && r.version) : [];
  const newest = releases[0]?.version || stamp.version || null;
  const seen = rec.seen || (rec.build ? null : legacySeen) || null;
  if (!seen) {
    store.set(KEY, { build: stamp.build, seen: newest });
    return 'first-visit';
  }
  const fresh = releases.filter(r => cmpVersion(r.version, seen) > 0);
  if (!fresh.length) {
    store.set(KEY, { build: stamp.build, seen });
    return 'nothing-new';
  }
  /* shown or not, these releases count as seen: once means once */
  store.set(KEY, { build: stamp.build, seen: newest });
  if (store.get(PREF, true) === false) return 'opted-out';
  await whenUncovered();
  showSheet(host, fresh);
  return 'shown';
}

/* read before anything at boot can overwrite it */
const legacySeen = (() => { try { return store.get('session.seenVersion', null); } catch (e) { return null; } })();

/* the lock screen or the boot manager may be up — wait for the desktop */
function whenUncovered() {
  return new Promise(res => {
    if (!covered()) { setTimeout(res, 700); return; }
    const t = setInterval(() => { if (!covered()) { clearInterval(t); setTimeout(res, 700); } }, 500);
  });
}

let open = null;

/** Show the sheet for these releases (newest first). */
export function showSheet(host, releases) {
  if (!releases?.length) return null;
  ensureCss();
  open?.close();
  const { h, icon } = api;
  const top = releases[0];
  const older = releases.slice(1);
  const prevFocus = document.activeElement;

  const close = () => {
    if (!wrap.isConnected) return;
    window.removeEventListener('keydown', onKey, true);
    wrap.classList.add('is-leaving');
    const gone = () => wrap.remove();
    if (document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) gone();
    else setTimeout(gone, 180);
    if (open?.wrap === wrap) open = null;
    try { prevFocus?.focus?.({ preventScroll: true }); } catch (e) { /* gone */ }
  };

  const openApp = (id, opts) => { close(); api.openApp(id, opts || undefined); };

  const item = x => {
    if (typeof x === 'string') {
      return h('li.wn-card', h('span.wn-card__ico', icon('check')), h('div.wn-card__t', h('p', { text: x })));
    }
    const app = x.app && api.getApp(x.app);
    return h('li.wn-card',
      h('span.wn-card__ico', icon(x.icon || 'sparkles')),
      h('div.wn-card__t',
        h('b', { text: x.title || '' }),
        x.text ? h('p', { text: x.text }) : null,
        app ? h('button.wn-card__go', {
          type: 'button',
          onclick: () => openApp(app.id, x.opts),
        }, h('span', { text: x.app === 'settings' ? 'Open Settings' : `Open ${app.name}` }), icon('arrow-right')) : null));
  };

  const never = h('button.switch', {
    role: 'switch', 'aria-checked': 'false', id: 'wn-never', 'aria-labelledby': 'wn-never-l',
    onclick: () => {
      const on = never.getAttribute('aria-checked') !== 'true';
      never.setAttribute('aria-checked', String(on));
      never.classList.toggle('is-on', on);
      store.set(PREF, !on);
    },
  });
  const gotIt = h('button.btn.btn--primary', { type: 'button', text: 'Got it', onclick: close });

  const card = h('div.wn-sheet__card', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wn-sheet-title', tabindex: '-1',
  },
    h('header.wn-sheet__head',
      h('div.wn__badge', { 'aria-hidden': 'true' }, icon('sparkles')),
      h('div.wn-sheet__ht',
        h('div.wn__kicker', { text: `Updated to StaticOS ${top.version}` }),
        h('h2.wn-sheet__title#wn-sheet-title', { text: top.name ? `The ${top.name} update` : 'What’s new' }),
        top.summary ? h('p.wn-sheet__sum', { text: top.summary }) : null),
      h('button.ibtn.wn-sheet__x', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div.wn-sheet__body',
      h('ul.wn-sheet__grid', (top.highlights || []).map(item)),
      older.length ? h('section.wn-sheet__older',
        h('div.wn__kicker', { text: 'Also new since you last looked' }),
        h('ul', older.map(r => h('li',
          h('span.wn__ver', { text: r.version }),
          h('span', h('b', { text: r.name || `StaticOS ${r.version}` }), r.summary ? ` — ${r.summary}` : ''))))) : null,
      (top.notes || []).length ? h('section.wn-sheet__notes',
        h('div.wn__kicker', { text: 'Smaller changes' }),
        h('ul', top.notes.map(n => h('li', { text: n })))) : null),
    h('footer.wn-sheet__foot',
      h('label.wn-sheet__never', never, h('span#wn-never-l', { text: 'Don’t show this after updates' })),
      h('div.grow'),
      api.getApp('whatsnew')
        ? h('button.btn.btn--ghost', { type: 'button', text: 'All release notes', onclick: () => openApp('whatsnew') })
        : null,
      gotIt));

  const wrap = h('div.wn-sheet', {
    onpointerdown: e => { if (e.target === wrap) close(); },
  }, card);

  /* Esc closes; Tab stays inside the sheet while it is up */
  function onKey(e) {
    if (!wrap.isConnected) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...card.querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  }
  window.addEventListener('keydown', onKey, true);

  (host || document.getElementById('os') || document.body).appendChild(wrap);
  gotIt.focus({ preventScroll: true });
  open = { wrap, close };
  return open;
}

export default { checkAfterUpdate, showSheet, cmpVersion };
