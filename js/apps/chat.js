/* ============================================================
   Static Chat — deliberately not the three-column norm.

   Spaces and channels live in one strip across the TOP, the
   conversation gets the whole width underneath it, and presence
   is an ambient rail that folds away.

   Every byte of data comes from js/portal/chat.transport.js —
   the only module that knows whether a room is a local store, a
   friend or a shared space. This file never touches storage.

   WHO IS HERE. The built-in spaces keep what you write on this
   device and say so. The Friends space has one channel per real
   friend (direct messages). A shared space is a private room you
   open with a code, like Notes' Write Together. A message never
   claims it was read: it says "Sent" or "Saved on this device only".
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { BRAND } from '../portal/brand.js';
import {
  ME, personById, subscribe, listSpaces, listChannels, listMessages,
  send, react, edit, remove, members, markRead, draft, setTyping, quiet,
  pin, listPins, setMuted, readAt, setViewing, sendPoll, votePoll, endPoll, pollOf, sendVoice, voiceUrl,
  createSpace, joinSpace, connectSpace, disconnectSpace, deleteSpace, spaceInfo, channelLive, mentionable, kindOfChannel,
} from '../portal/chat.transport.js';
import { buildDiscordPanel } from '../portal/discord.panel.js';
import { pollCard, pollForm } from './pollcard.js';
import * as POLL from '../core/polls.js';
import * as W from '../core/chatwire.js';

/* the poll card's look lives with Static Social's polls; the chat additions are their own sheet */
for (const [id, href] of [['feat-social-css', 'css/feat-social.css'], ['feat-chat-css', 'css/feat-chat.css']]) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }
}

const EMOJI      = W.REACTIONS;
const RUN_MS     = 5 * 60 * 1000;   // one author inside this window = one run
const STICK      = 80;              // px from the bottom that still counts as "at the bottom"
const TYPE_OFF   = 1200;            // idle before we stop telling the room we type
const TYPE_STALE = 7000;            // drop a stale typist if their "off" never lands
const MAX_ROWS   = 132;             // matches .ch__box textarea max-height

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* A blocked clipboard throws on access AND rejects the promise — swallow both
   so "Copy text" can never raise an unhandled rejection. */
const copyText = t => {
  try { navigator.clipboard?.writeText(String(t))?.catch(() => {}); } catch (e) { /* no clipboard */ }
};

/* where a card opens: the same pages Static Social's "send a page" opens */
const CARD_APP = {
  game: { app: 'aether-games', url: id => `static://games/${id}`, name: 'Static Games' },
  anime: { app: 'aether-anime', url: id => `static://anime/${id}`, name: 'Static Anime' },
  roblox: { app: 'aether-roblox', url: id => `static://roblox/${id}`, name: 'Static Roblox' },
};

/* lazily loaded art for stickers (js/core/stickerpack.js): the app starts without it */
let STK = null;
const stickers = () => (STK ||= import('../core/stickerpack.js'));

