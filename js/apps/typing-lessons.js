/* ============================================================
   typing-lessons.js — Typing Lessons: learn to touch-type, a step at a time.

   Eight lessons in order — home row, top row, bottom row, numbers,
   punctuation, capitals, words, sentences. An on-screen keyboard lights
   the next key and says which finger types it (and which Shift, for a
   capital). A wrong key does not move you on; it counts against accuracy.

   Scoring matches Type Rush (js/arcade/typing.js), which this imports:
     WPM      = correct characters ÷ 5 per minute (wpmOf, shared)
     Accuracy = correct keystrokes ÷ every keystroke, including slips you
                then corrected
   A lesson opens the next one when you finish it at 90% accuracy or more.

   Every finished lesson is kept as a record (date, WPM, accuracy) in
   prefs.typingLessons; the Progress chart is drawn only from those, by
   day or by week. With no records it says so — nothing is made up.

   PRACTICE, beside the lessons (always open, never part of unlocking):
     · Slowest keys: every correct keystroke that follows another correct
       one is timed (the gap between the two, up to 2 s; a longer one was
       a pause, not typing) and added to that key's record. Once there are
       enough timings (MIN_TIMED in all, MIN_PER_KEY for a key) the
       Progress page lists the slowest keys and this drill is made from
       words that use them. Before that it says how many more it needs.
     · Your own text: paste or type any text and practise it.
     · 1-, 3- and 5-minute tests: common words in a random order; the
       clock starts at the first key and the score is what was typed
       right when it runs out.
     · Code symbols, and the number pad (with a number-pad guide).

   OPTIONS (saved with the records): hide the keyboard; on a mistake stop
   (the default: the key must be typed right to go on) or carry on (the
   slip is marked and Backspace can go back to fix it); a QWERTY, Dvorak
   or Colemak guide — that only changes the drawn keyboard and the finger
   hints, since the layout itself is the computer's; key click sounds,
   off unless turned on, made with Web Audio and quiet when StaticOS is
   muted.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { wpmOf } from '../arcade/typing.js';

export const PASS = 0.9;          /* accuracy that opens the next lesson */
export const MIN_TIMED = 200;     /* timed keystrokes before the slowest keys are named */
export const MIN_PER_KEY = 5;     /* and timings of one key before it can be one of them */
export const MAX_GAP = 2000;      /* ms: a longer gap between two keys was a pause */

export const LESSONS = [
  { id: 'home', name: 'Home row', keys: 'asdfghjkl;',
    blurb: 'Rest your fingers on A S D F and J K L ;. Your index fingers feel the small bumps on F and J.',
    text: 'asdf jkl; fdsa ;lkj asdf jkl; ghgh fjfj dkdk slsl all sad dad ask fall flask glass salad has had lads' },
  { id: 'top', name: 'Top row', keys: 'qwertyuiop',
    blurb: 'Reach up from the home row and come straight back. Keep the other fingers where they are.',
    text: 'qwer uiop poiu rewq tyty ewew oioi rtrt quit your type pretty tower power write true tire pie outer equip' },
  { id: 'bottom', name: 'Bottom row', keys: 'zxcvbnm,./',
    blurb: 'Curl your fingers down to Z X C V and B N M , . /, then return to the home row.',
    text: 'zxcv bnm, zxcv bnm, vbvb nmnm cxcx m,m, x.x /./ van can mix box zinc cabin bacon vex numb comma zoom' },
  { id: 'numbers', name: 'Numbers', keys: '1234567890',
    blurb: 'The number row is two rows up. Use the same finger that owns the letters beneath each digit.',
    text: '1234 5678 90 1234567890 0987654321 1a2s 3d4f 7j8k 9l0; 12 24 36 48 60 72 84 96 100 2026 365 1999 42' },
  { id: 'punct', name: 'Punctuation', keys: ',.;\'-/?!:()"',
    blurb: 'Commas, full stops, quotes, brackets. Shifted marks use the Shift on the opposite hand.',
    text: 'ok, yes. no; wait: really? stop! it\'s (fine) - done. "quoted" text, end. a/b, c-d; (e) "f" g? h!' },
  { id: 'caps', name: 'Capitals', keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    blurb: 'Hold the Shift on the opposite hand from the letter, tap the letter, and let go.',
    text: 'Alice Bob Carol Dan Eve Frank Grace Henry Ivy Jack Kate Liam Mia Noah Olivia Paul Quinn Rose Sam Tina Uma Victor Wendy Zoe' },
  { id: 'words', name: 'Common words', keys: '',
    blurb: 'Everyday words, typed without looking. Rhythm matters more than raw speed.',
    text: 'the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time' },
  { id: 'sentences', name: 'Sentences', keys: '',
    blurb: 'Full sentences with capitals and punctuation, the way you really type.',
    text: 'The quick brown fox jumps over the lazy dog. Practice makes progress, so keep going! Typing well is a skill you can learn in a few weeks. Sit up straight, rest your wrists and look at the screen, not the keys.' },
];

/* practice beside the lessons; the slowest-keys drill and the tests make their text when opened */
export const EXTRAS = [
  { id: 'slow', name: 'Slowest keys', icon: 'trending-up', blurb: 'Words that use the keys your own timings say are slowest. Type them steadily; speed comes from not hesitating.' },
  { id: 'own', name: 'Your own text', icon: 'file-text', blurb: 'Paste or type anything you want to practise: a paragraph from a book, your notes, a speech.' },
  { id: 'test1', name: '1-minute test', icon: 'clock', secs: 60, blurb: 'Common words in a random order. The clock starts at your first key; your score is what you typed right when it runs out.' },
  { id: 'test3', name: '3-minute test', icon: 'clock', secs: 180, blurb: 'Common words in a random order, for three minutes. The clock starts at your first key.' },
  { id: 'test5', name: '5-minute test', icon: 'clock', secs: 300, blurb: 'Common words in a random order, for five minutes: a test of stamina as much as speed.' },
  { id: 'code', name: 'Code symbols', icon: 'code', blurb: 'Brackets, braces, operators and quotes, the way they come up in code. Most are shifted: use the Shift on the other hand.',
    text: 'if (x > 0) { y = x * 2; } let a = [1, 2, 3]; a[0] += 5; f(a, "b") && g(\'c\') || !h; x = 10 % 3; mask ^ bits | flag & 1; ~n; #include <stdio.h> $total = @sum_of(a); `tick` // done' },
  { id: 'numpad', name: 'Number pad', icon: 'calculator', pad: true, blurb: 'Your right index finger rests on 4, with the bump on 5 under your middle finger. The thumb takes 0.',
    text: '456 456 654 789 987 123 321 147 258 369 0 00 100 4.5 7+8 9-6 3*2 8/4 46+79 12.5 300 1.25 906-41 52*3 81/9 7410 8520 9630' },
];

