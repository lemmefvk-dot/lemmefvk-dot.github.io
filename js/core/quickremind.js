/* ============================================================
   quickremind.js — "timer 10m" and "remind me in 1h to call mum",
   read from a line typed into Spotlight. Pure: it only understands
   the words. Making the timer is js/core/automations.js (addTimer),
   which rides the reminder engine — there is no second scheduler.

     parse('timer 1h30m')                 -> { kind: 'timer', seconds: 5400, text: '1 h 30 min timer' }
     parse('remind me in 20 min to stretch') -> { kind: 'remind', seconds: 1200, text: 'stretch' }
     parse('remind me to stretch in 20 min') -> the same
   A bare number is minutes ("timer 10"). From 1 second to 24 hours.
   ============================================================ */
const UNITS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};
export const MAX_SECONDS = 24 * 3600;

/** "1h30m", "90 sec", "1.5 hours", "10" (minutes) -> seconds, or null. */
export function parseDuration(text) {
  const s = String(text || '').toLowerCase().replace(/,/g, ' ').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return finish(parseFloat(s) * 60);
  let total = 0, used = 0;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const mult = UNITS[m[2]];
    if (!mult) return null;
    total += parseFloat(m[1]) * mult;
    used += m[0].length;
  }
  /* nothing may be left over but spaces and "and" */
  const rest = s.replace(re, '').replace(/\band\b/g, '').replace(/\s+/g, '');
  if (!used || rest) return null;
  return finish(total);
}
function finish(sec) {
  const n = Math.round(sec);
  return n >= 1 && n <= MAX_SECONDS ? n : null;
}

/** 90 -> "1 min 30 s", 5400 -> "1 h 30 min" */
export function say(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const parts = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (x && !h) parts.push(`${x} s`);
  return parts.join(' ') || '0 s';
}

/** What the line asks for, or null. */
export function parse(raw) {
  const q = String(raw || '').trim().replace(/\s+/g, ' ');
  let m = q.match(/^(?:set\s+(?:a\s+)?)?timer\s*(?:for\s+)?(.+)$/i);
  if (m) {
    const seconds = parseDuration(m[1]);
    return seconds ? { kind: 'timer', seconds, text: `${say(seconds)} timer` } : null;
  }
  m = q.match(/^remind\s+me\s+in\s+(.+?)\s+(?:to|about|that)\s+(.+)$/i);
  if (m) {
    const seconds = parseDuration(m[1]);
    if (seconds && m[2].trim()) return { kind: 'remind', seconds, text: m[2].trim() };
  }
  m = q.match(/^remind\s+me\s+(?:to|about|that)\s+(.+?)\s+in\s+(.+)$/i);
  if (m) {
    const seconds = parseDuration(m[2]);
    if (seconds && m[1].trim()) return { kind: 'remind', seconds, text: m[1].trim() };
  }
  return null;
}

/* ---- a clock time and a day: "4pm", "tomorrow at 9:30", "friday at noon" ----
   Used by Staticum ("remind me at 4pm to hand in the essay") and by its
   "add task … due friday". Still only words; the reminder is made by
   js/core/automations.js. */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad2 = n => String(n).padStart(2, '0');
export const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** "today", "tomorrow", "friday", "next monday", "2026-11-20" -> a Date at local midnight, or null. */
export function parseDay(text, now = new Date()) {
  const s = String(text || '').toLowerCase().replace(/^(?:on|by)\s+/, '').trim();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = n => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  if (s === 'today' || s === 'tonight') return base;
  if (s === 'tomorrow') return plus(1);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    return d.getMonth() === +iso[2] - 1 ? d : null;
  }
  const w = s.match(/^(next\s+|this\s+)?([a-z]+)$/);
  if (w) {
    const i = DAYS.findIndex(d => d === w[2] || (w[2].length >= 3 && d.startsWith(w[2])));
    if (i >= 0) {
      let diff = (i - base.getDay() + 7) % 7;
      if (diff === 0 && w[1] && w[1].trim() === 'next') diff = 7;
      return plus(diff);
    }
  }
  return null;
}

/** "4pm", "4:30 pm", "16:30", "noon", "at 9" -> minutes after midnight, or null.
    With no am/pm, 1 to 6 is taken as the afternoon and 7 to 11 as the morning. */
export function parseClock(text) {
  const s = String(text || '').toLowerCase().replace(/^at\s+/, '').trim();
  if (s === 'noon') return 12 * 60;
  if (s === 'midnight') return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] === undefined ? 0 : +m[2];
  if (min > 59 || h > 23) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = h % 12 + (m[3] === 'p' ? 12 : 0);
  } else if (h >= 1 && h <= 6) h += 12;            /* "at 4" means the afternoon */
  return h * 60 + min;
}

/** "tomorrow at 4pm", "friday 9:30", "4pm" -> { at: Date, dayWord: bool } or null. */
export function parseMoment(text, now = new Date()) {
  let s = String(text || '').toLowerCase().replace(/[.,]+$/, '').trim();
  s = s.replace(/^(?:on|at|by)\s+/, '');
  let day = null, dayWord = false;
  const dm = s.match(/^(today|tonight|tomorrow|(?:next\s+|this\s+)?(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*|\d{4}-\d{2}-\d{2})\s*(?:at\s+)?(.*)$/);
  if (dm) { day = parseDay(dm[1], now); s = dm[2].trim(); dayWord = true; if (!day) return null; }
  let tm = s ? parseClock(s) : (dayWord ? 9 * 60 : null);
  if (tm === null) return null;
  if (dm && dm[1] === 'tonight' && s && tm < 12 * 60 && !/[ap]\.?m|noon|midnight/.test(s)) tm += 12 * 60;
  const base = day || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(tm / 60), tm % 60, 0, 0);
  /* a bare time that has already gone today means the next one */
  /* and so does "friday at 9" said on a Friday afternoon: next Friday */
  if (dm && !/^(?:today|tonight|tomorrow|\d)/.test(dm[1]) && at.getTime() <= now.getTime()) at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 7, at.getHours(), at.getMinutes());
  if (!dayWord && at.getTime() <= now.getTime()) at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, at.getHours(), at.getMinutes());
  return { at, dayWord, defaultedTime: dayWord && !s.length };
}

/** "remind me at 4pm to hand in the essay", "remind me to call mum tomorrow at 9" ->
    { kind: 'remind-at', at: Date, text } or null. A "in 20 min" line is parse()'s. */
export function parseAt(raw, now = new Date()) {
  const q = String(raw || '').trim().replace(/\s+/g, ' ');
  let m = q.match(/^remind\s+me\s+(?:on\s+|at\s+|by\s+)?(.+?)\s+(?:to|about|that)\s+(.+)$/i);
  if (m && !/^in\s/i.test(m[1])) {
    const when = parseMoment(m[1], now);
    if (when && m[2].trim()) return { kind: 'remind-at', at: when.at, text: m[2].trim() };
  }
  m = q.match(/^remind\s+me\s+(?:to|about|that)\s+(.+?)\s+((?:at|on|by|tomorrow|today|tonight|next|this)\s.+|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*)$/i);
  if (m) {
    const when = parseMoment(m[2], now);
    if (when && m[1].trim()) return { kind: 'remind-at', at: when.at, text: m[1].trim() };
  }
  return null;
}

export default { parse, parseAt, parseMoment, parseClock, parseDay, parseDuration, say, ymdOf, MAX_SECONDS };
