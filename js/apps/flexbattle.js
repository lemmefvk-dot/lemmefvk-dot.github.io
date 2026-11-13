/* ============================================================
   flexbattle.js — Flex Battle: two friends on camera and mic show off
   an item each, three rounds. A still from your own camera goes to an
   AI that GUESSES what the item is and roughly what it's worth; the
   guesses are added up and the higher total wins "by the AI's guesses".
   It is a game for fun: a photo can't prove something is real, no
   price here is a measurement, and nothing is ever "verified".

   FRIENDS ONLY. Two people meet with a room code (core/pair.js, kind
   'flex'). There is no lobby of strangers, no matching and no "next".
   Video and sound go device to device through core/avlink.js (the same
   camera and microphone link Watch Together uses: public STUN only, no
   relay, so on some networks it won't connect). Cameras and microphones
   are off until you press them. Nothing is recorded or saved.

   EACH SNAPSHOT NEEDS TWO TAPS. "Flex it" grabs a frame from your own
   camera into a preview on your screen only. "Send to the AI" is a
   second, explicit tap, next to the line saying where the photo goes.
   Nothing leaves the device before it. The photo goes straight from
   this browser to the model host chosen in Settings → AI model (llm.js);
   that model must be able to see pictures (aimodel.visionCheck), or the
   game says so and links to Settings instead of pretending. Snapshots
   live in memory only and are dropped when the round ends.

   WHO ASKS THE AI. Each device asks about its own photo and tells the
   room the result (vd: what, low, high, confidence); both sides add up
   the same guesses. The friend sees a frame of your video taken when you
   pressed send (the photo itself never crosses the room). This is a game
   between friends, not a ledger: a device could report something else.

   SAFETY. The judge rates objects only: when the model says the main
   subject is a person, face, body, document, screen, weapon, drugs,
   alcohol or money, the round is skipped ("Only items can be flexed")
   and nothing is scored. The prompt forbids comments about people.
   Chat has a short word filter (./flexfilter.js). Either player can end
   the match or leave at any time.

   MESSAGES (validated in ./flexrules.js): chat · msig and av (the
   camera link, as in Watch Together) · go (host starts) · fx { r } (I
   sent my photo) · vd { r, k, what, lo, hi, cf } (my guess) · end ·
   rm (rematch).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { openPair, iceServers } from '../core/pair.js';
import { isCode, normalizeCode, spaced, cleanText } from '../core/roomcode.js';
import { createAv } from '../core/avlink.js';
import { me } from '../core/identity.js';
import * as llm from '../portal/llm.js';
import * as AIM from '../portal/aimodel.js';
import * as F from './flexrules.js';
import { blocked, MESSAGE as KEEP_PLAYFUL } from './flexfilter.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-together-css')) {
  const l = document.createElement('link');
  l.id = 'feat-together-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-together.css';
  document.head.appendChild(l);
}

const CHAT_KEEP = 200;
const CHAT_BURST = 5;
const CHAT_WINDOW = 5000;
const RESEND = 3000;
const SNAP_W = 640;
const JOIN_ERR = {
  invalid: 'That isn’t a room code: codes are 6 letters and numbers, like K7QM2X.',
  nobody: 'No Flex Battle room answered that code. Check it, and that your friend still has the room open.',
  full: 'That room already has two people.',
  insecure: 'Flex Battle needs a secure (https) page for its encryption.',
};
const MEDIA_ERR = {
  NotAllowedError: kind => `Permission to use the ${kind} was refused. Allow it for this site in your browser’s settings, then press the button again.`,
  SecurityError: kind => `Permission to use the ${kind} was refused. Allow it for this site in your browser’s settings, then press the button again.`,
  NotFoundError: kind => `No ${kind} was found on this device.`,
  OverconstrainedError: kind => `No ${kind} was found that can do that.`,
  NotReadableError: kind => `The ${kind} is busy: another app may be using it.`,
};
const mediaErr = (kind, err) => (MEDIA_ERR[err?.name] || (() => `The ${kind} couldn’t be turned on.`))(kind);
const errText = e => (e && e.code === 'busy' ? 'The free model is busy right now. Try again in a few seconds.'
  : e && e.code === 'offline' ? `The AI can’t be reached. ${e.message || ''}`.trim()
  : e && e.message ? String(e.message) : 'The AI could not answer.').slice(0, 240);

const CSS = `
.fx{display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-4);min-height:0;overflow:auto;font-size:var(--fs-12);color:var(--ink-1)}
.fx [hidden]{display:none!important}
.fx h2{margin:0;font:800 var(--fs-16,16px)/1.2 var(--font,system-ui);color:var(--ink-0)}
.fx-fine{color:var(--ink-3);font-size:var(--fs-11);line-height:1.45;margin:0}
.fx-cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)}
.fx-col{display:flex;flex-direction:column;gap:var(--sp-2);min-width:0}
.fx-tile{position:relative;aspect-ratio:16/9;border-radius:var(--r-md,11px);overflow:hidden;background:#111;border:1px solid var(--line-1)}
.fx-tile video{width:100%;height:100%;object-fit:cover;display:block}
.fx-tile--me video{transform:scaleX(-1)}
.fx-tile .fx-who{position:absolute;left:6px;bottom:6px;padding:1px 7px;border-radius:99px;background:rgba(0,0,0,.55);color:#fff;font-weight:700}
.fx-tile .fx-off{position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-3);text-align:center;padding:8px}
.fx-card{display:flex;flex-direction:column;gap:5px;padding:9px;border-radius:12px;background:var(--fill-1);border:1px solid var(--line-1);min-height:74px}
.fx-card.is-win{border-color:#ffd666;box-shadow:0 0 18px -6px #ffd666}
.fx-card img{width:100%;max-height:150px;object-fit:contain;border-radius:8px;background:#000}
.fx-guess{color:var(--ink-0);font-weight:650}
.fx-tot{color:var(--ink-2);font-weight:700}
.fx-panel{display:flex;flex-direction:column;gap:var(--sp-2);padding:10px;border-radius:12px;background:var(--fill-0);border:1px solid var(--line-0)}
.fx-panel img{max-width:min(100%,320px);border-radius:8px;background:#000;align-self:flex-start}
.fx-row{display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center}
.fx-warn{color:#ffd666;font-weight:650}
.fx-err{color:#ffb3bf;font-weight:650}
.fx-win{display:flex;flex-direction:column;gap:6px;align-items:center;text-align:center;padding:14px;border-radius:16px;background:linear-gradient(160deg,rgba(255,214,102,.18),rgba(255,120,200,.12));border:1px solid #ffd666}
.fx-win .big{font:900 var(--fs-22,22px)/1 var(--font,system-ui);letter-spacing:.12em;color:#ffd666}
.fx-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;text-align:left;width:100%}
.fx-list li{padding:4px 8px;border-radius:8px;background:var(--fill-0)}
@container (max-width:520px){.fx-cols{grid-template-columns:1fr}}
`;

defineApp({
  id: 'flex-battle',
  name: 'Flex Battle',
  icon: 'camera',
  g1: '#ffb347', g2: '#e0306a',
  category: 'Media',
  keywords: ['flex', 'larp', 'show off', 'battle', 'friend', 'camera', 'ai', 'guess', 'value', 'game', 'room', 'code'],
  desc: 'Show a friend your coolest item on camera and let an AI guess what it is worth',
  singleton: true,
  win: { w: 1020, h: 640, minW: 600, minH: 460 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon } = api;
    let recapMs = 7000;

    const S = {
      dead: false, room: null, roomOffs: [], err: '', joinCode: '',
      chat: [], chatSent: [], g: null, flex: { stage: 'idle', url: '', err: '', need: null }, ctl: null, peerSending: -1,
    };
    const fresh = () => ({ phase: 'lobby', round: 1, mine: [null, null, null], theirs: [null, null, null], snapM: [null, null, null], snapT: [null, null, null], recapUntil: 0, ended: '', rmMe: false, rmThem: false });
    S.g = fresh();
    const A = {
      av: null, cam: null, mic: null, camHidden: false, muted: false, busy: { cam: false, mic: false }, err: '', canRetry: false, link: 'idle',
      remote: { cam: 0, mic: 0 }, stream: new MediaStream(), lastSent: 0, needTap: false,
    };

    /* ---------- the page ---------- */
    root.appendChild(h('style', { text: CSS }));
    const selfVideo = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Your camera' });
    selfVideo.muted = true;
    const remoteVideo = h('video', { playsinline: true, autoplay: true, 'aria-label': 'Your friend’s camera' });
    remoteVideo.srcObject = A.stream;
    const selfOff = h('div.fx-off', { text: 'Your camera is off' });
    const friendOff = h('div.fx-off', { text: 'Their camera is off' });
    const selfName = h('span.fx-who', { text: 'You' }), friendName = h('span.fx-who');
    const selfRec = h('i.wt-rec', { title: 'Your camera is on', hidden: true });
    const meTile = h('div.fx-tile.fx-tile--me', { dataset: { tile: 'me' } }, selfVideo, selfOff, selfName, selfRec);
    const frTile = h('div.fx-tile', { dataset: { tile: 'friend' } }, remoteVideo, friendOff, friendName);
    const meCard = h('div.fx-card', { dataset: { card: 'me' } }), frCard = h('div.fx-card', { dataset: { card: 'friend' } });
    const cols = h('div.fx-cols', h('div.fx-col', meTile, meCard), h('div.fx-col', frTile, frCard));

    const roomBar = h('div.wt-room');
    const camBtn = h('button.btn.btn--sm.wt-cam', { type: 'button', 'aria-pressed': 'false', onclick: () => (A.cam ? turnOff('cam') : turnOn('cam')) }, icon('video'), h('span', { text: 'Camera' }));
    const micBtn = h('button.btn.btn--sm.wt-mic', { type: 'button', 'aria-pressed': 'false', onclick: () => (A.mic ? turnOff('mic') : turnOn('mic')) }, icon('mic'), h('span', { text: 'Mic' }));
    const camHideBtn = h('button.btn.btn--sm.wt-camhide', { type: 'button', hidden: true, onclick: () => { A.camHidden = !A.camHidden; if (A.cam) A.cam.enabled = !A.camHidden; sendAv(); paint(); } });
    const muteMicBtn = h('button.btn.btn--sm.wt-micmute', { type: 'button', hidden: true, onclick: () => { A.muted = !A.muted; if (A.mic) A.mic.enabled = !A.muted; sendAv(); paint(); } });
    const avStatus = h('span.wt-av__st', { role: 'status' });
    const avNote = h('p.wt-av__note.wt-headphones', { hidden: true, text: 'Use headphones so your friend doesn’t hear themselves echo.' });
    const avErr = h('div.wt-av__err', { role: 'alert', hidden: true });
    const avPrivacy = h('p.wt-av__note.wt-privacy', { text: 'Video and sound go directly between your two devices, not through StaticOS, and your friend’s device can see your network address. Nothing is recorded or saved.' });
    const avBar = h('div.wt-av', { hidden: true }, camBtn, micBtn, camHideBtn, muteMicBtn, avStatus, avNote, avErr, avPrivacy);

    const intro = h('div.fx-panel', { dataset: { fx: 'intro' } },
      h('h2', 'Flex Battle'),
      h('div', { text: 'Show off an item on camera. An AI guesses what each item is and roughly what it’s worth; the guesses are added up and the bigger total wins, by the AI’s guesses. 3 rounds, for fun.' }),
      h('p.fx-fine', { text: 'Friends only: start a room and give your friend the code, or type theirs. There is no matching with strangers. Your cameras and mics stay off until you press them. On some networks the video won’t connect, because StaticOS has no relay server for it; chat and the game still work.' }));
    const lobby = h('div.fx-panel', { dataset: { fx: 'lobby' }, hidden: true });
    const play = h('div.fx-panel', { dataset: { fx: 'play' }, hidden: true });
    const head = h('div.fx-row');
    const panel = h('div.fx-row', { dataset: { fx: 'panel' } });
    play.append(head, panel);
    const end = h('div.fx-win', { dataset: { fx: 'end' }, hidden: true });
    const gameFine = h('p.fx-fine', { text: 'Each photo is sent to the AI only after you tap “Send to the AI”. Snapshots stay in memory and are dropped when the round ends. The AI only guesses; ' + F.GUESS_LINE });

    const log = h('ul.wt-log', { 'aria-label': 'Chat', 'aria-live': 'polite' });
    const chatIn = h('input.wt-chat__in', { type: 'text', maxlength: String(F.CHAT_MAX), placeholder: 'Say something…', 'aria-label': 'Chat message', autocomplete: 'off' });
    const chatForm = h('form.wt-chat', { onsubmit: e => { e.preventDefault(); sendChat(); } }, chatIn, h('button.ibtn', { type: 'submit', 'aria-label': 'Send' }, icon('send')));
    const side = h('aside.wt-side',
      h('div.wt-side__h', icon('message-circle'), h('b', { text: 'Chat' })), log, chatForm,
      h('p.wt-fine', { text: 'Flex Battle runs over StaticOS’s live connection, a free public server. Messages are sealed with the room code, but anyone who has the code can join and read the chat, so treat it like a password. Names aren’t verified.' }));
    const main = h('div.fx', roomBar, avBar, intro, lobby, cols, play, end, gameFine);
    root.appendChild(h('div.app.app--col', h('div.wt', main, side)));
    cols.hidden = true; gameFine.hidden = true;

    /* ---------- helpers ---------- */
    const paired = () => !!S.room && S.room.phase === 'paired';
    const peerName = () => S.room?.peer?.name || 'Your friend';
    const myName = () => me().name;
    const g = () => S.g;
    function sys(text) { addChat({ sys: true, text }); }
    function addChat(m) {
      S.chat.push(m);
      if (S.chat.length > CHAT_KEEP) S.chat.shift();
      const li = m.sys ? h('li.wt-msg.wt-msg--sys', { text: m.text })
        : h('li.wt-msg', { dataset: { me: m.me ? '1' : '' } }, h('b.wt-msg__who', { style: { '--h': String(m.hue ?? 200) }, text: m.who }), h('span.wt-msg__tx', { text: m.text }));
      log.appendChild(li);
      while (log.children.length > CHAT_KEEP) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    function sendChat() {
      const tx = cleanText(chatIn.value, F.CHAT_MAX);
      if (!tx) return;
      if (!paired()) { sys('Chat goes to your friend once they’ve joined the room.'); return; }
      if (blocked(tx)) { sys(KEEP_PLAYFUL); return; }
      const now = Date.now();
      S.chatSent = S.chatSent.filter(t => now - t < CHAT_WINDOW);
      if (S.chatSent.length >= CHAT_BURST) { sys('Slow down a little: a few messages every few seconds.'); return; }
      if (!S.room.send('chat', { tx })) { sys('That message couldn’t be sent: the live server isn’t answering.'); return; }
      S.chatSent.push(now);
      addChat({ who: 'You', me: true, text: tx });
      chatIn.value = '';
    }

    /* ---------- the room ---------- */
    function openRoom(role, code) {
      closeRoom(false);
      S.err = '';
      const room = openPair({ kind: 'flex', role, code, types: F.TYPES, rtc: false });
      S.room = room;
      if (room.phase === 'closed') { S.err = JOIN_ERR[room.error] || JOIN_ERR.nobody; S.room = null; paint(); return; }
      S.roomOffs = [room.on((type, data) => {
        if (S.dead || S.room !== room) return;
        if (type === 'phase') { if (data === 'closed' && room.error) { S.err = JOIN_ERR[room.error] || JOIN_ERR.nobody; closeRoom(false); } paint(); }
        else if (type === 'peer') { sys(role === 'host' ? `${data.name} joined` : `You joined ${data.name}’s room`); paint(); }
        else if (type === 'left') { sys(data.reason === 'quiet' ? `Lost touch with ${data.peer?.name || 'your friend'}` : `${data.peer?.name || 'Your friend'} left`); closeRoom(false); paint(); }
        else if (type === 'msg') onMsg(data);
      })];
      paint();
    }
    function closeRoom(sayBye = true) {
      stopAv();
      endGame();
      S.roomOffs.forEach(f => f());
      S.roomOffs = [];
      if (S.room) { try { S.room.leave(); } catch (e) { /* gone */ } }
      S.room = null;
      void sayBye;
    }
    function endGame() {
      try { S.ctl?.abort(); } catch (e) { /* done */ }
      S.ctl = null;
      S.g = fresh();
      S.flex = { stage: 'idle', url: '', err: '', need: null };
      S.peerSending = -1;
    }
    /* snapshots are dropped when their round ends, and all of them when the match does */
    function dropSnaps(r) { if (r === undefined) { S.g.snapM = [null, null, null]; S.g.snapT = [null, null, null]; } else { S.g.snapM[r] = null; S.g.snapT[r] = null; } }

    function onMsg({ t, m }) {
      const G = g();
      if (t === 'chat') { addChat({ who: peerName(), hue: S.room?.peer?.color, text: blocked(m.tx) ? '[hidden: that word isn’t allowed here]' : m.tx }); return; }
      if (t === 'msig') { if (paired()) { if (!A.av) makeAv(); A.av.handle(m); } return; }
      if (t === 'av') { A.remote = m; paint(); return; }
      if (t === 'go') { if (S.room?.role === 'guest' && G.phase === 'lobby') begin(); return; }
      if (t === 'fx') {
        if (G.phase !== 'play' || G.theirs[m.r - 1] || m.r < G.round) return;
        S.peerSending = m.r;
        G.snapT[m.r - 1] = grab(remoteVideo, 320, 0.7);
        paint();
        return;
      }
      if (t === 'vd') {
        if (G.phase !== 'play' || G.theirs[m.r - 1]) return;
        const { r, ...v } = m;
        G.theirs[r - 1] = F.cleanVerdict(v);
        if (S.peerSending === r) S.peerSending = -1;
        paint();
        return;
      }
      if (t === 'end') { if (G.phase === 'play') { G.phase = 'end'; G.ended = 'them'; dropSnaps(); paint(); } return; }
      if (t === 'rm') { G.rmThem = true; if (G.phase === 'end' && G.rmMe) rematch(); else paint(); }
    }

    /* ---------- the game ---------- */
    function begin() { S.g = { ...fresh(), phase: 'play' }; S.flex = { stage: 'idle', url: '', err: '', need: null }; S.peerSending = -1; paint(); }
    function startMatch() { if (S.room?.role !== 'host' || !paired() || g().phase !== 'lobby') return; S.room.send('go'); begin(); }
    function endMatch() { if (g().phase !== 'play') return; if (paired()) S.room.send('end'); g().phase = 'end'; g().ended = 'me'; dropSnaps(); try { S.ctl?.abort(); } catch (e) { /* done */ } S.flex = { stage: 'idle', url: '', err: '', need: null }; paint(); }
    function askRematch() { g().rmMe = true; if (paired()) S.room.send('rm'); if (g().rmThem) rematch(); else paint(); }
    function rematch() { begin(); }
    const done = r => !!(g().mine[r - 1] && g().theirs[r - 1]);
    function tick() {
      const G = g();
      if (G.phase !== 'play') return;
      if (done(G.round)) {
        if (!G.recapUntil) { G.recapUntil = performance.now() + recapMs; paint(); }
        else if (performance.now() >= G.recapUntil) {
          dropSnaps(G.round - 1);
          G.recapUntil = 0;
          if (G.round >= F.ROUNDS) { G.phase = 'end'; G.ended = ''; dropSnaps(); } else G.round++;
          S.flex = { stage: 'idle', url: '', err: '', need: null };
          paint();
        }
      }
      if (G.recapUntil) paintPanel();
      if (paired() && performance.now() - A.lastSent > RESEND) sendAv();
    }
    function grab(video, width, q) {
      try {
        if (!video || !video.videoWidth) return null;
        const w = Math.min(width, video.videoWidth), hh = Math.round(w * video.videoHeight / video.videoWidth);
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        c.getContext('2d').drawImage(video, 0, 0, w, hh);
        return c.toDataURL('image/jpeg', q);
      } catch (e) { return null; }
    }
    async function flexIt() {
      const G = g();
      if (G.phase !== 'play' || G.mine[G.round - 1] || S.flex.stage === 'sending') return;
      S.flex = { stage: 'checking', url: '', err: '', need: null }; paintPanel();
      const ctl = new AbortController();
      let v = null;
      try { v = await AIM.visionCheck({ signal: ctl.signal }); } catch (e) { return; }
      if (S.dead) return;
      if (!v.ok) { S.flex = { stage: 'idle', url: '', err: '', need: v }; paintPanel(); return; }
      if (!A.cam || A.camHidden) { S.flex = { stage: 'idle', url: '', err: 'Turn your camera on and showing first.', need: null }; paintPanel(); return; }
      const url = grab(selfVideo, SNAP_W, 0.8);
      if (!url) { S.flex = { stage: 'idle', url: '', err: 'Your camera isn’t ready yet. Try again in a second.', need: null }; paintPanel(); return; }
      S.flex = { stage: 'preview', url, err: '', need: null }; paintPanel();
    }
    async function sendToAi() {
      const G = g(), r = G.round;
      if (S.flex.stage !== 'preview' || G.mine[r - 1]) return;
      const url = S.flex.url;
      S.flex = { stage: 'sending', url, err: '', need: null };
      G.snapM[r - 1] = url;
      paintPanel();
      if (paired()) S.room.send('fx', { r });
      const ctl = S.ctl = new AbortController();
      let v = null, err = '';
      try { v = F.parseJudge(await llm.stream(F.judgeMessages(url), { signal: ctl.signal })); if (!v) err = 'The AI’s answer couldn’t be read.'; }
      catch (e) { if (e.name !== 'AbortError') err = errText(e); else return; }
      if (S.dead || g() !== G || G.phase !== 'play' || G.round !== r) return;
      if (!v) { S.flex = { stage: 'preview', url, err, need: null }; paint(); return; }
      G.mine[r - 1] = v;
      S.flex = { stage: 'idle', url: '', err: '', need: null };
      if (paired()) S.room.send('vd', { r, ...v });
      paint();
    }
    function retake() { if (S.flex.stage === 'preview') { S.flex = { stage: 'idle', url: '', err: '', need: null }; paintPanel(); } }
    function pass() {
      const G = g(), r = G.round;
      if (G.phase !== 'play' || G.mine[r - 1] || S.flex.stage === 'sending') return;
      G.mine[r - 1] = { k: 'pass' };
      if (paired()) S.room.send('vd', { r, k: 'pass' });
      S.flex = { stage: 'idle', url: '', err: '', need: null };
      paint();
    }

    /* ---------- camera and microphone (the same link as Watch Together) ---------- */
    function makeAv() {
      A.av = createAv({
        send: body => !!S.room && S.room.send('msig', body),
        polite: S.room?.role === 'guest',
        ice: iceServers,
        h: {
          onReset: () => { try { A.stream.getTracks().forEach(t => A.stream.removeTrack(t)); } catch (e) { /* gone */ } },
          onTrack: track => {
            if (S.dead) return;
            A.stream.addTrack(track);
            track.addEventListener('ended', () => { try { A.stream.removeTrack(track); } catch (e) { /* gone */ } });
            const p = remoteVideo.play();
            if (p && p.catch) p.catch(() => { if (S.dead) return; remoteVideo.muted = true; remoteVideo.play().catch(() => {}); A.needTap = true; paint(); });
            paint();
          },
          onLink: (state, why) => {
            if (S.dead) return;
            A.link = state;
            if (state === 'failed') { A.err = `The camera and microphone couldn’t connect directly (${why || 'no direct path'}). Some networks block direct connections between two devices, and StaticOS has no relay server for video. Chat still works.`; A.canRetry = true; }
            else if (state === 'connected') { A.err = ''; A.canRetry = false; sendAv(); }
            paint();
          },
        },
      });
    }
    function sendAv() { A.lastSent = performance.now(); if (paired()) S.room.send('av', { cam: A.cam ? (A.camHidden ? 2 : 1) : 0, mic: A.mic ? (A.muted ? 2 : 1) : 0 }); }
    async function turnOn(kind) {
      const word = kind === 'cam' ? 'camera' : 'microphone';
      if (!paired() || A[kind] || A.busy[kind]) return;
      A.err = ''; A.canRetry = false;
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') { A.err = `This browser can’t reach a ${word} here (it needs a secure page).`; paint(); return; }
      A.busy[kind] = true; paint();
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(kind === 'cam'
          ? { video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }, audio: false }
          : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (err) { A.err = mediaErr(word, err); }
      A.busy[kind] = false;
      if (!stream) { if (!S.dead) paint(); return; }
      const track = (kind === 'cam' ? stream.getVideoTracks() : stream.getAudioTracks())[0];
      stream.getTracks().forEach(t => { if (t !== track) t.stop(); });
      if (S.dead || !paired() || !track) { track?.stop(); if (!S.dead) { if (!track) A.err = `No ${word} was found on this device.`; paint(); } return; }
      track.addEventListener('ended', () => { if (A[kind] === track && !S.dead) { turnOff(kind); A.err = `Your ${word} stopped (it may have been unplugged).`; paint(); } });
      A[kind] = track;
      if (kind === 'cam') { A.camHidden = false; selfVideo.srcObject = new MediaStream([track]); selfVideo.play().catch(() => {}); } else A.muted = false;
      if (!A.av) makeAv(); else if (A.link === 'failed') A.av.retry();
      A.av.setTrack(kind === 'cam' ? 'video' : 'audio', track);
      sendAv(); paint();
    }
    function turnOff(kind) {
      const t = A[kind];
      A[kind] = null;
      if (kind === 'cam') { A.camHidden = false; selfVideo.srcObject = null; } else A.muted = false;
      try { t?.stop(); } catch (e) { /* gone */ }
      try { A.av?.setTrack(kind === 'cam' ? 'video' : 'audio', null); } catch (e) { /* gone */ }
      sendAv(); paint();
    }
    function stopAv() {
      for (const k of ['cam', 'mic']) { try { A[k]?.stop(); } catch (e) { /* gone */ } A[k] = null; }
      A.camHidden = false; A.muted = false;
      selfVideo.srcObject = null;
      try { A.av?.close(); } catch (e) { /* gone */ }
      A.av = null; A.link = 'idle'; A.err = ''; A.canRetry = false; A.needTap = false; A.remote = { cam: 0, mic: 0 };
      try { A.stream.getTracks().forEach(t => A.stream.removeTrack(t)); } catch (e) { /* gone */ }
      remoteVideo.muted = false;
      if (!S.dead) paint();
    }

    /* ---------- painting ---------- */
    function verdictLines(v, who) {
      if (!v) return [h('span.fx-fine', { text: who ? `${who} hasn’t flexed yet.` : '…' })];
      if (v.k === 'skip') return [h('span.fx-warn', { text: 'Only items can be flexed. Nothing was scored.' })];
      if (v.k === 'pass') return [h('span.fx-fine', { text: 'Passed this round.' })];
      return [h('span.fx-guess', { text: `AI guess: ${v.what}, roughly ${F.range(v.lo, v.hi)}, confidence ${v.cf}` }), h('span.fx-fine', { text: F.GUESS_LINE })];
    }
    const tot = list => F.totals(list);
    function paintCards() {
      const G = g(), r = G.round, nm = peerName();
      const card = (el, mine) => {
        const v = (mine ? G.mine : G.theirs)[r - 1];
        const img = (mine ? G.snapM : G.snapT)[r - 1];
        const t = tot(mine ? G.mine : G.theirs);
        const kids = [];
        if (G.phase === 'play') {
          kids.push(h('span.fx-tot', { text: `The AI’s guesses added up: ${t.n ? F.range(t.lo, t.hi) : '$0'}` }));
          if (img) kids.push(h('img', { src: img, alt: mine ? 'Your snapshot' : `A frame of ${nm}’s video when they sent it` }));
          else if (!mine && S.peerSending === r) kids.push(h('span.fx-fine', { text: `${nm} is sending a photo to the AI…` }));
          kids.push(...verdictLines(v, mine ? '' : nm));
        } else kids.push(h('span.fx-fine', { text: 'Waiting for the match to start.' }));
        el.replaceChildren(...kids);
      };
      card(meCard, true); card(frCard, false);
    }
    function paintPanel() {
      const G = g(), r = G.round, nm = peerName();
      head.replaceChildren(h('b', { text: `Round ${r} of ${F.ROUNDS}` }),
        h('span.fx-tot', { text: `Totals so far, the AI’s guesses added up: you ${tot(G.mine).n ? F.range(tot(G.mine).lo, tot(G.mine).hi) : '$0'} · ${nm} ${tot(G.theirs).n ? F.range(tot(G.theirs).lo, tot(G.theirs).hi) : '$0'}`, dataset: { fx: 'totals' } }));
      const kids = [];
      const F1 = S.flex;
      if (G.recapUntil) {
        const s = Math.max(0, Math.ceil((G.recapUntil - performance.now()) / 1000));
        kids.push(h('span', { role: 'status', text: r >= F.ROUNDS ? `Totals in ${s}…` : `Next round in ${s}…` }));
      } else if (G.mine[r - 1]) {
        kids.push(h('span', { role: 'status', text: `Waiting for ${nm} to flex…` }));
      } else if (F1.need) {
        kids.push(h('div.fx-err', { role: 'alert', text: 'Pick a model that can see pictures in Settings › AI model.' }),
          h('span.fx-fine', { text: `${F1.need.unknown ? 'The model list couldn’t be checked. ' : ''}The chosen model (${F1.need.name}, at ${F1.need.host}) isn’t listed as taking images, so no photo is taken or sent.` }),
          h('div.fx-row',
            h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fx: 'settings' }, onclick: () => api.openApp('settings', { section: 'ai' }) }, icon('settings'), h('span', { text: 'Open Settings › AI model' })),
            h('button.btn.btn--sm', { type: 'button', dataset: { fx: 'recheck' }, onclick: () => { AIM.forgetLists(); S.flex = { stage: 'idle', url: '', err: '', need: null }; flexIt(); } }, h('span', { text: 'Check again' }))));
      } else if (F1.stage === 'preview' || F1.stage === 'sending') {
        kids.push(h('img', { src: F1.url, alt: 'Preview of your snapshot', dataset: { fx: 'preview' } }),
          h('span.fx-warn', { dataset: { fx: 'consent' }, text: `This photo will be sent to ${AIM.describe().host}. Keep faces, addresses and screens out of frame.` }),
          h('div.fx-row',
            h('button.btn.btn--primary', { type: 'button', dataset: { fx: 'send' }, disabled: F1.stage === 'sending', onclick: sendToAi }, icon('send'), h('span', { text: F1.stage === 'sending' ? 'Asking the AI…' : 'Send to the AI' })),
            h('button.btn', { type: 'button', dataset: { fx: 'retake' }, disabled: F1.stage === 'sending', onclick: retake }, h('span', { text: 'Retake' }))));
        if (F1.err) kids.push(h('div.fx-err', { role: 'alert', text: F1.err }));
      } else {
        const camOk = !!A.cam && !A.camHidden;
        kids.push(h('button.btn.btn--primary', { type: 'button', dataset: { fx: 'flex' }, disabled: !camOk || F1.stage === 'checking', onclick: flexIt }, icon('camera'), h('span', { text: F1.stage === 'checking' ? 'Checking the model…' : 'Flex it' })),
          h('span.fx-fine', { text: camOk ? 'Hold one item up to the camera, then tap Flex it to preview a snapshot. Nothing is sent yet.' : 'Turn your camera on first.' }),
          h('button.btn.btn--sm', { type: 'button', dataset: { fx: 'pass' }, onclick: pass }, h('span', { text: 'Pass this round' })));
        if (F1.err) kids.push(h('div.fx-err', { role: 'alert', text: F1.err }));
      }
      kids.push(h('button.btn.btn--sm', { type: 'button', dataset: { fx: 'endmatch' }, onclick: endMatch }, h('span', { text: 'End the match' })));
      panel.replaceChildren(...kids);
    }
    function paintEnd() {
      const G = g(), nm = peerName();
      const a = tot(G.mine), b = tot(G.theirs), w = F.winner(G.mine, G.theirs);
      const kids = [h('div.big', { text: w === 'tie' ? 'TOO CLOSE TO CALL' : 'WINNER' })];
      if (w !== 'tie') kids.push(h('b', { text: `${w === 'me' ? myName() : nm} by the AI’s guesses` }));
      if (G.ended) kids.push(h('span.fx-fine', { text: `${G.ended === 'me' ? 'You' : nm} ended the match early, so these are the totals so far.` }));
      kids.push(h('span', { text: `${myName()}: the AI’s guesses added up to ${a.n ? F.range(a.lo, a.hi) : '$0'}` }),
        h('span', { text: `${nm}: the AI’s guesses added up to ${b.n ? F.range(b.lo, b.hi) : '$0'}` }),
        h('span.fx-fine', { text: 'Totals are the AI’s guesses added up, not real values. ' + F.GUESS_LINE }));
      const rows = [];
      for (let i = 0; i < F.ROUNDS; i++) for (const [who, v] of [[myName(), G.mine[i]], [nm, G.theirs[i]]]) {
        if (!v) continue;
        rows.push(h('li', { text: `Round ${i + 1}, ${who}: ` + (v.k === 'ok' ? `AI guess: ${v.what}, roughly ${F.range(v.lo, v.hi)}, confidence ${v.cf}` : v.k === 'skip' ? 'Only items can be flexed (nothing scored)' : 'passed') }));
      }
      kids.push(h('ul.fx-list', { 'aria-label': 'Every guess' }, rows));
      kids.push(h('div.fx-row',
        h('button.btn.btn--primary', { type: 'button', dataset: { fx: 'rematch' }, disabled: G.rmMe || !paired(), onclick: askRematch }, h('span', { text: G.rmMe ? `Waiting for ${nm}…` : G.rmThem ? `${nm} wants a rematch: accept` : 'Rematch' })),
        h('button.btn', { type: 'button', dataset: { fx: 'leave' }, onclick: () => { sys('You left the room'); closeRoom(true); paint(); } }, h('span', { text: 'Leave' }))));
      end.replaceChildren(...kids);
      end.dataset.winner = w;
    }
    function paintRoom() {
      const room = S.room, kids = [];
      if (!room) {
        const input = h('input.wt-code-in', { type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Friend’s code', 'aria-label': 'Room code from your friend', value: S.joinCode || '' });
        kids.push(h('button.btn.btn--primary.wt-start', { type: 'button', dataset: { fx: 'start-room' }, onclick: () => openRoom('host') }, icon('users'), h('span', { text: 'Start a room' })),
          h('span.wt-or', { text: 'or' }),
          h('form.wt-join', { onsubmit: e => { e.preventDefault(); const c = normalizeCode(input.value); S.joinCode = c; if (!isCode(c)) { S.err = JOIN_ERR.invalid; paint(); return; } openRoom('guest', c); } },
            input, h('button.btn', { type: 'submit', dataset: { fx: 'join' } }, h('span', { text: 'Join' }))));
        if (S.err) kids.push(h('p.wt-err', { role: 'alert', text: S.err }));
      } else {
        const ph = room.phase;
        if (room.role === 'host') kids.push(h('span.wt-room__k', { text: 'Room' }), h('span.wt-code', { 'aria-label': `Room code ${spaced(room.code)}`, dataset: { code: room.code } }, [...room.code].map(c => h('span', { text: c, 'aria-hidden': 'true' }))));
        else kids.push(h('span.wt-room__k', { text: `Room ${room.code}` }));
        kids.push(h('span.wt-room__st', { dataset: { phase: ph }, text: ph === 'paired' ? `With ${peerName()}` : ph === 'waiting' ? 'Waiting for your friend…' : ph === 'joining' ? 'Joining…' : 'Connecting…' }),
          h('button.btn.btn--sm.wt-leave', { type: 'button', dataset: { fx: 'leave-room' }, onclick: () => { sys('You left the room'); closeRoom(true); paint(); } }, h('span', { text: 'Leave' })));
      }
      roomBar.replaceChildren(...kids);
    }
    function paintAv() {
      const on = paired();
      avBar.hidden = !on;
      const mic = !!A.mic, cam = !!A.cam;
      camBtn.setAttribute('aria-pressed', String(cam)); micBtn.setAttribute('aria-pressed', String(mic));
      camBtn.lastChild.textContent = A.busy.cam ? 'Camera…' : cam ? 'Stop camera' : 'Camera';
      micBtn.lastChild.textContent = A.busy.mic ? 'Mic…' : mic ? 'Stop mic' : 'Mic';
      camBtn.disabled = A.busy.cam; micBtn.disabled = A.busy.mic;
      camHideBtn.hidden = !cam; muteMicBtn.hidden = !mic;
      camHideBtn.textContent = A.camHidden ? 'Show my camera' : 'Camera off';
      muteMicBtn.textContent = A.muted ? 'Unmute my mic' : 'Mute my mic';
      camHideBtn.setAttribute('aria-pressed', String(A.camHidden)); muteMicBtn.setAttribute('aria-pressed', String(A.muted));
      const parts = [];
      if (cam) parts.push(A.camHidden ? 'Your camera is on but hidden (sending black)' : 'Your camera is on');
      if (mic) parts.push(A.muted ? 'Your mic is on but muted' : 'Your mic is on');
      const live = cam || mic, nm = peerName(), rs = [];
      if (A.remote.cam) rs.push(A.remote.cam === 2 ? 'camera off' : 'camera on');
      if (A.remote.mic) rs.push(A.remote.mic === 2 ? 'muted' : 'mic on');
      if (rs.length) parts.push(`${nm}: ${rs.join(', ')}`);
      avStatus.replaceChildren(...(live ? [h('i.wt-rec')] : []), h('span', { text: parts.length ? parts.join(' · ') : 'Camera and mic are off' }));
      avStatus.dataset.cam = String(cam ? (A.camHidden ? 2 : 1) : 0); avStatus.dataset.mic = String(mic ? (A.muted ? 2 : 1) : 0); avStatus.dataset.link = A.link;
      avNote.hidden = !(mic || A.remote.mic);
      avErr.replaceChildren(...(A.err ? [h('span', { text: A.err }), A.canRetry ? h('button.btn.btn--sm.wt-avretry', { type: 'button', onclick: () => { A.err = ''; A.canRetry = false; A.av?.retry(); paint(); } }, h('span', { text: 'Try again' })) : null].filter(Boolean) : []));
      if (A.needTap) avErr.append(h('button.btn.btn--sm.wt-hear', { type: 'button', onclick: () => { remoteVideo.muted = false; remoteVideo.play().catch(() => {}); A.needTap = false; paint(); } }, h('span', { text: `Hear ${nm}` })));
      avErr.hidden = !(A.err || A.needTap);
      selfOff.hidden = cam && !A.camHidden; selfRec.hidden = !cam;
      const showFriend = A.remote.cam === 1 && A.stream.getVideoTracks().length > 0;
      friendOff.hidden = showFriend; friendName.textContent = nm;
    }
    function paint() {
      if (S.dead) return;
      const G = g(), pr = paired();
      paintRoom(); paintAv();
      intro.hidden = !!S.room;
      cols.hidden = !pr; gameFine.hidden = !pr;
      lobby.hidden = !(pr && G.phase === 'lobby');
      play.hidden = !(pr && G.phase === 'play');
      end.hidden = !(pr && G.phase === 'end');
      if (!lobby.hidden) {
        const host = S.room.role === 'host', both = !!A.cam && !A.camHidden && A.remote.cam === 1;
        lobby.replaceChildren(h('h2', { text: `You and ${peerName()}` }),
          h('div', { text: 'Each of you: press Camera to turn your camera on (and Mic if you want to talk). Then the host starts three rounds: in each, hold up one item, tap Flex it, check the preview, and send it to the AI.' }),
          host ? h('button.btn.btn--primary', { type: 'button', dataset: { fx: 'start' }, disabled: !both, onclick: startMatch }, icon('play'), h('span', { text: both ? 'Start the match' : 'Waiting for both cameras…' }))
            : h('span', { role: 'status', text: 'Waiting for the host to start…' }));
      }
      if (!play.hidden) { paintPanel(); }
      if (!end.hidden) paintEnd();
      paintCards();
    }
    paint();
    const tickT = setInterval(() => { if (!S.dead) tick(); }, 250);
    const peek = () => {
      const G = g();
      return {
        phase: S.room?.phase || 'none', role: S.room?.role || null, code: S.room?.code || null, topic: S.room?.topic || null, game: G.phase, round: G.round, ended: G.ended,
        mine: G.mine, theirs: G.theirs, snapM: G.snapM.map(x => !!x), snapT: G.snapT.map(x => !!x), flex: { stage: S.flex.stage, err: S.flex.err, need: !!S.flex.need },
        totals: { me: tot(G.mine), them: tot(G.theirs) }, winner: G.phase === 'end' ? F.winner(G.mine, G.theirs) : null, peerSending: S.peerSending,
        chat: S.chat.map(m => (m.sys ? `· ${m.text}` : `${m.who}: ${m.text}`)), stats: S.room?.stats?.() || null,
        av: { cam: !!A.cam, mic: !!A.mic, camHidden: A.camHidden, muted: A.muted, link: A.link, err: A.err, remote: { ...A.remote }, remoteVideoTracks: A.stream.getVideoTracks().length },
        recap: !!G.recapUntil,
      };
    };
    const el = root.querySelector('.fx');
    el.fxPeek = peek;
    el.fxRoom = () => S.room;                 /* play-tests only */
    el.fxHook = cmd => { if (cmd && cmd.recapMs) recapMs = cmd.recapMs; return true; };

    return () => {
      S.dead = true;
      clearInterval(tickT);
      closeRoom(true);
    };
  },
});
