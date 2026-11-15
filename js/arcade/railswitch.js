/* ============================================================
   arcade/railswitch.js — Rail Switch for Static Arcade.

   Coloured trains leave the depot one at a time and roll through
   junctions to a station. Every junction sits on one of its two
   ways out; flip it (a click) before a train leaves so the train
   reaches a station of its own colour — a train in the wrong
   station is a crash. Some junctions are AUTOMATIC (a ↻ ring): you
   can't flip them, they swap by themselves after each train that
   passes. Settings stay as they are from one train to the next.
   Twelve layouts; every one is solvable and its par — the fewest
   flips that deliver every train — is worked out exactly
   (railswitch-logic.js; the test suite solves all twelve).

   Controls
     click / tap    a junction flips it · Send train (or Enter) sends
                    the next train
     keyboard       ← → pick a junction · Space flips it · Enter
                    sends the train · R starts the layout again ·
                    N / P next / previous layout
   Score = flips used, lower is better. Every train carries a letter
   (A, B, C) as well as its colour, and so does its station; the
   Arcade's colour-blind colours change the three colours.
   The layout you were on and the ones you have cleared (with the
   fewest flips) are kept on this device
   (portal.arcadePuzzles.railswitch).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import { NG_CSS, blurMouse, levelGrid, resultCard, cardButton } from './ng1kit.js';
import { PALETTE_CB } from './index.js';
import { LEVELS, makeLevel, junctionsOf, route, solve } from './railswitch-logic.js';

const GAME = 'railswitch';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ff4d6d', '#3b9cff', '#ffd23f'];
const CB = [PALETTE_CB[5], PALETTE_CB[1], PALETTE_CB[3]];
const LETTER = ['A', 'B', 'C'];
const SEG_MS = 380;
const CSS = `${BASE}${NG_CSS}
.ng__board{width:100%;height:100%;max-width:980px}
.rs__q{width:min(100%,760px);display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;flex:0 0 auto;min-height:34px}
.rs__q b{font:600 11px/1 var(--font,system-ui);color:var(--ink-3,#999);margin-right:4px;text-transform:uppercase;letter-spacing:.4px}
.rs__t{width:30px;height:26px;border-radius:7px;display:grid;place-items:center;font:800 13px/1 var(--font,system-ui);color:#10131c;border:2px solid transparent}
.rs__t.is-now{border-color:#fff;box-shadow:0 0 0 2px color-mix(in srgb,var(--ga) 50%,transparent)}
.rs__t.is-done{opacity:.35}
[data-junction]{cursor:pointer}
[data-junction]:focus-visible{outline:none}
`;
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false, raf = 0;
    const sv = load(GAME);
    const cleared = {}, fewest = {};
    for (const [k, v] of Object.entries(sv.cleared || {})) if (Number.isInteger(v) && v >= 0) cleared[k] = 1;
    for (const [k, v] of Object.entries(sv.fewest || {})) if (Number.isInteger(v) && v >= 0) fewest[k] = v;
    let index = Math.max(0, Math.min(LEVELS - 1, Number(sv.cur) || 0));
    let level = null, js = [], pos = {}, mask = 0, t = 0, moves = 0, status = 'idle', sel = 0, msg = '', anim = null, crashed = null, view = null;

    const movesV = h('span', { text: '0' });
    const movesRead = h('div.pz__read', { title: 'Flips (par: the fewest possible)', 'aria-label': 'Flips' }, icon('shuffle'), movesV, h('small', { text: '' }));
    const levelV = h('span', { text: '' });
    const levelRead = h('div.pz__read', { title: 'Layout', 'aria-label': 'Layout' }, icon('layers'), levelV);
    const bestV = h('small', { text: '' });
    const levelsBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'levels' }, title: 'All twelve layouts' }, icon('grid-9'), h('span.pz__long', { text: 'Layouts' }));
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous layout (P)', 'aria-label': 'Previous layout' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next layout (N)', 'aria-label': 'Next layout' }, icon('chevron-right'));
    const sendBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'send' }, title: 'Send the next train (Enter)' }, icon('play'), h('span', { text: 'Send train' }));
    const resetBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'restart' }, title: 'Start this layout again (R)' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', levelsBtn, prevBtn, levelRead, nextBtn, movesRead, bestV, sendBtn, resetBtn);
    const queue = h('div.rs__q', { role: 'list', 'aria-label': 'Trains waiting' });
    const svg = svgEl('svg', { class: 'ng__board', role: 'application', tabindex: '0', 'aria-label': 'Rail Switch layout', preserveAspectRatio: 'xMidYMid meet' });
    const bw = h('div.ng__bw', svg);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, queue, bw, foot, live);
    el.appendChild(root);

    const cb = () => ctx.palette === 'cb';
    const colorOf = c => (cb() ? CB : COLORS)[c];
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'flip a junction before a train leaves · ↻ junctions flip themselves · <kbd>←</kbd><kbd>→</kbd> pick · <kbd>Space</kbd> flips · <kbd>Enter</kbd> sends' }));

    /* the picture: node positions in board units */
    function layoutPositions() {
      pos = { depot: [0, 0] };
      for (const n of level.nodes) pos[n.id] = [(n.layer + 1) * 2, (n.row - n.layer / 2) * 1.5];
      const xs = Object.values(pos).map(p => p[0]), ys = Object.values(pos).map(p => p[1]);
      view = { x: Math.min(...xs) - 1.2, y: Math.min(...ys) - 1.2, w: Math.max(...xs) - Math.min(...xs) + 2.4, h: Math.max(...ys) - Math.min(...ys) + 2.4 };
    }
    const curve = (a, b) => { const mx = (a[0] + b[0]) / 2; return `M${a[0]},${a[1]} C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`; };
    const manual = () => js.map((n, k) => ({ n, k })).filter(o => !o.n.auto);

    function paint() {
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
      svg.replaceChildren();
      /* the tracks: the way each junction is set is bright, the other dim */
      const track = (a, b, on) => {
        svg.appendChild(svgEl('path', { d: curve(a, b), fill: 'none', stroke: on ? '#aab4d6' : '#2b3150', 'stroke-width': on ? 0.2 : 0.14, 'stroke-linecap': 'round' }));
        if (on) svg.appendChild(svgEl('path', { d: curve(a, b), fill: 'none', stroke: '#0d0f16', 'stroke-width': 0.06, 'stroke-dasharray': '0.12 0.16' }));
      };
      track(pos.depot, pos[level.first], true);
      js.forEach((n, k) => n.outs.forEach((o, w) => { if (((mask >> k) & 1) !== w) track(pos[n.id], pos[o], false); }));
      js.forEach((n, k) => { const w = (mask >> k) & 1; track(pos[n.id], pos[n.outs[w]], true); });
      /* the depot and the stations */
      svg.appendChild(svgEl('rect', { x: pos.depot[0] - 0.55, y: pos.depot[1] - 0.45, width: 1.1, height: 0.9, rx: 0.14, fill: '#232a45', stroke: '#566087', 'stroke-width': 0.05 }));
      const dt = svgEl('text', { x: pos.depot[0], y: pos.depot[1] + 0.08, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.3, 'font-weight': 700, fill: '#c5cce6', 'font-family': 'Inter,system-ui,sans-serif' });
      dt.textContent = 'depot';
      svg.appendChild(dt);
      for (const n of level.nodes) {
        if (n.kind !== 'station') continue;
        const [x, y] = pos[n.id];
        svg.appendChild(svgEl('rect', { x: x - 0.45, y: y - 0.4, width: 0.9, height: 0.8, rx: 0.16, fill: colorOf(n.color), stroke: '#0d0f16', 'stroke-width': 0.05, 'data-station': n.id, 'data-color': n.color }));
        const s = svgEl('text', { x, y: y + 0.03, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.5, 'font-weight': 800, fill: '#10131c', 'font-family': 'Inter,system-ui,sans-serif', 'pointer-events': 'none' });
        s.textContent = LETTER[n.color];
        svg.appendChild(s);
      }
      /* the junctions */
      js.forEach((n, k) => {
        const [x, y] = pos[n.id], man = !n.auto;
        const g = svgEl('g', { 'data-junction': k, 'data-auto': n.auto ? '1' : '0', 'data-way': (mask >> k) & 1, role: man ? 'button' : 'img', 'aria-label': `Junction ${k + 1}${n.auto ? ', automatic' : ''}, set to way ${((mask >> k) & 1) + 1}` });
        if (man && sel === manual().findIndex(o => o.k === k)) g.appendChild(svgEl('circle', { cx: x, cy: y, r: 0.5, fill: 'none', stroke: '#fff', 'stroke-width': 0.06, 'stroke-dasharray': '0.14 0.1' }));
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 0.32, fill: n.auto ? '#3a3320' : '#2a3358', stroke: n.auto ? '#ffd23f' : '#8ea0e0', 'stroke-width': 0.07, ...(n.auto ? { 'stroke-dasharray': '0.16 0.1' } : {}) }));
        const to = pos[n.outs[(mask >> k) & 1]], dx = to[0] - x, dy = to[1] - y, len = Math.hypot(dx, dy) || 1;
        g.appendChild(svgEl('line', { x1: x, y1: y, x2: x + (dx / len) * 0.26, y2: y + (dy / len) * 0.26, stroke: '#fff', 'stroke-width': 0.12, 'stroke-linecap': 'round' }));
        if (n.auto) { const r = svgEl('text', { x, y: y - 0.45, 'text-anchor': 'middle', 'font-size': 0.34, fill: '#ffd23f', 'pointer-events': 'none' }); r.textContent = '↻'; g.appendChild(r); }
        if (man) g.addEventListener('pointerdown', e => { e.preventDefault(); sel = manual().findIndex(o => o.k === k); flip(k); });
        svg.appendChild(g);
      });
      /* a train (waiting at the depot, or on the move) */
      if (t < level.trains.length && status !== 'won') {
        const p = anim ? anim.at : pos.depot;
        const col = level.trains[t];
        const g = svgEl('g', { 'data-train': t, 'data-color': col });
        g.appendChild(svgEl('rect', { x: p[0] - 0.3, y: p[1] - 0.2, width: 0.6, height: 0.4, rx: 0.1, fill: colorOf(col), stroke: '#fff', 'stroke-width': 0.05 }));
        const s = svgEl('text', { x: p[0], y: p[1] + 0.02, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.3, 'font-weight': 800, fill: '#10131c', 'font-family': 'Inter,system-ui,sans-serif' });
        s.textContent = LETTER[col];
        g.appendChild(s);
        svg.appendChild(g);
      }
      queue.replaceChildren(h('b', { text: 'Trains' }), ...level.trains.map((c, i) => h('span.rs__t' + (i === t ? '.is-now' : '') + (i < t ? '.is-done' : ''), { role: 'listitem', 'aria-label': `${LETTER[c]}${i < t ? ', delivered' : i === t ? ', next' : ''}`, style: { background: colorOf(c) }, text: i < t ? '✓' : LETTER[c] })));
      const key = String(index);
      movesV.textContent = String(moves);
      movesRead.lastChild.textContent = `par ${level.par}`;
      movesRead.classList.toggle('is-over', moves > level.par);
      levelV.textContent = `${index + 1}/${LEVELS}`;
      bestV.textContent = cleared[key] ? `Best: ${fewest[key]} flips${fewest[key] <= level.par ? ' ★' : ''}` : '';
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= LEVELS - 1;
      sendBtn.disabled = status !== 'idle';
      svg.setAttribute('aria-label', `Rail Switch layout ${index + 1}. ${t} of ${level.trains.length} trains delivered. Next train: ${t < level.trains.length ? LETTER[level.trains[t]] : 'none'}.`);
    }

    /* ------------------------------ the game ------------------------------ */
    const clearOverlays = () => { for (const s of ['.pz__cover', '.ng__card', '.ng__levels']) bw.querySelector(s)?.remove(); };
    function persist() { save(GAME, { cur: index, cleared: { ...cleared }, fewest: { ...fewest } }); }
    function start(i) {
      cancelAnimationFrame(raf); anim = null;
      index = Math.max(0, Math.min(LEVELS - 1, i));
      level = makeLevel(index); js = junctionsOf(level); layoutPositions();
      mask = level.init; t = 0; moves = 0; status = 'idle'; sel = 0; crashed = null; paused = false; msg = '';
      clearOverlays(); persist(); paint();
      say(`Layout ${index + 1}: ${level.trains.length} trains, ${js.length} junctions${js.some(n => n.auto) ? ` (${js.filter(n => n.auto).length} automatic)` : ''}. Par is ${level.par} flips.`);
      onScore(0);
    }
    function flip(k) {
      if (dead || paused || status !== 'idle') return false;
      if (js[k].auto) { snd.blip(150, 0.06, 'sawtooth', 0.4); return false; }
      mask ^= 1 << k; moves++;
      snd.wake(); snd.blip(300, 0.05, 'square', 0.5);
      paint(); onScore(moves);
      return true;
    }
    function send() {
      if (dead || paused || status !== 'idle' || t >= level.trains.length) return;
      const r = route(level, mask);
      const pts = r.path.map(id => pos[id]);
      pts.unshift(pos.depot);
      status = 'running'; snd.wake();
      anim = { pts, r, start: performance.now(), pausedAt: 0, at: pos.depot, total: (pts.length - 1) * SEG_MS };
      say('Train away…');
      if (reduced) { arrive(); return; }
      paint();
      raf = requestAnimationFrame(frame);
    }
    const along = (pts, f) => {
      f = Math.max(0, f);   /* a frame's timestamp can come from just before the train left */
      const seg = Math.min(pts.length - 2, Math.floor(f)), u = Math.min(1, f - seg), a = pts[seg], b = pts[seg + 1];
      /* follow the curve's own shape: an S between the two points */
      const s = u * u * (3 - 2 * u);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * s];
    };
    function frame(now) {
      if (dead || paused || !anim) return;
      const el_ = Math.max(0, now - anim.start);
      if (el_ >= anim.total) { arrive(); return; }
      anim.at = along(anim.pts, el_ / SEG_MS);
      paint();
      raf = requestAnimationFrame(frame);
    }
    function arrive() {
      cancelAnimationFrame(raf);
      const r = anim.r, st = level.nodes[r.station];
      anim = null;
      if (st.color !== level.trains[t]) {
        status = 'crashed'; crashed = { train: level.trains[t], station: st.color };
        paint();
        bw.appendChild(resultCard('Crash!', `The ${LETTER[level.trains[t]]} train went into the ${LETTER[st.color]} station. Flip the junctions the other way and try again.`, cardButton('Try again', () => start(index), 'refresh')));
        say(`Crash: the ${LETTER[level.trains[t]]} train reached the ${LETTER[st.color]} station.`);
        snd.blip(120, 0.25, 'sawtooth', 0.7, 60);
        return;
      }
      mask ^= r.flips;
      t++; status = 'idle';
      snd.blip(520, 0.08, 'triangle', 0.7);
      if (t >= level.trains.length) { finish(); return; }
      paint();
      say(`Delivered. ${level.trains.length - t} train${level.trains.length - t === 1 ? '' : 's'} to go.${r.flips ? ' The automatic junctions it passed have flipped.' : ''}`);
    }
    function finish() {
      status = 'won';
      const par = level.par, perfect = moves <= par, key = String(index), solvedAt = index;
      cleared[key] = 1;
      if (fewest[key] === undefined || moves < fewest[key]) fewest[key] = moves;
      if (index < LEVELS - 1) index++;
      persist(); paint();
      const line = perfect ? `Perfect: ${moves} flip${moves === 1 ? '' : 's'}, par ${par}.` : `${moves} flips; par is ${par}.`;
      const next = solvedAt < LEVELS - 1 ? cardButton('Next layout', () => start(index), 'chevron-right') : cardButton('Play layout 12 again', () => start(solvedAt), 'refresh');
      bw.appendChild(resultCard(perfect ? 'All delivered, in par!' : 'All delivered!', `Layout ${solvedAt + 1}. ${line}`, next));
      say(`Layout ${solvedAt + 1} done. ${line}`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(784, 0.16, 'triangle', 0.8), 120);
      /* a score of 0 flips (a level won with nothing flipped) still counts as 1 so a best is never empty */
      onScore(moves);
      onEnd({ score: Math.max(1, moves), won: true, detail: `Layout ${solvedAt + 1} · ${moves} flips, par ${par}${perfect ? ' (perfect)' : ''}` });
    }

    function showLevels() {
      const open = bw.querySelector('.ng__levels');
      if (open) { open.remove(); return; }
      const n = Object.keys(cleared).length, p = Object.keys(cleared).filter(k => fewest[k] <= makeLevel(+k).par).length;
      bw.appendChild(h('div.ng__levels', { role: 'dialog', 'aria-label': 'Layouts' },
        h('h4', { text: 'Rail Switch · 12 layouts' }), h('p', { text: `${n} of ${LEVELS} cleared · ${p} in par` }),
        levelGrid(LEVELS, index, i => {
          const k = String(i), par = makeLevel(i).par, inPar = cleared[k] && fewest[k] <= par;
          return { done: !!cleared[k], star: inPar, note: inPar ? '★ par' : cleared[k] ? '✓' : `par ${par}`, title: `Layout ${i + 1}: par ${par}${cleared[k] ? `, best ${fewest[k]} flips` : ''}` };
        }, i => { if (!dead) start(i); }, 'Layouts')));
      bw.querySelector('.ng__lv button.is-cur')?.focus({ preventScroll: true });
    }

    /* ------------------------------ input ------------------------------ */
    L.on(window, 'keydown', e => {
      if (dead || paused || !ownsKey(root, e)) return;
      const k = e.key, m = manual();
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        if (m.length) { sel = (sel + (k === 'ArrowLeft' ? m.length - 1 : 1)) % m.length; paint(); }
      } else if (k === ' ') { e.preventDefault(); if (!e.repeat && m[sel]) flip(m[sel].k); }
      else if (k === 'Enter') { if (document.activeElement?.tagName === 'BUTTON' && root.contains(document.activeElement)) return; e.preventDefault(); send(); }
      else if (k === 'r' || k === 'R') { e.preventDefault(); start(index); }
      else if (k === 'n' || k === 'N') { e.preventDefault(); if (index < LEVELS - 1) start(index + 1); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); if (index > 0) start(index - 1); }
    });
    L.on(root, 'click', blurMouse);
    L.on(sendBtn, 'click', () => send());
    L.on(resetBtn, 'click', () => { if (!dead) start(index); });
    L.on(levelsBtn, 'click', () => { if (!dead) showLevels(); });
    L.on(prevBtn, 'click', () => { if (!dead && index > 0) start(index - 1); });
    L.on(nextBtn, 'click', () => { if (!dead && index < LEVELS - 1) start(index + 1); });

    start(index);

    return {
      stop() { if (dead) return; dead = true; cancelAnimationFrame(raf); L.clear(); snd.close(); persist(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; cancelAnimationFrame(raf); if (anim) anim.pausedAt = performance.now(); if (status !== 'won') bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() {
        if (dead || !paused) return;
        paused = false; bw.querySelector('.pz__cover')?.remove();
        if (anim) { anim.start += performance.now() - anim.pausedAt; raf = requestAnimationFrame(frame); }
      },
      peek: () => ({
        index, level: index + 1, levels: LEVELS, par: level.par, moves, mask, init: level.init, trains: level.trains.slice(), t, status, selected: sel, paused,
        junctions: js.map((n, k) => ({ k, auto: !!n.auto, way: (mask >> k) & 1 })), stations: level.nodes.filter(n => n.kind === 'station').map(n => n.color),
        crashed, cleared: { ...cleared }, fewest: { ...fewest }, palette: cb() ? 'cb' : 'standard', message: msg,
      }),
      /* test hook — nothing in the game calls it: level(i), plan() -> the masks that solve this layout, one before each train */
      hook(cmd, a) {
        if (cmd === 'level') { start(a); return true; }
        if (cmd === 'plan') return solve(level)?.plan || null;
        return false;
      },
    };
  },
};
