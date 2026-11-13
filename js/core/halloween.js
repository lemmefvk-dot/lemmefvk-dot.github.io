/* ============================================================
   halloween.js — the spooky season: dates, treats and their art.

   The season is 24 October – 1 November by this device's LOCAL
   date. Outside it nothing seasonal shows or runs (the pumpkin in
   the dock, the "boo" secret, jump scares, the Halloween badges);
   whatever you earned during it stays yours all year.

   Trick-or-treat — the pumpkin in the dock, once per local day:
     a TREAT is one thing you did not have yet, and each is real:
       wallpaper  added to the wallpaper picker (portal.wallpapers)
       cursor     a pointer you can wear (prefs.cursorSkin)
       sticker    a sticker you can put on the desktop
     a TRICK turns the screen upside down for five seconds
     (js/shell/halloween-fun.js does the turning and the toasts).

   State, persisted in the store:
     portal.halloween = {
       days:     { 'YYYY-MM-DD': 'trick' | 'wallpaper:<id>' | 'cursor:<id>' | 'sticker:<id>' },
       owned:    { wallpaper: [id], cursor: [id], sticker: [id] },
       stickers: [{ uid, id, x, y }]       placed on the desktop
     }
     prefs.cursorSkin   'none' or a cursor id you own
     prefs.jumpScares   false unless turned on in Settings → Halloween

   Emits bus 'halloween:trickortreat'
     { kind: 'trick'|'treat'|'done', day, days, treat?, extra? }
   (`days` = how many different days you have trick-or-treated;
   achievements.js counts five of them for a badge).

   All art below is drawn here as SVG — no images are fetched.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as WP from '../portal/wallpapers.js';
/* winter's advent treats (stickers, cursors) share this file's sticker
   layer and cursor plumbing: find(), owns() and artUrl() know them too */
import * as WINTER from './winter.js';

const KEY = 'portal.halloween';
export const TRICK_ODDS = 0.3;          /* a trick roughly one day in three */
export const FLIP_MS = 5000;            /* how long the screen stays upside down */
const MAX_STICKERS = 24;

/* ---------------- dates ---------------- */
const pad = n => String(n).padStart(2, '0');

/** 24 Oct – 1 Nov inclusive, by the local calendar. */
export function inSeason(d = new Date()) {
  const m = d.getMonth();
  const day = d.getDate();
  return (m === 9 && day >= 24) || (m === 10 && day <= 1);
}

