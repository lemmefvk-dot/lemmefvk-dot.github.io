/* ============================================================
   drills/export.js — every finished round of Static Drills as one CSV
   table, for a spreadsheet. Pure: it is handed what the tabs saved
   and returns text.

   One row per round that really happened, oldest first:
     date, time, tab, what was asked, questions, right, percent right,
     seconds (when the round was timed or its length is known)
   Morse keeps no rounds (it counts each letter as you go), so it has
   no rows; the file says nothing it doesn't have.
   ============================================================ */
import { LEVELS } from './words-data.js';
import { OPS } from './mathcore.js';
import { MODES as GEO_MODES } from './geocore.js';
import { US_MODES } from './usstates.js';
import { MODES as SCI_MODES, RANGES } from './sciencecore.js';

export const HEADER = ['Date', 'Time', 'Tab', 'Round', 'Questions', 'Right', 'Percent right', 'Seconds'];
const pad = n => String(n).padStart(2, '0');
const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };

/** { math, spelling, geo, science } as the store holds them -> [[...cells]] rows, oldest first. */
export function roundRows({ math, spelling, geo, science } = {}) {
  const rows = [];
  const add = (t, tab, what, r, secs) => {
    if (!r || !Number.isFinite(r.n) || r.n <= 0 || !Number.isFinite(r.ok) || !Number.isFinite(t)) return;
    rows.push({ t, cells: [tab, what, r.n, r.ok, `${Math.round((100 * r.ok) / r.n)}%`, Number.isFinite(secs) ? secs : ''] });
  };
  for (const r of (math && math.rounds) || []) {
    const op = r.op === 'weak' ? 'Weakest facts' : (OPS.find(o => o[0] === r.op) || [0, 0, r.op || 'Math'])[2];
    add(r.t, 'Math', `${op}${r.level && r.op !== 'weak' ? ` (${r.level})` : ''}, ${r.mode === 'timed' ? 'timed' : 'practice'}`, r, r.secs);
  }
  for (const r of (spelling && spelling.rounds) || []) {
    const lv = LEVELS.find(l => l.id === r.list);
    const own = ((spelling && spelling.lists) || []).find(l => l.id === r.list);
    const what = lv ? lv.name : own ? `My list: ${own.name}` : r.list === 'missed' ? 'Words I have missed' : r.list === 'review' ? 'Review of a round’s mistakes' : 'A list since deleted';
    add(r.t, 'Spelling', what, r);
  }
  for (const r of (geo && geo.rounds) || []) {
    const m = [...GEO_MODES, ...US_MODES].find(x => x[0] === r.mode);
    add(r.t, 'Geography', m ? (US_MODES.includes(m) ? `US states: ${m[1]}` : m[1]) : String(r.mode || ''), r);
  }
  for (const r of (science && science.rounds) || []) {
    const m = SCI_MODES.find(x => x[0] === r.mode);
    const range = r.upTo ? ` (${(RANGES.find(x => x[0] === r.upTo) || [0, `1 to ${r.upTo}`])[1].replace(/^Elements /, '')})` : '';
    add(r.t, 'Science', `${m ? m[1] : r.mode}${range}`, r);
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.map(({ t, cells }) => { const d = new Date(t); return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`, ...cells]; });
}

/** The rows as CSV text (with a header), each cell quoted when it needs to be. */
export const toCSV = rows => [HEADER, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
