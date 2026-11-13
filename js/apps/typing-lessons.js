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
   prefs.typingLessons; the Progress chart is drawn only from those. With
   no records it says so — nothing is made up.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { wpmOf } from '../arcade/typing.js';

export const PASS = 0.9;          /* accuracy that opens the next lesson */

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

/* ---- the keyboard ---- */
const ROWS = [
  ['`~', '1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '-_', '=+', 'Backspace'],
  ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[{', ']}', '\\|'],
  ['Caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';:', '\'"', 'Enter'],
  ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',<', '.>', '/?', 'Shift'],
  ['Space'],
];
const FINGERS = {
  'left pinky': '`1qaz', 'left ring': '2wsx', 'left middle': '3edc', 'left index': '45rtfgvb',
  'right index': '67yuhjnm', 'right middle': '8ik,', 'right ring': '9ol.', 'right pinky': '0p;/-=[]\'\\',
  thumb: ' ',
};
const FINGER_OF = {};
for (const [f, keys] of Object.entries(FINGERS)) for (const k of keys) FINGER_OF[k] = f;
const SHIFTED = {};
for (const r of ROWS) for (const k of r) if (k.length === 2 && !/[a-z]/.test(k[0])) SHIFTED[k[1]] = k[0];
const LEFT_HAND = new Set('`1qaz2wsx3edc45rtfgvb'.split(''));

/** The key to press (and Shift, if any) for a character: { base, shift:'left'|'right'|null }. */
export function keyFor(ch) {
  if (ch === ' ') return { base: ' ', shift: null };
  const lower = ch.toLowerCase();
  if (/[a-z]/.test(ch)) {
    return { base: lower, shift: ch !== lower ? (LEFT_HAND.has(lower) ? 'right' : 'left') : null };
  }
  if (SHIFTED[ch]) return { base: SHIFTED[ch], shift: LEFT_HAND.has(SHIFTED[ch]) ? 'right' : 'left' };
  return { base: ch, shift: null };
}
export const fingerFor = ch => FINGER_OF[keyFor(ch).base] || 'finger';

/* ---- progress records ---- */
const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pct = r => Math.floor((r.ok / r.all) * 1000) / 10;         /* floored: 89.96 never shows as 90 */
const passed = r => r.all > 0 && r.ok * 10 >= r.all * 9;         /* whole-number arithmetic: 0.9 × 70 is not exactly 63 in floating point */

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
.tl__main{flex:1;min-width:0;overflow:auto;padding:var(--sp-5);display:flex;flex-direction:column;gap:var(--sp-4)}
.tl__head h2{margin:0;font-size:var(--fs-18);color:var(--ink-0)}
.tl__head p{margin:4px 0 0;font-size:var(--fs-12);color:var(--ink-2);max-width:62ch;line-height:1.5}
.tl__stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3)}
.tl__stat{padding:var(--sp-3) var(--sp-4);border-radius:var(--r-md);background:var(--fill-0);border:1px solid var(--line-0)}
.tl__stat span{display:block;font-size:var(--fs-10);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.tl__stat b{font-size:var(--fs-18);color:var(--ink-0);font-variant-numeric:tabular-nums}
.tl__text{position:relative;padding:var(--sp-5);border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);font:500 clamp(17px,3.2cqw,26px)/1.7 var(--mono);letter-spacing:.02em;color:var(--ink-3);cursor:text;word-break:break-word}
.tl__ch{border-radius:3px}
.tl__ch.is-ok{color:var(--ink-0)}
.tl__ch.is-now{background:var(--fill-accent-hi);color:var(--ink-0);box-shadow:0 0 0 2px var(--fill-accent-hi)}
.tl__ch.is-miss{background:rgba(248,113,113,.35)}
.tl__in{position:absolute;opacity:0;width:1px;height:1px;left:0;top:0;pointer-events:none}
.tl__next{font-size:var(--fs-13);color:var(--ink-2);min-height:20px}
.tl__next b{color:var(--ink-0)}
.tl__kb{display:flex;flex-direction:column;gap:4px;align-items:center;padding:var(--sp-3);border-radius:var(--r-lg);background:var(--fill-0);border:1px solid var(--line-0)}
.tl__row{display:flex;gap:4px;width:100%;justify-content:center}
.tl__k{--f:var(--ink-3);flex:1 1 0;max-width:46px;min-width:0;height:36px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 12px/1 var(--mono);
  color:var(--ink-1);background:color-mix(in srgb,var(--f) 16%,var(--fill-0));border:1px solid color-mix(in srgb,var(--f) 40%,transparent)}
