/* ============================================================
   wnbadge.js — "New since you last looked" on What's New's icon.

   js/shell/whatsnew-sheet.js records the newest release this browser
   has been told about (session.whatsNew.seen). What's New records the
   newest release its window has shown (portal.wnLooked, written when
   it opens). When the first is ahead of the second, the app's icon in
   the launcher and the dock carries a small "New" mark until the
   window is opened.

   It stays quiet when there is nothing to compare: a first visit and
   anyone who has not been through an update since this existed have
   no portal.wnLooked, so nothing is new *since* anything.
   ============================================================ */
import { store } from './store.js';

export const LOOKED = 'portal.wnLooked';
export const SEEN = 'session.whatsNew.seen';

/** '4.10' > '4.9' — numeric, part by part. */
export function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Is there a release this person has not opened What's New to see? */
export function hasNew() {
  const seen = store.get(SEEN, null);
  const looked = store.get(LOOKED, null);
  return !!seen && !!looked && cmpVersion(seen, looked) > 0;
}

/** What's New was opened and showed releases up to `version`. */
export function markLooked(version) {
  if (!version) return;
  const cur = store.get(LOOKED, null);
  if (!cur || cmpVersion(version, cur) > 0) store.set(LOOKED, String(version));
}

/** Start counting from here (nothing before it is "new"), unless already counting. */
export function startFrom(version) {
  if (version && store.get(LOOKED, null) == null) store.set(LOOKED, String(version));
}

/** The mark itself, or null. */
export const mark = h => (hasNew()
  ? h('span.wn-newmark', { text: 'New', title: 'New since you last looked', 'aria-hidden': 'true' })
  : null);
