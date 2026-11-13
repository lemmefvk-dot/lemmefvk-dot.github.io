/* ============================================================
   winter-art.js — the advent calendar's treats, drawn here as SVG.
   Original vector art; nothing is fetched. js/core/winter.js says
   which door gives which, and what each one does.

     STICKERS   100×100 (desktop stickers, like Halloween's)
     CURSORS    32×32, the usual arrow, tip at 4 3
     WALLPAPERS 1600×900, sliced to fill
     SOUNDS     the badge shown for a notification tone
   ============================================================ */
const SVG = (vb, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}>${body}</svg>`;
const S100 = body => SVG('0 0 100 100', body);
const shadow = (cx = 50, cy = 95, rx = 28) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="3.5" fill="#000" opacity=".16"/>`;

/* one arm of a snowflake, pointing up from 50,50; six of them make a flake */
const FLAKE_ARM = 'M50 50V14M50 24l-7-7M50 24l7-7M50 35l-9-6M50 35l9-6';
const flake = (stroke, w, extra = '') => [0, 60, 120, 180, 240, 300]
  .map(r => `<path d="${FLAKE_ARM}" transform="rotate(${r} 50 50)" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`).join('');

/* ---------------- stickers ---------------- */
export const STICKERS = [
  { id: 'snowman', name: 'Snowman', svg: () => S100(
    '<defs><radialGradient id="sn" cx=".38" cy=".3" r=".8"><stop offset=".5" stop-color="#fdfeff"/><stop offset="1" stop-color="#c3d3ee"/></radialGradient></defs>'
    + shadow(50, 96, 26)
    + '<path d="M28 60 12 50M72 60l16-10M16 52l-5-6M84 52l5-6" stroke="#6b4423" stroke-width="3" stroke-linecap="round"/>'
    + '<circle cx="50" cy="72" r="23" fill="url(#sn)"/><circle cx="50" cy="42" r="16" fill="url(#sn)"/>'
    + '<rect x="38" y="13" width="24" height="17" rx="2" fill="#1f2230"/><rect x="38" y="24" width="24" height="4" fill="#d23a3f"/>'
    + '<rect x="31" y="28" width="38" height="5" rx="2.5" fill="#1f2230"/>'
    + '<circle cx="44" cy="40" r="2.1" fill="#1f2230"/><circle cx="56" cy="40" r="2.1" fill="#1f2230"/>'
    + '<path d="M50 44l12 3-12 2.4z" fill="#f08a24"/>'
    + '<path d="M35 54q15 7 30 0v6q-15 7-30 0z" fill="#d23a3f"/><path d="M57 58l5 15h-7l-3-13z" fill="#a82a32"/>'
    + '<circle cx="50" cy="70" r="2.3" fill="#1f2230"/><circle cx="50" cy="80" r="2.3" fill="#1f2230"/>') },
  { id: 'snowflake', name: 'Snowflake', svg: () => S100(flake('#2f6a9c', 8) + flake('#e8f6ff', 4.5) + '<circle cx="50" cy="50" r="5" fill="#e8f6ff" stroke="#2f6a9c" stroke-width="2"/>') },
  { id: 'mitten', name: 'Red mitten', svg: () => S100(shadow(52, 95, 22)
    + '<path d="M34 72V30c0-12 9-20 20-20s20 8 20 20v42z" fill="#c8323c"/>'
    + '<path d="M36 50c-10-3-17 2-16 10s9 12 16 8z" fill="#c8323c"/>'
    + '<path d="M44 26h20M44 34h20M44 42h20" stroke="#f3d7a8" stroke-width="2.4" stroke-dasharray="3 3"/>'
    + '<circle cx="54" cy="54" r="5" fill="#fff" opacity=".9"/>'
    + '<rect x="31" y="70" width="46" height="18" rx="7" fill="#fbf6ee"/><path d="M36 76h36M36 82h36" stroke="#e3d7c4" stroke-width="2"/>') },
  { id: 'gingerbread', name: 'Gingerbread friend', svg: () => S100(shadow()
    + '<g fill="#b8692f"><circle cx="50" cy="24" r="14"/><rect x="34" y="34" width="32" height="38" rx="12"/>'
    + '<rect x="16" y="40" width="26" height="12" rx="6" transform="rotate(-18 29 46)"/><rect x="58" y="40" width="26" height="12" rx="6" transform="rotate(18 71 46)"/>'
    + '<rect x="33" y="62" width="14" height="30" rx="7" transform="rotate(14 40 77)"/><rect x="53" y="62" width="14" height="30" rx="7" transform="rotate(-14 60 77)"/></g>'
    + '<g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M44 29q6 5 12 0"/><path d="M19 40l3 4 3-4 3 4M73 40l3 4 3-4 3 4M34 86l3 3 3-3 3 3M56 86l3 3 3-3 3 3"/></g>'
    + '<circle cx="45" cy="21" r="2" fill="#fff"/><circle cx="55" cy="21" r="2" fill="#fff"/>'
    + '<circle cx="50" cy="44" r="3" fill="#e2394a"/><circle cx="50" cy="54" r="3" fill="#3aa05a"/><circle cx="50" cy="64" r="3" fill="#e2394a"/>') },
  { id: 'candy-cane', name: 'Candy cane', svg: () => S100(
    '<path d="M62 92V36a14 14 0 0 0-28 0" fill="none" stroke="#8e1324" stroke-width="16" stroke-linecap="round"/>'
    + '<path d="M62 92V36a14 14 0 0 0-28 0" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>'
    + '<path d="M62 92V36a14 14 0 0 0-28 0" fill="none" stroke="#d61f3a" stroke-width="12" stroke-dasharray="6 7"/>') },
  { id: 'ornament', name: 'Bauble', svg: () => S100(
    '<defs><radialGradient id="ob" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff9aa2"/><stop offset=".45" stop-color="#d7263d"/><stop offset="1" stop-color="#6d0f1e"/></radialGradient></defs>'
    + '<path d="M50 6c-6 0-6 8 0 8s6-8 0-8z" fill="none" stroke="#c9a54a" stroke-width="2"/>'
    + '<rect x="42" y="13" width="16" height="10" rx="2" fill="#e2b84f"/>'
    + '<circle cx="50" cy="58" r="34" fill="url(#ob)"/>'
    + '<path d="M17 56q8-6 16 0t16 0 17 0 17 0" fill="none" stroke="#f4d27a" stroke-width="3"/>'
    + '<ellipse cx="38" cy="42" rx="8" ry="5" fill="#fff" opacity=".45" transform="rotate(-30 38 42)"/>') },
  { id: 'holly', name: 'Holly sprig', svg: () => S100(
    '<path d="M50 52C40 40 22 38 10 44c4 3 4 7 1 10 5 0 8 3 8 7 4-3 8-2 11 2 1-5 5-7 9-6-2-4 0-8 5-9z" fill="#2f7d45" stroke="#1d5530" stroke-width="2" stroke-linejoin="round"/>'
    + '<path d="M50 52c10-12 28-14 40-8-4 3-4 7-1 10-5 0-8 3-8 7-4-3-8-2-11 2-1-5-5-7-9-6 2-4 0-8-5-9z" fill="#3a9354" stroke="#1d5530" stroke-width="2" stroke-linejoin="round"/>'
    + '<path d="M50 52 22 47M50 52l28-5" stroke="#1d5530" stroke-width="1.6"/>'
    + '<circle cx="44" cy="58" r="7" fill="#d21f33"/><circle cx="56" cy="58" r="7" fill="#e02c3e"/><circle cx="50" cy="48" r="7" fill="#c81a2c"/>'
    + '<circle cx="42" cy="56" r="2" fill="#fff" opacity=".6"/><circle cx="54" cy="56" r="2" fill="#fff" opacity=".6"/><circle cx="48" cy="46" r="2" fill="#fff" opacity=".6"/>') },
  { id: 'star', name: 'Gold star', svg: () => S100(
    '<defs><linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset="1" stop-color="#f2b316"/></linearGradient></defs>'
    + '<path d="M50 8l11.8 26.5 28.9 2.9-21.7 19.3 6.3 28.3L50 70.3 24.7 85l6.3-28.3L9.3 37.4l28.9-2.9z" fill="url(#st)" stroke="#b9780b" stroke-width="3" stroke-linejoin="round"/>'
    + '<path d="M84 10l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff6c7"/>') },
  { id: 'penguin', name: 'Penguin in a hat', svg: () => S100(shadow(50, 95, 22)
    + '<ellipse cx="50" cy="60" rx="24" ry="32" fill="#1f2536"/><ellipse cx="50" cy="66" rx="16" ry="23" fill="#fbfcff"/>'
    + '<path d="M27 52c-8 8-9 20-6 26 4-4 8-10 8-18z" fill="#1f2536"/><path d="M73 52c8 8 9 20 6 26-4-4-8-10-8-18z" fill="#1f2536"/>'
    + '<circle cx="43" cy="44" r="3" fill="#fff"/><circle cx="57" cy="44" r="3" fill="#fff"/><circle cx="43.6" cy="44.4" r="1.6" fill="#111"/><circle cx="57.6" cy="44.4" r="1.6" fill="#111"/>'
    + '<path d="M45 50h10l-5 6z" fill="#f59a23"/><path d="M38 91h10l-3-5zM52 91h10l-3-5z" fill="#f59a23"/>'
    + '<path d="M30 33c4-14 36-14 40 0z" fill="#d23a3f"/><rect x="28" y="31" width="44" height="6" rx="3" fill="#fbfcff"/><circle cx="62" cy="18" r="5" fill="#fbfcff"/><path d="M60 21C57 19 52 20 48 22" stroke="#d23a3f" stroke-width="5"/>') },
  { id: 'cocoa', name: 'Hot cocoa', svg: () => S100(shadow(48, 93, 26)
    + '<path d="M38 22c-4-6 4-8 0-14M50 22c-4-6 4-8 0-14M62 22c-4-6 4-8 0-14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>'
    + '<path d="M72 44h6a10 10 0 0 1 0 20h-6" fill="none" stroke="#b9473a" stroke-width="6"/>'
    + '<path d="M24 32h50v44c0 9-7 16-16 16H40c-9 0-16-7-16-16z" fill="#c9553f"/>'
    + '<ellipse cx="49" cy="32" rx="25" ry="6" fill="#6b3a24"/>'
    + '<rect x="34" y="27" width="9" height="8" rx="2" fill="#fff" transform="rotate(-12 38 31)"/><rect x="48" y="26" width="9" height="8" rx="2" fill="#fde9f0" transform="rotate(10 52 30)"/><rect x="58" y="29" width="8" height="7" rx="2" fill="#fff"/>'
    + '<path d="M30 56h38" stroke="#fff" stroke-width="3" stroke-dasharray="5 4" opacity=".75"/>') },
  { id: 'gift', name: 'Wrapped gift', svg: () => S100(shadow()
    + '<rect x="18" y="40" width="64" height="52" rx="4" fill="#2f8a57"/><rect x="14" y="32" width="72" height="14" rx="3" fill="#38a066"/>'
    + '<rect x="45" y="32" width="10" height="60" fill="#f2c94c"/>'
    + '<path d="M50 32c-6-14-24-18-24-6 0 6 12 8 24 6zM50 32c6-14 24-18 24-6 0 6-12 8-24 6z" fill="#f2c94c" stroke="#c99a1f" stroke-width="2"/>'
    + '<circle cx="50" cy="32" r="4" fill="#e0b13a"/>'
    + '<g fill="#fff" opacity=".35"><circle cx="28" cy="56" r="2.5"/><circle cx="36" cy="74" r="2.5"/><circle cx="66" cy="60" r="2.5"/><circle cx="72" cy="80" r="2.5"/></g>') },
  { id: 'pine', name: 'Little tree', svg: () => S100(shadow(50, 95, 20)
    + '<rect x="45" y="80" width="10" height="13" rx="2" fill="#7a4a26"/>'
    + '<path d="M50 14 74 50H62l18 32H20l18-32H26z" fill="#2c7a4b"/>'
    + '<path d="M50 14l9 14-5 2-4-4-4 4-5-2zM32 50h36l-4 5-5-3-5 4-4-4-5 4-5-4-4 3zM26 82h48" fill="#f4f9ff" stroke="#f4f9ff" stroke-width="2" stroke-linejoin="round"/>'
    + '<circle cx="42" cy="44" r="3" fill="#e2394a"/><circle cx="58" cy="62" r="3" fill="#f2c94c"/><circle cx="40" cy="70" r="3" fill="#5aa8f0"/><circle cx="62" cy="40" r="2.5" fill="#f2c94c"/>'
    + '<path d="M50 4l2.4 5 5.5.6-4.1 3.7 1.2 5.4L50 16l-5 2.7 1.2-5.4-4.1-3.7 5.5-.6z" fill="#ffd34a"/>') },
];

