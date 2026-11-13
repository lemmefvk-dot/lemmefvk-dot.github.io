/* ============================================================
   quizroom.js — a live quiz room: one host, up to 30 players, on the
   same live connection and with the same safety as js/core/pair.js
   (which only ever pairs two people, so a room of many is built here
   on its sealing and key derivation rather than by changing it).

   TRANSPORT. Rooms ride StaticOS's one live connection
   (portal/live.js), a free PUBLIC MQTT broker. The code is stretched
   (PBKDF2, salted "quiz") into an AES-GCM key and a topic id, exactly
   as pair.js does, so what the broker carries is "pair/quiz/<24 hex>"
   and sealed bytes, not the code, the names or the questions. Anyone
   who HAS the code can read and join the room, so the Quiz tab tells
   people to share it only with the players. What the broker still
   sees: that a room exists, when it is busy, how much is sent.

   THE HOST DECIDES. Players send only what they chose and how long
   they took on their own screen. The host holds the answers, checks
   them, scores them (core/quiz.js) and publishes the board.
     · a question goes out WITHOUT its right answers; they are sent
       only in the "rev" message, after the question has closed;
     · an answer counts once (the first), only for the open question
       (matched by a random question id), only from someone who joined;
     · a claimed time is clamped to what the host itself saw: nobody
       can have answered before the question reached them, and can
       claim at most GRACE ms less than the host measured.

   PROTOCOL — sealed JSON { v:1, t, f, … }, f = a random id for this
   session (never the device id).
     player → host   join { n, c }  ans { q, k:[choice], at }  hb {}  bye {}
     host → players  wel { to, p }  full { to }
                     lob { title, total, pl:[[p,name,hue]] }
                     q   { q, i, total, txt, ch:[…], mu, lim, left, img?, got:[p] }
                     rev { q, i, ok:[…], dist:[…], bd:[[p,name,hue,total,gain,right]] }
                     end { bd }   bye {}
   The host repeats its current message every 2 s, so a message the
   public server dropped (it is best-effort) is mended by the next.

   SAFETY — anything can arrive on a public topic, so: text over
   WIRE_MAX is dropped unread; more than IN_PER_SEC a second is
   dropped before it is even unsealed; what fails to unseal or parse,
   has an unknown type for the receiver's role, a bad session id or
   v ≠ 1 is ignored; each player is capped at PLAYER_PER_SEC; the room
   holds at most MAX_PLAYERS, and later knocks are told "full" (at a
   limited rate); every message passes a schema check that returns a
   cleaned copy or nothing (lengths, counts, ranges, a picture must be
   a small JPEG data URL); names lose control and bidi characters; a
   player only believes the one host that welcomed it; nothing is ever
   evaluated or shown as markup.

     openQuizHost({ quiz, pictures:(i)=>Promise<dataURL|null> }) -> host
     openQuizPlayer({ code, name }) -> player
   Both: on(fn) -> off (fn(type, data): 'change'), state(), leave(),
   code, kind, stats() -> { heard, dropped, ignored, refused }.
   ============================================================ */
import * as live from '../portal/live.js';
import { me } from './identity.js';
import { isCode, normalizeCode, randomCode, safeName, hueOf, cleanText } from './roomcode.js';
import { deriveRoom, seal, unseal, secureOk } from './pair.js';
import { isRight, pointsFor, LIMITS } from './quiz.js';

export const MAX_PLAYERS = 30;
const WIRE_MAX = 24000;
const PLAIN_MAX = 16000;
const IN_PER_SEC = 300;
const PLAYER_PER_SEC = 12;
const KNOCK_EVERY = 1000;
const JOIN_WAIT = 10000;
const REPEAT_EVERY = 2000;
const HB_EVERY = 5000;
const AWAY_AFTER = 20000;
const QUIET_MS = 15000;
export const GRACE = 1500;             /* a claimed time can be at most this much under the host's own */
const LATE_MS = 1200;                  /* answers still in flight when the time runs out */
const IMG_MAX = 14000;
const ID_RE = /^[a-z0-9]{10}$/;
const QID_RE = /^[a-z0-9]{6}$/;
const IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const HOST_TYPES = new Set(['wel', 'full', 'lob', 'q', 'rev', 'end', 'bye']);
const PLAYER_TYPES = new Set(['join', 'ans', 'hb', 'bye']);

