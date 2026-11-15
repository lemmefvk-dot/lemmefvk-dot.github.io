/* ============================================================
   store-looks.js — the parts of Static Store that keep, send and
   undo looks. Static Store hands each its own helpers as `K`
   (api, act, tag, note, wallPreview, appGlyph, paint …).

     recorder()           "Recently changed": every change made in the
                          Store is remembered with what it replaced, so
                          one tap puts it back (prefs.storeRecent)
     lookPreview(K, L)    a small picture of what a look is, plus the list
                          of what applying it changes
     slotsCard(K)         look slots: "Study", "Gaming", "Night" — save,
                          switch in one click, update, rename, remove — and
                          send a look to a friend
     friendLooksCard(K)   looks friends sent you, to preview before applying
     dayNightCard(K)      a day look and a night look that switch by
                          themselves (js/core/automations.js does the switching)
     recentCard(K)        the list of recent changes, each with Undo

   The look itself is the SLOOK1 code (js/core/lookcode.js) everywhere:
   slots keep it, friends send it, the timer applies it.
   ============================================================ */
import { store } from '../core/store.js';
import * as LC from '../core/lookcode.js';
import * as THEMES from '../core/themes.js';
import * as WP from '../portal/wallpapers.js';
import * as DAY from '../core/daycycle.js';

/* ---------------- recently changed ---------------------------------- */
const RECENT = 'prefs.storeRecent';
const MAX_RECENT = 8;
const IGNORE = new Set(['storeRecent', 'recent', 'notiLog']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const prefsNow = () => store.get('prefs', {}) || {};
const rid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const recentList = () => {
  const v = store.get(RECENT, []);
  return (Array.isArray(v) ? v : []).filter(e => e && typeof e.id === 'string' && typeof e.label === 'string');
};

/** Run `fn`, and remember what it changed (and what it was) under `label`. */
export function track(label, fn) {
  const before = { ...prefsNow() };
  const wall = store.get('wallpaper');
  const done = () => {
    const now = prefsNow();
    const was = {}, unset = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(now)])) {
      if (IGNORE.has(k) || same(before[k], now[k])) continue;
      if (k in before) was[k] = before[k]; else unset.push(k);
    }
    const wallChanged = !same(wall, store.get('wallpaper'));
    if (!Object.keys(was).length && !unset.length && !wallChanged) return;
    const entry = { id: rid(), label, at: Date.now(), was, unset, wall: wallChanged ? wall : null };
    store.set(RECENT, [entry, ...recentList()].slice(0, MAX_RECENT));
  };
  const r = fn();
  if (r && typeof r.then === 'function') return r.then(v => { done(); return v; });
  done();
  return r;
}

/** Put back what one change replaced. */
export function undoChange(id) {
  const e = recentList().find(x => x.id === id);
  if (!e) return false;
  const cur = { ...prefsNow() };
  for (const [k, v] of Object.entries(e.was || {})) cur[k] = v;
  for (const k of e.unset || []) delete cur[k];
  cur.storeRecent = recentList().filter(x => x.id !== id);
  store.set('prefs', cur);
  if (e.wall) store.set('wallpaper', e.wall);
  return true;
}

const ago = at => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};