/* ---------------- cursors ---------------- */
const ARROW = 'M4 3v22l6-5.5 4 8.5 4.5-2-4-8.5H22z';
const cursor = (fill, stroke, defs = '', extra = '') => SVG('0 0 32 32',
  `${defs ? `<defs>${defs}</defs>` : ''}<path d="${ARROW}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>${extra}`,
  ' width="32" height="32"');

export const CURSORS = [
  { id: 'candy-cane', name: 'Candy-cane pointer', svg: () => cursor('url(#cs)', '#8e1324',
    '<pattern id="cs" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="5" height="5" fill="#fff"/><rect width="2.3" height="5" fill="#d61f3a"/></pattern>') },
  { id: 'frost', name: 'Frost pointer', svg: () => cursor('url(#fg)', '#2a5d88',
    '<linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3fbff"/><stop offset="1" stop-color="#9fd3f5"/></linearGradient>',
    '<path d="M25 4v8M21 8h8M22.2 5.2l5.6 5.6M27.8 5.2l-5.6 5.6" stroke="#5fb0e8" stroke-width="1.3" stroke-linecap="round"/>') },
  { id: 'evergreen', name: 'Evergreen pointer', svg: () => cursor('#2c7a4b', '#0f3a22', '',
    '<circle cx="8" cy="14" r="1.3" fill="#e2394a"/><circle cx="11" cy="19" r="1.3" fill="#f2c94c"/><circle cx="14" cy="13" r="1.1" fill="#5aa8f0"/>'
    + '<path d="M25.5 3.5l1.1 2.3 2.5.3-1.9 1.7.5 2.5-2.2-1.2-2.2 1.2.5-2.5-1.9-1.7 2.5-.3z" fill="#ffd34a"/>') },
  { id: 'gingerbread', name: 'Gingerbread pointer', svg: () => cursor('#b8692f', '#4a250c', '',
    '<path d="M6 12.5l1.5 1.5 1.5-1.5M9 17.5l1.5 1.5 1.5-1.5" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"/>') },
];

