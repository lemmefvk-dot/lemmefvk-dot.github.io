/* ============================================================
   onboarding.js — the first-launch flow.

   Five short screens: welcome, accent, wallpaper, motion, size.
   Every choice is applied to the real desktop the moment it is
   made — the card floats over the live shell rather than over a
   mockup — so the flow is a preview, not a questionnaire.

   It runs once. The answer is recorded in session.onboarded, and
   Skip (or Escape) counts as an answer: whatever is on screen at
   that point is what the user keeps. Nothing here blocks the
   desktop underneath from finishing its boot.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { THEMES, apply as applyAccent, swatch } from '../core/themes.js';
import * as WP from '../portal/wallpapers.js';

const KEY = 'session.onboarded';

const MOTION = [
  [false, 'Full motion', 'Windows spring, the dock magnifies, panels slide.'],
  [true, 'Reduced motion', 'The same interface with the movement taken out.'],
];

const SIZES = [
  ['compact', 'Compact', 'Small dock, tighter spacing. More room for windows.'],
  ['normal', 'Regular', 'The default balance.'],
  ['roomy', 'Large', 'Bigger dock and widgets, easier to hit.'],
];

/**
 * @param host  the shell host element (#os)
 * @param opts  { force } to replay the flow from Settings or a command
 * @returns a teardown function, or null when it has already run
 */
