/* ============================================================
   arcade/battleship-logic.js — the rules, the computer's three ways
   of shooting, and the commit / reveal checks for online Battleship.
   Pure functions: no DOM, no timers. ./battleship.js draws and plays.

   A fleet is five ships, in this fixed order: { len, r, c, d } with
   d = 0 running right from (r, c) and d = 1 running down. Ships may
   touch but never overlap and never leave the 10 × 10 grid.

   FAIRNESS ONLINE. At the start each side makes a random salt and
   sends SHA-256(fleet + "|" + salt) — the commitment — before the first
   shot. From then on the fleet cannot change. Each answer to a shot
   is miss, hit or sunk (a sunk answer names the ship's place and says
   whether it was the last one). When the game ends both sides send the
   salt and the fleet; verify() checks the hash, that the fleet is legal,
   and replays every one of OUR shots against THEIR fleet: each answer
   they gave has to be the one the fleet would have given.
   ============================================================ */

export const SIZE = 10;
export const FLEET = [
  { name: 'Carrier', len: 5 }, { name: 'Battleship', len: 4 }, { name: 'Cruiser', len: 3 },
  { name: 'Submarine', len: 3 }, { name: 'Destroyer', len: 2 },
];
export const LENS = FLEET.map(s => s.len);

export const cellsOf = s => Array.from({ length: s.len }, (_, i) => [s.r + (s.d ? i : 0), s.c + (s.d ? 0 : i)]);
const isInt = v => Number.isInteger(v);
export const inGrid = (r, c) => isInt(r) && isInt(c) && r >= 0 && c >= 0 && r < SIZE && c < SIZE;
export const shipOk = s => !!s && isInt(s.len) && (s.d === 0 || s.d === 1) && inGrid(s.r, s.c) && inGrid(s.r + (s.d ? s.len - 1 : 0), s.c + (s.d ? 0 : s.len - 1));

/* can `ship` go down next to `ships` (an array, null where not placed yet)? `skip` = a ship index to ignore */
export function canPlace(ships, ship, skip = -1) {
  if (!shipOk(ship)) return false;
  const mine = new Set(cellsOf(ship).map(([r, c]) => r * SIZE + c));
  for (let i = 0; i < ships.length; i++) {
    if (i === skip || !ships[i]) continue;
    for (const [r, c] of cellsOf(ships[i])) if (mine.has(r * SIZE + c)) return false;
  }
  return true;
}

/* a whole fleet: five ships of the right lengths, in bounds, no overlap */
export function validFleet(f) {
  if (!Array.isArray(f) || f.length !== FLEET.length) return false;
  for (let i = 0; i < f.length; i++) {
    const s = f[i];
    if (!s || typeof s !== 'object' || s.len !== FLEET[i].len || !shipOk(s)) return false;
  }
  return f.every((s, i) => canPlace(f, s, i));
}
export const cleanFleet = f => (Array.isArray(f) ? f.map(s => ({ len: s?.len, r: s?.r, c: s?.c, d: s?.d })) : null);

export function randomFleet(rand = Math.random, keep = []) {
  for (let tries = 0; tries < 200; tries++) {
    const ships = FLEET.map((_, i) => keep[i] || null);
    let fine = true;
    for (let i = 0; i < FLEET.length && fine; i++) {
      if (ships[i]) continue;
      let placed = false;
      for (let k = 0; k < 400 && !placed; k++) {
        const d = rand() < 0.5 ? 0 : 1, len = FLEET[i].len;
        const s = { len, d, r: Math.floor(rand() * (d ? SIZE - len + 1 : SIZE)), c: Math.floor(rand() * (d ? SIZE : SIZE - len + 1)) };
        if (canPlace(ships, s, i)) { ships[i] = s; placed = true; }
      }
      fine = placed;
    }
    if (fine) return ships;
  }
  /* unreachable in practice; a fixed legal fleet keeps the game going anyway */
  return FLEET.map((f, i) => ({ len: f.len, r: i * 2, c: 0, d: 0 }));
}

