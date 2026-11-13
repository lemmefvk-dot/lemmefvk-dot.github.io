/* ============================================================
   profiles.js — several people on one computer.

   Each person (a profile) has their own settings, files, screen
   time, focus log and saved projects. Everything StaticOS saves asks
   this module what to call it, so keeping people apart is one rule
   in one place:

     The first profile is the data that was here before profiles
     existed, and every name it uses stays exactly as it was:
         localStorage  staticos.state.v3 · staticos.vfs.v1 ·
                       staticos.screentime.v1 · staticos.focus.v1
         IndexedDB     staticos · staticos-classics (Old Games' saves)
     Every other profile adds ::<id> to the same names:
         localStorage  staticos.state.v3::p1a2b3c4d, …
         IndexedDB     staticos::p1a2b3c4d, staticos-classics::p1a2b3c4d
     A guest keeps …::guest in sessionStorage and IndexedDB in memory,
     so nothing of theirs is left once they sign out or close the tab.

   Nothing moves on upgrade. With one profile there is no list of
   people and no login screen; the data is read from where it was.

   Shared on purpose, one per browser: the list of people itself
   (staticos.profiles.v1), the offline copy and service worker, the
   build version, the last developer broadcast (staticos.bc.cache),
   things that can always be fetched or worked out again and are nobody's
   own (the pixel icons in staticos.pixicons.v1; in Cache Storage, Old
   Games' downloaded game files and the word list) and the proxy's own
   storage for the sites it opens (its cookie database __op, and each
   site's localStorage and IndexedDB under <origin>@…): a sign-in made
   through the proxy is there for everyone in this browser.

   Which person a tab belongs to is kept in that tab's sessionStorage
   (staticos.profile): a reload stays signed in, a new tab asks again
   when there is more than one person or the only one has a PIN.

   Honest limits: a PIN or password here is a front-end lock. It keeps
   people out of each other's desktops in StaticOS; it does not keep
   anyone with the browser's developer tools from reading the data.

     MODE            'single' | 'profile' | 'guest' | 'login'
     ID              this tab's profile id ('default', 'p…', 'guest';
                     null at the login screen)
     key(base)       the name this profile saves `base` under
     idbName(base?)  its IndexedDB name, or null: keep it in memory
     local           the Storage those keys live in
     list() · current() · displayName() · keysOf(id) · foreign(key)
     create · rename · setPicture · setSecret · verify · remove
     switchTo · signOut · startGuest · backupKeys · importKey
   ============================================================ */

export const REGISTRY = 'staticos.profiles.v1';   /* localStorage, shared */
export const SESSION = 'staticos.profile';        /* sessionStorage, this tab */
export const DEFAULT = 'default';
export const GUEST = 'guest';
/* every localStorage key that holds one person's data */
export const BASES = ['staticos.state.v3', 'staticos.vfs.v1', 'staticos.screentime.v1', 'staticos.focus.v1'];
export const DB_BASE = 'staticos';
/* every IndexedDB database that holds one person's data (idbName names them) */
export const DB_BASES = [DB_BASE, 'staticos-classics'];
/* localStorage keys nobody owns: never in a backup, and every person may see the name */
const CACHE_KEYS = ['staticos.bc.cache', 'staticos.pixicons.v1'];
export const MAX = 8;
const SEP = '::';
const ID_RE = /^p[a-z0-9]{8}$/;
/* a key that belongs to one person. Only these exact endings count: a site
   opened through the proxy keeps its localStorage here under names of its
   own, and "foo::bar" is a perfectly good name for it to pick. */
const OWNED = /::(p[a-z0-9]{8}|guest|login)$/;
const NAME_MAX = 24;
const ITER = 200000;
const RESTART = 'aether.restarting';               /* js/shell/boot.js: the short splash */

