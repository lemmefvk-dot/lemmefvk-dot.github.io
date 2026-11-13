/* ============================================================
   gist.js — a public GitHub Gist, read for review in Code.

   Someone pastes a gist link (or its id); we ask GitHub for it straight
   from the browser — GET https://api.github.com/gists/<id>, no proxy,
   no token, no cookies, nothing about the person — and turn the answer
   into the same project shape a shared link carries, then hand it to
   core/codeshare.js's check(), so a gist passes through exactly the
   validation a shared project does (paths, file types, sizes, counts).

   It is someone else's code, so this module only READS and never runs
   anything. Everything it returns is plain text: the owner's login is a
   claim to be shown as text, file names and contents are text. The Code
   app shows them in its read-only review and runs the gist only when the
   person presses Run, in the sealed preview.

   What it accepts: https://gist.github.com/<id>, .../<user>/<id>
   (optionally followed by /<revision>), the same under github.com/gist/,
   or the bare hex id. Anything else is refused with a message.
   A file the API cut short ("truncated") is completed from its raw_url
   only when that URL is https on gist.githubusercontent.com, and never
   beyond the size limit; otherwise the gist is refused rather than shown
   half-read. Files that are not web text (.py, images, no extension…)
   are left out and listed, not opened; a gist with no .html page has
   nothing to preview and is refused.

     parseGist(text)              -> { ok, id } | { ok:false, reason, error }
     fetchGist(text, {fetch, signal, now})
                                  -> { ok, project, id, url, skipped } | { ok:false, reason, error, resetAt?, limit? }
     describeReset(reset, retryAfter, now) -> "…resets at 3:42 PM (in 14 minutes)"
   reasons: bad-link, not-found, rate-limit, offline, timeout, truncated,
            too-big, invalid, unavailable, error
   ============================================================ */
import * as Share from './codeshare.js';
import { line } from './sharelink.js';

export const API = 'https://api.github.com/gists/';
export const RAW_HOST = 'gist.githubusercontent.com';
export const LIMITS = { api: 6 * 1024 * 1024, wait: 15000 };

const ID = /^[0-9a-f]{20,40}$/i;
const USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const fail = (reason, error, extra) => ({ ok: false, reason, error, ...(extra || {}) });
const BAD_LINK = 'That doesn’t look like a public GitHub Gist. Paste a link like https://gist.github.com/name/0123456789abcdef0123456789abcdef, or just the gist’s id (letters a–f and digits).';

/** A gist id out of what was pasted, or why not. Only github.com / gist.github.com over https. */
export function parseGist(text) {
  const s = String(text ?? '').trim();
  if (!s) return fail('bad-link', 'Paste a GitHub Gist link or id first.');
  if (s.length > 300) return fail('bad-link', BAD_LINK);
  if (ID.test(s)) return { ok: true, id: s.toLowerCase() };
  if (/\s/.test(s)) return fail('bad-link', BAD_LINK);
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch (e) { return fail('bad-link', BAD_LINK); }
  if (u.protocol !== 'https:') return fail('bad-link', 'Only https links to GitHub gists are opened.');
  if (u.username || u.password || u.port) return fail('bad-link', BAD_LINK);
  const host = u.hostname.toLowerCase();
  if (host !== 'gist.github.com' && host !== 'github.com' && host !== 'www.github.com') return fail('bad-link', 'That link isn’t on github.com or gist.github.com, so it wasn’t opened.');
  let parts = u.pathname.split('/').filter(Boolean);
  if (host !== 'gist.github.com') {
    if (parts[0] !== 'gist') return fail('bad-link', 'That github.com link isn’t a gist, so it wasn’t opened.');
    parts = parts.slice(1);
  }
  /* <id> | <id>/<revision> | <user>/<id> | <user>/<id>/<revision> */
  let id = null;
  if (parts.length >= 1 && ID.test(parts[0]) && (parts.length === 1 || (parts.length === 2 && /^[0-9a-f]{40}$/i.test(parts[1])))) id = parts[0];
  else if (parts.length >= 2 && parts.length <= 3 && USER.test(parts[0]) && ID.test(parts[1]) && (parts.length === 2 || /^[0-9a-f]{40}$/i.test(parts[2]))) id = parts[1];
  if (!id) return fail('bad-link', BAD_LINK);
  return { ok: true, id: id.toLowerCase() };
}

