/* ============================================================
   physics.js — Physics Sandbox: a projectile, a pendulum and a
   mass on a spring, with sliders for the real variables.

   The motion is worked out by js/core/physics.js: fixed-step RK4 at
   1/240 s, so a run gives the same numbers on a slow screen and a
   fast one. This window only draws it and shows what was measured
   (heights, landings and swing periods come from the stepped motion;
   the textbook formula is printed beside them for comparison, and
   only where it applies). What each scene leaves out is written
   under the sliders.

   Changing a slider puts the scene back at the start. Space starts
   and pauses, R resets.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import * as P from '../core/physics.js';

const SCENE_ORDER = ['projectile', 'pendulum', 'spring'];
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const REST = 2;                        /* the spring's natural length on screen, m */

const CSS = `
.ph{flex:1;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--ink-1);font-size:var(--fs-13)}
.ph *{box-sizing:border-box}
.ph__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.ph__tabs{display:flex;gap:var(--sp-2)}
.ph__tabs button,.ph__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.ph__tabs button[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.ph__btn--go{background:var(--fill-3);color:var(--ink-0);font-weight:600;min-width:92px}
.ph__btn:hover,.ph__tabs button:hover{background:var(--fill-2)}
.ph__sp{flex:1}
.ph__speed{display:flex;align-items:center;gap:var(--sp-2);color:var(--ink-2)}
.ph__speed select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit}
.ph__main{flex:1;min-height:0;display:flex;gap:var(--sp-4);padding:var(--sp-4);overflow:auto}
.ph__stage{flex:1 1 360px;min-width:240px;min-height:260px;position:relative;border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);overflow:hidden}
.ph__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ph__side{flex:0 0 300px;display:flex;flex-direction:column;gap:var(--sp-4);min-width:0}
@media (max-width:760px){.ph__side{flex-basis:100%}}
.ph__sl{display:grid;grid-template-columns:1fr auto;gap:2px var(--sp-3);align-items:center}
.ph__sl label{color:var(--ink-2)}
.ph__sl output{font-variant-numeric:tabular-nums;color:var(--ink-0);font-weight:600}
.ph__sl input{grid-column:1/3;width:100%;accent-color:var(--accent)}
.ph__sliders{display:flex;flex-direction:column;gap:var(--sp-3)}
.ph h3{margin:0;font-size:var(--fs-11);color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em}
.ph__meas{display:grid;grid-template-columns:auto 1fr;gap:4px var(--sp-4);margin:0;font-variant-numeric:tabular-nums}
.ph__meas dt{color:var(--ink-3)}
.ph__meas dd{margin:0;color:var(--ink-0);overflow-wrap:anywhere}
.ph__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5}
`;

const css = (el, name, fallback) => (getComputedStyle(el).getPropertyValue(name).trim() || fallback);
const num = (n, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : String(Math.round(n * 10 ** d) / 10 ** d));

defineApp({
  id: 'physics',
  name: 'Physics Sandbox',
  icon: 'activity',
  g1: '#7bd0ff', g2: '#3a4fd6',
  category: 'Utilities',
  keywords: ['physics', 'projectile', 'pendulum', 'spring', 'gravity', 'simulation', 'science', 'school', 'motion', 'launch', 'oscillation', 'period', 'drag'],
  desc: 'Launch projectiles, swing pendulums and bounce springs, with sliders for the real variables',
  win: { w: 920, h: 620, minW: 520, minH: 420 },
  shortcuts: [['Space', 'Start or pause'], ['R', 'Reset to the start']],
  mount({ root, win }) { return build(root, win); },
});

