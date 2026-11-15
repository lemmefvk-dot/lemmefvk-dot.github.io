/* ============================================================
   arcade/dnb.js — Dots and Boxes for Static Arcade.

   Draw a line between two neighbouring dots. Close the fourth side of
   a box and it is yours — and you draw again. Most boxes wins. Boards
   from 3 × 3 to 6 × 6 boxes (rules and computer in ./dnb-rules.js).

   · 1P: against the computer (Easy, Medium, Hard — Hard is
     chain-aware and solves the last 17 lines exactly), you or the
     computer first. Size, level, first and the board's look are
     remembered in portal.arcadeDnb. The search runs in a Web Worker.
     Undo takes back your turn (every line since your last one began).
     Hint asks Hard for your line and marks it; a game with a hint
     never sets a best. Your won / lost / drawn record against each
     size and level is under the Level row (./records.js; games played
     to the end, resigning counts as lost, a game counts at the easiest
     level it was played at).
   · 2P: Blue and Pink take turns on one screen (Hint works too).
   · Online: a friend on another device through the Arcade's room.
     The host draws first in odd rounds, the guest in even ones; on
     your screen you are always blue. Every arriving line is checked
     (whose turn, an undrawn line) before it reaches the board.

   Near the end — three safe lines left or fewer (a safe line gives no
   box away) — a line in the panel counts the long chains (3+ boxes)
   and loops, and says what Berlekamp's long-chain rule wants for you
   (dnb-rules.js chainInfo). It is a rule of thumb, said as one; the
   Board card turns it off. Dots are named by column letter and row
   number (a1 is the top-left dot), shown with Coordinates and used
   when a line is read out.

   Mouse or touch: click or tap near a line. Keyboard: arrow keys move
   to the nearest undrawn line in that direction, Enter / Space draw
   it, H hint, U / Z / Backspace undo.
   Score in 1P: the boxes you took when you win (more is better).
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as D from './dnb-rules.js';
import { thinker } from './thinker.js';
import * as records from './records.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink, boardOptions, lookOf, recordLine } from './boardkit.js';

const PREF = 'portal.arcadeDnb';
const BLUE = '#4dd2ff', PINK = '#ff4d6d';
const MIN_THINK_MS = 380;
/* a chain hint shows from this many safe lines left */
const NEAR = 3;
/* the board's four looks (boardkit's BOARD_THEMES); 'arcade' is the original */
const LOOKS = {
  arcade: { bg: '#05060d', glow: 'hsla(260,80%,45%,.16)', dot: '#e8eeff', line: 'rgba(210,225,255,.92)', last: '#ffffff', open: 'rgba(160,190,255,.14)', three: 'rgba(255,255,255,.07)', ink: 'rgba(210,225,255,.8)', mark: '#ffffff', you: BLUE, them: PINK, fill: 0.32 },
  wood: { bg: '#24170c', glow: 'hsla(30,70%,40%,.22)', dot: '#f6e4c4', line: '#efd09c', last: '#fff7e6', open: 'rgba(246,228,196,.16)', three: 'rgba(255,240,210,.08)', ink: 'rgba(246,228,196,.85)', mark: '#fff7e6', you: '#6fd8ff', them: '#ff7088', fill: 0.34 },
  paper: { bg: '#f3eee2', glow: null, dot: '#22222a', line: '#2b2b36', last: '#000000', open: 'rgba(30,30,40,.14)', three: 'rgba(0,0,0,.06)', ink: '#33333d', mark: '#000000', you: '#1d63c4', them: '#c42c52', fill: 0.22 },
  contrast: { bg: '#000000', glow: null, dot: '#ffffff', line: '#ffffff', last: '#ffe600', open: 'rgba(255,255,255,.38)', three: 'rgba(255,255,255,.16)', ink: '#ffffff', mark: '#ffe600', you: '#3ad0ff', them: '#ff5c8a', fill: 0.4 },
};
const SAMPLES = { arcade: ['#4dd2ff', '#05060d'], wood: ['#efd09c', '#24170c'], paper: ['#2b2b36', '#f3eee2'], contrast: ['#ffffff', '#000000'] };

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', n: D.SIZES.includes(p?.n) ? p.n : 4, ...lookOf(p, { chains: true }) };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    /* the computer, and the hint (on one screen too): never online */
    const brain = mode !== 'online' ? thinker() : null;
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    /* online the board is 4 × 4 on both screens */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      n: mode === 'online' ? 4 : prefs.n, g: D.newGame(4), by: [], over: null, hover: -1, cur: -1, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, lowest: prefs.level, first: prefs.first, rejected: 0, myBoxes: 0, ended: false, endT: 0, geo: { x: 0, y: 0, s: 0 }, shake: 0, claimed: new Map(), last: -1,
      look: lookOf(prefs, { chains: true }), hint: null, hints: 0, hintId: 0, hinting: false, chain: null,
    };
    const LK = () => LOOKS[S.look.theme] || LOOKS.arcade;
    const colorOf = v => (mode === '2p' ? (v === 1 ? LK().you : LK().them) : v === me ? LK().you : LK().them);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Blue' : 'Pink') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const boxesOf = v => S.g.score[v === 1 ? 0 : 1];
    const recKey = (lv = S.lowest) => `${S.n}-${lv}`;
    const recLabel = (lv = S.lowest) => `${S.n}×${S.n} · ${D.LEVELS[lv].name}`;
    /* dots by column letter and row number, a1 top left */
    const dotName = ([r, c]) => `${'abcdefg'[c]}${r + 1}`;
    const lineName = e => { const [a, b] = D.edgeDots(S.n, e); return `from ${dotName(a)} to ${dotName(b)}`; };

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(PINK, '', '');
    const botStrip = playerStrip(BLUE, '', '');
    const sizeSeg = mode !== 'online' ? segment('Size', D.SIZES.map(id => ({ id, label: `${id}×${id}` })), S.n, setSize) : null;
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: D.LEVELS[id].name })), S.level, setLevel) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back your last turn (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); refocus(); }, { title: 'Mark the strongest line the computer can find (H)' }) : null;
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const opts = boardOptions(boardEl, {
      samples: SAMPLES, coords: true,
      toggles: [{ id: 'chains', label: 'Chain count near the end', note: 'How many long chains and loops are left, and what the long-chain rule says you want' }],
      get: () => S.look,
      set: (k, v) => { S.look = { ...S.look, [k]: v }; writePrefs({ [k]: v }); paint(); },
      rules: 'Draw one line between two neighbouring dots on your turn. Closing the fourth side of a box makes it yours, and you draw again (one line can close two). When every line is drawn, most boxes wins; equal is a draw.',
      refocus,
    });
    const chainEl = h('div.arx-bg__rec', { dataset: { k: 'chains' }, hidden: true, role: 'note' });
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'A 4×4 board. You are blue on your screen. Close a box and you draw again. Every line is checked on both screens.'
        : mode === '2p' ? 'Two players on this screen: Blue goes first. Close a box and you draw again.'
          : 'Click near a line, or use the arrow keys and Enter. Close a box and you draw again.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, sizeSeg?.el, levelSeg?.el, recLine?.el, firstSeg?.el,
      h('div.arx-bg__row', undoBtn, resignBtn), h('div.arx-bg__row', hintBtn, opts.button), chainEl, note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Dots and Boxes board', () => draw());
    const loop = looper(() => draw());

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ e: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !Number.isInteger(d.e) || !D.canPlay(S.g, d.e)) return false;
        apply(d.e, 'peer');
        return true;
      },
      reject: () => { S.rejected++; },
      resigned: () => {
        if (S.over) return;
        S.over = { over: true, winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`);
        ctx.announce?.(`${peerName} resigned.`);
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: D.newGame(S.n, 1), by: [], over: null, thinking: false, myBoxes: 0, ended: false, claimed: new Map(), last: -1, cur: -1,
        hint: null, hints: 0, hinting: false, lowest: S.level });
      S.thinkId++;
      S.hintId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);
    /* drop the hint the moment anything moves */
    function dropHint() {
      S.hint = null;
      S.hintId++;
      if (S.hinting) { S.hinting = false; brain?.cancel(); }
    }

    function tryDraw(e) {
      if (!canAct()) return false;
      if (!D.canPlay(S.g, e)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        return false;
      }
      apply(e, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(e, by) {
      const g = S.g, v = g.turn;
      dropHint();
      const got = D.play(g, e);
      S.by.push(by);
      S.last = e;
      if (got > 0) {
        if (by === 'me') S.myBoxes += got;
        for (const b of D.edgeBoxes(g.n, e)) if (b >= 0 && g.owner[b] === v) S.claimed.set(b, performance.now());
      }
      loop.kick(reduced ? 0.05 : 0.5);
      snd.blip(got ? 620 : 360, 0.06, 'triangle', 0.7);
      const o = D.outcome(g);
      if (o.over) S.over = o;
      const told = `${nameOf(v)} drew a line ${lineName(e)}${got ? ` and took ${got === 1 ? 'a box' : 'two boxes'}, and plays again` : ''}.${o.over ? ' ' + overText() : ''}`;
      say(told);
      /* the other side's line, for a screen reader (the shell's live region): yours you just drew */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      if (S.kb || S.cur >= 0) S.cur = nearestUndrawn(e, null);
      paint();
      if (S.over) { loop.kick(2); finishSoon(); }
      else if (mode === 'cpu' && g.turn !== me) computerMove();
    }

    const ask = level => ({ game: 'dnb', n: S.g.n, first: S.g.first, moves: S.g.moves.slice(), level });
    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask(ask(S.level));
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !D.canPlay(S.g, res.edge)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.edge, 'cpu');
    }

    /* the strongest level's line for the side to move, marked until the next line */
    async function hint() {
      if (!brain || !canAct() || S.hinting) return;
      const id = ++S.hintId;
      S.hinting = true;
      S.hint = null;
      paint();
      const res = await brain.ask(ask(3));
      if (dead || id !== S.hintId) return;
      S.hinting = false;
      if (!res || !D.canPlay(S.g, res.edge) || S.over) { say('No hint this time.'); paint(); return; }
      S.hint = res.edge;
      S.hints++;
      const t = `Hint: draw the line ${lineName(res.edge)}.`;
      say(t);
      ctx.announce?.(t);
      paint();
    }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        D.undo(g); S.by.pop();
      } else {
        const mine = S.by.indexOf('me') < 0 ? -1 : (() => {
          /* the first line of my latest turn: walk back over my consecutive lines */
          let i = S.by.length - 1;
          while (i >= 0 && S.by[i] !== 'me') i--;
          while (i > 0 && S.by[i - 1] === 'me') i--;
          return i;
        })();
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { D.undo(g); S.by.pop(); }
        S.myBoxes = 0;
        for (let b = 0; b < g.owner.length; b++) if (g.owner[b] === me) S.myBoxes++;
      }
      dropHint();
      S.claimed = new Map();
      for (let b = 0; b < g.owner.length; b++) if (g.owner[b]) S.claimed.set(b, 0);
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Line taken back.');
      paint();
      if (mode === 'cpu' && g.turn !== me) computerMove();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      dropHint();
      S.over = { over: true, winner: -me, reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.');
      paint();
      finishSoon();
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1100);
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, g = S.g;
      const tally = `${g.score[0]}–${g.score[1]}`;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const mineB = boxesOf(me), theirs = boxesOf(-me);
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? `A draw: ${mineB} boxes each.` : `Final count: you ${mineB}, ${peerName} ${theirs}.`;
        ctx.onEnd({ score: mineB, won, versus: { me: mineB, them: theirs }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? `A draw, ${tally}.` : `${nameOf(o.winner)} wins ${Math.max(...g.score)}–${Math.min(...g.score)}.` });
        return;
      }
      const lv = D.LEVELS[S.lowest].name, mineB = boxesOf(me), theirs = boxesOf(-me);
      const assisted = S.hints > 0;
      const helped = assisted ? ` You used ${S.hints === 1 ? 'a hint' : `${S.hints} hints`}, so it doesn’t set a best.` : '';
      const vs = { key: recKey(), label: recLabel(), result: o.winner === me ? 'win' : o.winner === 0 ? 'draw' : 'loss' };
      const extra = { vs, ...(assisted ? { assisted: true } : {}) };
      if (o.winner === me) ctx.onEnd({ score: mineB, won: true, detail: `You won ${mineB}–${theirs} on ${S.n}×${S.n} against the computer (${lv}).${helped}`, ...extra });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `A draw, ${mineB}–${theirs}, against the computer (${lv}).${helped}`, ...extra });
      else ctx.onEnd({ score: null, won: false, detail: (o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won ${theirs}–${mineB}.`) + helped, ...extra });
      /* the shell has just written the record (records.recordVs) */
      recLine?.set(records.vsOf('dnb', vs.key), vs.label);
    }

    function setLevel(v) {
      S.level = v;
      /* a game counts at the easiest level it was played at */
      S.lowest = S.by.includes('me') ? Math.min(S.lowest, v) : v;
      writePrefs({ level: v }); levelSeg.set(v); paint(); refocus();
    }
    function setFirst(v) {
      S.first = v; writePrefs({ first: v }); firstSeg.set(v);
      me = v === 'cpu' ? -1 : 1;
      newGame(); refocus();
    }
    function setSize(v) { S.n = v; writePrefs({ n: v }); sizeSeg.set(v); newGame(); refocus(); }

    /* ------------------------------ text ------------------------------ */
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.winner === 0) return `A draw, ${S.g.score[0]}–${S.g.score[1]}.`;
      if (mode === '2p') return `${nameOf(o.winner)} wins ${Math.max(...S.g.score)}–${Math.min(...S.g.score)}!`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? `You win ${boxesOf(me)}–${boxesOf(-me)}!` : `${mode === 'cpu' ? 'The computer' : peerName} wins ${boxesOf(-me)}–${boxesOf(me)}.`;
    }
    function say(t) { sr.textContent = t; }
    /* the long-chain hint: null until the end is near, then what to show */
    function chainText() {
      if (!S.look.chains || S.over || mode === 'online') return null;
      const c = D.chainInfo(S.g);
      if (!c.left || c.safe > NEAR) return null;
      S.chain = c;
      const n = k => (k === 1 ? 'one' : String(k));
      const evenOdd = w => `an ${w} number of long chains`;
      const other = w => (w === 'even' ? 'odd' : 'even');
      const fw = c.firstWants;
      let want;
      if (mode === '2p') want = `Blue drew first and wants ${evenOdd(fw)}; Pink wants ${evenOdd(other(fw))}.`;
      else {
        const mine = me === S.g.first ? fw : other(fw);
        want = `You drew ${me === S.g.first ? 'first' : 'second'}, so you want ${evenOdd(mine)}.`;
      }
      const rule = `The long-chain rule on ${c.dots} dots: ${want} Loops don’t change it.`;
      let now;
      if (c.settled) {
        const parity = c.long % 2 ? 'odd' : 'even';
        const suits = mode === '2p' ? `${parity === fw ? 'Blue' : 'Pink'}’s way` : (parity === (me === S.g.first ? fw : other(fw)) ? 'your way' : 'not your way');
        now = `No safe lines left: ${n(c.long)} long chain${c.long === 1 ? '' : 's'} (3+ boxes), ${n(c.loops)} loop${c.loops === 1 ? '' : 's'}${c.short ? ` and ${n(c.short)} short chain${c.short === 1 ? '' : 's'}` : ''} — ${parity}, ${suits}.`;
      } else if (!c.safe) now = 'No safe lines left, but the chains still meet at a box, so there is no simple count yet.';
      else now = `${c.safe === 1 ? 'One safe line' : `${c.safe} safe lines`} left (a safe line gives no box away).`;
      return `${now} ${rule}`;
    }

    function paint() {
      if (dead) return;
      const g = S.g;
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = g.turn === me ? (S.hinting ? 'Finding a hint…' : 'Your move') : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move${S.hinting ? ' — finding a hint…' : ''}`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      topStrip.set({ name: mode === '2p' ? 'Pink' : mode === 'cpu' ? 'Computer' : peerName, note: `${boxesOf(topV)} boxes${mode === 'cpu' ? ` · ${D.LEVELS[S.level].name}` : ''}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Blue' : 'You', note: `${boxesOf(botV)} boxes`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) hintBtn.disabled = !canAct() || S.hinting;
      if (!S.ended) recLine?.set(records.vsOf('dnb', recKey(S.level)), recLabel(S.level));
      const ct = chainText();
      if (!ct) S.chain = null;
      chainEl.hidden = !ct;
      if (ct && chainEl.textContent !== ct) chainEl.textContent = ct;
      sf.cv.setAttribute('aria-label', `Dots and Boxes board, ${S.n} by ${S.n}. ${text}`);
      ctx.onScore(mode === '2p' ? Math.max(g.score[0], g.score[1]) : mode === 'cpu' ? boxesOf(me) : boxesOf(me));
      if (NET) NET.peerScore?.(boxesOf(-me));
      draw();
    }

    /* ------------------------------ geometry ------------------------------ */
    /* with Coordinates on, the letters sit above the dots and the numbers to their left */
    function layout() {
      const n = S.n, pad = S.look.coords ? 0.55 : 0;
      const s = Math.max(20, Math.floor(Math.min(sf.w, sf.h) * 0.9 / (n + pad)));
      return { s, x: Math.round((sf.w - s * (n + pad)) / 2 + s * pad), y: Math.round((sf.h - s * (n + pad)) / 2 + s * pad) };
    }
    const dotXY = (L, r, c) => [L.x + c * L.s, L.y + r * L.s];
    const edgeMid = (L, e) => { const [a, b] = D.edgeDots(S.n, e); const p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
    function segDist(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    /* the nearest undrawn line to a point, within reach */
    function edgeAt(x, y) {
      const L = S.geo;
      let best = -1, bd = L.s * 0.36;
      for (let e = 0; e < S.g.drawn.length; e++) {
        if (S.g.drawn[e]) continue;
        const [a, b] = D.edgeDots(S.n, e), p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]);
        const d = segDist(x, y, p[0], p[1], q[0], q[1]);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }
    /* keyboard: the nearest undrawn line from `from` in direction dir ([dx, dy]); null dir = just the nearest */
    function nearestUndrawn(from, dir) {
      const L = layout();
      const [fx, fy] = from >= 0 ? edgeMid(L, from) : [L.x + S.n * L.s / 2, L.y + S.n * L.s / 2];
      let best = -1, bs = Infinity;
      for (let e = 0; e < S.g.drawn.length; e++) {
        if (S.g.drawn[e] || e === from) continue;
        const [mx, my] = edgeMid(L, e), dx = mx - fx, dy = my - fy;
        let score;
        if (dir) {
          const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
          if (along < L.s * 0.2) continue;
          score = along + across * 2.5;
        } else score = Math.hypot(dx, dy);
        if (score < bs) { bs = score; best = e; }
      }
      return best >= 0 ? best : from;
    }

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      if (dead) return;
      const g = sf.g, G = S.g;
      sf.begin();
      const L = S.geo = layout();
      const lk = LK();
      const n = S.n, now = performance.now();
      g.fillStyle = lk.bg;
      g.fillRect(0, 0, sf.w, sf.h);
      if (lk.glow) {
        const glow = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
        glow.addColorStop(0, lk.glow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.fillRect(0, 0, sf.w, sf.h);
      }
      /* boxes */
      for (let b = 0; b < n * n; b++) {
        const v = G.owner[b];
        const r = Math.floor(b / n), c = b % n;
        const x = L.x + c * L.s, y = L.y + r * L.s;
        if (v) {
          const t0 = S.claimed.get(b), k = reduced || t0 === undefined ? 1 : Math.min(1, (now - t0) / 260);
          g.fillStyle = colorOf(v);
          g.globalAlpha = lk.fill * k;
          g.fillRect(x + L.s * 0.08, y + L.s * 0.08, L.s * 0.84, L.s * 0.84);
          g.globalAlpha = 0.9 * k;
          g.font = `800 ${Math.round(L.s * 0.34)}px system-ui,sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(mode === '2p' ? (v === 1 ? 'B' : 'P') : v === me ? 'Y' : 'F', x + L.s / 2, y + L.s / 2 + 1);
          g.globalAlpha = 1;
        } else if (G.sides[b] === 3 && !S.over) {
          g.fillStyle = lk.three;
          g.fillRect(x + 3, y + 3, L.s - 6, L.s - 6);
        }
      }
      /* lines */
      g.lineCap = 'round';
      const hv = S.kb ? S.cur : S.hover;
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 3 * (1 - (now - S.shake) / 200);
      for (let e = 0; e < G.drawn.length; e++) {
        const [a, b] = D.edgeDots(n, e), p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]);
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
        if (G.drawn[e]) {
          const last = e === S.last;
          g.strokeStyle = last ? lk.last : lk.line;
          g.lineWidth = Math.max(3, L.s * 0.085);
          if (last) { g.shadowColor = lk.last; g.shadowBlur = 10; }
        } else if (e === hv && canAct()) {
          g.strokeStyle = colorOf(G.turn);
          g.lineWidth = Math.max(3, L.s * 0.085);
          g.globalAlpha = 0.8;
        } else {
          g.strokeStyle = lk.open;
          g.lineWidth = Math.max(2, L.s * 0.04);
        }
        if (sx) { g.save(); g.translate(sx, 0); g.stroke(); g.restore(); } else g.stroke();
        g.shadowBlur = 0; g.globalAlpha = 1;
      }
      /* the hint: the line, dashed, in the mover's colour */
      if (S.hint !== null && !S.over && !G.drawn[S.hint]) {
        const [a, b] = D.edgeDots(n, S.hint), p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]);
        g.save();
        g.strokeStyle = colorOf(G.turn);
        g.lineWidth = Math.max(3, L.s * 0.09);
        g.setLineDash([L.s * 0.1, L.s * 0.08]);
        g.shadowColor = lk.mark; g.shadowBlur = 8;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
        g.restore();
      }
      /* dots */
      g.fillStyle = lk.dot;
      for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) { const [x, y] = dotXY(L, r, c); g.beginPath(); g.arc(x, y, Math.max(3, L.s * 0.075), 0, Math.PI * 2); g.fill(); }
      /* coordinates: letters for the dot columns, numbers for the dot rows */
      if (S.look.coords) {
        g.fillStyle = lk.ink;
        g.font = `700 ${Math.max(10, Math.round(L.s * 0.22))}px Inter,system-ui,sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let c = 0; c <= n; c++) g.fillText('abcdefg'[c], L.x + c * L.s, L.y - L.s * 0.38);
        for (let r = 0; r <= n; r++) g.fillText(String(r + 1), L.x - L.s * 0.38, L.y + r * L.s);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), ed = edgeAt(p.x, p.y);
      if (ed < 0) return;
      S.hover = ed;
      tryDraw(ed);
    };
    const onMove = e => {
      const p = at(e), ed = edgeAt(p.x, p.y);
      S.kb = false;
      if (ed !== S.hover) { S.hover = ed; sf.cv.style.cursor = ed >= 0 && canAct() ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || opts.isOpen()) return;
      const k = e.key;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (dir) {
        e.preventDefault(); snd.wake();
        S.kb = true;
        if (S.cur < 0 || S.g.drawn[S.cur]) S.cur = nearestUndrawn(-1, null);
        else S.cur = nearestUndrawn(S.cur, dir);
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') {
        e.preventDefault(); snd.wake(); S.kb = true;
        if (S.cur < 0 || S.g.drawn[S.cur]) { S.cur = nearestUndrawn(-1, null); draw(); return; }
        tryDraw(S.cur);
        return;
      }
      if ((k === 'h' || k === 'H') && hintBtn) { e.preventDefault(); hint(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    newGame();

    const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
    /* the board as text: dots '+', lines '-' '|' (drawn) or ' ', boxes by owner digit */
    const grid = () => {
      const n = S.n, out = [];
      for (let r = 0; r <= 2 * n; r++) {
        let s = '';
        for (let c = 0; c <= 2 * n; c++) {
          if (r % 2 === 0 && c % 2 === 0) s += '+';
          else if (r % 2 === 0) s += S.g.drawn[D.hEdge(n, r / 2, (c - 1) / 2)] ? '-' : ' ';
          else if (c % 2 === 0) s += S.g.drawn[D.vEdge(n, (r - 1) / 2, c / 2)] ? '|' : ' ';
          else { const o = S.g.owner[((r - 1) / 2) * n + (c - 1) / 2]; s += o === 1 ? '1' : o === -1 ? '2' : ' '; }
        }
        out.push(s);
      }
      return out;
    };
    return {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        brain?.close();
        link?.stop();
        loop.stop();
        opts.close();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* what a watcher is allowed to see (js/arcade/spectate.js): the board as text, scores, whose turn */
      spectate: () => ({
        k: 'board', st: 'dnb', w: S.n, h: S.n, cells: grid().join(''),
        hl: S.last >= 0 ? [S.last] : [], txt: statusEl.textContent, over: !!S.over,
        pl: [{ n: mode === '2p' ? 'Blue' : (me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName)), m: `${S.g.score[0]} boxes` },
          { n: mode === '2p' ? 'Pink' : (me === 1 ? (mode === 'cpu' ? 'Computer' : peerName) : 'You'), m: `${S.g.score[1]} boxes` }],
        turn: S.over ? 0 : S.g.turn,
      }),
      peek: () => ({
        mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), n: S.n, grid: grid(), moves: S.g.moves.join(','), score: S.g.score.slice(),
        sides: Array.from(S.g.sides).join(''), owner: Array.from(S.g.owner, id).join(''),
        over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'full' } : null,
        level: S.level, lowest: S.lowest, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected, myBoxes: S.myBoxes, ended: S.ended,
        cursor: S.cur, geo: { ...S.geo }, status: statusEl.textContent,
        /* where each undrawn line is on the page, for a test to click */
        edges: Array.from(S.g.drawn, (_d, e) => edgeMid(S.geo, e)),
        hint: S.hint, hints: S.hints, hinting: S.hinting, look: { ...S.look }, theme: LK(),
        chain: S.chain ? { ...S.chain } : null, chainText: chainEl.hidden ? null : chainEl.textContent, said: sr.textContent,
        record: { key: recKey(S.level), label: recLabel(S.level) },
      }),
    };
  },
};
