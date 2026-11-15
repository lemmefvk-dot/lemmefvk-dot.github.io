/* ============================================================
   arcade/painter.js — Pixel Painter Duel for Static Arcade.

   A 12 × 12 board of coloured pixels and two painters in opposite
   corners. Pick a colour: your whole territory turns that colour and
   swallows every untouched pixel of it that touches your border.
   More than half the board wins the round (rules, and the computer,
   in ./painter-logic.js).

   · 1P: against the computer — Easy picks any colour that works,
     Medium takes the biggest bite, Hard also counts the best answer
     its pick gives you (the Mode menu; each level keeps its own best
     and its won–lost–drawn record). You are the bottom-left painter
     and move first. A win scores the pixels you ended with.
   · Online: a friend on another device, by room code (the Arcade's
     room, js/arcade/room.js). The room's seed deals the same board
     to both. The host moves first in odd rounds, the guest in even
     ones. Only the colour picked travels (./boardkit.js duelLink),
     and every arriving pick is checked against the board — whose
     turn, a colour that swallows something — before it is played.

   Controls
     mouse / touch  press a colour button
     keyboard       1 to 6 pick that colour · ← → move along the
                    colours and Space / Enter picks
   Every colour carries a shape as well as its colour; your pixels
   have a white edge, your rival's a dark one. The Arcade's
   colour-blind colours (ctx.palette 'cb') swap the colours.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { rng, ownsKey, sounder } from './kit.js';
import { CSS as BASE, reducedMotion, bag } from './puzzlekit.js';
import { duelLink } from './boardkit.js';
import { PALETTE_CB } from './index.js';
import { W, H, COLORS, LEVELS, newGame, play, options, gainOf, owned, think } from './painter-logic.js';

const PAL = ['#ff4d6d', '#3b9cff', '#2fd36b', '#ffd23f', '#c77dff', '#ff9a3c'];
const CB = [PALETTE_CB[5], PALETTE_CB[1], PALETTE_CB[2], PALETTE_CB[3], PALETTE_CB[6], PALETTE_CB[0]];
const SHAPES = ['●', '■', '▲', '◆', '★', '✚'];
const NAMES = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
const CB_NAMES = ['vermilion', 'sky blue', 'green', 'yellow', 'pink', 'orange'];

const CSS = `${BASE}
.pz-pp__bw{position:relative;flex:1 1 auto;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-pp__board{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(${W},1fr);grid-template-rows:repeat(${H},1fr);gap:2px;padding:4px;border-radius:12px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22))}
.pz-pp__p{display:grid;place-items:center;border-radius:4px;font:800 clamp(7px,3.2cqmin,16px)/1 var(--font,system-ui);color:rgba(0,0,0,.4);transition:background .18s}
.pz-pp__p.is-me{box-shadow:inset 0 0 0 2px #fff}
.pz-pp__p.is-them{box-shadow:inset 0 0 0 3px #0a0a10}
.pz.is-reduced .pz-pp__p{transition:none}
.pz-pp__pal{width:min(100%,520px);display:flex;gap:8px;justify-content:center;flex-wrap:wrap;flex:0 0 auto}
.pz-pp__pal button{display:grid;place-items:center;gap:2px;min-width:56px;padding:8px 6px 6px;border-radius:11px;border:2px solid transparent;font:800 18px/1 var(--font,system-ui);color:rgba(0,0,0,.6);cursor:pointer}
.pz-pp__pal button small{font:700 10px/1 var(--font,system-ui);color:rgba(0,0,0,.65)}
.pz-pp__pal button:disabled{opacity:.28;cursor:default}
.pz-pp__pal button.is-cur{border-color:#fff}
.pz-pp__pal button:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.pz-pp__sc{display:flex;gap:10px;align-items:center}
.pz-pp__sc .pz__read.is-turn{border-color:var(--ga);box-shadow:0 0 0 1px var(--ga)}
.pz-pp__card{pointer-events:none;position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.82);border-radius:12px;text-align:center;padding:16px}
.pz-pp__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-pp__card span{font-size:13px;color:var(--ink-2,#bbb)}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const level = NET ? 'medium' : LEVELS.includes(ctx.mode) ? ctx.mode : 'medium';
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    /* 1 = the bottom-left painter, who moves first */
    const me = NET ? ((round % 2 === 1) === host ? 1 : 2) : 1;
    const seed = NET ? NET.seed >>> 0 : Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (rng(Date.now() >>> 0)() * 2 ** 32) >>> 0;
    const rand = rng(seed ^ 0x9e3779b9);
    const g = newGame(seed);
    let dead = false, paused = false, thinking = false, ended = false, rejected = 0, thinkT = 0, endT = 0, cur = 0, msg = '';
    const by = [];                                        /* 'me' | 'them' for every pick */
    const cb = () => ctx.palette === 'cb';
    const nameOf = p => (p === me ? 'You' : NET ? peerName : 'The computer');

    const mineV = h('span', { text: '1' });
    const theirV = h('span', { text: '1' });
    const mineR = h('div.pz__read', { title: 'Your pixels' }, icon('user'), mineV);
    const theirR = h('div.pz__read', { title: NET ? `${peerName}'s pixels` : 'The computer’s pixels' }, icon(NET ? 'users' : 'cpu'), theirV);
    const resign = h('button.pz__btn', { type: 'button', dataset: { act: 'resign' }, title: 'Give up this round' }, icon('x'), h('span.pz__long', { text: 'Resign' }));
    const top = h('div.pz__top.pz-pp__sc', mineR, theirR, resign);
    const pix = Array.from({ length: W * H }, () => h('div.pz-pp__p'));
    const board = h('div.pz-pp__board', { role: 'img', 'aria-label': 'Pixel Painter board' }, ...pix);
    const bw = h('div.pz-pp__bw', board);
    const btns = Array.from({ length: COLORS }, (_, c) => h('button', { type: 'button', dataset: { c }, onclick: () => choose(c) }));
    const pal = h('div.pz-pp__pal', { role: 'group', 'aria-label': 'Colours' }, ...btns);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, bw, pal, foot, live);
    el.appendChild(root);

    const say = (m, tell = true) => { msg = m; if (tell) { live.textContent = ''; live.textContent = m; } paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'pick a colour: your whole territory turns it and swallows the pixels of that colour beside it · <kbd>1</kbd>–<kbd>6</kbd>' }));
    const myTurn = () => !g.over && g.turn === me && !thinking;
    const nameC = c => (cb() ? CB_NAMES : NAMES)[c];

    function paint() {
      const P = cb() ? CB : PAL;
      pix.forEach((p, i) => {
        const c = g.col[i];
        p.style.background = P[c];
        p.textContent = SHAPES[c];
        p.classList.toggle('is-me', g.own[i] === me);
        p.classList.toggle('is-them', g.own[i] === 3 - me);
      });
      const a = owned(g, me), b = owned(g, 3 - me);
      mineV.textContent = String(a); theirV.textContent = String(b);
      mineR.classList.toggle('is-turn', !g.over && g.turn === me);
      theirR.classList.toggle('is-turn', !g.over && g.turn !== me);
      const can = myTurn();
      btns.forEach((b2, c) => {
        const n = gainOf(g, me, c);
        b2.style.background = P[c];
        b2.replaceChildren(SHAPES[c], h('small', { text: String(c + 1) }));
        b2.disabled = !can || n === 0;
        b2.classList.toggle('is-cur', c === cur);
        const why = c === g.colour[me] ? 'your own colour' : c === g.colour[3 - me] ? `${nameOf(3 - me)}'s colour` : n === 0 ? 'nothing beside your territory is this colour' : '';
        b2.title = `${nameC(c)}${n ? `: swallows ${n}` : why ? ` (${why})` : ''}`;
        b2.setAttribute('aria-label', `${nameC(c)}, ${n ? `swallows ${n} pixel${n === 1 ? '' : 's'}` : `not available: ${why}`}`);
      });
      board.setAttribute('aria-label', `Pixel Painter board. You have ${a} pixels, ${nameOf(3 - me).toLowerCase()} has ${b}. ${g.over ? 'The round is over.' : g.turn === me ? 'Your turn.' : 'Their turn.'}`);
      resign.disabled = !!g.over || ended;
    }

    const link = NET ? duelLink(NET, {
      plies: () => g.moves.length,
      mine: i => by[i] === 'me',
      wire: i => ({ c: g.moves[i] }),
      take: d => {
        if (g.over || g.turn === me || !Number.isInteger(d.c) || !gainOf(g, 3 - me, d.c)) return false;
        apply(3 - me, d.c, 'them');
        return true;
      },
      reject: () => { rejected++; },
      resigned: () => {
        if (g.over) return;
        g.over = { winner: me, reason: 'resign', a: 0, b: 0 };
        say(`${peerName} resigned.`);
        paint(); finishSoon();
      },
      dead: () => dead,
    }) : null;

    function apply(p, c, who) {
      const r = play(g, p, c);
      if (!r.ok) return false;
      by.push(who);
      snd.wake(); snd.blip(300 + c * 60, 0.07, 'triangle', 0.8, 420 + c * 60);
      const t = `${nameOf(p)} painted ${nameC(c)} and swallowed ${r.gained}.`;
      let extra = '';
      if (!g.over && g.turn === p) extra = ` ${nameOf(3 - p)} had no colour to pick, so ${nameOf(p)} goes again.`;
      say(t + extra, who !== 'me');
      if (who !== 'me') ctx.announce?.(t);
      onScore(owned(g, me));
      NET?.peerScore?.(owned(g, 3 - me));
      paint();
      if (g.over) finishSoon(); else if (!NET && g.turn !== me) computerTurn();
      return true;
    }

    function choose(c) {
      if (dead || paused || !myTurn()) return false;
      if (!gainOf(g, me, c)) { snd.blip(150, 0.07, 'sawtooth', 0.4); say(`${nameC(c)} swallows nothing: pick a colour that touches your territory.`); return false; }
      apply(me, c, 'me');
      link?.sendMove(g.moves.length - 1);
      return true;
    }

    function computerTurn() {
      if (thinking || g.over || g.turn === me) return;
      thinking = true; paint();
      clearTimeout(thinkT);
      thinkT = setTimeout(() => {
        thinking = false;
        if (dead || g.over) return;
        if (paused) { computerTurn(); return; }
        const c = think(g, 3 - me, level, rand);
        if (c < 0 || !apply(3 - me, c, 'them')) { paint(); }
      }, reduced ? 120 : 520);
    }

    function resignNow() {
      if (g.over || dead) return;
      clearTimeout(thinkT); thinking = false;
      g.over = { winner: 3 - me, reason: 'resign', a: 0, b: 0 };
      link?.resign();
      say('You resigned.');
      paint(); finishSoon();
    }
    let armed = 0;
    L.on(resign, 'click', () => {
      if (armed) { clearTimeout(armed); armed = 0; resign.lastChild.textContent = 'Resign'; resignNow(); return; }
      resign.lastChild.textContent = 'Sure?';
      armed = setTimeout(() => { armed = 0; resign.lastChild.textContent = 'Resign'; }, 3000);
    });

    function finishSoon() { clearTimeout(endT); endT = setTimeout(finish, reduced ? 200 : 900); }
    function finish() {
      if (ended || dead || !g.over) return;
      ended = true;
      paint();
      const o = g.over, a = owned(g, me), b = owned(g, 3 - me);
      const won = o.winner === 0 ? null : o.winner === me;
      const why = o.reason === 'resign' ? (o.winner === me ? `${nameOf(3 - me)} resigned.` : 'You resigned.')
        : o.reason === 'half' ? `More than half the board: ${a} to ${b}.` : `No colours left to pick: ${a} to ${b}.`;
      const text = (won === null ? 'A draw. ' : won ? 'You win. ' : `${nameOf(3 - me)} wins. `) + why;
      bw.appendChild(h('div.pz-pp__card', h('div', h('b', { text: won === null ? 'A draw' : won ? 'You win!' : `${nameOf(3 - me)} wins` }), h('span', { text: why }))));
      if (NET) { onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail: text }); return; }
      const result = won === null ? 'draw' : won ? 'win' : 'loss';
      onEnd({ score: won ? a : null, won: !!won, detail: `${text} Against the computer (${level}).`, vs: { key: level, label: `Pixel Painter · ${level[0].toUpperCase()}${level.slice(1)}`, result } });
    }

    /* keyboard */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      if (/^Digit[1-6]$/.test(e.code) || /^Numpad[1-6]$/.test(e.code)) { e.preventDefault(); cur = Number(e.code.slice(-1)) - 1; paint(); choose(cur); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        cur = (cur + (e.code === 'ArrowLeft' ? COLORS - 1 : 1)) % COLORS; paint();
        btns[cur].focus({ preventScroll: true });
      } else if (e.code === 'Space' && !(e.target?.closest?.('button'))) { e.preventDefault(); if (!e.repeat) choose(cur); }
    });

    paint(); paintFoot(); onScore(owned(g, me));
    NET?.peerScore?.(owned(g, 3 - me));
    if (!NET && g.turn !== me) computerTurn();
    say(NET ? `${me === 1 ? 'You move first' : `${peerName} moves first`}. You are the ${me === 1 ? 'bottom-left' : 'top-right'} painter.` : `You are the bottom-left painter, against the computer (${level}).`, false);

    return {
      stop() { if (dead) return; dead = true; clearTimeout(thinkT); clearTimeout(endT); clearTimeout(armed); link?.stop(); L.clear(); snd.close(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; if (!g.over) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); paint(); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); paint(); },
      peek: () => ({
        seed, level, me, turn: g.turn, col: g.col.slice(), own: g.own.slice(), colour: g.colour.slice(), moves: g.moves.slice(), by: by.slice(),
        mine: owned(g, me), theirs: owned(g, 3 - me), over: g.over ? { ...g.over } : null, thinking, paused, rejected, ended,
        options: options(g, me), online: NET ? { role: NET.role, round } : null,
        enabled: btns.map(b => !b.disabled), palette: cb() ? 'cb' : 'standard',
      }),
      /* test hook — nothing in the game calls it: skip() lets the computer move now */
      hook(cmd) { if (cmd === 'skip' && thinking) { clearTimeout(thinkT); thinkT = setTimeout(() => {}, 0); thinking = false; const c = think(g, 3 - me, level, rand); if (c >= 0) apply(3 - me, c, 'them'); return true; } return false; },
    };
  },
};
