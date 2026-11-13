/* ============================================================
   watchsync.js — the shared clock of Watch Together, and how a
   video is recognised on two devices. No DOM, no network: the app
   (js/apps/watchtogether.js) feeds it messages and asks it where
   the video should be.

   THE SHARED STATE is one record both people agree on:
       { ver, by, play, pos, at }
   "at `at` (ms, on this device's clock) the video was at `pos`
   seconds, and is playing / paused". Any press of play, pause or a
   seek by either person makes a new record with ver one higher than
   any seen; when two arrive with the same ver, the host's wins, so
   both sides settle on the same one. A record from the friend has
   its time moved onto this device's clock with the offset measured
   by core/pair.js (round trips, the quickest one kept).

   expected(state, now) is where the video should be now; the app
   compares that with its <video> every few hundred ms and seeks when
   they are more than DRIFT (0.5 s) apart.

   CONTENT IDS say which video without sending it:
     asset:<path>     a video that ships with StaticOS (~/Videos)
     sha256:<hex>     any other file, by the SHA-256 of its bytes
   A received id is only ever compared with this device's own files;
   it is never loaded as an address.
   ============================================================ */
import * as media from './media.js';
import { vfs } from './vfs.js';

export const DRIFT = 0.5;
export const CID_RE = /^(asset:[A-Za-z0-9._/-]{1,200}|sha256:[0-9a-f]{64}|yt:[A-Za-z0-9_-]{11})$/;
const DAY = 86400;

export const fresh = () => ({ ver: 0, by: 'host', play: false, pos: 0, at: 0 });

/** Is `b` newer than `a`? Same version: the host's record wins. */
export const newer = (b, a) => b.ver > a.ver || (b.ver === a.ver && b.by === 'host' && a.by !== 'host');

/** Seconds the video should be at, at `now` (ms on this device's clock). */
export function expected(st, now, dur = Infinity) {
  let t = st.pos;
  if (st.play) t += Math.max(0, now - st.at) / 1000;
  const end = Number.isFinite(dur) && dur > 0 ? dur : Infinity;
  return Math.max(0, Math.min(t, end));
}

/** A record that came from the friend → this device's clock (offset = their clock − ours). */
export function fromPeer(m, offset, role) {
  return { ver: m.ver, by: role === 'host' ? 'guest' : 'host', play: m.play, pos: m.pos, at: m.at - (Number.isFinite(offset) ? offset : 0) };
}

export function checkState(m) {
  if (!Number.isInteger(m.ver) || m.ver < 0 || m.ver > 1e9) return null;
  if (typeof m.play !== 'boolean' || !Number.isFinite(m.pos) || m.pos < 0 || m.pos > DAY || !Number.isFinite(m.at)) return null;
  return { ver: m.ver, play: m.play, pos: m.pos, at: m.at };
}

/* ---------- which video ---------- */
const hashes = new Map();                 /* media id or asset url -> sha256 hex, for the session */
async function hashOf(n) {
  const c = String(n.content || '');
  if (hashes.has(c)) return hashes.get(c);
  const blob = await media.blobOf(n);
  if (!blob) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const hex = [...d].map(x => x.toString(16).padStart(2, '0')).join('');
  hashes.set(c, hex);
  if (hashes.size > 200) hashes.delete(hashes.keys().next().value);
  return hex;
}
const HASH_MAX = 1024 * 1024 * 1024;

/** The content id of one of this device's video files, or null. */
export async function cidOf(path) {
  const n = vfs.node(path);
  if (!n || n.type !== 'file' || !media.isMedia(n)) return null;
  const c = String(n.content);
  if (c.startsWith(media.ASSET)) return `asset:${c.slice(media.ASSET.length)}`;
  if ((n.size || 0) > HASH_MAX) return null;
  const hex = await hashOf(n);
  return hex ? `sha256:${hex}` : null;
}

/** Every video under Home (the Trash left out), ~/Videos and ~/Downloads first. */
export function videos() {
  const out = [];
  const first = ['Videos', 'Downloads'].map(d => `${vfs.HOME}/${d}`);
  const seen = new Set();
  const take = (n, path) => {
    if (n.type !== 'file' || seen.has(path) || !media.isMedia(n) || media.kindOf(n.name) !== 'video') return;
    seen.add(path);
    out.push({ path, name: n.name, size: n.size || 0, asset: String(n.content).startsWith(media.ASSET) });
  };
  for (const d of first) if (vfs.node(d)) vfs.walk(d, take, 3);
  vfs.walk(vfs.HOME, (n, path) => { if (!path.startsWith(`${vfs.HOME}/Trash`)) take(n, path); }, 4);
  return out;
}

/** This device's file for a content id (and the size the friend's has), or null. */
export async function findLocal(cid, size = null) {
  if (!CID_RE.test(String(cid || ''))) return null;
  const list = videos();
  if (cid.startsWith('asset:')) {
    const want = media.ASSET + cid.slice(6);
    const hit = list.find(v => vfs.node(v.path)?.content === want);
    if (hit) return hit;
  }
  /* by bytes: only files of the same size are worth hashing */
  const hex = cid.startsWith('sha256:') ? cid.slice(7) : null;
  if (!hex) return null;
  for (const v of list) {
    if (size !== null && v.size !== size) continue;
    const n = vfs.node(v.path);
    if (!n || (n.size || 0) > HASH_MAX) continue;
    try { if (await hashOf(n) === hex) return v; } catch (err) { /* unreadable: not it */ }
  }
  return null;
}

export default { DRIFT, CID_RE, fresh, newer, expected, fromPeer, checkState, cidOf, videos, findLocal };
