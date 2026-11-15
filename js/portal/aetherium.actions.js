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

/* ---------- reminders, tasks, focus, Do Not Disturb, sound ----------
   Each one calls the app's own core module (automations, tasks, focus,
   dndsched, the prefs) and then reads the result back from it. */

action('set_reminder', '<text> and <at ms> | <seconds>', 'Make a reminder in Automations.', async ({ text, at, seconds, timer }) => {
  const AM = await import('../core/automations.js');
  const words = String(text || '').trim();
  if (!words) return result(false, '', 'What should the reminder say?');
  let r;
  if (seconds) r = AM.addTimer({ seconds, text: words, timer: !!timer });
  else {
    const d = new Date(Number(at));
    if (Number.isNaN(d.getTime())) return result(false, '', 'I could not tell when that is.');
    r = AM.addReminder({
      text: words, repeat: 'once', date: AM.ymd(d),
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    });
  }
  if (!r.ok) return result(false, '', (r.issues && r.issues[0] && r.issues[0].text) || 'That reminder could not be saved.');
  /* look it up again rather than trusting the call */
  const saved = AM.reminders().find(x => x.id === r.reminder.id);
  if (!saved) return result(false, '', 'The reminder was not saved.');
  const when = seconds ? r.at : AM.nextDue(saved);
  return result(true, `set a reminder: ${words}`, when ? AM.whenPhrase(when) : '', { id: saved.id, at: when });
});

action('add_task', '<text> [due YYYY-MM-DD] [priority]', 'Add a task to Tasks.', async ({ text, due, priority }) => {
  const T = await import('../core/tasks.js');
  const words = String(text || '').trim().slice(0, T.TEXT_MAX);
  if (!words) return result(false, '', 'What is the task?');
  const data = T.read();
  let list = data.lists.find(l => l.id === data.activeId) || data.lists[0];
  if (!list) { list = T.normList({ name: 'Tasks' }); data.lists.push(list); data.activeId = list.id; }
  const task = T.normTask({ id: T.uid('t'), text: words, due: due || null, priority: T.PRIOS.includes(priority) ? priority : 'none' });
  list.tasks.push(task);
  T.write(data);
  const back = T.locate(T.read(), task.id);
  return back
    ? result(true, `added the task: ${words}`, `In ${back.list.name}${task.due ? `, due ${task.due}` : ''}.`, { id: task.id, list: back.list.name, due: task.due })
    : result(false, '', 'The task was not saved.');
});

action('focus', '<start|pause|reset|skip>', 'Run the focus timer.', async ({ do: what }) => {
  const F = await import('../core/focus.js');
  const op = String(what || 'start');
  if (op === 'start') F.start();
  else if (op === 'pause') F.pause();
  else if (op === 'reset') F.reset();
  else if (op === 'skip') F.skip();
  else return result(false, '', `I do not know how to "${op}" the focus timer.`);
  const s = F.state();
  const mins = Math.max(1, Math.round(s.left / 60000));
  if (op === 'start') return s.status === 'running'
    ? result(true, `started ${s.label.toLowerCase()}`, `${mins} min, ${s.dnd ? 'Do Not Disturb is on' : 'Do Not Disturb is off'}.`, { state: s })
    : result(false, '', 'The focus timer did not start.');
  if (op === 'pause') return s.status === 'paused' ? result(true, 'paused the focus timer', `${mins} min left.`, { state: s })
    : s.status === 'ready' ? result(false, '', 'The focus timer is not running.') : result(false, '', 'The focus timer did not pause.');
  if (op === 'reset') return s.status === 'ready' ? result(true, 'reset the focus timer', '', { state: s }) : result(false, '', 'The timer did not reset.');
  return result(true, `moved on to ${s.label.toLowerCase()}`, '', { state: s });
});

action('set_dnd', '<on|off> [minutes]', 'Turn Do Not Disturb on or off.', async ({ on, minutes }, ctx) => {
  const want = on !== false;
  const sched = await import('../core/dndsched.js');
  const mins = Math.round(Number(minutes) || 0);
  if (want && mins > 0) sched.quickFor(mins * 60000);
  else ctx.api.store.set('prefs.dnd', want);
  const now = ctx.api.store.get('prefs.dnd') === true;
  if (now !== want) return result(false, '', `Do Not Disturb is still ${now ? 'on' : 'off'}.`);
  const rules = await import('../core/dndrules.js');
  /* off, but a schedule or a focus session holds it: the prefs may flip back on the next tick */
  const held = !want && rules.holds() ? 'A Do Not Disturb schedule is running, so it stays off only until that schedule ends.' : '';
  return result(true, want ? (mins > 0 ? `turned Do Not Disturb on for ${mins} min` : 'turned Do Not Disturb on') : 'turned Do Not Disturb off', held);
});

action('set_volume', '<0-100 | up | down | mute | unmute>', 'Change the system volume.', async ({ level, mute }, ctx) => {
  const st = ctx.api.store;
  if (mute !== undefined) {
    st.set('prefs.muted', !!mute);
    return st.get('prefs.muted') === !!mute
      ? result(true, mute ? 'muted the sound' : 'unmuted the sound', `The level is ${st.get('prefs.volume', 62)}%.`)
      : result(false, '', 'The mute setting did not change.');
  }
  const n = Math.max(0, Math.min(100, Math.round(Number(level))));
  if (!Number.isFinite(n)) return result(false, '', 'Say a level from 0 to 100.');
  st.set('prefs.volume', n);
  if (n > 0 && st.get('prefs.muted')) st.set('prefs.muted', false);
  return st.get('prefs.volume') === n
    ? result(true, `set the volume to ${n}%`, '', { level: n })
    : result(false, '', 'The volume did not change.');
});

action('open_settings_pane', '<pane id>', 'Open Settings on one pane.', async ({ pane }, ctx) => {
  const { SECTIONS } = await import('../apps/settings.js');
  const sec = SECTIONS.find(s => s.id === pane);
  if (!sec) return result(false, '', `Settings has no pane called "${pane}".`);
  const wm = await import('../core/wm.js');
  const before = wm.byApp('settings').length;
  ctx.api.openApp('settings', { section: sec.id });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (!wm.byApp('settings').length) return result(false, '', 'Settings did not open.');
  /* the window names the pane it is showing */
  await new Promise(r => setTimeout(r, 120));
  const w = wm.byApp('settings')[0];
  const shown = w && w.el && w.el.querySelector('.win__sub');
  const label = shown ? shown.textContent.trim() : '';
  if (label && label !== sec.name) return result(false, '', `Settings opened, but on ${label} instead of ${sec.name}. That pane may not be available right now.`);
  return result(true, `opened Settings on ${sec.name}`, before ? 'Settings was already open.' : '', { pane: sec.id, subtitle: label });
});

action('start_quiz', '<deck id> [cram]', 'Start a flashcard session in Study.', async ({ deck, cram }, ctx) => {
  const FC = await import('../core/flashcards.js');
  const d = FC.read().decks.find(x => x.id === deck);
  if (!d) return result(false, '', 'That deck is gone.');
  if (!d.cards.length) return result(false, '', `${d.name} has no cards yet.`);
  const wm = await import('../core/wm.js');
  ctx.api.openApp('study', { tab: 'cards', deck: d.id, start: cram ? 'cram' : 'study' });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return wm.byApp('study').length
    ? result(true, `started ${cram ? 'a cram session' : 'a session'} on ${d.name}`, '', { deck: d.id })
    : result(false, '', 'Study did not open.');
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
