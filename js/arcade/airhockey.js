/* ============================================================
   arcade/airhockey.js — Air Hockey for Static Arcade.

   The table, the puck and the computer player live in
   ./airhockey-sim.js (no graphics, so the tests can play and
   measure whole games). This file is the screen, the controls and
   the online link. First to 7 goals.

   One player: you are the blue mallet on the left, the computer
   the orange one on the right, at Easy, Medium or Hard (choose on
   the start screen, or press 1 2 3). Two players on one keyboard:
   left is W A S D, right is the arrow keys; on a touch screen each
   half of the table moves its own mallet. Mouse or touch: the mallet
   follows the pointer, as fast as a hand can go (not instantly — a
   mallet has a top speed, so a hit is only as hard as your swing).
   Keys move it at a steady speed. In a tall window the table turns
   upright; the physics do not change.

   The simulation runs on a fixed 1/240 s step (kit.js stepper), so
   the game plays the same on any screen. Score to the shell: your
   goals (0–7), or the winner's in two-player.

   ONLINE (ctx.online): the HOST is authoritative — it runs the table
   and sends a snapshot of it ~20 times a second; the GUEST sends only
   where its mallet should go (~25 times a second) and draws what the
   host says, moving its own mallet at once and extrapolating the
   puck between snapshots with the same physics. Each side sees
   itself as the blue mallet on the left (the guest's picture is the
   host's mirrored left-right).
   Everything received is checked, not believed:
     · to the host, a mallet message must have a number that is
       newer than the last, a position that is a finite number inside
       the guest's half of the table — anything else is rejected
       (counted in `rejected`) and the mallet does not move;
     · to the guest, a snapshot must be newer, the puck on the
       table and no faster than the physics allows, each mallet in
       its own half, scores whole numbers 0–7 that never go down,
       and "over" only when someone has 7. Otherwise it is rejected.
   A guest cannot score for itself or move the host's mallet: goals
   are counted only by the host's simulation. The game's end is
   repeated in the snapshots (and answered to any later message), so
   a lost packet cannot leave one side playing on. If the friend
   goes quiet for a few seconds the host's clock waits for them; the
   Arcade itself ends the round when the room has lost them.
   ============================================================ */
import { clamp, hsl, FONT, coarse, surface, ownsKey, sounder, looper, rr, prompt, stepper } from './kit.js';
import * as A from './airhockey-sim.js';

const { W, H, PR, MR } = A;
const WIN = 7;
const HUE_ME = 200, HUE_THEM = 22;
const KEY_V = 760;                       /* units/s a held key moves a mallet */
const SERVE_WAIT = 1.0;
const LEVEL_KEYS = ['easy', 'medium', 'hard'];
const SEND_EVERY = 0.05;                 /* host snapshots */
const MALLET_EVERY = 0.04;               /* guest mallet messages */
const r1 = n => Math.round(n * 10) / 10;
const fin = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

/* -------------------------------- the view -------------------------------- */
function geometry(sf) {
  const hh = clamp(sf.h * 0.1, 34, 54);
  const ah = sf.h - hh;
  const vert = ah > sf.w * 1.1;
  if (vert) {
    const k = Math.min(sf.w / H, ah / W) * 0.96;
    return { vert, hh, k, ox: (sf.w - H * k) / 2, oy: hh + (ah - W * k) / 2 };
  }
  const k = Math.min(sf.w / W, ah / H) * 0.96;
  return { vert, hh, k, ox: (sf.w - W * k) / 2, oy: hh + (ah - H * k) / 2 };
}
function toTable(g, v) {
  if (v.vert) { g.translate(v.ox, v.oy + W * v.k); g.rotate(-Math.PI / 2); } else g.translate(v.ox, v.oy);
  g.scale(v.k, v.k);
}
function arenaPoint(sf, e, v = geometry(sf)) {
  const r = sf.cv.getBoundingClientRect();
  const px = e.clientX - r.left - v.ox, py = e.clientY - r.top - v.oy;
  return v.vert ? { x: W - py / v.k, y: px / v.k } : { x: px / v.k, y: py / v.k };
}
/* the arena direction a screen-direction key means */
function keyDir(code, vert) {
  const up = code === 'KeyW' || code === 'ArrowUp', dn = code === 'KeyS' || code === 'ArrowDown';
  const lf = code === 'KeyA' || code === 'ArrowLeft', rt = code === 'KeyD' || code === 'ArrowRight';
  if (!(up || dn || lf || rt)) return null;
  if (vert) return [dn ? -1 : up ? 1 : 0, rt ? 1 : lf ? -1 : 0];
  return [rt ? 1 : lf ? -1 : 0, dn ? 1 : up ? -1 : 0];
}

