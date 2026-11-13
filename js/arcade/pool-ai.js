/* ============================================================
   arcade/pool-ai.js — the computer's pool player.

   It plays the same game you do: it only shoots at balls it is
   allowed to hit first (its group, the 8 once its group is
   cleared, any non-8 on an open table), never aims at a spot
   it cannot reach, and with ball in hand puts the cue ball where
   the rules let it.

   How it chooses. For every ball it may hit and every pocket it
   can see it works out the "ghost ball" position the cue ball
   must reach to send the target into that pocket, skips lines that
   another ball blocks, and picks a power from the table's friction.
     · Easy: takes one of the easier lines at random, with a wide
       aim error (σ ≈ 2.6°) and a loose power.
     · Medium: plays the 12 best lines through the real physics
       (the same pool-sim.js, at half the step rate) and keeps the
       one that scores best under the real rules; aim error σ ≈ 0.9°.
     · Hard: tries the 48 best lines at three powers each and
       places the cue ball with ball in hand where it has the best
       line; aim error σ ≈ 0.25°.
   A shot is scored by the rules engine: own balls pocketed up,
   scratches, fouls and handing over the 8 early down.
   Everything here is deterministic given the random function.
   ============================================================ */
import { R, W, H, POCKETS, MAXV, createSim, strike, cloneBalls, canPlace } from './pool-sim.js';
import { judgeShot, targets, remaining } from './pool-rules.js';

export const LEVELS = {
  easy: { id: 'easy', name: 'Easy', err: 0.028, sims: 0, powers: [1], spot: 'random' },
  medium: { id: 'medium', name: 'Medium', err: 0.016, sims: 12, powers: [1], spot: 'good' },
  hard: { id: 'hard', name: 'Hard', err: 0.0045, sims: 48, powers: [0.82, 1, 1.28], spot: 'best' },
};

const FR_C = 45, FR_V = 0.28;
const stopDist = v => (v - (FR_C / FR_V) * Math.log(1 + (FR_V * v) / FR_C)) / FR_V;
function speedFor(dist) {
  let lo = 0, hi = 4000;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (stopDist(m) < dist) lo = m; else hi = m; }
  return hi;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
const gauss = rnd => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

/* every unblocked line: { angle, power, geo, target, pocket } */
export function lines(game, cx, cy) {
  const on = game.balls.filter(b => b.in && b.id !== 0);
  const out = [];
  for (const id of targets(game)) {
    const b = game.balls[id];
    POCKETS.forEach((p, pi) => {
      const vx = p.x - b.x, vy = p.y - b.y, d = Math.hypot(vx, vy);
      if (d < 1) return;
      const ux = vx / d, uy = vy / d;
      /* a side pocket cannot be fed along the rail */
      if ((pi === 1 || pi === 4) && Math.abs(uy) < 0.4) return;
      const gx = b.x - ux * 2 * R, gy = b.y - uy * 2 * R;
      if (gx < R || gx > W - R || gy < R || gy > H - R) return;
      const cgx = gx - cx, cgy = gy - cy, dcg = Math.hypot(cgx, cgy);
      if (dcg < 1) return;
      const cos = (cgx * ux + cgy * uy) / dcg;
      if (cos < 0.2) return;
      let blocked = false;
      for (const o of on) {
        if (o.id === id) continue;
        if (segDist(o.x, o.y, cx, cy, gx, gy) < 2 * R - 0.5 || segDist(o.x, o.y, b.x, b.y, p.x, p.y) < 2 * R - 0.5) { blocked = true; break; }
      }
      /* the cue ball must not touch the target's neighbours before the ghost position either: done above */
      if (blocked) return;
      const vObj = speedFor(d + 90);
      const vImp = vObj / (0.96 * Math.max(0.25, cos));
      const v0 = speedFor(stopDist(vImp) + dcg);
      out.push({ angle: Math.atan2(cgy, cgx), power: Math.max(0.1, Math.min(1, v0 / MAXV)), geo: cos - 0.0005 * (dcg + d), target: id, pocket: pi });
    });
  }
  return out.sort((a, b) => b.geo - a.geo);
}

