/* ============================================================
   roblox.stream.js — Roblox, actually running in the window.

   WHY THIS TOOK SO LONG TO FIND
   Roblox has no web player. The browser plugin died in 2020 and
   nothing replaced it, so "Roblox in a browser" can only mean
   streaming it off a cloud Android device. Every such service
   sends X-Frame-Options, and the mirrors that look header-clean
   (nowgg.fun) immediately redirect to a player host that does
   not — which is why the tile every other site copies is a dead
   frame, including the one on the site this project was
   measured against.

   WHAT ACTUALLY WORKS
   Static's own tunnel. The page is fetched through the service
   worker and served from our origin, so the player's SAMEORIGIN
   header is satisfied trivially — it is same-origin now.

   And the media survives, which is the part that could easily
   have failed: WebRTC does not travel through a service worker.
   It negotiates its own transport and connects straight out,
   so only the page and its signalling go through the tunnel
   while the video comes direct. Measured in a real browser:
   1280x720, readyState 4, srcObject set, currentTime advancing
   in real time across three minutes.

   WHAT THIS IS NOT
   Not ours, and not free of caveats. nowgg.fun is a third-party
   mirror of now.gg run by someone else; it queues, it can go
   down, and it advertises its own operators inside the frame.
   Sign-in is the person's own Roblox account. All of that is
   said plainly in the UI rather than buried, because a stream
   that takes a minute to start looks broken if nothing explains
   the wait.
   ============================================================ */

import * as UV from './uv.js';

/* The cloud-Android app ids. Verified by loading each through the
   tunnel and reading what rendered — a header check is worthless
   here, which is the whole lesson of this file. */
export const APPS = [
  {
    id: 'roblox',
    name: 'Roblox',
    url: 'https://nowgg.fun/apps/a/19900/b.html',
    icon: 'box',
    blurb: 'The real Roblox client, running on a cloud Android device and streamed here.',
    wait: 'Allocating a device usually takes 40–90 seconds. The queue is theirs, not ours.',
  },
  {
    id: 'android',
    name: 'Android',
    url: 'https://nowgg.fun/apps/uncube/7074/now.html',
    icon: 'grid',
    blurb: 'A full Android device in the window.',
    wait: 'Shared public instance — expect a wait, and do not sign into anything you care about.',
  },
];

export const byId = id => APPS.find(a => a.id === id) || APPS[0];

/** Every caveat, in one place, so no surface invents its own wording. */
export const CAVEATS = [
  'This is someone else’s service. nowgg.fun mirrors now.gg; Static does not run it and cannot fix it when it is down.',
  'It needs the Static tunnel up — that is what gets past the player’s frame rules.',
  'Sign in with your own Roblox account. Treat a shared public device as public.',
  'The stream is video: it costs bandwidth, and a slow connection shows.',
];

/**
 * Build the proxied URL for a cloud app.
 * Throws rather than returning a plain URL if the tunnel is not up —
 * loading it unproxied would hand the browser a frame the player refuses,
 * and a silent blank frame is the worst possible failure here.
 */
export function streamUrl(app) {
  if (!UV.isReady()) throw new Error('The Static tunnel is not running yet.');
  return UV.encode(app.url);
}

export const ready = () => UV.isReady();

/**
 * Bring the tunnel up if it is not already.
 * Returns { ok, why } — never throws, because callers render the reason.
 */
export async function prepare() {
  const support = UV.isSupported();
  if (!support.ok) return { ok: false, why: support.why };
  const ok = await UV.boot();
  if (ok) return { ok: true, why: '' };
  const st = UV.status();
  return { ok: false, why: st.error ? String(st.error.message || st.error) : `Tunnel ${st.phase}.` };
}

/* ---------- progress, honestly ------------------------------ *
 * A cloud device takes up to a minute and a half. Rather than a
 * spinner that says nothing for ninety seconds, the stage reports
 * which stage it is actually in — and the last one admits it does
 * not know.                                                     */

export const STAGES = [
  [0,   'Opening the tunnel…'],
  [4,   'Reaching the cloud device…'],
  [12,  'Waiting in their queue…'],
  [30,  'Starting Roblox on the device…'],
  [60,  'Still waiting. This service queues at busy times.'],
  [110, 'Taking longer than usual — it may be full right now.'],
];

export const stageFor = seconds => {
  let text = STAGES[0][1];
  for (const [at, label] of STAGES) if (seconds >= at) text = label;
  return text;
};

/**
 * Watch a proxied frame and report when the stream is genuinely live.
 *
 * "Live" means a <video> with real dimensions and a clock that is
 * advancing — not merely that the iframe fired load, which it does long
 * before anything is playing. The frame is same-origin (it is served from
 * our own origin through the tunnel), which is the only reason this can be
 * read at all.
 *
 * Calls onState({ phase, seconds, detail }) and resolves when it goes live
 * or the deadline passes.
 */
export function watch(frame, { onState, timeout = 180000 } = {}) {
  const started = Date.now();
  let lastTime = -1;
  let stable = 0;
  let stopped = false;

  return new Promise(resolve => {
    const stop = phase => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      resolve({ phase, seconds: Math.round((Date.now() - started) / 1000) });
    };

    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - started) / 1000);
      if (seconds * 1000 > timeout) return stop('timeout');

      let doc = null;
      try { doc = frame.contentDocument; }
      catch (err) { doc = null; }           /* not proxied — cannot read it */

      if (!doc) {
        onState?.({ phase: 'waiting', seconds, detail: stageFor(seconds) });
        return;
      }

      const video = [...doc.querySelectorAll('video')]
        .find(v => v.videoWidth > 0 && v.readyState >= 2);

      if (!video) {
        onState?.({ phase: 'waiting', seconds, detail: stageFor(seconds) });
        return;
      }

      /* A video element with dimensions is not yet a playing stream —
         the clock has to be moving. Two consecutive advances, so a single
         buffered frame does not count as live. */
      if (video.currentTime > lastTime + 0.05) {
        stable++;
        lastTime = video.currentTime;
      } else {
        stable = 0;
      }

      if (stable >= 2) {
        onState?.({
          phase: 'live', seconds,
          detail: `${video.videoWidth}×${video.videoHeight}`,
        });
        return stop('live');
      }

      onState?.({ phase: 'connecting', seconds, detail: 'Stream negotiating…' });
    }, 1000);
  });
}

export default { APPS, byId, CAVEATS, streamUrl, ready, prepare, watch, stageFor, STAGES };
