/* ============================================================
   squad.js — Squad: a multiplayer hub for StaticOS.

   Two honest jobs, no invented server:

   · FIND A PARTY.  Browse the real multiplayer games already in
     the catalogue (games.data.js), then post a party for one —
     which game, how many players, a note, a short join code.
     Parties are saved on THIS device and sync LIVE across your
     own open StaticOS tabs over a BroadcastChannel. There is no
     matchmaking server in a static site, so the app never
     pretends strangers are queued up: the presence count is the
     real number of StaticOS tabs open in this browser, and to
     reach other people you hand off to Static Chat / the
     community. Nothing here is seeded or faked.

   · TALK ABOUT THE GAME.  Every party carries a discussion
     thread. Messages persist on this device and travel over the
     same BroadcastChannel, so two open tabs genuinely chat in
     real time — but again, only across your own windows. The UI
     says exactly that, and points at Static Chat for real rooms.

   Which games count as "multiplayer" is decided from the row's
   own cats/tags (.io, 2 Player, Multiplayer, Co-op, Versus,
   Battle royale) — never a guess. Play launches the real game in
   Static Games. Every count on screen is measured from the loaded
   catalogue; play/rating figures show only for rows the catalogue
   flags as having real stats (hasStats).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as catalogue from '../portal/games.data.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-squad-css')) {
  const l = document.createElement('link');
  l.id = 'feat-squad-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-squad.css';
  document.head.appendChild(l);
}

/* ---------------- multiplayer detection ----------------
   Signals live on the row itself. A game only appears here if one
   of them is present, so the shelf is real, not a mood. */
const lc = a => (a || []).map(x => String(x).toLowerCase());
function playerMode(g) {
  const cats = lc(g.cats), tags = lc(g.tags), t = String(g.title || '').toLowerCase();
  const tag = re => tags.some(x => re.test(x));
  if (cats.includes('2player') || tag(/^2 ?players?( games)?$/) || /\b2\s*player/.test(t)) return '2-player';
  if (cats.includes('io') || /\.io\b/.test(t) || tag(/\.io\b/)) return '.io online';
  if (tag(/multi-?player/) || /multiplayer/.test(t)) return 'Multiplayer';
  if (tag(/co-?op/) || /\bco-?op\b/.test(t)) return 'Co-op';
  if (tag(/versus|\bpvp\b|\b1v1\b/) || /\bpvp\b|\b1v1\b/.test(t)) return 'Versus';
  if (tag(/battle ?royale|battlegrounds/) || /battle royale/.test(t)) return 'Battle royale';
  return '';
}
const isMulti = g => !!playerMode(g);

/* filter buckets for the Games tab chips */
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: '2p', label: '2-player', match: g => lc(g.cats).includes('2player') || lc(g.tags).some(x => /^2 ?players?( games)?$/.test(x)) || /\b2\s*player/.test(String(g.title).toLowerCase()) },
  { id: 'io', label: '.io online', match: g => lc(g.cats).includes('io') || /\.io\b/.test(String(g.title).toLowerCase()) || lc(g.tags).some(x => /\.io\b/.test(x)) },
  { id: 'mp', label: 'Multiplayer', match: g => lc(g.tags).some(x => /multi-?player/.test(x)) || /multiplayer/.test(String(g.title).toLowerCase()) },
  { id: 'coop', label: 'Co-op', match: g => lc(g.tags).some(x => /co-?op/.test(x)) },
  { id: 'vs', label: 'Versus', match: g => lc(g.tags).some(x => /versus|\bpvp\b|\b1v1\b/.test(x)) },
];

/* ---------------- small helpers ---------------- */
const CHAN = 'staticos.squad.v1';
const PKEY = 'portal.squad.parties';
const TKEY = 'portal.squad.threads';
const PAGE = 48;
const HEARTBEAT = 8000;
const STALE = 22000;
const MAX_MSG = 600;
const MAX_NOTE = 160;

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const joinCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const hueOf = s => { let n = 0; for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n % 360; };

function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
function clock(t) {
  try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return ''; }
}

/* Merge maps received from another tab. Parties are last-write-wins by
   updatedAt (deletions ride along as tombstones); messages union by id. */