/** 'YYYY-MM-DD' in local time — "today" means today where you are. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ---------------- art ---------------- */
export const svgUrl = svg => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const SVG = (vb, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}>${body}</svg>`;

/* A jack-o'-lantern in a 100×100 box: two back lobes, a front lobe,
   rib shading, a stem and a glowing carved face. */
export const PUMPKIN_SYMBOL = '<symbol id="pk" viewBox="0 0 100 100">'
  + '<path d="M47 25c-2-7 0-14 6-18l5 3c-5 4-6 9-4 15z" fill="#4c6a2a"/>'
  + '<ellipse cx="31" cy="60" rx="27" ry="33" fill="#c44d17"/>'
  + '<ellipse cx="69" cy="60" rx="27" ry="33" fill="#c44d17"/>'
  + '<ellipse cx="50" cy="60" rx="27" ry="37" fill="#f07a20"/>'
  + '<ellipse cx="37" cy="60" rx="11" ry="34" fill="#e3691b"/>'
  + '<ellipse cx="63" cy="60" rx="11" ry="34" fill="#e3691b"/>'
  + '<ellipse cx="50" cy="59" rx="8" ry="35" fill="#f8902e"/>'
  + '<g fill="#ffd451">'
  + '<path d="M28 53 37 40 45 53z"/><path d="M55 53 63 40 72 53z"/><path d="M47 63 50 57 53 63z"/>'
  + '<path d="M25 68q25 18 50 0l-3 8-6-3-4 7-6-4-6 6-6-6-6 4-4-7-6 3z"/>'
  + '</g></symbol>';

const GHOST_SYMBOL = '<symbol id="gh" viewBox="0 0 100 100">'
  + '<path d="M18 92V46a32 32 0 0 1 64 0v46q-5.3-8-10.7 0t-10.6 0-10.7 0-10.6 0-10.7 0-10.6 0z" fill="#f5f2ff"/>'
  + '<path d="M66 18a32 32 0 0 1 16 28v46q-5.3-8-10.7 0V48a30 30 0 0 0-5.3-30z" fill="#d9d3f2"/>'
  + '<ellipse cx="39" cy="47" rx="4.5" ry="6.5" fill="#1d1330"/><ellipse cx="61" cy="47" rx="4.5" ry="6.5" fill="#1d1330"/>'
  + '<ellipse cx="50" cy="63" rx="5" ry="6.5" fill="#1d1330"/>'
  + '<circle cx="31" cy="57" r="4" fill="#ff8fb1" opacity=".45"/><circle cx="69" cy="57" r="4" fill="#ff8fb1" opacity=".45"/>'
  + '</symbol>';

/* right wing, mirrored for the left */
const BAT_SYMBOL = '<symbol id="bt" viewBox="0 0 100 60">'
  + '<path id="bw" d="M54 26C66 14 82 10 97 14c-6 6-6 14-4 20-6-4-12-3-16 2-4-5-10-5-14 1-2-4-5-4-9-1z" fill="#150a1e"/>'
  + '<use href="#bw" transform="translate(100 0) scale(-1 1)"/>'
  + '<ellipse cx="50" cy="31" rx="6.5" ry="9.5" fill="#150a1e"/>'
  + '<path d="M44.5 25 45.5 15 50 22 54.5 15 55.5 25z" fill="#150a1e"/>'
  + '<circle cx="47.5" cy="28" r="1.5" fill="#ffd451"/><circle cx="52.5" cy="28" r="1.5" fill="#ffd451"/>'
  + '</symbol>';

/* ---- wallpapers (1600×900, slice to fill) ---- */
function wpPumpkinPatch() {
  const stars = [[120, 90, 1.6], [260, 170, 1.1], [420, 70, 1.4], [560, 140, 1], [700, 60, 1.5], [860, 120, 1.1],
    [960, 210, 1.2], [1460, 110, 1.4], [1540, 260, 1], [1380, 330, 1.2], [80, 300, 1.1], [330, 300, 1.3], [640, 260, 1]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
  return SVG('0 0 1600 900',
    '<defs>'
    + '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0617"/><stop offset=".55" stop-color="#28103a"/><stop offset="1" stop-color="#6e2b1c"/></linearGradient>'
    + '<radialGradient id="m"><stop offset=".52" stop-color="#fff0c8"/><stop offset=".58" stop-color="#ffe0a0" stop-opacity=".38"/><stop offset="1" stop-color="#ffcf80" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="g"><stop offset="0" stop-color="#ffa335" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a00" stop-opacity="0"/></radialGradient>'
    + PUMPKIN_SYMBOL + BAT_SYMBOL
    + '</defs>'
    + '<rect width="1600" height="900" fill="url(#s)"/>'
    + `<g fill="#fff" opacity=".6">${stars}</g>`
    + '<circle cx="1210" cy="250" r="320" fill="url(#m)"/>'
    + '<g fill="#efd6a2" opacity=".55"><circle cx="1170" cy="215" r="22"/><circle cx="1255" cy="290" r="14"/><circle cx="1230" cy="200" r="9"/></g>'
    + '<use href="#bt" x="1010" y="160" width="120" height="72"/><use href="#bt" x="1330" y="120" width="80" height="48"/><use href="#bt" x="880" y="250" width="60" height="36"/>'
    + '<path d="M0 640C300 560 520 600 800 630s520-70 800-30v300H0z" fill="#1e0c23"/>'
    + '<path d="M0 725C260 665 560 705 820 745s520-45 780-25v180H0z" fill="#12060f"/>'
    + '<path d="M60 800c120-50 240 20 360-10s180-70 300-20 260 40 380-10 300-30 440 20" fill="none" stroke="#2f4a20" stroke-width="5" stroke-linecap="round"/>'
    + '<ellipse cx="345" cy="755" rx="170" ry="60" fill="url(#g)"/><ellipse cx="670" cy="770" rx="120" ry="45" fill="url(#g)"/>'
    + '<ellipse cx="1165" cy="790" rx="210" ry="70" fill="url(#g)"/><ellipse cx="1445" cy="790" rx="90" ry="35" fill="url(#g)"/>'
    + '<use href="#pk" x="260" y="610" width="170" height="170"/>'
    + '<use href="#pk" x="610" y="680" width="120" height="120"/>'
    + '<use href="#pk" x="1060" y="630" width="210" height="210"/>'
    + '<use href="#pk" x="1400" y="725" width="90" height="90"/>',
    ' preserveAspectRatio="xMidYMid slice"');
}

function wpHauntedHill() {
  const fence = Array.from({ length: 14 }, (_, i) => {
    const x = 980 + i * 34;
    const y = 598 + i * 4.6;
    return `<path d="M${x} ${y}v-46l5-8 5 8v46z"/>`;
  }).join('');
  return SVG('0 0 1600 900',
    '<defs>'
    + '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04090e"/><stop offset=".6" stop-color="#0f2a32"/><stop offset="1" stop-color="#2b4a40"/></linearGradient>'
    + '<radialGradient id="m"><stop offset=".45" stop-color="#eef7df"/><stop offset=".52" stop-color="#d7ecc8" stop-opacity=".3"/><stop offset="1" stop-color="#9fd0b0" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="w"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".7"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></radialGradient>'
    + BAT_SYMBOL
    + '</defs>'
    + '<rect width="1600" height="900" fill="url(#s)"/>'
    + '<circle cx="390" cy="260" r="330" fill="url(#m)"/>'
    + '<g fill="#cfe3d2" opacity=".07"><ellipse cx="420" cy="380" rx="420" ry="40"/><ellipse cx="1150" cy="300" rx="380" ry="30"/></g>'
    + '<use href="#bt" x="520" y="170" width="110" height="66"/><use href="#bt" x="640" y="250" width="70" height="42"/><use href="#bt" x="250" y="120" width="60" height="36"/>'
    + '<path d="M0 900V710c220-60 420-150 700-170s500 60 900 120v240z" fill="#071015"/>'
    + '<ellipse cx="770" cy="470" rx="230" ry="150" fill="url(#w)" opacity=".5"/>'
    + '<g transform="rotate(-2 770 470)" fill="#060c10">'
    + '<rect x="660" y="400" width="210" height="150"/><path d="M640 404 765 318 890 404z"/>'
    + '<rect x="830" y="330" width="62" height="220"/><path d="M820 334 861 246 902 334z"/>'
    + '<rect x="700" y="330" width="22" height="50"/>'
    + '</g>'
    + '<g transform="rotate(-2 770 470)" fill="#ffcf5a">'
    + '<rect x="690" y="430" width="26" height="34" rx="2"/><rect x="760" y="430" width="26" height="34" rx="2" opacity=".55"/>'
    + '<rect x="848" y="370" width="24" height="30" rx="2"/><rect x="848" y="440" width="24" height="30" rx="2" opacity=".7"/>'
    + '<circle cx="765" cy="378" r="10"/>'
    + '</g>'
    + `<g fill="#071015">${fence}</g>`
    + '<g fill="none" stroke="#071015" stroke-linecap="round">'
    + '<path d="M1300 700c-6-90 4-170-10-250" stroke-width="22"/>'
    + '<path d="M1292 520c-40-30-60-70-110-80M1296 470c30-40 70-50 90-100M1290 560c50-10 90-40 120-30M1186 440c-20-10-30-30-60-30M1384 370c10-20 30-30 40-50" stroke-width="9"/>'
    + '</g>'
    + '<g fill="#bfe0cf" opacity=".06"><ellipse cx="300" cy="820" rx="500" ry="60"/><ellipse cx="1200" cy="860" rx="600" ry="70"/></g>',
    ' preserveAspectRatio="xMidYMid slice"');
}

function wpCandyCorn() {
  const corn = (x, y, r) => `<use href="#cc" x="-28" y="-35" width="56" height="70" transform="translate(${x} ${y}) rotate(${r})"/>`;
  return SVG('0 0 1600 900',
    '<defs>'
    + '<symbol id="cc" viewBox="0 0 40 50"><clipPath id="k"><path d="M20 2c6 0 18 32 18 40 0 6-36 6-36 0 0-8 12-40 18-40z"/></clipPath>'
    + '<g clip-path="url(#k)"><rect width="40" height="50" fill="#fff3df"/><rect y="17" width="40" height="33" fill="#ff8a1c"/><rect y="34" width="40" height="16" fill="#ffd23f"/></g></symbol>'
    + '<pattern id="p" width="300" height="280" patternUnits="userSpaceOnUse">'
    + corn(75, 70, -18) + corn(225, 80, 24) + corn(150, 205, 8) + corn(10, 215, -32) + corn(310, 215, -32)
    + '</pattern>'
    + '<radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset=".45" stop-color="#1a0b1f" stop-opacity="0"/><stop offset="1" stop-color="#07030a" stop-opacity=".88"/></radialGradient>'
    + '</defs>'
    + '<rect width="1600" height="900" fill="#2a1030"/>'
    + '<rect width="1600" height="900" fill="url(#p)" opacity=".9"/>'
    + '<rect width="1600" height="900" fill="url(#v)"/>',
    ' preserveAspectRatio="xMidYMid slice"');
}

/* ---- cursors (32×32, hotspot at the tip: 4 3) ---- */
const ARROW = 'M4 3v22l6-5.5 4 8.5 4.5-2-4-8.5H22z';
const cursorSvg = (fill, stroke, extra = '') => SVG('0 0 32 32',
  `<path d="${ARROW}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>${extra}`,
  ' width="32" height="32"');

