/* ============================================================
   arcade/heist-logic.js — the rules and the solver of Clockwork
   Heist.

   A thief on a grid, one action a turn: step to a neighbouring
   square, or wait. After every action the clockwork robots take their
   step, and anything standing in a robot's sight is caught.

   LEVEL: { name, rows, robots }
     rows    strings: '#' wall · '.' floor · 'S' start · 'E' exit · 'G' gem
     robots  { type: 'patrol', route: [[x, y], …], range }
               goes round its route one square a turn (a closed loop; a
               square listed twice in a row is a turn spent standing still);
               it faces the way it is about to go
             { type: 'camera', at: [x, y], dirs: ['E', 'S', …], every, range }
               does not move; turns to the next direction every `every` turns
     A robot sees its own square and, in the way it faces, up to `range`
     squares, stopped by a wall. The exit opens once every gem is taken.

   TIME. Turn t is the number of actions taken. Robots repeat, so a state
   of the puzzle is (square, t mod period, gems taken): the solver is a
   breadth-first search over those, so par — the fewest turns that get the
   thief out — is exact. A catch also happens when the thief and a patrol
   swap squares (they would pass through each other).

   Pure functions, no DOM: the play-tests import this file directly.
   ============================================================ */
export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const ACTIONS = ['N', 'E', 'S', 'W', '.'];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** a level read into what the rules use */
export function parse(level) {
  const rows = level.rows, h = rows.length, w = rows[0].length;
  const wall = new Uint8Array(w * h), gems = [];
  let start = null, exit = null;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '#') wall[y * w + x] = 1;
    else if (ch === 'S') start = [x, y];
    else if (ch === 'E') exit = [x, y];
    else if (ch === 'G') gems.push([x, y]);
  }));
  const robots = level.robots.map(r => {
    if (r.type === 'patrol') {
      const L = r.route.length, face = [];
      for (let t = 0; t < L; t++) {
        let d = null;
        for (let k = 0; k < L && !d; k++) {
          const a = r.route[(t - k + L) % L], b = r.route[(t - k + 1 + L) % L];
          if (a[0] !== b[0] || a[1] !== b[1]) d = b[0] > a[0] ? 'E' : b[0] < a[0] ? 'W' : b[1] > a[1] ? 'S' : 'N';
        }
        face.push(d || 'S');
      }
      return { ...r, period: L, face };
    }
    return { ...r, period: r.dirs.length * r.every };
  });
  const period = robots.reduce((p, r) => p * r.period / gcd(p, r.period), 1);
  return { w, h, wall, start, exit, gems, robots, period };
}

/** where a robot is and which way it faces on turn t: { x, y, dir } */
export function robotAt(r, t) {
  if (r.type === 'patrol') { const i = ((t % r.period) + r.period) % r.period; return { x: r.route[i][0], y: r.route[i][1], dir: r.face[i] }; }
  return { x: r.at[0], y: r.at[1], dir: r.dirs[Math.floor((((t % r.period) + r.period) % r.period) / r.every) % r.dirs.length] };
}

/** the squares a robot sees on turn t: [[x, y], …] — its own square first */
export function sightOf(P, r, t) {
  const { x, y, dir } = robotAt(r, t), out = [[x, y]], [dx, dy] = DIRS[dir];
  for (let k = 1; k <= r.range; k++) {
    const cx = x + dx * k, cy = y + dy * k;
    if (cx < 0 || cy < 0 || cx >= P.w || cy >= P.h || P.wall[cy * P.w + cx]) break;
    out.push([cx, cy]);
  }
  return out;
}
/** every square any robot sees on turn t, as a Set of y * w + x */
export function watched(P, t) {
  const s = new Set();
  for (const r of P.robots) for (const [x, y] of sightOf(P, r, t)) s.add(y * P.w + x);
  return s;
}

