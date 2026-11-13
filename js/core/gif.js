/* ============================================================
   gif.js — an animated GIF (GIF89a) encoder, written for StaticOS.
   No library. Used by Picture Tools' GIF maker and by Asset Lab.

     encodeGif({ width, height, frames, loop, colors, dither, optimize })
        frames: [{ data: Uint8ClampedArray (RGBA, width*height*4), delay: ms }]
        loop:   true (default) = repeat forever (NETSCAPE2.0 block, count 0)
        colors: 2..256 palette size (default 256)
        dither: Floyd–Steinberg error diffusion (default false)
        optimize: keep only what changed since the previous frame (default
                  true): unchanged pixels become the transparent colour and
                  each frame is cropped to the box that changed
        -> Uint8Array (the file)

   How it works
   · Palette: ONE global palette for the whole animation, by median cut
     over a 5-bits-per-channel histogram of every frame (so a colour that
     appears in any frame is counted by how many pixels use it). Boxes are
     split along their widest channel at the pixel-count median until there
     are `colors` boxes; each box becomes its pixel-weighted average colour.
     A pixel is mapped to its nearest palette colour (squared RGB distance),
     remembered per histogram bin. Dithering spreads each pixel's error to
     its neighbours (7/16, 3/16, 5/16, 1/16) on the full-precision colour.
   · Transparency: a pixel with alpha < 128 is transparent. If any frame
     has such a pixel one palette slot is kept for it, and every frame is
     written whole with "restore to background" disposal, so a pixel that
     goes clear really clears (no frame differencing then). Otherwise, with
     `optimize`, a slot is kept for "unchanged": frames after the first are
     cropped to the box that changed and every pixel in it that is the same
     as the picture already on screen is written as the transparent index
     (disposal "leave in place"), which LZW squeezes into long runs.
   · LZW: variable-width codes, 12 bit limit, a clear code when the table
     is full, packed into 255-byte sub-blocks.
   · Delays are stored in hundredths of a second (the format's unit), so
     delay is rounded to 10 ms; a 0 would be shown at ~100 ms by browsers,
     so the minimum written is 2 (20 ms).

   decodeFrames(bytes) is a small reader for the same files — used for
   checking and for showing info; it understands what this encoder writes.
   ============================================================ */

/* ---------- palette: median cut ---------- */
function histogram(frames) {
  const hist = new Uint32Array(32768);
  const sum = new Float64Array(32768 * 3);      /* the real colours that fell in each bin, so a palette can be exact */
  let transparent = false;
  for (const f of frames) {
    const d = f.data;
    /* look at about 400k pixels in all, so a long animation stays quick */
    const step = Math.max(1, Math.floor((d.length / 4) * frames.length / 400000));
    for (let i = 0; i < d.length; i += 4 * step) {
      if (d[i + 3] < 128) { transparent = true; continue; }
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      hist[k]++;
      sum[k * 3] += d[i]; sum[k * 3 + 1] += d[i + 1]; sum[k * 3 + 2] += d[i + 2];
    }
    /* transparency must be noticed even when pixels are skipped above */
    if (!transparent && step > 1) for (let i = 3; i < d.length; i += 4) if (d[i] < 128) { transparent = true; break; }
  }
  return { hist, sum, transparent };
}

function medianCut(hist, sum, n) {
  const cols = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) cols.push(k);
  if (!cols.length) return [[0, 0, 0]];
  const r = k => (k >> 10) & 31, g = k => (k >> 5) & 31, b = k => k & 31;
  const makeBox = list => {
    let rmin = 31, rmax = 0, gmin = 31, gmax = 0, bmin = 31, bmax = 0, count = 0;
    for (const k of list) {
      const R = r(k), G = g(k), B = b(k);
      if (R < rmin) rmin = R; if (R > rmax) rmax = R;
      if (G < gmin) gmin = G; if (G > gmax) gmax = G;
      if (B < bmin) bmin = B; if (B > bmax) bmax = B;
      count += hist[k];
    }
    return { list, rmin, rmax, gmin, gmax, bmin, bmax, count };
  };
  const boxes = [makeBox(cols)];
  while (boxes.length < n) {
    /* split the box with the most pixels that still has two colours in it */
    let bi = -1, best = 0;
    boxes.forEach((bx, i) => { if (bx.list.length > 1 && bx.count > best) { best = bx.count; bi = i; } });
    if (bi < 0) break;
    const bx = boxes[bi];
    const dr = bx.rmax - bx.rmin, dg = bx.gmax - bx.gmin, db = bx.bmax - bx.bmin;
    const ch = dg >= dr && dg >= db ? g : dr >= db ? r : b;       /* green first: the eye is most sensitive to it */
    const sorted = bx.list.slice().sort((p, q) => ch(p) - ch(q) || p - q);
    let acc = 0, cut = 0;
    for (; cut < sorted.length - 1; cut++) { acc += hist[sorted[cut]]; if (acc * 2 >= bx.count) break; }
    cut = Math.min(cut + 1, sorted.length - 1);
    boxes.splice(bi, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
  }
  return boxes.map(bx => {
    let R = 0, G = 0, B = 0;
    for (const k of bx.list) { R += sum[k * 3]; G += sum[k * 3 + 1]; B += sum[k * 3 + 2]; }
    const c = bx.count || 1;
    return [Math.round(R / c), Math.round(G / c), Math.round(B / c)];      /* the pixels' own average */
  });
}