/* ---------------- wallpapers ---------------- */
const stars = (list, op = 0.65) => `<g fill="#fff" opacity="${op}">${list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
const STARS = [[90, 80, 1.5], [240, 150, 1.1], [380, 60, 1.4], [520, 120, 1], [660, 50, 1.6], [820, 110, 1.1], [950, 70, 1.3],
  [1080, 160, 1], [1220, 60, 1.5], [1360, 130, 1.1], [1500, 80, 1.4], [160, 260, 1], [460, 230, 1.2], [760, 240, 1], [1290, 250, 1.2], [1560, 220, 1]];
/* a snowy pine in a 60×100 box, its base at the bottom */
const PINE = '<symbol id="pn" viewBox="0 0 60 100"><path d="M30 0 48 32H40L56 60H44L60 92H0L16 60H4L20 32H12z" fill="currentColor"/>'
  + '<path d="M30 0 37 13 33 15 30 11 27 15 23 13zM14 32h32l-3 5-5-3-5 4-3-4-5 4-5-4-4 3zM6 60h48l-4 5-6-3-6 4-4-4-5 4-5-4-6 4-5-3z" fill="#eef5ff"/>'
  + '<rect x="26" y="92" width="8" height="8" fill="#3b2a24"/></symbol>';
const pine = (x, y, s, colour) => `<use href="#pn" x="${x}" y="${y}" width="${s * 0.6}" height="${s}" style="color:${colour}"/>`;
const flurry = (seed, n, w, h, op = 0.7) => {
  let a = seed;
  const r = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  return `<g fill="#fff" opacity="${op}">${Array.from({ length: n }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(0.8 + r() * 2.4).toFixed(1)}"/>`).join('')}</g>`;
};

