/* ============================================================
   arcade/pool.js — 8-Ball Pool for Static Arcade.

   Against the computer (Easy, Medium or Hard) or a friend on the
   same screen (choose 2 players in the Arcade). Pocket your whole
   group — solids 1–7 or stripes 9–15 — then the 8. The rules are
   in ./pool-rules.js, the physics in ./pool-sim.js and the
   computer's play in ./pool-ai.js; each is tested on its own.
   Pocketing the 8 early loses.

   Aim: move the mouse and the cue points at it (a thin line shows
   where the cue ball will first touch). Press and drag back
   from there — like pulling the cue — and let go to shoot; the
   farther you pull, the harder the shot. Keyboard: ← → turn the aim
   (Shift for fine), hold Space and release to shoot. After a foul the
   next player has ball in hand: click (or move with the arrows and
   press Space) to place the cue ball anywhere free.

   Simplified: no spin, no called pockets, ball in hand anywhere;
   see pool-rules.js for the full list. Online play is not offered.
   The world advances in fixed 1/480 s steps (./fixed.js).
   Score = your shots in a win against the computer (fewer is
   better). Follows the module contract in ./index.js.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { clamp, hsl, FONT, coarse, fitView, surface, sounder, looper, rr, prompt, rng, randomSeed } from './kit.js';
import { KIT_CSS, ownsKey, playerStrip, segment } from './boardkit.js';
import { fixedStepper } from './fixed.js';
import { W as TW, H as TH, R, DT, POCKETS, SEGS, MAXV, createSim, strike, canPlace } from './pool-sim.js';
import { newGame, judgeShot, targets, remaining, nearestFree } from './pool-rules.js';
import { chooseShot, LEVELS } from './pool-ai.js';

const PREF = 'portal.arcadePool';
const OX = 30, OY = 30, VW = TW + 60, VH = TH + 90;          /* the table sits in a rail; the tray runs under it */
const DRAGMAX = 150;
const HUE = 150;
const BALL = ['#f4f4ee', '#f2c230', '#2b6fd1', '#d8322f', '#6a3fb0', '#f08a24', '#1f9a4a', '#8a1f2a', '#15161a'];
const colorOf = id => BALL[id <= 8 ? id : id - 8];

const readLevel = () => { let p = null; try { p = store.get(PREF, null); } catch (err) { p = null; } return LEVELS[p?.level] ? p.level : 'medium'; };
const writeLevel = level => { try { store.set(PREF, { level }); } catch (err) { /* a convenience */ } };
const NAMES = { solid: 'Solids', stripe: 'Stripes' };

