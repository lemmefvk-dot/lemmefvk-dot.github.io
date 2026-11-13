/* ============================================================
   drop.js — Static Drop: send files to a friend's StaticOS with a
   code, straight from device to device. Also "Move my StaticOS":
   the same backup Settings › Back up your data makes, sent to
   another StaticOS link (staticos.surge.sh and the AWS link are
   separate web addresses, so each keeps its own data).

   The sender opens a room (core/pair.js, kind 'drop') and gets a
   code; the receiver types it. The room only introduces them and
   carries the WebRTC signalling plus a few small control messages
   (sealed with the code). File bytes go ONLY over the direct data
   channel. With no direct path (no TURN relay exists here) the
   transfer fails cleanly and says so; nothing is ever sent through
   the public broker instead.

   Order of a drop:
     sender → offer { mode, files:[{n,s,ty}], from }     (repeated until answered)
     receiver sees names, sizes, types and who it is from;
       Accept → acc { ids }   ·   Decline → dec
     per accepted file, on the data channel:
       fs { i, s, h }  ·  binary chunks  ·  fe { i }     (h = SHA-256, hex)
     receiver → rx { n } (bytes so far) · got { i, ok }
     either side → cancel at any time
   Nothing is saved before Accept, and each file is saved only once
   its byte count and SHA-256 match. Files land in ~/Downloads through
   core/fileimport.js — the same rules as Files' Import: small plain
   text becomes an editable vfs file, everything else a real blob via
   core/media.js. Nothing received is opened or run.

   Caps (LIMITS): per file, per drop, how many files; a move has its
   own cap. The receiver checks every number itself — an over-cap
   file is listed as refused and never requested, and a sender that
   sends more bytes than it declared has the drop stopped.

     startSend({ items:[{ name, type, blob:()=>Promise<Blob> }], mode })
     startReceive(code)
       -> session { role, mode, state, reason, code, peer, link, files,
                    progress { done, total }, saved, room,
                    on(fn) -> off   fn('state'|'progress'|'peer'|'link', …)
                    accept() · decline() · cancel() · close()
                    backup  (move mode, once verified: a Blob) }
   ============================================================ */
import { openPair } from './pair.js';
import { cleanText } from './roomcode.js';
import { vfs } from './vfs.js';
import { importFiles } from './fileimport.js';
import { bus } from './bus.js';

const MB = 1024 * 1024;
export const LIMITS = {
  fileMax: 200 * MB,       /* one file */
  totalMax: 500 * MB,      /* one drop */
  moveMax: 500 * MB,       /* a whole StaticOS backup */
  files: 50,               /* files in one drop */
};
export const CHUNK = 16 * 1024;
const PACE = 40 * MB;                  /* bytes a second the sender allows itself (the receiver caps far higher) */
const OFFER_EVERY = 2500;
const ACC_EVERY = 2000;
const RX_EVERY = 250;
const GOT_WAIT = 60000;
const HEX64 = /^[0-9a-f]{64}$/;
const MIME_RE = /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,80}$/i;

export const DOWNLOADS = () => `${vfs.HOME}/Downloads`;

/** A file name from someone else: one line, no path separators, no hidden-file dot, capped. */
export function cleanName(s) {
  let n = cleanText(s, 140).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '').trim();
  return n.slice(0, 120);
}

export async function sha256(blobOrBuf) {
  const buf = blobOrBuf instanceof Blob ? await blobOrBuf.arrayBuffer() : blobOrBuf;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* every message either side may send, each with its validator */
const TYPES = {
  offer: m => {
    if (m.mode !== 'files' && m.mode !== 'move') return null;
    if (!Array.isArray(m.files) || !m.files.length || m.files.length > LIMITS.files) return null;
    const files = [];
    for (let k = 0; k < m.files.length; k++) {
      const f = m.files[k];
      if (!f || typeof f !== 'object') return null;
      const n = cleanName(f.n);
      if (!n || !Number.isSafeInteger(f.s) || f.s < 0) return null;
      const ty = typeof f.ty === 'string' && MIME_RE.test(f.ty) ? f.ty.toLowerCase() : '';
      files.push({ i: k, n, s: f.s, ty });
    }
    if (m.mode === 'move' && files.length !== 1) return null;
    return { mode: m.mode, files, from: m.mode === 'move' ? cleanText(m.from, 80) : '' };
  },
  acc: m => (Array.isArray(m.ids) && m.ids.length <= LIMITS.files && m.ids.every(i => Number.isInteger(i) && i >= 0 && i < LIMITS.files)
    ? { ids: [...new Set(m.ids)] } : null),
  dec: () => ({}),
  cancel: () => ({}),
  fs: (m, via) => (via === 'rtc' && Number.isInteger(m.i) && m.i >= 0 && Number.isSafeInteger(m.s) && m.s >= 0 && typeof m.h === 'string' && HEX64.test(m.h)
    ? { i: m.i, s: m.s, h: m.h } : null),
  fe: (m, via) => (via === 'rtc' && Number.isInteger(m.i) && m.i >= 0 ? { i: m.i } : null),
  rx: m => (Number.isSafeInteger(m.n) && m.n >= 0 ? { n: m.n } : null),
  got: m => (Number.isInteger(m.i) && m.i >= 0 && typeof m.ok === 'boolean' ? { i: m.i, ok: m.ok, why: cleanText(m.why, 80) } : null),
};

function emitter() {
  const subs = new Set();
  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit(type, data) { subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error('[drop]', err); } }); },
  };
}