/** "Resets at 3:42 PM (in 14 minutes)." from GitHub's x-ratelimit-reset (epoch seconds) or retry-after (seconds). */
export function describeReset(reset, retryAfter, now = Date.now()) {
  let at = null;
  if (Number.isFinite(reset) && reset > 0) at = reset * 1000;
  else if (Number.isFinite(retryAfter) && retryAfter >= 0) at = now + retryAfter * 1000;
  if (at == null) return 'GitHub didn’t say when it resets, so try again in a while.';
  const secs = (at - now) / 1000;
  const mins = Math.ceil(secs / 60);
  const when = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `It resets at ${when} (${secs < 60 ? 'in under a minute' : mins === 1 ? 'in 1 minute' : `in ${mins} minutes`}).`;
}

/** The body as text, stopping the moment it passes `max` bytes. */
async function readCapped(resp, max) {
  const len = Number(resp.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) { const e = new Error('big'); e.tooBig = true; throw e; }
  if (!resp.body || !resp.body.getReader) {
    const t = await resp.text();
    if (new TextEncoder().encode(t).byteLength > max) { const e = new Error('big'); e.tooBig = true; throw e; }
    return t;
  }
  const rd = resp.body.getReader();
  const dec = new TextDecoder('utf-8');
  let n = 0, out = '';
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await rd.cancel(); } catch (e) { /* done anyway */ } const e = new Error('big'); e.tooBig = true; throw e; }
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

