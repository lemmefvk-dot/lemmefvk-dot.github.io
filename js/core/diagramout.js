/* ============================================================
   diagramout.js — the file plumbing the drawing apps (Flowcharts, Timeline,
   Voxel Studio) share: save a document into Files, export a picture, and
   read a file's bytes back.

     saveDoc(path|null, stem, ext, text, { dir })   the path it was kept at.
                  With a path the file is rewritten; without one a free name
                  (" 2", " 3"…) is made in Documents. Text too big for the
                  file store is kept as real bytes (core/media.js) instead.
     exportSvg(svgText, stem)               → { path }   in ~/Pictures
     exportPng(svgText, w, h, stem, scale)  → { path, w, h }
     readBytes(path)                        → Uint8Array | null
     readText(path)                         → string | null
   ============================================================ */
import { vfs } from './vfs.js';
import media from './media.js';

export const DOCS = `${vfs.HOME}/Documents`, PICS = `${vfs.HOME}/Pictures`;
export const safeName = (t, fallback = 'Untitled') => (String(t || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 40) || fallback);
const BIG = 150000;

export async function saveDoc(path, stem, ext, text, { dir = DOCS } = {}) {
  if (path && vfs.node(path)) {
    if (text.length > BIG) { await media.replace(path, new Blob([text], { type: 'text/plain' })); return path; }
    if (media.isMedia(path)) { await media.replace(path, new Blob([text], { type: 'text/plain' })); return path; }
    vfs.write(path, text);
    return path;
  }
  if (text.length > BIG) return (await media.save(dir, `${safeName(stem)}.${ext}`, new Blob([text], { type: 'text/plain' }))).path;
  if (!vfs.node(dir)) vfs.mkdir(dir);
  const base = safeName(stem);
  let name = `${base}.${ext}`, i = 2;
  while (vfs.node(`${dir}/${name}`)) name = `${base} ${i++}.${ext}`;
  if (!vfs.write(`${dir}/${name}`, text)) throw new Error(`${dir} is not available.`);
  return `${dir}/${name}`;
}

export async function exportSvg(svgText, stem) {
  const out = await media.save(PICS, `${safeName(stem)}.svg`, new Blob([svgText], { type: 'image/svg+xml' }));
  return { path: out.path };
}

export async function exportPng(svgText, w, h, stem, scale = 2) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = Math.min(8000, Math.round(w * scale)); cv.height = Math.min(8000, Math.round(h * scale));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('The picture could not be made.');
    const out = await media.save(PICS, `${safeName(stem)}.png`, blob);
    return { path: out.path, w: cv.width, h: cv.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function readBytes(path) {
  const n = vfs.node(path);
  if (!n || n.type !== 'file') return null;
  if (media.isMedia(n)) { const b = await media.blobOf(n); return b ? new Uint8Array(await b.arrayBuffer()) : null; }
  return new TextEncoder().encode(n.content || '');
}
export async function readText(path) {
  const n = vfs.node(path);
  if (!n || n.type !== 'file') return null;
  if (media.isMedia(n)) { const b = await media.blobOf(n); return b ? b.text() : null; }
  return n.content || '';
}

export default { saveDoc, exportSvg, exportPng, readBytes, readText, safeName, DOCS, PICS };
