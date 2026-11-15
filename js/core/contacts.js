/* ============================================================
   contacts.js (core) — Static Contacts' address book: its shape, the
   checks every value goes through, search, and vCard in and out.

   store('portal.contacts') =
     { v: 1, contacts: [{ id, name, company, title, phones:[{label,value}], emails:[{label,value}],
         address, notes, photo, groups:[name], birthday, remind, favourite, friend,
         created, updated }],
       apart: [[id, id]] }

     birthday   'YYYY-MM-DD', or '--MM-DD' when the year isn't known, or ''
     remind     days before the birthday its reminder goes off (0, 1 or 7, at
                9 AM), or null for none — only ever set when the person asks;
                handed to the Automations reminder engine (src 'contacts') on
                every save, and topped up each new day by init() (main.js)
     favourite  true when starred
     friend     { fp, name } — a Static Social friend this card is linked to,
                only ever one the person picked from their own friends list
     apart      pairs the person said are two different people, so Find
                duplicates doesn't offer them again

   It lives on this device and nowhere else: nothing here (or in the app)
   touches the network, and it never reads the computer's own contacts.

   Everything that comes in — the store, a typed field, a .vcf file — is
   untrusted text. Values are cut to a length, stripped of control
   characters, and only ever drawn as text. The only links the app makes
   are tel: and mailto:, and only from a phone number or an email address
   that passed phoneOk() / emailOk(), so a value can never turn into a
   javascript: or any other link. There is no CSV: a spreadsheet would
   run a cell that starts with = + - @, and a vCard has no such risk.

   vCard 3.0 out (RFC 2426 escaping, CRLF lines, folded at 75). In, any
   vCard 2.1–4.0 text up to MAX_IMPORT_BYTES with up to MAX_CONTACTS cards:
   names, company and job title, phone numbers, emails, one address, a
   birthday, notes and categories are read; pictures and everything else
   are ignored, never decoded. A MECARD (the short form many QR codes
   use) is read by parseMeCard().

   Duplicates are only ever suggested (duplicates()); merge() makes the
   one card the person chose field by field, and nothing merges by itself.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as AM from './automations.js';

export const STORE_KEY = 'portal.contacts';
export const SRC = 'contacts';            /* the `src` its birthday reminders carry in Automations */
export const MAX_CONTACTS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const LIMITS = { name: 100, company: 120, title: 120, label: 20, phone: 30, email: 254, address: 300, notes: 2000, group: 30, perKind: 10, groups: 10, photo: 300, apart: 500 };
/** How far ahead a birthday reminder can be set: on the day, the day before, a week before. */
export const REMIND_DAYS = [0, 1, 7];
export const REMIND_TIME = '09:00';
export const RECENT_DAYS = 30;
export const PHONE_LABELS = ['mobile', 'home', 'work', 'other'];
export const EMAIL_LABELS = ['home', 'work', 'other'];

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** Text only: control and bidi-override characters out, trimmed, cut to `max`. `multi` keeps newlines. */
export function clean(v, max, multi = false) {
  let s = String(v ?? '').replace(/\r\n?/g, '\n').replace(CTRL, '');
  if (!multi) s = s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}
