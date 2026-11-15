/* ============================================================
   arcade/kite-logic.js — the rules of Kite Runner, with no screen in
   them (the game is ./kite.js; the suite plays this module too).

   The kite hangs at a fixed place on the screen and the world blows
   past it. You steer it up and down. The sky is a course laid out by
   distance, one 360-unit segment at a time, from the round's seed: the
   same seed is the same sky on any device, and the window's shape
   never changes it. Each segment holds
     · a run of ribbons along a gentle curve (10 points each),
     · sometimes a wind lane: inside it the world blows 30% faster and
       pushes the kite up or down,
     · from the second segment on, one or two storm clouds that cost a
       heart (the kite is safe for 1.2 s after a hit).
   Three hearts. Score = 10 per ribbon + 1 per 5 metres flown.

   A round is fixed 1/120 s steps and the only input is the steering
   (-1 up, 0 straight, 1 down), logged by the step it changed in: the
   log plays the round again exactly, which is what the ghost does.
   ============================================================ */
import { rng } from './kit.js';
import { hash32 } from './challenge.js';

export const DT = 1 / 120;
export const VH = 480;
export const SEG = 360;
export const LIVES = 3;
export const KITE_R = 13;
export const MAX_VY = 250;
export const INVULN = 144;                 /* steps: 1.2 s */
export const M = 30;                       /* world units per metre */

const cache = new Map();
/** segment i of a seed: { ribbons: [{ d, y }], storms: [{ d, y, r }], wind: null | { d0, d1, y0, y1, push } } */
export function segment(seed, i) {
  const key = `${seed >>> 0}:${i}`;
  let s = cache.get(key);
  if (s) return s;
  const r = rng(hash32(`staticos-kite:${seed >>> 0}:${i}`));
  const base = i * SEG;
  const ribbons = [], storms = [];
  /* ribbons: a curve of 4–6 */
  const n = 4 + Math.floor(r() * 3);
  const y0 = 90 + r() * (VH - 180), amp = 30 + r() * 60, ph = r() * 6.28, f = 0.012 + r() * 0.012;
  for (let k = 0; k < n; k++) {
    const d = base + 60 + k * 32 + r() * 6;
    ribbons.push({ d, y: Math.max(40, Math.min(VH - 40, y0 + amp * Math.sin(ph + (d - base) * f))) });
  }
  if (i >= 1) {
    const count = r() < Math.min(0.85, 0.35 + i * 0.04) ? (r() < 0.25 + i * 0.02 ? 2 : 1) : 0;
    for (let k = 0; k < count; k++) {
      const d = base + (k ? 250 : 150) + r() * 60;
      let y = 60 + r() * (VH - 120);
      /* never right on the ribbons just before it: a storm is a choice, not a trap */
      if (ribbons.some(b => Math.abs(b.d - d) < 70 && Math.abs(b.y - y) < 60)) y = y < VH / 2 ? y + 110 : y - 110;
      storms.push({ d, y: Math.max(50, Math.min(VH - 50, y)), r: 30 + r() * 14 });
    }
  }
  let wind = null;
  if (r() < 0.32) {
    const up = r() < 0.5, y = 70 + r() * (VH - 220);
    wind = { d0: base + 20 + r() * 40, d1: base + SEG - 20 - r() * 40, y0: y, y1: y + 110 + r() * 40, push: (up ? -1 : 1) * (150 + r() * 80) };
  }
  s = { i, ribbons, storms, wind };
  if (cache.size > 400) cache.clear();
  cache.set(key, s);
  return s;
}

export const speedAt = (d, inWind) => (170 + Math.min(150, d / 40)) * (inWind ? 1.3 : 1);

export function create(seed = 1) {
  return { seed: seed >>> 0, t: 0, d: 0, y: VH / 2, vy: 0, lives: LIVES, ribbons: 0, got: new Set(), hits: 0, invuln: 0, wind: false, over: false, events: [], best: 0 };
}

export const metres = s => Math.floor(s.d / M);
export const scoreOf = s => s.ribbons * 10 + Math.floor(metres(s) / 5);

/** one 1/120 s step with the steering held (-1 up, 0 straight, 1 down) */
export function step(s, dir) {
  if (s.over) return;
  const dd = dir > 0 ? 1 : dir < 0 ? -1 : 0;
  const i0 = Math.floor(s.d / SEG);
  /* wind: any lane the kite is inside */
  let push = 0, inWind = false;
  for (const i of [i0, i0 - 1]) {
    if (i < 0) continue;
    const w = segment(s.seed, i).wind;
    if (w && s.d >= w.d0 && s.d <= w.d1 && s.y >= w.y0 && s.y <= w.y1) { push += w.push; inWind = true; }
  }
  s.wind = inWind;
  s.vy += (dd * MAX_VY - s.vy) * 7 * DT + push * DT;
  s.vy = Math.max(-MAX_VY * 1.4, Math.min(MAX_VY * 1.4, s.vy));
  s.y += s.vy * DT;
  if (s.y < 20) { s.y = 20; s.vy = Math.max(0, s.vy); }
  if (s.y > VH - 20) { s.y = VH - 20; s.vy = Math.min(0, s.vy); }
  s.d += speedAt(s.d, inWind) * DT;
  if (s.invuln > 0) s.invuln--;
  /* ribbons and storms in this and the next segment */
  const d = s.d;
  for (const i of [Math.floor(d / SEG), Math.floor(d / SEG) + 1]) {
    const seg = segment(s.seed, i);
    seg.ribbons.forEach((b, k) => {
      const key = i * 16 + k;
      if (s.got.has(key) || Math.abs(b.d - d) > 18 || Math.abs(b.y - s.y) > 24) return;
      s.got.add(key); s.ribbons++;
      s.events.push({ type: 'ribbon', t: s.t });
    });
    if (s.invuln === 0) {
      for (const c of seg.storms) {
        if (Math.hypot(c.d - d, c.y - s.y) < c.r + KITE_R * 0.8) {
          s.lives--; s.hits++; s.invuln = INVULN; s.vy = 0;
          s.events.push({ type: 'hit', t: s.t });
          if (s.lives <= 0) s.over = true;
          break;
        }
      }
    }
  }
  s.t++;
}

/** play a log of [step, dir] (the steering from that step on) to its end (or `until` steps) */
export function replay(seed, log, until = 120 * 60 * 20) {
  const s = create(seed);
  let dir = 0, k = 0;
  while (!s.over && s.t < until) {
    while (k < log.length && log[k][0] <= s.t) { dir = log[k][1]; k++; }
    step(s, dir);
  }
  return s;
}

export default { DT, VH, SEG, LIVES, segment, create, step, replay, metres, scoreOf };
