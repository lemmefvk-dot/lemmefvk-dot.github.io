/* ============================================================
   setup.js — your settings as one thing you can keep, move and
   switch between: a settings snapshot.

     { format: 'staticos-settings', version: 1, name, at,
       prefs: { …every setting that is yours… },
       dock:  [ …app ids… ],
       look:  'SLOOK1.…' }      the look, as an ordinary look code

   The look inside is the same code Static Store shares (core/lookcode.js),
   so a wallpaper, accent and the rest travel the one way they already do.

   Three things are made from it:

   · Move settings — Settings › Setups & modes writes a snapshot to a
     file and reads one back, to set up another Chromebook without moving
     your files, notes or saves. Nothing but settings is in it.
   · Whole-setup profiles ("Home", "School", "Night") — a snapshot kept
     under a name; one click puts it all on, and it can be undone.
   · Modes (Study, Gaming, Chill) — a small set of settings switched
     together and put back when you leave the mode: only what the mode
     changed, and only if you haven't changed it since.

   What a snapshot never holds: anything that looks like a key, token,
   PIN or password, where you are (the weather place), your birthday, the
   notification log, or another snapshot. Importing checks every value:
   a setting this version doesn't know is listed and left alone, a value of
   the wrong kind is refused, and nothing changes until you say so.

     snapshot(name?, { nested })        -> snapshot
     validate(text | object)            -> { ok, snap } | { ok: false, error }
     plan(snap)                         -> { changes, unknown, refused, dock, look }
     apply(snap, { dock, look })        -> undo()
     setups() saveSetup(name) useSetup(id) removeSetup(id)
     MODES, mode(), setMode(id), clearMode(), modeChanges(id)
   ============================================================ */
import { store } from './store.js';
import { getApp } from './registry.js';
import * as LC from './lookcode.js';
import { APPEARANCE_DEFAULTS } from './appearance.js';
import { DEFAULTS as SEASON_DEFAULTS } from './season.js';

export const FORMAT = 'staticos-settings';
export const VERSION = 1;
export const EXT = '.staticos-settings.json';
export const MAX_BYTES = 64 * 1024;
export const MAX_SETUPS = 6;
export const SETUP_NAMES = ['Home', 'School', 'Night'];

/* kept out of every snapshot */
const DENY = new Set(['recent', 'notiLog', 'clutterBackup', 'modeBackup', 'mode', 'wxPlace', 'birthday', 'setups']);
/* camelCase words that mean a secret: apiKey, authToken, lockPin, adminPassword */
const SECRET = /(^|[a-z0-9])(Key|Token|Secret|Pin|Pass|Password)([A-Z0-9]|$)/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);
const prefs = () => store.get('prefs', {}) || {};

/** Is this setting allowed in a snapshot at all? */
export function allowed(key, { nested = false } = {}) {
  if (!KEY_RE.test(key) || SECRET.test(key)) return false;
  if (DENY.has(key) && !(key === 'setups' && !nested)) return false;
  return true;
}

/* a value that can only be data: small, no markup, three levels at most */
function safe(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 600 && !/[<>\u0000]/.test(v);
  if (depth >= 3) return false;
  if (Array.isArray(v)) return v.length <= 60 && v.every(x => safe(x, depth + 1));
  if (isPlain(v)) {
    const ks = Object.keys(v);
    return ks.length <= 60 && ks.every(k => /^[\w.:-]{1,60}$/.test(k) && k !== '__proto__' && safe(v[k], depth + 1));
  }
  return false;
}

/** The value a setting has when nothing has been chosen, if this build knows one. */
const known = () => ({ ...(store.defaults?.prefs || {}), ...APPEARANCE_DEFAULTS, ...SEASON_DEFAULTS, ...prefs() });
const kindOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export function snapshot(name = 'My setup', { nested = false } = {}) {
  const p = prefs();
  const out = {};
  for (const k of Object.keys(p)) {
    if (!allowed(k, { nested }) || p[k] === undefined || !safe(p[k])) continue;
    out[k] = p[k];
  }
  const dock = (store.get('dock') || []).filter(id => typeof id === 'string' && (id === 'launcher' || getApp(id)));
  let look = null;
  try { look = LC.encodeLook(store); } catch (e) { /* no wallpaper layer yet */ }
  return {
    format: FORMAT, version: VERSION,
    name: String(name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40) || 'My setup',
    at: Date.now(), prefs: out, dock, look,
  };
}

