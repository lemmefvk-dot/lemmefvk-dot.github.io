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
import { makeBalls, groupOf, R, W, H, canPlace } from './pool-sim.js';

export const newGame = () => ({
  balls: makeBalls(), turn: 0, groups: [null, null], inHand: false, breaking: true,
  over: null, shots: 0, fouls: [0, 0], log: [],
});

export const inGroup = (id, grp) => groupOf(id) === grp;
/* the group a player must hit first, as a list of ids still on the table */
export function targets(game, who = game.turn) {
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
    if (balls.every(b => b.id === 8 || !b.in || Math.hypot(b.x - x, b.y - y) >= 2 * R + 1)) return { x, y };
  }
  return { x: 600, y: H / 2 };
};

/* Judge a finished shot. `game` is the state before the shot, but with balls as the sim left them
   (pocketed balls have in = false). Returns what happens next and updates `game`. */
export function judgeShot(game, ev) {
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
