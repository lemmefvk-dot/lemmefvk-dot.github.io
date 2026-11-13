/* ============================================================
   arcade/sketch.js — Sketch & Guess for Static Arcade: two or more
   friends in one room, taking turns to draw a secret word while the
   others type guesses.

   A room is made with a six-character code (Make a room) and joined
   with it (Join). Up to 10 players. The host picks rounds and the
   time per turn and starts the game; everyone present draws once a
   round. The rules, scoring and the host's turn engine are in
   ./sketch-rules.js; this file is the table: the drawing canvas, the
   guess box, the scoreboard and the live link.

   THE LINK. Everything rides StaticOS's one live connection, a free
   PUBLIC relay (MQTT). The topic is made from the room code with the
   same PBKDF2 stretching as Draw Together (core/pair.js) and every
   message is sealed (AES-GCM) with a key from the code, so what the
   relay carries is sealed bytes under "pair/sketch/<hex>", never
   names, strokes or guesses. Anyone WHO HAS THE CODE can read and
   write the room, so share it only with the players. The relay still
   sees that a room exists, when it is busy and how much is sent.
   Delivery is best-effort. Drawings stay in the room: nothing is
   saved, uploaded or kept after you leave.

   PRIVACY OF THE WORD. The word exists only on the drawer's device.
   The host decides whose turn it is and never sees the word unless
   the host is drawing. For each turn the drawer makes a throwaway ECDH
   key pair and shares the public half; a guess is sealed to that key
   (ECDH → AES-GCM), so the other guessers, who hold the room key too,
   cannot read a right answer off the wire. The drawer's device
   compares by normalised text and announces either a wrong guess (as
   text) or just "this player got it". The word itself is sent once,
   after the turn is over.

   MESSAGES (sealed JSON { v:1, t, f, … }, f = this session's random
   id): join · wel · full · kick · hb · bye · st (the host's state and
   scoreboard, repeated every 2 s) · wd (the word's shape and the key)
   · sk (a stroke chunk, the Draw Together format) · gs · gr · rev ·
   rq. Every one passes check() in ./sketch-rules.js; strokes are
   accepted only from the current drawer and size-capped, guesses are
   rate-limited, names and guesses are shown with textContent. The room
   key is shared, so a member could forge another member's session id:
   this is a game among friends, not a vote — the host's Remove button
   and a room code you only give to friends are the protection.

   Mouse or touch: draw on the canvas (brush, eraser, line, box, oval,
   8 colours, 3 sizes, clear). Keyboard: type guesses (Enter sends);
   the drawer can draw with arrow keys (Space puts the pen down and
   lifts it, Shift moves further) and press C to clear.
   Score: your points when the game ends.
   ============================================================ */
import { h } from '../core/dom.js';
import { me } from '../core/identity.js';
import { isCode, normalizeCode, randomCode, safeName, cleanText } from '../core/roomcode.js';
import { deriveRoom, seal, unseal, secureOk } from '../core/pair.js';
import * as live from '../portal/live.js';
import * as R from './sketch-rules.js';
import { KIT_CSS, ownsKey, sounder, segment, button } from './boardkit.js';

