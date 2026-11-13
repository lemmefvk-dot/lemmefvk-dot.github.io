/* ============================================================
   palette.js — Static Color: a colour tool for designers.

   One canonical colour, held as HSV + alpha, feeds everything:

   · A 2D saturation/value area with a hue slider and an alpha
     slider (checkerboard behind, so transparency is honest).
     The area is pointer- AND keyboard-driven (arrows nudge, the
     hue/alpha tracks are native range inputs, so they are
     accessible for free).
   · HEX / RGB / HSL fields that stay in sync and are all
     editable — type into any one and the rest follow. Copy any
     format with one click.
   · Harmony palettes generated from the current colour
     (complementary, analogous, triad, tetrad, monochrome), each
     swatch copyable, the whole set savable.
   · A gradient builder — two or more stops and an angle — that
     writes the real CSS you can copy.
   · A contrast checker with the genuine WCAG 2.1 ratio and the
     AA/AAA pass/fail for normal and large text.
   · A saved-swatches strip persisted to store ('portal.palette').

   Every number on screen is computed here, offline: the colour
   maths (HSV/HSL/hex conversions, relative luminance, contrast)
   all run in the browser. Where the browser offers a real extra
   — the EyeDropper API to sample a pixel anywhere on screen —
   the "Pick from screen" button is always there and, where the
   API is missing, says so instead of doing nothing.

   "Save as PNG" renders the harmony to a real canvas and writes
   it to Pictures via core/media.js, so it opens in Photos.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { save as saveMedia } from '../core/media.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-palette-css')) {
  const l = document.createElement('link');
  l.id = 'feat-palette-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-palette.css';
  document.head.appendChild(l);
}

/* ---------------- colour maths (all offline) ---------------- */
const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const round = Math.round;
const wrapHue = h => ((h % 360) + 360) % 360;

function hsvToRgb(h, s, v) {
  h = wrapHue(h);
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: round((r + m) * 255), g: round((g + m) * 255), b: round((b + m) * 255) };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: wrapHue(h), s: max === 0 ? 0 : d / max, v: max };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: wrapHue(h), s, l };
}

function hslToRgb(h, s, l) {
  h = wrapHue(h);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: round((r + m) * 255), g: round((g + m) * 255), b: round((b + m) * 255) };
}

const hex2 = n => clamp(round(n), 0, 255).toString(16).padStart(2, '0');
function rgbToHex({ r, g, b }, a) {
  let s = '#' + hex2(r) + hex2(g) + hex2(b);
  if (a !== undefined && a < 0.999) s += hex2(a * 255);
  return s.toUpperCase();
}
function parseHex(str) {
  let s = String(str).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  else if (/^[0-9a-f]{4}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{6}$/i.test(s)) return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
  if (/^[0-9a-f]{8}$/i.test(s)) return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: parseInt(s.slice(6, 8), 16) / 255 };
  return null;
}
const isHex = s => !!parseHex(s);

/* WCAG 2.1 relative luminance + contrast ratio */
function luminance({ r, g, b }) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const HARMONIES = {
  complementary: { label: 'Complementary', offs: [0, 180] },
  analogous: { label: 'Analogous', offs: [-30, 0, 30] },
  triad: { label: 'Triad', offs: [0, 120, 240] },
  tetrad: { label: 'Tetrad', offs: [0, 90, 180, 270] },
  monochrome: { label: 'Monochrome', mono: true },
};

const DEFAULT_SWATCHES = ['#FF456D', '#FF9A5A', '#FFD166', '#4ECB71', '#3B9EFF', '#8B5CF6'];

