/* ============================================================
   friends.js — private friends, their presence and status, and
   game nights (#144, #145, #149). Static Social's Friends view
   (js/apps/social-friends.js) is its face; this module is what
   keeps running with that window closed.

   WHO YOU ARE. Each browser makes one ECDH P-256 key pair the
   first time Friends is used, kept in store('portal.friends').
   Nothing else identifies you: no account, no server, no list.

   ADDING A FRIEND — only by a code (or its link) that both people
   deliberately pass on. There is no search and no directory.
     · Your friend code is 8 symbols, made from your public key and
       a random salt r: code = PBKDF2(pub ‖ r). "New code" picks a
       new r, so an old code stops taking requests.
     · The code is also stretched into a topic and an AES-GCM key
       (PBKDF2 again, salted differently): the code's "inbox". A
       request ('req') is sealed with that key, so the broker sees
       a hashed topic and sealed bytes, not the code or the names.
     · The owner sees the requester's name and picture and chooses
       Accept, Decline or Block. The answer ('acc' / 'dec') carries
       the owner's public key and r: the requester re-derives the
       code from them (someone else who knows the code can't answer
       for its owner), and a proof sealed with the pair key (below)
       shows the answer came from that key's holder.
   Names are still whatever people typed — accept only people you
   gave your code to; the view says so.

   PRESENCE — friends only. Each friendship gets its own topic and
   AES-GCM key from ECDH(my private key, their public key) through
   HKDF. Nobody else — including people who know your code — can
   read it. Every HEARTBEAT_MS each friend is sent
     hb { st, n, c, s?, e?, x?, g?, ph, q? }
   st online|away|busy, your name and colour, your status text,
   emoji and when it ends, the game you're playing ONLY if you
   switched that on (off by default), and a hash of your picture
   (they ask for it with 'pq' when it changed; 'pro' answers).
   Invisible (identity status) sends nothing and tells friends
   'off' once. A friend unheard for OFFLINE_MS is offline; "last
   seen" is only ever the time a real heartbeat arrived. Closing
   the page says nothing — friends see you go offline when your
   heartbeats stop (a goodbye can't be sealed in time on pagehide).

   GAME NIGHTS — 'ev' { id, ti, g:{k,i}, w (start), len, inv, rs, pc, x, u }
   (the whole night, from its host) and 'rsvp' { id, r }
   (a guest's answer, to the host) on the pair topics. The host's
   copy is authoritative: a guest only takes a night from its host,
   and only newer versions of it. Reminders go to the reminder
   engine (automations.syncSourceReminders, src 'friends'): 15
   minutes before and at the start, for the host and for guests who
   didn't say no. At the start the host opens the night's room — for
   a two-player online Arcade game with one friend an Arcade room
   (apps/arcade.js { online, host }, bus 'arcade:room'), otherwise a
   Static Party with the game chosen — and its code goes to the
   people invited; a guest's Join opens that room or party.
   Nothing received ever opens or joins anything by itself.

   MEDIA LINKS — 'med' { k, i, ti, hd? } to ONE friend, by hand: k is spotify
   (i = "playlist:<id>" and the like), tiktok (i = the video id, hd = the @handle
   that was in the link) or drop (i = a six-character Static Drop code). It is a
   pointer, never the media: nothing is downloaded, relayed or embedded for them.
   The receiver checks the shape of i, takes at most one every few seconds from
   a friend, and shows a notice with Add (Spotify, TikTok) and/or Open. Nothing
   plays, opens or joins until they press one; a Drop code only fills the Receive
   box, and the files still need their Accept.

   PROFILE CARD — 'card' { b, g[], a[], c[] } (bio, up to 3 games,
   3 pinned achievements, 3 pinned creations — titles only, each
   cleaned and capped) or { x: 1 } to take it back. Off unless the
   person sends it: the Profile app builds the card from what they
   ticked, shows exactly that, and calls sendCard(); nothing here ever
   sends one by itself, not even on a heartbeat. A friend's card is
   kept on that friend's record (shown in Profile › From friends) and
   goes when they are removed.

   STATIC ARCADE — 'arc' { k, … }: a best score shared for friends'
   leaderboards, a Beat-this round, a cup bracket or a cup match score,
   only ever sent when the person presses a button in the Arcade
   (sendArcade). js/arcade/friendplay.js checks and keeps them.

   STAR, GROUPS, WEEKLY NIGHTS. A star (fav) and a group (a name and some friends) are
   kept on this device only. A group is a shortcut to invite or poll several friends:
   a game night goes to each member as an ordinary night, a poll goes to each as a Static
   Chat direct message. A night can repeat weekly: the host's copy moves on a week once
   it is over, "skip this week" moves it on early (and tells guests), and Calendar can
   hold it (repeating, with the skipped week left out).

   WHAT FRIENDS CHOOSE TO SHARE — 'shr' { r?, fv?, b? } to every friend, and only the
   parts the person switched on in Friends (all off until then): r the games played
   lately (kind + id, up to 8), fv favourite Static Games (ids, up to 30), b a birthday
   as --MM-DD (no year). null takes a part back. The receiver shows its own titles for
   the ids, keeps what arrived on that friend's record, and compares favourites with
   its own ("games you both favourited"). A birthday that was shared sets a reminder in
   Automations (src 'friends', 9 AM on the day) unless reminders are switched off.

   INVITES. 'pin' { c } a Static Party code, 'sin' { c } a Study together room code (see
   js/core/studyroom.js): each becomes a notice with Join, and nothing opens or joins
   until it is pressed. Only a friend's device can send one (their sealed topic).

   SAFETY — every topic is public, so anything can arrive:
     · text over WIRE_MAX is dropped unread; floods past INBOX_PER_SEC
       (code inboxes) / PAIRS_PER_SEC and FRIEND_PER_SEC (friends) a
       second are dropped before they are unsealed;
     · what doesn't unseal, parse, have v = 1 and a known `t`, or
       pass that type's checks is ignored; an old message replayed
       (its `at` not newer than the last one heard since this page
       loaded, or over a day off this device's clock) is ignored;
     · names, statuses and titles lose control and bidi characters
       and are length-capped; pictures are data: images only, capped;
       a game is kind + id, shown with THIS device's title;
     · blocked keys are refused; at most MAX_INCOMING requests wait
       and NEW_PER_MIN new ones a minute are taken; answers are
       verified at most VERIFY_PER_MIN times a minute;
     · removing or blocking a friend tells their device ('rm') and
       unsubscribes: nothing more is sent or read.

   SAVED per person and per web address (store 'portal.friends', which
   core/profiles.js keeps with the rest of this person's state). Everyone
   on a computer has their own key, code and list. The Surge and AWS
   links are different addresses, so each has its own too. Friends on
   either link can reach each other — the live channel is the same —
   but a friendship lives on the link where it was made. Settings › Back
   up your data moves it; that file holds the private key, and says so.

   NOT FOR A GUEST. A guest gets no key, no code and no presence, and
   nothing of this runs (available()). Their session is in sessionStorage,
   which a browser copies into any tab opened from it, and a friendship
   made there would stop answering the moment the session ended.

     available() · init() · start() · ready()
     ensureCode() · rotateCode() · myCode() · inviteLink(code)
     request(code) · cancelRequest(code) · accept(fp) · decline(fp)
     block(fp) · unblock(fp) · remove(fp) · setNick(fp, nick)
     friends() · incoming() · outgoing() · blocked()
     myStatus() · setStatus({ text, emoji, preset, expiry }) · clearStatus()
     shareGame() · setShareGame(on) · currentGame() · whatFriendsSee()
     sendLink(fp, { kind, id, title }) — a page (Static Games or Roblox) to one friend
     sendMedia(fp, { kind, id, title, handle }) — a Spotify item, a TikTok or a Static Drop code to one friend
     sendDm(fp, body) — a Static Chat message to one friend
     setFavourite(fp, on) · groups() · saveGroup({ id?, name, members }) · deleteGroup(id) · sendGroupPoll(id, poll)
     skipNight(id) · addNightToCalendar(id) · options() · setOption(key, on) · setBirthday(v) · sharing()
     sharedBy(fp) · bothFavourited(fp) · onlineCount() · sendPartyInvite(fp, code) · sendStudyInvite(fp, code) · inviteMessage(code)
     nights() · createNight(d) · rsvp(id, a) · cancelNight(id)
     removeNight(id) · startNight(id) · joinNight(id)
     onChange(fn) -> off · liveStatus() · _debug
   ============================================================ */
import * as live from '../portal/live.js';
import { store } from './store.js';
import { bus } from './bus.js';
import * as identity from './identity.js';
import { ALPHABET } from './roomcode.js';
import { seal, unseal } from './pair.js';
import * as Avatar from './avatar.js';
import * as wm from './wm.js';
import * as AM from './automations.js';
import api from './api.js?v=ps5-cloud-proxy-v11';
import { arcadeById } from '../arcade/index.js';
import { MODE } from './profiles.js';
import { parseChat } from './chatwire.js';
import * as plays from './plays.js';
import { BY_ID, isStation } from './stations.js';

const PUBID_RE = /^[a-z0-9]{8,32}$/;
export const KEY = 'portal.friends';
export const SRC = 'friends';                  /* the reminder engine's source tag */
export const CODE_LEN = 8;
const ROUNDS = 120000;
export const HEARTBEAT_MS = 25_000;
export const OFFLINE_MS = 95_000;              /* a hidden tab may only beat once a minute */
const TICK_MS = 5_000;
const KNOCK_MS = 30_000;
export const IDLE_MS = 5 * 60_000;
const SEEN_SAVE_MS = 5 * 60_000;
const NIGHT_RESEND_MS = 5 * 60_000;
export const REQ_TTL = 7 * 86400_000;
const VIA_TTL = 7 * 86400_000;
const DECLINE_TTL = 86400_000;
const DAY = 86400_000;
export const WIRE_MAX = 20_000;                /* sealed, base64 */
const PLAIN_MAX = 14_000;
export const PIC_MAX = 10_000;
const INBOX_PER_SEC = 40;
const PAIRS_PER_SEC = 240;
const FRIEND_PER_SEC = 20;
const OUT_PER_SEC = 12;
const NEW_PER_MIN = 6;
const VERIFY_PER_MIN = 8;
export const MAX_FRIENDS = 60;
export const MAX_INCOMING = 20;
export const MAX_OUTGOING = 10;
const MAX_BLOCKED = 200;
const MAX_DECLINED = 50;
export const MAX_NIGHTS = 30;
const MAX_NIGHTS_PER_HOST = 10;
export const MAX_INVITE = 20;
export const NAME_MAX = 24;
export const STATUS_MAX = 60;
export const TITLE_MAX = 60;
export const JOIN_EARLY_MS = 10 * 60_000;      /* Join shows this long before the start */

const FP_RE = /^[0-9a-f]{32}$/;
const RQ_RE = /^[a-z0-9]{12}$/;
const PH_RE = /^[0-9a-f]{16}$/;
const NIGHT_ID = /^[a-z0-9]{12}$/;
const GAME_ID = /^[A-Za-z0-9_-]{1,96}$/;
const ANIME_ID = /^[0-9]{1,9}$/;                 /* a MyAnimeList id: an anime night is a title and a time, nothing plays */
const PARTY_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);
export const ANSWERS = ['yes', 'maybe', 'no'];
const INBOX_TYPES = new Set(['req', 'acc', 'dec']);
const PAIR_TYPES = new Set(['hb', 'off', 'pq', 'pro', 'rm', 'ev', 'rsvp', 'lnk', 'card', 'look', 'col', 'rmi', 'med']);
PAIR_TYPES.add('arc');                         /* Static Arcade: see sendArcade() below */
PAIR_TYPES.add('dm');                          /* Static Chat direct messages: see sendDm() below */
PAIR_TYPES.add('shr');                         /* what friends choose to share: recent games, favourites, a birthday */
PAIR_TYPES.add('pin');                         /* a Static Party invite */
PAIR_TYPES.add('sin');                         /* a Study together invite */
PAIR_TYPES.add('wti');                         /* a Watch Together invite */
PAIR_TYPES.add('fbi');                         /* a Flex Battle invite */
PAIR_TYPES.add('pni');                         /* a Static Piano duet invite */
PAIR_TYPES.add('bti');                         /* a Static Beats jam invite */
export const MAX_LOOKS = 10;                   /* looks friends sent, waiting for you to preview */
const LOOK_RE = /^SLOOK1\.[A-Za-z0-9_-]{8,2380}$/;
const STATES = ['online', 'away', 'busy'];
const GROUP_ID = /^[a-z0-9]{8}$/;
const BDAY_RE = /^--(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MAX_GROUPS = 12;
const SHARE_RECENT = 8, SHARE_FAVS = 30;
const SHARE_EVERY_MS = 2 * 60_000;             /* a changed list of recent games goes out at most this often */
const GAME_WINDOWS = new Set(['arcade', 'aether-games']);

/* `expiry` is what picking the preset clears after (the status editor can still change it) */
export const PRESETS = [
  { id: 'studying', text: 'Studying', emoji: '📚', expiry: '1h' },
  { id: 'inclass', text: 'In class', emoji: '🏫', expiry: '1h' },
  { id: 'gaming', text: 'Gaming', emoji: '🎮', expiry: '2h' },
  { id: 'away', text: 'Away', emoji: '🌙', expiry: 'never' },
];
export const EXPIRY = [
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '2h', label: '2 hours' },
  { id: 'today', label: 'Today' },
  { id: 'never', label: 'Never' },
];

/* ---------------- bytes ---------------- */
const enc = new TextEncoder();
const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const rid = (n = 12) => [...rand(n)].map(b => (b % 36).toString(36)).join('');
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(text) {
  if (typeof text !== 'string' || text.length > 4 * PIC_MAX) return null;
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const fpOf = async pubBytes => hex(await sha256(pubBytes)).slice(0, 32);
const parseJson = s => { if (typeof s !== 'string') return null; try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; } };
export const secureOk = () => !!(globalThis.crypto && crypto.subtle);

/* ---------------- text that is safe to keep ---------------- */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const INVIS = /[\u00ad\u200b\u2060\ufeff]/g;          /* ZWJ / ZWNJ stay: emoji and scripts need them */
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
/** One line of someone else's text: no control, bidi or invisible characters, no <>, capped. */
export const cleanLine = (s, max) => String(s ?? '').replace(BIDI, '').replace(INVIS, '').replace(CTRL, ' ')
  .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\ud800-\udbff]$/, '');
