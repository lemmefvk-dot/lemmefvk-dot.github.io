/* ============================================================
   arcade/pool-rules.js — the rules of 8-ball, as a pure function
   of what happened in a shot (a pool-sim.js event record).

   What is implemented (WPA-style, with the simplifications below):
     · Take turns. Keep shooting while you legally pocket a ball.
     · The table is open until a legal shot pockets a ball after
       the break; that ball's group (solids 1–7 or stripes 9–15)
       is yours, the other is the opponent's.
     · Your first contact must be a ball of your group — or the 8
       once your group is cleared; on an open table anything but
       the 8.
     · Fouls: scratching the cue ball; hitting no ball; hitting the
       wrong ball first; and a shot where, after the first contact,
       no ball is pocketed and none reaches a cushion. A foul gives
       the opponent ball in hand (anywhere on the table).
     · Break: legal if a ball is pocketed or at least four object
       balls reach a cushion; otherwise it is a foul. A pocketed 8
       on the break is spotted again (not a loss). Balls pocketed on
       the break do not assign groups.
     · The 8: pocket it after clearing your group, without a foul,
       and you win. Pocketing it any earlier — or on a foul, or in
       the same shot as your last ball — loses.
   Simplified: no called pockets (any pocket counts), no
   "opponent's ball on a foul is spotted", ball in hand is anywhere
   even after a foul on the break, no push-shot or double-hit
   rule, no 3-foul rule, no re-rack for a bad break.
   ============================================================ */
import { makeBalls, makeBalls9, rackSpots, groupOf, R, W, H, canPlace } from './pool-sim.js';

/* The other two games (the Arcade's modes; online is always 8-ball):
   9-BALL — balls 1 to 9. Your first contact must be the lowest ball on
     the table; anything you pocket on a legal shot keeps you at the
     table, and the 9 pocketed on any legal shot (the break, a combination)
     wins. Fouls as in 8-ball give ball in hand; a 9 pocketed on a foul is
     spotted again. No push-out, no three-foul rule.
   STRAIGHT POOL (14.1, simplified: no called shots, like the 8-ball here)
     — any ball may be hit first; each ball pocketed on a legal shot is a
     point and keeps you at the table. A foul costs a point (an illegal
     break, fewer than two balls to a cushion and none pocketed, costs two)
     and gives ball in hand; balls pocketed on a foul don't count. When one
     object ball is left, the other fourteen are racked again with the
     apex empty (a ball or the cue ball in the way is moved out), and play
     goes on. First to STRAIGHT_TO points wins.
   A shot clock that runs out (pool.js) is a foul too: timeFoul(). */
export const KINDS = { '8ball': '8-ball', '9ball': '9-ball', straight: 'Straight pool' };
export const STRAIGHT_TO = 25;

export const newGame = (kind = '8ball') => ({
  kind: KINDS[kind] ? kind : '8ball',
  balls: kind === '9ball' ? makeBalls9() : makeBalls(), turn: 0, groups: [null, null], inHand: false, breaking: true,
  over: null, shots: 0, fouls: [0, 0], log: [], points: [0, 0],
});

export const inGroup = (id, grp) => groupOf(id) === grp;
/* the lowest-numbered object ball on the table (9-ball) */
export const lowest = game => Math.min(...game.balls.filter(b => b.in && b.id !== 0).map(b => b.id));
/* is pocketing this ball good for `who`? (the computer's planning) */
export function ownBall(game, who, id) {
  if (id === 0) return false;
  if (game.kind === '9ball' || game.kind === 'straight') return true;
  const grp = game.groups[who];
  return grp ? groupOf(id) === grp : id !== 8;
}
/* the group a player must hit first, as a list of ids still on the table */
export function targets(game, who = game.turn) {
  if (game.kind === '9ball') { const on = game.balls.filter(b => b.in && b.id !== 0); return on.length ? [lowest(game)] : []; }
  if (game.kind === 'straight') return game.balls.filter(b => b.in && b.id !== 0).map(b => b.id);
  const grp = game.groups[who];
  const on = game.balls.filter(b => b.in && b.id !== 0);
  if (!grp) return on.filter(b => b.id !== 8).map(b => b.id);
  const mine = on.filter(b => groupOf(b.id) === grp).map(b => b.id);
  return mine.length ? mine : on.filter(b => b.id === 8).map(b => b.id);
}
export const remaining = (game, grp) => game.balls.filter(b => b.in && groupOf(b.id) === grp).length;

