/* ============================================================
   boot.js — the startup splash. Steps a few plausible init
   messages, fills the progress bar, fades out and resolves.
   Second boot of a session is the short version.
   ============================================================ */
import * as sfx from '../core/sfx.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';

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

/* `ready`: the shell still loading underneath (js/main.js). The last step,
   "ready", waits for it, so the splash never lifts off a half-built desktop. */
export function runBoot(host, ready = Promise.resolve()) {
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
    ? [`installing StaticOS ${updateTo}`, 'updating apps', t('StaticOS {updateTo} ready', { updateTo })]
    : restarting ? [QUICK[QUICK.length - 1]] : (again ? QUICK : FULL);
  if (restarting && updateTo) restarting = false;   /* play it, don't skip it */

  /* Settings › Desktop › Retro CRT start-up: the same steps, as a green
     phosphor terminal that switches on and, at the end, off */
  const crt = store.get('prefs.bootCrt') === true;
  const fill = h('i');
  const msg = h('div.boot__msg');
  const log = h('pre.boot__crt-log', { 'aria-hidden': 'true' });
  const el = crt
    ? h('div.boot.boot--crt', { role: 'status', 'aria-label': t('StaticOS is starting') },
      h('div.boot__crt', h('div.boot__crt-title', t('StaticOS BIOS v4')), log, h('div.boot__crt-bar', { 'aria-hidden': 'true' }, fill), h('span.boot__crt-cursor', { 'aria-hidden': 'true' }, '_')),
      h('div.boot__crt-scan', { 'aria-hidden': 'true' }))
    : h('div.boot',
      h('div.boot__logo', icon('diamond')),
      h('div.boot__name', 'StaticOS'),   /* no version here: the real one is build.json's, shown in Settings › About */
      h('div.boot__bar', fill),
      msg,
    );
  host.appendChild(el);

  const step = i => {
    msg.textContent = steps[i];
    if (crt) {
      log.textContent += `${i === steps.length - 1 ? '> ' : '  '}${steps[i]}${i === steps.length - 1 ? '' : ' ... ok'}\n`;
    }
    fill.style.width = Math.round((i + 1) / steps.length * 100) + '%';
  };

  const finish = async fade => {
    /* the CRT switches off: the picture squeezes to a line, then a dot */
    if (crt && fade > 100) { el.classList.add('is-off'); await sleep(420); }
    el.classList.add('is-done');
    await sleep(fade);
    el.remove();
    store.set('session.bootedOnce', true);
  };

  const fast = store.get('prefs.bootFast') === true;   /* Settings › Desktop › Startup › Skip the boot animation */
  if (reduced() || restarting || fast) {
    if (crt && !fast) for (let i = 0; i < steps.length; i++) step(i);   /* the whole screen at once, nothing moving */
    else step(steps.length - 1);
    return ready.then(() => finish(40));
  }
  /* the diamond's chime — only heard if a key or click unlocked audio */
  setTimeout(() => sfx.boot('chime'), 120);

  const per = updateTo ? 650 : (again ? 600 : 1600) / steps.length;
  return (async () => {
    for (let i = 0; i < steps.length; i++) {
      if (i === steps.length - 1) await ready;
      step(i);
      await sleep(crt ? Math.max(per, 260) : per);
    }
    await finish(FADE);
  })();
}

/** Settings › Desktop › Preview: the CRT start-up, once, over whatever is on
    screen. Writes nothing (the real boot marks the session; this doesn't). */
export async function previewCrt(host) {
  const log = h('pre.boot__crt-log', { 'aria-hidden': 'true' });
  const fill = h('i');
  const el = h('div.boot.boot--crt', { role: 'status', 'aria-label': t('Preview of the retro start-up'), dataset: { preview: '1' } },
    h('div.boot__crt', h('div.boot__crt-title', t('StaticOS BIOS v4')), log, h('div.boot__crt-bar', { 'aria-hidden': 'true' }, fill), h('span.boot__crt-cursor', { 'aria-hidden': 'true' }, '_')),
    h('div.boot__crt-scan', { 'aria-hidden': 'true' }));
  host.appendChild(el);
  const still = reduced();
  for (let i = 0; i < QUICK.length; i++) {
    log.textContent += `${i === QUICK.length - 1 ? '> ' : '  '}${QUICK[i]}${i === QUICK.length - 1 ? '' : ' ... ok'}\n`;
    fill.style.width = Math.round((i + 1) / QUICK.length * 100) + '%';
    if (!still) await sleep(420);
  }
  await sleep(still ? 1500 : 700);
  if (!still) { el.classList.add('is-off'); await sleep(420); }
  el.classList.add('is-done');
  await sleep(still ? 40 : FADE);
  el.remove();
}

export default runBoot;
