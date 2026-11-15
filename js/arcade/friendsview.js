/* ============================================================
   arcade/friendsview.js — the Arcade's Friends tab: leaderboards
   among friends, this week's challenge among friends, and cups.
   The data and the messages are js/arcade/friendplay.js; this is the
   face. Everything shown is either this device's own score or a score
   a friend chose to send — the tab says which, and when it came.

   Head to head: online matches finished on this device against each
   friend (records.js h2h — only when the room recognised them as a
   friend, see room.js), by game.

   friendsView({ h, icon, api, ARCADE, getBest, withUnit, ago, weekly,
                 weeklyMine, onPlay(id, round), focusCup }) -> { el, destroy() }
   ============================================================ */
import * as FP from './friendplay.js';
import { bus } from '../core/bus.js';
import { h2hAll } from './records.js';
import { t as tr, plural as plu } from '../core/i18n.js';

const listOf = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function friendsView({ h, icon, api, ARCADE, getBest, withUnit, ago, weekly, weeklyMine, onPlay, focusCup = null }) {
  const offs = [];
  let F = null, dead = false;
  const el = h('div.arc-fr', { dataset: { state: 'loading' } }, h('div.arc-load', h('i.arc-spin'), h('span', { text: tr('Opening Friends…') })));
  const byId = id => ARCADE.find(g => g.id === id) || null;
  const seededGames = ARCADE.filter(g => g.seeded);
  const st = { game: null, form: null, msg: '' };

  const say = (box, text, err = false) => { box.textContent = text; box.classList.toggle('is-err', !!err); };
  const nameOf = (fp, cup) => {
    if (fp === F.myFp()) return 'You';
    const f = F.friends().find(x => x.fp === fp);
    if (f) return f.display;
    const host = cup ? F.friends().find(x => x.fp === cup.host) : null;
    return host ? tr('A friend of {name}', { name: host.display }) : tr('A friend of a friend');
  };

  /* ---------------- leaderboards ---------------- */
  const boardBox = h('div.arc-fr__board');
  const boardStatus = h('div.arc-fr__status', { role: 'status', 'aria-live': 'polite' });
  function paintBoard() {
    const friends = F.friends();
    const mineIds = ARCADE.filter(g => getBest(g.id) !== null).map(g => g.id);
    const ids = [...new Set([...mineIds, ...FP.boardGames(friends)])];
    if (!st.game || !ids.includes(st.game)) st.game = ids[0] || null;
    boardBox.replaceChildren();
    if (!ids.length) {
      boardBox.append(h('div.arc-empty.arc-empty--sm', icon('star'), h('b', { text: tr('No scores to compare yet') }),
        h('small', { text: tr('Play a game for a best score, then share it here. Friends’ scores show up when they share theirs.') })));
      return;
    }
    const sel = h('select.arc-fr__pick', { 'aria-label': tr('Leaderboard for'), dataset: { k: 'boardgame' }, onchange: () => { st.game = sel.value; paintBoard(); } },
      ids.map(id => byId(id)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title)).map(g => h('option', { value: g.id, text: g.title })));
    sel.value = st.game;
    const g = byId(st.game);
    const mine = getBest(g.id);
    const sharedMine = FP.shared()[g.id];
    const rows = FP.board(g.id, friends).map(r => ({ ...r, me: false }));
    if (mine !== null) rows.push({ fp: F.myFp(), name: 'You', s: mine, at: sharedMine?.at || 0, me: true });
    const better = (a, b) => (g.better === 'low' ? a < b : a > b);
    rows.sort((a, b) => (better(a.s, b.s) ? -1 : better(b.s, a.s) ? 1 : 0));
    const list = h('ol.arc-fr__rows', { 'aria-label': tr('{title}: friends’ shared scores', { title: g.title }) }, rows.map((r, i) => h('li.arc-fr__row', { class: r.me ? 'is-me' : '', dataset: { fp: r.fp, score: String(r.s) } },
      h('span.arc-fr__rank', { text: String(i + 1) }),
      h('span.arc-fr__who', { style: r.hue !== undefined ? { '--fh': r.hue } : null, text: r.name }),
      h('b.arc-fr__score', { text: withUnit(g, r.s) }),
      h('small.arc-fr__when', { text: r.me ? (sharedMine && sharedMine.s === mine ? tr('shared {when}', { when: ago(sharedMine.at) }) : sharedMine ? tr('a better one isn’t shared yet') : tr('only on this device')) : tr('shared {when}', { when: ago(r.at) }) }))));
    const share = h('button.btn.btn--sm', { type: 'button', dataset: { act: 'share' }, disabled: mine === null || (sharedMine && sharedMine.s === mine),
      onclick: async () => { const r = await FP.shareBests([[g.id, mine]]); report(r, tr('your {title} best', { title: g.title })); paintBoard(); } }, icon('send'), h('span', { text: tr('Share my best') }));
    const stop = sharedMine ? h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { act: 'unshare' },
      onclick: async () => { const r = await FP.withdraw(g.id); say(boardStatus, r.unavailable ? 'Friends aren’t available here.' : `Asked ${r.total === 1 ? 'your friend’s device' : `${r.total} friends’ devices`} to remove your ${g.title} score.`); paintBoard(); } },
    icon('x'), h('span', { text: tr('Stop sharing') })) : null;
    boardBox.append(h('div.arc-fr__boardhead', h('label.arc-fr__lab', { text: tr('Game') }), sel, share, stop), list,
      g.better === 'low' ? h('div.arc-fr__fine', { text: tr('Lower is better in this game.') }) : null);
  }
  function report(r, what) {
    if (r.unavailable) say(boardStatus, tr('Friends need your own profile — a guest has none.'), true);
    else if (!r.total) say(boardStatus, tr('You have no friends to send it to yet.'), true);
    else say(boardStatus, (r.sent < r.total ? tr('Sent {what} to {friends} ({n} will get it when the live connection is back).', { what, friends: plu(r.total, '{n} friend', '{n} friends'), n: r.total - r.sent }) : tr('Sent {what} to {friends}.', { what, friends: plu(r.total, '{n} friend', '{n} friends') })));
  }
  const shareAll = h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { act: 'shareall' }, onclick: async () => {
    const list = ARCADE.map(g => [g.id, getBest(g.id)]).filter(e => e[1] !== null);
    const r = await FP.shareBests(list);
    if (r.empty) { say(boardStatus, 'You have no best scores to share yet.'); return; }
    report(r, plu(list.length, '{n} best score', '{n} best scores'));
    paintBoard();
  } }, icon('users'), h('span', { text: tr('Share all my bests') }));

  /* ---------------- this week ---------------- */
  const weekBox = h('div.arc-fr__week');
  function paintWeek() {
    weekBox.replaceChildren();
    const W = weekly();
    const g = byId(W.game);
    if (!g) return;
    const mine = weeklyMine(W.week);
    const rows = FP.weeklyBoard(W.week, g.id, F.friends()).map(r => ({ ...r, me: false }));
    if (mine && mine.best !== null) rows.push({ fp: F.myFp(), name: 'You', s: mine.best, at: mine.at, me: true });
    const better = (a, b) => (g.better === 'low' ? a < b : a > b);
    rows.sort((a, b) => (better(a.s, b.s) ? -1 : better(b.s, a.s) ? 1 : 0));
    const sentWeek = FP.shared()[`week:${W.week}`];
    const shareWk = h('button.btn.btn--sm', { type: 'button', dataset: { act: 'shareweek' }, disabled: !mine || mine.best === null || (sentWeek && sentWeek.s === mine.best),
      onclick: async () => { const r = await FP.shareWeekly(W.week, g.id, mine.best); report(r, tr('your weekly best')); paintWeek(); } }, icon('send'), h('span', { text: tr('Share my week') }));
    weekBox.append(
      h('div.arc-fr__boardhead', h('b', { text: `${g.title} · ${W.week}` }),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { act: 'playweek' }, onclick: () => onPlay(g.id, { seed: W.seed, shared: true, weekly: W }) }, icon('play', { fill: true }), h('span', { text: tr('Play') })), shareWk),
      rows.length ? h('ol.arc-fr__rows', { 'aria-label': tr('This week’s challenge among friends') }, rows.map((r, i) => h('li.arc-fr__row', { class: r.me ? 'is-me' : '', dataset: { fp: r.fp, score: String(r.s) } },
        h('span.arc-fr__rank', { text: String(i + 1) }), h('span.arc-fr__who', { text: r.name }), h('b.arc-fr__score', { text: withUnit(g, r.s) }),
        h('small.arc-fr__when', { text: r.me ? (sentWeek && sentWeek.s === r.s ? tr('shared') : tr('only on this device')) : tr('shared {when}', { when: ago(r.at) }) }))))
        : h('div.arc-fr__fine', { text: tr('Nobody’s result this week yet. Everyone who plays it this week gets the same course.') }));
  }

  /* ---------------- cups ---------------- */
  const cupsBox = h('div.arc-fr__cups');
  const formBox = h('div.arc-fr__formbox');
  const cupStatus = h('div.arc-fr__status', { role: 'status', 'aria-live': 'polite' });
  function paintCups() {
    cupsBox.replaceChildren();
    const me = F.myFp();
    const list = FP.cups();
    if (!list.length) { cupsBox.append(h('div.arc-fr__fine', { text: tr('No cups yet. Start one with 3 or 7 friends: everyone plays the same seeded course, one round a match, and the better score goes through.') })); return; }
    for (const c of list) {
      const g = byId(c.game);
      if (!g) continue;
      const state = FP.myState(c, me);
      const mm = FP.myMatch(c, me);
      const champ = FP.champion(c);
      const isHost = c.host === me;
      const title = c.title || `${g.title} cup`;
      const head = h('div.arc-cup__head',
        h('div', h('b.arc-cup__title', { text: title }),
          h('small', { text: (isHost ? tr('{title} · {n} players · you host it', { title: g.title, n: c.players.length }) : tr('{title} · {n} players · hosted by {host}', { title: g.title, n: c.players.length, host: nameOf(c.host, c) })) })),
        h('span.arc-cup__state', { dataset: { state }, text: { play: tr('Your match is ready'), wait: tr('Waiting for others'), out: tr('You’re out'), won: tr('You won the cup!'), over: tr('{name} won', { name: nameOf(champ, c) }), off: tr('Called off') }[state] }));
      const rounds = FP.bracket(c);
      const rname = (r, n) => (r === n - 1 ? tr('Final') : r === n - 2 ? tr('Semi-finals') : tr('Quarter-finals'));
      const bracket = h('div.arc-cup__bracket', { role: 'list', 'aria-label': tr('{title} bracket', { title }) }, rounds.map((ms, r) => h('div.arc-cup__round', { role: 'listitem' },
        h('div.arc-cup__rname', { text: rname(r, rounds.length) }),
        ms.map(x => {
          const side = (fp, res, won) => h('div.arc-cup__side', { class: `${won ? 'is-won' : ''}${fp === me ? ' is-me' : ''}`, dataset: { fp: fp || '' } },
            h('span', { text: fp ? nameOf(fp, c) : tr('to be decided') }),
            h('b', { text: res ? withUnit(g, res.s) : x.res.wo && won ? tr('walkover') : fp && c.pend?.[`${x.r}.${x.m}`] !== undefined && fp === me ? tr('sent') : '—' }));
          const box = h('div.arc-cup__match', { dataset: { r: String(x.r), m: String(x.m), w: x.w || '' }, 'aria-label': tr('{round}: {a} against {b}', { round: rname(r, rounds.length), a: x.a ? nameOf(x.a, c) : tr('to be decided'), b: x.b ? nameOf(x.b, c) : tr('to be decided') }) + (x.w ? tr(', {name} went through', { name: nameOf(x.w, c) }) : '') },
            side(x.a, x.res.a, x.w && x.w === x.a), side(x.b, x.res.b, x.w && x.w === x.b));
          if (isHost && !x.w && x.a && x.b && !c.cancelled) {
            box.append(h('button.arc-cup__wo', { type: 'button', dataset: { act: 'walkover' }, 'aria-label': tr('Give a walkover'), title: tr('Give a walkover (when someone can’t play)'),
              onclick: e => {
                const rr = e.currentTarget.getBoundingClientRect();
                api.menu([{ header: true, label: tr('Walkover: who goes through?') },
                  { label: nameOf(x.a, c), onClick: () => FP.walkover(c.id, x.r, x.m, 'a') },
                  { label: nameOf(x.b, c), onClick: () => FP.walkover(c.id, x.r, x.m, 'b') }], rr.left, rr.bottom + 4);
              } }, icon('more-horizontal')));
          }
          return box;
        }))));
      const acts = [];
      if (mm) {
        const opp = nameOf(mm.opp, c);
        acts.push(h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { act: 'playcup', cup: c.id }, onclick: () => onPlay(g.id, {
          seed: mm.seed, shared: true, offer: true,
          cup: { id: c.id, title: tr('{round} vs {opp}', { round: rname(mm.r, rounds.length), opp }), chip: tr('Cup · vs {opp}', { opp }),
            text: tr(g.better === 'low' ? 'One round of {title} on the cup’s course; {opp} gets the same one. Your first finished round is your score, the lower score goes through, and a tie goes to whoever finished first.' : 'One round of {title} on the cup’s course; {opp} gets the same one. Your first finished round is your score, the higher score goes through, and a tie goes to whoever finished first.', { title: g.title, opp }) },
        }) }, icon('play', { fill: true }), h('span', { text: tr('Play your match vs {opp}', { opp }) })));
      }
      if (isHost && !c.cancelled && !champ) acts.push(h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { act: 'cancelcup' }, onclick: async () => {
        const ok = await api.confirm({ title: tr('Call off this cup?'), message: tr('{title}. Everyone in it is told it’s off.', { title }), ok: 'Call it off', danger: true });
        if (ok) FP.cancelCup(c.id);
      } }, icon('x'), h('span', { text: tr('Call off') })));
      if (c.cancelled || champ) acts.push(h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { act: 'forgetcup' }, onclick: () => FP.forgetCup(c.id) }, icon('trash'), h('span', { text: tr('Remove') })));
      cupsBox.append(h('article.arc-cup', { style: { '--h': g.hue }, dataset: { cup: c.id, state } }, head, bracket, acts.length ? h('div.arc-card__row.arc-cup__acts', acts) : null));
    }
  }
  function openForm() {
    const friends = F.friends();
    st.form = { game: seededGames[0]?.id, size: 4, pick: new Set(), title: '' };
    const fm = st.form;
    const err = h('div.arc-fr__status', { role: 'status', 'aria-live': 'polite' });
    const count = h('span.arc-cupf__count');
    const need = () => fm.size - 1;
    const paintCount = () => { count.textContent = `${fm.pick.size} of ${need()} friends picked`; startBtn.disabled = fm.pick.size !== need(); };
    const gameSel = h('select', { dataset: { k: 'cupgame' }, 'aria-label': tr('Game'), onchange: () => { fm.game = gameSel.value; } },
      seededGames.map(g => h('option', { value: g.id, text: g.title })));
    const sizes = h('div.arc-seg', { role: 'radiogroup', 'aria-label': tr('Players') }, FP.SIZES.map(n => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(n === fm.size), class: n === fm.size ? 'is-on' : '', dataset: { size: String(n) },
        onclick: () => { fm.size = n; for (const x of sizes.children) { const on = Number(x.dataset.size) === n; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); } paintCount(); } },
      h('span', { text: tr('{n} players', { n }) }));
      return b;
    }));
    const titleIn = h('input.arc-net__input', { type: 'text', maxlength: '40', placeholder: tr('A name (optional)'), 'aria-label': tr('Cup name'), oninput: () => { fm.title = titleIn.value; } });
    const picks = h('ul.arc-cupf__picks', { 'aria-label': tr('Friends in the cup') }, friends.map(f => {
      const cb = h('input', { type: 'checkbox', dataset: { fp: f.fp }, onchange: () => { if (cb.checked) fm.pick.add(f.fp); else fm.pick.delete(f.fp); paintCount(); } });
      return h('li', h('label.arc-cupf__pick', cb, h('span', { text: f.display }), h('small', { text: f.presence === 'offline' ? tr('offline') : tr(f.presence) })));
    }));
    const startBtn = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'startcup' }, onclick: async () => {
      startBtn.disabled = true;
      const r = await FP.createCup({ game: fm.game, fps: [...fm.pick], title: fm.title });
      if (!r.ok) { say(err, r.error === 'size' ? `Pick exactly ${need()} friends.` : r.error === 'guest' ? 'Friends need your own profile.' : 'That cup couldn’t start.', true); startBtn.disabled = false; return; }
      st.form = null;
      formBox.replaceChildren();
      say(cupStatus, `Cup started: ${listOf([...r.cup.players].filter(x => x !== F.myFp()).map(x => nameOf(x, r.cup)))} were sent the bracket.`);
      paintCups();
    } }, icon('play', { fill: true }), h('span', { text: tr('Start the cup') }));
    const cancel = h('button.btn.btn--ghost', { type: 'button', onclick: () => { st.form = null; formBox.replaceChildren(); newBtn.focus(); } }, h('span', { text: tr('Cancel') }));
    paintCount();
    formBox.replaceChildren(h('div.arc-cupf', { role: 'group', 'aria-label': tr('New cup') },
      h('div.arc-cupf__row', h('label.arc-fr__lab', { text: tr('Game') }), gameSel, sizes),
      h('div.arc-cupf__row', titleIn),
      friends.length >= 3 ? picks : h('div.arc-fr__fine', { text: tr('You need at least 3 friends for a cup — you have {length}. Add friends with their code in Static Social.', { length: friends.length }) }),
      h('div.arc-cupf__row', count),
      h('div.arc-card__row', startBtn, cancel), err,
      h('div.arc-fr__fine', { text: tr('Each friend gets the bracket on their own Arcade and plays their match whenever they like; you, as host, keep the scores and send everyone the bracket.') })));
    setTimeout(() => gameSel.focus(), 20);
  }
  const newBtn = h('button.btn.btn--sm', { type: 'button', dataset: { act: 'newcup' }, onclick: () => openForm() }, icon('plus'), h('span', { text: tr('New cup') }));

  /* ---------------- head to head ---------------- */
  const h2hBox = h('div.arc-fr__h2h', { dataset: { k: 'h2hlist' } });
  function paintH2H() {
    const mine = new Map(F.friends().map(f => [f.fp, f]));
    const rows = h2hAll().filter(e => mine.has(e.fp));
    const wld = e => `${e.w} won · ${e.l} lost${e.d ? ` · ${e.d} drawn` : ''}`;
    h2hBox.replaceChildren(rows.length
      ? h('ul.arc-fr__rows', { 'aria-label': tr('Head to head against friends') }, rows.map(e => h('li.arc-fr__row.arc-fr__row--h2h', { dataset: { fp: e.fp, w: String(e.w), l: String(e.l), d: String(e.d) } },
        h('span.arc-fr__who', { text: mine.get(e.fp).display }),
        h('b.arc-fr__score', { text: wld(e) }),
        h('small.arc-fr__when', { text: Object.entries(e.games).map(([id, g]) => `${byId(id)?.title || id} ${g.w}–${g.l}${g.d ? `–${g.d}` : ''}`).join(' · ') }))))
      : h('div.arc-fr__fine', { text: tr('No online matches against a friend finished on this device yet. Play one from a game’s Online button; a match counts once it has a result.') }));
  }

  /* ---------------- the whole tab ---------------- */
  async function build() {
    F = await import('../core/friends.js');
    if (dead) return;
    if (!F.available()) {
      el.dataset.state = 'guest';
      el.replaceChildren(h('div.arc-empty', icon('users'), h('b', { text: tr('Friends need your own profile') }),
        h('small', { text: tr('A guest has no friends list, so there is nothing to compare here. Sign in to your own profile to play with friends.') })));
      return;
    }
    try { await F.ready(); } catch (e) { /* shown below */ }
    if (dead) return;
    el.dataset.state = 'ready';
    const friendsN = F.friends().length;
    el.replaceChildren(
      h('div.arc-clips__head',
        h('div.arc-clips__title', { text: tr('Play with friends') }),
        h('div.arc-clips__sub', { text: tr('Only your friends, over your private friend connections — no public leaderboard and no strangers. A friend’s score shows here only after they share it.') }),
        friendsN ? null : h('div.arc-note', icon('info'), h('span', { text: tr('You have no friends added yet. ') }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('social', { friends: true }) }, icon('users'), h('span', { text: tr('Add friends in Static Social') })))),
      h('section.arc-fr__sec', { 'aria-labelledby': 'arc-fr-lb' }, h('h3.arc-opts__h', { id: 'arc-fr-lb', text: tr('Leaderboards') }), boardBox, h('div.arc-card__row', shareAll), boardStatus),
      h('section.arc-fr__sec', { 'aria-labelledby': 'arc-fr-h2h' }, h('h3.arc-opts__h', { id: 'arc-fr-h2h', text: tr('Head to head') }), h2hBox),
      h('section.arc-fr__sec', { 'aria-labelledby': 'arc-fr-wk' }, h('h3.arc-opts__h', { id: 'arc-fr-wk', text: tr('This week’s challenge') }), weekBox),
      h('section.arc-fr__sec', { 'aria-labelledby': 'arc-fr-cups' }, h('div.arc-fr__secrow', h('h3.arc-opts__h', { id: 'arc-fr-cups', text: tr('Cups') }), newBtn), formBox, cupStatus, cupsBox));
    paintBoard(); paintWeek(); paintCups(); paintH2H();
    FP.refreshCups().catch(() => {});
    if (focusCup) setTimeout(() => el.querySelector(`[data-cup="${CSS.escape(focusCup)}"]`)?.scrollIntoView({ block: 'nearest' }), 50);
    /* repaint on new scores and brackets, and when the friends themselves change —
       not on every heartbeat — and put focus back on the control it was on */
    let t = 0;
    const later = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (dead || !F) return;
        const a = document.activeElement;
        const keep = a && el.contains(a) ? { act: a.dataset?.act, k: a.dataset?.k, cup: a.closest?.('[data-cup]')?.dataset.cup } : null;
        paintBoard(); paintWeek(); paintCups(); paintH2H();
        if (keep && (keep.act || keep.k)) {
          const scope = keep.cup ? el.querySelector(`[data-cup="${CSS.escape(keep.cup)}"]`) || el : el;
          scope.querySelector(keep.act ? `[data-act="${keep.act}"]` : `[data-k="${keep.k}"]`)?.focus({ preventScroll: true });
        }
      }, 120);
    };
    const sig = () => F.friends().map(f => f.fp + f.display).join('|');
    let last = sig();
    offs.push(bus.on('arcade:friends', later), F.onChange(() => { const s = sig(); if (s !== last) { last = s; later(); } }), () => clearTimeout(t));
  }
  build().catch(err => { console.error('[arcade] friends', err); el.replaceChildren(h('div.arc-note', icon('alert'), h('span', { text: tr('Friends could not open here.') }))); });
  return { el, destroy() { dead = true; offs.forEach(f => { try { f(); } catch (e) { /* gone */ } }); } };
}

export default { friendsView };
