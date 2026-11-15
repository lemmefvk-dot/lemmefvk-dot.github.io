/* ============================================================
   dev-tools-text.js - the Encode, Time and Diff tabs of Dev Tools,
   and JSON to CSV, with no DOM.

   ENCODE  Base64 is the browser's own btoa/atob, on the UTF-8 bytes of
   the text (TextEncoder / TextDecoder), so "héllo 👋" round-trips;
   atob alone only takes Latin-1. The URL-safe alphabet swaps + / for
   - _ and drops the = padding (RFC 4648 §5). Decoding says plainly
   when the bytes are not UTF-8 text instead of showing mojibake. URL
   encoding is encodeURIComponent / encodeURI and their decoders, with
   an option for form data, where a space is "+".

   TIME  A Unix timestamp in seconds or milliseconds, or a date written
   in ISO 8601, read with the browser's Date. How a timestamp was read
   (seconds or milliseconds) and which zone a date without one was read
   in are always said, never guessed silently.

   DIFF  Lines compared with Myers' O(ND) algorithm (the one behind
   `diff` and git), after the lines both texts start and end with are
   set aside. Its memory is capped; texts that differ in too many places
   for the cap are refused with that reason rather than compared badly.

   JSON TO CSV  An array of objects becomes a header row (every key, in
   the order first seen) and one row per object; an array of arrays is
   rows as they are; anything else in an array is one "value" column.
   A nested object or array goes into its cell as JSON text. Text that
   starts with = + - @ gets an apostrophe in front so a spreadsheet
   shows it rather than running it as a formula; numbers are written
   with the digits they had in the file.
   ============================================================ */

/* ---------------- Base64 ---------------- */
export function b64Encode(text, urlSafe = false) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const s = btoa(bin);
  return urlSafe ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s;
}
/** -> { ok, text, bytes } or { ok:false, why, bytes? } */
export function b64Decode(s) {
  let t = String(s).replace(/\s+/g, '');
  if (!t) return { ok: true, text: '', bytes: new Uint8Array(0) };
  if (/[^A-Za-z0-9+/=_-]/.test(t)) {
    const bad = t.match(/[^A-Za-z0-9+/=_-]/)[0];
    return { ok: false, why: `“${bad}” isn’t a Base64 character (A-Z, a-z, 0-9, + / or - _, and = at the end).` };
  }
  t = t.replace(/-/g, '+').replace(/_/g, '/');
  if (/=[^=]/.test(t)) return { ok: false, why: 'The = padding can only come at the end.' };
  t = t.replace(/=+$/, '');
  if (t.length % 4 === 1) return { ok: false, why: 'That is one character too many or too few to be Base64.' };
  t += '='.repeat((4 - (t.length % 4)) % 4);
  let bin;
  try { bin = atob(t); } catch (e) { return { ok: false, why: 'The browser couldn’t read that as Base64.' }; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes }; }
  catch (e) { return { ok: false, why: `That decodes to ${bytes.length} bytes that aren’t UTF-8 text (an image or other binary data, perhaps).`, bytes }; }
}
export const hexOf = (bytes, max = Infinity) => [...bytes.subarray(0, Math.min(bytes.length, max))].map(b => b.toString(16).padStart(2, '0')).join(' ');

/* ---------------- URL ---------------- */
export function urlEncode(text, { whole = false, form = false } = {}) {
  const s = whole ? encodeURI(String(text)) : encodeURIComponent(String(text));
  return form ? s.replace(/%20/g, '+') : s;
}
export function urlDecode(s, { whole = false, form = false } = {}) {
  let t = String(s);
  if (form) t = t.replace(/\+/g, ' ');
  try { return { ok: true, text: whole ? decodeURI(t) : decodeURIComponent(t) }; }
  catch (e) {
    return { ok: false, why: /%(?![0-9a-fA-F]{2})/.test(t) ? 'A % has to be followed by two hex digits (like %20).' : 'Those % codes don’t spell UTF-8 text.' };
  }
}
/** The query parameters of an absolute URL, decoded, or null. */
export function urlParts(text) {
  let u;
  try { u = new URL(String(text).trim()); } catch (e) { return null; }
  if (!/^[a-z][a-z0-9+.-]*:$/i.test(u.protocol)) return null;
  return { protocol: u.protocol, host: u.host, path: u.pathname, hash: u.hash, params: [...u.searchParams.entries()] };
}

