/* ============================================================
   arcade/mancala.js — Mancala (Kalah or Oware) for Static Arcade.

   Kalah, the default: six pits a side, four stones in each, a store
   at each end. Lift a pit, sow it round counter-clockwise, one stone
   per pit, skipping your opponent's store. Last stone in your store:
   go again. Last stone in an empty pit on your side: take it and the
   stones across. The game ends when a side runs out; the other keeps
   what is left.
   Oware (Rules), the Abapa rules: six houses a side, four seeds each,
   no stores — what you capture goes to your tally. Your last seed
   making a house on the other side 2 or 3 takes it, and the houses
   before it that are 2 or 3 too; you must feed an empty side; 25 wins.
   The exact rules of both are in ./mancala-rules.js, in the side
   panel and in the Board card.

   · 1P: against the computer (Easy, Medium, Hard — alpha-beta in
     ./mancala-rules.js, run in the Arcade's thinking worker), you or
     the computer first. Level, first, rules and the board's look are
     remembered in portal.arcadeMancala. Undo takes back your last
     move and the replies. Hint asks Hard for your move and marks the
     pit; a game with a hint never sets a best. Your won / lost /
     drawn record against each level and rule set is under the Level
     row (./records.js; games played to the end, resigning counts as
     lost, a game counts at the easiest level it was played at).
   · 2P: two people on one screen; whoever's turn it is clicks one of
     their own pits (the bottom row is player 1, the top row player 2).
   · Online: a friend on another device through the Arcade's room,
     always Kalah. The host goes first in odd rounds. On your screen
     your pits are always the bottom row. Every arriving move is
     checked by the rules engine (whose turn, a pit with stones)
     before it counts.

   Sowing is animated one stone at a time (and skipped with reduced
   motion). Mouse or touch: click one of your pits. Keyboard: ← →
   pick a pit, Enter / Space / ↓ sow it, 1–6 sow that pit (counting
   from your left), H hint, U / Z / Backspace undo.
   Score in 1P Kalah: the stones in your store when you win (Oware
   wins don't score).
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { newGame as freshGame, canPlay, play, outcome, legal, LEVELS, storeOf, pitOf, PITS, QUIET_MAX } from './mancala-rules.js';
import { thinker } from './thinker.js';
import * as records from './records.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink, boardOptions, lookOf, recordLine } from './boardkit.js';

const PREF = 'portal.arcadeMancala';
const MIN_THINK_MS = 420;
const STEP_MS = 175;
const SEED_HUES = [18, 42, 160, 200, 280, 340];
/* the board's four looks (boardkit's BOARD_THEMES); 'arcade' is the original */
const LOOKS = {
  arcade: { bg: '#05060d', glow: 'hsla(30,90%,45%,.18)', board: ['#6b4226', '#4a2b16'], halo: 'hsla(28,100%,50%,.4)', edge: 'rgba(255,200,140,.35)',
    pit: 'rgba(20,10,4,.65)', empty: 'rgba(10,5,2,.5)', rim: 'rgba(255,255,255,.14)', mine: 'rgba(255,215,130,.55)', hot: '#ffe28a', turn: 'rgba(255,220,120,.75)',
    text: '#ffe9c2', dim: 'rgba(255,233,194,.45)', label: 'rgba(255,233,194,.35)', mark: '#ffffff', seed: [85, 82, 70, 42] },
  wood: { bg: '#18261a', glow: 'hsla(120,40%,32%,.28)', board: ['#c8925a', '#96602f'], halo: 'rgba(0,0,0,.55)', edge: 'rgba(255,236,204,.55)',
    pit: 'rgba(78,42,14,.55)', empty: 'rgba(60,32,10,.45)', rim: 'rgba(255,240,215,.22)', mine: 'rgba(255,246,214,.7)', hot: '#fff3b8', turn: 'rgba(255,246,214,.85)',
    text: '#fff6e4', dim: 'rgba(255,246,228,.5)', label: 'rgba(255,246,228,.55)', mark: '#fff6e4', seed: [45, 74, 38, 34] },
  paper: { bg: '#efe9dc', glow: null, board: ['#e4d8bf', '#d4c4a3'], halo: 'rgba(60,40,10,.22)', edge: 'rgba(40,30,20,.6)',
    pit: 'rgba(120,95,60,.2)', empty: 'rgba(120,95,60,.12)', rim: 'rgba(40,30,20,.35)', mine: 'rgba(122,59,0,.6)', hot: '#8a4300', turn: 'rgba(122,59,0,.75)',
    text: '#2a2118', dim: 'rgba(42,33,24,.45)', label: 'rgba(42,33,24,.6)', mark: '#1a1208', seed: [70, 60, 60, 30] },
  contrast: { bg: '#000000', glow: null, board: ['#000000', '#000000'], halo: null, edge: '#ffffff',
    pit: '#000000', empty: '#000000', rim: '#ffffff', mine: '#ffffff', hot: '#ffe600', turn: '#ffe600',
    text: '#ffffff', dim: '#bbbbbb', label: '#ffffff', mark: '#ffe600', seed: [100, 78, 90, 52], wide: true },
};
const SAMPLES = { arcade: ['#6b4226', '#05060d'], wood: ['#c8925a', '#18261a'], paper: ['#e4d8bf', '#efe9dc'], contrast: ['#ffffff', '#000000'] };
const RULES_IDS = ['kalah', 'oware'];

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', rules: RULES_IDS.includes(p?.rules) ? p.rules : 'kalah', ...lookOf(p) };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const seed32 = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;

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
    /* me: the seat (0 moves first) whose pits are the bottom row on this screen */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 0 : 1) : mode === 'cpu' ? (prefs.first === 'cpu' ? 1 : 0) : 0;
    let dead = false;

    const S = {
      rules: mode === 'online' ? 'kalah' : prefs.rules,
      g: null, by: [], over: null, show: null, hover: -1, cursor: 0, kb: false,
      thinking: false, thinkId: 0, level: prefs.level, lowest: prefs.level, first: prefs.first, rejected: 0, myMoves: 0,
      ended: false, endT: 0, geo: null, shake: 0, q: [], busy: false, idle: [], flash: null, hand: null, timers: new Set(),
      look: lookOf(prefs), hint: null, hints: 0, hintId: 0, hinting: false,
    };
    const oware = () => S.rules === 'oware';
    /* Oware's words: houses, seeds, a tally (no store on the board) */
    const W = () => (oware() ? { pit: 'house', pits: 'houses', stone: 'seed', stones: 'seeds', store: 'taken' } : { pit: 'pit', pits: 'pits', stone: 'stone', stones: 'stones', store: 'in store' });
    S.g = freshGame(0, { rules: S.rules });
    const nameOf = s => (mode === '2p' ? `Player ${s + 1}` : s === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const LK = () => LOOKS[S.look.theme] || LOOKS.arcade;
    const recKey = (lv = S.lowest) => `${S.rules}-${lv}`;
    const recLabel = (lv = S.lowest) => `${oware() ? 'Oware' : 'Kalah'} · ${LEVELS[lv].name}`;

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#ff7a59', '', '');
    const botStrip = playerStrip('#ffd23f', '', '');
    const rulesSeg = mode !== 'online' ? segment('Rules', [{ id: 'kalah', label: 'Kalah', title: 'Stores, extra turns, captures from an empty pit' }, { id: 'oware', label: 'Oware', title: 'Abapa: no stores, capture 2s and 3s, 25 seeds wins' }], S.rules, setRules) : null;
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back your last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); refocus(); }, { title: 'Mark the strongest move the computer can find (H)' }) : null;
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const opts = boardOptions(boardEl, {
      samples: SAMPLES, coords: true,
      get: () => S.look,
      set: (k, v) => { S.look = { ...S.look, [k]: v }; writePrefs({ [k]: v }); paint(); },
      get rules() { return rulesText(); },
      refocus,
    });
    const note = h('div.arx-bg__note');
    const side = h('div.arx-bg__side', topStrip.el, statusEl, rulesSeg?.el, levelSeg?.el, recLine?.el, firstSeg?.el,
      h('div.arx-bg__row', undoBtn, resignBtn), h('div.arx-bg__row', hintBtn, opts.button), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Mancala board', () => draw());
    const loop = looper(() => draw());
    const later = (fn, ms) => { const t = setTimeout(() => { S.timers.delete(t); fn(); }, ms); S.timers.add(t); return t; };

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ p: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== 1 - me || !Number.isInteger(d.p) || !canPlay(S.g, d.p)) return false;
        apply(d.p, 'peer');
        return true;
      },
      reject: () => { S.rejected++; },
      resigned: () => {
        if (S.over) return;
        S.over = { over: true, winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`);
        ctx.announce?.(`${peerName} resigned.`);
        paint();
        whenIdle(() => finishSoon());
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      S.timers.forEach(clearTimeout); S.timers.clear();
      const first = 0;
      Object.assign(S, { g: freshGame(first, { rules: S.rules }), by: [], over: null, thinking: false, myMoves: 0, ended: false, cursor: 0, q: [], busy: false, idle: [], flash: null, hand: null,
        hint: null, hints: 0, hinting: false, lowest: S.level });
      S.show = Array.from(S.g.b);
      S.thinkId++;
      S.hintId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && !S.busy && (mode === '2p' || S.g.turn === me);
    const whenIdle = fn => { if (S.busy) S.idle.push(fn); else fn(); };
    /* drop the hint the moment anything moves */
    function dropHint() {
      S.hint = null;
      S.hintId++;
      if (S.hinting) { S.hinting = false; brain?.cancel(); }
    }

    /** the local pit (0–5) a click or key means: only the side that is to move */
    function tryPit(k) {
      if (!canAct()) return false;
      if (!canPlay(S.g, k)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        const empty = !S.g.b[pitOf(S.g.turn, k)];
        say(empty ? `${oware() ? 'House' : 'Pit'} ${k + 1} is empty.` : `House ${k + 1} gives your opponent no seeds, and they have none: pick a house that reaches their side.`);
        return false;
      }
      apply(k, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(k, by) {
      const g = S.g, before = Array.from(g.b), who = g.turn;
      dropHint();
      const res = play(g, k);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      const o = outcome(g);
      if (o.over) S.over = { ...o, end: g.end || null };
      let told;
      if (oware()) {
        told = `${nameOf(who)} sowed house ${k + 1}.${res.capture ? ` Took ${res.capture.n} seeds.` : ''}${res.grandSlam ? ' That would have taken every seed on the other side, so it takes none.' : ''}${o.over ? ' ' + overText() : ''}`;
      } else {
        told = `${nameOf(who)} sowed pit ${k + 1}.${res.extra && !o.over ? ' Last stone in the store: ' + nameOf(who) + ' goes again.' : ''}${res.capture ? ` Captured ${res.capture.n} stones.` : ''}${o.over ? ' ' + overText() : ''}`;
      }
      say(told);
      /* the other side's move, for a screen reader (the shell's live region): yours you just made */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      S.q.push({ res, before, after: Array.from(g.b), who });
      paintSoon();
      runQ();
      whenIdle(() => {
        if (dead) return;
        paint();
        if (S.over) finishSoon();
        else if (mode === 'cpu' && S.g.turn !== me) computerMove();
      });
    }

    /* sowing: one stone every STEP_MS; with reduced motion the board just becomes what it is */
    const flashOf = res => (res.capture ? { pits: res.capture.pits || [res.capture.pit], t0: performance.now() } : null);
    function runQ() {
      if (S.busy || dead) return;
      const a = S.q.shift();
      if (!a) { const cbs = S.idle.splice(0); cbs.forEach(fn => fn()); return; }
      if (reduced) { S.show = a.after; S.flash = flashOf(a.res); snd.blip(330, 0.06, 'triangle', 0.6); paint(); runQ(); return; }
      S.busy = true;
      const board = a.before.slice();
      S.show = board;
      board[a.res.from] = 0;
      S.hand = { from: a.res.from, left: a.res.steps.length };
      let i = 0;
      const tick = () => {
        if (dead) return;
        if (i < a.res.steps.length) {
          const p = a.res.steps[i++];
          board[p]++;
          S.hand.left = a.res.steps.length - i;
          S.hand.at = p;
          snd.blip(260 + (i % 7) * 34, 0.05, 'triangle', 0.55);
          loop.kick(STEP_MS / 1000 + 0.05);
          later(tick, STEP_MS);
          return;
        }
        S.hand = null;
        if (a.res.capture) {
          S.flash = flashOf(a.res);
          snd.blip(520, 0.12, 'square', 0.6, 880);
          loop.kick(0.9);
          later(() => { S.show = a.after; S.busy = false; S.flash = null; paint(); runQ(); }, 520);
        } else {
          if (a.res.extra) snd.blip(660, 0.1, 'sine', 0.7, 990);
          S.show = a.after;
          S.busy = false;
          paint();
          runQ();
        }
      };
      later(tick, 60);
      loop.kick(0.3);
    }

    const ask = level => ({ game: 'mancala', b: Array.from(S.g.b), turn: S.g.turn, level, seed: seed32(), rules: S.rules });
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
      if (!res || !canPlay(S.g, res.k)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.k, 'cpu');
    }

    /* the strongest level's move for the side to move, marked until the next move */
    async function hint() {
      if (!brain || !canAct() || S.hinting) return;
      const id = ++S.hintId;
      S.hinting = true;
      S.hint = null;
      paint();
      const res = await brain.ask(ask(3));
      if (dead || id !== S.hintId) return;
      S.hinting = false;
      if (!res || !canPlay(S.g, res.k) || S.over) { say('No hint this time.'); paint(); return; }
      S.hint = res.k;
      S.hints++;
      const t = `Hint: sow ${W().pit} ${res.k + 1}.`;
      say(t);
      ctx.announce?.(t);
      paint();
    }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      /* rebuild from the move list: simplest way to be exactly right */
      let keep;
      if (mode === '2p') keep = g.moves.length - 1;
      else { const mine = S.by.lastIndexOf('me'); keep = mine; }
      if (keep < 0) return;
      if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
      dropHint();
      const moves = g.moves.slice(0, keep), by = S.by.slice(0, keep);
      S.timers.forEach(clearTimeout); S.timers.clear();
      S.q = []; S.busy = false; S.idle = []; S.hand = null; S.flash = null;
      const ng = freshGame(0, { rules: S.rules });
      for (const k of moves) play(ng, k);
      S.g = ng; S.by = by; S.myMoves = by.filter(b => b === 'me').length;
      S.show = Array.from(ng.b);
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      dropHint();
      S.over = { over: true, winner: 1 - me, reason: 'resign', who: 'me', score: [S.g.b[6], S.g.b[13]] };
      link?.resign();
      say('You resigned.');
      paint();
      finishSoon();
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1000);
    }
    /* how an Oware game ended, when it was not by 25 seeds */
    function endText() {
      const e = S.over?.end;
      if (e === 'feed') return 'One side had no seeds and no move could give it any, so the seeds left went to the side they were on.';
      if (e === 'repeat') return 'The same position came round a third time, so each side took the seeds on its own side.';
      if (e === 'quiet') return `${QUIET_MAX} moves went by with no capture, so each side took the seeds on its own side.`;
      return '';
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, mine = o.score[me], theirs = o.score[1 - me], w = W();
      const how = endText() ? ` ${endText()}` : '';
      if (mode === 'online') {
        const won = o.winner === -1 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : won === null ? `A draw, ${mine} stones each.` : `${mine} stones to ${theirs}.`;
        ctx.onEnd({ score: null, won, versus: { me: mine, them: theirs }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: (o.winner === -1 ? `A draw, ${o.score[0]} ${w.stones} each.` : `Player ${o.winner + 1} wins, ${o.score[o.winner]} ${w.stones} to ${o.score[1 - o.winner]}.`) + how });
        return;
      }
      const lv = LEVELS[S.lowest].name;
      const assisted = S.hints > 0;
      const helped = assisted ? ` You used ${S.hints === 1 ? 'a hint' : `${S.hints} hints`}, so it doesn’t set a best.` : '';
      const vs = { key: recKey(), label: recLabel(), result: o.winner === me ? 'win' : o.winner === -1 ? 'draw' : 'loss' };
      const extra = { vs, ...(assisted ? { assisted: true } : {}) };
      const where = oware() ? ' at Oware' : '';
      if (o.winner === me) ctx.onEnd({ score: oware() ? null : mine, won: true, detail: `You won ${mine} ${w.stones} to ${theirs} against the computer (${lv})${where}.${how}${helped}`, ...extra });
      else if (o.winner === -1) ctx.onEnd({ score: null, won: false, detail: `A draw, ${mine} ${w.stones} each, against the computer (${lv})${where}.${how}${helped}`, ...extra });
      else ctx.onEnd({ score: null, won: false, detail: (o.reason === 'resign' ? `You resigned against the computer (${lv})${where}.` : `The computer (${lv}) won ${theirs} ${w.stones} to ${mine}${where}.${how}`) + helped, ...extra });
      /* the shell has just written the record (records.recordVs) */
      recLine?.set(records.vsOf('mancala', vs.key), vs.label);
    }

    function setLevel(v) {
      S.level = v;
      /* a game counts at the easiest level it was played at */
      S.lowest = S.myMoves ? Math.min(S.lowest, v) : v;
      writePrefs({ level: v }); levelSeg.set(v); paint(); refocus();
    }
    function setFirst(v) {
      S.first = v;
      writePrefs({ first: v });
      firstSeg.set(v);
      me = v === 'cpu' ? 1 : 0;
      newGame();
      refocus();
    }
    function setRules(v) {
      S.rules = v === 'oware' ? 'oware' : 'kalah';
      writePrefs({ rules: S.rules });
      rulesSeg.set(S.rules);
      newGame();
      refocus();
    }

    /* ------------------------------ text ------------------------------ */
    function noteText() {
      if (oware()) {
        return 'Oware (Abapa) rules. 6 houses, 4 seeds each, no stores: what you capture goes to your tally. Sow counter-clockwise; 12 or more seeds skip their own house. '
          + 'Last seed makes a house across 2 or 3: take it and the 2s and 3s before it. Feed an empty side if you can. 25 seeds wins.';
      }
      return 'Kalah rules. 6 pits, 4 stones each. Sow counter-clockwise, skipping your opponent’s store. '
        + 'Last stone in your store: move again. Last stone in an empty pit of yours with stones across: capture both. '
        + 'The game ends when a side is empty and the other side keeps what is left.';
    }
    function rulesText() {
      if (oware()) {
        return 'Oware, the Abapa rules. Six houses a side, four seeds in each, and no stores on the board: what you capture goes to your tally. '
          + 'Pick one of your houses and sow its seeds one per house, counter-clockwise; a house with 12 or more seeds goes all the way round and skips itself. '
          + 'If your last seed makes a house on the other side hold 2 or 3, you take them, and the house before it, and the one before that, while they are on that side and hold 2 or 3. '
          + 'A move that would take every seed your opponent has takes nothing. If your opponent has no seeds you must give them some if any move can; if none can, the game ends and you take the seeds on your side. '
          + `25 seeds wins and 24 each is a draw. A game that goes round and round ends when the same position comes round a third time, or after ${QUIET_MAX} moves (${QUIET_MAX / 2} each) with no capture: each side then takes the seeds on its own side.`;
      }
      return 'Kalah. Six pits a side, four stones in each, and a store at each player’s right. Sow a pit’s stones one per pit, counter-clockwise, into your own store but never your opponent’s. '
        + 'Your last stone in your store: you move again. Your last stone in an empty pit on your side, with stones across: you take both into your store. '
        + 'When either side is empty the game ends and the other side keeps its stones. The bigger store wins.'
        + (mode === 'online' ? ' Online games are always Kalah.' : '');
    }
    function overText() {
      const o = S.over;
      if (!o) return '';
      const w = W();
      if (o.winner === -1) return `A draw, ${o.score[0]} ${w.stones} each.`;
      if (mode === '2p') return `Player ${o.winner + 1} wins, ${o.score[o.winner]} to ${o.score[1 - o.winner]}.`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? `You win, ${o.score[me]} to ${o.score[1 - me]}!` : `${nameOf(1 - me)} wins, ${o.score[1 - me]} to ${o.score[me]}.`;
    }
    function say(t) { sr.textContent = t; }
    let paintT = 0;
    const paintSoon = () => { if (!paintT) paintT = requestAnimationFrame(() => { paintT = 0; paint(); }); };

    function paint() {
      if (dead) return;
      const g = S.g, w = W();
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = g.turn === me ? (S.hinting ? 'Finding a hint…' : 'Your move') : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move${S.hinting ? ' — finding a hint…' : ''}`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      if (!S.over && S.busy) text = 'Sowing…';
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topS = 1 - (mode === '2p' ? 0 : me), botS = mode === '2p' ? 0 : me;
      const inStore = s => (S.busy || S.q.length ? S.show[storeOf(s)] : g.b[storeOf(s)]);
      topStrip.set({ name: mode === '2p' ? 'Player 2' : mode === 'cpu' ? 'Computer' : peerName,
        note: `${mode === 'cpu' ? LEVELS[S.level].name + ' · ' : ''}${inStore(topS)} ${w.store} · goes ${topS === 0 ? 'first' : 'second'}`, turn: !S.over && g.turn === topS, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Player 1' : 'You', note: `${inStore(botS)} ${w.store} · goes ${botS === 0 ? 'first' : 'second'}`, turn: !S.over && g.turn === botS });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) hintBtn.disabled = !canAct() || S.hinting;
      if (!S.ended) recLine?.set(records.vsOf('mancala', recKey(S.level)), recLabel(S.level));
      note.textContent = noteText();
      sf.cv.setAttribute('aria-label', `Mancala board, ${oware() ? 'Oware' : 'Kalah'}. ${text}. Your ${w.pits}: ${[0, 1, 2, 3, 4, 5].map(k => g.b[pitOf(botS, k)]).join(', ')}. Opponent ${w.pits}: ${[0, 1, 2, 3, 4, 5].map(k => g.b[pitOf(topS, k)]).join(', ')}.`);
      ctx.onScore(g.b[storeOf(mode === '2p' ? 0 : me)]);
      if (NET) NET.peerScore?.(g.b[storeOf(1 - me)]);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    /* column c (0–7, left to right) of the board; the bottom row is the viewer's side */
    const botSide = () => (mode === '2p' ? 0 : me);
    function layout() {
      const cell = Math.max(24, Math.min(sf.w / 8.6, sf.h / 3.5));
      const w = cell * 8, hh = cell * 2.7;
      return { cell, x: Math.round((sf.w - w) / 2), y: Math.round((sf.h - hh) / 2), w, hh };
    }
    /* the board index of the pit/store at (row, col): row 0 top, 1 bottom */
    function slotAt(L, idx) {
      const bs = botSide();
      const owner = idx < 7 ? 0 : 1, isStore = idx === 6 || idx === 13;
      const k = idx - owner * 7;
      if (isStore) return { cx: L.x + (owner === bs ? 7.5 : 0.5) * L.cell, cy: L.y + L.hh / 2, store: true };
      const col = owner === bs ? 1 + k : 6 - k;
      return { cx: L.x + (col + 0.5) * L.cell, cy: L.y + (owner === bs ? 2.0 : 0.7) * L.cell + (owner === bs ? 0 : 0), store: false };
    }
    function pitAt(x, y) {
      const L = S.geo;
      if (!L) return -1;
      for (const s of [0, 1]) {
        if (mode !== '2p' && s !== me) continue;
        for (let k = 0; k < PITS; k++) {
          const p = slotAt(L, pitOf(s, k));
          if (Math.hypot(x - p.cx, y - p.cy) <= L.cell * 0.46) return { s, k };
        }
      }
      return -1;
    }

    function stones(g, cx, cy, r, n, idx) {
      /* seed: [saturation, lightness] at the shine and at the edge */
      const cap = Math.min(n, 24), [s0, l0, s1, l1] = LK().seed, wide = LK().wide;
      for (let i = 0; i < cap; i++) {
        const a = i * 2.399963 + idx, d = Math.sqrt((i + 0.6) / (cap + 1)) * r * 0.78;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, sr = Math.max(3, r * 0.17);
        const hue = SEED_HUES[(i * 3 + idx) % SEED_HUES.length];
        const gr = g.createRadialGradient(x - sr * 0.3, y - sr * 0.35, sr * 0.1, x, y, sr);
        gr.addColorStop(0, `hsl(${hue},${s0}%,${l0}%)`);
        gr.addColorStop(1, `hsl(${hue},${s1}%,${l1}%)`);
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, sr, 0, Math.PI * 2); g.fill();
        if (wide) { g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke(); }
      }
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const lk = LK(), ow = oware();
      const now = performance.now();
      const show = S.busy || S.q.length ? S.show : Array.from(S.g.b);
      g.fillStyle = lk.bg;
      g.fillRect(0, 0, sf.w, sf.h);
      if (lk.glow) {
        const glow = g.createRadialGradient(sf.w / 2, sf.h * 0.55, 0, sf.w / 2, sf.h * 0.55, Math.max(sf.w, sf.h) * 0.6);
        glow.addColorStop(0, lk.glow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, sf.w, sf.h);
      }
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save();
      g.translate(sx, 0);
      /* the board (Oware's has no stores: its tallies sit off the ends) */
      const bx = ow ? L.x + L.cell * 0.9 : L.x, bw = ow ? L.cell * 6.2 : L.w;
      if (lk.halo) { g.shadowBlur = 24; g.shadowColor = lk.halo; }
      const bg = g.createLinearGradient(0, L.y, 0, L.y + L.hh);
      bg.addColorStop(0, lk.board[0]); bg.addColorStop(1, lk.board[1]);
      g.fillStyle = bg;
      rr(g, bx, L.y, bw, L.hh, L.cell * 0.35);
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = lk.edge; g.lineWidth = lk.wide ? 2.5 : 1.5; g.stroke();
      const turnSide = S.over ? -1 : S.g.turn;
      const showHint = S.hint !== null && !S.over && !S.busy;
      const font = (wt, k) => `${wt} ${Math.round(L.cell * k)}px Inter,system-ui,sans-serif`;
      for (let idx = 0; idx < 14; idx++) {
        const p = slotAt(L, idx), owner = idx < 7 ? 0 : 1;
        const n = show[idx];
        const isMine = canAct() && owner === S.g.turn && idx !== 6 && idx !== 13;
        if (p.store) {
          const w = L.cell * 0.82, hh = L.hh * 0.86;
          if (ow) {
            /* a tally: the seeds taken, beside the board */
            g.save();
            g.setLineDash([5, 5]);
            g.strokeStyle = turnSide === owner ? lk.turn : lk.rim; g.lineWidth = 1.5;
            rr(g, p.cx - w / 2, p.cy - hh / 2, w, hh, w * 0.3);
            g.stroke();
            g.restore();
          } else {
            g.fillStyle = lk.pit;
            rr(g, p.cx - w / 2, p.cy - hh / 2, w, hh, w / 2);
            g.fill();
            if (lk.wide) { g.strokeStyle = lk.rim; g.lineWidth = 2; g.stroke(); }
            if (turnSide === owner) { g.strokeStyle = lk.turn; g.lineWidth = 2; g.stroke(); }
          }
          stones(g, p.cx, p.cy, w * 0.42, Math.min(n, 18), idx);
          g.fillStyle = lk.text; g.font = font(800, 0.3); g.textAlign = 'center'; g.textBaseline = 'middle';
          const ty = owner === botSide() ? p.cy + hh / 2 - L.cell * 0.28 : p.cy - hh / 2 + L.cell * 0.28;
          g.fillText(String(n), p.cx, ty);
          if (ow) { g.fillStyle = lk.label; g.font = font(600, 0.15); g.fillText('taken', p.cx, owner === botSide() ? ty - L.cell * 0.27 : ty + L.cell * 0.27); }
          continue;
        }
        const r = L.cell * 0.4;
        const k = idx - owner * 7;
        const hot = isMine && ((S.kb && owner === botSide() && S.cursor === k) || (!S.kb && S.hover && S.hover.s === owner && S.hover.k === k));
        g.fillStyle = n === 0 && isMine ? lk.empty : lk.pit;
        g.beginPath(); g.arc(p.cx, p.cy, r, 0, Math.PI * 2); g.fill();
        g.lineWidth = hot ? 3 : lk.wide ? 2 : 1.5;
        g.strokeStyle = hot ? lk.hot : isMine && n > 0 ? lk.mine : lk.rim;
        g.stroke();
        if (S.flash && S.flash.pits.includes(idx) && now - S.flash.t0 < 900) {
          g.save();
          g.globalAlpha = Math.max(0, 0.9 - (now - S.flash.t0) / 1000);
          g.strokeStyle = lk.mark; g.lineWidth = 4; g.beginPath(); g.arc(p.cx, p.cy, r + 3, 0, Math.PI * 2); g.stroke();
          g.restore();
        }
        if (showHint && owner === S.g.turn && k === S.hint) {
          g.save();
          g.strokeStyle = lk.mark; g.lineWidth = Math.max(2.5, L.cell * 0.06);
          g.setLineDash([L.cell * 0.1, L.cell * 0.07]);
          g.beginPath(); g.arc(p.cx, p.cy, r + 5, 0, Math.PI * 2); g.stroke();
          g.restore();
        }
        stones(g, p.cx, p.cy, r, n, idx);
        g.fillStyle = n ? lk.text : lk.dim;
        g.font = font(700, 0.22); g.textAlign = 'center'; g.textBaseline = 'middle';
        const top = owner !== botSide();
        g.fillText(String(n), p.cx, top ? p.cy - r - L.cell * 0.16 : p.cy + r + L.cell * 0.16);
        /* house numbers, from each player's own left: the bottom row's always, the top row's with Coordinates */
        if (!top || S.look.coords) {
          g.fillStyle = S.look.coords ? lk.text : lk.label;
          g.font = font(S.look.coords ? 700 : 600, S.look.coords ? 0.17 : 0.16);
          g.fillText(String(k + 1), p.cx, top ? p.cy - r - L.cell * 0.38 : p.cy + r + L.cell * 0.38);
        }
      }
      /* the hand */
      if (S.hand && S.hand.at !== undefined) {
        const p = slotAt(L, S.hand.at);
        g.fillStyle = lk.text; g.font = font(800, 0.2); g.textAlign = 'center'; g.textBaseline = 'middle';
        if (S.hand.left > 0) g.fillText(`+${S.hand.left}`, p.cx, p.cy);
        g.strokeStyle = lk.mark; g.globalAlpha = 0.9; g.lineWidth = 3;
        g.beginPath(); g.arc(p.cx, p.cy, L.cell * (p.store ? 0.34 : 0.43), 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
      /* the keyboard's pit */
      if (S.kb && canAct()) {
        const p = slotAt(L, pitOf(mode === '2p' ? S.g.turn : me, S.cursor));
        g.strokeStyle = lk.mark; g.globalAlpha = 0.7; g.lineWidth = 2; g.setLineDash([4, 4]);
        g.beginPath(); g.arc(p.cx, p.cy, L.cell * 0.46, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const seatToMove = () => (mode === '2p' ? S.g.turn : me);
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), hit = pitAt(p.x, p.y);
      if (hit === -1) return;
      if (hit.s !== S.g.turn && mode === '2p') { snd.blip(140, 0.08, 'sawtooth', 0.4); return; }
      S.hover = hit;
      tryPit(hit.k);
    };
    const onMove = e => {
      const p = at(e), hit = pitAt(p.x, p.y);
      if (S.kb) S.kb = false;
      const same = (hit === -1 && S.hover === -1) || (hit !== -1 && S.hover !== -1 && hit.s === S.hover.s && hit.k === S.hover.k);
      if (!same) { S.hover = hit; sf.cv.style.cursor = hit !== -1 && canAct() && hit.s === seatToMove() ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    S.hover = -1;
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || opts.isOpen()) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        snd.wake();
        S.kb = true;
        S.cursor = Math.max(0, Math.min(PITS - 1, S.cursor + (k === 'ArrowLeft' ? -1 : 1)));
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); snd.wake(); S.kb = true; tryPit(S.cursor); return; }
      if (/^[1-6]$/.test(k)) { e.preventDefault(); snd.wake(); S.cursor = Number(k) - 1; S.kb = true; tryPit(S.cursor); return; }
      if ((k === 'h' || k === 'H') && hintBtn) { e.preventDefault(); hint(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    newGame();

    return {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        S.timers.forEach(clearTimeout); S.timers.clear();
        if (paintT) cancelAnimationFrame(paintT);
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
      /* what a watcher may see (./spectate.js 'pits'): the stones as they stand, whose turn, the bottom row is this screen's */
      spectate: () => ({
        k: 'pits', b: Array.from(S.busy || S.q.length ? S.show : S.g.b), bs: botSide(), turn: S.over ? -1 : S.g.turn,
        pl: [{ n: nameOf(0) }, { n: nameOf(1) }], txt: statusEl.textContent, over: !!S.over, ow: oware(),
      }),
      peek: () => {
        const L = S.geo;
        const slots = L ? Array.from({ length: 14 }, (_, i) => { const p = slotAt(L, i); return [Math.round(p.cx), Math.round(p.cy)]; }) : null;
        const o = S.over;
        return {
          mode, me: mode === '2p' ? null : me, turn: S.g.turn, board: Array.from(S.g.b), shown: Array.from(S.busy || S.q.length ? S.show : S.g.b),
          moves: S.g.moves.join(''), over: o ? { winner: o.winner, reason: o.reason || 'empty', score: o.score, end: o.end || null } : null,
          level: S.level, lowest: S.lowest, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected,
          sowing: S.busy || S.q.length > 0, cursor: S.cursor, myMoves: S.myMoves, ended: S.ended, slots, status: statusEl.textContent,
          legal: legal(S.g), reduced, rules: S.rules, quiet: S.g.quiet ?? null,
          hint: S.hint, hints: S.hints, hinting: S.hinting, look: { ...S.look }, theme: LK(), rulesText: rulesText(), note: note.textContent,
          record: { key: recKey(S.level), label: recLabel(S.level) },
        };
      },
    };
  },
};
