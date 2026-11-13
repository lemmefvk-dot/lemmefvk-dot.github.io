/* ============================================================
   party.js — Static Party: get people into the same game.

   Start a party (you get a 6-character code), send the code to
   friends, and everyone who joins shows up with their colour, what
   they are playing and whether they are ready. The host picks a game
   from the real catalogue or the Arcade, then presses the giant
   PLAY TOGETHER button: the game opens by itself for everyone who
   marked themselves ready, and everyone else gets a notification
   with a Play button. There is a small party chat alongside.

   The party itself lives in js/portal/party.js, not in this window,
   so it keeps running when the window closes — the pill above the
   Dock (js/shell/partybar.js) shows it and brings this window back.

   Honesty. It all runs over StaticOS's public live channel (MQTT on
   a free public broker). There are no accounts: anyone with the code
   can join, names are whatever people typed, there is no message
   history and nothing is stored on a server. The window says so in
   plain words, shows the channel's real state (Connecting / Live /
   Offline), and never shows a person, a count or a game it has not
   actually heard about. Everything from the network is rendered as
   text, and games are looked up by id in this device's catalogue.

   Layout: a party sidebar (code, invite line, members), the stage
   (chosen game, the big button, who's ready) and the chat. It folds
   to two columns and then one with container queries, so a narrow
   window and a phone both work. The window is a singleton; opening
   it with { code } joins that party (the caller's click is the
   consent), { view: 'pick' } opens the host's game picker.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as party from '../portal/party.js';
import * as live from '../portal/live.js';
import * as presence from '../portal/presence.js';
import * as identity from '../core/identity.js';
import * as catalogue from '../portal/games.data.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import * as plays from '../core/plays.js';
import { cleanText } from '../core/quickplay.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-party-css')) {
  const l = document.createElement('link');
  l.id = 'feat-party-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-party.css';
  document.head.appendChild(l);
}

const G1 = '#ff9234';
const G2 = '#d94407';
const LIVE_TEXT = { idle: 'Not connected', connecting: 'Connecting…', live: 'Live', offline: 'Offline' };
const HONEST = 'Parties run over a public live channel. Anyone with the code can join, names aren’t verified, '
  + 'there are no accounts and no message history, and nothing is saved on a server.';

const fnv = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
/** Procedural cover for a web game with no art (or art that fails to load) — same recipe as Static Play. */
function artBg(title) {
  const x = fnv(title);
  const a = x % 360;
  const b = (a + 40 + (x >> 8) % 90) % 360;
  return [
    `radial-gradient(70% 60% at ${20 + (x >> 6) % 50}% ${15 + (x >> 10) % 40}%,hsl(${b} 62% 58% / .8),transparent 62%)`,
    `radial-gradient(60% 70% at ${55 + (x >> 12) % 35}% ${70 + (x >> 14) % 25}%,hsl(${(b + 190) % 360} 62% 46% / .6),transparent 66%)`,
    `linear-gradient(${120 + (x >> 4) % 90}deg,hsl(${a} 55% 28%),hsl(${(a + 320) % 360} 48% 11%))`,
  ].join(',');
}
const initial = name => (String(name || '').trim().match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const secs = ms => Math.max(1, Math.ceil(ms / 1000));

defineApp({
  id: 'party',
  name: 'Static Party',
  icon: 'users',
  g1: G1, g2: G2,
  category: 'Games',
  keywords: ['party', 'friends', 'play together', 'multiplayer', 'invite', 'lobby', 'ready', 'group', 'code', 'host', 'co-op', 'squad'],
  desc: 'Start a party, invite friends with a code, pick a game and play together',
  singleton: true,
  win: { w: 1000, h: 650, minW: 420, minH: 480 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, fmt } = api;

    let dead = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); return t; };

    /* People are what this window shows, so the "who's on StaticOS" heartbeat
       runs while it is open (presence is shared; it is never stopped here). */
    presence.start();

    const S = {
      view: 'stage',        /* 'stage' | 'pick' (host's game picker) */
      q: '',
      joinMsg: null,        /* { tone: 'err' | 'info', text } */
      naming: false,        /* editing my display name */
      goNote: '',
      chatNote: '',
      pickToken: 0,
    };

    const shell = h('div.app.pt');
    root.appendChild(shell);

    /* ---------------- title bar: the channel's real state ---------------- */
    const liveChip = h('span.pt-live', { role: 'status' });
    win.setTools(liveChip);
    function paintLive(st) {
      liveChip.dataset.s = st;
      clear(liveChip);
      liveChip.append(h('i.pt-live__dot'), h('span', { text: LIVE_TEXT[st] || 'Offline' }));
      liveChip.title = st === 'offline'
        ? 'Offline — this network may block the live channel. It keeps retrying by itself.'
        : 'The public live channel (MQTT on a free public broker). No accounts, no history.';
    }

    /* ---------------- shared pieces ---------------- */
    function avatar(p, size = 32) {
      return h('span.pt-av', { style: { '--h': String(Number(p.color) || 0), '--s': `${size}px` }, 'aria-hidden': 'true' },
        h('span.pt-av__i', { text: initial(p.name) }));
    }

    function artBox(item, cls = '') {
      const box = h(`span.pt-art${cls ? `.${cls}` : ''}`);
      if (item.kind === 'arcade') {
        const a = arcadeById(item.id);
        box.classList.add('pt-art--arcade');
        box.style.setProperty('--hue', String(a ? a.hue : 200));
        box.append(icon(a ? a.icon : 'gamepad'));
      } else {
        box.style.background = artBg(item.title);
        box.append(h('span.pt-art__mono', { text: item.title }));
        if (item.art) {
          box.append(h('img', {
            src: item.art, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false',
            onload: e => e.target.classList.add('is-in'),
            onerror: e => e.target.remove(),
          }));
        }
      }
      return box;
    }

    const honest = cls => h(`p.pt-honest${cls ? `.${cls}` : ''}`, icon('shield'), h('span', { text: HONEST }));

    async function copyText(text, btn, label) {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
        const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' }, 'aria-hidden': 'true' });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
      }
      if (dead || !btn) return;
      btn.classList.add('is-flash');
      btn.dataset.flash = ok ? label : 'Couldn’t copy — select it by hand';
      clearTimeout(btn._flashT);
      btn._flashT = later(() => { btn.classList.remove('is-flash'); delete btn.dataset.flash; }, 1600);
    }

    /* ================================================================ *
     *  mode: lobby (no party) or party
     * ================================================================ */
    let mode = null;
    let L = null;            /* lobby element refs */
    let V = null;            /* party element refs */

    function sync() {
      if (dead) return;
      const cur = party.current();
      const want = cur ? 'party' : 'lobby';
      if (want !== mode) {
        mode = want;
        S.view = 'stage';
        S.naming = false;
        S.goNote = '';
        clear(shell);
        L = V = null;
        if (mode === 'lobby') buildLobby(); else buildParty();
      }
      if (mode === 'lobby') paintLobby(); else paintParty(cur);
      win.setSubtitle(cur ? cur.code : '');
    }

    /* ================================================================ *
     *  lobby
     * ================================================================ */
    function buildLobby() {
      const codeIn = h('input.pt-join__in', {
        type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '80',
        placeholder: 'ABC234', 'aria-label': 'Party code', enterkeyhint: 'go',
      });
      codeIn.addEventListener('input', () => { if (S.joinMsg) { S.joinMsg = null; paintLobby(); } });
      const joinBtn = h('button.btn', { type: 'submit' }, icon('arrow-right'), 'Join');
      const joinMsg = h('div.pt-join__msg', { 'aria-live': 'polite' });
      const form = h('form.pt-join', { onsubmit: e => { e.preventDefault(); doJoin(codeIn.value); } },
        h('div.field.pt-join__field', icon('link'), codeIn), joinBtn);
      const startBtn = h('button.btn.btn--primary.pt-start', { type: 'button', onclick: () => { S.joinMsg = null; party.create(); } },
        icon('plus'), 'Start a party');
      const rejoin = h('div.pt-rejoin');
      const you = h('div.pt-you');

      L = { codeIn, joinBtn, joinMsg, startBtn, rejoin, you, youMode: null, rejoinSig: null };
      shell.append(h('div.pt-lobby', h('div.pt-lobby__in',
        h('header.pt-hero',
          h('div.glyph.pt-hero__glyph', { style: { '--g1': G1, '--g2': G2, '--gs': '64px' } }, icon('users')),
          h('h2.pt-hero__t', { text: 'Play together' }),
          h('p.pt-hero__s', { text: 'Start a party, send the code to your friends, pick a game and press Play Together. Everyone plays on their own device.' })),
        h('div.pt-choices',
          h('section.pt-choice',
            h('div.pt-choice__ic', icon('sparkles')),
            h('b', { text: 'Start a party' }),
            h('small', { text: 'You get a 6-character code to share. As the host you pick the game and start it.' }),
            startBtn),
          h('section.pt-choice',
            h('div.pt-choice__ic', icon('link')),
            h('b', { text: 'Join a party' }),
            h('small', { text: 'Type the code a friend sent you.' }),
            form, joinMsg)),
        rejoin,
        you,
        honest())));
    }

    function paintLobby() {
      const pend = party.joining();
      const busy = !!pend;
      L.codeIn.disabled = busy;
      L.joinBtn.disabled = busy;
      L.startBtn.disabled = busy;

      clear(L.joinMsg);
      delete L.joinMsg.dataset.tone;
      if (pend) {
        L.joinMsg.append(h('span.spinner'), h('span', { text: pend.phase === 'connecting' ? 'Connecting to the live channel…' : `Looking for party ${pend.code}…` }));
      } else if (S.joinMsg) {
        L.joinMsg.dataset.tone = S.joinMsg.tone;
        L.joinMsg.append(icon(S.joinMsg.tone === 'err' ? 'alert' : 'info'), h('span', { text: S.joinMsg.text }));
      }

      const last = party.lastCode();
      const sig = `${last}|${busy}`;
      if (sig !== L.rejoinSig) {
        L.rejoinSig = sig;
        clear(L.rejoin);
        L.rejoin.hidden = !last || busy;
        if (last && !busy) {
          L.rejoin.append(
            icon('rotate-ccw'),
            h('span.grow', h('span', { text: 'Your last party on this device: ' }), h('b.pt-mono', { text: last })),
            h('button.btn.btn--sm', { type: 'button', onclick: () => doJoin(last) }, 'Rejoin'),
            h('button.ibtn.tip', { type: 'button', 'data-tip': 'Forget it', 'aria-label': 'Forget the last party code', onclick: () => party.forgetLast() }, icon('x')));
        }
      }
      paintYou();
    }

    /* "Others see you as …" — the one thing about you the party shows */
    function paintYou() {
      const box = mode === 'lobby' ? L?.you : V?.nameBox;
      if (!box) return;
      const m = identity.me();
      const want = S.naming ? 'edit' : `show:${m.name}:${m.color}`;
      const refs = mode === 'lobby' ? L : V;
      if (refs.youMode === want) return;
      refs.youMode = want;
      clear(box);
      if (S.naming) {
        const inp = h('input', { type: 'text', maxlength: '24', 'aria-label': 'Your display name', autocomplete: 'off', spellcheck: 'false' });
        inp.value = m.name;
        const done = save => {
          if (save) identity.setName(inp.value);
          S.naming = false;
          sync();
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
        box.append(h('form.pt-you__form', { onsubmit: e => { e.preventDefault(); done(true); } },
          h('div.field.grow', icon('user'), inp),
          h('button.btn.btn--sm.btn--primary', { type: 'submit' }, 'Save'),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => done(false) }, 'Cancel')),
        h('small.pt-you__hint', { text: 'Up to 24 characters. Anyone can pick any name here, so names prove nothing.' }));
        box.hidden = false;
        queueMicrotask(() => { if (inp.isConnected) { inp.focus(); inp.select(); } });
      } else if (mode === 'lobby') {
        box.append(avatar(m, 30),
          h('div.pt-you__t', h('small', { text: 'Others will see you as' }), h('b', { text: m.name })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.naming = true; paintYou(); } }, icon('edit-3'), 'Change'));
      } else {
        box.hidden = true;
      }
    }

    const joinErrorText = e => {
      if (!e) return '';
      if (e.reason === 'invalid') return e.code ? 'That isn’t a party code. Codes are 6 characters: letters and the digits 2–9 (never 0, O, 1 or I).' : 'Type the 6-character code first.';
      if (e.reason === 'offline') return 'Couldn’t reach the live channel. This network may block it, or the public broker is down. Try again in a bit, or on another network.';
      if (e.reason === 'empty') return `No one is in party ${e.code} right now. Check the code, or ask your friend to open their party first.`;
      if (e.reason === 'self') return `Party ${e.code} is open in another tab or window of this browser, and that’s you: every tab here shares one identity. Join from another device or browser.`;
      return '';
    };

    async function doJoin(raw) {
      S.joinMsg = null;
      const code = party.normalizeCode(raw);
      if (L && code) L.codeIn.value = code;
      const ok = await party.join(code);
      if (dead) return;
      if (!ok) {
        const text = joinErrorText(party.lastError());
        S.joinMsg = text ? { tone: 'err', text } : null;
        if (mode === 'lobby') paintLobby();
        else if (text) api.notify({ app: 'Static Party', icon: 'users', title: 'Couldn’t join', message: text });
      }
    }

    /* ================================================================ *
     *  party view
     * ================================================================ */
    function buildParty() {
      /* ---- sidebar: code, invite, members ---- */
      const codeBtn = h('button.pt-code__val', { type: 'button', 'aria-label': 'Copy the party code', onclick: () => copyText(party.current()?.code || '', codeBtn, 'Code copied') });
      const codeCopy = h('button.ibtn.pt-code__copy', { type: 'button', 'aria-label': 'Copy the party code', onclick: () => copyText(party.current()?.code || '', codeBtn, 'Code copied') }, icon('copy'));
      const inviteLine = h('span.pt-invite__t');
      const inviteBtn = h('button.pt-invite', { type: 'button', 'aria-label': 'Copy the invite message', onclick: () => copyText(party.inviteText(), inviteBtn, 'Invite copied') },
        inviteLine, h('span.pt-invite__act', icon('copy'), h('span', { text: 'Copy invite' })));
      const memCount = h('span.pt-count');
      const nameBox = h('div.pt-namebox', { hidden: true });
      const members = h('ul.pt-members', { 'aria-label': 'People in the party' });
      const leaveBtn = h('button.btn.btn--sm.pt-leave', { type: 'button', onclick: askLeave }, icon('power'), 'Leave party');

      const side = h('aside.app__side.pt-side',
        h('section.pt-code',
          h('div.side__label', { text: 'Party code' }),
          h('div.pt-code__row', codeBtn, codeCopy),
          inviteBtn),
        h('section.pt-crewlist',
          h('div.pt-crewlist__head', h('div.side__label', { text: 'In the party' }), memCount),
          nameBox,
          members),
        h('div.pt-side__foot', honest('pt-honest--side'), leaveBtn));

      /* ---- main: stage or game picker ---- */
      const backBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Back to the party', 'aria-label': 'Back to the party', onclick: () => setView('stage') }, icon('chevron-left'));
      const barTitle = h('div.app__title.pt-bar__t');
      const barSub = h('span.dim.pt-bar__sub');
      const pickIn = h('input', { type: 'search', placeholder: 'Search games…', spellcheck: 'false', 'aria-label': 'Search the catalogue and the Arcade' });
      let qT = 0;
      pickIn.addEventListener('input', () => {
        clearTimeout(qT); timers.delete(qT);
        qT = later(() => { S.q = pickIn.value.trim(); paintPicker(); }, 160);
      });
      const pickField = h('div.field.pt-bar__search', icon('search'), pickIn);
      const chooseBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => setView('pick') }, icon('gamepad'), h('span', { text: 'Choose game' }));
      const bar = h('div.app__bar.pt-bar', backBtn, h('div.pt-bar__txt', barTitle, barSub), h('div.grow'), pickField, chooseBtn);

      const bannerBox = h('div.pt-banners');
      const gameBox = h('div.pt-gamebox');
      const goSub = h('span.pt-go__sub');
      const goBtn = h('button.pt-go', { type: 'button', onclick: onGo },
        h('span.pt-go__main', icon('play', { fill: true }), h('span', { text: 'Play together' })), goSub);
      const readyIc = h('span.pt-ready__ic');
      const readyMain = h('span.pt-ready__main');
      const readySub = h('span.pt-ready__sub');
      const readyBtn = h('button.pt-ready', { type: 'button', 'aria-pressed': 'false', onclick: () => { const c = party.current(); if (c && !c.isHost) party.setReady(!c.ready); } },
        readyIc, h('span.pt-ready__txt', readyMain, readySub));
      const goNote = h('div.pt-gonote', { 'aria-live': 'polite' });
      const crewBox = h('div.pt-crew');
      const stage = h('div.app__content.pt-stage',
        h('div.pt-stage__in', bannerBox, gameBox, h('div.pt-act', goBtn, readyBtn), goNote, crewBox));

      const pickBody = h('div.pt-pick');
      const pick = h('div.app__content.pt-pickwrap', { hidden: true }, pickBody);
      const main = h('section.app__main.pt-main', bar, stage, pick);

      /* ---- chat ---- */
      const feed = h('ol.pt-feed');
      const feedWrap = h('div.pt-feedwrap', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Party chat and events' },
        h('div.pt-feed__intro', icon('info'), h('span', { text: 'Messages are live only: people who join later won’t see earlier ones, and nothing is kept after the party.' })),
        feed);
      const chatIn = h('input.pt-compose__in', {
        type: 'text', maxlength: String(party.TEXT_MAX), placeholder: 'Message the party…',
        'aria-label': 'Message the party', autocomplete: 'off', enterkeyhint: 'send',
      });
      const chatCount = h('span.pt-compose__count');
      chatIn.addEventListener('input', () => paintCompose());
      const sendBtn = h('button.ibtn.pt-compose__send', { type: 'submit', 'aria-label': 'Send' }, icon('send'));
      const chatHint = h('div.pt-compose__hint', { 'aria-live': 'polite' });
      const compose = h('form.pt-compose', { onsubmit: e => { e.preventDefault(); sendChat(); } },
        h('div.field.grow', chatIn, chatCount), sendBtn);
      const chat = h('section.pt-chat',
        h('div.app__bar.pt-chat__bar', icon('message-circle'), h('b', { text: 'Party chat' }), h('div.grow'), h('span.dim', { text: 'Live only' })),
        feedWrap, h('div.pt-compose__wrap', compose, chatHint));

      const partyEl = h('div.pt-party', side, main, chat);
      shell.append(partyEl);

      V = {
        partyEl, codeBtn, inviteLine, memCount, nameBox, members,
        backBtn, barTitle, barSub, pickIn, pickField, chooseBtn,
        stage, bannerBox, gameBox, goBtn, goSub, readyBtn, readyIc, readyMain, readySub, goNote, crewBox,
        pick, pickBody, feed, feedWrap, chatIn, chatCount, sendBtn, chatHint,
        feedKeys: [], gameSig: null, bannerSig: null, crewSig: null, youMode: null, pickBuilt: false,
      };
    }

    function setView(v) {
      const cur = party.current();
      if (!cur) return;
      S.view = v === 'pick' && cur.isHost ? 'pick' : 'stage';
      if (S.view === 'pick') {
        V.pickBuilt = false;
        queueMicrotask(() => { if (V?.pickIn.isConnected) V.pickIn.focus(); });
      } else if (V) {
        V.pickIn.value = '';
        S.q = '';
      }
      paintParty(cur);
    }

    async function askLeave() {
      const cur = party.current();
      if (!cur) return;
      const others = cur.members.length - 1;
      const yes = await api.confirm({
        title: 'Leave the party?',
        message: others
          ? `${cur.isHost ? 'Hosting passes to the next person. ' : ''}You can come back with the code ${cur.code} while someone is still in it.`
          : `You’re the only one here, so the party ends. The code ${cur.code} stays on this device in case you want to reopen it.`,
        ok: 'Leave', danger: true,
      });
      if (yes && !dead) party.leave();
    }

    function onGo() {
      const cur = party.current();
      if (!cur || !cur.isHost || !cur.game) return;
      if (cur.status !== 'live') S.goNote = 'The live channel is offline, so nobody would get it. Try again when it says Live.';
      else if (party.goWait() > 0) S.goNote = `Just sent. You can press it again in ${secs(party.goWait())} s.`;
      else if (!party.playTogether()) S.goNote = 'It didn’t go out — the live channel may have dropped. Try again.';
      else S.goNote = '';
      paintParty(party.current());
      if (S.goNote) later(() => { S.goNote = ''; if (mode === 'party') paintParty(party.current()); }, 6000);
    }

    function sendChat() {
      const text = V.chatIn.value;
      if (!text.trim()) return;
      const wait = party.chatWait();
      if (wait > 0) S.chatNote = `Slow down: one message a second, ten every 30 seconds. Try again in ${secs(wait)} s.`;
      else if (party.status() !== 'live') S.chatNote = 'Not sent: the live channel is offline.';
      else if (party.say(text)) { V.chatIn.value = ''; S.chatNote = ''; }
      else S.chatNote = 'Not sent — the live channel may have dropped.';
      paintCompose();
      if (S.chatNote) later(() => { S.chatNote = ''; paintCompose(); }, 5000);
    }

    /* ---------------- painting the party ---------------- */
    function paintParty(cur) {
      if (!V || !cur) return;
      if (S.view === 'pick' && !cur.isHost) S.view = 'stage';     /* hosting moved on while picking */
      const picking = S.view === 'pick';
      V.partyEl.classList.toggle('is-picking', picking);
      V.stage.hidden = picking;
      V.pick.hidden = !picking;
      paintSide(cur);
      paintBar(cur);
      if (picking) { if (!V.pickBuilt) { V.pickBuilt = true; paintPicker(); } else markChosen(cur); }
      else paintStage(cur);
      paintFeed(cur);
      paintCompose();
    }

    /* only write text that changed, so a repaint never drops a selection */
    const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

    function paintSide(cur) {
      setText(V.codeBtn, cur.code);
      setText(V.inviteLine, party.inviteText());
      setText(V.memCount, String(cur.members.length));
      V.memCount.title = plural(cur.members.length, 'person', 'people');
      paintYou();
      reconcile(V.members, cur.members, m => m.id, makeMember, (el, m) => updateMember(el, m, cur));
    }

    function reconcile(list, items, key, make, update) {
      const have = new Map([...list.children].map(el => [el.dataset.key, el]));
      let prev = null;
      for (const item of items) {
        const k = key(item);
        let el = have.get(k);
        if (el) have.delete(k); else el = make(item);
        update(el, item);
        const want = prev ? prev.nextSibling : list.firstChild;
        if (el !== want) list.insertBefore(el, want);
        prev = el;
      }
      have.forEach(el => el.remove());
    }

    function makeMember(m) {
      const r = {};
      r.av = avatar(m, 32);
      r.dot = h('i.pt-av__dot');
      r.av.append(r.dot);
      r.name = h('span.pt-mem__n');
      r.you = h('span.pt-mem__you', { text: 'you' });
      r.mute = h('span.pt-mem__muted', { title: 'Muted on this device' }, icon('volume-x'));
      r.sub = h('div.pt-mem__sub');
      const el = h('li.pt-mem', { dataset: { key: m.id } });
      r.more = h('button.ibtn.pt-mem__more', { type: 'button', 'aria-haspopup': 'menu', onclick: e => memberMenu(el.dataset.key, e.currentTarget) }, icon('more-horizontal'));
      el.append(r.av, h('div.pt-mem__body', h('div.pt-mem__top', r.name, r.you, r.mute), r.sub), r.more);
      el.addEventListener('contextmenu', e => { e.preventDefault(); memberMenu(el.dataset.key, null, e.clientX, e.clientY); });
      el._r = r;
      return el;
    }

    function updateMember(el, m, cur) {
      const r = el._r;
      r.av.style.setProperty('--h', String(Number(m.color) || 0));
      setText(r.av.firstChild, initial(m.name));
      const quietMs = Date.now() - m.seen;
      const quiet = !m.you && quietMs > party.QUIET_MS;
      const off = m.you && cur.status !== 'live';
      r.dot.dataset.s = off ? 'off' : quiet ? 'quiet' : 'on';
      setText(r.name, m.name);
      r.you.hidden = !m.you;
      r.mute.hidden = !m.muted;
      el.classList.toggle('is-host', m.isHost);
      el.classList.toggle('is-ready', m.ready);
      el.classList.toggle('is-muted', !!m.muted);
      r.more.setAttribute('aria-label', m.you ? 'Your options' : `Options for ${m.name}`);
      const role = m.isHost ? 'host' : m.ready ? 'ready' : 'wait';
      const flag = off ? 'off' : quiet ? 'quiet' : (m.status === 'away' || m.status === 'busy') ? m.status : '';
      const sig = `${role}|${flag}|${m.playing || ''}`;
      if (r.subSig === sig) return;
      r.subSig = sig;
      clear(r.sub);
      if (role === 'host') r.sub.append(h('span.pt-tag.pt-tag--host', icon('star', { fill: true }), h('span', { text: 'Host' })));
      else if (role === 'ready') r.sub.append(h('span.pt-tag.pt-tag--ready', icon('check'), h('span', { text: 'Ready' })));
      else r.sub.append(h('span.pt-tag', { text: 'Not ready' }));
      if (flag === 'off') r.sub.append(h('span.pt-tag.pt-tag--warn', { title: 'The live channel is offline, so no one can hear you right now', text: 'Offline' }));
      else if (flag === 'quiet') r.sub.append(h('span.pt-tag.pt-tag--warn', { title: 'Nothing heard from them for over 15 seconds. After 30 they drop out.', text: 'Quiet' }));
      else if (flag) r.sub.append(h('span.pt-tag', { text: flag === 'away' ? 'Away' : 'Busy' }));
      if (m.playing) r.sub.append(h('span.pt-mem__play', icon('gamepad'), h('span', { text: `Playing ${m.playing}` })));
    }

    function memberMenu(id, anchor, x, y) {
      const cur = party.current();
      const m = cur?.members.find(p => p.id === id);
      if (!m) return;
      if (anchor) { const b = anchor.getBoundingClientRect(); x = b.left; y = b.bottom + 4; }
      const items = m.you
        ? [{ header: true, label: 'You' }, { label: 'Change your name…', icon: 'edit-3', onClick: () => { S.naming = true; paintYou(); } }]
        : [{ header: true, label: m.name },
          m.muted
            ? { label: 'Unmute', icon: 'volume', onClick: () => party.unmute(m.id) }
            : { label: 'Mute (hide their messages)', icon: 'volume-x', onClick: () => party.mute(m.id) }];
      api.menu(items, x, y);
    }

    function paintBar(cur) {
      const picking = S.view === 'pick';
      const host = cur.members.find(m => m.isHost);
      V.backBtn.hidden = !picking;
      V.pickField.hidden = !picking;
      V.chooseBtn.hidden = picking || !cur.isHost;
      V.chooseBtn.lastChild.textContent = cur.game ? 'Change game' : 'Choose game';
      V.barTitle.textContent = picking ? 'Choose a game' : cur.game ? 'Up next' : 'Party';
      V.barSub.textContent = picking
        ? 'Everyone plays on their own device'
        : cur.isHost ? 'You’re the host' : `${host ? host.name : 'Someone'} is hosting`;
    }

    function paintStage(cur) {
      const others = cur.members.filter(m => !m.you);
      const nonHost = cur.members.filter(m => !m.isHost);
      const readyN = nonHost.filter(m => m.ready).length;
      const host = cur.members.find(m => m.isHost);
      const hostName = host ? host.name : 'the host';

      /* banners: the channel's state, and a game you were invited into */
      const go = cur.lastGo;
      const showGo = go && !go.opened && !cur.isHost && Date.now() - go.at < 30 * 60e3;
      const bsig = `${cur.status}|${showGo ? `${go.at}:${fmt.fmtAgo(new Date(go.at).toISOString())}` : ''}`;
      if (bsig !== V.bannerSig) {
        V.bannerSig = bsig;
        clear(V.bannerBox);
        if (cur.status !== 'live') {
          V.bannerBox.append(h('div.pt-banner.pt-banner--warn', icon(cur.status === 'offline' ? 'wifi-off' : 'wifi'),
            h('span.grow', { text: cur.status === 'offline'
              ? 'Offline — this network may block the live channel. Static Party keeps retrying; nobody can see you until it’s back.'
              : 'Connecting to the live channel…' })));
        }
        if (showGo) {
          V.bannerBox.append(h('div.pt-banner.pt-banner--go', icon('play', { fill: true }),
            h('span.grow', h('b', { text: `${go.by} started ${go.game.title}` }), h('span.dim', { text: ` · ${fmt.fmtAgo(new Date(go.at).toISOString())}` })),
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => party.playNow() }, icon('play'), 'Play')));
        }
      }

      /* the chosen game */
      const g = cur.game;
      const gsig = g ? `${g.kind}:${g.id}` : `none:${cur.isHost}:${hostName}`;
      if (gsig !== V.gameSig) {
        V.gameSig = gsig;
        clear(V.gameBox);
        V.gameBox.append(g ? gameCard(g) : noGame(cur.isHost, hostName));
      }

      /* the big button: PLAY TOGETHER for the host, the ready toggle for everyone else */
      V.goBtn.hidden = !cur.isHost;
      V.readyBtn.hidden = cur.isHost;
      if (cur.isHost) {
        const canGo = !!g && cur.status === 'live';
        V.goBtn.disabled = !canGo;
        V.goBtn.classList.toggle('is-all', !!g && nonHost.length > 0 && readyN === nonHost.length);
        V.goSub.textContent = !g ? 'Choose a game first'
          : cur.status !== 'live' ? 'Waiting for the live channel'
            : !nonHost.length ? 'No one else is here yet — it would just open for you'
              : readyN === nonHost.length
                ? (nonHost.length === 1 ? `${nonHost[0].name} is ready — ${g.title} opens for them too` : `Everyone’s ready — ${g.title} opens for all ${nonHost.length} of them`)
                : !readyN ? `No one’s ready yet — they’ll each get a Play button instead`
                  : `${readyN} of ${nonHost.length} ready — it opens by itself for them; the others get a Play button`;
      } else {
        V.readyBtn.classList.toggle('is-on', cur.ready);
        V.readyBtn.setAttribute('aria-pressed', String(cur.ready));
        clear(V.readyIc);
        V.readyIc.append(icon(cur.ready ? 'check-circle' : 'circle'));
        V.readyMain.textContent = cur.ready ? 'You’re ready' : 'I’m ready';
        V.readySub.textContent = cur.ready
          ? `When ${hostName} presses Play Together, ${g ? g.title : 'the game'} opens for you by itself. Tap to undo.`
          : `Tap when you’re set. Until then nothing opens by itself — you’ll get a Play button instead.`;
      }
      V.goNote.textContent = S.goNote;
      V.goNote.hidden = !S.goNote;

      /* who's ready — or the honest empty state when you're alone. While
         alone, the one real number worth showing is how many other devices
         said hello on the presence topic in the last minute (presence.js),
         with a way to reach them through Static Social when it's installed. */
      const around = others.length ? 0 : presence.online().length;
      const social = !others.length && around > 0 && !!api.getApp('social');
      const csig = others.length ? nonHost.map(m => `${m.id}:${m.ready}:${m.name}:${m.color}`).join(',') : `alone:${cur.code}:${social ? around : 0}`;
      if (csig !== V.crewSig) {
        V.crewSig = csig;
        clear(V.crewBox);
        if (!others.length) {
          const btn = h('button.btn.btn--sm', { type: 'button', onclick: () => copyText(party.inviteText(), btn, 'Invite copied') }, icon('copy'), 'Copy invite');
          V.crewBox.append(h('div.pt-alone', icon('users'),
            h('div.grow',
              h('b', { text: 'It’s just you so far' }),
              h('small', { text: `Send the code ${cur.code} to a friend. They open Static Party, choose Join and type it in.` }),
              social ? h('small.pt-alone__more', { text: `${plural(around, 'other person is', 'other people are')} on the live channel right now. You can invite someone from Static Social.` }) : null),
            h('div.pt-alone__acts', btn,
              social ? h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('social') }, icon('message-circle'), 'Open Social') : null)));
        } else if (nonHost.length) {
          V.crewBox.append(
            h('div.pt-crew__faces', nonHost.map(m => h(`span.pt-crew__face${m.ready ? '.is-ready' : ''}`, { title: `${m.name}: ${m.ready ? 'ready' : 'not ready'}` },
              avatar(m, 28), m.ready ? h('i.pt-crew__tick', icon('check')) : null))),
            h('span.pt-crew__t', { text: `${readyN} of ${nonHost.length} ready` }));
        }
      }
    }

    function gameMeta(g) {
      if (g.kind === 'arcade') {
        const a = arcadeById(g.id);
        return a ? `${a.blurb} Built into StaticOS: it runs separately on each device, so compare scores in the chat.` : 'Built into StaticOS.';
      }
      const row = catalogue.isLoaded() ? catalogue.byId(g.id) : null;
      const cats = row ? row.cats.filter(c => c !== 'featured').slice(0, 3).map(c => catalogue.catMeta(c).name).join(' · ') : '';
      return `${cats ? `${cats}. ` : ''}Opens in Static Games on each person’s device.`;
    }

    /* The caption is a sibling of the art, not inside it: on a roomy stage
       it overlays the cover (same grid cell), on a short one the card turns
       into a thumbnail with the caption beside it, so the big button below
       always stays in view (css: @container ptstage). */
    function gameCard(g) {
      return h('article.pt-game',
        h('div.pt-game__art', artBox(g, 'pt-art--fill'), h('span.pt-game__shade')),
        h('div.pt-game__cap',
          h('span.pt-game__kind', icon(g.kind === 'arcade' ? 'zap' : 'globe'), h('span', { text: g.kind === 'arcade' ? 'Arcade' : 'Web game' })),
          h('div.pt-game__t', { text: g.title })),
        h('p.pt-game__meta', { text: gameMeta(g) }));
    }

    function noGame(isHost, hostName) {
      return h('div.pt-nogame', icon('gamepad'),
        h('b', { text: isHost ? 'No game chosen yet' : `Waiting for ${hostName} to choose a game` }),
        h('small', { text: isHost ? 'Pick one from the Arcade or the catalogue. Everyone in the party sees it straight away.' : 'It will show up here the moment they pick one. You can mark yourself ready already.' }),
        isHost ? h('button.btn.btn--primary', { type: 'button', onclick: () => setView('pick') }, icon('gamepad'), 'Choose a game') : null);
    }

    /* ---------------- chat + party events ---------------- */
    function feedEntries(cur) {
      const out = [];
      for (const c of cur.chat) out.push({ key: `c${c.mid}`, n: c.mid, type: 'chat', ...c });
      for (const e of cur.events) out.push({ key: `e${e.eid}`, n: e.eid, type: 'sys', ...e });
      return out.sort((a, b) => a.n - b.n);
    }

    function timeOf(at) {
      const h24 = !!store.get('prefs.h24');
      const c = fmt.fmtClock(new Date(at), h24);
      return h24 ? c.time : `${c.time} ${c.ap}`;
    }

    function feedItem(e, prev) {
      if (e.type === 'sys') {
        const ic = { join: 'user', leave: 'arrow-left', host: 'star', game: 'gamepad', go: 'play', you: 'users', name: 'edit-3' }[e.kind] || 'info';
        return h('li.pt-sys', { dataset: { key: e.key } }, icon(ic), h('span', { text: e.text }), h('time', { text: timeOf(e.at) }));
      }
      const cont = prev && prev.type === 'chat' && prev.id === e.id && e.at - prev.at < 3 * 60e3;
      return h(`li.pt-msg${cont ? '.is-cont' : ''}${e.mine ? '.is-mine' : ''}`, { dataset: { key: e.key } },
        cont ? h('span.pt-msg__gap') : avatar(e, 26),
        h('div.pt-msg__body',
          cont ? null : h('div.pt-msg__head', h('b', { text: e.name }), h('time', { text: timeOf(e.at) })),
          h('div.pt-msg__text', { text: e.text })));
    }

    function paintFeed(cur) {
      const entries = feedEntries(cur);
      const keys = entries.map(e => e.key);
      const wrap = V.feedWrap;
      const atEnd = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40;
      const same = V.feedKeys.length <= keys.length && V.feedKeys.every((k, i) => keys[i] === k);
      if (!same) { clear(V.feed); V.feedKeys = []; }
      if (keys.length === V.feedKeys.length) return;
      for (let i = V.feedKeys.length; i < entries.length; i++) V.feed.append(feedItem(entries[i], entries[i - 1]));
      V.feedKeys = keys;
      if (atEnd || !same) wrap.scrollTop = wrap.scrollHeight;
    }

    function paintCompose() {
      if (!V) return;
      const len = V.chatIn.value.length;
      V.chatCount.textContent = len > party.TEXT_MAX - 80 ? `${len}/${party.TEXT_MAX}` : '';
      const off = party.status() !== 'live';
      V.chatHint.textContent = S.chatNote || (off ? 'Messages can’t go out while the live channel is offline.' : '');
      V.chatHint.dataset.tone = S.chatNote ? 'warn' : '';
    }

    /* ---------------- the host's game picker ---------------- */
    function arcItem(a) { return { kind: 'arcade', id: a.id, title: a.title, art: null, meta: `Arcade · ~${a.minutes} min` }; }
    function webItem(g) {
      const cat = (g.cats || []).find(c => c !== 'featured');
      return { kind: 'web', id: g.id, title: cleanText(g.title) || g.id, art: g.art || null, meta: cat ? catalogue.catMeta(cat).name : 'Web game' };
    }

    function tile(item, chosen) {
      const on = !!chosen && chosen.kind === item.kind && chosen.id === item.id;
      return h(`button.pt-tile${on ? '.is-on' : ''}`, {
        type: 'button', dataset: { key: `${item.kind}:${item.id}` }, 'aria-label': `Choose ${item.title}`,
        onclick: () => pickGame(item),
      },
        artBox(item, 'pt-tile__art'),
        h('span.pt-tile__t', { text: item.title }),
        h('span.pt-tile__m', { text: item.meta }),
        h('span.pt-tile__on', icon('check'), 'Chosen'));
    }

    function shelf(title, sub, items, chosen) {
      return h('section.pt-shelf',
        h('div.pt-shelf__head', h('div.label', { text: title }), sub ? h('small', { text: sub }) : null),
        h('div.pt-tiles', items.map(it => tile(it, chosen))));
    }

    async function paintPicker() {
      if (!V) return;
      const token = ++S.pickToken;
      const body = V.pickBody;
      const chosen = party.current()?.game || null;
      if (!catalogue.isLoaded()) {
        clear(body);
        body.append(h('div.pt-loading', h('span.spinner'), h('span', { text: 'Loading the games catalogue…' })));
      }
      try { await catalogue.load(); } catch (e) { /* it falls back to the curated shelf */ }
      if (dead || !V || token !== S.pickToken) return;
      clear(body);
      const q = S.q.toLowerCase();
      if (q) {
        const arc = ARCADE.filter(a => `${a.title} ${a.blurb} ${a.tags.join(' ')}`.toLowerCase().includes(q)).map(arcItem);
        const web = catalogue.query({ q, perPage: 48 });
        if (!arc.length && !web.total) {
          body.append(h('div.empty.pt-pick__empty', icon('search'), h('b', { text: 'Nothing matches' }), h('small', { text: `No Arcade or catalogue game matches “${S.q}”.` })));
          return;
        }
        if (arc.length) body.append(shelf('Arcade', plural(arc.length, 'game'), arc, chosen));
        if (web.total) {
          body.append(shelf('Web games', web.total > web.items.length
            ? `best ${web.items.length} of ${web.total.toLocaleString()} matches` : plural(web.total, 'match', 'matches'),
          web.items.map(webItem), chosen));
        }
        return;
      }
      body.append(shelf('Arcade', 'built into StaticOS · starts instantly on every device', ARCADE.map(arcItem), chosen));
      const recent = plays.recent(30)
        .map(r => (r.kind === 'arcade' ? (arcadeById(r.id) ? arcItem(arcadeById(r.id)) : null) : r.kind === 'web' ? (catalogue.byId(r.id) ? webItem(catalogue.byId(r.id)) : null) : null))
        .filter(Boolean).slice(0, 8);
      if (recent.length) body.append(shelf('Played on this device', 'most recent first', recent, chosen));
      const favIds = store.get('portal.games.favs', []);
      const favs = (Array.isArray(favIds) ? favIds : []).filter(x => typeof x === 'string').map(id => catalogue.byId(id)).filter(Boolean).slice(0, 12).map(webItem);
      if (favs.length) body.append(shelf('Your favourites', plural(favs.length, 'game'), favs, chosen));
      const io = catalogue.query({ category: 'io', sort: 'popular', perPage: 12 });
      if (io.total) body.append(shelf('Online .io games', 'each person joins from their own device; whether you share a room depends on the game', io.items.map(webItem), chosen));
      body.append(h('p.pt-pick__more', icon('search'), h('span', { text: `Search above to pick from all ${catalogue.stats().total.toLocaleString()} games in the catalogue.` })));
    }

    function markChosen(cur) {
      const k = cur.game ? `${cur.game.kind}:${cur.game.id}` : '';
      V.pickBody.querySelectorAll('.pt-tile').forEach(t => t.classList.toggle('is-on', t.dataset.key === k));
    }

    async function pickGame(item) {
      const ok = await party.chooseGame({ kind: item.kind, id: item.id, title: item.title, art: item.art });
      if (dead || !V) return;
      if (ok) setView('stage');
      else api.notify({ app: 'Static Party', icon: 'users', title: 'Couldn’t choose that game', message: 'Only the host can choose, and the game has to be in this device’s catalogue.' });
    }

    /* ---------------- keys ---------------- */
    function onKey(e) {
      if (e.key === 'Escape' && mode === 'party' && S.view === 'pick') {
        e.preventDefault();
        setView('stage');
      }
    }
    root.addEventListener('keydown', onKey);

    /* ---------------- wiring ---------------- */
    const repaint = () => { if (!dead && mode === 'party') { const c = party.current(); if (c) paintParty(c); } };
    const offs = [
      party.onChange(() => sync()),
      live.onStatus(st => { paintLive(st); repaint(); }),
      presence.onChange(repaint),
    ];
    /* seconds-based bits (a member going quiet at 15 s, "2m ago"). Every
       paint is diffed against a signature, so a short tick costs little. */
    const tick = setInterval(repaint, 2000);

    /* { code } comes from a click somewhere else (an invite in Social, a
       link): that click is the consent to join. Already in a different
       party? Ask before leaving it. */
    async function handleOpts(o) {
      if (!o || dead) return;
      if (o.code && !party.joining()) {
        const code = party.normalizeCode(String(o.code));
        const cur = party.current();
        if (!cur) doJoin(code);
        else if (party.isCode(code) && code !== cur.code) {
          const yes = await api.confirm({
            title: `Switch to party ${code}?`,
            message: `You’ll leave party ${cur.code}${cur.isHost && cur.members.length > 1 ? ' and hosting passes to the next person' : ''}. If no one is in ${code}, you stay where you are.`,
            ok: 'Switch',
          });
          if (yes && !dead) doJoin(code);
        }
      }
      if (o.view === 'pick') setView('pick');
    }
    win.onReopen(o => handleOpts(o));

    sync();
    handleOpts(opts);

    return () => {
      dead = true;
      clearInterval(tick);
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      offs.forEach(off => off?.());
      root.removeEventListener('keydown', onKey);
    };
  },
});
