/* ============================================================
   roving.js — one Tab stop for a group, arrows inside it.

   The dock, the launcher's grid, the overview and the phone's app
   switcher are each one stop in the Tab order (WAI-ARIA "roving
   tabindex"): Tab lands on the item you were last on, the arrow
   keys move between items, Home/End jump to the ends.

   The shell repaints these groups by clearing and rebuilding them,
   which would throw away both the tabindex and — worse — the focus
   itself. So the helper keys items (data-app, data-key, or index),
   watches the container for repaints, re-applies the tab stop and,
   if the focused item was replaced, focuses its replacement.

     const off = roving(dockEl, {
       items: '.dock__item',          // selector, relative to the container
       orientation: 'horizontal',     // 'horizontal' | 'vertical' | 'both' | 'grid'
       columns: () => 5,              // for 'grid': items per row
     });
   ============================================================ */

const keyOf = (el, i) => el.dataset.key || el.dataset.app || el.dataset.win || el.dataset.dock || el.id || `#${i}`;

export function roving(container, { items = 'button', orientation = 'horizontal', columns = null, wrap = true } = {}) {
  let current = null;            // key of the item that owns the tab stop
  let inside = false;            // focus is (or was, before a repaint) inside
  const list = () => [...container.querySelectorAll(items)]
    .filter(el => !el.disabled && !el.hidden && el.getClientRects().length);

  function sync() {
    const all = list();
    if (!all.length) return;
    let owner = all.find((el, i) => keyOf(el, i) === current);
    if (!owner) { owner = all[0]; current = keyOf(owner, 0); }
    all.forEach(el => { el.tabIndex = el === owner ? 0 : -1; });
    /* the focused item was rebuilt: follow it to its replacement */
    const a = document.activeElement;
    if (inside && (!a || a === document.body || !a.isConnected)) owner.focus({ preventScroll: true });
  }

  function go(el) {
    if (!el) return;
    const all = list();
    current = keyOf(el, all.indexOf(el));
    all.forEach(x => { x.tabIndex = x === el ? 0 : -1; });
    el.focus({ preventScroll: false });
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = list();
    const i = all.indexOf(document.activeElement);
    if (i === -1) return;
    const n = all.length;
    const step = d => {
      let j = i + d;
      if (wrap) j = (j + n) % n; else j = Math.max(0, Math.min(n - 1, j));
      return all[j];
    };
    const cols = orientation === 'grid' ? Math.max(1, (typeof columns === 'function' ? columns() : columns) || 1) : 1;
    const H = orientation !== 'vertical', V = orientation !== 'horizontal';
    let next = null;
    switch (e.key) {
      case 'ArrowRight': if (H) next = step(1); break;
      case 'ArrowLeft':  if (H) next = step(-1); break;
      case 'ArrowDown':  if (V) next = orientation === 'grid' ? all[Math.min(n - 1, i + cols)] : step(1); break;
      case 'ArrowUp':    if (V) next = orientation === 'grid' ? all[Math.max(0, i - cols)] : step(-1); break;
      case 'Home': next = all[0]; break;
      case 'End': next = all[n - 1]; break;
      default: return;
    }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    go(next);
  }

  const onIn = e => {
    inside = true;
    const all = list();
    const i = all.indexOf(e.target.closest?.(items));
    if (i > -1) { current = keyOf(all[i], i); all.forEach(x => { x.tabIndex = x === all[i] ? 0 : -1; }); }
  };
  /* Focus leaving for somewhere else ends "inside". Focus lost because the
     item was removed by a repaint does not (Chrome fires focusout on removal
     too): check once the dust settles whether the item is still in the page. */
  const onOut = e => {
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    if (e.relatedTarget) { inside = false; return; }
    const was = e.target;
    queueMicrotask(() => { if (was.isConnected && !container.contains(document.activeElement)) inside = false; });
  };

  container.addEventListener('keydown', onKey);
  container.addEventListener('focusin', onIn);
  container.addEventListener('focusout', onOut);
  const mo = new MutationObserver(() => sync());
  mo.observe(container, { childList: true, subtree: true });
  sync();

  const off = () => {
    mo.disconnect();
    container.removeEventListener('keydown', onKey);
    container.removeEventListener('focusin', onIn);
    container.removeEventListener('focusout', onOut);
  };
  off.sync = sync;
  off.focus = key => { const all = list(); go(key == null ? (all.find((el, i) => keyOf(el, i) === current) || all[0]) : all.find((el, i) => keyOf(el, i) === key)); };
  return off;
}

export default roving;
