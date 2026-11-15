/* ============================================================
   mathlab/probability.js — the Probability lab tab: dice, coins and
   spinners with real tallies.

   Every roll is simulated here, one at a time, and added to the
   tally. The bars and percentages are worked out from those counts
   alone. The "Theory" column is the exact chance, calculated by
   counting outcomes (js/core/probability.js), and is labelled as
   theory: it is not a measurement. Nothing is shown until there has
   been at least one roll, and Reset empties the tally.
   ============================================================ */
import { h } from '../core/dom.js';
import * as P from '../core/probability.js';
import { slider, listeners, cssVar } from '../core/labkit.js';

const SIDES = [4, 6, 8, 10, 12, 20];
const pct = v => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

export function mountProbability(host) {
  const L = listeners();
  let dead = false;
  const S = { kind: 'dice', dice: 2, sides: 6, coins: 3, weights: [1, 1, 1, 1], names: ['Red', 'Blue', 'Green', 'Yellow'], tally: null, lastRoll: null };
  const setup = () => (S.kind === 'dice' ? { kind: 'dice', dice: S.dice, sides: S.sides } : S.kind === 'coins' ? { kind: 'coins', coins: S.coins } : { kind: 'spinner', weights: S.weights, names: S.names });
  const labels = () => P.outcomes(setup());

  const kinds = { dice: 'Dice', coins: 'Coins', spinner: 'Spinner' };
  const kindBtns = Object.fromEntries(Object.entries(kinds).map(([k, t]) => [k, h('button.lab__btn', { type: 'button', dataset: { fk: `prob-kind-${k}` }, onclick: () => setKind(k) }, t)]));
  const diceSel = h('select', { 'aria-label': 'Number of dice', dataset: { fk: 'prob-dice' }, onchange: e => { S.dice = Number(e.target.value); reset(); } }, [1, 2, 3, 4].map(n => h('option', { value: n, text: `${n} ${n === 1 ? 'die' : 'dice'}`, selected: n === S.dice })));
  const sidesSel = h('select', { 'aria-label': 'Sides on each die', dataset: { fk: 'prob-sides' }, onchange: e => { S.sides = Number(e.target.value); reset(); } }, SIDES.map(n => h('option', { value: n, text: `d${n}`, selected: n === S.sides })));
  const coinsSel = h('select', { 'aria-label': 'Number of coins', dataset: { fk: 'prob-coins' }, onchange: e => { S.coins = Number(e.target.value); reset(); } }, [1, 2, 3, 4, 5, 6, 8, 10].map(n => h('option', { value: n, text: `${n} ${n === 1 ? 'coin' : 'coins'}`, selected: n === S.coins })));
  const spinBox = h('div', { hidden: true, dataset: { fk: 'prob-spinner' } });
  const setupBox = h('div.lab__row');
  const rollBtns = [[1, 'Roll'], [10, 'Roll 10'], [100, 'Roll 100'], [1000, 'Roll 1000']].map(([n, t]) => h('button.lab__btn' + (n === 1 ? '.lab__btn--go' : ''), { type: 'button', dataset: { fk: `prob-roll-${n}` }, onclick: () => rollMany(n) }, t));
  const resetBtn = h('button.lab__btn', { type: 'button', dataset: { fk: 'prob-reset' }, onclick: () => reset() }, 'Reset tally');
  const chart = h('canvas', { role: 'img', 'aria-label': 'Bar chart of the tally', dataset: { fk: 'prob-chart' } });
  const stage = h('div.lab__stage', { style: { minHeight: '220px' } }, chart);
  const status = h('p.lab__note', { role: 'status', dataset: { fk: 'prob-status' } });
  const table = h('table', { dataset: { fk: 'prob-table' } });
  const lastEl = h('p.lab__note', { dataset: { fk: 'prob-last' } });

  function paintSetup() {
    setupBox.replaceChildren(...(S.kind === 'dice' ? [diceSel, sidesSel] : S.kind === 'coins' ? [coinsSel] : []));
    spinBox.hidden = S.kind !== 'spinner';
    for (const [k, b] of Object.entries(kindBtns)) b.setAttribute('aria-pressed', String(k === S.kind));
    if (S.kind === 'spinner') paintSpinner();
  }
  function paintSpinner() {
    spinBox.replaceChildren(h('h3', { text: 'Sectors' }), ...S.weights.map((w, i) => h('div.lab__row', { style: { marginTop: '4px' } },
      h('input', { type: 'text', value: S.names[i], 'aria-label': `Sector ${i + 1} name`, size: 10, dataset: { fk: `prob-name-${i}` }, onchange: e => { S.names[i] = e.target.value.slice(0, 16); reset(); } }),
      h('input', { type: 'number', min: 1, max: 20, value: w, 'aria-label': `Sector ${i + 1} size (relative)`, dataset: { fk: `prob-weight-${i}` }, onchange: e => { const v = Math.round(Number(e.target.value)); S.weights[i] = v >= 1 && v <= 20 ? v : 1; e.target.value = S.weights[i]; reset(); } }),
      S.weights.length > 2 ? h('button.lab__btn.lab__btn--sm', { type: 'button', 'aria-label': `Remove sector ${i + 1}`, onclick: () => { S.weights.splice(i, 1); S.names.splice(i, 1); paintSpinner(); reset(); } }, 'Remove') : null)),
    S.weights.length < 8 ? h('div.lab__row', { style: { marginTop: '6px' } }, h('button.lab__btn.lab__btn--sm', { type: 'button', dataset: { fk: 'prob-add-sector' }, onclick: () => { S.weights.push(1); S.names.push(`Sector ${S.weights.length}`); paintSpinner(); reset(); } }, 'Add a sector')) : null,
    h('p.lab__note', { text: 'A sector\'s size is relative: size 2 is twice as wide as size 1.' }));
  }
  function setKind(k) { if (k === S.kind) return; S.kind = k; paintSetup(); reset(); }
  function reset() { S.tally = P.makeTally(labels().length); S.lastRoll = null; paintAll(); }

  function rollMany(n) {
    const s = setup();
    for (let i = 0; i < n; i++) P.record(S.tally, P.roll(s));
    S.lastRoll = S.tally.last[S.tally.last.length - 1];
    paintAll();
  }

  function paintAll() {
    if (dead) return;
    const lab = labels(), t = S.tally, th = P.theory(setup());
    const n = t.total;
    status.textContent = n ? `${n.toLocaleString('en')} ${n === 1 ? 'roll' : 'rolls'} so far. The percentages are counted from these rolls.` : 'No rolls yet. Roll to start a tally.';
    const head = h('tr', h('th', { text: S.kind === 'dice' ? 'Total' : S.kind === 'coins' ? 'Heads' : 'Sector' }), h('th', { text: 'Rolled' }), h('th', { text: 'Share of rolls' }), h('th', { text: 'Theory (calculated)' }), h('th', { text: 'Difference' }));
    table.replaceChildren(h('thead', head), h('tbody', ...lab.map((name, i) => h('tr', { dataset: { outcome: name } },
      h('th', { scope: 'row', text: name }), h('td', { text: String(t.counts[i]), dataset: { role: 'count' } }),
      h('td', { text: n ? pct(t.counts[i] / n) : '—', dataset: { role: 'share' } }), h('td', { text: pct(th[i]), dataset: { role: 'theory' } }),
      h('td', { text: n ? `${t.counts[i] / n - th[i] >= 0 ? '+' : '−'}${(Math.abs(t.counts[i] / n - th[i]) * 100).toFixed(1)}` : '—' })))));
    lastEl.textContent = t.last.length ? `Last rolls: ${t.last.slice(-12).map(i => lab[i]).join(', ')}` : '';
    drawChart();
  }

  function drawChart() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width)), hh = Math.max(160, Math.floor(r.height));
    if (chart.width !== w || chart.height !== hh) { chart.width = w; chart.height = hh; }
    const c = chart.getContext('2d');
    const accent = cssVar(host, '--accent', '#4a9cff'), ink = cssVar(host, '--ink-2', '#aaa'), line = cssVar(host, '--line-1', '#444'), strong = cssVar(host, '--ink-0', '#fff');
    c.clearRect(0, 0, w, hh);
    const lab = labels(), t = S.tally, th = P.theory(setup()), n = t.total;
    const shares = t.counts.map(v => (n ? v / n : 0));
    const top = Math.max(0.05, ...shares, ...th) * 1.12;
    const L0 = 38, B = 28, T = 10, R = 8, bw = (w - L0 - R) / lab.length;
    c.font = '11px system-ui, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = top * k / 4, y = hh - B - (hh - B - T) * k / 4;
      c.strokeStyle = line; c.beginPath(); c.moveTo(L0, y); c.lineTo(w - R, y); c.stroke();
      c.fillStyle = ink; c.fillText(`${Math.round(v * 100)}%`, L0 - 5, y);
    }
    lab.forEach((name, i) => {
      const x = L0 + i * bw, y0 = hh - B;
      c.fillStyle = accent;
      const bh = (hh - B - T) * shares[i] / top;
      c.fillRect(x + bw * 0.14, y0 - bh, bw * 0.72, bh);
      /* the theory chance, as a tick across the bar */
      const ty = y0 - (hh - B - T) * th[i] / top;
      c.strokeStyle = strong; c.lineWidth = 2; c.beginPath(); c.moveTo(x + bw * 0.06, ty); c.lineTo(x + bw * 0.94, ty); c.stroke(); c.lineWidth = 1;
      c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'top';
      if (bw > 14 || i % 2 === 0) c.fillText(name.length > 8 ? name.slice(0, 7) + '…' : name, x + bw / 2, y0 + 6);
      c.textAlign = 'right';
    });
  }

  host.append(
    h('div.lab__main', h('div.lab__row', kindBtns.dice, kindBtns.coins, kindBtns.spinner, h('span.lab__sp'), setupBox), stage, h('div.lab__row', ...rollBtns, h('span.lab__sp'), resetBtn), status),
    h('div.lab__side', spinBox, h('h3', { text: 'Tally' }), h('div', { style: { overflow: 'auto', maxHeight: '320px' } }, table), lastEl,
      h('p.lab__note', { html: '<b>Bars</b> are the share of your rolls that landed on each outcome. The <b>line</b> across each bar and the Theory column are the exact chances, worked out by counting, not measured. A few rolls will often sit far from theory; thousands settle close to it.' })));
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) drawChart(); }); ro.observe(stage); }
  paintSetup();
  S.tally = P.makeTally(labels().length);
  paintAll();
  host.__peek = () => ({ kind: S.kind, total: S.tally.total, counts: [...S.tally.counts], labels: labels(), theory: P.theory(setup()), last: [...S.tally.last] });
  return () => { dead = true; if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } } L.off(); };
}
