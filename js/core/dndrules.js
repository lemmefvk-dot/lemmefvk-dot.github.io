/* ============================================================
   dndrules.js — Do Not Disturb schedules: the saved list and the
   clock arithmetic. Pure and import-light, so focus.js, the top bar
   and Settings can all read it; the part that actually turns Do Not
   Disturb on and off is js/core/dndsched.js.

   prefs.dndSchedules  [{ id, name, days:[0..6, 0 = Sunday],
                          start:'HH:MM', end:'HH:MM', on:true }]
     an end earlier than the start runs overnight and belongs to the
     day it STARTED on (Friday 22:00 → 07:00 is a Friday schedule)
   prefs.dndSchedState { engaged, owned, override }
     engaged   a schedule has taken charge of Do Not Disturb
     owned     the schedule turned it on itself (so it turns it off)
     override  ms: you switched it off by hand; lasts until then
   ============================================================ */
import { store } from './store.js';

export const MAX_SCHEDULES = 6;
export const PRESETS = {
  school: { name: 'School hours', days: [1, 2, 3, 4, 5], start: '08:30', end: '15:30' },
  night:  { name: 'Night',        days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' },
};

const mins = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); if (!m) return null; const h = +m[1], n = +m[2]; return h < 24 && n < 60 ? h * 60 + n : null; };
export const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const norm = t => { const m = mins(t); return m === null ? null : hhmm(m); };

export function schedules() {
  const raw = store.get('prefs.dndSchedules');
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw.slice(0, MAX_SCHEDULES)) {
    if (!s || typeof s !== 'object') continue;
    const start = norm(s.start), end = norm(s.end);
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
    if (!start || !end) continue;
    out.push({ id: String(s.id || `s${out.length + 1}`), name: String(s.name || 'Schedule').slice(0, 40), days, start, end, on: s.on !== false });
  }
  return out;
}
export const saveSchedules = list => store.set('prefs.dndSchedules', list.slice(0, MAX_SCHEDULES).map(s => ({ ...s })));

export function state() {
  const r = store.get('prefs.dndSchedState') || {};
  return { engaged: r.engaged === true, owned: r.owned === true, override: Number(r.override) || 0 };
}
export function saveState(next) {
  const a = state();
  if (a.engaged === next.engaged && a.owned === next.owned && a.override === next.override) return;
  store.set('prefs.dndSchedState', { engaged: !!next.engaged, owned: !!next.owned, override: Number(next.override) || 0 });
}

const at = (d, m, plusDays = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays, Math.floor(m / 60), m % 60, 0, 0).getTime();

/** The schedule in force at `now` (the one that lasts longest if several overlap): { id, name, until } or null. */
export function activeAt(now = new Date(), list = schedules()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay(), yesterday = (today + 6) % 7;
  let best = null;
  for (const s of list) {
    if (!s.on) continue;
    const a = mins(s.start), b = mins(s.end);
    if (a === null || b === null || a === b) continue;
    let until = 0;
    if (a < b) { if (s.days.includes(today) && cur >= a && cur < b) until = at(now, b); }
    else if (s.days.includes(today) && cur >= a) until = at(now, b, 1);
    else if (s.days.includes(yesterday) && cur < b) until = at(now, b);
    if (until && (!best || until > best.until)) best = { id: s.id, name: s.name, until };
  }
  return best;
}

/** A schedule holds Do Not Disturb now: it took charge and you haven't overridden it. */
export function holds(now = new Date()) {
  const st = state();
  return st.engaged && !st.override && !!activeAt(now);
}

/** The end time as the clock shows it ("3:30 PM", or "Mon 7:00 AM" when it is not today). */
export function untilLabel(ms, h24 = false) {
  const d = new Date(ms), now = new Date();
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const t = h24 ? `${String(h).padStart(2, '0')}:${m}` : `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return same ? t : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${t}`;
}
