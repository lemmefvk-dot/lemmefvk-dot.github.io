/* ============================================================
   textcrdt.js — the shared text behind Write Together in Notes
   (js/apps/notes-coop.js). No DOM, no network: tests drive it
   directly, and everything that travels is checked by checkOp().

   THE TEXT is one ordered list of units (RGA): every character
   (a code point, so an emoji is never cut in half) and every line
   break has an id (counter, site) that is never reused, and remembers
   the unit it was typed after (its origin). The counter is a Lamport
   clock, one more than any counter seen, so an id always outranks the
   ids its writer knew about. Putting a unit in place: start right after
   its origin and walk past every unit with a higher id. Two people
   typing at one spot therefore both keep their words, in the same
   order on both sides, and a run of typing stays in one piece.

   Deleting only marks a unit (a tombstone): it is never removed or
   brought back, so a delete can't resurrect, and someone typing inside
   a range another person deleted keeps what they typed. An op may
   arrive in any order, any number of times: one that needs a unit not
   here yet waits for it, and a repeat changes nothing.

   FORMATTING is carried, not markup: a character has two marks
   (b, i), a line has a kind (t: p h1 h2 h3 ul ol check img), a tick
   (d) and a picture (im: { p: vfs path, a: alt }). Each mark and each
   line field is its own last-writer-wins register stamped (counter,
   site), so bolding a word or changing a list can never touch text.
   Line 0's fields live on the root; every other line's on the break
   that starts it, so merging two lines keeps the first line's kind.
   A picture line that somehow got text (two people, one empty line) is
   drawn as a paragraph: the words are what must survive.

     createDoc({ site }) -> doc
       doc.render() -> { blocks, lines, flat }   blocks are notesfmt's own
       doc.sync(shown, blocks, { caret, now })   what changed in the editor
                                                 -> { ops, anchor(pos) } | { rejected }
       doc.init(blocks, title) -> ops | null     a note's first content (null: too long)
       doc.setTitle(text) -> ops
       doc.apply(op) -> 'ok'|'dup'|'wait'|'bad'  someone else's op (checked)
       doc.undo() / doc.redo() -> { ops, caret } | null    your own changes only
       doc.anchorIn(shown, { i, o }) -> key      a place in the text, by id
       doc.where(key, shown) -> { i, o }         …and where that is now
     checkOp(op, site) -> a clean copy or null   every op from outside
     sameBlocks(a, b)  ·  unitCount(blocks)  ·  cleanText(s)  ·  cleanTitle(s)
   Offsets (o) are UTF-16, as the DOM counts them.

   OPS (compact, on the wire):
     i { id:[c,site], o:0|[c,s], x, m, L? }  insert x: its units take ids
                                             c, c+1…, each after the last; m is
                                             1 bold + 2 italic; L has one
                                             { t, d, im } per line break in x
     d { r:[[site,from,to]…] }               delete these ids
     f { s:[c,site], r, m:'b'|'i', v }       set a mark on these ids
     l { s:[c,site], id:0|[c,s], a, v }      set a line field: t, d or im
     t { s:[c,site], v }                     the note's title
   ============================================================ */

export const LIMITS = {
  text: 20000,     /* units someone may write into a shared note */
  hard: 24000,     /* units taken from the other side: room for both typing at the cap at once */
  nodes: 120000,   /* every unit ever written, tombstones included */
  run: 1500,       /* code points in one insert */
  span: 20000,     /* ids one delete or format may name */
  ranges: 300,
  weight: 6000,    /* roughly how many characters of JSON one insert may become */
  pending: 4000,   /* ops waiting for something they need */
  history: 200,    /* undo steps */
  title: 120,
  alt: 120,
  path: 400,
};
export const KINDS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'check', 'img']);
export const ROOT = '0';
export const SITE_RE = /^[a-z0-9]{1,8}$/;
const MAX_CTR = 2 ** 45;
const TYPING_GAP = 900;       /* ms: typing this close together is one undo step */