export const cleanName = s => cleanLine(s, NAME_MAX);
let seg = null;
const graphemes = s => {
  try { seg = seg || new Intl.Segmenter(undefined, { granularity: 'grapheme' }); return [...seg.segment(s)].map(x => x.segment); }
  catch (e) { return Array.from(s); }
};
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
/** Exactly one emoji, or ''. */
export function cleanEmoji(s) {
  const t = String(s ?? '').replace(BIDI, '').replace(INVIS, '').replace(CTRL, '').trim();
  if (!t || t.length > 16) return '';
  const g = graphemes(t);
  return g.length === 1 && EMOJI_RE.test(t) ? t : '';
}
/** The last emoji typed or picked into a field (the picker inserts at the caret). */
export function lastEmoji(s) {
  const g = graphemes(String(s ?? '').slice(-64)).filter(x => EMOJI_RE.test(x));
  return g.length ? cleanEmoji(g[g.length - 1]) : '';
}
const hue = c => (Number.isFinite(c) ? Math.abs(Math.round(c)) % 360 : 200);
function normPic(v) {
  const p = Avatar.normPicture(v);
  if (p && p.kind === 'upload' && p.dataUrl.length > PIC_MAX) return null;
  return p;
}

/* ---------------- codes ---------------- */
export const isCode = s => CODE_RE.test(String(s || ''));
/** Pull a friend code out of whatever was typed or pasted ("k7qm-2xpa", an invite line, a link). */
export function normCode(input) {
  const s = String(input ?? '').toUpperCase().slice(0, 600);
  const m = /FRIEND=([A-Z0-9]{8})(?![A-Z0-9])/.exec(s);
  if (m) return m[1];
  const flat = s.replace(/[\s\-_.·]/g, '');
  if (flat.length <= CODE_LEN) return flat;
  const re = /(?:^|[^A-Z0-9])([A-Z0-9]{4})[\s\-·]?([A-Z0-9]{4})(?=$|[^A-Z0-9])/g;
  let last = null, mm;
  while ((mm = re.exec(s))) { if (CODE_RE.test(mm[1] + mm[2])) last = mm[1] + mm[2]; re.lastIndex = mm.index + 1; }
  return last || flat.slice(0, 12);
}
export const spaced = code => (isCode(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : String(code || ''));
export function inviteLink(code) {
  try { return `${location.origin}${location.pathname}#friend=${code}`; } catch (e) { return ''; }
}

/* ---------------- derivations ---------------- */
async function pbkdf(bytes, salt, nbits) {
  const base = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ROUNDS }, base, nbits));
}
/** A code is bound to its owner's key: PBKDF2(pub ‖ r) → 8 symbols. */
async function codeFrom(pubBytes, rBytes) {
  const bits = await pbkdf(concat(pubBytes, rBytes), 'staticos/friends/v1/code', 64);
  let out = '', acc = 0, nb = 0, i = 0;
  while (out.length < CODE_LEN) {
    if (nb < 5) { acc = (acc << 8) | bits[i++]; nb += 8; }
    nb -= 5;
    out += ALPHABET[(acc >> nb) & 31];
    acc &= (1 << nb) - 1;
  }
  return out;
}
const inboxCache = new Map();
function deriveInbox(code) {
  if (inboxCache.has(code)) return inboxCache.get(code);
  const p = (async () => {
    const bits = await pbkdf(enc.encode(code), 'staticos/friends/v1/inbox', 352);
    const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { key, topic: `fr/${hex(bits.slice(32, 44))}` };
  })();
  inboxCache.set(code, p);
  p.catch(() => inboxCache.delete(code));
  if (inboxCache.size > 40) inboxCache.delete(inboxCache.keys().next().value);
  return p;
}
const pairCache = new Map();
function derivePair(theirPub) {
  if (pairCache.has(theirPub)) return pairCache.get(theirPub);
  const p = (async () => {
    const theirKey = await crypto.subtle.importKey('raw', unb64(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, R.priv, 256);
    const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
    const [a, b] = [R.pub, theirPub].sort();
    const salt = await sha256(enc.encode(`${a}|${b}`));
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('staticos/friends/v1/pair') }, hk, 352));
    const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { key, topic: `fr/${hex(bits.slice(32, 44))}` };
  })();
  pairCache.set(theirPub, p);
  p.catch(() => pairCache.delete(theirPub));
  if (pairCache.size > 200) pairCache.delete(pairCache.keys().next().value);
  return p;
}
/** 65 bytes, uncompressed P-256 point — or null. */
function pubBytesOf(s) {
  if (typeof s !== 'string' || s.length !== 88) return null;
  const b = unb64(s);
  return b && b.length === 65 && b[0] === 4 ? b : null;
}
async function validPub(bytes) {
  try { await crypto.subtle.importKey('raw', bytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []); return true; } catch (e) { return false; }
}

/* ---------------- saved state ---------------- */
function D() {
  const v = store.get(KEY, null);
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const arr = (a, ok) => (Array.isArray(a) ? a.filter(x => x && typeof x === 'object' && ok(x)) : []);
  return {
    v: 1,
    me: o.me && typeof o.me === 'object' ? o.me : null,
    code: o.code && typeof o.code === 'object' && isCode(o.code.code) && typeof o.code.r === 'string' ? o.code : null,
    friends: arr(o.friends, x => FP_RE.test(x.fp) && typeof x.pk === 'string'),
    incoming: arr(o.incoming, x => FP_RE.test(x.fp) && typeof x.pk === 'string' && isCode(x.code) && typeof x.r === 'string'),
    outgoing: arr(o.outgoing, x => isCode(x.code) && RQ_RE.test(x.rq)),
    blocked: arr(o.blocked, x => FP_RE.test(x.fp)),
    declined: arr(o.declined, x => FP_RE.test(x.fp) && isCode(x.code) && typeof x.r === 'string'),
    status: o.status && typeof o.status === 'object' ? o.status : null,
    shareGame: o.shareGame === true,
    nights: arr(o.nights, x => NIGHT_ID.test(x.id) && FP_RE.test(x.host) && x.game && typeof x.game === 'object'),
    looks: arr(o.looks, x => typeof x.id === 'string' && FP_RE.test(x.fp) && LOOK_RE.test(x.code || '')),
    groups: arr(o.groups, x => GROUP_ID.test(x.id) && Array.isArray(x.members)),
    opts: normOpts(o.opts),
  };
}
/** Settings in Friends. Everything that shares something new is off until it is switched on. */
function normOpts(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    dndBusy: o.dndBusy === true, showCount: o.showCount !== false, remindBirthdays: o.remindBirthdays !== false,
    shareRecent: o.shareRecent === true, shareFavs: o.shareFavs === true, shared: o.shared === true, birthday: BDAY_RE.test(o.birthday || '') ? o.birthday : '',
  };
}
function save(patch) {
  store.set(KEY, { ...D(), ...patch });
  changed();
}
const friendOf = fp => D().friends.find(f => f.fp === fp) || null;
function patchFriend(fp, patch) {
  const d = D();
  let hit = false;
  const list = d.friends.map(f => {
    if (f.fp !== fp) return f;
    for (const k of Object.keys(patch)) if (JSON.stringify(f[k]) !== JSON.stringify(patch[k])) { hit = true; break; }
    return hit ? { ...f, ...patch } : f;
  });
  if (hit) save({ friends: list });
}

/* ---------------- runtime ---------------- */
const R = {
  started: false, ready: null, failed: null,
  priv: null, pub: '', pubBytes: null, fp: '',
  pairs: new Map(),                 /* fp -> pair */
  inboxes: new Map(),               /* code -> { code, kinds, key, topic, unsub, q } */
  stats: { heard: 0, dropped: 0, ignored: 0, refused: 0, sent: 0 },
  inWin: { at: 0, n: 0 }, pairWin: { at: 0, n: 0 },
  newReqs: [], verifies: [], replied: new Map(),
  outq: Promise.resolve(), lastSentAt: 0,
  tick: 0, soonT: 0, expT: 0, lastBeat: 0, lastKnock: 0, lastNightSend: 0,
  sentState: null, sentGame: null, offSent: false,
  input: Date.now(), ph: '', picCache: { src: null, out: null },
  offs: [],
};
const subs = new Set();
let emitQ = false;
function changed() {
  if (emitQ) return;
  emitQ = true;
  queueMicrotask(() => { emitQ = false; try { announceCount(); } catch (e) { /* not started */ } subs.forEach(fn => { try { fn(); } catch (e) { console.error('[friends]', e); } }); });
}
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }

function win(w, max) {
  const now = performance.now();
  if (now - w.at > 1000) { w.at = now; w.n = 0; }
  return ++w.n <= max;
}
/** at most `n` in the last minute */
function perMinute(list, n) {
  const now = Date.now();
  while (list.length && now - list[0] > 60_000) list.shift();
  if (list.length >= n) return false;
  list.push(now);
  return true;
}
function mayReply(k, gap) {
  const now = performance.now();
  if (now - (R.replied.get(k) ?? -1e12) < gap) return false;
  R.replied.set(k, now);
  if (R.replied.size > 500) R.replied.delete(R.replied.keys().next().value);
  return true;
}
const notify = n => { try { api.notify({ app: 'social', icon: 'users', timeout: 8000, ...n }); } catch (e) { /* no shell */ } };
const openSocial = o => { try { api.openApp('social', { friends: true, ...o }); } catch (e) { /* no shell */ } };

/* ---------------- keys ---------------- */
async function loadKeys() {
  if (!secureOk()) throw new Error('insecure');
  const d = D();
  if (d.me && typeof d.me.pub === 'string' && d.me.priv && typeof d.me.priv === 'object') {
    try {
      const pubBytes = pubBytesOf(d.me.pub);
      if (pubBytes) {
        R.priv = await crypto.subtle.importKey('jwk', d.me.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        R.pub = d.me.pub; R.pubBytes = pubBytes; R.fp = await fpOf(pubBytes);
        return;
      }
    } catch (e) { /* unreadable: make a new pair below */ }
  }
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pubBytes = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  R.priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  R.pub = b64(pubBytes); R.pubBytes = pubBytes; R.fp = await fpOf(pubBytes);
  save({ me: { pub: R.pub, priv: jwk } });
}

/* ---------------- my picture, small enough to send ---------------- */
async function shrink(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  for (const [size, q] of [[64, 0.82], [48, 0.7], [40, 0.6]]) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= PIC_MAX) return { kind: 'upload', dataUrl: url };
  }
  return null;
}
async function myPic() {
  const { picture, costume } = Avatar.read();
  if (!picture) return { pic: null, cos: costume };
  if (picture.kind !== 'upload') return { pic: picture, cos: costume };
  if (R.picCache.src !== picture.dataUrl) {
    let out = null;
    try { out = await shrink(picture.dataUrl); } catch (e) { out = null; }
    R.picCache = { src: picture.dataUrl, out };
  }
  return { pic: R.picCache.out, cos: costume };
}
async function refreshPh() {
  const p = await myPic();
  const ph = hex(await sha256(enc.encode(JSON.stringify([p.pic, p.cos])))).slice(0, 16);
  if (ph !== R.ph) { R.ph = ph; soonBeat(); }
}
async function profileBody() {
  const m = identity.me();
  const p = await myPic();
  return { n: cleanName(m.name), c: hue(m.color), pic: p.pic, cos: p.cos };
}

/* ---------------- sending ---------------- */
async function publishSealed(key, topic, obj) {
  const text = JSON.stringify(obj);
  if (text.length > PLAIN_MAX) return false;
  const sealed = await seal(key, text);
  R.stats.sent++;
  return live.publish(topic, sealed);
}
function sendPair(p, t, body = {}) {
  if (!p || p.closed || !p.key) return false;
  if (!win(p.outWin, OUT_PER_SEC)) return false;
  R.lastSentAt = Math.max(Date.now(), R.lastSentAt + 1);
  /* the envelope last: nothing in a body can stand in for who sent it, or when */
  const text = JSON.stringify({ ...body, v: 1, t, f: R.fp, at: R.lastSentAt });
  if (text.length > PLAIN_MAX) return false;
  const { key, topic } = p;
  R.outq = R.outq.then(async () => { try { live.publish(topic, await seal(key, text)); R.stats.sent++; } catch (e) { /* gone */ } });
  return live.status() === 'live';
}
/** acc / dec on a code's inbox, with the proof only the code's owner can make */
async function sendAnswer(t, { code, r, fp, pk, rq }) {
  if (!isCode(code) || typeof r !== 'string' || !pubBytesOf(pk) || !RQ_RE.test(rq || '')) return false;
  const inbox = await deriveInbox(code);
  const pair = await derivePair(pk);
  const proof = await seal(pair.key, JSON.stringify({ t: 'proof', k: t, to: fp, by: R.fp, rq }));
  const body = { v: 1, t, to: fp, pk: R.pub, r, rq, proof, at: Date.now() };
  if (t === 'acc') Object.assign(body, await profileBody());
  return publishSealed(inbox.key, inbox.topic, body);
}

/* ---------------- inboxes (codes) ---------------- */
async function openInbox(code, kind) {
  const have = R.inboxes.get(code);
  if (have) { have.kinds.add(kind); return; }
  const e = { code, kinds: new Set([kind]), key: null, topic: null, unsub: null, q: Promise.resolve() };
  R.inboxes.set(code, e);
  try {
    const d = await deriveInbox(code);
    if (R.inboxes.get(code) !== e) return;
    e.key = d.key;
    e.topic = d.topic;
    e.unsub = live.subscribe(d.topic, text => onInboxText(e, text));
  } catch (err) { R.inboxes.delete(code); }
}
function closeInbox(code, kind) {
  const e = R.inboxes.get(code);
  if (!e) return;
  e.kinds.delete(kind);
  if (e.kinds.size) return;
  R.inboxes.delete(code);
  try { e.unsub?.(); } catch (err) { /* gone */ }
}
/** Listen to exactly the inboxes something still needs. */
function syncInboxes() {
  if (!R.fp) return;
  const d = D();
  const now = Date.now();
  const mine = new Set();
  if (d.code) mine.add(d.code.code);
  d.incoming.forEach(x => mine.add(x.code));
  d.friends.forEach(f => { if (f.via && f.via.until > now && isCode(f.via.code)) mine.add(f.via.code); });
  d.declined.forEach(x => { if (x.until > now) mine.add(x.code); });
  const out = new Set(d.outgoing.filter(o => o.state === 'waiting' && o.until > now).map(o => o.code));
  for (const [code, e] of [...R.inboxes]) {
    if (e.kinds.has('mine') && !mine.has(code)) closeInbox(code, 'mine');
    if (e.kinds.has('out') && !out.has(code)) closeInbox(code, 'out');
  }
  mine.forEach(c => openInbox(c, 'mine'));
  out.forEach(c => openInbox(c, 'out'));
}

function parseMsg(plain, types) {
  if (typeof plain !== 'string' || plain.length > PLAIN_MAX) return null;
  const m = parseJson(plain);
  if (!m || m.v !== 1 || typeof m.t !== 'string' || !types.has(m.t)) return null;
  return m;
}

