/* ============================================================
   study/stats.js — the Statistics tab of Static Study.

   Two modes. A list of numbers (typed, or pasted from a spreadsheet
   column) gives the count, mean, median, mode, range, quartiles and
   both the sample and the population variance and standard deviation,
   each labelled, with the working for each (the formula and the real
   numbers put into it), a histogram, a box plot (outliers by Tukey's
   1.5 × IQR fences) and the z-score of every value. Paired x, y data
   (one pair per line) adds the line of best fit with its slope,
   intercept and r, how each was worked out, and a scatter plot with
   the line; it says plainly when no line can be fitted. Anything that
   is not a number is left out and listed, never guessed at.

   A paste of several columns (Sheets and Excel copy cells as
   tab-separated lines) is read as a table: pick the column to use (or
   the x and y columns); the header row names them.

   The maths is js/core/stats.js. Here it is the form and the display;
   the charts are <canvas> drawings of the real numbers, each with the
   same figures as text beside it.
   ============================================================ */
import * as ST from '../core/stats.js';

const MODES = [['list', 'List of numbers'], ['pairs', 'Paired x, y']];
const draft = { mode: 'list', list: '', pairs: '', binw: '', zsd: 'sample' };
const EX = {
  list: '4, 8, 6, 5, 3, 8, 9, 5, 8',
  pairs: 'x,y\n1,2.1\n2,3.9\n3,6.2\n4,7.8\n5,10.1',
};
const Z_ROWS = 200;

