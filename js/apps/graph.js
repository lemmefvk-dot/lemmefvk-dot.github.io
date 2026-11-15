/* ============================================================
   graph.js — Static Graph: a graphing calculator.

   Type one or more functions of x and see them plotted together on
   a <canvas>, each in its own colour, over a grid with labelled axes.

   DESIGN
   · A hand-written expression parser — NO eval(), NO Function(). The
     source is tokenised (numbers, identifiers, the operators
     + - * / ^ %, parentheses, commas) and parsed by recursive descent
     into a tree of tiny closures, one per node, so evaluating f(x) is
     just a chain of function calls with correct precedence:
        + −   (lowest)
        × ÷ %  and implicit multiply (2x, 2sin(x), (x+1)(x-1), ax)
        unary − +
        ^      (right-associative, so 2^-3 and -x^2 read as written)
     Known functions: sin cos tan sec csc cot asin acos atan sinh cosh
     tanh sqrt abs log ln exp floor ceil round sign mod min max.
     Constants: pi, e. Sliders: a, b, c. Anything else is a clearly
     reported error on THAT function only — the others keep plotting.
     (js/core/graphmath.js holds the parser and every numeric method.)

   · Kinds of row: y = f(x) (or y <, >, ≤, ≥ f(x), shaded), r = f(t),
     x(t), y(t), an equation or inequality in x and y (marching squares,
     shaded where it holds), and typed points with a least-squares line.

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

   · Sliders a, b, c are read by the curves as they are drawn, so moving
     one only redraws. Play sweeps a slider with requestAnimationFrame,
     one small step a frame (never a busy loop); it only ever starts
     when Play is pressed, and with Reduce Motion on there is no Play.

   · Pan by dragging, zoom with the wheel or the + / − buttons (both
     centred where you point / on the view), and a reset returns to the
     start.  Arrow keys pan and +/−/0 zoom when the plot has focus.
     "Save PNG" writes a real image into ~/Pictures via media.js. A graph
     can be a file (~/Documents/<name>.graph, JSON); once it has one,
     edits save themselves. Without one it is kept in the store.

   Every number on screen is measured from the real view or computed
   from the real expression, and each panel names its method and how
   close it gets. Nothing is faked.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as GM from '../core/graphmath.js';
import { lineText, fmt as statFmt } from '../core/stats.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-graph-css')) {
  const l = document.createElement('link');
  l.id = 'feat-graph-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-graph.css';
  document.head.appendChild(l);
}

/* distinct series colours, readable on both the dark and light shells */
const PALETTE = ['#ff5d7a', '#4d9bff', '#25c281', '#f0a020', '#a879ff', '#ff7a45', '#17b3c9', '#e254a6'];
const LINE_W = { 1: 1.2, 2: 1.9, 3: 3.2 };
const DASH = { solid: [], dashed: [8, 6], dotted: [1, 5] };
const SWEEP_S = 4;                    /* Play takes a slider from one end to the other in this many seconds */

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
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };

