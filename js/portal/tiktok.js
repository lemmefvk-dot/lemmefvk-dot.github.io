/* ============================================================
   portal/tiktok.js — what the TikTok app and Friends both need
   to know about a TikTok link, without opening the app.

   Only links are handled here. Nothing is downloaded, embedded or
   fetched: the app plays videos through TikTok's own embed player,
   and a friend's message is just the video's id (and the @handle
   that was in the link). Saved lists live in the person's store
   (core/profiles.js keeps them per person).
   ============================================================ */

export const KEY = 'portal.tiktok';
export const SAVED_KEY = 'portal.tiktokSaved';
export const WATCHED_KEY = 'portal.tiktokWatched';
export const PREFS_KEY = 'portal.tiktokPrefs';
export const MAX = 200;
export const SAVED_MAX = 500;
export const PASTE_MAX = 25;          /* links taken from one paste */
export const LABEL_MAX = 40;
export const COLLECTION_MAX = 24;

export const tidy = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A TikTok video id is a long numeric snowflake. */
export const idFromUrl = url => {
  const m = String(url).match(/\/(?:video|v|embed(?:\/v2)?)\/(\d{6,25})/);
  return m ? m[1] : null;
};

/** Does this even look like a TikTok link we could resolve? */
export const looksLikeTikTok = url => /^https?:\/\/([a-z0-9-]+\.)?tiktok\.com\//i.test(String(url).trim());

/* The creator handle is right there in a full video link. That is the only
   name we can honestly show: TikTok's oEmbed stopped returning author_name,
   title and thumbnail_url, so anything else would be invented. */
export const handleFromUrl = url => {
  const m = String(url).match(/tiktok\.com\/@([A-Za-z0-9._-]{1,30})/);
  return m ? `@${m[1]}` : null;
};

export const isHandle = s => /^@[A-Za-z0-9._-]{1,30}$/.test(String(s || ''));

/**
 * Links out of whatever was pasted: one per line, several on a line, or even
 * run together by a single-line box that swallowed the line breaks. Text after
 * a link on the same line (up to the next link) is that link's own label.
 * -> [{ url, label }], at most PASTE_MAX, repeats dropped.
 */
export function parseMany(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const parts = line.split(/(?=https?:\/\/)/i);
    for (const part of parts) {
      const m = part.match(/^(https?:\/\/\S+)\s*(.*)$/i);
      if (!m || !looksLikeTikTok(m[1])) continue;
      const url = m[1].replace(/[),.;]+$/, '');
      const key = idFromUrl(url) || url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, label: tidy(m[2], LABEL_MAX) });
      if (out.length >= PASTE_MAX) return out;
    }
  }
  return out;
}

/** The link a video is opened with. */
export const linkOf = v => (v && typeof v.url === 'string' && looksLikeTikTok(v.url) ? v.url : `https://www.tiktok.com/@/video/${v.id}`);

/** One stored video, whatever an older build or a hand edit left there. */
export function normVideo(v, stampKey) {
  if (!v || typeof v.id !== 'string' || !/^\d{6,25}$/.test(v.id)) return null;
  const out = {
    id: v.id,
    url: typeof v.url === 'string' && looksLikeTikTok(v.url) ? v.url : `https://www.tiktok.com/@/video/${v.id}`,
    handle: isHandle(v.handle) ? v.handle : (tidy(v.handle, 32) || null),
    /* only ever a tiktok.com player URL, never arbitrary */
    embedSrc: typeof v.embedSrc === 'string' && v.embedSrc.startsWith('https://www.tiktok.com/player/') ? v.embedSrc : null,
    unverified: !!v.unverified,
  };
  const label = tidy(v.label, LABEL_MAX);
  if (label) out.label = label;
  const col = tidy(v.collection, COLLECTION_MAX);
  if (col) out.collection = col;
  out[stampKey] = typeof v[stampKey] === 'string' && !Number.isNaN(Date.parse(v[stampKey])) ? v[stampKey] : new Date().toISOString();
  return out;
}

export function loadList(store, key, stampKey, max) {
  const raw = store.get(key, null);
  const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.feed) ? raw.feed : []);
  const seen = new Set();
  return rows.map(v => normVideo(v, stampKey)).filter(v => v && !seen.has(v.id) && seen.add(v.id)).slice(0, max);
}

/** Put a video on the Saved shelf without the app being open. -> 'added' | 'had' */
export function addSaved(store, { id, url = '', handle = '', label = '' }) {
  const rows = loadList(store, SAVED_KEY, 'savedAt', SAVED_MAX);
  if (rows.some(v => v.id === id)) return 'had';
  const v = normVideo({ id, url, handle, label, savedAt: new Date().toISOString() }, 'savedAt');
  if (!v) return 'had';
  rows.unshift(v);
  store.set(SAVED_KEY, rows.slice(0, SAVED_MAX));
  return 'added';
}

/** Feed and Saved as plain text, one link per line, then the person's own label. */
export const toLines = list => list.map(v => `${linkOf(v)}${v.label ? ` ${v.label}` : ''}`).join('\n') + (list.length ? '\n' : '');

export default {
  KEY, SAVED_KEY, WATCHED_KEY, PREFS_KEY, MAX, SAVED_MAX, PASTE_MAX, LABEL_MAX, COLLECTION_MAX,
  tidy, idFromUrl, looksLikeTikTok, handleFromUrl, isHandle, parseMany, linkOf, normVideo, loadList, addSaved, toLines,
};