const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const sessionId = () => [...rand(10)].map(b => (b % 36).toString(36)).join('');
const questionId = () => [...rand(6)].map(b => (b % 36).toString(36)).join('');
const clock = () => performance.now();
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/* shared plumbing: the sealed topic, the in-flood guard, the parse gate */
function channel(role, code, onMessage, onLive) {
  const myId = sessionId();
  const C = { myId, key: null, topic: null, closed: false, counts: { heard: 0, dropped: 0, ignored: 0, refused: 0 } };
  let unsub = null, offLive = null, inq = Promise.resolve(), outq = Promise.resolve();
  let inWin = { at: 0, n: 0 };
  const allowed = role === 'host' ? PLAYER_TYPES : HOST_TYPES;
  C.wire = (t, body = {}) => {
    if (!C.key || (C.closed && t !== 'bye')) return false;
    const text = JSON.stringify({ v: 1, t, f: myId, ...body });
    if (text.length > PLAIN_MAX) return false;
    const topic = C.topic;
    outq = outq.then(async () => { try { live.publish(topic, await seal(C.key, text)); } catch (e) { /* gone */ } });
    return live.status() === 'live';
  };
  const onText = text => {
    if (C.closed) return;
    if (typeof text !== 'string' || text.length > WIRE_MAX) { C.counts.ignored++; return; }
    const now = performance.now();
    if (now - inWin.at > 1000) { inWin = { at: now, n: 0 }; }
    if (++inWin.n > IN_PER_SEC) { C.counts.dropped++; return; }          /* a flood is dropped before it is unsealed */
    inq = inq.then(async () => {
      const plain = await unseal(C.key, text);
      if (plain === null || plain.length > PLAIN_MAX) { C.counts.ignored++; return; }
      let m;
      try { m = JSON.parse(plain); } catch (e) { C.counts.ignored++; return; }
      if (!m || typeof m !== 'object' || Array.isArray(m) || m.v !== 1 || typeof m.t !== 'string' || !allowed.has(m.t)
        || typeof m.f !== 'string' || !ID_RE.test(m.f)) { C.counts.ignored++; return; }
      if (m.f === myId) return;
      if (!C.closed) onMessage(m);
    });
  };
  C.start = (cb) => {
    deriveRoom('quiz', code).then(k => {
      if (C.closed) return;
      C.key = k.key; C.topic = k.topic;
      unsub = live.subscribe(k.topic, onText);
      /* the subscription goes out with the connection: give it a beat to land */
      offLive = live.onStatus(st => { onLive(st); if (st === 'live') setTimeout(() => { if (!C.closed) cb(); }, 150); });
    }).catch(() => onLive('insecure'));
  };
  C.close = (bye) => {
    if (C.closed) return;
    if (bye) C.wire('bye');
    C.closed = true;
    const off = unsub; unsub = null;
    outq.then(() => { try { off && off(); } catch (e) { /* gone */ } });
    try { offLive && offLive(); } catch (e) { /* gone */ }
    offLive = null;
  };
  return C;
}

const cleanName = s => safeName(s) || 'Friend';