defineApp({
  id: 'graph',
  name: 'Static Graph',
  icon: 'trending-up',
  g1: '#5ea0ff', g2: '#7b3ff2',
  category: 'Productivity',
  keywords: ['graph', 'graphing', 'calculator', 'plot', 'function', 'math', 'equation', 'chart',
    'curve', 'sine', 'parabola', 'trig', 'desmos', 'x', 'y', 'polar', 'parametric', 'intersection', 'table of values',
    'slider', 'zeros', 'roots', 'maximum', 'minimum', 'inequality', 'tangent', 'area', 'integral', 'implicit', 'circle', 'line of best fit', 'degrees'],
  desc: 'Plot functions, equations, inequalities and points with sliders, and find zeros, turning points, tangents, areas and intersections',
  singleton: false,
  exts: ['graph'],
  win: { w: 940, h: 600, minW: 380, minH: 380 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, clear, store, notify } = api;
    const vfs = api.vfs;
    const DOCS = `${vfs.HOME}/Documents`;

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

    /* the sliders' live values: the compiled curves read these as they draw */
    const PV = Object.create(null);
    const env = () => ({ params: PV, deg: S.angle === 'deg' });

    function nextColor() {
      const used = new Set(S.fns.map(f => f.ci));
      for (let i = 0; i < 999; i++) if (!used.has(i % PALETTE.length) || i >= PALETTE.length) return i % PALETTE.length;
      return 0;
    }
    function colorOf(ci) { return PALETTE[((ci % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

    function makeFn(spec, i) {
      const f = { ...GM.cleanFn(spec, i), curve: null, error: '', els: null };
      recompile(f);
      return f;
    }
    /* the safe parser (js/core/graphmath.js) turns the text into a curve, or says what is wrong */
    function recompile(f) {
      f.curve = GM.makeCurve(f, env());
      f.error = f.curve.ok || f.curve.empty ? '' : f.curve.error;
      S.inter = null;
      S.ver++;
    }
    function recompileAll() { S.fns.forEach(recompile); }

    const S = {
      fns: [],
      params: GM.cleanParams(null),
      angle: 'rad',
      view: { cx: 0, cy: 0, spanX: 20 },
      cssW: 1, cssH: 1, dpr: 1,
      drag: null,        /* { id, x, y, moved } */
      panel: '',         /* '' | 'table' | 'inter' | 'keys' | 'calc' */
      inter: null,       /* { points, capped, skipped } for the curves as they are, or null */
      keys: null,        /* [{ f, name, kp }] for the curves as they are, or null */
      ver: 0,            /* goes up whenever a curve or a slider changes */
      tbl: { i: 0, kind: '', from: '0', step: '1', rows: '11' },
      calc: { i: 0, tx: '1', a: '0', b: '1' },
      playing: new Set(),
      src: { mode: 'scratch', path: null },   /* scratch: kept in the store · file: autosaved to path · shared: from a link, not saved yet */
    };
    function applyGraph(g, keepView) {
      const src = g && g.fns.length ? g.fns : DEFAULTS.map(d => GM.cleanFn(d));
      S.params = GM.cleanParams(g ? g.params : null);
      for (const k of GM.PARAMS) PV[k] = S.params[k].v;
      S.angle = g && g.angle === 'deg' ? 'deg' : 'rad';
      S.fns = src.slice(0, GM.MAX_FNS).map((f, i) => makeFn(f, i));
      if (!keepView) S.view = g && g.view ? { ...g.view } : { cx: 0, cy: 0, spanX: 20 };
      S.inter = null; S.keys = null;
    }
    /* load the store's graph, defensively (an old save with only { fns: [{ expr, on, ci }] } still opens) */
    function loadScratch() { applyGraph(GM.cleanGraph(store.get(KEY, null))); S.view = { cx: 0, cy: 0, spanX: 20 }; }

    const graphData = withView => ({
      fns: S.fns.map(f => GM.cleanFn(f)),
      params: S.params, angle: S.angle,
      view: withView ? { ...S.view } : undefined,
    });
    let saveTimer = 0;
    function persist() {
      if (S.src.mode === 'scratch') {
        /* store.set only takes NEW arrays/objects — always build fresh */
        const d = graphData(false);
        store.set(KEY, { fns: d.fns, params: GM.cleanParams(d.params), angle: d.angle });
      } else if (S.src.mode === 'file') {
        S.dirty = true;
        paintStatus();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { if (!dead) writeFile(true); }, 600);
      } else { S.dirty = true; paintStatus(); }
    }

    /* ---------------- DOM ---------------- */
    const listEl = h('div.graph__list', { role: 'list', 'aria-label': 'Functions' });
    const addBtn = h('button.btn.btn--sm.graph__add', {
      type: 'button', onclick: () => addFunction(),
    }, icon('plus'), h('span', { text: 'Add function' }));
    const paramsEl = h('section.graph__params', { 'aria-label': 'Sliders', dataset: { fk: 'g-sliders' } });

    const side = h('aside.graph__side.app__side.app__side--wide',
      h('div.graph__sidehd',
        h('div.side__label', { text: 'Functions' }),
        addBtn),
      listEl,
      paramsEl,
      h('details.graph__help',
        h('summary', { text: 'Syntax and functions' }),
        h('p', { text: 'Write y in terms of x, or pick r = f(t) for a polar curve, x(t), y(t) for a parametric one, an equation in x and y (x^2 + y^2 = 25, or x^2 + y^2 < 9 to shade), or points. Operators + − * / ^ % and ( ). Implicit ×, e.g. 2x, ax or 2sin(x).' }),
        h('p', { text: 'Functions: sin cos tan sec csc cot asin acos atan sinh cosh tanh sqrt abs log ln exp floor ceil round sign, mod(a, b), min(…), max(…).' }),
        h('p', { text: 'Constants: pi, e. Sliders: a, b and c. In polar and parametric curves the variable is t (θ is read as theta).' }),
        h('p', { text: 'Equations in x and y are drawn by marching squares on a 4-pixel grid, with each grid crossing narrowed onto the curve; a detail smaller than that grid can be missed.' })));

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
    const keysBtn = pbtn('keys', 'Key points', 'list');
    const calcBtn = pbtn('calc', 'Tangent & area', 'trending-up');
    const angleBtn = h('button.btn.btn--sm.graph__angle', {
      type: 'button', dataset: { fk: 'g-angle' }, title: 'Angles in radians or degrees',
      onclick: () => setAngle(S.angle === 'deg' ? 'rad' : 'deg'),
    });
    /* the readouts get a line of their own: their width changes with the view, and the
       buttons' wrapping must not depend on it (it would change the plot's height, and so the view) */
    const bar = h('div.graph__bar.app__bar',
      h('div.graph__readout',
        h('span.graph__rlabel', { text: 'x' }), rangeX,
        h('span.graph__rlabel', { text: 'y' }), rangeY,
        h('span.graph__spacer'),
        cursorEl),
      angleBtn, tableBtn, interBtn, keysBtn, calcBtn);
    const panelEl = h('section.graph__panel', { hidden: true, 'aria-label': 'Table, intersections, key points, tangent and area', dataset: { fk: 'g-panel' } });

    const main = h('div.graph__main.app__main', bar, stage, panelEl);
    const appEl = h('div.app.graph', side, main);
    root.appendChild(appEl);

    win.setTools(
      h('button.ibtn.tip', { 'data-tip': 'Save graph (Ctrl+S)', 'aria-label': 'Save graph', dataset: { fk: 'g-save' }, onclick: () => saveGraph() }, icon('save')),
      h('button.ibtn.tip', { 'data-tip': 'Open a graph', 'aria-label': 'Open a graph', dataset: { fk: 'g-open' }, onclick: e => openMenu(e.currentTarget) }, icon('folder-open')),
      h('button.ibtn.tip', { 'data-tip': 'Copy the functions', 'aria-label': 'Copy the functions', dataset: { fk: 'g-copy' }, onclick: e => copyMenu(e.currentTarget) }, icon('copy')),
      h('button.ibtn.tip', { 'data-tip': 'Reset view', 'aria-label': 'Reset view', onclick: () => resetView() }, icon('maximize')),
      h('button.ibtn.tip', { 'data-tip': 'Save as PNG', 'aria-label': 'Save plot as PNG', onclick: () => savePng() }, icon('download')),
    );

    /* ---------------- function rows ---------------- */
    function renderList() {
      clear(listEl);
      S.fns.forEach((f, idx) => {
        const col = colorOf(f.ci);
        const n = idx + 1;
        const changed = () => { recompile(f); paintRow(f); schedule(); persist(); refreshPanel(); renderParams(); };
        const inputEl = (key, label, ph) => h('input.graph__input', {
          type: 'text', value: f[key], spellcheck: 'false', autocapitalize: 'off', maxlength: String(GM.MAX_EXPR),
          autocomplete: 'off', autocorrect: 'off', 'aria-label': label, placeholder: ph, dataset: { fk: `g-${key}-${n}` },
          oninput: e => { f[key] = e.target.value; changed(); },
        });
        const field = (key, label, ph, eq) => h('div.graph__fnmain', h('span.graph__eq', { text: eq }), inputEl(key, label, ph));
        let input;
        if (f.kind === 'y') {
          const rel = h('select.select.graph__rel', {
            'aria-label': `Function ${n}: y equals, or an inequality`, dataset: { fk: `g-rel-${n}` },
            onchange: e => { f.rel = e.target.value; changed(); },
          }, ['=', '<', '>', '<=', '>='].map(r => h('option', { value: r, text: `y ${GM.REL_TEXT[r]}`, selected: r === f.rel })));
          input = h('div.graph__fnmain', rel, inputEl('expr', `Function ${n}`, 'e.g. sin(x)'));
        } else if (f.kind === 'polar') input = field('expr', `Function ${n} r of t`, 'e.g. 1 + cos(t)', 'r=');
        else if (f.kind === 'param') input = field('expr', `Function ${n} x of t`, 'e.g. cos(t)', 'x=');
        else if (f.kind === 'implicit') input = h('div.graph__fnmain', inputEl('expr', `Function ${n} equation in x and y`, 'e.g. x^2 + y^2 = 25'));
        else {
          input = h('div.graph__fnmain', h('textarea.graph__input.graph__pts', {
            rows: 4, spellcheck: 'false', 'aria-label': `Function ${n} points, one x, y pair per line`, placeholder: 'one pair per line:\n1, 2\n2, 3.9', dataset: { fk: `g-expr-${n}` },
            oninput: e => { f.expr = e.target.value.slice(0, 20000); changed(); },
          }, f.expr));
          input.querySelector('textarea').value = f.expr;
        }
        const errEl = h('div.graph__err', { role: 'status' });
        const noteEl = h('div.graph__fnnote', { dataset: { fk: `g-note-${n}` } });
        const swatch = h('button.graph__swatch', {
          type: 'button', 'aria-pressed': String(f.on),
          'aria-label': f.on ? `Hide function ${n}` : `Show function ${n}`,
          title: f.on ? 'Hide' : 'Show', dataset: { fk: `g-show-${n}` },
          onclick: () => { f.on = !f.on; S.inter = null; S.ver++; paintRow(f); schedule(); persist(); refreshPanel(); },
          style: { '--fc': col },
        });
        const del = h('button.ibtn.graph__del', {
          type: 'button', 'aria-label': `Remove function ${n}`, title: 'Remove',
          onclick: () => removeFunction(f),
        }, icon('x'));
        const kind = h('select.select.graph__kind', {
          'aria-label': `Function ${n} type`, dataset: { fk: `g-kind-${n}` },
          onchange: e => { f.kind = e.target.value; renderList(); recompile(f); paintRow(f); schedule(); persist(); refreshPanel(); renderParams(); },
        }, GM.KINDS.map(([v, l]) => h('option', { value: v, text: l, selected: v === f.kind })));
        const top = h('div.graph__fnmain', swatch, kind, del);
        const tRange = () => h('div.graph__trange',
          h('label', h('span', { text: 't from' }), h('input.graph__input', { type: 'text', value: f.tmin, placeholder: '0', spellcheck: 'false', maxlength: '40', 'aria-label': `Function ${n} t from`, dataset: { fk: `g-tmin-${n}` }, oninput: e => { f.tmin = e.target.value; changed(); } })),
          h('label', h('span', { text: 'to' }), h('input.graph__input', { type: 'text', value: f.tmax, placeholder: S.angle === 'deg' ? '360' : '2pi', spellcheck: 'false', maxlength: '40', 'aria-label': `Function ${n} t to`, dataset: { fk: `g-tmax-${n}` }, oninput: e => { f.tmax = e.target.value; changed(); } })));
        const extra = f.kind === 'polar' ? [tRange()] : f.kind === 'param' ? [field('expr2', `Function ${n} y of t`, 'e.g. sin(t)', 'y='), tRange()] : [];
        if (f.kind === 'points') {
          extra.push(h('label.graph__fit', h('input', { type: 'checkbox', checked: f.fit, dataset: { fk: `g-fit-${n}` }, onchange: e => { f.fit = e.target.checked; changed(); } }), h('span', { text: 'Line of best fit (least squares)' })));
        }
        /* line style and width */
        const look = h('div.graph__look',
          h('select.select', { 'aria-label': `Function ${n} line style`, dataset: { fk: `g-style-${n}` }, onchange: e => { f.style = e.target.value; schedule(); persist(); } },
            [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']].map(([v, l]) => h('option', { value: v, text: l, selected: v === f.style }))),
          h('select.select', { 'aria-label': `Function ${n} line width`, dataset: { fk: `g-width-${n}` }, onchange: e => { f.width = Number(e.target.value); schedule(); persist(); } },
            [[1, 'Thin'], [2, 'Normal'], [3, 'Thick']].map(([v, l]) => h('option', { value: String(v), text: l, selected: v === f.width }))));
        const row = h('div.graph__fn', { role: 'listitem', dataset: { kind: f.kind } }, top, input, ...extra, look, errEl, noteEl);
        f.els = { row, input: input.querySelector('input, textarea'), errEl, swatch, noteEl };
        listEl.appendChild(row);
        paintRow(f);
      });
    }
    function paintRow(f) {
      if (!f.els) return;
      const n = S.fns.indexOf(f) + 1;
      f.els.swatch.classList.toggle('is-off', !f.on);
      f.els.swatch.setAttribute('aria-pressed', String(f.on));
      f.els.swatch.setAttribute('aria-label', f.on ? `Hide function ${n}` : `Show function ${n}`);
      f.els.swatch.title = f.on ? 'Hide' : 'Show';
      f.els.row.classList.toggle('has-err', !!f.error && !!f.expr.trim());
      f.els.row.classList.toggle('is-hidden', !f.on);
      if (f.error && f.expr.trim()) { f.els.errEl.textContent = f.error; f.els.errEl.hidden = false; }
      else { f.els.errEl.textContent = ''; f.els.errEl.hidden = true; }
      /* what a points row worked out: the fitted line, and what it ignored */
      const c = f.curve;
      let note = '';
      if (c && c.ok && c.kind === 'points') {
        if (c.fit) note = c.fit.ok ? `Least squares: ${lineText(c.fit)}${c.fit.r2 === null ? '' : `, r² = ${statFmt(Math.round(c.fit.r2 * 1e6) / 1e6)}`}. ${c.fit.note}` : c.fit.reason;
        if (c.note) note = `${note} ${c.note}`.trim();
      }
      f.els.noteEl.textContent = note.trim();
      f.els.noteEl.hidden = !note.trim();
    }
    function addFunction(spec) {
      if (S.fns.length >= GM.MAX_FNS) { notify({ app: 'Static Graph', icon: 'trending-up', title: 'That is plenty', message: `Up to ${GM.MAX_FNS} functions at once.` }); return; }
      const f = makeFn({ kind: 'y', ...(spec || {}), ci: nextColor() }, S.fns.length);
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
      S.inter = null; S.ver++;
      if (!S.fns.length) S.fns.push(makeFn({ kind: 'y', ci: 0 }, 0));
      renderList();
      renderParams();
      persist();
      schedule();
      refreshPanel();
    }

    /* ---------------- sliders a, b, c ---------------- */
    const usedParams = () => { const u = new Set(); for (const f of S.fns) if (f.curve && f.curve.ok) for (const k of f.curve.params || []) u.add(k); return GM.PARAMS.filter(k => u.has(k)); };
    let shownParams = '';
    function renderParams(force) {
      const used = usedParams();
      const sig = used.join() + (reduced() ? 'r' : '');
      if (!force && sig === shownParams && paramsEl.childElementCount) { paintParams(); return; }
      shownParams = sig;
      for (const k of [...S.playing]) if (!used.includes(k)) S.playing.delete(k);
      clear(paramsEl);
      paramsEl.append(h('div.side__label', { text: 'Sliders' }));
      if (!used.length) {
        paramsEl.append(h('p.graph__phint', { dataset: { fk: 'g-snone' }, text: 'Write a, b or c in a function (like a sin(bx) + c) and a slider for it appears here.' }));
        return;
      }
      for (const k of used) {
        const p = S.params[k];
        const out = h('output.graph__sval', { dataset: { fk: `g-sval-${k}` } });
        const range = h('input.graph__range', { type: 'range', min: String(p.min), max: String(p.max), step: String(p.step), value: String(p.v), 'aria-label': `Slider ${k}`, dataset: { fk: `g-slider-${k}` },
          oninput: e => setParam(k, Number(e.target.value), true) });
        const lim = (which, label) => h('input.graph__input.graph__lim', { type: 'text', value: String(p[which]), spellcheck: 'false', maxlength: '20', 'aria-label': `Slider ${k} ${label}`, dataset: { fk: `g-s${which}-${k}` },
          onchange: e => setLimit(k, which, e.target) });
        const play = reduced() ? null : h('button.ibtn.graph__play', { type: 'button', 'aria-pressed': 'false', 'aria-label': `Play slider ${k}`, title: 'Play', dataset: { fk: `g-play-${k}` }, onclick: () => togglePlay(k) }, icon('play'));
        paramsEl.append(h('div.graph__param', { dataset: { p: k } },
          h('div.graph__phd', h('b', { text: k }), h('span', { text: '=' }), out, h('span.graph__spacer'), play),
          range,
          h('div.graph__prange', lim('min', 'from'), h('span', { text: 'to' }), lim('max', 'to'), h('span', { text: 'step' }), lim('step', 'step'))));
      }
      if (reduced()) paramsEl.append(h('p.graph__phint', { dataset: { fk: 'g-snote' }, text: 'Reduce Motion is on, so sliders do not play by themselves. Drag them, or use the arrow keys on one.' }));
      paintParams();
    }
    function paintParams() {
      for (const k of GM.PARAMS) {
        const el = paramsEl.querySelector(`[data-p="${k}"]`);
        if (!el) continue;
        const p = S.params[k];
        el.querySelector('output').textContent = String(+p.v.toPrecision(6));
        const r = el.querySelector('input[type=range]');
        if (Number(r.value) !== p.v) r.value = String(p.v);
        const pl = el.querySelector('.graph__play');
        if (pl) {
          const on = S.playing.has(k);
          pl.setAttribute('aria-pressed', String(on));
          pl.setAttribute('aria-label', `${on ? 'Pause' : 'Play'} slider ${k}`);
          pl.title = on ? 'Pause' : 'Play';
          pl.replaceChildren(icon(on ? 'pause' : 'play'));
        }
      }
    }
    function setParam(k, v, fromUser) {
      const p = S.params[k];
      if (!Number.isFinite(v)) return;
      p.v = Math.min(p.max, Math.max(p.min, v));
      PV[k] = p.v;
      S.ver++; S.inter = null; S.keys = null;
      if (fromUser) { persist(); paintParams(); }
      schedule();
      panelSoon();
    }
    function setLimit(k, which, input) {
      const p = { ...S.params[k] };
      let v;
      try { v = GM.constant(input.value, NaN); } catch (e) { v = NaN; }
      if (!Number.isFinite(v)) { input.value = String(S.params[k][which]); return; }
      p[which] = v;
      const clean = GM.cleanParams({ [k]: p })[k];
      if (which !== 'step' && !(p.max > p.min)) { input.value = String(S.params[k][which]); notify({ app: 'Static Graph', icon: 'alert', title: 'That range is backwards', message: `The end of slider ${k} must be bigger than its start.` }); return; }
      S.params[k] = clean;
      PV[k] = clean.v;
      S.ver++;
      renderParams(true);
      persist();
      schedule();
      panelSoon();
    }
    /* Play: one small step a frame, from requestAnimationFrame; bounces at the ends */
    let playRaf = 0, playLast = 0, playSaved = 0;
    function togglePlay(k) {
      if (reduced()) return;
      if (S.playing.has(k)) S.playing.delete(k);
      else { S.playing.add(k); S.params[k].dir = S.params[k].dir || 1; }
      paintParams();
      if (S.playing.size && !playRaf) { playLast = 0; playRaf = requestAnimationFrame(playTick); }
      if (!S.playing.size) persist();
    }
    function playTick(now) {
      playRaf = 0;
      if (dead || !S.playing.size) return;
      if (reduced()) { stopPlay(); renderParams(true); return; }
      const dt = playLast ? Math.min(0.1, (now - playLast) / 1000) : 0;
      playLast = now;
      for (const k of S.playing) {
        const p = S.params[k];
        let v = p.v + (p.dir || 1) * (p.max - p.min) * dt / SWEEP_S;
        if (v >= p.max) { v = p.max; p.dir = -1; } else if (v <= p.min) { v = p.min; p.dir = 1; }
        setParam(k, v, false);
      }
      paintParams();
      if (now - playSaved > 1000) { playSaved = now; persist(); }
      playRaf = requestAnimationFrame(playTick);
    }
    function stopPlay() {
      S.playing.clear();
      if (playRaf) cancelAnimationFrame(playRaf);
      playRaf = 0;
      paintParams();
    }

    function setAngle(a) {
      S.angle = a;
      recompileAll();
      renderList();
      renderParams();
      paintAngle();
      persist();
      schedule();
      refreshPanel();
    }
    function paintAngle() {
      angleBtn.textContent = S.angle === 'deg' ? 'Degrees' : 'Radians';
      angleBtn.setAttribute('aria-label', `Angles are in ${S.angle === 'deg' ? 'degrees' : 'radians'}. Switch to ${S.angle === 'deg' ? 'radians' : 'degrees'}`);
      angleBtn.dataset.angle = S.angle;
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
    const lineOf = (c, f, strict) => {
      c.lineWidth = LINE_W[f.width] || 1.9;
      c.strokeStyle = colorOf(f.ci);
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.setLineDash(strict ? [6, 5] : DASH[f.style] || []);
    };

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
      c.setLineDash([]);
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

      /* --- the area being measured (Tangent & area panel), under the curves --- */
      const calc = S.panel === 'calc' ? calcState() : null;
      if (calc && calc.area && calc.area.ok) drawArea(c, calc, X, Y, W, H);

      /* --- curves --- */
      const yClamp = H * 4;
      const bigJump = H;
      for (const f of S.fns) {
        if (!f.on || !f.curve || !f.curve.ok) continue;
        if (f.kind === 'polar' || f.kind === 'param') { drawParam(c, f, X, Y); continue; }
        if (f.kind === 'implicit') { drawImplicit(c, f, b, W, H); continue; }
        if (f.kind === 'points') { drawPoints(c, f, b, X, Y, W); continue; }
        const fy = f.curve.fn;
        const rel = f.curve.rel;
        const runs = [];
        let run = null, prevWy = NaN, prevPy = 0;
        for (let px = 0; px <= W; px++) {
          const wx = b.xmin + (px / W) * b.sx;
          let wy;
          try { wy = fy(wx); } catch (err) { wy = NaN; }
          if (typeof wy !== 'number' || !isFinite(wy)) { run = null; prevWy = NaN; continue; }
          const py = Y(wy);
          if (run && Math.sign(wy) !== Math.sign(prevWy) && Math.abs(py - prevPy) > bigJump) run = null;   /* asymptote — lift the pen */
          if (!run) { run = []; runs.push(run); }
          run.push(px, Math.max(-yClamp, Math.min(H + yClamp, py)));
          prevWy = wy; prevPy = py;
        }
        /* an inequality: shade from the curve to the top (y >) or the bottom (y <) */
        if (rel !== '=') {
          const edge = rel === '>' || rel === '>=' ? -2 : H + 2;
          c.fillStyle = hexA(colorOf(f.ci), 0.16);
          c.beginPath();
          for (const r of runs) {
            c.moveTo(r[0], edge);
            for (let i = 0; i < r.length; i += 2) c.lineTo(r[i], r[i + 1]);
            c.lineTo(r[r.length - 2], edge);
            c.closePath();
          }
          c.fill();
        }
        lineOf(c, f, rel === '<' || rel === '>');
        c.beginPath();
        for (const r of runs) { c.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) c.lineTo(r[i], r[i + 1]); }
        c.stroke();
      }
      c.setLineDash([]);

      /* --- the tangent line --- */
      if (calc && calc.tan && calc.tan.ok) drawTangent(c, calc, b, X, Y, W);

      /* --- intersections found (panel open) --- */
      if (S.panel === 'inter' && S.inter) {
        c.lineWidth = 2; c.strokeStyle = col.label; c.fillStyle = col.bg;
        for (const p of S.inter.points) {
          const px = X(p.x), py = Y(p.y);
          if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
          c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill(); c.stroke();
        }
      }
      /* --- zeros and turning points, with their coordinates (panel open) --- */
      if (S.panel === 'keys') drawKeys(c, col, X, Y, W, H);

      /* --- readouts --- */
      rangeX.textContent = `[ ${fmtNum(b.xmin)}, ${fmtNum(b.xmax)} ]`;
      rangeY.textContent = `[ ${fmtNum(b.ymin)}, ${fmtNum(b.ymax)} ]`;
      updateCanvasAria();
      panelSoon();
    }

    /* polar and parametric curves: sampled along t, the pen lifts where the curve is not a number */
    function drawParam(c, f, X, Y) {
      const cv = f.curve;
      const n = Math.min(12000, Math.max(600, Math.round((cv.t1 - cv.t0) / (cv.turn || GM.TWO_PI) * 1200)));
      lineOf(c, f, false);
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
    /* an equation in x and y: marching squares on a 4-pixel grid (graphmath.implicitGrid) */
    function drawImplicit(c, f, b, W, H) {
      const nx = Math.min(400, Math.ceil(W / 4)), ny = Math.min(400, Math.ceil(H / 4));
      const g = GM.implicitGrid(f.curve.F, f.curve.rel, b, nx, ny);
      const X = wx => ((wx - b.xmin) / b.sx) * W, Y = wy => H - ((wy - b.ymin) / b.sy) * H;
      if (g.mask) {
        const cw = W / nx, ch = H / ny;
        c.fillStyle = hexA(colorOf(f.ci), 0.16);
        c.beginPath();
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (g.mask[j * nx + i]) c.rect(i * cw, H - (j + 1) * ch, cw + 0.5, ch + 0.5);
        c.fill();
      }
      lineOf(c, f, f.curve.rel === '<' || f.curve.rel === '>');
      c.beginPath();
      for (let i = 0; i < g.segs.length; i += 4) { c.moveTo(X(g.segs[i]), Y(g.segs[i + 1])); c.lineTo(X(g.segs[i + 2]), Y(g.segs[i + 3])); }
      c.stroke();
      f.drawn = g.segs.length / 4;
    }
    /* typed points, and the least-squares line through them */
    function drawPoints(c, f, b, X, Y, W) {
      const cv = f.curve;
      const r = (LINE_W[f.width] || 1.9) + 2;
      c.fillStyle = colorOf(f.ci);
      c.beginPath();
      for (const [x, y] of cv.pts) { const px = X(x), py = Y(y); if (px < -10 || px > W + 10 || !isFinite(py)) continue; c.moveTo(px + r, py); c.arc(px, py, r, 0, Math.PI * 2); }
      c.fill();
      if (cv.fit && cv.fit.ok) {
        lineOf(c, f, false);
        if (f.style === 'solid') c.setLineDash([8, 6]);
        c.beginPath();
        c.moveTo(0, Y(cv.fit.slope * b.xmin + cv.fit.intercept));
        c.lineTo(W, Y(cv.fit.slope * b.xmax + cv.fit.intercept));
        c.stroke();
      }
    }
    function drawArea(c, calc, X, Y, W, H) {
      const f = calc.f, fy = f.curve.fn;
      const lo = Math.max(Math.min(calc.a, calc.b), S.view.cx - S.view.spanX), hi = Math.min(Math.max(calc.a, calc.b), S.view.cx + S.view.spanX);
      if (!(hi > lo)) return;
      const n = Math.max(2, Math.min(4000, Math.round((X(hi) - X(lo)))));
      c.fillStyle = hexA(colorOf(f.ci), 0.28);
      c.beginPath();
      c.moveTo(X(lo), Y(0));
      for (let i = 0; i <= n; i++) {
        const x = lo + (hi - lo) * i / n;
        let y; try { y = fy(x); } catch (e) { y = NaN; }
        if (Number.isFinite(y)) c.lineTo(X(x), Math.max(-H * 4, Math.min(H * 5, Y(y))));
      }
      c.lineTo(X(hi), Y(0));
      c.closePath();
      c.fill();
    }
    function drawTangent(c, calc, b, X, Y, W) {
      const t = calc.tan;
      c.lineWidth = 1.6; c.strokeStyle = readColors().label; c.setLineDash([7, 5]);
      c.beginPath();
      c.moveTo(0, Y(t.slope * b.xmin + t.intercept)); c.lineTo(W, Y(t.slope * b.xmax + t.intercept));
      c.stroke(); c.setLineDash([]);
      c.fillStyle = colorOf(calc.f.ci);
      c.beginPath(); c.arc(X(t.x), Y(t.y), 5, 0, Math.PI * 2); c.fill();
    }
    function drawKeys(c, col, X, Y, W, H) {
      const keys = keysNow();
      c.font = "11px 'Inter', system-ui, -apple-system, sans-serif";
      c.textAlign = 'left'; c.textBaseline = 'bottom';
      let labels = 0;
      for (const k of keys) {
        const pts = [...k.kp.zeros, ...k.kp.maxima, ...k.kp.minima];
        for (const p of pts) {
          const px = X(p.x), py = Y(p.y);
          if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
          c.lineWidth = 2; c.strokeStyle = colorOf(k.f.ci); c.fillStyle = col.bg;
          c.beginPath(); c.arc(px, py, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
          if (labels++ > 80) continue;
          const t = `(${dp(p.x, 3)}, ${dp(p.y, 3)})`;
          c.lineWidth = 3; c.strokeStyle = col.bg; c.strokeText(t, px + 6, py - 5);
          c.fillStyle = col.label; c.fillText(t, px + 6, py - 5);
        }
      }
    }

    function updateCanvasAria() {
      const active = S.fns.filter(f => f.on && f.curve && f.curve.ok).map(f => f.curve.label);
      const b = bounds();
      canvas.setAttribute('aria-label', active.length
        ? `Plot of ${active.join(', ')}. x from ${fmtNum(b.xmin)} to ${fmtNum(b.xmax)}, y from ${fmtNum(b.ymin)} to ${fmtNum(b.ymax)}.`
        : 'Empty plot. Add a function.');
    }

    /* ---------------- table, intersections, key points, tangent and area ---------------- */
    const dp = (v, d) => String(Number(v.toFixed(d)) + 0);
    const cellText = v => (v === null ? 'undefined' : Math.abs(v) < 1e-12 ? '0' : /e/.test(String(Number(v.toPrecision(6)))) ? Number(v.toPrecision(6)).toExponential() : String(Number(v.toPrecision(6)) + 0));
    const allLive = () => S.fns.map((f, i) => ({ curve: f.on ? f.curve : null, name: `f${i + 1}`, f })).filter(x => x.curve && x.curve.ok);
    /* the curves a table can list: y = f(x), polar and parametric */
    const liveCurves = () => allLive().filter(x => GM.TRACED.has(x.curve.kind));
    const yCurves = () => allLive().filter(x => x.curve.kind === 'y');

    function togglePanel(id) {
      S.panel = S.panel === id ? '' : id;
      refreshPanel();
      requestAnimationFrame(() => { if (!dead) resize(); });
    }
    function refreshPanel() {
      for (const [b, id] of [[tableBtn, 'table'], [interBtn, 'inter'], [keysBtn, 'keys'], [calcBtn, 'calc']]) b.setAttribute('aria-pressed', String(S.panel === id));
      panelEl.hidden = !S.panel;
      if (!S.panel) { clear(panelEl); schedule(); return; }
      if (S.panel === 'table') paintTable();
      else if (S.panel === 'inter') paintInter();
      else if (S.panel === 'keys') paintKeys();
      else paintCalc();
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
        T.step = cur.f.kind === 'y' ? '1' : S.angle === 'deg' ? '30' : 'pi/6';
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
      const live = allLive().filter(x => x.curve.kind !== 'points');
      const b = bounds();
      const head = h('p.graph__note', { dataset: { fk: 'g-inter-note' }, text: 'Approximate. Found numerically inside the current view, then refined until the two curves agree to better than 0.000000001; points are shown to 6 decimal places. Two crossings closer together than the plot’s sampling step can be missed: zoom in to look closer. An equation in x and y is checked against the other curves (narrowed by bisection along them), but not against another equation in x and y.' });
      if (live.length < 2) { panelEl.append(head, h('p.graph__none', { dataset: { fk: 'g-inter-none' }, text: live.length ? 'Add a second curve to find where they cross.' : 'Add two or more curves to find where they cross.' })); return; }
      if (!S.inter) { S.inter = GM.intersections(live, { xmin: b.xmin, xmax: b.xmax, ymin: b.ymin, ymax: b.ymax }); panelKey = viewKey(); }
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
        })) : null,
        S.inter.skipped ? h('p.graph__none', { text: `${S.inter.skipped} pair${S.inter.skipped === 1 ? '' : 's'} of equations in x and y not checked against each other.` }) : null);
    }

    /* zeros, maxima and minima of each y = f(x) curve, inside the view */
    function keysNow() {
      if (S.keys && S.keys.key === viewKey()) return S.keys.list;
      const b = bounds();
      const list = yCurves().map(x => ({ f: x.f, name: x.name, kp: GM.keyPoints(x.curve, b) }));
      S.keys = { key: viewKey(), list };
      return list;
    }
    function paintKeys() {
      clear(panelEl);
      const head = h('p.graph__note', { dataset: { fk: 'g-keys-note' }, text: 'Zeros: where the curve changes sign, narrowed by bisection to the limit of the computer’s numbers (a pole like 1/x, or a jump, is not a zero). Maxima and minima: where the curve turns, found by golden-section search and then bisection on the slope; x is good to about 9 decimal places for a smooth turn. Only curves y = f(x), only inside the current view; shown to 6 decimal places, marked on the plot to 3.' });
      const list = keysNow();
      panelKey = viewKey();
      if (!list.length) { panelEl.append(head, h('p.graph__none', { dataset: { fk: 'g-keys-none' }, text: 'Add a curve y = f(x) to see its zeros and turning points.' })); return; }
      panelEl.append(head);
      const word = { zero: 'zero', max: 'maximum', min: 'minimum' };
      for (const k of list) {
        const items = [...k.kp.zeros.map(p => ['zero', p]), ...k.kp.maxima.map(p => ['max', p]), ...k.kp.minima.map(p => ['min', p])].sort((a, b) => a[1].x - b[1].x);
        panelEl.append(h('div.graph__kgroup', { dataset: { fk: 'g-kgroup', fn: k.name } },
          h('b', { style: { color: colorOf(k.f.ci) }, text: `${k.name}: ${k.f.curve.label}` }),
          items.length ? h('ul.graph__ix', items.map(([t, p]) => h('li', { dataset: { fk: 'g-kp', fn: k.name, type: t, x: dp(p.x, 6), y: dp(p.y, 6), rx: String(p.x), ry: String(p.y) } },
            h('span', { text: `${word[t]} (${dp(p.x, 6)}, ${dp(p.y, 6)})` }),
            p.touch ? h('small', { text: ' the curve touches the axis here' }) : null))) : h('p.graph__none', { text: 'No zeros or turning points in this view.' }),
          k.kp.capped ? h('p.graph__none', { text: `Showing the first ${GM.MAX_KEY} of each kind.` }) : null));
      }
    }

    /* the tangent at x and the area from a to b, for one y = f(x) curve */
    function calcState() {
      const live = yCurves();
      if (!live.length) return null;
      const C = S.calc;
      if (C.i >= live.length) C.i = 0;
      const cur = live[C.i];
      const num = s => { try { return GM.constant(s, NaN); } catch (e) { return NaN; } };
      const tx = num(C.tx), a = num(C.a), b = num(C.b);
      const out = { f: cur.f, name: cur.name, tx, a, b, tan: null, area: null, total: null };
      out.tan = Number.isFinite(tx) ? GM.tangentAt(cur.curve, tx) : { ok: false, why: 'type a number for x (pi works)' };
      if (Number.isFinite(a) && Number.isFinite(b)) {
        out.area = GM.integrate(cur.curve.fn, a, b);
        out.total = out.area.ok ? GM.integrate(x => Math.abs(cur.curve.fn(x)), a, b) : null;
      } else out.area = { ok: false, why: 'type a number for each end (pi works)' };
      return out;
    }
    function paintCalc() {
      clear(panelEl);
      const live = yCurves();
      if (!live.length) { panelEl.append(h('p.graph__none', { dataset: { fk: 'g-calc-none' }, text: 'Add a curve y = f(x) to find a tangent or an area under it.' })); return; }
      const C = S.calc;
      if (C.i >= live.length) C.i = 0;
      const sel = h('select.select', { 'aria-label': 'Tangent and area of which curve', dataset: { fk: 'g-calc-curve' }, onchange: e => { C.i = Number(e.target.value); paintCalcBody(); schedule(); } },
        live.map((x, i) => h('option', { value: String(i), text: `${x.name}: ${x.curve.label}`.slice(0, 48), selected: i === C.i })));
      const inp = (key, label, fk) => h('input.graph__input', { type: 'text', value: C[key], spellcheck: 'false', maxlength: '40', style: { width: '76px' }, 'aria-label': label, dataset: { fk },
        oninput: e => { C[key] = e.target.value; paintCalcBody(); schedule(); } });
      panelEl.append(
        h('div.graph__phead', sel),
        h('div.graph__phead', h('label.graph__tctl', h('span', { text: 'Tangent at x =' }), inp('tx', 'Tangent at x', 'g-tan-x')), h('small.graph__none', { text: 'or click the plot' })),
        h('div', { dataset: { fk: 'g-tan-out' } }),
        h('div.graph__phead', h('label.graph__tctl', h('span', { text: 'Area from x =' }), inp('a', 'Area from x', 'g-area-a')), h('label.graph__tctl', h('span', { text: 'to' }), inp('b', 'Area to x', 'g-area-b'))),
        h('div', { dataset: { fk: 'g-area-out' } }));
      paintCalcBody();
    }
    function paintCalcBody() {
      const tanEl = panelEl.querySelector('[data-fk="g-tan-out"]'), areaEl = panelEl.querySelector('[data-fk="g-area-out"]');
      if (!tanEl || !areaEl) return;
      const s = calcState();
      if (!s) return;
      const t = s.tan;
      const lineEq = (m, k) => lineText({ slope: m, intercept: k });
      tanEl.replaceChildren(t.ok
        ? h('p.graph__sum', { dataset: { slope: String(t.slope), intercept: String(t.intercept), x: String(t.x), y: String(t.y) } },
          h('span', { text: `At (${dp(t.x, 6)}, ${dp(t.y, 6)}) the slope is ${dp(t.slope, 6)}. Tangent: ${lineEq(Number(t.slope.toPrecision(10)), Number(t.intercept.toPrecision(10)))}.` }))
        : h('p.graph__none', { dataset: { why: t.why }, text: `No tangent: ${t.why}.` }),
      h('p.graph__note', { text: `Slope by Ridders’ method (central differences at shrinking steps, combined by Richardson extrapolation)${t.ok ? `; estimated error ${t.err.toExponential(1)}` : ''}. Shown to 6 decimal places.` }));
      const a = s.area;
      areaEl.replaceChildren(a.ok
        ? h('p.graph__sum', { dataset: { value: String(a.value), total: s.total && s.total.ok ? String(s.total.value) : '', err: String(a.err) } },
          h('span', { text: `Integral (signed area) ≈ ${dp(a.value, 6)}` }),
          s.total && s.total.ok && Math.abs(s.total.value - Math.abs(a.value)) > 1e-9 ? h('span', { text: `; counting the parts below the axis as positive, the area is ≈ ${dp(s.total.value, 6)}` }) : null,
          h('span', { text: '.' }))
        : h('p.graph__none', { dataset: { why: a.why }, text: `No area: ${a.why}.` }),
      h('p.graph__note', { text: `Adaptive Simpson’s rule, refined until the estimated error is below 0.0000000001${a.ok ? ` (estimate ${a.err.toExponential(1)}, ${a.evals} values of the curve)` : ''}. Shown to 6 decimal places.` }));
    }

    /* when the view, the curves or a slider move, work the open panel out again a moment after it settles
       (while a slider plays, at most four times a second) */
    let panelTimer = 0, panelKey = '', panelLast = 0;
    const viewKey = () => { const b = bounds(); return [b.xmin, b.xmax, b.ymin, b.ymax].map(v => v.toPrecision(8)).join(',') + '|' + S.ver; };
    function panelSoon() {
      if (S.panel !== 'inter' && S.panel !== 'keys' && S.panel !== 'calc') return;
      const k = viewKey();
      if (k === panelKey) return;
      clearTimeout(panelTimer);
      const wait = S.playing.size ? Math.max(0, 250 - (performance.now() - panelLast)) : 220;
      panelTimer = setTimeout(() => {
        if (dead) return;
        panelLast = performance.now();
        panelKey = viewKey();
        if (S.panel === 'inter') { S.inter = null; paintInter(); }
        else if (S.panel === 'keys') { S.keys = null; paintKeys(); }
        else if (S.panel === 'calc') paintCalcBody();
        schedule();
      }, wait);
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
      S.drag = { id: e.pointerId, x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      canvas.classList.add('is-grabbing');
    };
    const onMove = e => {
      const p = localPt(e);
      if (S.drag && S.drag.id === e.pointerId) {
        const dx = p.x - S.drag.x, dy = p.y - S.drag.y;
        if (Math.abs(p.x - S.drag.x0) + Math.abs(p.y - S.drag.y0) > 3) S.drag.moved = true;
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
        /* a click (no drag) with Tangent & area open moves the tangent to that x */
        if (!S.drag.moved && S.panel === 'calc' && e.type === 'pointerup') {
          const b = bounds();
          S.calc.tx = String(+(b.xmin + (localPt(e).x / S.cssW) * b.sx).toPrecision(6));
          const inp = panelEl.querySelector('[data-fk="g-tan-x"]');
          if (inp) inp.value = S.calc.tx;
          paintCalcBody();
          schedule();
        }
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
    const onAppKey = e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveGraph(); }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    appEl.addEventListener('keydown', onAppKey);

    /* ---------------- files: ~/Documents/<name>.graph ---------------- */
    function paintStatus() {
      const name = S.src.mode === 'file' ? vfs.baseName(S.src.path) : S.src.mode === 'shared' ? 'Shared graph' : '';
      win.setSubtitle(name ? `— ${name}${S.dirty ? (S.src.mode === 'file' ? ' · saving…' : ' · not saved') : ''}` : '');
    }
    function writeFile(auto) {
      clearTimeout(saveTimer);
      try {
        if (!vfs.write(S.src.path, GM.stringify(graphData(true)))) throw new Error('Documents is not available.');
        S.dirty = false;
        paintStatus();
        if (!auto) notify({ app: 'Static Graph', icon: 'save', title: 'Saved', message: S.src.path.replace(vfs.HOME, '~'), timeout: 3500 });
        return true;
      } catch (err) {
        notify({ app: 'Static Graph', icon: 'alert', title: 'Could not save', message: String(err.message || err) });
        return false;
      }
    }
    /* Save: a graph with a file saves there; one without gets a new file in Documents, and keeps it */
    function saveGraph() {
      if (S.src.mode === 'file') { writeFile(false); return S.src.path; }
      try { if (!vfs.node(DOCS)) vfs.mkdir(DOCS); } catch (e) { /* write says so */ }
      let name = 'Graph.graph';
      for (let i = 2; vfs.node(`${DOCS}/${name}`); i++) name = `Graph ${i}.graph`;
      S.src = { mode: 'file', path: `${DOCS}/${name}` };
      win.state.reopen = { path: S.src.path };
      if (!writeFile(false)) { S.src = { mode: 'scratch', path: null }; win.state.reopen = null; }
      return S.src.path;
    }
    function loadFile(path) {
      const node = vfs.node(path);
      const r = node && node.type === 'file' ? GM.parseFile(vfs.read(path) || '') : { error: 'That file is not there.' };
      if (r.error) { notify({ app: 'Static Graph', icon: 'alert', title: 'Could not open that graph', message: r.error }); return false; }
      if (S.src.mode === 'file' && S.dirty) writeFile(true);
      stopPlay();
      applyGraph(r.graph);
      S.src = { mode: 'file', path: vfs.norm(path) };
      S.dirty = false;
      win.state.reopen = { path: S.src.path };
      afterLoad();
      return true;
    }
    function afterLoad() {
      renderList();
      renderParams(true);
      paintAngle();
      paintStatus();
      refreshPanel();
      schedule();
    }
    function openMenu(anchor) {
      const files = vfs.node(DOCS) ? vfs.ls(DOCS).filter(n => n.type === 'file' && /\.graph$/i.test(n.name)) : [];
      const r = anchor.getBoundingClientRect();
      api.menu([
        ...(files.length ? files.slice(0, 20).map(n => ({ label: n.name.replace(/\.graph$/i, ''), icon: 'trending-up', onClick: () => loadFile(`${DOCS}/${n.name}`) }))
          : [{ label: 'No saved graphs in Documents', disabled: true }]),
        '-',
        { label: 'Show Documents in Files', icon: 'folder', onClick: () => api.openApp('files', { path: DOCS }) },
      ], r.left, r.bottom + 4, { label: 'Open a graph' });
    }

    /* ---------------- copy: as text, or a link that carries the graph ---------------- */
    function copyMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      api.menu([
        { label: 'Copy the functions as text', icon: 'file-text', onClick: () => copyText() },
        { label: 'Copy a link to this graph', icon: 'link', onClick: () => copyLink() },
      ], r.left, r.bottom + 4, { label: 'Copy' });
    }
    async function copyText() {
      const text = GM.asText(graphData(false));
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
      notify({ app: 'Static Graph', icon: ok ? 'copy' : 'alert', title: ok ? 'Functions copied' : 'Could not copy', message: ok ? text.split('\n').slice(0, 3).join(' · ') : 'The browser did not allow copying.', timeout: 4000 });
      return ok ? text : null;
    }
    async function copyLink() {
      const L = await import('../core/sharelink.js');
      const r = await L.packLink('graph', JSON.parse(GM.stringify(graphData(true))));
      if (dead) return null;
      if (!r.ok) { notify({ app: 'Static Graph', icon: 'alert', title: 'No link was made', message: r.error, timeout: 7000 }); return null; }
      const field = h('input.graph__link', { type: 'text', readonly: true, value: r.link, 'aria-label': 'Link to this graph', dataset: { fk: 'g-link' }, onfocus: e => e.target.select() });
      const yes = await api.confirm({
        title: 'A link to this graph',
        message: 'The functions, sliders and view travel inside this link: no server keeps them, and later changes don’t follow it. Whoever opens it in StaticOS sees the functions first and opens the graph only if they choose.',
        body: h('div.field.graph__linkf', field), ok: 'Copy link', cancel: 'Close',
      });
      if (!yes || dead) return r.link;
      let copied = false;
      try { await navigator.clipboard.writeText(r.link); copied = true; } catch (e) { copied = false; }
      notify({ app: 'Static Graph', icon: copied ? 'link' : 'alert', title: copied ? 'Link copied' : 'Copy the link yourself', message: copied ? 'Send it to whoever you want to see this graph.' : r.link.slice(0, 120), timeout: 5000 });
      return r.link;
    }
    /* a #graph= link: show what is in it, open it only when asked */
    async function openShared(frag) {
      const L = await import('../core/sharelink.js');
      const r = await L.unpackLink('graph', frag);
      const g = r.ok ? GM.cleanGraph(r.data) : null;
      if (dead) return;
      if (!g || !g.fns.length) { notify({ app: 'Static Graph', icon: 'alert', title: 'That link wasn’t opened', message: r.ok ? 'It doesn’t hold a graph Static Graph can read.' : r.error, timeout: 8000 }); return; }
      const text = GM.asText(g);
      const yes = await api.confirm({
        title: 'Open this graph?',
        message: 'Someone sent you a graph. Nothing is drawn or saved unless you press Open; it opens in this window, and Save keeps it in Documents.',
        body: h('pre.graph__pv', { dataset: { fk: 'g-shared' }, text: text || '(no functions)' }), ok: 'Open',
      });
      if (!yes || dead) return;
      stopPlay();
      applyGraph(g);
      S.src = { mode: 'shared', path: null };
      S.dirty = true;
      afterLoad();
    }

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
      appEl.classList.toggle('graph--narrow', appW < 600);
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

    /* redraw when the theme or accent changes the token colours; Reduce Motion stops Play */
    const offTheme = store.sub('prefs.theme', () => schedule());
    const offAccent = store.sub('prefs.accent', () => schedule());
    const offMotion = store.sub('prefs.reduceMotion', () => { if (reduced()) stopPlay(); renderParams(true); });

    /* ---------------- boot ---------------- */
    if (opts && opts.path && vfs.node(opts.path)) { loadScratch(); loadFile(opts.path); }
    else loadScratch();
    renderList();
    renderParams(true);
    paintAngle();
    paintStatus();
    if (opts && opts.shared) openShared(opts.shared);
    /* first measure after layout settles */
    requestAnimationFrame(() => { if (!dead) resize(); });
    root.graphPeek = () => ({
      src: { ...S.src }, dirty: !!S.dirty, angle: S.angle, panel: S.panel, playing: [...S.playing],
      params: JSON.parse(JSON.stringify(S.params)), view: { ...S.view },
      fns: S.fns.map(f => ({ ...GM.cleanFn(f), ok: !!(f.curve && f.curve.ok), error: f.error, drawn: f.drawn || 0 })),
    });

    /* ---------------- teardown ---------------- */
    return () => {
      if (S.playing.size && S.src.mode === 'scratch') persist();     /* where a playing slider stopped */
      dead = true;
      clearTimeout(panelTimer);
      if (S.src.mode === 'file' && S.dirty) { try { vfs.write(S.src.path, GM.stringify(graphData(true))); } catch (e) { /* fine */ } }
      clearTimeout(saveTimer);
      if (rafId) cancelAnimationFrame(rafId);
      if (playRaf) cancelAnimationFrame(playRaf);
      rafId = 0; playRaf = 0;
      ro.disconnect();
      offTheme(); offAccent(); offMotion();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      appEl.removeEventListener('keydown', onAppKey);
    };
  },
});
