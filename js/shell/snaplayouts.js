/* ============================================================
   snaplayouts.js — snap layouts on the maximise button.

   Rest the pointer on a window's green button (or right-click it,
   long-press it, or press ⌃⌥Z) and a small panel of layouts opens
   under it: halves, thirds, two-thirds + a third, quarters, a
   half and two quarters, top and bottom. Each layout is a little
   screen; point at a part of it and the translucent preview shows
   where the window will land, click to put it there.

   The snapping itself is wm.snap(); this only draws the picker.
   ============================================================ */
import { h } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { covered } from '../core/cover.js';
import * as wm from '../core/wm.js';
import * as KM from '../core/keymap.js';

const SHOW_DELAY = 420;
const HIDE_DELAY = 260;

/* each layout: CSS grid template, then [side, grid-area, name] per zone */
export const LAYOUTS = [
  { name: 'Halves', cols: '1fr 1fr', rows: '1fr', zones: [
    ['left', '1 / 1 / 2 / 2', 'Left half'], ['right', '1 / 2 / 2 / 3', 'Right half']] },
  { name: 'Thirds', cols: '1fr 1fr 1fr', rows: '1fr', zones: [
    ['l3', '1 / 1 / 2 / 2', 'Left third'], ['c3', '1 / 2 / 2 / 3', 'Middle third'], ['r3', '1 / 3 / 2 / 4', 'Right third']] },
  { name: 'Two thirds and a third', cols: '2fr 1fr', rows: '1fr', zones: [
    ['l23', '1 / 1 / 2 / 2', 'Left two thirds'], ['r3', '1 / 2 / 2 / 3', 'Right third']] },
  { name: 'A third and two thirds', cols: '1fr 2fr', rows: '1fr', zones: [
    ['l3', '1 / 1 / 2 / 2', 'Left third'], ['r23', '1 / 2 / 2 / 3', 'Right two thirds']] },
  { name: 'Quarters', cols: '1fr 1fr', rows: '1fr 1fr', zones: [
    ['tl', '1 / 1 / 2 / 2', 'Top left quarter'], ['tr', '1 / 2 / 2 / 3', 'Top right quarter'],
    ['bl', '2 / 1 / 3 / 2', 'Bottom left quarter'], ['br', '2 / 2 / 3 / 3', 'Bottom right quarter']] },
  { name: 'A half and two quarters', cols: '1fr 1fr', rows: '1fr 1fr', zones: [
    ['left', '1 / 1 / 3 / 2', 'Left half'], ['tr', '1 / 2 / 2 / 3', 'Top right quarter'], ['br', '2 / 2 / 3 / 3', 'Bottom right quarter']] },
  { name: 'Top and bottom', cols: '1fr', rows: '1fr 1fr', zones: [
    ['up', '1 / 1 / 2 / 2', 'Top half'], ['down', '2 / 1 / 3 / 2', 'Bottom half']] },
  { name: 'Full screen', cols: '1fr', rows: '1fr', zones: [
    ['max', '1 / 1 / 2 / 2', 'Fill the screen']] },
];

