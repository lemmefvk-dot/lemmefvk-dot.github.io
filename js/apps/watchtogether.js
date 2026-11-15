/* ============================================================
   watchtogether.js — Watch Together: play a video in sync with a
   friend on another StaticOS, with a small chat beside it.

   What it can honestly sync: a video both of you have.
     · the StaticOS videos in ~/Videos, recognised by which shipped
       file they are (asset:<path>);
     · any other video file, recognised by the SHA-256 of its bytes —
       if your friend doesn't have it, "Send it with Drop" hands it
       over with Static Drop first (they still accept it themselves).
   What it can't: anime and films in Static Watch play inside other
   sites' players. Some of them post where they are to StaticOS (that
   is how Watch's "Continue watching" knows a minute), but none take
   play, pause or seek commands from it, so they can't be kept in
   step. The picker says so instead of pretending.

   How: a room (core/pair.js, kind 'watch') carries small sealed
   messages — which video, play/pause/seek records, chat. Video bytes
   never travel. Either person can play, pause or seek; each press is
   a new shared record (core/watchsync.js) and both players follow
   it. Every 300 ms each side compares its <video> with where the
   record says it should be (using the measured clock offset between
   the two devices) and seeks when they are more than 0.5 s apart.
   The host picks the video.

   Messages, each validated: pick { cid, n, d, s } (host) · have
   { cid, ok } (guest) · st { ver, play, pos, at } · chat { tx }
   (≤ 300 characters, no control or bidi characters, 5 per 5 s) ·
   drop { code } (host: "I'm sending you this video with Drop").
   Added: pick may carry cid "yt:<11-char id>" (a YouTube video, see
   core/ytsync.js — controlled over postMessage, no YouTube script
   loaded) · msig { g, sdp | ice } and av { cam, mic } for the optional
   camera and microphone (core/avlink.js: a second peer connection,
   negotiated through the room; off until a person presses Camera or
   Mic; never recorded; no relay server).

   Added in the bulk update:
     · free films: an Internet Archive film as cid "ia:<identifier>" (pick carries
       fn, the file name; the envelope's own f is the sender). Both devices stream the same file from archive.org; nothing
       is sent between them but the id. The licence the uploader stated is shown.
     · Invite a friend: the room code goes down the private friend channel
       (core/friendinvite.js). They press Join; nothing opens by itself.
     · reactions (rx), a ready check (rc: ask · yes · no · go) and "host controls
       only" (hc), which the host's device enforces.
     · a shared queue: the host owns the list (ql); a guest asks to add (qa).
     · each person's own subtitle file, kept on their device only.
     · shared playback speed (the record carries rate).
     · an unread badge for a hidden chat, and Copy chat.
     · push-to-talk: with it on, the mic is sent only while the key is held.

   opts: { path } loads that video · { join: CODE } fills the code.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as live from '../portal/live.js';
import { openPair } from '../core/pair.js';
import { isCode, normalizeCode, spaced, cleanText } from '../core/roomcode.js';
import * as W from '../core/watchsync.js';
import * as YT from '../core/ytsync.js';
import { createAv, checkSig } from '../core/avlink.js';
import { iceServers } from '../core/pair.js';
import { invitePanel } from '../core/friendinvite.js';
import { srtToVtt, pickVideo, looksAdult, plain, rightsOf, searchUrl, fmtRun, runtimeSecs } from './watch-films.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-together-css')) {
  const l = document.createElement('link');
  l.id = 'feat-together-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-together.css';
  document.head.appendChild(l);
}

const TICK = 300;
const RESEND = 3000;
const CHAT_MAX = 300;
const CHAT_KEEP = 200;
const CHAT_BURST = 5;                 /* messages … */
const CHAT_WINDOW = 5000;             /* … per this many ms */
const LIVE_TEXT = {
  idle: 'Not connected yet',
  connecting: 'Connecting to the shared room service…',
  live: 'Connected to the shared room service (a free public broker)',
  offline: 'Can’t reach the shared room service — this network may block it. Trying again…',
};
const JOIN_ERR = {
  invalid: 'That isn’t a room code — codes are 6 letters and numbers, like K7QM2X.',
  nobody: 'No Watch Together room answered that code. Check it, and that your friend still has the room open.',
  full: 'That room already has two people.',
  insecure: 'Watch Together needs a secure (https) page for its encryption.',
};
const fmtTime = s => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const IA = 'https://archive.org';
const RX = ['👍', '😂', '😮', '❤️', '👏', '😢'];
const QUEUE_MAX = 10;
const SUB_MAX = 2 * 1024 * 1024;
const PTT_KEYS = [['KeyT', 'T'], ['KeyV', 'V'], ['KeyB', 'B'], ['Backquote', '` (backtick)']];
const iaUrl = (id, file) => `${IA}/download/${encodeURIComponent(id)}/${String(file).split('/').map(encodeURIComponent).join('/')}`;
const qItem = m => (m && typeof m.cid === 'string' && W.CID_RE.test(m.cid)
  ? { cid: m.cid, n: cleanText(m.n, 120) || 'video', ...(Number.isSafeInteger(m.s) && m.s >= 0 ? { s: m.s } : {}) } : null);
const inviteLink = code => { try { return `${location.origin}${location.pathname}#watch=${code}`; } catch (e) { return ''; } };

const TYPES = {
  pick: m => (typeof m.cid === 'string' && W.CID_RE.test(m.cid) ? {
    cid: m.cid, n: cleanText(m.n, 120) || 'video',
    d: Number.isFinite(m.d) && m.d > 0 && m.d <= 86400 ? m.d : null,
    s: Number.isSafeInteger(m.s) && m.s >= 0 ? m.s : null,
    fn: typeof m.fn === 'string' && m.cid.startsWith('ia:') ? (cleanText(m.fn, 200) || null) : null,
  } : null),
  have: m => (typeof m.cid === 'string' && W.CID_RE.test(m.cid) && typeof m.ok === 'boolean' ? { cid: m.cid, ok: m.ok } : null),
  st: m => W.checkState(m),
  chat: m => { const tx = cleanText(m.tx, CHAT_MAX); return tx ? { tx } : null; },
  drop: m => (isCode(m.code) ? { code: m.code } : null),
  rx: m => (RX.includes(m.e) ? { e: m.e } : null),
  rc: m => (['ask', 'yes', 'no', 'go'].includes(m.k) && Number.isInteger(m.id) && m.id >= 0 && m.id < 1e9 ? { k: m.k, id: m.id } : null),
  hc: m => (typeof m.on === 'boolean' ? { on: m.on } : null),
  ql: m => (Array.isArray(m.items) && m.items.length <= QUEUE_MAX ? { items: m.items.map(qItem).filter(Boolean) } : null),
  qa: m => qItem(m),
  msig: checkSig,
  av: m => (Number.isInteger(m.cam) && Number.isInteger(m.mic) && m.cam >= 0 && m.cam <= 2 && m.mic >= 0 && m.mic <= 2 ? { cam: m.cam, mic: m.mic } : null),
};
const MEDIA_ERR = {
  NotAllowedError: kind => `Permission to use the ${kind} was refused. Allow it for this site in your browser’s settings, then press the button again.`,
  SecurityError: kind => `Permission to use the ${kind} was refused. Allow it for this site in your browser’s settings, then press the button again.`,
  NotFoundError: kind => `No ${kind} was found on this device.`,
  OverconstrainedError: kind => `No ${kind} was found that can do that.`,
  NotReadableError: kind => `The ${kind} is busy — another app may be using it.`,
};
const mediaErr = (kind, err) => (MEDIA_ERR[err?.name] || (() => `The ${kind} couldn’t be turned on.`))(kind);

