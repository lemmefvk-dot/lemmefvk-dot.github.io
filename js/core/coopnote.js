/* ============================================================
   coopnote.js — one Write Together session in Notes: a private
   pair.js room carrying a shared text (textcrdt.js). No DOM; the
   window side is js/apps/notes-coop.js.

   The host opens the room while editing their note as usual; nothing
   about the note travels until a friend knocks. Then the note becomes
   the host's first ops, in order, and the friend's copy is complete
   once they hold ops up to the base the host names. So joining late
   is not a special case: it is catching up.

   The public broker may lose a message (QoS 0), so ops are numbered per
   sender and kept until the other side says it has them:
     ops { s, q, o:[…] }   ops numbered q, q+1…, sender's site s
     st  { s, h, n, b? }   "I have your ops up to h; mine go up to n"
                           (b: the host's base), every BEAT ms and sooner
                           after a gap. The other side resends what's
                           missing, in small messages, so a dropped
                           message heals by itself. Ops carry no order of
                           their own: the text takes them any way round,
                           and a repeat changes nothing.
     cur { on, a?, z? }    where this person's selection runs, by id (so it
                           stays on the same letters as the text moves);
                           repeated on the beat, since one can be lost too.
                           (Not `f`: on the wire that is pair.js's sender id.)

   Every message passes a validator here (each op through checkOp), and
   a site that isn't the other person's (a host is h…, a guest g…) is
   ignored. pair.js has already dropped floods, oversized messages,
   strangers and whatever doesn't unseal.

     openCoop({ role, code?, initial })
       initial() -> { blocks, title }   host: the note, read when a friend joins
       -> session { code, role, phase, error, peer, doc, ready, topic,
                    on(fn) -> off  fn(type, data):
                      'phase' p · 'peer' p · 'ready' · 'remote' · 'cursor' c
                      'left' { reason, peer } · 'live' st · 'toolong'
                    push(ops) · cursor({ on, a, f }) · leave() · peek() }
   ============================================================ */
import { openPair } from './pair.js';
import * as T from './textcrdt.js';

export const BEAT = 1200;
const FLUSH_MS = 40;
const RESEND_AFTER = 700;
const QUICK_MS = 250;
const CURSOR_MS = 90;
const MSG_CHARS = 10000;
const RESEND_MSGS = 3;
const OPS_MAX = 300;
const SEEN_MAX = 6000;
const QMAX = 1e12;

const count = v => Number.isSafeInteger(v) && v >= 0 && v <= QMAX;

export const TYPES = {
  ops(m) {
    if (typeof m.s !== 'string' || !T.SITE_RE.test(m.s) || !count(m.q) || m.q < 1) return null;
    if (!Array.isArray(m.o) || !m.o.length || m.o.length > OPS_MAX) return null;
    const o = [];
    for (const op of m.o) {
      const clean = T.checkOp(op, m.s);
      if (!clean) return null;
      o.push(clean);
    }
    return { s: m.s, q: m.q, o };
  },
  st(m) {
    if (typeof m.s !== 'string' || !T.SITE_RE.test(m.s) || !count(m.h) || !count(m.n)) return null;
    if (m.b !== undefined && !count(m.b)) return null;
    return { s: m.s, h: m.h, n: m.n, b: m.b };
  },
  cur(m) {
    if (m.on === false) return { on: false };
    if (m.on !== true || !T.isPlace(m.a) || !T.isPlace(m.z)) return null;
    return { on: true, a: T.keyFromId(m.a), f: T.keyFromId(m.z) };
  },
};

const randomSite = role => {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return (role === 'host' ? 'h' : 'g') + [...a].map(b => (b % 36).toString(36)).join('');
};

