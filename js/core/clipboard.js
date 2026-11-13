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

   API: init() list() add(text, source, opts?) pin(id) unpin(id)
   remove(id) clear(opts?) onChange(fn) — plus bump(id) (an item
   was copied back), wouldDropOnUnpin(id), classify(text),
   search(q, opts?) / searchTerms(q) / matchesItem(item, terms)
   (every word must match; pinned first), status() (what this
   browser allows), stats() (diagnostics) and LIMITS. Emits bus
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
});
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
const snapshot = i => ({ ...i, sensitive: i.sensitive ? { ...i.sensitive } : null });

function fromStore(o) {
  if (!o || typeof o !== 'object' || typeof o.text !== 'string' || !o.text.trim()) return null;
  const { text } = cap(o.text);
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 80) : uid(),
    text,
    len: Math.max(text.length, Math.floor(Number(o.len)) || 0),
    source: cleanSource(o.source),
    via: VIA.has(o.via) ? o.via : 'copy',
    at: Number(o.at) > 0 ? Number(o.at) : 0,   // 0 = unknown; the app then shows no time rather than a made-up one
    pinned: !!o.pinned,
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
    if (classify(o.text)) { scrub = true; continue; }
    if (seenText.has(o.text)) { scrub = true; continue; }
    if (seenId.has(o.id)) o.id = uid();
    seenId.add(o.id); seenText.add(o.text);
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

function trim() {
  const now = Date.now();
  let recent = 0, secret = 0;
  items = items.filter(i => {
    if (i.sensitive) return i.expires > now && ++secret <= LIMITS.sensitive;
    if (i.pinned) return true;             // the pinned cap is enforced by pin()
    return ++recent <= LIMITS.recent;
  });
}

function savedShape() {
  return items.filter(i => !i.sensitive).map(i => ({
    id: i.id, text: i.text, len: i.len, source: i.source, via: i.via, at: i.at, pinned: i.pinned,
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
  if (items.length !== before) emit();
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

  const found = items.find(i => i.text === text);
  let it;
  if (found) {
    items = items.filter(i => i !== found);
    it = generic ? { ...found, at: now, len } : { ...found, source: src, via: how, at: now, len };
  } else {
    it = { id: uid(), text, len, source: src, via: how, at: now, pinned: false, sensitive: null, expires: 0 };
  }
  if (v || it.sensitive) {
    it.sensitive = v || it.sensitive;      // never downgraded
    it.pinned = false;
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
  record(p.text, p.source, 'app', p.sensitive === true);
}
function purgeSensitive() {
  ensureLoaded();
  const before = items.length;
  items = items.filter(i => !i.sensitive);
  if (items.length !== before) commit();
}
function onVisible() { if (document.visibilityState === 'visible') sweep(); }

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
  schedule();
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
    : `${it.text}\n${it.source}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}

/**
 * search(q, { limit, includeSensitive }) -> matching items, pinned first,
 * then newest first. Sensitive items are left out unless asked for.
 */
export function search(q, opts = {}) {
  const terms = searchTerms(q);
  const o = opts && typeof opts === 'object' ? opts : {};
  const out = list()
    .filter(i => (o.includeSensitive || !i.sensitive) && matchesItem(i, terms))
    .sort((a, b) => (b.pinned - a.pinned) || ((b.at || 0) - (a.at || 0)));
  const n = Math.floor(Number(o.limit));
  return n > 0 ? out.slice(0, n) : out;
}

/** add(text, source?, { via: 'paste'|'app', sensitive: true }?) -> the stored item, or null if empty */
export function add(text, source, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return record(text, source || 'StaticOS', VIA.has(o.via) ? o.via : 'app', o.sensitive === true);
}

/** -> { ok, reason? }  reason: 'gone' | 'sensitive' | 'full' */
export function pin(id) {
  ensureLoaded();
  const it = items.find(i => i.id === id);
  if (!it) return { ok: false, reason: 'gone' };
  if (it.sensitive) return { ok: false, reason: 'sensitive' };
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
  items = items.map(i => (i === it ? { ...i, pinned: false } : i));
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

export default { init, list, add, pin, unpin, remove, clear, onChange, bump, wouldDropOnUnpin, classify, status, stats, search, searchTerms, matchesItem, LIMITS, KEY };
