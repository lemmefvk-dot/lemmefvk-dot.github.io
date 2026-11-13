/* ============================================================
   devlog.js — the capture engine behind Static Developer.

   Started once, very early at boot, it keeps small ring buffers of
   what the page itself reports, so the developer app can show what
   happened before it was opened:

     console   log / info / warn / error / debug, plus assert (when it
               fails) and trace. Wrapped in place: the original method
               always runs. First-argument format specifiers
               (%s %d %i %f %o %O %c) are applied — %c's CSS is dropped
               on purpose, a page never styles this log. A line that
               repeats exactly collapses into a count, like a browser's.
     errors    window 'error' — uncaught exceptions, and scripts,
               stylesheets or media that failed to load — and
               'unhandledrejection'.
     network   PerformanceObserver('resource', buffered), so requests
               made after the browser's own ~250-entry timing buffer
               fills are still seen.
     bus       every OS bus event, through bus.on('*') (bus.js already
               calls '*' listeners for every emit), but ONLY while the
               tap is on. It is off by default, so normally it costs
               nothing at all.

   Rules it keeps:
   · It never throws into the caller and never recurses: a console call
     made while capturing (by a subscriber, a toJSON, anything) goes
     straight to the original console and is not captured.
   · Arguments are serialised at capture time, bounded (depth, keys,
     items, string length and a node budget per entry), circular-safe,
     Errors with their stack. Getters are listed but never invoked.
   · Secrets are masked at capture time, before anything is kept, so a PIN
     or a signing key can't reach the ring buffer, the app, a copy or a
     screenshot. Three tests, all applied: a key that looks like a secret
     (token, key, secret, password, pin, hash, salt …); a whole value that
     looks like one (long, high-entropy, no spaces — paths and UUIDs
     excluded); and any secret-shaped run *inside* a longer string, so
     "key=abc…" and `new Error('boom ' + token)` are redacted too.
   · Nothing leaves the device: this module has no network code.

     init()            idempotent; cheap
     entries()         console entries, oldest first
     clear()           empty the console buffer
     onEntry(fn)       -> unsubscribe; fn(entry, 'add'|'repeat') or (null, 'clear')
     busLog()          bus events, oldest first
     onBus(fn)         -> unsubscribe; fn(entry, 'add') or (null, 'clear'|'tap')
     setBusTap(bool)   start / stop recording bus events; busTap() reads it
     network()         PerformanceResourceTiming entries seen by the observer
     onNetwork(fn)     -> unsubscribe; fn(countAdded)
     stats()           what was kept, seen and dropped, and since when

   Caveat worth knowing: because console.* are wrapped, the browser's own
   devtools attribute console lines to this file. In Chrome, right-click
   it in a stack and choose "Add script to ignore list" to see the real
   caller there again. Static Developer shows the real caller itself.
   ============================================================ */
import { bus } from './bus.js';

const MAX_CONSOLE = 500;
const MAX_BUS = 300;
const MAX_BEAT = 60;        /* heartbeat events are capped on their own so they can't evict the rest */
const MAX_NET = 1000;

/* serialisation limits */
const LIM = { depth: 3, keys: 40, items: 60, str: 400, strTop: 10000, nodes: 300, busNodes: 160, stack: 4000 };

let inited = false;
let busy = false;                   /* re-entrancy guard shared by every capture path */
let seq = 0;
const started = { at: 0, perf: 0 };

const log = [];
const logSubs = new Set();
let seenLog = 0;
let droppedLog = 0;

const busBuf = [];
const busSubs = new Set();
let beatCount = 0;
let tapOff = null;
let tapSince = 0;
let seenBus = 0;
let droppedBus = 0;

const net = [];
const netSubs = new Set();
let netObs = null;
let netDropped = 0;
let netBufferFull = false;

const originals = {};

/* ------------------------------------------------------------------ */
/*  secrets                                                            */
/* ------------------------------------------------------------------ */
const SECRET_WORDS = new Set([
  'token', 'tokens', 'secret', 'secrets', 'password', 'passwords', 'passwd', 'passcode', 'passphrase', 'pwd',
  'pin', 'pins', 'pincode', 'key', 'apikey', 'privkey', 'privatekey', 'hash', 'salt', 'auth', 'authorization',
  'credential', 'credentials', 'cookie', 'cookies', 'jwt', 'bearer', 'otp',
]);

