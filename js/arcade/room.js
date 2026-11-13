/* ============================================================
   arcade/room.js — a two-player room for Static Arcade's online
   games, over StaticOS's one live connection (portal/live.js).

   One room = one host + one guest + one game. The host makes a
   six-character code; the guest types it (or opens an invite link)
   and the host lets them in. Then the host starts a round with a
   fresh random seed, both Arcades count down and mount the game,
   and the game talks to its twin through send() / 'game' events.

   TRANSPORT. Topic 'arcade/<CODE>' on the live channel, i.e.
   staticos/v1/arcade/<CODE> on a free PUBLIC MQTT broker. Anyone
   who knows or guesses a code can read and write it, delivery is
   best-effort (QoS 0: a message can be lost), and a locked-down
   network may block it. The Arcade says so where you make a room.

   PROTOCOL — JSON, every message { v:1, t, f } where f is this
   room session's random id (made per room, never the device id):
     hi    { n, c }            guest knocks (name, colour); repeated
                               each second until answered
     wel   { to, n, c, g }     host lets that guest in; g = game id
     full  { to }              host already has a guest
     st    { s, r }            host starts round r with seed s
     g     { r, d }            the game's own data (an object) for
                               round r — data for any other round is
                               dropped, so a late message from the last
                               round never reaches the next one
     png   { a } / pon { a }   round-trip time + "still here"
     again {}                  wants a rematch
     bye   {}                  leaving
   A peer silent for QUIET_MS has left.

   SAFETY — anything can arrive on a public topic, so:
     · replies made because someone else spoke (pon, full, a repeated
       wel) are rate-limited, so a flood is never echoed back;
     · text over WIRE_MAX is dropped unread; JSON is parsed in a try;
       unknown `t`, a bad `f`, or v ≠ 1 are ignored;
     · once paired, only the partner's `f` is listened to; a guest
       only accepts the host's welcome addressed to it, and a host
       accepts one guest (later knocks get 'full');
     · names lose control/bidi characters and are capped; a colour
       is a hue 0–359; the game id must be an online-capable game in
       THIS device's Arcade, or the join is refused;
     · incoming text is capped at IN_PER_SEC before it is even parsed,
       then the partner's messages at PEER_PER_SEC (a stranger's are
       refused without using up the partner's share, so a flood from
       outside doesn't drown the game); game data is capped at
       GAME_MAX characters and the game's own sends at OUT_PER_SEC.
       Each game still validates its own data.

     openRoom({ role:'host', game })  ·  openRoom({ role:'guest', code })
       -> room { code, role, game, peer, phase, error,
                 on(fn) -> off      fn(type, data): 'phase' | 'peer' |
                                    'left' | 'start' | 'game' | 'again' | 'live'
                 start()            host: a new round with a new seed
                 send(obj) -> bool  game data to the partner
                 rematch()          ask for another round
                 leave()            say bye and close
                 rtt() -> ms | null live() -> live status
                 stats() -> { heard, dropped, ignored, refused } }
   ============================================================ */
import * as live from '../portal/live.js';
import { me } from '../core/identity.js';
import { ALPHABET, CODE_LEN, isCode, normalizeCode, randomCode, safeName, hueOf } from '../core/roomcode.js';
import { arcadeById } from './index.js';

/* the code helpers live in core/roomcode.js, shared with Drop, Watch Together and Draw Together */
export { ALPHABET, CODE_LEN, isCode, normalizeCode, randomCode, safeName };
export const topicOf = code => `arcade/${code}`;

const WIRE_MAX = 4096;
export const GAME_MAX = 2048;
const IN_PER_SEC = 400;            /* everything on the topic, before it is parsed */
const PEER_PER_SEC = 90;           /* the partner's own messages */
const OUT_PER_SEC = 40;
const KNOCK_EVERY = 1000;
export const JOIN_WAIT = 8000;
const PING_EVERY = 2000;
export const QUIET_MS = 9000;
const TYPES = new Set(['hi', 'wel', 'full', 'st', 'g', 'png', 'pon', 'again', 'bye']);
const ID_RE = /^[a-z0-9]{10}$/;

const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const sessionId = () => [...rand(10)].map(b => (b % 36).toString(36)).join('');
const seed32 = () => new Uint32Array(rand(4).buffer)[0] >>> 0;
const hue = hueOf;
/** Is this an Arcade game with an online mode on THIS device? */
export const onlineGame = id => { const g = typeof id === 'string' ? arcadeById(id) : null; return g && g.online ? g : null; };

