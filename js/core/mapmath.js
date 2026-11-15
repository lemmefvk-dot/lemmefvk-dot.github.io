/* ============================================================
   mapmath.js — the maths behind Static Maps. No DOM; unit-tested.

   Tiles follow the standard "slippy map" scheme: at zoom z the world
   is a square 256·2^z pixels wide, Web Mercator, north up. Distances
   are great-circle (haversine): the shortest way over the Earth's
   surface treated as a sphere of mean radius 6371.0088 km. That is a
   straight-line "as the crow flies" figure, never a road distance.
   ============================================================ */

export const TILE = 256;
export const MAX_LAT = 85.0511287798;           /* where Web Mercator stops */
export const EARTH_KM = 6371.0088;
const rad = d => d * Math.PI / 180;

export const clampLat = lat => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
export const wrapLon = lon => ((((lon + 180) % 360) + 360) % 360) - 180;

/** lat/lon -> pixel position in the world at zoom z. */
export function project(lat, lon, z) {
  const n = TILE * 2 ** z, s = Math.sin(rad(clampLat(lat)));
  return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
/** pixel position at zoom z -> lat/lon. */
export function unproject(x, y, z) {
  const n = TILE * 2 ** z;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, lon: wrapLon(x / n * 360 - 180) };
}
/** The tile a point is on. */
export const tileOf = (lat, lon, z) => { const p = project(lat, lon, z); return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE), z }; };

/** Great-circle distance in km. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The total of a path through several points. */
export const pathKm = pts => pts.reduce((t, p, i) => (i ? t + haversine(pts[i - 1], p) : 0), 0);

/** The first bearing from a to b, degrees clockwise from north (0..360). */
export function bearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export const KM_PER_MILE = 1.609344;
export function fmtDistance(km, unit) {
  const v = unit === 'mi' ? km / KM_PER_MILE : km, u = unit === 'mi' ? 'mi' : 'km';
  if (v < 1) return `${Math.round(v * (unit === 'mi' ? 5280 : 1000)).toLocaleString('en')} ${unit === 'mi' ? 'ft' : 'm'}`;
  return `${v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString('en')} ${u}`;
}

/** A coordinate pair as text, and back: "51.5074, -0.1278" (also accepts N/S/E/W). */
export const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
export function parseLatLon(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(String(text));
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (/s/i.test(m[2] || '')) lat = -Math.abs(lat);
  if (/w/i.test(m[4] || '')) lon = -Math.abs(lon);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
