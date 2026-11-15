/*global UVServiceWorker, __uv$config*/
/* ============================================================
   sw.js — Static's service worker: the proxy, and the offline
   copy of StaticOS. One file, because a site gets one worker per
   scope and both need the whole site ('/').

   This has to live at the site root. A service worker's scope
   can never be broader than its own path, and Ultraviolet
   serves proxied pages from /service/, so a worker registered
   at /uv/sw.js could never claim them.

   1. The proxy (this first half) answers proxied requests
      (/service/…) and nothing else.
   2. The offline copy (the second half) answers StaticOS's own
      shell — index.html, js/, css/ — from a copy kept per build,
      and data/*.json network-first. It is written to fail open:
      anything it cannot answer goes to the network exactly as if
      there were no worker, and it never makes up an error page
      for StaticOS's own files. An earlier version of this worker
      answered every request and turned any failed fetch into a
      plain-text error, so one bad proxy or game load could leave
      the whole site showing nothing but that error.

   Everything else stays in /uv/ so the root stays clean.
   ============================================================ */
importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts(__uv$config.sw || '/uv/uv.sw.js');

const uv = new UVServiceWorker();
const PREFIX = __uv$config.prefix || '/service/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

/* what a failed proxied page shows instead of a dead frame */
function failurePage(err) {
  const msg = String((err && err.message) || err || 'unknown error')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Could not load</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0708;color:#e8dfe3;font:15px/1.5 system-ui,sans-serif}
main{max-width:440px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{color:#a99ba1;margin:0 0 18px}
code{display:block;font-size:12px;color:#7d7379;margin:0 0 18px;word-break:break-word}a{color:#ff7a98}</style>
<main><h1>This page didn't load</h1><p>The site may be down, or it didn't answer in time. Nothing else in StaticOS is affected.</p>
<code>${msg}</code><a href="/" target="_top">Back to StaticOS</a></main>`,
  { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  /* not ours to answer: the browser handles it exactly as if there were no worker */
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  event.respondWith((async () => {
    try {
      const res = await uv.fetch(event);
      /* Ultraviolet reports its own failures as a bodyless 500, which shows
         as a blank frame — give it words instead */
      if (res.status >= 500 && !res.headers.get('content-type')) {
        const body = await res.clone().text().catch(() => '');
        if (!body.trim()) return failurePage(new Error(`the proxy could not load it (HTTP ${res.status})`));
      }
      return res;
    } catch (err) {
      return failurePage(err);
    }
  })());
});

/* ============================================================
   2. The offline copy of StaticOS.

   WHAT IS KEPT
     staticos-shell-<build>  the app shell of one build: index.html,
                             js/, css/, the wallpaper stills, and the
                             few small data files some apps cannot
                             work without (tools/offline-files.mjs
                             lists them). Filled in the background after
                             start-up, from the list in /offline.json
                             (tools/bump.mjs writes it beside build.json
                             on every deploy), plus whatever the page loads.
     staticos-data           data/*.json, kept from the last time the
                             network answered (network first); with no
                             network, the build's own copy of one of the
                             small ones in its list answers instead.
     staticos-fonts          the Google Fonts the shell uses.
     staticos-pics[::<id>]   the game and anime pictures one person has
                             seen, answered from here next time (also
                             offline). The page names the cache through
                             profiles.js (js/core/piccache.js); a guest's
                             tab names none and nothing is kept. Capped,
                             oldest first; see onPicture.
     staticos-meta           which build is current, which open tab
                             runs which build, and whether the person
                             asked to keep the build before it (Settings
                             › About › Keep the previous version).

   HOW A VISIT GOES
     Opening StaticOS asks the network for build.json (no-store,
     2.5 s at most). A build id we have not seen becomes the current
     build; its copy starts empty and fills from the network as the
     page loads, then from /offline.json once the page is up (files
     whose hash did not change are copied from the previous build's
     copy instead of downloaded again). No answer — offline, or a
     very slow link — and the current build's copy is served. So a
     reload always gets the newest build when the network is there,
     and never a stale shell for longer than the network is gone.

     Each tab stays on the build it started with: a tab opened
     before a deploy keeps loading its apps (which load on demand)
     from its own build's copy, so old and new code never mix. A
     build's copy is deleted once no open tab runs it. build.json
     itself is never served from the copy while the network answers
     — except as build.json?running, which updater.js asks to learn
     which build the tab is really running.

   A host without build.json (a plain ./serve.sh) gets no copy at
   all: there would be nothing to tell a new version by.
   ============================================================ */
const OFF = {
  SHELL: 'staticos-shell-',
  DATA: 'staticos-data',
  FONTS: 'staticos-fonts',
  META: 'staticos-meta',
  META_KEY: '/__staticos/meta',
  HASH: 'x-staticos-hash',
  STAMP_MS: 2500,
};

let meta = null;
let metaLoading = null;
let metaSaving = Promise.resolve();
const warming = new Map();      /* build -> Promise while its copy is being filled */

function loadMeta() {
  if (meta) return Promise.resolve(meta);
  if (!metaLoading) {
    metaLoading = caches.open(OFF.META)
      .then(c => c.match(OFF.META_KEY))
      .then(r => (r ? r.json() : null))
      .catch(() => null)
      .then(m => {
        const ok = m && typeof m === 'object';
        meta = {
          active: ok && typeof m.active === 'string' ? m.active : null,
          complete: ok && m.complete && typeof m.complete === 'object' ? m.complete : {},
          clients: ok && m.clients && typeof m.clients === 'object' ? m.clients : {},
          /* opt-in: keep the build that was current before this one, so "Use the
             previous version once" has something to start. `hold` makes the next
             navigation start the current build as it is, without asking the network. */
          keep: ok && m.keep === true,
          previous: ok && typeof m.previous === 'string' ? m.previous : null,
          hold: ok && m.hold === true,
          /* pictures: which open tab keeps them in which cache, from which hosts, how many */
          pics: ok && m.pics && typeof m.pics === 'object' ? m.pics : {},
          picHosts: ok && Array.isArray(m.picHosts) ? m.picHosts : [],
          picMax: ok && m.picMax && typeof m.picMax === 'object' ? m.picMax : null,
        };
        return meta;
      });
  }
  return metaLoading;
}

function saveMeta() {
  metaSaving = metaSaving
    .then(() => caches.open(OFF.META))
    .then(c => c.put(OFF.META_KEY, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } })))
    .catch(() => {});
  return metaSaving;
}

const shellCache = build => caches.open(OFF.SHELL + build);

/* the copy a request should come from: the build its tab started on */
const buildFor = clientId => (clientId && meta.clients[clientId]) || meta.active;

/* Which same-origin requests belong to the app shell, and the key they
   are kept under. The query string is dropped: StaticOS's ?v= tags were
   only ever there to dodge the browser cache, and the build is the
   version here. */
function shellKey(url) {
  const p = url.pathname;
  if (p === '/' || p === '/index.html') return '/index.html';
  if (/^\/(js|css)\//.test(p)) return p;
  if (/^\/assets\/((skins|spooky|winter|wallpapers\/packs|wallpapers\/daycycle)\/[^/]+\.svg|wallpapers\/[^/]+\.(jpg|jpeg|png|webp)|staticos-(video|halloween)\.jpg)$/.test(p)) return p;
  return null;
}

/* build.json from the network: { stamp, raw } | { missing: true } | null */
async function latestStamp() {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), OFF.STAMP_MS) : 0;
  try {
    const res = await fetch(`/build.json?sw=${Date.now()}`, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (res.status === 404) return { missing: true };
    if (!res.ok) return null;
    const raw = await res.text();
    const stamp = JSON.parse(raw);
    return stamp && typeof stamp.build === 'string' && stamp.build ? { stamp, raw } : null;
  } catch (err) {
    return null;            /* offline, too slow, or not JSON (a captive portal) */
  } finally {
    clearTimeout(timer);
  }
}

async function adopt(stamp, raw) {
  if (meta.active && meta.active !== stamp.build) meta.previous = meta.active;
  meta.active = stamp.build;
  const cache = await shellCache(stamp.build);
  await cache.put('/build.json', new Response(raw || JSON.stringify(stamp), { headers: { 'content-type': 'application/json' } }));
  await saveMeta();
}

function pin(clientId, build) {
  if (!clientId || !build || meta.clients[clientId] === build) return null;
  meta.clients[clientId] = build;
  return saveMeta();
}

/* Delete every build's copy that is neither current nor running in an
   open tab, and forget tabs that have closed. */
async function prune() {
  await loadMeta();
  const live = new Set((await self.clients.matchAll({ includeUncontrolled: true, type: 'all' })).map(c => c.id));
  for (const id of Object.keys(meta.clients)) if (!live.has(id)) delete meta.clients[id];
  for (const id of Object.keys(meta.pics)) if (!live.has(id)) delete meta.pics[id];
  if (!meta.keep) meta.previous = null;
  const keep = new Set([meta.active, meta.keep ? meta.previous : null, ...Object.values(meta.clients)].filter(Boolean));
  for (const name of await caches.keys()) {
    const build = name.slice(OFF.SHELL.length);
    if (name.startsWith(OFF.SHELL) && !keep.has(build) && !warming.has(build)) await caches.delete(name);
  }
  for (const b of Object.keys(meta.complete)) if (!keep.has(b)) delete meta.complete[b];
  await saveMeta();
}

/* A response we can keep and tell apart later by the file's hash. */
async function tagged(res, hash) {
  const headers = new Headers(res.headers);
  headers.set(OFF.HASH, hash);
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

/* Fill a build's copy from /offline.json. Resolves true when every file
   is in it. Never runs twice at once for the same build. */
function warm(build) {
  if (!build) return Promise.resolve(false);
  if (warming.has(build)) return warming.get(build);
  const job = (async () => {
    const cache = await shellCache(build);
    /* the list is kept with the copy, so a finished copy costs no request */
    const read = async res => { try { return res ? JSON.parse(await res.text()) : null; } catch (err) { return null; } };
    let list = await read(await cache.match('/offline.json'));
    if (!list || list.build !== build) {
      const res = await fetch(`/offline.json?b=${encodeURIComponent(build)}`, { cache: 'no-store' }).catch(() => null);
      list = res && res.ok ? await read(res.clone()) : null;
      if (list && list.build === build) await cache.put('/offline.json', res);
    }
    /* no list (a host without one), or the list of a newer deploy: the
       next visit will be on that build anyway */
    if (!list || list.build !== build || !list.files || typeof list.files !== 'object') return false;
    const older = (await caches.keys()).filter(n => n.startsWith(OFF.SHELL) && n !== OFF.SHELL + build);
    const entries = Object.entries(list.files);
    let next = 0;
    let missing = 0;
    const one = async ([file, hash]) => {
      const key = '/' + file;
      const have = await cache.match(key);
      /* a copy the page itself loaded during this build counts as-is */
      if (have && (!have.headers.get(OFF.HASH) || have.headers.get(OFF.HASH) === hash)) return;
      for (const name of older) {
        const old = await (await caches.open(name)).match(key);
        if (old && old.headers.get(OFF.HASH) === hash) { await cache.put(key, old); return; }
      }
      const res = await fetch(key, { cache: 'no-cache', priority: 'low' });
      if (!res.ok) { missing++; return; }
      await cache.put(key, await tagged(res, hash));
    };
    const lane = async () => {
      while (next < entries.length) {
        const e = entries[next++];
        try { await one(e); } catch (err) { missing++; }
      }
    };
    await Promise.all([lane(), lane(), lane(), lane()]);
    const done = missing === 0;
    if (done) meta.complete[build] = true;
    else delete meta.complete[build];
    await saveMeta();
    return done;
  })().finally(() => warming.delete(build));
  warming.set(build, job);
  return job;
}

/* ---- answering requests ---------------------------------------------- */

async function onNavigate(event) {
  await loadMeta();
  /* "use the previous version once": this one start is not sent to the newest build */
  const held = meta.hold === true;
  if (held) { meta.hold = false; event.waitUntil(saveMeta()); }
  const latest = held ? null : await latestStamp();
  if (latest && latest.missing) {
    /* this host has no build.json: nothing to version a copy by */
    if (meta.active) { meta.active = null; event.waitUntil(saveMeta()); }
    return fetch(event.request);
  }
  if (latest && latest.stamp.build !== meta.active) await adopt(latest.stamp, latest.raw);
  const build = meta.active;
  if (!build) return fetch(event.request);
  const saved = pin(event.resultingClientId, build);
  if (saved) event.waitUntil(saved);

  const cache = await shellCache(build);
  const hit = await cache.match('/index.html');
  if (hit) return hit;
  try {
    const res = await fetch(event.request);
    if (res.ok && !res.redirected) event.waitUntil(cache.put('/index.html', res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    const any = await caches.match('/index.html');      /* any build beats the browser's error page */
    if (any) return any;
    throw err;
  }
}

async function onShell(event, key) {
  await loadMeta();
  const build = buildFor(event.clientId);
  if (!build) return fetch(event.request);
  const cache = await shellCache(build);
  const fresh = event.request.cache === 'no-store' || event.request.cache === 'reload';
  if (!fresh) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  let res;
  try {
    res = await fetch(event.request);
  } catch (err) {
    const any = (await cache.match(key)) || (await caches.match(key));
    if (any) return any;
    throw err;
  }
  if (res.ok && res.type === 'basic' && build === meta.active) {
    event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  return res;
}

async function onStamp(event) {
  await loadMeta();
  const url = new URL(event.request.url);
  const mine = event.clientId && meta.clients[event.clientId];
  const copy = async b => (b ? (await shellCache(b)).match('/build.json') : null);
  if (url.searchParams.has('running') && mine) {
    const hit = await copy(mine);
    if (hit) return hit;
  }
  try {
    return await fetch(event.request);
  } catch (err) {
    const hit = (await copy(mine)) || (await copy(meta.active));
    if (hit) return hit;
    throw err;
  }
}

async function onData(event) {
  const url = new URL(event.request.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(OFF.DATA);
  try {
    const res = await fetch(event.request);
    if (res.ok) event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    /* never fetched online yet: the build's copy, if this file is in its list */
    await loadMeta();
    const build = buildFor(event.clientId);
    const own = build ? await (await shellCache(build)).match(url.pathname) : null;
    if (own) return own;
    throw err;
  }
}

async function onFont(event) {
  const cache = await caches.open(OFF.FONTS);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    /* font files never change under a URL; the stylesheet can */
    if (new URL(event.request.url).hostname === 'fonts.googleapis.com') event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

/* ---- pictures the person has seen (js/core/piccache.js) -------------- */
const PIC_AT = 'x-staticos-kept';
const PIC_SIZE = 'x-staticos-size';
const PIC_NAME = /^staticos-pics(::(p[a-z0-9]{8}))?$/;
let picPuts = 0;
const picNoCors = new Set();     /* hosts that didn't let a picture be read: asked plainly from then on */

async function onPicture(event, url) {
  await loadMeta();
  const name = event.clientId && meta.pics[event.clientId];
  if (!name || !meta.picHosts.includes(url.host) || picNoCors.has(url.host)) return fetch(event.request);
  const max = meta.picMax || { count: 800, bytes: 60 * 1024 * 1024, days: 30 };
  const cache = await caches.open(name);
  const hit = await cache.match(url.href);
  if (hit && Date.now() - (Number(hit.headers.get(PIC_AT)) || 0) < max.days * 864e5) return hit;
  let res;
  try {
    /* read with CORS so what is kept is the picture itself, not an opaque box */
    res = await fetch(url.href, { mode: 'cors', credentials: 'omit', referrer: event.request.referrer, referrerPolicy: event.request.referrerPolicy });
  } catch (err) {
    if (hit) return hit;                  /* offline: an older copy beats none */
    /* a host that doesn't allow it: as if there were no worker (and no second try for it) */
    if (self.navigator.onLine !== false) picNoCors.add(url.host);
    return fetch(event.request);
  }
  if (!res.ok) return hit || res;
  if (/no-store|private/i.test(res.headers.get('cache-control') || '')) return res;
  const blob = await res.blob();
  const headers = new Headers(res.headers);
  headers.set(PIC_AT, String(Date.now()));
  headers.set(PIC_SIZE, String(blob.size));
  const kept = new Response(blob, { status: res.status, statusText: res.statusText, headers });
  event.waitUntil(cache.put(url.href, kept.clone()).then(() => trimPictures(name, max, !hit)).catch(() => {}));
  return kept;
}

/* past the cap, the oldest go first (looked at every 20 new pictures) */
async function trimPictures(name, max, added) {
  if (added && ++picPuts % 20 !== 1) return;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const sizes = [];
  let bytes = 0;
  for (const k of keys) { const r = await cache.match(k); const n = Number(r && r.headers.get(PIC_SIZE)) || 0; sizes.push(n); bytes += n; }
  let count = keys.length;
  for (let i = 0; i < keys.length && (count > max.count || bytes > max.bytes); i++) {
    await cache.delete(keys[i]);
    count--; bytes -= sizes[i];
  }
}

async function onPics(event) {
  await loadMeta();
  const id = event.source && event.source.id;
  const d = event.data || {};
  if (!id) return;
  if (typeof d.cache === 'string' && PIC_NAME.test(d.cache)) meta.pics[id] = d.cache;
  else delete meta.pics[id];
  if (Array.isArray(d.hosts)) meta.picHosts = d.hosts.filter(x => typeof x === 'string' && /^[a-z0-9.-]+(:\d+)?$/i.test(x)).slice(0, 40);
  const n = (v, lo, hi, dflt) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : dflt);
  if (d.max && typeof d.max === 'object') meta.picMax = { count: n(d.max.count, 1, 5000, 800), bytes: n(d.max.bytes, 1e5, 500e6, 60 * 1024 * 1024), days: n(d.max.days, 0, 365, 30) };
  await saveMeta();
  if (meta.pics[id]) event.waitUntil(trimPictures(meta.pics[id], meta.picMax || { count: 800, bytes: 60 * 1024 * 1024, days: 30 }, false).catch(() => {}));
  reply(event, { cache: meta.pics[id] || null });
}

async function onPicStats(event) {
  await loadMeta();
  const id = event.source && event.source.id;
  const name = id && meta.pics[id];
  if (!name) { reply(event, { cache: null, count: 0, bytes: 0 }); return; }
  const cache = await caches.open(name);
  let bytes = 0;
  const keys = await cache.keys();
  for (const k of keys) { const r = await cache.match(k); bytes += Number(r && r.headers.get(PIC_SIZE)) || 0; }
  reply(event, { cache: name, count: keys.length, bytes });
}

/* anything that goes wrong in here is answered as if there were no worker */
const failOpen = (event, fn) => fn().catch(() => fetch(event.request));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith(PREFIX)) return;          /* the proxy's (above) */
    if (req.headers.has('range')) return;                 /* media seeking */
    if (req.mode === 'navigate') {
      if (shellKey(url) === '/index.html') event.respondWith(failOpen(event, () => onNavigate(event)));
      return;
    }
    if (url.pathname === '/build.json') { event.respondWith(failOpen(event, () => onStamp(event))); return; }
    const key = shellKey(url);
    if (key) { event.respondWith(failOpen(event, () => onShell(event, key))); return; }
    if (/^\/data\/(i18n\/)?[^/]+\.json$/.test(url.pathname) && url.pathname !== '/data/broadcast.json') {
      event.respondWith(failOpen(event, () => onData(event)));
    }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(failOpen(event, () => onFont(event)));
    return;
  }
  /* a picture from a host the page listed (before the list is read back, every picture asks onPicture) */
  if (req.destination === 'image' && (!meta || meta.picHosts.includes(url.host))) {
    event.respondWith(failOpen(event, () => onPicture(event, url)));
  }
});

/* ---- the page talking to the copy (js/core/offline.js) ----------------- */

const reply = (event, data) => { try { if (event.ports && event.ports[0]) event.ports[0].postMessage(data); } catch (err) { /* page gone */ } };

async function onWarm(event) {
  await loadMeta();
  const id = event.source && event.source.id;
  if (!id || !meta.clients[id]) {
    /* A tab that did not open through this worker — the first visit, or
       a hard reload — loaded from the network, so it runs whatever build
       the network has now. */
    const latest = await latestStamp();
    if (latest && latest.missing) return;
    if (latest && latest.stamp.build !== meta.active) await adopt(latest.stamp, latest.raw);
    if (id && meta.active) await pin(id, meta.active);
  }
  if (!meta.active) return;
  await warm(meta.active);
  await prune();
}

async function onStatus(event) {
  await loadMeta();
  const id = event.source && event.source.id;
  const builds = (await caches.keys()).filter(n => n.startsWith(OFF.SHELL)).map(n => n.slice(OFF.SHELL.length));
  reply(event, {
    active: meta.active,
    complete: !!(meta.active && meta.complete[meta.active]),
    warming: !!(meta.active && warming.has(meta.active)),
    running: (id && meta.clients[id]) || null,
    builds,
    keep: meta.keep === true,
    /* the build before this one, when it was asked to be kept and its copy is whole */
    previous: meta.keep && meta.previous && builds.includes(meta.previous) && meta.complete[meta.previous] ? meta.previous : null,
  });
}

async function onAdopt(event) {
  await loadMeta();
  const st = event.data && event.data.stamp;
  if (st && typeof st.build === 'string' && st.build && st.build !== meta.active) await adopt(st, JSON.stringify(st));
  if (event.data && event.data.once === true) { meta.hold = true; await saveMeta(); }
  reply(event, { active: meta.active });
}

async function onKeep(event) {
  await loadMeta();
  const on = !!(event.data && event.data.on);
  if (meta.keep !== on) {
    meta.keep = on;
    if (!on) meta.previous = null;
    await saveMeta();
    if (!on) await prune();
  }
  reply(event, { keep: meta.keep });
}

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  const job = type === 'staticos:warm' ? onWarm(event)
    : type === 'staticos:status' ? onStatus(event)
      : type === 'staticos:adopt' ? onAdopt(event)
        : type === 'staticos:keep' ? onKeep(event)
          : type === 'staticos:pics' ? onPics(event)
            : type === 'staticos:pics-stats' ? onPicStats(event)
              : null;
  if (job) event.waitUntil(job.catch(err => reply(event, { error: String((err && err.message) || err) })));
});

self.addEventListener('activate', event => event.waitUntil(prune().catch(() => {})));
