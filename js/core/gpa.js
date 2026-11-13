/* ============================================================
   gpa.js (core) — Static Study's GPA arithmetic. No DOM here.

   Saved in store('portal.gpa') as
     { v: 1, weighted, activeId,
       scale:     [{ letter, min, points }],     min = lowest % for that letter
       bonus:     { honors, ap },                added to the points when weighted
       semesters: [{ id, name, courses: [{ id, name, credits, grade, level }] }] }
   grade is what the student typed: a letter on the scale ("B+") or a
   percentage ("87", "87.5%"). level is 'regular' | 'honors' | 'ap'.

   The rules, which the app prints next to every result:
     · a letter is looked up on the scale; a percentage takes the
       highest letter whose minimum it reaches
     · weighted GPA adds the level's bonus (honors +0.5, AP +1.0 unless
       edited) to a course's points — but only when the course earned
       more than 0 points, so an F stays 0.0; unweighted GPA ignores it
     · GPA = Σ(points × credits) ÷ Σ credits over the courses that have
       a grade the scale understands and credits above 0. Courses that
       don't are left out and listed, not guessed at
     · the cumulative GPA is the same sum over every semester at once
       (credit-weighted, not an average of semester GPAs)
   Nothing here makes a number up: no entered course, no GPA (null).
   ============================================================ */
import { store } from './store.js';

export const KEY = 'portal.gpa';
export const LEVELS = [['regular', 'Regular'], ['honors', 'Honors'], ['ap', 'AP / IB']];
export const DEFAULT_SCALE = [
  ['A+', 97, 4.0], ['A', 93, 4.0], ['A-', 90, 3.7],
  ['B+', 87, 3.3], ['B', 83, 3.0], ['B-', 80, 2.7],
  ['C+', 77, 2.3], ['C', 73, 2.0], ['C-', 70, 1.7],
  ['D+', 67, 1.3], ['D', 63, 1.0], ['D-', 60, 0.7],
  ['F', 0, 0.0],
].map(([letter, min, points]) => ({ letter, min, points }));
export const MAX_SEMESTERS = 30;
export const MAX_COURSES = 30;

export const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const round = (x, p = 2) => Math.round((x + Number.EPSILON) * 10 ** p) / 10 ** p;
export const fmt = (x, p = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : round(x, p).toFixed(p));

export function normScale(s) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(s) ? s : []) {
    const o = r && typeof r === 'object' ? r : {};
    const letter = String(o.letter == null ? '' : o.letter).trim().slice(0, 4);
    const key = letter.toLowerCase();
    if (!letter || seen.has(key)) continue;
    seen.add(key);
    out.push({ letter, min: Math.max(0, Math.min(200, num(o.min, 0))), points: Math.max(0, Math.min(10, num(o.points, 0))) });
  }
  return (out.length ? out : DEFAULT_SCALE.map(r => ({ ...r }))).sort((a, b) => b.min - a.min);
}
export function normCourse(c) {
  const o = c && typeof c === 'object' ? c : {};
  return {
    id: String(o.id || uid('c')).slice(0, 60),
    name: String(o.name == null ? '' : o.name).trim().slice(0, 60),
    credits: String(o.credits == null ? '' : o.credits).trim().slice(0, 6),
    grade: String(o.grade == null ? '' : o.grade).trim().slice(0, 8),
    level: LEVELS.some(([v]) => v === o.level) ? o.level : 'regular',
  };
}
export function normalize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const semesters = [];
  for (const s of Array.isArray(o.semesters) ? o.semesters : []) {
    const x = s && typeof s === 'object' ? s : {};
    const id = String(x.id || uid('s')).slice(0, 60);
    if (seen.has(id) || semesters.length >= MAX_SEMESTERS) continue;
    seen.add(id);
    semesters.push({ id, name: String(x.name || '').trim().slice(0, 40) || 'Semester', courses: (Array.isArray(x.courses) ? x.courses : []).slice(0, MAX_COURSES).map(normCourse) });
  }
  const b = o.bonus && typeof o.bonus === 'object' ? o.bonus : {};
  return {
    v: 1, weighted: o.weighted !== false,
    activeId: semesters.some(s => s.id === o.activeId) ? o.activeId : (semesters[0] ? semesters[0].id : ''),
    scale: normScale(o.scale),
    bonus: { honors: Math.max(0, Math.min(2, num(b.honors, 0.5))), ap: Math.max(0, Math.min(2, num(b.ap, 1))) },
    semesters,
  };
}
export const read = () => normalize(store.get(KEY));
export function write(data) {
  const out = JSON.parse(JSON.stringify(normalize(data)));
  store.set(KEY, out);
  return out;
}

