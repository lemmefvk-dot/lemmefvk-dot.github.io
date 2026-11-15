/* ============================================================
   logiclab/sorting.js — the Sorting tab: watch an algorithm sort a
   row of bars, one comparison at a time. The algorithms are
   generators in js/core/sorts.js; this tab only draws their events.

   The counters are tallies of the events the run produced:
   comparisons, swaps and (for merge sort) writes. The big-O line is
   the textbook figure and is labelled as such; the counters are the
   measurement.

   Space plays and pauses, S takes one step, N makes new data,
   R puts the same data back.
   ============================================================ */
import { h } from '../core/dom.js';
import * as SO from '../core/sorts.js';
import { slider, listeners, cssVar } from '../core/labkit.js';

export function mountSorting(host) {
  const L = listeners();
  let dead = false;
  const S = { algo: 'bubble', n: 40, kind: 'random', data: [], orig: [], gen: null, count: { cmp: 0, swap: 0, set: 0 }, hot: null, running: false, done: false, perSec: 60, last: 0, raf: 0, sweep: 0 };

  const canvas = h('canvas', { tabindex: '0', role: 'img', 'aria-label': 'The bars being sorted', dataset: { fk: 'sort-canvas' } });
  const stage = h('div.lab__stage', canvas);
  const algoSel = h('select', { 'aria-label': 'Algorithm', dataset: { fk: 'sort-algo' }, onchange: e => { S.algo = e.target.value; restart(S.orig); } }, Object.entries(SO.ALGORITHMS).map(([k, a]) => h('option', { value: k, text: a.name })));
  const kindSel = h('select', { 'aria-label': 'Starting order', dataset: { fk: 'sort-kind' }, onchange: e => { S.kind = e.target.value; newData(); } },
    [['random', 'Random'], ['reversed', 'Reversed'], ['nearly', 'Nearly sorted'], ['few', 'Few distinct values'], ['sorted', 'Already sorted']].map(([v, t]) => h('option', { value: v, text: t })));
  const size = slider('Items', { min: 5, max: 150, value: S.n, fk: 'sort-size' }, v => { S.n = v; newData(); });
  const speed = slider('Speed', { min: 1, max: 600, value: S.perSec, fmt: v => `${v} steps/s`, fk: 'sort-speed' }, v => { S.perSec = v; });
  const play = h('button.lab__btn.lab__btn--go', { type: 'button', dataset: { fk: 'sort-play' }, onclick: () => toggle() }, 'Sort');
  const stepB = h('button.lab__btn', { type: 'button', dataset: { fk: 'sort-step' }, onclick: () => { S.running = false; advance(1); paintPlay(); } }, 'Step');
  const newB = h('button.lab__btn', { type: 'button', dataset: { fk: 'sort-new' }, onclick: () => newData() }, 'New data');
  const resetB = h('button.lab__btn', { type: 'button', dataset: { fk: 'sort-reset' }, onclick: () => restart(S.orig) }, 'Reset');
  const meas = h('dl.lab__meas', { dataset: { fk: 'sort-meas' } });
  const theory = h('p.lab__note', { dataset: { fk: 'sort-theory' } });
  const status = h('p.lab__note', { role: 'status', dataset: { fk: 'sort-status' } });

  host.append(
    h('div.lab__main', h('div.lab__row', algoSel, kindSel, h('span.lab__sp'), play, stepB, newB, resetB), stage),
    h('div.lab__side', h('h3', { text: 'This run (counted)' }), meas, status, size.el, speed.el, h('h3', { text: 'Textbook' }), theory,
      h('p.lab__note', { text: 'Pink bars are being compared, orange ones were just swapped or written. Counts include everything the algorithm did, not just the visible part.' })));

  function newData() { restart(SO.makeData(S.n, S.kind)); }
  function restart(data) {
    S.orig = data.slice(); S.data = data.slice();
    S.gen = SO.ALGORITHMS[S.algo].run(S.data);
    S.count = { cmp: 0, swap: 0, set: 0 }; S.hot = null; S.done = false; S.running = false; S.sweep = 0;
    paintPlay(); paint();
  }
  function advance(k) {
    for (let i = 0; i < k && !S.done; i++) {
      const r = S.gen.next();
      if (r.done) { S.done = true; S.hot = null; S.running = false; S.sweep = 0; paintPlay(); break; }
      S.count[r.value.t]++;
      S.hot = r.value;
    }
    paint();
  }
  function toggle() {
    if (S.done) { restart(S.orig); S.running = true; }
    else S.running = !S.running;
    S.last = 0; paintPlay();
  }
  function paintPlay() { play.textContent = S.done ? 'Sort again' : S.running ? 'Pause' : S.count.cmp || S.count.swap || S.count.set ? 'Resume' : 'Sort'; play.dataset.state = S.done ? 'done' : S.running ? 'running' : 'paused'; }

  function paint() {
    if (dead) return;
    const r = stage.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width)), hh = Math.max(160, Math.floor(r.height));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    const c = canvas.getContext('2d');
    const accent = cssVar(host, '--accent', '#4a9cff'), bg = cssVar(host, '--fill-0', '#111');
    c.fillStyle = bg; c.fillRect(0, 0, w, hh);
    const n = S.data.length, bw = w / n, max = Math.max(...S.data, 1);
    const hotIdx = new Set(S.hot && S.hot.t === 'cmp' ? [S.hot.i, S.hot.j] : []), moved = new Set(S.hot && S.hot.t !== 'cmp' ? (S.hot.t === 'swap' ? [S.hot.i, S.hot.j] : [S.hot.i]) : []);
    for (let i = 0; i < n; i++) {
      const bh = (hh - 8) * S.data[i] / max;
      c.fillStyle = S.done && i <= S.sweep ? '#2bb673' : moved.has(i) ? '#f2994a' : hotIdx.has(i) ? '#ff6fae' : accent;
      c.fillRect(i * bw + (bw > 4 ? 1 : 0), hh - bh, Math.max(1, bw - (bw > 4 ? 2 : 0)), bh);
    }
    const t = SO.ALGORITHMS[S.algo];
    meas.replaceChildren(...[['Comparisons', S.count.cmp], ['Swaps', S.count.swap], ['Writes', S.count.set], ['Items', n]].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v), dataset: { k } })]));
    theory.textContent = `${t.name}: best ${t.best}, average ${t.avg}, worst ${t.worst}. ${t.note}`;
    status.textContent = S.done ? `Sorted in ${S.count.cmp} comparisons, ${S.count.swap} swaps and ${S.count.set} writes.` : '';
  }

  function frame(now) {
    S.raf = 0;
    if (dead) return;
    if (S.running) {
      if (!S.last) S.last = now;
      const k = Math.floor((now - S.last) * S.perSec / 1000);
      if (k > 0) { S.last = now; advance(Math.min(k, 400)); }
    } else if (S.done && S.sweep < S.data.length) { S.sweep += Math.max(1, S.data.length / 40); paint(); }
    S.raf = requestAnimationFrame(frame);
  }
  S.raf = requestAnimationFrame(frame);
  L.on(canvas, 'keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 's' || e.key === 'S') { S.running = false; advance(1); paintPlay(); }
    else if (e.key === 'n' || e.key === 'N') newData();
    else if (e.key === 'r' || e.key === 'R') restart(S.orig);
  });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) paint(); }); ro.observe(stage); }
  newData();
  host.__peek = () => ({ algo: S.algo, data: S.data.slice(), orig: S.orig.slice(), count: { ...S.count }, done: S.done, running: S.running, sorted: S.data.every((v, i) => !i || S.data[i - 1] <= v) });
  return () => { dead = true; if (S.raf) cancelAnimationFrame(S.raf); if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } } L.off(); };
}