/* ---------------------------- a fleet under fire ---------------------------- */
export class Waters {
  constructor(fleet) {
    this.fleet = fleet;
    this.at = new Int8Array(SIZE * SIZE).fill(-1);          /* ship index on each cell */
    fleet.forEach((s, i) => cellsOf(s).forEach(([r, c]) => { this.at[r * SIZE + c] = i; }));
    this.shot = new Uint8Array(SIZE * SIZE);
    this.hitsOn = fleet.map(() => 0);
    this.count = 0;
  }
  has(r, c) { return inGrid(r, c) && this.shot[r * SIZE + c] === 1; }
  /* -> { res: 'miss' | 'hit' | 'sunk', ship, all } or null for a repeat / off-grid shot */
  fire(r, c) {
    if (!inGrid(r, c) || this.shot[r * SIZE + c]) return null;
    this.shot[r * SIZE + c] = 1;
    this.count++;
    const i = this.at[r * SIZE + c];
    if (i < 0) return { res: 'miss', ship: -1, all: false };
    this.hitsOn[i]++;
    const sunk = this.hitsOn[i] === this.fleet[i].len;
    return { res: sunk ? 'sunk' : 'hit', ship: i, all: sunk && this.hitsOn.every((n, k) => n === this.fleet[k].len) };
  }
  afloat() { return this.fleet.filter((s, i) => this.hitsOn[i] < s.len).length; }
}

/* ---------------------------- the commitment ---------------------------- */
export const fleetKey = f => f.map(s => `${s.len}.${s.r}.${s.c}.${s.d}`).join(';');
export function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const commitOf = (fleet, salt) => sha256(`${fleetKey(fleet)}|${salt}`);
export const isHash = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
export const isSalt = s => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);

/* The answers I was given to my shots (in order) against the fleet and salt they
   revealed. -> { ok: true } or { ok: false, why }. */
export async function verify({ commit, salt, fleet }, mine) {
  if (!isSalt(salt)) return { ok: false, why: 'the reveal was malformed' };
  const f = cleanFleet(fleet);
  if (!validFleet(f)) return { ok: false, why: 'the revealed fleet is not a legal one' };
  if (!isHash(commit) || (await commitOf(f, salt)) !== commit) return { ok: false, why: 'the revealed fleet does not match what was committed at the start' };
  const w = new Waters(f);
  for (let i = 0; i < mine.length; i++) {
    const m = mine[i], got = w.fire(m.r, m.c);
    if (!got) return { ok: false, why: `shot ${i + 1} cannot be replayed` };
    const sameShip = m.res !== 'sunk' || (m.ship && f[got.ship] && m.ship.len === f[got.ship].len && m.ship.r === f[got.ship].r && m.ship.c === f[got.ship].c && m.ship.d === f[got.ship].d);
    if (got.res !== m.res || !sameShip || !!got.all !== !!m.all) return { ok: false, why: `the answer to shot ${i + 1} was ${m.res}, but their fleet says ${got.res}` };
  }
  return { ok: true };
}

/* ---------------------------- the shooter's knowledge ---------------------------- */
/* marks: 0 unknown, 1 miss, 2 hit (its ship not sunk yet), 3 part of a sunk ship */
export const newKnow = () => ({ marks: new Int8Array(SIZE * SIZE), afloat: LENS.slice(), shots: 0 });

export function learn(know, r, c, res, ship) {
  know.shots++;
  know.marks[r * SIZE + c] = res === 'miss' ? 1 : 2;
  if (res === 'sunk' && ship) {
    for (const [rr, cc] of cellsOf(ship)) know.marks[rr * SIZE + cc] = 3;
    const k = know.afloat.indexOf(ship.len);
    if (k >= 0) know.afloat.splice(k, 1);
  }
}