function onInboxText(e, text) {
  if (typeof text !== 'string' || text.length > WIRE_MAX) { R.stats.ignored++; return; }
  if (!win(R.inWin, INBOX_PER_SEC)) { R.stats.dropped++; return; }
  e.q = e.q.then(async () => {
    if (!e.key) return;
    const plain = await unseal(e.key, text);
    if (plain === null) { R.stats.ignored++; return; }
    const m = parseMsg(plain, INBOX_TYPES);
    if (!m) { R.stats.ignored++; return; }
    if (m.t === 'req') { if (e.kinds.has('mine')) await onReq(e, m); return; }
    /* an answer: only ever one addressed to this device, for a request it made */
    if (e.kinds.has('out') && m.to === R.fp) await onAnswer(e, m);
  }).catch(err => { console.warn('[friends] inbox', err); });
}

async function onReq(e, m) {
  const pkBytes = pubBytesOf(m.pk);
  if (!pkBytes || !RQ_RE.test(m.rq || '')) { R.stats.ignored++; return; }
  const fp = await fpOf(pkBytes);
  if (fp === R.fp) return;                                     /* my own, or another tab of mine */
  const d = D();
  const now = Date.now();
  if (d.blocked.some(b => b.fp === fp)) { R.stats.refused++; return; }
  const friend = d.friends.find(f => f.fp === fp);
  if (friend) {
    /* they never heard my yes: say it again */
    const via = friend.via && friend.via.code === e.code ? friend.via : (d.code && d.code.code === e.code ? d.code : null);
    if (via && mayReply(`acc:${fp}`, 10_000)) await sendAnswer('acc', { code: e.code, r: via.r, fp, pk: m.pk, rq: m.rq });
    return;
  }
  const dec = d.declined.find(x => x.fp === fp && x.until > now);
  if (dec) {
    R.stats.refused++;
    if (mayReply(`dec:${fp}`, 10_000)) await sendAnswer('dec', { code: dec.code, r: dec.r, fp, pk: m.pk, rq: m.rq });
    return;
  }
  const cur = d.incoming.find(x => x.fp === fp);
  const current = !!d.code && d.code.code === e.code;
  if (!cur && !current) { R.stats.refused++; return; }       /* an old code takes no new requests */
  const myR = current ? d.code.r : null;
  const who = { name: cleanName(m.n) || 'Someone', hue: hue(m.c), pic: normPic(m.pic), cos: Avatar.normCostume(m.cos) };
  if (cur) {
    const next = { ...cur, ...who, rq: m.rq };
    if (JSON.stringify(next) !== JSON.stringify(cur)) save({ incoming: d.incoming.map(x => (x.fp === fp ? next : x)) });
    return;
  }
  if (d.incoming.length >= MAX_INCOMING) { R.stats.refused++; return; }
  if (!(await validPub(pkBytes))) { R.stats.ignored++; return; }
  if (!perMinute(R.newReqs, NEW_PER_MIN)) { R.stats.dropped++; return; }
  const d2 = D();
  if (d2.incoming.some(x => x.fp === fp) || d2.friends.some(x => x.fp === fp) || d2.blocked.some(b => b.fp === fp)) return;
  const twin = twinOf(who.name, fp, d2.friends);
  save({ incoming: [...d2.incoming, { fp, pk: m.pk, rq: m.rq, code: e.code, r: myR, at: now, ...who, ...(twin ? { twin: twin.fp } : {}) }] });
  R.stats.heard++;
  const n = D().incoming.length;
  notify({
    key: 'friends-request', timeout: 10_000,
    title: n > 1 ? `${n} friend requests` : `${who.name} wants to be your friend`,
    message: twin ? `You already have a friend called ${who.name}. This request comes from a different key: it may be them on a new device, or someone using their name.`
      : 'Accept only people you gave your friend code to — names aren’t verified.',
    actions: [{ label: 'Open', onClick: () => openSocial({}) }],
    onClick: () => openSocial({}),
  });
}

async function onAnswer(e, m) {
  const d = D();
  const out = d.outgoing.find(o => o.code === e.code && o.state === 'waiting');
  if (!out || m.rq !== out.rq) { R.stats.ignored++; return; }
  const pkBytes = pubBytesOf(m.pk);
  const rBytes = typeof m.r === 'string' && m.r.length <= 32 ? unb64(m.r) : null;
  if (!pkBytes || !rBytes || rBytes.length !== 16 || typeof m.proof !== 'string' || m.proof.length > 600) { R.stats.ignored++; return; }
  if (!perMinute(R.verifies, VERIFY_PER_MIN)) { R.stats.dropped++; return; }
  /* 1. the answer is from the key this code was made from … */
  if (await codeFrom(pkBytes, rBytes) !== e.code || !(await validPub(pkBytes))) { R.stats.ignored++; return; }
  const fp = await fpOf(pkBytes);
  if (fp === R.fp) return;
  /* 2. … and its sender holds that key's private half */
  let proof = null;
  try { proof = parseJson(await unseal((await derivePair(m.pk)).key, m.proof)); } catch (err) { proof = null; }
  if (!proof || proof.t !== 'proof' || proof.k !== m.t || proof.to !== R.fp || proof.by !== fp || proof.rq !== out.rq) { R.stats.ignored++; return; }
  const d2 = D();
  if (!d2.outgoing.some(o => o.code === e.code && o.state === 'waiting' && o.rq === out.rq)) return;
  R.stats.heard++;
  if (m.t === 'dec') {
    save({ outgoing: d2.outgoing.map(o => (o.code === e.code ? { ...o, state: 'declined', answered: Date.now() } : o)) });
    syncInboxes();
    return;
  }
  if (d2.blocked.some(b => b.fp === fp)) { R.stats.refused++; return; }
  const name = cleanName(m.n) || 'Your friend';
  save({ outgoing: d2.outgoing.filter(o => o.code !== e.code) });
  const twin = twinOf(name, fp, d2.friends);
  addFriend({ fp, pk: m.pk, name, hue: hue(m.c), pic: normPic(m.pic), cos: Avatar.normCostume(m.cos) }, null);
  notify({ title: `${name} accepted your friend request`, message: twin ? `You already have a friend called ${name}, with a different key. Check it is the same person before you trust it.` : 'You can now see when each other is online.', actions: [{ label: 'Open', onClick: () => openSocial({}) }] });
}

/** A friend of mine with this name (or nickname) but another key: the same person on a new device, or someone using the name. */
function twinOf(name, fp, friends) {
  const n = cleanName(name).toLowerCase();
  if (!n) return null;
  return friends.find(f => f.fp !== fp && (cleanName(f.name).toLowerCase() === n || cleanName(f.nick).toLowerCase() === n)) || null;
}

/* ---------------- friendships ---------------- */
function addFriend(f, via) {
  const d = D();
  const incoming = d.incoming.filter(x => x.fp !== f.fp);
  if (d.friends.some(x => x.fp === f.fp)) { save({ incoming }); syncInboxes(); return true; }
  if (d.friends.length >= MAX_FRIENDS) return false;
  const entry = { fp: f.fp, pk: f.pk, name: f.name, hue: f.hue, pic: f.pic || null, cos: f.cos || 'none', nick: '', since: Date.now(), seen: 0, ph: '' };
  if (via) entry.via = via;
  save({ friends: [...d.friends, entry], incoming, declined: d.declined.filter(x => x.fp !== f.fp) });
  openPair(entry);
  syncInboxes();
  return true;
}

function openPair(f) {
  if (R.pairs.has(f.fp)) return R.pairs.get(f.fp);
  const p = {
    fp: f.fp, key: null, topic: null, unsub: null, closed: false,
    lastAt: 0, liveAt: 0, st: null, status: null, game: null,
    inWin: { at: 0, n: 0 }, outWin: { at: 0, n: 0 }, q: Promise.resolve(),
  };
  R.pairs.set(f.fp, p);
  derivePair(f.pk).then(k => {
    if (p.closed) return;
    p.key = k.key;
    p.topic = k.topic;
    p.unsub = live.subscribe(k.topic, text => onPairText(p, text));
    /* say hello and ask for theirs, so both show online now */
    setTimeout(() => { if (!p.closed && myState() !== 'invisible') sendPair(p, 'hb', hbBody(true)); }, 150);
  }).catch(() => { if (R.pairs.get(f.fp) === p) R.pairs.delete(f.fp); });
  return p;
}
function closePair(fp) {
  const p = R.pairs.get(fp);
  if (!p) return;
  R.pairs.delete(fp);
  p.closed = true;
  clearTimeout(p.syncT);
  clearTimeout(p.shrT);
  try { p.unsub?.(); } catch (e) { /* gone */ }
}

/** Forget a friend everywhere: their topic, their nights, their place in mine. */
function dropFriend(fp) {
  closePair(fp);
  const d = D();
  const nights = d.nights.filter(n => n.host !== fp).map(n => (n.host === R.fp && n.invited.includes(fp)
    ? { ...n, invited: n.invited.filter(x => x !== fp), rsvp: Object.fromEntries(Object.entries(n.rsvp || {}).filter(([k]) => k !== fp)) } : n));
  const groups = d.groups.map(g => ({ ...g, members: g.members.filter(x => x !== fp) }));
  save({ friends: d.friends.filter(f => f.fp !== fp), incoming: d.incoming.filter(x => x.fp !== fp), nights, groups });
  syncInboxes();
  syncReminders();
}

function onPairText(p, text) {
  if (p.closed) return;
  if (typeof text !== 'string' || text.length > WIRE_MAX) { R.stats.ignored++; return; }
  if (!win(R.pairWin, PAIRS_PER_SEC) || !win(p.inWin, FRIEND_PER_SEC)) { R.stats.dropped++; return; }
  p.q = p.q.then(async () => {
    if (p.closed) return;
    const plain = await unseal(p.key, text);
    if (plain === null) { R.stats.ignored++; return; }
    const m = parseMsg(plain, PAIR_TYPES);
    if (!m || typeof m.f !== 'string') { R.stats.ignored++; return; }
    if (m.f === R.fp) return;                                  /* mine, back from the broker */
    if (m.f !== p.fp || !Number.isFinite(m.at) || Math.abs(m.at - Date.now()) > DAY || m.at <= p.lastAt) { R.stats.ignored++; return; }
    if (p.closed) return;
    p.lastAt = m.at;
    R.stats.heard++;
    onPairMsg(p, m);
  }).catch(err => { console.warn('[friends] pair', err); });
}

function statusFrom(m) {
  const text = cleanLine(m.s, STATUS_MAX);
  const emoji = cleanEmoji(m.e);
  if (!text && !emoji) return null;
  const until = Number.isFinite(m.x) && m.x > 0 ? m.x : 0;
  return { text, emoji, until };
}

function onPairMsg(p, m) {
  switch (m.t) {
    case 'hb': {
      const was = presenceOf(p);
      p.liveAt = Date.now();
      p.st = STATES.includes(m.st) ? m.st : 'online';
      p.status = statusFrom(m);
      p.game = cleanLine(m.g, TITLE_MAX) || null;
      const f = friendOf(p.fp);
      if (f) {
        const patch = { name: cleanName(m.n) || f.name, hue: hue(m.c) };
        if (typeof m.i === 'string' && PUBID_RE.test(m.i)) patch.pid = m.i;
        if (was === 'offline' || p.liveAt - (Number(f.seen) || 0) > SEEN_SAVE_MS) patch.seen = p.liveAt;
        patchFriend(p.fp, patch);
        if (PH_RE.test(m.ph || '') && m.ph !== f.ph && mayReply(`pq:${p.fp}`, 30_000)) sendPair(p, 'pq');
      }
      if (m.q === 1 && mayReply(`hb:${p.fp}`, 3000) && myState() !== 'invisible') sendPair(p, 'hb', hbBody(false));
      /* q: they have only just come up, however briefly they were gone */
      if (was === 'offline' || m.q === 1) resync(p);
      changed();
      return;
    }
    case 'off':
      if (p.liveAt) patchFriend(p.fp, { seen: p.liveAt });
      p.st = 'off';
      changed();
      return;
    case 'pq':
      if (mayReply(`pro:${p.fp}`, 10_000)) myPic().then(x => sendPair(p, 'pro', { pic: x.pic, cos: x.cos, ph: R.ph }));
      return;
    case 'pro': {
      if (m.pic !== null && m.pic !== undefined && !normPic(m.pic)) { R.stats.ignored++; return; }
      patchFriend(p.fp, { pic: normPic(m.pic), cos: Avatar.normCostume(m.cos), ph: PH_RE.test(m.ph || '') ? m.ph : '' });
      return;
    }
    case 'rm':
      /* they ended the friendship: stop everything, quietly */
      dropFriend(p.fp);
      return;
    case 'ev': onNight(p, m); return;
    case 'rsvp': onRsvp(p, m); return;
    case 'look': onLook(p, m); return;
    case 'lnk': onLink(p, m); return;
    case 'col': onCollection(p, m); return;
    case 'rmi': onRoomInvite(p, m); return;
    case 'med': onMedia(p, m); return;
    case 'arc': onArcade(p, m); return;
    case 'dm': onDm(p, m); return;
    case 'shr': onShared(p, m); return;
    case 'pin': onPartyInvite(p, m); return;
    case 'sin': onStudyInvite(p, m); return;
    case 'wti': onRoomAppInvite(p, m, 'wti'); return;
    case 'fbi': onRoomAppInvite(p, m, 'fbi'); return;
    case 'pni': onRoomAppInvite(p, m, 'pni'); return;
    case 'bti': onRoomAppInvite(p, m, 'bti'); return;
    case 'card': {
      if (m.x === 1) { patchFriend(p.fp, { card: null }); changed(); return; }
      const c = cleanCard({ bio: m.b, games: m.g, ach: m.a, cre: m.c });
      if (!cardHasAny(c)) { R.stats.ignored++; return; }
      if (!mayReply(`card:${p.fp}`, 2000)) { R.stats.dropped++; return; }
      patchFriend(p.fp, { card: { ...c, at: Date.now() } });
      changed();
      return;
    }
    default: R.stats.ignored++;
  }
}

/* ---------------- looks sent by friends ----------------
   A look is a code (core/lookcode.js) and nothing more: it is checked the
   way a pasted one is, kept in a short list, and does nothing until you
   preview it in Static Store and press Apply. It can be undone there. */
