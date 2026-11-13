/* ============================================================
   contextmenu.js — context menus + the confirm sheet
   'menu:open' {items,x,y} draws one .menu (hover submenus, kept
   on screen with placeInView) — after 'menu:extend' {items, extra}
   lets the shell put rows of its own on top; 'dialog:confirm' draws a centred
   sheet and resolves the promise behind api.confirm().
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as L from '../core/layers.js';

export function mountMenus(host) {
  const { h, icon, on, placeInView, bus } = api;

  /* layers[0] is the root menu, the rest are open submenus */
  const layers = [];
  let offs = [];
  let prevFocus = null;
  let release = null;     /* the Escape layer (js/core/layers.js) */
  let edge = null;        /* onEdge(dir) from a menu bar, for ←/→ on the top level */

  /* ---------------- menu ----------------- */
  function closeFrom(depth) {
    while (layers.length > depth) {
      layers.pop().remove();
      layers[layers.length - 1]?.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
    }
    if (layers.length) return;
    offs.splice(0).forEach(off => off());
    edge = null;
    /* we focused a row on open — give the caret back to whatever the
       user was typing in, or right-click in a field eats their focus.
       core/layers.js does it, and finds the control's twin when the shell
       has redrawn it meanwhile (the dock repaints while a menu is up). */
    const back = prevFocus;
    prevFocus = null;
    if (release) { release(); release = null; }
    else if (back && back.isConnected) back.focus({ preventScroll: true });
  }
  const closeMenu = () => closeFrom(0);

  function row(it, depth) {
    if (it === '-') return h('div.menu__sep', { role: 'separator' });
    if (it.header) return h('div.menu__label', { text: it.label || '', role: 'presentation' });

    const kids = Array.isArray(it.items) && it.items.length ? it.items : null;
    const el = h('button.menu__item', {
      type: 'button',
      role: it.checked != null ? 'menuitemcheckbox' : 'menuitem',
      tabindex: '-1',
      disabled: !!it.disabled,
      'aria-disabled': it.disabled ? 'true' : null,
      'aria-checked': it.checked != null ? String(!!it.checked) : null,
      'aria-haspopup': kids ? 'menu' : null,
      'aria-expanded': kids ? 'false' : null,
      class: [it.danger && 'is-danger', it.disabled && 'is-disabled'].filter(Boolean).join(' ') || null,
      onclick: () => {
        if (kids) { if (!it.disabled) { closeFrom(depth + 1); openLayer(kids, depth + 1, el, true); } return; }
        closeMenu(); it.onClick?.();
      },
      onmouseenter: () => {
        closeFrom(depth + 1);
        if (kids && !it.disabled) openLayer(kids, depth + 1, el);
      },
    },
      it.checked ? icon('check')
        : it.icon ? icon(it.icon)
        : h('span', { style: { width: '14px', flex: '0 0 auto' } }),
      h('span.grow.trunc', { text: it.label || '' }),
      kids ? icon('chevron-right') : it.hint ? h('small', { text: it.hint, 'aria-hidden': 'true' }) : null);
    el._kids = kids && !it.disabled ? kids : null;
    return el;
  }

  function panel(items, depth, label) {
    const el = h('div.menu', { role: 'menu', 'aria-label': label || 'Menu', 'aria-orientation': 'vertical' });
    for (const it of items || []) if (it) el.appendChild(row(it, depth));
    el.addEventListener('keydown', e => onKey(e, el, depth));
    return el;
  }

  /* ---------------- keyboard ------------- */
  const rowsOf = el => [...el.querySelectorAll(':scope > .menu__item')].filter(b => !b.disabled);

  function onKey(e, el, depth) {
    const rows = rowsOf(el);
    const i = rows.indexOf(document.activeElement);
    const focusAt = j => rows[(j + rows.length) % rows.length]?.focus({ preventScroll: true });
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(i < 0 ? -1 : i - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(-1); break;
      case 'ArrowRight': {
        const cur = rows[i];
        e.preventDefault();
        if (cur && cur._kids) { closeFrom(depth + 1); openLayer(cur._kids, depth + 1, cur, true); }
        else if (depth === 0 && edge) { const fn = edge; closeMenu(); fn(1); }
        break;
      }
      case 'ArrowLeft':
        e.preventDefault();
        if (depth > 0) {
          const owner = layers[depth - 1]?.querySelector('[aria-expanded="true"]');
          closeFrom(depth);
          owner?.focus({ preventScroll: true });
        } else if (edge) { const fn = edge; closeMenu(); fn(-1); }
        break;
      case 'Tab': e.preventDefault(); closeMenu(); break;     /* a menu is not a Tab stop */
      default:
        /* type-ahead: the first row whose label starts with the letter */
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = e.key.toLowerCase();
          const from = i + 1;
          const order = [...rows.slice(from), ...rows.slice(0, from)];
          const hit = order.find(b => b.textContent.trim().toLowerCase().startsWith(k));
          if (hit) { e.preventDefault(); hit.focus({ preventScroll: true }); }
        }
    }
  }

  /** Submenu: mount, then slide it beside the row that owns it. */
  function openLayer(items, depth, anchor, focusFirst) {
    const el = panel(items, depth, anchor.textContent.trim());
    host.appendChild(el);
    layers.push(el);
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect();
    const owner = anchor.closest('.menu')?.getBoundingClientRect() || r;
    const w = el.getBoundingClientRect().width;
    /* no room on the right (a menu opened near the screen's edge): open on
       the parent's left instead of being pushed back on top of it, where it
       would cover the very row that opened it */
    const x = r.right - 4 + w > window.innerWidth - 8 ? Math.max(8, owner.left - w + 4) : r.right - 4;
    placeInView(el, x, r.top - 6);
    if (focusFirst) rowsOf(el)[0]?.focus({ preventScroll: true });
  }

  function openMenu({ items, x = 0, y = 0, label = '', onEdge = null } = {}) {
    closeMenu();
    /* other shell parts may add rows on top of an app's menu: a right-click
       on selected text gets "Read aloud" (js/shell/readaloud.js) */
    const extra = [];
    bus.emit('menu:extend', { items, extra, x, y });
    if (extra.length) items = [...extra, '-', ...(items || [])];
    const af = document.activeElement;
    prevFocus = af && af !== document.body && typeof af.focus === 'function' ? af : null;
    /* opened from the keyboard (the menu key, Shift+F10): no pointer
       position, so open beside the focused control instead of at 0,0 */
    if (!(x > 0 || y > 0) && prevFocus) {
      const r = prevFocus.getBoundingClientRect();
      x = r.left + Math.min(16, r.width / 2);
      y = r.bottom + 4;
    }
    const el = panel(items, 0, label);
    host.appendChild(el);
    layers.push(el);
    placeInView(el, x, y);
    edge = typeof onEdge === 'function' ? onEdge : null;
    /* Escape closes the deepest submenu first and lands on the row that
       opened it; on the top level it closes the menu */
    release = L.push({ name: 'menu', el, close: () => {
      if (layers.length > 1) {
        const owner = layers[layers.length - 2].querySelector('[aria-expanded="true"]');
        closeFrom(layers.length - 1);
        owner?.focus({ preventScroll: true });
      } else closeMenu();
    } });
    /* A scroll already under way when the menu opened is not the user
       scrolling away: the browser bringing the pressed button into view
       (focus on pointerdown, or a tap, whose press and click arrive
       together) only reports it on the next frame, which used to close
       the menu as it appeared. Pending scroll events go out before that
       frame's animation callbacks, so scrolls count from then on. */
    let settled = false;
    requestAnimationFrame(() => { settled = true; });
    offs = [
      on(document, 'pointerdown', e => {
        if (!layers.some(l => l.contains(e.target))) closeMenu();
      }, true),
      on(document, 'scroll', () => { if (settled) closeMenu(); }, true),
      on(window, 'wheel', closeMenu, { passive: true, capture: true }),
      on(window, 'blur', closeMenu),
      on(window, 'resize', closeMenu),
    ];
    /* preventScroll: a focus that scrolls anything would trip our own
       'scroll' listener above and close the menu the instant it opens */
    el.querySelector('.menu__item:not([disabled])')?.focus({ preventScroll: true });
  }

  /* ---------------- confirm -------------- */
  let dlg = null;

  function confirm(o = {}) {
    if (dlg) dlg.done(false);

    let offKey = null, closed = false, rel = null;

    function done(v) {
      if (closed || dlg !== d) return;
      closed = true;
      dlg = null;
      offKey?.();
      offKey = null;
      rel?.();
      rel = null;
      wrap.remove();
      o.resolve?.(v);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
      if (e.key !== 'Enter') return;
      /* a focused button activates itself on Enter — let it, so we
         neither double-fire Confirm nor read a focused Cancel as yes */
      const af = document.activeElement;
      if (af && af.tagName === 'BUTTON' && wrap.contains(af)) return;
      e.preventDefault();
      done(true);
    }

    const ok = h('button.btn', {
      class: o.danger ? 'btn--danger' : 'btn--primary',
      text: o.ok || 'Confirm',
      onclick: () => done(true),
    });

    const card = h('div.glass', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Confirm',
      style: {
        width: 'min(420px,90vw)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)',
        display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
      },
    },
      h('div.h-sec', { text: o.title || 'Are you sure?' }),
      o.message ? h('div.muted', { text: o.message, style: { lineHeight: '1.5' } }) : null,
      h('div.row', { style: { justifyContent: 'flex-end', marginTop: 'var(--sp-2)' } },
        h('button.btn.btn--ghost', { text: o.cancel || 'Cancel', onclick: () => done(false) }),
        ok));

    const wrap = h('div.spot-wrap', {
      style: { alignItems: 'center', paddingTop: '0' },
      onpointerdown: e => { if (e.target === wrap) done(false); },
    }, card);

    const d = { done };
    dlg = d;
    host.appendChild(wrap);
    /* a modal sheet: Escape cancels, Tab stays inside, focus goes back
       to whatever asked the question */
    rel = L.push({ name: 'confirm', el: card, trap: true, close: () => done(false) });
    ok.focus({ preventScroll: true });

    /* Bind on the next tick, not now. Spotlight runs a row on Enter from
       a keydown handler on its own panel; that same keydown is still
       bubbling up to window, so a listener added here would catch it and
       resolve the sheet before it is ever seen ("Reset StaticOS" would
       have wiped state with no confirmation). */
    setTimeout(() => { if (!closed) offKey = on(window, 'keydown', onKey); }, 0);
  }

  /* ---------------- wiring --------------- */
  const unbind = [
    bus.on('menu:open', openMenu),
    bus.on('dialog:confirm', confirm),
  ];

  return () => {
    unbind.forEach(off => off());
    closeMenu();
    dlg?.done(false);
  };
}

export default mountMenus;