/* ---------------- time ---------------- */
export const MAX_MS = 8.64e15;
/** -> { ok, ms, how } | { ok:false, why }. unit: 'auto' | 's' | 'ms' */
export function readTime(input, unit = 'auto') {
  const s = String(input).trim();
  if (!s) return { ok: false, why: '' };
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const digits = s.replace(/^[-+]/, '').split('.')[0].replace(/^0+/, '').length;
    const asMs = unit === 'ms' || (unit === 'auto' && digits >= 12);
    const ms = asMs ? n : n * 1000;
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) return { ok: false, why: 'That is outside the dates JavaScript can hold (about 275,000 years either side of 1970).' };
    return { ok: true, ms, how: asMs ? `read as milliseconds${unit === 'auto' ? ` (${digits} digits)` : ''}` : `read as seconds${unit === 'auto' ? ` (${digits} digits; 12 or more would be milliseconds)` : ''}` };
  }
  /* ISO 8601: a date, a date and time, with or without a zone */
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (!m) return { ok: false, why: 'Type a Unix timestamp (like 1793988000) or a date in ISO 8601 (like 2026-11-07 or 2026-11-07T14:30:00Z).' };
  const [, y, mo, d, hh, mi, ss, frac, zone] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || (hh && (+hh > 23 || +mi > 59 || (ss && +ss > 59)))) return { ok: false, why: 'That date or time doesn’t exist.' };
  let ms, how;
  const msPart = frac ? Math.round(Number(frac) * 1000) : 0;
  if (zone) {
    const z = zone.toUpperCase() === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    ms = Date.UTC(+y, +mo - 1, +d, +(hh || 0), +(mi || 0), +(ss || 0), msPart) - z * 60000;
    how = zone.toUpperCase() === 'Z' ? 'read as UTC' : `read with its offset ${zone}`;
  } else {
    const t = new Date(+y, +mo - 1, +d, +(hh || 0), +(mi || 0), +(ss || 0), msPart);
    ms = t.getTime();
    how = `no zone given, so read in this computer’s time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'})`;
  }
  const back = zone ? new Date(ms + (zone.toUpperCase() === 'Z' ? 0 : 0)) : new Date(ms);
  if (!zone && (back.getMonth() !== +mo - 1 || back.getDate() !== +d)) return { ok: false, why: 'That date doesn’t exist.' };
  if (zone && new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDate() !== +d) return { ok: false, why: 'That date doesn’t exist.' };
  return { ok: true, ms, how };
}
export function relative(ms, now = Date.now()) {
  const diff = ms - now, a = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps = [['year', 31557600000], ['month', 2629800000], ['week', 604800000], ['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]];
  for (const [u, n] of steps) if (a >= n || u === 'second') return rtf.format(Math.round(diff / n), u);
  return '';
}

/* ---------------- line diff (Myers) ---------------- */
export const DIFF_CAP = 20_000_000;           /* V-array cells kept for the backtrack: about 80 MB at most */
/** -> { ok, ops:[{ t:' '|'-'|'+', a, b, text }], added, removed, same } | { ok:false, why } */
export function diffLines(before, after, { ignoreCase = false, ignoreTrailing = false } = {}) {
  const A = String(before).split(/\r\n|\r|\n/), B = String(after).split(/\r\n|\r|\n/);
  const norm = s => { let t = ignoreTrailing ? s.replace(/[ \t]+$/, '') : s; return ignoreCase ? t.toLowerCase() : t; };
  const a = A.map(norm), b = B.map(norm);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x0 = pre, x1 = a.length - suf, y0 = pre, y1 = b.length - suf;
  const N = x1 - x0, M = y1 - y0, MAX = N + M;
  const mid = [];
  if (N || M) {
    const off = MAX + 1;
    const maxD = Math.max(1, Math.floor(DIFF_CAP / (2 * MAX + 2)));
    let V = new Int32Array(2 * MAX + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= MAX; d++) {
      if (d > maxD) return { ok: false, why: `These differ in more than ${maxD.toLocaleString()} places, more than this tab can compare in the memory it allows.` };
      trace.push(V.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[x0 + x] === b[y0 + y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
      if (found >= 0) break;
    }
    /* walk back through the saved V arrays */
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const v = trace[d], k = x - y;
      const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]);
      const pk = down ? k + 1 : k - 1;
      const px = v[off + pk], py = px - pk;
      while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) { mid.push([' ', x0 + x - 1, y0 + y - 1]); x--; y--; }
      if (down) { mid.push(['+', -1, y0 + y - 1]); y--; } else { mid.push(['-', x0 + x - 1, -1]); x--; }
    }
    while (x > 0 && y > 0) { mid.push([' ', x0 + x - 1, y0 + y - 1]); x--; y--; }
    mid.reverse();
  }
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ t: ' ', a: i, b: i, text: B[i] });
  for (const [t, ai, bi] of mid) ops.push({ t, a: ai, b: bi, text: t === '-' ? A[ai] : B[bi] });
  for (let i = 0; i < suf; i++) ops.push({ t: ' ', a: x1 + i, b: y1 + i, text: B[y1 + i] });
  let added = 0, removed = 0;
  for (const o of ops) { if (o.t === '+') added++; else if (o.t === '-') removed++; }
  return { ok: true, ops, added, removed, same: ops.length - added - removed };
}
/** The diff as unified-diff text (3 lines of context), the format patch and git read. */
export function unified(ops, ctx = 3, names = ['before', 'after']) {
  const out = [`--- ${names[0]}`, `+++ ${names[1]}`];
  const change = ops.map(o => o.t !== ' ');
  let i = 0;
  while (i < ops.length) {
    if (!change[i]) { i++; continue; }
    let s = Math.max(0, i - ctx), e = i;
    for (;;) {
      while (e < ops.length && change[e]) e++;
      let n = e;
      while (n < ops.length && !change[n] && n - e < ctx * 2) n++;
      if (n < ops.length && change[n]) { e = n; continue; }
      e = Math.min(ops.length, e + ctx);
      break;
    }
    const hunk = ops.slice(s, e);
    const aStart = hunk.find(o => o.a >= 0), bStart = hunk.find(o => o.b >= 0);
    const aN = hunk.filter(o => o.t !== '+').length, bN = hunk.filter(o => o.t !== '-').length;
    out.push(`@@ -${aN ? aStart.a + 1 : 0},${aN} +${bN ? bStart.b + 1 : 0},${bN} @@`);
    for (const o of hunk) out.push(o.t + o.text);
    i = e;
  }
  return out.join('\n') + '\n';
}

