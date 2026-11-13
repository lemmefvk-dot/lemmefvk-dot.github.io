/* ============================================================
   exams.js (core) — Static Study's tests: a countdown in real days,
   a study plan for each, and the reminders it asks for. No DOM here.

   Saved in store('portal.exams') as
     { v: 1, exams: [{ id, subject, date, time, topics, busy, perDay,
                       perTopic, remind, late, sched, created }] }
   date is 'YYYY-MM-DD'; time is 'HH:MM' or '' (the exam is on until the
   end of that day); topics is [{ id, text, done }]; busy is the days
   you cannot study; perDay and perTopic are minutes YOU said (0 = not
   said); remind is null, 'eve' or 'daily'.

   THE COUNTDOWN counts calendar days, not 24-hour blocks: both dates
   are read as local year/month/day and subtracted as plain day
   numbers, so a clock change (a 23- or 25-hour day) cannot make it a
   day early or late. The day itself says "Today".

   THE PLAN splits the topics still open over the free days from today
   to the day BEFORE the exam (the exam day is not planned: nobody can
   promise a study day then), skipping the days marked busy.
     · Topics keep your order; ones that were planned for a day that
       has gone by without being ticked come first ("carried over").
     · The split is even: each free day gets the same number of topics
       give or take one, earlier days taking the extra. With fewer
       topics than days, one a day on the first days and the rest left
       free.
     · It is re-made from the clock and the ticks every time it is
       shown, so a missed day or a tick changes it by itself.
     · It says so when there is not enough time: no free day left, or
       the minutes you gave (a day, and a topic) say it will not fit.
       Minutes are only ever YOURS: with a per-day figure it shows
       "your 60 min split over the 2 topics", never a made-up duration.

   REMINDERS are not a second clock: every write hands what the exams
   want to js/core/automations.js (syncSourceReminders('study-exams',
   …)) — the engine homework uses. Past or deleted exams want none, so
   theirs are removed; a time that has already gone is not made.
   Like the others they only go off while StaticOS is open.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as AM from './automations.js';
import { parseDay, ymd, addDays, uid } from './homework.js';

export const KEY = 'portal.exams';
export const SRC = 'study-exams';
export const MAX_EXAMS = 60;
export const MAX_TOPICS = 60;
export const MAX_BUSY = 400;
export const REMIND = [[null, 'No reminder'], ['eve', 'The day before, 9:00 AM'], ['daily', 'Each study day, 9:00 AM']];
const REMIND_TIME = '09:00';
const MAX_DAILY_REMINDERS = 21;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const minutes = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

/* ---------- days ---------- */
/** A local calendar day as a whole number, so subtracting two is a count of calendar days whatever the clock did between. */
export function dayNumber(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m || !parseDay(day)) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}
export const todayOf = (now = Date.now()) => ymd(new Date(now));
/** Whole calendar days from `from` to `to` ('YYYY-MM-DD'); negative when `to` is earlier. */
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

/* ---------- the data ---------- */
export function normTopic(t) {
  const o = typeof t === 'string' ? { text: t } : t && typeof t === 'object' ? t : {};
  const tx = text(o.text, 120);
  return tx ? { id: String(o.id || uid('t')).slice(0, 60), text: tx, done: !!o.done } : null;
}
export function normExam(e) {
  const o = e && typeof e === 'object' ? e : {};
  const subject = text(o.subject, 60);
  if (!subject || !parseDay(o.date)) return null;
  const seen = new Set();
  const topics = [];
  for (const t of Array.isArray(o.topics) ? o.topics : []) {
    const n = normTopic(t);
    if (!n || seen.has(n.id) || topics.length >= MAX_TOPICS) continue;
    seen.add(n.id); topics.push(n);
  }
  const busy = [...new Set((Array.isArray(o.busy) ? o.busy : []).filter(d => dayNumber(d) !== null))].sort().slice(0, MAX_BUSY);
  const sched = {};
  if (o.sched && typeof o.sched === 'object') for (const [id, d] of Object.entries(o.sched)) if (seen.has(id) && dayNumber(d) !== null) sched[id] = d;
  return {
    id: String(o.id || uid('x')).slice(0, 60), subject, date: o.date,
    time: TIME_RE.test(o.time) ? o.time : '', topics, busy,
    perDay: minutes(o.perDay, 1440), perTopic: minutes(o.perTopic, 600),
    remind: REMIND.some(([v]) => v === o.remind) ? o.remind : null,
    late: [...new Set((Array.isArray(o.late) ? o.late : []).filter(id => seen.has(id)))],
    sched, created: Number(o.created) || Date.now(),
  };
}
export function normalize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const ids = new Set();
  const exams = [];
  for (const e of Array.isArray(o.exams) ? o.exams : []) {
    const n = normExam(e);
    if (!n || ids.has(n.id) || exams.length >= MAX_EXAMS) continue;
    ids.add(n.id); exams.push(n);
  }
  return { v: 1, exams };
}
export const read = () => normalize(store.get(KEY));

