/* ============================================================
   filetags.js — colour tags for files and folders (Files › Tags).

   Where a tag lives: on the vfs node itself, as node.tags = ['Red', 'Work'].
   Moves, renames and Trash all keep the same node object, so a tag follows
   its file with no bookkeeping of paths (a path-keyed table would have to
   hear about every rename, move and trash, and would leave stale rows when
   something is deleted another way). vfs.js writes node.tags into its
   saved snapshot, so tags survive a reload. A copy is a new node and starts
   untagged.

   A tag is its name. Seven colour tags are built in (Red … Gray); a custom
   tag has any name you give it and one of those seven colours, kept in
   store 'prefs.fileTags' as [{ name, color }].
   ============================================================ */
import { vfs } from './vfs.js';
import { store } from './store.js';
import { bus } from './bus.js';

export const COLORS = [
  { id: 'red', name: 'Red', css: '#ff453a' },
  { id: 'orange', name: 'Orange', css: '#ff9f0a' },
  { id: 'yellow', name: 'Yellow', css: '#ffd60a' },
  { id: 'green', name: 'Green', css: '#30d158' },
  { id: 'blue', name: 'Blue', css: '#0a84ff' },
  { id: 'purple', name: 'Purple', css: '#bf5af2' },
  { id: 'gray', name: 'Gray', css: '#98989d' },
];
const colorById = id => COLORS.find(c => c.id === id) || COLORS[6];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const customList = () => {
  const v = store.get('prefs.fileTags');
  return Array.isArray(v) ? v.filter(t => t && typeof t.name === 'string') : [];
};

/** The tags that exist: the seven colours, then the custom ones. */
export function defs() {
  return [...COLORS.map(c => ({ name: c.name, color: c.id, css: c.css, builtin: true })),
    ...customList().map(t => ({ name: t.name, color: t.color, css: colorById(t.color).css, builtin: false }))];
}
/** The definition for a tag name (case-insensitive), or null. */
export const def = name => defs().find(t => same(t.name, name)) || null;
export const cssOf = name => (def(name) || { css: COLORS[6].css }).css;

/** The reason a name can't be a new tag, or null when it can. */
export function nameProblem(raw) {
  const name = String(raw || '').trim();
  if (!name) return 'Give the tag a name.';
  if (name.length > 30) return 'Tag names can be up to 30 characters.';
  if (/[,\n]/.test(name)) return 'Tag names can’t contain commas.';
  if (def(name)) return `There is already a tag named “${def(name).name}”.`;
  return null;
}
export function create(name, color = 'gray') {
  if (nameProblem(name)) return null;
  const t = { name: String(name).trim(), color: colorById(color).id };
  store.set('prefs.fileTags', [...customList(), t]);
  return t;
}

export const tagsOf = n => (n && Array.isArray(n.tags) ? n.tags : []);
export const hasTag = (n, name) => tagsOf(n).some(t => same(t, name));

function touched(path) {
  /* the same event a rename or write sends: Files repaints and vfs saves */
  bus.emit('fs:change', vfs.parentPath(path), path);
  bus.emit('tags:change', { path });
}

export function add(path, name) {
  const n = vfs.node(path);
  const d = def(name);
  if (!n || !d || hasTag(n, d.name)) return false;
  n.tags = [...tagsOf(n), d.name];
  touched(path);
  return true;
}
export function remove(path, name) {
  const n = vfs.node(path);
  if (!n || !hasTag(n, name)) return false;
  const next = tagsOf(n).filter(t => !same(t, name));
  if (next.length) n.tags = next; else delete n.tags;
  touched(path);
  return true;
}
/** Add the tag if the item lacks it, take it off if it has it. */
export function toggle(path, name) {
  return hasTag(vfs.node(path), name) ? remove(path, name) : add(path, name);
}
export function clear(path) {
  const n = vfs.node(path);
  if (!n || !tagsOf(n).length) return false;
  delete n.tags;
  touched(path);
  return true;
}

/** Everything wearing a tag: [{ node, path }] across the drive, Trash included
    (it is still your file until it is emptied). */
export function withTag(name) {
  const out = [];
  vfs.walk(vfs.HOME, (n, path) => { if (hasTag(n, name)) out.push({ node: n, path }); });
  return out.sort((a, b) => a.node.name.localeCompare(b.node.name, undefined, { numeric: true, sensitivity: 'base' }));
}
/** [{ name, color, css, builtin, count }] for the sidebar: every tag, with its real count. */
export function counts() {
  const tally = new Map();
  vfs.walk(vfs.HOME, n => { for (const t of tagsOf(n)) { const d = def(t); if (d) tally.set(d.name, (tally.get(d.name) || 0) + 1); } });
  return defs().map(d => ({ ...d, count: tally.get(d.name) || 0 }));
}
/** Forget a custom tag and take it off everything. The built-in colours stay. */
export function deleteTag(name) {
  const d = def(name);
  if (!d || d.builtin) return false;
  vfs.walk(vfs.HOME, (n, path) => { if (hasTag(n, d.name)) remove(path, d.name); });
  store.set('prefs.fileTags', customList().filter(t => !same(t.name, d.name)));
  return true;
}

export default { COLORS, defs, def, cssOf, nameProblem, create, tagsOf, hasTag, add, remove, toggle, clear, withTag, counts, deleteTag };