/* the foot spot, for spotting the 8 again */
const spot = balls => {
  for (const x of [600, 620, 640, 660, 580, 560, 540]) for (const y of [H / 2, H / 2 - 24, H / 2 + 24, H / 2 - 48, H / 2 + 48]) {
    if (balls.every(b => b.id === 8 || !b.in || Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2) >= 2 * R + 1)) return { x, y };
  }
  return { x: 600, y: H / 2 };
};

/* a ball put back on the table near the foot spot (the 9 in 9-ball) */
const spotBall = (game, id) => {
  const others = game.balls.filter(b => b.id !== id);
  for (const x of [600, 620, 640, 660, 580, 560, 540]) for (const y of [H / 2, H / 2 - 24, H / 2 + 24, H / 2 - 48, H / 2 + 48]) {
    if (others.every(b => !b.in || Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2) >= 2 * R + 1)) { const b = game.balls[id]; b.in = true; b.x = x; b.y = y; b.vx = b.vy = 0; return; }
  }
  const b = game.balls[id]; b.in = true; b.x = 600; b.y = H / 2; b.vx = b.vy = 0;
};
const resetCue = game => { const c = game.balls[0]; c.in = true; c.x = 200; c.y = H / 2; c.vx = c.vy = 0; };
/* the fouls every game shares */
function baseFoul(game, ev, legalFirst, firstName) {
  const pocketedObj = ev.pocketed.filter(id => id !== 0);
  let foul = null;
  if (ev.first === null) foul = 'hit no ball';
  else if (!legalFirst(ev.first)) foul = firstName(ev.first);
  if (ev.cueIn) foul = foul ? foul + ' and scratched' : 'scratched';
  if (!foul && !ev.rails && pocketedObj.length === 0) foul = 'no ball reached a cushion';
  return { foul, pocketedObj };
}

function judgeNine(game, ev) {
  const me = game.turn, opp = 1 - me;
  /* the lowest ball as the shot began: the ones still on, and the ones it just pocketed */
  const low = Math.min(...game.balls.filter(b => b.id !== 0 && (b.in || ev.pocketed.includes(b.id))).map(b => b.id));
  let { foul, pocketedObj } = baseFoul(game, ev, id => id === low, id => `hit the ${id} before the ${low}`);
  const breaking = game.breaking;
  if (!foul && breaking && pocketedObj.length === 0 && ev.railObj.size < 4) foul = 'illegal break';
  const res = { foul, continues: false, win: null, reason: '', assigned: null, spotted9: false, pocketed: ev.pocketed.slice() };
  game.shots++;
  game.breaking = false;
  if (pocketedObj.includes(9) && !foul) {
    game.over = { winner: me, reason: breaking ? 'pocketed the 9 on the break' : 'pocketed the 9' };
    res.win = me; res.reason = game.over.reason;
  } else {
    if (pocketedObj.includes(9)) { spotBall(game, 9); res.spotted9 = true; }
    if (foul) game.fouls[me]++;
    res.continues = !foul && pocketedObj.length > 0;
    if (!res.continues) game.turn = opp;
    game.inHand = !!foul;
    if (ev.cueIn) resetCue(game);
  }
  game.log.push({ by: me, foul, pocketed: ev.pocketed.slice(), continues: res.continues });
  return res;
}

