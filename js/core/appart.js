/* ============================================================
   appart.js — the app icons: one original drawing per app, keyed by
   app id, and appTile(), which every app tile in the shell is made with.

   An entry is [swatch, drawing, fit, small, small fit] on a 64 grid:
     swatch   a name from PAL: the tile, one hue, lighter at the top
     drawing  the subject
     fit      optional [scale, dx, dy]: brings the subject to the set's one
              optical size and centre. Measured from the rendered subject:
              size = mean of √(bbox area) and √(inked area), brought to 38.5
              (about 60% of the tile), centred a touch high (y 31.6) because
              the contact shadow adds weight below. A new drawing can leave it
              null and be drawn at that size by hand.
     small    optional simpler drawing for tiles under 36px (a dock folder,
              Spotlight, the All apps list), with its own fit; CSS switches it
              by the tile's rendered size (a container query in shell.css)

   Every tile is drawn the same way, by artSvg():
     · the tile: its swatch as a gentle top-to-bottom gradient, lit from the
       top left, with a soft shade along the bottom edge
     · the subject on it, in its own two or three tones
   The light is one model for the whole set and lives here, once: a few
   gradients each tile gets (ids made per tile drawn), not repeated per icon.

   Shorthand, expanded once per id by compile():
     fill="[#top,#bottom]"   a gradient, with an id unique to each tile drawn
     ~ inside one            a pale tint of the tile's own hue: [#fff,~]
     <path s ...>            a lit object: a soft contact shadow under it, then
                             the shape, then its light (a lit face top left, a
                             shaded side bottom right, a rim along the top)
     <path h ...>, h=".5"    a highlight: white, translucent
     <path k ...>, k=".3"    a shade: black, translucent
     <path m ...>, <path s i ...>   its tone in Outline and Tinted (dim / full
                             colour) where tone() guesses wrong
   Light, shadows, highlights and shades are class="d" (depth), which the
   Flat icon style takes away; Outline and Tinted take the tile too and draw
   the subject in one colour (see tone()). No filters: a dock of these repaints
   on every magnification frame, so depth is shapes and gradients only.

   Gradient ids are made per tile drawn, never per app: a page holds several
   tiles of one app, and a gradient inside a display:none tile would otherwise
   blank every other tile pointing at the same id.

   An entry whose drawing starts with = is a third-party service's mark from
   icons.js, set on a tile. An app with no entry gets the plain glyph tile,
   so a new app works before it has art. Add its drawing here.
   ============================================================ */
import { h } from './dom.js';
import { icon, iconSvg } from './icons.js';

/* a line: round ends, no fill */
const L = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
/* a filled shape with its corners rounded by a stroke of the same paint */
const R = w => `stroke-width="${w}" stroke-linejoin="round"`;

/* The tiles. One hue each, a little lighter and warmer at the top; picked as a
   set so that neighbours in the dock differ (Files blue, Settings and Trash
   grey, the black tiles of the third-party marks and Terminal stay theirs). */
const PAL = {
  rose:    ['#ff6b8e', '#d01848'],
  crimson: ['#f9506f', '#9c0f37'],
  red:     ['#ff6255', '#c81c28'],
  coral:   ['#ff8566', '#df3e33'],
  orange:  ['#ff9234', '#d94407'],
  amber:   ['#ffab2c', '#d46802'],
  yellow:  ['#ffc21f', '#d97400'],
  lime:    ['#82c431', '#267812'],
  green:   ['#3fcf72', '#097a3a'],
  emerald: ['#2fcb94', '#066a4d'],
  teal:    ['#2ac2b2', '#06676c'],
  cyan:    ['#45cdf0', '#0874ad'],
  sky:     ['#55b4fb', '#1364cf'],
  blue:    ['#4a9cff', '#1046c9'],
  navy:    ['#4a7eec', '#0d2775'],
  indigo:  ['#7581ff', '#2f2fc2'],
  violet:  ['#9a7dff', '#4d27cf'],
  purple:  ['#bb6ff8', '#6a1cc4'],
  magenta: ['#ec5fc6', '#961a7f'],
  pink:    ['#ff6fae', '#c4246c'],
  grey:    ['#97a0b2', '#495264'],
  slate:   ['#7a8397', '#2a303c'],
  ink:     ['#454a59', '#0f1116'],
  night:   ['#5d3c94', '#1b0d37'],
};

