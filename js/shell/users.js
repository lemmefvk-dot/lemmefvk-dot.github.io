/* ============================================================
   users.js — several people on one computer: the parts people see.

     mountLogin(host)  the login screen a new tab stops at when more
                       than one person uses this computer (or the only
                       one has a PIN). Picking someone reloads into
                       their own desktop.
     mountUsers(host)  the shell part: the Users sheet on bus
                       'users:open' (the  menu, the account menu, the
                       lock screen), the guest's "files aren't kept" bar,
                       and your picture on the login screen kept current.
     usersPanel()      the list of people and its forms, shown by the
                       Users sheet and by Settings › Users.

   Whose data is whose — key names, locks, deleting only the right
   things — is js/core/profiles.js. Nothing here touches storage itself.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { cover } from '../core/cover.js';
import * as L from '../core/layers.js';
import * as P from '../core/profiles.js';
import { BUILTIN, avatarEl, normPicture } from '../core/avatar.js';

/* the avatar art's stylesheet — the Profile app adds the same one */
if (typeof document !== 'undefined' && !document.getElementById('feat-profile-css')) {
  const l = document.createElement('link');
  l.id = 'feat-profile-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-profile.css';
  document.head.appendChild(l);
}

export const NOTE = 'Everyone here gets their own settings, files, screen time and saved projects, and shares this browser’s storage space. '
  + 'Sites opened through the Browser’s proxy keep their sign-ins for this whole browser, not per person, so sign out of them when you finish. '
  + 'A PIN or password is a front-end lock: it keeps people out of each other’s desktops in StaticOS, not out of the browser’s own storage, so don’t keep secrets behind it.';
export const GUEST_NOTE = 'Your files and settings here are erased when you end the session or close this tab. '
  + 'Guests can’t see other people’s files or profiles. One exception: sites opened through the Browser’s proxy keep their sign-ins and data in this browser for everyone, so sign out of them before you go.';

const initialOf = name => (String(name || '?').trim().charAt(0) || '?').toUpperCase();
const face = (p, size) => avatarEl(h, { picture: p.pic || null, costume: 'none', initial: initialOf(p.name), size });
const field = (label, attrs = {}) => {
  const input = h('input.acct-field__in', { spellcheck: 'false', autocomplete: 'off', ...attrs });
  return { input, el: h('label.acct-field', h('span', { text: label }), input) };
};
const say = (title, message, ic = 'users') => bus.emit('noti:push', { app: 'Users', icon: ic, title, message, timeout: 6000 });
const accountName = () => P.tidy(store.get('session.user')?.name || '');
const myPic = () => normPicture(store.get('portal.profile')?.picture);
const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
function shake(el) {
  if (!el || reduced()) return;
  el.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' },
    { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 340, easing: 'ease-in-out' });
}

function guestCard(onEnd) {
  return h('div.users-guest',
    h('div.users-guest__ic', icon('user')),
    h('b', { text: 'You’re using a guest session' }),
    h('p', { text: GUEST_NOTE }),
    h('button.btn.btn--primary', { type: 'button', dataset: { act: 'end-guest' }, onclick: onEnd || (() => P.signOut()) },
      icon('power'), h('span', { text: 'End guest session' })));
}

