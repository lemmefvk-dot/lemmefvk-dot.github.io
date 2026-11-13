/* ============================================================
   identity.js — who "you" are on StaticOS's live features.

   There are no StaticOS accounts on a server, so the live
   features (Party, Social, the Message Hub) use a random id kept
   on this device plus a display name and a colour. The name comes
   from the signed-in StaticOS account when there is one, else a
   generated "Player-xxxx" — and it can be changed. When several people
   share this computer (core/profiles.js), it is the profile's name.

   Names are NOT verified: anyone can call themselves anything on a
   public channel. Every live app says so, and never shows an id as
   if it proved who someone is.

     me() -> { id, name, color, status, avatar }
     setName(name) · setStatus('online'|'away'|'busy'|'invisible')
     clean(peer) -> a peer object with every field bounded, or null
   ============================================================ */
import { store } from './store.js';
import { displayName } from './profiles.js';

const KEY = 'portal.identity';
const STATUSES = ['online', 'away', 'busy', 'invisible'];

const rand = n => {
  const a = new Uint8Array(n);
  (globalThis.crypto || {}).getRandomValues?.(a);
  return [...a].map(b => (b % 36).toString(36)).join('');
};

function load() {
  let v = store.get(KEY, null);
  if (!v || typeof v.id !== 'string' || v.id.length < 8) {
    v = { id: rand(12), color: Math.floor(Math.random() * 360), name: null, status: 'online' };
    store.set(KEY, v);
  }
  return v;
}

/* text that is safe to show: no control characters, no angle brackets, bounded */
export const tidy = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

export function me() {
  const v = load();
  const u = store.get('session.user', null);
  const name = tidy(v.name, 24) || tidy(displayName(), 24) || tidy(u && (u.name || u.username), 24) || `Player-${v.id.slice(0, 4)}`;
  return { id: v.id, name, color: v.color, status: STATUSES.includes(v.status) ? v.status : 'online', avatar: null };
}

export function setName(name) {
  const v = load();
  store.set(KEY, { ...v, name: tidy(name, 24) || null });
  return me();
}

export function setStatus(status) {
  const v = load();
  store.set(KEY, { ...v, status: STATUSES.includes(status) ? status : 'online' });
  return me();
}

/** Bound every field of a peer that arrived over the network. */
export function clean(p) {
  if (!p || typeof p !== 'object') return null;
  const id = tidy(p.id, 32);
  if (!/^[a-z0-9]{8,32}$/.test(id)) return null;
  return {
    id,
    name: tidy(p.name, 24) || `Player-${id.slice(0, 4)}`,
    color: Number.isFinite(p.color) ? Math.abs(Math.round(p.color)) % 360 : 200,
    status: STATUSES.includes(p.status) ? p.status : 'online',
    playing: tidy(p.playing, 60) || null,
  };
}

export default { me, setName, setStatus, clean, tidy };