/* ---------- the countdown ---------- */
/** The moment the exam starts: its time, or the end of its day when it has none. */
export function examAt(e) {
  const d = parseDay(e.date);
  const [h, m] = e.time ? e.time.split(':').map(Number) : [23, 59];
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, e.time ? 0 : 59, e.time ? 0 : 999).getTime();
}
export const isPast = (e, now = Date.now()) => examAt(e) < now;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** { days, state: 'past' | 'today' | 'soon' | 'later', text }. days is calendar days to the exam's day (negative after it). */
export function countdown(e, now = Date.now()) {
  const days = daysBetween(todayOf(now), e.date);
  if (isPast(e, now)) return { days, state: 'past', text: days === 0 ? 'Finished earlier today' : days === -1 ? 'Yesterday' : `${plural(-days, 'day')} ago` };
  if (days === 0) return { days, state: 'today', text: 'Today' };
  return { days, state: days <= 7 ? 'soon' : 'later', text: days === 1 ? 'Tomorrow' : plural(days, 'day') };
}

/* ---------- the plan ---------- */
/** The days you can study: today up to the day before the exam, each marked busy or free. */
export function studyDays(e, now = Date.now()) {
  const t = todayOf(now);
  const n = daysBetween(t, e.date);
  const out = [];
  for (let k = 0; k < n && k < 400; k++) { const day = addDays(t, k); out.push({ day, busy: e.busy.includes(day) }); }
  return out;
}

/** Spread `items` over `slots` slots evenly, the earlier slots taking the extra. -> array of arrays */
export function spread(items, slots) {
  const out = Array.from({ length: slots }, () => []);
  if (!slots || !items.length) return out;
  if (items.length <= slots) { items.forEach((it, i) => out[i].push(it)); return out; }
  const base = Math.floor(items.length / slots), extra = items.length % slots;
  let at = 0;
  for (let i = 0; i < slots; i++) { const n = base + (i < extra ? 1 : 0); out[i] = items.slice(at, at + n); at += n; }
  return out;
}

/**
 * The plan for one exam, from the clock and the ticks. ->
 *   { status: 'past' | 'today' | 'empty' | 'finished' | 'ok' | 'short',
 *     days: [{ day, busy, topics: [{id,text}], minEach }], freeDays, open, carried: [topic],
 *     unplanned: [topic], notes: [string] }
 * 'short' means there is not enough time (the notes say why, in numbers that are yours).
 */
export function plan(e, now = Date.now()) {
  const base = { days: [], freeDays: 0, open: 0, carried: [], unplanned: [], notes: [] };
  const open = e.topics.filter(t => !t.done);
  base.open = open.length;
  if (isPast(e, now)) return { ...base, status: 'past', notes: ['This exam has passed.'] };
  if (!e.topics.length) return { ...base, status: 'empty', notes: ['Add the topics to study and a plan appears here.'] };
  if (!open.length) return { ...base, status: 'finished', notes: ['Every topic is ticked off.'] };
  const lateIds = new Set(e.late);
  const carried = open.filter(t => lateIds.has(t.id));
  const order = [...carried, ...open.filter(t => !lateIds.has(t.id))];
  const days = studyDays(e, now);
  const free = days.filter(d => !d.busy);
  const out = { ...base, carried, open: open.length, freeDays: free.length };
  if (!free.length) {
    out.days = days.map(d => ({ ...d, topics: [], minEach: 0 }));
    out.unplanned = order;
    out.status = 'short';
    out.notes.push(days.length
      ? `Every day before the exam is marked busy, so none of the ${plural(open.length, 'open topic')} can be planned. Free up a day.`
      : `There is no day left before the exam to plan the ${plural(open.length, 'open topic')}. Use what time you have today and tick off what you cover.`);
    return out;
  }
  /* the minutes you gave: how many topics one day can hold */
  const cap = e.perDay && e.perTopic ? Math.floor(e.perDay / e.perTopic) : 0;
  let planned = order;
  if (e.perDay && e.perTopic) {
    const need = open.length * e.perTopic, have = free.length * e.perDay;
    if (cap < 1) {
      out.unplanned = order; planned = [];
      out.notes.push(`One topic takes ${e.perTopic} min by your estimate but you have ${e.perDay} min a day, so no topic fits in a day as you have set it.`);
    } else if (open.length > free.length * cap) {
      planned = order.slice(0, free.length * cap);
      out.unplanned = order.slice(free.length * cap);
    }
    if (out.unplanned.length && cap >= 1) {
      out.notes.push(`Not enough time: ${plural(open.length, 'topic')} at ${e.perTopic} min is ${need} min, and ${plural(free.length, 'free day')} at ${e.perDay} min is ${have} min. ${plural(out.unplanned.length, 'topic')} will not fit. Add time, drop a topic, or free up a day.`);
    }
  }
  const per = spread(planned, free.length);
  let k = 0;
  out.days = days.map(d => {
    if (d.busy) return { ...d, topics: [], minEach: 0 };
    const topics = per[k++].map(t => ({ id: t.id, text: t.text }));
    return { ...d, topics, minEach: e.perDay && topics.length ? Math.floor(e.perDay / topics.length) : 0 };
  });
  out.status = out.unplanned.length ? 'short' : 'ok';
  if (!out.unplanned.length && out.freeDays < open.length && !e.perDay) out.notes.push(`${plural(open.length, 'topic')} over ${plural(out.freeDays, 'free day')}: some days have more than one.`);
  if (carried.length) out.notes.push(`${plural(carried.length, 'topic')} from a day that went by ${carried.length === 1 ? 'is' : 'are'} carried over, listed first.`);
  return out;
}

