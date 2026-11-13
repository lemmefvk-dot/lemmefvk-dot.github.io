/* ============================================================
   pair.js — a private room for two people, the transport behind
   Static Drop, Watch Together and Draw Together.

   One person opens a room and gets a six-character code (and an
   invite link the app makes from it); the other types the code.
   Nobody can find a room any other way: there is no list, no
   lobby, no search.

   TRANSPORT. Rooms ride StaticOS's one live connection
   (portal/live.js) — a free PUBLIC MQTT broker. Two things keep a
   room to the two people in it:
     · the topic is not the code. Both sides stretch the code with
       PBKDF2 (salted with the feature's name) into an AES-GCM key
       and a topic id, so someone watching the broker sees
       "<kind>/<24 hex>" and sealed bytes, not the code, names or
       chat. A six-symbol code is short (about a billion
       possibilities), so this keeps casual watchers out, not a
       determined attacker with the topic and time — the apps say
       to treat a code like a password and never call it unbreakable.
     · anyone who HAS the code can knock. The host takes the first
       guest and tells any later knock "full"; once paired, only the
       partner's messages are listened to.
   What the broker still sees: that a room exists, when it is busy
   and how much is sent. Delivery is best-effort (QoS 0), and a
   locked-down network may block the broker; status says so.

   DIRECT LINK (rtc: true). After pairing, the two set up a WebRTC
   data channel, using the room only to swap the offer, answer and
   network candidates. Public STUN servers are asked for each side's
   public address; there is NO relay (TURN) server, so when both
   networks refuse a direct path the link fails, and the app says
   so plainly rather than sending bytes through the public broker.
   Setting up the link shares each side's network address (IP) with
   the other person. Tests point the STUN list at nothing by setting
   globalThis.__STATICOS_ICE = [] before the page loads.

   PROTOCOL — sealed JSON { v:1, t, f, … } on the topic (f = this
   room session's random id, never the device id); the same JSON,
   unsealed, on the data channel (DTLS already encrypts it):
     hi  { n, c }          guest knocks (name, hue), once a second
     wel { to, n, c }      host lets that guest in
     full { to }           host already has a guest
     png { a } / pon { a, b }  round trip and clock offset ("still here")
     sig { to, sdp | ice | no } WebRTC signalling, partner only
                           (no: this side can't make a direct link)
     bye {}                leaving
   plus the app's own types, each with a validator.

   SAFETY — anything can arrive on a public topic, so:
     · text over WIRE_MAX is dropped unread; floods past IN_PER_SEC a
       second are dropped before they are even unsealed; what fails to
       unseal, parse, or carries an unknown `t`, a bad `f` or v ≠ 1 is
       ignored;
     · the partner's own messages are capped at PEER_PER_SEC, a
       stranger's are refused (and replies we make because someone
       spoke — pon, full, a repeated wel — are rate-limited, so a
       flood is never echoed);
     · every app message passes the app's validator, which returns a
       cleaned copy or null; nothing is ever evaluated or rendered as
       markup; names lose control/bidi characters and are capped;
     · on the data channel, text over DC_TEXT_MAX and binary over
       DC_BIN_MAX are ignored, and both are rate-capped; binary is only
       delivered to apps that asked for it.

     openPair({ kind, role:'host'|'guest', code?, types, rtc?, binary? })
       -> room { code, role, kind, phase, error, peer, link, topic,
                 on(fn) -> off   fn(type, data):
                   'phase' p · 'peer' {id,name,color} · 'left' {reason}
                   'msg' {t, m, via:'mqtt'|'rtc'} · 'bin' ArrayBuffer
                   'link' state · 'live' status
                 send(t, body, { via:'auto'|'mqtt'|'rtc' }) -> bool
                 sendBinary(arrayBuffer) -> bool
                 drained() -> Promise   (data channel buffer low again)
                 offset() -> ms (partner's clock − ours) | null
                 now() -> this device's clock (ms) · rtt() -> ms | null
                 leave()  ·  stats() -> { heard, dropped, ignored, refused } }
       phase: connecting | waiting | joining | paired | closed
       error: invalid | nobody | full | insecure | null
       link:  off | connecting | direct | failed | lost
   ============================================================ */
