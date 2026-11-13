/* ============================================================
   stickerpack.js — "Sticker Pack": 30 desktop stickers, all drawn here.

   Every one is an original design in code (inline SVG, nothing fetched,
   no characters or logos from anywhere): a flat, bold shape with a dark
   line, cut out with a white sticker edge. They go on the same desktop
   layer as the Halloween and winter stickers (js/core/halloween.js
   placeSticker, js/shell/halloween-fun.js draws and drags them), so they
   drag, survive a reload and come off the same way.

   This module is only imported when the picker opens (Settings › Desktop
   › Desktop stickers) or when a pack sticker is on the desktop — start-up
   does not pay for the art. ids are 'pp-…'; PACK_ID matches them.
   ============================================================ */

export const PACK_ID = /^pp-[a-z0-9-]+$/;

const K = 'stroke="#1b1426" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
/* the white die-cut edge every sticker gets */
const EDGE = '<filter id="e" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="3.2" result="d"/>'
  + '<feFlood flood-color="#fffaf3"/><feComposite in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${EDGE}</defs><g filter="url(#e)" transform="translate(50 50) scale(.9) translate(-50 -50)">${body}</g></svg>`;

const C = {
  red: '#ff456d', pink: '#ff9fc4', orange: '#ff8f3d', yellow: '#ffd451', green: '#5fd38d', teal: '#2dd4bf',
  blue: '#5ea0ff', purple: '#b08cff', ink: '#1b1426', cream: '#fff4e6', grey: '#c9d3e6', brown: '#d9a066',
};

/** a pixel picture: rows of letters, each letter a colour */
const pixels = (rows, colors, cell = 10) => {
  const w = rows[0].length, ox = (100 - w * cell) / 2, oy = (100 - rows.length * cell) / 2;
  let out = '';
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (colors[ch]) out += `<rect x="${ox + x * cell}" y="${oy + y * cell}" width="${cell + 0.4}" height="${cell + 0.4}" fill="${colors[ch]}"/>`;
  }));
  return out;
};
const rot = (n, f) => Array.from({ length: n }, (_, i) => f(i, (360 / n) * i)).join('');

