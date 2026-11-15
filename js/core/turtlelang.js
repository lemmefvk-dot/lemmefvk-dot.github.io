/* ============================================================
   turtlelang.js — the little Logo-style language behind Turtle.

   It is an interpreter, not eval: the program is read into tokens, parsed
   into a tree and walked by this file. It can only move the turtle and do
   sums — no page, no network, no storage — and it is stopped by limits
   (steps, lines, depth) so a loop that never ends ends with a message.

     runTurtle(source) -> {
       segments: [{ x1, y1, x2, y2, color, width }]   what was drawn
       trail:    [{ x, y, heading, n }]               the turtle after each move; n = segments so far
       turtle:   { x, y, heading, pen, visible, color }
       bg:       colour or null
       output:   [text, …]                            from `print`
       stats:    { lines, repeats, procs, calls, vars, colours, closed }
       error:    null | { line, message }
     }

   x goes right and y goes up from the middle of the picture, in steps;
   heading 0 is up, and `right` turns clockwise.

   Words (case does not matter; a ; starts a comment):
     forward n (fd)    back n (bk)    left n (lt)    right n (rt)
     penup (pu)   pendown (pd)   home   setxy x y   setheading n (seth)
     color name   (colour; a name like red, a #code, or hue n for a colour wheel angle)
     width n (pensize)      circle r      dot size
     hideturtle (ht)   showturtle (st)    clear (cs)   background name (bg)
     repeat n [ … ]      if test [ … ]      ifelse test [ … ] [ … ]
     make "name value    and :name in a sum       print value
     to name :a :b … end         then  name 10 20  runs it
     sums: + - * / % ( ) < > = <= >=   and random n, sqrt n, sin n, cos n, abs n, round n
   ============================================================ */

export const LIMITS = { steps: 400000, lines: 40000, depth: 60, repeat: 100000 };

export const COLOURS = {
  black: '#1b1b1f', white: '#ffffff', red: '#e5484d', orange: '#f76b15', yellow: '#f7d531', green: '#30a46c', lime: '#99d52a', blue: '#3b82f6',
  navy: '#1e3a8a', purple: '#8e4ec6', violet: '#a78bfa', pink: '#ec6bb4', magenta: '#d6409f', brown: '#8b5e3c', grey: '#8b8d98', gray: '#8b8d98',
  cyan: '#05a2c2', teal: '#12a594', sky: '#74c0fc', gold: '#e0a526', coral: '#ff7f6e', crimson: '#c4153d',
};

class Stop extends Error {}
const fail = (line, message) => { throw Object.assign(new Error(message), { turtle: true, line }); };

/* ---------- tokens ---------- */
function tokenize(src) {
  const out = [];
  const lines = String(src).split(/\r?\n/);
  lines.forEach((text, ln) => {
    const line = ln + 1;
    const code = text.replace(/;.*$/, '');
    const re = /\s*(?:(\d*\.?\d+(?![\w.]))|(:[A-Za-z_]\w*)|("[A-Za-z_#][\w#]*)|(#[0-9a-fA-F]{3,8})|([A-Za-z_][\w.?]*)|(<=|>=|<>|[-+*/%<>=()\[\]]))/y;
    let i = 0;
    while (i < code.length) {
      if (/\s/.test(code[i])) { i++; continue; }
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m) fail(line, `I don't know what “${code[i]}” is`);
      i = re.lastIndex;
      if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]), line });
      else if (m[2]) out.push({ t: 'var', v: m[2].slice(1).toLowerCase(), line });
      else if (m[3]) out.push({ t: 'str', v: m[3].slice(1).toLowerCase(), line });
      else if (m[4]) out.push({ t: 'hex', v: m[4], line });
      else if (m[5]) out.push({ t: 'word', v: m[5].toLowerCase(), line });
      else out.push({ t: 'op', v: m[6], line, sb: /\s/.test(code[i - m[6].length - 1] || ''), sa: /\s/.test(code[i] || ' ') });
    }
  });
  return out;
}

const ALIASES = { fd: 'forward', bk: 'back', back: 'back', lt: 'left', rt: 'right', pu: 'penup', pd: 'pendown', seth: 'setheading', ht: 'hideturtle', st: 'showturtle',
  cs: 'clear', clearscreen: 'clear', colour: 'color', setcolor: 'color', setcolour: 'color', pencolor: 'color', pensize: 'width', setwidth: 'width', bg: 'background', setbg: 'background', say: 'print' };
