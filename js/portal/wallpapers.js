/* ============================================================
   wallpapers.js — what the desktop shows behind everything.

   Four kinds:
     'scene'  the built-in procedural layers (pure CSS, no files)
     'video'  a looping muted <video> — mp4 / webm
     'gif'    an animated GIF, painted as a background layer
     'image'  a still png / jpg / webp / avif / svg
   (and two built-in ones: 'css', a gradient; 'daycycle', the Day and
   Night scene whose light follows the clock — core/daycycle.js)

   Anything with a URL can be added at runtime, and an entry can
   be put behind an unlock CODE: it stays hidden in the picker
   until the code is typed, then it is saved as unlocked.

   Everything lives in `store` (persisted), so a wallpaper added
   once survives reloads:
     wallpaper            -> the active id
     portal.wallpapers    -> [{id,name,url,kind,code,by}]
     portal.wpUnlocked    -> [id, …]
   ============================================================ */

import * as THEMES from '../core/themes.js';
import * as DAY from '../core/daycycle.js';

/* Exported because the shell subscribes to them by name:
   js/shell/desktop.js does store.sub(WP.ACTIVE_KEY, …) so the desktop
   repaints the moment a wallpaper changes. Left unexported these read as
   undefined and the subscription silently watches nothing. */
export const LIST_KEY = 'portal.wallpapers';
const UNLOCK_KEY = 'portal.wpUnlocked';
export const ACTIVE_KEY = 'wallpaper';

/* Built-ins are generated, not files: nothing to download, and they
   re-tint themselves when the accent changes. */
