/* ============================================================
   tiktok.js — a real short-video feed, built on TikTok's own
   embed player.

   What this honestly is: TikTok refuses to be framed as a whole
   website (X-Frame-Options), and there is no public API that would
   hand a web page somebody's personalised "For You" feed — that
   needs a TikTok login and their private endpoints. So this app
   does the part that genuinely works: every video here is a real
   public TikTok, played through TikTok's documented embed player
   (https://www.tiktok.com/player/v1/<id>), stacked into the vertical
   snap-scrolling feed you'd expect.

   You build the feed by pasting links. Each is resolved through
   TikTok's public oEmbed endpoint to get the current player URL.
   That endpoint no longer returns a creator name, caption or
   thumbnail, so this app shows none: the only name displayed is the
   @handle already present in the link you pasted, and the caption,
   sound and creator are drawn by TikTok inside the player itself.

   Note that oEmbed resolving a link does not mean the video still
   plays — a deleted or private one still answers, and TikTok's
   player then says so. This app therefore never claims a video is
   available; it just shows the player and lets it speak. If the
   network blocks tiktok.com, the app says exactly that.

   Saved. The bookmark on a video keeps a copy of it on the Saved
   shelf (store 'portal.tiktokSaved'), which outlives removing it
   from the feed. The shelf has no thumbnails for the same reason
   the feed has none: TikTok doesn't hand them out any more.

   Moving between videos. Desktop: the wheel or trackpad (native
   scroll-snap), ↑/↓ or j/k (kept working after a click into the
   player, which would otherwise swallow the keys), and the arrow
   buttons on the right. Phones: a cross-origin player eats every
   touch that lands on it, so on a touch screen a gesture layer sits
   over the top of the video — drag it and the feed follows your
   finger; let go and it carries on with the flick's speed and snaps
   to a video (a hard flick can skip a few). The bottom strip is left
   uncovered for TikTok's own controls. A tap on the layer asks the
   player to play or pause through TikTok's player messages
   ({'x-tiktok-player':true,type:'play'|'pause'|'mute'|'unMute'});
   the play and sound state shown is only ever what the player itself
   reported back, never assumed.

   Feed lives in store 'portal.tiktok'. Only the slide you're on
   mounts an iframe, so a long feed stays fast.
   ============================================================ */
import { defineApp } from '../core/registry.js';

const KEY = 'portal.tiktok';
const SAVED_KEY = 'portal.tiktokSaved';
const OEMBED = 'https://www.tiktok.com/oembed?url=';
const ORIGIN = 'https://www.tiktok.com';
/* TikTok's current embed player. The older /embed/v2/<id> path now answers
   400, so we use /player/v1/<id> — and prefer whatever src oEmbed itself
   hands back, which is the one path TikTok keeps up to date. */
const PLAYER = 'https://www.tiktok.com/player/v1/';
const MAX = 200;
const SAVED_MAX = 500;

/* swipe feel */
const TAP_MOVE = 8;          /* px a finger may drift and still be a tap   */
const TAP_MS = 350;
const MOMENTUM = 260;        /* ms of coasting a release velocity buys     */
const FLICK = 0.3;           /* px/ms: a flick moves at least one video    */
const SKIP_MAX = 3;          /* videos one hard flick can skip             */

if (typeof document !== 'undefined' && !document.getElementById('feat-tiktok-css')) {
  const link = document.createElement('link');
  link.id = 'feat-tiktok-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-tiktok.css';
  document.head.appendChild(link);
}

/* ---- link parsing -------------------------------------------------- */

/** A TikTok video id is a long numeric snowflake. */
const idFromUrl = url => {
  const m = String(url).match(/\/(?:video|v|embed(?:\/v2)?)\/(\d{6,25})/);
  return m ? m[1] : null;
};

/** Does this even look like a TikTok link we could resolve? */
const looksLikeTikTok = url => /^https?:\/\/([a-z0-9-]+\.)?tiktok\.com\//i.test(String(url).trim());

/* The creator handle is right there in a full video link. That is the only
   name we can honestly show: TikTok's oEmbed stopped returning author_name,
   title and thumbnail_url, so anything else would be invented. The caption
   and creator still appear inside the player itself. */
const handleFromUrl = url => {
  const m = String(url).match(/tiktok\.com\/@([A-Za-z0-9._-]{1,30})/);
  return m ? `@${m[1]}` : null;
};

