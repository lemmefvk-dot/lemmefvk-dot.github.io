/* ============================================================
   arcade/spectate.js — let friends WATCH an Arcade game live.

   Opt-in, per game session: nothing is shared until the player
   presses "Let friends watch" in the Arcade. That makes a watch code
   (its own six characters — NOT the online room's code, so a watcher
   never touches the room two players are in). Friends type the code
   or open the link and see the game, read-only.

   WHAT IS SENT. A small snapshot of the game, sent when it changes
   and repeated every 2 s while someone watches:
     board  { k:'board', st, w, h, cells, hl, txt, over, x, pl, turn }
            board games (Chess, Connect Four, Reversi, Checkers,
            Tic-Tac-Toe, Dots and Boxes, Go, Gomoku): the board as characters, the
            line to highlight, the status text, the two players' names
     score  { k:'score', score, unit, st, txt }
            every other game: its score so far and whether it is over
   Never sent: the room code, your device id, saved data, clips, hidden
   information (Battleship shows score only, never a fleet).

   TRANSPORT. Topic pair/watch/<24 hex> on StaticOS's live connection
   (a free PUBLIC MQTT broker). The code is stretched (PBKDF2) into an
   AES-GCM key and the topic id exactly as Static Drop and the live quiz
   do (core/pair.js), so the broker carries sealed bytes, not the code,
   names or the game. Anyone who HAS the code can read the stream and
   knock. Delivery is best-effort; a locked-down network may block it.

   PROTOCOL — sealed JSON { v:1, t, f, … }, f = a random id for this
   session (never the device id).
     watcher → player  hi { n }   knock (name), every second until admitted
                       hb {}      still here, every 4 s
                       bye {}
     player → watchers snap { g, q, s, n, ids:[admitted ids], w:[names] }
                       full { to }   end {}
   Watchers send nothing the game can read: the player's game never
   sees a watcher's message (only this module does, and it only
   understands those three), so a watcher cannot move, resign or
   otherwise reach the game.

   LIMITS. At most MAX_WATCHERS are admitted (named in `ids`); a watcher
   not in `ids` is shown nothing and told the game is full. On a public
   topic that cap is enforced by the honest client — someone who bends
   the rules and reads the stream anyway sees only what the code gave
   them, and the player's own list still shows who checked in.

   SAFETY. Text over WIRE_MAX is dropped unread; more than IN_PER_SEC a
   second is dropped before it is unsealed; whatever fails to unseal or
   parse, has a type the receiver doesn't take, a bad `f` or v ≠ 1 is
   ignored; each watcher is held to WATCHER_PER_SEC; every snapshot goes
   through cleanSnap(), which returns a cleaned copy or nothing (types,
   lengths, character sets, ranges); names lose control and bidi
   characters and are capped; nothing is ever evaluated or set as markup.

     openBroadcast({ game }) -> B { code, phase, watchers(), update(snap), on(fn), stop(), stats() }
     openWatcher({ code })   -> W { code, phase, error, game, snap, host, watchers, on(fn), leave(), stats() }
   ============================================================ */
import * as live from '../portal/live.js';
import { me } from '../core/identity.js';
import { isCode, normalizeCode, randomCode, safeName, cleanText } from '../core/roomcode.js';
import { deriveRoom, seal, unseal, secureOk } from '../core/pair.js';

export const MAX_WATCHERS = 8;
export const WIRE_MAX = 6000;
const PLAIN_MAX = 4000;
const IN_PER_SEC = 200;
const WATCHER_PER_SEC = 10;
const KNOCK_EVERY = 1000;
export const JOIN_WAIT = 9000;
const HB_EVERY = 4000;
const REPEAT_EVERY = 2000;
export const WATCHER_GONE = 14000;       /* a watcher silent this long drops off the player's list */
export const QUIET_MS = 9000;            /* the player silent this long: the watcher says so */
const SEND_GAP = 220;
const ID_RE = /^[a-z0-9]{10}$/;
const GAME_RE = /^[a-z0-9-]{1,24}$/;
const CELLS_RE = /^[A-Za-z0-9.+|\- =_]*$/;
const BOARDS = new Set(['chess', 'c4', 'rev', 'chk', 'ttt', 'uttt', 'dnb', 'go', 'gomoku']);