/* ---------- storage that may not be there ----------------------------- */
function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(String(k)); },
    clear: () => m.clear(),
  };
}
/* a sandboxed frame or blocked site data throws on the getter itself */
const grab = name => { try { const s = globalThis[name]; return s && typeof s.getItem === 'function' ? s : null; } catch (e) { return null; } };
const LS = grab('localStorage') || memoryStorage();
const SS = grab('sessionStorage') || memoryStorage();
const keysIn = S => { const out = []; try { for (let i = 0; i < S.length; i++) { const k = S.key(i); if (k !== null) out.push(k); } } catch (e) { /* unreadable */ } return out; };

/* ---------- the list of people ---------------------------------------- */
export const tidy = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
function normPic(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'builtin' && /^[a-z0-9-]{1,24}$/.test(v.id)) return { kind: 'builtin', id: v.id };
  if (v.kind === 'upload' && typeof v.dataUrl === 'string' && v.dataUrl.length <= 140000
      && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v.dataUrl)) return { kind: 'upload', dataUrl: v.dataUrl };
  return null;
}
function normLock(v) {
  if (!v || typeof v !== 'object') return null;
  return /^[0-9a-f]{32}$/.test(v.salt) && /^[0-9a-f]{64}$/.test(v.hash) && Number.isInteger(v.iter) && v.iter >= 1000 && v.iter <= 5e6
    ? { salt: v.salt, hash: v.hash, iter: v.iter } : null;
}
function normEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const id = e.id === DEFAULT || ID_RE.test(e.id) ? e.id : null;
  if (!id) return null;
  return { id, name: tidy(e.name) || 'User', pic: normPic(e.pic), lock: normLock(e.lock), created: typeof e.created === 'string' ? e.created.slice(0, 40) : '' };
}
/* An unreadable list (edited by hand) must not orphan anyone: rebuild it
   from the data that is there. It is not written back until something changes. */
function recoverFromKeys() {
  const out = [{ id: DEFAULT, name: 'User 1', pic: null, lock: null, created: '' }];
  for (const k of keysIn(LS)) {
    const m = /^staticos\.state\.v3::(p[a-z0-9]{8})$/.exec(k);
    if (m && out.length < MAX) out.push({ id: m[1], name: `User ${out.length + 1}`, pic: null, lock: null, created: '' });
  }
  return out;
}
function readRegistry() {
  let raw = null;
  try { raw = LS.getItem(REGISTRY); } catch (e) { return null; }
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    if (v && Array.isArray(v.profiles)) {
      const seen = new Set();
      return { profiles: v.profiles.map(normEntry).filter(p => p && !seen.has(p.id) && seen.add(p.id)) };
    }
  } catch (e) { /* unreadable: rebuilt below */ }
  return { profiles: recoverFromKeys(), recovered: true };
}
let cache;
const reg = () => (cache === undefined ? (cache = readRegistry()) : cache);
function writeRegistry(profiles) {
  LS.setItem(REGISTRY, JSON.stringify({ v: 1, profiles }));
  cache = undefined;
  /* this tab stays who it is: a reload must not stop at a login screen
     that did not exist when it was opened */
  if ((MODE === 'single' || MODE === 'profile') && !readSession()) {
    try { SS.setItem(SESSION, JSON.stringify({ id: ID })); } catch (e) { /* asks on reload */ }
  }
}

