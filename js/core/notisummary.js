/* ============================================================
   notisummary.js — the notification summary: quiet notifications
   gathered up and delivered at times you choose (Settings ›
   Notifications › Summary). The cards themselves are drawn by
   js/shell/notifications.js; this file is the saved choice and the
   clock arithmetic.

   prefs.notiSummary = { on, apps:[appId], times:['08:00','17:00'], at }
     apps   whose notifications wait for the summary instead of popping up
     times  up to 4 a day, local clock
     at     ms: the last delivery time already dealt with. A delivery time
            that has passed since (the page was closed, the laptop slept)
            is delivered on the next load.

   Never held: anything urgent (urgent: true — calendar, homework and
   reminder alerts), anything throughDnd (the focus timer's end note, and
   homework reminders too), progress
   notifications (they are a live readout, not news).
   ============================================================ */
import { store } from './store.js';

export const MAX_TIMES = 4;
export const DEFAULT_TIMES = ['08:00', '17:00'];
const KEY = 'prefs.notiSummary';

const mins = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); if (!m) return null; const h = +m[1], n = +m[2]; return h < 24 && n < 60 ? h * 60 + n : null; };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function config() {
  const r = store.get(KEY) || {};
  const times = [...new Set((Array.isArray(r.times) ? r.times : DEFAULT_TIMES).map(mins).filter(m => m !== null))].sort((a, b) => a - b).slice(0, MAX_TIMES).map(hhmm);
  return {
    on: r.on === true,
    apps: [...new Set((Array.isArray(r.apps) ? r.apps : []).map(a => String(a).toLowerCase()))],
    times: times.length ? times : DEFAULT_TIMES.slice(),
    at: Number(r.at) || 0,
  };
}

/** Save a change. Switching it on starts the clock from now, so a time that is already past is not "missed". */
export function configure(patch = {}) {
  const cur = config();
  const next = { ...cur, ...patch };
  if (patch.times) next.times = [...new Set(patch.times.map(mins).filter(m => m !== null))].sort((a, b) => a - b).slice(0, MAX_TIMES).map(hhmm);
  if (!cur.on && next.on) next.at = Date.now();
  store.set(KEY, next);
  return config();
}
export const markDelivered = ms => { const c = config(); store.set(KEY, { ...c, at: ms }); };

/** Is this notification one the summary holds back? `id` is the app id the caller resolved. */
export function holds(n, id) {
  const c = config();
  if (!c.on || !c.apps.length || !n) return false;
  if (n.urgent === true || n.throughDnd === true || typeof n.progress === 'number') return false;
  const app = String(id || n.appId || n.app || '').toLowerCase();
  return c.apps.includes(app);
}

/** The latest delivery time at or before `now` (ms), or 0 if there are none. */
export function lastSlot(now = new Date(), times = config().times) {
  let best = 0;
  for (const dayBack of [0, 1]) {
    for (const t of times) {
      const m = mins(t);
      const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayBack, Math.floor(m / 60), m % 60, 0, 0).getTime();
      if (ms <= now.getTime() && ms > best) best = ms;
    }
    if (best) break;
  }
  return best;
}

/** The next delivery time after `now` (ms), for Settings to say. */
export function nextSlot(now = new Date(), times = config().times) {
  let best = Infinity;
  for (const dayFwd of [0, 1]) {
    for (const t of times) {
      const m = mins(t);
      const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayFwd, Math.floor(m / 60), m % 60, 0, 0).getTime();
      if (ms > now.getTime() && ms < best) best = ms;
    }
  }
  return Number.isFinite(best) ? best : 0;
}
