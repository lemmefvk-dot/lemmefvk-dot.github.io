/* ============================================================
   avatar.js — your profile picture, and the costumes it can wear.

   The picture is one of three things, kept on this device in
   store('portal.profile'):
     { kind: 'builtin', id }      one of the avatars drawn below
     { kind: 'upload', dataUrl }  your own image, cropped to a square
                                  and re-encoded at 256×256 by the
                                  Profile app (never the original file)
     null                         the first letter of your name
   A costume (witch hat, vampire cape, ghost sheet) is drawn on top
   of whichever picture it is. They are available all year; from
   24 October to 1 November the Profile app puts them up front.

   All art here is StaticOS's own: static SVG markup, no scripts, no
   external references, so it is safe to hand to h({ html }).

     BUILTIN, COSTUMES            the art
     normPicture(v)               a stored picture, checked, or null
     normCostume(v)               a known costume id, or 'none'
     isHalloweenSeason(date?)     24 Oct – 1 Nov, local time
     read()                       { picture, costume } from the store
     avatarEl(h, o)               the element: picture + costume layer
   ============================================================ */
import { store } from './store.js';

export const KEY = 'portal.profile';
export const MAX_UPLOAD_CHARS = 140000;   /* a 256×256 WebP/JPEG is ~10–40 KB; this is a ceiling */

