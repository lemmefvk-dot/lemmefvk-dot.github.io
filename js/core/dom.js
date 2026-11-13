/* ============================================================
   dom.js — tiny hyperscript + DOM helpers
   Every module builds UI with h(). No template strings for
   structure (only for static SVG/inner HTML via {html:...}).
   ============================================================ */

/* The only markup this OS ever sets as HTML is its own static SVG, so
   anything that could run is stripped before it is written. This is a
   backstop, not a sanitiser: never pass user or network data to
   {html:…} — use {text:…}, which cannot execute anything at all. */
const RUNNABLE = /<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base|form)\b|\son[a-z]+\s*=|javascript:|data:text\/html|srcdoc\s*=/i;

function safeMarkup(v) {
  const s = String(v ?? '');
  if (!RUNNABLE.test(s)) return s;
  console.error('[dom] refused executable markup passed to h({html}) — use {text} for anything dynamic');
  return '';
}

/**
 * h('div.cls.cls2#id', props?, ...children)
 * props: {class, style:{}|'', html, text, dataset:{}, on:{evt:fn},
 *         onclick / oninput / ... , any other attr}
 * children: Node | string | number | array | null | false (skipped)
 */
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use', 'symbol']);

export function h(tag, props, ...children) {
  const m = String(tag).match(/^([a-zA-Z0-9-]+)?((?:[.#][\w-]+)*)$/);
  let name = 'div', cls = [], id = null;
  if (m) {
    name = m[1] || 'div';
    for (const part of (m[2] || '').split(/(?=[.#])/).filter(Boolean)) {
      if (part[0] === '.') cls.push(part.slice(1));
      else id = part.slice(1);
    }
  } else name = tag;

  /* SVG shapes need the SVG namespace: a <circle> made with createElement
     is an unknown HTML element and draws nothing (Clock's rings,
     System Monitor's gauges) */
  const el = SVG_TAGS.has(name)
    ? document.createElementNS('http://www.w3.org/2000/svg', name)
    : document.createElement(name);

  if (cls.length) el.setAttribute('class', cls.join(' '));
  if (id) el.id = id;

  if (props && (props.nodeType || Array.isArray(props) || typeof props !== 'object')) {
    children.unshift(props);
    props = null;
  }

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.setAttribute('class', [...cls, v].filter(Boolean).join(' '));
      } else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else for (const [p, pv] of Object.entries(v)) {
          if (pv === null || pv === undefined) continue;
          p.startsWith('--') ? el.style.setProperty(p, pv) : (el.style[p] = pv);
        }
      } else if (k === 'html') {
        /* {html:…} exists for the static SVG this OS builds its icons and
           charts from — never for data. Nothing may reach it that could
           execute, so a careless `html: someValue` can't become an XSS
           hole the way `innerHTML` would. Anything live belongs in
           {text:…} or a child node. */
        el.innerHTML = safeMarkup(v);
      } else if (k === 'text') {
        el.textContent = v;
      } else if (k === 'dataset') {
        for (const [p, pv] of Object.entries(v)) el.dataset[p] = pv;
      } else if (k === 'on' && typeof v === 'object') {
        for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v);
      } else if (k === 'ref' && typeof v === 'function') {
        v(el);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, v);
      }
    }
  }

  append(el, children);
  return el;
}

export function append(el, kids) {
  for (const c of kids.flat(6)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const q  = (sel, root = document) => root.querySelector(sel);
export const qa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(target, evt, fn, opts) {
  target.addEventListener(evt, fn, opts);
  return () => target.removeEventListener(evt, fn, opts);
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Replace an element's children in one shot. */
export function render(el, ...children) { clear(el); return append(el, children); }

/** Toggle a class and return the new state. */
export function toggle(el, cls, force) {
  const next = force === undefined ? !el.classList.contains(cls) : !!force;
  el.classList.toggle(cls, next);
  return next;
}

/** Run fn on the next frame (coalesced per key). */
const rafKeys = new Map();
export function raf(key, fn) {
  if (rafKeys.has(key)) cancelAnimationFrame(rafKeys.get(key));
  rafKeys.set(key, requestAnimationFrame(() => { rafKeys.delete(key); fn(); }));
}

/** Position a floating element inside the viewport. */
export function placeInView(el, x, y, pad = 8) {
  const r = el.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  el.style.left = Math.max(pad, Math.min(x, W - r.width - pad)) + 'px';
  el.style.top  = Math.max(pad, Math.min(y, H - r.height - pad)) + 'px';
}
