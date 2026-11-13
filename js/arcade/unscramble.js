/* ============================================================
   arcade/unscramble.js — Unscramble for Static Arcade.

   Letters jumbled on tiles; put them back into a word before the two
   minutes run out. Any real word that uses exactly those letters is
   accepted, not only the one that was dealt ("least", "slate" and
   "stale" are one puzzle). Words start at 4 letters and grow by a
   letter every three solved, up to 8. A solved word scores 10 points
   a letter, plus 5 for each word already in your streak (at most 25).
   A hint places the next right letter and takes 5 points off the word when you solve it; skipping a
   word ends the streak.

   The rules (what may be dealt, how a scramble is made, what counts
   as an answer) are in unscramblelogic.js, and the words come from
   words.js, offensive words already taken out of them.

   Controls
     mouse / touch  tap a tile to use it, tap the answer row to take the
                    last letter back
     keyboard       type the letters (Backspace takes one back, Delete
                    clears the row) · Space shuffles the tiles · ? hint ·
                    → skip · Enter checks the word

   Score = points, higher is better; the best is kept on this device
   (portal.arcadePuzzles.unscramble).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, randomSeed, rng, sounder } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { loadWords } from './words.js';
import { ROUND_SECONDS, HINT_COST, nextPuzzle, accepts, anagramsOf, solvePoints } from './unscramblelogic.js';

const GAME = 'unscramble';
const LOW_SECONDS = 10;

const CSS = `${BASE}
.pz-us__stage{flex:1 1 auto;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(10px,3cqh,26px);position:relative}
.pz-us__row{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(5px,1.4cqw,12px);max-width:100%}
.pz-us__tile,.pz-us__slot{width:clamp(38px,9cqw,68px);height:clamp(46px,11cqw,80px);display:grid;place-items:center;border-radius:12px;font:800 clamp(22px,5.4cqw,40px)/1 var(--font,system-ui);text-transform:uppercase;box-sizing:border-box}
.pz-us__tile{background:var(--fill-3,rgba(255,255,255,.16));color:var(--ink-0,#fff);border:0;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.35)}
.pz-us__tile:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.pz-us__tile.is-used{visibility:hidden}
@media (hover:hover){.pz-us__tile:not(.is-used):hover{background:color-mix(in srgb,var(--ga) 40%,var(--fill-3,#444))}}
.pz-us__slot{border:2px dashed var(--line-2,rgba(255,255,255,.28));color:var(--ink-0,#fff);background:transparent;cursor:pointer;padding:0}
.pz-us__slot.is-full{border-style:solid;border-color:color-mix(in srgb,var(--ga) 70%,transparent);background:color-mix(in srgb,var(--ga) 22%,transparent)}
.pz-us__row.is-bad .pz-us__slot{border-color:#ff6b6b;background:color-mix(in srgb,#ff6b6b 25%,transparent)}
.pz-us__row.is-good .pz-us__slot{border-color:#4fd68a;background:color-mix(in srgb,#4fd68a 28%,transparent)}
.pz-us__acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.pz-us__msg{min-height:22px;font:600 14px/1.4 var(--font,system-ui);color:var(--ink-1,#ddd);text-align:center;max-width:56ch}
.pz-us__list{display:flex;flex-wrap:wrap;justify-content:center;gap:5px;max-width:min(100%,640px);max-height:30cqh;overflow:auto}
.pz-us__chip{font:700 12px/1 var(--font,system-ui);letter-spacing:.05em;text-transform:uppercase;padding:5px 8px;border-radius:7px;background:var(--fill-1,rgba(255,255,255,.07));color:var(--ink-0,#fff)}
.pz-us__chip.is-missed{background:color-mix(in srgb,hsl(160 60% 38%) 35%,transparent)}
.pz-us__chip small{font-weight:600;opacity:.65;margin-left:4px}
.pz-us__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.97);border-radius:12px;text-align:center;padding:16px}
.pz-us__card div{max-width:36ch;display:flex;flex-direction:column;gap:10px;align-items:center}
.pz-us__card b{font-size:22px;color:#fff}
.pz-us__card div>span{font-size:13px;color:var(--ink-2,#bbb);line-height:1.5}
.pz.is-low .pz__read.is-clock{color:#ff7b7b}
.pz:not(.is-reduced) .pz-us__row.is-bad{animation:us-nope .28s linear}
@keyframes us-nope{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    let best = Number.isFinite(sv.best) ? sv.best : null;
    let lex = null, cache = {};
    let phase = 'loading';              /* loading · ready · play · review · done */
    let rand = rng(randomSeed());
    let puz = null;                     /* { word, tiles, len } */
    let order = [];                     /* tile display order: indexes into puz.tiles */
    let picks = [];                     /* tile indexes used so far, in answer order */
    let score = 0, streak = 0, hints = 0, skipped = 0;
    let solved = [], used = new Set(), msg = '';
    let missedNote = null;

    /* ---------- chrome ---------- */
    const scoreV = h('span', { text: '0' });
    const scoreRead = h('div.pz__read', { title: 'Score', 'aria-label': 'Score' }, icon('star'), scoreV);
    const streakV = h('span', { text: '0' });
    const streakRead = h('div.pz__read', { title: 'Words in a row without skipping', 'aria-label': 'Streak' }, icon('forward'), streakV);
    const timeV = h('span', { text: fmtTime(ROUND_SECONDS) });
    const timeRead = h('div.pz__read.is-clock', { title: 'Time left', 'aria-label': 'Time left' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Start over with a new round' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', scoreRead, streakRead, timeRead, bestV, newBtn);
    const tilesEl = h('div.pz-us__row', { role: 'group', 'aria-label': 'Letter tiles' });
    const slotsEl = h('div.pz-us__row', { role: 'group', 'aria-label': 'Your answer' });
    const shuffleBtn = h('button.pz__btn', { type: 'button', title: 'Shuffle the tiles (Space)' }, icon('shuffle'), h('span', { text: 'Shuffle' }));
    const hintBtn = h('button.pz__btn', { type: 'button', title: `Place the next right letter (?). Takes ${HINT_COST} points off this word.` }, icon('sparkles'), h('span', { text: 'Hint' }), h('small', { text: `−${HINT_COST}` }));
    const skipBtn = h('button.pz__btn', { type: 'button', title: 'Give up on this word and take the next (→). Ends your streak.' }, icon('skip-forward'), h('span', { text: 'Skip' }));
    const backBtn = h('button.pz__btn', { type: 'button', title: 'Take the last letter back (Backspace)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Back' }));
    const acts = h('div.pz-us__acts', backBtn, shuffleBtn, hintBtn, skipBtn);
    const msgEl = h('div.pz-us__msg', { 'aria-live': 'polite' });
    const listEl = h('div.pz-us__list');
    const stage = h('div.pz-us__stage', { tabindex: '0', 'aria-label': 'Unscramble the letters' }, tilesEl, slotsEl, acts, msgEl, listEl);
    const wrap = h('div.pz__stage', stage);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, wrap, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; msgEl.textContent = m; live.textContent = ''; live.textContent = m; };
    const paintFoot = () => foot.replaceChildren(h('span.pz__hint', { html: 'tap tiles or type the letters · <kbd>Space</kbd> shuffles · <kbd>?</kbd> hint · <kbd>→</kbd> skip · <kbd>Backspace</kbd> takes one back' }));

    const clk = clock(secs => {
      const left = Math.max(0, ROUND_SECONDS - secs);
      timeV.textContent = fmtTime(Math.ceil(left));
      root.classList.toggle('is-low', phase === 'play' && left <= LOW_SECONDS);
      if (phase === 'play' && left <= 0) endRound();
    });

    /* ---------- painting ---------- */
    function paint() {
      scoreV.textContent = String(score);
      streakV.textContent = String(streak);
      bestV.textContent = best != null ? `Best: ${best}` : '';
      const playing = phase === 'play' && !!puz;
      [backBtn, shuffleBtn, hintBtn, skipBtn].forEach(b => { b.disabled = !playing; });
      if (!puz) { tilesEl.replaceChildren(); slotsEl.replaceChildren(); return; }
      const letters = puz.tiles.toUpperCase().split('');
      tilesEl.replaceChildren(...order.map(i => h('button.pz-us__tile' + (picks.includes(i) ? '.is-used' : ''), {
        type: 'button', dataset: { tile: i, letter: letters[i] }, tabindex: '-1', 'aria-label': `Letter ${letters[i]}`, onclick: () => pick(i),
      }, letters[i])));
      slotsEl.replaceChildren(...Array.from({ length: puz.len }, (_, k) => {
        const filled = k < picks.length;
        return h('button.pz-us__slot' + (filled ? '.is-full' : ''), { type: 'button', tabindex: '-1', dataset: { slot: k }, 'aria-label': filled ? `Letter ${k + 1}: ${letters[picks[k]]}` : `Empty letter ${k + 1}`,
          onclick: () => { if (filled) unpickTo(k); } }, filled ? letters[picks[k]] : '');
      }));
    }
    const answer = () => picks.map(i => puz.tiles[i]).join('');
    function flash(cls) {
      slotsEl.classList.remove('is-bad', 'is-good');
      void slotsEl.offsetWidth;
      slotsEl.classList.add(cls);
      setTimeout(() => slotsEl.classList.remove(cls), 420);
    }
    function paintList() {
      listEl.replaceChildren();
      if (phase === 'review' || phase === 'done') {
        solved.forEach(s => listEl.appendChild(h('span.pz-us__chip', { dataset: { word: s.word } }, s.word, h('small', { text: `+${s.points}` }))));
        if (missedNote) listEl.appendChild(h('span.pz-us__chip.is-missed', { dataset: { missed: missedNote.join(' ') }, title: 'The word you were on' }, missedNote.join(' / ')));
      }
    }

    /* ---------- a round ---------- */
    function card(title, text, button) {
      wrap.querySelector('.pz-us__card')?.remove();
      if (!title) return;
      wrap.appendChild(h('div.pz-us__card', h('div', h('b', { text: title }), h('span', { text }), button || null)));
    }
    function reset() {
      clk.stop(); clk.secs = 0;
      score = 0; streak = 0; hints = 0; skipped = 0; solved = []; used = new Set(); puz = null; picks = []; order = []; missedNote = null;
      paused = false; phase = 'ready';
      root.classList.remove('is-low');
      timeV.textContent = fmtTime(ROUND_SECONDS);
      msgEl.textContent = '';
      paint(); paintList(); onScore(0);
      const go = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'start' }, onclick: () => start() }, icon('play', { fill: true }), h('span', { text: 'Start' }));
      card('Unscramble', `${ROUND_SECONDS / 60} minutes. Put the letters back into a word — any real word that uses them all counts. They start at 4 letters and get longer.`, go);
      say('Press Enter or Space to start.');
      setTimeout(() => { if (!dead && phase === 'ready') go.focus({ preventScroll: true }); }, 30);
    }
    function deal() {
      puz = nextPuzzle(lex, solved.length, used, rand, cache);
      if (!puz) { endRound(); return; }
      used.add(puz.word);
      picks = []; hints = 0;
      order = puz.tiles.split('').map((_, i) => i);
      paint();
    }
    function start() {
      if (dead || phase !== 'ready') return;
      snd.wake();
      card(null);
      phase = 'play';
      deal();
      clk.start();
      say(`${puz.len} letters. Go!`);
      stage.focus({ preventScroll: true });
    }
    function endRound() {
      if (phase !== 'play') return;
      phase = 'review';
      clk.stop();
      root.classList.remove('is-low');
      timeV.textContent = fmtTime(0);
      missedNote = puz ? anagramsOf(lex, puz.tiles) : null;
      if (missedNote && missedNote.length) { const i = missedNote.indexOf(puz.word); if (i > 0) { missedNote.splice(i, 1); missedNote.unshift(puz.word); } }
      const fin = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'finish' }, onclick: () => finish() }, icon('check'), h('span', { text: 'See my score' }));
      paint(); paintList();
      card('Time!', `${solved.length} word${solved.length === 1 ? '' : 's'} solved for ${score} points.${missedNote?.length ? ` You were on “${puz.tiles.toUpperCase()}”: ${missedNote.map(w => w.toUpperCase()).join(', ')}.` : ''}`, fin);
      say(`Time is up. ${solved.length} solved, ${score} points.`);
      snd.blip(300, 0.2, 'triangle', 0.8, 150);
      setTimeout(() => { if (!dead && phase === 'review') fin.focus({ preventScroll: true }); }, 30);
    }
    function finish() {
      if (dead || phase !== 'review') return;
      phase = 'done';
      if (best == null || score > best) { best = score; save(GAME, { best }); }
      card(null);
      paint();
      onScore(score);
      const longest = solved.map(s => s.word).sort((a, b) => b.length - a.length)[0];
      onEnd({ score, won: true, detail: `${solved.length} word${solved.length === 1 ? '' : 's'} solved${longest ? ` · longest ${longest}` : ''}${skipped ? ` · ${skipped} skipped` : ''}` });
    }

    /* ---------- moves ---------- */
    const live1 = () => phase === 'play' && !paused && puz;
    function pick(i) {
      if (!live1() || picks.includes(i) || picks.length >= puz.len) return;
      picks.push(i);
      snd.blip(380 + picks.length * 30, 0.04, 'triangle', 0.5);
      paint();
      if (picks.length === puz.len) check();
    }
    function unpickTo(k) { if (live1()) { picks = picks.slice(0, k); paint(); } }
    function check() {
      const a = answer();
      if (accepts(lex, puz.tiles, a)) {
        const pts = solvePoints(puz.len, streak, hints);
        solved.push({ word: a, points: pts, dealt: puz.word });
        score += pts; streak++;
        const others = anagramsOf(lex, puz.tiles).filter(w => w !== a);
        flash('is-good');
        snd.blip(520, 0.08, 'triangle', 0.8); snd.blip(780, 0.1, 'triangle', 0.7);
        say(`${a.toUpperCase()}! +${pts}${a !== puz.word ? ` — a different word from the one dealt (${puz.word.toUpperCase()})` : others.length ? ` — also: ${others.slice(0, 4).map(w => w.toUpperCase()).join(', ')}` : ''}`);
        onScore(score);
        deal();
        paintList();
      } else {
        flash('is-bad');
        snd.blip(150, 0.12, 'sawtooth', 0.4, 110);
        say(`${a.toUpperCase()} is not a word that uses these letters.`);
        picks = []; paint();
      }
    }
    function hint() {
      if (!live1()) return;
      /* keep the right start of the dealt word, drop the rest, then place the next letter */
      let k = 0;
      while (k < picks.length && puz.tiles[picks[k]] === puz.word[k]) k++;
      picks = picks.slice(0, k);
      if (picks.length >= puz.len) return;
      const want = puz.word[picks.length];
      const i = puz.tiles.split('').findIndex((ch, j) => ch === want && !picks.includes(j));
      if (i < 0) return;
      hints++;
      picks.push(i);
      snd.blip(660, 0.06, 'sine', 0.6);
      say(`Hint: the word starts “${puz.word.slice(0, picks.length).toUpperCase()}”. It will cost ${HINT_COST} points off this word.`);
      paint();
      if (picks.length === puz.len) check();
    }
    function skip() {
      if (!live1()) return;
      skipped++; streak = 0;
      const was = puz.word;
      snd.blip(220, 0.1, 'square', 0.4, 160);
      deal();
      say(`Skipped. It was ${was.toUpperCase()}.`);
      paint();
    }
    function shuffle() {
      if (!live1()) return;
      const o = order.slice();
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      order = o; picks = []; snd.blip(260, 0.05, 'square', 0.3); paint();
    }
    L.on(backBtn, 'click', () => { if (live1()) { picks.pop(); paint(); stage.focus({ preventScroll: true }); } });
    L.on(shuffleBtn, 'click', () => { shuffle(); stage.focus({ preventScroll: true }); });
    L.on(hintBtn, 'click', () => { hint(); stage.focus({ preventScroll: true }); });
    L.on(skipBtn, 'click', () => { skip(); stage.focus({ preventScroll: true }); });
    L.on(newBtn, 'click', () => { if (!dead && lex) reset(); });

    /* ---------- keyboard ---------- */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const k = e.key;
      if (phase === 'ready') { if (k === 'Enter' || k === ' ') { e.preventDefault(); if (!e.repeat) start(); } return; }
      if (phase === 'review') { if (k === 'Enter' || k === ' ') { e.preventDefault(); if (!e.repeat) finish(); } return; }
      if (!live1()) return;
      if (/^[a-zA-Z]$/.test(k)) {
        e.preventDefault();                           /* P is a letter here, not the Arcade's pause key */
        const ch = k.toLowerCase();
        const i = order.find(j => puz.tiles[j] === ch && !picks.includes(j));
        if (i === undefined) { snd.blip(150, 0.05, 'square', 0.3); return; }
        pick(i);
      } else if (k === 'Backspace') { e.preventDefault(); picks.pop(); paint(); }
      else if (k === 'Delete') { e.preventDefault(); picks = []; paint(); }
      else if (k === ' ') { e.preventDefault(); if (!e.repeat) shuffle(); }
      else if (k === '?') { e.preventDefault(); if (!e.repeat) hint(); }
      else if (k === 'ArrowRight') { e.preventDefault(); if (!e.repeat) skip(); }
      else if (k === 'Enter') { e.preventDefault(); if (!e.repeat && picks.length === puz.len) check(); }
    });

    /* ---------- boot ---------- */
    paintFoot(); paint(); onScore(0);
    card('Loading the word list…', 'About 300 KB; the browser keeps a copy for next time.');
    const loadIt = () => loadWords().then(l => { if (dead) return; lex = l; reset(); }).catch(err => {
      if (dead) return;
      card('The word list did not load', 'The first time, it needs the network. Check your connection and try again.',
        h('button.btn.btn--primary', { type: 'button', onclick: () => { card('Loading the word list…', ''); loadIt(); } }, icon('refresh'), h('span', { text: 'Try again' })));
      say(`The word list did not load (${err.message}).`);
    });
    loadIt();

    return {
      stop() {
        if (dead) return;
        dead = true;
        clk.dispose();
        L.clear();
        snd.close();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true;
        if (phase === 'play') { clk.stop(); wrap.appendChild(h('div.pz__cover', { text: 'Paused' })); }
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        wrap.querySelector('.pz__cover')?.remove();
        if (phase === 'play') clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        phase, tiles: puz ? puz.tiles : '', dealt: puz ? puz.word : '', len: puz ? puz.len : 0, answer: puz ? answer() : '', picks: picks.slice(), order: order.slice(),
        score, streak, hints, skipped, solved: solved.map(s => ({ ...s })), secs: clk.secs, left: Math.max(0, ROUND_SECONDS - clk.secs), paused, best,
        anagrams: puz && lex ? anagramsOf(lex, puz.tiles) : [], loaded: !!lex, message: msg,
      }),
      /* test hook — nothing in the game calls it: time({ secs }), seed({ seed }) (the next round's order) */
      hook(cmd, arg) {
        if (cmd === 'time' && phase === 'play') clk.secs = arg.secs;
        else if (cmd === 'seed') rand = rng(arg.seed);
        return true;
      },
    };
  },
};
