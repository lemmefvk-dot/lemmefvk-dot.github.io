/* ============================================================
   arcade/cafe-logic.js — the rules of Stack Cafe, with no screen in
   them (the game is ./cafe.js; the suite plays this module too).

   Customers sit at three seats and each wants a stack built in one
   exact order, bottom to top. You build it on the plate, ingredient by
   ingredient, and serve it to the customer who asked. A customer's
   patience runs down while they wait; when it reaches nothing they
   leave and you lose a heart. Three hearts. Serve the wrong stack and
   the customer loses some patience and the plate is binned.

   THE SEED decides who comes and when, by number of customer (the
   k-th customer has the same order, the same patience and the same
   gap before them in any round with this seed), never by what the
   player does. A round is fixed 1/60 s steps, and every action is
   logged by the step it happened in: the log plays the round again
   exactly, which is what the ghost does.

   Actions (act): ADD ingredient · TRASH the plate · SERVE a seat.
   ============================================================ */
import { rng } from './kit.js';
import { hash32 } from './challenge.js';

export const STEP = 1 / 60;
export const SEATS = 3;
export const LIVES = 3;
export const PLATE_MAX = 8;
export const ADD = 0, TRASH = 1, SERVE = 2;
/* bottom bun, three fillings, top bun — and the egg, the one that only the later orders ask for */
export const INGREDIENTS = [
  { id: 'bun', name: 'Bottom bun', short: 'Bun', color: '#d89a52' },
  { id: 'patty', name: 'Patty', short: 'Patty', color: '#7a3b22' },
  { id: 'cheese', name: 'Cheese', short: 'Cheese', color: '#ffcf33' },
  { id: 'lettuce', name: 'Lettuce', short: 'Leaf', color: '#4fc25c' },
  { id: 'tomato', name: 'Tomato', short: 'Tom.', color: '#e5483a' },
  { id: 'top', name: 'Top bun', short: 'Top', color: '#e8ac62' },
];
const FILL = [1, 2, 3, 4];                                    /* patty, cheese, lettuce, tomato */

/** the k-th customer's order (ingredient numbers, bottom to top), patience (seconds) and gap since the one before (seconds) */
export function customer(seed, k) {
  const r = rng(hash32(`staticos-cafe:${seed >>> 0}:${k}`));
  const fillings = 1 + Math.floor(r() * (1 + Math.min(3, Math.floor(k / 3))));
  const order = [0];
  for (let i = 0; i < fillings; i++) order.push(FILL[Math.floor(r() * FILL.length)]);
  order.push(5);
  const patience = Math.max(13, 24 + order.length * 3 - k * 0.4);
  const gap = k === 0 ? 1 : Math.max(3.5, 9 - 0.25 * k) + r() * 2;
  return { k, order, patience, gap };
}

export function create(seed = 1) {
  return {
    seed: seed >>> 0, t: 0, score: 0, lives: LIVES, served: 0, lost: 0, streak: 0, bestStreak: 0, wrong: 0, over: false,
    plate: [], seats: new Array(SEATS).fill(null), nextK: 0, wait: customer(seed, 0).gap, events: [],
  };
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** an action at the current step. -> { ok, ... } and an event in s.events */
export function act(s, code, arg) {
  if (s.over) return { ok: false };
  if (code === ADD) {
    if (!Number.isInteger(arg) || arg < 0 || arg >= INGREDIENTS.length || s.plate.length >= PLATE_MAX) return { ok: false };
    s.plate.push(arg);
    return { ok: true };
  }
  if (code === TRASH) {
    if (!s.plate.length) return { ok: false };
    s.plate = [];
    return { ok: true };
  }
  if (code === SERVE) {
    const c = Number.isInteger(arg) ? s.seats[arg] : null;
    if (!c || !s.plate.length) return { ok: false };
    if (same(s.plate, c.order)) {
      const tip = Math.round(20 * (c.left / c.patience));
      s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
      const gained = 10 * c.order.length + tip + 2 * Math.min(10, s.streak - 1);
      s.score += gained; s.served++;
      s.seats[arg] = null; s.plate = [];
      s.events.push({ t: s.t, type: 'served', seat: arg, gained, tip });
      return { ok: true, right: true, gained };
    }
    s.wrong++; s.streak = 0;
    c.left = Math.max(0, c.left - c.patience * 0.2);
    s.plate = [];
    s.events.push({ t: s.t, type: 'wrong', seat: arg });
    return { ok: true, right: false };
  }
  return { ok: false };
}

/** one 1/60 s step: patience runs down, customers arrive */
export function step(s) {
  if (s.over) return;
  for (let i = 0; i < SEATS; i++) {
    const c = s.seats[i];
    if (!c) continue;
    c.left -= STEP;
    if (c.left <= 0) {
      s.seats[i] = null; s.lives--; s.lost++; s.streak = 0;
      s.events.push({ t: s.t, type: 'left', seat: i });
      if (s.lives <= 0) { s.over = true; s.t++; return; }
    }
  }
  s.wait -= STEP;
  if (s.wait <= 0) {
    const seat = s.seats.indexOf(null);
    if (seat >= 0) {
      const c = customer(s.seed, s.nextK);
      s.seats[seat] = { k: c.k, order: c.order, patience: c.patience, left: c.patience, seat };
      s.nextK++;
      s.wait = customer(s.seed, s.nextK).gap;
      s.events.push({ t: s.t, type: 'arrived', seat });
    } else s.wait = 0.25;                                      /* every seat is taken: the next one waits at the door */
  }
  s.t++;
}

/** play a log of [step, code, arg] to its end (or `until` steps): the state it reaches */
export function replay(seed, acts, until = 60 * 60 * 20) {
  const s = create(seed);
  let i = 0;
  while (!s.over && s.t < until) {
    while (i < acts.length && acts[i][0] <= s.t) { act(s, acts[i][1], acts[i][2]); i++; }
    step(s);
  }
  return s;
}

export default { STEP, SEATS, LIVES, INGREDIENTS, customer, create, act, step, replay };