/** nearest palette index for r,g,b (0..255) */
function nearest(pal, R, G, B) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const dr = R - p[0], dg = G - p[1], db = B - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; bi = i; if (d === 0) break; }
  }
  return bi;
}

/** RGBA -> palette indexes. `tIndex` is written for transparent pixels (or -1 when there is none). */
function indexFrame(data, w, h, pal, tIndex, dither) {
  const out = new Uint8Array(w * h);
  const cache = new Int16Array(32768).fill(-1);
  const lookup = (R, G, B) => {
    const key = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
    let v = cache[key];
    if (v < 0) { v = nearest(pal, R, G, B); cache[key] = v; }
    return v;
  };
  if (!dither) {
    for (let p = 0, i = 0; p < out.length; p++, i += 4) {
      out[p] = data[i + 3] < 128 ? tIndex : lookup(data[i], data[i + 1], data[i + 2]);
    }
    return out;
  }
  /* Floyd–Steinberg on two rows of float error */
  let cur = new Float32Array((w + 2) * 3), nxt = new Float32Array((w + 2) * 3);
  for (let y = 0; y < h; y++) {
    nxt.fill(0);
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      if (data[i + 3] < 128) { out[p] = tIndex; continue; }
      const e = (x + 1) * 3;
      const R = Math.max(0, Math.min(255, data[i] + cur[e]));
      const G = Math.max(0, Math.min(255, data[i + 1] + cur[e + 1]));
      const B = Math.max(0, Math.min(255, data[i + 2] + cur[e + 2]));
      /* the cache is by bin, which is too coarse once error is added: search exactly, but only among the first guess's neighbours is not worth it */
      const idx = nearest(pal, R, G, B);
      out[p] = idx;
      const q = pal[idx];
      const er = R - q[0], eg = G - q[1], eb = B - q[2];
      cur[e + 3] += er * 7 / 16; cur[e + 4] += eg * 7 / 16; cur[e + 5] += eb * 7 / 16;
      nxt[e - 3] += er * 3 / 16; nxt[e - 2] += eg * 3 / 16; nxt[e - 1] += eb * 3 / 16;
      nxt[e] += er * 5 / 16; nxt[e + 1] += eg * 5 / 16; nxt[e + 2] += eb * 5 / 16;
      nxt[e + 3] += er / 16; nxt[e + 4] += eg / 16; nxt[e + 5] += eb / 16;
    }
    [cur, nxt] = [nxt, cur];
  }
  return out;
}

/* ---------- LZW ---------- */
function lzw(indexes, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const bytes = [];
  let cur = 0, bits = 0;
  let size = minCode + 1, next = eoi + 1;
  const emit = code => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) { bytes.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  /* dictionary: key = prefix * 256 + byte -> code, as an open-addressed table */
  const TS = 1 << 13;                       /* 8192 slots for at most 4096 entries */
  const keys = new Int32Array(TS), vals = new Int32Array(TS);
  const reset = () => { keys.fill(-1); next = eoi + 1; size = minCode + 1; };
  reset();
  emit(clear);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const c = indexes[i];
    const key = prefix * 256 + c;
    let s = (key * 2654435761 >>> 19) & (TS - 1);
    let found = -1;
    while (keys[s] !== -1) { if (keys[s] === key) { found = vals[s]; break; } s = (s + 1) & (TS - 1); }
    if (found >= 0) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      keys[s] = key; vals[s] = next++;
      if (next - 1 === (1 << size) && size < 12) size++;      /* the code just added needs one more bit */
    } else {
      emit(clear);
      reset();
    }
    prefix = c;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) bytes.push(cur & 255);
  return bytes;
}

