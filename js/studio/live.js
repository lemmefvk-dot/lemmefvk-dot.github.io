/* ============================================================
   studio/live.js — a friend watches your scene as you edit it.

   Rides a js/core/pair.js room (kind 'studio'), like Draw Together:
   six-character code, sealed on the broker, an optional direct
   link. The watcher is READ-ONLY: it can send nothing but "hi",
   and everything it receives is checked here and only ever drawn
   on a canvas (never run, never turned into markup).

   What is sent: the scene (objects, events, settings, levels) and
   which object the host has selected. NOT the game code, and not the
   images or sounds: assets are never synced, so a sprite shows as
   its colour on the watcher's screen.

   The scene is deflated and sent as base64 text in pieces of at most
   CHUNK characters (a room message is capped well under that).
     scn { id, i, n, d }   piece i of n of scene number id
     sel { id }            the host's selected object id (or '')
   ============================================================ */
import { deflate, inflate, toB64url, fromB64url } from '../core/sharelink.js';
import { validateScene } from './runtime.js';

export const KIND = 'studio';
export const CHUNK = 9000;
export const MAX_PARTS = 40;              /* about 360 KB of compressed scene */
export const MAX_SCENE = 2 * 1024 * 1024;  /* what a scene may unpack to */

const ID = /^[a-z0-9]{4,12}$/;
export const checkers = {
  scn: m => (typeof m.id === 'string' && ID.test(m.id) && Number.isInteger(m.i) && Number.isInteger(m.n) && m.n >= 1 && m.n <= MAX_PARTS && m.i >= 0 && m.i < m.n
    && typeof m.d === 'string' && m.d.length <= CHUNK + 16 && /^[A-Za-z0-9_-]*$/.test(m.d) ? { id: m.id, i: m.i, n: m.n, d: m.d } : null),
  sel: m => (typeof m.id === 'string' && m.id.length <= 60 ? { id: m.id.replace(/[\u0000-\u001f]/g, '') } : null),
};

export const newId = () => Math.random().toString(36).slice(2, 10).padEnd(6, '0');

/** The scene as pieces ready to send, or null when it is too big to share live. */
export async function pack(scene) {
  const bytes = new TextEncoder().encode(JSON.stringify(scene));
  if (bytes.length > MAX_SCENE) return null;
  const text = toB64url(await deflate(bytes));
  const n = Math.max(1, Math.ceil(text.length / CHUNK));
  if (n > MAX_PARTS) return null;
  const id = newId();
  return { id, parts: Array.from({ length: n }, (_, i) => ({ id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) })) };
}

/** Collects pieces until a whole scene has arrived. add(piece) -> scene | null. */
export function assembler() {
  let cur = null;
  return {
    async add(p) {
      if (!cur || cur.id !== p.id) cur = { id: p.id, n: p.n, got: new Map() };
      if (cur.n !== p.n) return null;
      cur.got.set(p.i, p.d);
      if (cur.got.size < cur.n) return null;
      const text = Array.from({ length: cur.n }, (_, i) => cur.got.get(i)).join('');
      cur = null;
      try {
        const raw = JSON.parse(new TextDecoder().decode(await inflate(fromB64url(text), MAX_SCENE)));
        const v = validateScene(raw);
        return v.scene || null;
      } catch (err) { return null; }
    },
  };
}

export default { KIND, CHUNK, checkers, pack, assembler };
