/* ============================================================
   arcade/watchui.js — the screens for spectating (./spectate.js).

     sharer({ notify, linkFor }) -> { btn, panel, setSource(fn), sync(game), stop(), active() }
        The player's side: a "Let friends watch" button and the panel
        under the toolbar. Nothing is shared until "Start sharing" is
        pressed. The panel says who is watching (count and names), and
        that it runs over a free public server.
     watcherView({ code, onLeave }) -> { el, stop() }
        The friend's side: the game, read-only, with who is watching.
        Pure DOM, no listeners on the board — nothing here can send a move.
   ============================================================ */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { arcadeById } from './index.js';
import { openBroadcast, openWatcher, MAX_WATCHERS } from './spectate.js';
import { spaced } from '../core/roomcode.js';

const CSS = `
.arc-spec{display:none;margin:0 var(--sp-5,16px) var(--sp-3,8px);padding:12px 14px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-1);font-size:var(--fs-13,13px);color:var(--ink-1)}
.arc-spec.is-open{display:block}
.arc-spec__row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.arc-spec__code{font:700 22px/1 var(--mono,ui-monospace,monospace);letter-spacing:.18em;color:var(--ink-0);padding:6px 10px;border-radius:8px;background:var(--fill-0);border:1px solid var(--line-1)}
.arc-spec__count{font-weight:700;color:var(--ink-0)}
.arc-spec__note{margin-top:8px;font-size:var(--fs-11,11px);line-height:1.5;color:var(--ink-3)}
.arc-ib.is-sharing{color:#7dffb0;border-color:rgba(125,255,176,.5)}
.arc-wv{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px 16px;overflow:auto;font-family:var(--font,system-ui);color:var(--ink-1)}
.arc-wv[hidden]{display:none}
.arc-wv__top{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.arc-wv__title{font-weight:700;font-size:var(--fs-15,15px);color:var(--ink-0);flex:1;min-width:0}
.arc-wv__who{font-size:var(--fs-13,13px)}
.arc-wv__who b{color:var(--ink-0)}
.arc-wv__stage{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.arc-wv__msg{padding:14px 16px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-1);max-width:460px;text-align:center}
.arc-wv__msg.is-err{border-color:rgba(255,110,130,.5);background:rgba(255,80,100,.12)}
.arc-wv__txt{font-weight:650;color:var(--ink-0);text-align:center}
.arc-wv__big{font:800 56px/1 var(--font,system-ui);color:var(--ink-0)}
.arc-wv__pl{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;font-size:var(--fs-13,13px)}
.arc-wv__pl span.is-turn{color:var(--ink-0);font-weight:700;text-decoration:underline}
.arc-wvb{display:grid;gap:0;width:min(88%,min(520px,62vh));user-select:none;-webkit-user-select:none;pointer-events:none;font-family:system-ui,sans-serif}
.arc-wvb>i{display:flex;align-items:center;justify-content:center;font-style:normal;aspect-ratio:1;line-height:1;overflow:hidden}
.arc-wvb--chess>i{font-size:min(5.6vw,38px)}
.arc-wvb--chess>i.l{background:#c9d4e8}.arc-wvb--chess>i.d{background:#5b78a8}
.arc-wvb--chess>i.w{color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,0 1px 3px #000}.arc-wvb--chess>i.k{color:#111;text-shadow:0 0 1px #fff}
.arc-wvb--c4{background:#2346e8;padding:2%;border-radius:12px}
.arc-wvb--c4>i::after,.arc-wvb--rev>i::after,.arc-wvb--chk>i::after{content:'';width:78%;height:78%;border-radius:50%;background:rgba(0,0,0,.35)}
.arc-wvb--c4>i.a::after{background:#ffd23f}.arc-wvb--c4>i.b::after{background:#ff4d6d}
.arc-wvb--rev>i{background:#1c7a45;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}
.arc-wvb--rev>i::after{background:transparent}.arc-wvb--rev>i.a::after{background:#111}.arc-wvb--rev>i.b::after{background:#f4f4f4}
.arc-wvb--go>i,.arc-wvb--gomoku>i{background:#c99a55;box-shadow:inset 0 0 0 1px rgba(60,35,10,.55)}
.arc-wvb--go>i::after,.arc-wvb--gomoku>i::after{content:'';width:82%;height:82%;border-radius:50%}
.arc-wvb--go>i.a::after,.arc-wvb--gomoku>i.a::after{background:#111}.arc-wvb--go>i.b::after,.arc-wvb--gomoku>i.b::after{background:#f4f4f4}
.arc-wvb--chk>i.l{background:#e4d2ac}.arc-wvb--chk>i.d{background:#6b4a37}
.arc-wvb--chk>i::after{background:transparent;width:70%;height:70%}.arc-wvb--chk>i.a::after{background:#ff4d5f}.arc-wvb--chk>i.b::after{background:#f1e6c8}
.arc-wvb--chk>i.k::before{content:'\\265B';position:absolute;color:#ffd84d;font-size:16px;z-index:1}
.arc-wvb--chk>i{position:relative}
.arc-wvb--ttt>i,.arc-wvb--uttt>i{border:1px solid rgba(160,200,255,.4);font-weight:800;font-size:min(9vw,56px)}
.arc-wvb--uttt>i{font-size:min(3.4vw,24px)}
.arc-wvb--ttt>i.a,.arc-wvb--uttt>i.a{color:#4dd2ff}.arc-wvb--ttt>i.b,.arc-wvb--uttt>i.b{color:#ff4d6d}
.arc-wvb--ttt>i.hl,.arc-wvb--uttt>i.hl{background:rgba(255,255,255,.2)}
.arc-wvb--uttt>i.s3{border-right:2px solid rgba(160,200,255,.9)}.arc-wvb--uttt>i.r3{border-bottom:2px solid rgba(160,200,255,.9)}
.arc-wvb--uttt>i.go{background:rgba(255,255,255,.12)}
.arc-wvb--dnb>i{aspect-ratio:auto}
.arc-wvb--dnb>i.dot::after{content:'';width:9px;height:9px;border-radius:50%;background:#e8eeff}
.arc-wvb--dnb>i.eh{height:100%}.arc-wvb--dnb>i.eh::after,.arc-wvb--dnb>i.ev::after{content:'';background:rgba(160,190,255,.14);border-radius:3px}
.arc-wvb--dnb>i.eh::after{width:100%;height:5px}.arc-wvb--dnb>i.ev::after{width:5px;height:100%}
.arc-wvb--dnb>i.on::after{background:rgba(215,228,255,.95)}
.arc-wvb--dnb>i.bx{aspect-ratio:1}.arc-wvb--dnb>i.a{background:rgba(77,210,255,.3)}.arc-wvb--dnb>i.b{background:rgba(255,77,109,.3)}
`;

