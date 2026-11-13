/* ============================================================
   contacts.js (core) — Static Contacts' address book: its shape, the
   checks every value goes through, search, and vCard in and out.

   store('portal.contacts') =
     { v: 1, contacts: [{ id, name, phones:[{label,value}], emails:[{label,value}],
         address, notes, photo, groups:[name], created, updated }] }

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
   names, phone numbers, emails, one address, notes and categories are
   read; pictures and everything else are ignored, never decoded.
   ============================================================ */
import { store } from './store.js';

export const STORE_KEY = 'portal.contacts';
export const MAX_CONTACTS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const LIMITS = { name: 100, label: 20, phone: 30, email: 254, address: 300, notes: 2000, group: 30, perKind: 10, groups: 10, photo: 300 };
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

/* ---- shape guards ---- */
const normValues = (arr, labels, ok, max) => (Array.isArray(arr) ? arr : []).map(x => {
  const o = x && typeof x === 'object' ? x : { value: x };
  const value = clean(o.value, max);
  const label = labels.includes(o.label) ? o.label : 'other';
  return ok(value) ? { label, value } : null;
}).filter(Boolean).slice(0, LIMITS.perKind);
export function normContact(c) {
  const o = c && typeof c === 'object' ? c : {};
  const groups = [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clean(g, LIMITS.group)).filter(Boolean))].slice(0, LIMITS.groups);
  return {
    id: clean(o.id, 60) || uid(),
    name: clean(o.name, LIMITS.name),
    phones: normValues(o.phones, PHONE_LABELS, phoneOk, LIMITS.phone),
    emails: normValues(o.emails, EMAIL_LABELS, emailOk, LIMITS.email),
    address: clean(o.address, LIMITS.address, true),
    notes: clean(o.notes, LIMITS.notes, true),
    photo: photoOk(o.photo) ? o.photo : '',
    groups,
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
  return { v: 1, contacts };
}
export const cloneData = d => ({ v: 1, contacts: d.contacts.map(c => ({ ...c, phones: c.phones.map(p => ({ ...p })), emails: c.emails.map(e => ({ ...e })), groups: [...c.groups] })) });
export const read = () => normalize(store.get(STORE_KEY));
export function write(data) { const out = cloneData(normalize(data)); store.set(STORE_KEY, out); return out; }

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
/** Every word typed must be found in the name, a number (digits only when the word is digits),
    an email, the address, the notes or a group. */
export function matches(c, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([c.name, ...c.emails.map(e => e.value), c.address, c.notes, ...c.groups].join('\n'));
  const digits = c.phones.map(p => p.value.replace(/\D/g, '')).join('\n');
  const phoneText = fold(c.phones.map(p => p.value).join('\n'));
  return words.every(w => hay.includes(w) || phoneText.includes(w) || (/^\+?\d+$/.test(w) && digits.includes(w.replace(/\D/g, ''))));
}
export const sortKey = c => fold(display(c));
export const byName = (a, b) => sortKey(a).localeCompare(sortKey(b)) || a.created - b.created;
export const groupNames = contacts => [...new Set(contacts.flatMap(c => c.groups))].sort((a, b) => fold(a).localeCompare(fold(b)));

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
export function toVCard(c) {
  const parts = c.name.split(' ');
  const family = parts.length > 1 ? parts[parts.length - 1] : '';
  const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : c.name;
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(display(c))}`, `N:${esc(family)};${esc(given)};;;`];
  for (const p of c.phones) L.push(`TEL;TYPE=${p.label === 'mobile' ? 'CELL' : p.label.toUpperCase()}:${esc(p.value)}`);
  for (const e of c.emails) L.push(`EMAIL;TYPE=${e.label.toUpperCase()}:${esc(e.value)}`);
  if (c.address) L.push(`ADR;TYPE=HOME:;;${esc(c.address)};;;;`);
  if (c.notes) L.push(`NOTE:${esc(c.notes)}`);
  if (c.groups.length) L.push(`CATEGORIES:${c.groups.map(esc).join(',')}`);
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
    if (/^BEGIN:VCARD$/i.test(line.trim())) { cur = { name: '', n: '', phones: [], emails: [], address: '', notes: '', groups: [] }; continue; }
    if (/^END:VCARD$/i.test(line.trim())) {
      if (cur) {
        cards++;
        const name = cur.name || cur.n;
        const c = normContact({ name, phones: cur.phones, emails: cur.emails, address: cur.address, notes: cur.notes, groups: cur.groups });
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
  }
  if (cur) skipped.push('The last card was never closed with END:VCARD, so it was left out.');
  if (!contacts.length && !skipped.length) skipped.push('No contacts were found in that file. A vCard file starts with BEGIN:VCARD.');
  return { contacts, skipped };
}

export default { STORE_KEY, MAX_CONTACTS, MAX_IMPORT_BYTES, LIMITS, clean, uid, phoneOk, emailOk, telHref, mailHref, photoOk, normContact, normalize, cloneData, read, write, problems, display, initials, matches, byName, groupNames, toVCard, toVCards, parseVCards };