/* ================= the host ================= */
export function openQuizHost({ quiz, pictures = async () => null }) {
  const code = randomCode();
  const subs = new Set();
  const S = {
    phase: 'connecting', error: null, qi: -1, qid: null, openedAt: 0, closeAt: 0, closed: false,
    players: new Map(), order: [], rev: null, img: null, lastMsg: null, liveState: 'connecting',
  };
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  let repeatT = 0, qT = 0;
  const emit = () => subs.forEach(fn => { try { fn('change', null); } catch (e) { console.error('[quizroom]', e); } });

  const C = channel('host', code, onMessage, st => { S.liveState = st; if (st === 'insecure') { S.error = 'insecure'; S.phase = 'closed'; } emit(); });
  if (!secureOk()) { S.error = 'insecure'; S.phase = 'closed'; C.closed = true; }

  const active = () => [...S.players.values()].filter(p => !p.gone);
  const board = () => [...S.players.values()].sort((a, b) => b.score - a.score || a.idx - b.idx);
  const bd = () => board().map(p => [p.idx, p.name, p.hue, p.score, p.gain, p.ans ? (p.ans.right ? 1 : 0) : 2]);
  const q = () => quiz.questions[S.qi];
  const replied = {};
  const mayReply = (k, gap) => { const t = clock(); if (t - (replied[k] || -1e9) < gap) return false; replied[k] = t; return true; };

  function lobMsg() { return { title: cleanText(quiz.title, LIMITS.title), total: quiz.questions.length, pl: [...S.players.values()].map(p => [p.idx, p.name, p.hue]) }; }
  function qMsg() {
    const cur = q();
    const limMs = cur.time * 1000;
    const body = {
      q: S.qid, i: S.qi, total: quiz.questions.length, txt: cur.text, ch: cur.choices.map(c => c.text),
      mu: cur.choices.filter(c => c.ok).length > 1, lim: cur.time,
      left: limMs ? Math.max(0, Math.round(limMs - (clock() - S.openedAt))) : -1,
      got: [...S.players.values()].filter(p => p.ans).map(p => p.idx),
    };
    if (S.img) body.img = S.img;
    return body;
  }
  function publish() {
    if (C.closed) return;
    if (S.phase === 'lobby') C.wire('lob', lobMsg());
    else if (S.phase === 'question') C.wire('q', qMsg());
    else if (S.phase === 'reveal' || S.phase === 'end') C.wire(S.phase === 'end' ? 'end' : 'rev', S.rev);
  }
  function setPhase(p) {
    S.phase = p;
    clearInterval(repeatT);
    publish();
    if (p === 'lobby' || p === 'question' || p === 'reveal' || p === 'end') repeatT = setInterval(publish, REPEAT_EVERY);
    emit();
  }

  function onMessage(m) {
    let p = S.players.get(m.f);
    if (!p) {
      if (m.t !== 'join') { C.counts.refused++; return; }
      if (S.phase === 'connecting' || S.phase === 'closed') return;
      if (S.players.size >= MAX_PLAYERS) { C.counts.refused++; if (mayReply('full', 400)) C.wire('full', { to: m.f }); return; }
      let name = cleanName(m.n), n = 2;
      const taken = new Set([...S.players.values()].map(x => x.name));
      for (let base = name; taken.has(name); n++) name = `${base.slice(0, 20)} ${n}`;
      p = { id: m.f, idx: S.order.length, name, hue: hueOf(m.c), score: 0, gain: 0, ans: null, seen: clock(), gone: false, win: { at: 0, n: 0 }, late: S.phase !== 'lobby' };
      S.order.push(p.id);
      S.players.set(p.id, p);
      C.counts.heard++;
      C.wire('wel', { to: p.id, p: p.idx });
      publish();
      emit();
      return;
    }
    const now = clock();
    if (now - p.win.at > 1000) { p.win.at = now; p.win.n = 0; }
    if (++p.win.n > PLAYER_PER_SEC) { C.counts.dropped++; return; }
    C.counts.heard++;
    p.seen = now;
    if (p.gone) { p.gone = false; emit(); }
    switch (m.t) {
      case 'join': if (mayReply(`wel${p.idx}`, 500)) C.wire('wel', { to: p.id, p: p.idx }); return;
      case 'hb': return;
      case 'bye': p.gone = true; if (S.phase === 'lobby') { S.players.delete(p.id); /* indexes stay: nobody is renumbered */ } emit(); maybeClose(); return;
      case 'ans': return onAnswer(p, m);
      default: C.counts.ignored++;
    }
  }

  function onAnswer(p, m) {
    if (S.phase !== 'question' || m.q !== S.qid || p.ans) { C.counts.ignored++; return; }
    const cur = q(), n = cur.choices.length;
    if (!Array.isArray(m.k) || m.k.length < 1 || m.k.length > n || !m.k.every(v => int(v, 0, n - 1)) || new Set(m.k).size !== m.k.length
      || !Number.isFinite(m.at) || m.at < 0 || m.at > 3600000) { C.counts.ignored++; return; }
    const hostEl = clock() - S.openedAt;
    const limMs = cur.time * 1000;
    if (limMs && hostEl > limMs + LATE_MS) { C.counts.ignored++; return; }
    const el = Math.min(hostEl, Math.max(hostEl - GRACE, m.at));         /* never faster than the host saw, never later than it saw */
    const right = isRight(cur, m.k);
    p.ans = { k: m.k.slice().sort((a, b) => a - b), el, right, pts: pointsFor(right, el, cur.time) };
    emit();
    maybeClose();
  }
  function maybeClose() {
    if (S.phase !== 'question') return;
    const live2 = active();
    if (live2.length && live2.every(p => p.ans)) later(() => { if (S.phase === 'question') closeQuestion(); }, 300);
  }

  async function openQuestion(i) {
    S.qi = i;
    S.qid = questionId();
    S.img = null;
    for (const p of S.players.values()) { p.ans = null; p.gain = 0; }
    const cur = q();
    if (cur.img || cur.imgData) {
      try { const d = await Promise.race([pictures(i), new Promise(r => setTimeout(() => r(null), 4000))]); if (typeof d === 'string' && d.length <= IMG_MAX && IMG_RE.test(d)) S.img = d; } catch (e) { S.img = null; }
      if (C.closed || S.qi !== i) return;
    }
    S.openedAt = clock();
    clearTimeout(qT);
    if (cur.time) qT = later(() => { if (S.phase === 'question' && S.qi === i) closeQuestion(); }, cur.time * 1000 + LATE_MS);
    setPhase('question');
  }
  function closeQuestion() {
    if (S.phase !== 'question') return;
    clearTimeout(qT);
    const cur = q();
    const dist = cur.choices.map(() => 0);
    for (const p of S.players.values()) {
      p.gain = p.ans ? p.ans.pts : 0;
      p.score += p.gain;
      if (p.ans) p.ans.k.forEach(k => { dist[k]++; });
    }
    S.rev = { q: S.qid, i: S.qi, ok: cur.choices.map((c, i) => (c.ok ? i : -1)).filter(i => i >= 0), dist, bd: bd() };
    setPhase('reveal');
  }
  function finish() {
    clearTimeout(qT);
    S.rev = { bd: bd() };
    setPhase('end');
  }

  C.start(() => { if (S.phase === 'connecting') setPhase('lobby'); });

  const api = {
    get code() { return code; },
    get kind() { return 'quiz'; },
    role: 'host',
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    stats: () => ({ ...C.counts }),
    state() {
      const cur = S.qi >= 0 ? q() : null;
      return {
        phase: S.phase, error: S.error, live: S.liveState, title: quiz.title, total: quiz.questions.length, qi: S.qi, qid: S.qid,
        question: cur ? { text: cur.text, choices: cur.choices.map(c => ({ text: c.text, ok: c.ok })), time: cur.time, hasImg: !!S.img } : null,
        openedAt: S.openedAt,
        players: [...S.players.values()].map(p => ({ idx: p.idx, name: p.name, hue: p.hue, score: p.score, gain: p.gain, answered: !!p.ans, right: p.ans ? p.ans.right : null, gone: p.gone, late: p.late })),
        answered: [...S.players.values()].filter(p => p.ans).length,
        rev: S.rev,
      };
    },
    start() { if (S.phase === 'lobby' && S.players.size) openQuestion(0); },
    closeQuestion,
    next() { if (S.phase !== 'reveal') return; if (S.qi + 1 >= quiz.questions.length) finish(); else openQuestion(S.qi + 1); },
    end() { if (S.phase === 'question') closeQuestion(); finish(); },
    leave() {
      if (S.phase === 'closed') return;
      clearInterval(repeatT); clearTimeout(qT);
      timers.forEach(clearTimeout); timers.clear();
      C.close(true);
      S.phase = 'closed';
      emit();
    },
    /* a player gone quiet is not waited for */
    sweep() {
      const now = clock();
      let changed = false;
      for (const p of S.players.values()) if (!p.gone && now - p.seen > AWAY_AFTER) { p.gone = true; changed = true; }
      if (changed) { emit(); maybeClose(); }
    },
    _debug: { topic: () => C.topic },
  };
  const sweeper = setInterval(() => { if (S.phase === 'closed') clearInterval(sweeper); else api.sweep(); }, 3000);
  return api;
}

