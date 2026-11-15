/* ============================================================
   arcade/bridgebuilder.js — Bridge Builder for Static Arcade.

   Join the two cliffs with a road and a frame of beams that stays
   under the budget and holds a truck. Eight gaps, from a creek to a
   grand span. Pick a material, press on one dot and press on another
   (or drag between them) to lay a beam; joints appear where beams
   meet. Test drive sends the truck across: every beam is checked at
   every quarter of the road, and the ones asked for too much turn
   red — the first to pass its strength snaps. The check
   (bridgebuilder-logic.js) finds the push or pull in each beam from
   joint equilibrium; beams are taken as weightless, only the truck
   weighs anything, and buckling isn't modelled. A frame that can
   move without stretching a beam "wobbles" and says so.

   Par is what a standard frame of triangles costs on that gap (the
   test suite builds it for all eight and checks it holds); you can
   beat it. Your bridge is a code (Copy code): a friend opens it with
   Open code, and it is checked as a drawing — a joint off the
   building area, a beam through a joint or across another beam, a
   gap this Arcade doesn't have — before it is ever shown.

   Controls
     mouse / touch   press a dot, then another dot (or drag): a beam of
                     the chosen material · the Erase tool removes a
                     joint (and its beams) or a beam
     keyboard        arrows move the cursor · Enter starts a beam and
                     then ends it · 1 Road 2 Wood 3 Steel 4 Erase ·
                     Delete erases at the cursor · Backspace undoes ·
                     T tests · N / P next / previous gap
   Score = the cost of a bridge that passes, lower is better (within
   the budget). The gap you were on and the cheapest bridge on each
   are kept on this device (portal.arcadePuzzles.bridgebuilder).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import { NG_CSS, blurMouse, levelGrid, resultCard, cardButton, copyText, codeBar } from './ng1kit.js';
import { LEVELS, MATERIALS, Y_MIN, Y_MAX, emptyDesign, evaluate, autoDesign, costOf, jointOk, problem, toCode, parseCode } from './bridgebuilder-logic.js';

const GAME = 'bridgebuilder';
const NS = 'http://www.w3.org/2000/svg';
const KIND_COLOR = { road: '#c9a77c', wood: '#b9803b', steel: '#a9bdd2' };
const KIND_W = { road: 0.22, wood: 0.12, steel: 0.16 };
const TOOLS = [['road', 'Road', '1'], ['wood', 'Wood', '2'], ['steel', 'Steel', '3'], ['erase', 'Erase', '4']];
const SAMPLE_MS = 140;
const CSS = `${BASE}${NG_CSS}
.ng__board{width:100%;height:100%;max-width:980px;background:linear-gradient(#10172c,#0d1224)}
.bb__tools{width:min(100%,760px);display:flex;gap:6px;justify-content:center;flex-wrap:wrap;flex:0 0 auto}
.bb__tools .pz__btn[aria-pressed="true"]{background:color-mix(in srgb,var(--ga) 28%,transparent);border-color:var(--ga)}
.bb__sw{width:12px;height:12px;border-radius:3px;display:inline-block}
`;
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const ratioColor = r => `hsl(${Math.round(120 - 120 * Math.min(1, Math.max(0, r)))},80%,55%)`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false, timer = 0;
    const sv = load(GAME);
    const best = {};
    for (const [k, v] of Object.entries(sv.best || {})) if (Number.isFinite(v) && v > 0) best[k] = v;
    let index = Math.max(0, Math.min(LEVELS.length - 1, Number(sv.cur) || 0));
    let level = LEVELS[index], D = emptyDesign(), undo = [], tool = 'road', start = null, cursor = [1, 0], kbd = false, msg = '';
    let status = 'build', test = null, k = 0, result = null, done = false, par = 0;

    const costV = h('span', { text: '0' });
    const costRead = h('div.pz__read', { title: 'Cost of the bridge / the budget', 'aria-label': 'Cost' }, icon('layers'), costV, h('small', { text: '' }));
    const levelV = h('span', { text: '' });
    const levelRead = h('div.pz__read', { title: 'The gap', 'aria-label': 'Gap' }, icon('map-pin'), levelV);
    const bestV = h('small', { text: '' });
    const levelsBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'levels' }, title: 'All eight gaps' }, icon('grid-9'), h('span.pz__long', { text: 'Gaps' }));
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous gap (P)', 'aria-label': 'Previous gap' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next gap (N)', 'aria-label': 'Next gap' }, icon('chevron-right'));
    const testBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'test' }, title: 'Send the truck across (T)' }, icon('play'), h('span', { text: 'Test drive' }));
    const undoBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'undo' }, title: 'Undo (Backspace)' }, icon('corner-up-left'), h('span.pz__long', { text: 'Undo' }));
    const clearBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'clear' }, title: 'Remove every beam' }, icon('trash'), h('span.pz__long', { text: 'Clear' }));
    const top = h('div.pz__top', levelsBtn, prevBtn, levelRead, nextBtn, costRead, bestV, testBtn, undoBtn, clearBtn);
    const toolBtns = TOOLS.map(([id, label, key]) => h('button.pz__btn', { type: 'button', dataset: { tool: id }, 'aria-pressed': String(id === tool), title: `${label} (${key})`, onclick: () => setTool(id) },
      id === 'erase' ? icon('x') : h('i.bb__sw', { style: { background: KIND_COLOR[id] } }), h('span', { text: label }), id === 'erase' ? null : h('small', { text: `${MATERIALS[id].rate}/unit · ${MATERIALS[id].strength}` })));
    const toolsEl = h('div.bb__tools', { role: 'group', 'aria-label': 'Material' }, ...toolBtns);
    const svg = svgEl('svg', { class: 'ng__board', tabindex: '0', role: 'application', 'aria-label': 'Bridge Builder', preserveAspectRatio: 'xMidYMid meet' });
    const bw = h('div.ng__bw', svg);
    const codeBar1 = codeBar({ placeholder: 'Paste a bridge code (BB1:…)', onOpen: openCode, onCopy: () => copyCode() });
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, bw, toolsEl, codeBar1.el, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'press a dot, then another, to lay a beam · <kbd>1</kbd>–<kbd>4</kbd> material · <kbd>T</kbd> test drive · <kbd>Backspace</kbd> undo' }));
    const allPts = () => [...level.anchors, ...D.joints];
    const findJoint = (x, y) => allPts().findIndex(p => p[0] === x && p[1] === y);
    const validPoint = (x, y) => (x === 0 || x === level.span ? level.anchors.some(a => a[0] === x && a[1] === y) : jointOk(level, x, y));
    function setTool(id) { tool = id; start = null; toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === id))); paint(); }

    /* ------------------------------ drawing ------------------------------ */
    const viewBox = () => ({ x: -2.2, y: Y_MIN - 1.2, w: level.span + 4.4, h: Y_MAX - Y_MIN + 3.6 });
    function paint() {
      const vb = viewBox();
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      svg.replaceChildren();
      const P = allPts(), A = level.anchors.length;
      /* water, cliffs */
      svg.appendChild(svgEl('rect', { x: vb.x, y: 2.6, width: vb.w, height: vb.h, fill: '#143a63', opacity: 0.7 }));
      svg.appendChild(svgEl('rect', { x: vb.x, y: 0, width: 2.2, height: vb.h, fill: '#3a3f55' }));
      svg.appendChild(svgEl('rect', { x: level.span, y: 0, width: 2.2 + 0.2, height: vb.h, fill: '#3a3f55' }));
      svg.appendChild(svgEl('rect', { x: vb.x, y: 0, width: 2.2, height: 0.2, fill: '#5a7a4a' }));
      svg.appendChild(svgEl('rect', { x: level.span, y: 0, width: 2.4, height: 0.2, fill: '#5a7a4a' }));
      /* the building area's dots */
      for (let x = 1; x < level.span; x++) for (let y = Y_MIN; y <= Y_MAX; y++) if (!P.some(p => p[0] === x && p[1] === y)) svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 0.05, fill: 'rgba(200,215,255,.3)' }));
      /* a pier: anchors that are not the two deck ends are shown as posts (a wall anchor is a bolt) */
      level.anchors.forEach((a, i) => {
        if (i < 2 || a[0] === 0 || a[0] === level.span) return;
        svg.appendChild(svgEl('rect', { x: a[0] - 0.22, y: a[1], width: 0.44, height: vb.h, fill: '#4a4f68' }));
      });
      /* the beams, coloured by how hard they are working at the truck's place */
      const sample = test && test.samples[Math.min(k, test.samples.length - 1)];
      D.beams.forEach((b, i) => {
        const a = P[b[0]], c = P[b[1]];
        let col = KIND_COLOR[b[2]];
        let ratio = 0;
        if (sample) { ratio = Math.abs(sample.f[i]) / MATERIALS[b[2]].strength; col = ratioColor(ratio); }
        const snapped = status === 'failed' && result && result.failBeam === i;
        const g = svgEl('g', { 'data-beam': i, 'data-kind': b[2], 'data-ratio': ratio.toFixed(2) });
        g.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: '#0b0e18', 'stroke-width': KIND_W[b[2]] + 0.1, 'stroke-linecap': 'round' }));
        g.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: col, 'stroke-width': KIND_W[b[2]], 'stroke-linecap': 'round', ...(snapped ? { 'stroke-dasharray': '0.25 0.35' } : {}) }));
        if (b[2] === 'steel') g.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: '#0b0e18', 'stroke-width': 0.04, 'stroke-dasharray': '0.1 0.14', opacity: 0.6 }));
        svg.appendChild(g);
      });
      /* joints */
      P.forEach((p, i) => {
        const anchor = i < A;
        svg.appendChild(anchor ? svgEl('rect', { x: p[0] - 0.17, y: p[1] - 0.17, width: 0.34, height: 0.34, fill: '#e8ecf5', stroke: '#0b0e18', 'stroke-width': 0.05, 'data-anchor': i })
          : svgEl('circle', { cx: p[0], cy: p[1], r: 0.15, fill: '#ffd23f', stroke: '#0b0e18', 'stroke-width': 0.05, 'data-joint': i - A }));
      });
      if (start) svg.appendChild(svgEl('circle', { cx: start[0], cy: start[1], r: 0.3, fill: 'none', stroke: '#fff', 'stroke-width': 0.07 }));
      if (kbd) svg.appendChild(svgEl('rect', { x: cursor[0] - 0.32, y: cursor[1] - 0.32, width: 0.64, height: 0.64, rx: 0.1, fill: 'none', stroke: '#fff', 'stroke-width': 0.06, 'stroke-dasharray': '0.16 0.12' }));
      /* the truck */
      if (status === 'testing' || status === 'passed' || status === 'failed') {
        const at = sample ? sample.at : level.anchors[0];
        const g = svgEl('g', { 'data-truck': '1' });
        g.appendChild(svgEl('rect', { x: at[0] - 0.42, y: at[1] - 0.62, width: 0.84, height: 0.4, rx: 0.08, fill: '#ff7a59', stroke: '#0b0e18', 'stroke-width': 0.04 }));
        g.appendChild(svgEl('rect', { x: at[0] + 0.1, y: at[1] - 0.76, width: 0.3, height: 0.3, rx: 0.06, fill: '#ffb199' }));
        for (const dx of [-0.24, 0.24]) g.appendChild(svgEl('circle', { cx: at[0] + dx, cy: at[1] - 0.17, r: 0.14, fill: '#1a1d29', stroke: '#c9ced9', 'stroke-width': 0.04 }));
        svg.appendChild(g);
      }
      const cost = costOf(level, D);
      costV.textContent = String(cost);
      costRead.lastChild.textContent = `/ ${level.budget}`;
      costRead.classList.toggle('is-over', cost > level.budget);
      levelV.textContent = `${level.id}/${LEVELS.length} ${level.name}`;
      bestV.textContent = best[String(index)] ? `Best: ${best[String(index)]}${best[String(index)] <= par ? ' ★' : ''} · par ${par}` : `par ${par}`;
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= LEVELS.length - 1;
      testBtn.disabled = status === 'testing' || !D.beams.length;
      undoBtn.disabled = status === 'testing' || !undo.length;
      clearBtn.disabled = status === 'testing' || !D.beams.length;
      svg.setAttribute('aria-label', `Bridge Builder, gap ${level.id}: ${level.name}, ${level.span} wide, truck ${level.truck}, budget ${level.budget}. ${D.beams.length} beams, cost ${cost}.`);
    }

    /* ------------------------------ editing ------------------------------ */
    const snapshot = () => { undo.push(JSON.stringify(D)); if (undo.length > 80) undo.shift(); };
    const clearOverlays = () => { for (const s of ['.pz__cover', '.ng__card', '.ng__levels']) bw.querySelector(s)?.remove(); };
    function reset() { clearTimeout(timer); status = 'build'; test = null; k = 0; result = null; done = false; clearOverlays(); }
    function persist() { save(GAME, { cur: index, best: { ...best } }); }
    function load_(i, design) {
      reset();
      index = Math.max(0, Math.min(LEVELS.length - 1, i));
      level = LEVELS[index]; D = design || emptyDesign(); undo = []; start = null; cursor = [1, 0]; done = false; paused = false; msg = '';
      const auto = autoDesign(level);
      par = auto ? costOf(level, auto) : 0;
      persist(); paint();
      say(`Gap ${level.id}, ${level.name}: ${level.span} wide, the truck weighs ${level.truck}, the budget is ${level.budget}. Par is ${par}.`);
      onScore(0);
    }
    function joint(x, y) {
      let i = findJoint(x, y);
      if (i >= 0) return { i, made: false };
      if (!jointOk(level, x, y)) return null;
      D.joints.push([x, y]);
      return { i: level.anchors.length + D.joints.length - 1, made: true };
    }
    function addBeam(p, q) {
      if (status === 'testing') return false;
      if (p[0] === q[0] && p[1] === q[1]) return false;
      if (!validPoint(p[0], p[1]) || !validPoint(q[0], q[1])) { say('Beams join the dots in the gap, and the posts at the cliffs.'); return false; }
      snapshot();
      const before = JSON.stringify(D);
      const a = joint(p[0], p[1]), b = joint(q[0], q[1]);
      if (!a || !b) { D = JSON.parse(before); undo.pop(); return false; }
      D.beams.push([a.i, b.i, tool]);
      const why = problem(level, D);
      if (why) { D = JSON.parse(before); undo.pop(); snd.blip(140, 0.08, 'sawtooth', 0.4); say(why); paint(); return false; }
      reset(); snd.wake(); snd.blip(380, 0.05, 'triangle', 0.6);
      paint(); say(`${MATERIALS[tool].name} beam laid. Cost ${costOf(level, D)} of ${level.budget}.`);
      onScore(costOf(level, D));
      return true;
    }
    /* take a joint away with its beams; free joints with no beam left go too */
    function tidy() {
      const A = level.anchors.length, used = new Set();
      D.beams.forEach(b => { used.add(b[0]); used.add(b[1]); });
      const map = new Map();
      const joints = [];
      D.joints.forEach((j, n) => { if (used.has(A + n)) { map.set(A + n, A + joints.length); joints.push(j); } });
      D.beams = D.beams.map(b => [b[0] < A ? b[0] : map.get(b[0]), b[1] < A ? b[1] : map.get(b[1]), b[2]]);
      D.joints = joints;
    }
    function eraseAt(x, y, bi) {
      if (status === 'testing') return false;
      const A = level.anchors.length;
      if (bi !== undefined && bi >= 0) { snapshot(); D.beams.splice(bi, 1); tidy(); reset(); paint(); say('Beam removed.'); return true; }
      const i = findJoint(x, y);
      if (i < 0) return false;
      snapshot();
      D.beams = D.beams.filter(b => b[0] !== i && b[1] !== i);
      if (i >= A) { /* the joint itself: renumber */
        D.beams = D.beams.map(b => [b[0] > i ? b[0] - 1 : b[0], b[1] > i ? b[1] - 1 : b[1], b[2]]);
        D.joints.splice(i - A, 1);
      }
      tidy(); reset(); paint(); say(i >= A ? 'Joint and its beams removed.' : 'Beams from that post removed.');
      return true;
    }
    function undoOne() {
      if (dead || paused || status === 'testing' || !undo.length) return;
      D = JSON.parse(undo.pop()); start = null; reset(); paint(); say('Undone.');
      onScore(costOf(level, D));
    }
    function clearAll() { if (dead || paused || status === 'testing' || !D.beams.length) return; snapshot(); D = emptyDesign(); start = null; reset(); paint(); say('Every beam removed.'); onScore(0); }

    /* ------------------------------ the test drive ------------------------------ */
    function testDrive() {
      if (dead || paused || status === 'testing' || !D.beams.length) return;
      reset(); start = null;
      const r = evaluate(level, D);
      result = { ...r, failBeam: -1 };
      if (r.reason === 'snap') result.failBeam = r.worst.indexOf(Math.max(...r.worst));
      snd.wake();
      if (!r.samples.length) { status = 'failed'; paint(); say(r.text); snd.blip(140, 0.12, 'sawtooth', 0.5); return; }
      test = r; k = 0; status = 'testing';
      say('The truck is crossing…');
      if (reduced) { k = r.failAt >= 0 ? r.failAt : r.samples.length - 1; finishTest(); return; }
      paint();
      timer = setTimeout(stepTest, SAMPLE_MS);
    }
    function stepTest() {
      clearTimeout(timer);
      if (dead || paused) return;
      const stopAt = test.failAt >= 0 ? test.failAt : test.samples.length - 1;
      if (k >= stopAt) { finishTest(); return; }
      k++;
      paint();
      if (k % 3 === 0) snd.blip(200 + 12 * k, 0.04, 'triangle', 0.3);
      timer = setTimeout(stepTest, SAMPLE_MS);
    }
    function finishTest() {
      clearTimeout(timer);
      const r = result;
      status = r.ok ? 'passed' : 'failed';
      paint();
      say(r.text);
      if (!r.ok) { snd.blip(120, 0.25, 'sawtooth', 0.7, 50); return; }
      done = true;
      const cost = r.cost, key = String(index), perfect = cost <= par, solvedAt = index;
      if (!best[key] || cost < best[key]) best[key] = cost;
      persist(); paint();
      const line = perfect ? `Cost ${cost}: at or under par (${par}).` : `Cost ${cost}; par is ${par}.`;
      const next = solvedAt < LEVELS.length - 1 ? cardButton('Next gap', () => { load_(solvedAt + 1); }, 'chevron-right') : cardButton('Build it again', () => load_(solvedAt), 'refresh');
      bw.appendChild(resultCard(perfect ? 'Across, at par or better!' : 'Across!', `Gap ${level.id}, ${level.name}. ${line}`, next,
        cardButton('Copy code', () => copyCode(), 'copy')));
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(784, 0.16, 'triangle', 0.8), 120);
      onScore(cost);
      onEnd({ score: cost, won: true, detail: `Gap ${level.id} (${level.name}) · cost ${cost} of ${level.budget}, par ${par}${perfect ? ' (at or under par)' : ''}` });
    }

    /* ------------------------------ codes ------------------------------ */
    async function copyCode() {
      if (!D.beams.length) { say('Build something first: there is nothing to share yet.'); return; }
      const code = toCode(level, D);
      codeBar1.input.value = code;
      say((await copyText(code)) ? 'The bridge code is copied. A friend opens it with Open code.' : 'The code is in the box: select it and copy it.');
    }
    function openCode(text) {
      const r = parseCode(text);
      if (!r.ok) { say(r.why); return false; }
      load_(LEVELS.indexOf(r.level), r.design);
      say(`Opened a bridge for gap ${r.level.id} (${r.level.name}): ${r.design.beams.length} beams, cost ${costOf(r.level, r.design)}. Test drive it.`);
      onScore(costOf(r.level, r.design));
      return true;
    }

    /* ------------------------------ the gap list ------------------------------ */
    function showLevels() {
      const open = bw.querySelector('.ng__levels');
      if (open) { open.remove(); return; }
      bw.appendChild(h('div.ng__levels', { role: 'dialog', 'aria-label': 'Gaps' },
        h('h4', { text: 'Bridge Builder · 8 gaps' }), h('p', { text: `${Object.keys(best).length} of ${LEVELS.length} crossed` }),
        levelGrid(LEVELS.length, index, i => {
          const key = String(i), b = best[key], par_ = costOf(LEVELS[i], autoDesign(LEVELS[i]) || emptyDesign());
          return { done: !!b, star: !!b && b <= par_, note: b ? `${b}${b <= par_ ? ' ★' : ''}` : LEVELS[i].name, title: `Gap ${i + 1}, ${LEVELS[i].name}: ${LEVELS[i].span} wide, budget ${LEVELS[i].budget}, par ${par_}${b ? `, your best ${b}` : ''}` };
        }, i => { if (!dead) load_(i); }, 'Gaps')));
      bw.querySelector('.ng__lv button.is-cur')?.focus({ preventScroll: true });
    }

    /* ------------------------------ input ------------------------------ */
    const toBoard = e => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(m.inverse());
      return [q.x, q.y];
    };
    const nearestPoint = (x, y) => {
      const px = Math.round(x), py = Math.round(y);
      if (Math.hypot(x - px, y - py) > 0.55) return null;
      if (px < 0 || px > level.span || py < Y_MIN || py > Y_MAX + 0) return null;
      return [px, py];
    };
    const nearestBeam = (x, y) => {
      const P = allPts();
      let bi = -1, bd = 0.3;
      D.beams.forEach((b, i) => {
        const a = P[b[0]], c = P[b[1]], dx = c[0] - a[0], dy = c[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
        const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
        if (d < bd) { bd = d; bi = i; }
      });
      return bi;
    };
    let down = null;
    L.on(svg, 'pointerdown', e => {
      if (dead || paused || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const b = toBoard(e);
      if (!b) return;
      e.preventDefault(); kbd = false; snd.wake();
      svg.focus({ preventScroll: true });
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      const pt = nearestPoint(b[0], b[1]);
      if (tool === 'erase') {
        const bi = pt && findJoint(pt[0], pt[1]) >= 0 ? -1 : nearestBeam(b[0], b[1]);
        if (bi >= 0) eraseAt(0, 0, bi); else if (pt) eraseAt(pt[0], pt[1]);
        return;
      }
      if (!pt) { start = null; paint(); return; }
      down = pt;
      if (start && (start[0] !== pt[0] || start[1] !== pt[1])) { const s = start; start = null; addBeam(s, pt); down = null; return; }
      if (start && start[0] === pt[0] && start[1] === pt[1]) { start = null; paint(); down = null; return; }
      if (!validPoint(pt[0], pt[1])) { say('Beams join the dots in the gap, and the posts at the cliffs.'); down = null; return; }
      start = pt; paint();
    });
    const up = e => {
      if (!down || dead) { down = null; return; }
      const b = toBoard(e), pt = b && nearestPoint(b[0], b[1]), from = down;
      down = null;
      if (pt && start && (pt[0] !== from[0] || pt[1] !== from[1])) { start = null; addBeam(from, pt); }
    };
    L.on(svg, 'pointerup', up);
    L.on(svg, 'pointercancel', () => { down = null; });

    function cursorMove(dx, dy) {
      kbd = true;
      cursor = [Math.max(0, Math.min(level.span, cursor[0] + dx)), Math.max(Y_MIN, Math.min(Y_MAX, cursor[1] + dy))];
      paint();
    }
    L.on(window, 'keydown', e => {
      if (dead || paused || !ownsKey(root, e)) return;
      const key = e.key;
      if (key.startsWith('Arrow')) { e.preventDefault(); const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); cursorMove(key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0); }
      else if (key === 'Enter' || key === ' ') {
        if (document.activeElement?.tagName === 'BUTTON' && root.contains(document.activeElement)) return;
        e.preventDefault(); if (e.repeat) return;
        kbd = true;
        if (tool === 'erase') { const bi = findJoint(cursor[0], cursor[1]) >= 0 ? -1 : nearestBeam(cursor[0], cursor[1]); if (bi >= 0) eraseAt(0, 0, bi); else eraseAt(cursor[0], cursor[1]); return; }
        if (!start) { if (!validPoint(cursor[0], cursor[1])) { say('Nothing to join at that dot.'); return; } start = cursor.slice(); paint(); say('Beam started. Move to another dot and press Enter.'); }
        else if (start[0] === cursor[0] && start[1] === cursor[1]) { start = null; paint(); say('Beam cancelled.'); }
        else { const s = start; start = null; addBeam(s, cursor.slice()); }
      } else if (key === 'Delete') { e.preventDefault(); eraseAt(cursor[0], cursor[1]); }
      else if (key === 'Backspace') { e.preventDefault(); undoOne(); }
      else if (key >= '1' && key <= '4') { e.preventDefault(); setTool(TOOLS[+key - 1][0]); }
      else if (key === 't' || key === 'T') { e.preventDefault(); testDrive(); }
      else if (key === 'n' || key === 'N') { e.preventDefault(); if (index < LEVELS.length - 1) load_(index + 1); }
      else if (key === 'p' || key === 'P') { e.preventDefault(); if (index > 0) load_(index - 1); }
    });
    L.on(root, 'click', blurMouse);
    L.on(testBtn, 'click', () => testDrive());
    L.on(undoBtn, 'click', () => undoOne());
    L.on(clearBtn, 'click', () => clearAll());
    L.on(levelsBtn, 'click', () => { if (!dead) showLevels(); });
    L.on(prevBtn, 'click', () => { if (!dead && index > 0) load_(index - 1); });
    L.on(nextBtn, 'click', () => { if (!dead && index < LEVELS.length - 1) load_(index + 1); });

    load_(index);

    return {
      stop() { if (dead) return; dead = true; clearTimeout(timer); L.clear(); snd.close(); persist(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; clearTimeout(timer); if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (status === 'testing') timer = setTimeout(stepTest, SAMPLE_MS); },
      peek: () => ({
        index, gap: level.id, name: level.name, span: level.span, budget: level.budget, truck: level.truck, par, cost: costOf(level, D), joints: D.joints.map(j => j.slice()), beams: D.beams.map(b => b.slice()),
        anchors: level.anchors.map(a => a.slice()), tool, start, status, done, paused, message: msg, best: { ...best }, code: D.beams.length ? toCode(level, D) : '',
        result: result ? { ok: result.ok, reason: result.reason, text: result.text, cost: result.cost, failBeam: result.failBeam } : null, step: k, steps: test ? test.samples.length : 0,
      }),
      /* test hook — nothing in the game calls it: level(i), pt([x, y]) -> where that dot is on the screen, auto() -> the solver's design (as a code) */
      hook(cmd, a) {
        if (cmd === 'level') { load_(a); return true; }
        if (cmd === 'pt') { const m = svg.getScreenCTM(); const p = svg.createSVGPoint(); p.x = a[0]; p.y = a[1]; const q = p.matrixTransform(m); return [q.x, q.y]; }
        if (cmd === 'auto') { const d = autoDesign(level); return d ? toCode(level, d) : null; }
        return false;
      },
    };
  },
};