/**
 * One action. state = { x, y, t, gems } (gems: how many taken, as a bit set).
 * -> null when the action is impossible (a wall, the edge), else
 *    { x, y, t, gems, caught, won } for the turn after it.
 */
export function step(P, state, action) {
  const [dx, dy] = action === '.' ? [0, 0] : DIRS[action] || [0, 0];
  const x = state.x + dx, y = state.y + dy;
  if (action !== '.' && !DIRS[action]) return null;
  if (x < 0 || y < 0 || x >= P.w || y >= P.h || P.wall[y * P.w + x]) return null;
  const t = state.t + 1;
  let gems = state.gems;
  P.gems.forEach(([gx, gy], i) => { if (gx === x && gy === y) gems |= 1 << i; });
  let caught = watched(P, t).has(y * P.w + x);
  /* passing through a patrol: it moved onto the thief's square while the thief moved onto its */
  if (!caught && (dx || dy)) for (const r of P.robots) {
    if (r.type !== 'patrol') continue;
    const a = robotAt(r, state.t), b = robotAt(r, t);
    if (a.x === x && a.y === y && b.x === state.x && b.y === state.y) caught = true;
  }
  const won = !caught && P.exit && x === P.exit[0] && y === P.exit[1] && gems === (1 << P.gems.length) - 1;
  return { x, y, t, gems, caught, won };
}

export const startState = P => ({ x: P.start[0], y: P.start[1], t: 0, gems: 0 });
/** is the starting square safe on turn 0? (a level must be) */
export const startSafe = P => !watched(P, 0).has(P.start[1] * P.w + P.start[0]);

/**
 * The fewest turns that take every gem and reach the exit unseen, and one way to do it.
 * -> { par, actions: ['N', '.', …] } or null when it cannot be done
 */
export function solve(P) {
  const all = (1 << P.gems.length) - 1, W = P.w;
  const key = (x, y, t, g) => ((g * P.period + t % P.period) * P.h + y) * W + x;
  const s0 = startState(P);
  if (!startSafe(P)) return null;
  const seen = new Map([[key(s0.x, s0.y, 0, 0), null]]);
  let layer = [s0];
  for (let depth = 1; layer.length && depth <= 400; depth++) {
    const next = [];
    for (const st of layer) for (const a of ACTIONS) {
      const r = step(P, st, a);
      if (!r || r.caught) continue;
      const k = key(r.x, r.y, r.t, r.gems);
      if (seen.has(k)) continue;
      seen.set(k, { from: key(st.x, st.y, st.t, st.gems), a });
      if (r.won) {
        const actions = [];
        for (let c = k; seen.get(c); c = seen.get(c).from) actions.push(seen.get(c).a);
        return { par: depth, actions: actions.reverse() };
      }
      next.push(r);
    }
    layer = next;
  }
  void all;
  return null;
}
/** how many turns the walk would take with no robots at all: gems in the best order, then the exit */
export function lonelyPar(P) {
  const dist = from => {
    const d = new Int32Array(P.w * P.h).fill(-1);
    d[from[1] * P.w + from[0]] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [dx, dy] of Object.values(DIRS)) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < P.w && ny < P.h && !P.wall[ny * P.w + nx] && d[ny * P.w + nx] < 0) { d[ny * P.w + nx] = d[y * P.w + x] + 1; q.push([nx, ny]); }
      }
    }
    return d;
  };
  const pts = [P.start, ...P.gems, P.exit], D = pts.map(dist);
  const g = P.gems.length;
  const at = (a, b) => D[a][pts[b][1] * P.w + pts[b][0]];
  if (!g) return at(0, 1);
  /* gems are few (0 to 2): try every order */
  let best = Infinity;
  const perm = (cur, rest, cost) => {
    if (!rest.length) { best = Math.min(best, cost + at(cur, g + 1)); return; }
    for (const r of rest) perm(r, rest.filter(x => x !== r), cost + at(cur, r));
  };
  perm(0, P.gems.map((_, i) => i + 1), 0);
  return best;
}