/* control characters (tab and line break are fine), the characters that flip
   or hide text, line separators; emoji joiners (U+200C, U+200D) stay */
const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060-\u2069\ufeff\ufff9-\ufffb]/;
const BAD_G = new RegExp(BAD.source, 'g');
const LONE = /\p{Cs}/u;
const LONE_G = /\p{Cs}/gu;

/** What a person's text may hold in a shared note (sent and received alike). */
export const cleanText = s => String(s ?? '').replace(/\n/g, ' ').replace(BAD_G, '').replace(LONE_G, '');
/* one line, capped, and a cap can't leave half an emoji behind */
const cleanLine = (s, max) => cleanText(s).replace(/\t/g, ' ').slice(0, max).replace(LONE_G, '');
export const cleanTitle = s => cleanLine(s, LIMITS.title);

const keyOf = (c, s) => `${s}:${c}`;
const idOf = key => {
  if (key === ROOT) return 0;
  const at = key.lastIndexOf(':');
  return [Number(key.slice(at + 1)), key.slice(0, at)];
};
export const keyFromId = id => (id === 0 ? ROOT : keyOf(id[0], id[1]));
export const idFromKey = idOf;
const newer = (c1, s1, c2, s2) => c1 > c2 || (c1 === c2 && s1 > s2);
const isId = v => Array.isArray(v) && v.length === 2 && Number.isSafeInteger(v[0]) && v[0] >= 1 && v[0] <= MAX_CTR
  && typeof v[1] === 'string' && SITE_RE.test(v[1]);
export const isPlace = v => v === 0 || isId(v);

const pathOk = p => typeof p === 'string' && p.length > 1 && p.length <= LIMITS.path && p[0] === '/' && p[1] !== '/' && !BAD.test(p) && !LONE.test(p)
  && !/[\n\t\\]/.test(p) && !p.split('/').includes('..');
function checkPicture(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !pathOk(v.p)) return undefined;
  if (typeof v.a !== 'string' || v.a.length > LIMITS.alt || BAD.test(v.a) || LONE.test(v.a) || /[\n\t]/.test(v.a)) return undefined;
  return { p: v.p, a: v.a };
}
function checkLine(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !KINDS.has(a.t) || typeof a.d !== 'boolean') return null;
  const im = checkPicture(a.im ?? null);
  return im === undefined ? null : { t: a.t, d: a.d, im };
}
function checkRanges(r) {
  if (!Array.isArray(r) || !r.length || r.length > LIMITS.ranges) return null;
  let total = 0;
  const out = [];
  for (const x of r) {
    if (!Array.isArray(x) || x.length !== 3 || typeof x[0] !== 'string' || !SITE_RE.test(x[0])) return null;
    const [s, a, z] = x;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(z) || a < 1 || z < a || z > MAX_CTR) return null;
    total += z - a + 1;
    if (total > LIMITS.span) return null;
    out.push([s, a, z]);
  }
  return out;
}
const stampOk = (v, site) => isId(v) && v[1] === site;

/** Everything from outside comes through here: a clean copy, holding only
    what this format knows about, or null. `site` is who it claims to be from. */
