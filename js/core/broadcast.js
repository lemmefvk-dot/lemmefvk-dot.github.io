/* ============================================================
   broadcast.js — announcements and events from the developer.

   The developer writes one in the Developer Room; their Discord bot
   publishes it (only after they approve it in Discord) as
   data/broadcast.json. Every open StaticOS reads that file on boot,
   every 90 seconds and whenever the tab comes back, and shows:

     · an announcement banner under the menu bar (dismissible; a
       dismissed one stays dismissed), with an optional button that
       opens a link or a StaticOS app — only when clicked
     · a promoted site: a card in the bottom-left corner with its
       name, a line about it, an optional picture and a Visit button
       — it opens only when clicked, and it can be dismissed
     · an event: confetti, snow or disco colours, and/or one accent
       for everyone, until it ends. Visitors can turn events off
       (Settings › Desktop), reduced motion keeps them still, and
       Game Mode pauses them.

   Nothing here changes anyone's saved settings: the accent is
   painted over the top and the person's own comes back when the
   event ends. Everything is re-checked with broadcast-schema.js.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import * as THEMES from './themes.js';
import { cleanBroadcast, ACCENTS } from './broadcast-schema.js';
import * as live_ from '../portal/live.js';
import { verifyBroadcast } from './bcsign.js';

const TOPIC = 'broadcast';
const CACHE_KEY = 'staticos.bc.cache';   /* the last valid broadcast, so it survives a reload */
const DISMISS_KEY = 'session.bcDismissed';

let host = null;
let live = null;            /* the published broadcast */
let preview = null;         /* a developer's local preview, wins while set */
let banner = null;
let promoEl = null;
let fx = null;              /* { stop } */
let accentOn = null;
let endTimer = 0;

const current = () => {
  const b = preview || live;
  return b && b.until > Date.now() ? b : null;
};
const eventsOn = () => store.get('prefs.devEvents') !== false;
const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* A broadcast arrives over the live channel as { p, sig }: p is the JSON
   the developer signed, sig proves it was them (only the developer's key
   makes a signature the baked-in public key accepts). Anyone can send to a
   public channel, so an unsigned or wrongly-signed message is ignored. */
async function onLiveMessage(text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (!msg || typeof msg.p !== 'string' || typeof msg.sig !== 'string') return;
  let okSig = false;
  try { okSig = await verifyBroadcast(msg.p, msg.sig); } catch (e) { okSig = false; }
  if (!okSig) return;                                    /* not from the developer */
  let value;
  try { value = JSON.parse(msg.p); } catch (e) { return; }
  const c = cleanBroadcast(value);
  if (!c.ok) return;
  if (c.value.clear) { saveCache(null); setLive(null); return; }
  saveCache(c.value);
  setLive(c.value);
}

function saveCache(v) {
  try { if (v) localStorage.setItem(CACHE_KEY, JSON.stringify(v)); else localStorage.removeItem(CACHE_KEY); } catch (e) {}
}
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = cleanBroadcast(JSON.parse(raw));
    return c.ok && !c.value.clear && c.value.until > Date.now() ? c.value : null;
  } catch (e) { return null; }
}

function setLive(b) {
  const was = live?.id;
  live = b;
  if ((b?.id || null) !== (was || null)) apply();
}

/* ---------------- the banner ---------------- */
function dismissed(id) {
  const list = store.get(DISMISS_KEY, []);
  return Array.isArray(list) && list.includes(id);
}
function dismiss(id) {
  const list = (store.get(DISMISS_KEY, []) || []).filter(x => x !== id);
  store.set(DISMISS_KEY, [...list, id].slice(-20));
  paintBanner();
  paintPromo();
}

function openButton(btn) {
  if (btn.url) { window.open(btn.url, '_blank', 'noopener,noreferrer'); return; }
  if (btn.app) window.StaticAPI?.openApp(btn.app, { ...(btn.opts || {}) });
}

function paintBanner() {
  banner?.remove(); banner = null;
  const b = current();
  const a = b?.announcement;
  if (!a || !host || (!preview && dismissed(b.id))) return;
  const ic = a.style === 'warning' ? 'alert' : a.style === 'event' ? 'sparkles' : 'bell';
  banner = h(`div.bc-banner.bc-banner--${a.style}`, { role: 'status', 'aria-live': 'polite' },
    h('span.bc-banner__ic', icon(ic)),
    h('div.bc-banner__tx',
      h('small', { text: preview ? 'Preview — only you can see this' : 'From the developer' }),
      a.title ? h('b', { text: a.title }) : null,
      a.message ? h('span', { text: a.message }) : null),
    a.button ? h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => openButton(a.button) },
      a.button.url ? icon('external-link') : icon('arrow-right'), h('span', { text: a.button.label })) : null,
    h('button.ibtn', { type: 'button', 'aria-label': 'Dismiss', onclick: () => (preview ? stopPreview() : dismiss(b.id)) }, icon('x')));
  host.appendChild(banner);
}

