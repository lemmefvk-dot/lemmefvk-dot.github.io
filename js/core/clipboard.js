/* ============================================================
   clipboard.js — the Static Clipboard engine (capture + history).

   What it can honestly see:
   · 'copy' and 'cut' events that happen in StaticOS's own page:
     text selected in an app and copied with the keyboard, the
     Edit menu or a context menu. It reads the selection itself
     (or, when an app's own copy handler replaced what goes on the
     clipboard, the text that app put there) and records the app
     whose window it happened in.
   · bus 'clipboard:add' { text, source } — for StaticOS code that
     writes with navigator.clipboard.writeText(), which fires no
     copy event. { sensitive: true } forces the sensitive path.
   · what the person explicitly brings in: the app's Paste button
     (navigator.clipboard.readText() on a click, which the browser
     may ask about) and ⌘V / Ctrl+V inside the app window.

   What it cannot see, and the app says so: a web page is not
   allowed to read the system clipboard in the background, so text
   copied in other programs, other tabs, or inside embedded pages
   and games (cross-origin frames) never arrives on its own.
   Copies from password fields, and from anything inside an
   element marked [data-clip-ignore], are never recorded.

   Sensitive text. Every capture is classified first (classify()):
   private keys, well-known token prefixes (sk-, ghp_, xoxb-,
   AKIA…), JWTs, webhook URLs, a password inside a link,
   "password = …" style assignments, Luhn-valid 13–19 digit card
   numbers, one-time codes, long random strings and
   password-shaped strings. A sensitive item lives in memory only:
   it is never written to the store, can't be pinned, and is
   removed 2 minutes after it was captured (at once if the screen
   locks). The app keeps it blurred until it is clicked.

   Persistence. Only non-sensitive items are saved, under
   store('portal.clipboard'): every pinned item (up to 50) plus
   the 30 most recent unpinned ones, each capped at 5,000
   characters. A capped item keeps its real length so the app can
   say exactly how much was kept. Other fields in that store
   object (the app's UI prefs) are left alone.

   Copying an item back (the app's Copy, Spotlight) goes through
   writeText like any other copy; the item keeps the source it was
   first recorded with and simply becomes the newest.

   Snippets. A pinned item can be given a name: a snippet. The app's
   Snippets tab lists those, and a snippet is kept like any pin (never
   expires). Un-pinning one drops its name.

   Expiry. Unpinned items can be set to expire after an hour, a day or
   a week (setExpiry()); the default is never. Pinned items and
   snippets are not touched. It is checked on load, every 30 seconds
   and when the tab comes back; it uses each item's own time, so an
   item that was already older than the setting goes at once.

   Pictures. A picture clip is a small copy (at most 480 px on the long
   side, kept as WebP/PNG text inside the history). It arrives only
   from StaticOS's own copy paths: navigator.clipboard.write() with an
   image in it (the engine wraps it like writeText), bus
   'clipboard:add' { image: Blob | data URL }, and the app's Paste or
   ⌘V. A page can't read the system clipboard in the background, so a
   picture copied in another program never arrives on its own. Pictures
   can't be pinned and only the 8 newest are kept.

   Export. exportItems() / exportJSON() / exportText() leave out every
   sensitive item, and anything classify() would flag.

   API: init() list() add(text, source, opts?) pin(id) unpin(id)
   remove(id) clear(opts?) onChange(fn) — plus bump(id) (an item
   was copied back), wouldDropOnUnpin(id), classify(text),
   search(q, opts?) / searchTerms(q) / matchesItem(item, terms)
   (every word must match; pinned first), status() (what this
   browser allows), stats() (diagnostics) and LIMITS — plus
   transform(text, id) / TRANSFORMS, countOf(text), combine(ids, sep),
   name(id, text) / addSnippet(name, text), expiry() / setExpiry(id)
   / EXPIRIES, addImage(src, source) / writeImageUnrecorded(blob),
   exportItems() / exportJSON() / exportText(). Emits bus
   'clipboard:change' { count } on change.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import { getApp } from './registry.js';

export const KEY = 'portal.clipboard';
export const LIMITS = Object.freeze({
  recent: 30,          // unpinned, non-sensitive items kept (and saved)
  pinned: 50,          // pinned items kept (and saved)
  sensitive: 10,       // sensitive items held in memory at once
  chars: 5000,         // characters kept per item
  ttl: 2 * 60 * 1000,  // a sensitive item's life, from capture
  images: 8,           // picture clips kept (and saved)
  imageSide: 480,      // longest side of a kept picture, px
  imageChars: 90000,   // a kept picture's data URL, characters
  name: 40,            // characters in a snippet's name
});
/* how long an unpinned item may sit in the history; 0 = for ever */
export const EXPIRIES = Object.freeze([
  { id: 'never', label: 'Never', ms: 0 },
  { id: 'hour', label: 'After an hour', ms: 3600e3 },
  { id: 'day', label: 'After a day', ms: 86400e3 },
  { id: 'week', label: 'After a week', ms: 7 * 86400e3 },
]);
const IMG_RE = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const VIA = new Set(['copy', 'cut', 'paste', 'app']);

let items = [];        // newest first (by .at)
let loaded = false;
let started = false;
let lastSig = null;    // what was last written, so a sensitive-only change never touches storage
let sweepTimer = 0;
let pending = null;    // the copy/cut event being dispatched right now
const subs = new Set();

