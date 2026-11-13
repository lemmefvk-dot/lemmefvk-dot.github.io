/* ============================================================
   halloween-fun.js — the shell half of Halloween (js/core/halloween.js
   holds the dates, the treats and their art).

     · stickers you got trick-or-treating, on the desktop: drag to
       move, right-click or Delete to remove (portal.halloween.stickers)
     · the cursor you chose to wear (prefs.cursorSkin)
     · the dock pumpkin's answer: a treat toast with a button that
       applies it, or the trick — the whole screen upside down for
       five seconds, then back
     · "boo": type it anywhere that isn't a text field and the
       desktop icons scatter and drift back
     · jump-scare mode (prefs.jumpScares, OFF unless you turn it on
       in Settings → Halloween): a rare spooky pop-up — never two
       within six minutes, never while a game is in front, full
       screen or in Game Mode, never in Do Not Disturb or with the
       tab hidden, and calm (no jump, no shake) under reduced motion

   Only "boo", jump scares and the pumpkin itself are seasonal;
   stickers and cursors you earned keep working after 1 November.
   Everything drawn here is drawn here — no images are fetched.

   Bus in:  halloween:trickortreat (halloween.js), spooky:scare
            ({ preview }) from Settings
   Bus out: egg:found { id: 'boo' }, halloween:boo, halloween:flip
            { on }, halloween:scare { kind, calm, preview }
   ============================================================ */
import { covered } from '../core/cover.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as wm from '../core/wm.js';
import * as HW from '../core/halloween.js';
import { GAME_APPS } from '../core/gamemode.js';

const CSS_ID = 'feat-halloween-css';
const MIN_GAP = 6 * 60 * 1000;     /* never two jump scares within six minutes */
const SPREAD = 8 * 60 * 1000;      /* …and the next one lands 6–14 minutes later */
const RETRY = 60 * 1000;           /* blocked (a game, full screen…): look again in a minute */
const NO_SCARE_APPS = new Set([...GAME_APPS, 'multiplayer']);

const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

const typing = () => {
  const el = document.activeElement;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};

/* ---- jump-scare art: three faces, drawn here ---- */
const SCARES = [
  { id: 'ghost', word: 'BOO!', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 420">'
    + '<defs><radialGradient id="sf" cx="50%" cy="32%" r="72%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#c6caf2"/></radialGradient></defs>'
    + '<path d="M60 410V190a140 140 0 0 1 280 0v220q-23.3-34-46.7 0t-46.6 0-46.7 0-46.7 0-46.6 0-46.7 0z" fill="url(#sf)"/>'
    + '<ellipse cx="145" cy="185" rx="36" ry="56" fill="#0b0612"/><ellipse cx="255" cy="185" rx="36" ry="56" fill="#0b0612"/>'
    + '<circle cx="145" cy="198" r="8" fill="#ff2b4a"/><circle cx="255" cy="198" r="8" fill="#ff2b4a"/>'
    + '<ellipse cx="200" cy="305" rx="46" ry="66" fill="#0b0612"/></svg>' },
  { id: 'skull', word: 'BOO!', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 420">'
    + '<path d="M200 30C95 30 45 105 45 190c0 62 32 104 75 118v42c0 18 14 30 30 30h100c16 0 30-12 30-30v-42c43-14 75-56 75-118 0-85-50-160-155-160z" fill="#efe6d2"/>'
    + '<path d="M110 185c0-38 58-46 74-10 14 32-10 62-40 58-22-3-34-22-34-48z" fill="#120808"/>'
    + '<path d="M290 185c0-38-58-46-74-10-14 32 10 62 40 58 22-3 34-22 34-48z" fill="#120808"/>'
    + '<circle cx="152" cy="200" r="8" fill="#ff3046"/><circle cx="248" cy="200" r="8" fill="#ff3046"/>'
    + '<path d="M200 245l-20 40h40z" fill="#120808"/>'
    + '<path d="M125 318q75 22 150 0" fill="none" stroke="#120808" stroke-width="5"/>'
    + '<path d="M150 322v42M175 326v46M200 327v47M225 326v46M250 322v42" stroke="#120808" stroke-width="5" stroke-linecap="round"/></svg>' },
  { id: 'pumpkin', word: 'TRICK OR TREAT!', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + `<defs>${HW.PUMPKIN_SYMBOL}<radialGradient id="sg"><stop offset="0" stop-color="#ffb030" stop-opacity=".75"/><stop offset="1" stop-color="#ff7a00" stop-opacity="0"/></radialGradient></defs>`
    + '<circle cx="50" cy="58" r="50" fill="url(#sg)"/><use href="#pk" width="100" height="100"/></svg>' },
];

