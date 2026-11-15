/* ============================================================
   arcade/dailyword.js — Daily Word, the Arcade's second daily puzzle.

   Guess the day's five-letter word in six tries. After each guess a
   square turns green when the letter is in the right place, gold when
   the word has it somewhere else, and grey when it has no more of it
   (with the colour-blind palette: orange and blue). The word comes
   from the date (./dailyword-state.js), so everyone on the same date
   gets the same one; the list is the Arcade's own (./words.js).

   Type, or use the keys on screen: letters, Enter to guess, Backspace
   to take a letter back. A guess must be a word in the list.

   Solving it moves Daily Word's streak on and counts in the daily
   streak it shares with Daily Stars; both follow Daily Stars' rules.
   The board and the time (only while on screen) are kept per device,
   so closing the window keeps your place. The 30-day calendar and
   the result to copy show the tries and the colours, never letters.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { CSS as BASE, fmtTime, reducedMotion } from './puzzlekit.js';
import { loadWords } from './words.js';
import { dayKey, parseDay, status as kitStatus, lastDays, weekStrip, calendarView, copyText, CAL_CSS } from './dailykit.js';
import { dailyStreak } from './daily-state.js';
import * as W from './dailyword-state.js';

const ROWS = [[...'qwertyuiop'], [...'asdfghjkl'], ['enter', ...'zxcvbnm', 'back']];

const CSS = BASE + `
.dw__title{flex:1;min-width:150px;display:flex;flex-direction:column;gap:2px}
.dw__title b{font-size:var(--fs-15,15px);font-weight:750;color:var(--ink-0)}
.dw__title small{font-size:var(--fs-11,11px);color:var(--ink-3)}
.dw__read--streak .icon{color:#ff9d3c!important}
.dw__grid{display:grid;grid-template-rows:repeat(6,1fr);gap:6px;width:min(330px,82cqw,62cqh);aspect-ratio:5/6}
.dw__row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.dw__row.is-shake{animation:dw-shake .35s}
.dw__t{display:grid;place-items:center;border-radius:8px;border:2px solid var(--line-2,rgba(255,255,255,.16));background:var(--fill-0,rgba(255,255,255,.03));
  font:800 clamp(16px,5.4cqmin,30px)/1 var(--font,system-ui);text-transform:uppercase;color:var(--ink-0,#fff)}
.dw__t.is-typed{border-color:var(--ink-3,#999)}
.dw__t[data-s="2"]{background:var(--hit);border-color:var(--hit);color:#08130b}
.dw__t[data-s="1"]{background:var(--near);border-color:var(--near);color:#1a1300}
.dw__t[data-s="0"]{background:#3a3644;border-color:#3a3644;color:#e9e6f0}
.dw__keys{display:flex;flex-direction:column;gap:6px;width:min(100%,520px);flex:0 0 auto}
.dw__krow{display:flex;justify-content:center;gap:5px}
.dw__k{flex:1 1 0;max-width:44px;height:44px;padding:0;border-radius:7px;border:0;cursor:pointer;background:var(--fill-2,rgba(255,255,255,.12));
  font:700 14px/1 var(--font,system-ui);text-transform:uppercase;color:var(--ink-0,#fff)}
.dw__k--wide{flex:1.6 1 0;max-width:72px;font-size:11px}
.dw__k .icon{width:16px;height:16px}
.dw__k[data-s="2"]{background:var(--hit);color:#08130b}
.dw__k[data-s="1"]{background:var(--near);color:#1a1300}
.dw__k[data-s="0"]{background:#2a2732;color:#8d879a}
.dw__k:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.dw__msg{min-height:22px;font-size:var(--fs-13,13px);font-weight:650;color:var(--ink-1)}
.dw__done{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;padding:8px 14px;border-radius:99px;font-size:var(--fs-13,13px);font-weight:600;color:var(--ink-0);
  background:color-mix(in srgb,#3ddc84 16%,transparent);border:1px solid color-mix(in srgb,#3ddc84 50%,transparent)}
.dw__done.is-lost{background:var(--fill-1);border-color:var(--line-2)}
.dw__done small{font-weight:500;color:var(--ink-2)}
.dw__calwrap{position:absolute;inset:0;z-index:6;display:grid;place-items:center;overflow:auto;padding:8px;background:color-mix(in srgb,#0b0810 90%,transparent)}
.dw__calwrap[hidden]{display:none}
.dw__calbox{display:flex;flex-direction:column;align-items:center;gap:10px}
.dw__copied{width:min(100%,360px);font:500 var(--fs-12,12px)/1.45 ui-monospace,monospace;color:var(--ink-1);background:var(--fill-1);border:1px solid var(--line-1);border-radius:8px;padding:8px;resize:none}
@keyframes dw-shake{20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
.pz.is-reduced .dw__row{animation:none}
@container (max-height:560px){.dw__k{height:36px}.dw__keys{gap:4px}}
${CAL_CSS}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const cb = ctx.palette === 'cb';
    const day = dayKey();
    let b = W.board(day);
    let lex = null, answer = '';
    let typed = '';
    let banked = b.ms, startAt = performance.now(), paused = false, dead = false, endT = 0, saveT = 0;
    const offs = [];
    const listen = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
    const elapsed = () => banked + (!paused && !b.done && !dead && lex ? performance.now() - startAt : 0);

    /* ------------------------------ the page ------------------------------ */
    const date = parseDay(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const triesEl = h('span');
    const streakEl = h('span');
    const streakBox = h('span.pz__read.dw__read--streak', icon('flame'), streakEl);
    const calBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Your last 30 days', onclick: () => toggleCalendar() }, icon('calendar'), h('span', { text: '30 days' }));
    const top = h('div.pz__top',
      h('div.dw__title', h('b', { text: 'Daily Word' }), h('small', { text: `${date} · the same word for everyone on the same date · your streak stays on this device` })),
      h('span.pz__read', { title: 'Tries used' }, icon('list'), triesEl),
      streakBox);
    const rows = Array.from({ length: W.TRIES }, () => h('div.dw__row', Array.from({ length: W.LENGTH }, () => h('span.dw__t'))));
    const grid = h('div.dw__grid', { role: 'grid', 'aria-label': 'Your guesses' }, rows);
    const msg = h('div.dw__msg', { role: 'status', 'aria-live': 'polite' });
    const calWrap = h('div.dw__calwrap', { hidden: true });
    const stage = h('div.pz__stage', grid, calWrap);
    const keyEls = {};
    const keys = h('div.dw__keys', { role: 'group', 'aria-label': 'Letters' }, ROWS.map(r => h('div.dw__krow', r.map(k => {
      const wide = k === 'enter' || k === 'back';
      const btn = h('button.dw__k' + (wide ? '.dw__k--wide' : ''), {
        type: 'button', dataset: { key: k }, tabindex: '-1',
        /* a tap must not leave focus on the key: Enter would press it again */
        onmousedown: e => e.preventDefault(),
        'aria-label': k === 'enter' ? 'Enter: guess' : k === 'back' ? 'Backspace: take a letter back' : k.toUpperCase(),
        onclick: () => press(k),
      }, k === 'back' ? icon('arrow-left') : k === 'enter' ? 'Enter' : k);
      keyEls[k] = btn;
      return btn;
    }))));
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), {
      style: { '--ga': ctx.accent || 'var(--accent)', '--hit': cb ? '#ff9e3d' : '#3ddc84', '--near': cb ? '#62a8ff' : '#f2c94c' },
    }, h('style', { text: CSS }), top, msg, stage, keys, foot, live);
    el.appendChild(root);
    const say = t => { live.textContent = t; };

    /* ------------------------------ painting ------------------------------ */
    const scored = () => b.guesses.map((g, i) => ({ g, s: (b.marks[i] || '').split('').map(Number) }));
    function paint() {
      const sc = scored();
      rows.forEach((row, r) => {
        const cellsR = row.children;
        const word = r < sc.length ? sc[r].g : r === sc.length && !b.done ? typed : '';
        for (let c = 0; c < W.LENGTH; c++) {
          const t = cellsR[c];
          t.textContent = word[c] || '';
          if (r < sc.length) t.dataset.s = String(sc[r].s[c]); else delete t.dataset.s;
          t.classList.toggle('is-typed', r === sc.length && !!word[c]);
        }
        const name = { 2: 'right place', 1: 'in the word elsewhere', 0: 'not in the word' };
        row.setAttribute('aria-label', r < sc.length
          ? `Guess ${r + 1}: ${[...sc[r].g].map((ch, c) => `${ch.toUpperCase()} ${name[sc[r].s[c]]}`).join(', ')}`
          : r === sc.length && !b.done ? `Guess ${r + 1}: ${typed ? typed.toUpperCase() : 'empty'}` : `Guess ${r + 1}: not used`);
      });
      /* the best each key has done */
      const best = {};
      for (const { g, s } of sc) [...g].forEach((ch, i) => { best[ch] = Math.max(best[ch] ?? -1, s[i]); });
      for (const [k, btn] of Object.entries(keyEls)) { if (k.length === 1 && best[k] !== undefined) btn.dataset.s = String(best[k]); else delete btn.dataset.s; }
      triesEl.textContent = `${b.guesses.length} / ${W.TRIES}`;
      const k = kitStatus(W.GAME, dayKey());
      streakEl.textContent = k.streak === 1 ? '1 day' : `${k.streak} days`;
      const daily = dailyStreak();
      streakBox.title = `Daily Word streak: ${k.streak} day${k.streak === 1 ? '' : 's'} in a row · best ${k.best}. Daily streak (Daily Stars or Daily Word): ${daily.cur}.`;
      streakBox.setAttribute('aria-label', streakBox.title);
      root.classList.toggle('is-done', b.done);
      paintFoot();
    }
    const copyOut = h('textarea.dw__copied', { readonly: '', rows: '8', 'aria-label': 'Your result, to copy', hidden: true });
    function paintFoot() {
      if (!b.done) {
        foot.replaceChildren(h('span.pz__hint', { text: 'Type a five-letter word and press Enter. Green: right place. Gold: elsewhere in the word.' }), calBtn);
        return;
      }
      const secs = Math.round(b.ms / 1000);
      foot.replaceChildren(
        b.won
          ? h('div.dw__done', { role: 'status' }, icon('check-circle'), h('b', { text: `Solved in ${b.guesses.length} ${b.guesses.length === 1 ? 'try' : 'tries'}` }), h('small', { text: `${fmtTime(secs)} · a new word tomorrow` }))
          : h('div.dw__done.is-lost', { role: 'status' }, icon('x-circle'), h('b', { text: `The word was ${answer ? answer.toUpperCase() : 'not solved'}` }), h('small', { text: 'A new word tomorrow' })),
        h('button.pz__btn.dw__copy', { type: 'button', title: 'Copy your result: colours only, no letters', onclick: () => copyResult() }, icon('copy'), h('span', { text: 'Copy result' })),
        calBtn, copyOut);
    }
    /* the result, without the word: the date, the tries, the colours and the streak */
    function shareText() {
      const when = parseDay(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      const sq = { 2: cb ? '🟧' : '🟩', 1: cb ? '🟦' : '🟨', 0: '⬛' };
      const list = lastDays(W.tries(), {}, dayKey(), 30);
      return [
        `StaticOS Daily Word · ${when} · ${b.won ? b.guesses.length : 'X'}/${W.TRIES}`,
        ...b.marks.map(m => [...m].map(d => sq[d]).join('')),
        `${weekStrip(list)} last 7 days · 🔥 ${dailyStreak().cur}-day daily streak`,
      ].join('\n');
    }
    async function copyResult() {
      const text = shareText();
      const done = await copyText(text);
      if (done) { copyOut.hidden = true; say('Result copied. It has the colours, not the letters.'); }
      else { copyOut.hidden = false; copyOut.value = text; copyOut.focus(); copyOut.select(); say('Your browser would not copy it. The result is selected, ready to copy.'); }
      root.dataset.copied = String(done);
    }
    function toggleCalendar(on = calWrap.hidden) {
      calWrap.hidden = !on;
      calBtn.setAttribute('aria-pressed', String(on));
      if (!on) return;
      const close = h('button.pz__btn', { type: 'button', onclick: () => toggleCalendar(false) }, icon('x'), h('span', { text: 'Back to the word' }));
      calWrap.replaceChildren(h('div.dw__calbox',
        calendarView(h, lastDays(W.tries(), {}, dayKey(), 30), { title: 'Daily Word · last 30 days', hints: false, say: d => `in ${d.value} ${d.value === 1 ? 'try' : 'tries'}` }),
        close));
      close.focus({ preventScroll: true });
    }

    /* ------------------------------ playing ------------------------------ */
    function persist() { if (!dead) { b.ms = Math.round(elapsed()); W.saveBoard(b); } }
    function shake() {
      const row = rows[b.guesses.length];
      if (!row || reduced) return;
      row.classList.remove('is-shake');
      void row.offsetWidth;
      row.classList.add('is-shake');
    }
    function press(k) {
      if (dead || paused || b.done || !lex || !calWrap.hidden) return;
      if (k === 'back') { typed = typed.slice(0, -1); msg.textContent = ''; paint(); return; }
      if (k === 'enter') { guess(); return; }
      if (/^[a-z]$/.test(k) && typed.length < W.LENGTH) { typed += k; msg.textContent = ''; paint(); }
    }
    function guess() {
      if (typed.length < W.LENGTH) { msg.textContent = 'Five letters, please.'; shake(); return; }
      if (!W.allowed(typed, lex)) { msg.textContent = `${typed.toUpperCase()} is not in the word list.`; say(msg.textContent); shake(); return; }
      if (b.guesses.includes(typed)) { msg.textContent = 'You tried that one already.'; shake(); return; }
      const s = W.score(typed, answer);
      b.guesses.push(typed);
      b.marks.push(s.join(''));
      typed = '';
      const won = s.every(x => x === 2);
      const n = b.guesses.length;
      msg.textContent = '';
      onScore(n);
      if (won || n >= W.TRIES) {
        banked = elapsed();
        b.done = true;
        b.won = won;
        b.ms = Math.round(banked);
        W.saveBoard(b);
        let st = null;
        if (won) st = W.solve(day, n, Math.round(banked / 1000));
        paint();
        say(won ? `Solved in ${n} ${n === 1 ? 'try' : 'tries'}. Streak ${st?.streak ?? 0}.` : `Out of tries. The word was ${answer.toUpperCase()}.`);
        endT = setTimeout(() => {
          if (dead) return;
          onEnd(won
            ? { score: n, won: true, detail: `Daily Word in ${n}/${W.TRIES} · ${st.streak}-day streak (best ${st.best})` }
            : { won: false, detail: `The word was ${answer.toUpperCase()}. A new one tomorrow.` });
        }, reduced ? 400 : 1200);
        return;
      }
      persist();
      paint();
      const last = s.map(x => ({ 2: 'right', 1: 'elsewhere', 0: 'no' }[x])).join(', ');
      say(`Guess ${n}: ${last}. ${W.TRIES - n} left.`);
    }

    listen(window, 'keydown', e => {
      if (dead || !el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      const win = el.closest('.win');
      if (win && !win.classList.contains('is-active')) return;
      if (e.target?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
      if (!calWrap.hidden) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleCalendar(false); } return; }
      if (e.target?.closest?.('button') && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('.dw__keys')) return;
      const k = e.key;
      if (k === 'Enter') { e.preventDefault(); press('enter'); }
      else if (k === 'Backspace') { e.preventDefault(); press('back'); }
      else if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); press(k.toLowerCase()); }
    });
    listen(window, 'beforeunload', () => persist());

    /* ------------------------------ start ------------------------------ */
    paint();
    msg.textContent = 'Loading the word list…';
    const loadIt = () => loadWords().then(l => {
      if (dead) return;
      lex = l;
      answer = W.answerFor(day, lex);
      /* a board from another copy of the list: its colours are worked out again */
      b.marks = b.guesses.map(g => W.score(g, answer).join(''));
      startAt = performance.now();
      msg.textContent = '';
      onScore(b.guesses.length);
      paint();
      if (!b.done) saveT = setInterval(() => { if (!paused) persist(); }, 4000);
    }).catch(err => {
      if (dead) return;
      msg.replaceChildren(h('span', { text: 'The word list did not load. The first time, it needs the network. ' }),
        h('button.pz__btn', { type: 'button', onclick: () => { msg.textContent = 'Loading the word list…'; loadIt(); } }, icon('rotate-ccw'), h('span', { text: 'Try again' })));
      say(`The word list did not load (${err.message}).`);
    });
    loadIt();

    let cover = null;
    return {
      stop() {
        if (dead) return;
        persist();
        dead = true;
        clearTimeout(endT); clearInterval(saveT);
        offs.forEach(f => f());
        root.remove();
      },
      pause() {
        if (dead || paused || b.done) return;
        banked = elapsed();
        paused = true;
        persist();
        cover = h('div.pz__cover', { text: 'Paused' });
        stage.appendChild(cover);
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        startAt = performance.now();
        cover?.remove();
        cover = null;
      },
      /* a read-only snapshot for automated play-tests: no answer in it */
      peek: () => ({
        day, ready: !!lex, guesses: b.guesses.slice(), marks: b.marks.slice(), typed, done: b.done, won: b.won,
        streak: kitStatus(W.GAME, dayKey()).streak, daily: dailyStreak(), ms: Math.round(elapsed()),
      }),
    };
  },
};