/* straight pool: rack the pocketed balls again, the apex left empty while one ball is still on */
function rerack(game) {
  const spots = rackSpots(), dx = spots[1].x - spots[0].x;
  const inRack = b => b.x > 600 - 3 * R && b.x < 600 + 4 * dx + 3 * R && Math.abs(b.y - H / 2) < 5 * R + 3 * R;
  const left = game.balls.filter(b => b.in && b.id !== 0);
  const down = game.balls.filter(b => !b.in && b.id !== 0);
  /* a last ball or the cue ball in the triangle's way is moved out of it first */
  for (const b of left) if (inRack(b)) { b.x = 200; b.y = H / 2; }
  const cue = game.balls[0];
  if (cue.in && inRack(cue)) { cue.x = 120; cue.y = H / 2; }
  if (left.some(b => Math.abs(b.x - cue.x) < 2 * R + 1 && Math.abs(b.y - cue.y) < 2 * R + 1)) { cue.x = 120; cue.y = H / 2 - 60; }
  const use = left.length ? spots.slice(1) : spots;
  down.forEach((b, i) => { const s = use[i]; b.in = true; b.x = s.x; b.y = s.y; b.vx = b.vy = 0; b.pocket = undefined; });
}

function judgeStraight(game, ev) {
  const me = game.turn, opp = 1 - me;
  let { foul, pocketedObj } = baseFoul(game, ev, () => true, () => '');
  const breaking = game.breaking;
  let cost = 1;
  if (!foul && breaking && pocketedObj.length === 0 && ev.railObj.size < 2) { foul = 'illegal break'; cost = 2; }
  const res = { foul, continues: false, win: null, reason: '', assigned: null, scored: 0, reracked: false, pocketed: ev.pocketed.slice() };
  game.shots++;
  game.breaking = false;
  if (foul) { game.fouls[me]++; game.points[me] -= cost; res.scored = -cost; }
  else { game.points[me] += pocketedObj.length; res.scored = pocketedObj.length; }
  if (game.points[me] >= STRAIGHT_TO) {
    game.over = { winner: me, reason: `reached ${STRAIGHT_TO} points` };
    res.win = me; res.reason = game.over.reason;
  } else {
    res.continues = !foul && pocketedObj.length > 0;
    if (!res.continues) game.turn = opp;
    game.inHand = !!foul;
    if (ev.cueIn) resetCue(game);
    if (game.balls.filter(b => b.in && b.id !== 0).length <= 1) { rerack(game); res.reracked = true; }
  }
  game.log.push({ by: me, foul, pocketed: ev.pocketed.slice(), continues: res.continues });
  return res;
}

/* the shot clock ran out: a foul by the player at the table */
export function timeFoul(game) {
  const me = game.turn;
  game.fouls[me]++;
  if (game.kind === 'straight') game.points[me] -= 1;
  game.turn = 1 - me;
  game.inHand = true;
  game.log.push({ by: me, foul: 'ran out of time', pocketed: [], continues: false });
  return { foul: 'ran out of time', continues: false, win: null, reason: '', pocketed: [], scored: game.kind === 'straight' ? -1 : 0 };
}

/* Judge a finished shot. `game` is the state before the shot, but with balls as the sim left them
   (pocketed balls have in = false). Returns what happens next and updates `game`. */