function wpSnowyPines() {
  return SVG('0 0 1600 900',
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1834"/><stop offset=".55" stop-color="#34497e"/><stop offset="1" stop-color="#b6a3d2"/></linearGradient>'
    + '<radialGradient id="m"><stop offset=".5" stop-color="#fffbe9"/><stop offset=".58" stop-color="#fff1c9" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    + PINE + '</defs>'
    + '<rect width="1600" height="900" fill="url(#s)"/>' + stars(STARS)
    + '<circle cx="1180" cy="210" r="230" fill="url(#m)"/>'
    + '<path d="M0 560C260 500 520 540 800 520s560-80 800-40v460H0z" fill="#8e9fcb"/>'
    + pine(120, 400, 180, '#2c4a6a') + pine(260, 430, 150, '#2c4a6a') + pine(1320, 390, 190, '#2c4a6a') + pine(1460, 430, 150, '#2c4a6a')
    + '<path d="M0 660C300 600 560 650 840 640s520-60 760-20v300H0z" fill="#d6e1f4"/>'
    + pine(40, 470, 260, '#1d3a40') + pine(330, 540, 200, '#1d3a40') + pine(1100, 500, 240, '#1d3a40') + pine(1380, 540, 220, '#1d3a40')
    + '<path d="M0 780C360 730 700 770 1000 760s420-30 600-10v150H0z" fill="#f4f8ff"/>'
    + flurry(7, 140, 1600, 900),
    ' preserveAspectRatio="xMidYMid slice"');
}

