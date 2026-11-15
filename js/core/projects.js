/* ============================================================
   projects.js — game projects shared by Forge, Studio, Asset Lab
   and Static Play.

   A project is one self-contained HTML game (a single document:
   markup, style and script together) plus a version history. Every
   change — an AI edit in Forge, a manual save in Studio, a revert —
   is a new version; nothing is ever overwritten in place, so any
   earlier state can be restored.

   Project shape (stored in IndexedDB, store 'projects'):
     { id, name, prompt, createdAt, updatedAt, source: 'forge'|'studio'|'remix',
       remixOf: id|null, creator,
       versions: [{ id, html, note, at, by: 'ai'|'you'|'revert' }],
       head: index into versions (undo/redo move it),
       assets: [{ id, name, kind: 'image'|'audio', dataUrl }],
       published: null | { at, version, title, description, controls, category, thumbnail } }

   API (all async): list(), get(id), create({...}), commit(id, html, note, by),
   undo(id), redo(id), restore(id, versionIndex), rename(id, name),
   duplicate(id), remix(id, name, { html, prompt, note }?), remove(id), publish(id, meta),
   unpublish(id), addAsset(id, asset), setAssetSheet(id, assetId, sheet), removeAsset(id, assetId),
   importFull(raw) (a whole game with history and assets from a file; checked, never overwrites),
   current(p) -> the html at head.
   Emits bus 'projects:change' { id, kind } after every write.
   ============================================================ */
import { kv } from './db.js';
import { bus } from './bus.js';
import { store } from './store.js';

const DB = kv('projects');
const MAX_VERSIONS = 60;

const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const who = () => {
  const u = store.get('session.user', null);
  return u ? (u.name || u.username) : 'you';
};
const emit = (id, kind) => { bus.emit('projects:change', { id, kind }); return id; };

export const current = p => (p && p.versions[p.head] ? p.versions[p.head].html : '');