function mergeParties(local, incoming) {
  const out = { ...local };
  for (const [id, p] of Object.entries(incoming || {})) {
    if (!p || typeof p !== 'object') continue;
    const cur = out[id];
    if (!cur || (p.updatedAt || 0) > (cur.updatedAt || 0)) out[id] = p;
  }
  return out;
}
function mergeThreads(local, incoming) {
  const out = {};
  const ids = new Set([...Object.keys(local || {}), ...Object.keys(incoming || {})]);
  for (const pid of ids) {
    const seen = new Map();
    for (const m of (local[pid] || [])) seen.set(m.id, m);
    for (const m of (incoming[pid] || [])) if (m && m.id && !seen.has(m.id)) seen.set(m.id, m);
    out[pid] = [...seen.values()].sort((a, b) => a.at - b.at);
  }
  return out;
}

defineApp({
  id: 'squad',
  name: 'Squad',
  icon: 'gamepad',
  g1: '#8b7bff', g2: '#5326c9',
  category: 'Games',
  keywords: ['multiplayer', 'co-op', 'coop', 'party', 'parties', 'lobby', 'lfg',
    'matchmaking', 'squad', 'friends', 'versus', 'pvp', 'io', 'online', 'hub', 'find players', 'group'],
  desc: 'Find multiplayer game parties and talk about them',
  pinned: false, dock: false, singleton: true,
  win: { w: 940, h: 640, minW: 540, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, notify } = api;

    const meUser = store.get('session.user') || store.get('user') || {};
    const meName = meUser.name || meUser.username || 'You';
    const meHandle = (meUser.username || meUser.handle || meName).toString().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'you';

    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const S = {
      alive: true,
      tab: 'parties',
      ready: false, error: '',
      games: [], counts: {},
      parties: {}, threads: {},
      selId: null, mode: null,          // 'view' | 'create'
      draft: {},                        // per-party composer text
      peers: new Map(),                 // peerId -> lastSeen
      peerId: uid(),
      createGame: null,                 // preselected game for the create form
      gq: '', gfilter: 'all', gpage: 1,
      timers: [],
      d: null,                          // refs into the current detail pane
    };

    /* ---------------- persisted state ---------------- */
    function readStore() {
      const p = store.get(PKEY);
      const t = store.get(TKEY);
      S.parties = (p && typeof p === 'object') ? { ...p } : {};
      S.threads = (t && typeof t === 'object') ? { ...t } : {};
    }
    function persist() {
      store.set(PKEY, { ...S.parties });     // new refs so the store never no-ops
      store.set(TKEY, { ...S.threads });
    }
    const livingParties = () => Object.values(S.parties)
      .filter(p => p && !p.deleted)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    /* ---------------- BroadcastChannel: real cross-tab sync ---------------- */
    let bc = null;
    try { bc = new BroadcastChannel(CHAN); } catch (e) { bc = null; }

    const post = msg => { try { bc?.postMessage(msg); } catch (e) { /* channel gone */ } };
    const sendSnap = () => post({ t: 'snap', peer: S.peerId, parties: S.parties, threads: S.threads });

    function recordPeer(id) {
      if (!id || id === S.peerId) return;
      const fresh = !S.peers.has(id);
      S.peers.set(id, Date.now());
      if (fresh) paintPresence();
    }
    function prunePeers() {
      const cut = Date.now() - STALE;
      let changed = false;
      for (const [id, seen] of S.peers) if (seen < cut) { S.peers.delete(id); changed = true; }
      if (changed) paintPresence();
    }

    if (bc) {
      bc.onmessage = ev => {
        if (!S.alive) return;
        const d = ev.data;
        if (!d || d.peer === S.peerId) return;
        if (d.t === 'bye') { if (S.peers.delete(d.peer)) paintPresence(); return; }
        recordPeer(d.peer);
        if (d.t === 'hello') { sendSnap(); return; }         // catch a new tab up
        if (d.t === 'snap') applyRemote(d);
      };
      post({ t: 'hello', peer: S.peerId });
      const hb = setInterval(() => { if (!S.alive) return; post({ t: 'ping', peer: S.peerId }); prunePeers(); }, HEARTBEAT);
      S.timers.push(hb);
    }

    function applyRemote(d) {
      S.parties = mergeParties(S.parties, d.parties);
      S.threads = mergeThreads(S.threads, d.threads);
      persist();
      paintList();
      if (S.mode === 'view') refreshDetail();
    }

    /* Local mutation → save, tell the other tabs, repaint. */
    function commit({ list = true } = {}) {
      persist();
      sendSnap();
      if (list) paintList();
    }

    /* ---------------- shell ---------------- */
    const tabsWrap = h('div.sq__tabs', { role: 'tablist', 'aria-label': 'Squad sections' });
    const tabBtns = {};
    for (const [id, label, ic] of [['parties', 'Parties', 'users'], ['games', 'Games', 'gamepad']]) {
      const b = h('button.sq__tab', {
        role: 'tab', type: 'button',
        'aria-selected': id === S.tab ? 'true' : 'false',
        onclick: () => setTab(id),
      }, icon(ic), h('span', { text: label }));
      tabBtns[id] = b;
      tabsWrap.appendChild(b);
    }

    const liveEl = h('button.sq__live.tip', {
      type: 'button', 'data-tip': 'Open StaticOS tabs in this browser', 'aria-label': 'Connected tabs',
      onclick: () => notify({
        app: 'Squad', icon: 'wifi', title: 'Live across your tabs',
        message: 'Parties and messages sync in real time across the StaticOS tabs open in this browser. There is no server, so this does not reach other people — use Static Chat for that.',
      }),
    });

    const communityBtn = h('button.btn.btn--sm', {
      type: 'button', 'aria-label': 'Open Static Chat',
      onclick: () => api.openApp('chat'),
    }, icon('message-circle'), h('span', { text: 'Community' }));

    const bar = h('div.sq__bar',
      h('div.sq__brand', h('span.sq__brand-ic', icon('gamepad')), h('b', { text: 'Squad' })),
      tabsWrap,
      h('div.sq__spacer'),
      liveEl,
      communityBtn);

    const bodyEl = h('div.sq__body');
    root.appendChild(h('div.app', h('div.sq', bar, bodyEl)));

    /* ---------------- presence ---------------- */
    function paintPresence() {
      const n = S.peers.size + 1;
      clear(liveEl);
      liveEl.append(
        h('span.sq__live-dot', { class: reduced() ? 'is-still' : null }),
        h('span', { text: n === 1 ? 'Only this tab' : `${n} tabs live` }));
    }

    /* ---------------- tabs ---------------- */
    function setTab(id) {
      S.tab = id;
      for (const [k, b] of Object.entries(tabBtns)) {
        b.classList.toggle('is-on', k === id);
        b.setAttribute('aria-selected', k === id ? 'true' : 'false');
      }
      paintBody();
    }

    function paintBody() {
      clear(bodyEl);
      S.d = null;
      if (S.tab === 'parties') paintParties();
      else paintGames();
    }

    /* ============================================================
       PARTIES  —  list  +  detail (view / create)
       ============================================================ */
    let listEl, detailEl, colsEl;

    function paintParties() {
      listEl = h('div.sq__list');
      detailEl = h('div.sq-detail');
      colsEl = h('div.sq__cols', { class: S.selId || S.mode ? 'has-sel' : null }, listEl, detailEl);
      bodyEl.appendChild(colsEl);
      paintList();
      buildDetail();
    }

    function showDetailPane(on) { colsEl?.classList.toggle('has-sel', !!on); }

    function paintList() {
      if (!listEl) return;
      clear(listEl);
      const parties = livingParties();
      listEl.append(
        h('div.sq__listhead',
          h('b', { text: 'Parties' }),
          h('span.sq__count', { text: String(parties.length) }),
          h('span.sq__spacer'),
          h('button.btn.btn--sm.btn--primary', {
            type: 'button', 'aria-label': 'Create a party',
            onclick: () => openCreate(null),
          }, icon('plus'), h('span', { text: 'New party' }))),
        h('p.sq__note',
          icon('info'),
          h('span', { text: 'No matchmaking server — parties live in this browser and sync across your open StaticOS tabs. For other people, open the ' }),
          h('button.sq__link', { type: 'button', onclick: () => api.openApp('chat'), text: 'community' }),
          h('span', { text: '.' })));

      if (!parties.length) {
        listEl.appendChild(h('div.empty',
          icon('users'),
          h('b', { text: 'No parties yet' }),
          h('small', { text: 'Post one for a multiplayer game and share the join code — or browse the Games tab to start from a title.' }),
          h('button.btn.btn--primary', { type: 'button', onclick: () => openCreate(null) },
            icon('plus'), h('span', { text: 'Create a party' }))));
        return;
      }

      for (const p of parties) {
        const full = memberCount(p) >= p.size;
        const row = h('button.sq-party', {
          type: 'button',
          class: p.id === S.selId ? 'is-on' : null,
          'aria-label': `${p.title || p.gameTitle} — ${memberCount(p)} of ${p.size} players`,
          onclick: () => selectParty(p.id),
        },
          artThumb(p.gameId, p.art, 'sq-party__art'),
          h('div.sq-party__body',
            h('div.sq-party__title.trunc', { text: p.title || p.gameTitle }),
            h('div.sq-party__game.trunc', { text: p.gameTitle }),
            h('div.sq-party__meta',
              h('span.chip.sq-chip', icon('users'), h('span', { text: `${memberCount(p)}/${p.size}` })),
              full ? h('span.chip.sq-chip.is-full', { text: 'Full' }) : null,
              iAmIn(p) ? h('span.chip.sq-chip.is-in', icon('check'), h('span', { text: 'Joined' })) : null,
              h('span.sq-party__code', { text: p.code }))));
        listEl.appendChild(row);
      }
    }

    const memberList = p => (Array.isArray(p.members) ? p.members : []);
    const memberCount = p => memberList(p).length;
    const iAmIn = p => memberList(p).some(m => m.handle === meHandle);
    const gameById = id => S.games.find(g => g.id === id) || catalogue.byId?.(id) || null;

    /* ---------------- detail: build once, then refresh in place ---------------- */
    function selectParty(id) {
      S.selId = id;
      S.mode = 'view';
      buildDetail();
      paintList();
      showDetailPane(true);
    }
    function openCreate(gameId) {
      S.mode = 'create';
      S.selId = null;
      S.createGame = gameId ? gameById(gameId) : null;
      buildDetail();
      paintList();
      showDetailPane(true);
    }
    function closeDetail() {
      S.mode = null; S.selId = null;
      buildDetail();
      paintList();
      showDetailPane(false);
    }

    function buildDetail() {
      if (!detailEl) return;
      clear(detailEl);
      S.d = null;
      if (S.mode === 'create') { buildCreate(); return; }
      if (S.mode === 'view') { buildView(); return; }
      detailEl.appendChild(h('div.empty',
        icon('gamepad'),
        h('b', { text: 'Pick a party' }),
        h('small', { text: 'Select a party on the left to see who is in and talk about the game, or create a new one.' })));
    }

    function backBtn() {
      return h('button.ibtn.sq-back', { type: 'button', 'aria-label': 'Back to parties', onclick: closeDetail }, icon('chevron-right'));
    }

    /* ------- create a party ------- */
    function buildCreate() {
      let picked = S.createGame;
      let size = 4;

      const suggest = h('div.sq-suggest', { role: 'listbox', 'aria-label': 'Matching multiplayer games' });
      const search = h('input', {
        type: 'search', placeholder: S.ready ? 'Search multiplayer games…' : 'Loading games…',
        disabled: !S.ready, 'aria-label': 'Search multiplayer games', spellcheck: 'false',
        oninput: e => renderSuggest(e.target.value),
      });
      const pickedEl = h('div.sq-picked');
      const note = h('input', { type: 'text', maxlength: String(MAX_NOTE), placeholder: 'What are you playing for? (optional)', 'aria-label': 'Party note' });
      const sizeVal = h('span.sq-step__n', { 'aria-live': 'polite', text: String(size) });
      const createBtn = h('button.btn.btn--primary', { type: 'button', disabled: true, onclick: create }, icon('plus'), h('span', { text: 'Create party' }));

      function setSize(n) { size = Math.max(2, Math.min(16, n)); sizeVal.textContent = String(size); }
      function choose(g) {
        picked = g;
        clear(pickedEl);
        pickedEl.append(
          artThumb(g.id, g.art, 'sq-picked__art'),
          h('div.grow',
            h('div.sq-picked__title.trunc', { text: g.title }),
            h('div.sq-picked__mode', h('span.chip.sq-chip', { text: playerMode(g) || 'Multiplayer' }), h('span.dim.trunc', { text: g.studio || '' }))),
          h('button.ibtn', { type: 'button', 'aria-label': 'Clear selection', onclick: () => { picked = null; clear(pickedEl); pickedEl.classList.remove('is-set'); createBtn.disabled = true; search.focus(); } }, icon('x')));
        pickedEl.classList.add('is-set');
        createBtn.disabled = false;
        clear(suggest);
        search.value = '';
      }
      function renderSuggest(qv) {
        const q = String(qv || '').trim().toLowerCase();
        clear(suggest);
        if (!q) return;
        const hits = S.games.filter(g => g.title.toLowerCase().includes(q)).slice(0, 8);
        if (!hits.length) { suggest.appendChild(h('div.sq-suggest__empty', { text: 'No multiplayer game matches that.' })); return; }
        for (const g of hits) {
          suggest.appendChild(h('button.sq-suggest__item', { type: 'button', role: 'option', onclick: () => choose(g) },
            artThumb(g.id, g.art, 'sq-suggest__art'),
            h('div.grow', h('div.trunc', { text: g.title }), h('small.dim', { text: playerMode(g) || 'Multiplayer' }))));
        }
      }

      detailEl.append(h('div.sq-create',
        h('div.sq-detail__head', backBtn(), h('b', { text: 'New party' }), h('span.sq__spacer'),
          h('button.ibtn', { type: 'button', 'aria-label': 'Cancel', onclick: closeDetail }, icon('x'))),
        h('div.sq-create__body',
          h('label.sq-field',
            h('span.sq-field__label', { text: 'Game' }),
            h('div.field', icon('search'), search),
            suggest, pickedEl),
          h('label.sq-field',
            h('span.sq-field__label', { text: 'Players wanted' }),
            h('div.sq-step',
              h('button.ibtn', { type: 'button', 'aria-label': 'Fewer players', onclick: () => setSize(size - 1) }, h('span', { text: '−' })),
              sizeVal,
              h('button.ibtn', { type: 'button', 'aria-label': 'More players', onclick: () => setSize(size + 1) }, icon('plus')))),
          h('label.sq-field',
            h('span.sq-field__label', { text: 'Note' }),
            h('div.field', note)),
          h('div.sq-create__foot', createBtn,
            h('small.dim', { text: 'You are added as the host. A join code is generated to share.' })))));

      if (picked) choose(picked);
      setTimeout(() => { if (S.alive && S.ready) search.focus(); }, 40);

      function create() {
        if (!picked) return;
        const id = uid();
        const party = {
          id, code: joinCode(),
          gameId: picked.id, gameTitle: picked.title, gameOpen: picked.open || '', art: picked.art || null,
          mode: playerMode(picked) || 'Multiplayer',
          title: note.value.trim() || `${picked.title} squad`,
          size,
          hostHandle: meHandle, hostName: meName,
          members: [{ handle: meHandle, name: meName }],
          createdAt: Date.now(), updatedAt: Date.now(), deleted: false,
        };
        S.parties = { ...S.parties, [id]: party };
        commit();
        notify({ app: 'Squad', icon: 'users', title: 'Party created', message: `${party.title} · code ${party.code}`, timeout: 3500 });
        selectParty(id);
      }
    }

    /* ------- view a party ------- */
    function buildView() {
      const p = S.parties[S.selId];
      if (!p || p.deleted) {
        detailEl.appendChild(h('div.empty', icon('info'),
          h('b', { text: 'This party has ended' }),
          h('small', { text: 'The host closed it, or it was removed on another tab.' }),
          h('button.btn', { type: 'button', onclick: closeDetail }, h('span', { text: 'Back' }))));
        return;
      }
      const g = gameById(p.gameId);
      const mode = p.mode || playerMode(g) || 'Multiplayer';

      const membersEl = h('div.sq-members');
      const actionsEl = h('div.sq-detail__actions');
      const threadLog = h('div.sq-thread__log', { role: 'log', 'aria-label': `Chat about ${p.gameTitle}`, tabindex: '0' });

      const composer = h('textarea.sq-compose__in', {
        rows: '1', maxlength: String(600), placeholder: `Talk about ${clip(p.gameTitle, 24)}…`, 'aria-label': 'Message this party',
        oninput: e => { S.draft[p.id] = e.target.value; grow(e.target); },
        onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } },
      });
      composer.value = S.draft[p.id] || '';
      const sendBtn = h('button.sq-compose__send', { type: 'button', 'aria-label': 'Send', onclick: sendMsg }, icon('send'));

      detailEl.append(h('div.sq-view',
        h('div.sq-detail__head', backBtn(), h('b.trunc', { text: p.title }), h('span.sq__spacer'),
          p.hostHandle === meHandle
            ? h('button.ibtn.tip', { type: 'button', 'data-tip': 'Delete party', 'aria-label': 'Delete party', onclick: () => askDelete(p) }, icon('trash'))
            : null),
        h('div.sq-banner',
          artThumb(p.gameId, p.art, 'sq-banner__art'),
          h('div.sq-banner__body',
            h('div.sq-banner__mode', h('span.chip.sq-chip', { text: mode }),
              h('span.chip.sq-chip.sq-code', { title: 'Join code', text: p.code })),
            h('div.sq-banner__title.trunc', { text: p.gameTitle }),
            h('div.sq-banner__sub', { text: `Hosted by ${p.hostName} · ${ago(p.createdAt)}` }),
            h('div.sq-banner__acts',
              h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => play(p) }, icon('play'), h('span', { text: 'Play' })),
              h('button.btn.btn--sm', { type: 'button', onclick: () => invite(p) }, icon('share'), h('span', { text: 'Invite' }))))),
        h('div.sq-sec',
          h('div.sq-sec__head', h('span.label', { text: 'Squad' }), actionsEl),
          membersEl),
        h('div.sq-sec.sq-sec--talk',
          h('div.sq-sec__head', h('span.label', { text: 'Talk' }),
            h('small.dim', { text: 'saved on this device · live across your tabs' })),
          h('div.sq-thread', threadLog,
            h('div.sq-compose', composer, sendBtn)))));

      S.d = { pid: p.id, membersEl, actionsEl, threadLog, composer, nearBottom: true };
      threadLog.addEventListener('scroll', () => {
        S.d.nearBottom = threadLog.scrollHeight - threadLog.scrollTop - threadLog.clientHeight <= 60;
      });
      refreshMembers();
      refreshThread(true);
      setTimeout(() => grow(composer), 0);

      function sendMsg() {
        const body = composer.value.trim();
        if (!body) return;
        const cur = S.parties[p.id];
        if (!cur || cur.deleted) return;
        const msg = { id: uid(), pid: p.id, handle: meHandle, name: meName, body: body.slice(0, 600), at: Date.now() };
        const arr = [...(S.threads[p.id] || []), msg].slice(-MAX_MSG);
        S.threads = { ...S.threads, [p.id]: arr };
        S.draft[p.id] = '';
        composer.value = '';
        grow(composer);
        S.d.nearBottom = true;
        commit({ list: false });
        refreshThread(true);
        composer.focus();
      }
    }

    function refreshDetail() {
      if (S.mode !== 'view' || !S.d) return;
      const p = S.parties[S.d.pid];
      if (!p || p.deleted) { buildDetail(); return; }
      refreshMembers();
      refreshThread(false);
    }

    function refreshMembers() {
      if (!S.d) return;
      const p = S.parties[S.d.pid];
      if (!p) return;
      const list = memberList(p);
      clear(S.d.membersEl);
      for (const m of list) {
        S.d.membersEl.appendChild(h('div.sq-avatar.tip', {
          'data-tip': m.handle === meHandle ? `${m.name} (you)` : m.name,
          style: { '--h': String(hueOf(m.handle)) },
          text: initials(m.name),
        }));
      }
      const openSlots = Math.max(0, p.size - list.length);
      for (let i = 0; i < Math.min(openSlots, 8); i++) S.d.membersEl.appendChild(h('div.sq-avatar.is-open', { 'aria-hidden': 'true', text: '+' }));

      clear(S.d.actionsEl);
      S.d.actionsEl.append(h('span.dim.sq-mcount', { text: `${list.length}/${p.size} players` }));
      const full = list.length >= p.size;
      if (iAmIn(p)) {
        S.d.actionsEl.appendChild(h('button.btn.btn--sm', { type: 'button', onclick: () => leave(p) }, icon('x'), h('span', { text: 'Leave' })));
      } else {
        S.d.actionsEl.appendChild(h('button.btn.btn--sm.btn--primary', {
          type: 'button', disabled: full, onclick: () => joinParty(p),
        }, icon('plus'), h('span', { text: full ? 'Full' : 'Join' })));
      }
    }

    function refreshThread(forceBottom) {
      if (!S.d) return;
      const log = S.d.threadLog;
      const stick = forceBottom || S.d.nearBottom;
      clear(log);
      const msgs = S.threads[S.d.pid] || [];
      if (!msgs.length) {
        log.appendChild(h('div.sq-thread__empty', icon('message-circle'),
          h('span', { text: 'No messages yet. Say what you are queuing for.' })));
        return;
      }
      let lastWho = null;
      for (const m of msgs) {
        const mine = m.handle === meHandle;
        const run = m.handle === lastWho;
        log.appendChild(h('div.sq-msg', { class: [mine ? 'is-mine' : '', run ? 'is-run' : ''].filter(Boolean).join(' ') || null },
          run ? null : h('div.sq-msg__head',
            h('span.sq-msg__who', { text: mine ? `${m.name} (you)` : m.name }),
            h('span.sq-msg__at', { text: clock(m.at) })),
          h('div.sq-msg__body', { text: m.body })));
        lastWho = m.handle;
      }
      if (stick) log.scrollTop = log.scrollHeight;
    }

    /* ---------------- party actions ---------------- */
    function touch(p, mut) {
      const next = { ...p, ...mut, updatedAt: Date.now() };
      S.parties = { ...S.parties, [p.id]: next };
      return next;
    }
    function joinParty(p) {
      const cur = S.parties[p.id];
      if (!cur || cur.deleted || iAmIn(cur) || memberCount(cur) >= cur.size) return;
      touch(cur, { members: [...memberList(cur), { handle: meHandle, name: meName }] });
      commit();
      refreshDetail();
    }
    function leave(p) {
      const cur = S.parties[p.id];
      if (!cur) return;
      touch(cur, { members: memberList(cur).filter(m => m.handle !== meHandle) });
      commit();
      refreshDetail();
    }
    async function askDelete(p) {
      const ok = await api.confirm({ title: 'Delete this party?', message: p.title, ok: 'Delete', cancel: 'Keep' });
      if (!ok || !S.alive) return;
      touch(p, { deleted: true, members: [] });
      commit();
      closeDetail();
    }
    function play(p) {
      if (p.gameId) api.openApp('aether-games', { url: `static://games/${p.gameId}` });
      else if (p.gameOpen) window.open(p.gameOpen, '_blank', 'noopener,noreferrer');
    }
    async function invite(p) {
      const text = `Squad up for ${p.gameTitle} on StaticOS — join code ${p.code}. Play: ${p.gameOpen || `static://games/${p.gameId}`}`;
      try {
        await navigator.clipboard.writeText(text);
        notify({ app: 'Squad', icon: 'copy', title: 'Invite copied', message: 'Paste it to a friend. They need to be on the same game to actually play together.', timeout: 4000 });
      } catch (e) {
        notify({ app: 'Squad', icon: 'alert', title: 'Could not copy', message: `Share this: ${text}` });
      }
    }

    /* ============================================================
       GAMES  —  browse the real multiplayer catalogue
       ============================================================ */
    function paintGames() {
      const wrap = h('div.sq-games');
      bodyEl.appendChild(wrap);

      if (!S.ready) {
        wrap.appendChild(S.error
          ? h('div.empty', icon('alert'), h('b', { text: 'Could not load the games catalogue' }), h('small', { text: S.error }))
          : h('div.empty', h('div.spinner'), h('small', { text: 'Loading multiplayer games…' })));
        return;
      }

      const search = h('input', {
        type: 'search', placeholder: 'Search multiplayer games…', value: S.gq, spellcheck: 'false',
        'aria-label': 'Search multiplayer games',
        oninput: e => { S.gq = e.target.value; S.gpage = 1; renderGrid(); },
      });
      const chips = h('div.sq-chips', { role: 'tablist', 'aria-label': 'Filter by mode' });
      for (const f of FILTERS) {
        const n = S.counts[f.id] || 0;
        if (f.id !== 'all' && !n) continue;
        chips.appendChild(h('button.chip.sq-fchip', {
          type: 'button', role: 'tab',
          class: S.gfilter === f.id ? 'is-on' : null,
          'aria-selected': S.gfilter === f.id ? 'true' : 'false',
          onclick: () => { S.gfilter = f.id; S.gpage = 1; renderChips(); renderGrid(); },
        }, h('span', { text: f.label }), h('small', { text: String(n) })));
      }
      function renderChips() {
        [...chips.querySelectorAll('.sq-fchip')].forEach(btn => {
          const label = btn.querySelector('span')?.textContent;
          const f = FILTERS.find(x => x.label === label);
          const on = f && S.gfilter === f.id;
          btn.classList.toggle('is-on', !!on);
          btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      }

      const grid = h('div.sq-grid');
      const foot = h('div.sq-more');
      const countLine = h('div.sq-games__count', { 'aria-live': 'polite' });

      wrap.append(
        h('div.sq-games__bar', h('div.field.sq-games__search', icon('search'), search), chips),
        countLine, grid, foot);

      function matches() {
        const f = FILTERS.find(x => x.id === S.gfilter) || FILTERS[0];
        const q = S.gq.trim().toLowerCase();
        return S.games.filter(g => f.match(g) && (!q || g.title.toLowerCase().includes(q)));
      }
      function renderGrid() {
        const all = matches();
        const shown = all.slice(0, S.gpage * PAGE);
        clear(grid); clear(foot);
        countLine.textContent = `${all.length} multiplayer game${all.length === 1 ? '' : 's'}${S.gq.trim() ? ` matching “${S.gq.trim()}”` : ''}`;
        if (!all.length) {
          grid.appendChild(h('div.empty', icon('search'), h('b', { text: 'No games match' }), h('small', { text: 'Try another word or a different mode.' })));
          return;
        }
        for (const g of shown) grid.appendChild(gameCard(g));
        if (shown.length < all.length) {
          foot.appendChild(h('button.btn', { type: 'button', onclick: () => { S.gpage++; renderGrid(); } },
            h('span', { text: `Show more (${all.length - shown.length} left)` })));
        }
      }
      renderGrid();
    }

    function gameCard(g) {
      const stats = [];
      if (g.hasStats && g.plays) stats.push(h('span.sq-card__stat', icon('flame'), h('span', { text: fmtPlays(g.plays) })));
      if (g.hasStats && g.rating) stats.push(h('span.sq-card__stat', icon('star'), h('span', { text: g.rating.toFixed(1) })));
      return h('div.sq-card',
        h('button.sq-card__art-btn', { type: 'button', 'aria-label': `Play ${g.title}`, onclick: () => api.openApp('aether-games', { url: `static://games/${g.id}` }) },
          artThumb(g.id, g.art, 'sq-card__art'),
          h('span.sq-card__play', icon('play'))),
        h('div.sq-card__body',
          h('div.sq-card__title.trunc', { text: g.title }),
          h('div.sq-card__meta',
            h('span.chip.sq-chip', { text: playerMode(g) || 'Multiplayer' }),
            stats.length ? h('span.sq-card__stats', stats) : h('span.dim.trunc', { text: g.studio || '' })),
          h('div.sq-card__acts',
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => api.openApp('aether-games', { url: `static://games/${g.id}` }) }, icon('play'), h('span', { text: 'Play' })),
            h('button.btn.btn--sm', { type: 'button', onclick: () => { setTab('parties'); openCreate(g.id); } }, icon('users'), h('span', { text: 'Party' })))));
    }

    const fmtPlays = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

    /* ---------------- procedural art fallback ---------------- */
    function artThumb(id, art, cls) {
      const wrap = h(`div.sq-art.${cls}`, { style: { '--h': String(hueOf(id || 'x')) } });
      if (art) {
        wrap.appendChild(h('img', {
          src: art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
          onerror: e => { e.currentTarget.remove(); },
        }));
      }
      wrap.appendChild(h('span.sq-art__glyph', icon('gamepad')));
      return wrap;
    }

    /* ---------------- boot ---------------- */
    readStore();
    paintPresence();
    setTab('parties');

    catalogue.load().then(() => {
      if (!S.alive) return;
      const all = catalogue.all().filter(isMulti);
      // popular first (rows with real stats, then plays), then title
      all.sort((a, b) => (b.hasStats - a.hasStats) || (b.plays - a.plays) || a.title.localeCompare(b.title));
      S.games = all;
      const counts = { all: all.length };
      for (const f of FILTERS) if (f.id !== 'all') counts[f.id] = all.filter(f.match).length;
      S.counts = counts;
      S.ready = true;
      if (S.tab === 'games') paintBody();
      if (S.mode === 'create') buildDetail();
    }).catch(err => {
      if (!S.alive) return;
      S.error = String(err && err.message || err);
      S.ready = false;
      if (S.tab === 'games') paintBody();
    });

    win.onReopen?.(o => { if (o && o.tab) setTab(o.tab); });
    if (opts && opts.tab) setTab(opts.tab);

    /* ---------------- teardown ---------------- */
    return () => {
      S.alive = false;
      for (const t of S.timers) clearInterval(t);
      S.timers = [];
      try { post({ t: 'bye', peer: S.peerId }); } catch (e) {}
      try { if (bc) { bc.onmessage = null; bc.close(); } } catch (e) {}
      bc = null;
    };

    function grow(ta) {
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    }
  },
});