function wpNorthernLights() {
  return SVG('0 0 1600 900',
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030b16"/><stop offset=".7" stop-color="#0b2433"/><stop offset="1" stop-color="#15384a"/></linearGradient>'
    + '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cffc4" stop-opacity="0"/><stop offset=".45" stop-color="#5cf2b0" stop-opacity=".55"/><stop offset="1" stop-color="#2bb3c9" stop-opacity="0"/></linearGradient>'
    + '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c58cff" stop-opacity="0"/><stop offset=".5" stop-color="#9f7bff" stop-opacity=".35"/><stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/></linearGradient>'
    + '<filter id="bl" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs>'
    + '<rect width="1600" height="900" fill="url(#s)"/>' + stars(STARS, 0.8)
    + '<g filter="url(#bl)"><path d="M-40 260C200 120 420 340 700 200s520 40 940-120v260C1180 460 960 300 700 420S200 300-40 460z" fill="url(#a)"/>'
    + '<path d="M200 140C420 40 640 220 900 110s420-20 700-80v200C1300 360 1100 220 880 300S440 200 200 330z" fill="url(#b)"/></g>'
    + '<path d="M0 620 160 470 260 540 420 380 560 520 700 440 860 560 1000 420 1160 540 1300 460 1460 560 1600 500V700H0z" fill="#dce8f2"/>'
    + '<path d="M420 380 470 430 450 440 500 470 560 520 520 500 470 480 430 440zM1000 420 1050 460 1030 470 1090 500 1160 540 1100 520 1040 490z" fill="#9db4c9"/>'
    + '<rect y="700" width="1600" height="200" fill="#10283a"/>'
    + '<g opacity=".35" filter="url(#bl)"><path d="M-40 940C200 1080 420 860 700 1000s520-40 940 120V860C1180 740 960 900 700 780S200 900-40 740z" fill="url(#a)"/></g>'
    + '<path d="M0 700h1600" stroke="#cfe3f0" stroke-width="3" opacity=".5"/>',
    ' preserveAspectRatio="xMidYMid slice"');
}