/* bidi overrides, isolates and zero-width characters can make text read differently from what it is */
const BIDI = /[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const plain = (v, n) => line(String(v ?? '').replace(BIDI, ''), n);
const num = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

/** a short plain-text version of what GitHub said (its `message`), never HTML */
const said = body => {
  try { const m = JSON.parse(body)?.message; return typeof m === 'string' ? plain(m, 300) : ''; } catch (e) { return ''; }
};

/** Ask GitHub for the gist and make a project of it. Never runs anything, never throws. */
export async function fetchGist(input, { fetch: doFetch, signal, now } = {}) {
  const p = parseGist(input);
  if (!p.ok) return p;
  const get = doFetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!get) return fail('error', 'This browser can’t fetch from GitHub.');
  const clock = () => (now ? now() : Date.now());
  /* a request that carries nothing of ours: no cookies, no referrer, no token */
  const ask = async (url, accept, max, redirect) => {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', stop, { once: true }); }
    const timer = setTimeout(() => { ctl.timedOut = true; ctl.abort(); }, LIMITS.wait);
    try {
      const resp = await get(url, { method: 'GET', headers: { Accept: accept }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect, signal: ctl.signal });
      if (resp.redirected) { try { if (new URL(resp.url).hostname.toLowerCase() !== new URL(url).hostname.toLowerCase()) throw 0; } catch (e) { const o = new Error('offline'); o.offline = true; throw o; } }
      const text = resp.ok ? await readCapped(resp, max) : await readCapped(resp, 64 * 1024).catch(() => '');
      return { resp, text };
    } catch (e) {
      if (e && e.tooBig) throw e;
      if (signal && signal.aborted) { const a = new Error('aborted'); a.aborted = true; throw a; }
      if (ctl.timedOut) { const t = new Error('timeout'); t.timeout = true; throw t; }
      const o = new Error('offline'); o.offline = true; throw o;
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
  };
  const oops = e => {
    if (e && e.aborted) return fail('error', 'Cancelled.');
    if (e && e.timeout) return fail('timeout', 'GitHub took too long to answer. Try again in a moment.');
    if (e && e.tooBig) return fail('too-big', 'GitHub’s answer is bigger than a gist can be here, so it wasn’t opened.');
    const off = typeof navigator !== 'undefined' && navigator.onLine === false;
    return fail('offline', off ? 'You’re offline, so the gist can’t be fetched. Connect to the internet and try again.' : 'Couldn’t reach GitHub. Check your connection and try again.');
  };

  let r;
  try { r = await ask(`${API}${p.id}`, 'application/vnd.github+json', LIMITS.api, 'follow'); } catch (e) { return oops(e); }
  const { resp, text } = r;
  if (!resp.ok) {
    const h = n => resp.headers.get(n);
    const remaining = num(h('x-ratelimit-remaining'));
    const msg = said(text);
    if (resp.status === 429 || (resp.status === 403 && (remaining === 0 || /rate limit|abuse/i.test(msg) || h('retry-after')))) {
      const reset = num(h('x-ratelimit-reset')), retry = num(h('retry-after')), limit = num(h('x-ratelimit-limit'));
      const resetAt = reset ? reset * 1000 : retry != null ? clock() + retry * 1000 : null;
      return fail('rate-limit', `GitHub is limiting requests: “${msg || 'rate limit exceeded'}” ${limit ? `Without signing in, its limit is ${limit} requests an hour. ` : ''}${describeReset(reset, retry, clock())}`, { resetAt, limit });
    }
    if (resp.status === 404) return fail('not-found', 'GitHub says there’s no gist with that id. Check the link: it may have a typo, or the gist may have been deleted.');
    if (resp.status === 451) return fail('unavailable', 'GitHub has taken that gist down (it isn’t available for legal reasons).');
    if (resp.status === 403) return fail('unavailable', `GitHub won’t show that gist${msg ? `: “${msg}”` : ''}.`);
    return fail('error', `GitHub answered with an error (${resp.status})${msg ? `: “${msg}”` : ''}. Try again in a moment.`);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { return fail('invalid', 'GitHub’s answer wasn’t what a gist looks like, so it wasn’t opened.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)
    || String(data.id || '').toLowerCase() !== p.id) return fail('invalid', 'GitHub’s answer wasn’t what a gist looks like, so it wasn’t opened.');

  /* sort the files: web text we can read, and the rest we only list */
  const keep = [], skipped = [], seen = new Set();
  for (const [name, f] of Object.entries(data.files)) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return fail('invalid', 'GitHub’s answer wasn’t what a gist looks like, so it wasn’t opened.');
    if (Share.pathProblem(name) || seen.has(name.toLowerCase())) { skipped.push(String(name).slice(0, 60)); continue; }
    seen.add(name.toLowerCase());
    keep.push({ name, f });
  }
  if (!keep.length) return fail('invalid', skipped.length
    ? `None of this gist’s ${skipped.length} file${skipped.length === 1 ? '' : 's'} is a web file StaticOS can open (html, css, js, json, txt, md or svg), so there is nothing to review.`
    : 'This gist has no files.');
  if (keep.length > Share.LIMITS.files) return fail('too-big', `This gist has ${keep.length} web files; at most ${Share.LIMITS.files} can be opened, so it wasn’t.`);

  const files = [];
  for (const { name, f } of keep) {
    const size = Number.isFinite(f.size) ? f.size : 0;
    if (size > Share.LIMITS.file) return fail('too-big', `“${name.slice(0, 50)}” is ${(size / 1024).toFixed(0)} KB, more than the ${Share.LIMITS.file / 1024} KB a file can be here, so the gist wasn’t opened.`);
    let body = typeof f.content === 'string' ? f.content : null;
    if (f.truncated === true || body === null) {
      /* completed only from the gist host itself, only over https, only up to the file limit */
      let raw = null;
      try { raw = new URL(String(f.raw_url)); } catch (e) { raw = null; }
      if (!raw || raw.protocol !== 'https:' || raw.hostname.toLowerCase() !== RAW_HOST || raw.username || raw.password || raw.port) {
        return fail('truncated', `GitHub only sent part of “${name.slice(0, 50)}” and didn’t say where to get the rest, so the gist wasn’t opened (a half-read file could hide code).`);
      }
      try {
        const got = await ask(raw.href, 'text/plain', Share.LIMITS.file + 1, 'error');
        if (!got.resp.ok) return fail('truncated', `GitHub only sent part of “${name.slice(0, 50)}” and the rest couldn’t be fetched (${got.resp.status}), so the gist wasn’t opened.`);
        body = got.text;
      } catch (e) {
        if (e && e.tooBig) return fail('too-big', `“${name.slice(0, 50)}” is bigger than ${Share.LIMITS.file / 1024} KB, so the gist wasn’t opened.`);
        return oops(e);
      }
    }
    files.push({ p: name, t: body });
  }

  const owner = data.owner && typeof data.owner === 'object' && typeof data.owner.login === 'string' && USER.test(data.owner.login) ? data.owner.login : null;
  const when = Date.parse(data.updated_at || data.created_at || '');
  const name = plain(typeof data.description === 'string' ? data.description : '', 60) || `Gist ${p.id.slice(0, 7)}`;
  const checked = Share.check({ v: 1, k: 'project', t: name, c: owner, at: Number.isFinite(when) ? when : null, f: files }, 0);
  if (!checked.ok) return fail(checked.reason || 'invalid', checked.error.replace(/This link/g, 'This gist'));
  return { ok: true, id: p.id, url: `https://gist.github.com/${p.id}`, project: checked.project, skipped };
}

export default { parseGist, fetchGist, describeReset, API, RAW_HOST, LIMITS };
