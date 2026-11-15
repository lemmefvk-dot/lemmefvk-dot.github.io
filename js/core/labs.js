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

/* What each experiment is, in plain words, for Settings > Labs and Static Store >
   Labs: what it changes, and whether turning it off puts everything back.
   `undo` is the honest answer to "can I undo this?"; `sends` is set when the
   experiment sends anything off this computer. */
export const LABS = [
  { key: 'labStaticumAI', name: 'Staticum asks a free AI when it has no answer', icon: 'sparkles',
    note: 'When none of Staticum’s own skills fit a question, it asks a small free AI model instead of saying it can’t help.',
    changes: ['Staticum’s answers to questions its skills don’t cover'],
    sends: 'Your question is sent to text.pollinations.ai (the free model, GPT-OSS 20B). Answers can be wrong or off the point.',
    undo: 'Turn it off and Staticum goes back to saying it can’t help. Nothing was saved, so there is nothing to clean up.' },
  { key: 'labFps', name: 'Frame-rate counter', icon: 'gauge',
    note: 'A small, measured fps reading in the corner of the screen.',
    changes: ['A readout in the corner of the screen', 'It measures animation frames while it is on'],
    sends: null,
    undo: 'Turn it off and the readout goes and the measuring stops.' },
  { key: 'labCompact', name: 'Compact title bars', icon: 'window',
    note: 'Thinner window title bars, for more room on small screens.',
    changes: ['The height of every window’s title bar'],
    sends: null,
    undo: 'Turn it off and the title bars are the usual height again. Window sizes are untouched.' },
];

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