/* ---------- the login screen (and the switcher over the lock) ---------- */
function loginScreen({ overlay = false, close = null } = {}) {
  const people = P.people();
  const time = h('div.lock__time');
  const date = h('div.lock__date');
  const clock = () => {
    const d = new Date();
    time.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !store.get('prefs.h24') });
    date.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  clock();
  const timer = setInterval(clock, 1000);
  const err = h('div.users-err', { role: 'alert' });
  const body = h('div.users-login__body');
  const title = h('h1.users-login__h', { text: overlay ? 'Switch user' : 'Who’s using StaticOS?' });
  const el = h('div.users-login', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': overlay ? 'Switch user' : 'Choose who is using StaticOS',
    dataset: { mode: overlay ? 'switch' : 'boot' },
  }, h('div.users-login__inner', time, date, title, body, err,
    h('p.users-login__note', { text: 'Each person’s files and settings are kept apart on this computer. A PIN is a front-end lock: it keeps people out of each other’s desktops here, not out of the browser’s storage.' }),
    overlay ? h('button.btn.btn--ghost.users-login__cancel', { type: 'button', onclick: () => done() }, icon('x'), h('span', { text: 'Cancel' })) : null));

  let busy = false;
  let asking = false;
  function done() {
    clearInterval(timer);
    el.remove();
    close?.();
  }
  el.close = done;
  el.stop = () => clearInterval(timer);

  async function go(p, secret, input) {
    if (busy) return;
    busy = true;
    el.classList.add('is-busy');
    err.textContent = '';
    try {
      /* the login screen stands in for the boot menu: the short splash follows */
      await P.switchTo(p.id, secret);
    } catch (x) {
      busy = false;
      el.classList.remove('is-busy');
      err.textContent = x.message;
      if (input) { input.value = ''; input.focus(); shake(input); }
    }
  }
  function pick(p) {
    err.textContent = '';
    if (p.guest) { P.startGuest(); return; }
    if (overlay && p.id === P.ID) { done(); return; }
    if (!p.locked) { go(p, ''); return; }
    ask(p);
  }
  function tiles() {
    asking = false;
    err.textContent = '';
    if (P.MODE === 'guest') {
      body.replaceChildren(guestCard());
      return;
    }
    const kids = people.map(p => h('button.users-tile', {
      type: 'button', dataset: { id: p.id },
      'aria-label': `${p.name}${p.locked ? ', needs a PIN or password' : ''}${overlay && p.id === P.ID ? ', signed in now' : ''}`,
      onclick: () => pick(p),
    }, face(p, 76), h('span.users-tile__name', { text: p.name, title: p.name }),
    h('small.users-tile__sub', ...(p.locked ? [icon('lock'), h('span', { text: 'PIN' })] : [h('span', { text: overlay && p.id === P.ID ? 'Signed in' : '' })]))));
    kids.push(h('button.users-tile.users-tile--guest', {
      type: 'button', dataset: { id: 'guest' }, 'aria-label': 'Guest: a session whose files and settings are not kept',
      onclick: () => pick({ guest: true }),
    }, h('span.users-tile__g', icon('user')), h('span.users-tile__name', { text: 'Guest' }),
    h('small.users-tile__sub', h('span', { text: 'Files aren’t kept' }))));
    body.replaceChildren(h('div.users-grid', { role: 'group', 'aria-label': 'People on this computer' }, kids));
    setTimeout(() => { if (!asking) body.querySelector('.users-tile')?.focus({ preventScroll: true }); }, 30);
  }
  function ask(p) {
    asking = true;
    const f = field('PIN or password', { type: 'password', 'aria-label': `PIN or password for ${p.name}` });
    const form = h('form.users-ask', {
      dataset: { id: p.id },
      onsubmit: e => { e.preventDefault(); go(p, f.input.value, f.input); },
    }, face(p, 88), h('div.users-ask__name', { text: p.name }), f.el,
    h('div.users-ask__acts',
      h('button.btn.btn--ghost', { type: 'button', onclick: tiles }, icon('arrow-left'), h('span', { text: 'Back' })),
      h('button.btn.btn--primary.users-ask__go', { type: 'submit' }, h('span', { text: 'Sign in' }))));
    body.replaceChildren(form);
    setTimeout(() => f.input.focus(), 30);
  }

  /* the desktop's shortcuts must not fire through this screen */
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (asking) tiles(); else if (overlay) done();
    }
    e.stopPropagation();
  });
  tiles();
  return el;
}

