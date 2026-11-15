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
     Groups       named sets of friends: plan a game night or send a poll
                  to the whole group
     Game nights  plan one (game, time, friends; repeating every week
                  if you like), RSVP, reminders, Skip this week, add to
                  Calendar, Join from 10 minutes before the start
     Study together  a focus timer shared with one friend (core/studyroom.js)
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
import * as SR from '../core/studyroom.js';
import * as FOCUS from '../core/focus.js';
import * as presence from '../portal/presence.js';
import * as CAT from '../portal/games.data.js';

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
    grp: null, poll: null, groupNote: null, bday: null, cat: CAT.isLoaded ? CAT.isLoaded() : false, catWanted: false,
    studyWhat: '', studyNote: null, studyPick: '',
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
      sec('You', at('meRow'), at('meEditor'), at('meSee'), at('meOpts')),
      at('requests'), at('addTop'), at('friends'), at('groups'),
      sec('Game nights', at('nightsHead'), at('nightsForm'), at('nightsList')),
      at('study'),
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
    const seeSig = [see.name, see.state, see.status, see.game, see.shareGame, see.shares];
    fill('meRow', J([seeSig, see.color, picSig(see.picture), see.costume, S.statusOpen, h24()]), () => meRow(see));
    fill('meEditor', J([S.statusOpen, !!F.myStatus()]), () => (S.statusOpen ? statusEditor() : null));
    fill('meSee', J(seeSig), () => seeBlock(see));
    fill('meOpts', J([F.options(), presence.appearingOffline()]), () => optionsBlock());
    fill('requests', J([inc.map(r => [r.fp, r.name, r.hue, picSig(r.picture), r.costume, r.code, r.at]), F.myCode(), inc.length ? minute : 0]), () => (inc.length ? requestsSection(inc) : null));
    const addSig = J([F.myCode(), F.outgoing(), S.addNote, F.outgoing().length ? minute : 0]);
    fill('addTop', fr.length ? 'off' : addSig, () => (fr.length ? null : addSection()));
    fill('addEnd', fr.length ? addSig : 'off', () => (fr.length ? addSection() : null));
    /* a nickname being typed keeps the list still until it's saved or cancelled */
    if (!S.catWanted && fr.some(f => { const x = F.sharedBy(f.fp); return x && ((x.recent && x.recent.length) || (x.favs && x.favs.length)); })) loadCat();
    const frSig = S.nick ? (slot('friends').sig ?? 'nick') : J([fr.map(f => [f.fp, f.display, f.name, f.nick, picSig(f.picture), f.costume, f.presence, f.status, f.game, f.presence === 'offline' ? f.lastSeen : 0,
      f.fav, f.birthday, F.sharedBy(f.fp), F.bothFavourited(f.fp)]), fr.some(f => f.presence === 'offline') ? minute : 0, S.cat]);
    fill('friends', frSig, () => friendsSection(fr));
    const gs = F.groups();
    fill('groups', J(fr.length ? [gs, fr.map(f => [f.fp, f.display]), S.grp && { id: S.grp.id, members: [...S.grp.members] }, S.poll && { gid: S.poll.gid, n: S.poll.opts.length, note: S.poll.note }, S.groupNote] : 'off'), () => (fr.length ? groupsSection(fr, gs) : null));
    const room = SR.current();
    const ticking = !!room && (FOCUS.state().status === 'running' || (!!room.theirs && room.theirs.status === 'running'));
    fill('study', J(fr.length ? [room, S.studyNote, S.studyPick, fr.map(f => [f.fp, f.display]), ticking ? Math.floor(Date.now() / 1000) : 0, room ? FOCUS.state().status : ''] : 'off'), () => (fr.length ? studySection(fr, room) : null));
    fill('nightsHead', J([fr.length > 0, S.nightOpen]), () => nightsHead(fr));
    fill('nightsForm', J(S.nightOpen && fr.length ? [fr.map(f => [f.fp, f.display]), S.nightNote, [...S.night.invite], S.night.weekly, gs] : 'closed'), () => (S.nightOpen && fr.length ? nightForm(fr) : null));
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
        onclick: () => { st.preset = p.id; st.text = p.text; st.emoji = p.emoji; if (p.expiry) st.expiry = p.expiry; paint(); },
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
        li('gamepad', !see.shareGame ? 'Not the game you’re playing (off)' : see.game ? `The game you’re playing: ${see.game}` : 'The game you’re playing, while one is in front'),
        li('clock', see.shares.recent ? 'The titles of up to 8 games you played lately' : 'Not your recently played games (off)'),
        li('heart', see.shares.favs ? 'Which Static Games you have favourited' : 'Not your favourite games (off)'),
        li('gift', see.shares.birthday ? 'Your birthday: day and month, no year' : 'Not your birthday (off)'),
        li('circle', see.shares.dndBusy ? 'Busy, while Do Not Disturb is on' : 'Nothing about Do Not Disturb (off)')),
      h('div.fr-share',
        sw(see.shareGame, 'Show the game I’m playing', () => { F.setShareGame(!F.shareGame()); say(F.shareGame() ? 'Friends now see the game you’re playing' : 'Friends no longer see what you play'); paint(); }, 'share-game'),
        h('div.fr-row__b', h('b', { text: 'Show the game I’m playing' }),
          h('small', { text: 'Off by default. When on, friends see the title in your front Static Arcade or Static Games window — nothing else.' }))),
      fine('Nobody else can read any of it: it’s encrypted for each friend. Your code, files, apps and messages are never sent.'));
  }

  /* ---------------- your options: appear offline, busy, count, what you share ---------------- */
  const optRow = (fk, on, title, sub, fn) => h('div.fr-share', sw(on, title, fn, fk), h('div.fr-row__b', h('b', { text: title }), h('small', { text: sub })));
  function toggleOpt(key, msgOn, msgOff) {
    F.setOption(key, !F.options()[key]);
    say(F.options()[key] ? msgOn : msgOff);
    paint();
  }
  function bdayText(b) {
    const m = /^--(\d{2})-(\d{2})$/.exec(b || '');
    return m ? new Date(2000, +m[1] - 1, +m[2]).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : '';
  }
  function optionsBlock() {
    const o = F.options();
    const off = presence.appearingOffline();
    const draft = S.bday === null ? (o.birthday ? `2000${o.birthday.slice(1)}` : '') : S.bday;
    const dateIn = h('input.fr-in', { type: 'date', value: draft, 'aria-label': 'Your birthday (only the day and month are shared)', dataset: { fk: 'my-birthday' }, oninput: e => { S.bday = e.target.value; } });
    return h('div.fr-see', { role: 'group', 'aria-label': 'Your options' },
      h('div.fr-cap', { text: 'Your options' }),
      optRow('appear-offline', off, 'Appear offline', 'Look offline to everyone, friends and the public list, until you switch it off.',
        () => { presence.setAppearOffline(!presence.appearingOffline()); say(presence.appearingOffline() ? 'You now appear offline' : 'You now show your status again'); paint(); }),
      optRow('opt-dndBusy', o.dndBusy, 'Show Busy when Do Not Disturb is on', 'Off by default. Friends see Busy, never why.', () => toggleOpt('dndBusy', 'Friends see Busy while Do Not Disturb is on', 'Do Not Disturb no longer shows to friends')),
      optRow('opt-showCount', o.showCount, 'Show how many friends are online', 'In the top bar and on the Social icon in the dock. It counts real heartbeats.', () => toggleOpt('showCount', 'Friends online count is on', 'Friends online count is off')),
      h('div.fr-cap', { text: 'What you choose to share (all off until you switch it on)' }),
      optRow('opt-shareRecent', o.shareRecent, 'Games I played recently', 'Friends see the titles of up to 8 games you launched lately. You can switch it off any time and they stop seeing it.', () => toggleOpt('shareRecent', 'Friends can see your recently played games', 'Your recently played games are no longer shared')),
      optRow('opt-shareFavs', o.shareFavs, 'Games I favourited', 'Friends see which Static Games you favourited, and which you both did.', () => toggleOpt('shareFavs', 'Friends can see your favourite games', 'Your favourite games are no longer shared')),
      h('div.fr-share', h('div.fr-row__b', h('b', { text: 'My birthday' }),
        h('small', { text: o.birthday ? `Shared with friends: ${bdayText(o.birthday)}. No year is sent.` : 'Not shared. Only the day and month go to friends, never the year.' }),
        h('div.fr-line', dateIn,
          btn('Share', 'check', () => { const v = S.bday === null ? '' : S.bday; if (!F.setBirthday(v)) { say('Pick a day first'); return; } S.bday = null; say('Your birthday is shared with friends'); paint(); }, { fk: 'birthday-save', primary: true }),
          o.birthday ? btn('Stop sharing', 'x', () => { F.setBirthday(''); S.bday = null; say('Your birthday is no longer shared'); paint(); }, { fk: 'birthday-clear', ghost: true }) : null))),
      optRow('opt-remindBirthdays', o.remindBirthdays, 'Remind me of friends’ birthdays', 'Only for friends who chose to share theirs. Reminders go through Automations at 9 AM.', () => toggleOpt('remindBirthdays', 'Birthday reminders are on', 'Birthday reminders are off')));
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
          h('small', { text: `Wants to be friends · ${ago(r.at)} · ${r.code === mine ? 'used your code' : `used your old code ${F.spaced(r.code)}`}` }),
          h('small.fr-keytag', { text: `Key ${r.keyTag}` }),
          r.twin ? h('small.fr-warn', { role: 'note', text: `You already have a friend called ${r.twin}. This request comes from a different key: it may be them on a new device, or someone using their name. Ask them, another way, before you accept.` }) : null),
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
  function loadCat() {
    S.catWanted = true;
    CAT.load().then(() => { if (S.dead) return; S.cat = true; paint(); }).catch(() => {});
  }
  const gameTitle = (kind, id) => (kind === 'arcade' ? (arcadeById(id) || {}).title : S.cat ? (CAT.byId(id) || {}).title : null);
  function friendRow(f) {
    const pres = f.presence === 'offline'
      ? (f.lastSeen ? `Offline · last seen ${ago(f.lastSeen)}` : 'Offline · not seen yet')
      : PRESENCE[f.presence];
    const shared = F.sharedBy(f.fp);
    const recentTitles = shared && shared.recent ? shared.recent.map(x => gameTitle(x.kind, x.id)).filter(Boolean).slice(0, 5) : [];
    const bothTitles = F.bothFavourited(f.fp).map(id => gameTitle('web', id)).filter(Boolean).slice(0, 5);
    const row = h('div.fr-row.fr-friend', { role: 'group', 'aria-label': `${f.display}, ${pres}`, dataset: { fp: f.fp, presence: f.presence } },
      h('span.fr-avwrap', av(f, 36), h('i.fr-dot', { dataset: { st: f.presence } })),
      h('div.fr-row__b',
        h('b', h('span.fr-friend__name', { text: f.display }), f.nick ? h('span.fr-real', { text: ` · ${f.name}` }) : null),
        h('small.fr-friend__pres', { text: pres }),
        f.status ? h('span.fr-friend__status', { text: `${f.status.emoji ? `${f.status.emoji} ` : ''}${f.status.text}` }) : null,
        f.game ? h('span.fr-friend__game', ic('gamepad'), h('span', { text: `Playing ${f.game}` })) : null,
        recentTitles.length ? h('span.fr-friend__recent', ic('clock'), h('span', { text: `Played lately: ${recentTitles.join(', ')}` })) : null,
        bothTitles.length ? h('span.fr-friend__both', ic('heart'), h('span', { text: `You both favourited: ${bothTitles.join(', ')}` })) : null,
        f.birthday ? h('span.fr-friend__bday', ic('gift'), h('span', { text: `Birthday ${bdayText(f.birthday)}` })) : null),
      h('div.fr-row__acts',
        h('button.ibtn.fr-star', {
          type: 'button', 'aria-label': f.fav ? `Remove ${f.display} from favourites` : `Add ${f.display} to favourites`, 'aria-pressed': String(f.fav),
          title: f.fav ? 'Favourite: at the top of your list' : 'Star to keep at the top of your list', class: f.fav ? 'is-on' : null, dataset: { act: 'fav', fk: `fav-${f.fp}` },
          onclick: e => { e.stopPropagation(); F.setFavourite(f.fp, !f.fav); say(f.fav ? `${f.display} is no longer a favourite` : `${f.display} is a favourite`); paint(); },
        }, icon('star', f.fav ? { fill: true } : undefined)),
        h('button.ibtn', {
          type: 'button', 'aria-label': `More for ${f.display}`, title: 'More', 'aria-haspopup': 'menu', dataset: { act: 'more', fk: `more-${f.fp}` },
          onclick: e => {
            const b = e.currentTarget.getBoundingClientRect();
            api.menu([
              { label: 'Nickname…', icon: 'edit-3', onClick: () => { S.nick = { fp: f.fp, value: f.nick }; paint(); requestAnimationFrame(() => body.querySelector(`[data-fk="nick-${f.fp}"]`)?.focus()); } },
              { label: 'Plan a game night with them', icon: 'calendar', onClick: () => openNightForm([f.fp]) },
              { label: 'Invite to my party', icon: 'users', onClick: () => inviteParty(f) },
              { label: 'Study together…', icon: 'clock', onClick: () => inviteStudy(f) },
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

  /* ---------------- groups ---------------- */
  function groupsSection(fr, gs) {
    const nameOf = new Map(fr.map(f => [f.fp, f.display]));
    const G = S.grp;
    const form = G ? h('form.fr-form', { 'aria-label': G.id ? 'Edit group' : 'New group', onsubmit: e => { e.preventDefault(); doSaveGroup(); } },
      h('div.fr-fld', h('label.fr-lbl', { for: 'fr-g-name', text: 'Group name' }),
        h('div.field', h('input#fr-g-name', { value: G.name, maxlength: '30', placeholder: 'Study group', autocomplete: 'off', dataset: { fk: 'group-name' }, oninput: e => { G.name = e.target.value; } }))),
      h('fieldset.fr-invite', h('legend.fr-lbl', { text: 'Who is in it' }),
        fr.map(f => h('label.fr-check',
          h('input', { type: 'checkbox', checked: G.members.has(f.fp), dataset: { fk: `group-m-${f.fp}` }, onchange: e => { if (e.target.checked) G.members.add(f.fp); else G.members.delete(f.fp); } }),
          av(f, 20), h('span', { text: f.display })))),
      noteEl(S.groupNote),
      h('div.fr-line.fr-form__go', h('div.grow'), btn('Cancel', null, () => { S.grp = null; S.groupNote = null; paint(); }, { ghost: true }), btn('Save group', 'check', null, { primary: true, fk: 'group-save', type: 'submit' }))) : null;
    const P = S.poll;
    const pollForm = P ? h('form.fr-form', { 'aria-label': 'Send a poll to a group', onsubmit: e => { e.preventDefault(); doGroupPoll(); } },
      h('div.fr-fld', h('label.fr-lbl', { for: 'fr-gp-q', text: `Poll for ${(gs.find(g => g.id === P.gid) || {}).name || 'the group'}` }),
        h('div.field', h('input#fr-gp-q', { value: P.q, maxlength: '140', placeholder: 'Which night works?', autocomplete: 'off', dataset: { fk: 'poll-q' }, oninput: e => { P.q = e.target.value; } }))),
      P.opts.map((o, i) => h('div.field', h('input', { value: o, maxlength: '60', placeholder: `Option ${i + 1}`, 'aria-label': `Option ${i + 1}`, dataset: { fk: `poll-o${i}` }, oninput: e => { P.opts[i] = e.target.value; } }))),
      noteEl(P.note),
      h('div.fr-line.fr-form__go',
        P.opts.length < 6 ? btn('Add option', 'plus', () => { P.opts.push(''); paint(); }, { ghost: true, fk: 'poll-more' }) : null,
        h('div.grow'), btn('Cancel', null, () => { S.poll = null; paint(); }, { ghost: true }), btn('Send poll', 'send', null, { primary: true, fk: 'poll-send', type: 'submit' }))) : null;
    return sec('Groups',
      head('Groups', btn(G ? 'Close' : 'New group', G ? 'x' : 'users', () => { if (S.grp) { S.grp = null; S.groupNote = null; } else S.grp = { id: null, name: '', members: new Set() }; paint(); }, { fk: 'group-new', primary: !G })),
      form, pollForm,
      gs.length ? h('div.fr-list', gs.map(g => h('div.fr-row.fr-group', { role: 'group', 'aria-label': `Group ${g.name}`, dataset: { id: g.id } },
        h('span.fr-night__ic', { 'aria-hidden': 'true' }, ic('users')),
        h('div.fr-row__b', h('b', { text: g.name }), h('small', { text: g.members.map(fp => nameOf.get(fp)).filter(Boolean).join(', ') || 'No one left in it' })),
        h('div.fr-row__acts',
          btn('Game night', 'calendar', () => openNightForm(g.members), { act: 'group-night', aria: `Plan a game night with ${g.name}` }),
          btn('Poll', 'bar-chart', () => { S.poll = { gid: g.id, q: '', opts: ['', ''], note: null }; paint(); requestAnimationFrame(() => body.querySelector('[data-fk="poll-q"]')?.focus()); }, { act: 'group-poll', aria: `Send a poll to ${g.name}` }),
          btn('Edit', 'edit-3', () => { S.grp = { id: g.id, name: g.name, members: new Set(g.members) }; paint(); }, { ghost: true, act: 'group-edit', aria: `Edit ${g.name}` }),
          btn('Delete', 'trash', () => doDeleteGroup(g), { ghost: true, act: 'group-delete', aria: `Delete ${g.name}` })))))
        : h('p.fr-empty', ic('users'), h('span', { text: 'A group is a name and some friends, so one click plans a game night or sends a poll to all of them. Groups stay on this device.' }))
    );
  }
  function doSaveGroup() {
    const G = S.grp;
    const r = F.saveGroup({ id: G.id, name: G.name, members: [...G.members] });
    if (!r.ok) { S.groupNote = { text: { name: 'Give the group a name.', members: 'Pick at least one friend.', full: `You can keep ${F.MAX_GROUPS} groups.`, gone: 'That group is gone.' }[r.error] || 'That didn’t work.', err: true }; paint(); return; }
    S.grp = null; S.groupNote = null;
    say(`Group ${G.name} saved`);
    paint();
  }
  async function doDeleteGroup(g) {
    const yes = await api.confirm({ title: `Delete ${g.name}?`, message: 'The friends stay friends. Only the group is removed, from this device.', ok: 'Delete', danger: true });
    if (!yes || S.dead) return;
    F.deleteGroup(g.id);
    say(`Deleted ${g.name}`);
    paint();
  }
  async function doGroupPoll() {
    const P = S.poll;
    const opts = P.opts.map(o => o.trim()).filter(Boolean);
    const r = await F.sendGroupPoll(P.gid, { q: P.q, opts });
    if (S.dead || !S.poll) return;
    if (!r.ok) { P.note = { text: r.error === 'poll' ? 'A poll needs a question and at least two options.' : 'Could not send it.', err: true }; paint(); return; }
    S.poll = null;
    say(`Poll sent to ${r.sent} of ${r.total} in the group`);
    api.notify({ app: 'social', icon: 'bar-chart', title: 'Poll sent', message: `${r.sent} of ${r.total} friends in the group. Answers come back in Static Chat.`, timeout: 5000 });
    paint();
  }

  /* ---------------- invites from a friend's menu ---------------- */
  async function inviteParty(f) {
    let code = null;
    try { const P = await import('../portal/party.js'); code = (P.current() || {}).code || null; } catch (e) { code = null; }
    if (!code) { api.notify({ app: 'social', icon: 'info', title: 'No party to invite to', message: 'Start a party in Static Party first, then invite from here.', timeout: 6000 }); return; }
    const r = await F.sendPartyInvite(f.fp, code);
    api.notify({ app: 'social', icon: 'users', title: r.ok ? `Party invite sent to ${f.display}` : 'Invite not sent', message: r.ok ? 'They get a notice with Join. Nothing joins until they press it.' : 'Wait a moment and try again.', timeout: 5000 });
  }
  async function inviteStudy(f) {
    const cur = SR.current();
    if (cur && cur.role === 'guest') { S.studyNote = { text: 'You joined someone else’s room. Leave it to start your own.', err: true }; paint(); return; }
    const code = cur ? cur.code : SR.host();
    const r = await F.sendStudyInvite(f.fp, code);
    S.studyNote = r.ok ? { text: `Invited ${f.display}. They get a notice with Join.` } : { text: 'Could not send the invite. Try again in a moment.', err: true };
    paint();
  }

  /* ---------------- study together ---------------- */
  const mmss = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  function studySection(fr, room) {
    if (!room) {
      return sec('Study together',
        head('Study together', btn('Start a room', 'clock', () => { SR.host(); S.studyNote = null; paint(); }, { fk: 'study-host', primary: true })),
        fine('A focus timer you share with one friend. You each keep your own timer, and starting or pausing together keeps them in step. Nothing joins until your friend presses Join.'),
        noteEl(S.studyNote));
    }
    const mine = FOCUS.state();
    const t = room.theirs;
    let theirs = 'Waiting for their timer';
    if (t) {
      const left = t.status === 'running' ? Math.max(0, t.left - (Date.now() - t.at)) : t.left;
      theirs = `${t.phase === 'focus' ? 'Focus' : 'Break'} · ${t.status === 'ready' ? 'not started' : t.status} · ${mmss(left)}${t.what ? ` · ${t.what}` : ''}`;
    }
    const status = room.error ? 'The room could not open.' : room.phase === 'paired' ? `With ${room.peerName || 'your friend'}` : room.phase === 'closed' ? 'The room has closed.' : 'Waiting for a friend to join';
    const inviteable = room.role === 'host' && room.phase !== 'paired' && room.phase !== 'closed';
    return sec('Study together',
      head('Study together', btn('Leave', 'x', () => { SR.leave(); S.studyNote = null; say('You left the study room'); paint(); }, { fk: 'study-leave', ghost: true })),
      h('div.fr-code', h('div.fr-row__b', h('small', { text: 'Room' }), h('b.fr-code__v', { dataset: { fk: 'study-code' }, text: room.code }),
        h('small', { dataset: { fk: 'study-status' }, text: status }))),
      h('div.fr-study',
        h('div.fr-study__t', { dataset: { fk: 'study-mine' } }, h('small', { text: 'You' }), h('b', { text: `${mine.phase === 'focus' ? 'Focus' : 'Break'} · ${mine.status === 'ready' ? 'not started' : mine.status} · ${mmss(mine.left)}` })),
        h('div.fr-study__t', { dataset: { fk: 'study-theirs' } }, h('small', { text: room.peerName || 'Friend' }), h('b', { text: theirs }))),
      h('div.fr-line',
        h('div.field.grow', h('input', { value: S.studyWhat, maxlength: '80', placeholder: 'What are you working on? (optional)', 'aria-label': 'What you are working on', dataset: { fk: 'study-what' }, oninput: e => { S.studyWhat = e.target.value; } })),
        btn('Start together', 'play', () => { SR.startTogether(S.studyWhat); say('Focus timer started'); paint(); }, { primary: true, fk: 'study-start' }),
        btn('Pause together', 'pause', () => { SR.pauseTogether(); say('Focus timer paused'); paint(); }, { fk: 'study-pause' })),
      h('div.fr-share', sw(room.follow, 'Follow their start and pause', () => { SR.setFollow(!SR.current().follow); paint(); }, 'study-follow'),
        h('div.fr-row__b', h('b', { text: 'Follow their start and pause' }), h('small', { text: 'On: when your friend starts or pauses together, your timer does too. Off: you only watch.' }))),
      inviteable ? h('div.fr-line',
        h('div.grow', h('select.select', { 'aria-label': 'Friend to invite', dataset: { fk: 'study-pick' }, onchange: e => { S.studyPick = e.target.value; } },
          h('option', { value: '', text: 'Invite a friend…' }), fr.map(f => h('option', { value: f.fp, selected: S.studyPick === f.fp, text: f.display })))),
        btn('Invite', 'send', () => { const f = fr.find(x => x.fp === S.studyPick); if (f) inviteStudy(f); }, { fk: 'study-invite' })) : null,
      noteEl(S.studyNote));
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
    /* an anime night starts from a title's page ("Anime night with friends"), never from a list here */
    const anime = S.animePick ? [{ value: `anime:${S.animePick.id}`, label: S.animePick.title, title: S.animePick.title }] : [];
    return { recent, arcade, anime };
  }
  function openNightForm(invite = []) {
    const start = new Date(Date.now() + 60 * 60_000);
    start.setMinutes(0, 0, 0);
    const choices = gameChoices();
    S.night = {
      game: choices.anime[0]?.value || choices.recent[0]?.value || 'arcade:chess', date: ymd(start), time: hm(start), len: 60, title: '',
      invite: new Set(invite), weekly: false,
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
    const { recent, arcade, anime } = gameChoices();
    const all = [...anime, ...recent, ...arcade];
    if (!all.some(x => x.value === N.game)) N.game = all[0]?.value || '';
    const field = (label, id, ...kids) => h('div.fr-fld', h('label.fr-lbl', { for: id, text: label }), ...kids);
    return h('form.fr-form', {
      'aria-label': 'Plan a game night',
      onsubmit: e => { e.preventDefault(); createNight(); },
    },
    field('Game', 'fr-n-game', h('select.select#fr-n-game', { dataset: { fk: 'night-game' }, onchange: e => { N.game = e.target.value; } },
      anime.length ? h('optgroup', { label: 'Anime night' }, anime.map(o => h('option', { value: o.value, selected: N.game === o.value, text: o.label }))) : null,
      recent.length ? h('optgroup', { label: 'Played lately' }, recent.map(o => h('option', { value: o.value, selected: N.game === o.value, text: o.label }))) : null,
      h('optgroup', { label: 'Static Arcade' }, arcade.filter(o => !recent.some(r => r.value === o.value)).map(o => h('option', { value: o.value, selected: N.game === o.value, text: o.label }))))),
    h('div.fr-line',
      field('Day', 'fr-n-date', h('input.fr-in#fr-n-date', { type: 'date', value: N.date, min: ymd(new Date()), dataset: { fk: 'night-date' }, oninput: e => { N.date = e.target.value; } })),
      field('Time', 'fr-n-time', h('input.fr-in#fr-n-time', { type: 'time', value: N.time, step: '60', dataset: { fk: 'night-time' }, oninput: e => { N.time = e.target.value; } })),
      field('For', 'fr-n-len', h('select.select#fr-n-len', { dataset: { fk: 'night-len' }, onchange: e => { N.len = Number(e.target.value); } },
        LENGTHS.map(m => h('option', { value: String(m), selected: N.len === m, text: LENGTH_TEXT[m] }))))),
    field('Name (optional)', 'fr-n-title', h('div.field', h('input#fr-n-title', { value: N.title, maxlength: String(F.TITLE_MAX), placeholder: 'Friday chess', dataset: { fk: 'night-title' }, autocomplete: 'off', oninput: e => { N.title = e.target.value; } }))),
    F.groups().length ? field('Invite a group', 'fr-n-group', h('select.select#fr-n-group', { dataset: { fk: 'night-group' }, onchange: e => {
      const g = F.groups().find(x => x.id === e.target.value);
      if (g) { g.members.forEach(fp => N.invite.add(fp)); paint(); }
    } }, h('option', { value: '', text: 'Pick a group to tick its friends…' }), F.groups().map(g => h('option', { value: g.id, text: g.name })))) : null,
    h('label.fr-check', h('input', { type: 'checkbox', checked: !!N.weekly, dataset: { fk: 'night-weekly' }, onchange: e => { N.weekly = e.target.checked; } }),
      h('span', { text: 'Repeat every week (you can skip a week)' })),
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
    const ch = gameChoices();
    const recent = ch.recent.find(x => x.value === N.game) || ch.anime.find(x => x.value === N.game);
    const r = await F.createNight({ title: N.title, game: { kind, id, title: recent ? recent.title : null }, at, len: N.len, invite: [...N.invite], weekly: !!N.weekly });
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
    const anime = n.game.kind === 'anime';
    const thumbIc = anime ? 'star' : n.game.kind === 'arcade' && arcadeById(n.game.id) ? arcadeById(n.game.id).icon : 'gamepad';
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
    if (n.canJoin && anime) {
      /* nothing to start: everyone watches on their own official service, at the same time */
      acts.push(btn('Open title', 'star', () => F.joinNight(n.id), { primary: true, act: 'join', tip: 'Open this title in Static Anime, with links to the official services' }));
    } else if (n.canJoin) {
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
    if (n.host && n.weekly && open) acts.push(btn('Skip this week', 'skip-forward', () => { F.skipNight(n.id); say('Skipped this week. The next one is a week later.'); paint(); }, { ghost: true, act: 'skip', tip: 'Leave out the next turn and tell the friends invited' }));
    if (open) acts.push(btn(n.calendar ? 'In Calendar' : 'Add to Calendar', 'calendar', () => doCalendar(n), { ghost: true, act: 'cal', disabled: n.calendar, tip: n.weekly ? 'Puts it in Calendar, repeating every week' : 'Puts it in Calendar' }));
    if (n.host && open) acts.push(btn(n.weekly ? 'Cancel every week' : 'Cancel night', 'x', () => doCancelNight(n), { ghost: true, act: 'cancel' }));
    if (!open) acts.push(btn('Remove', 'trash', () => { F.removeNight(n.id); paint(); }, { ghost: true, act: 'remove' }));
    const pending = !n.host && n.mine && !n.confirmed && open ? fine(`Your answer reaches ${n.hostName} when you’re both online.`) : null;
    const waitJoin = n.canJoin && !anime && !n.host && !n.party && !n.room ? fine(`Join opens when ${n.hostName} starts the ${n.via}.`) : null;
    return h('article.fr-night', { dataset: { id: n.id, state: n.state }, tabindex: '-1', 'aria-label': `${n.name}, ${when}, ${stateText}` },
      h('div.fr-night__top',
        h('span.fr-night__ic', { 'aria-hidden': 'true' }, ic(thumbIc)),
        h('div.fr-row__b',
          h('b', { text: n.name }),
          h('small', { text: `${n.game.title || (anime ? 'An anime that isn’t in this StaticOS’s catalogue' : 'A game that isn’t on this StaticOS')} · ${when} · ${n.len} min` }),
          anime ? h('small', { text: 'Everyone watches on their own service, at the same time. Static plays nothing.' }) : null,
          h('small', { text: n.host ? 'You’re hosting' : `Hosted by ${n.hostName}` }),
          n.weekly ? h('small.fr-night__wk', { text: n.skipped ? `Every week · skipped ${F.whenText(n.skipped)}` : 'Every week' }) : null),
        h('span.chip.fr-night__state', { class: n.state === 'live' || n.state === 'soon' ? 'chip--accent' : null, text: stateText })),
      h('p.fr-night__who', { text: whoLine(n) }),
      acts.length ? h('div.fr-line.fr-night__acts', acts) : null,
      waitJoin, pending);
  }
  async function doCalendar(n) {
    const r = await F.addNightToCalendar(n.id);
    if (S.dead) return;
    say(r.ok ? (r.already ? 'Already in Calendar' : 'Added to Calendar') : 'Could not add it to Calendar');
    if (r.ok && !r.already) api.notify({ app: 'social', icon: 'calendar', title: 'Added to Calendar', message: `${n.name}${n.weekly ? ', every week' : ''}`, timeout: 4000, actions: api.getApp('calendar') ? [{ label: 'Open', onClick: () => api.openApp('calendar') }] : [] });
    paint();
  }
  const canOpenGame = g => (g.kind === 'anime' ? false : g.kind === 'arcade' ? !!arcadeById(g.id) && !!api.getApp('arcade') : !!api.getApp('aether-games'));
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
          btn('Copy invite message', 'message-circle', () => code && copy(F.inviteMessage(code), 'Invite message'), { fk: 'copy-invite', disabled: !code, tip: 'A message with your code, how to add it, and a reminder to share it only with people you know' }),
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
  const offs = [F.onChange(() => { if (S.shown) refresh(); else if (F.started()) count(F.friends(), F.incoming()); }), SR.onChange(() => { if (S.shown) refresh(); })];
  const tick = setInterval(refresh, 15_000);
  const studyTick = setInterval(() => { if (S.shown && SR.current()) refresh(); }, 1000);

  function show(opts = {}) {
    S.shown = true;
    if (opts && typeof opts.friend === 'string') {
      const c = F.normCode(opts.friend);
      if (F.isCode(c)) { S.add = F.spaced(c); S.addNote = { text: `Code ${F.spaced(c)} is filled in from the link. Press Send request if you want to add them.` }; }
    }
    if (opts && typeof opts.night === 'string' && /^[a-z0-9]{12}$/.test(opts.night)) S.focusNight = opts.night;
    /* from a title's page in Static Anime: open the night form with that title picked */
    if (opts && opts.animeNight && /^[0-9]{1,9}$/.test(String(opts.animeNight.id || ''))) {
      S.animePick = { id: String(opts.animeNight.id), title: F.cleanLine(opts.animeNight.title, 80) || `Anime ${opts.animeNight.id}` };
      openNightForm();      /* the form itself appears once there are friends to invite */
    }
    paint();
    if (F.available()) F.ensureCode().then(refresh).catch(refresh);
    if (opts && opts.friend) requestAnimationFrame(() => body.querySelector('[data-fk="add-send"]')?.focus({ preventScroll: false }));
  }
  function hide() { S.shown = false; }
  function destroy() {
    S.dead = true;
    clearInterval(tick);
    clearInterval(studyTick);
    offs.forEach(off => { try { off(); } catch (e) { /* gone */ } });
  }
  /* the rail badge counts before the view is shown — but only when Friends
     is already running here: opening Social alone never starts it */
  if (F.started()) F.ready().then(() => count(F.friends(), F.incoming())).catch(() => {});
  return { el, show, hide, destroy, focus: () => body.focus({ preventScroll: true }) };
}

export default friendsView;
