/* ============================================================
   Static Chat — deliberately not the three-column norm.

   Spaces and channels live in one strip across the TOP, the
   conversation gets the whole width underneath it, and presence
   is an ambient rail that folds away.

   Every byte of data comes from js/portal/chat.transport.js —
   the only module that knows whether the room is a local store
   or a socket. This file never touches storage.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { BRAND } from '../portal/brand.js';
import {
  ME, personById, subscribe, listSpaces, listChannels, listMessages,
  send, react, edit, remove, members, markRead, draft, setTyping, quiet,
} from '../portal/chat.transport.js';
import { buildDiscordPanel } from '../portal/discord.panel.js';

const EMOJI      = ['👍', '🔥', '😂', '❤️', '👀'];
const RUN_MS     = 5 * 60 * 1000;   // one author inside this window = one run
const STICK      = 80;              // px from the bottom that still counts as "at the bottom"
const TYPE_OFF   = 1200;            // idle before we stop telling the room we type
const TYPE_STALE = 7000;            // drop a stale typist if their "off" never lands
const MAX_ROWS   = 132;             // matches .ch__box textarea max-height

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));

/* A blocked clipboard throws on access AND rejects the promise — swallow both
   so "Copy text" can never raise an unhandled rejection. */
const copyText = t => {
  try { navigator.clipboard?.writeText(String(t))?.catch(() => {}); } catch (e) { /* no clipboard */ }
};

