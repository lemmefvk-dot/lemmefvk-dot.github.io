/* ============================================================
   apps/flexfilter.js — the "keep it playful" word filter for
   Flex Battle's chat.

   SCOPE. This is a small client-side guard, not a moderation system.
   It only looks for a short list of slurs and one self-harm taunt in
   what a player types in the chat: a message that contains one is not
   sent, and an incoming one is hidden. The photo judge only rates
   objects and skips anything else, and either player can end the match
   or leave at any time. It does not catch everything and does not
   pretend to.

   The terms are stored ROT13-encoded so this file does not itself
   spell them out. Matching is on whole words after folding case,
   accents, look-alike digits and symbols, and runs of repeated
   letters; single letters typed with gaps ("n i g ...") are joined.
   ============================================================ */
const rot = s => s.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97));

const WORDS = ['avttre', 'avttn', 'snttbg', 'ergneq', 'genaal', 'puvax', 'fcvp', 'xvxr', 'xlf'].map(rot);
const PHRASES = ['xvyy lbhefrys'].map(rot);
export const TERM_COUNT = WORDS.length + PHRASES.length;
/* the decoded list is deliberately not exported; tests reach one term through sample() */
export const sample = () => WORDS[0];

export const MESSAGE = 'Keep it playful: that word is not allowed here. Talk about the items instead.';

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

function tokens(text) {
  const folded = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[01345@$!7]/g, c => LEET[c] || c)
    .replace(/(.)\1{2,}/g, '$1$1');
  const raw = folded.split(/[^a-z]+/).filter(Boolean);
  /* letters typed one at a time ("n i g g e r") become one word */
  const out = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1) { run += t; continue; }
    if (run.length > 1) out.push(run);
    run = '';
    out.push(t);
  }
  if (run.length > 1) out.push(run);
  return { out, flat: raw.join(' ') };
}

/** true when the text contains a word on the list. */
export function blocked(text) {
  const { out, flat } = tokens(text);
  for (const t of out) for (const w of WORDS) if (t === w || t === w + 's' || t === w + 'z') return true;
  return PHRASES.some(p => flat.includes(p));
}

export default { blocked, MESSAGE, TERM_COUNT };
