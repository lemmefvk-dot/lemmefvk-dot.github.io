/* ============================================================
   splitview.js — the divider between snapped windows.

   Two windows snapped side by side (or one above the other) meet
   along an edge. Drag that edge and both resize together, each
   stopping at its app's smallest size. Double-click it to put the
   split back to even. From the keyboard: the divider is a focus
   stop (role separator); arrows move it 16 px, Shift 64 px.

   Windows that meet along the same line move together, so with
   four quarters the vertical divider is one line, not two. Only
   snapped, visible windows on this desktop count, and an app that
   cannot be resized has no divider. Nothing here changes what a
   window is: it is still snapped, so dragging its title bar still
   frees it, and the layouts, tabs and keyboard snaps work as before.
   ============================================================ */
import { h } from '../core/dom.js';
import { bus } from '../core/bus.js';
import * as wm from '../core/wm.js';

const TOUCH = 2;        /* px two edges may differ and still be the same line */
const MIN_SPAN = 40;    /* px of shared edge before it is worth a divider */

export function mountSplitView() {
  const layer = document.getElementById('winlayer');
  if (!layer) return () => {};
  let bars = [];
  let queued = 0;
  let dragging = false;

  const live = () => wm.onDesktop().filter(w => !w.min && !w.tabHidden && w.snapped && !w.max && w.app.win.resizable !== false && w.el.isConnected && !w.el.classList.contains('is-closing'));
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

  /** The dividers now: { kind: 'v' | 'h', at, A: [windows before it], B: [windows after it], from, to }. */
  function find() {
    const ws = live();
    const out = new Map();
    const add = (kind, at, a, b, from, to) => {
      const key = `${kind}:${Math.round(at)}`;
      const d = out.get(key) || { kind, at, A: new Set(), B: new Set(), from: Infinity, to: -Infinity };
      d.A.add(a); d.B.add(b);
      d.from = Math.min(d.from, from); d.to = Math.max(d.to, to);
      out.set(key, d);
    };
    for (const a of ws) for (const b of ws) {
      if (a === b) continue;
      if (Math.abs(a.x + a.w - b.x) <= TOUCH && overlap(a.y, a.y + a.h, b.y, b.y + b.h) >= MIN_SPAN) {
        add('v', (a.x + a.w + b.x) / 2, a, b, Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h));
      }
      if (Math.abs(a.y + a.h - b.y) <= TOUCH && overlap(a.x, a.x + a.w, b.x, b.x + b.w) >= MIN_SPAN) {
        add('h', (a.y + a.h + b.y) / 2, a, b, Math.max(a.x, b.x), Math.min(a.x + a.w, b.x + b.w));
      }
    }
    return [...out.values()].map(d => ({ ...d, A: [...d.A], B: [...d.B] }));
  }

  /** How far the line may move: no window may go below its app's smallest size. */
  function limits(d) {
    const v = d.kind === 'v';
    let lo = -Infinity, hi = Infinity;
    for (const w of d.A) lo = Math.max(lo, (v ? w.app.win.minW - w.w : w.app.win.minH - w.h));
    for (const w of d.B) hi = Math.min(hi, (v ? w.w - w.app.win.minW : w.h - w.app.win.minH));
    return [lo, hi];
  }
  function move(d, dx, from) {
    const v = d.kind === 'v';
    const [lo, hi] = limits({ ...d, A: d.A, B: d.B });
    const n = Math.max(lo, Math.min(hi, dx));
    for (const w of d.A) { const s = from.get(w); wm.setRect(w, v ? { x: s.x, y: s.y, w: s.w + n, h: s.h } : { x: s.x, y: s.y, w: s.w, h: s.h + n }); }
    for (const w of d.B) { const s = from.get(w); wm.setRect(w, v ? { x: s.x + n, y: s.y, w: s.w - n, h: s.h } : { x: s.x, y: s.y + n, w: s.w, h: s.h - n }); }
    return n;
  }
  const done = d => { for (const w of [...d.A, ...d.B]) bus.emit('win:resize', w); };
  const even = d => { for (const w of [...d.A, ...d.B]) { w.quietSnap = true; try { wm.snap(w, w.snapped); } finally { w.quietSnap = false; } } };

  function place(el, d) {
    const v = d.kind === 'v';
    Object.assign(el.style, v
      ? { left: d.at - 6 + 'px', top: d.from + 'px', width: '12px', height: d.to - d.from + 'px' }
      : { left: d.from + 'px', top: d.at - 6 + 'px', width: d.to - d.from + 'px', height: '12px' });
    el.setAttribute('aria-valuenow', String(Math.round(d.at)));
  }

  function draw() {
    queued = 0;
    if (dragging) return;
    const ds = find();
    /* the same dividers as before (only moved): leave them standing, so a focused one keeps its focus */
    const sig = d => `${d.kind}:${d.A.map(w => w.id).sort().join(',')}|${d.B.map(w => w.id).sort().join(',')}`;
    if (ds.length === bars.length && ds.every((d, i) => sig(d) === bars[i].sig)) {
      ds.forEach((d, i) => { bars[i].d.at = d.at; bars[i].d.from = d.from; bars[i].d.to = d.to; place(bars[i].el, d); });
      return;
    }
    bars.forEach(b => b.el.remove());
    bars = ds.map(d => {
      const v = d.kind === 'v';
      const el = h('div.split-bar' + (v ? '.is-v' : '.is-h'), {
        role: 'separator', tabindex: '0', 'aria-orientation': v ? 'vertical' : 'horizontal',
        'aria-label': v ? 'Resize the windows beside this line' : 'Resize the windows above and below this line',
        title: 'Drag to resize both · double-click to even out',
      }, h('i'));
      place(el, d);
      el.addEventListener('pointerdown', e => start(e, d, el));
      el.addEventListener('dblclick', () => { even(d); });
      el.addEventListener('keydown', e => key(e, d, el));
      layer.appendChild(el);
      return { el, d, sig: sig(d) };
    });
  }
  const redraw = () => { if (!queued) queued = requestAnimationFrame(draw); };

  function start(e, d, el) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const v = d.kind === 'v';
    const sx = e.clientX, sy = e.clientY;
    const from = new Map([...d.A, ...d.B].map(w => [w, w.rect]));
    for (const w of from.keys()) if (w.geo) { try { w.geo.finish(); } catch (err) { /* done */ } }
    dragging = true;
    const at0 = d.at;
    el.classList.add('is-on');
    document.body.classList.add('is-splitting');
    const mv = ev => {
      const n = move(d, v ? ev.clientX - sx : ev.clientY - sy, from);
      d.at = at0 + n;
      place(el, d);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragging = false;
      el.classList.remove('is-on');
      document.body.classList.remove('is-splitting');
      done(d);
      redraw();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function key(e, d, el) {
    const v = d.kind === 'v';
    const step = e.shiftKey ? 64 : 16;
    const dir = { ArrowLeft: v ? -1 : 0, ArrowRight: v ? 1 : 0, ArrowUp: v ? 0 : -1, ArrowDown: v ? 0 : 1 }[e.key];
    if (e.key === 'Enter' || e.key === 'Home') { e.preventDefault(); even(d); return; }
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    const from = new Map([...d.A, ...d.B].map(w => [w, w.rect]));
    for (const w of from.keys()) if (w.geo) { try { w.geo.finish(); } catch (err) { /* done */ } }
    const n = move(d, dir * step, from);
    d.at += n;
    place(el, d);
    done(d);
    redraw();
  }

  const offs = [
    'win:snap', 'win:unsnap', 'win:move', 'win:resize', 'win:list', 'win:minimize', 'win:restore', 'win:max',
    'win:close', 'desktop:switch', 'win:open',
  ].map(ev => bus.on(ev, redraw));
  /* a snap's animation ends a little after the event: look again once it has */
  offs.push(bus.on('win:snap', () => setTimeout(redraw, 320)));
  window.addEventListener('resize', redraw);
  redraw();

  return () => { offs.forEach(f => f()); window.removeEventListener('resize', redraw); bars.forEach(b => b.el.remove()); };
}

export default mountSplitView;
