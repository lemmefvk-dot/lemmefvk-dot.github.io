/* ============================================================
   labs.js — Static Labs: experiments that are real but not yet
   the default (section 33). Each is a pref, off unless you turn it
   on in Settings › Labs.

     prefs.labFps        a frame-rate counter in the corner — measured
                         by metrics.js from real animation frames
     prefs.labCompact    compact window title bars
     prefs.labStaticumAI Staticum answers questions none of its skills
                         cover with the free AI model (portal/aetherium.js)
   ============================================================ */
import { store } from './store.js';
import * as M from './metrics.js';

let meter = null;
let timer = 0;

function fps(on) {
  if (on && !meter) {
    M.start('lab-fps');
    meter = document.createElement('div');
    meter.className = 'lab-fps';
    meter.setAttribute('aria-hidden', 'true');
    document.body.appendChild(meter);
    const paint = () => {
      const v = M.currentFps();
      meter.textContent = v ? `${v} fps` : '— fps';
      meter.dataset.band = !v ? '' : v >= 55 ? 'good' : v >= 30 ? 'ok' : 'low';
    };
    paint();
    timer = setInterval(paint, 500);
  } else if (!on && meter) {
    clearInterval(timer);
    meter.remove();
    meter = null;
    M.stop('lab-fps');   /* the meter is gone: stop paying for frame samples */
  }
}

function apply() {
  fps(!!store.get('prefs.labFps'));
  document.documentElement.dataset.titlebars = store.get('prefs.labCompact') ? 'compact' : 'normal';
}

export function init() {
  store.sub('prefs', apply);
  apply();
}

export default { init };