function words(k) {
  return String(k)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does a property name look like it holds a secret? Word-based, so
    "lockPin", "bcKey" and "api_token" match but "pinned", "keyboard"
    and "hotkeys" do not. */
export function isSecretKey(k) {
  if (typeof k !== 'string' || !k || k.length > 80) return false;
  const w = words(k);
  for (const x of w) {
    if (SECRET_WORDS.has(x)) return true;
    if (x === 'keys' && w.length > 1) return true;                     /* apiKeys, signingKeys */
    if (/^(api|access|refresh|session|signing|private|secret)(key|token)s?$/.test(x)) return true;
  }
  return false;
}

/** A long, high-entropy string with no spaces: a token, a key, a hash. */
export function looksSecret(v) {
  if (typeof v !== 'string' || v.length < 32 || v.length > 8192) return false;
  if (!/^[A-Za-z0-9+/=_\-.]+$/.test(v)) return false;
  if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return false;   /* a UUID is an id */
  if (/^\.{0,2}\//.test(v) || /^[\w.-]+(\/[\w.-]+)+\.[a-z0-9]{1,5}$/i.test(v)) return false;     /* a path */
  const freq = new Map();
  for (const c of v) freq.set(c, (freq.get(c) || 0) + 1);
  let bits = 0;
  for (const n of freq.values()) { const p = n / v.length; bits -= p * Math.log2(p); }
  return bits >= 3.5;
}

export function lengthOf(v) {
  if (typeof v === 'string') return v.length;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v).length;
  try { return (JSON.stringify(v) || '').length; } catch (e) { return 0; }
}
/* booleans, null and empty strings reveal nothing, so they stay visible */
export const maskable = v => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean';

/* A secret rarely arrives alone: it is concatenated into a message
   ("key=abc…", "boom abc…", a URL's query). looksSecret() only judges a
   whole string, so also redact secret-shaped runs *inside* one. A run is
   a maximal stretch of the token alphabet, judged by the same test, so
   paths, UUIDs and ordinary words are left alone. The length pre-test
   means a normal log line costs one cheap regex that fails. */
const RUNS = /[A-Za-z0-9+/=_.\-]{32,}/g;
export function redact(s) {
  if (typeof s !== 'string' || s.length < 32) return s;
  if (!RUNS.test(s)) { RUNS.lastIndex = 0; return s; }
  RUNS.lastIndex = 0;
  return s.replace(RUNS, run => (looksSecret(run) ? `•••• (masked, ${run.length} chars)` : run));
}

/** JSON.stringify with every secret-looking value replaced. */
export function jsonMasked(value, space = 2) {
  return JSON.stringify(value, function (k, v) {
    if (k && isSecretKey(k) && maskable(v)) return `•••• (masked, ${lengthOf(v)} chars)`;
    if (typeof v === 'string') return looksSecret(v) ? `•••• (masked, ${v.length} chars)` : redact(v);
    return v;
  }, space);
}

/* ------------------------------------------------------------------ */
/*  serialisation                                                      */
/* ------------------------------------------------------------------ */
/* Node shapes (t = type):
     s string {v, n?: full length when cut}   n number {v}   b boolean {v}
     u undefined   z null   g bigint {v}   y symbol {v}   f function {v: name}
     e error {name, msg, stack, k?}   d date {v}   r regexp {v}
     x host object, summary only {v}   m masked {n: length}   c circular
     get an accessor (never invoked)   cut the entry's node budget ran out
     o object {c: class, n: key count, k: [[key, node]], cut?}
     a array {c, n, i: [node], cut?}   M map {c, n, e: [[node, node]], cut?}
     S set {c, n, i, cut?}                                              */
const CUT = { t: 'cut' };

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

function ctorName(v) {
  try {
    const p = Object.getPrototypeOf(v);
    if (p === null) return 'Object';
    const c = p.constructor;
    return (c && typeof c.name === 'string' && c.name) || 'Object';
  } catch (e) { return 'Object'; }
}

function isError(v) {
  if (v instanceof Error) return true;
  return safe(() => Object.prototype.toString.call(v) === '[object Error]', false);
}

/* look a method up the prototype chain without triggering any getter */
function hasMethod(o, name) {
  let p = o;
  for (let i = 0; p && i < 8; i++) {
    const d = Object.getOwnPropertyDescriptor(p, name);
    if (d) return typeof d.value === 'function';
    p = Object.getPrototypeOf(p);
  }
  return false;
}

function nodeLabel(n) {
  try {
    if (n.nodeType === 1) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += `#${n.id}`;
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (cls.length) s += `.${cls.join('.')}`;
      return `<${s}>`;
    }
    if (n.nodeType === 3) return `#text "${clip(String(n.nodeValue || ''), 40)}"`;
    if (n.nodeType === 9) return '#document';
    if (n.nodeType === 11) return '#document-fragment';
    return String(n.nodeName || 'Node');
  } catch (e) { return 'Node'; }
}

