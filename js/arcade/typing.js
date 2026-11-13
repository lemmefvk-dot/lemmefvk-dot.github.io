/* ============================================================
   arcade/typing.js — Type Rush: 30 seconds of common words.

   A stream of everyday English words; type the highlighted one and
   press Space (or Enter) to move on. The clock starts on your first
   key, so reading the screen first is free.

   Input goes through a real <input>, never a page-wide key listener:
   that is what makes a phone or tablet show its keyboard, and it keeps
   IME/autocorrect keyboards working. The field only ever holds the
   word in progress; whatever arrives with a space in it (a fast
   typist, a mobile keyboard committing a whole word) is split and
   committed word by word.

   Scoring, as the finished screen explains:
     WPM (the score) = characters of correctly typed words, plus
                       their spaces, ÷ 5, per minute. A mistyped word
                       earns nothing, so errors are already netted out.
     Raw WPM         = every character you typed, right or wrong.
     Accuracy        = correct keystrokes ÷ all keystrokes, including
                       mistakes you later fixed with Backspace.
   ============================================================ */
import { h } from '../core/dom.js';

/** Words per minute: five characters make a word. Type Rush and Typing Lessons both score with this. */
export const wpmOf = (n, ms) => (ms > 0 ? (n / 5) / (ms / 60000) : 0);

const SECONDS = 30;
const LIVE_AFTER = 2000; // ms before live WPM is shown — a 0.3 s sample is noise

const WORDS = (
  'the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one ' +
  'all would there their what so up out if about who get which go me when make can like time no just him know take people into ' +
  'year your good some could them see other than then now look only come its over think also back after use two how our work ' +
  'first well way even new want because any these give day most us is was are were has had did said each tell does set three ' +
  'hand high small large next early young few public same able long great little own old right big different place point end ' +
  'thing world life school still try last ask need feel become leave put mean keep let begin seem help talk turn start show hear ' +
  'play run move live hold bring happen write sit stand pay meet learn change lead watch follow stop create speak read spend grow ' +
  'open walk win offer remember love appear buy wait serve send build stay fall reach water room mother area money story fact ' +
  'month lot study book eye job word issue side kind head house friend father power hour game line member car city name ' +
  'team minute idea kid body face others level door health art war party result morning reason music light early river ' +
  'green blue paper north south east west music simple ready quick small bright happy clear sound table window garden answer ' +
  'plan color order field travel letter number around always never often every under between during before again together'
).split(' ').filter((w, i, all) => w && all.indexOf(w) === i);

