/* ============================================================
   radioalarm.js — the other half of Static Radio's wake-up alarm.

   The alarm itself is one of Clock's (js/core/alarms.js) with a station
   id on it. When it rings, alarms.js calls start() here, which opens
   Static Radio on that station — and Radio hands it to Music's player.

   It lives here, not in the Radio app, because Radio's code only loads
   when its window is first opened, and an alarm has to work with every
   window closed. It still only works while StaticOS is open in a tab:
   a closed or sleeping tab can't wake itself, and Radio says so where
   the alarm is set.
   ============================================================ */
import { BY_ID } from './stations.js';

/** Tune in for a ringing wake-up alarm. false when the station isn't one on the list. */
export function start(alarm) {
  const st = alarm && BY_ID.get(alarm.radio);
  if (!st) return false;
  import('./wm.js').then(wm => wm.open('radio', { station: st.id, wake: true })).catch(() => {});
  return true;
}

export default { start };