/* ---- stickers (each in its own box) ---- */
const sticker = (vb, defs, body) => SVG(vb, `<defs>${defs}</defs>${body}`);

export const WALLPAPERS = [
  { id: 'pumpkin-patch', name: 'Pumpkin Patch', blurb: 'Jack-o’-lanterns glowing under a harvest moon.', svg: wpPumpkinPatch },
  { id: 'haunted-hill',  name: 'Haunted Hill',  blurb: 'A crooked house, a dead tree and bats across the moon.', svg: wpHauntedHill },
  { id: 'candy-corn',    name: 'Candy Corn',    blurb: 'A scatter of candy corn on deep plum.', svg: wpCandyCorn },
];

export const CURSORS = [
  { id: 'pumpkin', name: 'Pumpkin pointer', svg: () => cursorSvg('#ff8a1f', '#2b1100',
    '<path d="M6.3 12.6 7.6 10.6 8.9 12.6z M9.6 13.9 10.9 11.9 12.2 13.9z" fill="#2b1100"/><path d="M6 16.2q3 2 5.8.2" fill="none" stroke="#2b1100" stroke-width="1" stroke-linecap="round"/>') },
  { id: 'ghost', name: 'Ghost pointer', svg: () => cursorSvg('#f6f3ff', '#2a2140',
    '<ellipse cx="7.3" cy="13" rx=".95" ry="1.5" fill="#2a2140"/><ellipse cx="10.4" cy="14.4" rx=".95" ry="1.5" fill="#2a2140"/>') },
  { id: 'witch', name: 'Witching-hour pointer', svg: () => cursorSvg('#140a1c', '#c79bff',
    '<path d="M24.5 4.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill="#ffd451"/>') },
];