export function mountOnboarding(host, { force = false } = {}) {
  const { h, icon, store, bus, on, clear } = api;
  if (!force && store.get(KEY)) return null;

  let step = 0;
  let done = false;
  const offs = [];

  /* ---------------- pieces ---------------- */
  const body = h('div.ob__body');
  const heading = h('h1.ob__h', { id: 'ob-title' });
  const blurb = h('p.ob__p');
  const dots = h('div.ob__dots', { 'aria-hidden': 'true' });

  const back = h('button.btn.btn--ghost.btn--sm', { text: 'Back', onclick: () => go(step - 1) });
  const next = h('button.btn.btn--primary', { onclick: () => go(step + 1) });
  const skip = h('button.ob__skip', { text: 'Skip', 'aria-label': 'Skip setup', onclick: finish });

  const card = h('div.ob__card', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ob-title', tabindex: '-1',
  },
    skip,
    h('div.ob__mark', icon('sparkles')),
    heading, blurb, body,
    h('div.ob__foot', dots, h('div.grow'), back, next));

  const root = h('div.ob', card);

  /* ---------------- choice rows ------------ */
  function radios(label, rows, current, pick) {
    const group = h('div.ob__rows', { role: 'radiogroup', 'aria-label': label });
    const btns = rows.map(([val, name, note]) => {
      const el = h('button.ob__row', {
        role: 'radio', 'aria-checked': String(val === current),
        class: val === current ? 'is-on' : null,
        onclick: () => pick(val),
        onkeydown: e => {
          const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
            : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const i = rows.findIndex(r => r[0] === val);
          const nxt = rows[(i + d + rows.length) % rows.length];
          pick(nxt[0]);
          group.querySelectorAll('.ob__row')[(i + d + rows.length) % rows.length].focus();
        },
      },
        h('span.ob__tick', icon('check')),
        h('span.grow', h('b', { text: name }), note ? h('small', { text: note }) : null));
      return el;
    });
    group.append(...btns);
    return group;
  }

  /* ---------------- steps ------------------ */
  const STEPS = [
    {
      title: 'Welcome to StaticOS',
      blurb: 'A desktop that lives in a browser tab. Four quick choices and you are in — you can change every one of them later in Settings.',
      next: 'Get started',
      build: () => h('div.ob__hello',
        h('div.ob__pill', icon('maximize'), h('span', { text: 'Windows, a dock and a widget rail' })),
        h('div.ob__pill', icon('shield'), h('span', { text: 'Everything opens in this tab' })),
        h('div.ob__pill', icon('activity'), h('span', { text: 'Real readings only — nothing invented' }))),
    },
    {
      title: 'Pick an accent',
      blurb: 'One colour drives the whole system. The layout never changes.',
      build: () => {
        const cur = store.get('prefs.accent');
        const grid = h('div.ob__swatches', { role: 'radiogroup', 'aria-label': 'Accent' });
        for (const t of THEMES) {
          grid.appendChild(h('button.ob__sw', {
            role: 'radio', 'aria-checked': String(t.id === store.get('prefs.accent')),
            class: t.id === cur ? 'is-on' : null,
            'aria-label': t.name, title: t.note,
            style: { background: swatch(t.id) },
            onclick: () => { store.set('prefs.accent', t.id); applyAccent(t.id); paint(); },
          }, h('span.ob__swn', { text: t.name })));
        }
        return grid;
      },
    },
    {
      title: 'Choose a wallpaper',
      blurb: 'The built-in scenes are drawn by the browser, so they cost nothing to load.',
      build: () => {
        const cur = store.get(WP.ACTIVE_KEY);
        const grid = h('div.ob__wps', { role: 'radiogroup', 'aria-label': 'Wallpaper' });
        for (const w of WP.list(store)) {
          /* a video can't be a CSS background — show its poster (or GIF) instead */
          const still = w.kind === 'video' ? (w.poster || w.fallback) : w.url;
          const style = w.kind === 'css' ? { background: w.css, backgroundSize: 'cover' }
            : still ? { backgroundImage: `url("${String(still).replace(/"/g, '\\"')}")` }
            : null;
          grid.appendChild(h('button.ob__wp', {
            role: 'radio', 'aria-checked': String(w.id === cur),
            class: [w.id === cur ? 'is-on' : null, w.kind === 'scene' ? 'ob__wp--scene' : null]
              .filter(Boolean).join(' ') || null,
            'aria-label': w.name, title: w.name, style,
            onclick: () => { WP.setActive(store, w.id); paint(); },
          }, h('span.ob__wpn', { text: w.name })));
        }
        return grid;
      },
    },
    {
      title: 'How much motion?',
      blurb: 'Reduced motion keeps every animation out of your way. Your browser setting already asked for it if you have it on.',
      build: () => radios('Motion', MOTION, !!store.get('prefs.reduceMotion'),
        v => { store.set('prefs.reduceMotion', v); paint(); }),
    },
    {
      title: 'Dock and interface size',
      blurb: 'Sets the dock height, the widget rail width and the spacing everywhere else.',
      next: 'Enter the desktop',
      build: () => radios('Size', SIZES, store.get('prefs.density', 'normal'),
        v => { store.set('prefs.density', v); paint(); }),
    },
  ];

  /* ---------------- paint ------------------ */
  function paint() {
    const s = STEPS[step];
    heading.textContent = s.title;
    blurb.textContent = s.blurb;
    clear(body);
    body.appendChild(s.build());

    clear(dots);
    STEPS.forEach((_, i) => dots.appendChild(
      h('i', { class: i === step ? 'is-on' : null, 'aria-hidden': 'true' })));

    back.style.visibility = step ? 'visible' : 'hidden';
    next.textContent = s.next || 'Next';
    skip.style.display = step === STEPS.length - 1 ? 'none' : '';
  }

  function go(to) {
    if (to >= STEPS.length) return finish();
    step = Math.max(0, to);
    paint();
    next.focus({ preventScroll: true });
  }

  function finish() {
    if (done) return;
    done = true;
    store.set(KEY, true);
    root.classList.add('is-out');
    offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    setTimeout(() => root.remove(), 260);
    bus.emit('onboarding:done');
  }

  /* ---------------- run -------------------- */
  host.appendChild(root);
  paint();
  requestAnimationFrame(() => next.focus({ preventScroll: true }));

  offs.push(
    /* The session restores a window or two behind this card and the terminal
       focuses its prompt on open; without this the first thing typed would
       land in a shell nobody can see. */
    on(document, 'focusin', e => {
      if (done || !root.isConnected || card.contains(e.target)) return;
      next.focus({ preventScroll: true });
    }, true),
    on(window, 'keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (e.key !== 'Tab' || !root.isConnected) return;
      /* a modal keeps the caret inside itself */
      const stops = [...card.querySelectorAll('button:not([disabled])')].filter(el => el.offsetParent !== null);
      if (!stops.length) return;
      const first = stops[0], last = stops[stops.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    }, true),
  );

  return finish;
}

/** True when the flow has already been answered. */
export const onboarded = () => !!api.store.get(KEY);

/** Let the user run it again (Settings, a command, a fresh profile). */
export function resetOnboarding() { api.store.set(KEY, false); }

export default mountOnboarding;
