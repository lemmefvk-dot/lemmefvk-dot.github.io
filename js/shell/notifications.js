/* ============================================================
   notifications.js — the notification engine.

   One entry point, api.notify() → bus 'noti:push', with the same
   shape every module already calls it with:

     { app, title, message, icon, actions:[{label,onClick}],
       timeout, onClick }

   and four optional extras:

     progress  0–100, draws a bar and keeps the toast on screen
     key       a stable id; a second push with the same key
               updates the first instead of stacking a new one
               (that is how a download reports itself)
     read      seeded false; opening the centre marks everything read
     stale     set on entries restored from the last session

   Toasts pop bottom-right above the dock. Everything is archived
   in the centre, grouped by app, and the archive is persisted in
   prefs.notiLog so history survives a reload — the functions
   behind action buttons cannot be serialised, so restored entries
   come back as a readable record, not a clickable one.

   Do Not Disturb and the per-app switches in Settings suppress
   the toast only; nothing is ever silently dropped. Two pushes get
   through Do Not Disturb, with throughDnd: the focus timer's end note
   (js/core/focus.js), since focus mode is what turned DND on, and a
   homework reminder (js/core/automations.js). urgent is a different
   thing: it only keeps a note out of the summary.

   The summary (js/core/notisummary.js, Settings › Notifications):
   an app you put in it does not pop up. Its notifications reach the
   centre at once, silently, marked held, and at each delivery time
   one card lists them grouped by app, each still actionable. urgent,
   throughDnd and progress pushes are never held; a time that passes
   in Do Not Disturb, or while closed, is delivered when it ends / on
   the next load. A held note's actions are gone after a reload, like
   any restored entry.

   Quieter ways to handle one: Snooze on a note in the centre (10 min,
   1 hour, tomorrow 8:00 — it comes back as a fresh notification), and
   "Mute 1 h" on a pop-up (that app's pop-ups stop for an hour; the notes
   still reach the centre). Do Not Disturb has exceptions: apps and
   friends picked in Settings › Notifications (prefs.dndAllow) get their
   pop-ups through. What Do Not Disturb kept off the screen is counted
   (js/core/dndheld.js) for the bell, the centre and the lock screen, and
   the centre's search box filters by app and words.

   The centre has a second tab, Achievements (js/core/achievements.js):
   what you have earned on this device, and what is closest. A push
   with kind: 'achievement' gets the achievement look as a toast.
   bus 'achievements:open' opens the centre on that tab.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as L from '../core/layers.js';
import * as SUM from '../core/notisummary.js';
import * as sfx from '../core/sfx.js';
import * as HELD from '../core/dndheld.js';
import * as DNDR from '../core/dndrules.js';
import * as DNDS from '../core/dndsched.js';
import { t as tr } from '../core/i18n.js';

const MAX_LIVE = 4;
const MAX_ARCHIVE = 40;
const OUT_MS = 220;
const LOG_KEY = 'prefs.notiLog';
const MUTE_KEY = 'prefs.notiMuteUntil';    /* { appId: ms } — "Mute 1 h" on a pop-up */
const SNOOZE_KEY = 'prefs.notiSnoozed';    /* [{ app, title, message, icon, due }] — waiting to come back */
const ALLOW_KEY = 'prefs.dndAllow';        /* { apps: [appId], people: [friend fp] } — let through Do Not Disturb */
const MAX_SNOOZED = 30;
const HOUR = 3600_000;

