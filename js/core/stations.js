/* ============================================================
   stations.js — the ONE list of radio stations in StaticOS.

   Music (its Radio tab and the player) and Static Radio used to keep a
   list each, so a station added to one could not be handed to the other.
   Both read this list now, and so does anything that sends or receives a
   station (a friend's "listen to this", a shared playlist's stations):
   a station id is only believed if it is in here.

   Names, genres and descriptions are SomaFM's own, copied from its
   channels.json so the lists read the same offline. SomaFM is an
   independent, listener-supported station in San Francisco with nothing
   to do with StaticOS.

   Streams are SomaFM's documented ones (somafm.com/listen, and the
   playlists its channels.json lists for every channel):
     128 kbps MP3   <id>-128-mp3   (what plays by default)
      64 kbps AAC   <id>-64-aac    (SomaFM's "high" AAC+ playlist)
      32 kbps AAC   <id>-32-aac    (SomaFM's "low" AAC+ playlist)
   The two AAC streams are for slow connections; a browser that can't
   play AAC falls back to the 128 kbps MP3 and says so.

   quality()          the saved choice: '128' | '64' | '32'
   setQuality(q)
   streamUrl(st, host, q?)   where a stream is fetched from
   triesFor(q?)       [host, cors, quality][] in the order they are tried
   trouble            stations that had trouble this session (not saved)
   ============================================================ */
import { store } from './store.js';

export const SOMA = 'https://somafm.com';
export const SOMA_API = 'https://api.somafm.com';

export const STATIONS = [
  ['dronezone', 'Drone Zone', 'Ambient', 'Served best chilled, safe with most medications. Atmospheric textures with minimal beats.', 'png'],
  ['deepspaceone', 'Deep Space One', 'Ambient', 'Deep ambient electronic, experimental and space music. For inner and outer space exploration.', 'png'],
  ['groovesalad', 'Groove Salad', 'Ambient · electronic', 'A nicely chilled plate of ambient/downtempo beats and grooves.', 'png'],
  ['beatblender', 'Beat Blender', 'Electronic', 'A late night blend of deep-house and downtempo chill.', 'png'],
  ['spacestation', 'Space Station Soma', 'Electronic', 'Tune in, turn on, space out. Spaced-out ambient and mid-tempo electronica.', 'png'],
  ['poptron', 'PopTron', 'Alternative', 'Electropop and indie dance rock with sparkle and pop.', 'png'],
  ['vaporwaves', 'Vaporwaves', 'Electronic', 'All Vaporwave. All the time.', 'png'],
  ['u80s', 'Underground 80s', 'Alternative · electronic', 'Early 80s UK Synthpop and a bit of New Wave.', 'png'],
  ['seventies', 'Left Coast 70s', '70s · rock', 'Mellow album rock from the Seventies. Yacht not required.', 'jpg'],
  ['7soul', 'Seven Inch Soul', 'Oldies', 'Vintage soul tracks from the original 45 RPM vinyl.', 'png'],
  ['insound', 'The In-Sound', 'Oldies', '60s/70s Hipster Euro Pop where psychedelic melodies meets groovy vibes.', 'jpg'],
  ['fluid', 'Fluid', 'Electronic · hip-hop', 'Drown in the electronic sound of instrumental hiphop, future soul and liquid trap.', 'jpg'],
  ['illstreet', 'Illinois Street Lounge', 'Lounge', 'Classic bachelor pad, playful exotica and vintage music of tomorrow.', 'jpg'],
  ['defcon', 'DEF CON Radio', 'Electronic', 'Music for Hacking. The DEF CON Year-Round Channel.', 'png'],
  ['lush', 'Lush', 'Electronic', 'Sensuous and mellow female vocals, many with an electronic influence.', 'png'],
  ['secretagent', 'Secret Agent', 'Lounge', 'The soundtrack for your stylish, mysterious, dangerous life. For Spies and PIs too!', 'png'],
  ['indiepop', 'Indie Pop Rocks!', 'Alternative · rock', 'New and classic favorite indie pop tracks.', 'png'],
].map(([id, name, genre, blurb, ext]) => ({
  id, name, genre, blurb,
  page: `${SOMA}/${id}/`,
  logo: `${SOMA_API}/logos/256/${id}256.${ext}`,
  logoType: ext === 'jpg' ? 'image/jpeg' : 'image/png',
}));

export const BY_ID = new Map(STATIONS.map(s => [s.id, s]));
export const isStation = id => typeof id === 'string' && BY_ID.has(id);

/* ---------------- stream quality ---------------- */
export const QUALITIES = [
  { id: '128', label: 'Standard', detail: '128 kbps MP3', fmt: 'mp3', kbps: 128 },
  { id: '64', label: 'Data saver', detail: '64 kbps AAC', fmt: 'aac', kbps: 64 },
  { id: '32', label: 'Lowest data', detail: '32 kbps AAC', fmt: 'aac', kbps: 32 },
];
const QKEY = 'prefs.radioQuality';
export const qualityInfo = q => QUALITIES.find(x => x.id === q) || QUALITIES[0];
export const quality = () => qualityInfo(String(store.get(QKEY, '128'))).id;
export function setQuality(q) {
  const id = qualityInfo(String(q)).id;
  store.set(QKEY, id);
  return id;
}
/** Where a stream is fetched from: SomaFM's own server, in the format and bitrate asked for. */
export function streamUrl(st, host = 'ice1', q = '128') {
  const Q = qualityInfo(q);
  return `https://${host}.somafm.com/${st.id}-${Q.kbps}-${Q.fmt}`;
}
/** [host, cors, quality] in the order they are tried: two of SomaFM's servers with CORS (which the
    spectrum needs), then plain (a proxy that strips CORS headers still gets music, minus the
    spectrum). A lower quality that won't play ends in the 128 kbps MP3, which every browser plays. */
export function triesFor(q = quality(), { plain = true } = {}) {
  const t = [['ice1', true, q], ['ice2', true, q]];
  if (q !== '128') t.push(['ice1', true, '128']);
  if (plain) t.push(['ice1', false, '128']);
  return t;
}

/* ---------------- "had trouble this session" ----------------
   Held in memory only: it is a note to yourself about this visit, not a
   record. Music and Radio both mark a station when it fails to play, and
   a person can mark one by hand (Radio's "Report not playing"). */
const TROUBLE = new Map();           /* id -> { at, why: 'failed' | 'reported' } */
const listeners = new Set();
export const trouble = {
  has: id => TROUBLE.has(id),
  get: id => TROUBLE.get(id) || null,
  ids: () => [...TROUBLE.keys()],
  mark(id, why = 'failed') {
    if (typeof id !== 'string' || !id) return;
    const had = TROUBLE.get(id);
    const next = had?.why === 'reported' ? 'reported' : why;          /* a report by hand is never downgraded */
    TROUBLE.set(id, { at: Date.now(), why: next });
    if (!had || had.why !== next) listeners.forEach(fn => { try { fn(id); } catch (e) { /* a listener must not break the others */ } });
  },
  /** It played: a failure from before is forgotten, a mark made by hand is kept until it is cleared by hand. */
  ok(id) { if (TROUBLE.get(id)?.why === 'failed') this.clear(id); },
  clear(id) {
    if (TROUBLE.delete(id)) listeners.forEach(fn => { try { fn(id); } catch (e) { /* ignore */ } });
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

export default { STATIONS, BY_ID, isStation, QUALITIES, quality, setQuality, qualityInfo, streamUrl, triesFor, trouble, SOMA, SOMA_API };