function wpCocoaWindow() {
  const bulbs = ['#ff6b6b', '#ffd34a', '#6fd38a', '#6fb7ff', '#ff9ad1'];
  const lights = Array.from({ length: 15 }, (_, i) => {
    const x = 80 + i * 103, y = 70 + Math.sin(i * 0.9) * 14 + (i % 2 ? 22 : 8);
    const c = bulbs[i % bulbs.length];
    return `<circle cx="${x}" cy="${y}" r="26" fill="${c}" opacity=".18"/><ellipse cx="${x}" cy="${y}" rx="8" ry="11" fill="${c}"/>`;
  }).join('');
  return SVG('0 0 1600 900',
    '<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2419"/><stop offset="1" stop-color="#2a130d"/></linearGradient>'
    + '<linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14204a"/><stop offset="1" stop-color="#3e5a8e"/></linearGradient>'
    + '<radialGradient id="g" cx=".5" cy=".9" r=".7"><stop offset="0" stop-color="#ffb35c" stop-opacity=".45"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient></defs>'
    + '<rect width="1600" height="900" fill="url(#w)"/>'
    + '<rect x="380" y="150" width="840" height="560" fill="url(#n)"/>'
    + flurry(3, 90, 840, 560, 0.8).replace('<g ', '<g transform="translate(380 150)" ')
    + '<path d="M380 610c160-50 300-20 420-40s260-40 420-10v150H380z" fill="#e6eef8"/>'
    + '<g fill="#2a2b3e"><rect x="520" y="540" width="90" height="70"/><path d="M505 545 565 495 625 545z"/><rect x="900" y="520" width="120" height="90"/><path d="M885 525 960 470 1035 525z"/></g>'
    + '<g fill="#ffcf6a"><rect x="540" y="560" width="18" height="20"/><rect x="575" y="560" width="18" height="20"/><rect x="920" y="545" width="22" height="22"/><rect x="975" y="545" width="22" height="22"/></g>'
    + '<path d="M380 150h840v560H380z" fill="none" stroke="#8a5a3a" stroke-width="34"/>'
    + '<path d="M800 150v560M380 430h840" stroke="#8a5a3a" stroke-width="18"/>'
    + '<rect x="330" y="710" width="940" height="40" rx="6" fill="#9c6a45"/><rect x="330" y="745" width="940" height="14" fill="#6f4529"/>'
    + '<rect width="1600" height="900" fill="url(#g)"/>'
    + '<path d="M1060 640c-6-10 6-14 0-26M1090 640c-6-10 6-14 0-26M1120 640c-6-10 6-14 0-26" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>'
    + '<path d="M1170 668h8a14 14 0 0 1 0 28h-8" fill="none" stroke="#c9553f" stroke-width="8"/>'
    + '<path d="M1040 650h130v46c0 8-6 14-14 14h-102c-8 0-14-6-14-14z" fill="#c9553f"/><ellipse cx="1105" cy="650" rx="65" ry="10" fill="#5c3020"/>'
    + '<rect x="1070" y="640" width="16" height="12" rx="3" fill="#fff"/><rect x="1100" y="638" width="15" height="12" rx="3" fill="#fff"/>'
    + '<path d="M40 50Q300 120 560 60T1080 70T1580 50" fill="none" stroke="#1a0d08" stroke-width="3"/>' + lights,
    ' preserveAspectRatio="xMidYMid slice"');
}

