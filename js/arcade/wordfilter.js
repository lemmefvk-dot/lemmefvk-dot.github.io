/* ============================================================
   arcade/wordfilter.js — which words the word games never use or
   accept. Static Arcade is played by students, so profanity, slurs,
   sexual slang and a few words that are simply not for a game are
   left out. Pure, no DOM: tools/build-wordlist.mjs strips them when
   the shipped word list is made, js/arcade/words.js applies the same
   test again after loading, and the tests keep a short list of
   known-bad words that must all be blocked.

   Matching is by whole word (never by substring, so "class" and
   "assistant" are fine): a root and its ordinary endings, a few
   roots that block anything starting with them, and a few that block
   anything ending in them ("bullshit"). Over-blocking a rare word is
   the cost; a bad word getting through is the failure.
   ============================================================ */

/* a root plus its usual endings */
const ROOTS = [
  'ass', 'asshole', 'arse', 'arsehole', 'bitch', 'bastard', 'bugger', 'bollock', 'crap', 'cunt', 'damn',
  'dickhead', 'dildo', 'douche', 'douchebag', 'dyke', 'fag', 'faggot', 'fagot', 'fuck', 'hooker', 'horny', 'jizz', 'kike',
  'molest', 'negro', 'negress', 'nigger', 'nigga', 'orgasm', 'paki', 'pedophile', 'pimp', 'piss', 'porn', 'prostitute',
  'rape', 'rapist', 'retard', 'semen', 'sex', 'shit', 'shite', 'slut', 'spaz', 'testicle', 'tranny',
  'turd', 'twat', 'wank', 'wanker', 'wetback', 'whore', 'wop', 'chink', 'gook', 'coon', 'dago', 'kraut', 'redskin', 'squaw',
  'midget', 'cripple', 'mongoloid', 'incest', 'brothel', 'bordello', 'suicide', 'suicidal', 'penis', 'vagina', 'vulva', 'scrotum',
  'clitoris', 'erection', 'erotic', 'anus', 'anal', 'nipple', 'masturbate', 'masturbation', 'ejaculate', 'genital', 'genitals',
  'dumbass', 'badass', 'smartass', 'fatass', 'jackass', 'kickass', 'asshat', 'jerkoff', 'handjob', 'blowjob', 'cocksucker',
  'bimbo', 'whorehouse', 'rimjob', 'skank', 'lesbo', 'homo', 'shemale', 'gypsy', 'gyp',
];
/* a bare word only, no endings made up for it */
const EXACT = ['poof', 'poofs', 'poofter', 'poofters', 'poon', 'poons', 'poo', 'poos', 'pooed', 'pooing', 'buttock', 'buttocks', 'rectum', 'rectums', 'rectal', 'pedophilia', 'pedophilic', 'orgasmic', 'orgasmically', 'sexpot', 'sexpots', 'sexless', 'peen', 'peens', 'knobs', 'spic', 'spics', 'spick', 'spicks', 'shag', 'shags', 'shagged', 'shagging', 'jap', 'japs', 'tit', 'tits', 'titty', 'titties', 'boob', 'boobs', 'boobies', 'cock', 'cocks', 'minge', 'hoe', 'hoes', 'prick', 'pricks', 'dick', 'dicks', 'queer', 'queers', 'tosser', 'tossers', 'cum', 'cums', 'cumming', 'sexy', 'sexed', 'sexes', 'sexist', 'sexting', 'butt', 'butts', 'bum', 'bums', 'wiener', 'weenie', 'pecker', 'boner', 'poop', 'pooped', 'pee', 'peed', 'peeing', 'fart', 'farts', 'farted', 'farting', 'hell', 'hells', 'nazi', 'nazis', 'rapes', 'raping', 'raped', 'nude', 'nudes', 'topless'];
/* anything that begins with … */
const PREFIX = ['bullshit', 'slutt', 'whoris', 'erotic', 'fuck', 'shit', 'cunt', 'nigg', 'whore', 'bitch', 'bastard', 'motherf', 'pussy', 'pussies', 'porno', 'faggot', 'arsehol', 'asshol', 'cocksuck', 'dickhead', 'wank'];
/* anything that ends in … ("bullshit", "dipshit") */
const SUFFIX = ['shit', 'shite', 'shitty', 'shits', 'fucker', 'fuckers', 'fucking', 'fucked', 'fuck', 'fucks', 'cunt', 'cunts', 'bitch', 'bitches', 'bitchy', 'nigger', 'niggers', 'asshole', 'assholes', 'dickhead'];

const ENDINGS = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'y', 'ies', 'ier', 'ily', 'iness'];
const blocked = new Set(EXACT);
for (const r of ROOTS) {
  for (const e of ENDINGS) {
    blocked.add(r + e);
    /* doubled last letter: "shagged", "pimping" */
    if (e && /^(ed|ing|er|ers|y)$/.test(e)) blocked.add(r + r[r.length - 1] + e);
    /* a silent e drops: "raped" is already r+d, "molesting" */
    if (r.endsWith('e') && /^(ed|ing|er|ers|y)$/.test(e)) blocked.add(r.slice(0, -1) + e);
  }
}

/** true when `word` (any case) must never be dealt or accepted */
export function isBlocked(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return false;
  if (blocked.has(w)) return true;
  for (const p of PREFIX) if (w.startsWith(p)) return true;
  for (const s of SUFFIX) if (w.length > s.length && w.endsWith(s)) return true;
  return false;
}
