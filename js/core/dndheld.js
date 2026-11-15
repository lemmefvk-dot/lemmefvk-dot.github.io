/* ============================================================
   dndheld.js — what Do Not Disturb kept off the screen.

   A notification that arrives while Do Not Disturb is on skips its
   pop-up and goes to the Notification Centre. This counts those, so
   the bell can say "3 missed", the centre can offer "Show held", and
   the lock screen can say how many came in since you locked.

   The list is what the centre holds: js/shell/notifications.js calls
   set() with the times of the held notes that have not been seen
   (opening the centre marks them seen). Nothing is stored here.
   bus 'dndheld:change' with count() when it moves.
   ============================================================ */
import { bus } from './bus.js';

let times = [];

/** ms timestamps of notifications Do Not Disturb held that you haven't looked at yet. */
export function set(list) {
  const next = list.map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  if (next.length === times.length && next.every((t, i) => t === times[i])) return;
  times = next;
  bus.emit('dndheld:change', times.length);
}
/** How many (since `since` ms, when given). */
export const count = (since = 0) => times.filter(t => t >= since).length;

export default { set, count };