const uid = () => `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ==================================================================== */
/*  sensitive-text detection                                            */
/* ==================================================================== */
const TOKEN_RE = new RegExp('(?:^|[^A-Za-z0-9_])(?:' + [
  'sk-(?=[A-Za-z0-9_-]*\\d)[A-Za-z0-9_-]{16,}',                       // OpenAI, Anthropic and friends
  '(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}',                      // Stripe
  'gh[pousr]_[A-Za-z0-9]{20,}', 'github_pat_[A-Za-z0-9_]{20,}',        // GitHub
  'glpat-[A-Za-z0-9_-]{20,}',                                          // GitLab
  'xox[abposr]-[A-Za-z0-9-]{10,}',                                     // Slack
  '(?:AKIA|ASIA)[0-9A-Z]{16}',                                         // AWS access key id
  'AIza[0-9A-Za-z_-]{35}',                                             // Google API key
  'ya29\\.[0-9A-Za-z_-]{20,}',                                         // Google OAuth token
  'hf_[A-Za-z0-9]{30,}',                                               // Hugging Face
  'npm_[A-Za-z0-9]{36}',                                               // npm
  'SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}',                       // SendGrid
  'shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}',                                // Shopify
  'dop_v1_[a-f0-9]{64}',                                               // DigitalOcean
  '[MNO][A-Za-z0-9_-]{23,25}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27,38}', // Discord token
  '\\d{8,10}:[A-Za-z0-9_-]{35}',                                       // Telegram bot token
].join('|') + ')');
const PEM_RE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/;
const HOOK_RE = /https:\/\/(?:(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}|hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]{16,})/;
const CRED_URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S/i;
const ASSIGN_RE = /\b(password|passwd|passphrase|passcode|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|token)\b["']?\s*[:=]\s*["']?([^\s"',;)]{4,})/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/;
/* "my password is Blue-Fish-42" — the value needs a digit or symbol, so "your password was changed" isn't flagged */
const PW_SENTENCE_RE = /\b(?:password|passcode|passphrase)\s+(?:is|was)\s*[:-]?\s*(?:["'“][^"'”]{4,}["'”]|(?=\S{4,})\S*[\d!@#$%^&*?+=~]\S*)/i;
const APPLE_PW_RE = /^(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/;   // Hwtd3k-pumjit-zomquX
const OTP_WORD_RE = /\b(?:code|otp|one[- ]time|verification|verify|passcode|2fa|two[- ]factor)\b|\bPIN\b/i;
const OTP_NUM_RE = /(?:^|[^\w])\d{4,8}(?:[^\w]|$)/;

/* single-token shapes that are ordinary, not secret */
const NOT_SECRET = [
  /^[a-z][a-z0-9+.-]*:\/\//i,                                        // a link with a scheme
  /^www\./i,
  /^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}(?::\d{2,5})?(?:[/?#]\S*)?$/,  // a bare domain or link
  /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/,                                  // an email address
  /^(?:~|\.{1,2})?\/|^[A-Za-z]:\\|^\\\\/,                             // a file path
  /^[\w.-]+:\d{2,5}$/,                                                // host:port
  /^#?[0-9a-f]{3,8}$/i,                                               // a hex colour
  /^[@#][A-Za-z_]\w*$/,                                               // @handle, #hashtag
  /^v?\d+(?:\.\d+){1,3}(?:[-+][\w.+-]+)?$/i,                          // a version number
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // a UUID is an identifier
  /^<[^>]+>/,                                                         // markup
  /^[[{].*[\]}]$/,                                                    // JSON-ish
  /^[A-Za-z_$][\w$.]*\(.*\);?$/,                                      // a function call
  /^[\d\s.,:/+()$€£¥%-]+$/,                                           // numbers, dates, prices
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/i, // an ISO timestamp
];

/* A relative path or a file:line reference — "js/core/clipboard.js:512",
   "assets/img/hero2x.png", "release/v4.0.1". The absolute forms are already
   in NOT_SECRET; these are what a person actually copies out of an editor or
   a stack trace, and losing them to the sensitive path would be wrong. The
   word-share test keeps a slash-bearing random token ("aB3kX9mQ/pL7vR4nT8")
   out of the exemption. */
const REL_PATH_RE = /^[\w@~][\w@~.+-]*(?:\/[\w@~.+-]+)+(?::\d{1,7}){0,2}$/;
function looksLikePath(t) {
  if (t.length > 300 || !REL_PATH_RE.test(t)) return false;
  return wordShare(t.replace(/[/:_.+@~-]/g, '')) >= 0.5;
}

const charClass = c => (c >= 'A' && c <= 'Z') ? 1 : (c >= 'a' && c <= 'z') ? 2 : (c >= '0' && c <= '9') ? 3 : 4;
/** share of neighbouring characters that switch between upper/lower/digit/other */
function flipRate(s) {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (charClass(s[i]) !== charClass(s[i - 1])) n++;
  return s.length > 1 ? n / (s.length - 1) : 0;
}
/** Shannon entropy, bits per character */
function entropy(s) {
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) || 0) + 1);
  let e = 0;
  for (const n of f.values()) { const p = n / s.length; e -= p * Math.log2(p); }
  return e;
}
/** share of the string made of runs that read like words ("Phone", "Pro", "build") */
function wordShare(s) {
  const m = s.match(/[A-Z][a-z]{2,}|[a-z]{3,}/g);
  return m ? m.join('').length / s.length : 0;
}
/** "password = hunter22", "API_KEY=abcd1234…" — but not code that merely names one.
    -> 'password' | 'key' | null */
function secretAssignment(t) {
  for (const m of t.matchAll(ASSIGN_RE)) {
    const name = m[1].toLowerCase();
    const val = m[2];
    if (/^(?:null|undefined|none|nil|true|false|await|new|function|require|import|string|number|str|int|bool|os\.environ|process\.env)\b/i.test(val)) continue;
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(val)) continue;   // a reference like req.body.password
    if (/[()[\]{}<>]/.test(val)) continue;                                // code, not a value
    if (/^(?:\$\{|\{\{|%|\$[A-Z_])/.test(val)) continue;                   // ${X}, {{x}}, %s, $API_KEY placeholders
    if (/^pass|^pwd/.test(name)) return 'password';
    if (val.length >= 8 && /\d/.test(val) && /[A-Za-z]/.test(val)) return 'key';
  }
  return null;
}
function luhn(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = d.charCodeAt(d.length - 1 - i) - 48;
    if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}
const sameDigit = d => { for (let i = 1; i < d.length; i++) if (d[i] !== d[0]) return false; return true; };
/** a Luhn-valid 13–19 digit run, digits optionally grouped by single spaces or dashes */
function hasCardNumber(t) {
  let count = 0;
  for (let i = 0; i < t.length && count < 13; i++) { const c = t.charCodeAt(i); if (c >= 48 && c <= 57) count++; }
  if (count < 13) return false;                                      // not enough digits anywhere
  const re = /\d+(?:[ -]\d+)*/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t[m.index - 1], after = t[m.index + m[0].length];
    if ((before && /[A-Za-z0-9_]/.test(before)) || (after && /[A-Za-z0-9_]/.test(after))) continue;
    const groups = m[0].split(/[ -]/);
    for (let i = 0; i < groups.length; i++) {
      let digits = '';
      for (let j = i; j < groups.length; j++) {
        digits += groups[j];
        if (digits.length > 19) break;
        if (digits.length >= 13 && !sameDigit(digits) && luhn(digits)) return true;
      }
    }
  }
  return false;
}
function isOneTimeCode(t) {
  if (/^(?:[A-Z]{1,3}-)?\d{6,8}$/.test(t)) return true;              // 482913, G-482913
  if (/^\d{3,4}[ -]\d{3,4}$/.test(t)) return true;                   // 482 913, 4829-1375
  return t.length <= 400 && OTP_WORD_RE.test(t) && OTP_NUM_RE.test(t); // "Your code is 4829"
}
function isRandomToken(t) {
  if (t.length < 20 || t.length > 512) return false;
  if (!/^[A-Za-z0-9_\-+/=.~]+$/.test(t)) return false;
  if (!/\d/.test(t) || !/[A-Za-z]/.test(t)) return false;
  /* a file name ends in an extension; a dotted token has long segments */
  if (/\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(t) && !/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(t)) return false;
  const core = t.replace(/[_\-+/=.~]/g, '');
  if (core.length < 16) return false;
  return flipRate(core) >= 0.3 && wordShare(core) < 0.4 && entropy(core) >= 3.2;
}
/* two word-like runs joined by punctuation: "Ctrl+Shift+P", "Hello-World!",
   "docs/api/index.html", "TODO:fix-this". A password's symbols sit inside or
   after one opaque run ("hunter2!!", "s3cr3t!pass"), not between two words. */
const COMPOUND_RE = /[A-Za-z]{2,}[0-9]*[^A-Za-z0-9]+[0-9]*[A-Za-z]{2,}/;
/** the longest unbroken letters-and-digits run — a password has one, an id or a date does not */
function longestRun(t) {
  let best = 0;
  for (const m of t.match(/[A-Za-z0-9]+/g) || []) if (m.length > best) best = m.length;
  return best;
}

function isPasswordShaped(t) {
  if (t.length < 8 || t.length > 64) return false;
  if (APPLE_PW_RE.test(t)) return true;                              // a generated password
  const up = /\p{Lu}/u.test(t), lo = /\p{Ll}/u.test(t), di = /\p{N}/u.test(t);
  const sp = /[^\p{L}\p{N}_.\-]/u.test(t);
  const n = up + lo + di + sp;
  if (n === 4) return true;                                          // Tr0ub4dor&3
  /* hunter2!! — but not "Ctrl+Shift+P", "PO#88213" or "2026-10-21T14:30:00Z" */
  if (n === 3 && sp) return longestRun(t) >= 6 && !COMPOUND_RE.test(t);
  if (n === 3) {                                                     // xK9mP2qL, not iPhone15Pro
    const core = t.replace(/[_.\-]/g, '');
    return core.length >= 8 && flipRate(core) >= 0.35 && wordShare(core) < 0.5;
  }
  return false;
}

const verdict = (kind, label) => ({ kind, label });

/**
 * classify(text) -> null | { kind: 'key'|'password'|'card'|'code'|'secret', label }
 * Pure: no side effects, safe to call on anything.
 */
export function classify(input) {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  const t = (raw.length > LIMITS.chars ? raw.slice(0, LIMITS.chars) : raw).trim();
  if (!t) return null;
  if (PEM_RE.test(t)) return verdict('key', 'Looks like a private key');
  if (TOKEN_RE.test(t) || HOOK_RE.test(t)) return verdict('key', 'Looks like an API key or token');
  if (JWT_RE.test(t)) return verdict('key', 'Looks like a login token');
  if (CRED_URL_RE.test(t)) return verdict('password', 'Has a password inside a link');
  const assigned = secretAssignment(t);
  if (assigned === 'key' || BEARER_RE.test(t)) return verdict('key', 'Contains an API key or secret');
  if (assigned === 'password' || PW_SENTENCE_RE.test(t)) return verdict('password', 'Contains a password');
  if (hasCardNumber(t)) return verdict('card', 'Looks like a card number');
  if (isOneTimeCode(t)) return verdict('code', 'Looks like a one-time code');
  /* one "word" of at most 512 characters: the only shapes the token/password tests look at */
  if (t.length <= 512 && !/\s/.test(t) && !NOT_SECRET.some(r => r.test(t)) && !looksLikePath(t)) {
    if (isRandomToken(t)) return verdict('key', 'Looks like an API key or token');
    if (isPasswordShaped(t)) return verdict('password', 'Looks like a password');
  }
  return null;
}

/* ==================================================================== */
/*  history                                                             */
/* ==================================================================== */
function cap(raw) {
  let text = raw;
  if (text.length > LIMITS.chars) {
    text = text.slice(0, LIMITS.chars);
    const c = text.charCodeAt(text.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) text = text.slice(0, -1);   // never end on half a surrogate pair
  }
  return { text, len: raw.length };
}
function cleanSource(s) {
  const v = String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 40);
  return v || 'StaticOS';
}
const snapshot = i => ({ ...i, sensitive: i.sensitive ? { ...i.sensitive } : null, image: i.image ? { ...i.image } : null });
const cleanName = n => String(n ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, LIMITS.name);
const imgKey = i => (i.image ? i.image.url : null);

function fromStore(o) {
  if (!o || typeof o !== 'object' || typeof o.text !== 'string' || !o.text.trim()) return null;
  const { text } = cap(o.text);
  let image = null;
  if (o.image && typeof o.image === 'object') {
    const u = o.image.url;
    if (typeof u !== 'string' || u.length > LIMITS.imageChars || !IMG_RE.test(u)) return null;   /* an image item with no usable picture is nothing */
    image = { url: u, w: Math.max(1, Math.floor(Number(o.image.w)) || 1), h: Math.max(1, Math.floor(Number(o.image.h)) || 1) };
  }
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 80) : uid(),
    text,
    len: Math.max(text.length, Math.floor(Number(o.len)) || 0),
    source: cleanSource(o.source),
    via: VIA.has(o.via) ? o.via : 'copy',
    at: Number(o.at) > 0 ? Number(o.at) : 0,   // 0 = unknown; the app then shows no time rather than a made-up one
    pinned: !!o.pinned && !image,
    name: o.pinned && !image ? cleanName(o.name) : '',
    image,
    sensitive: null,
    expires: 0,
  };
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const raw = store.get(KEY);
  const arr = raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw.items : [];
  const seenId = new Set(), seenText = new Set();
  let scrub = false;
  const out = [];
  for (const o of arr.map(fromStore).sort((a, b) => ((b && b.at) || 0) - ((a && a.at) || 0))) {
    if (!o) { scrub = true; continue; }
    /* never keep something that reads as sensitive, whoever wrote it */
    if (!o.image && classify(o.text)) { scrub = true; continue; }
    const dupKey = o.image ? `img:${o.image.url}` : o.text;
    if (seenText.has(dupKey)) { scrub = true; continue; }
    if (seenId.has(o.id)) o.id = uid();
    seenId.add(o.id); seenText.add(dupKey);
    out.push(o);
  }
  /* more pinned than the cap (hand-edited storage): the oldest extras fall back to recent */
  let pins = 0;
  for (const o of out) if (o.pinned && ++pins > LIMITS.pinned) { o.pinned = false; scrub = true; }
  items = out;
  trim();
  if (scrub || items.length !== arr.length) persist();
  else lastSig = JSON.stringify(savedShape());
}

/** the saved "unpinned items expire" setting, in ms (0 = never) */
function expiryMs() {
  const raw = store.get(KEY);
  const id = raw && typeof raw === 'object' ? raw.expire : null;
  const e = EXPIRIES.find(x => x.id === id);
  return e ? e.ms : 0;
}

function trim() {
  const now = Date.now();
  const life = expiryMs();
  let recent = 0, secret = 0, pics = 0;
  items = items.filter(i => {
    if (i.sensitive) return i.expires > now && ++secret <= LIMITS.sensitive;
    if (i.pinned) return true;             // the pinned cap is enforced by pin()
    if (life && i.at && now - i.at > life) return false;   // past its time (an unknown time, at 0, is never guessed at)
    if (i.image && ++pics > LIMITS.images) return false;
    return ++recent <= LIMITS.recent;
  });
}

function savedShape() {
  return items.filter(i => !i.sensitive).map(i => ({
    id: i.id, text: i.text, len: i.len, source: i.source, via: i.via, at: i.at, pinned: i.pinned,
    ...(i.name ? { name: i.name } : null), ...(i.image ? { image: i.image } : null),
  }));
}

function persist() {
  const keep = savedShape();
  const sig = JSON.stringify(keep);
  if (sig === lastSig) return;
  lastSig = sig;
  const cur = store.get(KEY);
  const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
  store.set(KEY, { ...base, v: 1, items: keep });   // a NEW object: store.set no-ops on the same reference
}

function schedule() {
  clearTimeout(sweepTimer);
  sweepTimer = 0;
  let next = Infinity;
  for (const i of items) if (i.sensitive && i.expires < next) next = i.expires;
  if (next === Infinity) return;
  sweepTimer = setTimeout(sweep, Math.max(0, next - Date.now()) + 40);
}

function sweep() {
  sweepTimer = 0;
  const now = Date.now();
  const before = items.length;
  items = items.filter(i => !i.sensitive || i.expires > now);
  const sensitiveGone = items.length !== before;
  /* unpinned items past their time; this also saves, because they were saved */
  const kept = items.length;
  trim();
  if (items.length !== kept) { persist(); emit(); }
  else if (sensitiveGone) emit();
  schedule();
}

function emit() {
  const snap = list();
  for (const fn of [...subs]) {
    try { fn(snap); } catch (e) { console.error('[clipboard]', e); }
  }
  bus.emit('clipboard:change', { count: snap.length });
}

function commit() {
  trim();
  persist();
  schedule();
  emit();
}

/* `generic`: the caller can't say where the text came from (the writeText
   wrapper). Copying an item that is already here — the Clipboard app's own
   Copy, Spotlight's — must then keep the source it was first recorded with,
   or every copy-back would relabel it "StaticOS". */
function record(input, source, via, forceSensitive, generic = false) {
  ensureLoaded();
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const raw = String(input);
  if (!raw.trim()) return null;
  const now = Date.now();
  const { text, len } = cap(raw);
  const src = cleanSource(source);
  const how = VIA.has(via) ? via : 'app';
  let v = classify(text);
  if (!v && forceSensitive) v = verdict('secret', `Marked sensitive by ${src}`);

  const found = items.find(i => !i.image && i.text === text);
  let it;
  if (found) {
    items = items.filter(i => i !== found);
    it = generic ? { ...found, at: now, len } : { ...found, source: src, via: how, at: now, len };
  } else {
    it = { id: uid(), text, len, source: src, via: how, at: now, pinned: false, name: '', image: null, sensitive: null, expires: 0 };
  }
  if (v || it.sensitive) {
    it.sensitive = v || it.sensitive;      // never downgraded
    it.pinned = false;
    it.name = '';
    it.expires = now + LIMITS.ttl;         // a fresh capture starts a fresh 2 minutes
  }
  items.unshift(it);
  commit();
  const kept = items.find(i => i.id === it.id);
  return kept ? snapshot(kept) : null;
}

/* ---------------- capture: copy / cut inside StaticOS ---------------- */
function elementOf(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  return node.parentElement || null;
}
function deepActive() {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}
/** the selected text; null means "never record this" (a password field) */
function readSelection() {
  const ae = deepActive();
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
    if (ae.tagName === 'INPUT' && String(ae.type).toLowerCase() === 'password') return null;
    try {
      const s = ae.selectionStart, e = ae.selectionEnd;
      if (typeof s === 'number' && typeof e === 'number') return e > s ? String(ae.value).slice(s, e) : '';
    } catch (err) { /* email/number inputs have no selection API — fall through */ }
  }
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return sel ? String(sel.toString()) : '';
}
function sourceOf(el) {
  const w = el && el.closest ? el.closest('.win[data-app]') : null;
  if (!w) return 'StaticOS';
  const id = w.getAttribute('data-app') || '';
  const app = id ? getApp(id) : null;
  return (app && app.name) || id || 'StaticOS';
}

function onCaptureStart(e) {
  const job = { e, via: e.type, text: '', source: 'StaticOS', skip: false, done: false, custom: null };
  try {
    const el = elementOf(e.target) || deepActive();
    if (el && el.closest && el.closest('[data-clip-ignore]')) job.skip = true;
    else {
      const sel = readSelection();
      if (sel === null) job.skip = true;
      else job.text = sel;
      job.source = sourceOf(el && el !== document.body ? el : deepActive());
    }
  } catch (err) { job.skip = true; }
  pending = job;
  /* runs after the whole dispatch, in case an app stopped propagation */
  setTimeout(() => finish(job), 0);
}
function onCaptureEnd(e) {
  const job = pending;
  if (!job || job.e !== e) return;
  if (e.defaultPrevented) {
    /* an app's own handler decided what goes on the clipboard — that is what was copied */
    try { job.custom = e.clipboardData ? e.clipboardData.getData('text/plain') : ''; } catch (err) { job.custom = ''; }
  }
  finish(job);
}
function finish(job) {
  if (job.done) return;
  job.done = true;
  if (pending === job) pending = null;
  if (job.skip) return;
  const text = job.e.defaultPrevented ? (job.custom || '') : job.text;
  /* the text is already read; classify and store after the copy itself has happened */
  if (text && text.trim()) setTimeout(() => record(text, job.source, job.via), 0);
}

function onBusAdd(p) {
  if (p === null || p === undefined) return;
  if (typeof p === 'string') { record(p, 'StaticOS', 'app'); return; }
  if (typeof p !== 'object') return;
  if (p.image && typeof p.text !== 'string') { addImage(p.image, p.source || 'StaticOS').catch(() => {}); return; }
  record(p.text, p.source, 'app', p.sensitive === true);
}
function purgeSensitive() {
  ensureLoaded();
  const before = items.length;
  items = items.filter(i => !i.sensitive);
  if (items.length !== before) commit();
}
function onVisible() { if (document.visibilityState === 'visible') { sweep(); expireOld(); } }
/** unpinned items past the "expire" setting go, and the change is saved */
function expireOld() {
  ensureLoaded();
  const n = items.length;
  trim();
  if (items.length !== n) { persist(); emit(); }
}

/* ==================================================================== */
/*  public API                                                          */
/* ==================================================================== */

/** Start capturing. Safe to call more than once; the lead calls it at boot. */
export function init() {
  if (started) return true;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  started = true;
  ensureLoaded();
  window.addEventListener('copy', onCaptureStart, true);
  window.addEventListener('cut', onCaptureStart, true);
  window.addEventListener('copy', onCaptureEnd);
  window.addEventListener('cut', onCaptureEnd);
  document.addEventListener('visibilitychange', onVisible);
  bus.on('clipboard:add', onBusAdd);
  bus.on('power:lock', purgeSensitive);
  watchWriteText();
  watchWrite();
  schedule();
  setInterval(expireOld, 30_000);
  return true;
}

/* Most Copy buttons in StaticOS call navigator.clipboard.writeText()
   directly, which fires no 'copy' event — so the history stayed empty for
   exactly the copies people make most. The bus contract above has no
   producers either. Rather than touch two dozen call sites (and miss every
   future one), wrap writeText once: anything this page copies is recorded,
   with the same sensitive-data rules as every other path.

   Only our own page is affected, the original is always called, its result
   is passed through untouched, and a failed write records nothing. */
function watchWriteText() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const cb = nav && nav.clipboard;
  if (!cb || typeof cb.writeText !== 'function' || cb.writeText.__staticWrapped) return;
  const original = cb.writeText.bind(cb);
  const wrapped = function writeText(text) {
    let p;
    try { p = original(text); } catch (err) { return Promise.reject(err); }
    return Promise.resolve(p).then(v => {
      try { record(String(text ?? ''), 'StaticOS', 'app', false, true); } catch (e) { /* never break a copy */ }
      return v;
    });
  };
  wrapped.__staticWrapped = true;
  try { cb.writeText = wrapped; } catch (e) { /* locked down: leave it alone */ }
}

/** Put text on the system clipboard WITHOUT recording it in the history. For
    secrets an app made itself (Dev Tools' password generator). It calls the
    browser's own writeText (the prototype's), not the recording wrapper above,
    so nothing is captured, classified or kept - not even in memory. The same
    permission rules apply as for any copy. */
export function writeUnrecorded(text) {
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (!cb) return Promise.reject(new Error('No clipboard here.'));
  const native = Object.getPrototypeOf(cb)?.writeText || cb.writeText;
  try { return Promise.resolve(native.call(cb, String(text ?? ''))); } catch (err) { return Promise.reject(err); }
}


/* ==================================================================== */
/*  quick transforms, counts, combining                                 */
/* ==================================================================== */
export const TRANSFORMS = Object.freeze([
  { id: 'upper', label: 'UPPERCASE' },
  { id: 'lower', label: 'lowercase' },
  { id: 'title', label: 'Title Case' },
  { id: 'trim', label: 'Trim spaces' },
]);

/** transform(text, 'upper'|'lower'|'title'|'trim') -> the new text; an unknown id returns the text as it was */
export function transform(text, id) {
  const t = String(text ?? '');
  switch (id) {
    case 'upper': return t.toUpperCase();
    case 'lower': return t.toLowerCase();
    case 'title': return t.toLowerCase().replace(/(^|[\s\-–—(["“/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    case 'trim': return t.split('\n').map(l => l.replace(/[ \t\r]+$/, '')).join('\n').trim();
    default: return t;
  }
}

/** countOf(text) -> { chars, words, lines } — characters are what a person sees (an emoji is one) */
export function countOf(text) {
  const t = String(text ?? '');
  const trimmed = t.trim();
  return {
    chars: [...t].length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    lines: t ? t.split('\n').length : 0,
  };
}

/** combine(ids, sep?) -> { ok, item?, used, skipped, cut } — joins the text of the listed items, in the order
    given, into one new item. Sensitive items and pictures are never joined (skipped counts them). */
export function combine(ids, sep = '\n') {
  ensureLoaded();
  const parts = [];
  let skipped = 0;
  for (const id of Array.isArray(ids) ? ids : []) {
    const it = items.find(i => i.id === id);
    if (!it || it.sensitive || it.image) { skipped++; continue; }
    parts.push(it.text);
  }
  if (parts.length < 2) return { ok: false, used: parts.length, skipped, cut: false };
  const joined = parts.join(typeof sep === 'string' ? sep : '\n');
  const item = record(joined, 'Combined clips', 'app');
  return { ok: !!item, item, used: parts.length, skipped, cut: !!item && item.len > item.text.length };
}

/* ==================================================================== */
/*  snippets                                                            */
/* ==================================================================== */
/** name(id, text) -> { ok, reason? } — names an item, pinning it first; '' removes the name (it stays pinned).
    reason: 'gone' | 'sensitive' | 'image' | 'full' */
export function name(id, text) {
  ensureLoaded();
  const it = items.find(i => i.id === id);
  if (!it) return { ok: false, reason: 'gone' };
  const r = pin(id);
  if (!r.ok) return r;
  const nm = cleanName(text);
  items = items.map(i => (i.id === id ? { ...i, name: nm } : i));
  commit();
  return { ok: true };
}

/** addSnippet(name, text) -> { ok, item?, reason? } — a new pinned, named item. Sensitive text is refused. */
export function addSnippet(nm, text) {
  ensureLoaded();
  const raw = String(text ?? '');
  if (!raw.trim()) return { ok: false, reason: 'empty' };
  if (classify(raw.length > LIMITS.chars ? raw.slice(0, LIMITS.chars) : raw)) return { ok: false, reason: 'sensitive' };
  const made = record(raw, 'Snippet', 'app');
  if (!made) return { ok: false, reason: 'empty' };
  const r = name(made.id, nm || 'Snippet');
  return r.ok ? { ok: true, item: items.map(snapshot).find(i => i.id === made.id) } : r;
}

/* ==================================================================== */
/*  expiry                                                              */
/* ==================================================================== */
export function expiry() {
  const raw = store.get(KEY);
  const id = raw && typeof raw === 'object' ? raw.expire : null;
  return EXPIRIES.some(x => x.id === id) ? id : 'never';
}
/** setExpiry('never'|'hour'|'day'|'week') -> the id now in force; items already older than that go at once */
export function setExpiry(id) {
  if (!EXPIRIES.some(x => x.id === id)) return expiry();
  ensureLoaded();
  const cur = store.get(KEY);
  const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
  store.set(KEY, { ...base, expire: id });
  expireOld();
  return id;
}

/* ==================================================================== */
/*  pictures                                                            */
/* ==================================================================== */
async function decodeImage(src) {
  if (typeof src === 'string') {
    if (!/^data:image\//.test(src)) throw new Error('not a picture');
    const img = new Image();
    img.src = src;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
  }
  if (typeof Blob === 'undefined' || !(src instanceof Blob) || !/^image\//.test(src.type)) throw new Error('not a picture');
  if (typeof createImageBitmap === 'function') {
    const bm = await createImageBitmap(src);
    return { src: bm, w: bm.width, h: bm.height, close() { try { bm.close(); } catch (e) { /* gone */ } } };
  }
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
  } finally { URL.revokeObjectURL(url); }
}

/** addImage(blobOrDataUrl, source?) -> the stored item, or null when it isn't a picture or can't be kept small enough */
export async function addImage(src, source) {
  ensureLoaded();
  let d;
  try { d = await decodeImage(src); } catch (e) { return null; }
  try {
    if (!d.w || !d.h) return null;
    let side = Math.min(LIMITS.imageSide, Math.max(d.w, d.h));
    for (let tries = 0; tries < 4; tries++, side = Math.round(side * 0.75)) {
      const k = side / Math.max(d.w, d.h);
      const w = Math.max(1, Math.round(d.w * k)), h = Math.max(1, Math.round(d.h * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(d.src, 0, 0, w, h);
      for (const q of [0.82, 0.6]) {
        let url = c.toDataURL('image/webp', q);
        if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
        if (url.length > LIMITS.imageChars || !IMG_RE.test(url)) continue;
        return keepImage({ url, w, h }, d.w, d.h, source);
      }
    }
    return null;
  } finally { d.close(); }
}
function keepImage(image, ow, oh, source) {
  const now = Date.now();
  const same = items.find(i => i.image && i.image.url === image.url);
  const it = same
    ? { ...same, at: now }
    : { id: uid(), text: `Picture ${ow}×${oh}`, len: 0, source: cleanSource(source), via: 'app', at: now, pinned: false, name: '', image, sensitive: null, expires: 0 };
  it.len = it.text.length;
  items = [it, ...items.filter(i => i !== same)];
  commit();
  const kept = items.find(i => i.id === it.id);
  return kept ? snapshot(kept) : null;
}

/* navigator.clipboard.write() with a picture in it: StaticOS's own copy
   paths (QR's Copy image, Paint's Copy picture). Like writeText it is
   wrapped once; the original always runs, and a failed write records nothing. */
function watchWrite() {
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (!cb || typeof cb.write !== 'function' || cb.write.__staticWrapped) return;
  const original = cb.write.bind(cb);
  const wrapped = function write(data) {
    let p;
    try { p = original(data); } catch (err) { return Promise.reject(err); }
    return Promise.resolve(p).then(v => {
      (async () => {
        for (const ci of Array.isArray(data) ? data : []) {
          const type = ci && Array.isArray(ci.types) ? ci.types.find(t => /^image\//.test(t)) : null;
          if (!type) continue;
          const blob = await ci.getType(type);
          await addImage(blob, 'StaticOS');
        }
      })().catch(() => { /* never break a copy */ });
      return v;
    });
  };
  wrapped.__staticWrapped = true;
  try { cb.write = wrapped; } catch (e) { /* locked down: leave it alone */ }
}

/** Put a picture on the system clipboard WITHOUT recording it again (the app's Copy on a picture clip). */
export function writeImageUnrecorded(blob) {
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (!cb || typeof ClipboardItem !== 'function') return Promise.reject(new Error('This browser doesn’t let pages copy pictures.'));
  const native = Object.getPrototypeOf(cb)?.write || cb.write;
  try { return Promise.resolve(native.call(cb, [new ClipboardItem({ [blob.type]: blob })])); } catch (err) { return Promise.reject(err); }
}

/* ==================================================================== */
/*  export — never the hidden ones                                      */
/* ==================================================================== */
/** exportItems() -> [{ text, source, at, pinned, name?, image? }], newest first. Sensitive items are not in it,
    and neither is anything classify() flags (a belt and braces check on every item, whoever wrote it). */
export function exportItems() {
  ensureLoaded();
  return items
    .filter(i => !i.sensitive && (i.image || !classify(i.text)))
    .map(i => ({
      text: i.image ? '' : i.text, source: i.source, at: i.at || null, pinned: !!i.pinned,
      ...(i.name ? { name: i.name } : null), ...(i.image ? { image: i.image.url, imageSize: `${i.image.w}x${i.image.h}` } : null),
    }));
}
export function exportJSON() {
  return JSON.stringify({ app: 'Static Clipboard', exported: new Date().toISOString(), note: 'Sensitive items are never included.', items: exportItems() }, null, 2);
}
export function exportText() {
  const out = [];
  for (const i of exportItems()) {
    if (i.image) continue;
    const when = i.at ? new Date(i.at).toLocaleString() : 'time unknown';
    out.push(`--- ${i.name ? `${i.name} · ` : ''}${i.source} · ${when}${i.pinned ? ' · pinned' : ''}\n${i.text}`);
  }
  return out.join('\n\n') + (out.length ? '\n' : '');
}

/** Newest first. Copies — changing them changes nothing here. */
export function list() {
  ensureLoaded();
  const now = Date.now();
  return items.filter(i => !i.sensitive || i.expires > now).map(snapshot);
}

/* ---------------- search ---------------- */
/**
 * The words of a search, lower-cased. "double quotes" keep a phrase
 * together; every word or phrase has to match for an item to show.
 */
export function searchTerms(q) {
  const out = [];
  const s = String(q ?? '').toLowerCase().slice(0, 200);
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    const t = (m[1] !== undefined ? m[1] : m[2]).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Does an item match every term? A sensitive item's text is never searched —
    only where it came from and what kind of secret it looks like. */
export function matchesItem(it, terms) {
  if (!it || !terms || !terms.length) return true;
  const hay = it.sensitive
    ? `${it.source}\n${it.sensitive.label}\nsensitive`.toLowerCase()
    : `${it.text}\n${it.source}\n${it.name || ''}${it.image ? '\npicture image' : ''}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}