/* ---------- one course ---------- */
/** { letter, points, via: 'letter'|'percent', percent } for what was typed, or null when the scale can't place it. */
export function gradeOf(text, scale) {
  const t = String(text || '').trim();
  if (!t) return null;
  const byLetter = scale.find(r => r.letter.toLowerCase() === t.toLowerCase());
  if (byLetter) return { letter: byLetter.letter, points: byLetter.points, via: 'letter', percent: null };
  const m = /^(\d+(?:\.\d+)?|\.\d+)\s*%?$/.exec(t);
  if (!m) return null;
  const pct = Number(m[1]);
  if (pct > 200) return null;
  const hit = [...scale].sort((a, b) => b.min - a.min).find(r => pct >= r.min);
  return hit ? { letter: hit.letter, points: hit.points, via: 'percent', percent: pct } : null;
}
export const creditsOf = c => { const n = Number(String(c.credits).trim()); return String(c.credits).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };

/** How a course counts: { counted, points (with bonus), base, bonus, credits, letter, why } */
export function courseResult(c, data) {
  const g = gradeOf(c.grade, data.scale);
  const credits = creditsOf(c);
  const out = { course: c, counted: false, credits, letter: g ? g.letter : null, base: g ? g.points : null, bonus: 0, points: null, why: '' };
  if (!c.grade.trim()) out.why = 'No grade yet';
  else if (!g) out.why = `“${c.grade}” isn’t on the scale`;
  else if (credits === null) out.why = 'Needs credits above 0';
  else {
    out.bonus = data.weighted && g.points > 0 ? (c.level === 'honors' ? data.bonus.honors : c.level === 'ap' ? data.bonus.ap : 0) : 0;
    out.points = g.points + out.bonus;
    out.counted = true;
  }
  return out;
}

/** GPA over a set of courses, with the working. -> { rows, credits, qp, gpa, formula } */
export function gpaOf(courses, data) {
  const rows = courses.map(c => courseResult(c, data));
  const used = rows.filter(r => r.counted);
  const credits = used.reduce((s, r) => s + r.credits, 0);
  const qp = used.reduce((s, r) => s + r.points * r.credits, 0);
  const gpa = credits > 0 ? qp / credits : null;
  const n = x => String(round(x, 2));
  const formula = used.length
    ? `(${used.map(r => `${r.points.toFixed(2).replace(/0$/, '')} × ${n(r.credits)}`).join(' + ')}) ÷ (${used.map(r => n(r.credits)).join(' + ')}) = ${n(qp)} ÷ ${n(credits)} = ${fmt(gpa)}`
    : '';
  return { rows, used: used.length, credits, qp, gpa, formula };
}
export const semesterGpa = (sem, data) => gpaOf(sem.courses, data);
export const cumulativeGpa = data => gpaOf(data.semesters.flatMap(s => s.courses), data);

/* ---------- the final-exam helper ---------- */
/**
 * The score needed on the final to end at `target`, when the final is worth
 * `weight` percent of the course and the rest of the course stands at `current`:
 *   needed = (target − current × (100 − weight) ÷ 100) ÷ (weight ÷ 100)
 * All three are percentages. -> { needed, status, formula } or null when an input isn't usable.
 */
export function neededOnFinal(current, weight, target) {
  const c = Number(current), w = Number(weight), t = Number(target);
  if (![c, w, t].every(Number.isFinite) || w <= 0 || w > 100 || c < 0 || t < 0) return null;
  const needed = round((t * 100 - c * (100 - w)) / w, 4);
  const status = needed <= 0 ? 'secured' : needed > 100 ? 'out-of-reach' : 'possible';
  const formula = `(${t} − ${c} × ${round(100 - w, 4)}%) ÷ ${round(w, 4)}% = ${round(needed, 2)}%`;
  return { needed, status, formula };
}

export default { KEY, DEFAULT_SCALE, read, write, normalize, gradeOf, courseResult, gpaOf, semesterGpa, cumulativeGpa, neededOnFinal, fmt };