export function openCoop({ role, code = null, initial }) {
  const host = role === 'host';
  const site = randomSite(role);
  const room = openPair({ kind: 'note', role, code, types: TYPES, rtc: false });
  const subs = new Set();
  const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error('[coop]', err); } });
  const log = [];                 /* my ops the other side hasn't confirmed: { q, op, at } */
  const seen = new Set();         /* their ops I hold beyond `got` */
  let doc = null, ready = false, base = null, peerSite = null, ended = false;
  let myQ = 0, got = 0, acked = 0;
  let flushT = 0, beatT = 0, quickT = 0, curT = 0, curLast = 0;
  let curNow = null, curSent = '';
  const tally = { dup: 0, refused: 0, sent: 0, resent: 0 };

  /* ---------- sending ---------- */
  /* one or a few messages from log[at], consecutive ops up to `end` */
  function sendFrom(at, end, most) {
    const stamp = performance.now();
    let k = at, sent = 0;
    while (k < end && sent < most) {
      const q = log[k].q, o = [];
      let size = 0, j = k;
      for (; j < end && o.length < OPS_MAX; j++) {
        const len = JSON.stringify(log[j].op).length;
        if (o.length && size + len > MSG_CHARS) break;
        o.push(log[j].op);
        size += len;
      }
      if (!room.send('ops', { s: site, q, o })) return sent;
      for (let x = k; x < j; x++) log[x].at = stamp;
      k = j;
      sent++;
    }
    return sent;
  }
  function flush() {
    clearTimeout(flushT);
    flushT = 0;
    if (ended || !room.peer) return;
    const at = log.findIndex(x => !x.at);
    if (at >= 0) tally.sent += sendFrom(at, log.length, 4);
    if (log.some(x => !x.at)) flushT = setTimeout(flush, FLUSH_MS * 4);
  }
  function push(ops) {
    if (ended || !ops || !ops.length) return;
    for (const op of ops) log.push({ q: ++myQ, op, at: 0 });
    if (!flushT) flushT = setTimeout(flush, FLUSH_MS);
  }
  function resend(h) {
    const now = performance.now();
    const at = log.findIndex(x => x.q > h && now - x.at >= RESEND_AFTER);
    if (at < 0) return;
    let end = at;
    while (end < log.length && now - log[end].at >= RESEND_AFTER) end++;
    tally.resent += sendFrom(at, end, RESEND_MSGS);
  }
  function status() {
    if (ended || !doc || !room.peer) return;
    room.send('st', { s: site, h: got, n: myQ, ...(host && base !== null ? { b: base } : {}) });
  }
  function quickStatus() {
    if (!quickT) quickT = setTimeout(() => { quickT = 0; status(); }, QUICK_MS);
  }
  function sendCursor() {
    clearTimeout(curT);
    curT = 0;
    if (ended || !curNow || !room.peer) return;
    curLast = performance.now();
    curSent = JSON.stringify(curNow);
    room.send('cur', curNow);
  }
  function beat() {
    status();
    flush();
    /* the last word on where this person is: lost once, it would otherwise stay wrong */
    if (curNow) sendCursor();
  }

  /* ---------- receiving ---------- */
  /* the other person's site: the first one that is the right kind, and only that one */
  function theirs(s) {
    if (peerSite) return s === peerSite;
    if (s[0] !== (host ? 'g' : 'h')) return false;
    peerSite = s;
    return true;
  }
  function maybeReady() {
    if (ready || base === null || got < base) return;
    ready = true;
    emit('ready');
  }
  function onOps(m) {
    if (!doc || !theirs(m.s)) { tally.refused++; return; }
    let changed = false;
    m.o.forEach((op, j) => {
      const q = m.q + j;
      if (q <= got || seen.has(q) || seen.size >= SEEN_MAX) { tally.dup++; return; }
      seen.add(q);
      if (doc.apply(op) === 'ok') changed = true;
    });
    while (seen.has(got + 1)) { seen.delete(got + 1); got++; }
    if (seen.size) quickStatus();          /* a gap: ask for what's missing now, not on the next beat */
    if (changed) emit('remote');
    maybeReady();
  }
  function onStatus(m) {
    if (!doc || !theirs(m.s)) { tally.refused++; return; }
    if (!host && m.b !== undefined && base === null) base = m.b;
    const h = Math.min(m.h, myQ);
    if (h > acked) {
      acked = h;
      let cut = 0;
      while (cut < log.length && log[cut].q <= acked) cut++;
      if (cut) log.splice(0, cut);
    }
    if (h < myQ) resend(h);
    if (m.n > got) quickStatus();
    maybeReady();
  }

  /* ---------- the room ---------- */
  function stop() {
    if (ended) return;
    ended = true;
    clearTimeout(flushT); clearTimeout(quickT); clearTimeout(curT); clearInterval(beatT);
  }
  function onPeer() {
    doc = T.createDoc({ site });
    if (host) {
      const first = initial ? initial() : { blocks: [], title: '' };
      const ops = doc.init(first.blocks, first.title);
      if (!ops) { stop(); room.leave(); emit('toolong'); return; }
      push(ops);
      base = myQ;
      ready = true;
      emit('ready');
    }
    clearInterval(beatT);
    beatT = setInterval(beat, BEAT);
    status();
  }
  room.on((type, data) => {
    if (type === 'phase') {
      if (data === 'closed') stop();
      emit('phase', data);
    } else if (type === 'peer') {
      onPeer();
      if (!ended) emit('peer', data);
    } else if (type === 'left') {
      stop();
      emit('left', data);
    } else if (type === 'live') {
      emit('live', data);
    } else if (type === 'msg') {
      if (ended) return;
      if (data.t === 'ops') onOps(data.m);
      else if (data.t === 'st') onStatus(data.m);
      else if (data.t === 'cur') emit('cursor', data.m);
    }
  });

  return {
    get code() { return room.code; },
    get role() { return room.role; },
    get phase() { return room.phase; },
    get error() { return room.error; },
    get peer() { return room.peer; },
    get topic() { return room.topic; },
    get doc() { return doc; },
    get ready() { return ready; },
    get site() { return site; },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    push,
    /** Where this person's selection is: { on:false }, or { on:true, a, f } as keys. */
    cursor(c) {
      const next = c.on ? { on: true, a: T.idFromKey(c.a), z: T.idFromKey(c.f) } : { on: false };
      curNow = next;
      if (JSON.stringify(next) === curSent || curT) return;
      const wait = CURSOR_MS - (performance.now() - curLast);
      if (wait <= 0) sendCursor();
      else curT = setTimeout(sendCursor, wait);
    },
    leave() {
      if (!ended) flush();           /* what was just typed goes before the goodbye */
      stop();
      room.leave();
    },
    /* for the play-tests */
    peek: () => ({ got, myQ, acked, log: log.length, seen: seen.size, base, ready, peerSite, tally: { ...tally },
      room: room.stats(), me: room.me, peerId: room.peer?.id || null, waiting: doc ? doc.waiting : 0, bad: doc ? doc.bad : 0 }),
  };
}

export default { openCoop, TYPES, BEAT };