/* ---------- who this tab is ------------------------------------------- */
function readSession() {
  try { const v = JSON.parse(SS.getItem(SESSION) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}
function resolve() {
  const sess = readSession();
  if (sess && sess.guest === true) return ['guest', GUEST];
  const r = reg();
  if (!r || !r.profiles.length) return ['single', DEFAULT];
  if (sess && r.profiles.some(p => p.id === sess.id)) return ['profile', sess.id];
  if (r.profiles.length === 1 && !r.profiles[0].lock) return ['profile', r.profiles[0].id];
  return ['login', null];
}
const resolved = resolve();
export const MODE = resolved[0];
export const ID = resolved[1];

const suffixOf = id => (id === DEFAULT ? '' : SEP + id);
const SUFFIX = MODE === 'login' ? SEP + 'login' : suffixOf(ID);
/** The name this profile keeps `base` under. */
export const key = base => base + SUFFIX;
/** This profile's IndexedDB name; null means keep it in memory (guest, login screen). */
export const idbName = (base = DB_BASE) => (MODE === 'guest' || MODE === 'login' ? null : base + SUFFIX);
const idbsOf = id => DB_BASES.map(b => b + suffixOf(id));

/* Writes stop once this profile is deleted (in another tab), a guest signs
   out, or the recovery screen in index.html resets it, so a save on the way
   out cannot bring the data back. */
let dead = false;
const backing = MODE === 'guest' ? SS : MODE === 'login' ? memoryStorage() : LS;
export const stopped = () => dead || !!globalThis.__staticBoot?.frozen;
export const local = {
  getItem: k => backing.getItem(k),
  setItem: (k, v) => { if (!stopped()) backing.setItem(k, v); },
  removeItem: k => { if (!stopped()) backing.removeItem(k); },
};
/** This page saves nothing more (a restore is about to reload it). */
export function freeze() { dead = true; }

/* ---------- reading ---------------------------------------------------- */
const pub = p => ({ id: p.id, name: p.name, pic: p.pic, locked: !!p.lock, created: p.created, current: p.id === ID });
/** Everyone on this computer (empty for a guest, who may not see them). */
export const list = () => (MODE === 'guest' ? [] : (reg()?.profiles || []).map(pub));
/** Everyone, for the login screen — names and pictures only. */
export const people = () => (reg()?.profiles || []).map(pub);
export function current() {
  if (MODE === 'guest') return { id: GUEST, name: 'Guest', pic: null, locked: false, guest: true, current: true };
  const p = reg()?.profiles.find(x => x.id === ID);
  return p ? pub(p) : null;
}
/** The name live features use: the profile's, once there is more than one person. */
export const displayName = () => (MODE === 'guest' ? 'Guest' : (MODE === 'login' ? null : current()?.name || null));
/** Will a new tab stop at the login screen? */
export function asksAtStart() {
  const r = reg();
  return !!r && (r.profiles.length > 1 || r.profiles.some(p => p.lock));
}

/** localStorage keys holding profile `id`'s data — and nobody else's. */
export function keysOf(id) {
  if (id !== DEFAULT && !ID_RE.test(id)) return [];
  return keysIn(LS).filter(k => (id === DEFAULT ? BASES.includes(k) : k.endsWith(SEP + id)));
}
/** Should a list of storage keys or databases keep this name from this person?
    Another profile's, always. The plain names belong to the first profile or
    are the proxy's (they name the sites people visited), so only the first
    profile sees those, as it always has. Hiding a name never touches the data. */
export function foreign(k) {
  const s = String(k);
  if (OWNED.test(s)) return s.slice(s.lastIndexOf(SEP) + SEP.length) !== ID || MODE === 'guest';
  return ID !== DEFAULT && s !== REGISTRY && !CACHE_KEYS.includes(s);
}

/* ---------- locks ------------------------------------------------------ */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array(s.match(/../g).map(x => parseInt(x, 16)));
async function derive(secret, saltHex, iter) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser can only check a PIN on a secure (https) page.');
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iter }, k, 256));
}
const same = (a, b) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
export function checkSecret(s) {
  const v = String(s ?? '');
  if (v.length < 4) return 'Use at least 4 characters (or digits) for a PIN or password.';
  if (v.length > 64) return 'That is longer than 64 characters.';
  return '';
}
async function makeLock(secret) {
  const why = checkSecret(secret);
  if (why) throw new Error(why);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(String(secret), salt, ITER), iter: ITER };
}
/** true when `secret` opens profile `id` (always, when it has no lock). */
export async function verify(id, secret) {
  const p = reg()?.profiles.find(x => x.id === id);
  if (!p) return false;
  if (!p.lock) return true;
  return same(await derive(String(secret ?? ''), p.lock.salt, p.lock.iter), p.lock.hash);
}

