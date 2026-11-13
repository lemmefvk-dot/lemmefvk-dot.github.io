/* ============================================================
   zip.js — real ZIP archives, written and read in the browser.

   No library: the format is small. What is written is a plain
   PKZIP archive any computer opens — a local header before each
   entry, a central directory, the end record, CRC-32 checksums,
   DOS dates, the UTF-8 name flag (bit 11) and an entry for every
   folder ("Name/"). Entries are squeezed with the browser's own
   CompressionStream('deflate-raw'); an entry that would not get
   smaller, or a browser without the stream, stores it as is.

   Reading takes the same two methods (stored, deflate) through
   DecompressionStream('deflate-raw'). Anything else is refused by
   name with a plain reason: password-protected entries, ZIP64
   archives (over 4 GB or 65,535 entries), split archives and other
   compression methods. Each unpacked entry is checked against its
   CRC-32 and its stated size, and inflating stops the moment an
   entry grows past what it said it was — a zip bomb can't make
   it write more than the archive admits to.

     crc32(bytes, prev?)                    -> uint32
     makeZip(items, { onProgress })         -> { blob, count, deflated, stored, skipped }
       item: { name, dir?, date?, size?, read?: () => Promise<Uint8Array|Blob> }
       (a read() that throws a ZipError coded 'skip' leaves that item out)
     readZip(blob)                          -> { entries, comment }
       entry: { name, path, parts, dir, size, csize, method, crc, date,
                encrypted, problem }   (problem: why it can't be unpacked, or null)
     entryBytes(blob, entry)                -> Promise<Uint8Array>
     safeParts(name)                        -> ['a', 'b.txt'] | null (would escape)
   Errors are ZipError with .code and a sentence in .message.
   ============================================================ */

export const MAX_ENTRIES = 10000;              /* an archive listing more is refused */
export const MAX_TOTAL = 1024 * 1024 * 1024;   /* bytes one extraction may unpack */
const U32 = 0xFFFFFFFF;

export class ZipError extends Error {
  constructor(code, message) { super(message); this.name = 'ZipError'; this.code = code; }
}

/* ---------------- CRC-32 (IEEE 802.3, as ZIP uses it) ---------------- */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes, prev = 0) {
  let c = (prev ^ U32) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ U32) >>> 0;
}

/* ---------------- the browser's deflate ---------------- */
const streamOk = kind => {
  try { return typeof globalThis[kind] === 'function' && !!new globalThis[kind]('deflate-raw'); } catch (e) { return false; }
};
export const canDeflate = streamOk('CompressionStream');
export const canInflate = streamOk('DecompressionStream');

/* Big entries are handled in steps, so a progress bar can move and the
   page keeps answering while a large file is checksummed and squeezed. */
const STEP = 2 * 1024 * 1024;
const breathe = () => new Promise(r => setTimeout(r, 0));

async function crcSteps(bytes, onStep) {
  let c = 0;
  for (let o = 0; o < bytes.length; o += STEP) {
    c = crc32(bytes.subarray(o, o + STEP), c);
    if (bytes.length > STEP) { onStep(Math.min(bytes.length, o + STEP)); await breathe(); }
  }
  return c;
}

async function deflateRaw(bytes, onStep) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const out = new Response(cs.readable).arrayBuffer();
  out.catch(() => {});                     /* a failed write is what gets reported */
  for (let o = 0; o < bytes.length; o += STEP) {
    await writer.write(bytes.subarray(o, o + STEP));
    onStep?.(Math.min(bytes.length, o + STEP));
  }
  await writer.close();
  return new Uint8Array(await out);
}

/** Inflate, stopping as soon as the output passes `limit` bytes. */
async function inflateRaw(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new ZipError('bomb', 'It unpacks to more than the archive says it holds, so it was stopped.');
      chunks.push(value);
    }
  } catch (err) {
    try { await reader.cancel(); } catch (e) { /* already closed */ }
    if (err instanceof ZipError) throw err;
    throw new ZipError('damaged', 'Its compressed data is damaged.');
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/* Formats that are already compressed: deflating them costs time and
   saves nothing, so they go in stored. */
const PACKED = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'mp4', 'm4v', 'mov', 'webm', 'mkv',
  'ogv', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'weba', 'flac', 'zip', 'gz', '7z', 'rar', 'apk', 'woff', 'woff2', 'pdf']);