export function checkOp(op, site) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return null;
  switch (op.k) {
    case 'i': {
      if (!stampOk(op.id, site) || !isPlace(op.o) || typeof op.x !== 'string' || !op.x) return null;
      if (op.x.length > LIMITS.run * 2 || BAD.test(op.x) || LONE.test(op.x)) return null;
      if (!Number.isInteger(op.m) || op.m < 0 || op.m > 3) return null;
      const units = Array.from(op.x);
      if (units.length > LIMITS.run || op.id[0] + units.length - 1 > MAX_CTR) return null;
      /* the id outranks what its writer knew — always true of an honest op, and what the ordering relies on */
      if (op.o !== 0 && op.o[0] >= op.id[0]) return null;
      const breaks = units.filter(u => u === '\n').length;
      const out = { k: 'i', id: [op.id[0], site], o: op.o === 0 ? 0 : [op.o[0], op.o[1]], x: op.x, m: op.m };
      if (breaks) {
        if (!Array.isArray(op.L) || op.L.length !== breaks) return null;
        const L = op.L.map(checkLine);
        if (L.some(a => !a)) return null;
        out.L = L;
      }
      return out;
    }
    case 'd': {
      const r = checkRanges(op.r);
      return r ? { k: 'd', r } : null;
    }
    case 'f': {
      const r = checkRanges(op.r);
      if (!r || !stampOk(op.s, site) || (op.m !== 'b' && op.m !== 'i') || typeof op.v !== 'boolean') return null;
      return { k: 'f', s: [op.s[0], site], r, m: op.m, v: op.v };
    }
    case 'l': {
      if (!stampOk(op.s, site) || !isPlace(op.id)) return null;
      const id = op.id === 0 ? 0 : [op.id[0], op.id[1]];
      if (op.a === 't') return KINDS.has(op.v) ? { k: 'l', s: [op.s[0], site], id, a: 't', v: op.v } : null;
      if (op.a === 'd') return typeof op.v === 'boolean' ? { k: 'l', s: [op.s[0], site], id, a: 'd', v: op.v } : null;
      if (op.a === 'im') {
        const v = checkPicture(op.v ?? null);
        return v === undefined ? null : { k: 'l', s: [op.s[0], site], id, a: 'im', v };
      }
      return null;
    }
    case 't': {
      if (!stampOk(op.s, site) || typeof op.v !== 'string' || op.v.length > LIMITS.title || BAD.test(op.v) || LONE.test(op.v) || /[\n\t]/.test(op.v)) return null;
      return { k: 't', s: [op.s[0], site], v: op.v };
    }
    default: return null;
  }
}

/* ---------- blocks ---------- */
const cps = s => Array.from(s);
const textOfBlock = b => (b.runs || []).map(r => r.text).join('');
/** The code points before UTF-16 offset o in this text. */
function cpCount(units, o) {
  let n = 0, left = o;
  for (const u of units) { if (left <= 0) break; left -= u.length; n++; }
  return n;
}
const utf16Of = (units, k) => { let o = 0; for (let j = 0; j < k && j < units.length; j++) o += units[j].length; return o; };

function pictureOf(b) {
  const alt = cleanLine(b.alt ?? '', LIMITS.alt);
  return pathOk(b.path) ? { p: b.path, a: alt } : null;
}
function lineOf(b) {
  let t = KINDS.has(b.t) ? b.t : 'p';
  const im = t === 'img' ? pictureOf(b) : null;
  if (t === 'img' && !im) t = 'p';
  return { t, d: t === 'check' ? !!b.done : false, im };
}
const sameLine = (a, b) => a.t === b.t && (a.t !== 'check' || a.d === b.d)
  && (a.t !== 'img' || (!!a.im && !!b.im && a.im.p === b.im.p && a.im.a === b.im.a));

/** Blocks -> one flat list of units, what the diff compares. */
function flatten(blocks) {
  const list = blocks && blocks.length ? blocks : [{ t: 'p', runs: [] }];
  const units = [], starts = [], texts = [];
  list.forEach((b, k) => {
    const a = lineOf(b);
    if (k) units.push({ nl: true, a });
    starts.push(units.length);
    const line = [];
    if (a.t !== 'img') {
      for (const r of b.runs || []) {
        for (const ch of cps(cleanText(r.text))) { units.push({ ch, b: !!r.b, i: !!r.i }); line.push(ch); }
      }
    }
    texts.push(line);
  });
  return { units, starts, texts, first: lineOf(list[0]), n: list.length };
}
/** How many units these blocks make: what counts towards LIMITS.text. */
export const unitCount = blocks => flatten(blocks).units.length;
const flatPlace = (F, pos) => {
  const i = Math.max(0, Math.min(pos.i, F.n - 1));
  return F.starts[i] + Math.min(cpCount(F.texts[i], pos.o), F.texts[i].length);
};
const sameUnit = (r, e) => (r.nl ? !!e.nl : !e.nl && r.ch === e.ch);

