/* ============================================================
   qr.js — Static QR: a QR code generator that never leaves the
   device.

   ENCODER (this file, no library, no network)
   A complete QR Code Model 2 encoder, written to ISO/IEC 18004:
   · data: one segment in the densest mode the whole text allows —
     numeric, alphanumeric, or byte mode carrying UTF-8 (no ECI, the
     way every mainstream generator and reader handles UTF-8);
   · the smallest version (1–40) that holds it at the chosen error-
     correction level (L/M/Q/H), terminator + 0xEC/0x11 padding;
   · Reed–Solomon error correction over GF(256) (x⁸+x⁴+x³+x²+1,
     generator roots α⁰…αⁿ⁻¹), split into the standard blocks and
     interleaved codeword by codeword;
   · finder, separator, timing and alignment patterns, the dark
     module, BCH(15,5) format information (masked with 0x5412) and
     BCH(18,6) version information for version 7 and up;
   · all eight data masks, each scored with the four standard
     penalty rules (runs, 2×2 blocks, finder look-alikes counted
     with the quiet zone as light, dark/light balance); the lowest
     score wins.
   It was checked module-for-module against libqrencode for every
   version and level, and read back with a real barcode reader.

   APP
   Seven kinds of content (text, link, Wi-Fi, email, phone, SMS,
   contact) build the exact text that is encoded; the "Encoded
   text" disclosure shows it verbatim. The preview is a <canvas>
   drawn at devicePixelRatio with every module edge on a whole
   device pixel, so it is crisp at any zoom. Size, quiet zone, error
   correction and colours are adjustable; colours are graded for
   scanning (reflectance difference, ISO/IEC 15415 grades) and a
   light-on-dark code is called out, because many readers can't
   see inverted codes. Where the browser has a barcode reader
   (BarcodeDetector), the exact pixels are read back and the result
   is shown — and nothing is claimed where it doesn't.

   Scan reads a QR code with the camera or from a picture (js/apps/qr-scan.js,
   js/core/scancam.js): a decoded code is shown as text and never opened by
   itself; only http and https links get an Open button.

   Download PNG / SVG, copy the image, or save it to Pictures (a
   real file via core/media.js, so Photos opens it). "Recent" lists
   only codes you exported; a Wi-Fi password is never written to
   storage. State lives in store('portal.qr').
   ============================================================ */
import { defineApp } from '../core/registry.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-qr-css')) {
  const l = document.createElement('link');
  l.id = 'feat-qr-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-qr.css';
  document.head.appendChild(l);
}

/* ====================================================================
   QR encoder
   ==================================================================== */

export const QR_LEVELS = ['L', 'M', 'Q', 'H'];
const LEVEL_ROW = { L: 0, M: 1, Q: 2, H: 3 };          /* row in the tables below */
const LEVEL_FORMAT = { L: 1, M: 0, Q: 3, H: 2 };       /* the 2 format-info bits */

/* ISO/IEC 18004 Table 9, per level and version (index 0 unused):
   error-correction codewords in each block, and how many blocks. */
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MODE_BITS = { numeric: 0b0001, alnum: 0b0010, byte: 0b0100 };
const CC_BITS = { numeric: [10, 12, 14], alnum: [9, 11, 13], byte: [8, 16, 16] };
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const RE_NUMERIC = /^[0-9]+$/;
const RE_ALNUM = /^[0-9A-Z $%*+\-./:]+$/;

const ccBits = (mode, ver) => CC_BITS[mode][ver <= 9 ? 0 : ver <= 26 ? 1 : 2];

/** Modules left for data + ECC once every function pattern is placed
    (remainder bits included). */
export function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
export const dataCodewords = (ver, level) =>
  Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[LEVEL_ROW[level]][ver] * NUM_BLOCKS[LEVEL_ROW[level]][ver];

/** Centre coordinates of the alignment patterns (Annex E), e.g. v7 → [6, 22, 38]. */
export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/* ---- GF(256) and Reed–Solomon --------------------------------------- */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

const genCache = new Map();
/** (x − α⁰)(x − α¹)…(x − αⁿ⁻¹), coefficients highest degree first. */
function rsGenerator(n) {
  if (genCache.has(n)) return genCache.get(n);
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], GF_EXP[i]);
    }
    g = next;
  }
  genCache.set(n, g);
  return g;
}
/** The n ECC codewords: remainder of data·xⁿ divided by the generator. */
export function rsEcc(data, n) {
  const g = rsGenerator(n);
  const rem = new Array(n).fill(0);
  for (const byte of data) {
    const f = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    if (f) for (let i = 0; i < n; i++) rem[i] ^= gfMul(g[i + 1], f);
  }
  return rem;
}

/* ---- BCH codes for format and version information ------------------- */
/** 15-bit format word for a level and mask, already XOR-masked with 0x5412. */
export function formatBits(level, mask) {
  const data = (LEVEL_FORMAT[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
/** 18-bit version word (versions 7–40). */
export function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

/* ---- data segment ---------------------------------------------------- */
const utf8 = s => new TextEncoder().encode(s);

/** The densest single mode that can carry all of `text`. */
export function pickMode(text) {
  if (RE_NUMERIC.test(text)) return 'numeric';
  if (RE_ALNUM.test(text)) return 'alnum';
  return 'byte';
}

function makeSegment(text, forceMode) {
  const mode = forceMode || pickMode(text);
  if (mode === 'numeric') {
    if (!RE_NUMERIC.test(text)) throw new Error('numeric mode needs digits only');
    const n = text.length;
    return { mode, count: n, text, bitLen: Math.floor(n / 3) * 10 + [0, 4, 7][n % 3] };
  }
  if (mode === 'alnum') {
    if (!RE_ALNUM.test(text)) throw new Error('alphanumeric mode needs 0-9 A-Z space $%*+-./:');
    const n = text.length;
    return { mode, count: n, text, bitLen: Math.floor(n / 2) * 11 + (n % 2) * 6 };
  }
  const bytes = utf8(text);
  return { mode: 'byte', count: bytes.length, bytes, text, bitLen: bytes.length * 8 };
}

/** How many characters (or bytes) of `mode` a version holds at a level. */
export function capacity(mode, ver, level) {
  const bits = dataCodewords(ver, level) * 8 - 4 - ccBits(mode, ver);
  let n;
  if (mode === 'byte') n = Math.floor(bits / 8);
  else if (mode === 'alnum') n = Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  else n = Math.floor(bits / 10) * 3 + (bits % 10 >= 7 ? 2 : bits % 10 >= 4 ? 1 : 0);
  return Math.min(n, 2 ** ccBits(mode, ver) - 1);
}

function fits(seg, ver, level) {
  const cc = ccBits(seg.mode, ver);
  return seg.count < 2 ** cc && 4 + cc + seg.bitLen <= dataCodewords(ver, level) * 8;
}

/* ---- the whole symbol ------------------------------------------------- */
/**
 * encodeQR(text, { level, mask, mode, minVersion })
 *  -> { ok:true, version, size, level, mask, mode, count, capacity, modules, penalties }
 *     modules: Uint8Array(size*size), row-major, 1 = dark
 *  -> { ok:false, reason:'empty'|'too-long', mode, count, max }
 * `mask` (0–7) forces a mask instead of choosing by penalty; `mode`
 * forces 'byte' | 'alnum' | 'numeric'. Both exist for testing.
 */
export function encodeQR(text, opts = {}) {
  const level = QR_LEVELS.includes(opts.level) ? opts.level : 'M';
  const str = String(text ?? '');
  if (!str.length) return { ok: false, reason: 'empty', mode: 'byte', count: 0, max: capacity('byte', 40, level) };
  const seg = makeSegment(str, opts.mode);

  let ver = Math.max(1, Math.min(40, opts.minVersion | 0 || 1));
  while (ver <= 40 && !fits(seg, ver, level)) ver++;
  if (ver > 40) return { ok: false, reason: 'too-long', mode: seg.mode, count: seg.count, max: capacity(seg.mode, 40, level) };

  /* -- bit stream -- */
  const capBits = dataCodewords(ver, level) * 8;
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(MODE_BITS[seg.mode], 4);
  put(seg.count, ccBits(seg.mode, ver));
  if (seg.mode === 'numeric') {
    for (let i = 0; i < seg.text.length; i += 3) {
      const chunk = seg.text.slice(i, i + 3);
      put(parseInt(chunk, 10), chunk.length * 3 + 1);
    }
  } else if (seg.mode === 'alnum') {
    const t = seg.text;
    let i = 0;
    for (; i + 1 < t.length; i += 2) put(ALNUM.indexOf(t[i]) * 45 + ALNUM.indexOf(t[i + 1]), 11);
    if (i < t.length) put(ALNUM.indexOf(t[i]), 6);
  } else {
    for (const b of seg.bytes) put(b, 8);
  }
  put(0, Math.min(4, capBits - bits.length));            /* terminator */
  put(0, (8 - (bits.length % 8)) % 8);                   /* byte-align */
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  /* -- blocks, ECC, interleave -- */
  const row = LEVEL_ROW[level];
  const nBlocks = NUM_BLOCKS[row][ver];
  const eccLen = ECC_PER_BLOCK[row][ver];
  const rawCw = Math.floor(rawDataModules(ver) / 8);
  const nShort = nBlocks - (rawCw % nBlocks);
  const shortLen = Math.floor(rawCw / nBlocks);          /* data + ECC in a short block */
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen - eccLen + (i < nShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    blocks.push({ dat, ecc: rsEcc(dat, eccLen) });
  }
  const codewords = [];
  for (let i = 0; i <= shortLen - eccLen; i++) for (const b of blocks) if (i < b.dat.length) codewords.push(b.dat[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) codewords.push(b.ecc[i]);

  /* -- function patterns -- */
  const size = ver * 4 + 17;
  const mod = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const setF = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };

  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setF(x, y, d !== 2 && d !== 4);                  /* 4 = separator ring */
      }
    }
  }
  const ap = alignmentPositions(ver);
  for (let i = 0; i < ap.length; i++) {
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const drawFormat = mask => {
    const f = formatBits(level, mask);
    const bit = i => (f >>> i) & 1;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6));
    setF(8, 8, bit(7));
    setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, 1);                                  /* the dark module */
  };
  drawFormat(0);                                           /* reserve the area */
  if (ver >= 7) {
    const v = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = (v >>> i) & 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setF(a, b, dark);
      setF(b, a, dark);
    }
  }

  /* -- data, in the two-column zigzag from the bottom-right -- */
  const totalBits = codewords.length * 8;
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                            /* skip the vertical timing column */
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y * size + x] || bi >= totalBits) continue;
        mod[y * size + x] = (codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1;
        bi++;
      }
    }
  }                                                        /* remainder bits stay 0 */

  /* -- masks -- */
  const applyMask = m => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (fn[y * size + x]) continue;
        let inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv) mod[y * size + x] ^= 1;
      }
    }
  };

  const penalties = [];
  let mask = Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7 ? opts.mask : -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penaltyScore(mod, size);
      penalties.push(p);
      if (p < best) { best = p; mask = m; }
      applyMask(m);                                        /* XOR again = undo */
    }
  }
  applyMask(mask);
  drawFormat(mask);

  return {
    ok: true, version: ver, size, level, mask, mode: seg.mode, count: seg.count,
    capacity: capacity(seg.mode, ver, level), modules: mod, penalties,
  };
}