function loadCss() {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  document.head.appendChild(Object.assign(document.createElement('link'), { id: CSS_ID, rel: 'stylesheet', href: 'css/feat-halloween.css' }));
}

export function mountHalloweenFun(host) {
  const { h, icon, on, clear } = api;
  loadCss();
  const offs = [];
  const desktop = () => host.querySelector('.desktop');

  /* ================ cursor ================ */
  /* Halloween's and the advent calendar's (js/core/winter.js) alike */
  const cursorStyle = h('style', { id: 'hw-cursors' });
  cursorStyle.textContent = HW.allCursors().map(c => {
    const sel = `html[data-cursor-skin="${c.id}"]`;
    const u = `url("${HW.artUrl('cursor', c.id)}") 4 3`;
    return `${sel} body,${sel} .desktop,${sel} .win{cursor:${u},auto}\n`
      + `${sel} button,${sel} a,${sel} [role="button"],${sel} .dock__item,${sel} .desk-icon,${sel} .sticker{cursor:${u},pointer}`;
  }).join('\n');
  document.head.appendChild(cursorStyle);

  function applyCursor() {
    const id = store.get('prefs.cursorSkin');
    const root = document.documentElement;
    if (id && id !== 'none' && HW.owns('cursor', id)) root.dataset.cursorSkin = id;
    else delete root.dataset.cursorSkin;
  }

  /* ================ stickers ================ */
  const layer = h('div.stickers');
  let dragging = false;
  let paintQueued = false;

  function paintStickers() {
    if (dragging) { paintQueued = true; return; }
    const d = desktop();
    if (d && layer.parentNode !== d) d.appendChild(layer);
    clear(layer);
    const list = HW.state().stickers;
    for (const s of list) layer.appendChild(stickerEl(s));
    /* pack stickers (js/core/stickerpack.js) bring their art in only when one is on the desktop */
    if (!HW.packLoaded() && list.some(s => HW.isPackSticker(s.id))) HW.loadPack().then(() => paintStickers(), () => {});
  }

  function stickerEl(s) {
    const user = HW.userSticker(s);
    const t = user ? { name: s.name || 'Your' } : HW.find('sticker', s.id);
    const el = h('button.sticker' + (user ? '.sticker--user' : ''), {
      type: 'button',
      'aria-label': `${t.name} sticker. Drag or use the arrow keys to move it, Delete to remove it.`,
      dataset: { uid: s.uid, sticker: s.id },
      style: { left: `${s.x}px`, top: `${s.y}px`, ...(user ? { width: `${s.w || 120}px`, height: `${s.h || 120}px` } : {}) },
      oncontextmenu: e => {
        e.preventDefault(); e.stopPropagation();
        api.menu([
          { label: 'Remove Sticker', icon: 'trash', onClick: () => HW.removeSticker(s.uid) },
          { label: 'Remove All Stickers', icon: 'x', danger: true, onClick: () => HW.clearStickers() },
        ], e.clientX, e.clientY);
      },
      ondblclick: e => e.stopPropagation(),
      onkeydown: e => {
        const step = e.shiftKey ? 32 : 8;
        const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (mv) {
          e.preventDefault();
          HW.moveSticker(s.uid, s.x + mv[0], s.y + mv[1]);
          requestAnimationFrame(() => layer.querySelector(`[data-uid="${s.uid}"]`)?.focus());
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          HW.removeSticker(s.uid);
        }
      },
    }, h('img', { src: user ? '' : HW.artUrl('sticker', s.id), alt: '', draggable: 'false' }));
    if (user) {
      /* the picture is a file in ~/Pictures/Stickers; if it was deleted the sticker goes too */
      import('../core/media.js').then(m => m.urlOf(s.user)).then(u => {
        if (u) el.firstChild.src = u; else HW.removeSticker(s.uid);
      }).catch(() => {});
    }

    /* pointer drag — nothing moves until the pointer has travelled a few px */
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY;
      let moved = false, x = s.x, y = s.y;
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) { moved = true; dragging = true; el.classList.add('is-dragging'); el.setPointerCapture?.(ev.pointerId); }
        x = Math.max(0, Math.min(innerWidth - 60, s.x + dx));
        y = Math.max(24, Math.min(innerHeight - 60, s.y + dy));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!moved) return;
        el.classList.remove('is-dragging');
        dragging = false;
        HW.moveSticker(s.uid, x, y);
        if (paintQueued) { paintQueued = false; paintStickers(); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    return el;
  }

  /* ================ trick or treat ================ */
  let flipT = 0, flipT2 = 0;
  function flip() {
    const b = document.body;
    clearTimeout(flipT); clearTimeout(flipT2);
    b.classList.add('hw-flip');
    b.classList.toggle('hw-flip--instant', reduced());
    void host.offsetWidth;                      /* commit the start so the turn animates */
    b.classList.add('is-upside-down');
    bus.emit('halloween:flip', { on: true });
    flipT = setTimeout(() => {
      b.classList.remove('is-upside-down');
      bus.emit('halloween:flip', { on: false });
      flipT2 = setTimeout(() => b.classList.remove('hw-flip', 'hw-flip--instant'), 900);
    }, HW.FLIP_MS);
  }

  const WHERE = {
    wallpaper: 'It is in Settings → Wallpaper too.',
    cursor: 'Change it any time in Settings → Halloween.',
    sticker: 'Put more on the desktop from Settings → Halloween.',
  };
  const APPLY = {
    wallpaper: id => ({ label: 'Use it', onClick: () => HW.useWallpaper(id) }),
    cursor: id => ({ label: 'Wear it', onClick: () => HW.setCursor(id) }),
    sticker: id => ({ label: 'Place it', onClick: () => HW.placeSticker(id) }),
  };

  function onKnock(r) {
    if (!r) return;
    if (r.kind === 'trick') {
      api.notify({ app: 'Trick or Treat', icon: 'ghost', timeout: HW.FLIP_MS + 1500,
        title: 'Trick!', message: 'Everything is upside down for five seconds. Come back tomorrow for another knock.' });
      flip();
    } else if (r.kind === 'treat') {
      const t = r.treat;
      api.notify({ app: 'Trick or Treat', icon: 'candy', timeout: 14000,
        title: `Treat! ${t.name}`,
        message: r.extra
          ? 'You already have every treat — here is another sticker for the desktop.'
          : `A new ${HW.TYPE_LABEL[t.type]} is yours. ${WHERE[t.type]}`,
        actions: [APPLY[t.type](t.id), { label: 'Later' }] });
    } else if (r.kind === 'done') {
      api.notify({ app: 'Trick or Treat', icon: 'pumpkin', timeout: 6000,
        title: 'You already knocked today',
        message: `Today you got ${HW.describe(r.prev)}. The pumpkin opens again tomorrow.` });
    }
  }

  /* ================ "boo" ================ */
  let typed = '';
  let booBusy = false;

  function ghostSwoop() {
    const d = desktop();
    if (!d || typeof d.animate !== 'function') return;
    const g = h('img.hw-ghost', { src: HW.artUrl('sticker', 'ghost'), alt: '', 'aria-hidden': 'true' });
    d.appendChild(g);
    const vw = innerWidth, y = innerHeight * 0.32;
    const at = (x, yy, r, o) => ({ transform: `translate(${x}px, ${yy}px) rotate(${r}deg)`, opacity: o });
    g.animate([at(-140, y, -8, 0), at(vw * 0.18, y - 30, -2, 0.95), at(vw * 0.5, y - 90, 6, 0.95), at(vw * 0.82, y - 20, -4, 0.95), at(vw + 140, y, -6, 0)],
      { duration: 2100, easing: 'ease-in-out' }).finished.catch(() => {}).finally(() => g.remove());
  }

  function boo() {
    if (booBusy) return false;
    const icons = [...host.querySelectorAll('.desk-icons:not(.hidden) .desk-icon')];
    if (!icons.length || typeof icons[0].animate !== 'function') return false;
    booBusy = true;
    const calm = reduced();
    const vw = innerWidth, vh = innerHeight;
    const anims = icons.map((el, i) => {
      if (calm) {
        return el.animate([{ opacity: 1 }, { opacity: 0.15, offset: 0.3 }, { opacity: 0.15, offset: 0.6 }, { opacity: 1 }],
          { duration: 1400, easing: 'ease-in-out' });
      }
      const r = el.getBoundingClientRect();
      const tx = (0.15 + Math.random() * 0.7) * vw - (r.left + r.width / 2);
      const ty = (0.18 + Math.random() * 0.6) * vh - (r.top + r.height / 2);
      const rot = (Math.random() - 0.5) * 80;
      const out = `translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px) rotate(${rot.toFixed(0)}deg) scale(.92)`;
      return el.animate([
        { transform: 'none', offset: 0 },
        { transform: out, offset: 0.3 },
        { transform: out, offset: 0.55 },
        { transform: 'none', offset: 1 },
      ], { duration: 2000, delay: i * 40, easing: 'cubic-bezier(.3,.7,.2,1)' });
    });
    if (!calm) ghostSwoop();
    Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => { booBusy = false; });
    bus.emit('halloween:boo', { icons: icons.length, calm });
    bus.emit('egg:found', { id: 'boo' });
    return true;
  }

  function onBooKey(e) {
    if (!HW.inSeason()) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (covered() || typing()) { typed = ''; return; }
    /* a game in front reads letters itself (Type Rush, for one) — not a secret word */
    const w = wm.getActive();
    if (w && !w.min && NO_SCARE_APPS.has(w.appId)) { typed = ''; return; }
    const k = String(e.key || '').toLowerCase();
    if (k.length !== 1 || k < 'a' || k > 'z') { typed = ''; return; }
    typed = (typed + k).slice(-3);
    if (typed === 'boo') { typed = ''; boo(); }
  }

  /* ================ jump scares ================ */
  let nextAt = 0;
  let scareEl = null;
  let scareT = 0;

  function plan(from = Date.now()) {
    const last = Number(store.get('session.lastScare')) || 0;
    nextAt = Math.max(from + MIN_GAP + Math.random() * SPREAD, last + MIN_GAP);
  }

  /** Why a scare must wait right now — or null when one may come. */
  function blockedBy() {
    if (typeof document !== 'undefined' && document.hidden) return 'hidden';
    if (covered()) return 'covered';
    if (document.fullscreenElement || document.webkitFullscreenElement) return 'fullscreen';
    if (document.documentElement.dataset.gamemode === 'on') return 'game mode';
    const w = wm.getActive();
    if (w && !w.min && NO_SCARE_APPS.has(w.appId)) return 'game';
    if (store.get('prefs.dnd')) return 'do not disturb';
    if (scareEl) return 'busy';
    return null;
  }

  function endScare() {
    if (!scareEl) return;
    const el = scareEl;
    scareEl = null;
    clearTimeout(scareT);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 280);
  }

  function scare({ preview = false } = {}) {
    if (scareEl) return false;
    store.set('session.lastScare', Date.now());   /* a preview counts toward the gap too */
    plan();
    const calm = reduced();
    const s = SCARES[Math.floor(Math.random() * SCARES.length) % SCARES.length];
    scareEl = h('div.scare', {
      class: calm ? 'is-calm' : null, role: 'img', dataset: { scare: s.id },
      'aria-label': `${s.word} A jump-scare pop-up — it closes by itself, or click or press Escape.`,
    }, h('div.scare__art', { html: s.svg }), h('div.scare__boo', { text: s.word }));
    scareEl.addEventListener('pointerdown', endScare);
    host.appendChild(scareEl);
    scareT = setTimeout(endScare, calm ? 2600 : 1900);
    bus.emit('halloween:scare', { kind: s.id, calm, preview });
    return true;
  }

  function checkScare() {
    if (!HW.inSeason() || !store.get('prefs.jumpScares')) { nextAt = 0; return; }
    if (!nextAt) { plan(); return; }
    if (Date.now() < nextAt) return;
    if (blockedBy()) { nextAt = Date.now() + RETRY; return; }
    scare();
  }

  /* ================ wiring ================ */
  applyCursor();
  paintStickers();
  offs.push(
    store.sub('prefs', applyCursor),
    store.sub('portal.halloween', () => { applyCursor(); paintStickers(); }),
    bus.on('halloween:trickortreat', onKnock),
    bus.on('spooky:scare', o => scare({ preview: !!o?.preview })),
    bus.on('tick:5s', checkScare),
    on(window, 'keydown', onBooKey),
    on(window, 'keydown', e => { if (e.key === 'Escape') endScare(); }),
  );

  return () => {
    offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    clearTimeout(flipT); clearTimeout(flipT2); clearTimeout(scareT);
    document.body.classList.remove('hw-flip', 'hw-flip--instant', 'is-upside-down');
    endScare();
    layer.remove();
    cursorStyle.remove();
    delete document.documentElement.dataset.cursorSkin;
  };
}

export default mountHalloweenFun;