const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const sessionId = () => [...rand(10)].map(b => (b % 36).toString(36)).join('');
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** A snapshot from the wire, cleaned — or null. The receiver never trusts a field it did not check. */
export function cleanSnap(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (s.k === 'score') {
    const score = s.score === null ? null : Number.isFinite(s.score) && Math.abs(s.score) < 1e9 ? s.score : undefined;
    if (score === undefined) return null;
    return { k: 'score', score, unit: cleanText(s.unit, 16), st: ['playing', 'over', 'paused'].includes(s.st) ? s.st : 'playing', txt: cleanText(s.txt, 120) };
  }
  if (s.k !== 'board' || !BOARDS.has(s.st) || !int(s.w, 1, 15) || !int(s.h, 1, 15) || typeof s.cells !== 'string') return null;
  const want = s.st === 'dnb' ? (2 * s.w + 1) ** 2 : s.w * s.h;
  if (s.cells.length !== want || !CELLS_RE.test(s.cells)) return null;
  const hl = Array.isArray(s.hl) ? s.hl.slice(0, 12).filter(v => int(v, 0, 200)) : [];
  let x = null;
  if (s.x && typeof s.x === 'object') {
    if (typeof s.x.sub === 'string' && s.x.sub.length === 9 && /^[XO=.]+$/.test(s.x.sub) && int(s.x.nx, -1, 8)) x = { sub: s.x.sub, nx: s.x.nx };
  }
  const pl = (Array.isArray(s.pl) ? s.pl : []).slice(0, 2).map(p => ({ n: safeName(p?.n) || 'Player', m: cleanText(p?.m, 30) }));
  return { k: 'board', st: s.st, w: s.w, h: s.h, cells: s.cells, hl, txt: cleanText(s.txt, 120), over: !!s.over, x, pl, turn: s.turn === 1 || s.turn === -1 ? s.turn : 0 };
}