const CSS = `
.arx-ty{position:relative;width:100%;height:100%;min-height:320px;display:flex;flex-direction:column;gap:var(--sp-4,12px);padding:var(--sp-5,16px);
  box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);container-type:size}
.arx-ty *{box-sizing:border-box}
.arx-ty__stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--sp-3,8px)}
.arx-ty__stat{padding:var(--sp-3,8px) var(--sp-4,12px);border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-0,rgba(255,255,255,.05));min-width:0}
.arx-ty__stat span{display:block;font-size:var(--fs-10,10px);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3,#888)}
.arx-ty__stat b{display:block;font-size:clamp(15px,3.6cqmin,24px);font-weight:700;color:var(--ink-0,#fff);font-variant-numeric:tabular-nums;white-space:nowrap}
.arx-ty__stat b small{font-size:.6em;font-weight:600;color:var(--ink-2,#aaa);margin-left:2px}
.arx-ty__stat.is-hot b{color:var(--ga)}
.arx-ty__stat.is-low b{color:#f59e0b}
.arx-ty__panel{position:relative;flex:1;min-height:150px;border-radius:var(--r-xl,20px);border:1px solid var(--line-1,rgba(255,255,255,.08));
  background:var(--fill-0,rgba(255,255,255,.03));display:flex;flex-direction:column;justify-content:center;padding:var(--sp-6,20px) clamp(16px,4cqw,36px);overflow:hidden;cursor:text}
.arx-ty__bar{position:absolute;left:0;top:0;height:3px;width:100%;background:var(--ga);transform-origin:left center;transform:scaleX(1)}
.arx-ty__view{--lh:clamp(38px,9.4cqmin,64px);position:relative;height:calc(var(--lh)*3);overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 72%,transparent);mask-image:linear-gradient(180deg,#000 72%,transparent)}
.arx-ty__flow{display:flex;flex-wrap:wrap;column-gap:.55em;font-size:clamp(20px,5.3cqmin,36px);line-height:var(--lh);font-weight:500;letter-spacing:.01em;
  color:var(--ink-3,#777);transition:transform .18s cubic-bezier(.16,1,.3,1)}
.arx-ty.is-reduced .arx-ty__flow{transition:none}
.arx-ty__w{position:relative;white-space:nowrap;border-radius:6px}
.arx-ty__w.is-ok{color:var(--ink-1,#ddd);opacity:.55}
.arx-ty__w.is-bad{color:#f87171;text-decoration:underline wavy color-mix(in srgb,#f87171 70%,transparent);text-underline-offset:6px;text-decoration-thickness:1.5px}
.arx-ty__w.is-now{color:var(--ink-2,#aaa);background:color-mix(in srgb,var(--ga) 12%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--ga) 12%,transparent)}
.arx-ty__c.is-ok{color:var(--ink-0,#fff)}
.arx-ty__c.is-bad{color:#f87171;background:color-mix(in srgb,#f87171 16%,transparent);border-radius:3px}
.arx-ty__c.is-extra{color:#f87171;opacity:.7}
.arx-ty__c.is-caret{box-shadow:-2px 0 0 var(--ga)}
.arx-ty__w.is-now.is-end::after{content:"";position:absolute;right:-3px;top:18%;bottom:18%;width:2px;background:var(--ga)}
.arx-ty:not(.is-reduced) .arx-ty__c.is-caret{animation:arx-ty-caret 1s steps(1) infinite}
@keyframes arx-ty-caret{50%{box-shadow:none}}
.arx-ty:not(.is-reduced) .arx-ty__w.is-now.is-end::after{animation:arx-ty-bar 1s steps(1) infinite}
@keyframes arx-ty-bar{50%{opacity:0}}
.arx-ty__field{display:flex;align-items:center;gap:var(--sp-3,8px)}
.arx-ty__input{flex:1;min-width:0;font:600 clamp(18px,3.8cqmin,24px)/1.2 var(--font,system-ui);color:var(--ink-0,#fff);padding:14px 18px;border-radius:var(--r-lg,15px);
  border:1px solid var(--line-2,rgba(255,255,255,.12));background:var(--fill-1,rgba(255,255,255,.06));outline:none;letter-spacing:.01em}
.arx-ty__input::placeholder{color:var(--ink-3,#888);font-weight:500}
.arx-ty__input:focus-visible{outline:none}
.arx-ty__input:focus{border-color:color-mix(in srgb,var(--ga) 70%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--ga) 18%,transparent)}
.arx-ty__input.is-wrong{border-color:#f87171;box-shadow:0 0 0 4px color-mix(in srgb,#f87171 18%,transparent)}
.arx-ty__input[readonly]{opacity:.6}
.arx-ty__hint{font-size:var(--fs-12,12px);color:var(--ink-3,#888);text-align:center}
.arx-ty__hint kbd{font:600 calc(11px * var(--fs-k,1))/1 var(--mono,ui-monospace,monospace);padding:3px 6px;border-radius:5px;border:1px solid var(--line-2,rgba(255,255,255,.14));border-bottom-width:2px;background:var(--fill-1,rgba(255,255,255,.05));color:var(--ink-1,#ddd)}
.arx-ty__done{display:flex;flex-direction:column;align-items:center;gap:var(--sp-3,8px);text-align:center}
.arx-ty__kicker{font-size:var(--fs-11,11px);letter-spacing:.12em;text-transform:uppercase;color:var(--ga);font-weight:700}
.arx-ty__big{font-size:clamp(48px,15cqmin,104px);font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--ink-0,#fff);font-variant-numeric:tabular-nums}
.arx-ty__big small{font-size:.28em;letter-spacing:.02em;font-weight:700;color:var(--ink-2,#aaa);margin-left:.2em}
.arx-ty__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--sp-3,8px);width:min(100%,520px);margin-top:var(--sp-3,8px)}
.arx-ty__grid div{padding:8px;border-radius:var(--r-md,11px);background:var(--fill-1,rgba(255,255,255,.05))}
.arx-ty__grid b{display:block;font-size:clamp(16px,3.4cqmin,22px);color:var(--ink-0,#fff);font-variant-numeric:tabular-nums}
.arx-ty__grid span{font-size:var(--fs-10,10px);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#888)}
.arx-ty__note{font-size:var(--fs-12,12px);color:var(--ink-3,#888);max-width:52ch;line-height:1.5;margin-top:var(--sp-2,6px)}
.arx-ty__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@container (max-width:520px){.arx-ty{padding:var(--sp-3,8px);gap:var(--sp-3,8px)}.arx-ty__stat{padding:6px 8px}.arx-ty__panel{padding:var(--sp-4,12px)}.arx-ty__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-height:430px){.arx-ty__hint{display:none}}
`;