const lookTimes = new Map();      /* fp -> when its looks arrived: at most 6 a minute from one friend */
function lookRoom(fp) {
  const now = Date.now();
  const list = (lookTimes.get(fp) || []).filter(t => now - t < 60_000);
  if (list.length >= 6) { lookTimes.set(fp, list); return false; }
  list.push(now);
  lookTimes.set(fp, list);
  return true;
}
async function onLook(p, m) {
  if (typeof m.c !== 'string' || !LOOK_RE.test(m.c) || !friendOf(p.fp) || !lookRoom(p.fp)) { R.stats.ignored++; return; }
  try { (await import('./lookcode.js')).decodeLook(m.c); } catch (e) { R.stats.ignored++; return; }
  const d = D();
  if (d.looks.some(l => l.fp === p.fp && l.code === m.c)) return;
  const name = cleanLine(m.n, 40) || 'A look';
  save({ looks: [{ id: rid(8), fp: p.fp, name, code: m.c, at: Date.now() }, ...d.looks].slice(0, MAX_LOOKS) });
  notify({ title: `${displayName(friendOf(p.fp))} sent you a look`, message: `“${name}”. Preview it in Static Store, then apply it or not.`, icon: 'palette',
    actions: [{ label: 'Preview', onClick: () => { try { api.openApp('store', { section: 'In use' }); } catch (e) { /* no shell */ } } }] });
}
/** Looks friends sent you, newest first. */
export const looks = () => D().looks.filter(l => friendOf(l.fp)).map(l => ({ id: l.id, fp: l.fp, from: displayName(friendOf(l.fp)), name: cleanLine(l.name, 40) || 'A look', code: l.code, at: l.at }));
export function dismissLook(id) { save({ looks: D().looks.filter(l => l.id !== id) }); }
/** Send a look code to one friend who is online now. Nothing is stored on a server: if they are away it is not sent. */
export function sendLook(fp, code, name = '') {
  if (!LOOK_RE.test(String(code || ''))) return { ok: false, error: 'That isn’t a look code.' };
  const p = R.pairs.get(fp);
  if (!p || !friendOf(fp)) return { ok: false, error: 'That friend isn’t in your list.' };
  if (presenceOf(p) === 'offline') return { ok: false, error: 'They’re offline. Looks only go to a friend who is online right now.' };
  const sent = sendPair(p, 'look', { c: code, n: cleanLine(name, 40) });
  return sent ? { ok: true } : { ok: false, error: 'Could not reach them. Try again in a moment.' };
}

/* ---------------- presence ---------------- */
function presenceOf(p) {
  if (!p || !p.liveAt || p.st === 'off') return 'offline';
  if (Date.now() - p.liveAt > OFFLINE_MS) return 'offline';
  return p.st === 'away' || p.st === 'busy' ? p.st : 'online';
}
function myState() {
  const m = identity.me();
  if (m.status === 'invisible') return 'invisible';
  if (m.status === 'away' || m.status === 'busy') return m.status;
  const s = myStatus();
  if (s && s.preset === 'away') return 'away';
  if (D().opts.dndBusy && store.get('prefs.dnd') === true) return 'busy';       /* opt-in: Do Not Disturb shows as Busy */
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'away';
  if (Date.now() - R.input >= IDLE_MS) return 'away';
  return 'online';
}
function hbBody(q) {
  const m = identity.me();
  const s = myStatus();
  const g = currentGame();
  /* i: this device's id on the public rooms (Social), so Social can tell a friend's posts from a stranger's */
  const b = { st: myState(), n: cleanName(m.name), c: hue(m.color), ph: R.ph, i: m.id };
  if (s) { b.s = s.text; b.e = s.emoji; b.x = s.until || 0; }
  if (g) b.g = g;
  if (q) b.q = 1;
  return b;
}
function beatAll(q = false) {
  R.lastBeat = Date.now();
  const st = myState();
  R.sentState = st;
  R.sentGame = currentGame();
  if (st === 'invisible') {
    if (!R.offSent) { R.offSent = true; R.pairs.forEach(p => sendPair(p, 'off')); }
    return;
  }
  const first = R.offSent;
  R.offSent = false;
  R.pairs.forEach(p => sendPair(p, 'hb', hbBody(q || first)));
}
function soonBeat() {
  if (!R.started || !R.fp) return;
  clearTimeout(R.soonT);
  R.soonT = setTimeout(() => beatAll(false), 500);
}

/* ---------------- status (#145) ---------------- */
export function untilFor(id, now = Date.now()) {
  if (id === '30m') return now + 1800_000;
  if (id === '1h') return now + 3600_000;
  if (id === '2h') return now + 7200_000;
  if (id === 'today') { const d = new Date(now); d.setHours(23, 59, 59, 999); return d.getTime(); }
  return 0;
}
export function myStatus() {
  const s = D().status;
  if (!s) return null;
  const text = cleanLine(s.text, STATUS_MAX);
  const emoji = cleanEmoji(s.emoji);
  if (!text && !emoji) return null;
  const until = Number.isFinite(s.until) && s.until > 0 ? s.until : 0;
  if (until && until <= Date.now()) return null;
  return { text, emoji, until, preset: PRESETS.some(p => p.id === s.preset) ? s.preset : null, expiry: EXPIRY.some(x => x.id === s.expiry) ? s.expiry : 'never' };
}
export function setStatus({ text = '', emoji = '', preset = null, expiry = 'never' } = {}) {
  const t = cleanLine(text, STATUS_MAX);
  const e = cleanEmoji(emoji);
  if (!t && !e) { clearStatus(); return null; }
  const exp = EXPIRY.some(x => x.id === expiry) ? expiry : 'never';
  save({ status: { text: t, emoji: e, preset: PRESETS.some(p => p.id === preset) ? preset : null, expiry: exp, until: untilFor(exp), set: Date.now() } });
  armExpiry();
  soonBeat();
  return myStatus();
}
export function clearStatus() {
  if (D().status) save({ status: null });
  armExpiry();
  soonBeat();
}
function armExpiry() {
  clearTimeout(R.expT);
  const s = D().status;
  const until = s && Number.isFinite(s.until) && s.until > 0 ? s.until : 0;
  if (!until) return;
  const wait = until - Date.now();
  if (wait <= 0) { expireStatus(); return; }
  R.expT = setTimeout(expireStatus, Math.min(wait + 50, 0x7fffffff));
}
function expireStatus() {
  const s = D().status;
  if (!s || !(Number(s.until) > 0)) return;
  if (s.until > Date.now()) { armExpiry(); return; }
  save({ status: null });
  soonBeat();
}

/* ---------------- the game you're playing (opt-in, off by default) ---------------- */
export const shareGame = () => D().shareGame === true;
export function setShareGame(on) { save({ shareGame: !!on }); soonBeat(); }
/** The game in the frontmost Arcade / Static Games window — what Screen Time counts as played. */
export function currentGame() {
  if (!shareGame()) return null;
  let wins = [];
  try { wins = wm.stacked(); } catch (e) { return null; }
  for (const w of wins) {
    if (!GAME_WINDOWS.has(w.appId) || w.min) continue;
    const p = w.state && w.state.playing;
    if (p && p.id) return cleanLine(p.title || p.id, TITLE_MAX) || null;
  }
  return null;
}
/* ---------------- the profile card (opt-in, sent by hand) ---------------- */
export const CARD_BIO_MAX = 240;
export const CARD_LIST_MAX = 3;
/** A card from anywhere — a friend's message, the Profile app's picks — as text that is safe to keep and show. */
export function cleanCard(o) {
  const c = o && typeof o === 'object' ? o : {};
  const list = a => (Array.isArray(a) ? a : []).map(x => cleanLine(x, TITLE_MAX)).filter(Boolean).slice(0, CARD_LIST_MAX);
  return { bio: cleanLine(c.bio, CARD_BIO_MAX), games: list(c.games), ach: list(c.ach), cre: list(c.cre) };
}
export const cardHasAny = c => !!(c && (c.bio || c.games.length || c.ach.length || c.cre.length));
/**
 * Send my profile card to friends: `fps` is a list of friend ids, or null for everyone.
 * The card is exactly what is passed in (cleaned and capped); the Profile app passes only what the
 * person ticked. -> { sent, total, empty?, unavailable? } — `sent` counts friends it was handed to the
 * live channel for; a friend who isn't listening right now doesn't get it until it is sent again.
 */
export async function sendCard(card, fps = null) {
  if (!available()) return { sent: 0, total: 0, unavailable: true };
  const c = cleanCard(card);
  if (!cardHasAny(c)) return { sent: 0, total: 0, empty: true };
  await ready();
  const body = { b: c.bio, g: c.games, a: c.ach, c: c.cre };
  let sent = 0, total = 0;
  for (const p of R.pairs.values()) {
    if (Array.isArray(fps) && !fps.includes(p.fp)) continue;
    total++;
    if (sendPair(p, 'card', body)) sent++;
  }
  return { sent, total };
}
/** Take my card back from friends' devices (they delete it when this arrives). */
export async function withdrawCard(fps = null) {
  if (!available()) return { sent: 0, total: 0, unavailable: true };
  await ready();
  let sent = 0, total = 0;
  for (const p of R.pairs.values()) {
    if (Array.isArray(fps) && !fps.includes(p.fp)) continue;
    total++;
    if (sendPair(p, 'card', { x: 1 })) sent++;
  }
  return { sent, total };
}
/** The cards friends have sent me: [{ fp, name, display, hue, picture, costume, card:{ bio, games, ach, cre, at } }] */
export function cards() {
  return D().friends.filter(f => f.card && typeof f.card === 'object').map(f => {
    const c = cleanCard(f.card);
    return { fp: f.fp, name: cleanName(f.name) || 'Friend', display: displayName(f), hue: hue(f.hue), picture: normPic(f.pic), costume: Avatar.normCostume(f.cos),
      card: { ...c, at: Number(f.card.at) || 0 } };
  }).filter(x => cardHasAny(x.card)).sort((a, b) => b.card.at - a.card.at);
}

/** Exactly what a friend's device is sent about you. */
export function whatFriendsSee() {
  const m = identity.me();
  const { picture, costume } = Avatar.read();
  const st = myState();
  return {
    name: cleanName(m.name), color: hue(m.color), picture, costume,
    state: st, status: st === 'invisible' ? null : myStatus(), game: st === 'invisible' ? null : currentGame(), shareGame: shareGame(),
    shares: sharing(),
  };
}

/* ---------------- game nights (#149) ---------------- */
const gameTitle = g => {
  if (!g) return null;
  if (g.kind === 'arcade') { const a = arcadeById(g.id); return a ? a.title : null; }
  return typeof g.title === 'string' ? cleanLine(g.title, 80) || null : null;
};
export const nightName = n => n.title || (n.game.kind === 'anime' ? `${gameTitle(n.game) || 'Anime'} watch night` : `${gameTitle(n.game) || 'Game'} night`);
const wireNight = n => ({ id: n.id, ti: n.title || '', g: { k: n.game.kind, i: n.game.id }, w: n.at, len: n.len, inv: n.invited, rs: n.rsvp || {}, pc: n.party || null, rc: n.room || null, x: !!n.cancelled, u: n.updated, wk: n.weekly ? 1 : 0, sk: n.skipped || 0 });
/** A two-player online Arcade game with one friend gets an Arcade room; anything else a Static Party. */
export const roomNight = n => n.game.kind === 'arcade' && !!arcadeById(n.game.id)?.online && n.invited.length === 1;

function cleanNight(m, host) {
  if (!NIGHT_ID.test(m.id || '') || !m.g || typeof m.g !== 'object') return null;
  const kind = m.g.k === 'arcade' || m.g.k === 'web' || m.g.k === 'anime' ? m.g.k : null;
  if (!kind || !GAME_ID.test(m.g.i || '') || (kind === 'anime' && !ANIME_ID.test(m.g.i))) return null;
  const now = Date.now();
  if (!Number.isFinite(m.w) || m.w < now - 2 * DAY || m.w > now + 90 * DAY) return null;
  if (!Number.isInteger(m.len) || m.len < 15 || m.len > 360) return null;
  if (!Array.isArray(m.inv) || m.inv.length > MAX_INVITE || !m.inv.every(x => typeof x === 'string' && FP_RE.test(x))) return null;
  const invited = [...new Set(m.inv)];
  const rsvp = {};
  if (m.rs && typeof m.rs === 'object' && !Array.isArray(m.rs)) {
    for (const [k, v] of Object.entries(m.rs).slice(0, MAX_INVITE)) if (invited.includes(k) && ANSWERS.includes(v)) rsvp[k] = v;
  }
  if (m.pc !== null && m.pc !== undefined && !PARTY_CODE.test(m.pc)) return null;
  if (m.rc !== null && m.rc !== undefined && !PARTY_CODE.test(m.rc)) return null;
  if (!Number.isFinite(m.u) || m.u <= 0) return null;
  return {
    id: m.id, host, title: cleanLine(m.ti, TITLE_MAX), game: { kind, id: m.g.i }, at: m.w, len: m.len,
    invited, rsvp, party: m.pc || null, room: m.rc || null, cancelled: m.x === true, updated: m.u,
    weekly: m.wk === 1, skipped: m.wk === 1 && Number.isFinite(m.sk) && m.sk > 0 ? m.sk : 0,
  };
}

/** web games get THIS device's title, never the network's */
async function localTitle(game) {
  if (game.kind === 'arcade') return gameTitle(game);
  try {
    if (game.kind === 'anime') {
      const A = await import('../portal/anime.data.js');
      await A.load('anime');
      const a = A.byId(game.id, 'anime');
      return a ? cleanLine(a.title, 80) || null : null;
    }
    const G = await import('../portal/games.data.js');
    await G.load();
    const g = G.byId(game.id);
    return g ? cleanLine(g.title, 80) || g.id : null;
  } catch (e) { return null; }
}

