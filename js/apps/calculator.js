/* ============================================================
   Calculator — explicit state machine (accumulator, pending op,
   replace-on-next-digit), a clickable result tape, grouped number
   formatting to 10 significant digits, and keyboard control
   that only fires while this window is the active one.

   Above the keys, a line where a whole sum can be typed at once
   ("2(3+4)² ÷ 7", "sqrt(2)") and Enter works it out with
   js/core/mathexpr.js — a parser, never eval. Answers can be shown
   as fractions (the a/b chip): mathexpr.exact() works the sum in
   BigInt fractions, so 1 ÷ 3 × 3 is exactly 1 and 0.1 + 0.2 is
   3/10; an answer with π or a root in it has no fraction, and says
   so instead of showing a lookalike. Tools has percent-of, a tip
   splitter (in whole cents) and the physical constants (SI and
   CODATA 2022, sources below); Convert sends the answer to Static
   Convert.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { evaluate, exact, exactOf, exactOp, formatResult, MathError } from '../core/mathexpr.js';
import * as FR from '../core/fractions.js';
import * as BC from '../core/bitcalc.js';
import { t as tr } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-calc-css')) {
  const l = document.createElement('link');
  l.id = 'feat-calc-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-calc.css';
  document.head.appendChild(l);
}

const OPS = {
  '+': (a, b) => a + b,
  '−': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b === 0 ? null : a / b),
};
const OPX = { '+': '+', '−': '-', '×': '*', '÷': '/' };      /* the same ops, for exactOp */
const MINUS = '−', TIMES = '×', DIV = '÷', PM = '±';

/* Physical constants, value as typed into a sum and the unit beside it.
   Exact ones are the defining constants of the SI (BIPM, The International
   System of Units, 9th edition, 2019) and values that follow from them; g is
   exact by definition (3rd CGPM, 1901) and the atmosphere by the 10th CGPM
   (1954). The rest are the CODATA 2022 recommended values as NIST publishes
   them (physics.nist.gov/cuu/Constants), with NIST's standard uncertainty. */
const CONSTANTS = [
  ['c', tr('Speed of light in vacuum'), '299792458', 'm/s', 'exact (SI)'],
  ['h', tr('Planck constant'), '6.62607015E-34', 'J·s', 'exact (SI)'],
  ['e', tr('Elementary charge'), '1.602176634E-19', 'C', 'exact (SI)'],
  ['k', tr('Boltzmann constant'), '1.380649E-23', 'J/K', 'exact (SI)'],
  ['Nₐ', tr('Avogadro constant'), '6.02214076E23', 'per mol', 'exact (SI)'],
  ['R', tr('Molar gas constant'), '8.31446261815324', 'J/(mol·K)', 'exact: Nₐ × k'],
  ['F', tr('Faraday constant'), '96485.3321233100', 'C/mol', 'exact: Nₐ × e'],
  ['σ', tr('Stefan–Boltzmann constant'), '5.67037441918443E-8', 'W/(m²·K⁴)', 'exact in the SI, 15 digits shown'],
  ['g', tr('Standard gravity'), '9.80665', 'm/s²', 'exact (CGPM 1901)'],
  ['atm', tr('Standard atmosphere'), '101325', 'Pa', 'exact (CGPM 1954)'],
  ['G', tr('Gravitational constant'), '6.67430E-11', 'm³/(kg·s²)', 'CODATA 2022, ± 0.00015E-11'],
  ['mₑ', tr('Electron mass'), '9.1093837139E-31', 'kg', 'CODATA 2022, ± 0.0000000028E-31'],
  ['mₚ', tr('Proton mass'), '1.67262192595E-27', 'kg', 'CODATA 2022, ± 0.00000000052E-27'],
  ['mₙ', tr('Neutron mass'), '1.67492750056E-27', 'kg', 'CODATA 2022, ± 0.00000000085E-27'],
  ['u', tr('Atomic mass constant'), '1.66053906892E-27', 'kg', 'CODATA 2022, ± 0.00000000052E-27'],
  ['ε₀', tr('Vacuum electric permittivity'), '8.8541878188E-12', 'F/m', 'CODATA 2022, ± 0.0000000014E-12'],
  ['μ₀', tr('Vacuum magnetic permeability'), '1.25663706127E-6', 'N/A²', 'CODATA 2022, ± 0.00000000020E-6'],
  ['α', tr('Fine-structure constant'), '7.2973525643E-3', 'no unit', 'CODATA 2022, ± 0.0000000011E-3'],
  ['R∞', tr('Rydberg constant'), '10973731.568157', 'per m', 'CODATA 2022, ± 0.000012'],
  ['a₀', tr('Bohr radius'), '5.29177210544E-11', 'm', 'CODATA 2022, ± 0.00000000082E-11'],
];
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sci10 = s => String(s).replace(/E(-?\d+)$/, (_, x) => ` × 10${[...x].map(c => SUP[c]).join('')}`);

/** 10 significant digits, exponent form only when it truly overflows. */
function raw(n) {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e12 || a < 1e-9)) return n.toExponential(5);
  return String(Number(n.toPrecision(10)));
}

/** Thousands separators without touching the decimals or exponent. */
function grouped(s) {
  const [mant, exp] = String(s).split(/[eE]/);
  const neg = mant.startsWith('-');
  const [int, dec] = (neg ? mant.slice(1) : mant).split('.');
  const gi = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const ex = /E/.test(String(s)) ? 'E' : 'e';
  return `${neg ? '-' : ''}${gi}${dec === undefined ? '' : '.' + dec}${exp ? ex + exp : ''}`;
}

/** What was typed on the line, made ready for the parser: 1,000 is a thousand, ans is Ans. */
const normLine = s => String(s).replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/\bans\b/gi, 'Ans');
const TRIG = /(?:^|[^a-z])a?(?:sin|cos|tan)(?!h)/i;

