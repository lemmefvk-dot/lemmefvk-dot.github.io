/* ============================================================
   screentime-pane.js — Settings › Screen Time.

   The face of js/core/screentime.js (which measures) and the
   focus history from js/core/focus.js. Every number here was
   measured on this device: today's total, each app and game, the
   last seven days, focus minutes. A day with nothing measured
   says so instead of showing a zero bar dressed up as data.

   Also here: a goal line on the chart (your own daily goal), this week
   against the one before, gentle nudges (a notification and nothing else:
   see core/screentime.js), a take-a-break reminder, and the last 56 days as
   a CSV file.

   pane({ api, setLive, repaint }) -> nodes for Settings' pane
   column. setLive(fn) registers a per-second refresher (Settings
   calls it on tick:1s); repaint() redraws the whole pane.
   ============================================================ */
import * as ST from '../core/screentime.js';
import * as FOCUS from '../core/focus.js';
import { hasIcon } from '../core/icons.js';
import { appTile } from '../core/appart.js';
import { t, plural } from '../core/i18n.js';

let view = 'today';            /* 'today' | 'week' — the lists below the chart */

/* how a duration reads, here and on the weekly recap card (shell/recap.js) */
export const fmtDur = ST.fmtDur;

export function pane({ api, setLive, repaint }) {
  const { h, icon, render, getApp } = api;

  const appGlyph = (app, ic) => appTile(app || { g1: 'var(--accent-soft)', g2: 'var(--accent)' }, {
    gs: '28px', attrs: { 'aria-hidden': 'true' },
    icon: ic && hasIcon(ic) ? ic : (app && app.icon) || 'apps',
  });

  /* one row: icon, name, a bar against the busiest row, the time */
  const row = (glyph, name, sub, sec, most, data) => h('div.set-row.st-time__row', { dataset: data },
    glyph,
    h('div.set-row__t',
      h('b', { text: name }),
      sub ? h('small', { text: sub }) : null,
      h('div.bar', { style: { marginTop: 'var(--sp-2)' }, 'aria-hidden': 'true' },
        h('i', { style: { width: `${Math.max(2, Math.round((sec / most) * 100))}%` } }))),
    h('div.set-row__c', h('span.st-time__v', { text: fmtDur(sec), style: { fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-12)', color: 'var(--ink-1)', fontWeight: '600' } })));

  const label = t => h('div.label', { text: t, style: { padding: '0 var(--sp-2)' } });
  const prefs = api.store;
  const getPref = (k, d) => prefs.get('prefs.' + k, d);

  /* one settings row with a menu on the right */
  const choiceRow = (ic, name, sub, items, value, onChange, data) => h('div.set-row', { dataset: data },
    ic,
    h('div.set-row__t', h('b', { text: name }), sub ? h('small', { text: sub }) : null),
    h('div.set-row__c', h('select.select', { 'aria-label': name, onchange: e => onChange(e.target.value) },
      items.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value), text: l })))));
  const minutesLabel = m => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? t('{v} h {v2} min', { v: Math.floor(m / 60), v2: m % 60 }) : t('{m} min', { m }));
  const GOALS = [[0, t('No goal')], ...[30, 60, 90, 120, 180, 240, 300, 360].map(m => [m, minutesLabel(m)])];
  const BREAKS = [[0, t('Off')], ...[20, 30, 45, 60, 90, 120].map(m => [m, t('after {v}', { v: minutesLabel(m) })])];
  const NUDGES = [[0, t('Off')], ...[15, 30, 45, 60, 90, 120, 180].map(m => [m, minutesLabel(m)])];
  const empty = t => h('div.set-row', h('div.set-row__t', h('small', { text: t })));

  /* ---- the numbers at the top ------------------------------------ */
  const stats = h('div.st-time__stats', { style: { display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap', padding: 'var(--sp-4) var(--sp-5)' } });
  const chart = h('div.st-time__chart', { role: 'list', 'aria-label': t('Screen time, last 7 days'), style: { display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', padding: '0 var(--sp-5) var(--sp-4)' } });
  const lists = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' } });

  const stat = (k, v, d, data) => h('div.stat', { dataset: data },
    h('div.stat__k', { text: k }), h('div.stat__v', { text: v }), d ? h('div.stat__d', { text: d }) : null);

  function paintTop() {
    const today = ST.day();
    const week = ST.week();
    const weekSum = week.reduce((n, d) => n + d.sec, 0);
    const days = week.filter(d => d.sec > 0).length;
    const f = FOCUS.today();
    const goal = ST.goalMin();
    const under = goal ? week.filter(d => d.sec > 0 && d.sec <= goal * 60).length : 0;
    const cmp = ST.compare();
    render(stats,
      stat(t('Today'), fmtDur(today.total), today.total ? `${plural(today.apps.length, '{n} app', '{n} apps')}${today.games.length ? `, ${plural(today.games.length, '{n} game', '{n} games')}` : ''}` : t('Nothing measured yet'), { st: 'today' }),
      stat('Last 7 days', fmtDur(weekSum), days ? plural(days, 'on {n} day', 'on {n} days') : null, { st: 'week' }),
      stat(t('Focus today'), t('{min} min', { min: f.min }), plural(f.n, '{n} session in Clock › Focus', '{n} sessions in Clock › Focus'), { st: 'focus' }),
      cmp.hasBefore
        ? stat(t('Against last week'), cmp.delta === 0 ? t('Same') : cmp.delta > 0 ? t('{time} more', { time: fmtDur(Math.abs(cmp.delta)) }) : t('{time} less', { time: fmtDur(Math.abs(cmp.delta)) }),
          `${t('{now} this week, {before} the week before', { now: fmtDur(cmp.now), before: fmtDur(cmp.before) })}${cmp.pct !== null && cmp.delta !== 0 ? ` (${cmp.pct > 0 ? '+' : ''}${cmp.pct}%)` : ''}`, { st: 'compare' })
        : stat(t('Against last week'), t('Not yet'), t('Nothing was measured in the 7 days before this week.'), { st: 'compare' }),
      goal ? stat(t('Your goal'), minutesLabel(goal), week.some(d => d.sec) ? plural(week.filter(d => d.sec > 0).length, 'kept on {under} of {n} day this week', 'kept on {under} of {n} days this week', { under }) : t('a line on the chart'), { st: 'goal' }) : null);

    /* the week as bars: one series, so one colour; the value is in each bar's label */
    const goalSec = goal * 60;
    const most = Math.max(1, goalSec, ...week.map(d => d.sec));
    render(chart, week.map((d, i) => {
      const isToday = i === week.length - 1;
      const name = isToday ? t('Today') : d.date.toLocaleDateString(undefined, { weekday: 'short' });
      const said = `${isToday ? 'Today' : d.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${d.sec ? fmtDur(d.sec) : 'nothing measured'}`;
      return h('div.st-time__day', {
        role: 'listitem', title: said, 'aria-label': said, dataset: { day: d.key, sec: String(d.sec) },
        style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
      },
        h('div', { style: { height: '96px', width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' } },
          goalSec ? h('i.st-time__goal', { 'aria-hidden': 'true', style: { position: 'absolute', left: '-3px', right: '-3px', bottom: `${Math.min(100, (goalSec / most) * 100)}%`, borderTop: '1px dashed var(--ink-3)', pointerEvents: 'none' } }) : null,
          h('i', { style: {
            display: 'block', width: '62%', maxWidth: '30px', borderRadius: '4px 4px 0 0',
            height: d.sec ? `${Math.max(3, Math.round((d.sec / most) * 100))}%` : '0',
            background: isToday ? 'var(--accent)' : 'var(--accent-soft)', opacity: isToday ? '1' : '.7',
          } })),
        h('small', { text: d.sec ? fmtDur(d.sec) : '–', style: { fontSize: 'var(--fs-10)', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }),
        h('span', { text: name, style: { fontSize: 'var(--fs-10)', color: isToday ? 'var(--ink-0)' : 'var(--ink-3)', fontWeight: isToday ? '600' : '400' } }));
    }));
  }

  /* ---- apps and games -------------------------------------------- */
  const seg = h('div.seg', { role: 'tablist', 'aria-label': t('Show time for') });
  function paintSeg() {
    render(seg, [['today', t('Today')], ['week', 'Last 7 days']].map(([id, t]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(view === id), class: view === id ? 'is-on' : null,
      onclick: () => { if (view === id) return; view = id; paintSeg(); paintLists(); },
    }, h('span', { text: t }))));
  }

  function paintLists() {
    const d = view === 'week' ? ST.range(7) : ST.day();
    const mostApp = Math.max(1, ...d.apps.map(a => a.sec));
    const appRows = d.apps.map(a => {
      const app = getApp(a.id);
      return row(appGlyph(app), app ? app.name : a.id, null, a.sec, mostApp, { app: a.id });
    });
    const mostGame = Math.max(1, ...d.games.map(g => g.sec));
    const gameRows = d.games.map(g => {
      const host = getApp(g.kind === 'arcade' ? 'arcade' : 'aether-games');
      return row(appGlyph(host, g.icon), g.title, host ? host.name : null, g.sec, mostGame, { game: g.key });
    });
    const when = view === 'week' ? t('in the last 7 days') : 'today';
    render(lists,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } },
        label(t('Apps')),
        h('div.set-group.st-time__apps', appRows.length ? appRows : [empty(t('No app has been in front {when} yet.', { when }))])),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } },
        label(t('Games')),
        h('div.set-group.st-time__games', gameRows.length ? gameRows : [empty(t('No game played {when} — games in Static Games and the Arcade count here by name.', { when }))])));
  }

  /* ---- this week against the one before ------------------------- */
  const compareBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } });
  function paintCompare() {
    const c = ST.compare();
    const rows = c.apps.filter(a => a.delta !== 0).slice(0, 5).map(a => {
      const app = getApp(a.id);
      return h('div.set-row.st-time__cmp', { dataset: { app: a.id, delta: String(a.delta) } },
        appGlyph(app),
        h('div.set-row__t', h('b', { text: app ? app.name : a.id }),
          h('small', { text: t('{v} this week, {v2} the week before', { v: fmtDur(a.now), v2: fmtDur(a.before) }) })),
        h('div.set-row__c', h('span', { text: `${a.delta > 0 ? '+' : '−'}${fmtDur(Math.abs(a.delta))}`,
          style: { fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-12)', fontWeight: '600', color: a.delta > 0 ? 'var(--ink-0)' : 'var(--ink-2)' } })));
    });
    render(compareBox, label(t('This week against last week')),
      h('div.set-group.st-time__compare', c.hasBefore || c.now
        ? (rows.length ? rows : [empty(t('Every app is within a second of last week.'))])
        : [empty(t('Nothing measured yet. This fills in once StaticOS has been open for a few days.'))]));
  }
  paintCompare();

  /* ---- gentle nudges, a break reminder and a goal ----------------- */
  const nudgeBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } });
  function paintNudges() {
    const map = ST.nudgeMap();
    const used = ST.range(7).apps.map(a => a.id);
    const ids = [...new Set([...Object.keys(map), ...used])].filter(id => getApp(id)).slice(0, Math.max(6, Object.keys(map).length));
    const setNudge = (id, m) => {
      const next = { ...ST.nudgeMap() };
      if (Number(m) > 0) next[id] = Number(m); else delete next[id];
      prefs.set('prefs.stNudges', next);
      paintNudges();
    };
    render(nudgeBox,
      label(t('Gentle reminders')),
      h('div.set-group.st-time__nudges',
        choiceRow(icon('clock'), t('Take a break'), t('A note after this long using StaticOS without a five-minute break. Only a reminder.'),
          BREAKS, ST.breakMin(), v => prefs.set('prefs.stBreakMin', Number(v)), { st: 'break' }),
        choiceRow(icon('bar-chart'), t('Daily goal'), t('Draws a line on the chart. It never stops anything.'),
          GOALS, ST.goalMin(), v => { prefs.set('prefs.stGoalMin', Number(v)); paintTop(); paintNudges(); }, { st: 'goal' }),
        ...(ids.length ? ids.map(id => choiceRow(appGlyph(getApp(id)), getApp(id).name, t('A heads-up the first time it passes this in a day.'),
          NUDGES, map[id] || 0, v => setNudge(id, v), { nudge: id })) : [empty(t('Use a few apps and they will be listed here, so you can ask for a heads-up in any of them.'))]),
        h('div.set-row', h('div.set-row__t', h('small', { text: t('Reminders are notifications and nothing else: nothing is blocked, locked or closed. Do Not Disturb holds them back like any other.') })),
          h('div.set-row__c', h('button.btn.btn--sm', { type: 'button', 'data-st': 'add-nudge', onclick: e => {
            const free = api.listApps().filter(a => !ids.includes(a.id) && !a.hidden);
            const r = e.currentTarget.getBoundingClientRect();
            api.menu(free.map(a => ({ label: a.name, icon: a.icon, onClick: () => setNudge(a.id, 60) })), r.left, r.bottom + 6);
          } }, icon('plus'), h('span', { text: t('Add an app…') }))))));
  }
  paintNudges();

  paintTop(); paintSeg(); paintLists();
  /* the open pane follows the clock: cheap enough every few seconds */
  let n = 0;
  setLive(() => { if (++n % 3) return; paintTop(); paintLists(); paintCompare(); });

  const clearBtn = h('button.btn.btn--sm.btn--danger', {
    type: 'button', 'data-st': 'clear',
    onclick: async () => {
      const yes = await api.confirm({
        title: t('Clear screen time history?'),
        message: t('Every day of app and game time measured on this device is forgotten. Focus sessions stay in Clock.'),
        ok: t('Clear history'), danger: true,
      });
      if (!yes) return;
      ST.clear();
      repaint();
    },
  }, icon('trash'), h('span', { text: t('Clear history') }));

  /* ---- the last 56 days as a file -------------------------------- */
  const have = ST.range(ST.KEEP_DAYS).total > 0;
  const csvBtn = h('button.btn.btn--sm', {
    type: 'button', 'data-st': 'csv', disabled: !have, title: have ? null : t('Nothing has been measured yet'),
    onclick: () => {
      const blob = new Blob([ST.csv()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `staticos-screen-time-${ST.dayKey()}.csv` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      api.notify({ app: t('Settings'), icon: 'download', title: t('Screen Time saved as CSV'), message: t('One row per app and game per day, for up to 56 days. It stays on this computer.') });
    },
  }, icon('download'), h('span', { text: t('Export as CSV') }));

  return [
    h('div.set-group', stats, chart),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '0 var(--sp-2)' } }, h('div', { style: { flex: '1' } }), seg),
    lists,
    compareBox,
    nudgeBox,
    h('div.st-note', icon('info'), h('small', { text:
      t('Measured on this device while StaticOS is open: the app in the front window, while this tab is visible and you are using it. Five minutes without a key, click or scroll stops the count, unless a video or music is playing in that window. Input inside a game or page embedded from another site can’t be seen, so that time counts while it has your keyboard focus. Days are kept for 8 weeks; nothing leaves this device.') })),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)' } }, csvBtn, clearBtn),
  ];
}

export default { pane, fmtDur };