export const STICKERS = [
  { id: 'pumpkin', name: 'Jack-o’-lantern', svg: () => sticker('0 0 100 100', PUMPKIN_SYMBOL, '<use href="#pk" width="100" height="100"/>') },
  { id: 'ghost',   name: 'Friendly ghost',  svg: () => sticker('0 0 100 100', GHOST_SYMBOL, '<use href="#gh" width="100" height="100"/>') },
  { id: 'bat',     name: 'Bat',             svg: () => sticker('0 0 100 60', BAT_SYMBOL, '<use href="#bt" width="100" height="60"/>') },
  { id: 'cat', name: 'Black cat', svg: () => sticker('0 0 100 100', '',
    '<path d="M64 88c16 0 22-12 16-22-3-6 2-12 6-10" fill="none" stroke="#140a1c" stroke-width="6" stroke-linecap="round"/>'
    + '<path d="M33 93c-4-19 0-35 17-43 17 8 21 24 17 43z" fill="#140a1c"/>'
    + '<path d="M35 30 34 9l13 13zM65 30 66 9 53 22z" fill="#140a1c"/><circle cx="50" cy="36" r="17" fill="#140a1c"/>'
    + '<ellipse cx="43.5" cy="35" rx="3.6" ry="4.4" fill="#ffd451"/><ellipse cx="56.5" cy="35" rx="3.6" ry="4.4" fill="#ffd451"/>'
    + '<ellipse cx="43.5" cy="35" rx=".9" ry="3.6" fill="#140a1c"/><ellipse cx="56.5" cy="35" rx=".9" ry="3.6" fill="#140a1c"/>'
    + '<path d="M48.5 42h3L50 44z" fill="#ff8fb1"/>') },
  { id: 'candy', name: 'Wrapped candy', svg: () => sticker('0 0 100 60',
    '<clipPath id="cw"><circle cx="50" cy="30" r="17"/></clipPath>',
    '<path d="M36 24 9 9l6 21-6 21 27-15z" fill="#ffb347"/><path d="M64 24l27-15-6 21 6 21-27-15z" fill="#ffb347"/>'
    + '<path d="M36 24 22 16M36 36l-14 8M64 24l14-8M64 36l14 8" stroke="#e08a1e" stroke-width="2"/>'
    + '<circle cx="50" cy="30" r="17" fill="#ff6a1a"/>'
    + '<g clip-path="url(#cw)" fill="#fff" opacity=".85"><path d="M30 26 54 2h8L38 26zM34 46 70 10h8L42 46zM48 58 80 26v8L56 58z"/></g>') },
  { id: 'spider', name: 'Dangling spider', svg: () => sticker('0 0 100 100', '',
    '<path d="M50 0v40" stroke="#d9d4e6" stroke-width="1.5"/>'
    + '<g fill="none" stroke="#1b0f24" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M41 52 27 41l-8 8M40 57l-17-3-8 8M41 62l-16 5-6 10M43 67l-11 9-2 12"/>'
    + '<path d="M59 52l14-11 8 8M60 57l17-3 8 8M59 62l16 5 6 10M57 67l11 9 2 12"/></g>'
    + '<ellipse cx="50" cy="60" rx="12" ry="14" fill="#1b0f24"/><circle cx="50" cy="45" r="7.5" fill="#1b0f24"/>'
    + '<circle cx="47" cy="44" r="1.7" fill="#fff"/><circle cx="53" cy="44" r="1.7" fill="#fff"/>') },
];