const ART = {
  markets: ['emerald', `<rect s x="9" y="12" width="46" height="40" rx="8" fill="[#264d45,#0b1c1a]"/><path h=".12" d="M17 12h30a8 8 0 0 1 8 8v3H9v-3a8 8 0 0 1 8-8z"/><path ${L} stroke="#d6f5e8" stroke-opacity=".7" stroke-width="2.2" d="M20 20v24M32 16.5v22M44 23v20"/><rect x="16.5" y="25" width="7" height="13" rx="2" fill="[#8dffc9,#23b56b]"/><rect x="28.5" y="20.5" width="7" height="13" rx="2" fill="[#ffa0a0,#e04646]"/><rect x="40.5" y="27.5" width="7" height="10" rx="2" fill="[#8dffc9,#23b56b]"/><path s ${L} stroke="[#ffe98a,#ffb21f]" stroke-width="3.6" d="M14 46.5l11-8 8 4 13-11"/><path fill="#ffc22e" stroke="#ffc22e" ${R(1.4)} d="M50.5 27.6l-2.4 6.5-4.4-5.2z"/>`, [0.9, 0, -0.4],
    `<rect s x="9" y="11" width="46" height="42" rx="9" fill="[#264d45,#0b1c1a]"/><rect x="15.5" y="31" width="9" height="15" rx="2.4" fill="#5cf0a6"/><rect x="27.5" y="24" width="9" height="22" rx="2.4" fill="#5cf0a6"/><rect x="39.5" y="17" width="9" height="29" rx="2.4" fill="#ffc22e"/>`, [0.89, 0, -0.4]],
  manga: ['pink', `<rect s transform="rotate(-6 32 32)" x="12" y="10" width="40" height="46" rx="5" fill="[#fff,#ece6f2]"/><g transform="rotate(-6 32 32)"><rect x="16" y="14" width="14" height="17" rx="1.6" fill="[#ffb3cf,#ff6f9c]"/><rect x="33" y="14" width="15" height="9" rx="1.6" fill="[#9fe0ff,#4aa8ee]"/><rect x="33" y="26" width="15" height="19" rx="1.6" fill="[#ffe27a,#ffb02e]"/><rect x="16" y="34" width="14" height="14" rx="1.6" fill="[#c9b3ff,#8a63ee]"/><path fill="#fff" stroke="#2a1233" stroke-width="1.6" d="M22 38.5h8v4.2l-2 1.8-1 2.2-1-2.2h-4z"/></g>`],
  files: ['blue', `<path s fill="[#93caff,#3d86ee]" d="M10 19a5 5 0 0 1 5-5h10.3a5 5 0 0 1 3.6 1.5l2.6 2.7H49a5 5 0 0 1 5 5V47a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5z"/><rect x="15" y="21.5" width="34" height="14" rx="2.4" fill="[#fff,#e2edfc]"/><path k=".1" d="M15 31.5h34v4H15z"/><path s fill="[#e6f4ff,#91c6ff]" d="M14 27.5h36a4.4 4.4 0 0 1 4.4 4.8l-1.4 15.2a5 5 0 0 1-5 4.5H16a5 5 0 0 1-5-4.5L9.6 32.3a4.4 4.4 0 0 1 4.4-4.8z"/><path h=".7" d="M14 27.5h36a4.4 4.4 0 0 1 4.4 4.5 4 4 0 0 0-4.2-2.7H13.8A4 4 0 0 0 9.6 32a4.4 4.4 0 0 1 4.4-4.5z"/>`, [0.95, 0, -1.35]],
  terminal: ['ink', `<rect s x="9" y="12" width="46" height="40" rx="8" fill="[#f1f3f7,#b4bcca]"/><rect x="12.5" y="19.5" width="39" height="29" rx="4.6" fill="[#222937,#0a0c12]"/><path k=".3" d="M17.1 19.5h29.8a4.6 4.6 0 0 1 4.6 4.6v.6H12.5v-.6a4.6 4.6 0 0 1 4.6-4.6z"/><circle cx="16" cy="15.8" r="1.6" fill="#ff5f57"/><circle cx="21" cy="15.8" r="1.6" fill="#febc2e"/><circle cx="26" cy="15.8" r="1.6" fill="#28c840"/><path ${L} stroke="#5bffa8" stroke-width="4.4" d="M19 28l7 5.6-7 5.6"/><rect x="29" y="37.4" width="13" height="4.4" rx="2.2" fill="#5bffa8"/>`, [0.9, 0, -0.4]],
  browser: ['navy', `<path ${L} stroke="#e8365f" stroke-width="3.6" transform="rotate(-22 32 32)" d="M5 32a27 8.5 0 0 1 54 0"/><circle s cx="32" cy="32" r="19" fill="[#a6f5ff,#1a7ae6]"/><ellipse cx="32" cy="32" rx="8.5" ry="19" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.4"/><path fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.4" d="M14.5 25h35M14.5 39h35"/><ellipse h=".55" cx="24.5" cy="21" rx="6" ry="3.2" transform="rotate(-32 24.5 21)"/><path s ${L} stroke="[#ffb0c2,#ff4a72]" stroke-width="3.6" transform="rotate(-22 32 32)" d="M5 32a27 8.5 0 0 0 54 0"/>`, [0.92, 0, -0.4]],
  settings: ['grey', `<circle s cx="32" cy="32" r="20" fill="none" stroke="[#fdfdff,#b8c0ce]" stroke-width="6.6" stroke-dasharray="7.85 7.85" stroke-dashoffset="3.92"/><circle s cx="32" cy="32" r="18" fill="[#fdfdff,#b8c0ce]"/><circle cx="32" cy="32" r="12" fill="[#6f798c,#dde2ea]"/><circle s cx="32" cy="32" r="8.6" fill="[#f4f6f9,#a9b2c1]"/><circle cx="32" cy="32" r="4.4" fill="[#262b36,#4a5262]"/>`, [0.92, 0, -0.4]],
  store: ['purple', `<path ${L} stroke="#f1e8ff" stroke-width="3.8" d="M23 26v-6a9 9 0 0 1 18 0v6"/><path s fill="[#fff,~]" d="M16 21h32a3 3 0 0 1 3 2.8l2.2 25.7a5 5 0 0 1-5 5.5H15.8a5 5 0 0 1-5-5.5L13 23.8a3 3 0 0 1 3-2.8z"/><circle cx="23" cy="27" r="2.4" fill="[#4a1a9c,#8a4fe8]"/><circle cx="41" cy="27" r="2.4" fill="[#4a1a9c,#8a4fe8]"/><path fill="[#ff8aa8,#d6204e]" stroke="[#ff8aa8,#d6204e]" ${R(1.6)} d="M32 32.5l8 9-8 9.5-8-9.5z"/><path h=".5" d="M32 32.5l-8 9h8z"/><path k=".14" d="M32 51l8-9.5h-8z"/>`, [0.93, 0, -0.4]],
  music: ['rose', `<path s fill="[#fff,~]" d="M27 21.5a3 3 0 0 1 2.3-2.9L47 14.3a2.5 2.5 0 0 1 3 2.4v24.8a7.5 6.2 0 1 1-4.4-5.6V25l-14.2 3.4V46a7.5 6.2 0 1 1-4.4-5.6z"/><ellipse h=".7" cx="40.4" cy="39.6" rx="3" ry="1.5" transform="rotate(-24 40.4 39.6)"/><ellipse h=".7" cx="21.8" cy="44.1" rx="3" ry="1.5" transform="rotate(-24 21.8 44.1)"/>`, [1.26, -1.39, -2.04]],
  tiktok: ['ink', '=brand-tiktok', [1.25, -2.62, -2.64]],
  photos: ['orange', `<rect s transform="rotate(9 32 32)" x="14" y="11" width="36" height="42" rx="4" fill="[#ffe6cf,#f3c193]"/><rect s transform="rotate(-6 32 32)" x="13" y="10" width="38" height="44" rx="4" fill="[#fff,~]"/><g transform="rotate(-6 32 32)"><rect x="17" y="14" width="30" height="27" rx="1.6" fill="[#74cfff,#ffe1aa]"/><circle cx="39" cy="21.5" r="4.2" fill="#fff6c2"/><path fill="#7ddca4" d="M17 41v-7.5l9.5-7.5 8 6.5 12.5-8.5V41z"/><path fill="[#2fae76,#11683f]" d="M17 41v-3.6l8.5-7.8 7.5 7.2 4.6-4.4L47 39.2V41z"/></g>`, [0.89, 0, -0.4]],
  'cloud-vms': ['indigo', `<path s fill="[#fff,~]" d="M22 31a7 7 0 0 1-1-13.9 10 10 0 0 1 19.4-1.7A8 8 0 0 1 42 31z"/><rect s x="14" y="35" width="36" height="8.6" rx="3" fill="[#fff,~]"/><rect s x="14" y="46" width="36" height="8.6" rx="3" fill="[#fff,~]"/><circle cx="20" cy="39.3" r="2.1" fill="#22d67f"/><circle cx="20" cy="50.3" r="2.1" fill="#22d67f"/><path ${L} stroke="#8a92d8" stroke-width="2.6" d="M29 39.3h15M29 50.3h15"/>`, [1.03, 0, 0.01]],
  videos: ['violet', `<rect s x="10" y="25" width="44" height="29" rx="5" fill="[#3a2d66,#140e2e]"/><path h=".1" d="M15 25h34a5 5 0 0 1 5 5v1H10v-1a5 5 0 0 1 5-5z"/><g transform="rotate(-9 11 23)"><rect s x="10" y="13" width="44" height="10" rx="2.8" fill="[#fff,~]"/><path fill="#1c1538" d="M17 13h6l-4 10h-6zM29 13h6l-4 10h-6zM41 13h6l-4 10h-6z"/></g><path s fill="[#fff,~]" stroke="[#fff,~]" ${R(2.4)} d="M27.5 33.5l11.5 6.5-11.5 6.5z"/>`, [0.88, 0.53, 1.01]],
  monitor: ['green', `<circle s i cx="32" cy="33" r="22" fill="[#5d6878,#1c2129]"/><circle cx="32" cy="33" r="18.4" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.2"/><circle cx="32" cy="33" r="17.6" fill="[#173d2d,#04100b]"/><path h=".08" d="M14 33a18 18 0 0 1 36 0z"/><g ${L} stroke-width="4.6"><path stroke="#3ce882" d="M20.2 38.5A13 13 0 0 1 21.4 25.5"/><path stroke="#ffd84d" d="M24.5 22.4a13 13 0 0 1 15 0"/><path stroke="#ff5c5c" d="M42.7 25.5A13 13 0 0 1 43.8 38.5"/></g><path s ${L} stroke="#fff" stroke-width="3.4" d="M32 33l5.5-9.5"/><circle cx="32" cy="33" r="3.8" fill="[#fff,#d5dde6]"/>`, [0.93, 0, -1.33]],
  code: ['indigo', `<path s ${L} stroke="[#fff,~]" stroke-width="6.2" d="M22 20L10.5 32 22 44M42 20l11.5 12L42 44"/><path s ${L} stroke="[#a4fbff,#3fd2f2]" stroke-width="5.8" d="M36.5 15l-9 34"/>`, [1.01, 0, -0.4]],
  notes: ['yellow', `<path s fill="[#fff,#fffbf2]" d="M19 10h26a6 6 0 0 1 6 6v28L40 55H19a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z"/><path fill="[#e2680a,#a84600]" d="M13 16a6 6 0 0 1 6-6h26a6 6 0 0 1 6 6v6H13z"/><path h=".3" d="M19 10h26a6 6 0 0 1 6 6H13a6 6 0 0 1 6-6z"/><path ${L} stroke="#d8b25a" stroke-width="3" d="M20 30.5h24M20 38h24M20 45.5h13"/><path s fill="[#fff4d0,#e3bb62]" d="M40 55v-6a5 5 0 0 1 5-5h6z"/>`, [0.94, 0, -0.87]],
  calculator: ['grey', `<rect s x="14" y="9" width="36" height="46" rx="7" fill="[#4b5364,#1a1e27]"/><rect x="19" y="14" width="26" height="10.5" rx="2.6" fill="[#e4fdec,#9fe9b9]"/><path k=".15" d="M21.6 14h20.8a2.6 2.6 0 0 1 2.6 2.6v.8H19v-.8a2.6 2.6 0 0 1 2.6-2.6z"/><path ${L} stroke="[#eef1f6,#b7bfcc]" stroke-width="6" stroke-dasharray=".01 9.6" d="M22.4 32H33M22.4 40.5H33M22.4 49H33"/><path ${L} stroke="#ff9532" stroke-width="6" stroke-dasharray=".01 8.5" d="M41.6 32v18"/>`, [0.95, 0, -0.4]],
  calendar: ['red', `<rect s x="11" y="13" width="42" height="41" rx="7.5" fill="[#fff,#e8ebf2]"/><path fill="[#c81c37,#860b1f]" d="M11 20.5a7.5 7.5 0 0 1 7.5-7.5h27a7.5 7.5 0 0 1 7.5 7.5V27H11z"/><path h=".16" d="M18.5 13h27a7.5 7.5 0 0 1 7.5 7.5H11a7.5 7.5 0 0 1 7.5-7.5z"/><path s ${L} stroke="[#fff,#d9dde6]" stroke-width="3.6" d="M22 9.5v7M42 9.5v7"/><path ${L} stroke="#b4bccb" stroke-width="4.2" stroke-dasharray=".01 7.5" d="M20 34.5h24.6M20 42h24.6M20 49.5h16"/><circle s cx="35" cy="42" r="4.4" fill="[#ff6b6b,#e0263a]"/>`, [0.9, 0, 0.68],
    `<rect s x="11" y="12" width="42" height="42" rx="8" fill="[#fff,#e8ebf2]"/><path fill="#b8162f" d="M11 20a8 8 0 0 1 8-8h26a8 8 0 0 1 8 8v8H11z"/><path ${L} stroke="#b4bccb" stroke-width="5.8" stroke-dasharray=".01 10.5" d="M21.5 36.5h21M21.5 46h21"/><circle cx="32" cy="46" r="4" fill="#e0263a"/>`, [0.92, 0, -1.32]],
  weather: ['sky', `<circle cx="41" cy="23" r="15.5" fill="none" stroke="#ffe36b" stroke-width="3.6" stroke-linecap="round" stroke-dasharray=".01 8.11"/><circle s cx="41" cy="23" r="10.5" fill="[#fff4a8,#ffae1c]"/><path s fill="[#fff,~]" d="M20 51a9 9 0 0 1-1.4-17.9 12.6 12.6 0 0 1 24.2-2.2A10.6 10.6 0 0 1 43 51z"/>`, [0.95, -2.47, 3.12]],
  camera: ['slate', `<path s fill="[#f7f8fb,#b3bbc8]" d="M10 25a5 5 0 0 1 5-5h6.6l2.6-4.6a3 3 0 0 1 2.6-1.4h10.4a3 3 0 0 1 2.6 1.4l2.6 4.6H49a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5z"/><path fill="[#3d4453,#1f232c]" d="M10 30h44v12H10z"/><circle s cx="32" cy="35" r="12.5" fill="[#eef1f5,#8c95a5]"/><circle cx="32" cy="35" r="9.4" fill="[#2b3242,#0b0e14]"/><circle cx="32" cy="35" r="6" fill="[#5a9bff,#132a72]"/><circle cx="29.4" cy="32.4" r="2.2" fill="#fff" fill-opacity=".9"/><circle cx="47.5" cy="25" r="2" fill="#ff5a5a"/>`, [0.97, 0, -1.37]],
  about: ['grey', `<circle s cx="32" cy="32" r="21" fill="[#fff,~]"/><circle cx="32" cy="32" r="17.5" fill="none" stroke="#5d6678" stroke-opacity=".12" stroke-width="1.6"/><circle s cx="32" cy="21.5" r="3.8" fill="[#56607a,#2a3142]"/><rect s x="28.3" y="27.5" width="7.4" height="17" rx="3.5" fill="[#56607a,#2a3142]"/>`, [0.97, 0, -0.4]],
  'aether-games': ['coral', `<path s fill="[#fff,~]" d="M18 19h28a11 11 0 0 1 11 11v4a11 11 0 0 1-11 11h-3.6l-3.4-3.4H25L21.6 45H18A11 11 0 0 1 7 34v-4a11 11 0 0 1 11-11z"/><path fill="[#454b5c,#20242e]" stroke="[#454b5c,#20242e]" ${R(1)} d="M15.5 29.5h4.5V25h5v4.5h4.5v5H25V39h-5v-4.5h-4.5z"/><circle s cx="41.5" cy="35.5" r="4.2" fill="[#ff7a94,#e0264f]"/><circle s cx="49" cy="28" r="4.2" fill="[#ffd36b,#f59a12]"/>`, [1, 0, -0.4]],
  'aether-anime': ['purple', `<path s fill="[#fff,~]" d="M10 33c8-12 34-15 44-4-3 13-12 23-23 23-9 0-17-8-21-19z"/><circle cx="32.5" cy="35" r="13" fill="[#d09bff,#4a12b0]"/><circle cx="32.5" cy="36" r="6.5" fill="#170733"/><circle cx="37.5" cy="30" r="4" fill="#fff"/><circle cx="27.5" cy="41" r="2" fill="#fff"/><path s fill="[#2a0f52,#13062a]" d="M7 34C14 17 44 10 57 25l-3 6C43 19 19 23 11 37z"/>`, [1, 0, -2.8]],
  'aether-cloud': ['cyan', `<path s fill="[#fff,~]" d="M19 50a10 10 0 0 1-1.5-19.9 14.5 14.5 0 0 1 28-2.2A11.6 11.6 0 0 1 45.6 50z"/><path s fill="[#38c6ff,#0a68d4]" stroke="[#38c6ff,#0a68d4]" ${R(3)} d="M27.5 29.5l12 7-12 7z"/>`, [1.09, 0.76, -2.58]],
  'aether-proxy': ['crimson', `<path s fill="[#fff,~]" d="M32 8l20 7v16c0 12.4-8.4 20.6-20 25-11.6-4.4-20-12.6-20-25V15z"/><path k=".1" d="M32 8l20 7v16c0 12.4-8.4 20.6-20 25z"/><path s fill="[#ec4068,#a3123c]" stroke="[#ec4068,#a3123c]" ${R(1.6)} d="M22 29h12v-6.5L45 32l-11 9.5V35H22z"/>`, [0.93, 0, -0.4]],
  'aether-roblox': ['ink', '=brand-roblox', [1.3, 0, -0.4]],
  'aether-library': ['pink', `<rect s x="12" y="17" width="10.5" height="35" rx="2.4" fill="[#fff6cc,#ffc94d]"/><path k=".12" d="M12 22h10.5v2.4H12zM12 44h10.5v2.4H12z"/><rect s x="24" y="11" width="12" height="41" rx="2.4" fill="[#fff,~]"/><path k=".1" d="M24 16h12v2.4H24zM24 45h12v2.4H24z"/><rect s transform="rotate(11 44 33)" x="39" y="16" width="10.5" height="36" rx="2.4" fill="[#b4eeff,#45b0ea]"/><path k=".12" transform="rotate(11 44 33)" d="M39 21h10.5v2.4H39zM39 45h10.5v2.4H39z"/><path fill="#e0276f" d="M30 25c-1.2-2.1-5.2-1.6-5.2 1.8 0 2.8 3.1 5 5.2 6.6 2.1-1.6 5.2-3.8 5.2-6.6 0-3.4-4-3.9-5.2-1.8z"/><rect s x="8.5" y="52" width="47" height="4.4" rx="2.2" fill="[#8a1a50,#4a0a28]"/>`, [0.92, 0, -2.05]],
  'aether-search': ['navy', `<path s ${L} stroke="[#ffd88a,#f0900f]" stroke-width="8" d="M41 41l11 11"/><circle s cx="27.5" cy="27.5" r="15.5" fill="[#dcf7ff,#78c9f2]" stroke="[#fff,~]" stroke-width="6"/><path h=".75" d="M18.6 26a9.5 9.5 0 0 1 8-8.4c1.3-.2 1.7 1.7.4 2a6.8 6.8 0 0 0-6 6.8c-.2 1.3-2.4 1-2.4-.4z"/>`, [0.94, -0.47, -0.87]],
  chat: ['green', `<path s fill="[#c8f9dc,#62d898]" d="M29 10h16a10 10 0 0 1 10 10v6c0 3.6-1.9 6.7-4.7 8.5v6.2c0 1-1.2 1.6-2 .9L41 36H29a10 10 0 0 1-10-10v-6a10 10 0 0 1 10-10z"/><path s fill="[#fff,~]" d="M19 22h20a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10H23l-8.6 6.4c-.8.6-2 0-2-1V49A10 10 0 0 1 9 40.4V32a10 10 0 0 1 10-10z"/><path ${L} stroke="#13a356" stroke-width="4.6" stroke-dasharray=".01 8.4" d="M20.6 36h17"/>`, [0.9, 0.09, -1.65]],
  aetherium: ['magenta', `<path s fill="[#fff,~]" d="M28 13c1.8 12.5 8.5 20 22 22-13.5 2-20.2 9-22 21.5C26.2 44 19.5 37 6 35c13.5-2 20.2-9.5 22-22z"/><path k=".1" d="M28 35h22c-13.5 2-20.2 9-22 21.5z"/><path k=".05" d="M28 35H6c13.5 2 20.2 9 22 21.5z"/><path h=".4" d="M28 13c1.8 12.5 8.5 20 22 22H28z"/><path s fill="[#fff4b8,#ffc23d]" d="M47 8c.8 5.4 3.4 8 8.8 8.8-5.4.8-8 3.4-8.8 8.8-.8-5.4-3.4-8-8.8-8.8 5.4-.8 8-3.4 8.8-8.8z"/>`, [1.01, 1.01, -0.7]],
  spotify: ['ink', '=brand-spotify', [1.06, 0, -0.4]],
  clock: ['ink', `<circle s cx="32" cy="32" r="22" fill="[#f5f7fa,#a9b2c2]"/><circle cx="32" cy="32" r="18.6" fill="[#fff,#e6eaf1]"/><circle cx="32" cy="32" r="15.6" fill="none" stroke="#8c97aa" stroke-width="2.6" stroke-dasharray="1.4 6.77" stroke-dashoffset=".7"/><path s ${L} stroke="#1b2130" stroke-width="4.2" d="M32 32l-8.6-5"/><path s ${L} stroke="#1b2130" stroke-width="3.4" d="M32 32l8.6-10.6"/><path ${L} stroke="#ff3b5c" stroke-width="1.8" d="M32 32l6 9"/><circle cx="32" cy="32" r="3" fill="#ff3b5c"/>`, [0.93, 0, -0.4]],
  lens: ['orange', `<path s ${L} stroke="[#fff,~]" stroke-width="5.4" d="M12 23v-5a6 6 0 0 1 6-6h5M41 12h5a6 6 0 0 1 6 6v5M52 41v5a6 6 0 0 1-6 6h-5M23 52h-5a6 6 0 0 1-6-6v-5"/><circle s cx="32" cy="32" r="10.5" fill="[#fff,~]"/><circle cx="32" cy="32" r="5.4" fill="[#ff9a3c,#c9400c]"/><circle cx="29.9" cy="29.9" r="1.8" fill="#fff" fill-opacity=".85"/>`, [1.03, 0, -0.4]],
  feedback: ['teal', `<path ${L} stroke="#fff" stroke-width="3.6" d="M49.5 25a10.5 10.5 0 0 1 0 14"/><path s fill="[#13958a,#0a5f58]" d="M19 39l3.2 12a3 3 0 0 0 5.8-1.5L25 38z"/><path s fill="[#fff,~]" d="M16 25l24.8-11a2.6 2.6 0 0 1 3.7 2.4v31.2a2.6 2.6 0 0 1-3.7 2.4L16 39z"/><path k=".08" d="M16 32h28.5v15.6a2.6 2.6 0 0 1-3.7 2.4L16 39z"/><rect s x="9" y="24" width="10" height="16" rx="4" fill="[#ffae75,#ef5a2a]"/>`, [1.05, 0.52, -1.97]],
  whatsnew: ['amber', `<g class="d" opacity=".3" transform="translate(.5 1.5)"><rect x="14" y="14" width="36" height="36" rx="5"/><rect transform="rotate(30 32 32)" x="14" y="14" width="36" height="36" rx="5"/><rect transform="rotate(60 32 32)" x="14" y="14" width="36" height="36" rx="5"/></g><g fill="#fff"><rect x="14" y="14" width="36" height="36" rx="5"/><rect transform="rotate(30 32 32)" x="14" y="14" width="36" height="36" rx="5"/><rect transform="rotate(60 32 32)" x="14" y="14" width="36" height="36" rx="5"/></g><circle s cx="32" cy="32" r="14.5" fill="[#ffb347,#ec5a1a]"/><path fill="#fff" d="M32 22c.9 6.4 3.6 9.1 10 10-6.4.9-9.1 3.6-10 10-.9-6.4-3.6-9.1-10-10 6.4-.9 9.1-3.6 10-10z"/>`, [0.9, 0, -0.4]],
  profile: ['violet', `<path s fill="[#fff,~]" d="M11 50.5C11 41 20 37 32 37s21 4 21 13.5a3.5 3.5 0 0 1-3.5 3.5h-35a3.5 3.5 0 0 1-3.5-3.5z"/><circle s cx="32" cy="23" r="11.5" fill="[#fff,~]"/>`, [1.04, 0, -1.23]],
  devroom: ['emerald', `<path ${L} stroke="#d2fbe8" stroke-width="3.2" d="M24 10v6M32 10v6M40 10v6M24 48v6M32 48v6M40 48v6M10 24h6M10 32h6M10 40h6M48 24h6M48 32h6M48 40h6"/><rect s x="16" y="16" width="32" height="32" rx="6" fill="[#2c4a41,#0a1814]"/><rect x="18.5" y="18.5" width="27" height="27" rx="4" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="1.2"/><rect s x="24" y="24" width="16" height="16" rx="3.6" fill="[#8affc8,#14bd77]"/>`, [0.93, 0, -0.4]],
  play: ['crimson', `<circle cx="32" cy="32" r="23" fill="[#6a0820,#420414]" fill-opacity=".9"/><path k=".2" d="M9 32a23 23 0 0 1 46 0 23 21 0 0 0-46 0z"/><circle cx="32" cy="32" r="23" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="2"/><path s fill="[#fff,~]" stroke="[#fff,~]" ${R(8)} d="M26 20.5l18 11.5-18 11.5z"/>`, [0.88, 0, -0.4]],
  arcade: ['purple', `<path s fill="[#4c38b0,#1a0f58]" d="M19 8h26a3 3 0 0 1 3 3v9l-2 12 5 6.4V53a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V38.4L18 32l-2-12v-9a3 3 0 0 1 3-3z"/><rect x="18.5" y="10.5" width="27" height="6.5" rx="2" fill="[#ffe873,#ffb21f]"/><rect x="20" y="19.5" width="24" height="13" rx="2.4" fill="[#4af2ff,#1a6fe8]"/><path fill="#fff" d="M27 22.5h2v2h6v-2h2v2h2v5H25v-5h2z"/><path h=".16" d="M18 32h28l5 6.4H13z"/><path ${L} stroke="#fff" stroke-width="2.4" d="M23 45v-6"/><circle cx="23" cy="38" r="3.4" fill="#ff456d"/><circle cx="35.5" cy="44" r="2.9" fill="#ffe36b"/><circle cx="43.5" cy="44" r="2.9" fill="#3ff0ff"/>`, [0.93, 0, -0.4],
    `<path s fill="[#4c38b0,#1a0f58]" d="M19 8h26a3 3 0 0 1 3 3v42a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z"/><rect x="19.5" y="11" width="25" height="7" rx="2" fill="#ffd23f"/><rect x="19.5" y="21" width="25" height="15" rx="2.4" fill="[#4af2ff,#1a6fe8]"/><circle cx="25" cy="45" r="3.8" fill="#ff456d"/><circle cx="39" cy="45" r="3.8" fill="#ffe36b"/>`, [0.98, 0, -0.4]],
  multiplayer: ['sky', `<path s fill="[#fff4c8,#ffb52e]" d="M12 49c0-11 4.6-17 11-20 6.4 3 11 9 11 20a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3z"/><circle s cx="23" cy="20" r="8.5" fill="[#fff4c8,#ffbf3d]"/><path s fill="[#fff,~]" d="M30 53c0-11 4.6-17 11-20 6.4 3 11 9 11 20a3 3 0 0 1-3 3H33a3 3 0 0 1-3-3z"/><circle s cx="41" cy="24" r="8.5" fill="[#fff,~]"/>`, [1, 0, -2.2]],
  party: ['orange', `<path s fill="[#fff,~]" d="M33 13L12.8 49c-1 1.9.8 4 2.8 3.4l33.6-10c2-.6 2.5-3.2.9-4.5z"/><path fill="[#9a6bff,#5a2ee0]" d="M26.7 24.3l14.7 11.8-6.2 1.9-11.6-9.4zM19.8 36.5l9.3 7.6-6.4 1.9-5.7-4.7z"/><circle s cx="33" cy="12" r="4.8" fill="[#fff4a8,#ffbf1f]"/><path ${L} stroke="#6ff2ff" stroke-width="3.6" d="M45 12.5l3.4 3.4M51 31h3.6"/><path ${L} stroke="#fff" stroke-width="3.8" d="M42 23.5v.01M53 21.5v.01"/>`, [1.04, -2.6, 1.89]],
  forge: ['coral', `<path s fill="[#5d6778,#1d222c]" d="M10 22h31c.6 5.6 6 9 13 9.6v1.6c-6 2.8-11 4-14.6 4.1L41.6 47H45a3 3 0 0 1 3 3v4a1 1 0 0 1-1 1H17a1 1 0 0 1-1-1v-4a3 3 0 0 1 3-3h3.4l2-10C16 36 11.8 30 10 22z"/><path fill="[#ffe08a,#ff9a2e]" d="M10 22h31l.3 3H10.7z"/><path s fill="[#fff6b8,#ffcf3d]" d="M47 7c.8 5 3 7.2 8 8-5 .8-7.2 3-8 8-.8-5-3-7.2-8-8 5-.8 7.2-3 8-8z"/><path ${L} stroke="#ffe27a" stroke-width="3.2" d="M33 14v.01M27 9v.01"/>`, [0.99, -0.4, 0.49]],
  studio: ['indigo', `<ellipse k=".22" cx="32" cy="55" rx="17" ry="3"/><path fill="[#fff,~]" stroke="[#fff,~]" ${R(2)} d="M32 10l19 10.8-19 11-19-11z"/><path fill="[#9fe2ff,#3fa6f0]" stroke="[#9fe2ff,#3fa6f0]" ${R(2)} d="M12.5 24l17.7 10.3v20.2L12.5 44.2z"/><path fill="[#3f86ec,#1a4fc0]" stroke="[#3f86ec,#1a4fc0]" ${R(2)} d="M51.5 24L33.8 34.3v20.2l17.7-10.3z"/><path class="d" ${L} stroke="#fff" stroke-opacity=".7" stroke-width="1.2" d="M13.6 24.6l16.6 9.7M50.4 24.6l-16.6 9.7"/>`, [0.95, 0, -0.69]],
  assetlab: ['pink', `<path s fill="[#fff,~]" d="M25 9h14a2 2 0 0 1 0 4h-1v13.4l12.4 20.4c1.9 3.2-.4 7.2-4 7.2H17.6c-3.6 0-5.9-4-4-7.2L26 26.4V13h-1a2 2 0 0 1 0-4z"/><path fill="[#6ff3e0,#11a8b8]" d="M21.6 36h20.8l7 11.4c.9 1.6-.2 3.6-2 3.6H16.6c-1.8 0-2.9-2-2-3.6z"/><path h=".5" d="M21.6 36h20.8l1 1.6H20.6z"/><path fill="#fff" d="M25 41h4v4h-4zM33 38.5h4v4h-4zM37 44h4v4h-4z"/><path fill="#ff456d" d="M30 28h4v4h-4zM33 20h3v3h-3z"/>`, [1.05, 0, 0.13]],
  creator: ['navy', `<path s fill="[#3fd8c4,#0c8f8a]" d="M32 31l22 11.5L32 54 10 42.5z"/><path fill="#066461" d="M10 42.5v3.2L32 57.2l22-11.5v-3.2L32 54z"/><path s fill="[#c8f57a,#62b82c]" d="M32 21.5L54 33 32 44.5 10 33z"/><path fill="#3f8a1c" d="M10 33v3.2l22 11.5 22-11.5V33L32 44.5z"/><path s fill="[#fff,~]" d="M32 11l22 12-22 12-22-12z"/><path fill="#b9c6e0" d="M10 23v3.2l22 12 22-12V23L32 35z"/>`, [0.93, 0, -2.35]],
  jam: ['red', `<path s fill="[#fff07a,#ff9a2a]" d="M34 7c1.6 9.6 15 15.6 15 31a17 17 0 0 1-34 0c0-7.6 4-12.6 7.4-16.4 1 3.6 2.4 6 5 7C28.4 21 28.6 13 34 7z"/><path fill="[#fffbd8,#ffcf4a]" d="M32.6 30.6c1 5.4 7.6 8 7.6 14.4a8.2 8.2 0 0 1-16.4 0c0-5.6 6.6-8.8 8.8-14.4z"/>`, [1.04, 0, 0.64]],
  controller: ['violet', `<path s fill="[#5a6078,#1e2132]" d="M19 19h26c6.4 0 10 4.2 11.6 11l3 13c1.3 5.8-5.6 9.4-9.8 5.2L43 41H21l-6.8 7.2C10 52.4 3.1 48.8 4.4 43l3-13C9 23.2 12.6 19 19 19z"/><circle s cx="21" cy="29" r="5.6" fill="[#eef0f7,#9aa2bd]"/><circle s cx="38.5" cy="35" r="4.6" fill="[#eef0f7,#9aa2bd]"/><circle cx="44" cy="25.5" r="2.7" fill="#ff5a7a"/><circle cx="49.6" cy="30.5" r="2.7" fill="#3aa8ff"/>`, [0.9, 0, -2.65]],
  paint: ['pink', `<path s fill="[#fff,~]" d="M47.4 8.2c2.6-2.4 7.6 1.8 5.4 4.8L36.2 35.8 28.2 27.8z"/><path fill="[#eef1f6,#9aa3b3]" d="M29.4 29l5.6 5.6-2.4 2.4-5.6-5.6z"/><path s fill="[#8fe9ff,#2384ec]" d="M27 31.4l5.6 5.6c-.6 7.4-7.6 13-20 12.6 4-3 3.6-7.6 5.6-11.6 1.6-3.2 5-6 8.8-6.6z"/><circle s cx="43" cy="47" r="3.8" fill="[#ffe873,#ffb21f]"/><circle s cx="51" cy="39.5" r="2.6" fill="[#fff,~]"/>`, [1.15, -1.26, 2.7]],
  piano: ['purple', `<rect s x="9" y="13" width="46" height="38" rx="6" fill="[#fff,~]"/><path ${L} stroke="#c2b6dc" stroke-width="1.8" d="M20.5 14v36M32 14v36M43.5 14v36"/><path k=".07" d="M9 45h46a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6z"/><path fill="[#3d3366,#0f0a24]" d="M16.6 13h7.8v21a2 2 0 0 1-2 2h-3.8a2 2 0 0 1-2-2zM28.1 13h7.8v21a2 2 0 0 1-2 2h-3.8a2 2 0 0 1-2-2zM39.6 13h7.8v21a2 2 0 0 1-2 2h-3.8a2 2 0 0 1-2-2z"/><path h=".2" d="M18 13h1.6v20H18zM29.5 13h1.6v20h-1.6zM41 13h1.6v20H41z"/>`, [0.93, 0, -0.4]],
  beats: ['orange', `<path s fill="[#6a36c6,#2a1060]" d="M11 28v15c0 6.4 9.4 11 21 11s21-4.6 21-11V28z"/><path ${L} stroke="#ffd84d" stroke-width="2.6" d="M11.5 33l8 15.5 8.3-13 8.4 14.5 8.1-14.5 8.2-3"/><ellipse s cx="32" cy="28" rx="21" ry="9.5" fill="[#fff,~]"/><ellipse cx="32" cy="28" rx="16.5" ry="6.6" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="1.4"/><path s ${L} stroke="[#ffeccd,#e8b47a]" stroke-width="4" d="M12 8l18 16M52 8L34 24"/>`, [0.91, 0, 1.43]],
  graph: ['indigo', `<rect s x="10" y="10" width="44" height="44" rx="8" fill="[#fff,~]"/><path fill="none" stroke="#d3d9f0" stroke-width="1.8" d="M10 26h44M10 40h44M28 10v44M42 10v44"/><path ${L} stroke="#3a4462" stroke-width="3" d="M17 16v31h31"/><path s ${L} stroke="[#ff6f96,#e0245a]" stroke-width="4.2" d="M18 44c8 0 9-24 17-24s7 15 13 9"/>`, [0.88, 0, -0.4],
    `<rect s x="10" y="10" width="44" height="44" rx="9" fill="[#fff,~]"/><path ${L} stroke="#3a4462" stroke-width="3.6" d="M17 16v31h31"/><path ${L} stroke="#e0245a" stroke-width="5.2" d="M19 43c8 0 8-22 16-22s7 14 12 8"/>`, [0.88, 0, -0.4]],
  convert: ['teal', `<path s fill="[#fff,~]" stroke="[#fff,~]" ${R(3)} d="M13 16h24V9l15 10.5L37 30v-7H13z"/><path s fill="[#c8fbf2,#76dccf]" stroke="[#c8fbf2,#76dccf]" ${R(3)} d="M51 41H27v-7L12 44.5 27 55v-7h24z"/>`, [1, 0, -0.4]],
  palette: ['violet', `<path s fill="[#fff6e4,#ebc58e]" d="M32 9.5C18.7 9.5 8.5 19.5 8.5 32S18.7 54.5 30 54.5c4.2 0 5.6-2.8 5.6-5.2 0-3.3 2.3-5.8 5.6-5.8H46c6 0 10-4.8 10-11 0-13-11-23-24-23z"/><ellipse cx="44" cy="35" rx="4" ry="3.2" fill="[#9a6b3a,#e2bb84]"/><circle s cx="21" cy="24" r="4.6" fill="[#ff7a94,#e0264f]"/><circle s cx="33" cy="18.6" r="4.6" fill="[#ffe066,#f5a50f]"/><circle s cx="45" cy="25" r="4.6" fill="[#5ff0a8,#14b86a]"/><circle s cx="18.6" cy="37" r="4.6" fill="[#7fb6ff,#2a64e8]"/>`, [0.9, -0.27, -0.4]],
  tasks: ['green', `<rect s x="11" y="11" width="42" height="42" rx="12" fill="[#fff,~]"/><path s ${L} stroke="[#2fd07a,#0e9355]" stroke-width="7" d="M21 33l8.4 8.4L44 24.6"/>`, [0.93, 0, -0.4]],
  pumpkin: ['night', `<path s fill="[#7cc04a,#3d7a22]" d="M29 18c0-4.4 1.6-8 5.4-10l3.2 3.4c-2.2 1.2-3.2 3.6-3.2 6.6z"/><ellipse s cx="18.6" cy="36" rx="10.6" ry="16" fill="[#f79a2a,#c4420c]"/><ellipse s cx="45.4" cy="36" rx="10.6" ry="16" fill="[#f79a2a,#c4420c]"/><ellipse cx="25" cy="36" rx="9.4" ry="18" fill="[#ffae3c,#dd5410]"/><ellipse cx="39" cy="36" rx="9.4" ry="18" fill="[#ffae3c,#dd5410]"/><ellipse s cx="32" cy="36" rx="8" ry="18.6" fill="[#ffc054,#e8640f]"/><path fill="[#fff6b8,#ffc83d]" d="M19 29l7 5.6h-8.4zM45 29l-7 5.6h8.4zM17.6 40.6c3 1.4 5.6 1.2 7 .4l2 2.4 2.6-2.2 2.8 2.2 2.8-2.2 2.6 2.2 2-2.4c1.4.8 4 1 7-.4-1 6-7 10-14.2 10s-13.6-4-14.6-10z"/>`, [0.89, 0, 0.14]],
  social: ['violet', `<path s fill="[#fff,~]" d="M32 10c13 0 23 8.6 23 20s-10 20-23 20c-2.6 0-5-.3-7.3-1L14 54c-1.6.6-3-1-2.2-2.4l3.6-7.2C11.4 41 9 36 9 30c0-11.4 10-20 23-20z"/><circle cx="24" cy="27" r="3.2" fill="#4c1d95"/><circle cx="40" cy="27" r="3.2" fill="#4c1d95"/><path ${L} stroke="#4c1d95" stroke-width="3.6" d="M23 35c3 5 15 5 18 0"/><circle s cx="50" cy="14" r="5.8" fill="[#5ff0a8,#14b86a]" stroke="#fff" stroke-width="2.4"/>`, [0.87, -0.79, 0.82]],
  discover: ['cyan', `<circle s cx="32" cy="32" r="22" fill="[#f6f8fc,#a9b6cc]"/><circle cx="32" cy="32" r="18.6" fill="[#fff,#e5ebf4]"/><circle cx="32" cy="32" r="15.8" fill="none" stroke="#9aa8c4" stroke-width="2.2" stroke-dasharray="1.4 11" stroke-dashoffset=".7"/><g class="d" opacity=".25" transform="translate(.5 1.5) rotate(38 32 32)"><path d="M32 12.5L39 32 32 51.5 25 32z"/></g><g transform="rotate(38 32 32)"><path fill="[#ff6f8f,#e0245a]" d="M32 12.5L39 32H25z"/><path fill="[#4a5578,#202842]" d="M32 51.5L25 32h14z"/><path k=".14" d="M32 12.5L39 32H32zM32 51.5L39 32H32z"/></g><circle cx="32" cy="32" r="3" fill="#fff"/>`, [0.93, 0, -0.4]],
  watch: ['coral', `<path ${L} stroke="#fff" stroke-width="3.2" d="M23 7l9 10 9-10"/><rect s x="8" y="17" width="48" height="36" rx="8" fill="[#3d2860,#140b26]"/><rect x="12.5" y="21.5" width="39" height="27" rx="4.6" fill="[#7fd0ff,#4a52e8]"/><path h=".14" d="M17.1 21.5H38L12.5 41V26.1a4.6 4.6 0 0 1 4.6-4.6z"/><path s m fill="#fff" stroke="#fff" ${R(2.4)} d="M27.5 28.5l11 6.5-11 6.5z"/>`, [0.86, 0, 2.09]],
  radio: ['magenta', `<path s ${L} stroke="[#fff,~]" stroke-width="3" d="M17 23L45 9"/><rect s x="8" y="22" width="48" height="31" rx="7" fill="[#fff,~]"/><circle cx="22.5" cy="37.5" r="10" fill="[#4a376e,#170d2b]"/><circle cx="22.5" cy="37.5" r="6.6" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1.6"/><circle cx="22.5" cy="37.5" r="3.6" fill="#ffb36b"/><rect x="36.5" y="28" width="14" height="7" rx="2.2" fill="[#ffd38f,#ff9340]"/><path ${L} stroke="#7a3a10" stroke-opacity=".45" stroke-width="1.4" d="M40 30v3M43.5 30v3M47 30v3"/><circle s cx="39.6" cy="43.5" r="3.2" fill="[#9a4fb0,#5a1f73]"/><circle s cx="47.6" cy="43.5" r="3.2" fill="[#9a4fb0,#5a1f73]"/>`, [0.9, 0, 1.13]],
  downloads: ['cyan', `<path s fill="[#fff,~]" stroke="[#fff,~]" ${R(3)} d="M27.5 10h9v17H46L32 42.5 18 27h9.5z"/><path s fill="[#d4fbf6,#80e2dc]" d="M10 41a3 3 0 0 1 6 0v6h32v-6a3 3 0 0 1 6 0v8a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z"/>`, [1.01, 0, -0.2]],
  board: ['teal', `<rect s x="9" y="11" width="46" height="42" rx="7" fill="[#f8faff,#d7dff2]"/><rect s x="14" y="17" width="10.5" height="9" rx="2.2" fill="[#ff9ab0,#f0557a]"/><rect s x="14" y="28.5" width="10.5" height="9" rx="2.2" fill="[#ffd76b,#f5a50f]"/><rect s x="26.75" y="17" width="10.5" height="14" rx="2.2" fill="[#5fe8b8,#18a878]"/><rect s x="26.75" y="33.5" width="10.5" height="9" rx="2.2" fill="[#ff9ab0,#f0557a]"/><rect s x="39.5" y="17" width="10.5" height="9" rx="2.2" fill="[#a3adff,#5a63ec]"/>`, [0.88, 0, -0.4],
    `<rect s x="9" y="10" width="46" height="44" rx="8" fill="[#f8faff,#d7dff2]"/><rect x="14" y="16" width="11" height="22" rx="2.6" fill="#f0557a"/><rect x="26.5" y="16" width="11" height="30" rx="2.6" fill="#18a878"/><rect x="39" y="16" width="11" height="14" rx="2.6" fill="#5a63ec"/>`, [0.86, 0, -0.4]],
  clipboard: ['amber', `<rect s x="12" y="13" width="40" height="42" rx="6" fill="[#7a4a1f,#3c2009]"/><rect x="16.5" y="18" width="31" height="33" rx="2.6" fill="[#fff,#f0eadd]"/><path ${L} stroke="#bfb5a0" stroke-width="3" d="M22 30h20M22 37h20M22 44h13"/><path s fill="[#f4f6fa,#a6afbe]" d="M23 14a3 3 0 0 1 3-3h1.8a4.4 4.4 0 0 1 8.4 0H38a3 3 0 0 1 3 3v6a1.4 1.4 0 0 1-1.4 1.4H24.4A1.4 1.4 0 0 1 23 20z"/><circle cx="32" cy="11.6" r="1.4" fill="#6a7385"/>`, [0.91, 0, 0.14]],
  automations: ['night', `<path ${L} stroke="#ffd84a" stroke-opacity=".55" stroke-width="4.4" d="M13.6 21A22 22 0 0 1 47 15.6M50.4 43A22 22 0 0 1 17 48.4"/><path fill="#ffd84a" fill-opacity=".55" d="M50 18.3l-6.8-1.6 4.6-5zM14 45.7l6.8 1.6-4.6 5z"/><path s fill="[#fff3a0,#ffb21f]" stroke="[#fff3a0,#ffb21f]" ${R(2.6)} d="M36 10L17 35h12l-3 19 20-26H33.6z"/>`, [1.04, 0, -0.4]],
  qr: ['lime', `<rect s x="10" y="10" width="44" height="44" rx="8" fill="[#fff,~]"/><g fill="none" stroke="#14321f" stroke-width="3.2"><rect x="17" y="17" width="9.5" height="9.5" rx="2.4"/><rect x="37.5" y="17" width="9.5" height="9.5" rx="2.4"/><rect x="17" y="37.5" width="9.5" height="9.5" rx="2.4"/></g><path fill="#14321f" d="M20.4 20.4h2.7v2.7h-2.7zM40.9 20.4h2.7v2.7h-2.7zM20.4 40.9h2.7v2.7h-2.7zM33 33h4v4h-4zM38 38h5v5h-5zM33 43h4v4h-4zM43 33h4v4h-4zM29.5 18h4v4h-4zM18 29.5h4v4h-4z"/>`, [0.88, 0, -0.4],
    `<rect s x="10" y="10" width="44" height="44" rx="9" fill="[#fff,~]"/><g fill="none" stroke="#14321f" stroke-width="4"><rect x="17" y="17" width="11" height="11" rx="2.6"/><rect x="36" y="17" width="11" height="11" rx="2.6"/><rect x="17" y="36" width="11" height="11" rx="2.6"/></g><rect x="37" y="37" width="9" height="9" rx="2" fill="#2a9a4e"/>`, [0.88, 0, -0.4]],
  recorder: ['red', `<path s ${L} stroke="[#fff,~]" stroke-width="4.4" d="M15 30a17 17 0 0 0 34 0M32 47v7M23 55h18"/><rect s x="22.5" y="8.5" width="19" height="32" rx="9.5" fill="[#fff,#c9d0dc]"/><path ${L} stroke="#7f8899" stroke-width="2.2" d="M27 18h10M27 23.5h10M27 29h10"/>`, [1.02, 0, -1.32]],
  shared: ['coral', `<g transform="rotate(-45 32 32)"><rect s x="9" y="23.5" width="27" height="17" rx="8.5" fill="none" stroke="[#ffe8c9,#ffc58a]" stroke-width="6.4"/><rect s x="28" y="23.5" width="27" height="17" rx="8.5" fill="none" stroke="[#fff,~]" stroke-width="6.4"/><path fill="none" stroke="#ffd2a2" stroke-width="6.4" d="M35.5 34.9A8.5 8.5 0 0 1 29.7 40.2"/></g>`, [1.05, 0, -0.4]],
  devtools: ['indigo', `<path ${L} stroke="#e4e8ff" stroke-width="3.2" d="M19 27l-8-5M17 37H8M19 47l-8 5M45 27l8-5M47 37h9M45 47l8 5M27 13l-4-5M37 13l4-5"/><circle s cx="32" cy="19" r="7" fill="[#2a5a48,#0d2a20]"/><path s fill="[#b0ffd6,#22b87e]" d="M32 22c9.4 0 15.6 6 15.6 16S41 56 32 56s-15.6-8-15.6-18S22.6 22 32 22z"/><path ${L} stroke="#0d7a57" stroke-width="2.6" d="M32 25v31"/><circle cx="25" cy="35" r="2.6" fill="#0d7a57"/><circle cx="39" cy="35" r="2.6" fill="#0d7a57"/><circle cx="25.5" cy="45" r="2.2" fill="#0d7a57"/><circle cx="38.5" cy="45" r="2.2" fill="#0d7a57"/>`, [0.89, 0, -0.31]],
  markup: ['rose', `<rect s transform="rotate(-5 30 34)" x="10" y="17" width="38" height="35" rx="5" fill="[#fff,~]"/><path ${L} stroke="#e8305f" stroke-width="3.8" d="M16 44c4-6 7-6 10-2s6 3 9-2"/><path s fill="[#ffe873,#ffb01f]" d="M46 8.6a3 3 0 0 1 4.2 0l5.2 5.2a3 3 0 0 1 0 4.2L34 39.4l-10.6 1.2 1.2-10.6z"/><path fill="[#ff9db8,#e8487a]" d="M46 8.6a3 3 0 0 1 4.2 0l5.2 5.2a3 3 0 0 1 0 4.2l-2.8 2.6-9.4-9.4z"/><path fill="#f6d9b2" d="M24.6 30l9.4 9.4-10.6 1.2z"/><path fill="#39405a" d="M23.8 36.9l3.3 3.3-3.7.4z"/>`, [0.91, -0.55, 0.97]],
  sheets: ['green', `<rect s x="11" y="12" width="42" height="40" rx="6" fill="[#fff,~]"/><rect x="14.5" y="15.5" width="35" height="8" rx="2.4" fill="[#22b06c,#0d8048]"/><rect x="14.5" y="26" width="10" height="22.5" rx="1.6" fill="#1fa866" fill-opacity=".16"/><path fill="none" stroke="#9fd4b6" stroke-width="2.2" d="M14.5 33.5h35M14.5 41h35M24.5 26v22.5M37 26v22.5"/>`, [0.94, 0, -0.4]],
  study: ['amber', `<path s fill="[#2d3456,#11142a]" d="M16 33v12c0 4.4 7.4 8.6 16 8.6S48 49.4 48 45V33l-16 7z"/><path s fill="[#4c5482,#1d2140]" d="M32 12l28 12.6a1 1 0 0 1 0 1.8L32 39 4 26.4a1 1 0 0 1 0-1.8z"/><path ${L} stroke="[#ffe68a,#ffb21f]" stroke-width="2.8" d="M32 25.5L52 30v13"/><path s fill="[#ffe68a,#ffb21f]" d="M49 43h6l1.4 7h-8.8z"/><circle cx="32" cy="25.5" r="2.6" fill="#ffd34d"/>`, [0.87, 0, -1.18]],
  drop: ['violet', `<path class="d" fill="#000" fill-opacity=".24" transform="translate(.5 1.8)" d="M9 30.5L55 9.5 42 54.5 27 37z"/><path fill="[#fff,~]" d="M9 30.5L55 9.5 27 37z"/><path fill="[#dcd6ff,#a99af2]" d="M55 9.5L42 54.5 27 37z"/><path fill="#7a68d4" d="M27 37v15l7.4-8.2z"/><path class="d" ${L} stroke="#fff" stroke-opacity=".8" stroke-width="1.1" d="M10.5 30L54 10.2"/>`, [1.03, 0, -0.4]],
  'watch-together': ['coral', `<rect s x="9" y="8.5" width="46" height="28" rx="5.6" fill="[#3a1d50,#140a1f]"/><rect x="12.5" y="12" width="39" height="21" rx="3" fill="[#ff9a7e,#d02a80]"/><path fill="#fff" stroke="#fff" ${R(2)} d="M28 17l9 5.5-9 5.5z"/><path s fill="[#fff2e4,#ffb98c]" d="M9 57c0-7.2 5.4-10.6 12.5-10.6S34 49.8 34 57z"/><circle s cx="21.5" cy="39" r="6.6" fill="[#fff2e4,#ffc89c]"/><path s fill="[#fff,~]" d="M30 57c0-7.2 5.4-10.6 12.5-10.6S55 49.8 55 57z"/><circle s cx="42.5" cy="39" r="6.6" fill="[#fff,~]"/>`, [0.85, 0, -1.08],
    `<rect s x="8" y="8" width="48" height="30" rx="6" fill="[#3a1d50,#140a1f]"/><path fill="#fff" stroke="#fff" ${R(2.4)} d="M27.5 15l11 8-11 8z"/><circle s cx="21" cy="48" r="8" fill="[#fff2e4,#ffb98c]"/><circle s cx="43" cy="48" r="8" fill="[#fff,~]"/>`, [0.85, 0, -0.4]],
  'flex-battle': ['rose', `<path s fill="[#3a1d50,#140a1f]" d="M9 14h46a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z"/><path s fill="[#fff,~]" d="M32 20l10 8-10 14-10-14z"/><path fill="#fff" fill-opacity=".55" d="M22 28h20l-10-8z"/><path ${L} stroke="#fff" stroke-width="2.6" d="M14 24v-3h4M50 24v-3h-4"/><circle s cx="16" cy="52" r="5.6" fill="[#fff2e4,#ffc89c]"/><circle s cx="48" cy="52" r="5.6" fill="[#fff,~]"/><path fill="#fff" d="M30.8 48.5h2.4v7h-2.4z"/>`, null],
  mindmap: ['indigo', `<path ${L} stroke="#eef2ff" stroke-opacity=".9" stroke-width="3.4" d="M32 32L15 16M32 32l18-15M32 32L14 48M32 32l19 15"/><circle s cx="14.5" cy="15.5" r="6.5" fill="[#ffe066,#f5a50f]"/><circle s cx="50.5" cy="16.5" r="6.5" fill="[#ff9db6,#e0306a]"/><circle s cx="13.5" cy="48.5" r="6.5" fill="[#6ff2d0,#12b28a]"/><circle s cx="51.5" cy="47.5" r="6.5" fill="[#8fe0ff,#2a8ff0]"/><circle s cx="32" cy="32" r="11" fill="[#fff,~]"/>`, [0.96, -0.48, -0.4]],
  periodic: ['teal', `<ellipse s cx="32" cy="32" rx="24.5" ry="9.6" transform="rotate(30 32 32)" fill="none" stroke="#fff" stroke-width="3.8"/><ellipse s cx="32" cy="32" rx="24.5" ry="9.6" transform="rotate(90 32 32)" fill="none" stroke="#fff" stroke-width="3.8"/><ellipse s cx="32" cy="32" rx="24.5" ry="9.6" transform="rotate(150 32 32)" fill="none" stroke="#fff" stroke-width="3.8"/><circle s cx="32" cy="32" r="7" fill="[#ffe88a,#ff9d2e]"/><circle s cx="53.2" cy="44.3" r="3" fill="[#ffe88a,#ff9d2e]"/><circle s cx="32" cy="7.5" r="3" fill="[#ffe88a,#ff9d2e]"/><circle s cx="10.8" cy="44.3" r="3" fill="[#ffe88a,#ff9d2e]"/>`, [0.89, 0, 0.04]],
  typing: ['slate', `<rect s x="5.5" y="18" width="53" height="29" rx="6.4" fill="[#fff,~]"/><path fill="none" stroke="[#4a5470,#2a3044]" stroke-width="5" stroke-dasharray="4.6 2" d="M9.9 25.8h44.2M9.9 33.3h44.2"/><rect x="19" y="38.4" width="26" height="4.8" rx="1.6" fill="[#ffb35c,#f2700f]"/>`, [0.94, 0, -0.87],
    `<rect s x="6" y="17" width="52" height="30" rx="7" fill="[#fff,~]"/><path fill="none" stroke="#3a4258" stroke-width="6" stroke-dasharray="6.4 3.2" d="M11.5 27h41"/><rect x="19" y="35.5" width="26" height="6" rx="2" fill="#f2700f"/>`, [0.96, 0, -0.4]],
  picturetools: ['navy', `<rect s x="10" y="10" width="44" height="44" rx="8" fill="[#fff,~]"/><rect x="14" y="14" width="17" height="36" rx="3.6" fill="[#ffd76b,#ff6f59]"/><rect x="33.5" y="14" width="16.5" height="17" rx="3.6" fill="[#7ff5d4,#14b49c]"/><rect x="33.5" y="33" width="16.5" height="17" rx="3.6" fill="[#ffa2ca,#d6348c]"/><circle cx="22.5" cy="23" r="4" fill="#fff6c2"/><path fill="#b3321f" d="M14 44l8-9 9 10v1.4a3.6 3.6 0 0 1-3.6 3.6H17.6a3.6 3.6 0 0 1-3.6-3.6z"/><path s fill="#fff" d="M41.75 35.5l1.8 4.6 4.6 1.8-4.6 1.8-1.8 4.6-1.8-4.6-4.6-1.8 4.6-1.8z"/>`, [0.88, 0, -0.4],
    `<rect s x="10" y="10" width="44" height="44" rx="9" fill="[#fff,~]"/><rect x="15" y="15" width="16" height="34" rx="3.6" fill="#ff8a5c"/><rect x="34" y="15" width="15" height="15.5" rx="3.6" fill="#22c4a6"/><rect x="34" y="33.5" width="15" height="15.5" rx="3.6" fill="#e0489a"/>`, [0.88, 0, -0.4]],
  soundboard: ['night', `<rect s x="10.5" y="10.5" width="20" height="20" rx="5.6" fill="[#ff94a6,#e8264f]"/><rect s x="33.5" y="10.5" width="20" height="20" rx="5.6" fill="[#ffe887,#f5a80f]"/><rect s x="10.5" y="33.5" width="20" height="20" rx="5.6" fill="[#7ff5dc,#10a98f]"/><rect s x="33.5" y="33.5" width="20" height="20" rx="5.6" fill="[#9ccdff,#2a64e8]"/><circle cx="20.5" cy="20.5" r="5.4" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.2"/>`, [0.94, 0, -0.4]],
  'dev-tools': ['teal', `<g transform="rotate(45 32 32)"><rect x="30" y="24" width="4" height="30" rx="1" fill="[#f2f4f8,#9aa3b3]"/><rect s x="27" y="7" width="10" height="20" rx="4" fill="[#ffc062,#f0701a]"/><path k=".15" d="M27 17h10v2H27z"/></g><path s transform="rotate(-45 32 32)" fill="[#fff,~]" d="M26 7.5V16l6 3.4 6-3.4V7.5c4.6 1.8 7.6 6 7.6 11 0 5.2-3.2 9.6-7.6 11.4v22a6 6 0 0 1-12 0v-22c-4.4-1.8-7.6-6.2-7.6-11.4 0-5 3-9.2 7.6-11z"/>`, [1.04, 1.25, 0.85]],
  geometry: ['magenta', `<path ${L} stroke="#fff3b0" stroke-width="4.4" d="M11.5 45.5a28 28 0 0 0 41 0"/><path s ${L} stroke="[#fff,~]" stroke-width="7" d="M30.4 18L18.5 53"/><path s ${L} stroke="[#fff,~]" stroke-width="7" d="M33.6 18L45.5 53"/><path ${L} stroke="#ffd34d" stroke-width="3" d="M25 36h14"/><circle s cx="32" cy="14" r="6.4" fill="[#ffe36b,#ffa61f]"/><circle cx="32" cy="14" r="2.2" fill="#7a3a0c"/>`, [1.01, 0, -0.5]],
  physics: ['sky', `<path ${L} stroke="#eaf2ff" stroke-width="2.4" d="M34 14v19M47.2 14v19M20.8 14l-8.2 17.4"/><rect s x="8" y="9" width="48" height="6.4" rx="3.2" fill="[#fff,~]"/><circle s cx="34" cy="38" r="6.6" fill="[#fff,~]"/><circle s cx="47.2" cy="38" r="6.6" fill="[#fff,~]"/><circle s cx="10.8" cy="35.6" r="6.6" fill="[#ffe36b,#ff9d2e]"/><circle h=".7" cx="31.6" cy="35.6" r="1.8"/><circle h=".7" cx="44.8" cy="35.6" r="1.8"/><circle h=".7" cx="8.4" cy="33.2" r="1.8"/>`, [0.96, 1.92, 4.5]],
  drills: ['emerald', `<circle s cx="30" cy="34" r="21" fill="[#fff,~]"/><circle cx="30" cy="34" r="14.6" fill="[#ff6f8b,#d61f4f]"/><circle cx="30" cy="34" r="8.6" fill="[#fff,#f0f2f6]"/><circle cx="30" cy="34" r="3.8" fill="[#ff6f8b,#d61f4f]"/><path s ${L} stroke="#1c2537" stroke-width="3.4" d="M30 34L50 14"/><path fill="[#ffe36b,#ffa61f]" d="M48.6 10.6L53 6.4l.6 4.2 4.2.6-4.4 4.2-4.6-.4z"/>`, [0.89, -1.24, 0.84]],
  life: ['pink', `<path s fill="[#fff,~]" d="M32 54C18 44 9 36 9 25c0-7 5.5-13 12.5-13 4.5 0 8.2 2.2 10.5 6 2.3-3.8 6-6 10.5-6C49.5 12 55 18 55 25c0 11-9 19-23 29z"/><ellipse h=".7" cx="18.5" cy="21" rx="4" ry="2.4" transform="rotate(-35 18.5 21)"/><path ${L} stroke="#e0356f" stroke-width="3.8" d="M15 30h9l3.5-8 6.5 15 4-7h11"/>`, [0.95, 0, -1.35]],
  contacts: ['orange', `<rect s x="13" y="9.5" width="36" height="45" rx="5" fill="[#fff,~]"/><path fill="[#d94a2e,#8f2a14]" d="M13 14.5a5 5 0 0 1 5-5h4v45h-4a5 5 0 0 1-5-5z"/><path s fill="[#ff8a5c,#d6452f]" d="M26 45c0-6.6 4-10 10-10s10 3.4 10 10z"/><circle s cx="36" cy="26" r="6.4" fill="[#ff8a5c,#d6452f]"/><path ${L} stroke="#2fc79a" stroke-width="3.8" d="M51.5 16v6"/><path ${L} stroke="#ffc22e" stroke-width="3.8" d="M51.5 28v6"/><path ${L} stroke="#7c8cff" stroke-width="3.8" d="M51.5 40v6"/>`, [0.92, -1.19, -0.4]],
  synth: ['violet', `<rect s x="6.5" y="15" width="51" height="34" rx="6.4" fill="[#3a336a,#120e2c]"/><circle s cx="15" cy="23" r="3.8" fill="[#8ffff0,#2fd6c0]"/><circle s cx="26" cy="23" r="3.8" fill="[#ff9ae0,#e83fb0]"/><path ${L} stroke="#fff" stroke-opacity=".8" stroke-width="2.6" d="M37 20.4v5.2M43 20.4v5.2M49 20.4v5.2"/><rect x="11" y="31" width="42" height="14" rx="2.6" fill="[#fff,#dcd8f2]"/><path fill="[#2e2756,#120e2c]" d="M16.5 31h4v8h-4zM24.5 31h4v8h-4zM35.5 31h4v8h-4zM43.5 31h4v8h-4z"/>`, [0.93, 0, -0.4],
    `<rect s x="6.5" y="14" width="51" height="36" rx="7" fill="[#3a336a,#120e2c]"/><rect x="11" y="28" width="42" height="17" rx="3" fill="#fff"/><path fill="#1a1538" d="M17 28h5v10h-5zM29.5 28h5v10h-5zM42 28h5v10h-5z"/><circle cx="16" cy="21" r="3.6" fill="#6ff2e0"/><circle cx="27" cy="21" r="3.6" fill="#ff7ad0"/>`, [0.9, 0, -0.4]],
  loops: ['purple', `<path s ${L} stroke="[#fff,~]" stroke-width="6.2" d="M47.6 19.6A20 20 0 1 0 52 34"/><path s fill="#fff" stroke="#fff" ${R(2)} d="M53.6 9.6l-.8 14.4-13.4-5.4z"/><circle s cx="32" cy="32" r="9" fill="[#ff7a94,#d61f4f]"/><circle h=".6" cx="29.2" cy="29.2" r="2.6"/>`, [0.97, -0.1, -0.4]],
  audioeditor: ['cyan', `<rect x="24" y="9" width="16" height="46" rx="3" fill="#fff" fill-opacity=".2"/><path s ${L} stroke="[#fff,~]" stroke-width="4.6" d="M12 28v8M20 20v24M28 13v38M36 22v20M44 16v32M52 26v12"/><path ${L} stroke="#ffd84d" stroke-width="3.2" d="M24 12v43"/><circle s cx="24" cy="10.5" r="3.6" fill="[#ffe873,#ffb21f]"/>`, [0.98, 0, -0.2],
    `<path s ${L} stroke="#fff" stroke-width="6.4" d="M14 27v10M24 17v30M34 22v20M44 13v38"/><path ${L} stroke="#ffd84d" stroke-width="3.6" d="M29 9v46"/>`, [1, 3, -0.4]],

  /* the shell's own tiles: not apps, drawn the same way */
  launcher: ['rose', `<path k=".28" transform="translate(.5 2)" d="M32 9l20 23-20 23-20-23z"/><path fill="#fff" d="M32 9L12 32h20z"/><path fill="#ffd9e3" d="M32 9l20 23H32z"/><path fill="#ffb3c6" d="M12 32l20 23V32z"/><path fill="#ff7f9e" d="M52 32L32 55V32z"/><path class="d" ${L} stroke="#fff" stroke-width="1.2" d="M13.4 31L32 9.6"/><circle h=".9" cx="25.5" cy="22" r="1.6"/>`, [1.05, 0, -0.4]],
  trash: ['slate', `<path ${L} stroke="#f0f2f6" stroke-width="3.2" d="M26 15v-2.4a2.6 2.6 0 0 1 2.6-2.6h6.8a2.6 2.6 0 0 1 2.6 2.6V15"/><path s fill="[#eceff4,#9aa3b3]" d="M15 24.5h34l-2.6 26.2a4 4 0 0 1-4 3.6H21.6a4 4 0 0 1-4-3.6z"/><path ${L} stroke="#6a7385" stroke-width="3" d="M25.6 31l1 16M32 31v16M38.4 31l-1 16"/><rect s x="11" y="15" width="42" height="6.6" rx="3.2" fill="[#fff,#d3d8e2]"/>`, [0.97, 0, 0.18]],
  'hard-drive': ['grey', `<rect s x="8" y="21" width="48" height="25" rx="6" fill="[#f8f9fc,#b2bac9]"/><path fill="[#5a6478,#3a4252]" d="M8 37h48v3a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z"/><rect x="14" y="27.5" width="21" height="4.4" rx="2.2" fill="#6a7488"/><circle cx="46" cy="29.7" r="6" fill="#2fe08a" fill-opacity=".2"/><circle cx="46" cy="29.7" r="3.2" fill="#2fe08a"/>`, [1.04, 0, -1.96]],
  home: ['orange', `<rect s x="40" y="12" width="5.4" height="11" rx="1" fill="[#5a6478,#2e3442]"/><path s fill="[#fff,~]" d="M14 30.5L32 15l18 15.5V50a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z"/><path s fill="[#5a6478,#2a303c]" stroke="[#5a6478,#2a303c]" ${R(3)} d="M32 9.5L55 29.5 51.5 33 32 16.4 12.5 33 9 29.5z"/><path fill="[#ff9a4a,#e0541c]" d="M26.5 54V41a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v13z"/><circle cx="35" cy="46.5" r="1" fill="#ffe2bf"/>`, [0.89, 0, 0.58]],
  gift: ['green', `<path ${L} stroke="[#ff7a8e,#d61f3f]" stroke-width="4.2" d="M32 18c-4-8-14-11-15-5-.8 4.6 8 5.4 15 5 7 .4 15.8-.4 15-5-1-6-11-3-15 5z"/><rect s x="11.5" y="27" width="41" height="27" rx="4.6" fill="[#fff,~]"/><path k=".1" d="M11.5 29h41v2.6h-41z"/><rect s x="8" y="18" width="48" height="11" rx="3.6" fill="[#fff,~]"/><rect x="28" y="18" width="8" height="36" fill="[#ff6f86,#d61f3f]"/>`, [0.86, 0, 0.55]],
};