/**
 * search(q, { limit, includeSensitive }) -> matching items, pinned first,
 * then newest first. Sensitive items are left out unless asked for, and so
 * are pictures unless opts.images (Spotlight's rows copy text, and a picture has none).
 */
export function search(q, opts = {}) {
  const terms = searchTerms(q);
  const o = opts && typeof opts === 'object' ? opts : {};
  const out = list()
    .filter(i => (o.includeSensitive || !i.sensitive) && (o.images || !i.image) && matchesItem(i, terms))
    .sort((a, b) => (b.pinned - a.pinned) || ((b.at || 0) - (a.at || 0)));
  const n = Math.floor(Number(o.limit));
  return n > 0 ? out.slice(0, n) : out;
}

/** add(text, source?, { via: 'paste'|'app', sensitive: true }?) -> the stored item, or null if empty */
export function add(text, source, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return record(text, source || 'StaticOS', VIA.has(o.via) ? o.via : 'app', o.sensitive === true);
}

/** -> { ok, reason? }  reason: 'gone' | 'sensitive' | 'image' | 'full' */
export function pin(id) {
  ensureLoaded();
  const it = items.find(i => i.id === id);
  if (!it) return { ok: false, reason: 'gone' };
  if (it.sensitive) return { ok: false, reason: 'sensitive' };
  if (it.image) return { ok: false, reason: 'image' };
  if (it.pinned) return { ok: true };
  if (items.filter(i => i.pinned).length >= LIMITS.pinned) return { ok: false, reason: 'full' };
  items = items.map(i => (i === it ? { ...i, pinned: true } : i));
  commit();
  return { ok: true };
}