/* ---- the keyboard: the same physical keys, three layouts ---- */
const QWERTY = [
  ['`~', '1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '-_', '=+', 'Backspace'],
  ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[{', ']}', '\\|'],
  ['Caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';:', '\'"', 'Enter'],
  ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',<', '.>', '/?', 'Shift'],
  ['Space'],
];
export const LAYOUTS = {
  qwerty: { name: 'QWERTY', rows: QWERTY },
  dvorak: { name: 'Dvorak', rows: [
    ['`~', '1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '[{', ']}', 'Backspace'],
    ['Tab', '\'"', ',<', '.>', 'p', 'y', 'f', 'g', 'c', 'r', 'l', '/?', '=+', '\\|'],
    ['Caps', 'a', 'o', 'e', 'u', 'i', 'd', 'h', 't', 'n', 's', '-_', 'Enter'],
    ['Shift', ';:', 'q', 'j', 'k', 'x', 'b', 'm', 'w', 'v', 'z', 'Shift'],
    ['Space'],
  ] },
  colemak: { name: 'Colemak', rows: [
    QWERTY[0],
    ['Tab', 'q', 'w', 'f', 'p', 'g', 'j', 'l', 'u', 'y', ';:', '[{', ']}', '\\|'],
    ['Caps', 'a', 'r', 's', 't', 'd', 'h', 'n', 'e', 'i', 'o', '\'"', 'Enter'],
    ['Shift', 'z', 'x', 'c', 'v', 'b', 'k', 'm', ',<', '.>', '/?', 'Shift'],
    ['Space'],
  ] },
};
/* which finger owns each place on the keyboard (row, then the key's index in the row): the same for every layout */
const LP = 'left pinky', LR = 'left ring', LM = 'left middle', LI = 'left index', RI = 'right index', RM = 'right middle', RR = 'right ring', RP = 'right pinky';
const PLACE_FINGER = [
  [LP, LP, LR, LM, LI, LI, RI, RI, RM, RR, RP, RP, RP],
  [null, LP, LR, LM, LI, LI, RI, RI, RM, RR, RP, RP, RP, RP],
  [null, LP, LR, LM, LI, LI, RI, RI, RM, RR, RP, RP],
  [null, LP, LR, LM, LI, LI, RI, RI, RM, RR, RP],
];
const baseOf = k => (k.length === 2 && !/[a-z]/.test(k[0]) ? k[0] : k.length === 1 ? k : null);
const INFO = {};
function layoutInfo(name) {
  if (INFO[name]) return INFO[name];
  const L = LAYOUTS[name] || LAYOUTS.qwerty;
  const fingerOf = { ' ': 'thumb' }, shifted = {}, left = new Set();
  L.rows.forEach((row, r) => row.forEach((k, i) => {
    const base = baseOf(k);
    if (!base) return;
    const f = PLACE_FINGER[r] && PLACE_FINGER[r][i];
    if (f) { fingerOf[base] = f; if (f.startsWith('left')) left.add(base); }
    if (k.length === 2 && !/[a-z]/.test(k[0])) shifted[k[1]] = k[0];
  }));
  return (INFO[name] = { rows: L.rows, fingerOf, shifted, left });
}

/* the number pad: [label, finger] in rows of four */
const PAD = [
  [['Num', null], ['/', RM], ['*', RR], ['-', RP]],
  [['7', RI], ['8', RM], ['9', RR], ['+', RP]],
  [['4', RI], ['5', RM], ['6', RR], ['', null]],
  [['1', RI], ['2', RM], ['3', RR], ['Enter', RP]],
  [['0', 'thumb'], ['.', RR]],
];
const PAD_FINGER = Object.fromEntries(PAD.flat().filter(([k, f]) => k.length === 1 && f).map(([k, f]) => [k, f]));

/** The key to press (and Shift, if any) for a character: { base, shift:'left'|'right'|null }. */
export function keyFor(ch, layout = 'qwerty') {
  const I = layoutInfo(layout);
  if (ch === ' ') return { base: ' ', shift: null };
  const lower = ch.toLowerCase();
  if (/^[a-z]$/.test(lower)) {
    return { base: lower, shift: ch !== lower ? (I.left.has(lower) ? 'right' : 'left') : null };
  }
  if (I.shifted[ch]) return { base: I.shifted[ch], shift: I.left.has(I.shifted[ch]) ? 'right' : 'left' };
  return { base: ch, shift: null };
}
export const fingerFor = (ch, layout = 'qwerty') => layoutInfo(layout).fingerOf[keyFor(ch, layout).base] || 'finger';

/* ---- progress records ---- */
const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The Monday that starts the week of a moment, as YYYY-MM-DD (local time). */
export const weekOf = t => { const d = new Date(t); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d.getTime()); };
const pct = r => Math.floor((r.ok / r.all) * 1000) / 10;         /* floored: 89.96 never shows as 90 */
const passed = r => r.all > 0 && r.ok * 10 >= r.all * 9;         /* whole-number arithmetic: 0.9 × 70 is not exactly 63 in floating point */