function onNight(p, m) {
  const n = cleanNight(m, p.fp);
  if (!n) { R.stats.ignored++; return; }
  const d = D();
  const cur = d.nights.find(x => x.id === n.id);
  if (cur && cur.host !== p.fp) { R.stats.ignored++; return; }       /* not theirs to change */
  if (cur && cur.updated >= n.updated) {
    /* old news — but if they missed my answer, say it again */
    if (cur.mine && n.rsvp[R.fp] !== cur.mine && mayReply(`rsvp:${n.id}`, 10_000)) sendPair(p, 'rsvp', { id: n.id, r: cur.mine });
    return;
  }
  if (!n.invited.includes(R.fp)) {
    if (cur) { save({ nights: d.nights.filter(x => x.id !== n.id) }); syncReminders(); }
    return;
  }
  if (!cur && (d.nights.filter(x => x.host === p.fp).length >= MAX_NIGHTS_PER_HOST || d.nights.length >= MAX_NIGHTS)) { R.stats.refused++; return; }
  const next = { ...n, mine: cur && cur.at === n.at ? cur.mine || null : null };    /* a weekly night's new week starts unanswered */
  if (cur && cur.cal) next.cal = cur.cal;
  if (cur && cur.game.kind === n.game.kind && cur.game.id === n.game.id && cur.game.title) next.game.title = cur.game.title;
  save({ nights: cur ? d.nights.map(x => (x.id === n.id ? next : x)) : [...d.nights, next] });
  syncReminders();
  if (next.mine && n.rsvp[R.fp] !== next.mine) sendPair(p, 'rsvp', { id: n.id, r: next.mine });
  const host = displayName(friendOf(p.fp));
  const fresh = !cur && !n.cancelled && n.at + n.len * 60_000 > Date.now();
  if (!next.game.title && (next.game.kind === 'web' || next.game.kind === 'anime')) {
    localTitle(next.game).then(t => {
      if (!t) return;
      const d2 = D();
      save({ nights: d2.nights.map(x => (x.id === n.id && x.game.id === next.game.id ? { ...x, game: { ...x.game, title: t } } : x)) });
      syncReminders();
    });
  }
  if (fresh) {
    notify({
      key: `friends-night-${n.id}`, from: p.fp, title: `${host} invited you to a game night`,
      message: `${nightName(next)} · ${whenText(n.at)}`,
      actions: [{ label: 'Open', onClick: () => openSocial({ night: n.id }) }],
      onClick: () => openSocial({ night: n.id }),
    });
  } else if (cur && !cur.cancelled && n.cancelled) {
    notify({ key: `friends-night-${n.id}`, from: p.fp, title: `${host} cancelled ${nightName(next)}`, message: whenText(n.at) });
  } else if (cur && n.weekly && n.skipped && n.skipped !== cur.skipped && !n.cancelled) {
    notify({ key: `friends-night-${n.id}`, from: p.fp, title: `${host} skipped this week’s ${nightName(next)}`, message: `Next one: ${whenText(n.at)}`, timeout: 6000 });
  } else if (cur && ((!cur.party && n.party) || (n.room && cur.room !== n.room)) && !n.cancelled && next.mine !== 'no') {
    notify({
      key: `friends-night-${n.id}`, from: p.fp, timeout: 0, title: `${host} opened the ${n.room ? 'room' : 'party'} for ${nightName(next)}`,
      message: 'Join when you’re ready.',
      actions: [{ label: 'Join', onClick: () => joinNight(n.id) }],
    });
  }
}

function onRsvp(p, m) {
  if (!NIGHT_ID.test(m.id || '') || !ANSWERS.includes(m.r)) { R.stats.ignored++; return; }
  const d = D();
  const n = d.nights.find(x => x.id === m.id && x.host === R.fp);
  if (!n || !n.invited.includes(p.fp)) { R.stats.ignored++; return; }
  if ((n.rsvp || {})[p.fp] === m.r) { if (mayReply(`ev:${n.id}:${p.fp}`, 5000)) sendPair(p, 'ev', wireNight(n)); return; }
  const next = { ...n, rsvp: { ...(n.rsvp || {}), [p.fp]: m.r }, updated: bump(n.updated) };
  save({ nights: d.nights.map(x => (x.id === n.id ? next : x)) });
  sendNight(next);
  if (m.r === 'yes' && mayReply(`rsvpnote:${n.id}:${p.fp}`, 60_000)) {
    notify({ from: p.fp, title: `${displayName(friendOf(p.fp))} is going to ${nightName(next)}`, message: whenText(next.at), timeout: 5000 });
  }
}

/* ---------------- a link to a page, sent to one friend ---------------- */
/* 'lnk' { k, i, ti }: the kind of page ('game' = Static Games, 'roblox' =
   Static Roblox) and its id in that catalogue. It is only ever a pointer to a
   page both devices already have: nothing is synced, proxied or opened for
   them. The receiver looks the id up in ITS OWN catalogue, shows ITS title,
   and a friend sees a notification they can ignore or open. */
const LINKS = {
  game: { id: GAME_ID, app: 'aether-games', url: id => `static://games/${id}`, name: 'Static Games' },
  roblox: { id: /^\d{1,20}$/, app: 'aether-roblox', url: id => `static://roblox/${id}`, name: 'Static Roblox' },
};
export const LINK_KINDS = Object.keys(LINKS);

/** Send a page to a friend. -> { ok, error?: 'kind' | 'friend' | 'wait' | 'offline' } */
export async function sendLink(fp, { kind, id, title = '' } = {}) {
  const L = LINKS[kind];
  if (!L || !L.id.test(String(id || ''))) return { ok: false, error: 'kind' };
  await start();
  const p = R.pairs.get(fp);
  if (!p || !p.key) return { ok: false, error: 'friend' };
  if (!mayReply(`lnkout:${fp}`, 2000)) return { ok: false, error: 'wait' };
  const sent = sendPair(p, 'lnk', { k: kind, i: String(id), ti: cleanLine(title, 80) });
  /* sent is false while the live channel is down — the message is still queued */
  return { ok: true, live: sent };
}

async function onLink(p, m) {
  const L = LINKS[m.k];
  if (!L || typeof m.i !== 'string' || !L.id.test(m.i)) { R.stats.ignored++; return; }
  if (!mayReply(`lnk:${p.fp}`, 3000)) { R.stats.dropped++; return; }
  let title = null;
  try {
    if (m.k === 'game') title = await localTitle({ kind: 'web', id: m.i });
    else {
      const RB = await import('../portal/roblox.data.js');
      await RB.load();
      const r = RB.byId(m.i);
      title = r ? cleanLine(r.name, 80) || null : null;
    }
  } catch (e) { title = null; }
  if (!title) { R.stats.ignored++; return; }          /* not in this device's catalogue: nothing to open */
  const open = () => { try { api.openApp(L.app, { url: L.url(m.i) }); } catch (e) { /* no shell */ } };
  notify({
    key: `friends-link-${m.k}-${m.i}-${p.fp}`, from: p.fp, title: `${displayName(friendOf(p.fp))} sent you ${title}`,
    message: `In ${L.name}. Nothing opens until you choose.`,
    actions: [{ label: 'Open', onClick: open }], onClick: open,
  });
}

/* ---------------- a collection, sent to one friend ----------------
   'col' { n, it: [[kind, id], …] }: a name and a list of ids. Like a link, it
   is only a pointer: the receiver looks every id up in ITS OWN catalogues, shows
   ITS titles, and nothing is saved until they press Save. Creations and Cloud
   titles never travel (the receiver could not look them up). */
const COL_MAX_TEXT = 12_000;
export async function sendCollection(fp, { name = '', ids = [] } = {}) {
  const C = await import('./collections.js');
  let pairs = C.cleanPairs(ids);
  if (!pairs.length) return { ok: false, error: 'empty' };
  await start();
  const p = R.pairs.get(fp);
  if (!p || !p.key) return { ok: false, error: 'friend' };
  if (!mayReply(`colout:${fp}`, 3000)) return { ok: false, error: 'wait' };
  const n = cleanLine(name, 40) || 'Shared collection';
  while (pairs.length > 1 && JSON.stringify({ n, it: pairs }).length > COL_MAX_TEXT) pairs = pairs.slice(0, -5);
  const sent = sendPair(p, 'col', { n, it: pairs });
  return { ok: true, live: sent, count: pairs.length };
}

async function onCollection(p, m) {
  if (!mayReply(`col:${p.fp}`, 5000)) { R.stats.dropped++; return; }
  const C = await import('./collections.js');
  const pairs = C.cleanPairs(m.it);
  if (!pairs.length) { R.stats.ignored++; return; }
  const name = cleanLine(m.n, 40) || 'Shared collection';
  const save = async () => {
    const r = await C.importIds(name, pairs);
    if (!r) { notify({ title: 'Could not save it', message: 'You have reached the limit of 60 collections.', icon: 'alert' }); return; }
    notify({ title: `Saved “${r.col.name}”`, icon: 'bookmark',
      message: `${r.added} of ${pairs.length} found in your catalogues${r.skipped ? `; ${r.skipped} this device does not have were left out` : ''}.`,
      actions: [{ label: 'Open', onClick: () => { try { api.openApp('aether-library', { url: `static://library/collections/${encodeURIComponent(r.col.id)}` }); } catch (e) { /* no shell */ } } }] });
  };
  notify({
    key: `friends-col-${p.fp}`, from: p.fp, title: `${displayName(friendOf(p.fp))} sent you a collection`,
    message: `“${name}” · ${pairs.length} ${pairs.length === 1 ? 'title' : 'titles'}. Nothing is saved until you choose.`,
    actions: [{ label: 'Save as collection', onClick: save }],
  });
}

/* ---------------- an Arcade room code, sent to one friend ----------------
   'rmi' { g, c }: the Arcade game's id and the six-character room code of a
   room the sender just opened. Joining is a click on the notice; nobody is
   matched with a stranger and nothing opens by itself. */
export async function sendRoomInvite(fp, { game, code } = {}) {
  const a = arcadeById(game);
  if (!a || !a.online || !PARTY_CODE.test(String(code || ''))) return { ok: false, error: 'game' };
  await start();
  const p = R.pairs.get(fp);
  if (!p || !p.key) return { ok: false, error: 'friend' };
  if (!mayReply(`rmiout:${fp}`, 2000)) return { ok: false, error: 'wait' };
  const sent = sendPair(p, 'rmi', { g: a.id, c: code });
  return { ok: true, live: sent };
}

function onRoomInvite(p, m) {
  const a = typeof m.g === 'string' ? arcadeById(m.g) : null;
  if (!a || !a.online || !PARTY_CODE.test(m.c || '')) { R.stats.ignored++; return; }
  if (!mayReply(`rmi:${p.fp}`, 5000)) { R.stats.dropped++; return; }
  const join = () => { try { api.openApp('arcade', { join: m.c }); } catch (e) { /* no shell */ } };
  notify({
    key: `friends-rmi-${p.fp}`, from: p.fp, timeout: 0, title: `${displayName(friendOf(p.fp))} invited you to play ${a.title}`,
    message: 'Their room is open now. Nothing joins until you choose.',
    actions: [{ label: 'Join', onClick: join }], onClick: join,
  });
}

/* ---------------- Spotify / TikTok / Drop, sent to one friend ---------------- */
const MEDIA = {
  spotify: { id: /^(track|album|playlist|artist|show|episode):[A-Za-z0-9]{1,40}$/, name: 'Spotify', app: 'spotify' },
  tiktok: { id: /^\d{6,25}$/, name: 'TikTok', app: 'tiktok' },
  drop: { id: /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, name: 'Static Drop', app: 'drop' },
  /* a SomaFM station from Static Radio: the id must also be one on the shared list (js/core/stations.js) */
  radio: { id: /^[a-z0-9]{2,20}$/, name: 'Static Radio', app: 'radio', known: id => isStation(id) },
};
export const MEDIA_KINDS = Object.keys(MEDIA);
const HANDLE = /^@[A-Za-z0-9._-]{1,30}$/;

/** Send a Spotify item, a TikTok, a Drop code or a radio station to one friend. -> { ok, live?, error?: 'kind' | 'friend' | 'wait' } */
export async function sendMedia(fp, { kind, id, title = '', handle = '' } = {}) {
  const M = MEDIA[kind];
  if (!M || !M.id.test(String(id || '')) || (M.known && !M.known(String(id)))) return { ok: false, error: 'kind' };
  await start();
  const p = R.pairs.get(fp);
  if (!p || !p.key) return { ok: false, error: 'friend' };
  if (!mayReply(`medout:${fp}`, 2000)) return { ok: false, error: 'wait' };
  const body = { k: kind, i: String(id), ti: cleanLine(title, 80) };
  if (kind === 'tiktok' && HANDLE.test(handle)) body.hd = handle;
  const sent = sendPair(p, 'med', body);
  return { ok: true, live: sent };
}

async function onMedia(p, m) {
  const M = MEDIA[m.k];
  if (!M || typeof m.i !== 'string' || !M.id.test(m.i) || (M.known && !M.known(m.i))) { R.stats.ignored++; return; }
  if (!mayReply(`med:${p.fp}`, 3000)) { R.stats.dropped++; return; }
  const who = displayName(friendOf(p.fp));
  const title = cleanLine(m.ti, 80);
  const handle = m.k === 'tiktok' && HANDLE.test(m.hd || '') ? m.hd : '';
  const open = o => () => { try { api.openApp(M.app, o); } catch (e) { /* no shell */ } };
  const key = `friends-med-${m.k}-${m.i}-${p.fp}`;
  if (m.k === 'drop') {
    notify({
      key, from: p.fp, timeout: 0, title: `${who} wants to send you files with Static Drop`,
      message: 'Open fills in their code. Nothing is received until you press Receive and then Accept.',
      actions: [{ label: 'Open', onClick: open({ join: m.i }) }], onClick: open({ join: m.i }),
    });
    return;
  }
  if (m.k === 'radio') {
    /* the name comes from our own list, never from the message: a friend can't put words in the title */
    const st = BY_ID.get(m.i);
    const listen = () => { try { api.openApp('radio', { station: st.id }); } catch (e) { /* no shell */ } };
    const keep = () => {
      try {
        const o = store.get('portal.radio');
        const rec = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
        const favs = Array.isArray(rec.favs) ? rec.favs.filter(x => typeof x === 'string') : [];
        if (!favs.includes(st.id)) store.set('portal.radio', { ...rec, favs: [...favs, st.id] });
        notify({ from: p.fp, title: 'Added to your favorite stations', message: st.name, timeout: 4000 });
      } catch (e) { /* nothing was added */ }
    };
    notify({
      key, from: p.fp, timeout: 0, title: `${who} sent you a radio station: ${st.name}`,
      message: `${st.genre}. It does not play by itself — Listen opens Static Radio and tunes in.`,
      actions: [{ label: 'Listen', onClick: listen }, { label: 'Add to favorites', onClick: keep }], onClick: listen,
    });
    return;
  }
  const added = async () => {
    try {
      if (m.k === 'spotify') {
        const SP = await import('../portal/spotify.js');
        const [kind, id] = m.i.split(':');
        SP.save(store, { kind, id, name: title || null });
      } else {
        const TT = await import('../portal/tiktok.js');
        TT.addSaved(store, { id: m.i, handle, url: handle ? `https://www.tiktok.com/${handle}/video/${m.i}` : '' });
      }
      bus.emit('media:saved', { app: M.app });
      notify({ from: p.fp, title: m.k === 'spotify' ? 'Added to your Spotify library' : 'Added to your Saved shelf', message: title || handle || M.name, timeout: 4000 });
    } catch (e) { /* the app's code could not load: nothing was added */ }
  };
  const openIt = m.k === 'spotify'
    ? open({ link: `https://open.spotify.com/${m.i.split(':')[0]}/${m.i.split(':')[1]}` })
    : open({ url: `https://www.tiktok.com/${handle || '@'}/video/${m.i}` });
  notify({
    key, from: p.fp, timeout: 0,
    title: m.k === 'spotify' ? `${who} sent you ${title || 'something on Spotify'}` : `${who} sent you a TikTok${handle ? ` from ${handle}` : ''}`,
    message: m.k === 'spotify' ? 'Nothing plays until you press play in the player.' : 'Add keeps it on your Saved shelf. Nothing plays until you open it.',
    actions: [{ label: 'Add', onClick: added }, { label: 'Open', onClick: openIt }], onClick: openIt,
  });
}

