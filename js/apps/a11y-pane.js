/* ============================================================
   a11y-pane.js — the parts of Settings › Accessibility that came
   with the magnifier: Magnifier, Colour filters, and Reading (the
   font and its spacing).

   They are preferences like the rest — js/shell/magnifier.js and
   js/core/appearance.js act on them all session, Settings open or
   not. This file only draws their rows.

   sections(kit) -> nodes. kit is Settings' own row kit:
   { api, srow, group, caption, note, select, prefSwitch, rangeCtl,
     pref, setPref }
   ============================================================ */
import * as KM from '../core/keymap.js';
import { SPACING } from '../core/appearance.js';
import { ZOOM, SIZE, lensSupported } from '../shell/magnifier.js';

export const FILTERS = [
  ['none', t('Off')],
  ['grayscale', t('Grayscale')],
  ['protan', 'Red-weak (protanopia)'],
  ['deutan', 'Green-weak (deuteranopia)'],
  ['tritan', 'Blue-weak (tritanopia)'],
];
export const FILTER_MODES = [['correct', 'Correct colours (daltonize)'], ['simulate', t('Simulate (see it as they do)')]];
export const FONTS = [['default', 'Inter (StaticOS)'], ['dyslexic', 'OpenDyslexic'], ['hyperlegible', t('Atkinson Hyperlegible')]];
const FOLLOW = [['both', t('Pointer and keyboard focus')], ['pointer', t('Pointer')], ['focus', t('Keyboard focus')]];

export function sections({ srow, group, caption, note, select, prefSwitch, rangeCtl, pref, setPref }) {
  const narrow = el => { el.style.maxWidth = '220px'; return el; };
  const lens = lensSupported();

  /* ---- magnifier ---- */
  const magnifier = [
    caption(t('Magnifier')),
    group(
      srow('magnifier', prefSwitch('magnifier')),
      srow('magZoom', rangeCtl(t('Magnifier zoom'), { ...ZOOM }, pref('magZoom'), v => setPref('magZoom', v), v => `${v}×`)),
      srow('magSize', rangeCtl(t('Lens size'), { ...SIZE }, pref('magSize'), v => setPref('magSize', v), v => `${v}`)),
      srow('magFollow', narrow(select(t('Magnifier follows'), FOLLOW, String(pref('magFollow')), v => setPref('magFollow', v)))),
      srow('magMode', narrow(select(t('Magnifier view'), lens
        ? [['lens', t('Lens')], ['full', t('Full screen')]]
        : [['full', t('Full screen (this browser can’t draw the lens)')]], lens ? String(pref('magMode')) : 'full', v => setPref('magMode', v)))),
    ),
    note(t('{a} turns it on or off anywhere; {b} and {c} zoom while it is on. ', { a: KM.hint('magnifier'), b: KM.hint('magnifier.in'), c: KM.hint('magnifier.out') })
      + t('The lens shows the real screen — games, videos and pages magnify too — and clicks go to what is under the pointer.')),
  ];

  /* ---- colour filters ---- */
  const type = String(pref('colorFilter'));
  const cvd = t => ['protan', 'deutan', 'tritan'].includes(t);
  /* simulate / correct means something only for the colour-vision filters */
  const modeSel = narrow(select(t('Colour filter kind'), FILTER_MODES, String(pref('colorFilterMode')), v => setPref('colorFilterMode', v)));
  modeSel.disabled = !cvd(type);
  const colour = [
    caption(t('Colour filters')),
    group(
      srow('colorFilter', narrow(select(t('Colour filter'), FILTERS, type, v => { setPref('colorFilter', v); modeSel.disabled = !cvd(v); }))),
      srow('colorFilterMode', modeSel),
      srow('colorFilterStrength', rangeCtl(t('Filter strength'), { min: 0, max: 100, step: 5, def: 100 }, pref('colorFilterStrength'),
        v => setPref('colorFilterStrength', v), v => `${v}%`)),
    ),
    note(t('Correct moves the colours a red-, green- or blue-weak eye mixes up into ones it can tell apart (daltonize). Simulate shows the screen the way someone with that colour vision sees it — for checking that something still reads. Apps still read and save the real colours.')),
  ];

  /* ---- reading ---- */
  const LH = SPACING.lineHeight, LS = SPACING.letterSpacing, WS = SPACING.wordSpacing;
  const asIs = (v, R, show) => (Number(v) > R.min + 1e-6 ? show(Number(v)) : t('Auto'));
  const reading = [
    caption(t('Reading')),
    group(
      srow('fontFace', narrow(select(t('Reading font'), FONTS, String(pref('fontFace')), v => setPref('fontFace', v)))),
      srow('lineHeight', rangeCtl(t('Line spacing'), { ...LH, def: LH.min }, Math.max(LH.min, Number(pref('lineHeight')) || LH.min),
        v => setPref('lineHeight', v > LH.min + 1e-6 ? +v.toFixed(2) : 0), v => asIs(v, LH, x => x.toFixed(1)))),
      srow('letterSpacing', rangeCtl(t('Letter spacing'), { ...LS, def: 0 }, Number(pref('letterSpacing')) || 0,
        v => setPref('letterSpacing', +v.toFixed(2)), v => asIs(v, LS, x => `${x.toFixed(2)}em`))),
      srow('wordSpacing', rangeCtl(t('Word spacing'), { ...WS, def: 0 }, Number(pref('wordSpacing')) || 0,
        v => setPref('wordSpacing', +v.toFixed(2)), v => asIs(v, WS, x => `${x.toFixed(2)}em`))),
    ),
    note(t('Line spacing 1.5, letters 0.12em and words 0.16em is the spacing WCAG asks every page to cope with. Code editors and the terminal keep their own, so their columns still line up.')),
  ];

  return [...magnifier, ...colour, ...reading];
}