/** Check a file's text (or an object). Never throws. */
export function validate(input) {
  let o = input;
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES) return { ok: false, error: 'That file is too big to be a settings file.' };
    try { o = JSON.parse(input); } catch (e) { return { ok: false, error: 'That isn’t a settings file: it could not be read.' }; }
  }
  if (!isPlain(o) || o.format !== FORMAT) return { ok: false, error: 'That isn’t a StaticOS settings file.' };
  if (!Number.isInteger(o.version) || o.version < 1) return { ok: false, error: 'That settings file has no version.' };
  if (o.version > VERSION) return { ok: false, error: 'That settings file is from a newer StaticOS. Update this one first.' };
  if (!isPlain(o.prefs)) return { ok: false, error: 'That settings file has no settings in it.' };
  if (Object.keys(o.prefs).length > 400) return { ok: false, error: 'That settings file holds too many settings.' };
  let look = null;
  if (typeof o.look === 'string' && o.look) { try { LC.decodeLook(o.look); look = o.look; } catch (e) { look = null; } }
  return {
    ok: true,
    snap: {
      format: FORMAT, version: VERSION,
      name: String(o.name || 'Imported settings').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40) || 'Imported settings',
      at: Number(o.at) || 0, prefs: o.prefs,
      dock: Array.isArray(o.dock) ? o.dock.filter(x => typeof x === 'string' && x.length < 60).slice(0, 60) : null,
      look,
    },
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** What applying a snapshot would do, setting by setting. */
export function plan(snap, { nested = false } = {}) {
  const cur = prefs(), base = known();
  const changes = [], unknown = [], refused = [];
  for (const [k, v] of Object.entries(snap.prefs || {})) {
    if (!allowed(k, { nested }) || !safe(v)) { refused.push(k); continue; }
    if (!(k in base)) { unknown.push(k); continue; }
    const want = base[k];
    if (want !== undefined && want !== null && v !== null && kindOf(v) !== kindOf(want)) { refused.push(k); continue; }
    if (!same(cur[k], v)) changes.push({ key: k, from: cur[k], to: v });
  }
  const dockNow = store.get('dock') || [];
  const dock = Array.isArray(snap.dock) ? snap.dock.filter(id => id === 'launcher' || getApp(id)) : null;
  const dockChanges = !!dock && dock.length > 0 && !same(dock, dockNow);
  let look = null;
  if (snap.look) { try { look = LC.describeLook(LC.decodeLook(snap.look), store); } catch (e) { look = null; } }
  return { changes, unknown, refused, dock: dockChanges ? dock : null, look };
}

/** Put a snapshot on. Returns undo(). */
export function apply(snap, { dock = true, look = true, nested = false } = {}) {
  const before = { prefs: { ...prefs() }, dock: [...(store.get('dock') || [])], wallpaper: store.get('wallpaper') };
  const p = plan(snap, { nested });
  const patch = {};
  for (const c of p.changes) patch[c.key] = c.to;
  if (Object.keys(patch).length) store.set('prefs', { ...prefs(), ...patch });
  if (dock && p.dock) store.set('dock', p.dock);
  if (look && snap.look) {
    try {
      const L = LC.decodeLook(snap.look);
      /* the prefs above already carry the accent, appearance and the rest;
         the look is for what prefs don't hold (the wallpaper) */
      LC.applyLook({ wallpaper: L.wallpaper }, store);
    } catch (e) { /* a wallpaper this build doesn't have */ }
  }
  return () => {
    store.set('prefs', before.prefs);
    store.set('dock', before.dock);
    if (before.wallpaper) store.set('wallpaper', before.wallpaper);
  };
}

/* ---------------- whole-setup profiles ---------------------------- */
const SETUPS = 'prefs.setups';
const sid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export function setups() {
  const v = store.get(SETUPS, []);
  return (Array.isArray(v) ? v : []).filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && isPlain(s.snap));
}
export function saveSetup(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!n) throw new Error('Give the setup a name first.');
  const list = setups();
  const at = list.findIndex(s => s.name.toLowerCase() === n.toLowerCase());
  const one = { id: at >= 0 ? list[at].id : sid(), name: n, snap: snapshot(n, { nested: true }) };
  if (at >= 0) list[at] = one;
  else {
    if (list.length >= MAX_SETUPS) throw new Error(`You can keep ${MAX_SETUPS} setups. Remove one first.`);
    list.push(one);
  }
  store.set(SETUPS, list);
  return one;
}
export function removeSetup(id) { store.set(SETUPS, setups().filter(s => s.id !== id)); }
/** -> { setup, plan, undo } — a setup is applied whole, including the Dock. */
export function useSetup(id) {
  const s = setups().find(x => x.id === id);
  if (!s) return null;
  const snap = { ...s.snap, prefs: { ...s.snap.prefs } };
  /* a setup never carries the list of setups, nor which mode is on */
  const pl = plan(snap, { nested: true });
  return { setup: s, plan: pl, undo: apply(snap, { nested: true }) };
}