/** The slowest keys from the timings: [{ key, n, avg }] slowest first, or null while there are too few. */
export function slowestKeys(keys, count = 5) {
  const list = Object.entries(keys || {}).filter(([k, v]) => k !== ' ' && v && v.n >= MIN_PER_KEY && v.ms > 0);
  const timed = Object.values(keys || {}).reduce((t, v) => t + (v && v.n ? v.n : 0), 0);
  if (timed < MIN_TIMED || list.length < 2) return null;
  return list.map(([key, v]) => ({ key, n: v.n, avg: v.ms / v.n })).sort((a, b) => b.avg - a.avg).slice(0, count);
}
const WORD_BANK = [...new Set([...LESSONS.flatMap(l => l.text.toLowerCase().split(/[^a-z']+/)), ...'about above after again against almost along always another answer around away because become before began begin being below between both bring brought build busy carry change check child city close color come could country cover cross dark day does done door down draw drive during early earth easy every example face family far father feel field find fire first follow food form found four friend full gave give good great green grow half hand happen hard head hear heard help here high hold home horse house idea important inside jump just keep kind king knew know land large last later learn leave left letter life light line list little live long look love made many mark might mile mind money more morning most mother move much music must name near need never next night north nothing notice number object often once only open order other over page paper part people picture place plain plant play point power press quick quiet quite rain reach read ready real right river road rock room round rule said same school science second seem sentence serve several shape short should show side simple since size sleep small snow some sound south space speak special spell stand start state still stood story street strong study such sure table take talk tell than thing think those though thought three through today together told took toward travel tree true turn under until upon usual very voice vowel walk want warm watch water wave week well went were west where while white whole wide wild wind winter wish without woman wonder wood word work world write year young zero zone quiz jazz fizz buzz quickly equal jacket object box six fix next exam extra squeeze vex'.split(' ')])].filter(w => w.length >= 2);
/** A drill for some keys: words that use them, most uses first, with the keys' own repeats between. */
export function drillText(keys, length = 160) {
  const ks = keys.map(k => k.toLowerCase());
  const score = w => ks.reduce((n, k) => n + w.split(k).length - 1, 0);
  const words = WORD_BANK.filter(w => score(w) > 0).sort((a, b) => score(b) - score(a) || a.length - b.length);
  const out = [];
  let len = 0, i = 0;
  while (len < length && (words.length || ks.length)) {
    const k = ks[i % ks.length];
    const pat = k === ' ' ? '' : `${k}${k}${k}`;
    const w = words.length ? words[i % words.length] : '';
    for (const x of [pat, w].filter(Boolean)) { out.push(x); len += x.length + 1; }
    i++;
    if (i > 400) break;
  }
  return out.join(' ').slice(0, length).trim();
}
/** Text typed or pasted in, reduced to what a keyboard types: one line, plain quotes, printable ASCII. -> { text, dropped } */
export function cleanOwn(src) {
  const s = String(src || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
  let dropped = 0;
  const text = [...s].filter(c => { const ok = c >= ' ' && c <= '~'; if (!ok) dropped++; return ok; }).join('').replace(/ {2,}/g, ' ').trim().slice(0, 2000);
  return { text, dropped };
}
const COMMON = LESSONS[6].text.split(' ');
const testWords = n => Array.from({ length: n }, () => COMMON[Math.floor(Math.random() * COMMON.length)]).join(' ');

const CSS = `
.tl{flex:1;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);container-type:inline-size}
.tl__wrap{display:flex;height:100%;min-height:0}
.tl *{box-sizing:border-box}
.tl__nav{flex:0 0 220px;display:flex;flex-direction:column;gap:2px;padding:var(--sp-3);border-right:1px solid var(--line-1);overflow:auto}
.tl__item{display:flex;align-items:center;gap:var(--sp-3);padding:8px 10px;border-radius:var(--r-sm);text-align:left;color:var(--ink-1);font-size:var(--fs-13);width:100%}
.tl__item:hover:not([aria-disabled=true]){background:var(--fill-1)}
.tl__item.is-on{background:var(--fill-2);color:var(--ink-0)}
.tl__item[aria-disabled=true]{color:var(--ink-3);cursor:not-allowed}
.tl__item em{font-style:normal;margin-left:auto;font-size:var(--fs-11);color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.tl__num{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:var(--fs-11);font-weight:700;background:var(--fill-1);color:var(--ink-2);flex:none}
.tl__item.is-done .tl__num{background:var(--accent);color:var(--accent-ink)}
.tl__sep{height:1px;background:var(--line-1);margin:var(--sp-3) 0}
.tl__group{font-size:var(--fs-10);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);padding:2px 10px 4px}
.tl__main{flex:1;min-width:0;overflow:auto;padding:var(--sp-5);display:flex;flex-direction:column;gap:var(--sp-4)}
.tl__head h2{margin:0;font-size:var(--fs-18);color:var(--ink-0)}
.tl__head p{margin:4px 0 0;font-size:var(--fs-12);color:var(--ink-2);max-width:62ch;line-height:1.5}
.tl__stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:var(--sp-3)}
.tl__stat{padding:var(--sp-3) var(--sp-4);border-radius:var(--r-md);background:var(--fill-0);border:1px solid var(--line-0)}
.tl__stat span{display:block;font-size:var(--fs-10);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.tl__stat b{font-size:var(--fs-18);color:var(--ink-0);font-variant-numeric:tabular-nums}
.tl__text{position:relative;padding:var(--sp-5);border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);font:500 clamp(17px,3.2cqw,26px)/1.7 var(--mono);letter-spacing:.02em;color:var(--ink-3);cursor:text;word-break:break-word;max-height:13em;overflow:auto}
.tl__ch{border-radius:3px}
.tl__ch.is-ok{color:var(--ink-0)}
.tl__ch.is-err{color:#f87171;text-decoration:underline wavy rgba(248,113,113,.8);text-underline-offset:4px}
.tl__ch.is-now{background:var(--fill-accent-hi);color:var(--ink-0);box-shadow:0 0 0 2px var(--fill-accent-hi)}
.tl__ch.is-miss{background:rgba(248,113,113,.35)}
.tl__in{position:absolute;opacity:0;width:1px;height:1px;left:0;top:0;pointer-events:none}
.tl__next{font-size:var(--fs-13);color:var(--ink-2);min-height:20px}
.tl__next b{color:var(--ink-0)}
.tl__kb{display:flex;flex-direction:column;gap:4px;align-items:center;padding:var(--sp-3);border-radius:var(--r-lg);background:var(--fill-0);border:1px solid var(--line-0)}
.tl__kb--pad{align-items:flex-start;width:max-content}
.tl__row{display:flex;gap:4px;width:100%;justify-content:center}
.tl__kb--pad .tl__row{justify-content:flex-start;width:auto}
.tl__k{--f:var(--ink-3);flex:1 1 0;max-width:46px;min-width:0;height:36px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 12px/1 var(--mono);
  color:var(--ink-1);background:color-mix(in srgb,var(--f) 16%,var(--fill-0));border:1px solid color-mix(in srgb,var(--f) 40%,transparent)}
.tl__kb--pad .tl__k{flex:0 0 46px;width:46px}
.tl__kb--pad .tl__k[data-wide="2"]{flex:0 0 96px;width:96px;max-width:96px}
.tl__k[data-blank]{visibility:hidden}
.tl__k small{font-size:calc(9px * var(--fs-k,1));opacity:.7;font-weight:500;min-height:9px}
.tl__k[data-wide="1"]{flex:1.5 1 0;max-width:70px}
.tl__k[data-wide="2"]{flex:2 1 0;max-width:92px}
.tl__k[data-wide="6"]{flex:6 1 0;max-width:280px}
.tl__k.is-next{background:var(--accent);color:var(--accent-ink);border-color:var(--ink-0);box-shadow:0 0 0 2px var(--fill-accent-hi),var(--glow);transform:translateY(-1px)}
.tl__k.is-shift{background:color-mix(in srgb,var(--accent) 55%,var(--fill-1));color:var(--accent-ink);border-color:var(--ink-0)}
.tl__k.is-hit{background:var(--fill-3)}
.tl__btns{display:flex;gap:var(--sp-3);flex-wrap:wrap;align-items:center}
.tl__btn{height:32px;padding:0 14px;border-radius:var(--r-sm);background:var(--fill-2);color:var(--ink-0);font-size:var(--fs-13);font-weight:600;border:1px solid var(--line-1)}
.tl__btn:hover{background:var(--fill-3)}
.tl__btn--go{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.tl__btn:disabled{opacity:.5;cursor:default}
.tl__opts{display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center;font-size:var(--fs-12);color:var(--ink-2)}
.tl__opt{height:28px;padding:0 10px;border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font-size:var(--fs-12)}
.tl__opt[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.tl__opts select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-1);background:var(--fill-1);color:var(--ink-0);font-size:var(--fs-12);padding:0 6px}
.tl__done{padding:var(--sp-5);border-radius:var(--r-lg);background:var(--fill-0);border:1px solid var(--line-1);display:flex;flex-direction:column;gap:var(--sp-3)}
.tl__done h3{margin:0;font-size:var(--fs-18);color:var(--ink-0)}
.tl__done p{margin:0;font-size:var(--fs-13);color:var(--ink-2);line-height:1.5}
.tl__own{display:flex;flex-direction:column;gap:var(--sp-3)}
.tl__own textarea{min-height:120px;padding:var(--sp-4);border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:13px/1.5 var(--mono);resize:vertical}
.tl__own small{color:var(--ink-3)}
.tl__chart{width:100%;height:auto;border-radius:var(--r-md);background:var(--fill-0);border:1px solid var(--line-0)}
.tl__chart text{font:10px var(--font);fill:var(--ink-3)}
.tl__legend{display:flex;gap:var(--sp-5);font-size:var(--fs-12);color:var(--ink-2);flex-wrap:wrap;align-items:center}
.tl__legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.tl__runs{width:100%;border-collapse:collapse;font-size:var(--fs-12)}
.tl__runs th,.tl__runs td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line-0);font-variant-numeric:tabular-nums}
.tl__runs th{color:var(--ink-3);font-weight:600}
.tl__empty{color:var(--ink-3);font-size:var(--fs-13);line-height:1.6;padding:var(--sp-5);border:1px dashed var(--line-2);border-radius:var(--r-lg)}
.tl__slow{display:flex;flex-wrap:wrap;gap:var(--sp-3)}
.tl__slow li{list-style:none;padding:var(--sp-3) var(--sp-4);border-radius:var(--r-md);background:var(--fill-0);border:1px solid var(--line-0);font-size:var(--fs-12);color:var(--ink-2)}
.tl__slow b{font:700 16px var(--mono);color:var(--ink-0);margin-right:6px}
.tl__slow{margin:0;padding:0}
@container (max-width:560px){.tl__wrap{flex-direction:column}.tl__nav{flex:0 0 auto;flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line-1)}.tl__item{width:auto;white-space:nowrap}.tl__item em{display:none}.tl__sep,.tl__group{display:none}}
`;

defineApp({
  id: 'typing',
  name: 'Typing Lessons',
  icon: 'keyboard',
  g1: '#ffd27a', g2: '#d9731a',
  category: 'Utilities',
  keywords: ['typing', 'touch type', 'keyboard', 'wpm', 'lessons', 'learn', 'home row', 'practice', 'school', 'speed', 'typing test', 'dvorak', 'colemak', 'number pad', 'numpad'],
  desc: 'Learn to touch-type from the home row up, practise your slowest keys and watch your speed grow',
  win: { w: 860, h: 640, minW: 520, minH: 460 },
  shortcuts: [
    ['Esc', 'Restart the lesson'],
    ['Enter', 'Next lesson, once you have passed'],
    ['Backspace', 'Go back a letter (when carrying on after mistakes)'],
  ],
  mount({ root, win, api }) { return build(root, win, api); },
});

function build(root, win, api) {
  const store = api.store;
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };

  /* ---- what is kept: the records, the key timings, the options and your own text ---- */
  const raw = () => store.get('prefs.typingLessons') || {};
  const loadRuns = () => {
    const v = raw();
    const runs = Array.isArray(v.runs) ? v.runs : [];
    return runs.filter(r => r && typeof r.lesson === 'string' && Number.isFinite(r.t) && Number.isFinite(r.wpm) && r.all > 0 && r.ok >= 0 && r.ok <= r.all);
  };
  const loadKeys = () => {
    const v = raw().keys, out = {};
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k.length === 1 && x && Number.isFinite(x.n) && Number.isFinite(x.ms) && x.n > 0) out[k] = { n: x.n, ms: x.ms };
    return out;
  };
  const loadOpt = () => {
    const o = raw().opt || {};
    return { kb: o.kb !== false, stop: o.stop !== false, layout: LAYOUTS[o.layout] ? o.layout : 'qwerty', sound: o.sound === true, by: o.by === 'week' ? 'week' : 'day' };
  };
  let runs = loadRuns();
  let keyStats = loadKeys();
  const opt = loadOpt();
  let ownText = typeof raw().own === 'string' ? raw().own.slice(0, 2000) : '';
  const save = () => store.set('prefs.typingLessons', { runs: runs.slice(-400), keys: keyStats, opt: { ...opt }, own: ownText });
  const saveRuns = save;

  const passedLesson = id => runs.some(r => r.lesson === id && passed(r));
  const unlocked = i => i === 0 || passedLesson(LESSONS[i - 1].id);
  const bestOf = id => runs.filter(r => r.lesson === id).reduce((b, r) => (!b || r.wpm > b.wpm ? r : b), null);
  const nameOf = id => (LESSONS.find(l => l.id === id) || EXTRAS.find(l => l.id === id) || {}).name || id;

  /* ---- state of the open lesson ---- */
  let view = 'lesson';                 /* 'lesson' | 'progress' */
  let cur = firstOpen();
  let extra = null;                    /* an EXTRAS id while practising one of them */
  let run = null;                      /* { id, text, pos, ok, all, startAt, done, result, errs, lastOkAt } */
  let tick = 0;

  function firstOpen() {
    for (let i = 0; i < LESSONS.length; i++) if (unlocked(i) && !passedLesson(LESSONS[i].id)) return i;
    return LESSONS.length - 1;
  }
  /* the lesson on screen, a lesson or a practice: { id, name, blurb, text, secs?, pad?, extra } */
  function lessonNow() {
    if (!extra) return { ...LESSONS[cur], extra: false };
    const x = EXTRAS.find(e => e.id === extra);
    let text = x.text || '';
    if (x.id === 'slow') { const sk = slowestKeys(keyStats, 4); text = sk ? drillText(sk.map(k => k.key)) : ''; }
    if (x.id === 'own') text = ownText;
    if (x.secs) text = testWords(Math.ceil(x.secs * 1.6));
    return { ...x, text, extra: true };
  }
  const fresh = () => { const L = lessonNow(); return { id: L.id, text: L.text, pos: 0, ok: 0, all: 0, startAt: 0, done: false, result: null, miss: false, errs: new Set(), lastOkAt: 0, secs: L.secs || 0, pad: !!L.pad }; };

  const nav = h('nav.tl__nav', { 'aria-label': 'Lessons' });
  const main = h('div.tl__main');
  root.appendChild(h('div.tl', h('style', { text: CSS }), h('div.tl__wrap', nav, main)));

  function paintNav() {
    const items = LESSONS.map((l, i) => {
      const open = unlocked(i);
      const best = bestOf(l.id);
      const on1 = view === 'lesson' && !extra && cur === i;
      const b = h('button.tl__item' + (on1 ? '.is-on' : '') + (passedLesson(l.id) ? '.is-done' : ''), {
        type: 'button', dataset: { lesson: l.id, locked: open ? '0' : '1', passed: passedLesson(l.id) ? '1' : '0' },
        'aria-disabled': open ? null : 'true',
        'aria-current': on1 ? 'true' : null,
        'aria-label': `Lesson ${i + 1}, ${l.name}` + (open ? '' : `. Locked: finish ${LESSONS[i - 1].name} with ${PASS * 100}% accuracy to open it`)
          + (best ? `. Best ${best.wpm} words per minute` : ''),
        title: open ? '' : `Finish “${LESSONS[i - 1].name}” with ${PASS * 100}% accuracy or better to unlock`,
        onclick: () => { if (open) openLesson(i); },
      }, h('span.tl__num', passedLesson(l.id) ? api.icon('check', { size: 12 }) : open ? String(i + 1) : api.icon('lock', { size: 11 })),
        h('span', { text: l.name }), best ? h('em', { text: `${best.wpm} wpm` }) : null);
      return b;
    });
    const extras = EXTRAS.map(x => {
      const on1 = view === 'lesson' && extra === x.id;
      const best = bestOf(x.id);
      return h('button.tl__item' + (on1 ? '.is-on' : ''), { type: 'button', dataset: { extra: x.id }, 'aria-current': on1 ? 'true' : null, onclick: () => openExtra(x.id) },
        h('span.tl__num', api.icon(x.icon, { size: 12 })), h('span', { text: x.name }), best ? h('em', { text: `${best.wpm} wpm` }) : null);
    });
    nav.replaceChildren(...items, h('div.tl__sep'), h('div.tl__group', { text: 'Practice' }), ...extras, h('div.tl__sep'),
      h('button.tl__item' + (view === 'progress' ? '.is-on' : ''), { type: 'button', dataset: { view: 'progress' }, 'aria-current': view === 'progress' ? 'true' : null,
        onclick: () => { view = 'progress'; stopTick(); paint(); } }, h('span.tl__num', api.icon('trending-up', { size: 12 })), h('span', { text: 'Progress' })));
  }

  function openLesson(i) {
    cur = i; extra = null; view = 'lesson'; stopTick(); run = fresh(); paint();
    focusInput();
  }
  function openExtra(id) {
    extra = id; view = 'lesson'; stopTick(); run = fresh(); paint();
    focusInput();
  }

  /* ---- keyboard drawing ---- */
  const keyEls = new Map();            /* 'a' -> element; 'shiftL', 'shiftR', ' ' */
  const FINGER_HUE = { 'left pinky': 330, 'left ring': 20, 'left middle': 50, 'left index': 140, 'right index': 190, 'right middle': 230, 'right ring': 270, 'right pinky': 300, thumb: 210 };
  const fingerStyle = f => (f ? { '--f': `hsl(${FINGER_HUE[f]} 60% 55%)` } : null);
  function keyboard() {
    keyEls.clear();
    const I = layoutInfo(opt.layout);
    const rows = I.rows.map(r => {
      let shiftSeen = 0;
      return h('div.tl__row', ...r.map(k => {
        let top = '', id = null, wide = '', label = k;
        if (k.length === 2 && !/[a-z]/.test(k[0])) { top = k[1]; label = k[0]; id = k[0]; }
        else if (k.length === 1) id = k;
        else if (k === 'Shift') { id = shiftSeen++ === 0 ? 'shiftL' : 'shiftR'; wide = '2'; }
        else if (k === 'Space') { id = ' '; wide = '6'; label = ''; }
        else wide = k === 'Backspace' || k === 'Enter' || k === 'Caps' || k === 'Tab' ? '1' : '';
        const finger = id && I.fingerOf[id];
        const b = h('div.tl__k', { dataset: { key: id || k, wide: wide || null, finger: finger || null }, style: fingerStyle(finger), 'aria-hidden': 'true' },
          h('small', { text: top }), h('span', { text: label }));
        if (id) keyEls.set(id, b);
        return b;
      }));
    });
    return h('div.tl__kb', { 'aria-hidden': 'true', dataset: { layout: opt.layout } }, ...rows);
  }
  function numpad() {
    keyEls.clear();
    const rows = PAD.map(r => h('div.tl__row', ...r.map(([k, f]) => {
      const b = h('div.tl__k', { dataset: { key: k || 'blank', finger: f || null, wide: k === '0' ? '2' : null, blank: k ? null : '1' }, style: fingerStyle(f), 'aria-hidden': 'true' }, h('small', { text: '' }), h('span', { text: k }));
      if (k.length === 1) keyEls.set(k, b);
      return b;
    })));
    return h('div.tl__kb.tl__kb--pad', { 'aria-hidden': 'true', dataset: { layout: 'numpad' } }, ...rows);
  }

  function lightNext() {
    for (const b of keyEls.values()) b.classList.remove('is-next', 'is-shift');
    const nextEl = main.querySelector('.tl__next');
    if (!run || run.done) { if (nextEl) nextEl.textContent = ''; return; }
    const ch = run.text[run.pos];
    if (ch === undefined) return;
    const name = ch === ' ' ? 'Space' : ch;
    if (run.pad && PAD_FINGER[ch]) {
      keyEls.get(ch)?.classList.add('is-next');
      if (nextEl) nextEl.replaceChildren('Next key ', h('b', { text: `“${name}”` }), ' on the number pad with your ', h('b', { text: PAD_FINGER[ch] }), '.');
      return;
    }
    const k = keyFor(ch, opt.layout);
    keyEls.get(k.base)?.classList.add('is-next');
    if (k.shift) keyEls.get(k.shift === 'left' ? 'shiftL' : 'shiftR')?.classList.add('is-shift');
    const finger = layoutInfo(opt.layout).fingerOf[k.base] || 'finger';
    if (nextEl) {
      nextEl.replaceChildren('Next key ', h('b', { text: name === ' ' ? 'Space' : `“${name}”` }), ' with your ', h('b', { text: finger }),
        ...(k.shift ? [' and ', h('b', { text: (k.shift === 'left' ? 'left' : 'right') + ' Shift' })] : []), '.');
    }
  }

  /* ---- key click sounds: one short tick per key, lower for a slip ---- */
  let actx = null;
  function click(okKey) {
    if (!opt.sound || store.get('prefs.muted', false) === true) return;
    const vol = Math.max(0, Math.min(100, Number(store.get('prefs.volume', 62)) || 0)) / 100;
    if (!vol) return;
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(okKey ? 1900 : 320, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06 * vol, t + 0.002);
      g.gain.linearRampToValueAtTime(0, t + (okKey ? 0.025 : 0.07));
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + 0.09);
    } catch (e) { /* no sound here: typing goes on */ }
  }

  /* ---- the lesson screen ---- */
  let textEl, statEls, inputEl;
  function paintText() {
    if (!textEl) return;
    const t = run.text;
    const spans = [];
    for (let i = 0; i < t.length; i++) {
      let c = 'tl__ch';
      if (i < run.pos) c += run.errs.has(i) ? ' is-err' : ' is-ok'; else if (i === run.pos && !run.done) c += run.miss ? ' is-now is-miss' : ' is-now';
      spans.push(h('span', { class: c, text: t[i] === ' ' ? ' ' : t[i] }));
    }
    textEl.replaceChildren(...spans);
    textEl.setAttribute('aria-label', `Type this: ${t}. ${run.pos} of ${t.length} characters done.`);
    const now = textEl.querySelector('.is-now');
    if (now && textEl.scrollHeight > textEl.clientHeight) { const top = now.offsetTop - textEl.clientHeight / 3; if (Math.abs(textEl.scrollTop - top) > 20) textEl.scrollTop = Math.max(0, top); }
  }
  const rightChars = () => run.pos - run.errs.size;
  function paintStats() {
    const ms = run.startAt ? (run.done ? run.result.ms : performance.now() - run.startAt) : 0;
    statEls.wpm.textContent = run.done ? String(run.result.wpm) : run.startAt && ms > 2000 ? String(Math.round(wpmOf(rightChars(), ms))) : '—';
    statEls.acc.textContent = run.all ? `${pct(run).toFixed(1)}%` : '—';
    statEls.prog.textContent = run.secs ? `${rightChars()} right` : `${run.pos} / ${run.text.length}`;
    if (statEls.time) statEls.time.textContent = clockText(run.secs * 1000 - (run.startAt ? (run.done ? run.result.ms : performance.now() - run.startAt) : 0));
  }
  const clockText = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function options() {
    const tog = (fk, label, pressed, fn, title) => h('button.tl__opt', { type: 'button', dataset: { fk }, 'aria-pressed': String(pressed), title: title || '', onclick: () => { fn(); save(); paint(); focusInput(); } }, label);
    const layout = h('select', { 'aria-label': 'Keyboard guide', dataset: { fk: 'tl-layout' }, onchange: e => { opt.layout = e.target.value; save(); paint(); focusInput(); } },
      ...Object.entries(LAYOUTS).map(([id, L]) => h('option', { value: id, text: `${L.name} guide`, selected: opt.layout === id })));
    return h('div.tl__opts', { role: 'group', 'aria-label': 'Options' },
      tog('tl-kb', opt.kb ? 'Hide keyboard' : 'Show keyboard', !opt.kb, () => { opt.kb = !opt.kb; }),
      tog('tl-stop', opt.stop ? 'On a mistake: stop' : 'On a mistake: carry on', !opt.stop, () => { opt.stop = !opt.stop; run = fresh(); },
        'Stop: the key must be typed right to go on. Carry on: the slip is marked and you keep going; Backspace goes back to fix it.'),
      layout,
      tog('tl-sound', opt.sound ? 'Key sounds on' : 'Key sounds off', opt.sound, () => { opt.sound = !opt.sound; }));
  }

  function lessonScreen() {
    const L = lessonNow();
    if (!run || run.id !== L.id || (!L.secs && !run.startAt && run.text !== L.text)) run = fresh();
    if (L.id === 'own' && !ownText) return ownScreen(L);
    if (L.id === 'slow' && !L.text) return slowWaitScreen(L);
    textEl = h('div.tl__text', { role: 'group', tabindex: '-1', dataset: { text: run.text } });
    inputEl = h('input.tl__in', { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': `Typing ${L.extra ? 'practice' : 'lesson'}: ${L.name}. Type the text shown.` });
    statEls = { wpm: h('b'), acc: h('b'), prog: h('b'), time: run.secs ? h('b', { dataset: { fk: 'tl-time' } }) : null };
    const stat = (label, b) => h('div.tl__stat', h('span', { text: label }), b);
    const kb = !opt.kb ? null : run.pad ? numpad() : keyboard();
    if (!kb) keyEls.clear();
    main.replaceChildren(
      h('div.tl__head', h('h2', { text: L.extra ? L.name : `Lesson ${cur + 1}: ${L.name}` }), h('p', { text: L.blurb })),
      h('div.tl__stats', { 'aria-live': 'off' }, stat('Speed (WPM)', statEls.wpm), stat('Accuracy', statEls.acc), stat(run.secs ? 'Typed right' : 'Progress', statEls.prog), statEls.time ? stat('Time left', statEls.time) : null),
      h('div', { style: { position: 'relative' } }, textEl, inputEl),
      h('div.tl__next', { 'aria-live': 'polite' }),
      kb,
      options(),
      h('div.tl__btns', h('button.tl__btn', { type: 'button', text: 'Restart', onclick: () => { stopTick(); run = fresh(); paint(); focusInput(); } }),
        L.id === 'own' ? h('button.tl__btn', { type: 'button', dataset: { fk: 'tl-own-edit' }, text: 'Change the text', onclick: () => { stopTick(); ownEditing = true; paint(); } }) : null));
    textEl.addEventListener('pointerdown', e => { e.preventDefault(); focusNow(); });
    inputEl.addEventListener('paste', e => e.preventDefault());
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeyDown);
    paintText(); paintStats(); lightNext();
    if (run.done) showResult();
  }

  /* your own text: written or pasted here, kept on this device */
  let ownEditing = false;
  function ownScreen(L) {
    const ta = h('textarea', { 'aria-label': 'Text to practise', maxlength: '4000', placeholder: 'Paste or type the text you want to practise…', dataset: { fk: 'tl-own-text' } });
    ta.value = ownText;
    const note = h('small', { dataset: { fk: 'tl-own-note' }, role: 'status' });
    main.replaceChildren(h('div.tl__head', h('h2', { text: L.name }), h('p', { text: L.blurb })),
      h('div.tl__own', ta, note, h('div.tl__btns', h('button.tl__btn.tl__btn--go', { type: 'button', dataset: { fk: 'tl-own-go' }, text: 'Practise this', onclick: () => {
        const c = cleanOwn(ta.value);
        if (c.text.length < 5) { note.textContent = 'Write at least a few words first.'; return; }
        ownText = c.text; ownEditing = false; save();
        run = fresh(); paint(); focusInput();
        if (c.dropped) { const nx = main.querySelector('.tl__next'); if (nx) nx.textContent = `${c.dropped} character${c.dropped === 1 ? '' : 's'} a standard keyboard can’t type ${c.dropped === 1 ? 'was' : 'were'} left out.`; }
      } }))),
      h('small', { text: 'Line breaks become spaces; curly quotes and dashes become the ones on the keyboard. Up to 2,000 characters.' }));
    requestAnimationFrame(() => { if (!dead && ta.isConnected) ta.focus(); });
  }
  function slowWaitScreen(L) {
    const timed = Object.values(keyStats).reduce((t, v) => t + v.n, 0);
    main.replaceChildren(h('div.tl__head', h('h2', { text: L.name }), h('p', { text: L.blurb })),
      h('div.tl__empty', { dataset: { empty: 'slow' }, text: `Not enough timings yet. The slowest keys come from your own typing: ${timed} of the ${MIN_TIMED} timed keystrokes needed so far, and at least ${MIN_PER_KEY} of a key before it can be named. Type a few more lessons and this drill will be made for you.` }));
  }

  const focusNow = () => { if (!dead && inputEl && inputEl.isConnected) inputEl.focus({ preventScroll: true }); };
  const focusInput = () => requestAnimationFrame(() => { if (!dead && inputEl && inputEl.isConnected) inputEl.focus({ preventScroll: true }); });

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); stopTick(); run = fresh(); paint(); focusInput(); return; }
    if (e.key === 'Enter' && run.done && run.result.passed && !extra && cur < LESSONS.length - 1) { e.preventDefault(); openLesson(cur + 1); return; }
    if (e.key === 'Backspace' && !opt.stop && run && !run.done && run.pos > 0) {
      /* carrying on: go back one letter to fix it (it is not a keystroke, and does not undo the count) */
      e.preventDefault();
      run.pos--; run.errs.delete(run.pos); run.miss = false; run.lastOkAt = 0;
      paintText(); paintStats(); lightNext();
      return;
    }
    const I = layoutInfo(opt.layout);
    const id = e.key.length === 1 ? e.key.toLowerCase() : e.key === 'Shift' ? (e.location === 2 ? 'shiftR' : 'shiftL') : null;
    const el = id && keyEls.get(run && run.pad ? e.key : (I.shifted[e.key] || id));
    if (el) { el.classList.add('is-hit'); setTimeout(() => el.classList.remove('is-hit'), 120); }
  }

  function startTick() { if (run.secs && !tick) tick = setInterval(onTick, 200); }
  function stopTick() { clearInterval(tick); tick = 0; }
  function onTick() {
    if (dead || !run || run.done || !run.secs || !run.startAt) return;
    if (performance.now() - run.startAt >= run.secs * 1000) finish();
    else paintStats();
  }

  function onInput() {
    const typed = inputEl.value;
    inputEl.value = '';
    if (!run || run.done) return;
    /* a whole word at once is a paste or autofill, not typing: it would score a speed no hand can reach */
    if ([...typed].length > 4) { const nx = main.querySelector(".tl__next"); if (nx) nx.textContent = "Type the keys one at a time. Pasting is turned off in lessons."; return; }
    for (const ch of typed) {
      if (run.done) break;
      const t = performance.now();
      if (!run.startAt) { run.startAt = t; startTick(); }
      if (run.secs && t - run.startAt >= run.secs * 1000) { finish(); break; }
      run.all++;
      const want = run.text[run.pos];
      if (ch === want) {
        /* timed only when the key before was right too: the gap is how long this key took */
        if (run.lastOkAt && !run.miss) {
          const gap = t - run.lastOkAt;
          if (gap > 0 && gap <= MAX_GAP) { const k = keyFor(want, opt.layout).base; const s = keyStats[k] || { n: 0, ms: 0 }; keyStats[k] = { n: s.n + 1, ms: s.ms + Math.round(gap) }; }
        }
        run.ok++; run.pos++; run.miss = false; run.lastOkAt = t;
        click(true);
      } else if (!opt.stop) {
        run.errs.add(run.pos); run.pos++; run.miss = false; run.lastOkAt = 0;
        click(false);
      } else { run.miss = true; run.lastOkAt = 0; click(false); }
      if (run.secs && run.text.length - run.pos < 80) run.text += ` ${testWords(40)}`;
      if (run.pos >= run.text.length) { finish(); break; }
    }
    if (!run.done) { paintText(); paintStats(); lightNext(); }
  }

  function finish() {
    stopTick();
    const L = lessonNow();
    const elapsed = Math.max(1, performance.now() - run.startAt);
    const ms = run.secs ? Math.min(elapsed, run.secs * 1000) : elapsed;
    if (run.secs) run.text = run.text.slice(0, Math.max(run.pos, 1));
    const right = rightChars();
    const wpm = Math.round(wpmOf(right, ms));     /* stopping on mistakes, every character counted is right: a wrong key never advanced */
    run.done = true;
    if (!run.all) { paint(); return; }           /* a test that ran out with nothing typed records nothing */
    const rec = { t: Date.now(), lesson: L.id, wpm, ok: run.ok, all: run.all, ms: Math.round(ms) };
    if (run.errs.size) rec.left = run.errs.size;
    if (run.secs) rec.chars = right;
    run.result = { wpm, ms, passed: passed(rec), acc: pct(rec), left: run.errs.size };
    runs.push(rec);
    save();
    if (run.result.passed && !L.extra) api.bus.emit('typing:lesson', { lesson: rec.lesson, wpm, acc: run.result.acc });
    paintNav();
    paintText(); paintStats(); lightNext();
    showResult();
  }

  function showResult() {
    const r = run.result;
    if (!r) return;
    const L = lessonNow();
    const last = !L.extra && cur === LESSONS.length - 1;
    const left = r.left ? ` ${r.left} mistake${r.left === 1 ? '' : 's'} left in the text.` : '';
    const box = L.extra
      ? h('div.tl__done', { role: 'status', dataset: { result: 'done' } },
        h('h3', { text: run.secs ? 'Time is up' : 'Finished' }),
        h('p', { text: `${r.wpm} WPM at ${r.acc.toFixed(1)}% accuracy${run.secs ? `: ${rightChars()} characters right in ${run.secs / 60} minute${run.secs === 60 ? '' : 's'}` : ''}.${left}` }),
        h('div.tl__btns', h('button.tl__btn', { type: 'button', text: 'Try again', onclick: () => { run = fresh(); paint(); focusInput(); } })))
      : h('div.tl__done', { role: 'status', dataset: { result: r.passed ? 'pass' : 'retry' } },
        h('h3', { text: r.passed ? (last ? 'Course complete' : 'Lesson passed') : 'Almost there' }),
        h('p', { text: `${r.wpm} WPM at ${r.acc.toFixed(1)}% accuracy.${left} ` + (r.passed
          ? (last ? 'You have finished every lesson. Keep practising any of them to raise your speed.' : `Lesson ${cur + 2}, ${LESSONS[cur + 1].name}, is open.`)
          : `You need ${PASS * 100}% accuracy to open the next lesson. Slow down a little and aim for every key.`) }),
        h('div.tl__btns',
          r.passed && !last ? h('button.tl__btn.tl__btn--go', { type: 'button', text: `Next: ${LESSONS[cur + 1].name}`, onclick: () => openLesson(cur + 1) }) : null,
          h('button.tl__btn', { type: 'button', text: 'Try again', onclick: () => { run = fresh(); paint(); focusInput(); } })));
    main.querySelector('.tl__opts')?.before(box);
    paintStats();
    if (box.querySelector('.tl__btn--go')) requestAnimationFrame(() => box.querySelector('.tl__btn--go')?.focus({ preventScroll: true }));
  }

  /* ---- progress: records only ---- */
  function progressScreen() {
    const head = h('div.tl__head', h('h2', { text: 'Your progress' }),
      h('p', { text: `Each finished lesson, practice and test is a record. The chart shows the average WPM and accuracy of the ones you finished each ${opt.by === 'week' ? 'week (weeks start on Monday)' : 'day'}.` }));
    const slow = slowCard();
    if (!runs.length) {
      main.replaceChildren(head, h('div.tl__empty', { dataset: { empty: '1' }, text: 'No records yet. Finish a lesson and your speed and accuracy will appear here — nothing is shown until you have typed something.' }), slow);
      return;
    }
    const bucket = opt.by === 'week' ? weekOf : dayOf;
    const byDay = new Map();
    for (const r of runs) {
      const k = bucket(r.t);
      const d = byDay.get(k) || { day: k, n: 0, wpm: 0, ok: 0, all: 0 };
      d.n++; d.wpm += r.wpm; d.ok += r.ok; d.all += r.all;
      byDay.set(k, d);
    }
    const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(d => ({ day: d.day, n: d.n, wpm: Math.round(d.wpm / d.n), acc: Math.floor((d.ok / d.all) * 1000) / 10 }));
    const recent = runs.slice(-8).reverse();
    const by = (id, label) => h('button.tl__opt', { type: 'button', dataset: { fk: `tl-by-${id}` }, 'aria-pressed': String(opt.by === id), onclick: () => { opt.by = id; save(); paint(); } }, label);
    main.replaceChildren(head, chart(days, opt.by),
      h('div.tl__legend', h('span', h('i', { style: { background: 'var(--accent)' } }), 'WPM (left scale)'), h('span', h('i', { style: { background: '#4aa3ff' } }), 'Accuracy % (right scale)'),
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' }, role: 'group', 'aria-label': 'Chart by' }, by('day', 'By day'), by('week', 'By week'))),
      slow,
      h('table.tl__runs', { 'aria-label': 'Recent records' },
        h('thead', h('tr', ...['When', 'Lesson', 'WPM', 'Accuracy'].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', ...recent.map(r => h('tr', { dataset: { run: r.lesson } },
          h('td', { text: new Date(r.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
          h('td', { text: nameOf(r.lesson) }),
          h('td', { text: String(r.wpm) }), h('td', { text: `${pct(r).toFixed(1)}%` }))))));
  }
  function slowCard() {
    const sk = slowestKeys(keyStats);
    const timed = Object.values(keyStats).reduce((t, v) => t + v.n, 0);
    if (!sk) return h('p.tl__empty', { dataset: { fk: 'tl-slow-wait' }, text: `Slowest keys: ${timed} of ${MIN_TIMED} timed keystrokes so far. Once there are enough, the keys that take you longest are named here, from your real timings, with a drill made from them.` });
    return h('div', { dataset: { fk: 'tl-slow' } }, h('div.tl__head', h('p', { text: `Your slowest keys, from ${timed} timed keystrokes (the gap before each key you typed right after another right one):` })),
      h('ul.tl__slow', ...sk.map(k => h('li', { dataset: { key: k.key, avg: String(Math.round(k.avg)) } }, h('b', { text: k.key }), `${Math.round(k.avg)} ms on average, ${k.n} times`))),
      h('div.tl__btns', h('button.tl__btn', { type: 'button', dataset: { fk: 'tl-slow-go' }, text: 'Practise them', onclick: () => openExtra('slow') })));
  }

  function chart(days, by) {
    const W = 640, H = 260, L = 40, R = 40, T = 16, B = 34;
    const iw = W - L - R, ih = H - T - B;
    const maxW = Math.max(10, Math.ceil(Math.max(...days.map(d => d.wpm)) / 10) * 10);
    const minA = Math.min(100, Math.floor(Math.min(...days.map(d => d.acc), 90) / 10) * 10);
    const x = i => L + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
    const yW = v => T + ih - (v / maxW) * ih;
    const yA = v => T + ih - ((v - minA) / (100 - minA)) * ih;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, ...kids) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
      n.append(...kids);
      return n;
    };
    const per = by === 'week' ? 'week' : 'day';
    const label = d => (per === 'week' ? `week of ${d.day}` : d.day);
    const svg = el('svg', { class: 'tl__chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'data-points': String(days.length), 'data-by': per,
      'aria-label': `WPM and accuracy per ${per}. ` + days.map(d => `${label(d)}: ${d.wpm} WPM, ${d.acc} percent`).join('; ') });
    for (let g = 0; g <= 4; g++) {
      const y = T + (ih * g) / 4;
      svg.append(el('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '.12' }),
        el('text', { x: L - 6, y: y + 3, 'text-anchor': 'end' }, String(Math.round(maxW * (1 - g / 4)))),
        el('text', { x: W - R + 6, y: y + 3 }, String(Math.round(minA + (100 - minA) * (1 - g / 4)))));
    }
    const line = (f, colour) => el('polyline', { points: days.map((d, i) => `${x(i)},${f(d)}`).join(' '), fill: 'none', stroke: colour, 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
    svg.append(line(d => yW(d.wpm), 'var(--accent)'), line(d => yA(d.acc), '#4aa3ff'));
    days.forEach((d, i) => {
      svg.append(el('circle', { cx: x(i), cy: yW(d.wpm), r: 4, fill: 'var(--accent)', 'data-day': d.day }, el('title', {}, `${label(d)}: ${d.wpm} WPM (${d.n} record${d.n > 1 ? 's' : ''})`)),
        el('circle', { cx: x(i), cy: yA(d.acc), r: 4, fill: '#4aa3ff' }, el('title', {}, `${label(d)}: ${d.acc}% accuracy`)));
      if (days.length <= 8 || i % Math.ceil(days.length / 8) === 0) svg.append(el('text', { x: x(i), y: H - 12, 'text-anchor': 'middle' }, (per === 'week' ? 'wk ' : '') + d.day.slice(5)));
    });
    return svg;
  }

  function paint() {
    paintNav();
    if (view === 'progress') { progressScreen(); win.setSubtitle('Progress'); return; }
    if (extra === 'own' && ownEditing) { ownScreen(lessonNow()); win.setSubtitle(nameOf('own')); return; }
    lessonScreen();
    win.setSubtitle(extra ? nameOf(extra) : `Lesson ${cur + 1} of ${LESSONS.length}`);
  }

  /* a click anywhere on the lesson (not on a button) refocuses the typing field */
  on(main, 'pointerdown', e => { if (view === 'lesson' && !e.target.closest('button,textarea,select')) focusNow(); });
  /* typing while focus is on the window frame still counts */
  on(window, 'keydown', e => {
    if (view !== 'lesson' || !inputEl || !inputEl.isConnected || document.activeElement === inputEl || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!win.el.classList.contains('is-active')) return;
    if (document.activeElement && document.activeElement.closest('button,input,textarea,select,a[href]')) return;
    if (e.key.length === 1 || e.key === 'Escape') { inputEl.focus({ preventScroll: true }); }
  });

  paint();
  focusInput();
  /* what a test (or a curious person) can ask for */
  root.typingPeek = () => ({ keys: { ...keyStats }, opt: { ...opt }, run: run && { id: run.id, pos: run.pos, errs: [...run.errs], text: run.text, done: run.done } });
  return () => { dead = true; stopTick(); offs.splice(0).forEach(f => f()); try { actx && actx.close && actx.close(); } catch (e) { /* gone */ } };
}
