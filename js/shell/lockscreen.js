/* ============================================================
   lockscreen.js — the lock / sleep curtain and the fake restart.

   Lock Screen 2.0: the wallpaper shows through a frosted curtain
   with the big clock and date, your profile, and your most recent
   notifications (read from the same prefs.notiLog the notification
   centre keeps). Unlocking plays a short zoom-and-fade.

   Two ways in:
     • no PIN set  → a password field; ANY non-empty value unlocks.
     • prefs.lockPin set → a PIN pad; the digits must match.
     • several people on this computer, and this one has a PIN or
       password (js/core/profiles.js) → the field must match it.
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

const OUT = 320;    /* .lock.is-out fade-out, with headroom */
const PINLEN = 4;

export function mountLock(host) {
  const { fmt, render, notify } = api;

  /* ---------------- state ---------------- */
  const S = { el: null, timer: null, shaken: false, entry: '', setup: null };

  const timeEl = h('div.lock__time');
  const dateEl = h('div.lock__date');

  function paintClock() {
    const d = new Date();
    const h24 = !!store.get('prefs.h24');
    const c = fmt.fmtClock(d, h24);
    render(timeEl, c.time, !h24 && h('span.lock__ap', { text: c.ap }));
    dateEl.textContent = fmt.fmtDateLong(d);
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
            type: 'button', 'aria-label': k === 'del' ? 'Delete' : `Number ${k}`,
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

  function build(mode) {
    const user = who();
    const name = user.name;
    const usingPin = mode !== 'restart' && !!pin();

    paintClock();

    const notis = recentNotis(usingPin ? 1 : 3);
    const inner = h('div.lock__inner' + (usingPin ? '.lock__inner--pin' : ''),
      timeEl, dateEl,
      notis.length ? h('div.lock__notis', notis.map(notiCard)) : null,
      h('div.avatar.avatar--lg.lock__avatar', user.avatar
        ? h('img', { src: user.avatar, alt: '' })
        : h('span', { text: user.initials || name[0] })),
      h('div.lock__name', { text: name }));

    let field, input;
    if (mode === 'restart') {
      inner.append(h('div.lock__pin',
        h('div.lock__hint', { text: 'Restarting StaticOS…' }),
        h('div.row', h('div.spinner'), h('small.dim', { text: 'closing session' }))));
    } else if (usingPin) {
      const hint = h('div.lock__hint', { text: 'Enter your PIN' });
      const pad = pinPad(k => onPinKey(k, pad, hint));
      inner.append(h('div.lock__pin', hint, pad.el, lockControls()));
      field = pad.el; S.padRef = pad;
      paintDots(pad, 0);
    } else {
      input = h('input', {
        type: 'password', placeholder: '••••••••', spellcheck: 'false',
        'aria-label': 'Password', autocomplete: 'off',
        onkeydown: e => { if (e.key === 'Enter') submit(input); },
      });
      field = h('div.field.lock__field', input);
      inner.append(h('div.lock__pin',
        h('div.lock__hint', { text: profiles.current()?.locked ? 'Enter your PIN or password' : 'Enter password to unlock' }), field,
        h('button.btn.btn--ghost.btn--sm.lock__go', { onclick: () => submit(input) }, icon('unlock'), 'Unlock'),
        lockControls()));
    }

    const el = h('div.lock', { 'data-mode': mode }, inner);

    /* shortcuts underneath must not fire while we own the screen */
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (mode === 'restart' || usingPin || S.setup) return;
      if (e.key === 'Escape') { input && (input.value = ''); }
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
          ctl('edit-3', 'Change PIN', () => startSetup()),
          ctl('trash', 'Remove PIN', () => { store.set('prefs.lockPin', null); remount(); }))
      : ctl('lock', 'Set a PIN', () => startSetup());
    /* someone else can sign in from here without unlocking this desktop */
    const others = profiles.MODE === 'guest' || profiles.people().length > 1;
    return h('div.lock__ctls', row,
      others ? ctl('users', 'Switch user', () => bus.emit('users:open', { from: 'lock' })) : null,
      h('small.lock__note', { text: 'Visual lock only — this runs in your browser.' }));
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
    const hint = h('div.lock__hint', { text: S.setup.stage === 'new' ? 'Choose a 4-digit PIN' : 'Enter it again to confirm' });
    const pad = pinPad(k => onSetupKey(k, pad, hint));
    S.padRef = pad;
    const pinBox = S.el.querySelector('.lock__pin');
    if (pinBox) render(pinBox, hint, pad.el,
      h('div.lock__ctls',
        h('button.lock__ctl', { type: 'button', onclick: () => { S.setup = null; remount(); } }, icon('x'), h('span', { text: 'Cancel' }))));
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
        notify({ app: 'StaticOS', icon: 'lock', title: 'PIN set', message: 'The lock screen will ask for it next time.' });
        remount();
      } else {
        hint.textContent = 'Those didn’t match — start again';
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
        if (hint) hint.textContent = 'Wrong PIN';
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
    S.el = build(mode);
    host.appendChild(S.el);
    cover('lock', true);
    S.timer = setInterval(paintClock, 1000);
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
        if (hint) hint.textContent = 'That PIN or password is not right';
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
      message: 'Session restored.',
    });
  }

  /* ---------------- restart -------------- */
  async function restart() {
    const ok = await api.confirm({
      title: 'Restart StaticOS?',
      message: 'Open windows will be closed and the shell will reload.',
      ok: 'Restart',
    });
    if (!ok) return;
    show('restart');
    setTimeout(() => location.reload(), 900);
  }

  /* ---------------- wiring --------------- */
  bus.on('power:lock', () => show('lock'));
  bus.on('power:sleep', () => show('lock'));
  bus.on('power:restart', restart);
  store.sub('prefs.h24', () => { if (S.el) paintClock(); });

  return { show, unlock };
}

export default mountLock;