const GLYPH = { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔', p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

/** a snapshot's board as read-only DOM (no handlers: it cannot be played) */
export function renderBoard(s) {
  const n = s.w, m = s.h;
  if (s.st === 'dnb') {
    const side = 2 * n + 1;
    const wrap = h('div.arc-wvb.arc-wvb--dnb', { role: 'img', 'aria-label': 'Dots and Boxes board', style: { gridTemplateColumns: Array.from({ length: side }, (_x, c) => (c % 2 ? '1fr' : '12px')).join(' '), gridTemplateRows: Array.from({ length: side }, (_x, r) => (r % 2 ? '1fr' : '12px')).join(' ') } });
    for (let i = 0; i < s.cells.length; i++) {
      const r = Math.floor(i / side), c = i % side, ch = s.cells[i];
      let cls = '';
      if (r % 2 === 0 && c % 2 === 0) cls = 'dot';
      else if (r % 2 === 0) cls = 'eh' + (ch === '-' ? ' on' : '');
      else if (c % 2 === 0) cls = 'ev' + (ch === '|' ? ' on' : '');
      else cls = 'bx' + (ch === '1' ? ' a' : ch === '2' ? ' b' : '');
      wrap.append(h('i', { class: cls }));
    }
    return wrap;
  }
  const wrap = h('div.arc-wvb', { class: `arc-wvb--${s.st}`, role: 'img', 'aria-label': `${s.st} board`, style: { gridTemplateColumns: `repeat(${n}, 1fr)` } });
  const hl = new Set(s.hl);
  for (let i = 0; i < s.cells.length; i++) {
    const ch = s.cells[i], r = Math.floor(i / n), c = i % n;
    const cls = [];
    let text = '';
    if (s.st === 'chess') { cls.push((r + c) % 2 ? 'd' : 'l'); if (GLYPH[ch]) { text = GLYPH[ch]; cls.push(ch === ch.toUpperCase() ? 'w' : 'k'); } }
    else if (s.st === 'c4') { if (ch === '1') cls.push('a'); else if (ch === '2') cls.push('b'); }
    else if (s.st === 'rev' || s.st === 'go' || s.st === 'gomoku') { if (ch === 'B') cls.push('a'); else if (ch === 'W') cls.push('b'); }
    else if (s.st === 'chk') { cls.push((r + c) % 2 ? 'd' : 'l'); if (ch === 'r' || ch === 'R') cls.push('a'); else if (ch === 'c' || ch === 'C') cls.push('b'); if (ch === 'R' || ch === 'C') cls.push('k'); }
    else { /* ttt, uttt */
      if (ch === 'X') { text = 'X'; cls.push('a'); } else if (ch === 'O') { text = 'O'; cls.push('b'); }
      if (s.st === 'uttt') {
        if (c % 3 === 2 && c < 8) cls.push('s3');
        if (r % 3 === 2 && r < 8) cls.push('r3');
        const sb = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        if (s.x && !s.over && (s.x.nx === -1 ? s.x.sub[sb] === '.' : s.x.nx === sb)) cls.push('go');
      }
      if (s.st === 'ttt' && hl.has(i)) cls.push('hl');
    }
    wrap.append(h('i', { class: cls.join(' '), text }));
  }
  return wrap;
}

const ERR = {
  invalid: ['That isn’t a watch code', 'Watch codes are 6 letters and numbers, like K7QM2X.'],
  nobody: ['Nobody is sharing that game', 'No game is being shared with that code right now. Check the code, and that your friend pressed “Start sharing”. A game that isn’t shared can’t be watched.'],
  full: ['That game has enough watchers', `At most ${MAX_WATCHERS} people can watch one game.`],
  secure: ['Can’t watch here', 'This browser can’t do the secure part of watching.'],
  quiet: ['Lost touch', 'Nothing has come from the player for a while. They may have left or lost their connection.'],
  ended: ['The player stopped sharing', 'This game isn’t being shared any more.'],
};

/* ---------------------------------------------------------- the friend's side */
export function watcherView({ code, onLeave }) {
  const W = openWatcher({ code });
  const titleEl = h('div.arc-wv__title', { text: 'Watching…' });
  const whoEl = h('div.arc-wv__who', { 'aria-live': 'polite' });
  const stageEl = h('div.arc-wv__stage', { 'aria-live': 'polite' });
  const leaveBtn = h('button.btn', { type: 'button', onclick: () => { stop(); onLeave?.(); } }, icon('chevron-left'), h('span', { text: 'Stop watching' }));
  const el = h('section.arc-wv', { 'aria-label': 'Watching a friend’s game' }, h('style', { text: CSS }),
    h('div.arc-wv__top', icon('eye'), titleEl, leaveBtn), whoEl, stageEl,
    h('div.arc-spec__note', { text: 'Watching runs over a free public server (StaticOS’s live connection). You see the game but can’t play or change anything. Names aren’t verified, and anyone with the code can watch.' }));
  let off = null, stopped = false;

  function paint() {
    if (stopped) return;
    const g = W.game ? arcadeById(W.game) : null;
    const snap = W.snap;
    clear(whoEl);
    if (W.phase === 'watching' || W.phase === 'ended') {
      const { count, names } = W.watchers;
      titleEl.textContent = `${W.host?.name || 'A friend'} is playing ${g ? g.title : 'a game'}`;
      whoEl.append(h('b.arc-spec__count', { text: `${count} watching` }), h('span', { text: names.length ? `: ${names.join(', ')}` : '' }));
    } else titleEl.textContent = W.error ? 'Can’t watch' : 'Watching…';
    clear(stageEl);
    if (W.phase === 'connecting' || W.phase === 'joining') {
      stageEl.append(h('div.arc-wv__msg', h('i.arc-spin'), h('span', { text: W.phase === 'connecting' ? ' Connecting…' : ` Looking for ${W.code}…` })));
      return;
    }
    if (W.phase === 'closed' && W.error && !snap) {
      const [t, x] = ERR[W.error] || ERR.nobody;
      stageEl.append(h('div.arc-wv__msg.is-err', { role: 'alert' }, h('b', { text: `${t}. ` }), h('span', { text: x })));
      return;
    }
    if (!snap) return;
    if (W.phase === 'ended' && W.error) { const [t, x] = ERR[W.error] || ERR.ended; stageEl.append(h('div.arc-wv__msg.is-err', { role: 'status' }, h('b', { text: `${t}. ` }), h('span', { text: x }))); }
    if (snap.k === 'board') {
      stageEl.append(h('div.arc-wv__txt', { text: snap.txt }));
      if (snap.pl.length) stageEl.append(h('div.arc-wv__pl', snap.pl.map((p, i) => h('span', { class: snap.turn === (i === 0 ? 1 : -1) ? 'is-turn' : '', text: `${p.n}${p.m ? ' · ' + p.m : ''}` }))));
      stageEl.append(renderBoard(snap));
    } else {
      stageEl.append(h('div.arc-wv__txt', { text: snap.st === 'over' ? 'Round over' : snap.st === 'paused' ? 'Paused' : 'Playing now' }),
        h('div.arc-wv__big', { text: snap.score === null ? '—' : snap.score.toLocaleString() }),
        h('div.arc-wv__txt', { text: snap.unit ? `${snap.unit} so far` : 'score so far' }),
        snap.txt ? h('div.arc-spec__note', { text: snap.txt }) : null);
    }
  }
  off = W.on(() => paint());
  paint();
  function stop() {
    if (stopped) return;
    try { off?.(); } catch (e) { /* gone */ }
    W.leave();
    stopped = true;
  }
  return { el, stop, W };
}

/* ---------------------------------------------------------- the player's side */
export function sharer({ notify, linkFor }) {
  let B = null, offB = null, poll = 0, source = null, gameId = null, open = false;
  const btn = h('button.arc-ib', { type: 'button', 'aria-expanded': 'false', 'aria-label': 'Let friends watch', title: 'Let friends watch this game live', onclick: () => { open = !open; paint(); } }, icon('eye'));
  btn.hidden = true;
  const panel = h('section.arc-spec', { 'aria-label': 'Let friends watch' }, h('style', { text: CSS }));
  const body = h('div.arc-spec__body');
  panel.append(body);

  function paint() {
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-sharing', !!B);
    panel.classList.toggle('is-open', open && !btn.hidden);
    clear(body);
    if (!open) return;
    const note = h('div.arc-spec__note', { text: `Watching runs over a free public server (StaticOS’s live connection). Watchers see this game but can’t play or change anything. Up to ${MAX_WATCHERS} can watch, anyone with the code can look, and names aren’t verified. Sharing stops when you leave this game.` });
    if (!B) {
      body.append(h('div.arc-spec__row', h('b', { text: 'Let friends watch this game live?' }),
        h('button.btn.btn--primary.arc-spec__start', { type: 'button', onclick: start }, icon('eye'), h('span', { text: 'Start sharing' }))), note);
      return;
    }
    const ws = B.watchers();
    body.append(
      h('div.arc-spec__row',
        h('span.arc-spec__code', { 'aria-label': `Watch code ${spaced(B.code)}`, dataset: { code: B.code }, text: B.code }),
        h('button.btn.btn--primary', { type: 'button', onclick: copy }, icon('copy'), h('span', { text: 'Copy watch link' })),
        h('button.btn.arc-spec__stop', { type: 'button', onclick: () => { stop(); } }, h('span', { text: 'Stop sharing' }))),
      h('div.arc-spec__row', { style: { marginTop: '8px' }, role: 'status', 'aria-live': 'polite' },
        h('span.arc-spec__count', { text: `${ws.length} watching` }),
        h('span.arc-spec__names', { text: ws.length ? ws.map(w => w.name).join(', ') : B.phase === 'open' ? 'Nobody yet — send them the code.' : 'Connecting…' })),
      note);
  }
  function start() {
    if (B || !gameId) return;
    B = openBroadcast({ game: gameId });
    offB = B.on(() => paint());
    push();
    poll = setInterval(push, 400);
    paint();
  }
  const push = () => { if (B && source) { const s = source(); if (s) B.update(s); } };
  async function copy() {
    if (!B) return;
    const link = linkFor(gameId, B.code);
    const text = `Watch my ${gameId} game live in Static Arcade — watch code ${B.code}${link ? ` · ${link}` : ''}`;
    try { await navigator.clipboard.writeText(text); notify({ icon: 'copy', title: 'Watch link copied', message: `Watch code ${B.code}.` }); }
    catch (err) { notify({ icon: 'info', title: `Watch code ${B.code}`, message: 'Copying was blocked here — read the code out to your friend.' }); }
  }
  function stop() {
    clearInterval(poll);
    try { offB?.(); } catch (e) { /* gone */ }
    B?.stop();
    B = offB = null;
    paint();
  }
  return {
    btn, panel,
    setSource(fn) { source = fn; },
    /* the game on screen (or null): sharing belongs to one game session, so a different game ends it */
    sync(id) {
      if (id !== gameId) { if (B) stop(); open = false; }
      gameId = id;
      btn.hidden = !id;
      paint();
    },
    stop() { stop(); open = false; gameId = null; btn.hidden = true; paint(); },
    active: () => !!B,
    code: () => B?.code || null,
    stats: () => (B ? B.stats() : null),
  };
}
