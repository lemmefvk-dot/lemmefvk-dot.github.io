/* ============================================================
   studio/music.js — your Static Beats tracks as game music.

   Static Beats writes 16-bit WAV files into ~/Music. Studio lists
   the WAV files there, and "Use as music" copies one into the game
   as a sound asset (the game file carries its own copy, so it plays
   anywhere). A full-quality WAV is big (about 170 KB for each second),
   so the copy is shrunk to mono at 22 kHz first — a quarter of the
   size, and still fine for game music. Only plain 16-bit PCM WAV is
   read; anything else is left as it is.

     wavFiles(vfs)            -> [{ path, name, bytes }]  the WAVs in ~/Music
     shrinkWav(arrayBuffer)   -> { buffer, from, to, seconds } | null
   ============================================================ */

export function wavFiles(vfs) {
  const out = [];
  try {
    for (const n of vfs.ls(`${vfs.HOME}/Music`) || []) {
      if (n.type === 'file' && /\.wav$/i.test(n.name)) out.push({ path: `${vfs.HOME}/Music/${n.name}`, name: n.name, bytes: n.size || 0 });
    }
  } catch (err) { /* no Music folder */ }
  return out;
}

function readHeader(dv) {
  if (dv.byteLength < 44) return null;
  const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12, fmt = null, data = null;
  while (o + 8 <= dv.byteLength) {
    const id = tag(o), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), channels: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    else if (id === 'data') { data = { at: o + 8, size: Math.min(size, dv.byteLength - o - 8) }; break; }
    o += 8 + size + (size & 1);
  }
  return fmt && data ? { fmt, data } : null;
}

export function shrinkWav(buffer, { rate = 22050 } = {}) {
  const dv = new DataView(buffer);
  const hd = readHeader(dv);
  if (!hd || hd.fmt.format !== 1 || hd.fmt.bits !== 16 || hd.fmt.channels < 1 || hd.fmt.channels > 2) return null;
  const ch = hd.fmt.channels, inRate = hd.fmt.rate;
  const frames = Math.floor(hd.data.size / (2 * ch));
  if (!frames || !inRate) return null;
  const to = Math.min(rate, inRate);
  const outFrames = Math.max(1, Math.floor(frames * to / inRate));
  const out = new ArrayBuffer(44 + outFrames * 2);
  const ov = new DataView(out);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) ov.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); ov.setUint32(4, 36 + outFrames * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  ov.setUint32(16, 16, true); ov.setUint16(20, 1, true); ov.setUint16(22, 1, true);
  ov.setUint32(24, to, true); ov.setUint32(28, to * 2, true); ov.setUint16(32, 2, true); ov.setUint16(34, 16, true);
  wr(36, 'data'); ov.setUint32(40, outFrames * 2, true);
  const step = inRate / to;
  for (let i = 0; i < outFrames; i++) {
    /* average everything that falls inside this output sample, across both channels */
    const a = Math.floor(i * step), b = Math.min(frames, Math.max(a + 1, Math.floor((i + 1) * step)));
    let sum = 0, n = 0;
    for (let f = a; f < b; f++) for (let c = 0; c < ch; c++) { sum += dv.getInt16(hd.data.at + (f * ch + c) * 2, true); n++; }
    ov.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(sum / (n || 1)))), true);
  }
  return { buffer: out, from: buffer.byteLength, to: out.byteLength, seconds: frames / inRate };
}

export default { wavFiles, shrinkWav };