/** Pull the player src out of the <iframe> html oEmbed returns. */
const srcFromOEmbed = html => {
  const m = String(html || '').match(/src="(https:\/\/www\.tiktok\.com\/player\/[^"]+)"/);
  return m ? m[1].replace(/&amp;/g, '&') : null;
};

const tidy = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** One stored video, whatever an older build or a hand edit left there. */
function normVideo(v, stampKey) {
  if (!v || typeof v.id !== 'string' || !/^\d{6,25}$/.test(v.id)) return null;
  const out = {
    id: v.id,
    url: typeof v.url === 'string' && looksLikeTikTok(v.url) ? v.url : `https://www.tiktok.com/@/video/${v.id}`,
    handle: tidy(v.handle, 32) || null,
    /* only ever a tiktok.com player URL, never arbitrary */
    embedSrc: typeof v.embedSrc === 'string' && v.embedSrc.startsWith('https://www.tiktok.com/player/') ? v.embedSrc : null,
    unverified: !!v.unverified,
  };
  out[stampKey] = typeof v[stampKey] === 'string' && !Number.isNaN(Date.parse(v[stampKey])) ? v[stampKey] : new Date().toISOString();
  return out;
}

/** A TikTok player message, if this is one ({'x-tiktok-player':true,type,value}). */
function playerMsg(data) {
  let d = data;
  if (typeof d === 'string') {
    if (d.length > 4000 || !/^\s*\{/.test(d)) return null;
    try { d = JSON.parse(d); } catch (e) { return null; }
  }
  if (!d || typeof d !== 'object' || d['x-tiktok-player'] !== true || typeof d.type !== 'string') return null;
  return { type: d.type, value: d.value };
}

/* ---- app ----------------------------------------------------------- */

defineApp({
  id: 'tiktok',
  name: 'TikTok',
  icon: 'brand-tiktok',
  g1: '#69e8df', g2: '#d12c63',
  category: 'Media',
  keywords: ['tiktok', 'short videos', 'social video', 'clips', 'shorts', 'feed', 'saved', 'bookmarks'],
  desc: 'A vertical feed of real TikToks you collect, and a shelf of the ones you save',
  pinned: true, dock: true, singleton: true,
  win: { w: 520, h: 780, minW: 360, minH: 460 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, store, clear, render, confirm, fmt } = api;

    const S = {
      feed: loadList(KEY, 'addedAt', MAX),
      saved: loadList(SAVED_KEY, 'savedAt', SAVED_MAX),
      tab: 'feed',               /* 'feed' | 'saved'                         */
      shelf: true,               /* in Saved: the shelf (true) or its player */
      idx: { feed: 0, saved: 0 },
      adding: false,
      error: null,
      dead: false,
      touch: false,
      player: { ready: false, state: null, muted: null },   /* only what the player said */
    };

    function loadList(key, stampKey, max) {
      const raw = store.get(key, null);
      const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.feed) ? raw.feed : []);
      const seen = new Set();
      return rows.map(v => normVideo(v, stampKey)).filter(v => v && !seen.has(v.id) && seen.add(v.id)).slice(0, max);
    }

    const saveFeed = () => store.set(KEY, S.feed.map(v => ({ ...v })));
    const saveSaved = () => store.set(SAVED_KEY, S.saved.map(v => ({ ...v })));
    const isSaved = id => S.saved.some(v => v.id === id);

    /* the list the player is showing right now */
    const playing = () => S.tab === 'saved' && !S.shelf;
    const list = () => (S.tab === 'saved' ? S.saved : S.feed);
    const cur = () => S.idx[S.tab];
    const setCur = i => { S.idx[S.tab] = i; };

    /* ---- elements ---------------------------------------------- */
    const feedEl = h('div.tt__feed', { tabindex: '0', role: 'list', 'aria-label': 'Your TikTok feed' });
    const shelfEl = h('div.tt__shelf', { hidden: true });
    const metaEl = h('div.tt__meta');
    const statusEl = h('div.tt__status', { role: 'status', 'aria-live': 'polite' });

    const input = h('input.tt__input', {
      type: 'url',
      placeholder: 'Paste a TikTok link…',
      'aria-label': 'TikTok video link',
      spellcheck: 'false',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } },
    });

    const addBtn = h('button.btn.btn--primary.tt__add', {
      type: 'button', onclick: () => addFromInput(),
    }, icon('plus'), 'Add');

    const tabBtn = (id, label, ic) => h('button.tt__tab', {
      type: 'button', role: 'tab', dataset: { tab: id }, onclick: () => setTab(id),
    }, icon(ic), h('span', { text: label }), h('small.tt__tabn'));
    const feedTab = tabBtn('feed', 'Feed', 'play');
    const savedTab = tabBtn('saved', 'Saved', 'bookmark');
    const tabs = h('div.tt__tabs', { role: 'tablist', 'aria-label': 'TikTok' }, feedTab, savedTab);
    const backBtn = h('button.btn.btn--sm.tt__back', { type: 'button', hidden: true, onclick: () => showShelf() },
      icon('chevron-left'), h('span', { text: 'Saved' }));

    const bar = h('div.tt__bar',
      h('div.tt__brand', icon('brand-tiktok'), h('b', { text: 'TikTok' })),
      tabs,
      h('div.tt__addrow', input, addBtn));

    /* ---- adding ------------------------------------------------- */

    function setStatus(text, kind) {
      S.error = kind === 'error' ? text : null;
      if (!text) { clear(statusEl); statusEl.className = 'tt__status'; return; }
      statusEl.className = `tt__status is-${kind || 'info'}`;
      render(statusEl, icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info'), h('span', { text }));
    }

    async function addFromInput() {
      const url = input.value.trim();
      if (!url) return;
      if (!looksLikeTikTok(url)) {
        setStatus('That isn’t a tiktok.com link.', 'error');
        return;
      }
      if (S.adding) return;
      S.adding = true;
      addBtn.disabled = true;
      setStatus('Checking that link with TikTok…');

      const existingId = idFromUrl(url);
      if (existingId && S.feed.some(v => v.id === existingId)) {
        S.adding = false; addBtn.disabled = false;
        setStatus('That video is already in your feed.', 'error');
        setTab('feed', { quiet: true });
        jumpTo(S.feed.findIndex(v => v.id === existingId));
        return;
      }

      let entry = null;
      let failure = null;
      try {
        const res = await fetch(OEMBED + encodeURIComponent(url), { mode: 'cors' });
        if (!res.ok) throw new Error(`TikTok replied ${res.status}`);
        const data = await res.json();
        const id = String(data.embed_product_id || '').match(/^\d{6,25}$/)
          ? String(data.embed_product_id)
          : idFromUrl(data.html || '') || existingId;
        if (!id) throw new Error('TikTok didn’t return a video id for that link');
        /* oEmbed resolving the link means TikTok recognised it and gave us a
           player — NOT that the video still plays. A deleted or private
           video still answers 200 here and then shows "Video currently
           unavailable" in the player, so we never claim it is available. */
        entry = {
          id, url,
          handle: handleFromUrl(url),
          embedSrc: srcFromOEmbed(data.html),
          unverified: false,
          addedAt: new Date().toISOString(),
        };
      } catch (err) {
        failure = err && err.message ? err.message : String(err);
        /* If we can still read an id straight out of the URL, the embed
           itself may well work even though we couldn't reach oEmbed
           (blocked network, offline). Add it, but don't invent details. */
        if (existingId) {
          entry = {
            id: existingId, url,
            handle: handleFromUrl(url),
            embedSrc: null,
            unverified: true,
            addedAt: new Date().toISOString(),
          };
        }
      }

      S.adding = false;
      addBtn.disabled = false;
      if (S.dead) return;

      if (!entry) {
        setStatus(`Couldn’t add that link — ${failure || 'TikTok didn’t recognise it'}.`, 'error');
        return;
      }
      if (S.feed.some(v => v.id === entry.id)) {
        setStatus('That video is already in your feed.', 'error');
        setTab('feed', { quiet: true });
        jumpTo(S.feed.findIndex(v => v.id === entry.id));
        return;
      }

      S.feed.unshift(entry);
      if (S.feed.length > MAX) S.feed.length = MAX;
      saveFeed();
      input.value = '';
      S.tab = 'feed';
      S.idx.feed = 0;
      paint();
      jumpTo(0, { instant: true });
      setStatus(entry.unverified
        ? 'Added, but TikTok couldn’t be reached to confirm the link — the player may not load.'
        : `Added ${entry.handle ? `${entry.handle}’s` : 'that'} video.`, entry.unverified ? 'info' : 'ok');
    }

    async function remove(v) {
      const kept = isSaved(v.id);
      const ok = await confirm({
        title: 'Remove this video?',
        message: `${v.handle ? `${v.handle}’s video comes` : 'It comes'} out of your feed.${kept ? ' It stays on your Saved shelf.' : ''}`,
        ok: 'Remove', danger: true,
      });
      if (!ok || S.dead) return;
      const at = S.feed.findIndex(x => x.id === v.id);
      if (at < 0) return;
      S.feed.splice(at, 1);
      saveFeed();
      S.idx.feed = clamp(S.idx.feed, 0, Math.max(0, S.feed.length - 1));
      paint();
      jumpTo(S.idx.feed, { instant: true });
      setStatus('Removed.', 'ok');
    }

    /* ---- saving ------------------------------------------------- */

    function toggleSave(v) {
      const at = S.saved.findIndex(x => x.id === v.id);
      if (at >= 0) {
        S.saved.splice(at, 1);
        saveSaved();
        setStatus('Removed from Saved.', 'ok');
        /* unsaving the one playing on the Saved shelf takes it out of that list */
        if (playing()) {
          S.idx.saved = clamp(S.idx.saved, 0, Math.max(0, S.saved.length - 1));
          if (!S.saved.length) { showShelf(); return; }
          paint();
          jumpTo(S.idx.saved, { instant: true });
          return;
        }
      } else {
        const { addedAt, ...rest } = v;
        S.saved.unshift({ ...rest, savedAt: new Date().toISOString() });
        if (S.saved.length > SAVED_MAX) S.saved.length = SAVED_MAX;
        saveSaved();
        setStatus(`Saved${v.handle ? ` ${v.handle}’s video` : ''}. It’s on your Saved shelf.`, 'ok');
      }
      paintSaveButtons();
      paintTabs();
      if (S.tab === 'saved' && S.shelf) paintShelf();
    }

    function paintSaveButtons() {
      for (const b of feedEl.querySelectorAll('.tt__save')) {
        const on = isSaved(b.dataset.id);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.setAttribute('aria-label', on ? 'Saved — remove from Saved' : 'Save to your Saved shelf');
        b.title = on ? 'Saved' : 'Save';
        render(b, icon('bookmark', { fill: on }));
      }
    }

    async function copyLink(v) {
      try {
        await navigator.clipboard.writeText(v.url);
        setStatus('Link copied.', 'ok');
      } catch (e) {
        setStatus('The clipboard isn’t available here.', 'error');
      }
    }

    /* ---- the player ---------------------------------------------- */

    const srcFor = v => v.embedSrc
      || `${PLAYER}${encodeURIComponent(v.id)}?description=1&music_info=1&autoplay=1&muted=1`;

    const frameEl = () => feedEl.querySelector('.tt__frame');
    function tell(type, value) {
      const f = frameEl();
      if (!f || !f.contentWindow) return false;
      try { f.contentWindow.postMessage({ 'x-tiktok-player': true, type, value: value ?? null }, ORIGIN); } catch (e) { return false; }
      return true;
    }

    /* One player at a time, like the real thing: only the slide you're on
       holds an iframe. Keeps a long feed cheap and stops several videos
       loading at once. */
    function mountWindow() {
      const L = list();
      const slides = [...feedEl.querySelectorAll('.tt__slide')];
      slides.forEach((slide, i) => {
        const holder = slide.querySelector('.tt__player');
        if (!holder) return;
        const has = !!holder.querySelector('iframe');
        if (i === cur() && !has) {
          const v = L[i];
          if (!v) return;
          clear(holder);
          S.player = { ready: false, state: null, muted: null };
          holder.appendChild(h('iframe.tt__frame', {
            src: srcFor(v),
            title: v.handle ? `TikTok video from ${v.handle}` : `TikTok video ${v.id}`,
            allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write',
            referrerpolicy: 'strict-origin-when-cross-origin',
          }));
          paintPlayerState();
        } else if (i !== cur() && has) {
          clear(holder);
          holder.appendChild(placeholder());
        }
      });
    }

    /* what the player itself reports — the only source of play/sound state */
    const onMessage = e => {
      const f = frameEl();
      if (!f || e.source !== f.contentWindow || e.origin !== ORIGIN) return;
      const m = playerMsg(e.data);
      if (!m) return;
      if (m.type === 'onPlayerReady') S.player.ready = true;
      else if (m.type === 'onStateChange') { S.player.ready = true; S.player.state = Number(m.value); }
      else if (m.type === 'onMute') S.player.muted = !!m.value;
      else return;
      paintPlayerState();
    };
    window.addEventListener('message', onMessage);

    function paintPlayerState() {
      const slide = feedEl.querySelector(`.tt__slide[data-i="${cur()}"]`);
      if (!slide) return;
      const st = S.player.state;
      slide.dataset.state = st === 1 ? 'playing' : st === 2 ? 'paused' : st === 0 ? 'ended' : '';
      const mute = slide.querySelector('.tt__mute');
      if (mute) {
        const m = S.player.muted;
        mute.hidden = !S.player.ready;
        render(mute, icon(m === false ? 'volume-2' : 'volume-x'));
        mute.setAttribute('aria-label', m === false ? 'Mute' : 'Unmute');
        mute.title = m === false ? 'Mute' : 'Unmute';
      }
    }

    function togglePlay() {
      /* paused or ended (as the player told us) -> play; otherwise pause */
      const st = S.player.state;
      tell(st === 2 || st === 0 ? 'play' : 'pause');
    }
    const toggleMute = () => tell(S.player.muted === false ? 'mute' : 'unMute');

    /* No invented thumbnail: TikTok's oEmbed no longer returns one. */
    const placeholder = () => h('div.tt__thumb.tt__thumb--none', icon('brand-tiktok'));

    function slide(v, i) {
      const inSaved = S.tab === 'saved';
      const saved = isSaved(v.id);
      return h('div.tt__slide', { role: 'listitem', dataset: { i: String(i) } },
        h('div.tt__player', placeholder()),
        h('div.tt__touch', { 'aria-hidden': 'true' }),
        h('div.tt__overlay',
          h('div.tt__who',
            v.handle ? h('b', { text: v.handle }) : h('b.tt__dim', { text: 'TikTok video' }),
            v.unverified
              ? h('span.tt__badge', { title: 'TikTok couldn’t be reached to confirm this link' }, 'unconfirmed')
              : null),
          h('p.tt__cap', { text: 'The caption and sound are shown by TikTok inside the player.' })),
        h('div.tt__side',
          h('button.tt__sbtn.tt__nav', { type: 'button', 'aria-label': 'Previous video (↑)', title: 'Previous video (↑)', disabled: i === 0, onclick: () => step(-1) }, icon('chevron-up')),
          h('button.tt__sbtn.tt__nav', { type: 'button', 'aria-label': 'Next video (↓)', title: 'Next video (↓)', disabled: i === list().length - 1, onclick: () => step(1) }, icon('chevron-down')),
          h('button.tt__sbtn.tt__save', {
            type: 'button', dataset: { id: v.id }, class: saved ? 'is-on' : null, 'aria-pressed': saved ? 'true' : 'false',
            'aria-label': saved ? 'Saved — remove from Saved' : 'Save to your Saved shelf', title: saved ? 'Saved' : 'Save',
            onclick: () => toggleSave(v),
          }, icon('bookmark', { fill: saved })),
          h('button.tt__sbtn.tt__mute', { type: 'button', hidden: true, onclick: () => toggleMute() }, icon('volume-x')),
          sideBtn('external-link', 'Open on TikTok', () => window.open(v.url, '_blank', 'noopener,noreferrer')),
          sideBtn('link', 'Copy link', () => copyLink(v)),
          inSaved ? null : sideBtn('trash', 'Remove from feed', () => remove(v))));
    }

    const sideBtn = (ic, label, fn) => h('button.tt__sbtn', {
      type: 'button', 'aria-label': label, title: label, onclick: fn,
    }, icon(ic));

    function emptyState() {
      return h('div.tt__empty',
        icon('brand-tiktok'),
        h('b', { text: 'Your feed is empty' }),
        h('p', { text: 'Paste any TikTok link above and it lands here, playing in TikTok’s own player. Swipe, scroll or press ↓ to move between videos.' }),
        h('p.tt__fine', { text: 'StaticOS can’t show a personalised For You feed — that needs a TikTok account and their private API — so this feed is the one you build.' }));
    }

    /* ---- the Saved shelf ------------------------------------------ */

    function paintShelf() {
      clear(shelfEl);
      if (!S.saved.length) {
        shelfEl.append(h('div.tt__empty',
          icon('bookmark'),
          h('b', { text: 'Nothing saved yet' }),
          h('p', { text: 'Tap the bookmark beside any video in your feed and it’s kept here — even if you later remove it from the feed.' }),
          S.feed.length ? h('button.btn.btn--sm', { type: 'button', onclick: () => setTab('feed') }, icon('play'), h('span', { text: 'Back to the feed' })) : null));
        return;
      }
      shelfEl.append(
        h('div.tt__shelfhead',
          h('b', { text: `${S.saved.length} saved video${S.saved.length === 1 ? '' : 's'}` }),
          h('small', { text: 'Newest first · kept in this browser' })),
        h('div.tt__grid', { role: 'list', 'aria-label': 'Saved TikToks' }, S.saved.map((v, i) =>
          h('div.tt__card', { role: 'listitem' },
            h('button.tt__cardmain', {
              type: 'button', dataset: { id: v.id },
              'aria-label': `Play ${v.handle ? `${v.handle}’s video` : 'this TikTok'}, saved ${fmt.fmtAgo(v.savedAt)}`,
              onclick: () => playSaved(i),
            },
            h('span.tt__cardart', icon('brand-tiktok'), h('span.tt__cardplay', icon('play', { fill: true }))),
            h('span.tt__cardtxt',
              v.handle ? h('b', { text: v.handle }) : h('b.tt__dim', { text: 'TikTok video' }),
              h('small', { text: `Saved ${fmt.fmtAgo(v.savedAt)}` }))),
            h('button.ibtn.tt__unsave', {
              type: 'button', 'aria-label': `Remove ${v.handle ? `${v.handle}’s video` : 'this video'} from Saved`, title: 'Remove from Saved',
              onclick: () => unsaveFromShelf(v),
            }, icon('x'))))));
    }

    function unsaveFromShelf(v) {
      const at = S.saved.findIndex(x => x.id === v.id);
      if (at < 0) return;
      const [gone] = S.saved.splice(at, 1);
      saveSaved();
      paintShelf();
      paintTabs();
      setStatus('Removed from Saved.', 'ok');
      api.notify({
        app: 'TikTok', icon: 'bookmark', title: 'Removed from Saved', message: gone.handle ? `${gone.handle}’s video` : 'A TikTok video', timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => {
          if (S.dead || isSaved(gone.id)) return;
          S.saved.splice(Math.min(at, S.saved.length), 0, gone);
          saveSaved();
          paintTabs();
          if (S.tab === 'saved' && S.shelf) paintShelf();
          paintSaveButtons();
        } }],
      });
    }

    function playSaved(i) {
      S.tab = 'saved';
      S.shelf = false;
      S.idx.saved = clamp(i, 0, S.saved.length - 1);
      paint();
      jumpTo(S.idx.saved, { instant: true });
      feedEl.focus({ preventScroll: true });
    }
    function showShelf() {
      S.tab = 'saved';
      S.shelf = true;
      paint();
    }
    function setTab(id, { quiet = false } = {}) {
      if (id === S.tab && (id === 'feed' || S.shelf)) return;
      S.tab = id;
      if (id === 'saved') S.shelf = true;
      if (!quiet) setStatus('');
      paint();
      if (id === 'feed') jumpTo(S.idx.feed, { instant: true });
    }

    function paintTabs() {
      for (const [b, id, n] of [[feedTab, 'feed', S.feed.length], [savedTab, 'saved', S.saved.length]]) {
        const on = S.tab === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.querySelector('.tt__tabn').textContent = n ? String(n) : '';
      }
      backBtn.hidden = !playing();
    }

    /* ---- painting -------------------------------------------------- */

    function paint() {
      if (S.dead) return;
      cancelGlide();
      paintTabs();
      const showShelfNow = S.tab === 'saved' && S.shelf;
      shelfEl.hidden = !showShelfNow;
      feedEl.hidden = showShelfNow;
      feedEl.setAttribute('aria-label', playing() ? 'Your saved TikToks' : 'Your TikTok feed');
      if (showShelfNow) { clear(feedEl); paintShelf(); paintMeta(); return; }
      clear(feedEl);
      const L = list();
      if (!L.length) {
        feedEl.appendChild(emptyState());
        paintMeta();
        return;
      }
      setCur(clamp(cur(), 0, L.length - 1));
      L.forEach((v, i) => feedEl.appendChild(slide(v, i)));
      mountWindow();
      paintMeta();
      watchSlides();
    }

    function paintMeta() {
      const L = list();
      const v = (S.tab === 'feed' || playing()) ? L[cur()] : null;
      if (!v) { clear(metaEl); if (S.tab === 'saved' && S.shelf) metaEl.append(h('span.tt__added', { text: 'Pick a video to play it' })); return; }
      render(metaEl,
        playing() ? backBtn : null,
        h('span.tt__pos', { text: `${cur() + 1} / ${L.length}` }),
        h('span.tt__added', { text: playing() ? `saved ${fmt.fmtAgo(v.savedAt)}` : `added ${fmt.fmtAgo(v.addedAt)}` }));
      backBtn.hidden = !playing();
    }

    /* the index changed: move the single iframe, refresh the readout */
    function arrive(i) {
      if (i === cur()) return;
      setCur(i);
      mountWindow();
      paintMeta();
    }

    /* ---- moving between videos ------------------------------------- */
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const slideH = () => feedEl.clientHeight || 1;

    let glide = 0;
    function cancelGlide() {
      if (glide) cancelAnimationFrame(glide);
      glide = 0;
      feedEl.classList.remove('is-gliding');
    }
    /** Ease the feed to video i. `v0` (px/ms) is the finger's release speed, so a
        flick carries on at the speed it was thrown instead of restarting. */
    function glideTo(i, v0 = 0, { instant = false } = {}) {
      cancelGlide();
      const L = list();
      if (!L.length) return;
      const target = clamp(i, 0, L.length - 1);
      const from = feedEl.scrollTop, to = target * slideH();
      const dist = to - from;
      if (instant || reduced() || Math.abs(dist) < 1) {
        feedEl.classList.add('is-gliding');
        feedEl.scrollTop = to;
        requestAnimationFrame(() => feedEl.classList.remove('is-gliding'));
        arrive(target);
        return;
      }
      /* ease-out-cubic starts at 3·dist/T: pick T so that matches the flick */
      const speed = Math.abs(v0);
      const T = clamp(speed > 0.05 ? (3 * Math.abs(dist)) / speed : 300 + Math.abs(dist) * 0.15, 180, 650);
      const t0 = performance.now();
      feedEl.classList.add('is-gliding');
      const tick = now => {
        const k = clamp((now - t0) / T, 0, 1);
        feedEl.scrollTop = from + dist * (1 - (1 - k) ** 3);
        if (k < 1 && !S.dead) { glide = requestAnimationFrame(tick); return; }
        glide = 0;
        feedEl.classList.remove('is-gliding');
        arrive(target);
      };
      glide = requestAnimationFrame(tick);
    }

    function jumpTo(i, o) {
      const L = list();
      if (!L.length || i < 0) return;
      glideTo(i, 0, o);
    }
    const step = d => jumpTo(cur() + d);

    /* which slide is showing — drives the lazy iframe window while the
       wheel or a trackpad scrolls natively */
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
          if (glide || G.id !== null) return;
          for (const e of entries) {
            if (e.isIntersecting && e.intersectionRatio > 0.55) {
              const i = Number(e.target.dataset.i);
              if (Number.isFinite(i)) arrive(i);
            }
          }
        }, { root: feedEl, threshold: [0.55] })
      : null;

    function watchSlides() {
      if (!io) return;
      io.disconnect();
      feedEl.querySelectorAll('.tt__slide').forEach(el => io.observe(el));
    }

    /* ---- touch: follow the finger, coast, snap ---------------------- */
    const G = { id: null, y0: 0, x0: 0, s0: 0, t0: 0, moved: false, samples: [] };
    function onDown(e) {
      if (!e.target.closest('.tt__touch') || !S.touch) return;
      if (e.pointerType === 'mouse') return;
      cancelGlide();
      G.id = e.pointerId;
      G.y0 = e.clientY; G.x0 = e.clientX;
      G.s0 = feedEl.scrollTop;
      G.t0 = performance.now();
      G.moved = false;
      G.samples = [{ t: G.t0, y: e.clientY }];
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      feedEl.classList.add('is-gliding');
    }
    function onMove(e) {
      if (e.pointerId !== G.id) return;
      const dy = e.clientY - G.y0;
      if (!G.moved && Math.hypot(dy, e.clientX - G.x0) > TAP_MOVE) G.moved = true;
      if (!G.moved) return;
      e.preventDefault();
      const max = feedEl.scrollHeight - feedEl.clientHeight;
      feedEl.scrollTop = clamp(G.s0 - dy, 0, Math.max(0, max));
      const now = performance.now();
      G.samples.push({ t: now, y: e.clientY });
      while (G.samples.length > 2 && now - G.samples[0].t > 100) G.samples.shift();
    }
    function onUp(e) {
      if (e.pointerId !== G.id) return;
      G.id = null;
      const now = performance.now();
      if (!G.moved) {
        feedEl.classList.remove('is-gliding');
        if (e.type === 'pointerup' && now - G.t0 < TAP_MS) togglePlay();
        return;
      }
      /* release velocity over the last ~100 ms; + is the finger moving down */
      const first = G.samples[0], last = { t: now, y: e.clientY };
      const v = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const H = slideH();
      const from = Math.round(G.s0 / H);
      let target = Math.round((feedEl.scrollTop - v * MOMENTUM) / H);
      if (Math.abs(v) > FLICK && target === from) target = from + (v < 0 ? 1 : -1);
      target = clamp(target, from - SKIP_MAX, from + SKIP_MAX);
      glideTo(target, v);
    }
    feedEl.addEventListener('pointerdown', onDown);
    feedEl.addEventListener('pointermove', onMove, { passive: false });
    feedEl.addEventListener('pointerup', onUp);
    feedEl.addEventListener('pointercancel', onUp);

    /* is this a touch screen? (a phone sheet always is) */
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    function syncTouch() {
      S.touch = document.body.classList.contains('is-mobile') || !!coarse?.matches;
      appEl.classList.toggle('tt--touch', S.touch);
    }
    coarse?.addEventListener?.('change', syncTouch);

    /* ---- keyboard ---------------------------------------------------- */
    let lastTab = 0;
    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      if (e.key === 'Tab') lastTab = performance.now();
      if (e.target === input || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (S.tab === 'saved' && S.shelf) return;      /* the shelf is ordinary buttons */
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'PageDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); jumpTo(0); }
      else if (e.key === 'End') { e.preventDefault(); jumpTo(list().length - 1); }
      else if (e.key === 'Escape' && playing()) { e.preventDefault(); showShelf(); }
    };
    window.addEventListener('keydown', onKey);
    /* A click into TikTok's player moves keyboard focus into that
       cross-origin frame, and then ↑/↓ never reach this window. Take
       focus back right after such a click (not after a Tab, which is
       someone choosing to be in there). */
    const onBlur = () => setTimeout(() => {
      if (S.dead || !win.el.classList.contains('is-active')) return;
      const a = document.activeElement;
      if (a && a.classList?.contains('tt__frame') && root.contains(a) && performance.now() - lastTab > 600) {
        feedEl.focus({ preventScroll: true });
      }
    }, 0);
    window.addEventListener('blur', onBlur);

    const appEl = h('div.app.tt',
      bar,
      statusEl,
      feedEl,
      shelfEl,
      h('div.tt__foot', metaEl, h('div.grow'),
        h('small.tt__note', { text: 'Official TikTok embeds · needs tiktok.com reachable' })));
    root.appendChild(appEl);
    syncTouch();
    const mo = new MutationObserver(syncTouch);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    /* a resize changes the slide height: stay on the same video */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      let lastH = 0;
      ro = new ResizeObserver(() => {
        const H = feedEl.clientHeight;
        if (!H || H === lastH) return;
        lastH = H;
        if (!glide && G.id === null && !feedEl.hidden) { feedEl.classList.add('is-gliding'); feedEl.scrollTop = cur() * H; requestAnimationFrame(() => feedEl.classList.remove('is-gliding')); }
      });
      ro.observe(feedEl);
    }

    paint();

    /* opened with a link already in hand, or straight to the shelf */
    const take = o => {
      if (!o) return;
      if (o.tab === 'saved' || o.view === 'saved') showShelf();
      const url = o.url || o.link;
      if (url && looksLikeTikTok(url)) { input.value = url; addFromInput(); }
    };
    take(opts);
    win.onReopen?.(take);

    return () => {
      S.dead = true;
      cancelGlide();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('message', onMessage);
      coarse?.removeEventListener?.('change', syncTouch);
      mo.disconnect();
      ro?.disconnect();
      io?.disconnect();
      clear(feedEl);
    };
  },
});