const ARITY = { forward: 1, back: 1, left: 1, right: 1, penup: 0, pendown: 0, home: 0, setxy: 2, setheading: 1, width: 1, circle: 1, dot: 1,
  hideturtle: 0, showturtle: 0, clear: 0, print: 1, stop: 0, hue: 1 };
const FUNCS = { random: 1, sqrt: 1, sin: 1, cos: 1, abs: 1, round: 1, int: 1 };

/* ---------- parser ---------- */
function parse(tokens) {
  /* first pass: how many inputs does each `to` take, so calls can be read before the definition */
  const arity = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].t === 'word' && tokens[i].v === 'to') {
      const name = tokens[i + 1];
      if (!name || name.t !== 'word') fail(tokens[i].line, '`to` needs a name, like: to square :size');
      let n = 0, j = i + 2;
      while (tokens[j] && tokens[j].t === 'var' && tokens[j].line === name.line) { n++; j++; }
      arity.set(name.v, n);
    }
  }
  let p = 0;
  const peek = () => tokens[p], next = () => tokens[p++];
  const last = () => (tokens[p - 1] || tokens[tokens.length - 1] || { line: 1 }).line;
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;

  function primary() {
    const t = next();
    if (!t) fail(last(), 'I needed a number here, but the program ended');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'var') return { k: 'var', name: t.v, line: t.line };
    if (isOp(t, '(')) { const e = expr(); if (!isOp(next(), ')')) fail(t.line, 'A ( needs a ) to close it'); return e; }
    if (isOp(t, '-')) return { k: 'neg', e: primary() };
    if (t.t === 'word' && FUNCS[t.v]) return { k: 'fn', name: t.v, arg: primary(), line: t.line };
    if (t.t === 'word' && (t.v === 'true' || t.v === 'false')) return { k: 'num', v: t.v === 'true' ? 1 : 0 };
    fail(t.line, `I needed a number here, but found “${t.v}”`);
  }
  const bin = (sub, ops) => () => {
    let a = sub();
    for (;;) {
      const t = peek();
      /* "10 -5" (space before the sign, none after) is two arguments; "10 - 5" and "10-5" are a sum */
      if (t && t.t === 'op' && ops.includes(t.v) && !(t.v === '-' && t.sb && !t.sa)) { next(); a = { k: 'bin', op: t.v, a, b: sub(), line: t.line }; }
      else return a;
    }
  };
  const term = bin(() => primary(), ['*', '/', '%']);
  const sum = bin(term, ['+', '-']);
  const expr = bin(sum, ['<', '>', '=', '<=', '>=', '<>']);

  function block() {
    const open = next();
    if (!isOp(open, '[')) fail(open ? open.line : last(), 'I needed a [ here to start the list of steps');
    const body = [];
    while (peek() && !isOp(peek(), ']')) body.push(statement());
    if (!peek()) fail(open.line, 'This [ never gets its ]');
    next();
    return body;
  }
  function statement() {
    const t = next();
    if (t.t !== 'word') fail(t.line, `I didn't expect “${t.v}” here. A step starts with a word like forward or repeat`);
    const w = ALIASES[t.v] || t.v;
    if (w === 'repeat') return { k: 'repeat', n: expr(), body: block(), line: t.line };
    if (w === 'if') return { k: 'if', test: expr(), then: block(), line: t.line };
    if (w === 'ifelse') return { k: 'if', test: expr(), then: block(), else: block(), line: t.line };
    if (w === 'make') {
      const n = next();
      if (!n || n.t !== 'str') fail(t.line, 'make needs a name in quotes, like: make "size 50');
      return { k: 'make', name: n.v, value: expr(), line: t.line };
    }
    if (w === 'to') fail(t.line, '`to` can only start a new line outside everything else');
    if (w === 'end') fail(t.line, '`end` with no `to` before it');
    if (w === 'color' || w === 'background') {
      const c = next();
      if (!c || !['word', 'str', 'hex'].includes(c.t)) fail(t.line, `${w} needs a colour name like red, or a #code`);
      return { k: 'cmd', name: w, args: [{ k: 'raw', raw: c.v }], line: t.line };
    }
    if (w in ARITY) {
      const args = [];
      for (let i = 0; i < ARITY[w]; i++) args.push(expr());
      return { k: 'cmd', name: w, args, line: t.line };
    }
    if (arity.has(t.v)) {
      const args = [];
      for (let i = 0; i < arity.get(t.v); i++) args.push(expr());
      return { k: 'call', name: t.v, args, line: t.line };
    }
    fail(t.line, `I don't know how to “${t.v}”. Spelling? Or define it with: to ${t.v} … end`);
  }
  const main = [], procs = new Map();
  while (p < tokens.length) {
    const t = peek();
    if (t.t === 'word' && t.v === 'to') {
      next();
      const name = next(), params = [];
      while (peek() && peek().t === 'var' && peek().line === name.line) params.push(next().v);
      if (ALIASES[name.v] || name.v in ARITY || ['repeat', 'if', 'ifelse', 'make', 'to', 'end', 'color', 'background'].includes(name.v)) fail(name.line, `“${name.v}” is already a word the turtle knows. Pick another name`);
      const body = [];
      while (peek() && !(peek().t === 'word' && peek().v === 'end')) {
        if (peek().t === 'word' && peek().v === 'to') fail(peek().line, `The \`to ${name.v}\` above never says \`end\``);
        body.push(statement());
      }
      if (!peek()) fail(name.line, `\`to ${name.v}\` never says \`end\``);
      next();
      procs.set(name.v, { params, body, line: name.line });
    } else main.push(statement());
  }
  return { main, procs };
}