/* The four penalty rules (ISO/IEC 18004 §7.8.3). N3 looks for the
   1:1:3:1:1 finder shape with 4 light modules on one side, counting the
   quiet zone outside the symbol as light. */
export function penaltyScore(mod, size) {
  let score = 0;
  const hist = [0, 0, 0, 0, 0, 0, 0];
  const push = run => {
    if (hist[0] === 0) run += size;                        /* light border before the first run */
    hist.pop();
    hist.unshift(run);
  };
  const finders = () => {
    const n = hist[1];
    const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
    return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
  };
  for (let pass = 0; pass < 2; pass++) {                   /* rows, then columns */
    for (let a = 0; a < size; a++) {
      let color = 0, run = 0;
      hist.fill(0);
      for (let b = 0; b < size; b++) {
        const m = pass === 0 ? mod[a * size + b] : mod[b * size + a];
        if (m === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          push(run);
          if (!color) score += finders() * 40;
          color = m;
          run = 1;
        }
      }
      if (color) { push(run); run = 0; }                   /* close a trailing dark run */
      push(run + size);                                    /* light border after the last run */
      score += finders() * 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = mod[y * size + x];
      if (c === mod[y * size + x + 1] && c === mod[(y + 1) * size + x] && c === mod[(y + 1) * size + x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (let i = 0; i < mod.length; i++) dark += mod[i];
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Paint a code onto a square canvas of `px` device pixels. Every module
    edge is rounded to a whole pixel from the same function, so adjacent
    modules share edges exactly: crisp, and no hairline seams. */
export function drawCode(ctx, q, px, margin, fg, bg) {
  const n = q.size + margin * 2;
  const scale = px / n;
  const edge = i => Math.round(i * scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = fg;
  for (let y = 0; y < q.size; y++) {
    const y0 = edge(y + margin), y1 = edge(y + margin + 1);
    for (let x = 0; x < q.size;) {
      if (!q.modules[y * q.size + x]) { x++; continue; }
      let x2 = x + 1;
      while (x2 < q.size && q.modules[y * q.size + x2]) x2++;
      const x0 = edge(x + margin);
      ctx.fillRect(x0, y0, edge(x2 + margin) - x0, y1 - y0);
      x = x2;
    }
  }
}

/** The same code as an SVG document (one path, module units). */
export function svgCode(q, px, margin, fg, bg) {
  const n = q.size + margin * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size;) {
      if (!q.modules[y * q.size + x]) { x++; continue; }
      let x2 = x + 1;
      while (x2 < q.size && q.modules[y * q.size + x2]) x2++;
      d += `M${x + margin} ${y + margin}h${x2 - x}v1h-${x2 - x}z`;
      x = x2;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="${bg}"/><path fill="${fg}" d="${d}"/></svg>\n`;
}

/* ====================================================================
   Colour: how well will a scanner tell the two colours apart?
   ==================================================================== */
export function normHex(s) {
  let t = String(s || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(t) ? `#${t.toUpperCase()}` : null;
}
function luminance(hex) {
  const v = parseInt(hex.slice(1), 16);
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
}
/** Symbol contrast = the reflectance gap between light and dark modules
    (relative luminance as the reflectance proxy), graded with the
    ISO/IEC 15415 thresholds: A ≥ 70 %, B ≥ 55 %, C ≥ 40 %, D ≥ 20 %. */
export function contrastInfo(fg, bg) {
  const dark = luminance(fg), light = luminance(bg);
  const sc = Math.abs(light - dark) * 100;
  const grade = sc >= 70 ? 'A' : sc >= 55 ? 'B' : sc >= 40 ? 'C' : sc >= 20 ? 'D' : 'F';
  return { sc, grade, inverted: dark > light };
}

/* ====================================================================
   What each kind of code encodes
   ==================================================================== */
const KINDS = [
  { id: 'text', label: 'Text', icon: 'type', empty: 'Type some text and its code appears here.' },
  { id: 'link', label: 'Link', icon: 'link', empty: 'Type or paste a web address.' },
  { id: 'wifi', label: 'Wi-Fi', icon: 'wifi', empty: 'Enter the network name to make a join-this-network code.' },
  { id: 'email', label: 'Email', icon: 'mail', empty: 'Enter an address, a subject or a message.' },
  { id: 'phone', label: 'Phone', icon: 'phone', empty: 'Enter a phone number to make a tap-to-call code.' },
  { id: 'sms', label: 'SMS', icon: 'message-circle', empty: 'Enter the number the message goes to.' },
  { id: 'contact', label: 'Contact', icon: 'user', empty: 'Enter a name, phone number or email.' },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.id, k]));

const FIELDS = {
  text: { text: '' },
  link: { url: '' },
  wifi: { ssid: '', security: 'WPA', hidden: false },       /* the password is never stored */
  email: { to: '', subject: '', body: '' },
  phone: { number: '' },
  sms: { number: '', message: '' },
  contact: { first: '', last: '', phone: '', email: '', org: '', title: '', url: '' },
};
const LONG = { text: 8000, body: 4000, message: 2000 };
const SECURITY = [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP (old)'], ['nopass', 'None — open network']];

/* schemes that may be followed by digits, so "tel:123" isn't read as host:port */
const KNOWN_SCHEME = /^(tel|sms|smsto|mms|mmsto|fax|callto|facetime|facetime-audio|geo|mailto|matmsg|mecard|wifi|bitcoin|magnet):/i;
const hasScheme = u => KNOWN_SCHEME.test(u) || (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[^:/?#]+:\d+(?:[/?#]|$)/.test(u));
const escWifi = s => String(s).replace(/[\\;,:"]/g, ch => `\\${ch}`);
const escVcard = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const oneLine = s => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** -> { text, display, label, notes:[{tone,text}] }. `text` is exactly what is encoded. */
export function buildPayload(kind, f, secret = {}) {
  const notes = [];
  const out = (text, label, display) => ({ text, display: display ?? text, label: clip(oneLine(label || ''), 60), notes });
  switch (kind) {
    case 'link': {
      const u = f.url.trim();
      if (!u) return out('', '');
      if (/\s/.test(u)) notes.push({ tone: 'warn', text: 'Web addresses can’t contain spaces — a phone may cut the link at the first one.' });
      if (hasScheme(u)) return out(u, u.replace(/^https?:\/\//i, ''));
      notes.push({ tone: 'info', text: 'https:// is added so phones open it as a link.' });
      return out(`https://${u}`, u);
    }
    case 'wifi': {
      if (!f.ssid) return out('', '');
      const T = f.security === 'WEP' || f.security === 'nopass' ? f.security : 'WPA';
      const pass = String(secret.wifiPass || '');
      let s = `WIFI:S:${escWifi(f.ssid)};T:${T};`;
      let shown = s;
      if (T !== 'nopass' && pass) {
        s += `P:${escWifi(pass)};`;
        shown += `P:${secret.showPass ? escWifi(pass) : '•'.repeat(Math.min(12, pass.length))};`;
      }
      if (f.hidden) { s += 'H:true;'; shown += 'H:true;'; }
      if (T !== 'nopass' && !pass) notes.push({ tone: 'warn', text: 'No password entered — phones will ask for it when they join.' });
      if (T !== 'nopass' && pass) notes.push({ tone: 'info', text: 'Anyone who scans this code can join the network.' });
      return out(`${s};`, f.ssid, `${shown};`);
    }
    case 'email': {
      const list = f.to.split(',').map(a => a.trim()).filter(Boolean);    /* several recipients: a@x.com, b@y.com */
      const to = list.join(',');
      if (!to && !f.subject && !f.body) return out('', '');
      const q = [];
      if (f.subject) q.push(`subject=${encodeURIComponent(f.subject)}`);
      if (f.body) q.push(`body=${encodeURIComponent(f.body.replace(/\r?\n/g, '\r\n'))}`);
      if (list.some(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) notes.push({ tone: 'warn', text: list.length > 1 ? 'One of those doesn’t look like an email address.' : 'That doesn’t look like an email address.' });
      if (!to) notes.push({ tone: 'info', text: 'No address — the phone opens a new email and asks who it’s to.' });
      return out(`mailto:${to}${q.length ? `?${q.join('&')}` : ''}`, to || f.subject || 'Email');
    }
    case 'phone': {
      const num = f.number.replace(/[\s().-]/g, '');
      if (!num) return out('', '');
      if (!/^\+?[0-9*#,;]{3,}$/.test(num)) notes.push({ tone: 'warn', text: 'Phone numbers are digits, with an optional + at the start.' });
      return out(`tel:${num}`, f.number);
    }
    case 'sms': {
      const num = f.number.replace(/[\s().-]/g, '');
      if (!num) {
        if (f.message) notes.push({ tone: 'warn', text: 'Add the number the message goes to.' });
        return out('', '');
      }
      if (!/^\+?[0-9*#]{3,}$/.test(num)) notes.push({ tone: 'warn', text: 'Phone numbers are digits, with an optional + at the start.' });
      return out(`SMSTO:${num}:${f.message}`, f.number);
    }
    case 'contact': {
      const first = f.first.trim(), last = f.last.trim(), org = f.org.trim(), title = f.title.trim();
      const phone = f.phone.trim(), email = f.email.trim(), url = f.url.trim();
      const full = [first, last].filter(Boolean).join(' ');
      if (!full && !org && !phone && !email) return out('', '');
      const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escVcard(last)};${escVcard(first)};;;`, `FN:${escVcard(full || org || phone || email)}`];
      if (org) L.push(`ORG:${escVcard(org)}`);
      if (title) L.push(`TITLE:${escVcard(title)}`);
      if (phone) L.push(`TEL;TYPE=CELL:${escVcard(phone)}`);
      if (email) L.push(`EMAIL:${escVcard(email)}`);
      if (url) L.push(`URL:${url.replace(/\s+/g, '')}`);
      L.push('END:VCARD');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) notes.push({ tone: 'warn', text: 'That doesn’t look like an email address.' });
      return out(L.join('\r\n'), full || org || phone || email);
    }
    default: {
      const t = String(f.text || '');
      return out(t.trim() ? t : '', t.split('\n').find(l => l.trim()) || '');
    }
  }
}

/* ====================================================================
   App
   ==================================================================== */
const STORE_KEY = 'portal.qr';
const APP = 'Static QR';
const NARROW = 640;                       /* below this painted width: one column */
const SIZE_MIN = 128, SIZE_MAX = 2048, SIZE_STEP = 16, SIZE_DEFAULT = 512;
const MARGIN_MAX = 10, MARGIN_DEFAULT = 4;
const FG_DEFAULT = '#000000', BG_DEFAULT = '#FFFFFF';
const RECENT_MAX = 8;

const LEVEL_INFO = {
  L: { pct: '7%', text: 'Recovers about 7% of a damaged code. The smallest code.' },
  M: { pct: '15%', text: 'Recovers about 15% of a damaged code. A good default.' },
  Q: { pct: '25%', text: 'Recovers about 25%. For prints that may get scuffed.' },
  H: { pct: '30%', text: 'Recovers about 30%. The densest code.' },
};
const MODE_LABEL = { byte: 'Byte · UTF-8', alnum: 'Alphanumeric', numeric: 'Numeric' };
const MODE_UNIT = { byte: ['byte', 'bytes'], alnum: ['character', 'characters'], numeric: ['digit', 'digits'] };
const fmtN = n => Number(n).toLocaleString('en-US');

/* two glyphs the OS icon set doesn't have, drawn the same way (24-grid strokes) */
const EXTRA_ICONS = {
  mail: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M22 7l-10 6.5L2 7'],
  phone: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'],
};

const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const rid = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---- shape guards: the store is the only input, treat it as untrusted ---- */
function normFields(kind, raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, dflt] of Object.entries(FIELDS[kind])) {
    out[k] = typeof dflt === 'boolean' ? !!o[k] : String(o[k] ?? dflt).slice(0, LONG[k] || 500);
  }
  if (kind === 'wifi' && !SECURITY.some(([v]) => v === out.security)) out.security = 'WPA';
  return out;
}
function normRecent(r) {
  if (!r || typeof r !== 'object' || !KIND[r.kind]) return null;
  if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
  return { id: String(r.id || rid()).slice(0, 40), kind: r.kind, label: String(r.label || '').slice(0, 80), fields: normFields(r.kind, r.fields), at: r.at };
}
function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const fields = {};
  for (const k of Object.keys(FIELDS)) fields[k] = normFields(k, d.fields && d.fields[k]);
  return {
    kind: KIND[d.kind] ? d.kind : 'text',
    level: QR_LEVELS.includes(d.level) ? d.level : 'M',
    size: Math.round(clampInt(d.size, SIZE_MIN, SIZE_MAX, SIZE_DEFAULT) / SIZE_STEP) * SIZE_STEP,
    margin: clampInt(d.margin, 0, MARGIN_MAX, MARGIN_DEFAULT),
    fg: normHex(d.fg) || FG_DEFAULT,
    bg: normHex(d.bg) || BG_DEFAULT,
    fields,
    recent: Array.isArray(d.recent) ? d.recent.map(normRecent).filter(Boolean).slice(0, RECENT_MAX) : [],
  };
}

defineApp({
  id: 'qr',
  name: APP,
  icon: 'grid',
  g1: '#82c431', g2: '#267812',
  category: 'Utilities',
  keywords: ['qr', 'qr code', 'qrcode', 'barcode', 'code', 'generator', 'link', 'url', 'wifi', 'wi-fi', 'share',
    'scan', 'scan qr', 'qr scanner', 'qr reader', 'read qr', 'camera', 'vcard', 'contact', 'sms', 'email', 'phone'],
  desc: 'Make QR codes for links, text, Wi-Fi and contacts, or scan one with your camera — all on this device',
  singleton: true,
  win: { w: 920, h: 620, minW: 420, minH: 460 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, notify, menu, confirm } = api;
    const uid = `qr${Math.random().toString(36).slice(2, 8)}`;
    const canRead = typeof window.BarcodeDetector === 'function';
    const saveKey = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘S' : 'Ctrl+S';

    const S = {
      ...normalize(store.get(STORE_KEY)),
      wifiPass: '',            /* memory only, gone when the window closes */
      showPass: false,
      narrow: false,
      dead: false,
      saving: false,
      payload: buildPayload('text', FIELDS.text),
      result: null,
      encKey: null,
      check: 'idle',           /* idle | checking | ok | mismatch | none | error */
      checkSeq: 0,
      shape: '',               /* ok | empty | too-long — announce on change only */
      heard: { check: '', contrast: '' },
      present: null,
      scanning: false, scanSeq: 0, scanDown: null,
    };

    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms); timers.add(t); return t; };
    const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };
    const urls = new Set();

    const glyph = name => (EXTRA_ICONS[name]
      ? h('span.icon', { 'data-icon': name }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, EXTRA_ICONS[name].map(d => h('path', { d }))))
      : icon(name));

    /* ---------------- persistence ---------------- */
    let persistT = 0;
    const snapshot = () => ({
      v: 1, kind: S.kind, level: S.level, size: S.size, margin: S.margin, fg: S.fg, bg: S.bg,
      fields: Object.fromEntries(Object.keys(FIELDS).map(k => [k, { ...S.fields[k] }])),
      recent: S.recent.map(r => ({ ...r, fields: { ...r.fields } })),
    });
    function persistSoon() { cancel(persistT); persistT = later(() => { persistT = 0; store.set(STORE_KEY, snapshot()); }, 350); }

    /* ---------------- screen-reader announcements ---------------- */
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    function say(text) { if (!text) return; live.textContent = ''; live.textContent = text; }

    /* ==================================================================
       layout
       ================================================================== */
    const kindBtns = {}, chipBtns = {};
    const sideCreate = h('div.side__group', h('div.side__label', { id: `${uid}-create`, text: 'Create' }),
      KINDS.map(k => (kindBtns[k.id] = h('button.side__item.qr-kind', { type: 'button', onclick: () => setKind(k.id) },
        glyph(k.icon), h('span', { text: k.label })))));
    const scanSide = h('button.side__item.qr-kind.qr-scan-btn', { type: 'button', dataset: { fk: 'qr-scan' }, onclick: () => setScan(!S.scanning) },
      icon('camera'), h('span', { text: 'Scan a code' }));
    const sideRead = h('div.side__group', h('div.side__label', { text: 'Read' }), scanSide);
    const recentGroup = h('div.side__group.qr-side__recent');
    const side = h('aside.app__side.qr-side', { 'aria-label': 'Kinds of code' },
      sideCreate, sideRead, recentGroup,
      h('div.qr-side__foot', icon('lock'), h('span', { text: 'Made on this device. Nothing is uploaded.' })));

    const chipRecent = h('button.chip.qr-chip', { type: 'button', hidden: true, 'aria-haspopup': 'menu', onclick: e => openRecentMenu(e) },
      icon('clock'), h('span', { text: 'Recent' }));
    const chips = h('div.qr-kinds', { role: 'group', 'aria-label': 'Kind of code' },
      KINDS.map(k => (chipBtns[k.id] = h('button.chip.qr-chip', { type: 'button', onclick: () => setKind(k.id) }, glyph(k.icon), h('span', { text: k.label })))),
      chipRecent);
    const chipScan = h('button.chip.qr-chip.qr-scan-chip', { type: 'button', dataset: { fk: 'qr-scan-chip' }, onclick: () => setScan(!S.scanning) },
      icon('camera'), h('span', { text: 'Scan' }));
    chips.insertBefore(chipScan, chipRecent);

    /* ---- bar ---- */
    const titleEl = h('div.app__title.qr-title');
    const presentBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Show large', 'aria-label': 'Show the code large, to scan from this screen', onclick: () => openPresent() }, icon('expand'));
    const moreBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'More', 'aria-label': 'More ways to export', 'aria-haspopup': 'menu', onclick: e => openMore(e) }, icon('more-horizontal'));
    const dlBtn = h('button.btn.btn--sm.qr-dl', { type: 'button', title: 'Download as PNG', 'aria-label': 'Download PNG', onclick: () => downloadPng() }, icon('download'), h('span.qr-dl__t', { text: 'PNG' }));
    const saveBtn = h('button.btn.btn--sm.btn--primary.qr-save', { type: 'button', title: `Save to Pictures (${saveKey})`, 'aria-label': 'Save to Pictures', onclick: () => saveToPictures() },
      icon('image'), h('span.qr-save__long', { text: 'Save to Pictures' }), h('span.qr-save__short', { text: 'Save' }));
    const bar = h('div.app__bar.qr-bar', titleEl, h('span.qr-grow'), presentBtn, moreBtn, dlBtn, saveBtn);

    /* ---- content: the fields for the current kind ---- */
    const formFields = h('div.qr-fields');
    const notesEl = h('div.qr-notes');
    const rawN = h('span.qr-raw__n');
    const rawPre = h('pre.qr-raw__pre.mono');
    const rawEl = h('details.qr-raw', h('summary', h('span', { text: 'Encoded text' }), rawN), rawPre);
    const formSec = h('section.qr-sec.qr-form', { 'aria-labelledby': `${uid}-content` },
      h('h2.qr-sec__label', { id: `${uid}-content`, text: 'Content' }), formFields, notesEl, rawEl);

    /* ---- appearance ---- */
    const levelInputs = {};
    const levelSeg = h('div.qr-seg', { role: 'radiogroup', 'aria-labelledby': `${uid}-lvl` },
      QR_LEVELS.map(L => {
        const inp = h('input.qr-seg__in', { type: 'radio', name: `${uid}-level`, value: L, 'aria-label': `Level ${L}, recovers about ${LEVEL_INFO[L].pct}`, onchange: () => setLevel(L) });
        levelInputs[L] = inp;
        return h('label.qr-seg__opt', inp, h('span.qr-seg__face', h('b', { text: L }), h('small', { text: LEVEL_INFO[L].pct })));
      }));
    const levelHint = h('small.qr-hint');

    const sizeIn = h('input.slider.qr-range', { id: `${uid}-size`, type: 'range', min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, oninput: e => setSize(e.target.value) });
    const sizeOut = h('output.qr-val', { for: `${uid}-size` });
    const sizeNote = h('small.qr-hint');
    const marginIn = h('input.slider.qr-range', { id: `${uid}-margin`, type: 'range', min: 0, max: MARGIN_MAX, step: 1, oninput: e => setMargin(e.target.value) });
    const marginOut = h('output.qr-val', { for: `${uid}-margin` });
    const marginNote = h('small.qr-hint');

    const colorRow = which => {
      const lbl = which === 'fg' ? 'Dark' : 'Light';
      const long = which === 'fg' ? 'Dark modules colour' : 'Light modules and margin colour';
      const pick = h('input.qr-swatch', { type: 'color', 'aria-label': long, oninput: e => setColor(which, e.target.value, pick) });
      const hex = h('input.qr-hex.mono', {
        type: 'text', maxlength: '7', spellcheck: 'false', autocomplete: 'off', 'aria-label': `${long}, hex`,
        oninput: e => { const v = normHex(e.target.value); if (v) setColor(which, v, hex); },
        onblur: e => { e.target.value = S[which]; },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.value = S[which]; } },
      });
      return { pick, hex, el: h('div.qr-color', pick, h('div.qr-color__t', h('small', { text: lbl }), hex)) };
    };
    const fgRow = colorRow('fg'), bgRow = colorRow('bg');
    const contrastEl = h('div.qr-contrast');

    const lookSec = h('section.qr-sec.qr-look', { 'aria-labelledby': `${uid}-look` },
      h('h2.qr-sec__label', { id: `${uid}-look`, text: 'Appearance' }),
      h('div.qr-group', h('div.qr-row', h('span.qr-lbl', { id: `${uid}-lvl`, text: 'Error correction' })), levelSeg, levelHint),
      h('div.qr-group',
        h('div.qr-row', h('label.qr-lbl', { for: `${uid}-size`, text: 'Image size' }), sizeOut),
        sizeIn, sizeNote),
      h('div.qr-group',
        h('div.qr-row', h('label.qr-lbl', { for: `${uid}-margin`, text: 'Margin (quiet zone)' }), marginOut),
        marginIn, marginNote),
      h('div.qr-group',
        h('div.qr-row', h('span.qr-lbl', { text: 'Colours' })),
        h('div.qr-colors', fgRow.el, bgRow.el,
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Swap', 'aria-label': 'Swap the two colours', onclick: () => { const f = S.fg; S.fg = S.bg; S.bg = f; colorsChanged(); } }, icon('refresh')),
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Black on white', 'aria-label': 'Reset to black on white', onclick: () => { S.fg = FG_DEFAULT; S.bg = BG_DEFAULT; colorsChanged(); } }, icon('rotate-ccw'))),
        contrastEl));

    /* ---- preview stage ---- */
    const canvas = h('canvas.qr-canvas', { role: 'img' });
    const box = h('div.qr-box', canvas);
    const emptyEl = h('div.qr-emptywrap');
    const view = h('div.qr-view', box, emptyEl);
    const meta = h('dl.qr-meta');
    const checkEl = h('div.qr-check', { hidden: true });
    const stage = h('section.qr-stage', { 'aria-label': 'Preview' }, view, h('div.qr-under', meta, checkEl));

    const left = h('div.qr-left', formSec, lookSec);
    const body = h('div.app__content.app__content--flush.qr-body', left, stage);
    const scanHost = h('div.qr-scanhost', { hidden: true });
    const appEl = h('div.app.qr', side, h('div.app__main', bar, chips, body, scanHost), live);
    root.appendChild(appEl);

    /* ==================================================================
       fields
       ================================================================== */
    function setField(key, value) {
      S.fields[S.kind] = { ...S.fields[S.kind], [key]: value };
      persistSoon();
      schedule();
    }
    function input(key, label, o = {}) {
      const id = `${uid}-f-${key}`;
      const el = o.area
        ? h('textarea.qr-in.qr-in--area', { id, rows: String(o.rows || 4), maxlength: String(LONG[key] || 500), placeholder: o.placeholder || null, spellcheck: o.spell ? 'true' : 'false' })
        : h('input.qr-in', { id, type: o.type || 'text', maxlength: String(o.max || 500), placeholder: o.placeholder || null, inputmode: o.mode || null, autocomplete: o.auto || 'off', spellcheck: 'false' });
      el.value = S.fields[S.kind][key];
      el.addEventListener('input', () => setField(key, el.value));
      return h('div.qr-field', h('label.qr-field__label', { for: id, text: label }),
        h(`div.field${o.area ? '.qr-field__area' : ''}`, el), o.hint ? h('small.qr-hint', { text: o.hint }) : null);
    }

    function renderForm() {
      clear(formFields);
      const f = S.fields[S.kind];
      switch (S.kind) {
        case 'link':
          formFields.append(input('url', 'Web address', { type: 'url', mode: 'url', placeholder: 'example.com/page', max: 2000 }));
          break;
        case 'wifi': {
          const passId = `${uid}-f-pass`, secId = `${uid}-f-sec`, hidId = `${uid}-f-hid`;
          const pass = h('input.qr-in', { id: passId, type: S.showPass ? 'text' : 'password', maxlength: '128', autocomplete: 'off', spellcheck: 'false' });
          pass.value = S.wifiPass;
          pass.addEventListener('input', () => { S.wifiPass = pass.value; schedule(); });
          const eye = h('button.ibtn.qr-eye', {
            type: 'button', 'aria-label': 'Show password', 'aria-pressed': S.showPass ? 'true' : 'false', class: S.showPass ? 'is-on' : '',
            onclick: () => {
              S.showPass = !S.showPass;
              pass.type = S.showPass ? 'text' : 'password';
              eye.setAttribute('aria-pressed', S.showPass ? 'true' : 'false');
              eye.classList.toggle('is-on', S.showPass);
              schedule();
            },
          }, icon('eye'));
          const passField = h('div.qr-field', h('label.qr-field__label', { for: passId, text: 'Password' }), h('div.field', pass, eye),
            h('small.qr-hint', { text: 'Kept only while this window is open — never saved.' }));
          const sec = h('select.select.qr-select', {
            id: secId,
            onchange: () => { setField('security', sec.value); passField.hidden = sec.value === 'nopass'; },
          }, SECURITY.map(([v, t]) => h('option', { value: v, text: t })));
          sec.value = f.security;
          passField.hidden = f.security === 'nopass';
          const sw = h('button.switch', {
            id: hidId, type: 'button', role: 'switch', 'aria-checked': f.hidden ? 'true' : 'false', 'aria-label': 'Hidden network', class: f.hidden ? 'is-on' : '',
            onclick: () => { const on = !S.fields.wifi.hidden; sw.classList.toggle('is-on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); setField('hidden', on); },
          });
          formFields.append(
            input('ssid', 'Network name (SSID)', { max: 64, placeholder: 'My network' }),
            h('div.qr-field', h('label.qr-field__label', { for: secId, text: 'Security' }), sec),
            passField,
            h('div.qr-field.qr-field--row', h('label.qr-field__label', { for: hidId, text: 'Hidden network' }), sw));
          break;
        }
        case 'email':
          formFields.append(
            input('to', 'To', { type: 'email', mode: 'email', placeholder: 'name@example.com', max: 320 }),
            input('subject', 'Subject', { max: 300 }),
            input('body', 'Message', { area: true, rows: 4, spell: true }));
          break;
        case 'phone':
          formFields.append(input('number', 'Phone number', { type: 'tel', mode: 'tel', placeholder: '+1 555 010 0199', max: 40 }));
          break;
        case 'sms':
          formFields.append(
            input('number', 'Send to', { type: 'tel', mode: 'tel', placeholder: '+1 555 010 0199', max: 40 }),
            input('message', 'Message', { area: true, rows: 4, spell: true }));
          break;
        case 'contact':
          formFields.append(
            h('div.qr-pair', input('first', 'First name', { max: 100 }), input('last', 'Last name', { max: 100 })),
            input('phone', 'Phone', { type: 'tel', mode: 'tel', max: 40 }),
            input('email', 'Email', { type: 'email', mode: 'email', max: 320 }),
            h('div.qr-pair', input('org', 'Company', { max: 120 }), input('title', 'Job title', { max: 120 })),
            input('url', 'Website', { type: 'url', mode: 'url', max: 500 }));
          break;
        default:
          formFields.append(input('text', 'Text', { area: true, rows: 6, spell: true, placeholder: 'Type anything — a note, a code, an address…' }));
      }
    }

    /* ==================================================================
       state changes
       ================================================================== */
    /* Scan: the camera side, loaded the first time it is asked for */
    async function setScan(on) {
      if (on === S.scanning || S.dead) return;
      S.scanning = on;
      const seq = ++S.scanSeq;
      for (const x of [body, presentBtn, moreBtn, dlBtn, saveBtn]) x.hidden = on;
      scanHost.hidden = !on;
      if (S.scanDown) { try { S.scanDown(); } catch (e) { console.error(e); } S.scanDown = null; }
      scanHost.replaceChildren();
      paintKinds();
      if (!on) return;
      try {
        const m = await import('./qr-scan.js');
        if (S.dead || seq !== S.scanSeq || !S.scanning) return;
        S.scanDown = m.mountScan({ api, root: scanHost });
      } catch (err) {
        if (S.dead || seq !== S.scanSeq) return;
        scanHost.replaceChildren(h('div.qrs__msg', icon('alert'), h('b', { text: 'Scan couldn’t load' }), h('small', { text: String(err?.message || err) })));
      }
    }
    function setKind(id) {
      if (!KIND[id]) return;
      if (S.scanning) setScan(false);
      if (id !== S.kind) {
        S.kind = id;
        S.showPass = false;
        renderForm();
        persistSoon();
        schedule();
      }
      paintKinds();
    }
    function setLevel(L) {
      if (!QR_LEVELS.includes(L)) return;
      S.level = L;
      paintLevel();
      persistSoon();
      schedule();
    }
    function setSize(v) {
      S.size = clampInt(v, SIZE_MIN, SIZE_MAX, SIZE_DEFAULT);
      paintLook();
      paintMeta();
      persistSoon();
      scheduleCheck();
    }
    function setMargin(v) {
      S.margin = clampInt(v, 0, MARGIN_MAX, MARGIN_DEFAULT);
      paintLook();
      paintStage();
      persistSoon();
      scheduleCheck();
    }
    function setColor(which, value, from) {
      const v = normHex(value);
      if (!v || v === S[which]) return;
      S[which] = v;
      colorsChanged(from);
    }
    function colorsChanged(from) {
      paintColors(from);
      paintStage();
      persistSoon();
      scheduleCheck();
    }

    /* ==================================================================
       painting
       ================================================================== */
    function paintKinds() {
      for (const k of KINDS) {
        const on = k.id === S.kind && !S.scanning;
        for (const b of [kindBtns[k.id], chipBtns[k.id]]) {
          b.classList.toggle('is-on', on);
          if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        }
      }
      titleEl.textContent = S.scanning ? 'Scan a code' : KIND[S.kind].label;
      scanSide.classList.toggle('is-on', !!S.scanning);
      chipScan.classList.toggle('is-on', !!S.scanning);
      if (S.scanning) { scanSide.setAttribute('aria-current', 'true'); chipScan.setAttribute('aria-current', 'true'); }
      else { scanSide.removeAttribute('aria-current'); chipScan.removeAttribute('aria-current'); }
      /* keep the chosen chip in view without scrolling anything else */
      const c = chipBtns[S.kind];
      if (S.narrow && c.offsetParent) {
        const l = c.offsetLeft - chips.offsetLeft, r = l + c.offsetWidth;
        if (l < chips.scrollLeft) chips.scrollLeft = l - 12;
        else if (r > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = r - chips.clientWidth + 12;
      }
    }
    function paintLevel() {
      levelInputs[S.level].checked = true;
      levelHint.textContent = LEVEL_INFO[S.level].text;
    }
    function exportPx(q) { return Math.max(S.size, q ? q.size + 2 * S.margin : 0); }
    function paintLook() {
      sizeIn.value = String(S.size);
      marginIn.value = String(S.margin);
      marginOut.textContent = `${S.margin} module${S.margin === 1 ? '' : 's'}`;
      marginIn.setAttribute('aria-valuetext', marginOut.textContent);
      marginNote.textContent = S.margin < 4 ? 'Scanners expect 4 modules of margin. With less, a code on a busy background can be missed.' : '';
      marginNote.classList.toggle('is-warn', S.margin < 4);
      const q = S.result?.ok ? S.result : null;
      const px = exportPx(q);
      sizeOut.textContent = `${px} px`;
      sizeIn.setAttribute('aria-valuetext', `${px} pixels`);
      let note = '', warn = false;
      if (q) {
        const n = q.size + 2 * S.margin;
        const per = px / n;
        if (S.size < n) { note = `Raised to ${n} px so every module gets a pixel.`; warn = true; }
        else if (per < 3) { note = `About ${per.toFixed(1)} px per module — small enough to blur if it’s scaled or printed.`; warn = true; }
        else note = `${px} × ${px} px, about ${per.toFixed(per < 10 ? 1 : 0)} px per module.`;
      }
      sizeNote.textContent = note;
      sizeNote.classList.toggle('is-warn', warn);
    }
    function paintColors(from) {
      for (const [which, row] of [['fg', fgRow], ['bg', bgRow]]) {
        if (row.pick !== from) row.pick.value = S[which].toLowerCase();
        if (row.hex !== from) row.hex.value = S[which];
      }
      const c = contrastInfo(S.fg, S.bg);
      let tone = 'ok', title = 'Good contrast for scanning', sub = '';
      if (c.grade === 'F') { tone = 'bad'; title = 'Too little contrast to scan'; sub = 'Make the dark colour darker or the light colour lighter.'; }
      else if (c.inverted) { tone = 'warn'; title = 'Light code on a dark background'; sub = 'Many scanners can’t read inverted codes. Swap the colours to be safe.'; }
      else if (c.grade === 'D') { tone = 'warn'; title = 'Low contrast'; sub = 'Some scanners will miss it, especially in dim light.'; }
      else if (c.grade === 'C') { title = 'Fair contrast'; sub = 'Should scan. Test a print before making lots.'; }
      clear(contrastEl);
      contrastEl.className = `qr-contrast is-${tone}`;
      contrastEl.title = 'Symbol contrast: the difference in reflectance between the light and dark modules, graded A–F like ISO/IEC 15415. Below 40% many scanners struggle.';
      contrastEl.append(
        h('span.qr-grade', { 'aria-hidden': 'true', text: c.grade }),
        h('div.qr-contrast__t', h('b', { text: title }),
          h('small', { text: `Contrast ${Math.round(c.sc)}% · grade ${c.grade}${sub ? ` · ${sub}` : ''}` })));
      const heard = tone === 'ok' ? 'ok' : title;
      if (heard !== S.heard.contrast) { if (S.heard.contrast && tone !== 'ok') say(`${title}. ${sub}`); S.heard.contrast = heard; }
    }

    /* ---- preview ---- */
    function fitPreview() {
      const q = S.result;
      if (!q?.ok || box.hidden) return;
      const dpr = window.devicePixelRatio || 1;
      const avail = S.narrow ? Math.min(view.clientWidth - 16, 360) : Math.min(view.clientWidth, view.clientHeight) - 32;
      const n = q.size + 2 * S.margin;
      let px = Math.max(n, Math.floor(Math.max(96, avail) * dpr));
      const per = Math.floor(px / n);
      if (per >= 2) px = per * n;                   /* equal, whole device pixels per module */
      if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
      canvas.style.width = canvas.style.height = `${px / dpr}px`;
      drawCode(canvas.getContext('2d'), q, px, S.margin, S.fg, S.bg);
    }
    function paintStage() {
      const q = S.result;
      const ok = !!q?.ok;
      box.hidden = !ok;
      emptyEl.hidden = ok;
      clear(emptyEl);
      if (ok) {
        box.classList.toggle('is-flush', S.margin === 0);
        canvas.setAttribute('aria-label', `QR code — ${KIND[S.kind].label}: ${S.payload.label || 'untitled'}`);
        fitPreview();
      } else if (q && q.reason === 'too-long') {
        const [one, many] = MODE_UNIT[q.mode];
        const unit = q.max === 1 ? one : many;
        const atL = capacity(q.mode, 40, 'L');
        const tryL = S.level !== 'L' && q.count <= atL;
        const msg = S.level === 'L'
          ? `The most a QR code can hold is ${fmtN(q.max)} ${unit}; this is ${fmtN(q.count)}. Shorten it to fit.`
          : `At level ${S.level} a QR code holds up to ${fmtN(q.max)} ${unit}; this is ${fmtN(q.count)}.${tryL ? ` Level L fits up to ${fmtN(atL)}.` : ' Shorten it to fit.'}`;
        emptyEl.append(h('div.empty', icon('alert'), h('b', { text: 'Too long for a QR code' }), h('small', { text: msg }),
          tryL ? h('button.btn.btn--sm', { type: 'button', onclick: () => setLevel('L') }, h('span', { text: 'Use level L' })) : null));
      } else {
        emptyEl.append(h('div.empty', icon('grid'), h('b', { text: 'Nothing to encode yet' }), h('small', { text: KIND[S.kind].empty })));
      }
      const shape = ok ? 'ok' : q && q.reason === 'too-long' ? 'too-long' : 'empty';
      if (shape !== S.shape) { if (shape === 'too-long') say('Too long for a QR code.'); S.shape = shape; }
      paintMeta();
      paintCheck();
      paintLook();
      const off = !ok;
      for (const b of [presentBtn, moreBtn, dlBtn]) b.disabled = off;
      saveBtn.disabled = off || S.saving;
    }
    function paintMeta() {
      clear(meta);
      const q = S.result;
      meta.hidden = !q?.ok;
      if (!q?.ok) return;
      const [one, many] = MODE_UNIT[q.mode];
      const px = exportPx(q);
      const row = (k, v, extra) => [h('dt', { text: k }), h('dd', h('span', { text: v }), extra || null)];
      meta.append(
        ...row('Version', `${q.version} · ${q.size} × ${q.size} modules`),
        ...row('Encoding', MODE_LABEL[q.mode]),
        ...row('Data', `${fmtN(q.count)} of ${fmtN(q.capacity)} ${q.capacity === 1 ? one : many}`,
          h('span.qr-fill', { role: 'img', 'aria-label': `${Math.round(q.count / q.capacity * 100)}% of this version used` },
            h('i', { style: { width: `${Math.min(100, q.count / q.capacity * 100)}%` } }))),
        ...row('Correction', `Level ${S.level} · about ${LEVEL_INFO[S.level].pct}`),
        ...row('Mask', `Pattern ${q.mask} · lowest penalty of 8`),
        ...row('Image', `${px} × ${px} px`));
    }
    function paintNotes() {
      clear(notesEl);
      for (const n of S.payload.notes) notesEl.append(h(`div.qr-note.is-${n.tone}`, icon(n.tone === 'warn' ? 'alert' : 'info'), h('span', { text: n.text })));
      const t = S.payload.text;
      rawEl.hidden = !t || S.kind === 'text';
      rawN.textContent = t ? `${fmtN(new TextEncoder().encode(t).length)} bytes` : '';
      rawPre.textContent = S.payload.display;
    }

    /* ---- read back with the browser's own barcode reader, when it has one ---- */
    let detector = null, checkT = 0;
    function scheduleCheck() {
      if (!canRead) return;
      S.checkSeq++;
      cancel(checkT);
      if (!S.result?.ok) { S.check = 'idle'; paintCheck(); return; }
      S.check = 'checking';
      paintCheck();
      const seq = S.checkSeq;
      checkT = later(() => runCheck(seq), 450);
    }
    async function runCheck(seq) {
      const q = S.result, text = S.payload.text;
      if (!q?.ok) return;
      try {
        if (!detector) {
          const formats = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
          if (!formats.includes('qr_code')) throw new Error('no qr_code');
          detector = new BarcodeDetector({ formats: ['qr_code'] });
        }
        const found = await detector.detect(renderExport(q));
        if (S.dead || seq !== S.checkSeq) return;
        const vals = found.map(f => f.rawValue);
        S.check = vals.includes(text) ? 'ok' : vals.length ? 'mismatch' : 'none';
      } catch (err) {
        if (S.dead || seq !== S.checkSeq) return;
        S.check = 'error';                              /* the reader itself failed: claim nothing */
      }
      paintCheck();
      const heard = checkState();
      if (heard !== S.heard.check) {
        if (heard === 'ok') say('Checked: it reads back correctly.');
        else if (heard === 'caveat') say('It reads back in this browser, but fix the colours before you share it.');
        else if (heard === 'none') say('This browser’s barcode reader couldn’t read the code back.');
        else if (heard === 'mismatch') say('The code read back as different text.');
        S.heard.check = heard;
      }
    }
    /* A pass with poor colours is still a pass here, but this reader is far more
       forgiving than a phone camera in a dim room, so say both. */
    function checkState() {
      const c = contrastInfo(S.fg, S.bg);
      return S.check === 'ok' && (c.grade === 'F' || c.grade === 'D' || c.inverted) ? 'caveat' : S.check;
    }
    function paintCheck() {
      clear(checkEl);
      const st = checkState();
      checkEl.hidden = !canRead || !S.result?.ok || st === 'idle' || st === 'error';
      if (checkEl.hidden) return;
      const c = contrastInfo(S.fg, S.bg);
      const why = c.grade === 'F' || c.grade === 'D' ? 'Try more contrast.' : c.inverted ? 'Try dark on light.' : S.margin < 2 ? 'Try a wider margin.' : '';
      const V = {
        checking: [h('span.spinner', { 'aria-hidden': 'true' }), 'Reading it back…', ''],
        ok: [icon('check-circle'), 'Reads back correctly', 'This browser’s own barcode reader decoded the exported image back to exactly this text.'],
        caveat: [icon('alert'), 'Reads back here — but fix the colours', 'This browser’s reader decoded it, but it’s far more forgiving than most phone cameras. Sort out the contrast warning before you share or print it.'],
        mismatch: [icon('alert'), 'Read back as different text', 'The reader found a code but got different text — test it on your phone.'],
        none: [icon('x-circle'), 'Couldn’t read it back', `This browser’s barcode reader couldn’t decode the exported image. ${why}`.trim()],
      }[st];
      checkEl.className = `qr-check is-${st}`;
      checkEl.append(V[0], h('div', h('b', { text: V[1] }), V[2] ? h('small', { text: V[2] }) : null));
    }

    /* ---- the update loop: one encode per frame at most ---- */
    let raf = 0;
    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!S.dead) update(); }); }
    function update() {
      S.payload = buildPayload(S.kind, S.fields[S.kind], { wifiPass: S.wifiPass, showPass: S.showPass });
      const key = `${S.level}\u0001${S.payload.text}`;
      if (key !== S.encKey) {
        S.encKey = key;
        S.result = S.payload.text ? encodeQR(S.payload.text, { level: S.level }) : { ok: false, reason: 'empty' };
        scheduleCheck();
      }
      paintNotes();
      paintStage();
    }

    /* ==================================================================
       export
       ================================================================== */
    function renderExport(q = S.result) {
      const px = exportPx(q);
      const c = document.createElement('canvas');
      c.width = c.height = px;
      drawCode(c.getContext('2d'), q, px, S.margin, S.fg, S.bg);
      return c;
    }
    const pngBlob = () => new Promise((res, rej) => renderExport().toBlob(b => (b ? res(b) : rej(new Error('The image couldn’t be made.'))), 'image/png'));
    function fileBase() {
      const label = (S.payload.label || KIND[S.kind].label).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
      return `QR ${label || 'code'}`;
    }
    function download(blob, name) {
      const url = URL.createObjectURL(blob);
      urls.add(url);
      const a = h('a', { href: url, download: name, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      later(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
    }
    const fail = (title, err) => notify({ app: APP, icon: 'alert', title, message: String(err?.message || err || 'Something went wrong.') });

    async function downloadPng() {
      if (!S.result?.ok) return;
      try {
        const blob = await pngBlob();
        if (S.dead) return;
        download(blob, `${fileBase()}.png`);
        remember();
      } catch (err) { fail('Download failed', err); }
    }
    function downloadSvg() {
      if (!S.result?.ok) return;
      try {
        download(new Blob([svgCode(S.result, exportPx(S.result), S.margin, S.fg, S.bg)], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
        remember();
      } catch (err) { fail('Download failed', err); }
    }
    async function saveToPictures() {
      if (!S.result?.ok || S.saving) return;
      S.saving = true;
      saveBtn.disabled = true;
      try {
        const blob = await pngBlob();
        const media = await import('../core/media.js');
        const { path } = await media.save(`${api.vfs.HOME}/Pictures`, `${fileBase()}.png`, blob);
        if (S.dead) return;
        remember();
        notify({ app: APP, icon: 'image', title: 'Saved to Pictures', message: path, actions: [{ label: 'Open', onClick: () => api.openFile(path) }] });
      } catch (err) {
        if (!S.dead) fail('Couldn’t save to Pictures', err);
      } finally {
        S.saving = false;
        if (!S.dead) saveBtn.disabled = !S.result?.ok;
      }
    }
    const canCopyImage = () => typeof window.ClipboardItem === 'function' && !!navigator.clipboard?.write;
    async function copyImage() {
      try {
        if (!canCopyImage()) throw new Error('This browser doesn’t let pages copy images.');
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': pngBlob() })]);
        if (S.dead) return;
        remember();
        notify({ app: APP, icon: 'copy', title: 'Image copied', message: 'Paste it into a document or a message.', timeout: 2400 });
      } catch (err) { if (!S.dead) fail('Couldn’t copy the image', err); }
    }
    async function copyText() {
      try {
        await navigator.clipboard.writeText(S.payload.text);
        if (!S.dead) notify({ app: APP, icon: 'copy', title: 'Encoded text copied', message: clip(oneLine(S.payload.display), 80), timeout: 2200 });
      } catch (err) { if (!S.dead) fail('Couldn’t copy', 'The clipboard isn’t available here.'); }
    }
    const menuAt = (e, el) => {
      const r = el.getBoundingClientRect();
      return e && e.clientX ? [e.clientX, e.clientY] : [r.left, r.bottom + 4];
    };
    function openMore(e) {
      if (!S.result?.ok) return;
      menu([
        { label: 'Download SVG', icon: 'download', onClick: downloadSvg },
        { label: 'Copy image', icon: 'copy', disabled: !canCopyImage(), onClick: copyImage },
        { label: 'Copy encoded text', icon: 'clipboard', onClick: copyText },
      ], ...menuAt(e, moreBtn));
    }

    /* ==================================================================
       recent (only codes you exported)
       ================================================================== */
    function remember() {
      if (!S.payload.text) return;
      const fields = { ...S.fields[S.kind] };
      const sig = S.kind + JSON.stringify(fields);
      S.recent = [{ id: rid(), kind: S.kind, label: S.payload.label || KIND[S.kind].label, fields, at: new Date().toISOString() },
        ...S.recent.filter(r => r.kind + JSON.stringify(r.fields) !== sig)].slice(0, RECENT_MAX);
      persistSoon();
      paintRecent();
    }
    function restore(id) {
      const r = S.recent.find(x => x.id === id);
      if (!r) return;
      S.fields[r.kind] = { ...FIELDS[r.kind], ...r.fields };
      if (r.kind === 'wifi') S.wifiPass = '';
      S.kind = r.kind;
      S.showPass = false;
      renderForm();
      paintKinds();
      persistSoon();
      schedule();
    }
    function removeRecent(id) {
      const i = S.recent.findIndex(r => r.id === id);
      if (i < 0) return;
      S.recent = S.recent.filter(r => r.id !== id);
      persistSoon();
      paintRecent();
      const items = recentGroup.querySelectorAll('.qr-recent');
      (items[Math.min(i, items.length - 1)] || kindBtns[S.kind]).focus({ preventScroll: true });
    }
    async function clearRecent() {
      if (!S.recent.length) return;
      const ok = await confirm({ title: 'Clear recent codes?', message: `${S.recent.length} recent code${S.recent.length === 1 ? '' : 's'} will be forgotten. Saved and downloaded images aren’t touched.`, ok: 'Clear', danger: true });
      if (!ok || S.dead) return;
      S.recent = [];
      persistSoon();
      paintRecent();
      kindBtns[S.kind].focus({ preventScroll: true });
    }
    const shortAgo = iso => api.fmt.fmtAgo(iso).replace(' ago', '').replace('just now', 'now');
    const recentTitle = r => `${KIND[r.kind].label}: ${r.label} · ${api.fmt.fmtAgo(r.at)} · right-click to remove`;
    function paintRecent() {
      clear(recentGroup);
      recentGroup.append(h('div.side__label', { text: 'Recent' }));
      if (!S.recent.length) {
        recentGroup.append(h('small.qr-side__none', { text: 'Codes you save, download or copy show up here.' }));
      } else {
        for (const r of S.recent) {
          recentGroup.append(h('button.side__item.qr-recent', {
            type: 'button', title: recentTitle(r), dataset: { id: r.id },
            onclick: () => restore(r.id),
            oncontextmenu: e => {
              e.preventDefault();
              menu([
                { label: 'Open', icon: 'edit-3', onClick: () => restore(r.id) },
                { label: 'Remove from Recent', icon: 'x', onClick: () => removeRecent(r.id) },
              ], ...menuAt(e, e.currentTarget));
            },
          }, glyph(KIND[r.kind].icon), h('span', { text: r.label || KIND[r.kind].label }), h('small', { text: shortAgo(r.at) })));
        }
        recentGroup.append(h('button.side__item.qr-side__clear', { type: 'button', onclick: () => clearRecent() }, icon('trash'), h('span', { text: 'Clear recent' })));
      }
      chipRecent.hidden = !S.recent.length;
    }
    function openRecentMenu(e) {
      if (!S.recent.length) return;
      menu([
        { header: true, label: 'Recent' },
        ...S.recent.map(r => ({ label: r.label || KIND[r.kind].label, hint: shortAgo(r.at), onClick: () => restore(r.id) })),
        '-',
        { label: 'Clear recent', icon: 'trash', danger: true, onClick: () => clearRecent() },
      ], ...menuAt(e, chipRecent));
    }

    /* ==================================================================
       show large, for scanning straight off the screen
       ================================================================== */
    function openPresent() {
      if (!S.result?.ok || S.present) return;
      const prev = document.activeElement;
      const ink = luminance(S.bg) > 0.3 ? '#000' : '#fff';
      const pc = h('canvas.qr-present__canvas', { role: 'img', 'aria-label': canvas.getAttribute('aria-label') });
      const closeBtn = h('button.ibtn.qr-present__close', { type: 'button', 'aria-label': 'Close the large view', style: { color: ink }, onclick: () => closePresent() }, icon('x'));
      const ov = h('div.qr-present', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': 'QR code, shown large', tabindex: '-1', style: { background: S.bg, color: ink },
        onkeydown: e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePresent(); }
          else if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }
        },
      }, pc, h('small.qr-present__hint', { text: 'Point a phone camera at the screen · Esc to close' }), closeBtn);
      appEl.appendChild(ov);
      const draw = () => {
        const q = S.result;
        if (!q?.ok) { closePresent(); return; }
        const dpr = window.devicePixelRatio || 1;
        const n = q.size + 2 * S.margin;
        const avail = Math.min(ov.clientWidth - 48, ov.clientHeight - 80);
        let px = Math.max(n, Math.floor(Math.max(120, avail) * dpr));
        const per = Math.floor(px / n);
        if (per >= 2) px = per * n;
        pc.width = pc.height = px;
        pc.style.width = pc.style.height = `${px / dpr}px`;
        drawCode(pc.getContext('2d'), q, px, S.margin, S.fg, S.bg);
      };
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
      ro?.observe(ov);
      S.present = { ov, ro, prev };
      draw();
      closeBtn.focus({ preventScroll: true });
    }
    function closePresent(silent) {
      const p = S.present;
      if (!p) return;
      S.present = null;
      p.ro?.disconnect();
      p.ov.remove();
      if (!silent && p.prev && p.prev.isConnected) p.prev.focus({ preventScroll: true });
    }

    /* ==================================================================
       opening with something to encode:  openApp('qr', { text } | { url })
       ================================================================== */
    function applyOpts(o) {
      if (!o || typeof o !== 'object') return;
      if (o.scan) { setScan(true); return; }
      const raw = typeof o.url === 'string' ? o.url : typeof o.text === 'string' ? o.text : null;
      if (raw === null) return;
      const t = raw.slice(0, LONG.text);
      closePresent(true);                                   /* it would go on showing the old code */
      if (typeof o.url === 'string' || /^https?:\/\/\S+$/i.test(t.trim())) { S.kind = 'link'; S.fields.link = { url: t.trim().slice(0, 2000) }; }
      else { S.kind = 'text'; S.fields.text = { text: t }; }
      renderForm();
      paintKinds();
      persistSoon();
      schedule();
    }
    win.onReopen(o => applyOpts(o));

    /* ==================================================================
       keyboard, size, pixel density
       ================================================================== */
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveToPictures();
      }
    };
    root.addEventListener('keydown', onKey);

    let ro = null;
    const measure = () => {
      const w = appEl.clientWidth;
      const narrow = document.body.classList.contains('is-mobile') || (w > 0 && w < NARROW);
      if (narrow !== S.narrow) {
        S.narrow = narrow;
        appEl.classList.toggle('is-narrow', narrow);
        paintKinds();
      }
      fitPreview();
    };
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => { if (!S.dead) measure(); });
      ro.observe(appEl);
      ro.observe(view);
    }
    let dprMq = null;
    const onDpr = () => { watchDpr(); if (!S.dead) fitPreview(); };
    function watchDpr() {
      dprMq?.removeEventListener?.('change', onDpr);
      dprMq = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      dprMq?.addEventListener?.('change', onDpr);
    }
    watchDpr();
    /* "2m" should not still say "now" an hour later — relabel in place, so a
       focused Recent item keeps its focus */
    const tick = setInterval(() => {
      if (S.dead) return;
      for (const btn of recentGroup.querySelectorAll('.qr-recent')) {
        const r = S.recent.find(x => x.id === btn.dataset.id);
        const small = btn.querySelector('small');
        if (r && small) { small.textContent = shortAgo(r.at); btn.title = recentTitle(r); }
      }
    }, 60000);

    /* ---------------- first paint ---------------- */
    applyOpts(opts);
    renderForm();
    paintKinds();
    paintLevel();
    paintColors();
    paintRecent();
    measure();
    update();
    if (!document.body.classList.contains('is-mobile')) {
      requestAnimationFrame(() => { if (!S.dead) formFields.querySelector('input,textarea')?.focus({ preventScroll: true }); });
    }

    /* ---------------- teardown ---------------- */
    return () => {
      if (persistT) { cancel(persistT); persistT = 0; store.set(STORE_KEY, snapshot()); }
      S.dead = true;
      S.scanSeq++;
      if (S.scanDown) { try { S.scanDown(); } catch (e) { console.error(e); } S.scanDown = null; }
      closePresent(true);
      if (raf) cancelAnimationFrame(raf);
      clearInterval(tick);
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
      ro?.disconnect();
      dprMq?.removeEventListener?.('change', onDpr);
      root.removeEventListener('keydown', onKey);
      S.wifiPass = '';
      detector = null;
    };
  },
});
