/* ============================================================
   aetherium.actions.js — the things Staticum can actually do.

   THE RULE THIS FILE EXISTS TO ENFORCE
   The brief puts it plainly: "the assistant should never claim
   that it did something when it did not." So an action is not a
   sentence the assistant composes — it is a function that runs,
   checks, and reports what actually happened.

   Every action returns the same shape:

     { ok, did, detail, data }

   `ok` is set from a real observation after the fact — the window
   count went up, the store now holds the new value, the note
   exists on disk. Never from "we called the function and it did
   not throw". If an action cannot verify its own effect it
   returns ok:false with a reason, and the assistant says so.

   The registry is deliberately flat and named the way the brief
   names them (open_app, set_theme, …) so a skill, a command
   palette entry, or a future model-driven caller can all reach
   the same implementations rather than each rolling their own.
   ============================================================ */

import * as THEMES from '../core/themes.js';
import * as WP from './wallpapers.js';
import * as M from '../core/metrics.js';

const result = (ok, did, detail = '', data = null) => ({ ok, did, detail, data });

/* A registry entry:
     args   — plain description of what it takes, used by help
     run    — async (params, ctx) -> result
   ctx is { api, navigate } exactly as the skills receive it. */
export const ACTIONS = {};

const action = (name, args, describe, run) => {
  ACTIONS[name] = { name, args, describe, run };
};

/* ---------- apps and windows ------------------------------- */

action('open_app', '<app id>', 'Open an application window.', async ({ app }, ctx) => {
  const id = String(app || '').trim();
  if (!id) return result(false, '', 'No application was named.');
  const registry = await import('../core/registry.js');
  const known = registry.listApps({ includeHidden: true });
  const found = known.find(a => a.id === id)
    || known.find(a => a.name?.toLowerCase() === id.toLowerCase())
    || known.find(a => a.name?.toLowerCase().includes(id.toLowerCase()));
  if (!found) return result(false, '', `There is no app called "${id}".`);

  const wm = await import('../core/wm.js');
  const before = wm.byApp(found.id).length;
  ctx.api.openApp(found.id, {});
  /* Give the window manager a frame to actually mount, then check. A
     singleton app that was already open will not add a window — that is
     a focus, not an open, and it should be reported as one. */
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = wm.byApp(found.id).length;
  if (after > before) return result(true, `opened ${found.name}`, '', { app: found.id });
  if (after > 0) return result(true, `focused ${found.name}`, 'It was already open.', { app: found.id });
  return result(false, '', `${found.name} did not open.`);
});

action('close_app', '<app id>', 'Close every window belonging to an app.', async ({ app }, ctx) => {
  const wm = await import('../core/wm.js');
  const id = String(app || '').trim();
  const open = wm.byApp(id);
  if (!open.length) return result(false, '', `${id || 'That app'} is not open.`);
  wm.closeApp(id);
  await new Promise(r => requestAnimationFrame(r));
  const left = wm.byApp(id).length;
  return left === 0
    ? result(true, `closed ${id}`, '', { closed: open.length })
    : result(false, '', `${left} window${left === 1 ? '' : 's'} refused to close.`);
});

action('close_all_windows', '', 'Close every open window.', async () => {
  const wm = await import('../core/wm.js');
  const before = wm.list().length;
  if (!before) return result(false, '', 'Nothing is open.');
  for (const w of wm.list()) wm.close(w.id);
  await new Promise(r => requestAnimationFrame(r));
  const after = wm.list().length;
  return after === 0
    ? result(true, `closed ${before} window${before === 1 ? '' : 's'}`)
    : result(false, '', `${after} window${after === 1 ? '' : 's'} would not close.`);
});

action('focus_window', '<app id>', 'Bring an app’s window to the front.', async ({ app }) => {
  const wm = await import('../core/wm.js');
  const open = wm.byApp(String(app || '').trim());
  if (!open.length) return result(false, '', `${app || 'That app'} is not open.`);
  wm.focus(open[0].id);
  await new Promise(r => requestAnimationFrame(r));
  const active = wm.getActive();
  return active && active.id === open[0].id
    ? result(true, `focused ${app}`)
    : result(false, '', 'The window manager did not change focus.');
});