/** The login screen: nobody's data is loaded until someone is picked. */
export function mountLogin(host) {
  const B = window.__staticBoot;
  if (B) { B.alive = true; B.login = true; }
  document.body.dataset.login = '1';
  const el = loginScreen();
  host.appendChild(el);
  cover('login', true);
  return () => { el.stop(); el.remove(); cover('login', false); delete document.body.dataset.login; };
}

/* ---------- the list of people and its forms -------------------------- */
export function usersPanel() {
  const root = h('div.users-panel');
  let stage = null;               /* { kind, p } — the form under the list */

  const btn = (ic, label, fn, act, cls = '') => h('button.btn.btn--sm' + cls, { type: 'button', dataset: { act }, onclick: fn }, icon(ic), h('span', { text: label }));
  const open = (kind, p = null) => { stage = { kind, p }; paint(); root.querySelector('.users-form input')?.focus(); };
  const shut = () => { stage = null; paint(); };

  function row(p) {
    return h('div.users-row' + (p.current ? '.is-you' : ''), { role: 'listitem', dataset: { id: p.id } },
      face(p, 40),
      h('div.users-row__who', h('b', { text: p.name, title: p.name }),
        h('small', { text: [p.current ? 'You' : '', p.locked ? 'PIN set' : 'No PIN'].filter(Boolean).join(' · ') })),
      h('div.users-row__acts', ...(p.current
        ? [btn('edit-3', 'Rename', () => open('rename', p), 'rename'), btn('lock', p.locked ? 'Change PIN' : 'Set PIN', () => open('pin', p), 'pin')]
        : [btn('users', 'Switch', () => (p.locked ? open('switch', p) : P.switchTo(p.id).catch(x => say('Could not switch', x.message, 'alert'))), 'switch'),
          btn('trash', 'Delete', () => open('delete', p), 'delete', '.btn--danger')])));
  }

  /* a form under the list: fields, an error line, its buttons */
  function form(kind, title, kids, submitLabel, submit, { danger = false, extra = null } = {}) {
    const err = h('div.users-err', { role: 'alert' });
    const go = h('button.btn.btn--sm' + (danger ? '.btn--danger' : '.btn--primary'), { type: 'submit', dataset: { act: 'go' } }, h('span', { text: submitLabel }));
    let busy = false;
    const run = async fn => {
      if (busy) return;
      busy = true; go.disabled = true; err.textContent = '';
      try { await fn(); } catch (x) { err.textContent = x.message; busy = false; go.disabled = false; shake(err); }
    };
    return h('form.users-form', { dataset: { form: kind }, onsubmit: e => { e.preventDefault(); run(submit); } },
      h('b', { text: title }), ...kids, err,
      h('div.users-form__acts',
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { act: 'cancel' }, onclick: shut }, h('span', { text: 'Cancel' })),
        extra ? h('button.btn.btn--sm', { type: 'button', dataset: { act: extra.act }, onclick: () => run(extra.fn) }, h('span', { text: extra.label })) : null,
        go));
  }
  const para = text => h('p.users-form__p', { text });

  function stageEl(solo) {
    if (!stage) return null;
    const { kind, p } = stage;
    if (kind === 'add') {
      const me = solo ? field('Your name on this computer', { value: accountName(), maxlength: '24', autocomplete: 'nickname', name: 'me' }) : null;
      const nm = field('Their name', { maxlength: '24', name: 'name' });
      const pin1 = field('PIN or password (optional)', { type: 'password', autocomplete: 'new-password', name: 'pin' });
      const pin2 = field('The same again', { type: 'password', autocomplete: 'new-password', name: 'pin2' });
      let pic = null;
      const choices = [null, ...BUILTIN.map(b => ({ kind: 'builtin', id: b.id }))];
      const pics = h('div.users-pics', { role: 'radiogroup', 'aria-label': 'Picture' }, choices.map(c => h('button.users-pic', {
        type: 'button', role: 'radio', 'aria-checked': String(c === null), 'aria-label': c ? BUILTIN.find(b => b.id === c.id).name : 'Their initial',
        dataset: { pic: c ? c.id : '' },
        onclick: e => {
          pic = c;
          for (const b of pics.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
        },
      }, avatarEl(h, { picture: c, costume: 'none', initial: '?', size: 34 }))));
      return form('add', solo ? 'Add someone to this computer' : 'Add a user', [
        solo ? para('What was here already — your settings, files and projects — becomes your profile. Nothing is moved or copied; the new person starts with an empty desktop.') : null,
        me?.el, nm.el, h('div.acct-field', h('span', { text: 'Picture' }), pics), pin1.el, pin2.el,
      ], 'Add user', async () => {
        if (me && !P.tidy(me.input.value)) throw new Error('Give yourself a name first, so people can tell the profiles apart.');
        if (pin1.input.value !== pin2.input.value) throw new Error('The two PINs don’t match.');
        if (pin1.input.value) { const why = P.checkSecret(pin1.input.value); if (why) throw new Error(why); }
        const made = await P.create({ name: nm.input.value, pic, secret: pin1.input.value, first: me ? { name: me.input.value, pic: myPic() } : undefined });
        shut();
        say(`${made.name} can sign in now`, 'Their desktop starts empty. Switch to them here, or pick them on the login screen in a new tab.', 'users');
      });
    }
    if (kind === 'rename') {
      const nm = field('Name', { value: p.name, maxlength: '24', name: 'name' });
      return form('rename', 'Rename', [nm.el], 'Save', async () => { P.rename(p.id, nm.input.value); shut(); });
    }
    if (kind === 'pin') {
      const cur = p.locked ? field('Current PIN or password', { type: 'password', name: 'current' }) : null;
      const pin1 = field(p.locked ? 'New PIN or password' : 'PIN or password', { type: 'password', autocomplete: 'new-password', name: 'pin' });
      const pin2 = field('The same again', { type: 'password', autocomplete: 'new-password', name: 'pin2' });
      return form('pin', p.locked ? 'Change your PIN' : 'Set a PIN', [
        para('A new tab will ask for it before opening your desktop. It is a front-end lock only.'),
        cur?.el, pin1.el, pin2.el,
      ], 'Save PIN', async () => {
        const why = P.checkSecret(pin1.input.value);
        if (why) throw new Error(why);
        if (pin1.input.value !== pin2.input.value) throw new Error('The two PINs don’t match.');
        await P.setSecret(p.id, pin1.input.value, cur ? cur.input.value : '');
        shut();
        say('PIN saved', 'New tabs will ask for it before opening your desktop.', 'lock');
      }, { extra: p.locked ? { act: 'remove-pin', label: 'Remove PIN', fn: async () => {
        await P.setSecret(p.id, null, cur.input.value);
        shut();
        say('PIN removed', 'Your desktop opens without one now.', 'unlock');
      } } : null });
    }
    if (kind === 'switch') {
      const f = field(`${p.name}’s PIN or password`, { type: 'password', name: 'secret' });
      return form('switch', `Switch to ${p.name}`, [f.el], 'Switch', () => P.switchTo(p.id, f.input.value));
    }
    if (kind === 'delete') {
      const f = p.locked ? field(`${p.name}’s PIN or password`, { type: 'password', name: 'secret' }) : null;
      return form('delete', `Delete ${p.name}?`, [
        para(`This erases ${p.name}’s settings, files, screen time and saved projects from this browser. Nobody else’s data is touched. It can’t be undone.`),
        f?.el,
      ], `Delete ${p.name}`, async () => {
        await P.remove(p.id, f ? f.input.value : '');
        shut();
        say(`${p.name} was deleted`, 'Their data is gone from this browser. Nobody else’s was touched.', 'trash');
      }, { danger: true });
    }
    if (kind === 'guest') {
      return form('guest', 'Start a guest session?', [
        para('Your desktop is saved and closed first. The guest gets an empty desktop and can’t see anyone’s files or profiles, and their files and settings aren’t kept.'),
      ], 'Start guest session', async () => P.startGuest());
    }
    return null;
  }

  function paint() {
    if (P.MODE === 'guest') { root.replaceChildren(guestCard()); return; }
    const all = P.list();
    const solo = !all.length;     /* nobody added yet: just the data that was here */
    const rows = solo
      ? [h('div.users-row.is-you', { role: 'listitem', dataset: { id: P.ID } },
          face({ name: accountName() || 'You', pic: myPic() }, 40),
          h('div.users-row__who', h('b', { text: accountName() || 'You' }), h('small', { text: 'You — the only person on this computer so far' })))]
      : all.map(row);
    root.replaceChildren(
      h('div.users-list', { role: 'list', 'aria-label': 'People on this computer' }, rows),
      stageEl(solo) || '',
      h('div.users-acts',
        all.length < P.MAX ? btn('plus', 'Add user', () => open('add'), 'add', '.btn--primary') : null,
        btn('user', 'Guest session', () => open('guest'), 'guest'),
        P.asksAtStart() ? btn('power', 'Sign out', () => P.signOut(), 'signout') : null),
      h('p.users-note', { text: NOTE }));
  }
  paint();
  return root;
}