/* ======================= sending ======================= */
export function startSend({ items, mode = 'files', from = '' }) {
  const E = emitter();
  const S = {
    role: 'send', mode, state: 'opening', reason: null,
    files: [],                       /* { i, n, s, ty, blob, status: 'waiting'|'sending'|'sent'|'saved'|'failed', why } */
    progress: { done: 0, total: 0, confirmed: 0 },
    accepted: [],
  };
  let room = null, offerT = 0, gotT = 0, stop = false, offs = [];
  const setState = (st, reason = null) => {
    if (S.state === st && S.reason === reason) return;
    S.state = st; S.reason = reason;
    E.emit('state', st);
  };
  const ended = () => ['done', 'declined', 'cancelled', 'failed', 'closed'].includes(S.state);

  function finish(st, reason = null, { tell = null } = {}) {
    if (ended()) return;
    stop = true;
    clearInterval(offerT); clearTimeout(gotT);
    if (tell && room) room.send(tell, {});
    setState(st, reason);
    /* let a last message (cancel, or the data channel's tail) leave first */
    setTimeout(() => { try { room?.leave(); } catch (err) { /* gone */ } }, 400);
  }

  async function prepare() {
    const list = Array.from(items || []).slice(0, LIMITS.files);
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      let blob = null;
      try { blob = await it.blob(); } catch (err) { blob = null; }
      if (!(blob instanceof Blob)) throw new Error(`“${it.name}” has no bytes to send.`);
      S.files.push({ i: k, n: cleanName(it.name) || 'file', s: blob.size, ty: (it.type || blob.type || '').toLowerCase(), blob, status: 'waiting', why: '' });
    }
    if (!S.files.length) throw new Error('Nothing to send.');
    S.progress.total = S.files.reduce((a, f) => a + f.s, 0);
  }

  function offer() {
    room.send('offer', { mode, from: mode === 'move' ? from : undefined, files: S.files.map(f => ({ n: f.n, s: f.s, ty: f.ty })) }, { via: 'mqtt' });
  }

  async function sendAll() {
    setState('sending');
    const queue = S.files.filter(f => S.accepted.includes(f.i));
    S.progress.total = queue.reduce((a, f) => a + f.s, 0);
    S.progress.done = 0;
    let windowAt = performance.now(), windowBytes = 0;
    for (const f of queue) {
      if (stop) return;
      f.status = 'sending';
      E.emit('progress', S.progress);
      let h;
      try { h = await sha256(f.blob); } catch (err) { finish('failed', 'error'); return; }
      if (stop) return;
      if (!room.send('fs', { i: f.i, s: f.s, h }, { via: 'rtc' })) { finish('failed', 'lost'); return; }
      for (let at = 0; at < f.s; at += CHUNK) {
        if (stop) return;
        if (room.buffered > 512 * 1024) {
          const open = await room.drained();
          if (!open) { finish('failed', 'lost'); return; }
          if (stop) return;
        }
        const buf = await f.blob.slice(at, Math.min(f.s, at + CHUNK)).arrayBuffer();
        if (stop) return;
        if (!room.sendBinary(buf)) { finish('failed', 'lost'); return; }
        S.progress.done += buf.byteLength;
        windowBytes += buf.byteLength;
        const now = performance.now();
        if (now - windowAt >= 250) { E.emit('progress', S.progress); windowAt = now; windowBytes = 0; }
        else if (windowBytes > PACE / 4) { await new Promise(r => setTimeout(r, Math.max(0, 250 - (now - windowAt)))); windowAt = performance.now(); windowBytes = 0; }
      }
      if (!room.send('fe', { i: f.i }, { via: 'rtc' })) { finish('failed', 'lost'); return; }
      f.status = 'sent';
      E.emit('progress', S.progress);
    }
    if (stop) return;
    setState('confirming');
    /* the receiver reports each file once it has checked it */
    gotT = setTimeout(() => finish('done', 'unconfirmed'), GOT_WAIT);
    checkAllGot();
  }
  function checkAllGot() {
    const queue = S.files.filter(f => S.accepted.includes(f.i));
    if (queue.length && queue.every(f => f.status === 'saved' || f.status === 'failed')) finish('done');
  }

  function onMsg({ t, m }) {
    if (ended()) return;
    if (t === 'acc' && S.state === 'offered') {
      clearInterval(offerT);
      S.accepted = m.ids.filter(i => S.files.some(f => f.i === i));
      if (!S.accepted.length) { finish('declined'); return; }
      setState('accepted');
      go();
    } else if (t === 'dec' && (S.state === 'offered' || S.state === 'accepted')) {
      finish('declined');
    } else if (t === 'cancel') {
      /* a receiver that couldn't make the direct link cancels: say why */
      if (room.link === 'failed') finish('failed', 'nolink');
      else finish('cancelled', 'them');
    } else if (t === 'rx') {
      S.progress.confirmed = Math.min(m.n, S.progress.total);
      E.emit('progress', S.progress);
    } else if (t === 'got') {
      const f = S.files.find(x => x.i === m.i);
      if (!f || !S.accepted.includes(f.i)) return;
      f.status = m.ok ? 'saved' : 'failed';
      f.why = m.ok ? '' : (m.why || 'not saved');
      E.emit('progress', S.progress);
      if (S.state === 'confirming') checkAllGot();
    }
  }
  /* bytes go only once the direct link is up; without one the drop fails here */
  function go() {
    if (S.state !== 'accepted') return;
    if (room.link === 'direct') sendAll();
    else if (room.link === 'failed' || room.link === 'lost' || room.link === 'off') finish('failed', 'nolink', { tell: 'cancel' });
  }

  (async () => {
    try { await prepare(); }
    catch (err) { S.detail = String(err?.message || err); setState('failed', 'prepare'); return; }
    if (stop) return;
    room = openPair({ kind: 'drop', role: 'host', types: TYPES, rtc: true, binary: false });
    S.code = room.code;
    if (room.phase === 'closed') { S.room = room; setState('failed', room.error || 'error'); return; }
    offs = [
      room.on((type, data) => {
        if (type === 'phase') {
          if (data === 'waiting' && S.state === 'opening') setState('waiting');
          if (data === 'closed' && !ended()) finish('failed', room.error || 'left');
        } else if (type === 'peer') {
          S.peer = data;
          E.emit('peer', data);
          setState('offered');
          offer();
          offerT = setInterval(() => { if (S.state === 'offered') offer(); else clearInterval(offerT); }, OFFER_EVERY);
        } else if (type === 'msg') onMsg(data);
        else if (type === 'link') {
          E.emit('link', data);
          if (S.state === 'accepted') go();
          else if (S.state === 'sending' && data !== 'direct') finish('failed', 'lost');
          /* no direct link means no drop: say so now rather than after Accept */
          else if (S.state === 'offered' && data === 'failed') finish('failed', 'nolink', { tell: 'cancel' });
        } else if (type === 'left') {
          if (!ended()) finish(S.state === 'confirming' ? 'done' : 'failed', S.state === 'confirming' ? 'unconfirmed' : 'left');
        } else if (type === 'live') E.emit('live', data);
      }),
    ];
    S.room = room;
    E.emit('state', S.state);
  })();

  return {
    get role() { return 'send'; },
    get mode() { return mode; },
    get state() { return S.state; },
    get reason() { return S.reason; },
    get detail() { return S.detail || ''; },
    get code() { return room?.code || null; },
    get peer() { return S.peer || null; },
    get link() { return room?.link || 'off'; },
    get live() { return room?.live() || 'idle'; },
    get files() { return S.files.map(({ blob, ...f }) => ({ ...f, accepted: S.accepted.includes(f.i) })); },
    get progress() { return { ...S.progress }; },
    get room() { return room; },
    on: E.on,
    cancel() { if (!ended()) finish('cancelled', 'me', { tell: 'cancel' }); },
    close() { stop = true; clearInterval(offerT); clearTimeout(gotT); offs.forEach(f => f()); if (!ended()) { room?.send('cancel', {}); setState('closed'); } try { room?.leave(); } catch (err) { /* gone */ } },
  };
}

