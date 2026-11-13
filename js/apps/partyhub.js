/* ============================================================
   partyhub.js — Party Hub: find a party, talk about the
   multiplayer games in the catalogue, and jump into one together.

   HONEST NETWORKING. StaticOS is a static site — there is no
   server behind it, so there is no way to reach real strangers on
   other devices, and this app never pretends there is. Instead it
   connects the StaticOS windows and tabs open in ONE browser:

     · every party and every chat message is delivered live to the
       other Hub windows in this browser through a BroadcastChannel
       (real cross-tab messaging), and persisted so a reload keeps
       it (portal.partyhub);
     · the "here now" count is a MEASURED number — each open Hub
       window heartbeats on the channel, and the count is the seats
       that answered in the last few seconds, nothing invented.

   So it is genuine local matchmaking: pass the laptop around, or
   open a second tab, pick a different name in each, and the two
   seats see the same board and can talk. People on other machines
   won't see it — the app says so plainly, up front.

   The multiplayer catalogue is the real games index behind
   static://games (js/portal/games.data.js). A game counts as
   multiplayer when its own tags or categories say so (multiplayer,
   .io, 2-player, co-op, versus…) — 300-odd real rows, not a
   hand-picked few. Play numbers only ever show when the feed
   actually reported them (hasStats).

   Self-contained: this file and css/feat-partyhub.css only. No
   shell imports beyond the app API and the catalogue index.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as CAT from '../portal/games.data.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-partyhub-css')) {
  const l = document.createElement('link');
  l.id = 'feat-partyhub-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-partyhub.css';
  document.head.appendChild(l);
}

/* ---------------- tuning ---------------- */
const BC_NAME    = 'staticos.partyhub.v1';
const STORE_KEY  = 'portal.partyhub';
const MAX_PARTIES = 40;
const MAX_MSGS    = 80;          /* per room, oldest dropped */
const MSG_LEN     = 500;
const NAME_LEN    = 24;
const NOTE_LEN    = 120;
const PING_MS     = 4000;
const PEER_TTL    = 13000;       /* a tab silent this long has left */
const LOUNGE      = 'lounge';

/* a game is multiplayer when it says so itself, in its tags or cats */
const MP_RE = /multiplayer|multi-player|\bio\b|2\s*player|two\s*player|co-?op|versus|\bpvp\b|arena|battle royale|\.io/;
function mpSignal(g) {
  const tags = (g.tags || []).map(s => String(s).toLowerCase());
  const cats = (g.cats || []).map(s => String(s).toLowerCase());
  const hay = [...tags, ...cats].join(' ');
  if (!MP_RE.test(hay)) return null;
  if (hay.includes('multiplayer')) return 'Multiplayer';
  if (tags.includes('io') || cats.includes('io') || hay.includes('.io')) return '.io';
  if (/2\s*player|two\s*player/.test(hay)) return '2-player';
  if (/co-?op/.test(hay)) return 'Co-op';
  if (/versus|\bpvp\b/.test(hay)) return 'Versus';
  if (hay.includes('arena')) return 'Arena';
  if (hay.includes('battle royale')) return 'Battle royale';
  return 'Multiplayer';
}

