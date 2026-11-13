/* ============================================================
   cover.js — the shell goes inert under a full-screen surface.

   The boot manager, the boot animations, the lock screen and the
   screensaver all paint over a desktop that is already alive underneath. Without this, Tab
   walks focus into that hidden desktop (the wallpaper terminal, icons,
   the dock) and global shortcuts (Spotlight, Overview) open things no
   one can see — and keystrokes follow them.

   cover(why, on): while any reason is active, every child of #os
   except the covering surfaces is `inert`, and body[data-covered]
   names the reasons. Global key handlers check covered() and stand
   down. Reasons stack, so the lock screen shown during boot, or boot
   finishing while locked, never uncovers early.
   ============================================================ */

const KEEP = '.bp, .bootos, .boot, .lock, .ssaver, .tour, .users-login';   /* .ssaver: js/shell/screensaver.js; .tour: js/shell/tour.js, which cuts a hole round a real element; .users-login: js/shell/users.js */
const reasons = new Set();

export const covered = () => reasons.size > 0;

export function cover(why, on) {
  if (on) reasons.add(why); else reasons.delete(why);
  apply();
}

/* An element that is inert for its own reasons says so with data-inert
   (the phone shell's status bar, the home screen under an open app):
   uncovering leaves it inert instead of waking it up. */
function apply() {
  const host = document.getElementById('os');
  const active = reasons.size > 0;
  for (const el of host?.children || []) el.inert = (active && !el.matches(KEEP)) || el.hasAttribute('data-inert');
  if (active) document.body.dataset.covered = [...reasons].join(' ');
  else delete document.body.dataset.covered;
}

/* Anything the shell adds to #os while covered (a toast, a panel) must be
   inert too — watch for it. */
if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
  const start = () => {
    const host = document.getElementById('os');
    if (!host) return;
    new MutationObserver(() => { if (reasons.size) apply(); })
      .observe(host, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export default { cover, covered };
