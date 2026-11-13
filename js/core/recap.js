/* ============================================================
   recap.js — one week of this device, from records only.

   The week runs Monday to Sunday by the local calendar; a recap
   belongs to its Sunday. Every number comes from something this
   device actually kept, and a part with nothing in it is left out
   (null) rather than shown as a zero:

     time      js/core/screentime.js — seconds the front app was in
               use, per app and per game (by id)
     focus     js/core/focus.js — completed focus sessions and minutes
     made      files saved this week in ~/Pictures, ~/Videos and
               ~/Music (by their saved time; the files StaticOS ships
               with don't count), and games made in Forge or Studio
               (js/core/projects.js — created this week; not ones
               saved from someone else's link or imported from a file)
     badges    js/core/achievements.js — unlocked this week

   sundayOf(date)   'YYYY-MM-DD' of the Sunday ending date's week
                    (date itself on a Sunday)
   week(sunday)     Promise<recap> — see build() below
   ============================================================ */
import * as ST from './screentime.js';
import * as FOCUS from './focus.js';
import * as ACH from './achievements.js';
import { vfs } from './vfs.js';

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

/** The Sunday that closes the week `d` is in (d itself on a Sunday). */
export function sundayOf(d = new Date()) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((7 - d.getDay()) % 7));
  return keyOf(s);
}
/** The most recent Sunday on or before d: the last week that has ended or is ending today. */
export function lastSunday(d = new Date()) {
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
}
/** [start, end) of the week ending on that Sunday, in ms. */
export function bounds(sunday) {
  const end = dateOf(sunday);
  const from = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6).getTime();
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime();
  return { from, to };
}

export const FOLDERS = ['Pictures', 'Videos', 'Music'];

/** Files saved in ~/Pictures, ~/Videos and ~/Music during [from, to). */
export function filesSaved(from, to) {
  const out = {};
  for (const dir of FOLDERS) {
    let n = 0;
    try {
      vfs.walk(`${vfs.HOME}/${dir}`, node => {
        if (node.type !== 'file' || node.seed) return;
        const t = Date.parse(node.mtime);
        if (Number.isFinite(t) && t >= from && t < to) n++;
      });
    } catch (e) { /* no such folder */ }
    if (n) out[dir] = n;
  }
  return out;
}

/** Games made in Forge or Studio during [from, to) — not ones saved from a link. */
export async function gamesMade(from, to) {
  try {
    const P = await import('./projects.js');
    const all = await P.list();
    return all.filter(p => p && Number.isFinite(p.createdAt) && p.createdAt >= from && p.createdAt < to
      && !p.imported && !/^(Saved from a share link|Imported from )/.test(p.versions?.[0]?.note || '')).length;
  } catch (e) { return 0; }
}

/**
 * The week ending on `sunday`:
 *   { sunday, from, to,
 *     time:   { total, days, apps: [{id, sec}] ×≤3, games: [{key, title, icon, kind, sec}] ×≤3 } | null,
 *     focus:  { n, min } | null,
 *     made:   { files: { Pictures?, Videos?, Music? }, games: n, total } | null,
 *     badges: [{ id, name, icon, at }] | null,
 *     empty:  true when every part is null }
 */
export async function week(sunday = lastSunday()) {
  const { from, to } = bounds(sunday);

  const r = ST.range(7, sunday);
  const days = ST.week(sunday).filter(d => d.sec > 0).length;
  const time = r.total > 0 ? { total: r.total, days, apps: r.apps.slice(0, 3), games: r.games.slice(0, 3) } : null;

  const f = FOCUS.history(7, sunday).reduce((a, d) => ({ n: a.n + d.n, min: a.min + d.min }), { n: 0, min: 0 });
  const focus = f.n > 0 ? f : null;

  const files = filesSaved(from, to);
  const games = await gamesMade(from, to);
  const nFiles = Object.values(files).reduce((a, b) => a + b, 0);
  const made = nFiles + games > 0 ? { files, games, total: nFiles + games } : null;

  let badges = [];
  try {
    badges = ACH.list({}).filter(a => a.unlocked && a.at >= from && a.at < to).sort((a, b) => a.at - b.at)
      .map(({ id, name, icon, at }) => ({ id, name, icon, at }));
  } catch (e) { badges = []; }

  const out = { sunday, from, to, time, focus, made, badges: badges.length ? badges : null };
  out.empty = !time && !focus && !made && !out.badges;
  return out;
}

export default { sundayOf, lastSunday, bounds, week, filesSaved, gamesMade, FOLDERS };
