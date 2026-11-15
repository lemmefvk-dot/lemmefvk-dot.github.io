/* ============================================================
   arcade/heist.js — Clockwork Heist for Static Arcade.

   Turn-based stealth. You are the thief: each turn step to a
   neighbouring square or wait, then every clockwork robot takes its
   step. A patrol walks its rails one square a turn and looks the way
   it is going; a camera stays put and turns on a timer. Anything in
   sight when the turn ends is caught. Take every gem, then reach the
   exit door.

   Twenty levels, made by tests/gen-heist.mjs and checked by an exact
   solver (./heist-logic.js): every one can be done, and the par
   shown is the fewest turns that do it. Score = turns, lower is
   better; a clear in par or under gets a star in the level list.

   What the board shows: the red squares are the ones watched AFTER
   your next action — stand on one at the end of your turn and you
   are caught — so the puzzle is timing, not guessing. Patrol rails
   are drawn as dotted lines; a camera's dots count the turns until
   it turns.

   Controls
     mouse / touch  tap a square next to the thief to step there;
                    tap the thief (or Wait) to stay put
     keyboard       arrows / W A S D step · Space or . waits ·
                    U / Z / Backspace undo · R restart level
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, surface, FONT, rr } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import { LEVELS } from './heist-levels.js';
import { parse, robotAt, watched, step, startState, DIRS } from './heist-logic.js';

const GAME = 'heist';
const CSS = `${BASE}
.pz-hs__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-hs__stage{position:relative;width:100%;height:100%;border-radius:14px;overflow:hidden;border:2px solid var(--line-2,rgba(255,255,255,.22));background:#10131c;outline:none}
.pz-hs__stage:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-hs__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);text-align:center;padding:16px}
.pz-hs__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-hs__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz-hs__spot{position:absolute;left:8px;right:8px;bottom:8px;z-index:3;padding:8px 10px;border-radius:10px;background:rgba(220,50,70,.92);color:#fff;font-size:13px;font-weight:650;text-align:center}
`;
const DKEY = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', W: 'N', s: 'S', S: 'S', a: 'W', A: 'W', d: 'E', D: 'E' };

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
    let P = null, def = null, hist = [], S = null, done = false, caught = false, ended = false, msg = '';
    let anim = 0, prev = null, raf = 0;

    /* ---------- chrome ---------- */
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level' }, icon('chevron-right'));
    const levelV = h('span', { text: '1' });
    const nameV = h('small', { text: '' });
    const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV, nameV);
    const turnV = h('span', { text: '0' });
    const parV = h('small', { text: '' });
    const turnRead = h('div.pz__read', { title: 'Turns (par: the fewest turns that get out)', 'aria-label': 'Turns' }, icon('clock'), turnV, parV);
    const gemV = h('span', { text: '0/0' });
    const gemRead = h('div.pz__read', { title: 'Gems taken', 'aria-label': 'Gems' }, icon('diamond'), gemV);
    const bestV = h('small', { text: '' });
    const waitBtn = h('button.pz__btn', { type: 'button', title: 'Stay where you are for a turn (Space)' }, icon('clock'), h('span.pz__long', { text: 'Wait' }));
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Take back the last turn (U)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
    const resetBtn = h('button.pz__btn', { type: 'button', title: 'Start this level again (R)' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', prevBtn, levelRead, nextBtn, turnRead, gemRead, bestV);
    const bar = h('div.pz__bar', waitBtn, undoBtn, resetBtn);
    const stage = h('div.pz-hs__stage', { tabindex: '0', role: 'application', 'aria-label': 'Clockwork Heist floor plan' });
    const bw = h('div.pz-hs__bw', stage);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, bar, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Clockwork Heist floor plan', () => draw());

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'red squares are watched after your next move · <kbd>←↑↓→</kbd> step · <kbd>Space</kbd> wait · <kbd>U</kbd> undo · <kbd>R</kbd> restart' }));

    /* ---------- drawing ---------- */
    const geom = () => { const c = Math.floor(Math.min((sf.w - 16) / P.w, (sf.h - 16) / P.h)); return { c, ox: Math.floor((sf.w - c * P.w) / 2), oy: Math.floor((sf.h - c * P.h) / 2) }; };
    const cell = (G, x, y) => [G.ox + (x + 0.5) * G.c, G.oy + (y + 0.5) * G.c];
    const lerp = (a, b, t) => a + (b - a) * t;
    function draw() {
      if (!P || !sf.g) return;
      const g = sf.g, G = geom(), c = G.c;
      sf.begin();
      g.fillStyle = '#0c0f16'; g.fillRect(0, 0, sf.w, sf.h);
      const t = S.t, nowW = watched(P, t), nextW = watched(P, t + 1);
      const gemsLeft = P.gems.filter((_, i) => !(S.gems >> i & 1));
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
        const px = G.ox + x * c, py = G.oy + y * c;
        if (P.wall[y * P.w + x]) {
          g.fillStyle = '#586280'; rr(g, px + 1, py + 1, c - 2, c - 2, c * 0.12); g.fill();
          g.fillStyle = '#3d455e'; rr(g, px + c * 0.12, py + c * 0.12, c * 0.76, c * 0.76, c * 0.08); g.fill();
          g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + c * 0.2, py + c * 0.5); g.lineTo(px + c * 0.8, py + c * 0.5); g.stroke();
        } else {
          g.fillStyle = (x + y) % 2 ? '#1a2030' : '#1e2538'; g.fillRect(px, py, c, c);
        }
      }
      /* sight now (a faint outline) and after your next action (red) */
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
        const i = y * P.w + x, px = G.ox + x * c, py = G.oy + y * c;
        if (nextW.has(i)) {
          g.fillStyle = 'rgba(255,60,70,.38)'; g.fillRect(px, py, c, c);
          g.strokeStyle = 'rgba(255,120,130,.8)'; g.lineWidth = 1; g.beginPath();
          g.moveTo(px + c * 0.15, py + c * 0.15); g.lineTo(px + c * 0.85, py + c * 0.85); g.moveTo(px + c * 0.15, py + c * 0.85); g.lineTo(px + c * 0.85, py + c * 0.15); g.stroke();
        } else if (nowW.has(i)) { g.strokeStyle = 'rgba(255,200,90,.55)'; g.setLineDash([3, 3]); g.strokeRect(px + 2, py + 2, c - 4, c - 4); g.setLineDash([]); }
      }
      /* the patrol rails */
      for (const r of P.robots) if (r.type === 'patrol') {
        g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = Math.max(1.5, c * 0.06); g.setLineDash([c * 0.1, c * 0.12]); g.beginPath();
        r.route.forEach(([x, y], k) => { const [cx, cy] = cell(G, x, y); k ? g.lineTo(cx, cy) : g.moveTo(cx, cy); }); g.closePath(); g.stroke(); g.setLineDash([]);
      }
      /* the exit, and gems */
      {
        const [ex, ey] = cell(G, P.exit[0], P.exit[1]), open = !gemsLeft.length;
        g.strokeStyle = open ? '#8affc1' : '#7a8396'; g.lineWidth = Math.max(2, c * 0.08); rr(g, ex - c * 0.36, ey - c * 0.36, c * 0.72, c * 0.72, c * 0.1); g.stroke();
        g.fillStyle = open ? 'rgba(138,255,193,.25)' : 'rgba(122,131,150,.2)'; g.fill();
        if (!open) { g.fillStyle = '#7a8396'; g.fillRect(ex - c * 0.12, ey - c * 0.02, c * 0.24, c * 0.18); g.strokeStyle = '#7a8396'; g.beginPath(); g.arc(ex, ey - c * 0.04, c * 0.1, Math.PI, 0); g.stroke(); }
        else { g.fillStyle = '#8affc1'; g.font = `800 ${Math.round(c * 0.3)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', ex, ey); }
      }
      P.gems.forEach(([gx, gy], i) => {
        if (S.gems >> i & 1) return;
        const [x, y] = cell(G, gx, gy);
        g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(x, y - c * 0.3); g.lineTo(x + c * 0.24, y); g.lineTo(x, y + c * 0.3); g.lineTo(x - c * 0.24, y); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(x, y - c * 0.3); g.lineTo(x + c * 0.1, y - c * 0.05); g.lineTo(x - c * 0.1, y - c * 0.05); g.closePath(); g.fill();
      });
      /* robots (between turns they slide) */
      const k = anim > 0 && prev ? 1 - anim : 1;
      for (const r of P.robots) {
        const a = robotAt(r, t), b = prev && anim > 0 ? robotAt(r, prev.t) : a;
        const x = lerp(b.x, a.x, k), y = lerp(b.y, a.y, k);
        const [cx, cy] = cell(G, x, y), [dx, dy] = DIRS[a.dir];
        const cam = r.type === 'camera';
        g.fillStyle = cam ? '#7b6bff' : '#ff5b5b';
        if (cam) { rr(g, cx - c * 0.28, cy - c * 0.28, c * 0.56, c * 0.56, c * 0.1); g.fill(); } else { g.beginPath(); g.arc(cx, cy, c * 0.3, 0, 7); g.fill(); }
        g.fillStyle = '#14081a'; g.beginPath(); g.arc(cx + dx * c * 0.1, cy + dy * c * 0.1, c * 0.16, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + dx * c * 0.15, cy + dy * c * 0.15, c * 0.06, 0, 7); g.fill();
        /* the way it faces */
        g.strokeStyle = cam ? '#b9b0ff' : '#ffb3b3'; g.lineWidth = Math.max(2, c * 0.07); g.beginPath(); g.moveTo(cx + dx * c * 0.32, cy + dy * c * 0.32); g.lineTo(cx + dx * c * 0.46, cy + dy * c * 0.46); g.stroke();
        if (cam) {
          /* turns until it turns: a dot for each */
          const left = r.every - (((t % r.period) + r.period) % r.period) % r.every;
          g.fillStyle = '#fff';
          for (let d = 0; d < r.every; d++) { g.globalAlpha = d < left ? 1 : 0.25; g.beginPath(); g.arc(cx - (r.every - 1) * c * 0.06 + d * c * 0.12, cy + c * 0.4, c * 0.035, 0, 7); g.fill(); }
          g.globalAlpha = 1;
        }
      }
      /* the thief */
      {
        const a = S, b = prev && anim > 0 ? prev : S;
        const x = lerp(b.x, a.x, k), y = lerp(b.y, a.y, k), [cx, cy] = cell(G, x, y);
        g.fillStyle = caught ? '#ff4d5e' : '#3ad6c4';
        g.beginPath(); g.arc(cx, cy + c * 0.1, c * 0.24, 0, 7); g.fill();
        g.fillStyle = '#0d2a27'; g.beginPath(); g.arc(cx, cy - c * 0.14, c * 0.2, Math.PI, 0); g.fill(); g.fillRect(cx - c * 0.2, cy - c * 0.14, c * 0.4, c * 0.07);
        g.fillStyle = caught ? '#ffd6dc' : '#a8f5ea'; g.beginPath(); g.arc(cx, cy - c * 0.1, c * 0.14, 0, Math.PI); g.fill();
      }
    }
    function tick() {
      raf = 0;
      if (dead) return;
      anim = Math.max(0, anim - 0.12);
      draw();
      if (anim > 0) raf = requestAnimationFrame(tick);
    }

    /* ---------- play ---------- */
    function paint() {
      levelV.textContent = `${level}/${LEVELS.length}`;
      nameV.textContent = def.name;
      turnV.textContent = String(S.t);
      parV.textContent = `par ${def.par}`;
      gemV.textContent = `${popcount(S.gems)}/${P.gems.length}`;
      bestV.textContent = bests[level] != null ? `Best: ${bests[level]} turns${bests[level] <= def.par ? ' ★' : ''}` : '';
      prevBtn.disabled = level <= 1; nextBtn.disabled = level >= LEVELS.length;
      undoBtn.disabled = !hist.length;
      waitBtn.disabled = done || caught;
      stage.querySelector('.pz-hs__spot')?.remove();
      if (caught) stage.appendChild(h('div.pz-hs__spot', { text: 'Spotted! Undo the last turn or restart the level.' }));
      draw();
    }
    const popcount = n => { let k = 0; while (n) { n &= n - 1; k++; } return k; };
    function open(lv) {
      level = Math.max(1, Math.min(LEVELS.length, lv));
      def = LEVELS[level - 1];
      P = parse(def);
      S = startState(P); hist = []; done = false; caught = false; ended = false; paused = false; msg = ''; prev = null; anim = 0;
      bw.querySelector('.pz__cover')?.remove(); stage.querySelector('.pz-hs__card')?.remove();
      save(GAME, { level });
      onScore(0);
      paint();
      say(`${def.name}: ${P.gems.length ? `take ${P.gems.length === 1 ? 'the gem' : `all ${P.gems.length} gems`}, then ` : ''}reach the exit. Par is ${def.par} turns.`);
    }
    const can = () => !dead && !paused && !done && !caught && !!P;
    function act(a) {
      if (!can()) return false;
      const r = step(P, S, a);
      if (!r) return false;
      hist.push({ S, caught });
      prev = S; S = { x: r.x, y: r.y, t: r.t, gems: r.gems };
      anim = reduced ? 0 : 1;
      onScore(S.t);
      if (r.caught) { caught = true; paint(); say('A robot saw you. Undo the last turn or restart.'); }
      else if (r.won) { win(); }
      else { paint(); say(a === '.' ? 'You wait a turn.' : r.gems > (hist[hist.length - 1].S.gems) ? 'You take the gem.' : `Turn ${S.t}.`); }
      if (anim > 0 && !raf) raf = requestAnimationFrame(tick);
      return true;
    }
    function win() {
      done = true;
      const turns = S.t, inPar = turns <= def.par, prevB = bests[level], fresh = prevB == null || turns < prevB;
      if (fresh) { bests[level] = turns; save(GAME, { best: bests }); }
      if (level < LEVELS.length) save(GAME, { level: level + 1 });
      paint();
      const line = inPar ? `In par: ${def.par} turns is the fewest there are.` : `Par is ${def.par}: ${turns - def.par} more than the fewest.`;
      stage.appendChild(h('div.pz-hs__card', h('div', h('b', { text: inPar ? 'Clean getaway, in par!' : 'Clean getaway!' }),
        h('span', { text: `${def.name} in ${turns} turns${fresh && prevB != null ? ' — a new best' : ''}. ${line}${level < LEVELS.length ? ` Play again for level ${level + 1}.` : ' That was the last level.'}` }))));
      say(`Out in ${turns} turns. ${line}`);
      onScore(turns);
      if (!ended) { ended = true; onEnd({ score: turns, won: true, detail: `Level ${level} · ${def.name} · par ${def.par}${inPar ? ' (in par)' : ''}` }); }
    }
    function undo() {
      if (dead || paused || !hist.length || done) return;
      const h0 = hist.pop();
      S = h0.S; caught = false; anim = 0; prev = null;
      onScore(S.t);
      paint(); say('Turn taken back.');
    }
    const restart = () => { if (!dead) open(level); };

    /* ---------- input ---------- */
    L.on(stage, 'pointerdown', e => {
      if (e.button > 0 || !can()) return;
      const b = sf.cv.getBoundingClientRect(), G = geom();
      const x = Math.floor((e.clientX - b.left - G.ox) / G.c), y = Math.floor((e.clientY - b.top - G.oy) / G.c);
      stage.focus({ preventScroll: true });
      if (x < 0 || y < 0 || x >= P.w || y >= P.h) return;
      const dx = x - S.x, dy = y - S.y;
      if (!dx && !dy) act('.');
      else if (Math.abs(dx) + Math.abs(dy) === 1) act(dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N');
    });
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    L.on(window, 'keydown', e => {
      if (dead || !P || !ownsKey(root, e)) return;
      const k = e.key;
      if (DKEY[k]) { e.preventDefault(); unfocus(); act(DKEY[k]); }
      else if (k === ' ' || k === '.' || k === 'x' || k === 'X') { if (!can()) return; e.preventDefault(); unfocus(); if (!e.repeat) act('.'); }
      else if (k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
      else if (k === 'r' || k === 'R') { e.preventDefault(); restart(); }
    });
    L.on(prevBtn, 'click', () => { if (level > 1) open(level - 1); });
    L.on(nextBtn, 'click', () => { if (level < LEVELS.length) open(level + 1); });
    L.on(waitBtn, 'click', () => act('.'));
    L.on(undoBtn, 'click', undo);
    L.on(resetBtn, 'click', restart);

    open(level);
    requestAnimationFrame(() => { if (!dead) stage.focus({ preventScroll: true }); });

    return {
      stop() { if (dead) return; dead = true; cancelAnimationFrame(raf); L.clear(); sf.destroy(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); },
      peek: () => P && ({
        level, name: def.name, par: def.par, turn: S.t, x: S.x, y: S.y, gems: popcount(S.gems), gemsTotal: P.gems.length, caught, done, paused,
        period: P.period, w: P.w, h: P.h, best: { ...bests },
        watchedNext: [...watched(P, S.t + 1)], watchedNow: [...watched(P, S.t)],
        robots: P.robots.map(r => ({ type: r.type, ...robotAt(r, S.t) })), undo: hist.length,
        geo: (() => { const G = geom(), b = sf.cv.getBoundingClientRect(); return { left: b.left, top: b.top, ox: G.ox, oy: G.oy, c: G.c }; })(),
      }),
      /* test hook — nothing in the game calls it: level(n) */
      hook(cmd, a) { if (cmd === 'level') open(a); return true; },
    };
  },
};
