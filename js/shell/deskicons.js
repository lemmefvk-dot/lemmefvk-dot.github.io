/* ============================================================
   deskicons.js — where the desktop's icons sit and how you handle
   them. desktop.js builds the buttons and says what each one does;
   this puts them on a grid, and does the rest:

     drag             an icon (or all the selected ones) anywhere; it
                      snaps to the grid on letting go. Positions are
                      saved per person (session.deskPos), and kept
                      until you ask for Clean Up or a Sort.
     drag box         over bare wallpaper selects what it touches
     Shift / Ctrl     click adds a range / toggles one
     arrow keys       move the selection (Shift keeps the others)
     Enter · F2       open · rename in place; Delete moves to Trash
     click a selected name   rename in place too
     drop on a folder moves into it; on the Trash trashes; on a dock
                      app tile opens the file with that app

   A position is a cell (column, row) of the grid, not pixels, so a
   different icon size or screen size never loses anything: a cell
   that no longer fits is skipped for that screen only, and its
   icon takes the first free cell instead.
   ============================================================ */
import { h } from '../core/dom.js';
import { t } from '../core/i18n.js';

export const SIZES = {
  small: { w: 72, h: 78, g: 32, label: t('Small') },
  medium: { w: 86, h: 90, g: 40, label: t('Medium') },
  large: { w: 106, h: 114, g: 56, label: t('Large') },
};
export const POS_KEY = 'session.deskPos';
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
const SLOP = 5;
const LABEL_RENAME_MS = 520;

