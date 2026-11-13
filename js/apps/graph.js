/* ============================================================
   graph.js — Static Graph: a graphing calculator.

   Type one or more functions of x and see them plotted together on
   a <canvas>, each in its own colour, over a grid with labelled axes.

   DESIGN
   · A hand-written expression parser — NO eval(), NO Function(). The
     source is tokenised (numbers, identifiers, the operators
     + - * / ^ %, parentheses) and parsed by recursive descent into a
     tree of tiny closures, one per node, so evaluating f(x) is just a
     chain of function calls with correct precedence:
        + −   (lowest)
        × ÷ %  and implicit multiply (2x, 2sin(x), (x+1)(x-1))
        unary − +
        ^      (right-associative, so 2^-3 and -x^2 read as written)
     Known functions: sin cos tan asin acos atan sqrt abs log ln exp
     floor ceil round.  Constants: pi, e.  Anything else is a clearly
     reported error on THAT function only — the others keep plotting.

   · The canvas is sized to its container × devicePixelRatio and the
     context is scaled by the ratio, so everything is crisp on retina.
     The view is stored as a centre (cx,cy) and an x-span; the y-span is
     derived from the aspect ratio, which keeps the grid square (a
     circle looks round) through pan, zoom and window resize.

   · Curves are sampled once per CSS pixel column. A sample that isn't
     finite lifts the pen (so sqrt(x) simply stops at 0); a huge jump
     that flips sign is treated as an asymptote and the pen lifts there
     too, so 1/x and tan(x) don't get a vertical line drawn through the
     blow-up.

   · Pan by dragging, zoom with the wheel or the + / − buttons (both
     centred where you point / on the view), and a reset returns to the
     start.  Arrow keys pan and +/−/0 zoom when the plot has focus.
     "Save PNG" writes a real image into ~/Pictures via media.js.

   Every number on screen is measured from the real view or computed
   from the real expression. Nothing is faked.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as GM from '../core/graphmath.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-graph-css')) {
  const l = document.createElement('link');
  l.id = 'feat-graph-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-graph.css';
  document.head.appendChild(l);
}

/* distinct series colours, readable on both the dark and light shells */
const PALETTE = ['#ff5d7a', '#4d9bff', '#25c281', '#f0a020', '#a879ff', '#ff7a45', '#17b3c9', '#e254a6'];

/* ---- number formatting for ticks and readouts --------------------- */
function niceStep(raw) {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return s * mag;
}
function decimalsFor(step) {
  if (step >= 1) return 0;
  return Math.min(8, Math.max(0, -Math.floor(Math.log10(step))));
}
function fmtTick(v, dec) {
  if (Object.is(v, -0)) v = 0;
  let s = v.toFixed(dec);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
function fmtNum(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-4)) return v.toExponential(2);
  return String(Number(v.toPrecision(5)));
}