/* ---------- changing the list ----------------------------------------- */
const rand = n => { const a = crypto.getRandomValues(new Uint8Array(n)); return [...a].map(b => (b % 36).toString(36)).join(''); };
const signedIn = () => { if (MODE === 'guest' || MODE === 'login') throw new Error('Only someone signed in to their own profile can do that.'); };
/* The first time a second person is added, the data that was already here
   becomes the first profile — same keys, nothing copied or moved. */
function base(first = {}) {
  const r = readRegistry();
  if (r && r.profiles.length) return r.profiles;
  return [{ id: DEFAULT, name: tidy(first.name) || 'Me', pic: normPic(first.pic), lock: null, created: new Date().toISOString() }];
}
const nameTaken = (list, name, except) => list.some(p => p.id !== except && p.name.toLowerCase() === name.toLowerCase());

/** Add a person. first = { name, pic } names the profile already here, if this is the first time. */
export async function create({ name, pic = null, secret = '', first } = {}) {
  signedIn();
  const n = tidy(name);
  if (!n) throw new Error('Give the new user a name.');
  const lock = secret ? await makeLock(secret) : null;
  const list0 = base(first);
  if (nameTaken(list0, n)) throw new Error('Someone on this computer already has that name.');
  if (list0.length >= MAX) throw new Error(`There is room for ${MAX} people on this computer.`);
  let id;
  do { id = 'p' + rand(8); } while (list0.some(p => p.id === id) || keysOf(id).length);
  writeRegistry([...list0, { id, name: n, pic: normPic(pic), lock, created: new Date().toISOString() }]);
  return pub({ id, name: n, pic: normPic(pic), lock });
}
function edit(id, fn) {
  const list0 = readRegistry()?.profiles || [];
  const i = list0.findIndex(p => p.id === id);
  if (i < 0) throw new Error('That person is not on this computer any more.');
  const next = list0.slice();
  next[i] = fn({ ...list0[i] }, list0);
  writeRegistry(next);
  return pub(next[i]);
}
export function rename(id, name) {
  signedIn();
  const n = tidy(name);
  if (!n) throw new Error('A name can’t be empty.');
  return edit(id, (p, all) => { if (nameTaken(all, n, id)) throw new Error('Someone on this computer already has that name.'); return { ...p, name: n }; });
}
export function setPicture(id, pic) {
  if (MODE === 'guest' || MODE === 'login' || !reg()) return null;
  const want = normPic(pic);
  const p = reg().profiles.find(x => x.id === id);
  if (!p || JSON.stringify(p.pic) === JSON.stringify(want)) return null;
  return edit(id, q => ({ ...q, pic: want }));
}
/** Set, change (secret) or remove (null) a lock. `old` must open the current one. */
export async function setSecret(id, secret, old = '') {
  signedIn();
  if (!(await verify(id, old))) throw new Error('The current PIN or password is not right.');
  const lock = secret ? await makeLock(secret) : null;
  return edit(id, p => ({ ...p, lock }));
}

function deleteDb(name) {
  return new Promise(done => {
    if (typeof indexedDB === 'undefined') { done(); return; }
    let t = 0;
    try {
      const q = indexedDB.deleteDatabase(name);
      q.onsuccess = q.onerror = () => { clearTimeout(t); done(); };
      /* another tab still has it open: it closes on versionchange (db.js) */
      t = setTimeout(done, 5000);
    } catch (e) { done(); }
  });
}
/** Delete person `id` and their data — only theirs. `secret` must open their lock. */
export async function remove(id, secret = '') {
  signedIn();
  if (id === ID) throw new Error('Switch to someone else before deleting this profile.');
  const list0 = readRegistry()?.profiles || [];
  if (!list0.some(p => p.id === id)) throw new Error('That person is not on this computer any more.');
  if (!(await verify(id, secret))) throw new Error('That PIN or password is not right.');
  /* off the list first: a tab still signed in as them stops saving */
  writeRegistry((readRegistry()?.profiles || []).filter(p => p.id !== id));
  const sweep = () => { for (const k of keysOf(id)) { try { LS.removeItem(k); } catch (e) { /* keep going */ } } };
  sweep();
  await Promise.all(idbsOf(id).map(deleteDb));
  /* a save that was already on its way from that tab */
  await new Promise(r => setTimeout(r, 400));
  sweep();
  return true;
}

