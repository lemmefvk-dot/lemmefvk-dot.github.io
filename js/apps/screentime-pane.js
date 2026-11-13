/* ============================================================
   screentime-pane.js — Settings › Screen Time.

   The face of js/core/screentime.js (which measures) and the
   focus history from js/core/focus.js. Every number here was
   measured on this device: today's total, each app and game, the
   last seven days, focus minutes. A day with nothing measured
   says so instead of showing a zero bar dressed up as data.

   pane({ api, setLive, repaint }) -> nodes for Settings' pane
   column. setLive(fn) registers a per-second refresher (Settings
   calls it on tick:1s); repaint() redraws the whole pane.
   ============================================================ */
import * as ST from '../core/screentime.js';
import * as FOCUS from '../core/focus.js';
import { hasIcon } from '../core/icons.js';
import { appTile } from '../core/appart.js';

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
  const empty = t => h('div.set-row', h('div.set-row__t', h('small', { text: t })));

  /* ---- the numbers at the top ------------------------------------ */
  const stats = h('div.st-time__stats', { style: { display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap', padding: 'var(--sp-4) var(--sp-5)' } });
  const chart = h('div.st-time__chart', { role: 'list', 'aria-label': 'Screen time, last 7 days', style: { display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', padding: '0 var(--sp-5) var(--sp-4)' } });
  const lists = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' } });

  const stat = (k, v, d, data) => h('div.stat', { dataset: data },
    h('div.stat__k', { text: k }), h('div.stat__v', { text: v }), d ? h('div.stat__d', { text: d }) : null);

  function paintTop() {
    const today = ST.day();
    const week = ST.week();
    const weekSum = week.reduce((n, d) => n + d.sec, 0);
    const days = week.filter(d => d.sec > 0).length;
    const f = FOCUS.today();
    render(stats,
      stat('Today', fmtDur(today.total), today.total ? `${today.apps.length} app${today.apps.length === 1 ? '' : 's'}${today.games.length ? `, ${today.games.length} game${today.games.length === 1 ? '' : 's'}` : ''}` : 'Nothing measured yet', { st: 'today' }),
      stat('Last 7 days', fmtDur(weekSum), days ? `on ${days} day${days === 1 ? '' : 's'}` : null, { st: 'week' }),
      stat('Focus today', `${f.min} min`, `${f.n} session${f.n === 1 ? '' : 's'} in Clock › Focus`, { st: 'focus' }));

    /* the week as bars: one series, so one colour; the value is in each bar's label */
    const most = Math.max(1, ...week.map(d => d.sec));
    render(chart, week.map((d, i) => {
      const isToday = i === week.length - 1;
      const name = isToday ? 'Today' : d.date.toLocaleDateString(undefined, { weekday: 'short' });
      const said = `${isToday ? 'Today' : d.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${d.sec ? fmtDur(d.sec) : 'nothing measured'}`;
      return h('div.st-time__day', {
        role: 'listitem', title: said, 'aria-label': said, dataset: { day: d.key, sec: String(d.sec) },
        style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
      },
        h('div', { style: { height: '96px', width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' } },
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
  const seg = h('div.seg', { role: 'tablist', 'aria-label': 'Show time for' });
  function paintSeg() {
    render(seg, [['today', 'Today'], ['week', 'Last 7 days']].map(([id, t]) => h('button', {
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
    const when = view === 'week' ? 'in the last 7 days' : 'today';
    render(lists,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } },
        label('Apps'),
        h('div.set-group.st-time__apps', appRows.length ? appRows : [empty(`No app has been in front ${when} yet.`)])),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } },
        label('Games'),
        h('div.set-group.st-time__games', gameRows.length ? gameRows : [empty(`No game played ${when} — games in Static Games and the Arcade count here by name.`)])));
  }

  paintTop(); paintSeg(); paintLists();
  /* the open pane follows the clock: cheap enough every few seconds */
  let n = 0;
  setLive(() => { if (++n % 3) return; paintTop(); paintLists(); });

  const clearBtn = h('button.btn.btn--sm.btn--danger', {
    type: 'button', 'data-st': 'clear',
    onclick: async () => {
      const yes = await api.confirm({
        title: 'Clear screen time history?',
        message: 'Every day of app and game time measured on this device is forgotten. Focus sessions stay in Clock.',
        ok: 'Clear history', danger: true,
      });
      if (!yes) return;
      ST.clear();
      repaint();
    },
  }, icon('trash'), h('span', { text: 'Clear history' }));

  return [
    h('div.set-group', stats, chart),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '0 var(--sp-2)' } }, h('div', { style: { flex: '1' } }), seg),
    lists,
    h('div.st-note', icon('info'), h('small', { text:
      'Measured on this device while StaticOS is open: the app in the front window, while this tab is visible and you are using it. '
      + 'Five minutes without a key, click or scroll stops the count, unless a video or music is playing in that window. '
      + 'Input inside a game or page embedded from another site can’t be seen, so that time counts while it has your keyboard focus. '
      + 'Days are kept for 8 weeks; nothing leaves this device.' })),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, clearBtn),
  ];
}

export default { pane, fmtDur };
