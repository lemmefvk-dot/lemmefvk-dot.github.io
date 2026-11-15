/* ============================================================
   arcade/tread.js — Tread Duel for Static Arcade.

   Two tanks in a walled yard, seen from above, taking turns. On your
   turn do one thing: turn and drive one square (arrow keys or WASD, or
   tap beside your tank), or fire (Space or F, or tap your own tank):
   the shell flies straight on and stops at the first thing it meets
   (bricks fall, steel stops it, a tank loses one of three health). A
   tank that just fired is reloading for its next action. Rules and the
   computer player are in ./tread-logic.js.

   · 1P: against the computer at Easy, Normal or Hard (who moves first
     alternates with each new game). A win scores the actions you took;
     your won–lost–drawn record per level is kept (./records.js).
   · Online: a friend through the Arcade's room by friend code. The room
     gives both screens the same seed, so both draw the same yard; the
     host moves first in odd rounds. Every action that arrives is
     checked with the rules (whose turn, a real action, a shot that is
     allowed) before it touches the board, a forged or out-of-turn one
     is counted in `rejected` and ignored, and a missing one is asked
     for again (boardkit.js duelLink).

   Draws only when something changes (no frame loop), so a hidden or
   paused window costs nothing. All art is drawn in code. Reduced
   motion: the shell's flash is a still line, shorter.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, surface, FONT, rr, rng, randomSeed } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import * as records from './records.js';
import { duelLink } from './boardkit.js';
import { PALETTE_CB } from './index.js';
import { W, H, HP, DX, DY, FLOOR, BRICK, STEEL, LEVELS, newGame, legal, apply, aiMove, trace } from './tread-logic.js';

const KEYS = { ArrowUp: 'u', KeyW: 'u', ArrowRight: 'r', KeyD: 'r', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', Space: 'f', KeyF: 'f' };
const CSS = `${BASE}
.td__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.td__stage{position:relative;width:min(100cqw,calc(100cqh * 11 / 9));aspect-ratio:11/9;border-radius:14px;overflow:hidden;border:2px solid var(--line-2,rgba(255,255,255,.22));background:#10131c;outline:none}
.td__stage:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.td__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);text-align:center;padding:16px}
.td__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.td__card span{font-size:13px;color:var(--ink-2,#bbb)}
.td__status{width:min(100%,760px);min-height:34px;display:flex;align-items:center;justify-content:center;padding:6px 12px;border-radius:var(--r-md,11px);font-size:13px;font-weight:650;color:var(--ink-1,#eee);background:var(--fill-0,rgba(255,255,255,.04));border:1px solid var(--line-1,rgba(255,255,255,.08))}
.td__status.is-mine{border-color:color-mix(in srgb,var(--ga) 60%,transparent)}
`;

export default {
  mount(el, ctx = {}) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : 'cpu';
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const sv = load('treadduel');
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = NET?.peer?.name || 'Your friend';
    let level = [1, 2, 3].includes(sv.level) ? sv.level : 2;
    let dead = false, paused = false, games = 0;
    let seed = NET ? (NET.seed >>> 0) : Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : randomSeed();
    let me = NET ? ((round % 2 === 1) === host ? 0 : 1) : 0;
    let G = newGame(seed), plies = [], by = [], rejected = 0, ended = false, lowest = level, busy = false, aiTimer = 0, endTimer = 0, flashT = 0, flashUntil = 0, msg = '';
    const cb = () => ctx.palette === 'cb';
    const mineCol = () => (cb() ? PALETTE_CB[1] : '#3ab6ff');
    const theirCol = () => (cb() ? PALETTE_CB[0] : '#ff9a3a');

    /* ---------- chrome ---------- */
    const levelBtns = LEVELS.map(l => h('button', { type: 'button', dataset: { v: String(l.id) }, 'aria-pressed': String(l.id === level) }, l.name));
    const levelSeg = h('div.pz__seg', { role: 'group', 'aria-label': 'Level' }, levelBtns);
    const hpV = h('span', { text: '' });
    const hpRead = h('div.pz__read', { title: 'Health: yours, then theirs', 'aria-label': 'Health' }, icon('shield'), hpV);
    const turnV = h('span', { text: '0' });
    const turnRead = h('div.pz__read', { title: 'Actions left for each tank before the game is decided on health', 'aria-label': 'Actions left' }, icon('clock'), turnV);
    const recLine = h('small.pz__note', { text: '' });
    const status = h('div.td__status', { role: 'status' });
    const stage = h('div.td__stage', { tabindex: '0', role: 'application', 'aria-label': 'Tread Duel yard' });
    const bw = h('div.td__bw', stage);
    const fireBtn = h('button.pz__btn', { type: 'button', title: 'Fire (Space or F)', dataset: { act: 'fire' } }, icon('zap'), h('span.pz__long', { text: 'Fire' }));
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Start a new game', dataset: { act: 'new' } }, icon('refresh'), h('span.pz__long', { text: 'New game' }));
    const resignLbl = h('span.pz__long', { text: 'Resign' });
    const resignBtn = h('button.pz__btn', { type: 'button', title: 'Give up this game', dataset: { act: 'resign' } }, icon('x'), resignLbl);
    let askResign = false;
    const top = h('div.pz__top', ...(mode === 'cpu' ? [levelSeg] : []), hpRead, turnRead);
    const bar = h('div.pz__bar', fireBtn, ...(mode === 'cpu' ? [newBtn] : []), resignBtn, recLine);
    const foot = h('div.pz__foot', { text: 'Arrows or WASD turn and drive · Space or F fires · or tap beside your tank, or on it to fire' });
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, status, bw, bar, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Tread Duel yard', () => draw());
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; ctx.announce?.(m); };
    const nameOf = s => (s === me ? 'You' : mode === 'online' ? peerName : 'The computer');
    const myTurn = () => !G.over && G.turn === me;

    /* ---------- the online link ---------- */
    const link = NET ? duelLink(NET, {
      plies: () => plies.length,
      mine: i => by[i] === 'me',
      wire: i => ({ a: plies[i] }),
      take: d => {
        if (G.over || G.turn === me || typeof d.a !== 'string' || !legal(G, 1 - me, d.a)) return false;
        commit(d.a, 'peer');
        return true;
      },
      reject: () => { rejected++; },
      resigned: () => {
        if (G.over) return;
        G.over = { winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`);
        paint(); finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ---------- drawing ---------- */
    const geom = () => { const c = Math.min(sf.w / W, sf.h / H); return { c, ox: (sf.w - c * W) / 2, oy: (sf.h - c * H) / 2 }; };
    function tank(g, t, cx, cy, c, col, mine) {
      g.save(); g.translate(cx, cy); g.rotate(t.d * Math.PI / 2);
      g.fillStyle = 'rgba(0,0,0,.3)'; rr(g, -c * 0.3, -c * 0.36, c * 0.6, c * 0.76, c * 0.08); g.fill();
      g.fillStyle = '#2b2f3d'; g.fillRect(-c * 0.38, -c * 0.34, c * 0.14, c * 0.68); g.fillRect(c * 0.24, -c * 0.34, c * 0.14, c * 0.68);
      g.fillStyle = col; rr(g, -c * 0.26, -c * 0.32, c * 0.52, c * 0.64, c * 0.07); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = mine ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(0, 0, c * 0.17, 0, 7); g.fill();
      g.fillStyle = '#e7ecf5'; g.fillRect(-c * 0.045, -c * 0.5, c * 0.09, c * 0.42);
      g.restore();
      for (let i = 0; i < HP; i++) { g.fillStyle = i < t.hp ? '#58f2a2' : 'rgba(255,255,255,.2)'; g.fillRect(cx - c * 0.3 + i * c * 0.21, cy + c * 0.42, c * 0.18, c * 0.07); }
      if (t.reload) { g.fillStyle = '#ffd23f'; g.font = `700 ${Math.round(c * 0.16)}px ${FONT}`; g.textAlign = 'center'; g.fillText('reload', cx, cy - c * 0.44); }
    }
    function draw() {
      if (dead || !sf.g) return;
      const g = sf.g, Gm = geom(), c = Gm.c;
      sf.begin();
      g.fillStyle = '#0c0f16'; g.fillRect(0, 0, sf.w, sf.h);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const px = Gm.ox + x * c, py = Gm.oy + y * c, m = G.map[y * W + x];
        g.fillStyle = (x + y) % 2 ? '#1a2030' : '#1f2638'; g.fillRect(px, py, c, c);
        if (m === BRICK) {
          g.fillStyle = '#b5532f'; g.fillRect(px + 1, py + 1, c - 2, c - 2);
          g.fillStyle = '#7d3519'; g.fillRect(px + 1, py + c / 2 - 1, c - 2, 2); g.fillRect(px + c / 2 - 1, py + 1, 2, c / 2 - 2); g.fillRect(px + c / 4 - 1, py + c / 2 + 1, 2, c / 2 - 2); g.fillRect(px + 3 * c / 4 - 1, py + c / 2 + 1, 2, c / 2 - 2);
        } else if (m === STEEL) {
          g.fillStyle = '#6b7691'; g.fillRect(px + 1, py + 1, c - 2, c - 2);
          g.fillStyle = '#8b97b4'; g.fillRect(px + 3, py + 3, c - 6, 3);
          g.fillStyle = '#434c64'; for (const [ax, ay] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) { g.beginPath(); g.arc(px + ax * c, py + ay * c, c * 0.05, 0, 7); g.fill(); }
        }
      }
      /* the line of fire of whoever's turn it is, while you decide */
      if (myTurn() && !busy) {
        const r = trace(G, me), t = G.tanks[me];
        g.strokeStyle = r.kind === 'tank' ? 'rgba(255,90,90,.7)' : 'rgba(255,255,255,.22)'; g.setLineDash([c * 0.1, c * 0.1]); g.lineWidth = 2;
        g.beginPath(); g.moveTo(Gm.ox + (t.x + 0.5) * c, Gm.oy + (t.y + 0.5) * c); g.lineTo(Gm.ox + (r.x + 0.5) * c, Gm.oy + (r.y + 0.5) * c); g.stroke(); g.setLineDash([]);
      }
      for (let s = 0; s < 2; s++) { const t = G.tanks[s]; tank(g, t, Gm.ox + (t.x + 0.5) * c, Gm.oy + (t.y + 0.5) * c, c, s === me ? mineCol() : theirCol(), s === me); }
      if (G.shot && performance.now() < flashUntil) {
        const sh = G.shot, tx = Gm.ox + (sh.to[0] + 0.5) * c, ty = Gm.oy + (sh.to[1] + 0.5) * c;
        const tk = G.tanks[sh.side], ex = sh.kind === 'edge' ? tx : tx + DX[tk.d] * c * 0.5, ey = sh.kind === 'edge' ? ty : ty + DY[tk.d] * c * 0.5;
        g.strokeStyle = '#ffe28a'; g.lineWidth = Math.max(3, c * 0.09); g.beginPath(); g.moveTo(Gm.ox + (sh.from[0] + 0.5) * c, Gm.oy + (sh.from[1] + 0.5) * c); g.lineTo(ex, ey); g.stroke();
        if (sh.kind === 'tank' || sh.kind === 'brick') { g.fillStyle = '#ff7a3c'; g.beginPath(); g.arc(ex, ey, c * 0.22, 0, 7); g.fill(); }
      }
    }
    function paint() {
      hpV.textContent = `${G.tanks[me].hp} – ${G.tanks[1 - me].hp}`;
      turnV.textContent = String(Math.max(0, MAXA - G.acts[me]));
      let t;
      if (G.over) t = G.over.winner < 0 ? 'A draw: the same health.' : G.over.winner === me ? 'You win!' : `${nameOf(1 - me)} win${mode === 'online' ? 's' : ''}.`;
      else if (myTurn()) t = 'Your turn';
      else t = mode === 'online' ? `${peerName} is moving…` : 'The computer is thinking…';
      status.textContent = t; status.classList.toggle('is-mine', myTurn());
      fireBtn.disabled = !myTurn() || !legal(G, me, 'f');
      resignBtn.disabled = !!G.over;
      resignLbl.textContent = askResign ? 'Really resign?' : 'Resign';
      draw();
    }
    const MAXA = 40;

    /* ---------- playing ---------- */
    function commit(a, who) {
      const side = G.turn;
      apply(G, side, a);
      plies.push(a); by.push(who);
      if (G.shot) { flashUntil = performance.now() + (reduced ? 160 : 320); clearTimeout(flashT); flashT = setTimeout(() => { if (!dead) draw(); }, reduced ? 180 : 340); }
      askResign = false;
      const hit = G.shot && G.shot.kind === 'tank';
      say(`${nameOf(side)}: ${a === 'f' ? (hit ? 'fires and hits' : G.shot.kind === 'brick' ? 'fires and breaks a wall' : 'fires') : 'moves'}.`);
      if (who === 'me' && link) link.sendMove(plies.length - 1);
      onScore(G.acts[me]);
      paint();
      if (G.over) { finishSoon(); return; }
      if (mode === 'cpu' && G.turn !== me) planAI();
    }
    function planAI() {
      clearTimeout(aiTimer); busy = true; paint();
      const go = () => {
        if (dead) return;
        if (paused) { aiTimer = setTimeout(go, 200); return; }
        busy = false;
        if (G.over || G.turn === me) { paint(); return; }
        commit(aiMove(G, level, rng(G.seed + G.n * 7919 + level)), 'cpu');
      };
      aiTimer = setTimeout(go, reduced ? 200 : 520);
    }
    function finishSoon() { clearTimeout(endTimer); endTimer = setTimeout(finish, reduced ? 300 : 900); }
    function finish() {
      if (ended || dead || !G.over) return;
      ended = true;
      const o = G.over, won = o.winner < 0 ? null : o.winner === me;
      const why = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
        : o.reason === 'turns' ? `Out of actions: ${G.tanks[me].hp} health to ${G.tanks[1 - me].hp}.`
          : won ? `${mode === 'online' ? peerName : 'The computer'}’s tank destroyed in ${G.acts[me]} actions.` : 'Your tank was destroyed.';
      if (mode === 'online') { onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail: why }); return; }
      const vs = { key: String(lowest), label: LEVELS[lowest - 1].name, result: won === null ? 'draw' : won ? 'win' : 'loss' };
      onEnd({ score: won ? G.acts[me] : null, won: !!won, detail: `${why} Against the computer (${LEVELS[lowest - 1].name}).`, vs });
      showRecord();
    }
    const recText = r => (r && (r.w || r.l || r.d) ? `${r.w}–${r.l}–${r.d} (won–lost–drawn)` : '');
    function showRecord() { try { recLine.textContent = mode === 'cpu' ? recText(records.vsOf('treadduel', String(level))) : ''; } catch (err) { recLine.textContent = ''; } }
    const act = a => { if (dead || paused || busy || !myTurn() || !legal(G, me, a)) return false; commit(a, 'me'); return true; };

    function newGameNow() {
      clearTimeout(aiTimer); clearTimeout(endTimer);
      games++;
      seed = randomSeed();
      G = newGame(seed); plies = []; by = []; ended = false; busy = false; askResign = false; lowest = level; msg = '';
      me = games % 2 ? 1 : 0;
      bw.querySelector('.td__card')?.remove();
      onScore(0);
      paint(); showRecord();
      say(me === 0 ? 'You move first.' : 'The computer moves first.');
      if (G.turn !== me) planAI();
    }
    function setLevel(v) { level = v; lowest = Math.min(lowest, v); save('treadduel', { level }); levelBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === v))); showRecord(); paint(); }
    function resign() {
      if (dead || G.over) return;
      if (!askResign) { askResign = true; paint(); return; }
      clearTimeout(aiTimer); busy = false;
      G.over = { winner: 1 - me, reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.');
      paint(); finishSoon();
    }

    /* ---------- input ---------- */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const a = KEYS[e.code];
      if (!a) return;
      e.preventDefault();
      if (!e.repeat) act(a);
    });
    L.on(sf.cv, 'pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault(); stage.focus({ preventScroll: true });
      const b = sf.cv.getBoundingClientRect(), Gm = geom();
      const x = Math.floor((e.clientX - b.left - Gm.ox) / Gm.c), y = Math.floor((e.clientY - b.top - Gm.oy) / Gm.c);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const t = G.tanks[me], dx = x - t.x, dy = y - t.y;
      if (!dx && !dy) { act('f'); return; }
      act(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
    });
    levelBtns.forEach(b => L.on(b, 'click', () => setLevel(+b.dataset.v)));
    L.on(fireBtn, 'click', () => act('f'));
    L.on(newBtn, 'click', () => { if (!dead) newGameNow(); });
    L.on(resignBtn, 'click', resign);

    paint(); showRecord();
    say(me === 0 ? 'You move first.' : `${mode === 'online' ? peerName : 'The computer'} moves first.`);
    if (mode === 'cpu' && G.turn !== me) planAI();
    requestAnimationFrame(() => { if (!dead) stage.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() { if (dead) return; dead = true; clearTimeout(aiTimer); clearTimeout(endTimer); clearTimeout(flashT); link?.stop(); L.clear(); sf.destroy(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); },
      peek: () => ({
        mode, me, turn: G.turn, seed: G.seed, over: G.over ? { ...G.over } : null, plies: plies.length, by: by.slice(), log: plies.slice(), level, rejected, busy, paused, myTurn: myTurn(),
        health: [G.tanks[0].hp, G.tanks[1].hp], tanks: G.tanks.map(t => ({ ...t })), map: Array.from(G.map), acts: G.acts.slice(), n: G.n, cols: W, rows: H,
        online: NET ? { role: NET.role, round, step: plies.length } : null, palette: cb() ? 'cb' : 'standard',
        geo: (() => { const Gm = geom(), b = sf.cv.getBoundingClientRect(); return { left: b.left, top: b.top, ox: Gm.ox, oy: Gm.oy, c: Gm.c }; })(),
      }),
    };
  },
};