/* ---------- moving between people ------------------------------------- */
function wipeGuest() {
  for (const k of keysIn(SS)) if (k.endsWith(SEP + GUEST)) { try { SS.removeItem(k); } catch (e) { /* gone */ } }
}
function leave() {
  if (MODE === 'guest') { dead = true; wipeGuest(); }
}
/** Become `id` (after its lock opens), reloading into their desktop. */
export async function switchTo(id, secret = '') {
  if (!reg()?.profiles.some(p => p.id === id)) throw new Error('That person is not on this computer any more.');
  if (!(await verify(id, secret))) throw new Error('That PIN or password is not right.');
  leave();
  SS.setItem(SESSION, JSON.stringify({ id }));
  try { SS.setItem(RESTART, '1'); } catch (e) { /* the full splash, then */ }
  location.reload();
}
/** Back to the login screen (a guest's session is erased on the way). */
export function signOut() {
  leave();
  SS.removeItem(SESSION);
  location.reload();
}
/** A guest session in this tab: sessionStorage only, gone when it ends. */
export function startGuest() {
  wipeGuest();
  /* a guest skips the first-run setup and the boot menu */
  SS.setItem(BASES[0] + SEP + GUEST, JSON.stringify({ session: { onboarded: true }, prefs: { bootSkip: true } }));
  SS.setItem(SESSION, JSON.stringify({ guest: true }));
  try { SS.setItem(RESTART, '1'); } catch (e) { /* full splash */ }
  location.reload();
}

/* ---------- backups (js/core/backup.js) -------------------------------- */
/** [stored key, name in a backup] for this profile's localStorage. The first
    profile keeps today's behaviour: every key that is not someone else's. */
export function backupKeys() {
  if (MODE === 'guest' || MODE === 'login') return [];
  if (ID === DEFAULT) return keysIn(LS).filter(k => !OWNED.test(k) && k !== REGISTRY && k !== 'staticos.pixicons.v1').map(k => [k, k]);
  return keysOf(ID).map(k => [k, k.slice(0, -SUFFIX.length)]);
}
/** Where a key from a backup goes in this profile, or null to leave it out. */
export function importKey(name) {
  const k = String(name);
  if (OWNED.test(k) || k === REGISTRY || k === 'staticos.pixicons.v1' || MODE === 'guest' || MODE === 'login') return null;
  if (ID === DEFAULT) return k;
  return BASES.includes(k) ? k + SUFFIX : null;
}

/* ---------- other tabs -------------------------------------------------- */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', e => {
    if (e.key !== REGISTRY && e.key !== null) return;
    cache = undefined;
    if (MODE !== 'single' && MODE !== 'profile') return;
    const r = reg();
    /* a tab opened before anyone else was added is the first profile's:
       it stays signed in rather than meeting a login screen on reload */
    if (r && MODE === 'single' && !readSession() && r.profiles.some(p => p.id === ID)) {
      try { SS.setItem(SESSION, JSON.stringify({ id: ID })); } catch (err) { /* asks on reload */ }
    }
    /* someone deleted this profile in another tab: stop saving, ask again */
    if (r && r.profiles.length && !r.profiles.some(p => p.id === ID)) {
      dead = true;
      try { SS.removeItem(SESSION); } catch (err) { /* reload asks anyway */ }
      location.reload();
    }
  });
}

export default {
  MODE, ID, REGISTRY, SESSION, DEFAULT, GUEST, BASES, MAX, key, idbName, local, stopped, freeze, list, people, current, displayName,
  asksAtStart, keysOf, foreign, checkSecret, verify, create, rename, setPicture, setSecret, remove, switchTo, signOut,
  startGuest, backupKeys, importKey, tidy,
};
