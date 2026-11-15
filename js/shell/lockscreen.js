/* ============================================================
   lockscreen.js — the lock / sleep curtain and the fake restart.

   Lock Screen 2.0: the wallpaper shows through a frosted curtain
   with the big clock and date, your profile, and your most recent
   notifications (read from the same prefs.notiLog the notification
   centre keeps). Unlocking plays a short zoom-and-fade.

   Two ways in:
     • no PIN set  → no field at all: "Press Enter to open" (a field that
       checks nothing would only pretend).
     • prefs.lockPin set → a PIN pad; the digits must match.
     • several people on this computer, and this one has a PIN or
       password (js/core/profiles.js) → the field must match it.
   The clock has four looks (prefs.lockClock: classic, bold, stacked,
   analog) and the curtain can have a picture of its own
   (prefs.lockWallpaper: a wallpaper id; empty is the desktop's, shown
   through the glass). When Do Not Disturb kept notifications off the
   screen since you locked, a line says how many (js/core/dndheld.js).
   Either way this is a FRONTEND lock only — StaticOS runs in your
   browser and cannot truly stop someone using the computer, and the
   PIN can be changed from this screen. It is labelled as such.
   ============================================================ */
import { cover } from '../core/cover.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as profiles from '../core/profiles.js';
import * as WP from '../portal/wallpapers.js';
import * as HELD from '../core/dndheld.js';
import { t } from '../core/i18n.js';

export const CLOCK_STYLES = { classic: 'Classic', bold: 'Bold', stacked: 'Stacked', analog: 'Analogue' };
/** The clock look in use (an unknown value is the classic one). */
export const clockStyle = () => { const v = store.get('prefs.lockClock'); return Object.prototype.hasOwnProperty.call(CLOCK_STYLES, v) ? v : 'classic'; };
/** Wallpapers the lock screen can use: the ones that are a picture, not the drawn scene. */
export const lockPapers = () => WP.list(store).filter(w => w.kind !== 'scene');
/** The lock screen's own wallpaper, or null (the desktop shows through). */
export const lockPaper = () => { const id = store.get('prefs.lockWallpaper'); const w = id ? WP.byId(store, id) : null; return w && w.kind !== 'scene' ? w : null; };

