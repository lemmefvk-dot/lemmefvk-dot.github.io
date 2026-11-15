/* ============================================================
   chatwire.js — what a Static Chat message looks like on the wire,
   and the checks every one passes before anything shows it.

   No DOM, no network. Two carriers use it:
     · a shared space (a private pair.js room, kind 'chat') sends
       these as its 'cm' message;
     · a direct message to a real friend (friends.js) sends them
       as the friend topic's 'dm' message.
   Either way the envelope belongs to the carrier (v, t, f, at), so a
   body never uses those names. The kind is `k`:

     txt   { id, b, rt? }          text (≤ BODY_MAX), reply to message rt
     stk   { id, s }               a sticker from the sticker pack
     card  { id, c:{k,i,ti} }      a pointer to a game / anime / Roblox page
     file  { id, n, z }            a file's NAME and size only — never its bytes
     poll  { id, p }               a poll (js/core/polls.js parsePoll)
     vote  { p:{pid,ch,n} }        a vote       close { pid }
     rx    { id, e, on }           a reaction to message id
     del   { id }   edt { id, b }  delete / edit your own message
     vc    { id, i, n, d, dur, m } one piece of a voice message (rooms only)

   A card is a pointer: the receiver looks the id up in its OWN
   catalogue and shows its own title, so nothing in a message can
   name a page the device doesn't already have. A voice message is
   sent in pieces through the room and put back together on the
   other side; it is capped in length and size and kept only in
   memory (see MAX_MS / MAX_BYTES).
   ============================================================ */
import { cleanText, INVISIBLE } from './roomcode.js';
import { parsePoll, parseVote, parseClose } from './polls.js';

export const BODY_MAX = 2000;
export const REACTIONS = ['👍', '🔥', '😂', '❤️', '👀'];
export const ID_RE = /^[a-z0-9]{6,24}$/;
const GAME_ID = /^[A-Za-z0-9_-]{1,96}$/;
const STICKER_RE = /^pp-[a-z0-9-]{1,40}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const CARD_KINDS = {
  game: { id: GAME_ID, label: 'Game' },
  anime: { id: /^\d{1,9}$/, label: 'Anime' },
  roblox: { id: /^\d{1,20}$/, label: 'Roblox' },
};

/* a voice message: length and size are capped on both ends */
export const VOICE = {
  MAX_MS: 30000, MAX_BYTES: 120_000, CHUNK: 8000, MAX_CHUNKS: 24,
  MIMES: ['audio/webm', 'audio/ogg', 'audio/mp4'], BITS: 24000, WAIT: 20000,
};

/** Someone else's text, safe to show: no control or invisible characters (lines are kept), capped. */
export const cleanBody = (s, max = BODY_MAX) => String(s ?? '')
  .replace(INVISIBLE, '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max);

export const newId = () => {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return [...a].map(b => (b % 36).toString(36)).join('');
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const idOk = v => typeof v === 'string' && ID_RE.test(v);

/** A message body from another device -> a cleaned copy, or null. `voice` is false on the friend topic. */
export function parseChat(m, { voice = true } = {}) {
  if (!isObj(m) || typeof m.k !== 'string') return null;
  switch (m.k) {
    case 'txt': {
      const b = cleanBody(m.b);
      if (!idOk(m.id) || !b) return null;
      return { k: 'txt', id: m.id, b, rt: idOk(m.rt) ? m.rt : null };
    }
    case 'stk':
      return idOk(m.id) && typeof m.s === 'string' && STICKER_RE.test(m.s) ? { k: 'stk', id: m.id, s: m.s } : null;
    case 'card': {
      const c = m.c;
      const K = isObj(c) && CARD_KINDS[c.k];
      if (!idOk(m.id) || !K || typeof c.i !== 'string' || !K.id.test(c.i)) return null;
      return { k: 'card', id: m.id, c: { k: c.k, i: c.i, ti: cleanText(c.ti, 80) } };
    }
    case 'file': {
      const n = cleanText(m.n, 120);
      if (!idOk(m.id) || !n || !Number.isSafeInteger(m.z) || m.z < 0 || m.z > 2 ** 40) return null;
      return { k: 'file', id: m.id, n, z: m.z };
    }
    case 'poll': {
      const p = parsePoll(m.p);
      return idOk(m.id) && p ? { k: 'poll', id: m.id, p } : null;
    }
    case 'vote': {
      const p = parseVote(m.p);
      return p ? { k: 'vote', p } : null;
    }
    case 'close': {
      const p = parseClose(m.p);
      return p ? { k: 'close', p } : null;
    }
    case 'rx':
      return idOk(m.id) && REACTIONS.includes(m.e) && typeof m.on === 'boolean' ? { k: 'rx', id: m.id, e: m.e, on: m.on } : null;
    case 'del':
      return idOk(m.id) ? { k: 'del', id: m.id } : null;
    case 'edt': {
      const b = cleanBody(m.b);
      return idOk(m.id) && b ? { k: 'edt', id: m.id, b } : null;
    }
    case 'vc': {
      if (!voice || !idOk(m.id)) return null;
      const ok = Number.isSafeInteger(m.i) && Number.isSafeInteger(m.n) && m.n >= 1 && m.n <= VOICE.MAX_CHUNKS && m.i >= 0 && m.i < m.n;
      if (!ok || typeof m.d !== 'string' || !m.d || m.d.length > VOICE.CHUNK + 8 || !B64.test(m.d)) return null;
      if (!Number.isSafeInteger(m.dur) || m.dur < 100 || m.dur > VOICE.MAX_MS + 1500) return null;
      if (!VOICE.MIMES.includes(m.m)) return null;
      return { k: 'vc', id: m.id, i: m.i, n: m.n, d: m.d, dur: m.dur, m: m.m };
    }
    default: return null;
  }
}

/** Does this text @mention `name`? (whole name, any case, not inside a longer word) */
export function mentions(text, name) {
  const n = cleanText(name, 40);
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w@])@${esc}(?![\\w])`, 'i').test(String(text));
}

/** "/poll Question | a | b" -> a command, "/play" -> a command, anything else -> null. */
export function parseCommand(text) {
  const m = /^\/(poll|play)\b\s*(.*)$/is.exec(String(text).trim());
  if (!m) return null;
  if (m[1].toLowerCase() === 'play') return { cmd: 'play', arg: m[2].trim() };
  const parts = m[2].split('|').map(s => cleanText(s, 140)).filter(Boolean);
  if (!parts.length) return { cmd: 'poll', form: true };
  return { cmd: 'poll', q: parts[0], opts: parts.slice(1) };
}

/** base64 of bytes, without the call-stack limit of String.fromCharCode(...bytes). */
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(text) {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}

export default { BODY_MAX, REACTIONS, CARD_KINDS, VOICE, cleanBody, newId, parseChat, mentions, parseCommand, toB64, fromB64 };