function paintMallet(g, m, hue, lit) {
  g.save();
  g.translate(m.x, m.y);
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath(); g.arc(3, 5, MR, 0, 7); g.fill();
  g.shadowBlur = lit ? 26 : 14; g.shadowColor = hsl(hue, 100, 55, 0.9);
  const gr = g.createRadialGradient(-MR * 0.3, -MR * 0.3, 2, 0, 0, MR);
  gr.addColorStop(0, hsl(hue, 100, 78)); gr.addColorStop(1, hsl(hue, 90, 45));
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, MR, 0, 7); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = hsl(hue, 100, 30, 0.7); g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, MR * 0.62, 0, 7); g.stroke();
  g.fillStyle = hsl(hue, 80, 88);
  g.beginPath(); g.arc(0, 0, MR * 0.34, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.6)';
  g.beginPath(); g.arc(-MR * 0.1, -MR * 0.12, MR * 0.1, 0, 7); g.fill();
  g.restore();
}

/* D = { puck:{x,y}|null, m:[{x,y},{x,y}], trail, flash, flashSide, score:[a,b], names:[a,b] } — arena units, my mallet = 0 */
function paintTable(g, sf, v, D, hint = 0) {
  g.fillStyle = '#02070d';
  g.fillRect(0, 0, sf.w, sf.h);
  /* the scoreboard, upright above the table */
  g.save();
  g.textBaseline = 'middle';
  const fs = Math.round(clamp(v.hh * 0.5, 15, 28));
  g.font = `800 ${fs}px ${FONT}`;
  g.textAlign = 'right'; g.fillStyle = hsl(HUE_ME, 100, 74);
  g.fillText(`${D.names[0]}  ${D.score[0]}`, sf.w / 2 - 14, v.hh / 2, sf.w / 2 - 24);
  g.textAlign = 'center'; g.fillStyle = 'rgba(220,235,255,.5)';
  g.fillText('–', sf.w / 2, v.hh / 2);
  g.textAlign = 'left'; g.fillStyle = hsl(HUE_THEM, 100, 70);
  g.fillText(`${D.score[1]}  ${D.names[1]}`, sf.w / 2 + 14, v.hh / 2, sf.w / 2 - 24);
  g.restore();
  g.save();
  toTable(g, v);
  /* the rink */
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b2036'); bg.addColorStop(1, '#071626');
  g.fillStyle = bg;
  rr(g, 0, 0, W, H, 18); g.fill();
  g.strokeStyle = 'rgba(140,210,255,.35)'; g.lineWidth = 4;
  rr(g, 0, 0, W, H, 18); g.stroke();
  if (D.flash > 0) {
    const grd = g.createLinearGradient(D.flashSide > 0 ? W : 0, 0, W / 2, 0);
    grd.addColorStop(0, hsl(D.flashSide > 0 ? HUE_ME : HUE_THEM, 100, 60, D.flash));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  /* the air holes */
  g.fillStyle = 'rgba(160,220,255,.09)';
  for (let x = 24; x < W; x += 24) for (let y = 24; y < H; y += 24) g.fillRect(x, y, 2, 2);
  /* the markings */
  g.strokeStyle = 'rgba(255,90,90,.55)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W / 2, 4); g.lineTo(W / 2, H - 4); g.stroke();
  g.strokeStyle = 'rgba(255,90,90,.4)'; g.lineWidth = 3;
  g.beginPath(); g.arc(W / 2, H / 2, 62, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(140,210,255,.28)'; g.lineWidth = 3;
  for (const [x, a0, a1] of [[0, -Math.PI / 2, Math.PI / 2], [W, Math.PI / 2, 3 * Math.PI / 2]]) {
    g.beginPath(); g.arc(x, H / 2, 112, a0, a1); g.stroke();
  }
  /* the goal mouths */
  for (const [x, hue] of [[0, HUE_ME], [W, HUE_THEM]]) {
    g.fillStyle = '#010305';
    g.fillRect(x === 0 ? -14 : W - 2, A.GY0, 16, A.GY1 - A.GY0);
    g.fillStyle = hsl(hue, 100, 62, 0.9);
    g.fillRect(x === 0 ? 0 : W - 5, A.GY0 - 3, 5, 6); g.fillRect(x === 0 ? 0 : W - 5, A.GY1 - 3, 5, 6);
    g.strokeStyle = hsl(hue, 100, 60, 0.8); g.lineWidth = 3;
    g.beginPath(); g.moveTo(x === 0 ? 2 : W - 2, A.GY0); g.lineTo(x === 0 ? 2 : W - 2, A.GY1); g.stroke();
  }
  /* the puck's trail, then the puck, under the mallets' glow */
  const n = D.trail.length;
  D.trail.forEach((p, i) => {
    g.fillStyle = `rgba(255,230,200,${(i / n) * 0.18})`;
    g.beginPath(); g.arc(p.x, p.y, PR * (0.4 + (i / n) * 0.5), 0, 7); g.fill();
  });
  if (D.puck && !(hint && Math.floor(hint * 8) % 2)) {
    const p = D.puck;
    g.save();
    g.shadowBlur = 16; g.shadowColor = 'rgba(255,200,120,.8)';
    g.fillStyle = '#16181d';
    g.beginPath(); g.arc(p.x, p.y, PR, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#f2b24a'; g.lineWidth = 3;
    g.beginPath(); g.arc(p.x, p.y, PR - 3, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.beginPath(); g.arc(p.x - 4, p.y - 4, 3, 0, 7); g.fill();
    g.restore();
  }
  paintMallet(g, D.m[0], HUE_ME, D.lit === 0);
  paintMallet(g, D.m[1], HUE_THEM, D.lit === 1);
  g.restore();
}

function soundFor(snd, ev) {
  if (ev.kind === 'hit') snd.blip(300 + ev.p * 520, 0.05, 'square', 0.9);
  else if (ev.kind === 'wall') snd.blip(210 + ev.p * 120, 0.03, 'triangle', 0.55);
  else if (ev.kind === 'post') snd.blip(820, 0.06, 'triangle', 0.9);
}

/* ============================================================
   Local play: against the computer, or two on one keyboard.
   ============================================================ */
export default {
  mount(el, ctx) {
    if (ctx.online && typeof ctx.online.send === 'function') return online(el, ctx);
    const two = ctx.players === 2;
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                    /* ready | serve | play | over */
      paused: false,
      T: A.newTable(),
      level: 'medium', ai: null,
      serveT: 0, serveSide: 0,
      keys: new Set(),
      trail: [], flash: 0, flashSide: 0,
      time: 0, frozen: false, rallies: 0,
      pills: [],
    };
    S.ai = A.makeAI(S.level, (Math.random() * 1e9) | 0);
    const sf = surface(el, two ? 'Air hockey, two players' : 'Air hockey against the computer', () => draw());
    report();
    function report() { ctx.onScore(two ? `${S.T.score[0]} – ${S.T.score[1]}` : S.T.score[0]); }

    function serve(side, wait = SERVE_WAIT) {
      A.resetPuck(S.T, side);
      S.serveSide = side;
      S.state = 'serve';
      S.serveT = wait;
      S.trail = [];
      S.ai.hist.length = 0; S.ai.engaged = false;
    }
    function start() { if (S.state === 'ready') serve(0, 0.5); }
    function setLevel(l) {
      if (two || S.state !== 'ready' || !A.LEVELS[l]) return;
      S.level = l;
      S.ai = A.makeAI(l, (Math.random() * 1e9) | 0);
    }

    function goal(side) {
      S.flash = reduced ? 0 : 0.4; S.flashSide = side === 0 ? 1 : -1;
      snd.blip(side === 0 ? 880 : 300, 0.2, 'triangle', 1, side === 0 ? 1320 : 180);
      report();
      const T = S.T;
      if (T.score[0] >= WIN || T.score[1] >= WIN) { finish(); return; }
      serve(side === 0 ? 1 : 0);              /* the side that conceded gets the puck */
    }

    function finish() {
      S.state = 'over';
      S.trail = [];
      draw();
      snd.blip(520, 0.3, 'triangle', 1, 1040);
      const [a, b] = S.T.score;
      if (two) ctx.onEnd({ score: Math.max(a, b), won: true, detail: `${a > b ? 'Left' : 'Right'} player wins ${Math.max(a, b)}–${Math.min(a, b)}` });
      else ctx.onEnd({ score: a, won: a >= WIN, detail: `${a >= WIN ? 'You beat the computer' : 'The computer won'} ${a}–${b} (${A.LEVELS[S.level].label})` });
    }

    /* the pointer, the keys and the computer all just set mallet targets */
    function drive(dt) {
      const T = S.T, k = S.keys;
      const vert = geometry(sf).vert;
      const dirFor = (a, b) => { let dx = 0, dy = 0; for (const c of k) { if (!a.has(c) && !(b && b.has(c))) continue; const d = keyDir(c, vert); if (d) { dx += d[0]; dy += d[1]; } } return [clamp(dx, -1, 1), clamp(dy, -1, 1)]; };
      const wasd = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']), arrows = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
      const [d1x, d1y] = two ? dirFor(wasd) : dirFor(wasd, arrows);
      if (d1x || d1y) { T.m[0].tx = T.m[0].x + d1x * KEY_V * dt; T.m[0].ty = T.m[0].y + d1y * KEY_V * dt; }
      if (two) {
        const [d2x, d2y] = dirFor(arrows);
        if (d2x || d2y) { T.m[1].tx = T.m[1].x + d2x * KEY_V * dt; T.m[1].ty = T.m[1].y + d2y * KEY_V * dt; }
      } else if (!S.frozen && S.state !== 'ready') {
        A.aiDrive(T, 1, A.aiTarget(T, S.ai, 1, dt), dt);
      } else { T.m[1].tx = T.m[1].x; T.m[1].ty = T.m[1].y; }
    }

    const clock = stepper(dt => {
      S.time += dt;
      drive(dt);
      const T = S.T;
      if (S.state === 'serve') {
        const rest = { x: T.puck.x, y: T.puck.y };
        A.step(T, dt);
        T.puck.x = rest.x; T.puck.y = rest.y; T.puck.vx = 0; T.puck.vy = 0;
        T.goal = null; T.ev.length = 0;
        S.serveT -= dt;
        if (S.serveT <= 0) S.state = 'play';
      } else if (S.state === 'play') {
        A.step(T, dt);
        for (const ev of T.ev) soundFor(snd, ev);
        T.ev.length = 0;
        if (T.goal !== null) { const g = T.goal; T.goal = null; goal(g); }
      } else if (S.state === 'ready') {
        A.step(T, dt);                  /* the mallets can be moved before serving */
        T.puck.vx = T.puck.vy = 0; T.puck.x = W / 2; T.puck.y = H / 2; T.ev.length = 0; T.goal = null;
      }
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
    }, A.STEP);

    const loop = looper(dt => {
      clock.feed(dt);
      if (!reduced && S.state === 'play') {
        S.trail.push({ x: S.T.puck.x, y: S.T.puck.y });
        if (S.trail.length > 9) S.trail.shift();
      }
      draw();
      if (S.state === 'over') loop.stop();
    });

    function draw() {
      const g = sf.g;
      sf.begin();
      const v = geometry(sf);
      const T = S.T;
      paintTable(g, sf, v, {
        puck: S.state === 'ready' ? null : T.puck, m: [T.m[0], T.m[1]], trail: S.trail, flash: S.flash, flashSide: S.flashSide,
        score: T.score, names: two ? ['P1', 'P2'] : ['YOU', 'CPU'],
      }, S.state === 'serve' && !reduced ? S.serveT : 0);
      S.pills = [];
      if (S.state === 'ready') {
        const touch = coarse();
        let how;
        if (touch) how = two ? 'Each player drags on their own half' : 'Drag to move your mallet';
        else if (two) how = 'Left: W A S D  ·  Right: ← ↑ ↓ →';
        else how = 'Move the mouse, or use W A S D / arrow keys';
        const cy = v.oy + (v.vert ? W : H) * v.k * 0.3;
        prompt(g, sf, touch ? 'Tap to serve' : 'Press Space or click to serve', `${how}  ·  first to ${WIN}`, HUE_ME, cy);
        if (!two) {
          const pw = clamp(sf.w * 0.17, 66, 100), ph = 30, gap = 8, total = pw * 3 + gap * 2;
          const y = cy + 58;
          LEVEL_KEYS.forEach((id, i) => {
            const x = (sf.w - total) / 2 + i * (pw + gap), on = S.level === id;
            g.save();
            g.fillStyle = on ? 'rgba(80,190,255,.3)' : 'rgba(4,6,10,.7)';
            g.strokeStyle = on ? 'rgba(120,210,255,.95)' : 'rgba(255,255,255,.28)';
            rr(g, x, y, pw, ph, 9); g.fill(); g.stroke();
            g.fillStyle = '#eaf6ff'; g.font = `700 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(`${i + 1}  ${A.LEVELS[id].label}`, x + pw / 2, y + ph / 2 + 1);
            g.restore();
            S.pills.push({ id, x, y, w: pw, h: ph });
          });
        }
      }
    }

    /* ------------------------------ input ------------------------------ */
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (MOVE.has(e.code)) {
        e.preventDefault();
        if (!S.paused) S.keys.add(e.code);
        snd.wake();
      } else if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault(); snd.wake();
        if (!S.paused) start();
      } else if (S.state === 'ready' && !two && /^Digit[123]$/.test(e.code)) setLevel(LEVEL_KEYS[Number(e.code[5]) - 1]);
    };
    const onKeyUp = e => { S.keys.delete(e.code); };
    const onBlur = () => S.keys.clear();
    const aimAt = e => {
      if (S.paused || S.state === 'over') return;
      const p = arenaPoint(sf, e);
      const T = S.T;
      if (!two) { T.m[0].tx = p.x; T.m[0].ty = p.y; }
      else if (e.pointerType === 'mouse' && !e.buttons) return;
      else { const m = p.x < W / 2 ? T.m[0] : T.m[1]; m.tx = p.x; m.ty = p.y; }
    };
    const onDown = e => {
      snd.wake();
      if (S.paused) return;
      const r = sf.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const pill = S.state === 'ready' && S.pills.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
      if (pill) { setLevel(pill.id); return; }
      aimAt(e);
      start();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', aimAt);
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', aimAt);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.keys.clear(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (arena units) */
      peek() {
        const T = S.T, v = geometry(sf);
        return {
          state: S.state, paused: S.paused, time: S.time, two, reduced, level: S.level, pills: S.pills.map(q => ({ ...q })), score: T.score.slice(), l: T.score[0], r: T.score[1],
          puck: { x: T.puck.x, y: T.puck.y, vx: T.puck.vx, vy: T.puck.vy },
          mallets: T.m.map(m => ({ x: m.x, y: m.y, vx: m.vx, vy: m.vy })),
          simTime: T.t, frozen: S.frozen, serveT: S.serveT,
          view: { k: v.k, ox: v.ox, oy: v.oy, vert: v.vert },
          arena: { W, H, PR, MR, GY0: A.GY0, GY1: A.GY1 },
        };
      },
      /* test hook: inert unless a test calls it */
      hook(cmd, a) {
        const T = S.T;
        if (cmd === 'place') {
          if (a.puck) Object.assign(T.puck, { vx: 0, vy: 0 }, a.puck);
          if (a.m0) { Object.assign(T.m[0], { vx: 0, vy: 0 }, a.m0); T.m[0].tx = T.m[0].x; T.m[0].ty = T.m[0].y; }
          if (a.m1) { Object.assign(T.m[1], { vx: 0, vy: 0 }, a.m1); T.m[1].tx = T.m[1].x; T.m[1].ty = T.m[1].y; }
          return true;
        }
        if (cmd === 'freeze') { S.frozen = !!a; return S.frozen; }
        if (cmd === 'state') { S.state = a; return S.state; }
        if (cmd === 'level') { setLevel(a); return S.level; }
        if (cmd === 'skip') { S.serveT = 0; return true; }
        if (cmd === 'feed') {
          const frame = a.frame || 1 / 60;
          for (let t = 0; t < a.secs - 1e-9; t += frame) clock.feed(Math.min(frame, a.secs - t));
          return true;
        }
        if (cmd === 'step') { for (let i = 0; i < Math.round(a / A.STEP); i++) clock.feed(A.STEP); return true; }
        return null;
      },
    };
  },
};

/* ============================================================
   Online: the host runs the table, the guest sends its mallet.
   My frame: I am always the LEFT (blue) mallet. The wire speaks
   the host's frame (host on the left); the guest mirrors x.
   ============================================================ */
function online(el, ctx) {
  const NET = ctx.online;
  const host = NET.role === 'host';
  const reduced = !!ctx.reduced;
  const snd = sounder(ctx);
  const name = String(NET.peer?.name || 'Friend').slice(0, 14);
  const now = () => performance.now() / 1000;
  /* wire (host frame) ↔ my frame: the guest mirrors left-right; mirroring is its own inverse */
  const mx = x => (host ? x : W - x);
  const mvx = vx => (host ? vx : -vx);

  const S = {
    T: A.newTable(),                  /* host: the real table. guest: a shadow, corrected by every snapshot (wire frame) */
    st: 0, serveT: 0, serveSide: 0,   /* 0 serve, 1 play, 2 over */
    paused: false,
    keys: new Set(),
    own: { x: host ? 90 : W - 90, y: H / 2, tx: host ? 90 : W - 90, ty: H / 2 },   /* guest: my mallet in the wire frame */
    k: 0, lastK: -1, lastM: -1,       /* snapshot counter (host) / newest snapshot or mallet message seen */
    lastIn: now(), lastSnapAt: now(), stalled: false,
    sentAt: 0, mSentAt: 0, replyAt: 0,
    bad: 0, accepted: 0,
    seen: [0, 0],                     /* the scores last shown (guest) */
    off: { x: 0, y: 0 }, drawn: { x: W / 2, y: H / 2 },
    opp: { x: host ? W - 90 : 90, y: H / 2 },
    trail: [], flash: 0, flashSide: 0,
    over: false, ended: false, time: 0,
    pingT: 0, endSends: 0,
  };
  S.T.m[0].tx = S.T.m[0].x; S.T.m[1].tx = S.T.m[1].x;
  A.resetPuck(S.T, (NET.seed & 1) ? 1 : 0);
  S.serveSide = (NET.seed & 1) ? 1 : 0;
  S.st = 0; S.serveT = 1.6;
  const sf = surface(el, `Air hockey online against ${name}`, () => draw());

  /* what I show: my frame, my mallet = 0 */
  const myScore = () => (host ? S.T.score[0] : S.T.score[1]);
  const theirScore = () => (host ? S.T.score[1] : S.T.score[0]);
  function report() { ctx.onScore(myScore()); NET.peerScore?.(theirScore()); }
  report();

  /* ------------------------------ wire ------------------------------ */
  function snapshot() {
    const T = S.T, p = T.puck;
    return { t: 's', k: ++S.k, st: S.st, sv: r1(Math.max(0, S.serveT)), p: [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy)],
      a: [r1(T.m[0].x), r1(T.m[0].y)], b: [r1(T.m[1].x), r1(T.m[1].y)], sc: T.score.slice() };
  }
  function sendSnap() { S.sentAt = performance.now(); try { NET.send(snapshot()); } catch (err) { /* link gone */ } }

  /* the host takes the guest's mallet: a number newer than the last, a place on the guest's half */
  function takeMallet(d) {
    if (!Number.isInteger(d.k) || d.k < 0 || d.k > 1e9) return reject();
    if (!fin(d.x, W / 2 + MR - 1, W - MR + 1) || !fin(d.y, MR - 1, H - MR + 1)) return reject();
    if (d.k <= S.lastM) return;                 /* an older one arriving late: harmless, not junk */
    S.lastM = d.k;
    S.accepted++;
    S.T.m[1].tx = d.x; S.T.m[1].ty = d.y;
  }
  /* the guest takes a snapshot */
  function takeSnap(d) {
    if (!Number.isInteger(d.k) || d.k < 0 || d.k > 1e9) return reject();
    if (!Number.isInteger(d.st) || d.st < 0 || d.st > 2) return reject();
    if (!Array.isArray(d.p) || d.p.length !== 4 || !fin(d.p[0], -PR, W + PR) || !fin(d.p[1], 0, H) || !fin(d.p[2], -A.MAX_PUCK * 1.1, A.MAX_PUCK * 1.1) || !fin(d.p[3], -A.MAX_PUCK * 1.1, A.MAX_PUCK * 1.1)) return reject();
    if (Math.hypot(d.p[2], d.p[3]) > A.MAX_PUCK * 1.1) return reject();
    if (!Array.isArray(d.a) || d.a.length !== 2 || !fin(d.a[0], MR - 1, W / 2 - MR + 1) || !fin(d.a[1], MR - 1, H - MR + 1)) return reject();
    if (!Array.isArray(d.b) || d.b.length !== 2 || !fin(d.b[0], W / 2 + MR - 1, W - MR + 1) || !fin(d.b[1], MR - 1, H - MR + 1)) return reject();
    if (!Array.isArray(d.sc) || d.sc.length !== 2 || !Number.isInteger(d.sc[0]) || !Number.isInteger(d.sc[1]) || d.sc[0] < 0 || d.sc[1] < 0 || d.sc[0] > WIN || d.sc[1] > WIN) return reject();
    if (d.sc[0] < S.T.score[0] || d.sc[1] < S.T.score[1]) return reject();      /* a score never goes down */
    if ((d.st === 2) !== (d.sc[0] === WIN || d.sc[1] === WIN) || (d.sc[0] === WIN && d.sc[1] === WIN)) return reject();
    if (!fin(d.sv, 0, 5)) return reject();
    if (d.k <= S.lastK) return;
    S.lastK = d.k;
    S.accepted++;
    applySnap(d);
  }
  function reject() { S.bad++; }

  function applySnap(d) {
    const T = S.T;
    const t0 = now();
    S.lastSnapAt = t0;
    const before = { x: S.drawn.x, y: S.drawn.y };
    /* new truth, then bring the puck forward by the time the snapshot spent on the way */
    T.puck.x = d.p[0]; T.puck.y = d.p[1]; T.puck.vx = d.p[2]; T.puck.vy = d.p[3];
    T.m[0].x = d.a[0]; T.m[0].y = d.a[1]; T.m[0].tx = d.a[0]; T.m[0].ty = d.a[1];
    T.m[1].x = d.b[0]; T.m[1].y = d.b[1];
    S.opp.x = d.a[0]; S.opp.y = d.a[1];
    const gained = [d.sc[0] - T.score[0], d.sc[1] - T.score[1]];
    T.score[0] = d.sc[0]; T.score[1] = d.sc[1];
    S.st = d.st; S.serveT = d.sv;
    if (S.st === 1) {
      const lead = clamp((NET.rtt?.() ?? 100) / 2000, 0, 0.2);
      for (let t = 0; t < lead; t += A.STEP) shadowStep(T, A.STEP);
    }
    if (!reduced) { S.off = { x: before.x - T.puck.x, y: before.y - T.puck.y }; if (Math.hypot(S.off.x, S.off.y) > 160) S.off = { x: 0, y: 0 }; }
    if (gained[0] || gained[1]) {
      const mine = host ? gained[0] : gained[1];
      S.flash = reduced ? 0 : 0.4; S.flashSide = mine > 0 ? 1 : -1;
      snd.blip(mine > 0 ? 880 : 300, 0.2, 'triangle', 1, mine > 0 ? 1320 : 180);
      S.trail = [];
      report();
    }
    if (S.st === 2) endMatch();
  }

  function endMatch() {
    if (S.over) return;
    S.over = true;
    S.trail = [];
    report();
    draw();
    snd.blip(520, 0.3, 'triangle', 1, 1040);
    const me = myScore(), them = theirScore();
    if (host) {
      /* the guest must learn it too: say it again a few times */
      [300, 1000, 2500].forEach(ms => setTimeout(() => { if (!S.ended) sendSnap(); }, ms));
    }
    ctx.onEnd({ score: me, won: me > them, versus: { me, them }, detail: `You ${me} – ${them} ${name}` });
  }

  function onNet(d) {
    if (S.ended || !d || typeof d !== 'object') return;
    S.lastIn = now();
    if (host) {
      if (d.t === 'm') {
        if (S.over) { if (performance.now() - S.replyAt > 300) { S.replyAt = performance.now(); sendSnap(); } return; }
        takeMallet(d);
      } else if (d.t === 'need') {
        if (performance.now() - S.replyAt > 300) { S.replyAt = performance.now(); sendSnap(); }
      } else reject();
    } else if (d.t === 's') takeSnap(d);
    else reject();
  }

  /* ------------------------------ stepping ------------------------------ */
  /* the guest's copy of the table between snapshots: the same physics, but it never counts a goal (only the
     host does) — a puck that reaches an end line just stops there until the host's next snapshot says what happened */
  function shadowStep(T, dt) {
    const sc = [T.score[0], T.score[1]];
    A.step(T, dt);
    T.score[0] = sc[0]; T.score[1] = sc[1];
    if (T.goal !== null) { T.goal = null; T.puck.vx = 0; T.puck.vy = 0; T.puck.x = T.puck.x < W / 2 ? 0 : W; }
    T.ev.length = 0;
  }
  function hostStep(dt) {
    const T = S.T;
    if (S.stalled) return;
    if (S.st === 0) {
      const rest = { x: T.puck.x, y: T.puck.y };
      A.step(T, dt);
      T.puck.x = rest.x; T.puck.y = rest.y; T.puck.vx = 0; T.puck.vy = 0; T.goal = null; T.ev.length = 0;
      S.serveT -= dt;
      if (S.serveT <= 0) S.st = 1;
    } else if (S.st === 1) {
      A.step(T, dt);
      for (const ev of T.ev) soundFor(snd, ev);
      T.ev.length = 0;
      if (T.goal !== null) {
        const g = T.goal; T.goal = null;
        S.flash = reduced ? 0 : 0.4; S.flashSide = g === 0 ? 1 : -1;
        snd.blip(g === 0 ? 880 : 300, 0.2, 'triangle', 1, g === 0 ? 1320 : 180);
        S.trail = [];
        report();
        if (T.score[g] >= WIN) { S.st = 2; sendSnap(); endMatch(); }
        else { A.resetPuck(T, g === 0 ? 1 : 0); S.st = 0; S.serveT = SERVE_WAIT; sendSnap(); }
      }
    }
  }
  function guestStep(dt) {
    const T = S.T;
    /* my mallet moves at once; the host's picture of it catches up */
    const o = S.own;
    let dx = o.tx - o.x, dy = o.ty - o.y;
    const d = Math.hypot(dx, dy), cap = A.MALLET_V * dt;
    if (d > cap) { dx *= cap / d; dy *= cap / d; }
    o.x = clamp(o.x + dx, W / 2 + MR, W - MR); o.y = clamp(o.y + dy, MR, H - MR);
    if (S.st === 1 && !S.stalled && !S.over) {
      /* the shadow table: the puck keeps going on its own between snapshots, mallets where they are */
      T.m[1].tx = o.x; T.m[1].ty = o.y;
      shadowStep(T, dt);
    }
  }

  const clock = stepper(dt => {
    S.time += dt;
    /* keys move my mallet's target (screen directions) */
    const vert = geometry(sf).vert;
    let kx = 0, ky = 0;
    for (const c of S.keys) { const dd = keyDir(c, vert); if (dd) { kx += dd[0]; ky += dd[1]; } }
    kx = clamp(kx, -1, 1); ky = clamp(ky, -1, 1);
    if (kx || ky) {
      if (host) { S.T.m[0].tx = S.T.m[0].x + kx * KEY_V * dt; S.T.m[0].ty = S.T.m[0].y + ky * KEY_V * dt; }
      else { S.own.tx = S.own.x + (-kx) * KEY_V * dt; S.own.ty = S.own.y + ky * KEY_V * dt; }
    }
    if (!S.over) {
      if (host) hostStep(dt); else guestStep(dt);
    }
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
  }, A.STEP);

  const loop = looper(dt => {
    const t = now();
    /* a quiet friend: the host's clock waits (it would only be them losing), the guest says so */
    S.stalled = !S.over && t - S.lastIn > 2.5;
    clock.feed(S.stalled && host ? 0 : dt);
    /* the puck I draw eases from where it was to where it now is */
    const T = S.T;
    S.off.x *= Math.exp(-14 * dt); S.off.y *= Math.exp(-14 * dt);
    S.drawn = { x: T.puck.x + S.off.x, y: T.puck.y + S.off.y };
    if (!host) { S.opp.x += (T.m[0].x - S.opp.x) * Math.min(1, dt * 30); S.opp.y += (T.m[0].y - S.opp.y) * Math.min(1, dt * 30); }
    if (!reduced && S.st === 1 && !S.over) { S.trail.push({ x: S.drawn.x, y: S.drawn.y }); if (S.trail.length > 9) S.trail.shift(); }
    /* what I send */
    const pm = performance.now();
    if (host) {
      if (!S.over && pm - S.sentAt > SEND_EVERY * 1000) sendSnap();
    } else if (pm - S.mSentAt > MALLET_EVERY * 1000 && !S.paused && !S.over) {
      S.mSentAt = pm;
      try { NET.send({ t: 'm', k: ++S.k, x: r1(S.own.x), y: r1(S.own.y) }); } catch (err) { /* link gone */ }
      /* nothing from the host for a while: ask again for what may have been lost */
      if (t - S.lastSnapAt > 1.2 && pm - S.replyAt > 900) { S.replyAt = pm; try { NET.send({ t: 'need' }); } catch (err) { /* gone */ } }
    }
    draw();
  });

  function frameData() {
    const T = S.T;
    /* my frame: me = left. Host: as is. Guest: mirror the wire frame. */
    if (host) return {
      puck: S.st === 0 && !reduced && Math.floor(S.serveT * 8) % 2 ? null : { x: S.drawn.x, y: S.drawn.y },
      m: [{ x: T.m[0].x, y: T.m[0].y }, { x: T.m[1].x, y: T.m[1].y }], score: [T.score[0], T.score[1]],
    };
    return {
      puck: S.st === 0 && !reduced && Math.floor(S.serveT * 8) % 2 ? null : { x: mx(S.drawn.x), y: S.drawn.y },
      m: [{ x: mx(S.own.x), y: S.own.y }, { x: mx(S.opp.x), y: S.opp.y }], score: [T.score[1], T.score[0]],
    };
  }
  function draw() {
    const g = sf.g;
    sf.begin();
    const v = geometry(sf);
    const D = frameData();
    paintTable(g, sf, v, {
      ...D, trail: host ? S.trail : S.trail.map(p => ({ x: mx(p.x), y: p.y })), flash: S.flash, flashSide: S.flashSide, names: ['YOU', name.toUpperCase()],
    });
    if (S.stalled) prompt(g, sf, `Waiting for ${name}…`, 'The game picks up when they are back', HUE_THEM);
    else if (S.st === 0 && S.time < 1.6 && S.k < 3) prompt(g, sf, `You vs ${name} — first to ${WIN}`, 'Move the mouse, or W A S D · you are the blue mallet', HUE_ME, v.oy + (v.vert ? W : H) * v.k * 0.3);
  }

  /* ------------------------------ input ------------------------------ */
  const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const onKey = e => {
    if (!ownsKey(el, e)) return;
    if (MOVE.has(e.code)) { e.preventDefault(); S.keys.add(e.code); snd.wake(); }
    else if (e.code === 'Space') { e.preventDefault(); snd.wake(); }
  };
  const onKeyUp = e => { S.keys.delete(e.code); };
  const onBlur = () => S.keys.clear();
  const aim = e => {
    if (S.over || S.paused) return;
    const p = arenaPoint(sf, e);
    if (host) { S.T.m[0].tx = p.x; S.T.m[0].ty = p.y; }
    else { S.own.tx = mx(p.x); S.own.ty = p.y; }
  };
  const onDown = e => { snd.wake(); aim(e); };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  sf.cv.addEventListener('pointerdown', onDown);
  sf.cv.addEventListener('pointermove', aim);
  const offNet = NET.on?.(onNet) || null;
  if (host) sendSnap();
  loop.start();

  return {
    stop() {
      S.ended = true;
      loop.stop();
      try { offNet?.(); } catch (err) { /* already off */ }
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      sf.cv.removeEventListener('pointerdown', onDown);
      sf.cv.removeEventListener('pointermove', aim);
      snd.close();
      sf.destroy();
    },
    /* test hook (host only): set the real table up; inert unless a test calls it */
    hook: host ? (cmd, a) => {
      const T = S.T;
      if (cmd === 'place') {
        if (a.puck) Object.assign(T.puck, { vx: 0, vy: 0 }, a.puck);
        if (a.m0) { Object.assign(T.m[0], { vx: 0, vy: 0 }, a.m0); T.m[0].tx = T.m[0].x; T.m[0].ty = T.m[0].y; }
        if (a.m1) { Object.assign(T.m[1], { vx: 0, vy: 0 }, a.m1); T.m[1].tx = T.m[1].x; T.m[1].ty = T.m[1].y; }
        return true;
      }
      if (cmd === 'score') { T.score[0] = a[0]; T.score[1] = a[1]; report(); return true; }
      if (cmd === 'skip') { S.serveT = 0; return true; }
      return null;
    } : undefined,
    /* a read-only snapshot for automated play-tests (arena units, my frame) */
    peek() {
      const T = S.T, v = geometry(sf), D = frameData();
      return {
        online: true, reduced, role: NET.role, me: myScore(), them: theirScore(), over: S.over, st: S.st, k: S.k, lastK: S.lastK, lastM: S.lastM,
        rejected: S.bad, accepted: S.accepted, stalled: S.stalled, simTime: T.t, time: S.time,
        puck: D.puck ? { x: D.puck.x, y: D.puck.y } : null, rawPuck: { x: mx(T.puck.x), y: T.puck.y, vx: mvx(T.puck.vx), vy: T.puck.vy },
        mine: D.m[0], theirs: D.m[1],
        view: { k: v.k, ox: v.ox, oy: v.oy, vert: v.vert },
        arena: { W, H, PR, MR, GY0: A.GY0, GY1: A.GY1 },
      };
    },
  };
}
