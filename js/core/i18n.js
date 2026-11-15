/* ============================================================
   i18n.js — StaticOS in more than one language.

     t('Open a file')                 → the person's language, or English
     t('Hello, {name}', { name })     → {name}-style placeholders
     plural(n, '{n} file', '{n} files')
     lang()      'en' | 'es'          locale()   'en-US' | 'es-419' (for Intl)
     num(n) · date(d, opts) · time(d, opts)  Intl, in that locale
     setLang('es')                    saves it (per person) and says so on the bus

   gettext-style: the English text IS the key, so English needs no file and
   a string nobody has translated shows as English — never a key, never
   blank. Spanish lives in data/i18n/es.json, fetched only when Spanish is
   the language: this module waits for it (top-level await) so nothing that
   imports it ever draws before the words are there, and English start-ups
   fetch nothing extra.

   The language is prefs.lang ('en' | 'es', saved with the person's other
   settings through store → profiles.js). Until they choose, the browser's
   language decides ('es-MX' → Spanish). Strings are wrapped at their source
   with t(); there is no text scanner. The words are baked into the page as
   it is built, so changing the language reloads the page (Settings does
   that); bus.on('lang:change') fires first for anything that can redraw
   itself instead.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const LANGS = [
  { id: 'en', name: 'English', locale: 'en-US' },
  { id: 'es', name: 'Español', locale: 'es-419' },
];
const KNOWN = LANGS.map(l => l.id);

/* what the browser asks for, as one of ours: 'es-MX' → 'es', anything else → 'en' */
export function browserLang() {
  const list = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  for (const l of list) {
    const base = String(l || '').slice(0, 2).toLowerCase();
    if (KNOWN.includes(base)) return base;
  }
  return 'en';
}

/* what the person picked, or null while they have not */
export function chosen() {
  let v = null;
  try { v = store.get('prefs.lang'); } catch (e) { /* store not ready */ }
  return KNOWN.includes(v) ? v : null;
}

let current = chosen() || browserLang();
let dict = {};

async function load(id) {
  if (id === 'en') return {};
  try {
    const res = await fetch(new URL(`../../data/i18n/${id}.json`, import.meta.url));
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (e) {
    /* offline without a copy, or the file is missing: English, never a blank screen */
    console.warn('[i18n] could not load', id, e);
    current = 'en';
    return {};
  }
}
dict = await load(current);
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const lang = () => current;
export const locale = () => (LANGS.find(l => l.id === current) || LANGS[0]).locale;
export const isEnglish = () => current === 'en';

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

/** The text in the person's language. `english` is also the fallback. */
export function t(english, vars) {
  const v = current === 'en' ? undefined : dict[english];
  return fill(typeof v === 'string' && v ? v : english, vars);
}

/** "1 file" / "3 files": `{n}` is filled in. Spanish entries are keyed by the
    plural English text and hold { one, other } (es.json). */
export function plural(n, one, other, vars) {
  const v = { ...(vars || {}), n: num(n) };
  if (current !== 'en') {
    const e = dict[other];
    if (e && typeof e === 'object') {
      const form = new Intl.PluralRules(locale()).select(n);
      const s = e[form] || e.other;
      if (typeof s === 'string' && s) return fill(s, v);
    }
  }
  return fill(n === 1 ? one : other, v);
}

/** does the current language have this string? (the tests and tools/i18n-coverage.mjs ask) */
export const has = english => current === 'en' || (english in dict);
export const size = () => Object.keys(dict).filter(k => k[0] !== '_').length;

export const num = (n, opts) => new Intl.NumberFormat(locale(), opts).format(n);
export const date = (d, opts) => new Intl.DateTimeFormat(locale(), opts || { dateStyle: 'medium' }).format(d instanceof Date ? d : new Date(d));
export const time = (d, opts) => new Intl.DateTimeFormat(locale(), opts || { timeStyle: 'short' }).format(d instanceof Date ? d : new Date(d));
export const list = items => new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items);

/** Save the language. The page reads it at start-up, so callers reload after
    (Settings does); anything that can redraw itself listens for 'lang:change'. */
export function setLang(id) {
  if (!KNOWN.includes(id)) return false;
  store.set('prefs.lang', id);
  if (typeof document !== 'undefined') document.documentElement.lang = id;
  bus.emit('lang:change', id);
  return true;
}

export default { t, plural, lang, locale, num, date, time, list, setLang, LANGS, has };