export function judgeShot(game, ev) {
  if (game.kind === '9ball') return judgeNine(game, ev);
  if (game.kind === 'straight') return judgeStraight(game, ev);
  const me = game.turn, opp = 1 - me;
  const grpBefore = game.groups[me];
  const pocketedObj = ev.pocketed.filter(id => id !== 0);
  const own = id => (grpBefore ? groupOf(id) === grpBefore : id !== 8);
  /* balls of my group on the table before this shot */
  const remBefore = grpBefore ? remaining(game, grpBefore) + pocketedObj.filter(id => groupOf(id) === grpBefore).length : 15;
  const eightLegal = grpBefore && remBefore === 0;
  const legalFirst = id => (eightLegal ? id === 8 : grpBefore ? groupOf(id) === grpBefore : id !== 8);
  let foul = null;
  if (ev.first === null) foul = 'hit no ball';
  else if (!legalFirst(ev.first)) foul = ev.first === 8 && !eightLegal ? 'hit the 8 first' : 'hit the wrong group first';
  if (ev.cueIn) foul = foul ? foul + ' and scratched' : 'scratched';
  if (!foul && !ev.rails && pocketedObj.length === 0) foul = 'no ball reached a cushion';
  const breaking = game.breaking;
  if (!foul && breaking && pocketedObj.length === 0 && ev.railObj.size < 4) foul = 'illegal break';

  const res = { foul, continues: false, win: null, reason: '', assigned: null, spotted8: false, pocketed: ev.pocketed.slice() };
  game.shots++;
  game.breaking = false;
  const eightIn = pocketedObj.includes(8);
  let loser = null, winner = null;

  if (eightIn && breaking) {
    const p = spot(game.balls);
    const b8 = game.balls[8]; b8.in = true; b8.x = p.x; b8.y = p.y; b8.vx = b8.vy = 0;
    res.spotted8 = true;
  } else if (eightIn) {
    if (foul || !eightLegal || remBefore > 0) { loser = me; res.reason = foul ? `pocketed the 8 on a foul (${foul})` : 'pocketed the 8 before clearing their group'; }
    else { winner = me; res.reason = 'pocketed the 8 after clearing their group'; }
  }
  /* groups */
  if (!game.groups[0] && !game.groups[1] && !breaking && !foul) {
    const first = pocketedObj.find(id => id !== 8);
    if (first !== undefined) {
      const g = groupOf(first);
      game.groups[me] = g; game.groups[opp] = g === 'solid' ? 'stripe' : 'solid';
      res.assigned = g;
    }
  }
  if (foul) game.fouls[me]++;
  const gotOwn = pocketedObj.some(id => id !== 8 && (breaking ? true : groupOf(id) === game.groups[me] || (!game.groups[me])));
  res.continues = !foul && gotOwn && !winner && !loser;
  if (winner !== null || loser !== null) {
    game.over = { winner: winner !== null ? winner : 1 - loser, reason: res.reason };
    res.win = game.over.winner;
  } else {
    if (!res.continues) game.turn = opp;
    game.inHand = !!foul || ev.cueIn;
    if (ev.cueIn) { const c = game.balls[0]; c.in = true; c.x = 200; c.y = H / 2; c.vx = c.vy = 0; }
  }
  game.log.push({ by: me, foul, pocketed: ev.pocketed.slice(), continues: res.continues });
  return res;
}

/* A short fingerprint of the table between shots: every ball (on or off, its
   spot to 1/100 px), whose turn, the groups, ball in hand, the break, the end.
   An online game sends it with each shot so the other screen can tell, before
   it plays the shot, that both tables are still the same. */
export function stateHash(game) {
  let s = `${game.turn}|${game.groups[0] || '-'}|${game.groups[1] || '-'}|${game.inHand ? 1 : 0}|${game.breaking ? 1 : 0}|${game.over ? game.over.winner : '-'}`;
  for (const b of game.balls) s += `|${b.id}:${b.in ? `${Math.round(b.x * 100)},${Math.round(b.y * 100)}` : 'x'}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/* a legal place to drop the cue ball, nearest to (x, y) */
export function nearestFree(game, x, y) {
  if (canPlace(game.balls, x, y)) return { x, y };
  let best = null, bd = Infinity;
  for (let gx = R; gx <= W - R; gx += 8) for (let gy = R; gy <= H - R; gy += 8) {
    if (!canPlace(game.balls, gx, gy)) continue;
    const d = Math.hypot(gx - x, gy - y);
    if (d < bd) { bd = d; best = { x: gx, y: gy }; }
  }
  return best || { x: 200, y: H / 2 };
}
