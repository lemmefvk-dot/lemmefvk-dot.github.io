/* ============================================================
   icons.js — one stroked SVG set for the whole OS
   24x24 viewBox, stroke:currentColor (set in base.css).
   Usage:  icon('folder')            -> <span class="icon">
           icon('play', {fill:true}) -> filled variant
           icon('x', 'my-cls')
   Unknown names fall back to a dot so a typo never crashes a view.
   ============================================================ */
import { h } from './dom.js';

const P = {
  /* --- chrome / nav ------------------------------------------ */
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  minus:'<path d="M5 12h14"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  maximize:'<rect x="4" y="4" width="16" height="16" rx="2"/>',
  'maximize-2':'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  'minimize-2':'<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  'chevron-left':'<path d="M15 18l-6-6 6-6"/>',
  'chevron-right':'<path d="M9 18l6-6-6-6"/>',
  'chevron-up':'<path d="M18 15l-6-6-6 6"/>',
  'chevron-down':'<path d="M6 9l6 6 6-6"/>',
  'chevrons-right':'<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>',
  'arrow-left':'<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right':'<path d="M5 12h14M12 5l7 7-7 7"/>',
  'arrow-up':'<path d="M12 19V5M5 12l7-7 7 7"/>',
  'arrow-down':'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  'corner-up-left':'<path d="M9 14 4 9l5-5M20 20v-7a4 4 0 0 0-4-4H4"/>',
  'more-horizontal':'<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
  'more-vertical':'<circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  'grip-vertical':'<circle cx="9" cy="6" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="18" r="1.1"/>',
  'zoom-in':'<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.7 16.7M11 8v6M8 11h6"/>',
  'zoom-out':'<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.7 16.7M8 11h6"/>',
  'list-plus':'<path d="M3 6h12M3 12h12M3 18h7M18 15v6M15 18h6"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  'check-circle':'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  'x-circle':'<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
  'plus-circle':'<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
  circle:'<circle cx="12" cy="12" r="9"/>',
  square:'<rect x="4" y="4" width="16" height="16" rx="2"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.7 16.7"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 15.3-6.4M21 4v5h-5"/><path d="M21 12a9 9 0 0 1-15.3 6.4M3 20v-5h5"/>',
  'rotate-ccw':'<path d="M1 4v6h6"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>',
  'external-link':'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  sidebar:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'grid-9':'<rect x="3" y="3" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="3" width="4.5" height="4.5" rx="1"/><rect x="16.5" y="3" width="4.5" height="4.5" rx="1"/><rect x="3" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="16.5" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="3" y="16.5" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="16.5" width="4.5" height="4.5" rx="1"/><rect x="16.5" y="16.5" width="4.5" height="4.5" rx="1"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  'list-music':'<path d="M3 6h11M3 12h11M3 18h7"/><circle cx="18" cy="16" r="3"/><path d="M21 16V7l-3 1"/>',
  filter:'<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  layers:'<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  command:'<path d="M15 6a3 3 0 1 1 3-3 3 3 0 0 1-3 3H9a3 3 0 1 1 3 3v6a3 3 0 1 1-3-3h6a3 3 0 1 1-3 3"/>',
  'mouse-pointer':'<path d="M3 3l7.07 17 2.51-7.42L20 10.07z"/>',
  expand:'<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',

  /* --- system / tray ---------------------------------------- */
  wifi:'<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a11 11 0 0 1 14 0M8.5 16.1a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>',
  'wifi-off':'<path d="M2 8.8a15 15 0 0 1 4.2-2.6M9 5.1a15 15 0 0 1 13 3.7M5 12.5a11 11 0 0 1 4-2.4M17 12.5a11 11 0 0 1 2 .9M8.5 16.1a6 6 0 0 1 4-1.1M2 2l20 20"/><circle cx="12" cy="20" r="1"/>',
  bluetooth:'<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
  volume:'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>',
  'volume-1':'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  'volume-x':'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  battery:'<rect x="2" y="7" width="18" height="10" rx="2.5"/><path d="M22.5 11v2"/>',
  'battery-charging':'<path d="M13 7H4.5A2.5 2.5 0 0 0 2 9.5v5A2.5 2.5 0 0 0 4.5 17H10M16 7h1.5A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-2.5 2.5H16M22.5 11v2"/><path d="M13 5l-3 7h4l-3 7"/>',
  gamepad:'<path d="M17 5H7a5 5 0 0 0-5 5v4a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5v-4a5 5 0 0 0-5-5z"/><path d="M6 12h4M8 10v4M15.5 11h.01M18 13.5h.01"/>',
  monitor:'<rect x="2" y="4" width="20" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  cpu:'<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2.5M15 2v2.5M9 19.5V22M15 19.5V22M2 9h2.5M2 15h2.5M19.5 9H22M19.5 15H22"/>',
  'hard-drive':'<path d="M22 12H2"/><path d="M5.45 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.9A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.1z"/><path d="M6 16h.01M10 16h.01"/>',
  database:'<ellipse cx="12" cy="5.5" rx="8.5" ry="3"/><path d="M20.5 12c0 1.66-3.8 3-8.5 3s-8.5-1.34-8.5-3"/><path d="M3.5 5.5v13c0 1.66 3.8 3 8.5 3s8.5-1.34 8.5-3v-13"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  gauge:'<path d="M3.5 19a10 10 0 1 1 17 0"/><path d="M12 14l4.5-4.5"/><circle cx="12" cy="15" r="1.3"/>',
  zap:'<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  thermometer:'<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/>',
  power:'<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/>',
  lock:'<rect x="3.5" y="11" width="17" height="10.5" rx="2.5"/><path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4"/>',
  unlock:'<rect x="3.5" y="11" width="17" height="10.5" rx="2.5"/><path d="M7.5 11V7a4.5 4.5 0 0 1 8.6-1.8"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  keyboard:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9.5 14h5"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  'bell-off':'<path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M2 2l20 20"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  clock:'<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l4 2.4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
  wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  info:'<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5V11M12 7.8h.01"/>',
  'help-circle':'<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9.2a3 3 0 0 1 5.8 1c0 2-3 2.6-3 3.3M12 17h.01"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17.2h.01"/>',
  user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7.5" r="4"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7.5" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.6a4 4 0 0 1 0 7.8"/>',

  /* --- weather ---------------------------------------------- */
  cloud:'<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  'cloud-sun':'<path d="M12 2.5v2M4.9 5.3l1.4 1.4M2.5 12.4h2M19.1 5.3l-1.4 1.4"/><path d="M15.9 9.2a4 4 0 1 0-6.5 4"/><path d="M18 21H8a4.5 4.5 0 0 1 .9-8.9A6 6 0 0 1 20.3 13a4 4 0 0 1-2.3 8z"/>',
  'cloud-rain':'<path d="M18 9.5h-1.3A8 8 0 1 0 9 19.5h9a5 5 0 0 0 0-10z"/><path d="M8 21.5v1.5M12 22v1.5M16 21.5v1.5"/>',
  'cloud-snow':'<path d="M18 9.5h-1.3A8 8 0 1 0 9 19.5h9a5 5 0 0 0 0-10z"/><path d="M8 22h.01M12 22.5h.01M16 22h.01"/>',
  wind:'<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  droplet:'<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"/>',

  /* --- files ------------------------------------------------ */
  folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'folder-open':'<path d="M6 14.5l1.4-2.9A2 2 0 0 1 9.2 10.5H20a2 2 0 0 1 1.9 2.6l-1.5 5.5a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.6.9H18a2 2 0 0 1 2 2v2"/>',
  'folder-git':'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><circle cx="12" cy="14" r="2"/><path d="M12 12v-1M12 16v1"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8.5 13h7M8.5 17h7M8.5 9h2"/>',
  'file-code':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 12.5 8 15l2 2.5M14 12.5 16 15l-2 2.5"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  copy:'<rect x="9" y="9" width="12.5" height="12.5" rx="2"/><path d="M5.5 15H4.5a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2H13a2 2 0 0 1 2 2v1"/>',
  clipboard:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1.2"/>',
  trash:'<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  package:'<path d="M16.5 9.4 7.5 4.2"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  box:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.8" cy="8.8" r="1.6"/><path d="M21 15.5 16.5 11 5 21.5"/>',
  film:'<rect x="2.5" y="2.5" width="19" height="19" rx="2.5"/><path d="M7.5 2.5v19M16.5 2.5v19M2.5 12h19M2.5 7.2h5M2.5 16.8h5M16.5 16.8h5M16.5 7.2h5"/>',
  music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  camera:'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1M12 19v3M8.5 22h7"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  star:'<path d="M12 2.5l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.5 9.4l6.6-1z"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.9 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  /* Static Play: your own thumbs on a game (core/thumbs.js) */
  'thumbs-up':'<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
  'thumbs-down':'<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>',
  'eye-off':'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  bookmark:'<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  pin:'<path d="M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  tag:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-8-8A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l8 8a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.3"/>',
  'edit-3':'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  type:'<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',

  /* --- apps -------------------------------------------------- */
  terminal:'<path d="M4 17l6-6-6-6M12 19h8"/>',
  code:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  calculator:'<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M8 6.5h8M8 11h.01M12 11h.01M16 11h.01M8 14.5h.01M12 14.5h.01M16 14.5h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  calendar:'<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  'sticky-note':'<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/>',
  'shopping-bag':'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  palette:'<circle cx="12" cy="12" r="9.5"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.8" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><circle cx="12" cy="15" r="2.2"/>',
  globe:'<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a15 15 0 0 1 4 9.5 15 15 0 0 1-4 9.5 15 15 0 0 1-4-9.5 15 15 0 0 1 4-9.5z"/>',
  compass:'<circle cx="12" cy="12" r="9.5"/><path d="M16.2 7.8l-2.1 6.4-6.3 2.1 2.1-6.4z"/>',
  'map-pin':'<path d="M12 21.5s-6.8-5.9-6.8-11.6a6.8 6.8 0 0 1 13.6 0c0 5.7-6.8 11.6-6.8 11.6z"/><circle cx="12" cy="9.9" r="2.5"/>',
  home:'<path d="M3 9.5 12 2.5l9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V13h6v9"/>',
  'message-circle':'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  sparkles:'<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  /* Music › Ambient sounds: the café */
  coffee:'<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2.5M10 2v2.5M14 2v2.5"/>',
  cherry:'<path d="M12 4.5c0 4.5-4.5 5.5-6.2 8.2M12 4.5c0 4.5 3.2 6 4.8 8.4M12 4.5c1.5-1.8 3.5-2.3 5.5-2"/><circle cx="6" cy="17" r="4"/><circle cx="17.5" cy="15.5" r="3.6"/>',
  /* spooky season (js/core/season.js) */
  pumpkin:'<path d="M12 7.6c-1.5-1-3.6-1.3-5.4-.6C3.7 8.1 2.3 11.2 2.6 14.4c.3 3.2 2.3 6 5.3 6.5 1.5.3 2.9-.1 4.1-.8 1.2.7 2.6 1.1 4.1.8 3-.5 5-3.3 5.3-6.5.3-3.2-1.1-6.3-4-7.4-1.8-.7-3.9-.4-5.4.6z"/><path d="M12 7.6c-3.4 2.7-3.4 9.8 0 12.5M12 7.6c3.4 2.7 3.4 9.8 0 12.5"/><path d="M12 7.4c-.1-1.9.5-3.4 2-4.4M14.2 4.6c1.2-.5 2.6-.3 3.5.5"/>',
  ghost:'<path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.4-1.7-2.3 1.7-2.3-1.7-2.3 1.7-2.3-1.7z"/><path d="M9.6 10.4v.6M14.4 10.4v.6"/><path d="M10.4 14.6c1 .8 2.2.8 3.2 0"/>',
  /* winter (js/core/season.js) and the desktop pet (js/shell/pet.js) */
  snowflake:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3.6 10.4l3.4-.9-.9-3.4M20.4 13.6l-3.4.9.9 3.4M6.1 17.9l.9-3.4-3.4-.9M17.9 6.1l-.9 3.4 3.4.9"/>',
  gift:'<rect x="3" y="8" width="18" height="4.5" rx="1"/><path d="M5 12.5V21h14v-8.5M12 8v13"/><path d="M12 8C10.8 5.2 7.6 3.5 6.6 5.3 5.7 7 8.6 8 12 8zM12 8c1.2-2.8 4.4-4.5 5.4-2.7.9 1.7-2 2.7-5.4 2.7z"/>',
  cat:'<path d="M5 9.5V3.5l4 3.2a8 8 0 0 1 6 0l4-3.2v6a7.5 7.5 0 0 1 .5 2.8c0 4.6-3.4 8.2-7.5 8.2s-7.5-3.6-7.5-8.2A7.5 7.5 0 0 1 5 9.5z"/><path d="M9 12.2v.6M15 12.2v.6M11 15.5l1 .7 1-.7"/><path d="M2 14.5l4 .5M2 17.5l4-.6M22 14.5l-4 .5M22 17.5l-4-.6"/>',
  diamond:'<path d="M12 2.2 21.8 12 12 21.8 2.2 12z"/>',
  /* seasonal: the Pumpkin Carver and the spooky Arcade games */
  candy:'<rect x="7" y="8" width="10" height="8" rx="4"/><path d="M7.4 10.5 3 7.5v9l4.4-3M16.6 10.5l4.4-3v9l-4.4-3M10 8.4l-1 7.2M14 8.4l-1 7.2"/>',
  maze:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7.5 3v8.5H12M12 7.5h4.5V16M7.5 16v5M12 16h4.5M12 11.5V16"/>',
  chess:'<circle cx="12" cy="6" r="2.6"/><path d="M9.6 10.2h4.8M10.3 10.2c0 3.3-1.2 5.9-2.7 7.8h8.8c-1.5-1.9-2.7-4.5-2.7-7.8"/><rect x="5.5" y="18" width="13" height="3" rx="1"/>',
  connect4:'<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><circle cx="7.5" cy="9.5" r="1.7"/><circle cx="12" cy="9.5" r="1.7"/><circle cx="16.5" cy="9.5" r="1.7"/><circle cx="7.5" cy="14.5" r="1.7"/><circle cx="12" cy="14.5" r="1.7"/><circle cx="16.5" cy="14.5" r="1.7"/>',
  play:'<path d="M6 3.5 20 12 6 20.5z"/>',
  pause:'<rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/>',
  'skip-back':'<path d="M19 20 9 12l10-8z"/><path d="M5 19.5v-15"/>',
  'skip-forward':'<path d="M5 4l10 8-10 8z"/><path d="M19 4.5v15"/>',
  repeat:'<path d="M17 1.5l4 4-4 4"/><path d="M3 11.5v-2a4 4 0 0 1 4-4h14"/><path d="M7 22.5l-4-4 4-4"/><path d="M21 12.5v2a4 4 0 0 1-4 4H3"/>',
  shuffle:'<path d="M16 3.5h5v5M4 20.5 21 3.5M21 15.5v5h-5M15 15l6 5.5M4 3.5 9.5 9"/>',
  'trending-up':'<path d="M23 6.5 13.5 16 8.5 11 1 18.5"/><path d="M17 6.5h6v6"/>',
  'bar-chart':'<path d="M12 20V10M18 20V4M6 20v-5"/>',
  'pie-chart':'<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  'line-chart':'<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  table:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 9v12M15 9v12"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  bold:'<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
  italic:'<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  'align-left':'<path d="M17 10H3M21 6H3M21 14H3M17 18H3"/>',
  'align-center':'<path d="M18 10H6M21 6H3M21 14H3M18 18H6"/>',
  'align-right':'<path d="M21 10H7M21 6H3M21 14H3M21 18H7"/>',
  'git-branch':'<path d="M6 4.5v11"/><circle cx="18" cy="6.5" r="2.8"/><circle cx="6" cy="18.5" r="2.8"/><path d="M18 9.3a8.5 8.5 0 0 1-8.5 8.5"/>',
  cast:'<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8a13 13 0 0 1 13 13"/><circle cx="3" cy="20" r="1"/><path d="M14 4h6a2 2 0 0 1 2 2v6"/>',
  bug:'<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 6V3M8 10H4M8 14H3M8 18H5M16 10h4M16 14h5M16 18h3M9.5 4 8 2M14.5 4 16 2"/>',
  printer:'<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="7" rx="2"/><path d="M6 16h12v5H6z"/>',
  scan:'<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3.2"/>',
  crop:'<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  send:'<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  'picture-in-picture':'<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>',

  /* --- seasonal (Halloween: js/core/halloween.js) ------------ */

  /* Brand marks used by apps that connect to these third-party services. */
  'brand-chrome':'<circle cx="12" cy="12" r="11" fill="#EA4335"/><path d="M1.8 8.1 7.4 18a5.3 5.3 0 0 0 9.2-.2l2.7-4.7H11a3.2 3.2 0 0 1-2.8-1.6L5.6 7.1z" fill="#34A853"/><path d="M7.2 18.1 12 22a11 11 0 0 0 10.4-11H11.1a3.2 3.2 0 0 0-2.8 1.6z" fill="#FBBC05"/><circle cx="12" cy="12" r="4.1" fill="#4285F4"/><circle cx="12" cy="12" r="2.2" fill="#EAF2FF"/>',
  'brand-vscode':'<path d="M17.4 2.4 9.1 10 5.2 7 2 8.5v7L5.2 17l3.9-3 8.3 7.6 4.6-1.8V4.2z" fill="#007ACC"/><path d="m17.2 7.2-6.3 4.8 6.3 4.8z" fill="#fff"/><path d="m5.1 10.1 2.6 1.9-2.6 1.9-1.6-1.9z" fill="#fff"/>',
  'brand-tiktok':'<path d="M15 3h3.2a5.8 5.8 0 0 0 3.5 4.4v3.4a9.2 9.2 0 0 1-4-1.4v7.1a6.5 6.5 0 1 1-6.5-6.5h.8v3.5h-.8a3 3 0 1 0 3 3z" transform="translate(-1 -1)" fill="#25F4EE"/><path d="M15 3h3.2a5.8 5.8 0 0 0 3.5 4.4v3.4a9.2 9.2 0 0 1-4-1.4v7.1a6.5 6.5 0 1 1-6.5-6.5h.8v3.5h-.8a3 3 0 1 0 3 3z" transform="translate(1 1)" fill="#FE2C55"/><path d="M15 3h3.2a5.8 5.8 0 0 0 3.5 4.4v3.4a9.2 9.2 0 0 1-4-1.4v7.1a6.5 6.5 0 1 1-6.5-6.5h.8v3.5h-.8a3 3 0 1 0 3 3z" transform="translate(0 0)" fill="#fff"/>',
  'brand-spotify':'<circle cx="12" cy="12" r="11" fill="#1DB954"/><path d="M5.1 9a12.5 12.5 0 0 1 13.7 1.3M6 12.3a9.5 9.5 0 0 1 11.1 1.1M7 15.4a6.4 6.4 0 0 1 8.1.8" fill="none" stroke="#101510" stroke-width="1.8" stroke-linecap="round"/>',
  'brand-xbox':'<circle cx="12" cy="12" r="11" fill="#107C10"/><path d="M5.2 5.3c2.1-.7 4.7 1 6.8 3 2.1-2 4.7-3.7 6.8-3-2.6-2.3-11-2.3-13.6 0zM4.1 7.2c-.8 3.5 2.1 8.9 5.4 12.2-.4-3.7-2.5-8.4-5.4-12.2zm15.8 0c.8 3.5-2.1 8.9-5.4 12.2.4-3.7 2.5-8.4 5.4-12.2z" fill="#fff"/>',
  /* The tilted squircle with a square counter. Drawn as one evenodd path so
     the hole is a real cut-out and the app tile's colour shows through it —
     the old mark was a dark slab that vanished against the green tile. */
  'brand-roblox':'<g transform="rotate(10 12 12)"><path fill-rule="evenodd" fill="#fff" d="M8.6 4.6H15.4A4 4 0 0 1 19.4 8.6V15.4A4 4 0 0 1 15.4 19.4H8.6A4 4 0 0 1 4.6 15.4V8.6A4 4 0 0 1 8.6 4.6ZM10.9 9.6H13.1A1.3 1.3 0 0 1 14.4 10.9V13.1A1.3 1.3 0 0 1 13.1 14.4H10.9A1.3 1.3 0 0 1 9.6 13.1V10.9A1.3 1.3 0 0 1 10.9 9.6Z"/></g>',
  'brand-playstation':'<circle cx="12" cy="12" r="11" fill="#0756B5"/><path d="M9.2 4.1v14.8l3.2 1V8.1c0-1 .4-1.6 1.1-1.4.8.2 1.1.9 1.1 1.9v2.8l3.1 1V9.8c0-3-1.6-4.7-4.6-5.5-1.5-.4-2.8-.6-3.9-.2zM7.8 14.1l-3.1 1c-1.5.5-2 1.3-1.1 1.7.8.4 2.2.3 3.6-.2l.6-.2v2.1l-.5.2c-3 1-5.8 1-7.1.1-1.6-1.1-.5-2.8 2.5-3.8l5.1-1.7zM16 16.5l3.4-1.1c1.5-.5 2.8-.5 3.6-.1.8.4.4 1.1-1.1 1.6l-5.9 1.9v-2.3z" fill="#fff"/>',
};

