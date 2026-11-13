/* ============================================================
   arcade/jumper-share.js — Pixel Jumper levels inside a link.

   No server: the level is JSON, deflated with the browser's own
   CompressionStream and written as base64url after #jumper=

       #jumper=1.<base64url of deflate(JSON)>

   JSON = { v:1, t:title, c:creator, rows:[14 strings], run:[[mask,count],…] }
   `run` is a winning run of the level, recorded when its author finished
   it. Opening a link replays it on the real physics, so a level that can't
   be finished never reaches a preview (and an author can't share one).

   A level in a link is somebody else's data, so reading it is strict:
     · the link is at most MAX_LINK characters, and what it unpacks to at
       most MAX_JSON bytes (unpacking stops the moment it passes that, so a
       "zip bomb" costs nothing)
     · plain JSON of the exact shape above; unknown tile characters, a wrong
       grid size, a bad run, too many sparks or checkpoints are all refused
     · title and creator are plain text, cut to 40 characters with control
       and direction characters removed; the game only ever puts them in
       with textContent, never as HTML
     · nothing in a level can run code: it is a grid of characters
   The creator's name is whatever the link says. It is not verified.

     encodeLevel({ name, rows, run, creator }) -> { ok, link, chars, fragment } | { ok:false, reason, error }
     decodeLevel(text) -> { ok, level:{ name, creator, rows, run, frames, w, spark count… } } | { ok:false, reason, error }
     offer(level) / take()   the shell hands a decoded level to the game's next start
   ============================================================ */
import { toB64url, fromB64url, deflate, inflate } from '../core/sharelink.js';
import { buildLevel, cleanReplay, runReplay, MAX_REPLAY_FRAMES, MAX_REPLAY_RUNS } from './jumper-core.js';

export const PARAM = 'jumper';
export const VERSION = '1';
export const MAX_LINK = 8 * 1024;
export const MAX_JSON = 32 * 1024;
const MAX_NAME = 40;

export const supported = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
/* control, line-break, zero-width and direction-override characters, written as escapes */
const BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]', 'g');
const kb = n => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
/* one line of plain text: no control, line-break, zero-width or direction-override characters */
export const textLine = (v, n = MAX_NAME) => String(v ?? '')
  .replace(BAD_CHARS, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, n);
const fail = (reason, error) => ({ ok: false, reason, error });

export function linkFor(fragment) {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';
  return `${base}#${PARAM}=${fragment}`;
}

export async function encodeLevel({ name, rows, run, creator } = {}) {
  if (!supported()) return fail('unsupported', 'This browser can’t pack a level into a link.');
  const built = buildLevel(rows);
  if (!built.ok) return fail('invalid', built.error);
  if (Array.isArray(run) && run.length > MAX_REPLAY_RUNS) return fail('too-big', `This run changes buttons ${run.length} times; a level link can carry ${MAX_REPLAY_RUNS} at most. Finish the level again with fewer changes.`);
  if (Array.isArray(run) && run.reduce((n, p) => n + (Array.isArray(p) ? Number(p[1]) || 0 : 0), 0) > MAX_REPLAY_FRAMES) return fail('too-big', `This run is longer than a level link can carry (${MAX_REPLAY_FRAMES / 60 / 60} minutes). Finish the level again, faster.`);
  const clean = cleanReplay(run);
  if (!clean) return fail('unfinished', 'Finish the level once in test play before you share it.');
  const proof = runReplay(built.level, clean);
  if (!proof.won) return fail('unfinished', 'This level has changed since you last finished it. Finish it once more in test play, then share it.');
  const json = JSON.stringify({ v: 1, t: textLine(name) || 'Untitled level', c: textLine(creator) || null, rows: built.level.rows, run: clean });
  if (json.length > MAX_JSON) return fail('too-big', `This level is too big for a link (${kb(json.length)} before packing; the most is ${kb(MAX_JSON)}).`);
  let packed;
  try { packed = await deflate(new TextEncoder().encode(json), 0); } catch (e) { return fail('error', 'The level couldn’t be packed.'); }
  const fragment = `${VERSION}.${toB64url(packed)}`;
  const link = linkFor(fragment);
  if (link.length > MAX_LINK) return fail('too-big', `This level is too big for a link: packed it is ${kb(link.length)} and a Pixel Jumper link can be at most ${kb(MAX_LINK)}. Try a shorter level or a simpler run.`);
  return { ok: true, link, fragment, chars: link.length };
}

/** Read a #jumper= value or a whole link. Reads only; nothing runs. */
export async function decodeLevel(text) {
  let s = String(text || '').trim();
  const at = s.indexOf(`${PARAM}=`);
  if (at >= 0) s = s.slice(at + PARAM.length + 1);
  s = s.split('&')[0];
  if (!s) return fail('empty', 'This link has no level in it.');
  if (s.length > MAX_LINK) return fail('too-big', `This link is longer than a Pixel Jumper link can be (${kb(MAX_LINK)}), so it wasn’t opened.`);
  const dot = s.indexOf('.');
  if ((dot > 0 ? s.slice(0, dot) : '') !== VERSION) return fail('version', 'This level link was made by a different version of StaticOS and can’t be read here.');
  const body = s.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return fail('broken', 'This link is damaged — part of it may have been cut off when it was copied.');
  if (!supported()) return fail('unsupported', 'This browser can’t open level links.');
  let json;
  try {
    const bytes = await inflate(fromB64url(body), MAX_JSON + 1024);
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    if (e && e.tooBig) return fail('too-big', `This link unpacks to more than ${kb(MAX_JSON)}, far more than any Pixel Jumper level, so it wasn’t opened.`);
    return fail('broken', 'This link is damaged — part of it may have been cut off when it was copied.');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json) || json.v !== 1 || typeof json.t !== 'string') return fail('broken', 'This link doesn’t hold a Pixel Jumper level.');
  if (json.c != null && typeof json.c !== 'string') return fail('broken', 'This link doesn’t hold a Pixel Jumper level.');
  if (!Array.isArray(json.rows) || json.rows.some(r => typeof r !== 'string')) return fail('broken', 'This link doesn’t hold a Pixel Jumper level.');
  const built = buildLevel(json.rows);
  if (!built.ok) return fail('invalid', `This level can’t be opened: ${built.error}`);
  const run = cleanReplay(json.run);
  if (!run) return fail('unfinished', 'This level came without a valid proof that it can be finished, so it wasn’t opened.');
  const proof = runReplay(built.level, run);
  if (!proof.won) return fail('unfinished', 'This level can’t be finished — its recorded run doesn’t reach the goal — so it wasn’t opened.');
  return {
    ok: true,
    level: {
      name: textLine(json.t) || 'Shared level',
      creator: textLine(json.c) || null,
      rows: built.level.rows, run, w: built.level.w,
      sparks: built.level.sparks.length, checkpoints: built.level.cps.length, frames: proof.frames,
    },
  };
}

/* the shell decodes a link and offers the level, then opens the game; the game's next start picks it
   up and shows its preview. An offer nobody takes within 15 s is dropped. Nothing starts until the
   person presses Play. */
let pending = null;
export function offer(level) { pending = { level, at: Date.now() }; }
export const take = () => { const p = pending; pending = null; return p && Date.now() - p.at < 15000 ? p.level : null; };

export { MAX_REPLAY_FRAMES, MAX_REPLAY_RUNS };
export default { encodeLevel, decodeLevel, offer, take, linkFor, supported, MAX_LINK, MAX_JSON };
