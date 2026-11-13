/* ============================================================
   Calculator — explicit state machine (accumulator, pending op,
   replace-on-next-digit), a 6-deep result tape, grouped number
   formatting to 10 significant digits, and keyboard control
   that only fires while this window is the active one.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { evaluate, formatResult, MathError } from '../core/mathexpr.js';
import * as BC from '../core/bitcalc.js';

const OPS = {
  '+': (a, b) => a + b,
  '−': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b === 0 ? null : a / b),
};
const MINUS = '−', TIMES = '×', DIV = '÷', PM = '±';

/** 10 significant digits, exponent form only when it truly overflows. */
function raw(n) {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e12 || a < 1e-9)) return n.toExponential(5);
  return String(Number(n.toPrecision(10)));
}

/** Thousands separators without touching the decimals or exponent. */
function grouped(s) {
  const [mant, exp] = String(s).split('e');
  const neg = mant.startsWith('-');
  const [int, dec] = (neg ? mant.slice(1) : mant).split('.');
  const gi = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${gi}${dec === undefined ? '' : '.' + dec}${exp ? 'e' + exp : ''}`;
}

defineApp({
  id: 'calculator',
  name: 'Calculator',
  icon: 'calculator',
  g1: '#97a0b2', g2: '#495264',
  category: 'Utilities',
  keywords: ['calc', 'math', 'sum', 'arithmetic', 'percent', 'scientific', 'trig', 'sin', 'cos', 'log', 'degrees', 'radians', 'factorial', 'programmer', 'hex', 'binary', 'octal', 'bitwise', 'bits', 'xor', 'shift', 'rotate', 'twos complement'],
  desc: 'Quick arithmetic, a Scientific mode with trig, logs and memory, and a Programmer mode for hex, binary and bits',
  pinned: true, dock: true, singleton: true,
  win: { w: 280, h: 400, minW: 260, minH: 360 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / .', 'Digits and the point'],
    ['Plus / - / * / /', 'Add, subtract, multiply, divide'],
    ['%', 'Percent'],
    ['Enter / =', 'Equals'],
    ['Backspace', 'Delete the last digit'],
    ['Esc / C / Delete', 'Clear'],
    ['Mod+C', 'Copy the result'],
    ['^', 'Power (Scientific)'],
    ['(', 'Open bracket (Scientific)'],
    [')', 'Close bracket (Scientific)'],
    ['!', 'Factorial (Scientific)'],
    ['p', 'Insert pi (Scientific)'],
    ['e', 'Insert e (Scientific)'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon } = api;

    /* ---------------- state ---------------- */
    const S = { val: '0', acc: null, op: null, replace: true, expr: '', tape: [], rep: null, err: '' };

    const cur = () => { const n = parseFloat(S.val); return Number.isFinite(n) ? n : 0; };
    const fmtNum = n => grouped(raw(n));

    /* ---------------- output --------------- */
    const exprEl = h('div.calc__expr');
    const valEl = h('button.calc__val.tip', {
      'data-tip': 'Copy result', 'aria-label': 'Copy result to clipboard',
      style: { display: 'block', width: '100%', textAlign: 'right' },
      onclick: () => copy(),
    });
    const out = h('div.calc__out', exprEl, valEl);

    function paint() {
      const shown = S.err ? 'Error' : grouped(S.val);
      valEl.textContent = shown;
      /* long results would ellipsise away their own tail — shrink instead */
      valEl.style.fontSize = shown.length > 13 ? 'var(--fs-18)'
        : shown.length > 10 ? 'var(--fs-24)' : 'var(--fs-34)';
      /* newest first: the line ellipsises on the right, so the freshest result stays visible */
      exprEl.textContent = S.err || S.expr || S.tape.slice().reverse().map(fmtNum).join('   ·   ');
    }

    /* ---------------- machine -------------- */
    function fail(msg) {
      S.err = msg; S.val = '0'; S.acc = null; S.op = null; S.rep = null; S.replace = true; S.expr = '';
      paint();
    }
    function clearAll(force) {
      const wasClear = !S.err && S.val === '0' && S.op === null && S.acc === null;
      S.err = ''; S.val = '0'; S.acc = null; S.op = null; S.rep = null; S.replace = true; S.expr = '';
      if (force || wasClear) S.tape.length = 0;
      paint();
    }
    function digit(d) {
      if (S.err) clearAll(false);
      if (S.replace) {
        if (S.op === null) S.expr = '';
        S.val = d === '.' ? '0.' : d;
        S.replace = false;
      } else if (d === '.') {
        if (S.val.includes('.')) return;
        S.val += '.';
      } else {
        if (S.val.replace(/[-.]/g, '').length >= 12) return;
        S.val = S.val === '0' ? d : S.val + d;
      }
      paint();
    }
    function fold() {
      const b = cur();
      const r = OPS[S.op](S.acc, b);
      if (r === null) { fail('Cannot divide by zero'); return false; }
      if (!Number.isFinite(r)) { fail('Out of range'); return false; }
      S.acc = r; S.val = raw(r);
      return true;
    }
    function setOp(op) {
      if (S.err) return;
      if (S.op !== null && !S.replace) { if (!fold()) return; }
      else S.acc = cur();
      S.op = op; S.replace = true; S.rep = null;
      S.expr = `${fmtNum(S.acc)} ${op}`;
      paint();
    }
    function equals() {
      if (S.err) return;
      let a, op, b;
      if (S.op !== null) { a = S.acc; op = S.op; b = cur(); }
      else if (S.rep) { a = cur(); op = S.rep.op; b = S.rep.b; }
      else { S.expr = `${fmtNum(cur())} =`; S.replace = true; paint(); return; }
      const r = OPS[op](a, b);
      if (r === null) return fail('Cannot divide by zero');
      if (!Number.isFinite(r)) return fail('Out of range');
      S.expr = `${fmtNum(a)} ${op} ${fmtNum(b)} =`;
      S.val = raw(r); S.acc = null; S.op = null; S.replace = true; S.rep = { op, b };
      S.tape.push(r);
      while (S.tape.length > 6) S.tape.shift();
      paint();
    }
    function percent() {
      if (S.err) return;
      const base = (S.op === '+' || S.op === MINUS) && S.acc !== null ? S.acc : 1;
      S.val = raw(cur() / 100 * base);
      S.replace = false;
      paint();
    }
    function sign() {
      if (S.err) return;
      if (S.val === '0') return;
      S.val = S.val.startsWith('-') ? S.val.slice(1) : '-' + S.val;
      paint();
    }
    function back() {
      if (S.err) { clearAll(false); return; }
      if (S.replace) return;
      S.val = S.val.slice(0, -1);
      if (!S.val || S.val === '-') S.val = '0';
      paint();
    }
    async function copy() {
      const text = mode === 'prog' ? pText() : mode === 'sci' ? sciCopyText() : S.err ? 'Error' : grouped(S.val);
      try {
        await navigator.clipboard.writeText(text);
        api.notify({ app: 'Calculator', icon: 'copy', title: 'Copied', message: text, timeout: 2400 });
      } catch (e) {
        api.notify({ app: 'Calculator', icon: 'alert', title: 'Could not copy', message: 'The clipboard is unavailable here.' });
      }
    }

    /* ---------------- keypad --------------- */
    const KEYS = [
      { l: 'AC', k: 'fn', tip: 'Clear · Esc', fn: () => clearAll(false) },
      { l: PM, k: 'fn', a: 'Toggle sign', tip: 'Toggle sign', fn: sign },
      { l: '%', k: 'fn', a: 'Percent', tip: 'Percent', fn: percent },
      { l: DIV, k: 'op', a: 'Divide', fn: () => setOp(DIV) },
      { l: '7' }, { l: '8' }, { l: '9' }, { l: TIMES, k: 'op', a: 'Multiply', fn: () => setOp(TIMES) },
      { l: '4' }, { l: '5' }, { l: '6' }, { l: MINUS, k: 'op', a: 'Subtract', fn: () => setOp(MINUS) },
      { l: '1' }, { l: '2' }, { l: '3' }, { l: '+', k: 'op', a: 'Add', fn: () => setOp('+') },
      { l: '0', span: 2 }, { l: '.', a: 'Decimal point' },
      { l: '=', k: 'eq', a: 'Equals', fn: equals },
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

    const calc = h('div.calc', out, pad);
    root.appendChild(h('div.app.app--col', calc));

    /* ---------------- scientific ------------
       Its own entry line and keys; the maths is js/core/mathexpr.js (a real
       parser — no eval). Standard mode above is untouched. */
    const store = api.store;
    const saved = store.get('prefs.calcSci') || {};
    const savedMode = store.get('prefs.calcMode');
    let mode = savedMode === 'sci' || savedMode === 'prog' ? savedMode : 'std';
    const Q = {
      expr: '', res: null, err: '', line: '', justEq: false,
      angle: saved.angle === 'rad' ? 'rad' : 'deg',
      mem: Number.isFinite(saved.mem) ? saved.mem : 0,
      hist: Array.isArray(saved.hist) ? saved.hist.filter(x => x && typeof x.e === 'string' && typeof x.r === 'string').slice(0, 50) : [],
    };
    const persist = () => store.set('prefs.calcSci', { angle: Q.angle, mem: Q.mem, hist: Q.hist });
    const sciCopyText = () => Q.err ? 'Error' : Q.res !== null && Q.justEq ? grouped(formatResult(Q.res)) : (Q.expr || '0');
    const memEl = h('button.calc__mem.tip', { 'data-tip': 'Clear memory', 'aria-label': 'Memory. Clear it', onclick: () => sciKey('MC') });
    const angEl = h('button.calc__ang.tip', { 'data-tip': 'Degrees or radians', onclick: () => sciKey('angle') });
    const sciBar = h('div.calc__sbar', angEl, memEl);
    const histList = h('div.calc__hlist');
    let degBtn;

    function paintSci() {
      const shown = Q.err ? 'Error' : Q.res !== null && Q.justEq ? grouped(formatResult(Q.res)) : (Q.expr || '0');
      valEl.textContent = shown;
      valEl.style.fontSize = shown.length > 26 ? 'var(--fs-15)' : shown.length > 16 ? 'var(--fs-18)'
        : shown.length > 11 ? 'var(--fs-24)' : 'var(--fs-34)';
      exprEl.textContent = Q.err || Q.line;
      exprEl.classList.toggle('calc__expr--err', !!Q.err);
      valEl.scrollLeft = valEl.scrollWidth;
      angEl.textContent = Q.angle === 'deg' ? 'DEG' : 'RAD';
      angEl.setAttribute('aria-label', Q.angle === 'deg' ? 'Angles in degrees. Switch to radians' : 'Angles in radians. Switch to degrees');
      memEl.textContent = Q.mem !== 0 ? `M = ${grouped(formatResult(Q.mem))}` : '';
      memEl.style.visibility = Q.mem !== 0 ? 'visible' : 'hidden';
      if (degBtn) degBtn.textContent = Q.angle === 'deg' ? 'Deg' : 'Rad';
      histList.replaceChildren(...(Q.hist.length ? Q.hist.map(x => h('button.calc__hrow', {
        'aria-label': `${x.e} equals ${x.r}. Use it`, onclick: () => sciRecall(x),
      }, h('span.calc__hexp', { text: x.e }), h('b', { text: '= ' + grouped(x.r) }))) : [h('div.calc__hempty', { text: 'Nothing calculated yet' })]));
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
      const tail = /(?:a?(?:sin|cos|tan)h?\(|ln\(|log\(|√\(|Ans|ʸ√)$/.exec(Q.expr);
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
        if (!Q.justEq) { Q.res = v; Q.expr = ''; Q.line = `${formatResult(v)} → memory`; Q.justEq = true; }
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        Q.err = e.message;
      }
      paintSci();
    }
    const WRAP = { 'sin⁻¹': 'asin(', 'cos⁻¹': 'acos(', 'tan⁻¹': 'atan(', sinh: 'sinh(', cosh: 'cosh(', tanh: 'tanh(',
      sin: 'sin(', cos: 'cos(', tan: 'tan(', ln: 'ln(', log: 'log(', '√': '√(' };
    const TOK = { 'x²': '²', 'xʸ': '^', 'ʸ√': 'ʸ√', 'n!': '!', '1/x': '^(−1)', EE: 'E' };
    function sciKey(k) {
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
    const SCI_LABEL = { 'sin⁻¹': 'Inverse sine', 'cos⁻¹': 'Inverse cosine', 'tan⁻¹': 'Inverse tangent', 'x²': 'Square', 'xʸ': 'Power',
      '√': 'Square root', 'ʸ√': 'Root of any degree', '1/x': 'Reciprocal', 'n!': 'Factorial', EE: 'Times ten to the power', π: 'Pi', e: 'Euler’s number',
      ln: 'Natural logarithm', log: 'Logarithm base 10', MC: 'Memory clear', MR: 'Memory recall', 'M+': 'Memory add', 'M−': 'Memory subtract',
      sinh: 'Hyperbolic sine', cosh: 'Hyperbolic cosine', tanh: 'Hyperbolic tangent', sin: 'Sine', cos: 'Cosine', tan: 'Tangent',
      angle: 'Degrees or radians', '(': 'Open bracket', ')': 'Close bracket', '⌫': 'Backspace', '÷': 'Divide', '×': 'Multiply',
      '−': 'Subtract', '+': 'Add', '=': 'Equals', AC: 'All clear', '.': 'Decimal point' };
    const sciBtns = new Map();
    const sbtn = (l, cls) => {
      const b = h(`button.calc__k.calc__k--${cls}`, {
        text: l, 'aria-label': SCI_LABEL[l] || l, 'data-k': l, onclick: () => sciKey(l),
      });
      sciBtns.set(l, b);
      return b;
    };
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
    const histPanel = h('div.calc__hist', { style: { display: 'none' }, role: 'region', 'aria-label': 'History' },
      h('div.calc__hhead', h('b', { text: 'History' }),
        h('button.calc__hclear', { text: 'Clear history', onclick: () => { Q.hist = []; persist(); paintSci(); } }),
        h('button.calc__hclose', { text: 'Close', onclick: () => { histPanel.style.display = 'none'; } })),
      histList);
    const sciPads = h('div.calc__sci', { style: { display: 'none' } }, fnPad, numPad);
    calc.append(sciBar, sciPads, histPanel);
    sciBar.style.display = 'none';

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
    const baseRows = h('div.calc__bases', { role: 'group', 'aria-label': 'Number base' }, ...BC.BASES.map(b => {
      const v = h('span.calc__bv', { dataset: { base: String(b) } });
      const el = h('button.calc__base', { type: 'button', dataset: { base: String(b) }, 'aria-label': `${BC.BASE_NAME[b]}: use as the entry base`,
        onclick: () => { P.base = b; P.replace = true; persistP(); paintProg(); } },
        h('b', { text: BC.BASE_NAME[b] }), v);
      baseEls.set(b, { el, v });
      return el;
    }));
    const bitsEl = h('div.calc__bits', { role: 'group', 'aria-label': 'Bits. Click a bit to flip it' });
    const sizeBtns = BC.SIZES.map(n => h('button', { type: 'button', text: String(n), dataset: { size: String(n) }, 'aria-label': `${n}-bit words`, onclick: () => setSize(n) }));
    const sizeSeg = h('div.seg.calc__size', { role: 'group', 'aria-label': 'Word size in bits' }, ...sizeBtns);
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
      signBtn.textContent = P.signed ? 'Signed' : 'Unsigned';
      signBtn.setAttribute('aria-label', P.signed ? 'Signed: the top bit is the sign. Switch to unsigned' : 'Unsigned: all bits are the number. Switch to signed');
      noteEl.textContent = P.note || `${P.size}-bit ${P.signed ? 'signed' : 'unsigned'} · overflow wraps around (two’s complement)`;
      noteEl.classList.toggle('is-warn', !!P.note);
      /* the bits, high to low, sixteen to a row */
      const rows = [];
      for (let hi = P.size - 1; hi >= 0; hi -= 16) {
        const lo = Math.max(0, hi - 15);
        const cells = [];
        for (let i = hi; i >= lo; i--) {
          const on = BC.bitAt(P.val, i);
          cells.push(h('button.calc__bit', { type: 'button', class: (on ? 'is-on' : '') + (i % 4 === 3 && i !== hi ? ' is-gap' : ''), dataset: { bit: String(i) },
            role: 'switch', 'aria-checked': String(on), 'aria-label': `Bit ${i}`, title: `Bit ${i} = ${on ? 1 : 0}`, text: on ? '1' : '0',
            onclick: () => progBit(i) }));
        }
        rows.push(h('div.calc__bitrow', h('small', { text: String(hi) }), h('div.calc__bitcells', ...cells), h('small', { text: String(lo) })));
      }
      bitsEl.replaceChildren(...rows);
      for (const [k, b] of progBtns) {
        if (/^[0-9A-F]$/.test(k)) b.disabled = BC.digitValue(k) >= P.base;
      }
    }
    function progClear() { P.val = 0n; P.acc = null; P.op = null; P.replace = true; P.entry = ''; P.expr = ''; P.err = ''; P.note = ''; paintProg(); }
    function progDigit(d) {
      if (P.err) progClear();
      if (BC.digitValue(d) < 0 || BC.digitValue(d) >= P.base) return;
      const next = (P.replace || P.entry === '0' ? '' : P.entry) + d;
      const mag = BC.parseDigits(next, P.base);
      if (mag === null || !BC.fits(mag, P.size, P.signed, P.base)) {
        P.note = `Too big for ${P.size}-bit ${P.signed ? 'signed' : 'unsigned'} — the largest ${BC.BASE_NAME[P.base]} value is ${pfmt(BC.maxOf(P.size, P.signed) & BC.mask(P.size), P.base)}`;
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
    const PROG_LABEL = { AND: 'Bitwise AND', OR: 'Bitwise OR', XOR: 'Bitwise XOR', NOT: 'Bitwise NOT', '<<': 'Shift left', '>>': 'Shift right', ROL: 'Rotate left', ROR: 'Rotate right',
      MOD: 'Remainder', '±': 'Negate', '⌫': 'Backspace', AC: 'All clear', '=': 'Equals', '÷': 'Divide', '×': 'Multiply', '−': 'Subtract', '+': 'Add' };
    const progBtns = new Map();
    const progPad = h('div.calc__ppad', ...PROG_KEYS.map(([l, c, span]) => {
      const b = h(`button.calc__k.calc__k--${c}`, { type: 'button', text: l, 'aria-label': PROG_LABEL[l] || `Digit ${l}`, 'data-k': l,
        style: span ? { gridColumn: `span ${span}` } : null, onclick: () => progKey(l) });
      progBtns.set(l, b);
      return b;
    }));
    const progPanel = h('div.calc__prog', { style: { display: 'none' } }, baseRows, bitsEl, progBar, noteEl, progPad);
    calc.append(progPanel);

    const histBtn = h('button.ibtn.tip', { 'data-tip': 'History', 'aria-label': 'History', style: { display: 'none' },
      onclick: () => { histPanel.style.display = histPanel.style.display === 'none' ? 'flex' : 'none'; } }, icon('clock'));
    const segStd = h('button', { text: 'Standard', type: 'button', onclick: () => setMode('std') });
    const segSci = h('button', { text: 'Scientific', type: 'button', onclick: () => setMode('sci') });
    const segProg = h('button', { text: 'Programmer', type: 'button', onclick: () => setMode('prog') });
    const seg = h('div.seg', { role: 'group', 'aria-label': 'Calculator mode' }, segStd, segSci, segProg);
    const NEED = { sci: { w: 540, h: 500 }, prog: { w: 560, h: 600 } };
    let grew = null;
    function setMode(m, quiet) {
      mode = m;
      if (!quiet) store.set('prefs.calcMode', m);
      const sci = m === 'sci', prog = m === 'prog', big = sci || prog;
      segStd.classList.toggle('is-on', m === 'std'); segSci.classList.toggle('is-on', sci); segProg.classList.toggle('is-on', prog);
      segStd.setAttribute('aria-pressed', String(m === 'std')); segSci.setAttribute('aria-pressed', String(sci)); segProg.setAttribute('aria-pressed', String(prog));
      pad.style.display = big ? 'none' : '';
      sciPads.style.display = sci ? '' : 'none';
      sciBar.style.display = sci ? '' : 'none';
      progPanel.style.display = prog ? '' : 'none';
      histBtn.style.display = sci ? '' : 'none';
      histPanel.style.display = 'none';
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
    }

    win.setTools(
      seg,
      histBtn,
      h('button.ibtn.tip', { 'data-tip': 'Copy result', 'aria-label': 'Copy result', onclick: () => copy() }, icon('copy')),
      h('button.ibtn.tip', { 'data-tip': 'Clear tape', 'aria-label': 'Clear tape', onclick: () => (mode === 'prog' ? progClear() : mode === 'sci' ? sciClear() : clearAll(true)) }, icon('rotate-ccw')),
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