function str(v, max) { return v.length > max ? { t: 's', v: v.slice(0, max), n: v.length } : { t: 's', v }; }

/* a captured string: wholly secret-looking -> masked node; otherwise any
   secret-shaped run inside it is redacted before it is kept or clipped */
function strSafe(v, max, mv) {
  if (!mv) return str(v, max);
  if (looksSecret(v)) return { t: 'm', n: v.length };
  return str(redact(v), max);
}

function mask(v) { return maskable(v) ? { t: 'm', n: lengthOf(v) } : null; }

function stackOf(v) {
  const raw = safe(() => (typeof v.stack === 'string' ? v.stack : ''), '');
  return clip(raw, LIM.stack);
}

function ser(v, d, B, anc) {
  if (++B.n > B.max) return CUT;
  switch (typeof v) {
    case 'string': return strSafe(v, d === 0 ? LIM.strTop : LIM.str, B.mv);
    case 'number': return { t: 'n', v: Object.is(v, -0) ? '-0' : String(v) };
    case 'boolean': return { t: 'b', v };
    case 'undefined': return { t: 'u' };
    case 'bigint': return { t: 'g', v: `${v}n` };
    case 'symbol': return { t: 'y', v: safe(() => v.toString(), 'Symbol()') };
    case 'function': return { t: 'f', v: safe(() => String(v.name || ''), '') || '(anonymous)' };
    default: break;
  }
  if (v === null) return { t: 'z' };
  if (anc.includes(v)) return { t: 'c' };
  try {
    if (isError(v)) {
      /* an error message or a stacked URL can carry a token too */
      const hide = B.mv ? redact : (x => x);
      const out = {
        t: 'e',
        name: String(safe(() => v.name, '') || 'Error'),
        msg: clip(hide(String(safe(() => v.message, '') ?? '')), LIM.strTop),
        stack: hide(stackOf(v)),
      };
      /* anything else the error carries (a status, a code) */
      const extra = safe(() => Object.keys(v).filter(k => k !== 'stack' && k !== 'message').slice(0, 10), []);
      if (extra.length && d < LIM.depth) {
        anc.push(v);
        try {
          out.k = [];
          for (const key of extra) {
            const desc = Object.getOwnPropertyDescriptor(v, key);
            if (!desc) continue;
            out.k.push([key, !('value' in desc) ? { t: 'get' } : isSecretKey(key) ? (mask(desc.value) || ser(desc.value, d + 1, B, anc)) : ser(desc.value, d + 1, B, anc)]);
          }
        } finally { anc.pop(); }
      }
      return out;
    }
    if (v instanceof Date) return { t: 'd', v: Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString() };
    if (v instanceof RegExp) return { t: 'r', v: String(v) };
    if (typeof Node !== 'undefined' && v instanceof Node) return { t: 'x', v: nodeLabel(v) };
    if (typeof window !== 'undefined' && v === window) return { t: 'x', v: 'Window' };
    if (typeof Event !== 'undefined' && v instanceof Event) return { t: 'x', v: `${ctorName(v)} {type: "${String(v.type)}"}` };
    if (v instanceof ArrayBuffer) return { t: 'x', v: `ArrayBuffer(${v.byteLength})` };
    if (ArrayBuffer.isView(v)) return { t: 'x', v: `${ctorName(v)}(${v.length ?? v.byteLength})` };
    if (typeof Blob !== 'undefined' && v instanceof Blob) return { t: 'x', v: `${ctorName(v)} (${v.size} bytes${v.type ? `, ${v.type}` : ''})` };
    if (v instanceof Promise) return { t: 'x', v: 'Promise' };
    if (v instanceof WeakMap || v instanceof WeakSet) return { t: 'x', v: ctorName(v) };

    const isArr = Array.isArray(v);
    const c = isArr ? 'Array' : ctorName(v);
    if (d >= LIM.depth) {
      if (isArr) return { t: 'a', c, n: v.length, cut: true };
      if (v instanceof Map) return { t: 'M', c, n: v.size, cut: true };
      if (v instanceof Set) return { t: 'S', c, n: v.size, cut: true };
      return { t: 'o', c, n: safe(() => Object.keys(v).length, 0), cut: true };
    }
    anc.push(v);
    try {
      if (isArr) {
        const i = [];
        const m = Math.min(v.length, LIM.items);
        for (let k = 0; k < m; k++) i.push(ser(v[k], d + 1, B, anc));
        return { t: 'a', c, n: v.length, i };
      }
      if (v instanceof Map) {
        const e = [];
        let k = 0;
        for (const [a, b] of v) {
          if (k++ >= LIM.items) break;
          e.push([ser(a, d + 1, B, anc), (typeof a === 'string' && isSecretKey(a) && mask(b)) || ser(b, d + 1, B, anc)]);
        }
        return { t: 'M', c, n: v.size, e };
      }
      if (v instanceof Set) {
        const i = [];
        let k = 0;
        for (const a of v) { if (k++ >= LIM.items) break; i.push(ser(a, d + 1, B, anc)); }
        return { t: 'S', c, n: v.size, i };
      }
      const keys = Object.keys(v);
      /* host objects (DOMRect, PerformanceEntry …) keep their data behind
         prototype getters; their own toJSON is the safe way to read it */
      if (c !== 'Object' && !keys.length && hasMethod(v, 'toJSON')) {
        const j = v.toJSON();
        if (j && typeof j === 'object' && j !== v) {
          const r = ser(j, d, B, anc);
          if (r.t === 'o') r.c = c;
          return r;
        }
      }
      const k = [];
      const m = Math.min(keys.length, LIM.keys);
      for (let x = 0; x < m; x++) {
        const key = keys[x];
        const desc = Object.getOwnPropertyDescriptor(v, key);
        if (!desc) continue;
        /* a map keyed BY a token would otherwise print the token as a label */
        const label = B.mv && looksSecret(key) ? `•••• (${key.length} chars)` : key;
        if (!('value' in desc)) { k.push([label, { t: 'get' }]); continue; }
        k.push([label, (isSecretKey(key) && mask(desc.value)) || ser(desc.value, d + 1, B, anc)]);
      }
      return { t: 'o', c, n: keys.length, k };
    } finally { anc.pop(); }
  } catch (e) {
    return { t: 'x', v: '[unreadable]' };
  }
}

