/* ============================================================
   settings-quiet.js — the Settings rows for the Spotlight, lock
   screen and notification batch, kept apart from settings.js so that
   file's diff stays small. settings.js hands in its own kit of
   row/switch/button builders (the same way settings-notify.js does).

     dndExceptionsPane   Notifications › who gets through Do Not Disturb
                         (prefs.dndAllow, read by js/shell/notifications.js)
     snippetsPane        Keyboard › Text snippets (js/core/snippets.js)
     lockPane            Desktop › Lock screen: the clock look and the
                         lock screen's own wallpaper (js/shell/lockscreen.js)

   Each only edits a pref; the work is done by modules that run
   without this window.
   ============================================================ */
import * as SN from '../core/snippets.js';
import { CLOCK_STYLES, clockStyle, lockPapers } from '../shell/lockscreen.js';
import { t } from '../core/i18n.js';

const KEY_ALLOW = 'prefs.dndAllow';
const allow = store => {
  const a = store.get(KEY_ALLOW) || {};
  return { apps: Array.isArray(a.apps) ? a.apps : [], people: Array.isArray(a.people) ? a.people : [] };
};

/** Settings › Notifications › Let through Do Not Disturb. */
export function dndExceptionsPane(k) {
  const { h, icon, store, caption, note, select, repaint, apps, api } = k;
  const a = allow(store);
  const set = next => { store.set(KEY_ALLOW, { apps: next.apps, people: next.people }); repaint(); };
  const nameOf = id => apps.find(x => x.id === id)?.name || id;

  const appChips = h('div.dndx__chips', { role: 'list', 'aria-label': t('Apps that get through Do Not Disturb') },
    a.apps.map(id => h('button.chip.chip--accent.dndx__chip', {
      type: 'button', role: 'listitem', dataset: { app: id }, 'aria-label': t('{v} gets through — remove', { v: nameOf(id) }),
      onclick: () => set({ ...allow(store), apps: allow(store).apps.filter(x => x !== id) }),
    }, h('span', { text: nameOf(id) }), icon('x'))));
  const rest = apps.filter(x => !a.apps.includes(x.id));
  const adder = h('div.row', { style: { gap: 'var(--sp-3)' } },
    select(t('Add an app that gets through'), [['', t('Add an app…')], ...rest.map(x => [x.id, x.name])], '',
      v => { if (v) set({ ...allow(store), apps: [...allow(store).apps, v] }); }));

  const friendsBox = h('div.dndx__chips', { role: 'group', 'aria-label': t('Friends who get through Do Not Disturb') },
    h('small.dim', { text: t('Loading friends…') }));
  import('../core/friends.js').then(F => {
    if (!friendsBox.isConnected && !friendsBox.parentNode) return;
    const list = F.available() ? F.friends() : [];
    friendsBox.replaceChildren(...(list.length ? list.map(f => {
      const on = a.people.includes(f.fp);
      return h('button.chip.dndx__chip', {
        type: 'button', text: f.display, 'aria-pressed': String(on), class: on ? 'chip--accent' : null, dataset: { fp: f.fp },
        onclick: () => {
          const cur = allow(store);
          set({ ...cur, people: cur.people.includes(f.fp) ? cur.people.filter(x => x !== f.fp) : [...cur.people, f.fp] });
        },
      });
    }) : [h('small.dim', { text: F.available() ? t('No friends yet — add some in Static Social › Friends.') : t('Friends are off for this person.') })]));
  }).catch(() => friendsBox.replaceChildren(h('small.dim', { text: t('Friends did not load.') })));

  return [
    caption(t('Let through Do Not Disturb')),
    h('div.col.dndx',
      note(t('While Do Not Disturb is on, the apps and friends you pick here still pop up (silently). Everything else waits in the Notification Centre.'), 'bell'),
      h('small.dim', { text: t('Apps') }),
      a.apps.length ? appChips : h('small.dim', { text: t('No apps chosen.') }),
      adder,
      h('small.dim', { text: t('Friends — their game night invitations and replies') }),
      friendsBox),
  ];
}

