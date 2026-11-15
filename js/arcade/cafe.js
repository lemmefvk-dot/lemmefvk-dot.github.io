/* ============================================================
   arcade/cafe.js — Stack Cafe for Static Arcade.

   Customers sit at three seats and each wants a stack built in one
   exact order, bottom to top. Build it on the plate from the shelf and
   serve it before they lose patience. Three hearts; every customer who
   leaves takes one. Right stacks score by their size and by how much
   patience was left, and serving several right in a row adds more
   (rules in ./cafe-logic.js). Score = points, higher is better.

   Controls
     mouse / touch  drag an ingredient onto the plate (or just press it),
                    then drag the plate onto a customer (or press the
                    customer) · Bin empties the plate
     keyboard       1–6 add an ingredient · Q W E serve seat 1, 2, 3
                    · Space serves whoever ordered what is on the plate
                    · Backspace bins the plate

   Seeds, Beat-this links and ghosts (index.js SHARED OPTIONS): the
   customers come from ctx.seed by their number, so a round on a seed
   always has the same customers whatever you do. Every action is logged
   by the 1/60 s step it happened in; onEnd({ replay: { v: 1, acts } })
   plays the round again exactly. ctx.ghost.watch plays it back on its
   own; otherwise a second, silent cafe runs the best round's actions
   beside yours and the strip under the shelf shows its score and hearts.
   ctx.speed slows the clock (and keeps it from setting a best).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { rng, ownsKey, sounder, looper } from './kit.js';
import { CSS as BASE, reducedMotion, bag } from './puzzlekit.js';
import { STEP, SEATS, LIVES, INGREDIENTS, ADD, TRASH, SERVE, create, act, step } from './cafe-logic.js';

const SKIN = ['#f1c9a5', '#d9a06e', '#a8714a', '#7a4e32', '#f6dcc0'];
const HAIR = ['#2b1d14', '#7a3b22', '#c9a227', '#3a3a4a', '#a33b3b'];

const CSS = `${BASE}
.pz-cf{gap:var(--sp-3,10px)}
.pz-cf__seats{width:min(100%,640px);display:grid;grid-template-columns:repeat(${SEATS},1fr);gap:10px;flex:0 0 auto}
.pz-cf__seat{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-height:150px;padding:8px 6px;border-radius:14px;background:var(--fill-1,rgba(255,255,255,.06));border:2px solid var(--line-1,rgba(255,255,255,.1));cursor:pointer;color:inherit;font:inherit}
.pz-cf__seat.is-drop{border-color:var(--ga);background:color-mix(in srgb,var(--ga) 18%,transparent)}
.pz-cf__seat:focus-visible{outline:2px solid var(--ga)}
.pz-cf__seat.is-empty{opacity:.5;cursor:default}
.pz-cf__seat svg{width:46px;height:46px}
.pz-cf__pat{width:86%;height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}
.pz-cf__pat i{display:block;height:100%;width:100%;background:#3ddc84}
.pz-cf__seat small{font:600 11px/1.1 var(--font,system-ui);color:var(--ink-2,#bbb);text-align:center}
.pz-cf__stack{display:flex;flex-direction:column-reverse;align-items:center;gap:2px;margin-top:auto}
.pz-cf__ly{display:grid;place-items:center;height:14px;min-width:46px;padding:0 8px;border-radius:6px 6px 4px 4px;font:800 9px/1 var(--font,system-ui);color:rgba(0,0,0,.65)}
.pz-cf__mid{width:min(100%,640px);display:flex;align-items:flex-end;justify-content:center;gap:14px;flex:1 1 auto;min-height:150px}
.pz-cf__plate{position:relative;min-width:150px;min-height:130px;padding:8px 10px 14px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;border-radius:14px;border:2px dashed var(--line-2,rgba(255,255,255,.25));touch-action:none;cursor:grab}
.pz-cf__plate.is-drop{border-color:var(--ga);background:color-mix(in srgb,var(--ga) 15%,transparent)}
.pz-cf__plate .pz-cf__stack{margin-top:0}
.pz-cf__plate .pz-cf__ly{height:18px;min-width:100px;font-size:11px}
.pz-cf__plate::after{content:"";width:130px;height:6px;border-radius:3px;background:#e9e9ee;margin-top:3px}
.pz-cf__plate .pz-cf__none{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:var(--ink-3,#999);padding:8px;text-align:center}
.pz-cf__act{display:flex;flex-direction:column;gap:8px}
.pz-cf__shelf{width:min(100%,640px);display:grid;grid-template-columns:repeat(6,1fr);gap:8px;flex:0 0 auto}
.pz-cf__ing{display:grid;place-items:center;gap:3px;padding:10px 4px 6px;border-radius:12px;border:2px solid transparent;font:800 12px/1 var(--font,system-ui);color:rgba(0,0,0,.7);cursor:grab;touch-action:none}
.pz-cf__ing small{font:700 10px/1 var(--font,system-ui);opacity:.75}
.pz-cf__ing:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.pz-cf__fly{position:fixed;z-index:50;pointer-events:none;padding:8px 14px;border-radius:10px;font:800 13px/1 var(--font,system-ui);color:rgba(0,0,0,.7);box-shadow:0 6px 18px rgba(0,0,0,.4);transform:translate(-50%,-50%)}
.pz-cf__ghost{font-size:12px;color:var(--ink-2,#bbb);min-height:16px}
.pz-cf__hearts{display:inline-flex;gap:2px;color:#ff4d6d}
.pz-cf__hearts .off{opacity:.25}
.pz-cf__card{pointer-events:none;position:absolute;inset:0;display:grid;place-items:center;z-index:6;background:rgba(10,8,16,.84);text-align:center;padding:16px}
.pz-cf__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-cf__card span{font-size:13px;color:var(--ink-2,#bbb)}
@container (max-width:520px){.pz-cf__shelf{gap:5px}.pz-cf__seat{min-height:130px}}
`;

const faceSvg = (k, mood) => {
  const skin = SKIN[k % SKIN.length], hair = HAIR[(k * 3 + 1) % HAIR.length];
  const mouth = mood > 0.5 ? 'M14 31 Q23 38 32 31' : mood > 0.22 ? 'M15 33 L31 33' : 'M14 36 Q23 28 32 36';
  return `<svg viewBox="0 0 46 46" aria-hidden="true"><path d="M7 22 Q7 5 23 5 Q39 5 39 22 Q33 12 23 12 Q13 12 7 22Z" fill="${hair}"/><circle cx="23" cy="25" r="16" fill="${skin}"/><path d="M7 22 Q7 5 23 5 Q39 5 39 22 Q33 13 23 13 Q13 13 7 22Z" fill="${hair}"/><circle cx="17" cy="23" r="2.2" fill="#222"/><circle cx="29" cy="23" r="2.2" fill="#222"/><path d="${mouth}" stroke="#552" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
};

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (rng(Date.now() >>> 0)() * 2 ** 32) >>> 0;
    const speedK = Math.max(0.5, Math.min(1, Number(ctx.speed) || 1));
    /* a replay this module wrote (see the header): watched on its own, or run silently beside you */
    const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 && Array.isArray(ctx.ghost.data.acts) && ctx.ghost.data.acts.length < 20000 ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);
    const gacts = GH ? GH.data.acts.filter(a => Array.isArray(a) && a.length >= 2 && Number.isInteger(a[0]) && Number.isInteger(a[1])) : [];
    const G = GH && !watch ? create(seed) : null;
    let gi = 0;
    const S = create(seed);
    const log = [];
    let dead = false, paused = false, ended = false, acc = 0, msg = '', endT = 0, drag = null, binned = 0;
    let wi = 0;                                                  /* the watched replay's cursor */

    const scoreV = h('span', { text: '0' });
    const heartsV = h('span.pz-cf__hearts', { role: 'img' });
    const servedV = h('span', { text: '0' });
    const read = (label, ic, v) => h('div.pz__read', { title: label, 'aria-label': label }, icon(ic), v);
    const top = h('div.pz__top', read('Score', 'sparkles', scoreV), h('div.pz__read', { title: 'Hearts left', 'aria-label': 'Hearts left' }, heartsV), read('Customers served', 'check', servedV));
    const seatEls = Array.from({ length: SEATS }, (_, i) => h('button.pz-cf__seat.is-empty', { type: 'button', dataset: { seat: i }, 'aria-label': `Seat ${i + 1}: empty` }));
    const seats = h('div.pz-cf__seats', ...seatEls);
    const plateStack = h('div.pz-cf__stack');
    const plateNone = h('div.pz-cf__none', { text: 'Plate: drop ingredients here' });
    const plate = h('div.pz-cf__plate', { role: 'group', 'aria-label': 'Plate', tabindex: '0' }, plateNone, plateStack);
    const binBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'bin' }, title: 'Empty the plate (Backspace)' }, icon('x'), h('span', { text: 'Bin' }));
    const serveBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'serve' }, title: 'Serve whoever ordered this (Space)' }, icon('check'), h('span', { text: 'Serve' }));
    const mid = h('div.pz-cf__mid', plate, h('div.pz-cf__act', serveBtn, binBtn));
    const ings = INGREDIENTS.map((g, i) => h('button.pz-cf__ing', { type: 'button', dataset: { ing: i }, style: { background: g.color }, 'aria-label': `${g.name}, key ${i + 1}` }, g.short, h('small', { text: String(i + 1) })));
    const shelf = h('div.pz-cf__shelf', { role: 'group', 'aria-label': 'Ingredients' }, ...ings);
    const ghostV = h('div.pz-cf__ghost');
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz.pz-cf' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, seats, mid, shelf, ghostV, foot, live);
    el.appendChild(root);

    const say = (m, tell = true) => { msg = m; if (tell) { live.textContent = ''; live.textContent = m; } paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : watch ? h('span.pz__hint', { text: 'Watching a replay' })
        : h('span.pz__hint', { html: 'build the order on the plate · <kbd>1</kbd>–<kbd>6</kbd> add · <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> serve · <kbd>Space</kbd> serves the match · <kbd>Backspace</kbd> bins' }));

    const layer = (i, small = false) => h('div.pz-cf__ly', { style: { background: INGREDIENTS[i].color }, text: small ? INGREDIENTS[i].short : INGREDIENTS[i].name });
    const sig = new Array(SEATS).fill('');
    function paintSeats() {
      S.seats.forEach((c, i) => {
        const b = seatEls[i];
        const key = c ? `${c.k}` : '';
        if (key !== sig[i]) {
          sig[i] = key;
          b.classList.toggle('is-empty', !c);
          if (!c) b.replaceChildren(h('small', { text: 'Empty seat' }));
          else {
            b.replaceChildren(h('div', { html: faceSvg(c.k, 1) }), h('div.pz-cf__pat', h('i')),
              h('div.pz-cf__stack', ...c.order.map(o => layer(o, true))), h('small', { text: `Order ${c.k + 1}` }));
            b.setAttribute('aria-label', `Seat ${i + 1}: wants ${c.order.map(o => INGREDIENTS[o].name).join(', then ')}`);
          }
        }
        if (c) {
          const f = Math.max(0, c.left / c.patience), bar = b.querySelector('.pz-cf__pat i');
          bar.style.width = `${Math.round(f * 100)}%`;
          bar.style.background = f > 0.5 ? '#3ddc84' : f > 0.22 ? '#ffd23f' : '#ff4d6d';
          const mood = f > 0.5 ? 2 : f > 0.22 ? 1 : 0;
          if (b.dataset.mood !== String(mood)) { b.dataset.mood = String(mood); b.firstChild.innerHTML = faceSvg(c.k, f); }
        }
      });
    }
    function paintPlate() {
      plateStack.replaceChildren(...S.plate.map(i => layer(i)));
      plateNone.hidden = S.plate.length > 0;
      plate.setAttribute('aria-label', S.plate.length ? `Plate: ${S.plate.map(i => INGREDIENTS[i].name).join(', then ')}` : 'Plate: empty');
    }
    function paintTop() {
      scoreV.textContent = String(S.score);
      servedV.textContent = String(S.served);
      heartsV.replaceChildren(...Array.from({ length: LIVES }, (_, i) => h('span', { class: i < S.lives ? '' : 'off', text: '♥' })));
      heartsV.setAttribute('aria-label', `${S.lives} of ${LIVES} hearts`);
      if (G) ghostV.textContent = `Ghost: ${G.score} points, ${G.lives} heart${G.lives === 1 ? '' : 's'}${G.over ? ' (finished)' : ''}`;
    }

    /* ---------- what an action does (one place for the player, the keys and the watched replay) ---------- */
    function doAct(code, arg, byPlayer = true) {
      if (dead || paused || ended || S.over) return { ok: false };
      const r = act(S, code, arg);
      if (!r.ok) return r;
      if (byPlayer) log.push([S.t, code, arg ?? 0]);
      snd.wake();
      if (code === ADD) snd.blip(300 + 50 * arg, 0.05, 'triangle', 0.6);
      else if (code === TRASH) snd.blip(150, 0.07, 'sawtooth', 0.4, 90);
      else if (code === SERVE) {
        if (r.right) { snd.blip(660, 0.09, 'triangle', 0.8); snd.blip(880, 0.12, 'triangle', 0.6); say(`Served! +${r.gained}.`); onScore(S.score); }
        else { snd.blip(130, 0.15, 'sawtooth', 0.6); say('Wrong stack: the customer is less patient and the plate is binned.'); }
      }
      paintPlate(); paintTop(); paintSeats();
      return r;
    }
    const add = i => doAct(ADD, i);
    const serveAt = i => {
      if (!S.plate.length) { say('The plate is empty.'); return; }
      if (!S.seats[i]) { say(`Seat ${i + 1} is empty.`); return; }
      doAct(SERVE, i);
    };
    const serveMatch = () => {
      if (!S.plate.length) { say('The plate is empty.'); return; }
      const i = S.seats.findIndex(c => c && c.order.length === S.plate.length && c.order.every((v, j) => v === S.plate[j]));
      if (i < 0) say('Nobody ordered what is on the plate.'); else doAct(SERVE, i);
    };

    function events() {
      for (const ev of S.events.splice(0)) {
        if (ev.type === 'left') { snd.blip(110, 0.25, 'sawtooth', 0.7, 70); say(`A customer left from seat ${ev.seat + 1}: one heart lost.`); }
        else if (ev.type === 'arrived') ctx.announce?.(`A customer sits at seat ${ev.seat + 1}.`);
      }
    }

    function advance() {
      /* the watched replay: its actions at their steps; the ghost: the same, in its own cafe */
      if (watch) { while (wi < gacts.length && gacts[wi][0] <= S.t) { const a = gacts[wi++]; act(S, a[1], a[2]); } }
      if (G) { while (gi < gacts.length && gacts[gi][0] <= G.t) { const a = gacts[gi++]; act(G, a[1], a[2]); } step(G); G.events.length = 0; }
      step(S);
      events();
    }

    const loop = looper(raw => {
      if (paused || ended) return;
      acc += raw * speedK;
      let n = 0;
      while (acc >= STEP && n++ < 6 && !S.over) { acc -= STEP; advance(); }
      if (n >= 6) acc = 0;
      paintSeats(); paintTop();
      if (watch) paintPlate();
      if (S.over) finish();
    });

    function finish() {
      if (ended) return;
      ended = true; loop.stop();
      paintSeats(); paintTop();
      const secs = Math.round(S.t * STEP);
      const detail = `${S.score} points · ${S.served} served · best streak ${S.bestStreak} · lasted ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      root.appendChild(h('div.pz-cf__card', h('div', h('b', { text: 'Closing time' }), h('span', { text: detail }))));
      say('Three customers left. Closing time.');
      endT = setTimeout(() => {
        if (dead) return;
        onEnd({ score: S.score, won: false, detail, ...(watch ? {} : { replay: { v: 1, acts: log.map(a => a.slice()) } }), ...(speedK < 1 ? { assisted: true } : {}) });
      }, reduced ? 100 : 700);
    }

    /* ---------- keyboard ---------- */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e) || watch) return;
      const d = /^(Digit|Numpad)([1-6])$/.exec(e.code);
      if (d) { e.preventDefault(); if (!e.repeat) add(Number(d[2]) - 1); return; }
      if (e.code === 'KeyQ' || e.code === 'KeyW' || e.code === 'KeyE') { e.preventDefault(); if (!e.repeat) serveAt(['KeyQ', 'KeyW', 'KeyE'].indexOf(e.code)); }
      else if (e.code === 'Space') { if (e.target?.closest?.('button') && !root.contains(e.target)) return; e.preventDefault(); if (!e.repeat) serveMatch(); }
      else if (e.code === 'Backspace') { e.preventDefault(); doAct(TRASH); }
    });
    L.on(binBtn, 'click', () => { doAct(TRASH); });
    L.on(serveBtn, 'click', () => serveMatch());

    /* ---------- pointer: drag from the shelf to the plate, from the plate to a customer ---------- */
    const hover = (x, y) => { const e = document.elementFromPoint(x, y); return { plate: e?.closest?.('.pz-cf__plate') ? plate : null, seat: e?.closest?.('.pz-cf__seat') || null, bin: e?.closest?.('[data-act="bin"]') || null }; };
    function startDrag(e, kind, idx) {
      if (watch || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { kind, idx, x: e.clientX, y: e.clientY, id: e.pointerId, fly: null };
      try { e.target.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic pointers */ }
    }
    L.on(root, 'pointerdown', e => {
      const ing = e.target.closest?.('.pz-cf__ing');
      if (ing) { startDrag(e, 'ing', Number(ing.dataset.ing)); return; }
      if (e.target.closest?.('.pz-cf__plate') && S.plate.length) startDrag(e, 'plate', -1);
    });
    L.on(root, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.fly && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
        const label = drag.kind === 'ing' ? INGREDIENTS[drag.idx].name : 'Plate';
        const bg = drag.kind === 'ing' ? INGREDIENTS[drag.idx].color : '#e9e9ee';
        drag.fly = h('div.pz-cf__fly', { style: { background: bg }, text: label });
        document.body.appendChild(drag.fly);
      }
      if (drag.fly) {
        drag.fly.style.left = `${e.clientX}px`; drag.fly.style.top = `${e.clientY}px`;
        const t = hover(e.clientX, e.clientY);
        plate.classList.toggle('is-drop', drag.kind === 'ing' && !!t.plate);
        seatEls.forEach(s => s.classList.toggle('is-drop', drag.kind === 'plate' && t.seat === s));
      }
    });
    const endDrag = (e, cancel) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      d.fly?.remove();
      plate.classList.remove('is-drop'); seatEls.forEach(s => s.classList.remove('is-drop'));
      if (cancel) return;
      const t = hover(e.clientX, e.clientY);
      if (!d.fly) {                                    /* a press, not a drag */
        if (d.kind === 'ing') add(d.idx);
        return;
      }
      if (d.kind === 'ing' && t.plate) add(d.idx);
      else if (d.kind === 'plate') {
        if (t.seat) serveAt(Number(t.seat.dataset.seat));
        else if (t.bin) doAct(TRASH);
        else say('Drop the plate on a customer to serve it.');
      }
    };
    L.on(root, 'pointerup', e => endDrag(e, false));
    L.on(root, 'pointercancel', e => endDrag(e, true));
    /* keyboard activation of a focused button (pointer clicks were handled above) */
    for (const [i, b] of ings.entries()) L.on(b, 'click', e => { if (e.detail === 0) add(i); });
    for (const [i, b] of seatEls.entries()) L.on(b, 'click', () => { if (!watch) serveAt(i); });

    paintSeats(); paintPlate(); paintTop(); paintFoot(); onScore(0);
    if (watch) say('Watching a replay', false);
    loop.start();

    return {
      stop() { if (dead) return; dead = true; clearTimeout(endT); loop.stop(); drag?.fly?.remove(); L.clear(); snd.close(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; loop.stop(); drag?.fly?.remove(); drag = null; if (!ended) root.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; root.querySelector('.pz__cover')?.remove(); if (!ended) loop.start(); },
      peek: () => ({
        seed, t: S.t, secs: Math.round(S.t * STEP * 10) / 10, score: S.score, lives: S.lives, served: S.served, wrong: S.wrong, lost: S.lost, streak: S.streak, over: S.over, ended, paused,
        plate: S.plate.slice(), seats: S.seats.map(c => (c ? { k: c.k, order: c.order.slice(), left: c.left, patience: c.patience } : null)), logged: log.length, acts: log.map(a => a.slice()),
        watch, ghost: G ? { score: G.score, lives: G.lives, over: G.over, t: G.t } : null, nextK: S.nextK,
      }),
      /* test hook — nothing in the game calls it: skip(seconds) lets the cafe run on with no actions */
      hook(cmd, a) {
        if (cmd === 'skip') { const n = Math.round(Math.max(0, Number(a) || 0) / STEP); for (let i = 0; i < n && !S.over; i++) advance(); paintSeats(); paintTop(); if (S.over) finish(); return true; }
        return false;
      },
    };
  },
};