const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; };
const nowMs = () => Date.now();
const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}${nowMs().toString(36).slice(-4)}`;

/* one id for this whole page/tab, stable for its lifetime */
const TAB_ID = rid('tab');

/* ============================================================
   Hub — one shared brain per browser tab. Every Hub window in
   this tab shares its state object; other tabs sync over the
   BroadcastChannel. Ref-counted so the channel and the heartbeat
   are torn all the way down when the last window closes.
   ============================================================ */
const Hub = {
  refs: 0,
  state: null,          /* { parties:[], chats:{room:[msg]} } */
  bc: null,
  pingTimer: 0,
  reapTimer: 0,
  saveTimer: 0,
  store: null,          /* captured api.store */
  windows: new Set(),   /* live seats in THIS tab: { seatId, name, repaint } */
  peers: new Map(),     /* tabId -> { seats:[{seatId,name}], ts } */
};

function validParty(p) {
  return p && typeof p === 'object' && typeof p.id === 'string'
    && typeof p.gameId === 'string' && Array.isArray(p.members);
}
function validMsg(m) {
  return m && typeof m === 'object' && typeof m.id === 'string' && typeof m.text === 'string';
}

function loadState() {
  const s = { parties: [], chats: {} };
  const raw = Hub.store ? Hub.store.get(STORE_KEY, null) : null;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.parties)) s.parties = raw.parties.filter(validParty).slice(0, MAX_PARTIES);
    if (raw.chats && typeof raw.chats === 'object') {
      for (const [k, v] of Object.entries(raw.chats)) {
        if (Array.isArray(v)) s.chats[String(k)] = v.filter(validMsg).slice(-MAX_MSGS);
      }
    }
  }
  return s;
}

function schedulePersist() {
  if (!Hub.store) return;
  clearTimeout(Hub.saveTimer);
  Hub.saveTimer = setTimeout(persistNow, 250);
}
function persistNow() {
  clearTimeout(Hub.saveTimer); Hub.saveTimer = 0;
  if (!Hub.store || !Hub.state) return;
  /* store.set no-ops unless it is a NEW object/array — always rebuild.
     Preserve the person's saved display name, which lives under the same key. */
  const prev = Hub.store.get(STORE_KEY, {}) || {};
  const chats = {};
  for (const [k, v] of Object.entries(Hub.state.chats)) chats[k] = v.slice(-MAX_MSGS);
  Hub.store.set(STORE_KEY, { myName: prev.myName, parties: Hub.state.parties.map(p => ({ ...p })), chats });
}

function bcast(obj) {
  if (!Hub.bc) return;
  try { Hub.bc.postMessage({ ...obj, tabId: TAB_ID }); } catch (e) { /* channel gone */ }
}

function repaintAll() { for (const w of Hub.windows) { try { w.repaint(); } catch (e) {} } }
function repaintPresence() { for (const w of Hub.windows) { try { w.repaintPresence(); } catch (e) {} } }

/* Coalesce a burst of mutations (a merge, a rapid exchange) into ONE repaint,
   and always repaint EVERY open window — including other Hub windows in this
   same page — not just whichever one made the change. */
let repaintQueued = false;
function notifyChange() {
  if (repaintQueued) return;
  repaintQueued = true;
  Promise.resolve().then(() => { repaintQueued = false; repaintAll(); });
}

/* ---- state mutations (local=true also tells the other tabs) ---- */
function applyParty(p) {
  if (!validParty(p)) return false;
  const i = Hub.state.parties.findIndex(x => x.id === p.id);
  if (i < 0) { Hub.state.parties = [p, ...Hub.state.parties].slice(0, MAX_PARTIES); return true; }
  /* whole-party last-writer-wins: join/leave/close all bump updatedAt */
  if ((p.updatedAt || 0) >= (Hub.state.parties[i].updatedAt || 0)) {
    Hub.state.parties = Hub.state.parties.map((x, j) => (j === i ? p : x));
    return true;
  }
  return false;
}
function upsertParty(p, local) {
  const changed = applyParty(p);
  if (changed) { if (local) bcast({ t: 'party', party: p }); schedulePersist(); notifyChange(); }
  return changed;
}
function removeParty(id, local) {
  const before = Hub.state.parties.length;
  Hub.state.parties = Hub.state.parties.filter(p => p.id !== id);
  if (Hub.state.parties.length !== before) {
    if (local) bcast({ t: 'party-del', partyId: id });
    schedulePersist(); notifyChange();
  }
}
function addMsg(room, msg, local) {
  if (!validMsg(msg)) return;
  const list = Hub.state.chats[room] || (Hub.state.chats[room] = []);
  if (list.some(m => m.id === msg.id)) return;      /* idempotent */
  list.push(msg);
  if (list.length > MAX_MSGS) list.splice(0, list.length - MAX_MSGS);
  if (local) bcast({ t: 'msg', room, message: msg });
  schedulePersist(); notifyChange();
}
function mergeFull(data) {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data.parties)) for (const p of data.parties) applyParty(p);
  if (data.chats && typeof data.chats === 'object') {
    for (const [room, list] of Object.entries(data.chats)) {
      if (Array.isArray(list)) for (const m of list) addMsg(String(room), m, false);
    }
  }
  schedulePersist();
}

/* ---- presence (all measured) ---- */
function heartbeat() {
  const seats = [...Hub.windows].map(w => ({ seatId: w.seatId, name: w.name }));
  bcast({ t: 'ping', seats, ts: nowMs() });
}
function reap() {
  const t = nowMs(); let changed = false;
  for (const [id, p] of Hub.peers) if (t - p.ts > PEER_TTL) { Hub.peers.delete(id); changed = true; }
  if (changed) repaintPresence();
}
/** every live seat this browser can see right now: local windows + remote tabs */
function liveSeats() {
  const t = nowMs();
  const out = [];
  for (const w of Hub.windows) out.push({ seatId: w.seatId, name: w.name, self: true });
  for (const [, peer] of Hub.peers) {
    if (t - peer.ts > PEER_TTL) continue;
    for (const s of peer.seats) out.push({ seatId: s.seatId, name: s.name, self: false });
  }
  return out;
}

function onBc(e) {
  const m = e && e.data;
  if (!m || typeof m !== 'object' || m.tabId === TAB_ID) return;
  switch (m.t) {
    case 'ping':
      Hub.peers.set(m.tabId, { seats: Array.isArray(m.seats) ? m.seats.map(s => ({ seatId: String(s.seatId || ''), name: clip(s.name, NAME_LEN) })) : [], ts: nowMs() });
      repaintPresence();
      break;
    case 'hello':                       /* a new tab arrived — catch it up */
      sendFull(); heartbeat();
      break;
    case 'bye':
      Hub.peers.delete(m.tabId); repaintPresence();
      break;
    case 'full':                        /* mutations inside notify; nudge once more */
      mergeFull(m.data); notifyChange();
      break;
    case 'party':
      upsertParty(m.party, false);
      break;
    case 'party-del':
      removeParty(m.partyId, false);
      break;
    case 'msg':
      addMsg(String(m.room || LOUNGE), m.message, false);
      break;
  }
}
function sendFull() {
  const chats = {};
  for (const [k, v] of Object.entries(Hub.state.chats)) chats[k] = v.slice(-MAX_MSGS);
  bcast({ t: 'full', data: { parties: Hub.state.parties.map(p => ({ ...p })), chats } });
}

function acquireHub(store) {
  if (Hub.refs === 0) {
    Hub.store = store;
    Hub.state = loadState();
    Hub.peers.clear();
    if (typeof BroadcastChannel === 'function') {
      try { Hub.bc = new BroadcastChannel(BC_NAME); Hub.bc.onmessage = onBc; } catch (e) { Hub.bc = null; }
    }
    Hub.pingTimer = setInterval(heartbeat, PING_MS);
    Hub.reapTimer = setInterval(reap, PING_MS);
    bcast({ t: 'hello' });
  }
  Hub.refs++;
}
function releaseHub() {
  Hub.refs = Math.max(0, Hub.refs - 1);
  if (Hub.refs === 0) {
    persistNow();
    bcast({ t: 'bye' });
    if (Hub.bc) { try { Hub.bc.onmessage = null; Hub.bc.close(); } catch (e) {} Hub.bc = null; }
    clearInterval(Hub.pingTimer); clearInterval(Hub.reapTimer); clearTimeout(Hub.saveTimer);
    Hub.pingTimer = Hub.reapTimer = Hub.saveTimer = 0;
    Hub.peers.clear();
  }
}

/* ============================================================
   The app
   ============================================================ */
defineApp({
  id: 'partyhub',
  name: 'Party Hub',
  icon: 'users',
  g1: '#ff5c8a', g2: '#7c3aed',
  category: 'Games',
  keywords: ['multiplayer', 'party', 'hub', 'lobby', 'co-op', 'coop', 'versus', 'friends', 'matchmaking', 'chat', 'lan'],
  desc: 'Find a party and talk about the multiplayer games in the catalogue',
  singleton: false,
  win: { w: 940, h: 620, minW: 360, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, fmt, notify } = api;

    acquireHub(store);

    /* ---- this window's seat ---- */
    const u = store.get('session.user', null);
    const seat = {
      seatId: rid('seat'),
      name: clip((store.get(STORE_KEY, {}) || {}).myName || (u && (u.name || u.username)) || 'Player', NAME_LEN),
      repaint: () => paint(),
      repaintPresence: () => paintPresence(),
    };
    Hub.windows.add(seat);
    heartbeat();

    const reduce = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ---- view state (this window only) ---- */
    const S = { view: 'lounge', partyId: null, gameQuery: '', catReady: CAT.isLoaded() };

    /* the multiplayer slice of the catalogue, computed once it is loaded */
    let mpGames = [];
    function computeMp() {
      const rows = CAT.all();
      mpGames = [];
      for (const g of rows) { const sig = mpSignal(g); if (sig) mpGames.push({ g, sig }); }
    }
    if (S.catReady) computeMp();
    else {
      CAT.load().then(() => { S.catReady = true; computeMp(); if (S.view === 'games' || S.view === 'new') paintMain(); })
        .catch(() => { S.catReady = true; computeMp(); if (S.view === 'games' || S.view === 'new') paintMain(); });
    }

    /* ---- identity helpers ---- */
    const meMember = () => ({ id: seat.seatId, name: seat.name, at: nowMs() });
    const inParty = (p) => !!p && p.members.some(m => m.id === seat.seatId);
    const isHost = (p) => !!p && p.host && p.host.id === seat.seatId;
    const myParties = () => Hub.state.parties.filter(inParty);
    const roomOfParty = (id) => `party:${id}`;
    const gameById = (id) => CAT.byId(id) || null;

    /* ================= DOM SHELL ================= */
    /* built once; paint() refreshes the dynamic bits so inputs keep focus */
    const presPill = h('button.ph__pres.tip', {
      type: 'button', 'data-tip': 'Who is connected in this browser', 'aria-label': 'People here now',
    });
    const nameInput = h('input.ph__name', {
      type: 'text', value: seat.name, maxLength: NAME_LEN, 'aria-label': 'Your display name',
      spellcheck: 'false',
    });
    nameInput.addEventListener('input', () => {
      seat.name = clip(nameInput.value, NAME_LEN) || 'Player';
      Hub.store.patch(STORE_KEY, { myName: seat.name });
      heartbeat(); paintPresence(); paint();
    });
    nameInput.addEventListener('blur', () => { if (!seat.name.trim()) { seat.name = 'Player'; nameInput.value = 'Player'; } });

    const navWrap = h('div.side__group');
    const joinedWrap = h('div.side__group.ph__joined');

    const NAVS = [
      { id: 'lounge', label: 'Lounge', icon: 'message-circle' },
      { id: 'parties', label: 'Parties', icon: 'users' },
      { id: 'games', label: 'Multiplayer games', icon: 'gamepad' },
    ];
    const navBtns = new Map();
    for (const n of NAVS) {
      const cnt = h('small');
      const b = h('button.side__item', { type: 'button', onclick: () => go(n.id) },
        icon(n.icon), h('span', { text: n.label }), cnt);
      b._count = cnt;
      navBtns.set(n.id, b);
      navWrap.appendChild(b);
    }

    const side = h('aside.app__side.app__side--wide.ph__side',
      h('div.ph__mehead',
        h('div.ph__meline',
          h('span.ph__avatar', { 'aria-hidden': 'true' }),
          h('div.ph__mewho',
            h('label.ph__melabel', { for: 'ph-name-' + seat.seatId, text: 'You' }),
            nameInput)),
        presPill),
      navWrap,
      h('div.side__group.ph__partygroup', h('div.side__label', { text: 'Your parties' }), joinedWrap),
      h('div.ph__foot',
        h('span.ph__footdot', { 'aria-hidden': 'true' }),
        h('small', { text: 'Local to this browser — no server. Parties and chat sync live across your StaticOS tabs; other devices won’t see them.' })),
    );
    nameInput.id = 'ph-name-' + seat.seatId;

    const mainTitle = h('div.app__title');
    const mainSub = h('div.ph__sub');
    const barActions = h('div.ph__baractions');
    const bar = h('header.app__bar.ph__bar',
      h('button.ibtn.ph__back', { type: 'button', 'aria-label': 'Back', title: 'Back', onclick: () => go(S.viewBack || 'parties') }, icon('arrow-left')),
      h('div.ph__barhead', mainTitle, mainSub), barActions);
    const content = h('div.app__content.ph__content');
    const main = h('div.app__main', bar, content);

    const shell = h('div.app.ph', side, main);
    root.appendChild(shell);

    /* narrow / phone layout without relying on window media queries */
    const setNarrow = (w) => shell.classList.toggle('is-narrow', w < 660);
    setNarrow(root.clientWidth || win.w || 940);
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => { for (const en of entries) setNarrow(en.contentRect.width); });
      ro.observe(root);
    }

    /* ================= NAV ================= */
    function go(view, partyId) {
      if (view === 'party') { S.partyId = partyId; }
      S.view = view;
      paint();
      /* focus the composer / search when arriving */
      requestAnimationFrame(() => {
        const f = content.querySelector('[data-autofocus]');
        if (f) try { f.focus(); } catch (e) {}
      });
    }

    /* ================= PAINT ================= */
    function paint() {
      paintPresence();
      paintNav();
      paintJoined();
      paintMain();
    }

    function paintPresence() {
      const seats = liveSeats();
      const names = [...new Set(seats.map(s => s.name || 'Player'))];
      const n = seats.length;
      clear(presPill);
      presPill.append(
        h('span.ph__presdot' + (reduce() ? '' : '.is-live'), { 'aria-hidden': 'true' }),
        h('b', { text: String(n) }),
        h('span', { text: n === 1 ? ' seat here' : ' seats here' }),
      );
      presPill.title = names.length
        ? 'Here now: ' + names.join(', ')
        : 'Just this window';
    }

    function paintNav() {
      for (const [id, b] of navBtns) b.classList.toggle('is-on', S.view === id);
      navBtns.get('parties')._count.textContent = Hub.state.parties.length ? String(Hub.state.parties.length) : '';
      navBtns.get('games')._count.textContent = S.catReady && mpGames.length ? String(mpGames.length) : '';
      const lounge = (Hub.state.chats[LOUNGE] || []);
      navBtns.get('lounge')._count.textContent = lounge.length ? String(lounge.length) : '';
    }

    function paintJoined() {
      clear(joinedWrap);
      const mine = myParties();
      if (!mine.length) {
        joinedWrap.appendChild(h('div.ph__joinednone', { text: 'None yet' }));
        return;
      }
      for (const p of mine) {
        const g = gameById(p.gameId);
        const b = h('button.side__item' + (S.view === 'party' && S.partyId === p.id ? '.is-on' : ''), {
          type: 'button', onclick: () => go('party', p.id),
        }, icon('gamepad'), h('span', { text: g ? g.title : p.gameTitle }),
          h('small', { text: `${p.members.length}/${p.cap}` }));
        joinedWrap.appendChild(b);
      }
    }

    function paintMain() {
      clear(content);
      bar.classList.remove('has-back');
      barActions && clear(barActions);
      if (S.view === 'lounge') return viewChat(LOUNGE, 'Lounge', 'Talk about anything — everyone in this browser sees it live');
      if (S.view === 'parties') return viewParties();
      if (S.view === 'games') return viewGames();
      if (S.view === 'new') return viewNewParty();
      if (S.view === 'party') return viewParty();
    }

    /* ================= CHAT VIEW ================= */
    /* returns an object so incoming messages refresh only the list */
    function chatPanel(room) {
      const list = h('div.ph-chat__list', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' });
      const input = h('input.ph-compose__in', {
        type: 'text', placeholder: 'Message', maxLength: MSG_LEN,
        'aria-label': 'Write a message', 'data-autofocus': '1', autocomplete: 'off',
      });
      const sendBtn = h('button.btn.btn--primary.btn--sm', { type: 'button', 'aria-label': 'Send' }, icon('send'), h('span', { text: 'Send' }));

      function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 60; }
      function renderList() {
        const stick = nearBottom();
        clear(list);
        const msgs = Hub.state.chats[room] || [];
        if (!msgs.length) {
          list.appendChild(h('div.ph-chat__empty',
            icon('message-circle'),
            h('b', { text: 'No messages yet' }),
            h('small', { text: 'Say hi. Anyone in another StaticOS tab on this browser will see it live.' })));
          return;
        }
        let lastWho = null, lastAt = 0;
        for (const m of msgs) {
          const mine = m.authorSeat === seat.seatId || (m.authorName && m.authorName === seat.name && !m.authorSeat);
          const run = lastWho === m.authorSeat && (m.at - lastAt) < 5 * 60000;
          list.appendChild(h('div.ph-msg' + (mine ? '.ph-msg--me' : ''),
            run ? null : h('div.ph-msg__who', h('span', { text: m.authorName || 'Player' }),
              h('time', { datetime: new Date(m.at).toISOString(), text: fmt.fmtAgo(new Date(m.at).toISOString()) })),
            h('div.ph-msg__bubble', { text: m.text })));
          lastWho = m.authorSeat; lastAt = m.at;
        }
        if (stick) list.scrollTop = list.scrollHeight;
      }
      function send() {
        const text = clip(input.value.trim(), MSG_LEN);
        if (!text) return;
        addMsg(room, { id: rid('m'), authorSeat: seat.seatId, authorName: seat.name, text, at: nowMs() }, true);
        input.value = '';
        renderList(); list.scrollTop = list.scrollHeight;
        paintNav();
        input.focus();
      }
      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

      const compose = h('div.ph-compose', h('div.field.ph-compose__field', input), sendBtn);
      const panel = h('div.ph-chat', list, compose);
      renderList();
      return { el: panel, update: renderList };
    }

    function viewChat(room, title, sub) {
      mainTitle.textContent = title;
      mainSub.textContent = sub || '';
      content.classList.add('ph-content--chat');
      const c = chatPanel(room);
      S._chat = c;             /* so repaint refreshes the list in place */
      content.appendChild(c.el);
    }

    /* ================= PARTIES VIEW ================= */
    function viewParties() {
      content.classList.remove('ph-content--chat');
      S._chat = null;
      mainTitle.textContent = 'Parties';
      const open = Hub.state.parties.length;
      mainSub.textContent = open ? `${open} open ${open === 1 ? 'party' : 'parties'} in this browser` : 'Start one for a game you want to play with someone';
      barActions.appendChild(h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => go('new') },
        icon('plus'), h('span', { text: 'New party' })));

      if (!open) {
        content.appendChild(h('div.empty',
          icon('users'),
          h('b', { text: 'No parties yet' }),
          h('small', { text: 'Create a party for a multiplayer game, then pass the laptop or open a second tab — the other seat sees it here live.' }),
          h('button.btn.btn--primary', { type: 'button', style: { marginTop: 'var(--sp-4)' }, onclick: () => go('new') },
            icon('plus'), h('span', { text: 'Create a party' }))));
        return;
      }
      const grid = h('div.ph-parties');
      for (const p of Hub.state.parties) grid.appendChild(partyCard(p));
      content.appendChild(grid);
    }

    function partyCard(p) {
      const g = gameById(p.gameId);
      const full = p.members.length >= p.cap;
      const joined = inParty(p);
      const host = isHost(p);
      const room = Hub.state.chats[roomOfParty(p.id)] || [];

      const members = h('div.ph-members', { 'aria-label': 'Members' });
      for (const m of p.members) {
        members.appendChild(h('span.ph-mem' + (m.id === seat.seatId ? '.is-me' : ''),
          { title: m.name }, h('span.ph-mem__i', { text: (m.name || '?').trim().charAt(0).toUpperCase() || '?' }),
          h('span.ph-mem__n', { text: m.name })));
      }

      const actions = h('div.ph-party__actions');
      if (joined) {
        actions.appendChild(h('button.btn.btn--sm', { type: 'button', onclick: () => leaveParty(p.id) },
          icon('corner-up-left'), h('span', { text: host ? 'Leave (host)' : 'Leave' })));
      } else {
        actions.appendChild(h('button.btn.btn--primary.btn--sm', {
          type: 'button', disabled: full ? '' : null,
          onclick: () => { if (!full) joinParty(p.id); },
        }, icon('plus'), h('span', { text: full ? 'Full' : 'Join' })));
      }
      actions.appendChild(h('button.btn.btn--sm', { type: 'button', onclick: () => go('party', p.id) },
        icon('message-circle'), h('span', { text: room.length ? `Chat (${room.length})` : 'Chat' })));
      if (g) actions.appendChild(h('button.btn.btn--sm', { type: 'button', onclick: () => openGame(g) },
        icon('play'), h('span', { text: 'Open game' })));
      if (host) actions.appendChild(h('button.ibtn.tip', {
        type: 'button', 'data-tip': 'Close party', 'aria-label': 'Close party', onclick: () => closeParty(p.id),
      }, icon('trash')));

      return h('div.card.ph-party',
        h('div.ph-party__top',
          gameArt(g, p.gameTitle),
          h('div.ph-party__meta',
            h('div.ph-party__title', { text: g ? g.title : p.gameTitle }),
            h('div.ph-party__by',
              h('span.chip' + (host ? '.chip--accent' : ''), icon('user'), h('span', { text: host ? 'You host' : `Host: ${p.host ? p.host.name : '—'}` })),
              h('span.chip', icon('users'), h('span', { text: `${p.members.length}/${p.cap}` })),
              h('span.ph-party__ago', { text: fmt.fmtAgo(new Date(p.updatedAt || p.createdAt || nowMs()).toISOString()) })),
            p.note ? h('div.ph-party__note', { text: p.note }) : null)),
        members,
        actions);
    }

    function gameArt(g, fallbackTitle) {
      const title = g ? g.title : (fallbackTitle || 'Game');
      const wrap = h('div.ph-art', { 'aria-hidden': 'true' });
      if (g && g.art) {
        const img = h('img', {
          src: g.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
          onerror: () => { img.remove(); wrap.appendChild(artLetter(title)); },
        });
        wrap.appendChild(img);
      } else wrap.appendChild(artLetter(title));
      return wrap;
    }
    function artLetter(title) {
      return h('span.ph-art__letter', { text: (title || '?').trim().charAt(0).toUpperCase() || '?' });
    }

    /* ================= SINGLE PARTY VIEW ================= */
    function viewParty() {
      const p = Hub.state.parties.find(x => x.id === S.partyId);
      content.classList.remove('ph-content--chat');
      if (!p) {
        mainTitle.textContent = 'Party';
        mainSub.textContent = '';
        content.appendChild(h('div.empty', icon('users'),
          h('b', { text: 'This party has closed' }),
          h('small', { text: 'The host closed it, or it never reached this browser.' }),
          h('button.btn', { type: 'button', style: { marginTop: 'var(--sp-4)' }, onclick: () => go('parties') },
            icon('arrow-left'), h('span', { text: 'Back to parties' }))));
        return;
      }
      const g = gameById(p.gameId);
      bar.classList.add('has-back');
      S.viewBack = 'parties';
      mainTitle.textContent = g ? g.title : p.gameTitle;
      mainSub.textContent = `${p.members.length}/${p.cap} • ${isHost(p) ? 'you host' : 'host ' + (p.host ? p.host.name : '—')}`;

      const joined = inParty(p);
      const full = p.members.length >= p.cap;
      if (g) barActions.appendChild(h('button.btn.btn--sm', { type: 'button', onclick: () => openGame(g) }, icon('play'), h('span', { text: 'Open game' })));
      if (joined) barActions.appendChild(h('button.btn.btn--sm', { type: 'button', onclick: () => leaveParty(p.id) }, icon('corner-up-left'), h('span', { text: 'Leave' })));
      else barActions.appendChild(h('button.btn.btn--primary.btn--sm', { type: 'button', disabled: full ? '' : null, onclick: () => { if (!full) joinParty(p.id); } }, icon('plus'), h('span', { text: full ? 'Full' : 'Join' })));

      const roster = h('div.ph-roster');
      for (const m of p.members) roster.appendChild(h('span.chip' + (m.id === seat.seatId ? '.chip--accent' : ''),
        icon('user'), h('span', { text: m.name + (m.id === (p.host && p.host.id) ? ' (host)' : '') })));
      if (p.note) roster.appendChild(h('span.ph-roster__note', { text: p.note }));

      const c = chatPanel(roomOfParty(p.id));
      S._chat = c;
      content.classList.add('ph-content--chat');
      content.appendChild(h('div.ph-partyroom', roster, c.el));
    }

    /* ================= NEW PARTY VIEW ================= */
    function viewNewParty() {
      content.classList.remove('ph-content--chat');
      S._chat = null;
      bar.classList.add('has-back');
      S.viewBack = 'parties';
      mainTitle.textContent = 'New party';
      mainSub.textContent = 'Pick a multiplayer game and how many seats';

      let picked = opts && opts.gameId ? gameById(opts.gameId) : (S._preGame || null);
      S._preGame = null;

      const pickedBox = h('div.ph-new__picked');
      const searchIn = h('input', { type: 'text', placeholder: 'Search multiplayer games', 'aria-label': 'Search multiplayer games', 'data-autofocus': picked ? null : '1', autocomplete: 'off' });
      const results = h('div.ph-new__results', { role: 'listbox', 'aria-label': 'Game results' });
      const capField = h('input', { type: 'number', min: '2', max: '8', value: '4', 'aria-label': 'Party size' });
      const noteField = h('input', { type: 'text', maxLength: NOTE_LEN, placeholder: 'Optional note (e.g. “mic on, casual”)', 'aria-label': 'Party note', autocomplete: 'off' });
      const createBtn = h('button.btn.btn--primary', { type: 'button' }, icon('plus'), h('span', { text: 'Create party' }));

      function renderPicked() {
        clear(pickedBox);
        if (!picked) { pickedBox.appendChild(h('div.ph-new__hint', { text: S.catReady ? 'No game chosen yet.' : 'Loading the catalogue…' })); createBtn.disabled = true; return; }
        createBtn.disabled = false;
        const sig = mpSignal(picked) || 'Multiplayer';
        pickedBox.appendChild(h('div.ph-new__pick',
          gameArt(picked, picked.title),
          h('div', h('div.ph-party__title', { text: picked.title }),
            h('div.ph-party__by', h('span.chip.chip--accent', { text: sig }),
              picked.hasStats ? h('span.chip', { text: `${fmt.round ? fmt.round(picked.plays / 1000) : Math.round(picked.plays / 1000)}k plays` }) : h('span.chip', { text: picked.studio }))),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { picked = null; renderPicked(); searchIn.focus(); } }, h('span', { text: 'Change' }))));
      }
      function renderResults() {
        clear(results);
        if (!S.catReady) { results.appendChild(h('div.ph-new__hint', h('span.spinner'), h('span', { text: 'Loading multiplayer games…' }))); return; }
        const q = searchIn.value.trim().toLowerCase();
        let rows = mpGames;
        if (q) rows = rows.filter(r => r.g.title.toLowerCase().includes(q) || r.g.tags.join(' ').toLowerCase().includes(q));
        rows = rows.slice(0, 40);
        if (!rows.length) { results.appendChild(h('div.ph-new__hint', { text: 'No multiplayer game matches that.' })); return; }
        for (const r of rows) {
          results.appendChild(h('button.ph-new__row', { type: 'button', role: 'option', onclick: () => { picked = r.g; renderPicked(); } },
            gameArt(r.g, r.g.title),
            h('span.ph-new__rowt', { text: r.g.title }),
            h('span.chip.chip--accent.ph-new__sig', { text: r.sig })));
        }
      }
      searchIn.addEventListener('input', renderResults);

      createBtn.addEventListener('click', () => {
        if (!picked) return;
        const cap = Math.max(2, Math.min(8, parseInt(capField.value, 10) || 4));
        const me = meMember();
        const party = {
          id: rid('p'), gameId: picked.id, gameTitle: picked.title,
          host: { id: seat.seatId, name: seat.name },
          members: [me], cap, note: clip(noteField.value.trim(), NOTE_LEN),
          createdAt: nowMs(), updatedAt: nowMs(),
        };
        upsertParty(party, true);
        paintNav(); paintJoined();
        notify({ app: 'Party Hub', icon: 'users', title: 'Party created', message: `${picked.title} • ${1}/${cap}`, timeout: 3200 });
        go('party', party.id);
      });

      content.appendChild(h('div.ph-new',
        h('div.ph-new__panel',
          h('label.ph-new__label', { text: 'Game' }),
          pickedBox,
          h('div.field.ph-new__search', icon('search'), searchIn),
          results),
        h('div.ph-new__side',
          h('label.ph-new__label', { text: 'Seats' }),
          h('div.field.ph-new__cap', capField),
          h('label.ph-new__label', { text: 'Note' }),
          h('div.field', noteField),
          createBtn,
          h('p.ph-new__fine', { text: 'The party appears for every StaticOS tab open in this browser. There is no server, so it is not visible on other devices.' }))));
      renderPicked(); renderResults();
    }

    /* ================= GAMES VIEW ================= */
    function viewGames() {
      content.classList.remove('ph-content--chat');
      S._chat = null;
      mainTitle.textContent = 'Multiplayer games';
      const count = S.catReady ? mpGames.length : 0;
      mainSub.textContent = S.catReady
        ? `${count} games in the catalogue tagged multiplayer, .io, 2-player, co-op or versus`
        : 'Loading the catalogue…';

      const search = h('input', { type: 'text', placeholder: 'Search', value: S.gameQuery, 'aria-label': 'Search multiplayer games', 'data-autofocus': '1', autocomplete: 'off' });
      barActions.appendChild(h('div.field.ph-gamesearch', icon('search'), search));

      const listWrap = h('div.ph-games');
      content.appendChild(listWrap);

      if (!S.catReady) {
        listWrap.appendChild(h('div.empty', h('span.spinner'), h('b', { text: 'Loading multiplayer games' }),
          h('small', { text: 'Reading the real games index (static://games).' })));
        return;
      }
      if (CAT.loadError && CAT.loadError()) {
        content.insertBefore(h('div.ph-note', icon('info'),
          h('small', { text: 'The full catalogue didn’t load, so this is the curated shelf.' })), listWrap);
      }
      const render = () => {
        S.gameQuery = search.value;
        const q = search.value.trim().toLowerCase();
        clear(listWrap);
        let rows = mpGames;
        if (q) rows = rows.filter(r => r.g.title.toLowerCase().includes(q) || r.g.tags.join(' ').toLowerCase().includes(q) || r.g.cats.join(' ').toLowerCase().includes(q));
        const shown = rows.slice(0, 120);
        if (!shown.length) { listWrap.appendChild(h('div.empty', icon('search'), h('b', { text: 'Nothing matches' }), h('small', { text: 'Try another word.' }))); return; }
        for (const r of shown) listWrap.appendChild(gameRow(r));
        if (rows.length > shown.length) listWrap.appendChild(h('div.ph-games__more', { text: `Showing ${shown.length} of ${rows.length}. Narrow the search to see the rest.` }));
      };
      search.addEventListener('input', render);
      render();
    }

    function gameRow({ g, sig }) {
      const meta = h('div.ph-game__meta',
        h('div.ph-game__title', { text: g.title }),
        h('div.ph-game__tags',
          h('span.chip.chip--accent', { text: sig }),
          ...(g.cats.slice(0, 3).map(c => h('span.chip', { text: c }))),
          g.hasStats ? h('span.chip', { text: `${Math.round(g.plays / 1000)}k plays` }) : h('span.ph-game__src', { text: g.studio })));
      const actions = h('div.ph-game__actions',
        h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => openGame(g) }, icon('play'), h('span', { text: 'Play' })),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { S._preGame = g; go('new'); } }, icon('users'), h('span', { text: 'Start party' })));
      return h('div.ph-game', gameArt(g, g.title), meta, actions);
    }

    /* ================= ACTIONS ================= */
    function joinParty(id) {
      const p = Hub.state.parties.find(x => x.id === id);
      if (!p || inParty(p) || p.members.length >= p.cap) return;
      const next = { ...p, members: [...p.members, meMember()], updatedAt: nowMs() };
      upsertParty(next, true);
      paint();
    }
    function leaveParty(id) {
      const p = Hub.state.parties.find(x => x.id === id);
      if (!p) return;
      const members = p.members.filter(m => m.id !== seat.seatId);
      if (!members.length) { closeParty(id); return; }        /* last one out closes it */
      let host = p.host;
      if (host && host.id === seat.seatId) host = { id: members[0].id, name: members[0].name };  /* hand off */
      upsertParty({ ...p, members, host, updatedAt: nowMs() }, true);
      if (S.view === 'party' && S.partyId === id) go('parties'); else paint();
    }
    function closeParty(id) {
      const p = Hub.state.parties.find(x => x.id === id);
      if (p && isHost(p) && p.members.length > 1) {
        api.confirm({
          title: 'Close this party?', message: `${p.members.length} people are in it. Closing removes it for everyone in this browser.`,
          ok: 'Close party', danger: true,
        }).then(ok => { if (ok) { removeParty(id, true); if (S.view === 'party' && S.partyId === id) go('parties'); else paint(); } });
        return;
      }
      removeParty(id, true);
      if (S.view === 'party' && S.partyId === id) go('parties'); else paint();
    }
    function openGame(g) {
      if (!g) return;
      if (!api.getApp('aether-games')) {
        notify({ app: 'Party Hub', icon: 'alert', title: 'Games app not available', message: 'The Static Games app isn’t installed in this build.' });
        return;
      }
      api.openApp('aether-games', { url: `static://games/${g.id}` });
    }

    /* ================= REPAINT ON REMOTE CHANGES ================= */
    /* full repaint from another tab, but keep chat inputs alive: if a chat
       list is on screen, refresh only that list; otherwise repaint the view */
    seat.repaint = () => {
      paintPresence(); paintNav(); paintJoined();
      if (S.view === 'party') {
        const p = Hub.state.parties.find(x => x.id === S.partyId);
        if (!p) { paintMain(); return; }           /* party closed elsewhere */
        mainSub.textContent = `${p.members.length}/${p.cap} • ${isHost(p) ? 'you host' : 'host ' + (p.host ? p.host.name : '—')}`;
        if (S._chat) S._chat.update();
        /* refresh the roster chips in place without touching the composer */
        const roster = content.querySelector('.ph-roster');
        if (roster) {
          clear(roster);
          for (const m of p.members) roster.appendChild(h('span.chip' + (m.id === seat.seatId ? '.chip--accent' : ''),
            icon('user'), h('span', { text: m.name + (m.id === (p.host && p.host.id) ? ' (host)' : '') })));
          if (p.note) roster.appendChild(h('span.ph-roster__note', { text: p.note }));
        }
      } else if (S.view === 'lounge') {
        if (S._chat) S._chat.update();
      } else if (S.view === 'parties') {
        paintMain();                                /* party list is fully data-driven */
      }
      /* 'games' and 'new' don't depend on parties/chat — leave their inputs alone */
    };
    seat.repaintPresence = paintPresence;

    /* window tools: quick "new party" + honesty */
    win.setTools(
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'New party', 'aria-label': 'New party', onclick: () => go('new') }, icon('plus')),
    );
    win.setSubtitle && win.setSubtitle('local to this browser');

    /* first paint */
    if (opts && opts.gameId) { go('new'); } else { paint(); }

    /* ================= TEARDOWN ================= */
    return () => {
      Hub.windows.delete(seat);
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      heartbeat();               /* tell peers this seat is gone */
      S._chat = null;
      releaseHub();
    };
  },
});
