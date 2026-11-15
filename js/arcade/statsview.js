/* ============================================================
   arcade/statsview.js — the Arcade's Stats tab: only the games
   played on this device, and only what was really recorded
   (js/arcade/records.js) — rounds finished, time playing (a round's
   time on screen, pauses left out), when it was last played, the
   best three scores with their dates, and, for board games, won–
   lost–drawn against the computer at each level. A game with modes
   (./modes.js) lists its first mode's best three, then each other
   mode's best under the mode's name.

   statsView({ h, icon, ARCADE, records, withUnit, ago, onPlay }) -> element
   ============================================================ */
import { modesOf, scoring, bestKey } from './modes.js';
import { t as tr } from '../core/i18n.js';

/* 3 h 05 min · 12 min · under a minute */
export function playTime(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 1) return ms > 0 ? tr('under a minute') : '—';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
const day = at => (Number.isFinite(at) ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : null);

/* a game's other modes (./modes.js) keep their own best three: [{ g (as the mode scores it), tops }] */
const modeTops = (g, records) => (modesOf(g) || []).slice(1)
  .map(m => ({ g: scoring(g, m.id), tops: records.tops(bestKey(g, m.id)) })).filter(x => x.tops.length);

export function statsView({ h, icon, ARCADE, records, withUnit, ago, onPlay }) {
  const all = records.allStats();
  const rows = ARCADE.map(g => ({ g, st: records.statsOf(g.id), tops: records.tops(g.id), more: modeTops(g, records), vs: records.vsAll?.(g.id) || [] }))
    .filter(x => (x.st && (x.st.n || x.st.ms)) || x.tops.length || x.more.length)
    .sort((a, b) => (b.st?.last || 0) - (a.st?.last || 0) || a.g.title.localeCompare(b.g.title));
  /* won–lost–drawn against the computer at each level, only once there is some */
  const anyVs = rows.some(x => x.vs.length);
  const since = records.since();
  const head = h('div.arc-clips__head',
    h('div.arc-clips__title', { text: tr('Your stats') }),
    h('div.arc-clips__sub', { text: since ? tr('Only rounds played on this device, counted since {date}. Scores and times stay here unless you share them with friends.', { date: day(since) }) : tr('Only rounds played on this device. Scores and times stay here unless you share them with friends.') }));
  if (!rows.length) {
    return h('div.arc-stats', head, h('div.arc-empty', icon('bar-chart'), h('b', { text: tr('No rounds yet') }),
      h('small', { text: tr('Play any game and its rounds, time and best scores show up here.') })));
  }
  const total = Object.values(all).reduce((t, s) => ({ n: t.n + (s?.n | 0), ms: t.ms + (Number(s?.ms) || 0) }), { n: 0, ms: 0 });
  const summary = h('div.arc-stats__sum', { role: 'group', 'aria-label': tr('Totals') },
    h('div.arc-stats__tot', h('b', { text: String(rows.length) }), h('span', { text: rows.length === 1 ? tr('game played') : tr('games played') })),
    h('div.arc-stats__tot', h('b', { text: total.n.toLocaleString() }), h('span', { text: total.n === 1 ? tr('round finished') : tr('rounds finished') })),
    h('div.arc-stats__tot', h('b', { text: playTime(total.ms) }), h('span', { text: tr('time playing') })));
  const table = h('table.arc-stats__t',
    h('caption.arc-sr', { text: tr('Your stats for each game you have played on this device') }),
    h('thead', h('tr',
      h('th', { scope: 'col', text: tr('Game') }), h('th', { scope: 'col', text: tr('Rounds') }), h('th', { scope: 'col', text: tr('Time') }),
      h('th', { scope: 'col', text: tr('Last played') }), h('th', { scope: 'col', text: tr('Best three') }),
      anyVs ? h('th', { scope: 'col', text: tr('vs computer') }) : null)),
    h('tbody', rows.map(({ g, st, tops, more, vs }) => h('tr', { style: { '--h': g.hue }, dataset: { game: g.id } },
      h('th', { scope: 'row' }, h('button.arc-stats__game', { type: 'button', 'aria-label': tr('Play {title}', { title: g.title }), onclick: () => onPlay(g.id) },
        h('span.arc-stats__ic', icon(g.icon)), h('span', { text: g.title }))),
      h('td', { dataset: { k: 'rounds' }, text: st?.n ? st.n.toLocaleString() : '—' }),
      h('td', { dataset: { k: 'time' }, text: st?.ms ? playTime(st.ms) : '—' }),
      h('td', { dataset: { k: 'last' }, text: st?.last ? ago(st.last) : '—' }),
      h('td', { dataset: { k: 'tops' } }, tops.length
        ? h('ol.arc-stats__tops', tops.map((t, i) => h('li', { dataset: { i: String(i) } },
          h('b', { text: withUnit(g, t.s) }), h('small', { text: day(t.at) || tr('before dates were kept') }))))
        : h('span.arc-stats__none', { text: g.players.includes(1) ? (more.length ? tr('no {mode} score yet', { mode: modesOf(g)[0].label }) : tr('no 1-player score yet')) : '—' }),
        /* each other mode's best, under its name */
        more.length ? h('ul.arc-stats__modes', more.map(x => h('li', { dataset: { mode: x.g.mode.id } },
          h('small', { text: x.g.mode.label }), h('b', { text: withUnit(x.g, x.tops[0].s) }), h('small', { text: day(x.tops[0].at) || '' })))) : null),
      anyVs ? h('td', { dataset: { k: 'vs' } }, vs.length
        ? h('ol.arc-stats__tops', vs.map(v => h('li', { dataset: { key: v.key }, title: tr('{w} won, {l} lost, {d} drawn', { w: v.w, l: v.l, d: v.d }) },
          h('b', { text: `${v.w}–${v.l}–${v.d}` }), h('small', { text: v.label || v.key }))))
        : h('span.arc-stats__none', { text: '—' })) : null))));
  const note = h('div.arc-stats__note', { text: tr('Rounds count whenever a game ends, also with two players or online. Best scores come only from 1-player rounds at full speed. Rounds from before this update weren’t counted, so an older best can stand alone.') });
  return h('div.arc-stats', head, summary, h('div.arc-stats__wrap', table), note);
}

export default { statsView, playTime };
