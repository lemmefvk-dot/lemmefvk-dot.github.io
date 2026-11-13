/* ============================================================
   boot.js — the startup splash. Steps a few plausible init
   messages, fills the progress bar, fades out and resolves.
   Second boot of a session is the short version.
   ============================================================ */
import * as sfx from '../core/sfx.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';

const FULL = [
  'starting the window manager',
  'mounting /home',
  'loading your theme',
  'registering apps',
  'starting the desktop',
  'restoring session',
  'ready',
];
const QUICK = ['starting the desktop', 'restoring session', 'ready'];

const FADE = 520;   /* matches .boot's opacity transition */
const sleep = ms => new Promise(r => setTimeout(r, ms));

const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function runBoot(host) {
  /* a restart triggered by the updater should feel instant, not ceremonial */
  let restarting = false;
  try {
    restarting = sessionStorage.getItem('aether.restarting') === '1';
    if (restarting) sessionStorage.removeItem('aether.restarting');
  } catch (err) { /* private mode */ }
  let updateTo = '';
  try { updateTo = sessionStorage.getItem('aether.updateTo') || ''; sessionStorage.removeItem('aether.updateTo'); } catch (err) {}
  const again = !!store.get('session.bootedOnce');
  /* restarting into a new version gets a short install sequence, not a blink */
  const steps = restarting && updateTo
    ? [`installing StaticOS ${updateTo}`, 'updating apps', `StaticOS ${updateTo} ready`]
    : restarting ? [QUICK[QUICK.length - 1]] : (again ? QUICK : FULL);
  if (restarting && updateTo) restarting = false;   /* play it, don't skip it */

  const fill = h('i');
  const msg = h('div.boot__msg');
  const el = h('div.boot',
    h('div.boot__logo', icon('diamond')),
    h('div.boot__name', 'StaticOS'),   /* no version here: the real one is build.json's, shown in Settings › About */
    h('div.boot__bar', fill),
    msg,
  );
  host.appendChild(el);

  const step = i => {
    msg.textContent = steps[i];
    fill.style.width = Math.round((i + 1) / steps.length * 100) + '%';
  };

  const finish = async fade => {
    el.classList.add('is-done');
    await sleep(fade);
    el.remove();
    store.set('session.bootedOnce', true);
  };

  if (reduced() || restarting) {
    step(steps.length - 1);
    return finish(40);
  }
  /* the diamond's chime — only heard if a key or click unlocked audio */
  setTimeout(() => sfx.boot('chime'), 120);

  const per = updateTo ? 650 : (again ? 600 : 1600) / steps.length;
  return (async () => {
    for (let i = 0; i < steps.length; i++) { step(i); await sleep(per); }
    await finish(FADE);
  })();
}

export default runBoot;