import * as live from '../portal/live.js';
import { me } from './identity.js';
import { isCode, normalizeCode, randomCode, safeName, hueOf } from './roomcode.js';

const WIRE_MAX = 24000;            /* characters on the topic: a sealed, base64 message */
const PLAIN_MAX = 16000;           /* one message's JSON before sealing */
const IN_PER_SEC = 300;            /* everything on the topic, before it is unsealed */
const PEER_PER_SEC = 120;          /* the partner's own messages over the broker */
const OUT_PER_SEC = 60;
export const DC_TEXT_MAX = 64 * 1024;
export const DC_BIN_MAX = 64 * 1024;
const DC_TEXT_PER_SEC = 2000;
export const DC_BYTES_PER_SEC = 128 * 1024 * 1024;   /* senders pace themselves well under this */
const KNOCK_EVERY = 1000;
export const JOIN_WAIT = 10000;
const PING_EVERY = 2000;
export const QUIET_MS = 12000;
export const RTC_WAIT = 20000;
const SDP_MAX = 12000;
const CAND_MAX = 600;
const CANDS_MAX = 40;
const ROUNDS = 120000;
const BASE = new Set(['hi', 'wel', 'full', 'png', 'pon', 'bye', 'sig']);
const DC_BASE = new Set(['png', 'pon', 'bye']);
const ID_RE = /^[a-z0-9]{10}$/;
const LOW_WATER = 256 * 1024;

/* public STUN only: it tells each side its own public address, and relays nothing */
export const PUBLIC_STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
export const iceServers = () => (Array.isArray(globalThis.__STATICOS_ICE) ? globalThis.__STATICOS_ICE : PUBLIC_STUN);
export const rtcAvailable = () => typeof RTCPeerConnection === 'function';
export const secureOk = () => !!(globalThis.crypto && crypto.subtle);
export const clock = () => performance.timeOrigin + performance.now();

const enc = new TextEncoder();
const dec = new TextDecoder();
const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const sessionId = () => [...rand(10)].map(b => (b % 36).toString(36)).join('');
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(text) {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}

/* the code -> { key, topic }. Kept per kind+code so a second room with the same code is instant. */
const derived = new Map();
export function deriveRoom(kind, code) {
  const id = `${kind}|${code}`;
  if (derived.has(id)) return derived.get(id);
  const p = (async () => {
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`staticos/pair/v1/${kind}`), iterations: ROUNDS }, base, 512));
    const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { key, topic: `pair/${kind}/${hex(bits.slice(32, 44))}` };
  })();
  derived.set(id, p);
  if (derived.size > 24) derived.delete(derived.keys().next().value);
  return p;
}
export async function seal(key, text) {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  const all = new Uint8Array(12 + ct.length);
  all.set(iv); all.set(ct, 12);
  return b64(all);
}
export async function unseal(key, text) {
  const b = unb64(text);
  if (!b || b.length < 12 + 16 + 2) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12))); }
  catch (e) { return null; }
}