action('list_windows', '', 'What is currently open.', async () => {
  const wm = await import('../core/wm.js');
  const rows = wm.list().map(w => ({ app: w.appId, id: w.id }));
  return result(true, `${rows.length} window${rows.length === 1 ? '' : 's'} open`, '', { windows: rows });
});

/* ---------- appearance ------------------------------------- */

action('set_theme', '<theme name>', 'Switch the accent theme.', async ({ theme }, ctx) => {
  const want = String(theme || '').trim();
  if (!want) return result(false, '', 'No theme was named.');
  const match = THEMES.THEMES.find(t =>
    t.id === want.toLowerCase()
    || t.name.toLowerCase() === want.toLowerCase()
    || t.name.toLowerCase().replace(/^aether\s+/, '') === want.toLowerCase());
  if (!match) {
    return result(false, '', `There is no theme called "${want}". There is ${
      THEMES.THEMES.map(t => t.name.replace(/^Static /, '')).join(', ')}.`);
  }
  const prefs = { ...ctx.api.store.get('prefs', {}), accent: match.id };
  ctx.api.store.set('prefs', prefs);
  THEMES.apply(match.id);
  const applied = document.documentElement.dataset.accent;
  return applied === match.id
    ? result(true, `switched to ${match.name}`, match.note, { theme: match.id })
    : result(false, '', 'The theme did not apply.');
});

action('change_wallpaper', '[name]', 'Change the desktop wallpaper.', async ({ name }, ctx) => {
  const list = WP.list(ctx.api.store);
  if (!list.length) return result(false, '', 'There are no wallpapers installed.');
  const current = WP.active(ctx.api.store);
  let pick;
  if (name) {
    pick = list.find(w => String(w.name || '').toLowerCase().includes(String(name).toLowerCase()));
    if (!pick) return result(false, '', `No wallpaper matches "${name}".`);
  } else {
    /* "change the wallpaper" with no name means the next one, not a random
       one — a random pick that lands on the current wallpaper looks broken. */
    const i = Math.max(0, list.findIndex(w => w.id === current?.id));
    pick = list[(i + 1) % list.length];
  }
  WP.setActive(ctx.api.store, pick.id);
  const now = WP.active(ctx.api.store);
  return now && now.id === pick.id
    ? result(true, `set the wallpaper to ${pick.name}`, '', { wallpaper: pick.id })
    : result(false, '', 'The wallpaper did not change.');
});

action('set_motion', '<on|off>', 'Turn interface animation on or off.', async ({ value }, ctx) => {
  const off = /off|reduce|less|stop|no/i.test(String(value || ''));
  const prefs = { ...ctx.api.store.get('prefs', {}), reduceMotion: off };
  ctx.api.store.set('prefs', prefs);
  const applied = document.body.classList.contains('reduce-motion');
  return applied === off
    ? result(true, off ? 'turned animation off' : 'turned animation on')
    : result(false, '', 'The motion preference did not take effect.');
});

/* ---------- content ---------------------------------------- */

action('create_note', '<text>', 'Write a note into the filesystem.', async ({ text, title }, ctx) => {
  const body = String(text || '').trim();
  if (!body) return result(false, '', 'There was nothing to write.');
  const vfs = ctx.api.vfs;
  const name = `${(title || body.split('\n')[0] || 'note')
    .replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 48) || 'note'}.md`;
  const path = `${vfs.HOME}/Documents/${name}`;
  try {
    vfs.write(path, body);
  } catch (err) {
    return result(false, '', `Could not write the note: ${err.message}`);
  }
  const node = vfs.node(path);
  return node
    ? result(true, `wrote ${name}`, `Saved in Documents.`, { path })
    : result(false, '', 'The note was not saved.');
});

