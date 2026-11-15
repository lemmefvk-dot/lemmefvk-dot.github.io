/* ============================================================
   calweather.js — the forecast for a day, shown in Calendar's day
   panel. Read-only, the way js/core/callayers.js adds layers: it
   reads what the Weather app already saved and never fetches,
   writes or changes anything.

   Where it comes from: the place Weather and the widget rail share
   (prefs.wxPlace), and the last forecast Weather fetched for it from
   Open-Meteo, kept in IndexedDB (kv 'misc', key 'weather:<place>').
   No place, or no forecast saved for that day, means nothing is
   shown — never a guess. A day that is already over where the place
   is has no forecast either. What it hands back says which place,
   how old the saved forecast is and the unit it was fetched in, so
   Calendar can say all of that next to the numbers.

     forDay('YYYY-MM-DD') -> Promise<null | { place, at, unit, day,
         code, label, fam, hi, lo, pop, precip, precipUnit }>
     KEYS  the store keys Weather writes when it saves a forecast,
           so Calendar can draw the line again
   ============================================================ */
import { store } from './store.js';
import { kv } from './db.js';
import { keyOf, validPlace, cond } from './openmeteo.js';

export const KEYS = ['prefs.wxPlace', 'prefs.wxCache'];
const misc = kv('misc');
const pad2 = n => String(n).padStart(2, '0');
const fin = v => typeof v === 'number' && Number.isFinite(v);

/** The date it is now at a place, from the UTC offset its forecast declared. */
function placeToday(off) {
  const t = new Date(Date.now() + (fin(off) ? off : 0) * 1000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export async function forDay(day) {
  const p = store.get('prefs.wxPlace');
  if (!validPlace(p) || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  let rec = null;
  try { rec = await misc.get(`weather:${keyOf(p)}`); } catch (e) { return null; }
  const fc = rec && rec.fc;
  const D = fc && fc.daily;
  if (!D || !Array.isArray(D.time) || !fin(rec.at)) return null;
  const i = D.time.indexOf(day);
  if (i < 0 || day < placeToday(fc.utc_offset_seconds)) return null;
  const hi = D.temperature_2m_max?.[i], lo = D.temperature_2m_min?.[i];
  if (!fin(hi) || !fin(lo)) return null;
  const code = D.weather_code?.[i];
  const c = cond(code, 1);
  const pu = String((fc.daily_units || {}).precipitation_sum || '');
  return {
    place: String(rec.place?.name || p.name), at: rec.at, unit: rec.unit === 'C' ? 'C' : 'F', day,
    code, label: c.label, fam: c.fam, hi, lo,
    pop: fin(D.precipitation_probability_max?.[i]) ? D.precipitation_probability_max[i] : null,
    precip: fin(D.precipitation_sum?.[i]) ? D.precipitation_sum[i] : null,
    precipUnit: pu ? (/inch/.test(pu) ? 'in' : 'mm') : rec.unit === 'F' ? 'in' : 'mm',
  };
}

export default { forDay, KEYS };
