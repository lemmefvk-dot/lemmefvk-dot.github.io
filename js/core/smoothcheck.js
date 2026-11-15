/* ============================================================
   smoothcheck.js — notices a slow device and offers Low graphics mode.

   It measures the real frame rate, but only while the person is doing
   something that animates (moving the pointer or dragging, scrolling,
   opening or moving a window): an idle screen says nothing about how
   smooth the desktop is. Each sample is about one second of requestAnimationFrame
   timestamps taken while that activity goes on; a sample that is
   interrupted (the pointer stops, the tab is hidden, a game goes full
   screen, the lock screen comes up) is thrown away. The median of the
   last samples, once there are at least six, is the number.

   If that median is under 45 frames a second, Low graphics mode is off
   and this person has never been asked, ONE notification says so, with
   the measured number. The question is saved through store
   (session.smoothAsked, so it is per person and a guest's lasts the
   session) and is never asked again, whichever button is pressed.

   Nothing runs while there is no activity: the listeners are passive and
   the requestAnimationFrame loop only exists during a sample. It stands
   down for good once the question is answered, once Low graphics mode or
   reduced motion is on, or after MAX_SAMPLES healthy samples.

   measureHz() is the one-off refresh-rate count Settings shows.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { t } from './i18n.js';
import { covered } from './cover.js';
import * as LG from './lowgfx.js';

export const SLOW_FPS = 45;        /* a median below this is "slow" */
const SAMPLE_MS = 1000;            /* one sample */
const MIN_SAMPLES = 6;             /* the median needs at least this many */
const KEEP = 8;                    /* the latest samples the median is taken over */
const MAX_SAMPLES = 24;            /* healthy for this long: stop measuring */
const GAP_MS = 350;                /* no activity for this long ends a sample */
const MIN_FRAMES = 8;              /* a sample with fewer frames than this says nothing */

const KEY = 'session.smoothAsked';
const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Count the screen's refresh from real animation frames. Bounded by time as
    well as by frames: at 20 fps a fixed 60-frame sample would take three
    seconds. Resolves to Hz, or null if it could not be measured.
    `stop()` (optional) abandons it. */
export function measureHz(frames = 60, ms = 800, stop) {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function') { resolve(null); return; }
    let n = 0, t0 = 0;
    const step = ts => {
      if (!t0) t0 = ts;
      n++;
      const span = ts - t0;
      if (n >= frames || (span >= ms && n > 4) || stop?.()) {
        resolve(span > 0 && n > 4 ? Math.round(((n - 1) * 1000) / span) : null);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

const median = a => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

let started = false, done = false;
let lastAct = 0, sampling = false;
let stamps = [];
const samples = [];
let total = 0;
const offs = [];

const blocked = () => document.hidden || !!document.fullscreenElement || covered() || reduced()
  || document.body?.dataset.covered != null;

function finish() {      /* stop for good: drop every listener */
  done = true;
  for (const f of offs.splice(0)) f();
}

function ask(fps) {
  if (store.get(KEY) || LG.isOn()) { finish(); return; }
  store.set(KEY, true);
  finish();
  bus.emit('noti:push', {
    app: 'StaticOS', icon: 'zap', timeout: 30000,
    title: t('StaticOS is drawing about {n} frames a second here.', { n: fps }),
    message: t('Low graphics mode turns off blur, deep shadows, grain and animation to make it smoother. You can change it any time in Settings › Performance.'),
    actions: [
      { label: t('Turn it on'), onClick: () => {
        LG.set(true);
        bus.emit('noti:push', { app: 'StaticOS', icon: 'zap', timeout: 6000,
          title: t('Low graphics mode on'), message: t('Blur, deep shadows, grain and animation are off.') });
      } },
      { label: t('Not now'), onClick: () => {} },
    ],
  });
}

function sample() {
  if (sampling) return;
  sampling = true;
  stamps = [];
  const step = ts => {
    const now = performance.now();
    if (done || blocked() || now - lastAct > GAP_MS) { sampling = false; return; }   /* interrupted: nothing counts */
    stamps.push(ts);
    const span = ts - stamps[0];
    if (span >= SAMPLE_MS) {
      sampling = false;
      if (stamps.length >= MIN_FRAMES) {
        samples.push(((stamps.length - 1) * 1000) / span);
        if (samples.length > KEEP) samples.shift();
        total++;
        if (samples.length >= MIN_SAMPLES) {
          const m = median(samples);
          if (m < SLOW_FPS) { ask(Math.round(m)); return; }
        }
        if (total >= MAX_SAMPLES) { finish(); return; }
        if (LG.isOn()) { finish(); return; }
      }
      if (performance.now() - lastAct <= GAP_MS) sample();   /* the activity goes on: next sample */
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function activity() {
  if (done) return;
  lastAct = performance.now();
  if (!sampling && !blocked()) sample();
}

export function init() {
  if (started || typeof document === 'undefined') return;
  started = true;
  if (store.get(KEY) || LG.isOn() || reduced()) { done = true; return; }
  const on = (target, type, opts) => {
    const f = () => activity();
    target.addEventListener(type, f, opts);
    offs.push(() => target.removeEventListener(type, f, opts));
  };
  const o = { passive: true, capture: true };
  on(document, 'pointermove', o);
  on(document, 'wheel', o);
  on(document, 'scroll', o);        /* scroll does not bubble: capture sees every scroller */
  /* windows opening, minimising, maximising, snapping (their animation); moving and resizing are pointer moves */
  for (const ev of ['win:open', 'win:minimize', 'win:restore', 'win:max', 'win:snap']) offs.push(bus.on(ev, activity));
}

export default { init, measureHz, SLOW_FPS };