/** Settings › Keyboard › Text snippets. */
export function snippetsPane(k) {
  const { h, icon, caption, note, btn, repaint } = k;
  const cur = SN.list();
  const err = h('small.snip__err', { role: 'status', 'aria-live': 'polite', style: { color: 'var(--danger, #ff6b6b)', minHeight: '1.2em' } });
  const say = t => { err.textContent = t || ''; };

  const code = (value, label, onSet) => h('input.input.snip__code', {
    value, placeholder: ';sig', maxlength: String(SN.CODE_MAX), spellcheck: 'false', autocomplete: 'off',
    'aria-label': label, dataset: { snippets: 'off' }, onchange: onSet,
  });
  const text = (value, label, onSet) => h('textarea.input.snip__text', {
    value, placeholder: t('What it becomes'), maxlength: String(SN.TEXT_MAX), 'aria-label': label,
    dataset: { snippets: 'off' }, onchange: onSet,
  });
  /* a textarea's value is a property, not an attribute */
  const withValue = (el, v) => { el.value = v; return el; };

  const card = s => h('div.snip', { dataset: { id: s.id } },
    h('div.row',
      code(s.code, t('Code for “{code}”', { code: s.code }), e => {
        const r = SN.update(s.id, { code: e.target.value.trim() });
        if (!r.ok) { say(r.issue); e.target.value = s.code; } else { say(''); repaint(); }
      }),
      withValue(text(s.text, t('Text for {code}', { code: s.code }), e => {
        const r = SN.update(s.id, { text: e.target.value });
        if (!r.ok) { say(r.issue); e.target.value = s.text; } else say('');
      }), s.text),
      h('button.ibtn.tip', { type: 'button', 'data-tip': t('Delete'), 'aria-label': t('Delete snippet {code}', { code: s.code }),
        onclick: () => { SN.remove(s.id); repaint(); } }, icon('trash'))));

  const newCode = code('', t('Code for a new snippet'), () => {});
  const newText = withValue(text('', t('Text for a new snippet'), () => {}), '');
  newText.setAttribute('aria-label', t('Text for a new snippet'));
  const add = () => {
    const r = SN.add(newCode.value.trim(), newText.value);
    if (!r.ok) { say(r.issue); return; }
    say('');
    repaint();
  };

  return [
    caption(cur.length ? t('Text snippets · {n}', { n: cur.length }) : t('Text snippets')),
    h('div.col', { style: { gap: 'var(--sp-3)' } },
      ...cur.map(card),
      h('div.snip', { dataset: { new: '1' } },
        h('div.row', newCode, newText),
        h('div.row', btn('plus', t('Add snippet'), add))),
      err),
    note(t('Type a code and a space (or . , ; : ! ?) in any text box and it becomes the text. Start a code with ; or / so it never fires inside an ordinary word. {date}, {time} and {day} are filled in when it expands. Only what StaticOS draws is covered: a page in a frame keeps its own keyboard.'), 'keyboard'),
  ];
}

/** Settings › Desktop › Lock screen. */
export function lockPane(k) {
  const { h, store, group, row, caption, btn, select, api } = k;
  const papers = lockPapers();
  const cur = store.get('prefs.lockWallpaper') || '';
  return [
    caption(t('Lock screen')),
    group(
      row('clock', t('Lock screen clock'), t('Classic is thin and large; Bold is heavy; Stacked puts the hour over the minutes; Analogue is a clock face.'),
        select(t('Lock screen clock'), Object.entries(CLOCK_STYLES), clockStyle(), v => store.set('prefs.lockClock', v)),
        btn('lock', t('Lock now'), () => api.lock())),
      row('image', t('Lock screen wallpaper'), t('A picture just for the lock screen. “Same as the desktop” leaves the desktop showing through the frosted glass.'),
        select(t('Lock screen wallpaper'), [['', t('Same as the desktop')], ...papers.map(w => [w.id, w.name])],
          papers.some(w => w.id === cur) ? cur : '', v => store.set('prefs.lockWallpaper', v)))),
  ];
}