/* a try: play the shot on a copy through the real rules, return how good it was */
function tryShot(game, angle, power, place, dt = 1 / 240) {
  const balls = cloneBalls(game.balls);
  if (place) { balls[0].x = place.x; balls[0].y = place.y; balls[0].in = true; }
  const g2 = { ...game, balls, groups: game.groups.slice(), fouls: game.fouls.slice(), log: [], over: null };
  strike(balls, angle, power);
  const sim = createSim(balls, dt);
  const ev = sim.run(20);
  const me = game.turn;
  const grp = game.groups[me];
  const res = judgeShot(g2, ev);
  let s = 0;
  if (g2.over) s = g2.over.winner === me ? 10000 : -10000;
  else {
    const own = ev.pocketed.filter(id => id !== 0 && id !== 8 && (grp ? (id < 8 ? 'solid' : 'stripe') === grp : true)).length;
    const theirs = ev.pocketed.filter(id => id !== 0 && id !== 8).length - own;
    s += own * 100 - theirs * 40;
    if (res.continues) s += 30;
    if (res.foul) s -= 260;
    if (ev.cueIn) s -= 120;
    if (ev.first === null) s -= 60;
    /* a clear table for my next shot is worth a little: the fewer of my balls are blocked */
    if (!res.foul) s += 2 * (remaining(g2, grp || 'solid') < remaining(game, grp || 'solid') ? 1 : 0);
  }
  return { s, res };
}

function pickSpot(game, level, rnd) {
  const balls = game.balls;
  const spots = [];
  const xs = level.spot === 'best' ? [80, 140, 200, 260, 320, 380, 440] : [120, 200, 300, 400];
  const ys = level.spot === 'best' ? [70, 130, 200, 270, 330] : [100, 200, 300];
  for (const x of xs) for (const y of ys) if (canPlace(balls, x, y)) spots.push({ x, y });
  if (!spots.length) for (let x = R; x < W; x += 20) for (let y = R; y < H; y += 20) if (canPlace(balls, x, y)) spots.push({ x, y });
  if (level.spot === 'random') return spots[Math.floor(rnd() * spots.length)] || { x: 200, y: H / 2 };
  let best = spots[0], bs = -Infinity;
  for (const p of spots) {
    const ls = lines(game, p.x, p.y);
    const s = ls.length ? ls[0].geo + 0.12 * Math.min(4, ls.length) : -1;
    if (s > bs) { bs = s; best = p; }
  }
  return best || { x: 200, y: H / 2 };
}

/* The computer's shot: { angle, power, place } (place: where it puts the cue ball with ball in hand). */
export function chooseShot(game, levelId, rnd = Math.random) {
  const L = LEVELS[levelId] || LEVELS.medium;
  const place = game.inHand ? pickSpot(game, L, rnd) : null;
  const cue = place || game.balls[0];
  let cands = lines(game, cue.x, cue.y);
  let plan = null;
  if (L.sims === 0) {
    if (cands.length && rnd() > 0.1) {
      const k = Math.min(cands.length, 4);
      plan = cands[Math.floor(rnd() * k)];
      plan = { angle: plan.angle, power: Math.min(1, plan.power * (0.95 + rnd() * 0.4)) };
    }
  } else if (cands.length) {
    let best = null;
    for (const c of cands.slice(0, L.sims)) for (const m of L.powers) {
      const power = Math.max(0.08, Math.min(1, c.power * m));
      const r = tryShot(game, c.angle, power, place);
      const s = r.s + c.geo;
      if (!best || s > best.s) best = { s, angle: c.angle, power };
    }
    plan = best;
  }
  if (!plan) {
    /* nothing to pot: hit the nearest ball I may hit, softly, on a line nothing blocks */
    const on = game.balls.filter(b => b.in && b.id !== 0);
    let pick = null, bd = Infinity;
    for (const id of targets(game)) {
      const b = game.balls[id], d = Math.hypot(b.x - cue.x, b.y - cue.y);
      const blocked = on.some(o => o.id !== id && segDist(o.x, o.y, cue.x, cue.y, b.x, b.y) < 2 * R - 0.5);
      const cost = d + (blocked ? 600 : 0);
      if (cost < bd) { bd = cost; pick = b; }
    }
    const angle = Math.atan2(pick.y - cue.y, pick.x - cue.x);
    let power = Math.max(0.2, Math.min(0.7, speedFor(Math.hypot(pick.x - cue.x, pick.y - cue.y) + 140) / MAXV));
    if (game.breaking) power = L.sims ? 0.9 : 0.6;                 /* the break: hit the rack hard */
    if (L.sims && !game.breaking) {
      let best = null;
      for (const a of [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2]) for (const m of [0.7, 1, 1.4]) {
        const r = tryShot(game, angle + a, Math.min(1, power * m), place);
        if (!best || r.s > best.s) best = { s: r.s, angle: angle + a, power: Math.min(1, power * m) };
      }
      plan = best;
    } else plan = { angle, power };
  }
  /* the human error of this level */
  const angle = plan.angle + gauss(rnd) * L.err;
  const power = Math.max(0.05, Math.min(1, plan.power * (1 + gauss(rnd) * (L.err > 0.03 ? 0.08 : 0.02))));
  return { angle, power, place };
}
