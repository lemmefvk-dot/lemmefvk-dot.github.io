/* ============================================================
   abc.js — ABC music notation: read a tune, and turn it into notes to play.

   ABC is a plain-text way of writing a melody:

     X:1
     T:Ode to Joy
     M:4/4
     L:1/4
     K:C
     E E F G | G F E D | C C D E | E3/2 D/ D2 |]

   parseABC(text) reads the first tune (or the one a given X: number names) and
   returns { title, composer, meter, unit, tempo, key, voices, warnings }.
   What it understands:
     · header fields X T C M L Q K V (and the same fields inside the tune, as a
       line or in [brackets]); K: with a mode (Gmix, Ador, Em, F#m…) and clef=
       bass; M:C and M:C|; L: written or taken from the metre
     · notes A–G and a–g, octave marks ' and , , sharps ^ ^^, flats _ __,
       naturals =, lengths 3 / 3/2 / // and broken rhythm > <
     · rests z, Z (whole bars) and x; chords [CEG]; ties -; tuplets (3 (5…
     · bars | || |] |: :| ::, first and second endings (|1 :|2 or [1 [2)
     · "chord symbols" (kept as text), grace notes {} (left out when played),
       slurs, decorations (ignored)
   Anything it does not understand is skipped and listed in `warnings` with its
   line, so a half-typed tune still shows as much as it can.

   A note is { t:'note', pitches:[{ midi, letter, step, acc, shown }], len:[n,d],
   dur, gd, tie, beam, chord, tup }:
     len/dur   the length as a fraction of a whole note (tuplets included)
     gd        the length as it is written (before a tuplet squeezes it)
     step      the staff position: 7 × octave + letter, middle C = 28
     shown     the person wrote an accidental, so the page draws one
   A voice is { id, name, clef, items:[note | rest | bar] }.

   events(tune, { repeats }) lists what to play: [{ midi, start, dur, voice,
   item }] with start and dur in whole notes, repeats unrolled and ties joined.
   seconds(tune, whole) turns whole notes into seconds at the tune's tempo.
   ============================================================ */

const LETTERS = 'CDEFGAB';
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODES = { major: 0, maj: 0, ionian: 0, ion: 0, mixolydian: -1, mix: -1, dorian: -2, dor: -2, minor: -3, min: -3, m: -3, aeolian: -3, aeo: -3, phrygian: -4, phr: -4, lydian: 1, lyd: 1, locrian: -5, loc: -5 };
const SHARP_ORDER = 'FCGDAEB', FLAT_ORDER = 'BEADGCF';

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const frac = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
const mul = (a, b) => frac(a[0] * b[0], a[1] * b[1]);
const add = (a, b) => frac(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);

/** the sharps (+) or flats (−) a key writes, and which notes they touch */
export function keySignature(text) {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(text || '');
  if (!m) return { tonic: 'C', mode: 'major', fifths: 0, acc: {} };
  const tonic = m[1] + m[2];
  const modeWord = m[3].toLowerCase();
  let mode = 'major', off = 0;
  if (modeWord) {
    const key = Object.keys(MODES).find(k => modeWord.startsWith(k) && (k.length > 1 || modeWord === k));
    if (key) { off = MODES[key]; mode = key === 'm' ? 'minor' : key; }
  }
  const base = FIFTHS[tonic] ?? 0;
  const fifths = Math.max(-7, Math.min(7, base + off));
  const acc = {};
  if (fifths > 0) for (let i = 0; i < fifths; i++) acc[SHARP_ORDER[i]] = 1;
  if (fifths < 0) for (let i = 0; i < -fifths; i++) acc[FLAT_ORDER[i]] = -1;
  return { tonic, mode, fifths, acc };
}

