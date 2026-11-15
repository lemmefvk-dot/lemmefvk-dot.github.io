/* ============================================================
   tags.js — read a song's own title, artist, album and cover art
   out of the file's bytes. No library, no network: just the formats'
   published layouts.

     ID3v2.2 / 2.3 / 2.4 (and ID3v1 as a last resort)   .mp3 and friends
     MP4 / M4A atoms  (moov › udta › meta › ilst)       .m4a .mp4 .aac
     FLAC and Ogg Vorbis / Opus comments (Vorbis comment blocks, and
       FLAC PICTURE / METADATA_BLOCK_PICTURE for the cover)
     RIFF WAVE  LIST › INFO                              .wav

   readTags(blob) -> { title, artist, album, year, track, format, cover } | null
     Every text field is '' when the file does not say. `cover` is null or
     { mime, blob() } — blob() hands back the picture as a Blob (a slice of
     the file when it can be, so a library full of covers is never read
     until one is shown).
   The reader only looks at the first part of a file (and, for MP4, the
   atoms that lead to the tag), never the whole song, and it never throws:
   a file that is damaged or untagged simply gives null.
   ============================================================ */

const MAX_TAG = 16 * 1024 * 1024;           /* a tag bigger than this is not read */
const WINDOW = 64 * 1024;

/* ---------------- a small random-access reader over a Blob ---------------- */
function reader(blob) {
  let off = 0, buf = null;
  return {
    size: blob.size,
    /** bytes [at, at+len) as a Uint8Array (shorter at the end of the file) */
    async get(at, len) {
      if (at < 0 || len <= 0 || at >= blob.size) return new Uint8Array(0);
      len = Math.min(len, blob.size - at);
      if (!buf || at < off || at + len > off + buf.length) {
        const want = Math.min(blob.size - at, Math.max(len, WINDOW));
        buf = new Uint8Array(await blob.slice(at, at + want).arrayBuffer());
        off = at;
      }
      return buf.subarray(at - off, at - off + len);
    },
    slice: (a, b, type) => blob.slice(a, b, type),
  };
}

const be32 = (u, i) => ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0;
const le32 = (u, i) => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;
const syncsafe = (u, i) => ((u[i] & 0x7f) << 21) | ((u[i + 1] & 0x7f) << 14) | ((u[i + 2] & 0x7f) << 7) | (u[i + 3] & 0x7f);
const ascii = (u, a, b) => { let s = ''; for (let i = a; i < b && i < u.length; i++) s += String.fromCharCode(u[i]); return s; };

