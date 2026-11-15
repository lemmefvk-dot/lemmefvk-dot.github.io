/* ============================================================
   physics.js — Physics Sandbox: a projectile, a pendulum, a mass on
   a spring, a block on a slope with friction, two carts colliding,
   and a planet round a star, with sliders for the real variables.

   The motion is worked out by js/core/physics.js: fixed-step RK4 at
   1/240 s, so a run gives the same numbers on a slow screen and a
   fast one. This window only draws it and shows what was measured
   (heights, landings, swing periods, the bottom of the slope, the
   carts' speeds after they part, an orbit's period and size come from
   the stepped motion; the textbook formula is printed beside them for
   comparison, and only where it applies). What each scene leaves out
   is written under the sliders.

   Under the scene a live graph plots any logged quantity against time
   — only the stepped motion's own log, never a formula — with the last
   run as a faint ghost; "Send to Sheets" writes that log as a CSV into
   ~/Documents and opens it in Static Sheets. Energy bars show where
   the energy is. Slider settings can be kept as named presets (in the
   store, per person). "Save picture" puts the scene into ~/Pictures.
   The projectile can aim at a target and says whether it hit.

   Changing a slider puts the scene back at the start. Space starts
   and pauses, R resets.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import * as media from '../core/media.js';
import * as P from '../core/physics.js';

const SCENE_ORDER = ['projectile', 'pendulum', 'spring', 'incline', 'collision', 'orbit'];
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const REST = 2;                        /* the spring's natural length on screen, m */
const PRESETS_KEY = 'portal.physics.presets';
const GRAPH_DEFAULT = { projectile: 'y', pendulum: 'angle', spring: 'x', incline: 'v', collision: 'v1', orbit: 'r' };

const CSS = `
.ph{flex:1;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--ink-1);font-size:var(--fs-13)}
.ph *{box-sizing:border-box}
.ph__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.ph__tabs{display:flex;flex-wrap:wrap;gap:var(--sp-2)}
.ph__tabs button,.ph__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.ph__tabs button[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.ph__btn--go{background:var(--fill-3);color:var(--ink-0);font-weight:600;min-width:92px}
.ph__btn:hover,.ph__tabs button:hover{background:var(--fill-2)}
.ph__btn--sm{height:26px;padding:0 var(--sp-3);font-size:var(--fs-12)}
.ph__sp{flex:1}
.ph__speed{display:flex;align-items:center;gap:var(--sp-2);color:var(--ink-2)}
.ph select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit}
.ph__main{flex:1;min-height:0;display:flex;gap:var(--sp-4);padding:var(--sp-4);overflow:auto}
.ph__left{flex:1 1 360px;min-width:240px;display:flex;flex-direction:column;gap:var(--sp-3)}
.ph__stage{flex:1 1 auto;min-height:220px;position:relative;border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);overflow:hidden}
.ph__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ph__graph{flex:0 0 auto;display:flex;flex-direction:column;gap:var(--sp-2)}
.ph__gbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2)}
.ph__gbar label{display:flex;align-items:center;gap:var(--sp-2);color:var(--ink-2)}
.ph__gwrap{position:relative;height:150px;border-radius:var(--r-md);border:1px solid var(--line-1);background:var(--fill-0);overflow:hidden}
.ph__gwrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ph__side{flex:0 0 300px;display:flex;flex-direction:column;gap:var(--sp-4);min-width:0;overflow:auto}
@media (max-width:760px){.ph__side{flex-basis:100%}}
.ph__sl{display:grid;grid-template-columns:1fr auto;gap:2px var(--sp-3);align-items:center}
.ph__sl label{color:var(--ink-2)}
.ph__sl output{font-variant-numeric:tabular-nums;color:var(--ink-0);font-weight:600}
.ph__sl input{grid-column:1/3;width:100%;accent-color:var(--accent)}
.ph__sliders{display:flex;flex-direction:column;gap:var(--sp-3)}
.ph__row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2)}
.ph__row select{flex:1 1 120px;min-width:0}
.ph__in{width:72px;height:28px;padding:0 var(--sp-2);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit}
.ph h3{margin:0;font-size:var(--fs-11);color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em}
.ph__meas{display:grid;grid-template-columns:auto 1fr;gap:4px var(--sp-4);margin:0;font-variant-numeric:tabular-nums}
.ph__meas dt{color:var(--ink-3)}
.ph__meas dd{margin:0;color:var(--ink-0);overflow-wrap:anywhere}
.ph__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5}
.ph__hit{margin:0;font-weight:600}
.ph__hit[data-hit=yes]{color:#2bb673}
.ph__hit[data-hit=no]{color:#f2994a}
.ph__bars{display:flex;flex-direction:column;gap:var(--sp-2)}
.ph__barrow{display:grid;grid-template-columns:1fr auto;gap:2px var(--sp-3);font-size:var(--fs-12)}
.ph__barrow span{color:var(--ink-2)}
.ph__barrow b{font-variant-numeric:tabular-nums;color:var(--ink-0);font-weight:600}
.ph__track{grid-column:1/3;height:8px;border-radius:4px;background:var(--fill-2);overflow:hidden}
.ph__fill{height:100%;border-radius:4px;background:var(--accent);width:0}
.ph__fill.is-neg{background:#9b6cf6}
.ph__fill.is-lost{background:#f2994a}
`;

const css = (el, name, fallback) => (getComputedStyle(el).getPropertyValue(name).trim() || fallback);
const num = (n, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : String(Math.round(n * 10 ** d) / 10 ** d));
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