/* ---------------- Static Arcade with friends ----------------
   'arc' { k, … } carries only what a person chose to send from the Arcade:
   a best score for their friends' leaderboards, a Beat-this round, a cup's
   bracket (from its host) or a cup match's score (to its host). It is
   checked, kept and shown by ../arcade/friendplay.js, which is loaded the
   first time one arrives (so this keeps working with the Arcade closed). */
/** Send an Arcade message to friends: `fps` a list of friend ids, or null for all. -> { sent, total } */
export async function sendArcade(fps, body) {
  if (!available()) return { sent: 0, total: 0, unavailable: true };
  if (!body || typeof body !== 'object' || typeof body.k !== 'string') return { sent: 0, total: 0 };
  await ready();
  let sent = 0, total = 0;
  for (const p of R.pairs.values()) {
    if (Array.isArray(fps) && !fps.includes(p.fp)) continue;
    total++;
    if (sendPair(p, 'arc', body)) sent++;
  }
  return { sent, total };
}
function onArcade(p, m) {
  if (typeof m.k !== 'string' || m.k.length > 8) { R.stats.ignored++; return; }
  import('../arcade/friendplay.js').then(A => A.receive(p.fp, m)).catch(e => console.warn('[friends] arcade', e));
}

/* ---------------- direct messages (Static Chat) ----------------
   'dm' carries a Static Chat message (js/core/chatwire.js: text, a sticker, a
   card, a file's name, a poll or a vote, a reaction, an edit or a delete) to
   ONE accepted friend, on that friendship's sealed topic. Nobody else has
   the key, so there is no way to message a stranger from here. It is checked
   with the same validator a shared space uses, taken at most FRIEND_DM_PER_SEC
   a second from one friend, and handed to the chat store
   (portal/chat.transport.js), which keeps it on this device and says who it
   is from. Voice messages do not travel here (rooms only). Nothing says it was
   read: a send only reports whether the connection was up. */
const FRIEND_DM_PER_SEC = 6;
/** Send a chat message to a friend. -> { ok, live, error?: 'friend' | 'wait' | 'invalid' | 'unavailable' } */
export async function sendDm(fp, body) {
  if (!available()) return { ok: false, error: 'unavailable' };
  const clean = parseChat(body, { voice: false });
  if (!clean) return { ok: false, error: 'invalid' };
  await ready();
  const p = R.pairs.get(fp);
  if (!p || !p.key || !friendOf(fp)) return { ok: false, error: 'friend' };
  if (!win(p.dmOut || (p.dmOut = { at: 0, n: 0 }), FRIEND_DM_PER_SEC)) return { ok: false, error: 'wait' };
  const live = sendPair(p, 'dm', clean);
  return { ok: true, live };
}
function onDm(p, m) {
  const f = friendOf(p.fp);
  const clean = f && parseChat(m, { voice: false });
  if (!clean) { R.stats.ignored++; return; }
  if (!win(p.dmIn || (p.dmIn = { at: 0, n: 0 }), FRIEND_DM_PER_SEC)) { R.stats.dropped++; return; }
  import('../portal/chat.transport.js').then(T => T.receiveDm(p.fp, clean)).catch(e => console.warn('[friends] dm', e));
}

const bump = u => Math.max(Date.now(), (Number(u) || 0) + 1);
function sendNight(n, only = null) {
  for (const fp of n.invited) {
    if (only && fp !== only) continue;
    const p = R.pairs.get(fp);
    if (p) sendPair(p, 'ev', wireNight(n));
  }
}
/** What they missed (an invite, my answer) goes again: at most every few seconds,
    and one that comes too soon waits its turn rather than being lost. */
function resync(p) {
  if (mayReply(`sync:${p.fp}`, 4000)) { onFriendOnline(p); return; }
  if (p.syncT) return;
  p.syncT = setTimeout(() => { p.syncT = 0; if (!p.closed) resync(p); }, 4100);
}
function onFriendOnline(p) {
  const now = Date.now();
  sendShare(p);
  for (const n of D().nights) {
    if (n.at + n.len * 60_000 < now) continue;
    if (n.host === R.fp && n.invited.includes(p.fp)) sendPair(p, 'ev', wireNight(n));
    else if (n.host === p.fp && n.mine && (n.rsvp || {})[R.fp] !== n.mine) sendPair(p, 'rsvp', { id: n.id, r: n.mine });
  }
}

function whenText(at) {
  const d = new Date(at);
  const now = new Date();
  const day = d.toDateString() === now.toDateString() ? 'Today'
    : d.toDateString() === new Date(now.getTime() + DAY).toDateString() ? 'Tomorrow'
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const h24 = !!store.get('prefs.h24');
  const t = h24 ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
  return `${day}, ${t}`;
}
export { whenText };

/** reminders for the nights I'm going to: 15 minutes before and at the start */
function syncReminders() {
  if (!R.fp) return;
  const want = [];
  const now = Date.now();
  const pad = x => String(x).padStart(2, '0');
  for (const n of D().nights) {
    if (n.cancelled || n.at + 11 * 60_000 < now) continue;
    const ans = n.host === R.fp ? 'yes' : (n.mine || (n.rsvp || {})[R.fp] || null);
    if (ans === 'no') continue;
    const name = nightName(n);
    for (const [ref, at, text] of [[`${n.id}~15`, n.at - 15 * 60_000, `${name} starts in 15 minutes`], [n.id, n.at, `${name} is starting`]]) {
      if (at + 11 * 60_000 < now) continue;
      const d = new Date(at);
      want.push({ ref, text, sub: `${n.game.kind === 'anime' ? 'Anime night' : 'Game night'} · Static Social`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: AM.ymd(d) });
    }
  }
  /* a friend's birthday — only a day that friend chose to share — at 9 AM, this year's or next */
  if (D().opts.remindBirthdays) {
    const today = ymdOf(now);
    for (const f of D().friends) {
      if (!BDAY_RE.test(f.bday || '')) continue;
      const on = [];
      for (let y = +today.slice(0, 4); y <= +today.slice(0, 4) + 1 && on.length < 2; y++) { const day = bdayIn(f.bday, y); if (day >= today) on.push(day); }
      if (on.length) want.push({ ref: `bd~${f.fp}`, text: `${displayName(f)}’s birthday`, sub: 'Friend birthday · Static Social', time: '09:00', repeat: 'dates', on });
    }
  }
  try { AM.syncSourceReminders(SRC, want); } catch (e) { console.warn('[friends] reminders', e); }
}

/* ---------------- start ---------------- */
function onTick() {
  const now = Date.now();
  const d = D();
  /* friends going quiet */
  for (const p of R.pairs.values()) {
    if (p.liveAt && p.st !== 'off' && now - p.liveAt > OFFLINE_MS && !p.wentOff) {
      p.wentOff = true;
      patchFriend(p.fp, { seen: p.liveAt });
      changed();
    } else if (p.liveAt && now - p.liveAt <= OFFLINE_MS) p.wentOff = false;
  }
  /* my own state */
  if (d.status && Number(d.status.until) > 0 && d.status.until <= now) expireStatus();
  if (now - R.lastBeat >= HEARTBEAT_MS) beatAll(false);
  else if (myState() !== R.sentState || currentGame() !== R.sentGame) soonBeat();
  /* requests I'm waiting on */
  const waiting = d.outgoing.filter(o => o.state === 'waiting');
  if (waiting.some(o => o.until <= now)) {
    save({ outgoing: d.outgoing.map(o => (o.state === 'waiting' && o.until <= now ? { ...o, state: 'expired' } : o)) });
    syncInboxes();
  }
  if (now - R.lastKnock >= KNOCK_MS) knockAll();
  /* the nights I host reach invitees who were away */
  if (now - R.lastNightSend >= NIGHT_RESEND_MS) {
    R.lastNightSend = now;
    for (const n of d.nights) if (n.host === R.fp && n.at + n.len * 60_000 > now) sendNight(n);
  }
  rollNights(now);
  shareTick(now);
  announceCount();
  const day = ymdOf(now);
  if (day !== R.day) { if (R.day) syncReminders(); R.day = day; }
  /* nights long over, declines long past */
  const nightsNow = D().nights;
  const keep = nightsNow.filter(n => n.at + n.len * 60_000 + DAY > now);
  const dec = d.declined.filter(x => x.until > now);
  if (keep.length !== nightsNow.length || dec.length !== d.declined.length) { save({ nights: keep, declined: dec }); syncInboxes(); }
}

async function knock(o) {
  if (!R.fp) return;
  const inbox = await deriveInbox(o.code);
  await publishSealed(inbox.key, inbox.topic, { v: 1, t: 'req', pk: R.pub, rq: o.rq, at: Date.now(), ...(await profileBody()) });
}
function knockAll() {
  R.lastKnock = Date.now();
  const now = Date.now();
  for (const o of D().outgoing) if (o.state === 'waiting' && o.until > now) knock(o).catch(() => {});
}

/** At boot: only when Friends has been used here — otherwise nothing touches the network. */
export function init() {
  if (!available()) return false;
  const v = store.get(KEY, null);
  if (!v || typeof v !== 'object') return false;
  start();
  return true;
}
/** Only someone signed in to their own profile has friends: see NOT FOR A GUEST above. */
export const available = () => MODE !== 'guest' && MODE !== 'login';
export const ready = () => (R.ready || start());
export const started = () => R.started;

export function start() {
  if (R.ready) return R.ready;
  if (!available()) {
    R.failed = 'guest';
    R.ready = Promise.reject(new Error('guest'));
    R.ready.catch(() => {});
    return R.ready;
  }
  R.started = true;
  R.ready = (async () => {
    await loadKeys();
    await refreshPh().catch(() => {});
    D().friends.forEach(f => openPair(f));
    syncInboxes();
    syncReminders();
    armExpiry();
    const onInput = () => { const was = Date.now() - R.input >= IDLE_MS; R.input = Date.now(); if (was) soonBeat(); };
    for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, onInput, { capture: true, passive: true });
    const onVis = () => soonBeat();
    document.addEventListener('visibilitychange', onVis);
    const gameMoved = () => { if (shareGame() && currentGame() !== R.sentGame) soonBeat(); };
    R.offs.push(
      () => { for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, onInput, { capture: true }); },
      () => document.removeEventListener('visibilitychange', onVis),
      ...['win:playing', 'win:close', 'win:focus', 'win:minimize', 'win:restore'].map(ev => bus.on(ev, gameMoved)),
      store.sub('portal.identity', () => { soonBeat(); changed(); }),
      store.sub('session.user', () => { soonBeat(); changed(); }),
      store.sub(Avatar.KEY, () => { refreshPh().catch(() => {}); changed(); }),
      live.onStatus(st => {
        changed();
        if (st === 'live') setTimeout(() => { beatAll(true); knockAll(); }, 250);
      }),
    );
    R.tick = setInterval(onTick, TICK_MS);
    R.lastBeat = Date.now();
    changed();
  })();
  R.ready.catch(err => { R.failed = err && err.message === 'insecure' ? 'insecure' : 'failed'; changed(); });
  return R.ready;
}
export const failed = () => R.failed;

/* ---------------- the API the Friends view uses ---------------- */
export const myCode = () => D().code?.code || null;
export const myFp = () => R.fp;
export const liveStatus = () => live.status();

/* Two callers can ask for the first code at once (the Friends view being shown
   twice while the page is slow). Each would make its own code and the second
   save would replace the first after it had already been shown or copied: a
   request to the shown code then reached an inbox that refuses old codes and
   was never answered. One code is made, and every caller gets that one. */
let firstCode = null;
export async function ensureCode() {
  await start();
  if (!D().code) {
    firstCode ||= makeCode(true).finally(() => { firstCode = null; });
    await firstCode;
  }
  return myCode();
}
export const rotateCode = async () => { await start(); return makeCode(false); };
async function makeCode(onlyIfNone) {
  const r = rand(16);
  const code = await codeFrom(R.pubBytes, r);
  if (onlyIfNone && D().code) return D().code.code;
  save({ code: { code, r: b64(r), made: Date.now() } });
  syncInboxes();
  return code;
}

export async function request(input) {
  const code = normCode(input);
  if (!isCode(code)) return { ok: false, error: 'invalid' };
  await start();
  const d = D();
  if (d.code && d.code.code === code) return { ok: false, error: 'self' };
  const ex = d.outgoing.find(o => o.code === code);
  if (ex && ex.state === 'waiting') { knock(ex).catch(() => {}); return { ok: true, again: true, live: live.status() === 'live' }; }
  if (d.outgoing.filter(o => o.state === 'waiting').length >= MAX_OUTGOING) return { ok: false, error: 'full' };
  const now = Date.now();
  const o = { code, rq: rid(12), at: now, until: now + REQ_TTL, state: 'waiting' };
  save({ outgoing: [...d.outgoing.filter(x => x.code !== code), o].slice(-MAX_OUTGOING * 2) });
  await openInbox(code, 'out');
  knock(o).catch(() => {});
  return { ok: true, live: live.status() === 'live' };
}
export function cancelRequest(code) {
  const d = D();
  save({ outgoing: d.outgoing.filter(o => o.code !== code) });
  syncInboxes();
}

export async function accept(fp) {
  await start();
  const inc = D().incoming.find(x => x.fp === fp);
  if (!inc) return false;
  const ok = addFriend({ fp, pk: inc.pk, name: inc.name, hue: inc.hue, pic: inc.pic, cos: inc.cos }, { code: inc.code, r: inc.r, until: Date.now() + VIA_TTL });
  if (!ok) return false;
  await sendAnswer('acc', { code: inc.code, r: inc.r, fp, pk: inc.pk, rq: inc.rq });
  return true;
}
export async function decline(fp) {
  await start();
  const d = D();
  const inc = d.incoming.find(x => x.fp === fp);
  if (!inc) return false;
  save({
    incoming: d.incoming.filter(x => x.fp !== fp),
    declined: [...d.declined.filter(x => x.fp !== fp), { fp, code: inc.code, r: inc.r, until: Date.now() + DECLINE_TTL }].slice(-MAX_DECLINED),
  });
  syncInboxes();
  await sendAnswer('dec', { code: inc.code, r: inc.r, fp, pk: inc.pk, rq: inc.rq });
  return true;
}
/** Remove a friend: their device is told, and both stop. */
export async function remove(fp) {
  await start();
  const p = R.pairs.get(fp);
  if (p) { sendPair(p, 'rm'); await R.outq; }
  dropFriend(fp);
  return true;
}
/** Block a request or a friend: as remove, and their key is refused from now on. */
export async function block(fp) {
  await start();
  const d = D();
  const who = d.friends.find(x => x.fp === fp) || d.incoming.find(x => x.fp === fp);
  if (!who) return false;
  const p = R.pairs.get(fp);
  if (p) { sendPair(p, 'rm'); await R.outq; }
  dropFriend(fp);
  const d2 = D();
  save({
    blocked: [...d2.blocked.filter(b => b.fp !== fp), { fp, name: displayName(who), at: Date.now() }].slice(-MAX_BLOCKED),
    declined: d2.declined.filter(x => x.fp !== fp),
  });
  syncInboxes();
  return true;
}
export function unblock(fp) { save({ blocked: D().blocked.filter(b => b.fp !== fp) }); }
export function setNick(fp, nick) { patchFriend(fp, { nick: cleanName(nick) }); }