export const BUILT_IN = [
  /* The default. The clips below are served from this site as 1080p H.264:
     the originals on giphy are ~500x280, which a desktop stretches into mush.
     Canopy, Lamplight and Sakura Moon were AI-upscaled frame by frame
     (Real-ESRGAN, anime-video model); Earthrise is giphy's own 1080p source.
     A <video> decodes on the GPU where an animated GIF is repainted on the
     main thread, and the giphy GIF stays as the fallback for anything that
     refuses the video. `poster` paints the first frame before it loads. */
  { id: 'canopy', name: 'Canopy', kind: 'video', built: true,
    url: 'assets/wallpapers/canopy.mp4',
    poster: 'assets/wallpapers/canopy.jpg',
    fallback: 'https://i.giphy.com/media/SnVZO1N0Wo6u4/giphy.gif',
    blurb: 'Moving leaves. The default.' },
  /* Three clips that each bring a theme with them: picking one of these
     also sets the accent it names (see setActive). Same 1080p-first,
     GIF-fallback arrangement as Canopy. */
  { id: 'earthrise', name: 'Earthrise', kind: 'video', built: true, theme: 'moonwalk',
    url: 'assets/wallpapers/earthrise.mp4',
    poster: 'assets/wallpapers/earthrise.jpg',
    fallback: 'https://i.giphy.com/media/RGyUJwAFjP38P3uEiV/giphy.gif',
    blurb: 'Two astronauts watching Earth from the Moon.' },
  { id: 'lamplight', name: 'Lamplight', kind: 'video', built: true, theme: 'nocturne',
    url: 'assets/wallpapers/lamplight.mp4',
    poster: 'assets/wallpapers/lamplight.jpg',
    fallback: 'https://i.giphy.com/media/UC8DbMqXvkpd6/giphy.gif',
    blurb: 'A crescent moon and a streetlamp, in black and white.' },
  { id: 'sakura-moon', name: 'Sakura Moon', kind: 'video', built: true, theme: 'sakura',
    url: 'assets/wallpapers/sakura-moon.mp4',
    poster: 'assets/wallpapers/sakura-moon.jpg',
    fallback: 'https://i.giphy.com/media/FWtVYDHIxgGgE/giphy.gif',
    blurb: 'Cherry blossom drifting past a full moon.' },
  { id: 'aurora', name: 'Aurora Ridge', kind: 'scene', built: true,
    blurb: 'The layered scene: planet, ridgelines, lake.' },
  { id: 'nightfall', name: 'Nightfall', kind: 'css', built: true,
    css: 'radial-gradient(120% 90% at 50% -10%, rgba(var(--accent-rgb)/.30), transparent 60%),'
       + 'radial-gradient(90% 70% at 15% 110%, rgba(var(--accent-rgb)/.16), transparent 62%),'
       + 'linear-gradient(175deg, #1b1020 0%, #140b18 45%, #08050b 100%)' },
  { id: 'ember', name: 'Ember', kind: 'css', built: true,
    css: 'radial-gradient(80% 60% at 70% 20%, rgba(var(--accent-rgb)/.34), transparent 58%),'
       + 'radial-gradient(70% 70% at 20% 80%, rgba(255,140,90,.16), transparent 60%),'
       + 'linear-gradient(200deg, #241019 0%, #150a11 55%, #090509 100%)' },
  { id: 'deepfield', name: 'Deep Field', kind: 'css', built: true,
    css: 'radial-gradient(60% 50% at 30% 30%, rgba(120,140,255,.18), transparent 60%),'
       + 'radial-gradient(70% 60% at 75% 70%, rgba(var(--accent-rgb)/.20), transparent 62%),'
       + 'linear-gradient(160deg, #0d1020 0%, #090a14 50%, #05050a 100%)' },
  { id: 'sunset', name: 'Sunset', kind: 'css', built: true, blurb: 'A warm gradient dusk.',
    css: 'linear-gradient(180deg, #2a1a3e 0%, #57265a 32%, #a83f5b 62%, #e8794b 82%, #f2b24d 100%)' },
  { id: 'mesa', name: 'Mesa', kind: 'css', built: true, blurb: 'Desert light on layered rock.',
    css: 'radial-gradient(90% 60% at 50% 8%, rgba(255,210,140,.35), transparent 55%),'
       + 'linear-gradient(180deg, #3a1c2b 0%, #6d2f34 40%, #a5503a 70%, #cf7b45 100%)' },
  { id: 'tide', name: 'Tide', kind: 'css', built: true, blurb: 'Cool ocean bands.',
    css: 'linear-gradient(200deg, #04223a 0%, #0a3a52 45%, #10606b 75%, #1f8f86 100%)' },
  { id: 'rays', name: 'Rays', kind: 'css', built: true, blurb: 'Soft light rays in the accent.',
    css: 'conic-gradient(from 210deg at 50% 118%, rgba(var(--accent-rgb)/.24), transparent 22%, rgba(var(--accent-rgb)/.12) 50%, transparent 74%, rgba(var(--accent-rgb)/.24)),'
       + 'linear-gradient(180deg, #170a1f 0%, #0a0512 100%)' },
  { id: 'noir', name: 'Noir', kind: 'css', built: true, blurb: 'Near-black with a single soft light.',
    css: 'radial-gradient(60% 45% at 72% 18%, rgba(255,255,255,.10), transparent 55%),'
       + 'linear-gradient(160deg, #141416 0%, #0b0b0d 55%, #060607 100%)' },
  { id: 'moss', name: 'Moss', kind: 'css', built: true, blurb: 'Deep forest green.',
    css: 'radial-gradient(80% 60% at 30% 20%, rgba(120,200,120,.14), transparent 60%),'
       + 'linear-gradient(165deg, #0c1f14 0%, #10301d 50%, #071a10 100%)' },
  { id: 'plum', name: 'Plum', kind: 'css', built: true, blurb: 'Soft violet dusk.',
    css: 'radial-gradient(70% 55% at 60% 25%, rgba(200,140,255,.20), transparent 60%),'
       + 'linear-gradient(160deg, #1c1030 0%, #2a1444 48%, #140a24 100%)' },
  /* The theme packs' wallpapers (js/core/packs.js): original vector art drawn
     by tools/pack-art.mjs, crisp at any size and a few KB each. Each brings
     its pack's accent, like the clips above. */
  { id: 'pack-drive', name: 'Night Drive', kind: 'image', built: true, theme: 'drive',
    url: 'assets/wallpapers/packs/drive.svg', blurb: 'A striped sunset over a neon grid.' },
  { id: 'pack-glacier', name: 'Glacier', kind: 'image', built: true, theme: 'glacier',
    url: 'assets/wallpapers/packs/glacier.svg', blurb: 'Aurora over snowy peaks and a still lake.' },
  { id: 'pack-grove', name: 'Autumn Grove', kind: 'image', built: true, theme: 'grove',
    url: 'assets/wallpapers/packs/grove.svg', blurb: 'Rolling hills at dusk, leaves coming down.' },
  { id: 'pack-abyss', name: 'Deep Sea', kind: 'image', built: true, theme: 'abyss',
    url: 'assets/wallpapers/packs/abyss.svg', blurb: 'Light rays, kelp and a jellyfish.' },
  { id: 'pack-matcha', name: 'Matcha', kind: 'image', built: true, theme: 'matcha',
    url: 'assets/wallpapers/packs/matcha.svg', blurb: 'Raked sand, mossy stones and bamboo.' },
  /* One scene in four lights that follows the clock (js/core/daycycle.js;
     drawn by tools/daycycle-art.mjs). `url` is its daytime look, for the
     picker card. */
  { id: 'daycycle', name: 'Day and Night', kind: 'daycycle', built: true, tag: 'follows the clock',
    url: 'assets/wallpapers/daycycle/day.svg', blurb: 'A lake and a cabin from dawn to night, with your clock.' },
  { id: 'pack-sakura', name: 'Sakura', kind: 'image', built: true, theme: 'sakura',
    url: 'assets/wallpapers/packs/sakura.svg', blurb: 'A blossom branch over a plum dusk, with petals on the air.' },
  { id: 'pack-arcade', name: 'Neon Arcade', kind: 'image', built: true, theme: 'arcade',
    url: 'assets/wallpapers/packs/arcade.svg', blurb: 'Arcade-carpet confetti and glowing pixel pictures.' },
];

