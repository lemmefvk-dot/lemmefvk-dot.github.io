/* ============================================================
   account.js — sign in / create account, bottom-right corner.

   Accounts are LOCAL: StaticOS is a static site with no server, so
   an account lives in this browser's storage and nowhere else. The
   sheet says so plainly rather than implying a cloud login.

   Passwords are never stored. Each account keeps a random salt and a
   PBKDF2-SHA256 hash (310,000 rounds); signing in re-derives and
   compares. The developer account works the same way against a
   verifier baked in below — the password itself is not in the code.

   Honest limits, also why nothing sensitive may ever sit behind this:
   everything runs in the page, so someone with DevTools can edit
   storage and call themselves signed in. It is a front door, not a
   vault. Widgets are gated on it because that was asked for; the
   developer account unlocks conveniences, never secrets.

   Exposes: current(), signOut(), and bus 'account:open' (tab) to
   open the sheet from anywhere.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import * as L from '../core/layers.js';
import { normPicture, builtinSvg } from '../core/avatar.js';
import { earlyAccessCard } from '../core/earlyaccess.js';

const ACCOUNTS = 'portal.accounts';
const SESSION = 'session.user';
const ITER = 310000;
/* PBKDF2-SHA256(dev password, salt, 310k) — the verifier, not the password */
const DEV = {
  salt: '4932b8fb2bde7822fc8989c772821746',
  hash: '937b304dc4dfc75a3dc4f910eacbb9ab529423c538bc49407ad4dc5db7c7aa4b',
};
const RESERVED = /^(dev|developer|admin|root|system|static)$/i;
const HANDLE = /^[a-z0-9_.-]{3,20}$/;

/* ---------- crypto ---------------------------------------------------- */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array(s.match(/../g).map(x => parseInt(x, 16)));
const salt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

async function derive(password, saltHex) {
  if (!crypto?.subtle) throw new Error('This browser cannot hash passwords here (it needs https).');
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: ITER }, key, 256);
  return hex(bits);
}
/* compare without bailing at the first differing character */
const same = (a, b) => a.length === b.length
  && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

/* ---------- the model ------------------------------------------------- */
export const current = () => store.get(SESSION, null);
const accounts = () => (Array.isArray(store.get(ACCOUNTS)) ? store.get(ACCOUNTS) : []);
const begin = user => {
  store.set(SESSION, { ...user, since: new Date().toISOString() });
  return current();
};

async function signUp({ username, name, password, confirm }) {
  const handle = String(username || '').trim().toLowerCase();
  if (!HANDLE.test(handle)) throw new Error('Usernames are 3–20 characters: letters, numbers, . _ or -');
  if (RESERVED.test(handle)) throw new Error('That username is reserved.');
  if (accounts().some(a => a.username === handle)) throw new Error('That username is taken on this browser.');
  if (String(password || '').length < 6) throw new Error('Use at least 6 characters for the password.');
  if (password !== confirm) throw new Error('The two passwords do not match.');
  const s = salt();
  const acct = {
    username: handle, name: String(name || '').trim().slice(0, 32) || handle,
    salt: s, hash: await derive(password, s), created: new Date().toISOString(),
  };
  store.set(ACCOUNTS, [...accounts(), acct]);
  return begin({ username: acct.username, name: acct.name, dev: false });
}

async function signIn({ username, password }) {
  const handle = String(username || '').trim().toLowerCase();
  const acct = accounts().find(a => a.username === handle);
  /* derive even for an unknown name, so the two failures take as long */
  const got = await derive(String(password || ''), acct ? acct.salt : DEV.salt);
  if (!acct || !same(got, acct.hash)) throw new Error('Wrong username or password.');
  return begin({ username: acct.username, name: acct.name, dev: false });
}

export async function signInDev(password) {
  const got = await derive(String(password || ''), DEV.salt);
  if (!same(got, DEV.hash)) throw new Error('That is not the developer password.');
  return begin({ username: 'dev', name: 'Developer', dev: true });
}

export function signOut() { store.set(SESSION, null); }

/* ---------- the corner ------------------------------------------------ */
const initial = u => (u?.name || u?.username || '?').trim().charAt(0).toUpperCase();
/* the picture chosen in Profile (core/avatar.js), or the initial if there is none */
function avatarKids(u) {
  if (u.dev) return { props: { text: '</>' }, kids: [] };
  const v = store.get('portal.profile', null);
  const p = normPicture(v && v.picture);
  if (!p) return { props: { text: initial(u) }, kids: [] };
  return {
    props: { class: 'has-pic' },
    kids: [p.kind === 'upload' ? h('img', { src: p.dataUrl, alt: '' }) : h('span.acct__svg', { html: builtinSvg(p.id) })],
  };
}
const avatar = (u, cls = '') => { const a = avatarKids(u); return h('span.acct__av' + cls + (u.dev ? '.is-dev' : ''), a.props, ...a.kids); };

/* the early-access item belongs to the stable site; the beta site is early access */
const onBeta = () => document.documentElement.dataset.channel === 'beta';

