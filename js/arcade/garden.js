/* ============================================================
   arcade/garden.js — Gravity Garden for Static Arcade.

   Water falls from the taps. Flowers need a drink. You have a few
   seeds and sunbeams to place so that every flower gets water:

     seed     grows into a leaf, a solid square: water that lands on it
              runs off both sides
     sunbeam  melts the ice squares touching it, and the melted ice pours

   Water falls straight down; on something solid it runs sideways to
   the left and right, and falls again at the edge (the full rules are
   in ./garden-logic.js and under the board). The water you see is
   worked out after every placement — there is nothing to start.

   Thirty levels, made by tests/gen-garden.mjs and checked by an exact
   solver: every one can be done, and the par shown is the fewest
   things (seeds + sunbeams) that do it. Score = things placed, lower
   is better; a clear in par or under gets a star.

   Controls
     mouse / touch  pick Seed or Sunbeam, tap an open square to place it;
                    tap a placed one to take it back
     keyboard       arrows move · Space / Enter place or take back ·
                    1 seed · 2 sunbeam · U or Z undo · C clear
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, surface, FONT, rr } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import { LEVELS } from './garden-levels.js';
import { parse, flow, isOpen } from './garden-logic.js';

const GAME = 'garden';
const CSS = `${BASE}
.pz-gg__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-gg__stage{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);border-radius:14px;overflow:hidden;border:2px solid var(--line-2,rgba(255,255,255,.22));background:#0d1620;outline:none}
.pz-gg__stage:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-gg__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(6,14,18,.78);text-align:center;padding:16px}
.pz-gg__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-gg__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz-gg__tool[aria-pressed="true"]{background:color-mix(in srgb,var(--ga) 22%,transparent);border-color:color-mix(in srgb,var(--ga) 60%,transparent);color:var(--ink-0,#fff)}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let dead = false, paused = false;
    let level = Math.max(1, Math.min(LEVELS.length, Number(sv.level) || 1));
    let def = null, P = null, leaves = [], suns = [], undoStack = [], done = false, ended = false, tool = 'leaf', cur = 0, kbd = false, msg = '', R = null, raf = 0, t0 = 0;

    /* ---------- chrome ---------- */
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level' }, icon('chevron-right'));
    const levelV = h('span', { text: '1' });
    const nameV = h('small', { text: '' });
    const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV, nameV);
    const usedV = h('span', { text: '0' });
    const parV = h('small', { text: '' });
    const usedRead = h('div.pz__read', { title: 'Things placed (par: the fewest that water every flower)', 'aria-label': 'Placed' }, icon('grid'), usedV, parV);
    const bestV = h('small', { text: '' });
    const leafLeft = h('small', { text: '' }), sunLeft = h('small', { text: '' });
    const leafBtn = h('button.pz__btn.pz-gg__tool', { type: 'button', dataset: { tool: 'leaf' }, 'aria-pressed': 'true', title: 'Seed: grows into a leaf that runs water off both sides (1)' }, icon('layers'), h('span', { text: 'Seed' }), leafLeft);
    const sunBtn = h('button.pz__btn.pz-gg__tool', { type: 'button', dataset: { tool: 'sun' }, 'aria-pressed': 'false', title: 'Sunbeam: melts the ice squares beside it (2)' }, icon('sun'), h('span', { text: 'Sunbeam' }), sunLeft);
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Take back the last thing you did (U)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
    const clearBtn = h('button.pz__btn', { type: 'button', title: 'Take everything back (C)' }, icon('refresh'), h('span.pz__long', { text: 'Clear' }));
    const top = h('div.pz__top', prevBtn, levelRead, nextBtn, usedRead, bestV);
    const bar = h('div.pz__bar', leafBtn, sunBtn, undoBtn, clearBtn);
    const stage = h('div.pz-gg__stage', { tabindex: '0', role: 'application', 'aria-label': 'Gravity Garden' });
    const bw = h('div.pz-gg__bw', stage);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, bar, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Gravity Garden', () => draw());

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'water falls, and runs sideways along solid things · <kbd>1</kbd> seed · <kbd>2</kbd> sunbeam · <kbd>Space</kbd> place · <kbd>U</kbd> undo' }));
    const used = () => leaves.length + suns.length;
    const left = () => ({ leaf: def.leaves - leaves.length, sun: def.suns - suns.length });

    /* ---------- drawing ---------- */
    const geom = () => { const c = Math.floor(Math.min((sf.w - 8) / P.w, (sf.h - 8) / P.h)); return { c, ox: Math.floor((sf.w - c * P.w) / 2), oy: Math.floor((sf.h - c * P.h) / 2) }; };
    function sunDraw(g, cx, cy, r) {
      g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(cx, cy, r * 0.42, 0, 7); g.fill();
      g.strokeStyle = '#ffd24a'; g.lineWidth = Math.max(1.5, r * 0.1);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58); g.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); g.stroke(); }
    }
    function draw() {
      if (!P || !sf.g) return;
      const g = sf.g, G = geom(), c = G.c, now = performance.now() / 1000;
      sf.begin();
      const bg = g.createLinearGradient(0, 0, 0, sf.h); bg.addColorStop(0, '#102233'); bg.addColorStop(1, '#0a1119');
      g.fillStyle = bg; g.fillRect(0, 0, sf.w, sf.h);
      const wetFall = i => { const y = Math.floor(i / P.w); return y + 1 < P.h; };
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
        const i = y * P.w + x, px = G.ox + x * c, py = G.oy + y * c;
        g.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.05)'; g.fillRect(px, py, c, c);
        void wetFall;
      }
      /* water */
      const leafSet = new Set(leaves);
      for (const i of R.wet) {
        const x = i % P.w, y = (i - x) / P.w, px = G.ox + x * c, py = G.oy + y * c;
        const below = i + P.w, solidBelow = y + 1 < P.h && (P.cell[below] === 1 || leafSet.has(below) || (P.cell[below] === 4 && !R.melted.has(below)));
        const wob = reduced ? 0 : Math.sin(now * 4 + x) * c * 0.02;
        if (solidBelow) {
          g.fillStyle = 'rgba(70,170,255,.75)'; g.fillRect(px, py + c * 0.62 + wob, c, c * 0.38);
          g.fillStyle = 'rgba(190,230,255,.55)'; g.fillRect(px, py + c * 0.62 + wob, c, c * 0.06);
        } else {
          g.fillStyle = 'rgba(70,170,255,.7)'; g.fillRect(px + c * 0.34, py, c * 0.32, c);
          if (!reduced) { g.fillStyle = 'rgba(210,240,255,.6)'; for (let k = 0; k < 3; k++) { const yy = ((now * 1.6 + k / 3 + x * 0.13) % 1) * c; g.fillRect(px + c * 0.44, py + yy, c * 0.05, c * 0.16); } }
          else { g.fillStyle = 'rgba(210,240,255,.5)'; g.fillRect(px + c * 0.44, py + c * 0.2, c * 0.05, c * 0.2); }
        }
      }
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
        const i = y * P.w + x, px = G.ox + x * c, py = G.oy + y * c, cx = px + c / 2, cy = py + c / 2, k = P.cell[i];
        if (k === 1) {
          g.fillStyle = '#586280'; rr(g, px + 1, py + 1, c - 2, c - 2, c * 0.14); g.fill();
          g.fillStyle = '#3d455e'; rr(g, px + c * 0.14, py + c * 0.14, c * 0.72, c * 0.72, c * 0.1); g.fill();
        } else if (k === 2) {
          g.fillStyle = '#9aa7c2'; g.fillRect(px + c * 0.28, py, c * 0.44, c * 0.34); g.fillStyle = '#6f7c99'; g.fillRect(px + c * 0.36, py + c * 0.34, c * 0.28, c * 0.14);
        } else if (k === 4) {
          if (R.melted.has(i)) { g.fillStyle = 'rgba(160,220,255,.18)'; g.fillRect(px + c * 0.1, py + c * 0.7, c * 0.8, c * 0.2); }
          else {
            g.fillStyle = 'rgba(170,225,255,.85)'; rr(g, px + 2, py + 2, c - 4, c - 4, c * 0.12); g.fill();
            g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(px + c * 0.2, py + c * 0.3); g.lineTo(px + c * 0.45, py + c * 0.2); g.moveTo(px + c * 0.25, py + c * 0.7); g.lineTo(px + c * 0.6, py + c * 0.55); g.stroke();
          }
        } else if (k === 3) {
          const wet = R.watered.has(i);
          g.strokeStyle = wet ? '#3ccf7a' : '#6f7a66'; g.lineWidth = Math.max(2, c * 0.07); g.beginPath(); g.moveTo(cx, cy + c * 0.38); g.quadraticCurveTo(cx + (wet ? 0 : c * 0.12), cy + c * 0.12, cx, cy); g.stroke();
          g.fillStyle = wet ? '#ff7ab6' : '#8b8497';
          for (let p = 0; p < 6; p++) { const a = p * Math.PI / 3 + (wet ? 0 : 0.4); g.beginPath(); g.arc(cx + Math.cos(a) * c * 0.17, cy - c * 0.06 + Math.sin(a) * c * 0.17 + (wet ? 0 : c * 0.06), c * 0.12, 0, 7); g.fill(); }
          g.fillStyle = wet ? '#ffe44d' : '#a39b73'; g.beginPath(); g.arc(cx, cy - c * 0.06 + (wet ? 0 : c * 0.06), c * 0.1, 0, 7); g.fill();
        }
        if (leafSet.has(i)) {
          g.fillStyle = '#43d17a'; g.beginPath(); g.ellipse(cx, cy + c * 0.12, c * 0.46, c * 0.3, 0, 0, 7); g.fill();
          g.strokeStyle = '#1f8a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - c * 0.4, cy + c * 0.12); g.lineTo(cx + c * 0.4, cy + c * 0.12); g.stroke();
        }
        if (suns.includes(i)) sunDraw(g, cx, cy, c * 0.5);
      }
      /* the cursor */
      if (kbd && !done) { const x = cur % P.w, y = Math.floor(cur / P.w); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.setLineDash([5, 4]); g.strokeRect(G.ox + x * c + 3, G.oy + y * c + 3, c - 6, c - 6); g.setLineDash([]); }
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `700 ${Math.round(c * 0.2)}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
      void t0;
    }
    function tick() {
      raf = 0;
      if (dead) return;
      if (!paused) draw();
      raf = requestAnimationFrame(tick);
    }

    /* ---------- play ---------- */
    function paint() {
      R = flow(P, leaves, suns);
      levelV.textContent = `${level}/${LEVELS.length}`;
      nameV.textContent = def.name;
      usedV.textContent = String(used());
      parV.textContent = `par ${def.par}`;
      bestV.textContent = bests[level] != null ? `Best: ${bests[level]}${bests[level] <= def.par ? ' ★' : ''}` : '';
      const lf = left();
      leafLeft.textContent = `${lf.leaf} left`; sunLeft.textContent = `${lf.sun} left`;
      leafBtn.disabled = def.leaves === 0; sunBtn.disabled = def.suns === 0;
      leafBtn.setAttribute('aria-pressed', String(tool === 'leaf')); sunBtn.setAttribute('aria-pressed', String(tool === 'sun'));
      prevBtn.disabled = level <= 1; nextBtn.disabled = level >= LEVELS.length;
      undoBtn.disabled = !undoStack.length || done; clearBtn.disabled = !used() || done;
      draw();
    }
    function open(n) {
      level = Math.max(1, Math.min(LEVELS.length, n));
      def = LEVELS[level - 1]; P = parse(def);
      leaves = []; suns = []; undoStack = []; done = false; ended = false; paused = false; msg = '';
      tool = def.leaves ? 'leaf' : 'sun';
      cur = Math.floor(P.cell.length / 2);
      bw.querySelector('.pz__cover')?.remove(); stage.querySelector('.pz-gg__card')?.remove();
      save(GAME, { level });
      onScore(0);
      paint();
      const flowers = P.flowers.length;
      say(`${def.name}: water ${flowers === 1 ? 'the flower' : `all ${flowers} flowers`} with ${def.leaves ? `${def.leaves} seed${def.leaves === 1 ? '' : 's'}` : ''}${def.leaves && def.suns ? ' and ' : ''}${def.suns ? `${def.suns} sunbeam${def.suns === 1 ? '' : 's'}` : ''}. Par is ${def.par}.`);
    }
    const can = () => !dead && !paused && !done && !!P;
    function toggleAt(i) {
      if (!can() || i < 0 || i >= P.cell.length) return false;
      const li = leaves.indexOf(i), si = suns.indexOf(i);
      if (li >= 0) { leaves.splice(li, 1); undoStack.push({ k: 'leaf', i, add: false }); }
      else if (si >= 0) { suns.splice(si, 1); undoStack.push({ k: 'sun', i, add: false }); }
      else if (!isOpen(P, i)) { say('Only an open square will take a seed or a sunbeam.'); return false; }
      else if (tool === 'leaf') { if (left().leaf <= 0) { say('No seeds left: take one back first.'); return false; } leaves.push(i); undoStack.push({ k: 'leaf', i, add: true }); }
      else { if (left().sun <= 0) { say('No sunbeams left: take one back first.'); return false; } suns.push(i); undoStack.push({ k: 'sun', i, add: true }); }
      onScore(used());
      paint();
      if (P.flowers.every(f => R.watered.has(f))) win();
      else say(`${R.watered.size} of ${P.flowers.length} flower${P.flowers.length === 1 ? '' : 's'} watered.`);
      return true;
    }
    function win() {
      done = true;
      const n = used(), inPar = n <= def.par, prev = bests[level], fresh = prev == null || n < prev;
      if (fresh) { bests[level] = n; save(GAME, { best: bests }); }
      if (level < LEVELS.length) save(GAME, { level: level + 1 });
      paint();
      const line = inPar ? `In par: ${def.par} is the fewest there are.` : `Par is ${def.par}: ${n - def.par} more than the fewest.`;
      stage.appendChild(h('div.pz-gg__card', h('div', h('b', { text: inPar ? 'Every flower watered, in par!' : 'Every flower watered!' }),
        h('span', { text: `${def.name} with ${n} thing${n === 1 ? '' : 's'}${fresh && prev != null ? ' — a new best' : ''}. ${line}${level < LEVELS.length ? ` Play again for level ${level + 1}.` : ' That was the last level.'}` }))));
      say(`Every flower is watered with ${n}. ${line}`);
      onScore(n);
      if (!ended) { ended = true; onEnd({ score: n, won: true, detail: `Level ${level} · ${def.name} · par ${def.par}${inPar ? ' (in par)' : ''}` }); }
    }
    function undo() {
      if (!can() || !undoStack.length) return;
      const a = undoStack.pop();
      if (a.k === 'leaf') { if (a.add) leaves.splice(leaves.indexOf(a.i), 1); else leaves.push(a.i); }
      else if (a.add) suns.splice(suns.indexOf(a.i), 1); else suns.push(a.i);
      onScore(used());
      paint(); say('Taken back.');
    }
    function clearAll() { if (!can() || !used()) return; leaves = []; suns = []; undoStack = []; onScore(0); paint(); say('Cleared.'); }
    const pick = t => { if (dead) return; if (t === 'sun' && !def.suns) return; if (t === 'leaf' && !def.leaves) return; tool = t; paint(); };

    /* ---------- input ---------- */
    const cellAt = e => {
      const b = sf.cv.getBoundingClientRect(), G = geom();
      const x = Math.floor((e.clientX - b.left - G.ox) / G.c), y = Math.floor((e.clientY - b.top - G.oy) / G.c);
      return x >= 0 && y >= 0 && x < P.w && y < P.h ? y * P.w + x : -1;
    };
    L.on(sf.cv, 'pointerdown', e => {
      if (e.button > 0 || !P) return;
      e.preventDefault();
      const c = cellAt(e);
      stage.focus({ preventScroll: true });
      if (c < 0) return;
      kbd = false; cur = c; toggleAt(c);
    });
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || !P || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        if (!can()) return;
        e.preventDefault(); kbd = true;
        const x = cur % P.w + MOVE[k][0], y = Math.floor(cur / P.w) + MOVE[k][1];
        if (x >= 0 && y >= 0 && x < P.w && y < P.h) cur = y * P.w + x;
        draw();
      } else if (k === ' ' || k === 'Enter') { if (!can()) return; e.preventDefault(); unfocus(); if (!e.repeat) { kbd = true; toggleAt(cur); } }
      else if (k === '1') { e.preventDefault(); pick('leaf'); }
      else if (k === '2') { e.preventDefault(); pick('sun'); }
      else if (k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
      else if (k === 'c' || k === 'C' || k === 'r' || k === 'R') { e.preventDefault(); clearAll(); }
    });
    L.on(leafBtn, 'click', () => pick('leaf'));
    L.on(sunBtn, 'click', () => pick('sun'));
    L.on(prevBtn, 'click', () => { if (level > 1) open(level - 1); });
    L.on(nextBtn, 'click', () => { if (level < LEVELS.length) open(level + 1); });
    L.on(undoBtn, 'click', undo);
    L.on(clearBtn, 'click', clearAll);

    open(level);
    if (!reduced) raf = requestAnimationFrame(tick);
    requestAnimationFrame(() => { if (!dead) stage.focus({ preventScroll: true }); });

    return {
      stop() { if (dead) return; dead = true; cancelAnimationFrame(raf); L.clear(); sf.destroy(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); draw(); },
      peek: () => P && ({
        level, name: def.name, par: def.par, budget: { leaves: def.leaves, suns: def.suns }, w: P.w, h: P.h, rows: def.rows.slice(),
        leaves: leaves.slice(), suns: suns.slice(), used: used(), wet: [...R.wet], watered: [...R.watered], melted: [...R.melted], flowers: P.flowers.slice(),
        done, paused, tool, left: left(), best: { ...bests }, undo: undoStack.length, cursor: cur,
        geo: (() => { const G = geom(), b = sf.cv.getBoundingClientRect(); return { left: b.left, top: b.top, ox: G.ox, oy: G.oy, c: G.c }; })(),
      }),
      /* test hook — nothing in the game calls it: level(n) */
      hook(cmd, a) { if (cmd === 'level') open(a); return true; },
    };
  },
};