/** -> { ok, removed } — removed is true when the item was older than the 30 most recent */
export function unpin(id) {
  ensureLoaded();
  const it = items.find(i => i.id === id);
  if (!it) return { ok: false, reason: 'gone', removed: false };
  if (!it.pinned) return { ok: true, removed: false };
  items = items.map(i => (i === it ? { ...i, pinned: false, name: '' } : i));
  commit();
  return { ok: true, removed: !items.some(i => i.id === id) };
}

/** Would unpinning drop this item (30 newer unpinned items already)? */
export function wouldDropOnUnpin(id) {
  ensureLoaded();
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0 || !items[idx].pinned) return false;
  let newer = 0;
  for (let k = 0; k < idx; k++) if (!items[k].pinned && !items[k].sensitive) newer++;
  return newer >= LIMITS.recent;
}

export function remove(id) {
  ensureLoaded();
  const before = items.length;
  items = items.filter(i => i.id !== id);
  if (items.length === before) return false;
  commit();
  return true;
}

/** clear() empties everything; clear({ keepPinned: true }) keeps pinned items. -> how many went */
export function clear(opts = {}) {
  ensureLoaded();
  const before = items.length;
  items = opts && opts.keepPinned ? items.filter(i => i.pinned) : [];
  const gone = before - items.length;
  commit();
  return gone;
}

