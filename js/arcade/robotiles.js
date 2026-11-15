/* ============================================================
   arcade/robotiles.js — Robo Tiles for Static Arcade.

   Write a program of up to five commands and press Run: the robot
   carries it out once, from where it starts, and has to be on the
   green goal. Forward moves one tile, Left and Right turn on the
   spot, Dash slides until something stops it. Walls stop the robot,
   pits end the run, and a conveyor carries it one more tile the way
   its arrow points. 24 mazes; every one is solvable and its par —
   the fewest commands that win — is worked out by trying every
   program (robotiles-logic.js; the test suite does it for all 24).

   Controls
     click / tap    a command button adds it · a command in the
                    program takes it back out
     keyboard       F L R D add Forward / Left / Right / Dash ·
                    Backspace removes the last one · Delete clears
                    the program · Enter runs it · N / P next /
                    previous level
   Score = commands used in the winning program, lower is better
   (par is the fewest possible). The level you were on, the levels
   you have cleared and the fewest commands on each are kept on this
   device (portal.arcadePuzzles.robotiles).
   With "Fewer flashes" or reduced motion the robot jumps to where
   the program ends instead of walking there.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import { NG_CSS, blurMouse, levelGrid, resultCard, cardButton } from './ng1kit.js';
import { LEVELS, MAX_STEPS, CMDS, CMD_NAME, makeLevel, run, solve, isConveyor } from './robotiles-logic.js';

const GAME = 'robotiles';
const NS = 'http://www.w3.org/2000/svg';
const GLYPH = { F: '↑', L: '↶', R: '↷', D: '⇑' };
const KEYS = { f: 'F', l: 'L', r: 'R', d: 'D' };
const STEP_MS = 260;
const CSS = `${BASE}${NG_CSS}
.ng__board{width:min(100cqw,100cqh);height:min(100cqw,100cqh)}
.rt__prog{width:min(100%,560px);display:flex;gap:8px;justify-content:center;flex:0 0 auto}
.rt__slot{width:56px;height:56px;border-radius:11px;border:2px dashed var(--line-2,rgba(255,255,255,.22));background:var(--fill-0,rgba(255,255,255,.03));color:var(--ink-0,#fff);font:800 24px/1 var(--font,system-ui);display:grid;place-items:center;cursor:pointer;padding:0;position:relative}
.rt__slot.is-full{border-style:solid;background:var(--fill-2,rgba(255,255,255,.1))}
.rt__slot.is-now{border-color:var(--ga);box-shadow:0 0 0 2px color-mix(in srgb,var(--ga) 45%,transparent)}
.rt__slot small{position:absolute;left:5px;top:3px;font:600 10px/1 var(--font,system-ui);color:var(--ink-3,#999)}
.rt__slot:focus-visible{outline:2px solid var(--ga)}
.rt__cmds{width:min(100%,560px);display:flex;gap:8px;justify-content:center;flex:0 0 auto;flex-wrap:wrap}
.rt__cmds .pz__btn{min-width:98px;font-size:13px}
.rt__cmds .pz__btn b{font-size:17px;line-height:1}
.rt__key{font:600 10px/1 var(--mono,ui-monospace,monospace);opacity:.65}
`;
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const ROT = [0, 90, 180, 270];

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false, timer = 0;
    const sv = load(GAME);
    const cleared = {}, fewest = {};
    for (const [k, v] of Object.entries(sv.cleared || {})) if (Number.isInteger(v) && v > 0) cleared[k] = v;
    for (const [k, v] of Object.entries(sv.fewest || {})) if (Number.isInteger(v) && v > 0) fewest[k] = v;
    let index = Math.max(0, Math.min(LEVELS - 1, Number(sv.cur) || 0));
    let level = null, program = [], robot = null, running = false, frames = [], fi = 0, result = null, done = false, msg = '', runs = 0, shown = -1;

    const stepsV = h('span', { text: '0' });
    const stepsRead = h('div.pz__read', { title: 'Commands in the program (par: the fewest that win)', 'aria-label': 'Commands' }, icon('activity'), stepsV, h('small', { text: '' }));
    const levelV = h('span', { text: '' });
    const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV);
    const bestV = h('small', { text: '' });
    const levelsBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'levels' }, title: 'All 24 levels' }, icon('grid-9'), h('span.pz__long', { text: 'Levels' }));
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level (P)', 'aria-label': 'Previous level' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level (N)', 'aria-label': 'Next level' }, icon('chevron-right'));
    const runBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'run' }, title: 'Run the program (Enter)' }, icon('play'), h('span', { text: 'Run' }));
    const clearBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'clear' }, title: 'Clear the program (Delete)' }, icon('trash'), h('span.pz__long', { text: 'Clear' }));
    const top = h('div.pz__top', levelsBtn, prevBtn, levelRead, nextBtn, stepsRead, bestV, runBtn, clearBtn);
    const svg = svgEl('svg', { class: 'ng__board', tabindex: '0', role: 'img', 'aria-label': 'Robo Tiles maze', preserveAspectRatio: 'xMidYMid meet' });
    const bw = h('div.ng__bw', svg);
    const slots = Array.from({ length: MAX_STEPS }, (_, i) => h('button.rt__slot', { type: 'button', dataset: { slot: i }, 'aria-label': `Step ${i + 1}: empty`, onclick: () => removeAt(i) }, h('small', { text: String(i + 1) }), h('span', { text: '' })));
    const progEl = h('div.rt__prog', { role: 'group', 'aria-label': 'Program' }, ...slots);
    const cmdBtns = CMDS.map(c => h('button.pz__btn', { type: 'button', dataset: { cmd: c }, title: `${CMD_NAME[c]} (${c})`, onclick: () => add(c) }, h('b', { text: GLYPH[c] }), h('span', { text: CMD_NAME[c] }), h('span.rt__key', { text: c })));
    const cmdEl = h('div.rt__cmds', { role: 'group', 'aria-label': 'Commands' }, ...cmdBtns);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, bw, progEl, cmdEl, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'goal = green · walls stop you · pits end the run · conveyors push one tile · <kbd>F</kbd><kbd>L</kbd><kbd>R</kbd><kbd>D</kbd> add · <kbd>Enter</kbd> runs' }));

    /* ------------------------------ drawing ------------------------------ */
    function paint() {
      const { w, h: hh } = level;
      svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
      svg.replaceChildren();
      for (let i = 0; i < w * hh; i++) {
        const x = i % w, y = (i / w) | 0, c = level.cells[i], cx = x + 0.5, cy = y + 0.5;
        if (c === '#') { svg.appendChild(svgEl('rect', { x: x + 0.03, y: y + 0.03, width: 0.94, height: 0.94, rx: 0.1, fill: '#3a3f55', stroke: '#565c78', 'stroke-width': 0.04 })); continue; }
        svg.appendChild(svgEl('rect', { x: x + 0.03, y: y + 0.03, width: 0.94, height: 0.94, rx: 0.1, fill: '#171a26' }));
        if (c === 'O') {
          svg.appendChild(svgEl('circle', { cx, cy, r: 0.36, fill: '#05060a', stroke: '#e0525e', 'stroke-width': 0.06, 'stroke-dasharray': '0.14 0.1' }));
        } else if (c === 'G') {
          svg.appendChild(svgEl('circle', { cx, cy, r: 0.34, fill: 'none', stroke: '#2fd36b', 'stroke-width': 0.08 }));
          svg.appendChild(svgEl('circle', { cx, cy, r: 0.16, fill: '#2fd36b' }));
        } else if (isConveyor(c)) {
          const d = '^>v<'.indexOf(c);
          const g = svgEl('g', { transform: `rotate(${ROT[d]} ${cx} ${cy})` });
          g.appendChild(svgEl('polygon', { points: `${cx},${cy - 0.3} ${cx + 0.26},${cy + 0.05} ${cx + 0.1},${cy + 0.05} ${cx + 0.1},${cy + 0.3} ${cx - 0.1},${cy + 0.3} ${cx - 0.1},${cy + 0.05} ${cx - 0.26},${cy + 0.05}`, fill: '#ffd23f', 'fill-opacity': 0.8 }));
          svg.appendChild(g);
        }
      }
      /* where it started */
      svg.appendChild(svgEl('circle', { cx: (level.start % w) + 0.5, cy: ((level.start / w) | 0) + 0.5, r: 0.42, fill: 'none', stroke: 'rgba(120,220,255,.35)', 'stroke-width': 0.04, 'stroke-dasharray': '0.1 0.1' }));
      const r = robot, rx = r.x + 0.5, ry = r.y + 0.5, fell = r.ev === 'fall';
      const g = svgEl('g', { transform: `rotate(${ROT[r.dir]} ${rx} ${ry})`, 'data-robot': '1', opacity: fell ? 0.35 : 1 });
      g.appendChild(svgEl('rect', { x: rx - 0.28, y: ry - 0.28, width: 0.56, height: 0.56, rx: 0.12, fill: '#43c9e8', stroke: '#0d0f16', 'stroke-width': 0.05 }));
      g.appendChild(svgEl('polygon', { points: `${rx},${ry - 0.4} ${rx + 0.14},${ry - 0.22} ${rx - 0.14},${ry - 0.22}`, fill: '#fff' }));
      g.appendChild(svgEl('circle', { cx: rx - 0.1, cy: ry + 0.02, r: 0.05, fill: '#06161c' }));
      g.appendChild(svgEl('circle', { cx: rx + 0.1, cy: ry + 0.02, r: 0.05, fill: '#06161c' }));
      svg.appendChild(g);
      svg.setAttribute('aria-label', `Robo Tiles maze ${w} by ${hh}. The robot is at column ${r.x + 1}, row ${r.y + 1}, facing ${['up', 'right', 'down', 'left'][r.dir]}.`);
      slots.forEach((b, i) => {
        const c = program[i];
        b.classList.toggle('is-full', !!c);
        b.classList.toggle('is-now', running && shown === i);
        b.lastChild.textContent = c ? GLYPH[c] : '';
        b.setAttribute('aria-label', c ? `Step ${i + 1}: ${CMD_NAME[c]}. Press to remove.` : `Step ${i + 1}: empty`);
      });
      const key = String(index);
      stepsV.textContent = String(program.length);
      stepsRead.lastChild.textContent = `par ${level.par}`;
      stepsRead.classList.toggle('is-over', program.length > level.par);
      levelV.textContent = `${index + 1}/${LEVELS}`;
      bestV.textContent = cleared[key] ? `Best: ${fewest[key]} command${fewest[key] === 1 ? '' : 's'}${fewest[key] <= level.par ? ' ★' : ''}` : '';
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= LEVELS - 1;
      runBtn.disabled = running || done || !program.length;
      clearBtn.disabled = running || done || !program.length;
      cmdBtns.forEach(b => { b.disabled = running || done || program.length >= MAX_STEPS; });
    }

    /* ------------------------------ the game ------------------------------ */
    const clearOverlays = () => { for (const s of ['.pz__cover', '.ng__card', '.ng__levels']) bw.querySelector(s)?.remove(); };
    function persist() { save(GAME, { cur: index, cleared: { ...cleared }, fewest: { ...fewest } }); }
    function start(i) {
      clearTimeout(timer);
      index = Math.max(0, Math.min(LEVELS - 1, i));
      level = makeLevel(index);
      program = []; running = false; frames = []; fi = 0; result = null; done = false; paused = false; shown = -1; runs = 0;
      robot = { x: level.start % level.w, y: (level.start / level.w) | 0, dir: level.dir, ev: 'start' };
      clearOverlays();
      persist(); paint();
      say(`Level ${index + 1}: write a program of up to ${MAX_STEPS} commands that ends on the goal. Par is ${level.par}.`);
      onScore(0);
    }
    function add(c) {
      if (dead || paused || running || done || program.length >= MAX_STEPS) return;
      program.push(c); snd.wake(); snd.blip(360 + program.length * 40, 0.05, 'triangle', 0.5);
      resetRobot(); paint();
    }
    function removeAt(i) { if (dead || paused || running || done || i >= program.length) return; program.splice(i, 1); resetRobot(); paint(); }
    function resetRobot() { robot = { x: level.start % level.w, y: (level.start / level.w) | 0, dir: level.dir, ev: 'start' }; result = null; if (msg) { msg = ''; paintFoot(); } }
    function clearProgram() { if (dead || paused || running || done) return; program = []; resetRobot(); paint(); say('Program cleared.'); }

    function runProgram() {
      if (dead || paused || running || done || !program.length) return;
      resetRobot();
      const out = run(level, program);
      frames = out.frames; fi = 0; result = out; running = true; runs++;
      snd.wake();
      say('Running…');
      if (reduced) { fi = frames.length - 1; apply(frames[fi]); finishRun(); return; }
      paint();
      tick();
    }
    function apply(f) { robot = { x: f.x, y: f.y, dir: f.dir, ev: f.ev }; shown = f.i; paint(); }
    function tick() {
      clearTimeout(timer);
      if (dead || paused) return;
      fi++;
      if (fi >= frames.length) { finishRun(); return; }
      const f = frames[fi];
      apply(f);
      snd.blip(f.ev === 'bump' ? 150 : f.ev === 'fall' ? 120 : 330 + 20 * fi, 0.05, f.ev === 'bump' ? 'sawtooth' : 'triangle', 0.5);
      timer = setTimeout(tick, STEP_MS);
    }
    function finishRun() {
      clearTimeout(timer);
      running = false; shown = -1;
      const win = result.win;
      paint();
      if (win) { win_(); return; }
      const why = result.reason === 'pit' ? 'The robot fell into a pit.' : 'The program ended, but the robot is not on the goal.';
      say(`${why} Change the program and run it again.`);
      snd.blip(140, 0.12, 'sawtooth', 0.5);
    }
    function win_() {
      done = true;
      const n = program.length, par = level.par, perfect = n <= par, key = String(index), solvedAt = index;
      cleared[key] = (cleared[key] || 0) + 1;
      if (!fewest[key] || n < fewest[key]) fewest[key] = n;
      if (index < LEVELS - 1) index++;
      persist(); paint();
      const line = perfect ? `Perfect: ${n} command${n === 1 ? '' : 's'}, par ${par}.` : `${n} commands; par is ${par}.`;
      const next = solvedAt < LEVELS - 1 ? cardButton('Next level', () => start(index), 'chevron-right') : cardButton('Play level 24 again', () => start(solvedAt), 'refresh');
      bw.appendChild(resultCard(perfect ? 'Goal in par!' : 'Goal reached!', `Level ${solvedAt + 1}. ${line}`, next));
      say(`Level ${solvedAt + 1} done. ${line}`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(784, 0.16, 'triangle', 0.8), 120);
      onScore(n);
      onEnd({ score: n, won: true, detail: `Level ${solvedAt + 1} · ${n} commands, par ${par}${perfect ? ' (perfect)' : ''}` });
    }

    function showLevels() {
      const open = bw.querySelector('.ng__levels');
      if (open) { open.remove(); return; }
      const n = Object.keys(cleared).length, p = Object.keys(cleared).filter(k => fewest[k] <= makeLevel(+k).par).length;
      bw.appendChild(h('div.ng__levels', { role: 'dialog', 'aria-label': 'Levels' },
        h('h4', { text: 'Robo Tiles · 24 mazes' }), h('p', { text: `${n} of ${LEVELS} cleared · ${p} in par` }),
        levelGrid(LEVELS, index, i => {
          const k = String(i), par = makeLevel(i).par, inPar = fewest[k] && fewest[k] <= par;
          return { done: !!cleared[k], star: inPar, note: inPar ? '★ par' : cleared[k] ? '✓' : `par ${par}`, title: `Level ${i + 1}: par ${par}${cleared[k] ? `, best ${fewest[k]} commands` : ''}` };
        }, i => { if (!dead) start(i); })));
      bw.querySelector('.ng__lv button.is-cur')?.focus({ preventScroll: true });
    }

    /* ------------------------------ input ------------------------------ */
    L.on(window, 'keydown', e => {
      if (dead || paused || !ownsKey(root, e)) return;
      const k = e.key;
      if (e.repeat && k !== 'Backspace') return;
      if (KEYS[k.toLowerCase?.()] && k.length === 1) { e.preventDefault(); add(KEYS[k.toLowerCase()]); }
      else if (k === 'Backspace') { e.preventDefault(); if (!running && !done && program.length) removeAt(program.length - 1); }
      else if (k === 'Delete') { e.preventDefault(); clearProgram(); }
      else if (k === 'Enter') { if (document.activeElement && document.activeElement !== svg && root.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') return; e.preventDefault(); runProgram(); }
      else if (k === 'n' || k === 'N') { e.preventDefault(); if (index < LEVELS - 1) start(index + 1); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); if (index > 0) start(index - 1); }
    });
    L.on(root, 'click', blurMouse);
    L.on(runBtn, 'click', () => runProgram());
    L.on(clearBtn, 'click', () => clearProgram());
    L.on(levelsBtn, 'click', () => { if (!dead) showLevels(); });
    L.on(prevBtn, 'click', () => { if (!dead && index > 0) start(index - 1); });
    L.on(nextBtn, 'click', () => { if (!dead && index < LEVELS - 1) start(index + 1); });

    start(index);

    return {
      stop() { if (dead) return; dead = true; clearTimeout(timer); L.clear(); snd.close(); persist(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; clearTimeout(timer); if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (running) timer = setTimeout(tick, STEP_MS); },
      peek: () => ({
        index, level: index + 1, levels: LEVELS, w: level.w, h: level.h, cells: level.cells.join(''), start: level.start, dir: level.dir, goal: level.goal, par: level.par,
        program: program.join(''), running, robot: robot ? { x: robot.x, y: robot.y, dir: robot.dir } : null, result: result ? result.reason : null, done, paused, runs,
        cleared: { ...cleared }, fewest: { ...fewest }, message: msg, frames: frames.length, frame: fi,
      }),
      /* test hook — nothing in the game calls it: level(i), solution() -> the shortest winning program as text */
      hook(cmd, a) {
        if (cmd === 'level') { start(a); return true; }
        if (cmd === 'solution') return solve(level)?.program.join('') || null;
        return false;
      },
    };
  },
};