defineApp({
  id: 'watch-together',
  name: 'Watch Together',
  icon: 'users',
  g1: '#ffb36b', g2: '#e0306a',
  category: 'Media',
  keywords: ['watch party', 'together', 'sync', 'friend', 'video', 'movie night', 'chat', 'room', 'code'],
  desc: 'Play a video in sync with a friend, with chat beside it',
  singleton: true,
  win: { w: 960, h: 600, minW: 560, minH: 420 },
  shortcuts: [
    ['Space / K', 'Play or pause (for both of you)'],
    ['Left / Right', 'Back / forward 5 seconds'],
    ['T', 'Hold to talk, when push-to-talk is on (or your own key)'],
  ],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, notify } = api;

    const S = {
      dead: false,
      room: null, roomOffs: [],
      role: 'host',                          /* while alone you are your own host */
      cur: null,                             /* { path, name, cid, size } — the loaded video */
      want: null,                            /* guest: the host's pick { cid, n, d, s } */
      missing: false, finding: false,
      peerHas: null,                         /* host: did the guest say they have it */
      offer: null,                           /* guest: { code } a Drop on its way */
      st: W.fresh(),
      blocked: false,
      resyncs: 0,
      chat: [],
      chatSent: [],
      picking: true,
      joinCode: '',
      err: '',
      lastResend: 0,
      yt: null, ytErr: '', ytTry: 0,         /* a YouTube video (core/ytsync.js adapter) */
      ytMsg: '',
      iaMsg: '', iaBusy: false, iaHits: null, iaQ: '',   /* a film from the Internet Archive */
      hostOnly: false,                       /* the host decides play, pause and seek */
      rc: null, rcId: 0,                     /* a ready check: { id, asker, mine, theirs, until } */
      queue: [],                             /* the shared queue, the host's copy is the real one */
      unread: 0, chatOpen: true,
      sub: null,                             /* this person's own subtitle file { name, url } */
      invite: null, inviteOpen: false,
      ptt: { on: false, key: 'KeyT', down: false },
    };
    const prefsW = () => api.store.get('prefs.watchTogether') || {};
    S.ptt.on = !!prefsW().ptt; S.ptt.key = PTT_KEYS.some(k => k[0] === prefsW().pttKey) ? prefsW().pttKey : 'KeyT';
    const flies = new Set();
    const A = {                              /* camera and microphone (core/avlink.js) */
      av: null, cam: null, mic: null, camHidden: false, muted: false,
      busy: { cam: false, mic: false }, err: '', canRetry: false, link: 'idle',
      remote: { cam: 0, mic: 0 }, stream: new MediaStream(), lastSent: 0, needTap: false,
    };
    const pl = () => S.yt || video;           /* what is playing: the YouTube adapter or the <video> */

    /* ---------- DOM ---------- */
    const video = h('video.wt-video', { playsinline: true, preload: 'auto', 'aria-label': 'Video' });
    const stageMsg = h('div.wt-stage__msg');
    const blockedBtn = h('button.btn.btn--primary.wt-unblock', { type: 'button', hidden: true, onclick: () => { S.blocked = false; blockedBtn.hidden = true; tick(); } }, icon('play', { fill: true }), h('span', { text: 'Press to join in' }));
    /* the two small camera tiles, over a corner of the player */
    const selfVideo = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Your camera' });
    selfVideo.muted = true;
    const remoteVideo = h('video', { playsinline: true, autoplay: true, 'aria-label': 'Your friend’s camera' });
    remoteVideo.srcObject = A.stream;
    const selfRec = h('i.wt-rec.wt-tile__rec', { title: 'Your camera is on' });
    const selfTile = h('div.wt-tile.wt-tile--me', { hidden: true, dataset: { tile: 'me' } }, selfVideo, selfRec, h('span.wt-tile__n', { text: 'You' }));
    const friendName = h('span.wt-tile__n');
    const friendMute = h('span.wt-tile__mute', { text: 'muted', hidden: true });
    const friendTile = h('div.wt-tile', { hidden: true, dataset: { tile: 'friend' } }, remoteVideo, friendName, friendMute);
    const moveBtn = h('button.wt-tiles__move', { type: 'button', 'aria-label': 'Move the video tiles to the next corner', title: 'Move to the next corner', onclick: () => cycleCorner() }, '⇲');
    const tiles = h('div.wt-tiles', { hidden: true, dataset: { corner: 'br' } }, selfTile, friendTile, moveBtn);
    const stage = h('div.wt-stage', { tabindex: '0', role: 'region', 'aria-label': 'Player' }, video, stageMsg, blockedBtn, tiles);

    const playBtn = h('button.ibtn.wt-play', { type: 'button', 'aria-label': 'Play', onclick: () => togglePlay() }, icon('play', { fill: true }));
    const backBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Back 10 seconds', 'data-tip': 'Back 10 s', onclick: () => seekBy(-10) }, icon('rotate-ccw'));
    const fwdBtn = h('button.ibtn.tip.wt-fwd', { type: 'button', 'aria-label': 'Forward 10 seconds', 'data-tip': 'Forward 10 s', onclick: () => seekBy(10) }, icon('rotate-ccw'));
    const seekIn = h('input.slider.wt-seek', { type: 'range', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'Seek' });
    const timeEl = h('span.wt-time', { text: '0:00 / 0:00' });
    const muteBtn = h('button.ibtn.wt-mute', { type: 'button', 'aria-label': 'Mute', 'aria-pressed': 'false', onclick: () => { video.muted = !video.muted; paintCtl(); } }, icon('volume-2'));
    const rateSel = h('select.wt-rate', { 'aria-label': 'Playback speed (for both of you)', title: 'Playback speed, shared: both players change together', onchange: e => setRate(Number(e.target.value)) },
      W.RATES.map(r => h('option', { value: String(r), text: `${r}×`, selected: r === 1 })));
    const subIn = h('input', { type: 'file', accept: '.vtt,.srt,text/vtt', hidden: true, 'aria-label': 'Choose a subtitle file', onchange: e => { loadSubs(e.target.files[0]); e.target.value = ''; } });
    const subBtn = h('button.ibtn.tip.wt-subs', { type: 'button', 'aria-label': 'Subtitles (your own file, only you see them)', 'data-tip': 'Subtitles', 'aria-pressed': 'false', onclick: () => { if (S.sub) clearSubs(); else subIn.click(); } }, icon('message-circle'));
    const ctl = h('div.wt-ctl', playBtn, backBtn, fwdBtn, seekIn, timeEl, rateSel, subBtn, subIn, muteBtn);
    const rxBar = h('div.wt-rx', { role: 'group', 'aria-label': 'Reactions' }, RX.map(e => h('button.wt-rx__b', { type: 'button', 'data-rx': e, 'aria-label': `React ${e}`, onclick: () => react(e) }, e)));
    const rcBar = h('div.wt-rc', { role: 'status', hidden: true });
    const queueEl = h('div.wt-queue', { 'aria-label': 'Shared queue', hidden: true });
    const credit = h('p.wt-credit', { hidden: true });
    const subNote = h('p.wt-fine', { hidden: true });

    const roomBar = h('div.wt-room');
    const hostOnlyBtn = h('label.wt-hostonly', { hidden: true }, h('input', { type: 'checkbox', 'data-wt': 'hostonly', onchange: e => setHostOnly(e.target.checked) }), h('span', { text: 'Only I control play, pause and seek' }));
    const readyBtn = h('button.btn.btn--sm.wt-ready', { type: 'button', hidden: true, onclick: () => askReady() }, icon('check'), h('span', { text: 'Ready check' }));
    const pickBtn = h('button.btn.btn--sm.wt-change', { type: 'button', onclick: () => { S.picking = !S.picking; paintStage(); } }, icon('film'), h('span', { text: 'Choose video' }));
    const titleEl = h('b.wt-title.trunc', { text: 'No video yet' });
    const friendLine = h('div.wt-friendline', { role: 'status' });

    /* camera and microphone controls — off until pressed */
    const camBtn = h('button.btn.btn--sm.wt-cam', { type: 'button', 'aria-pressed': 'false', onclick: () => (A.cam ? turnOff('cam') : turnOn('cam')) }, icon('video'), h('span', { text: 'Camera' }));
    const micBtn = h('button.btn.btn--sm.wt-mic', { type: 'button', 'aria-pressed': 'false', onclick: () => (A.mic ? turnOff('mic') : turnOn('mic')) }, icon('mic'), h('span', { text: 'Mic' }));
    const camHideBtn = h('button.btn.btn--sm.wt-camhide', { type: 'button', hidden: true, onclick: () => { A.camHidden = !A.camHidden; if (A.cam) A.cam.enabled = !A.camHidden; sendAv(); paintAv(); } });
    const muteMicBtn = h('button.btn.btn--sm.wt-micmute', { type: 'button', hidden: true, onclick: () => { A.muted = !A.muted; if (A.mic) A.mic.enabled = !A.muted && (!S.ptt.on || S.ptt.down); sendAv(); paintAv(); } });
    const avStatus = h('span.wt-av__st', { role: 'status' });
    const avNote = h('p.wt-av__note.wt-headphones', { hidden: true, text: 'Use headphones so your friend doesn’t hear themselves echo.' });
    const avErr = h('div.wt-av__err', { role: 'alert', hidden: true });
    const avPrivacy = h('p.wt-av__note.wt-privacy', { text: 'Video and sound go directly between your two devices, not through StaticOS, and your friend’s device can see your network address. Nothing is recorded or saved.' });
    const pttBox = h('label.wt-ptt', { hidden: true }, h('input', { type: 'checkbox', 'data-wt': 'ptt', checked: S.ptt.on, onchange: e => setPtt({ on: e.target.checked }) }), h('span', { text: 'Push to talk' }),
      h('select', { 'aria-label': 'Push-to-talk key', 'data-wt': 'pttkey', onchange: e => setPtt({ key: e.target.value }) }, PTT_KEYS.map(([c, l]) => h('option', { value: c, text: `hold ${l}`, selected: c === S.ptt.key }))));
    const avBar = h('div.wt-av', { hidden: true }, camBtn, micBtn, camHideBtn, muteMicBtn, pttBox, avStatus, avNote, avErr, avPrivacy);

    const log = h('ul.wt-log', { 'aria-label': 'Chat', 'aria-live': 'polite' });
    const chatIn = h('input.wt-chat__in', { type: 'text', maxlength: String(CHAT_MAX), placeholder: 'Say something…', 'aria-label': 'Chat message', autocomplete: 'off' });
    const chatForm = h('form.wt-chat', { onsubmit: e => { e.preventDefault(); sendChat(); } }, chatIn, h('button.ibtn', { type: 'submit', 'aria-label': 'Send' }, icon('send')));
    const liveEl = h('div.wt-live', { role: 'status' }, h('i.wt-dot'), h('span'));
    const unreadEl = h('span.wt-unread', { hidden: true, 'aria-live': 'polite' });
    const copyBtn = h('button.ibtn.tip.wt-copychat', { type: 'button', 'aria-label': 'Copy the chat', 'data-tip': 'Copy chat', onclick: () => copyChat() }, icon('copy'));
    const chatToggle = h('button.btn.btn--sm.wt-chattoggle', { type: 'button', 'aria-expanded': 'true', onclick: () => setChatOpen(!S.chatOpen) }, icon('message-circle'), h('span', { text: 'Chat' }), unreadEl);
    const side = h('aside.wt-side',
      h('div.wt-side__h', icon('message-circle'), h('b', { text: 'Chat' }), copyBtn),
      log, chatForm, liveEl,
      h('p.wt-fine', { text: 'Watch Together runs over StaticOS’s live connection, a free public server. Messages are sealed with the room code, but anyone who has the code can join and read the chat — treat it like a password. The video itself never leaves your device. Names aren’t verified.' }));

    const invHost = h('div.wt-invite', { hidden: true });
    const main = h('div.wt-main',
      roomBar,
      invHost,
      h('div.wt-head', titleEl, readyBtn, hostOnlyBtn, chatToggle, pickBtn),
      credit,
      friendLine,
      rcBar,
      queueEl,
      avBar,
      stage, rxBar, subNote, ctl);
    const wt = h('div.wt', main, side);
    root.appendChild(h('div.app.app--col', wt));

    /* ---------- helpers ---------- */
    const clock = () => (S.room ? S.room.now() : performance.timeOrigin + performance.now());
    const paired = () => !!S.room && S.room.phase === 'paired';
    const peerName = () => S.room?.peer?.name || 'Your friend';
    const dur = () => (Number.isFinite(pl().duration) && pl().duration > 0 ? pl().duration : (S.want?.d || Infinity));
    const hasVideo = () => !!S.cur && (S.yt ? S.yt.ready && !S.yt.error && !S.ytErr : !!video.currentSrc);

    function sys(text) { addChat({ sys: true, text }); }
    function addChat(m) {
      S.chat.push(m);
      if (S.chat.length > CHAT_KEEP) S.chat.shift();
      const li = m.sys
        ? h('li.wt-msg.wt-msg--sys', { text: m.text })
        : h('li.wt-msg', { dataset: { me: m.me ? '1' : '' } },
          h('b.wt-msg__who', { style: { '--h': String(m.hue ?? 200) }, text: m.who }),
          h('span.wt-msg__tx', { text: m.text }));
      log.appendChild(li);
      while (log.children.length > CHAT_KEEP) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
      if (!m.sys && !m.me && !S.chatOpen) { S.unread++; paintUnread(); }
    }
    function paintUnread() {
      unreadEl.hidden = !S.unread;
      unreadEl.textContent = S.unread ? String(S.unread > 99 ? '99+' : S.unread) : '';
      unreadEl.setAttribute('aria-label', S.unread ? `${S.unread} unread` : '');
      win.setSubtitle(subtitle());
    }
    function setChatOpen(on) {
      S.chatOpen = on;
      side.hidden = !on;
      wt.dataset.chat = on ? 'open' : 'closed';
      chatToggle.setAttribute('aria-expanded', String(on));
      if (on) { S.unread = 0; log.scrollTop = log.scrollHeight; }
      paintUnread();
    }
    async function copyChat() {
      const text = S.chat.map(m => (m.sys ? `· ${m.text}` : `${m.who}: ${m.text}`)).join('\n');
      if (!text) { notify({ app: 'Watch Together', icon: 'info', title: 'Nothing to copy yet', message: 'The chat is empty.' }); return; }
      try { await navigator.clipboard.writeText(text); notify({ app: 'Watch Together', icon: 'copy', title: 'Chat copied', message: `${S.chat.length} lines.` }); }
      catch (e) { notify({ app: 'Watch Together', icon: 'info', title: 'Couldn’t copy', message: 'Copying was blocked here.' }); }
    }
    const subtitle = () => `${paired() ? `with ${peerName()}` : S.room ? 'room open' : ''}${S.unread ? ` · ${S.unread} new` : ''}`.replace(/^ · /, '');
    function sendChat() {
      const tx = cleanText(chatIn.value, CHAT_MAX);
      if (!tx) return;
      if (!paired()) { sys('Chat goes to your friend once they’ve joined the room.'); return; }
      const now = Date.now();
      S.chatSent = S.chatSent.filter(t => now - t < CHAT_WINDOW);
      if (S.chatSent.length >= CHAT_BURST) { sys('Slow down a little — a few messages every few seconds.'); return; }
      if (!S.room.send('chat', { tx })) { sys('That message couldn’t be sent — the shared room service isn’t answering.'); return; }
      S.chatSent.push(now);
      const meName = api.store.get('session.user')?.name;
      addChat({ who: 'You', me: true, text: tx, hue: null, by: meName });
      chatIn.value = '';
    }

    /* ---------- the shared clock ---------- */
    const stBody = () => ({ ver: S.st.ver, play: S.st.play, pos: S.st.pos, at: S.st.at, ...(S.st.rate && S.st.rate !== 1 ? { rate: S.st.rate } : {}) });
    const blockedByHost = () => S.hostOnly && S.role === 'guest' && paired();
    function act(next, what) {
      if (blockedByHost()) { sys(`Only ${peerName()} controls playback right now.`); paintCtl(); return; }
      S.st = { ver: S.st.ver + 1, by: S.role, play: !!next.play, pos: Math.max(0, Math.min(next.pos, Number.isFinite(dur()) ? dur() : next.pos)), at: clock(), rate: next.rate ?? S.st.rate ?? 1 };
      S.lastResend = performance.now();
      if (paired()) S.room.send('st', stBody());
      if (what && paired()) sys(`You ${what}`);
      tick(true);
      paintCtl();
    }
    function togglePlay() {
      if (!hasVideo()) return;
      const pos = pl().currentTime;
      const ended = Number.isFinite(dur()) && pos >= dur() - 0.05;
      if (S.st.play && !ended) act({ play: false, pos }, `paused at ${fmtTime(pos)}`);
      else act({ play: true, pos: ended ? 0 : pos }, `pressed play at ${fmtTime(ended ? 0 : pos)}`);
    }
    function setRate(r) {
      if (!W.RATES.includes(r) || !hasVideo()) { paintCtl(); return; }
      act({ play: S.st.play, pos: pl().currentTime, rate: r }, `set the speed to ${r}×`);
    }
    function seekTo(t) {
      if (!hasVideo()) return;
      act({ play: S.st.play, pos: t }, `jumped to ${fmtTime(t)}`);
    }
    const seekBy = d => seekTo(Math.max(0, pl().currentTime + d));

    function tryPlay() {
      if (S.yt) {
        /* YouTube may refuse to start without a press; after a few seconds of asking, say so */
        S.ytTry = S.ytTry || performance.now();
        S.yt.play();
        if (performance.now() - S.ytTry > 4000 && !S.blocked) { S.blocked = true; blockedBtn.hidden = false; }
        return;
      }
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          if (S.dead) return;
          if (err && err.name === 'NotAllowedError') { S.blocked = true; blockedBtn.hidden = false; }
        });
      }
    }
    /* make the <video> match the shared record */
    function tick(now = false) {
      if (A.av || A.cam || A.mic || A.remote.cam || A.remote.mic) avTick();
      const p = pl();
      if (S.dead || !hasVideo() || p.readyState < 1) return;
      const exp = W.expected(S.st, clock(), dur());
      const atEnd = Number.isFinite(dur()) && exp >= dur() - 0.05;
      if (!S.yt && video.playbackRate !== (S.st.rate || 1)) video.playbackRate = S.st.rate || 1;
      if (atEnd && S.st.play && S.role === 'host' && S.queue.length && !S.adv) { S.adv = true; later(() => { S.adv = false; playNext(); }, 1500); }
      if (S.st.play && !atEnd) {
        if (p.paused) { if (!S.blocked) tryPlay(); } else S.ytTry = 0;
      } else { S.ytTry = 0; if (!p.paused) p.pause(); }
      if (!p.seeking && Math.abs(p.currentTime - exp) > (now ? 0.15 : W.DRIFT)) {
        try { p.currentTime = Math.min(exp + (S.st.play && !atEnd ? 0.05 : 0), Number.isFinite(dur()) ? dur() : exp); } catch (err) { /* not seekable yet */ }
        if (!now) S.resyncs++;
      }
      /* the host's choice of video is said again until the friend answers it */
      if (paired() && S.role === 'host' && S.cur && S.peerHas === null && performance.now() - (S.lastPick || 0) > RESEND) sendPick();
      /* QoS 0 can lose a message: whoever made the current record says it again now and then */
      if (paired() && S.st.by === S.role && S.st.ver > 0 && performance.now() - S.lastResend > RESEND) {
        S.lastResend = performance.now();
        S.room.send('st', stBody());
      }
    }
    const tickT = setInterval(() => { tick(false); if (S.rc && S.rc.until) paintRc(); }, TICK);
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms); timers.add(t); return t; };

    /* ---------- loading a video ---------- */
    async function load(path, { announce = true } = {}) {
      const n = api.vfs.node(path);
      if (!n || !media.isMedia(n)) { S.err = 'That video has no bytes in this browser.'; paintStage(); return false; }
      const url = await media.urlOf(n);
      if (S.dead) return false;
      if (!url) { S.err = 'That video has no bytes in this browser.'; paintStage(); return false; }
      const cid = await W.cidOf(path);
      if (S.dead) return false;
      dropYt();
      S.cur = { path, name: n.name, cid, size: n.size || 0 };
      S.err = ''; S.iaMsg = '';
      S.picking = false;
      S.missing = false;
      S.blocked = false;
      blockedBtn.hidden = true;
      if (wholeUrl) { URL.revokeObjectURL(wholeUrl); wholeUrl = null; }
      video.src = url;
      try { video.load(); } catch (err) { /* fine */ }
      paintStage();
      if (announce && S.role === 'host') {
        /* a new video starts paused at the beginning, for both */
        S.st = { ver: S.st.ver + 1, by: 'host', play: false, pos: 0, at: clock(), rate: 1 };
        S.peerHas = null;
        sendPick();
        if (paired()) S.room.send('st', stBody());
      }
      return true;
    }
    function sendPick() {
      if (!paired() || S.role !== 'host' || !S.cur?.cid) return;
      S.lastPick = performance.now();
      const d = pl().duration;
      S.room.send('pick', { cid: S.cur.cid, n: S.cur.name, d: Number.isFinite(d) ? Math.round(d * 10) / 10 : undefined, s: S.cur.size, ...(S.cur.ia ? { fn: S.cur.file } : {}) });
    }

    /* ---------- a film from the Internet Archive ----------
       Both devices stream the same file from archive.org: the id travels, the file does not. The film's details
       come from archive.org's metadata (CORS open); the video is a plain <video src>, which needs no CORS. */
    async function loadIa(id, { announce = true, file = null } = {}) {
      if (!W.IA_ID_RE.test(id)) return false;
      S.iaBusy = true; S.iaMsg = ''; paintStage();
      let meta = null;
      try {
        const r = await fetch(`${IA}/metadata/${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(String(r.status));
        meta = await r.json();
      } catch (err) { meta = null; }
      S.iaBusy = false;
      if (S.dead) return false;
      const rec = (meta && meta.metadata) || null;
      const files = meta && Array.isArray(meta.files) ? meta.files : [];
      const fail = text => { S.iaMsg = text; S.err = text; paintStage(); return false; };
      if (!rec || !files.length) return fail('archive.org didn’t answer for that film. Check the link, or try again in a moment.');
      if (String(rec.mediatype) !== 'movies') return fail('That archive.org item isn’t a film, so it can’t be played here.');
      if (looksAdult(rec)) return fail('That item is labelled for adults, so Watch Together won’t play it.');
      const chosen = (file && files.find(f => f && f.name === file && /\.(mp4|m4v)$/i.test(f.name))) || pickVideo(files);
      if (!chosen) return fail('That film has no video file this browser can play.');
      dropYt();
      const title = plain(rec.title, 120) || id;
      S.cur = { ia: id, file: chosen.name, path: null, name: title, cid: `ia:${id}`, size: 0, whole: true, rights: rightsOf(rec).line };
      S.err = ''; S.iaMsg = ''; S.picking = false; S.missing = false; S.blocked = false; blockedBtn.hidden = true;
      if (wholeUrl) { URL.revokeObjectURL(wholeUrl); wholeUrl = null; }
      video.src = iaUrl(id, chosen.name);
      try { video.load(); } catch (err) { /* fine */ }
      paintStage();
      if (announce && S.role === 'host') {
        S.st = { ver: S.st.ver + 1, by: 'host', play: false, pos: 0, at: clock(), rate: 1 };
        S.peerHas = null;
        sendPick();
        if (paired()) S.room.send('st', stBody());
      }
      return true;
    }
    async function searchIa(q) {
      S.iaMsg = ''; S.iaHits = null; S.iaBusy = true; paintStage();
      try {
        const r = await fetch(searchUrl({ q, collection: 'all', sort: 'downloads' }));
        if (!r.ok) throw new Error(String(r.status));
        const docs = ((await r.json()).response || {}).docs || [];
        S.iaHits = docs.filter(d => d && W.IA_ID_RE.test(String(d.identifier)) && !looksAdult(d)).slice(0, 8);
        if (!S.iaHits.length) S.iaMsg = 'No free film matched that.';
      } catch (err) { S.iaMsg = 'archive.org didn’t answer. Check your connection and try again.'; }
      S.iaBusy = false;
      if (!S.dead) paintStage();
    }

    /* ---------- a YouTube video ---------- */
    function dropYt() {
      if (S.yt) { try { S.yt.destroy(); } catch (err) { /* gone */ } S.yt = null; }
      S.ytErr = ''; S.ytMsg = ''; S.ytTry = 0;
    }
    function loadYt(id, { announce = true } = {}) {
      if (!YT.YT_ID_RE.test(id)) return false;
      dropYt();
      if (wholeUrl) { URL.revokeObjectURL(wholeUrl); wholeUrl = null; }
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (err) { /* fine */ }
      S.cur = { yt: id, path: null, name: 'YouTube video', cid: `yt:${id}`, size: 0 };
      S.err = ''; S.iaMsg = ''; S.picking = false; S.missing = false; S.blocked = false; blockedBtn.hidden = true;
      S.yt = YT.createYt({
        host: stage, id, origin: location.origin,
        h: {
          onReady: () => { if (!S.dead) { tick(true); paintStage(); } },
          onError: code => { if (S.dead) return; S.ytErr = YT.errorText(code); S.ytCode = code; S.yt?.iframe && (S.yt.iframe.hidden = true); paintStage(); },
          onSilent: () => { if (S.dead) return; S.ytErr = 'YouTube didn’t answer. This network may block YouTube, or the video can’t load here.'; S.ytCode = 0; S.yt?.iframe && (S.yt.iframe.hidden = true); paintStage(); },
          /* a press on YouTube's own play/pause becomes a shared record too */
          onState: (prev, now, byUs) => {
            if (S.dead || byUs || !hasVideo()) return;
            const pos = S.yt.currentTime;
            if (now === 1 && prev !== 3 && !S.st.play) act({ play: true, pos }, `pressed play at ${fmtTime(pos)}`);
            else if (now === 2 && S.st.play) act({ play: false, pos }, `paused at ${fmtTime(pos)}`);
          },
          onSeek: t => { if (!S.dead && hasVideo()) seekTo(t); },
        },
      });
      paintStage();
      if (announce && S.role === 'host') {
        S.st = { ver: S.st.ver + 1, by: 'host', play: false, pos: 0, at: clock(), rate: 1 };
        S.peerHas = null;
        sendPick();
        if (paired()) S.room.send('st', stBody());
      }
      return true;
    }
    async function findWanted() {
      if (S.role !== 'guest' || !S.want || S.finding) return;
      S.finding = true;
      paintStage();
      let hit = null;
      try { hit = await W.findLocal(S.want.cid, S.want.s); } catch (err) { hit = null; }
      S.finding = false;
      if (S.dead || !S.want) return;
      if (hit) {
        await load(hit.path, { announce: false });
        S.cur.cid = S.want.cid;
        if (paired()) S.room.send('have', { cid: S.want.cid, ok: true });
      } else {
        S.missing = true;
        S.cur = null;
        video.removeAttribute('src');
        try { video.load(); } catch (err) { /* fine */ }
        if (paired()) S.room.send('have', { cid: S.want.cid, ok: false });
      }
      paintStage();
    }
    /* a file that arrived (by Drop, an import…) may be the one we were missing */
    const offFs = api.bus.on('media:change', () => { if (S.missing) findWanted(); });
    const offFs2 = api.bus.on('fs:change', () => { if (S.missing) findWanted(); });

    /* ---------- the room ---------- */
    function openRoom(role, code) {
      closeRoom(false);
      S.err = '';
      const room = openPair({ kind: 'watch', role, code, types: TYPES, rtc: false });
      S.room = room;
      S.role = role;
      S.hostOnly = false; S.rc = null; S.queue = [];
      if (role === 'guest') { dropYt(); S.st = { ...W.fresh(), by: 'guest' }; S.want = null; S.cur = null; S.missing = false; video.removeAttribute('src'); try { video.load(); } catch (err) { /* fine */ } }
      if (room.phase === 'closed') { S.err = JOIN_ERR[room.error] || JOIN_ERR.nobody; S.room = null; S.role = 'host'; paint(); return; }
      S.roomOffs = [room.on((type, data) => {
        if (S.dead || S.room !== room) return;
        if (type === 'phase') {
          if (data === 'closed') {
            if (room.error) { S.err = JOIN_ERR[room.error] || JOIN_ERR.nobody; S.room = null; S.role = 'host'; S.st = { ...S.st, by: 'host' }; }
          }
          paint();
        } else if (type === 'peer') {
          sys(role === 'host' ? `${data.name} joined` : `You joined ${data.name}’s room`);
          if (role === 'host') api.bus.emit('watch:friend');        /* Movie Night (core/achievements.js) */
          if (role === 'host') {
            sendPick(); if (S.cur) S.room.send('st', stBody());
            if (S.hostOnly) S.room.send('hc', { on: true });
            if (S.queue.length) sendQueue();
          }
          paint();
        } else if (type === 'left') {
          sys(data.reason === 'quiet' ? `Lost touch with ${data.peer?.name || 'your friend'}` : `${data.peer?.name || 'Your friend'} left`);
          closeRoom(false);
          paint();
        } else if (type === 'msg') onMsg(data);
        else if (type === 'live') paintLive(data);
      })];
      paint();
    }
    function closeRoom(sayBye = true) {
      stopAv();
      S.hostOnly = false; S.rc = null; S.queue = []; S.inviteOpen = false; S.invite = null;
      S.roomOffs.forEach(f => f());
      S.roomOffs = [];
      if (S.room) { try { S.room.leave(); } catch (err) { /* gone */ } }
      S.room = null;
      S.role = 'host';
      S.st = { ...S.st, by: 'host' };
      S.offer = null;
      S.want = null;
      S.missing = false;
    }
    function onMsg({ t, m }) {
      if (t === 'chat') { addChat({ who: peerName(), hue: S.room?.peer?.color, text: m.tx }); return; }
      if (t === 'st') {
        const rec = W.fromPeer(m, S.room.offset(), S.role);
        if (S.hostOnly && S.role === 'host') return;           /* the host decides; a guest's press is not a record */
        if (!W.newer(rec, S.st)) return;
        const was = S.st;
        S.st = rec;
        if (hasVideo()) {
          if (rec.play !== was.play) sys(`${peerName()} ${rec.play ? 'pressed play' : 'paused'} at ${fmtTime(rec.pos)}`);
          else if ((rec.rate || 1) !== (was.rate || 1)) sys(`${peerName()} set the speed to ${rec.rate || 1}×`);
          else if (Math.abs(W.expected(was, clock(), dur()) - W.expected(rec, clock(), dur())) > 1) sys(`${peerName()} jumped to ${fmtTime(rec.pos)}`);
        }
        tick(true);
        paintCtl();
        return;
      }
      if (t === 'rx') { fly(m.e, false); return; }
      if (t === 'hc') {
        if (S.role !== 'guest') return;                       /* only the host decides this */
        if (S.hostOnly !== m.on) sys(m.on ? `${peerName()} is the only one who controls playback now` : `${peerName()} lets you control playback again`);
        S.hostOnly = m.on; paintCtl(); paintRoomExtras(); return;
      }
      if (t === 'rc') { onReady(m); return; }
      if (t === 'ql') { if (S.role === 'guest') { S.queue = m.items; paintQueue(); } return; }
      if (t === 'qa') { if (S.role === 'host') addQueue(m, true); return; }
      if (t === 'msig') { if (paired()) { if (!A.av) makeAv(); A.av.handle(m); } return; }
      if (t === 'av') { A.remote = m; paintAv(); return; }
      if (t === 'pick' && S.role === 'guest') {
        if (S.want?.cid === m.cid && (S.cur || S.finding || S.missing)) { if (S.cur && paired()) S.room.send('have', { cid: m.cid, ok: true }); return; }
        S.want = m;
        S.offer = null;
        if (m.cid.startsWith('yt:')) {                       /* an id that already passed the same check as the host's */
          sys(`${peerName()} chose a YouTube video`);
          S.missing = false;
          if (loadYt(m.cid.slice(3), { announce: false }) && paired()) S.room.send('have', { cid: m.cid, ok: true });
          return;
        }
        if (m.cid.startsWith('ia:')) {                          /* the same archive.org file, found by the same rule */
          sys(`${peerName()} chose “${m.n}” from the Internet Archive`);
          S.missing = false;
          loadIa(m.cid.slice(3), { announce: false, file: m.fn }).then(okIa => { if (!S.dead && paired()) S.room.send('have', { cid: m.cid, ok: !!okIa }); });
          return;
        }
        sys(`${peerName()} chose “${m.n}”`);
        findWanted();
        return;
      }
      if (t === 'have' && S.role === 'host') {
        if (!S.cur || m.cid !== S.cur.cid) return;
        if (S.peerHas !== m.ok) sys(m.ok ? `${peerName()} has this video` : `${peerName()} doesn’t have this video`);
        S.peerHas = m.ok;
        paintFriend();
        return;
      }
      if (t === 'drop' && S.role === 'guest') {
        S.offer = { code: m.code };
        paintStage();
      }
    }
    const offDrop = api.bus.on('drop:hosting', ({ code, names } = {}) => {
      if (!S.wantDrop || !paired() || S.role !== 'host' || !isCode(code)) return;
      if (!S.cur || !(names || []).includes(S.cur.name)) return;
      S.wantDrop = false;
      S.room.send('drop', { code });
      sys(`Sent ${peerName()} the Drop code ${code} — they need to accept the file`);
    });

    /* ---------- reactions ---------- */
    let lastRx = 0, rxSeen = [];
    function react(e) {
      if (!RX.includes(e)) return;
      const now = performance.now();
      if (now - lastRx < 400) return;
      lastRx = now;
      if (paired()) S.room.send('rx', { e });
      fly(e, true);
    }
    function fly(e, mine) {
      const now = performance.now();
      rxSeen = rxSeen.filter(t => now - t < 2000);
      if (!mine) { if (rxSeen.length >= 8) return; rxSeen.push(now); }
      if (flies.size >= 12) return;
      const el = h('span.wt-fly', { 'aria-hidden': 'true', style: { left: `${10 + Math.random() * 70}%` }, dataset: { mine: mine ? '1' : '0' }, text: e });
      stage.appendChild(el);
      flies.add(el);
      const t = setTimeout(() => { flies.delete(el); el.remove(); timers.delete(t); }, 2600);
      timers.add(t);
    }

    /* ---------- a ready check ---------- */
    function askReady() {
      if (!paired() || !hasVideo() || blockedByHost()) return;
      S.rc = { id: ++S.rcId, asker: true, mine: true, theirs: false, until: 0 };
      S.room.send('rc', { k: 'ask', id: S.rc.id });
      sys('You asked if everyone is ready');
      paintRc();
    }
    function onReady(m) {
      if (m.k === 'ask') { S.rc = { id: m.id, asker: false, mine: false, theirs: true, until: 0 }; sys(`${peerName()} asked: ready to start?`); paintRc(); return; }
      if (!S.rc || S.rc.id !== m.id) return;
      if (m.k === 'no') { sys(`${peerName()} isn’t ready yet`); S.rc = null; paintRc(); return; }
      if (m.k === 'yes') { S.rc.theirs = true; if (S.rc.asker && S.rc.mine) countdown(); else paintRc(); return; }
      if (m.k === 'go' && !S.rc.asker) { S.rc.until = performance.now() + 3000; paintRc(); }
    }
    function answerReady(yes) {
      if (!S.rc || !paired()) return;
      S.room.send('rc', { k: yes ? 'yes' : 'no', id: S.rc.id });
      if (!yes) { sys('You said not yet'); S.rc = null; paintRc(); return; }
      S.rc.mine = true;
      if (S.rc.asker && S.rc.theirs) countdown(); else paintRc();
    }
    function countdown() {
      const rc = S.rc;
      rc.until = performance.now() + 3000;
      S.room.send('rc', { k: 'go', id: rc.id });
      paintRc();
      later(() => {
        if (S.rc !== rc) return;
        S.rc = null; paintRc();
        if (hasVideo()) act({ play: true, pos: pl().currentTime }, 'started it after the ready check');
      }, 3000);
    }
    function paintRc() {
      const rc = S.rc;
      rcBar.hidden = !rc;
      if (!rc) { rcBar.replaceChildren(); return; }
      const left = rc.until ? Math.max(0, Math.ceil((rc.until - performance.now()) / 1000)) : 0;
      if (rc.until) { rcBar.replaceChildren(h('b', { text: left ? `Starting in ${left}…` : 'Starting…' })); rcBar.dataset.state = 'count'; if (!rc.asker && left === 0) { S.rc = null; rcBar.hidden = true; } return; }
      rcBar.dataset.state = 'ask';
      if (!rc.mine) rcBar.replaceChildren(h('b', { text: `${peerName()} asks: ready?` }), h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-wt': 'ready-yes', onclick: () => answerReady(true) }, h('span', { text: 'I’m ready' })), h('button.btn.btn--sm', { type: 'button', 'data-wt': 'ready-no', onclick: () => answerReady(false) }, h('span', { text: 'Not yet' })));
      else rcBar.replaceChildren(h('b', { text: `Waiting for ${peerName()}…` }), h('button.btn.btn--sm', { type: 'button', onclick: () => { if (paired()) S.room.send('rc', { k: 'no', id: rc.id }); S.rc = null; paintRc(); } }, h('span', { text: 'Cancel' })));
    }

    /* ---------- host controls only ---------- */
    function setHostOnly(on) {
      if (S.role !== 'host') return;
      S.hostOnly = !!on;
      if (paired()) S.room.send('hc', { on: S.hostOnly });
      sys(on ? 'Only you control playback now' : 'Your friend can control playback again');
      paintCtl(); paintRoomExtras();
    }

    /* ---------- the shared queue ---------- */
    function sendQueue() { if (paired() && S.role === 'host') S.room.send('ql', { items: S.queue.map(({ cid, n, s }) => ({ cid, n, ...(s !== undefined ? { s } : {}) })) }); }
    function addQueue(item, fromGuest = false) {
      const it = qItem(item);
      if (!it) return;
      if (S.role === 'guest') { if (paired()) { S.room.send('qa', it); sys(`You asked to add “${it.n}” to the queue`); } return; }
      if (S.queue.length >= QUEUE_MAX) { sys(`The queue holds ${QUEUE_MAX} videos.`); return; }
      if (S.queue.some(q => q.cid === it.cid)) return;
      S.queue.push({ ...it, path: item.path });
      if (fromGuest) sys(`${peerName()} added “${it.n}” to the queue`);
      sendQueue(); paintQueue();
    }
    function removeQueue(i) { S.queue.splice(i, 1); sendQueue(); paintQueue(); }
    async function playItem(it) {
      if (it.cid.startsWith('yt:')) return loadYt(it.cid.slice(3));
      if (it.cid.startsWith('ia:')) return loadIa(it.cid.slice(3));
      const hit = it.path && api.vfs.node(it.path) ? { path: it.path } : await W.findLocal(it.cid, it.s ?? null);
      if (!hit) { sys(`“${it.n}” isn’t on this device, so it was skipped`); return false; }
      return load(hit.path);
    }
    async function playQueued(i) {
      if (S.role !== 'host') return;
      const [it] = S.queue.splice(i, 1);
      sendQueue(); paintQueue();
      if (it && !(await playItem(it)) && S.queue.length) playQueued(0);
    }
    const playNext = () => { if (S.queue.length) playQueued(0); };
    function paintQueue() {
      const guestForm = S.role === 'guest' && paired();
      queueEl.hidden = !S.queue.length && !guestForm;
      if (queueEl.hidden) { queueEl.replaceChildren(); return; }
      const sugIn = h('input.wt-suggest', { type: 'text', maxlength: '200', autocomplete: 'off', spellcheck: 'false', placeholder: 'Suggest a YouTube or archive.org link', 'aria-label': 'Suggest a link for the queue', 'data-wt': 'suggest' });
      const kids = [];
      if (S.queue.length) kids.push(h('b', { text: `Up next (${S.queue.length})` }), h('ol.wt-queue__l', S.queue.map((q, i) => h('li', { dataset: { cid: q.cid } }, h('span.trunc', { text: q.n }),
        S.role === 'host' ? h('button.btn.btn--sm', { type: 'button', 'data-wt': 'q-play', 'aria-label': `Play ${q.n} now`, onclick: () => playQueued(i) }, h('span', { text: 'Play now' })) : null,
        S.role === 'host' ? h('button.ibtn', { type: 'button', 'data-wt': 'q-del', 'aria-label': `Remove ${q.n}`, onclick: () => removeQueue(i) }, icon('x')) : null))));
      if (guestForm) kids.push(h('form.wt-ytform', { onsubmit: e => {
        e.preventDefault();
        const yt = YT.parseYouTube(sugIn.value), ia = /archive\.org\//i.test(sugIn.value) ? W.parseArchive(sugIn.value) : null;
        if (!yt && !ia) { sys('Paste a YouTube link or an archive.org film link to suggest it.'); return; }
        addQueue({ cid: yt ? `yt:${yt}` : `ia:${ia}`, n: yt ? 'YouTube video' : ia });
        sugIn.value = '';
      } }, sugIn, h('button.btn.btn--sm', { type: 'submit', 'data-wt': 'suggest-go' }, h('span', { text: 'Suggest' }))));
      queueEl.replaceChildren(...kids);
    }

    /* ---------- your own subtitles (never sent to your friend) ---------- */
    async function loadSubs(f) {
      if (!f) return;
      if (f.size > SUB_MAX) { subNote.hidden = false; subNote.textContent = 'That subtitle file is too big (over 2 MB).'; return; }
      let text = '';
      try { text = await f.text(); } catch (e) { text = ''; }
      if (S.dead) return;
      if (!text.trim()) { subNote.hidden = false; subNote.textContent = 'That file is empty or couldn’t be read.'; return; }
      const vtt = /\.srt$/i.test(f.name) || !/^\uFEFF?WEBVTT/.test(text) ? srtToVtt(text) : text;
      clearSubs();
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const tr = document.createElement('track');
      tr.kind = 'subtitles'; tr.label = f.name.slice(0, 60); tr.src = url; tr.default = true;
      video.appendChild(tr);
      try { tr.track.mode = 'showing'; } catch (e) { /* fine */ }
      S.sub = { name: f.name.slice(0, 60), url, el: tr };
      paintSubs();
    }
    function clearSubs() {
      if (!S.sub) return;
      try { S.sub.el.remove(); URL.revokeObjectURL(S.sub.url); } catch (e) { /* gone */ }
      S.sub = null; paintSubs();
    }
    function paintSubs() {
      subBtn.setAttribute('aria-pressed', String(!!S.sub));
      subBtn.setAttribute('data-tip', S.sub ? 'Remove subtitles' : 'Subtitles');
      subNote.hidden = !S.sub;
      if (S.sub) subNote.textContent = `Subtitles: ${S.sub.name}. Only you see these; they stay on this device.`;
    }

    /* ---------- push to talk ---------- */
    function setPtt(patch) {
      if (patch.on !== undefined) S.ptt.on = !!patch.on;
      if (patch.key && PTT_KEYS.some(k => k[0] === patch.key)) S.ptt.key = patch.key;
      api.store.set('prefs.watchTogether', { ...prefsW(), ptt: S.ptt.on, pttKey: S.ptt.key });
      S.ptt.down = false;
      if (A.mic) { A.mic.enabled = S.ptt.on ? false : !A.muted; sendAv(); }
      paintAv();
    }
    const pttSend = down => {
      if (!S.ptt.on || !A.mic || S.ptt.down === down) return;
      S.ptt.down = down;
      A.mic.enabled = down && !A.muted;
      sendAv(); paintAv();
    };
    const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') && e.target.type !== 'checkbox';
    const onKeyDown = e => { if (e.code === S.ptt.key && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e) && root.contains(document.activeElement || root)) { pttSend(true); } };
    const onKeyUp = e => { if (e.code === S.ptt.key) pttSend(false); };
    const onBlur = () => pttSend(false);
    document.addEventListener('keydown', onKeyDown); document.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);

    /* ---------- camera and microphone ---------- */
    function makeAv() {
      A.av = createAv({
        send: body => !!S.room && S.room.send('msig', body),
        polite: S.role === 'guest',
        ice: iceServers,
        h: {
          onReset: () => { try { A.stream.getTracks().forEach(t => A.stream.removeTrack(t)); } catch (err) { /* gone */ } },
          onTrack: track => {
            if (S.dead) return;
            A.stream.addTrack(track);
            track.addEventListener('ended', () => { try { A.stream.removeTrack(track); } catch (err) { /* gone */ } });
            const p = remoteVideo.play();
            if (p && p.catch) p.catch(() => { if (S.dead) return; remoteVideo.muted = true; remoteVideo.play().catch(() => {}); A.needTap = true; paintAv(); });
            paintAv();
          },
          onLink: (state, why) => {
            if (S.dead) return;
            A.link = state;
            if (state === 'failed') {
              A.err = `The camera and microphone couldn’t connect directly (${why || 'no direct path'}). Some networks block direct connections between two devices, and StaticOS has no relay server for video. The shared video and chat still work.`;
              A.canRetry = true;
            } else if (state === 'connected') { A.err = ''; A.canRetry = false; sendAv(); }
            paintAv();
          },
        },
      });
    }
    function sendAv() {
      A.lastSent = performance.now();
      if (paired()) S.room.send('av', { cam: A.cam ? (A.camHidden ? 2 : 1) : 0, mic: A.mic ? (A.muted || (S.ptt.on && !S.ptt.down) ? 2 : 1) : 0 });
    }
    function avTick() {
      if (paired() && performance.now() - A.lastSent > RESEND) sendAv();       /* QoS 0 can lose it */
      if (S.yt) paintCtl();
    }
    async function turnOn(kind) {
      const word = kind === 'cam' ? 'camera' : 'microphone';
      if (!paired() || A[kind] || A.busy[kind]) return;
      A.err = ''; A.canRetry = false;
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') { A.err = `This browser can’t reach a ${word} here (it needs a secure page).`; paintAv(); return; }
      A.busy[kind] = true; paintAv();
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(kind === 'cam'
          ? { video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }, audio: false }
          : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (err) { A.err = mediaErr(word, err); }
      A.busy[kind] = false;
      if (!stream) { if (!S.dead) paintAv(); return; }
      const track = (kind === 'cam' ? stream.getVideoTracks() : stream.getAudioTracks())[0];
      stream.getTracks().forEach(t => { if (t !== track) t.stop(); });
      if (S.dead || !paired() || !track) { track?.stop(); if (!S.dead) { if (!track) A.err = `No ${word} was found on this device.`; paintAv(); } return; }
      track.addEventListener('ended', () => { if (A[kind] === track && !S.dead) { turnOff(kind); A.err = `Your ${word} stopped (it may have been unplugged).`; paintAv(); } });
      A[kind] = track;
      if (kind === 'cam') { A.camHidden = false; selfVideo.srcObject = new MediaStream([track]); selfVideo.play().catch(() => {}); } else { A.muted = false; if (S.ptt.on) { track.enabled = false; S.ptt.down = false; } }
      if (!A.av) makeAv(); else if (A.link === 'failed') A.av.retry();
      A.av.setTrack(kind === 'cam' ? 'video' : 'audio', track);
      sendAv();
      paintAv();
    }
    function turnOff(kind) {
      const t = A[kind];
      A[kind] = null;
      if (kind === 'cam') { A.camHidden = false; selfVideo.srcObject = null; } else A.muted = false;
      try { t?.stop(); } catch (err) { /* gone */ }
      try { A.av?.setTrack(kind === 'cam' ? 'video' : 'audio', null); } catch (err) { /* gone */ }
      sendAv();
      paintAv();
    }
    /* the friend left, we left, or the window closed: every device off, the link closed */
    function stopAv() {
      for (const k of ['cam', 'mic']) {
        try { A[k]?.stop(); } catch (err) { /* gone */ }
        A[k] = null;
      }
      A.camHidden = false; A.muted = false;
      selfVideo.srcObject = null;
      try { A.av?.close(); } catch (err) { /* gone */ }
      A.av = null; A.link = 'idle'; A.err = ''; A.canRetry = false; A.needTap = false;
      A.remote = { cam: 0, mic: 0 };
      try { A.stream.getTracks().forEach(t => A.stream.removeTrack(t)); } catch (err) { /* gone */ }
      remoteVideo.muted = false;
      if (!S.dead) paintAv();
    }
    const CORNERS = ['br', 'bl', 'tl', 'tr'];
    function cycleCorner() { tiles.dataset.corner = CORNERS[(CORNERS.indexOf(tiles.dataset.corner) + 1) % 4]; }
    /* drag the tiles anywhere; on release they snap to the nearest corner */
    tiles.addEventListener('pointerdown', e => {
      if (e.target === moveBtn || e.button > 0) return;
      const sr = stage.getBoundingClientRect(), tr = tiles.getBoundingClientRect();
      const dx = e.clientX - tr.left, dy = e.clientY - tr.top;
      tiles.classList.add('is-drag');
      try { tiles.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      const move = ev => {
        tiles.style.cssText = `top:${Math.max(0, Math.min(sr.height - tr.height, ev.clientY - dy - sr.top))}px;left:${Math.max(0, Math.min(sr.width - tr.width, ev.clientX - dx - sr.left))}px;right:auto;bottom:auto`;
      };
      const up = ev => {
        tiles.removeEventListener('pointermove', move);
        tiles.removeEventListener('pointerup', up);
        tiles.removeEventListener('pointercancel', up);
        const cx = ev.clientX - dx - sr.left + tr.width / 2, cy = ev.clientY - dy - sr.top + tr.height / 2;
        tiles.dataset.corner = `${cy < sr.height / 2 ? 't' : 'b'}${cx < sr.width / 2 ? 'l' : 'r'}`;
        tiles.style.cssText = '';
        tiles.classList.remove('is-drag');
      };
      tiles.addEventListener('pointermove', move);
      tiles.addEventListener('pointerup', up);
      tiles.addEventListener('pointercancel', up);
    });
    function paintAv() {
      if (S.dead) return;
      const on = paired();
      avBar.hidden = !on;
      const mic = !!A.mic, cam = !!A.cam;
      camBtn.setAttribute('aria-pressed', String(cam));
      micBtn.setAttribute('aria-pressed', String(mic));
      camBtn.lastChild.textContent = A.busy.cam ? 'Camera…' : cam ? 'Stop camera' : 'Camera';
      micBtn.lastChild.textContent = A.busy.mic ? 'Mic…' : mic ? 'Stop mic' : 'Mic';
      camBtn.disabled = A.busy.cam; micBtn.disabled = A.busy.mic;
      camHideBtn.hidden = !cam; muteMicBtn.hidden = !mic;
      camHideBtn.textContent = A.camHidden ? 'Show my camera' : 'Camera off';
      muteMicBtn.textContent = A.muted ? 'Unmute my mic' : 'Mute my mic';
      camHideBtn.setAttribute('aria-pressed', String(A.camHidden));
      muteMicBtn.setAttribute('aria-pressed', String(A.muted));
      avStatus.dataset.ptt = S.ptt.on ? (S.ptt.down ? 'open' : 'held') : 'off';
      const parts = [];
      if (cam) parts.push(A.camHidden ? 'Your camera is on but hidden (sending black)' : 'Your camera is on');
      if (mic) parts.push(A.muted ? 'Your mic is on but muted' : S.ptt.on ? (S.ptt.down ? 'Your mic is open (you are holding the key)' : `Push to talk: hold ${PTT_KEYS.find(k => k[0] === S.ptt.key)[1]} to talk`) : 'Your mic is on');
      const live = cam || mic;
      pttBox.hidden = !on;
      const nm = peerName();
      const rs = [];
      if (A.remote.cam) rs.push(A.remote.cam === 2 ? 'camera off' : 'camera on');
      if (A.remote.mic) rs.push(A.remote.mic === 2 ? 'muted' : 'mic on');
      if (rs.length) parts.push(`${nm}: ${rs.join(', ')}`);
      avStatus.replaceChildren(...(live ? [h('i.wt-rec')] : []), h('span', { text: parts.length ? parts.join(' · ') : 'Camera and mic are off' }));
      avStatus.dataset.cam = String(A.cam ? (A.camHidden ? 2 : 1) : 0);
      avStatus.dataset.mic = String(A.mic ? (A.muted ? 2 : 1) : 0);
      avStatus.dataset.link = A.link;
      avNote.hidden = !(mic || A.remote.mic);
      avErr.hidden = !A.err;
      avErr.replaceChildren(...(A.err ? [h('span', { text: A.err }), A.canRetry ? h('button.btn.btn--sm.wt-avretry', { type: 'button', onclick: () => { A.err = ''; A.canRetry = false; A.av?.retry(); paintAv(); } }, h('span', { text: 'Try again' })) : null].filter(Boolean) : []));
      /* the tiles: only a camera that is on and showing */
      const showMe = cam && !A.camHidden, showFriend = A.remote.cam === 1 && A.stream.getVideoTracks().length > 0;
      selfTile.hidden = !showMe;
      friendTile.hidden = !showFriend;
      friendName.textContent = nm;
      friendMute.hidden = A.remote.mic !== 2;
      tiles.hidden = !showMe && !showFriend;
      if (A.needTap && !avErr.querySelector('.wt-hear')) avErr.append(h('button.btn.btn--sm.wt-hear', { type: 'button', onclick: () => { remoteVideo.muted = false; remoteVideo.play().catch(() => {}); A.needTap = false; paintAv(); } }, h('span', { text: `Hear ${nm}` })));
      avErr.hidden = !(A.err || A.needTap);
    }

    /* ---------- painting ---------- */
    function paintLive(st = live.status()) {
      liveEl.dataset.st = st;
      liveEl.lastChild.textContent = LIVE_TEXT[st] || LIVE_TEXT.idle;
      liveEl.hidden = !S.room;
    }
    const offLive = live.onStatus(st => { if (!S.dead) paintLive(st); });

    function paintRoom() {
      const room = S.room;
      const kids = [];
      if (!room) {
        const input = h('input.wt-code-in', { type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Friend’s code', 'aria-label': 'Room code from your friend', value: S.joinCode || '' });
        kids.push(
          h('button.btn.btn--primary.wt-start', { type: 'button', onclick: () => openRoom('host') }, icon('users'), h('span', { text: 'Start a room' })),
          h('span.wt-or', { text: 'or' }),
          h('form.wt-join', { onsubmit: e => { e.preventDefault(); const c = normalizeCode(input.value); S.joinCode = c; if (!isCode(c)) { S.err = JOIN_ERR.invalid; paint(); return; } openRoom('guest', c); } },
            input, h('button.btn', { type: 'submit' }, h('span', { text: 'Join' }))));
        if (S.err) kids.push(h('p.wt-err', { role: 'alert', text: S.err }));
      } else {
        const ph = room.phase;
        if (room.role === 'host') {
          kids.push(h('span.wt-room__k', { text: 'Room' }),
            h('span.wt-code', { 'aria-label': `Room code ${spaced(room.code)}`, dataset: { code: room.code } }, [...room.code].map(c => h('span', { text: c, 'aria-hidden': 'true' }))),
            h('button.btn.btn--sm', { type: 'button', onclick: () => copyInvite(room.code) }, icon('copy'), h('span', { text: 'Copy invite' })),
            h('button.btn.btn--sm', { type: 'button', 'data-wt': 'invite', 'aria-expanded': String(S.inviteOpen), onclick: () => toggleInvite() }, icon('send'), h('span', { text: 'Invite a friend' })));
        } else kids.push(h('span.wt-room__k', { text: `Room ${room.code}` }));
        kids.push(h('span.wt-room__st', { dataset: { phase: ph }, text: ph === 'paired' ? `With ${peerName()}` : ph === 'waiting' ? 'Waiting for your friend…' : ph === 'joining' ? 'Joining…' : 'Connecting…' }));
        kids.push(h('button.btn.btn--sm.wt-leave', { type: 'button', onclick: () => { sys('You left the room'); closeRoom(true); paint(); } }, h('span', { text: 'Leave' })));
      }
      roomBar.replaceChildren(...kids);
      roomBar.dataset.phase = room ? room.phase : 'none';
      invHost.hidden = !(room && room.role === 'host' && S.inviteOpen);
    }
    async function toggleInvite() {
      if (!S.room || S.role !== 'host') return;
      S.inviteOpen = !S.inviteOpen;
      if (S.inviteOpen) { invHost.hidden = false; invHost.replaceChildren(await invitePanel({ h, icon, kind: 'watch', code: S.room.code })); }
      if (S.dead) return;
      paintRoom();
    }
    function paintRoomExtras() {
      const pr = paired();
      hostOnlyBtn.hidden = !(pr && S.role === 'host');
      hostOnlyBtn.firstChild.checked = S.hostOnly;
      readyBtn.hidden = !(pr && hasVideo() && !blockedByHost());
      rxBar.hidden = !pr;
      if (pr && S.role === 'guest' && S.hostOnly) friendLine.hidden = false;
    }
    async function copyInvite(code) {
      const link = inviteLink(code);
      const text = `Watch with me in StaticOS — Watch Together code ${code}${link ? ` · ${link}` : ''}`;
      try { await navigator.clipboard.writeText(text); notify({ app: 'Watch Together', icon: 'copy', title: 'Invite copied', message: `Room code ${code}.` }); }
      catch (e) { notify({ app: 'Watch Together', icon: 'info', title: `Room code ${code}`, message: 'Copying was blocked here — read the code out instead.' }); }
    }

    function paintFriend() {
      const kids = [];
      if (paired() && S.role === 'host' && S.cur) {
        if (S.peerHas === true) kids.push(icon('check'), h('span', { text: `${peerName()} has this video` }));
        else if (S.peerHas === false) {
          kids.push(icon('alert'), h('span', { text: `${peerName()} doesn’t have “${S.cur.name}”.` }),
            !S.cur.path || S.cur.cid?.startsWith('asset:') ? null : h('button.btn.btn--sm.btn--primary.wt-dropit', { type: 'button', onclick: () => { S.wantDrop = true; api.openApp('drop', { send: [S.cur.path], go: true }); } }, icon('send'), h('span', { text: 'Send it with Drop' })));
        } else kids.push(h('span', { text: `Checking whether ${peerName()} has it…` }));
      }
      friendLine.replaceChildren(...kids.filter(Boolean));
      friendLine.hidden = !kids.length;
    }

    function pickerView() {
      const list = W.videos();
      const guest = S.role === 'guest';
      const ytIn = h('input.wt-ytin', { type: 'text', maxlength: '200', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube link', 'data-wt': 'yt-in' });
      const ytId = () => YT.parseYouTube(ytIn.value);
      const ytForm = guest ? null : h('form.wt-ytform', {
        onsubmit: e => {
          e.preventDefault();
          const id = ytId();
          if (!id) { S.ytMsg = 'That isn’t a YouTube video link. Paste a youtube.com/watch, youtu.be, Shorts or embed link, or the 11-character video id.'; paintStage(); return; }
          S.ytMsg = '';
          loadYt(id);
        },
      }, ytIn, h('button.btn.btn--sm.wt-ytgo', { type: 'submit' }, h('span', { text: 'Load' })),
      h('button.btn.btn--sm', { type: 'button', 'data-wt': 'yt-queue', onclick: () => { const id = ytId(); if (!id) { S.ytMsg = 'That isn’t a YouTube video link.'; paintStage(); return; } S.ytMsg = ''; addQueue({ cid: `yt:${id}`, n: 'YouTube video' }); ytIn.value = ''; } }, h('span', { text: 'Add to queue' })));
      const hitRow = d => {
        const id = String(d.identifier), title = plain(d.title, 90) || id, year = Array.isArray(d.year) ? d.year[0] : d.year, run = fmtRun(runtimeSecs(d.runtime));
        return h('li', { dataset: { ia: id } },
          h('button.wt-pick__v', { type: 'button', 'data-wt': 'ia-play', onclick: () => loadIa(id) }, icon('film'), h('span.trunc', { text: title }), h('small', { text: [year, run].filter(Boolean).join(' · ') || 'Internet Archive' })),
          h('button.btn.btn--sm', { type: 'button', 'data-wt': 'ia-queue', 'aria-label': `Add ${title} to the queue`, onclick: () => addQueue({ cid: `ia:${id}`, n: title }) }, h('span', { text: 'Queue' })));
      };
      const iaIn = h('input.wt-iain', { type: 'text', maxlength: '200', autocomplete: 'off', spellcheck: 'false', placeholder: 'Search free films, or paste an archive.org link', 'aria-label': 'Search free films on the Internet Archive, or paste a link', 'data-wt': 'ia-in', value: S.iaQ });
      const iaForm = guest ? null : h('form.wt-ytform', {
        onsubmit: e => {
          e.preventDefault();
          const v = iaIn.value.trim();
          S.iaQ = v;
          if (!v) return;
          if (/archive\.org\//i.test(v)) {
            const id = W.parseArchive(v);
            if (!id) { S.iaMsg = 'That isn’t an archive.org film link (it should look like archive.org/details/…).'; paintStage(); return; }
            loadIa(id); return;
          }
          searchIa(v);
        },
      }, iaIn, h('button.btn.btn--sm', { type: 'submit', 'data-wt': 'ia-go' }, h('span', { text: S.iaBusy ? 'Looking…' : 'Find' })));
      return h('div.wt-pick',
        h('b', { text: guest ? `${peerName()} chooses the video` : 'Choose a video you both have' }),
        ytForm,
        S.ytMsg && !guest ? h('p.wt-err', { role: 'alert', text: S.ytMsg }) : null,
        guest ? null : h('div.wt-ia', h('b', { text: 'Free films' }), iaForm,
          S.iaMsg ? h('p.wt-err', { role: 'alert', text: S.iaMsg }) : null,
          S.iaHits && S.iaHits.length ? h('ul.wt-pick__list', { 'data-wt': 'ia-hits' }, S.iaHits.map(hitRow)) : null,
          h('p.wt-iafine', { text: 'Films from the Internet Archive. You and your friend each stream the same file straight from archive.org, so nothing has to be sent between you. The uploader’s stated rights are shown with the film; when none are stated, it says so.' })),
        guest ? null : h('ul.wt-pick__list', list.map(v => h('li', h('button.wt-pick__v', {
          type: 'button', dataset: { path: v.path }, 'aria-current': S.cur?.path === v.path ? 'true' : null,
          onclick: () => load(v.path),
        }, icon('film'), h('span.trunc', { text: v.name }), h('small', { text: v.asset ? 'comes with StaticOS' : 'your file' })),
        h('button.btn.btn--sm', { type: 'button', 'data-wt': 'file-queue', 'aria-label': `Add ${v.name} to the queue`, onclick: async () => {
          const cid = await W.cidOf(v.path);
          if (!cid) { sys(`“${v.name}” is too big to identify, so it can’t be queued.`); return; }
          addQueue({ cid, n: v.name, s: v.size, path: v.path });
        } }, h('span', { text: 'Queue' }))))),
        h('p.wt-fine', { text: 'Sync works for videos you both have: the StaticOS videos in ~/Videos, or a file you’ve both got (Watch Together can send it with Drop first). Anime and films in Static Watch play in other sites’ players: some report where they are, but none take play, pause or seek from StaticOS, so they can’t be kept in sync here.' }));
    }
    function paintStage() {
      paintFriend();
      titleEl.textContent = S.cur ? S.cur.name : S.want ? S.want.n : 'No video yet';
      pickBtn.hidden = S.role === 'guest';
      let msg = null;
      if (S.err && !S.cur && S.room) msg = h('p.wt-err', { role: 'alert', text: S.err });
      if (S.iaBusy && !S.cur) msg = h('div.wt-wait', h('i.wt-spin'), h('span', { text: 'Asking archive.org…' }));
      else if (S.role === 'guest' && S.finding) msg = h('div.wt-wait', h('i.wt-spin'), h('span', { text: `Looking for “${S.want?.n}” on this device…` }));
      else if (S.role === 'guest' && S.missing) {
        msg = h('div.wt-missing', { role: 'status' },
          h('b', { text: `You don’t have “${S.want?.n}”` }),
          h('p', { text: `${peerName()} can send it to you with Static Drop. Once it’s in your files, it starts here by itself — in step with ${peerName()}.` }),
          S.offer ? h('div.wt-offer',
            h('p', { text: `${peerName()} is sending it with Drop (code ${S.offer.code}).` }),
            h('button.btn.btn--primary.wt-opendrop', { type: 'button', onclick: () => api.openApp('drop', { join: S.offer.code }) }, icon('download'), h('span', { text: 'Open Drop' }))) : null,
          h('button.btn.btn--sm', { type: 'button', onclick: () => findWanted() }, icon('refresh'), h('span', { text: 'Check again' })));
      } else if (S.role === 'guest' && !S.cur && paired()) msg = h('div.wt-wait', h('i.wt-spin'), h('span', { text: `Waiting for ${peerName()} to choose a video…` }));
      else if ((S.picking || !S.cur) && S.role !== 'guest') msg = pickerView();
      else if (S.role === 'guest' && !S.cur && !paired()) msg = pickerView();
      if (S.yt && S.ytErr) {
        msg = h('div.wt-missing.wt-yterr', { role: 'alert' },
          h('b', { text: 'This YouTube video can’t play here' }),
          h('p', { text: S.ytErr }),
          h('a.wt-ytlink', { href: YT.watchUrl(S.cur.yt), target: '_blank', rel: 'noopener noreferrer', text: 'Open it on YouTube' }),
          S.role === 'guest' ? null : h('button.btn.btn--sm.wt-ytother', { type: 'button', onclick: () => { dropYt(); S.cur = null; S.picking = true; paintStage(); } }, h('span', { text: 'Choose another video' })));
      }
      credit.hidden = !S.cur?.ia;
      if (S.cur?.ia) credit.replaceChildren('From the Internet Archive · ', S.cur.rights || 'Rights not stated by the uploader', ' · ',
        h('a', { href: `${IA}/details/${encodeURIComponent(S.cur.ia)}`, target: '_blank', rel: 'noopener noreferrer', text: 'archive.org page' }));
      stageMsg.replaceChildren(...(msg ? [msg] : []));
      stageMsg.hidden = !msg;
      stage.classList.toggle('has-msg', !!msg);
      stage.classList.toggle('has-yt', !!S.yt);
      video.hidden = !S.cur || !!S.yt;
      paintCtl();
    }
    function paintCtl() {
      const d = dur();
      const t = pl().currentTime || 0;
      const playing = S.st.play && !(Number.isFinite(d) && t >= d - 0.05);
      playBtn.replaceChildren(icon(playing ? 'pause' : 'play', { fill: true }));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      timeEl.textContent = `${fmtTime(t)} / ${Number.isFinite(d) ? fmtTime(d) : '–:––'}`;
      if (!seekIn.matches(':active')) seekIn.value = Number.isFinite(d) && d > 0 ? String(Math.round((t / d) * 1000)) : '0';
      muteBtn.replaceChildren(icon(video.muted ? 'volume-x' : 'volume-2'));
      muteBtn.setAttribute('aria-pressed', String(video.muted));
      muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
      muteBtn.hidden = !!S.yt;                         /* YouTube's own controls have the volume */
      const off = !S.cur || (!!S.yt && !hasVideo()) || blockedByHost();
      for (const b of [playBtn, backBtn, fwdBtn, seekIn]) b.disabled = off;
      rateSel.value = String(S.st.rate || 1);
      rateSel.disabled = off || !!S.yt;
      rateSel.hidden = !!S.yt;                         /* YouTube's own player has the speed */
      seekIn.title = blockedByHost() ? `Only ${peerName()} controls playback right now` : '';
      paintRoomExtras();
    }
    function paint() {
      if (S.dead) return;
      paintRoom();
      paintStage();
      paintLive();
      paintAv();
      win.setSubtitle(subtitle());
      paintQueue(); paintRc();
    }

    /* ---------- events ---------- */
    seekIn.addEventListener('change', () => { const d = dur(); if (Number.isFinite(d)) seekTo((Number(seekIn.value) / 1000) * d); });
    video.addEventListener('timeupdate', paintCtl);
    /* A server that won't send byte ranges (or the offline copy) leaves a video
       that can't be seeked — and sync is mostly seeking. Then the whole file is
       read once and played from memory, which always seeks. */
    let wholeUrl = null;
    const seekableOk = () => video.seekable.length > 0 && video.seekable.end(video.seekable.length - 1) > 0;
    video.addEventListener('loadedmetadata', async () => {
      paintCtl();
      const cur = S.cur;
      if (cur && !cur.whole && !seekableOk()) {
        cur.whole = true;
        let blob = null;
        try { blob = await media.blobOf(api.vfs.node(cur.path)); } catch (err) { blob = null; }
        if (S.dead || S.cur !== cur || !blob) return;
        if (wholeUrl) URL.revokeObjectURL(wholeUrl);
        wholeUrl = URL.createObjectURL(blob);
        video.src = wholeUrl;
        try { video.load(); } catch (err) { /* fine */ }
        return;
      }
      tick(true);
      if (S.role === 'host') sendPick();
    });
    video.addEventListener('error', () => { if (S.dead || !S.cur) return; S.err = 'This browser can’t play that video.'; stageMsg.replaceChildren(h('p.wt-err', { role: 'alert', text: `This browser can’t play “${S.cur.name}”.` })); stageMsg.hidden = false; });
    stage.addEventListener('keydown', e => {
      if (e.target !== stage && e.target !== video) return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
    });
    stage.addEventListener('click', e => { if (e.target === video) { togglePlay(); stage.focus({ preventScroll: true }); } });

    function fromOpts(o) {
      if (!o) return;
      if (o.join) {
        if (S.room) return;
        S.joinCode = normalizeCode(o.join).slice(0, 6);
        paint();
        setTimeout(() => roomBar.querySelector('.wt-join button')?.focus({ preventScroll: true }), 40);
      } else if (o.path) {
        if (S.role === 'guest' && S.room) { notify({ app: 'Watch Together', icon: 'info', title: `${peerName()} chooses the video`, message: 'Leave the room to pick your own.' }); return; }
        load(o.path);
      }
    }
    win.onReopen(fromOpts);
    paint();
    paintUnread(); paintSubs();
    fromOpts(opts);

    /* for the play-tests */
    wt.wtRoom = () => S.room;
    wt.wtPeek = () => ({
      role: S.role, phase: S.room?.phase || 'none', code: S.room?.code || null, topic: S.room?.topic || null,
      peer: S.room?.peer || null, cur: S.cur ? { name: S.cur.name, cid: S.cur.cid, path: S.cur.path } : null,
      want: S.want, missing: S.missing, peerHas: S.peerHas, st: { ...S.st }, rate: video.playbackRate, hostOnly: S.hostOnly,
      queue: S.queue.map(q => q.cid), unread: S.unread, rc: S.rc ? { asker: S.rc.asker, mine: S.rc.mine, theirs: S.rc.theirs, count: !!S.rc.until } : null,
      sub: S.sub ? S.sub.name : null, subTracks: video.textTracks.length, ptt: { on: S.ptt.on, key: S.ptt.key, down: S.ptt.down }, src: video.currentSrc,
      t: video.currentTime, paused: video.paused, muted: video.muted, ready: video.readyState, wall: clock(),
      offset: S.room?.offset?.() ?? null, stats: S.room?.stats?.() || null, resyncs: S.resyncs,
      chat: S.chat.map(m => (m.sys ? `· ${m.text}` : `${m.who}: ${m.text}`)),
      av: { cam: !!A.cam, mic: !!A.mic, camHidden: A.camHidden, muted: A.muted, link: A.link, err: A.err, remote: { ...A.remote }, remoteVideoTracks: A.stream.getVideoTracks().length, tiles: !tiles.hidden, retry: A.canRetry },
      yt: S.yt ? { id: S.cur?.yt, ready: S.yt.ready, state: S.yt.state, error: S.yt.error, msg: S.ytErr, ...S.yt.stats() } : null,
    });

    return () => {
      S.dead = true;
      clearInterval(tickT);
      offLive(); offFs(); offFs2(); offDrop();
      document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
      for (const t of timers) clearTimeout(t);
      clearSubs();
      closeRoom(true);
      dropYt();
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (err) { /* gone */ }
      if (wholeUrl) URL.revokeObjectURL(wholeUrl);
    };
  },
});
