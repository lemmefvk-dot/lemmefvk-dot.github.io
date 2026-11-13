/* ============================================================
   social-friends.js — Static Social › Friends (#144, #145, #149).

   The face of js/core/friends.js, which does the work and keeps
   running with Social closed. One scrolling column:

     You          your picture, name, online/away, your status and
                  its editor (presets, an emoji, text, when it ends),
                  and exactly what your friends see — including the
                  "Show the game I'm playing" switch (off by default)
     Requests     name + picture, Accept / Decline / Block
     Friends      online / away / offline from real heartbeats, "last
                  seen" only from a heartbeat that arrived, status,
                  game (if they share it), nickname, remove, block
     Game nights  plan one (game, time, friends), RSVP, reminders,
                  Join from 10 minutes before the start
     Add a friend your code (copy, invite link, new code), a box for
                  a friend's code, and the requests you sent
     How it works privacy, the two web addresses, what isn't shown

   friendsView({ api, onCount }) -> { el, show(opts), hide(), destroy() }
     opts: { friend: CODE } (an invite link — fills the box, sends
     nothing) · { night: id } (scrolls to that game night)
     onCount({ requests, online }) feeds Social's rail badge.

   Everything from other people is shown with textContent; pictures
   are data: images core/avatar.js already checked.
   ============================================================ */
import * as F from '../core/friends.js';
import * as Avatar from '../core/avatar.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import * as plays from '../core/plays.js';
import { hasIcon } from '../core/icons.js';
import { bus } from '../core/bus.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-friends-css')) {
  const l = document.createElement('link');
  l.id = 'feat-friends-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-friends.css';
  document.head.appendChild(l);
}