export const STICKERS = [
  { id: 'pp-rocket', name: 'Rocket', svg: () => wrap(
    `<path d="M42 66Q50 96 58 66Z" fill="${C.orange}" ${K}/>`
    + `<path d="M34 52 18 72 34 68zM66 52l16 20-16-4z" fill="${C.red}" ${K}/>`
    + `<path d="M50 6C68 20 72 42 66 66H34C28 42 32 20 50 6z" fill="#f4f1ff" ${K}/>`
    + `<circle cx="50" cy="37" r="8" fill="${C.blue}" ${K}/>`) },
  { id: 'pp-planet', name: 'Ringed planet', svg: () => wrap(
    `<circle cx="50" cy="50" r="24" fill="${C.purple}" ${K}/><circle cx="42" cy="42" r="4" fill="#9a74e8"/><circle cx="58" cy="58" r="6" fill="#9a74e8"/>`
    + `<ellipse cx="50" cy="52" rx="42" ry="11" transform="rotate(-22 50 52)" fill="none" stroke="${C.ink}" stroke-width="10"/>`
    + `<ellipse cx="50" cy="52" rx="42" ry="11" transform="rotate(-22 50 52)" fill="none" stroke="${C.yellow}" stroke-width="5"/>`) },
  { id: 'pp-moon', name: 'Moon and star', svg: () => wrap(
    `<path d="M56 10A40 40 0 1 0 90 62A32 32 0 1 1 56 10Z" fill="${C.yellow}" ${K}/>`
    + `<path d="M72 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="${C.cream}" ${K}/>`) },
  { id: 'pp-sun', name: 'Sunny', svg: () => wrap(
    rot(8, (i, a) => `<path d="M50 8v12" transform="rotate(${a} 50 50)" stroke="${C.orange}" stroke-width="7" stroke-linecap="round"/>`)
    + `<circle cx="50" cy="50" r="26" fill="${C.yellow}" ${K}/>`
    + `<circle cx="41" cy="46" r="3" fill="${C.ink}"/><circle cx="59" cy="46" r="3" fill="${C.ink}"/>`
    + `<path d="M40 57Q50 67 60 57" fill="none" ${K}/><circle cx="35" cy="56" r="4" fill="${C.pink}" opacity=".8"/><circle cx="65" cy="56" r="4" fill="${C.pink}" opacity=".8"/>`) },
  { id: 'pp-cloud', name: 'Little cloud', svg: () => wrap(
    `<path d="M26 74A15 15 0 0 1 26 44A20 20 0 0 1 62 36A17 17 0 0 1 76 74Z" fill="${C.cream}" ${K}/>`
    + `<circle cx="42" cy="58" r="2.8" fill="${C.ink}"/><circle cx="58" cy="58" r="2.8" fill="${C.ink}"/>`
    + `<path d="M46 65Q50 69 54 65" fill="none" ${K}/><circle cx="36" cy="64" r="3.5" fill="${C.pink}"/><circle cx="64" cy="64" r="3.5" fill="${C.pink}"/>`) },
  { id: 'pp-rainbow', name: 'Rainbow', svg: () => wrap(
    ['red', 'orange', 'yellow', 'green', 'blue'].map((c, i) => `<path d="M${12 + i * 7} 74A${38 - i * 7} ${38 - i * 7} 0 0 1 ${88 - i * 7} 74" fill="none" stroke="${C[c]}" stroke-width="8"/>`).join('')
    + `<path d="M8 80a8 8 0 0 1 4-14h12a8 8 0 0 1 0 16zM76 82a8 8 0 0 1 0-16h12a8 8 0 0 1 4 14z" fill="${C.cream}" ${K}/>`) },
  { id: 'pp-bolt', name: 'Lightning bolt', svg: () => wrap(`<path d="M58 6 22 56h22l-8 38 42-54H54z" fill="${C.yellow}" ${K}/>`) },
  { id: 'pp-flame', name: 'Flame', svg: () => wrap(
    `<path d="M50 6C58 28 80 38 78 62C76 82 64 94 50 94C36 94 22 82 22 62C22 48 32 42 36 28C40 36 46 40 46 40C48 30 50 20 50 6Z" fill="${C.orange}" ${K}/>`
    + `<path d="M50 50C56 62 66 66 64 76C62 84 56 88 50 88C44 88 38 84 38 76C38 66 46 60 50 50Z" fill="${C.yellow}" ${K}/>`) },
  { id: 'pp-drop', name: 'Water drop', svg: () => wrap(
    `<path d="M50 6C50 6 80 40 80 62A30 30 0 0 1 20 62C20 40 50 6 50 6Z" fill="${C.blue}" ${K}/>`
    + `<path d="M34 62A16 16 0 0 0 46 78" fill="none" stroke="#e6f0ff" stroke-width="5" stroke-linecap="round"/>`) },
  { id: 'pp-sprout', name: 'Sprout', svg: () => wrap(
    `<path d="M50 72V46" fill="none" ${K}/>`
    + `<path d="M50 52C28 54 16 40 16 24C36 24 50 34 50 52Z" fill="${C.green}" ${K}/><path d="M50 44C54 28 66 20 84 22C84 38 72 48 50 44Z" fill="#7be6a6" ${K}/>`
    + `<path d="M26 70H74L66 94H34Z" fill="${C.orange}" ${K}/><path d="M24 66h52v8H24z" fill="#ffa862" ${K}/>`) },
  { id: 'pp-cactus', name: 'Cactus', svg: () => wrap(
    `<path d="M26 74H74L68 94H32Z" fill="${C.red}" ${K}/>`
    + `<path d="M36 78V30a14 14 0 0 1 28 0V78z" fill="${C.green}" ${K}/>`
    + `<path d="M36 62H28a8 8 0 0 1-8-8V42a6 6 0 0 1 12 0v6h4zM64 52h8a8 8 0 0 0 8-8V36a6 6 0 0 0-12 0v6h-4z" fill="${C.green}" ${K}/>`
    + `<path d="M50 24v44M43 36l-4 2M57 46l4 2M43 58l-4 2" stroke="#2c8a56" stroke-width="2.5" stroke-linecap="round"/>`
    + `<circle cx="50" cy="12" r="5" fill="${C.pink}" ${K}/>`) },
  { id: 'pp-mushroom', name: 'Toadstool', svg: () => wrap(
    `<path d="M36 52H64V76C64 88 36 88 36 76Z" fill="${C.cream}" ${K}/>`
    + `<path d="M10 54C10 26 28 10 50 10C72 10 90 26 90 54Z" fill="${C.teal}" ${K}/>`
    + `<circle cx="32" cy="36" r="6" fill="${C.cream}"/><circle cx="56" cy="26" r="5" fill="${C.cream}"/><circle cx="68" cy="42" r="7" fill="${C.cream}"/>`) },
  { id: 'pp-daisy', name: 'Daisy', svg: () => wrap(
    rot(8, (i, a) => `<ellipse cx="50" cy="27" rx="9" ry="17" transform="rotate(${a} 50 50)" fill="${C.cream}" ${K}/>`)
    + `<circle cx="50" cy="50" r="12" fill="${C.yellow}" ${K}/>`) },
  { id: 'pp-blossom', name: 'Cherry blossom', svg: () => wrap(
    rot(5, (i, a) => `<path d="M50 50C36 40 38 18 46 10Q50 16 54 10C62 18 64 40 50 50Z" transform="rotate(${a} 50 50)" fill="${C.pink}" ${K}/>`)
    + `<circle cx="50" cy="50" r="6" fill="${C.yellow}" ${K}/>`
    + rot(5, (i, a) => `<path d="M50 50V36" transform="rotate(${a + 36} 50 50)" stroke="${C.red}" stroke-width="2.5" stroke-linecap="round"/>`)) },
  { id: 'pp-pizza', name: 'Pizza slice', svg: () => wrap(
    `<path d="M50 94 10 24Q50 4 90 24Z" fill="${C.yellow}" ${K}/>`
    + `<path d="M8 22Q50 0 92 22L88 32Q50 14 12 32Z" fill="${C.brown}" ${K}/>`
    + `<circle cx="42" cy="42" r="6" fill="${C.red}" ${K}/><circle cx="60" cy="48" r="5.5" fill="${C.red}" ${K}/><circle cx="50" cy="68" r="5" fill="${C.red}" ${K}/>`) },
  { id: 'pp-donut', name: 'Donut', svg: () => wrap(
    `<path fill-rule="evenodd" d="M50 10a40 40 0 1 0 .01 0zM50 40a10 10 0 1 1-.01 0z" fill="${C.brown}" ${K}/>`
    + `<path fill-rule="evenodd" d="M50 16C72 16 86 32 84 50C82 70 66 84 50 84C32 84 16 70 16 50C16 32 30 16 50 16ZM50 40a10 10 0 1 0 .01 0z" fill="${C.pink}" ${K}/>`
    + `<path d="M30 30l6 4M64 26l-2 7M72 54l7 2M26 58l6-3M50 74l-1-7M38 22l1 5" stroke="${C.yellow}" stroke-width="4" stroke-linecap="round"/>`) },
  { id: 'pp-icecream', name: 'Ice cream', svg: () => wrap(
    `<path d="M28 50 50 94 72 50Z" fill="${C.brown}" ${K}/><path d="M36 62l20 10M44 50l18 28M56 50l-14 28" stroke="#b5793d" stroke-width="2" fill="none"/>`
    + `<circle cx="50" cy="40" r="22" fill="${C.pink}" ${K}/><path d="M30 46a8 8 0 0 0 14 4 8 8 0 0 0 12 0 8 8 0 0 0 14-4" fill="${C.cream}" ${K}/>`
    + `<circle cx="50" cy="16" r="6" fill="${C.red}" ${K}/><path d="M50 10Q54 4 60 4" fill="none" ${K}/>`) },
  { id: 'pp-mug', name: 'Coffee mug', svg: () => wrap(
    `<path d="M70 42h6a10 10 0 0 1 0 22H68" fill="none" stroke="${C.ink}" stroke-width="9"/><path d="M70 42h6a10 10 0 0 1 0 22H68" fill="none" stroke="${C.cream}" stroke-width="4"/>`
    + `<path d="M20 36H72V68a20 20 0 0 1-20 20H40A20 20 0 0 1 20 68Z" fill="${C.red}" ${K}/><ellipse cx="46" cy="36" rx="26" ry="5" fill="#7a4a2a" ${K}/>`
    + `<path d="M34 24c-4-5 4-8 0-14M48 24c-4-5 4-8 0-14M62 24c-4-5 4-8 0-14" fill="none" stroke="${C.cream}" stroke-width="3.5" stroke-linecap="round"/>`
    + `<path d="M32 56l6 6-6 6" fill="none" stroke="${C.cream}" stroke-width="3.5"/>`) },
  { id: 'pp-boba', name: 'Bubble tea', svg: () => wrap(
    `<path d="M58 4 50 36" stroke="${C.ink}" stroke-width="9" stroke-linecap="round"/><path d="M58 4 50 36" stroke="${C.red}" stroke-width="4.5" stroke-linecap="round"/>`
    + `<path d="M24 34H76L68 92H32Z" fill="#f6efff" ${K}/><path d="M27 52H73L67 90H33Z" fill="${C.brown}"/>`
    + `<ellipse cx="50" cy="34" rx="26" ry="6" fill="${C.cream}" ${K}/>`
    + [[40, 82], [52, 84], [60, 79], [46, 73], [56, 68], [38, 66]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.4" fill="${C.ink}"/>`).join('')) },
  { id: 'pp-gamepad', name: 'Game controller', svg: () => wrap(
    `<path d="M24 32H76C88 32 94 46 92 62C90 78 80 84 72 76L66 68H34L28 76C20 84 10 78 8 62C6 46 12 32 24 32Z" fill="${C.blue}" ${K}/>`
    + `<path d="M30 44v16M22 52h16" stroke="${C.cream}" stroke-width="6" stroke-linecap="round"/>`
    + `<circle cx="68" cy="46" r="5" fill="${C.yellow}" ${K}/><circle cx="78" cy="56" r="5" fill="${C.red}" ${K}/>`) },
  { id: 'pp-pixelheart', name: 'Pixel heart', svg: () => wrap(pixels([
    '.XX.XX.', 'XWXXXXX', 'XWXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...',
  ], { X: C.red, W: '#ffd0da' }, 12)) },
  { id: 'pp-cassette', name: 'Cassette tape', svg: () => wrap(
    `<rect x="8" y="22" width="84" height="56" rx="7" fill="${C.purple}" ${K}/><rect x="18" y="30" width="64" height="26" rx="4" fill="${C.cream}" ${K}/>`
    + `<circle cx="36" cy="43" r="7" fill="${C.ink}"/><circle cx="64" cy="43" r="7" fill="${C.ink}"/><circle cx="36" cy="43" r="3" fill="${C.cream}"/><circle cx="64" cy="43" r="3" fill="${C.cream}"/>`
    + `<path d="M26 78l5-14h38l5 14z" fill="${C.grey}" ${K}/><circle cx="40" cy="70" r="2" fill="${C.ink}"/><circle cx="60" cy="70" r="2" fill="${C.ink}"/>`) },
  { id: 'pp-headphones', name: 'Headphones', svg: () => wrap(
    `<path d="M20 62C20 14 80 14 80 62" fill="none" stroke="${C.ink}" stroke-width="13" stroke-linecap="round"/><path d="M20 62C20 14 80 14 80 62" fill="none" stroke="${C.yellow}" stroke-width="7" stroke-linecap="round"/>`
    + `<rect x="10" y="54" width="22" height="34" rx="9" fill="${C.red}" ${K}/><rect x="68" y="54" width="22" height="34" rx="9" fill="${C.red}" ${K}/>`
    + `<rect x="15" y="62" width="6" height="18" rx="3" fill="#ffb3c3"/><rect x="79" y="62" width="6" height="18" rx="3" fill="#ffb3c3"/>`) },
  { id: 'pp-floppy', name: 'Floppy disk', svg: () => wrap(
    `<path d="M12 10H76L90 24V90H12Z" fill="${C.blue}" ${K}/><rect x="28" y="10" width="40" height="26" rx="2" fill="${C.grey}" ${K}/><rect x="56" y="15" width="8" height="16" rx="1" fill="${C.ink}"/>`
    + `<rect x="22" y="52" width="56" height="38" rx="3" fill="${C.cream}" ${K}/><path d="M30 64h40M30 74h28" stroke="#9aa6c0" stroke-width="3" stroke-linecap="round"/>`) },
  { id: 'pp-plane', name: 'Paper plane', svg: () => wrap(
    `<path d="M8 46 92 10 62 90 48 58Z" fill="${C.cream}" ${K}/><path d="M48 58 92 10" fill="none" ${K}/><path d="M48 58 52 80 62 90Z" fill="${C.grey}" ${K}/>`) },
  { id: 'pp-sparkle', name: 'Sparkles', svg: () => wrap(
    `<path d="M44 8C47 36 58 46 86 50C58 54 47 64 44 92C41 64 30 54 2 50C30 46 41 36 44 8Z" transform="translate(6 0)" fill="${C.yellow}" ${K}/>`
    + `<path d="M78 8c1 8 4 11 12 12-8 1-11 4-12 12-1-8-4-11-12-12 8-1 11-4 12-12z" fill="${C.pink}" ${K}/>`
    + `<path d="M80 68c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" fill="${C.cream}" ${K}/>`) },
  { id: 'pp-crown', name: 'Crown', svg: () => wrap(
    `<path d="M12 76 8 28 32 50 50 16 68 50 92 28 88 76Z" fill="${C.yellow}" ${K}/><rect x="12" y="76" width="76" height="12" rx="3" fill="${C.orange}" ${K}/>`
    + `<circle cx="8" cy="26" r="5" fill="${C.red}" ${K}/><circle cx="50" cy="14" r="5" fill="${C.teal}" ${K}/><circle cx="92" cy="26" r="5" fill="${C.red}" ${K}/>`
    + `<circle cx="50" cy="62" r="6" fill="${C.pink}" ${K}/>`) },
  { id: 'pp-gem', name: 'Gem', svg: () => wrap(
    `<path d="M26 14H74L96 38 50 92 4 38Z" fill="${C.teal}" ${K}/><path d="M4 38H96M26 14 38 38 50 92 62 38 74 14M38 38 50 14 62 38" fill="none" stroke="#e9fffb" stroke-width="2.6" stroke-linejoin="round" opacity=".85"/>`) },
  { id: 'pp-cool', name: 'Cool face', svg: () => wrap(
    `<circle cx="50" cy="50" r="40" fill="${C.yellow}" ${K}/>`
    + `<path d="M18 40H82V46C82 56 74 60 66 60C58 60 54 54 52 46H48C46 54 42 60 34 60C26 60 18 56 18 46Z" fill="${C.ink}" ${K}/>`
    + `<path d="M32 70Q50 86 68 70" fill="none" ${K}/><path d="M26 42l10-2M60 41l10-2" stroke="#6a5a7a" stroke-width="2.4" stroke-linecap="round"/>`) },
  { id: 'pp-robot', name: 'Tiny robot', svg: () => wrap(
    `<path d="M50 22V8" ${K} fill="none"/><circle cx="50" cy="8" r="5" fill="${C.red}" ${K}/>`
    + `<rect x="6" y="44" width="10" height="22" rx="3" fill="${C.purple}" ${K}/><rect x="84" y="44" width="10" height="22" rx="3" fill="${C.purple}" ${K}/>`
    + `<rect x="16" y="22" width="68" height="62" rx="14" fill="${C.grey}" ${K}/>`
    + `<circle cx="36" cy="46" r="9" fill="${C.ink}"/><circle cx="64" cy="46" r="9" fill="${C.ink}"/><circle cx="36" cy="46" r="5" fill="${C.teal}"/><circle cx="64" cy="46" r="5" fill="${C.teal}"/>`
    + `<rect x="34" y="64" width="32" height="10" rx="3" fill="${C.cream}" ${K}/><path d="M42 64v10M50 64v10M58 64v10" stroke="${C.ink}" stroke-width="2"/>`) },
];

const byId = new Map(STICKERS.map(s => [s.id, s]));
export const find = id => byId.get(id) || null;

const urls = new Map();
export function artUrl(id) {
  if (!urls.has(id)) {
    const s = byId.get(id);
    urls.set(id, s ? `data:image/svg+xml;utf8,${encodeURIComponent(s.svg())}` : '');
  }
  return urls.get(id);
}

export default { STICKERS, PACK_ID, find, artUrl };