export function mountIconLayer({ host, desktop, store, bus, freeWidth, cb }) {
  /** key -> { key, el, name, kind, canRename, trashable, sort: { name, kind, mtime }, ... } */
  const items = new Map();
  let order = [];
  const sel = new Set();
  let anchor = null;
  let renaming = null;
  let swallow = 0;
  let labelTimer = 0;
  const offs = [];

  const sizeName = () => (SIZES[store.get('prefs.deskIconSize')] ? store.get('prefs.deskIconSize') : 'medium');
  const cell = () => SIZES[sizeName()];

  /* ---------------- grid ---------------- */
  function dims() {
    const c = cell();
    const left = host.getBoundingClientRect().left;
    const W = Math.min(host.clientWidth, Math.max(c.w, (freeWidth ? freeWidth() : innerWidth) - left - 8));
    return { c, cols: Math.max(1, Math.floor(W / c.w)), rows: Math.max(1, Math.floor(host.clientHeight / c.h)) };
  }
  const at = (c, r) => c * 4096 + r;

  /** Every icon's cell: its saved one if that still fits and is free, else the next free one (down, then right). */
  function slots() {
    const { cols, rows } = dims();
    const saved = store.get(POS_KEY) || {};
    const taken = new Set();
    const out = new Map();
    const pending = [];
    for (const key of order) {
      const p = saved[key];
      if (p && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] >= 0 && p[0] < cols && p[1] < rows && !taken.has(at(p[0], p[1]))) {
        out.set(key, { c: p[0], r: p[1] });
        taken.add(at(p[0], p[1]));
      } else pending.push(key);
    }
    let c = 0, r = 0;
    for (const key of pending) {
      while (taken.has(at(c, r))) { if (++r >= rows) { r = 0; c++; } }
      out.set(key, { c, r });
      taken.add(at(c, r));
    }
    return out;
  }
  let now = new Map();

  function apply() {
    const { c } = dims();
    host.style.setProperty('--ic-w', c.w + 'px');
    host.style.setProperty('--ic-h', c.h + 'px');
    host.style.setProperty('--ic-g', c.g + 'px');
    now = slots();
    let reach = 0;
    for (const [key, p] of now) {
      const it = items.get(key);
      if (!it) continue;
      it.el.style.left = p.c * c.w + 'px';
      it.el.style.top = p.r * c.h + 'px';
      it.cell = p;
      reach = Math.max(reach, (p.c + 1) * c.w);
    }
    /* the Linux wallpaper terminal sits to the right of the icons (shell/deskterm.js) */
    host.dataset.reach = String(Math.round(host.offsetLeft + reach));
    bus.emit('desk:icons');
  }

  function save() {
    const o = {};
    for (const [key, p] of now) o[key] = [p.c, p.r];
    store.set(POS_KEY, o);
  }

  /** The nearest free cell to (c, r), by distance. */
  function nearestFree(c, r, taken) {
    const { cols, rows } = dims();
    let best = null, bd = Infinity;
    for (let cc = 0; cc < cols; cc++) for (let rr = 0; rr < rows; rr++) {
      if (taken.has(at(cc, rr))) continue;
      const d = Math.abs(cc - c) + Math.abs(rr - r) + (cc - c) * (cc - c) * 0.001;
      if (d < bd) { bd = d; best = { c: cc, r: rr }; }
    }
    return best;
  }

  /* ---------------- painting ---------------- */
  function paint(list) {
    cancelRename(true);
    items.clear();
    order = [];
    for (const it of list) { items.set(it.key, it); order.push(it.key); it.el.dataset.key = it.key; wire(it); }
    for (const k of [...sel]) if (!items.has(k)) sel.delete(k);
    host.replaceChildren(...list.map(i => i.el));
    apply();
    paintSel();
  }
  const relayout = () => { if (host.clientWidth) apply(); };

  function paintSel() {
    for (const [k, it] of items) {
      const on = sel.has(k);
      it.el.classList.toggle('is-sel', on);
      it.el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function select(keys, { add = false } = {}) {
    if (!add) sel.clear();
    for (const k of keys) if (items.has(k)) sel.add(k);
    anchor = keys.length ? keys[keys.length - 1] : anchor;
    paintSel();
  }
  const clear = () => { sel.clear(); anchor = null; paintSel(); };
  const selected = () => order.filter(k => sel.has(k)).map(k => items.get(k));
  /** Reading order: down the first column, then the next. */
  const reading = () => [...order].sort((a, b) => (now.get(a).c - now.get(b).c) || (now.get(a).r - now.get(b).r));

  /* ---------------- wiring one icon ---------------- */
  function wire(it) {
    const el = it.el;
    el.addEventListener('pointerdown', e => down(e, it));
    el.addEventListener('dblclick', () => { clearTimeout(labelTimer); cb.open(it); });
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      if (!sel.has(it.key)) select([it.key]);
      cb.menu(e, it, selected());
    });
    /* a click from the keyboard (Space) or a script selects; pointer clicks were handled on press */
    el.addEventListener('click', e => { if (e.detail === 0) select([it.key]); });
  }

  function down(e, it) {
    if (e.button !== 0 || renaming) return;
    if (e.target.closest('.desk-rename')) return;
    /* ⌘-click on a Mac, Ctrl-click elsewhere (Ctrl-click on a Mac is a right-click) */
    const mod = MAC ? e.metaKey : e.ctrlKey;
    const wasSole = sel.size === 1 && sel.has(it.key);
    const hadSel = sel.has(it.key);
    clearTimeout(labelTimer);
    if (e.shiftKey && anchor && items.has(anchor)) {
      const r = reading();
      const a = r.indexOf(anchor), b = r.indexOf(it.key);
      const first = anchor;
      select(r.slice(Math.min(a, b), Math.max(a, b) + 1), { add: mod });
      anchor = first;        /* a range keeps its first end */
    } else if (mod) {
      if (hadSel) sel.delete(it.key); else sel.add(it.key);
      anchor = it.key;
      paintSel();
    } else if (!hadSel) select([it.key]);
    try { it.el.focus({ preventScroll: true }); } catch (err) { /* gone */ }

    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    let group = [];
    let over = null;
    let overDock = null;
    let ghost = null;
    const touch = e.pointerType === 'touch';
    /* a touch that stays put is a long press: the global menu opener takes it (shell/longpress.js) */

    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < (touch ? SLOP * 2 : SLOP)) return;
        dragging = true;
        if (!sel.has(it.key)) select([it.key]);
        group = selected();
        group.forEach(g => g.el.classList.add('is-dragging'));
        host.classList.add('is-dragging');
        ghost = h('div.desk-snap', { 'aria-hidden': 'true' });
        host.appendChild(ghost);
      }
      ev.preventDefault();
      group.forEach(g => { g.el.style.transform = `translate(${dx}px,${dy}px)`; });
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const hitIcon = under?.closest?.('.desk-icon');
      const target = hitIcon ? items.get(hitIcon.dataset.key) : null;
      const okTarget = target && !sel.has(target.key) && (target.kind === 'dir' || target.kind === 'trash') && cb.canDrop(group, target) ? target : null;
      if (okTarget !== over) { over?.el.classList.remove('is-drop'); over = okTarget; over?.el.classList.add('is-drop'); }
      const dockEl = under?.closest?.('.dock__item[data-app]');
      const appId = dockEl && cb.canDockDrop(group, dockEl.dataset.app) ? dockEl.dataset.app : null;
      if (appId !== overDock) { document.querySelector('.dock__item.is-drop')?.classList.remove('is-drop'); overDock = appId; if (appId) dockEl.classList.add('is-drop'); }
      /* where it will land */
      if (over || overDock) { ghost.style.display = 'none'; return; }
      const d = dims();
      const p = it.cell;
      const nc = Math.max(0, Math.min(d.cols - 1, p.c + Math.round(dx / d.c.w)));
      const nr = Math.max(0, Math.min(d.rows - 1, p.r + Math.round(dy / d.c.h)));
      Object.assign(ghost.style, { display: '', left: nc * d.c.w + 'px', top: nr * d.c.h + 'px', width: d.c.w - 8 + 'px', height: d.c.h - 8 + 'px' });
    };
    const finish = (ev, cancelled) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      if (!dragging) {
        if (!cancelled && !mod && !e.shiftKey) {
          /* a plain click on one of several: that one alone. On a name already selected alone: rename */
          if (hadSel && sel.size > 1) select([it.key]);
          else if (wasSole && it.canRename && e.target.closest('.desk-icon > span') && !touch) {
            labelTimer = setTimeout(() => startRename(it.key), LABEL_RENAME_MS);
          }
        }
        return;
      }
      swallow = Date.now() + 250;
      const dx = ev ? ev.clientX - sx : 0, dy = ev ? ev.clientY - sy : 0;
      group.forEach(g => { g.el.classList.remove('is-dragging'); g.el.style.transform = ''; });
      host.classList.remove('is-dragging');
      ghost?.remove();
      over?.el.classList.remove('is-drop');
      document.querySelector('.dock__item.is-drop')?.classList.remove('is-drop');
      if (cancelled) return;
      if (over) { cb.moveInto(group, over); return; }
      if (overDock) { cb.dockDrop(group, overDock); return; }
      const d = dims();
      const dc = Math.round(dx / d.c.w), dr = Math.round(dy / d.c.h);
      if (!dc && !dr) return;
      const still = new Set();
      for (const [k, p] of now) if (!group.some(g => g.key === k)) still.add(at(p.c, p.r));
      for (const g of group) {
        const p = g.cell;
        const want = { c: Math.max(0, Math.min(d.cols - 1, p.c + dc)), r: Math.max(0, Math.min(d.rows - 1, p.r + dr)) };
        const spot = still.has(at(want.c, want.r)) ? nearestFree(want.c, want.r, still) : want;
        still.add(at(spot.c, spot.r));
        now.set(g.key, spot);
      }
      save();
      apply();
    };
    const up = ev => finish(ev, false);
    const cancel = ev => finish(ev, true);
    const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(null, true); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }

  /* ---------------- drag box on bare wallpaper ---------------- */
  const BARE = '.desk-icon, .desk-term, .dw-layer, .desk-drop, button, a, input, textarea, select, [contenteditable]';
  function boxDown(e) {
    if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest(BARE) || !host.clientWidth) return;
    if (host.classList.contains('hidden')) return;
    const keep = e.shiftKey || (MAC ? e.metaKey : e.ctrlKey) ? new Set(sel) : new Set();
    const hr = host.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    let band = null;
    const move = ev => {
      if (!band) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < SLOP) return;
        band = h('div.desk-band', { 'aria-hidden': 'true' });
        host.appendChild(band);
        cancelRename(false);
      }
      const x1 = Math.min(sx, ev.clientX), y1 = Math.min(sy, ev.clientY), x2 = Math.max(sx, ev.clientX), y2 = Math.max(sy, ev.clientY);
      Object.assign(band.style, { left: x1 - hr.left + 'px', top: y1 - hr.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      sel.clear();
      keep.forEach(k => sel.add(k));
      for (const [k, it] of items) {
        const r = it.el.getBoundingClientRect();
        if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) sel.add(k);
      }
      paintSel();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (band) { band.remove(); swallow = Date.now() + 250; }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  desktop.addEventListener('pointerdown', boxDown);

  /* ---------------- rename in place ---------------- */
  function startRename(key) {
    const it = items.get(key);
    if (!it || !it.canRename || renaming) return;
    const label = it.el.querySelector(':scope > span');
    if (!label) return;
    select([key]);
    const input = h('input.desk-rename', { value: it.name, 'aria-label': t('Rename {name}', { name: it.name }), spellcheck: 'false', maxlength: '120' });
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      renaming = null;
      input.replaceWith(label);
      const next = input.value.trim();
      if (keep && next && next !== it.name) cb.rename(it, next);
      try { it.el.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    };
    renaming = { finish };
    for (const ev of ['pointerdown', 'click', 'dblclick', 'contextmenu']) input.addEventListener(ev, e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    label.replaceWith(input);
    input.focus();
    const dot = it.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 && it.kind === 'file' ? dot : it.name.length);
  }
  function cancelRename(keep) { renaming?.finish(keep); }

  /** A renamed file keeps its place and stays selected under its new key. */
  function rekey(from, to) {
    const saved = store.get(POS_KEY) || {};
    const p = now.get(from);
    if (p) store.set(POS_KEY, { ...saved, [to]: [p.c, p.r] });
    if (sel.delete(from)) sel.add(to);
    if (anchor === from) anchor = to;
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    if (renaming || e.target.closest?.('input, textarea')) return;
    const it = e.target.closest?.('.desk-icon') ? items.get(e.target.closest('.desk-icon').dataset.key) : null;
    if (!it) return;
    const mod = e.ctrlKey || e.metaKey;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir && !mod && !e.altKey) {
      e.preventDefault(); e.stopPropagation();
      const from = it.cell;
      let best = null, bs = Infinity;
      for (const [k, o] of items) {
        if (k === it.key) continue;
        const dx = o.cell.c - from.c, dy = o.cell.r - from.r;
        const along = dx * dir[0] + dy * dir[1];
        if (along <= 0) continue;
        const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        const s = along + across * 3;
        if (s < bs) { bs = s; best = o; }
      }
      if (!best) return;
      if (e.shiftKey) select([best.key], { add: true }); else select([best.key]);
      best.el.focus();
      return;
    }
    if (e.key === 'Enter' && !mod) {
      e.preventDefault(); e.stopPropagation();
      const list = sel.has(it.key) ? selected() : [it];
      list.forEach(x => cb.open(x));
    } else if (e.key === 'F2') {
      e.preventDefault(); e.stopPropagation();
      startRename(it.key);
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) {
      e.preventDefault(); e.stopPropagation();
      cb.trash(sel.has(it.key) ? selected() : [it]);
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault(); e.stopPropagation();
      select(order);
    } else if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault(); e.stopPropagation();
      cb.copy(selected());
    } else if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault(); e.stopPropagation();
      cb.paste();
    } else if (e.key === 'Escape' && sel.size) {
      e.stopPropagation();
      clear();
    }
  }
  host.addEventListener('keydown', onKey, true);

  /* ---------------- arranging ---------------- */
  /** Lay icons out in this order, down the first column, then the next. */
  function lay(keys) {
    const { rows } = dims();
    const next = new Map();
    keys.forEach((k, i) => next.set(k, { c: Math.floor(i / rows), r: i % rows }));
    now = next;
    save();
    apply();
  }
  /** Close the gaps, keeping the order you see. */
  const cleanUp = () => lay(reading());
  /** 'name' | 'kind' | 'date'. The shortcuts stay first, in their own order. */
  function sortBy(how) {
    const fixed = order.filter(k => items.get(k).pinned);
    const rest = order.filter(k => !items.get(k).pinned);
    const col = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    rest.sort((a, b) => {
      const x = items.get(a).sort, y = items.get(b).sort;
      if (how === 'date') return (y.mtime || 0) - (x.mtime || 0) || col.compare(x.name, y.name);
      if (how === 'kind') return col.compare(x.kind, y.kind) || col.compare(x.name, y.name);
      return col.compare(x.name, y.name);
    });
    lay([...fixed, ...rest]);
  }

  offs.push(() => desktop.removeEventListener('pointerdown', boxDown), () => host.removeEventListener('keydown', onKey, true));
  const onResize = () => relayout();
  window.addEventListener('resize', onResize);
  offs.push(() => window.removeEventListener('resize', onResize));

  return {
    paint, relayout, select, clear, selected, startRename, rekey, cleanUp, sortBy,
    get: key => items.get(key) || null,
    cellOf: key => (items.get(key)?.cell ? { ...items.get(key).cell } : null),
    /** True just after a drag box or a drag, so the click that ends it doesn't clear the selection. */
    swallowClick: () => Date.now() < swallow,
    destroy: () => offs.forEach(f => f()),
  };
}
