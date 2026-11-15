/* ============================================================
   arcade/padcursor.js — a controller-driven pointer for games you
   play with the mouse (Memory, Mines, Mahjong, Sudoku…).

   padCursor({ host, gate }) draws a cursor inside `host` (the stage)
   and, while gate() says yes, reads the controller every frame:
     left stick / D-pad   move it (the stick by how far it is pushed,
                          the D-pad at a steady pace)
     A (bottom button)    a left click where it points: pointerdown /
                          mousedown on press, pointerup / mouseup /
                          click on release, so a drag works too
     B (right button)     a right click (contextmenu), e.g. Mines' flag
   The events are dispatched to whatever is under the cursor
   (document.elementFromPoint), as ordinary synthetic events — like the
   keyboard bridge in core/padmap.js, they reach this page's games and
   nothing outside it. The cursor never leaves the stage.
   ============================================================ */
import { connectedPads, inputAmount, inputOn, inputById, getConfig, calOf, axesOf } from '../core/padmap.js';

const SPEED = 820;                  /* px per second at full stick */
const DPAD = 360;                   /* px per second on the D-pad */
const PID = 41;                     /* the pointer id our events use */

export function padCursor({ host, gate }) {
  const el = document.createElement('div');
  el.className = 'arc-pcur';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  host.appendChild(el);
  let raf = 0, last = 0, on = false, x = -1, y = -1, aDown = null, bWas = false, fresh = true;
  const ins = ['up', 'down', 'left', 'right', 'a', 'b'].reduce((o, id) => (o[id] = inputById(id), o), {});
  const was = new Map();

  const box = () => host.getBoundingClientRect();
  const fire = (type, target, extra = {}) => {
    const r = { clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, ...extra };
    let ev;
    try {
      ev = type.startsWith('pointer') ? new PointerEvent(type, { pointerId: PID, pointerType: 'mouse', isPrimary: true, ...r })
        : new MouseEvent(type, r);
    } catch (e) { return; }
    try { target.dispatchEvent(ev); } catch (e) { /* gone */ }
  };
  const under = () => {
    el.style.display = 'none';
    const t = document.elementFromPoint(x, y);
    el.style.display = '';
    return t && host.contains(t) ? t : null;
  };
  const place = () => {
    const b = box();
    x = Math.max(b.left + 2, Math.min(b.right - 2, x));
    y = Math.max(b.top + 2, Math.min(b.bottom - 2, y));
    el.style.transform = `translate(${x - b.left}px, ${y - b.top}px)`;
  };
  const press = (id, gp, dz) => {
    const k = `${gp.index}:${id}`;
    const v = inputOn(gp, ins[id], dz, was.get(k));
    was.set(k, v);
    return v;
  };

  function frame(now) {
    raf = 0;
    if (!on) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const pads = connectedPads();
    let open = false;
    try { open = !!gate(); } catch (e) { open = false; }
    el.hidden = !open || !pads.length;
    if (open && pads.length) {
      const b = box();
      if (x < 0) { x = b.left + b.width / 2; y = b.top + b.height / 2; }
      const cfg = getConfig();
      const dz = cfg.deadzone;
      let dx = 0, dy = 0, a = false, bb = false;
      for (const gp of pads) {
        /* the stick's measured resting point (Controller Center's calibration) comes off first */
        const [sx, sy] = axesOf(gp, calOf(gp, cfg));
        const m = Math.hypot(sx, sy);
        if (m > dz) { const k = Math.min(1, (m - dz) / (1 - dz)) / m; dx += sx * k * SPEED; dy += sy * k * SPEED; }
        dx += (inputAmount(gp, ins.right, dz) - inputAmount(gp, ins.left, dz)) * DPAD;
        dy += (inputAmount(gp, ins.down, dz) - inputAmount(gp, ins.up, dz)) * DPAD;
        if (press('a', gp, dz)) a = true;
        if (press('b', gp, dz)) bb = true;
      }
      /* a button already held when the cursor appears must be let go first */
      if (fresh) { fresh = false; if (a) aDown = 'held'; bWas = bb; }
      x += dx * dt; y += dy * dt;
      place();
      if (aDown && aDown !== 'held' && (dx || dy)) fire('pointermove', under() || aDown, {});
      if (a && !aDown) {
        const t = under();
        aDown = t || 'held';
        if (t) { fire('pointerdown', t); fire('mousedown', t); el.classList.add('is-down'); }
      } else if (!a && aDown) {
        const t = aDown === 'held' ? null : aDown;
        aDown = null;
        el.classList.remove('is-down');
        if (t) {
          const at = under() || t;
          fire('pointerup', at, { buttons: 0 }); fire('mouseup', at, { buttons: 0 });
          if (at === t || t.contains(at) || at.contains(t)) fire('click', at, { buttons: 0 });
        }
      }
      if (bb && !bWas) { const t = under(); if (t) fire('contextmenu', t, { button: 2, buttons: 2 }); }
      bWas = bb;
    } else if (aDown) { aDown = null; el.classList.remove('is-down'); }
    raf = requestAnimationFrame(frame);
  }

  return {
    el,
    start() { if (on) return; on = true; fresh = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { on = false; cancelAnimationFrame(raf); raf = 0; aDown = null; el.hidden = true; was.clear(); },
    get on() { return on; },
    /** where it points, in page coordinates — for the play-tests */
    at: () => ({ x, y, shown: !el.hidden }),
    destroy() { this.stop(); el.remove(); },
  };
}

export default { padCursor };
