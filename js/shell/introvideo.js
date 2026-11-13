/* ============================================================
   introvideo.js — the start-up card that offers the StaticOS video.

   Once the desktop is up (after the boot picker, first-run setup and
   any lock screen), a small card in the lower-left corner offers the
   StaticOS video: the Halloween one during spooky season, the bubbles
   one the rest of the year. It never plays anything by itself:

     Watch          opens the video in Videos (~/Videos/StaticOS
                    Bubbles.mp4 or StaticOS Halloween.mp4, which ship
                    with the site; if it was deleted it is put back first)
     Not now / ✕    hides the card until the next time StaticOS loads
     Don't show…    turns the card off (prefs.introVideo = false);
                    Settings › Desktop › Startup turns it back on

   The card only appears when the video is really there: a one-byte
   range request checks for it first, so an offline load or a copy of
   StaticOS without the video (the takeout zip) never offers it.
   A #game= / #arcade= / #app= link opens what it points at instead.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { covered } from '../core/cover.js';
import { isSpookySeason } from '../core/season.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-introvideo-css')) {
  const l = document.createElement('link');
  l.id = 'feat-introvideo-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-introvideo.css';
  document.head.appendChild(l);
}

export const VIDEOS = {
  bubbles: {
    src: 'staticos-bubbles.mp4', name: 'StaticOS Bubbles.mp4', poster: 'assets/staticos-video.jpg', length: '2:08',
    title: 'Watch the StaticOS video', text: 'Two minutes, with sound: a look around everything StaticOS can do.',
  },
  halloween: {
    src: 'staticos-halloween.mp4', name: 'StaticOS Halloween.mp4', poster: 'assets/staticos-halloween.jpg', length: '1:49',
    title: 'Watch the Halloween video', text: 'Under two minutes, with sound: everything spooky in StaticOS this week.',
  },
};
/** The video offered now: the Halloween one during spooky season. */
export const current = (d = new Date()) => (isSpookySeason(d) ? VIDEOS.halloween : VIDEOS.bubbles);
const PREF = 'prefs.introVideo';
const WAIT_MAX = 10 * 60e3;      /* stop waiting for the desktop after this */

/** Open a StaticOS video in Videos: the file where it is now (moved or
    renamed copies count, the Trash doesn't), or put back where it started. */
export function watch(video = current()) {
  const { vfs } = api;
  const home = `${vfs.HOME}/Videos/${video.name}`;
  const want = `staticos-asset:${video.src}`;
  const trash = `${vfs.HOME}/Trash`;
  let path = null;
  vfs.walk(vfs.HOME, (n, p) => {
    if (!path && n.type === 'file' && n.content === want && p !== trash && !p.startsWith(trash + '/')) path = p;
  });
  if (!path && vfs.restoreSeed(home)) path = home;
  if (!path) { api.notify({ title: 'The StaticOS video is missing', message: 'It could not be put back in ~/Videos.', icon: 'video' }); return null; }
  return api.openApp('videos', { path });
}

async function available(video) {
  const ctl = new AbortController();
  try {
    const r = await fetch(video.src, { headers: { Range: 'bytes=0-0' }, signal: ctl.signal });
    return r.ok;
  } catch (err) {
    return false;
  } finally {
    ctl.abort();                 /* only the answer was wanted, never the body */
  }
}

export function mountIntroVideo(host) {
  const { h, icon } = api;
  let card = null, timer = 0, dead = false;
  const deepLink = () => /^#(game|arcade|app|creation)=/.test(location.hash || '');
  const ready = () => store.get('session.onboarded', false) && !covered() && !document.querySelector('.lock');

  function hide() {
    if (!card) return;
    const el = card;
    card = null;
    /* a keyboard user who answered it from inside the card: put focus back
       on the desktop (js/shell/a11y.js) rather than leave it on <body> */
    if (el.contains(document.activeElement)) bus.emit('a11y:refocus');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  }

  function show(video) {
    if (card || dead) return;
    const go = () => { hide(); watch(video); };
    card = h('div.ivid', {
      role: 'dialog', 'aria-label': video.title,
      /* Escape answers "Not now" when focus is in the card */
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); } },
    },
      h('button.ivid__poster', { type: 'button', 'aria-label': `${video.title} (${video.length})`, onclick: go },
        h('img', { src: video.poster, alt: '', width: 640, height: 360, decoding: 'async' }),
        h('span.ivid__play', icon('play')),
        h('span.ivid__len', { text: video.length })),
      h('div.ivid__b',
        h('div.ivid__app', { text: 'StaticOS' }),
        h('div.ivid__t', { text: video.title }),
        h('div.ivid__m', { text: video.text }),
        h('div.ivid__acts',
          h('button.btn.btn--primary.btn--sm.ivid__watch', { type: 'button', onclick: go }, icon('play'), 'Watch'),
          h('button.btn.btn--sm.ivid__later', { type: 'button', onclick: hide }, 'Not now')),
        h('button.ivid__never', { type: 'button', onclick: () => { store.set(PREF, false); hide(); } },
          "Don't show this at start-up")),
      h('button.ivid__x', { type: 'button', 'aria-label': 'Close', onclick: hide }, icon('x')));
    host.appendChild(card);
  }

  async function offer() {
    if (dead || store.get(PREF, true) === false || deepLink()) return;
    const video = current();
    if (!(await available(video)) || dead) return;
    const until = Date.now() + WAIT_MAX;
    const tick = () => {
      timer = 0;
      if (dead || store.get(PREF, true) === false) return;
      if (ready()) { show(video); return; }
      if (Date.now() < until) timer = setTimeout(tick, 600);
    };
    timer = setTimeout(tick, 900);   /* let the desktop settle first */
  }

  const offs = [
    bus.on('boot:ready', offer),
    store.sub(PREF, v => { if (v === false) hide(); }),
  ];
  return () => {
    dead = true;
    clearTimeout(timer);
    offs.forEach(off => { try { off?.(); } catch (e) {} });
    card?.remove();
    card = null;
  };
}
