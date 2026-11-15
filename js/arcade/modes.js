/* ============================================================
   arcade/modes.js — a game's modes and its own settings, as the
   shell keeps them (js/apps/arcade.js, the Options card).

   MODES. An entry in ./index.js may list
     modes: [{ id, label, tip?, better?, unit? }, …]
   The first is the game's usual mode. The HUD's Mode menu picks one
   (kept per game, js/arcade/options.js), the game reads it as
   ctx.mode, and each mode keeps its own best, best three and ghost:
   the first under the game's own id (so a best from before the game
   had modes stays its best), the others under `<id>:<mode>`. A mode
   may score the other way round or in other units (Stacker's Sprint
   is a time: better 'low', unit 'seconds'). A game with a picker of
   its own asks for another mode with ctx.setMode(id): the shell saves
   it and starts a fresh round in it. A Beat-this link, a ghost and a
   replay carry their mode; the weekly challenge and cups are always
   played in the first mode, so everyone plays the same game.

   SETTINGS. An entry may also list
     settings: [{ id, label, note?, type: 'switch'|'choice'|'range', def, … }]
   — how a game looks or feels to play (grid lines, a theme, mouse
   sensitivity), never how hard it is, so a setting never touches a
   best. The Options card shows them under "This game"; the game reads
   ctx.settings, a getter with the current values (defaults filled in),
   so a change made while paused is there when the round resumes.
     switch: def true|false · choice: options [{ id, label }], def id ·
     range: min, max, step, def, fmt: 'x' (×1.2), '%' (120%) or ''
   ============================================================ */

const ID = /^[a-z0-9-]{1,16}$/;

/** the game's modes, or null when it has fewer than two */
export const modesOf = g => (g && Array.isArray(g.modes) && g.modes.length > 1 ? g.modes : null);
/** the first (usual) mode's id, or null */
export const firstMode = g => modesOf(g)?.[0]?.id ?? null;
/** a mode by id — an unknown id is the first mode; null for a game without modes */
export function modeOf(g, id) {
  const ms = modesOf(g);
  if (!ms) return null;
  return ms.find(m => m.id === id) || ms[0];
}
/** is this one of the game's modes? */
export const isMode = (g, id) => !!modesOf(g)?.some(m => m.id === id);
/** a mode id as a link or a saved ghost may carry it: the id, or null */
export const cleanMode = v => (typeof v === 'string' && ID.test(v) ? v : null);

/** where a mode's best, best three and ghost are kept */
export function bestKey(g, id) {
  const m = modeOf(g, id);
  return !m || m.id === g.modes[0].id ? g.id : `${g.id}:${m.id}`;
}
/** the game as this mode scores it: the same entry with the mode's own `better` and `unit` */
export function scoring(g, id) {
  const m = modeOf(g, id);
  if (!m) return g;
  return { ...g, better: m.better || g.better, unit: m.unit || null, mode: m, first: m.id === g.modes[0].id };
}

/* ---------------- settings ---------------- */
const round = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
/** one setting's value, cleaned: anything unexpected is its default */
export function cleanSetting(s, v) {
  if (s.type === 'switch') return typeof v === 'boolean' ? v : !!s.def;
  if (s.type === 'choice') return s.options?.some(o => o.id === v) ? v : s.def;
  if (s.type === 'range') {
    const n = Number(v);
    if (!Number.isFinite(n)) return s.def;
    return Math.round(round(Math.max(s.min, Math.min(s.max, n)), s.step) * 1000) / 1000;
  }
  return s.def;
}
/** every setting of a game, from what was saved (an object, or nothing) */
export function settingsOf(g, saved) {
  const out = {};
  for (const s of Array.isArray(g?.settings) ? g.settings : []) out[s.id] = cleanSetting(s, saved && typeof saved === 'object' ? saved[s.id] : undefined);
  return Object.freeze(out);
}
/** how a range setting's value is shown */
export const fmtSetting = (s, v) => (s.fmt === 'x' ? `×${Number(v).toFixed(1)}` : s.fmt === '%' ? `${Math.round(v * 100)}%` : String(v));

export default { modesOf, firstMode, modeOf, isMode, cleanMode, bestKey, scoring, cleanSetting, settingsOf, fmtSetting };