function tidy(s) {
  return String(s || '').replace(/\u0000+$/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
const dec = (label, u) => { try { return new TextDecoder(label).decode(u); } catch (e) { return ''; } };

/** ID3 text in its declared encoding: 0 Latin-1, 1 UTF-16 (BOM), 2 UTF-16BE, 3 UTF-8. */
function text(enc, u) {
  if (enc === 1) {
    if (u.length >= 2 && u[0] === 0xff && u[1] === 0xfe) return dec('utf-16le', u.subarray(2));
    if (u.length >= 2 && u[0] === 0xfe && u[1] === 0xff) return dec('utf-16be', u.subarray(2));
    return dec('utf-16le', u);
  }
  if (enc === 2) return dec('utf-16be', u);
  if (enc === 3) return dec('utf-8', u);
  return dec('latin1', u);
}
/** index of the end of a null-terminated string in the given encoding (single or double byte) */
function termAt(u, from, enc) {
  const wide = enc === 1 || enc === 2;
  for (let i = from; i < u.length; i += wide ? 2 : 1) {
    if (u[i] === 0 && (!wide || u[i + 1] === 0)) return i;
  }
  return u.length;
}

/* ---------------- ID3v2 ---------------- */
const ID3_TEXT = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album',
  TDRC: 'year', TYER: 'year', TYE: 'year', TRCK: 'track', TRK: 'track', TPE2: 'albumArtist', TP2: 'albumArtist',
};

async function id3v2(rd, blob) {
  const head = await rd.get(0, 10);
  if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return null;
  const major = head[3], flags = head[5];
  const size = syncsafe(head, 6);
  if (major < 2 || major > 4 || size > MAX_TAG) return null;
  const unsyncAll = (flags & 0x80) !== 0 && major < 4;
  let ext = 0;
  /* an extended header sits between the tag header and the first frame */
  if (flags & 0x40) {
    const eh = await rd.get(10, 6);
    if (eh.length >= 4) ext = major === 4 ? syncsafe(eh, 0) : be32(eh, 0) + 4;
  }
  let data = null, at, limit, get;
  if (unsyncAll) {
    /* de-unsynchronised copy: offsets are then inside the copy, not the file */
    const raw = new Uint8Array(await blob.slice(10, 10 + size).arrayBuffer());
    const out2 = new Uint8Array(raw.length);
    let n = 0;
    for (let i = 0; i < raw.length; i++) { if (raw[i] === 0 && i > 0 && raw[i - 1] === 0xff) continue; out2[n++] = raw[i]; }
    data = out2.subarray(0, n);
    at = ext; limit = n;
    get = async (a, l) => data.subarray(a, a + l);
  } else {
    at = 10 + ext; limit = 10 + size;
    get = (a, l) => rd.get(a, l);
  }
  const out = { cover: null }, covers = [];
  const idLen = major === 2 ? 3 : 4, hdrLen = major === 2 ? 6 : 10;
  while (at + hdrLen <= limit) {
    const h = await get(at, hdrLen);
    if (h.length < hdrLen || h[0] === 0) break;                  /* padding */
    const id = ascii(h, 0, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = major === 2 ? (h[3] << 16) | (h[4] << 8) | h[5] : major === 4 ? syncsafe(h, 4) : be32(h, 4);
    const fl = major === 2 ? 0 : (h[8] << 8) | h[9];
    const body = at + hdrLen;
    if (len < 0 || body + len > limit) break;
    const key = ID3_TEXT[id];
    let skip = 0;
    if (major === 4 && (fl & 0x0001)) skip = 4;                  /* data length indicator */
    const frameUnsync = major === 4 && (fl & 0x0002) !== 0;
    if (key && len > 1 && len < 4096 && !(fl & 0x000c) ) {       /* not compressed / encrypted */
      let b = await get(body + skip, len - skip);
      if (frameUnsync) b = b.filter((v, i) => !(v === 0 && i > 0 && b[i - 1] === 0xff));
      const enc = b[0];
      const parts = [];
      let p = 1;
      while (p < b.length) {
        const e = termAt(b, p, enc);
        const s = tidy(text(enc, b.subarray(p, e)));
        if (s) parts.push(s);
        p = e + (enc === 1 || enc === 2 ? 2 : 1);
      }
      if (parts.length && !out[key]) out[key] = key === 'artist' ? parts.join(', ') : parts[0];
    } else if ((id === 'APIC' || id === 'PIC') && len > 16 && !(fl & 0x000c) && !frameUnsync) {
      const b = await get(body + skip, Math.min(len - skip, 512));
      const enc = b[0];
      let p = 1, mime;
      if (major === 2) { const f = ascii(b, 1, 4).toUpperCase(); mime = f === 'PNG' ? 'image/png' : f === 'GIF' ? 'image/gif' : 'image/jpeg'; p = 4; }
      else { const e = termAt(b, 1, 0); mime = ascii(b, 1, e).toLowerCase(); p = e + 1; }
      const pic = b[p];
      const e2 = termAt(b, p + 1, enc);
      const dataAt = e2 + (enc === 1 || enc === 2 ? 2 : 1);
      if (!/^image\//.test(mime)) mime = sniffImage(b.subarray(dataAt)) || 'image/jpeg';
      if (mime === 'image/jpg') mime = 'image/jpeg';
      if (len - skip > dataAt) {
        const abs = body + skip + dataAt, n = len - skip - dataAt;
        covers.push({ pic, mime, make: () => (data ? new Blob([data.subarray(abs, abs + n)], { type: mime }) : rd.slice(abs, abs + n, mime)) });
      }
    }
    at = body + len;
  }
  const front = covers.find(c => c.pic === 3) || covers[0];
  if (front) out.cover = { mime: front.mime, blob: async () => front.make() };
  return { ...out, format: 'ID3v2.' + major, tagEnd: 10 + size };
}

function id3v1(u) {
  if (u.length < 128 || ascii(u, u.length - 128, u.length - 125) !== 'TAG') return null;
  const f = (a, b) => tidy(dec('latin1', u.subarray(u.length - 128 + a, u.length - 128 + b)));
  const o = { title: f(3, 33), artist: f(33, 63), album: f(63, 93), year: f(93, 97), format: 'ID3v1', cover: null };
  return o.title || o.artist || o.album ? o : null;
}

function sniffImage(u) {
  if (u.length > 3 && u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
  if (u.length > 7 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return 'image/png';
  if (u.length > 3 && ascii(u, 0, 3) === 'GIF') return 'image/gif';
  if (u.length > 12 && ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

/* ---------------- Vorbis comments (FLAC, Ogg Vorbis, Opus) ---------------- */
function vorbisComments(u, start) {
  const out = {};
  let p = start;
  if (p + 4 > u.length) return out;
  p += 4 + le32(u, p);                                   /* vendor string */
  if (p + 4 > u.length) return out;
  const n = le32(u, p); p += 4;
  const pics = [];
  for (let i = 0; i < n && p + 4 <= u.length; i++) {
    const len = le32(u, p); p += 4;
    if (len > u.length - p) break;
    const s = dec('utf-8', u.subarray(p, p + len));
    p += len;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1);
    if (k === 'METADATA_BLOCK_PICTURE') pics.push(v);
    else if (k === 'TITLE' && !out.title) out.title = tidy(v);
    else if (k === 'ARTIST' && !out.artist) out.artist = tidy(v);
    else if (k === 'ALBUM' && !out.album) out.album = tidy(v);
    else if (k === 'ALBUMARTIST' && !out.albumArtist) out.albumArtist = tidy(v);
    else if ((k === 'DATE' || k === 'YEAR') && !out.year) out.year = tidy(v).slice(0, 10);
    else if (k === 'TRACKNUMBER' && !out.track) out.track = tidy(v);
  }
  out.pics = pics;
  return out;
}
/** FLAC picture block body -> { mime, type, data } */
function flacPicture(u) {
  if (u.length < 32) return null;
  const type = be32(u, 0);
  const ml = be32(u, 4);
  const mime = ascii(u, 8, 8 + ml).toLowerCase();
  let p = 8 + ml;
  const dl = be32(u, p); p += 4 + dl;
  p += 16;                                               /* width, height, depth, colours */
  const n = be32(u, p); p += 4;
  if (p + n > u.length) return null;
  return { type, mime: /^image\//.test(mime) ? mime : sniffImage(u.subarray(p)) || 'image/jpeg', at: p, n };
}
function fromPictureBlock(u) {
  const f = flacPicture(u);
  return f ? { type: f.type, mime: f.mime, make: () => new Blob([u.subarray(f.at, f.at + f.n)], { type: f.mime }) } : null;
}
function bestPicture(list) {
  const c = list.find(x => x && x.type === 3) || list.find(Boolean);
  return c ? { mime: c.mime, blob: async () => c.make() } : null;
}

async function flac(rd, blob, at) {
  let p = at + 4;
  const out = { format: 'FLAC', cover: null };
  const pics = [];
  for (let guard = 0; guard < 64; guard++) {
    const h = await rd.get(p, 4);
    if (h.length < 4) break;
    const last = (h[0] & 0x80) !== 0, type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4 && len < MAX_TAG) {
      const body = await rd.get(p + 4, len);
      Object.assign(out, { ...vorbisComments(body, 0), pics: undefined });
    } else if (type === 6 && len < MAX_TAG) {
      /* the picture is described by where it lies, not copied: it can be megabytes */
      const hdr = pictureHeader(await rd.get(p + 4, Math.min(len, 4096)));
      const abs = p + 4 + (hdr ? hdr.at : 0);
      if (hdr) pics.push({ type: hdr.type, mime: hdr.mime, make: () => rd.slice(abs, abs + hdr.n, hdr.mime) });
    }
    p += 4 + len;
    if (last) break;
  }
  out.cover = bestPicture(pics);
  return out;
}
/** the layout of a PICTURE block, from just its first bytes (the picture data itself can be megabytes) */
function pictureHeader(u) {
  if (u.length < 32) return null;
  const type = be32(u, 0);
  const ml = be32(u, 4);
  if (8 + ml + 4 > u.length) return null;
  let p = 8 + ml;
  const dl = be32(u, p); p += 4 + dl + 16;
  if (p + 4 > u.length) return null;
  const n = be32(u, p); p += 4;
  const mime = ascii(u, 8, 8 + ml).toLowerCase();
  return { type, mime: /^image\//.test(mime) ? mime : 'image/jpeg', at: p, n };
}

/* ---------------- Ogg ---------------- */
async function ogg(rd, blob) {
  /* gather the packets of the first few pages until the comment packet is whole */
  let p = 0;
  const packets = [];
  let cur = [], curLen = 0;
  for (let page = 0; page < 400 && packets.length < 2; page++) {
    const h = await rd.get(p, 27);
    if (h.length < 27 || ascii(h, 0, 4) !== 'OggS') break;
    const nseg = h[26];
    const seg = await rd.get(p + 27, nseg);
    let dataAt = p + 27 + nseg;
    for (let i = 0; i < nseg; i++) {
      const l = seg[i];
      if (curLen + l > MAX_TAG) return null;
      if (packets.length >= 1) cur.push([dataAt, l]);        /* the first packet is the stream's identification header */
      curLen += l;
      dataAt += l;
      if (l < 255) {
        packets.push(cur.length ? cur : []);
        cur = []; curLen = 0;
        if (packets.length >= 2) break;
      }
    }
    p = dataAt;
  }
  if (packets.length < 2 || !packets[1].length) return null;
  const parts = [];
  for (const [a, l] of packets[1]) parts.push(await rd.get(a, l).then(x => x.slice()));
  const u = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { u.set(x, o); o += x.length; }
  let start = -1, fmt = '';
  if (u[0] === 3 && ascii(u, 1, 7) === 'vorbis') { start = 7; fmt = 'Ogg Vorbis'; }
  else if (ascii(u, 0, 8) === 'OpusTags') { start = 8; fmt = 'Opus'; }
  if (start < 0) return null;
  const c = vorbisComments(u, start);
  const pics = [];
  for (const b64 of c.pics || []) {
    try {
      const bin = atob(b64.replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pic = fromPictureBlock(bytes);
      if (pic) pics.push(pic);
    } catch (e) { /* a bad picture is skipped */ }
  }
  return { ...c, pics: undefined, format: fmt, cover: bestPicture(pics) };
}

/* ---------------- MP4 / M4A ---------------- */
async function atomAt(rd, at, end) {
  const h = await rd.get(at, 16);
  if (h.length < 8) return null;
  let size = be32(h, 0);
  const type = ascii(h, 4, 8);
  let hdr = 8;
  if (size === 1 && h.length >= 16) { size = be32(h, 8) * 4294967296 + be32(h, 12); hdr = 16; }
  else if (size === 0) size = end - at;
  if (size < hdr || at + size > end) return size >= hdr && at + hdr <= end ? { type, at, hdr, size: end - at } : null;
  return { type, at, hdr, size };
}
function atomsIn(u, from, to, base) {
  const out = [];
  let p = from;
  while (p + 8 <= to) {
    let size = be32(u, p);
    const type = ascii(u, p + 4, p + 8);
    let hdr = 8;
    if (size === 1 && p + 16 <= to) { size = be32(u, p + 8) * 4294967296 + be32(u, p + 12); hdr = 16; }
    else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) break;
    out.push({ type, from: p + hdr, to: p + size, at: base + p + hdr });
    p += size;
  }
  return out;
}
async function mp4(rd) {
  let at = 0;
  const end = rd.size;
  let moov = null;
  for (let guard = 0; guard < 64 && at < end; guard++) {
    const a = await atomAt(rd, at, end);
    if (!a) break;
    if (a.type === 'moov') { moov = a; break; }
    at += a.size;
  }
  if (!moov || moov.size > MAX_TAG) return null;
  const u = (await rd.get(moov.at, moov.size)).slice();
  const find = (list, t) => list.find(x => x.type === t);
  const udta = find(atomsIn(u, moov.hdr, u.length, 0), 'udta');
  if (!udta) return null;
  const meta = find(atomsIn(u, udta.from, udta.to, 0), 'meta');
  if (!meta) return null;
  const ilst = find(atomsIn(u, meta.from + 4, meta.to, 0), 'ilst');       /* meta is a full box: 4 bytes of version and flags */
  if (!ilst) return null;
  const out = { format: 'MP4', cover: null };
  for (const item of atomsIn(u, ilst.from, ilst.to, 0)) {
    const d = find(atomsIn(u, item.from, item.to, 0), 'data');
    if (!d || d.to - d.from < 8) continue;
    const payload = u.subarray(d.from + 8, d.to);
    const kind = be32(u, d.from) & 0xffffff;
    if (item.type === '©nam') out.title = tidy(dec('utf-8', payload));
    else if (item.type === '©ART') out.artist = tidy(dec('utf-8', payload));
    else if (item.type === 'aART' && !out.albumArtist) out.albumArtist = tidy(dec('utf-8', payload));
    else if (item.type === '©alb') out.album = tidy(dec('utf-8', payload));
    else if (item.type === '©day') out.year = tidy(dec('utf-8', payload)).slice(0, 10);
    else if (item.type === 'covr' && !out.cover) {
      const mime = kind === 14 ? 'image/png' : kind === 13 ? 'image/jpeg' : sniffImage(payload) || 'image/jpeg';
      const abs = moov.at + d.from + 8;
      out.cover = { mime, blob: async () => rd.slice(abs, abs + payload.length, mime) };
    }
  }
  return out;
}

/* ---------------- WAV (LIST › INFO) ---------------- */
async function wav(rd) {
  const out = { format: 'WAV', cover: null };
  let at = 12;
  for (let guard = 0; guard < 200 && at + 8 <= rd.size; guard++) {
    const h = await rd.get(at, 12);
    if (h.length < 8) break;
    const id = ascii(h, 0, 4), len = le32(h, 4);
    if (id === 'LIST' && ascii(h, 8, 12) === 'INFO' && len < 65536) {
      const b = await rd.get(at + 12, len - 4);
      let p = 0;
      while (p + 8 <= b.length) {
        const k = ascii(b, p, p + 4), l = le32(b, p + 4);
        const v = tidy(dec('utf-8', b.subarray(p + 8, p + 8 + l)));
        if (k === 'INAM') out.title = v; else if (k === 'IART') out.artist = v; else if (k === 'IPRD') out.album = v;
        p += 8 + l + (l & 1);
      }
      return out;
    }
    at += 8 + len + (len & 1);
  }
  return out;
}

/* ---------------- the front door ---------------- */
const clean = o => {
  if (!o) return null;
  const r = { title: o.title || '', artist: o.artist || o.albumArtist || '', album: o.album || '', year: o.year || '', track: o.track || '',
    format: o.format || '', cover: o.cover || null };
  return r.title || r.artist || r.album || r.cover ? r : null;
};

export async function readTags(blob) {
  try {
    if (!blob || !blob.size || typeof blob.slice !== 'function') return null;
    const rd = reader(blob);
    const head = await rd.get(0, 16);
    if (head.length < 8) return null;
    const sig4 = ascii(head, 0, 4);
    if (sig4 === 'RIFF') return clean(await wav(rd));
    if (sig4 === 'OggS') return clean(await ogg(rd, blob));
    if (sig4 === 'fLaC') return clean(await flac(rd, blob, 0));
    if (ascii(head, 4, 8) === 'ftyp') return clean(await mp4(rd));
    if (sig4.startsWith('ID3')) {
      const t = await id3v2(rd, blob);
      /* some FLAC files carry an ID3 tag in front of the fLaC marker */
      if (t && ascii(await rd.get(t.tagEnd, 4), 0, 4) === 'fLaC') return clean({ ...(await flac(rd, blob, t.tagEnd)), ...pickText(t) });
      if (t && (t.title || t.artist || t.album || t.cover)) return clean(t);
    }
    /* ID3v1 sits in the last 128 bytes */
    const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - 128)).arrayBuffer());
    return clean(id3v1(tail));
  } catch (e) {
    return null;
  }
}
const pickText = t => ({ title: t.title, artist: t.artist, album: t.album, cover: t.cover });

export default { readTags };
