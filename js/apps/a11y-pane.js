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
  ['none', 'Off'],
  ['grayscale', 'Grayscale'],
  ['protan', 'Red-weak (protanopia)'],
  ['deutan', 'Green-weak (deuteranopia)'],
  ['tritan', 'Blue-weak (tritanopia)'],
];
export const FILTER_MODES = [['correct', 'Correct colours (daltonize)'], ['simulate', 'Simulate (see it as they do)']];
export const FONTS = [['default', 'Inter (StaticOS)'], ['dyslexic', 'OpenDyslexic'], ['hyperlegible', 'Atkinson Hyperlegible']];
const FOLLOW = [['both', 'Pointer and keyboard focus'], ['pointer', 'Pointer'], ['focus', 'Keyboard focus']];

export function sections({ srow, group, caption, note, select, prefSwitch, rangeCtl, pref, setPref }) {
  const narrow = el => { el.style.maxWidth = '220px'; return el; };
  const lens = lensSupported();

  /* ---- magnifier ---- */
  const magnifier = [
    caption('Magnifier'),
    group(
      srow('magnifier', prefSwitch('magnifier')),
      srow('magZoom', rangeCtl('Magnifier zoom', { ...ZOOM }, pref('magZoom'), v => setPref('magZoom', v), v => `${v}×`)),
      srow('magSize', rangeCtl('Lens size', { ...SIZE }, pref('magSize'), v => setPref('magSize', v), v => `${v}`)),
      srow('magFollow', narrow(select('Magnifier follows', FOLLOW, String(pref('magFollow')), v => setPref('magFollow', v)))),
      srow('magMode', narrow(select('Magnifier view', lens
        ? [['lens', 'Lens'], ['full', 'Full screen']]
        : [['full', 'Full screen (this browser can’t draw the lens)']], lens ? String(pref('magMode')) : 'full', v => setPref('magMode', v)))),
    ),
    note(`${KM.hint('magnifier')} turns it on or off anywhere; ${KM.hint('magnifier.in')} and ${KM.hint('magnifier.out')} zoom while it is on. `
      + 'The lens shows the real screen — games, videos and pages magnify too — and clicks go to what is under the pointer.'),
  ];

  /* ---- colour filters ---- */
  const type = String(pref('colorFilter'));
  const cvd = t => ['protan', 'deutan', 'tritan'].includes(t);
  /* simulate / correct means something only for the colour-vision filters */
  const modeSel = narrow(select('Colour filter kind', FILTER_MODES, String(pref('colorFilterMode')), v => setPref('colorFilterMode', v)));
  modeSel.disabled = !cvd(type);
  const colour = [
    caption('Colour filters'),
    group(
      srow('colorFilter', narrow(select('Colour filter', FILTERS, type, v => { setPref('colorFilter', v); modeSel.disabled = !cvd(v); }))),
      srow('colorFilterMode', modeSel),
      srow('colorFilterStrength', rangeCtl('Filter strength', { min: 0, max: 100, step: 5, def: 100 }, pref('colorFilterStrength'),
        v => setPref('colorFilterStrength', v), v => `${v}%`)),
    ),
    note('Correct moves the colours a red-, green- or blue-weak eye mixes up into ones it can tell apart '
      + '(daltonize). Simulate shows the screen the way someone with that colour vision sees it — for checking '
      + 'that something still reads. Apps still read and save the real colours.'),
  ];

  /* ---- reading ---- */
  const LH = SPACING.lineHeight, LS = SPACING.letterSpacing, WS = SPACING.wordSpacing;
  const asIs = (v, R, show) => (Number(v) > R.min + 1e-6 ? show(Number(v)) : 'Auto');
  const reading = [
    caption('Reading'),
    group(
      srow('fontFace', narrow(select('Reading font', FONTS, String(pref('fontFace')), v => setPref('fontFace', v)))),
      srow('lineHeight', rangeCtl('Line spacing', { ...LH, def: LH.min }, Math.max(LH.min, Number(pref('lineHeight')) || LH.min),
        v => setPref('lineHeight', v > LH.min + 1e-6 ? +v.toFixed(2) : 0), v => asIs(v, LH, x => x.toFixed(1)))),
      srow('letterSpacing', rangeCtl('Letter spacing', { ...LS, def: 0 }, Number(pref('letterSpacing')) || 0,
        v => setPref('letterSpacing', +v.toFixed(2)), v => asIs(v, LS, x => `${x.toFixed(2)}em`))),
      srow('wordSpacing', rangeCtl('Word spacing', { ...WS, def: 0 }, Number(pref('wordSpacing')) || 0,
        v => setPref('wordSpacing', +v.toFixed(2)), v => asIs(v, WS, x => `${x.toFixed(2)}em`))),
    ),
    note('Line spacing 1.5, letters 0.12em and words 0.16em is the spacing WCAG asks every page to cope with. '
      + 'Code editors and the terminal keep their own, so their columns still line up.'),
  ];

  return [...magnifier, ...colour, ...reading];
}

export default { sections, FILTERS, FILTER_MODES, FONTS };