const extOf = name => { const b = name.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

/* ---------------- DOS dates ---------------- */
function dosTime(d) {
  const t = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const y = t.getFullYear();
  if (y < 1980) return { time: 0, date: (1 << 5) | 1 };                 /* 1980-01-01 00:00 */
  if (y > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate(),
  };
}
function fromDos(time, date) {
  const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ---------------- writing ---------------- */
const enc = new TextEncoder();

/**
 * Build a ZIP. items are written in order; a folder is { name: 'a/b/', dir: true }.
 * onProgress({ index, total, name, done, bytes }) runs before each entry
 * (done/bytes: input bytes handled so far / in all).
 */
export async function makeZip(items, { onProgress } = {}) {
  const list = Array.from(items || []);
  if (list.length > 0xFFFF) throw new ZipError('too-many', `That is ${list.length.toLocaleString()} items; a ZIP holds 65,535 at most without ZIP64, which StaticOS doesn’t write.`);
  const allBytes = list.reduce((a, it) => a + (it.dir ? 0 : Math.max(0, it.size || 0)), 0);
  const parts = [];            /* Blobs, so big archives can live outside the JS heap */
  const central = [];
  const skipped = [];
  let offset = 0, done = 0, deflated = 0, stored = 0;

  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const dir = !!it.dir;
    let name = String(it.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (dir && !name.endsWith('/')) name += '/';
    if (!name || name === '/') continue;
    try { onProgress?.({ index: i + 1, total: list.length, name, done, bytes: allBytes }); } catch (e) { /* a view that went away */ }

    let raw = new Uint8Array(0);
    if (!dir && it.read) {
      let got;
      try { got = await it.read(); }
      catch (err) {
        /* an item whose bytes can't be had is left out, by name, and the rest still go in */
        if (err?.code !== 'skip') throw err;
        skipped.push({ name, why: err.message });
        done += Math.max(0, it.size || 0);
        continue;
      }
      raw = got instanceof Blob ? new Uint8Array(await got.arrayBuffer()) : got instanceof Uint8Array ? got : new Uint8Array(got || 0);
    }
    /* progress inside one big entry: the checksum, then (when it is
       tried) the squeeze, each half of the way */
    const squeeze = !dir && raw.length > 0 && canDeflate && !PACKED.has(extOf(name));
    const step = (part, n) => {
      const share = squeeze ? (part + n / raw.length) / 2 : n / raw.length;
      try { onProgress?.({ index: i + 1, total: list.length, name, done: done + Math.round(share * raw.length), bytes: allBytes }); } catch (e) { /* gone */ }
    };
    const crc = dir ? 0 : await crcSteps(raw, n => step(0, n));
    let method = 0, data = raw;
    if (squeeze) {
      try {
        const z = await deflateRaw(raw, raw.length > STEP ? n => step(1, n) : null);
        if (z.length < raw.length) { method = 8; data = z; }
      } catch (e) { /* stored instead */ }
    }
    if (method === 8) deflated++; else if (!dir) stored++;
    if (raw.length >= U32 || offset + data.length + 30 >= U32) {
      throw new ZipError('too-big', 'The archive would pass 4 GB, which needs ZIP64 — StaticOS doesn’t write that.');
    }

    const nameBytes = enc.encode(name);
    const { time, date } = dosTime(it.date);
    const version = method === 8 || dir ? 20 : 10;
    const flags = 0x0800;                                    /* names are UTF-8 */

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, version, true);
    lh.setUint16(6, flags, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Blob([lh.buffer, nameBytes, data]));

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, (3 << 8) | 20, true);                    /* made by: Unix, spec 2.0 */
    ch.setUint16(6, version, true);
    ch.setUint16(8, flags, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);                               /* extra */
    ch.setUint16(32, 0, true);                               /* comment */
    ch.setUint16(34, 0, true);                               /* disk */
    ch.setUint16(36, 0, true);                               /* internal attributes */
    /* external: Unix mode in the high half, the MS-DOS folder bit for folders */
    ch.setUint32(38, dir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
    done += raw.length;
  }

  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const count = central.length / 2;
  if (offset + cdSize >= U32) throw new ZipError('too-big', 'The archive would pass 4 GB, which needs ZIP64 — StaticOS doesn’t write that.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, count, true);
  end.setUint16(10, count, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);
  try { onProgress?.({ index: list.length, total: list.length, name: '', done, bytes: allBytes }); } catch (e) { /* gone */ }
  return { blob: new Blob([...parts, ...central, end.buffer], { type: 'application/zip' }), deflated, stored, count, skipped };
}

/* ---------------- reading ---------------- */
/* names without the UTF-8 flag: valid UTF-8 is taken as UTF-8 (macOS
   writes it unflagged); anything else is the old DOS code page 437 */
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const utf8 = new TextDecoder('utf-8');
let strict = null;
try { strict = new TextDecoder('utf-8', { fatal: true }); } catch (e) { strict = null; }
function decodeName(bytes, flagged) {
  if (flagged) return utf8.decode(bytes);
  if (strict) { try { return strict.decode(bytes); } catch (e) { /* not UTF-8 */ } }
  let s = '';
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
  return s;
}

const METHODS = { 1: 'Shrink', 6: 'Implode', 9: 'Deflate64', 12: 'bzip2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd' };

/**
 * The path an entry may be unpacked to, as folder names: backslashes
 * count as separators, a drive letter or leading "/" is dropped (it
 * lands inside the target), and a ".." anywhere makes it unsafe (null).
 */
export function safeParts(name) {
  const s = String(name || '').replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '');
  const out = [];
  for (const raw of s.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') return null;
    const p = raw.replace(/[\u0000-\u001f\u007f]/g, '');
    if (!p || p === '.' || p === '..') return null;
    out.push(p);
  }
  return out;
}

async function bytesAt(blob, start, len) {
  return new Uint8Array(await blob.slice(start, start + len).arrayBuffer());
}

/** Read an archive's table of contents. Throws ZipError when it can't be read at all. */
export async function readZip(blob) {
  if (!(blob instanceof Blob)) throw new ZipError('missing', 'There are no bytes to read.');
  const size = blob.size;
  if (size < 22) throw new ZipError('not-zip', 'It is too small to be a ZIP archive.');
  const tailLen = Math.min(size, 22 + 0xFFFF);
  const tail = await bytesAt(blob, size - tailLen, tailLen);
  const tv = new DataView(tail.buffer);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50 && i + 22 + tv.getUint16(i + 20, true) <= tail.length) { at = i; break; }
  }
  if (at < 0) throw new ZipError('not-zip', 'It isn’t a ZIP archive, or its end is missing (it may have been cut short).');
  const eocd = size - tailLen + at;
  const disk = tv.getUint16(at + 4, true), cdDisk = tv.getUint16(at + 6, true);
  const count = tv.getUint16(at + 10, true);
  const cdSize = tv.getUint32(at + 12, true), cdOff = tv.getUint32(at + 16, true);
  const comment = utf8.decode(tail.subarray(at + 22, at + 22 + tv.getUint16(at + 20, true)));
  const zip64 = (at >= 20 && tv.getUint32(at - 20, true) === 0x07064b50)
    || count === 0xFFFF || cdSize === U32 || cdOff === U32;
  if (zip64) throw new ZipError('zip64', 'It is a ZIP64 archive (made for archives over 4 GB or 65,535 files), which StaticOS can’t open.');
  if (disk !== 0 || cdDisk !== 0) throw new ZipError('split', 'It is one part of a split archive, which StaticOS can’t open.');
  if (count > MAX_ENTRIES) throw new ZipError('too-many', `It lists ${count.toLocaleString()} entries; StaticOS opens archives of up to ${MAX_ENTRIES.toLocaleString()}.`);
  /* bytes stuck on the front (a self-extractor) move every offset along */
  const shift = eocd - cdSize - cdOff;
  if (shift < 0) throw new ZipError('damaged', 'Its table of contents points outside the file — it is damaged.');
  const cd = await bytesAt(blob, cdOff + shift, cdSize);
  const v = new DataView(cd.buffer);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipError('damaged', 'Its table of contents is damaged.');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const time = v.getUint16(p + 12, true), date = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const ext = v.getUint32(p + 38, true);
    const off = v.getUint32(p + 42, true);
    if (p + 46 + nl > cd.length) throw new ZipError('damaged', 'Its table of contents is damaged.');
    const name = decodeName(cd.subarray(p + 46, p + 46 + nl), !!(flags & 0x0800));
    p += 46 + nl + xl + cl;

    const dir = /[/\\]$/.test(name) || (!!(ext & 0x10) && usize === 0);
    const parts = safeParts(name);
    const encrypted = !!(flags & 1) || method === 99;
    let problem = null;
    if (!parts || !parts.length) problem = 'Its name points outside the folder, so it was left out.';
    else if (encrypted) problem = 'It is password-protected (encrypted), which StaticOS can’t unpack.';
    else if (csize === U32 || usize === U32 || off === U32) problem = 'It needs ZIP64, which StaticOS can’t unpack.';
    else if (!dir && method !== 0 && method !== 8) problem = `It uses ${METHODS[method] || `compression method ${method}`}, which StaticOS can’t unpack.`;
    else if (!dir && method === 8 && !canInflate) problem = 'This browser can’t unpack deflated files.';
    entries.push({
      name, parts: parts || [], path: parts ? parts.join('/') : '', dir, size: usize, csize, method, crc, flags,
      date: fromDos(time, date), offset: off + shift, encrypted, problem,
    });
  }
  return { entries, comment };
}