defineApp({
  id: 'graph',
  name: 'Static Graph',
  icon: 'trending-up',
  g1: '#5ea0ff', g2: '#7b3ff2',
  category: 'Productivity',
  keywords: ['graph', 'graphing', 'calculator', 'plot', 'function', 'math', 'equation', 'chart',
    'curve', 'sine', 'parabola', 'trig', 'desmos', 'x', 'y', 'polar', 'parametric', 'intersection', 'table of values'],
  desc: 'Plot functions, polar and parametric curves on a pannable, zoomable grid, with tables and intersections',
  singleton: false,
  win: { w: 860, h: 560, minW: 380, minH: 380 },

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, notify } = api;

    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ---------------- state ---------------- */
    const KEY = 'portal.graph';
    const DEFAULTS = [
      { expr: 'sin(x)', on: true, ci: 0 },
      { expr: 'x^2 - 3', on: true, ci: 1 },
    ];
    let dead = false;
    let rafId = 0;

    /* load persisted functions, defensively */
    function load() {
      const saved = store.get(KEY, null);
      const arr = saved && Array.isArray(saved.fns) ? saved.fns : null;
      const src = arr && arr.length ? arr : DEFAULTS;
      const str = v => (typeof v === 'string' ? v.slice(0, GM.MAX_EXPR) : '');
      return src.slice(0, 12).map((f, i) => makeFn({
        kind: GM.KINDS.some(k => k[0] === f.kind) ? f.kind : 'y',
        expr: str(f.expr), expr2: str(f.expr2), tmin: str(f.tmin), tmax: str(f.tmax),
      }, f.on !== false, Number.isInteger(f.ci) ? f.ci : i));
    }
    function nextColor() {
      const used = new Set(S.fns.map(f => f.ci));
      for (let i = 0; i < 999; i++) if (!used.has(i % PALETTE.length) || i >= PALETTE.length) return i % PALETTE.length;
      return 0;
    }
    function colorOf(ci) { return PALETTE[((ci % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

    function makeFn(spec, on, ci) {
      const f = { kind: spec.kind || 'y', expr: spec.expr || '', expr2: spec.expr2 || '', tmin: spec.tmin || '', tmax: spec.tmax || '', on: !!on, ci, curve: null, error: '', els: null };
      recompile(f);
      return f;
    }
    /* the safe parser (js/core/graphmath.js) turns the text into a curve, or says what is wrong */
    function recompile(f) {
      f.curve = GM.makeCurve(f);
      f.error = f.curve.ok || f.curve.empty ? '' : f.curve.error;
      S.inter = null;
    }

    const S = {
      fns: [],
      view: { cx: 0, cy: 0, spanX: 20 },
      cssW: 1, cssH: 1, dpr: 1,
      drag: null,        /* { id, x, y, moved } */
      hover: null,       /* { x, y } world coords, or null */
      panel: '',         /* '' | 'table' | 'inter' */
      inter: null,       /* { points, capped } for the curves as they are, or null */
      tbl: { i: 0, kind: '', from: '0', step: '1', rows: '11' },
    };
    S.fns = load();
    S.inter = null;

    function persist() {
      /* store.set only takes NEW arrays/objects — always build fresh */
      store.set(KEY, { fns: S.fns.map(f => ({ kind: f.kind, expr: f.expr, expr2: f.expr2, tmin: f.tmin, tmax: f.tmax, on: f.on, ci: f.ci })) });
    }

    /* ---------------- DOM ---------------- */
    const listEl = h('div.graph__list', { role: 'list', 'aria-label': 'Functions' });
    const addBtn = h('button.btn.btn--sm.graph__add', {
      type: 'button', onclick: () => addFunction(),
    }, icon('plus'), h('span', { text: 'Add function' }));

    const side = h('aside.graph__side.app__side.app__side--wide',
      h('div.graph__sidehd',
        h('div.side__label', { text: 'Functions' }),
        addBtn),
      listEl,
      h('div.graph__help',
        h('b', { text: 'Syntax' }),
        h('p', { text: 'Write y in terms of x, or pick r = f(t) for a polar curve, or x(t), y(t) for a parametric one. Operators + − * / ^ % and ( ). Implicit ×, e.g. 2x or 2sin(x).' }),
        h('p', { text: 'Functions: sin cos tan asin acos atan sqrt abs log ln exp floor ceil round.' }),
        h('p', { text: 'Constants: pi, e. Angles are in radians. In polar and parametric curves the variable is t (θ is read as theta).' })));

    const canvas = h('canvas.graph__canvas', { 'aria-label': 'Function plot', role: 'img', tabindex: '0' });
    const cvCtx = canvas.getContext('2d');

    const ctrls = h('div.graph__ctrls',
      h('button.ibtn.graph__cbtn', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => zoomBy(0.8) }, icon('plus')),
      h('button.ibtn.graph__cbtn', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => zoomBy(1.25) }, icon('minus')),
      h('button.ibtn.graph__cbtn', { type: 'button', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => resetView() }, icon('rotate-ccw')));

    const stage = h('div.graph__stage', canvas, ctrls);

    const rangeX = h('span.graph__rv');
    const rangeY = h('span.graph__rv');
    const cursorEl = h('span.graph__cursor', { 'aria-hidden': 'true' });
    const pbtn = (id, label, ic) => h('button.btn.btn--sm.graph__pbtn', { type: 'button', 'aria-pressed': 'false', dataset: { fk: `g-${id}` }, onclick: () => togglePanel(id) }, icon(ic), h('span', { text: label }));
    const tableBtn = pbtn('table', 'Table', 'table');
    const interBtn = pbtn('inter', 'Intersections', 'activity');
    const bar = h('div.graph__bar.app__bar',
      h('span.graph__rlabel', { text: 'x' }), rangeX,
      h('span.graph__rlabel', { text: 'y' }), rangeY,
      h('span.graph__spacer'),
      tableBtn, interBtn,
      cursorEl);
    const panelEl = h('section.graph__panel', { hidden: true, 'aria-label': 'Table and intersections', dataset: { fk: 'g-panel' } });

    const main = h('div.graph__main.app__main', bar, stage, panelEl);
    const appEl = h('div.app.graph', side, main);
    root.appendChild(appEl);

    win.setTools(
      h('button.ibtn.tip', { 'data-tip': 'Reset view', 'aria-label': 'Reset view', onclick: () => resetView() }, icon('maximize')),
      h('button.ibtn.tip', { 'data-tip': 'Save as PNG', 'aria-label': 'Save plot as PNG', onclick: () => savePng() }, icon('download')),
    );

    /* ---------------- function rows ---------------- */
    function renderList() {
      clear(listEl);
      S.fns.forEach((f, idx) => {
        const col = colorOf(f.ci);
        const n = idx + 1;
        const changed = () => { recompile(f); paintRow(f); schedule(); persist(); refreshPanel(); };
        const field = (key, label, ph, eq) => h('div.graph__fnmain',
          h('span.graph__eq', { text: eq }),
          h('input.graph__input', {
            type: 'text', value: f[key], spellcheck: 'false', autocapitalize: 'off', maxlength: String(GM.MAX_EXPR),
            autocomplete: 'off', autocorrect: 'off', 'aria-label': label, placeholder: ph, dataset: { fk: `g-${key}-${n}` },
            oninput: e => { f[key] = e.target.value; changed(); },
          }));
        const input = f.kind === 'y' ? field('expr', `Function ${n}`, 'e.g. sin(x)', 'y=')
          : f.kind === 'polar' ? field('expr', `Function ${n} r of t`, 'e.g. 1 + cos(t)', 'r=')
            : field('expr', `Function ${n} x of t`, 'e.g. cos(t)', 'x=');
        const errEl = h('div.graph__err', { role: 'status' });
        const swatch = h('button.graph__swatch', {
          type: 'button', 'aria-pressed': String(f.on),
          'aria-label': f.on ? `Hide function ${n}` : `Show function ${n}`,
          title: f.on ? 'Hide' : 'Show',
          onclick: () => { f.on = !f.on; S.inter = null; paintRow(f); schedule(); persist(); refreshPanel(); },
          style: { '--fc': col },
        });
        const del = h('button.ibtn.graph__del', {
          type: 'button', 'aria-label': `Remove function ${n}`, title: 'Remove',
          onclick: () => removeFunction(f),
        }, icon('x'));
        const kind = h('select.select.graph__kind', {
          'aria-label': `Function ${n} type`, dataset: { fk: `g-kind-${n}` },
          onchange: e => { f.kind = e.target.value; renderList(); recompile(f); paintRow(f); schedule(); persist(); refreshPanel(); },
        }, GM.KINDS.map(([v, l]) => h('option', { value: v, text: l, selected: v === f.kind })));
        const top = h('div.graph__fnmain', swatch, kind, del);
        const extra = f.kind === 'y' ? [] : [
          f.kind === 'param' ? field('expr2', `Function ${n} y of t`, 'e.g. sin(t)', 'y=') : null,
          h('div.graph__trange',
            h('label', h('span', { text: 't from' }), h('input.graph__input', { type: 'text', value: f.tmin, placeholder: '0', spellcheck: 'false', maxlength: '40', 'aria-label': `Function ${n} t from`, dataset: { fk: `g-tmin-${n}` }, oninput: e => { f.tmin = e.target.value; changed(); } })),
            h('label', h('span', { text: 'to' }), h('input.graph__input', { type: 'text', value: f.tmax, placeholder: '2pi', spellcheck: 'false', maxlength: '40', 'aria-label': `Function ${n} t to`, dataset: { fk: `g-tmax-${n}` }, oninput: e => { f.tmax = e.target.value; changed(); } }))),
        ];
        const row = h('div.graph__fn', { role: 'listitem', dataset: { kind: f.kind } }, top, input, ...extra, errEl);
        f.els = { row, input: input.querySelector('input'), errEl, swatch };
        listEl.appendChild(row);
        paintRow(f);
      });
    }
    function paintRow(f) {
      if (!f.els) return;
      f.els.swatch.classList.toggle('is-off', !f.on);
      f.els.swatch.setAttribute('aria-pressed', String(f.on));
      f.els.row.classList.toggle('has-err', !!f.error && !!f.expr.trim());
      if (f.error && f.expr.trim()) { f.els.errEl.textContent = f.error; f.els.errEl.hidden = false; }
      else { f.els.errEl.textContent = ''; f.els.errEl.hidden = true; }
    }
    function addFunction() {
      if (S.fns.length >= 12) { notify({ app: 'Static Graph', icon: 'trending-up', title: 'That is plenty', message: 'Up to 12 functions at once.' }); return; }
      const f = makeFn({ kind: 'y' }, true, nextColor());
      S.fns.push(f);
      renderList();
      f.els?.input.focus();
      persist();
      schedule();
    }
    function removeFunction(f) {
      const i = S.fns.indexOf(f);
      if (i < 0) return;
      S.fns.splice(i, 1);
      S.inter = null;
      if (!S.fns.length) S.fns.push(makeFn({ kind: 'y' }, true, 0));
      renderList();
      persist();
      schedule();
    }

    /* ---------------- view maths ---------------- */
    const spanY = () => S.view.spanX * (S.cssH / S.cssW || 1);
    function bounds() {
      const sx = S.view.spanX, sy = spanY();
      return { xmin: S.view.cx - sx / 2, xmax: S.view.cx + sx / 2, ymin: S.view.cy - sy / 2, ymax: S.view.cy + sy / 2, sx, sy };
    }
    function resetView() {
      S.view = { cx: 0, cy: 0, spanX: 20 };
      schedule();
    }
    function zoomAt(px, py, factor) {
      const b = bounds();
      const wx = b.xmin + (px / S.cssW) * b.sx;
      const wy = b.ymin + ((S.cssH - py) / S.cssH) * b.sy;
      let span = S.view.spanX * factor;
      span = Math.max(1e-6, Math.min(1e9, span));
      const applied = span / S.view.spanX;
      S.view.cx = wx + (S.view.cx - wx) * applied;
      S.view.cy = wy + (S.view.cy - wy) * applied;
      S.view.spanX = span;
      schedule();
    }
    function zoomBy(factor) { zoomAt(S.cssW / 2, S.cssH / 2, factor); }

    /* ---------------- drawing ---------------- */
    function schedule() {
      if (dead || rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; draw(); });
    }

    function readColors() {
      const cs = getComputedStyle(root);
      const g = (n, fb) => { const v = cs.getPropertyValue(n).trim(); return v || fb; };
      return {
        bg: g('--bg-2', '#130709'),
        grid: g('--line-1', 'rgba(255,255,255,.08)'),
        gridStrong: g('--line-2', 'rgba(255,255,255,.14)'),
        axis: g('--ink-3', '#7d7379'),
        label: g('--ink-2', '#a79aa0'),
      };
    }

    function draw() {
      if (dead) return;
      const c = cvCtx, W = S.cssW, H = S.cssH, dpr = S.dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const col = readColors();
      c.fillStyle = col.bg;
      c.fillRect(0, 0, W, H);

      const b = bounds();
      const X = wx => ((wx - b.xmin) / b.sx) * W;
      const Y = wy => H - ((wy - b.ymin) / b.sy) * H;
      const pxPerUnit = W / b.sx;                 /* == H / b.sy (square) */
      const step = niceStep(72 / pxPerUnit);
      const dec = decimalsFor(step);

      /* --- grid --- */
      c.lineWidth = 1;
      c.strokeStyle = col.grid;
      c.beginPath();
      for (let gx = Math.ceil(b.xmin / step) * step; gx <= b.xmax + step * 0.5; gx += step) {
        const px = Math.round(X(gx)) + 0.5;
        c.moveTo(px, 0); c.lineTo(px, H);
      }
      for (let gy = Math.ceil(b.ymin / step) * step; gy <= b.ymax + step * 0.5; gy += step) {
        const py = Math.round(Y(gy)) + 0.5;
        c.moveTo(0, py); c.lineTo(W, py);
      }
      c.stroke();

      /* --- axes --- */
      const axX = X(0), axY = Y(0);
      const showVAxis = 0 >= b.xmin && 0 <= b.xmax;
      const showHAxis = 0 >= b.ymin && 0 <= b.ymax;
      c.lineWidth = 1.4;
      c.strokeStyle = col.gridStrong;
      c.beginPath();
      if (showVAxis) { const p = Math.round(axX) + 0.5; c.moveTo(p, 0); c.lineTo(p, H); }
      if (showHAxis) { const p = Math.round(axY) + 0.5; c.moveTo(0, p); c.lineTo(W, p); }
      c.stroke();

      /* --- tick labels --- */
      c.fillStyle = col.label;
      c.font = "10px 'Inter', system-ui, -apple-system, sans-serif";
      c.textAlign = 'center'; c.textBaseline = 'top';
      const yBase = showHAxis ? Math.min(H - 12, Math.max(2, axY + 3)) : H - 13;
      for (let gx = Math.ceil(b.xmin / step) * step; gx <= b.xmax + step * 0.5; gx += step) {
        if (Math.abs(gx) < step * 0.25) continue;            /* skip 0 — drawn once at origin */
        c.fillText(fmtTick(gx, dec), X(gx), yBase);
      }
      c.textAlign = 'right'; c.textBaseline = 'middle';
      const xBase = showVAxis ? Math.min(W - 4, Math.max(28, axX - 6)) : W - 4;
      for (let gy = Math.ceil(b.ymin / step) * step; gy <= b.ymax + step * 0.5; gy += step) {
        if (Math.abs(gy) < step * 0.25) continue;
        c.fillText(fmtTick(gy, dec), xBase, Y(gy));
      }
      if (showVAxis && showHAxis) {
        c.textAlign = 'right'; c.textBaseline = 'top';
        c.fillText('0', axX - 5, axY + 3);
      }

      /* --- curves --- */
      const yClamp = H * 4;
      const bigJump = H;
      for (const f of S.fns) {
        if (!f.on || !f.curve || !f.curve.ok) continue;
        if (f.kind !== 'y') { drawParam(c, f, X, Y, W); continue; }
        const fy = f.curve.fn;
        c.lineWidth = 1.9;
        c.strokeStyle = colorOf(f.ci);
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.beginPath();
        let pen = false, prevWy = NaN, prevPy = 0;
        for (let px = 0; px <= W; px++) {
          const wx = b.xmin + (px / W) * b.sx;
          let wy;
          try { wy = fy(wx); } catch (err) { wy = NaN; }
          if (typeof wy !== 'number' || !isFinite(wy)) { pen = false; prevWy = NaN; continue; }
          let py = Y(wy);
          if (pen && Math.sign(wy) !== Math.sign(prevWy) && Math.abs(py - prevPy) > bigJump) {
            pen = false;                                     /* asymptote — lift the pen */
          }
          const cy = Math.max(-yClamp, Math.min(H + yClamp, py));
          if (!pen) { c.moveTo(px, cy); pen = true; }
          else c.lineTo(px, cy);
          prevWy = wy; prevPy = py;
        }
        c.stroke();
      }

      /* --- intersections found (panel open) --- */
      if (S.panel === 'inter' && S.inter) {
        c.lineWidth = 2; c.strokeStyle = col.label; c.fillStyle = col.bg;
        for (const p of S.inter.points) {
          const px = X(p.x), py = Y(p.y);
          if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
          c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill(); c.stroke();
        }
      }

      /* --- readouts --- */
      rangeX.textContent = `[ ${fmtNum(b.xmin)}, ${fmtNum(b.xmax)} ]`;
      rangeY.textContent = `[ ${fmtNum(b.ymin)}, ${fmtNum(b.ymax)} ]`;
      updateCanvasAria();
      interSoon();
    }

    /* polar and parametric curves: sampled along t, the pen lifts where the curve is not a number */
    function drawParam(c, f, X, Y, W) {
      const cv = f.curve;
      const n = Math.min(12000, Math.max(600, Math.round((cv.t1 - cv.t0) / GM.TWO_PI * 1200)));
      c.lineWidth = 1.9;
      c.strokeStyle = colorOf(f.ci);
      c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath();
      let pen = false;
      for (let i = 0; i <= n; i++) {
        let p;
        try { p = cv.at(cv.t0 + (cv.t1 - cv.t0) * i / n); } catch (err) { p = [NaN, NaN]; }
        const px = X(p[0]), py = Y(p[1]);
        if (!isFinite(px) || !isFinite(py) || Math.abs(px) > 1e7 || Math.abs(py) > 1e7) { pen = false; continue; }
        if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
      }
      c.stroke();
    }

    function updateCanvasAria() {
      const active = S.fns.filter(f => f.on && f.curve && f.curve.ok).map(f => f.curve.label);
      const b = bounds();
      canvas.setAttribute('aria-label', active.length
        ? `Plot of ${active.join(', ')}. x from ${fmtNum(b.xmin)} to ${fmtNum(b.xmax)}, y from ${fmtNum(b.ymin)} to ${fmtNum(b.ymax)}.`
        : 'Empty plot. Add a function.');
    }

    /* ---------------- table and intersections ---------------- */
    const dp = (v, d) => String(Number(v.toFixed(d)) + 0);
    const cellText = v => (v === null ? 'undefined' : Math.abs(v) < 1e-12 ? '0' : /e/.test(String(Number(v.toPrecision(6)))) ? Number(v.toPrecision(6)).toExponential() : String(Number(v.toPrecision(6)) + 0));
    const liveCurves = () => S.fns.map((f, i) => ({ curve: f.on ? f.curve : null, name: `f${i + 1}`, f })).filter(x => x.curve && x.curve.ok);
    const kindLabel = f => (f.kind === 'y' ? 'y' : f.kind === 'polar' ? 'r(t)' : 'x(t), y(t)');

    function togglePanel(id) {
      S.panel = S.panel === id ? '' : id;
      refreshPanel();
      requestAnimationFrame(() => { if (!dead) resize(); });
    }
    function refreshPanel() {
      tableBtn.setAttribute('aria-pressed', String(S.panel === 'table'));
      interBtn.setAttribute('aria-pressed', String(S.panel === 'inter'));
      panelEl.hidden = !S.panel;
      if (!S.panel) { clear(panelEl); schedule(); return; }
      if (S.panel === 'table') paintTable(); else paintInter();
      schedule();
    }

    function paintTable() {
      const live = liveCurves();
      const T = S.tbl;
      clear(panelEl);
      if (!live.length) { panelEl.append(h('p.graph__none', { dataset: { fk: 'g-tbl-none' }, text: 'Type a function first, and its table of values appears here.' })); return; }
      if (T.i >= live.length) T.i = 0;
      const cur = live[T.i];
      if (T.kind !== cur.f.kind) {            /* new kind of curve: its own sensible start */
        T.kind = cur.f.kind;
        T.from = cur.f.kind === 'y' ? '0' : (cur.f.tmin.trim() || '0');
        T.step = cur.f.kind === 'y' ? '1' : 'pi/6';
        T.rows = cur.f.kind === 'y' ? '11' : '13';
      }
      const inp = (key, label, w) => h('label.graph__tctl', h('span', { text: label }), h('input.graph__input', { type: 'text', value: T[key], spellcheck: 'false', maxlength: '40', style: { width: w }, 'aria-label': `Table ${label.toLowerCase()}`, dataset: { fk: `g-tbl-${key}` },
        oninput: e => { T[key] = e.target.value; paintTableBody(); } }));
      const sel = h('select.select', { 'aria-label': 'Table of which curve', dataset: { fk: 'g-tbl-curve' }, onchange: e => { T.i = Number(e.target.value); T.kind = ''; paintTable(); } },
        live.map((x, i) => h('option', { value: String(i), text: `${x.name}: ${x.curve.label}`.slice(0, 48), selected: i === T.i })));
      panelEl.append(h('div.graph__phead', sel, inp('from', cur.f.kind === 'y' ? 'x from' : 't from', '70px'), inp('step', 'step', '70px'), inp('rows', 'rows', '48px')));
      panelEl.append(h('div.graph__tbody', { dataset: { fk: 'g-tbl-body' } }));
      paintTableBody();
    }
    function paintTableBody() {
      const body = panelEl.querySelector('[data-fk="g-tbl-body"]');
      if (!body) return;
      clear(body);
      const live = liveCurves();
      const T = S.tbl;
      const cur = live[T.i];
      if (!cur) return;
      let from, step, rows;
      try { from = GM.constant(T.from, NaN); step = GM.constant(T.step, NaN); rows = Number(T.rows); }
      catch (err) { body.append(h('p.graph__none', { text: 'The start and step must be numbers (pi works: pi/6).' })); return; }
      if (!Number.isFinite(from) || !Number.isFinite(step) || step === 0) { body.append(h('p.graph__none', { text: 'The start and step must be numbers, and the step cannot be 0.' })); return; }
      if (!(rows >= 1)) { body.append(h('p.graph__none', { text: 'Rows must be a number from 1 to ' + GM.MAX_ROWS + '.' })); return; }
      const tb = GM.tableOf(cur.curve, from, step, rows);
      const note = rows > GM.MAX_ROWS ? h('p.graph__none', { text: `Showing the first ${GM.MAX_ROWS} rows.` }) : null;
      body.append(h('table.graph__tbl', { dataset: { fk: 'g-tbl' } },
        h('thead', h('tr', tb.head.map(c => h('th', { scope: 'col', text: c })))),
        h('tbody', tb.rows.map((r, i) => h('tr', { dataset: { row: String(i) } }, r.map(v => h('td', { text: cellText(v) })))))));
      if (note) body.append(note);
    }

    function paintInter() {
      clear(panelEl);
      const live = liveCurves();
      const b = bounds();
      const head = h('p.graph__note', { dataset: { fk: 'g-inter-note' }, text: 'Approximate. Found numerically inside the current view, then refined until the two curves agree to better than 0.000000001; points are shown to 6 decimal places. Two crossings closer together than the plot’s sampling step can be missed: zoom in to look closer.' });
      if (live.length < 2) { panelEl.append(head, h('p.graph__none', { dataset: { fk: 'g-inter-none' }, text: live.length ? 'Add a second curve to find where they cross.' : 'Add two or more curves to find where they cross.' })); return; }
      if (!S.inter) { S.inter = GM.intersections(live, { xmin: b.xmin, xmax: b.xmax, ymin: b.ymin, ymax: b.ymax }); interKey = viewKey(); }
      const pts = S.inter.points;
      panelEl.append(head,
        h('p.graph__sum', { role: 'status', dataset: { fk: 'g-inter-sum' }, text: pts.length ? `${pts.length} intersection${pts.length === 1 ? '' : 's'}${S.inter.capped ? ` (showing the first ${GM.MAX_POINTS})` : ''}, approximately:` : 'No intersections in this view. Try zooming out or panning.' }),
        pts.length ? h('ol.graph__ix', { dataset: { fk: 'g-inter-list' } }, pts.map(p => {
          const d = p.rough ? 3 : 6;
          return h('li', { dataset: { fk: 'g-ix', x: dp(p.x, d), y: dp(p.y, d) } },
            h('b', { text: `${p.a} and ${p.b}` }),
            h('span', { text: ` ≈ (${dp(p.x, d)}, ${dp(p.y, d)})` }),
            p.touch ? h('small', { text: ' touches without crossing' }) : null,
            p.rough ? h('small', { text: ' rough: good to about 3 decimal places' }) : null);
        })) : null);
    }
    /* when the view or the curves move, find them again a moment after it settles */
    let interTimer = 0;
    let interKey = '', interPending = '';
    const viewKey = () => { const b = bounds(); return [b.xmin, b.xmax, b.ymin, b.ymax].map(v => v.toPrecision(8)).join(','); };
    function interSoon() {
      if (S.panel !== 'inter') return;
      const k = viewKey();
      if ((S.inter && k === interKey) || k === interPending) return;
      interPending = k;
      clearTimeout(interTimer);
      interTimer = setTimeout(() => { interPending = ''; if (dead || S.panel !== 'inter') return; S.inter = null; paintInter(); schedule(); }, 220);
    }

    /* ---------------- pointer: pan, zoom, hover ---------------- */
    function localPt(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    const onDown = e => {
      if (e.button !== 0) return;
      canvas.focus();
      const p = localPt(e);
      S.drag = { id: e.pointerId, x: p.x, y: p.y, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      canvas.classList.add('is-grabbing');
    };
    const onMove = e => {
      const p = localPt(e);
      if (S.drag && S.drag.id === e.pointerId) {
        const dx = p.x - S.drag.x, dy = p.y - S.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 1) S.drag.moved = true;
        const b = bounds();
        S.view.cx -= (dx / S.cssW) * b.sx;
        S.view.cy += (dy / S.cssH) * b.sy;
        S.drag.x = p.x; S.drag.y = p.y;
        schedule();
      } else {
        const b = bounds();
        const wx = b.xmin + (p.x / S.cssW) * b.sx;
        const wy = b.ymin + ((S.cssH - p.y) / S.cssH) * b.sy;
        cursorEl.textContent = `${fmtNum(wx)}, ${fmtNum(wy)}`;
      }
    };
    const onUp = e => {
      if (S.drag && S.drag.id === e.pointerId) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        S.drag = null;
        canvas.classList.remove('is-grabbing');
      }
    };
    const onLeave = () => { if (!S.drag) cursorEl.textContent = ''; };
    const onWheel = e => {
      e.preventDefault();
      const p = localPt(e);
      const factor = Math.pow(1.0015, e.deltaY);
      zoomAt(p.x, p.y, factor);
    };
    const onKey = e => {
      const panStep = 0.12;
      const b = bounds();
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':  S.view.cx -= b.sx * panStep; break;
        case 'ArrowRight': S.view.cx += b.sx * panStep; break;
        case 'ArrowUp':    S.view.cy += b.sy * panStep; break;
        case 'ArrowDown':  S.view.cy -= b.sy * panStep; break;
        case '+': case '=': zoomBy(0.8); break;
        case '-': case '_': zoomBy(1.25); break;
        case '0': resetView(); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); schedule(); }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);

    /* ---------------- save PNG ---------------- */
    async function savePng() {
      try {
        const blob = await new Promise((res, rej) =>
          canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not render the canvas.'))), 'image/png'));
        const dir = `${api.vfs.HOME}/Pictures`;
        const name = `Graph ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        const { path } = await media.save(dir, name, blob);
        notify({
          app: 'Static Graph', icon: 'image', title: 'Saved to Pictures', message: name,
          actions: [{ label: 'Open', onClick: () => api.openApp('photos', { path }) }],
        });
      } catch (err) {
        notify({ app: 'Static Graph', icon: 'alert', title: 'Could not save', message: err.message || 'The image could not be written.' });
      }
    }

    /* ---------------- sizing ---------------- */
    function resize() {
      /* decide the layout from the whole app width first, then measure the
         plot area AFTER any resulting reflow so the canvas fills it exactly */
      const appW = appEl.getBoundingClientRect().width;
      appEl.classList.toggle('graph--narrow', appW < 560);
      const r = stage.getBoundingClientRect();
      const W = Math.max(1, Math.floor(r.width));
      const H = Math.max(1, Math.floor(r.height));
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      if (W === S.cssW && H === S.cssH && dpr === S.dpr) { draw(); return; }
      S.cssW = W; S.cssH = H; S.dpr = dpr;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      draw();
    }
    const ro = new ResizeObserver(() => { if (!dead) resize(); });
    ro.observe(appEl);
    ro.observe(stage);

    /* redraw when the theme or accent changes the token colours */
    const offTheme = store.sub('prefs.theme', () => schedule());
    const offAccent = store.sub('prefs.accent', () => schedule());

    /* ---------------- boot ---------------- */
    renderList();
    /* first measure after layout settles */
    requestAnimationFrame(() => { if (!dead) resize(); });

    /* ---------------- teardown ---------------- */
    return () => {
      dead = true;
      clearTimeout(interTimer);
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      ro.disconnect();
      offTheme(); offAccent();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
  },
});