export const uid = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ---- validation ---- */
export const phoneOk = v => {
  const s = String(v || '').trim();
  return s.length <= LIMITS.phone && /^\+?[0-9][0-9 ()\-.]*$/.test(s) && s.replace(/\D/g, '').length >= 3 && s.replace(/\D/g, '').length <= 15;
};
const EMAIL_PART = /^[^\s@<>"',;:()[\]\\]+$/;
export const emailOk = v => {
  const s = String(v || '').trim();
  if (s.length > LIMITS.email) return false;
  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return false;
  const local = s.slice(0, at), domain = s.slice(at + 1);
  return EMAIL_PART.test(local) && EMAIL_PART.test(domain) && /^[^.].*\.[^.]{2,}$/.test(domain) && !domain.endsWith('.') && !domain.includes('..');
};
/** tel: link for a valid phone number, else null. Digits only (and a leading +). */
export const telHref = v => (phoneOk(v) ? `tel:${String(v).trim().startsWith('+') ? '+' : ''}${String(v).replace(/\D/g, '')}` : null);
/** mailto: link for a valid address, else null. */
export const mailHref = v => (emailOk(v) ? `mailto:${encodeURI(String(v).trim())}` : null);
/** A picture is a path inside the person's own files, nothing else. */
export const photoOk = p => typeof p === 'string' && p.length <= LIMITS.photo && /^\/home\/[^/]+\/(?:[^/]+\/)*[^/]+$/.test(p) && !p.split('/').includes('..') && !p.includes('\u0000')
  && /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(p);

/* ---- birthdays ---- */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** A birthday in any of the ways a person or a vCard writes one -> 'YYYY-MM-DD', '--MM-DD' or ''.
    1604 is the year Apple writes when it was left out; a year in the future, or before 1900, is no year. */
export function normBirthday(v) {
  const s = String(v ?? '').trim();
  let y = null, m, d;
  let r = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(s);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^--(\d{2})-?(\d{2})$/.exec(s))) { m = +r[1]; d = +r[2]; }
  else return '';
  if (y !== null && (y === 1604 || y < 1900 || y > new Date().getFullYear())) y = null;
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= daysIn(y || 2000, m))) return '';
  return y ? `${y}-${pad2(m)}-${pad2(d)}` : `--${pad2(m)}-${pad2(d)}`;
}
/** -> { y: number | null, m, d } of a normalised birthday, or null. */
export function birthdayParts(b) {
  const s = normBirthday(b);
  if (!s) return null;
  if (s.startsWith('--')) return { y: null, m: +s.slice(2, 4), d: +s.slice(5, 7) };
  return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) };
}
/** The day a birthday falls on in year `y`. A 29 February birthday is kept on the 28th in other years. */
export function birthdayIn(b, y) {
  const p = birthdayParts(b);
  if (!p) return '';
  const d = Math.min(p.d, daysIn(y, p.m));
  return `${y}-${pad2(p.m)}-${pad2(d)}`;
}
/** The next time the birthday comes round, on or after `from` ('YYYY-MM-DD', default today). */
export function nextBirthday(b, from = ymd(new Date())) {
  const y = +from.slice(0, 4);
  const a = birthdayIn(b, y);
  if (!a) return '';
  return a >= from ? a : birthdayIn(b, y + 1);
}
/** How old they turn on `day` (a birthday of theirs), when the year is known; else null. */
export function turns(b, day) {
  const p = birthdayParts(b);
  if (!p || !p.y || !day) return null;
  const n = +day.slice(0, 4) - p.y;
  return n > 0 ? n : null;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_NAMES = MONTHS;
/** "4 March 1990"-style words, written month first: "March 4, 1990" / "March 4". */
export function birthdayText(b) {
  const p = birthdayParts(b);
  if (!p) return '';
  return `${MONTHS[p.m - 1]} ${p.d}${p.y ? `, ${p.y}` : ''}`;
}

/* ---- shape guards ---- */
const normValues = (arr, labels, ok, max) => (Array.isArray(arr) ? arr : []).map(x => {
  const o = x && typeof x === 'object' ? x : { value: x };
  const value = clean(o.value, max);
  const label = labels.includes(o.label) ? o.label : 'other';
  return ok(value) ? { label, value } : null;
}).filter(Boolean).slice(0, LIMITS.perKind);
const normFriend = f => {
  if (!f || typeof f !== 'object') return null;
  const fp = clean(f.fp, 80);
  return /^[A-Za-z0-9_+/=-]{6,80}$/.test(fp) ? { fp, name: clean(f.name, 40) || 'Friend' } : null;
};
export function normContact(c) {
  const o = c && typeof c === 'object' ? c : {};
  const groups = [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clean(g, LIMITS.group)).filter(Boolean))].slice(0, LIMITS.groups);
  const birthday = normBirthday(o.birthday);
  return {
    id: clean(o.id, 60) || uid(),
    name: clean(o.name, LIMITS.name),
    company: clean(o.company, LIMITS.company),
    title: clean(o.title, LIMITS.title),
    phones: normValues(o.phones, PHONE_LABELS, phoneOk, LIMITS.phone),
    emails: normValues(o.emails, EMAIL_LABELS, emailOk, LIMITS.email),
    address: clean(o.address, LIMITS.address, true),
    notes: clean(o.notes, LIMITS.notes, true),
    photo: photoOk(o.photo) ? o.photo : '',
    groups,
    birthday,
    remind: birthday && REMIND_DAYS.includes(o.remind) ? o.remind : null,
    favourite: o.favourite === true,
    friend: normFriend(o.friend),
    created: Number(o.created) || Date.now(),
    updated: Number(o.updated) || Number(o.created) || Date.now(),
  };
}
export function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const contacts = [];
  for (const c of Array.isArray(d.contacts) ? d.contacts : []) {
    const n = normContact(c);
    if (seen.has(n.id)) n.id = uid();
    seen.add(n.id);
    contacts.push(n);
    if (contacts.length >= MAX_CONTACTS) break;
  }
  /* "these two are different people": only pairs of contacts that still exist */
  const apart = (Array.isArray(d.apart) ? d.apart : [])
    .filter(p => Array.isArray(p) && p.length === 2 && seen.has(p[0]) && seen.has(p[1]) && p[0] !== p[1])
    .map(p => [String(p[0]), String(p[1])]).slice(-LIMITS.apart);
  return { v: 1, contacts, apart };
}
export const cloneContact = c => ({ ...c, phones: c.phones.map(p => ({ ...p })), emails: c.emails.map(e => ({ ...e })), groups: [...c.groups], friend: c.friend ? { ...c.friend } : null });
export const cloneData = d => ({ v: 1, contacts: d.contacts.map(cloneContact), apart: (d.apart || []).map(p => [...p]) });
export const read = () => normalize(store.get(STORE_KEY));
export function write(data) { const out = cloneData(normalize(data)); store.set(STORE_KEY, out); syncReminders(out); return out; }

