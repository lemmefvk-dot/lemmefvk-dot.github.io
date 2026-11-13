/* ============================================================
   codeshare.js — a small web project carried inside a link.

   Same idea as core/sharelink.js (a game in a link): no server, the
   project is JSON, deflated with the browser's own CompressionStream
   and written as base64url after #project= — the part after # never
   leaves the browser.

     #project=1.<base64url of deflate(JSON)>
     JSON = { v:1, k:'project', t:name, c:creator|null, at:ms, f:[{ p:path, t:text }] }

   This is someone else's code arriving on the recipient's StaticOS,
   so decode() is strict and only reads — it never runs anything:
     · the schema is exact: no extra keys, every value the right type
     · paths are relative, at most 4 deep, with none of  .. / . /
       empty parts, backslashes, drive colons, control or bidi
       characters, dotfiles, or repeats (case-insensitive)
     · only text web files: html htm css js mjs json txt md svg
     · at most 40 files, 300 KB each, 1 MB in all — and unpacking
       stops the moment it passes the cap, so a "zip bomb" costs nothing
     · the link itself stays under 64 KB (hard to send beyond that)
   Names are data: whoever shows them must use textContent.

   Limits are said plainly in every refusal. The recipient reads the
   files first (core/codeview.js); the code only runs, in
   core/sandbox.js's sealed frame, when they press Run.

     encodeProject({ name, files, creator }) -> { ok, link, chars, bytes, count, skipped } | { ok:false, error, reason }
     decode(text)                            -> { ok, project } | { ok:false, error, reason }
   ============================================================ */
import { toB64url, fromB64url, deflate, inflate, kb, line, supported, MAX_LINK } from './sharelink.js';

export const PARAM = 'project';
export const VERSION = '1';
export const LIMITS = {
  link: MAX_LINK,              /* characters of the whole link */
  files: 40,
  file: 300 * 1024,            /* bytes of one file's text */
  total: 1024 * 1024,          /* bytes of all text, before compression */
  path: 100,
  part: 60,
  depth: 4,
};
export const EXTS = ['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'svg'];
const NAME_MAX = 60;
const enc = new TextEncoder();
const bytesOf = s => enc.encode(s).byteLength;

const fail = (reason, error) => ({ ok: false, reason, error });
const extOf = p => { const m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; };

/* control characters, bidi overrides/isolates, zero-width and BOM, and the
   characters that mean something to a path or a URL */
const BAD_PATH = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\\\:*?"<>|#%\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u206f\\ufeff]');

/** null when the path is fine, else why not (said to the person) */
export function pathProblem(p) {
  if (typeof p !== 'string' || !p) return 'a file has no name';
  if (p.length > LIMITS.path) return `a file path is longer than ${LIMITS.path} characters`;
  if (BAD_PATH.test(p)) return 'a file name has characters that aren’t allowed';
  if (p.startsWith('/')) return 'a file path starts with / (paths must stay inside the project)';
  const parts = p.split('/');
  if (parts.length > LIMITS.depth) return `a file is in folders more than ${LIMITS.depth - 1} deep`;
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return 'a file path uses .. or an empty part (paths must stay inside the project)';
    if (part.length > LIMITS.part) return `a file or folder name is longer than ${LIMITS.part} characters`;
    if (part.startsWith('.') || /[ .]$/.test(part)) return 'a file name starts with a dot or ends with a space or dot';
  }
  if (!EXTS.includes(extOf(p))) return `“${p.slice(-40)}” isn’t a web text file (allowed: ${EXTS.join(', ')})`;
  return null;
}

/** The page a project opens on: index.html at the top, else the shallowest .html. */
export function entryPage(files) {
  const pages = files.map(f => f.path).filter(p => /\.html?$/i.test(p));
  return pages.find(p => /^index\.html?$/i.test(p)) || pages.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] || null;
}

