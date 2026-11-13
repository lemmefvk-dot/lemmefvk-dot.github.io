/* ============================================================
   study/stats.js — the Statistics tab of Static Study.

   Two modes. A list of numbers (typed, or pasted from a spreadsheet
   column) gives the count, mean, median, mode, range, quartiles and
   both the sample and the population variance and standard deviation,
   each labelled. Paired x, y data (one pair per line) adds the line of
   best fit with its slope, intercept and r, and a scatter plot with the
   line; it says plainly when no line can be fitted. Anything that is not
   a number is left out and listed, never guessed at.

   The maths is js/core/stats.js. Here it is the form and the display;
   the plot is a <canvas> drawn from the real points.
   ============================================================ */
import * as ST from '../core/stats.js';

const MODES = [['list', 'List of numbers'], ['pairs', 'Paired x, y']];
const draft = { mode: 'list', list: '', pairs: '' };
const EX = {
  list: '4, 8, 6, 5, 3, 8, 9, 5, 8',
  pairs: 'x,y\n1,2.1\n2,3.9\n3,6.2\n4,7.8\n5,10.1',
};

export function mountStats(host, ctx) {
  const { api } = ctx;
  const { h, icon } = api;
  const S = { dead: false, raf: 0 };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const tabs = h('div.tabs.st-tabs', { role: 'tablist', 'aria-label': 'Kind of data' });
  const ta = h('textarea.st-ta.st-ta--big.st-stats__in', { spellcheck: 'false', maxlength: '200000', dataset: { fk: 'stats-input' }, 'aria-label': 'Data', oninput: e => { draft[draft.mode] = e.target.value; paintResults(); } });
  const hint = h('p.st-note', { dataset: { fk: 'stats-hint' } });
  const out = h('div.st-stats__out', { dataset: { fk: 'stats-out' }, 'aria-live': 'polite' });
  const canvas = h('canvas.st-stats__plot', { role: 'img', width: 480, height: 300, dataset: { fk: 'stats-plot' } });

  function paintTabs() {
    tabs.replaceChildren(...MODES.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': draft.mode === id ? 'true' : 'false', class: draft.mode === id ? 'is-on' : '', dataset: { mode: id },
      onclick: () => { draft.mode = id; ta.value = draft[id]; paintTabs(); paintHint(); paintResults(); } }, h('span', { text: label }))));
  }
  function paintHint() {
    hint.textContent = draft.mode === 'list'
      ? 'Type or paste numbers separated by commas, spaces or new lines. A column pasted from a spreadsheet works. Use a point for decimals (3.5), not a comma. Anything that is not a number is left out and listed.'
      : 'One pair per line: x then y, separated by a comma, space or tab (x,y). A line that is not exactly two numbers, such as a header, is left out and listed.';
    ta.placeholder = draft.mode === 'list' ? 'e.g. 4, 8, 6, 5, 3, 8, 9, 5, 8' : 'e.g.\n1, 2\n2, 4.1\n3, 5.9';
  }

  const row = (fk, label, value, sub) => h('div.st-stats__row', { dataset: { fk } }, h('span.st-stats__l', { text: label }), h('b.st-stats__v', { dataset: { fk: `${fk}-v` }, text: value }), sub ? h('small', { text: sub }) : null);
  const need = 'needs 2 or more values';

  function listResults(values, note) {
    const d = ST.describe(values);
    if (!d.n) return [h('p.st-none', { dataset: { fk: 'stats-empty' }, text: note ? 'There are no numbers to work with yet.' : 'Enter some numbers to see their statistics.' })];
    const f = ST.fmt;
    const mode = d.modes.length === 0 ? 'No mode' : d.modes.length === 1 ? f(d.modes[0]) : d.modes.map(f).join(', ');
    const modeSub = d.modes.length === 0 ? 'every value appears once' : `${d.modes.length === 1 ? 'appears' : 'each appears'} ${plural(d.modeCount, 'time')}${d.modes.length > 1 ? `, so ${d.modes.length} modes` : ''}`;
    return [
      h('div.st-stats__grid', { role: 'list' },
        row('st-n', 'Count', String(d.n)), row('st-sum', 'Sum', f(d.sum)), row('st-mean', 'Mean', f(d.mean)), row('st-median', 'Median', f(d.median)),
        row('st-mode', d.modes.length > 1 ? 'Modes' : 'Mode', mode, modeSub),
        row('st-min', 'Minimum', f(d.min)), row('st-max', 'Maximum', f(d.max)), row('st-range', 'Range', f(d.range), 'maximum − minimum'),
        row('st-q1', 'Lower quartile Q1', d.q1 === null ? '—' : f(d.q1), d.q1 === null ? 'needs 2 or more values' : 'median of the lower half'),
        row('st-q3', 'Upper quartile Q3', d.q3 === null ? '—' : f(d.q3), d.q3 === null ? 'needs 2 or more values' : 'median of the upper half'),
        row('st-iqr', 'Interquartile range', d.iqr === null ? '—' : f(d.iqr), 'Q3 − Q1'),
        row('st-var-s', 'Sample variance', d.varSample === null ? '—' : f(d.varSample), d.varSample === null ? need : 'divides by n − 1'),
        row('st-sd-s', 'Sample standard deviation', d.sdSample === null ? '—' : f(d.sdSample), d.sdSample === null ? need : 'divides by n − 1'),
        row('st-var-p', 'Population variance', f(d.varPop), 'divides by n'),
        row('st-sd-p', 'Population standard deviation', f(d.sdPop), 'divides by n')),
      h('p.st-note', { text: 'Use the sample figures when your numbers are a sample of a bigger group, and the population figures when they are every value there is. Quartiles are the median of each half (the middle value is left out of both halves when the count is odd); other programs can differ slightly on small sets.' }),
      h('div.side__label', { text: `Sorted (${plural(d.n, 'value')})` }),
      h('p.st-stats__sorted', { dataset: { fk: 'stats-sorted' }, text: d.sorted.slice(0, 200).map(f).join(', ') + (d.n > 200 ? ', …' : '') }),
    ];
  }

  function pairResults(pairs, note) {
    const f = ST.fmt;
    if (!pairs.length) return [h('p.st-none', { dataset: { fk: 'stats-empty' }, text: note ? 'There are no x, y pairs to work with yet.' : 'Enter some x, y pairs to fit a line.' })];
    const fit = ST.fitLine(pairs);
    const dx = ST.describe(pairs.map(p => p[0])), dy = ST.describe(pairs.map(p => p[1]));
    const parts = [h('p.st-sum', { dataset: { fk: 'stats-pairs-n' }, text: `${plural(pairs.length, 'pair')}` })];
    if (!fit.ok) parts.push(h('div.st-issue', { role: 'alert', dataset: { fk: 'stats-nofit' } }, icon('alert'), h('span', { text: `No line of best fit: ${fit.reason}` })));
    else {
      parts.push(
        h('div.st-eq__answer', { dataset: { fk: 'stats-fit' } },
          h('small', { text: 'Line of best fit (least squares)' }),
          h('b', { dataset: { fk: 'stats-line' }, text: ST.lineText(fit) })),
        h('div.st-stats__grid', { role: 'list' },
          row('st-slope', 'Slope', f(fit.slope), 'how much y changes per 1 of x'),
          row('st-intercept', 'y-intercept', f(fit.intercept), 'where the line crosses x = 0'),
          row('st-r', 'Correlation r', fit.r === null ? 'not defined' : f(fit.r), fit.r === null ? 'every y is the same' : 'from −1 to 1'),
          row('st-r2', 'r²', fit.r2 === null ? '—' : f(fit.r2), fit.r2 === null ? '' : 'share of the change in y the line explains')));
      if (fit.note) parts.push(h('p.st-banner', { dataset: { fk: 'stats-fitnote' } }, icon('alert'), h('span', { text: fit.note })));
    }
    parts.push(h('div.st-stats__grid', { role: 'list' },
      row('st-mx', 'Mean of x', f(dx.mean)), row('st-my', 'Mean of y', f(dy.mean)),
      row('st-sdx', 'Sample std dev of x', dx.sdSample === null ? '—' : f(dx.sdSample), dx.sdSample === null ? need : ''), row('st-sdy', 'Sample std dev of y', dy.sdSample === null ? '—' : f(dy.sdSample), dy.sdSample === null ? need : '')));
    parts.push(canvas);
    S.pairs = { pairs, fit };
    return parts;
  }

  function paintResults() {
    if (S.dead) return;
    const text = ta.value;
    out.replaceChildren();
    S.pairs = null;
    if (!text.trim()) {
      out.append(h('p.st-none', { dataset: { fk: 'stats-empty' }, text: draft.mode === 'list' ? 'Enter some numbers to see their statistics.' : 'Enter some x, y pairs to fit a line.' }));
      return;
    }
    const parsed = draft.mode === 'list' ? ST.parseNumbers(text) : ST.parsePairs(text);
    const parts = [];
    if (parsed.note) parts.push(h('div.st-banner', { role: 'status', dataset: { fk: 'stats-ignored' } }, icon('alert'), h('span', { text: parsed.note })));
    parts.push(...(draft.mode === 'list' ? listResults(parsed.values, parsed.note) : pairResults(parsed.pairs, parsed.note)));
    out.append(...parts);
    if (S.pairs) { canvas.setAttribute('aria-label', plotLabel()); cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(drawPlot); }
  }
  const plotLabel = () => `Scatter plot of ${S.pairs.pairs.length} points${S.pairs.fit.ok ? ` with the line ${ST.lineText(S.pairs.fit)}` : ''}.`;

  /* ---------- the scatter plot ---------- */
  function niceTicks(lo, hi, n = 5) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
    return { ticks: out, step };
  }
  function drawPlot() {
    if (S.dead || !S.pairs || !canvas.isConnected) return;
    const { pairs, fit } = S.pairs;
    const cs = getComputedStyle(canvas);
    const col = n => cs.getPropertyValue(n).trim();
    const W = canvas.width, H = canvas.height, c = canvas.getContext('2d');
    const ml = 46, mr = 12, mt = 12, mb = 28;
    c.clearRect(0, 0, W, H);
    c.fillStyle = col('--bg-2') || '#111'; c.fillRect(0, 0, W, H);
    let xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padx = (x1 - x0) * 0.06 || 1, pady = (y1 - y0) * 0.08 || 1;
    x0 -= padx; x1 += padx; y0 -= pady; y1 += pady;
    const X = v => ml + (v - x0) / (x1 - x0) * (W - ml - mr), Y = v => H - mb - (v - y0) / (y1 - y0) * (H - mt - mb);
    c.font = '11px system-ui, sans-serif'; c.fillStyle = col('--ink-2') || '#aaa'; c.strokeStyle = col('--line-1') || '#444'; c.lineWidth = 1;
    const tx = niceTicks(x0, x1), ty = niceTicks(y0, y1);
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const v of tx.ticks) { c.beginPath(); c.moveTo(Math.round(X(v)) + .5, mt); c.lineTo(Math.round(X(v)) + .5, H - mb); c.stroke(); c.fillText(ST.fmt(v), X(v), H - mb + 6); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of ty.ticks) { c.beginPath(); c.moveTo(ml, Math.round(Y(v)) + .5); c.lineTo(W - mr, Math.round(Y(v)) + .5); c.stroke(); c.fillText(ST.fmt(v), ml - 6, Y(v)); }
    c.strokeStyle = col('--line-2') || '#777'; c.strokeRect(ml + .5, mt + .5, W - ml - mr, H - mt - mb);
    const accent = col('--accent') || '#5ea0ff';
    if (fit.ok) {
      c.strokeStyle = accent; c.lineWidth = 2; c.beginPath();
      c.moveTo(X(x0), Y(fit.slope * x0 + fit.intercept)); c.lineTo(X(x1), Y(fit.slope * x1 + fit.intercept)); c.stroke();
    }
    c.fillStyle = col('--ink-0') || '#fff'; c.strokeStyle = col('--bg-2') || '#000'; c.lineWidth = 1.5;
    for (const [x, y] of pairs.slice(0, 2000)) { c.beginPath(); c.arc(X(x), Y(y), 3.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
  }

  const demo = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'stats-example' }, onclick: () => { ta.value = draft[draft.mode] = EX[draft.mode]; paintResults(); } }, icon('plus'), h('span', { text: 'Try an example' }));
  const clearBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'stats-clear' }, onclick: () => { ta.value = draft[draft.mode] = ''; paintResults(); ta.focus(); } }, h('span', { text: 'Clear' }));
  ta.value = draft[draft.mode];
  paintTabs(); paintHint();
  host.appendChild(h('div.st-eq', h('div.app__content.st-scroll.st-quiz__pane', h('div.app__title', { text: 'Statistics' }), tabs, hint, ta, h('div.st-row', demo, clearBtn), out)));
  paintResults();
  return { open() {}, teardown() { S.dead = true; cancelAnimationFrame(S.raf); } };
}
