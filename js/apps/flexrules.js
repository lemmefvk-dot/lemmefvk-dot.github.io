/* ============================================================
   apps/flexrules.js — Flex Battle without a screen: the messages a
   room may carry (every one validated), the prompt for the picture
   judge, how its reply is read, and how the totals are added up.
   Pure: no DOM, no network.

   WHAT THE AI DOES. It looks at one still photo of an item and GUESSES
   what it is and a rough price range in US dollars, with a confidence.
   A photo can't prove something is real, so nothing here is ever
   "verified" and a price is never a single exact number: the judge is
   asked for a range, and a reply with one number is widened to a range.
   Only items are rated. If the model says the main subject is a
   person, face, body, document, screen, weapon, drugs, alcohol or
   money, the round is skipped and nothing is scored.

   TOTALS are the AI's guesses added up (low ends, high ends); the
   winner is whoever's midpoints add up higher, "by the AI's guesses".
   ============================================================ */
import { cleanText } from '../core/roomcode.js';
import { checkSig } from '../core/avlink.js';

export const ROUNDS = 3;
export const CHAT_MAX = 300;
export const MAX_USD = 1000000;
export const WHAT_MAX = 80;
export const CONF = ['low', 'medium', 'high'];
export const NOT_ITEMS = ['person', 'face', 'body', 'document', 'screen', 'weapon', 'drugs', 'alcohol', 'money'];
export const GUESS_LINE = 'A photo can’t prove something is real; this is a guess for fun.';

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const BANNED_WORDS = /\b(verified|authenticated|authentic|certified|appraised)\b/gi;

/** a guess as it is shown and sent: { k:'ok', what, lo, hi, cf } | { k:'skip' } | { k:'pass' } */
export function cleanVerdict(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.k === 'skip' || m.k === 'pass') return { k: m.k };
  if (m.k !== 'ok') return null;
  const what = cleanText(typeof m.what === 'string' ? m.what : '', WHAT_MAX).replace(BANNED_WORDS, '…');
  if (!what || !int(m.lo, 0, MAX_USD) || !int(m.hi, 0, MAX_USD) || m.lo > m.hi || m.lo === m.hi || !CONF.includes(m.cf)) return null;
  return { k: 'ok', what, lo: m.lo, hi: m.hi, cf: m.cf };
}

/** Message types a Flex Battle room accepts. Each returns a cleaned copy or null. */
export const TYPES = {
  chat: m => { const tx = cleanText(m.tx, CHAT_MAX); return tx ? { tx } : null; },
  msig: checkSig,
  av: m => (int(m.cam, 0, 2) && int(m.mic, 0, 2) ? { cam: m.cam, mic: m.mic } : null),
  go: () => ({}),                                              /* the host starts the match */
  fx: m => (int(m.r, 1, ROUNDS) ? { r: m.r } : null),         /* "I have sent my photo to the AI" (the friend looks at their video of it) */
  vd: m => { const v = cleanVerdict(m); return v && int(m.r, 1, ROUNDS) ? { r: m.r, ...v } : null; },
  end: () => ({}),                                             /* either player ends the match */
  rm: () => ({}),                                              /* a rematch, when both ask */
};

/* ---------------------------- the judge ---------------------------- */
export function judgeMessages(dataUrl) {
  const system = `You look at ONE photo from a friendly game in which two friends show off an item they own. Describe only the main object.
Reply with ONLY one JSON object: {"subject":"item","what":"short name of the object","low":number,"high":number,"confidence":"low"|"medium"|"high"}
- "subject" is what the main subject of the photo is: "item" for an ordinary object, otherwise one of "person", "face", "body", "document", "screen", "weapon", "drugs", "alcohol", "money". If it is not an item, put 0 for low and high and "" for what, and do not describe it.
- "what" names the object in under 80 characters (for example "red electric guitar"). Never describe, name or comment on any person, any part of a body, clothes being worn, or any place.
- "low" and "high" are your rough guess of what this kind of item typically sells for second-hand, in whole US dollars, as a RANGE (high above low). You cannot verify that it is real, new, original or what its condition is, so keep the range honest and wide when unsure.
- "confidence" is how sure you are about what it is and its range: "low" unless it is a common, clearly visible, easy-to-identify object.
Keep it PG. Never claim anything is authentic or verified. No other text.`;
  return [{ role: 'system', content: system }, { role: 'user', content: [
    { type: 'text', text: 'Here is the photo. Reply with the JSON only.' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ] }];
}

/** The model's reply as a guess, { k:'skip' } for a non-item, or null when it can't be read. */
export function parseJudge(text) {
  const s = String(text || '');
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  let o;
  try { o = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const subject = String(o.subject || 'item').toLowerCase().trim();
  if (subject !== 'item') return NOT_ITEMS.includes(subject) ? { k: 'skip' } : null;
  let lo = Math.round(Number(o.low)), hi = Math.round(Number(o.high));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  lo = Math.max(0, Math.min(MAX_USD - 1, lo)); hi = Math.max(0, Math.min(MAX_USD, hi));
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) { lo = Math.floor(lo * 0.8); hi = Math.max(lo + 1, Math.ceil(hi * 1.2)); }
  const cf = CONF.includes(String(o.confidence).toLowerCase()) ? String(o.confidence).toLowerCase() : 'low';
  return cleanVerdict({ k: 'ok', what: o.what, lo, hi, cf });
}

/* ---------------------------- totals ---------------------------- */
/** the AI's guesses added up: low ends, high ends, and the midpoint the winner is decided by */
export function totals(list) {
  let lo = 0, hi = 0, n = 0;
  for (const v of list) if (v && v.k === 'ok') { lo += v.lo; hi += v.hi; n++; }
  return { lo, hi, n, mid: (lo + hi) / 2 };
}
/** 'me' | 'them' | 'tie' by the AI's guesses */
export function winner(mine, theirs) {
  const a = totals(mine).mid, b = totals(theirs).mid;
  return a === b ? 'tie' : a > b ? 'me' : 'them';
}
export const usd = n => '$' + Math.round(n).toLocaleString('en-US');
export const range = (lo, hi) => `${usd(lo)}–${usd(hi)}`;

export default { TYPES, judgeMessages, parseJudge, totals, winner, cleanVerdict, range, usd, ROUNDS };