export async function list() {
  const all = await DB.all();
  return all.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const get = id => DB.get(id);

async function put(p) {
  p.updatedAt = Date.now();
  await DB.set(p.id, p);
  return p;
}

/* `event` is the projects:change kind: 'create' for a game made here, 'import'
   for one that arrived from someone else (a share link), so nothing that counts
   your own making (achievements) mistakes a saved gift for your work */
export async function create({ name = 'Untitled game', prompt = '', html = '', source = 'forge', note = 'First version', by = 'ai', remixOf = null, event = 'create', creator = null } = {}) {
  const now = Date.now();
  const p = {
    id: uid('game'), name, prompt, createdAt: now, updatedAt: now, source, remixOf, creator: creator || who(),
    ...(event === 'import' ? { imported: true } : {}),      /* someone else's game, saved here (recap.js doesn't count it as yours) */
    versions: [{ id: uid('v'), html, note, at: now, by }], head: 0, assets: [], published: null,
  };
  await put(p);
  emit(p.id, event === 'import' ? 'import' : 'create');
  return p;
}

/* A whole game, history and assets, arriving from a file (Static Creator's "Export every game"). Everything is
   checked and capped, nothing is run, and nothing is overwritten: a game whose id is taken keeps the id it
   has and this one gets a new id, unless the game already here is the very same (the head matches), in
   which case it is skipped.
   -> { status: 'added' | 'copy' | 'same', project } | null for something that is not a game */
const IMPORT_HTML_MAX = 2 * 1024 * 1024;
const IMPORT_ASSET_MAX = 8 * 1024 * 1024;
export async function importFull(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const all = Array.isArray(raw.versions) ? raw.versions : [];
  const vs = all.filter(v => v && typeof v === 'object' && typeof v.html === 'string' && v.html.length <= IMPORT_HTML_MAX);
  if (!vs.length) return null;
  const head = Number.isInteger(raw.head) && raw.head >= 0 && raw.head < all.length ? all[raw.head] : null;
  const keep = vs.slice(-MAX_VERSIONS);
  const headIdx = head && keep.includes(head) ? keep.indexOf(head) : keep.length - 1;
  const str = (v, n) => String(v ?? '').slice(0, n);
  const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : Date.now());
  const existing = typeof raw.id === 'string' && raw.id ? await get(raw.id) : null;
  if (existing && current(existing) === keep[headIdx].html) return { status: 'same', project: existing };
  const id = typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) && !existing ? raw.id : uid('game');
  const p = {
    id, name: str(raw.name, 120) || 'Untitled game', prompt: str(raw.prompt, 1200),
    createdAt: num(raw.createdAt), updatedAt: Date.now(),
    source: ['forge', 'studio', 'remix'].includes(raw.source) ? raw.source : 'forge',
    remixOf: null, creator: str(raw.creator, 60) || who(),
    versions: keep.map(v => ({ id: uid('v'), html: v.html, note: str(v.note, 200) || 'Imported', at: num(v.at), by: ['ai', 'you', 'revert'].includes(v.by) ? v.by : 'you' })),
    head: headIdx,
    assets: (Array.isArray(raw.assets) ? raw.assets : []).slice(0, 100)
      .filter(a => a && typeof a === 'object' && typeof a.dataUrl === 'string' && a.dataUrl.length <= IMPORT_ASSET_MAX
        && (a.kind === 'audio' ? /^data:audio\//i : /^data:image\//i).test(a.dataUrl))
      .map(a => ({ id: uid('a'), name: str(a.name, 80) || 'asset', kind: a.kind === 'audio' ? 'audio' : 'image', dataUrl: a.dataUrl,
        ...(a.kind !== 'audio' && a.sheet && typeof a.sheet === 'object' && !Array.isArray(a.sheet) ? { sheet: a.sheet } : {}) })),
    published: null,
  };
  await put(p);
  emit(p.id, 'import');
  return { status: existing ? 'copy' : 'added', project: p };
}

/** A new version on top of head. Anything that had been undone is dropped,
    as in any editor: redo history ends where a new edit begins. */
export async function commit(id, html, note = 'Edited', by = 'you') {
  const p = await get(id);
  if (!p) throw new Error('project not found');
  p.versions = p.versions.slice(0, p.head + 1);
  p.versions.push({ id: uid('v'), html, note, at: Date.now(), by });
  if (p.versions.length > MAX_VERSIONS) p.versions = p.versions.slice(-MAX_VERSIONS);
  p.head = p.versions.length - 1;
  await put(p);
  emit(id, by === 'ai' ? 'ai-edit' : 'commit');
  return p;
}

export async function undo(id) {
  const p = await get(id);
  if (!p || p.head <= 0) return p;
  p.head -= 1;
  await put(p);
  emit(id, 'undo');
  return p;
}

export async function redo(id) {
  const p = await get(id);
  if (!p || p.head >= p.versions.length - 1) return p;
  p.head += 1;
  await put(p);
  emit(id, 'redo');
  return p;
}

/** Restoring an old version adds it as a NEW version, so the history
    between is kept and the restore itself can be undone. */
export async function restore(id, index) {
  const p = await get(id);
  const v = p?.versions[index];
  if (!v) return p;
  return commit(id, v.html, `Restored "${v.note}"`, 'revert');
}

export async function rename(id, name) {
  const p = await get(id);
  if (!p) return null;
  p.name = String(name || '').trim().slice(0, 60) || p.name;
  await put(p);
  emit(id, 'rename');
  return p;
}

export async function duplicate(id) {
  const p = await get(id);
  if (!p) return null;
  const copy = await create({ name: `${p.name} (copy)`, prompt: p.prompt, html: current(p), source: p.source, note: `Copied from "${p.name}"`, by: 'you' });
  copy.assets = (p.assets || []).map(a => ({ ...a }));
  await put(copy);
  return copy;
}

/** A remix is a new project that credits its original. It starts from the
    original's current version, or from `over.html` (Forge's Remix view
    passes the document with its settings changed) with `over.prompt` as
    its description. The original is never written to. */
export async function remix(id, name, over = {}) {
  const p = await get(id);
  if (!p) return null;
  const html = typeof over.html === 'string' && over.html ? over.html : current(p);
  const prompt = typeof over.prompt === 'string' ? over.prompt.slice(0, 600) : p.prompt;
  const r = await create({ name: name || `${p.name} remix`, prompt, html, source: 'remix', remixOf: p.id, note: over.note || `Remix of "${p.name}" by ${p.creator}`, by: 'you' });
  r.assets = (p.assets || []).map(a => ({ ...a }));
  r.remixCredit = { id: p.id, name: p.name, creator: p.creator };
  await put(r);
  emit(r.id, 'remix');
  return r;
}

export async function remove(id) {
  await DB.del(id);
  emit(id, 'remove');
}

export async function publish(id, meta = {}) {
  const p = await get(id);
  if (!p) return null;
  p.published = {
    at: Date.now(), version: p.head,
    title: String(meta.title || p.name).slice(0, 60),
    description: String(meta.description || '').slice(0, 600),
    controls: String(meta.controls || '').slice(0, 300),
    category: String(meta.category || 'action'),
    thumbnail: meta.thumbnail || p.published?.thumbnail || null,
    updates: [...(p.published?.updates || []), { at: Date.now(), version: p.head, note: meta.note || (p.published ? 'Updated' : 'First release') }].slice(-30),
  };
  await put(p);
  emit(id, 'publish');
  return p;
}

export async function unpublish(id) {
  const p = await get(id);
  if (!p) return null;
  p.published = null;
  await put(p);
  emit(id, 'unpublish');
  return p;
}

export async function addAsset(id, asset) {
  const p = await get(id);
  if (!p) return null;
  const a = { id: uid('a'), name: String(asset.name || 'asset'), kind: asset.kind === 'audio' ? 'audio' : 'image', dataUrl: String(asset.dataUrl || '') };
  if (a.kind === 'image' && asset.sheet && typeof asset.sheet === 'object') a.sheet = asset.sheet;
  p.assets = [...(p.assets || []), a];
  await put(p);
  emit(id, 'asset');
  return a;
}

/** Attach sprite-sheet data (frame boxes, clips) to an image asset; null takes it off. */
export async function setAssetSheet(id, assetId, sheet) {
  const p = await get(id);
  const a = p && (p.assets || []).find(x => x.id === assetId && x.kind === 'image');
  if (!a) return null;
  if (sheet && typeof sheet === 'object') a.sheet = sheet; else delete a.sheet;
  await put(p);
  emit(id, 'asset');
  return a;
}

export async function removeAsset(id, assetId) {
  const p = await get(id);
  if (!p) return null;
  p.assets = (p.assets || []).filter(a => a.id !== assetId);
  await put(p);
  emit(id, 'asset');
  return p;
}

export default { list, get, create, commit, undo, redo, restore, rename, duplicate, remix, remove, publish, unpublish, addAsset, setAssetSheet, removeAsset, importFull, current };
