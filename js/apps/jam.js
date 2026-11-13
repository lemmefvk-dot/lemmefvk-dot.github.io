/* ============================================================
   jam.js — Static Jam, the weekly game jam.

   One theme a week, the same on every StaticOS device: events.js
   picks it from the ISO week number (JAM_THEMES), so there is
   nothing to host and nobody chooses it. The jam runs from Monday
   00:00 to the next Monday 00:00 in your own time zone, and the
   countdown is exactly that.

   Make → Submit → Share:
   - Make: "Start a game for this theme" opens Static Forge with a
     prompt for the theme.
   - Submit: pick one of your projects. The entry is recorded on
     this device in store 'portal.jam' as
     { '<year>-W<week>': [projectIds] }; when it was entered, the
     title it was entered under and whether it was announced sit
     beside it in 'portal.jamLog'.
   - Share: if you choose, the entry's title and description are
     announced on the public live channel (topic
     'jam/<year>-W<week>') to anyone who has Jam open. To let people
     play it you send them the game file (Save file here, or Export
     .html in Forge): StaticOS has no server to host other people's
     games, and the page says so.

   The live part, honestly: a free public MQTT broker with no
   history and no accounts. Jam lists only announcements this window
   really heard, from devices that really sent them. When it opens
   it asks "who has entered this week?" and any open Jam window
   repeats its own entries — rate-limited, one answer per 20 s at
   most — so a newcomer sees the people who are here now. There are
   no entrant counts, votes, judges or prizes, and no message ever
   opens anything. Everything received is parsed defensively,
   bounded, and rendered as text; anyone can be hidden on this
   device (store 'portal.jamMute').
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { JAM_THEMES, isoWeek, jamTheme } from '../core/events.js';
import * as Projects from '../core/projects.js';
import * as live from '../portal/live.js';
import { me, clean, tidy, setName } from '../core/identity.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-jam-css')) {
  const l = document.createElement('link');
  l.id = 'feat-jam-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-jam.css';
  document.head.appendChild(l);
}

const KEY = 'portal.jam';          /* { '<year>-W<week>': [projectId] }                                  */
const LOG = 'portal.jamLog';       /* { '<year>-W<week>': { [projectId]: { at, title, description, share, sent } } } */
const MUTE = 'portal.jamMute';     /* [{ id, name }] — people hidden on this device                     */
const WEEK_RE = /^(\d{4})-W(\d{1,2})$/;
const topicOf = key => `jam/${key}`;

const TITLE_MAX = 60;
const DESC_MAX = 200;
const MSG_MAX = 500;               /* one message of ours on the wire, JSON and all        */
const IN_MAX = 2000;               /* anything longer that arrives is dropped unread       */
/* Our own sending: at most 1 message a second and 10 in any 30 s. Both are
   kept with a little margin, so jitter on the way to the broker can never
   make us arrive faster than that. */
const SEND_GAP = 1100;
const SEND_WINDOW = 30_500;
const SEND_CAP = 10;
const ASK_EVERY = 10_000;          /* "who has entered this week?" at most this often       */
const ANSWER_EVERY = 20_000;       /* and we repeat our entries at most this often          */
const PEER_WINDOW = 30_000;
const PEER_CAP = 8;                /* messages taken from one sender per 30 s               */
const PEER_ENTRIES = 5;            /* announcements kept per sender                         */
const FLOOD_WINDOW = 10_000;
const FLOOD_CAP = 120;             /* messages taken from everyone per 10 s                 */
const HEARD_MAX = 150;
const MUTE_MAX = 200;
const DAY = 864e5;

/* Our sending budget is shared by every Jam window this session, so
   closing and reopening the app can't be used to send faster. */
const sentAt = [];
let lastAsk = 0;
let lastAnswer = 0;
function sendWait(now = Date.now()) {
  while (sentAt.length && now - sentAt[0] >= SEND_WINDOW) sentAt.shift();
  let w = 0;
  if (sentAt.length) w = sentAt[sentAt.length - 1] + SEND_GAP - now;
  if (sentAt.length >= SEND_CAP) w = Math.max(w, sentAt[0] + SEND_WINDOW - now);
  return Math.max(0, w);
}

/* ---------- weeks ----------------------------------------------------
   The same ISO-week maths as events.js (and Forge's jam card). A jam
   week starts at local midnight on its Monday; setDate() keeps that
   right across daylight-saving changes. */
