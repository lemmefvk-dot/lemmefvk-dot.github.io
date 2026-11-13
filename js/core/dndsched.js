/* ============================================================
   dndsched.js — turns Do Not Disturb on and off by the schedules in
   js/core/dndrules.js (Settings › Notifications › Do Not Disturb
   schedule). It runs without any window: main.js starts it.

   Who owns Do Not Disturb. prefs.dnd is one switch with three
   possible hands on it:
     you        a switch you flipped (the bell, Control Centre, Settings)
     focus      js/core/focus.js, for a focus session (run.dnd)
     schedule   this file

   · A schedule starting turns it on. If it was already on, it is left
     as it was (yours or the focus timer's); when the focus timer is
     the one holding it, the schedule shares the hold.
   · When the schedule ends it turns Do Not Disturb off only if it
     turned it on (owned) — and not when a focus session is running
     and wants it: then the hold is handed to the focus session
     (focus.adoptDnd), which gives it back when the session ends.
   · The reverse: while a schedule holds Do Not Disturb, focus.js does
     not switch it off at the end or pause of a session (dndrules.holds).
   · Switching it off by hand during a schedule lasts until that
     schedule's end (state.override); switching it on again by hand
     during that time makes it yours.
   Everything is derived from the clock and the saved state, so a
   reload or a laptop that slept lands in the right place.
   bus 'dndsched:change' with info() when the indicator should repaint.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import * as R from './dndrules.js';
import * as focus from './focus.js';

let started = false;
let internal = false;     /* we are the one writing prefs.dnd */
let lastKey = '';

function setDnd(v) {
  internal = true;
  try { store.set('prefs.dnd', v); } finally { internal = false; }
}

/** What the top bar shows: { id, name, until } while a schedule holds Do Not Disturb, else null. */
export function info(now = new Date()) {
  if (!R.holds(now)) return null;
  const a = R.activeAt(now);
  return a ? { id: a.id, name: a.name, until: a.until } : null;
}

function emitChange() {
  const i = info();
  const key = i ? `${i.id}|${i.until}` : '';
  if (key === lastKey) return;
  lastKey = key;
  bus.emit('dndsched:change', i);
}

export function evaluate(now = new Date()) {
  const act = R.activeAt(now);
  let st = R.state();
  /* an override only lasts until the schedule it was made in ends */
  if (st.override && (now.getTime() >= st.override || !act)) st = { ...st, override: 0 };

  if (act) {
    if (!st.engaged) {
      const on = store.get('prefs.dnd') === true;
      st = { engaged: true, owned: !on || focus.state().dnd, override: 0 };
      if (!on) setDnd(true);
    } else if (!st.override && store.get('prefs.dnd') !== true) {
      setDnd(true);                                   /* switched off some other way: the schedule is in force */
      st = { ...st, owned: true };
    }
  } else if (st.engaged) {
    if (st.owned && store.get('prefs.dnd') === true) {
      if (focus.wantsDnd()) focus.adoptDnd();
      else setDnd(false);
    }
    st = { engaged: false, owned: false, override: 0 };
  }
  R.saveState(st);
  emitChange();
}

export function init() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => evaluate();
  bus.on('tick:1s', tick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  store.sub('prefs.dndSchedules', tick);
  store.sub('prefs.dnd', v => {
    if (internal) return;
    const st = R.state();
    if (!st.engaged) return;
    const a = R.activeAt();
    if (v === false && a && !st.override) {
      R.saveState({ ...st, owned: false, override: a.until });
      emitChange();
    } else if (v === true && st.override) {
      R.saveState({ ...st, owned: false, override: 0 });
      emitChange();
    }
  });
  evaluate();
}

export default { init, evaluate, info };