function parseMeter(v) {
  v = String(v).trim();
  if (v === 'C') return { num: 4, den: 4, sym: 'C' };
  if (v === 'C|') return { num: 2, den: 2, sym: 'C|' };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
  if (m && +m[2] > 0) return { num: +m[1], den: +m[2] };
  return null;
}
const parseLen = v => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(v).trim()); return m && +m[2] > 0 && +m[1] > 0 ? frac(+m[1], +m[2]) : null; };
function parseTempo(v, unit) {
  const m = /(?:"[^"]*"\s*)?(?:((?:\d+\/\d+\s*)+)=\s*)?(\d+)/.exec(v);
  if (!m) return null;
  const bpm = +m[2];
  const beat = m[1] ? parseLen(m[1].trim().split(/\s+/)[0]) : null;
  return { beat: beat || [1, 4], bpm: bpm > 0 && bpm <= 400 ? bpm : 120 };
}

const TUPLET = { 2: [3, 2], 3: [2, 3], 4: [3, 4], 5: [2, 5], 6: [2, 6], 7: [2, 7], 8: [3, 8], 9: [3, 9] };

export function parseABC(text, { index = null } = {}) {
  const warnings = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  /* find the tune: the one whose X: matches, else the first */
  let start = 0;
  const xs = lines.map((l, i) => (/^X:\s*(\d+)/.test(l) ? [i, +/^X:\s*(\d+)/.exec(l)[1]] : null)).filter(Boolean);
  if (xs.length) {
    const pick = index != null ? xs.find(x => x[1] === index) || xs[0] : xs[0];
    start = pick[0];
    const next = xs.find(x => x[0] > start);
    lines.length = next ? next[0] : lines.length;
  }
  const tune = { title: '', composer: '', meter: { num: 4, den: 4 }, unit: null, tempo: null, key: keySignature('C'), clef: 'treble', voices: [], warnings, lyrics: false };
  let inBody = false;
  let curVoice = null;
  const voiceOf = (id, name) => {
    let v = tune.voices.find(x => x.id === id);
    if (!v) { v = { id, name: name || '', clef: tune.clef, items: [] }; tune.voices.push(v); }
    return v;
  };
  const unitFallback = () => (tune.meter.num / tune.meter.den < 0.75 ? [1, 16] : [1, 8]);

  const field = (k, v, lineNo) => {
    switch (k) {
      case 'T': if (!tune.title) tune.title = v.trim(); break;
      case 'C': if (!tune.composer) tune.composer = v.trim(); break;
      case 'M': { const m = parseMeter(v); if (m) tune.meter = m; else if (!/^none$/i.test(v.trim())) warnings.push({ line: lineNo, text: `Meter “${v.trim()}” was not understood.` }); break; }
      case 'L': { const u = parseLen(v); if (u) tune.unit = u; else warnings.push({ line: lineNo, text: `Note length “${v.trim()}” was not understood.` }); break; }
      case 'Q': { const t = parseTempo(v); if (t) tune.tempo = t; break; }
      case 'K': {
        const clef = /clef\s*=\s*(treble|bass)/i.exec(v);
        const keyPart = v.replace(/clef\s*=\s*\w+/i, '').replace(/\b(?:middle|transpose|octave|stafflines)\s*=\s*-?\w+/gi, '').trim();
        if (/^(none|hp)$/i.test(keyPart)) tune.key = { tonic: 'C', mode: 'major', fifths: 0, acc: {} };
        else if (keyPart !== '') tune.key = keySignature(keyPart);
        if (clef) { tune.clef = clef[1].toLowerCase(); if (curVoice) curVoice.clef = tune.clef; }
        if (!inBody) { inBody = true; tune.firstKey = tune.key; tune.firstClef = tune.clef; }
        break;
      }
      case 'V': {
        const m = /^\s*(\S+)\s*(.*)$/.exec(v);
        if (m) {
          const nm = /(?:name|nm)\s*=\s*"([^"]*)"/.exec(m[2]);
          curVoice = voiceOf(m[1], nm ? nm[1] : '');
          const clef = /clef\s*=\s*(treble|bass)/i.exec(m[2]);
          if (clef) curVoice.clef = clef[1].toLowerCase();
        }
        break;
      }
      default: break;
    }
  };

  /* the tune's state while the body is read */
  let measureAcc = {};
  let pendingTuplet = null;
  let broken = null;                    /* { f: factor for the next note } */
  let chordText = '';
  let lastNote = null;
  const unit = () => tune.unit || unitFallback();

  for (let li = start; li < lines.length; li++) {
    const raw = lines[li];
    const lineNo = li + 1;
    const line = raw.replace(/(^|\s)%.*$/, '').trimEnd();
    if (!line.trim()) { if (inBody && tune.voices.some(v => v.items.length)) break; continue; }
    if (/^%/.test(line)) continue;
    const f = /^([A-Za-z]):\s?(.*)$/.exec(line);
    if (f) {
      const k = f[1];
      if (k === 'w' || k === 'W') { tune.lyrics = true; continue; }
      field(k, f[2], lineNo);
      if (k === 'V' || k === 'K') measureAcc = {};
      continue;
    }
    if (!inBody) continue;                     /* stray text before K: */
    if (!curVoice) curVoice = voiceOf('1');
    readMusic(line, lineNo);
  }
  if (!tune.voices.length) tune.voices.push({ id: '1', name: '', clef: tune.clef, items: [] });
  tune.unit = tune.unit || unitFallback();
  for (const v of tune.voices) if (!v.clef) v.clef = tune.clef;
  if (!tune.tempo) tune.tempo = { beat: [1, 4], bpm: 120 };
  return tune;

  /* ---- one line of music ---- */
  function readMusic(s, lineNo) {
    let i = 0;
    let space = true;                            /* a space (or the line's start) just came */
    const items = () => curVoice.items;
    const warn = (txt) => warnings.push({ line: lineNo, text: txt });
    const push = it => {
      /* a note written right after another, with no space, joins its beam */
      if (it.t === 'note' && lastNote && !space && lastNote.gd[0] / lastNote.gd[1] <= 0.19 && it.gd[0] / it.gd[1] <= 0.19 && items()[items().length - 1] === lastNote) lastNote.beam = true;
      items().push(it);
      lastNote = it.t === 'note' ? it : null;
      space = false;
    };
    const readLen = () => {
      let m = /^(\d*)(\/*)(\d*)/.exec(s.slice(i));
      if (!m || !m[0]) return [1, 1];
      i += m[0].length;
      let num = m[1] === '' ? 1 : +m[1], den = 1;
      if (m[2]) den = m[3] ? +m[3] : 2 ** m[2].length;
      return frac(num, den || 1);
    };
    const finish = (it, len) => {
      let l = mul(unit(), len);
      if (broken) { l = mul(l, broken.f); broken = null; }
      it.gd = l.slice();
      if (pendingTuplet && pendingTuplet.left > 0) { l = mul(l, pendingTuplet.ratio); it.tup = true; pendingTuplet.left--; }
      it.len = l; it.dur = l[0] / l[1];
    };
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === '\t') { space = true; i++; continue; }
      if (c === '\\') { i++; continue; }
      if (c === '"') {
        const j = s.indexOf('"', i + 1);
        if (j < 0) { warn('A chord symbol is missing its closing quote.'); break; }
        chordText = s.slice(i + 1, j); i = j + 1; continue;
      }
      if (c === '!' ) { const j = s.indexOf('!', i + 1); i = j < 0 ? s.length : j + 1; continue; }
      if (c === '+' ) { const j = s.indexOf('+', i + 1); i = j < 0 ? i + 1 : j + 1; continue; }
      if (c === '{') { const j = s.indexOf('}', i + 1); i = j < 0 ? s.length : j + 1; continue; }
      if ('.~HTuvLMOPS'.includes(c) && !/[A-Ga-g]/.test(c)) { i++; continue; }     /* decorations */
      if (c === '(') {
        const m = /^\((\d)(?::(\d*))?(?::(\d*))?/.exec(s.slice(i));
        if (m) {
          const p = +m[1];
          const t = TUPLET[p] || [2, p];
          const q = m[2] ? +m[2] : t[0];
          pendingTuplet = { left: m[3] ? +m[3] : p, ratio: frac(q, p) };
          i += m[0].length;
        } else i++;
        continue;
      }
      if (c === ')') { i++; continue; }
      if (c === '&') { i++; continue; }
      /* inline field: [K:G] */
      if (c === '[') {
        const m = /^\[([A-Za-z]):([^\]]*)\]/.exec(s.slice(i));
        if (m) { field(m[1], m[2], lineNo); i += m[0].length; continue; }
        if (/^\[\d/.test(s.slice(i))) { const bm = /^\[(\d+)/.exec(s.slice(i)); items().push({ t: 'bar', kind: '[', ending: +bm[1], virtual: true }); i += bm[0].length; space = true; continue; }
        if (s[i + 1] === '|') { /* [| */ }
        else {
          /* a chord */
          const j = s.indexOf(']', i + 1);
          if (j < 0) { warn('A chord is missing its closing ].'); i++; continue; }
          const inner = s.slice(i + 1, j);
          const pitches = [];
          const saveS = s, saveI = i;
          let k = 0;
          const chordLens = [];
          while (k < inner.length) {
            const r = readPitch(inner, k);
            if (!r) { k++; continue; }
            k = r.end;
            const lm = /^(\d*)(\/*)(\d*)/.exec(inner.slice(k));
            let ln = [1, 1];
            if (lm && lm[0]) { k += lm[0].length; ln = frac(lm[1] === '' ? 1 : +lm[1], lm[2] ? (lm[3] ? +lm[3] : 2 ** lm[2].length) : 1); }
            chordLens.push(ln);
            if (inner[k] === '-') k++;
            pitches.push(r.pitch);
          }
          i = j + 1;
          const outer = readLen();
          let tie = false;
          if (s[i] === '-') { tie = true; i++; }
          if (!pitches.length) { warn('An empty chord was skipped.'); continue; }
          const it = { t: 'note', pitches, tie, chord: chordText || undefined, beam: false };
          chordText = '';
          finish(it, mul(chordLens[0] || [1, 1], outer));
          pitches.sort((a, b) => a.midi - b.midi);
          push(it);
          void saveS; void saveI;
          continue;
        }
      }
      /* bar lines */
      const bm = /^(?:\|\]|\[\||\|\||:\|\||:\||\|:|::|\|)/.exec(s.slice(i));
      if (bm || c === ':') {
        const tok = bm ? bm[0] : null;
        if (!tok) { warn(`A stray “:” was skipped.`); i++; continue; }
        i += tok.length;
        let ending = null;
        const em = /^\[?(\d)/.exec(s.slice(i));
        if (em && !/^\[?\d\//.test(s.slice(i))) { ending = +em[1]; i += em[0].length; }
        items().push({ t: 'bar', kind: tok, ending });
        measureAcc = {};
        space = true; lastNote = null;
        continue;
      }
      /* rests */
      if (c === 'z' || c === 'x' || c === 'Z') {
        i++;
        const len = readLen();
        const it = { t: 'rest', hidden: c === 'x', beam: false };
        if (c === 'Z') { const bars = Math.max(1, Math.round(len[0] / len[1])); finish(it, frac(tune.meter.num * unit()[1] * bars, tune.meter.den * unit()[0])); it.bars = bars; }
        else finish(it, len);
        push(it);
        continue;
      }
      if (c === 'y') { i++; readLen(); continue; }
      /* notes */
      const r = readPitch(s, i);
      if (r) {
        i = r.end;
        const len = readLen();
        let tie = false;
        if (s[i] === '-') { tie = true; i++; }
        const it = { t: 'note', pitches: [r.pitch], tie, beam: false };
        if (chordText) { it.chord = chordText; chordText = ''; }
        const bk = /^(>+|<+)/.exec(s.slice(i));
        let nextBroken = null;
        let own = null;
        if (bk) {
          const n = bk[1].length;
          const big = [2 ** (n + 1) - 1, 2 ** n], small = [1, 2 ** n];
          if (bk[1][0] === '>') { own = big; nextBroken = small; } else { own = small; nextBroken = big; }
          i += bk[1].length;
        }
        if (own) broken = { f: broken ? mul(broken.f, own) : own };
        finish(it, len);
        broken = nextBroken ? { f: nextBroken } : null;
        push(it);
        continue;
      }
      if (/\s/.test(c)) { i++; continue; }
      warn(`“${c}” was not understood and was skipped.`);
      i++;
    }
    if (pendingTuplet && pendingTuplet.left <= 0) pendingTuplet = null;
  }

  /* a pitch at s[i]: accidental, letter, octave marks. null if there is none */
  function readPitch(s, i) {
    const m = /^(\^\^|__|\^|_|=)?([A-Ga-g])([',]*)/.exec(s.slice(i));
    if (!m) return null;
    const acc = m[1] === '^^' ? 2 : m[1] === '^' ? 1 : m[1] === '__' ? -2 : m[1] === '_' ? -1 : m[1] === '=' ? 0 : null;
    const upper = m[2] === m[2].toUpperCase();
    const letter = m[2].toUpperCase();
    let oct = upper ? 4 : 5;
    for (const ch of m[3]) oct += ch === "'" ? 1 : -1;
    const keyAcc = tune.key.acc[letter] || 0;
    const mk = letter + oct;
    let a;
    if (acc !== null) { a = acc; measureAcc[mk] = acc; }
    else a = mk in measureAcc ? measureAcc[mk] : keyAcc;
    const midi = 12 * (oct + 1) + SEMI[letter] + a;
    return { end: i + m[0].length, pitch: { midi, letter, oct, step: 7 * oct + LETTERS.indexOf(letter), acc: a, shown: acc !== null } };
  }
}

/** Unroll repeats and endings: the order the bars are played in. Bars are dropped. */
export function unroll(items, { repeats = true } = {}) {
  if (!repeats) return items.filter(it => it.t !== 'bar');
  const out = [];
  let i = 0, repStart = 0, pass = 1;
  const done = new Set();
  let guard = 0;
  while (i < items.length && guard++ < 100000) {
    const it = items[i];
    if (it.t === 'bar') {
      const k = it.kind || '';
      const end = k === ':|' || k === ':|]' || k === '::';
      if (end && !done.has(i)) { done.add(i); pass = 2; i = repStart; continue; }
      if (it.ending && it.ending !== pass) {
        let j = i + 1;
        while (j < items.length && !(items[j].t === 'bar' && items[j].ending === pass)) j++;
        if (j >= items.length) { i = items.length; break; }
        i = j; continue;
      }
      if (end) { pass = 1; if (k === '::') repStart = i + 1; }
      else if (k === '|:') { repStart = i + 1; pass = 1; }
      i++; continue;
    }
    out.push(it);
    i++;
  }
  return out;
}

/** seconds per whole note at the tune's tempo */
export const secondsPerWhole = tune => (60 / tune.tempo.bpm) / (tune.tempo.beat[0] / tune.tempo.beat[1]);

/**
 * What to play: [{ midi, start, dur, voice, item }] (start and dur in whole notes).
 * Tied notes of the same pitch are joined into one long note. `item` is the
 * index of the written note in its voice's items, so a page can follow along.
 */
export function events(tune, { repeats = true } = {}) {
  const out = [];
  tune.voices.forEach((v, vi) => {
    const order = [];
    /* unroll, but remember each item's place in the written line */
    const marked = v.items.map((it, idx) => (it.t === 'bar' ? it : { ...it, idx }));
    for (const it of unroll(marked, { repeats })) order.push(it);
    let t = 0;
    const open = new Map();                       /* midi -> the event a tie continues */
    for (const it of order) {
      if (it.t === 'rest') { t += it.dur; open.clear(); continue; }
      const live = new Map();
      for (const p of it.pitches) {
        const cont = open.get(p.midi);
        if (cont) { cont.dur += it.dur; if (it.tie) live.set(p.midi, cont); continue; }
        const ev = { midi: p.midi, start: t, dur: it.dur, voice: vi, item: it.idx };
        out.push(ev);
        if (it.tie) live.set(p.midi, ev);
      }
      open.clear();
      for (const [k, ev] of live) open.set(k, ev);
      t += it.dur;
    }
  });
  out.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return out;
}

/** total length in whole notes of a voice after repeats */
export const lengthOf = (tune, opts) => events(tune, opts).reduce((m, e) => Math.max(m, e.start + e.dur), 0);

export default { parseABC, events, unroll, keySignature, secondsPerWhole, lengthOf };