const CATALOG = { wallpaper: WALLPAPERS, cursor: CURSORS, sticker: STICKERS };
export const TYPE_LABEL = { wallpaper: 'wallpaper', cursor: 'cursor', sticker: 'sticker' };
const own = (type, id) => (CATALOG[type] || []).find(t => t.id === id) || null;
/* a sticker or cursor from the advent calendar is looked up there */
const isWinter = (type, id) => (type === 'sticker' || type === 'cursor') && !own(type, id) && !!WINTER.find(type, id);
/* The 30-sticker pack (js/core/stickerpack.js) is free for everyone and its art
   is only imported when the picker opens or a pack sticker is on the desktop;
   until then a pack sticker is known by its id alone. */
const PACK_RE = /^pp-[a-z0-9-]+$/;
let PACK = null;
export const isPackSticker = id => PACK_RE.test(String(id || ''));
export const packLoaded = () => !!PACK;
export const loadPack = () => (PACK ? Promise.resolve(PACK) : import('./stickerpack.js').then(m => (PACK = m)));
const packFind = id => (PACK ? PACK.find(id) : { id, name: 'Sticker', svg: null });
export const find = (type, id) => own(type, id) || (isWinter(type, id) ? WINTER.find(type, id) : null)
  || (type === 'sticker' && isPackSticker(id) ? packFind(id) : null);
/** Every cursor that can be worn: Halloween's and winter's. */
export const allCursors = () => [...CURSORS, ...WINTER.CATALOG.cursor];