/* ---------- running ---------- */
export function runTurtle(source, { random = Math.random } = {}) {
  const res = {
    segments: [], trail: [], turtle: { x: 0, y: 0, heading: 0, pen: true, visible: true, color: COLOURS.black }, bg: null, output: [],
    stats: { lines: 0, repeats: 0, procs: 0, calls: 0, vars: 0, colours: 0, closed: false }, error: null,
  };
  const T = res.turtle, colours = new Set([T.color]);
  let width = 2, steps = 0, depth = 0;
  try {
    const { main, procs } = parse(tokenize(source));
    res.stats.procs = procs.size;
    const globals = new Map();
    const tick = line => { if (++steps > LIMITS.steps) fail(line, 'This is taking too many steps. Is there a loop that never stops?'); };
    const mark = () => { if (res.trail.length < LIMITS.lines) res.trail.push({ x: T.x, y: T.y, heading: T.heading, n: res.segments.length }); };
    const seg = (x1, y1, x2, y2, line) => {
      if (res.segments.length >= LIMITS.lines) fail(line, `That is ${LIMITS.lines} lines. Time to stop there`);
      res.segments.push({ x1, y1, x2, y2, color: T.color, width }); res.stats.lines++;
    };
    const colourOf = (v, line) => {
      if (typeof v === 'string') {
        if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
        if (COLOURS[v]) return COLOURS[v];
        fail(line, `I don't know a colour called “${v}”. Try red, blue, green, orange, purple… or a #code`);
      }
      fail(line, 'color needs a name like red, or a #code');
    };

    /* a value: a number, or (for colour words) a string */
    const ev = (n, scope) => {
      switch (n.k) {
        case 'num': return n.v;
        case 'neg': return -ev(n.e, scope);
        case 'var': {
          const v = scope.has(n.name) ? scope.get(n.name) : globals.get(n.name);
          if (v === undefined) fail(n.line, `:${n.name} has no value yet. Use make "${n.name} 10 first`);
          return v;
        }
        case 'fn': {
          const a = ev(n.arg, scope);
          if (n.name === 'random') return Math.floor(random() * Math.max(1, Math.floor(a)));
          if (n.name === 'sqrt') { if (a < 0) fail(n.line, 'sqrt needs a number that is not negative'); return Math.sqrt(a); }
          if (n.name === 'sin') return Math.sin(a * Math.PI / 180);
          if (n.name === 'cos') return Math.cos(a * Math.PI / 180);
          if (n.name === 'abs') return Math.abs(a);
          return Math.round(a);
        }
        case 'bin': {
          const a = ev(n.a, scope), b = ev(n.b, scope);
          switch (n.op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': if (b === 0) fail(n.line, 'That divides by zero'); return a / b;
            case '%': if (b === 0) fail(n.line, 'That divides by zero'); return a % b;
            case '<': return +(a < b); case '>': return +(a > b); case '=': return +(a === b);
            case '<=': return +(a <= b); case '>=': return +(a >= b); default: return +(a !== b);
          }
        }
        default: return 0;
      }
    };
    const num = (n, scope) => {
      const v = ev(n, scope);
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(n.line || 1, 'That is not a number I can use');
      return v;
    };

    const run = (body, scope) => { for (const s of body) exec(s, scope); };
    function exec(s, scope) {
      tick(s.line);
      switch (s.k) {
        case 'repeat': {
          const n = Math.floor(num(s.n, scope));
          if (n > LIMITS.repeat) fail(s.line, `repeat ${n} is too many. The most is ${LIMITS.repeat}`);
          res.stats.repeats++;
          for (let i = 0; i < n; i++) run(s.body, scope);
          return;
        }
        case 'if': if (num(s.test, scope)) run(s.then, scope); else if (s.else) run(s.else, scope); return;
        case 'make': {
          const v = num(s.value, scope);
          res.stats.vars++;
          if (scope !== globals && scope.has(s.name)) scope.set(s.name, v); else globals.set(s.name, v);
          return;
        }
        case 'call': {
          const p = procs.get(s.name);
          if (++depth > LIMITS.depth) fail(s.line, `${s.name} has called itself too many times (${LIMITS.depth} deep)`);
          const local = new Map();
          p.params.forEach((name, i) => local.set(name, num(s.args[i], scope)));
          res.stats.calls++;
          try { run(p.body, local); } catch (e) { if (!(e instanceof Stop)) throw e; }
          depth--;
          return;
        }
        case 'cmd': return cmd(s, scope);
      }
    }
    function move(d, line) {
      const a = T.heading * Math.PI / 180, x = T.x + Math.sin(a) * d, y = T.y + Math.cos(a) * d;
      if (T.pen) seg(T.x, T.y, x, y, line);
      T.x = x; T.y = y; mark();
    }
    function cmd(s, scope) {
      const a = s.args, n = i => num(a[i], scope);
      switch (s.name) {
        case 'forward': return move(n(0), s.line);
        case 'back': return move(-n(0), s.line);
        case 'left': T.heading = (((T.heading - n(0)) % 360) + 360) % 360; return mark();
        case 'right': T.heading = (((T.heading + n(0)) % 360) + 360) % 360; return mark();
        case 'penup': T.pen = false; return;
        case 'pendown': T.pen = true; return;
        case 'home': { const was = T.pen; T.pen = false; move(0, s.line); T.x = 0; T.y = 0; T.heading = 0; T.pen = was; return mark(); }
        case 'setxy': { const x = n(0), y = n(1); if (T.pen) seg(T.x, T.y, x, y, s.line); T.x = x; T.y = y; return mark(); }
        case 'setheading': T.heading = ((n(0) % 360) + 360) % 360; return mark();
        case 'color': {
          T.color = colourOf(a[0].raw, s.line); colours.add(T.color); return;
        }
        case 'hue': { const hh = ((n(0) % 360) + 360) % 360; T.color = `hsl(${Math.round(hh)} 80% 50%)`; colours.add(T.color); return; }
        case 'width': width = Math.max(1, Math.min(60, n(0))); return;
        case 'circle': {
          const r = Math.abs(n(0)); if (!T.pen) return;
          const N = 48, a0 = T.heading * Math.PI / 180;
          /* a circle that touches the turtle and curves to its right */
          const cx = T.x + Math.cos(a0) * r, cy = T.y - Math.sin(a0) * r;
          let px = T.x, py = T.y;
          for (let i = 1; i <= N; i++) {
            const t = Math.atan2(T.y - cy, T.x - cx) + (i / N) * Math.PI * 2 * -1;
            const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
            seg(px, py, x, y, s.line); px = x; py = y;
          }
          return mark();
        }
        case 'dot': { const d = Math.max(1, n(0)), w0 = width; width = d; const was = T.pen; if (was) seg(T.x, T.y, T.x + 0.01, T.y, s.line); width = w0; return mark(); }
        case 'hideturtle': T.visible = false; return;
        case 'showturtle': T.visible = true; return;
        case 'clear': res.segments.length = 0; res.trail.length = 0; mark(); return;
        case 'background': res.bg = colourOf(a[0].raw, s.line); return;
        case 'print': { const v = ev(a[0], scope); res.output.push(String(Math.round(v * 1000) / 1000)); return; }
        case 'stop': throw new Stop();
      }
    }
    mark();
    try { run(main, globals); } catch (e) { if (!(e instanceof Stop)) throw e; }
    res.stats.colours = colours.size;
    const first = res.segments[0], b = res.turtle;
    res.stats.closed = !!first && Math.hypot(b.x - first.x1, b.y - first.y1) < 0.5 && res.segments.length >= 3;
  } catch (e) {
    if (e && e.turtle) res.error = { line: e.line, message: e.message };
    else if (e instanceof RangeError) res.error = { line: 1, message: 'That nests too deeply.' };
    else throw e;
    res.stats.colours = colours.size;
  }
  return res;
}