/** What was planned for each open topic as of now; kept to tell later which days went by unticked. */
export function stamp(e, now = Date.now()) {
  const p = plan(e, now);
  const sched = {};
  for (const d of p.days) for (const t of d.topics) sched[t.id] = d.day;
  return sched;
}
/** Bring an exam up to the clock: topics planned for a day that has gone by and are still open become "late"; then re-stamp. */
export function advance(e, now = Date.now()) {
  const t = todayOf(now);
  const open = new Set(e.topics.filter(x => !x.done).map(x => x.id));
  const late = new Set(e.late.filter(id => open.has(id)));
  for (const [id, day] of Object.entries(e.sched)) if (open.has(id) && daysBetween(day, t) > 0) late.add(id);
  const next = { ...e, late: [...late] };
  next.sched = isPast(next, now) ? {} : stamp(next, now);
  return next;
}

/* ---------- reminders ---------- */
export const remindLabel = v => (REMIND.find(([x]) => x === v) || [0, ''])[1];
/** The reminders one exam wants, in the shape automations.js takes. */
export function remindersFor(e, now = Date.now()) {
  if (!e.remind || isPast(e, now)) return [];
  const when = e.time ? ` at ${new Date(2000, 0, 3, ...e.time.split(':').map(Number)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';
  const dateText = parseDay(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (e.remind === 'eve') {
    const left = e.topics.filter(t => !t.done).length;
    return [{ ref: `${e.id}:eve`, text: `${e.subject} exam tomorrow`, sub: `${dateText}${when}${left ? ` · ${plural(left, 'topic')} not ticked off` : ''}`, time: REMIND_TIME, date: addDays(e.date, -1) }];
  }
  const p = plan(e, now);
  return p.days.filter(d => !d.busy && d.topics.length).slice(0, MAX_DAILY_REMINDERS).map(d => ({
    ref: `${e.id}:${d.day}`, text: `${e.subject}: study today`,
    sub: d.topics.map(t => t.text).join(', ').slice(0, 100) + ` · exam ${dateText}`, time: REMIND_TIME, date: d.day,
  }));
}
/** Hand every exam's reminders to the engine. -> { [ref]: 'set' | 'passed' | 'full' } */
export function syncReminders(data = read(), now = Date.now()) {
  try { return AM.syncSourceReminders(SRC, data.exams.flatMap(e => remindersFor(e, now)), now); }
  catch (err) { console.error('[exams] reminders', err); return {}; }
}

/** Save (after bringing every exam up to the clock), then bring the reminders in line. -> { data, reminders } */
export function write(data, now = Date.now()) {
  const norm = normalize(data);
  norm.exams = norm.exams.map(e => advance(e, now));
  const out = JSON.parse(JSON.stringify(norm));
  store.set(KEY, out);
  return { data: out, reminders: syncReminders(out, now) };
}

/**
 * Keep reminders and "carried over" in step with the clock without the window open:
 * once at start and again when the date changes, rewrites the saved exams if anything moved.
 */
export function refresh(now = Date.now()) {
  const cur = read();
  if (!cur.exams.length) { syncReminders(cur, now); return cur; }
  const moved = cur.exams.map(e => advance(e, now));
  if (JSON.stringify(moved) !== JSON.stringify(cur.exams)) return write(cur, now).data;
  syncReminders(cur, now);
  return cur;
}
let lastDay = '';
export function init() {
  const tick = () => { const t = todayOf(); if (t !== lastDay) { lastDay = t; try { refresh(); } catch (err) { console.error('[exams]', err); } } };
  tick();
  bus.on('tick:5s', tick);
}

export default { KEY, REMIND, read, write, normalize, countdown, plan, advance, remindersFor, syncReminders, refresh, init, daysBetween, dayNumber, spread };