defineApp({
  id: 'physics',
  name: 'Physics Sandbox',
  icon: 'activity',
  g1: '#7bd0ff', g2: '#3a4fd6',
  category: 'Utilities',
  keywords: ['physics', 'projectile', 'pendulum', 'spring', 'gravity', 'simulation', 'science', 'school', 'motion', 'launch', 'oscillation', 'period', 'drag',
    'friction', 'incline', 'slope', 'collision', 'momentum', 'energy', 'orbit', 'planet', 'kepler', 'graph', 'target'],
  desc: 'Launch projectiles, swing pendulums, bounce springs, slide blocks down slopes, collide carts and send planets round stars, with live graphs',
  win: { w: 980, h: 700, minW: 520, minH: 460 },
  shortcuts: [['Space', 'Start or pause'], ['R', 'Reset to the start']],
  mount({ root, win, api }) { return build(root, win, api); },
});

function build(root, win, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'activity', extra) => api.notify({ app: 'Physics Sandbox', icon, title, message, timeout: 5000, ...(extra || {}) });
  const S = { scene: 'projectile', params: {}, sim: null, running: false, speed: 1, preview: null, last: 0, raf: 0, ghost: {}, showGhost: true, q: { ...GRAPH_DEFAULT }, target: { on: false, x: 30, w: 2 } };
  for (const k of SCENE_ORDER) S.params[k] = P.defaults(k);

  const canvas = h('canvas', { role: 'img', 'aria-label': 'The simulation', tabindex: '0', dataset: { fk: 'phys-canvas' } });
  const gcanvas = h('canvas', { role: 'img', 'aria-label': 'Graph', dataset: { fk: 'phys-graph' } });
  const tabs = h('div.ph__tabs', { role: 'group', 'aria-label': 'Scenes' });
  const play = h('button.ph__btn.ph__btn--go', { type: 'button', dataset: { fk: 'phys-play' }, onclick: () => toggle() });
  const reset = h('button.ph__btn', { type: 'button', dataset: { fk: 'phys-reset' }, onclick: () => resetSim() }, h('span', { text: 'Reset' }));
  const speed = h('select', { 'aria-label': 'Simulation speed', dataset: { fk: 'phys-speed' }, onchange: e => { S.speed = Number(e.target.value); } },
    SPEEDS.map(v => h('option', { value: v, text: `${v}×`, selected: v === 1 })));
  const sliders = h('div.ph__sliders', { dataset: { fk: 'phys-sliders' } });
  const meas = h('dl.ph__meas', { 'aria-live': 'off', dataset: { fk: 'phys-meas' } });
  const compare = h('div.ph__note', { role: 'status', dataset: { fk: 'phys-compare' } });
  const note = h('p.ph__note', { dataset: { fk: 'phys-note' } });
  const bars = h('div.ph__bars', { dataset: { fk: 'phys-bars' } });
  const presetSel = h('select', { 'aria-label': 'Presets', dataset: { fk: 'phys-preset' }, onchange: e => applyPreset(e.target.value) });
  const presetDel = h('button.ph__btn.ph__btn--sm', { type: 'button', dataset: { fk: 'phys-preset-del' }, onclick: () => deletePreset() }, h('span', { text: 'Delete' }));
  const presetSave = h('button.ph__btn.ph__btn--sm', { type: 'button', dataset: { fk: 'phys-preset-save' }, onclick: () => savePreset() }, h('span', { text: 'Save as preset…' }));
  const targetOn = h('input', { type: 'checkbox', dataset: { fk: 'phys-target' }, onchange: e => { S.target.on = e.target.checked; paint(); } });
  const targetX = h('input.ph__in', { type: 'number', step: '0.5', min: '0', value: String(S.target.x), 'aria-label': 'Target distance (m)', dataset: { fk: 'phys-target-x' }, oninput: e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 1000) { S.target.x = v; paint(); } } });
  const targetW = h('input.ph__in', { type: 'number', step: '0.5', min: '0.5', value: String(S.target.w), 'aria-label': 'Target width (m)', dataset: { fk: 'phys-target-w' }, oninput: e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.1 && v <= 100) { S.target.w = v; paint(); } } });
  const hitEl = h('p.ph__hit', { role: 'status', dataset: { fk: 'phys-hit' } });
  const targetBox = h('div', { dataset: { fk: 'phys-targetbox' } },
    h('h3', { text: 'Target' }),
    h('div.ph__row', h('label', targetOn, h('span', { text: ' Aim at a target' })), h('label', h('span', { text: 'at ' }), targetX, h('span', { text: ' m' })), h('label', h('span', { text: 'width ' }), targetW, h('span', { text: ' m' }))),
    hitEl);
  const graphQ = h('select', { 'aria-label': 'Quantity to graph', dataset: { fk: 'phys-graph-q' }, onchange: e => { S.q[S.scene] = e.target.value; paintGraph(); } });
  const ghostOn = h('input', { type: 'checkbox', checked: true, dataset: { fk: 'phys-ghost' }, onchange: e => { S.showGhost = e.target.checked; paint(); } });
  const el = h('div.ph', h('style', { text: CSS }),
    h('div.ph__bar', tabs, play, reset, h('span.ph__sp'), h('label.ph__speed', h('span', { text: 'Speed' }), speed)),
    h('div.ph__main',
      h('div.ph__left',
        h('div.ph__stage', canvas),
        h('div.ph__graph',
          h('div.ph__gbar',
            h('label', h('span', { text: 'Graph' }), graphQ),
            h('label', ghostOn, h('span', { text: 'Ghost of the last run' })),
            h('span.ph__sp'),
            h('button.ph__btn.ph__btn--sm', { type: 'button', title: 'Write the run as a CSV in Documents and open it in Static Sheets', dataset: { fk: 'phys-sheets' }, onclick: () => sendToSheets() }, h('span', { text: 'Send to Sheets' })),
            h('button.ph__btn.ph__btn--sm', { type: 'button', title: 'Save a picture of the scene into Pictures', dataset: { fk: 'phys-pic' }, onclick: () => savePicture() }, h('span', { text: 'Save picture' }))),
          h('div.ph__gwrap', gcanvas))),
      h('div.ph__side',
        h('h3', { text: 'Variables' }), sliders,
        h('div.ph__row', presetSel, presetSave, presetDel),
        targetBox,
        h('h3', { text: 'Measured' }), meas, compare,
        h('h3', { text: 'Energy' }), bars,
        note)));
  root.appendChild(el);

  /* ---------- scene and controls ---------- */
  function paintTabs() {
    tabs.replaceChildren(...SCENE_ORDER.map(k => h('button', { type: 'button', 'aria-pressed': String(S.scene === k), dataset: { scene: k }, onclick: () => setScene(k) }, h('span', { text: P.SCENES[k].name }))));
  }
  function paintSliders() {
    sliders.replaceChildren(...P.SCENES[S.scene].sliders.map(sl => {
      const out = h('output', { dataset: { fk: 'phys-val', key: sl.key } });
      const id = `ph-${S.scene}-${sl.key}`;
      const inp = h('input', { type: 'range', id, min: sl.min, max: sl.max, step: sl.step, value: S.params[S.scene][sl.key], 'aria-label': `${sl.label}${sl.unit ? ` (${sl.unit})` : ''}`, dataset: { fk: 'phys-slider', key: sl.key },
        oninput: e => { S.params[S.scene][sl.key] = Number(e.target.value); out.textContent = `${num(Number(e.target.value), 3)} ${sl.unit}`.trim(); presetSel.value = ''; resetSim(); } });
      out.textContent = `${num(S.params[S.scene][sl.key], 3)} ${sl.unit}`.trim();
      return h('div.ph__sl', h('label', { for: id, text: sl.label }), out, inp);
    }));
    note.textContent = P.NOTES[S.scene];
    targetBox.hidden = S.scene !== 'projectile';
    graphQ.replaceChildren(...S.sim.cols.slice(1).map(([k, label, unit]) => h('option', { value: k, text: unit ? `${label} (${unit})` : label, selected: k === S.q[S.scene] })));
    paintPresets();
  }
  /* a run that went anywhere becomes the ghost to compare the next one with */
  function keepGhost() { if (S.sim && S.sim.t > 0) S.ghost[S.sim.scene] = { trail: S.sim.trail ? S.sim.trail.slice() : null, log: S.sim.log.slice(), cols: S.sim.cols }; }
  function setScene(k) {
    keepGhost();
    S.scene = k;
    S.sim = P.create(k, S.params[k]);
    paintTabs();
    paintSliders();
    resetSim();
    win.setSubtitle(`— ${P.SCENES[k].name}`);
  }
  function resetSim() {
    keepGhost();
    S.sim = P.create(S.scene, S.params[S.scene]);
    S.running = false;
    /* the faint line of where the projectile will go: the same integrator, run ahead */
    S.preview = S.scene === 'projectile' ? P.run(P.create('projectile', S.params.projectile), 200) : null;
    paintPlay();
    paint();
  }
  function paintPlay() {
    const s = S.sim;
    const done = s.done;
    play.textContent = done ? (S.scene === 'projectile' ? 'Launch again' : 'Run again') : S.running ? 'Pause' : s.t > 0 ? 'Resume' : S.scene === 'projectile' ? 'Launch' : 'Start';
    play.dataset.state = done ? 'done' : S.running ? 'running' : s.t > 0 ? 'paused' : 'ready';
  }
  function toggle() {
    if (S.sim.done) { resetSim(); S.running = !S.sim.done; }
    else S.running = !S.running;
    S.last = 0;
    paintPlay();
  }

  /* ---------- presets: named slider settings, kept per person ---------- */
  const allPresets = () => { const v = api.store.get(PRESETS_KEY, null); return v && typeof v === 'object' ? v : {}; };
  const scenePresets = () => (Array.isArray(allPresets()[S.scene]) ? allPresets()[S.scene] : []).filter(x => x && typeof x.name === 'string');
  function paintPresets() {
    const mine = scenePresets();
    presetSel.replaceChildren(
      h('option', { value: '', text: mine.length || S.scene === 'orbit' ? 'Presets…' : 'No presets yet' }),
      mine.length ? h('optgroup', { label: 'Saved' }, mine.map((x, i) => h('option', { value: `mine:${i}`, text: x.name }))) : null,
      S.scene === 'orbit' ? h('optgroup', { label: 'Planets (mean distance, round orbit)' }, P.PLANETS.map(([nm, au]) => h('option', { value: `planet:${nm}`, text: `${nm} (${au} AU)` }))) : null);
    presetDel.disabled = !presetSel.value.startsWith('mine:');
  }
  function applyPreset(v) {
    presetDel.disabled = !v.startsWith('mine:');
    let params = null;
    if (v.startsWith('mine:')) params = (scenePresets()[Number(v.slice(5))] || {}).params;
    else if (v.startsWith('planet:')) { const p = P.PLANETS.find(x => x[0] === v.slice(7)); if (p) params = { mass: 1, distance: p[1], speed: 1 }; }
    if (!params) return;
    S.params[S.scene] = P.clampParams(S.scene, params);
    const keep = presetSel.value;
    paintSliders();
    presetSel.value = keep;
    presetDel.disabled = !keep.startsWith('mine:');
    resetSim();
  }
  async function savePreset() {
    const input = h('input', { type: 'text', maxlength: '40', placeholder: 'e.g. Moon gravity', 'aria-label': 'Preset name', dataset: { fk: 'phys-preset-name' } });
    const name = await api.confirm({
      title: 'Save these settings', message: `The ${P.SCENES[S.scene].name.toLowerCase()} sliders as they are now, under a name. Presets are kept for you on this device.`,
      body: h('label.field', input), ok: 'Save',
      validate: () => (input.value.trim() ? '' : 'Give it a name.'), collect: () => input.value.trim(),
    });
    if (!name || name === true || dead) return;
    const all = allPresets();
    const list = (Array.isArray(all[S.scene]) ? all[S.scene] : []).filter(x => x && x.name !== name).slice(-29);
    list.push({ name: name.slice(0, 40), params: { ...S.params[S.scene] } });
    api.store.set(PRESETS_KEY, { ...all, [S.scene]: list });
    paintPresets();
    presetSel.value = `mine:${list.length - 1}`;
    presetDel.disabled = false;
    say('Preset saved', `“${name}” for the ${P.SCENES[S.scene].name.toLowerCase()}.`, 'check');
  }
  function deletePreset() {
    const v = presetSel.value;
    if (!v.startsWith('mine:')) return;
    const all = allPresets();
    const list = scenePresets().filter((_, i) => i !== Number(v.slice(5)));
    api.store.set(PRESETS_KEY, { ...all, [S.scene]: list });
    paintPresets();
  }

  /* ---------- measured values ---------- */
  function row(key, label, value, raw) {
    return [h('dt', { text: label }), h('dd', { dataset: { fk: 'phys-m', k: key, raw: raw === undefined || raw === null || !Number.isFinite(raw) ? '' : String(raw) }, text: value })];
  }
  const vs = (m, f, d, unit) => `${num(m, d)} ${unit} (formula ${num(f, d)} ${unit})`;
  function paintMeasured() {
    const m = S.sim.measured();
    const rows = [];
    const add = (...a) => rows.push(...row(...a));
    add('t', 'Time', S.scene === 'orbit' ? `${num(m.t, 3)} years` : `${num(m.t, 2)} s`, m.t);
    let cmp = '';
    hitEl.textContent = ''; delete hitEl.dataset.hit;
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
      if (S.target.on) {
        if (m.range === null) hitEl.textContent = `Target: ${num(S.target.x, 2)} m, ${num(S.target.w, 2)} m wide.`;
        else {
          const off = m.range - S.target.x, hit = Math.abs(off) <= S.target.w / 2;
          hitEl.dataset.hit = hit ? 'yes' : 'no';
          hitEl.dataset.off = String(off);
          hitEl.textContent = hit ? `Hit! It landed ${num(Math.abs(off), 2)} m from the middle of the target.` : `Missed: it landed ${num(Math.abs(off) - S.target.w / 2, 2)} m ${off < 0 ? 'short of' : 'past'} the target.`;
        }
      }
    } else if (S.scene === 'pendulum') {
      add('angle', 'Angle', `${num(m.angle, 1)}°`, m.angle);
      add('speed', 'Bob speed', `${num(m.speed, 2)} m/s`, m.speed);
      add('energy', 'Energy per kg', `${num(m.energy, 3)} J/kg`, m.energy);
      add('period', 'Measured period', m.period === null ? 'measuring…' : `${num(m.period, 4)} s`, m.period);
      add('smallAngle', 'Small-angle formula', `${num(m.smallAnglePeriod, 4)} s`, m.smallAnglePeriod);
      if (m.exactPeriod !== null) add('exactPeriod', 'Exact for this amplitude', `${num(m.exactPeriod, 4)} s`, m.exactPeriod);
      cmp = 'Small-angle formula 2π√(L/g) assumes a tiny swing; it is close below about 10° and drifts high of the true period at large angles. The period is timed between upward crossings of the bottom, so it appears after two crossings (about 1.75 swings).';
    } else if (S.scene === 'spring') {
      add('x', 'Stretch', `${num(m.x, 3)} m`, m.x);
      add('v', 'Velocity', `${num(m.v, 3)} m/s`, m.v);
      add('energy', 'Energy', `${num(m.energy, 4)} J`, m.energy);
      add('period', 'Measured period', m.period === null ? 'measuring…' : `${num(m.period, 4)} s`, m.period);
      add('ideal', 'Formula 2π√(m/k)', `${num(m.idealPeriod, 4)} s`, m.idealPeriod);
      if (m.dampedPeriod !== null && S.sim.params.damping > 0) add('damped', 'Damped formula', `${num(m.dampedPeriod, 4)} s`, m.dampedPeriod);
      cmp = m.overdamped ? 'With this much damping the mass creeps back without oscillating, so there is no period.' : 'The formula 2π√(m/k) is for no damping; damping lengthens the period a little.';
    } else if (S.scene === 'incline') {
      const pr = S.sim.params;
      add('s', 'Distance down', `${num(m.s, 3)} m`, m.s);
      add('v', 'Speed', `${num(m.v, 3)} m/s`, m.v);
      if (!m.slides) {
        cmp = m.slips ? `It would start to slip (tan θ = ${num(m.tanTheta, 3)} is more than μs = ${num(pr.muS, 2)}), but sliding friction (μk = ${num(pr.muK, 2)}) is at least the slope’s pull, so it never gets going.`
          : `Static friction holds it: tan θ = ${num(m.tanTheta, 3)} is no more than μs = ${num(pr.muS, 2)}, so the block stays put.`;
      } else {
        add('accel', 'Measured acceleration (v ÷ t)', m.accel === null ? 'starts at rest' : `${num(m.accel, 4)} m/s²`, m.accel);
        add('formulaAccel', 'Formula g(sin θ − μk cos θ)', `${num(m.formulaAccel, 4)} m/s²`, m.formulaAccel);
        add('bottomTime', 'Time to the bottom', m.bottomTime === null ? 'sliding…' : vs(m.bottomTime, m.formulaTime, 4, 's'), m.bottomTime);
        add('bottomSpeed', 'Speed at the bottom', m.bottomSpeed === null ? 'sliding…' : vs(m.bottomSpeed, m.formulaSpeed, 4, 'm/s'), m.bottomSpeed);
        add('heat', 'Heat from friction', m.bottomTime === null ? `${num(m.heat, 3)} J` : vs(m.heat, m.formulaHeat, 3, 'J'), m.heat);
        cmp = 'The formulas (a = g(sin θ − μk cos θ), v = √(2aL), t = √(2L/a), heat = μk·m·g·cos θ·L) assume the textbook friction model the simulation uses, so they should agree closely.';
      }
    } else if (S.scene === 'collision') {
      add('v1', 'Cart 1 velocity', `${num(m.v1, 3)} m/s`, m.v1);
      add('v2', 'Cart 2 velocity', `${num(m.v2, 3)} m/s`, m.v2);
      add('p', 'Total momentum', `${num(m.p, 4)} kg·m/s (at the start ${num(m.p0, 4)})`, m.p);
      add('k', 'Total kinetic energy', `${num(m.k, 4)} J (at the start ${num(m.k0, 4)})`, m.k);
      if (!m.meet) cmp = 'Cart 1 is not catching up with cart 2, so they never meet. Give cart 1 more speed than cart 2.';
      else if (m.v1After === null) cmp = m.touching ? 'The bumpers are touching…' : 'Waiting for the carts to meet.';
      else {
        add('v1After', 'Cart 1 after', vs(m.v1After, m.formulaV1, 4, 'm/s'), m.v1After);
        add('v2After', 'Cart 2 after', vs(m.v2After, m.formulaV2, 4, 'm/s'), m.v2After);
        add('eMeasured', 'Bounce measured (e)', `${num(m.eMeasured, 4)} (set to ${num(S.sim.params.e, 2)})`, m.eMeasured);
        add('lost', 'Kinetic energy lost', vs(m.lost, m.formulaLost, 4, 'J'), m.lost);
        if (m.duration !== null) add('duration', 'Contact lasted', `${num(m.duration, 4)} s`, m.duration);
        cmp = 'Formulas: v₁′ = (m₁u₁ + m₂u₂ + m₂e(u₂ − u₁)) ÷ (m₁ + m₂), v₂′ likewise, and the loss ½·μ·(1 − e²)·(u₁ − u₂)² with μ = m₁m₂ ÷ (m₁ + m₂). Momentum stays the same because the carts push each other equally and oppositely.';
      }
    } else {
      add('r', 'Distance from the star', `${num(m.r, 4)} AU`, m.r);
      add('speed', 'Speed', `${num(m.speed, 3)} AU/year`, m.speed);
      add('orbits', 'Orbits completed', String(m.orbits), m.orbits);
      add('period', 'Measured period T', m.period === null ? 'measuring…' : `${num(m.period, 4)} years`, m.period);
      add('a', 'Measured semi-major axis a', m.a === null ? 'after one orbit' : `${num(m.a, 4)} AU`, m.a);
      add('e', 'Measured eccentricity', m.e === null ? 'after one orbit' : num(m.e, 4), m.e);
      add('kepler', 'Kepler’s third law √(a³ ÷ M)', m.kepler === null ? 'after one orbit' : `${num(m.kepler, 4)} years`, m.kepler);
      add('ratio', 'T² ÷ a³', m.ratio === null ? 'after one orbit' : `${num(m.ratio, 4)} (Kepler: 1 ÷ M = ${num(m.ratioFormula, 4)})`, m.ratio);
      cmp = 'a is half the nearest plus the farthest distance seen in a whole orbit, and T the time between passes of the starting line, both from the stepped motion. Kepler’s third law says T² = a³ ÷ M in these units, whatever the shape of the orbit.';
    }
    meas.replaceChildren(...rows);
    compare.textContent = cmp;
    canvas.setAttribute('aria-label', `${P.SCENES[S.scene].name} simulation, time ${num(m.t, 2)} ${S.scene === 'orbit' ? 'years' : 'seconds'}`);
  }
  /* where the energy is: from the stepped state */
  function paintBars() {
    const E = S.sim.energies();
    const scale = Math.max(Math.abs(E.start), ...E.bars.map(b => Math.abs(b[2]))) || 1;
    const sig = E.bars.map(b => b[0]).join();
    if (bars.dataset.sig !== sig) {
      bars.dataset.sig = sig;
      bars.replaceChildren(...E.bars.map(([k, label]) => h('div.ph__barrow', { dataset: { fk: 'phys-bar', k } }, h('span', { text: label }), h('b'), h('div.ph__track', h('div.ph__fill', { class: k === 'lost' ? 'is-lost' : '' })))),
        h('p.ph__note', { dataset: { fk: 'phys-bar-note' } }));
    }
    for (const [k, , v] of E.bars) {
      const rowEl = bars.querySelector(`[data-k="${k}"]`);
      const shown = Math.abs(v) < 1e-9 * scale ? 0 : v;
      rowEl.dataset.raw = String(shown);
      rowEl.querySelector('b').textContent = `${num(shown, 3)} ${E.unit}`;
      const fill = rowEl.querySelector('.ph__fill');
      fill.style.width = `${Math.min(100, Math.abs(shown) / scale * 100)}%`;
      fill.classList.toggle('is-neg', shown < 0);
    }
    bars.querySelector('[data-fk="phys-bar-note"]').textContent = E.signed
      ? 'Potential energy round a star is below zero; a planet whose total is below zero stays in orbit.'
      : `At the start: ${num(E.start, 3)} ${E.unit}. The bars always add up to that.`;
  }

  /* ---------- drawing ---------- */
  let W = 0, H = 0, dpr = 1, GW = 0, GH = 0;
  const ctx = canvas.getContext('2d');
  const gctx = gcanvas.getContext('2d');
  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const g = gcanvas.getBoundingClientRect();
    GW = Math.max(1, Math.round(g.width)); GH = Math.max(1, Math.round(g.height));
    gcanvas.width = Math.round(GW * dpr); gcanvas.height = Math.round(GH * dpr);
    paint();
  }
  function paint() {
    if (!ctx || !S.sim) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = css(el, '--ink-0', '#eee'), dim = css(el, '--ink-3', '#888'), acc = css(el, '--accent', '#6af'), line = css(el, '--line-2', '#555');
    ctx.lineWidth = 2; ctx.font = '12px system-ui, sans-serif';
    const ghost = S.showGhost ? S.ghost[S.scene] : null;
    if (S.scene === 'projectile') drawProjectile(ink, dim, acc, line, ghost);
    else if (S.scene === 'pendulum') drawPendulum(ink, dim, acc, line, ghost);
    else if (S.scene === 'spring') drawSpring(ink, dim, acc, line);
    else if (S.scene === 'incline') drawIncline(ink, dim, acc, line);
    else if (S.scene === 'collision') drawCollision(ink, dim, acc, line);
    else drawOrbit(ink, dim, acc, line, ghost);
    paintMeasured();
    paintBars();
    paintGraph();
  }
  const ghostStroke = dim => { ctx.strokeStyle = dim; ctx.globalAlpha = 0.7; ctx.setLineDash([2, 4]); ctx.lineWidth = 2; };
  const ghostEnd = () => { ctx.globalAlpha = 1; ctx.setLineDash([]); };
  function drawProjectile(ink, dim, acc, line, ghost) {
    const pv = S.preview, sim = S.sim;
    const gt = ghost && ghost.trail ? ghost.trail : [];
    const tx = S.target.on ? S.target.x + S.target.w / 2 : 0;
    const xs = Math.max(pv.range || 0, sim.y[0], tx, ...gt.map(p => p[0]), 1), ys = Math.max(pv.maxHeight, sim.maxHeight, ...gt.map(p => p[1]), 1);
    const padL = 36, padB = 28, padT = 14, padR = 14;
    const k = Math.min((W - padL - padR) / xs, (H - padB - padT) / ys);
    const X = x => padL + x * k, Y = y => H - padB - y * k;
    ctx.strokeStyle = line; ctx.fillStyle = dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL, padT); ctx.stroke();
    /* ticks: a round step of about 80 px */
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => s * k >= 70) || 500;
    for (let x = 0; x <= xs + 1e-9; x += step) { ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(0) + 4); ctx.stroke(); ctx.fillText(`${x} m`, X(x) - 8, Y(0) + 17); }
    for (let y = step; y <= ys + 1e-9; y += step) { ctx.beginPath(); ctx.moveTo(padL - 4, Y(y)); ctx.lineTo(padL, Y(y)); ctx.stroke(); ctx.fillText(`${y}`, 4, Y(y) + 4); }
    if (S.target.on) {
      ctx.fillStyle = 'rgba(43,182,115,.35)'; ctx.fillRect(X(S.target.x - S.target.w / 2), Y(0) - 5, S.target.w * k, 10);
      ctx.strokeStyle = '#2bb673'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(S.target.x), Y(0)); ctx.lineTo(X(S.target.x), Y(0) - 22); ctx.stroke();
      ctx.fillStyle = '#2bb673'; ctx.beginPath(); ctx.moveTo(X(S.target.x), Y(0) - 22); ctx.lineTo(X(S.target.x) + 12, Y(0) - 17); ctx.lineTo(X(S.target.x), Y(0) - 12); ctx.fill();
    }
    /* the last run, the preview, then the real trail */
    if (gt.length > 1) { ghostStroke(dim); ctx.beginPath(); gt.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke(); ghostEnd(); }
    ctx.setLineDash([5, 5]); ctx.strokeStyle = dim; ctx.lineWidth = 1.5; ctx.beginPath();
    pv.trail.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = acc; ctx.lineWidth = 2.5; ctx.beginPath();
    sim.trail.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.lineTo(X(sim.y[0]), Y(sim.y[1])); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(X(sim.y[0]), Y(sim.y[1]), 6, 0, Math.PI * 2); ctx.fill();
  }
  function drawPendulum(ink, dim, acc, line, ghost) {
    const L = S.sim.params.length, th = S.sim.y[0];
    const k = Math.min((H - 50) / L, (W / 2 - 30) / L);
    const px = W / 2, py = 24;
    const bx = px + L * k * Math.sin(th), by = py + L * k * Math.cos(th);
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    const th0 = S.sim.params.angle * Math.PI / 180;
    ctx.beginPath(); ctx.arc(px, py, L * k, Math.PI / 2 - th0, Math.PI / 2 + th0); ctx.stroke(); ctx.setLineDash([]);
    if (ghost && ghost.trail && ghost.trail.length > 1) { ghostStroke(dim); ctx.beginPath(); ghost.trail.forEach(([x, y], i) => (i ? ctx.lineTo(px + x * k, py - y * k) : ctx.moveTo(px + x * k, py - y * k))); ctx.stroke(); ghostEnd(); }
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
  function drawIncline(ink, dim, acc, line) {
    const p = S.sim.params, th = p.angle * Math.PI / 180, L = p.length, s = S.sim.y[0];
    const run = L * Math.cos(th), rise = L * Math.sin(th);
    const k = Math.min((W - 80) / run, (H - 70) / rise);
    const x0 = 40, yb = H - 30;                   /* the bottom of the slope is at the right */
    const top = [x0, yb - rise * k], bot = [x0 + run * k, yb];
    ctx.fillStyle = 'rgba(127,127,127,.18)'; ctx.strokeStyle = line; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...bot); ctx.lineTo(x0, yb); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, yb); ctx.lineTo(W - 10, yb); ctx.stroke();
    ctx.fillStyle = dim; ctx.fillText(`${num(p.angle, 0)}°`, bot[0] - 46, yb - 8);
    ctx.beginPath(); ctx.arc(bot[0], bot[1], 28, Math.PI, Math.PI + th); ctx.stroke();
    /* the block, sitting on the slope */
    const bx = top[0] + s * Math.cos(th) * k, by = top[1] + s * Math.sin(th) * k, size = Math.max(14, Math.min(40, 0.5 * k));
    ctx.save(); ctx.translate(bx, by); ctx.rotate(th);
    ctx.fillStyle = ink; ctx.fillRect(-size / 2, -size, size, size);
    ctx.restore();
    ctx.fillStyle = acc; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${num(s, 2)} m of ${num(L, 1)} m`, 12, 18);
  }
  function drawCollision(ink, dim, acc, line) {
    const [x1, v1, x2, v2] = S.sim.y, p = S.sim.params;
    const lo = -1, hi = 13, k = (W - 20) / (hi - lo), X = x => 10 + (x - lo) * k, ty = H * 0.6;
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
    ctx.fillStyle = dim; for (let x = 0; x <= 12; x += 2) { ctx.fillRect(X(x), ty, 1, 6); ctx.fillText(`${x} m`, X(x) - 8, ty + 20); }
    const cart = (x, m, v, label, col) => {
      const w = P.CART * k, hh = Math.max(16, Math.min(60, 12 + 6 * Math.sqrt(m) * 4));
      ctx.fillStyle = col; ctx.fillRect(X(x) - w / 2, ty - hh - 2, w, hh);
      ctx.fillStyle = '#000'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.fillText(label, X(x) - 4, ty - hh / 2 + 2);
      ctx.font = '12px system-ui, sans-serif';
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(x), ty - hh - 12); ctx.lineTo(X(x) + v * 14, ty - hh - 12); ctx.stroke();
      ctx.fillStyle = dim; ctx.fillText(`${num(v, 2)} m/s`, X(x) - 18, ty - hh - 18);
    };
    cart(x1, p.m1, v1, '1', acc);
    cart(x2, p.m2, v2, '2', ink);
  }
  function drawOrbit(ink, dim, acc, line, ghost) {
    const p = S.sim.params, GM = 4 * Math.PI * Math.PI * p.mass, v0 = p.speed * Math.sqrt(GM / p.distance);
    /* the drawing's scale only: how far this orbit reaches, from its energy */
    const a = 1 / (2 / p.distance - v0 * v0 / GM), far = Math.max(p.distance, 2 * a - p.distance, S.sim.rmax);
    const gt = ghost && ghost.trail ? ghost.trail : [];
    const reach = Math.max(far, ...gt.map(q => Math.hypot(q[0], q[1])));
    const k = (Math.min(W, H) / 2 - 18) / reach, cx = W / 2, cy = H / 2;
    const X = x => cx + x * k, Y = y => cy - y * k;
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(W - 4, cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = dim; ctx.fillText('1 AU', X(1) - 12, cy + 16); ctx.fillRect(X(1), cy - 3, 1, 6);
    if (gt.length > 1) { ghostStroke(dim); ctx.beginPath(); gt.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke(); ghostEnd(); }
    const tr = S.sim.trail;
    ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath();
    tr.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.lineTo(X(S.sim.y[0]), Y(S.sim.y[1])); ctx.stroke();
    ctx.fillStyle = '#f5c542'; ctx.beginPath(); ctx.arc(cx, cy, 9 + Math.sqrt(p.mass) * 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(X(S.sim.y[0]), Y(S.sim.y[1]), 5, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- the live graph: one logged quantity against time ---------- */
  function paintGraph() {
    if (!gctx || !S.sim) return;
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, GW, GH);
    const cols = S.sim.cols, q = S.q[S.scene];
    const ci = Math.max(1, cols.findIndex(c => c[0] === q));
    const [, label, unit] = cols[ci];
    const ghost = S.showGhost ? S.ghost[S.scene] || null : null;
    const gi = ghost ? ghost.cols.findIndex(c => c[0] === q) : -1;
    const series = [S.sim.log, ...(ghost && gi > 0 ? [ghost.log] : [])];
    let t0 = Infinity, t1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    series.forEach((lg, s) => { const idx = s === 0 ? ci : gi; for (const r of lg) { if (r[0] < t0) t0 = r[0]; if (r[0] > t1) t1 = r[0]; if (r[idx] < y0) y0 = r[idx]; if (r[idx] > y1) y1 = r[idx]; } });
    const ink = css(el, '--ink-2', '#aaa'), dim = css(el, '--ink-3', '#888'), acc = css(el, '--accent', '#6af'), line = css(el, '--line-2', '#555');
    gctx.font = '11px system-ui, sans-serif'; gctx.fillStyle = ink;
    gcanvas.setAttribute('aria-label', `Graph of ${label.toLowerCase()} against time`);
    if (!(t1 > t0)) { gctx.fillText(`${label}${unit ? ` (${unit})` : ''} against time appears here as it runs.`, 10, GH / 2); return; }
    if (y1 - y0 < 1e-12) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
    const L = 46, R = 8, T = 8, B = 18;
    const X = t => L + (t - t0) / (t1 - t0) * (GW - L - R), Y = v => GH - B - (v - y0) / (y1 - y0) * (GH - T - B);
    gctx.strokeStyle = line; gctx.lineWidth = 1;
    gctx.beginPath(); gctx.moveTo(L, T); gctx.lineTo(L, GH - B); gctx.lineTo(GW - R, GH - B); gctx.stroke();
    if (y0 < 0 && y1 > 0) { gctx.setLineDash([3, 4]); gctx.beginPath(); gctx.moveTo(L, Y(0)); gctx.lineTo(GW - R, Y(0)); gctx.stroke(); gctx.setLineDash([]); }
    gctx.fillText(num(y1 - pad, 3), 4, T + 8); gctx.fillText(num(y0 + pad, 3), 4, GH - B);
    gctx.fillText(`${num(t0, 2)}`, L, GH - 4); gctx.fillText(`${num(t1, 2)} ${S.sim.cols[0][2]}`, GW - R - 60, GH - 4);
    gctx.fillText(`${label}${unit ? ` (${unit})` : ''}`, L + 8, T + 10);
    const draw = (lg, idx) => { const stp = Math.max(1, Math.floor(lg.length / (GW * 1.5))); gctx.beginPath(); for (let i = 0; i < lg.length; i += stp) { const r = lg[i]; if (i) gctx.lineTo(X(r[0]), Y(r[idx])); else gctx.moveTo(X(r[0]), Y(r[idx])); } const r = lg[lg.length - 1]; gctx.lineTo(X(r[0]), Y(r[idx])); gctx.stroke(); };
    if (ghost && gi > 0 && ghost.log.length > 1) { gctx.strokeStyle = dim; gctx.globalAlpha = 0.7; gctx.setLineDash([2, 4]); gctx.lineWidth = 2; draw(ghost.log, gi); gctx.globalAlpha = 1; gctx.setLineDash([]); }
    if (S.sim.log.length > 1) { gctx.strokeStyle = acc; gctx.lineWidth = 2; draw(S.sim.log, ci); }
  }

  /* ---------- Sheets, Files and Pictures ---------- */
  async function sendToSheets() {
    if (!(S.sim.t > 0) || S.sim.log.length < 2) { say('Nothing to send yet', 'Run the scene first: the graph and the file come from the run itself.', 'alert'); return null; }
    const dir = `${vfs.HOME}/Documents`;
    try {
      if (!vfs.node(dir)) vfs.mkdir(dir);
      let name = `Physics ${P.SCENES[S.scene].name} ${stamp()}.csv`;
      for (let i = 2; vfs.node(`${dir}/${name}`); i++) name = `Physics ${P.SCENES[S.scene].name} ${stamp()} ${i}.csv`;
      const path = `${dir}/${name}`;
      if (!vfs.write(path, P.toCsv(S.sim))) throw new Error('Documents is not available.');
      say('Sent to Sheets', `${S.sim.log.length} rows, one every 1/60 s, saved as ~/Documents/${name}`, 'table', { actions: [{ label: 'Show in Files', onClick: () => api.openApp('files', { path: dir }) }] });
      api.openFile(path);
      return path;
    } catch (err) { say('Could not save the CSV', String(err.message || err), 'alert'); return null; }
  }
  async function savePicture() {
    try {
      const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not draw the picture.'))), 'image/png'));
      const { path } = await media.save(`${vfs.HOME}/Pictures`, `Physics ${P.SCENES[S.scene].name} ${stamp()}.png`, blob);
      if (!dead) say('Saved to Pictures', path.replace(vfs.HOME, '~'), 'image', { actions: [{ label: 'Open', onClick: () => api.openApp('photos', { path }) }] });
      return path;
    } catch (err) { say('Could not save the picture', String(err.message || err), 'alert'); return null; }
  }

  /* ---------- the loop ---------- */
  function frame(now) {
    S.raf = 0;
    if (dead) return;
    if (S.running) {
      const dt = S.last ? (now - S.last) / 1000 : 0;
      S.last = now;
      if (P.advance(S.sim, dt * S.speed)) {
        if (S.sim.done) { S.running = false; paintPlay(); }
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
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'r' || e.key === 'R') { if (document.activeElement?.tagName !== 'INPUT') resetSim(); }
  });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) size(); }); ro.observe(canvas); ro.observe(gcanvas); }
  S.sim = P.create(S.scene, S.params[S.scene]);
  paintTabs(); paintSliders();
  S.preview = P.run(P.create('projectile', S.params.projectile), 200);
  paintPlay();
  size();
  win.setSubtitle(`— ${P.SCENES[S.scene].name}`);
  root.physPeek = () => ({ scene: S.scene, running: S.running, t: S.sim.t, done: S.sim.done, rows: S.sim.log.length, cols: S.sim.cols.map(c => c[0]), ghost: Object.fromEntries(Object.entries(S.ghost).map(([k, g]) => [k, g.log.length])), params: { ...S.params[S.scene] }, target: { ...S.target }, measured: S.sim.measured(), energies: S.sim.energies(), last: S.sim.log[S.sim.log.length - 1] });

  return () => {
    dead = true;
    S.running = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
    offs.splice(0).forEach(f => f());
  };
}