/** Is this id on the public rooms one of my friends' devices? Learned from their
    sealed heartbeats. A public id proves nothing by itself (anyone can copy one),
    so this only decides what to show by default, never who to trust. */
export const isFriendId = id => typeof id === 'string' && !!id && D().friends.some(f => f.pid === id);

/** For a private two-person room (Notes' Write together): one tag per friend,
    from that friendship's own ECDH secret and the room's name, through HKDF.
    Two friends in the same room make the same tag; nobody else can, and a tag
    says nothing in any other room. -> [{ fp, tag }] — none when Friends isn't
    set up on this profile (it is never set up from here). */
export async function roomTags(context) {
  if (!available() || !secureOk() || !D().friends.length) return [];
  try { await ready(); } catch (e) { return []; }
  if (!R.priv) return [];
  const salt = await sha256(enc.encode(`staticos/friends/v1/room|${String(context)}`));
  const out = [];
  for (const f of D().friends) {
    try {
      const theirKey = await crypto.subtle.importKey('raw', unb64(f.pk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, R.priv, 256);
      const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
      const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('staticos/friends/v1/room-tag') }, hk, 128));
      out.push({ fp: f.fp, tag: b64(bits).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') });
    } catch (e) { /* a friend whose key won't load is simply not matched */ }
  }
  return out;
}
export const displayName = f => (f ? cleanName(f.nick) || cleanName(f.name) || 'Friend' : 'Friend');

export function friends() {
  return D().friends.map(f => {
    const p = R.pairs.get(f.fp);
    const presence = presenceOf(p);
    const on = presence !== 'offline';
    const status = on && p.status && !(p.status.until && p.status.until <= Date.now()) ? p.status : null;
    return {
      fp: f.fp, name: cleanName(f.name) || 'Friend', nick: cleanName(f.nick), display: displayName(f), hue: hue(f.hue),
      picture: normPic(f.pic), costume: Avatar.normCostume(f.cos), since: Number(f.since) || 0,
      presence, status, game: on ? p.game : null,
      lastSeen: Math.max(Number(f.seen) || 0, (p && p.liveAt) || 0) || null,
      fav: f.fav === true, keyTag: keyTag(f.fp),
      birthday: BDAY_RE.test(f.bday || '') ? f.bday : '',
    };
  }).sort((a, b) => (b.fav - a.fav) || (a.presence === 'offline') - (b.presence === 'offline') || a.display.localeCompare(b.display));
}
export const incoming = () => D().incoming.map(x => ({ fp: x.fp, name: cleanName(x.name) || 'Someone', hue: hue(x.hue), picture: normPic(x.pic), costume: Avatar.normCostume(x.cos), at: x.at, code: x.code,
  keyTag: keyTag(x.fp), twin: x.twin && friendOf(x.twin) ? displayName(friendOf(x.twin)) : '' }));
export const outgoing = () => D().outgoing.map(o => ({ code: o.code, at: o.at, until: o.until, state: o.state }));
export const blocked = () => D().blocked.map(b => ({ fp: b.fp, name: cleanName(b.name) || 'Someone', at: b.at }));

export function nights() {
  const now = Date.now();
  const fr = new Map(D().friends.map(f => [f.fp, f]));
  return D().nights.map(n => {
    const host = n.host === R.fp;
    const rs = n.rsvp || {};
    const mine = host ? 'yes' : (n.mine || rs[R.fp] || null);
    const end = n.at + n.len * 60_000;
    const state = n.cancelled ? 'cancelled' : now >= end ? 'over' : now >= n.at ? 'live' : now >= n.at - JOIN_EARLY_MS ? 'soon' : 'upcoming';
    const nameOf = fp => (fp === R.fp ? 'You' : fr.has(fp) ? displayName(fr.get(fp)) : null);
    const names = ans => n.invited.filter(fp => (fp === R.fp ? mine : rs[fp]) === ans).map(nameOf);
    return {
      id: n.id, host, hostName: host ? 'You' : displayName(fr.get(n.host)), hostFp: n.host,
      name: nightName(n), title: n.title || '', game: { ...n.game, title: gameTitle(n.game) }, at: n.at, len: n.len, end,
      invited: n.invited.map(fp => ({ fp, name: nameOf(fp), answer: (fp === R.fp ? mine : rs[fp]) || null })),
      going: names('yes'), maybe: names('maybe'), no: names('no'),
      mine, confirmed: host || (!!mine && rs[R.fp] === mine), party: n.party || null, room: n.room || null,
      weekly: !!n.weekly, skipped: n.skipped || 0, calendar: !!n.cal,
      via: roomNight(n) ? 'room' : n.game.kind === 'anime' ? 'watch' : 'party', state,
      canJoin: state === 'soon' || state === 'live',
    };
  }).sort((a, b) => (a.state === 'over' || a.state === 'cancelled') - (b.state === 'over' || b.state === 'cancelled') || a.at - b.at);
}

