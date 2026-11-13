/* ============================================================
   pt-common.js — what the four picture tools share (js/apps/picturetools.js)

   A "source" is a picture a tool works on: { key, name, path } for a
   file in the file system (bytes in IndexedDB or shipped with the site),
   or { key, name, file } for a File picked from the real computer.

     listPictures()                  -> sources, newest first, from ~/Pictures
     pickerView(api, opts)           -> { el, selected(), pick(src), clear(), destroy() }
     blobOfSource(src)               -> Promise<Blob>
     bitmapOf(blob)                  -> Promise<ImageBitmap|HTMLImageElement>
     encode(canvas, type, quality)   -> Promise<Blob|null>   (null: can't)
     saveBlob(api, app, dir, name, blob)   keeps a copy + a notification
   ============================================================ */
import * as media from '../core/media.js';
import { importBlock } from '../core/fileimport.js';
import vfs from '../core/vfs.js';

export const stemOf = n => { const i = String(n).lastIndexOf('.'); return i > 0 ? String(n).slice(0, i) : String(n); };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const picturesDir = () => `${vfs.HOME}/Pictures`;
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

let fileSeq = 0;
export function listPictures() {
  const out = [];
  vfs.walk(picturesDir(), (n, p) => {
    if (n.type === 'file' && media.kindOf(n.name) === 'image' && media.isMedia(n) && !p.includes('/Trash/')) {
      out.push({ key: p, name: n.name, path: p, at: Date.parse(n.mtime) || 0, size: n.size || 0 });
    }
  });
  return out.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}
export const sourceOfPath = path => {
  const n = vfs.node(path);
  return n && n.type === 'file' && media.kindOf(n.name) === 'image' && media.isMedia(n)
    ? { key: vfs.norm(path), name: n.name, path: vfs.norm(path), size: n.size || 0 } : null;
};
export const sourceOfFile = f => ({ key: `file:${++fileSeq}:${f.name}`, name: f.name, file: f, size: f.size });

export async function blobOfSource(src) {
  if (src.file) return src.file;
  const b = await media.blobOf(src.path);
  if (!b) throw new Error(`${src.name}: its bytes are missing from this browser.`);
  return b;
}

export async function bitmapOf(blob) {
  try { return await createImageBitmap(blob); } catch (e) { /* fall through to <img> */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}
export const sizeOfBitmap = b => ({ w: b.naturalWidth || b.width, h: b.naturalHeight || b.height });

/** Encode a canvas. Resolves null when the browser can't make that type
    (toBlob quietly hands back a PNG instead, which must not be passed off). */
export function encode(canvas, type, quality) {
  return new Promise(res => {
    try {
      canvas.toBlob(b => res(b && (type === 'image/png' || b.type === type) ? b : null), type, quality);
    } catch (e) { res(null); }
  });
}

/** Where a copy of `source` goes: beside it, or ~/Pictures when that folder can't take files. */
export function destFor(source) {
  const dir = source?.path ? vfs.parentPath(source.path) : picturesDir();
  return !importBlock(dir) && vfs.node(dir) ? dir : picturesDir();
}

export async function saveBlob(api, app, dir, name, blob, { title = 'Saved a copy' } = {}) {
  const { path } = await media.save(dir, name, blob);
  api.notify({
    app, icon: 'image', title, message: `${vfs.baseName(path)} · ${api.fmt.fmtBytes(blob.size)}`,
    actions: [
      { label: 'Open', onClick: () => api.openFile(path) },
      { label: 'Show in Files', onClick: () => api.openApp('files', { path }) },
    ],
  });
  return path;
}

/** The picture chooser: thumbnails of ~/Pictures plus "From computer…".
    opts: { multi, onChange(list, src, added) } — `selected()` is in pick order. */
export function pickerView(api, { multi = false, onChange = () => {}, label = 'Pictures' } = {}) {
  const { h, icon } = api;
  let alive = true;
  const items = listPictures();
  let sel = [];
  const input = h('input', { type: 'file', accept: 'image/*', multiple: multi, hidden: true, 'aria-label': 'Choose pictures from this computer' });
  const grid = h('div.pt__thumbs', { role: 'listbox', 'aria-label': label, 'aria-multiselectable': String(!!multi) });
  const info = h('small.pt__hint');
  const el = h('div.pt__picker', grid, h('div.pt__pickbar',
    h('button.btn.btn--sm', { type: 'button', onclick: () => input.click() }, icon('upload'), h('span', { text: 'From computer…' })),
    info, input));
  const thumbs = new Map();
  function cell(src) {
    const img = h('img', { alt: '', draggable: 'false' });
    if (src.path) media.urlOf(src.path).then(u => { if (u && alive) img.src = u; }).catch(() => {});
    else { const u = URL.createObjectURL(src.file); img.src = u; img.addEventListener('load', () => URL.revokeObjectURL(u), { once: true }); }
    const badge = h('i.pt__badge');
    const b = h('button.pt__thumb', {
      type: 'button', role: 'option', title: src.name, 'aria-selected': 'false', dataset: { name: src.name },
      onclick: () => toggle(src),
    }, img, badge, h('span', { text: src.name }));
    thumbs.set(src.key, { b, badge });
    return b;
  }
  function paint() {
    for (const [key, { b, badge }] of thumbs) {
      const i = sel.findIndex(s => s.key === key);
      b.setAttribute('aria-selected', String(i >= 0));
      b.classList.toggle('is-on', i >= 0);
      badge.textContent = i >= 0 ? (multi ? String(i + 1) : '✓') : '';
    }
    info.textContent = sel.length ? `${sel.length} picked` : (items.length ? 'Pick a picture' : 'No pictures in ~/Pictures yet. Use “From computer…”.');
  }
  function toggle(src) {
    const i = sel.findIndex(s => s.key === src.key);
    if (multi) { if (i >= 0) sel.splice(i, 1); else sel.push(src); }
    else sel = i >= 0 ? [] : [src];
    paint();
    onChange(sel.slice(), src, i < 0);
  }
  input.addEventListener('change', () => {
    for (const f of Array.from(input.files || [])) {
      if (!f.type.startsWith('image/') && media.kindOf(f.name) !== 'image') continue;
      const s = sourceOfFile(f);
      items.unshift(s);
      grid.prepend(cell(s));
      toggle(s);
    }
    input.value = '';
  });
  grid.replaceChildren(...items.map(cell));
  paint();
  return {
    el,
    selected: () => sel.slice(),
    pick(src) {
      if (!src) return;
      if (!thumbs.has(src.key)) { items.unshift(src); grid.prepend(cell(src)); }
      if (!sel.some(s => s.key === src.key)) toggle(src);
    },
    clear() { sel = []; paint(); },
    unpick(src) { sel = sel.filter(s => s.key !== src.key); paint(); },
    destroy() { alive = false; },
  };
}