/* ---------------- Modes ------------------------------------------- */
/* Each mode is a few settings (and a small look, in the shape a look code
   decodes to) switched together. Nothing here is a lock: they are ordinary
   settings, and Settings shows each one. */
export const MODES = [
  { id: 'study', name: 'Study', icon: 'file-text', color: '#7dd3fc',
    note: 'Fewer distractions: Do Not Disturb on, the widget rail, desktop icons, the pet and the Continue card tucked away, and animation reduced.',
    prefs: { dnd: true, widgetsVisible: false, desktopIcons: false, desktopPet: false, deskHome: false, reduceMotion: true },
    look: {} },
  { id: 'gaming', name: 'Gaming', icon: 'gamepad', color: '#f0abfc',
    note: 'Game Mode on (and on by itself for games), Do Not Disturb on, blur and deep shadows off, the widget rail and pet away.',
    prefs: { gameMode: true, gameModeAuto: true, dnd: true, uiBlur: false, uiShadows: false, widgetsVisible: false, desktopPet: false },
    look: {} },
  { id: 'chill', name: 'Chill', icon: 'moon', color: '#fcd34d',
    note: 'Night Shift on and the screen a little dimmer, the Felt sound pack, the desktop clock and widgets showing, Do Not Disturb off.',
    prefs: { nightShift: true, brightness: 85, widgetsVisible: true, desktopClock: true, desktopPet: true, dnd: false, uiSounds: true },
    look: { soundPack: 'soft' } },
];

/** The settings a mode sets, look included. */
function modePatch(m) {
  const p = { ...m.prefs };
  if (m.look.accent) p.accent = m.look.accent;
  if (m.look.theme) p.theme = m.look.theme;
  if (m.look.iconStyle) p.iconStyle = m.look.iconStyle;
  if (m.look.soundPack) p.soundPack = m.look.soundPack;
  return p;
}
const modeOf = id => MODES.find(m => m.id === id) || null;

/** The mode that is on, or null. */
export function mode() {
  const b = store.get('prefs.modeBackup', null);
  return b && modeOf(b.id) ? b.id : null;
}

/** What a mode would change right now, setting by setting. */
export function modeChanges(id) {
  const m = modeOf(id);
  if (!m) return [];
  const cur = prefs(), base = known();
  return Object.entries(modePatch(m)).map(([key, to]) => ({ key, from: cur[key] !== undefined ? cur[key] : base[key], to })).filter(c => !same(c.from, c.to));
}

/** Put back what the mode we are in changed (not what you changed since). */
export function clearMode() {
  const b = store.get('prefs.modeBackup', null);
  if (!b) return false;
  const next = { ...prefs() };
  const set = b.set || {};
  for (const [k, v] of Object.entries(b.was || {})) if (same(next[k], set[k])) next[k] = v;
  for (const k of b.unset || []) if (same(next[k], set[k])) delete next[k];
  delete next.modeBackup;
  delete next.mode;
  store.set('prefs', next);
  return true;
}

/** Switch to a mode (leaving the one we are in first). Returns undo(). */
export function setMode(id) {
  const m = modeOf(id);
  if (!m) return null;
  const before = { ...prefs() };
  clearMode();
  const patch = modePatch(m);
  const cur = prefs();
  const was = {}, unset = [];
  for (const k of Object.keys(patch)) { if (k in cur) was[k] = cur[k]; else unset.push(k); }
  store.set('prefs', { ...cur, ...patch, modeBackup: { id: m.id, set: patch, was, unset }, mode: m.id });
  return () => store.set('prefs', before);
}

export default { snapshot, validate, plan, apply, setups, saveSetup, removeSetup, useSetup, MODES, mode, modeChanges, setMode, clearMode, allowed, FORMAT, EXT };