defineApp({
  id: 'chat',
  name: `${BRAND.name} Chat`,            // one constant owns the product name
  icon: 'message-circle',
  g1: '#3fcf72', g2: '#097a3a',
  category: 'Internet',
  keywords: ['chat', 'messages', 'rooms', 'spaces', 'channels', 'dm', 'talk', 'direct messages', 'voice message', 'stickers', 'poll'],
  desc: 'Spaces, channels and the people in them',
  pinned: true, dock: true, singleton: true,
  win: { w: 1000, h: 680, minW: 620, minH: 440 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, fmt, store } = api;

    /* ---------------- state ---------------- */
    const S = {
      alive: true,
      spaces: [], channels: [], msgs: [], people: [],
      spaceId: null, channelId: null,
      reply: null,
      rail: true,
      search: false, query: '', hits: [], token: 0,
      typing: new Map(),        // person id -> stale timeout
      typingOn: false, typeTimer: 0,
      lastDay: '', lastAuthor: null, lastAt: 0,
      newFrom: 0, newShown: false,     // the "new" line: where unread messages start
      rec: null,                       // a voice message being recorded or waiting to be sent
      pop: null,                       // the open popover: its name
      ment: [],                        // @mention suggestions
      note: '',                        // a one-line notice under the composer
    };
    const pollIds = new WeakMap();     // poll object -> its message id

    /* ---------------- people --------------- */
    const person = id => personById(id) || { id, name: 'Someone', initials: '?', hue: 0, role: '' };
    const statusOf = p => (p.id === ME.id ? 'online' : (p.status || 'offline'));
    const statusCls = p => ({ online: 'is-online', idle: 'is-idle', dnd: 'is-dnd' }[statusOf(p)] || '');
    const hueOf = p => `hsl(${p.hue || 0} 62% 62%)`;

    function avatar(p) {
      return h('div.ch-avatar', {
        class: statusCls(p),
        style: { background: hueOf(p) },
        text: p.initials || (p.name || '?')[0].toUpperCase(),
        title: `${p.name} — ${statusOf(p)}`,
      });
    }

    /* ---------------- time ----------------- */
    const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}.${d.getMonth()}.${d.getDate()}`; };
    function dayLabel(t) {
      const today = dayKey(Date.now());
      const yday  = dayKey(Date.now() - 86400000);
      if (dayKey(t) === today) return 'Today';
      if (dayKey(t) === yday)  return 'Yesterday';
      const d = new Date(t);
      return `${fmt.dayName(d, 1)}, ${fmt.monthName(d, 1)} ${d.getDate()}`;
    }
    function timeLabel(t) {
      const c = fmt.fmtClock(new Date(t));
      return `${c.time} ${c.ap}`;
    }

    /* ---------------- chrome --------------- */
    const spacesEl = h('div.ch__spaces');
    const chansEl  = h('div.ch__chans', { role: 'tablist', 'aria-label': 'Channels' });

    const searchIn = h('input', {
      type: 'search', placeholder: 'Search this space…', spellcheck: 'false',
      'aria-label': 'Search messages in this space',
      oninput: e => { S.query = e.target.value; onSearchInput(); },
    });
    const searchBox = h('div.field.hidden', { style: { width: '200px', height: '26px' } },
      icon('search'), searchIn);

    /* tip--below: the strip is the first row in .win__body (overflow:hidden),
       so a tooltip drawn above it is clipped by the window. */
    const btnSearch = h('button.ibtn.tip.tip--below', {
      'data-tip': 'Search', 'aria-label': 'Search messages', 'aria-pressed': 'false',
      onclick: () => (S.search ? closeSearch() : openSearch()),
    }, icon('search'));

    const btnRail = h('button.ibtn.tip.tip--below.is-on', {
      'data-tip': 'People', 'aria-label': 'Toggle the people rail', 'aria-pressed': 'true',
      onclick: toggleRail,
    }, icon('users'));

    const btnSpace = h('button.ibtn.tip.tip--below', {
      'data-tip': 'Shared space', 'aria-label': 'Start or join a shared space', 'data-act': 'space-pop',
      onclick: () => togglePop('space', spacePop),
    }, icon('link'));

    const strip = h('div.ch__strip', spacesEl, chansEl, searchBox, btnSpace, btnSearch, btnRail);

    const topic = h('div.ch__topic');
    const pinsEl = h('div.ch__pins.hidden');
    const log   = h('div.ch__log', { tabindex: '0', role: 'log', 'aria-label': 'Conversation' });
    const rail  = h('aside.ch__rail', { 'aria-label': 'People' });
    const bodyEl  = h('div.ch__body', log, rail);
    const typingEl = h('div.ch__typing', { 'aria-live': 'polite' });

    const replyBar = h('div.ch__replying.hidden');
    const stateEl = h('div.ch__state', { role: 'status' });
    const popEl = h('div.ch-pop.hidden', { role: 'dialog' });
    const mentEl = h('div.ch-ment.hidden', { role: 'listbox', 'aria-label': 'Mention someone' });
    const ta = h('textarea', {
      rows: '1', placeholder: 'Message', 'aria-label': 'Message',
      oninput: onCompose, onkeydown: onComposeKey,
    });
    const sendBtn = h('button.ch__send', {
      disabled: true, 'aria-label': 'Send message', onclick: submit,
    }, icon('arrow-up'));
    const tool = (name, label, act, fn) => h('button.ibtn.ch__tool.tip', {
      type: 'button', 'data-tip': label, 'aria-label': label, 'data-act': act, 'data-pop': '1', onclick: fn,
    }, icon(name));
    const btnAttach = tool('plus', 'Attach a file or a game, anime or Roblox card', 'attach', e => attachMenu(e));
    const btnSticker = tool('sparkles', 'Stickers', 'sticker', () => togglePop('sticker', stickerPop));
    const btnPoll = tool('bar-chart', 'Make a poll', 'poll', () => togglePop('poll', () => pollPop()));
    const btnMic = tool('mic', 'Record a voice message', 'voice', () => startVoice());
    const toolsEl = h('div.ch__tools', btnAttach, btnSticker, btnPoll, btnMic);
    const boxEl = h('div.ch__box', toolsEl, ta, sendBtn);
    const recEl = h('div.ch-rec.hidden', { role: 'group', 'aria-label': 'Voice message' });
    const composer = h('div.ch__composer', replyBar, mentEl, popEl, recEl, boxEl, stateEl);

    root.appendChild(h('div.app', h('div.ch', strip, topic, pinsEl, bodyEl, typingEl, composer)));

    /* ---------------- inline markup --------- *
     * **bold**, `code` and @mentions, built as nodes. User
     * text never reaches innerHTML.                         */
    function markup(text) {
      const names = [ME.name, ...mentionable(S.channelId).map(p => p.name)].filter(Boolean)
        .sort((a, b) => b.length - a.length).map(esc);
      const at = names.length ? `|(?<![\\w@])(@(?:${names.join('|')}))(?![\\w])` : '';
      const re = new RegExp(`\\*\\*([^*\\n]+)\\*\\*|\`([^\`\\n]+)\`${at}`, 'gi');
      const out = [];
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
        out.push(m[1] != null ? h('b', { text: m[1] }) : m[2] != null ? h('code', { text: m[2] })
          : h('span.ch-mention', { text: m[3], class: m[3].slice(1).toLowerCase() === ME.name.toLowerCase() ? 'is-me' : null }));
        last = re.lastIndex;
      }
      if (last < text.length) out.push(document.createTextNode(text.slice(last)));
      return out.length ? out : [document.createTextNode(text)];
    }

    /* ---------------- one message ----------- */
    function msgNode(m, run) {
      const p = person(m.author);
      const mine = m.author === ME.id;
      const parent = m.replyTo ? S.msgs.find(x => x.id === m.replyTo) : null;

      const el = h('div.ch-msg', {
        dataset: { id: m.id },
        class: [mine ? 'is-mine' : '', run ? 'is-run' : '', m.mention ? 'is-mention' : '', m.pinned ? 'is-pinned' : ''].filter(Boolean).join(' ') || null,
        oncontextmenu: e => msgMenu(e, m),
      });

      const bodyBox = h('div.ch-msg__b');

      if (m.replyTo) {
        bodyBox.appendChild(h('div.ch-reply',
          h('b', { text: parent ? person(parent.author).name : 'a deleted message' }),
          h('span.trunc', { text: parent ? clip(parent.body, 90) : 'the original is gone' })));
      }

      bodyBox.appendChild(h('div.ch-msg__head',
        h('span.ch-msg__who', { text: p.name }),
        p.role && p.id !== ME.id && h('span.ch-msg__role', { text: p.role }),
        h('span.ch-msg__at', { text: timeLabel(m.at) }),
        m.pinned && h('span.ch-msg__pin', { title: 'Pinned on this device' }, icon('pin')),
        mine && deliveryTag(m)));

      bodyBox.appendChild(content(m));

      const reacts = reactRow(m);
      if (reacts) bodyBox.appendChild(reacts);

      el.append(avatar(p), bodyBox, actsRow(m));
      return el;
    }

    /* What happened to a message you sent. Never "read": nothing here can know that. */
    function deliveryTag(m) {
      if (kindOfChannel(m.channelId) === 'local') return null;
      const sent = m.delivery === 'sent';
      return h('span.ch-msg__sent', {
        class: sent ? null : 'is-local', 'data-delivery': sent ? 'sent' : 'local',
        title: sent ? 'Handed to the connection. StaticOS cannot tell whether anyone has read it.' : 'Not sent: there was no live connection. It is saved on this device only.',
        text: sent ? 'Sent' : 'Saved on this device only',
      });
    }

    function content(m) {
      const kind = m.kind || 'txt';
      if (kind === 'stk') return stickerBody(m);
      if (kind === 'card') return cardBody(m);
      if (kind === 'file') return fileBody(m);
      if (kind === 'poll') return pollBody(m);
      if (kind === 'voice') return voiceBody(m);
      return h('div.ch-msg__t',
        ...markup(m.body),
        m.edited && h('span.ch-msg__edited', { text: '(edited)' }));
    }

    function stickerBody(m) {
      const img = h('img.ch-sticker', { alt: 'Sticker', width: '96', height: '96', draggable: 'false' });
      stickers().then(K => {
        const s = K.find(m.sticker);
        if (!s) { img.replaceWith(h('div.ch-msg__t.dim', { text: 'A sticker this version does not have.' })); return; }
        img.alt = `Sticker: ${s.name}`; img.title = s.name;
        img.src = K.artUrl(m.sticker);
      }).catch(() => {});
      return h('div.ch-msg__t', img);
    }

    function cardBody(m) {
      const c = m.card, K = CARD_APP[c.k];
      const title = h('b', { text: 'Looking it up…' });
      const open = h('button.btn.btn--sm', { type: 'button', 'data-act': 'open-card', hidden: true,
        onclick: () => { try { api.openApp(K.app, { url: K.url(c.i) }); } catch (e) { /* no app */ } } }, `Open in ${K.name}`);
      const sub = h('small.dim', { text: m.author === ME.id ? `${K.name} · nothing opens for them until they choose` : `${K.name} · nothing opens until you choose` });
      cardTitle(c).then(t => {
        if (!S.alive) return;
        title.textContent = t || 'Not in this version’s catalogue';
        open.hidden = !t;
      });
      return h('div.ch-card', { 'data-card': c.k }, icon(c.k === 'anime' ? 'film' : 'gamepad'), h('div.col.grow', title, sub), open);
    }
    /* the title comes from THIS device's catalogue, never from the message */
    async function cardTitle(c) {
      try {
        if (c.k === 'game') { const G = await import('../portal/games.data.js'); await G.load(); const g = G.byId(c.i); return g ? g.title : null; }
        if (c.k === 'anime') { const A = await import('../portal/anime.data.js'); await A.load('anime'); const a = A.byId(c.i, 'anime'); return a ? a.title : null; }
        const R = await import('../portal/roblox.data.js'); await R.load(); const r = R.byId(c.i); return r ? r.name : null;
      } catch (e) { return null; }
    }

    function fileBody(m) {
      const f = m.file, mine = m.author === ME.id;
      return h('div.ch-card', { 'data-card': 'file' }, icon('file'),
        h('div.col.grow', h('b', { text: f.n }),
          h('small.dim', { text: `${fmt.fmtBytes(f.z)} · ${mine ? 'only the name and size were sent' : 'only the name and size came with it. Ask for the file with Static Drop.'}` })),
        mine && f.path && api.vfs.node(f.path)
          ? h('button.btn.btn--sm', { type: 'button', 'data-act': 'open-file', onclick: () => api.openFile(f.path) }, 'Open')
          : h('button.btn.btn--sm', { type: 'button', 'data-act': 'open-drop', onclick: () => api.openApp('drop', {}) }, 'Static Drop'));
    }

    const pollCtx = {
      myId: ME.id,
      vote: (P, ch) => { const id = pollIds.get(P); if (id) votePoll(id, ch); },
      close: P => { const id = pollIds.get(P); if (id) endPoll(id); },
    };
    function pollBody(m) {
      const P = pollOf(m);
      pollIds.set(P, m.id);
      const lone = kindOfChannel(m.channelId) === 'local';
      return h('div.ch-msg__t', pollCard({ h, icon }, P, pollCtx),
        lone && h('small.dim.ch-lone', { text: 'Only you are in this room, so only your vote can be counted. Polls work with a friend or in a shared space.' }));
    }

    function voiceBody(m) {
      const url = voiceUrl(m.id);
      const len = fmt.fmtDur(Math.round((m.voice?.dur || 0) / 1000));
      if (!url) return h('div.ch-msg__t.dim', { text: `Voice message · ${len} · the audio is not kept after StaticOS closes` });
      return h('div.ch-voice', icon('mic'), h('audio', { controls: true, src: url, preload: 'metadata', 'aria-label': `Voice message, ${len}` }), h('small.dim', { text: len }));
    }

    function reactRow(m) {
      const keys = Object.keys(m.reactions || {}).filter(k => (m.reactions[k] || []).length);
      if (!keys.length) return null;
      return h('div.ch-reacts', ...keys.map(e => {
        const who = m.reactions[e] || [];
        return h('button.ch-react', {
          class: who.includes(ME.id) ? 'is-mine' : null,
          title: who.map(id => person(id).name).join(', '),
          'aria-label': `${e} ${who.length} — toggle your reaction`,
          onclick: () => react(m.id, e),
        }, h('span', { text: e }), h('span', { text: String(who.length) }));
      }));
    }

    /* The acts bar only exists on hover (CSS), so it stays out of the
       tab order — right-click gives the same actions to the keyboard. */
    function actsRow(m) {
      const mine = m.author === ME.id;
      const editable = mine && (!m.kind || m.kind === 'txt');
      const act = (kids, label, fn) => h('button.ibtn', {
        tabindex: '-1', title: label, 'aria-label': label, onclick: fn,
      }, kids);
      return h('div.ch-msg__acts',
        ...EMOJI.map(e => act(h('span', { text: e }), `React ${e}`, () => react(m.id, e))),
        act(icon('corner-up-left'), 'Reply', () => startReply(m)),
        act(icon('pin'), m.pinned ? 'Unpin' : 'Pin', () => pin(m.id, !m.pinned)),
        editable && act(icon('edit-3'), 'Edit', () => startEdit(m)),
        mine && act(icon('trash'), 'Delete', () => askRemove(m)));
    }

    function msgMenu(e, m) {
      e.preventDefault(); e.stopPropagation();
      const mine = m.author === ME.id;
      const editable = mine && (!m.kind || m.kind === 'txt');
      api.menu([
        { label: 'Reply', icon: 'corner-up-left', onClick: () => startReply(m) },
        ...EMOJI.map(x => ({ label: `React ${x}`, icon: 'heart', onClick: () => react(m.id, x) })),
        '-',
        { label: m.pinned ? 'Unpin from this device' : 'Pin (on this device)', icon: 'pin', onClick: () => pin(m.id, !m.pinned) },
        { label: 'Copy text', icon: 'copy', onClick: () => copyText(m.kind === 'poll' ? POLL.resultsText(pollOf(m)) : m.body) },
        editable && { label: 'Edit…', icon: 'edit-3', onClick: () => startEdit(m) },
        mine && { label: 'Delete…', icon: 'trash', danger: true, onClick: () => askRemove(m) },
      ].filter(Boolean), e.clientX, e.clientY);
    }

    /* ---------------- message actions ------- */
    function startReply(m) {
      S.reply = m;
      paintReply();
      ta.focus();
    }
    function clearReply() { S.reply = null; paintReply(); }

    /* Resolve the row now, not when the button was built — a menu can outlive
       a repaint, and editing a detached node puts the field nowhere. */
    function startEdit(m) {
      const row = rowFor(m.id);
      const target = row && row.querySelector('.ch-msg__t');
      if (!target) return;
      const input = h('input', {
        type: 'text', value: m.body, 'aria-label': 'Edit message',
        onkeydown: async e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const next = input.value.trim();
            if (!next || next === m.body) { restore(); return; }
            await edit(m.id, next);
          } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); restore(); }
        },
      });
      const restore = () => replaceRow(m);
      target.replaceWith(h('div.col', { style: { gap: 'var(--sp-2)' } },
        h('div.field', input),
        h('small.dim', { text: 'Enter saves · Esc cancels' })));
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }

    async function askRemove(m) {
      const ok = await api.confirm({
        title: 'Delete this message?',
        message: clip(m.body, 110),
        ok: 'Delete', cancel: 'Keep',
      });
      if (ok && S.alive) await remove(m.id);
    }

    /* ---------------- the log --------------- */
    const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight <= STICK;
    const scrollEnd  = () => { log.scrollTop = log.scrollHeight; };
    const rowFor = id => [...log.children].find(el => el.dataset && el.dataset.id === id) || null;

    function resetRun() { S.lastDay = ''; S.lastAuthor = null; S.lastAt = 0; S.newShown = false; }

    function addRow(m) {
      const key = dayKey(m.at);
      if (key !== S.lastDay) {
        log.appendChild(h('div.ch-day', h('span', { text: dayLabel(m.at) })));
        S.lastDay = key;
        S.lastAuthor = null;
      }
      /* the line where what you had not seen starts */
      if (!S.newShown && S.newFrom !== null && m.at > S.newFrom && m.author !== ME.id) {
        log.appendChild(h('div.ch-new', { 'data-new': '1' }, h('span', { text: 'New' })));
        S.newShown = true;
        S.lastAuthor = null;
      }
      const run = m.author === S.lastAuthor && (m.at - S.lastAt) < RUN_MS && !m.replyTo && !m.mention;
      log.appendChild(msgNode(m, run));
      S.lastAuthor = m.author;
      S.lastAt = m.at;
    }

    function replaceRow(m) {
      const old = rowFor(m.id);
      if (!old) return;
      old.replaceWith(msgNode(m, old.classList.contains('is-run')));
    }

    function paintLog({ keep = false } = {}) {
      if (S.search) { paintResults(); return; }
      /* An external space is not a simulated room — the Discord panel owns
         the body and talks to the real API. */
      if (currentSpace()?.external) { paintExternal(); return; }
      closeExternal();
      applyRail();
      const at = log.scrollTop;
      api.clear(log);
      resetRun();
      const c = currentChannel();
      if (!c) { emptyState(); paintPins(); return; }
      if (!S.msgs.length) {
        log.appendChild(h('div.empty', { style: { margin: 'auto', height: 'auto' } },
          icon('message-circle'),
          h('b', { text: 'No messages yet' }),
          h('small', { text: kindOfChannel(c.id) === 'local'
            ? `Nothing has been said in #${c.name}. What you write stays on this device.`
            : `Nothing has been said here yet. Say the first thing.` })));
        paintPins();
        return;
      }
      for (const m of S.msgs) addRow(m);
      if (keep) log.scrollTop = at; else scrollEnd();
      paintPins();
      paintTopic();
    }

    /* the log when a space has no channel to show */
    function emptyState() {
      const sp = currentSpace();
      if (sp && sp.dm) {
        log.appendChild(h('div.empty', { style: { margin: 'auto', height: 'auto' } },
          icon('users'),
          h('b', { text: 'No friends to message yet' }),
          h('small', { text: 'Direct messages go only to friends you have added with a code, and need a signed-in account. Nothing here can reach a stranger.' }),
          h('button.btn.btn--sm', { type: 'button', 'data-act': 'open-friends', onclick: () => api.openApp('social', { friends: true }) }, icon('users'), 'Open Friends')));
        return;
      }
      log.appendChild(h('div.empty', { style: { margin: 'auto', height: 'auto' } },
        icon('message-circle'), h('b', { text: 'Pick a channel' }), h('small', { text: 'Choose a channel from the strip above.' })));
    }

    /* ---------------- external (Discord) ---- */
    let ext = null;
    function paintExternal() {
      /* the panel lists Discord's own online members, so the local rail would
         only be confusing next to it */
      rail.classList.add('is-folded');
      api.clear(log);
      if (!ext) {
        try {
          ext = buildDiscordPanel({ api, store, onChange: () => refreshCounts() });
        } catch (err) {
          log.appendChild(h('div.empty', icon('alert'),
            h('b', { text: 'Discord panel failed to load' }),
            h('small', { text: String(err && err.message || err) })));
          return;
        }
      }
      log.appendChild(ext.el);
    }
    function closeExternal() { if (ext) { ext.stop(); ext = null; } }
    function applyRail() { rail.classList.toggle('is-folded', !S.rail); }

    /* ---------------- search ---------------- */
    function openSearch() {
      S.search = true;
      searchBox.classList.remove('hidden');
      btnSearch.classList.add('is-on');
      btnSearch.setAttribute('aria-pressed', 'true');
      searchIn.focus();
      searchIn.select();
      paintResults();
    }
    function closeSearch() {
      S.search = false;
      S.query = ''; searchIn.value = ''; S.hits = [];
      searchBox.classList.add('hidden');
      btnSearch.classList.remove('is-on');
      btnSearch.setAttribute('aria-pressed', 'false');
      paintLog();
    }

    const onSearchInput = fmt.debounce(() => { if (S.alive && S.search) runSearch(); }, 170);

    async function runSearch() {
      const q = S.query.trim().toLowerCase();
      const token = ++S.token;
      if (q.length < 2) { S.hits = []; paintResults(); return; }
      const hits = [];
      for (const c of S.channels) {
        const rows = await listMessages(c.id);
        if (!S.alive || token !== S.token) return;
        for (const m of rows) if (m.body.toLowerCase().includes(q)) hits.push({ c, m });
      }
      hits.sort((a, b) => b.m.at - a.m.at);
      S.hits = hits;
      paintResults();
    }

    function paintResults() {
      api.clear(log);
      const space = currentSpace();
      const q = S.query.trim();
      if (q.length < 2) {
        log.appendChild(h('div.empty', { style: { margin: 'auto', height: 'auto' } },
          icon('search'),
          h('b', { text: `Search ${space ? space.name : 'this space'}` }),
          h('small', { text: 'Type at least two characters to search every channel in this space.' })));
        return;
      }
      if (!S.hits.length) {
        log.appendChild(h('div.empty', { style: { margin: 'auto', height: 'auto' } },
          icon('search'),
          h('b', { text: 'No matches' }),
          h('small', { text: `Nothing in ${space ? space.name : 'this space'} contains “${q}”.` })));
        return;
      }
      log.appendChild(h('div.label', { text: `${S.hits.length} result${S.hits.length === 1 ? '' : 's'} in ${S.channels.length} channels` }));
      log.appendChild(h('div.list', ...S.hits.map(({ c, m }) => h('button.list__item', {
        onclick: () => jumpTo(c.id, m.id),
      },
        h('div.grow',
          h('b', { text: `${person(m.author).name} · #${c.name}` }),
          h('small', { text: clip(m.body, 130) })),
        h('small.dim', { text: `${dayLabel(m.at)} ${timeLabel(m.at)}` })))));
      log.scrollTop = 0;
    }

    async function jumpTo(channelId, messageId) {
      closeSearch();
      if (channelId !== S.channelId) await openChannel(channelId);
      if (!S.alive) return;
      const row = rowFor(messageId);
      if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('is-flash'); setTimeout(() => row.classList.remove('is-flash'), 1600); }
    }

    /* ---------------- strip ----------------- */
    const currentSpace   = () => S.spaces.find(s => s.id === S.spaceId) || null;
    const currentChannel = () => S.channels.find(c => c.id === S.channelId) || null;
    const channelName    = id => (S.channels.find(c => c.id === id) || {}).name || id;

    function paintSpaces() {
      api.clear(spacesEl);
      for (const s of S.spaces) {
        spacesEl.appendChild(h('button.ch-space', {
          class: s.id === S.spaceId ? 'is-on' : null,
          title: s.blurb || s.name,
          dataset: { space: s.id },
          'aria-label': `${s.name}${s.unread ? ` — ${s.unread} unread` : ''}`,
          'aria-pressed': s.id === S.spaceId ? 'true' : 'false',
          onclick: () => openSpace(s.id),
          oncontextmenu: s.shared ? (e => { e.preventDefault(); spaceMenu(e.clientX, e.clientY, s.id); }) : null,
        },
          h('div.glyph', { style: { '--g1': s.g1, '--g2': s.g2 } },
            icon(api.hasIcon(s.glyph) ? s.glyph : 'message-circle')),
          h('span', { text: s.name }),
          s.unread > 0 && h('span.ch-space__pip', { text: s.unread > 99 ? '99+' : String(s.unread) })));
      }
    }

    function paintChans() {
      api.clear(chansEl);
      for (const c of S.channels) {
        const on = c.id === S.channelId;
        chansEl.appendChild(h('button.ch-chan', {
          class: [on ? 'is-on' : '', !on && c.unread > 0 && !c.muted ? 'has-unread' : '', c.muted ? 'is-muted' : ''].filter(Boolean).join(' ') || null,
          title: c.topic || '',
          dataset: { chan: c.id },
          role: 'tab', 'aria-selected': on ? 'true' : 'false',
          'aria-label': `#${c.name}${c.muted ? ' — muted' : ''}${!on && c.unread ? ` — ${c.unread} unread` : ''}`,
          onclick: () => openChannel(c.id),
        }, h('span.dim', { text: c.kind === 'dm' ? '@' : '#' }), h('span', { text: c.name }), c.muted && icon('bell-off')));
      }
    }

    /* the one honest line about where a channel's messages go */
    function stateText(c) {
      if (!c) return '';
      const kind = kindOfChannel(c.id);
      if (kind === 'local') return 'Saved on this device only';
      if (channelLive(c.id)) return kind === 'room' ? `Connected with ${spaceInfo(c.spaceId)?.peerName || 'your friend'}` : `Sent through your private friend link to ${c.name}`;
      if (kind === 'dm') return `Saved on this device only: ${c.name} looks offline or there is no connection`;
      const ph = spaceInfo(c.spaceId)?.phase;
      if (ph === 'waiting') return 'Saved on this device only: waiting for your friend to join with the code';
      if (ph === 'joining' || ph === 'connecting') return 'Saved on this device only: joining…';
      return 'Saved on this device only: not connected';
    }
    function paintState() {
      const c = currentChannel();
      const live = !!c && kindOfChannel(c.id) !== 'local' && channelLive(c.id);
      stateEl.classList.toggle('is-live', live);
      stateEl.classList.toggle('hidden', !c || !!currentSpace()?.external);
      api.render(stateEl, icon(live ? 'link' : 'info'), h('span', { text: S.note || stateText(c) }),
        h('span.grow'), h('small.dim', { text: 'Try /poll or /play' }));
    }

    function paintTopic() {
      const c = currentChannel();
      const sp = currentSpace();
      const kind = c ? kindOfChannel(c.id) : 'local';
      const info = sp && sp.shared ? spaceInfo(sp.id) : null;
      const online = S.people.filter(p => statusOf(p) !== 'offline').length;
      const unreadLine = S.newShown;
      api.render(topic,
        h('b', { text: c ? `${c.kind === 'dm' ? '@' : '#'}${c.name}` : 'No channel' }),
        h('span.trunc', { text: c ? (c.topic || 'No topic set') : '' }),
        h('div.grow'),
        unreadLine && h('button.btn.btn--sm', { type: 'button', 'data-act': 'jump-unread', onclick: jumpUnread }, icon('arrow-down'), 'Jump to first unread'),
        info && info.code && !info.connected && h('button.btn.btn--sm', { type: 'button', 'data-act': 'copy-invite', title: 'Copy the code and link. Treat the code like a password.',
          onclick: () => copyInvite(info.code) }, icon('copy'), `Code ${info.code}`),
        c && S.pinsList.length > 0 && h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Pinned messages', 'aria-label': `${S.pinsList.length} pinned`, 'data-act': 'pins',
          onclick: e => pinsMenu(e) }, icon('pin')),
        c && h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': c.muted ? 'Unmute channel' : 'Mute channel', 'data-act': 'mute',
          'aria-pressed': c.muted ? 'true' : 'false', 'aria-label': c.muted ? 'Unmute this channel' : 'Mute this channel (mentions still reach you)',
          class: c.muted ? 'is-on' : null, onclick: toggleMute }, icon(c.muted ? 'bell-off' : 'bell')),
        c && h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Export as text', 'aria-label': 'Export this channel as a text file', 'data-act': 'export',
          onclick: exportChannel }, icon('download')),
        sp && sp.shared && h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Shared space', 'aria-label': 'Shared space options', 'data-act': 'space-menu',
          onclick: e => { const r = e.currentTarget.getBoundingClientRect(); spaceMenu(r.left, r.bottom + 4, sp.id); } }, icon('more-horizontal')),
        c && h('span.chip', { 'data-state': kind === 'local' || !channelLive(c.id) ? 'local' : 'live', title: kind === 'local'
          ? 'StaticOS has no chat server: this room keeps your messages on this device. Shared spaces and Friends are the live ones.'
          : (stateText(c) + '. Nothing says a message was read.') },
        icon(kind !== 'local' && channelLive(c.id) ? 'link' : 'user'),
        h('span', { text: kind !== 'local' && channelLive(c.id) ? (S.people.length > 1 ? `${online} of ${S.people.length} here` : 'Connected') : 'Saved on this device only' })));
      paintState();
    }

    /* ---------------- presence rail --------- */
    function paintRail() {
      const on  = S.people.filter(p => statusOf(p) !== 'offline');
      const off = S.people.filter(p => statusOf(p) === 'offline');
      const sp = currentSpace();
      api.render(rail,
        group(S.people.length > 1 ? 'Online' : 'On this device', on, false),
        off.length ? group('Offline', off, true) : null,
        S.people.length > 1 ? null : h('p.ch-rail__note', { text: railNote(sp) }));
    }
    function railNote(sp) {
      if (sp && sp.dm) return 'You have no friends added yet. Add some in Static Social › Friends; only they can be messaged here.';
      if (sp && sp.shared) return 'Waiting for your friend. Share the code; nobody else can join, and messages you send before they arrive stay on this device only.';
      return 'No one else is in these rooms: StaticOS has no chat server, so messages stay on this device. Add friends in Static Social, or start a shared space with a code.';
    }

    function group(label, list, dimmed) {
      return h('div.col', { style: { gap: '2px' } },
        h('div.label', { text: `${label} — ${list.length}`, style: { padding: '0 var(--sp-3) var(--sp-3)' } }),
        ...list.map(p => h('div.ch-who', { class: dimmed ? 'is-off' : null },
          avatar(p),
          h('div.col.grow',
            h('span.ch-who__n.trunc', { text: p.id === ME.id ? `${p.name} (you)` : p.name }),
            h('span.ch-who__r.trunc', { text: p.role || '' })))));
    }

    function toggleRail() {
      S.rail = !S.rail;
      rail.classList.toggle('is-folded', !S.rail);
      btnRail.classList.toggle('is-on', S.rail);
      btnRail.setAttribute('aria-pressed', String(S.rail));
      store.set('prefs.chatRail', S.rail);
    }

    /* ---------------- pins, mute, unread, export ---------------- */
    S.pinsList = [];
    async function paintPins() {
      const id = S.channelId;
      S.pinsList = id ? await listPins(id) : [];
      if (!S.alive || id !== S.channelId) return;
      pinsEl.classList.toggle('hidden', !S.pinsList.length || S.search);
      const top = S.pinsList[0];
      if (top) {
        api.render(pinsEl, icon('pin'),
          h('button.ch-pinned.trunc', { type: 'button', 'data-act': 'jump-pin', title: 'Jump to the pinned message', onclick: () => jumpTo(id, top.id) },
            h('b', { text: person(top.author).name }), h('span', { text: ` ${clip(top.body, 120)}` })),
          S.pinsList.length > 1 && h('small.dim', { text: `${S.pinsList.length} pinned` }),
          h('small.dim', { text: 'on this device' }));
      }
      const had = topic.querySelector('[data-act="pins"]');
      if (!!had !== (S.pinsList.length > 0)) paintTopic();
    }
    function pinsMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      api.menu(S.pinsList.map(m => ({ label: `${person(m.author).name}: ${clip(m.body, 60)}`, icon: 'pin', onClick: () => jumpTo(S.channelId, m.id) })), r.left, r.bottom + 4);
    }

    async function toggleMute() {
      const c = currentChannel();
      if (!c) return;
      setMuted(c.id, !c.muted);
      await refreshCounts();
      paintTopic();
    }

    function jumpUnread() {
      const line = log.querySelector('[data-new]');
      if (line) line.scrollIntoView({ block: 'start' });
    }

    function exportText() {
      const c = currentChannel(), sp = currentSpace();
      const lines = [`${c.kind === 'dm' ? '@' : '#'}${c.name} · ${sp ? sp.name : ''} · ${BRAND.name} Chat`,
        `Exported ${new Date().toLocaleString()} from this device. Messages in this file are the ones saved here.`, ''];
      for (const m of S.msgs) {
        const d = new Date(m.at);
        const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const body = m.kind === 'stk' ? '[sticker]' : m.kind === 'voice' ? '[voice message]'
          : m.kind === 'poll' ? `[poll]\n${POLL.resultsText(pollOf(m))}`
            : m.kind === 'card' ? `[${m.card.k} card: ${m.card.ti || m.card.i}]`
              : m.kind === 'file' ? `[file: ${m.file.n}, ${fmt.fmtBytes(m.file.z)}]` : m.body;
        lines.push(`[${when}] ${person(m.author).name}${m.pinned ? ' (pinned)' : ''}: ${body}${m.edited ? ' (edited)' : ''}`);
      }
      return lines.join('\n') + '\n';
    }
    function exportChannel() {
      const c = currentChannel();
      if (!c) return;
      const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `chat-${c.name.replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.txt` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      flash(`Saved ${S.msgs.length} message${S.msgs.length === 1 ? '' : 's'} as a text file.`);
    }

    function flash(text) {
      S.note = text;
      paintState();
      clearTimeout(flash.t);
      flash.t = setTimeout(() => { S.note = ''; if (S.alive) paintState(); }, 4000);
    }

    /* ---------------- typing ---------------- */
    function paintTyping() {
      api.clear(typingEl);
      const names = [...S.typing.keys()].filter(id => id !== ME.id).map(id => person(id).name);
      if (!names.length) return;
      const text = names.length === 1 ? `${names[0]} is typing`
        : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
          : `${names.length} people are typing`;
      typingEl.append(h('i'), h('i'), h('i'), h('span', { text }));
    }

    function pingTyping() {
      if (!S.channelId) return;
      if (!S.typingOn) { S.typingOn = true; setTyping(S.channelId, true); }
      clearTimeout(S.typeTimer);
      S.typeTimer = setTimeout(stopTyping, TYPE_OFF);
    }
    function stopTyping() {
      clearTimeout(S.typeTimer);
      if (S.typingOn && S.channelId) setTyping(S.channelId, false);
      S.typingOn = false;
    }

    /* ---------------- composer -------------- */
    function autoGrow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, MAX_ROWS) + 'px';
    }

    function onCompose() {
      autoGrow();
      sendBtn.disabled = !ta.value.trim();
      if (S.channelId) draft.set(S.channelId, ta.value);
      if (ta.value.trim()) pingTyping(); else stopTyping();
      suggest();
    }

    function onComposeKey(e) {
      if (S.ment.length && !mentEl.classList.contains('hidden') && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
        e.preventDefault(); pickMention(S.ment[0]); return;
      }
      if (e.key === 'Escape' && S.ment.length) { e.preventDefault(); e.stopPropagation(); hideMentions(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    }

    /* @mention: the people actually in this channel, offered as you type "@" */
    function suggest() {
      const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
      const m = /(?:^|\s)@([^\s@]{0,24})$/.exec(before);
      if (!m) { hideMentions(); return; }
      const want = m[1].toLowerCase();
      S.ment = mentionable(S.channelId).filter(p => p.name.toLowerCase().startsWith(want));
      if (!S.ment.length) { hideMentions(); return; }
      api.render(mentEl, ...S.ment.map(p => h('button.ch-ment__i', { type: 'button', role: 'option', 'data-mention': p.name,
        onmousedown: e => { e.preventDefault(); pickMention(p); } }, avatar(p), h('span', { text: p.name }))));
      mentEl.classList.remove('hidden');
    }
    function hideMentions() { S.ment = []; mentEl.classList.add('hidden'); }
    function pickMention(p) {
      const pos = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, pos).replace(/@[^\s@]{0,24}$/, `@${p.name} `);
      ta.value = before + ta.value.slice(pos);
      ta.setSelectionRange(before.length, before.length);
      hideMentions();
      onCompose();
      ta.focus();
    }

    async function submit() {
      const text = ta.value.trim();
      if (!text || !S.channelId) return;
      const cmd = W.parseCommand(text);
      const replyTo = S.reply ? S.reply.id : null;
      const channelId = S.channelId;
      const done = () => { ta.value = ''; autoGrow(); sendBtn.disabled = true; draft.set(channelId, ''); stopTyping(); clearReply(); hideMentions(); };
      if (cmd && cmd.cmd === 'poll') {
        if (cmd.form || !cmd.opts || cmd.opts.length < POLL.LIMITS.MIN) {
          /* "/poll" or "/poll Question" alone: the form, filled in with what was typed */
          togglePop('poll', () => pollPop(cmd.q ? { q: cmd.q, opts: cmd.opts || [] } : null), true);
          return;
        }
        const err = makePoll({ q: cmd.q, opts: cmd.opts, multi: false, anon: false, dur: 0 });
        if (typeof err === 'string') { flash(err); return; }
        done();
        return;
      }
      if (cmd && cmd.cmd === 'play') { done(); await playCommand(cmd.arg); if (S.alive) ta.focus(); return; }
      done();
      await send(channelId, { body: text, replyTo });
      if (S.alive) ta.focus();
    }

    function paintReply() {
      replyBar.classList.toggle('hidden', !S.reply);
      if (!S.reply) return;
      api.render(replyBar,
        h('span', { text: 'Replying to' }),
        h('b', { text: person(S.reply.author).name }),
        h('span.trunc.grow', { text: clip(S.reply.body, 80) }),
        h('button.ibtn', { 'aria-label': 'Cancel reply', title: 'Cancel reply', onclick: clearReply },
          icon('x')));
    }

    /* ---------------- popovers (stickers, polls, attach, spaces) ---------------- */
    function closePop() { S.pop = null; popEl.classList.add('hidden'); api.clear(popEl); }
    function togglePop(name, build, force = false) {
      if (S.pop === name && !force) { closePop(); return; }
      api.render(popEl, build());
      S.pop = name;
      popEl.classList.remove('hidden');
      const first = popEl.querySelector('input, button');
      if (first && name !== 'sticker') first.focus();
    }
    const offDown = api.on(window, 'pointerdown', e => {
      if (!S.pop) return;
      if (popEl.contains(e.target) || e.target.closest?.('[data-pop]') || e.target.closest?.('.menu')) return;
      closePop();
    });

    function stickerPop() {
      const box = h('div.ch-stk', { 'aria-label': 'Stickers' });
      stickers().then(K => {
        if (S.pop !== 'sticker') return;
        for (const s of K.STICKERS) {
          box.appendChild(h('button.ch-stk__b', { type: 'button', title: s.name, 'aria-label': s.name, 'data-sticker': s.id,
            onclick: () => sendSticker(s.id) }, h('img', { src: K.artUrl(s.id), alt: '', width: '48', height: '48', draggable: 'false' })));
        }
      }).catch(() => box.appendChild(h('small.dim', { text: 'The stickers could not load.' })));
      return h('div.ch-pop__in', h('b', { text: 'Stickers' }), box);
    }
    async function sendSticker(id) {
      closePop();
      if (!S.channelId) return;
      await send(S.channelId, { kind: 'stk', sticker: id });
    }

    /* a poll: made here, counted by polls.js, drawn by pollcard.js */
    function pollPop(start = null) {
      return h('div.ch-pop__in', h('b', { text: 'New poll' }),
        pollForm({ h, icon }, f => makePoll(f), start));
    }
    function makePoll(f) {
      if (!S.channelId) return 'Pick a channel first.';
      const meta = POLL.parsePoll({ pid: W.newId(), q: f.q, opts: f.opts, multi: f.multi, anon: f.anon, dur: f.dur });
      if (!meta) return 'That poll isn’t valid. Check the question and the options.';
      closePop();
      ta.value = ''; autoGrow(); sendBtn.disabled = true; if (S.channelId) draft.set(S.channelId, '');
      sendPoll(S.channelId, meta);
      return null;
    }

    /* attach: a file's name, or a game / anime / Roblox card */
    function attachMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      api.menu([
        { label: 'A file from your files…', icon: 'file', onClick: () => togglePop('pick', () => pickerPop('file'), true) },
        { label: 'A game…', icon: 'gamepad', onClick: () => togglePop('pick', () => pickerPop('game'), true) },
        { label: 'An anime…', icon: 'film', onClick: () => togglePop('pick', () => pickerPop('anime'), true) },
        { label: 'A Roblox game…', icon: 'gamepad', onClick: () => togglePop('pick', () => pickerPop('roblox'), true) },
      ], r.left, r.top - 4 - 4 * 30);
    }
    function pickerPop(kind) {
      const label = { file: 'a file', game: 'a game', anime: 'an anime', roblox: 'a Roblox game' }[kind];
      const list = h('div.ch-pick__list', { role: 'listbox' });
      const input = h('input', { type: 'search', placeholder: kind === 'file' ? 'Find a file by name' : 'Search by title', 'aria-label': `Search for ${label}`, 'data-f': 'pick' });
      const fill = fmt.debounce(async () => {
        const rows = await findRows(kind, input.value.trim());
        if (S.pop !== 'pick') return;
        api.render(list, rows.length ? rows.map(r => h('button.list__item.ch-pick__i', { type: 'button', role: 'option', 'data-pick': r.id,
          onclick: () => pickDone(kind, r) }, h('div.grow', h('b', { text: r.title }), h('small', { text: r.sub || '' }))))
          : h('small.dim', { text: kind === 'file' ? 'No file by that name.' : 'No match yet. Try fewer letters.' }));
      }, 120);
      input.addEventListener('input', fill);
      queueMicrotask(fill);
      return h('div.ch-pop__in', h('b', { text: `Share ${label}` }), h('div.field', icon('search'), input),
        h('small.dim', { text: kind === 'file'
          ? 'Only the name and size are sent. The file itself stays on this device; send it with Static Drop.'
          : 'A card is a pointer: your friend sees it from their own catalogue, and nothing opens until they choose.' }),
        list);
    }
    async function findRows(kind, q) {
      try {
        const low = q.toLowerCase();
        if (kind === 'file') {
          const out = [];
          api.vfs.walk(api.vfs.HOME, (n, path) => {
            if (n.type === 'file' && out.length < 30 && (!low || n.name.toLowerCase().includes(low))) out.push({ id: path, title: n.name, sub: path, n });
          });
          return out;
        }
        if (kind === 'game') {
          const G = await import('../portal/games.data.js'); await G.load();
          return G.query({ q, sort: 'popular', perPage: 20 }).items.map(g => ({ id: g.id, title: g.title, sub: g.studio || '' }));
        }
        if (kind === 'anime') {
          const A = await import('../portal/anime.data.js'); await A.load('anime');
          return A.query({ kind: 'anime', q, perPage: 20 }).items.map(a => ({ id: a.id, title: a.title, sub: a.mediaType || '' }));
        }
        const R = await import('../portal/roblox.data.js'); await R.load();
        return R.query({ q, perPage: 20 }).items.map(r => ({ id: r.id, title: r.name, sub: r.creator || '' }));
      } catch (e) { return []; }
    }
    async function pickDone(kind, r) {
      closePop();
      if (!S.channelId) return;
      if (kind === 'file') {
        await send(S.channelId, { kind: 'file', file: { n: r.title, z: r.n?.size ? Number(r.n.size) : api.vfs.size(r.n) || 0, path: r.id } });
        return;
      }
      await send(S.channelId, { kind: 'card', card: { k: kind, i: String(r.id), ti: r.title } });
    }

    /* /play: what is playing in an open Static Games window, or a game by name */
    async function playCommand(arg) {
      const channelId = S.channelId;
      let card = null;
      if (arg) {
        const rows = await findRows('game', arg);
        if (rows[0]) card = { k: 'game', i: String(rows[0].id), ti: rows[0].title };
      } else {
        try {
          for (const w of api.wm.stacked()) {
            const p = w.appId === 'aether-games' && !w.min && w.state && w.state.playing;
            if (p && p.id) { card = { k: 'game', i: String(p.id), ti: String(p.title || p.id) }; break; }
          }
        } catch (e) { /* no windows */ }
      }
      if (!card) {
        flash(arg ? `No game called “${clip(arg, 30)}” in Static Games.` : 'Nothing is playing in an open Static Games window. Try /play and a game name.');
        return;
      }
      await send(channelId, { kind: 'card', card });
    }

    /* ---------------- shared spaces ---------------- */
    const inviteLink = code => { try { return `${location.origin}${location.pathname}#chat=${code}`; } catch (e) { return ''; } };
    function copyInvite(code) {
      copyText(`Chat with me in Static Chat: code ${code} · ${inviteLink(code)}`);
      flash('Invite copied. Anyone with the code can knock; only the first person is let in.');
    }
    const WHY = {
      invalid: 'That is not a code. It is 6 letters and numbers, like K7QM2X.',
      nobody: 'Nobody answered that code. Check it, and that your friend has the space open.',
      full: 'That space already has two people.',
      insecure: 'Shared spaces need a secure (https) page.',
      many: 'You have as many shared spaces as fit. Delete one first.',
    };
    function spacePop(prefill = '') {
      const name = h('input', { type: 'text', maxlength: '24', placeholder: 'Name (optional)', 'aria-label': 'Name for the shared space', 'data-f': 'space-name' });
      const code = h('input', { type: 'text', maxlength: '80', placeholder: 'Code or invite link', value: prefill, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Code to join', 'data-f': 'space-code' });
      const status = h('small.dim', { role: 'status', 'data-f': 'space-status' });
      const create = () => {
        const r = createSpace(name.value);
        if (!r.ok) { status.textContent = WHY[r.error] || 'Could not start it.'; return; }
        closePop();
        goSpace(r.id);
      };
      const join = () => {
        const r = joinSpace(code.value, name.value);
        if (!r.ok) { status.textContent = WHY[r.error] || 'Could not join.'; return; }
        closePop();
        goSpace(r.id);
      };
      code.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); join(); } });
      return h('div.ch-pop__in', { 'data-pop-body': 'space' },
        h('b', { text: 'Shared space' }),
        h('small.dim', { text: 'A private room for two, opened by a code like Notes’ Write Together. Messages are kept on each device, never on a server. Treat the code like a password.' }),
        name,
        h('div.row', { style: { gap: 'var(--sp-3)' } },
          h('button.btn.btn--primary', { type: 'button', 'data-act': 'space-create', onclick: create }, icon('plus'), 'Start one and get a code')),
        h('div.ch-pop__or', { text: 'or join a friend’s' }),
        h('div.row', { style: { gap: 'var(--sp-3)' } }, code,
          h('button.btn', { type: 'button', 'data-act': 'space-join', onclick: join }, 'Join')),
        status);
    }
    async function goSpace(id) {
      await refreshCounts();
      S.spaces = await listSpaces();
      paintSpaces();
      await openSpace(id);
    }
    function spaceMenu(x, y, id) {
      const info = spaceInfo(id);
      if (!info) return;
      api.menu([
        info.connected || info.phase !== 'off'
          ? { label: 'Disconnect (keep messages here)', icon: 'x', onClick: () => disconnectSpace(id) }
          : { label: 'Connect', icon: 'link', onClick: () => connectSpace(id) },
        { label: 'Copy code and invite', icon: 'copy', onClick: () => copyInvite(info.code) },
        '-',
        { label: 'Delete this space…', icon: 'trash', danger: true, onClick: async () => {
          const ok = await api.confirm({ title: 'Delete this shared space?', message: 'The messages saved on this device go too. Your friend keeps their own copy.', ok: 'Delete', cancel: 'Keep' });
          if (ok && S.alive) deleteSpace(id);
        } },
      ], x, y);
    }

    /* ---------------- voice messages ---------------- */
    /* Recorded on this device, after a click, with the microphone only while recording. Capped at 30 s and
       about 120 KB; listened to before it is sent; sent through the shared space and kept nowhere else. */
    async function startVoice() {
      if (S.rec) return;
      const c = currentChannel();
      if (!c || kindOfChannel(c.id) !== 'room' || !channelLive(c.id)) {
        flash('Voice messages go through a connected shared space. Start one with the link button, then try again.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { flash('This browser cannot record audio.'); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { flash('The microphone is blocked or missing. Nothing was recorded.'); return; }
      if (!S.alive) { stream.getTracks().forEach(t => t.stop()); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
      let rec;
      try { rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: W.VOICE.BITS }); } catch (e) {
        stream.getTracks().forEach(t => t.stop());
        flash('This browser cannot record audio.');
        return;
      }
      const R = S.rec = { rec, stream, chunks: [], t0: performance.now(), ms: 0, blob: null, channelId: c.id, tick: 0, phase: 'recording' };
      rec.ondataavailable = ev => { if (ev.data && ev.data.size) R.chunks.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(R.tick);
        if (S.rec !== R) return;
        R.ms = Math.min(performance.now() - R.t0, W.VOICE.MAX_MS);
        R.blob = new Blob(R.chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
        R.phase = 'ready';
        paintRec();
      };
      rec.start(250);
      R.tick = setInterval(() => {
        if (S.rec !== R || R.phase !== 'recording') return;
        if (performance.now() - R.t0 >= W.VOICE.MAX_MS) stopRec();
        else paintRec();
      }, 250);
      paintRec();
    }
    function stopRec() { const R = S.rec; if (R && R.phase === 'recording' && R.rec.state !== 'inactive') R.rec.stop(); }
    function dropRec() {
      const R = S.rec;
      if (!R) return;
      S.rec = null;
      clearInterval(R.tick);
      try { if (R.rec.state !== 'inactive') { R.rec.onstop = null; R.rec.stop(); } } catch (e) { /* stopped */ }
      R.stream.getTracks().forEach(t => t.stop());
      if (R.url) URL.revokeObjectURL(R.url);
      paintRec();
    }
    async function sendRec() {
      const R = S.rec;
      if (!R || R.phase !== 'ready') return;
      R.phase = 'sending';
      paintRec();
      const r = await sendVoice(R.channelId, R.blob, R.ms);
      if (!S.alive) return;
      if (r.ok) dropRec();
      else {
        R.phase = 'ready';
        paintRec();
        flash({ room: 'The shared space is not connected, so nothing was sent.', long: 'That recording is too long.', big: 'That recording is too big to send.', mime: 'This browser makes a sound format that cannot be sent.', send: 'The connection dropped while sending. Try again.' }[r.error] || 'Could not send it.');
      }
    }
    function paintRec() {
      const R = S.rec;
      recEl.classList.toggle('hidden', !R);
      boxEl.classList.toggle('hidden', !!R);
      if (!R) { api.clear(recEl); return; }
      const secs = Math.round(((R.phase === 'recording' ? performance.now() - R.t0 : R.ms)) / 1000);
      if (R.phase === 'recording') {
        api.render(recEl, h('span.ch-rec__dot', { 'aria-hidden': 'true' }), h('b', { text: 'Recording' }),
          h('span.ch-rec__t', { text: `${fmt.fmtDur(secs)} of ${fmt.fmtDur(W.VOICE.MAX_MS / 1000)}` }), h('div.grow'),
          h('button.btn.btn--sm', { type: 'button', 'data-act': 'rec-cancel', onclick: dropRec }, 'Cancel'),
          h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-act': 'rec-stop', onclick: stopRec }, icon('square'), 'Stop'));
      } else {
        R.url ||= URL.createObjectURL(R.blob);
        api.render(recEl, h('audio', { controls: true, src: R.url, 'aria-label': 'Your recording' }),
          h('span.ch-rec__t', { text: fmt.fmtDur(secs) }), h('div.grow'),
          h('button.btn.btn--sm', { type: 'button', 'data-act': 'rec-discard', onclick: dropRec }, 'Discard'),
          h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-act': 'rec-send', disabled: R.phase === 'sending', onclick: sendRec }, icon('send'), 'Send'));
      }
    }

    /* ---------------- navigation ------------ */
    async function refreshCounts() {
      if (!S.alive || !S.spaceId) return;
      const [spaces, channels] = await Promise.all([listSpaces(), listChannels(S.spaceId)]);
      if (!S.alive) return;
      S.spaces = spaces;
      S.channels = channels;
      paintSpaces();
      paintChans();
    }

    async function loadPeople() {
      S.people = await members(S.spaceId);
      if (S.alive) paintRail();
    }

    async function openSpace(id) {
      if (!S.alive) return;
      const sp = S.spaces.find(s => s.id === id);
      /* choosing a shared space connects it: that click is the person's, and the room is closed if it fails */
      if (sp && sp.shared && !spaceInfo(id)?.connected && spaceInfo(id)?.phase === 'off') connectSpace(id);
      S.spaceId = id;
      S.channels = await listChannels(id);
      if (!S.alive) return;
      await loadPeople();
      paintSpaces();
      paintChans();
      const first = S.channels[0];
      if (first) await openChannel(first.id);
      else { S.channelId = null; S.msgs = []; setViewing(null); win.setTitle(`${BRAND.name} Chat`); win.setSubtitle(sp ? sp.name : ''); paintTopic(); paintLog(); composerFor(null); }
    }

    function composerFor(c) {
      const external = !!currentSpace()?.external;
      const none = !c && !external;
      composer.hidden = external || none;
      log.classList.toggle('is-external', external);
      ta.disabled = external || none;
      ta.placeholder = external ? 'Type inside the Discord view above' : (c ? `Message ${c.kind === 'dm' ? '@' : '#'}${c.name}` : 'Message');
      for (const b of [btnMic]) b.classList.toggle('is-off', !(c && kindOfChannel(c.id) === 'room' && channelLive(c.id)));
      btnMic.title = btnMic.getAttribute('aria-label');
    }

    async function openChannel(id) {
      if (!S.alive || !id) return;
      if (S.search) closeSearch();
      closePop(); hideMentions();
      stopTyping();
      for (const t of S.typing.values()) clearTimeout(t);
      S.typing.clear();
      paintTyping();

      S.channelId = id;
      S.reply = null;
      paintReply();

      S.msgs = await listMessages(id);
      if (!S.alive) return;
      /* what was unread when you got here, before reading it marks it read */
      S.newFrom = readAt(id);
      markRead(id);
      setViewing(id);

      const c = currentChannel();
      win.setTitle(c ? `${c.kind === 'dm' ? '@' : '#'}${c.name}` : `${BRAND.name} Chat`);
      win.setSubtitle(currentSpace() ? currentSpace().name : '');
      ta.value = draft.get(id);
      autoGrow();
      sendBtn.disabled = !ta.value.trim();

      paintLog();
      paintTopic();
      composerFor(c);
      if (c && currentSpace()?.external) sendBtn.disabled = true;
      if (!currentSpace()?.external) scrollEnd();
      store.set('prefs.chatLast', { spaceId: S.spaceId, channelId: id });
      await refreshCounts();
    }

    /* ---------------- transport events ------ */
    /* Notifications for what other people send are the transport's (it also
       runs with this window closed); here we only draw. */
    function onMessage(m) {
      if (m.channelId !== S.channelId) { refreshCounts(); return; }
      if (S.typing.has(m.author)) {
        clearTimeout(S.typing.get(m.author));
        S.typing.delete(m.author);
        paintTyping();
      }
      if (!S.msgs.some(x => x.id === m.id)) S.msgs.push(m);
      if (!S.search) {
        const stick = nearBottom();
        if (log.querySelector('.empty')) { api.clear(log); resetRun(); }
        addRow(m);
        if (stick || m.author === ME.id) scrollEnd();
      }
      markRead(S.channelId);
      paintPins();
      refreshCounts();
    }

    function onTyping({ channelId, who, on }) {
      if (channelId !== S.channelId || who === ME.id) return;
      const prev = S.typing.get(who);
      if (prev) clearTimeout(prev);
      if (!on) S.typing.delete(who);
      else S.typing.set(who, setTimeout(() => {
        S.typing.delete(who);
        paintTyping();
      }, TYPE_STALE));
      paintTyping();
    }

    function onChanged(m) {
      if (!m || m.channelId !== S.channelId) return;
      const i = S.msgs.findIndex(x => x.id === m.id);
      if (i > -1) S.msgs[i] = m;
      if (!S.search) replaceRow(m);
      paintPins();
    }

    function onRemoved(id) {
      const i = S.msgs.findIndex(x => x.id === id);
      if (i < 0) return;
      S.msgs.splice(i, 1);
      if (S.reply && S.reply.id === id) clearReply();
      if (!S.search) paintLog({ keep: true });
      refreshCounts();
    }

    /* a shared space connected, was left or failed; friends coming and going */
    async function onSpace(ev) {
      const said = ev.error ? (WHY[ev.error] || `The space closed (${ev.error}).`) : '';
      await refreshCounts();
      if (!S.alive) return;
      if (ev.spaceId && ev.spaceId === S.spaceId && !S.spaces.some(s => s.id === ev.spaceId)) {
        const first = S.spaces[0];
        if (first) await openSpace(first.id);
        if (said && S.alive) flash(said);
        return;
      }
      if (said) flash(said);
      await loadPeople();
      if (S.alive) { paintTopic(); composerFor(currentChannel()); }
    }
    async function onPresence() {
      if (S.spaceId === 'dm') await refreshCounts();
      await loadPeople();
      if (S.alive) { paintTopic(); composerFor(currentChannel()); }
    }

    const offSub = subscribe(ev => {
      if (!S.alive) return;
      if (ev.type === 'message') onMessage(ev.message);
      else if (ev.type === 'typing') onTyping(ev);
      else if (ev.type === 'react' || ev.type === 'edit') onChanged(ev.message);
      else if (ev.type === 'remove') onRemoved(ev.id);
      else if (ev.type === 'space') onSpace(ev);
      else if (ev.type === 'presence') onPresence();
      else if (ev.type === 'read' && S.spaces.length) refreshCounts();
    });

    /* ---------------- keyboard -------------- */
    const offKey = api.on(window, 'keydown', e => {
      if (!S.alive || !win.el.classList.contains('is-active')) return;
      const k = (e.key || '').toLowerCase();
      /* NOT mod+K: spotlight.js binds that capture-phase on window at boot, so
         it always wins and we would only steal focus out of its open field. */
      if (k === 'j' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ta.focus(); return; }
      if (k === 'f' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); S.search ? searchIn.focus() : openSearch(); return; }
      if (e.key === 'Escape') {
        if (S.pop) { closePop(); e.preventDefault(); }
        else if (S.search) { closeSearch(); ta.focus(); e.preventDefault(); }
        else if (S.reply) { clearReply(); e.preventDefault(); }
      }
    });

    win.onReopen(o => {
      if (o && o.channelId) {
        if (o.spaceId && o.spaceId !== S.spaceId) openSpace(o.spaceId).then(() => openChannel(o.channelId));
        else openChannel(o.channelId);
      }
      if (o && o.join) togglePop('space', () => spacePop(String(o.join)), true);
    });

    /* ---------------- boot ------------------ */
    (async function boot() {
      S.people = await members();
      if (!S.alive) return;
      paintRail();

      if (store.get('prefs.chatRail', true) === false) toggleRail();
      /* on a phone the people list is a drawer over the conversation
         (css/feat-mobile.css): start it closed, without touching the
         desktop preference */
      else if (document.body.classList.contains('is-mobile')) {
        S.rail = false;
        rail.classList.add('is-folded');
        btnRail.classList.remove('is-on');
        btnRail.setAttribute('aria-pressed', 'false');
      }

      S.spaces = await listSpaces();
      if (!S.alive || !S.spaces.length) return;
      paintSpaces();

      const want = opts && opts.channelId
        ? { spaceId: opts.spaceId, channelId: opts.channelId }
        : store.get('prefs.chatLast', null);
      const space = (want && S.spaces.find(s => s.id === want.spaceId)) || S.spaces[0];

      S.spaceId = space.id;
      S.channels = await listChannels(space.id);
      if (!S.alive) return;
      await loadPeople();
      paintSpaces();
      const chan = (want && S.channels.find(c => c.id === want.channelId)) || S.channels[0];
      if (chan) await openChannel(chan.id);
      else { paintChans(); paintTopic(); paintLog(); composerFor(null); }
      /* an invite link only fills the code in; joining is the person's click */
      if (opts && opts.join) togglePop('space', () => spacePop(String(opts.join)), true);
    })();

    /* ---------------- teardown -------------- */
    return () => {
      S.alive = false;
      offSub();
      offKey();
      offDown();
      dropRec();                                 // the microphone is never left on
      setViewing(null);
      quiet();                                   // stop the simulated room talking
      stopTyping();
      clearTimeout(S.typeTimer);
      clearTimeout(flash.t);
      for (const t of S.typing.values()) clearTimeout(t);
      S.typing.clear();
    };
  },
});
