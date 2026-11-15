/* ============================================================
   snapassist.js — after you snap one window, fill the rest.

   Snap a window to a half or a third (drag it to an edge, the
   maximise button's layouts, or the keyboard) and the space left
   over opens a card: a live picture of every other window on this
   desktop. Click one and it snaps there. Escape, a click anywhere
   else, or snapping the window somewhere new closes it. It does
   not open if that space is already taken by a snapped window, if
   there is nothing else to pick, on a phone, or for a layout put
   back by Restore Layout (that fills every place itself).

   The snapping is wm.snap(); this only offers the pick.
   ============================================================ */
import { h } from '../core/dom.js';
import { bus } from '../core/bus.js';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import { icon } from '../core/icons.js';
import { shotOf } from '../core/winshot.js';
import { t } from '../core/i18n.js';

/* what is left over when a window sits in one of these */
export const REST = { left: 'right', right: 'left', up: 'down', down: 'up', l3: 'r23', r3: 'l23', l23: 'r3', r23: 'l3' };
const DELAY = 330;       /* the snap's own animation is 260 ms */

export function mountSnapAssist(host) {
  let card = null, rel = null, timer = 0, owner = null;

  function close() {
    clearTimeout(timer);
    owner = null;
    if (rel) { rel({ restoreFocus: false }); rel = null; }
    card?.remove();
    card = null;
  }

  const titleOf = w => w.el.getAttribute('aria-label') || w.app.name;

  function offer(w) {
    const zone = REST[w.snapped];
    const r = zone && wm.snapRect(zone);
    if (!r || !wm.get(w.id)) return;
    const taken = wm.onDesktop().some(o => o !== w && !o.min && !o.tabHidden && o.snapped === zone);
    const same = new Set(w.group ? w.group.tabs : [w]);
    const pick = wm.onDesktop().filter(o => !same.has(o) && !o.tabHidden && o.app.win.resizable !== false)
      .sort((a, b) => b.z - a.z);
    if (taken || !pick.length) return;
    close();
    owner = w;
    /* the pictures fit the space: as many across as fit, each about this wide */
    const cols = Math.max(1, Math.min(pick.length, Math.floor((r.w - 32) / 190)));
    const tw = Math.min(260, Math.floor((r.w - 32 - (cols - 1) * 12) / cols));
    const th = Math.min(170, Math.floor(r.h / 3));
    card = h('div.snap-assist', { role: 'dialog', 'aria-label': t('Pick a window for the rest of the screen'),
      style: { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } },
      h('div.snap-assist__box',
        h('div.snap-assist__title', { text: t('Pick a window for this side') }),
        h('div.snap-assist__grid', { style: { gridTemplateColumns: `repeat(${cols}, ${tw}px)` } },
          pick.map(o => h('button.snap-assist__win', {
            type: 'button', dataset: { win: String(o.id) }, 'aria-label': `Put ${titleOf(o)} here`,
            onclick: () => {
              close();
              if (o.min) wm.restore(o);
              o.quietSnap = true;
              try { wm.snap(o, zone); } finally { o.quietSnap = false; }
              wm.focus(o, { lift: true });
            },
          }, shotOf(o, tw, th, 'snap-assist__shot'), h('span.snap-assist__cap', icon(o.app.icon), h('span.trunc', { text: titleOf(o) + (o.min ? ' (hidden)' : '') }))))),
        h('button.btn.btn--ghost.btn--sm.snap-assist__skip', { type: 'button', text: t('Leave it empty'), onclick: close })));
    host.appendChild(card);
    rel = L.push({ name: 'snapassist', el: card, close });
    card.querySelector('.snap-assist__win')?.focus({ preventScroll: true });
  }

  const offs = [
    bus.on('win:snap', w => {
      if (!w || w.quietSnap || document.body.classList.contains('is-mobile') || w.max) return;
      close();
      if (!REST[w.snapped]) return;
      timer = setTimeout(() => offer(w), DELAY);
    }),
    bus.on('win:unsnap', w => { if (w === owner) close(); }),
    bus.on('win:close', w => { if (w === owner) close(); }),
    bus.on('win:minimize', w => { if (w === owner) close(); }),
    bus.on('desktop:switch', close),
    bus.on('overview:toggle', close),
  ];
  /* a click anywhere outside the card is a no */
  const away = e => { if (card && !card.contains(e.target)) close(); };
  window.addEventListener('pointerdown', away, true);
  /* a drag of the snapped window starts with a press on its title bar: that is the click above */

  return () => { offs.forEach(f => f()); window.removeEventListener('pointerdown', away, true); close(); };
}

export default mountSnapAssist;