/* ---- shorthand -> plain SVG, once per id --------------------------------- */
const hex6 = c => c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c;
const mix = (a, b, t) => {
  a = hex6(a); b = hex6(b);
  return '#' + [1, 3, 5].map(i => {
    const x = parseInt(a.substr(i, 2), 16), y = parseInt(b.substr(i, 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  }).join('');
};
const attr = (a, n) => (a.match(new RegExp(`\\s${n}="([^"]*)"`)) || [])[1];
const unpaint = a => a.replace(/\s(?:fill|stroke)(?:-opacity)?="[^"]*"/g, '');
const unstroke = a => a.replace(/\sstroke[\w-]*="[^"]*"/g, '');

/* a lit object: contact shadow, the shape, its light (see the top) */
function lit(tag, attrs) {
  const say = /^([mi]) /.exec(attrs);           /* m / i: its tone in one colour (see tone()) */
  if (say) attrs = attrs.slice(2);
  const a = ' ' + attrs;
  const fill = attr(a, 'fill'), stroke = attr(a, 'stroke');
  const filled = fill !== 'none', stroked = !!stroke && stroke !== 'none';
  const bare = unpaint(a);
  /* the shadow: down and a touch right of the light, with a softer rim than its core */
  const shadow = filled && !stroked
    ? `<${tag}${unstroke(bare)} fill="#000" stroke="#000" stroke-opacity=".42" stroke-width="2.6" stroke-linejoin="round"/>`
    : `<${tag}${bare} fill="${filled ? '#000' : 'none'}" stroke="#000"/>`;
  const light = filled && !stroked
    ? `<${tag} class="d"${unstroke(bare)} fill="url(#@o)" stroke="url(#@r)" stroke-width="1.1"/>`
    : `<${tag} class="d"${bare} fill="${filled ? 'url(#@o)' : 'none'}" stroke="url(#@o)"/>`;
  return `<g class="d" opacity=".3" transform="translate(.5 1.5)">${shadow}</g><${tag} ¤${say ? ' ' + say[1] : ''}${a}/>${light}`;
}

/* One colour, for the Outline and Tinted icon styles: every painted part of the
   subject is the style's colour (inkf/inks: its fill, its stroke) or a dimmer mix
   of that colour and the tile (midf/mids), so the drawing keeps its structure.
   The body (the first lit object) decides: on a light body, its details that
   contrast with it are dim; a dark body is dim itself and its light parts are
   the colour. A part can say which it is: <path m ...> dim, <path i ...> colour.
   css/feat-store.css paints them; the tile, light and shadows go. */
const lum = c => {
  const v = hex6(c).match(/\w\w/g).map(x => { const s = parseInt(x, 16) / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
};
const paintLum = p => {
  const g = /^\[(#\w+),(#\w+)\]$/.exec(p);
  return g ? (lum(g[1]) + lum(g[2])) / 2 : /^#\w+$/.test(p) ? lum(p) : null;
};
const DARK = .2;
function tone(body) {
  let base = null, depth = 0;
  return body.replace(/<(\/?)(\w+)([^>]*?)(\/?)>/g, (all, close, tag, attrs, self) => {
    if (close) { if (depth) depth--; return all; }
    if (depth || / class="d"/.test(attrs)) { if (tag === 'g' && !self) depth++; return all; }
    let a = attrs;
    const lit1 = a.startsWith(' ¤');
    if (lit1) a = a.slice(2);
    const say = /^ ([mi])(?= )/.exec(a);
    if (say) a = a.slice(2);
    const fill = attr(a, 'fill'), stroke = attr(a, 'stroke');
    const L = paintLum(fill !== 'none' && fill ? fill : stroke || '');
    if (lit1 && base === null && L !== null) base = L;
    let mid = L !== null && L < DARK;
    if (base !== null && base >= DARK && L !== null) mid = (Math.max(L, base) + .05) / (Math.min(L, base) + .05) >= 1.7;
    if (say) mid = say[1] === 'm';
    const cls = [fill && fill !== 'none' && (mid ? 'midf' : 'inkf'), stroke && stroke !== 'none' && (mid ? 'mids' : 'inks')].filter(Boolean);
    return `<${tag}${cls.length ? ` class="${cls.join(' ')}"` : ''}${a}${self}>`;
  });
}

function compile(src, tint) {
  if (src[0] === '=') {
    const body = iconSvg(src.slice(1)).replace(/^<svg[^>]*>|<\/svg>$/g, '');
    return { body: `<g transform="translate(11 11) scale(1.75)">${body}</g>`, grads: [] };
  }
  const grads = [];
  const body = tone(src
    .replace(/\[(#\w+),~\]/g, (_, a) => `[${a},${tint}]`)
    .replace(/<(\w+) s ([^>]*?)\/>/g, (_, tag, attrs) => lit(tag, attrs))
    .replace(/<(\w+) h(?:="([\d.]+)")? /g, (_, tag, o) => `<${tag} class="d" fill="#fff" fill-opacity="${o || '.35'}" `)
    .replace(/<(\w+) k(?:="([\d.]+)")? /g, (_, tag, o) => `<${tag} class="d" fill="#000" fill-opacity="${o || '.2'}" `))
    .replace(/\[(#\w+),(#\w+)\]/g, (_, a, b) => {
      const k = a + b;
      let i = grads.findIndex(g => g.k === k);
      if (i < 0) i = grads.push({ k, a, b }) - 1;
      return `url(#@${i})`;
    });
  return { body, grads };
}

/* The light every tile shares, in ids of its own:
     @t the tile, @l its light from the top left, @b the shade along its bottom,
     @o an object's lit face and shaded side, @r an object's rim */
const LIGHT = '<radialGradient id="@l" cx=".2" cy="-.08" r="1.05"><stop stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
  + '<linearGradient id="@b" x2="0" y2="1"><stop offset=".6" stop-opacity="0"/><stop offset="1" stop-opacity=".24"/></linearGradient>'
  + '<linearGradient id="@o" x2=".5" y2="1"><stop stop-color="#fff" stop-opacity=".3"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-opacity="0"/><stop offset="1" stop-opacity=".2"/></linearGradient>'
  + '<linearGradient id="@r" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".8"/><stop offset=".32" stop-color="#fff" stop-opacity="0"/></linearGradient>';
const TILE = '<rect class="tl" width="64" height="64" fill="url(#@t)"/><rect class="d" width="64" height="64" fill="url(#@l)"/><rect class="d" width="64" height="64" fill="url(#@b)"/>';

const fitted = (body, fit) => {
  if (!fit) return body;
  const [f, dx = 0, dy = 0] = fit;
  const e = n => +n.toFixed(2);
  return `<g transform="matrix(${f} 0 0 ${f} ${e(32 - 32 * f + dx)} ${e(32 - 32 * f + dy)})">${body}</g>`;
};

function build(id) {
  const [sw, draw, fit, small, smallFit] = ART[id];
  const [top, bottom] = PAL[sw] || PAL.slate;
  const tint = mix('#fff', bottom, .2);
  const big = compile(draw, tint);
  const sm = small ? compile(small, tint) : null;
  const grads = [...big.grads];
  /* the small drawing's gradients follow the big one's, renumbered */
  const smBody = sm ? sm.body.replace(/url\(#@(\d+)\)/g, (_, i) => `url(#@${+i + grads.length})`) : '';
  if (sm) grads.push(...sm.grads);
  const defs = `<linearGradient id="@t" x1=".4" x2=".6" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>${LIGHT}`
    + grads.map((g, i) => `<linearGradient id="@${i}" x2=".3" y2="1"><stop stop-color="${g.a}"/><stop offset="1" stop-color="${g.b}"/></linearGradient>`).join('');
  const body = sm
    ? `<g class="sub lg">${fitted(big.body, fit)}</g><g class="sub sm">${fitted(smBody, smallFit)}</g>`
    : `<g class="sub">${fitted(big.body, fit)}</g>`;
  return { top, bottom, svg: `<defs>${defs}</defs>${TILE}${body}` };
}

const compiled = new Map();
let seq = 0;
const built = id => {
  let c = compiled.get(id);
  if (!c) compiled.set(id, c = build(id));
  return c;
};

export const hasArt = id => Object.prototype.hasOwnProperty.call(ART, id);
export const artIds = () => Object.keys(ART);

/** A whole <svg> for this app, its gradient ids unique to this call. '' with no art. */
export function artSvg(id) {
  if (!hasArt(id)) return '';
  const u = 'art' + (++seq).toString(36) + '-';
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${built(id).svg.split('@').join(u)}</svg>`;
}

/**
 * An app's tile. `app` is a registry app, or { id, icon, g1, g2 } for one of
 * the shell's own. Options: gs (size, '38px'), sel (element, 'div.glyph'),
 * icon (the line glyph, if not the app's), attrs (more props for h()).
 * The line glyph is always there too, hidden: Pixel icons show it instead of
 * the drawing, and Outline and Tinted show it for a third-party mark
 * (css/feat-store.css), so switching never rebuilds a tile and an app with no
 * art needs nothing different.
 */
export function appTile(app, o = {}) {
  const a = app || {};
  const art = hasArt(a.id);
  const style = {
    '--g1': (art ? built(a.id).top : a.g1) || '#4a4a55',
    '--g2': (art ? built(a.id).bottom : a.g2) || '#26262e',
  };
  if (art && a.g1) style['--gl'] = a.g1;       /* the app's own colour: Outline's line */
  if (o.gs) style['--gs'] = o.gs;
  const props = { ...(o.attrs || {}), style };
  if (art) props.dataset = { art: a.id };
  const tile = h(o.sel || 'div.glyph', props,
    art ? h('span.appart', { 'aria-hidden': 'true', html: artSvg(a.id) }) : null,
    icon(o.icon || a.icon || 'apps'));
  if (art) tile.classList.add('glyph--art');
  if (art && ART[a.id][1][0] === '=') tile.classList.add('glyph--mark');   /* a third party's mark: its glyph in Outline and Tinted */
  return tile;
}

export default { appTile, artSvg, hasArt, artIds };