const VIDEO_EXT = /\.(mp4|webm|ogv|m4v|mov)(\?|#|$)/i;
const GIF_EXT   = /\.gif(\?|#|$)/i;
const IMG_EXT   = /\.(png|jpe?g|webp|avif|svg|bmp)(\?|#|$)/i;

/** Work out what a URL is, without fetching it. */
export function detectKind(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (GIF_EXT.test(u)) return 'gif';
  if (VIDEO_EXT.test(u)) return 'video';
  if (IMG_EXT.test(u)) return 'image';
  /* giphy/tenor share links resolve to gifs even without an extension */
  if (/giphy\.com|tenor\.com|\.gifv/i.test(u)) return 'gif';
  return 'image';
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/* ------------------------------------------------------------------ */
export const custom = store => {
  const v = store.get(LIST_KEY);
  return Array.isArray(v) ? v.filter(w => w && w.id && w.url) : [];
};
const unlocked = store => {
  const v = store.get(UNLOCK_KEY);
  return Array.isArray(v) ? v : [];
};
export const isUnlocked = (store, w) => !w.code || unlocked(store).includes(w.id);

/** Everything the picker should show: built-ins + unlocked customs. */
export function list(store, { includeLocked = false } = {}) {
  const rows = [...BUILT_IN, ...custom(store)];
  return includeLocked ? rows : rows.filter(w => isUnlocked(store, w));
}

export const byId = (store, id) =>
  [...BUILT_IN, ...custom(store)].find(w => w.id === id) || null;

export function add(store, { name, url, kind, code, by } = {}) {
  const clean = String(url || '').trim();
  if (!clean) throw new Error('A wallpaper needs a URL.');
  if (!/^https?:\/\//i.test(clean) && !clean.startsWith('data:')) {
    throw new Error('Use a full https:// URL.');
  }
  const k = kind || detectKind(clean);
  const title = String(name || '').trim() || clean.split('/').pop().split('?')[0] || 'Wallpaper';
  const rows = custom(store);
  let id = slug(title) || `wp-${rows.length + 1}`;
  while (rows.some(w => w.id === id) || BUILT_IN.some(w => w.id === id)) id += '-2';
  const entry = { id, name: title, url: clean, kind: k, code: code ? String(code).trim() : null, by: by || null };
  rows.push(entry);
  store.set(LIST_KEY, rows);
  if (entry.code) store.set(UNLOCK_KEY, unlocked(store));   // stays locked until redeemed
  return entry;
}

export function remove(store, id) {
  const rows = custom(store).filter(w => w.id !== id);
  store.set(LIST_KEY, rows);
  if (store.get(ACTIVE_KEY) === id) store.set(ACTIVE_KEY, 'aurora');
  return rows;
}

/** Type a code, unlock the wallpaper it belongs to. */
export function redeem(store, code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const hit = custom(store).find(w => w.code && w.code.toLowerCase() === c.toLowerCase());
  if (!hit) return null;
  const done = unlocked(store);
  if (!done.includes(hit.id)) store.set(UNLOCK_KEY, [...done, hit.id]);
  return hit;
}

export const active = store => byId(store, store.get(ACTIVE_KEY)) || BUILT_IN[0];
export function setActive(store, id) {
  const w = byId(store, id);
  if (!w || !isUnlocked(store, w)) return null;
  /* a paired theme goes on first, so anything watching ACTIVE_KEY (the
     boot drive's skin, for one) already sees the new accent — unless the
     accent is Auto, which takes its colour from the wallpaper anyway */
  if (w.theme && THEMES.isTheme(w.theme) && store.get('prefs.accent') !== THEMES.AUTO) {
    store.set('prefs', { ...store.get('prefs', {}), accent: w.theme });
    THEMES.apply(w.theme);
  }
  store.set(ACTIVE_KEY, w.id);
  /* a wallpaper picked by hand ends rotation (core/wprotate.js) — even
     the one already chosen, which changes no key. After the pick, so the
     desktop fades from rotation's picture straight to this one. */
  if (store.get('prefs.wpRotate') === true) store.set('prefs.wpRotate', false);
  return w;
}

/**
 * Build the media layer for a wallpaper, or null for the procedural scene.
 * The caller drops this into the .wp container underneath the overlays.
 */
export function mediaLayer(w, h) {
  if (!w || w.kind === 'scene') return null;

  const base = {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '0', pointerEvents: 'none',
  };

  if (w.kind === 'css') {
    return h('div.wp__preset', { style: { ...base, background: w.css, backgroundSize: 'cover' } });
  }

  if (w.kind === 'daycycle') return DAY.layer(h, base);

  if (w.kind === 'video') {
    /* The clip (up to a megabyte) waits until the desktop is up: during
       start-up it would only compete with StaticOS's own code for a slow
       connection, and the poster — its first frame — looks the same. */
    const ready = typeof document === 'undefined' || document.body?.dataset.ready === '1'
      || !!(typeof window !== 'undefined' && window.__staticBoot && window.__staticBoot.ok);
    const v = h('video.wp__video', {
      src: ready || !w.poster ? w.url : null, poster: w.poster || null, autoplay: true, loop: true, muted: true, playsinline: true,
      preload: 'auto', tabindex: '-1', 'aria-hidden': 'true',
      style: { ...base, objectFit: 'cover' },
    });
    if (!ready && w.poster) {
      window.addEventListener('staticos:ready', () => {
        if (!v.isConnected || v.getAttribute('src')) return;
        v.src = w.url;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      }, { once: true });
    }
    v.muted = true;                       // the attribute alone is not enough in some browsers
    const go = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    v.addEventListener('canplay', go, { once: true });
    /* A codec the browser will not decode fires `error` and leaves a black
       rectangle, which looks exactly like a broken site. Swap to the still
       or GIF form of the same clip instead. */
    if (w.fallback) {
      v.addEventListener('error', () => {
        const img = h('img.wp__still', {
          src: w.fallback, alt: '', 'aria-hidden': 'true',
          style: { ...base, objectFit: 'cover' },
        });
        v.replaceWith(img);
      }, { once: true });
    }
    go();
    return v;
  }

  /* gif and still images both paint fine as a background layer, and a GIF
     keeps animating there */
  return h('div.wp__img', {
    style: {
      ...base,
      backgroundImage: `url("${String(w.url).replace(/"/g, '\\"')}")`,
      backgroundSize: 'cover', backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    },
  });
}

export default {
  BUILT_IN, list, custom, byId, add, remove, redeem, active, setActive,
  isUnlocked, detectKind, mediaLayer, LIST_KEY, UNLOCK_KEY, ACTIVE_KEY,
};