defineApp({
  id: 'palette',
  name: 'Static Color',
  icon: 'palette',
  g1: '#9a7dff', g2: '#4d27cf',
  category: 'Utilities',
  keywords: ['color', 'colour', 'picker', 'hex', 'rgb', 'hsl', 'palette', 'swatch',
    'gradient', 'contrast', 'wcag', 'harmony', 'design', 'eyedropper', 'hue'],
  desc: 'Colour picker, harmonies, gradients and WCAG contrast — all offline',
  singleton: true,
  win: { w: 800, h: 660, minW: 360, minH: 480 },

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, notify } = api;

    /* ------------------------------ state ------------------------------ */
    const saved = (store.get('portal.palette') && typeof store.get('portal.palette') === 'object') ? store.get('portal.palette') : {};
    const startColor = isHex(saved.color) ? saved.color : '#FF456D';
    const startHsv = rgbToHsv(parseHex(startColor).r, parseHex(startColor).g, parseHex(startColor).b);

    const S = {
      h: startHsv.h, s: startHsv.s, v: startHsv.v, a: 1,
      harmony: HARMONIES[saved.harmony] ? saved.harmony : 'analogous',
      swatches: Array.isArray(saved.swatches) ? saved.swatches.filter(isHex).slice(0, 60) : DEFAULT_SWATCHES.slice(),
      tab: 'harmony',
      grad: {
        angle: Number.isFinite(saved.gradient?.angle) ? clamp(saved.gradient.angle, 0, 360) : 135,
        stops: Array.isArray(saved.gradient?.stops) && saved.gradient.stops.length >= 2
          ? saved.gradient.stops.filter(s => isHex(s.hex)).map(s => ({ hex: rgbToHex(parseHex(s.hex), parseHex(s.hex).a), pos: clamp(round(s.pos) || 0, 0, 100) }))
          : [{ hex: '#FF456D', pos: 0 }, { hex: '#6A5CFF', pos: 100 }],
      },
      contrast: {
        fg: isHex(saved.contrast?.fg) ? saved.contrast.fg : '#FFFFFF',
        bg: isHex(saved.contrast?.bg) ? saved.contrast.bg : '#FF456D',
      },
      dead: false,
    };
    if (S.grad.stops.length < 2) S.grad.stops = [{ hex: '#FF456D', pos: 0 }, { hex: '#6A5CFF', pos: 100 }];

    const cleanups = [];
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    /* derived current-colour helpers */
    const curRgb = () => hsvToRgb(S.h, S.s, S.v);
    const curHex = () => rgbToHex(curRgb(), S.a);
    const curHexSolid = () => rgbToHex(curRgb());

    let persistT = 0;
    function persist() {
      store.set('portal.palette', {
        color: curHexSolid(),
        harmony: S.harmony,
        swatches: S.swatches.slice(),
        gradient: { angle: S.grad.angle, stops: S.grad.stops.map(s => ({ hex: s.hex, pos: s.pos })) },
        contrast: { fg: S.contrast.fg, bg: S.contrast.bg },
      });
    }
    function schedulePersist() {
      clearTimeout(persistT);
      persistT = setTimeout(() => { persistT = 0; if (!S.dead) persist(); }, 350);
      timers.add(persistT);
    }

    async function copyText(text, btn) {
      try {
        await navigator.clipboard.writeText(text);
        if (btn) { btn.classList.add('is-copied'); later(() => btn.classList.remove('is-copied'), 1100); }
        notify({ app: 'Static Color', icon: 'copy', title: 'Copied', message: text, timeout: 1800 });
      } catch (err) {
        notify({ app: 'Static Color', icon: 'alert', title: 'Could not copy', message: 'The clipboard is unavailable here.' });
      }
    }

    /* ============================ picker ============================ */
    const svThumb = h('div.pal__sv-thumb');
    const svArea = h('div.pal__sv', {
      tabindex: '0', role: 'slider', 'aria-label': 'Saturation and brightness',
    }, svThumb);

    const hueRange = h('input.pal__range.pal__range--hue', {
      type: 'range', min: '0', max: '360', step: '1', 'aria-label': 'Hue',
    });
    const alphaRange = h('input.pal__range.pal__range--alpha', {
      type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Alpha (opacity)',
    });
    const alphaNum = h('input.pal__anum', { type: 'number', min: '0', max: '100', step: '1', 'aria-label': 'Alpha percent' });

    const bigSwatch = h('div.pal__big', { role: 'img', 'aria-label': 'Current colour preview' });
    /* Always there: where the browser has no EyeDropper the button says so
       (a missing button would leave people hunting for it). Support is
       checked when it is pressed, not once at mount. */
    const eyeNote = h('div.pal__eyenote', { role: 'status', 'aria-live': 'polite', hidden: true });
    const eyeBtn = h('button.btn.btn--sm.pal__eye', {
      type: 'button', 'aria-label': 'Pick a colour from anywhere on the screen', onclick: pickFromScreen,
    }, icon('scan'), h('span', { text: 'Pick from screen' }));
    function eyeSay(msg) { eyeNote.textContent = msg; eyeNote.hidden = !msg; }
    const bigHex = h('div.pal__bighex.mono');

    /* fields */
    const hexInput = h('input.pal__in.pal__in--hex.mono', { type: 'text', spellcheck: 'false', 'aria-label': 'Hex value', inputmode: 'latin' });
    const rIn = numField('R', 255, 'Red 0 to 255');
    const gIn = numField('G', 255, 'Green 0 to 255');
    const bIn = numField('B', 255, 'Blue 0 to 255');
    const hIn = numField('H', 360, 'Hue 0 to 360');
    const sIn = numField('S', 100, 'Saturation 0 to 100');
    const lIn = numField('L', 100, 'Lightness 0 to 100');

    function numField(label, max, aria) {
      return h('input.pal__num.mono', { type: 'number', min: '0', max: String(max), step: '1', 'aria-label': aria, dataset: { f: label } });
    }
    function copyBtn(getText) {
      return h('button.ibtn.pal__copy.tip', { type: 'button', 'data-tip': 'Copy', 'aria-label': 'Copy value', onclick: e => copyText(getText(), e.currentTarget) }, icon('copy'));
    }

    function rgbString() { const c = curRgb(); return S.a < 0.999 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${(+S.a.toFixed(3))})` : `rgb(${c.r}, ${c.g}, ${c.b})`; }
    function hslString() { const c = curRgb(); const { h: hh, s, l } = rgbToHsl(c.r, c.g, c.b); const H = round(hh), Sp = round(s * 100), Lp = round(l * 100); return S.a < 0.999 ? `hsla(${H}, ${Sp}%, ${Lp}%, ${(+S.a.toFixed(3))})` : `hsl(${H}, ${Sp}%, ${Lp}%)`; }

    const fields = h('div.pal__fields',
      h('div.pal__frow',
        h('label.pal__flabel', { text: 'HEX', for: 'pal-hex' }),
        (() => { hexInput.id = 'pal-hex'; return hexInput; })(),
        copyBtn(() => curHex())),
      h('div.pal__frow',
        h('span.pal__flabel', { text: 'RGB' }),
        h('div.pal__triple', rIn, gIn, bIn),
        copyBtn(() => rgbString())),
      h('div.pal__frow',
        h('span.pal__flabel', { text: 'HSL' }),
        h('div.pal__triple', hIn, sIn, lIn),
        copyBtn(() => hslString())),
    );

    const savedStrip = h('div.pal__strip', { 'aria-label': 'Saved swatches' });
    const pickCol = h('div.pal__pick',
      svArea,
      h('div.pal__sliders',
        h('div.pal__srow', h('span.pal__sic', { title: 'Hue' }, icon('droplet')), hueRange),
        h('div.pal__srow.pal__srow--alpha',
          h('span.pal__sic', { title: 'Alpha' }, icon('layers')), alphaRange,
          alphaNum, h('span.pal__aunit', { text: '%' }))),
      h('div.pal__preview',
        h('div.pal__bigwrap', bigSwatch),
        h('div.pal__pinfo', bigHex, eyeNote, h('div.pal__ptools', eyeBtn,
          h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': 'Save to swatches', onclick: addCurrentSwatch }, icon('plus'), h('span', { text: 'Save' }))))),
      fields,
      h('div.pal__saved',
        h('div.pal__savedhead', h('span.label', { text: 'Saved swatches' })),
        savedStrip),
    );

    /* ============================ tools (tabs) ============================ */
    const TABS = [
      { id: 'harmony', label: 'Harmony', icon: 'sparkles' },
      { id: 'gradient', label: 'Gradient', icon: 'layers' },
      { id: 'contrast', label: 'Contrast', icon: 'eye' },
      { id: 'picture', label: 'From picture', icon: 'image' },
    ];
    const tabBar = h('div.pal__tabs', { role: 'tablist', 'aria-label': 'Tools' });
    const tabBtns = {};
    for (const t of TABS) {
      tabBtns[t.id] = h('button.pal__tab', {
        type: 'button', role: 'tab', onclick: () => setTab(t.id),
      }, icon(t.icon), h('span', { text: t.label }));
      tabBar.appendChild(tabBtns[t.id]);
    }
    const panel = h('div.pal__panel', { role: 'tabpanel' });
    const toolsCol = h('div.pal__tools', tabBar, panel);

    function setTab(id) {
      S.tab = id;
      for (const t of TABS) {
        const on = t.id === id;
        tabBtns[t.id].classList.toggle('is-on', on);
        tabBtns[t.id].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      renderPanel();
    }

    /* ---------------- harmony ---------------- */
    function harmonyColors() {
      const def = HARMONIES[S.harmony];
      const base = rgbToHsl(curRgb().r, curRgb().g, curRgb().b);
      if (def.mono) {
        return [0.86, 0.7, 0.54, 0.4, 0.26].map(l => rgbToHex(hslToRgb(base.h, Math.max(base.s, 0.12), l)));
      }
      return def.offs.map(off => rgbToHex(hsvToRgb(S.h + off, S.s, S.v)));
    }

    function renderHarmony() {
      clear(panel);
      const chooser = h('div.pal__seg', { role: 'group', 'aria-label': 'Harmony type' });
      for (const [key, def] of Object.entries(HARMONIES)) {
        chooser.appendChild(h('button.pal__segb', {
          type: 'button', 'aria-pressed': S.harmony === key ? 'true' : 'false',
          class: S.harmony === key ? 'is-on' : '',
          text: def.label, onclick: () => { S.harmony = key; renderHarmony(); schedulePersist(); },
        }));
      }
      const colors = harmonyColors();
      const grid = h('div.pal__harm');
      for (const hexv of colors) {
        grid.appendChild(h('button.pal__hcard', {
          type: 'button', title: `Copy ${hexv}`,
          onclick: e => copyText(hexv, e.currentTarget),
        },
          h('div.pal__hchip', { style: { background: hexv } }),
          h('div.pal__hhex.mono', { text: hexv }),
          h('span.pal__hcopied', { text: 'Copied' })));
      }
      panel.append(
        h('div.pal__block',
          h('div.pal__blockhead', h('span.h-sec', { text: 'Harmony' }),
            h('span.pal__hint', { text: 'From the current colour' })),
          chooser, grid,
          h('div.pal__row2',
            h('button.btn.btn--sm', { type: 'button', onclick: () => { addSwatches(colors); } }, icon('bookmark'), h('span', { text: 'Save all' })),
            h('button.btn.btn--sm', { type: 'button', onclick: () => savePng(colors) }, icon('image'), h('span', { text: 'Save as PNG' })))),
      );
    }

    /* ---------------- gradient ---------------- */
    function gradientCss() {
      const stops = S.grad.stops.slice().sort((a, b) => a.pos - b.pos)
        .map(s => `${s.hex} ${s.pos}%`).join(', ');
      return `linear-gradient(${S.grad.angle}deg, ${stops})`;
    }
    function renderGradient() {
      clear(panel);
      const preview = h('div.pal__gpreview', { style: { background: gradientCss() }, role: 'img', 'aria-label': 'Gradient preview' });
      const angleRange = h('input.pal__range.pal__range--plain', { type: 'range', min: '0', max: '360', step: '1', value: String(S.grad.angle), 'aria-label': 'Gradient angle' });
      const angleNum = h('input.pal__num.mono', { type: 'number', min: '0', max: '360', step: '1', value: String(S.grad.angle), 'aria-label': 'Gradient angle degrees' });
      const setAngle = v => { S.grad.angle = clamp(round(+v) || 0, 0, 360); angleRange.value = String(S.grad.angle); angleNum.value = String(S.grad.angle); preview.style.background = gradientCss(); codeEl.textContent = gradientCss(); schedulePersist(); };
      angleRange.addEventListener('input', () => setAngle(angleRange.value));
      angleNum.addEventListener('input', () => setAngle(angleNum.value));

      const stopList = h('div.pal__stops');
      const codeEl = h('code.pal__code.mono', { text: gradientCss() });

      function redrawStops() {
        clear(stopList);
        S.grad.stops.forEach((st, i) => {
          const posRange = h('input.pal__range.pal__range--plain.pal__stoppos', { type: 'range', min: '0', max: '100', step: '1', value: String(st.pos), 'aria-label': `Stop ${i + 1} position` });
          posRange.addEventListener('input', () => { st.pos = clamp(round(+posRange.value) || 0, 0, 100); posPct.textContent = st.pos + '%'; preview.style.background = gradientCss(); codeEl.textContent = gradientCss(); schedulePersist(); });
          const posPct = h('span.pal__stoppct.mono', { text: st.pos + '%' });
          stopList.appendChild(h('div.pal__stop',
            h('button.pal__swbtn.tip', {
              type: 'button', 'data-tip': 'Set to current colour', 'aria-label': `Set stop ${i + 1} to current colour`,
              style: { background: st.hex }, onclick: () => { st.hex = curHexSolid(); redrawStops(); preview.style.background = gradientCss(); codeEl.textContent = gradientCss(); schedulePersist(); },
            }),
            h('span.pal__stophex.mono', { text: st.hex }),
            posRange, posPct,
            h('button.ibtn.pal__stopdel', {
              type: 'button', 'aria-label': `Remove stop ${i + 1}`, disabled: S.grad.stops.length <= 2,
              onclick: () => { if (S.grad.stops.length <= 2) return; S.grad.stops.splice(i, 1); redrawStops(); preview.style.background = gradientCss(); codeEl.textContent = gradientCss(); schedulePersist(); },
            }, icon('x'))));
        });
      }
      redrawStops();

      panel.append(
        h('div.pal__block',
          h('div.pal__blockhead', h('span.h-sec', { text: 'Gradient' }),
            h('span.pal__hint', { text: 'Tap a stop swatch to set it to the current colour' })),
          preview,
          h('div.pal__grow',
            h('span.pal__flabel', { text: 'Angle' }), angleRange, angleNum, h('span.pal__aunit', { text: '°' })),
          stopList,
          h('button.btn.btn--sm.pal__addstop', { type: 'button', onclick: () => { S.grad.stops.push({ hex: curHexSolid(), pos: 50 }); redrawStops(); preview.style.background = gradientCss(); codeEl.textContent = gradientCss(); schedulePersist(); } }, icon('plus'), h('span', { text: 'Add stop' })),
          h('div.pal__codewrap',
            codeEl,
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: e => copyText('background: ' + gradientCss() + ';', e.currentTarget) }, icon('copy'), h('span', { text: 'Copy CSS' })))),
      );
    }

    /* ---------------- contrast ---------------- */
    function renderContrast() {
      clear(panel);
      const fg = parseHex(S.contrast.fg), bg = parseHex(S.contrast.bg);
      const ratio = contrastRatio(fg, bg);
      const rtxt = ratio.toFixed(2) + ':1';

      const sample = h('div.pal__csample', { style: { background: S.contrast.bg, color: S.contrast.fg } },
        h('div.pal__cbig', { text: 'Aa' }),
        h('div.pal__csmall', { text: 'The quick brown fox jumps.' }));

      const checks = [
        { label: 'AA · normal text', pass: ratio >= 4.5, need: '4.5' },
        { label: 'AA · large text', pass: ratio >= 3, need: '3' },
        { label: 'AAA · normal text', pass: ratio >= 7, need: '7' },
        { label: 'AAA · large text', pass: ratio >= 4.5, need: '4.5' },
      ];
      const checkEls = checks.map(c => h('div.pal__check' + (c.pass ? '.is-pass' : '.is-fail'),
        icon(c.pass ? 'check-circle' : 'x-circle'),
        h('span', { text: c.label }),
        h('span.pal__cverdict', { text: c.pass ? 'Pass' : 'Fail' })));

      const slot = (which, label) => {
        const hexv = S.contrast[which];
        return h('div.pal__cslot',
          h('span.pal__flabel', { text: label }),
          h('div.pal__cswrap',
            h('span.pal__cswatch', { style: { background: hexv } }),
            h('span.pal__cshex.mono', { text: hexv })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.contrast[which] = curHexSolid(); renderContrast(); schedulePersist(); } }, h('span', { text: 'Use current' })));
      };

      panel.append(
        h('div.pal__block',
          h('div.pal__blockhead', h('span.h-sec', { text: 'Contrast' }),
            h('span.pal__hint', { text: 'WCAG 2.1 ratio' })),
          sample,
          h('div.pal__cscore',
            h('div.pal__cratio.mono', { text: rtxt }),
            h('button.ibtn.tip', { type: 'button', 'data-tip': 'Swap colours', 'aria-label': 'Swap foreground and background', onclick: () => { const t = S.contrast.fg; S.contrast.fg = S.contrast.bg; S.contrast.bg = t; renderContrast(); schedulePersist(); } }, icon('repeat'))),
          h('div.pal__cslots', slot('fg', 'Text'), slot('bg', 'Background')),
          h('div.pal__checks', ...checkEls)),
      );
    }

    /* ---------------- from a picture (#114) ---------------- */
    /* Built once, the first time the tab opens, and put back on every visit. */
    let picView = null;
    function renderPicture() {
      clear(panel);
      if (picView) { panel.appendChild(picView); return; }
      picView = h('div.pal__block', h('div.pal__pload', h('span.spinner'), h('small', { text: 'Opening…' })));
      panel.appendChild(picView);
      if (!document.getElementById('feat-pictools-css')) {
        document.head.appendChild(Object.assign(document.createElement('link'), { id: 'feat-pictools-css', rel: 'stylesheet', href: 'css/feat-pictools.css' }));
      }
      Promise.all([import('../photos/pt-common.js'), import('../photos/pal-extract.js')]).then(([C, X]) => {
        if (S.dead) return;
        buildPicture(C, X);
      }).catch(err => { picView.replaceChildren(h('small', { text: `Couldn’t open this view: ${err?.message || err}` })); picView = null; });
    }
    function buildPicture(C, X) {
      const P = { count: 6, cols: [], picked: null, pw: 0, ph: 0, seq: 0, src: null, base: null };
      const cv = h('canvas.pal__pic', { 'aria-label': 'The picture. Click it to pick the colour under the pointer.', tabindex: '0' });
      const cg = cv.getContext('2d', { willReadFrequently: true });
      const wrap = h('div.pal__picwrap', { hidden: true }, cv);
      const hint = h('small.pal__hint', { text: 'Pick a picture below. Then click anywhere on it to pick a single colour.' });
      const list = h('div.pal__pcols');
      const picked = h('div.pal__ppicked', { hidden: true });
      const cnt = h('output', { text: '6' });
      const cntIn = h('input.pal__range.pal__range--plain', { type: 'range', min: '5', max: '8', step: '1', value: '6', 'aria-label': 'How many colours' });
      const colorsHex = () => P.cols.map(c => rgbToHex(c));
      const btns = h('div.pal__row2', { hidden: true },
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { act: 'save-palette' }, onclick: () => { addSwatches(colorsHex()); persist(); notify({ app: 'Static Color', icon: 'bookmark', title: 'Palette saved', message: `${P.cols.length} colours are in your saved swatches`, timeout: 2200 }); } }, icon('bookmark'), h('span', { text: 'Save palette' })),
        h('button.btn.btn--sm', { type: 'button', onclick: () => savePng(colorsHex(), 'Picture') }, icon('image'), h('span', { text: 'Save as PNG' })),
        h('button.btn.btn--sm', { type: 'button', onclick: e => copyText(colorsHex().join(', '), e.currentTarget) }, icon('copy'), h('span', { text: 'Copy all' })));

      function rowFor(c) {
        const hexv = rgbToHex(c), hsl = rgbToHsl(c.r, c.g, c.b);
        const rgbT = `rgb(${c.r}, ${c.g}, ${c.b})`, hslT = `hsl(${round(hsl.h)}, ${round(hsl.s * 100)}%, ${round(hsl.l * 100)}%)`;
        const val = t => h('span.pal__pval.mono', { text: t });
        return h('div.pal__pcol', { dataset: { hex: hexv, share: String(c.share) } },
          h('button.pal__pchip', { type: 'button', style: { background: hexv }, title: `Use ${hexv} as the current colour`, 'aria-label': `Use ${hexv} as the current colour`, onclick: () => loadColor(hexv) }),
          h('div.pal__pinfo2',
            h('div.pal__pline', h('b.pal__pshare', { text: `${(c.share * 100).toFixed(1)}%` }), h('span.pal__pbar', h('i', { style: { width: `${Math.max(2, c.share * 100)}%`, background: hexv } }))),
            h('div.pal__pline', val(hexv), copyBtn(() => hexv)),
            h('div.pal__pline', val(rgbT), copyBtn(() => rgbT)),
            h('div.pal__pline', val(hslT), copyBtn(() => hslT))));
      }
      function extract() {
        if (!P.pw) return;
        const k = Math.min(1, 128 / Math.max(P.pw, P.ph));
        const sw = Math.max(1, Math.round(P.pw * k)), sh = Math.max(1, Math.round(P.ph * k));
        const t = document.createElement('canvas');
        t.width = sw; t.height = sh;
        const tg = t.getContext('2d', { willReadFrequently: true });
        /* nearest-neighbour: every sampled pixel is one the picture really has. Smoothing
           invents in-between colours at edges, and how many depends on the browser's scaler */
        tg.imageSmoothingEnabled = false;
        tg.drawImage(P.copy, 0, 0, sw, sh);
        P.cols = X.medianCut(tg.getImageData(0, 0, sw, sh).data, P.count);
        list.replaceChildren(...P.cols.map(rowFor));
        btns.hidden = !P.cols.length;
        hint.textContent = `${P.cols.length} main colours, measured on a ${sw} × ${sh} copy of ${P.src.name}. Click the picture to pick one colour.`;
      }
      cntIn.addEventListener('input', () => { P.count = Number(cntIn.value); cnt.textContent = String(P.count); extract(); });

      async function openPic(src) {
        const seq = ++P.seq;
        try {
          const bmp = await C.bitmapOf(await C.blobOfSource(src));
          if (S.dead || seq !== P.seq) return;
          const { w, h: hh } = C.sizeOfBitmap(bmp);
          const k = Math.min(1, 480 / Math.max(w, hh));
          P.pw = cv.width = Math.max(1, Math.round(w * k)); P.ph = cv.height = Math.max(1, Math.round(hh * k));
          cg.imageSmoothingQuality = 'high';
          cg.drawImage(bmp, 0, 0, P.pw, P.ph);
          try { bmp.close?.(); } catch (e) { /* not an ImageBitmap */ }
          P.src = src; P.picked = null; picked.hidden = true;
          wrap.hidden = false;
          P.base = cg.getImageData(0, 0, P.pw, P.ph);
          P.copy = document.createElement('canvas');
          P.copy.width = P.pw; P.copy.height = P.ph;
          P.copy.getContext('2d').putImageData(P.base, 0, 0);
          extract();
        } catch (err) {
          notify({ app: 'Static Color', icon: 'alert', title: 'Can’t use that picture', message: err?.message || String(err) });
        }
      }
      /* the eyedropper: the colour of the pixel that was clicked, read from the picture itself */
      function pick(e) {
        if (!P.base) return;
        const r = cv.getBoundingClientRect();
        const x = clamp(Math.floor((e.clientX - r.left) / r.width * P.pw), 0, P.pw - 1), y = clamp(Math.floor((e.clientY - r.top) / r.height * P.ph), 0, P.ph - 1);
        const o = (y * P.pw + x) * 4, d = P.base.data;
        if (d[o + 3] < 8) return;
        const hexv = rgbToHex({ r: d[o], g: d[o + 1], b: d[o + 2] });
        P.picked = { hex: hexv, x, y };
        cg.putImageData(P.base, 0, 0);
        cg.save();
        cg.lineWidth = 3; cg.strokeStyle = '#000'; cg.beginPath(); cg.arc(x, y, 9, 0, Math.PI * 2); cg.stroke();
        cg.lineWidth = 1.5; cg.strokeStyle = '#fff'; cg.beginPath(); cg.arc(x, y, 9, 0, Math.PI * 2); cg.stroke();
        cg.restore();
        picked.hidden = false;
        picked.replaceChildren(
          h('span.pal__pchip.pal__pchip--sm', { style: { background: hexv }, role: 'img', 'aria-label': `Picked colour ${hexv}` }),
          h('span.pal__pval.mono', { dataset: { role: 'picked' }, text: hexv }), copyBtn(() => hexv),
          h('button.btn.btn--sm', { type: 'button', onclick: () => loadColor(hexv) }, h('span', { text: 'Use' })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => addSwatches([hexv]) }, icon('plus'), h('span', { text: 'Save' })));
      }
      cv.addEventListener('pointerdown', e => { if (e.button === 0) { cv.focus(); pick(e); } });

      const picker = C.pickerView(api, { label: 'Pictures to take colours from', onChange: (l, src, added) => { if (added) openPic(src); } });
      cleanups.push(() => picker.destroy());
      picView.replaceChildren(
        h('div.pal__blockhead', h('span.h-sec', { text: 'From picture' }), h('span.pal__hint', { text: 'Median cut on a small copy' })),
        wrap, hint,
        h('label.pal__grow', h('span.pal__flabel', { text: 'Colours' }), cntIn, cnt),
        list, picked, btns,
        h('span.pal__flabel', { text: 'Pictures' }), picker.el);
    }

    function renderPanel() {
      if (S.tab === 'harmony') renderHarmony();
      else if (S.tab === 'gradient') renderGradient();
      else if (S.tab === 'picture') renderPicture();
      else renderContrast();
    }

    /* ---------------- saved swatches ---------------- */
    function addCurrentSwatch() { addSwatches([curHexSolid()]); }
    function addSwatches(list) {
      let added = 0;
      for (const hexv of list) {
        const H = rgbToHex(parseHex(hexv));
        if (!S.swatches.includes(H)) { S.swatches.unshift(H); added++; }
      }
      if (S.swatches.length > 60) S.swatches = S.swatches.slice(0, 60);
      if (added) { renderStrip(); persist(); }
    }
    function renderStrip() {
      clear(savedStrip);
      if (!S.swatches.length) {
        savedStrip.appendChild(h('div.pal__stripempty', { text: 'No saved swatches yet — pick a colour and press Save.' }));
        return;
      }
      S.swatches.forEach((hexv, i) => {
        savedStrip.appendChild(h('div.pal__scell',
          h('button.pal__sw', {
            type: 'button', title: `Load ${hexv}`, 'aria-label': `Load ${hexv}`,
            style: { background: hexv }, onclick: () => loadColor(hexv),
          }),
          h('button.pal__swx', {
            type: 'button', 'aria-label': `Remove ${hexv}`, title: 'Remove',
            onclick: () => { S.swatches.splice(i, 1); renderStrip(); persist(); },
          }, icon('x'))));
      });
    }

    function loadColor(hexv) {
      const p = parseHex(hexv);
      if (!p) return;
      const hsv = rgbToHsv(p.r, p.g, p.b);
      S.h = hsv.h; S.s = hsv.s; S.v = hsv.v; S.a = p.a;
      syncAll();
      schedulePersist();
    }

    /* ---------------- EyeDropper (real, when supported) ---------------- */
    async function pickFromScreen() {
      eyeSay('');
      if (!('EyeDropper' in window)) {
        eyeSay('This browser can\u2019t pick a colour from the screen (it needs the EyeDropper feature of Chrome, Edge or Brave on a computer). Type a hex value or use the sliders instead.');
        return;
      }
      try {
        const res = await new window.EyeDropper().open();
        if (S.dead) return;
        if (res?.sRGBHex) { loadColor(res.sRGBHex); eyeSay(`Picked ${curHex()}`); }
      } catch (err) {
        /* pressing Esc rejects with AbortError: the person cancelled */
        if (err && err.name !== 'AbortError' && !S.dead) eyeSay('The screen picker could not start: ' + (err.message || err.name));
      }
    }

    /* ---------------- Save PNG (real file via media.js) ---------------- */
    async function savePng(colors, label = HARMONIES[S.harmony].label) {
      try {
        const sw = 200, hgt = 220, pad = 0;
        const cvs = document.createElement('canvas');
        cvs.width = sw * colors.length;
        cvs.height = hgt;
        const cx = cvs.getContext('2d');
        colors.forEach((hexv, i) => {
          cx.fillStyle = hexv;
          cx.fillRect(i * sw + pad, 0, sw - pad, hgt);
        });
        const blob = await new Promise(res => cvs.toBlob(res, 'image/png'));
        if (!blob) throw new Error('Could not render the image.');
        const name = `${label} palette.png`;
        const { path } = await saveMedia(api.vfs.HOME + '/Pictures', name, blob);
        notify({
          app: 'Static Color', icon: 'image', title: 'Saved to Pictures', message: path,
          actions: [{ label: 'Open', onClick: () => api.openApp('photos') }],
        });
      } catch (err) {
        notify({ app: 'Static Color', icon: 'alert', title: 'Save failed', message: err.message });
      }
    }

    /* ============================ sync ============================ */
    /* Update every visual from the canonical HSV+alpha state.
       `skip` is the element currently being typed into, so its value
       is not overwritten under the caret. */
    function syncAll(skip) {
      const rgb = curRgb();
      const hueCol = `hsl(${round(S.h)} 100% 50%)`;
      svArea.style.setProperty('--hue', hueCol);
      svThumb.style.left = (S.s * 100) + '%';
      svThumb.style.top = ((1 - S.v) * 100) + '%';
      svThumb.style.background = curHexSolid();
      svArea.setAttribute('aria-valuetext', `${curHexSolid()}, saturation ${round(S.s * 100)}%, brightness ${round(S.v * 100)}%`);

      if (skip !== hueRange) hueRange.value = String(round(S.h));
      if (skip !== alphaRange) alphaRange.value = String(round(S.a * 100));
      if (skip !== alphaNum) alphaNum.value = String(round(S.a * 100));
      alphaRange.style.setProperty('--acol', `rgb(${rgb.r} ${rgb.g} ${rgb.b})`);

      bigSwatch.style.background = curHex();
      bigHex.textContent = curHex();

      if (skip !== hexInput) hexInput.value = curHex();
      if (skip !== rIn) rIn.value = String(rgb.r);
      if (skip !== gIn) gIn.value = String(rgb.g);
      if (skip !== bIn) bIn.value = String(rgb.b);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      if (skip !== hIn) hIn.value = String(round(hsl.h));
      if (skip !== sIn) sIn.value = String(round(hsl.s * 100));
      if (skip !== lIn) lIn.value = String(round(hsl.l * 100));

      /* harmony depends on the current colour */
      if (S.tab === 'harmony') renderHarmony();
    }

    /* ---------------- picker interactions ---------------- */
    function svFromEvent(e) {
      const r = svArea.getBoundingClientRect();
      S.s = clamp((e.clientX - r.left) / r.width, 0, 1);
      S.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      syncAll();
      schedulePersist();
    }
    svArea.addEventListener('pointerdown', e => {
      e.preventDefault();
      svArea.setPointerCapture(e.pointerId);
      svArea.classList.add('is-drag');
      svArea.focus();
      svFromEvent(e);
    });
    svArea.addEventListener('pointermove', e => { if (svArea.hasPointerCapture(e.pointerId)) svFromEvent(e); });
    svArea.addEventListener('pointerup', e => { svArea.classList.remove('is-drag'); try { svArea.releasePointerCapture(e.pointerId); } catch (err) {} });
    svArea.addEventListener('keydown', e => {
      const big = e.shiftKey ? 0.1 : 0.02;
      let used = true;
      if (e.key === 'ArrowLeft') S.s = clamp(S.s - big, 0, 1);
      else if (e.key === 'ArrowRight') S.s = clamp(S.s + big, 0, 1);
      else if (e.key === 'ArrowUp') S.v = clamp(S.v + big, 0, 1);
      else if (e.key === 'ArrowDown') S.v = clamp(S.v - big, 0, 1);
      else used = false;
      if (used) { e.preventDefault(); syncAll(); schedulePersist(); }
    });

    hueRange.addEventListener('input', () => { S.h = wrapHue(+hueRange.value); syncAll(hueRange); schedulePersist(); });
    const setAlpha = (v, skip) => { S.a = clamp((+v) / 100, 0, 1); syncAll(skip); schedulePersist(); };
    alphaRange.addEventListener('input', () => setAlpha(alphaRange.value, alphaRange));
    alphaNum.addEventListener('input', () => setAlpha(alphaNum.value, alphaNum));

    hexInput.addEventListener('input', () => {
      const p = parseHex(hexInput.value);
      if (!p) { hexInput.classList.add('is-bad'); return; }
      hexInput.classList.remove('is-bad');
      const hsv = rgbToHsv(p.r, p.g, p.b);
      S.h = hsv.h; S.s = hsv.s; S.v = hsv.v; S.a = p.a;
      syncAll(hexInput);
      schedulePersist();
    });
    hexInput.addEventListener('blur', () => { hexInput.classList.remove('is-bad'); syncAll(); });

    function readRgbFields(skip) {
      const r = clamp(round(+rIn.value) || 0, 0, 255);
      const g = clamp(round(+gIn.value) || 0, 0, 255);
      const b = clamp(round(+bIn.value) || 0, 0, 255);
      const hsv = rgbToHsv(r, g, b);
      S.h = hsv.h; S.s = hsv.s; S.v = hsv.v;
      syncAll(skip);
      schedulePersist();
    }
    [rIn, gIn, bIn].forEach(el => el.addEventListener('input', () => readRgbFields(el)));

    function readHslFields(skip) {
      const H = wrapHue(+hIn.value || 0);
      const Sl = clamp((+sIn.value || 0) / 100, 0, 1);
      const L = clamp((+lIn.value || 0) / 100, 0, 1);
      const rgb = hslToRgb(H, Sl, L);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      S.h = hsv.h; S.s = hsv.s; S.v = hsv.v;
      syncAll(skip);
      schedulePersist();
    }
    [hIn, sIn, lIn].forEach(el => el.addEventListener('input', () => readHslFields(el)));

    /* ============================ assemble ============================ */
    root.appendChild(h('div.app.app--col',
      h('div.pal',
        h('div.pal__scroll',
          h('div.pal__work', pickCol, toolsCol)))));

    win.setTools?.(
      h('button.ibtn.tip', { 'data-tip': 'Copy hex', 'aria-label': 'Copy hex', onclick: e => copyText(curHex(), e.currentTarget) }, icon('copy')),
    );

    setTab(S.tab);
    renderStrip();
    syncAll();

    /* ============================ teardown ============================ */
    return () => {
      S.dead = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clearTimeout(persistT);
      for (const f of cleanups) { try { f(); } catch (e) { /* already gone */ } }
      persist();     /* flush the latest state on close */
    };
  },
});