const WIRE_MAX = 24000;
const PLAIN_MAX = 16000;
const IN_PER_SEC = 400;
const SENDER_PER_SEC = 90;
const OUT_PER_SEC = 50;
const KNOCK_EVERY = 1000;
const JOIN_WAIT = 10000;
const HB_EVERY = 4000;
const STATE_EVERY = 2000;
const WD_EVERY = 3000;
const COLORS = ['#111827', '#e11d48', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#92400e'];
const SIZES = [3, 7, 14];
const TOOLS = [['brush', 'Brush', 'B'], ['eraser', 'Eraser', 'E'], ['line', 'Line', 'L'], ['rect', 'Box', 'X'], ['ellipse', 'Oval', 'O']];
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const sessionId = () => [...rand(10)].map(b => (b % 36).toString(36)).join('');
const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = s => { try { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); } catch (e) { return null; } };
const seed32 = () => new Uint32Array(rand(4).buffer)[0] >>> 0;
const rngOf = () => { let a = seed32(); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const CSS = `
.sk{position:absolute;inset:0;container-type:size}
.sk *{box-sizing:border-box}
.sk-main{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;min-height:0}
.sk-stage{position:relative;flex:1 1 auto;min-height:0;display:grid;place-items:center}
.sk-paper{position:relative;aspect-ratio:3/2;max-width:100%;max-height:100%;width:min(100%,calc((100cqh - 120px) * 1.5));border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 10px 30px -12px rgba(0,0,0,.7)}
.sk-paper canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.sk-paper.is-draw canvas{cursor:crosshair}
.sk-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.sk-tools .arx-bg__btn{flex:0 0 auto;height:30px;padding:0 9px}
.sk-sw{width:24px;height:24px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer;padding:0}
.sk-sw[aria-pressed="true"]{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.4)}
.sk-word{font:800 var(--fs-18,18px)/1.2 var(--font,system-ui);letter-spacing:.14em;color:var(--ink-0);text-align:center;min-height:26px}
.sk-guess{display:flex;gap:6px}
.sk-guess input,.sk-join input{flex:1;min-width:0;height:36px;padding:0 12px;border-radius:var(--r-md,11px);border:1px solid var(--line-1);background:var(--fill-1);color:var(--ink-0);font:600 var(--fs-13,13px) var(--font,system-ui)}
.sk-guess input:focus-visible,.sk-join input:focus-visible{outline:2px solid hsl(var(--h,190) 100% 72%);outline-offset:1px}
.sk-menu{position:absolute;inset:0;display:grid;place-items:center;padding:16px;overflow:auto}
.sk-card{width:min(460px,100%);display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:16px;background:var(--fill-1);border:1px solid var(--line-1);color:var(--ink-1);font-size:var(--fs-13,13px);line-height:1.5}
.sk-card h2{margin:0;font:800 var(--fs-18,18px)/1.2 var(--font,system-ui);color:var(--ink-0)}
.sk-card small,.sk-fine{color:var(--ink-3);font-size:var(--fs-11,11px);line-height:1.45}
.sk-code{font:800 34px/1 var(--mono,ui-monospace,monospace);letter-spacing:.22em;color:var(--ink-0);text-align:center;padding:10px 0;user-select:all}
.sk-join{display:flex;gap:6px}
.sk-err{color:#ffb3bf;font-weight:650}
.sk-ros{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;overflow:auto;min-height:0}
.sk-ros li{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:9px;background:var(--fill-1);border:1px solid var(--line-0);font-size:var(--fs-12,12px)}
.sk-ros li.is-draw{border-color:hsl(var(--h,190) 90% 66% / .7)}
.sk-ros li.is-got b{color:#7dffb0}
.sk-ros li .dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
.sk-ros li b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-0)}
.sk-ros li small{color:var(--ink-3)}
.sk-ros li .arx-bg__btn{flex:0 0 auto;height:24px;padding:0 8px;font-size:11px}
.sk-feed{flex:1 1 60px;min-height:48px;overflow:auto;padding:6px 8px;border-radius:var(--r-md,11px);background:var(--fill-0);border:1px solid var(--line-0);font:500 var(--fs-12,12px)/1.55 var(--font,system-ui);color:var(--ink-2);word-break:break-word}
.sk-feed div.ok{color:#7dffb0;font-weight:650}
.sk-timer{font:700 var(--fs-13,13px) var(--mono,ui-monospace,monospace);color:var(--ink-1)}
.sk .arx-bg__side{flex-basis:260px}
@container (max-aspect-ratio: 11/10){.sk .arx-bg{flex-direction:column}.sk .arx-bg__side{flex:0 0 auto;max-height:42%}}
`;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const rnd = rngOf();
    let dead = false;

    /* S: everything about this client; nothing here is saved anywhere */
    const S = {
      phase: 'menu',            /* menu | connecting | joining | room | closed */
      role: null, code: '', error: '', myId: '', hostId: null, engine: null, st: null, stAt: 0, stCount: 0, welcomed: false,
      curTid: '', pattern: null, drawerPk: null, revealed: null, feed: [], got: new Set(), ended: false, endT: 0,
      strokes: [], byId: new Map(), seq: 0, strokeCount: 0, rxPerSec: { at: 0, n: 0 }, rqAt: 0, mine: null, used: new Set(), lastGuess: 0, guessing: false,
      tool: 'brush', color: COLORS[0], size: SIZES[1], draw: null, pen: { x: 300, y: 200, down: false }, redrawQ: 0,
      rec: null, lastLive: 'connecting', joinAt: 0, hostHeard: 0, dropped: 0, rejected: 0, outWin: { at: 0, n: 0 }, inWin: { at: 0, n: 0 }, senderWin: new Map(),
      key: null, topic: null, unsub: null, offLive: null, inq: Promise.resolve(), outq: Promise.resolve(), timers: new Set(), myScore: 0,
    };
    const later = (fn, ms) => { const t = setTimeout(() => { S.timers.delete(t); if (!dead) fn(); }, ms); S.timers.add(t); return t; };
    const every = (fn, ms) => { const t = setInterval(() => { if (!dead) fn(); }, ms); S.timers.add(t); return t; };

    /* ------------------------------ the page ------------------------------ */
    const root = h('div.sk', h('style', { text: KIT_CSS + CSS }));
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    el.append(root);
    const say = t => { sr.textContent = t; };

    /* ------------------------------ the link ------------------------------ */
    const wire = (t, body = {}) => {
      if (!S.key || S.phase === 'closed' && t !== 'bye') return false;
      const now = performance.now();
      if (now - S.outWin.at > 1000) S.outWin = { at: now, n: 0 };
      if (++S.outWin.n > OUT_PER_SEC) return false;
      const text = JSON.stringify({ v: 1, t, f: S.myId, ...body });
      if (text.length > PLAIN_MAX) return false;
      const topic = S.topic, key = S.key;
      S.outq = S.outq.then(async () => { try { live.publish(topic, await seal(key, text)); } catch (e) { /* gone */ } });
      return live.status() === 'live';
    };
    /* send to the room and also hear it ourselves (the broker never echoes our own messages back) */
    const broadcast = (t, body = {}) => { wire(t, body); hear({ v: 1, t, f: S.myId, ...body }); };

    function onText(text) {
      if (dead || !S.key) return;
      if (typeof text !== 'string' || text.length > WIRE_MAX) { S.dropped++; return; }
      const now = performance.now();
      if (now - S.inWin.at > 1000) S.inWin = { at: now, n: 0 };
      if (++S.inWin.n > IN_PER_SEC) { S.dropped++; return; }
      S.inq = S.inq.then(async () => {
        const plain = await unseal(S.key, text);
        if (dead || plain === null || plain.length > PLAIN_MAX) { S.dropped++; return; }
        if (S.rec) { S.rec.push(plain); if (S.rec.length > 600) S.rec.shift(); }
        let m;
        try { m = JSON.parse(plain); } catch (e) { S.dropped++; return; }
        const c = R.check(m);
        if (!c) { S.rejected++; return; }
        if (c.f === S.myId) return;
        let w = S.senderWin.get(c.f);
        if (!w || now - w.at > 1000) { w = { at: now, n: 0 }; S.senderWin.set(c.f, w); if (S.senderWin.size > 64) S.senderWin.delete(S.senderWin.keys().next().value); }
        if (++w.n > SENDER_PER_SEC) { S.dropped++; return; }
        hear(c);
      });
    }

    async function connect() {
      S.phase = S.role === 'host' ? 'connecting' : 'connecting';
      render();
      let k;
      try { if (!secureOk()) throw new Error('insecure'); k = await deriveRoom('sketch', S.code); } catch (e) { fail('insecure'); return; }
      if (dead) return;
      S.key = k.key; S.topic = k.topic;
      S.unsub = live.subscribe(k.topic, onText);
      S.offLive = live.onStatus(st => {
        S.lastLive = st;
        if (st === 'live' && S.phase === 'connecting') later(begin, 150);
        render(true);
      });
    }
    function begin() {
      if (S.phase !== 'connecting') return;
      if (S.role === 'host') {
        const m = me();
        S.engine = R.createHost({ pid: S.myId, name: m.name, hue: m.color, rnd });
        S.phase = 'room';
        S.hostId = S.myId;
        S.welcomed = true;
        every(hostTick, 250);
        every(publishState, STATE_EVERY);
        publishState();
        render();
        return;
      }
      S.phase = 'joining';
      S.joinAt = performance.now();
      const knock = () => { const m = me(); wire('join', { n: safeName(m.name) || 'Friend', c: Number.isFinite(m.color) ? m.color : 200 }); };
      knock();
      S.knockT = every(() => { if (S.phase === 'joining') { knock(); if (performance.now() - S.joinAt > JOIN_WAIT) fail('nobody'); } }, KNOCK_EVERY);
      render();
    }
    function fail(reason) {
      S.error = reason;
      teardownNet(false);
      S.phase = 'closed';
      render();
    }
    function teardownNet(sayBye) {
      if (sayBye && S.key && S.phase === 'room') wire('bye');
      S.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); S.timers.clear();
      clearTimeout(S.endT);
      try { S.unsub?.(); } catch (e) { /* gone */ }
      try { S.offLive?.(); } catch (e) { /* gone */ }
      S.unsub = S.offLive = null;
    }

    /* ------------------------------ host side ------------------------------ */
    function publishState() {
      if (S.role !== 'host' || !S.engine || dead) return;
      broadcast('st', S.engine.snapshot());
    }
    function hostTick() {
      const e = S.engine;
      const before = `${e.phase}|${e.tid}|${e.drawer}`;
      e.tick();
      const gone = e.sweep();
      if (gone.length || before !== `${e.phase}|${e.tid}|${e.drawer}`) publishState();
    }
    const nameOfId = id => S.st?.ros.find(r => r[0] === id)?.[1] || 'A player';

    function removePlayer(id) {
      if (S.role !== 'host' || !S.engine || !S.engine.kick(id)) return;
      for (const d of [0, 400, 1200]) later(() => wire('kick', { to: id }), d);
      S.feed = S.feed.filter(f => f.pid !== id);
      publishState();
      say('Player removed.');
    }

    /* ------------------------------ hearing ------------------------------ */
    function hear(m) {
      const fromHost = m.f === S.hostId;
      switch (m.t) {
        case 'join': {
          if (S.role !== 'host' || !S.engine) return;
          const r = S.engine.join(m.f, m.n, m.c);
          if (r === 'ok') { wire('wel', { to: m.f }); publishState(); } else wire(r === 'banned' ? 'kick' : 'full', { to: m.f });
          return;
        }
        case 'hb': if (S.role === 'host') S.engine?.seen(m.f); return;
        case 'bye':
          if (S.role === 'host') { if (S.engine?.leave(m.f)) publishState(); return; }
          if (fromHost) { fail('host-left'); }
          return;
        case 'wel':
          if (S.role === 'guest' && S.phase === 'joining' && m.to === S.myId) {
            S.hostId = m.f; S.welcomed = true; S.phase = 'room'; S.hostHeard = performance.now();
            every(() => wire('hb'), HB_EVERY);
            every(() => { if (performance.now() - S.hostHeard > R.LIMITS.quietMs) fail('lost'); }, 3000);
            render();
          }
          return;
        case 'full': if (S.role === 'guest' && S.phase === 'joining' && m.to === S.myId) fail('full'); return;
        case 'kick': if (S.role === 'guest' && fromHost && m.to === S.myId) fail('removed'); return;
        case 'st': if (fromHost) applyState(m); return;
        case 'wd':
          if (S.st && m.f === S.st.dr && m.tid === S.st.tid && m.f !== S.myId) { S.pattern = m.lens; S.drawerPk = m.pk; render(true); }
          return;
        case 'sk': return takeStroke(m);
        case 'gs': return takeGuess(m);
        case 'gr': return takeResult(m);
        case 'rev':
          if (S.st && m.f === S.st.dr && m.tid === S.curTid) { S.revealed = m.word; addFeed({ kind: 'info', txt: `The word was “${m.word}”.` }); say(`The word was ${m.word}.`); render(true); }
          return;
        case 'rq': if (S.mine && m.tid === S.mine.tid && m.f !== S.myId) resendAll(); return;
        default: return;
      }
    }

    /* the host's state: the scoreboard, whose turn it is, how long is left */
    function applyState(m) {
      S.hostHeard = performance.now();
      const prev = S.st;
      S.st = m; S.stAt = performance.now(); S.stCount++;
      const inRoster = m.ros.some(r => r[0] === S.myId);
      if (S.role === 'guest' && S.welcomed && !inRoster && S.stCount > 2) { fail('removed'); return; }
      /* a removed player's guesses stop showing */
      S.feed = S.feed.filter(f => !f.pid || m.ros.some(r => r[0] === f.pid));
      for (const r of m.ros) {
        if (r[5] && !S.got.has(r[0])) { S.got.add(r[0]); if (m.ph === 'draw' || m.ph === 'reveal') addFeed({ kind: 'ok', pid: r[0], txt: `${r[1]} guessed it!` }); if (r[0] === S.myId) snd.blip(660, 0.12, 'triangle', 0.8, 990); }
      }
      const mine = m.ros.find(r => r[0] === S.myId);
      if (mine) { S.myScore = mine[3]; ctx.onScore(mine[3]); }
      if (m.tid !== S.curTid) newTurn(m, prev);
      if (m.ph === 'reveal' && S.mine && S.mine.tid === m.tid) sendReveal();
      if (m.ph === 'end') finishSoon();
      render(true);
    }

    function newTurn(m) {
      S.curTid = m.tid;
      S.strokes = []; S.byId = new Map(); S.strokeCount = 0; S.seq = 0; S.pattern = null; S.drawerPk = null; S.revealed = null; S.got = new Set(); S.draw = null; S.guessing = false;
      if (m.tid) S.feed = [];
      S.mine = null;
      S.pen.down = false;
      scheduleRedraw();
      if (m.tid && m.ph === 'draw') {
        say(m.dr === S.myId ? 'Your turn to draw.' : `${nameOfId(m.dr)} is drawing.`);
        snd.blip(440, 0.08, 'triangle', 0.7, 660);
        if (m.dr === S.myId) prepareTurn(m.tid);
        /* arriving mid-turn (the first state this device has seen): ask the drawer for the drawing so far */
        else if (m.dr && S.stCount <= 1) { later(() => { if (S.curTid === m.tid) wire('rq', { tid: m.tid }); }, 700); }
      }
    }

    /* ------------------------------ the drawer ------------------------------ */
    async function prepareTurn(tid) {
      const mine = { tid, word: R.pickWord(rnd, S.used), kp: null, pub: null, seen: new Set(), per: new Map(), skips: 0, revSent: 0, wdT: 0 };
      S.mine = mine;
      render(true);
      try {
        const kp = await crypto.subtle.generateKey(ECDH, false, ['deriveKey']);
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
        if (dead || S.mine !== mine) return;
        mine.kp = kp; mine.pub = b64(raw);
      } catch (e) { say('This browser can’t make the key for private guesses.'); return; }
      sendWd();
      mine.wdT = every(() => { if (S.mine === mine && S.st?.ph === 'draw') sendWd(); else clearInterval(mine.wdT); }, WD_EVERY);
    }
    function sendWd() {
      const m = S.mine;
      if (!m || !m.pub) return;
      wire('wd', { tid: m.tid, lens: R.lensOf(m.word), pk: m.pub });
    }
    function skipWord() {
      const m = S.mine;
      if (!m || m.skips >= 3 || S.strokes.length || S.st?.ph !== 'draw') return;
      m.skips++;
      m.word = R.pickWord(rnd, S.used);
      sendWd();
      render(true);
    }
    function sendReveal() {
      const m = S.mine;
      if (!m || m.revSent >= 3) return;
      m.revSent++;
      wire('rev', { tid: m.tid, word: m.word });
      if (m.revSent === 1) { S.revealed = m.word; addFeed({ kind: 'info', txt: `The word was “${m.word}”.` }); render(true); }
      later(() => { if (S.mine === m && m.revSent < 3) sendReveal(); }, 700);
    }

    /* a guess arrives sealed to this turn's key: only this device can read it */
    async function takeGuess(m) {
      const mine = S.mine, st = S.st;
      if (!mine || !mine.kp || !st || st.ph !== 'draw' || m.tid !== mine.tid || st.tid !== mine.tid || m.f === S.myId) return;
      const row = st.ros.find(r => r[0] === m.f);
      if (!row || !row[4] || S.got.has(m.f)) return;
      const now = performance.now();
      const per = mine.per.get(m.f) || { at: 0, n: 0 };
      if (now - per.at < R.LIMITS.guessGapMs * 0.8 || per.n >= R.LIMITS.guessesPerTurn || mine.seen.has(m.pk + m.iv)) return;
      per.at = now; per.n++; mine.per.set(m.f, per); mine.seen.add(m.pk + m.iv);
      let text = null;
      try {
        const pub = unb64(m.pk), iv = unb64(m.iv), ct = unb64(m.ct);
        if (!pub || pub.length !== 65 || !iv || iv.length !== 12 || !ct) return;
        const theirs = await crypto.subtle.importKey('raw', pub, ECDH, false, []);
        const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, mine.kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ct));
        const o = JSON.parse(plain);
        text = cleanText(o && o.t, R.LIMITS.guessLen);
      } catch (e) { return; }
      if (dead || S.mine !== mine || !text || S.st?.ph !== 'draw') return;
      if (R.isMatch(text, mine.word)) broadcast('gr', { tid: mine.tid, p: m.f, ok: 1 });
      else broadcast('gr', { tid: mine.tid, p: m.f, ok: 0, txt: text });
    }

    /* the drawer's verdict: shown to everyone; the host scores a right one */
    function takeResult(m) {
      const st = S.st;
      if (!st || m.f !== st.dr || m.tid !== st.tid || !st.ros.some(r => r[0] === m.p)) return;
      if (S.role === 'host' && S.engine && m.ok) {
        if (S.engine.correct(m.f, m.tid, m.p)) publishState();
        return;
      }
      if (!m.ok) { addFeed({ kind: 'guess', pid: m.p, txt: m.txt }); render(true); }
    }

    function addFeed(item) {
      S.feed.push(item);
      if (S.feed.length > 60) S.feed.shift();
    }

    /* ------------------------------ strokes ------------------------------ */
    function takeStroke(m) {
      const st = S.st;
      if (!st || m.f !== st.dr || m.f === S.myId || m.tid !== S.curTid || (st.ph !== 'draw' && st.ph !== 'reveal')) return;
      const now = performance.now();
      if (now - S.rxPerSec.at > 1000) S.rxPerSec = { at: now, n: 0 };
      if (++S.rxPerSec.n > R.LIMITS.strokeMsgsPerSec) return;
      let s = S.byId.get(m.id);
      if (!s) {
        if (S.strokeCount >= R.LIMITS.strokesPerTurn) return;
        S.strokeCount++;
        s = { id: m.id, s: m.s, tool: m.tool, c: m.c, w: m.w, p: [], n: undefined };
        S.byId.set(m.id, s);
        let k = S.strokes.length;
        while (k > 0 && S.strokes[k - 1].s > s.s) k--;
        S.strokes.splice(k, 0, s);
      }
      for (let i = 0; i < m.p.length; i++) s.p[m.i * 2 + i] = m.p[i];
      if (m.n !== undefined) s.n = m.n;
      scheduleRedraw();
      /* a stroke that finished with points missing: ask once for the drawing again */
      if (s.n !== undefined && s.p.length < s.n * 2 && performance.now() - S.rqAt > 3000) { S.rqAt = performance.now(); later(() => { if (S.curTid === m.tid && S.byId.get(m.id)?.p.length < s.n * 2) wire('rq', { tid: m.tid }); }, 1200); }
    }

    /* drawing here: local strokes go on the canvas at once and out in small chunks */
    const paper = h('div.sk-paper');
    const cv = h('canvas', { width: R.CANVAS.w, height: R.CANVAS.h, role: 'img', 'aria-label': 'Drawing canvas' });
    paper.append(cv);
    const g = cv.getContext('2d');
    function paintStroke(st, pts) {
      const p = pts || st.p;
      g.save();
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = st.tool === 'eraser' ? '#ffffff' : st.c;
      g.fillStyle = g.strokeStyle;
      g.lineWidth = st.tool === 'eraser' ? st.w * 2 : st.w;
      const n = Math.floor(p.length / 2);
      let have = 0;
      while (have < n && p[have * 2] !== undefined && p[have * 2 + 1] !== undefined) have++;
      if (st.tool === 'brush' || st.tool === 'eraser') {
        if (have === 1) { g.beginPath(); g.arc(p[0], p[1], g.lineWidth / 2, 0, Math.PI * 2); g.fill(); }
        else if (have > 1) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 1; i < have; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.stroke(); }
      } else if (have >= 2) {
        const [x0, y0, x1, y1] = p;
        g.beginPath();
        if (st.tool === 'line') { g.moveTo(x0, y0); g.lineTo(x1, y1); }
        else if (st.tool === 'rect') g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        else g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    function redraw() {
      S.redrawQ = 0;
      if (dead) return;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, R.CANVAS.w, R.CANVAS.h);
      let from = 0;
      for (let i = S.strokes.length - 1; i >= 0; i--) if (S.strokes[i].tool === 'clear') { from = i + 1; break; }
      for (let i = from; i < S.strokes.length; i++) paintStroke(S.strokes[i]);
      if (S.draw?.preview) paintStroke(S.draw.preview);
    }
    function scheduleRedraw() { if (!S.redrawQ) S.redrawQ = requestAnimationFrame(redraw); }

    const iAmDrawer = () => !!S.st && S.st.ph === 'draw' && S.st.dr === S.myId && !!S.mine;
    const logical = e => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(R.CANVAS.w, Math.round((e.clientX - r.left) / r.width * R.CANVAS.w))), Math.max(0, Math.min(R.CANVAS.h, Math.round((e.clientY - r.top) / r.height * R.CANVAS.h)))]; };

    function strokeStart(x, y) {
      if (!iAmDrawer() || S.draw || S.strokeCount >= R.LIMITS.strokesPerTurn) return false;
      const shape = ['line', 'rect', 'ellipse'].includes(S.tool);
      const st = { id: `h${(++S.seq).toString(36)}`, s: S.seq, tool: S.tool, c: S.color, w: S.size, p: [x, y], n: undefined };
      S.strokeCount++;
      S.draw = { st, sent: 0, shape, x0: x, y0: y, preview: null, t: later(flush, 80) };
      S.byId.set(st.id, st); S.strokes.push(st);
      scheduleRedraw();
      return true;
    }
    function strokeMove(x, y) {
      const d = S.draw;
      if (!d) return;
      const st = d.st;
      if (d.shape) { d.preview = { ...st, p: [d.x0, d.y0, x, y] }; scheduleRedraw(); return; }
      const lx = st.p[st.p.length - 2], ly = st.p[st.p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 2 || st.p.length / 2 >= R.LIMITS.pointsPerStroke - 1) return;
      st.p.push(x, y);
      scheduleRedraw();
    }
    function strokeEnd() {
      const d = S.draw;
      if (!d) return;
      clearTimeout(d.t);
      const st = d.st;
      if (d.shape) { st.p = d.preview ? d.preview.p.slice() : [d.x0, d.y0, d.x0, d.y0]; }
      st.n = st.p.length / 2;
      S.draw = null;
      flushStroke(d, st, true);
      scheduleRedraw();
    }
    function flush() {
      const d = S.draw;
      if (!d) return;
      if (!d.shape) flushStroke(d, d.st, false);
      d.t = later(flush, 80);
    }
    /* send what has not gone yet, one batch per message; the final message of a stroke carries n */
    function flushStroke(d, st, final = false) {
      const total = st.p.length / 2, B = R.LIMITS.batch;
      const chunk = (from, to, last) => ({ tid: S.curTid, id: st.id, s: st.s, tool: st.tool, c: st.c, w: st.w, i: from, p: st.p.slice(from * 2, to * 2), ...(last ? { n: total } : {}) });
      if (!final) {
        while (d.sent < total) { const end = Math.min(total, d.sent + B); wire('sk', chunk(d.sent, end, false)); d.sent = end; }
        return;
      }
      if (d.sent >= total) { wire('sk', chunk(total, total, true)); return; }
      while (d.sent < total) { const end = Math.min(total, d.sent + B); wire('sk', chunk(d.sent, end, end === total)); d.sent = end; }
    }
    function clearBoard() {
      if (!iAmDrawer()) return;
      S.strokeCount++;
      const st = { id: `h${(++S.seq).toString(36)}`, s: S.seq, tool: 'clear', c: '#ffffff', w: 1, p: [], n: 0 };
      S.strokes.push(st); S.byId.set(st.id, st);
      wire('sk', { tid: S.curTid, id: st.id, s: st.s, tool: 'clear', c: '#ffffff', w: 1, i: 0, p: [], n: 0 });
      scheduleRedraw();
    }
    function resendAll() {
      const now = performance.now();
      if (now - S.resendAt < 2500) return;
      S.resendAt = now;
      let delay = 0;
      for (const st of S.strokes) {
        if (st.n === undefined) continue;
        for (let i = 0; i < st.n; i += R.LIMITS.batch) {
          const end = Math.min(st.n, i + R.LIMITS.batch), body = { tid: S.curTid, id: st.id, s: st.s, tool: st.tool, c: st.c, w: st.w, i, p: st.p.slice(i * 2, end * 2), ...(end === st.n ? { n: st.n } : {}) };
          later(() => wire('sk', body), delay);
          delay += 25;
        }
        if (!st.n) { const body = { tid: S.curTid, id: st.id, s: st.s, tool: st.tool, c: st.c, w: st.w, i: 0, p: [], n: 0 }; later(() => wire('sk', body), delay); delay += 25; }
      }
      sendWd();
    }
    S.resendAt = 0;

    cv.addEventListener('pointerdown', e => {
      if (e.button > 0 || !iAmDrawer()) return;
      snd.wake();
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      const [x, y] = logical(e);
      strokeStart(x, y);
    });
    cv.addEventListener('pointermove', e => { if (S.draw) { const [x, y] = logical(e); strokeMove(x, y); } });
    const up = () => strokeEnd();
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    /* ------------------------------ guessing ------------------------------ */
    async function sendGuess(text) {
      const st = S.st;
      text = cleanText(text, R.LIMITS.guessLen);
      if (!text || !st || st.ph !== 'draw' || st.dr === S.myId || !S.drawerPk || S.guessing) return false;
      const me0 = st.ros.find(r => r[0] === S.myId);
      if (!me0 || !me0[4] || S.got.has(S.myId)) return false;
      const now = performance.now();
      if (now - S.lastGuess < R.LIMITS.guessGapMs) { say('Slow down a little.'); return false; }
      S.lastGuess = now; S.guessing = true;
      const tid = st.tid;
      try {
        const mine = await crypto.subtle.generateKey(ECDH, false, ['deriveKey']);
        const pub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
        const theirs = await crypto.subtle.importKey('raw', unb64(S.drawerPk), ECDH, false, []);
        const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, mine.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const iv = rand(12);
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify({ t: text }))));
        if (!dead && S.curTid === tid) wire('gs', { tid, pk: b64(pub), iv: b64(iv), ct: b64(ct) });
      } catch (e) { say('Could not send that guess.'); } finally { S.guessing = false; }
      return true;
    }

    /* ------------------------------ finishing ------------------------------ */
    function finishSoon() {
      if (S.ended || S.endT) return;
      S.endT = later(() => {
        if (S.ended || dead || !S.st) return;
        S.ended = true;
        const ros = S.st.ros.slice().sort((a, b) => b[3] - a[3]);
        const mine = ros.find(r => r[0] === S.myId), top = ros[0] ? ros[0][3] : 0;
        const detail = `Final scores: ${ros.map(r => `${r[1]} ${r[3]}`).join(', ')}.`;
        ctx.onEnd({ score: mine ? mine[3] : 0, won: !!mine && mine[3] === top && top > 0, detail });
      }, reduced ? 1500 : 4000);
    }

    /* ------------------------------ the screens ------------------------------ */
    const notice = () => h('div.sk-fine', { text: 'This runs over a free public relay and every message is encrypted with the room code, so only people who have the code can read it. Share the code only with the players. Drawings and guesses stay in the room and are not saved anywhere.' });
    const ERRORS = {
      nobody: 'No room answered that code. Check it, or ask the host to make a new room.', full: 'That room is full (10 players).', removed: 'The host removed you from the room.',
      'host-left': 'The host left, so the room has closed.', lost: 'The host went quiet, so you left the room.', insecure: 'This browser can’t keep the room private (it needs a secure page), so rooms are off.',
    };

    function menuView() {
      const input = h('input', { type: 'text', placeholder: 'Room code', 'aria-label': 'Room code', maxlength: 24, autocomplete: 'off', spellcheck: 'false', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); joinNow(); } } });
      const joinNow = () => {
        const code = normalizeCode(input.value);
        if (!isCode(code)) { err.textContent = 'That isn’t a room code (6 letters and numbers).'; return; }
        S.role = 'guest'; S.code = code; S.error = ''; S.myId = S.myId || sessionId(); connect();
      };
      const err = h('div.sk-err', { role: 'alert', text: S.error ? ERRORS[S.error] || '' : '' });
      return h('div.sk-menu', h('div.sk-card',
        h('h2', { text: 'Sketch & Guess' }),
        h('div', { text: 'Take turns drawing a secret word while your friends guess it. Two to ten players, each on their own device.' }),
        h('div.arx-bg__row', button('Make a room', 'plus', () => { S.role = 'host'; S.code = randomCode(); S.error = ''; connect(); }, { 'data-sk': 'make' })),
        h('div.sk-join', input, button('Join', 'arrow-right', joinNow, { 'data-sk': 'join' })),
        err, notice()));
    }
    function waitView(text) {
      return h('div.sk-menu', h('div.sk-card', h('h2', { text }), h('div', { text: S.code ? `Room ${S.code}` : '' }),
        button('Cancel', 'x', () => leave(), { 'data-sk': 'cancel' }), notice()));
    }
    function closedView() {
      return h('div.sk-menu', h('div.sk-card', h('h2', { text: 'Room closed' }), h('div.sk-err', { role: 'alert', text: ERRORS[S.error] || 'The room closed.' }),
        button('Back', 'arrow-left', () => leave(), { 'data-sk': 'back' })));
    }
    function leave() {
      teardownNet(true);
      S.phase = 'menu'; S.role = null; S.engine = null; S.st = null; S.hostId = null; S.welcomed = false; S.stCount = 0; S.curTid = ''; S.mine = null; S.strokes = []; S.byId = new Map();
      S.feed = []; S.got = new Set(); S.key = null; S.topic = null; S.code = ''; S.error = ''; S.draw = null; S.pattern = null; S.drawerPk = null; S.revealed = null;
      S.outq = Promise.resolve(); S.inq = Promise.resolve();
      render();
    }

    /* the room: the table on the left, the scoreboard on the right */
    const tools = h('div.sk-tools');
    const wordEl = h('div.sk-word', { 'aria-live': 'polite' });
    const timerEl = h('span.sk-timer');
    const guessInput = h('input', { type: 'text', maxlength: 60, 'aria-label': 'Your guess', placeholder: 'Type your guess', autocomplete: 'off', spellcheck: 'false', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submitGuess(); } } });
    const guessBtn = button('Guess', 'send', () => submitGuess(), { 'data-sk': 'guess' });
    const guessBar = h('div.sk-guess', guessInput, guessBtn);
    function submitGuess() { const v = guessInput.value; if (!v.trim()) return; guessInput.value = ''; sendGuess(v); guessInput.focus({ preventScroll: true }); }
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const rosEl = h('ul.sk-ros', { 'aria-label': 'Players' });
    const feedEl = h('div.sk-feed', { 'aria-label': 'Guesses', role: 'log' });
    const optsEl = h('div.arx-bg__row');
    const startBtn = button('Start game', 'play', () => { if (S.engine?.start()) { publishState(); } }, { 'data-sk': 'start' });
    const leaveBtn = button('Leave room', 'arrow-left', () => leave(), { 'data-sk': 'leave' });
    const skipBtn = button('Skip word', 'refresh', () => skipWord(), { 'data-sk': 'skip', title: 'Pick another word (before you draw anything)' });
    const codeEl = h('div.sk-code', { 'aria-label': 'Room code' });
    const stageEl = h('div.sk-stage', paper);
    const main = h('div.sk-main', h('div', wordEl), stageEl, tools, guessBar);
    const side = h('div.arx-bg__side', h('div.arx-bg__row', h('b', { text: 'Room' }), timerEl), codeEl, statusEl, optsEl, rosEl, feedEl, h('div.arx-bg__row', startBtn, skipBtn, leaveBtn), notice());
    const roomView = h('div.arx-bg', h('div.arx-bg__board', main), side);
    let segRounds = null, segTime = null, toolsKey = '';

    function buildTools() {
      const key = `${S.tool}|${S.color}|${S.size}`;
      if (key === toolsKey) return;
      toolsKey = key;
      tools.replaceChildren(
        ...TOOLS.map(([id, label, k]) => h('button.arx-bg__btn', { type: 'button', 'aria-pressed': String(S.tool === id), title: `${label} (${k})`, onclick: () => { S.tool = id; render(true); }, text: label })),
        ...COLORS.map(c => h('button.sk-sw', { type: 'button', style: { background: c }, 'aria-label': `Colour ${c}`, 'aria-pressed': String(S.color === c), onclick: () => { S.color = c; if (S.tool === 'eraser') S.tool = 'brush'; render(true); } })),
        ...SIZES.map(sz => h('button.arx-bg__btn', { type: 'button', 'aria-pressed': String(S.size === sz), title: `Size ${sz}`, onclick: () => { S.size = sz; render(true); }, text: sz === 3 ? 'Thin' : sz === 7 ? 'Medium' : 'Thick' })),
        h('button.arx-bg__btn', { type: 'button', title: 'Clear the drawing (C)', onclick: () => clearBoard(), text: 'Clear' }));
    }

    function leftMs() { const st = S.st; return st && st.ph === 'draw' ? Math.max(0, st.left - (performance.now() - S.stAt)) : 0; }
    const clock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

    function renderRoom() {
      const st = S.st, host = S.role === 'host';
      const lobby = !st || st.ph === 'lobby';
      codeEl.textContent = S.code;
      codeEl.hidden = !lobby;
      const row = st?.ros.find(r => r[0] === S.myId);
      const drawing = iAmDrawer();
      const guessing = !!st && st.ph === 'draw' && !drawing && !!row && !!row[4];
      /* status */
      let text;
      if (!st) text = 'Connecting…';
      else if (st.ph === 'lobby') text = st.why === 'few' ? 'Not enough players left. Waiting for more.' : host ? (st.ros.length < 2 ? 'Waiting for friends. Share the code.' : 'Ready when you are.') : 'Waiting for the host to start.';
      else if (st.ph === 'end') text = 'Game over';
      else if (st.ph === 'reveal') text = S.revealed ? `The word was “${S.revealed}”` : st.why === 'left' ? 'The drawer left. Next turn…' : 'Time’s up';
      else text = drawing ? 'You’re drawing. Don’t say the word!' : `${nameOfId(st.dr)} is drawing`;
      if (st && st.ph !== 'lobby' && st.ph !== 'end') text += ` · round ${Math.min(st.rd, st.nrd)} of ${st.nrd}`;
      statusEl.textContent = text;
      statusEl.classList.toggle('is-done', st?.ph === 'end');
      /* the word line */
      let word = '';
      if (drawing && S.mine) word = S.mine.word.toUpperCase();
      else if (st && st.ph === 'draw' && S.pattern) word = S.pattern.map(n => Array(n).fill('_').join(' ')).join('   ');
      else if (st && st.ph === 'reveal' && S.revealed) word = S.revealed.toUpperCase();
      wordEl.textContent = word;
      wordEl.setAttribute('aria-label', drawing ? `Your word: ${S.mine?.word}` : word ? `Word has ${(S.pattern || []).join(' and ')} letters` : '');
      /* timer */
      timerEl.textContent = st && st.ph === 'draw' ? clock(leftMs()) : '';
      /* canvas modes */
      paper.classList.toggle('is-draw', drawing);
      cv.setAttribute('aria-label', drawing ? 'Drawing canvas: draw with the mouse or finger' : 'The drawing so far');
      tools.hidden = !drawing;
      if (drawing) buildTools();
      guessBar.hidden = !guessing || S.got.has(S.myId);
      guessInput.disabled = guessBar.hidden;
      if (st && st.ph === 'draw' && !drawing && row && !row[4]) text = 'You joined mid-game: you’ll play from the next round.';
      if (st && st.ph === 'draw' && !drawing && row && !row[4]) statusEl.textContent = text;
      if (guessing && S.got.has(S.myId)) statusEl.textContent = 'You got it! Wait for the others.';
      skipBtn.hidden = !(drawing && S.mine && !S.strokes.length && S.mine.skips < 3);
      /* host options and the start button */
      startBtn.hidden = !(host && lobby && st);
      startBtn.disabled = !(st && st.ros.length >= 2);
      optsEl.hidden = !(host && lobby && S.engine);
      if (host && lobby && S.engine) {
        const o = S.engine.options();
        if (!segRounds) {
          segRounds = segment('Rounds', R.LIMITS.roundChoices.map(id => ({ id, label: String(id) })), o.rounds, v => { S.engine.setOptions({ rounds: v }); segRounds.set(v); publishState(); });
          segTime = segment('Turn', R.LIMITS.turnChoices.map(id => ({ id, label: `${id / 1000}s` })), o.turnMs, v => { S.engine.setOptions({ turnMs: v }); segTime.set(v); publishState(); });
          optsEl.append(segRounds.el, segTime.el);
        } else { segRounds.set(o.rounds); segTime.set(o.turnMs); }
      }
      /* the scoreboard */
      const items = (st ? st.ros : []).slice().sort((a, b) => b[3] - a[3] || 0);
      rosEl.replaceChildren(...items.map(r => {
        const isDr = !!st && st.ph !== 'lobby' && st.dr === r[0] && st.ph !== 'end';
        const note = r[0] === S.myId ? 'you' : r[0] === S.hostId ? 'host' : '';
        const li = h('li', { class: `${isDr ? 'is-draw' : ''} ${r[5] ? 'is-got' : ''}`.trim(), dataset: { pid: r[0] } },
          h('span.dot', { style: { background: `hsl(${r[2]} 80% 58%)` } }),
          h('b', { text: r[1] }),
          h('small', { text: [isDr ? 'drawing' : '', r[5] && st.ph !== 'lobby' ? 'got it' : '', !r[4] && st && st.ph !== 'lobby' ? 'next round' : '', note].filter(Boolean).join(' · ') }),
          h('b', { text: String(r[3]) }));
        if (host && r[0] !== S.myId) li.append(button('Remove', 'x', () => removePlayer(r[0]), { title: `Remove ${r[1]} from the room`, 'aria-label': `Remove ${r[1]}` }));
        return li;
      }));
      /* guesses: text only, and only from people still in the room */
      const shown = S.feed.filter(f => !f.pid || (st && st.ros.some(r => r[0] === f.pid)));
      feedEl.replaceChildren(...shown.slice(-30).map(f => {
        const d = h('div', { class: f.kind === 'ok' ? 'ok' : '' });
        d.textContent = f.kind === 'guess' ? `${nameOfId(f.pid)}: ${f.txt}` : f.txt;
        return d;
      }));
      feedEl.scrollTop = feedEl.scrollHeight;
      ctx.onScore(S.myScore);
    }

    let lastPhase = '';
    function render(soft) {
      if (dead) return;
      if (S.phase === 'room') {
        if (lastPhase !== 'room') { root.replaceChildren(h('style', { text: KIT_CSS + CSS }), roomView, sr); scheduleRedraw(); }
        lastPhase = 'room';
        renderRoom();
        return;
      }
      if (soft && lastPhase === S.phase && S.phase !== 'menu' && S.phase !== 'closed') return;
      lastPhase = S.phase;
      const view = S.phase === 'menu' ? menuView() : S.phase === 'closed' ? closedView()
        : waitView(S.phase === 'connecting' ? (S.lastLive === 'live' || S.lastLive === 'connecting' ? 'Connecting…' : 'Waiting for the public relay…') : 'Looking for the room…');
      root.replaceChildren(h('style', { text: KIT_CSS + CSS }), view, sr);
      /* only the room-code box takes focus by itself: a focused button would act on the Enter that just got us here */
      if (S.phase === 'menu') view.querySelector('input')?.focus({ preventScroll: true });
    }

    /* the timer on screen counts down between the host's updates */
    S.tickT = setInterval(() => { if (!dead && S.phase === 'room' && S.st?.ph === 'draw') timerEl.textContent = clock(leftMs()); }, 250);

    /* keys: the drawer can draw with the keyboard; everyone else types guesses in the box */
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.phase !== 'room' || !iAmDrawer()) return;
      const k = e.key;
      const step = e.shiftKey ? 24 : 8;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      if (move) {
        e.preventDefault();
        S.pen.x = Math.max(0, Math.min(R.CANVAS.w, S.pen.x + move[0])); S.pen.y = Math.max(0, Math.min(R.CANVAS.h, S.pen.y + move[1]));
        if (S.pen.down) strokeMove(S.pen.x, S.pen.y);
        return;
      }
      if (k === ' ' || k === 'Enter') { e.preventDefault(); if (S.pen.down) { S.pen.down = false; strokeEnd(); } else if (strokeStart(S.pen.x, S.pen.y)) S.pen.down = true; return; }
      if (k === 'c' || k === 'C') { e.preventDefault(); clearBoard(); return; }
      const t = TOOLS.find(x => x[2].toLowerCase() === k.toLowerCase());
      if (t) { e.preventDefault(); S.tool = t[0]; render(true); }
    };
    window.addEventListener('keydown', onKey);

    S.myId = sessionId();
    render();

    return {
      stop() {
        dead = true;
        if (S.key && S.phase === 'room') { try { wire('bye'); } catch (e) { /* closing */ } }
        teardownNet(false);
        clearInterval(S.tickT);
        if (S.redrawQ) cancelAnimationFrame(S.redrawQ);
        window.removeEventListener('keydown', onKey);
        snd.close();
        root.remove();
      },
      peek: () => {
        const st = S.st;
        return {
          phase: S.phase, role: S.role, code: S.code, error: S.error, me: S.myId, hostId: S.hostId, live: S.lastLive,
          ph: st ? st.ph : null, tid: st ? st.tid : null, drawer: st ? st.dr : null, isDrawer: iAmDrawer(), round: st ? st.rd : 0, rounds: st ? st.nrd : 0, why: st ? st.why : null,
          ros: st ? st.ros.map(r => ({ pid: r[0], name: r[1], score: r[3], active: !!r[4], got: !!r[5] })) : [],
          word: iAmDrawer() && S.mine ? S.mine.word : null, pattern: S.pattern, revealed: S.revealed, hasKey: !!S.drawerPk,
          feed: S.feed.map(f => ({ kind: f.kind, pid: f.pid || null, txt: f.txt })), strokes: S.strokes.length, left: Math.round(leftMs()),
          guessVisible: !guessBar.hidden, toolsVisible: !tools.hidden, startVisible: !startBtn.hidden, status: statusEl.textContent, ended: S.ended,
          stats: { dropped: S.dropped, rejected: S.rejected }, wordShown: wordEl.textContent, myScore: S.myScore, removeButtons: [...rosEl.querySelectorAll('button')].length,
        };
      },
      /* test hook, inert unless a test calls it: record what arrives (decrypted JSON text), or send a raw object as-is */
      hook: cmd => {
        if (cmd && cmd.record) S.rec = [];
        if (cmd && cmd.reveal && S.engine) S.engine.testReveal(cmd.reveal);
        if (cmd && cmd.dump) return S.rec ? S.rec.slice() : null;
        if (cmd && cmd.raw && S.key) { const text = JSON.stringify(cmd.raw); const topic = S.topic, key = S.key; S.outq = S.outq.then(async () => live.publish(topic, await seal(key, text))); }
        if (cmd && cmd.send && S.key) wire(cmd.send.t, cmd.send.body || {});
        return true;
      },
    };
  },
};
