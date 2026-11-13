/* ============================================================
   arcade/snakebattle.js — Snake Battle for Static Arcade.

   Two snakes, one 30 × 20 board (rules in ./snakebattle-logic.js).
   Eat the apple to grow; crash into a wall, a body or a head and you
   are out; the last snake moving takes the round. First to 3 rounds
   wins the match. The score is the apples you ate in the match.

   One player: you against the computer (arrows or W A S D). Two
   players on one keyboard: P1 is W A S D, P2 the arrow keys. Touch:
   swipe (in two-player, each half of the screen steers its snake).
   Reduced motion: no screen flash, no pulse, no trail.

   The board advances one cell every 115 ms on a fixed clock (kit.js
   stepper), however fast the screen draws; segments are drawn
   between their cells, so the motion is smooth on every screen.

   ONLINE (ctx.online): the HOST is authoritative. It runs the board
   and sends the whole state — both bodies, the apple, the phase, the
   round and the scores — every tick (and ~4 times a second between
   rounds). The GUEST sends only its turns ({t:'tn', d}) and a
   heartbeat, and draws what the host says. The host plays green, the
   guest pink. Everything received is checked, not believed:
     · to the host, a turn must be a whole direction 0–3, numbered
       higher than the last, naming a tick that is not in the future
       and not long gone; anything else is rejected (counted in
       `rejected`) and ignored; the board itself refuses reversals;
     · to the guest, a snapshot must be newer; its bodies must be real
       snakes on the board (cells in range, each next to the last,
       none twice, the two never overlapping), the apple on a free
       cell, phase / round / scores whole numbers that never go back,
       "match over" only when someone has 3 rounds, and during play a
       head may not move farther than the ticks that passed (unless the
       host says it has reset the board — a counter only a test bumps). Otherwise
       it is rejected and the board stays as it was.
   A guest cannot move the host's snake, eat for itself or score a
   round. If the friend goes quiet for a few seconds the host's board
   waits for them; the Arcade ends the round if the room loses them.
   ============================================================ */
import { clamp, hsl, FONT, coarse, surface, ownsKey, sounder, looper, rr, prompt, stepper, randomSeed, rng } from './kit.js';
import * as L from './snakebattle-logic.js';

const { COLS, ROWS, CELLS } = L;
const TICK = 0.115;
const WINS = L.WINS;
const HUES = [140, 330];
const COUNT = 1.8;
const BETWEEN = 1.7;
const r1 = n => Math.round(n * 10) / 10;
const fin = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const KEYDIR = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };
const PH = { count: 0, play: 1, between: 2, over: 3 };

/* ------------------------------ drawing ------------------------------ */
function geometry(sf) {
  const hh = clamp(sf.h * 0.1, 34, 54);
  const c = Math.max(4, Math.min((sf.w - 16) / COLS, (sf.h - hh - 12) / ROWS));
  return { hh, c, ox: (sf.w - c * COLS) / 2, oy: hh + (sf.h - hh - c * ROWS) / 2 };
}