/* ---- birthday reminders, through Automations' own engine ----
   One reminder per contact who asks, at 9 AM on the day (or the day or the
   week before), handed over as the coming days it goes off on ('dates'):
   this year's and next year's, so the list never runs dry, and init()
   hands them again each new day. */
/** What the reminder engine should hold for these contacts. */
export function reminderWants(data, now = Date.now()) {
  const today = ymd(new Date(now));
  const want = [];
  for (const c of data.contacts) {
    if (!c.birthday || c.remind === null) continue;
    const on = [];
    for (let y = +today.slice(0, 4) - 1; y <= +today.slice(0, 4) + 1 && on.length < 2; y++) {
      const b = birthdayIn(c.birthday, y);
      const t = new Date(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10) - c.remind);
      const k = ymd(t);
      if (k >= today) on.push(k);
    }
    if (!on.length) continue;
    const sub = c.remind === 0 ? 'Birthday today' : c.remind === 1 ? 'Birthday tomorrow' : 'Birthday in a week';
    want.push({ ref: c.id, text: `${display(c)}’s birthday`, sub, time: REMIND_TIME, repeat: 'dates', on });
  }
  return want;
}
let lastSync = {};
/** Bring Automations' reminders in line. -> { [contactId]: 'set' | 'passed' | 'full' } */
export function syncReminders(data = read(), now = Date.now()) {
  try { lastSync = AM.syncSourceReminders(SRC, reminderWants(data, now), now); }
  catch (err) { console.error('[contacts] reminders', err); lastSync = {}; }
  return lastSync;
}
export const lastReminders = () => lastSync;
let watching = false;
let lastDay = '';
/** Once at start (main.js), and again each new day, so a birthday's next year is always handed over. */
export function init() {
  if (!watching) {
    watching = true;
    lastDay = ymd(new Date());
    bus.on('tick:5s', () => {
      const t = ymd(new Date());
      if (t === lastDay) return;
      lastDay = t;
      if (read().contacts.some(c => c.birthday && c.remind !== null)) syncReminders();
    });
  }
  const d = read();
  if (d.contacts.some(c => c.birthday && c.remind !== null)) syncReminders(d);
}

/* ---- favourites and recently added ---- */
export const favourites = contacts => contacts.filter(c => c.favourite);
/** Added in the last RECENT_DAYS days, newest first. */
export const recentlyAdded = (contacts, now = Date.now()) => contacts.filter(c => now - c.created < RECENT_DAYS * 86400000).sort((a, b) => b.created - a.created);

