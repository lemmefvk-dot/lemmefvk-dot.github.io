/* ============================================================
   ics.js — Calendar files (.ics, iCalendar / RFC 5545) in and out.

   This is how a school calendar gets in: most school, club and
   calendar sites offer an .ics download, and every calendar app
   exports one. The file is only ever READ: nothing in it is run,
   fetched or followed (a URL in it is just text), and nothing is
   added until the person has seen the list and pressed Add.

     parse(text, { existing }) -> { ok, name, items, skipped, notes } | { ok:false, error }
       items:   [{ kind: 'event' | 'span', draft, title, notes: [why it changed] }]
       skipped: [{ title, why }]  — every event that is left out, and why
     build(events, spans)     -> the .ics text of what Calendar holds

   What is read from each VEVENT: SUMMARY (the name), DTSTART and
   DTEND or DURATION (all day, or times — UTC and named time zones are
   turned into this computer's time), LOCATION, DESCRIPTION, UID,
   EXDATE (days left out), and RRULE where Calendar can follow it:
   FREQ=DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL,
   and BYDAY when it is plain weekdays (weekly on Mon and Wed; daily
   on weekdays). A changed copy of one repeat (RECURRENCE-ID) leaves
   that day out of the series and comes in as its own event; a
   cancelled one just leaves the day out. An all-day event that runs
   over several days becomes a banner ("Terms and breaks").

   Left out, and said so: rules Calendar has no way to follow (the
   2nd Tuesday of each month, every hour…), a run of days that also
   repeats, cancelled events, to-dos, and anything already in your
   calendar (same UID). Alarms in the file are not set: a reminder
   is only ever one you ask for.

   build() writes what parse() reads, so a file exported here comes
   back the same: name, day, times, repeat (with its interval, days,
   end and left-out days), location, notes, and each banner.
   ============================================================ */
import * as CAL from './calendar.js';

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ITEMS = 2000;
const PRODID = '-//StaticOS//Calendar//EN';
const pad2 = n => String(n).padStart(2, '0');
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAYCODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/* ---------------- reading lines ---------------- */
/** Unfold (a line that starts with a space or tab continues the one before) and split. */
function lines(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
/** 'NAME;P=V;Q="a,b":value' -> { name, params, value } — colons inside quotes are not the split. */
function parseLine(line) {
  let i = 0, q = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = [];
  let cur = '', inq = false;
  for (const c of head) {
    if (c === '"') { inq = !inq; continue; }
    if (c === ';' && !inq) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const name = parts.shift().trim().toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim();
  }
  return { name, params, value };
}
const oneLine = (v, max) => String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const unescapeText = v => String(v).replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
const escapeText = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/* ---------------- time zones ---------------- */
const fmts = new Map();
function zoneFmt(tz) {
  if (fmts.has(tz)) return fmts.get(tz);
  let f = null;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) { f = null; }       /* not a zone this browser knows (Outlook's "Eastern Standard Time") */
  fmts.set(tz, f);
  return f;
}
/** Minutes a zone's wall clock is ahead of UTC at instant `ms`. */
function zoneOffset(ms, f) {
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / 60000;
}
/** The instant a wall-clock time in zone `tz` is, or null when the zone is unknown. */
function zoned(y, mo, d, h, mi, s, tz) {
  const f = zoneFmt(tz);
  if (!f) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = zoneOffset(guess, f);
  let t = guess - off * 60000;
  const off2 = zoneOffset(t, f);
  if (off2 !== off) t = guess - off2 * 60000;
  return t;
}

/**
 * A DTSTART / DTEND / EXDATE / RECURRENCE-ID value in this computer's terms:
 * { day, time ('' all day), allDay, zoneDay (the day as the file wrote it), unknownZone }
 */
function when(value, params) {
  const v = String(value || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || (params && params.VALUE === 'DATE' && /^\d{8}/.test(v))) {
    m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    return CAL.parseDay(day) ? { day, time: '', allDay: true, zoneDay: day } : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)];
  const zoneDay = `${m[1]}-${m[2]}-${m[3]}`;
  if (!CAL.parseDay(zoneDay) || h > 23 || mi > 59) return null;
  let at = null, unknownZone = '';
  if (m[7]) at = Date.UTC(y, mo - 1, d, h, mi, s);
  else if (params && params.TZID) {
    const tz = params.TZID.replace(/^\//, '');
    at = zoned(y, mo, d, h, mi, s, tz);
    if (at === null) unknownZone = tz;
  }
  if (at === null) return { day: zoneDay, time: `${pad2(h)}:${pad2(mi)}`, allDay: false, zoneDay, unknownZone };
  const t = new Date(at);
  return { day: CAL.ymd(t), time: `${pad2(t.getHours())}:${pad2(t.getMinutes())}`, allDay: false, zoneDay };
}
/** P1D, PT1H30M, P2W -> minutes, or null */
function duration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v || '').trim());
  if (!m || m[1] === '-') return null;
  return (+(m[2] || 0)) * 7 * 1440 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.floor((+(m[6] || 0)) / 60);
}
const minutesOf = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = mins => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