/** A name that is safe as a folder in ~/Projects. */
export const folderName = name => (String(name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || 'shared-project');

export async function encodeProject({ name, files, creator } = {}) {
  if (!supported()) return fail('unsupported', 'This browser can’t compress a project into a link.');
  const keep = [], skipped = [];
  let total = 0;
  for (const f of files || []) {
    const path = String(f.path || '');
    const text = String(f.text ?? '');
    if (pathProblem(path)) { skipped.push(path); continue; }
    if (text.includes('\u0000')) { skipped.push(path); continue; }
    const n = bytesOf(text);
    if (n > LIMITS.file) return fail('too-big', `${path} is ${kb(n)}, more than a link can carry for one file (${kb(LIMITS.file)}). Make it smaller, or send the project another way.`);
    total += n;
    keep.push({ p: path, t: text });
  }
  if (!keep.some(f => /\.html?$/i.test(f.p))) return fail('empty', 'There is no .html page in this folder, so there is nothing to open for someone else.');
  if (keep.length > LIMITS.files) return fail('too-big', `This project has ${keep.length} files; a link can carry at most ${LIMITS.files}.`);
  if (total > LIMITS.total) return fail('too-big', `This project is ${kb(total)} of text, more than a link can carry (${kb(LIMITS.total)} at most before compression).`);
  const payload = { v: 1, k: 'project', t: line(name, NAME_MAX) || 'Shared project', c: line(creator, 40) || null, at: Date.now(), f: keep };
  let packed;
  try { packed = await deflate(enc.encode(JSON.stringify(payload))); }
  catch (e) { return fail('error', `The project couldn’t be compressed (${e.message || e}).`); }
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';
  const link = `${base}#${PARAM}=${VERSION}.${toB64url(packed)}`;
  if (link.length > LIMITS.link) {
    return fail('too-big', `This project is too big for a link: compressed it is still ${kb(link.length)}, and a share link can be at most ${kb(LIMITS.link)}. Remove some files or send it another way.`);
  }
  return { ok: true, link, chars: link.length, bytes: total, count: keep.length, skipped, title: payload.t };
}

const KEYS = new Set(['v', 'k', 't', 'c', 'at', 'f']);

/** Read a #project= value (or a whole link). Never runs anything. */
export async function decode(text) {
  let s = String(text || '').trim();
  const at0 = s.indexOf(`${PARAM}=`);
  if (at0 >= 0) s = s.slice(at0 + PARAM.length + 1);
  s = s.split('&')[0];
  if (!s) return fail('empty', 'This link has no project in it.');
  if (s.length > LIMITS.link) return fail('too-big', `This link is longer than a StaticOS share link can be (${kb(LIMITS.link)}), so it wasn’t opened.`);
  const dot = s.indexOf('.');
  const ver = dot > 0 ? s.slice(0, dot) : '';
  const body = dot > 0 ? s.slice(dot + 1) : '';
  if (ver !== VERSION) return fail('version', 'This share link was made by a different version of StaticOS and can’t be read here.');
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return fail('broken', 'This link is damaged: part of it may have been cut off when it was copied.');
  if (!supported()) return fail('unsupported', 'This browser can’t open StaticOS share links (it has no DecompressionStream).');
  let json;
  try {
    const bytes = await inflate(fromB64url(body), LIMITS.total * 2 + 65536);
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    if (e && e.tooBig) return fail('too-big', `This link unpacks to more than ${kb(LIMITS.total)}, which is bigger than a shared project can be, so it wasn’t opened.`);
    return fail('broken', 'This link is damaged: part of it may have been cut off when it was copied.');
  }
  return check(json, s.length);
}

/** The strict part: a parsed payload in, a project or a refusal out. */
export function check(json, chars = 0) {
  const bad = why => fail('invalid', `This link doesn’t hold a StaticOS project (${why}), so it wasn’t opened.`);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return bad('not a project');
  for (const k of Object.keys(json)) if (!KEYS.has(k)) return bad('it has fields a project doesn’t');
  if (json.v !== 1 || json.k !== 'project') return bad('wrong kind');
  if (typeof json.t !== 'string' || json.t.length > 400) return bad('no name');
  if (json.c != null && (typeof json.c !== 'string' || json.c.length > 400)) return bad('bad maker');
  if (json.at != null && typeof json.at !== 'number') return bad('bad date');
  if (!Array.isArray(json.f) || !json.f.length) return bad('no files');
  if (json.f.length > LIMITS.files) return fail('too-big', `This link holds ${json.f.length} files; a shared project has at most ${LIMITS.files}, so it wasn’t opened.`);
  const seen = new Set();
  const files = [];
  let total = 0;
  for (const f of json.f) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return bad('a file entry is wrong');
    const keys = Object.keys(f);
    if (keys.length !== 2 || !('p' in f) || !('t' in f)) return bad('a file entry is wrong');
    if (typeof f.p !== 'string' || typeof f.t !== 'string') return bad('a file entry is wrong');
    const why = pathProblem(f.p);
    if (why) return fail('path', `This link was refused because ${why}.`);
    const key = f.p.toLowerCase();
    if (seen.has(key)) return fail('path', 'This link was refused because two files have the same name.');
    seen.add(key);
    if (f.t.includes('\u0000')) return bad('a file isn’t text');
    const n = bytesOf(f.t);
    if (n > LIMITS.file) return fail('too-big', `This link holds a file bigger than ${kb(LIMITS.file)}, so it wasn’t opened.`);
    total += n;
    if (total > LIMITS.total) return fail('too-big', `This link holds more than ${kb(LIMITS.total)} of text, so it wasn’t opened.`);
    files.push({ path: f.p, text: f.t, bytes: n });
  }
  if (!entryPage(files)) return bad('no .html page');
  const at = json.at;
  return {
    ok: true,
    project: {
      name: line(json.t, NAME_MAX) || 'Shared project',
      creator: line(json.c, 40) || null,
      at: Number.isFinite(at) && at > 0 && at < 8.64e15 ? at : null,
      files, bytes: total, chars,
    },
  };
}

export default { encodeProject, decode, check, pathProblem, entryPage, folderName, LIMITS, EXTS, PARAM };