export function openRoom({ role, game = null, code = null }) {
  const host = role === 'host';
  const R = {
    code: host ? randomCode() : normalizeCode(code),
    role: host ? 'host' : 'guest',
    game: host ? game : null,
    peer: null,                 /* { id, name, color } */
    phase: 'connecting',        /* connecting | waiting | joining | ready | closed */
    error: null,                /* 'invalid' | 'nobody' | 'full' | 'game' | null */
    round: 0, seed: 0,
    wantAgain: false, peerAgain: false,
  };
  const myId = sessionId();
  const subs = new Set();
  const timers = new Set();
  let unsub = null, offLive = null, knockT = 0, joinT = 0, pingT = 0, quietT = 0, againT = 0;
  let rtt = null, lastHeard = 0, inWin = { at: 0, n: 0 }, peerWin = { at: 0, n: 0 }, outWin = { at: 0, n: 0 };
  const counts = { heard: 0, dropped: 0, ignored: 0, refused: 0 };   /* for the Arcade's play-tests */
  /* replies we make because someone else spoke ('pon', 'full', a repeated 'wel') are
     rate-limited, so nobody can turn this room into an echo of their own flood */
  const replied = {};
  const mayReply = (kind, gap) => { const t = performance.now(); if (t - (replied[kind] || -1e9) < gap) return false; replied[kind] = t; return true; };

  const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error('[arcade room]', err); } });
  const setPhase = p => { if (R.phase === p) return; R.phase = p; emit('phase', p); };
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const wire = (t, body = {}) => {
    if (R.phase === 'closed' && t !== 'bye') return false;
    const text = JSON.stringify({ v: 1, t, f: myId, ...body });
    if (text.length > WIRE_MAX) return false;
    return live.publish(topicOf(R.code), text);
  };
  const who = () => { const m = me(); return { n: safeName(m.name) || 'Player', c: hue(m.color) }; };

  function fail(reason) {
    R.error = reason;
    close(false);
  }

  function close(sayBye) {
    if (R.phase === 'closed') return;
    if (sayBye && R.peer) wire('bye');
    clearInterval(knockT); clearInterval(pingT); clearInterval(againT); clearTimeout(joinT); clearTimeout(quietT);
    timers.forEach(clearTimeout); timers.clear();
    try { unsub?.(); } catch (err) { /* already gone */ }
    try { offLive?.(); } catch (err) { /* already gone */ }
    unsub = offLive = null;
    setPhase('closed');
  }

  function paired(peer) {
    R.peer = peer;
    lastHeard = performance.now();
    clearInterval(knockT); clearTimeout(joinT);
    setPhase('ready');
    emit('peer', peer);
    clearInterval(pingT);
    pingT = setInterval(() => wire('png', { a: Math.round(performance.now()) }), PING_EVERY);
    wire('png', { a: Math.round(performance.now()) });
    watchQuiet();
  }
  function watchQuiet() {
    clearTimeout(quietT);
    quietT = setTimeout(() => {
      if (R.phase === 'closed' || !R.peer) return;
      if (performance.now() - lastHeard >= QUIET_MS - 50) { emit('left', { reason: 'quiet', peer: R.peer }); close(false); }
      else watchQuiet();
    }, QUIET_MS - (performance.now() - lastHeard) + 30);
  }

  function onText(text) {
    if (R.phase === 'closed') return;
    if (typeof text !== 'string' || text.length > WIRE_MAX) { counts.ignored++; return; }
    /* a flood is dropped before it is even parsed */
    const now = performance.now();
    if (now - inWin.at > 1000) inWin = { at: now, n: 0 };
    if (++inWin.n > IN_PER_SEC) { counts.dropped++; return; }
    let m;
    try { m = JSON.parse(text); } catch (err) { counts.ignored++; return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || m.v !== 1 || !TYPES.has(m.t)) { counts.ignored++; return; }
    if (typeof m.f !== 'string' || !ID_RE.test(m.f)) { counts.ignored++; return; }
    if (m.f === myId) return;
    if (R.peer) {
      if (m.f !== R.peer.id) {
        counts.refused++;
        /* a third person knocking on a full room is told so (at most twice a second) */
        if (host && m.t === 'hi' && mayReply('full', 500)) wire('full', { to: m.f });
        return;
      }
      if (now - peerWin.at > 1000) peerWin = { at: now, n: 0 };
      if (++peerWin.n > PEER_PER_SEC) { counts.dropped++; return; }
      lastHeard = now;
      counts.heard++;
      return fromPeer(m);
    }
    if (host && m.t === 'hi') {
      paired({ id: m.f, name: safeName(m.n) || 'Player', color: hue(m.c) });
      wire('wel', { to: m.f, ...who(), g: R.game });
      return;
    }
    if (!host && m.to === myId) {
      if (m.t === 'full') { fail('full'); return; }
      if (m.t === 'wel') {
        const g = onlineGame(m.g);
        if (!g) { fail('game'); return; }
        R.game = g.id;
        paired({ id: m.f, name: safeName(m.n) || 'Player', color: hue(m.c) });
      }
    }
  }

  function fromPeer(m) {
    switch (m.t) {
      case 'hi':                                   /* our welcome was lost: say it again */
        if (host && mayReply('wel', 400)) wire('wel', { to: m.f, ...who(), g: R.game });
        break;
      case 'png':
        if (Number.isFinite(m.a) && mayReply('pon', 250)) wire('pon', { a: m.a });
        break;
      case 'pon': {
        const d = performance.now() - m.a;
        if (Number.isFinite(d) && d >= 0 && d < 20000) rtt = rtt === null ? d : rtt * 0.7 + d * 0.3;
        break;
      }
      case 'st':
        if (host) break;                           /* only the host starts rounds */
        if (!Number.isInteger(m.s) || m.s < 0 || m.s > 0xffffffff || !Number.isInteger(m.r) || m.r <= R.round || m.r > R.round + 1000) break;
        R.round = m.r; R.seed = m.s >>> 0;
        R.wantAgain = R.peerAgain = false;
        clearInterval(againT);
        emit('start', { seed: R.seed, round: R.round });
        break;
      case 'g':
        if (m.r !== R.round || !m.d || typeof m.d !== 'object' || Array.isArray(m.d)) break;
        emit('game', m.d);
        break;
      case 'again':
        if (R.peerAgain) break;
        R.peerAgain = true;
        emit('again', { peer: true });
        if (host && R.wantAgain) start();
        break;
      case 'bye':
        emit('left', { reason: 'bye', peer: R.peer });
        close(false);
        break;
      default: break;
    }
  }

  function start() {
    if (!host || !R.peer || R.phase === 'closed') return false;
    R.round += 1;
    R.seed = seed32();
    R.wantAgain = R.peerAgain = false;
    clearInterval(againT);
    const st = { s: R.seed, r: R.round };
    wire('st', st);
    /* QoS 0 can lose it: say it twice more (the guest ignores a round it has) */
    later(() => { if (R.round === st.r) wire('st', st); }, 350);
    later(() => { if (R.round === st.r) wire('st', st); }, 1200);
    emit('start', { seed: R.seed, round: R.round });
    return true;
  }

  /* ---------- begin ---------- */
  if (!host && !isCode(R.code)) {
    R.error = 'invalid';
    R.phase = 'closed';
  } else {
    unsub = live.subscribe(topicOf(R.code), onText);
    const begin = () => {
      if (R.phase !== 'connecting') return;
      if (host) { setPhase('waiting'); return; }
      setPhase('joining');
      const knock = () => wire('hi', who());
      knock();
      knockT = setInterval(knock, KNOCK_EVERY);
      joinT = later(() => { if (!R.peer) fail('nobody'); }, JOIN_WAIT);
    };
    offLive = live.onStatus(st => {
      emit('live', st);
      /* the subscription goes out with the connection: give it a beat to land */
      if (st === 'live') later(begin, 150);
    });
  }

  return {
    get code() { return R.code; },
    get role() { return R.role; },
    get game() { return R.game; },
    get peer() { return R.peer; },
    get phase() { return R.phase; },
    get error() { return R.error; },
    get round() { return R.round; },
    get seed() { return R.seed; },
    get wantAgain() { return R.wantAgain; },
    get peerAgain() { return R.peerAgain; },
    me: myId,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    start,
    send(d) {
      if (!R.peer || R.phase === 'closed' || !d || typeof d !== 'object') return false;
      const now = performance.now();
      if (now - outWin.at > 1000) outWin = { at: now, n: 0 };
      if (++outWin.n > OUT_PER_SEC) return false;
      let text;
      try { text = JSON.stringify(d); } catch (err) { return false; }
      if (text.length > GAME_MAX) return false;
      return wire('g', { r: R.round, d });
    },
    rematch() {
      if (!R.peer || R.phase === 'closed' || R.wantAgain) return;
      R.wantAgain = true;
      wire('again');
      /* repeated until a round starts, in case one is lost */
      clearInterval(againT);
      againT = setInterval(() => { if (R.wantAgain && R.phase !== 'closed') wire('again'); else clearInterval(againT); }, 2000);
      emit('again', { peer: false });
      if (host && R.peerAgain) start();
    },
    leave() { close(true); },
    rtt: () => (rtt === null ? null : Math.round(rtt)),
    live: () => live.status(),
    stats: () => ({ ...counts }),
  };
}

export default { openRoom, normalizeCode, isCode, onlineGame, topicOf, ALPHABET, CODE_LEN };
