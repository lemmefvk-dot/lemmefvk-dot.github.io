/* ============================================================
   drills/words-data.js — spelling lists written for Static Drills.

   Five levels, named like school grades but only a guide: they are
   plain lists of common English words that people often misspell, in
   the order of how hard they usually are. They are the project's own
   lists (no word-list product was copied), in American spelling.
   Edit freely: the quiz reads whatever is here.
   ============================================================ */
export const LEVELS = [
  { id: 'l1', name: 'Level 1 (grades 1 to 2)', words: ['because', 'friend', 'said', 'where', 'there', 'their', 'were', 'again', 'little', 'people', 'house', 'school', 'water', 'found', 'could', 'would', 'should', 'through', 'about', 'every', 'many', 'very', 'want', 'what', 'who', 'together', 'always', 'better', 'before', 'after', 'animal', 'family', 'mother', 'father', 'sister', 'brother', 'beautiful', 'favorite', 'morning', 'thank'] },
  { id: 'l2', name: 'Level 2 (grades 3 to 4)', words: ['believe', 'bicycle', 'caught', 'certain', 'different', 'enough', 'island', 'library', 'minute', 'neighbor', 'quiet', 'receive', 'special', 'straight', 'surprise', 'tomorrow', 'trouble', 'usually', 'weather', 'whistle', 'answer', 'beginning', 'breakfast', 'build', 'busy', 'clothes', 'country', 'decide', 'early', 'earth', 'enjoy', 'exercise', 'forest', 'guess', 'healthy', 'important', 'knowledge', 'laugh', 'listen', 'mountain'] },
  { id: 'l3', name: 'Level 3 (grades 5 to 6)', words: ['accident', 'achieve', 'address', 'ancient', 'argument', 'calendar', 'challenge', 'character', 'comfortable', 'community', 'conscious', 'courage', 'curious', 'dangerous', 'definite', 'describe', 'develop', 'disease', 'embarrass', 'environment', 'equipment', 'excellent', 'experience', 'february', 'foreign', 'government', 'guarantee', 'happiness', 'immediately', 'independent', 'interesting', 'language', 'lightning', 'marriage', 'measure', 'necessary', 'neighborhood', 'nuisance', 'occasion', 'parallel'] },
  { id: 'l4', name: 'Level 4 (grades 7 to 8)', words: ['accommodate', 'acquaintance', 'appearance', 'awkward', 'beneficial', 'boundary', 'bureaucracy', 'category', 'committee', 'communicate', 'competition', 'consequence', 'convenience', 'criticism', 'deceive', 'desperate', 'discipline', 'dissatisfied', 'eighth', 'especially', 'existence', 'familiar', 'fascinate', 'fluorescent', 'fulfill', 'gauge', 'grammar', 'harass', 'hierarchy', 'humorous', 'hypocrite', 'ignorance', 'jewelry', 'judgment', 'leisure', 'maintenance', 'mischievous', 'noticeable', 'pastime', 'tendency'] },
  { id: 'l5', name: 'Level 5 (grade 9 and up)', words: ['absence', 'acquire', 'aggressive', 'ambiguous', 'apparent', 'atmosphere', 'bankruptcy', 'catastrophe', 'cemetery', 'conscience', 'conscientious', 'correspondence', 'curriculum', 'dilemma', 'disappoint', 'embarrassment', 'entrepreneur', 'exaggerate', 'exhilarate', 'extraordinary', 'guidance', 'hindrance', 'idiosyncrasy', 'indispensable', 'irresistible', 'liaison', 'millennium', 'miscellaneous', 'occurrence', 'perseverance', 'phenomenon', 'privilege', 'pronunciation', 'questionnaire', 'rhythm', 'sacrilegious', 'separate', 'silhouette', 'surveillance', 'vacuum'] },
];

/** Clean a typed list: words separated by lines, commas or spaces; letters, apostrophes and hyphens only; no repeats. */
export function parseList(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    for (const part of raw.trim().split(/\s+/)) {
      const w = part.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (!w || w.length > 40 || !/^[A-Za-z][A-Za-z'’-]*$/.test(w)) continue;
      const k = w.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
  }
  return out.slice(0, 500);
}