/* ---------- the file ---------- */
export function encodeGif({ width, height, frames, loop = true, colors = 256, dither = false, optimize = true }) {
  width = Math.round(width); height = Math.round(height);
  if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error('GIF size must be 1 to 65535 pixels.');
  if (!frames || !frames.length) throw new Error('A GIF needs at least one frame.');
  for (const f of frames) if (f.data.length !== width * height * 4) throw new Error('A frame is not the size of the GIF.');
  colors = Math.max(2, Math.min(256, Math.round(colors) || 256));

  const { hist, sum, transparent } = histogram(frames);
  const diff = optimize && !transparent && frames.length > 1;     /* "unchanged" needs a transparent colour of its own */
  let pal = medianCut(hist, sum, transparent || diff ? Math.min(colors, 255) : colors);
  let tIndex = -1;
  if (transparent || diff) { tIndex = pal.length; pal = pal.concat([[0, 0, 0]]); }
  /* the table is a power of two long */
  let bitsPer = 1;
  while ((1 << bitsPer) < pal.length) bitsPer++;
  const tableLen = 1 << bitsPer;
  while (pal.length < tableLen) pal.push([0, 0, 0]);
  const minCode = Math.max(2, bitsPer);
  const realPal = pal.slice(0, tIndex >= 0 ? tIndex : pal.length);   /* what pixels may be mapped to */

  const out = [];
  const u16 = n => out.push(n & 255, (n >> 8) & 255);
  const str = s => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  str('GIF89a');
  u16(width); u16(height);
  out.push(0x80 | (7 << 4) | (bitsPer - 1), 0, 0);          /* global table, 8-bit colour, size; background 0; square pixels */
  for (const c of pal) out.push(c[0], c[1], c[2]);
  if (loop) { out.push(0x21, 0xFF, 11); str('NETSCAPE2.0'); out.push(3, 1, 0, 0, 0); }   /* repeat forever */

  /* what a viewer is showing after each frame, as indexes (for the optimiser) */
  let shown = null;
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k];
    const idx = indexFrame(f.data, width, height, realPal, tIndex, dither);
    let x0 = 0, y0 = 0, w = width, h = height, pix = idx;
    const disposal = transparent ? 2 : 1;                   /* real transparency: clear between frames */
    let useT = transparent ? tIndex : -1;
    if (diff && shown) {
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (idx[y * width + x] !== shown[y * width + x]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      useT = tIndex;
      if (maxX < 0) { w = 1; h = 1; pix = Uint8Array.of(tIndex); }      /* nothing changed: one see-through pixel */
      else {
        x0 = minX; y0 = minY; w = maxX - minX + 1; h = maxY - minY + 1;
        pix = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y0 + y) * width + x0 + x;
          pix[y * w + x] = idx[i] === shown[i] ? tIndex : idx[i];       /* unchanged pixels let the old one show through */
        }
      }
    }
    if (diff) shown = idx;
    const delay = Math.max(2, Math.round((f.delay ?? 100) / 10));
    /* graphic control extension */
    out.push(0x21, 0xF9, 4, (disposal << 2) | (useT >= 0 ? 1 : 0)); u16(delay); out.push(useT >= 0 ? useT : 0, 0);
    /* image descriptor, no local table */
    out.push(0x2C); u16(x0); u16(y0); u16(w); u16(h); out.push(0);
    out.push(minCode);
    const data = lzw(pix, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      out.push(n);
      for (let j = 0; j < n; j++) out.push(data[i + j]);
    }
    out.push(0);
  }
  out.push(0x3B);
  return Uint8Array.from(out);
}

/* ---------- a reader, for the same files ---------- */
export function decodeFrames(bytes) {
  const b = bytes;
  const sig = String.fromCharCode(...b.slice(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('Not a GIF');
  const info = { signature: sig, width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), loop: null, frames: [] };
  let p = 13;
  const flags = b[10];
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
  let gce = null;
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3B) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xF9) { gce = { disposal: (b[p + 1] >> 2) & 7, transparent: (b[p + 1] & 1) ? b[p + 4] : -1, delay: (b[p + 2] | (b[p + 3] << 8)) * 10 }; }
      if (label === 0xFF) {
        const id = String.fromCharCode(...b.slice(p + 1, p + 12));
        if (id === 'NETSCAPE2.0' && b[p + 12] === 3 && b[p + 13] === 1) info.loop = b[p + 14] | (b[p + 15] << 8);
      }
      while (b[p]) p += b[p] + 1;
      p++;
    } else if (t === 0x2C) {
      const fr = { x: b[p] | (b[p + 1] << 8), y: b[p + 2] | (b[p + 3] << 8), w: b[p + 4] | (b[p + 5] << 8), h: b[p + 6] | (b[p + 7] << 8), ...(gce || { delay: 0, disposal: 0, transparent: -1 }) };
      const lf = b[p + 8];
      p += 9;
      if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1));
      p++;                                   /* min code size */
      while (b[p]) p += b[p] + 1;
      p++;
      info.frames.push(fr);
      gce = null;
    } else break;
  }
  return info;
}

/** What a set of frames would cost, from encoding a few of them: [bytes, honest?]. A guess: a long
    animation whose frames change a lot costs more per frame than its first ones did. */
export function estimateGifSize(opts, sample = 4) {
  const { frames } = opts;
  if (frames.length <= sample) return encodeGif(opts).length;
  const part = encodeGif({ ...opts, frames: frames.slice(0, sample) });
  const header = 13 + 768 + 19 + 1;
  return Math.round(header + (part.length - header) / sample * frames.length);
}

export default { encodeGif, decodeFrames, estimateGifSize };