const svg = (body, defs = '') =>
  `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const grad = (id, a, b) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const stars = (c = '#fff') =>
  `<g fill="${c}" opacity=".75"><circle cx="14" cy="16" r="1.2"/><circle cx="84" cy="12" r="1.5"/><circle cx="90" cy="38" r="1"/><circle cx="8" cy="46" r="1"/><circle cx="76" cy="26" r=".9"/><circle cx="22" cy="30" r=".8"/></g>`;

/* ---- built-in avatars (ids are stored; never rename one) ------------- */
export const BUILTIN = [
  {
    id: 'robot', name: 'Robot',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-robot)"/>
      <rect x="28" y="82" width="44" height="26" rx="9" fill="#8e9db3"/>
      <line x1="50" y1="30" x2="50" y2="17" stroke="#c3cedc" stroke-width="3"/><circle cx="50" cy="15" r="5" fill="#ff6b81"/>
      <rect x="13" y="46" width="9" height="18" rx="3" fill="#8e9db3"/><rect x="78" y="46" width="9" height="18" rx="3" fill="#8e9db3"/>
      <rect x="21" y="29" width="58" height="50" rx="13" fill="#dfe6ef"/>
      <rect x="27" y="37" width="46" height="25" rx="9" fill="#1b2433"/>
      <circle cx="39" cy="49.5" r="6" fill="#7ef9ff"/><circle cx="61" cy="49.5" r="6" fill="#7ef9ff"/>
      <circle cx="41" cy="47.5" r="2" fill="#fff"/><circle cx="63" cy="47.5" r="2" fill="#fff"/>
      <rect x="37" y="67" width="26" height="6" rx="3" fill="#1b2433"/>
      <path d="M43 67v6M50 67v6M57 67v6" stroke="#dfe6ef" stroke-width="1.6"/>`, grad('avg-robot', '#5eead4', '#1e6f8f')),
  },
  {
    id: 'cat', name: 'Cat',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-cat)"/>
      <path d="M22 50 L27 16 L46 36 Z" fill="#f4a259"/><path d="M78 50 L73 16 L54 36 Z" fill="#f4a259"/>
      <path d="M28 42 L30 24 L41 36 Z" fill="#ffcfd2"/><path d="M72 42 L70 24 L59 36 Z" fill="#ffcfd2"/>
      <ellipse cx="50" cy="60" rx="32" ry="28" fill="#f4a259"/>
      <path d="M38 36 q4 6 0 12 M50 33 v13 M62 36 q-4 6 0 12" stroke="#d9802f" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse cx="38" cy="58" rx="4.5" ry="6.5" fill="#2b1d0e"/><ellipse cx="62" cy="58" rx="4.5" ry="6.5" fill="#2b1d0e"/>
      <circle cx="39.5" cy="55.5" r="1.6" fill="#fff"/><circle cx="63.5" cy="55.5" r="1.6" fill="#fff"/>
      <path d="M46.5 66 h7 l-3.5 4 Z" fill="#e5484d"/>
      <path d="M50 70 q-3 5 -8 3 M50 70 q3 5 8 3" stroke="#2b1d0e" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M30 66 h-14 M30 70 l-13 4 M70 66 h14 M70 70 l13 4" stroke="#fff3e6" stroke-width="1.4" stroke-linecap="round"/>`, grad('avg-cat', '#ff9ac1', '#8b3a8f')),
  },
  {
    id: 'fox', name: 'Fox',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-fox)"/>
      <path d="M17 42 L21 10 L41 32 Z" fill="#f57c2b"/><path d="M83 42 L79 10 L59 32 Z" fill="#f57c2b"/>
      <path d="M22 36 L24 18 L35 31 Z" fill="#3b1d0e"/><path d="M78 36 L76 18 L65 31 Z" fill="#3b1d0e"/>
      <path d="M14 44 Q16 26 50 26 Q84 26 86 44 Q80 62 50 88 Q20 62 14 44 Z" fill="#f57c2b"/>
      <path d="M14 44 Q30 52 42 58 L50 88 Q20 62 14 44 Z M86 44 Q70 52 58 58 L50 88 Q80 62 86 44 Z" fill="#fff4e8"/>
      <ellipse cx="38" cy="50" rx="4" ry="5.5" fill="#2b1d0e"/><ellipse cx="62" cy="50" rx="4" ry="5.5" fill="#2b1d0e"/>
      <circle cx="39.3" cy="48" r="1.4" fill="#fff"/><circle cx="63.3" cy="48" r="1.4" fill="#fff"/>
      <ellipse cx="50" cy="82" rx="5" ry="3.8" fill="#2b1d0e"/>`, grad('avg-fox', '#4ade80', '#14532d')),
  },
  {
    id: 'alien', name: 'Alien',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-alien)"/>${stars()}
      <path d="M40 22 L32 8 M60 22 L68 8" stroke="#7ee081" stroke-width="3" stroke-linecap="round"/>
      <circle cx="32" cy="7" r="4" fill="#c4f7c6"/><circle cx="68" cy="7" r="4" fill="#c4f7c6"/>
      <path d="M50 18 C78 18 84 40 80 58 C76 78 62 92 50 92 C38 92 24 78 20 58 C16 40 22 18 50 18 Z" fill="#7ee081"/>
      <ellipse cx="37" cy="54" rx="9" ry="14" transform="rotate(-28 37 54)" fill="#10131a"/>
      <ellipse cx="63" cy="54" rx="9" ry="14" transform="rotate(28 63 54)" fill="#10131a"/>
      <circle cx="34" cy="49" r="2.6" fill="#fff"/><circle cx="60" cy="49" r="2.6" fill="#fff"/>
      <path d="M44 77 q6 4 12 0" stroke="#10131a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`, grad('avg-alien', '#4c1d95', '#0f0a2e')),
  },
  {
    id: 'slime', name: 'Slime',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-slime)"/>
      <path d="M14 84 Q14 32 50 28 Q86 32 86 84 Q78 92 70 85 Q62 93 54 86 Q46 93 38 86 Q30 93 22 86 Q18 90 14 84 Z" fill="#57e389"/>
      <ellipse cx="34" cy="42" rx="9" ry="5" transform="rotate(-25 34 42)" fill="#fff" opacity=".55"/>
      <circle cx="39" cy="58" r="6.5" fill="#12301d"/><circle cx="61" cy="58" r="6.5" fill="#12301d"/>
      <circle cx="41" cy="56" r="2.2" fill="#fff"/><circle cx="63" cy="56" r="2.2" fill="#fff"/>
      <path d="M42 70 q8 7 16 0" stroke="#12301d" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse cx="31" cy="68" rx="4" ry="2.4" fill="#ff8fab" opacity=".7"/><ellipse cx="69" cy="68" rx="4" ry="2.4" fill="#ff8fab" opacity=".7"/>`, grad('avg-slime', '#60a5fa', '#1e3a8a')),
  },
  {
    id: 'astronaut', name: 'Astronaut',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-astro)"/>${stars()}
      <rect x="24" y="80" width="52" height="28" rx="12" fill="#e9eef5"/>
      <rect x="42" y="84" width="16" height="9" rx="2" fill="#5ea8ff"/>
      <rect x="13" y="43" width="8" height="16" rx="3" fill="#b8c3d3"/><rect x="79" y="43" width="8" height="16" rx="3" fill="#b8c3d3"/>
      <circle cx="50" cy="50" r="32" fill="#e9eef5"/>
      <rect x="27" y="35" width="46" height="32" rx="15" fill="#1d2b4f"/>
      <path d="M33 44 q4 -6 12 -6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>
      <circle cx="64" cy="58" r="2.2" fill="#fff" opacity=".5"/>`, grad('avg-astro', '#1e293b', '#020617')),
  },
  {
    id: 'pumpkin', name: 'Pumpkin',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-pump)"/>
      <path d="M47 30 q-2 -10 6 -14 l3 3 q-5 3 -4 11 Z" fill="#4f7a28"/>
      <ellipse cx="50" cy="60" rx="38" ry="30" fill="#f28c28"/>
      <ellipse cx="36" cy="60" rx="15" ry="29" fill="none" stroke="#d0661a" stroke-width="2.5"/>
      <ellipse cx="64" cy="60" rx="15" ry="29" fill="none" stroke="#d0661a" stroke-width="2.5"/>
      <path d="M30 52 L38 42 L46 52 Z M54 52 L62 42 L70 52 Z" fill="#ffde59"/>
      <path d="M48 56 L52 56 L50 61 Z" fill="#ffde59"/>
      <path d="M28 66 Q50 84 72 66 L66 68 L62 74 L57 69 L50 76 L43 69 L38 74 L34 68 Z" fill="#ffde59"/>`, grad('avg-pump', '#6d28d9', '#1e1033')),
  },
  {
    id: 'panda', name: 'Panda',
    svg: svg(`<rect width="100" height="100" fill="url(#avg-panda)"/>
      <circle cx="25" cy="30" r="11" fill="#222"/><circle cx="75" cy="30" r="11" fill="#222"/>
      <circle cx="50" cy="56" r="32" fill="#fff"/>
      <ellipse cx="37" cy="54" rx="8" ry="11" transform="rotate(30 37 54)" fill="#222"/>
      <ellipse cx="63" cy="54" rx="8" ry="11" transform="rotate(-30 63 54)" fill="#222"/>
      <circle cx="38" cy="53" r="3" fill="#fff"/><circle cx="62" cy="53" r="3" fill="#fff"/>
      <ellipse cx="50" cy="67" rx="5.5" ry="4" fill="#222"/>
      <path d="M50 71 v3 M50 74 q-4 4 -8 1 M50 74 q4 4 8 1" stroke="#222" stroke-width="1.8" fill="none" stroke-linecap="round"/>`, grad('avg-panda', '#86efac', '#0f766e')),
  },
];
const builtinById = new Map(BUILTIN.map(b => [b.id, b]));

/* ---- costumes: drawn over the picture, allowed to spill past its edges ---- */
export const COSTUMES = [
  {
    id: 'witch', name: 'Witch hat',
    svg: `<svg viewBox="0 0 100 100" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <g transform="rotate(-9 50 22)">
        <ellipse cx="50" cy="24" rx="46" ry="10" fill="#21142f" stroke="#0e0716" stroke-width="1.5"/>
        <path d="M27 23 L45 -24 Q49 -36 58 -40 Q66 -42 70 -36 Q61 -34 60 -26 L73 23 Z" fill="#3b2257" stroke="#0e0716" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M50 -10 L54 -2" stroke="#5a3a82" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M29.5 15 L70.5 15 L73 23 L27 23 Z" fill="#f28c28"/>
        <rect x="43" y="13.5" width="14" height="11" rx="1.6" fill="none" stroke="#ffd34d" stroke-width="2.6"/>
        <path d="M63 -14 l1.6 3.4 3.6 .4 -2.7 2.4 .8 3.6 -3.3 -1.9 -3.3 1.9 .8 -3.6 -2.7 -2.4 3.6 -.4 Z" fill="#ffd34d"/>
      </g></svg>`,
  },
  {
    id: 'vampire', name: 'Vampire cape',
    svg: `<svg viewBox="0 0 100 100" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M-6 106 L-6 56 L22 42 L36 82 Z" fill="#8f0f24" stroke="#14080c" stroke-width="2" stroke-linejoin="round"/>
      <path d="M106 106 L106 56 L78 42 L64 82 Z" fill="#8f0f24" stroke="#14080c" stroke-width="2" stroke-linejoin="round"/>
      <path d="M2 60 L20 50 L30 78 M98 60 L80 50 L70 78" stroke="#c2183a" stroke-width="2" fill="none" opacity=".8"/>
      <path d="M-6 106 L-6 82 Q18 76 36 82 L50 102 L64 82 Q82 76 106 82 L106 106 Z" fill="#14080c"/>
      <path d="M36 82 L50 102 L64 82 L50 90 Z" fill="#f4f4f5"/>
      <circle cx="50" cy="94" r="4.6" fill="#f2c94c" stroke="#8a6d1a" stroke-width="1.4"/>
      <circle cx="50" cy="94" r="1.6" fill="#c2183a"/></svg>`,
  },
  {
    id: 'ghost', name: 'Ghost sheet',
    svg: `<svg viewBox="0 0 100 100" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M50 -8 C18 -8 4 18 4 46 L4 106 Q14 96 24 106 Q34 96 44 106 Q54 96 64 106 Q74 96 84 106 Q91 99 96 106 L96 46 C96 18 82 -8 50 -8 Z"
        fill="#f6f3ff" fill-opacity=".9" stroke="#cfc8ea" stroke-width="1.5"/>
      <path d="M24 30 Q20 60 26 96 M76 28 Q82 60 74 96" stroke="#ddd6f3" stroke-width="2" fill="none" stroke-linecap="round"/>
      <ellipse cx="37" cy="44" rx="7.5" ry="10.5" fill="#1a1424"/><ellipse cx="63" cy="44" rx="7.5" ry="10.5" fill="#1a1424"/>
      <ellipse cx="50" cy="67" rx="5.5" ry="7.5" fill="#1a1424" opacity=".88"/></svg>`,
  },
];
const costumeById = new Map(COSTUMES.map(c => [c.id, c]));

/* ---- checks: the store is user-editable, so nothing is trusted ---------- */
const DATA_IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function normPicture(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'builtin' && builtinById.has(v.id)) return { kind: 'builtin', id: v.id };
  if (v.kind === 'upload' && typeof v.dataUrl === 'string' && v.dataUrl.length <= MAX_UPLOAD_CHARS && DATA_IMG.test(v.dataUrl)) {
    return { kind: 'upload', dataUrl: v.dataUrl };
  }
  return null;
}
export const normCostume = v => (costumeById.has(v) ? v : 'none');

/** 24 October to 1 November, inclusive, in local time. */
export function isHalloweenSeason(d = new Date()) {
  const m = d.getMonth();
  const day = d.getDate();
  return (m === 9 && day >= 24) || (m === 10 && day <= 1);
}

export function read() {
  const v = store.get(KEY, null);
  const o = v && typeof v === 'object' ? v : {};
  return { picture: normPicture(o.picture), costume: normCostume(o.costume) };
}

/* gradient ids are document-wide: give every drawn copy its own, so one
   hidden copy can never take the colours away from a visible one */
let seq = 0;
export function builtinSvg(id) {
  const b = builtinById.get(id);
  if (!b) return '';
  const n = ++seq;
  return b.svg.replace(/avg-([a-z]+)/g, `avg-$1-${n}`);
}

/**
 * The avatar element. o = { picture, costume, initial, size, label }
 * picture/costume default to what is saved. A costume of 'none' draws nothing.
 */
export function avatarEl(h, o = {}) {
  const saved = (o.picture === undefined || o.costume === undefined) ? read() : null;
  const picture = o.picture === undefined ? saved.picture : normPicture(o.picture);
  const costume = o.costume === undefined ? saved.costume : normCostume(o.costume);
  const size = Number(o.size) || 64;
  let pic;
  if (picture && picture.kind === 'upload') pic = h('img.av__img', { src: picture.dataUrl, alt: '', draggable: 'false' });
  else if (picture && picture.kind === 'builtin') pic = h('span.av__svg', { html: builtinSvg(picture.id) });
  else pic = h('span.av__letter', { text: String(o.initial || '?').slice(0, 2) });
  const c = costumeById.get(costume);
  return h('span.av', {
    class: [picture ? `av--${picture.kind}` : 'av--letter', c ? `av--cos-${c.id}` : ''].filter(Boolean).join(' '),
    role: o.label ? 'img' : null, 'aria-label': o.label || null,
    style: { '--av': `${size}px` },
    dataset: { costume },
  },
  h('span.av__pic', pic),
  c ? h('span.av__cos', { html: c.svg }) : null);
}

export default { BUILTIN, COSTUMES, KEY, MAX_UPLOAD_CHARS, normPicture, normCostume, isHalloweenSeason, read, avatarEl, builtinSvg };
