/* ============================================================
   arcade/daily.js — Daily Stars, Static Arcade's puzzle of the day.

   One new puzzle each day, made from the date (./stars.js), so
   everyone who opens it on the same date gets the same grid. Place
   one star in every row, every column and every coloured region;
   stars may not touch, not even at a corner.

   Click (or tap) a square once for ✕ — "no star here", a note to
   yourself — and again for a star; a third click clears it. Right-
   click puts a star straight in. Dragging from a square you just
   ✕-ed marks the empty squares you pass over. Stars that break a
   rule turn red. Keyboard: arrows move, Space or Enter cycles, S
   stars, X crosses, Backspace clears, Z or U undoes.

   The board, the time spent (counted only while it is on screen and
   not paused) and whether it is solved are kept per device by
   ./daily-state.js, so closing the window keeps your place. Solving
   it moves your streak on; the result card shows the time. The
   cells are buttons (not a canvas), so Static Replay can't record it.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { generate, check, dayKey, addDays, parseDay, REGION_HUES as HUES } from './stars.js';
import * as DS from './daily-state.js';

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.6l2.75 5.9 6.45.75-4.78 4.4 1.27 6.38L12 16.85l-5.69 3.18 1.27-6.38-4.78-4.4 6.45-.75z"/></svg>';
const CROSS = '<svg class="x" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
const SAVE_EVERY = 4000;

const fmt = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const until = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); const hh = Math.floor(m / 60); return hh ? `${hh} h ${m % 60} min` : `${m} min`; };

const CSS = `
.arx-dsc{position:absolute;inset:0;container-type:size}
.arx-dsc *{box-sizing:border-box}
.arx-ds{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;gap:var(--sp-3,8px);padding:var(--sp-5,16px);
  font-family:var(--font,system-ui);color:var(--ink-1);user-select:none;-webkit-user-select:none}
.arx-ds__top{width:min(100%,640px);display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3,8px)}
.arx-ds__title{flex:1;min-width:150px;display:flex;flex-direction:column;gap:2px}
.arx-ds__title b{font-size:var(--fs-15,15px);font-weight:750;color:var(--ink-0)}
.arx-ds__title small{font-size:var(--fs-11,11px);color:var(--ink-3)}
.arx-ds__read{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-1);
  font-size:var(--fs-13,13px);font-weight:700;color:var(--ink-0);font-variant-numeric:tabular-nums}
.arx-ds__read .icon{width:15px;height:15px;color:var(--ink-3)}
.arx-ds__read--streak .icon{color:#ff9d3c}
.arx-ds__rules{width:min(100%,640px);margin:0;font-size:var(--fs-12,12px);line-height:1.5;color:var(--ink-2)}
.arx-ds__wrap{position:relative;flex:1 1 auto;min-height:180px;width:100%;container-type:size;display:grid;place-items:center}
.arx-ds__board{--n:8;position:relative;width:min(100cqw,100cqh,620px);height:min(100cqw,100cqh,620px);display:grid;
  grid-template-columns:repeat(var(--n),minmax(0,1fr));grid-template-rows:repeat(var(--n),minmax(0,1fr));
  border:3px solid #0b0810;border-radius:10px;overflow:hidden;background:#0b0810;box-shadow:0 14px 40px -18px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.06);
  container-type:inline-size;touch-action:none}
.arx-ds__c{position:relative;display:grid;place-items:center;min-width:0;min-height:0;padding:0;margin:0;cursor:pointer;outline:none;
  background:hsl(var(--rh) 52% 36%);border-style:solid;border-color:#0b0810;border-width:var(--bt,1px) var(--br,1px) var(--bb,1px) var(--bl,1px);
  color:#fff;-webkit-tap-highlight-color:transparent;transition:filter .12s}
.arx-ds__c:nth-child(odd){background:hsl(var(--rh) 50% 34%)}
@media (hover:hover){.arx-ds:not(.is-done) .arx-ds__c:hover{filter:brightness(1.18)}}
.arx-ds__c:focus-visible{box-shadow:inset 0 0 0 3px #fff;z-index:1}
.arx-ds__c svg{width:62%;height:62%;fill:#ffe066;stroke:#3a2a00;stroke-width:1.2;stroke-linejoin:round;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.arx-ds__c svg.x{width:38%;height:38%;fill:none;stroke:rgba(255,255,255,.62);stroke-width:2.8;stroke-linecap:round;filter:none}
.arx-ds__c.is-bad svg{fill:#ff5a6e;stroke:#3a0008}
.arx-ds__c.is-bad{background-image:repeating-linear-gradient(135deg,rgba(255,60,80,.28) 0 6px,transparent 6px 12px)}
.arx-ds.is-done .arx-ds__c{cursor:default}
.arx-ds.is-done .arx-ds__c svg:not(.x){animation:arx-ds-glow 1.6s ease-in-out infinite alternate}
.arx-ds.is-new .arx-ds__c svg:not(.x){animation:arx-ds-pop .5s cubic-bezier(.2,1.6,.4,1) both;animation-delay:calc(var(--i,0) * 60ms)}
.arx-ds.is-reduced .arx-ds__c svg{animation:none!important}
@keyframes arx-ds-glow{from{filter:drop-shadow(0 0 2px rgba(255,224,102,.5))}to{filter:drop-shadow(0 0 10px rgba(255,224,102,.95))}}
@keyframes arx-ds-pop{from{transform:scale(.3);opacity:.2}to{transform:none;opacity:1}}
.arx-ds__cover{position:absolute;inset:0;display:grid;place-items:center;border-radius:10px;background:#120d14;font-size:clamp(18px,5cqmin,28px);font-weight:800;color:#fff;z-index:3}
.arx-ds__foot{width:min(100%,640px);min-height:36px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:var(--sp-3,8px);font-size:var(--fs-12,12px);color:var(--ink-3);text-align:center}
.arx-ds__hint{flex:1 1 220px}
.arx-ds__btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1);background:var(--fill-1);
  border:1px solid var(--line-1);border-radius:var(--r-md,11px);cursor:pointer}
.arx-ds__btn .icon{width:14px;height:14px}
.arx-ds__btn:disabled{opacity:.45;cursor:default}
@media (hover:hover){.arx-ds__btn:not(:disabled):hover{background:var(--fill-2);color:var(--ink-0)}}
.arx-ds__btn:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.arx-ds__done{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;padding:8px 14px;border-radius:99px;font-size:var(--fs-13,13px);font-weight:600;color:var(--ink-0);
  background:color-mix(in srgb,#3ddc84 16%,transparent);border:1px solid color-mix(in srgb,#3ddc84 50%,transparent)}
.arx-ds__done .icon{width:16px;height:16px;color:#3ddc84}
.arx-ds__done small{font-weight:500;color:var(--ink-2)}
@container (max-width:460px){.arx-ds{padding:var(--sp-3,8px);gap:6px}.arx-ds__rules{font-size:var(--fs-11,11px)}}
@container (max-height:500px){.arx-ds__rules,.arx-ds__hint{display:none}}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = !!ctx.reduced;
    const day = dayKey();
    const P = generate(day);
    const n = P.n, N = n * n;
    const saved = DS.board(day);
    let marks = saved.marks.split('').map(Number);
    let solved = saved.solved;
    let banked = saved.ms, startAt = performance.now(), paused = false, dead = false;
    let focusIdx = Math.max(0, marks.indexOf(0));
    let paint = null, skipClick = false, endT = 0, saveT = 0, tick = 0, lastShown = -1;
    const undoStack = [];
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };
    const elapsed = () => banked + (!paused && !solved && !dead ? performance.now() - startAt : 0);

    /* ------------------------------ the page ------------------------------ */
    const date = parseDay(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const timeEl = h('span', { text: fmt(elapsed()) });
    const streakEl = h('span');
    const streakBox = h('span.arx-ds__read.arx-ds__read--streak', icon('flame'), streakEl);
    const top = h('div.arx-ds__top',
      h('div.arx-ds__title', h('b', { text: 'Daily Stars' }), h('small', { text: `${date} · ${n}×${n} · the same puzzle for everyone today` })),
      h('span.arx-ds__read', { title: 'Time on this puzzle (only while it is on screen)' }, icon('clock'), timeEl),
      streakBox);
    const rules = h('p.arx-ds__rules', { text: 'Place one star in every row, every column and every colour. Stars can’t touch — not even at a corner.' });
    const board = h('div.arx-ds__board', { role: 'grid', 'aria-label': `Daily Stars, ${n} by ${n}`, style: { '--n': String(n) } });
    const wrap = h('div.arx-ds__wrap', board);
    const hint = h('span.arx-ds__hint', { text: 'Click a square once for ✕, twice for a star. Right-click places a star.' });
    const undoBtn = h('button.arx-ds__btn', { type: 'button', title: 'Undo (Z)', onclick: () => { undo(); refocus(); } }, icon('corner-up-left'), h('span', { text: 'Undo' }));
    const clearBtn = h('button.arx-ds__btn', { type: 'button', title: 'Clear the board (Undo brings it back)', onclick: () => { clearAll(); refocus(); } }, icon('rotate-ccw'), h('span', { text: 'Clear' }));
    const foot = h('div.arx-ds__foot');
    const live = h('div', { 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } });
    const root = h('div.arx-ds' + (reduced ? '.is-reduced' : ''), top, rules, wrap, foot);
    const shell = h('div.arx-dsc', { style: { '--ga': ctx.accent || 'var(--accent)' } }, h('style', { text: CSS }), root, live);
    el.appendChild(shell);
    const refocus = () => cells[focusIdx]?.focus({ preventScroll: true });

    /* the cells, with thick lines between regions */
    const cells = [];
    const regionName = g => `colour ${g + 1}`;
    for (let i = 0; i < N; i++) {
      const r = Math.floor(i / n), c = i % n, g = P.regions[i];
      const edge = (rr, cc) => (rr < 0 || rr >= n || cc < 0 || cc >= n || P.regions[rr * n + cc] !== g ? '3px' : '1px');
      const b = h('button.arx-ds__c', {
        type: 'button', role: 'gridcell', tabindex: i === focusIdx ? '0' : '-1',
        dataset: { i: String(i), r: String(r), c: String(c), region: String(g) },
        style: { '--rh': String(HUES[g % HUES.length]), '--bt': edge(r - 1, c), '--bb': edge(r + 1, c), '--bl': edge(r, c - 1), '--br': edge(r, c + 1), '--i': String(r + c) },
      });
      cells.push(b);
      board.appendChild(b);
    }

    function render() {
      const stars = new Set();
      marks.forEach((m, i) => { if (m === 2) stars.add(i); });
      const res = check(n, P.regions, stars);
      cells.forEach((b, i) => {
        const m = marks[i];
        b.dataset.m = String(m);
        b.innerHTML = m === 2 ? STAR : m === 1 ? CROSS : '';
        b.classList.toggle('is-bad', m === 2 && res.bad.has(i));
        const r = Math.floor(i / n), c = i % n;
        b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, ${regionName(P.regions[i])}: ${m === 2 ? (res.bad.has(i) ? 'star, breaks a rule' : 'star') : m === 1 ? 'crossed out' : 'empty'}`);
        b.tabIndex = i === focusIdx ? 0 : -1;
      });
      root.classList.toggle('is-done', solved);
      undoBtn.disabled = solved || !undoStack.length;
      clearBtn.disabled = solved || !marks.some(Boolean);
      paintStreak();
      paintFoot();
      return res;
    }
    function paintStreak() {
      const st = DS.read();
      const cur = DS.currentStreak(st, dayKey());
      streakEl.textContent = cur === 1 ? '1 day' : `${cur} days`;
      streakBox.title = `Streak: ${cur} day${cur === 1 ? '' : 's'} in a row · best ${st.streak.best}`;
      streakBox.setAttribute('aria-label', streakBox.title);
    }
    function paintFoot() {
      if (solved) {
        const st = DS.read();
        const next = parseDay(addDays(day, 1)).getTime() - Date.now();
        const secs = Math.round((st.day === day ? st.solvedMs : elapsed()) / 1000);
        foot.replaceChildren(h('div.arx-ds__done', { role: 'status' }, icon('check-circle'),
          h('b', { text: `Solved in ${fmt(secs * 1000)}` }),
          h('small', { text: `Streak ${DS.currentStreak(st, dayKey())} · best ${st.streak.best} · a new puzzle in ${until(next)}` })));
        return;
      }
      foot.replaceChildren(hint, undoBtn, clearBtn);
    }
    function paintTime() {
      const t = elapsed();
      const s = Math.floor(t / 1000);
      if (s === lastShown) return;
      lastShown = s;
      timeEl.textContent = fmt(t);
      onScore(s);
    }

    /* ------------------------------ changes ------------------------------ */
    const snapshot = () => marks.join('');
    function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); }
    function persist() { if (!solved) DS.save(day, snapshot(), elapsed()); }
    function changed() {
      const res = render();
      if (res.solved && !solved) win();
      else persist();
    }
    function setMark(i, m) {
      if (solved || paused || dead || i < 0 || i >= N || marks[i] === m) return false;
      marks[i] = m;
      return true;
    }
    function cycle(i) { pushUndo(); setMark(i, (marks[i] + 1) % 3); focusIdx = i; changed(); }
    function setOne(i, m) { pushUndo(); if (!setMark(i, m)) undoStack.pop(); focusIdx = i; changed(); }
    function undo() {
      if (solved || paused || !undoStack.length) return;
      marks = undoStack.pop().split('').map(Number);
      changed();
      say('Undone.');
    }
    function clearAll() {
      if (solved || paused || !marks.some(Boolean)) return;
      pushUndo();
      marks = marks.map(() => 0);
      changed();
      say('Board cleared. Undo brings it back.');
    }
    function say(t) { live.textContent = t; }

    function win() {
      const ms = elapsed();
      banked = ms;
      solved = true;
      const st = DS.solve(day, snapshot(), ms);
      root.classList.add('is-new');
      render();
      const secs = Math.round(ms / 1000);
      onScore(secs);
      timeEl.textContent = fmt(secs * 1000);
      say(`Solved in ${fmt(secs * 1000)}. Streak ${st.streak.cur}.`);
      endT = setTimeout(() => {
        if (dead) return;
        const cur = DS.currentStreak(DS.read(), dayKey());
        onEnd({ score: secs, won: true, detail: `Daily Stars ${n}×${n} · ${cur}-day streak (best ${st.streak.best})` });
      }, reduced ? 400 : 1300);
    }

    /* ------------------------------ input ------------------------------ */
    const cellOf = t => t?.closest?.('.arx-ds__c');
    listen(board, 'pointerdown', e => {
      const b = cellOf(e.target);
      if (!b || solved || paused) return;
      const i = Number(b.dataset.i);
      if (e.button === 2) { e.preventDefault(); setOne(i, marks[i] === 2 ? 0 : 2); return; }
      if (e.button !== 0) return;
      skipClick = true;                 /* the click that follows this press is already handled */
      cycle(i);
      b.focus({ preventScroll: true });
      /* a drag from a fresh ✕ crosses out the empty squares it passes */
      if (marks[i] === 1) {
        paint = { id: e.pointerId };
        try { board.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      }
    });
    listen(board, 'pointermove', e => {
      if (!paint || paint.id !== e.pointerId) return;
      const b = cellOf(document.elementFromPoint(e.clientX, e.clientY));
      if (!b || !board.contains(b)) return;
      const i = Number(b.dataset.i);
      if (marks[i] === 0 && setMark(i, 1)) { focusIdx = i; render(); }
    });
    const endPaint = () => { if (paint) { paint = null; persist(); } };
    listen(board, 'pointerup', endPaint);
    listen(board, 'pointercancel', endPaint);
    listen(board, 'contextmenu', e => e.preventDefault());
    /* a click with no pointer before it: the keyboard (Space/Enter on a cell) or assistive tech */
    listen(board, 'click', e => {
      if (skipClick) { skipClick = false; return; }
      const b = cellOf(e.target);
      if (!b || solved || paused) return;
      cycle(Number(b.dataset.i));
    });
    /* a reload or a closed tab keeps the latest time (the store writes itself out on pagehide) */
    listen(window, 'beforeunload', () => { if (!dead) persist(); });
    listen(board, 'focusin', e => { const b = cellOf(e.target); if (b) { focusIdx = Number(b.dataset.i); cells.forEach((c, i) => { c.tabIndex = i === focusIdx ? 0 : -1; }); } });

    listen(window, 'keydown', e => {
      if (dead || !el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      const win = el.closest('.win');
      if (win && !win.classList.contains('is-active')) return;
      const t = e.target;
      if (t?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
      const inBoard = board.contains(t);
      const k = e.key;
      if (k === ' ' || k === 'Enter') skipClick = false;     /* this click comes from the keyboard */
      const mv = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 }[k];
      if (mv !== undefined) {
        e.preventDefault();
        const r = Math.floor(focusIdx / n), c = focusIdx % n;
        if ((k === 'ArrowLeft' && c === 0) || (k === 'ArrowRight' && c === n - 1) || (k === 'ArrowUp' && r === 0) || (k === 'ArrowDown' && r === n - 1)) { refocus(); return; }
        focusIdx += mv;
        cells.forEach((b, i) => { b.tabIndex = i === focusIdx ? 0 : -1; });
        refocus();
        return;
      }
      if (solved || paused) return;
      if ((k === ' ' || k === 'Enter') && !inBoard) {
        if (t?.closest?.('button,a,[role="button"]')) return;
        e.preventDefault(); cycle(focusIdx); refocus(); return;
      }
      if (k === 's' || k === 'S' || k === '*') { e.preventDefault(); setOne(focusIdx, marks[focusIdx] === 2 ? 0 : 2); refocus(); return; }
      if (k === 'x' || k === 'X' || k === '.') { e.preventDefault(); setOne(focusIdx, marks[focusIdx] === 1 ? 0 : 1); refocus(); return; }
      if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); setOne(focusIdx, 0); refocus(); return; }
      if (k === 'z' || k === 'Z' || k === 'u' || k === 'U') { e.preventDefault(); undo(); refocus(); }
    });

    /* ------------------------------ start ------------------------------ */
    render();
    if (solved) {
      const secs = Math.round(saved.solvedMs / 1000);
      timeEl.textContent = fmt(secs * 1000);
      onScore(secs);
    } else {
      onScore(Math.floor(banked / 1000));
      tick = setInterval(paintTime, 250);
      saveT = setInterval(() => { if (!paused && !solved) persist(); }, SAVE_EVERY);
    }
    setTimeout(() => { if (!dead && !solved) refocus(); }, 60);

    let cover = null;
    return {
      stop() {
        if (dead) return;
        persist();
        dead = true;
        clearInterval(tick); clearInterval(saveT); clearTimeout(endT);
        offs.forEach(f => f());
        shell.remove();
      },
      pause() {
        if (dead || paused || solved) return;
        banked = elapsed();
        paused = true;
        persist();
        cover = h('div.arx-ds__cover', { text: 'Paused' });
        wrap.appendChild(cover);
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        startAt = performance.now();
        cover?.remove();
        cover = null;
        refocus();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => {
        const st = DS.read();
        return {
          day, n, regions: Array.from(P.regions).join(','), unique: P.unique, marks: marks.join(''),
          solved, ms: Math.round(elapsed()), paused, focus: focusIdx,
          streak: { cur: DS.currentStreak(st, dayKey()), best: st.streak.best, last: st.streak.last },
        };
      },
    };
  },
};