function wpSnowflakes() {
  const f = (x, y, s, r) => `<use href="#fl" x="-50" y="-50" width="100" height="100" transform="translate(${x} ${y}) rotate(${r}) scale(${s})"/>`;
  return SVG('0 0 1600 900',
    `<defs><symbol id="fl" viewBox="0 0 100 100">${flake('#dff2ff', 5)}</symbol>`
    + `<pattern id="p" width="320" height="300" patternUnits="userSpaceOnUse">${f(70, 70, 0.7, 10)}${f(230, 90, 0.45, 30)}${f(160, 220, 0.85, -12)}${f(10, 240, 0.4, 20)}${f(300, 250, 0.35, 5)}</pattern>`
    + '<radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset=".4" stop-color="#0b2a55" stop-opacity="0"/><stop offset="1" stop-color="#04112a" stop-opacity=".85"/></radialGradient></defs>'
    + '<rect width="1600" height="900" fill="#164a86"/><rect width="1600" height="900" fill="url(#p)" opacity=".75"/><rect width="1600" height="900" fill="url(#v)"/>',
    ' preserveAspectRatio="xMidYMid slice"');
}

export const WALLPAPERS = [
  { id: 'snowy-pines', name: 'Snowy Pines', blurb: 'A moonlit hillside of pines under fresh snow.', svg: wpSnowyPines },
  { id: 'northern-lights', name: 'Northern Lights', blurb: 'Green and violet light over snowy peaks and a still lake.', svg: wpNorthernLights },
  { id: 'cocoa-window', name: 'Cocoa by the Window', blurb: 'A warm mug, string lights and snow falling outside.', svg: wpCocoaWindow },
  { id: 'snowflakes', name: 'Snowflakes', blurb: 'Six-armed flakes on a deep winter blue.', svg: wpSnowflakes },
];

/* ---------------- notification tones: their badge ---------------- */
const toneBadge = (bg, glyph) => S100(`<circle cx="50" cy="50" r="44" fill="${bg}"/>${glyph}`);
const BELL = '<path d="M50 22c-12 0-20 9-20 22v14l-7 9h54l-7-9V44c0-13-8-22-20-22z" fill="#fff4cf" stroke="#b9780b" stroke-width="3"/><circle cx="50" cy="72" r="6" fill="#e2b84f"/>';
const NOTE = '<path d="M42 70V30l28-6v40" fill="none" stroke="#fff" stroke-width="5"/><ellipse cx="36" cy="70" rx="8" ry="6" fill="#fff"/><ellipse cx="64" cy="64" rx="8" ry="6" fill="#fff"/>';
export const SOUNDS = [
  /* three round bells hanging on a leather strap */
  { id: 'sleigh-bells', name: 'Sleigh bells', svg: () => toneBadge('#c8323c',
    '<path d="M14 36q36 20 72 0" fill="none" stroke="#5a2a10" stroke-width="7" stroke-linecap="round"/>'
    + [[30, 52], [50, 60], [70, 52]].map(([x, y]) => `<path d="M${x} ${y - 13}v4" stroke="#8a5a0b" stroke-width="3"/>`
      + `<circle cx="${x}" cy="${y}" r="10.5" fill="#f2c94c" stroke="#a8742a" stroke-width="2"/>`
      + `<path d="M${x - 6} ${y + 3}h12" stroke="#7a4a08" stroke-width="2.4" stroke-linecap="round"/><circle cx="${x - 3.5}" cy="${y - 4}" r="2.4" fill="#fff6c7"/>`).join('')) },
  { id: 'music-box', name: 'Music box', svg: () => toneBadge('#2f6a9c', NOTE) },
  { id: 'carol-bells', name: 'Carol bells', svg: () => toneBadge('#2f8a57', BELL) },
  { id: 'icicle-chimes', name: 'Icicle chimes', svg: () => toneBadge('#5fb0e8', '<path d="M30 26h40" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M36 28v30l-3 8M50 28v40l-3 8M64 28v24l-3 8" stroke="#eaf7ff" stroke-width="5" stroke-linecap="round"/>') },
];

export default { STICKERS, CURSORS, WALLPAPERS, SOUNDS };
