/* ============================================================
   util.js — formatting, math, ids, seeded fake data
   ============================================================ */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp  = (a, b, t) => a + (b - a) * t;
export const round = (v, p = 0) => { const f = 10 ** p; return Math.round(v * f) / f; };

let _id = 0;
export const uid = (p = 'id') => `${p}-${++_id}`;

export function fmtBytes(n) {
  if (n === 0 || n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export const pad2 = n => String(n).padStart(2, '0');

export function fmtClock(d = new Date(), h24 = false) {
  let hh = d.getHours();
  const ap = hh >= 12 ? 'PM' : 'AM';
  if (!h24) { hh = hh % 12 || 12; }
  return { time: `${h24 ? pad2(hh) : hh}:${pad2(d.getMinutes())}`, ap, sec: pad2(d.getSeconds()) };
}

const DAYS   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
export const dayName   = (d, short) => short ? DAYS[d.getDay()].slice(0, 3) : DAYS[d.getDay()];
export const monthName = (d, short) => short ? MONTHS[d.getMonth()].slice(0, 3) : MONTHS[d.getMonth()];
export const fmtDateLong  = d => `${dayName(d)}, ${monthName(d)} ${d.getDate()}`;
export const fmtDateShort = d => `${dayName(d, 1)} ${monthName(d, 1)} ${d.getDate()}`;

export function fmtAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return 'Yesterday';
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  const d = new Date(iso);
  return `${monthName(d, 1)} ${d.getDate()}`;
}

export const fmtDur = s => `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;

/** Deterministic PRNG so "random" system stats look organic but stable. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** A gently drifting value — used for CPU/GPU/RAM dials and graphs. */
export function drift(from, min, max, step = 3) {
  const next = from + (Math.random() - 0.5) * step * 2;
  return clamp(round(next, 1), min, max);
}

export function throttle(fn, ms) {
  let last = 0, timer = null, lastArgs;
  return (...a) => {
    lastArgs = a;
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...lastArgs); }, ms - (now - last));
  };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Build an SVG polyline path from an array of 0..1 values. */
export function sparkPath(vals, w, hgt, pad = 2) {
  if (!vals.length) return '';
  const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
  return vals.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - clamp(v, 0, 1)) * (hgt - pad * 2);
    return `${i ? 'L' : 'M'}${round(x, 2)} ${round(y, 2)}`;
  }).join(' ');
}

/** Smooth (Catmull-Rom-ish) version of the above, for graph widgets. */
export function smoothPath(vals, w, hgt, pad = 2) {
  if (vals.length < 3) return sparkPath(vals, w, hgt, pad);
  const pts = vals.map((v, i) => [
    pad + i * ((w - pad * 2) / (vals.length - 1)),
    pad + (1 - clamp(v, 0, 1)) * (hgt - pad * 2),
  ]);
  let d = `M${round(pts[0][0], 2)} ${round(pts[0][1], 2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${round(cx, 2)} ${round(y0, 2)} ${round(cx, 2)} ${round(y1, 2)} ${round(x1, 2)} ${round(y1, 2)}`;
  }
  return d;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? 'metaKey' : 'ctrlKey';
export const modLabel = isMac ? '⌘' : 'Ctrl';