const ALIAS = {
  desktop: 'monitor', window: 'maximize', apps: 'grid-9', notes: 'sticky-note',
  store: 'shopping-bag', video: 'film', photos: 'image', weather: 'cloud-sun',
  'system-monitor': 'activity', browser: 'globe', wallpaper: 'image',
  note: 'sticky-note', dot: 'circle', share: 'external-link', menu: 'list',
  'volume-2': 'volume', screenshot: 'camera', fan: 'wind', ram: 'database',
  gpu: 'monitor', disk: 'hard-drive', network: 'wifi', reload: 'refresh',
  back: 'chevron-left', forward: 'chevron-right', close: 'x', ok: 'check',
  brightness: 'sun', dnd: 'moon', airdrop: 'cast', 'night-shift': 'moon',
  'connect-four': 'connect4', 'four-in-a-row': 'connect4',
  halloween: 'pumpkin', 'jack-o-lantern': 'pumpkin', spooky: 'ghost',
  winter: 'snowflake', present: 'gift', pet: 'cat',
  grip: 'grip-vertical', playlist: 'list-plus',
  sheet: 'table', spreadsheet: 'table',
};

export const iconNames = () => [...Object.keys(P), ...Object.keys(ALIAS)].sort();
export const hasIcon = name => !!(P[name] || P[ALIAS[name]]);

export function iconSvg(name) {
  const body = P[name] || P[ALIAS[name]] || '<circle cx="12" cy="12" r="3"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** icon(name, 'extra-class') | icon(name, {fill, cls, size, title}) */
export function icon(name, opt) {
  const o = typeof opt === 'string' ? { cls: opt } : (opt || {});
  const cls = ['icon', o.fill ? 'icon--fill' : null, o.cls].filter(Boolean).join(' ');
  const el = h('span', { class: cls, html: iconSvg(name), 'data-icon': name });
  if (o.size) { el.style.width = o.size + 'px'; el.style.height = o.size + 'px'; }
  if (o.title) el.title = o.title;
  return el;
}

export default icon;