/* ---------------- JSON to CSV ---------------- */
export const CSV_MAX_ROWS = 100000, CSV_MAX_COLS = 500;
const guard = s => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
const quote = s => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** A raw number from the file, when JSON.parse would have changed its digits. */
export class RawNum { constructor(src) { this.src = src; } }
const cell = v => {
  if (v === null || v === undefined) return '';
  if (v instanceof RawNum) return v.src;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return quote(guard(v));
  return quote(guard(JSON.stringify(v, (k, x) => (x instanceof RawNum ? Number(x.src) : x))));
};
/** JSON.parse that keeps each number's own digits where they matter (browsers with the reviver's source text). */
export function parseExact(text) {
  return JSON.parse(text, function (k, v, ctx) {
    if (typeof v === 'number' && ctx && typeof ctx.source === 'string' && String(v) !== ctx.source) return new RawNum(ctx.source);
    return v;
  });
}
/** -> { ok, csv, rows, cols, cut } | { ok:false, why } */
export function toCsv(arr) {
  if (!Array.isArray(arr)) return { ok: false, why: 'Pick an array: CSV is rows, and only an array has them.' };
  if (!arr.length) return { ok: false, why: 'The array is empty, so there are no rows to write.' };
  const list = arr.slice(0, CSV_MAX_ROWS);
  const cut = arr.length - list.length;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNum);
  let lines;
  let cols = 0;
  if (list.every(isObj)) {
    const keys = [];
    const seen = new Set();
    for (const o of list) for (const k of Object.keys(o)) if (!seen.has(k) && keys.length < CSV_MAX_COLS) { seen.add(k); keys.push(k); }
    cols = keys.length;
    lines = [keys.map(k => quote(guard(k))).join(','), ...list.map(o => keys.map(k => cell(o[k])).join(','))];
  } else if (list.every(Array.isArray)) {
    cols = Math.min(CSV_MAX_COLS, Math.max(...list.map(r => r.length)));
    lines = list.map(r => r.slice(0, CSV_MAX_COLS).map(cell).join(','));
  } else {
    cols = 1;
    lines = ['value', ...list.map(cell)];
  }
  return { ok: true, csv: lines.join('\n') + '\n', rows: list.length, cols, cut };
}

export default { b64Encode, b64Decode, hexOf, urlEncode, urlDecode, urlParts, readTime, relative, diffLines, unified, toCsv, parseExact, RawNum };
