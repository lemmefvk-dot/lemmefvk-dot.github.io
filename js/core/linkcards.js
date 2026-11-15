/* ============================================================
   linkcards.js — a link to a game, an anime or a Roblox page,
   found in a message, as a small card (Static Social).

   Only pointers to pages this device already has are recognised:
     static://games/<id>  static://anime/<id>  static://roblox/<id>
     <this site>#game=<id>   (what Share to chat writes)
     roblox.com/games/<id>   myanimelist.net/anime/<id>
   The id is looked up in THIS device's own catalogue and the card shows
   THIS device's title, never words from the message. An id the catalogue
   doesn't have makes no card. Nothing is fetched from the link and
   nothing opens until the card's Open button is pressed.

     findLinks(text, max = 3) -> [{ kind: 'game' | 'anime' | 'roblox', id }]
     resolve(link) -> Promise<{ kind, id, title, where, app, url } | null>
   ============================================================ */

const GAME_ID = /^[A-Za-z0-9_-]{1,96}$/;
const NUM = /^\d{1,20}$/;
const KINDS = {
  game: { id: GAME_ID, where: 'Static Games', app: 'aether-games', url: id => `static://games/${id}` },
  anime: { id: /^\d{1,9}$/, where: 'Static Anime', app: 'aether-anime', url: id => `static://anime/${id}` },
  roblox: { id: NUM, where: 'Static Roblox', app: 'aether-roblox', url: id => `static://roblox/${id}` },
};

const PATTERNS = [
  [/static:\/\/games\/([A-Za-z0-9_-]{1,96})/g, 'game'],
  [/static:\/\/anime\/(\d{1,9})/g, 'anime'],
  [/static:\/\/roblox\/(\d{1,20})/g, 'roblox'],
  [/https?:\/\/(?:www\.)?roblox\.com\/games\/(\d{1,20})/g, 'roblox'],
  [/https?:\/\/(?:www\.)?myanimelist\.net\/anime\/(\d{1,9})/g, 'anime'],
];

export function findLinks(text, max = 3) {
  const s = String(text ?? '').slice(0, 2000);
  const hits = [];
  for (const [re, kind] of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) hits.push({ at: m.index, kind, id: m[1] });
  }
  /* this very site's share links: <origin><path>#game=<id> */
  try {
    const base = `${location.origin}${location.pathname}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${base}#game=([A-Za-z0-9_%.~-]{1,120})`, 'g');
    let m;
    while ((m = re.exec(s))) {
      let id = m[1];
      try { id = decodeURIComponent(id); } catch (e) { continue; }
      hits.push({ at: m.index, kind: 'game', id });
    }
  } catch (e) { /* no location */ }
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const K = KINDS[h.kind];
    const key = `${h.kind}:${h.id}`;
    if (!K.id.test(h.id) || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: h.kind, id: h.id });
    if (out.length >= max) break;
  }
  return out;
}

const line = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function resolve(link) {
  const K = link && KINDS[link.kind];
  if (!K || !K.id.test(String(link.id))) return null;
  let title = null;
  try {
    if (link.kind === 'game') {
      const G = await import('../portal/games.data.js');
      await G.load();
      const g = G.byId(link.id);
      title = g ? line(g.title, 80) || g.id : null;
    } else if (link.kind === 'anime') {
      const A = await import('../portal/anime.data.js');
      await A.load('anime');
      const a = A.byId(link.id, 'anime');
      title = a ? line(a.title, 80) || null : null;
    } else {
      const R = await import('../portal/roblox.data.js');
      await R.load();
      const r = R.byId(link.id);
      title = r ? line(r.name, 80) || null : null;
    }
  } catch (e) { title = null; }
  return title ? { kind: link.kind, id: String(link.id), title, where: K.where, app: K.app, url: K.url(String(link.id)) } : null;
}

export default { findLinks, resolve };