function mondayOf(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() || 7) - 1));
  return m;
}
function jamAt(monday) {
  const { year, week } = isoWeek(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { year, week, key: `${year}-W${week}`, theme: jamTheme(monday), start: monday.getTime(), end: end.getTime(), sunday: sunday.getTime() };
}
const thisJam = (now = new Date()) => jamAt(mondayOf(now));
function jamOffset(j, k) {
  const m = new Date(j.start);
  m.setDate(m.getDate() + 7 * k);
  return jamAt(m);
}
/** The jam for a stored '<year>-W<week>' key (Jan 4th is always in ISO week 1). */
function jamOfKey(key) {
  const m = WEEK_RE.exec(String(key));
  if (!m) return null;
  const mon = mondayOf(new Date(Number(m[1]), 0, 4));
  mon.setDate(mon.getDate() + 7 * (Number(m[2]) - 1));
  const j = jamAt(mon);
  return j.key === key ? j : null;
}
const weekOrder = (a, b) => {
  const [, ay, aw] = WEEK_RE.exec(a) || [0, 0, 0];
  const [, by, bw] = WEEK_RE.exec(b) || [0, 0, 0];
  return (Number(by) - Number(ay)) || (Number(bw) - Number(aw));
};

/* ---------- each theme's look: hues, a glyph and a pattern -----------
   Pure decoration drawn in CSS (data-pat). A theme added to JAM_THEMES
   later still gets a look, from a hash of its name. */
const MOODS = {
  'One Button': { icon: 'circle', h1: 352, h2: 18, pat: 'button', line: 'The whole game is played with a single key or a single tap.' },
  'Night Shift': { icon: 'moon', h1: 226, h2: 262, pat: 'stars', line: 'Darkness, late hours, a job that starts when everyone else is asleep.' },
  'Lost Signal': { icon: 'wifi-off', h1: 168, h2: 198, pat: 'scan', line: 'Static, radio silence, finding your way with almost nothing to go on.' },
  'Arcade': { icon: 'gamepad', h1: 305, h2: 258, pat: 'grid', line: 'Short rounds, a high score, and just one more try.' },
  'Underwater': { icon: 'droplet', h1: 188, h2: 218, pat: 'bubbles', line: 'Currents, bubbles, pressure — and whatever lives down there.' },
  'Future City': { icon: 'zap', h1: 284, h2: 190, pat: 'skyline', line: 'Neon streets, traffic in the sky, machines everywhere.' },
  'Broken World': { icon: 'globe', h1: 24, h2: 350, pat: 'shards', line: 'Something has fallen apart. Patch it, survive it, or break it further.' },
  'Speed': { icon: 'chevrons-right', h1: 44, h2: 12, pat: 'streaks', line: 'Faster and faster until something gives.' },
};
function moodOf(theme) {
  if (MOODS[theme]) return MOODS[theme];
  let n = 0;
  for (const c of String(theme)) n = (n * 31 + c.codePointAt(0)) >>> 0;
  const h1 = n % 360;
  return { icon: 'sparkles', h1, h2: (h1 + 40) % 360, pat: 'dots', line: 'Make a small game around this idea, however you read it.' };
}
const themePrompt = theme => 'A small game for the jam theme "' + theme + '"';

/* ---------- formatting ---------------------------------------------- */
const pad = n => String(n).padStart(2, '0');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function split(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}
function shortLeft(ms) {
  const l = split(ms);
  return l.d ? `${l.d}d ${l.h}h` : l.h ? `${l.h}h ${pad(l.m)}m` : `${l.m}m ${pad(l.s)}s`;
}
function longLeft(ms) {
  const l = split(ms);
  const parts = [];
  if (l.d) parts.push(plural(l.d, 'day'));
  if (l.d || l.h) parts.push(plural(l.h, 'hour'));
  parts.push(plural(l.m, 'minute'));
  return `${parts.join(', ')} left`;
}
const dayFmt = ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const whenFmt = ms => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const endFmt = ms => new Date(ms).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const rangeFmt = j => `${dayFmt(j.start)} – ${dayFmt(j.sunday)}`;
const slug = s => (String(s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game');
const initialOf = name => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();
const safeThumb = t => (typeof t === 'string' && t.length < 400_000 && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(t) ? t : null);
const reduced = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.body.classList.contains('reduce-motion');

const SECTIONS = [
  { id: 'week', label: 'This week', icon: 'flame', group: 'Jam' },
  { id: 'submit', label: 'Submit a game', icon: 'upload', group: 'Jam' },
  { id: 'entries', label: 'Your entries', icon: 'bookmark', group: 'Submissions' },
  { id: 'live', label: 'Heard live', icon: 'activity', group: 'Submissions' },
  { id: 'themes', label: 'Themes', icon: 'calendar', group: 'Calendar' },
];
const isSection = id => SECTIONS.some(s => s.id === id);

const STATUS = {
  idle: { label: 'Not connected', note: 'The live channel starts when Jam opens.' },
  connecting: { label: 'Connecting…', note: 'Reaching a public live channel.' },
  live: { label: 'Live', note: 'Public channel · names are not verified' },
  offline: { label: 'Offline', note: 'This network may block the live channel. Your entries are still recorded on this device.' },
};

let uidSeq = 0;

defineApp({
  id: 'jam',
  name: 'Static Jam',
  icon: 'flame',
  g1: '#ffc857', g2: '#e4402a',
  category: 'Create',
  keywords: ['jam', 'game jam', 'weekly', 'theme', 'event', 'challenge', 'countdown', 'submit', 'entries', 'forge', 'make a game', 'live'],
  desc: 'The weekly game jam: this week’s theme, a countdown, and your entries',
  singleton: true,
  win: { w: 900, h: 640, minW: 420, minH: 440 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, fmt } = api;
    const uid = `jam${++uidSeq}`;
    let dead = false;
    let offTopic = null;
    let paintQ = 0;              /* rAF: coalesced repaint of the live lists  */
    let fullQ = 0;               /* rAF: coalesced full repaint              */
    let pumpT = 0;
    let answerT = 0;
    let askT = 0;
    let refreshT = 0;
    const urls = new Map();      /* object URL of a saved file -> its revoke timer */
    const Q = [];                /* outgoing messages waiting for the channel or the rate limit */
    const R = {};                /* nodes of the current view that update in place */

    const S = {
      sec: isSection(opts?.section) ? opts.section : (opts?.project ? 'submit' : 'week'),
      wk: thisJam(),
      projects: null,
      projErr: false,
      pick: typeof opts?.project === 'string' ? opts.project : null,
      draft: null,               /* { pid, title, description, share } */
      heard: new Map(),          /* `${senderId}:${at}` -> announcement */
      rate: new Map(),           /* senderId -> [times] */
      flood: [],
      status: live.status(),
      naming: false,
      askedAt: 0,                /* when this window's "who has entered?" went out */
    };

    /* ---------------- stored state, read defensively ---------------- */
    function readSubs() {
      const raw = store.get(KEY, {}) || {};
      const out = {};
      if (typeof raw !== 'object' || Array.isArray(raw)) return out;
      for (const [k, v] of Object.entries(raw)) {
        if (!WEEK_RE.test(k) || !Array.isArray(v)) continue;
        const ids = [...new Set(v.filter(x => typeof x === 'string' && x && x.length <= 80))];
        if (ids.length) out[k] = ids;
      }
      return out;
    }
    const subsFor = key => readSubs()[key] || [];
    function writeSubs(key, ids) {
      const next = { ...readSubs() };
      if (ids.length) next[key] = [...ids]; else delete next[key];
      store.set(KEY, next);
    }
    function readLog() {
      const raw = store.get(LOG, {}) || {};
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    }
    function logFor(key, pid) {
      const m = readLog()[key]?.[pid];
      if (!m || typeof m !== 'object') return null;
      return {
        at: Number.isFinite(m.at) ? m.at : 0,
        title: tidy(m.title, TITLE_MAX),
        description: tidy(m.description, DESC_MAX),
        share: m.share !== false,
        sent: Number.isFinite(m.sent) ? m.sent : 0,
      };
    }
    function writeLog(key, pid, patch) {
      const all = readLog();
      const week = { ...(all[key] && typeof all[key] === 'object' ? all[key] : {}) };
      if (patch === null) delete week[pid];
      else week[pid] = { ...(logFor(key, pid) || {}), ...patch };
      const next = { ...all };
      if (Object.keys(week).length) next[key] = week; else delete next[key];
      store.set(LOG, next);
    }
    function readMuted() {
      const raw = store.get(MUTE, []);
      return Array.isArray(raw) ? raw.filter(m => m && typeof m.id === 'string').map(m => ({ id: m.id, name: tidy(m.name, 24) || 'Someone' })) : [];
    }
    const isMuted = id => readMuted().some(m => m.id === id);

    const thumbs = () => store.get('portal.forge.thumbs', {}) || {};
    const titleOf = p => tidy(p?.published?.title || p?.name, TITLE_MAX) || 'Untitled game';
    const descOf = p => tidy(p?.published?.description, DESC_MAX);
    const projectById = id => (S.projects || []).find(p => p.id === id) || null;
    const ago = ms => (Number.isFinite(ms) && ms > 0 ? fmt.fmtAgo(new Date(ms).toISOString()) : '');
    const hasForge = () => !!api.getApp('forge');
    const note = n => api.notify({ app: 'Static Jam', icon: 'flame', timeout: 6000, ...n });

    /* ---------------- chrome ---------------- */
    const side = h('aside.app__side.jam-side', { 'aria-label': 'Static Jam sections' });
    const barTitle = h('div.app__title');
    const clockWeek = h('span.jam-chip__wk');
    const clockLeft = h('span');
    const clockChip = h('span.jam-chip.jam-chip--clock', { title: 'Time left in this week’s jam (your time zone)' }, icon('clock'), clockWeek, clockLeft);
    const liveChip = h('span.jam-chip.jam-chip--live');
    const bar = h('div.app__bar.jam-bar', barTitle, h('div.grow'), clockChip, liveChip);
    const content = h('div.app__content.jam');
    const main = h('div.app__main.jam-main', bar, content);
    root.appendChild(h('div.app.jam-app', side, main));

    const navBtns = new Map();
    const navCounts = new Map();
    const meter = { dot: h('span.jam-dot'), label: h('b'), note: h('small') };
    (function buildSide() {
      let group = null, last = '';
      for (const s of SECTIONS) {
        if (s.group !== last) {
          last = s.group;
          group = h('div.side__group', h('div.side__label', { text: s.group }));
          side.appendChild(group);
        }
        const count = h('small');
        const b = h('button.side__item', { type: 'button', title: s.label, dataset: { sec: s.id }, onclick: () => go(s.id) }, icon(s.icon), h('span.jam-side__lbl', { text: s.label }), count);
        navBtns.set(s.id, b);
        navCounts.set(s.id, count);
        group.appendChild(b);
      }
      meter.box = h('div.side__meter.jam-meter', h('div.jam-meter__row', meter.dot, meter.label), meter.note);
      side.appendChild(h('div.side__group.jam-side__status', h('div.side__label', { text: 'Live channel' }), meter.box));
    })();

    function syncSide() {
      for (const [id, b] of navBtns) {
        const on = id === S.sec;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      }
      const mine = Object.values(readSubs()).reduce((n, ids) => n + ids.length, 0);
      navCounts.get('entries').textContent = mine ? String(mine) : '';
      const heard = visibleHeard().length;
      navCounts.get('live').textContent = heard ? String(heard) : '';
    }

    function go(sec) {
      if (!isSection(sec)) return;
      S.sec = sec;
      S.naming = false;
      paint(true);
    }

    /* ---------------- small pieces ---------------- */
    const btn = (ic, label, onclick, cls = '', extra = {}) =>
      h(`button.btn${cls}`, { type: 'button', onclick, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
    const secHead = (title, ...extra) => h('div.jam-sechead', h('h3.jam-h3', { text: title }), h('div.grow'), ...extra);
    const more = (label, sec) => h('button.jam-more', { type: 'button', onclick: () => go(sec) }, h('span', { text: label }), icon('chevron-right'));

    function thumb(p) {
      const t = p ? safeThumb(p.published?.thumbnail) || safeThumb(thumbs()[p.id]) : null;
      return h('div.jam-thumb', t ? { style: { backgroundImage: `url("${t}")` } } : null, t ? null : icon(p ? 'sparkles' : 'alert'));
    }

    function startTheme(theme) {
      if (!hasForge()) { note({ icon: 'alert', title: 'Static Forge isn’t available', message: 'Forge makes the games Jam enters, and it isn’t installed on this StaticOS.' }); return; }
      api.openApp('forge', { prompt: themePrompt(theme) });
    }

    /* ---------------- live channel: sending ---------------- */
    const topic = () => topicOf(S.wk.key);

    function enqueue(item) {
      if (Q.length >= 16) Q.shift();
      Q.push(item);
      pump();
    }
    function pump() {
      clearTimeout(pumpT);
      pumpT = 0;
      if (dead) return;
      const t = topic();
      for (let i = Q.length - 1; i >= 0; i--) if (Q[i].topic !== t) Q.splice(i, 1);   /* a week ended */
      if (!Q.length || live.status() !== 'live') return;                            /* onStatus pumps again */
      const wait = sendWait();
      if (wait > 0) { pumpT = setTimeout(pump, wait); return; }
      const item = Q.shift();
      const text = item.build();
      if (text) {
        if (!live.publish(item.topic, text)) { Q.unshift(item); return; }
        sentAt.push(Date.now());
        item.onSent?.();
      }
      if (Q.length) pumpT = setTimeout(pump, text ? SEND_GAP : 0);
    }

    /** Our announcement for an entry, built when it is sent (so a rename or a
        withdrawal in between is respected), and never over MSG_MAX characters. */
    function announcement(key, pid) {
      if (!subsFor(key).includes(pid)) return null;
      const m = logFor(key, pid);
      if (!m || !m.share || !m.at) return null;
      const who = me();
      const msg = { id: who.id, name: who.name, color: who.color, title: m.title || titleOf(projectById(pid)), description: m.description || '', at: m.at };
      let text = JSON.stringify(msg);
      while (text.length > MSG_MAX && msg.description) {
        msg.description = msg.description.slice(0, Math.max(0, msg.description.length - 24)).trim();
        text = JSON.stringify(msg);
      }
      if (text.length > MSG_MAX) { msg.title = msg.title.slice(0, 24); text = JSON.stringify(msg); }
      return text.length <= MSG_MAX ? text : null;
    }
    function announce(pid) {
      const key = S.wk.key;
      if (Q.some(i => i.kind === 'sub' && i.pid === pid && i.topic === topicOf(key))) return;
      enqueue({
        topic: topicOf(key), kind: 'sub', pid,
        build: () => announcement(key, pid),
        onSent: () => {
          const m = logFor(key, pid);
          if (m && !m.sent) { writeLog(key, pid, { sent: Date.now() }); changed(); }
        },
      });
    }
    /** Entries you chose to share that haven't gone out yet (offline when you entered them). */
    function announcePending() {
      for (const pid of subsFor(S.wk.key)) {
        const m = logFor(S.wk.key, pid);
        if (m && m.share && !m.sent) announce(pid);
      }
    }
    /** "Who has entered this week?" — sent when Jam opens (or the week changes). If
        a Jam window asked moments ago, this one waits its turn instead of dropping it. */
    function ask() {
      clearTimeout(askT);
      askT = 0;
      if (dead) return;
      const wait = lastAsk + ASK_EVERY - Date.now();
      if (wait > 0) { askT = setTimeout(ask, wait); return; }
      const t = topic();
      if (Q.some(i => i.kind === 'ask' && i.topic === t)) return;
      lastAsk = Date.now();
      enqueue({ topic: t, kind: 'ask', build: () => JSON.stringify({ id: me().id, q: 1 }), onSent: () => { if (topic() === t) S.askedAt = Date.now(); } });
    }
    /** Someone opened Jam and asked who has entered: repeat ours, once per 20 s at most. */
    function answer() {
      const now = Date.now();
      if (now - lastAnswer < ANSWER_EVERY || me().status === 'invisible') return;
      const mine = subsFor(S.wk.key).filter(pid => logFor(S.wk.key, pid)?.share).slice(-PEER_ENTRIES);
      if (!mine.length) return;
      lastAnswer = now;
      clearTimeout(answerT);
      answerT = setTimeout(() => { if (!dead) mine.forEach(pid => announce(pid)); }, 300 + Math.random() * 1200);
    }
    /* one of your entries changed state (announced, or the channel came or went) */
    function changed() {
      if (S.sec === 'week' || S.sec === 'entries') soon();
    }

    /* ---------------- live channel: receiving ---------------- */
    function allowFrom(id, now) {
      while (S.flood.length && now - S.flood[0] > FLOOD_WINDOW) S.flood.shift();
      if (S.flood.length >= FLOOD_CAP) return false;
      let times = S.rate.get(id);
      if (!times) {
        if (S.rate.size > 500) S.rate.clear();
        times = [];
        S.rate.set(id, times);
      }
      while (times.length && now - times[0] > PEER_WINDOW) times.shift();
      if (times.length >= PEER_CAP) return false;
      times.push(now);
      S.flood.push(now);
      return true;
    }

    function onMsg(text) {
      if (dead || typeof text !== 'string' || text.length > IN_MAX) return;
      let raw;
      try { raw = JSON.parse(text); } catch (e) { return; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const who = clean(raw);
      if (!who || who.id === me().id) return;
      const now = Date.now();
      if (!allowFrom(who.id, now)) return;

      if (raw.q === 1) { answer(); return; }
      if (raw.gone !== undefined) {
        if (S.heard.delete(`${who.id}:${Number(raw.gone)}`)) soonLive();
        return;
      }
      const title = tidy(raw.title, TITLE_MAX);
      const at = Number(raw.at);
      /* a submission time inside this jam week, allowing for other time
         zones (whose Monday starts up to a day apart) and a little clock skew */
      if (!title || !Number.isFinite(at) || at < S.wk.start - 27 * 3600e3 || at > now + 10 * 60e3) return;
      const entry = { key: `${who.id}:${at}`, id: who.id, name: who.name, color: who.color, title, description: tidy(raw.description, DESC_MAX), at, heard: now };
      S.heard.delete(entry.key);
      S.heard.set(entry.key, entry);
      /* bound what one sender, and everyone together, can put on screen */
      const theirs = [...S.heard.values()].filter(e => e.id === who.id);
      if (theirs.length > PEER_ENTRIES) theirs.sort((a, b) => a.heard - b.heard).slice(0, theirs.length - PEER_ENTRIES).forEach(e => S.heard.delete(e.key));
      while (S.heard.size > HEARD_MAX) S.heard.delete(S.heard.keys().next().value);
      soonLive();
    }

    const visibleHeard = () => {
      const muted = new Set(readMuted().map(m => m.id));
      return [...S.heard.values()].filter(e => !muted.has(e.id)).sort((a, b) => (b.at - a.at) || (b.heard - a.heard));
    };

    function subscribe() {
      offTopic?.();
      offTopic = null;
      try { offTopic = live.subscribe(topic(), onMsg); } catch (e) { offTopic = null; }
    }

    function mute(e) {
      const list = readMuted().filter(m => m.id !== e.id);
      store.set(MUTE, [...list, { id: e.id, name: tidy(e.name, 24) }].slice(-MUTE_MAX));
      note({ icon: 'eye', title: `${e.name} is hidden on this device`, message: 'Their announcements won’t show here. Heard live › Hidden people brings them back.' });
      soonLive();
    }
    function unmute(id) {
      store.set(MUTE, readMuted().filter(m => m.id !== id));
      soonLive();
    }

    /* ---------------- status ---------------- */
    function statusBits(st = S.status) {
      const s = STATUS[st] || STATUS.idle;
      return { cls: `is-${st in STATUS ? st : 'idle'}`, label: s.label, note: st === 'live' ? `Listening for week ${S.wk.week} announcements.` : s.note };
    }
    function paintStatus() {
      const b = statusBits();
      meter.dot.className = `jam-dot ${b.cls}`;
      meter.label.textContent = b.label;
      meter.note.textContent = S.status === 'live' ? STATUS.live.note : b.note;
      meter.box.title = `Live channel: ${b.label}. ${meter.note.textContent}`;
      clear(liveChip);
      liveChip.className = `jam-chip jam-chip--live ${b.cls}`;
      liveChip.append(h('span.jam-dot', { class: b.cls }), h('span', { text: b.label }));
      liveChip.title = b.note;
      if (R.statusCard) fillStatusCard(R.statusCard);
      if (R.statusLine) fillStatusLine(R.statusLine);
    }
    function fillStatusLine(el) {
      const b = statusBits();
      clear(el);
      el.append(h('span.jam-dot', { class: b.cls }), h('span', { text: S.status === 'offline' ? 'Offline — this network may block the live channel.' : b.note }));
    }
    function fillStatusCard(el) {
      const b = statusBits();
      clear(el);
      el.className = `jam-status ${b.cls}`;
      el.append(
        h('span.jam-status__dot', h('span.jam-dot', { class: b.cls })),
        h('div.jam-status__t',
          h('b', { text: S.status === 'offline' ? 'Offline — this network may block the live channel' : b.label }),
          h('small', { text: S.status === 'offline' ? 'Jam keeps trying. Your entries are recorded on this device either way, and waiting announcements go out when it connects.' : b.note })));
    }

    /* ---------------- the clock ---------------- */
    let lastAria = '';
    let rolling = false;
    function tick() {
      if (dead) return;
      const now = Date.now();
      if ((now >= S.wk.end || now < S.wk.start) && !rolling) { rollWeek(); return; }
      const left = S.wk.end - now;
      clockWeek.textContent = `Week ${S.wk.week}`;
      clockLeft.textContent = `${shortLeft(left)} left`;
      if (R.miniLeft?.isConnected) R.miniLeft.textContent = `Closes ${dayFmt(S.wk.end)} · ${shortLeft(left)} left`;
      for (const x of R.lefts || []) if (x.el.isConnected) x.el.textContent = x.text(left);
      if (R.clock && R.clock.d.isConnected) {
        const l = split(left);
        R.clock.d.textContent = String(l.d);
        R.clock.h.textContent = pad(l.h);
        R.clock.m.textContent = pad(l.m);
        R.clock.s.textContent = pad(l.s);
        const aria = longLeft(left);
        if (aria !== lastAria) { lastAria = aria; R.clock.el.setAttribute('aria-label', `${aria} in this week’s jam`); }
      }
    }
    /** Monday 00:00 came round (or the clock moved): a new theme, a new topic. */
    function rollWeek() {
      rolling = true;
      try {
        const next = thisJam();
        const changed = next.key !== S.wk.key;
        S.wk = next;
        if (changed) {
          S.heard.clear();
          S.rate.clear();
          S.askedAt = 0;
          Q.length = 0;
          subscribe();
          if (live.status() === 'live') { ask(); announcePending(); }
        }
        win.setSubtitle(`Week ${S.wk.week} · ${S.wk.theme}`);
        paint();
      } finally { rolling = false; }
    }

    /* ============== views ============== */
    function hero(wk, mood) {
      const clock = { d: h('b'), h: h('b'), m: h('b'), s: h('b') };
      const seg = (el, label) => h('div.jam-clock__seg', el, h('small', { text: label }));
      clock.el = h('div.jam-clock', { role: 'timer' }, seg(clock.d, 'days'), seg(clock.h, 'hours'), seg(clock.m, 'min'), seg(clock.s, 'sec'));
      R.clock = clock;
      lastAria = '';
      return h('section.jam-hero', { dataset: { pat: mood.pat }, style: { '--h1': String(mood.h1), '--h2': String(mood.h2) }, 'aria-labelledby': `${uid}-theme` },
        h('div.jam-hero__art', { 'aria-hidden': 'true' }),
        h('div.jam-hero__top',
          h('span.jam-hero__tag', icon('flame'), h('span', { text: `Static Jam · Week ${wk.week}` })),
          h('span.jam-hero__dates', { text: rangeFmt(wk) })),
        h('div.jam-hero__body',
          h('div.jam-hero__glyph', { 'aria-hidden': 'true' }, icon(mood.icon)),
          h('div.jam-hero__text',
            h('div.jam-hero__kicker', { text: 'This week’s theme' }),
            h(`h2.jam-hero__theme#${uid}-theme`, { text: wk.theme }),
            h('p.jam-hero__line', { text: mood.line }))),
        h('div.jam-hero__foot',
          h('div.jam-hero__time', clock.el, h('div.jam-hero__ends', { text: `Ends ${endFmt(wk.end)} (your time)` })),
          h('div.jam-hero__acts',
            btn('sparkles', 'Start a game for this theme', () => startTheme(wk.theme), '.btn--primary.jam-go', { disabled: !hasForge(), title: hasForge() ? `Opens Static Forge with a prompt for “${wk.theme}”` : 'Static Forge isn’t available' }),
            btn('upload', 'Submit a game', () => go('submit'), '.jam-ghost'))));
    }

    function steps(wk, mine) {
      const loading = S.projects === null;
      const made = (S.projects || []).filter(p => p.updatedAt >= wk.start).length;
      const shared = mine.filter(e => e.meta?.share);
      const sent = shared.some(e => e.meta.sent);
      const latest = [...mine].reverse().find(e => e.p);
      const step = (n, title, text, status, done, action) => h(`li.jam-step${done ? '.is-done' : ''}`,
        h('div.jam-step__n', { 'aria-hidden': 'true' }, done ? icon('check') : h('span', { text: String(n) })),
        h('div.jam-step__body',
          h('b', { text: title }),
          h('p', { text }),
          h('small.jam-step__status', { text: status })),
        h('div.jam-step__act', action));
      return h('section.jam-sec',
        secHead('How the jam works'),
        h('ol.jam-steps',
          step(1, 'Make', `Build something small for “${wk.theme}” in Static Forge. Describe it in a sentence and Forge writes a first version.`,
            loading ? 'Checking your games…' : made ? `${plural(made, 'game')} of yours changed this week` : 'Nothing made this week yet', made > 0,
            btn('sparkles', 'Start in Forge', () => startTheme(wk.theme), '.btn--sm', { disabled: !hasForge() })),
          step(2, 'Submit', `Pick one of your games and enter it for week ${wk.week}. You can enter more than one, and withdraw any time.`,
            mine.length ? `${plural(mine.length, 'entry', 'entries')} for week ${wk.week}` : 'No entry yet', mine.length > 0,
            btn('upload', 'Submit a game', () => go('submit'), '.btn--sm')),
          step(3, 'Share', 'Entering can announce your title to people with Jam open. To let them play it, send them the game file.',
            sent ? 'Announced on the live channel' : shared.length ? 'Announcement waiting for the live channel' : mine.length ? 'Not announced — kept on this device' : 'Nothing to share yet', sent,
            btn('download', 'Save game file', () => latest && saveFile(latest.p), '.btn--sm', { disabled: !latest, title: latest ? `Save “${titleOf(latest.p)}” as a standalone .html file` : 'Submit a game first' }))));
    }

    function shareState(key, pid, m) {
      if (!m || !m.share) return 'Not announced';
      if (m.sent) return 'Announced live';
      if (key !== S.wk.key) return 'Never announced';
      /* while live, anything shared but unsent is in the queue (every 'live'
         transition re-queues it), so it is on its way */
      return S.status === 'live' ? 'Announcing…' : 'Announces when the live channel connects';
    }

    function entryRow(key, pid) {
      const p = projectById(pid);
      const m = logFor(key, pid);
      const loading = S.projects === null;
      const title = m?.title || (p ? titleOf(p) : loading ? 'Your game' : 'A game that’s gone');
      const bits = p || loading ? [m?.at ? `Entered ${whenFmt(m.at)}` : null, shareState(key, pid, m)].filter(Boolean).join(' · ')
        : 'This game is no longer on this device';
      return h('li.jam-row', { dataset: { pid } },
        thumb(p),
        h('div.jam-row__t', h('b', { text: title }), h('small', { text: bits })),
        h('div.jam-row__acts',
          p ? btn('play', 'Play', () => api.openApp('forge', { project: pid }), '.btn--sm.btn--primary', { title: 'Open it in Static Forge' }) : null,
          p ? btn('download', 'Save file', () => saveFile(p), '.btn--sm', { title: 'Save a standalone .html copy to send to people' }) : null,
          btn('x', p || loading ? 'Withdraw' : 'Remove', () => withdraw(key, pid, title), '.btn--sm.btn--ghost')));
    }

    function feedRow(e) {
      return h('li.jam-feed__row', { dataset: { from: e.id } },
        h('span.jam-av', { style: { '--hue': String(e.color) }, 'aria-hidden': 'true', text: initialOf(e.name) }),
        h('div.jam-feed__body',
          h('div.jam-feed__line', h('b', { text: e.name }), h('span', { text: ' submitted ' }), h('span.jam-feed__title', { text: `“${e.title}”` })),
          e.description ? h('p.jam-feed__desc', { text: e.description }) : null,
          h('small', { text: `${ago(e.at)} · name not verified` })),
        h('button.btn.btn--sm.btn--ghost.jam-hide', { type: 'button', title: `Hide everything from ${e.name} on this device`, 'aria-label': `Hide ${e.name}`, onclick: () => mute(e) }, icon('eye'), h('span', { text: 'Hide' })));
    }

    function quietText() {
      if (S.status === 'offline') return 'Nothing can be heard while the live channel is offline.';
      if (S.status !== 'live') return 'Connecting to the live channel…';
      return S.askedAt
        ? `Nothing heard yet. Announcements only arrive while Jam is open — when it opened, it asked anyone else with Jam open to repeat their week ${S.wk.week} entries, and nobody has so far.`
        : 'Nothing heard yet. Announcements only arrive while Jam is open.';
    }

    function fillLivePreview(box) {
      clear(box);
      const list = visibleHeard();
      R.statusLine = h('p.jam-statusline');
      fillStatusLine(R.statusLine);
      /* native append prints null as text, so the optional note is filtered */
      box.append(...[
        secHead('Heard on the live channel', list.length > 3 ? more(`All ${list.length}`, 'live') : more('Open', 'live')),
        R.statusLine,
        list.length ? h('ul.jam-feed', list.slice(0, 3).map(feedRow)) : h('p.jam-quiet', { text: quietText() }),
        list.length ? h('p.jam-feednote', { text: 'Only names and titles travel over the channel: StaticOS has no server to host other people’s games, so they can’t be played from here. To play one, ask its creator for the game file (Export .html in Forge).' }) : null,
      ].filter(Boolean));
    }

    function viewWeek() {
      const wk = S.wk;
      const mood = moodOf(wk.theme);
      const mine = subsFor(wk.key).map(pid => ({ pid, p: projectById(pid), meta: logFor(wk.key, pid) }));
      R.livePreview = h('section.jam-sec');
      fillLivePreview(R.livePreview);
      return [
        hero(wk, mood),
        steps(wk, mine),
        mine.length ? h('section.jam-sec', secHead(`Your entries for week ${wk.week}`, more('All entries', 'entries')), h('ul.jam-rows', mine.map(e => entryRow(wk.key, e.pid)))) : null,
        R.livePreview,
        h('p.jam-foot', { text: `Static Jam is a theme picked from the calendar week — every StaticOS device shows “${wk.theme}” this week. There’s no server: no judging, votes, prizes or entrant counts. Your entries are recorded on this device, and announcements reach only people who have Jam open at the time.` }),
      ];
    }

    /* ---- submit ---- */
    function viewSubmit() {
      const wk = S.wk;
      const mood = moodOf(wk.theme);
      const head = h('div.jam-mini', { dataset: { pat: mood.pat }, style: { '--h1': String(mood.h1), '--h2': String(mood.h2) } },
        h('div.jam-mini__glyph', { 'aria-hidden': 'true' }, icon(mood.icon)),
        h('div.jam-mini__t',
          h('small', { text: `Week ${wk.week} · ${rangeFmt(wk)}` }),
          h('b', { text: wk.theme })),
        R.miniLeft = h('div.jam-mini__left', { text: `Closes ${dayFmt(wk.end)} · ${shortLeft(wk.end - Date.now())} left` }));
      if (S.projects === null) return [head, h('div.jam-loading', h('div.spinner'), h('span', { text: 'Loading your games…' }))];
      if (!S.projects.length) {
        return [head, h('div.empty.jam-empty', icon('sparkles'),
          h('b', { text: S.projErr ? 'Your games couldn’t be read' : 'No games on this device yet' }),
          h('small', { text: S.projErr ? 'This browser blocked the storage Forge uses, so there is nothing to enter.' : `Make something for “${wk.theme}” in Static Forge, then come back here to enter it.` }),
          btn('sparkles', 'Start a game for this theme', () => startTheme(wk.theme), '.btn--primary', { disabled: !hasForge() }))];
      }
      R.pickList = h('div.jam-pick', { role: 'group', 'aria-label': 'Your games' });
      R.form = h('div.jam-form');
      paintPickList();
      paintForm();
      return [head, h('div.jam-submit',
        h('div.jam-submit__col', h('div.label', { text: 'Choose a game' }), R.pickList),
        h('div.jam-submit__col', h('div.label', { text: 'Your entry' }), R.form))];
    }

    function paintPickList() {
      if (!R.pickList) return;
      const entered = new Set(subsFor(S.wk.key));
      if (S.pick && (!projectById(S.pick) || entered.has(S.pick))) S.pick = null;
      clear(R.pickList);
      for (const p of S.projects || []) {
        const isIn = entered.has(p.id);
        const on = S.pick === p.id;
        R.pickList.append(h(`button.jam-pickrow${on ? '.is-on' : ''}${isIn ? '.is-in' : ''}`, {
          type: 'button', dataset: { pid: p.id }, 'aria-pressed': on ? 'true' : 'false', disabled: isIn,
          onclick: () => pick(p.id),
        },
          thumb(p),
          h('div.jam-pickrow__t',
            h('b', { text: titleOf(p) }),
            h('small', { text: isIn ? `Entered for week ${S.wk.week}` : `Changed ${ago(p.updatedAt)} · ${plural(p.versions?.length || 1, 'version')}` })),
          isIn ? h('span.jam-tag', icon('check'), h('span', { text: 'Entered' })) : h('span.jam-pickrow__radio', { 'aria-hidden': 'true' })));
      }
    }

    function pick(id) {
      const p = projectById(id);
      if (!p || subsFor(S.wk.key).includes(id)) return;
      S.pick = id;
      S.draft = { pid: id, title: titleOf(p), description: descOf(p), share: true };
      paintPickList();
      paintForm();
      if (R.form?.isConnected && document.body.classList.contains('is-mobile')) R.form.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    }

    function paintForm() {
      if (!R.form) return;
      clear(R.form);
      const p = projectById(S.pick);
      if (!p) {
        R.form.append(h('div.jam-form__hint', icon('arrow-left'), h('span', { text: 'Choose one of your games to enter it for this week.' })));
        return;
      }
      if (!S.draft || S.draft.pid !== p.id) S.draft = { pid: p.id, title: titleOf(p), description: descOf(p), share: true };
      const d = S.draft;
      const count = h('small.jam-count');
      const setCount = () => { count.textContent = `${d.description.length}/${DESC_MAX}`; };
      const title = h('input.jam-in', { id: `${uid}-title`, type: 'text', maxlength: String(TITLE_MAX), autocomplete: 'off', spellcheck: 'true' });
      title.value = d.title;
      const desc = h('textarea.jam-in.jam-in--area', { id: `${uid}-desc`, rows: '3', maxlength: String(DESC_MAX), placeholder: 'One or two lines: what you do, what makes it fit the theme.' });
      desc.value = d.description;
      setCount();
      const sw = h('button.switch', { type: 'button', role: 'switch', 'aria-labelledby': `${uid}-share`, 'aria-checked': String(d.share), class: d.share ? 'is-on' : null });
      const submit = btn('flame', `Enter it for week ${S.wk.week}`, () => doSubmit(p), '.btn--primary.jam-submit__go');
      const sync = () => { submit.disabled = !tidy(d.title, TITLE_MAX); };
      title.addEventListener('input', () => { d.title = title.value; sync(); });
      desc.addEventListener('input', () => { d.description = desc.value.slice(0, DESC_MAX); setCount(); });
      sw.addEventListener('click', () => {
        d.share = !d.share;
        sw.classList.toggle('is-on', d.share);
        sw.setAttribute('aria-checked', String(d.share));
        shareNote.textContent = shareText(d.share);
      });
      const shareText = on => (on
        ? `Sends your display name (${me().name}), this title and description to anyone with Jam open — now, and again when someone opens Jam this week while yours is open too. Names aren’t verified and nothing is kept on a server.`
        : 'Recorded on this device only. Nobody else hears about it.');
      const shareNote = h('small.jam-form__note', { text: shareText(d.share) });
      sync();
      R.form.append(
        h('div.jam-form__game', thumb(p), h('div', h('b', { text: titleOf(p) }), h('small', { text: `${plural(p.versions?.length || 1, 'version')} · changed ${ago(p.updatedAt)}` }))),
        h('label.jam-field', { for: `${uid}-title` }, h('span', { text: 'Title' }), title),
        h('label.jam-field', { for: `${uid}-desc` }, h('span.jam-field__row', h('span', { text: 'Description' }), count), desc),
        h('div.jam-form__share',
          h('div.jam-form__sharet', h('b', { id: `${uid}-share`, text: 'Announce on the public live channel' }), shareNote),
          sw),
        h('div.jam-form__acts',
          submit,
          btn('external-link', 'Open in Forge', () => api.openApp('forge', { project: p.id }), '.jam-form__open')));
    }

    function doSubmit(p) {
      const d = S.draft;
      const key = S.wk.key;
      if (!d || d.pid !== p.id) return;
      const ids = subsFor(key);
      if (ids.includes(p.id)) return;
      const title = tidy(d.title, TITLE_MAX) || titleOf(p);
      const description = tidy(d.description, DESC_MAX);
      writeSubs(key, [...ids, p.id]);
      writeLog(key, p.id, { at: Date.now(), title, description, share: !!d.share, sent: 0 });
      if (d.share) announce(p.id);
      S.pick = null;
      S.draft = null;
      note({
        title: `“${title}” is entered for week ${S.wk.week}`,
        message: !d.share ? 'Recorded on this device. It wasn’t announced.'
          : live.status() === 'live' ? 'Announced on the public live channel to anyone with Jam open.'
            : 'Recorded on this device. It will be announced when the live channel connects.',
      });
      go('week');
    }

    async function withdraw(key, pid, title) {
      const cur = key === S.wk.key;
      const m = logFor(key, pid);
      const ok = await api.confirm({
        title: `Withdraw “${title}”?`,
        message: `It comes out of your ${cur ? `week ${S.wk.week}` : `week ${(WEEK_RE.exec(key) || [])[2] || ''}`} entries. ${cur && m?.sent ? 'Anyone with Jam open right now is told it was withdrawn, though people who already saw it may remember it. ' : ''}The game itself stays in Forge.`,
        ok: 'Withdraw', danger: true,
      });
      if (!ok || dead) return;
      writeSubs(key, subsFor(key).filter(x => x !== pid));
      writeLog(key, pid, null);
      for (let i = Q.length - 1; i >= 0; i--) if (Q[i].pid === pid && Q[i].kind === 'sub') Q.splice(i, 1);
      if (cur && m?.sent) enqueue({ topic: topicOf(key), kind: 'gone', pid, build: () => JSON.stringify({ id: me().id, gone: m.at }) });
      paint();
    }

    function saveFile(p) {
      const html = Projects.current(p);
      if (!html) { note({ icon: 'alert', title: 'Nothing to save yet', message: `“${titleOf(p)}” has no code yet. Open it in Forge first.` }); return; }
      const safe = s => String(s).replace(/--+/g, '—').replace(/[<>]/g, '');
      const stamp = `<!-- ${safe(p.name)} — made with Static Forge in StaticOS, entered in Static Jam. Saved ${new Date().toISOString().slice(0, 10)}. Open this file in any browser to play. -->`;
      const out = /^\s*<!doctype[^>]*>/i.test(html) ? html.replace(/^(\s*<!doctype[^>]*>)/i, `$1\n${stamp}`) : `${stamp}\n${html}`;
      const url = URL.createObjectURL(new Blob([out], { type: 'text/html' }));
      const a = h('a', { href: url, download: `${slug(p.name)}.html` });
      document.body.append(a);
      a.click();
      a.remove();
      urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 5000));
      note({ icon: 'download', title: `Saved ${slug(p.name)}.html`, message: 'A standalone file that runs in any browser — send it to people so they can play your entry. Forge’s Import .html opens it too.' });
    }

    /* ---- your entries ---- */
    function viewEntries() {
      const subs = readSubs();
      const keys = Object.keys(subs).sort(weekOrder);
      if (!keys.length) {
        return h('div.empty.jam-empty', icon('bookmark'),
          h('b', { text: 'No entries yet' }),
          h('small', { text: `Games you enter are listed here, week by week. This week’s theme is “${S.wk.theme}”.` }),
          btn('upload', 'Submit a game', () => go('submit'), '.btn--primary'));
      }
      return keys.map((key, i) => {
        const j = jamOfKey(key);
        const cur = key === S.wk.key;
        const tag = h(`span.jam-tag${cur ? '.is-now' : ''}`, { text: cur ? `Open · ${shortLeft(S.wk.end - Date.now())} left` : j && j.end <= Date.now() ? 'Closed' : 'Upcoming' });
        if (cur) R.lefts.push({ el: tag, text: left => `Open · ${shortLeft(left)} left` });
        return h(`section.jam-sec${i === 0 ? '.jam-sec--first' : ''}`,
          secHead(j ? `Week ${j.week}${j.year !== S.wk.year ? ` · ${j.year}` : ''} · ${j.theme}` : key, tag),
          j ? h('p.jam-sub', { text: rangeFmt(j) }) : null,
          h('ul.jam-rows', subs[key].map(pid => entryRow(key, pid))));
      });
    }

    /* ---- heard live ---- */
    function fillLive(box) {
      clear(box);
      const list = visibleHeard();
      box.append(list.length
        ? h('ul.jam-feed.jam-feed--full', list.map(feedRow))
        : h('div.empty.jam-empty.jam-empty--sm', icon('activity'), h('b', { text: 'No announcements heard' }), h('small', { text: quietText() })));
    }

    function meRow() {
      const m = me();
      if (S.naming) {
        const input = h('input.jam-in', { type: 'text', maxlength: '24', 'aria-label': 'Your display name', autocomplete: 'nickname', spellcheck: 'false' });
        input.value = m.name;
        const save = () => { setName(input.value); S.naming = false; paint(); };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); S.naming = false; paint(); }
        });
        setTimeout(() => { if (input.isConnected) { input.focus(); input.select(); } }, 0);
        return h('div.jam-me.is-editing', h('span.jam-av', { style: { '--hue': String(m.color) }, 'aria-hidden': 'true', text: initialOf(m.name) }), input,
          btn('check', 'Save', save, '.btn--sm.btn--primary'), btn(null, 'Cancel', () => { S.naming = false; paint(); }, '.btn--sm.btn--ghost'));
      }
      return h('div.jam-me',
        h('span.jam-av', { style: { '--hue': String(m.color) }, 'aria-hidden': 'true', text: initialOf(m.name) }),
        h('div.jam-me__t', h('small', { text: 'You appear as' }), h('b', { text: m.name })),
        btn('edit-3', 'Change name', () => { S.naming = true; paint(); }, '.btn--sm.btn--ghost'));
    }

    /* people hidden on this device, with the way back — refreshed in place
       like the lists, so "Show again" is there the moment someone is hidden */
    function fillHidden(box) {
      clear(box);
      const muted = readMuted();
      if (!muted.length) return;
      box.append(secHead('Hidden people'),
        h('ul.jam-hidden', muted.map(m => h('li', h('span', { text: m.name }), btn('eye', 'Show again', () => unmute(m.id), '.btn--sm.btn--ghost')))));
    }

    function viewLive() {
      R.statusCard = h('div.jam-status');
      fillStatusCard(R.statusCard);
      R.liveList = h('div.jam-livelist');
      fillLive(R.liveList);
      R.hiddenBox = h('section.jam-sec.jam-hiddenbox');
      fillHidden(R.hiddenBox);
      return [
        h('div.jam-livehead', R.statusCard, meRow()),
        h('div.jam-notice', icon('info'),
          h('div', h('b', { text: 'A public live channel — no accounts, no history' }),
            h('p', { text: `You only hear announcements sent while this window is open (when it opens, it asks anyone else with Jam open to repeat theirs). Nothing is stored on a server, and names are whatever people typed — they are not verified. This list is week ${S.wk.week}, “${S.wk.theme}”.` }))),
        secHead('Heard this week'),
        R.liveList,
        h('div.jam-notice.jam-notice--plain', icon('help-circle'),
          h('div', h('b', { text: 'Why can’t I play these?' }),
            h('p', { text: 'StaticOS has no server to host other people’s games, so an announcement is only a name and a title. To show a game off, its creator shares the game file itself: Save file on an entry here, or Export .html in Static Forge. The file runs in any browser, and Forge’s Import .html opens it.' }))),
        R.hiddenBox,
      ];
    }

    /* ---- themes ---- */
    /* This week first, then the three ahead, then the six before it (newest
       first): the calendar is read from "now", not scrolled to it. */
    function viewThemes() {
      const subs = readSubs();
      const now = Date.now();
      const row = k => {
        const j = jamOffset(S.wk, k);
        const mood = moodOf(j.theme);
        const n = (subs[j.key] || []).length;
        const state = k === 0 ? `Open · ${shortLeft(j.end - now)} left`
          : k < 0 ? (n ? `Closed · ${plural(n, 'entry', 'entries')} from you` : 'Closed')
            : k === 1 ? `Next · starts ${dayFmt(j.start)}` : `Starts ${dayFmt(j.start)}`;
        const tag = k < 0 && n ? h('button.jam-tag.jam-tag--btn', { type: 'button', onclick: () => go('entries'), title: 'See your entries' }, h('span', { text: state }))
          : h(`span.jam-tag${k === 0 ? '.is-now' : ''}`, { text: state });
        if (k === 0) R.lefts.push({ el: tag, text: left => `Open · ${shortLeft(left)} left` });
        return h(`li.jam-sched__row${k === 0 ? '.is-now' : ''}${k < 0 ? '.is-past' : ''}`, { dataset: { week: j.key }, style: { '--h1': String(mood.h1), '--h2': String(mood.h2) } },
          h('div.jam-sched__glyph', { 'aria-hidden': 'true' }, icon(mood.icon)),
          h('div.jam-sched__t', h('b', { text: j.theme }), h('small', { text: `Week ${j.week}${j.year !== S.wk.year ? ` · ${j.year}` : ''} · ${rangeFmt(j)}` })),
          tag,
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Make a game for this theme', 'aria-label': `Make a game for “${j.theme}” in Static Forge`, disabled: !hasForge(), onclick: () => startTheme(j.theme) }, icon('sparkles')));
      };
      return [
        h('p.jam-lede', { text: 'This week’s theme, the three after it and the six before. Past and future themes still make good prompts — only this week takes entries.' }),
        h('section.jam-sec.jam-sec--first', secHead('This week'), h('ol.jam-sched', row(0))),
        h('section.jam-sec', secHead('Coming up'), h('ol.jam-sched', [1, 2, 3].map(row))),
        h('section.jam-sec', secHead('Past weeks'), h('ol.jam-sched', [-1, -2, -3, -4, -5, -6].map(row))),
        h('p.jam-foot', { text: `Themes come from a fixed list of ${JAM_THEMES.length}, chosen by the ISO week number, so every StaticOS device shows the same one in the same week. Nobody picks them, and nobody judges the entries.` }),
      ];
    }

    const VIEWS = { week: viewWeek, submit: viewSubmit, entries: viewEntries, live: viewLive, themes: viewThemes };

    function paint(resetScroll) {
      if (dead) return;
      cancelAnimationFrame(fullQ); fullQ = 0;
      cancelAnimationFrame(paintQ); paintQ = 0;
      const keep = resetScroll ? 0 : content.scrollTop;
      for (const k of Object.keys(R)) delete R[k];
      R.lefts = [];
      syncSide();
      barTitle.textContent = SECTIONS.find(s => s.id === S.sec).label;
      clear(content);
      content.dataset.sec = S.sec;
      content.append(...[VIEWS[S.sec]()].flat().filter(Boolean));
      content.scrollTop = keep;
      tick();
    }
    /* a new announcement repaints only the lists that show them, never a
       form or the name field someone may be typing in */
    function soonLive() {
      if (dead || paintQ) return;
      paintQ = requestAnimationFrame(() => {
        paintQ = 0;
        if (dead) return;
        syncSide();
        if (R.livePreview?.isConnected) fillLivePreview(R.livePreview);
        if (R.liveList?.isConnected) fillLive(R.liveList);
        if (R.hiddenBox?.isConnected) fillHidden(R.hiddenBox);
      });
    }
    function soon() {
      if (dead || fullQ) return;
      fullQ = requestAnimationFrame(() => { fullQ = 0; paint(); });
    }

    async function refresh() {
      let list = [];
      try { list = await Projects.list(); S.projErr = false; } catch (e) { S.projErr = true; }
      if (dead) return;
      S.projects = list;
      /* never rebuild a form someone is typing in */
      if (S.sec === 'submit' && R.pickList?.isConnected) {
        paintPickList();
        if (!projectById(S.pick)) paintForm();
        syncSide();
      } else if (S.sec !== 'live') paint();
      else syncSide();
    }
    const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(refresh, 120); };

    /* ---------------- wiring ---------------- */
    win.setSubtitle(`Week ${S.wk.week} · ${S.wk.theme}`);
    paintStatus();
    paint(true);
    refresh();
    subscribe();
    const tickT = setInterval(tick, 1000);
    const offs = [
      live.onStatus(st => {
        if (dead) return;
        const was = S.status;
        S.status = st;
        paintStatus();
        if (st === 'live') { ask(); announcePending(); pump(); }
        if (was !== st) { changed(); soonLive(); }
      }),
      bus.on('projects:change', refreshSoon),
      store.sub(KEY, () => {
        if (S.sec !== 'submit') { soon(); return; }
        const had = S.pick;
        paintPickList();
        if (had && !S.pick) paintForm();
        syncSide();
      }),
      store.sub(MUTE, soonLive),
      store.sub('portal.identity', () => { if (S.sec === 'live' && !S.naming) soon(); }),
    ];

    win.onReopen(o => {
      if (dead || !o) return;
      if (typeof o.project === 'string' && o.project) { S.pick = o.project; S.draft = null; go('submit'); }
      else if (isSection(o.section)) go(o.section);
    });

    return () => {
      dead = true;
      clearInterval(tickT);
      clearTimeout(pumpT);
      clearTimeout(answerT);
      clearTimeout(askT);
      clearTimeout(refreshT);
      cancelAnimationFrame(paintQ);
      cancelAnimationFrame(fullQ);
      Q.length = 0;
      offTopic?.();
      offTopic = null;
      offs.forEach(f => { try { f?.(); } catch (e) { /* already gone */ } });
      for (const [url, t] of urls) { clearTimeout(t); URL.revokeObjectURL(url); }
      urls.clear();
      S.heard.clear();
    };
  },
});