/* does a claimed sunk ship fit what I have seen? every cell must be a hit of mine (or the shot just made) */
export const plausibleSunk = (know, ship, r0 = -1, c0 = -1) => shipOk(ship) && know.afloat.includes(ship.len) && cellsOf(ship).every(([r, c]) => know.marks[r * SIZE + c] === 2 || (r === r0 && c === c0));

const unknown = know => { const o = []; for (let i = 0; i < SIZE * SIZE; i++) if (!know.marks[i]) o.push(i); return o; };
const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/* Level 1 — random shots. Level 2 — hunt on a checkerboard, then target: finish what a hit started,
   extending along a line of two. Level 3 — probability density: every place a ship still afloat could
   lie, weighted towards the ones that cover hits. -> a cell index. */
export function chooseShot(level, know, rand = Math.random) {
  const open = unknown(know);
  if (!open.length) return -1;
  if (level <= 1) return pick(open, rand);
  const hits = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (know.marks[i] === 2) hits.push(i);
  if (level === 2) {
    if (hits.length) {
      const set = new Set(hits), out = [];
      const add = (r, c) => { if (inGrid(r, c) && !know.marks[r * SIZE + c]) out.push(r * SIZE + c); };
      /* two hits in a row: both ends of the run come first */
      for (const i of hits) {
        const r = Math.floor(i / SIZE), c = i % SIZE;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          if (!set.has((r + dr) * SIZE + c + dc) || !inGrid(r + dr, c + dc)) continue;
          let a = [r, c], b = [r + dr, c + dc];
          while (inGrid(a[0] - dr, a[1] - dc) && set.has((a[0] - dr) * SIZE + a[1] - dc)) a = [a[0] - dr, a[1] - dc];
          while (inGrid(b[0] + dr, b[1] + dc) && set.has((b[0] + dr) * SIZE + b[1] + dc)) b = [b[0] + dr, b[1] + dc];
          add(a[0] - dr, a[1] - dc); add(b[0] + dr, b[1] + dc);
        }
      }
      if (out.length) return pick(out, rand);
      for (const i of hits) { const r = Math.floor(i / SIZE), c = i % SIZE; add(r - 1, c); add(r + 1, c); add(r, c - 1); add(r, c + 1); }
      if (out.length) return pick(out, rand);
    }
    const parity = open.filter(i => (Math.floor(i / SIZE) + (i % SIZE)) % 2 === 0);
    return pick(parity.length ? parity : open, rand);
  }
  const w = density(know, hits.length > 0);
  let best = -1, cells = [];
  for (const i of open) { if (w[i] > best) { best = w[i]; cells = [i]; } else if (w[i] === best) cells.push(i); }
  return pick(cells, rand);
}

/* how many ways could the ships still afloat cover each cell; hunting weighs the ones through hits */
export function density(know, focus) {
  const w = new Float64Array(SIZE * SIZE);
  for (const len of know.afloat) {
    for (let d = 0; d < 2; d++) {
      for (let r = 0; r < SIZE - (d ? len - 1 : 0); r++) for (let c = 0; c < SIZE - (d ? 0 : len - 1); c++) {
        let hit = 0, dead = false;
        for (let k = 0; k < len; k++) {
          const m = know.marks[(r + (d ? k : 0)) * SIZE + c + (d ? 0 : k)];
          if (m === 1 || m === 3) { dead = true; break; }
          if (m === 2) hit++;
        }
        if (dead || (focus && !hit)) continue;
        const weight = focus ? 1 + 10 * hit * hit : 1;
        for (let k = 0; k < len; k++) { const i = (r + (d ? k : 0)) * SIZE + c + (d ? 0 : k); if (!know.marks[i]) w[i] += weight; }
      }
    }
  }
  return w;
}

export const LEVELS = { 1: { name: 'Easy', note: 'random shots' }, 2: { name: 'Medium', note: 'hunt and target' }, 3: { name: 'Hard', note: 'probability' } };