/* ============================================================
   The rest of Settings › Accessibility: the one-click Reduce clutter,
   the "?" help chip, bigger focus rings and pointer, the on-screen
   keyboard, captions and a flash for sounds, captions for StaticOS's
   own videos, and the status-bar menu.

   extras(kit) -> { intro, sight, keyboard, sounds, bar } — arrays of
   nodes that settings.js drops into its panes. kit adds to the row kit:
   { api, btn, repaint }
   ============================================================ */
import * as AQ from '../core/a11yquick.js';
import { t } from '../core/i18n.js';

export const FOCUS_SIZES = [['normal', t('Normal')], ['large', t('Large')], ['xlarge', t('Extra large')]];

let helpOpen = null;      /* the "?" card: open the first time Settings shows this pane, then folded */

export function extras({ api, srow, group, caption, note, select, prefSwitch, pref, setPref, btn, repaint }) {
  const { h } = api;
  const narrow = el => { el.style.maxWidth = '220px'; return el; };

  /* ---- the "?" chip ---- */
  if (helpOpen === null) {
    helpOpen = !pref('a11yHelpSeen');
    if (helpOpen) setTimeout(() => setPref('a11yHelpSeen', true), 0);     /* shown once: next time it starts folded */
  }
  const card = h('div.card.a11y-help', { id: 'a11y-help', hidden: !helpOpen, role: 'region', 'aria-label': t('What is in Accessibility') },
    h('p', { style: { margin: '0 0 var(--sp-3)' }, text: t('Everything here applies to the whole of StaticOS, at once, and you can undo any of it.') }),
    h('ul', { style: { margin: 0, paddingLeft: '1.2em', display: 'grid', gap: 'var(--sp-2)' } },
      h('li', { text: t('Too much going on? Reduce clutter turns off the pet, widgets, effects and animation in one click.') }),
      h('li', { text: t('Hard to read? Text size, High contrast, the Magnifier, colour filters and the reading font are below.') }),
      h('li', { text: t('Hard to hear? Captions for sounds and Flash the screen put notifications and alerts on the screen.') }),
      h('li', { text: t('Hard to type or point? The on-screen keyboard, a large pointer and bigger focus rings help.') }),
      h('li', { text: t('Want these close at hand? Show the accessibility menu in the status bar.') })));
  const chip = h('button.chip.a11y-chip', {
    type: 'button', 'aria-expanded': String(!!helpOpen), 'aria-controls': 'a11y-help',
    onclick: () => { helpOpen = !helpOpen; card.hidden = !helpOpen; chip.setAttribute('aria-expanded', String(helpOpen)); },
  }, h('b', { text: '?', 'aria-hidden': 'true' }), h('span', { text: t('What can I change here?') }));

  /* ---- Reduce clutter ---- */
  const done = AQ.isDecluttered();
  const back = done && AQ.canRestore();
  const clutter = group(srow('reduceClutter', back
    ? btn('rotate-ccw', t('Bring it back'), () => { AQ.restoreClutter(); repaint(); })
    : btn('sparkles', done ? t('Already quiet') : t('Reduce clutter'), () => { AQ.reduceClutter(); repaint(); }, done ? '.btn--ghost' : '.btn--primary')));
  if (done && !back) clutter.querySelector('button').disabled = true;

  /* ---- sight ---- */
  const sight = [srow('largePointer', prefSwitch('largePointer'))];

  /* ---- keyboard ---- */
  const keyboard = [
    srow('focusSize', narrow(select(t('Focus outline size'), FOCUS_SIZES, String(pref('focusSize')), v => setPref('focusSize', v)))),
    srow('osk', prefSwitch('osk')),
  ];

  /* ---- sounds you can't hear ---- */
  const sounds = [
    caption(t('Sounds and video')),
    group(
      srow('soundCaptions', prefSwitch('soundCaptions')),
      srow('flashAlerts', prefSwitch('flashAlerts')),
      srow('alert.try', btn('play', t('Try it'), () => api.bus.emit('a11y:alert-preview'))),
      srow('videoCaptions', prefSwitch('videoCaptions'))),
    note(t('Only sounds that mean something are captioned: a notification, an error, the timer. Taps and window sounds are not, or every click would print a line. The flash is a single soft frame of light at the edge of the screen, at most once a second.')),
  ];

  const bar = [caption(t('Status bar')), group(srow('a11yMenu', prefSwitch('a11yMenu')))];

  return { intro: [h('div.row', chip), card, caption(t('Quick')), clutter], sight, keyboard, sounds, bar };
}

export default { sections, extras, FILTERS, FILTER_MODES, FONTS, FOCUS_SIZES };
