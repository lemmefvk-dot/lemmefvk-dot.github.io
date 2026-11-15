/* ============================================================
   profile.js — your profile (sections 17 + 42).

   Who you are on this device: a picture, a display name, a short
   bio, your top games, your creations, collections, activity and
   achievements. Everything shown is this device's real data, and
   all of it is saved on this device only.

   · Picture  — pick one of StaticOS's built-in avatars, or upload
     an image and crop it to a square (it is re-encoded at 256×256;
     the original file is never kept). core/avatar.js draws it.
   · Costume  — a witch hat, vampire cape or ghost sheet drawn over
     the picture. Available all year; while Halloween season is on
     (the dates live in core/season.js, nowhere else) the costume row
     is highlighted.
   · Name     — the same name Static Social and Party show
     (core/identity.js), so there is one name, not two. Names are
     not verified by anyone, and the field says so.
   · Top games — core/plays.js: games launched on this device, the
     most-launched first. A count is shown only where it was really
     counted; older history shows when it was last played instead.
   · Creations — game projects from Forge, Studio and remixes
     (core/projects.js), each with Share link (shell/share.js →
     core/sharelink.js) and a pin. Pictures and sprites are the Art
     strip below.
   · Art — your newest Paint drawings (~/Pictures, "Static Paint …")
     and Asset Lab sprites. Local only; never part of the card.
   · Pins — up to 3 achievements and 3 creations, kept in the
     profile and shown first.
   · Status line — the status Social shows friends beside your name
     (core/friends.js setStatus), set here too.
   · Birthday — the same month-and-day Settings › Celebrations keeps
     (prefs.birthday). It is never part of the card or sent anywhere.
   · Profile card — what friends can see of you, over core/friends.js:
     off until you press Send. You tick what goes in it (bio, top
     games, pinned achievements, pinned creations — titles only), the
     preview shows exactly that, and Take it back asks friends'
     devices to delete it. "Save as picture" draws the same card as a
     PNG. Friends' cards show under From friends.
   · Achievements are read defensively: if the achievements module
     is missing, changed or throws, the section is simply left out.

   Followers and other people's profiles need accounts on a server,
   which StaticOS doesn't have — the page says that plainly.

   Store: portal.profile = { bio, picture, costume, pinAch:[names],
   pinCre:[project ids], cardFields:{ bio, games, ach, cre }, cardSent:{ at, n } }
   (see core/avatar.js)
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as Avatar from '../core/avatar.js';
import * as Identity from '../core/identity.js';
import { launchItem } from '../core/launch.js';
import * as SEASON from '../core/season.js';
import { arcadeById } from '../arcade/index.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-profile-css')) {
  const l = document.createElement('link');
  l.id = 'feat-profile-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-profile.css';
  document.head.appendChild(l);
}

const KEY = Avatar.KEY;          /* portal.profile = { bio, picture, costume } */
const MAX_FILE = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const CROP = 240;                /* crop viewport, CSS px */
const OUT = 256;                 /* saved picture, px */