/* ================= a player ================= */
const cleanBoard = bd => {
  if (!Array.isArray(bd) || bd.length > MAX_PLAYERS) return null;
  const out = [];
  for (const r of bd) {
    if (!Array.isArray(r) || r.length !== 6 || !int(r[0], 0, 999) || !int(r[3], 0, 1e7) || !int(r[4], 0, 1000) || !int(r[5], 0, 2)) return null;
    out.push({ idx: r[0], name: cleanName(r[1]), hue: hueOf(r[2]), score: r[3], gain: r[4], right: r[5] });
  }
  return out;
};
const msgs = {
  wel: m => (int(m.p, 0, 999) && typeof m.to === 'string' ? { to: m.to, p: m.p } : null),
  full: m => (typeof m.to === 'string' ? { to: m.to } : null),
  lob: m => {
    if (typeof m.title !== 'string' || !int(m.total, 1, LIMITS.questions) || !Array.isArray(m.pl) || m.pl.length > MAX_PLAYERS) return null;
    const pl = [];
    for (const r of m.pl) { if (!Array.isArray(r) || !int(r[0], 0, 999)) return null; pl.push({ idx: r[0], name: cleanName(r[1]), hue: hueOf(r[2]) }); }
    return { title: cleanText(m.title, LIMITS.title), total: m.total, pl };
  },
  q: m => {
    if (typeof m.q !== 'string' || !QID_RE.test(m.q) || !int(m.i, 0, LIMITS.questions - 1) || !int(m.total, 1, LIMITS.questions)
      || typeof m.txt !== 'string' || m.txt.length > LIMITS.text * 2 || !Array.isArray(m.ch) || m.ch.length < 2 || m.ch.length > LIMITS.choices
      || !int(m.lim, 0, LIMITS.timeMax) || !int(m.left, -1, LIMITS.timeMax * 1000 + 5000) || !Array.isArray(m.got) || m.got.length > MAX_PLAYERS
      || !m.got.every(v => int(v, 0, 999))) return null;
    const ch = m.ch.map(c => (typeof c === 'string' ? cleanText(c, LIMITS.choice) : ''));
    const txt = cleanText(m.txt, LIMITS.text);
    if (!txt || ch.some(c => !c)) return null;
    const out = { q: m.q, i: m.i, total: m.total, txt, ch, mu: m.mu === true, lim: m.lim, left: m.left, got: m.got, img: null };
    if (m.img !== undefined) { if (typeof m.img !== 'string' || m.img.length > IMG_MAX || !IMG_RE.test(m.img)) return null; out.img = m.img; }
    return out;
  },
  rev: m => {
    const b = cleanBoard(m.bd);
    if (typeof m.q !== 'string' || !QID_RE.test(m.q) || !int(m.i, 0, LIMITS.questions - 1) || !b || !Array.isArray(m.ok) || m.ok.length < 1 || m.ok.length > LIMITS.choices
      || !m.ok.every(v => int(v, 0, LIMITS.choices - 1)) || !Array.isArray(m.dist) || m.dist.length > LIMITS.choices || !m.dist.every(v => int(v, 0, MAX_PLAYERS))) return null;
    return { q: m.q, i: m.i, ok: m.ok, dist: m.dist, bd: b };
  },
  end: m => { const b = cleanBoard(m.bd); return b ? { bd: b } : null; },
  bye: () => ({}),
};

