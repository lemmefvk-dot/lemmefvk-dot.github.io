/* ============================================================
   arcade/tactics.js — Tiny Tactics for Static Arcade.

   A four-piece skirmish on a 6×6 field (rules and the computer in
   ./tactics-logic.js; the Rules line under the board says them). Each
   turn every piece you have may act once: walk, then hit something in
   range. Knight (tough, hits next to it), Archer (hits 2–3 away),
   Mage (slow, hits hard) and Scout (fast, hits lightly). Defeat every
   enemy piece.

   · 1P: against the computer at Easy, Normal or Hard; you move first
     or it does (the first side moves just one piece in its first
     turn). Your won / lost / drawn record against each level is under
     the Level row (./records.js). A win scores the rounds it took —
     fewer is better.
   · Online: a friend through the Arcade's room. The host moves first in
     odd rounds, the guest in even ones; on your screen you are always
     at the bottom. Every ply that arrives is checked with the rules
     (whose turn, whose piece, a square it can reach, a target in
     range) before it touches the board — a forged or out-of-turn one is
     counted in `rejected` and ignored — and a ply that goes missing is
     asked for again (boardkit.js duelLink).

   Mouse or touch: tap one of your pieces (its reach lights up), tap
   where it should go (its own square to stay), then tap an enemy in
   range — or "No attack". Keyboard: arrows move the cursor, Space or
   Enter does what a tap would, Backspace steps back, E ends the turn.
   Pieces differ by shape as well as by colour (the Arcade's colour-blind
   set is used for yours and theirs), and an enemy has a dashed ring.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, surface, FONT, rr } from './kit.js';
import { CSS as BASE, reducedMotion, bag } from './puzzlekit.js';
import { store } from '../core/store.js';
import * as records from './records.js';
import { duelLink } from './boardkit.js';
import { PALETTE_CB } from './index.js';
import { N, MAX_ROUNDS, STONES, TYPES, newGame, apply, legal, reach, targets, aiTurn, health, alive, cellOf, xyOf, clone, unitAt } from './tactics-logic.js';

const PREF = 'portal.arcadeTactics';
const LEVELS = [{ id: 1, name: 'Easy' }, { id: 2, name: 'Normal' }, { id: 3, name: 'Hard' }];
const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me' };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };

const CSS = `${BASE}
.pz-tt__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-tt__stage{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);border-radius:14px;overflow:hidden;border:2px solid var(--line-2,rgba(255,255,255,.22));background:#10131c;outline:none;touch-action:none}
.pz-tt__stage:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-tt__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);text-align:center;padding:16px}
.pz-tt__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-tt__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz-tt__status{width:min(100%,760px);min-height:34px;display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 12px;border-radius:var(--r-md,11px);font-size:13px;font-weight:650;color:var(--ink-0,#fff);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.08));text-align:center;flex:0 0 auto}
.pz-tt__status.is-mine{border-color:color-mix(in srgb,var(--ga) 60%,transparent)}
.pz-tt__status.is-done{background:color-mix(in srgb,var(--ga) 22%,transparent)}
.pz-tt__info{font-size:12px;color:var(--ink-2,#bbb);text-align:center;min-height:16px}
`;

export default {
  mount(el, ctx = {}) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : 'cpu';
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = NET?.peer?.name || 'Your friend';
    let dead = false, paused = false;
    let level = prefs.level, first = prefs.first;
    /* which side I am: 0 moves first. Online: the host in odd rounds. */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 0 : 1) : first === 'cpu' ? 1 : 0;
    let G = newGame(), plies = [], by = [], rejected = 0, ended = false, lowest = level, resigned = false;
    let sel = -1, dest = -1, cur = cellOf(2, 4), msg = '', aiTimer = 0, endTimer = 0, busy = false;
    let fx = [], raf = 0, last = null;
    const cb = () => ctx.palette === 'cb';
    const mineCol = () => (cb() ? PALETTE_CB[1] : '#3ab6ff');
    const theirCol = () => (cb() ? PALETTE_CB[0] : '#ff9a3a');

    /* ---------- chrome ---------- */
    const seg = (label, opts, value, pick) => {
      const btns = opts.map(o => h('button', { type: 'button', dataset: { v: o.id }, 'aria-pressed': String(o.id === value), title: o.title || '' }, o.label));
      btns.forEach(b => L.on(b, 'click', () => pick(isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v)));
      const box = h('div.pz__seg', { role: 'group', 'aria-label': label }, btns);
      box.set = v => btns.forEach(b => b.setAttribute('aria-pressed', String((isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v) === v)));
      return box;
    };
    const levelSeg = mode === 'cpu' ? seg('Level', LEVELS.map(l => ({ id: l.id, label: l.name })), level, v => setLevel(v)) : null;
    const firstSeg = mode === 'cpu' ? seg('Who moves first', [{ id: 'me', label: 'You first' }, { id: 'cpu', label: 'Computer first' }], first, v => setFirst(v)) : null;
    const roundV = h('span', { text: '1' });
    const roundRead = h('div.pz__read', { title: `Round (the game ends after round ${MAX_ROUNDS})`, 'aria-label': 'Round' }, icon('clock'), roundV, h('small', { text: `/ ${MAX_ROUNDS}` }));
    const hpV = h('span', { text: '' });
    const hpRead = h('div.pz__read', { title: 'Health left: yours, then theirs', 'aria-label': 'Health' }, icon('shield'), hpV);
    const recLine = h('small.pz__note', { text: '' });
    const top = h('div.pz__top', ...(mode === 'cpu' ? [levelSeg, firstSeg] : []), roundRead, hpRead);
    const status = h('div.pz-tt__status', { role: 'status' });
    const stage = h('div.pz-tt__stage', { tabindex: '0', role: 'application', 'aria-label': 'Tiny Tactics field' });
    const bw = h('div.pz-tt__bw', stage);
    const info = h('div.pz-tt__info');
    const endBtn = h('button.pz__btn', { type: 'button', title: 'End your turn now (E)' }, icon('check'), h('span.pz__long', { text: 'End turn' }));
    const skipBtn = h('button.pz__btn', { type: 'button', title: 'Move there without hitting anything' }, icon('x'), h('span.pz__long', { text: 'No attack' }));
    const backBtn = h('button.pz__btn', { type: 'button', title: 'Step back (Backspace)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Back' }));
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Start a new game' }, icon('refresh'), h('span.pz__long', { text: 'New game' }));
    const resignLbl = h('span.pz__long', { text: 'Resign' });
    const resignBtn = h('button.pz__btn', { type: 'button', title: 'Give up this game' }, icon('flag'), resignLbl);
    let askResign = false;
    const bar = h('div.pz__bar', skipBtn, backBtn, endBtn, ...(mode === 'cpu' ? [newBtn] : []), resignBtn, recLine);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, status, bw, info, bar, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Tiny Tactics field', () => draw());
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; ctx.announce?.(m); };
    const side = () => ({ me, them: 1 - me });
    const nameOf = s => (s === me ? 'You' : mode === 'online' ? peerName : 'The computer');

    /* ---------- the online link ---------- */
    const link = NET ? duelLink(NET, {
      plies: () => plies.length,
      mine: i => by[i] === 'me',
      wire: i => (plies[i].e === 1 ? { e: 1 } : { u: plies[i].u, to: plies[i].to, at: plies[i].at }),
      take: d => {
        if (G.over || G.turn === me) return false;
        const ply = d.e === 1 ? { e: 1 } : { u: d.u, to: d.to, at: d.at };
        if (!legal(G, ply)) return false;
        commit(ply, 'peer');
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
    const flip = () => me === 1;
    const view = (x, y) => (flip() ? [N - 1 - x, N - 1 - y] : [x, y]);
    const geom = () => { const s = Math.min(sf.w, sf.h), c = s / N; return { c, ox: (sf.w - s) / 2, oy: (sf.h - s) / 2 }; };
    const centre = (x, y, Gm = geom()) => { const [vx, vy] = view(x, y); return [Gm.ox + (vx + 0.5) * Gm.c, Gm.oy + (vy + 0.5) * Gm.c]; };
    const sel_ = () => (sel >= 0 ? G.units[sel] : null);
    const range = () => { const u = sel_(); return u && dest < 0 && u.hp > 0 ? reach(G, u) : null; };
    const aim = () => { const u = sel_(); if (!u || dest < 0) return []; const [x, y] = xyOf(dest); return targets(G, u, x, y); };
    function unitShape(g, t, x, y, r) {
      g.beginPath();
      if (t === 'K') { rr(g, x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6, r * 0.25); }
      else if (t === 'A') { g.moveTo(x, y - r); g.lineTo(x + r * 0.95, y + r * 0.8); g.lineTo(x - r * 0.95, y + r * 0.8); g.closePath(); }
      else if (t === 'M') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.5 : r; g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } g.closePath(); }
      else { g.arc(x, y, r * 0.85, 0, 7); }
    }
    function draw() {
      if (!sf.g) return;
      const g = sf.g, Gm = geom(), c = Gm.c;
      sf.begin();
      g.fillStyle = '#0c0f16'; g.fillRect(0, 0, sf.w, sf.h);
      const rg = range(), tg = aim(), tgId = new Set(tg.map(u => u.id));
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const [vx, vy] = view(x, y), px = Gm.ox + vx * c, py = Gm.oy + vy * c;
        g.fillStyle = (x + y) % 2 ? '#1a2030' : '#1f2638'; g.fillRect(px, py, c, c);
        if (rg && rg.has(cellOf(x, y))) { g.fillStyle = 'rgba(58,182,255,.26)'; g.fillRect(px, py, c, c); g.strokeStyle = 'rgba(120,210,255,.7)'; g.lineWidth = 1.5; g.strokeRect(px + 2, py + 2, c - 4, c - 4); }
        if (dest >= 0 && cellOf(x, y) === dest) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(px + 3, py + 3, c - 6, c - 6); }
      }
      for (const [x, y] of STONES) {
        const [cx, cy] = centre(x, y, Gm);
        g.fillStyle = '#586280'; rr(g, cx - c * 0.42, cy - c * 0.4, c * 0.84, c * 0.8, c * 0.2); g.fill();
        g.fillStyle = '#3d455e'; rr(g, cx - c * 0.3, cy - c * 0.3, c * 0.6, c * 0.55, c * 0.14); g.fill();
      }
      for (const u of G.units) {
        if (u.hp <= 0) continue;
        const [cx, cy] = centre(u.x, u.y, Gm), r = c * 0.3, mineU = u.side === me;
        const col = mineU ? mineCol() : theirCol();
        const isSel = u.id === sel;
        if (tgId.has(u.id)) { g.strokeStyle = '#ff4466'; g.lineWidth = 3.5; g.beginPath(); g.arc(cx, cy, c * 0.46, 0, 7); g.stroke(); }
        g.globalAlpha = u.acted && u.side === G.turn ? 0.5 : 1;
        g.strokeStyle = mineU ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.7)'; g.lineWidth = 2;
        if (!mineU) g.setLineDash([c * 0.07, c * 0.06]);
        g.beginPath(); g.arc(cx, cy, c * 0.4, 0, 7); g.stroke(); g.setLineDash([]);
        if (isSel) { g.strokeStyle = '#fff'; g.lineWidth = 3.5; g.beginPath(); g.arc(cx, cy, c * 0.43, 0, 7); g.stroke(); }
        g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.5;
        unitShape(g, u.type, cx, cy, r); g.fill(); g.stroke();
        g.fillStyle = 'rgba(0,0,0,.6)'; g.font = `800 ${Math.round(c * 0.22)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(u.type, cx, cy + (u.type === 'A' ? c * 0.08 : 0));
        g.globalAlpha = 1;
        /* health pips under the piece */
        const max = TYPES[u.type].hp, pw = Math.min(c * 0.1, c * 0.6 / max);
        for (let i = 0; i < max; i++) { g.fillStyle = i < u.hp ? '#58f2a2' : 'rgba(255,255,255,.18)'; g.fillRect(cx - (max * pw) / 2 + i * pw + 0.5, cy + c * 0.36, pw - 1, c * 0.06); }
      }
      /* the cursor, for keyboard play */
      if (kbd && !G.over) { const [x, y] = xyOf(cur), [vx, vy] = view(x, y); g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([5, 4]); g.strokeRect(Gm.ox + vx * c + 4, Gm.oy + vy * c + 4, c - 8, c - 8); g.setLineDash([]); }
      /* hits: a number that rises */
      const now = performance.now();
      for (const f of fx) {
        const k = Math.min(1, (now - f.t0) / 800), [cx, cy] = centre(f.x, f.y, Gm);
        g.globalAlpha = 1 - k * 0.8; g.fillStyle = f.kill ? '#ff4466' : '#ffd24a'; g.font = `900 ${Math.round(c * 0.36)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(f.kill ? `-${f.n} ✕` : `-${f.n}`, cx, cy - c * 0.5 - (reduced ? 0 : k * c * 0.35)); g.globalAlpha = 1;
      }
    }
    let kbd = false;
    function loop() {
      raf = 0;
      if (dead) return;
      const now = performance.now();
      fx = fx.filter(f => now - f.t0 < 800);
      draw();
      if (fx.length) raf = requestAnimationFrame(loop);
    }
    const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(loop); };

    /* ---------- the board's words ---------- */
    const myTurn = () => !G.over && G.turn === me && !busy;
    function paint() {
      const mt = myTurn();
      status.classList.toggle('is-mine', mt);
      status.classList.toggle('is-done', !!G.over);
      let t;
      if (G.over) t = G.over.winner < 0 ? 'A draw.' : G.over.winner === me ? 'You win!' : `${nameOf(1 - me)} win${mode === 'online' ? 's' : ''}.`;
      else if (mt) t = sel < 0 ? `Your turn: ${alive(G, me).filter(u => !u.acted).length} piece${alive(G, me).filter(u => !u.acted).length === 1 ? '' : 's'} left to act.` : dest < 0 ? 'Choose where it goes (its own square to stay).' : aim().length ? 'Hit an enemy in range, or choose No attack.' : 'Done.';
      else t = mode === 'online' ? `${peerName} is moving…` : 'The computer is thinking…';
      status.textContent = t;
      roundV.textContent = String(Math.min(G.round, MAX_ROUNDS));
      hpV.textContent = `${health(G, me)} · ${health(G, 1 - me)}`;
      endBtn.disabled = !mt;
      skipBtn.hidden = !(mt && sel >= 0 && dest >= 0);
      backBtn.hidden = !(mt && sel >= 0);
      resignBtn.disabled = !!G.over;
      resignLbl.textContent = askResign ? 'Really resign?' : 'Resign';
      resignBtn.classList.toggle('is-warn', askResign);
      const u = sel_() || (G.units[unitIdAt(cur)] || null);
      info.textContent = u && u.hp > 0 ? `${u.side === me ? 'Your' : 'Enemy'} ${TYPES[u.type].name}: ${u.hp}/${TYPES[u.type].hp} health · moves ${TYPES[u.type].mv} · hits ${TYPES[u.type].min === TYPES[u.type].max ? TYPES[u.type].max : `${TYPES[u.type].min}–${TYPES[u.type].max}`} away for ${TYPES[u.type].dmg}` : '';
      foot.replaceChildren(msg ? h('span', { text: msg }) : h('span.pz__hint', { text: 'tap a piece, then where it goes, then who it hits · E ends the turn' }));
      draw();
    }
    const unitIdAt = c => { const [x, y] = xyOf(c); return unitAt(G, x, y)?.id ?? -1; };

    /* ---------- playing ---------- */
    function commit(ply, who) {
      const before = G;
      const u = ply.e === 1 ? null : before.units[ply.u];
      G = apply(G, ply);
      plies.push(ply); by.push(who);
      if (u && ply.at >= 0) {
        const t = G.units[ply.at];
        const [tx, ty] = [t.x, t.y];
        fx.push({ x: tx, y: ty, n: TYPES[u.type].dmg, kill: t.hp <= 0, t0: performance.now() });
        kick();
      }
      sel = -1; dest = -1; askResign = false;
      const who2 = who === 'me' ? 'You' : who === 'peer' ? peerName : 'The computer';
      say(ply.e === 1 ? `${who2} ended the turn.` : `${who2}: ${TYPES[u.type].name}${ply.to !== cellOf(u.x, u.y) ? ' moves' : ' stays'}${ply.at >= 0 ? ` and hits the ${TYPES[before.units[ply.at].type].name} for ${TYPES[u.type].dmg}${G.units[ply.at].hp <= 0 ? ', defeating it' : ''}` : ''}.`);
      if (who === 'me' && link) link.sendMove(plies.length - 1);
      paint();
      if (G.over) { if (!busy) finishSoon(); return; }
      if (mode === 'cpu' && G.turn !== me) planAI();
    }
    /* the computer: its whole turn is worked out at once, then played one ply at a time */
    function planAI() {
      clearTimeout(aiTimer);
      busy = true;
      paint();
      aiTimer = setTimeout(() => {
        if (dead) return;
        const turn = aiTurn(G, level, (plies.length + 1) * 7919 + level);
        let i = 0;
        const next = () => {
          if (dead) return;
          if (paused) { aiTimer = setTimeout(next, 200); return; }
          if (i >= turn.length || G.over || G.turn === me) { busy = false; paint(); if (G.over) finishSoon(); return; }
          const ply = turn[i++];
          if (!legal(G, ply)) { busy = false; paint(); return; }
          commit(ply, 'cpu');
          aiTimer = setTimeout(next, reduced ? 220 : 520);
        };
        next();
      }, reduced ? 120 : 450);
    }
    function finishSoon() {
      clearTimeout(endTimer);
      endTimer = setTimeout(finish, reduced ? 300 : 1000);
    }
    function finish() {
      if (ended || dead || !G.over) return;
      ended = true;
      const o = G.over, won = o.winner < 0 ? null : o.winner === me;
      const rounds = Math.min(G.round, MAX_ROUNDS);
      const why = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`) : o.reason === 'rounds' ? `Round ${MAX_ROUNDS} ended: ${health(G, me)} health to ${health(G, 1 - me)}.` : won ? `Every enemy piece defeated in round ${rounds}.` : `All your pieces were defeated in round ${rounds}.`;
      if (mode === 'online') { onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail: why }); return; }
      const vs = { key: String(lowest), label: LEVELS[lowest - 1].name, result: won === null ? 'draw' : won ? 'win' : 'loss' };
      onEnd({ score: won ? rounds : null, won: !!won, detail: `${why} Against the computer (${LEVELS[lowest - 1].name}).`, vs });
      recLine.textContent = records.vsOf('tactics', vs.key) ? recText(records.vsOf('tactics', vs.key)) : '';
    }
    const recText = r => (r && (r.w || r.l || r.d) ? `${r.w}–${r.l}–${r.d} (won–lost–drawn)` : '');
    function showRecord() { try { recLine.textContent = recText(records.vsOf('tactics', String(level))); } catch (err) { recLine.textContent = ''; } }

    /* a click or key on square c: the three steps of a piece's action */
    function choose(c) {
      if (dead || paused || !myTurn()) return;
      const u = sel_();
      const at = unitIdAt(c), au = at >= 0 ? G.units[at] : null;
      if (!u) {
        if (au && au.side === me && !au.acted) { sel = au.id; dest = -1; say(`${TYPES[au.type].name} selected: pick a square to move to.`); paint(); }
        return;
      }
      if (dest < 0) {
        if (au && au.side === me && !au.acted && au.id !== u.id) { sel = au.id; paint(); return; }
        if (!reach(G, u).has(c)) { sel = -1; paint(); return; }
        dest = c;
        const [x, y] = xyOf(c);
        if (!targets(G, u, x, y).length) { commit({ u: u.id, to: c, at: -1 }, 'me'); return; }
        paint();
        return;
      }
      if (c === dest) { commit({ u: u.id, to: dest, at: -1 }, 'me'); return; }
      if (au && aim().some(t => t.id === au.id)) { commit({ u: u.id, to: dest, at: au.id }, 'me'); return; }
      dest = -1; paint();
    }
    const stepBack = () => { if (dead || paused) return; if (dest >= 0) dest = -1; else sel = -1; paint(); };
    const endTurn = () => { if (dead || paused || !myTurn()) return; commit({ e: 1 }, 'me'); };
    const skipAttack = () => { const u = sel_(); if (dead || paused || !myTurn() || !u || dest < 0) return; commit({ u: u.id, to: dest, at: -1 }, 'me'); };

    function newGameNow() {
      clearTimeout(aiTimer); clearTimeout(endTimer);
      G = newGame(); plies = []; by = []; ended = false; busy = false; sel = -1; dest = -1; msg = ''; fx = []; lowest = level; resigned = false; askResign = false;
      me = first === 'cpu' ? 1 : 0;
      cur = me === 0 ? cellOf(2, 4) : cellOf(3, 1);
      bw.querySelector('.pz-tt__card')?.remove();
      onScore(0);
      paint(); showRecord();
      say(me === 0 ? 'You move first (just one piece this turn).' : 'The computer moves first.');
      if (G.turn !== me) planAI();
    }
    function setLevel(v) { level = v; lowest = Math.min(lowest, v); writePrefs({ level }); levelSeg.set(v); showRecord(); paint(); }
    function setFirst(v) { first = v; writePrefs({ first }); firstSeg.set(v); newGameNow(); }
    function resign() {
      if (dead || G.over) return;
      if (!askResign) { askResign = true; paint(); return; }
      clearTimeout(aiTimer); busy = false;
      G = { ...clone(G), over: { winner: 1 - me, reason: 'resign', who: 'me' } };
      link?.resign();
      say('You resigned.');
      paint(); finishSoon();
    }

    /* ---------- input ---------- */
    L.on(sf.cv, 'pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      const b = sf.cv.getBoundingClientRect(), Gm = geom();
      const vx = Math.floor((e.clientX - b.left - Gm.ox) / Gm.c), vy = Math.floor((e.clientY - b.top - Gm.oy) / Gm.c);
      if (vx < 0 || vy < 0 || vx >= N || vy >= N) return;
      const [x, y] = flip() ? [N - 1 - vx, N - 1 - vy] : [vx, vy];
      kbd = false; cur = cellOf(x, y);
      stage.focus({ preventScroll: true });
      choose(cur);
    });
    L.on(sf.cv, 'contextmenu', e => { e.preventDefault(); stepBack(); });
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault(); kbd = true;
        /* the arrows follow the screen: up is toward the top whichever side you are */
        const [dx, dy] = MOVE[k], [x, y] = xyOf(cur);
        const sx = flip() ? -dx : dx, sy = flip() ? -dy : dy;
        const nx = x + sx, ny = y + sy;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N) cur = cellOf(nx, ny);
        paint();
      } else if (k === ' ' || k === 'Enter') { if (G.over) return; e.preventDefault(); unfocus(); if (!e.repeat) { kbd = true; choose(cur); } }
      else if (k === 'Backspace') { e.preventDefault(); stepBack(); }
      else if (k === 'e' || k === 'E') { e.preventDefault(); endTurn(); }
    });
    L.on(endBtn, 'click', endTurn);
    L.on(skipBtn, 'click', skipAttack);
    L.on(backBtn, 'click', stepBack);
    L.on(newBtn, 'click', () => { if (!dead) newGameNow(); });
    L.on(resignBtn, 'click', resign);

    paint(); showRecord();
    say(mode === 'online' ? `${me === 0 ? 'You move first (just one piece this turn).' : `${peerName} moves first.`} Your pieces are blue, at the bottom.` : me === 0 ? 'You move first (just one piece this turn).' : 'The computer moves first.');
    if (mode === 'cpu' && G.turn !== me) planAI();
    requestAnimationFrame(() => { if (!dead) stage.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() { if (dead) return; dead = true; clearTimeout(aiTimer); clearTimeout(endTimer); cancelAnimationFrame(raf); link?.stop(); L.clear(); sf.destroy(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); },
      peek: () => ({
        mode, me, turn: G.turn, round: G.round, units: G.units.map(u => ({ ...u })), sel, dest, over: G.over ? { ...G.over } : null, plies: plies.length, by: by.slice(), level, first,
        rejected, busy, paused, myTurn: myTurn(), health: [health(G, 0), health(G, 1)], flip: flip(), cursor: cur,
        geo: (() => { const Gm = geom(), b = sf.cv.getBoundingClientRect(); return { left: b.left, top: b.top, ox: Gm.ox, oy: Gm.oy, c: Gm.c }; })(),
        online: NET ? { role: NET.role, round, step: plies.length } : null, palette: cb() ? 'cb' : 'standard', log: plies.map(p => ({ ...p })),
      }),
      /* test hook — nothing in the game calls it: units([{ id, x, y, hp }]) rearranges a game that is not online */
      hook(cmd, arg) {
        if (cmd === 'units' && !NET && Array.isArray(arg)) {
          const n = clone(G);
          for (const a of arg) { const u = n.units[a.id]; if (u) { if (Number.isInteger(a.x)) u.x = a.x; if (Number.isInteger(a.y)) u.y = a.y; if (Number.isFinite(a.hp)) u.hp = a.hp; } }
          G = n; sel = -1; dest = -1; paint();
        }
        return true;
      },
    };
  },
};