/* ---------------- the promoted site ---------------- */
function paintPromo() {
  promoEl?.remove(); promoEl = null;
  const b = current();
  const p = b?.promo;
  const key = b ? `${b.id}:promo` : '';
  if (!p || !host || (!preview && dismissed(key))) return;
  let hostName = '';
  try { hostName = new URL(p.url).hostname.replace(/^www\./, ''); } catch (e) { return; }
  const visit = () => window.open(p.url, '_blank', 'noopener,noreferrer');
  promoEl = h('aside.bc-promo', { 'aria-label': `Featured site: ${p.title}` },
    p.image ? h('div.bc-promo__img', h('img', { src: p.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
      onerror: e => e.currentTarget.parentNode?.remove() })) : null,
    h('div.bc-promo__body',
      h('small', { text: preview ? 'Preview — only you can see this' : 'Featured by the developer' }),
      h('b', { text: p.title }),
      p.message ? h('span', { text: p.message }) : null,
      h('div.bc-promo__row',
        h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: visit }, icon('external-link'), h('span', { text: p.label })),
        h('small.bc-promo__host', { text: hostName }))),
    h('button.ibtn.bc-promo__x', { type: 'button', 'aria-label': 'Dismiss', onclick: () => (preview ? stopPreview() : dismiss(key)) }, icon('x')));
  host.appendChild(promoEl);
}

/* ---------------- the event ---------------- */
function paintAccent() {
  const b = current();
  const want = eventsOn() && b?.event?.accent ? b.event.accent : null;
  if (want) { THEMES.apply(want); accentOn = want; }
  else if (accentOn) { accentOn = null; THEMES.apply(store.get('prefs.accent')); }
}

function paintEffect() {
  fx?.stop(); fx = null;
  const b = current();
  const effect = b?.event?.effect;
  if (!effect || effect === 'none' || !eventsOn() || !host) return;
  if (effect === 'disco') { fx = disco(); return; }
  fx = particles(effect);
}

function disco() {
  if (reduced()) return { stop() {} };
  let i = 0;
  const t = setInterval(() => {
    if (document.hidden || document.documentElement.dataset.gamemode === 'on') return;
    THEMES.apply(ACCENTS[i++ % ACCENTS.length]);
  }, 1400);
  return { stop() { clearInterval(t); paintAccentRestore(); } };
}
function paintAccentRestore() {
  const b = current();
  THEMES.apply(eventsOn() && b?.event?.accent ? b.event.accent : store.get('prefs.accent'));
}

function particles(kind) {
  const cv = h('canvas.bc-fx', { 'aria-hidden': 'true' });
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return { stop() {} }; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  size();
  window.addEventListener('resize', size);
  const colors = ['#ff456d', '#ffd36e', '#6ee7b7', '#93c5fd', '#c4b5fd', '#f9a8d4'];
  const N = kind === 'snow' ? 90 : 120;
  const P = Array.from({ length: N }, () => spawn(true));
  function spawn(anywhere) {
    return {
      x: Math.random() * innerWidth, y: anywhere ? Math.random() * innerHeight : -12,
      vx: (Math.random() - 0.5) * (kind === 'snow' ? 0.4 : 1.2), vy: kind === 'snow' ? 0.4 + Math.random() * 0.8 : 1.2 + Math.random() * 1.8,
      r: kind === 'snow' ? 1 + Math.random() * 2.4 : 3 + Math.random() * 4,
      a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.2, c: colors[(Math.random() * colors.length) | 0],
    };
  }
  let raf = 0;
  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (document.hidden || document.documentElement.dataset.gamemode === 'on') { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      if (p.y > innerHeight + 12) Object.assign(p, spawn(false));
      if (kind === 'snow') {
        ctx.globalAlpha = 0.8; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = 0.9; ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
      }
    }
  };
  if (reduced()) {
    /* still: one frame, no motion */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of P) { ctx.globalAlpha = 0.5; ctx.fillStyle = kind === 'snow' ? '#fff' : p.c; ctx.fillRect(p.x, p.y, p.r, p.r); }
  } else raf = requestAnimationFrame(draw);
  return { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', size); cv.remove(); } };
}

/* ---------------- apply ---------------- */
function apply() {
  clearTimeout(endTimer);
  const b = current();
  paintBanner();
  paintPromo();
  paintAccent();
  paintEffect();
  if (b) endTimer = setTimeout(apply, Math.min(2 ** 31 - 1, Math.max(1000, b.until - Date.now() + 50)));
  bus.emit('broadcast:change', b);
}

/** A developer's local preview: shown only on this device, until stopped. */
export function startPreview(raw) {
  const c = cleanBroadcast(raw);
  if (!c.ok || c.value.clear) return c;
  preview = { ...c.value, id: 'preview' };
  apply();
  return c;
}
export function stopPreview() { preview = null; apply(); }
export const isPreviewing = () => !!preview;
export const published = () => live;

let started = false;
export function init(el) {
  if (started) return;
  started = true;
  host = el;
  /* a broadcast the developer sent while this tab was online is cached, so
     it keeps showing across reloads until it ends */
  live = loadCache();
  if (live) apply();
  live_.subscribe(TOPIC, onLiveMessage);
  /* the developer's own device shows what it just published without waiting
     for the broker to echo it back */
  window.addEventListener('staticos:bc-self', e => {
    const d = e.detail; if (d && d.p && d.sig) onLiveMessage(JSON.stringify({ p: d.p, sig: d.sig }));
  });
  /* the person's own accent comes back through main.js on any prefs change;
     paint the event's over it again, and follow the events switch */
  store.sub('prefs', () => { if (current()) { paintAccent(); if (!eventsOn() && fx) { fx.stop(); fx = null; } else if (eventsOn() && !fx) paintEffect(); } });
}

export default { init, startPreview, stopPreview, isPreviewing, published };