defineApp({
  id: 'calculator',
  name: 'Calculator',
  icon: 'calculator',
  g1: '#97a0b2', g2: '#495264',
  category: 'Utilities',
  keywords: ['calc', 'math', 'sum', 'arithmetic', 'percent', 'scientific', 'trig', 'sin', 'cos', 'log', 'degrees', 'radians', 'factorial', 'programmer', 'hex', 'binary', 'octal', 'bitwise', 'bits', 'xor', 'shift', 'rotate', 'twos complement', 'fraction', 'expression', 'tip', 'split the bill', 'constants', 'hyperbolic', 'root'],
  desc: tr('Quick arithmetic or a whole sum typed on one line, fraction answers, a Scientific mode with trig, logs and constants, and a Programmer mode for hex, binary and bits'),
  pinned: true, dock: true, singleton: true,
  win: { w: 370, h: 480, minW: 280, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / .', tr('Digits and the point')],
    ['Plus / - / * / /', tr('Add, subtract, multiply, divide')],
    ['%', tr('Percent')],
    ['Enter / =', tr('Equals')],
    ['Backspace', tr('Delete the last digit')],
    ['Esc / C / Delete', tr('Clear')],
    ['Mod+C', tr('Copy the result')],
    ['^', tr('Power (Scientific)')],
    ['(', tr('Open bracket (Scientific)')],
    [')', tr('Close bracket (Scientific)')],
    ['!', tr('Factorial (Scientific)')],
    ['p', tr('Insert pi (Scientific)')],
    ['e', tr('Insert e (Scientific)')],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon } = api;
    const store = api.store;

    /* ---------------- state ----------------
       x is the exact value on display (a fraction from mathexpr), xacc the
       accumulator's: they follow every key, and are null once a value can't
       be one. fresh: a recalled value, which the next digit replaces. */
    const S = { val: '0', acc: null, op: null, replace: true, expr: '', tape: [], rep: null, err: '',
      x: { n: 0n, d: 1n }, xacc: null, fresh: false, num: null };
    let fracOn = store.get('prefs.calcFrac') === true;

    /* the value on display at full precision: its exact fraction when it has
       one (so 1 ÷ 3 × 3 is 1), else the unrounded result (num), else what is shown */
    const cur = () => {
      if (S.x) { const v = Number(S.x.n) / Number(S.x.d); if (Number.isFinite(v)) return v; }
      if (S.num !== null && Number.isFinite(S.num)) return S.num;
      const n = parseFloat(S.val); return Number.isFinite(n) ? n : 0;
    };
    const fmtNum = n => grouped(raw(n));
    /** a fraction as shown: '7/3', '-1/2'; null when too long to read */
    const fracText = x => { if (!x || x.d === 1n) return null; const t = FR.frac(x); return t.length > 26 ? null : t; };
    /** with fractions on: the exact answer, a whole number shown whole (1/3 × 3 is 1, not 0.9999999999) */
    const exactShown = x => (x && x.d === 1n ? (String(x.n).length <= 15 ? grouped(String(x.n)) : null) : fracText(x));

    /* ---------------- output --------------- */
    const exprEl = h('div.calc__expr');
    const valEl = h('button.calc__val.tip', {
      'data-tip': tr('Copy result'), 'aria-label': tr('Copy result to clipboard'),
      style: { display: 'block', width: '100%', textAlign: 'right' },
      onclick: () => copy(),
    });
    const out = h('div.calc__out', exprEl, valEl);

    /* the one-line entry: a whole sum, worked out on Enter */
    const lineIn = h('input.calc__line', {
      type: 'text', spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'done',
      placeholder: tr('Type a sum, like 2(3+4)² or sqrt(2)'), 'aria-label': tr('Type a whole calculation, then press Enter'),
    });
    const lineOut = h('div.calc__lout', { role: 'status' });
    const lineWrap = h('div.calc__lwrap', lineIn, lineOut);

    /** Standard: is a result (not a number being typed) on display? */
    const stdResult = () => S.replace || S.fresh;
    function stdShown() {
      if (S.err) return 'Error';
      const f = fracOn && stdResult() ? exactShown(S.x) : null;
      return f || grouped(S.val);
    }

    function paint() {
      const shown = stdShown();
      valEl.textContent = shown;
      /* long results would ellipsise away their own tail — shrink instead */
      valEl.style.fontSize = shown.length > 13 ? 'var(--fs-18)'
        : shown.length > 10 ? 'var(--fs-24)' : 'var(--fs-34)';
      exprEl.classList.remove('calc__expr--err');
      if (S.err || S.expr) exprEl.textContent = S.err || S.expr;
      else {
        /* the tape, newest first (the line ellipsises on the right, so the
           freshest result stays visible); each one puts its number back */
        exprEl.replaceChildren(...S.tape.slice(-6).reverse().map(t => h('button.calc__tchip', {
          type: 'button', text: (fracOn && exactShown(t.x)) || fmtNum(t.r), title: `${t.e} = ${fmtNum(t.r)}`, 'aria-label': tr('Use {r}, from {e}', { r: fmtNum(t.r), e: t.e }),
          onclick: e => { e.stopPropagation(); recall(raw(t.r), t.x, t.r); },
        })));
      }
      paintAux();
    }

    /* ---------------- machine -------------- */
    function fail(msg) {
      S.err = msg; S.val = '0'; S.acc = null; S.op = null; S.rep = null; S.replace = true; S.expr = '';
      S.x = null; S.xacc = null; S.fresh = false; S.num = null;
      paint();
    }
    function clearAll(force) {
      const wasClear = !S.err && S.val === '0' && S.op === null && S.acc === null;
      S.err = ''; S.val = '0'; S.acc = null; S.op = null; S.rep = null; S.replace = true; S.expr = '';
      S.x = { n: 0n, d: 1n }; S.xacc = null; S.fresh = false; S.num = null;
      if (force || wasClear) S.tape.length = 0;
      paint();
    }
    function digit(d) {
      if (S.err) clearAll(false);
      if (S.replace || S.fresh) {
        if (S.op === null) S.expr = '';
        S.val = d === '.' ? '0.' : d;
        S.replace = false; S.fresh = false;
      } else if (d === '.') {
        if (S.val.includes('.')) return;
        S.val += '.';
      } else {
        if (S.val.replace(/[-.]/g, '').length >= 12) return;
        S.val = S.val === '0' ? d : S.val + d;
      }
      S.x = exactOf(S.val); S.num = null;
      paint();
    }
    /** put a number back on display (the tape, a constant, a tool's answer) as the next operand */
    function recall(text, x, num = null) {
      if (S.err) clearAll(false);
      S.val = String(text); S.x = x || null; S.num = num;
      if (S.op === null) { S.acc = null; S.expr = ''; }
      S.rep = null; S.replace = false; S.fresh = true;
      paint();
    }
    function fold() {
      const b = cur();
      const r = OPS[S.op](S.acc, b);
      if (r === null) { fail(tr('Cannot divide by zero')); return false; }
      if (!Number.isFinite(r)) { fail(tr('Out of range')); return false; }
      S.xacc = exactOp(S.xacc, OPX[S.op], S.x);
      S.acc = r; S.val = raw(r); S.x = S.xacc; S.num = r;
      return true;
    }
    function setOp(op) {
      if (S.err) return;
      if (S.op !== null && !S.replace) { if (!fold()) return; }
      else { S.acc = cur(); S.xacc = S.x; }
      S.op = op; S.replace = true; S.rep = null; S.fresh = false;
      S.expr = `${fmtNum(S.acc)} ${op}`;
      paint();
    }
    function equals() {
      if (S.err) return;
      let a, op, b, xa, xb;
      if (S.op !== null) { a = S.acc; op = S.op; b = cur(); xa = S.xacc; xb = S.x; }
      else if (S.rep) { a = cur(); op = S.rep.op; b = S.rep.b; xa = S.x; xb = S.rep.x; }
      else { S.expr = `${fmtNum(cur())} =`; S.replace = true; S.fresh = false; paint(); return; }
      const r = OPS[op](a, b);
      if (r === null) return fail(tr('Cannot divide by zero'));
      if (!Number.isFinite(r)) return fail(tr('Out of range'));
      const x = exactOp(xa, OPX[op], xb);
      S.expr = `${fmtNum(a)} ${op} ${fmtNum(b)} =`;
      S.val = raw(r); S.acc = null; S.op = null; S.replace = true; S.fresh = false; S.rep = { op, b, x: xb };
      S.x = x; S.xacc = null; S.num = r;
      pushTape(`${fmtNum(a)} ${op} ${fmtNum(b)}`, r, x);
      paint();
    }
    function pushTape(e, r, x) {
      S.tape.push({ e, r, x });
      while (S.tape.length > 50) S.tape.shift();
    }
    function percent() {
      if (S.err) return;
      const add = (S.op === '+' || S.op === MINUS) && S.acc !== null;
      const base = add ? S.acc : 1;
      S.num = cur() / 100 * base;
      S.val = raw(S.num);
      S.x = exactOp(exactOp(S.x, '/', { n: 100n, d: 1n }), '*', add ? S.xacc : { n: 1n, d: 1n });
      S.replace = false; S.fresh = false;
      paint();
    }
    function sign() {
      if (S.err) return;
      if (S.val === '0') return;
      S.val = S.val.startsWith('-') ? S.val.slice(1) : '-' + S.val;
      if (S.x) S.x = { n: -S.x.n, d: S.x.d };
      if (S.num !== null) S.num = -S.num;
      paint();
    }
    function back() {
      if (S.err) { clearAll(false); return; }
      if (S.replace || S.fresh) return;
      S.val = S.val.slice(0, -1);
      if (!S.val || S.val === '-') S.val = '0';
      S.x = exactOf(S.val); S.num = null;
      paint();
    }
    const shownText = () => (mode === 'prog' ? pText() : mode === 'sci' ? sciShown() : stdShown());
    async function copy() {
      const text = shownText();
      try {
        await navigator.clipboard.writeText(text);
        api.notify({ app: 'Calculator', icon: 'copy', title: tr('Copied'), message: text, timeout: 2400 });
      } catch (e) {
        api.notify({ app: 'Calculator', icon: 'alert', title: tr('Could not copy'), message: tr('The clipboard is unavailable here.') });
      }
    }

    /* ---------------- keypad --------------- */
    const KEYS = [
      { l: 'AC', k: 'fn', tip: tr('Clear · Esc'), fn: () => clearAll(false) },
      { l: PM, k: 'fn', a: tr('Toggle sign'), tip: tr('Toggle sign'), fn: sign },
      { l: '%', k: 'fn', a: tr('Percent'), tip: tr('Percent'), fn: percent },
      { l: DIV, k: 'op', a: tr('Divide'), fn: () => setOp(DIV) },
      { l: '7' }, { l: '8' }, { l: '9' }, { l: TIMES, k: 'op', a: tr('Multiply'), fn: () => setOp(TIMES) },
      { l: '4' }, { l: '5' }, { l: '6' }, { l: MINUS, k: 'op', a: tr('Subtract'), fn: () => setOp(MINUS) },
      { l: '1' }, { l: '2' }, { l: '3' }, { l: '+', k: 'op', a: tr('Add{op}', { op: '' }), fn: () => setOp('+') },
      { l: '0', span: 2 }, { l: '.', a: tr('Decimal point') },
      { l: '=', k: 'eq', a: tr('Equals'), fn: equals },
    ];

    const byLabel = new Map();
    const pad = h('div.calc__pad');
    for (const key of KEYS) {
      const btn = h(`button.calc__k${key.k ? '.calc__k--' + key.k : ''}${key.tip ? '.tip' : ''}`, {
        text: key.l,
        'aria-label': key.a || key.l,
        'data-tip': key.tip || null,
        style: key.span ? { gridColumn: `span ${key.span}` } : null,
        onclick: key.fn || (() => digit(key.l)),
      });
      byLabel.set(key.l, btn);
      pad.appendChild(btn);
    }

    /* the chips under the display: angle, 2nd and memory (Scientific),
       fraction answers (Standard and Scientific), and Convert */
    const angEl = h('button.calc__ang.tip', { 'data-tip': tr('Degrees or radians'), onclick: () => sciKey('angle') });
    const memEl = h('button.calc__mem.tip', { 'data-tip': tr('Clear memory'), 'aria-label': tr('Memory. Clear it'), onclick: () => sciKey('MC') });
    const secondBtn = h('button.calc__chip.calc__2nd.tip', { type: 'button', text: '2nd', 'data-tip': tr('Second functions: inverse hyperbolic, cube, cube root, eˣ, 10ˣ'),
      'aria-pressed': 'false', 'aria-label': tr('Second functions'), onclick: () => setSecond(!second) });
    const fracBtn = h('button.calc__chip.calc__fracbtn.tip', { type: 'button', text: 'a/b', 'data-tip': tr('Answers as fractions'),
      onclick: () => { fracOn = !fracOn; store.set('prefs.calcFrac', fracOn); repaint(); } });
    const xNote = h('span.calc__xnote', { 'aria-live': 'polite' });
    const convBtn = h('button.calc__chip.calc__conv.tip', { type: 'button', 'data-tip': tr('Open this answer in Static Convert'), 'aria-label': tr('Convert this answer in Static Convert'), onclick: sendToConvert },
      icon('refresh', { size: 12 }), h('span', { text: tr('Convert') }));
    const sciBar = h('div.calc__sbar', h('div.calc__sgrp', angEl, secondBtn, fracBtn, xNote), h('div.calc__sgrp', memEl, convBtn));

    function paintAux() {
      const sci = mode === 'sci';
      angEl.style.display = sci ? '' : 'none';
      secondBtn.style.display = sci ? '' : 'none';
      memEl.style.display = sci ? '' : 'none';
      fracBtn.style.display = mode === 'prog' ? 'none' : '';
      fracBtn.classList.toggle('is-on', fracOn);
      fracBtn.setAttribute('aria-pressed', String(fracOn));
      fracBtn.setAttribute('aria-label', fracOn ? tr('Answers as fractions: on. Show decimals') : tr('Answers as fractions: off. Show fractions'));
      /* say why there is no fraction, rather than leave a decimal unexplained */
      let note = '';
      if (fracOn && mode !== 'prog') {
        const atResult = sci ? Q.justEq && !Q.err : stdResult() && !S.err;
        const x = sci ? Q.x : S.x;
        if (atResult) note = !x ? tr('No exact fraction') : x.d === 1n ? tr('Whole number') : !fracText(x) ? tr('Fraction too long to show') : `= ${FR.mixed(x) !== FR.frac(x) ? FR.mixed(x) : FR.decimal(x)}`;
      }
      xNote.textContent = note;
    }
    const repaint = () => (mode === 'prog' ? paintProg() : mode === 'sci' ? paintSci() : paint());

    const calc = h('div.calc', lineWrap, out, sciBar, pad);
    root.appendChild(h('div.app.app--col', calc));

    /* ---------------- scientific ------------
       Its own entry line and keys; the maths is js/core/mathexpr.js (a real
       parser — no eval). Standard mode above is untouched. */
    const saved = store.get('prefs.calcSci') || {};
    const savedMode = store.get('prefs.calcMode');
    let mode = savedMode === 'sci' || savedMode === 'prog' ? savedMode : 'std';
    const Q = {
      expr: '', res: null, err: '', line: '', justEq: false, x: null,
      angle: saved.angle === 'rad' ? 'rad' : 'deg',
      mem: Number.isFinite(saved.mem) ? saved.mem : 0,
      hist: Array.isArray(saved.hist) ? saved.hist.filter(x => x && typeof x.e === 'string' && typeof x.r === 'string').slice(0, 50) : [],
    };
    const persist = () => store.set('prefs.calcSci', { angle: Q.angle, mem: Q.mem, hist: Q.hist });
    function sciShown() {
      if (Q.err) return 'Error';
      if (Q.res !== null && Q.justEq) return (fracOn && exactShown(Q.x)) || grouped(formatResult(Q.res));
      return Q.expr || '0';
    }
    const histList = h('div.calc__hlist');
    let degBtn;

    function paintSci() {
      const shown = sciShown();
      valEl.textContent = shown;
      valEl.style.fontSize = shown.length > 26 ? 'var(--fs-15)' : shown.length > 16 ? 'var(--fs-18)'
        : shown.length > 11 ? 'var(--fs-24)' : 'var(--fs-34)';
      exprEl.textContent = Q.err || Q.line;
      exprEl.classList.toggle('calc__expr--err', !!Q.err);
      valEl.scrollLeft = valEl.scrollWidth;
      angEl.textContent = Q.angle === 'deg' ? 'DEG' : 'RAD';
      angEl.setAttribute('aria-label', Q.angle === 'deg' ? tr('Angles in degrees. Switch to radians') : tr('Angles in radians. Switch to degrees'));
      memEl.textContent = Q.mem !== 0 ? `M = ${grouped(formatResult(Q.mem))}` : '';
      memEl.style.visibility = Q.mem !== 0 ? 'visible' : 'hidden';
      if (degBtn) degBtn.textContent = Q.angle === 'deg' ? tr('Deg') : tr('Rad');
      paintHist();
      paintAux();
    }
    /* History: Scientific's finished sums (a row brings the sum back), or
       Standard's tape (a row puts its answer back) */
    function paintHist() {
      if (mode === 'sci') {
        histList.replaceChildren(...(Q.hist.length ? Q.hist.map(x => h('button.calc__hrow', {
          'aria-label': tr('{e} equals {r}. Use it', { e: x.e, r: x.r }), onclick: () => sciRecall(x),
        }, h('span.calc__hexp', { text: x.e }), h('b', { text: '= ' + grouped(x.r) }))) : [h('div.calc__hempty', { text: tr('Nothing calculated yet') })]));
      } else {
        histList.replaceChildren(...(S.tape.length ? S.tape.slice().reverse().map(t => h('button.calc__hrow', {
          'aria-label': tr('{e} equals {r}. Use it', { e: t.e, r: fmtNum(t.r) }), onclick: () => { histPanel.style.display = 'none'; recall(raw(t.r), t.x, t.r); },
        }, h('span.calc__hexp', { text: t.e }), h('b', { text: '= ' + ((fracOn && fracText(t.x)) || fmtNum(t.r)) }))) : [h('div.calc__hempty', { text: tr('Nothing calculated yet') })]));
      }
    }
    const OPERATORS = /^[+−×÷^!%²ʸ]/;
    function sciPut(tok) {
      if (Q.err) { Q.err = ''; Q.expr = ''; Q.justEq = false; }
      if (Q.justEq) {
        Q.expr = OPERATORS.test(tok) ? 'Ans' : '';
        Q.justEq = false;
      }
      if (Q.expr.length >= 120) return;
      Q.expr += tok;
      paintSci();
    }
    function sciValue() {
      if (Q.expr === '' || Q.justEq) return Q.res !== null ? Q.res : 0;
      return evaluate(Q.expr, { angle: Q.angle, ans: Q.res ?? 0 });
    }
    function sciEquals() {
      if (!Q.expr || Q.justEq) return;
      try {
        const r = evaluate(Q.expr, { angle: Q.angle, ans: Q.res ?? 0 });
        const text = formatResult(r);
        Q.x = exact(Q.expr, { ans: Q.x });
        Q.hist.unshift({ e: Q.expr, r: text });
        Q.hist.length = Math.min(Q.hist.length, 50);
        Q.line = `${Q.expr} =`;
        Q.res = Number(text.replace('E', 'e')); Q.justEq = true; Q.err = '';
        persist();
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        Q.err = e.message;
      }
      paintSci();
    }
    function sciBack() {
      if (Q.err) { Q.err = ''; Q.expr = ''; paintSci(); return; }
      if (Q.justEq) { Q.justEq = false; Q.expr = ''; Q.line = ''; paintSci(); return; }
      const tail = /(?:a?(?:sin|cos|tan)h?\(|ln\(|log\(|cbrt\(|abs\(|√\(|Ans|ʸ√)$/.exec(Q.expr);
      Q.expr = Q.expr.slice(0, tail ? -tail[0].length : -1);
      paintSci();
    }
    function sciClear() { Q.expr = ''; Q.line = ''; Q.err = ''; Q.justEq = false; paintSci(); }
    function sciRecall(x) {
      Q.expr = x.e; Q.err = ''; Q.justEq = false; Q.line = '';
      histPanel.style.display = 'none';
      paintSci();
    }
    function memory(sign) {
      try {
        const v = sciValue();
        Q.mem += sign * v;
        if (!Number.isFinite(Q.mem)) { Q.mem = 0; throw new MathError('Overflow: the memory is too large'); }
        persist();
        Q.err = '';
        if (!Q.justEq) { Q.res = v; Q.x = exact(Q.expr); Q.expr = ''; Q.line = `${formatResult(v)} → memory`; Q.justEq = true; }
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        Q.err = e.message;
      }
      paintSci();
    }
    const WRAP = { 'sin⁻¹': 'asin(', 'cos⁻¹': 'acos(', 'tan⁻¹': 'atan(', sinh: 'sinh(', cosh: 'cosh(', tanh: 'tanh(',
      'sinh⁻¹': 'asinh(', 'cosh⁻¹': 'acosh(', 'tanh⁻¹': 'atanh(', '∛': 'cbrt(',
      sin: 'sin(', cos: 'cos(', tan: 'tan(', ln: 'ln(', log: 'log(', '√': '√(' };
    const TOK = { 'x²': '²', 'x³': '^3', 'xʸ': '^', 'ʸ√': 'ʸ√', 'n!': '!', '1/x': '^(−1)', EE: 'E', 'eˣ': 'e^', '10ˣ': '10^' };
    function sciKey(k) {
      if (second && k !== 'angle') setSecond(false);      /* 2nd lasts one key */
      if (k === '=') return sciEquals();
      if (k === 'AC') return sciClear();
      if (k === '⌫') return sciBack();
      if (k === 'M+') return memory(1);
      if (k === 'M−') return memory(-1);
      if (k === 'MC') { Q.mem = 0; persist(); return paintSci(); }
      if (k === 'MR') return sciPut(Q.mem < 0 ? `(${formatResult(Q.mem).replace('-', '−')})` : formatResult(Q.mem));
      if (k === 'angle') { Q.angle = Q.angle === 'deg' ? 'rad' : 'deg'; persist(); return paintSci(); }
      return sciPut(WRAP[k] || TOK[k] || k);          /* operators, digits . ( ) π e */
    }

    const SCI_KEYS = [
      'sin', 'cos', 'tan', 'angle', 'MC',
      'sin⁻¹', 'cos⁻¹', 'tan⁻¹', 'π', 'MR',
      'sinh', 'cosh', 'tanh', 'e', 'M+',
      'ln', 'log', 'x²', 'xʸ', 'M−',
      '√', 'ʸ√', '1/x', 'n!', 'EE',
    ];
    /* what 2nd turns a key into */
    const SECOND = { sinh: 'sinh⁻¹', cosh: 'cosh⁻¹', tanh: 'tanh⁻¹', 'x²': 'x³', '√': '∛', ln: 'eˣ', log: '10ˣ' };
    const SCI_LABEL = { 'sin⁻¹': tr('Inverse sine'), 'cos⁻¹': tr('Inverse cosine'), 'tan⁻¹': tr('Inverse tangent'), 'x²': tr('Square'), 'xʸ': tr('Power'),
      '√': tr('Square root'), 'ʸ√': tr('Root of any degree'), '1/x': tr('Reciprocal'), 'n!': tr('Factorial'), EE: tr('Times ten to the power'), π: tr('Pi'), e: tr('Euler’s number'),
      ln: tr('Natural logarithm'), log: 'Logarithm base 10', MC: tr('Memory clear'), MR: tr('Memory recall'), 'M+': tr('Memory add'), 'M−': tr('Memory subtract'),
      sinh: tr('Hyperbolic sine'), cosh: tr('Hyperbolic cosine'), tanh: tr('Hyperbolic tangent'), sin: tr('Sine'), cos: tr('Cosine'), tan: tr('Tangent'),
      'sinh⁻¹': tr('Inverse hyperbolic sine'), 'cosh⁻¹': tr('Inverse hyperbolic cosine'), 'tanh⁻¹': tr('Inverse hyperbolic tangent'),
      'x³': tr('Cube'), '∛': tr('Cube root'), 'eˣ': tr('e to the power'), '10ˣ': tr('Ten to the power'),
      angle: tr('Degrees or radians'), '(': tr('Open bracket'), ')': tr('Close bracket'), '⌫': tr('Backspace'), '÷': tr('Divide'), '×': tr('Multiply'),
      '−': tr('Subtract'), '+': tr('Add{op}', { op: '' }), '=': tr('Equals'), AC: tr('All clear'), '.': tr('Decimal point') };
    const sciBtns = new Map();
    const sbtn = (l, cls) => {
      const b = h(`button.calc__k.calc__k--${cls}`, {
        text: l, 'aria-label': SCI_LABEL[l] || l, 'data-k': l, onclick: () => sciKey(b.dataset.k),
      });
      sciBtns.set(l, b);
      return b;
    };
    let second = false;
    function setSecond(on) {
      second = on;
      secondBtn.classList.toggle('is-on', on);
      secondBtn.setAttribute('aria-pressed', String(on));
      for (const [k, k2] of Object.entries(SECOND)) {
        const b = sciBtns.get(k);
        if (!b) continue;
        const now = on ? k2 : k;
        b.textContent = now; b.dataset.k = now; b.setAttribute('aria-label', SCI_LABEL[now] || now);
        b.classList.toggle('is-2nd', on);
      }
    }
    const fnPad = h('div.calc__spad', ...SCI_KEYS.map(l => {
      const b = sbtn(l, 'fn');
      if (l === 'angle') degBtn = b;
      return b;
    }));
    const numPad = h('div.calc__npad', ...[
      ['AC', 'fn'], ['⌫', 'fn'], ['(', 'fn'], [')', 'fn'],
      ['7'], ['8'], ['9'], ['÷', 'op'],
      ['4'], ['5'], ['6'], ['×', 'op'],
      ['1'], ['2'], ['3'], ['−', 'op'],
      ['0'], ['.'], ['=', 'eq'], ['+', 'op'],
    ].map(([l, c]) => sbtn(l, c || 'num')));
    const histPanel = h('div.calc__hist', { style: { display: 'none' }, role: 'region', 'aria-label': tr('History') },
      h('div.calc__hhead', h('b', { text: tr('History') }),
        h('button.calc__hclear', { text: tr('Clear history'), onclick: () => { if (mode === 'sci') { Q.hist = []; persist(); paintSci(); } else { S.tape.length = 0; paint(); paintHist(); } } }),
        h('button.calc__hclose', { text: tr('Close'), onclick: () => { histPanel.style.display = 'none'; } })),
      histList);
    const sciPads = h('div.calc__sci', { style: { display: 'none' } }, fnPad, numPad);
    calc.append(sciPads, histPanel);

    /* ---------------- programmer ------------
       Integers as bit patterns (js/core/bitcalc.js, BigInt): a word size, signed
       or unsigned, four bases at once, a clickable bit display. Overflow wraps
       around (two's complement) and says so. Standard and Scientific are untouched. */
    const savedP = store.get('prefs.calcProg') || {};
    const P = {
      size: BC.SIZES.includes(savedP.size) ? savedP.size : 32,
      signed: savedP.signed !== false,
      base: BC.BASES.includes(savedP.base) ? savedP.base : 10,
      val: 0n, acc: null, op: null, replace: true, entry: '', expr: '', err: '', note: '',
    };
    const persistP = () => store.set('prefs.calcProg', { size: P.size, signed: P.signed, base: P.base });
    const OPSYM = { and: 'AND', or: 'OR', xor: 'XOR', add: '+', sub: '−', mul: '×', div: '÷', mod: 'MOD', shl: '<<', shr: '>>', rol: 'ROL', ror: 'ROR' };
    const pfmt = (u, base = P.base) => BC.group(BC.format(u, P.size, P.signed, base), base);
    const plain = (u, base = P.base) => BC.format(u, P.size, P.signed, base);
    const pText = () => (P.err ? 'Error' : plain(P.val));

    const baseEls = new Map();
    const baseRows = h('div.calc__bases', { role: 'group', 'aria-label': tr('Number base') }, ...BC.BASES.map(b => {
      const v = h('span.calc__bv', { dataset: { base: String(b) } });
      const el = h('button.calc__base', { type: 'button', dataset: { base: String(b) }, 'aria-label': tr('{name}: use as the entry base', { name: BC.BASE_NAME[b] }),
        onclick: () => { P.base = b; P.replace = true; persistP(); paintProg(); } },
        h('b', { text: BC.BASE_NAME[b] }), v);
      baseEls.set(b, { el, v });
      return el;
    }));
    const bitsEl = h('div.calc__bits', { role: 'group', 'aria-label': tr('Bits. Click a bit to flip it') });
    const sizeBtns = BC.SIZES.map(n => h('button', { type: 'button', text: String(n), dataset: { size: String(n) }, 'aria-label': tr('{n}-bit words', { n }), onclick: () => setSize(n) }));
    const sizeSeg = h('div.seg.calc__size', { role: 'group', 'aria-label': tr('Word size in bits') }, ...sizeBtns);
    const signBtn = h('button.calc__sign', { type: 'button', onclick: () => { P.signed = !P.signed; persistP(); paintProg(); } });
    const noteEl = h('div.calc__pnote', { role: 'status' });
    const progBar = h('div.calc__pbar', sizeSeg, signBtn);

    function setSize(n) {
      if (n === P.size) return;
      P.val = BC.resize(P.val, P.size, n, P.signed);
      if (P.acc !== null) P.acc = BC.resize(P.acc, P.size, n, P.signed);
      P.size = n; P.replace = true; P.note = '';
      persistP(); paintProg();
    }
    function paintProg() {
      const shown = P.err ? 'Error' : pfmt(P.val);
      valEl.textContent = shown;
      valEl.style.fontSize = shown.length > 40 ? 'var(--fs-12)' : shown.length > 26 ? 'var(--fs-15)' : shown.length > 16 ? 'var(--fs-18)' : shown.length > 11 ? 'var(--fs-24)' : 'var(--fs-34)';
      exprEl.textContent = P.err || P.expr;
      exprEl.classList.toggle('calc__expr--err', !!P.err);
      for (const [b, { el, v }] of baseEls) {
        v.textContent = pfmt(P.val, b);
        el.classList.toggle('is-on', b === P.base);
        el.setAttribute('aria-pressed', String(b === P.base));
      }
      sizeBtns.forEach(b => { const on = Number(b.dataset.size) === P.size; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      signBtn.textContent = P.signed ? tr('Signed') : tr('Unsigned');
      signBtn.setAttribute('aria-label', P.signed ? tr('Signed: the top bit is the sign. Switch to unsigned') : tr('Unsigned: all bits are the number. Switch to signed'));
      noteEl.textContent = P.note || tr('{size}-bit {kind} · overflow wraps around (two’s complement)', { size: P.size, kind: P.signed ? tr('signed') : tr('unsigned') });
      noteEl.classList.toggle('is-warn', !!P.note);
      /* the bits, high to low, sixteen to a row */
      const rows = [];
      for (let hi = P.size - 1; hi >= 0; hi -= 16) {
        const lo = Math.max(0, hi - 15);
        const cells = [];
        for (let i = hi; i >= lo; i--) {
          const on = BC.bitAt(P.val, i);
          cells.push(h('button.calc__bit', { type: 'button', class: (on ? 'is-on' : '') + (i % 4 === 3 && i !== hi ? ' is-gap' : ''), dataset: { bit: String(i) },
            role: 'switch', 'aria-checked': String(on), 'aria-label': tr('Bit {i}', { i }), title: `${tr('Bit {i}', { i })} = ${on ? 1 : 0}`, text: on ? '1' : '0',
            onclick: () => progBit(i) }));
        }
        rows.push(h('div.calc__bitrow', h('small', { text: String(hi) }), h('div.calc__bitcells', ...cells), h('small', { text: String(lo) })));
      }
      bitsEl.replaceChildren(...rows);
      for (const [k, b] of progBtns) {
        if (/^[0-9A-F]$/.test(k)) b.disabled = BC.digitValue(k) >= P.base;
      }
      paintAux();
    }
    function progClear() { P.val = 0n; P.acc = null; P.op = null; P.replace = true; P.entry = ''; P.expr = ''; P.err = ''; P.note = ''; paintProg(); }
    function progDigit(d) {
      if (P.err) progClear();
      if (BC.digitValue(d) < 0 || BC.digitValue(d) >= P.base) return;
      const next = (P.replace || P.entry === '0' ? '' : P.entry) + d;
      const mag = BC.parseDigits(next, P.base);
      if (mag === null || !BC.fits(mag, P.size, P.signed, P.base)) {
        P.note = tr('Too big for {size}-bit {kind} — the largest {base} value is {max}', { size: P.size, kind: P.signed ? tr('signed') : tr('unsigned'), base: BC.BASE_NAME[P.base], max: pfmt(BC.maxOf(P.size, P.signed) & BC.mask(P.size), P.base) });
        paintProg(); return;
      }
      if (P.replace && P.op === null) P.expr = '';
      P.entry = next; P.val = BC.wrap(mag, P.size); P.replace = false; P.note = '';
      paintProg();
    }
    function progBit(i) { if (P.err) progClear(); P.val = BC.toggleBit(P.val, i, P.size); P.replace = true; P.note = ''; paintProg(); }
    function progFold() {
      const r = BC.apply(P.op, P.acc, P.val, P.size, P.signed);
      if (r.error) { progClear(); P.err = r.error; paintProg(); return null; }
      return r;
    }
    function progOp(op) {
      if (P.err) return;
      if (P.op !== null && !P.replace) { const r = progFold(); if (!r) return; P.acc = r.u; P.val = r.u; P.note = r.overflow ? 'Overflow: the result wrapped around (two’s complement)' : ''; }
      else { P.acc = P.val; P.note = ''; }
      P.op = op; P.replace = true; P.entry = '';
      P.expr = `${pfmt(P.acc)} ${OPSYM[op]}`;
      paintProg();
    }
    function progEquals() {
      if (P.err || P.op === null) return;
      const a = P.acc, b = P.val, op = P.op;
      const r = progFold();
      if (!r) return;
      P.expr = `${pfmt(a)} ${OPSYM[op]} ${pfmt(b)} =`;
      P.val = r.u; P.acc = null; P.op = null; P.replace = true; P.entry = '';
      P.note = r.overflow ? 'Overflow: the result wrapped around (two’s complement)' : '';
      paintProg();
    }
    function progNot() { if (P.err) return; P.val = BC.not(P.val, P.size); P.replace = true; P.entry = ''; P.note = ''; paintProg(); }
    function progSign() { if (P.err) return; P.val = BC.negate(P.val, P.size); P.replace = true; P.entry = ''; P.note = ''; paintProg(); }
    function progBack() {
      if (P.err) { progClear(); return; }
      if (P.replace || !P.entry) return;
      P.entry = P.entry.slice(0, -1) || '0';
      P.val = BC.wrap(BC.parseDigits(P.entry, P.base) ?? 0n, P.size); P.note = '';
      paintProg();
    }
    const progKey = k => {
      if (/^[0-9A-F]$/.test(k)) return progDigit(k);
      switch (k) {
        case 'AC': return progClear();
        case '⌫': return progBack();
        case '±': return progSign();
        case 'NOT': return progNot();
        case '=': return progEquals();
        default: { const op = Object.keys(OPSYM).find(o => OPSYM[o] === k); if (op) progOp(op); }
      }
    };
    const PROG_KEYS = [
      ['AND', 'op'], ['OR', 'op'], ['XOR', 'op'], ['NOT', 'op'], ['AC', 'fn'], ['⌫', 'fn'],
      ['<<', 'op'], ['>>', 'op'], ['ROL', 'op'], ['ROR', 'op'], ['MOD', 'op'], ['÷', 'op'],
      ['A', 'num'], ['B', 'num'], ['7', 'num'], ['8', 'num'], ['9', 'num'], ['×', 'op'],
      ['C', 'num'], ['D', 'num'], ['4', 'num'], ['5', 'num'], ['6', 'num'], ['−', 'op'],
      ['E', 'num'], ['F', 'num'], ['1', 'num'], ['2', 'num'], ['3', 'num'], ['+', 'op'],
      ['±', 'fn'], ['0', 'num', 2], ['=', 'eq', 3],
    ];
    const PROG_LABEL = { AND: tr('Bitwise AND'), OR: tr('Bitwise OR'), XOR: tr('Bitwise XOR'), NOT: tr('Bitwise NOT'), '<<': tr('Shift left'), '>>': tr('Shift right'), ROL: tr('Rotate left'), ROR: tr('Rotate right'),
      MOD: tr('Remainder'), '±': tr('Negate'), '⌫': tr('Backspace'), AC: tr('All clear'), '=': tr('Equals'), '÷': tr('Divide'), '×': tr('Multiply'), '−': tr('Subtract'), '+': tr('Add{op}', { op: '' }) };
    const progBtns = new Map();
    const progPad = h('div.calc__ppad', ...PROG_KEYS.map(([l, c, span]) => {
      const b = h(`button.calc__k.calc__k--${c}`, { type: 'button', text: l, 'aria-label': PROG_LABEL[l] || tr('Digit {l}', { l }), 'data-k': l,
        style: span ? { gridColumn: `span ${span}` } : null, onclick: () => progKey(l) });
      progBtns.set(l, b);
      return b;
    }));
    const progPanel = h('div.calc__prog', { style: { display: 'none' } }, baseRows, bitsEl, progBar, noteEl, progPad);
    calc.append(progPanel);

    /* ---------------- the line ----------------
       A whole sum on one line. Standard works it out and puts the answer on
       the tape; Scientific takes it as its entry and works it out there, so
       it lands in History. */
    const lastAns = () => (S.tape.length ? S.tape[S.tape.length - 1] : null);
    function previewLine() {
      const src = normLine(lineIn.value);
      lineOut.classList.remove('is-err');
      if (!src.trim()) { lineOut.textContent = ''; return; }
      try {
        const r = evaluate(src, { angle: Q.angle, ans: mode === 'sci' ? (Q.res ?? 0) : (lastAns()?.r ?? 0) });
        const x = exact(src, { ans: mode === 'sci' ? Q.x : lastAns()?.x ?? null });
        const f = fracOn ? fracText(x) : null;
        lineOut.textContent = `= ${f || grouped(formatResult(r))}${TRIG.test(src) ? (Q.angle === 'deg' ? ' · ' + tr('angles in degrees') : ' · ' + tr('angles in radians')) : ''}`;
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        lineOut.textContent = '';                  /* half-typed: say nothing until Enter */
      }
    }
    function runLine() {
      const src = normLine(lineIn.value).trim();
      if (!src) return;
      if (mode === 'sci') {
        Q.expr = src.slice(0, 120); Q.justEq = false; Q.err = '';
        sciEquals();
        lineOut.textContent = Q.err ? '' : `= ${sciShown()}`;
        lineIn.select();
        return;
      }
      try {
        const last = lastAns();
        const r = evaluate(src, { angle: Q.angle, ans: last ? last.r : 0 });
        if (!Number.isFinite(r)) throw new MathError('Out of range');
        const x = exact(src, { ans: last ? last.x : null });
        S.err = ''; S.val = raw(r); S.num = r; S.x = x; S.xacc = null; S.acc = null; S.op = null; S.rep = null;
        S.replace = true; S.fresh = false; S.expr = `${src} =`;
        pushTape(src, r, x);
        paint();
        lineOut.classList.remove('is-err');
        lineOut.textContent = `= ${stdShown()}`;
        lineIn.select();
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        lineOut.classList.add('is-err');
        lineOut.textContent = e.message;
      }
    }
    lineIn.addEventListener('input', previewLine);
    lineIn.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); runLine(); }
      else if (e.key === 'Escape' && lineIn.value) { e.preventDefault(); e.stopPropagation(); lineIn.value = ''; previewLine(); }
    });

    /* ---------------- Convert ---------------- */
    function answerValue() {
      if (mode === 'prog') return P.err ? NaN : Number(BC.format(P.val, P.size, P.signed, 10));
      if (mode === 'sci') { if (Q.err) return NaN; try { return sciValue(); } catch (e) { return NaN; } }
      return S.err ? NaN : cur();
    }
    function sendToConvert() {
      const v = answerValue();
      if (!Number.isFinite(v)) { api.notify({ app: 'Calculator', icon: 'alert', title: tr('Nothing to convert'), message: tr('Work something out first.'), timeout: 2600 }); return; }
      api.openApp('convert', { value: formatResult(v).replace('E', 'e') });
    }

    /* ---------------- tools: percent, tip, constants ---------------- */
    /** an answer from a tool goes into the sum: x is its exact fraction, when it has one */
    const use = (v, x) => {
      if (!Number.isFinite(v)) return;
      toolsPanel.style.display = 'none';
      if (mode === 'sci') { sciPut(`(${formatResult(v)})`); return; }
      if (mode === 'prog') setMode('std');
      recall(raw(v), x === undefined ? exactOf(formatResult(v)) : x, v);
    };
    const box = (label, w) => h('input.calc__tin', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': label, style: w ? { width: w } : null });
    /* each box takes a number or a little sum of its own ("80 + 12"); the tool
       builds one expression from them and works it out like the line does */
    const part = el => `(${normLine(el.value).trim()})`;
    const readBox = el => { const t = normLine(el.value).trim(); if (!t) return NaN; try { return evaluate(t, { angle: Q.angle }); } catch (e) { return NaN; } };

    function percentTool() {
      const rows = [];
      const row = (fk, parts, build, suffix = '') => {
        const outEl = h('b.calc__tres', { text: '—' });
        const useBtn = h('button.calc__chip', { type: 'button', text: tr('Use'), disabled: true, 'aria-label': tr('Use this answer') });
        const boxes = parts.filter(p => p instanceof HTMLElement && p.tagName === 'INPUT');
        const run = () => {
          let v = NaN, x = null;
          if (boxes.every(b => b.value.trim())) {
            const src = build(...boxes.map(part));
            try { v = evaluate(src, { angle: Q.angle }); x = exact(src); } catch (e) { if (!(e instanceof MathError)) throw e; }
          }
          const okv = Number.isFinite(v);
          outEl.textContent = okv ? `${(fracOn && fracText(x)) || grouped(formatResult(v))}${suffix}` : '—';
          useBtn.disabled = !okv;
          useBtn.onclick = () => use(v, x);
        };
        boxes.forEach(b => b.addEventListener('input', run));
        rows.push(h('div.calc__trow', { dataset: { tool: fk } }, h('div.calc__tq', ...parts.map(p => (typeof p === 'string' ? h('span', { text: p }) : p))), h('div.calc__ta', outEl, useBtn)));
      };
      row('of', [box(tr('Percent'), '58px'), '% of', box(tr('Number'))], (p, n) => `${p}÷100×${n}`);
      row('what', [box(tr('Part')), tr('is what % of'), box(tr('Whole'))], (a, b) => `${a}÷${b}×100`, '%');
      row('change', [tr('From'), box(tr('Old value')), tr('to'), box(tr('New value'))], (a, b) => `(${b}−${a})÷abs${a}×100`, '% change');
      row('add', [box(tr('Number')), tr('plus'), box(tr('Percent to add'), '58px'), '%'], (n, p) => `${n}×(1+${p}÷100)`);
      row('off', [box(tr('Number')), tr('minus'), box(tr('Percent to take off'), '58px'), '%'], (n, p) => `${n}×(1−${p}÷100)`);
      return h('div.calc__tbody', ...rows, h('small.calc__tnote', { text: tr('Each box takes a number or a sum of its own, like 80 + 12.') }));
    }

    function tipTool() {
      const bill = box('Bill');
      const tip = box(tr('Tip percent'), '58px'); tip.value = '15';
      const people = box(tr('People'), '58px'); people.value = '1';
      const outEl = h('div.calc__tsplit', { 'aria-live': 'polite' });
      /* whole cents throughout, so the shares always add back up to the total */
      const money = c => grouped((c / 100).toFixed(2));
      function run() {
        const b = readBox(bill), t = readBox(tip), n = readBox(people);
        if (!(b >= 0) || !(t >= 0) || !Number.isInteger(n) || n < 1 || n > 1000) {
          outEl.replaceChildren(h('small.calc__tnote', { text: !Number.isInteger(n) || n < 1 ? tr('People must be a whole number, 1 or more.') : tr('Type the bill and the tip.') }));
          return;
        }
        const billC = Math.round(b * 100), tipC = Math.round(billC * t / 100), totalC = billC + tipC;
        const each = Math.floor(totalC / n), extra = totalC - each * n;
        const line = (k, v, fk, val) => h('div.calc__tline', { dataset: { fk } }, h('span', { text: k }), h('b', { text: v }),
          h('button.calc__chip', { type: 'button', text: tr('Use'), 'aria-label': tr('Use the {k}', { k: k.toLowerCase() }), onclick: () => use(val / 100) }));
        outEl.replaceChildren(
          line(tr('Tip'), money(tipC), 'tip', tipC), line(tr('Total'), money(totalC), 'total', totalC),
          n > 1 ? line(tr('Each person'), money(each + (extra ? 1 : 0)), 'each', each + (extra ? 1 : 0)) : null,
          extra ? h('small.calc__tnote', { dataset: { fk: 'cents' }, text: tr('{total} cents don’t split evenly: {extra} {who} {hi} and {rest} {who2} {lo}.', { total: totalC, extra, who: extra === 1 ? tr('person pays') : tr('people pay'), hi: money(each + 1), rest: n - extra, who2: n - extra === 1 ? tr('pays') : tr('pay'), lo: money(each) }) }) : null);
      }
      [bill, tip, people].forEach(b => b.addEventListener('input', run));
      const chips = h('div.calc__tchips', ...[10, 15, 18, 20, 25].map(p => h('button.calc__chip', { type: 'button', text: `${p}%`, 'aria-label': tr('Tip {p} percent', { p }), onclick: () => { tip.value = String(p); run(); } })));
      run();
      return h('div.calc__tbody',
        h('div.calc__trow', h('div.calc__tq', h('span', { text: tr('Bill') }), bill)),
        h('div.calc__trow', h('div.calc__tq', h('span', { text: tr('Tip') }), tip, h('span', { text: '%' }), chips)),
        h('div.calc__trow', h('div.calc__tq', h('span', { text: tr('Split between') }), people, h('span', { text: tr('people') }))),
        outEl,
        h('small.calc__tnote', { text: tr('Rounded to the nearest cent (a hundredth), the way it is paid.') }));
    }

    function constantsTool() {
      return h('div.calc__tbody.calc__tconsts',
        h('small.calc__tnote', { text: tr('Exact ones are fixed by the SI (BIPM, 2019); the rest are CODATA 2022 values from NIST, with their uncertainty. Click one to put it in the sum.') }),
        ...CONSTANTS.map(([sym, name, val, unit, src]) => h('button.calc__crow', {
          type: 'button', dataset: { sym }, title: `${name} = ${val} ${unit} (${src})`, 'aria-label': tr('{name}, {val} {unit}, {src}. Use it', { name, val: sci10(val), unit, src }),
          onclick: () => {
            toolsPanel.style.display = 'none';
            if (mode === 'sci') sciPut(`(${val})`);
            else { if (mode === 'prog') setMode('std'); recall(val.replace('E', 'e'), null); }
          },
        }, h('b.calc__csym', { text: sym }), h('span.calc__cname', h('span', { text: name }), h('small', { text: src })), h('span.calc__cval', { text: `${sci10(val)} ${unit}` }))));
    }

    const TOOLS = [['percent', tr('Percent'), percentTool], ['tip', tr('Tip and split'), tipTool], ['constants', tr('Constants'), constantsTool]];
    let toolTab = 'percent';
    const toolBody = h('div.calc__tscroll');
    const toolSeg = h('div.calc__tseg', { role: 'tablist', 'aria-label': tr('Tools') }, ...TOOLS.map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', text: label, dataset: { tool: id }, onclick: () => showTool(id) })));
    function showTool(id) {
      toolTab = id;
      for (const b of toolSeg.children) { const on = b.dataset.tool === id; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); }
      toolBody.replaceChildren(TOOLS.find(t => t[0] === id)[2]());
    }
    const toolsPanel = h('div.calc__tools', { style: { display: 'none' }, role: 'region', 'aria-label': tr('Tools') },
      h('div.calc__hhead', toolSeg, h('button.calc__hclose.calc__tx', { type: 'button', 'aria-label': tr('Close tools'), onclick: () => { toolsPanel.style.display = 'none'; } }, icon('x', { size: 13 }))),
      toolBody);
    calc.append(toolsPanel);

    /* History and Tools sit with the chips under the display: the title bar of
       a calculator-sized window has no room for more */
    const histBtn = h('button.calc__chip.calc__ichip.tip', { type: 'button', 'data-tip': tr('History'), 'aria-label': tr('History'), style: { display: 'none' },
      onclick: () => { toolsPanel.style.display = 'none'; paintHist(); histPanel.style.display = histPanel.style.display === 'none' ? 'flex' : 'none'; } }, icon('clock', { size: 12 }));
    const toolsBtn = h('button.calc__chip.calc__ichip.tip', { type: 'button', 'data-tip': tr('Percent, tip and constants'), 'aria-label': tr('Tools: percent, tip and constants'),
      onclick: () => { histPanel.style.display = 'none'; if (toolsPanel.style.display === 'none') { showTool(toolTab); toolsPanel.style.display = 'flex'; } else toolsPanel.style.display = 'none'; } }, icon('sliders', { size: 12 }));
    convBtn.before(histBtn, toolsBtn);
    const segStd = h('button', { text: tr('Standard'), type: 'button', onclick: () => setMode('std') });
    const segSci = h('button', { text: tr('Scientific'), type: 'button', onclick: () => setMode('sci') });
    const segProg = h('button', { text: tr('Programmer'), type: 'button', onclick: () => setMode('prog') });
    const seg = h('div.seg', { role: 'group', 'aria-label': tr('Calculator mode') }, segStd, segSci, segProg);
    const NEED = { sci: { w: 560, h: 560 }, prog: { w: 560, h: 640 } };
    let grew = null;
    function setMode(m, quiet) {
      mode = m;
      if (!quiet) store.set('prefs.calcMode', m);
      const sci = m === 'sci', prog = m === 'prog', big = sci || prog;
      segStd.classList.toggle('is-on', m === 'std'); segSci.classList.toggle('is-on', sci); segProg.classList.toggle('is-on', prog);
      segStd.setAttribute('aria-pressed', String(m === 'std')); segSci.setAttribute('aria-pressed', String(sci)); segProg.setAttribute('aria-pressed', String(prog));
      pad.style.display = big ? 'none' : '';
      sciPads.style.display = sci ? '' : 'none';
      lineWrap.style.display = prog ? 'none' : '';
      progPanel.style.display = prog ? '' : 'none';
      histBtn.style.display = prog ? 'none' : '';
      toolsBtn.style.display = prog ? 'none' : '';
      histPanel.style.display = 'none';
      toolsPanel.style.display = 'none';
      if (second) setSecond(false);
      calc.classList.toggle('calc--sci', sci);
      calc.classList.toggle('calc--prog', prog);
      win.el.dataset.calcMode = m;
      /* room for the extra keys, and back again unless the window was resized meanwhile */
      const r = win.rect, need = NEED[m];
      if (need && (r.w < need.w || (prog && r.h < need.h)) && !win.max && !win.snapped) {
        grew = { from: grew ? grew.from : r, to: { ...r, w: Math.max(r.w, need.w), h: Math.max(r.h, need.h) } };
        api.wm.setRect(win, grew.to);
      } else if (!need && grew && !win.max && !win.snapped && r.w === grew.to.w && r.h === grew.to.h) {
        api.wm.setRect(win, grew.from);
        grew = null;
      } else if (!need) grew = null;
      if (prog) paintProg(); else if (sci) paintSci(); else paint();
      previewLine();
    }

    win.setTools(
      seg,
      h('button.ibtn.tip', { 'data-tip': tr('Copy result'), 'aria-label': tr('Copy result'), onclick: () => copy() }, icon('copy')),
      h('button.ibtn.tip', { 'data-tip': tr('Clear tape'), 'aria-label': tr('Clear tape'), onclick: () => (mode === 'prog' ? progClear() : mode === 'sci' ? sciClear() : clearAll(true)) }, icon('rotate-ccw')),
    );
    paint();
    setMode(mode, true);

    /* ---------------- keyboard ------------- */
    const KEYMAP = {
      '/': DIV, '*': TIMES, x: TIMES, X: TIMES, '-': MINUS, '+': '+',
      '%': '%', '=': '=', Enter: '=', Escape: 'AC', c: 'AC', C: 'AC', Delete: 'AC',
    };
    const flash = btn => btn.animate && btn.animate(
      [{ transform: 'scale(.93)' }, { transform: 'none' }], { duration: 150, easing: 'ease-out' });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); copy(); }
        return;
      }
      if (e.altKey) return;
      if (mode === 'prog') {
        const PK = { '&': 'AND', '|': 'OR', '^': 'XOR', '~': 'NOT', '<': '<<', '>': '>>', '+': '+', '-': '−', '*': '×', x: '×', '/': '÷', '%': 'MOD',
          '=': '=', Enter: '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC' };
        const k = /^[0-9a-fA-F]$/.test(e.key) ? e.key.toUpperCase() : PK[e.key];
        if (!k) return;
        e.preventDefault();
        progKey(k);
        const b = progBtns.get(k);
        if (b) flash(b);
        return;
      }
      if (mode === 'sci') {
        const SK = { '/': '÷', '*': '×', x: '×', X: '×', '-': '−', '+': '+', '^': 'xʸ', '!': 'n!', p: 'π', e: 'e', E: 'EE',
          '(': '(', ')': ')', '%': '%', '=': '=', Enter: '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC', c: 'AC', C: 'AC' };
        const k = /^[0-9]$/.test(e.key) ? e.key : (e.key === '.' || e.key === ',') ? '.' : SK[e.key];
        if (!k) return;
        e.preventDefault();
        if (k === '%') sciPut('%'); else sciKey(k);
        const b = sciBtns.get(k);
        if (b) flash(b);
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); back(); flash(byLabel.get('AC')); return; }
      const label = /^[0-9]$/.test(e.key) ? e.key
        : (e.key === '.' || e.key === ',') ? '.'
        : KEYMAP[e.key] || null;
      if (!label) return;
      e.preventDefault();
      const btn = byLabel.get(label);
      if (!btn) return;
      btn.click();
      flash(btn);
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  },
});