/** Are these the same words, marks and kinds? (Runs are compared merged, as notes keep them.) */
export function sameBlocks(a, b) {
  const A = flatten(a), B = flatten(b);
  if (A.units.length !== B.units.length || !sameLine(A.first, B.first)) return false;
  return A.units.every((u, k) => {
    const v = B.units[k];
    if (!!u.nl !== !!v.nl) return false;
    return u.nl ? sameLine(u.a, v.a) : u.ch === v.ch && u.b === v.b && u.i === v.i;
  });
}

/* ---------- the document ---------- */
export function createDoc({ site }) {
  if (!SITE_RE.test(site)) throw new Error('bad site');
  const root = { k: ROOT, c: 0, s: '', ch: '\n', del: false, root: true, t: ['p', 0, ''], d: [false, 0, ''], im: [null, 0, ''] };
  const seq = [root];
  const byKey = new Map([[ROOT, root]]);
  let clock = 0, visible = 0, bad = 0;
  let waiting = [];
  const title = { v: '', c: 0, s: '' };
  const history = { undo: [], redo: [] };
  const alias = new Map();              /* a unit deleted and put back by Undo -> its copy */

  const see = c => { if (c > clock) clock = c; };
  const nextStamp = () => [++clock, site];
  const need = key => byKey.get(key);

  function eachKey(r, fn) {
    for (const [s, a, z] of r) for (let c = a; c <= z; c++) fn(keyOf(c, s));
  }
  function allKnown(r) {
    for (const [s, a, z] of r) for (let c = a; c <= z; c++) if (!byKey.has(keyOf(c, s))) return false;
    return true;
  }

  /* ---- one op, assumed clean ---- */
  function applyInsert(op) {
    const [c, s] = op.id;
    const units = cps(op.x);
    let have = 0;
    for (let j = 0; j < units.length; j++) if (byKey.has(keyOf(c + j, s))) have++;
    if (have === units.length) return 'dup';
    if (have) return 'bad';
    const origin = need(keyFromId(op.o));
    if (!origin) return 'wait';
    if (visible + units.length > LIMITS.hard || seq.length + units.length > LIMITS.nodes) return 'bad';
    let at = seq.indexOf(origin) + 1;
    while (at < seq.length && newer(seq[at].c, seq[at].s, c, s)) at++;
    let line = 0;
    const b = !!(op.m & 1), i = !!(op.m & 2);
    const nodes = units.map((ch, j) => {
      const cc = c + j;
      const n = { k: keyOf(cc, s), c: cc, s, ch, del: false };
      if (ch === '\n') {
        const a = op.L[line++];
        n.t = [a.t, cc, s]; n.d = [a.d, cc, s]; n.im = [a.im, cc, s];
      } else { n.b = [b, cc, s]; n.i = [i, cc, s]; }
      return n;
    });
    /* each next unit's origin is the one before it, and nothing can have been typed after a unit not here until now */
    seq.splice(at, 0, ...nodes);
    for (const n of nodes) byKey.set(n.k, n);
    visible += nodes.length;
    return 'ok';
  }
  function applyDelete(op) {
    if (!allKnown(op.r)) return 'wait';
    let hit = 0;
    eachKey(op.r, key => { const n = byKey.get(key); if (!n.del) { n.del = true; visible--; hit++; } });
    return hit ? 'ok' : 'dup';
  }
  function applyFormat(op) {
    if (!allKnown(op.r)) return 'wait';
    const [c, s] = op.s;
    let hit = 0;
    eachKey(op.r, key => {
      const n = byKey.get(key);
      if (n.ch === '\n') return;
      if (newer(c, s, n[op.m][1], n[op.m][2])) { n[op.m] = [op.v, c, s]; hit++; }
    });
    return hit ? 'ok' : 'dup';
  }
  function applyLine(op) {
    const n = need(keyFromId(op.id));
    if (!n) return 'wait';
    if (n.ch !== '\n') return 'bad';
    const [c, s] = op.s;
    if (!newer(c, s, n[op.a][1], n[op.a][2])) return 'dup';
    n[op.a] = [op.v, c, s];
    return 'ok';
  }
  function applyTitle(op) {
    const [c, s] = op.s;
    if (!newer(c, s, title.c, title.s)) return 'dup';
    title.v = op.v; title.c = c; title.s = s;
    return 'ok';
  }
  function maxCounter(op) {
    if (op.k === 'i') return op.id[0] + cps(op.x).length - 1;
    if (op.k === 'd') return 0;
    return op.s[0];
  }
  function applyOne(op) {
    if (op.k === 'i') return applyInsert(op);
    if (op.k === 'd') return applyDelete(op);
    if (op.k === 'f') return applyFormat(op);
    if (op.k === 'l') return applyLine(op);
    if (op.k === 't') return applyTitle(op);
    return 'bad';
  }
  /** Someone else's op, already through checkOp. */
  function apply(op) {
    see(maxCounter(op));
    const r = applyOne(op);
    if (r === 'bad') bad++;
    if (r === 'wait') {
      if (waiting.length < LIMITS.pending) waiting.push(op);
      return 'wait';
    }
    if (r === 'ok') drain();
    return r;
  }
  function drain() {
    for (let progress = true; progress && waiting.length;) {
      progress = false;
      const rest = [];
      for (const op of waiting) {
        const r = applyOne(op);
        if (r === 'wait') rest.push(op);
        else if (r === 'ok') progress = true;
      }
      waiting = rest;
    }
  }

  /* ---- my own changes: each returns its op and how to take it back ---- */
  function insertUnits(afterKey, units, out, inv) {
    let origin = idOf(afterKey);
    const made = [];
    let k = 0;
    while (k < units.length) {
      const first = units[k];
      const m = first.nl ? null : (first.b ? 1 : 0) + (first.i ? 2 : 0);
      let x = '', L = [], count = 0, mark = m, weight = 0;
      for (; k < units.length && count < LIMITS.run && weight < LIMITS.weight; k++, count++) {
        const u = units[k];
        if (!u.nl) {
          const um = (u.b ? 1 : 0) + (u.i ? 2 : 0);
          if (mark === null) mark = um;
          else if (um !== mark) break;
        }
        x += u.nl ? '\n' : u.ch;
        weight += u.nl ? JSON.stringify(u.a).length + 2 : u.ch.length * 2;
        if (u.nl) L.push(u.a);
      }
      const c = clock + 1;
      clock += count;
      const op = { k: 'i', id: [c, site], o: origin, x, m: mark ?? 0 };
      if (L.length) op.L = L;
      applyOne(op);
      out.push(op);
      for (let j = 0; j < count; j++) made.push(keyOf(c + j, site));
      origin = [c + count - 1, site];
    }
    if (made.length) inv.push({ u: 'del', keys: made.slice() });
    return made;
  }
  /* ids that follow on from each other make one range */
  function rangesOf(keys) {
    const by = new Map();
    for (const key of keys) {
      const [c, s] = idOf(key);
      if (!by.has(s)) by.set(s, []);
      by.get(s).push(c);
    }
    const out = [];
    for (const [s, list] of by) {
      list.sort((a, b) => a - b);
      let a = list[0], z = a;
      for (let j = 1; j <= list.length; j++) {
        if (list[j] === z + 1) { z = list[j]; continue; }
        out.push([s, a, z]);
        a = z = list[j];
      }
    }
    return out;
  }
  function chunked(ranges, fn) {
    for (let j = 0; j < ranges.length;) {
      const part = [];
      let total = 0;
      while (j < ranges.length && part.length < LIMITS.ranges) {
        const [s, a, z] = ranges[j];
        const room = LIMITS.span - total;
        if (!room) break;
        if (z - a + 1 > room) { part.push([s, a, a + room - 1]); ranges[j] = [s, a + room, z]; total = LIMITS.span; break; }
        part.push(ranges[j]);
        total += z - a + 1;
        j++;
      }
      fn(part);
    }
  }
  const unitOf = n => (n.ch === '\n'
    ? { k: n.k, nl: true, a: { t: n.t[0], d: !!n.d[0], im: n.im[0] } }
    : { k: n.k, ch: n.ch, b: !!n.b[0], i: !!n.i[0] });
  function deleteKeys(keys, out, inv) {
    const live = keys.filter(key => { const n = byKey.get(key); return n && !n.del && !n.root; });
    if (!live.length) return;
    /* how to bring them back: each unbroken stretch, after its last unit (which stays where it was) */
    const set = new Set(live);
    const stretches = [];
    let cur = null;
    for (const n of seq) {
      if (n.del) continue;
      if (set.has(n.k)) {
        if (!cur) { cur = { u: 'ins', after: n.k, units: [] }; stretches.push(cur); }
        cur.units.push(unitOf(n));
        cur.after = n.k;
      } else cur = null;
    }
    inv.push(...stretches.reverse());
    chunked(rangesOf(live), r => { const op = { k: 'd', r }; applyOne(op); out.push(op); });
  }
  function markKeys(keys, m, v, out, inv) {
    const live = keys.filter(key => { const n = byKey.get(key); return n && n.ch !== '\n' && !!n[m][0] !== v; });
    if (!live.length) return;
    inv.push({ u: 'fmt', m, v: !v, keys: live.slice() });
    chunked(rangesOf(live), r => { const op = { k: 'f', s: nextStamp(), r, m, v }; applyOne(op); out.push(op); });
  }
  function setLine(key, a, v, out, inv) {
    const n = byKey.get(key);
    if (!n || n.ch !== '\n') return;
    if (a === 'im' ? JSON.stringify(n.im[0]) === JSON.stringify(v) : n[a][0] === v) return;
    inv.push({ u: 'line', key, a, v: n[a][0] });
    const op = { k: 'l', s: nextStamp(), id: idOf(key), a, v };
    applyOne(op);
    out.push(op);
  }
  function writeLine(key, want, was, out, inv) {
    if (was.t !== want.t) setLine(key, 't', want.t, out, inv);
    if (want.t === 'check' && (was.t !== 'check' || was.d !== want.d)) setLine(key, 'd', want.d, out, inv);
    if (want.t === 'img' && (was.t !== 'img' || JSON.stringify(was.im) !== JSON.stringify(want.im))) setLine(key, 'im', want.im, out, inv);
  }

  /* ---- reading it back ---- */
  function render() {
    const blocks = [], lines = [], flat = [];
    for (const n of seq) {
      if (n.del) continue;
      if (n.ch === '\n') {
        lines.push({ key: n.k, keys: [], node: n });
        blocks.push({ t: 'p', runs: [] });
        n.bi = lines.length - 1;
        n.off = 0;
        if (!n.root) flat.push({ key: n.k, nl: true, line: lines.length - 1 });
        continue;
      }
      const k = lines.length - 1;
      const b = !!n.b[0], i = !!n.i[0], rr = blocks[k].runs, last = rr[rr.length - 1];
      if (last && last.b === b && last.i === i) last.text += n.ch;
      else rr.push({ text: n.ch, b, i });
      lines[k].keys.push(n.k);
      n.bi = k;
      n.off = lines[k].keys.length;
      flat.push({ key: n.k, ch: n.ch, b, i });
    }
    lines.forEach((ln, k) => {
      const n = ln.node, bk = blocks[k];
      let t = n.t[0];
      /* a picture line holding text: the words are what must survive */
      if (t === 'img' && (bk.runs.length || !n.im[0])) t = 'p';
      bk.t = t;
      if (t === 'check') bk.done = !!n.d[0];
      if (t === 'img') { bk.path = n.im[0].p; bk.alt = n.im[0].a; }
    });
    return { blocks, lines, flat };
  }

  /* ---- what changed in the editor ---- */
  /** The editor now shows `blocks`; `shown` is what it was drawn from. Works
      out the smallest edit (ending at the caret, when it's known) and makes it.
      -> { ops, anchor(pos) } or { rejected: 'full' }, changing nothing */
  function sync(shown, blocks, { caret = null, now = Date.now() } = {}) {
    const E = flatten(blocks);
    const R = shown.flat, nR = R.length, nE = E.units.length;
    const limit = caret ? nE - flatPlace(E, caret) : Infinity;
    const most = Math.min(nR, nE);
    let suf = 0;
    while (suf < most && suf < limit && sameUnit(R[nR - 1 - suf], E.units[nE - 1 - suf])) suf++;
    let pre = 0;
    while (pre < most - suf && sameUnit(R[pre], E.units[pre])) pre++;

    const gone = R.slice(pre, nR - suf).map(u => u.key);
    const fresh = E.units.slice(pre, nE - suf);
    /* refused whole, and said so: past the caps an insert wouldn't stick, here or there */
    if (fresh.length && (visible - gone.length + fresh.length > LIMITS.text || seq.length + fresh.length > LIMITS.nodes)) return { rejected: 'full' };

    const ops = [], inv = [];
    const made = fresh.length ? insertUnits(pre ? R[pre - 1].key : ROOT, fresh, ops, inv) : [];
    if (gone.length) deleteKeys(gone, ops, inv);

    /* what stayed may have changed its marks or its line */
    const on = { b: [], i: [] }, off = { b: [], i: [] };
    const compare = (r, e) => {
      if (r.nl) {
        const b = shown.blocks[r.line];
        const was = { t: b.t, d: !!b.done, im: b.t === 'img' ? { p: b.path, a: b.alt } : null };
        if (!sameLine(was, e.a)) writeLine(r.key, e.a, was, ops, inv);
        return;
      }
      for (const m of ['b', 'i']) if (r[m] !== e[m]) (e[m] ? on : off)[m].push(r.key);
    };
    for (let k = 0; k < pre; k++) compare(R[k], E.units[k]);
    for (let k = 0; k < suf; k++) compare(R[nR - 1 - k], E.units[nE - 1 - k]);
    const b0 = shown.blocks[0];
    const was0 = { t: b0.t, d: !!b0.done, im: b0.t === 'img' ? { p: b0.path, a: b0.alt } : null };
    if (!sameLine(was0, E.first)) writeLine(ROOT, E.first, was0, ops, inv);
    for (const m of ['b', 'i']) {
      markKeys(on[m], m, true, ops, inv);
      markKeys(off[m], m, false, ops, inv);
    }

    if (ops.length) remember(inv, now);
    const keysE = [...R.slice(0, pre).map(u => u.key), ...made, ...R.slice(nR - suf).map(u => u.key)];
    return {
      ops,
      /** A place in the blocks just given, as a key in the text. */
      anchor: pos => { const f = flatPlace(E, pos); return f <= 0 ? ROOT : keysE[f - 1]; },
    };
  }
  function remember(inv, now) {
    const typing = inv.every(x => x.u === 'ins' || x.u === 'del');
    const last = history.undo[history.undo.length - 1];
    if (last && last.typing && typing && now - last.at < TYPING_GAP) { last.inv.push(...inv); last.at = now; }
    else {
      history.undo.push({ inv, typing, at: now });
      if (history.undo.length > LIMITS.history) history.undo.shift();
    }
    history.redo = [];
  }

  /* ---- Undo: your own last change, whatever the other person has done since.
     Text you typed is deleted; text you deleted comes back as new units where
     it was (a tombstone stays one); marks and lines go back. ---- */
  const latest = key => { let k = key; while (alias.has(k)) k = alias.get(k); return k; };
  function takeBack(list) {
    const ops = [], inv = [];
    let caret = null;
    for (let j = list.length - 1; j >= 0; j--) {
      const x = list[j];
      if (x.u === 'del') {
        const keys = x.keys.map(latest);
        const live = keys.filter(k => { const n = byKey.get(k); return n && !n.del; });
        if (live.length) caret = live[0];
        deleteKeys(keys, ops, inv);
      } else if (x.u === 'ins') {
        if (visible + x.units.length > LIMITS.text || seq.length + x.units.length > LIMITS.nodes) continue;
        const made = insertUnits(x.after, x.units.map(u => ({ ...u })), ops, inv);
        x.units.forEach((u, k) => { if (u.k && made[k]) alias.set(u.k, made[k]); });
        if (made.length) caret = made[made.length - 1];
      } else if (x.u === 'fmt') {
        const keys = x.keys.map(latest);
        markKeys(keys, x.m, x.v, ops, inv);
        if (keys.length) caret = keys[keys.length - 1];
      } else if (x.u === 'line') {
        setLine(latest(x.key), x.a, x.v, ops, inv);
        caret = latest(x.key);
      }
    }
    return { ops, inv, caret };
  }
  /* a step the other person has already made empty (they deleted those words) is passed over */
  function step(from, to) {
    while (from.length) {
      const r = takeBack(from.pop().inv);
      if (r.inv.length) to.push({ inv: r.inv, typing: false, at: 0 });
      if (r.ops.length) return { ops: r.ops, caret: r.caret };
    }
    return null;
  }

  /* ---- places in the text ---- */
  function anchorIn(shown, pos) {
    const n = shown.lines.length;
    if (pos.i >= n) {
      const ln = shown.lines[n - 1];
      return ln.keys.length ? ln.keys[ln.keys.length - 1] : ln.key;
    }
    const ln = shown.lines[Math.max(0, pos.i)];
    const k = cpCount(cps(textOfBlock(shown.blocks[Math.max(0, pos.i)])), pos.o);
    if (k <= 0 || !ln.keys.length) return ln.key;
    return ln.keys[Math.min(k, ln.keys.length) - 1];
  }
  /** Where a place is now: right after its unit or, if that was deleted, after
      the nearest unit before it that wasn't. Null for a unit not here yet. */
  function where(key, shown) {
    const start = byKey.get(key);
    if (!start) return null;
    let at = seq.indexOf(start);
    while (at > 0 && (seq[at].del || seq[at].bi === undefined)) at--;
    const n = seq[at];
    const i = Math.min(n.bi ?? 0, shown.blocks.length - 1);
    return { i, o: utf16Of(cps(textOfBlock(shown.blocks[i])), n.off ?? 0) };
  }

  return {
    site,
    render, sync, apply, where, anchorIn,
    /** A note's first content, with no undo steps -> ops, or null if it is too long to share. */
    init(blocks, text) {
      const r = sync(render(), blocks);
      if (r.rejected) return null;
      history.undo = [];
      history.redo = [];
      return [...r.ops, ...this.setTitle(text)];
    },
    /** The title is one register; its own text box keeps its own undo. */
    setTitle(text) {
      const v = cleanTitle(text);
      if (v === title.v) return [];
      const op = { k: 't', s: nextStamp(), v };
      applyOne(op);
      return [op];
    },
    undo: () => step(history.undo, history.redo),
    redo: () => step(history.redo, history.undo),
    get title() { return title.v; },
    get length() { return visible; },
    get waiting() { return waiting.length; },
    get bad() { return bad; },
    get nodes() { return seq.length; },
    get clock() { return clock; },
    canUndo: () => history.undo.length > 0,
    canRedo: () => history.redo.length > 0,
    /** Is this unit written and not deleted? (tests) */
    alive: key => { const n = byKey.get(key); return !!n && !n.del; },
    /** The whole visible text with ids and everything that shows, to compare two copies. */
    digest: () => JSON.stringify({ title: title.v, blocks: render().blocks, keys: render().flat.map(u => u.key) }),
  };
}

export default { createDoc, checkOp, sameBlocks, cleanText, cleanTitle, keyFromId, idFromKey, isPlace, LIMITS, KINDS, ROOT, SITE_RE };