export async function createNight({ title = '', game, at, len = 60, invite = [], weekly = false } = {}) {
  await start();
  const d = D();
  const now = Date.now();
  const kind = game && (game.kind === 'arcade' || game.kind === 'web' || game.kind === 'anime') ? game.kind : null;
  if (!kind || !GAME_ID.test(game.id || '') || (kind === 'arcade' && !arcadeById(game.id)) || (kind === 'anime' && !ANIME_ID.test(game.id))) return { ok: false, error: 'game' };
  if (!Number.isFinite(at) || at < now - 60_000 || at > now + 60 * DAY) return { ok: false, error: 'time' };
  const L = Math.round(Number(len));
  if (!Number.isInteger(L) || L < 15 || L > 360) return { ok: false, error: 'length' };
  const fr = new Set(d.friends.map(f => f.fp));
  const invited = [...new Set(invite)].filter(fp => fr.has(fp)).slice(0, MAX_INVITE);
  if (!invited.length) return { ok: false, error: 'invite' };
  if (d.nights.filter(n => n.at + n.len * 60_000 > now).length >= MAX_NIGHTS) return { ok: false, error: 'full' };
  const n = {
    id: rid(12), host: R.fp, title: cleanLine(title, TITLE_MAX),
    game: { kind, id: game.id, title: kind === 'web' || kind === 'anime' ? cleanLine(game.title, 80) || null : null },
    at: Math.floor(at / 60_000) * 60_000, len: L, invited, rsvp: {}, party: null, cancelled: false, updated: now,
    weekly: weekly === true, skipped: 0,
  };
  save({ nights: [...d.nights, n] });
  syncReminders();
  sendNight(n);
  return { ok: true, id: n.id };
}
export function rsvp(id, answer) {
  if (!ANSWERS.includes(answer)) return false;
  const d = D();
  const n = d.nights.find(x => x.id === id);
  if (!n || n.host === R.fp || n.cancelled) return false;
  save({ nights: d.nights.map(x => (x.id === id ? { ...x, mine: answer } : x)) });
  const p = R.pairs.get(n.host);
  if (p) sendPair(p, 'rsvp', { id, r: answer });
  syncReminders();
  return true;
}
export function cancelNight(id) {
  const d = D();
  const n = d.nights.find(x => x.id === id && x.host === R.fp);
  if (!n || n.cancelled) return false;
  const next = { ...n, cancelled: true, updated: bump(n.updated) };
  save({ nights: d.nights.map(x => (x.id === id ? next : x)) });
  sendNight(next);
  syncReminders();
  return true;
}
/** Host: a weekly night leaves out its next turn. It moves on a week, answers start again, and guests are told. */
export function skipNight(id) {
  const d = D();
  const n = d.nights.find(x => x.id === id && x.host === R.fp);
  if (!n || !n.weekly || n.cancelled) return false;
  const next = { ...n, at: n.at + 7 * DAY, rsvp: {}, party: null, room: null, skipped: n.at, updated: bump(n.updated) };
  save({ nights: d.nights.map(x => (x.id === id ? next : x)) });
  sendNight(next);
  syncReminders();
  if (n.cal) skipInCalendar(n.cal, n.at);
  return true;
}
/** A weekly night whose turn is over moves to the same time next week (its host's device does this). */
function rollNights(now) {
  const d = D();
  let hit = false;
  const list = d.nights.map(n => {
    if (!n.weekly || n.host !== R.fp || n.cancelled || n.at + n.len * 60_000 >= now) return n;
    let at = n.at;
    while (at + n.len * 60_000 < now) at += 7 * DAY;
    hit = true;
    return { ...n, at, rsvp: {}, party: null, room: null, skipped: 0, updated: bump(n.updated) };
  });
  if (!hit) return;
  save({ nights: list });
  list.filter(n => n.weekly && n.host === R.fp).forEach(n => sendNight(n));
  syncReminders();
}
const ymdOf = ms => { const d = new Date(ms); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const hmOf = ms => { const d = new Date(ms); const p = x => String(x).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
async function skipInCalendar(calId, skippedAt) {
  try {
    const C = await import('./calendar.js');
    const ev = C.byId(calId);
    if (!ev) return;
    const day = ymdOf(skippedAt);
    if (day > ev.date) C.updateEvent(calId, { skip: [...ev.skip, day] });
    else C.updateEvent(calId, { date: ymdOf(skippedAt + 7 * DAY), skip: [] });
  } catch (e) { console.warn('[friends] calendar skip', e); }
}
/** Put a night in Calendar (a weekly one repeats every week). Once: asking again says so. -> { ok, already?, error? } */
export async function addNightToCalendar(id) {
  const d = D();
  const n = d.nights.find(x => x.id === id);
  if (!n || n.cancelled) return { ok: false, error: 'night' };
  try {
    const C = await import('./calendar.js');
    if (n.cal && C.byId(n.cal)) return { ok: true, already: true };
    const r = C.addEvent({
      title: nightName(n), date: ymdOf(n.at), time: hmOf(n.at), end: hmOf(n.at + n.len * 60_000) > hmOf(n.at) ? hmOf(n.at + n.len * 60_000) : '',
      repeat: n.weekly ? 'weekly' : 'none', remind: null, notes: 'Planned in Static Social › Friends.',
    });
    if (!r.ok) return { ok: false, error: 'calendar' };
    save({ nights: D().nights.map(x => (x.id === id ? { ...x, cal: r.event.id } : x)) });
    return { ok: true, event: r.event.id };
  } catch (e) { return { ok: false, error: 'calendar' }; }
}

export function removeNight(id) {
  const d = D();
  const n = d.nights.find(x => x.id === id);
  if (!n) return false;
  if (n.host === R.fp && !n.cancelled && n.at + n.len * 60_000 > Date.now()) cancelNight(id);
  save({ nights: D().nights.filter(x => x.id !== id) });
  syncReminders();
  return true;
}
/** Host: open the night's room — an Arcade room for a two-player online game
    with one friend, a Static Party (reused if it's still yours) otherwise —
    and send its code to the people invited. */
export async function startNight(id) {
  await start();
  const n = D().nights.find(x => x.id === id && x.host === R.fp);
  if (!n || n.cancelled || n.game.kind === 'anime') return null;     /* an anime night has no room or party to open */
  let patch;
  if (roomNight(n)) {
    const code = await new Promise(res => {
      let off = null;
      const t = setTimeout(() => { off?.(); res(null); }, 20_000);
      off = bus.on('arcade:room', e => {
        if (!e || e.game !== n.game.id || !PARTY_CODE.test(e.code || '')) return;
        clearTimeout(t); off(); res(e.code);
      });
      try { api.openApp('arcade', { game: n.game.id, online: true, host: true }); } catch (e) { clearTimeout(t); off(); res(null); }
    });
    if (!code) return null;
    patch = { room: code };
  } else {
    const P = await import('../portal/party.js');
    const cur = P.current();
    let code = n.party && cur && cur.code === n.party ? n.party : null;
    if (!code) {
      code = P.create();
      await P.chooseGame({ kind: n.game.kind, id: n.game.id });
    }
    patch = { party: code };
    try { api.openApp('party', {}); } catch (e) { /* no shell */ }
  }
  const d = D();
  const was = d.nights.find(x => x.id === id);
  if (!was) return null;
  const next = { ...was, ...patch, updated: bump(was.updated) };
  save({ nights: d.nights.map(x => (x.id === id ? next : x)) });
  sendNight(next);
  return patch.room || patch.party;
}
/** The Join button (and the reminder's): only ever from a click. */
export async function joinNight(id) {
  await start();
  const n = D().nights.find(x => x.id === id);
  if (!n) return false;
  if (n.cancelled) { openSocial({ night: id }); return false; }
  /* an anime night: everyone watches on their own official service, at the same time — Join opens the title */
  if (n.game.kind === 'anime') { try { api.openApp('aether-anime', { url: `static://anime/${n.game.id}` }); return true; } catch (e) { return false; } }
  if (n.host === R.fp) return !!(await startNight(id));
  if (n.room && PARTY_CODE.test(n.room)) { api.openApp('arcade', { join: n.room }); return true; }
  if (n.party && PARTY_CODE.test(n.party)) { api.openApp('party', { code: n.party }); return true; }
  openSocial({ night: id });
  return false;
}

/* ---------------- stars, groups, options ---------------- */
/** A short tag made from a friend's key, to compare out loud or by message. */
export const keyTag = fp => (FP_RE.test(String(fp)) ? `${fp.slice(0, 4)} ${fp.slice(4, 8)} ${fp.slice(8, 12)}`.toUpperCase() : '');
function bdayIn(b, y) {
  const mm = b.slice(2, 4), dd = b.slice(5, 7);
  const t = new Date(y, +mm - 1, +dd);
  return t.getMonth() === +mm - 1 ? `${y}-${mm}-${dd}` : `${y}-${mm}-28`;     /* 29 February in a year without one */
}
export function setFavourite(fp, on) {
  if (!friendOf(fp)) return false;
  patchFriend(fp, { fav: !!on });
  return true;
}

/** Groups are a shortcut for inviting or asking several friends at once; they exist on this device only. */
export function groups() {
  const have = new Set(D().friends.map(f => f.fp));
  return D().groups.map(g => ({ id: g.id, name: cleanLine(g.name, 30) || 'Group', members: g.members.filter(fp => have.has(fp)) }));
}
/** Make a group, or change one (pass its id). -> { ok, id?, error?: 'name' | 'members' | 'full' | 'gone' } */
export function saveGroup({ id = null, name = '', members = [] } = {}) {
  const d = D();
  const nm = cleanLine(name, 30);
  if (!nm) return { ok: false, error: 'name' };
  const have = new Set(d.friends.map(f => f.fp));
  const list = [...new Set(members)].filter(fp => have.has(fp)).slice(0, MAX_INVITE);
  if (!list.length) return { ok: false, error: 'members' };
  if (id) {
    if (!d.groups.some(g => g.id === id)) return { ok: false, error: 'gone' };
    save({ groups: d.groups.map(g => (g.id === id ? { id, name: nm, members: list } : g)) });
    return { ok: true, id };
  }
  if (d.groups.length >= MAX_GROUPS) return { ok: false, error: 'full' };
  const gid = rid(8);
  save({ groups: [...d.groups, { id: gid, name: nm, members: list }] });
  return { ok: true, id: gid };
}
export function deleteGroup(id) {
  const d = D();
  if (!d.groups.some(g => g.id === id)) return false;
  save({ groups: d.groups.filter(g => g.id !== id) });
  return true;
}
/**
 * Ask a whole group something: the poll goes to each member as a Static Chat direct message (their
 * own sealed friend topic), and shows in your own Chat under each of them. Nobody outside the group
 * gets it. -> { ok, sent, total, error?: 'group' | 'poll' }
 */
export async function sendGroupPoll(id, { q = '', opts = [], multi = false, dur = 0 } = {}) {
  const g = groups().find(x => x.id === id);
  if (!g || !g.members.length) return { ok: false, sent: 0, total: 0, error: 'group' };
  const POLL = await import('./polls.js');
  const meta = POLL.parsePoll({ pid: rid(10), q, opts, multi: !!multi, anon: false, dur });
  if (!meta) return { ok: false, sent: 0, total: 0, error: 'poll' };
  await ready();
  const T = await import('../portal/chat.transport.js');
  let sent = 0;
  for (const fp of g.members) {
    try { await T.sendPoll(`dm:${fp}`, { ...meta, pid: rid(10) }); sent++; } catch (e) { /* that friend's chat did not take it */ }
  }
  return { ok: sent > 0, sent, total: g.members.length };
}

/* Options (Friends › You). Anything that shares something new starts off. */
export const options = () => ({ ...D().opts });
export function setOption(key, on) {
  const d = D();
  if (!['dndBusy', 'showCount', 'remindBirthdays', 'shareRecent', 'shareFavs'].includes(key)) return false;
  const opts = { ...d.opts, [key]: !!on };
  if (on && (key === 'shareRecent' || key === 'shareFavs')) opts.shared = true;
  save({ opts });
  if (key === 'dndBusy') soonBeat();
  else if (key === 'showCount') announceCount(true);
  else if (key === 'remindBirthdays') syncReminders();
  else pushShare(true);
  return true;
}
/** My birthday as month and day, no year: '--MM-DD' (also takes 'MM-DD' or 'YYYY-MM-DD'); '' takes it back. */
export function setBirthday(v) {
  const t = String(v || '').trim();
  const m = /^(?:\d{4}-|--)?(\d{2})-(\d{2})$/.exec(t);
  const b = m ? `--${m[1]}-${m[2]}` : '';
  if (t && !BDAY_RE.test(b)) return false;
  const d = D();
  save({ opts: { ...d.opts, birthday: b, shared: d.opts.shared || !!b } });
  pushShare(true);
  return true;
}
/** What is being shared with friends right now (for "What your friends see"). */
export function sharing() {
  const o = D().opts;
  return { recent: o.shareRecent, favs: o.shareFavs, birthday: o.birthday, dndBusy: o.dndBusy };
}

/* ---------------- what friends choose to share ('shr') ---------------- */
function recentList() {
  const out = [];
  for (const r of plays.recent(40)) {
    if (out.length >= SHARE_RECENT) break;
    if (r.kind === 'arcade' && arcadeById(r.id)) out.push({ k: 'arcade', i: r.id });
    else if (r.kind === 'web' && GAME_ID.test(String(r.id))) out.push({ k: 'web', i: String(r.id) });
  }
  return out;
}
const FAV_KEY = 'portal.games.favs';           /* Static Games' favourites (core/quickplay.js reads the same list) */
function favList() {
  const v = store.get(FAV_KEY, []);
  return (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && GAME_ID.test(x)).slice(0, SHARE_FAVS);
}
function shareBody() {
  const o = D().opts;
  const r = o.shareRecent ? recentList() : null, f = o.shareFavs ? favList() : null, b = o.birthday || null;
  if (!o.shared && r === null && f === null && b === null) return null;        /* never shared: nothing to say */
  return { r, fv: f, b };
}
function sendShare(p) {
  const b = shareBody();
  if (b) sendPair(p, 'shr', b);
}
function pushShare(force) {
  R.shareAt = Date.now();
  R.shareSig = JSON.stringify(shareBody());
  if (!force && R.shareSig === 'null') return;
  R.pairs.forEach(p => sendShare(p));
}
function shareTick(now) {
  if (now - (R.shareAt || 0) < SHARE_EVERY_MS) return;
  if (JSON.stringify(shareBody()) !== R.shareSig) pushShare(false);
  else R.shareAt = now;
}
function onShared(p, m) {
  if (!friendOf(p.fp)) { R.stats.ignored++; return; }
  if (!('r' in m) && !('fv' in m) && !('b' in m)) { R.stats.ignored++; return; }
  /* one a second from a friend; a change that comes sooner waits its turn (the latest one), so a switch turned off is never lost */
  if (!mayReply(`shr:${p.fp}`, 1000)) {
    p.shrLate = m;
    if (!p.shrT) p.shrT = setTimeout(() => { p.shrT = 0; const late = p.shrLate; p.shrLate = null; if (late && !p.closed) onShared(p, late); }, 1100);
    return;
  }
  const at = Date.now();
  const patch = {};
  if ('r' in m) {
    if (m.r === null) patch.recent = null;
    else if (Array.isArray(m.r)) {
      const list = [];
      for (const x of m.r.slice(0, SHARE_RECENT)) {
        if (x && (x.k === 'web' || x.k === 'arcade') && typeof x.i === 'string' && GAME_ID.test(x.i) && (x.k === 'web' || arcadeById(x.i))) list.push({ k: x.k, i: x.i });
      }
      patch.recent = { list, at };
    }
  }
  if ('fv' in m) {
    if (m.fv === null) patch.favs = null;
    else if (Array.isArray(m.fv)) patch.favs = { list: [...new Set(m.fv.filter(x => typeof x === 'string' && GAME_ID.test(x)))].slice(0, SHARE_FAVS), at };
  }
  if ('b' in m) {
    if (m.b === null) patch.bday = '';
    else if (typeof m.b === 'string' && BDAY_RE.test(m.b)) patch.bday = m.b;
  }
  if (!Object.keys(patch).length) { R.stats.ignored++; return; }
  const was = friendOf(p.fp)?.bday || '';
  patchFriend(p.fp, patch);
  if ('bday' in patch && patch.bday !== was) syncReminders();
  changed();
}
/** What a friend chose to share with me: { recent, favs, at } — a part is null when they don't share it. Ids only: titles are looked up here. */
export function sharedBy(fp) {
  const f = friendOf(fp);
  if (!f) return null;
  const ok = x => (x && Array.isArray(x.list) ? x : null);
  const r = ok(f.recent), v = ok(f.favs);
  return { recent: r ? r.list.map(x => ({ kind: x.k, id: x.i })) : null, favs: v ? v.list.slice() : null, at: Math.max(r ? r.at : 0, v ? v.at : 0) };
}
/** Static Games ids both of us have as a favourite: theirs (only if they share them) against my own list. */
export function bothFavourited(fp) {
  const f = friendOf(fp);
  if (!f || !f.favs || !Array.isArray(f.favs.list)) return [];
  const mine = new Set(favList());
  return f.favs.list.filter(id => mine.has(id));
}

/* ---------------- how many friends are online ---------------- */
export function onlineCount() {
  const have = new Set(D().friends.map(f => f.fp));
  let n = 0;
  for (const p of R.pairs.values()) if (have.has(p.fp) && presenceOf(p) !== 'offline') n++;
  return n;
}
/** Tells the top bar and the dock (bus 'friends:count') when the number moves. */
function announceCount(force = false) {
  const d = D();
  const on = d.opts.showCount && d.friends.length > 0 && R.started;
  const online = on ? onlineCount() : 0;
  const sig = `${on}:${online}`;
  /* said again now and then, so a bar that was drawn later still learns it */
  if (!force && sig === R.countSig && Date.now() - (R.countAt || 0) < 30_000) return;
  R.countSig = sig;
  R.countAt = Date.now();
  bus.emit('friends:count', { on, online, total: d.friends.length });
}

/* ---------------- invites: a Static Party, a Study together room ---------------- */
async function sendInvite(fp, t, c) {
  if (!PARTY_CODE.test(String(c || ''))) return { ok: false, error: 'code' };
  await start();
  const p = R.pairs.get(fp);
  if (!p || !p.key || !friendOf(fp)) return { ok: false, error: 'friend' };
  if (!mayReply(`${t}out:${fp}`, 2000)) return { ok: false, error: 'wait' };
  return { ok: true, live: sendPair(p, t, { c }) };
}
/** Invite one friend to my Static Party. -> { ok, live?, error?: 'code' | 'friend' | 'wait' } */
export const sendPartyInvite = (fp, code) => sendInvite(fp, 'pin', code);
/** Invite one friend to my Study together room. */
export const sendStudyInvite = (fp, code) => sendInvite(fp, 'sin', code);

/** Invite one friend to my open Watch Together / Flex Battle room (the same six-letter room code the app shows). */
export const sendWatchInvite = (fp, code) => sendInvite(fp, 'wti', code);
export const sendFlexInvite = (fp, code) => sendInvite(fp, 'fbi', code);
export const sendPianoInvite = (fp, code) => sendInvite(fp, 'pni', code);
export const sendBeatsInvite = (fp, code) => sendInvite(fp, 'bti', code);
const ROOM_APPS = {
  wti: { app: 'watch-together', title: 'to watch together', msg: 'Join opens Watch Together with their room code. Nothing joins until you press it.', icon: 'users' },
  pni: { app: 'piano', title: 'to play a duet', msg: 'Join opens Static Piano with their room code. Nothing joins until you press it.', icon: 'music' },
  bti: { app: 'beats', title: 'to make a beat together', msg: 'Join opens Static Beats with their room code. Nothing joins until you press it.', icon: 'grid' },
  fbi: { app: 'flex-battle', title: 'to a Flex Battle', msg: 'Join opens Flex Battle with their room code. Cameras stay off until you turn them on.', icon: 'camera' },
};
function onRoomAppInvite(p, m, t) {
  const A = ROOM_APPS[t];
  if (!PARTY_CODE.test(m.c || '') || !friendOf(p.fp)) { R.stats.ignored++; return; }
  if (!mayReply(`${t}:${p.fp}`, 5000)) { R.stats.dropped++; return; }
  const join = () => { try { api.openApp(A.app, { join: m.c }); } catch (e) { /* no shell */ } };
  notify({
    key: `friends-${t}-${p.fp}`, from: p.fp, timeout: 0, icon: A.icon, title: `${displayName(friendOf(p.fp))} invited you ${A.title}`,
    message: A.msg, actions: [{ label: 'Join', onClick: join }], onClick: join,
  });
}

function onPartyInvite(p, m) {
  if (!PARTY_CODE.test(m.c || '')) { R.stats.ignored++; return; }
  if (!friendOf(p.fp)) { R.stats.ignored++; return; }
  if (!mayReply(`pin:${p.fp}`, 5000)) { R.stats.dropped++; return; }
  const join = () => { try { api.openApp('party', { code: m.c }); } catch (e) { /* no shell */ } };
  notify({
    key: `friends-pin-${p.fp}`, from: p.fp, timeout: 0, title: `${displayName(friendOf(p.fp))} invited you to their party`,
    message: 'Join opens Static Party with their code. Nothing joins until you press it.',
    actions: [{ label: 'Join', onClick: join }],
  });
}
function onStudyInvite(p, m) {
  if (!PARTY_CODE.test(m.c || '')) { R.stats.ignored++; return; }
  if (!friendOf(p.fp)) { R.stats.ignored++; return; }
  if (!mayReply(`sin:${p.fp}`, 5000)) { R.stats.dropped++; return; }
  const join = () => import('./studyroom.js').then(SR => { SR.join(m.c); openSocial({}); }).catch(() => {});
  notify({
    key: `friends-sin-${p.fp}`, from: p.fp, timeout: 0, icon: 'clock', title: `${displayName(friendOf(p.fp))} wants to study together`,
    message: 'Join puts you in a shared focus timer with them. Nothing starts until you press it.',
    actions: [{ label: 'Join', onClick: join }],
  });
}

/** A message to copy and send to someone you know: the code, how to add it, and who to share it with. */
export function inviteMessage(code) {
  if (!isCode(code)) return '';
  const link = inviteLink(code);
  return `Hi! Here’s my StaticOS friend code: ${spaced(code)}\n`
    + `To add me: open StaticOS, go to Social › Friends, type the code under “Add a friend” and press Send request${link ? ` (or open ${link})` : ''}. I’ll see your request and accept it.\n`
    + 'Only share this with people you know, and only add people you know. Anyone who has the code can send me a request.';
}

/* for the play-tests: counters and topics, never keys */
export const _debug = {
  stats: () => ({ ...R.stats }),
  fp: () => R.fp,
  topics: () => ({
    pairs: [...R.pairs.values()].map(p => ({ fp: p.fp, topic: p.topic, lastAt: p.lastAt, liveAt: p.liveAt })),
    inboxes: [...R.inboxes.values()].map(e => ({ code: e.code, topic: e.topic, kinds: [...e.kinds] })),
  }),
};

export default {
  init, start, ready, ensureCode, rotateCode, myCode, inviteLink, normCode, isCode, spaced,
  request, cancelRequest, accept, decline, block, unblock, remove, setNick,
  friends, incoming, outgoing, blocked, myStatus, setStatus, clearStatus, shareGame, setShareGame,
  currentGame, whatFriendsSee, sendCard, withdrawCard, cards, cleanCard, nights, createNight, rsvp, cancelNight, removeNight, startNight, joinNight, sendLink, sendArcade, sendCollection, sendRoomInvite, sendMedia, sendDm,
  sendLook, looks, dismissLook,
  setFavourite, groups, saveGroup, deleteGroup, sendGroupPoll, skipNight, addNightToCalendar, options, setOption, setBirthday, sharing,
  sharedBy, bothFavourited, onlineCount, sendPartyInvite, sendStudyInvite, inviteMessage, keyTag,
  onChange, liveStatus, PRESETS, EXPIRY, isFriendId, roomTags,
};