const SVGNS = 'http://www.w3.org/2000/svg';
function analogFace(d, size = 148) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'lock__analog'); svg.setAttribute('role', 'img');
  const add = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
  add('circle', { r: 47, fill: 'rgba(255,255,255,.06)', stroke: 'rgba(255,255,255,.5)', 'stroke-width': 1.2 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r1 = i % 3 ? 41 : 38;
    add('line', { x1: Math.sin(a) * r1, y1: -Math.cos(a) * r1, x2: Math.sin(a) * 44, y2: -Math.cos(a) * 44, stroke: '#fff', 'stroke-width': i % 3 ? 1 : 2, 'stroke-linecap': 'round' });
  }
  const hand = (deg, len, w, col) => add('line', { x1: 0, y1: 0, x2: Math.sin(deg * Math.PI / 180) * len, y2: -Math.cos(deg * Math.PI / 180) * len, stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' });
  const mins = d.getMinutes() + d.getSeconds() / 60;
  hand(((d.getHours() % 12) + mins / 60) * 30, 23, 3.2, '#fff');
  hand(mins * 6, 35, 2.2, '#fff');
  hand(d.getSeconds() * 6, 39, 1, 'var(--accent)');
  add('circle', { r: 2.4, fill: '#fff' });
  return svg;
}

const OUT = 320;    /* .lock.is-out fade-out, with headroom */
const PINLEN = 4;

export function mountLock(host) {
  const { fmt, render, notify } = api;

  /* ---------------- state ---------------- */
  const S = { el: null, timer: null, shaken: false, entry: '', setup: null, lockedAt: 0 };

  const timeEl = h('div.lock__time');
  const dateEl = h('div.lock__date');

  function paintClock() {
    const d = new Date();
    const h24 = !!store.get('prefs.h24');
    const c = fmt.fmtClock(d, h24);
    const style = clockStyle();
    if (S.el) S.el.dataset.clock = style;
    if (style === 'analog') {
      const face = analogFace(d);
      face.setAttribute('aria-label', `${c.time}${h24 ? '' : ` ${c.ap}`}`);
      render(timeEl, face);
    } else if (style === 'stacked') {
      const [hh, mm] = c.time.split(':');
      render(timeEl, h('span.lock__hh', { text: hh }), h('span.lock__mm', { text: mm }), !h24 && h('span.lock__ap', { text: c.ap }));
    } else {
      render(timeEl, c.time, !h24 && h('span.lock__ap', { text: c.ap }));
    }
    dateEl.textContent = fmt.fmtDateLong(d);
  }

  /* how many notifications Do Not Disturb held since the screen was locked */
  const heldEl = h('div.lock__held', { role: 'status' });
  function paintHeld() {
    const n = HELD.count(S.lockedAt);
    heldEl.hidden = !n;
    heldEl.textContent = n ? `${n} notification${n === 1 ? '' : 's'} held by Do Not Disturb since you locked` : '';
  }

  const pin = () => {
    const v = store.get('prefs.lockPin');
    return (typeof v === 'string' && /^\d{4,8}$/.test(v)) ? v : null;
  };

  /* recent notifications, newest first, from the persisted log. Fewer are
     shown when the tall PIN pad is on screen so nothing gets clipped. */
  function recentNotis(max) {
    const rows = store.get('prefs.notiLog');
    if (!Array.isArray(rows)) return [];
    return rows.filter(r => r && r.title).slice(0, max);
  }

  function notiCard(n) {
    const app = api.getApp(String(n.app || '').toLowerCase());
    return h('div.lock__noti',
      h('div.lock__noti-g', {
        style: app ? { '--g1': app.g1, '--g2': app.g2 } : { '--g1': 'var(--accent-soft)', '--g2': 'var(--accent)' },
      }, icon(n.icon || 'bell')),
      h('div.lock__noti-b',
        h('div.lock__noti-h',
          h('b', { text: app ? app.name : (n.app || 'StaticOS') }),
          h('small', { text: n.at ? fmt.fmtAgo(n.at) : '' })),
        h('div.lock__noti-t', { text: n.title }),
        n.message ? h('div.lock__noti-m', { text: n.message }) : null));
  }

  /* ---------------- PIN pad -------------- */
  function pinPad(onKey) {
    const dot = () => h('i.lock__dot');
    const dots = h('div.lock__dots');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    const pad = h('div.lock__pad',
      keys.map(k => k === ''
        ? h('div.lock__key.lock__key--empty', { 'aria-hidden': 'true' })
        : h('button.lock__key', {
            type: 'button', 'aria-label': k === 'del' ? t('Delete') : t('Number {k}', { k }),
            onclick: () => onKey(k),
          }, k === 'del' ? h('span.lock__bs', { text: '⌫' }) : h('span', { text: k }))));
    return { el: h('div.lock__pinwrap', dots, pad), dots, dot };
  }

  /* the signed-in account is the truth for who's here; fall back to the
     'user' root, then a sane default. */
  function who() {
    const s = store.get('session.user');
    const u = store.get('user') || {};
    /* several people on this computer: the lock shows whose desktop it is */
    const own = profiles.displayName();
    const name = own || (s && s.name) || u.name || 'Static';
    const initials = (u.initials && !s && !own ? u.initials : null) || name.trim().charAt(0).toUpperCase() || 'S';
    return { name, initials, avatar: u.avatar || null };
  }

  /* Shut down: a dark screen until the person starts StaticOS again. A web page
     cannot switch a computer off, so this says what it is: the session stops. */
  function buildOff() {
    const start = h('button.btn.btn--primary', { type: 'button', onclick: () => location.reload() }, icon('power'), t('Start StaticOS'));
    const el = h('div.lock', { 'data-mode': 'off' },
      h('div.lock__inner',
        h('div.lock__name', { text: t('StaticOS is shut down') }),
        h('small.lock__note', { text: t('Your files and settings stay saved in this browser. This page can’t switch your computer off; it just stops here.') }),
        start,
        h('small.lock__note', { text: t('Press any key to start it again.') })));
    /* any key starts it again, wherever the focus happens to be (the page is
       about to reload, so this listener is never taken down) */
    document.addEventListener('keydown', e => {
      if (!el.isConnected || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      location.reload();
    }, true);
    el.state = { input: start, field: start, usingPin: false };
    return el;
  }

  function build(mode) {
    if (mode === 'off') return buildOff();
    const user = who();
    const name = user.name;
    const usingPin = mode !== 'restart' && !!pin();

    paintClock();

    const notis = recentNotis(usingPin ? 1 : 3);
    const inner = h('div.lock__inner' + (usingPin ? '.lock__inner--pin' : ''),
      timeEl, dateEl,
      heldEl,
      notis.length ? h('div.lock__notis', notis.map(notiCard)) : null,
      h('div.avatar.avatar--lg.lock__avatar', user.avatar
        ? h('img', { src: user.avatar, alt: '' })
        : h('span', { text: user.initials || name[0] })),
      h('div.lock__name', { text: name }));

    let field, input;
    if (mode === 'restart') {
      inner.append(h('div.lock__pin',
        h('div.lock__hint', { text: t('Restarting StaticOS…') }),
        h('div.row', h('div.spinner'), h('small.dim', { text: t('closing session') }))));
    } else if (usingPin) {
      const hint = h('div.lock__hint', { text: t('Enter your PIN') });
      const pad = pinPad(k => onPinKey(k, pad, hint));
      inner.append(h('div.lock__pin', hint, pad.el, lockControls()));
      field = pad.el; S.padRef = pad;
      paintDots(pad, 0);
    } else if (!profiles.current()?.locked) {
      /* nothing to check, so nothing to type: a password box here would only pretend */
      input = h('button.btn.btn--ghost.btn--sm.lock__go', { type: 'button', 'aria-label': t('Open'), onclick: () => unlock() },
        icon('unlock'), t('Open'));
      field = input;
      inner.append(h('div.lock__pin',
        h('div.lock__hint', { text: t('Press Enter to open') }), input,
        lockControls()));
    } else {
      input = h('input', {
        type: 'password', placeholder: '••••••••', spellcheck: 'false',
        'aria-label': t('Password'), autocomplete: 'off',
        onkeydown: e => { if (e.key === 'Enter') submit(input); },
      });
      field = h('div.field.lock__field', input);
      inner.append(h('div.lock__pin',
        h('div.lock__hint', { text: profiles.current()?.locked ? t('Enter your PIN or password') : t('Enter password to unlock') }), field,
        h('button.btn.btn--ghost.btn--sm.lock__go', { onclick: () => submit(input) }, icon('unlock'), t('Unlock')),
        lockControls()));
    }

    /* the lock screen's own picture sits behind everything, under a dimmer */
    const paper = lockPaper();
    const layer = paper ? WP.mediaLayer(paper, h) : null;
    const el = h('div.lock', { 'data-mode': mode, 'data-clock': clockStyle(), class: layer ? 'lock--paper' : null },
      layer ? h('div.lock__wp', { 'aria-hidden': 'true' }, layer) : null, inner);
    paintHeld();

    /* shortcuts underneath must not fire while we own the screen */
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (mode === 'restart' || usingPin || S.setup) return;
      if (e.key === 'Escape') { if (input && input.tagName === 'INPUT') input.value = ''; }
      else if (e.key === 'Enter' && input && input.tagName !== 'INPUT' && !e.target.closest('button')) unlock();
    });
    el.addEventListener('pointerdown', e => {
      if (mode !== 'restart' && !usingPin && !e.target.closest('input, button')) {
        e.preventDefault(); input?.focus();
      }
    });
    /* type a digit anywhere to feed the PIN pad */
    if (usingPin) el.addEventListener('keydown', e => {
      if (S.setup) return;
      if (/^\d$/.test(e.key)) onPinKey(e.key, S.padRef, el.querySelector('.lock__hint'));
      else if (e.key === 'Backspace') onPinKey('del', S.padRef, el.querySelector('.lock__hint'));
    });
    el.state = { input, field, usingPin };
    return el;
  }

  /* a tiny control row — set / change / remove, honestly labelled.
     Inline buttons rather than api.menu: the lock sits above the menu
     layer (z-overlay > z-menu), so a dropdown would open behind it. */
  function lockControls() {
    const has = !!pin();
    const ctl = (ic, label, fn) => h('button.lock__ctl', { type: 'button', onclick: fn }, icon(ic), h('span', { text: label }));
    const row = has
      ? h('div.row', { style: { gap: 'var(--sp-2)' } },
          ctl('edit-3', t('Change PIN'), () => startSetup()),
          ctl('trash', t('Remove PIN'), () => { store.set('prefs.lockPin', null); remount(); }))
      : ctl('lock', t('Set a PIN'), () => startSetup());
    /* someone else can sign in from here without unlocking this desktop */
    const others = profiles.MODE === 'guest' || profiles.people().length > 1;
    return h('div.lock__ctls', row,
      others ? ctl('users', 'Switch user', () => bus.emit('users:open', { from: 'lock' })) : null,
      h('small.lock__note', { text: t('Visual lock only — this runs in your browser.') }));
  }

  /* rebuild the curtain in place (e.g. after adding/removing a PIN) */
  function remount() {
    if (!S.el) return;
    const mode = S.el.getAttribute('data-mode') || 'lock';
    const fresh = build(mode);
    S.el.replaceWith(fresh);
    S.el = fresh;
    requestAnimationFrame(() => S.el?.state.input?.focus());
  }

  /* ---------------- PIN setup ------------ */
  function startSetup() {
    S.setup = { stage: 'new', first: '' };
    S.entry = '';
    remountSetup();
  }
  function remountSetup() {
    if (!S.el) return;
    const hint = h('div.lock__hint', { text: S.setup.stage === 'new' ? t('Choose a 4-digit PIN') : t('Enter it again to confirm') });
    const pad = pinPad(k => onSetupKey(k, pad, hint));
    S.padRef = pad;
    const pinBox = S.el.querySelector('.lock__pin');
    if (pinBox) render(pinBox, hint, pad.el,
      h('div.lock__ctls',
        h('button.lock__ctl', { type: 'button', onclick: () => { S.setup = null; remount(); } }, icon('x'), h('span', { text: t('Cancel') }))));
    paintDots(pad, 0);
  }
  function onSetupKey(k, pad, hint) {
    if (k === 'del') { S.entry = S.entry.slice(0, -1); paintDots(pad, S.entry.length); return; }
    if (S.entry.length >= PINLEN) return;
    S.entry += k; paintDots(pad, S.entry.length);
    if (S.entry.length === PINLEN) setTimeout(() => {
      if (S.setup.stage === 'new') {
        S.setup.first = S.entry; S.setup.stage = 'confirm'; S.entry = ''; remountSetup();
      } else if (S.entry === S.setup.first) {
        store.set('prefs.lockPin', S.setup.first); S.setup = null; S.entry = '';
        notify({ app: 'StaticOS', icon: 'lock', title: t('PIN set'), message: t('The lock screen will ask for it next time.') });
        remount();
      } else {
        hint.textContent = t('Those didn’t match — start again');
        S.setup.stage = 'new'; S.setup.first = ''; S.entry = '';
        S.el && shake(S.el.querySelector('.lock__dots'));
        setTimeout(() => paintDots(pad, 0), 60);
      }
    }, 90);
  }

  /* ---------------- PIN entry ------------ */
  function onPinKey(k, pad, hint) {
    if (!pad) return;
    if (k === 'del') { S.entry = S.entry.slice(0, -1); paintDots(pad, S.entry.length); return; }
    if (S.entry.length >= 8) return;
    S.entry += k; paintDots(pad, S.entry.length);
    const target = pin();
    if (S.entry.length >= (target ? target.length : PINLEN)) setTimeout(() => {
      if (S.entry === target) { unlock(); }
      else {
        if (hint) hint.textContent = t('Wrong PIN');
        S.el && shake(S.el.querySelector('.lock__dots'));
        S.entry = ''; setTimeout(() => paintDots(pad, 0), 60);
      }
    }, 90);
  }

  function paintDots(pad, filled) {
    const total = Math.max(PINLEN, filled);
    render(pad.dots, Array.from({ length: total }, (_, i) => {
      const d = pad.dot(); if (i < filled) d.classList.add('is-on'); return d;
    }));
  }

  /* ---------------- show / hide ---------- */
  function show(mode) {
    if (S.el) return S.el;
    S.shaken = false; S.entry = ''; S.setup = null;
    S.lockedAt = Date.now();
    S.el = build(mode);
    host.appendChild(S.el);
    cover('lock', true);
    S.timer = setInterval(paintClock, 1000);
    S.el.state.input?.focus();              /* now, so Enter works at once, and again next frame once it is laid out */
    requestAnimationFrame(() => S.el?.state.input?.focus());
    return S.el;
  }

  const reduced = () => !!store.get('prefs.reduceMotion')
    || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function shake(field) {
    S.shaken = true;
    if (reduced() || !field) return;
    field.animate?.([
      { transform: 'translateX(0)' }, { transform: 'translateX(-8px)' },
      { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' },
      { transform: 'translateX(0)' },
    ], { duration: 340, easing: 'ease-in-out' });
  }

  /* any non-empty value unlocks; an empty one shakes once, then relents —
     unless this person locked their profile, when it has to be theirs */
  function submit(input) {
    if (!S.el || !input) return;
    const me = profiles.current();
    if (me && me.locked) {
      profiles.verify(me.id, input.value).then(good => {
        if (good) { unlock(); return; }
        const hint = S.el?.querySelector('.lock__hint');
        if (hint) hint.textContent = t('That PIN or password is not right');
        input.value = '';
        shake(S.el?.state.field);
      });
      return;
    }
    if (!input.value.trim() && !S.shaken) return shake(S.el.state.field);
    unlock();
  }

  function unlock() {
    const node = S.el;
    if (!node) return;
    S.el = null;
    cover('lock', false);
    clearInterval(S.timer);
    S.timer = null;
    node.classList.add('is-out');
    const drop = () => node.remove();
    node.addEventListener('animationend', e => { if (e.target === node) drop(); });
    setTimeout(drop, OUT);
    api.notify({
      app: 'StaticOS', icon: 'unlock',
      title: `Welcome back, ${who().name}`,
      message: t('Session restored.'),
    });
  }

  /* ---------------- restart -------------- */
  async function restart() {
    const ok = await api.confirm({
      title: t('Restart StaticOS?'),
      message: t('Open windows will be closed and the shell will reload.'),
      ok: t('Restart'),
    });
    if (!ok) return;
    show('restart');
    setTimeout(() => location.reload(), 900);
  }

  async function shutdown() {
    const ok = await api.confirm({
      title: t('Shut down StaticOS?'),
      message: t('Open windows will be closed. Your files and settings stay saved in this browser.'),
      ok: t('Shut Down'),
    });
    if (!ok) return;
    api.wm.list().forEach(w => { try { w.close(); } catch (err) { /* already gone */ } });
    show('off');
  }

  /* ---------------- wiring --------------- */
  bus.on('power:lock', () => show('lock'));
  bus.on('power:sleep', () => show('lock'));
  bus.on('power:restart', restart);
  bus.on('power:shutdown', shutdown);
  store.sub('prefs.h24', () => { if (S.el) paintClock(); });
  store.sub('prefs.lockClock', () => { if (S.el) paintClock(); });
  store.sub('prefs.lockWallpaper', () => { if (S.el && S.el.getAttribute('data-mode') !== 'restart') remount(); });
  bus.on('dndheld:change', () => { if (S.el) paintHeld(); });

  return { show, unlock };
}

export default mountLock;