/* V = { snakes:[{body, from, alive, dir}, ...], food, alpha, names:[a,b], wins:[a,b], apples:[a,b], round, you: 0|1|null, time, reduced } */
function paintBoard(g, sf, V) {
  const geo = geometry(sf), c = geo.c;
  g.fillStyle = '#04080c';
  g.fillRect(0, 0, sf.w, sf.h);
  /* the header: who, rounds won, apples */
  g.save();
  g.textBaseline = 'middle';
  const fs = Math.round(clamp(geo.hh * 0.4, 12, 20));
  const side = (i, x, align) => {
    g.textAlign = align;
    g.font = `800 ${fs}px ${FONT}`;
    g.fillStyle = hsl(HUES[i], 90, 66);
    g.fillText(V.names[i], x, geo.hh * 0.36, sf.w * 0.3);
    for (let k = 0; k < WINS; k++) {
      const px = align === 'left' ? x + k * (fs * 0.9) + fs * 0.35 : x - k * (fs * 0.9) - fs * 0.35;
      g.fillStyle = k < V.wins[i] ? hsl(HUES[i], 95, 62) : 'rgba(255,255,255,.14)';
      g.beginPath(); g.arc(px, geo.hh * 0.74, fs * 0.28, 0, 7); g.fill();
    }
    g.font = `600 ${Math.round(fs * 0.8)}px ${FONT}`;
    g.fillStyle = 'rgba(230,240,235,.6)';
    g.textAlign = align;
    g.fillText(`${V.apples[i]} apple${V.apples[i] === 1 ? '' : 's'}`, align === 'left' ? x + fs * 3.3 : x - fs * 3.3, geo.hh * 0.74);
  };
  side(0, 14, 'left');
  side(1, sf.w - 14, 'right');
  g.textAlign = 'center'; g.font = `700 ${Math.round(fs * 0.9)}px ${FONT}`; g.fillStyle = 'rgba(230,240,235,.7)';
  g.fillText(`Round ${V.round}`, sf.w / 2, geo.hh * 0.36);
  g.font = `500 ${Math.round(fs * 0.7)}px ${FONT}`; g.fillStyle = 'rgba(230,240,235,.4)';
  g.fillText(`first to ${WINS}`, sf.w / 2, geo.hh * 0.74);
  g.restore();
  g.save();
  g.translate(geo.ox, geo.oy);
  /* the board */
  g.fillStyle = '#081a1a';
  rr(g, -4, -4, c * COLS + 8, c * ROWS + 8, 8); g.fill();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if ((x + y) & 1) { g.fillStyle = 'rgba(120,255,220,.035)'; g.fillRect(x * c, y * c, c, c); }
  }
  g.strokeStyle = 'rgba(120,255,220,.4)'; g.lineWidth = 2;
  rr(g, -4, -4, c * COLS + 8, c * ROWS + 8, 8); g.stroke();
  /* the apple */
  if (V.food >= 0) {
    const fx = (L.xOf(V.food) + 0.5) * c, fy = (L.yOf(V.food) + 0.5) * c;
    const pulse = V.reduced ? 1 : 1 + Math.sin(V.time * 6) * 0.07;
    g.save();
    g.shadowBlur = V.reduced ? 0 : 14; g.shadowColor = 'rgba(255,90,90,.9)';
    const gr = g.createRadialGradient(fx - c * 0.12, fy - c * 0.14, 1, fx, fy, c * 0.4 * pulse);
    gr.addColorStop(0, '#ffb0a0'); gr.addColorStop(1, '#d6283c');
    g.fillStyle = gr;
    g.beginPath(); g.arc(fx, fy, c * 0.36 * pulse, 0, 7); g.fill();
    g.restore();
    g.strokeStyle = '#4fbf5f'; g.lineWidth = Math.max(1.5, c * 0.07);
    g.beginPath(); g.moveTo(fx, fy - c * 0.3); g.quadraticCurveTo(fx + c * 0.05, fy - c * 0.5, fx + c * 0.2, fy - c * 0.48); g.stroke();
  }
  /* the snakes */
  V.snakes.forEach((s, i) => {
    const pts = s.body.map((cell, k) => {
      const to = { x: L.xOf(cell) + 0.5, y: L.yOf(cell) + 0.5 };
      const f = s.from && s.alive ? s.from[Math.min(k, s.from.length - 1)] : null;
      if (f === null || f === undefined) return { x: to.x * c, y: to.y * c };
      const a = { x: L.xOf(f) + 0.5, y: L.yOf(f) + 0.5 };
      return { x: (a.x + (to.x - a.x) * V.alpha) * c, y: (a.y + (to.y - a.y) * V.alpha) * c };
    });
    const hue = HUES[i], sat = s.alive ? 80 : 12, lum = s.alive ? 52 : 40;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalAlpha = s.alive ? 1 : 0.65;
    const stroke = (w, col) => { g.lineWidth = w; g.strokeStyle = col; g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (pts.length === 1) g.lineTo(pts[0].x + 0.01, pts[0].y); g.stroke(); };
    if (s.alive && !V.reduced) { g.shadowBlur = 12; g.shadowColor = hsl(hue, 100, 55, 0.7); }
    stroke(c * 0.86, hsl(hue, sat * 0.7, 24));
    g.shadowBlur = 0;
    stroke(c * 0.68, hsl(hue, sat, lum));
    stroke(c * 0.22, hsl(hue, sat, lum + 22, 0.7));
    const hd = pts[0];
    g.fillStyle = hsl(hue, sat, lum + 6);
    g.beginPath(); g.arc(hd.x, hd.y, c * 0.45, 0, 7); g.fill();
    const dx = [0, 1, 0, -1][s.dir], dy = [-1, 0, 1, 0][s.dir];
    for (const e of [-1, 1]) {
      const ex = hd.x + dx * c * 0.14 - dy * e * c * 0.17, ey = hd.y + dy * c * 0.14 + dx * e * c * 0.17;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, ey, c * 0.11, 0, 7); g.fill();
      g.fillStyle = s.alive ? '#0a1210' : '#333';
      g.beginPath(); g.arc(ex + dx * c * 0.03, ey + dy * c * 0.03, c * 0.055, 0, 7); g.fill();
    }
    g.restore();
    if (V.you === i && s.alive) {
      g.save();
      g.font = `800 ${Math.max(9, Math.round(c * 0.42))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillStyle = hsl(hue, 100, 80); g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3;
      const ty = hd.y - c * 0.55 < c * 0.4 ? hd.y + c * 1.25 : hd.y - c * 0.55;
      g.strokeText('YOU', hd.x, ty); g.fillText('YOU', hd.x, ty);
      g.restore();
    }
  });
  g.restore();
}

function bigText(g, sf, text, hue, sub) {
  const geo = geometry(sf);
  const cy = geo.oy + geo.c * ROWS / 2;
  g.save();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  /* as large as fits the board */
  let size = Math.round(clamp(geo.c * 2.6, 24, 76));
  g.font = `900 ${size}px ${FONT}`;
  const wide = g.measureText(text).width;
  const room = geo.c * COLS * 0.9;
  if (wide > room) { size = Math.max(14, Math.floor(size * room / wide)); g.font = `900 ${size}px ${FONT}`; }
  g.lineWidth = Math.max(4, size / 9); g.strokeStyle = 'rgba(0,0,0,.75)';
  g.strokeText(text, sf.w / 2, cy); g.fillStyle = hsl(hue, 100, 68); g.fillText(text, sf.w / 2, cy);
  if (sub) {
    const f2 = Math.round(clamp(geo.c * 0.8, 12, 20));
    g.font = `700 ${f2}px ${FONT}`; g.lineWidth = 5;
    g.strokeText(sub, sf.w / 2, cy + size * 0.8); g.fillStyle = '#eaf6ee'; g.fillText(sub, sf.w / 2, cy + size * 0.8);
  }
  g.restore();
}

/* ============================================================
   Local play and the host: the board lives here.
   ============================================================ */
export default {
  mount(el, ctx) {
    if (ctx.online && typeof ctx.online.send === 'function') return online(el, ctx);
    return board(el, ctx, null);
  },
};

/* One match. `net` is null for a local match, or the online link when this is the host. */
function board(el, ctx, net) {
  const two = !net && ctx.players === 2;
  const reduced = !!ctx.reduced;
  const snd = sounder(ctx);
  const name = net ? String(net.peer?.name || 'Friend').slice(0, 14) : null;
  const names = net ? ['YOU', name.toUpperCase()] : two ? ['P1', 'P2'] : ['YOU', 'CPU'];
  const M = {
    phase: net ? 'count' : 'ready',
    paused: false,
    seed: net ? (net.seed >>> 0) : randomSeed(),
    round: 1, R: null,
    wins: [0, 0], base: [0, 0],          /* apples from finished rounds */
    from: null, acc: 0, cd: COUNT, bt: 0, lastWinner: null,
    rnd: null, time: 0, over: false, ended: false,
    k: 0, sentAt: 0, lastIn: performance.now(), stalled: false, replyAt: 0,
    lastTn: -1, bad: 0, accepted: 0,
    swipe: null, hist: {},
    epoch: 0,                            /* bumped whenever the board is changed by anything but a tick (only a test hook does) */
  };
  M.rnd = rng(M.seed ^ 0x51ED);
  M.R = L.newRound(M.seed, 1);
  M.from = M.R.snakes.map(s => s.body.slice());
  const sf = surface(el, two ? 'Snake Battle, two players' : net ? `Snake Battle online against ${name}` : 'Snake Battle against the computer', () => draw());
  const apples = () => [M.base[0] + M.R.snakes[0].apples, M.base[1] + M.R.snakes[1].apples];
  report();
  function report() {
    const a = apples();
    if (net) { ctx.onScore(M.wins[0]); net.peerScore?.(M.wins[1]); } else ctx.onScore(two ? `${M.wins[0]} – ${M.wins[1]}` : a[0]);
  }

  function startRound() {
    M.R = L.newRound(M.seed, M.round);
    M.from = M.R.snakes.map(s => s.body.slice());
    M.phase = 'count'; M.cd = COUNT; M.acc = 0;
    M.lastWinner = null;
  }
  function begin() { if (M.phase === 'ready') startRound(); }

  function doTick() {
    const R = M.R;
    M.from = R.snakes.map(s => s.body.slice());
    if (!two && !net) L.turn(R, 1, L.chooseTurn(R, 1, M.rnd, 0.06));
    L.tick(R);
    M.hist[`${M.round}:${R.tick}`] = R.snakes.map(s => s.body.slice());      /* what the guest should be shown for this tick (tests compare) */
    delete M.hist[`${M.round}:${R.tick - 80}`];
    for (const ev of R.ev) {
      if (ev.kind === 'eat') { snd.blip(520 + ev.who * 160, 0.06, 'square', 0.9); report(); }
      else snd.blip(150, 0.25, 'sawtooth', 1, 55);
    }
    R.ev.length = 0;
    if (R.over) endRound();
    else if (net) sendSnap();
  }

  function endRound() {
    const R = M.R, w = R.over.winner;
    M.base = apples();
    M.lastWinner = w;
    if (w >= 0) M.wins[w]++;
    report();
    const decided = M.wins[0] >= WINS || M.wins[1] >= WINS;
    M.phase = decided ? 'over' : 'between'; M.bt = BETWEEN;
    if (w === 0) [523, 659, 784].forEach((f, i) => setTimeout(() => snd.blip(f, 0.1, 'triangle', 0.9), i * 90));
    if (decided) finish();          /* (the host's snapshot of the finished match goes out from there) */
    else if (net) sendSnap();
  }

  function finish() {
    M.over = true;
    const [a, b] = M.wins, ap = apples();
    draw();
    snd.blip(520, 0.3, 'triangle', 1, 1040);
    if (net) {
      sendSnap();
      [300, 1000, 2500].forEach(ms => setTimeout(() => { if (!M.ended) sendSnap(); }, ms));
      ctx.onEnd({ score: a, won: a > b, versus: { me: a, them: b }, detail: `You ${a} – ${b} ${name} in rounds · ${ap[0]} apples to ${ap[1]}` });
    } else if (two) ctx.onEnd({ score: Math.max(a, b), won: true, detail: `${a > b ? 'P1 (green)' : 'P2 (pink)'} wins ${Math.max(a, b)}–${Math.min(a, b)}` });
    else ctx.onEnd({ score: ap[0], won: a > b, detail: `${a > b ? 'You beat the computer' : 'The computer won'} ${a}–${b} in rounds · ${ap[0]} apple${ap[0] === 1 ? '' : 's'}` });
  }

  const clock = stepper(dt => {
    M.time += dt;
    if (M.phase === 'count') {
      M.cd -= dt;
      if (Math.ceil(M.cd / (COUNT / 3)) !== Math.ceil((M.cd + dt) / (COUNT / 3)) && M.cd > 0) snd.blip(440, 0.06, 'square', 0.6);
      if (M.cd <= 0) { M.phase = 'play'; M.acc = 0; snd.blip(880, 0.12, 'square', 0.8); }
    } else if (M.phase === 'play') {
      M.acc += dt;
      while (M.acc >= TICK && M.phase === 'play') { M.acc -= TICK; doTick(); }
    } else if (M.phase === 'between') {
      M.bt -= dt;
      if (M.bt <= 0) { M.round++; startRound(); }
    }
  }, 1 / 120);

  const loop = looper(dt => {
    if (net) {
      const t = performance.now();
      M.stalled = !M.over && t - M.lastIn > 2500;
      if (!M.stalled) clock.feed(dt);
      /* snapshots go out on every tick, and on this slower beat between them */
      if (!M.over && M.phase !== 'play' && t - M.sentAt > 250) sendSnap();
    } else if (M.phase !== 'ready' && M.phase !== 'over') clock.feed(dt);
    else if (M.phase === 'ready') M.time += dt;
    draw();
    if (M.phase === 'over') loop.stop();
  });

  /* the host's snapshot of the whole state */
  function snapshot() {
    const R = M.R, ap = apples();
    return { t: 's', k: ++M.k, ep: M.epoch, ph: PH[M.phase], cd: r1(Math.max(0, M.cd)), rd: M.round, tk: R.tick,
      w: M.wins.slice(), ap, a: R.snakes[0].body, b: R.snakes[1].body, f: R.food, da: R.snakes[0].dir, db: R.snakes[1].dir,
      al: [R.snakes[0].alive ? 1 : 0, R.snakes[1].alive ? 1 : 0], lw: M.lastWinner === null ? 2 : M.lastWinner };
  }
  function sendSnap() { M.sentAt = performance.now(); try { net.send(snapshot()); } catch (err) { /* link gone */ } }

  function takeTurn(d) {
    if (!Number.isInteger(d.k) || d.k < 0 || d.k > 1e9) return reject();
    if (!Number.isInteger(d.d) || d.d < 0 || d.d > 3) return reject();
    if (!Number.isInteger(d.tk) || d.tk < M.R.tick - 300 || d.tk > M.R.tick + 3) return reject();
    if (d.k <= M.lastTn) return;                  /* a late duplicate */
    M.lastTn = d.k; M.accepted++;
    if (M.phase === 'play' || M.phase === 'count') L.turn(M.R, 1, d.d);
  }
  function reject() { M.bad++; }
  function onNet(d) {
    if (M.ended || !d || typeof d !== 'object') return;
    M.lastIn = performance.now();
    if (d.t === 'tn') takeTurn(d);
    else if (d.t === 'hb') { /* alive */ }
    else if (d.t === 'need') { if (performance.now() - M.replyAt > 300) { M.replyAt = performance.now(); sendSnap(); } }
    else reject();
    if (M.over && d.t !== 'need' && performance.now() - M.replyAt > 300) { M.replyAt = performance.now(); sendSnap(); }
  }

  function viewData() {
    const R = M.R;
    return {
      snakes: R.snakes.map((s, i) => ({ body: s.body, from: M.phase === 'play' ? M.from[i] : null, alive: s.alive, dir: s.dir })),
      food: R.food, alpha: M.phase === 'play' ? clamp(M.acc / TICK, 0, 1) : 1,
      names, wins: M.wins, apples: apples(), round: M.round, you: two ? null : 0, time: M.time, reduced,
    };
  }
  function draw() {
    const g = sf.g;
    sf.begin();
    paintBoard(g, sf, viewData());
    overlay(g);
  }
  function overlay(g) {
    if (M.phase === 'ready') {
      const touch = coarse();
      prompt(g, sf, touch ? 'Swipe to steer · tap to start' : 'Press a key or click to start', two ? 'P1: W A S D  ·  P2: arrow keys' : touch ? `vs the computer · first to ${WINS} rounds` : 'Arrows or W A S D · first to 3 rounds', HUES[0], geometry(sf).oy + geometry(sf).c * ROWS * 0.3);
    } else if (M.phase === 'count') {
      const n = Math.ceil(M.cd / (COUNT / 3));
      bigText(g, sf, n > 0 ? String(n) : 'GO', 50, net ? `Round ${M.round} · you are green` : `Round ${M.round}`);
    } else if (M.phase === 'between' || M.phase === 'over') {
      const w = M.lastWinner;
      const you = (net || !two) ? 0 : -1;
      const text = w === -1 || w === null ? 'Draw' : two ? (w === 0 ? 'P1 takes it' : 'P2 takes it') : w === you ? 'You take the round' : net ? `${name} takes it` : 'The computer takes it';
      bigText(g, sf, M.phase === 'over' ? (net ? (M.wins[0] > M.wins[1] ? 'You win!' : `${name} wins`) : two ? 'Match over' : (M.wins[0] > M.wins[1] ? 'You win!' : 'Computer wins')) : text, w === -1 || w === null ? 50 : HUES[w]);
    }
    if (M.stalled) prompt(g, sf, `Waiting for ${name}…`, 'The game picks up when they are back', HUES[1]);
  }

  /* ------------------------------ input ------------------------------ */
  const steer = (who, dir) => {
    if (M.paused || M.over) return;
    if (net) { L.turn(M.R, 0, dir); return; }
    if (M.phase === 'ready') { begin(); }
    if (M.phase === 'play' || M.phase === 'count') L.turn(M.R, who, dir);
  };
  const onKey = e => {
    if (!ownsKey(el, e)) return;
    const d = KEYDIR[e.code];
    if (d !== undefined) {
      e.preventDefault(); snd.wake();
      if (two) steer(e.code.startsWith('Arrow') ? 1 : 0, d); else steer(0, d);
    } else if (e.code === 'Space') { e.preventDefault(); snd.wake(); if (!M.paused && !net) begin(); }
  };
  const swipeDir = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  const onDown = e => {
    snd.wake();
    if (M.paused) return;
    const r = sf.cv.getBoundingClientRect();
    M.swipe = { x: e.clientX, y: e.clientY, who: two && e.clientX - r.left > r.width / 2 ? 1 : 0, id: e.pointerId };
    if (M.phase === 'ready') begin();
  };
  const onMove = e => {
    const s = M.swipe;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > 22) { steer(s.who, swipeDir(dx, dy)); s.x = e.clientX; s.y = e.clientY; }
  };
  const onUp = () => { M.swipe = null; };
  window.addEventListener('keydown', onKey);
  sf.cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  const offNet = net ? net.on?.(onNet) || null : null;
  if (net) sendSnap();
  loop.start();

  return {
    stop() {
      M.ended = true;
      loop.stop();
      try { offNet?.(); } catch (err) { /* already off */ }
      window.removeEventListener('keydown', onKey);
      sf.cv.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      snd.close();
      sf.destroy();
    },
    ...(net ? {} : {
      pause() { M.paused = true; loop.stop(); draw(); },
      resume() { M.paused = false; if (M.phase !== 'over') loop.start(); },
    }),
    peek() {
      const R = M.R;
      return {
        online: !!net, reduced, role: net ? 'host' : null, two, phase: M.phase, paused: M.paused, over: M.over, round: M.round,
        wins: M.wins.slice(), apples: apples(), tick: R.tick, time: M.time, food: R.food, seed: M.seed,
        snakes: R.snakes.map(s => ({ body: s.body.slice(), dir: s.dir, alive: s.alive, apples: s.apples, queue: s.queue.slice() })),
        rejected: M.bad, accepted: M.accepted, stalled: M.stalled, k: M.k, lastTn: M.lastTn,
        cols: COLS, rows: ROWS, winner: M.lastWinner,
      };
    },
    /* test hook: inert unless a test calls it */
    hook(cmd, a) {
      const R = M.R;
      if (cmd === 'begin') { begin(); return M.phase; }
      if (cmd === 'skip') { M.cd = 0; return true; }
      if (cmd === 'seed') { M.seed = a >>> 0; M.rnd = rng(M.seed ^ 0x51ED); M.R = L.newRound(M.seed, M.round); M.from = M.R.snakes.map(s => s.body.slice()); return true; }
      if (cmd === 'place') {
        const s = R.snakes[a.who];
        s.body = a.body.map(([x, y]) => L.cellOf(x, y)); s.dir = a.dir ?? s.dir; s.queue = []; s.alive = true;
        M.epoch++;
        M.from = R.snakes.map(q => q.body.slice());
        return true;
      }
      if (cmd === 'food') { R.food = L.cellOf(a[0], a[1]); return true; }
      if (cmd === 'tick') { for (let i = 0; i < (a || 1) && M.phase === 'play'; i++) doTick(); return M.phase; }
      if (cmd === 'feed') {
        const frame = a.frame || 1 / 60;
        for (let t = 0; t < a.secs - 1e-9; t += frame) clock.feed(Math.min(frame, a.secs - t));
        return true;
      }
      if (cmd === 'next') { M.bt = 0; return true; }
      if (cmd === 'hist') return M.hist;
      return null;
    },
  };
}

/* ============================================================
   Online guest: send turns, draw what the host says.
   ============================================================ */
function online(el, ctx) {
  const NET = ctx.online;
  if (NET.role === 'host') return board(el, ctx, NET);
  const reduced = !!ctx.reduced;
  const snd = sounder(ctx);
  const name = String(NET.peer?.name || 'Friend').slice(0, 14);
  const names = [name.toUpperCase(), 'YOU'];
  const G = {
    snap: null, prev: null, recvAt: performance.now(), lastK: -1,
    k: 0, bad: 0, accepted: 0, over: false, ended: false, epoch: 0, lastBad: [], cur: null,
    lastIn: performance.now(), stalled: false, hbAt: 0, needAt: 0, time: 0,
    phase: 'count', round: 1, wins: [0, 0], apples: [0, 0], cd: 1.8, tk: 0, lw: 2,
    bodies: [L.newRound(NET.seed, 1).snakes[0].body, L.newRound(NET.seed, 1).snakes[1].body], from: null,
    dirs: [1, 3], alive: [true, true], food: -1, myTurnSeq: 0,
  };
  G.from = G.bodies.map(b => b.slice());
  const sf = surface(el, `Snake Battle online against ${name}`, () => draw());
  report();
  function report() { ctx.onScore(G.wins[1]); NET.peerScore?.(G.wins[0]); }

  function reject() { G.bad++; G.lastBad.push(G.cur); if (G.lastBad.length > 40) G.lastBad.shift(); }
  function takeSnap(d) {
    G.cur = d;
    if (!Number.isInteger(d.k) || d.k < 0 || d.k > 1e9) return reject();
    if (!Number.isInteger(d.ph) || d.ph < 0 || d.ph > 3) return reject();
    if (!Number.isInteger(d.rd) || d.rd < 1 || d.rd > 200 || d.rd < G.round) return reject();
    if (!Number.isInteger(d.ep) || d.ep < G.epoch || d.ep > 1e6) return reject();
    if (!Number.isInteger(d.tk) || d.tk < 0 || d.tk > L.MAX_TICKS + 2) return reject();
    if (!fin(d.cd, 0, 5)) return reject();
    if (!Array.isArray(d.w) || d.w.length !== 2 || !d.w.every((n, i) => Number.isInteger(n) && n >= G.wins[i] && n <= WINS)) return reject();
    if (!Array.isArray(d.ap) || d.ap.length !== 2 || !d.ap.every((n, i) => Number.isInteger(n) && n >= G.apples[i] && n <= 5000)) return reject();
    if ((d.ph === 3) !== (d.w[0] === WINS || d.w[1] === WINS) || (d.w[0] === WINS && d.w[1] === WINS)) return reject();
    if (d.rd === G.round && d.ph < PH[G.phase] && !(G.phase === 'between' && d.ph === 0)) return reject();
    if (!L.validBody(d.a) || !L.validBody(d.b)) return reject();
    const both = new Set([...d.a, ...d.b]);
    if (both.size !== d.a.length + d.b.length) return reject();
    if (!Number.isInteger(d.f) || d.f < -1 || d.f >= CELLS || (d.f >= 0 && both.has(d.f))) return reject();
    if (!Number.isInteger(d.da) || d.da < 0 || d.da > 3 || !Number.isInteger(d.db) || d.db < 0 || d.db > 3) return reject();
    if (!Array.isArray(d.al) || d.al.length !== 2 || !d.al.every(n => n === 0 || n === 1)) return reject();
    if (!Number.isInteger(d.lw) || d.lw < -1 || d.lw > 2) return reject();
    /* in play a head can move no farther than the ticks that went by */
    if (d.rd === G.round && G.phase === 'play' && d.ph === 1 && d.ep === G.epoch) {
      const gap = d.tk - G.tk;
      if (gap < 0) return reject();
      for (let i = 0; i < 2; i++) {
        const body = i ? d.b : d.a, was = G.bodies[i][0], now = body[0];
        if (Math.abs(L.xOf(now) - L.xOf(was)) + Math.abs(L.yOf(now) - L.yOf(was)) > Math.max(1, gap)) return reject();
      }
    }
    if (d.k <= G.lastK) return;                  /* older than what is shown: harmless */
    G.lastK = d.k; G.accepted++;
    apply(d);
  }
  function apply(d) {
    const prevApples = G.apples.slice(), prevAlive = G.alive.slice(), prevWins = G.wins.slice(), prevRound = G.round;
    G.from = d.rd === G.round && G.phase === 'play' && d.ph === 1 && d.ep === G.epoch ? G.bodies.map(b => b.slice()) : d.a.length ? [d.a.slice(), d.b.slice()] : G.bodies;
    G.bodies = [d.a.slice(), d.b.slice()];
    G.dirs = [d.da, d.db]; G.alive = [!!d.al[0], !!d.al[1]];
    G.food = d.f; G.cd = d.cd; G.tk = d.tk; G.lw = d.lw; G.epoch = d.ep;
    G.phase = ['count', 'play', 'between', 'over'][d.ph]; G.round = d.rd;
    G.wins = d.w.slice(); G.apples = d.ap.slice();
    G.recvAt = performance.now();
    if (G.apples[0] > prevApples[0] || G.apples[1] > prevApples[1]) snd.blip(G.apples[1] > prevApples[1] ? 680 : 520, 0.06, 'square', 0.9);
    if ((prevAlive[0] && !G.alive[0]) || (prevAlive[1] && !G.alive[1])) snd.blip(150, 0.25, 'sawtooth', 1, 55);
    if (G.wins[0] !== prevWins[0] || G.wins[1] !== prevWins[1] || G.round !== prevRound) report();
    if (G.phase === 'over') finishGuest();
  }
  function finishGuest() {
    if (G.over) return;
    G.over = true;
    report();
    draw();
    snd.blip(520, 0.3, 'triangle', 1, 1040);
    const me = G.wins[1], them = G.wins[0];
    ctx.onEnd({ score: me, won: me > them, versus: { me, them }, detail: `You ${me} – ${them} ${name} in rounds · ${G.apples[1]} apples to ${G.apples[0]}` });
  }
  function onNet(d) {
    if (G.ended || !d || typeof d !== 'object') return;
    G.lastIn = performance.now();
    if (d.t === 's') takeSnap(d); else { G.cur = d; reject(); }
  }

  const loop = looper(dt => {
    G.time += dt;
    const pm = performance.now();
    G.stalled = !G.over && pm - G.lastIn > 2500;
    if (!G.over && pm - G.hbAt > 250) { G.hbAt = pm; try { NET.send({ t: 'hb' }); } catch (err) { /* gone */ } }
    if (!G.over && pm - G.recvAt > 1200 && pm - G.needAt > 900) { G.needAt = pm; try { NET.send({ t: 'need' }); } catch (err) { /* gone */ } }
    draw();
    if (G.over) loop.stop();
  });

  function draw() {
    const g = sf.g;
    sf.begin();
    const playing = G.phase === 'play';
    paintBoard(g, sf, {
      snakes: [0, 1].map(i => ({ body: G.bodies[i], from: playing ? G.from[i] : null, alive: G.alive[i], dir: G.dirs[i] })),
      food: G.food, alpha: playing ? clamp((performance.now() - G.recvAt) / (TICK * 1000), 0, 1) : 1,
      names, wins: G.wins, apples: G.apples, round: G.round, you: 1, time: G.time, reduced,
    });
    /* the host is green on the left, I am pink on the right; the header lists the host first */
    if (G.phase === 'count') bigText(g, sf, G.cd > 0 ? String(Math.max(1, Math.ceil(G.cd / 0.6))) : 'GO', 50, `Round ${G.round} · you are pink`);
    else if (G.phase === 'between' || G.phase === 'over') {
      const w = G.lw;
      const txt = G.phase === 'over' ? (G.wins[1] > G.wins[0] ? 'You win!' : `${name} wins`) : w === 1 ? 'You take the round' : w === 0 ? `${name} takes it` : 'Draw';
      bigText(g, sf, txt, w === 0 || w === 1 ? HUES[w] : 50);
    }
    if (G.stalled) prompt(g, sf, `Waiting for ${name}…`, 'The game picks up when they are back', HUES[0]);
  }

  const send = dir => {
    if (G.over || G.stalled) return;
    try { NET.send({ t: 'tn', k: ++G.k, d: dir, tk: G.tk }); } catch (err) { /* gone */ }
  };
  const onKey = e => {
    if (!ownsKey(el, e)) return;
    const d = KEYDIR[e.code];
    if (d !== undefined) { e.preventDefault(); snd.wake(); send(d); } else if (e.code === 'Space') { e.preventDefault(); snd.wake(); }
  };
  let swipe = null;
  const onDown = e => { snd.wake(); swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onMove = e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) > 22) { send(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0)); swipe.x = e.clientX; swipe.y = e.clientY; }
  };
  const onUp = () => { swipe = null; };
  window.addEventListener('keydown', onKey);
  sf.cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  const offNet = NET.on?.(onNet) || null;
  loop.start();

  return {
    stop() {
      G.ended = true;
      loop.stop();
      try { offNet?.(); } catch (err) { /* already off */ }
      window.removeEventListener('keydown', onKey);
      sf.cv.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      snd.close();
      sf.destroy();
    },
    peek() {
      return {
        online: true, reduced, role: 'guest', phase: G.phase, over: G.over, round: G.round, wins: [G.wins[1], G.wins[0]], winsHostFirst: G.wins.slice(),
        apples: G.apples.slice(), tick: G.tk, food: G.food, time: G.time,
        snakes: G.bodies.map((b, i) => ({ body: b.slice(), dir: G.dirs[i], alive: G.alive[i] })),
        rejected: G.bad, accepted: G.accepted, stalled: G.stalled, lastK: G.lastK, sentTurns: G.k, epoch: G.epoch, lastBad: G.lastBad.slice(-3).map(m => JSON.stringify(m).slice(0, 400)),
        cols: COLS, rows: ROWS,
      };
    },
  };
}