/* ---------------- RRULE ---------------- */
/** RRULE text -> { repeat, every, days, until, count } or { why } when Calendar can't follow it. */
function rule(text, start) {
  const r = {};
  for (const part of String(text || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) r[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().toUpperCase();
  }
  const freq = r.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    return { why: freq ? `it repeats ${freq.toLowerCase()} — Calendar repeats every day at most` : 'its repeat rule has no frequency' };
  }
  for (const k of ['BYSETPOS', 'BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND']) if (r[k]) return { why: `its repeat rule uses ${k}, which Calendar can’t follow` };
  const every = r.INTERVAL ? Number(r.INTERVAL) : 1;
  if (!Number.isInteger(every) || every < 1) return { why: 'its repeat interval isn’t a whole number' };
  if (every > CAL.EVERY_MAX) return { why: `it repeats every ${every} — Calendar goes up to every ${CAL.EVERY_MAX}` };
  const out = { every, days: [], until: '', count: 0, untilRaw: r.UNTIL || '' };
  if (r.COUNT) { const c = Number(r.COUNT); if (!Number.isInteger(c) || c < 1) return { why: 'its repeat count isn’t a whole number' }; out.count = Math.min(c, 5000); }
  const days = r.BYDAY ? r.BYDAY.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (days.some(d => !(d in BYDAY))) return { why: freq === 'MONTHLY' || freq === 'YEARLY' ? 'it repeats on a weekday of the month (like the 2nd Tuesday) — Calendar repeats monthly on a date' : 'its repeat rule names weekdays in a way Calendar can’t follow' };
  const nums = [...new Set(days.map(d => BYDAY[d]))].sort();
  const weekdays = nums.length === 5 && [1, 2, 3, 4, 5].every(n => nums.includes(n));
  if (freq === 'DAILY') {
    if (!nums.length) out.repeat = 'daily';
    else if (every !== 1) return { why: 'it repeats every few days on some weekdays only, which Calendar can’t follow' };
    else if (weekdays) out.repeat = 'weekdays';
    else { out.repeat = 'weekly'; out.days = nums; }
  } else if (freq === 'WEEKLY') {
    if (weekdays && every === 1 && start.wd >= 1 && start.wd <= 5) out.repeat = 'weekdays';
    else { out.repeat = 'weekly'; out.days = nums; }
  } else if (freq === 'MONTHLY') {
    if (nums.length) return { why: 'it repeats on a weekday of the month — Calendar repeats monthly on a date' };
    if (r.BYMONTHDAY && (r.BYMONTHDAY.includes(',') || Number(r.BYMONTHDAY) !== start.dom)) return { why: 'it repeats on days of the month other than its first one' };
    out.repeat = 'monthly';
  } else {
    if (nums.length) return { why: 'it repeats on a weekday of the year — Calendar repeats yearly on a date' };
    if (r.BYMONTH && (r.BYMONTH.includes(',') || Number(r.BYMONTH) !== start.month)) return { why: 'it repeats in months other than its first one' };
    if (r.BYMONTHDAY && (r.BYMONTHDAY.includes(',') || Number(r.BYMONTHDAY) !== start.dom)) return { why: 'it repeats on days other than its first one' };
    out.repeat = 'yearly';
  }
  return out;
}

