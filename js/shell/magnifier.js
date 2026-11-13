/* ============================================================
   magnifier.js — Settings › Accessibility › Magnifier, and its
   keys (Ctrl+Alt+L on / off, Ctrl+Alt+= / - to zoom, unless
   changed in Settings › Shortcuts).

   How the lens is drawn. Cloning the desktop into a scaled layer
   would copy the DOM but not what canvases, videos and framed pages
   have painted, and it would have to be re-cloned on every change.
   Instead the lens is an empty circle whose backdrop-filter is an SVG
   feDisplacementMap: each pixel of the lens takes its colour from
   nearer the centre, by a map that grows linearly across the lens, so
   the backdrop under it comes out magnified. The browser composites
   that from the real screen, so the view is live — games, the video
   wallpaper, other pages in the Browser — and moving the lens is one
   transform per frame. Pixels are sampled, not re-rendered, so text
   in the lens is enlarged the way a screen magnifier enlarges it.

   Browsers that can't use an SVG filter as a backdrop filter (Safari,
   Firefox) get the full-screen view instead: the desktop itself is
   scaled and pans with the pointer, so what is under the pointer stays
   under it and every click lands where it looks.

   Nothing runs while it is off: no element, no listener but the
   shortcut, no frame. While it is on, a pointer move asks for one
   animation frame (coalesced); nothing loops on its own.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as KM from '../core/keymap.js';

export const ZOOM = { min: 1.5, max: 6, step: 0.5, def: 2 };
export const SIZE = { min: 160, max: 480, step: 20, def: 280 };
const NS = 'http://www.w3.org/2000/svg';
const FILTER = 'static-mag';

const P = (k, d) => store.get('prefs.' + k, d);
const clamp = (v, R) => Math.min(R.max, Math.max(R.min, Number(v) || R.def));

/** Can this browser draw the lens (an SVG filter as a backdrop filter)? */
export function lensSupported() {
  try {
    return typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', `url(#${FILTER})`)
      && /Chrom(e|ium)\//.test(navigator.userAgent);   /* HeadlessChrome, Brave, Edge too */
  } catch (e) { return false; }
}

/* a map that is 0 at the lens's left / top edge and 255 at the other:
   red across, green down */
