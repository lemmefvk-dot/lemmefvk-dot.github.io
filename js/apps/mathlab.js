/* ============================================================
   mathlab.js — Maths Lab: three maths toys in one window.

     Fractals       Mandelbrot and Julia sets, drawn by a Worker so the
                    window stays responsive; pan, zoom, save a picture
     Automata       Conway's Life, other Life-like B/S rules, and the
                    256 one-dimensional rules
     Probability    dice, coins and spinners with real tallies, set
                    against the exact (calculated) chances

   One app with tabs, in the way Static Life is, because none is big
   enough for its own dock icon and they share a window's worth of
   chrome. The maths lives in js/core (fractal, automata,
   probability: no DOM, unit-tested) and each tab's screen in
   js/mathlab/. The tab strip is js/core/labkit.js. Its sibling for
   computer science and electronics is Logic Lab. Each tab's teardown
   stops its Worker, timers and listeners; this window returns the one
   that tears down the open tab.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { mountTabs } from '../core/labkit.js';
import { mountFractal } from '../mathlab/fractal.js';
import { mountAutomata } from '../mathlab/automata.js';
import { mountProbability } from '../mathlab/probability.js';

const TABS = [
  ['fractal', 'Fractals', mountFractal],
  ['automata', 'Automata', mountAutomata],
  ['probability', 'Probability', mountProbability],
];

defineApp({
  id: 'mathlab',
  name: 'Maths Lab',
  icon: 'grid',
  g1: '#9a7dff', g2: '#4d27cf',
  category: 'Utilities',
  keywords: ['maths', 'math', 'fractal', 'mandelbrot', 'julia', 'zoom', 'game of life', 'life', 'conway', 'cellular automata', 'automaton', 'rule 30', 'wolfram', 'probability', 'dice', 'coin', 'spinner', 'random', 'tally', 'chance', 'school', 'science', 'simulation'],
  desc: 'Explore the Mandelbrot and Julia sets, run Life and other cellular automata, and roll dice, coins and spinners with real tallies',
  singleton: true,
  win: { w: 980, h: 680, minW: 520, minH: 460 },
  shortcuts: [['Left / Right / Up / Down', 'Pan the fractal, or move the cursor in Life'], ['Plus / -', 'Zoom the fractal'], ['Space', 'Play or pause Life'], ['S', 'Step Life once']],
  mount({ root, win, api }) {
    const tabs = mountTabs(root, TABS.map(([id, label, m]) => [id, label, host => m(host, { api, win })]), { api, win }, { first: 'fractal', fk: 'ml', onTab: (id, label) => win.setSubtitle(`— ${label}`) });
    root.mathPeek = () => ({ tab: tabs.current() });
    return () => tabs.stop();
  },
});