export default {
  mount(el, ctx) {
    const mode = ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let dead = false;
    const S = {
      game: newGame(), state: 'aim',                  /* aim | place | roll | cpu | over */
      paused: false, over: false, time: 0,
      level: readLevel(), rnd: rng(randomSeed()),
      aim: { angle: Math.PI, power: 0 }, drag: null, kx: 0, fine: false, charging: false, chargeT: 0, charge: 0,
      hand: { x: 200, y: TH / 2 }, sim: null, pot: [], last: null, msg: '', msgT: -9, myShots: 0,
      cpuT: 0, plan: null, endT: 0, usedInput: false, lastSnd: 0, shake: 0,
    };
    const name = who => (mode === '2p' ? `Player ${who + 1}` : who === 0 ? 'You' : 'The computer');

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#e8e8e8', name(1), '');
    const botStrip = playerStrip('#e8e8e8', name(0), '');
    const levelSeg = mode === 'cpu' ? segment('Level', Object.values(LEVELS).map(l => ({ id: l.id, label: l.name })), S.level, id => { S.level = id; writeLevel(id); levelSeg.set(id); say(`The computer now plays at ${LEVELS[id].name}`); refocus(); }) : null;
    const note = h('div.arx-bg__note', { text: mode === '2p' ? 'Two players on this screen: take turns. Aim with the mouse, press and drag back to shoot, or ← → and hold Space.' : 'Aim with the mouse, press and drag back to shoot — or ← → and hold Space. The level can be changed any time.' });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side));
    el.appendChild(root);
    const sf = surface(boardEl, '8-ball pool table', () => draw());
    let V = fitView(sf, VW, VH, 4);
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    ctx.onScore(0);

    function say(t) { S.msg = t; S.msgT = S.time; }
    const cue = () => S.game.balls[0];
    const myTurn = () => mode === '2p' || S.game.turn === 0;

    /* ------------------------------ the match ------------------------------ */
    function paint() {
      const g = S.game;
      const strip = (who, st) => {
        const grp = g.groups[who];
        st.set({ turn: !g.over && g.turn === who, color: grp === 'solid' ? '#f2c230' : grp === 'stripe' ? '#f4f4ee' : '#b9c0c8',
          note: grp ? `${NAMES[grp]} · ${remaining(g, grp) ? `${remaining(g, grp)} left` : 'now the 8'}` : 'Table open' });
      };
      strip(1, topStrip); strip(0, botStrip);
      let t;
      if (g.over) t = `${name(g.over.winner)} win${mode === 'cpu' && g.over.winner === 0 ? '' : 's'}: ${g.over.reason}`;
      else if (S.state === 'place') t = `${name(g.turn)}: ball in hand, place the cue ball`;
      else if (S.state === 'cpu') t = 'The computer is lining up a shot…';
      else t = mode === 'cpu' && g.turn === 0 ? 'Your turn' : `${name(g.turn)}${mode === '2p' ? '’s turn' : ' is shooting'}`;
      statusEl.textContent = t;
      statusEl.classList.toggle('is-done', !!g.over);
      statusEl.classList.toggle('is-alert', !g.over && !!S.last?.foul && S.time - S.msgT < 3);
    }
    function startTurn() {
      const g = S.game;
      S.drag = null; S.charging = false; S.charge = 0; S.aim.power = 0;
      if (g.over) { S.state = 'over'; S.endT = 0; paint(); return; }
      if (mode === 'cpu' && g.turn === 1) { S.state = 'cpu'; S.cpuT = 0; S.plan = null; }
      else if (g.inHand) { S.state = 'place'; const c = nearestFree(g, cue().x, cue().y); S.hand = { x: c.x, y: c.y }; }
      else {
        S.state = 'aim';
        /* point at the nearest ball I may hit */
        let best = null, bd = Infinity;
        for (const id of targets(g)) { const b = g.balls[id], d = Math.hypot(b.x - cue().x, b.y - cue().y); if (d < bd) { bd = d; best = b; } }
        if (best) S.aim.angle = Math.atan2(best.y - cue().y, best.x - cue().x);
      }
      paint();
    }
    function placeCue(x, y) {
      const g = S.game;
      if (!g.inHand || !canPlace(g.balls, x, y)) return false;
      const c = cue(); c.x = x; c.y = y; c.vx = c.vy = 0; c.in = true;
      g.inHand = false;
      S.state = 'aim';
      let best = null, bd = Infinity;
      for (const id of targets(g)) { const b = g.balls[id], d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
      if (best) S.aim.angle = Math.atan2(best.y - y, best.x - x);
      snd.blip(300, 0.05, 'triangle', 0.5);
      paint();
      return true;
    }
    function shoot(angle, power) {
      if (S.state !== 'aim' && S.state !== 'cpu' || S.paused || S.over) return false;
      if (!Number.isFinite(angle) || !(power > 0.03)) return false;
      strike(S.game.balls, angle, power);
      S.sim = createSim(S.game.balls);
      S.sim.sound = (kind, v) => {
        const now = S.time;
        if (now - S.lastSnd < 0.03 && kind !== 'pocket') return;
        S.lastSnd = now;
        if (kind === 'ball') snd.blip(300 + Math.min(500, v * 0.6), 0.04, 'triangle', Math.min(1, 0.3 + v / 900));
        else if (kind === 'rail') snd.blip(150 + Math.min(120, v * 0.1), 0.05, 'sine', Math.min(0.8, 0.2 + v / 1200));
        else snd.blip(110, 0.18, 'sine', 0.9, 60);
      };
      S.pot = [];
      S.state = 'roll';
      if (S.game.turn === 0) S.myShots++;
      S.aim.power = 0;
      return true;
    }
    function settle() {
      const g = S.game, ev = S.sim.ev, who = g.turn;
      S.sim = null;
      const res = judgeShot(g, ev);
      S.last = { ...res, by: who };
      const names = ev.pocketed.map(id => (id === 0 ? 'cue' : id));
      if (res.spotted8) say('The 8 went in on the break: it is spotted again');
      else if (g.over) say(g.over.reason);
      else if (res.foul) say(`Foul by ${name(who)}: ${res.foul}. Ball in hand for ${name(1 - who)}.`);
      else if (res.assigned) say(`${name(who)} ${mode === 'cpu' && who === 0 ? 'are' : 'is'} ${NAMES[res.assigned]}`);
      else if (res.continues) say(`${name(who)} pocketed ${names.filter(n => n !== 'cue').join(', ')} and shoots again`);
      else say(`${name(who)} missed`);
      snd.blip(res.foul ? 130 : 480, 0.12, res.foul ? 'sawtooth' : 'triangle', 0.5);
      startTurn();
    }
    function finish() {
      if (S.over || dead) return;
      S.over = true;
      const g = S.game, w = g.over.winner;
      const shots = S.myShots;
      if (mode === '2p') ctx.onEnd({ score: null, detail: `${name(w)} wins: ${g.over.reason}. ${g.shots} shots in the game.` });
      else if (w === 0) ctx.onEnd({ score: shots, won: true, detail: `You won against the computer (${LEVELS[S.level].name}) in ${shots} shots: ${g.over.reason}.` });
      else ctx.onEnd({ score: null, won: false, detail: `The computer (${LEVELS[S.level].name}) won: ${g.over.reason}.` });
    }
    function newMatch() {
      S.game = newGame(); S.sim = null; S.last = null; S.myShots = 0; S.msg = ''; S.pot = [];
      ctx.onScore(0);
      startTurn();
    }

    /* ------------------------------ one fixed step ------------------------------ */
    function step(dt) {
      S.time += dt;
      if (S.state === 'roll') {
        S.sim.step();
        for (const id of S.sim.ev.pocketed) if (!S.pot.some(p => p.id === id)) { const b = S.game.balls[id]; S.pot.push({ id, x: POCKETS[b.pocket].x, y: POCKETS[b.pocket].y, t: S.time }); }
        if (!S.sim.anyMoving()) settle();
      } else if (S.state === 'aim') {
        if (S.kx) { S.aim.angle += S.kx * (S.fine ? 0.12 : 0.9) * dt; S.usedInput = true; }
        if (S.charging) { S.chargeT += dt; const ph = (S.chargeT / 1.4) % 2; S.charge = ph < 1 ? ph : 2 - ph; S.aim.power = S.charge; }
      } else if (S.state === 'place') {
        /* nothing moves on its own */
      } else if (S.state === 'cpu') {
        S.cpuT += dt;
        if (!S.plan && S.cpuT > 0.05) S.plan = chooseShot(S.game, S.level, S.rnd);
        const think = reduced ? 0.25 : 0.7, pull = reduced ? 0 : 0.55;
        if (S.plan && S.cpuT > think) {
          if (S.plan.place && S.game.inHand) {
            if (!placeCue(S.plan.place.x, S.plan.place.y)) { const c = nearestFree(S.game, S.plan.place.x, S.plan.place.y); placeCue(c.x, c.y); }
            S.state = 'cpu';
          }
          S.aim.angle = S.plan.angle;
          const k = pull ? Math.min(1, (S.cpuT - think) / pull) : 1;
          S.aim.power = S.plan.power * k;
          if (k >= 1) { const p = S.plan; S.plan = null; if (!shoot(p.angle, p.power)) { S.state = 'aim'; } }
        }
      } else if (S.state === 'over') {
        S.endT += dt;
        if (S.endT >= (reduced ? 0.5 : 1.6)) finish();
      }
    }
    const stepper = fixedStepper(DT, step);
    const loop = looper(dt => {
      if (S.paused) return;
      stepper.advance(dt);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    const tx = x => OX + x, ty = y => OY + y;
    function ballAt(g, b, x, y, r, a = 1) {
      g.save(); g.globalAlpha = a;
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(x + 1.6, y + 2.2, r, 0, 7); g.fill();
      const striped = b.id > 8;
      g.fillStyle = striped || b.id === 0 ? '#f4f4ee' : colorOf(b.id);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      if (striped) {
        g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
        g.fillStyle = colorOf(b.id); g.fillRect(x - r, y - r * 0.55, r * 2, r * 1.1); g.restore();
      }
      if (b.id) {
        g.fillStyle = '#f4f4ee'; g.beginPath(); g.arc(x, y, r * 0.5, 0, 7); g.fill();
        g.fillStyle = '#15161a'; g.font = `700 ${Math.round(r * 0.78)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(b.id), x, y + 0.5);
      }
      const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.45, 0.5, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.35, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.restore();
    }
    /* the first thing a ball launched from (x, y) along angle would touch: { t, ball|null, gx, gy } */
    function ray(x, y, ang) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let best = { t: Infinity, ball: null };
      for (const b of S.game.balls) {
        if (!b.in || b.id === 0) continue;
        const ox = b.x - x, oy = b.y - y, tc = ox * dx + oy * dy;
        if (tc <= 0) continue;
        const d2 = ox * ox + oy * oy - tc * tc;
        if (d2 > 4 * R * R) continue;
        const t = tc - Math.sqrt(4 * R * R - d2);
        if (t > 0 && t < best.t) best = { t, ball: b };
      }
      let tw = Infinity;
      if (dx > 1e-6) tw = Math.min(tw, (TW - R - x) / dx); else if (dx < -1e-6) tw = Math.min(tw, (R - x) / dx);
      if (dy > 1e-6) tw = Math.min(tw, (TH - R - y) / dy); else if (dy < -1e-6) tw = Math.min(tw, (R - y) / dy);
      if (tw < best.t) best = { t: tw, ball: null };
      return { ...best, gx: x + dx * best.t, gy: y + dy * best.t };
    }
    function drawTable(g) {
      /* the rail */
      const rg = g.createLinearGradient(0, 0, 0, VH); rg.addColorStop(0, '#6b4528'); rg.addColorStop(1, '#4a2e18');
      g.fillStyle = rg; rr(g, 0, 0, VW, TH + 60, 26); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 2; rr(g, 3, 3, VW - 6, TH + 54, 23); g.stroke();
      /* the felt */
      const fg = g.createRadialGradient(VW / 2, OY + TH / 2, 40, VW / 2, OY + TH / 2, 480); fg.addColorStop(0, '#2c9b5c'); fg.addColorStop(1, '#1b6b3f');
      g.fillStyle = fg; g.fillRect(OX, OY, TW, TH);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(OX, OY, TW, 5); g.fillRect(OX, OY + TH - 5, TW, 5); g.fillRect(OX, OY, 5, TH); g.fillRect(OX + TW - 5, OY, 5, TH);
      /* markings */
      g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tx(200), ty(0)); g.lineTo(tx(200), ty(TH)); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.22)'; for (const x of [200, 600]) { g.beginPath(); g.arc(tx(x), ty(TH / 2), 2.4, 0, 7); g.fill(); }
      /* the cushions' faces */
      g.strokeStyle = '#0f4a2a'; g.lineWidth = 5; g.lineCap = 'round';
      for (const s of SEGS) { g.beginPath(); g.moveTo(tx(s[0]), ty(s[1])); g.lineTo(tx(s[2]), ty(s[3])); g.stroke(); }
      /* the pockets */
      for (const p of POCKETS) {
        g.fillStyle = '#05080a'; g.beginPath(); g.arc(tx(p.x), ty(p.y), p.r + 1.5, 0, 7); g.fill();
        g.strokeStyle = 'rgba(210,170,90,.55)'; g.lineWidth = 2; g.stroke();
      }
    }
    function drawCueStick(g, c, ang, pull) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const off = R + 5 + pull * 70, len = 230;
      const x0 = tx(c.x) - dx * off, y0 = ty(c.y) - dy * off, x1 = x0 - dx * len, y1 = y0 - dy * len;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 6; g.beginPath(); g.moveTo(x0 + 2, y0 + 3); g.lineTo(x1 + 2, y1 + 3); g.stroke();
      const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, '#e7cf9a'); gr.addColorStop(0.35, '#c58c4a'); gr.addColorStop(1, '#4a2e18');
      g.strokeStyle = gr; g.lineWidth = 5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = '#7ad3f0'; g.lineWidth = 5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 - dx * 4, y0 - dy * 4); g.stroke();
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 2);
      g.fillStyle = '#0a1210'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      drawTable(g);
      const B = S.game.balls;
      for (const b of B) if (b.in && !(S.state === 'place' && b.id === 0)) ballAt(g, b, tx(b.x), ty(b.y), R);
      /* a ball going down the pocket */
      if (!reduced) for (const p of S.pot) { const k = (S.time - p.t) / 0.25; if (k < 1) ballAt(g, { id: p.id }, tx(p.x), ty(p.y), R * (1 - k), 1 - k); }
      /* the cue, the aim line */
      const c = cue();
      if ((S.state === 'aim' || (S.state === 'cpu' && c.in)) && !S.paused && c.in) {
        const ang = S.aim.angle;
        const r = ray(c.x, c.y, ang);
        g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(tx(c.x), ty(c.y)); g.lineTo(tx(r.gx), ty(r.gy)); g.stroke(); g.setLineDash([]);
        g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(tx(r.gx), ty(r.gy), R, 0, 7); g.stroke();
        if (r.ball) {
          const nx = r.ball.x - r.gx, ny = r.ball.y - r.gy, l = Math.hypot(nx, ny) || 1;
          g.strokeStyle = 'rgba(255,230,140,.7)'; g.beginPath(); g.moveTo(tx(r.ball.x), ty(r.ball.y)); g.lineTo(tx(r.ball.x + (nx / l) * 46), ty(r.ball.y + (ny / l) * 46)); g.stroke();
        }
        drawCueStick(g, c, ang, S.aim.power);
      }
      if (S.state === 'place') {
        const ok = canPlace(B, S.hand.x, S.hand.y);
        g.globalAlpha = ok ? 0.85 : 0.4;
        ballAt(g, B[0], tx(S.hand.x), ty(S.hand.y), R);
        g.globalAlpha = 1;
        g.strokeStyle = ok ? 'rgba(120,255,170,.9)' : 'rgba(255,120,120,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(tx(S.hand.x), ty(S.hand.y), R + 4, 0, 7); g.stroke();
      }
      /* the tray: balls pocketed so far, under the table */
      let k = 0;
      for (const b of B) if (!b.in && b.id !== 0) { ballAt(g, b, 46 + k * 22, TH + OY + 28, 8); k++; }
      /* the power meter */
      const px = VW - 230, py = TH + OY + 22;
      g.fillStyle = 'rgba(0,0,0,.4)'; rr(g, px, py, 200, 12, 6); g.fill();
      if (S.aim.power > 0) { g.fillStyle = hsl(120 - S.aim.power * 120, 85, 55); rr(g, px + 1.5, py + 1.5, Math.max(4, 197 * S.aim.power), 9, 4.5); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `600 10px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText('POWER', px - 8, py + 6);
      /* the last message */
      if (S.msg && S.time - S.msgT < 3.2) {
        g.textAlign = 'center'; g.font = `700 15px ${FONT}`; const a = clamp(3.2 - (S.time - S.msgT), 0, 1);
        g.fillStyle = `rgba(8,12,10,${0.6 * a})`; const w = Math.min(VW - 40, g.measureText(S.msg).width + 30); rr(g, VW / 2 - w / 2, OY + TH / 2 - 17, w, 34, 10); g.fill();
        g.fillStyle = S.last?.foul ? `rgba(255,170,150,${a})` : `rgba(255,255,255,${a})`; g.fillText(S.msg, VW / 2, OY + TH / 2, VW - 60);
      }
      g.restore();
      if (S.state === 'aim' && !S.usedInput && S.game.shots === 0 && !S.paused && myTurn()) prompt(g, sf, coarse() ? 'Touch to aim, drag back to shoot' : 'Aim with the mouse, press and drag back to shoot', 'Or ← → to aim and hold Space', HUE, sf.h * 0.9);
      if (S.paused) prompt(g, sf, 'Paused', null, HUE);
    }

    /* ------------------------------ input ------------------------------ */
    const toTable = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - V.ox) / V.s - OX, y: (e.clientY - r.top - V.oy) / V.s - OY };
    };
    const canAim = () => S.state === 'aim' && !S.paused && myTurn();
    const onMove = e => {
      if (S.paused) return;
      const p = toTable(e);
      if (S.state === 'place' && myTurn()) { S.hand = { x: clamp(p.x, R, TW - R), y: clamp(p.y, R, TH - R) }; S.usedInput = true; if (!loop.on) draw(); return; }
      if (!canAim()) return;
      if (S.drag) {
        const D = S.drag, pull = (D.sx - p.x) * Math.cos(D.ang) + (D.sy - p.y) * Math.sin(D.ang);
        S.aim.power = clamp(pull / DRAGMAX, 0, 1);
      } else {
        const c = cue();
        if (Math.hypot(p.x - c.x, p.y - c.y) > 6) S.aim.angle = Math.atan2(p.y - c.y, p.x - c.x);
      }
      S.usedInput = true;
      if (!loop.on) draw();
    };
    const onDown = e => {
      if (e.button > 0 || S.paused) return;
      snd.wake();
      const p = toTable(e);
      if (S.state === 'place' && myTurn()) { placeCue(clamp(p.x, R, TW - R), clamp(p.y, R, TH - R)); return; }
      if (!canAim()) return;
      const c = cue();
      S.aim.angle = Math.atan2(p.y - c.y, p.x - c.x);
      S.drag = { sx: p.x, sy: p.y, ang: S.aim.angle, id: e.pointerId };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      S.usedInput = true;
      if (!loop.on) draw();
    };
    const onUp = e => {
      const D = S.drag;
      if (!D || e.pointerId !== D.id) return;
      S.drag = null;
      const pw = S.aim.power;
      S.aim.power = 0;
      if (e.type === 'pointercancel') return;
      if (pw > 0.04) shoot(D.ang, pw);
    };
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') {
        e.preventDefault(); snd.wake();
        if (S.paused) return;
        const dir = k === 'ArrowLeft' || k === 'a' ? -1 : 1;
        if (S.state === 'place' && myTurn()) { S.hand.x = clamp(S.hand.x + dir * (e.shiftKey ? 2 : 12), R, TW - R); return; }
        S.kx = dir; S.fine = e.shiftKey;
        return;
      }
      if ((k === 'ArrowUp' || k === 'ArrowDown' || k === 'w' || k === 's') && S.state === 'place' && myTurn()) {
        e.preventDefault();
        S.hand.y = clamp(S.hand.y + (k === 'ArrowUp' || k === 'w' ? -1 : 1) * (e.shiftKey ? 2 : 12), R, TH - R);
        return;
      }
      if (k === ' ' || k === 'Enter') {
        if (S.over || S.state === 'over') return;           /* Enter plays again: the Arcade's */
        e.preventDefault(); snd.wake();
        if (S.paused || e.repeat) return;
        if (S.state === 'place' && myTurn()) { placeCue(S.hand.x, S.hand.y); return; }
        if (canAim() && !S.charging) { S.charging = true; S.chargeT = 0; S.charge = 0; S.usedInput = true; }
      }
    };
    const onKeyUp = e => {
      const k = e.key;
      if ((k === 'ArrowLeft' || k === 'a') && S.kx < 0) S.kx = 0;
      if ((k === 'ArrowRight' || k === 'd') && S.kx > 0) S.kx = 0;
      if ((k === ' ' || k === 'Enter') && S.charging) {
        S.charging = false;
        const pw = Math.max(0.06, S.charge);
        S.charge = 0;
        if (!S.paused && canAim()) shoot(S.aim.angle, pw);
        S.aim.power = 0;
      }
    };
    const onBlur = () => { S.kx = 0; S.charging = false; S.drag = null; S.aim.power = 0; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    startTurn();
    draw();
    loop.start();

    return {
      stop() {
        dead = true;
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
        root.remove();
      },
      pause() { S.paused = true; S.kx = 0; S.charging = false; S.drag = null; S.aim.power = 0; loop.stop(); draw(); },
      resume() { S.paused = false; stepper.reset(); if (!S.over) loop.start(); },
      peek: () => {
        const g = S.game;
        return {
          mode, level: S.level, state: S.state, paused: S.paused, over: S.over, time: S.time, turn: g.turn, groups: g.groups.slice(), inHand: g.inHand,
          breaking: g.breaking, shots: g.shots, myShots: S.myShots, fouls: g.fouls.slice(), winner: g.over ? g.over.winner : null, reason: g.over ? g.over.reason : '',
          balls: g.balls.map(b => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, in: b.in })), targets: targets(g), msg: S.msg, last: S.last,
          aim: { angle: S.aim.angle, power: S.aim.power }, hand: { ...S.hand }, rolling: !!S.sim, status: statusEl.textContent,
          left: { solid: remaining(g, 'solid'), stripe: remaining(g, 'stripe') },
          view: { ox: V.ox, oy: V.oy, s: V.s, tx: OX, ty: OY, w: TW, h: TH },
        };
      },
      /* test hook — nothing in the game calls it:
         shoot({ angle, power }) · place({ x, y }) · step(seconds) · set({ balls, turn, groups, inHand, breaking }) · level(id) · seed(n) */
      hook(cmd, arg) {
        if (cmd === 'shoot') return shoot(arg.angle, arg.power);
        if (cmd === 'place') return placeCue(arg.x, arg.y);
        if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += DT) step(DT); }
        else if (cmd === 'set') {
          const g = S.game;
          if (arg.balls) for (const b of arg.balls) { const x = g.balls[b.id]; x.x = b.x; x.y = b.y; x.vx = x.vy = 0; x.in = b.in !== false; }
          if (arg.turn !== undefined) g.turn = arg.turn;
          if (arg.groups) g.groups = arg.groups.slice();
          if (arg.inHand !== undefined) g.inHand = arg.inHand;
          if (arg.breaking !== undefined) g.breaking = arg.breaking;
          startTurn();
        } else if (cmd === 'level') { S.level = arg; levelSeg?.set(arg); }
        else if (cmd === 'seed') S.rnd = rng(arg);
        else if (cmd === 'new') newMatch();
        else return false;
        draw();
        return true;
      },
    };
  },
};