const reduced = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function mountSnapLayouts(host) {
  const panel = h('div.snap-picker', { role: 'menu', 'aria-label': 'Snap layouts' });
  const S = { win: null, btn: null, showT: 0, hideT: 0, returnFocus: null };

  function build(w) {
    panel.replaceChildren(...LAYOUTS.map(L => h('div.snap-picker__layout', {
      role: 'group', 'aria-label': L.name,
      style: { gridTemplateColumns: L.cols, gridTemplateRows: L.rows },
    }, ...L.zones.map(([side, area, label]) => h('button.snap-picker__zone', {
      type: 'button', role: 'menuitem', 'aria-label': label, title: label,
      dataset: { side }, style: { gridArea: area },
      class: w.snapped === side || (side === 'max' && w.max) ? 'is-current' : null,
      onpointerenter: () => wm.previewSnap(w, side),
      onpointerleave: () => wm.previewSnap(null),
      onfocus: () => wm.previewSnap(w, side),
      onblur: () => wm.previewSnap(null),
      onclick: () => { hide(); wm.snap(w, side); },
    })))));
  }

  function show(w, btn, { focusFirst = false } = {}) {
    clearTimeout(S.showT); clearTimeout(S.hideT);
    if (!w || covered() || document.body.classList.contains('is-mobile')) return;
    if (S.win === w && panel.isConnected) return;
    S.win = w; S.btn = btn;
    build(w);
    host.appendChild(panel);
    const r = (btn || w.el.querySelector('.light--max') || w.el).getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const x = Math.max(8, Math.min(r.left - 14, window.innerWidth - pw - 8));
    const below = r.bottom + 8 + ph < window.innerHeight - 8;
    const y = below ? r.bottom + 8 : Math.max(8, r.top - ph - 8);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.classList.toggle('is-above', !below);
    if (!reduced() && typeof panel.animate === 'function') {
      panel.animate([
        { opacity: 0, transform: `translateY(${below ? -6 : 6}px) scale(.97)` },
        { opacity: 1, transform: 'none' },
      ], { duration: 160, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    document.addEventListener('pointerdown', outside, true);
    if (focusFirst) {
      S.returnFocus = document.activeElement;
      panel.querySelector('.snap-picker__zone')?.focus({ preventScroll: true });
    }
    bus.emit('snaplayouts:open', w);
  }

  function hide() {
    clearTimeout(S.showT); clearTimeout(S.hideT);
    if (!panel.isConnected) { S.win = null; return; }
    const hadFocus = panel.contains(document.activeElement);
    panel.remove();
    wm.previewSnap(null);
    document.removeEventListener('pointerdown', outside, true);
    const back = S.returnFocus;
    S.returnFocus = null;
    S.win = null; S.btn = null;
    /* opened from the keyboard and closed with Esc: back to where you were typing */
    if (hadFocus && back && back.isConnected) back.focus?.({ preventScroll: true });
  }
  const hideSoon = () => { clearTimeout(S.hideT); S.hideT = setTimeout(hide, HIDE_DELAY); };

  function outside(e) {
    if (panel.contains(e.target)) return;
    if (S.btn && S.btn.contains(e.target)) return;
    hide();
  }

  const winOf = btn => {
    const el = btn && btn.closest('.win');
    return el ? wm.get(Number(el.dataset.win)) : null;
  };

  /* ---------------- hover on the maximise button ---------------- */
  function over(e) {
    const btn = e.target.closest?.('.light--max');
    if (!btn || e.pointerType === 'touch') return;
    if (btn.contains(e.relatedTarget)) return;
    clearTimeout(S.hideT);
    const w = winOf(btn);
    if (!w || (S.win === w && panel.isConnected)) return;
    clearTimeout(S.showT);
    S.showT = setTimeout(() => { if (btn.matches(':hover')) show(w, btn); }, SHOW_DELAY);
  }
  function out(e) {
    const btn = e.target.closest?.('.light--max');
    if (!btn || btn.contains(e.relatedTarget)) return;
    clearTimeout(S.showT);
    if (panel.isConnected && !panel.contains(e.relatedTarget)) hideSoon();
  }
  function menu(e) {
    const btn = e.target.closest?.('.light--max');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    show(winOf(btn), btn);
  }
  /* pressing the button maximises; the picker should not linger over that */
  function press(e) { if (e.target.closest?.('.light--max') && e.button === 0) hide(); }

  /* ---------------- keyboard: ⌃⌥Z for the front window ---------------- */
  function key(e) {
    if (panel.isConnected && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return; }
    if (panel.isConnected && /^Arrow/.test(e.key) && panel.contains(document.activeElement)) {
      const zones = [...panel.querySelectorAll('.snap-picker__zone')];
      const i = zones.indexOf(document.activeElement);
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      zones[(i + step + zones.length) % zones.length]?.focus({ preventScroll: true });
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (!KM.matches(e, 'snap.layouts')) return;   /* ⌃⌥Z, or the person's own keys */
    if (covered()) return;
    const w = wm.getActive();
    if (!w) return;
    e.preventDefault(); e.stopPropagation();
    if (panel.isConnected) hide(); else show(w, w.el.querySelector('.light--max'), { focusFirst: true });
  }

  /* ---------------- wiring --------------- */
  const layer = document.getElementById('winlayer') || host;
  layer.addEventListener('pointerover', over);
  layer.addEventListener('pointerout', out);
  layer.addEventListener('contextmenu', menu);
  layer.addEventListener('pointerdown', press, true);
  panel.addEventListener('pointerenter', () => clearTimeout(S.hideT));
  panel.addEventListener('pointerleave', e => { if (!(S.btn && S.btn.contains(e.relatedTarget))) hideSoon(); });
  window.addEventListener('keydown', key, true);
  const offs = [
    bus.on('win:close', w => { if (w === S.win) hide(); }),
    bus.on('win:minimize', w => { if (w === S.win) hide(); }),
    bus.on('desktop:switch', hide),
    bus.on('overview:toggle', hide),
  ];
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);

  return () => {
    hide();
    layer.removeEventListener('pointerover', over);
    layer.removeEventListener('pointerout', out);
    layer.removeEventListener('contextmenu', menu);
    layer.removeEventListener('pointerdown', press, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', hide);
    window.removeEventListener('resize', hide);
    offs.forEach(off => off());
  };
}

export default mountSnapLayouts;