defineApp({
  id: 'chat',
  name: `${BRAND.name} Chat`,            // one constant owns the product name
  icon: 'message-circle',
  g1: '#3fcf72', g2: '#097a3a',
  category: 'Internet',
  keywords: ['chat', 'messages', 'rooms', 'spaces', 'channels', 'dm', 'talk'],
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
    };

    /* ---------------- people --------------- */
    const person = id => personById(id) || { id, name: id, initials: '?', hue: 0, role: '' };
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

    const strip = h('div.ch__strip', spacesEl, chansEl, searchBox, btnSearch, btnRail);

    const topic = h('div.ch__topic');
    const log   = h('div.ch__log', { tabindex: '0', role: 'log', 'aria-label': 'Conversation' });
    const rail  = h('aside.ch__rail', { 'aria-label': 'People' });
    const bodyEl  = h('div.ch__body', log, rail);
    const typingEl = h('div.ch__typing', { 'aria-live': 'polite' });

    const replyBar = h('div.ch__replying.hidden');
    const ta = h('textarea', {
      rows: '1', placeholder: 'Message', 'aria-label': 'Message',
      oninput: onCompose, onkeydown: onComposeKey,
    });
    const sendBtn = h('button.ch__send', {
      disabled: true, 'aria-label': 'Send message', onclick: submit,
    }, icon('arrow-up'));
    const composer = h('div.ch__composer', replyBar, h('div.ch__box', ta, sendBtn));

    root.appendChild(h('div.app', h('div.ch', strip, topic, bodyEl, typingEl, composer)));

    /* ---------------- inline markup --------- *
     * **bold** and `code`, built as nodes. User text never
     * reaches innerHTML.                                    */
    function markup(text) {
      const out = [];
      const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
        out.push(m[1] != null ? h('b', { text: m[1] }) : h('code', { text: m[2] }));
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
        class: [mine ? 'is-mine' : '', run ? 'is-run' : ''].filter(Boolean).join(' ') || null,
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
        p.role && h('span.ch-msg__role', { text: p.role }),
        h('span.ch-msg__at', { text: timeLabel(m.at) })));

      bodyBox.appendChild(h('div.ch-msg__t',
        ...markup(m.body),
        m.edited && h('span.ch-msg__edited', { text: '(edited)' })));

      const reacts = reactRow(m);
      if (reacts) bodyBox.appendChild(reacts);

      el.append(avatar(p), bodyBox, actsRow(m));
      return el;
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
      const act = (kids, label, fn) => h('button.ibtn', {
        tabindex: '-1', title: label, 'aria-label': label, onclick: fn,
      }, kids);
      return h('div.ch-msg__acts',
        ...EMOJI.map(e => act(h('span', { text: e }), `React ${e}`, () => react(m.id, e))),
        act(icon('corner-up-left'), 'Reply', () => startReply(m)),
        mine && act(icon('edit-3'), 'Edit', () => startEdit(m)),
        mine && act(icon('trash'), 'Delete', () => askRemove(m)));
    }

    function msgMenu(e, m) {
      e.preventDefault(); e.stopPropagation();
      const mine = m.author === ME.id;
      api.menu([
        { label: 'Reply', icon: 'corner-up-left', onClick: () => startReply(m) },
        ...EMOJI.map(x => ({ label: `React ${x}`, icon: 'heart', onClick: () => react(m.id, x) })),
        '-',
        { label: 'Copy text', icon: 'copy', onClick: () => copyText(m.body) },
        mine && { label: 'Edit…', icon: 'edit-3', onClick: () => startEdit(m) },
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

    function resetRun() { S.lastDay = ''; S.lastAuthor = null; S.lastAt = 0; }

    function addRow(m) {
      const key = dayKey(m.at);
      if (key !== S.lastDay) {
        log.appendChild(h('div.ch-day', h('span', { text: dayLabel(m.at) })));
        S.lastDay = key;
        S.lastAuthor = null;
      }
      const run = m.author === S.lastAuthor && (m.at - S.lastAt) < RUN_MS && !m.replyTo;
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
      if (!S.msgs.length) {
        log.appendChild(h('div.empty', { style: { margin: 'auto', height: 'auto' } },
          icon('message-circle'),
          h('b', { text: 'No messages yet' }),
          h('small', { text: c ? `Nothing has been said in #${c.name}. Say the first thing.` : 'Pick a channel from the strip above.' })));
        return;
      }
      for (const m of S.msgs) addRow(m);
      if (keep) log.scrollTop = at; else scrollEnd();
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
      if (row) row.scrollIntoView({ block: 'center' });
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
          'aria-label': `${s.name}${s.unread ? ` — ${s.unread} unread` : ''}`,
          'aria-pressed': s.id === S.spaceId ? 'true' : 'false',
          onclick: () => openSpace(s.id),
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
          class: [on ? 'is-on' : '', !on && c.unread > 0 ? 'has-unread' : ''].filter(Boolean).join(' ') || null,
          title: c.topic || '',
          role: 'tab', 'aria-selected': on ? 'true' : 'false',
          'aria-label': `#${c.name}${!on && c.unread ? ` — ${c.unread} unread` : ''}`,
          onclick: () => openChannel(c.id),
        }, h('span.dim', { text: '#' }), h('span', { text: c.name })));
      }
    }

    function paintTopic() {
      const c = currentChannel();
      const online = S.people.filter(p => statusOf(p) !== 'offline').length;
      api.render(topic,
        h('b', { text: c ? `#${c.name}` : 'No channel' }),
        h('span.trunc', { text: c ? (c.topic || 'No topic set') : '' }),
        h('div.grow'),
        c && c.muted && h('span.chip', icon('bell-off'), h('span', { text: 'Muted' })),
        S.people.length > 1
          ? h('span.chip', icon('users'), h('span', { text: `${online} of ${S.people.length} online` }))
          : h('span.chip', { title: 'StaticOS has no chat server: these rooms keep your messages on this device. The Discord space is live.' },
            icon('user'), h('span', { text: 'Just you · on this device' })));
    }

    /* ---------------- presence rail --------- */
    function paintRail() {
      const on  = S.people.filter(p => statusOf(p) !== 'offline');
      const off = S.people.filter(p => statusOf(p) === 'offline');
      api.render(rail,
        group(S.people.length > 1 ? 'Online' : 'On this device', on, false),
        off.length ? group('Offline', off, true) : null,
        S.people.length > 1 ? null : h('p.ch-rail__note', { text: 'No one else is in these rooms — StaticOS has no chat server, so messages stay on this device. The Discord space shows real people.' }));
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
    }

    function onComposeKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    }

    async function submit() {
      const text = ta.value.trim();
      if (!text || !S.channelId) return;
      const replyTo = S.reply ? S.reply.id : null;
      const channelId = S.channelId;
      ta.value = '';
      autoGrow();
      sendBtn.disabled = true;
      draft.set(channelId, '');
      stopTyping();
      clearReply();
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

    async function openSpace(id) {
      if (!S.alive) return;
      S.spaceId = id;
      S.channels = await listChannels(id);
      if (!S.alive) return;
      paintSpaces();
      paintChans();
      const first = S.channels[0];
      if (first) await openChannel(first.id);
      else { S.channelId = null; S.msgs = []; paintTopic(); paintLog(); }
    }

    async function openChannel(id) {
      if (!S.alive || !id) return;
      if (S.search) closeSearch();
      stopTyping();
      for (const t of S.typing.values()) clearTimeout(t);
      S.typing.clear();
      paintTyping();

      S.channelId = id;
      S.reply = null;
      paintReply();

      S.msgs = await listMessages(id);
      if (!S.alive) return;
      markRead(id);

      const c = currentChannel();
      win.setTitle(c ? `#${c.name}` : `${BRAND.name} Chat`);
      win.setSubtitle(currentSpace() ? currentSpace().name : '');
      ta.placeholder = c ? `Message #${c.name}` : 'Message';
      ta.value = draft.get(id);
      autoGrow();
      sendBtn.disabled = !ta.value.trim();

      paintTopic();
      paintLog();
      const external = !!currentSpace()?.external;
      /* the Discord view has its own message box inside it */
      composer.hidden = external;
      log.classList.toggle('is-external', external);
      ta.disabled = external;
      ta.placeholder = external ? 'Type inside the Discord view above' : ta.placeholder;
      if (external) sendBtn.disabled = true;
      if (!external) scrollEnd();
      store.set('prefs.chatLast', { spaceId: S.spaceId, channelId: id });
      await refreshCounts();
    }

    /* ---------------- transport events ------ */
    function onMessage(m) {
      if (m.channelId !== S.channelId) {
        const c = S.channels.find(x => x.id === m.channelId);
        if (m.author !== ME.id && !(c && c.muted)) {
          api.notify({
            app: `${BRAND.name} Chat`, icon: 'message-circle',
            title: `#${channelName(m.channelId)} · ${person(m.author).name}`,
            message: clip(m.body, 90),
          });
        }
        refreshCounts();
        return;
      }
      if (S.typing.has(m.author)) {
        clearTimeout(S.typing.get(m.author));
        S.typing.delete(m.author);
        paintTyping();
      }
      S.msgs.push(m);
      if (!S.search) {
        const stick = nearBottom();
        if (log.querySelector('.empty')) { api.clear(log); resetRun(); }
        addRow(m);
        if (stick || m.author === ME.id) scrollEnd();
      }
      markRead(S.channelId);
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
    }

    function onRemoved(id) {
      const i = S.msgs.findIndex(x => x.id === id);
      if (i < 0) return;
      S.msgs.splice(i, 1);
      if (S.reply && S.reply.id === id) clearReply();
      if (!S.search) paintLog({ keep: true });
      refreshCounts();
    }

    const offSub = subscribe(ev => {
      if (!S.alive) return;
      if (ev.type === 'message') onMessage(ev.message);
      else if (ev.type === 'typing') onTyping(ev);
      else if (ev.type === 'react' || ev.type === 'edit') onChanged(ev.message);
      else if (ev.type === 'remove') onRemoved(ev.id);
      else if (ev.type === 'presence') { members().then(p => { if (S.alive) { S.people = p; paintRail(); paintTopic(); } }); }
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
        if (S.search) { closeSearch(); ta.focus(); e.preventDefault(); }
        else if (S.reply) { clearReply(); e.preventDefault(); }
      }
    });

    win.onReopen(o => { if (o && o.channelId) openChannel(o.channelId); });

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
      paintSpaces();
      const chan = (want && S.channels.find(c => c.id === want.channelId)) || S.channels[0];
      if (chan) await openChannel(chan.id);
      else { paintChans(); paintTopic(); paintLog(); }
    })();

    /* ---------------- teardown -------------- */
    return () => {
      S.alive = false;
      offSub();
      offKey();
      quiet();                                   // stop the simulated room talking
      stopTyping();
      clearTimeout(S.typeTimer);
      for (const t of S.typing.values()) clearTimeout(t);
      S.typing.clear();
    };
  },
});