export function openQuizPlayer({ code, name = '' }) {
  const rc = normalizeCode(code);
  const subs = new Set();
  const S = {
    phase: 'connecting', error: null, idx: null, title: '', total: 0, lobby: [], q: null, shownAt: 0, deadline: 0, picks: null, sent: false, acked: false,
    rev: null, board: [], lastHeard: 0, liveState: 'connecting', hostId: null, seen: [],
  };
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  let knockT = 0, hbT = 0, ansT = 0, quietT = 0;
  const emit = () => subs.forEach(fn => { try { fn('change', null); } catch (e) { console.error('[quizroom]', e); } });
  const fail = reason => { S.error = reason; stop(); S.phase = 'closed'; emit(); };
  const C = channel('player', rc, onMessage, st => { S.liveState = st; if (st === 'insecure') { S.error = 'insecure'; S.phase = 'closed'; } emit(); });
  function stop() { clearInterval(knockT); clearInterval(hbT); clearInterval(ansT); clearInterval(quietT); timers.forEach(clearTimeout); timers.clear(); C.close(false); }
  const who = () => { const m = me(); return { n: cleanName(name || m.name), c: hueOf(m.color) }; };

  function onMessage(m) {
    if (S.hostId === null) {
      if (m.t !== 'wel' && m.t !== 'full') { C.counts.refused++; return; }
      const c = msgs[m.t](m);
      if (!c || c.to !== C.myId) { C.counts.ignored++; return; }
      if (m.t === 'full') { fail('full'); return; }
      S.hostId = m.f; S.idx = c.p; S.lastHeard = clock();
      clearInterval(knockT);
      S.phase = 'lobby';
      hbT = setInterval(() => C.wire('hb'), HB_EVERY);
      quietT = setInterval(() => { if (clock() - S.lastHeard > QUIET_MS) fail('lost'); }, 3000);
      C.counts.heard++;
      emit();
      return;
    }
    if (m.f !== S.hostId) { C.counts.refused++; return; }                    /* only the host that welcomed us */
    const fn = msgs[m.t];
    const c = fn ? fn(m) : null;
    if (!c) { C.counts.ignored++; return; }
    S.lastHeard = clock();
    C.counts.heard++;
    switch (m.t) {
      case 'wel': return;
      case 'full': return;
      case 'bye': fail('host-left'); return;
      case 'lob':
        if (S.phase === 'lobby') { S.title = c.title; S.total = c.total; S.lobby = c.pl; emit(); }
        return;
      case 'q': {
        const cur = S.q;
        if (cur && c.q === cur.q) {                                          /* the host repeating itself */
          if (S.phase === 'question') { S.q.got = c.got; if (c.got.includes(S.idx)) S.acked = true; emit(); }
          return;
        }
        if (cur && c.i <= cur.i) { C.counts.ignored++; return; }              /* an old question coming back */
        if (S.phase === 'end') return;
        S.q = { ...c };
        S.total = c.total;
        S.shownAt = clock();
        S.deadline = c.left >= 0 ? S.shownAt + c.left : 0;
        S.picks = null; S.sent = false; S.acked = c.got.includes(S.idx); S.rev = null;
        S.phase = 'question';
        clearInterval(ansT);
        emit();
        return;
      }
      case 'rev':
        if (!S.q || c.q !== S.q.q || S.phase === 'end') { C.counts.ignored++; return; }
        if (c.dist.length !== S.q.ch.length || c.ok.some(v => v >= S.q.ch.length)) { C.counts.ignored++; return; }
        clearInterval(ansT);
        if (S.phase !== 'reveal') { S.rev = c; S.board = c.bd; S.phase = 'reveal'; emit(); }
        return;
      case 'end':
        clearInterval(ansT);
        S.board = c.bd; S.phase = 'end'; emit();
        return;
      default: return;
    }
  }

  if (!isCode(rc)) { S.error = 'invalid'; S.phase = 'closed'; C.closed = true; }
  else if (!secureOk()) { S.error = 'insecure'; S.phase = 'closed'; C.closed = true; }
  else {
    C.start(() => {
      if (S.phase !== 'connecting') return;
      S.phase = 'joining';
      const knock = () => C.wire('join', who());
      knock();
      knockT = setInterval(knock, KNOCK_EVERY);
      later(() => { if (S.hostId === null) fail('nobody'); }, JOIN_WAIT);
      emit();
    });
  }

  const api = {
    get code() { return rc; },
    get kind() { return 'quiz'; },
    role: 'player',
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    stats: () => ({ ...C.counts }),
    state() {
      return {
        phase: S.phase, error: S.error, live: S.liveState, idx: S.idx, title: S.title, total: S.total, lobby: S.lobby,
        question: S.q ? { qid: S.q.q, i: S.q.i, text: S.q.txt, choices: S.q.ch, multi: S.q.mu, limit: S.q.lim, img: S.q.img, deadline: S.deadline, shownAt: S.shownAt, answered: S.sent, acked: S.acked, picks: S.picks, got: S.q.got.length } : null,
        rev: S.rev ? { ok: S.rev.ok, dist: S.rev.dist } : null,
        board: S.board,
      };
    },
    /* choose; the host hears only these choices and how long they took on this screen */
    answer(picks) {
      if (S.phase !== 'question' || S.sent || !S.q) return false;
      if (S.deadline && clock() > S.deadline + 300) return false;
      const k = [...new Set(picks)].filter(v => int(v, 0, S.q.ch.length - 1)).sort((a, b) => a - b);
      if (!k.length || (!S.q.mu && k.length > 1)) return false;
      S.picks = k; S.sent = true;
      const at = Math.max(0, Math.round(clock() - S.shownAt));
      const qid = S.q.q;
      let tries = 0;
      const send = () => { if (S.phase !== 'question' || S.q.q !== qid || S.acked || ++tries > 8) { clearInterval(ansT); return; } C.wire('ans', { q: qid, k, at }); };
      send();
      ansT = setInterval(send, 1500);
      emit();
      return true;
    },
    leave() { if (S.phase === 'closed') return; C.wire('bye'); stop(); S.phase = 'closed'; emit(); },
    _debug: { topic: () => C.topic, id: C.myId, hostId: () => S.hostId },
  };
  return api;
}

export default { openQuizHost, openQuizPlayer, MAX_PLAYERS, GRACE };
