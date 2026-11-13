/* ============================================================
   js/sheets/chart.js — bar, line and pie charts on a <canvas>.

   chartData(book, sid, range, show) reads a range the way people lay
   data out: a text column on the left names the categories, a text
   row on top names the series, every other column of numbers is a
   series. One or two rows of numbers across are read sideways.

   drawChart(ctx, w, h, spec, theme) paints it and returns the layout
   (where each category sits) so the app can put a tooltip on hover.

   Look (the dataviz rules): series colours come from the --chart-1…8
   tokens in fixed order, never cycled past 8 (the rest fold away);
   text is drawn in ink tokens, never in a series colour; one y-axis;
   a recessive grid; bars have 4px rounded ends on the value side and
   a 2px gap; lines are 2px with 8px markers; a legend whenever there
   are two or more series (a single series is named by the title); the
   pie's legend carries each slice's share as text.
   ============================================================ */

export const TYPES = ['bar', 'line', 'pie'];
export const TYPE_NAMES = { bar: 'Bar', line: 'Line', pie: 'Pie' };
const MAX_SERIES = 8;
const MAX_CATS = 400;

const isText = v => typeof v === 'string' && v.trim() !== '';

/** → { labels: [text], series: [{ name, values: [number|null] }], note? } */
export function chartData(book, sid, g, show) {
  const ext = book.extentOf(sid);
  const r2 = Math.min(g.r2, ext.r), c2 = Math.min(g.c2, ext.c);
  if (r2 < g.r1 || c2 < g.c1) return { labels: [], series: [] };
  const rows = r2 - g.r1 + 1, cols = c2 - g.c1 + 1;
  /* read sideways when the data runs across: one row of numbers, or a
     row of names over one row of numbers */
  const across = rows <= 2 && cols > rows;
  const R = across ? cols : rows, C = across ? rows : cols;
  const at = (i, j) => (across ? { r: g.r1 + j, c: g.c1 + i } : { r: g.r1 + i, c: g.c1 + j });
  const V = (i, j) => { const p = at(i, j); return book.valueIn(sid, p.r, p.c); };
  const S = (i, j) => { const p = at(i, j); return show(p.r, p.c); };

  /* a header (names the series) when the first entry of a value column is text */
  const head = R >= 2 && [...Array(C).keys()].some(j => isText(V(0, j)) && [...Array(R - 1).keys()].some(i => typeof V(i + 1, j) === 'number'));
  const start = head ? 1 : 0;
  /* a label column when the first column is mostly text */
  let textN = 0, filled = 0;
  for (let i = start; i < R; i++) { const v = V(i, 0); if (v != null && v !== '') { filled++; if (isText(v)) textN++; } }
  const labelCol = C >= 2 && filled > 0 && textN * 2 >= filled;
  const first = labelCol ? 1 : 0;

  const n = Math.min(R - start, MAX_CATS);
  const labels = [];
  for (let i = 0; i < n; i++) {
    labels.push(labelCol ? S(start + i, 0) : across ? colLetters(g.c1 + start + i) : String(g.r1 + start + i + 1));
  }
  const series = [];
  for (let j = first; j < C; j++) {
    const values = [];
    let nums = 0;
    for (let i = 0; i < n; i++) { const v = V(start + i, j); if (typeof v === 'number' && Number.isFinite(v)) { values.push(v); nums++; } else values.push(null); }
    if (!nums) continue;
    const p = at(0, j);
    series.push({ name: head && isText(V(0, j)) ? S(0, j) : across ? `Row ${p.r + 1}` : `Column ${colLetters(p.c)}`, values });
  }
  const folded = series.length > MAX_SERIES ? series.length - MAX_SERIES : 0;
  return {
    labels, series: series.slice(0, MAX_SERIES),
    labelHead: labelCol && head ? S(0, 0) : '',
    note: [R - start > MAX_CATS ? `first ${MAX_CATS} of ${R - start} rows` : '', folded ? `${folded} more series not shown` : ''].filter(Boolean).join(' · '),
  };
}
function colLetters(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** colours and fonts from the page's tokens, read where the chart lives */
export function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
  const colors = [];
  for (let i = 1; i <= MAX_SERIES; i++) colors.push(v(`--chart-${i}`, '#3987e5'));
  return {
    colors,
    surface: v('--chart-surface', '#130709'),
    ink0: v('--ink-0', '#f6eef1'), ink1: v('--ink-1', '#e4d8dd'), ink2: v('--ink-2', '#a79aa0'),
    line: v('--line-1', 'rgba(255,255,255,.08)'), axis: v('--line-2', 'rgba(255,255,255,.12)'),
    font: v('--font', 'system-ui, sans-serif'),
  };
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
function tickText(v, step) {
  if (Math.abs(v) >= 10000) return compact.format(v);
  const dp = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(dp);
}
function niceTicks(lo, hi) {
  if (lo === hi) { if (lo === 0) hi = 1; else if (lo > 0) lo = 0; else hi = 0; }
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let t = a; t <= b + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { ticks, step, min: a, max: b };
}
function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
/** a bar with 4px rounded corners on its value end only */
function bar(g, x, y0, w, y1, rad) {
  const up = y1 < y0, h = Math.abs(y1 - y0);
  const r = Math.min(rad, w / 2, h);
  g.beginPath();
  if (up) {
    g.moveTo(x, y0); g.lineTo(x, y1 + r); g.quadraticCurveTo(x, y1, x + r, y1);
    g.lineTo(x + w - r, y1); g.quadraticCurveTo(x + w, y1, x + w, y1 + r); g.lineTo(x + w, y0);
  } else {
    g.moveTo(x, y0); g.lineTo(x, y1 - r); g.quadraticCurveTo(x, y1, x + r, y1);
    g.lineTo(x + w - r, y1); g.quadraticCurveTo(x + w, y1, x + w, y1 - r); g.lineTo(x + w, y0);
  }
  g.closePath();
  g.fill();
}

/** Paint the chart. Returns { kind, cats:[{ x0, x1, label, values }], slices? } */
export function drawChart(g, W, H, spec, T) {
  const { type, title, data } = spec;
  const font = (px, weight = 500) => `${weight} ${px}px ${T.font}`;
  g.save();
  g.fillStyle = T.surface;
  g.fillRect(0, 0, W, H);
  const pad = 14;
  let top = pad;
  if (title) {
    g.font = font(13, 650); g.fillStyle = T.ink0; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(fit(g, title, W - pad * 2), pad, top);
    top += 22;
  }
  const out = { kind: type, cats: [], slices: [] };
  const series = data.series || [];
  const message = text => {
    g.font = font(12); g.fillStyle = T.ink2; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(fit(g, text, W - pad * 2), W / 2, (top + H) / 2);
    g.restore();
    return out;
  };
  if (!series.length || !data.labels.length) return message('No numbers in this range to chart');

  /* ---------------- pie ---------------- */
  if (type === 'pie') {
    const s = series[0];
    const parts = data.labels.map((label, i) => ({ label, v: s.values[i], i })).filter(p => p.v != null && p.v > 0);
    const total = parts.reduce((a, p) => a + p.v, 0);
    if (!total) return message('A pie needs positive numbers');
    const shown = parts.slice(0, 7);
    if (parts.length > 7) shown.push({ label: `Other (${parts.length - 7})`, v: parts.slice(7).reduce((a, p) => a + p.v, 0), i: -1 });
    const legendW = Math.min(Math.max(120, W * 0.42), 220);
    const R = Math.max(10, Math.min((W - pad * 3 - legendW) / 2, (H - top - pad) / 2));
    const cx = pad + R, cy = top + (H - top - pad) / 2;
    let a = -Math.PI / 2;
    shown.forEach((p, k) => {
      const sweep = (p.v / total) * Math.PI * 2;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a, a + sweep); g.closePath();
      g.fillStyle = T.colors[k % T.colors.length]; g.fill();
      g.lineWidth = 2; g.strokeStyle = T.surface; g.stroke();          /* 2px surface gap between slices */
      out.slices.push({ a0: a, a1: a + sweep, label: p.label, v: p.v, share: p.v / total });
      a += sweep;
    });
    out.pie = { cx, cy, R };
    /* legend: colour chip, name, share as text */
    const lx = cx + R + pad * 1.5;
    const rowH = 18;
    let ly = cy - (shown.length * rowH) / 2 + rowH / 2;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    shown.forEach((p, k) => {
      g.fillStyle = T.colors[k % T.colors.length];
      g.beginPath(); g.arc(lx + 5, ly, 5, 0, Math.PI * 2); g.fill();
      const pct = `${Math.round((p.v / total) * 1000) / 10}%`;
      g.font = font(11, 650); g.fillStyle = T.ink0;
      const pw = g.measureText(pct).width;
      g.fillText(pct, W - pad - pw, ly);
      g.font = font(11); g.fillStyle = T.ink1;
      g.fillText(fit(g, p.label, W - pad - pw - 8 - (lx + 16)), lx + 16, ly);
      ly += rowH;
    });
    g.restore();
    return out;
  }

  /* ---------------- bar / line ---------------- */
  const cats = data.labels.length;
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.values) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (type === 'bar') { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  const { ticks, step, min, max } = niceTicks(lo, hi);

  /* legend row (two or more series) */
  if (series.length > 1) {
    g.font = font(11); g.textBaseline = 'middle'; g.textAlign = 'left';
    let x = pad, y = top + 6;
    series.forEach((s, k) => {
      const name = fit(g, s.name, 140);
      const w = 14 + g.measureText(name).width + 14;
      if (x + w > W - pad && x > pad) { x = pad; y += 16; }
      g.fillStyle = T.colors[k];
      if (type === 'line') g.fillRect(x, y - 1, 10, 2); else g.fillRect(x, y - 4, 8, 8);
      g.fillStyle = T.ink1;
      g.fillText(name, x + 14, y);
      x += w;
    });
    top = y + 14;
  }

  g.font = font(10);
  const yLabW = Math.max(...ticks.map(t => g.measureText(tickText(t, step)).width)) + 8;
  const left = pad + yLabW, right = W - pad;
  const bottom = H - pad - 16;
  const plotH = Math.max(10, bottom - top - 6), plotTop = bottom - plotH;
  const y = v => plotTop + (1 - (v - min) / (max - min || 1)) * plotH;

  /* grid + y labels */
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const t of ticks) {
    const yy = Math.round(y(t)) + 0.5;
    g.strokeStyle = t === 0 ? T.axis : T.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(left, yy); g.lineTo(right, yy); g.stroke();
    g.fillStyle = T.ink2;
    g.fillText(tickText(t, step), left - 6, yy);
  }

  /* x labels: every k-th when they would collide */
  const band = (right - left) / cats;
  g.font = font(10); g.textAlign = 'center'; g.textBaseline = 'top';
  const widest = Math.max(...data.labels.map(l => Math.min(110, g.measureText(l).width))) + 8;
  const every = Math.max(1, Math.ceil(widest / band));
  for (let i = 0; i < cats; i++) {
    out.cats.push({ x0: left + i * band, x1: left + (i + 1) * band, label: data.labels[i], values: series.map(s => ({ name: s.name, v: s.values[i] })) });
    if (i % every) continue;
    g.fillStyle = T.ink2;
    g.fillText(fit(g, data.labels[i], Math.max(band * every - 6, 24)), left + (i + 0.5) * band, bottom + 4);
  }

  const zero = y(Math.max(min, Math.min(max, 0)));
  if (type === 'bar') {
    const groupW = band * 0.78;
    const gap = series.length > 1 ? 2 : 0;
    const bw = Math.max(1, (groupW - gap * (series.length - 1)) / series.length);
    series.forEach((s, k) => {
      g.fillStyle = T.colors[k];
      s.values.forEach((v, i) => {
        if (v == null || v === 0) return;
        const x = left + i * band + (band - groupW) / 2 + k * (bw + gap);
        bar(g, x, zero, bw, y(v), 4);
      });
    });
  } else {
    series.forEach((s, k) => {
      g.strokeStyle = T.colors[k]; g.lineWidth = 2; g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const x = left + (i + 0.5) * band, yy = y(v);
        if (pen) g.lineTo(x, yy); else g.moveTo(x, yy);
        pen = true;
      });
      g.stroke();
      if (cats <= 60) {
        s.values.forEach((v, i) => {
          if (v == null) return;
          const x = left + (i + 0.5) * band, yy = y(v);
          g.beginPath(); g.arc(x, yy, 4, 0, Math.PI * 2);
          g.fillStyle = T.colors[k]; g.fill();
          g.lineWidth = 2; g.strokeStyle = T.surface; g.stroke();       /* 2px surface ring */
        });
      }
    });
  }
  out.plot = { left, right, top: plotTop, bottom };
  g.restore();
  return out;
}

/** one sentence a screen reader can read in place of the picture */
export function describe(spec, fmt = v => String(v)) {
  const { type, title, data } = spec;
  const kind = `${TYPE_NAMES[type] || 'Bar'} chart`;
  if (!data.series.length || !data.labels.length) return `${kind}${title ? ` “${title}”` : ''}: no numbers in its range.`;
  const s = data.series;
  const pts = data.labels.slice(0, 12).map((l, i) => `${l} ${s.slice(0, 3).map(x => (x.values[i] == null ? '—' : fmt(x.values[i]))).join(' / ')}`);
  return `${kind}${title ? ` “${title}”` : ''}, ${s.length === 1 ? s[0].name : s.map(x => x.name).join(', ')}: ${pts.join('; ')}${data.labels.length > 12 ? `; and ${data.labels.length - 12} more` : ''}.`;
}

export default { TYPES, TYPE_NAMES, chartData, readTheme, drawChart, describe };