/** An item was copied back to the clipboard: it is now the newest. Sensitive expiry is NOT extended. */
export function bump(id) {
  ensureLoaded();
  const it = items.find(i => i.id === id);
  if (!it) return null;
  const moved = { ...it, at: Date.now() };
  items = [moved, ...items.filter(i => i !== it)];
  commit();
  return snapshot(moved);
}

/** onChange(fn(list)) -> unsubscribe */
export function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Diagnostics: how much is held and how many views are listening (tests use this to prove teardown). */
export function stats() {
  ensureLoaded();
  return {
    items: items.length,
    sensitive: items.filter(i => i.sensitive).length,
    pinned: items.filter(i => i.pinned).length,
    subscribers: subs.size,
    started,
  };
}

/** What this browser allows, measured rather than assumed. */
export function status() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const cb = nav && nav.clipboard;
  return {
    started,
    canRead: !!(cb && typeof cb.readText === 'function'),
    canWrite: !!(cb && typeof cb.writeText === 'function'),
    secure: typeof isSecureContext === 'boolean' ? isSecureContext : true,
  };
}

export default { init, list, add, pin, unpin, remove, clear, onChange, bump, wouldDropOnUnpin, classify, status, stats, search, searchTerms, matchesItem, transform, countOf, combine, name, addSnippet, expiry, setExpiry, addImage, writeImageUnrecorded, exportItems, exportJSON, exportText, TRANSFORMS, EXPIRIES, LIMITS, KEY };
