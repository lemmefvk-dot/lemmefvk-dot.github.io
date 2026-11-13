/* ============================================================
   gamefiles.js — Game Projects and Replays in the file system.

   Keeps two real folders in step with real data (section 31):
     ~/Game Projects  one .aethergame shortcut per project you made in
                      Forge or Studio (opens it)
     ~/Replays        one .aetherclip file per Arcade clip you recorded
   Only files this module manages are added or removed there — anything
   you put in those folders yourself is left alone. No placeholder files.
   ============================================================ */
import { vfs } from './vfs.js';
import { bus } from './bus.js';

const PROJ_DIR = () => `${vfs.HOME}/Game Projects`;
const CLIP_DIR = () => `${vfs.HOME}/Replays`;
const safe = s => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled';
const parse = n => { try { return JSON.parse(n.content || '{}'); } catch (e) { return {}; } };

let busy = false;

async function syncProjects() {
  const P = await import('./projects.js');
  const list = await P.list();
  const dir = PROJ_DIR();
  if (!vfs.node(dir)) vfs.mkdir(dir);
  const managed = vfs.ls(dir).filter(n => n.type === 'file' && n.name.endsWith('.aethergame') && parse(n).kind === 'creation');
  const want = new Map(list.map(p => [p.id, p]));
  for (const n of managed) if (!want.has(parse(n).id)) vfs.rm(`${dir}/${n.name}`, { permanent: true });
  const have = new Map(vfs.ls(dir).filter(n => n.name.endsWith('.aethergame')).map(n => [parse(n).id, n]));
  const used = new Set(vfs.ls(dir).map(n => n.name));
  for (const p of list) {
    const body = JSON.stringify({ kind: 'creation', id: p.id, title: p.name }, null, 2);
    const cur = have.get(p.id);
    if (cur) {
      if (parse(cur).title !== p.name) {
        vfs.rm(`${dir}/${cur.name}`, { permanent: true });          /* renamed project: rename its file */
        used.delete(cur.name);
      } else continue;
    }
    let name = `${safe(p.name)}.aethergame`, k = 2;
    while (used.has(name)) name = `${safe(p.name)} (${k++}).aethergame`;
    used.add(name);
    vfs.write(`${dir}/${name}`, body);
  }
}

async function syncClips() {
  const { kv } = await import('./db.js');
  const clips = (await kv('clips').all()).filter(c => c && c.id);
  const dir = CLIP_DIR();
  if (!vfs.node(dir)) vfs.mkdir(dir);
  const managed = vfs.ls(dir).filter(n => n.type === 'file' && n.name.endsWith('.aetherclip'));
  const want = new Set(clips.map(c => c.id));
  for (const n of managed) if (!want.has(parse(n).clipId)) vfs.rm(`${dir}/${n.name}`, { permanent: true });
  const have = new Set(vfs.ls(dir).filter(n => n.name.endsWith('.aetherclip')).map(n => parse(n).clipId));
  for (const c of clips) {
    if (have.has(c.id)) continue;
    const when = new Date(c.at || Date.now());
    const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}.${String(when.getMinutes()).padStart(2, '0')}`;
    vfs.write(`${dir}/${safe(c.title || c.game)} ${stamp}.aetherclip`,
      JSON.stringify({ kind: 'clip', clipId: c.id, game: c.game, title: c.title, at: c.at, durationMs: c.durationMs }, null, 2));
  }
}

async function sync() {
  if (busy) return;
  busy = true;
  try { await syncProjects(); } catch (e) { console.warn('[gamefiles] projects', e); }
  try { await syncClips(); } catch (e) { console.warn('[gamefiles] clips', e); }
  busy = false;
}

let wired = false;
export function init() {
  if (wired) return;
  wired = true;
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(sync, 400); };
  bus.on('projects:change', later);
  bus.on('clips:change', later);
  sync();
}

export default { init };
