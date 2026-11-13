/* ============================================================
   sharelink.js — a creation carried inside a link.

   StaticOS has no server, so a share link holds the whole game:
   the title, the creator's name, the prompt and the single HTML
   document are JSON, compressed with the browser's own
   CompressionStream('deflate') and written as base64url after
   #creation= in the address. The part after # never leaves the
   browser — no server ever sees the game, including Surge.

     #creation=1.<base64url of deflate(JSON)>

   Limits, both enforced and both said plainly:
     MAX_LINK   the whole link stays under 64 KB of text. Browsers
                take far longer addresses, but a link much past that
                is hard to paste and send. Bigger games are exported
                as an .html file instead (Static Forge → Export).
     MAX_HTML   what a link unpacks to is capped at 2 MB (the same
                cap as Forge's Import .html). Unpacking stops the
                moment it passes that, so a hostile link that
                inflates to gigabytes ("zip bomb") costs nothing.

   Opening a link never runs anything: decode() only reads it. The
   game runs when someone presses Play, in core/sandbox.js's sealed
   frame (opaque origin, no access to StaticOS, its storage or DOM).

     encode({ name, html, creator, prompt }) -> { ok, link, chars, bytes } | { ok:false, error, reason }
     decode(text)                          -> { ok, creation } | { ok:false, error, reason }
     linkFor(fragment)                     -> absolute link for this StaticOS
     supported()                           -> this browser can make/open links
   ============================================================ */

export const PARAM = 'creation';
export const VERSION = '1';
export const MAX_LINK = 64 * 1024;
export const MAX_HTML = 2 * 1024 * 1024;
const MAX = { name: 60, creator: 40, prompt: 600 };

export const supported = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(n % 1048576 ? 1 : 0)} MB` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
export const line = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const looksLikeGame = html => /<(html|script|canvas|body)\b/i.test(html);

/* ---- base64url ------------------------------------------------------ */
export function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---- streams --------------------------------------------------------- */
async function pump(stream, input, cap) {
  const writer = stream.writable.getWriter();
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (cap && size > cap) {
      reader.cancel().catch(() => {});
      const e = new Error('too big');
      e.tooBig = true;
      throw e;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
export const deflate = bytes => pump(new CompressionStream('deflate'), bytes, 0);
export const inflate = (bytes, cap) => pump(new DecompressionStream('deflate'), bytes, cap);

/** The absolute link for a fragment value, on this StaticOS's own address. */
export function linkFor(fragment) {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';
  return `${base}#${PARAM}=${fragment}`;
}

const fail = (reason, error) => ({ ok: false, reason, error });

export async function encode(c = {}) {
  if (!supported()) return fail('unsupported', 'This browser can’t compress a game into a link. Export it as an .html file instead.');
  const html = String(c.html || '');
  if (!html.trim()) return fail('empty', 'There is no game in this creation yet.');
  const raw = new TextEncoder().encode(html);
  if (raw.byteLength > MAX_HTML) return fail('too-big', `This game is ${kb(raw.byteLength)}, more than a link can carry (${kb(MAX_HTML)} at most before compression). Export it as an .html file and send that.`);
  const payload = {
    v: 1,
    t: line(c.name, MAX.name) || 'Untitled game',
    c: line(c.creator, MAX.creator) || null,
    p: line(c.prompt, MAX.prompt) || null,
    at: Date.now(),
    h: html,
  };
  let packed;
  try { packed = await deflate(new TextEncoder().encode(JSON.stringify(payload))); }
  catch (e) { return fail('error', `The game couldn’t be compressed (${e.message || e}).`); }
  const fragment = `${VERSION}.${toB64url(packed)}`;
  const link = linkFor(fragment);
  if (link.length > MAX_LINK) {
    return fail('too-big', `This game is too big for a link: compressed it is still ${kb(link.length)}, and a share link can be at most ${kb(MAX_LINK)}. Export it as an .html file from Static Forge and send that instead.`);
  }
  return { ok: true, link, fragment, chars: link.length, bytes: raw.byteLength, title: payload.t };
}

/** Read a #creation= value (or a whole link). Never runs anything. */
export async function decode(text) {
  let s = String(text || '').trim();
  const hash = s.indexOf(`${PARAM}=`);
  if (hash >= 0) s = s.slice(hash + PARAM.length + 1);
  s = s.split('&')[0];
  if (!s) return fail('empty', 'This link has no game in it.');
  if (s.length > MAX_LINK) return fail('too-big', `This link is longer than a StaticOS share link can be (${kb(MAX_LINK)}), so it wasn’t opened.`);
  const dot = s.indexOf('.');
  const ver = dot > 0 ? s.slice(0, dot) : '';
  const body = dot > 0 ? s.slice(dot + 1) : '';
  if (ver !== VERSION) return fail('version', 'This share link was made by a different version of StaticOS and can’t be read here.');
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return fail('broken', 'This link is damaged — part of it may have been cut off when it was copied.');
  if (!supported()) return fail('unsupported', 'This browser can’t open StaticOS share links (it has no DecompressionStream).');
  let json;
  try {
    const bytes = await inflate(fromB64url(body), MAX_HTML + 4096);
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    if (e && e.tooBig) return fail('too-big', `This link unpacks to more than ${kb(MAX_HTML)}, which is bigger than any StaticOS game can be, so it wasn’t opened.`);
    return fail('broken', 'This link is damaged — part of it may have been cut off when it was copied.');
  }
  if (!json || typeof json !== 'object' || json.v !== 1 || typeof json.h !== 'string') return fail('broken', 'This link doesn’t hold a StaticOS creation.');
  if (!looksLikeGame(json.h)) return fail('broken', 'This link doesn’t hold a game (there is no <html>, <script> or <canvas> in it).');
  const at = Number(json.at);
  return {
    ok: true,
    creation: {
      name: line(json.t, MAX.name) || 'Shared game',
      creator: line(json.c, MAX.creator) || null,
      prompt: line(json.p, MAX.prompt) || '',
      at: Number.isFinite(at) && at > 0 && at < 8.64e15 ? at : null,
      html: json.h,
      bytes: new TextEncoder().encode(json.h).byteLength,
      chars: s.length,
    },
  };
}

/** Web addresses a game's code mentions. It can still reach the internet
    from inside its box, so the preview names them. */
export function externalHosts(html) {
  const src = String(html || '');
  const out = new Set();
  /* xmlns namespaces such as www.w3.org are names, not downloads */
  const add = host => { const v = host.toLowerCase(); if (!/(^|\.)w3\.org$/.test(v) && out.size < 12) out.add(v); };
  for (const m of src.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)) add(m[1]);
  for (const m of src.matchAll(/\b(?:src|href)\s*=\s*["']\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)) add(m[1]);
  return [...out];
}

export default { encode, decode, linkFor, supported, externalHosts, PARAM, MAX_LINK, MAX_HTML };