/* ======================= receiving ======================= */
export function startReceive(code) {
  const E = emitter();
  const S = {
    role: 'receive', mode: 'files', state: 'joining', reason: null,
    files: [], from: '', accepted: [],
    progress: { done: 0, total: 0 },
    saved: [],                        /* { name, path, ok, why } */
    backup: null,
  };
  let cur = null, accT = 0, rxT = 0, lastRx = 0, offs = [];
  const room = openPair({ kind: 'drop', role: 'guest', code, types: TYPES, rtc: true, binary: true });
  const setState = (st, reason = null) => {
    if (S.state === st && S.reason === reason) return;
    S.state = st; S.reason = reason;
    E.emit('state', st);
  };
  const ended = () => ['done', 'restore', 'declined', 'cancelled', 'failed', 'closed'].includes(S.state);
  function finish(st, reason = null, { tell = null } = {}) {
    if (ended()) return;
    clearInterval(accT); clearInterval(rxT);
    cur = null;
    if (tell) room.send(tell, {});
    setState(st, reason);
    setTimeout(() => { try { room.leave(); } catch (err) { /* gone */ } }, 400);
  }
  const cap = () => (S.mode === 'move' ? LIMITS.moveMax : LIMITS.fileMax);

  function onOffer(m) {
    if (S.state !== 'joined') return;                 /* the first offer is the one; repeats are ignored */
    S.mode = m.mode;
    S.from = m.from;
    let room2 = LIMITS.totalMax;
    S.files = m.files.map(f => {
      let why = '';
      if (f.s > cap()) why = 'toobig';
      else if (f.s > room2) why = 'toomuch';
      else room2 -= f.s;
      return { ...f, why, status: why ? 'refused' : 'offered' };
    });
    setState('offered');
  }

  async function finishFile() {
    const c = cur;
    cur = null;
    const f = S.files.find(x => x.i === c.i);
    const reply = (ok, why = '') => room.send('got', { i: c.i, ok, why }, { via: 'auto' });
    if (c.got !== c.s) { f.status = 'failed'; f.why = 'damaged'; reply(false, 'damaged'); return next(); }
    const blob = new Blob(c.chunks, { type: f.ty || '' });
    c.chunks = [];
    let h = '';
    try { h = await sha256(blob); } catch (err) { h = ''; }
    if (ended()) return;
    if (h !== c.h) { f.status = 'failed'; f.why = 'damaged'; reply(false, 'damaged'); return next(); }
    if (S.mode === 'move') {
      S.backup = blob;
      f.status = 'saved';
      reply(true);
      return next();
    }
    /* checked: now it may be saved, by the same rules as Files' Import */
    const dir = DOWNLOADS();
    if (!vfs.node(dir)) vfs.mkdir(dir);
    let r;
    try {
      const file = new File([blob], f.n, { type: f.ty || '' });
      [r] = await importFiles(dir, [file]);
    } catch (err) { r = { ok: false, why: String(err?.message || err) }; }
    if (ended() && S.state !== 'receiving') return;
    f.status = r?.ok ? 'saved' : 'failed';
    f.why = r?.ok ? '' : (r?.why || 'not saved');
    S.saved.push({ name: f.n, path: r?.path || null, ok: !!r?.ok, why: f.why });
    if (r?.ok) bus.emit('fs:change', dir, r.path);
    reply(!!r?.ok, r?.ok ? '' : 'not saved');
    next();
  }
  function next() {
    E.emit('progress', S.progress);
    const left = S.files.filter(f => S.accepted.includes(f.i) && (f.status === 'offered' || f.status === 'receiving'));
    if (left.length) return;
    clearInterval(rxT);
    room.send('rx', { n: S.progress.done });
    if (S.mode === 'move') {
      if (S.backup) { clearInterval(accT); setState('restore'); setTimeout(() => { try { room.leave(); } catch (err) { /* gone */ } }, 600); }
      else finish('failed', 'damaged');
      return;
    }
    clearInterval(accT);
    setState('done');
    setTimeout(() => { try { room.leave(); } catch (err) { /* gone */ } }, 600);
  }

  function onMsg({ t, m }) {
    if (ended()) return;
    if (t === 'offer') onOffer(m);
    else if (t === 'cancel') finish('cancelled', 'them');
    else if (t === 'dec') finish('cancelled', 'them');
    else if (t === 'fs') {
      if (!(S.state === 'accepted' || S.state === 'receiving') || cur) return;
      const f = S.files.find(x => x.i === m.i);
      if (!f || !S.accepted.includes(f.i) || f.status !== 'offered' || m.s !== f.s) { finish('failed', 'damaged', { tell: 'cancel' }); return; }
      clearInterval(accT);
      f.status = 'receiving';
      cur = { i: f.i, s: f.s, h: m.h, got: 0, chunks: [] };
      if (S.state !== 'receiving') {
        setState('receiving');
        clearInterval(rxT);
        rxT = setInterval(() => { if (S.progress.done !== lastRx) { lastRx = S.progress.done; room.send('rx', { n: S.progress.done }); } }, RX_EVERY);
      }
      if (f.s === 0) E.emit('progress', S.progress);
    } else if (t === 'fe') {
      if (!cur || m.i !== cur.i) return;
      finishFile();
    }
  }
  function onBin(buf) {
    if (!cur || S.state !== 'receiving') return;
    cur.got += buf.byteLength;
    if (cur.got > cur.s) { finish('failed', 'damaged', { tell: 'cancel' }); return; }   /* more than it said: stop */
    cur.chunks.push(buf);
    S.progress.done += buf.byteLength;
    E.emit('progress', S.progress);
  }

  offs = [room.on((type, data) => {
    if (type === 'phase') {
      if (data === 'paired' && S.state === 'joining') setState('joined');
      if (data === 'closed' && !ended()) finish('failed', room.error || 'left');
    } else if (type === 'peer') { S.peer = data; E.emit('peer', data); }
    else if (type === 'msg') onMsg(data);
    else if (type === 'bin') onBin(data);
    else if (type === 'link') {
      E.emit('link', data);
      if (data === 'failed' || data === 'lost') {
        if (['joined', 'offered', 'accepted', 'receiving'].includes(S.state)) finish('failed', data === 'lost' ? 'lost' : 'nolink', { tell: 'cancel' });
      }
    } else if (type === 'left') {
      if (!ended()) finish(S.state === 'offered' || S.state === 'joined' ? 'cancelled' : 'failed', 'left');
    } else if (type === 'live') E.emit('live', data);
  })];
  /* refused before it began (not a code, or a page without Web Crypto) */
  if (room.phase === 'closed') { S.state = 'failed'; S.reason = room.error || 'invalid'; }

  return {
    get role() { return 'receive'; },
    get mode() { return S.mode; },
    get state() { return S.state; },
    get reason() { return S.reason; },
    get code() { return room.code; },
    get peer() { return S.peer || null; },
    get from() { return S.from; },
    get link() { return room.link; },
    get live() { return room.live(); },
    get files() { return S.files.map(f => ({ ...f, accepted: S.accepted.includes(f.i) })); },
    get progress() { return { ...S.progress }; },
    get saved() { return S.saved.slice(); },
    get backup() { return S.backup; },
    get room() { return room; },
    on: E.on,
    accept() {
      if (S.state !== 'offered') return false;
      S.accepted = S.files.filter(f => f.status === 'offered').map(f => f.i);
      if (!S.accepted.length) return false;
      S.progress.total = S.files.filter(f => S.accepted.includes(f.i)).reduce((a, f) => a + f.s, 0);
      setState('accepted');
      if (room.link === 'failed' || room.link === 'lost') { finish('failed', 'nolink', { tell: 'cancel' }); return false; }
      const say = () => room.send('acc', { ids: S.accepted }, { via: 'auto' });
      say();
      accT = setInterval(() => { if (S.state === 'accepted') say(); else clearInterval(accT); }, ACC_EVERY);
      return true;
    },
    decline() { if (!ended()) finish('declined', 'me', { tell: 'dec' }); },
    cancel() { if (!ended()) finish('cancelled', 'me', { tell: 'cancel' }); },
    discard() { S.backup = null; if (S.state === 'restore') setState('closed'); },
    close() {
      clearInterval(accT); clearInterval(rxT);
      offs.forEach(f => f());
      if (!ended()) { room.send(S.state === 'offered' ? 'dec' : 'cancel', {}); setState('closed'); }
      cur = null;
      try { room.leave(); } catch (err) { /* gone */ }
    },
  };
}

export default { startSend, startReceive, LIMITS, cleanName, sha256, DOWNLOADS, CHUNK };