const LENGTHS = [30, 60, 90, 120, 180];
const LENGTH_TEXT = { 30: '30 min', 60: '1 hour', 90: '1½ hours', 120: '2 hours', 180: '3 hours' };
const PRESENCE = { online: 'Online', away: 'Away', busy: 'Busy' };
const LIVE_TEXT = { idle: 'Not connected yet', connecting: 'Connecting…', live: 'Live', offline: 'Offline — this network may block the live channel' };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function friendsView({ api, onCount = () => {} }) {
  const { h, icon, clear, store, fmt } = api;
  const ic = n => icon(hasIcon(n) ? n : 'circle');
  const body = h('div.fr__body', { tabindex: '-1' });
  const sr = h('div.sr', { role: 'status', 'aria-live': 'polite' });
  const el = h('div.fr', { 'aria-label': 'Friends' }, body, sr);

  const S = {
    dead: false, shown: false, pending: false,
    add: '', addNote: null,
    statusOpen: false, st: null,
    nick: null,
    nightOpen: false, night: null, nightNote: null,
    focusNight: null, flash: null, lastCount: '',
  };
  const say = t => { sr.textContent = ''; setTimeout(() => { if (!S.dead) sr.textContent = t; }, 40); };
  const h24 = () => !!store.get('prefs.h24');
  const clock = at => { const c = fmt.fmtClock(new Date(at), h24()); return h24() ? c.time : `${c.time} ${c.ap}`; };
  const ago = at => fmt.fmtAgo(new Date(at).toISOString());
  function until(at) {
    const m = Math.max(0, Math.round((at - Date.now()) / 60_000));
    if (m < 1) return 'less than a minute';
    if (m < 60) return `${m} min`;
    const hrs = Math.round(m / 60);
    if (hrs < 36) return `${hrs} h`;
    return `${Math.round(hrs / 24)} days`;
  }
  const initial = name => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();
  const av = (x, size) => Avatar.avatarEl(h, { picture: x.picture || null, costume: x.costume || 'none', initial: initial(x.display || x.name), size });
  const btn = (label, ig, onclick, o = {}) => h(`button.btn.btn--sm${o.primary ? '.btn--primary' : ''}${o.ghost ? '.btn--ghost' : ''}${o.danger ? '.btn--danger' : ''}`, {
    type: o.type || 'button', disabled: !!o.disabled, title: o.tip || null, 'aria-label': o.aria || null,
    'aria-pressed': o.pressed === undefined ? null : String(!!o.pressed),
    dataset: { ...(o.fk ? { fk: o.fk } : {}), ...(o.act ? { act: o.act } : {}), ...(o.data || {}) },
    onclick: o.type === 'submit' ? null : e => { e.stopPropagation(); onclick(e); },
  }, ig ? ic(ig) : null, label ? h('span', { text: label }) : null);
  const sw = (on, label, onclick, fk) => h(`button.switch${on ? '.is-on' : ''}`, {
    type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, dataset: { fk }, onclick,
  });
  const sec = (title, ...kids) => h('section.fr-sec', { 'aria-label': title }, ...kids);
  const head = (title, ...acts) => h('div.fr-h', h('h3', { text: title }), h('div.grow'), ...acts);
  const fine = t => h('p.fr-fine', { text: t });
  const noteEl = n => (n ? h('p.fr-note', { class: n.err ? 'is-err' : null, role: n.err ? 'alert' : 'status', text: n.text }) : null);
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); api.notify({ app: 'social', icon: 'copy', title: `${what} copied`, message: 'Send it only to people you want as friends.', timeout: 4000 }); say(`${what} copied`); }
    catch (e) { api.notify({ app: 'social', icon: 'info', title: 'Copying was blocked here', message: text, timeout: 8000 }); }
  }

  /* ---------------- focus survives a repaint ----------------
     A heartbeat repaints this column, so a keyboard user's place is kept by
     what it IS — a field, or a row (by friend, night or code) and the action
     in it. Every value in these selectors is hex, an id or a code checked in
     core/friends.js, never free text. */
  function focusKey(el) {
    if (el.dataset.fk) return `[data-fk="${el.dataset.fk}"]`;
    const row = el.closest('[data-fp],[data-id],[data-code]');
    if (!row || !body.contains(row)) return null;
    const at = row.dataset.fp ? `[data-fp="${row.dataset.fp}"]` : row.dataset.id ? `[data-id="${row.dataset.id}"]` : `[data-code="${row.dataset.code}"]`;
    if (el === row) return at;
    const own = el.dataset.act ? `[data-act="${el.dataset.act}"]` : el.dataset.answer ? `[data-answer="${el.dataset.answer}"]` : null;
    return own ? `${at} ${own}` : at;
  }
  function grab() {
    const a = document.activeElement;
    if (!a || a === body || !body.contains(a)) return null;
    let s = null, e = null;
    try { s = a.selectionStart; e = a.selectionEnd; } catch (err) { /* not a text field */ }
    return { key: focusKey(a), s, e };
  }
  function regain(g) {
    if (!g) return;
    const t = g.key ? body.querySelector(g.key) : null;
    /* the thing itself went (a request answered): stay in this column */
    if (!t) { body.focus({ preventScroll: true }); return; }
    t.focus({ preventScroll: true });
    if (g.s !== null && g.s !== undefined) { try { t.setSelectionRange(g.s, g.e); } catch (err) { /* fine */ } }
  }

  /* ---------------- paint ----------------
     The column is made of slots, each repainted only when what it shows has
     changed. A friend's heartbeat touches the friends list at most: an editor
     being typed in (and the emoji picker on it) stays exactly as it is.
       refresh()  what the core says changed (a heartbeat, the clock)
       paint()    this person just did something: redraw every slot */
  const slots = {};
  const slot = name => (slots[name] || (slots[name] = { el: h('div.fr-slot'), sig: null }));
  const J = v => JSON.stringify(v);
  const picSig = x => (!x ? '' : x.kind === 'upload' ? `u${x.dataUrl.length}:${x.dataUrl.slice(-32)}` : x.id);
  function fill(name, sig, build) {
    const one = slot(name);
    if (one.sig === sig) return;
    const a = document.activeElement;
    const inside = !!a && one.el.contains(a);
    if (inside && a.tagName === 'SELECT') { S.pending = true; return; }   /* an open list would snap shut */
    const g = inside ? grab() : null;
    one.sig = sig;
    clear(one.el);
    const node = build();
    if (node) one.el.append(node);
    regain(g);
  }
  function layOut() {
    if (S.laid) return;
    S.laid = true;
    clear(body);
    const at = name => slot(name).el;
    body.append(
      sec('You', at('meRow'), at('meEditor'), at('meSee')),
      at('requests'), at('addTop'), at('friends'),
      sec('Game nights', at('nightsHead'), at('nightsForm'), at('nightsList')),
      at('addEnd'), at('blocked'), at('about'));
  }
  function refresh() {
    if (S.dead || !S.shown) return;
    S.pending = false;
    if (!F.available()) {
      S.laid = false;
      Object.values(slots).forEach(one => { one.sig = null; });
      clear(body);
      body.append(sec('Friends', h('div.fr-empty', { dataset: { guest: '' } }, ic('users'), h('span', { text: 'Friends isn’t part of a guest session. It keeps a private key and a list of people for you, and a guest keeps nothing. Sign in to your own profile to use it.' }))));
      return;
    }
    if (F.failed() === 'insecure' || !F.secureOk()) {
      S.laid = false;
      Object.values(slots).forEach(one => { one.sig = null; });
      clear(body);
      body.append(sec('Friends', h('div.fr-empty', ic('lock'), h('span', { text: 'Friends needs a secure page (https) to encrypt what it sends. Open StaticOS from its https address.' }))));
      return;
    }
    layOut();
    const fr = F.friends();
    const inc = F.incoming();
    const see = F.whatFriendsSee();
    const ns = F.nights();
    const minute = Math.floor(Date.now() / 60_000);     /* "2 min ago" moves on */
    const seeSig = [see.name, see.state, see.status, see.game, see.shareGame];
    fill('meRow', J([seeSig, see.color, picSig(see.picture), see.costume, S.statusOpen, h24()]), () => meRow(see));
    fill('meEditor', J([S.statusOpen, !!F.myStatus()]), () => (S.statusOpen ? statusEditor() : null));
    fill('meSee', J(seeSig), () => seeBlock(see));
    fill('requests', J([inc.map(r => [r.fp, r.name, r.hue, picSig(r.picture), r.costume, r.code, r.at]), F.myCode(), inc.length ? minute : 0]), () => (inc.length ? requestsSection(inc) : null));
    const addSig = J([F.myCode(), F.outgoing(), S.addNote, F.outgoing().length ? minute : 0]);
    fill('addTop', fr.length ? 'off' : addSig, () => (fr.length ? null : addSection()));
    fill('addEnd', fr.length ? addSig : 'off', () => (fr.length ? addSection() : null));
    /* a nickname being typed keeps the list still until it's saved or cancelled */
    const frSig = S.nick ? (slot('friends').sig ?? 'nick') : J([fr.map(f => [f.fp, f.display, f.name, f.nick, picSig(f.picture), f.costume, f.presence, f.status, f.game, f.presence === 'offline' ? f.lastSeen : 0]), fr.some(f => f.presence === 'offline') ? minute : 0]);
    fill('friends', frSig, () => friendsSection(fr));
    fill('nightsHead', J([fr.length > 0, S.nightOpen]), () => nightsHead(fr));
    fill('nightsForm', J(S.nightOpen && fr.length ? [fr.map(f => [f.fp, f.display]), S.nightNote] : 'closed'), () => (S.nightOpen && fr.length ? nightForm(fr) : null));
    fill('nightsList', J([ns, fr.length > 0, ns.some(n => n.state !== 'over' && n.state !== 'cancelled') ? minute : 0]), () => nightsList(fr, ns));
    const bl = F.blocked();
    fill('blocked', J([bl, bl.length ? minute : 0]), () => blockedSection(bl));
    fill('about', J([F.liveStatus()]), () => aboutSection());
    if (S.focusNight) {
      const card = body.querySelector(`.fr-night[data-id="${S.focusNight}"]`);
      if (card) { card.scrollIntoView({ block: 'nearest' }); card.focus({ preventScroll: true }); }
      S.focusNight = null;
    }
    count(fr, inc);
  }
  function paint() {
    Object.values(slots).forEach(one => { one.sig = null; });
    const top = body.scrollTop;
    refresh();
    body.scrollTop = top;
  }
  function count(fr, inc) {
    const c = { requests: inc.length, online: fr.filter(f => f.presence !== 'offline').length };
    const sig = JSON.stringify(c);
    if (sig !== S.lastCount) { S.lastCount = sig; try { onCount(c); } catch (e) { /* Social gone */ } }
  }
  body.addEventListener('focusout', () => { if (S.pending) setTimeout(() => { if (S.pending) refresh(); }, 0); });

  /* ---------------- you + status (#145) ---------------- */
  function meRow(see) {
    const stText = see.state === 'invisible' ? 'Invisible — your friends see you as offline' : PRESENCE[see.state] || 'Online';
    const s = see.status;
    return h('div.fr-me',
        h('span.fr-avwrap', Avatar.avatarEl(h, { picture: see.picture, costume: see.costume, initial: initial(see.name), size: 44 }), h('i.fr-dot', { dataset: { st: see.state } })),
        h('div.fr-row__b',
          h('b', { text: see.name }),
          h('small', { text: stText }),
          h('span.fr-me__status', { dataset: { fk: 'my-status-line' }, text: s ? `${s.emoji ? `${s.emoji} ` : ''}${s.text}${s.until ? ` · until ${clock(s.until)}` : ''}` : 'No status set' })),
        btn(S.statusOpen ? 'Close' : 'Set status', S.statusOpen ? 'x' : 'edit-3', () => toggleStatus(), { fk: 'status-edit' }));
  }
  function toggleStatus(on = !S.statusOpen) {
    S.statusOpen = on;
    if (on) {
      const s = F.myStatus();
      S.st = { text: s ? s.text : '', emoji: s ? s.emoji : '', preset: s ? s.preset : null, expiry: s ? s.expiry : '1h' };
    }
    paint();
    if (on) requestAnimationFrame(() => body.querySelector('[data-fk="status-text"]')?.focus({ preventScroll: true }));
  }
  function statusEditor() {
    const st = S.st;
    const emoji = h('input.fr-emoji__in', {
      value: st.emoji, maxlength: '24', 'aria-label': 'Emoji (Ctrl+. for the picker)', dataset: { fk: 'status-emoji' }, autocomplete: 'off',
      oninput: e => { const v = F.lastEmoji(e.target.value); st.emoji = v; st.preset = null; if (e.target.value !== v) e.target.value = v; },
    });
    const text = h('input', {
      value: st.text, maxlength: String(F.STATUS_MAX), placeholder: 'What are you up to?', 'aria-label': 'Status', dataset: { fk: 'status-text' }, autocomplete: 'off',
      oninput: e => { st.text = e.target.value; st.preset = null; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveStatus(); } },
    });
    return h('div.fr-status', { role: 'group', 'aria-label': 'Set your status' },
      h('div.fr-chips', F.PRESETS.map(p => h('button.chip.fr-chip', {
        type: 'button', class: st.preset === p.id ? 'chip--accent' : null, 'aria-pressed': String(st.preset === p.id),
        dataset: { preset: p.id, fk: `preset-${p.id}` },
        onclick: () => { st.preset = p.id; st.text = p.text; st.emoji = p.emoji; paint(); },
      }, h('span', { text: p.emoji, 'aria-hidden': 'true' }), h('span', { text: p.text })))),
      h('div.fr-line',
        h('div.field.fr-emoji', emoji),
        h('button.ibtn', { type: 'button', title: 'Choose an emoji', 'aria-label': 'Choose an emoji', dataset: { fk: 'status-emoji-pick' }, onclick: () => { emoji.focus(); bus.emit('emoji:open', emoji); } }, ic('sparkles')),
        h('div.field.grow', text)),
      h('div.fr-line',
        h('label.fr-lbl', { for: 'fr-status-exp', text: 'Clear after' }),
        h('select.select#fr-status-exp', { dataset: { fk: 'status-expiry' }, onchange: e => { st.expiry = e.target.value; } },
          F.EXPIRY.map(x => h('option', { value: x.id, selected: st.expiry === x.id, text: x.label }))),
        h('div.grow'),
        F.myStatus() ? btn('Clear status', 'x', () => { F.clearStatus(); S.statusOpen = false; say('Status cleared'); paint(); }, { ghost: true, fk: 'status-clear' }) : null,
        btn('Save', 'check', () => saveStatus(), { primary: true, fk: 'status-save' })));
  }
  function saveStatus() {
    const st = S.st;
    if (!st) return;
    const out = F.setStatus({ text: st.text, emoji: st.emoji, preset: st.preset, expiry: st.expiry });
    S.statusOpen = false;
    say(out ? `Status set: ${out.text}` : 'Status cleared');
    paint();
    requestAnimationFrame(() => body.querySelector('[data-fk="status-edit"]')?.focus({ preventScroll: true }));
  }
  function seeBlock(see) {
    const li = (ig, t) => h('li', ic(ig), h('span', { text: t }));
    const s = see.status;
    const inv = see.state === 'invisible';
    return h('div.fr-see', { role: 'group', 'aria-label': 'What your friends see' },
      h('div.fr-cap', { text: 'What your friends see' }),
      h('ul.fr-see__list',
        li('user', `Your name and picture: ${see.name}`),
        li('circle', inv ? 'Offline — you’re invisible, so nothing is sent' : `Whether you’re online or away — now: ${PRESENCE[see.state] || 'Online'}`),
        li('message-circle', inv ? 'No status while you’re invisible' : s ? `Your status: ${s.emoji ? `${s.emoji} ` : ''}${s.text}` : 'Your status, when you set one'),
        li('gamepad', !see.shareGame ? 'Not the game you’re playing (off)' : see.game ? `The game you’re playing: ${see.game}` : 'The game you’re playing, while one is in front')),
      h('div.fr-share',
        sw(see.shareGame, 'Show the game I’m playing', () => { F.setShareGame(!F.shareGame()); say(F.shareGame() ? 'Friends now see the game you’re playing' : 'Friends no longer see what you play'); paint(); }, 'share-game'),
        h('div.fr-row__b', h('b', { text: 'Show the game I’m playing' }),
          h('small', { text: 'Off by default. When on, friends see the title in your front Static Arcade or Static Games window — nothing else.' }))),
      fine('Nobody else can read any of it: it’s encrypted for each friend. Your code, files, apps and messages are never sent.'));
  }

  /* ---------------- requests ---------------- */
  function requestsSection(inc) {
    const mine = F.myCode();
    return sec('Friend requests',
      head(`Friend requests · ${inc.length}`),
      fine('Accept only people you gave your friend code to — anyone can type any name.'),
      h('div.fr-list', inc.map(r => h('div.fr-row.fr-req', { role: 'group', 'aria-label': `Friend request from ${r.name}`, dataset: { fp: r.fp } },
        av(r, 36),
        h('div.fr-row__b', h('b', { text: r.name }),
          h('small', { text: `Wants to be friends · ${ago(r.at)} · ${r.code === mine ? 'used your code' : `used your old code ${F.spaced(r.code)}`}` })),
        h('div.fr-row__acts',
          btn('Accept', 'check', () => doAccept(r), { primary: true, act: 'accept' }),
          btn('Decline', 'x', () => doDecline(r), { act: 'decline' }),
          btn('Block', 'shield', () => doBlock(r.fp, r.name, false), { ghost: true, act: 'block', aria: `Block ${r.name}` }))))));
  }
  async function doAccept(r) {
    await F.accept(r.fp);
    say(`You and ${r.name} are now friends`);
    paint();
  }
  async function doDecline(r) {
    await F.decline(r.fp);
    say(`Declined ${r.name}. Their requests are ignored for a day.`);
    paint();
  }
  async function doBlock(fp, name, friend) {
    const yes = await api.confirm({
      title: `Block ${name}?`,
      message: `${friend ? 'They stop seeing you online and you stop seeing them. ' : ''}Anything more from this person’s device is ignored. If they could still have your code, get a new one too.`,
      ok: 'Block', danger: true,
    });
    if (!yes || S.dead) return;
    await F.block(fp);
    say(`Blocked ${name}`);
    paint();
  }

  /* ---------------- friends ---------------- */
  function friendsSection(fr) {
    const on = fr.filter(f => f.presence !== 'offline').length;
    return sec('Friends',
      head(fr.length ? `Friends · ${on} online` : 'Friends'),
      fr.length ? h('div.fr-list', fr.map(friendRow))
        : h('p.fr-empty', ic('heart'), h('span', { text: 'No friends yet. Share your friend code, or type a friend’s code in Add a friend.' })));
  }
  function friendRow(f) {
    const pres = f.presence === 'offline'
      ? (f.lastSeen ? `Offline · last seen ${ago(f.lastSeen)}` : 'Offline · not seen online yet')
      : PRESENCE[f.presence];
    const row = h('div.fr-row.fr-friend', { role: 'group', 'aria-label': `${f.display}, ${pres}`, dataset: { fp: f.fp, presence: f.presence } },
      h('span.fr-avwrap', av(f, 36), h('i.fr-dot', { dataset: { st: f.presence } })),
      h('div.fr-row__b',
        h('b', h('span.fr-friend__name', { text: f.display }), f.nick ? h('span.fr-real', { text: ` · ${f.name}` }) : null),
        h('small.fr-friend__pres', { text: pres }),
        f.status ? h('span.fr-friend__status', { text: `${f.status.emoji ? `${f.status.emoji} ` : ''}${f.status.text}` }) : null,
        f.game ? h('span.fr-friend__game', ic('gamepad'), h('span', { text: `Playing ${f.game}` })) : null),
      h('div.fr-row__acts',
        h('button.ibtn', {
          type: 'button', 'aria-label': `More for ${f.display}`, title: 'More', 'aria-haspopup': 'menu', dataset: { act: 'more', fk: `more-${f.fp}` },
          onclick: e => {
            const b = e.currentTarget.getBoundingClientRect();
            api.menu([
              { label: 'Nickname…', icon: 'edit-3', onClick: () => { S.nick = { fp: f.fp, value: f.nick }; paint(); requestAnimationFrame(() => body.querySelector(`[data-fk="nick-${f.fp}"]`)?.focus()); } },
              { label: 'Plan a game night with them', icon: 'calendar', onClick: () => openNightForm([f.fp]) },
              '-',
              { label: 'Remove friend…', icon: 'trash', danger: true, onClick: () => doRemove(f) },
              { label: 'Block…', icon: 'shield', danger: true, onClick: () => doBlock(f.fp, f.display, true) },
            ], Math.round(b.right - 200), Math.round(b.bottom + 4));
          },
        }, ic('more-horizontal'))));
    if (!S.nick || S.nick.fp !== f.fp) return row;
    const input = h('input', {
      value: S.nick.value || '', maxlength: String(F.NAME_MAX), placeholder: f.name, 'aria-label': `Nickname for ${f.name}`, dataset: { fk: `nick-${f.fp}` },
      oninput: e => { S.nick.value = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveNick(f); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.nick = null; paint(); } },
    });
    return h('div.fr-nickwrap', row, h('div.fr-line.fr-nick',
      h('div.field.grow', ic('tag'), input),
      btn('Cancel', null, () => { S.nick = null; paint(); }, { ghost: true }),
      btn('Save', 'check', () => saveNick(f), { primary: true, fk: `nick-save-${f.fp}` })),
    fine('Only you see a nickname.'));
  }
  function saveNick(f) {
    F.setNick(f.fp, S.nick ? S.nick.value : '');
    S.nick = null;
    say('Nickname saved');
    paint();
  }
  async function doRemove(f) {
    const yes = await api.confirm({ title: `Remove ${f.display}?`, message: 'You stop seeing each other online, and game nights between you are dropped. To be friends again, one of you sends a new request.', ok: 'Remove', danger: true });
    if (!yes || S.dead) return;
    await F.remove(f.fp);
    say(`Removed ${f.display}`);
    paint();
  }

  /* ---------------- game nights (#149) ---------------- */
  function gameChoices() {
    const seen = new Set();
    const recent = [];
    for (const r of plays.recent(30)) {
      if (recent.length >= 10) break;
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key)) continue;
      if (r.kind === 'arcade' && arcadeById(r.id)) { seen.add(key); recent.push({ value: key, label: arcadeById(r.id).title }); }
      else if (r.kind === 'web' && /^[A-Za-z0-9_-]{1,96}$/.test(r.id)) { seen.add(key); recent.push({ value: key, label: F.cleanLine(r.title, 60) || r.id, title: F.cleanLine(r.title, 80) }); }
    }
    const arcade = [...ARCADE].sort((a, b) => (!!b.online - !!a.online) || a.title.localeCompare(b.title))
      .map(a => ({ value: `arcade:${a.id}`, label: a.online ? `${a.title} · online` : a.title }));
    return { recent, arcade };
  }
  function openNightForm(invite = []) {
    const start = new Date(Date.now() + 60 * 60_000);
    start.setMinutes(0, 0, 0);
    const choices = gameChoices();
    S.night = {
      game: choices.recent[0]?.value || 'arcade:chess', date: ymd(start), time: hm(start), len: 60, title: '',
      invite: new Set(invite),
    };
    S.nightNote = null;
    S.nightOpen = true;
    paint();
    requestAnimationFrame(() => body.querySelector('[data-fk="night-game"]')?.focus({ preventScroll: false }));
  }
  function nightsHead(fr) {
    return head('Game nights', fr.length ? btn(S.nightOpen ? 'Close' : 'Plan one', S.nightOpen ? 'x' : 'calendar', () => { if (S.nightOpen) { S.nightOpen = false; paint(); } else openNightForm(); }, { fk: 'night-new', primary: !S.nightOpen }) : null);
  }
  function nightsList(fr, ns) {
    return ns.length ? h('div.fr-nights', ns.map(nightCard))
      : h('p.fr-empty', ic('calendar'), h('span', { text: fr.length ? 'Nothing planned. Pick a game and a time, and your friends get an invite.' : 'Add a friend first, then plan a time to play together.' }));
  }
  function nightForm(fr) {
    const N = S.night;
    const { recent, arcade } = gameChoices();
    const all = [...recent, ...arcade];
    if (!all.some(x => x.value === N.game)) N.game = all[0]?.value || '';
    const field = (label, id, ...kids) => h('div.fr-fld', h('label.fr-lbl', { for: id, text: label }), ...kids);
    return h('form.fr-form', {
      'aria-label': 'Plan a game night',
      onsubmit: e => { e.preventDefault(); createNight(); },
    },
    field('Game', 'fr-n-game', h('select.select#fr-n-game', { dataset: { fk: 'night-game' }, onchange: e => { N.game = e.target.value; } },
      recent.length ? h('optgroup', { label: 'Played lately' }, recent.map(o => h('option', { value: o.value, selected: N.game === o.value, text: o.label }))) : null,
      h('optgroup', { label: 'Static Arcade' }, arcade.filter(o => !recent.some(r => r.value === o.value)).map(o => h('option', { value: o.value, selected: N.game === o.value, text: o.label }))))),
    h('div.fr-line',
      field('Day', 'fr-n-date', h('input.fr-in#fr-n-date', { type: 'date', value: N.date, min: ymd(new Date()), dataset: { fk: 'night-date' }, oninput: e => { N.date = e.target.value; } })),
      field('Time', 'fr-n-time', h('input.fr-in#fr-n-time', { type: 'time', value: N.time, step: '60', dataset: { fk: 'night-time' }, oninput: e => { N.time = e.target.value; } })),
      field('For', 'fr-n-len', h('select.select#fr-n-len', { dataset: { fk: 'night-len' }, onchange: e => { N.len = Number(e.target.value); } },
        LENGTHS.map(m => h('option', { value: String(m), selected: N.len === m, text: LENGTH_TEXT[m] }))))),
    field('Name (optional)', 'fr-n-title', h('div.field', h('input#fr-n-title', { value: N.title, maxlength: String(F.TITLE_MAX), placeholder: 'Friday chess', dataset: { fk: 'night-title' }, autocomplete: 'off', oninput: e => { N.title = e.target.value; } }))),
    h('fieldset.fr-invite', h('legend.fr-lbl', { text: 'Invite' }),
      fr.map(f => h('label.fr-check',
        h('input', { type: 'checkbox', checked: N.invite.has(f.fp), dataset: { fk: `night-inv-${f.fp}` }, onchange: e => { if (e.target.checked) N.invite.add(f.fp); else N.invite.delete(f.fp); } }),
        av(f, 20), h('span', { text: f.display })))),
    noteEl(S.nightNote),
    h('div.fr-line.fr-form__go',
      h('small.fr-fine', { text: 'Friends get the invite when they’re online. Reminders go off 15 minutes before and at the start, while StaticOS is open. At the start you open an Arcade room (a two-player online game with one friend) or a Static Party, and they join it.' }),
      btn('Send invites', 'send', null, { primary: true, fk: 'night-create', type: 'submit' })));
  }
  async function createNight() {
    const N = S.night;
    const [kind, ...rest] = String(N.game || '').split(':');
    const id = rest.join(':');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(N.date || '');
    const t = /^(\d{2}):(\d{2})$/.exec(N.time || '');
    const fail = text => { S.nightNote = { text, err: true }; paint(); };
    if (!m || !t) { fail('Pick a day and a time.'); return; }
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])).getTime();
    if (!(at > Date.now() - 60_000)) { fail('That time has already passed.'); return; }
    if (!N.invite.size) { fail('Invite at least one friend.'); return; }
    const recent = gameChoices().recent.find(x => x.value === N.game);
    const r = await F.createNight({ title: N.title, game: { kind, id, title: recent ? recent.title : null }, at, len: N.len, invite: [...N.invite] });
    if (!r.ok) {
      fail({ game: 'Pick a game.', time: 'Pick a time within the next two months.', invite: 'Invite at least one friend.', full: 'You have as many game nights planned as fit — remove an old one first.', length: 'Pick how long.' }[r.error] || 'That didn’t work.');
      return;
    }
    S.nightOpen = false;
    S.nightNote = null;
    S.focusNight = r.id;
    say(`Game night planned and ${N.invite.size === 1 ? 'the invite' : 'invites'} sent`);
    paint();
  }
  function whoLine(n) {
    const known = list => list.filter(Boolean);
    const others = list => list.filter(x => !x).length;
    const part = (label, list) => {
      const k = known(list), o = others(list);
      if (!k.length && !o) return null;
      return `${label}: ${[...k, ...(o ? [`${o} other${o === 1 ? '' : 's'}`] : [])].join(', ')}`;
    };
    const waiting = n.invited.filter(x => !x.answer).length;
    return [part('Going', n.going), part('Maybe', n.maybe), part('Can’t', n.no), waiting ? `${waiting} not answered` : null].filter(Boolean).join(' · ') || 'No answers yet';
  }
  function nightCard(n) {
    const thumbIc = n.game.kind === 'arcade' && arcadeById(n.game.id) ? arcadeById(n.game.id).icon : 'gamepad';
    const when = F.whenText(n.at);
    const stateText = { upcoming: `In ${until(n.at)}`, soon: `Starts in ${until(n.at)}`, live: 'On now', over: 'Over', cancelled: 'Cancelled' }[n.state];
    const open = n.state !== 'over' && n.state !== 'cancelled';
    const acts = [];
    if (!n.host && open) {
      acts.push(h('div.seg.fr-rsvp', { role: 'group', 'aria-label': 'Are you going?' },
        ...[['yes', 'Going'], ['maybe', 'Maybe'], ['no', 'Can’t']].map(([a, label]) => h('button', {
          type: 'button', class: n.mine === a ? 'is-on' : null, 'aria-pressed': String(n.mine === a), dataset: { answer: a },
          onclick: () => { F.rsvp(n.id, a); say(`You answered ${label}`); paint(); },
        }, h('span', { text: label })))));
    }
    if (n.canJoin) {
      if (n.host) {
        acts.push(n.via === 'room'
          ? btn('Start room', 'play', () => F.joinNight(n.id), { primary: true, act: 'join', tip: 'Make a Static Arcade room for this game and send its code to your friend' })
          : btn(n.party ? 'Open party' : 'Start party', 'play', () => F.joinNight(n.id), { primary: true, act: 'join', tip: 'Make a Static Party with this game and send its code to the people invited' }));
      } else if (n.room || n.party) {
        acts.push(btn('Join', 'play', () => F.joinNight(n.id), { primary: true, act: 'join', tip: `Join ${n.hostName}’s ${n.room ? 'room' : 'party'}` }));
      } else {
        acts.push(btn('Join', 'play', () => {}, { act: 'join', disabled: true, tip: `Opens when ${n.hostName} starts the ${n.via}` }));
      }
      if (canOpenGame(n.game)) acts.push(btn('Open game', 'gamepad', () => openGame(n.game), { ghost: true, act: 'game' }));
    }
    if (n.host && open) acts.push(btn('Cancel night', 'x', () => doCancelNight(n), { ghost: true, act: 'cancel' }));
    if (!open) acts.push(btn('Remove', 'trash', () => { F.removeNight(n.id); paint(); }, { ghost: true, act: 'remove' }));
    const pending = !n.host && n.mine && !n.confirmed && open ? fine(`Your answer reaches ${n.hostName} when you’re both online.`) : null;
    const waitJoin = n.canJoin && !n.host && !n.party && !n.room ? fine(`Join opens when ${n.hostName} starts the ${n.via}.`) : null;
    return h('article.fr-night', { dataset: { id: n.id, state: n.state }, tabindex: '-1', 'aria-label': `${n.name}, ${when}, ${stateText}` },
      h('div.fr-night__top',
        h('span.fr-night__ic', { 'aria-hidden': 'true' }, ic(thumbIc)),
        h('div.fr-row__b',
          h('b', { text: n.name }),
          h('small', { text: `${n.game.title || 'A game that isn’t on this StaticOS'} · ${when} · ${n.len} min` }),
          h('small', { text: n.host ? 'You’re hosting' : `Hosted by ${n.hostName}` })),
        h('span.chip.fr-night__state', { class: n.state === 'live' || n.state === 'soon' ? 'chip--accent' : null, text: stateText })),
      h('p.fr-night__who', { text: whoLine(n) }),
      acts.length ? h('div.fr-line.fr-night__acts', acts) : null,
      waitJoin, pending);
  }
  const canOpenGame = g => (g.kind === 'arcade' ? !!arcadeById(g.id) && !!api.getApp('arcade') : !!api.getApp('aether-games'));
  async function openGame(g) {
    if (g.kind === 'arcade') { if (arcadeById(g.id)) api.openApp('arcade', { game: g.id, players: 1 }); return; }
    try {
      const G = await import('../portal/games.data.js');
      await G.load();
      if (G.byId(g.id)) api.openApp('aether-games', { url: `static://games/${g.id}` });
    } catch (e) { /* the catalogue didn't load */ }
  }
  async function doCancelNight(n) {
    const yes = await api.confirm({ title: `Cancel ${n.name}?`, message: 'Everyone invited is told when their device next hears from yours, and the reminders go.', ok: 'Cancel night', cancel: 'Keep it', danger: true });
    if (!yes || S.dead) return;
    F.cancelNight(n.id);
    say('Game night cancelled');
    paint();
  }

  /* ---------------- add a friend (#144) ---------------- */
  function addSection() {
    const code = F.myCode();
    const out = F.outgoing();
    const outText = { waiting: 'Waiting for them to accept', declined: 'Not accepted', expired: 'No answer after a week' };
    return sec('Add a friend',
      head('Add a friend'),
      h('div.fr-code',
        h('div.fr-row__b',
          h('small', { text: 'Your friend code' }),
          h('b.fr-code__v', { dataset: { fk: 'my-code', code: code || '' }, 'aria-label': code ? `Your friend code: ${code.split('').join(' ')}` : 'Making your friend code', text: code ? F.spaced(code) : '……' })),
        h('div.fr-line',
          btn('Copy code', 'copy', () => code && copy(`Add me as a friend on StaticOS — my friend code is ${F.spaced(code)}`, 'Friend code'), { fk: 'copy-code', disabled: !code }),
          btn('Copy invite link', 'link', () => code && copy(`Add me as a friend on StaticOS: ${F.inviteLink(code)}`, 'Invite link'), { fk: 'copy-link', disabled: !code }),
          btn('New code', 'refresh', () => newCode(), { ghost: true, fk: 'new-code', disabled: !code }))),
      fine('Give your code or link only to people you want as friends. Anyone who has it can send you a request; nobody can find you any other way. A new code stops the old one from working.'),
      h('form.fr-addform', { onsubmit: e => { e.preventDefault(); sendReq(); } },
        h('label.fr-lbl', { for: 'fr-add-in', text: 'Your friend’s code' }),
        h('div.fr-line',
          h('div.field.grow', ic('heart'), h('input#fr-add-in', {
            value: S.add, placeholder: 'ABCD-EFGH', autocomplete: 'off', spellcheck: 'false', maxlength: '200', dataset: { fk: 'add-code' },
            oninput: e => { S.add = e.target.value; },
          })),
          btn('Send request', 'send', null, { primary: true, fk: 'add-send', type: 'submit' }))),
      noteEl(S.addNote),
      out.length ? h('div.fr-list', out.map(o => h('div.fr-row.fr-out', { dataset: { code: o.code, state: o.state } },
        h('span.fr-night__ic', { 'aria-hidden': 'true' }, ic('send')),
        h('div.fr-row__b', h('b', { text: `Request to ${F.spaced(o.code)}` }), h('small', { text: `${outText[o.state] || ''} · sent ${ago(o.at)}` })),
        btn(o.state === 'waiting' ? 'Cancel' : 'Remove', 'x', () => { F.cancelRequest(o.code); paint(); }, { ghost: true, act: 'cancel', aria: `${o.state === 'waiting' ? 'Cancel' : 'Remove'} the request to ${o.code}` })))) : null);
  }
  async function sendReq() {
    const code = F.normCode(S.add);
    if (!F.isCode(code)) { S.addNote = { text: 'That isn’t a friend code. A code is 8 letters and numbers, like K7QM-2XPA.', err: true }; paint(); return; }
    const r = await F.request(code);
    if (S.dead) return;
    if (!r.ok) {
      S.addNote = { text: r.error === 'self' ? 'That’s your own code.' : r.error === 'full' ? `${F.MAX_OUTGOING} requests are waiting already — cancel one first.` : 'That isn’t a friend code.', err: true };
    } else {
      S.add = '';
      S.addNote = { text: r.live ? `Request sent to ${F.spaced(code)}. They see your name and picture, and choose whether to accept.` : `Request saved for ${F.spaced(code)} — it goes out once the live channel connects.` };
    }
    say(S.addNote.text);
    paint();
  }
  async function newCode() {
    const yes = await api.confirm({ title: 'Get a new friend code?', message: 'Your old code stops taking requests. Friends you already have stay friends.', ok: 'New code' });
    if (!yes || S.dead) return;
    const c = await F.rotateCode();
    say(`Your new friend code is ${c.split('').join(' ')}`);
    paint();
  }

  /* ---------------- blocked + about ---------------- */
  function blockedSection(bl) {
    if (!bl.length) return null;
    return h('details.fr-sec.fr-blocked', { open: S.blockedOpen, ontoggle: e => { S.blockedOpen = e.target.open; } }, h('summary', { text: `Blocked · ${bl.length}` }),
      h('div.fr-list', bl.map(b => h('div.fr-row', { dataset: { fp: b.fp } },
        h('div.fr-row__b', h('b', { text: b.name }), h('small', { text: `Blocked ${ago(b.at)}` })),
        btn('Unblock', null, () => { F.unblock(b.fp); paint(); }, { ghost: true, act: 'unblock' })))));
  }
  function aboutSection() {
    const li = (ig, t) => h('li', ic(ig), h('span', { text: t }));
    const st = F.liveStatus();
    return sec('How Friends works',
      head('How Friends works'),
      h('ul.fr-about',
        li('lock', 'Only people you accept see you. What goes to a friend is encrypted for that friend alone and travels a free public live channel; whoever runs it sees that messages pass, not what’s in them.'),
        li('eye', 'Names aren’t verified. There’s no search and no list of people — a code you hand out is the only way in.'),
        li('globe', 'Saved in this browser, for this web address. staticos.surge.sh and the AWS link are different addresses, so each has its own code and its own friends. A friend on either link can add you with your code, but the friendship lives on the link where it was made. Settings › Back up your data moves it to the other one; that file holds your private key, so keep it to yourself. Everyone on this computer has their own Friends.'),
        li('clock', 'Friends see you go offline about a minute and a half after you close StaticOS. “Last seen” is when your device last heard from them.'),
        li('calendar', 'Game nights are kept on each device; the host’s copy is the one that counts. Reminders go off only while StaticOS is open.'),
        li('wifi-off', `Live channel: ${LIVE_TEXT[st] || st}. Some school and work networks block it.`)));
  }

  /* ---------------- lifecycle ---------------- */
  const offs = [F.onChange(() => { if (S.shown) refresh(); else if (F.started()) count(F.friends(), F.incoming()); })];
  const tick = setInterval(refresh, 15_000);

  function show(opts = {}) {
    S.shown = true;
    if (opts && typeof opts.friend === 'string') {
      const c = F.normCode(opts.friend);
      if (F.isCode(c)) { S.add = F.spaced(c); S.addNote = { text: `Code ${F.spaced(c)} is filled in from the link. Press Send request if you want to add them.` }; }
    }
    if (opts && typeof opts.night === 'string' && /^[a-z0-9]{12}$/.test(opts.night)) S.focusNight = opts.night;
    paint();
    if (F.available()) F.ensureCode().then(refresh).catch(refresh);
    if (opts && opts.friend) requestAnimationFrame(() => body.querySelector('[data-fk="add-send"]')?.focus({ preventScroll: false }));
  }
  function hide() { S.shown = false; }
  function destroy() {
    S.dead = true;
    clearInterval(tick);
    offs.forEach(off => { try { off(); } catch (e) { /* gone */ } });
  }
  /* the rail badge counts before the view is shown — but only when Friends
     is already running here: opening Social alone never starts it */
  if (F.started()) F.ready().then(() => count(F.friends(), F.incoming())).catch(() => {});
  return { el, show, hide, destroy, focus: () => body.focus({ preventScroll: true }) };
}

export default friendsView;