/** What is wrong with a contact being saved: [] when it is fine. Every item blocks saving. */
export function problems(c) {
  const out = [];
  if (!clean(c.name, LIMITS.name) && !(c.phones || []).length && !(c.emails || []).length) out.push('Give the contact a name, a phone number or an email address.');
  (c.phones || []).forEach((p, i) => { if (!phoneOk(clean(p.value, LIMITS.phone))) out.push(`Phone number ${i + 1} (“${clean(p.value, 20)}”) isn’t a valid number. Use digits, spaces, + ( ) - and .`); });
  (c.emails || []).forEach((e, i) => { if (!emailOk(clean(e.value, LIMITS.email))) out.push(`Email ${i + 1} (“${clean(e.value, 30)}”) isn’t a valid address.`); });
  return out;
}
/** The name to show: the name, else the first phone or email, else “No name”. */
export const display = c => c.name || (c.phones[0] && c.phones[0].value) || (c.emails[0] && c.emails[0].value) || 'No name';
export const initials = c => {
  const w = display(c).replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

/* ---- search ---- */
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Every word typed must be found in the name, the company or job title, a number (digits only
    when the word is digits), an email, the address, the notes or a group. */
export function matches(c, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([c.name, c.company || '', c.title || '', ...c.emails.map(e => e.value), c.address, c.notes, ...c.groups].join('\n'));
  const digits = c.phones.map(p => p.value.replace(/\D/g, '')).join('\n');
  const phoneText = fold(c.phones.map(p => p.value).join('\n'));
  return words.every(w => hay.includes(w) || phoneText.includes(w) || (/^\+?\d+$/.test(w) && digits.includes(w.replace(/\D/g, ''))));
}
export const sortKey = c => fold(display(c));
export const byName = (a, b) => sortKey(a).localeCompare(sortKey(b)) || a.created - b.created;
export const groupNames = contacts => [...new Set(contacts.flatMap(c => c.groups))].sort((a, b) => fold(a).localeCompare(fold(b)));
/** "Teacher at Hill School", "Hill School", "Teacher", or ''. */
export const workLine = c => (c.title && c.company ? `${c.title} at ${c.company}` : c.title || c.company || '');

/* ---- duplicates: suggested, never merged by themselves ---- */
const digitsOf = v => String(v).replace(/\D/g, '');
/**
 * Pairs of cards that look like the same person: the same name, a phone number
 * in common (its last 7+ digits) or an email address in common. Pairs the
 * person said are different people (data.apart) are left out.
 * -> [{ a, b, why: ['the same name', …] }]
 */
export function duplicates(data) {
  const list = data.contacts;
  const apart = new Set((data.apart || []).map(p => [...p].sort().join('|')));
  const out = [];
  const nameKey = c => (c.name ? fold(c.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '');
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (apart.has([a.id, b.id].sort().join('|'))) continue;
      const why = [];
      if (nameKey(a) && nameKey(a) === nameKey(b)) why.push('the same name');
      const pa = new Set(a.phones.map(p => digitsOf(p.value)).filter(d => d.length >= 7).map(d => d.slice(-9)));
      if (b.phones.some(p => digitsOf(p.value).length >= 7 && pa.has(digitsOf(p.value).slice(-9)))) why.push('a phone number in common');
      const ea = new Set(a.emails.map(e => e.value.toLowerCase()));
      if (b.emails.some(e => ea.has(e.value.toLowerCase()))) why.push('an email address in common');
      if (why.length) out.push({ a, b, why });
      if (out.length >= 200) return out;
    }
  }
  return out;
}
/** The fields a merge asks about when the two cards differ: [key, label]. */
export const MERGE_FIELDS = [['name', 'Name'], ['company', 'Company'], ['title', 'Job title'], ['birthday', 'Birthday'], ['address', 'Address'], ['photo', 'Picture'], ['notes', 'Notes']];
/**
 * One card from two, as the person chose: `pick` says for each of MERGE_FIELDS
 * which card's value is kept ('a' or 'b'; notes may also be 'both'). Phone
 * numbers, emails and groups from both are kept, without repeats. The merged
 * card keeps a's id and the earlier "added" day.
 */