/* ---------- the shell part ---------------------------------------------- */
export function mountUsers(host) {
  const offs = [];
  let sheet = null;
  let release = null;
  let overlay = null;

  function closeSheet() {
    sheet?.remove();
    sheet = null;
    release?.();
    release = null;
  }
  function openSheet() {
    if (sheet) return;
    const card = h('div.acct-sheet__card.users-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Users on this computer', tabindex: '-1' },
      h('button.acct-sheet__x', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('x')),
      h('div.acct-sheet__brand', h('span.acct-sheet__logo', icon('users')),
        h('b', { text: P.MODE === 'guest' ? 'Guest session' : 'Users on this computer' })),
      usersPanel());
    sheet = h('div.acct-sheet', { onclick: e => { if (e.target === sheet) closeSheet(); } }, card);
    host.appendChild(sheet);
    release = L.push({ name: 'users', el: card, trap: true, close: closeSheet });
    card.focus({ preventScroll: true });
  }
  /* over the lock screen: pick someone without unlocking this desktop */
  function openSwitch() {
    if (overlay) return;
    let rel = null;
    overlay = loginScreen({ overlay: true, close: () => { cover('users-switch', false); rel?.(); rel = null; overlay = null; } });
    host.appendChild(overlay);
    cover('users-switch', true);
    rel = L.push({ name: 'users-switch', el: overlay, trap: true, close: () => overlay?.close() });
  }

  offs.push(bus.on('users:open', o => (o && o.from === 'lock' ? openSwitch() : openSheet())));

  if (P.MODE === 'guest') {
    /* a guest is told, and keeps being shown, that their things are not kept */
    const bar = h('div.users-guestbar', { role: 'status' },
      icon('user'), h('span.users-guestbar__long', { text: 'Guest session · files aren’t kept' }), h('span.users-guestbar__short', { text: 'Guest' }),
      h('button.users-guestbar__end', { type: 'button', onclick: openSheet }, 'End…'));
    host.appendChild(bar);
    offs.push(() => bar.remove());
    offs.push(bus.on('boot:ready', () => say('You’re a guest', GUEST_NOTE, 'user')));
  } else {
    /* the login screen shows the picture chosen in Profile; a person added
       with a picture starts with it in Profile too */
    const sync = () => { try { P.setPicture(P.ID, myPic()); } catch (e) { /* the list changed under us */ } };
    const listed = P.current()?.pic;
    if (!myPic() && normPicture(listed)) store.set('portal.profile', { ...(store.get('portal.profile') || {}), picture: normPicture(listed) });
    else sync();
    offs.push(store.sub('portal.profile', sync));
  }

  return () => { offs.forEach(f => f?.()); closeSheet(); overlay?.close(); };
}

export default mountUsers;