.tl__k small{font-size:9px;opacity:.7;font-weight:500;min-height:9px}
.tl__k[data-wide="1"]{flex:1.5 1 0;max-width:70px}
.tl__k[data-wide="2"]{flex:2 1 0;max-width:92px}
.tl__k[data-wide="6"]{flex:6 1 0;max-width:280px}
.tl__k.is-next{background:var(--accent);color:var(--accent-ink);border-color:var(--ink-0);box-shadow:0 0 0 2px var(--fill-accent-hi),var(--glow);transform:translateY(-1px)}
.tl__k.is-shift{background:color-mix(in srgb,var(--accent) 55%,var(--fill-1));color:var(--accent-ink);border-color:var(--ink-0)}
.tl__k.is-hit{background:var(--fill-3)}
.tl__btns{display:flex;gap:var(--sp-3);flex-wrap:wrap}
.tl__btn{height:32px;padding:0 14px;border-radius:var(--r-sm);background:var(--fill-2);color:var(--ink-0);font-size:var(--fs-13);font-weight:600;border:1px solid var(--line-1)}
.tl__btn:hover{background:var(--fill-3)}
.tl__btn--go{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.tl__done{padding:var(--sp-5);border-radius:var(--r-lg);background:var(--fill-0);border:1px solid var(--line-1);display:flex;flex-direction:column;gap:var(--sp-3)}
.tl__done h3{margin:0;font-size:var(--fs-18);color:var(--ink-0)}
.tl__done p{margin:0;font-size:var(--fs-13);color:var(--ink-2);line-height:1.5}
.tl__chart{width:100%;height:auto;border-radius:var(--r-md);background:var(--fill-0);border:1px solid var(--line-0)}
.tl__chart text{font:10px var(--font);fill:var(--ink-3)}
.tl__legend{display:flex;gap:var(--sp-5);font-size:var(--fs-12);color:var(--ink-2)}
.tl__legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.tl__runs{width:100%;border-collapse:collapse;font-size:var(--fs-12)}
.tl__runs th,.tl__runs td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line-0);font-variant-numeric:tabular-nums}
.tl__runs th{color:var(--ink-3);font-weight:600}
.tl__empty{color:var(--ink-3);font-size:var(--fs-13);line-height:1.6;padding:var(--sp-5);border:1px dashed var(--line-2);border-radius:var(--r-lg)}
@container (max-width:560px){.tl__wrap{flex-direction:column}.tl__nav{flex:0 0 auto;flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line-1)}.tl__item{width:auto;white-space:nowrap}.tl__item em{display:none}.tl__sep{display:none}}
`;

defineApp({
  id: 'typing',
  name: 'Typing Lessons',
  icon: 'keyboard',
  g1: '#ffd27a', g2: '#d9731a',
  category: 'Utilities',
  keywords: ['typing', 'touch type', 'keyboard', 'wpm', 'lessons', 'learn', 'home row', 'practice', 'school', 'speed'],
  desc: 'Learn to touch-type from the home row up, and watch your speed grow',
  win: { w: 860, h: 640, minW: 520, minH: 460 },
  shortcuts: [
    ['Esc', 'Restart the lesson'],
    ['Enter', 'Next lesson, once you have passed'],
  ],
  mount({ root, win, api }) { return build(root, win, api); },
});

function build(root, win, api) {
  const store = api.store;
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };

  const loadRuns = () => {
    const v = store.get('prefs.typingLessons');
    const runs = v && Array.isArray(v.runs) ? v.runs : [];
    return runs.filter(r => r && typeof r.lesson === 'string' && Number.isFinite(r.t) && Number.isFinite(r.wpm) && r.all > 0 && r.ok >= 0 && r.ok <= r.all);
  };
  let runs = loadRuns();
  const saveRuns = () => store.set('prefs.typingLessons', { runs: runs.slice(-400) });

  const passedLesson = id => runs.some(r => r.lesson === id && passed(r));
  const unlocked = i => i === 0 || passedLesson(LESSONS[i - 1].id);
  const bestOf = id => runs.filter(r => r.lesson === id).reduce((b, r) => (!b || r.wpm > b.wpm ? r : b), null);

  /* ---- state of the open lesson ---- */
  let view = 'lesson';                 /* 'lesson' | 'progress' */
  let cur = firstOpen();
  let run = null;                      /* { text, pos, ok, all, startAt, done, result } */

  function firstOpen() {
    for (let i = 0; i < LESSONS.length; i++) if (unlocked(i) && !passedLesson(LESSONS[i].id)) return i;
    return LESSONS.length - 1;
  }
  const fresh = () => ({ text: LESSONS[cur].text, pos: 0, ok: 0, all: 0, startAt: 0, done: false, result: null, miss: false });

  const nav = h('nav.tl__nav', { 'aria-label': 'Lessons' });
  const main = h('div.tl__main');
  root.appendChild(h('div.tl', h('style', { text: CSS }), h('div.tl__wrap', nav, main)));

  function paintNav() {
    const items = LESSONS.map((l, i) => {
      const open = unlocked(i);
      const best = bestOf(l.id);
      const b = h('button.tl__item' + (view === 'lesson' && cur === i ? '.is-on' : '') + (passedLesson(l.id) ? '.is-done' : ''), {
        type: 'button', dataset: { lesson: l.id, locked: open ? '0' : '1', passed: passedLesson(l.id) ? '1' : '0' },
        'aria-disabled': open ? null : 'true',
        'aria-current': view === 'lesson' && cur === i ? 'true' : null,
        'aria-label': `Lesson ${i + 1}, ${l.name}` + (open ? '' : `. Locked: finish ${LESSONS[i - 1].name} with ${PASS * 100}% accuracy to open it`)
          + (best ? `. Best ${best.wpm} words per minute` : ''),
        title: open ? '' : `Finish “${LESSONS[i - 1].name}” with ${PASS * 100}% accuracy or better to unlock`,
        onclick: () => { if (open) openLesson(i); },
      }, h('span.tl__num', passedLesson(l.id) ? api.icon('check', { size: 12 }) : open ? String(i + 1) : api.icon('lock', { size: 11 })),
        h('span', { text: l.name }), best ? h('em', { text: `${best.wpm} wpm` }) : null);
      return b;
    });
    nav.replaceChildren(...items, h('div.tl__sep'),
      h('button.tl__item' + (view === 'progress' ? '.is-on' : ''), { type: 'button', dataset: { view: 'progress' }, 'aria-current': view === 'progress' ? 'true' : null,
        onclick: () => { view = 'progress'; paint(); } }, h('span.tl__num', api.icon('trending-up', { size: 12 })), h('span', { text: 'Progress' })));
  }

  function openLesson(i) {
    cur = i; view = 'lesson'; run = fresh(); paint();
    focusInput();
  }

  /* ---- keyboard drawing ---- */
  const keyEls = new Map();            /* 'a' -> element; 'shiftL', 'shiftR', ' ' */
  function keyboard() {
    keyEls.clear();
    const rows = ROWS.map(r => {
      let shiftSeen = 0;
      return h('div.tl__row', ...r.map(k => {
        let base = k, top = '', id = null, wide = '', label = k;
        if (k.length === 2 && !/[a-z]/.test(k[0])) { base = k[0]; top = k[1]; label = k[0]; id = k[0]; }
        else if (k.length === 1) id = k;
        else if (k === 'Shift') { id = shiftSeen++ === 0 ? 'shiftL' : 'shiftR'; wide = '2'; }
        else if (k === 'Space') { id = ' '; wide = '6'; label = ''; }
        else wide = k === 'Backspace' || k === 'Enter' || k === 'Caps' || k === 'Tab' ? '1' : '';
        const finger = id && FINGER_OF[id];
        const b = h('div.tl__k', { dataset: { key: id || k, wide: wide || null, finger: finger || null },
          style: finger ? { '--f': `hsl(${FINGER_HUE[finger]} 60% 55%)` } : null, 'aria-hidden': 'true' },
          h('small', { text: top }), h('span', { text: label }));
        if (id) keyEls.set(id, b);
        return b;
      }));
    });
    return h('div.tl__kb', { 'aria-hidden': 'true' }, ...rows);
  }
  const FINGER_HUE = { 'left pinky': 330, 'left ring': 20, 'left middle': 50, 'left index': 140, 'right index': 190, 'right middle': 230, 'right ring': 270, 'right pinky': 300, thumb: 210 };

  function lightNext() {
    for (const b of keyEls.values()) b.classList.remove('is-next', 'is-shift');
    const nextEl = main.querySelector('.tl__next');
    if (!run || run.done) { if (nextEl) nextEl.textContent = ''; return; }
    const ch = run.text[run.pos];
    const k = keyFor(ch);
    keyEls.get(k.base)?.classList.add('is-next');
    if (k.shift) keyEls.get(k.shift === 'left' ? 'shiftL' : 'shiftR')?.classList.add('is-shift');
    const finger = FINGER_OF[k.base] || 'finger';
    const name = ch === ' ' ? 'Space' : ch;
    if (nextEl) {
      nextEl.replaceChildren('Next key ', h('b', { text: name === ' ' ? 'Space' : `“${name}”` }), ' with your ', h('b', { text: finger }),
        k.shift ? [' and ', h('b', { text: (k.shift === 'left' ? 'left' : 'right') + ' Shift' })] : '', '.');
    }
  }

  /* ---- the lesson screen ---- */
  let textEl, statEls, inputEl;
  function paintText() {
    if (!textEl) return;
    const t = run.text;
    const spans = [];
    for (let i = 0; i < t.length; i++) {
      let c = 'tl__ch';
      if (i < run.pos) c += ' is-ok'; else if (i === run.pos && !run.done) c += run.miss ? ' is-now is-miss' : ' is-now';
      spans.push(h('span', { class: c, text: t[i] === ' ' ? ' ' : t[i] }));
    }
    textEl.replaceChildren(...spans);
    textEl.setAttribute('aria-label', `Type this: ${t}. ${run.pos} of ${t.length} characters done.`);
  }
  function paintStats() {
    const ms = run.startAt ? (run.done ? run.result.ms : performance.now() - run.startAt) : 0;
    statEls.wpm.textContent = run.done ? String(run.result.wpm) : run.startAt && ms > 2000 ? String(Math.round(wpmOf(run.pos, ms))) : '—';
    statEls.acc.textContent = run.all ? `${pct(run).toFixed(1)}%` : '—';
    statEls.prog.textContent = `${run.pos} / ${run.text.length}`;
  }

  function lessonScreen() {
    if (!run || run.text !== LESSONS[cur].text) run = fresh();
    const L = LESSONS[cur];
    textEl = h('div.tl__text', { role: 'group', tabindex: '-1', dataset: { text: L.text } });
    inputEl = h('input.tl__in', { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': `Typing lesson: ${L.name}. Type the text shown.` });
    statEls = { wpm: h('b'), acc: h('b'), prog: h('b') };
    const stat = (label, b) => h('div.tl__stat', h('span', { text: label }), b);
    const kb = keyboard();
    main.replaceChildren(
      h('div.tl__head', h('h2', { text: `Lesson ${cur + 1}: ${L.name}` }), h('p', { text: L.blurb })),
      h('div.tl__stats', { 'aria-live': 'off' }, stat('Speed (WPM)', statEls.wpm), stat('Accuracy', statEls.acc), stat('Progress', statEls.prog)),
      h('div', { style: { position: 'relative' } }, textEl, inputEl),
      h('div.tl__next', { 'aria-live': 'polite' }),
      kb,
      h('div.tl__btns', h('button.tl__btn', { type: 'button', text: 'Restart', onclick: () => { run = fresh(); paint(); focusInput(); } })));
    textEl.addEventListener('pointerdown', e => { e.preventDefault(); focusNow(); });
    inputEl.addEventListener('paste', e => e.preventDefault());
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeyDown);
    paintText(); paintStats(); lightNext();
    if (run.done) showResult();
  }

  const focusNow = () => { if (!dead && inputEl && inputEl.isConnected) inputEl.focus({ preventScroll: true }); };
  const focusInput = () => requestAnimationFrame(() => { if (!dead && inputEl && inputEl.isConnected) inputEl.focus({ preventScroll: true }); });

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); run = fresh(); paint(); focusInput(); return; }
    if (e.key === 'Enter' && run.done && run.result.passed && cur < LESSONS.length - 1) { e.preventDefault(); openLesson(cur + 1); return; }
    const id = e.key.length === 1 ? e.key.toLowerCase() : e.key === 'Shift' ? (e.location === 2 ? 'shiftR' : 'shiftL') : null;
    const el = id && keyEls.get(SHIFTED[e.key] || id);
    if (el) { el.classList.add('is-hit'); setTimeout(() => el.classList.remove('is-hit'), 120); }
  }

  function onInput() {
    const typed = inputEl.value;
    inputEl.value = '';
    if (!run || run.done) return;
    /* a whole word at once is a paste or autofill, not typing: it would score a speed no hand can reach */
    if ([...typed].length > 4) { const nx = main.querySelector(".tl__next"); if (nx) nx.textContent = "Type the keys one at a time. Pasting is turned off in lessons."; return; }
    for (const ch of typed) {
      if (run.done) break;
      if (!run.startAt) run.startAt = performance.now();
      run.all++;
      if (ch === run.text[run.pos]) {
        run.ok++; run.pos++; run.miss = false;
        if (run.pos >= run.text.length) { finish(); break; }
      } else run.miss = true;
    }
    paintText(); paintStats(); lightNext();
  }

  function finish() {
    const ms = Math.max(1, performance.now() - run.startAt);
    const wpm = Math.round(wpmOf(run.text.length, ms));     /* every character is right: a wrong key never advanced */
    const rec = { t: Date.now(), lesson: LESSONS[cur].id, wpm, ok: run.ok, all: run.all, ms: Math.round(ms) };
    run.done = true;
    run.result = { wpm, ms, passed: passed(rec), acc: pct(rec) };
    runs.push(rec);
    saveRuns();
    if (run.result.passed) api.bus.emit('typing:lesson', { lesson: rec.lesson, wpm, acc: run.result.acc });
    paintNav();
    showResult();
  }

  function showResult() {
    const r = run.result, last = cur === LESSONS.length - 1;
    const box = h('div.tl__done', { role: 'status', dataset: { result: r.passed ? 'pass' : 'retry' } },
      h('h3', { text: r.passed ? (last ? 'Course complete' : 'Lesson passed') : 'Almost there' }),
      h('p', { text: `${r.wpm} WPM at ${r.acc.toFixed(1)}% accuracy. ` + (r.passed
        ? (last ? 'You have finished every lesson. Keep practising any of them to raise your speed.' : `Lesson ${cur + 2}, ${LESSONS[cur + 1].name}, is open.`)
        : `You need ${PASS * 100}% accuracy to open the next lesson. Slow down a little and aim for every key.`) }),
      h('div.tl__btns',
        r.passed && !last ? h('button.tl__btn.tl__btn--go', { type: 'button', text: `Next: ${LESSONS[cur + 1].name}`, onclick: () => openLesson(cur + 1) }) : null,
        h('button.tl__btn', { type: 'button', text: 'Try again', onclick: () => { run = fresh(); paint(); focusInput(); } })));
    main.querySelector('.tl__btns')?.before(box);
    paintStats();
    if (box.querySelector('.tl__btn--go')) requestAnimationFrame(() => box.querySelector('.tl__btn--go')?.focus({ preventScroll: true }));
  }

  /* ---- progress: records only ---- */
  function progressScreen() {
    const head = h('div.tl__head', h('h2', { text: 'Your progress' }),
      h('p', { text: 'Each finished lesson is a record. The chart shows the average WPM and accuracy of the lessons you finished on each day.' }));
    if (!runs.length) {
      main.replaceChildren(head, h('div.tl__empty', { dataset: { empty: '1' }, text: 'No records yet. Finish a lesson and your speed and accuracy will appear here — nothing is shown until you have typed something.' }));
      return;
    }
    const byDay = new Map();
    for (const r of runs) {
      const k = dayOf(r.t);
      const d = byDay.get(k) || { day: k, n: 0, wpm: 0, ok: 0, all: 0 };
      d.n++; d.wpm += r.wpm; d.ok += r.ok; d.all += r.all;
      byDay.set(k, d);
    }
    const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(d => ({ day: d.day, n: d.n, wpm: Math.round(d.wpm / d.n), acc: Math.floor((d.ok / d.all) * 1000) / 10 }));
    const recent = runs.slice(-8).reverse();
    main.replaceChildren(head, chart(days),
      h('div.tl__legend', h('span', h('i', { style: { background: 'var(--accent)' } }), 'WPM (left scale)'), h('span', h('i', { style: { background: '#4aa3ff' } }), 'Accuracy % (right scale)')),
      h('table.tl__runs', { 'aria-label': 'Recent records' },
        h('thead', h('tr', ...['When', 'Lesson', 'WPM', 'Accuracy'].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', ...recent.map(r => h('tr', { dataset: { run: r.lesson } },
          h('td', { text: new Date(r.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
          h('td', { text: LESSONS.find(l => l.id === r.lesson)?.name || r.lesson }),
          h('td', { text: String(r.wpm) }), h('td', { text: `${pct(r).toFixed(1)}%` }))))));
  }

  function chart(days) {
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
    const svg = el('svg', { class: 'tl__chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'data-points': String(days.length),
      'aria-label': 'WPM and accuracy per day. ' + days.map(d => `${d.day}: ${d.wpm} WPM, ${d.acc} percent`).join('; ') });
    for (let g = 0; g <= 4; g++) {
      const y = T + (ih * g) / 4;
      svg.append(el('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '.12' }),
        el('text', { x: L - 6, y: y + 3, 'text-anchor': 'end' }, String(Math.round(maxW * (1 - g / 4)))),
        el('text', { x: W - R + 6, y: y + 3 }, String(Math.round(minA + (100 - minA) * (1 - g / 4)))));
    }
    const line = (f, colour) => el('polyline', { points: days.map((d, i) => `${x(i)},${f(d)}`).join(' '), fill: 'none', stroke: colour, 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
    svg.append(line(d => yW(d.wpm), 'var(--accent)'), line(d => yA(d.acc), '#4aa3ff'));
    days.forEach((d, i) => {
      svg.append(el('circle', { cx: x(i), cy: yW(d.wpm), r: 4, fill: 'var(--accent)', 'data-day': d.day }, el('title', {}, `${d.day}: ${d.wpm} WPM (${d.n} lesson${d.n > 1 ? 's' : ''})`)),
        el('circle', { cx: x(i), cy: yA(d.acc), r: 4, fill: '#4aa3ff' }, el('title', {}, `${d.day}: ${d.acc}% accuracy`)));
      if (days.length <= 8 || i % Math.ceil(days.length / 8) === 0) svg.append(el('text', { x: x(i), y: H - 12, 'text-anchor': 'middle' }, d.day.slice(5)));
    });
    return svg;
  }

  function paint() {
    paintNav();
    if (view === 'progress') { progressScreen(); win.setSubtitle('Progress'); return; }
    lessonScreen();
    win.setSubtitle(`Lesson ${cur + 1} of ${LESSONS.length}`);
  }

  /* a click anywhere on the lesson (not on a button) refocuses the typing field */
  on(main, 'pointerdown', e => { if (view === 'lesson' && !e.target.closest('button')) focusNow(); });
  /* typing while focus is on the window frame still counts */
  on(window, 'keydown', e => {
    if (view !== 'lesson' || !inputEl || document.activeElement === inputEl || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!win.el.classList.contains('is-active')) return;
    if (document.activeElement && document.activeElement.closest('button,input,textarea,select,a[href]')) return;
    if (e.key.length === 1 || e.key === 'Escape') { inputEl.focus({ preventScroll: true }); }
  });

  paint();
  focusInput();
  return () => { dead = true; offs.splice(0).forEach(f => f()); };
}
