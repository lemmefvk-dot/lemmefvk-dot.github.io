/* ============================================================
   tunes.js — the tunes Static Piano's Learn mode teaches.

   Every tune here is old enough to be in the public domain everywhere
   (composed before 1900, or an anonymous folk tune), and every note was
   entered by hand from the plain melody, so no recording, arrangement or
   edition is copied. Melody only, in C major or A minor, kept between
   C4 and A5 so the two-octave keyboard shows all of it.

   notes: [midi, beats] pairs, one beat = one quarter note; midi null is a rest.
   ============================================================ */
const T = (id, title, by, year, bpm, notes) => ({ id, title, by, year, bpm, notes });

export const TUNES = [
  T('ode', 'Ode to Joy', 'Ludwig van Beethoven', 1824, 96, [
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2]]),
  T('twinkle', 'Twinkle, Twinkle, Little Star', 'French folk melody, 1761', 1761, 100, [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]]),
  T('elise', 'Für Elise (the opening)', 'Ludwig van Beethoven', 1810, 76, [
    [76, 0.5], [75, 0.5], [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1.5], [null, 0.5],
    [60, 0.5], [64, 0.5], [69, 0.5], [71, 1.5], [null, 0.5],
    [64, 0.5], [68, 0.5], [71, 0.5], [72, 1.5]]),
  T('jingle', 'Jingle Bells (chorus)', 'James Lord Pierpont', 1857, 112, [
    [64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2],
    [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4],
    [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5],
    [67, 1], [67, 1], [65, 1], [62, 1], [60, 4]]),
  T('jacques', 'Frère Jacques', 'French folk song', 1780, 104, [
    [72, 1], [74, 1], [76, 1], [72, 1], [72, 1], [74, 1], [76, 1], [72, 1],
    [76, 1], [77, 1], [79, 2], [76, 1], [77, 1], [79, 2],
    [79, 0.5], [81, 0.5], [79, 0.5], [77, 0.5], [76, 1], [72, 1], [79, 0.5], [81, 0.5], [79, 0.5], [77, 0.5], [76, 1], [72, 1],
    [72, 1], [67, 1], [72, 2], [72, 1], [67, 1], [72, 2]]),
];

/** The notes of a tune with start times in beats: [{ midi, at, len }], rests left out. */
export function schedule(tune) {
  const out = [];
  let at = 0;
  for (const [midi, len] of tune.notes) { if (midi != null) out.push({ midi, at, len }); at += len; }
  return { notes: out, beats: at };
}

/** The lowest and highest key a tune uses. */
export function range(tune) {
  const m = tune.notes.map(n => n[0]).filter(x => x != null);
  return [Math.min(...m), Math.max(...m)];
}

/**
 * A learner scores only what a person actually presses: nothing is scored by
 * time passing, and nothing is counted unless a key was really played.
 *   const j = learner(tune);  j.press(midi) -> 'hit' | 'miss' | 'done' | 'idle'
 *   j.next() -> the midi note to press now (null when finished)
 *   j.stats() -> { hits, misses, total, pos, done, accuracy }
 */
export function learner(tune) {
  const list = schedule(tune).notes;
  let pos = 0, hits = 0, misses = 0;
  const stats = () => ({ hits, misses, total: list.length, pos, done: pos >= list.length, accuracy: hits + misses ? Math.round(100 * hits / (hits + misses)) : null });
  return {
    next: () => (pos < list.length ? list[pos].midi : null),
    press(midi) {
      if (pos >= list.length) return 'idle';
      if (midi === list[pos].midi) { hits++; pos++; return pos >= list.length ? 'done' : 'hit'; }
      misses++;
      return 'miss';
    },
    stats,
    reset() { pos = 0; hits = 0; misses = 0; },
  };
}

export default { TUNES, schedule, range, learner };