/** One entry's bytes, checked against its CRC-32 and size. */
export async function entryBytes(blob, entry) {
  if (entry.problem) throw new ZipError('skip', entry.problem);
  if (entry.dir) return new Uint8Array(0);
  const lh = await bytesAt(blob, entry.offset, 30);
  const lv = new DataView(lh.buffer);
  if (lh.length < 30 || lv.getUint32(0, true) !== 0x04034b50) throw new ZipError('damaged', 'Its data is missing from the archive — it is damaged.');
  const start = entry.offset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  if (start + entry.csize > blob.size) throw new ZipError('damaged', 'Its data runs past the end of the archive — it is damaged or cut short.');
  const packed = await bytesAt(blob, start, entry.csize);
  let out;
  if (entry.method === 0) {
    if (entry.csize !== entry.size) throw new ZipError('damaged', 'Its stored size doesn’t match — the archive is damaged.');
    out = packed;
  } else {
    out = await inflateRaw(packed, entry.size);
  }
  if (out.length !== entry.size) throw new ZipError('damaged', 'It unpacked to a different size than the archive says — it is damaged.');
  if (crc32(out) !== entry.crc) throw new ZipError('damaged', 'Its checksum doesn’t match — the archive is damaged.');
  return out;
}

export default { crc32, makeZip, readZip, entryBytes, safeParts, canDeflate, canInflate, MAX_ENTRIES, MAX_TOTAL, ZipError };
