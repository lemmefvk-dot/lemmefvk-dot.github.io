/* ============================================================
   studio/sheet.js — reading a sprite sheet's data file.

   Asset Lab's "sprite sheet + frame data (.json)" export looks like

     { image, layout, size:{w,h}, frame:{w,h}, columns, rows, fps,
       frames:[{index,x,y,w,h}], tags?:[{name,from,to}] }

   The tags come later (Asset Lab adds Idle / Run / Jump), so a sheet
   with them and a sheet without them both work. Aseprite-style data
   (meta.frameTags, frames with a "frame" box) is understood too.

   readSheet(json) -> { ok:true, sheet } | { ok:false, error }
     sheet = { fw, fh, fps, frames:[[x,y,w,h], …], tags:[{name,from,to}] }
   Frame numbers in tags and in objects' `anim` are 0-based and
   inclusive: idle [0, 3] is the first four frames.
   ============================================================ */

const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/* tags can be a list ({name, from, to} or {name, start, end}) or a map (name: [from, to] or {from, to}) */
function readTags(raw, count) {
  const out = [];
  const add = (name, from, to) => {
    const a = int(from, 0, 4095), b = int(to, 0, 4095);
    const n = String(name ?? '').trim().slice(0, 24);
    if (!n || a === null || b === null || a > b || a >= count) return;
    out.push({ name: n, from: a, to: Math.min(b, count - 1) });
  };
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (t && typeof t === 'object') add(t.name ?? t.tag ?? t.label, t.from ?? t.start ?? t.first, t.to ?? t.end ?? t.last);
    }
  } else if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      const t = raw[k];
      if (Array.isArray(t)) add(k, t[0], t[1]);
      else if (t && typeof t === 'object') add(k, t.from ?? t.start, t.to ?? t.end);
    }
  }
  return out.slice(0, 32);
}

export function readSheet(json) {
  let j = json;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch (err) { return { ok: false, error: 'That file is not valid JSON.' }; } }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'A sprite sheet file is a JSON object.' };

  /* frames: a list of boxes, or boxes inside {frame:{x,y,w,h}} (Aseprite) */
  let frames = [];
  const rawFrames = Array.isArray(j.frames) ? j.frames : (j.frames && typeof j.frames === 'object' ? Object.values(j.frames) : []);
  for (const f of rawFrames.slice(0, 4096)) {
    const b = f && typeof f === 'object' ? (f.frame && typeof f.frame === 'object' ? f.frame : f) : null;
    if (!b) continue;
    const x = int(b.x, 0, 65535), y = int(b.y, 0, 65535), w = int(b.w ?? b.width, 1, 4096), h = int(b.h ?? b.height, 1, 4096);
    if (x === null || y === null || w === null || h === null) continue;
    frames.push([x, y, w, h]);
  }
  let fw = int(j.frame?.w ?? j.frameWidth ?? j.frameW ?? j.tileWidth, 1, 4096);
  let fh = int(j.frame?.h ?? j.frameHeight ?? j.frameH ?? j.tileHeight, 1, 4096);
  if (frames.length) { fw = fw || frames[0][2]; fh = fh || frames[0][3]; }
  /* no boxes: lay frames out in a grid from the frame size and the sheet size */
  if (!frames.length) {
    const sw = int(j.size?.w ?? j.width ?? j.meta?.size?.w, 1, 65535), sh = int(j.size?.h ?? j.height ?? j.meta?.size?.h, 1, 65535);
    const cols = int(j.columns ?? j.cols, 1, 4096) || (fw && sw ? Math.floor(sw / fw) : null);
    const rows = int(j.rows, 1, 4096) || (fh && sh ? Math.floor(sh / fh) : null);
    if (!fw || !fh || !cols || !rows) return { ok: false, error: 'This file does not say how big a frame is. Asset Lab’s “sprite sheet + frame data” export does.' };
    for (let r = 0; r < rows && frames.length < 4096; r++) for (let c = 0; c < cols && frames.length < 4096; c++) frames.push([c * fw, r * fh, fw, fh]);
  }
  if (!frames.length) return { ok: false, error: 'No frames were found in this file.' };
  const fps = Number(j.fps ?? j.frameRate);
  const tags = readTags(j.tags ?? j.animations ?? j.meta?.frameTags ?? j.frameTags, frames.length);
  return {
    ok: true,
    sheet: { fw: fw || frames[0][2], fh: fh || frames[0][3], fps: Number.isFinite(fps) && fps > 0 ? Math.min(60, Math.max(0.5, fps)) : 8, frames, tags },
  };
}

/** The frame range an object's animation names, as [from, to] — a tag name or a "3-5" style range. */
export function tagRange(sheet, name) {
  const t = (sheet?.tags || []).find(x => x.name.toLowerCase() === String(name || '').toLowerCase());
  return t ? [t.from, t.to] : null;
}

/** Find a tag by a few likely names ("idle", "walk" / "run") so a sheet can animate with no setup. */
export function guessClips(sheet) {
  const find = (...names) => {
    for (const n of names) { const r = tagRange(sheet, n); if (r) return r; }
    return null;
  };
  return { idle: find('idle', 'stand', 'rest'), walk: find('walk', 'run', 'move') };
}

export default { readSheet, tagRange, guessClips };
