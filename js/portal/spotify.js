/* ============================================================
   spotify.js — real Spotify, through the official embed.

   Spotify publishes an embed player at open.spotify.com/embed/…
   that is designed to be iframed (verified: 200, no
   X-Frame-Options). It plays 30-second previews for anyone, and
   full tracks when the viewer is signed in to Spotify in the
   same browser — that is Spotify's own rule, not ours, and no
   token or key is involved.

   What that also means, honestly: the frame is cross-origin, so
   Static cannot read what is playing out of it. The desktop's
   Now Playing widget stays on the local player rather than
   pretending to mirror Spotify.
   ============================================================ */

const KEY = 'portal.spotify';

/** Anything you can paste: a link, a URI, or a bare id with a kind. */
export function parseLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  /* spotify:playlist:37i9… */
  const uri = s.match(/^spotify:(track|album|playlist|artist|show|episode):([A-Za-z0-9]+)/i);
  if (uri) return { kind: uri[1].toLowerCase(), id: uri[2] };

  /* https://open.spotify.com/playlist/37i9…?si=… */
  const url = s.match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/i);
  if (url) return { kind: url[1].toLowerCase(), id: url[2] };

  /* a bare id is ambiguous, so only accept it with an explicit kind */
  return null;
}

export const embedUrl = ({ kind, id }, { theme = 0 } = {}) =>
  `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}?utm_source=generator&theme=${theme}`;

export const openUrl = ({ kind, id }) => `https://open.spotify.com/${kind}/${encodeURIComponent(id)}`;

/** Compact players are right for a single track; collections want room. */
export const isCollection = kind => kind === 'playlist' || kind === 'album' || kind === 'artist' || kind === 'show';

/* Public Spotify identifiers only — every title, cover and note comes from
   Spotify's own player at render time. */
export const STARTERS = [
  { kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M', name: "Today's Top Hits" },
  { kind: 'playlist', id: '37i9dQZEVXbMDoHDwVN2tF', name: 'Global Top 50' },
  { kind: 'playlist', id: '37i9dQZF1DX0XUsuxWHRQd', name: 'RapCaviar' },
  { kind: 'playlist', id: '37i9dQZF1DWXRqgorJj26U', name: 'Rock Classics' },
  { kind: 'playlist', id: '37i9dQZF1DX4sWSpwq3LiO', name: 'Peaceful Piano' },
  { kind: 'playlist', id: '37i9dQZF1DWWQRwui0ExPn', name: 'Lo-Fi Beats' },
];

export const saved = store => {
  const v = store.get(KEY);
  return Array.isArray(v) ? v.filter(x => x && x.kind && x.id) : [];
};

export function save(store, item) {
  const rows = saved(store);
  if (rows.some(r => r.kind === item.kind && r.id === item.id)) return rows;
  rows.unshift({ kind: item.kind, id: item.id, name: item.name || null, at: Date.now() });
  store.set(KEY, rows.slice(0, 40));
  return saved(store);
}

export function forget(store, item) {
  const rows = saved(store).filter(r => !(r.kind === item.kind && r.id === item.id));
  store.set(KEY, rows);
  return rows;
}


/* ---------- search ------------------------------------------ *
 * Spotify's own search API needs an OAuth token, which means a
 * client secret, which cannot be kept in a static site — anyone
 * could read it out of the source. So search runs on Apple's
 * catalogue instead: itunes.apple.com/search is keyless, sends
 * access-control-allow-origin: *, and covers essentially the same
 * music.
 *
 * What you get back is real: title, artist, album, artwork, and
 * Apple's own thirty-second preview, which plays here directly.
 * For the full track each result hands off to Spotify — by search
 * URL rather than by id, because resolving a name to a Spotify id
 * is the very thing that needs the token.
 * ---------------------------------------------------------- */

const SEARCH = 'https://itunes.apple.com/search';

/* Apple serves artwork at whatever size you ask for, and the 100px
   thumbnail in the response is far too small for a card. */
export const artAt = (url, px = 300) =>
  String(url || '').replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${px}x${px}bb.$1`);

const ENTITY = {
  song: 'song',
  album: 'album',
  artist: 'musicArtist',
  podcast: 'podcast',
};

export const KINDS = [
  ['song', 'Songs'],
  ['album', 'Albums'],
  ['artist', 'Artists'],
  ['podcast', 'Podcasts'],
];

function normalise(r, kind) {
  const art = artAt(r.artworkUrl100 || r.artworkUrl60, 300);
  if (kind === 'artist') {
    return { kind, id: String(r.artistId), title: r.artistName || '', artist: '',
      album: r.primaryGenreName || '', art: null, preview: null, year: null,
      spotify: spotifySearch(r.artistName) };
  }
  if (kind === 'podcast') {
    return { kind, id: String(r.collectionId), title: r.collectionName || '',
      artist: r.artistName || '', album: '', art, preview: null,
      year: (r.releaseDate || '').slice(0, 4) || null,
      spotify: spotifySearch(`${r.collectionName} ${r.artistName}`) };
  }
  if (kind === 'album') {
    return { kind, id: String(r.collectionId), title: r.collectionName || '',
      artist: r.artistName || '', album: '', art, preview: null,
      year: (r.releaseDate || '').slice(0, 4) || null,
      tracks: r.trackCount || 0,
      spotify: spotifySearch(`${r.collectionName} ${r.artistName}`) };
  }
  return { kind: 'song', id: String(r.trackId), title: r.trackName || '',
    artist: r.artistName || '', album: r.collectionName || '', art,
    preview: r.previewUrl || null,
    year: (r.releaseDate || '').slice(0, 4) || null,
    ms: r.trackTimeMillis || 0,
    spotify: spotifySearch(`${r.trackName} ${r.artistName}`) };
}

/** Spotify's own search page for a phrase — reached through the proxy. */
export const spotifySearch = phrase =>
  `https://open.spotify.com/search/${encodeURIComponent(String(phrase || '').trim())}`;

/**
 * search(term, {kind, limit, signal}) -> rows
 * Throws with something readable; the caller renders it.
 */
export async function search(term, { kind = 'song', limit = 24, signal } = {}) {
  const q = String(term || '').trim();
  if (!q) return [];
  const entity = ENTITY[kind] || ENTITY.song;
  const url = `${SEARCH}?term=${encodeURIComponent(q)}&entity=${entity}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search is unavailable right now (HTTP ${res.status}).`);
  const data = await res.json();
  return (data.results || [])
    .map(r => normalise(r, kind))
    .filter(r => r.title);
}

export const fmtDur = ms => {
  const t = Math.round((Number(ms) || 0) / 1000);
  return t ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '';
};

export default {
  parseLink, embedUrl, openUrl, isCollection, STARTERS, saved, save, forget, KEY,
  search, spotifySearch, artAt, fmtDur, KINDS,
};