export function openPair({ kind, role, code = null, types = {}, rtc = false, binary = false }) {
  const host = role === 'host';
  const R = {
    code: host ? randomCode() : normalizeCode(code),
    phase: 'connecting', error: null, peer: null,
    link: rtc ? 'connecting' : 'off', topic: null,
  };
  const myId = sessionId();
  const subs = new Set();
  const timers = new Set();
  const counts = { heard: 0, dropped: 0, ignored: 0, refused: 0 };
  let key = null, unsub = null, offLive = null;
  let inq = Promise.resolve(), outq = Promise.resolve(), sigq = Promise.resolve();
  let knockT = 0, joinT = 0, pingT = 0, quietT = 0, rtcT = 0;
  let lastHeard = 0;
  let inWin = { at: 0, n: 0 }, peerWin = { at: 0, n: 0 }, outWin = { at: 0, n: 0 }, dcWin = { at: 0, n: 0 }, binWin = { at: 0, n: 0 };
  let rtt = null;
  const samples = [];                  /* { rtt, off } — the clock offset comes from the quickest round trip */
  let pc = null, dc = null, cands = 0;
  const pendingIce = [];
  const replied = {};
  const mayReply = (kind2, gap) => { const t = performance.now(); if (t - (replied[kind2] || -1e9) < gap) return false; replied[kind2] = t; return true; };

  const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error(`[pair ${kind}]`, err); } });
  const setPhase = p => { if (R.phase === p) return; R.phase = p; emit('phase', p); };
  const setLink = s => { if (R.link === s) return; R.link = s; emit('link', s); };
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const who = () => { const m = me(); return { n: safeName(m.name) || 'Friend', c: hueOf(m.color) }; };
  const win = (w, max) => { const now = performance.now(); if (now - w.at > 1000) { w.at = now; w.n = 0; } return ++w.n <= max; };

  /* ---------- the public topic ---------- */
  function wire(t, body = {}) {
    if (!key || (R.phase === 'closed' && t !== 'bye')) return false;
    const text = JSON.stringify({ v: 1, t, f: myId, ...body });
    if (text.length > PLAIN_MAX) return false;
    const topic = R.topic;
    outq = outq.then(async () => { try { live.publish(topic, await seal(key, text)); } catch (err) { /* gone */ } });
    return live.status() === 'live';
  }

  function onText(text) {
    if (R.phase === 'closed') return;
    if (typeof text !== 'string' || text.length > WIRE_MAX) { counts.ignored++; return; }
    if (!win(inWin, IN_PER_SEC)) { counts.dropped++; return; }     /* a flood is dropped before it is unsealed */
    inq = inq.then(async () => {
      const plain = await unseal(key, text);
      if (plain === null) { counts.ignored++; return; }
      onPlain(plain);
    });
  }

  function parse(plain, needF) {
    if (typeof plain !== 'string' || plain.length > DC_TEXT_MAX) return null;
    let m;
    try { m = JSON.parse(plain); } catch (err) { return null; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || m.v !== 1 || typeof m.t !== 'string') return null;
    if (!(needF ? BASE : DC_BASE).has(m.t) && !Object.hasOwn(types, m.t)) return null;
    if (needF && (typeof m.f !== 'string' || !ID_RE.test(m.f))) return null;
    return m;
  }

  function onPlain(plain) {
    if (R.phase === 'closed') return;
    const m = parse(plain, true);
    if (!m) { counts.ignored++; return; }
    if (m.f === myId) return;                                   /* our own message, back from the broker */
    if (R.peer) {
      if (m.f !== R.peer.id) {
        counts.refused++;
        if (host && m.t === 'hi' && mayReply('full', 500)) wire('full', { to: m.f });
        return;
      }
      if (!win(peerWin, PEER_PER_SEC)) { counts.dropped++; return; }
      lastHeard = performance.now();
      counts.heard++;
      fromPeer(m, 'mqtt');
      return;
    }
    if (host && m.t === 'hi') {
      paired({ id: m.f, name: safeName(m.n) || 'Friend', color: hueOf(m.c) });
      wire('wel', { to: m.f, ...who() });
      return;
    }
    if (!host && m.to === myId && (m.t === 'wel' || m.t === 'full')) {
      if (m.t === 'full') { fail('full'); return; }
      paired({ id: m.f, name: safeName(m.n) || 'Friend', color: hueOf(m.c) });
      return;
    }
    counts.refused++;
  }

  function fromPeer(m, via) {
    switch (m.t) {
      case 'hi':                                                /* our welcome was lost: say it again */
        if (host && via === 'mqtt' && mayReply('wel', 400)) wire('wel', { to: m.f, ...who() });
        return;
      case 'wel': case 'full': return;
      case 'png':
        if (Number.isFinite(m.a) && mayReply('pon', 300)) sendAny('pon', { a: m.a, b: clock() });
        return;
      case 'pon': {
        const t3 = clock();
        const d = t3 - m.a;
        if (!Number.isFinite(d) || d < 0 || d > 20000 || !Number.isFinite(m.b)) return;
        const off = m.b - (m.a + t3) / 2;
        if (Math.abs(off) > 86400000) return;
        rtt = rtt === null ? d : rtt * 0.7 + d * 0.3;
        samples.push({ rtt: d, off });
        if (samples.length > 10) samples.shift();
        return;
      }
      case 'sig':
        if (via !== 'mqtt' || m.to !== myId) return;
        sigq = sigq.then(() => onSig(m)).catch(() => {});
        return;
      case 'bye':
        emit('left', { reason: 'bye', peer: R.peer });
        close(false);
        return;
      default: {
        let clean = null;
        try { clean = types[m.t](m, via); } catch (err) { clean = null; }
        if (!clean) { counts.ignored++; return; }
        emit('msg', { t: m.t, m: clean, via });
      }
    }
  }

  /* ---------- pairing ---------- */
  function paired(peer) {
    R.peer = peer;
    lastHeard = performance.now();
    clearInterval(knockT); clearTimeout(joinT);
    setPhase('paired');
    emit('peer', peer);
    const ping = () => sendAny('png', { a: clock() });
    clearInterval(pingT);
    pingT = setInterval(ping, PING_EVERY);
    ping();
    watchQuiet();
    if (rtc) startRtc();
  }
  function watchQuiet() {
    clearTimeout(quietT);
    quietT = setTimeout(() => {
      if (R.phase === 'closed' || !R.peer) return;
      if (performance.now() - lastHeard >= QUIET_MS - 50) { emit('left', { reason: 'quiet', peer: R.peer }); close(false); }
      else watchQuiet();
    }, QUIET_MS - (performance.now() - lastHeard) + 30);
  }
  function fail(reason) { R.error = reason; close(false); }

  /* ---------- the direct link ---------- */
  function startRtc() {
    /* a browser without WebRTC says so at once, so the other side doesn't wait RTC_WAIT for nothing */
    if (!rtcAvailable()) { tellNo(); setLink('failed'); return; }
    setLink('connecting');
    clearTimeout(rtcT);
    rtcT = later(() => { if (R.link === 'connecting') rtcFail(); }, RTC_WAIT);
    if (host) makePc(true);
  }
  /* this side couldn't (or can no longer) make the link: say so, so the other side stops waiting too */
  let toldNo = false;
  function tellNo() {
    if (toldNo || !R.peer || R.phase === 'closed') return;
    toldNo = true;
    wire('sig', { to: R.peer.id, no: true });
  }
  function rtcFail(tell = true) {
    if (R.link === 'connecting' && tell) tellNo();
    if (R.link === 'direct') setLink('lost'); else if (R.link !== 'lost') setLink('failed');
    try { pc?.close(); } catch (err) { /* already closed */ }
  }
  function makePc(offerer) {
    try { pc = new RTCPeerConnection({ iceServers: iceServers() }); }
    catch (err) { tellNo(); setLink('failed'); return; }
    const mine = pc;
    pc.onicecandidate = e => {
      if (!e.candidate || pc !== mine || !R.peer) return;
      const c = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate;
      if (!c.candidate) return;
      wire('sig', { to: R.peer.id, ice: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== mine) return;
      if (pc.connectionState === 'failed') rtcFail();
    };
    if (offerer) {
      setupDc(pc.createDataChannel('staticos', { ordered: true }));
      pc.createOffer()
        .then(o => pc.setLocalDescription(o))
        .then(() => { if (R.peer && pc === mine) wire('sig', { to: R.peer.id, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); })
        .catch(() => rtcFail());
    } else {
      pc.ondatachannel = e => { if (!dc && e.channel.label === 'staticos') setupDc(e.channel); };
    }
  }
  async function onSig(m) {
    if (!rtc || R.phase === 'closed' || (R.link !== 'connecting')) return;
    if (m.no === true) { clearTimeout(rtcT); rtcFail(false); return; }
    if (m.sdp !== undefined) {
      const d = m.sdp;
      if (!d || typeof d !== 'object' || typeof d.sdp !== 'string' || d.sdp.length > SDP_MAX || (d.type !== 'offer' && d.type !== 'answer')) { counts.ignored++; return; }
      if (d.type === 'offer') {
        if (host || pc) return;                                 /* only the host offers, once */
        makePc(false);
        if (!pc) return;
        await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
        await flushIce();
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        if (R.peer) wire('sig', { to: R.peer.id, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } else {
        if (!host || !pc || pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
        await flushIce();
      }
      return;
    }
    const c = m.ice;
    if (!c || typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > CAND_MAX
      || (c.sdpMid !== null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 32))
      || (c.sdpMLineIndex !== null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 16))) { counts.ignored++; return; }
    if (++cands > CANDS_MAX) return;
    const cand = { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
    if (!pc || !pc.remoteDescription) pendingIce.push(cand);
    else await pc.addIceCandidate(cand).catch(() => {});
  }
  async function flushIce() {
    while (pendingIce.length && pc) await pc.addIceCandidate(pendingIce.shift()).catch(() => {});
  }
  function setupDc(ch) {
    dc = ch;
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = LOW_WATER;
    ch.onopen = () => { if (dc !== ch || R.phase === 'closed') return; clearTimeout(rtcT); setLink('direct'); };
    ch.onclose = () => { if (dc !== ch) return; dc = null; if (R.phase !== 'closed') rtcFail(); };
    ch.onerror = () => {};
    ch.onmessage = e => onDc(e.data);
  }
  function onDc(data) {
    if (R.phase === 'closed' || !R.peer) return;
    if (typeof data === 'string') {
      if (data.length > DC_TEXT_MAX) { counts.ignored++; return; }
      if (!win(dcWin, DC_TEXT_PER_SEC)) { counts.dropped++; return; }
      const m = parse(data, false);
      if (!m) { counts.ignored++; return; }
      lastHeard = performance.now();
      counts.heard++;
      fromPeer(m, 'rtc');
      return;
    }
    if (data instanceof ArrayBuffer) {
      if (!binary || data.byteLength > DC_BIN_MAX) { counts.ignored++; return; }
      const now = performance.now();
      if (now - binWin.at > 1000) { binWin.at = now; binWin.n = 0; }
      binWin.n += data.byteLength;
      if (binWin.n > DC_BYTES_PER_SEC) { counts.dropped++; return; }
      lastHeard = now;
      emit('bin', data);
      return;
    }
    counts.ignored++;
  }

  /* ---------- sending ---------- */
  const dcOpen = () => !!dc && dc.readyState === 'open';
  function sendAny(t, body) {
    if (dcOpen()) {
      try { dc.send(JSON.stringify({ v: 1, t, ...body })); return true; } catch (err) { /* fall through */ }
    }
    return wire(t, body);
  }
  function send(t, body = {}, { via = 'auto' } = {}) {
    if (!R.peer || R.phase === 'closed' || !Object.hasOwn(types, t)) return false;
    if (via === 'rtc' || (via === 'auto' && dcOpen())) {
      if (!dcOpen()) return false;
      let text;
      try { text = JSON.stringify({ v: 1, t, ...body }); } catch (err) { return false; }
      if (text.length > DC_TEXT_MAX) return false;
      try { dc.send(text); return true; } catch (err) { return false; }
    }
    if (!win(outWin, OUT_PER_SEC)) return false;
    return wire(t, body);
  }
  function sendBinary(buf) {
    if (!dcOpen() || !(buf instanceof ArrayBuffer) || buf.byteLength > DC_BIN_MAX) return false;
    try { dc.send(buf); return true; } catch (err) { return false; }
  }
  function drained() {
    if (!dcOpen() || dc.bufferedAmount <= LOW_WATER) return Promise.resolve(dcOpen());
    const ch = dc;
    return new Promise(res => {
      const done = () => { ch.removeEventListener('bufferedamountlow', done); ch.removeEventListener('close', done); clearInterval(poll); res(ch.readyState === 'open'); };
      ch.addEventListener('bufferedamountlow', done);
      ch.addEventListener('close', done);
      const poll = setInterval(() => { if (ch.readyState !== 'open' || ch.bufferedAmount <= LOW_WATER || R.phase === 'closed') done(); }, 250);
    });
  }

  /* ---------- closing ---------- */
  function close(sayBye) {
    if (R.phase === 'closed') return;
    if (sayBye && R.peer) {
      if (dcOpen()) { try { dc.send(JSON.stringify({ v: 1, t: 'bye' })); } catch (err) { /* gone */ } }
      wire('bye');
    }
    clearInterval(knockT); clearInterval(pingT); clearTimeout(joinT); clearTimeout(quietT); clearTimeout(rtcT);
    timers.forEach(clearTimeout); timers.clear();
    const ch = dc, conn = pc;
    dc = null; pc = null;
    /* let a goodbye on the data channel leave before the connection goes */
    setTimeout(() => { try { ch?.close(); } catch (err) { /* gone */ } try { conn?.close(); } catch (err) { /* gone */ } }, sayBye ? 250 : 0);
    if (R.link === 'connecting' || R.link === 'direct') R.link = R.link === 'direct' ? 'lost' : 'failed';
    /* the broker connection is shared: leave the topic once the goodbye has been sealed and sent */
    const off = unsub;
    unsub = null;
    outq.then(() => { try { off?.(); } catch (err) { /* gone */ } });
    try { offLive?.(); } catch (err) { /* gone */ }
    offLive = null;
    setPhase('closed');
  }

  /* ---------- begin ---------- */
  if (!host && !isCode(R.code)) {
    R.error = 'invalid';
    R.phase = 'closed';
    R.link = rtc ? 'failed' : 'off';
  } else if (!secureOk()) {
    R.error = 'insecure';
    R.phase = 'closed';
  } else {
    deriveRoom(kind, R.code).then(k => {
      if (R.phase === 'closed') return;
      key = k.key;
      R.topic = k.topic;
      unsub = live.subscribe(k.topic, onText);
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
    }).catch(() => { R.error = 'insecure'; close(false); });
  }

  return {
    get code() { return R.code; },
    get role() { return host ? 'host' : 'guest'; },
    get kind() { return kind; },
    get phase() { return R.phase; },
    get error() { return R.error; },
    get peer() { return R.peer; },
    get link() { return R.link; },
    get topic() { return R.topic; },
    get direct() { return dcOpen(); },
    get buffered() { return dcOpen() ? dc.bufferedAmount : 0; },
    me: myId,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    send, sendBinary, drained,
    offset() {
      if (!samples.length) return null;
      return samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
    },
    now: clock,
    rtt: () => (rtt === null ? null : Math.round(rtt)),
    live: () => live.status(),
    stats: () => ({ ...counts }),
    leave() { close(true); },
    /* for the play-tests: the raw data channel, to prove junk on it is ignored */
    _debug: { dc: () => dc },
  };
}

export default { openPair, deriveRoom, seal, unseal, rtcAvailable, secureOk, clock, PUBLIC_STUN, JOIN_WAIT, QUIET_MS, RTC_WAIT };