/** Serialise one value the way captured entries are. `maskValues` also
    masks long random-looking strings, and redacts secret-shaped runs
    inside longer ones (not just secret-named keys). Capture always does. */
export function serialize(value, { top = true, budget = LIM.nodes, maskValues = false } = {}) {
  return ser(value, top ? 0 : 1, { n: 0, max: budget, mv: !!maskValues }, []);
}

/* ------------------------------------------------------------------ */
/*  one-line previews                                                  */
/* ------------------------------------------------------------------ */
const quote = s => safe(() => JSON.stringify(s), '""');

/** A single-line preview of a serialised node, at most `max` characters. */
export function preview(n, max = 200, top = false) {
  const out = pv(n, top, 2);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function pv(n, top, depth) {
  if (!n) return '';
  switch (n.t) {
    case 's': return top ? n.v + (n.n ? '…' : '') : `${quote(n.v).slice(0, -1)}${n.n ? '…' : ''}"`;
    case 'n': case 'g': case 'y': case 'd': case 'r': case 'x': return String(n.v);
    case 'b': return n.v ? 'true' : 'false';
    case 'u': return 'undefined';
    case 'z': return 'null';
    case 'f': return `ƒ ${n.v}()`;
    case 'm': return '••••';
    case 'c': return '[Circular]';
    case 'get': return '(…)';
    case 'cut': return '…';
    case 'e': return `${n.name}: ${n.msg}`;
    case 'a': {
      if (n.cut || depth <= 0) return `Array(${n.n})`;
      const items = (n.i || []).map(x => pv(x, false, depth - 1));
      if (n.n > items.length) items.push('…');
      return `(${n.n}) [${items.join(', ')}]`;
    }
    case 'S': {
      if (n.cut || depth <= 0) return `Set(${n.n})`;
      const items = (n.i || []).map(x => pv(x, false, depth - 1));
      if (n.n > items.length) items.push('…');
      return `Set(${n.n}) {${items.join(', ')}}`;
    }
    case 'M': {
      if (n.cut || depth <= 0) return `Map(${n.n})`;
      const items = (n.e || []).map(([a, b]) => `${pv(a, false, depth - 1)} => ${pv(b, false, depth - 1)}`);
      if (n.n > items.length) items.push('…');
      return `Map(${n.n}) {${items.join(', ')}}`;
    }
    case 'o': {
      const cls = n.c && n.c !== 'Object' ? `${n.c} ` : '';
      if (n.cut || depth <= 0) return `${cls}{…}`;
      const items = (n.k || []).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${pv(v, false, depth - 1)}`);
      if (n.n > items.length) items.push('…');
      return `${cls}{${items.join(', ')}}`;
    }
    default: return '';
  }
}

/* ------------------------------------------------------------------ */
/*  where a call came from                                             */
/* ------------------------------------------------------------------ */
const FRAME = /((?:https?|file|blob|chrome-extension|moz-extension):\/\/[^\s)]+|blob:[^\s)]+):(\d+):(\d+)/;

export function shortUrl(u) {
  const s = String(u || '');
  try {
    const url = new URL(s, location.href);
    if (url.origin === location.origin) return url.pathname.replace(/^\//, '') || '/';
    return url.host + url.pathname;
  } catch (e) { return s; }
}

function frames(stack) {
  return String(stack || '').split('\n').filter(line => FRAME.test(line) && !/\/devlog\.js[?:]/.test(line));
}

function firstFrame(stack) {
  const f = frames(stack)[0];
  if (!f) return '';
  const m = f.match(FRAME);
  return m ? `${shortUrl(m[1])}:${m[2]}` : '';
}

function callSite() {
  const s = safe(() => new Error().stack, '');
  return s ? firstFrame(s) : '';
}

/* ------------------------------------------------------------------ */
/*  console                                                            */
/* ------------------------------------------------------------------ */
function emit(set, ...args) {
  for (const fn of [...set]) { try { fn(...args); } catch (e) { /* a bad subscriber is not our caller's problem */ } }
}

function shortString(a) {
  if (typeof a === 'string') return redact(looksSecret(a) ? `•••• (masked, ${a.length} chars)` : a);
  const n = ser(a, 1, { n: 0, max: 40, mv: true }, []);
  return pv(n, true, 1);
}

/* %s %d %i %f %o %O %c %% — like a browser console, minus the CSS */
function applyFormat(args) {
  const fmt = args[0];
  const out = [];
  let buf = '';
  let ai = 1;
  let last = 0;
  const re = /%([sdifoOc%])/g;
  let m;
  while ((m = re.exec(fmt))) {
    buf += fmt.slice(last, m.index);
    last = re.lastIndex;
    const c = m[1];
    if (c === '%') { buf += '%'; continue; }
    if (ai >= args.length) { buf += m[0]; continue; }
    const a = args[ai++];
    if (c === 's') buf += safe(() => shortString(a), '');
    else if (c === 'd' || c === 'i') buf += typeof a === 'symbol' ? 'NaN' : String(safe(() => parseInt(a, 10), NaN));
    else if (c === 'f') buf += typeof a === 'symbol' ? 'NaN' : String(safe(() => parseFloat(a), NaN));
    else if (c === 'c') { /* styles are ignored on purpose */ }
    else { if (buf) out.push(buf); buf = ''; out.push(a); }
  }
  buf += fmt.slice(last);
  if (buf) out.push(buf);
  return [...out, ...args.slice(ai)];
}

function push(e) {
  seenLog++;
  const last = log[log.length - 1];
  if (last && last.level === e.level && last.source === e.source && last.site === e.site && last.text === e.text) {
    last.count++;
    last.last = Date.now();
    emit(logSubs, last, 'repeat');
    return;
  }
  e.id = ++seq;
  e.t = Date.now();
  e.count = 1;
  log.push(e);
  if (log.length > MAX_CONSOLE) { droppedLog += log.length - MAX_CONSOLE; log.splice(0, log.length - MAX_CONSOLE); }
  emit(logSubs, e, 'add');
}

function entryText(nodes) {
  return clip(nodes.map(n => pv(n, true, 2)).join(' '), 4000);
}

function capture(kind, level, raw) {
  let args = raw;
  if (kind === 'assert') {
    if (args[0]) return;
    args = args.length > 1 ? ['Assertion failed:', ...args.slice(1)] : ['Assertion failed'];
  }
  if (typeof args[0] === 'string' && args[0].includes('%')) args = applyFormat(args);
  /* mv: a token logged straight to the console must not be readable in the
     app, in a copy or in a screenshot either — mask it before it is kept */
  const B = { n: 0, max: LIM.nodes, mv: true };
  const nodes = args.map(a => ser(a, 0, B, []));
  if (kind === 'trace') nodes.unshift({ t: 's', v: 'console.trace' });
  const e = { level, source: 'console', args: nodes, text: entryText(nodes), site: callSite() };
  if (kind === 'trace') e.stack = frames(safe(() => new Error().stack, '')).join('\n');
  push(e);
}

function wrap(kind, level) {
  const orig = console[kind];
  if (typeof orig !== 'function' || orig.__devlog) return;
  originals[kind] = orig;
  const wrapped = function (...args) {
    if (!busy) {
      busy = true;
      try { capture(kind, level, args); } catch (e) { /* never throw into the caller */ } finally { busy = false; }
    }
    return orig.apply(console, args);
  };
  wrapped.__devlog = true;
  try { console[kind] = wrapped; } catch (e) { /* a frozen console: capture stays off for it */ }
}

/* ------------------------------------------------------------------ */
/*  window errors                                                      */
/* ------------------------------------------------------------------ */
function onWinError(ev) {
  if (busy) return;
  busy = true;
  try {
    if (typeof ErrorEvent !== 'undefined' && ev instanceof ErrorEvent) {
      const err = ev.error;
      const msg = redact(String(ev.message || (err && safe(() => err.message, '')) || 'Script error.'));
      const B = { n: 0, max: LIM.nodes, mv: true };
      const node = err !== undefined && err !== null ? ser(err, 0, B, []) : { t: 's', v: msg };
      const nodes = [{ t: 's', v: 'Uncaught' }, node];
      const site = ev.filename ? `${shortUrl(ev.filename)}:${ev.lineno || 0}` : (node.t === 'e' ? firstFrame(node.stack) : '');
      push({ level: 'error', source: 'uncaught', args: nodes, text: entryText(nodes), site });
      return;
    }
    const t = ev && ev.target;
    if (!t || t === window || !t.tagName) return;
    const tag = String(t.tagName).toLowerCase();
    const url = clip(redact(String(t.currentSrc || t.src || t.href || t.data || '')), 400);
    const hard = tag === 'script' || (tag === 'link' && /stylesheet|modulepreload/i.test(String(t.rel || '')));
    const nodes = [{ t: 's', v: `Failed to load <${tag}>` }, { t: 's', v: url || '(no url)' }];
    push({ level: hard ? 'error' : 'warn', source: 'resource', args: nodes, text: entryText(nodes), site: '' });
  } catch (e) { /* ignore */ } finally { busy = false; }
}

function onRejection(ev) {
  if (busy) return;
  busy = true;
  try {
    const r = ev ? ev.reason : undefined;
    const node = ser(r, 0, { n: 0, max: LIM.nodes, mv: true }, []);
    const nodes = [{ t: 's', v: 'Uncaught (in promise)' }, node];
    push({ level: 'error', source: 'rejection', args: nodes, text: entryText(nodes), site: node.t === 'e' ? firstFrame(node.stack) : '' });
  } catch (e) { /* ignore */ } finally { busy = false; }
}

/* ------------------------------------------------------------------ */
/*  the OS bus tap                                                     */
/* ------------------------------------------------------------------ */
/* The OS heartbeat: the 1 s / 5 s ticks, the metrics sampler and the
   'live' gauges main.js writes every second. Kept, but capped apart. */
export function isHeartbeat(evt, first) {
  return /^tick:/.test(evt) || evt === 'metrics:tick' || (evt === 'state:change' && first === 'live');
}

function trimBus() {
  while (beatCount > MAX_BEAT) {
    const i = busBuf.findIndex(x => x.beat);
    if (i < 0) break;
    busBuf.splice(i, 1); beatCount--; droppedBus++;
  }
  while (busBuf.length - beatCount > MAX_BUS) {
    const i = busBuf.findIndex(x => !x.beat);
    if (i < 0) break;
    busBuf.splice(i, 1); droppedBus++;
  }
}

function onBusEvent(evt, ...args) {
  if (busy) return;
  busy = true;
  try {
    seenBus++;
    const B = { n: 0, max: LIM.busNodes, mv: true };
    /* a state:change carries (path, value); mask the value when the path's last part is a secret */
    const secretPath = evt === 'state:change' && typeof args[0] === 'string' && isSecretKey(String(args[0]).split('.').pop());
    const nodes = args.map((a, i) => (secretPath && i === 1 && mask(a)) || ser(a, 1, B, []));
    const beat = isHeartbeat(String(evt), args[0]);
    const e = { id: ++seq, t: Date.now(), evt: String(evt), args: nodes, text: clip(nodes.map(n => pv(n, false, 1)).join(', '), 600), beat };
    busBuf.push(e);
    if (beat) beatCount++;
    trimBus();
    emit(busSubs, e, 'add');
  } catch (e) { /* ignore */ } finally { busy = false; }
}

export function setBusTap(on) {
  if (on && !tapOff) {
    tapOff = bus.on('*', onBusEvent);
    tapSince = Date.now();
    emit(busSubs, null, 'tap');
  } else if (!on && tapOff) {
    const off = tapOff;
    tapOff = null;
    tapSince = 0;
    try { off(); } catch (e) { /* already gone */ }
    emit(busSubs, null, 'tap');
  }
  return !!tapOff;
}
export const busTap = () => !!tapOff;

/* ------------------------------------------------------------------ */
/*  network                                                            */
/* ------------------------------------------------------------------ */
function startNet() {
  if (netObs || typeof PerformanceObserver === 'undefined') return;
  try {
    netObs = new PerformanceObserver(list => {
      let added = 0;
      for (const e of list.getEntries()) { net.push(e); added++; }
      if (net.length > MAX_NET) { netDropped += net.length - MAX_NET; net.splice(0, net.length - MAX_NET); }
      if (added) emit(netSubs, added);
    });
    netObs.observe({ type: 'resource', buffered: true });
  } catch (e) { netObs = null; }
  try { performance.addEventListener('resourcetimingbufferfull', () => { netBufferFull = true; }); } catch (e) { /* older engines */ }
}

/* ------------------------------------------------------------------ */
/*  public api                                                         */
/* ------------------------------------------------------------------ */
export function init() {
  if (inited) return;
  inited = true;
  started.at = Date.now();
  started.perf = typeof performance !== 'undefined' ? performance.now() : 0;
  if (typeof console !== 'undefined') {
    wrap('log', 'log');
    wrap('info', 'info');
    wrap('warn', 'warn');
    wrap('error', 'error');
    wrap('debug', 'debug');
    wrap('assert', 'error');
    wrap('trace', 'info');
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('error', onWinError, true);        /* capture: resource failures don't bubble */
    window.addEventListener('unhandledrejection', onRejection);
  }
  startNet();
}

export const isInited = () => inited;
export const entries = () => log.slice();
export function clear() {
  log.length = 0;
  emit(logSubs, null, 'clear');
}
export function onEntry(fn) { logSubs.add(fn); return () => { logSubs.delete(fn); }; }

export const busLog = () => busBuf.slice();
export function clearBus() {
  busBuf.length = 0;
  beatCount = 0;
  emit(busSubs, null, 'clear');
}
export function onBus(fn) { busSubs.add(fn); return () => { busSubs.delete(fn); }; }

export const network = () => net.slice();
export function onNetwork(fn) { netSubs.add(fn); return () => { netSubs.delete(fn); }; }

export function stats() {
  return {
    inited,
    startedAt: started.at,
    startedPerf: started.perf,
    console: { kept: log.length, seen: seenLog, dropped: droppedLog, max: MAX_CONSOLE },
    bus: { kept: busBuf.length, seen: seenBus, dropped: droppedBus, max: MAX_BUS, beatMax: MAX_BEAT, tap: !!tapOff, since: tapSince },
    net: { kept: net.length, dropped: netDropped, max: MAX_NET, observing: !!netObs, bufferFull: netBufferFull },
    subscribers: { console: logSubs.size, bus: busSubs.size, net: netSubs.size },
  };
}

export default {
  init, isInited, entries, clear, onEntry, busLog, clearBus, onBus, setBusTap, busTap, network, onNetwork, stats,
  serialize, preview, isSecretKey, looksSecret, redact, maskable, lengthOf, jsonMasked, isHeartbeat, shortUrl,
};