/* data URLs are built once per item, on first use */
const urls = new Map();
export function artUrl(type, id) {
  if (type === 'sticker' && isPackSticker(id) && !own(type, id)) return PACK ? PACK.artUrl(id) : '';
  const k = `${type}:${id}`;
  if (!urls.has(k)) {
    const t = find(type, id);
    urls.set(k, t ? (isWinter(type, id) ? WINTER.artUrl(type, id) : svgUrl(t.svg())) : '');
  }
  return urls.get(k);
}

/* ---------------- state ---------------- */
const arr = v => (Array.isArray(v) ? v : []);
export function state() {
  const v = store.get(KEY, null) || {};
  const owned = v.owned && typeof v.owned === 'object' ? v.owned : {};
  return {
    days: v.days && typeof v.days === 'object' ? v.days : {},
    owned: { wallpaper: arr(owned.wallpaper), cursor: arr(owned.cursor), sticker: arr(owned.sticker) },
    stickers: arr(v.stickers).filter(s => s && s.uid && (find('sticker', s.id) || userSticker(s))),
  };
}
/* a sticker made in Picture Tools: { uid, user: '<path of the PNG>', w, h, x, y } */
export const userSticker = s => !!(s && typeof s.user === 'string' && s.user);

/* always a NEW object: store.set short-circuits on identity */
const save = next => store.set(KEY, { days: { ...next.days }, owned: { ...next.owned }, stickers: [...next.stickers] });

export const owns = (type, id) => (type === 'sticker' && isPackSticker(id)) || state().owned[type]?.includes(id) || (isWinter(type, id) && WINTER.owns(type, id)) || false;
export const ownedList = type => state().owned[type].map(id => find(type, id)).filter(Boolean);
export const daysCount = () => Object.keys(state().days).length;
export const today = (d = new Date()) => state().days[dayKey(d)] || null;
export const doneToday = (d = new Date()) => !!today(d);

/** What a day's entry means, in words: "a trick", "the Ghost pointer cursor". */
export function describe(entry) {
  if (!entry) return '';
  if (entry === 'trick') return 'a trick';
  const [type, id] = String(entry).split(':');
  const t = find(type, id);
  return t ? `${t.name} (${TYPE_LABEL[type]})` : 'a treat';
}

/* ---- wallpapers go into the real picker ---- */
const wpCode = id => `HALLOWEEN-${id.toUpperCase()}`;
/** The picker id of a Halloween wallpaper you own, or null. */
export function wallpaperId(id) {
  const code = wpCode(id).toLowerCase();
  const hit = WP.custom(store).find(w => String(w.code || '').toLowerCase() === code);
  return hit ? hit.id : null;
}
function addWallpaper(id) {
  const t = find('wallpaper', id);
  if (!t) return null;
  if (!wallpaperId(id)) WP.add(store, { name: t.name, url: svgUrl(t.svg()), kind: 'image', code: wpCode(id), by: 'Trick-or-treat' });
  WP.redeem(store, wpCode(id));
  return wallpaperId(id);
}
export function useWallpaper(id) {
  const wid = wallpaperId(id) || (owns('wallpaper', id) ? addWallpaper(id) : null);
  if (!wid) return false;
  const ok = !!WP.setActive(store, wid);
  if (ok) bus.emit('wallpaper:changed');
  return ok;
}

/* ---- cursors ---- */
export function setCursor(id) {
  const want = id && id !== 'none' && owns('cursor', id) ? id : 'none';
  store.set('prefs.cursorSkin', want);
  return want;
}

