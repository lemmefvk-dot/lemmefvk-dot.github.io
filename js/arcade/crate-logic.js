/* ============================================================
   arcade/crate-logic.js — the rules of Crate Shift, with a solver
   (the game is ./crateshift.js; the suite solves every level here
   and checks each par against it).

   A warehouse grid. Walk with the arrows; walking into a crate pushes
   it one square if the square behind it is empty (never two crates,
   never a pull). Put every crate on a goal. The score is the number of
   moves you made (a push is one move too) and each level's par is the
   fewest moves any solution takes, found by a breadth-first search
   over where the walker and the crates can be.

   A level is an array of rows:  #  wall · space · .  goal · $  crate ·
   *  crate on a goal · @  walker · +  walker on a goal.
   ============================================================ */
export const DIRS = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };

export function parse(rows) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const walls = new Uint8Array(w * h).fill(1), goal = new Uint8Array(w * h);
  const crates = [];
  let player = -1;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const i = y * w + x;
    if (ch === '#') return;
    walls[i] = 0;
    if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
    if (ch === '$' || ch === '*') crates.push(i);
    if (ch === '@' || ch === '+') player = i;
  }));
  /* the space outside the walls is wall too: anything the rows leave blank at the edge */
  return { w, h, walls, goal, start: { p: player, c: crates.sort((a, b) => a - b) } };
}

/** one step in direction d ('u','d','l','r') from state st: { p, c } or null if it is a wall or a blocked crate; push is true if a crate moved */
export function move(L, st, d) {
  const [dx, dy] = DIRS[d];
  const px = st.p % L.w, py = (st.p / L.w) | 0;
  const nx = px + dx, ny = py + dy;
  if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) return null;
  const n = ny * L.w + nx;
  if (L.walls[n]) return null;
  const ci = st.c.indexOf(n);
  if (ci < 0) return { p: n, c: st.c, push: false };
  const bx = nx + dx, by = ny + dy;
  if (bx < 0 || by < 0 || bx >= L.w || by >= L.h) return null;
  const b = by * L.w + bx;
  if (L.walls[b] || st.c.includes(b)) return null;
  const c = st.c.slice(); c[ci] = b; c.sort((p, q) => p - q);
  return { p: n, c, push: true };
}

export const solved = (L, st) => st.c.every(i => L.goal[i]);
export const key = st => `${st.p}|${st.c.join(',')}`;

/** the fewest moves to finish from st, and one way to do it: { moves, path: 'uurd…' } or null if it cannot be done (limit caps the states searched) */
export function solve(L, st = L.start, limit = 600000) {
  if (solved(L, st)) return { moves: 0, path: '' };
  const seen = new Map([[key(st), null]]);
  let frontier = [st], depth = 0;
  while (frontier.length && seen.size < limit) {
    depth++;
    const next = [];
    for (const s of frontier) {
      for (const d of 'udlr') {
        const m = move(L, s, d);
        if (!m) continue;
        const k = key(m);
        if (seen.has(k)) continue;
        seen.set(k, { from: key(s), d });
        if (solved(L, m)) {
          let path = '', at = k, info;
          while ((info = seen.get(at))) { path = info.d + path; at = info.from; }
          return { moves: depth, path };
        }
        next.push(m);
      }
    }
    frontier = next;
  }
  return null;
}

export default { parse, move, solved, solve, key, DIRS };
