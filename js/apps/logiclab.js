/* ============================================================
   logiclab.js — Logic Lab: computer science and electronics toys in
   one window.

     Sorting     watch bubble, insertion, selection, merge, quick and
                 heap sort work, with counted comparisons and swaps
     Logic gates wire switches, gates and lamps; see each signal and
                 the circuit's truth table
     Circuits    batteries, resistors, bulbs and switches, solved by
                 nodal analysis

   One app with tabs for the reasons Maths Lab is (and shares its tab
   strip, js/core/labkit.js). The logic lives in js/core (sorts,
   logic, circuit: no DOM, unit-tested against worked answers) and each
   tab's screen in js/logiclab/. This window returns the teardown of
   the open tab.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { mountTabs } from '../core/labkit.js';
import { mountSorting } from '../logiclab/sorting.js';
import { mountGates } from '../logiclab/gates.js';
import { mountCircuit } from '../logiclab/circuit.js';

const TABS = [
  ['sorting', 'Sorting', mountSorting],
  ['gates', 'Logic gates', mountGates],
  ['circuit', 'Circuits', mountCircuit],
];

defineApp({
  id: 'logiclab',
  name: 'Logic Lab',
  icon: 'cpu',
  g1: '#45cdf0', g2: '#0874ad',
  category: 'Utilities',
  keywords: ['logic', 'gates', 'and', 'or', 'not', 'xor', 'nand', 'truth table', 'boolean', 'adder', 'circuit', 'circuits', 'battery', 'resistor', 'bulb', 'ohm', 'voltage', 'current', 'electronics', 'sorting', 'sort', 'algorithm', 'bubble sort', 'quicksort', 'merge sort', 'computer science', 'school', 'simulation'],
  desc: 'Watch sorting algorithms work, wire up logic gates with truth tables, and solve circuits of batteries, resistors and bulbs',
  singleton: true,
  win: { w: 1000, h: 700, minW: 520, minH: 460 },
  shortcuts: [['Space', 'Start or pause a sort'], ['S', 'Step a sort once'], ['N', 'New data for a sort']],
  mount({ root, win }) {
    const tabs = mountTabs(root, TABS.map(([id, label, m]) => [id, label, host => m(host)]), {}, { first: 'sorting', fk: 'll', onTab: (id, label) => win.setSubtitle(`— ${label}`) });
    root.logicPeek = () => ({ tab: tabs.current() });
    return () => tabs.stop();
  },
});