function rampURL(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const d = img.data, n = size - 1 || 1;
  for (let j = 0; j < size; j++) {
    const g = Math.round(255 * j / n);
    for (let i = 0; i < size; i++) {
      const k = (j * size + i) * 4;
      d[k] = Math.round(255 * i / n); d[k + 1] = g; d[k + 2] = 0; d[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function mountMagnifier(host) {
  const root = document.documentElement;
  let S = null;                         /* the running magnifier; null while off */
  const last = { x: null, y: null };   /* the pointer, kept while it is off */
  const stats = { frames: 0, starts: 0 };

  const follow = () => P('magFollow', 'both');
  const zoom = () => clamp(P('magZoom', ZOOM.def), ZOOM);
  const size = () => Math.round(clamp(P('magSize', SIZE.def), SIZE));
  const modeWanted = () => (P('magMode', 'lens') === 'lens' && lensSupported() ? 'lens' : 'full');

  function buildLens() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
    const f = document.createElementNS(NS, 'filter');
    f.id = FILTER;
    for (const [k, v] of [['x', 0], ['y', 0], ['filterUnits', 'userSpaceOnUse'], ['primitiveUnits', 'userSpaceOnUse'], ['color-interpolation-filters', 'sRGB']]) f.setAttribute(k, v);
    const img = document.createElementNS(NS, 'feImage');
    for (const [k, v] of [['x', 0], ['y', 0], ['preserveAspectRatio', 'none'], ['result', 'map']]) img.setAttribute(k, v);
    const dm = document.createElementNS(NS, 'feDisplacementMap');
    for (const [k, v] of [['in', 'SourceGraphic'], ['in2', 'map'], ['xChannelSelector', 'R'], ['yChannelSelector', 'G']]) dm.setAttribute(k, v);
    f.append(img, dm);
    svg.appendChild(f);
    const lens = document.createElement('div');
    lens.className = 'maglens';
    lens.setAttribute('aria-hidden', 'true');
    document.body.append(svg, lens);
    Object.assign(S, { svg, filter: f, img, dm, lens, mapSize: 0 });
  }

  /* zoom and size, applied to what is on screen */
  function configure() {
    if (!S) return;
    S.z = zoom();
    if (S.mode === 'lens') {
      const s = size();
      if (S.mapSize !== s) {
        S.mapSize = s;
        S.filter.setAttribute('width', s); S.filter.setAttribute('height', s);
        S.img.setAttribute('width', s); S.img.setAttribute('height', s);
        S.img.setAttribute('href', rampURL(s));
        S.lens.style.width = S.lens.style.height = s + 'px';
      }
      /* the pixel i across takes its colour from c + (i − c) / z: a
         displacement of −(i − c)(1 − 1/z), which the 0…255 ramp gives at
         this scale */
      S.dm.setAttribute('scale', String(-(s - 1) * (1 - 1 / S.z)));
    }
    schedule();
  }

  function schedule() {
    if (S && !S.raf) S.raf = requestAnimationFrame(paint);
  }
  function paint() {
    if (!S) return;
    S.raf = 0;
    stats.frames++;
    if (S.mode === 'lens') {
      const h = S.mapSize / 2;
      S.lens.style.transform = `translate3d(${Math.round(S.x - h)}px,${Math.round(S.y - h)}px,0)`;
    } else {
      const k = S.z - 1;
      host.style.transform = `translate(${(-S.x * k).toFixed(1)}px,${(-S.y * k).toFixed(1)}px) scale(${S.z})`;
    }
  }

  function onMove(e) {
    if (follow() === 'focus') return;
    S.x = e.clientX; S.y = e.clientY;
    schedule();
  }
  /* keyboard focus: the start of what took it (a field's left end, a
     list's first rows), not the middle of something bigger than the lens */
  function onFocus(e) {
    const el = e.target;
    if (!el || el === document.body || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    /* a repaint hands focus to the new copy of the same thing (js/core/roving.js:
       zooming changes a pref, and the dock rebuilds its icons). Focus has not gone
       anywhere, so neither does the lens: it would leap from the pointer to the dock. */
    const was = S.focused;
    S.focused = { el, left: r.left, top: r.top };
    if (was && !was.el.isConnected && Math.abs(was.left - r.left) < 2 && Math.abs(was.top - r.top) < 2) return;
    const f = follow();
    if (f === 'pointer' || (f === 'both' && root.dataset.input !== 'keyboard')) return;
    if (!r.width && !r.height) return;
    const reach = S.mode === 'lens' ? S.mapSize / (2 * S.z) : 0;
    S.x = S.mode === 'lens' ? r.left + Math.min(r.width / 2, reach) : r.left + r.width / 2;
    S.y = S.mode === 'lens' ? r.top + Math.min(r.height / 2, reach) : r.top + r.height / 2;
    schedule();
  }

  function start() {
    if (S) return;
    const mode = modeWanted();
    /* where the pointer last was (or the middle), until it moves */
    S = { mode, x: last.x ?? innerWidth / 2, y: last.y ?? innerHeight / 2, raf: 0, offs: [] };
    stats.starts++;
    if (mode === 'lens') buildLens(); else host.classList.add('is-zoomed');
    root.dataset.magnifier = mode;
    const add = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); S.offs.push(() => t.removeEventListener(ev, fn, o)); };
    add(window, 'pointermove', onMove, { capture: true, passive: true });
    add(document, 'focusin', onFocus, true);
    add(window, 'resize', schedule);
    configure();
  }
  function stop() {
    if (!S) return;
    last.x = S.x; last.y = S.y;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.offs.forEach(off => off());
    S.lens?.remove();
    S.svg?.remove();
    host.classList.remove('is-zoomed');
    host.style.transform = '';
    delete root.dataset.magnifier;
    S = null;
  }
  /* the preference is the one switch: Settings, the shortcut and a reload
     all go through it */
  function sync() {
    const on = !!P('magnifier', false);
    if (!on) { stop(); return; }
    if (S && S.mode !== modeWanted()) stop();
    if (!S) start(); else configure();
  }
  const offPrefs = store.sub('prefs', sync);

  const say = t => bus.emit('a11y:say', t);
  function onKey(e) {
    if (KM.matches(e, 'magnifier')) {
      e.preventDefault();
      const on = !P('magnifier', false);
      store.set('prefs.magnifier', on);
      say(on ? `Magnifier on, ${zoom()} times` : 'Magnifier off');
      return;
    }
    if (!S) return;
    const step = KM.matches(e, 'magnifier.in') ? 1 : KM.matches(e, 'magnifier.out') ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const z = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom() + step * ZOOM.step));
    store.set('prefs.magZoom', z);
    say(`${z} times`);
  }
  window.addEventListener('keydown', onKey, true);

  sync();

  /* for tests and the console */
  if (window.Static) {
    window.Static.magnifier = {
      state: () => ({ on: !!S, mode: S?.mode || null, zoom: S?.z ?? null, size: S?.mapSize ?? null, x: S?.x ?? null, y: S?.y ?? null, ...stats }),
      lensSupported,
    };
  }

  return () => {
    stop();
    offPrefs();
    window.removeEventListener('keydown', onKey, true);
  };
}

export default mountMagnifier;
