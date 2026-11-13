/* ============================================================
   ytsync.js — a YouTube video inside Watch Together, driven without
   loading any YouTube script into StaticOS.

   The video is the plain embed (youtube-nocookie.com, in an iframe,
   with YouTube's own controls and branding left showing). It is
   controlled with the IFrame Player API's postMessage protocol,
   spoken directly:
     out:  {"event":"command","func":"playVideo|pauseVideo|seekTo","args":[…]}
           {"event":"listening","id":1,"channel":"widget"}  (asks it to report)
     in:   {"event":"onReady"} · {"event":"infoDelivery","info":{currentTime,
           playerState,duration}} · {"event":"onError","info":code}
   A message is believed only if its origin is the embed's origin AND
   its source is this iframe's own window, and only after JSON parsing
   of at most 4 KB of text; nothing in it is ever shown as markup.

   The adapter looks like a tiny <video> (paused, currentTime,
   duration, play(), pause()) so the app's 300 ms drift check works
   on it unchanged. A YouTube clock that only reports a few times a
   second is carried forward between reports.
   ============================================================ */

export const YT_ORIGIN = 'https://www.youtube-nocookie.com';
export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);
const MSG_MAX = 4096;

/** A YouTube link or bare id → the 11-character id, or null. Strict: nothing else is accepted. */
export function parseYouTube(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 200 || /[\u0000- \u007f-\u009f​-‏‪-‮⁦-⁩\\]/.test(s)) return null;
  if (YT_ID_RE.test(s)) return s;
  if (s.startsWith('//')) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.port || !HOSTS.has(u.hostname)) return null;
  const segs = u.pathname.replace(/\/$/, '').split('/').slice(1);
  let id = null;
  if (u.hostname === 'youtu.be') id = segs.length === 1 ? segs[0] : null;
  else if (segs.length === 1 && segs[0] === 'watch' && u.hostname !== 'www.youtube-nocookie.com') id = u.searchParams.get('v');
  else if (segs.length === 2 && (segs[0] === 'shorts' || segs[0] === 'embed')) id = segs[1];
  return id && YT_ID_RE.test(id) ? id : null;
}

export function embedUrl(id, origin) {
  if (!YT_ID_RE.test(id)) return null;
  const o = typeof origin === 'string' && /^https?:\/\/[^/\s]+$/.test(origin) ? `&origin=${encodeURIComponent(origin)}` : '';
  return `${YT_ORIGIN}/embed/${id}?enablejsapi=1${o}&playsinline=1`;
}
export const watchUrl = id => (YT_ID_RE.test(id) ? `https://www.youtube.com/watch?v=${id}` : null);

/** What YouTube's error codes mean, for a person. */
export function errorText(code) {
  if (code === 101 || code === 150) return 'The owner of this video doesn’t allow it to play on other sites, so it can’t play here.';
  if (code === 100) return 'This video is private, removed, or doesn’t exist.';
  if (code === 2) return 'YouTube says that isn’t a valid video.';
  if (code === 153) return 'YouTube refused to play this video here (it needs to know which site is asking).';
  if (code === 5) return 'YouTube’s player ran into a problem with this video.';
  return 'YouTube couldn’t play this video here.';
}

/** Parse one message from the embed (string JSON) → { event, info } or null. */
export function readMessage(data) {
  if (typeof data !== 'string' || data.length > MSG_MAX) return null;
  let m;
  try { m = JSON.parse(data); } catch (e) { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.event !== 'string') return null;
  return { event: m.event, info: m.info };
}

/**
 * Put the embed in `host` and drive it.
 * h: { onReady(), onError(code), onState(prev, now, byUs), onSeek(t), onSilent() }
 */