/* ---------------- reading a file ---------------- */
const shortDay = d => CAL.parseDay(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export function parse(text, { existing = CAL.events(), existingSpans = CAL.spans() } = {}) {
  const src = String(text || '');
  if (src.length > MAX_BYTES) return { ok: false, error: `This file is bigger than ${MAX_BYTES / 1048576} MB, more than a calendar file should be, so it wasn’t read.` };
  if (!/BEGIN:VCALENDAR/i.test(src)) return { ok: false, error: 'This isn’t a calendar file: there is no BEGIN:VCALENDAR in it. Calendar reads .ics files.' };

  /* split into VEVENTs; anything nested inside one (an alarm) is noted, not read as the event */
  let name = '';
  const raws = [];
  let ev = null, depth = 0, todos = 0, journals = 0, alarms = 0;
  for (const ln of lines(src)) {
    if (!ln.trim()) continue;
    const p = parseLine(ln);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      if (ev) { depth++; if (what === 'VALARM') alarms++; continue; }
      if (what === 'VEVENT') { ev = { props: [] }; depth = 0; }
      else if (what === 'VTODO') todos++;
      else if (what === 'VJOURNAL') journals++;
      continue;
    }
    if (p.name === 'END') {
      if (ev && depth > 0) { depth--; continue; }
      if (ev && p.value.trim().toUpperCase() === 'VEVENT') { raws.push(ev); ev = null; if (raws.length > MAX_ITEMS * 2) break; }
      continue;
    }
    if (ev) { if (depth === 0) ev.props.push(p); }
    else if (p.name === 'X-WR-CALNAME' && !name) name = unescapeText(p.value).trim().slice(0, 80);
  }

  const items = [], skipped = [], notes = [];
  const masters = new Map();          /* uid -> item with a repeat */
  const overrides = [];
  const haveUid = new Set();
  for (const e of existing) { if (e.uid) haveUid.add(e.uid); haveUid.add(`${e.id}@staticos`); }
  for (const s of existingSpans) { if (s.uid) haveUid.add(s.uid); haveUid.add(`${s.id}@staticos`); }
  const seenUid = new Set();

  for (const r of raws) {
    const get = n => r.props.find(p => p.name === n);
    const all = n => r.props.filter(p => p.name === n);
    const title = get('SUMMARY') ? oneLine(unescapeText(get('SUMMARY').value), CAL.TITLE_MAX) : '';
    const label = title || 'Untitled event';
    const uid = get('UID') ? unescapeText(get('UID').value).trim().slice(0, 200) : '';
    const status = get('STATUS') ? get('STATUS').value.trim().toUpperCase() : '';
    const rid = get('RECURRENCE-ID');
    const ds = get('DTSTART');
    const start = ds ? when(ds.value, ds.params) : null;
    if (rid && uid && haveUid.has(uid)) continue;        /* its series is already in your calendar */
    if (rid) { overrides.push({ r, uid, title: label, status, rid: when(rid.value, rid.params), start, get, all }); continue; }
    if (status === 'CANCELLED') { skipped.push({ title: label, why: 'It is marked cancelled.' }); continue; }
    if (!start) { skipped.push({ title: label, why: ds ? 'Its start isn’t a date Calendar can read.' : 'It has no start date.' }); continue; }
    if (uid && haveUid.has(uid)) { skipped.push({ title: label, why: 'It is already in your calendar.' }); continue; }
    if (uid && seenUid.has(uid)) { skipped.push({ title: label, why: 'It is in the file twice; it is added once.' }); continue; }
    if (uid) seenUid.add(uid);
    const why = [];
    if (!title) why.push('It had no name, so it is called “Untitled event”.');
    if (start.unknownZone) why.push(`Its time zone (${start.unknownZone}) isn’t one this browser knows, so its times are read as this computer’s.`);
    const location = get('LOCATION') ? unescapeText(get('LOCATION').value) : '';
    const desc = get('DESCRIPTION') ? unescapeText(get('DESCRIPTION').value) : '';
    const isSpan = !!get('X-STATICOS-SPAN');

    /* how long: DTEND, or DURATION, or nothing */
    const de = get('DTEND');
    const endW = de ? when(de.value, de.params) : null;
    const dur = get('DURATION') ? duration(get('DURATION').value) : null;
    let allDay = start.allDay, time = start.time, end = '', lastDay = start.day;
    if (allDay) {
      let days = 1;
      if (endW && endW.allDay) days = Math.max(1, CAL.daysBetween(start.day, endW.day));
      else if (dur !== null) days = Math.max(1, Math.round(dur / 1440));
      lastDay = CAL.addDay(start.day, days - 1);
    } else {
      let endMin = null, endDay = start.day;
      if (endW && !endW.allDay) { endDay = endW.day; endMin = minutesOf(endW.time); }
      else if (dur !== null) { const t = minutesOf(time) + dur; endDay = CAL.addDay(start.day, Math.floor(t / 1440)); endMin = t % 1440; }
      if (endMin !== null) {
        if (endDay === start.day && endMin > minutesOf(time)) end = hhmm(endMin);
        else if (endDay > start.day) why.push('It ends on a later day; Calendar events end on the day they start, so it has no end time here.');
      }
    }

    /* the repeat */
    let rep = { repeat: 'none' };
    const rr = get('RRULE');
    if (rr) {
      const zoneShift = CAL.daysBetween(start.zoneDay, start.day);    /* a UTC time can land on the day before or after here */
      const wd = CAL.weekdayOf(start.zoneDay);
      const got = rule(rr.value, { wd, dom: +start.zoneDay.slice(8, 10), month: +start.zoneDay.slice(5, 7) });
      if (got.why) { skipped.push({ title: label, why: `Not added: ${got.why}.` }); continue; }
      if (lastDay !== start.day) { skipped.push({ title: label, why: 'Not added: it lasts several days and repeats, and Calendar can’t draw a repeating run of days.' }); continue; }
      rep = { repeat: got.repeat, every: got.every, days: got.days.map(d => (((d + zoneShift) % 7) + 7) % 7) };
      if (got.untilRaw) {
        const u = when(got.untilRaw, /^\d{8}$/.test(got.untilRaw) ? { VALUE: 'DATE' } : (ds.params && ds.params.TZID && !/Z$/i.test(got.untilRaw) ? { TZID: ds.params.TZID } : {}));
        if (u) rep.until = u.day < start.day ? start.day : u.day;
      }
      rep.count = got.count;
      if (all('RDATE').length) why.push('Its extra dates (RDATE) weren’t added; the regular repeats were.');
    }
    const skip = [];
    for (const x of all('EXDATE')) for (const v of x.value.split(',')) { const w = when(v, x.params); if (w) skip.push(w.day); }

    if (allDay && (lastDay !== start.day || isSpan) && rep.repeat === 'none') {
      items.push({ kind: 'span', title: label, notes: why, draft: { title: title || 'Untitled event', start: start.day, end: lastDay, uid }, when: `${shortDay(start.day)} – ${shortDay(lastDay)}` });
      continue;
    }
    const draft = { title: title || 'Untitled event', date: start.day, allDay, time: allDay ? '' : time, end, repeat: rep.repeat,
      every: rep.every || 1, days: rep.days || [], until: rep.until || '', skip, location, notes: desc, uid, remind: null };
    if (rep.count) {
      /* COUNT: the day of the last of them is when it stops (left-out days still count, as in the file) */
      const probe = CAL.normEvent({ ...draft, skip: [], until: '' }, draft.date);
      let k = probe ? probe.date : null;
      for (let i = 1; k && i < rep.count; i++) k = CAL.nextOn(probe, CAL.addDay(k, 1));
      if (k && (!draft.until || k < draft.until)) draft.until = k;
    }
    const item = { kind: 'event', title: label, notes: why, draft, when: `${shortDay(draft.date)}${allDay ? ', all day' : `, ${CAL.clockText(time)}${end ? ` – ${CAL.clockText(end)}` : ''}`}` };
    items.push(item);
    if (uid && rep.repeat !== 'none') masters.set(uid, item);
  }

  /* changed or cancelled single days of a series */
  let cancelledDays = 0;
  for (const o of overrides) {
    const m = o.uid && masters.get(o.uid);
    if (m && o.rid) {
      if (!m.draft.skip.includes(o.rid.day)) m.draft.skip.push(o.rid.day);
      if (o.status === 'CANCELLED') { cancelledDays++; continue; }
    } else if (o.status === 'CANCELLED') continue;
    if (!o.start) { skipped.push({ title: o.title, why: 'A changed day of a repeating event, with no start date.' }); continue; }
    const de = o.get('DTEND');
    const endW = de ? when(de.value, de.params) : null;
    const end = !o.start.allDay && endW && !endW.allDay && endW.day === o.start.day && minutesOf(endW.time) > minutesOf(o.start.time) ? endW.time : '';
    items.push({ kind: 'event', title: o.title, notes: m ? ['One changed day of a repeating event: it comes in on its own, and that day is left out of the series.'] : [],
      draft: { title: o.title, date: o.start.day, allDay: o.start.allDay, time: o.start.allDay ? '' : o.start.time, end, repeat: 'none',
        location: o.get('LOCATION') ? unescapeText(o.get('LOCATION').value) : '', notes: o.get('DESCRIPTION') ? unescapeText(o.get('DESCRIPTION').value) : '', uid: '', remind: null },
      when: `${shortDay(o.start.day)}${o.start.allDay ? ', all day' : `, ${CAL.clockText(o.start.time)}`}` });
  }
  /* a series whose first day was left out starts on its next day */
  for (const it of items) {
    const d = it.draft;
    if (it.kind !== 'event' || d.repeat === 'none' || !d.skip.includes(d.date)) continue;
    const probe = CAL.normEvent({ ...d, skip: [] }, d.date);
    let k = probe.date;
    while (k && d.skip.includes(k)) k = CAL.nextOn(probe, CAL.addDay(k, 1));
    if (!k) { it.drop = true; skipped.push({ title: it.title, why: 'Every day of it is left out (cancelled) in the file.' }); continue; }
    d.date = k;
    d.skip = d.skip.filter(s => s > k);
  }
  const kept = items.filter(it => !it.drop).slice(0, MAX_ITEMS);
  if (items.length > MAX_ITEMS) skipped.push({ title: `${items.length - MAX_ITEMS} more`, why: `A file can add up to ${MAX_ITEMS} at once.` });
  for (const it of kept) if (it.kind === 'event') it.draft.skip = [...new Set(it.draft.skip)].filter(s => s > it.draft.date).sort();
  if (cancelledDays) notes.push(`${cancelledDays} cancelled day${cancelledDays === 1 ? ' is' : 's are'} left out of ${cancelledDays === 1 ? 'its' : 'their'} repeating event.`);
  if (todos || journals) skipped.push({ title: [todos ? `${todos} to-do${todos === 1 ? '' : 's'}` : '', journals ? `${journals} journal entr${journals === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' and '), why: 'Calendar holds events; to-dos belong in Static Tasks.' });
  if (alarms) notes.push('Alarms in the file were not set. A reminder is only ever one you ask for: add one to an event after it is in.');
  return { ok: true, name, items: kept, skipped, notes };
}

/* ---------------- writing a file ---------------- */
const icsDay = d => d.replace(/-/g, '');
const icsDayTime = (d, t) => `${icsDay(d)}T${t.replace(':', '')}00`;
function utcStamp(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}T${pad2(t.getUTCHours())}${pad2(t.getUTCMinutes())}${pad2(t.getUTCSeconds())}Z`;
}
/** Fold a line at 75 bytes (continuations start with a space), never splitting a character. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', size = 0, max = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > max) { out.push(cur); cur = ' '; size = 1; max = 75; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n');
}
function rruleOf(ev) {
  if (!ev.repeat || ev.repeat === 'none') return '';
  const freq = { daily: 'DAILY', weekdays: 'WEEKLY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[ev.repeat];
  const parts = [`FREQ=${freq}`];
  if (ev.every > 1 && ev.repeat !== 'weekdays') parts.push(`INTERVAL=${ev.every}`);
  if (ev.repeat === 'weekdays') parts.push('BYDAY=MO,TU,WE,TH,FR');
  else if (ev.repeat === 'weekly' && ev.days && ev.days.length) parts.push(`BYDAY=${[1, 2, 3, 4, 5, 6, 0].filter(d => ev.days.includes(d)).map(d => DAYCODE[d]).join(',')}`);
  if (ev.until) parts.push(`UNTIL=${ev.allDay ? icsDay(ev.until) : `${icsDay(ev.until)}T235959`}`);
  return parts.join(';');
}

export function build(events = CAL.events(), spans = CAL.spans(), { now = Date.now(), name = 'StaticOS Calendar' } = {}) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeText(name)}`];
  const stamp = utcStamp(now);
  for (const ev of events) {
    out.push('BEGIN:VEVENT', `UID:${escapeText(ev.uid || `${ev.id}@staticos`)}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(ev.title)}`);
    if (ev.allDay) out.push(`DTSTART;VALUE=DATE:${icsDay(ev.date)}`, `DTEND;VALUE=DATE:${icsDay(CAL.addDay(ev.date, 1))}`);
    else {
      out.push(`DTSTART:${icsDayTime(ev.date, ev.time)}`);
      if (ev.end) out.push(`DTEND:${icsDayTime(ev.date, ev.end)}`);
    }
    const rr = rruleOf(ev);
    if (rr) out.push(`RRULE:${rr}`);
    if (rr && ev.skip.length) out.push(ev.allDay ? `EXDATE;VALUE=DATE:${ev.skip.map(icsDay).join(',')}` : `EXDATE:${ev.skip.map(s => icsDayTime(s, ev.time)).join(',')}`);
    if (ev.location) out.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.notes) out.push(`DESCRIPTION:${escapeText(ev.notes)}`);
    out.push('END:VEVENT');
  }
  for (const s of spans) {
    out.push('BEGIN:VEVENT', `UID:${escapeText(s.uid || `${s.id}@staticos`)}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(s.title)}`,
      `DTSTART;VALUE=DATE:${icsDay(s.start)}`, `DTEND;VALUE=DATE:${icsDay(CAL.addDay(s.end, 1))}`, 'TRANSP:TRANSPARENT', 'X-STATICOS-SPAN:TRUE', 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}

export default { parse, build, MAX_BYTES, MAX_ITEMS };
