/* ============================================================
   piccache.js — game and anime pictures, kept after the first look.

   Static Play, Static Games, Search and Anime show covers from the
   game networks' and MyAnimeList's image servers. Their hosts let
   browsers cache them, but the browser's own cache is shared by
   every site and empties itself as it likes, and does not answer
   offline once a picture is a few days old. So sw.js keeps the
   pictures this person has actually seen — only those a page asked
   for, never a whole catalogue — in a cache of their own, and
   answers from it the next time, also offline.

   Each person keeps their own (profiles.js names the cache, as it
   names their databases); a guest's tab names none, so nothing of
   theirs is kept, and deleting a person deletes theirs. Capped:
   past MAX.count pictures or MAX.bytes, the oldest go first; one
   kept longer than MAX.days is fetched again. A picture its host
   marks no-store or private is never kept, and one from a host
   that doesn't allow it to be read (no CORS) is shown as before,
   without being kept.

     register(sw, { hosts, max })  tell the worker this tab's cache
                                   (js/core/offline.js, at start)
     stats()      -> Promise<{ cache, count, bytes } | null>
   ============================================================ */
import * as profiles from './profiles.js';

export const BASE = 'staticos-pics';
/* where the catalogues' pictures come from (data/games.json, data/anime.json) */
export const HOSTS = ['img.gamepix.com', 'img.gamemonetize.com', 'imgs.crazygames.com', 'www.madkidgames.com', 'www.kodub.com', 'cdn.myanimelist.net'];
export const MAX = { count: 800, bytes: 60 * 1024 * 1024, days: 30 };

/** this tab's cache name, or null: a guest (and the login screen) keeps nothing */
export const cacheName = () => profiles.idbName(BASE);

let last = null;
export function register(sw, { hosts = [], max = MAX } = {}) {
  if (!sw) return;
  last = sw;
  sw.postMessage({ type: 'staticos:pics', cache: cacheName(), hosts: [...HOSTS, ...hosts], max });
}

/** How many pictures this person has kept, and how big they are (asked of the worker). */
export function stats(ms = 3000) {
  const sw = (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) || last;
  if (!sw || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
    sw.postMessage({ type: 'staticos:pics-stats' }, [ch.port2]);
  });
}

export default { BASE, HOSTS, MAX, cacheName, register, stats };