action('search_files', '<query>', 'Find files by name.', async ({ q }, ctx) => {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return result(false, '', 'No search term.');
  /* vfs already has a recursive search that handles depth and limits —
     no reason to walk the tree by hand here. */
  const hits = ctx.api.vfs.search(term, { limit: 40, start: ctx.api.vfs.HOME })
    .map(n => n.path || n.name);
  return hits.length
    ? result(true, `found ${hits.length} file${hits.length === 1 ? '' : 's'}`, '', { files: hits })
    : result(false, '', `Nothing in your files matches "${q}".`);
});

const catalogue = async (mod, q, map) => {
  const m = await import(mod);
  await m.load();
  const res = m.query({ q, perPage: 8 });
  return res.items.map(map);
};

action('search_games', '<query>', 'Search the game catalogue.', async ({ q }) => {
  const rows = await catalogue('./games.data.js', q, g => ({ id: g.id, title: g.title, studio: g.studio }));
  return rows.length
    ? result(true, `found ${rows.length}`, '', { games: rows })
    : result(false, '', `No game matches "${q}".`);
});

action('search_roblox', '<query>', 'Search Roblox experiences.', async ({ q }) => {
  const rows = await catalogue('./roblox.data.js', q, r => ({ id: r.id, title: r.name, playing: r.playing }));
  return rows.length
    ? result(true, `found ${rows.length}`, '', { roblox: rows })
    : result(false, '', `No experience matches "${q}".`);
});

action('search_anime', '<query>', 'Search the anime library.', async ({ q }) => {
  const m = await import('./anime.data.js');
  await m.load();
  const term = String(q || '').toLowerCase();
  const rows = (m.all ? m.all() : [])
    .filter(a => String(a.title || '').toLowerCase().includes(term))
    .slice(0, 8)
    .map(a => ({ id: a.id, title: a.title }));
  return rows.length
    ? result(true, `found ${rows.length}`, '', { anime: rows })
    : result(false, '', `No title matches "${q}".`);
});

/* ---------- the web, without a tab ------------------------- */

action('open_url', '<url>', 'Open a site inside Static Proxy.', async ({ url }, ctx) => {
  const target = String(url || '').trim();
  if (!target) return result(false, '', 'No address given.');
  ctx.api.store.set('proxy.pending', target);
  const opened = await ACTIONS.open_app.run({ app: 'aether-proxy' }, ctx);
  return opened.ok
    ? result(true, `opening ${target} in Static Proxy`,
        'Nothing opens in a new tab — the page renders here.', { url: target })
    : result(false, '', 'Static Proxy would not open.');
});

/* ---------- status ----------------------------------------- */

action('show_system_status', '', 'Real performance readings.', async () => {
  const f = await M.full();
  const lines = [];
  if (f.fps != null) lines.push(`${f.fps} fps`);
  if (f.heap) lines.push(`${M.formatBytes(f.heap.used)} of JavaScript heap in use`);
  if (f.storage) lines.push(`${M.formatBytes(f.storage.used)} stored of ${M.formatBytes(f.storage.quota)}`);
  if (f.network) lines.push(`${M.formatBytes(f.network.transferred)} transferred over ${f.network.requests} requests`);
  if (f.hardware.cores) lines.push(`${f.hardware.cores} logical cores`);
  lines.push(`${f.windows.count} window${f.windows.count === 1 ? '' : 's'} open`);
  return result(true, 'read the real numbers', lines.join(' · '), { metrics: f });
});

/* ---------- running one ------------------------------------ */

export const names = () => Object.keys(ACTIONS);

export function describe() {
  return Object.values(ACTIONS).map(a => ({
    name: a.name, args: a.args, describe: a.describe,
  }));
}

/**
 * Run an action by name. Anything that goes wrong — unknown name, a throw
 * inside the action — comes back as an ordinary failed result, because the
 * assistant has to be able to say "that did not work" rather than crash.
 */
export async function run(name, params = {}, ctx) {
  const a = ACTIONS[name];
  if (!a) return result(false, '', `There is no action called "${name}".`);
  try {
    return await a.run(params, ctx);
  } catch (err) {
    return result(false, '', `${name} failed: ${err.message}`);
  }
}

export default { ACTIONS, run, names, describe };