/* shared plumbing: the sealed topic, the in-flood guard, the parse gate */
function channel(code, allowed, onMessage, onLive) {
  const myId = sessionId();
  const C = { myId, key: null, topic: null, closed: false, counts: { heard: 0, dropped: 0, ignored: 0, refused: 0 } };
  let unsub = null, offLive = null, inq = Promise.resolve(), outq = Promise.resolve(), inWin = { at: 0, n: 0 };
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
    if (now - inWin.at > 1000) inWin = { at: now, n: 0 };
    if (++inWin.n > IN_PER_SEC) { C.counts.dropped++; return; }
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
  C.start = cb => {
    deriveRoom('watch', code).then(k => {
      if (C.closed) return;
      C.key = k.key; C.topic = k.topic;
      unsub = live.subscribe(k.topic, onText);
      offLive = live.onStatus(st => { onLive(st); if (st === 'live') setTimeout(() => { if (!C.closed) cb(); }, 150); });
    }).catch(() => onLive('insecure'));
  };
  C.close = bye => {
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

/* ================= the player's side ================= */
export function openBroadcast({ game }) {
  const code = randomCode();
  const subs = new Set();
  const watchers = new Map();                    /* id -> { name, seen, win } */
  const B = { code, phase: 'connecting', game, error: null };
  let latest = null, lastText = '', lastSent = 0, seq = 0, timer = 0, repeatT = 0, sweepT = 0, replied = 0;
  const emit = (t, d) => subs.forEach(fn => { try { fn(t, d); } catch (e) { console.error('[spectate]', e); } });
  const myName = () => safeName(me().name) || 'Player';
  const list = () => [...watchers.values()].map(w => w.name);

  const C = channel(code, new Set(['hi', 'hb', 'bye']), onMessage, st => { emit('live', st); if (st === 'insecure') { B.error = 'secure'; B.phase = 'closed'; emit('phase', 'closed'); } });

  function send(force = false) {
    if (!latest || !watchers.size || B.phase !== 'open') return;
    const text = JSON.stringify(latest);
    const now = performance.now();
    if (!force && text === lastText && now - lastSent < REPEAT_EVERY - 50) return;
    if (!force && now - lastSent < SEND_GAP) { clearTimeout(timer); timer = setTimeout(() => send(), SEND_GAP - (now - lastSent) + 5); return; }
    lastText = text; lastSent = now;
    C.wire('snap', { g: B.game, q: ++seq, s: latest, n: myName(), ids: [...watchers.keys()], w: list() });
  }
  function changed() { emit('watchers', { count: watchers.size, names: list() }); send(true); }

  function onMessage(m) {
    const now = performance.now();
    if (m.t === 'hi') {
      let w = watchers.get(m.f);
      if (!w) {
        if (watchers.size >= MAX_WATCHERS) {
          C.counts.refused++;
          if (now - replied > 500) { replied = now; C.wire('full', { to: m.f }); }
          return;
        }
        w = { name: safeName(m.n) || 'Friend', seen: now, win: { at: 0, n: 0 } };
        watchers.set(m.f, w);
        C.counts.heard++;
        changed();
        return;
      }
    }
    const w = watchers.get(m.f);
    if (!w) { C.counts.refused++; return; }       /* only someone who knocked is listened to */
    if (now - w.win.at > 1000) w.win = { at: now, n: 0 };
    if (++w.win.n > WATCHER_PER_SEC) { C.counts.dropped++; return; }
    w.seen = now;
    C.counts.heard++;
    if (m.t === 'bye') { watchers.delete(m.f); changed(); }
    else if (m.t === 'hi' && now - lastSent > 400) send(true);     /* our snapshot was lost: say it again */
  }

  C.start(() => {
    if (B.phase !== 'connecting') return;
    B.phase = 'open';
    emit('phase', 'open');
    repeatT = setInterval(() => send(), REPEAT_EVERY);
    sweepT = setInterval(() => {
      const now = performance.now();
      let gone = false;
      for (const [id, w] of watchers) if (now - w.seen > WATCHER_GONE) { watchers.delete(id); gone = true; }
      if (gone) changed();
    }, 2000);
  });

  return Object.assign(B, {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    watchers: () => [...watchers.values()].map(w => ({ name: w.name })),
    /* the game's latest snapshot (already cleaned by the sender's own game code; re-checked here) */
    update(snap) {
      const c = cleanSnap(snap);
      if (!c) return false;
      latest = c;
      send();
      return true;
    },
    stop() {
      if (B.phase === 'closed' && C.closed) return;
      clearInterval(repeatT); clearInterval(sweepT); clearTimeout(timer);
      if (B.phase === 'open') { C.wire('end'); C.wire('end'); }
      B.phase = 'closed';
      watchers.clear();
      setTimeout(() => C.close(false), 400);
      emit('phase', 'closed');
    },
    stats: () => ({ ...C.counts, watchers: watchers.size }),
    _debug: { topic: () => C.topic, id: C.myId },
  });
}

/* ================= the watcher's side ================= */
export function openWatcher({ code, name = '' }) {
  const R = { code: normalizeCode(code), phase: 'connecting', error: null, game: null, snap: null, host: null, watchers: { count: 0, names: [] }, seq: 0 };
  const subs = new Set();
  let knockT = 0, hbT = 0, quietT = 0, joinT = 0, hostId = null, lastHeard = 0, sawGame = false;
  const emit = (t, d) => subs.forEach(fn => { try { fn(t, d); } catch (e) { console.error('[spectate]', e); } });
  const setPhase = p => { if (R.phase === p) return; R.phase = p; emit('phase', p); };
  const myName = () => safeName(name) || safeName(me().name) || 'Friend';

  if (!isCode(R.code)) { R.error = 'invalid'; R.phase = 'closed'; return Object.assign(R, stub()); }
  if (!secureOk()) { R.error = 'secure'; R.phase = 'closed'; return Object.assign(R, stub()); }

  function stub() {
    return { on(fn) { subs.add(fn); return () => subs.delete(fn); }, leave() {}, stats: () => ({ heard: 0, dropped: 0, ignored: 0, refused: 0 }) };
  }

  const C = channel(R.code, new Set(['snap', 'full', 'end']), onMessage, st => emit('live', st));
  const fail = reason => { R.error = reason; stop(); };
  function stop() {
    clearInterval(knockT); clearInterval(hbT); clearTimeout(quietT); clearTimeout(joinT);
    C.close(R.phase === 'watching');
    setPhase('closed');
  }

  function onMessage(m) {
    if (hostId && m.f !== hostId) { C.counts.refused++; return; }
    if (m.t === 'full') { if (m.to === C.myId && !hostId) fail('full'); return; }
    if (m.t === 'end') { if (hostId) { R.error = 'ended'; setPhase('ended'); clearInterval(hbT); clearTimeout(quietT); } return; }
    /* snap */
    if (!GAME_RE.test(String(m.g || '')) || !int(m.q, 0, 1e9)) { C.counts.ignored++; return; }
    const ids = Array.isArray(m.ids) ? m.ids.filter(i => typeof i === 'string' && ID_RE.test(i)).slice(0, MAX_WATCHERS) : [];
    if (!ids.includes(C.myId)) { sawGame = true; return; }       /* not admitted: shown nothing */
    const snap = cleanSnap(m.s);
    if (!snap) { C.counts.ignored++; return; }
    if (hostId && m.q < R.seq && R.seq - m.q < 1e6) return;     /* an older one arriving late */
    if (!hostId) {
      hostId = m.f;
      clearInterval(knockT); clearTimeout(joinT);
      hbT = setInterval(() => C.wire('hb'), HB_EVERY);
    }
    R.seq = m.q;
    R.game = m.g; R.snap = snap;
    R.host = { name: safeName(m.n) || 'Player' };
    const names = (Array.isArray(m.w) ? m.w : []).slice(0, MAX_WATCHERS).map(n => safeName(n) || 'Friend');
    R.watchers = { count: ids.length, names };
    lastHeard = performance.now();
    if (R.phase === 'ended') R.error = null;
    setPhase('watching');
    emit('snap', snap);
    watchQuiet();
  }
  function watchQuiet() {
    clearTimeout(quietT);
    quietT = setTimeout(() => {
      if (R.phase === 'watching' && performance.now() - lastHeard >= QUIET_MS - 50) { R.error = 'quiet'; setPhase('ended'); }
      else if (R.phase === 'watching') watchQuiet();
    }, QUIET_MS - (performance.now() - lastHeard) + 30);
  }

  C.start(() => {
    if (R.phase !== 'connecting') return;
    setPhase('joining');
    const knock = () => C.wire('hi', { n: myName() });
    knock();
    knockT = setInterval(knock, KNOCK_EVERY);
    joinT = setTimeout(() => { if (!hostId) fail(sawGame ? 'full' : 'nobody'); }, JOIN_WAIT);
  });

  return Object.assign(R, {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    leave: stop,
    stats: () => ({ ...C.counts }),
  });
}

export default { openBroadcast, openWatcher, cleanSnap, MAX_WATCHERS };
