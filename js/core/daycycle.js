/* ============================================================
   daycycle.js — the Day and Night wallpaper's clock.

   One original scene (a lake under mountains, a cabin among the
   pines; drawn by tools/daycycle-art.mjs) in four lights — dawn,
   day, dusk and night — and the local time decides how they mix.
   At any moment at most two are on screen: the one we are in, and
   the next one fading in over it.

   When the sun comes up. With nothing set, fixed times stand in:
   sunrise 6:30 and sunset 19:30. When Weather has a place
   (prefs.wxPlace — a city you searched for, or "Use my location"
   after the browser asked you), the real sunrise and sunset for
   that place are worked out here, on this computer, with the
   standard sunrise equation; nothing is fetched and nothing is
   sent. If that place's sun makes no sense on this computer's
   clock — the place is half a world away, or the sun does not rise
   or set there today — the fixed times are used and source() says
   why. Settings › Wallpaper shows which is in use.

     state(date?)   -> { from, to, k, phase, rise, set, source }
     paint(el, date?) the .wp__day layer: opacities and data-phase
     layer(h, base)   builds that layer (wallpapers.js mediaLayer)
     sunTimes(date, lat, lon) -> { rise, set } | { polar: 'day'|'night' }
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const PHASES = ['night', 'dawn', 'day', 'dusk'];
export const NAMES = { night: 'Night', dawn: 'Dawn', day: 'Day', dusk: 'Dusk' };
export const ART = p => `assets/wallpapers/daycycle/${p}.svg`;

/* fixed times, minutes after midnight */
export const FIXED = { rise: 6 * 60 + 30, set: 19 * 60 + 30 };
/* each light holds for an hour around its moment and takes an hour to
   become the next: night → dawn from 90 to 30 minutes before sunrise,
   dawn → day from 30 to 90 minutes after it, and the same round sunset */
const HOLD = 30, BLEND = 60;

const rad = Math.PI / 180;

/** Sunrise and sunset (Date instants) on the local calendar day of `date`,
    for a place in degrees (east and north positive). The sunrise equation
    with the usual −0.833° for refraction and the sun's disc. */
export function sunTimes(date, lat, lon) {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const J = noon.getTime() / 86400000 + 2440587.5;
  const n = Math.round(J - 2451545.0 + 0.0008);
  const Js = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosW > 1) return { polar: 'night' };
  if (cosW < -1) return { polar: 'day' };
  const w = Math.acos(cosW) / rad;
  const toDate = j => new Date((j - 2440587.5) * 86400000);
  return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
}

const mins = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const okPlace = p => !!p && typeof p.name === 'string' && Number.isFinite(+p.lat) && Number.isFinite(+p.lon);

/** Which sun times are in use: { kind: 'fixed'|'place', rise, set (minutes), place?, why? } */
export function source(date = new Date()) {
  const place = store.get('prefs.wxPlace', null);
  if (!okPlace(place)) return { kind: 'fixed', ...FIXED };
  const s = sunTimes(date, +place.lat, +place.lon);
  if (s.polar) {
    return { kind: 'fixed', ...FIXED, place: place.name,
      why: s.polar === 'day' ? `The sun doesn’t set in ${place.name} today` : `The sun doesn’t rise in ${place.name} today` };
  }
  const rise = mins(s.rise), set = mins(s.set);
  /* on this computer's clock, the place's midday has to be somewhere near
     midday and its day a sensible length — or the clock and the place
     disagree (a city on the other side of the world) */
  const noon = (rise + set) / 2;
  if (!(set > rise) || noon < 10 * 60 || noon > 15 * 60 || set - rise < 4 * 60 || set - rise > 20 * 60) {
    return { kind: 'fixed', ...FIXED, place: place.name, why: `${place.name} is too far from this computer’s time zone` };
  }
  return { kind: 'place', rise, set, place: place.name, here: !!place.here };
}

/** The mix at `date`: the light we are in (`from`), the next one (`to`)
    and how far it has faded in over it (k, 0–1). `phase` is whichever
    shows more. */
export function state(date = new Date()) {
  const src = source(date);
  const R = src.rise, S = src.set;
  const keys = [
    [R - HOLD - BLEND, 'night'], [R - HOLD, 'dawn'], [R + HOLD, 'dawn'], [R + HOLD + BLEND, 'day'],
    [S - HOLD - BLEND, 'day'], [S - HOLD, 'dusk'], [S + HOLD, 'dusk'], [S + HOLD + BLEND, 'night'],
  ];
  const t = mins(date);
  let from = 'night', to = 'night', k = 0;
  if (t >= keys[0][0] && t < keys[keys.length - 1][0]) {
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
      if (t >= t0 && t < t1) {
        from = p0; to = p1;
        k = p0 === p1 ? 0 : (t - t0) / (t1 - t0);
        break;
      }
    }
  }
  if (from === to) k = 0;
  return { from, to, k, phase: k >= 0.5 ? to : from, rise: R, set: S, source: src };
}

/** "6:30 AM" / "18:30", for minutes after midnight. */
export function clock(m) {
  const d = new Date(2000, 0, 1, Math.floor(m / 60), Math.round(m % 60));
  const h24 = !!store.get('prefs.h24');
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !h24 });
}

/* ---------- the layer ------------------------------------------- */
let lastPhase = null;

/** Put the right two lights on a .wp__day layer. Each picture is only
    fetched the first time it is needed. */
export function paint(el, date = new Date()) {
  if (!el) return null;
  const st = state(date);
  for (const p of PHASES) {
    const i = el.querySelector(`.wp__day-${p}`);
    if (!i) continue;
    const on = p === st.from || (p === st.to && st.k > 0);
    if (on && !i.style.backgroundImage) i.style.backgroundImage = `url("${ART(p)}")`;
    i.style.opacity = p === st.from ? '1' : p === st.to ? st.k.toFixed(3) : '0';
    i.style.zIndex = p === st.from ? '1' : p === st.to ? '2' : '0';
  }
  el.dataset.phase = st.phase;
  el.dataset.blend = `${st.from}>${st.to}:${st.k.toFixed(2)}`;
  el.dataset.sun = st.source.kind;
  if (st.phase !== lastPhase) {
    const first = lastPhase === null;
    lastPhase = st.phase;
    /* the auto accent follows the light (core/wpaccent.js) */
    if (!first) bus.emit('daycycle:phase', st.phase);
  }
  return st;
}

/** The layer itself, for wallpapers.js mediaLayer(). */
export function layer(h, base) {
  const el = h('div.wp__day', { style: { ...base }, 'aria-hidden': 'true' },
    ...PHASES.map(p => h(`i.wp__day-${p}`, { style: {
      position: 'absolute', inset: '0', backgroundSize: 'cover', backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat', opacity: '0', transition: 'opacity 2.4s linear',
    } })));
  paint(el);
  return el;
}

/** The picture showing most right now (the auto accent reads it). */
export const currentArt = (date = new Date()) => ART(state(date).phase);

export default { PHASES, NAMES, ART, FIXED, sunTimes, source, state, clock, paint, layer, currentArt };
