/* ============================================================
   automations.js — Static Automations: "When this happens, do
   that", for StaticOS itself.

   The rules engine is js/core/automations.js; this window is
   how you see and shape what it does. Three places, from the
   sidebar (a tab strip when the window is narrow):

   · Rules — every rule as its sentence, with an on/off switch,
     Run now, and what it did last in this session.
   · Run log — each run, newest first: when, why it ran (or why
     it was held back or skipped), and what every action really
     did. It lives in memory and says so; a reload clears it.
   · Examples — the four starter rules from the brief, one click
     each, marked Added once you have them.

   The editor builds a rule as a sentence out of dropdowns —
   "When [I open] [Static Games], [open] [Music]" — never code.
   Every dropdown lists only what this computer actually has:
   registered apps, the unlocked wallpapers, the real accent
   themes. Up to ten actions, reorderable, each checked as you
   go, and Run now tries the draft without saving it.

   Honesty: rules only run while StaticOS is open in this
   browser — the sidebar says so, and says whether the engine is
   running at all. Nothing on screen is invented: the "last ran"
   lines and the log come from real runs in this session, or are
   not shown.

   Design notes:
   · store.set() ignores the same reference, so every write goes
     through the engine's save(), which builds a fresh array.
   · A full render rebuilds the view; focus is restored by a
     stable data-fk key and the scroll position is kept, so the
     keyboard never loses its place. Typing in a text field only
     repaints the sentence preview, never the field itself.
   · The log can change while you edit; the editor only repaints
     its own "just ran" panel for that, never the draft.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as AM from '../core/automations.js';
import { appTile } from '../core/appart.js';

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-automations-css')) {
  const link = document.createElement('link');
  link.id = 'feat-automations-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-automations.css';
  document.head.appendChild(link);
}

const NARROW = 600;              /* below this painted width: tabs instead of the sidebar */
const VIEWS = [
  { id: 'rules', label: 'Rules', icon: 'zap' },
  { id: 'reminders', label: 'Reminders', icon: 'bell' },
  { id: 'startup', label: 'Startup apps', icon: 'power' },
  { id: 'log', label: 'Run log', icon: 'list' },
  { id: 'examples', label: 'Examples', icon: 'sparkles' },
];

/* the sentence builder's words */
const TRIGGER_OPTS = [
  { value: 'app-open', label: 'I open' },
  { value: 'game-launch', label: 'I launch a game' },
  { value: 'startup', label: 'StaticOS starts' },
  { value: 'gamemode-on', label: 'Game Mode turns on' },
];
const ACTION_OPTS = [
  { value: 'open-app', label: 'open' },
  { value: 'gamemode', label: 'turn Game Mode' },
  { value: 'widgets', label: 'set the widgets to' },
  { value: 'wallpaper', label: 'use the wallpaper' },
  { value: 'accent', label: 'switch the accent to' },
  { value: 'music', label: 'tell Music to' },
  { value: 'notify', label: 'show a notification' },
];
const ACTION_DEFAULT = {
  'open-app': () => ({ type: 'open-app', app: '' }),
  gamemode: () => ({ type: 'gamemode', on: true }),
  widgets: () => ({ type: 'widgets', visible: false }),
  wallpaper: () => ({ type: 'wallpaper', id: '' }),
  accent: () => ({ type: 'accent', id: '' }),
  music: () => ({ type: 'music', action: 'play' }),
  notify: () => ({ type: 'notify', text: '' }),
};
const ICON = {
  'app-open': 'grid-9', 'game-launch': 'gamepad', 'gamemode-on': 'gauge',
  'open-app': 'grid-9', gamemode: 'gauge', widgets: 'sidebar', wallpaper: 'image',
  accent: 'palette', music: 'music', notify: 'bell',
};
const STARTUP_ICON = { always: 'power', night: 'moon', day: 'sun', morning: 'sun' };
/* how the repeat reads inside "Remind me to … at 9:00 AM [once, on] [date]" */
const REPEAT_WORDS = { once: 'once, on', daily: 'every day', weekdays: 'on weekdays (Mon–Fri)', weekly: 'every week, from' };

const ENTRY = {
  running: { icon: 'clock', label: 'Running' },
  ok: { icon: 'check-circle', label: 'Done' },
  warn: { icon: 'alert', label: 'Done, with a problem' },
  failed: { icon: 'x-circle', label: 'Failed' },
  held: { icon: 'shield', label: 'Held back' },
  skipped: { icon: 'clock', label: 'Skipped' },
};
const STEP = {
  wait: { icon: null, label: 'Waiting' },
  ok: { icon: 'check', label: 'Done' },
  same: { icon: 'check', label: 'No change needed' },
  warn: { icon: 'alert', label: 'Problem' },
  fail: { icon: 'x', label: 'Failed' },
};

const clone = v => JSON.parse(JSON.stringify(v));
const sameShape = (a, b) => JSON.stringify({ w: a.when, t: a.then }) === JSON.stringify({ w: b.when, t: b.then });