export function createYt({ host, id, origin, win = window, h = {}, silentMs = 15000 }) {
  const iframe = document.createElement('iframe');
  iframe.className = 'wt-yt';
  iframe.title = 'YouTube video';
  iframe.src = embedUrl(id, origin);
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
  const Y = { ready: false, state: -1, time: 0, at: 0, duration: 0, error: 0, cmdAt: 0, seekAt: 0, playAt: -1e9, pauseAt: -1e9, dead: false, heard: 0, ignored: 0 };
  const now = () => performance.now();
  const post = obj => { try { iframe.contentWindow?.postMessage(JSON.stringify(obj), YT_ORIGIN); } catch (e) { /* not loaded */ } };
  const command = (func, args = []) => { Y.cmdAt = now(); post({ event: 'command', func, args }); };
  const hello = () => post({ event: 'listening', id: 1, channel: 'widget' });
  let helloT = 0, silentT = 0;
  iframe.addEventListener('load', () => {
    hello();
    clearInterval(helloT);
    helloT = setInterval(() => { if (Y.ready || Y.dead) clearInterval(helloT); else hello(); }, 1000);
  });
  silentT = setTimeout(() => { if (!Y.ready && !Y.error && !Y.dead) h.onSilent?.(); }, silentMs);

  const playing = s => s === 1 || s === 3;
  function onMessage(e) {
    if (Y.dead) return;
    if (e.source !== iframe.contentWindow || e.origin !== YT_ORIGIN) { Y.ignored++; return; }
    const m = readMessage(e.data);
    if (!m) { Y.ignored++; return; }
    Y.heard++;
    if (m.event === 'onReady') { if (!Y.ready) { Y.ready = true; h.onReady?.(); } hello(); return; }
    if (m.event === 'onError') {
      const c = Number(m.info);
      Y.error = Number.isInteger(c) ? c : -1;
      h.onError?.(Y.error);
      return;
    }
    if (m.event !== 'initialDelivery' && m.event !== 'infoDelivery') return;
    const i = m.info;
    if (!i || typeof i !== 'object') return;
    if (!Y.ready) { Y.ready = true; h.onReady?.(); }
    if (Number.isFinite(i.duration) && i.duration > 0 && i.duration <= 86400) Y.duration = i.duration;
    let moved = false;
    if (Number.isFinite(i.currentTime) && i.currentTime >= 0 && i.currentTime <= 86400) {
      moved = Math.abs(i.currentTime - adapter.currentTime) > 2;
      Y.time = i.currentTime; Y.at = now();
    }
    const s = i.playerState;
    if (Number.isInteger(s) && s >= -1 && s <= 5 && s !== Y.state) {
      const prev = Y.state;
      Y.state = s; Y.at = now();
      h.onState?.(prev, s, now() - Y.cmdAt < 2500);
    } else if (moved && now() - Y.cmdAt > 2500 && now() - Y.seekAt > 2500) h.onSeek?.(Y.time);
  }
  win.addEventListener('message', onMessage);
  host.appendChild(iframe);

  const adapter = {
    get readyState() { return Y.ready ? 4 : 0; },
    get paused() { return !playing(Y.state); },
    get seeking() { return now() - Y.seekAt < 1200; },
    get duration() { return Y.duration || NaN; },
    get currentTime() { return Y.time + (Y.state === 1 ? Math.max(0, now() - Y.at) / 1000 : 0); },
    set currentTime(t) { Y.seekAt = now(); Y.time = t; Y.at = now(); command('seekTo', [t, true]); },
    /* the same command is not repeated faster than YouTube can answer it */
    play() { if (now() - Y.playAt > 1200) { Y.playAt = now(); command('playVideo'); } return Promise.resolve(); },
    pause() { if (now() - Y.pauseAt > 1200) { Y.pauseAt = now(); command('pauseVideo'); } },
    get error() { return Y.error; },
    get ready() { return Y.ready; },
    get state() { return Y.state; },
    iframe,
    stats: () => ({ heard: Y.heard, ignored: Y.ignored }),
    destroy() {
      Y.dead = true;
      clearInterval(helloT); clearTimeout(silentT);
      win.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
  return adapter;
}

export default { YT_ORIGIN, YT_ID_RE, parseYouTube, embedUrl, watchUrl, errorText, readMessage, createYt };