/* a shuffled run of words with no word twice in a row */
function stream(n, prev) {
  const out = [];
  let last = prev;
  while (out.length < n) {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (w === last) continue;
    out.push(w);
    last = w;
  }
  return out;
}

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};

    let dead = false, paused = false;
    let state = 'ready';            // ready | run | done
    let startAt = 0, banked = 0;
    let ticker = 0;
    let lastScore = -1;
    let refocus = 0;
    const words = stream(80);
    const typed = [];               // committed attempts, same index as words
    let idx = 0;
    let prev = '';                  // the field's previous value, for keystroke diffs
    let keysOk = 0, keysAll = 0;
    let chars = 0;                  // every character typed (raw), spaces included
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };

    /* ---- build ---- */
    const stat = label => { const b = h('b', '—'); return [h('div.arx-ty__stat', h('span', { text: label }), b), b]; };
    const [sTime, vTime] = stat('Time');
    const [sWpm, vWpm] = stat('WPM');
    const [sAcc, vAcc] = stat('Accuracy');
    const [sWords, vWords] = stat('Words');
    const bar = h('div.arx-ty__bar');
    const flow = h('div.arx-ty__flow', { 'aria-hidden': 'true' });
    const view = h('div.arx-ty__view', flow);
    const sr = h('div.arx-ty__sr', { 'aria-live': 'polite' });
    const panel = h('div.arx-ty__panel', bar, view, sr);
    const input = h('input.arx-ty__input', {
      type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      inputmode: 'text', enterkeyhint: 'next', 'aria-label': 'Type the highlighted word, then press space',
      placeholder: 'Start typing — the clock starts on your first key',
    });
    const hint = h('div.arx-ty__hint', h('kbd', { text: 'Space' }), ' next word · ', h('kbd', { text: 'Backspace' }), ' fix the current word · 30 seconds');
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const root = h('div.arx-ty' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), h('div.arx-ty__stats', sTime, sWpm, sAcc, sWords), panel, h('div.arx-ty__field', input), hint);
    el.appendChild(root);

    const wordEls = [];
    function addWords(list) {
      for (const w of list) {
        const n = h('span.arx-ty__w', { text: w });
        wordEls.push(n);
        flow.appendChild(n);
      }
    }
    addWords(words);

    /* ---- scoring ---- */
    const elapsed = () => Math.min(SECONDS * 1000, banked + (state === 'run' && !paused ? performance.now() - startAt : 0));
    const current = () => input.value;
    const correctChars = (withPartial) => {
      let n = 0;
      for (let i = 0; i < typed.length; i++) if (typed[i] === words[i]) n += words[i].length + 1;
      if (withPartial) {
        const v = current();
        if (v && words[idx].startsWith(v)) n += v.length; // the word in progress, if right so far
      }
      return n;
    };

    function paintStats() {
      const ms = elapsed();
      const left = Math.max(0, SECONDS - ms / 1000);
      vTime.replaceChildren(state === 'ready' ? String(SECONDS) : left.toFixed(1), h('small', { text: 's' }));
      sTime.classList.toggle('is-low', state === 'run' && left <= 5);
      bar.style.transform = `scaleX(${left / SECONDS})`;
      const net = ms >= LIVE_AFTER ? Math.round(wpmOf(correctChars(true), ms)) : null;
      vWpm.textContent = net == null ? '—' : String(net);
      sWpm.classList.toggle('is-hot', net != null);
      vAcc.textContent = keysAll ? `${Math.round((keysOk / keysAll) * 100)}%` : '—';
      const good = typed.filter((t, i) => t === words[i]).length;
      vWords.textContent = String(good);
      if (net != null && net !== lastScore && state === 'run') { lastScore = net; onScore(net); }
    }

    /* ---- the word display ---- */
    function paintWord(i) {
      const n = wordEls[i];
      if (!n) return;
      const w = words[i];
      if (i < idx) {
        n.className = 'arx-ty__w ' + (typed[i] === w ? 'is-ok' : 'is-bad');
        n.textContent = w;
        return;
      }
      if (i > idx) { n.className = 'arx-ty__w'; n.textContent = w; return; }
      const v = current();
      const kids = [];
      for (let k = 0; k < Math.max(w.length, v.length); k++) {
        const ch = k < w.length ? w[k] : v[k];
        let cls = 'arx-ty__c';
        if (k < v.length) cls += k >= w.length ? ' is-extra' : v[k] === w[k] ? ' is-ok' : ' is-bad';
        if (k === v.length && state !== 'done') cls += ' is-caret';
        kids.push(h('span', { class: cls, text: ch }));
      }
      n.className = 'arx-ty__w is-now' + (v.length >= w.length && state !== 'done' ? ' is-end' : '');
      n.replaceChildren(...kids);
      input.classList.toggle('is-wrong', !!v && !w.startsWith(v));
    }

    /* keep the current word on the second visible line */
    function scroll() {
      const n = wordEls[idx];
      if (!n) return;
      const lh = n.offsetHeight || 40;
      const top = n.offsetTop;
      const shift = Math.max(0, top - lh);
      flow.style.transform = `translateY(${-shift}px)`;
    }

    function commit(word) {
      typed[idx] = word;
      const ok = word === words[idx];
      idx++;
      paintWord(idx - 1);
      if (words.length - idx < 30) {
        const more = stream(40, words[words.length - 1]);
        words.push(...more);
        addWords(more);
      }
      paintWord(idx);
      scroll();
      if (!ok) sr.textContent = `Mistyped ${words[idx - 1]}`;
    }

    /* ---- the clock ---- */
    function begin() {
      state = 'run';
      input.placeholder = 'Type the highlighted word, then Space';
      startAt = performance.now();
      banked = 0;
      ticker = setInterval(tick, 100);
    }

    function tick() {
      if (dead || paused || state !== 'run') return;
      if (elapsed() >= SECONDS * 1000) return finish();
      paintStats();
    }

    function finish() {
      if (state === 'done') return;
      banked = SECONDS * 1000;
      state = 'done';
      clearInterval(ticker); ticker = 0;
      const partial = correctChars(true) - correctChars(false); // the word in progress, if right so far
      paintStats();                  // final numbers, while the word in progress still counts
      input.readOnly = true;
      input.placeholder = 'Time’s up';
      input.value = '';
      prev = '';
      input.classList.remove('is-wrong');
      const ms = SECONDS * 1000;
      const good = correctChars(false) + partial;
      const score = Math.round(wpmOf(good, ms));
      const raw = Math.round(wpmOf(chars, ms));
      const accuracy = keysAll ? Math.round((keysOk / keysAll) * 100) : 0;
      const right = typed.filter((t, i) => t === words[i]).length;
      const wrong = typed.length - right;
      const cell = (v, label) => h('div', h('b', { text: String(v) }), h('span', { text: label }));
      panel.replaceChildren(h('div.arx-ty__done',
        h('div.arx-ty__kicker', { text: 'Time’s up' }),
        h('div.arx-ty__big', String(score), h('small', { text: 'net WPM' })),
        h('div.arx-ty__grid', cell(`${accuracy}%`, 'Accuracy'), cell(raw, 'Raw WPM'), cell(right, 'Correct words'), cell(wrong, 'Mistyped')),
        h('p.arx-ty__note', { text: 'Net WPM counts only correctly typed words (5 characters = 1 word, spaces included), so mistakes are already netted out. Raw WPM counts everything you typed.' })));
      sr.textContent = '';
      panel.appendChild(sr);
      sr.textContent = `Time's up. ${score} words per minute, ${accuracy} percent accuracy.`;
      if (score !== lastScore) onScore(score);
      onEnd({ score, won: true, detail: `${score} WPM · ${accuracy}% accuracy · ${right} correct, ${wrong} mistyped · raw ${raw} WPM`, raw, accuracy, words: right, mistyped: wrong });
    }

    /* ---- input ---- */
    function onInput() {
      if (dead || state === 'done' || paused) { if (state === 'done') input.value = prev; return; }
      let v = input.value;
      if (state === 'ready') {
        if (!v.trim()) { input.value = ''; prev = ''; return; } // leading spaces don't start the clock
        begin();
      }
      /* keystroke accounting: what was added past the common prefix */
      let common = 0;
      while (common < prev.length && common < v.length && prev[common] === v[common]) common++;
      const added = v.slice(common);
      let pos = common;
      let word = words[idx];
      let building = v.slice(0, common);
      for (const ch of added) {
        keysAll++; chars++;
        if (/\s/.test(ch)) {
          if (building === word) keysOk++;
          building = ''; pos = 0; word = words[idx + 1] ?? '';
          continue;
        }
        if (word[pos] === ch) keysOk++;
        building += ch; pos++;
      }
      /* split on whitespace: every finished chunk is a committed word */
      if (/\s/.test(v)) {
        const parts = v.split(/\s+/);
        const rest = parts.pop();
        for (const p of parts) if (p) commit(p);
        v = rest;
        input.value = v;
      }
      prev = v;
      paintWord(idx);
      paintStats();
    }

    listen(input, 'input', onInput);
    listen(input, 'keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state === 'run' && input.value && !paused) {
          keysAll++; chars++;
          if (input.value === words[idx]) keysOk++;
          commit(input.value);
          input.value = ''; prev = '';
          paintWord(idx); paintStats();
        }
      }
    });
    listen(input, 'paste', e => { e.preventDefault(); sr.textContent = 'Pasting is turned off in Type Rush.'; });
    listen(input, 'drop', e => e.preventDefault());
    listen(panel, 'pointerdown', e => { if (state !== 'done') { e.preventDefault(); input.focus({ preventScroll: true }); } });
    /* a character typed while focus is elsewhere in the window (the Arcade
       focuses its own stage after a pause) still lands in the field. The
       key is claimed (preventDefault) and inserted here, so the shell does
       not also read a typed "p" as its pause key. */
    listen(window, 'keydown', e => {
      if (dead || paused || state === 'done' || document.activeElement === input) return;
      if (e.key.length !== 1 || !ownsKey(root, e)) return;
      e.preventDefault();
      input.focus({ preventScroll: true });
      input.value += e.key;
      onInput();
    });

    paintWord(0);
    paintStats();
    requestAnimationFrame(() => { if (!dead) { input.focus({ preventScroll: true }); scroll(); } });

    return {
      stop() {
        if (dead) return;
        dead = true;
        clearInterval(ticker); ticker = 0;
        cancelAnimationFrame(refocus);
        offs.splice(0).forEach(off => off());
        input.blur();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        if (state === 'run') banked += performance.now() - startAt;
        paused = true;
        input.readOnly = true;
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        if (state === 'run') startAt = performance.now();
        if (state !== 'done') {
          input.readOnly = false;
          input.focus({ preventScroll: true });
          /* the shell focuses its stage right after resume(); take it back */
          refocus = requestAnimationFrame(() => { refocus = 0; if (!dead && !paused) input.focus({ preventScroll: true }); });
        }
      },
    };
  },
};

/* Keys reach the game only while its window is the active one and focus
   is not parked on some other control (a shell button, a text field).
   The controller bridge (core/padmap.js) dispatches its synthetic keys
   straight to window, so for those the focused element stands in for
   the target (Node.contains(window) would throw). */
function ownsKey(root, e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!root.isConnected || !root.getClientRects().length) return false;
  const win = root.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target instanceof Element ? e.target : document.activeElement;
  if (!t || t === document.body || t === document.documentElement || root.contains(t)) return true;
  if (t.closest('input,textarea,select,button,a[href],[contenteditable="true"],[role="button"]')) return false;
  return !win || win.contains(t);
}
