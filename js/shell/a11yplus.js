/* ============================================================
   a11yplus.js — sounds you can't hear, shown another way, and the
   on-screen keyboard.

   StaticOS says "a notification sound", "an error sound" or "the timer
   sound" on bus 'sfx:cue' (js/core/sfx.js) every time it would play
   one — whether or not the sound itself plays. This module turns that
   into:

     · a caption (Settings › Accessibility › Captions for sounds): a
       small line above the dock, "Notification sound", for a few seconds
     · a flash (Flash the screen for alerts): one soft frame of light
       round the screen's edge. One flash at a time and never more than
       one a second, so it can't strobe; with Reduce motion it is a
       steady frame that fades by itself, not a pulse

   Only sounds that mean something are captioned: notifications, errors
   and the timer. Taps, window sounds and the music apps are not: that
   would be a caption on every click.

   The on-screen keyboard (prefs.osk) lives in js/shell/osk.js and is
   loaded the first time it is switched on.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-a11yplus-css')) {
  const l = document.createElement('link');
  l.id = 'feat-a11yplus-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-a11yplus.css';
  document.head.appendChild(l);
}

export const CAPTION_MS = 3200;
export const FLASH_MS = 700;
export const FLASH_GAP = 1000;       /* at most one flash a second (WCAG 2.3.1 allows three) */

const P = k => store.get('prefs.' + k);

export function mountA11yPlus(host) {
  const { h, icon } = api;
  const offs = [];

  /* ---------------- captions ---------------- */
  const caps = h('div.a11y-caps', { role: 'log', 'aria-label': 'Sound captions', 'aria-live': 'off' });
  host.appendChild(caps);
  const lastAt = new Map();
  function caption(label) {
    const t = Date.now();
    if (t - (lastAt.get(label) || 0) < 400) return;      /* one sound, one line */
    lastAt.set(label, t);
    const line = h('div.a11y-cap', icon('volume-2'), h('span', { text: label }));
    caps.appendChild(line);
    while (caps.children.length > 3) caps.firstChild.remove();
    setTimeout(() => line.remove(), CAPTION_MS);
  }

  /* ---------------- the flash ---------------- */
  const flashEl = h('div.a11y-flash', { 'aria-hidden': 'true' });
  host.appendChild(flashEl);
  let flashAt = 0, flashT = 0;
  function flash() {
    const t = Date.now();
    if (t - flashAt < FLASH_GAP) return;
    flashAt = t;
    flashEl.classList.add('is-on');
    clearTimeout(flashT);
    flashT = setTimeout(() => flashEl.classList.remove('is-on'), FLASH_MS);
  }

  offs.push(bus.on('sfx:cue', c => {
    if (!c) return;
    if (P('soundCaptions')) caption(c.label || 'Sound');
    if (P('flashAlerts')) flash();
  }));
  /* the Settings button: show both, so the person sees what they chose */
  offs.push(bus.on('a11y:alert-preview', () => {
    if (P('soundCaptions')) caption('Notification sound');
    if (P('flashAlerts')) flash();
  }));

  /* ---------------- the on-screen keyboard ---------------- */
  let osk = null, oskLoading = null;
  async function syncOsk() {
    const want = !!P('osk') && !document.body.classList.contains('is-mobile');
    if (want && !osk) {
      oskLoading = oskLoading || import('./osk.js').catch(err => { console.warn('[StaticOS] on-screen keyboard', err); return null; });
      const m = await oskLoading;
      if (m && !osk && P('osk')) osk = m.mountOsk(host);
    } else if (!want && osk) {
      osk(); osk = null;
    }
  }
  offs.push(store.sub('prefs.osk', syncOsk));
  syncOsk();

  return () => {
    offs.forEach(off => off());
    clearTimeout(flashT);
    caps.remove();
    flashEl.remove();
    if (osk) { osk(); osk = null; }
  };
}

export default mountA11yPlus;