export function mountAccount(host) {
  const corner = h('button.acct', { type: 'button', 'aria-haspopup': 'dialog' });
  const lock = h('div.wg-lock', { role: 'note' },
    h('div.wg-lock__ic', icon('lock')),
    h('b', { text: 'Widgets are for signed-in users' }),
    h('small', { text: 'Clock, weather, calendar and system monitor appear here once you sign in.' }),
    h('div.wg-lock__acts',
      h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => openSheet('in') }, 'Sign in'),
      h('button.btn.btn--sm', { type: 'button', onclick: () => openSheet('up') }, 'Create account')));
  host.append(lock, corner);

  let menu = null;
  let sheet = null;

  function paint() {
    const u = current();
    document.body.dataset.user = u ? u.username : '';
    if (!u) delete document.body.dataset.user;
    corner.replaceChildren(...(u
      ? [avatar(u), h('span.acct__name', { text: u.name })]
      : [icon('user'), h('span.acct__name', { text: 'Sign in' })]));
    corner.setAttribute('aria-label', u ? `Account: ${u.name}` : 'Sign in or create an account');
    const showLock = !u && store.get('prefs.widgetsVisible') !== false;
    lock.hidden = !showLock;
  }

  corner.addEventListener('click', () => (current() ? toggleMenu() : openSheet('in')));

  /* ---- signed-in menu ---- */
  function closeMenu() { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); }
  function outside(e) { if (menu && !menu.contains(e.target) && !corner.contains(e.target)) closeMenu(); }
  function toggleMenu() {
    if (menu) { closeMenu(); return; }
    const u = current();
    const item = (ic, label, fn, cls = '') => h('button.acct-menu__item' + cls, { type: 'button', onclick: () => { closeMenu(); fn(); } }, icon(ic), h('span', { text: label }));
    menu = h('div.acct-menu', { role: 'menu' },
      h('div.acct-menu__who',
        avatar(u, '.acct__av--lg'),
        h('div', h('b', { text: u.name }), h('small', { text: '@' + u.username })),
        u.dev ? h('span.badge.badge--accent', { text: 'Developer' }) : null),
      item('user', 'Your profile', () => window.StaticAPI?.openApp('profile')),
      item('bookmark', 'Library & achievements', () => window.StaticAPI?.openApp('aether-library')),
      item('users', 'Switch user…', () => bus.emit('users:open')),
      h('div.acct-menu__sep'),
      u.dev ? h('div.acct-menu__cap', { text: 'Developer' }) : null,
      u.dev ? item('zap', 'Admin abuse', () => window.StaticAPI?.openApp('devroom', { tab: 'admin' })) : null,
      u.dev ? item('wrench', 'Developer Room', () => window.StaticAPI?.openApp('devroom')) : null,
      u.dev && !onBeta() ? item('sparkles', 'Early access', () => openSheet('early')) : null,
      u.dev ? item('terminal', 'Talk to Claude remotely…', remoteHelp) : null,
      u.dev ? item('refresh', 'Reload, skipping the cache', () => location.reload()) : null,
      u.dev ? item('hard-drive', 'Show the boot menu next time', () => {
        store.set('prefs', { ...store.get('prefs', {}), bootSkip: false });
        bus.emit('noti:push', { app: 'Account', icon: 'hard-drive', title: 'Boot menu is back', message: 'It will show on the next load.', timeout: 4000 });
      }) : null,
      u.dev ? item('download', 'Export state (JSON)', exportState) : null,
      h('div.acct-menu__sep'),
      item('lock', 'Sign out', signOut, '.is-danger'));
    host.appendChild(menu);
    document.addEventListener('pointerdown', outside, true);
  }

  function exportState() {
    const blob = new Blob([JSON.stringify(store.raw, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `staticos-state-${Date.now()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* The honest version of "talk to Claude from anywhere": Claude Code's own
     Remote Control, driven from claude.ai/code. A page cannot reach a
     program on a computer at home by itself, and a home-made bridge would
     hand that computer's shell to whoever cracked this page's lock. */
  function remoteHelp() {
    openSheet('remote');
  }

  /* ---- the sheet ---- */
  /* Esc closes the sheet wherever focus is — the remote-help view has no
     input to hold it */
  const onEsc = e => { if (e.key === 'Escape' && sheet) { e.stopPropagation(); closeSheet(); } };
  let release = null;
  function closeSheet() {
    sheet?.remove();
    sheet = null;
    window.removeEventListener('keydown', onEsc, true);
    release?.();
    release = null;
  }
  function openSheet(tab = 'in') {
    closeSheet();
    closeMenu();
    const err = h('div.acct-sheet__err', { role: 'alert' });
    const body = h('div.acct-sheet__body');
    const tabs = h('div.acct-sheet__tabs', { role: 'tablist' });
    const card = h('div.acct-sheet__card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Account', tabindex: '-1' },
      h('button.acct-sheet__x', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('x')),
      h('div.acct-sheet__brand', h('span.acct-sheet__logo', icon('diamond')), h('b', { text: 'StaticOS account' })),
      tabs, body, err);
    sheet = h('div.acct-sheet', { onclick: e => { if (e.target === sheet) closeSheet(); } }, card);
    window.addEventListener('keydown', onEsc, true);
    host.appendChild(sheet);
    release = L.push({ name: 'account', el: card, trap: true, close: closeSheet });

    const field = (label, attrs) => {
      const input = h('input.acct-field__in', attrs);
      return { input, el: h('label.acct-field', h('span', { text: label }), input) };
    };

    function show(which) {
      err.textContent = '';
      tabs.replaceChildren(...(which === 'remote' || which === 'early' ? [] : [['in', 'Sign in'], ['up', 'Create account'], ['dev', 'Developer']].map(([id, label]) =>
        h('button.acct-sheet__tab' + (id === which ? '.is-on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(id === which), onclick: () => show(id) }, label))));
      body.replaceChildren();

      if (which === 'remote') { body.append(...remoteBody()); card.focus(); return; }
      if (which === 'early') { body.append(h('div.acct-sheet__title', { text: 'Early access' }), earlyAccessCard(h, icon)); card.focus(); return; }

      const busy = h('span.acct-sheet__spin');
      let fields;
      let run;
      if (which === 'in') {
        fields = [field('Username', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' }),
          field('Password', { type: 'password', autocomplete: 'current-password' })];
        run = () => signIn({ username: fields[0].input.value, password: fields[1].input.value });
      } else if (which === 'up') {
        fields = [field('Display name', { autocomplete: 'nickname', placeholder: 'optional' }),
          field('Username', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' }),
          field('Password', { type: 'password', autocomplete: 'new-password' }),
          field('Confirm password', { type: 'password', autocomplete: 'new-password' })];
        run = () => signUp({ name: fields[0].input.value, username: fields[1].input.value, password: fields[2].input.value, confirm: fields[3].input.value });
      } else {
        fields = [field('Developer password', { type: 'password', autocomplete: 'off' })];
        run = () => signInDev(fields[0].input.value);
      }
      const submit = h('button.btn.btn--primary.acct-sheet__go', { type: 'submit' },
        h('span', { text: which === 'up' ? 'Create account' : 'Sign in' }), busy);
      const form = h('form.acct-sheet__form', {
        onsubmit: async e => {
          e.preventDefault();
          err.textContent = '';
          submit.disabled = true;
          card.classList.add('is-busy');
          try {
            const u = await run();
            closeSheet();
            bus.emit('noti:push', { app: 'Account', icon: u.dev ? 'terminal' : 'user', title: `Signed in as ${u.name}`, message: u.dev ? 'Developer tools are in the account menu, bottom right.' : 'Your widgets are back.', timeout: 4000 });
          } catch (x) {
            err.textContent = x.message;
            card.classList.remove('is-busy');
            submit.disabled = false;
          }
        },
      }, fields.map(f => f.el), submit);
      body.append(form,
        h('p.acct-sheet__note', { text: which === 'dev'
          ? 'For the owner of this StaticOS. The password is checked against a one-way hash — it is not stored anywhere.'
          : 'Accounts live in this browser only. StaticOS has no server, so an account made here does not exist on another computer, and clearing site data removes it.' }));
      setTimeout(() => fields[0].input.focus(), 30);
    }

    function remoteBody() {
      const step = (n, title, ...rest) => h('li.acct-steps__li', h('b', { text: `${n}. ${title}` }), ...rest);
      const code = t => h('code.acct-code', { text: t });
      return [
        h('div.acct-sheet__title', { text: 'Talk to Claude from anywhere' }),
        h('p.acct-sheet__p', { text: 'Claude Code has this built in: Remote Control. Your home computer keeps the session running; you drive it from claude.ai/code on any browser or the Claude phone app, signed in to your own Claude account.' }),
        h('ol.acct-steps',
          step(1, 'At home, start it', h('div', { text: 'In a terminal in your project: ' }), code('claude --remote-control'), h('div', { text: 'or type ' }), code('/remote-control'), h('div', { text: ' inside a running session.' })),
          step(2, 'Leave that computer on', h('div', { text: 'The session only lives while the claude process runs and the computer is awake and online.' })),
          step(3, 'From anywhere', h('div', { text: 'Open claude.ai/code and pick the session. Needs a Pro, Max, Team or Enterprise plan.' }))),
        h('div.acct-sheet__row',
          h('button.btn.btn--primary', { type: 'button', onclick: () => window.open('https://claude.ai/code', '_blank', 'noopener') }, icon('external-link'), 'Open claude.ai/code')),
        h('p.acct-sheet__note', { text: 'If claude.ai is blocked on this network, it will not load here either — sign-in pages do not survive the proxy.' }),
      ];
    }

    show(tab);
  }

  const offs = [
    store.sub(SESSION, () => { closeMenu(); paint(); }),
    store.sub('prefs.widgetsVisible', paint),
    store.sub('portal.profile', paint),
    bus.on('account:open', t => openSheet(t || 'in')),
  ];
  paint();
  return () => offs.forEach(f => f?.());
}

export default mountAccount;
