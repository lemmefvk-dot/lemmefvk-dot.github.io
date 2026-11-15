/* ============================================================
   useart.js — "Use this art": a picture from a game's or a title's
   page, as the wallpaper.

   The button sits with the other actions on a game's page
   (js/portal/games.js) and an anime or manga title's page
   (js/portal/anime.js). It does not copy or re-host anything: the
   wallpaper keeps the picture's own address, so it is shown the way
   the page itself shows it, from the site that publishes it. The
   picture is opened first, and if it can't be loaded the wallpaper is
   left as it was and the person is told. The site it came from is
   kept with the wallpaper (portal.wallpapers, `by`), and a wallpaper
   added this way can be removed in Settings › Wallpaper like any other.

     useArtButton(api, { title, url })  -> the button
     useArt(api, { title, url })        -> the wallpaper entry, or throws
   ============================================================ */
import * as WP from './wallpapers.js';

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

function loads(url, ms = 12000) {
  return new Promise(resolve => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => resolve(false), ms);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}

export async function useArt(api, { title, url } = {}) {
  const clean = String(url || '').trim();
  if (!/^https:\/\//i.test(clean)) throw new Error('This page has no picture to use.');
  if (!(await loads(clean))) throw new Error('That picture wouldn’t load, so your wallpaper is unchanged.');
  const entry = WP.addArt(api.store, { name: String(title || 'Art').slice(0, 60), url: clean, by: hostOf(clean) });
  WP.setActive(api.store, entry.id);
  api.bus.emit('wallpaper:changed');
  return entry;
}

export function useArtButton(api, { title, url } = {}) {
  const { h, icon } = api;
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  const b = h('button.btn', { type: 'button', dataset: { fk: 'use-art' } }, icon('wallpaper'), h('span', { text: 'Use this art' }));
  const label = t => { b.querySelector('span').textContent = t; };
  b.addEventListener('click', async () => {
    b.disabled = true; label('Opening…');
    try {
      const w = await useArt(api, { title, url });
      label('It’s your wallpaper');
      api.notify({ icon: 'wallpaper', title: 'Wallpaper set', message: `${w.name}${w.by ? ` — picture from ${w.by}` : ''}. Settings › Wallpaper removes it.`, timeout: 5000 });
    } catch (e) {
      label('Use this art');
      api.notify({ icon: 'wallpaper', title: 'Couldn’t use that picture', message: e.message, timeout: 5000 });
    }
    b.disabled = false;
  });
  return b;
}

export default { useArt, useArtButton };