export function mountStats(host, ctx) {
  const { api } = ctx;
  const { h, icon } = api;
  const S = { dead: false, raf: 0, cols: { key: '', list: 0, x: 0, y: 1 }, draw: [] };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const f = ST.fmt;

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
      ? 'Type or paste numbers separated by commas, spaces or new lines. A column pasted from a spreadsheet works; paste several columns and pick the one to use. Use a point for decimals (3.5), not a comma. Anything that is not a number is left out and listed.'
      : 'One pair per line: x then y, separated by a comma, space or tab (x,y). Columns pasted from a spreadsheet work too: pick the x and y columns. A line that is not exactly two numbers, such as a header, is left out and listed.';
    ta.placeholder = draft.mode === 'list' ? 'e.g. 4, 8, 6, 5, 3, 8, 9, 5, 8' : 'e.g.\n1, 2\n2, 4.1\n3, 5.9';
  }

  const row = (fk, label, value, sub) => h('div.st-stats__row', { dataset: { fk } }, h('span.st-stats__l', { text: label }), h('b.st-stats__v', { dataset: { fk: `${fk}-v` }, text: value }), sub ? h('small', { text: sub }) : null);
  const need = 'needs 2 or more values';
  const math = (fk, text) => h('div.st-eq__math', { dataset: { fk }, text });
  const z3 = z => (z === null ? '—' : f(Math.round(z * 1000) / 1000));

  /* ---------- a list of numbers ---------- */
  function listResults(values, note) {
    const d = ST.describe(values);
    if (!d.n) return [h('p.st-none', { dataset: { fk: 'stats-empty' }, text: note ? 'There are no numbers to work with yet.' : 'Enter some numbers to see their statistics.' })];
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
      ...working(d),
      ...charts(values, d),
      ...zSection(values, d),
    ];
  }

  /* the formulas, with the real numbers in them */
  function working(d) {
    const n = d.n;
    const mid = n % 2 ? [(n + 1) / 2] : [n / 2, n / 2 + 1];
    const ord = k => `${k}${k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th'}`;
    const half = Math.floor(n / 2);
    const items = [
      h('li', { dataset: { fk: 'how-mean' } }, h('p', { text: 'Mean: add the values and divide by how many there are.' }), math('how-mean-f', `x̄ = Σx ÷ n = ${f(d.sum)} ÷ ${n} = ${f(d.mean)}`)),
      h('li', { dataset: { fk: 'how-median' } }, h('p', { text: n % 2 ? `Median: with ${n} values (an odd count), it is the middle one in order, the ((n + 1) ÷ 2) = ${ord(mid[0])}.` : `Median: with ${n} values (an even count), it is halfway between the two in the middle, the ${ord(mid[0])} and the ${ord(mid[1])}.` }),
        math('how-median-f', n % 2 ? `median = ${f(d.sorted[mid[0] - 1])}` : `median = (${f(d.sorted[mid[0] - 1])} + ${f(d.sorted[mid[1] - 1])}) ÷ 2 = ${f(d.median)}`)),
      h('li', h('p', { text: 'Range: the largest value minus the smallest.' }), math('how-range-f', `range = ${f(d.max)} − ${f(d.min)} = ${f(d.range)}`)),
    ];
    if (d.q1 !== null) items.push(h('li', h('p', { text: `Quartiles: Q1 is the median of the lower ${plural(half, 'value')}, Q3 the median of the upper ${half}${n % 2 ? ' (the middle value is in neither half)' : ''}.` }),
      math('how-iqr-f', `IQR = Q3 − Q1 = ${f(d.q3)} − ${f(d.q1)} = ${f(d.iqr)}`)));
    items.push(h('li', { dataset: { fk: 'how-var' } }, h('p', { text: 'Spread: take each value’s distance from the mean, square it and add them up, Σ(x − x̄)²; divide by n − 1 for a sample (s²) or by n for a whole population (σ²); the standard deviation is the square root.' }),
      math('how-ss-f', `Σ(x − x̄)² = ${f(d.ss)}`),
      d.varSample === null ? math('how-var-s-f', `s² needs 2 or more values (n − 1 would be 0)`) : math('how-var-s-f', `s² = ${f(d.ss)} ÷ (${n} − 1) = ${f(d.varSample)},  s = √${f(d.varSample)} = ${f(d.sdSample)}`),
      math('how-var-p-f', `σ² = ${f(d.ss)} ÷ ${n} = ${f(d.varPop)},  σ = √${f(d.varPop)} = ${f(d.sdPop)}`)));
    return [h('div.side__label', { text: 'How these were worked out' }), h('ol.st-stats__how', { dataset: { fk: 'stats-how' } }, items)];
  }

  /* histogram and box plot */
  function charts(values, d) {
    const parts = [h('div.side__label', { text: 'Charts' })];
    const hg = ST.histogram(values, draft.binw);
    const binIn = h('input.st-in', { type: 'number', min: '0', step: 'any', placeholder: 'Automatic', 'aria-label': 'Bar width', style: 'width:110px', dataset: { fk: 'stats-binw' },
      onchange: e => { draft.binw = e.target.value.trim(); paintResults(); } });
    binIn.value = draft.binw;
    const histC = h('canvas', { role: 'img', width: 480, height: 260, dataset: { fk: 'stats-hist' } });
    const hist = h('div.st-stats__chart', h('b', { text: 'Histogram' }),
      h('div.st-row', h('label.st-inline', h('span.st-f__l', { text: 'Bar width' }), binIn), draft.binw ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'stats-binw-auto' }, onclick: () => { draft.binw = ''; paintResults(); } }, h('span', { text: 'Automatic' })) : null));
    if (!hg.ok) hist.append(h('p.st-issue', { role: 'alert', dataset: { fk: 'stats-hist-error' } }, icon('alert'), h('span', { text: hg.reason })));
    else {
      histC.setAttribute('aria-label', `Histogram of ${plural(d.n, 'value')} in ${plural(hg.bars.length, 'bar')} of width ${f(hg.width)}: ${hg.bars.map(b => `${f(b.lo)} to under ${f(b.hi)}: ${b.n}`).join('; ')}.`);
      hist.append(histC,
        h('p.st-note', { dataset: { fk: 'stats-hist-rule' }, text: hg.rule === 'sturges'
          ? `${plural(hg.bars.length, 'bar')} of width ${f(hg.width)}. Sturges’ rule suggests k = ⌈log₂ n⌉ + 1 = ⌈log₂ ${d.n}⌉ + 1 = ${hg.k} bars; the width is the range ÷ k = ${f(d.range)} ÷ ${hg.k}${d.range ? ` = ${f(d.range / hg.k)}` : ''}, rounded up to a round number. Each bar counts values from its left edge up to, but not including, its right edge.`
          : `${plural(hg.bars.length, 'bar')} of the width you chose, ${f(hg.width)}. Each bar counts values from its left edge up to, but not including, its right edge.` }),
        h('div.st-stats__scroll', h('table.st-stats__tbl', { dataset: { fk: 'stats-hist-table' } }, h('thead', h('tr', h('th', { text: 'From' }), h('th', { text: 'To under' }), h('th', { text: 'Count' }))),
          h('tbody', hg.bars.map(b => h('tr', h('td', { text: f(b.lo) }), h('td', { text: f(b.hi) }), h('td', { text: String(b.n) })))))));
      S.draw.push(() => drawHist(histC, hg));
    }
    const bp = ST.boxplot(values);
    const boxC = h('canvas', { role: 'img', width: 480, height: 150, dataset: { fk: 'stats-box' } });
    const box = h('div.st-stats__chart', h('b', { text: 'Box plot' }));
    if (!bp.ok) box.append(h('p.st-none', { dataset: { fk: 'stats-box-none' }, text: bp.reason }));
    else {
      const desc = `Minimum ${f(bp.min)}, Q1 ${f(bp.q1)}, median ${f(bp.median)}, Q3 ${f(bp.q3)}, maximum ${f(bp.max)}. ${bp.outliers.length ? `${plural(bp.outliers.length, 'outlier')}: ${bp.outliers.slice(0, 20).map(f).join(', ')}${bp.outliers.length > 20 ? ', …' : ''}.` : 'No outliers.'}`;
      boxC.setAttribute('aria-label', `Box plot. ${desc}`);
      box.append(boxC, h('p.st-note', { dataset: { fk: 'stats-box-text' }, text: desc }),
        h('p.st-note', { dataset: { fk: 'stats-box-rule' }, text: `An outlier is a value below Q1 − 1.5 × IQR = ${f(bp.q1)} − 1.5 × ${f(bp.iqr)} = ${f(bp.fences[0])} or above Q3 + 1.5 × IQR = ${f(bp.q3)} + 1.5 × ${f(bp.iqr)} = ${f(bp.fences[1])} (Tukey’s rule). The whiskers reach the furthest values inside those fences: ${f(bp.whiskers[0])} and ${f(bp.whiskers[1])}.` }));
      S.draw.push(() => drawBox(boxC, bp));
    }
    parts.push(h('div.st-stats__charts', hist, box));
    return parts;
  }

  /* z-scores */
  function zSection(values, d) {
    const useS = draft.zsd !== 'pop' && d.sdSample !== null;
    const sd = useS ? d.sdSample : d.sdPop;
    const sel = h('select.select.st-sel', { 'aria-label': 'Standard deviation to use', dataset: { fk: 'stats-z-sd' }, onchange: e => { draft.zsd = e.target.value; paintResults(); } },
      h('option', { value: 'sample', text: 'the sample standard deviation, s', selected: useS, disabled: d.sdSample === null }), h('option', { value: 'pop', text: 'the population standard deviation, σ', selected: !useS }));
    const zIn = h('input.st-in', { type: 'text', inputmode: 'decimal', placeholder: 'Any value', 'aria-label': 'A value to find the z-score of', style: 'width:120px', dataset: { fk: 'stats-z-in' }, oninput: () => paintOne() });
    const zOut = h('span', { role: 'status', dataset: { fk: 'stats-z-out' } });
    function paintOne() {
      const p = ST.parseNumbers(zIn.value);
      if (!zIn.value.trim()) { zOut.textContent = ''; return; }
      if (p.values.length !== 1 || p.ignored.length) { zOut.textContent = 'Type one number.'; return; }
      const x = p.values[0], z = ST.zscore(x, d.mean, sd);
      zOut.textContent = z === null ? 'Every value is the same, so the standard deviation is 0 and z is not defined.' : `z = (${f(x)} − ${f(d.mean)}) ÷ ${f(sd)} = ${z3(z)}`;
    }
    const name = useS ? 's' : 'σ';
    const parts = [h('div.side__label', { text: 'z-scores' }),
      h('p.st-note', { text: 'A z-score says how many standard deviations a value is from the mean: positive above it, negative below.' }),
      h('div.st-row', h('label.st-inline', h('span', { text: 'Using' }), sel)),
      math('stats-z-formula', `z = (x − x̄) ÷ ${name} = (x − ${f(d.mean)}) ÷ ${f(sd)}`)];
    if (!sd) { parts.push(h('p.st-none', { dataset: { fk: 'stats-z-none' }, text: 'Every value is the same, so the standard deviation is 0 and no z-score is defined.' })); return parts; }
    parts.push(h('div.st-stats__scroll', h('table.st-stats__tbl', { dataset: { fk: 'stats-z-table' } },
      h('thead', h('tr', h('th', { text: '#' }), h('th', { text: 'Value' }), h('th', { text: 'z' }))),
      h('tbody', values.slice(0, Z_ROWS).map((x, i) => { const z = ST.zscore(x, d.mean, sd); return h('tr', h('td', { text: String(i + 1) }), h('td', { text: f(x) }), h('td', { class: Math.abs(z) >= 2 ? 'is-out' : '', text: z3(z) })); })))),
      values.length > Z_ROWS ? h('small.dim', { text: `The first ${Z_ROWS} values, in the order you typed them.` }) : h('small.dim', { text: 'In the order you typed them; 2 or more standard deviations from the mean is marked.' }),
      h('div.st-row', h('label.st-inline', h('span', { text: 'z-score of' }), zIn), zOut));
    return parts;
  }

  /* ---------- paired x, y ---------- */
  function pairResults(pairs, note) {
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
    if (fit.ok) {
      parts.push(h('div.side__label', { text: 'How the line was worked out' }),
        h('ol.st-stats__how', { dataset: { fk: 'stats-how-fit' } },
          h('li', h('p', { text: 'Find the means of x and y, then add up how x and y move away from their means: Sxx = Σ(x − x̄)², Syy = Σ(y − ȳ)², Sxy = Σ(x − x̄)(y − ȳ).' }),
            math('how-means-f', `x̄ = ${f(fit.mx)},  ȳ = ${f(fit.my)}`), math('how-s-f', `Sxx = ${f(fit.sxx)},  Syy = ${f(fit.syy)},  Sxy = ${f(fit.sxy)}`)),
          h('li', h('p', { text: 'The slope is Sxy ÷ Sxx, and the line goes through the point of means (x̄, ȳ), which gives the intercept.' }),
            math('how-slope-f', `slope = ${f(fit.sxy)} ÷ ${f(fit.sxx)} = ${f(fit.slope)}`), math('how-int-f', `intercept = ȳ − slope × x̄ = ${f(fit.my)} − ${f(fit.slope)} × ${f(fit.mx)} = ${f(fit.intercept)}`)),
          h('li', h('p', { text: 'r compares how x and y move together with how much each moves.' }),
            math('how-r-f', fit.r === null ? 'r = Sxy ÷ √(Sxx × Syy) is not defined here: Syy = 0' : `r = Sxy ÷ √(Sxx × Syy) = ${f(fit.sxy)} ÷ √(${f(fit.sxx)} × ${f(fit.syy)}) = ${f(fit.r)}`))));
    }
    parts.push(canvas);
    S.pairs = { pairs, fit };
    return parts;
  }

  /* ---------- several columns pasted from a spreadsheet ---------- */
  const one = t => { const p = ST.parseNumbers(t); return p.values.length === 1 && !p.ignored.length ? p.values[0] : null; };
  function fromColumns(tbl) {
    const key = tbl.cols.map(c => c.name).join('\t');
    if (S.cols.key !== key) {
      const numeric = tbl.cols.map((c, i) => [c, i]).filter(([c]) => c.numbers > 0).map(([, i]) => i);
      S.cols = { key, list: numeric[0] ?? 0, x: numeric[0] ?? 0, y: numeric[1] ?? numeric[0] ?? Math.min(1, tbl.cols.length - 1) };
    }
    const pick = (k, label) => h('label.st-inline', h('span', { text: label }), h('select.select.st-sel', { 'aria-label': label, dataset: { fk: `stats-col-${k}` }, onchange: e => { S.cols[k] = Number(e.target.value); paintResults(); } },
      tbl.cols.map((c, i) => h('option', { value: String(i), text: `${c.name} (${plural(c.numbers, 'number')})`, selected: S.cols[k] === i }))));
    const bar = h('div.st-banner.st-row.st-stats__cols', { role: 'group', 'aria-label': 'Columns', dataset: { fk: 'stats-cols' } }, icon('grid'),
      h('span', { text: `A table pasted from a spreadsheet: ${plural(tbl.cols.length, 'column')}${tbl.header ? ', named by its first row' : ''}.` }),
      ...(draft.mode === 'list' ? [pick('list', 'Use column')] : [pick('x', 'x column'), pick('y', 'y column')]));
    const off = tbl.header ? 2 : 1;
    if (draft.mode === 'list') {
      const c = tbl.cols[S.cols.list];
      const p = ST.parseNumbers(c.cells.join('\n'));
      return { bar, values: p.values, note: p.note ? p.note.replace(/^Ignored/, `In “${c.name}”, ignored`) : '' };
    }
    const cx = tbl.cols[S.cols.x], cy = tbl.cols[S.cols.y];
    const pairs = [], ignored = [];
    cx.cells.forEach((xc, r) => {
      const x = one(xc), y = one(cy.cells[r] || '');
      if (x !== null && y !== null) { if (pairs.length < ST.MAX_VALUES) pairs.push([x, y]); }
      else if (xc || cy.cells[r]) ignored.push(`line ${r + off}`);
    });
    const note = ignored.length ? `Ignored ${plural(ignored.length, 'line')} without a number in both columns: ${ignored.slice(0, ST.MAX_SHOWN_IGNORED).join(', ')}${ignored.length > ST.MAX_SHOWN_IGNORED ? ', …' : ''}.` : '';
    return { bar, pairs, note };
  }

  function paintResults() {
    if (S.dead) return;
    const text = ta.value;
    out.replaceChildren();
    S.pairs = null;
    S.draw = [];
    if (!text.trim()) {
      out.append(h('p.st-none', { dataset: { fk: 'stats-empty' }, text: draft.mode === 'list' ? 'Enter some numbers to see their statistics.' : 'Enter some x, y pairs to fit a line.' }));
      return;
    }
    const tbl = ST.columns(text);
    const parsed = tbl ? fromColumns(tbl) : draft.mode === 'list' ? ST.parseNumbers(text) : ST.parsePairs(text);
    const parts = [];
    if (tbl) parts.push(parsed.bar);
    if (parsed.note) parts.push(h('div.st-banner', { role: 'status', dataset: { fk: 'stats-ignored' } }, icon('alert'), h('span', { text: parsed.note })));
    parts.push(...(draft.mode === 'list' ? listResults(parsed.values, parsed.note) : pairResults(parsed.pairs, parsed.note)));
    out.append(...parts);
    if (S.pairs) { canvas.setAttribute('aria-label', plotLabel()); S.draw.push(drawPlot); }
    cancelAnimationFrame(S.raf);
    if (S.draw.length) S.raf = requestAnimationFrame(() => { for (const fn of S.draw) { try { fn(); } catch (e) { console.error('[stats]', e); } } });
  }
  const plotLabel = () => `Scatter plot of ${S.pairs.pairs.length} points${S.pairs.fit.ok ? ` with the line ${ST.lineText(S.pairs.fit)}` : ''}.`;

  /* ---------- drawing ---------- */
  function niceTicks(lo, hi, n = 5) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
    return { ticks: out, step };
  }
  function pen(cv) {
    const cs = getComputedStyle(cv);
    const col = n => cs.getPropertyValue(n).trim();
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = col('--bg-2') || '#111'; c.fillRect(0, 0, cv.width, cv.height);
    c.font = '11px system-ui, sans-serif';
    return { c, col, W: cv.width, H: cv.height, accent: col('--accent') || '#5ea0ff', ink: col('--ink-2') || '#aaa', line: col('--line-1') || '#444', ink0: col('--ink-0') || '#fff' };
  }
  function drawHist(cv, hg) {
    if (S.dead || !cv.isConnected) return;
    const { c, W, H, accent, ink, line } = pen(cv);
    const ml = 36, mr = 12, mt = 12, mb = 30;
    const top = Math.max(...hg.bars.map(b => b.n));
    const x0 = hg.bars[0].lo, x1 = hg.bars[hg.bars.length - 1].hi;
    const X = v => ml + (v - x0) / (x1 - x0) * (W - ml - mr), Y = v => H - mb - v / top * (H - mt - mb);
    c.strokeStyle = line; c.fillStyle = ink; c.lineWidth = 1;
    const yt = niceTicks(0, top, 4).ticks.filter(v => Number.isInteger(v));
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of yt) { c.beginPath(); c.moveTo(ml, Math.round(Y(v)) + .5); c.lineTo(W - mr, Math.round(Y(v)) + .5); c.stroke(); c.fillText(String(v), ml - 6, Y(v)); }
    c.fillStyle = accent;
    for (const b of hg.bars) if (b.n) c.fillRect(X(b.lo) + 1, Y(b.n), Math.max(1, X(b.hi) - X(b.lo) - 2), Y(0) - Y(b.n));
    c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'top';
    const every = Math.ceil(hg.bars.length / 10);
    hg.bars.forEach((b, i) => { if (i % every === 0) c.fillText(ST.fmt(b.lo), X(b.lo), H - mb + 6); });
    c.fillText(ST.fmt(x1), X(x1), H - mb + 6);
  }
  function drawBox(cv, bp) {
    if (S.dead || !cv.isConnected) return;
    const { c, W, H, accent, ink, line, ink0 } = pen(cv);
    const ml = 16, mr = 16, mb = 28;
    const lo = bp.min, hi = bp.max;
    const t = niceTicks(lo, hi);
    const a = Math.min(lo, t.ticks[0]), z = Math.max(hi, t.ticks[t.ticks.length - 1]);
    const X = v => ml + (v - a) / ((z - a) || 1) * (W - ml - mr);
    const mid = (H - mb) / 2 + 6, bh = 34;
    c.strokeStyle = line; c.fillStyle = ink; c.lineWidth = 1; c.textAlign = 'center'; c.textBaseline = 'top';
    c.beginPath(); c.moveTo(ml, H - mb + .5); c.lineTo(W - mr, H - mb + .5); c.stroke();
    for (const v of t.ticks) { c.beginPath(); c.moveTo(Math.round(X(v)) + .5, H - mb); c.lineTo(Math.round(X(v)) + .5, H - mb + 4); c.stroke(); c.fillText(ST.fmt(v), X(v), H - mb + 7); }
    c.strokeStyle = ink0; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(X(bp.whiskers[0]), mid); c.lineTo(X(bp.q1), mid); c.moveTo(X(bp.q3), mid); c.lineTo(X(bp.whiskers[1]), mid);
    c.moveTo(X(bp.whiskers[0]), mid - 9); c.lineTo(X(bp.whiskers[0]), mid + 9); c.moveTo(X(bp.whiskers[1]), mid - 9); c.lineTo(X(bp.whiskers[1]), mid + 9); c.stroke();
    c.fillStyle = accent; c.globalAlpha = 0.35; c.fillRect(X(bp.q1), mid - bh / 2, Math.max(1, X(bp.q3) - X(bp.q1)), bh); c.globalAlpha = 1;
    c.strokeStyle = accent; c.lineWidth = 2; c.strokeRect(X(bp.q1), mid - bh / 2, Math.max(1, X(bp.q3) - X(bp.q1)), bh);
    c.strokeStyle = ink0; c.beginPath(); c.moveTo(X(bp.median), mid - bh / 2); c.lineTo(X(bp.median), mid + bh / 2); c.stroke();
    c.fillStyle = ink0;
    for (const o of bp.outliers.slice(0, 500)) { c.beginPath(); c.arc(X(o), mid, 3.5, 0, Math.PI * 2); c.fill(); }
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
  /* data handed over by another app (Static Sheets' Send to Statistics) says where it came from */
  const from = h('p.st-note', { dataset: { fk: 'stats-from' }, hidden: true });
  host.appendChild(h('div.st-eq', h('div.app__content.st-scroll.st-quiz__pane', h('div.app__title', { text: 'Statistics' }), tabs, from, hint, ta, h('div.st-row', demo, clearBtn), out)));
  paintResults();
  /** open({ stats: { mode: 'list'|'pairs', text, from? } }): put that data in, as if it had been pasted */
  function open(o) {
    const d = o && o.stats;
    if (!d || typeof d.text !== 'string' || !MODES.some(m => m[0] === d.mode)) return;
    draft.mode = d.mode;
    draft[d.mode] = d.text.slice(0, 200000);
    ta.value = draft[d.mode];
    from.textContent = typeof d.from === 'string' && d.from ? `From Static Sheets: ${d.from.slice(0, 80)}` : '';
    from.hidden = !from.textContent;
    paintTabs(); paintHint(); paintResults();
  }
  return { open, teardown() { S.dead = true; cancelAnimationFrame(S.raf); } };
}