const MAX_PINS = 3;
const ART_MAX = 10;
const CARD_PICKS = [
  ['bio', 'My bio'], ['games', 'My top 3 games'], ['ach', 'My pinned achievements'], ['cre', 'My pinned creations'],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const KIND_LABEL = { web: 'Static Games', arcade: 'Static Arcade', creation: 'Your creation' };

defineApp({
  id: 'profile',
  name: 'Profile',
  icon: 'user',
  g1: '#a78bfa', g2: '#5b21b6',
  category: 'Create',
  keywords: ['profile', 'creator', 'me', 'avatar', 'picture', 'photo', 'costume', 'halloween', 'my games', 'top games', 'creations', 'published', 'bio', 'name'],
  desc: 'Your picture, name, top games, creations and achievements',
  singleton: true,
  win: { w: 780, h: 660, minW: 400, minH: 460 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, clear, store, bus, fmt } = api;
    let dead = false;
    let sheet = null;               /* the picture editor, when open */
    let offF = null;                /* friends.js onChange, for the cards friends send */
    let lastCards = '';
    let pending = false;            /* a repaint waiting for typing to end */
    const body = h('div.pf__body');
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const appEl = h('div.app.app--col.pf', body, live);
    root.appendChild(appEl);
    const say = t => { live.textContent = ''; setTimeout(() => { if (!dead) live.textContent = t; }, 40); };

    let pinMsg = '';                /* "you can pin up to 3…", until the next change */
    let cardMsg = '';               /* what the last Send / Take back did */
    let cardCtx = { bio: '', games: [], ach: [], cre: [], friends: 0 };   /* what a card would hold right now */
    const prof = () => { const v = store.get(KEY, {}); return v && typeof v === 'object' ? v : {}; };
    const saveProf = patch => store.set(KEY, { ...prof(), ...patch });
    const who = () => store.get('session.user', null);
    const myName = () => {
      const v = store.get('portal.identity', null);
      return (v && typeof v.name === 'string' && v.name) || '';
    };
    const shownName = () => myName() || (who() && (who().name || who().username)) || '';
    const initial = () => (shownName() || Identity.me().name || '?').trim().charAt(0).toUpperCase();
    const thumbs = () => store.get('portal.forge.thumbs', {}) || {};
    const ago = ms => (Number.isFinite(Number(ms)) && ms > 0 ? fmt.fmtAgo(new Date(Number(ms)).toISOString()) : '');

    /* ------------------------------------------------------------------ */
    /*  pins                                                               */
    /* ------------------------------------------------------------------ */
    const pinList = k => { const a = prof()[k]; return Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, MAX_PINS) : []; };
    function togglePin(kind, key, label) {
      const k = kind === 'ach' ? 'pinAch' : 'pinCre';
      const cur = pinList(k);
      const has = cur.includes(key);
      if (!has && cur.length >= MAX_PINS) {
        pinMsg = `You can pin up to ${MAX_PINS} ${kind === 'ach' ? 'achievements' : 'creations'}. Unpin one first.`;
        say(pinMsg);
        paint();
        return;
      }
      pinMsg = '';
      saveProf({ [k]: has ? cur.filter(x => x !== key) : [...cur, key] });
      say(has ? `Unpinned ${label}.` : `Pinned ${label}.`);
    }
    const pinBtn = (on, label, onclick, fk) => h('button.ibtn.pf__pin', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', class: on ? 'is-on' : '', title: on ? 'Unpin' : 'Pin to the top of your profile',
      'aria-label': `${on ? 'Unpin' : 'Pin'} ${label}`, dataset: { fk }, onclick,
    }, icon('pin'));

    /* ------------------------------------------------------------------ */
    /*  art strip: Paint drawings and Asset Lab sprites                    */
    /* ------------------------------------------------------------------ */
    async function readArt() {
      const out = [];
      try {
        const vfs = (await import('../core/vfs.js')).default;
        const media = (await import('../core/media.js')).default;
        const dir = `${vfs.HOME}/Pictures`;
        for (const n of vfs.ls(dir, { sort: 'mtime' })) {
          if (n.type !== 'file' || !/^Static Paint .*\.png$/i.test(n.name)) continue;
          const path = `${dir}/${n.name}`;
          const src = await media.urlOf(path);
          if (src) out.push({ kind: 'paint', name: n.name.replace(/^Static Paint /i, '').replace(/\.png$/i, ''), at: Date.parse(n.mtime) || 0, src, path });
          if (out.length >= ART_MAX) break;
        }
      } catch (e) { /* no Pictures folder, or no media: the strip just has fewer */ }
      try {
        const DB = await import('../core/db.js');
        for (const v of await DB.kv('assets').all()) {
          if (v && v.app === 'assetlab' && v.kind === 'sprite' && typeof v.png === 'string' && v.png.length < 400000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.png)) {
            out.push({ kind: 'sprite', name: String(v.name || 'sprite').slice(0, 40), at: Number(v.updatedAt || v.createdAt) || 0, src: v.png });
          }
        }
      } catch (e) { /* no library */ }
      return out.sort((a, b) => b.at - a.at).slice(0, ART_MAX);
    }
    function artSection(art) {
      if (!art.length) return null;
      return h('section.pf__sec.pf__art',
        h('div.pf__caprow', h('div.pf__cap', { text: 'Art' }), h('small.pf__capnote', { text: 'Your newest Paint drawings and Asset Lab sprites · stays on this device, never in your card' })),
        h('div.pf__artstrip', { role: 'list', 'aria-label': 'Your art' }, art.map((a, i) => {
          const where = a.kind === 'paint' ? 'Paint' : 'Asset Lab';
          return h('button.pf__arttile', {
            type: 'button', role: 'listitem', title: `${a.name} · ${where}`, 'aria-label': `Open ${a.name} from ${where}`,
            dataset: { fk: `art:${i}`, art: a.kind },
            onclick: () => (a.kind === 'paint' ? api.openFile(a.path) : api.openApp('assetlab', { tab: 'library' })),
          },
          h('img', { src: a.src, alt: '', loading: 'lazy', class: a.kind === 'sprite' ? 'is-pixel' : '' }),
          h('span', { text: where }));
        })));
    }

    /* ------------------------------------------------------------------ */
    /*  status line and birthday                                           */
    /* ------------------------------------------------------------------ */
    function statusSection(F) {
      const cap = h('div.pf__caprow', h('div.pf__cap', { text: 'Status' }), h('small.pf__capnote', { text: 'The line friends see next to your name in Social' }));
      if (!F || !F.available()) {
        return h('div.pf__stat', cap, h('div.pf__empty', { text: 'Friends and their status need a signed-in account on this device — a guest doesn’t have them.' }));
      }
      const st = F.myStatus();
      const input = h('input.pf__statusin', { type: 'text', maxlength: '60', placeholder: 'What are you up to?', 'aria-label': 'Status line for friends', autocomplete: 'off', spellcheck: 'false', dataset: { fk: 'status' } });
      input.value = st ? st.text : '';
      const exp = h('select.select.pf__statusexp', { 'aria-label': 'Clear the status after', dataset: { fk: 'status-exp' } },
        F.EXPIRY.map(x => h('option', { value: x.id, text: x.id === 'never' ? 'Keep it' : `Clear after: ${x.label}`, selected: (st ? st.expiry : 'never') === x.id ? true : null })));
      const set = () => {
        const t = Identity.tidy(input.value, 60);
        if (!t) { F.clearStatus(); say('Status cleared.'); }
        else { F.setStatus({ text: t, emoji: st ? st.emoji : '', preset: null, expiry: exp.value }); say(`Status set: ${t}`); }
        pending = false;
        paint();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); set(); } });
      return h('div.pf__stat', cap,
        h('div.pf__statrow', input, exp,
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'status-set' }, onclick: set }, icon('check'), h('span', { text: 'Set' })),
          st ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'status-clear' }, onclick: () => { input.value = ''; set(); } }, h('span', { text: 'Clear' })) : null),
        st ? h('small.pf__capnote', { text: `Friends who are online see “${st.emoji ? `${st.emoji} ` : ''}${st.text}”${st.until ? ` until ${new Date(st.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.` }) : null);
    }
    function birthdaySection() {
      const bd = SEASON.parseBirthday(store.get('prefs.birthday', ''));
      let m = bd ? bd[0] : 0, d = bd ? bd[1] : 0;
      const days = () => (m ? new Date(2024, m, 0).getDate() : 31);
      const mon = h('select.select', { 'aria-label': 'Birthday month', dataset: { fk: 'bd-month' } },
        h('option', { value: '0', text: 'Month' }), MONTHS.map((n, i) => h('option', { value: String(i + 1), text: n, selected: m === i + 1 ? true : null })));
      const day = h('select.select', { 'aria-label': 'Birthday day', dataset: { fk: 'bd-day' } });
      const fill = () => {
        clear(day);
        day.append(h('option', { value: '0', text: 'Day' }), ...Array.from({ length: days() }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: d === i + 1 ? true : null })));
      };
      fill();
      const save = () => {
        const pad2 = n => String(n).padStart(2, '0');
        if (m && d) { store.set('prefs.birthday', `${pad2(m)}-${pad2(d)}`); say(`Birthday saved: ${MONTHS[m - 1]} ${d}.`); }
        else if (!m && !d) store.set('prefs.birthday', '');
      };
      mon.addEventListener('change', () => { m = Number(mon.value); if (d > days()) d = days(); fill(); save(); });
      day.addEventListener('change', () => { d = Number(day.value); save(); });
      return h('div.pf__bd',
        h('div.pf__caprow', h('div.pf__cap', { text: 'Birthday' }),
          h('small.pf__capnote', { text: 'Month and day only. The same one as Settings › Celebrations. Kept on this device — never in your card, never sent to friends.' })),
        h('div.pf__statrow', mon, day,
          bd ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'bd-clear' }, onclick: () => { m = 0; d = 0; store.set('prefs.birthday', ''); say('Birthday forgotten.'); } }, icon('rotate-ccw'), h('span', { text: 'Forget it' })) : null));
    }

    /* ------------------------------------------------------------------ */
    /*  pinned                                                             */
    /* ------------------------------------------------------------------ */
    function pinnedSection(ach, projects) {
      const pa = pinList('pinAch').map(n => (ach || []).find(x => x.name === n)).filter(Boolean);
      const pc = pinList('pinCre').map(id => projects.find(x => x.id === id)).filter(Boolean);
      if (!pa.length && !pc.length) return null;
      return h('section.pf__sec.pf__pinned',
        h('div.pf__caprow', h('div.pf__cap', { text: 'Pinned' }), h('small.pf__capnote', { text: `Up to ${MAX_PINS} achievements and ${MAX_PINS} creations` })),
        h('div.pf__chips',
          pa.map(x => h('span.pf__chip.pf__chip--ach', { title: x.desc, dataset: { pinned: 'ach' } }, icon(x.icon), h('span', { text: x.name }))),
          pc.map(x => h('button.pf__chip', { type: 'button', dataset: { pinned: 'cre' }, onclick: () => api.openApp('forge', { project: x.id }) }, icon('sparkles'), h('span', { text: x.published?.title || x.name })))));
    }

    /* ------------------------------------------------------------------ */
    /*  the profile card: what friends can see, and the picture of it      */
    /* ------------------------------------------------------------------ */
    const cardFields = () => { const f = prof().cardFields || {}; return { bio: !!f.bio, games: !!f.games, ach: !!f.ach, cre: !!f.cre }; };
    /** exactly what a card would hold, from the ticks — nothing else is ever put in it */
    function cardNow() {
      const f = cardFields();
      return { bio: f.bio ? cardCtx.bio : '', games: f.games ? cardCtx.games : [], ach: f.ach ? cardCtx.ach : [], cre: f.cre ? cardCtx.cre : [] };
    }
    const cardEmpty = c => !c.bio && !c.games.length && !c.ach.length && !c.cre.length;
    function cardLines(c) {
      return [
        c.bio ? ['Bio', [c.bio]] : null,
        c.games.length ? ['Top games', c.games] : null,
        c.ach.length ? ['Achievements', c.ach] : null,
        c.cre.length ? ['Creations', c.cre] : null,
      ].filter(Boolean);
    }
    async function sendMyCard(F) {
      const card = cardNow();
      if (cardEmpty(card)) return;
      const r = await F.sendCard(card);
      if (dead) return;
      if (r.unavailable) cardMsg = 'Friends aren’t available here.';
      else if (!r.total) cardMsg = 'You don’t have any friends to send it to yet. Add one in Static Social › Friends.';
      else if (!r.sent) cardMsg = 'The live channel isn’t connected right now, so nothing was sent. Try again in a moment.';
      else {
        cardMsg = `Sent to ${r.sent} of ${r.total} friend${r.total === 1 ? '' : 's'}. A friend who isn’t online right now won’t get it — send it again later.`;
        saveProf({ cardSent: { at: Date.now(), n: r.sent } });
      }
      say(cardMsg);
      paint();
    }
    async function takeBack(F) {
      const r = await F.withdrawCard();
      if (dead) return;
      cardMsg = r.sent ? `Asked ${r.sent} friend${r.sent === 1 ? '' : 's'}’ devices to delete your card.` : 'There was nobody to ask.';
      saveProf({ cardSent: null });
      say(cardMsg);
      paint();
    }
    function cardSection(F) {
      const f = cardFields();
      const card = cardNow();
      const avail = !!F && F.available();
      const sent = prof().cardSent;
      const have = { bio: !!cardCtx.bio, games: cardCtx.games.length > 0, ach: cardCtx.ach.length > 0, cre: cardCtx.cre.length > 0 };
      const picks = h('div.pf__picks', { role: 'group', 'aria-label': 'What goes in your card' },
        CARD_PICKS.map(([k, label]) => h('label.pf__pickrow',
          h('input', { type: 'checkbox', checked: f[k] ? true : null, dataset: { fk: `card-${k}`, card: k },
            onchange: e => { saveProf({ cardFields: { ...cardFields(), [k]: e.target.checked } }); } }),
          h('span', { text: label }),
          f[k] && !have[k] ? h('small.dim', { text: k === 'bio' ? ' — write a bio first' : k === 'games' ? ' — play a game first' : k === 'ach' ? ' — pin an achievement first' : ' — pin a creation first' }) : null)));
      const lines = cardLines(card);
      const preview = h('div.pf__cardprev', { 'aria-label': 'What friends will see', role: 'group' },
        h('div.pf__cardprev__h', Avatar.avatarEl(h, { initial: initial(), size: 36 }), h('b', { text: shownName() || Identity.me().name })),
        lines.length ? lines.map(([k, vals]) => h('div.pf__cardline', h('span.pf__cardk', { text: k }), h('span', { text: vals.join(' · ') })))
          : h('small.dim', { text: 'Nothing ticked yet — tick what you want in it.' }));
      return h('section.pf__sec.pf__share',
        h('div.pf__caprow', h('div.pf__cap', { text: 'Your profile card' }), h('small.pf__capnote', { text: 'Off until you press Send' })),
        h('p.pf__note', { text: 'Nothing here goes to friends on its own. Tick what you want in your card, check the preview, then send it. Friends get exactly the preview, as text, over the same private channel as their friend list — your picture and name they already see. You can take it back, and Save as picture makes a PNG of the same card for anywhere else.' }),
        picks, preview,
        h('div.pf__cardbtns',
          avail ? h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: cardEmpty(card) || !cardCtx.friends ? true : null, dataset: { fk: 'card-send' }, onclick: () => sendMyCard(F) }, icon('send'), h('span', { text: cardCtx.friends ? `Send to ${cardCtx.friends} friend${cardCtx.friends === 1 ? '' : 's'}` : 'Send (no friends yet)' })) : null,
          avail && sent ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'card-back' }, onclick: () => takeBack(F) }, icon('x-circle'), h('span', { text: 'Take it back' })) : null,
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'card-png' }, onclick: () => exportCard() }, icon('image'), h('span', { text: 'Save as picture' }))),
        !avail ? h('small.pf__capnote', { text: 'Sending needs friends, which a guest doesn’t have. You can still save the card as a picture.' }) : null,
        sent ? h('small.pf__capnote', { text: `Last sent ${ago(sent.at)} to ${sent.n} friend${sent.n === 1 ? '' : 's'}. Changing the ticks doesn’t change what they have until you send again.` }) : null,
        cardMsg ? h('div.pf__cardmsg', { role: 'status', text: cardMsg }) : null);
    }
    function fromFriends(F) {
      const list = F ? F.cards() : [];
      if (!list.length) return null;
      return h('section.pf__sec.pf__fromfr',
        h('div.pf__caprow', h('div.pf__cap', { text: 'From friends' }), h('small.pf__capnote', { text: 'Cards friends chose to send you' })),
        h('div.pf__fr', list.map(x => h('div.pf__frcard', { dataset: { fp: x.fp } },
          Avatar.avatarEl(h, { picture: x.picture, costume: x.costume, initial: x.display.charAt(0).toUpperCase() || '?', size: 40 }),
          h('div.pf__frbody', h('b', { text: x.display }),
            cardLines(x.card).map(([k, vals]) => h('div.pf__cardline', h('span.pf__cardk', { text: k }), h('span', { text: vals.join(' · ') }))),
            h('small.dim', { text: `Sent ${ago(x.card.at)}` }))))));
    }
    /** the card as a PNG — the same picks as the preview, drawn on a canvas */
    async function exportCard() {
      const card = cardNow();
      const name = shownName() || Identity.me().name;
      const W = 800, pad = 44, S = 2;
      const font = (w, px) => `${w} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      const scratch = document.createElement('canvas').getContext('2d');
      const wrap = (txt, px, w, maxW) => { scratch.font = font(w, px); const out = []; let line = ''; for (const word of String(txt).split(/\s+/)) { const t = line ? `${line} ${word}` : word; if (scratch.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t; } if (line) out.push(line); return out; };
      /* lay out first, so the picture is as tall as its content */
      const ops = [];
      let y = pad + 120;
      for (const [label, vals] of cardLines(card)) {
        ops.push({ t: 'label', text: label.toUpperCase(), y: y + 12 });
        y += 30;
        if (label === 'Bio') {
          for (const ln of wrap(vals[0], 20, 400, W - pad * 2)) { ops.push({ t: 'text', text: ln, y: y + 20 }); y += 28; }
          y += 16;
        } else {
          let x = pad, row = 0;
          for (const v of vals) {
            scratch.font = font(600, 17);
            const w = Math.min(W - pad * 2, Math.ceil(scratch.measureText(v).width) + 28);
            if (x + w > W - pad && x > pad) { x = pad; row++; }
            ops.push({ t: 'chip', text: v, x, y: y + row * 42, w });
            x += w + 10;
          }
          y += (row + 1) * 42 + 14;
        }
      }
      const H = Math.max(y + 56, 300);
      const cv = document.createElement('canvas');
      cv.width = W * S; cv.height = H * S;
      const g = cv.getContext('2d');
      g.scale(S, S);
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#2a1a4d'); bg.addColorStop(1, '#120a22');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const rr = (x, yy, w, h2, r) => { g.beginPath(); g.moveTo(x + r, yy); g.arcTo(x + w, yy, x + w, yy + h2, r); g.arcTo(x + w, yy + h2, x, yy + h2, r); g.arcTo(x, yy + h2, x, yy, r); g.arcTo(x, yy, x + w, yy, r); g.closePath(); };
      const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
      /* the picture, as the profile shows it (initial on a disc when there is none) */
      const { picture, costume } = Avatar.read();
      g.save(); rr(pad, pad, 96, 96, 26); g.clip();
      let drew = false;
      try {
        if (picture && picture.kind === 'upload') { g.drawImage(await loadImg(picture.dataUrl), pad, pad, 96, 96); drew = true; }
        else if (picture && picture.kind === 'builtin') { g.drawImage(await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(Avatar.builtinSvg(picture.id))}`), pad, pad, 96, 96); drew = true; }
      } catch (e) { drew = false; }
      if (!drew) { g.fillStyle = '#6d4cc4'; g.fillRect(pad, pad, 96, 96); g.fillStyle = '#fff'; g.font = font(700, 48); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initial(), pad + 48, pad + 52); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; }
      g.restore();
      try {
        const c = Avatar.COSTUMES.find(x => x.id === costume);
        if (c && drew) g.drawImage(await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`), pad, pad, 96, 96);
      } catch (e) { /* a costume that won't draw is left off */ }
      g.fillStyle = '#fff'; g.font = font(750, 34); g.fillText(name.length > 26 ? `${name.slice(0, 25)}…` : name, pad + 120, pad + 52);
      g.fillStyle = 'rgba(255,255,255,.62)'; g.font = font(500, 16); g.fillText('StaticOS profile card', pad + 120, pad + 80);
      for (const o of ops) {
        if (o.t === 'label') { g.fillStyle = 'rgba(255,255,255,.5)'; g.font = font(700, 12); g.fillText(o.text, pad, o.y); }
        else if (o.t === 'text') { g.fillStyle = 'rgba(255,255,255,.9)'; g.font = font(400, 20); g.fillText(o.text, pad, o.y); }
        else { g.fillStyle = 'rgba(167,139,250,.22)'; rr(o.x, o.y, o.w, 32, 16); g.fill(); g.strokeStyle = 'rgba(167,139,250,.5)'; g.lineWidth = 1; g.stroke(); g.fillStyle = '#fff'; g.font = font(600, 17); g.fillText(o.text, o.x + 14, o.y + 21, o.w - 20); }
      }
      g.fillStyle = 'rgba(255,255,255,.4)'; g.font = font(500, 13);
      g.fillText(`Made on ${new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })} on this device`, pad, H - 24);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (!blob || dead) { say('The picture couldn’t be made.'); return; }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'My'} profile card.png` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      say('Saved your card as a picture.');
    }

    /* ------------------------------------------------------------------ */
    /*  creations                                                          */
    /* ------------------------------------------------------------------ */
    function creationTile(p) {
      const t = p.published?.thumbnail || thumbs()[p.id];
      const title = p.published?.title || p.name;
      const src = p.source === 'studio' ? 'Studio' : p.source === 'remix' ? 'Remix' : 'Forge';
      const meta = [src, p.published ? 'Published' : `${p.versions.length} version${p.versions.length === 1 ? '' : 's'}`].join(' · ');
      return h('div.pf__game', { dataset: { project: p.id } },
        h('button.pf__gopen', { type: 'button', onclick: () => api.openApp('forge', { project: p.id }), 'aria-label': `Open ${title}` },
          h('div.pf__thumb', t ? { style: { backgroundImage: `url("${String(t).replace(/"/g, '\\"')}")` } } : null, t ? null : icon('sparkles')),
          h('div.pf__gt', { text: title }),
          h('div.pf__gm', { text: meta })),
        h('button.ibtn.pf__gshare', {
          type: 'button', title: 'Share link', 'aria-label': `Share link for ${title}`, dataset: { fk: `share:${p.id}` },
          onclick: () => bus.emit('share:open', { kind: 'creation', id: p.id, title, art: t || null }),
        }, icon('link')),
        h('span.pf__gpin', pinBtn(pinList('pinCre').includes(p.id), title, () => togglePin('cre', p.id, title), `pincre:${p.id}`)));
    }

    /* ------------------------------------------------------------------ */
    /*  top games — real launches on this device                           */
    /* ------------------------------------------------------------------ */
    function topGames(plays) {
      const list = typeof plays.top === 'function' ? plays.top(6) : plays.recent(6).map(r => ({ ...r, plays: null }));
      const since = typeof plays.countedSince === 'function' ? plays.countedSince() : null;
      const cap = h('div.pf__caprow', h('div.pf__cap', { text: 'Your top games' }),
        h('small.pf__capnote', { text: `From your play history on this device${since ? ` · launches counted since ${new Date(since).toLocaleDateString()}` : ''}` }));
      if (!list.length) {
        return h('section.pf__sec.pf__top', cap,
          h('div.pf__empty', h('span', { text: 'Nothing played on this device yet. Games you play in Static Play, the Arcade or Forge show up here.' }),
            api.getApp('play') ? h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('play') }, icon('gamepad'), 'Open Static Play') : null));
      }
      return h('section.pf__sec.pf__top', cap,
        h('ol.pf__tops', list.map((g, i) => {
          const ag = g.kind === 'arcade' ? arcadeById(g.id) : null;
          const art = typeof g.art === 'string' && /^(https:|data:image\/)/.test(g.art) ? g.art : null;
          const sub = g.plays ? `${g.plays} ${g.plays === 1 ? 'launch' : 'launches'} · last ${ago(g.at)}` : `Last played ${ago(g.at)}`;
          return h('li', h('button.pf__topb', {
            type: 'button', 'aria-label': `Play ${g.title}, ${sub}`, dataset: { fk: `top:${g.kind}:${g.id}` },
            onclick: () => launchItem({ kind: g.kind, id: g.id }),
          },
            h('span.pf__rank', { text: String(i + 1), 'aria-hidden': 'true' }),
            h('span.pf__topart', { class: ag ? 'is-hue' : '', style: ag ? { '--hue': String(ag.hue) } : null },
              art ? h('img', { src: art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : icon(ag ? ag.icon : g.kind === 'creation' ? 'sparkles' : 'gamepad')),
            h('span.pf__topt', h('b', { text: g.title }), h('small', { text: `${KIND_LABEL[g.kind] || 'Game'} · ${sub}` }))));
        })));
    }

    /* ------------------------------------------------------------------ */
    /*  activity                                                           */
    /* ------------------------------------------------------------------ */
    function activity(projects, cols, ach, plays) {
      const ev = [];
      const push = (at, ic, text, open) => { if (at) ev.push({ at: Number(at), ic, text, open }); };
      for (const p of projects) {
        const title = p.published?.title || p.name;
        const open = () => api.openApp('forge', { project: p.id });
        push(p.createdAt, p.source === 'remix' ? 'git-branch' : 'sparkles', p.source === 'remix' ? `You remixed a game into “${title}”` : `You started “${title}”`, open);
        (p.versions || []).slice(1).forEach(v => {
          if (v.by === 'ai') push(v.at, 'sparkles', `AI changed “${title}”${v.note ? `: ${String(v.note).slice(0, 80)}` : ''}`, open);
          else if (v.by === 'you') push(v.at, 'edit-3', `You edited “${title}”`, open);
        });
        (p.published?.updates || []).forEach(u => push(u.at, 'upload', `${u.note === 'First release' ? 'Published' : 'Updated'} “${title}”`, open));
      }
      cols.forEach(c => push(c.createdAt, 'bookmark', `You made the collection “${c.name}”`, () => api.openApp('aether-library')));
      (ach || []).filter(a => a.at).forEach(a => push(a.at, a.icon || 'star', `Unlocked “${a.name}”`, () => api.openApp('aether-library')));
      plays.recent(12).forEach(r => push(r.at, 'play', `Played ${r.title}`, null));
      ev.sort((a, b) => b.at - a.at);
      const list = ev.slice(0, 14);
      if (!list.length) return null;
      return h('section.pf__sec',
        h('div.pf__cap', { text: 'Activity on this device' }),
        h('ol.pf__feed', list.map(e => h('li',
          h('span.pf__feedic', icon(e.ic)),
          e.open ? h('button.pf__feedt', { type: 'button', onclick: e.open, text: e.text }) : h('span.pf__feedt', { text: e.text }),
          h('time', { dateTime: new Date(e.at).toISOString(), text: fmt.fmtAgo(new Date(e.at).toISOString()) })))));
    }

    /** Another team owns achievements; read whatever is there, never trust its shape. */
    async function readAchievements(plays) {
      try {
        const A = await import('../core/achievements.js');
        if (!A || typeof A.list !== 'function') return null;
        const all = A.list({ distinct: plays.count(), total: plays.total() });
        if (!Array.isArray(all)) return null;
        return all.filter(a => a && typeof a === 'object' && a.unlocked && typeof a.name === 'string')
          .map(a => ({ name: a.name.slice(0, 60), desc: typeof a.desc === 'string' ? a.desc : '', icon: typeof a.icon === 'string' ? a.icon : 'star', at: Number(a.at) || null }));
      } catch (e) { return null; }
    }

    /* ------------------------------------------------------------------ */
    /*  costume row                                                        */
    /* ------------------------------------------------------------------ */
    function costumes(pic, season) {
      const cur = Avatar.normCostume(prof().costume);
      const opts = [{ id: 'none', name: 'No costume' }, ...Avatar.COSTUMES];
      const row = h('div.pf__cos', { role: 'radiogroup', 'aria-label': 'Costume' },
        opts.map(o => h('button.pf__cosb', {
          type: 'button', role: 'radio', 'aria-checked': cur === o.id ? 'true' : 'false',
          class: cur === o.id ? 'is-on' : '', dataset: { fk: `cos:${o.id}`, costume: o.id },
          onclick: () => setCostume(o.id),
          onkeydown: e => {
            const i = opts.findIndex(x => x.id === o.id);
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (d) { e.preventDefault(); setCostume(opts[(i + d + opts.length) % opts.length].id); }
          },
        },
          Avatar.avatarEl(h, { picture: pic, costume: o.id, initial: initial(), size: 40 }),
          h('span', { text: o.name }))));
      return h('section.pf__sec.pf__costumes', { class: season ? 'is-season' : '' },
        h('div.pf__caprow',
          h('div.pf__cap', { text: 'Costume' }),
          season ? h('span.pf__season', icon('moon'), h('span', { text: 'Halloween season' })) : h('small.pf__capnote', { text: 'Drawn over your picture. Wear one any time.' })),
        row);
    }
    function setCostume(id) {
      const c = Avatar.normCostume(id);
      saveProf({ costume: c });
      say(c === 'none' ? 'Costume off.' : `Wearing the ${Avatar.COSTUMES.find(x => x.id === c).name.toLowerCase()}.`);
    }

    /* ------------------------------------------------------------------ */
    /*  paint                                                              */
    /* ------------------------------------------------------------------ */
    let seq = 0;
    async function paint() {
      if (dead) return;
      const a = document.activeElement;
      if (a && body.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'))) { pending = true; return; }
      const fk = a && body.contains(a) ? a.dataset?.fk : null;
      const my = ++seq;
      const [P, C, plays] = await Promise.all([
        import('../core/projects.js'), import('../core/collections.js').catch(() => null), import('../core/plays.js'),
      ]);
      let projects = [];
      try { projects = await P.list(); } catch (e) { projects = []; }
      const ach = await readAchievements(plays);
      const F = await import('../core/friends.js').catch(() => null);
      const art = await readArt();
      if (dead || my !== seq) return;
      if (F && !offF) { lastCards = JSON.stringify(F.cards()); offF = F.onChange(() => { const sig = JSON.stringify(F.cards()); if (sig !== lastCards) { lastCards = sig; paint(); } }); }
      const published = projects.filter(p => p.published);
      const cols = C?.list ? C.list() : [];
      const u = who();
      const { picture } = Avatar.read();
      const season = SEASON.isSpookySeason();

      const name = h('input.pf__name', {
        type: 'text', maxlength: '24', placeholder: Identity.me().name, 'aria-label': 'Display name',
        autocomplete: 'nickname', spellcheck: 'false', dataset: { fk: 'name' },
      });
      name.value = shownName();
      const commitName = () => {
        const v = Identity.tidy(name.value, 24);
        if (v === myName()) return;
        Identity.setName(v);
        say(v ? `Your name is now ${v}.` : 'Name cleared.');
      };
      name.addEventListener('change', commitName);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });

      const bio = h('textarea.pf__bio', { rows: '2', maxlength: '240', placeholder: 'Say what you like to play and make…', 'aria-label': 'Bio', dataset: { fk: 'bio' } });
      bio.value = prof().bio || '';
      bio.addEventListener('change', () => saveProf({ bio: bio.value.slice(0, 240) }));

      /* what a card could hold: only ever the ticked parts of this */
      const pinnedAch = pinList('pinAch').filter(n => (ach || []).some(x => x.name === n));
      const pinnedCre = pinList('pinCre').map(id => projects.find(x => x.id === id)).filter(Boolean).map(x => x.published?.title || x.name);
      cardCtx = {
        bio: String(prof().bio || '').trim(),
        games: (typeof plays.top === 'function' ? plays.top(3) : plays.recent(3)).map(g => String(g.title || '').trim()).filter(Boolean).slice(0, 3),
        ach: pinnedAch, cre: pinnedCre.slice(0, MAX_PINS),
        friends: F && F.available() ? F.friends().length : 0,
      };
      const stats = [
        [projects.length, projects.length === 1 ? 'creation' : 'creations'],
        [published.length, 'published'],
        [plays.count(), plays.count() === 1 ? 'game played' : 'games played'],
        ach ? [ach.length, ach.length === 1 ? 'achievement' : 'achievements'] : null,
      ].filter(Boolean);

      clear(body);
      /* native append prints null as text — drop the empty sections first */
      body.append(...[
        h('header.pf__hero', { class: season ? 'is-season' : '' },
          h('div.pf__avwrap',
            h('button.pf__avbtn', { type: 'button', 'aria-label': 'Change your picture', title: 'Change picture', dataset: { fk: 'avatar' }, onclick: openSheet },
              Avatar.avatarEl(h, { initial: initial(), size: 88, label: 'Your profile picture' }),
              h('span.pf__avedit', { 'aria-hidden': 'true' }, icon('camera')))),
          h('div.pf__who',
            name,
            h('div.pf__handle', { text: u ? `@${u.username} · shown in Static Social and Party too. Names aren’t checked by anyone.` : 'Shown in Static Social and Party too. Names aren’t checked by anyone.' }),
            bio),
          h('div.pf__stats', stats.map(([n, l]) => h('div', h('b', { text: String(n) }), h('span', { text: l }))))),
        pinMsg ? h('div.pf__pinmsg', { role: 'status', text: pinMsg }) : null,
        h('section.pf__sec.pf__about', statusSection(F), birthdaySection()),
        costumes(picture, season),
        pinnedSection(ach, projects),
        topGames(plays),
        h('section.pf__sec.pf__creations',
          h('div.pf__caprow', h('div.pf__cap', { text: 'Your creations' }), h('small.pf__capnote', { text: 'Games and projects from Static Forge, Studio and remixes on this device · pictures and sprites are in Art' })),
          projects.length ? h('div.pf__grid', projects.map(creationTile))
            : h('div.pf__empty', h('span', { text: 'No creations yet.' }), h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('forge') }, icon('sparkles'), 'Open Static Forge'))),
        artSection(art),
        cols.length ? h('section.pf__sec', h('div.pf__cap', { text: 'Collections' }),
          h('div.pf__chips', cols.map(c => h('button.pf__chip', { type: 'button', onclick: () => api.openApp('aether-library') }, icon('bookmark'), h('span', { text: `${c.name} · ${(c.items || []).length}` }))))) : null,
        activity(projects, cols, ach, plays),
        ach && ach.length ? h('section.pf__sec.pf__ach', h('div.pf__cap', { text: 'Achievements' }),
          h('div.pf__chips', ach.map(x => h('span.pf__chip.pf__chip--ach', { title: x.desc, dataset: { ach: x.name } }, icon(x.icon), h('span', { text: x.name }),
            pinBtn(pinList('pinAch').includes(x.name), x.name, () => togglePin('ach', x.name, x.name), `pinach:${x.name}`))))) : null,
        cardSection(F),
        fromFriends(F),
        h('p.pf__note', { text: 'This profile lives on this device — your picture, name and bio are saved here and nowhere else. Followers and other people’s profiles need accounts on a server, which StaticOS doesn’t have. To pass a game on, use Share link on any creation.' }),
      ].filter(Boolean));
      if (fk) body.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
    }
    body.addEventListener('focusout', () => {
      if (!pending) return;
      setTimeout(() => {
        const a = document.activeElement;
        if (dead || (a && body.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'))) return;
        pending = false;
        paint();
      }, 0);
    });

    /* ------------------------------------------------------------------ */
    /*  picture editor                                                     */
    /* ------------------------------------------------------------------ */
    function closeSheet() {
      if (!sheet) return;
      sheet.cleanup?.();
      sheet.el.remove();
      sheet = null;
      body.querySelector('[data-fk="avatar"]')?.focus({ preventScroll: true });
    }

    function openSheet() {
      closeSheet();
      const saved = Avatar.read();
      const st = { tab: saved.picture?.kind === 'upload' ? 'upload' : 'builtin', choice: saved.picture, crop: null, err: '' };
      const preview = h('div.pfs__preview');
      const tabsEl = h('div.tabs.pfs__tabs', { role: 'tablist', 'aria-label': 'Picture source' });
      const pane = h('div.pfs__pane');
      const errEl = h('div.pfs__err', { role: 'alert' });
      const fileIn = h('input.sr', { type: 'file', accept: IMAGE_TYPES.join(','), tabindex: '-1', 'aria-hidden': 'true', onchange: e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f); } });
      const saveBtn = h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { act: 'save-picture' }, onclick: () => commit() }, icon('check'), h('span', { text: 'Save picture' }));
      const card = h('div.pfs__card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Change your picture', tabindex: '-1' },
        h('div.pfs__head', h('b', { text: 'Your picture' }), h('span.grow'),
          h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('x'))),
        h('div.pfs__top', preview, h('div.pfs__toptext',
          h('small', { text: 'Saved on this device only. An uploaded picture is cropped to a square and saved small (256 × 256) — the original file isn’t kept.' }))),
        tabsEl, pane, errEl, fileIn,
        h('div.pfs__foot',
          saved.picture ? h('button.btn.btn--ghost.btn--sm', { type: 'button', dataset: { act: 'remove-picture' }, onclick: () => { saveProf({ picture: null }); say('Picture removed.'); closeSheet(); } }, icon('trash'), h('span', { text: 'Use my initial' })) : null,
          h('span.grow'),
          h('button.btn.btn--sm', { type: 'button', onclick: closeSheet }, 'Cancel'),
          saveBtn));
      const el = h('div.pfs', { onclick: e => { if (e.target === el) closeSheet(); } }, card);
      appEl.append(el);
      sheet = { el, cleanup: null };
      /* Esc closes it wherever focus is (a file picker leaves it on the page) —
         but only while this window is the one in front */
      const onEsc = e => {
        if (e.key !== 'Escape' || !sheet || sheet.el !== el) return;
        if (!ctx.win.el?.classList.contains('is-active') && !el.contains(document.activeElement)) return;
        e.preventDefault(); e.stopPropagation(); closeSheet();
      };
      window.addEventListener('keydown', onEsc, true);

      const setErr = t => { st.err = t || ''; errEl.textContent = st.err; };
      function paintPreview() {
        clear(preview);
        const pic = st.tab === 'upload' && st.crop ? null : st.choice;
        if (st.tab === 'upload' && st.crop) {
          preview.append(h('span.av.pfs__cropmini', { style: { '--av': '72px' } }, h('span.av__pic', st.crop.mini)));
        } else {
          preview.append(Avatar.avatarEl(h, { picture: pic, initial: initial(), size: 72 }));
        }
      }
      function paintTabs() {
        clear(tabsEl);
        for (const [id, label, ic] of [['builtin', 'Built-in', 'user'], ['upload', 'Upload', 'upload']]) {
          tabsEl.append(h('button.tab', {
            type: 'button', role: 'tab', 'aria-selected': st.tab === id ? 'true' : 'false', class: st.tab === id ? 'is-on' : '',
            dataset: { tab: id }, onclick: () => { st.tab = id; setErr(''); paintTabs(); paintPane(); paintPreview(); },
          }, icon(ic), h('span', { text: label })));
        }
      }
      function paintPane() {
        clear(pane);
        if (st.tab === 'builtin') {
          pane.append(h('div.pfs__grid', { role: 'radiogroup', 'aria-label': 'Built-in avatars' },
            Avatar.BUILTIN.map(b => {
              const on = st.choice?.kind === 'builtin' && st.choice.id === b.id;
              return h('button.pfs__pick', {
                type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'is-on' : '', dataset: { avatar: b.id },
                onclick: () => { st.choice = { kind: 'builtin', id: b.id }; paintPane(); paintPreview(); pane.querySelector(`[data-avatar="${b.id}"]`)?.focus(); },
              }, Avatar.avatarEl(h, { picture: { kind: 'builtin', id: b.id }, costume: 'none', size: 56 }), h('span', { text: b.name }));
            })));
          saveBtn.disabled = !(st.choice && st.choice.kind === 'builtin');
          return;
        }
        if (!st.crop) {
          pane.append(h('div.pfs__drop', {
            ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('is-over'); },
            ondragleave: e => e.currentTarget.classList.remove('is-over'),
            ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); },
          },
            icon('image'),
            h('b', { text: 'Choose an image' }),
            h('small', { text: 'PNG, JPEG, WebP or GIF — or drop one here. You’ll crop it to a square next.' }),
            h('button.btn.btn--sm', { type: 'button', dataset: { act: 'choose-file' }, onclick: () => fileIn.click() }, icon('upload'), h('span', { text: 'Choose file…' }))));
          saveBtn.disabled = true;
          return;
        }
        pane.append(cropView());
        saveBtn.disabled = false;
      }

      async function loadFile(f) {
        setErr('');
        if (!IMAGE_TYPES.includes(f.type)) { setErr('That isn’t a PNG, JPEG, WebP or GIF image.'); return; }
        if (f.size > MAX_FILE) { setErr(`That image is ${(f.size / 1048576).toFixed(1)} MB; pictures up to ${MAX_FILE / 1048576} MB can be used.`); return; }
        let img;
        try { img = await decode(f); } catch (e) { if (!sheet) return; setErr('This browser couldn’t read that image.'); return; }
        if (!sheet || dead) return;
        const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
        if (!iw || !ih) { setErr('That image has no size to crop.'); return; }
        st.crop = { img, iw, ih, z: 1, cx: iw / 2, cy: ih / 2, mini: null };
        st.tab = 'upload';
        paintTabs();
        paintPane();
      }
      function decode(f) {
        if (typeof createImageBitmap === 'function') return createImageBitmap(f);
        return new Promise((res, rej) => {
          const url = URL.createObjectURL(f);
          const im = new Image();
          im.onload = () => { URL.revokeObjectURL(url); res(im); };
          im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
          im.src = url;
        });
      }

      /* the square of the image that is in view: centre (cx, cy), side `side` */
      function view(c) {
        const s0 = Math.max(CROP / c.iw, CROP / c.ih);
        const side = CROP / (s0 * c.z);
        const half = side / 2;
        c.cx = Math.min(Math.max(c.cx, half), c.iw - half);
        c.cy = Math.min(Math.max(c.cy, half), c.ih - half);
        return { sx: c.cx - half, sy: c.cy - half, side, scale: s0 * c.z };
      }
      function cropView() {
        const c = st.crop;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cv = h('canvas.pfs__canvas', { width: String(CROP * dpr), height: String(CROP * dpr), 'aria-hidden': 'true' });
        const g = cv.getContext('2d');
        const mini = h('canvas', { width: '72', height: '72' });
        c.mini = mini;
        const draw = () => {
          const v = view(c);
          g.clearRect(0, 0, cv.width, cv.height);
          g.drawImage(c.img, v.sx, v.sy, v.side, v.side, 0, 0, cv.width, cv.height);
          const m = mini.getContext('2d');
          m.clearRect(0, 0, 72, 72);
          m.drawImage(c.img, v.sx, v.sy, v.side, v.side, 0, 0, 72, 72);
        };
        const zoom = h('input.pfs__zoom', { type: 'range', min: '1', max: '4', step: '0.01', value: String(c.z), 'aria-label': 'Zoom', dataset: { act: 'zoom' },
          oninput: e => { c.z = Number(e.target.value) || 1; draw(); } });
        let drag = null;
        const box = h('div.pfs__crop', {
          tabindex: '0', role: 'application', 'aria-label': 'Crop area. Drag, or use the arrow keys, to move the picture; plus and minus zoom.',
          onpointerdown: e => { drag = { x: e.clientX, y: e.clientY, cx: c.cx, cy: c.cy }; box.setPointerCapture?.(e.pointerId); },
          onpointermove: e => {
            if (!drag) return;
            const s = view(c).scale;
            c.cx = drag.cx - (e.clientX - drag.x) / s;
            c.cy = drag.cy - (e.clientY - drag.y) / s;
            draw();
          },
          onpointerup: () => { drag = null; },
          onpointercancel: () => { drag = null; },
          onkeydown: e => {
            const s = view(c).scale;
            const step = (e.shiftKey ? 40 : 10) / s;
            const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (k) { e.preventDefault(); c.cx += k[0]; c.cy += k[1]; draw(); return; }
            if (e.key === '+' || e.key === '=' || e.key === '-') {
              e.preventDefault();
              c.z = Math.min(4, Math.max(1, c.z + (e.key === '-' ? -0.1 : 0.1)));
              zoom.value = String(c.z);
              draw();
            }
          },
          onwheel: e => { e.preventDefault(); c.z = Math.min(4, Math.max(1, c.z * (e.deltaY < 0 ? 1.06 : 1 / 1.06))); zoom.value = String(c.z); draw(); },
        }, cv, h('span.pfs__ring', { 'aria-hidden': 'true' }));
        draw();
        requestAnimationFrame(() => paintPreview());
        return h('div.pfs__cropwrap', box,
          h('div.pfs__cropctl',
            h('label.pfs__zoomrow', icon('search'), zoom),
            h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => fileIn.click() }, icon('image'), h('span', { text: 'Another image…' }))));
      }

      /** The cropped square at 256×256, as small as it can be while still looking right. */
      function exportCrop() {
        const c = st.crop;
        const v = view(c);
        const out = document.createElement('canvas');
        out.width = OUT; out.height = OUT;
        const g = out.getContext('2d');
        g.fillStyle = '#16121c';           /* transparent PNGs get a dark backing, not black JPEG fill */
        g.fillRect(0, 0, OUT, OUT);
        g.imageSmoothingQuality = 'high';
        g.drawImage(c.img, v.sx, v.sy, v.side, v.side, 0, 0, OUT, OUT);
        for (const q of [0.86, 0.75, 0.6, 0.45]) {
          let url = out.toDataURL('image/webp', q);
          if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/jpeg', q);
          if (url.length <= Avatar.MAX_UPLOAD_CHARS) return url;
        }
        return null;
      }

      function commit() {
        setErr('');
        if (st.tab === 'upload') {
          if (!st.crop) { setErr('Choose an image first.'); return; }
          const url = exportCrop();
          if (!url || !Avatar.normPicture({ kind: 'upload', dataUrl: url })) { setErr('That picture couldn’t be saved small enough. Try a different image.'); return; }
          saveProf({ picture: { kind: 'upload', dataUrl: url } });
          say('Picture saved.');
        } else {
          const p = Avatar.normPicture(st.choice);
          if (!p) { setErr('Pick an avatar first.'); return; }
          saveProf({ picture: p });
          say(`Picture set to the ${Avatar.BUILTIN.find(b => b.id === p.id).name.toLowerCase()}.`);
        }
        closeSheet();
      }

      sheet.cleanup = () => {
        window.removeEventListener('keydown', onEsc, true);
        const im = st.crop?.img;
        if (im && typeof im.close === 'function') im.close();
      };
      paintTabs();
      paintPane();
      paintPreview();
      requestAnimationFrame(() => (tabsEl.querySelector('.is-on') || card).focus({ preventScroll: true }));
    }

    paint();
    const offs = [bus.on('projects:change', paint), bus.on('achievement:unlock', paint), store.sub('session.user', paint),
      store.sub('portal.collections', paint), bus.on('game:launch', paint), store.sub(KEY, paint), store.sub('portal.identity', paint), store.sub('prefs.birthday', paint)];
    return () => { dead = true; closeSheet(); offs.forEach(f => f?.()); offF?.(); offF = null; };
  },
});