/* ---- stickers ---- */
const uid = () => `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
export function placeSticker(id, at = null) {
  if (!owns('sticker', id)) return null;
  const cur = state();
  const vw = typeof innerWidth === 'number' ? innerWidth : 1280;
  const vh = typeof innerHeight === 'number' ? innerHeight : 800;
  const x = at ? at.x : Math.round(vw / 2 - 40 + (Math.random() - 0.5) * Math.min(520, vw * 0.5));
  const y = at ? at.y : Math.round(vh / 2 - 60 + (Math.random() - 0.5) * Math.min(300, vh * 0.4));
  const s = { uid: uid(), id, x: Math.max(8, Math.min(vw - 96, x)), y: Math.max(48, Math.min(vh - 180, y)) };
  const stickers = [...cur.stickers, s].slice(-MAX_STICKERS);
  save({ ...cur, stickers });
  bus.emit('sticker:placed', { id, total: stickers.length });
  return s;
}
/** Put a picture file (a sticker made in Picture Tools) on the desktop as a sticker of its own. */
export function placeUserSticker(path, { w = 120, h = 120, name = '' } = {}, at = null) {
  const cur = state();
  const vw = typeof innerWidth === 'number' ? innerWidth : 1280;
  const vh = typeof innerHeight === 'number' ? innerHeight : 800;
  const x = at ? at.x : Math.round(vw / 2 - w / 2 + (Math.random() - 0.5) * Math.min(400, vw * 0.4));
  const y = at ? at.y : Math.round(vh / 2 - h / 2 + (Math.random() - 0.5) * Math.min(240, vh * 0.3));
  const s = { uid: uid(), user: String(path), name: String(name || ''), w: Math.round(w), h: Math.round(h),
    x: Math.max(8, Math.min(vw - w - 8, x)), y: Math.max(48, Math.min(vh - h - 8, y)) };
  const stickers = [...cur.stickers, s].slice(-MAX_STICKERS);
  save({ ...cur, stickers });
  bus.emit('sticker:placed', { id: 'user', total: stickers.length });
  return s;
}
export function moveSticker(sid, x, y) {
  const cur = state();
  save({ ...cur, stickers: cur.stickers.map(s => (s.uid === sid ? { ...s, x: Math.round(x), y: Math.round(y) } : s)) });
}
export function removeSticker(sid) {
  const cur = state();
  save({ ...cur, stickers: cur.stickers.filter(s => s.uid !== sid) });
}
export function clearStickers() {
  const cur = state();
  save({ ...cur, stickers: [] });
}

/* ---------------- trick or treat ---------------- */
const TREATS = () => [
  ...WALLPAPERS.map(t => ['wallpaper', t]),
  ...CURSORS.map(t => ['cursor', t]),
  ...STICKERS.map(t => ['sticker', t]),
];

/**
 * Knock once. Returns what happened and announces it on the bus:
 *   { kind: 'closed' }                         out of season, nothing happens
 *   { kind: 'done', day, prev }                already knocked today
 *   { kind: 'trick', day, days }
 *   { kind: 'treat', day, days, treat: { type, id, name }, extra }
 * `rand` is injectable so the odds can be tested; it defaults to Math.random.
 */
export function trickOrTreat({ now = new Date(), rand = Math.random } = {}) {
  if (!inSeason(now)) return { kind: 'closed' };
  const day = dayKey(now);
  const cur = state();
  if (cur.days[day]) {
    const r = { kind: 'done', day, prev: cur.days[day], days: Object.keys(cur.days).length };
    bus.emit('halloween:trickortreat', r);
    return r;
  }
  let r;
  if (rand() < TRICK_ODDS) {
    cur.days = { ...cur.days, [day]: 'trick' };
    save(cur);
    r = { kind: 'trick', day };
  } else {
    const pool = TREATS().filter(([type, t]) => !cur.owned[type].includes(t.id));
    /* once you own everything, a treat is one more sticker for the desktop */
    const extra = !pool.length;
    const [type, t] = extra
      ? ['sticker', STICKERS[Math.floor(rand() * STICKERS.length) % STICKERS.length]]
      : pool[Math.floor(rand() * pool.length) % pool.length];
    if (!cur.owned[type].includes(t.id)) cur.owned = { ...cur.owned, [type]: [...cur.owned[type], t.id] };
    cur.days = { ...cur.days, [day]: `${type}:${t.id}` };
    save(cur);
    if (type === 'wallpaper') addWallpaper(t.id);
    r = { kind: 'treat', day, treat: { type, id: t.id, name: t.name }, extra };
  }
  r.days = Object.keys(state().days).length;
  bus.emit('halloween:trickortreat', r);
  return r;
}

export default {
  inSeason, dayKey, trickOrTreat, state, owns, ownedList, daysCount, today, doneToday, describe,
  useWallpaper, wallpaperId, setCursor, placeSticker, placeUserSticker, moveSticker, removeSticker, clearStickers,
  artUrl, find, WALLPAPERS, CURSORS, STICKERS, TRICK_ODDS, FLIP_MS,
};