defineApp({
  id: 'automations',
  name: 'Static Automations',
  icon: 'zap',
  g1: '#8e76b4', g2: '#1b0d37',
  category: 'System',
  keywords: ['automation', 'automations', 'automate', 'rules', 'rule', 'shortcuts', 'triggers', 'when', 'routine',
    'routines', 'workflow', 'macro', 'if this then that', 'ifttt', 'startup', 'game mode', 'wallpaper'],
  desc: 'When something happens on StaticOS, do something: simple rules you set up',
  singleton: true,
  win: { w: 880, h: 620, minW: 400, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, confirm, menu } = api;

    const S = {
      view: 'rules',
      draft: null,          /* the rule being edited (a private copy) */
      orig: '',             /* the draft as it was opened, for the unsaved-changes check */
      isNew: false,
      tried: false,         /* a save was attempted: show what's missing */
      testId: null,         /* log entry of the editor's last Run now */
      highlight: null,      /* rule id to flash once in the list */
      flash: null,          /* { text, log? } shown in the bar for a few seconds */
      narrow: false,
      asking: false,        /* a confirm sheet is up */
      dead: false,
      /* Reminders: the form's draft survives every repaint; `editing` is the id being changed */
      rem: { draft: AM.blankReminder(), editing: null, tried: false },
      startupPick: '',      /* the app chosen in "Add" on Startup apps, until it's added */
    };
    let rafId = 0;
    let remTick = 0;
    let flashTimer = 0;
    let liveTimer = 0;

    /* ---------------- data helpers ---------------- */
    const rules = () => AM.rules();
    const apps = () => api.listApps().slice().sort((a, b) => a.name.localeCompare(b.name));
    const appOf = id => (id ? api.getApp(id) : null);
    /** Every registered app — plus the rule's own pick if it has since gone away, said plainly. */
    function appOptions(current) {
      const list = apps().map(x => ({ value: x.id, label: x.name }));
      if (current && !list.some(o => o.value === current)) list.unshift({ value: current, label: `${AM.appName(current) || current} (not available)` });
      return list;
    }
    /** The most telling log entry for a rule: its last real run, else its last hold/skip. */
    const lastEntry = (id, entries = AM.log()) => {
      const mine = entries.filter(e => e.ruleId === id);
      return mine.find(e => e.status !== 'held' && e.status !== 'skipped') || mine[0] || null;
    };
    const dirty = () => !!S.draft && JSON.stringify(S.draft) !== S.orig;
    const presetRule = p => AM.normRule({ id: AM.newId(), name: '', enabled: true, when: clone(p.when), then: clone(p.then) });

    /* ---------------- pieces ---------------- */
    /** The sentence, with the chosen words set apart. */
    const sentenceNodes = rule => AM.sentence(rule).map(([t, em]) => (em ? h('span.am-em', { text: t }) : t));

    /** A small tile: the real app's own glyph for apps, a system tile otherwise. */
    function tile(kind, obj, size = 28) {
      const o = obj || {};
      const app = (kind === 'app-open' || kind === 'open-app') ? appOf(o.app)
        : kind === 'music' ? appOf('music') : null;
      if (app) {
        return appTile(app, { sel: 'span.glyph.am-tile', gs: `${size}px`, attrs: { 'aria-hidden': 'true' }, icon: kind === 'music' ? 'music' : app.icon });
      }
      const ic = kind === 'startup' ? (STARTUP_ICON[o.when] || 'power') : (ICON[kind] || 'zap');
      return h('span.am-tile.am-tile--sys', { 'aria-hidden': 'true', style: { '--gs': `${size}px` } }, icon(ic));
    }
    function flow(rule, compact) {
      const acts = rule.then || [];
      return h('span.am-flow', { 'aria-hidden': 'true' },
        tile(rule.when.type, rule.when),
        compact ? null : [
          h('span.am-flow__arrow', icon('chevron-right')),
          acts.length
            ? h('span.am-flow__act', tile(acts[0].type, acts[0]),
              acts.length > 1 ? h('span.am-flow__more', { text: `+${acts.length - 1}` }) : null)
            : h('span.am-tile.am-tile--empty'),
        ]);
    }

    function ibtn(ic, label, onclick, extra = {}) {
      return h('button.ibtn', { type: 'button', 'aria-label': label, title: label, onclick, ...extra }, icon(ic));
    }
    function sw(on, label, onclick, fk) {
      return h(`button.switch${on ? '.is-on' : ''}`, {
        type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label,
        onclick, dataset: fk ? { fk } : undefined,
      });
    }
    function select({ fk, label, value, options, placeholder, onchange }) {
      const el = h('select.select.am-pick', {
        'aria-label': label, dataset: { fk }, class: value ? null : 'is-empty',
        onchange: e => onchange(e.target.value),
      },
      placeholder ? h('option', { value: '', text: placeholder, disabled: true, selected: value ? null : true }) : null,
      options.map(o => h('option', { value: o.value, text: o.label, selected: o.value === value ? true : null })));
      if (value && [...el.options].some(o => o.value === value)) el.value = value;
      return el;
    }

    function announce(text) {
      clearTimeout(liveTimer);
      live.textContent = '';
      liveTimer = setTimeout(() => { if (!S.dead) live.textContent = text; }, 40);
    }
    function flash(text, opt = {}) {
      S.flash = { text, log: !!opt.log };
      announce(opt.say || text);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { S.flash = null; if (!S.dead) paintFlash(); }, 4500);
      paintFlash();
    }
    function paintFlash() {
      const slot = mainEl.querySelector('.am-flashslot');
      if (!slot) return;
      clear(slot);
      if (!S.flash) return;
      slot.append(h('span.am-flash', icon('check'), h('span', { text: S.flash.text }),
        S.flash.log && S.view !== 'log'
          ? h('button.am-link', { type: 'button', text: 'See log', dataset: { fk: 'flash-log' }, onclick: () => go('log') })
          : null));
    }

    /* ---------------- actions on rules ---------------- */
    function saveAll(list) { return AM.save(list); }

    function setEnabled(id, on) {
      const list = rules();
      const r = list.find(x => x.id === id);
      if (!r) return;
      saveAll(list.map(x => (x.id === id ? { ...x, enabled: on } : x)));
      announce(`${AM.label(r)} is ${on ? 'on' : 'off'}`);
      render();
    }
    function runNow(id) {
      const e = AM.runNow(id);
      if (!e) return;
      if (e.status === 'held') flash('Held back — see the log', { log: true, say: e.note || 'Held back' });
      else flash('Ran it — see what happened', { log: true, say: `Ran ${e.rule}` });
    }
    function duplicate(id) {
      const list = rules();
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return;
      if (list.length >= AM.MAX_RULES) { flash(`You can have up to ${AM.MAX_RULES} rules`); return; }
      const r = list[i];
      const base = r.name || AM.describe(r).replace(/\.$/, '');
      const name = `${base.length > 50 ? base.slice(0, 49) + '…' : base} (copy)`;
      const copy = { ...clone(r), id: AM.newId(), name, enabled: false };
      list.splice(i + 1, 0, copy);
      saveAll(list);
      S.highlight = copy.id;
      flash('Duplicated — the copy starts switched off');
      render();
    }
    async function deleteRule(id) {
      const r = rules().find(x => x.id === id);
      if (!r) return;
      S.asking = true;
      const ok = await confirm({ title: 'Delete this rule?', message: `“${AM.label(r)}” stops running and is removed from this browser. This can’t be undone.`, ok: 'Delete', danger: true });
      S.asking = false;
      if (!ok || S.dead) return;
      saveAll(rules().filter(x => x.id !== id));
      if (S.draft && S.draft.id === id) { S.draft = null; S.view = 'rules'; }
      flash('Rule deleted');
      render();
    }
    function addPreset(p) {
      const list = rules();
      if (list.length >= AM.MAX_RULES) { flash(`You can have up to ${AM.MAX_RULES} rules`); return; }
      const r = presetRule(p);
      saveAll([...list, r]);
      /* flash the new row only when it lands on screen now, not on some later visit */
      S.highlight = S.view === 'rules' ? r.id : null;
      flash('Added — it’s on', { say: `Added and switched on: ${AM.describe(r)}` });
      render();
    }

    /* ---------------- navigation ---------------- */
    async function leaveEditor() {
      if (S.view !== 'edit' || !dirty()) return true;
      S.asking = true;
      const ok = await confirm({ title: 'Discard your changes?', message: 'The changes to this rule haven’t been saved.', ok: 'Discard', danger: true });
      S.asking = false;
      return ok && !S.dead;
    }
    async function go(view) {
      if (S.view === view && view !== 'edit') { render(); return; }
      if (!(await leaveEditor())) return;
      S.draft = null;
      S.flash = null;        /* a bar message belongs to the view it was said in */
      S.view = VIEWS.some(v => v.id === view) ? view : 'rules';
      render();
      /* render() keeps focus on the sidebar item or tab that was pressed;
         a link inside the old view has nowhere to stay, so go to the title */
      if (!appEl.contains(document.activeElement)) focusMain();
    }
    function edit(id) {
      const r = rules().find(x => x.id === id);
      if (!r) return;
      openDraft(r, false);
    }
    function newRule() {
      if (rules().length >= AM.MAX_RULES) { flash(`You can have up to ${AM.MAX_RULES} rules`); return; }
      openDraft(AM.blankRule(), true);
    }
    function openDraft(rule, isNew) {
      S.draft = clone(rule);
      S.orig = JSON.stringify(S.draft);
      S.isNew = isNew;
      S.tried = false;
      S.testId = null;
      S.view = 'edit';
      render();
      requestAnimationFrame(() => { if (!S.dead) root.querySelector('[data-fk="when-type"]')?.focus({ preventScroll: true }); });
    }
    async function back() {
      if (!(await leaveEditor())) return;
      const id = S.draft && S.draft.id;
      S.draft = null;
      S.view = 'rules';
      render();
      requestAnimationFrame(() => {
        if (S.dead) return;
        (id && root.querySelector(`[data-fk="edit-${CSS.escape(id)}"]`))?.focus({ preventScroll: true });
      });
    }
    function focusMain() {
      requestAnimationFrame(() => { if (!S.dead) mainEl.querySelector('.app__title')?.focus({ preventScroll: true }); });
    }

    /* ---------------- editor ops ---------------- */
    function repaintEditor() { render(); }
    function setWhenType(type) {
      const d = S.draft;
      if (type === 'app-open') d.when = { type, app: d.when.type === 'app-open' ? d.when.app : '' };
      else if (type === 'startup') d.when = { type, when: d.when.type === 'startup' ? d.when.when : 'always' };
      else d.when = { type };
      repaintEditor();
    }
    function setActionType(i, type) {
      const d = S.draft;
      if (!ACTION_DEFAULT[type] || !d.then[i] || d.then[i].type === type) return;
      d.then[i] = ACTION_DEFAULT[type]();
      repaintEditor();
    }
    function addAction() {
      const d = S.draft;
      if (d.then.length >= AM.MAX_ACTIONS) return;
      d.then.push(ACTION_DEFAULT['open-app']());
      repaintEditor();
      const i = d.then.length - 1;
      requestAnimationFrame(() => { if (!S.dead) root.querySelector(`[data-fk="act-${i}-type"]`)?.focus({ preventScroll: false }); });
    }
    function moveAction(i, dir) {
      const d = S.draft;
      const j = i + dir;
      if (j < 0 || j >= d.then.length) return;
      [d.then[i], d.then[j]] = [d.then[j], d.then[i]];
      repaintEditor();
      announce(`Moved action ${i + 1} to position ${j + 1}`);
      const key = `act-${j}-${dir < 0 ? 'up' : 'down'}`;
      requestAnimationFrame(() => {
        if (S.dead) return;
        const el = root.querySelector(`[data-fk="${key}"]`);
        (el && !el.disabled ? el : root.querySelector(`[data-fk="act-${j}-type"]`))?.focus({ preventScroll: true });
      });
    }
    function removeAction(i) {
      const d = S.draft;
      d.then.splice(i, 1);
      repaintEditor();
      announce(`Removed action ${i + 1}`);
      requestAnimationFrame(() => {
        if (S.dead) return;
        const next = root.querySelector(`[data-fk="act-${Math.min(i, d.then.length - 1)}-type"]`) || root.querySelector('[data-fk="add-act"]');
        next?.focus({ preventScroll: true });
      });
    }
    function saveDraft() {
      const d = S.draft;
      if (!d) return;
      const errs = AM.issues(d).filter(x => x.level === 'error');
      if (errs.length) {
        S.tried = true;
        repaintEditor();
        announce(`Can’t save yet: ${errs.map(x => x.text).join(' ')}`);
        requestAnimationFrame(() => { if (!S.dead) root.querySelector('.am-err')?.closest('.am-line')?.querySelector('select,input,button')?.focus(); });
        return;
      }
      const list = rules();
      const clean = AM.normRule(d);
      const i = list.findIndex(x => x.id === clean.id);
      if (i < 0 && list.length >= AM.MAX_RULES) { flash(`You can have up to ${AM.MAX_RULES} rules`); return; }
      if (i >= 0) list[i] = clean; else list.push(clean);
      saveAll(list);
      S.highlight = clean.id;
      const wasNew = S.isNew;
      S.draft = null;
      S.view = 'rules';
      render();
      flash(wasNew ? (clean.enabled ? 'Rule added — it’s on' : 'Rule added (switched off)') : 'Saved');
      requestAnimationFrame(() => {
        if (!S.dead) root.querySelector(`[data-fk="edit-${CSS.escape(clean.id)}"]`)?.focus({ preventScroll: true });
      });
    }
    function testDraft() {
      const d = S.draft;
      if (!d) return;
      const errs = AM.issues(d).filter(x => x.level === 'error' && x.at !== 'when');
      if (!d.then.length || errs.length) {
        S.tried = true;
        repaintEditor();
        announce(d.then.length ? `Finish the actions first: ${errs.map(x => x.text).join(' ')}` : 'Add an action to try first.');
        return;
      }
      const e = AM.runNow({ ...clone(d), name: d.name || '' }, { test: true });
      if (!e) return;
      S.testId = e.id;
      paintTest();
      announce(e.status === 'held' ? (e.note || 'Held back') : 'Ran the actions — results below.');
    }

    /* ==================================================================== */
    /*  view                                                                */
    /* ==================================================================== */
    const sideEl = h('aside.app__side.am__side', { 'aria-label': 'Automations' });
    const mainEl = h('div.app__main.am__main');
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const appEl = h('div.app.am', sideEl, mainEl, live);
    root.appendChild(appEl);

    /* ---------- sidebar ---------- */
    function counts() {
      const list = rules();
      return { rules: list.length, on: list.filter(r => r.enabled).length, log: AM.log().length,
        reminders: AM.reminders().length, startup: AM.startupApps().apps.length };
    }
    function renderSide() {
      clear(sideEl);
      const c = counts();
      const nav = h('nav.side__group.am-side__nav', { 'aria-label': 'Sections' }, h('div.side__label', { text: 'Automations' }));
      for (const v of VIEWS) {
        const on = S.view === v.id || (v.id === 'rules' && S.view === 'edit');
        const n = v.id === 'rules' ? c.rules : v.id === 'log' ? c.log : v.id === 'reminders' ? c.reminders : v.id === 'startup' ? c.startup : 0;
        nav.append(h('button.side__item', {
          type: 'button', class: on ? 'is-on' : null, 'aria-current': on ? 'page' : null,
          dataset: { fk: `nav-${v.id}` }, onclick: () => go(v.id),
        }, icon(v.icon), h('span', { text: v.label }), n ? h('small', { text: String(n) }) : null));
      }
      sideEl.append(nav, statusBlock());
    }
    function statusBlock() {
      const st = AM.status();
      const block = h('div.am-side__foot');
      if (st.running) {
        block.append(h('div.side__meter.am-status',
          h('span.am-status__dot', { 'aria-hidden': 'true' }),
          h('div.am-status__t', h('b', { text: 'Running' }), h('small', { text: `Since ${AM.clock(st.since)}` }))));
      } else {
        block.append(h('div.side__meter.am-status.is-off',
          h('span.am-status__dot', { 'aria-hidden': 'true' }),
          h('div.am-status__t', h('b', { text: 'Not running' }), h('small', { text: 'Rules are saved, but nothing is listening.' }))),
          h('button.btn.btn--sm.am-start', { type: 'button', dataset: { fk: 'start' }, onclick: startEngine }, icon('play'), h('span', { text: 'Start now' })));
      }
      block.append(h('p.am-side__note', { text: 'Rules only run while StaticOS is open in this browser.' }));
      return block;
    }
    function startEngine() {
      /* StaticOS didn't just start, so startup rules are not checked */
      AM.init({ startup: false });
      announce('Automations are running.');
      render();
    }

    /* ---------- the bar ---------- */
    function tabs() {
      return h('div.tabs.am-tabs', { role: 'tablist', 'aria-label': 'Sections' },
        VIEWS.map(v => {
          const on = S.view === v.id;
          return h('button', {
            type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', class: on ? 'is-on' : null,
            dataset: { fk: `tab-${v.id}` }, onclick: () => go(v.id),
          }, h('span', { text: v.label }));
        }));
    }
    function bar(...kids) {
      return h('div.app__bar.am-bar', ...kids);
    }
    const title = text => h('h2.app__title.am-title', { text, tabindex: '-1' });
    /* the words are announced through the live region; the slot just shows them */
    const flashSlot = () => h('div.am-flashslot');

    /* ---------- Rules ---------- */
    function viewRules() {
      const list = rules();
      const on = list.filter(r => r.enabled).length;
      const full = list.length >= AM.MAX_RULES;
      mainEl.append(bar(
        S.narrow ? tabs() : title('Rules'),
        !S.narrow && list.length ? h('span.am-count', { text: `${list.length} rule${list.length === 1 ? '' : 's'} · ${on} on` }) : null,
        h('span.am-spacer'),
        flashSlot(),
        h('button.btn.btn--sm.btn--primary', {
          type: 'button', dataset: { fk: 'new' }, disabled: full ? true : null,
          title: full ? `You can have up to ${AM.MAX_RULES} rules` : null, onclick: newRule,
        }, icon('plus'), h('span', { text: 'New rule' }))));

      const content = h('div.app__content.am-scroll');
      if (!AM.status().running) {
        content.append(h('div.am-banner', { role: 'note' },
          icon('alert'),
          h('div.am-banner__t',
            h('b', { text: 'Automations aren’t running in this session' }),
            h('small', { text: 'Your rules are saved, but nothing is listening for them yet. Start the engine to have them run until StaticOS reloads.' })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'start-banner' }, onclick: startEngine }, h('span', { text: 'Start now' }))));
      }

      if (!list.length) {
        content.append(h('div.am-empty',
          h('div.empty.am-empty__head',
            icon('zap'),
            h('b', { text: 'No rules yet' }),
            h('small', { text: 'A rule does something for you when something happens — like opening Music whenever you open Static Games. Start from an example, or build your own.' }),
            h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'new-empty' }, onclick: newRule }, icon('plus'), h('span', { text: 'New rule' }))),
          h('div.label.am-cap', { text: 'Examples' }),
          presetGroup()));
      } else {
        const group = h('div.set-group.am-rules', { role: 'list', 'aria-label': 'Rules' });
        const entries = AM.log();
        for (const r of list) group.append(ruleRow(r, entries));
        content.append(group);
        content.append(h('p.am-foot', { text: `When one event starts several rules, they run top to bottom. Each rule runs at most once every ${AM.COOLDOWN_MS / 1000} seconds, and a rule never sets itself off.` }));
      }
      mainEl.append(content);
    }

    function lastLine(r, entries) {
      const e = lastEntry(r.id, entries);
      if (!e) return null;
      const t = AM.clock(e.at);
      switch (e.status) {
        case 'running': return h('span.am-last', { text: 'Running now…' });
        case 'ok': return h('span.am-last.is-ok', icon('check'), h('span', { text: `Ran at ${t}` }));
        case 'warn':
        case 'failed': return h('span.am-last.is-warn', icon('alert'), h('span', { text: `Ran at ${t}, with a problem` }));
        case 'held': return h('span.am-last', icon('shield'), h('span', { text: `Held back at ${t}` }));
        case 'skipped': return h('span.am-last', icon('clock'), h('span', { text: `Skipped at startup (${t})` }));
        default: return null;
      }
    }

    function ruleRow(r, entries) {
      const probs = AM.issues(r);
      const prob = probs.find(p => p.level === 'error') || probs.find(p => p.level === 'warn');
      const named = !!r.name.trim();
      const lbl = AM.label(r);
      const meta = [
        !r.enabled ? h('span.chip.am-chip', { text: 'Off' }) : null,
        prob ? h('span.am-last.is-warn', icon('alert'), h('span', { text: prob.text })) : null,
        lastLine(r, entries),
      ].filter(Boolean);

      const main = h('button.am-rule__main', {
        type: 'button', dataset: { fk: `edit-${r.id}` }, onclick: () => edit(r.id),
      },
      h('span.sr', { text: 'Edit rule: ' }),
      named ? h('span.am-rule__t.is-named', { text: r.name }) : h('span.am-rule__t', sentenceNodes(r)),
      named ? h('span.am-rule__s', sentenceNodes(r)) : null,
      meta.length ? h('span.am-rule__meta', meta) : null);

      const row = h('div.am-rule', {
        role: 'listitem', dataset: { id: r.id },
        class: [r.enabled ? '' : 'is-off', S.highlight === r.id ? 'is-new' : ''].filter(Boolean).join(' ') || null,
      },
      flow(r, S.narrow),
      main,
      h('div.am-rule__ctl',
        ibtn('play', `Run “${lbl}” now`, () => runNow(r.id), { dataset: { fk: `run-${r.id}` }, class: 'am-rule__run' }),
        sw(r.enabled, `Rule on: ${lbl}`, () => setEnabled(r.id, !r.enabled), `sw-${r.id}`),
        ibtn('more-horizontal', `More for “${lbl}”`, e => {
          const b = e.currentTarget.getBoundingClientRect();
          menu([
            { label: 'Edit…', icon: 'edit-3', onClick: () => edit(r.id) },
            { label: 'Run now', icon: 'play', onClick: () => runNow(r.id) },
            { label: r.enabled ? 'Switch off' : 'Switch on', icon: 'power', onClick: () => setEnabled(r.id, !r.enabled) },
            { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(r.id) },
            '-',
            { label: 'Delete…', icon: 'trash', danger: true, onClick: () => deleteRule(r.id) },
          ], Math.round(b.right - 180), Math.round(b.bottom + 4));
        }, { dataset: { fk: `more-${r.id}` }, 'aria-haspopup': 'menu' })));
      return row;
    }

    /* ---------- Examples ---------- */
    function presetGroup() {
      const group = h('div.set-group.am-presets', { role: 'list', 'aria-label': 'Examples' });
      const have = rules();
      for (const p of AM.PRESETS) {
        const r = presetRule(p);
        const missing = AM.issues(r).find(x => x.level === 'warn');
        const mine = have.find(x => sameShape(x, p));
        group.append(h('div.am-preset', { role: 'listitem' },
          flow(r, S.narrow),
          h('div.am-preset__t',
            h('span.am-preset__s', sentenceNodes(r)),
            missing ? h('small.am-last.is-warn', icon('alert'), h('span', { text: missing.text })) : null),
          mine
            ? h('span.am-added', icon('check'), h('span', { text: mine.enabled ? 'Added' : 'Added · switched off' }))
            : h('button.btn.btn--sm', {
              type: 'button', dataset: { fk: `preset-${p.id}` }, disabled: missing ? true : null,
              'aria-label': `Add rule: ${AM.describe(r)}`, onclick: () => addPreset(p),
            }, icon('plus'), h('span', { text: 'Add' }))));
      }
      return group;
    }
    function viewExamples() {
      mainEl.append(bar(S.narrow ? tabs() : title('Examples'), h('span.am-spacer'), flashSlot()));
      mainEl.append(h('div.app__content.am-scroll',
        h('p.am-intro', { text: 'Starter rules. Adding one makes an ordinary rule — switched on — that you can change, test or switch off like any other.' }),
        presetGroup()));
    }

    /* ---------- Run log ---------- */
    function causeLine(e) {
      const bits = [e.cause];
      if (e.via) bits.push(`set off by “${e.via.length > 70 ? e.via.slice(0, 69) + '…' : e.via}”`);
      return bits.join(' · ');
    }
    function stepList(steps) {
      return h('ul.am-steps', steps.map(s => {
        const st = STEP[s.state] || STEP.ok;
        return h('li.am-step', { class: `is-${s.state}` },
          st.icon ? icon(st.icon) : h('span.spinner.am-step__spin', { 'aria-hidden': 'true' }),
          h('span.sr', { text: `${st.label}: ` }),
          h('span', { text: s.result || s.what }));
      }));
    }
    function entryRow(e) {
      const st = ENTRY[e.status] || ENTRY.ok;
      const d = new Date(e.at);
      return h('li.am-entry', { class: `is-${e.status}` },
        h('span.am-entry__ico', { title: st.label },
          e.status === 'running' ? h('span.spinner', { 'aria-hidden': 'true' }) : icon(st.icon)),
        h('div.am-entry__b',
          h('div.am-entry__head',
            h('b.am-entry__t', { text: e.rule }),
            h('time.am-entry__time', { datetime: d.toISOString(), text: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: !store.get('prefs.h24') }) })),
          h('div.am-entry__cause', h('span.sr', { text: `${st.label}. ` }), h('span', { text: causeLine(e) })),
          e.note ? h('div.am-entry__note', { text: e.note }) : null,
          e.steps.length ? stepList(e.steps) : null));
    }
    function viewLog() {
      const entries = AM.log();
      mainEl.append(bar(
        S.narrow ? tabs() : title('Run log'),
        !S.narrow && entries.length ? h('span.am-count', { text: `${entries.length} this session` }) : null,
        h('span.am-spacer'),
        flashSlot(),
        entries.length ? h('button.btn.btn--sm', {
          type: 'button', dataset: { fk: 'clear-log' },
          onclick: () => { AM.clearLog(); announce('Log cleared'); render(); },
        }, icon('trash'), h('span', { text: 'Clear' })) : null));
      const content = h('div.app__content.am-scroll');
      if (!entries.length) {
        content.append(h('div.empty',
          icon('list'),
          h('b', { text: 'Nothing has run yet' }),
          h('small', { text: 'When a rule runs — or you press Run now — it’s listed here with exactly what it did. The log is kept in memory, so reloading StaticOS clears it.' })));
      } else {
        content.append(h('p.am-intro', { text: 'This session only — kept in memory, cleared when StaticOS reloads. Newest first.' }));
        content.append(h('ol.set-group.am-log', { 'aria-label': 'Runs, newest first' }, entries.map(entryRow)));
      }
      mainEl.append(content);
    }

    /* ---------- Startup apps ---------- */
    const appLabel = id => AM.appName(id) || id;
    function setStartupApps(list, say) {
      AM.saveStartupApps({ apps: list });
      if (say) announce(say);
      render();
    }
    function addStartup() {
      const id = S.startupPick;
      const set = AM.startupApps();
      if (!id || set.apps.includes(id) || set.apps.length >= AM.MAX_STARTUP_APPS) return;
      S.startupPick = '';
      setStartupApps([...set.apps, id]);
      flash(`Added ${appLabel(id)} — it opens ${set.apps.length ? `after ${appLabel(set.apps[set.apps.length - 1])}` : 'first'}`);
      requestAnimationFrame(() => { if (!S.dead) root.querySelector('[data-fk="startup-pick"]')?.focus({ preventScroll: true }); });
    }
    function moveStartup(i, dir) {
      const list = AM.startupApps().apps;
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      setStartupApps(list, `Moved ${appLabel(list[j])} to position ${j + 1}`);
      const key = `st-${j}-${dir < 0 ? 'up' : 'down'}`;
      requestAnimationFrame(() => {
        if (S.dead) return;
        const el = root.querySelector(`[data-fk="${key}"]`);
        (el && !el.disabled ? el : root.querySelector(`[data-fk="st-${j}-rm"]`))?.focus({ preventScroll: true });
      });
    }
    function removeStartup(i) {
      const list = AM.startupApps().apps;
      const [gone] = list.splice(i, 1);
      setStartupApps(list, `Removed ${appLabel(gone)}`);
      requestAnimationFrame(() => {
        if (S.dead) return;
        (root.querySelector(`[data-fk="st-${Math.min(i, list.length - 1)}-rm"]`) || root.querySelector('[data-fk="startup-pick"]'))?.focus({ preventScroll: true });
      });
    }
    function openStartupNow() {
      const e = AM.runStartupAppsNow();
      if (!e) return;
      flash(e.status === 'ok' ? 'Opened them — in order' : 'Opened them, with a problem — see the log', { log: true });
    }

    function startupRow(id, i, n) {
      const app = appOf(id);
      const name = appLabel(id);
      return h('div.am-line.am-app', { role: 'listitem', dataset: { id } },
        h('span.am-num', { 'aria-hidden': 'true', text: String(i + 1) }),
        tile('open-app', { app: id }, 30),
        h('div.am-app__t',
          h('b', { text: name }),
          app ? h('small', { text: app.desc || app.category || '' })
            : h('small.am-last.is-warn', icon('alert'), h('span', { text: 'Not available in this session — it’s skipped' }))),
        h('div.am-act__tools',
          ibtn('arrow-up', `Move ${name} up`, () => moveStartup(i, -1), { dataset: { fk: `st-${i}-up` }, disabled: i === 0 ? true : null }),
          ibtn('arrow-down', `Move ${name} down`, () => moveStartup(i, 1), { dataset: { fk: `st-${i}-down` }, disabled: i === n - 1 ? true : null }),
          ibtn('x', `Remove ${name}`, () => removeStartup(i), { dataset: { fk: `st-${i}-rm` } })));
    }

    function viewStartup() {
      const set = AM.startupApps();
      const n = set.apps.length;
      const full = n >= AM.MAX_STARTUP_APPS;
      mainEl.append(bar(
        S.narrow ? tabs() : title('Startup apps'),
        !S.narrow && n ? h('span.am-count', { text: `${n} app${n === 1 ? '' : 's'}${set.enabled ? '' : ' · off'}` }) : null,
        h('span.am-spacer'),
        flashSlot(),
        n ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'startup-run' }, onclick: openStartupNow }, icon('play'), h('span', { text: 'Open them now' })) : null));

      const content = h('div.app__content.am-scroll');
      content.append(h('p.am-intro', { text: 'When StaticOS starts in this browser, these apps open — top to bottom, once your desktop is ready — so the last one ends up in front. One that’s already open is brought forward instead of opened twice.' }));

      const ran = AM.startupAppsStatus();
      const lastTxt = ran ? `Opened them at ${AM.clock(ran.at)}, when StaticOS started.` : n ? 'They open the next time StaticOS starts.' : 'Add an app below to start.';
      content.append(h('div.set-group',
        h('div.set-row.am-detail',
          h('div.set-row__t',
            h('b', { text: 'Open these apps when StaticOS starts' }),
            h('small', { text: set.enabled ? lastTxt : 'Switched off — the list is kept, nothing opens.' })),
          h('div.set-row__c', sw(set.enabled, 'Open these apps when StaticOS starts', () => {
            AM.saveStartupApps({ enabled: !set.enabled });
            announce(`Startup apps ${set.enabled ? 'off' : 'on'}`);
            render();
          }, 'startup-on')))));

      const group = h('div.set-group.am-group.am-startup', { role: 'list', 'aria-label': 'Startup apps, in the order they open' });
      set.apps.forEach((id, i) => group.append(startupRow(id, i, n)));
      if (!n) group.append(h('div.am-line.am-line--empty', h('span.dim', { text: 'No apps yet — add the ones you open every time.' })));

      if (full) {
        group.append(h('div.am-line.am-line--empty', h('span.dim', { text: `That’s the most — ${AM.MAX_STARTUP_APPS} apps.` })));
      } else {
        const options = apps().filter(a => !set.apps.includes(a.id)).map(a => ({ value: a.id, label: a.name }));
        if (S.startupPick && !options.some(o => o.value === S.startupPick)) S.startupPick = '';
        const addBtn = h('button.btn.btn--sm', {
          type: 'button', dataset: { fk: 'startup-add' }, disabled: S.startupPick ? null : true, onclick: addStartup,
        }, icon('plus'), h('span', { text: 'Add' }));
        group.append(h('div.am-line.am-addline',
          h('div.am-line__words',
            h('span.am-word', { text: n ? 'Then open' : 'Open' }),
            select({ fk: 'startup-pick', label: 'App to add to startup', value: S.startupPick, placeholder: 'Choose an app…', options,
              onchange: v => { S.startupPick = v; addBtn.disabled = !v; } })),
          addBtn));
      }
      content.append(h('section.am-sec', { 'aria-label': 'Apps' },
        h('div.am-cap.am-cap--row', h('span.label', { text: 'Opens in this order' }), h('span.am-count', { text: `${n} of ${AM.MAX_STARTUP_APPS}` })),
        group));
      content.append(h('p.am-foot', { text: 'Rules that start with “When StaticOS starts” run as well — they’re under Rules. Startup apps open after the desktop and your Files window are up.' }));
      mainEl.append(content);
    }

    /* ---------- Reminders ---------- */
    const remDraft = () => S.rem.draft;
    function resetRemForm() { S.rem = { draft: AM.blankReminder(), editing: null, tried: false }; }
    function submitReminder() {
      const d = { ...remDraft(), text: String(remDraft().text || '').trim() };
      const res = S.rem.editing ? AM.updateReminder(S.rem.editing, { text: d.text, time: d.time, repeat: d.repeat, date: d.date }) : AM.addReminder(d);
      if (!res.ok) {
        S.rem.tried = true;
        render();
        announce(`Can’t save yet: ${(res.issues || []).map(x => x.text).join(' ')}`);
        requestAnimationFrame(() => { if (!S.dead) root.querySelector(`[data-fk="rem-${(res.issues[0] || {}).at || 'text'}"]`)?.focus({ preventScroll: true }); });
        return;
      }
      const was = S.rem.editing;
      const r = res.reminder;
      resetRemForm();
      S.highlight = r ? r.id : null;
      render();
      const st = r ? AM.reminderState(r) : null;
      const nextLine = r && st && st.next ? ` — ${AM.whenPhrase(st.next)}` : '';
      flash(was ? `Reminder saved${nextLine}` : `Reminder set${nextLine}`, { say: `${was ? 'Reminder saved' : 'Reminder set'}: ${r ? r.text : ''}, ${st ? st.text : ''}` });
      requestAnimationFrame(() => { if (!S.dead) root.querySelector('[data-fk="rem-text"]')?.focus({ preventScroll: true }); });
    }
    function editReminder(id) {
      const r = AM.reminders().find(x => x.id === id);
      if (!r) return;
      /* Calendar's own: changed where the event is */
      if (r.cal) { api.openApp('calendar', { event: r.cal }); return; }
      if (r.src === 'study') { api.openApp('study', { tab: 'homework', assignment: r.ref }); return; }
      if (r.src === 'friends') { api.openApp('social', { night: String(r.ref).split('~')[0] }); return; }
      if (r.src === 'study-exams') { api.openApp('study', { tab: 'exams', exam: String(r.ref).split(':')[0] }); return; }
      S.rem = { draft: { text: r.text, time: r.time, repeat: r.repeat, date: r.date || AM.ymd(new Date()) }, editing: id, tried: false };
      if (S.view !== 'reminders') S.view = 'reminders';
      render();
      requestAnimationFrame(() => {
        if (S.dead) return;
        const el = root.querySelector('[data-fk="rem-text"]');
        if (el) { el.focus({ preventScroll: false }); try { el.select(); } catch (e) { /* fine */ } }
      });
    }
    async function deleteReminder(id) {
      const r = AM.reminders().find(x => x.id === id);
      if (!r) return;
      S.asking = true;
      const ok = await confirm({ title: 'Delete this reminder?', message: `“${r.text}” is removed from this browser.`, ok: 'Delete', danger: true });
      S.asking = false;
      if (!ok || S.dead) return;
      AM.removeReminder(id);
      if (S.rem.editing === id) resetRemForm();
      flash('Reminder deleted');
      render();
    }
    function toggleReminder(r) {
      AM.updateReminder(r.id, { enabled: !r.enabled });
      announce(`${r.text} is ${r.enabled ? 'off' : 'on'}`);
      render();
    }

    function reminderForm() {
      const d = remDraft();
      const probs = S.rem.tried ? AM.reminderIssues(d) : [];
      const issue = at => {
        const x = probs.find(p => p.at === at);
        return x ? h('div.am-issue.am-err', { role: 'alert' }, icon('alert'), h('span', { text: x.text })) : null;
      };
      const textIn = h('input', {
        type: 'text', value: d.text || '', maxlength: String(AM.TEXT_MAX), placeholder: 'What should I remind you about?',
        'aria-label': 'Remind me to', dataset: { fk: 'rem-text' },
        oninput: e => { d.text = e.target.value.slice(0, AM.TEXT_MAX); },
        onkeydown: e => {
          if (e.key === 'Enter') { e.preventDefault(); submitReminder(); }
          else if (e.key === 'Escape' && S.rem.editing) { e.preventDefault(); e.stopPropagation(); resetRemForm(); render(); }
        },
      });
      const timeIn = h('input.am-time', {
        type: 'time', value: d.time || '', 'aria-label': 'Time', dataset: { fk: 'rem-time' }, required: true,
        onchange: e => { d.time = e.target.value; },
        oninput: e => { d.time = e.target.value; },
      });
      const dateIn = d.repeat === 'once' || d.repeat === 'weekly' ? h('input.am-date', {
        type: 'date', value: d.date || '', 'aria-label': d.repeat === 'weekly' ? 'First day' : 'Date', dataset: { fk: 'rem-date' }, required: true,
        min: d.repeat === 'once' ? AM.ymd(new Date()) : null,
        onchange: e => { d.date = e.target.value; },
        oninput: e => { d.date = e.target.value; },
      }) : null;
      const editing = !!S.rem.editing;
      return h('section.am-sec.am-remform', { 'aria-label': editing ? 'Change reminder' : 'New reminder' },
        h('div.label.am-cap', { text: editing ? 'Change reminder' : 'New reminder' }),
        h('div.set-group.am-group',
          h('div.am-line',
            h('div.am-line__words',
              h('span.am-word.am-word--lead', { text: 'Remind me to' }),
              h('div.field.am-textfield.am-remtext', textIn)),
            issue('text')),
          h('div.am-line',
            h('div.am-line__words',
              h('span.am-word', { text: 'at' }),
              h('div.field.am-timefield', timeIn),
              select({ fk: 'rem-repeat', label: 'How often', value: d.repeat, options: AM.REPEATS.map(x => ({ value: x.id, label: REPEAT_WORDS[x.id] || x.label })),
                onchange: v => { d.repeat = v; if ((v === 'once' || v === 'weekly') && !d.date) d.date = AM.ymd(new Date()); render(); } }),
              dateIn ? h('div.field.am-timefield', dateIn) : null),
            issue('time'), issue('date'), issue('repeat')),
          h('div.am-line.am-remform__go',
            h('small.dim', { text: 'Goes off as a notification while StaticOS is open in this browser.' }),
            h('span.am-spacer'),
            editing ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'rem-cancel' }, onclick: () => { resetRemForm(); render(); } }, h('span', { text: 'Cancel' })) : null,
            h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'rem-save' }, onclick: submitReminder },
              icon(editing ? 'check' : 'plus'), h('span', { text: editing ? 'Save' : 'Add reminder' })))));
    }

    function reminderRow(r, st, now) {
      const meta = [];
      if (r.cal) meta.push(h('span.chip.am-chip', { dataset: { fk: `rem-cal-${r.id}` } }, icon('calendar'), h('span', { text: 'From Calendar' })));
      if (r.src === 'study') meta.push(h('span.chip.am-chip', { dataset: { fk: `rem-study-${r.id}` } }, icon('clipboard'), h('span', { text: 'From Homework' })));
      if (r.src === 'friends') meta.push(h('span.chip.am-chip', { dataset: { fk: `rem-night-${r.id}` } }, icon('users'), h('span', { text: 'Game night' })));
      if (r.src === 'study-exams') meta.push(h('span.chip.am-chip', { dataset: { fk: `rem-exam-${r.id}` } }, icon('clipboard'), h('span', { text: 'From Exams' })));
      if (!r.enabled) meta.push(h('span.chip.am-chip', { text: 'Off' }));
      else if (st.state === 'done') meta.push(h('span.am-last.is-ok', icon('check'), h('span', { text: st.text })));
      else if (st.state === 'missed') meta.push(h('span.am-last.is-warn', icon('alert'), h('span', { text: st.text })));
      else if (st.text) meta.push(h('span.am-last', icon('clock'), h('span', { text: st.text })));
      const editingThis = S.rem.editing === r.id;
      return h('div.am-rule.am-rem', {
        role: 'listitem', dataset: { id: r.id },
        class: [r.enabled ? '' : 'is-off', st.state === 'done' ? 'is-done' : '', st.state === 'missed' ? 'is-missed' : '',
          S.highlight === r.id ? 'is-new' : '', editingThis ? 'is-editing' : ''].filter(Boolean).join(' ') || null,
      },
      h('span.am-tile.am-tile--sys', { 'aria-hidden': 'true', style: { '--gs': '28px' } }, icon(st.state === 'missed' ? 'bell-off' : 'bell')),
      h('button.am-rule__main', { type: 'button', dataset: { fk: `rem-edit-${r.id}` }, onclick: () => editReminder(r.id) },
        h('span.sr', { text: r.cal ? 'Open in Calendar: ' : r.src === 'friends' ? 'Open in Social: ' : r.src === 'study-exams' ? 'Open in Exams: ' : r.src ? 'Open in Homework: ' : 'Change reminder: ' }),
        h('span.am-rule__t.is-named', { text: r.text }),
        h('span.am-rule__s', { text: (r.cal || r.src) && r.sub ? `${AM.scheduleText(r, now)} · ${r.sub}` : AM.scheduleText(r, now) }),
        meta.length ? h('span.am-rule__meta', meta) : null),
      h('div.am-rule__ctl',
        sw(r.enabled, `Reminder on: ${r.text}`, () => toggleReminder(r), `rem-sw-${r.id}`),
        ibtn('more-horizontal', `More for “${r.text}”`, e => {
          const b = e.currentTarget.getBoundingClientRect();
          /* Calendar's reminders change with their event, in Calendar */
          menu(r.cal || r.src ? [
            { label: r.cal ? 'Change in Calendar…' : r.src === 'friends' ? 'Open the game night…' : r.src === 'study-exams' ? 'Change in Exams…' : 'Change in Homework…', icon: r.cal ? 'calendar' : r.src === 'friends' ? 'users' : 'clipboard', onClick: () => editReminder(r.id) },
            { label: r.enabled ? 'Switch off' : 'Switch on', icon: 'power', onClick: () => toggleReminder(r) },
          ] : [
            { label: 'Change…', icon: 'edit-3', onClick: () => editReminder(r.id) },
            { label: r.enabled ? 'Switch off' : 'Switch on', icon: 'power', onClick: () => toggleReminder(r) },
            '-',
            { label: 'Delete…', icon: 'trash', danger: true, onClick: () => deleteReminder(r.id) },
          ], Math.round(b.right - 180), Math.round(b.bottom + 4));
        }, { dataset: { fk: `rem-more-${r.id}` }, 'aria-haspopup': 'menu' })));
    }

    function viewReminders() {
      const now = Date.now();
      const list = AM.reminders().map(r => ({ r, st: AM.reminderState(r, now) }));
      const rank = x => (x.st.state === 'scheduled' || x.st.state === 'snoozed' ? 0 : x.st.state === 'off' ? 1 : 2);
      list.sort((a, b) => rank(a) - rank(b) || ((a.st.next || Infinity) - (b.st.next || Infinity)) || a.r.time.localeCompare(b.r.time));
      const upcoming = list.filter(x => rank(x) === 0).length;
      const finished = list.filter(x => x.r.repeat === 'once' && (x.st.state === 'done' || x.st.state === 'missed')).length;

      mainEl.append(bar(
        S.narrow ? tabs() : title('Reminders'),
        !S.narrow && list.length ? h('span.am-count', { text: `${list.length} reminder${list.length === 1 ? '' : 's'} · ${upcoming} coming up` }) : null,
        h('span.am-spacer'),
        flashSlot(),
        finished ? h('button.btn.btn--sm', {
          type: 'button', dataset: { fk: 'rem-clear' },
          onclick: () => { const n = AM.clearFinishedReminders(); flash(`Cleared ${n} finished reminder${n === 1 ? '' : 's'}`); render(); },
        }, icon('trash'), h('span', { text: 'Clear finished' })) : null));

      const content = h('div.app__content.am-scroll');
      if (!AM.status().running) {
        content.append(h('div.am-banner', { role: 'note' },
          icon('alert'),
          h('div.am-banner__t',
            h('b', { text: 'Automations aren’t running in this session' }),
            h('small', { text: 'Reminders are saved, but nothing is watching the clock. Start the engine to have them go off until StaticOS reloads.' })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'start-banner' }, onclick: startEngine }, h('span', { text: 'Start now' }))));
      }
      content.append(reminderForm());
      if (list.length) {
        const group = h('div.set-group.am-rules.am-rems', { role: 'list', 'aria-label': 'Reminders, soonest first' });
        for (const x of list) group.append(reminderRow(x.r, x.st, now));
        content.append(h('section.am-sec', { 'aria-label': 'Your reminders' },
          h('div.am-cap.am-cap--row', h('span.label', { text: 'Your reminders' }),
            h('span.am-count', { text: `${list.filter(x => !x.r.cal && !x.r.src).length} of ${AM.MAX_REMINDERS}${list.some(x => x.r.cal) ? ` · ${list.filter(x => x.r.cal).length} from Calendar` : ''}${list.some(x => x.r.src === 'study') ? ` · ${list.filter(x => x.r.src === 'study').length} from Homework` : ''}${list.some(x => x.r.src === 'study-exams') ? ` · ${list.filter(x => x.r.src === 'study-exams').length} from Exams` : ''}${list.some(x => x.r.src === 'friends') ? ` · ${list.filter(x => x.r.src === 'friends').length} for game nights` : ''}` })),
          group));
      }
      content.append(h('p.am-foot', { text: `Reminders only go off while StaticOS is open in this browser — a web page can’t wake itself when it’s closed. One that comes due while StaticOS is closed or asleep is marked Missed, and you’re told the next time it starts. Snooze waits ${AM.SNOOZE_MIN} minutes.` }));
      mainEl.append(content);
    }

    /* ---------- Editor ---------- */
    let previewEl = null;
    let testEl = null;

    function issueFor(list, at) {
      const x = list.find(i => i.at === at && (i.level === 'warn' || S.tried));
      return x ? h(`div.am-issue${x.level === 'error' ? '.am-err' : ''}`, { role: x.level === 'error' ? 'alert' : null }, icon('alert'), h('span', { text: x.text })) : null;
    }
    function hintFor(d) {
      const now = AM.clock(Date.now());
      if (d.when.type === 'startup') {
        return d.when.when === 'always'
          ? 'Checked once, each time StaticOS starts in this browser.'
          : `Checked once, each time StaticOS starts in this browser, against this computer’s clock (${AM.windowHours(d.when.when)}; it’s ${now} now).`;
      }
      return 'Runs while StaticOS is open in this browser.';
    }
    function paintPreview() {
      if (!previewEl || !S.draft) return;
      const d = S.draft;
      clear(previewEl);
      previewEl.append(
        tile(d.when.type, d.when, 34),
        h('div.am-preview__b',
          h('p.am-preview__s', sentenceNodes(d)),
          h('small', { text: d.enabled ? hintFor(d) : `${hintFor(d)} This rule is switched off, so it won’t run by itself.` })));
    }
    function paintTest() {
      if (!testEl) return;
      clear(testEl);
      const e = S.testId ? AM.log().find(x => x.id === S.testId) : null;
      if (!e) return;
      const st = ENTRY[e.status] || ENTRY.ok;
      testEl.append(h('div.am-test', { class: `is-${e.status}` },
        h('div.am-test__head',
          e.status === 'running' ? h('span.spinner', { 'aria-hidden': 'true' }) : icon(st.icon),
          h('b', { text: e.status === 'held' ? 'Held back' : e.status === 'running' ? 'Running…' : `Ran at ${AM.clock(e.at)}` }),
          h('span.am-spacer'),
          h('button.am-link', { type: 'button', text: 'Open the log', dataset: { fk: 'test-log' }, onclick: () => go('log') })),
        e.note ? h('div.am-entry__note', { text: e.note }) : null,
        e.steps.length ? stepList(e.steps) : null));
    }

    function paramControl(a, i) {
      const fk = `act-${i}-param`;
      const set = patch => { Object.assign(S.draft.then[i], patch); repaintEditor(); };
      switch (a.type) {
        case 'open-app':
          return select({ fk, label: `App to open (action ${i + 1})`, value: a.app, placeholder: 'Choose an app…',
            options: appOptions(a.app), onchange: v => set({ app: v }) });
        case 'gamemode':
          return select({ fk, label: `Game Mode on or off (action ${i + 1})`, value: a.on ? 'on' : 'off',
            options: [{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }], onchange: v => set({ on: v === 'on' }) });
        case 'widgets':
          return select({ fk, label: `Widgets hidden or shown (action ${i + 1})`, value: a.visible ? 'shown' : 'hidden',
            options: [{ value: 'hidden', label: 'hidden' }, { value: 'shown', label: 'shown' }], onchange: v => set({ visible: v === 'shown' }) });
        case 'wallpaper': {
          const wps = AM.wallpaperChoices();
          if (!wps.length) {
            return h('span.am-word.dim', { text: AM.wallpaperStatus() === 'failed' ? 'the wallpaper list couldn’t load' : 'loading wallpapers…' });
          }
          const opts = wps.map(w => ({ value: w.id, label: w.theme ? `${w.name} (brings the ${w.theme} accent)` : w.name }));
          if (a.id && !wps.some(w => w.id === a.id)) opts.unshift({ value: a.id, label: `${AM.wallpaperName(a.id)} (not available)` });
          return select({ fk, label: `Wallpaper (action ${i + 1})`, value: a.id, placeholder: 'Choose a wallpaper…', options: opts, onchange: v => set({ id: v }) });
        }
        case 'accent':
          return select({ fk, label: `Accent colour (action ${i + 1})`, value: a.id, placeholder: 'Choose a colour…',
            options: AM.accentChoices().map(t => ({ value: t.id, label: t.name })), onchange: v => set({ id: v }) });
        case 'music':
          return select({ fk, label: `Play or pause (action ${i + 1})`, value: a.action,
            options: [{ value: 'play', label: 'play' }, { value: 'pause', label: 'pause' }], onchange: v => set({ action: v }) });
        case 'notify': {
          const input = h('input', {
            type: 'text', value: a.text, maxlength: String(AM.TEXT_MAX), placeholder: 'What should it say?',
            'aria-label': `Notification text (action ${i + 1})`, dataset: { fk },
            oninput: e => { S.draft.then[i].text = e.target.value.slice(0, AM.TEXT_MAX); paintPreview(); },
            onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveDraft(); } },
          });
          return h('div.field.am-textfield', input);
        }
        default: return null;
      }
    }

    function actionLine(a, i, n, probs) {
      return h('div.am-line.am-act', { role: 'group', 'aria-label': `Action ${i + 1} of ${n}` },
        h('span.am-num', { 'aria-hidden': 'true', text: String(i + 1) }),
        h('div.am-line__words',
          i > 0 ? h('span.am-word', { text: i === n - 1 ? 'and' : 'then' }) : null,
          select({ fk: `act-${i}-type`, label: `Action ${i + 1}`, value: a.type, options: ACTION_OPTS, onchange: v => setActionType(i, v) }),
          paramControl(a, i)),
        h('div.am-act__tools',
          ibtn('arrow-up', `Move action ${i + 1} up`, () => moveAction(i, -1), { dataset: { fk: `act-${i}-up` }, disabled: i === 0 ? true : null }),
          ibtn('arrow-down', `Move action ${i + 1} down`, () => moveAction(i, 1), { dataset: { fk: `act-${i}-down` }, disabled: i === n - 1 ? true : null }),
          ibtn('x', `Remove action ${i + 1}`, () => removeAction(i), { dataset: { fk: `act-${i}-rm` } })),
        issueFor(probs, i));
    }

    function notes(d) {
      const out = [];
      const acts = d.then;
      if (d.when.type === 'app-open' && d.when.app && acts.some(a => a.type === 'open-app' && a.app === d.when.app)) {
        const nm = AM.appName(d.when.app) || 'that app';
        out.push(`This rule opens ${nm}, which is what starts it. The loop guard stops it setting itself off: it runs once each time you open ${nm}, at most every ${AM.COOLDOWN_MS / 1000} seconds.`);
      }
      if (d.when.type === 'gamemode-on' && acts.some(a => a.type === 'gamemode' && a.on)) {
        out.push('Game Mode is already on when this rule runs, so “turn on Game Mode” won’t change anything.');
      }
      if (d.when.type === 'gamemode-on' && acts.some(a => a.type === 'gamemode' && !a.on)) {
        out.push('This switches Game Mode straight back off every time it comes on.');
      }
      if (acts.some(a => a.type === 'wallpaper') && acts.some(a => a.type === 'accent')) {
        const wi = acts.findIndex(a => a.type === 'wallpaper');
        const ai = acts.findIndex(a => a.type === 'accent');
        const w = AM.wallpaperChoices().find(x => x.id === acts[wi].id);
        if (w && w.theme && wi > ai) out.push(`${w.name} brings its own ${w.theme} accent and comes after your accent action, so it wins. Move the accent below the wallpaper to keep your colour.`);
      }
      if (acts.some(a => a.type === 'music' && a.action === 'play')) {
        out.push('“Play music” resumes what Music last played, or starts your Music library from the top (shuffled, if Shuffle is on). If Music has nothing to play, the log says so.');
      }
      return out.map(t => h('div.am-note', icon('info'), h('span', { text: t })));
    }

    function viewEdit() {
      const d = S.draft;
      const probs = AM.issues(d);
      const n = d.then.length;

      mainEl.append(bar(
        ibtn('chevron-left', 'Back to rules', () => back(), { dataset: { fk: 'back' } }),
        title(S.isNew ? 'New rule' : 'Edit rule'),
        h('span.am-spacer'),
        flashSlot(),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'save' }, onclick: saveDraft }, icon('check'), h('span', { text: S.isNew ? 'Add rule' : 'Save' }))));

      previewEl = h('div.am-preview');
      paintPreview();

      /* When */
      const whenLine = h('div.am-line.am-when',
        h('div.am-line__words',
          h('span.am-word.am-word--lead', { text: 'When' }),
          select({ fk: 'when-type', label: 'When', value: d.when.type, options: TRIGGER_OPTS, onchange: setWhenType }),
          d.when.type === 'app-open'
            ? select({ fk: 'when-app', label: 'The app that starts this rule', value: d.when.app, placeholder: 'Choose an app…',
              options: appOptions(d.when.app), onchange: v => { S.draft.when.app = v; repaintEditor(); } })
            : null,
          d.when.type === 'startup'
            ? select({ fk: 'when-time', label: 'What time of day', value: d.when.when,
              options: AM.WINDOWS.map(w => ({ value: w.id, label: w.id === 'always' ? 'at any time' : `${w.label} (${AM.windowHours(w.id)})` })),
              onchange: v => { S.draft.when.when = v; repaintEditor(); } })
            : null),
        issueFor(probs, 'when'));

      /* Then */
      const thenGroup = h('div.set-group.am-group');
      d.then.forEach((a, i) => thenGroup.append(actionLine(a, i, n, probs)));
      if (!n) {
        thenGroup.append(h('div.am-line.am-line--empty',
          h('span.dim', { text: 'No actions yet — add what should happen.' }),
          S.tried ? h('div.am-issue.am-err', { role: 'alert' }, icon('alert'), h('span', { text: 'Add at least one action.' })) : null));
      }
      thenGroup.append(n < AM.MAX_ACTIONS
        ? h('button.am-addact', { type: 'button', dataset: { fk: 'add-act' }, onclick: addAction }, icon('plus'), h('span', { text: n ? 'Add another action' : 'Add an action' }))
        : h('div.am-line.am-line--empty', h('span.dim', { text: `That’s the most one rule can do — ${AM.MAX_ACTIONS} actions.` })));

      /* Details */
      const nameInput = h('input', {
        type: 'text', value: d.name, maxlength: String(AM.NAME_MAX), placeholder: 'Optional',
        'aria-label': 'Rule name (optional)', dataset: { fk: 'name' },
        oninput: e => { S.draft.name = e.target.value.slice(0, AM.NAME_MAX); },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveDraft(); } },
      });
      const details = h('div.set-group',
        h('div.set-row.am-detail',
          h('div.set-row__t', h('b', { text: 'Name' }), h('small', { text: 'Without one, the rule is listed by its sentence.' })),
          h('div.set-row__c.am-detail__c', h('div.field.am-namefield', nameInput))),
        h('div.set-row.am-detail',
          h('div.set-row__t', h('b', { text: 'Rule is on' }), h('small', { text: 'Switched off, it stays saved but never runs by itself.' })),
          h('div.set-row__c', sw(d.enabled, 'Rule is on', () => { S.draft.enabled = !S.draft.enabled; repaintEditor(); }, 'enabled'))));

      testEl = h('div.am-testslot', { 'aria-live': 'polite' });

      const content = h('div.app__content.am-scroll',
        h('div.am-ed',
          previewEl,
          h('section.am-sec', { 'aria-label': 'When' },
            h('div.label.am-cap', { text: 'When' }),
            h('div.set-group.am-group', whenLine)),
          h('section.am-sec', { 'aria-label': 'Then' },
            h('div.am-cap.am-cap--row', h('span.label', { text: 'Then' }), h('span.am-count', { text: `${n} of ${AM.MAX_ACTIONS}` })),
            thenGroup),
          notes(d),
          h('div.am-testrow',
            h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'test-2' }, onclick: testDraft }, icon('play'), h('span', { text: 'Run these actions now' })),
            h('small.dim', { text: 'Tries the actions straight away, without saving.' })),
          testEl,
          h('section.am-sec', { 'aria-label': 'Details' },
            h('div.label.am-cap', { text: 'Details' }),
            details),
          S.isNew ? null : h('div.am-danger',
            h('button.btn.btn--sm.btn--danger', { type: 'button', dataset: { fk: 'delete' }, onclick: () => deleteRule(d.id) }, icon('trash'), h('span', { text: 'Delete rule' })))));
      mainEl.append(content);
      paintTest();
    }

    /* ---------- full render ---------- */
    function render() {
      if (S.dead) return;
      /* keep the keyboard's place and the scroll position across a rebuild */
      const ae = document.activeElement;
      const fk = ae && appEl.contains(ae) && ae.dataset ? ae.dataset.fk : null;
      let sel = null;
      if (fk && ae.tagName === 'INPUT') { try { sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { sel = null; } }
      const oldScroll = mainEl.querySelector('.am-scroll');
      const scrollTop = oldScroll ? oldScroll.scrollTop : 0;
      const prevView = mainEl.dataset.view;

      if (S.view === 'edit' && !S.draft) S.view = 'rules';
      appEl.classList.toggle('is-narrow', S.narrow);
      mainEl.dataset.view = S.view;
      renderSide();
      clear(mainEl);
      previewEl = null;
      testEl = null;
      if (S.view === 'edit') viewEdit();
      else if (S.view === 'log') viewLog();
      else if (S.view === 'examples') viewExamples();
      else if (S.view === 'reminders') viewReminders();
      else if (S.view === 'startup') viewStartup();
      else viewRules();
      paintFlash();

      const vl = S.view === 'edit' ? (S.isNew ? 'New rule' : 'Edit rule') : (VIEWS.find(v => v.id === S.view) || VIEWS[0]).label;
      win.setSubtitle(vl);

      const sc = mainEl.querySelector('.am-scroll');
      if (sc && prevView === S.view && scrollTop) sc.scrollTop = scrollTop;
      if (fk) {
        const el = appEl.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
        if (el && !el.disabled) {
          el.focus({ preventScroll: true });
          if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
        }
      }
      /* a just-added or just-saved rule flashes once, then forgets */
      if (S.highlight && S.view === 'rules') {
        const row = mainEl.querySelector(`.am-rule[data-id="${CSS.escape(S.highlight)}"]`);
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
        S.highlight = null;
      }
    }
    function schedule() {
      if (rafId || S.dead) return;
      rafId = requestAnimationFrame(() => { rafId = 0; if (!S.dead) render(); });
    }

    /* ---------- live updates ---------- */
    const offs = [
      AM.onLog(() => {
        if (S.dead) return;
        if (S.view === 'edit') { paintTest(); refreshSideCounts(); } else schedule();
      }),
      store.sub(AM.STORE_KEY, () => { if (S.view === 'edit') refreshSideCounts(); else schedule(); }),
      store.sub(AM.REMINDERS_KEY, () => { if (S.view === 'edit') refreshSideCounts(); else schedule(); }),
      store.sub(AM.STARTUP_KEY, () => { if (S.view === 'edit') refreshSideCounts(); else schedule(); }),
      /* "next: in 5 minutes"-style lines age; refresh the Reminders list twice a minute,
         but never under someone's fingers in the form */
      bus.on('tick:5s', () => {
        if (S.dead || S.view !== 'reminders') return;
        if (++remTick % 6) return;
        const ae = document.activeElement;
        if (ae && ae.closest && ae.closest('.am-remform')) return;
        schedule();
      }),
      bus.on('automations:status', () => { if (S.view === 'edit') renderSide(); else schedule(); }),
    ];
    function refreshSideCounts() {
      /* the sidebar is cheap and holds no draft state — rebuild it, keeping focus */
      const ae = document.activeElement;
      const fk = ae && sideEl.contains(ae) ? ae.dataset.fk : null;
      renderSide();
      if (fk) sideEl.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
    }
    AM.ready().then(() => { if (!S.dead) { if (S.view === 'edit') render(); else schedule(); } });

    /* ---------- keyboard ---------- */
    const onKey = e => {
      if (S.dead || S.asking || S.view !== 'edit') return;
      if (!win.el.classList.contains('is-active')) return;
      if (!appEl.contains(document.activeElement) && document.activeElement !== document.body) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) { e.preventDefault(); saveDraft(); return; }
      if (e.key === 'Escape' && !mod && !e.altKey && !e.shiftKey) { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);

    /* ---------- responsive: react to the real painted width ---------- */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        const w = (entries[0] && entries[0].contentRect && entries[0].contentRect.width) || appEl.clientWidth;
        const n = w > 0 && w < NARROW;
        if (n !== S.narrow) { S.narrow = n; if (!S.dead) render(); }
      });
      ro.observe(appEl);
    } else {
      S.narrow = (appEl.clientWidth || win.w || 880) < NARROW;
    }

    /* ---------- open with a destination ---------- */
    function applyOpts(o) {
      if (!o || typeof o !== 'object') return;
      if (o.rule && rules().some(r => r.id === o.rule)) { leaveEditor().then(ok => { if (ok) edit(o.rule); }); return; }
      if (o.view === 'new') { leaveEditor().then(ok => { if (ok) newRule(); }); return; }
      if (o.view && VIEWS.some(v => v.id === o.view)) go(o.view);
    }
    win.onReopen(o => applyOpts(o));

    if (opts && opts.view && VIEWS.some(v => v.id === opts.view)) S.view = opts.view;
    render();
    if (opts && (opts.rule || opts.view === 'new')) applyOpts(opts);

    /* ---------- teardown ---------- */
    return () => {
      S.dead = true;
      offs.forEach(off => { try { off(); } catch (e) { /* already gone */ } });
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      clearTimeout(flashTimer);
      clearTimeout(liveTimer);
      if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } ro = null; }
      window.removeEventListener('keydown', onKey);
    };
  },
});