export function recentCard(K) {
  const { api, paint } = K;
  const { h, icon } = api;
  const list = recentList();
  return h('section.st-recent', { dataset: { recent: '' } },
    h('div.label', { text: 'Recently changed' }),
    list.length
      ? h('div.st-recent__list', list.map(e => h('div.st-recent__row', { dataset: { change: e.label } },
        h('span.grow', h('b', { text: e.label }), h('small', { text: ago(e.at) })),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': `Undo ${e.label}`, onclick: () => { undoChange(e.id); paint(); } }, icon('rotate-ccw'), 'Undo'))))
      : h('p.st-foot', { text: 'Nothing changed from the Store yet. Anything you change here shows up with a one-tap Undo.' }));
}

/* ---------------- a look, drawn ------------------------------------- */
const SAMPLE = ['files', 'store', 'music'];

/** A small picture of a look and what applying it changes. `L` is a decoded look. */
export function lookPreview(K, L) {
  const { api, wallPreview, appGlyph } = K;
  const { h, icon } = api;
  const p = prefsNow();
  const accent = L.accent || THEMES.canonId(p.accent);
  const mode = L.theme || (p.theme === 'light' ? 'light' : 'dark');
  const iconStyle = L.iconStyle || p.iconStyle || 'glass';
  const wall = L.wallpaper?.id ? WP.byId(store, L.wallpaper.id) : L.wallpaper?.url ? { kind: L.wallpaper.kind === 'video' ? 'video' : 'image', url: L.wallpaper.url, name: L.wallpaper.name } : WP.active(store);
  const art = wall ? wallPreview(wall) : h('div.st-wall__art');
  art.classList.add('st-lp__wall');
  const apps = SAMPLE.map(id => api.getApp(id)).filter(Boolean);
  const box = h('div.st-lp', { dataset: { mode, accent, icons: iconStyle } },
    h('div.st-lp__stage', { style: { '--lp-accent': THEMES.swatch(accent) } },
      art,
      h('div.st-lp__win', { class: mode === 'light' ? 'is-light' : null },
        h('i.st-lp__bar'), h('i.st-lp__ln'), h('i.st-lp__ln.is-s'), h('i.st-lp__btn')),
      h('div.st-look.st-lp__tiles', { dataset: { icons: iconStyle } }, apps.map(a => appGlyph(a, 22)))),
    h('ul.st-lp__list', LC.describeLook(L, store).map(t => h('li', { text: t }))));
  return box;
}

/* ---------------- look slots ----------------------------------------- */
const slotSummary = code => {
  try {
    const L = LC.decodeLook(code);
    return [L.theme === 'light' ? 'Light' : 'Dark', L.iconStyle ? `${L.iconStyle[0].toUpperCase()}${L.iconStyle.slice(1)} icons` : null, L.shell === 'taskbar' ? 'Taskbar' : null].filter(Boolean).join(' · ');
  } catch (e) { return ''; }
};
const slotAccent = code => { try { return THEMES.swatch(LC.decodeLook(code).accent || 'aether'); } catch (e) { return 'var(--accent)'; } };

export function slotsCard(K) {
  const { api, note, paint } = K;
  const { h, icon } = api;
  const slots = LC.slots(store);
  const mine = LC.encodeLook(store);
  const fail = e => note({ icon: 'alert', title: 'That didn’t work', message: String(e?.message || e) });

  const input = h('input.st-code', { type: 'text', maxlength: '24', placeholder: 'Name this look', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Name for this look', 'data-slot-name': '' });
  const save = () => {
    try {
      const s = track(`Saved look “${input.value.trim()}”`, () => LC.saveSlot(input.value, store));
      note({ icon: 'check', title: `“${s.name}” saved`, message: 'The look you have now is kept. Switch back to it any time.' });
      paint();
    } catch (e) { fail(e); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  const useIt = s => {
    try {
      const used = track(`Look “${s.name}”`, () => LC.useSlot(s.id, store));
      if (!used) return;
      note({ icon: 'sparkles', title: `${s.name} look on`, message: LC.describeLook(used.look, store).join(' · '), timeout: 8000, actions: [{ label: 'Undo', onClick: () => { used.undo(); paint(); } }] });
      paint();
    } catch (e) { fail(e); }
  };

  const rows = slots.map(s => {
    const on = s.code === mine;
    return h(`div.st-slot${on ? '.is-on' : ''}`, { dataset: { slot: s.name } },
      h('i.st-slot__dot', { style: { background: slotAccent(s.code) } }),
      h('span.grow', h('b', { text: s.name }), h('small', { text: slotSummary(s.code) })),
      on ? K.tag('In use', 'check', true) : h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-use-slot': s.name, 'aria-label': `Switch to ${s.name}`, onclick: () => useIt(s) }, icon('check'), 'Use'),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'Update', 'aria-label': `Keep the current look as ${s.name}`, onclick: () => { try { track(`Updated look “${s.name}”`, () => LC.saveSlot(s.name, store)); paint(); } catch (e) { fail(e); } } }, icon('save')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'Rename', 'aria-label': `Rename ${s.name}`, onclick: e => {
        /* the name turns into a field in place: Enter keeps it, Escape or leaving cancels */
        const b = e.currentTarget.closest('.st-slot').querySelector('b');
        const f = h('input.st-code', { type: 'text', value: s.name, maxlength: '24', 'aria-label': `New name for ${s.name}`, 'data-rename': '',
          style: { width: '120px', height: '24px' },
          onkeydown: ev => {
            if (ev.key === 'Enter') { LC.renameSlot(s.id, f.value, store); paint(); }
            else if (ev.key === 'Escape') paint();
          },
          onblur: () => setTimeout(() => { if (f.isConnected) paint(); }, 120) });
        b.replaceWith(f);
        f.focus(); f.select();
      } }, icon('type')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'Remove', 'aria-label': `Remove ${s.name}`, onclick: () => { LC.removeSlot(s.id, store); paint(); } }, icon('trash')));
  });

  /* ---- send one to a friend ---- */
  const source = h('select.select', { 'aria-label': 'Which look to send', 'data-send-source': '' },
    h('option', { value: 'now', text: 'The look I have now' }),
    ...slots.map(s => h('option', { value: s.id, text: s.name })));
  const sendBtn = h('button.btn.btn--sm', { type: 'button', 'data-send-look': '', onclick: async e => {
    const r = e.currentTarget.getBoundingClientRect();
    const slot = slots.find(s => s.id === source.value);
    const code = slot ? slot.code : mine, name = slot ? slot.name : 'My look';
    try {
      const F = await import('../core/friends.js');
      if (!F.available()) { note({ icon: 'users', title: 'Friends isn’t available here', message: 'Guests and the sign-in screen have no friends. Sign in to a profile first.' }); return; }
      await F.ready();
      const list = F.friends();
      if (!list.length) { note({ icon: 'users', title: 'No friends yet', message: 'Add a friend by code in Static Social, then send them a look.' }); return; }
      api.menu(list.map(f => ({
        label: f.display, icon: 'user', hint: f.presence === 'offline' ? 'Offline' : 'Online', disabled: f.presence === 'offline',
        onClick: () => {
          const res = F.sendLook(f.fp, code, name);
          note(res.ok ? { icon: 'send', title: `Sent to ${f.display}`, message: 'They get a preview first and choose whether to apply it.' } : { icon: 'alert', title: 'Not sent', message: res.error });
        },
      })), r.left, r.bottom + 6);
    } catch (err) { fail(err); }
  } }, icon('send'), 'Send to a friend…');

  return h('section.st-slots', { dataset: { slots: '' } },
    h('div.label', { text: 'Your looks' }),
    h('p.st-foot', { style: { margin: '4px 0 var(--sp-3)' }, text: 'Keep how things look right now under a name, like Study, Gaming or Night, and switch between them in one click. A look is your theme, wallpaper, icons, sounds and desktop layout.' }),
    slots.length ? h('div.st-slots__list', rows) : null,
    h('div.row.st-slots__new', { style: { gap: '6px', flexWrap: 'wrap' } },
      input,
      ...LC.SLOT_NAMES.filter(n => !slots.some(s => s.name.toLowerCase() === n.toLowerCase())).map(n => h('button.st-chip', { type: 'button', onclick: () => { input.value = n; input.focus(); } }, n)),
      h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-save-slot': '', onclick: save }, icon('save'), 'Keep this look')),
    h('div.row.st-slots__send', { style: { gap: '6px', marginTop: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' } },
      h('small.dim', { text: 'Send to a friend who is online:' }), source, sendBtn),
    h('p.st-foot', { style: { margin: '4px 0 0' }, text: 'Looks go straight to your friend, who sees a preview and chooses. Nothing is stored anywhere in between, so a friend who is offline can’t get one.' }));
}

/* ---------------- looks friends sent ------------------------------------ */
export function friendLooksCard(K) {
  const { api, note, paint, friendsMod } = K;
  const { h, icon } = api;
  if (!friendsMod) return null;
  let list = [];
  try { list = friendsMod.looks(); } catch (e) { list = []; }
  if (!list.length) return null;
  return h('section.st-fl', { dataset: { friendLooks: '' } },
    h('div.label', { text: `Looks from friends · ${list.length}` }),
    ...list.map(f => {
      let L = null;
      try { L = LC.decodeLook(f.code); } catch (e) { return null; }
      const wrap = h('div.st-fl__row', { dataset: { from: f.from } });
      const panel = h('div.st-fl__panel', { hidden: true });
      const apply = () => {
        const used = track(`Look from ${f.from}`, () => ({ undo: LC.applyLook(L, store) }));
        friendsMod.dismissLook(f.id);
        note({ icon: 'sparkles', title: `${f.name} applied`, message: LC.describeLook(L, store).join(' · '), timeout: 9000, actions: [{ label: 'Undo', onClick: () => { used.undo(); paint(); } }] });
        paint();
      };
      wrap.append(
        h('span.grow', h('b', { text: f.name }), h('small', { text: `from ${f.from} · ${ago(f.at)}` })),
        h('button.btn.btn--sm', { type: 'button', 'data-preview-look': '', 'aria-expanded': 'false', onclick: e => {
          panel.hidden = !panel.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
          if (!panel.hidden && !panel.firstChild) panel.append(lookPreview(K, L));
        } }, icon('eye'), 'Preview'),
        h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-apply-look': '', onclick: apply }, icon('check'), 'Apply'),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': `Dismiss the look from ${f.from}`, onclick: () => { friendsMod.dismissLook(f.id); paint(); } }, 'Dismiss'));
      return h('div', wrap, panel);
    }).filter(Boolean));
}

/* ---------------- a day look and a night look --------------------------- */
export function dayNightCard(K) {
  const { api, AM, paint } = K;
  const { h } = api;
  if (!AM) return null;
  const t = AM.lookTimer();
  const slots = LC.slots(store);
  const set = patch => { AM.saveLookTimer(patch); paint(); };
  const pick = (which, label) => h('label.st-dn__f', h('span', { text: label }),
    h('select.select', { 'aria-label': label, 'data-dn': which, onchange: e => set({ [which]: e.target.value || null }) },
      h('option', { value: '', text: 'Leave as it is' }),
      ...slots.map(s => h('option', { value: s.id, text: s.name, selected: t[which] === s.id }))));
  const time = (which, label) => h('label.st-dn__f', h('span', { text: label }),
    h('input', { type: 'time', value: t[which], 'aria-label': label, 'data-dn': which, onchange: e => { if (/^\d\d:\d\d$/.test(e.target.value)) set({ [which]: e.target.value }); } }));
  const status = h('small.dim', { 'data-dn-status': '', text: '' });
  AM.lookPeriod(new Date(), t).then(p => {
    const s = DAY.source();
    status.textContent = `It is ${p.period} now, by ${t.at === 'fixed' ? `the times you set` : s.kind === 'place' ? `the real sunrise and sunset in ${s.place}` : 'fixed times (6:30 and 19:30) — give Weather a place to follow the real sun'}.`;
  }).catch(() => {});
  return h('section.st-dn', { dataset: { dayNight: '' } },
    h('div.row', { style: { alignItems: 'center', gap: 'var(--sp-3)' } },
      h('div.grow', h('div.label', { text: 'Day look and night look' }),
        h('small.dim', { text: 'Two of your looks that switch by themselves. A look you pick by hand stays until the next switch.' })),
      h('button.switch', { type: 'button', role: 'switch', 'aria-label': 'Switch looks by themselves', 'aria-checked': String(t.on), class: t.on ? 'is-on' : null, 'data-dn-on': '',
        onclick: () => set({ on: !t.on }) })),
    slots.length
      ? h('div.st-dn__grid', pick('day', 'Day look'), pick('night', 'Night look'),
        h('label.st-dn__f', h('span', { text: 'Change at' }),
          h('select.select', { 'aria-label': 'When to change', 'data-dn': 'at', onchange: e => set({ at: e.target.value }) },
            h('option', { value: 'sun', text: 'Sunrise and sunset', selected: t.at === 'sun' }),
            h('option', { value: 'fixed', text: 'Times I choose', selected: t.at === 'fixed' }))),
        t.at === 'fixed' ? time('from', 'Day starts') : null, t.at === 'fixed' ? time('to', 'Night starts') : null)
      : h('p.st-foot', { text: 'Keep two looks above first (for example Study for the day and Night for the evening), then choose them here.' }),
    status);
}