export function mountNotifications(host) {
  const { h, icon, clear, on, fmt, store, bus, getApp } = api;

  const S = { archive: [], live: [], drawer: null, offs: [], seq: 0, closedAt: 0, achSeq: 0, achAll: false, card: null };

  /* One persistent live region: screen readers announce what is added to
     it. (Each toast used to be its own role=status as well, which is not
     reliably read when it is inserted, and double-read when it is.) */
  const stack = h('div.toasts', { role: 'region', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': tr('Notifications') });
  host.appendChild(stack);

  /* ---------------- pieces --------------- */
  const appOf = n => getApp(String(n.app || '').toLowerCase());
  const appId = n => appOf(n)?.id || String(n.app || 'staticos').toLowerCase();
  const muteLeft = n => Math.max(0, (Number((store.get(MUTE_KEY) || {})[appId(n)]) || 0) - Date.now());
  const muted = n => store.get('prefs.notiApps', {})?.[appId(n)] === false || muteLeft(n) > 0;
  const allow = () => { const a = store.get(ALLOW_KEY) || {}; return { apps: Array.isArray(a.apps) ? a.apps : [], people: Array.isArray(a.people) ? a.people : [] }; };
  /* an app or a friend you chose in Settings › Notifications gets through Do Not Disturb */
  const letThrough = n => { const a = allow(); return a.apps.includes(appId(n)) || (!!n.from && a.people.includes(n.from)); };

  function glyph(n) {
    const app = appOf(n);
    return h('div.glyph', {
      style: app ? { '--g1': app.g1, '--g2': app.g2 }
        : { '--g1': 'var(--accent-soft)', '--g2': 'var(--accent)' },
    }, icon(n.icon));
  }

  const title = n => h('div.toast__t', { text: n.title });
  const message = n => (n.message ? h('div.toast__m', { text: n.message }) : null);

  const progressBar = n => (typeof n.progress === 'number'
    ? h('div.noti__prog', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(fmt.clamp(n.progress, 0, 100))),
        'aria-label': tr('{title} progress', { title: n.title }) },
        h('i', { style: { width: `${fmt.clamp(n.progress, 0, 100)}%` } }))
    : null);

  const actionRow = (n, after) => (n.actions?.length
    ? h('div.toast__acts', n.actions.map(a => h('button.btn.btn--sm', {
        text: a.label || 'OK',
        onclick: e => { e.stopPropagation(); after?.(); a.onClick?.(); },
      })))
    : null);

  /* "Mute this app for 1 hour" on a pop-up: it stops popping up; its notes still reach the centre */
  function muteApp(n, ms = HOUR) {
    const id = appId(n);
    const cur = { ...(store.get(MUTE_KEY) || {}) };
    cur[id] = Date.now() + ms;
    store.set(MUTE_KEY, cur);
    const name = appOf(n)?.name || n.app;
    bus.emit('noti:push', {
      app: 'StaticOS', icon: 'bell-off', title: tr('{name} muted for 1 hour', { name }),
      message: tr('Its notifications still reach the Notification Centre.'), timeout: 6000,
      actions: [{ label: tr('Undo'), onClick: () => unmuteApp(id) }],
    });
  }
  function unmuteApp(id) {
    const cur = { ...(store.get(MUTE_KEY) || {}) };
    delete cur[id];
    store.set(MUTE_KEY, cur);
    if (S.drawer) paintList();
  }
  const muteRow = (n, t) => (n.kind || n.progress !== null || n.throughDnd || n.app === 'StaticOS' ? null
    : h('div.toast__more', h('button.toast__mute', {
        type: 'button', text: tr('Mute 1 h'), 'aria-label': `Mute ${appOf(n)?.name || n.app} for 1 hour`,
        onclick: e => { e.stopPropagation(); muteApp(n); dismiss(t); },
      })));

  /* ---------------- archive -------------- */
  const persist = () => store.set(LOG_KEY, S.archive.slice(0, MAX_ARCHIVE).map(n => ({
    app: n.app, title: n.title, message: n.message, icon: n.icon,
    at: n.at, progress: typeof n.progress === 'number' ? n.progress : null, read: !!n.read, held: !!n.held, dh: !!n.dndHeld,
  })));

  function restore() {
    const rows = store.get(LOG_KEY);
    if (!Array.isArray(rows)) return;
    S.archive = rows.filter(r => r && r.title).slice(0, MAX_ARCHIVE).map(r => ({
      id: ++S.seq,
      app: r.app || 'StaticOS', title: r.title, message: r.message || '',
      icon: r.icon || 'bell', actions: [], onClick: null,
      progress: typeof r.progress === 'number' ? r.progress : null,
      at: r.at || new Date().toISOString(), read: true, stale: true, held: r.held === true, dndHeld: r.dh === true,
    }));
  }

  function record(raw) {
    const n = {
      id: ++S.seq,
      key: raw.key || null,
      app: raw.app || 'StaticOS',
      title: raw.title || tr('Notification'),
      message: raw.message || '',
      icon: raw.icon || appOf(raw)?.icon || 'bell',
      actions: Array.isArray(raw.actions) ? raw.actions.filter(Boolean) : [],
      timeout: raw.timeout === undefined ? 6000 : raw.timeout,
      onClick: typeof raw.onClick === 'function' ? raw.onClick : null,
      progress: typeof raw.progress === 'number' ? raw.progress : null,
      kind: raw.kind === 'achievement' ? 'achievement' : null,
      /* the focus timer's own end note (js/core/focus.js) is the one thing
         Do Not Disturb lets through — focus mode turned it on */
      throughDnd: raw.throughDnd === true,
      from: typeof raw.from === 'string' ? raw.from : null,    /* a friend's id, for the Do Not Disturb exceptions */
      urgent: raw.urgent === true,
      held: false,
      dndHeld: false,                                          /* Do Not Disturb kept its pop-up off the screen */
      at: new Date().toISOString(),
      read: false,
    };
    S.archive.unshift(n);
    if (S.archive.length > MAX_ARCHIVE) S.archive.length = MAX_ARCHIVE;
    return n;
  }

  const unread = () => S.archive.filter(n => !n.read).length;

  function changed() {
    persist();
    HELD.set(S.archive.filter(n => n.dndHeld && !n.read).map(n => Date.parse(n.at)));
    if (S.drawer) paintList();
    bus.emit('noti:count', unread());
  }

  /* ---------------- toasts --------------- */
  function toast(n) {
    while (S.live.length >= MAX_LIVE) dismiss(S.live[0]);

    const t = { n, el: null, timer: 0, out: false, body: null };

    const open = h('button.toast__open', {
      onclick: () => { dismiss(t); if (n.onClick) { n.read = true; n.onClick(); changed(); } },
      'aria-label': n.onClick ? tr('{title} — open', { title: n.title }) : n.title,
    });

    t.body = h('div.toast__b', open);
    t.el = h('div.toast', { class: n.kind === 'achievement' ? 'toast--ach' : null },
      glyph(n),
      t.body,
      h('button.ibtn.toast__x.tip', {
        'data-tip': tr('Dismiss'), 'aria-label': tr('Dismiss notification'),
        onclick: () => dismiss(t),
      }, icon('x')));

    t.paint = () => {
      clear(open);
      open.append(...[h('div.toast__app', { text: String(n.app).toUpperCase() }), title(n), message(n)].filter(Boolean));
      clear(t.body);
      t.body.append(...[open, progressBar(n), actionRow(n, () => dismiss(t)), muteRow(n, t)].filter(Boolean));
    };
    t.paint();

    stack.appendChild(t.el);
    S.live.push(t);
    /* a notification carrying progress stays until it is finished or replaced */
    if (n.timeout > 0 && n.progress === null) t.timer = setTimeout(() => dismiss(t), n.timeout);
    return t;
  }

  function dismiss(t) {
    if (!t || t.out) return;
    t.out = true;
    clearTimeout(t.timer);
    t.el.classList.add('is-out');
    setTimeout(() => t.el.remove(), OUT_MS);
    const i = S.live.indexOf(t);
    if (i > -1) S.live.splice(i, 1);
  }

  const liveFor = n => S.live.find(t => t.n === n);

  /* ---------------- centre --------------- */
  function drop(n) {
    const i = S.archive.indexOf(n);
    if (i > -1) S.archive.splice(i, 1);
    const t = liveFor(n);
    if (t) dismiss(t);
    changed();
  }

  function clearApp(name) {
    S.archive = S.archive.filter(n => n.app !== name);
    changed();
  }

  /** Newest first, but every app's notifications kept together. */
  function groups(items = S.archive) {
    const out = [];
    const byName = new Map();
    for (const n of items) {
      let g = byName.get(n.app);
      if (!g) { g = { app: n.app, items: [] }; byName.set(n.app, g); out.push(g); }
      g.items.push(n);
    }
    return out;
  }

  function item(n) {
    /* `wasUnread` is stamped when the centre opens: opening marks everything
       read, so without it the highlight would vanish in the same frame */
    const el = h('div.noti__item', { class: n.wasUnread ? 'is-new' : null },
      glyph(n),
      /* the app name is already on the group header, so the row leads with
         the title and keeps the timestamp on the right */
      h('div.toast__b',
        h('div.row',
          h('div.grow', title(n)),
          n.held ? h('span.chip', { text: tr('For summary') }) : null,
          n.dndHeld ? h('span.chip', { text: tr('Held by DND') }) : null,
          h('small.dim.noti__at', { text: fmt.fmtAgo(n.at) })),
        message(n),
        progressBar(n),
        /* An archived notification keeps its actions: a toast nobody saw —
           Do Not Disturb, a muted app, or one pushed off the stack — must
           still be actionable here. Entries restored from the last session
           have none, by construction. */
        actionRow(n, () => drop(n))),
      n.progress === null ? h('button.ibtn.noti__z.tip', {
        'data-tip': tr('Snooze'), 'aria-label': tr('Snooze {title}', { title: n.title }), 'aria-expanded': 'false',
        onclick: e => { e.stopPropagation(); toggleSnooze(el, n, e.currentTarget); },
      }, icon('clock')) : null,
      h('button.ibtn.noti__x.tip', {
        'data-tip': tr('Remove'), 'aria-label': tr('Remove {title}', { title: n.title }),
        onclick: e => { e.stopPropagation(); drop(n); },
      }, icon('x')));

    if (n.onClick) {
      el.classList.add('is-click');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      const go = () => { n.onClick(); drop(n); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    }
    return el;
  }

  /* the three snooze choices open under the note, inside the row */
  function toggleSnooze(el, n, btn) {
    const old = el.querySelector('.noti__snz');
    if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    const pick = (label, due) => h('button.btn.btn--sm', {
      type: 'button', text: label, dataset: { snooze: label },
      onclick: e => { e.stopPropagation(); snoozeNoti(n, due); },
    });
    const now = Date.now();
    el.querySelector('.toast__b').appendChild(h('div.noti__snz', { role: 'group', 'aria-label': tr('Snooze for') },
      pick('10 min', now + 10 * 60_000), pick('1 hour', now + HOUR), pick(tr('Tomorrow morning'), DNDR.tomorrowMorning(now))));
    btn.setAttribute('aria-expanded', 'true');
  }

  /* the notes the search box and "Show held" let through */
  function visible() {
    const f = S.drawer?.f;
    if (!f) return S.archive;
    const q = f.q.trim().toLowerCase();
    return S.archive.filter(n => (!f.app || n.app === f.app) && (!f.held || n.dndHeld)
      && (!q || `${n.app} ${n.title} ${n.message}`.toLowerCase().includes(q)));
  }

  /* app choices follow what the archive holds; the picked one stays picked */
  function syncFilter() {
    const d = S.drawer;
    if (!d) return;
    const apps = [...new Set(S.archive.map(n => n.app))].sort((a, b) => a.localeCompare(b));
    if (d.f.app && !apps.includes(d.f.app)) d.f.app = '';
    clear(d.appSel);
    d.appSel.append(h('option', { value: '', text: tr('All apps') }), ...apps.map(a => h('option', { value: a, text: a })));
    d.appSel.value = d.f.app;
    const held = S.archive.filter(n => n.dndHeld).length;
    clear(d.heldRow);
    d.heldRow.hidden = !held;
    if (held) {
      d.heldRow.append(h('span', { text: tr('{held} held by Do Not Disturb', { held }) }),
        h('button.noti__link', {
          type: 'button', text: d.f.held ? tr('Show all') : tr('Show held'), 'aria-pressed': String(d.f.held),
          onclick: () => { d.f.held = !d.f.held; paintList(); },
        }));
    }
    const sn = snoozed().length;
    d.snz.textContent = sn ? `${sn} snoozed` : '';
    d.fbar.hidden = d.tab !== 'noti' || (!S.archive.length && !d.f.q && !d.f.held);
  }

  function paintList() {
    const list = S.drawer?.list;
    if (!list) return;
    clear(list);
    syncFilter();
    if (!S.archive.length) {
      list.appendChild(h('div.noti__empty', { text: tr('No notifications') }));
      S.drawer.count.textContent = '';
      return;
    }
    const shown = visible();
    if (!shown.length) {
      list.appendChild(h('div.noti__empty', { text: tr('No notifications match') }));
      S.drawer.count.textContent = '';
      return;
    }
    /* the badge reports what was waiting when the centre was opened; the
       act of opening it is what marks them read */
    const n = S.drawer.wasNew;
    S.drawer.count.textContent = n ? `${n} new` : '';
    for (const g of groups(shown)) {
      const off = store.get('prefs.notiApps', {})?.[appId(g.items[0])] === false;
      const left = muteLeft(g.items[0]);
      list.appendChild(h('div.noti__g',
        h('div.noti__ghead',
          h('span.grow.trunc', { text: g.app }),
          off ? h('span.chip', { text: tr('Muted') }) : null,
          !off && left ? h('button.chip.noti__unmute', {
            type: 'button', text: `Muted ${left >= HOUR ? '1 h' : `${Math.ceil(left / 60_000)} min`} · Undo`,
            'aria-label': tr('{app} is muted for now — unmute', { app: g.app }), onclick: () => unmuteApp(appId(g.items[0])),
          }) : null,
          h('span.noti__gn', { text: String(g.items.length) }),
          h('button.ibtn.tip', {
            'data-tip': tr('Clear {app}', { app: g.app }), 'aria-label': tr('Clear all {app} notifications', { app: g.app }),
            onclick: () => clearApp(g.app),
          }, icon('x'))),
        g.items.map(item)));
    }
  }

  /* ---------------- achievements tab ------ */
  let achP = null;
  const achMod = () => (achP || (achP = import('../core/achievements.js').catch(() => null)));

  /* Sharing a badge: off until switched on here (prefs.shareBadges). It puts
     "Earned <badge>" in your Friends status for an hour — the status your
     friends already see — and only when you press Share on that badge. */
  const shareOn = () => store.get('prefs.shareBadges', false) === true;
  async function shareBadge(a) {
    const F = await import('../core/friends.js').catch(() => null);
    if (!F || !F.available()) { api.notify({ app: 'Achievements', icon: 'users', title: tr('Friends are not available'), message: tr('Sign in to a profile to share with friends.') }); return; }
    const had = F.myStatus();
    if (had && !(await api.confirm({ title: tr('Replace your status?'), message: `Your friends see “${had.text || had.emoji}” now. Sharing “${a.name}” replaces it for an hour.`, ok: tr('Share') }))) return;
    F.setStatus({ text: tr('Earned {name}', { name: a.name }), emoji: '🏅', expiry: '1h' });
    api.notify({ app: 'Achievements', icon: 'users', title: tr('Shared with your friends'), message: tr('They see “Earned {name}” as your status for an hour.', { name: a.name }) });
  }
  function achRow(a, opts = {}) {
    const pct = a.goal ? Math.round(((a.progress || 0) / a.goal) * 100) : 0;
    const showProg = a.goal && (opts.all || !a.unlocked);
    return h('div.ach-row', { class: a.unlocked ? 'is-on' : null, dataset: { ach: a.id } },
      h('div.ach-row__ic', icon(a.icon || 'star')),
      h('div.toast__b',
        h('div.row',
          h('div.grow.trunc.toast__t', { text: a.name }),
          a.season ? h('span.ach-row__tag', { text: tr('Halloween') }) : null,
          a.unlocked && a.at ? h('small.dim.noti__at', { text: fmt.fmtAgo(new Date(a.at).toISOString()) }) : null),
        h('div.toast__m', { text: a.desc }),
        a.unlocked && shareOn()
          ? h('button.btn.btn--sm.ach-row__share', { type: 'button', 'aria-label': tr('Share {name} with friends', { name: a.name }), onclick: () => shareBadge(a) }, icon('users'), tr('Share'))
          : null,
        showProg
          ? h('div.ach-row__prog',
              h('div.noti__prog', {
                role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.goal),
                'aria-valuenow': String(a.progress || 0), 'aria-label': tr('{name} progress', { name: a.name }),
              }, h('i', { style: { width: `${Math.max(pct, 3)}%` } })),
              h('small', { text: `${a.progress || 0} / ${a.goal}${a.unit ? ` ${a.unit}` : ''}` }))
          : null));
  }

  async function paintAch() {
    const d = S.drawer;
    if (!d) return;
    const my = ++S.achSeq;
    const A = await achMod();
    if (S.drawer !== d || my !== S.achSeq) return;
    clear(d.ach);
    if (!A) { d.ach.appendChild(h('div.noti__empty', { text: tr('Achievements did not load in this build.') })); return; }
    const sum = A.summary(null, 3);
    const every = A.list();
    const counted = every.filter(a => a.goal).sort((a, b) => (b.progress / b.goal) - (a.progress / a.goal));
    const games = A.mastery ? A.mastery().slice(0, 5) : [];
    const arc = games.length && S.achAll ? await import('../arcade/index.js').catch(() => null) : null;
    const titleOf = id => (arc && arc.arcadeById && arc.arcadeById(id)?.title) || id;
    if (S.drawer !== d || my !== S.achSeq) return;
    const pct = sum.total ? Math.round((sum.unlocked / sum.total) * 100) : 0;
    const lib = getApp('aether-library');
    d.ach.append(...[
      h('div.ach-sum',
        h('div.ach-ring', { style: { '--p': String(pct) }, role: 'img', 'aria-label': tr('{unlocked} of {total} unlocked', { unlocked: sum.unlocked, total: sum.total }) },
          h('b', { text: `${pct}%` })),
        h('div.ach-sum__b',
          h('b', { text: tr('{unlocked} of {total} unlocked', { unlocked: sum.unlocked, total: sum.total }) }),
          h('small', { text: tr('Earned only from what you really did on this device.') }))),
      sum.seasonal ? h('div.ach-season', icon('pumpkin'), h('span', { text: tr('Halloween badges are here until 1 November.') })) : null,
      sum.recent.length
        ? h('div.noti__g', h('div.noti__ghead', h('span.grow', { text: tr('Recently earned') })), sum.recent.map(a => achRow(a)))
        : h('div.noti__empty', { text: tr('Nothing earned yet — play a game, open a few apps or save a file.') }),
      sum.next.length ? h('div.noti__g', h('div.noti__ghead', h('span.grow', { text: tr('Up next') })), sum.next.map(a => achRow(a))) : null,
      /* every badge that has a goal, with how far along it is */
      counted.length ? h('div.noti__g.ach-progress',
        h('div.noti__ghead', h('span.grow', { text: tr('Progress') }),
          h('button.btn.btn--sm.ach-progress__t', { type: 'button', 'aria-expanded': String(S.achAll), onclick: () => { S.achAll = !S.achAll; paintAch(); } }, S.achAll ? tr('Hide') : tr('Show all'))),
        S.achAll ? [
          ...counted.map(a => achRow(a, { all: true })),
          games.length ? h('div.ach-games', { 'aria-label': tr('Rounds finished per Arcade game') },
            h('small', { text: tr('Arcade rounds by game') }),
            games.map(g => h('div.ach-games__r', h('span', { text: titleOf(g.game) }), h('b', { text: String(g.rounds) })))) : null,
        ] : null) : null,
      h('label.ach-share', h('input', { type: 'checkbox', checked: shareOn(), onchange: e => { store.set('prefs.shareBadges', e.target.checked); paintAch(); } }),
        h('span', { text: tr('Let me share a badge with friends (off unless you switch it on)') })),
      lib ? h('button.btn.btn--sm.ach-all', {
        onclick: () => { closeDrawer(); api.openApp('aether-library', { url: 'static://library/achievements' }); },
      }, icon('star'), h('span', { text: tr('All achievements') })) : null,
    ].filter(Boolean));
  }

  /* ---------------- drawer --------------- */
  function openDrawer(tab = 'noti') {
    const list = h('div.noti__list#noti-panel-noti', { role: 'tabpanel', 'aria-labelledby': 'noti-tab-noti', tabindex: '0' });
    const ach = h('div.noti__list.noti__ach#noti-panel-ach', { role: 'tabpanel', 'aria-labelledby': 'noti-tab-ach', tabindex: '0' });
    const count = h('span.noti__new');

    const dndBtn = h('button.ibtn.tip', { 'aria-label': tr('Do Not Disturb'), 'aria-pressed': 'false' });
    /* ▾ beside it: Do Not Disturb for a while, or let some apps and friends through */
    const dndMore = h('button.ibtn.tip.noti__dndmore', {
      type: 'button', 'data-tip': tr('Do Not Disturb options'), 'aria-label': tr('Do Not Disturb options'),
      'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: () => toggleDndMenu(),
    }, icon('chevron-down'));
    let dndMenu = null;
    const closeDndMenu = () => { dndMenu?.remove(); dndMenu = null; dndMore.setAttribute('aria-expanded', 'false'); };
    function toggleDndMenu() {
      if (dndMenu) { closeDndMenu(); return; }
      const h24 = !!store.get('prefs.h24');
      const until = DNDS.quickUntil();
      const item = (label, sub, run) => h('button.noti__mi', { type: 'button', role: 'menuitem', onclick: () => { closeDndMenu(); run(); paintDnd(); paintList(); } },
        h('span', { text: label }), sub ? h('small.dim', { text: sub }) : null);
      dndMenu = h('div.noti__dndmenu', { role: 'menu', 'aria-label': tr('Do Not Disturb') },
        store.get('prefs.dnd') ? item(tr('Turn off'), until ? DNDR.leftLabel(until) : null, () => store.set('prefs.dnd', false)) : null,
        item(tr('For 1 hour'), null, () => DNDS.quickFor(HOUR)),
        item(tr('Until tomorrow'), DNDR.untilLabel(DNDR.tomorrowMorning(), h24), () => DNDS.quickTomorrow()),
        item(tr('Exceptions…'), tr('Apps and friends that get through'), () => { closeDrawer(); api.openApp('settings', { section: 'notifications' }); }));
      d0.el.appendChild(dndMenu);
      dndMore.setAttribute('aria-expanded', 'true');
      dndMenu.querySelector('button')?.focus({ preventScroll: true });
    }
    const paintDnd = () => {
      const on = !!store.get('prefs.dnd');
      clear(dndBtn);
      dndBtn.appendChild(icon(on ? 'bell-off' : 'bell'));
      dndBtn.classList.toggle('is-on', on);
      const until = DNDS.quickUntil();
      dndBtn.dataset.tip = on ? (until ? `Do Not Disturb is on · ${DNDR.leftLabel(until)}` : 'Do Not Disturb is on') : 'Do Not Disturb';
      dndBtn.setAttribute('aria-pressed', String(on));
    };
    dndBtn.addEventListener('click', () => { store.set('prefs.dnd', !store.get('prefs.dnd')); paintDnd(); paintList(); });
    paintDnd();

    const tabBtn = (id, label) => h('button', {
      type: 'button', role: 'tab', id: `noti-tab-${id}`, 'aria-controls': `noti-panel-${id}`,
      dataset: { v: id }, onclick: () => setTab(id),
      /* ←/→ between the two tabs (WAI-ARIA tabs) */
      onkeydown: e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = id === 'noti' ? 'ach' : 'noti';
        setTab(next);
        tabs.querySelector(`[data-v="${next}"]`)?.focus();
      },
    }, h('span', { text: label }));
    const tabs = h('div.tabs.noti__tabs', { role: 'tablist', 'aria-label': tr('Notification Centre') },
      tabBtn('noti', tr('Notifications')), tabBtn('ach', tr('Achievements')));

    const clearBtn = h('button.btn.btn--ghost.btn--sm', {
      text: tr('Clear all'),
      onclick: () => { S.archive = []; changed(); },
    });
    const snz = h('small.dim.noti__snzn', { title: tr('Snoozed notifications come back at their time') });
    const bar = h('div.noti__bar', count, snz, h('div.grow'), clearBtn);

    /* search the archive by words, and by app */
    const f = { q: '', app: '', held: false };
    const search = h('input.input.noti__q', {
      type: 'search', placeholder: tr('Search notifications'), 'aria-label': tr('Search notifications by app or words'),
      oninput: e => { f.q = e.target.value; paintList(); },
    });
    const appSel = h('select.input.noti__app', { 'aria-label': tr('Show one app'), onchange: e => { f.app = e.target.value; paintList(); } });
    const heldRow = h('div.noti__held', { hidden: true });
    const fbar = h('div.noti__filters', h('div.row', search, appSel), heldRow);

    const el = h('div.noti', { role: 'dialog', 'aria-label': tr('Notification Centre') },
      h('div.noti__head',
        tabs,
        h('div.grow'),
        dndBtn, dndMore,
        h('button.ibtn.tip', {
          'data-tip': tr('Notification settings'), 'aria-label': tr('Notification settings'),
          onclick: () => { closeDrawer(); api.openApp('settings', { section: 'notifications' }); },
        }, icon('sliders'))),
      bar, fbar, list, ach);

    host.appendChild(el);
    const d0 = S.drawer = { el, list, ach, bar, fbar, count, snz, appSel, heldRow, f, wasNew: unread(), seen: false, tab: null };
    /* Escape closes it and focus goes back to the bell (core/layers.js) */
    S.drawer.release = L.push({ name: 'notifications', el, close: () => closeDrawer() });

    function setTab(id) {
      const d = S.drawer;
      if (!d) return;
      d.tab = id === 'ach' ? 'ach' : 'noti';
      for (const b of tabs.children) {
        const on = b.dataset.v === d.tab;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      list.hidden = bar.hidden = fbar.hidden = d.tab !== 'noti';
      ach.hidden = d.tab !== 'ach';
      if (d.tab === 'ach') { paintAch(); return; }
      /* seeing them is reading them — so only once the list is actually shown */
      if (!d.seen) {
        d.seen = true;
        S.archive.forEach(n => { n.wasUnread = !n.read; n.read = true; });
      }
      paintList();
      changed();
    }
    S.drawer.setTab = setTab;
    setTab(tab);
    tabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });

    /* the topbar folds its popovers away; the phone shell turns the centre
       into its pull-down shade (js/shell/mobile.js) */
    bus.emit('noti:open', { el });
    S.offs.push(
      on(document, 'pointerdown', e => { if (!el.contains(e.target)) closeDrawer(true); else if (dndMenu && !dndMenu.contains(e.target) && !dndMore.contains(e.target)) closeDndMenu(); }, true),
      on(el, 'keydown', e => { if (e.key === 'Escape' && dndMenu) { e.stopPropagation(); closeDndMenu(); dndMore.focus(); } }, true),
      store.sub('prefs.dnd', () => { if (S.drawer) paintDnd(); }),
      store.sub('prefs.dndUntil', () => { if (S.drawer) paintDnd(); }),
      store.sub('prefs.notiApps', () => { if (S.drawer) paintList(); }),
      bus.on('achievement:unlock', () => { if (S.drawer?.tab === 'ach') paintAch(); }),
    );
  }

  function closeDrawer(byOutsidePointer) {
    if (!S.drawer) return;
    S.offs.splice(0).forEach(off => off());
    const d = S.drawer;
    d.el.remove();
    S.drawer = null;
    d.release?.();
    bus.emit('noti:closed');
    S.archive.forEach(n => { n.wasUnread = false; });
    /* only the outside-pointerdown path needs the re-open guard below;
       an Escape must not lock the bell out for a quarter of a second */
    S.closedAt = byOutsidePointer ? Date.now() : 0;
  }

  function toggleDrawer(tab) {
    if (S.drawer) closeDrawer();
    else if (Date.now() - S.closedAt > 260) openDrawer(tab);
  }

  /** Open on a tab — or switch to it when the centre is already open. */
  function showTab(tab) {
    if (S.drawer) S.drawer.setTab(tab);
    else openDrawer(tab);
  }

  /* ---------------- wiring --------------- */
  function push(raw) {
    const req = raw || {};
    if (req.key) {
      const prev = S.archive.find(n => n.key === req.key);
      if (prev) return update({ ...req });
    }
    const n = record(req);
    n.throughDnd = n.throughDnd || letThrough(n);
    /* quiet by choice: to the centre now, to the summary card later */
    n.held = !store.get('prefs.dnd') && !muted(n) && SUM.holds(n, appId(n));
    /* Do Not Disturb kept the pop-up off the screen (a muted app is its own switch) */
    n.dndHeld = !!store.get('prefs.dnd') && !n.throughDnd && !muted(n);
    changed();
    if (n.held) return n;
    if ((!store.get('prefs.dnd') || n.throughDnd) && !muted(n)) toast(n);
    return n;
  }

  /** Update a notification already on screen or in the archive, by key. */
  function update(patch) {
    if (!patch || !patch.key) return null;
    const n = S.archive.find(x => x.key === patch.key);
    if (!n) return push(patch);
    for (const k of ['title', 'message', 'icon', 'progress', 'actions', 'onClick', 'timeout']) {
      if (patch[k] !== undefined) n[k] = patch[k];
    }
    n.at = new Date().toISOString();
    n.read = false;
    const t = liveFor(n);
    if (t) {
      t.paint();
      /* a progress notification that has finished goes back to behaving
         like any other: it expires on its own */
      clearTimeout(t.timer);
      if (n.timeout > 0 && n.progress === null) t.timer = setTimeout(() => dismiss(t), n.timeout);
    } else if (!store.get('prefs.dnd') && !muted(n) && !n.held) {
      toast(n);
    } else if (store.get('prefs.dnd') && !n.throughDnd && !muted(n)) {
      n.dndHeld = true;
    }
    changed();
    return n;
  }

  /* ---------------- snooze ----------------
     A note snoozed from the centre leaves it and comes back as a fresh
     notification at the time. Only what can be rebuilt is kept (app,
     title, message, icon); its buttons do not survive, as after a reload. */
  const snoozed = () => { const v = store.get(SNOOZE_KEY); return Array.isArray(v) ? v.filter(x => x && x.title && Number(x.due)) : []; };
  function snoozeNoti(n, due) {
    store.set(SNOOZE_KEY, [...snoozed(), { app: n.app, title: n.title, message: n.message, icon: n.icon, due }].slice(-MAX_SNOOZED));
    drop(n);
    if (S.drawer) paintList();
  }
  function checkSnoozed() {
    const list = snoozed();
    if (!list.length) return;
    const now = Date.now();
    const due = list.filter(x => x.due <= now);
    if (!due.length) return;
    store.set(SNOOZE_KEY, list.filter(x => x.due > now));
    for (const x of due) push({ app: x.app, title: x.title, message: x.message, icon: x.icon, urgent: true, timeout: 8000 });
  }

  /* ---------------- summary card ---------- */
  function dismissCard() {
    const c = S.card;
    if (!c) return;
    S.card = null;
    c.el.classList.add('is-out');
    setTimeout(() => c.el.remove(), OUT_MS);
  }

  /** Release every held note as one card, grouped by app. Returns the number delivered. */
  function deliverSummary() {
    const items = S.archive.filter(n => n.held);
    items.forEach(n => { n.held = false; });
    changed();
    if (!items.length) return 0;
    dismissCard();
    const byApp = new Map();
    for (const n of items.slice().reverse()) {          /* oldest first inside a group */
      if (!byApp.has(n.app)) byApp.set(n.app, []);
      byApp.get(n.app).push(n);
    }
    const head = h('div.toast__t', { text: '' });
    const list = h('div.sum__list');
    const recount = () => {
      const rows = list.querySelectorAll('.sum__i').length;
      const apps = list.querySelectorAll('.sum__g').length;
      head.textContent = `${rows} notification${rows === 1 ? '' : 's'} from ${apps} app${apps === 1 ? '' : 's'}`;
      if (!rows) dismissCard();
    };
    for (const [app, ns] of byApp) {
      const g = h('div.sum__g', h('div.sum__gh', { text: app }));
      for (const n of ns) {
        const row = h('div.sum__i', { dataset: { title: n.title } },
          h('div.toast__t', { text: n.title }), message(n),
          n.actions?.length || n.onClick ? h('div.toast__acts', [
            n.onClick ? h('button.btn.btn--sm', { text: tr('Open'), onclick: () => { n.onClick(); drop(n); row.remove(); if (!g.querySelector('.sum__i')) g.remove(); recount(); } }) : null,
            ...(n.actions || []).map(a => h('button.btn.btn--sm', { text: a.label || 'OK', onclick: () => { a.onClick?.(); drop(n); row.remove(); if (!g.querySelector('.sum__i')) g.remove(); recount(); } })),
          ].filter(Boolean)) : null);
        g.appendChild(row);
      }
      list.appendChild(g);
    }
    const el = h('div.toast.toast--summary', { role: 'group', 'aria-label': tr('Notification summary') },
      h('div.glyph', { style: { '--g1': 'var(--accent-soft)', '--g2': 'var(--accent)' } }, icon('bell')),
      h('div.toast__b', h('div.toast__app', { text: tr('Summary') }), head, list,
        h('div.toast__acts', h('button.btn.btn--sm', { text: tr('Open Notification Centre'), onclick: () => { dismissCard(); bus.emit('noti:toggle'); } }))),
      h('button.ibtn.toast__x.tip', { 'data-tip': tr('Dismiss'), 'aria-label': tr('Dismiss summary'), onclick: dismissCard }, icon('x')));
    S.card = { el };
    stack.appendChild(el);
    recount();
    sfx.play('notify');
    return items.length;
  }

  /** Is a delivery time due? Held notes wait out Do Not Disturb. Runs every second and at start-up. */
  function checkSummary() {
    const c = SUM.config();
    if (!c.on) {                         /* switched off: nothing is left waiting for a card that will not come */
      if (S.archive.some(n => n.held)) { S.archive.forEach(n => { n.held = false; }); changed(); }
      return;
    }
    const due = SUM.lastSlot();
    if (!due || due <= c.at) return;
    if (store.get('prefs.dnd')) return;
    deliverSummary();
    SUM.markDelivered(Date.now());
  }

  restore();

  const unbind = [
    bus.on('tick:1s', checkSummary),
    bus.on('tick:1s', checkSnoozed),
    bus.on('noti:push', push),
    bus.on('noti:update', update),
    bus.on('noti:toggle', tab => toggleDrawer(tab === 'ach' ? 'ach' : 'noti')),
    bus.on('achievements:open', () => showTab('ach')),
    bus.on('noti:clear', () => { S.archive = []; changed(); }),
  ];

  bus.emit('noti:count', unread());
  checkSummary();
  checkSnoozed();

  return () => {
    unbind.forEach(off => off());
    closeDrawer();
    S.live.slice().forEach(dismiss);
    S.card?.el.remove();
    stack.remove();
  };
}

export default mountNotifications;