export function merge(a, b, pick = {}) {
  const from = k => (pick[k] === 'b' ? b[k] : pick[k] === 'a' ? a[k] : a[k] || b[k]);
  const notes = pick.notes === 'both' && a.notes && b.notes && a.notes !== b.notes ? `${a.notes}\n\n${b.notes}` : from('notes');
  const uniq = (xs, key) => { const seen = new Set(); return xs.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const birthday = from('birthday');
  return normContact({
    id: a.id,
    name: from('name'), company: from('company'), title: from('title'), address: from('address'), photo: from('photo'), notes, birthday,
    /* the same number written two ways (+1 555 010 9999, 555-010-9999) is kept once */
    phones: uniq([...a.phones, ...b.phones], p => { const d = digitsOf(p.value); return d.length >= 7 ? d.slice(-9) : d; }).slice(0, LIMITS.perKind),
    emails: uniq([...a.emails, ...b.emails], e => e.value.toLowerCase()).slice(0, LIMITS.perKind),
    groups: [...a.groups, ...b.groups],
    remind: birthday === a.birthday ? (a.remind ?? (birthday === b.birthday ? b.remind : null)) : b.remind,
    favourite: a.favourite || b.favourite,
    friend: a.friend || b.friend,
    created: Math.min(a.created, b.created),
    updated: Date.now(),
  });
}

/* ---- vCard out ---- */
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold75(line) {
  /* fold on characters, 75 per line, continuation lines start with one space */
  const chars = [...line];
  if (chars.length <= 75) return line;
  const out = [chars.slice(0, 75).join('')];
  for (let i = 75; i < chars.length; i += 74) out.push(' ' + chars.slice(i, i + 74).join(''));
  return out.join('\r\n');
}
/** One vCard. `leave` names what to leave out of it (a QR code leaves out the notes). */
export function toVCard(c, { leave = [] } = {}) {
  const parts = c.name.split(' ');
  const family = parts.length > 1 ? parts[parts.length - 1] : '';
  const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : c.name;
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(display(c))}`, `N:${esc(family)};${esc(given)};;;`];
  if (c.company) L.push(`ORG:${esc(c.company)}`);
  if (c.title) L.push(`TITLE:${esc(c.title)}`);
  for (const p of c.phones) L.push(`TEL;TYPE=${p.label === 'mobile' ? 'CELL' : p.label.toUpperCase()}:${esc(p.value)}`);
  for (const e of c.emails) L.push(`EMAIL;TYPE=${e.label.toUpperCase()}:${esc(e.value)}`);
  if (c.address && !leave.includes('address')) L.push(`ADR;TYPE=HOME:;;${esc(c.address)};;;;`);
  if (c.birthday && !leave.includes('birthday')) L.push(`BDAY:${c.birthday}`);
  if (c.notes && !leave.includes('notes')) L.push(`NOTE:${esc(c.notes)}`);
  if (c.groups.length && !leave.includes('groups')) L.push(`CATEGORIES:${c.groups.map(esc).join(',')}`);
  L.push('END:VCARD');
  return L.map(fold75).join('\r\n') + '\r\n';
}
export const toVCards = contacts => contacts.map(toVCard).join('');

/* ---- vCard in ---- */
const unesc = s => String(s).replace(/\\([nN,;\\])/g, (m, ch) => (ch === 'n' || ch === 'N' ? '\n' : ch));
/** Split on `sep` where it isn't escaped with a backslash. */
const splitEsc = (s, sep) => { const out = []; let cur = ''; for (let i = 0; i < s.length; i++) { if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; } else if (s[i] === sep) { out.push(cur); cur = ''; } else cur += s[i]; } out.push(cur); return out; };
/**
 * Read vCard text. -> { contacts: [normalized, new ids], skipped: [reason…], tooBig?: true }
 * Pictures, sounds, keys and every property not listed in the header are ignored.
 */
export function parseVCards(text, { maxBytes = MAX_IMPORT_BYTES, max = MAX_CONTACTS } = {}) {
  const src = String(text || '');
  if (src.length > maxBytes) return { contacts: [], skipped: [`That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than an address book needs.`], tooBig: true };
  /* unfold: a line that starts with a space or tab continues the one before */
  const lines = src.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const contacts = [];
  const skipped = [];
  let cur = null;
  let cards = 0;
  for (const raw of lines) {
    const line = raw.replace(CTRL, '');
    if (/^BEGIN:VCARD$/i.test(line.trim())) { cur = { name: '', n: '', company: '', title: '', birthday: '', phones: [], emails: [], address: '', notes: '', groups: [] }; continue; }
    if (/^END:VCARD$/i.test(line.trim())) {
      if (cur) {
        cards++;
        const name = cur.name || cur.n;
        const c = normContact({ name, company: cur.company, title: cur.title, birthday: cur.birthday, phones: cur.phones, emails: cur.emails, address: cur.address, notes: cur.notes, groups: cur.groups });
        if (!c.name && !c.phones.length && !c.emails.length) skipped.push(`Card ${cards} had no name, phone number or email address that could be used.`);
        else if (contacts.length >= max) { skipped.push(`Stopped at ${max} contacts.`); cur = null; break; }
        else contacts.push(c);
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const head = line.slice(0, colon), val = line.slice(colon + 1);
    const segs = head.split(';');
    const prop = segs[0].replace(/^[^.]*\./, '').toUpperCase();       /* drop an "item1." group prefix */
    const types = segs.slice(1).join(';').toUpperCase();
    if (prop === 'FN') cur.name = unesc(val);
    else if (prop === 'N') { const p = splitEsc(val, ';').map(unesc); cur.n = [p[3], p[1], p[2], p[0]].filter(Boolean).join(' ').replace(/\s+/g, ' '); }
    else if (prop === 'TEL') cur.phones.push({ label: /CELL|MOBILE/.test(types) ? 'mobile' : /HOME/.test(types) ? 'home' : /WORK/.test(types) ? 'work' : 'other', value: unesc(val).replace(/^tel:/i, '') });
    else if (prop === 'EMAIL') cur.emails.push({ label: /HOME/.test(types) ? 'home' : /WORK/.test(types) ? 'work' : 'other', value: unesc(val).replace(/^mailto:/i, '') });
    else if (prop === 'ADR' && !cur.address) cur.address = splitEsc(val, ';').map(unesc).map(s => s.trim()).filter(Boolean).join('\n');
    else if (prop === 'NOTE') cur.notes = unesc(val);
    else if (prop === 'CATEGORIES') cur.groups.push(...splitEsc(val, ',').map(unesc));
    else if (prop === 'ORG' && !cur.company) cur.company = splitEsc(val, ';').map(unesc).map(s => s.trim()).filter(Boolean).join(', ');
    else if (prop === 'TITLE' && !cur.title) cur.title = unesc(val);
    else if (prop === 'BDAY' && !cur.birthday) cur.birthday = val.trim();
  }
  if (cur) skipped.push('The last card was never closed with END:VCARD, so it was left out.');
  if (!contacts.length && !skipped.length) skipped.push('No contacts were found in that file. A vCard file starts with BEGIN:VCARD.');
  return { contacts, skipped };
}

/* ---- MECARD in: MECARD:N:Lovelace,Ada;TEL:+15550102030;EMAIL:ada@example.com;; ---- */
/** -> a normalized contact (new id), or null when there is nothing usable in it. */
export function parseMeCard(text) {
  const src = String(text || '').replace(CTRL, '').trim();
  if (!/^MECARD:/i.test(src) || src.length > 4000) return null;
  const o = { name: '', company: '', title: '', birthday: '', phones: [], emails: [], address: '', notes: '' };
  for (const part of splitEsc(src.slice(7), ';')) {
    const at = part.indexOf(':');
    if (at < 1) continue;
    const k = part.slice(0, at).toUpperCase(), v = part.slice(at + 1).replace(/\\([\\;,:])/g, '$1');
    if (k === 'N' && !o.name) { const [last, first] = v.split(','); o.name = [first, last].filter(s => s && s.trim()).join(' '); }
    else if (k === 'TEL') o.phones.push({ label: 'mobile', value: v });
    else if (k === 'EMAIL') o.emails.push({ label: 'other', value: v });
    else if (k === 'ADR' && !o.address) o.address = v;
    else if (k === 'NOTE' && !o.notes) o.notes = v;
    else if (k === 'BDAY' && !o.birthday) o.birthday = v;
    else if (k === 'ORG' && !o.company) o.company = v;
  }
  const c = normContact(o);
  return c.name || c.phones.length || c.emails.length ? c : null;
}

/** A contact that is already in the book under the same name with the same first number or email. */
export function findSame(data, c) {
  const key = x => `${fold(x.name)}|${x.phones[0] ? digitsOf(x.phones[0].value) : ''}|${x.emails[0] ? x.emails[0].value.toLowerCase() : ''}`;
  const k = key(c);
  return data.contacts.find(x => key(x) === k) || null;
}

export default {
  STORE_KEY, SRC, MAX_CONTACTS, MAX_IMPORT_BYTES, LIMITS, REMIND_DAYS, clean, uid, phoneOk, emailOk, telHref, mailHref, photoOk, normContact, normalize,
  cloneData, cloneContact, read, write, problems, display, initials, matches, byName, groupNames, workLine, toVCard, toVCards, parseVCards, parseMeCard,
  findSame, normBirthday, birthdayParts, birthdayIn, nextBirthday, turns, birthdayText, reminderWants, syncReminders, lastReminders, init,
  favourites, recentlyAdded, duplicates, merge, MERGE_FIELDS,
};
