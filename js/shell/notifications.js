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

   The centre has a second tab, Achievements (js/core/achievements.js):
   what you have earned on this device, and what is closest. A push
   with kind: 'achievement' gets the achievement look as a toast.
   bus 'achievements:open' opens the centre on that tab.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as L from '../core/layers.js';
import * as SUM from '../core/notisummary.js';
import * as sfx from '../core/sfx.js';

const MAX_LIVE = 4;
const MAX_ARCHIVE = 40;
const OUT_MS = 220;
const LOG_KEY = 'prefs.notiLog';

export function mountNotifications(host) {
  const { h, icon, clear, on, fmt, store, bus, getApp } = api;

  const S = { archive: [], live: [], drawer: null, offs: [], seq: 0, closedAt: 0, achSeq: 0, card: null };

  /* One persistent live region: screen readers announce what is added to
     it. (Each toast used to be its own role=status as well, which is not
     reliably read when it is inserted, and double-read when it is.) */
  const stack = h('div.toasts', { role: 'region', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Notifications' });
  host.appendChild(stack);

  /* ---------------- pieces --------------- */
  const appOf = n => getApp(String(n.app || '').toLowerCase());
  const appId = n => appOf(n)?.id || String(n.app || 'staticos').toLowerCase();
  const muted = n => store.get('prefs.notiApps', {})?.[appId(n)] === false;

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
        'aria-label': `${n.title} progress` },
        h('i', { style: { width: `${fmt.clamp(n.progress, 0, 100)}%` } }))
    : null);

  const actionRow = (n, after) => (n.actions?.length
    ? h('div.toast__acts', n.actions.map(a => h('button.btn.btn--sm', {
        text: a.label || 'OK',
        onclick: e => { e.stopPropagation(); after?.(); a.onClick?.(); },
      })))
    : null);

  /* ---------------- archive -------------- */
  const persist = () => store.set(LOG_KEY, S.archive.slice(0, MAX_ARCHIVE).map(n => ({
    app: n.app, title: n.title, message: n.message, icon: n.icon,
    at: n.at, progress: typeof n.progress === 'number' ? n.progress : null, read: !!n.read, held: !!n.held,
  })));

  function restore() {
    const rows = store.get(LOG_KEY);
    if (!Array.isArray(rows)) return;
    S.archive = rows.filter(r => r && r.title).slice(0, MAX_ARCHIVE).map(r => ({
      id: ++S.seq,
      app: r.app || 'StaticOS', title: r.title, message: r.message || '',
      icon: r.icon || 'bell', actions: [], onClick: null,
      progress: typeof r.progress === 'number' ? r.progress : null,
      at: r.at || new Date().toISOString(), read: true, stale: true, held: r.held === true,
    }));
  }

  function record(raw) {
    const n = {
      id: ++S.seq,
      key: raw.key || null,
      app: raw.app || 'StaticOS',
      title: raw.title || 'Notification',
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
      urgent: raw.urgent === true,
      held: false,
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
    if (S.drawer) paintList();
    bus.emit('noti:count', unread());
  }

  /* ---------------- toasts --------------- */
  function toast(n) {
    while (S.live.length >= MAX_LIVE) dismiss(S.live[0]);

    const t = { n, el: null, timer: 0, out: false, body: null };

    const open = h('button.toast__open', {
      onclick: () => { dismiss(t); if (n.onClick) { n.read = true; n.onClick(); changed(); } },
      'aria-label': n.onClick ? `${n.title} — open` : n.title,
    });

    t.body = h('div.toast__b', open);
    t.el = h('div.toast', { class: n.kind === 'achievement' ? 'toast--ach' : null },
      glyph(n),
      t.body,
      h('button.ibtn.toast__x.tip', {
        'data-tip': 'Dismiss', 'aria-label': 'Dismiss notification',
        onclick: () => dismiss(t),
      }, icon('x')));

    t.paint = () => {
      clear(open);
      open.append(...[h('div.toast__app', { text: String(n.app).toUpperCase() }), title(n), message(n)].filter(Boolean));
      clear(t.body);
      t.body.append(...[open, progressBar(n), actionRow(n, () => dismiss(t))].filter(Boolean));
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
  function groups() {
    const out = [];
    const byName = new Map();
    for (const n of S.archive) {
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
          n.held ? h('span.chip', { text: 'For summary' }) : null,
          h('small.dim.noti__at', { text: fmt.fmtAgo(n.at) })),
        message(n),
        progressBar(n),
        /* An archived notification keeps its actions: a toast nobody saw —
           Do Not Disturb, a muted app, or one pushed off the stack — must
           still be actionable here. Entries restored from the last session
           have none, by construction. */
        actionRow(n, () => drop(n))),
      h('button.ibtn.noti__x.tip', {
        'data-tip': 'Remove', 'aria-label': `Remove ${n.title}`,
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

  function paintList() {
    const list = S.drawer?.list;
    if (!list) return;
    clear(list);
    if (!S.archive.length) {
      list.appendChild(h('div.noti__empty', { text: 'No notifications' }));
      S.drawer.count.textContent = '';
      return;
    }
    /* the badge reports what was waiting when the centre was opened; the
       act of opening it is what marks them read */
    const n = S.drawer.wasNew;
    S.drawer.count.textContent = n ? `${n} new` : '';
    for (const g of groups()) {
      const off = store.get('prefs.notiApps', {})?.[appId(g.items[0])] === false;
      list.appendChild(h('div.noti__g',
        h('div.noti__ghead',
          h('span.grow.trunc', { text: g.app }),
          off ? h('span.chip', { text: 'Muted' }) : null,
          h('span.noti__gn', { text: String(g.items.length) }),
          h('button.ibtn.tip', {
            'data-tip': `Clear ${g.app}`, 'aria-label': `Clear all ${g.app} notifications`,
            onclick: () => clearApp(g.app),
          }, icon('x'))),
        g.items.map(item)));
    }
  }

  /* ---------------- achievements tab ------ */
  let achP = null;
  const achMod = () => (achP || (achP = import('../core/achievements.js').catch(() => null)));

  function achRow(a) {
    const pct = a.goal ? Math.round(((a.progress || 0) / a.goal) * 100) : 0;
    return h('div.ach-row', { class: a.unlocked ? 'is-on' : null },
      h('div.ach-row__ic', icon(a.icon || 'star')),
      h('div.toast__b',
        h('div.row',
          h('div.grow.trunc.toast__t', { text: a.name }),
          a.season ? h('span.ach-row__tag', { text: 'Halloween' }) : null,
          a.unlocked && a.at ? h('small.dim.noti__at', { text: fmt.fmtAgo(new Date(a.at).toISOString()) }) : null),
        h('div.toast__m', { text: a.desc }),
        !a.unlocked && a.goal
          ? h('div.ach-row__prog',
              h('div.noti__prog', {
                role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.goal),
                'aria-valuenow': String(a.progress || 0), 'aria-label': `${a.name} progress`,
              }, h('i', { style: { width: `${Math.max(pct, 3)}%` } })),
              h('small', { text: `${a.progress || 0} / ${a.goal}` }))
          : null));
  }

  async function paintAch() {
    const d = S.drawer;
    if (!d) return;
    const my = ++S.achSeq;
    const A = await achMod();
    if (S.drawer !== d || my !== S.achSeq) return;
    clear(d.ach);
    if (!A) { d.ach.appendChild(h('div.noti__empty', { text: 'Achievements did not load in this build.' })); return; }
    const sum = A.summary(null, 3);
    const pct = sum.total ? Math.round((sum.unlocked / sum.total) * 100) : 0;
    const lib = getApp('aether-library');
    d.ach.append(...[
      h('div.ach-sum',
        h('div.ach-ring', { style: { '--p': String(pct) }, role: 'img', 'aria-label': `${sum.unlocked} of ${sum.total} unlocked` },
          h('b', { text: `${pct}%` })),
        h('div.ach-sum__b',
          h('b', { text: `${sum.unlocked} of ${sum.total} unlocked` }),
          h('small', { text: 'Earned only from what you really did on this device.' }))),
      sum.seasonal ? h('div.ach-season', icon('pumpkin'), h('span', { text: 'Halloween badges are here until 1 November.' })) : null,
      sum.recent.length
        ? h('div.noti__g', h('div.noti__ghead', h('span.grow', { text: 'Recently earned' })), sum.recent.map(achRow))
        : h('div.noti__empty', { text: 'Nothing earned yet — play a game, open a few apps or save a file.' }),
      sum.next.length ? h('div.noti__g', h('div.noti__ghead', h('span.grow', { text: 'Up next' })), sum.next.map(achRow)) : null,
      lib ? h('button.btn.btn--sm.ach-all', {
        onclick: () => { closeDrawer(); api.openApp('aether-library', { url: 'static://library/achievements' }); },
      }, icon('star'), h('span', { text: 'All achievements' })) : null,
    ].filter(Boolean));
  }

  /* ---------------- drawer --------------- */
  function openDrawer(tab = 'noti') {
    const list = h('div.noti__list#noti-panel-noti', { role: 'tabpanel', 'aria-labelledby': 'noti-tab-noti', tabindex: '0' });
    const ach = h('div.noti__list.noti__ach#noti-panel-ach', { role: 'tabpanel', 'aria-labelledby': 'noti-tab-ach', tabindex: '0' });
    const count = h('span.noti__new');

    const dndBtn = h('button.ibtn.tip', { 'aria-label': 'Do Not Disturb', 'aria-pressed': 'false' });
    const paintDnd = () => {
      const on = !!store.get('prefs.dnd');
      clear(dndBtn);
      dndBtn.appendChild(icon(on ? 'bell-off' : 'bell'));
      dndBtn.classList.toggle('is-on', on);
      dndBtn.dataset.tip = on ? 'Do Not Disturb is on' : 'Do Not Disturb';
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
    const tabs = h('div.tabs.noti__tabs', { role: 'tablist', 'aria-label': 'Notification Centre' },
      tabBtn('noti', 'Notifications'), tabBtn('ach', 'Achievements'));

    const clearBtn = h('button.btn.btn--ghost.btn--sm', {
      text: 'Clear all',
      onclick: () => { S.archive = []; changed(); },
    });
    const bar = h('div.noti__bar', count, h('div.grow'), clearBtn);

    const el = h('div.noti', { role: 'dialog', 'aria-label': 'Notification Centre' },
      h('div.noti__head',
        tabs,
        h('div.grow'),
        dndBtn,
        h('button.ibtn.tip', {
          'data-tip': 'Notification settings', 'aria-label': 'Notification settings',
          onclick: () => { closeDrawer(); api.openApp('settings', { section: 'notifications' }); },
        }, icon('sliders'))),
      bar, list, ach);

    host.appendChild(el);
    S.drawer = { el, list, ach, bar, count, wasNew: unread(), seen: false, tab: null };
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
      list.hidden = bar.hidden = d.tab !== 'noti';
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
      on(document, 'pointerdown', e => { if (!el.contains(e.target)) closeDrawer(true); }, true),
      store.sub('prefs.dnd', () => { if (S.drawer) paintDnd(); }),
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
    /* quiet by choice: to the centre now, to the summary card later */
    n.held = !store.get('prefs.dnd') && !muted(n) && SUM.holds(n, appId(n));
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
    }
    changed();
    return n;
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
            n.onClick ? h('button.btn.btn--sm', { text: 'Open', onclick: () => { n.onClick(); drop(n); row.remove(); if (!g.querySelector('.sum__i')) g.remove(); recount(); } }) : null,
            ...(n.actions || []).map(a => h('button.btn.btn--sm', { text: a.label || 'OK', onclick: () => { a.onClick?.(); drop(n); row.remove(); if (!g.querySelector('.sum__i')) g.remove(); recount(); } })),
          ].filter(Boolean)) : null);
        g.appendChild(row);
      }
      list.appendChild(g);
    }
    const el = h('div.toast.toast--summary', { role: 'group', 'aria-label': 'Notification summary' },
      h('div.glyph', { style: { '--g1': 'var(--accent-soft)', '--g2': 'var(--accent)' } }, icon('bell')),
      h('div.toast__b', h('div.toast__app', { text: 'Summary' }), head, list,
        h('div.toast__acts', h('button.btn.btn--sm', { text: 'Open Notification Centre', onclick: () => { dismissCard(); bus.emit('noti:toggle'); } }))),
      h('button.ibtn.toast__x.tip', { 'data-tip': 'Dismiss', 'aria-label': 'Dismiss summary', onclick: dismissCard }, icon('x')));
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
    bus.on('noti:push', push),
    bus.on('noti:update', update),
    bus.on('noti:toggle', tab => toggleDrawer(tab === 'ach' ? 'ach' : 'noti')),
    bus.on('achievements:open', () => showTab('ach')),
    bus.on('noti:clear', () => { S.archive = []; changed(); }),
  ];

  bus.emit('noti:count', unread());
  checkSummary();

  return () => {
    unbind.forEach(off => off());
    closeDrawer();
    S.live.slice().forEach(dismiss);
    S.card?.el.remove();
    stack.remove();
  };
}

export default mountNotifications;