function build(root, win) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const S = { scene: 'projectile', params: {}, sim: null, running: false, speed: 1, preview: null, last: 0, raf: 0 };
  for (const k of SCENE_ORDER) S.params[k] = P.defaults(k);

  const canvas = h('canvas', { role: 'img', 'aria-label': 'The simulation', tabindex: '0', dataset: { fk: 'phys-canvas' } });
  const tabs = h('div.ph__tabs', { role: 'group', 'aria-label': 'Scenes' });
  const play = h('button.ph__btn.ph__btn--go', { type: 'button', dataset: { fk: 'phys-play' }, onclick: () => toggle() });
  const reset = h('button.ph__btn', { type: 'button', dataset: { fk: 'phys-reset' }, onclick: () => resetSim() }, h('span', { text: 'Reset' }));
  const speed = h('select', { 'aria-label': 'Simulation speed', dataset: { fk: 'phys-speed' }, onchange: e => { S.speed = Number(e.target.value); } },
    SPEEDS.map(v => h('option', { value: v, text: `${v}×`, selected: v === 1 })));
  const sliders = h('div.ph__sliders', { dataset: { fk: 'phys-sliders' } });
  const meas = h('dl.ph__meas', { 'aria-live': 'off', dataset: { fk: 'phys-meas' } });
  const compare = h('div.ph__note', { role: 'status', dataset: { fk: 'phys-compare' } });
  const note = h('p.ph__note', { dataset: { fk: 'phys-note' } });
  const el = h('div.ph', h('style', { text: CSS }),
    h('div.ph__bar', tabs, play, reset, h('span.ph__sp'), h('label.ph__speed', h('span', { text: 'Speed' }), speed)),
    h('div.ph__main', h('div.ph__stage', canvas),
      h('div.ph__side', h('h3', { text: 'Variables' }), sliders, h('h3', { text: 'Measured' }), meas, compare, note)));
  root.appendChild(el);

  /* ---------- scene and controls ---------- */
  function paintTabs() {
    tabs.replaceChildren(...SCENE_ORDER.map(k => h('button', { type: 'button', 'aria-pressed': String(S.scene === k), dataset: { scene: k }, onclick: () => setScene(k) }, h('span', { text: P.SCENES[k].name }))));
  }
  function paintSliders() {
    sliders.replaceChildren(...P.SCENES[S.scene].sliders.map(sl => {
      const out = h('output', { dataset: { fk: 'phys-val', key: sl.key } });
      const id = `ph-${S.scene}-${sl.key}`;
      const inp = h('input', { type: 'range', id, min: sl.min, max: sl.max, step: sl.step, value: S.params[S.scene][sl.key], 'aria-label': `${sl.label} (${sl.unit})`, dataset: { fk: 'phys-slider', key: sl.key },
        oninput: e => { S.params[S.scene][sl.key] = Number(e.target.value); out.textContent = `${num(Number(e.target.value), 3)} ${sl.unit}`; resetSim(); } });
      out.textContent = `${num(S.params[S.scene][sl.key], 3)} ${sl.unit}`;
      return h('div.ph__sl', h('label', { for: id, text: sl.label }), out, inp);
    }));
    note.textContent = P.NOTES[S.scene];
  }
  function setScene(k) {
    S.scene = k;
    paintTabs();
    paintSliders();
    resetSim();
    win.setSubtitle(`— ${P.SCENES[k].name}`);
  }
  function resetSim() {
    S.sim = P.create(S.scene, S.params[S.scene]);
    S.running = false;
    /* the faint line of where the projectile will go: the same integrator, run ahead */
    S.preview = S.scene === 'projectile' ? P.run(P.create('projectile', S.params.projectile), 200) : null;
    paintPlay();
    paint();
  }
  function paintPlay() {
    const s = S.sim;
    const done = s.status === 'landed';
    play.textContent = done ? 'Launch again' : S.running ? 'Pause' : s.t > 0 ? 'Resume' : S.scene === 'projectile' ? 'Launch' : 'Start';
    play.dataset.state = done ? 'done' : S.running ? 'running' : s.t > 0 ? 'paused' : 'ready';
  }
  function toggle() {
    if (S.sim.status === 'landed') { resetSim(); S.running = true; }
    else S.running = !S.running;
    S.last = 0;
    paintPlay();
  }

  /* ---------- measured values ---------- */
  function row(key, label, value, raw) {
    return [h('dt', { text: label }), h('dd', { dataset: { fk: 'phys-m', k: key, raw: raw === undefined || raw === null || !Number.isFinite(raw) ? '' : String(raw) }, text: value })];
  }
  function paintMeasured() {
    const m = S.sim.measured();
    const rows = [];
    const add = (...a) => rows.push(...row(...a));
    add('t', 'Time', `${num(m.t, 2)} s`, m.t);
    let cmp = '';
    if (S.scene === 'projectile') {
      add('x', 'Distance', `${num(m.x, 2)} m`, m.x);
      add('y', 'Height', `${num(m.y, 2)} m`, m.y);
      add('speed', 'Speed', `${num(m.speed, 2)} m/s`, m.speed);
      add('maxHeight', 'Highest point', `${num(m.maxHeight, 2)} m`, m.maxHeight);
      add('range', 'Range', m.range === null ? 'in flight' : `${num(m.range, 2)} m`, m.range);
      add('flightTime', 'Flight time', m.flightTime === null ? 'in flight' : `${num(m.flightTime, 2)} s`, m.flightTime);
      add('energy', 'Energy per kg', `${num(m.energy, 2)} J/kg`, m.energy);
      add('energyLost', 'Lost to drag', `${num(m.energyLost, 2)} J/kg`, m.energyLost);
      cmp = m.formulaRange === null ? 'The formula v²·sin 2θ ÷ g only holds with no air drag and a launch from the ground, so it is not shown here.'
        : `Formula v²·sin 2θ ÷ g = ${num(m.formulaRange, 3)} m${m.range === null ? '' : ` (measured differs by ${num(Math.abs(m.range - m.formulaRange) / m.formulaRange * 100, 4)}%)`}.`;
    } else if (S.scene === 'pendulum') {
      add('angle', 'Angle', `${num(m.angle, 1)}°`, m.angle);
      add('speed', 'Bob speed', `${num(m.speed, 2)} m/s`, m.speed);
      add('energy', 'Energy per kg', `${num(m.energy, 3)} J/kg`, m.energy);
      add('period', 'Measured period', m.period === null ? 'measuring…' : `${num(m.period, 4)} s`, m.period);
      add('smallAngle', 'Small-angle formula', `${num(m.smallAnglePeriod, 4)} s`, m.smallAnglePeriod);
      if (m.exactPeriod !== null) add('exactPeriod', 'Exact for this amplitude', `${num(m.exactPeriod, 4)} s`, m.exactPeriod);
      cmp = 'Small-angle formula 2π√(L/g) assumes a tiny swing; it is close below about 10° and drifts high of the true period at large angles. The period is timed between upward crossings of the bottom, so it appears after two crossings (about 1.75 swings).';
    } else {
      add('x', 'Stretch', `${num(m.x, 3)} m`, m.x);
      add('v', 'Velocity', `${num(m.v, 3)} m/s`, m.v);
      add('energy', 'Energy', `${num(m.energy, 4)} J`, m.energy);
      add('period', 'Measured period', m.period === null ? 'measuring…' : `${num(m.period, 4)} s`, m.period);
      add('ideal', 'Formula 2π√(m/k)', `${num(m.idealPeriod, 4)} s`, m.idealPeriod);
      if (m.dampedPeriod !== null && S.sim.params.damping > 0) add('damped', 'Damped formula', `${num(m.dampedPeriod, 4)} s`, m.dampedPeriod);
      cmp = m.overdamped ? 'With this much damping the mass creeps back without oscillating, so there is no period.' : 'The formula 2π√(m/k) is for no damping; damping lengthens the period a little.';
    }
    meas.replaceChildren(...rows);
    compare.textContent = cmp;
    canvas.setAttribute('aria-label', `${P.SCENES[S.scene].name} simulation, time ${num(m.t, 2)} seconds`);
  }

  /* ---------- drawing ---------- */
  let W = 0, H = 0, dpr = 1;
  const ctx = canvas.getContext('2d');
  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    paint();
  }
  function paint() {
    if (!ctx || !S.sim) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = css(el, '--ink-0', '#eee'), dim = css(el, '--ink-3', '#888'), acc = css(el, '--accent', '#6af'), line = css(el, '--line-2', '#555');
    ctx.lineWidth = 2; ctx.font = '12px system-ui, sans-serif';
    if (S.scene === 'projectile') drawProjectile(ink, dim, acc, line);
    else if (S.scene === 'pendulum') drawPendulum(ink, dim, acc, line);
    else drawSpring(ink, dim, acc, line);
    paintMeasured();
  }
  function drawProjectile(ink, dim, acc, line) {
    const pv = S.preview, sim = S.sim;
    const xs = Math.max(pv.range || 0, sim.y[0], 1), ys = Math.max(pv.maxHeight, sim.maxHeight, 1);
    const padL = 36, padB = 28, padT = 14, padR = 14;
    const k = Math.min((W - padL - padR) / xs, (H - padB - padT) / ys);
    const X = x => padL + x * k, Y = y => H - padB - y * k;
    ctx.strokeStyle = line; ctx.fillStyle = dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL, padT); ctx.stroke();
    /* ticks: a round step of about 80 px */
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => s * k >= 70) || 500;
    for (let x = 0; x <= xs + 1e-9; x += step) { ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(0) + 4); ctx.stroke(); ctx.fillText(`${x} m`, X(x) - 8, Y(0) + 17); }
    for (let y = step; y <= ys + 1e-9; y += step) { ctx.beginPath(); ctx.moveTo(padL - 4, Y(y)); ctx.lineTo(padL, Y(y)); ctx.stroke(); ctx.fillText(`${y}`, 4, Y(y) + 4); }
    /* the preview, then the real trail */
    ctx.setLineDash([5, 5]); ctx.strokeStyle = dim; ctx.lineWidth = 1.5; ctx.beginPath();
    pv.trail.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = acc; ctx.lineWidth = 2.5; ctx.beginPath();
    sim.trail.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.lineTo(X(sim.y[0]), Y(sim.y[1])); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(X(sim.y[0]), Y(sim.y[1]), 6, 0, Math.PI * 2); ctx.fill();
  }
  function drawPendulum(ink, dim, acc, line) {
    const L = S.sim.params.length, th = S.sim.y[0];
    const k = Math.min((H - 50) / L, (W / 2 - 30) / L);
    const px = W / 2, py = 24;
    const bx = px + L * k * Math.sin(th), by = py + L * k * Math.cos(th);
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    const th0 = S.sim.params.angle * Math.PI / 180;
    ctx.beginPath(); ctx.arc(px, py, L * k, Math.PI / 2 - th0, Math.PI / 2 + th0); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(px - 40, py); ctx.lineTo(px + 40, py); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(bx, by, 11, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  }
  function drawSpring(ink, dim, acc, line) {
    const x = S.sim.y[0], x0 = S.sim.params.stretch;
    const span = REST + x0 * 1.25 + 0.6;
    const k = (W - 70) / span;
    const wall = 30, cy = H / 2, bw = 0.5 * k, bh = Math.min(90, H * 0.3);
    const bx = wall + (REST + x) * k;
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(wall + REST * k + bw / 2, cy - bh); ctx.lineTo(wall + REST * k + bw / 2, cy + bh); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = dim; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(wall, cy - bh); ctx.lineTo(wall, cy + bh); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(wall, cy);
    const n = 14, len = bx - wall;
    for (let i = 1; i <= n; i++) ctx.lineTo(wall + len * (i / (n + 1)), cy + (i % 2 ? -1 : 1) * 16);
    ctx.lineTo(bx, cy); ctx.stroke();
    ctx.fillStyle = ink; ctx.fillRect(bx, cy - bw / 2, bw, bw);
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(wall, cy + bw / 2 + 8); ctx.lineTo(W - 20, cy + bw / 2 + 8); ctx.stroke();
  }

  /* ---------- the loop ---------- */
  function frame(now) {
    S.raf = 0;
    if (dead) return;
    if (S.running) {
      const dt = S.last ? (now - S.last) / 1000 : 0;
      S.last = now;
      if (P.advance(S.sim, dt * S.speed)) {
        if (S.sim.status === 'landed') { S.running = false; paintPlay(); }
        paint();
      }
    } else S.last = 0;
    S.raf = requestAnimationFrame(frame);
  }
  S.raf = requestAnimationFrame(frame);

  on(window, 'keydown', e => {
    if (!win.el.classList.contains('is-active') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName) && e.key === ' ') return;
    if (/^(TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'r' || e.key === 'R') { if (document.activeElement?.tagName !== 'INPUT') resetSim(); }
  });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) size(); }); ro.observe(canvas); }
  paintTabs(); paintSliders();
  S.sim = P.create(S.scene, S.params[S.scene]);
  S.preview = P.run(P.create('projectile', S.params.projectile), 200);
  paintPlay();
  size();
  win.setSubtitle(`— ${P.SCENES[S.scene].name}`);

  return () => {
    dead = true;
    S.running = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
    offs.splice(0).forEach(f => f());
  };
}
