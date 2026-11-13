/* ============================================================
   arcade/jumper.js — Pixel Jumper for Static Arcade.

   Guide Pip, a small round robot with one big eye, to the beacon
   at the end of each of 20 levels in four worlds. Hold a jump for
   height, tap it for a hop; ledges forgive a few frames (coyote
   time) and an early press is remembered. Spikes, lava and pits
   send you back to the last checkpoint. Sparks are optional.

   · Run: ← → or A D · Jump: Space, ↑ or W · Restart the level: R ·
     Pause: Esc or P (the Arcade) · a controller works through the
     Arcade's key bridge · touch: on-screen buttons.
   · Level editor: paint tiles, place start and goal, test-play,
     undo and redo, keep several levels on this device, and share
     one as a link — once you've finished it (the link carries your
     winning run, so nobody opens an impossible level).
   · Reduced motion: no shake, no particles, still backdrop and
     no bobbing; the game is the same.
   · Saved on this device through the store (portal.arcadePuzzles.jumper):
     progress, best times, your levels and the editor's draft.

   The rules live in jumper-core.js (one fixed 1/60 s step, so the
   run is identical at any frame rate); this file is the screen,
   the menus, the editor and the input. Test hook: el.arcadeHook.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { FONT, coarse, surface, ownsKey, sounder, rng, prompt } from './kit.js';
import { load, save, reducedMotion } from './puzzlekit.js';
import {
  TILE, ROWS, MIN_COLS, MAX_COLS, DT, L, R, JUMP, PW, PH, MAX_SPARKS, MAX_CHECKPOINTS,
  buildLevel, blankRows, newSim, step, encodeMasks, cleanReplay, runReplay, fmtFrames,
} from './jumper-core.js';
import { LEVELS, WORLDS } from './jumper-levels.js';
import * as share from './jumper-share.js';

const GAME = 'jumper';
const MAX_MINE = 12;
const TOOLS = [
  { id: '#', label: 'Ground', key: 'ground' }, { id: '=', label: 'Platform', key: 'platform' },
  { id: '^', label: 'Spikes up', key: 'spikes' }, { id: 'v', label: 'Spikes down', key: 'spikes-down' },
  { id: '~', label: 'Lava', key: 'lava' }, { id: 'B', label: 'Spring', key: 'spring' },
  { id: 'o', label: 'Spark', key: 'spark' }, { id: 'C', label: 'Checkpoint', key: 'checkpoint' },
  { id: 'S', label: 'Start', key: 'start' }, { id: 'G', label: 'Goal', key: 'goal' },
  { id: '.', label: 'Erase', key: 'erase' },
];

/* four looks, one per world */
const THEMES = [
  { sky: ['#6fc3f2', '#e2f4ff'], far: '#a8dca0', mid: '#7cc674', rock: '#86603a', rockDark: '#6a4a2c', top: '#4fb840', topLight: '#7fe06c', plank: '#c9964f', lava: '#ff7a2a', glow: '#fff' },
  { sky: ['#140f2b', '#352a63'], far: '#2a2252', mid: '#3c3278', rock: '#3a2f6b', rockDark: '#2a2150', top: '#7a6bd8', topLight: '#a99bff', plank: '#8f7ae0', lava: '#ff6fb0', glow: '#9ff' },
  { sky: ['#2a0e0e', '#6b2514'], far: '#4a1a14', mid: '#6e2a1a', rock: '#4c3b38', rockDark: '#352825', top: '#8a5a44', topLight: '#c98a5c', plank: '#7a6a62', lava: '#ff6a12', glow: '#ffd27a' },
  { sky: ['#3a2a78', '#f6a67c'], far: '#7f64b0', mid: '#b684b8', rock: '#a99ab8', rockDark: '#857593', top: '#f1e6ff', topLight: '#fff', plank: '#e3c7a0', lava: '#ff7a2a', glow: '#fff' },
];

const css = `
.pj{position:absolute;inset:0;overflow:hidden;font-family:${FONT};color:#eef2f6;user-select:none;-webkit-user-select:none;outline:none}
.pj *{box-sizing:border-box}
.pj button{font:inherit;color:inherit}
.pj-ui{position:absolute;inset:0;pointer-events:none}
.pj-ui>*{pointer-events:auto}
.pj-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(20,24,36,.82);cursor:pointer;font-size:13px;font-weight:600;line-height:1.2}
.pj-btn:hover:not(:disabled){background:rgba(60,70,100,.9)}
.pj-btn:focus-visible,.pj-lv:focus-visible,.pj-tool:focus-visible,.pj-tch:focus-visible{outline:2px solid #ffd166;outline-offset:2px}
.pj-btn:disabled{opacity:.45;cursor:not-allowed}
.pj-btn--go{background:#1f9d8a;border-color:#4fe0c8}
.pj-btn--go:hover:not(:disabled){background:#27b8a2}
.pj-btn--danger{border-color:rgba(255,120,120,.5)}
.pj-btn svg{width:15px;height:15px}
.pj-menu{position:absolute;inset:0;overflow:auto;padding:14px 16px 22px;background:linear-gradient(180deg,#10162a,#1b2440 60%,#2b3358);pointer-events:auto}
.pj-menu h2{margin:0;font-size:22px;letter-spacing:.2px}
.pj-menu h3{margin:16px 0 2px;font-size:14px;letter-spacing:.3px}
.pj-menu p{margin:2px 0 8px;font-size:12px;opacity:.75}
.pj-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;justify-content:space-between}
.pj-row{display:flex;flex-wrap:wrap;gap:8px}
.pj-lv{position:relative;width:116px;min-height:62px;padding:7px 9px;text-align:left;border-radius:11px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);cursor:pointer;display:flex;flex-direction:column;gap:2px}
.pj-lv b{font-size:14px}
.pj-lv span{font-size:11px;opacity:.8}
.pj-lv:hover:not(:disabled){background:rgba(255,255,255,.14)}
.pj-lv.is-done{border-color:#4fe0c8;background:rgba(79,224,200,.12)}
.pj-lv:disabled{opacity:.42;cursor:not-allowed}
.pj-lv svg{position:absolute;top:7px;right:7px;width:14px;height:14px}
.pj-mine{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:7px 9px;border-radius:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);margin:5px 0}
.pj-mine b{flex:1 1 140px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-mine small{opacity:.7}
.pj-hud{position:absolute;left:0;right:0;top:0;display:flex;gap:8px;align-items:center;padding:6px 8px;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,0));pointer-events:none}
.pj-hud>*{pointer-events:auto}
.pj-hud .pj-name{flex:1;text-align:center;font-weight:700;font-size:13px;text-shadow:0 1px 2px #000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
.pj-hud .pj-stat{font-size:12px;font-weight:650;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none}
.pj-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92%,380px);padding:16px 18px;border-radius:14px;background:rgba(14,18,32,.94);border:1px solid rgba(255,255,255,.2);box-shadow:0 12px 40px rgba(0,0,0,.5)}
.pj-card h3{margin:0 0 4px;font-size:18px}
.pj-card p{margin:4px 0;font-size:13px;opacity:.9}
.pj-card .pj-row{margin-top:12px}
.pj-card canvas{display:block;width:100%;height:auto;border-radius:8px;margin:8px 0;background:#000;image-rendering:pixelated}
.pj-tch{position:absolute;bottom:14px;width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(20,24,36,.55);display:none;align-items:center;justify-content:center;touch-action:none;-webkit-touch-callout:none}
.pj.is-touch .pj-tch{display:flex}
.pj-tch svg{width:28px;height:28px;pointer-events:none}
.pj-tch.is-on{background:rgba(79,224,200,.5)}
.pj-edtop{position:absolute;left:0;right:0;top:0;display:flex;flex-wrap:wrap;gap:5px;padding:6px 8px;background:rgba(10,14,26,.95);border-bottom:1px solid rgba(255,255,255,.14);align-items:center}
.pj-edbot{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;background:rgba(10,14,26,.95);border-top:1px solid rgba(255,255,255,.14);align-items:center}
.pj-tool{padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);cursor:pointer;font-size:12px;font-weight:600}
.pj-tool[aria-pressed="true"]{background:#ffd166;color:#222;border-color:#ffd166}
.pj-name-in{flex:1 1 130px;min-width:90px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:inherit;font:inherit;font-size:13px}
.pj-scroll{flex:1 1 120px;min-width:80px}
.pj-note{flex:1 1 100%;font-size:12px;min-height:16px;color:#ffe9a8}
.pj-link{flex:1 1 220px;min-width:120px;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.4);color:inherit;font:inherit;font-size:12px}
`;

const hash = (a, b) => { let x = (a * 374761393 + b * 668265263) >>> 0; x = (x ^ (x >>> 13)) * 1274126177 >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const px = (g, x, y, w, hh) => g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh));

export default {
  mount(el, ctx) {
    const reduced = reducedMotion(ctx);
    const snd = sounder(ctx);
    const rand = rng(7);
    const DECOR = [0, 1, 2, 3].map(() => Array.from({ length: 40 }, (_, i) => ({ x: i * 70 + rand() * 40, w: 50 + rand() * 70, hgt: 30 + rand() * 80, a: rand() })));

    /* ------------------------------ saved data ------------------------------ */
    let sv = load(GAME);
    const done = () => (sv.done && typeof sv.done === 'object' ? sv.done : {});
    const mineList = () => (Array.isArray(sv.mine) ? sv.mine.filter(m => m && typeof m.id === 'string' && Array.isArray(m.rows)) : []);
    const persist = patch => { save(GAME, patch); sv = load(GAME); };
    const cleared = () => LEVELS.reduce((n, _, i) => n + (done()[i] ? 1 : 0), 0);
    const unlocked = i => i === 0 || !!done()[i - 1] || (i >= 2 && !!done()[i - 2]);
    const playerName = () => {
      try {
        const v = store.get('portal.identity', null), u = store.get('session.user', null);
        return share.textLine((v && typeof v.name === 'string' && v.name.trim()) || (u && (u.name || u.username)) || '');
      } catch (e) { return ''; }
    };

    /* ------------------------------ state ------------------------------ */
    const S = {
      mode: 'menu',                 /* menu | play | editor | preview */
      src: null,                    /* { kind: 'main', i } | { kind: 'mine', id } | { kind: 'shared' } | { kind: 'test' } */
      level: null, sim: null, armed: false, over: false, paused: false,
      simTime: 0, steps: 0, rec: [], prev: { x: 0, y: 0 },
      kb: 0, touch: 0, virt: 0, forced: null, manual: false,
      cam: 0, particles: [], shake: 0, t: 0, newBest: false,
      spark: new Map(), nameHud: '', shared: null,
      ed: null, notes: '',
    };
    let raf = 0, last = 0, dead = false;
    const ui = h('div.pj-ui');
    const sf = surface(el, 'Pixel Jumper game screen', () => draw());
    const root = el;
    root.classList.add('pj');
    root.tabIndex = -1;
    const style = h('style', { text: css });
    root.append(style, ui);
    const focusStage = () => { try { root.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } };
    const btn = (label, onclick, ic, cls = '', extra = {}) => h('button.pj-btn' + (cls ? '.' + cls : ''), { type: 'button', onclick: e => { onclick(e); }, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
    const mask = () => S.forced !== null ? S.forced : (S.kb | S.touch | S.virt);

    /* ------------------------------ menu ------------------------------ */
    function best(i) { return done()[i] || null; }
    function showMenu() {
      loopStop();
      S.mode = 'menu'; S.level = null; S.sim = null; S.over = false;
      ui.replaceChildren();
      const next = LEVELS.findIndex((_, i) => !done()[i] && unlocked(i));
      const total = cleared();
      const menu = h('div.pj-menu', { 'data-pj': 'menu' });
      menu.append(h('div.pj-top',
        h('div', h('h2', { text: 'Pixel Jumper' }), h('p', { text: `${total} of ${LEVELS.length} levels cleared. Run with ← → , jump with Space or ↑ (hold for height, tap for a hop), restart with R.` })),
        h('div.pj-row',
          next >= 0 ? btn(total ? 'Continue' : 'Play', () => startMain(next), 'play', 'pj-btn--go', { 'data-act': 'continue' }) : null,
          btn('Level editor', () => openEditor(null), 'wrench', '', { 'data-act': 'editor' }))));
      WORLDS.forEach((w, wi) => {
        menu.append(h('h3', { text: `${wi + 1}. ${w.name}` }), h('p', { text: w.blurb }));
        const row = h('div.pj-row');
        for (let i = wi * 5; i < wi * 5 + 5; i++) {
          const b = best(i), open = unlocked(i), lv = LEVELS[i];
          const sparks = buildLevel(lv.rows).level.sparks.length;
          const status = b ? `${fmtFrames(b.f)} s · ${b.s}/${sparks}` : open ? 'not cleared' : 'locked';
          row.append(h('button.pj-lv' + (b ? '.is-done' : ''), {
            type: 'button', disabled: !open, 'data-level': i + 1,
            'aria-label': `Level ${i + 1}, ${lv.name}. ${b ? `Best ${fmtFrames(b.f)} seconds, ${b.s} of ${sparks} sparks` : open ? 'Not cleared yet' : 'Locked until you clear an earlier level'}`,
            onclick: () => startMain(i),
          }, h('b', { text: `${i + 1}. ${lv.name}` }), h('span', { text: status }), b ? icon('check') : !open ? icon('lock') : null));
        }
        menu.append(row);
      });
      menu.append(h('h3', { text: 'My levels' }), h('p', { text: `Made in the editor, kept on this device (${MAX_MINE} at most).` }));
      const mine = mineList();
      if (!mine.length) menu.append(h('p', { text: 'None yet. Open the level editor to make one.' }));
      for (const m of mine) {
        menu.append(h('div.pj-mine', { 'data-mine': m.id },
          h('b', { text: m.name || 'Untitled level' }),
          h('small', { text: shareable(m) ? 'finished · can be shared' : 'not finished yet' }),
          btn('Play', () => startMine(m.id), 'play', '', { 'data-act': 'mine-play' }),
          btn('Edit', () => openEditor(m.id), 'wrench', '', { 'data-act': 'mine-edit' }),
          btn('Delete', () => { persist({ mine: mineList().filter(x => x.id !== m.id) }); showMenu(); }, 'trash', 'pj-btn--danger', { 'data-act': 'mine-delete', 'aria-label': `Delete ${m.name || 'Untitled level'}` })));
      }
      ui.append(menu);
      draw();
    }
    const shareable = m => { const b = buildLevel(m.rows); const run = cleanReplay(m.run); return !!(b.ok && run && runReplay(b.level, run).won); };

    /* ------------------------------ playing ------------------------------ */
    function startMain(i) { begin(LEVELS[i].rows, { kind: 'main', i }, LEVELS[i].name); }
    function startMine(id) { const m = mineList().find(x => x.id === id); if (m) begin(m.rows, { kind: 'mine', id }, m.name || 'Untitled level'); }
    function begin(rows, src, name) {
      const b = buildLevel(rows);
      if (!b.ok) { note(b.error); return; }
      S.mode = 'play'; S.src = src; S.level = b.level; S.nameHud = name;
      S.spark = new Map(b.level.sparks.map((p, k) => [p.r * b.level.w + p.c, k]));
      resetRun(true);
      buildPlayUI();
      loopStart();
    }
    function resetRun(snapCam) {
      S.sim = newSim(S.level); S.sim.ev = [];
      S.armed = false; S.over = false; S.simTime = 0; S.steps = 0; S.rec = []; S.particles = []; S.shake = 0; S.newBest = false;
      S.prev = { x: S.sim.x, y: S.sim.y };
      if (snapCam) S.cam = camTarget();
    }
    function restart() {
      if (S.mode !== 'play') return;
      resetRun(false);
      ui.querySelector('.pj-card')?.remove();
      hud();
      focusStage();
    }
    let hudEls = null;
    function buildPlayUI() {
      ui.replaceChildren();
      const back = S.src.kind === 'test' ? btn('Back to editor', () => backToEditor(), 'arrow-left', '', { 'data-act': 'back' }) : btn('Menu', () => { loopStop(); showMenu(); }, 'arrow-left', '', { 'data-act': 'menu' });
      const name = h('div.pj-name', { text: S.nameHud });
      const stat = h('div.pj-stat', { 'aria-live': 'off' });
      const rs = btn('Restart', () => { restart(); }, 'rotate-ccw', '', { 'data-act': 'restart', title: 'Restart the level (R)' });
      ui.append(h('div.pj-hud', back, name, stat, rs));
      const tb = (cls, bit, ic, label, left) => {
        const b = h('button.pj-tch', { type: 'button', 'aria-label': label, style: left == null ? '' : `left:${left}px`, 'data-touch': cls });
        b.append(icon(ic));
        const on = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } S.touch |= bit; b.classList.add('is-on'); root.classList.add('is-touch'); snd.wake(); arm(); };
        const off = e => { e.preventDefault(); S.touch &= ~bit; b.classList.remove('is-on'); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
        b.addEventListener('contextmenu', e => e.preventDefault());
        return b;
      };
      const jumpB = tb('jump', JUMP, 'chevron-up', 'Jump');
      jumpB.style.right = '16px';
      ui.append(tb('left', L, 'chevron-left', 'Run left', 14), tb('right', R, 'chevron-right', 'Run right', 88), jumpB);
      if (coarse()) root.classList.add('is-touch');
      hudEls = { stat };
      hud(true);
    }
    let hudText = '';
    function hud(force) {
      if (!hudEls || !S.sim) return;
      const sp = S.level.sparks.length;
      const t = `✦ ${S.sim.sparks}/${sp}  ·  ${S.sim.deaths} ${S.sim.deaths === 1 ? 'fall' : 'falls'}  ·  ${fmtFrames(S.sim.frame)} s`;
      if (force || t !== hudText) { hudText = t; hudEls.stat.textContent = t; }
    }
    function arm() { if (S.mode === 'play' && !S.armed && !S.over) { S.armed = true; S.simTime = 0; S.steps = 0; } }

    function stepOnce(m) {
      S.prev.x = S.sim.x; S.prev.y = S.sim.y;
      step(S.sim, m);
      S.steps++;
      if (S.src.kind === 'test') S.rec.push(m);        /* only a test play is recorded: its run becomes the proof in a share link */
      if (S.sim.won) onWin();
    }
    /* real time in, whole fixed steps out: the same inputs give the same run at any frame rate */
    function advance(dt) {
      S.t += dt;
      if (S.mode !== 'play' || S.paused || S.over) return;
      const m = mask();
      if (!S.armed) { if (!m) return; arm(); }
      S.simTime += dt;
      const target = Math.floor(S.simTime * 60 + 1e-6);
      let n = 0;
      while (S.steps < target && !S.over && n < 12) { stepOnce(mask()); n++; }
      if (S.steps < target) { S.steps = target; S.simTime = S.steps / 60; }       /* a very long stall: don't spiral */
      events();
      updateCam(dt);
      hud();
    }
    function events() {
      const ev = S.sim.ev;
      if (!ev || !ev.length) return;
      for (const e of ev.splice(0)) {
        if (e === 'jump') snd.blip(380, 0.1, 'triangle', 0.8, 700);
        else if (e === 'land') snd.blip(150, 0.05, 'triangle', 0.5, 110);
        else if (e === 'spark') { snd.blip(880, 0.07, 'square', 0.6, 1320); burst(S.sim.x + PW / 2, S.sim.y + 4, 5, '#ffe27a', 60); }
        else if (e === 'spring') snd.blip(300, 0.2, 'triangle', 0.9, 900);
        else if (e === 'checkpoint') { snd.blip(520, 0.12, 'sine', 0.8, 780); snd.blip(780, 0.16, 'sine', 0.7, 1040); }
        else if (e === 'die') { snd.blip(220, 0.35, 'sawtooth', 0.8, 50); burst(S.sim.x + PW / 2, S.sim.y + PH / 2, 14, '#38d6c4', 120); S.shake = reduced ? 0 : 0.25; }
        else if (e === 'goal') { [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => { if (!dead) snd.blip(f, 0.16, 'triangle', 0.8); }, k * 90)); burst(S.sim.x + PW / 2, S.sim.y, 18, '#ffd166', 140); }
      }
    }
    function burst(x, y, n, color, speed) {
      if (reduced) return;
      for (let i = 0; i < n; i++) { const a = rand() * 6.283, v = speed * (0.4 + rand() * 0.8); S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6 + rand() * 0.4, c: color }); }
    }

    /* ------------------------------ finishing a level ------------------------------ */
    function onWin() {
      S.over = true;
      S.touch = 0;
      const s = S.sim;
      const kind = S.src.kind;
      let lines = [];
      if (kind === 'main') {
        const i = S.src.i, prev = done()[i], first = !prev;
        const better = !prev || s.winFrame < prev.f;
        const rec = { f: better ? s.winFrame : prev.f, d: better ? s.deaths : prev.d, s: Math.max(s.sparks, prev ? prev.s : 0) };
        persist({ done: { ...done(), [i]: rec } });
        S.newBest = better && !first;
        const n = cleared();
        ctx.onScore(n);
        lines = [`Time ${fmtFrames(s.winFrame)} s${S.newBest ? ' — a new best!' : ''}`, `Sparks ${s.sparks} of ${S.level.sparks.length} · ${s.deaths} ${s.deaths === 1 ? 'fall' : 'falls'}`];
        if (first && n === LEVELS.length) setTimeout(() => { if (!dead) ctx.onEnd({ score: n, won: true, detail: `All ${n} levels cleared` }); }, 600);
      } else if (kind === 'test') {
        const runs = encodeMasks(S.rec);
        const clean = cleanReplay(runs);
        if (clean) { S.ed.run = clean; saveDraft(); lines = [`Finished in ${fmtFrames(s.winFrame)} s. This level can be shared now.`]; }
        else { S.ed.run = null; lines = ['Finished — but that run was too long to share (five minutes at most). Restart and finish it faster.']; }
      } else {
        lines = [`Time ${fmtFrames(s.winFrame)} s`, `Sparks ${s.sparks} of ${S.level.sparks.length} · ${s.deaths} ${s.deaths === 1 ? 'fall' : 'falls'}`];
      }
      const card = h('div.pj-card', { role: 'dialog', 'aria-label': 'Level complete', 'data-pj': 'win' }, h('h3', { text: 'Level complete' }), ...lines.map(t => h('p', { text: t })));
      const row = h('div.pj-row');
      if (kind === 'main') {
        const i = S.src.i;
        if (i + 1 < LEVELS.length) row.append(btn('Next level', () => startMain(i + 1), 'play', 'pj-btn--go', { 'data-act': 'next' }));
      } else if (kind === 'shared') {
        row.append(btn('Save a copy to My levels', () => saveShared(row), 'save', '', { 'data-act': 'save-shared' }));
      } else if (kind === 'test') {
        row.append(btn('Back to editor', () => backToEditor(), 'arrow-left', 'pj-btn--go', { 'data-act': 'back' }));
      }
      row.append(btn('Play again', () => restart(), 'rotate-ccw', '', { 'data-act': 'again' }));
      if (kind !== 'test') row.append(btn('Menu', () => { loopStop(); showMenu(); }, 'list', '', { 'data-act': 'menu' }));
      card.append(row);
      ui.append(card);
      row.querySelector('button')?.focus({ preventScroll: true });
    }
    function saveShared(row) {
      const sh = S.shared;
      const list = mineList();
      if (!sh) return;
      if (list.length >= MAX_MINE) { row.parentElement.append(h('p', { text: `My levels is full (${MAX_MINE}). Delete one in the menu first.` })); return; }
      persist({ mine: [...list, { id: newId(), name: sh.name, rows: sh.rows, run: sh.run }] });
      row.parentElement.append(h('p', { text: 'Saved to My levels.' }));
    }
    const newId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

    /* ------------------------------ a level someone shared ------------------------------ */
    function showPreview(lv) {
      loopStop();
      S.mode = 'preview'; S.shared = lv; S.level = null; S.sim = null; S.touch = 0; S.kb = 0;
      ui.replaceChildren();
      const cv = document.createElement('canvas');
      cv.width = lv.w * 4; cv.height = ROWS * 4;
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', `Preview of the level, ${lv.w} tiles wide`);
      drawMini(cv, lv.rows, 4, 0);
      const by = lv.creator ? `Made by ${lv.creator} (the name comes from the link and is not verified)` : 'Made by someone who didn’t give a name';
      const card = h('div.pj-card', { role: 'dialog', 'aria-label': 'Shared level preview', 'data-pj': 'preview' },
        h('h3', { text: lv.name }), h('p', { text: by }), cv,
        h('p', { text: `${lv.w} tiles wide · ${lv.sparks} spark${lv.sparks === 1 ? '' : 's'} · ${lv.checkpoints} checkpoint${lv.checkpoints === 1 ? '' : 's'}. The author’s run reaches the goal in ${fmtFrames(lv.frames)} s, so it can be finished.` }),
        h('p', { text: 'Nothing starts until you press Play.' }));
      const row = h('div.pj-row',
        btn('Play', () => { S.shared = lv; begin(lv.rows, { kind: 'shared' }, lv.name); }, 'play', 'pj-btn--go', { 'data-act': 'play-shared' }),
        btn('Not now', () => showMenu(), 'x', '', { 'data-act': 'dismiss' }));
      card.append(row);
      ui.append(h('div.pj-menu', { 'data-pj': 'preview-bg' }), card);
      draw();
      row.querySelector('button')?.focus({ preventScroll: true });
    }

    /* ------------------------------ camera and drawing ------------------------------ */
    const geom = () => {
      const top = S.mode === 'editor' ? (S.ed?.topH || 0) : 0, bot = S.mode === 'editor' ? (S.ed?.botH || 0) : 0;
      const dpr = sf.dpr || 1;
      const areaH = Math.max(1, sf.h - top - bot);
      const K = Math.max(1, Math.floor((areaH * dpr + 12) / (ROWS * TILE)));
      const k = K / dpr;
      return { k, K, top, areaH, oy: top + (areaH - ROWS * TILE * k) / 2, viewW: sf.w / k };
    };
    function camTarget() {
      if (!S.level || !S.sim) return 0;
      const { viewW } = geom();
      const worldW = S.level.w * TILE;
      if (worldW <= viewW) return (worldW - viewW) / 2;
      const want = S.sim.x + PW / 2 - viewW * (S.sim.face > 0 ? 0.4 : 0.6);
      return Math.max(0, Math.min(worldW - viewW, want));
    }
    function updateCam(dt) { const t = camTarget(); S.cam = reduced ? t : S.cam + (t - S.cam) * Math.min(1, dt * 7); }

    function drawTiles(g, lv, th, x0, x1, active) {
      const c0 = Math.max(0, Math.floor(x0 / TILE)), c1 = Math.min(lv.w - 1, Math.floor(x1 / TILE));
      const T = lv.tiles, w = lv.w, tt = reduced ? 0 : S.t;
      const at = (c, r) => (c < 0 || c >= w || r < 0 || r >= ROWS ? 35 : T[r * w + c]);
      for (let r = 0; r < ROWS; r++) for (let c = c0; c <= c1; c++) {
        const ch = T[r * w + c];
        if (ch === 46) continue;
        const x = c * TILE, y = r * TILE;
        if (ch === 35) {                                         /* # */
          g.fillStyle = th.rock; px(g, x, y, TILE, TILE);
          const hs = hash(c, r);
          g.fillStyle = th.rockDark; px(g, x + (hs & 7) + 1, y + ((hs >> 3) & 7) + 6, 3, 2); px(g, x + ((hs >> 6) & 7) + 4, y + ((hs >> 9) & 3) + 1, 2, 2);
          if (at(c, r - 1) !== 35) { g.fillStyle = th.top; px(g, x, y, TILE, 5); g.fillStyle = th.topLight; px(g, x, y, TILE, 2); g.fillStyle = th.top; if (hs & 1) px(g, x + 3, y + 5, 3, 2); if (hs & 2) px(g, x + 10, y + 5, 3, 3); }
          if (at(c, r + 1) !== 35 && r < ROWS - 1) { g.fillStyle = th.rockDark; px(g, x, y + TILE - 3, TILE, 3); }
        } else if (ch === 61) {                                  /* = */
          g.fillStyle = th.plank; px(g, x, y, TILE, 5); g.fillStyle = th.topLight; px(g, x, y, TILE, 1);
          g.fillStyle = th.rockDark; px(g, x, y + 5, TILE, 1); px(g, x + 1, y + 6, 2, 3); px(g, x + TILE - 3, y + 6, 2, 3);
        } else if (ch === 94 || ch === 118) {                    /* ^ v */
          const up = ch === 94;
          for (let k = 0; k < 3; k++) {
            const bx = x + 1 + k * 5;
            g.fillStyle = '#dfe8f4';
            g.beginPath();
            if (up) { g.moveTo(bx, y + 16); g.lineTo(bx + 2.5, y + 8); g.lineTo(bx + 5, y + 16); } else { g.moveTo(bx, y); g.lineTo(bx + 2.5, y + 8); g.lineTo(bx + 5, y); }
            g.closePath(); g.fill();
            g.fillStyle = '#7d8aa0'; px(g, bx + (up ? 3 : 0), up ? y + 11 : y + 2, 2, 4);
          }
          g.fillStyle = '#56627a'; px(g, x, up ? y + 15 : y, TILE, 1);
        } else if (ch === 126) {                                 /* ~ */
          const top = at(c, r - 1) !== 126;
          g.fillStyle = th.lava; px(g, x, y, TILE, TILE);
          if (top) {
            g.fillStyle = '#ffd27a';
            for (let i = 0; i < TILE; i += 2) { const o = Math.round(Math.sin(tt * 3 + (x + i) * 0.45) * 1.4); px(g, x + i, y + 4 + o, 2, 2); }
            g.fillStyle = th.lava; px(g, x, y, TILE, 4);
          } else { g.fillStyle = 'rgba(120,20,0,.35)'; px(g, x + ((hash(c, r) & 7) * 2), y + 5, 3, 3); }
        } else if (ch === 66) {                                  /* B spring */
          const sq = active && active.spring && !reduced ? Math.min(1, active.spring) : 0;
          g.fillStyle = '#3a4258'; px(g, x + 2, y + 13, 12, 3);
          g.strokeStyle = '#c3cbe0'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 4, y + 13); g.lineTo(x + 12, y + 11); g.lineTo(x + 4, y + 9 + sq * 2); g.lineTo(x + 12, y + 8 + sq * 2); g.stroke();
          g.fillStyle = '#ff5a7a'; px(g, x + 1, y + 6 + sq * 3, 14, 3); g.fillStyle = '#ff9db0'; px(g, x + 1, y + 6 + sq * 3, 14, 1);
        } else if (ch === 111) {                                 /* o spark */
          const k = lvSparkIndex(c, r);
          if (k >= 0 && active && active.taken[k]) continue;
          const bob = reduced ? 0 : Math.round(Math.sin(tt * 3 + c) * 1.5);
          const cx = x + 8, cy = y + 8 + bob;
          g.fillStyle = 'rgba(255,226,122,.25)'; g.beginPath(); g.arc(cx, cy, 7, 0, 6.3); g.fill();
          g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(cx, cy - 5); g.lineTo(cx + 4, cy); g.lineTo(cx, cy + 5); g.lineTo(cx - 4, cy); g.closePath(); g.fill();
          g.fillStyle = '#fff6c9'; px(g, cx - 1, cy - 3, 2, 3);
        } else if (ch === 67) {                                  /* C checkpoint */
          const k = lv.cps.findIndex(p => p.c === c && p.r === r);
          const on = active && active.cp === k;
          g.fillStyle = '#4b5470'; px(g, x + 4, y + 14, 8, 2); px(g, x + 7, y + 4, 2, 11);
          g.fillStyle = on ? '#6ff2d6' : '#8a93ad';
          g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 12, y + 4); g.lineTo(x + 8, y + 8); g.lineTo(x + 4, y + 4); g.closePath(); g.fill();
          if (on) { g.fillStyle = 'rgba(111,242,214,.25)'; g.beginPath(); g.arc(x + 8, y + 4, 9, 0, 6.3); g.fill(); }
        } else if (ch === 71) {                                  /* G goal beacon */
          const pul = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(tt * 4);
          g.fillStyle = '#4b5470'; px(g, x + 7, y + 3, 2, 13); px(g, x + 4, y + 14, 8, 2);
          g.fillStyle = `rgba(255,209,102,${0.2 + pul * 0.25})`; g.beginPath(); g.arc(x + 8, y + 4, 11, 0, 6.3); g.fill();
          g.fillStyle = '#ffd166'; g.beginPath(); g.arc(x + 8, y + 3, 5, 0, 6.3); g.fill();
          g.fillStyle = '#fff6c9'; px(g, x + 6, y + 1, 2, 2);
        }
      }
    }
    const lvSparkIndex = (c, r) => (S.spark.has(r * (S.level?.w || 0) + c) ? S.spark.get(r * S.level.w + c) : -1);

    function drawPip(g, x, y, sim, alpha) {
      const air = !sim.ground;
      const stretch = reduced ? 0 : Math.max(-2, Math.min(2, Math.round(-sim.vy / 160)));
      const cx = x + PW / 2, bottom = y + PH;
      const run = reduced ? 0 : Math.floor((sim.x * 0.35) % 2);
      const f = sim.face;
      const bh = PH + (air ? stretch : 0), bw = 12 - (air ? stretch : 0) * 0.5;
      g.fillStyle = '#1a8f86'; px(g, cx - bw / 2 + 1, bottom - bh + 2, bw, bh - 2);              /* shadow side */
      g.fillStyle = '#38d6c4'; px(g, cx - bw / 2, bottom - bh + 1, bw, bh - 3);
      px(g, cx - bw / 2 + 1, bottom - bh, bw - 2, 1);
      g.fillStyle = '#a8f5ea'; px(g, cx - bw / 2 + 2, bottom - 6, bw - 4, 3);                    /* belly */
      /* feet */
      g.fillStyle = '#12625d';
      if (air) { px(g, cx - 4, bottom - 2, 3, 2); px(g, cx + 1, bottom - 2, 3, 2); }
      else if (Math.abs(sim.vx) > 8) { px(g, cx - 4 + run, bottom - 2, 3, 2); px(g, cx + 1 - run, bottom - 2, 3, 2); }
      else { px(g, cx - 4, bottom - 2, 3, 2); px(g, cx + 1, bottom - 2, 3, 2); }
      /* the one big eye, looking the way Pip runs */
      const ex = cx + f * 1.5;
      g.fillStyle = '#fff'; px(g, ex - 3, bottom - bh + 3, 6, 6);
      g.fillStyle = '#0d1b2a'; px(g, ex - 1 + f * 1.5, bottom - bh + 5, 3, 3);
      g.fillStyle = '#fff'; px(g, ex + f * 2, bottom - bh + 5, 1, 1);
      /* antenna */
      g.fillStyle = '#12625d'; px(g, cx - 0.5 - f, bottom - bh - 3, 1, 3);
      g.fillStyle = '#ffd166'; px(g, cx - 1.5 - f, bottom - bh - 5, 3, 3);
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const lvIdx = S.src && S.src.kind === 'main' ? LEVELS[S.src.i].world : (S.mode === 'editor' ? (S.ed?.theme ?? 0) : (S.src ? 0 : 0));
      const th = THEMES[lvIdx] || THEMES[0];
      g.imageSmoothingEnabled = false;
      const sky = g.createLinearGradient(0, 0, 0, sf.h);
      sky.addColorStop(0, th.sky[0]); sky.addColorStop(1, th.sky[1]);
      g.fillStyle = sky; g.fillRect(0, 0, sf.w, sf.h);
      const gm = geom();
      const lv = S.mode === 'editor' ? S.ed?.lv : S.level;
      /* backdrop: two parallax layers of simple shapes (still under reduced motion) */
      const cam = S.mode === 'editor' ? S.ed.cam : S.cam;
      for (let layer = 0; layer < 2; layer++) {
        const fac = reduced ? 0 : (layer ? 0.45 : 0.2), col = layer ? th.mid : th.far;
        g.fillStyle = col;
        for (const d of DECOR[lvIdx]) {
          const x = (d.x * 1 - cam * fac) % 2800;
          const sx = ((x % 2800) + 2800) % 2800 - 200;
          const hh = d.hgt * (layer ? 0.7 : 1);
          const base = gm.oy + ROWS * TILE * gm.k * (layer ? 0.9 : 0.78);
          g.beginPath();
          g.moveTo(sx * gm.k, base); g.lineTo((sx + d.w / 2) * gm.k, base - hh * gm.k * (lvIdx === 1 ? 1.4 : 0.8)); g.lineTo((sx + d.w) * gm.k, base); g.closePath(); g.fill();
        }
      }
      if (lv) {
        g.save();
        const shx = S.shake > 0 && !reduced ? (Math.random() - 0.5) * 6 * (S.shake / 0.25) : 0;
        g.translate(Math.round(-cam * gm.k + shx), Math.round(gm.oy));
        g.scale(gm.k, gm.k);
        const x0 = cam, x1 = cam + gm.viewW;
        if (S.mode === 'editor') {
          drawTiles(g, lv, th, x0, x1, null);
          drawEditorExtras(g, lv, x0, x1);
        } else {
          const sim = S.sim;
          drawTiles(g, lv, th, x0, x1, sim);
          /* the level is a fixed 14 rows; ground, lava and cave ceiling carry on to the edge of the window */
          const eTop = gm.oy / gm.k, eBot = (sf.h - gm.oy) / gm.k - ROWS * TILE;
          for (let c = Math.max(0, Math.floor(x0 / TILE)); c <= Math.min(lv.w - 1, Math.floor(x1 / TILE)); c++) {
            const bot = lv.rows[ROWS - 1][c], topc = lv.rows[0][c];
            if (bot === '#' || bot === '~') { g.fillStyle = bot === '#' ? th.rockDark : th.lava; px(g, c * TILE, ROWS * TILE - 1, TILE, eBot + 2); }
            if (topc === '#') { g.fillStyle = th.rockDark; px(g, c * TILE, -eTop - 2, TILE, eTop + 2); }
          }
          if (sim) {
            /* smooth between fixed steps */
            const a = reduced || S.over || !S.armed || S.paused ? 1 : Math.max(0, Math.min(1, S.simTime * 60 - S.steps));
            const ix = S.prev.x + (sim.x - S.prev.x) * a, iy = S.prev.y + (sim.y - S.prev.y) * a;
            if (sim.dead === 0) drawPip(g, Math.round(ix), Math.round(iy), sim, a);
            for (const p of S.particles) { g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c; px(g, p.x, p.y, 2, 2); }
            g.globalAlpha = 1;
          }
        }
        g.restore();
      }
      if (S.mode === 'play' && !S.armed && !S.over && S.sim && !S.paused) {
        prompt(g, sf, coarse() ? 'Touch a button to start' : 'Press ← → or Space to start', coarse() ? 'Left and right to run, the round button to jump.' : 'Run with ← → , jump with Space (hold for height).', 175, sf.h * 0.42);
      }
    }
    function drawEditorExtras(g, lv, x0, x1) {
      /* grid lines, and a marker over start and goal so they read in the editor */
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1 / geom().k;
      const c0 = Math.max(0, Math.floor(x0 / TILE)), c1 = Math.min(lv.w, Math.ceil(x1 / TILE));
      g.beginPath();
      for (let c = c0; c <= c1; c++) { g.moveTo(c * TILE, 0); g.lineTo(c * TILE, ROWS * TILE); }
      for (let r = 0; r <= ROWS; r++) { g.moveTo(c0 * TILE, r * TILE); g.lineTo(c1 * TILE, r * TILE); }
      g.stroke();
      g.strokeStyle = 'rgba(255,209,102,.9)'; g.lineWidth = 2 / geom().k; g.strokeRect(0, 0, lv.w * TILE, ROWS * TILE);
      if (lv.start) {
        const { c, r } = lv.start;
        g.fillStyle = 'rgba(56,214,196,.45)'; g.fillRect(c * TILE + 3, r * TILE + 2, 10, 14);
        g.fillStyle = '#fff'; g.font = `700 8px ${FONT}`; g.textAlign = 'center'; g.fillText('S', c * TILE + 8, r * TILE + 12);
      }
    }
    function drawMini(cv, rows, k, cam) {
      const g = cv.getContext('2d');
      const colors = { '#': '#8a6a46', '=': '#c9964f', '^': '#e8eef8', v: '#e8eef8', '~': '#ff7a2a', B: '#ff5a7a', o: '#ffd166', C: '#6ff2d6', S: '#38d6c4', G: '#ffd166' };
      g.fillStyle = '#12182c'; g.fillRect(0, 0, cv.width, cv.height);
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (colors[ch]) { g.fillStyle = colors[ch]; g.fillRect(c * k, r * k, k, k); }
      }
    }

    /* ------------------------------ the editor ------------------------------ */
    function openEditor(id) {
      const m = id ? mineList().find(x => x.id === id) : null;
      const draft = sv.draft && typeof sv.draft === 'object' && Array.isArray(sv.draft.rows) ? sv.draft : null;
      let rows, name, run, eid;
      if (m) { rows = m.rows.slice(); name = m.name || ''; run = m.run || null; eid = m.id; }
      else if (id === null && draft && !draft.fresh) { rows = draft.rows.slice(); name = draft.name || ''; run = draft.run || null; eid = draft.id || null; }
      else { rows = blankRows(40); name = ''; run = null; eid = null; }
      if (!buildLevel(rows).ok && !rows.every(r => typeof r === 'string')) rows = blankRows(40);
      S.mode = 'editor'; S.src = null; S.level = null; S.sim = null;
      S.ed = { rows, name, run, id: eid, tool: '#', undo: [], redo: [], cam: 0, lv: null, topH: 0, botH: 0, theme: 0, stroke: null, lastCell: null };
      lvFromRows();
      buildEditorUI();
      loopStart();
    }
    function lvFromRows() {
      const ed = S.ed;
      /* the editor draws any grid, valid or not: build a drawable level without the start/goal rules */
      const w = ed.rows[0].length;
      const tiles = new Uint8Array(w * ROWS);
      const lv = { w, h: ROWS, tiles, rows: ed.rows, start: null, goal: null, cps: [], sparks: [] };
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < w; c++) {
        const ch = ed.rows[r][c];
        tiles[r * w + c] = ch.charCodeAt(0);
        if (ch === 'S') lv.start = { c, r }; else if (ch === 'G') lv.goal = { c, r };
        else if (ch === 'C') lv.cps.push({ c, r }); else if (ch === 'o') lv.sparks.push({ c, r });
      }
      ed.lv = lv;
      S.spark = new Map();
    }
    function saveDraft() { if (S.ed) persist({ draft: { name: S.ed.name, rows: S.ed.rows, run: S.ed.run, id: S.ed.id } }); }
    function edCanShare() {
      const ed = S.ed;
      const b = buildLevel(ed.rows), run = cleanReplay(ed.run);
      return !!(b.ok && run && runReplay(b.level, run).won);
    }
    function setCell(rows, c, r, ch) { rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1); }
    /* one stamp of the current tool; returns true if the grid changed */
    function stamp(c, r, tool) {
      const ed = S.ed, w = ed.rows[0].length;
      if (c < 0 || r < 0 || c >= w || r >= ROWS) return false;
      const cur = ed.rows[r][c];
      if (cur === tool) return false;
      if (tool === 'C' && ed.lv.cps.length >= MAX_CHECKPOINTS) { note(`A level has at most ${MAX_CHECKPOINTS} checkpoints.`); return false; }
      if (tool === 'o' && ed.lv.sparks.length >= MAX_SPARKS) { note(`A level has at most ${MAX_SPARKS} sparks.`); return false; }
      if (tool === 'S' || tool === 'G') {
        for (let rr = 0; rr < ROWS; rr++) { const i = ed.rows[rr].indexOf(tool); if (i >= 0) setCell(ed.rows, i, rr, '.'); }
      }
      setCell(ed.rows, c, r, tool);
      return true;
    }
    function line(c0, r0, c1, r1, tool) {
      let changed = false;
      const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
      for (let i = 0; i <= n; i++) changed = stamp(Math.round(c0 + (c1 - c0) * i / n), Math.round(r0 + (r1 - r0) * i / n), tool) || changed;
      return changed;
    }
    const edSnapshot = () => ({ rows: S.ed.rows.slice(), run: S.ed.run });
    function edCommit(before) {
      const ed = S.ed;
      lvFromRows();
      ed.undo.push(before);
      if (ed.undo.length > 100) ed.undo.shift();
      ed.redo = [];
      if (ed.run && !edCanShare()) ed.run = null;      /* the level changed so that the finished run no longer wins */
      saveDraft(); edRefresh();
    }
    function undo() {
      const ed = S.ed; if (!ed || !ed.undo.length) return;
      ed.redo.push(edSnapshot());
      const s = ed.undo.pop(); ed.rows = s.rows; ed.run = s.run;
      lvFromRows(); clampCam(); saveDraft(); edRefresh(); note('Undone.');
    }
    function redo() {
      const ed = S.ed; if (!ed || !ed.redo.length) return;
      ed.undo.push(edSnapshot());
      const s = ed.redo.pop(); ed.rows = s.rows; ed.run = s.run;
      lvFromRows(); clampCam(); saveDraft(); edRefresh(); note('Redone.');
    }
    function resize(delta) {
      const ed = S.ed, w = ed.rows[0].length, nw = Math.max(MIN_COLS, Math.min(MAX_COLS, w + delta));
      if (nw === w) { note(`A level is ${MIN_COLS} to ${MAX_COLS} tiles wide.`); return; }
      const before = edSnapshot();
      ed.rows = ed.rows.map((row, r) => (nw > w ? row + (r >= 12 ? '#' : '.').repeat(nw - w) : row.slice(0, nw)));
      edCommit(before); clampCam(); note(`${nw} tiles wide.`);
    }
    const clampCam = () => {
      const ed = S.ed, { viewW } = geom(), max = Math.max(0, ed.rows[0].length * TILE - viewW);
      ed.cam = Math.max(0, Math.min(max, ed.cam));
      if (ed.scroll) { ed.scroll.max = String(Math.round(max)); ed.scroll.value = String(Math.round(ed.cam)); ed.scroll.disabled = max <= 0; }
    };
    function note(t) { S.notes = t; const n = ui.querySelector('.pj-note'); if (n) n.textContent = t; }
    let edEls = null;
    function buildEditorUI() {
      const ed = S.ed;
      ui.replaceChildren();
      const tools = h('div.pj-row', { role: 'toolbar', 'aria-label': 'Tiles' });
      ed.toolBtns = TOOLS.map(t => {
        const b = h('button.pj-tool', { type: 'button', 'data-tool': t.key, 'aria-pressed': String(t.id === ed.tool), title: `${t.label}`, onclick: () => { ed.tool = t.id; ed.toolBtns.forEach((x, i) => x.setAttribute('aria-pressed', String(TOOLS[i].id === t.id))); } }, t.label);
        tools.append(b);
        return b;
      });
      const nameIn = h('input.pj-name-in', { type: 'text', maxlength: '40', placeholder: 'Level name', 'aria-label': 'Level name', value: ed.name, oninput: e => { ed.name = e.target.value; saveDraft(); } });
      const top = h('div.pj-edtop',
        btn('Menu', () => { saveDraft(); loopStop(); showMenu(); }, 'arrow-left', '', { 'data-act': 'menu' }),
        tools,
        btn('Undo', undo, 'undo', '', { 'data-act': 'undo', 'aria-label': 'Undo (Z)' }),
        btn('Redo', redo, 'redo', '', { 'data-act': 'redo', 'aria-label': 'Redo (Y)' }));
      const scroll = h('input.pj-scroll', { type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Scroll the level', oninput: e => { ed.cam = Number(e.target.value) || 0; draw(); } });
      ed.scroll = scroll;
      const linkIn = h('input.pj-link', { type: 'text', readonly: true, hidden: true, 'aria-label': 'Share link', onfocus: e => e.target.select() });
      const shareBtn = btn('Share link', () => makeLink(linkIn), 'link', '', { 'data-act': 'share' });
      const bot = h('div.pj-edbot',
        nameIn,
        btn('Test play', testPlay, 'play', 'pj-btn--go', { 'data-act': 'test' }),
        btn('Save', saveLevel, 'save', '', { 'data-act': 'save' }),
        shareBtn,
        btn('Wider', () => resize(8), 'plus', '', { 'data-act': 'wider', 'aria-label': 'Make the level 8 tiles wider' }),
        btn('Narrower', () => resize(-8), 'minus', '', { 'data-act': 'narrower', 'aria-label': 'Make the level 8 tiles narrower' }),
        btn('Clear', () => { const before = edSnapshot(); S.ed.rows = blankRows(S.ed.rows[0].length); edCommit(before); note('Cleared.'); }, 'trash', 'pj-btn--danger', { 'data-act': 'clear' }),
        scroll, linkIn,
        h('div.pj-note', { role: 'status', 'aria-live': 'polite' }));
      ui.append(top, bot);
      edEls = { top, bot, shareBtn, linkIn };
      ed.top = top; ed.bot = bot;
      measure();
      edRefresh();
      note('Pick a tile, then click or drag on the level. Place a Start and a Goal, test play, and finish it once to share.');
    }
    function measure() {
      const ed = S.ed; if (!ed || !ed.top) return;
      ed.topH = ed.top.offsetHeight; ed.botH = ed.bot.offsetHeight;
      clampCam();
    }
    function edRefresh() {
      if (!S.ed || !edEls) return;
      const can = edCanShare();
      edEls.shareBtn.disabled = !can;
      edEls.shareBtn.title = can ? 'Pack this level into a link' : 'Finish the level once in test play to share it';
      edEls.shareBtn.setAttribute('aria-label', can ? 'Share link' : 'Share link (finish the level once in test play first)');
      if (!can) edEls.linkIn.hidden = true;
      measure(); draw();
    }
    function testPlay() {
      const ed = S.ed;
      const b = buildLevel(ed.rows);
      if (!b.ok) { note(b.error); return; }
      saveDraft();
      loopStop();
      S.mode = 'play'; S.src = { kind: 'test' }; S.level = b.level; S.nameHud = ed.name || 'Test play';
      S.spark = new Map(b.level.sparks.map((p, k) => [p.r * b.level.w + p.c, k]));
      resetRun(true);
      buildPlayUI();
      loopStart();
    }
    function backToEditor() {
      loopStop();
      const ed = S.ed;
      S.mode = 'editor'; S.level = null; S.sim = null; S.src = null; S.over = false; S.touch = 0;
      lvFromRows(); buildEditorUI(); loopStart();
      if (ed.run && edCanShare()) note('Finished! You can share this level now.');
    }
    function saveLevel() {
      const ed = S.ed;
      const b = buildLevel(ed.rows);
      const list = mineList();
      const name = share.textLine(ed.name) || 'Untitled level';
      if (!ed.id && list.length >= MAX_MINE) { note(`My levels is full (${MAX_MINE}). Delete one in the menu first.`); return; }
      const id = ed.id || newId();
      const entry = { id, name, rows: ed.rows.slice(), run: ed.run || null };
      const next = list.some(x => x.id === id) ? list.map(x => (x.id === id ? entry : x)) : [...list, entry];
      ed.id = id;
      persist({ mine: next, draft: { name: ed.name, rows: ed.rows, run: ed.run, id } });
      note(b.ok ? `Saved “${name}” to My levels.` : `Saved “${name}” (it still needs a start and a goal).`);
    }
    async function makeLink(linkIn) {
      const ed = S.ed;
      note('Packing the level…');
      const r = await share.encodeLevel({ name: ed.name, rows: ed.rows, run: ed.run, creator: playerName() });
      if (dead || S.mode !== 'editor') return;
      if (!r.ok) { linkIn.hidden = true; note(r.error); return; }
      linkIn.value = r.link; linkIn.hidden = false;
      let copied = false;
      try { await navigator.clipboard.writeText(r.link); copied = true; } catch (e) { /* the field is there to copy from */ }
      note(`${copied ? 'Link copied' : 'Here is the link'} (${(r.chars / 1024).toFixed(1)} KB of the ${(share.MAX_LINK / 1024).toFixed(0)} KB a link can be). Whoever opens it sees a preview and presses Play.`);
    }

    /* editor pointer: paint while dragging, right button erases */
    const cellAt = e => {
      const rect = sf.cv.getBoundingClientRect(), gm = geom();
      const x = (e.clientX - rect.left) / gm.k + S.ed.cam, y = (e.clientY - rect.top - gm.oy) / gm.k;
      return { c: Math.floor(x / TILE), r: Math.floor(y / TILE), inside: y >= 0 && y < ROWS * TILE };
    };
    const onPointerDown = e => {
      if (S.mode !== 'editor' || !S.ed) return;
      const cell = cellAt(e);
      if (!cell.inside) return;
      e.preventDefault();
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      const tool = e.button === 2 ? '.' : S.ed.tool;
      S.ed.stroke = { tool, before: edSnapshot(), changed: false };
      S.ed.lastCell = cell;
      if (stamp(cell.c, cell.r, tool)) { S.ed.stroke.changed = true; lvFromRows(); draw(); }
    };
    const onPointerMove = e => {
      const ed = S.ed;
      if (S.mode !== 'editor' || !ed || !ed.stroke) return;
      const cell = cellAt(e);
      if (line(ed.lastCell.c, ed.lastCell.r, cell.c, Math.max(0, Math.min(ROWS - 1, cell.r)), ed.stroke.tool)) { ed.stroke.changed = true; lvFromRows(); draw(); }
      ed.lastCell = { ...cell, r: Math.max(0, Math.min(ROWS - 1, cell.r)) };
    };
    const onPointerUp = () => {
      const ed = S.ed;
      if (S.mode !== 'editor' || !ed || !ed.stroke) return;
      const s = ed.stroke; ed.stroke = null;
      if (s.changed) edCommit(s.before);
    };
    const onWheel = e => {
      if (S.mode !== 'editor' || !S.ed) return;
      e.preventDefault();
      S.ed.cam += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY); clampCam(); draw();
    };
    const onContext = e => { if (S.mode === 'editor') e.preventDefault(); };
    sf.cv.addEventListener('pointerdown', onPointerDown);
    sf.cv.addEventListener('pointermove', onPointerMove);
    sf.cv.addEventListener('pointerup', onPointerUp);
    sf.cv.addEventListener('pointercancel', onPointerUp);
    sf.cv.addEventListener('wheel', onWheel, { passive: false });
    sf.cv.addEventListener('contextmenu', onContext);

    /* ------------------------------ keyboard ------------------------------ */
    const KEYS = { ArrowLeft: L, a: L, A: L, ArrowRight: R, d: R, D: R, ' ': JUMP, ArrowUp: JUMP, w: JUMP, W: JUMP };
    const down = new Set();
    const bitsOf = () => { let m = 0; for (const k of down) m |= KEYS[k]; return m; };
    const onKey = e => {
      if (dead || !ownsKey(el, e)) return;
      if (S.mode === 'play' && !S.paused) {
        if (e.key in KEYS) { e.preventDefault(); snd.wake(); if (e.repeat) return; down.add(e.key); S.kb = bitsOf(); if (!S.over) arm(); }
        else if ((e.key === 'r' || e.key === 'R') && !e.repeat) { e.preventDefault(); restart(); }
      } else if (S.mode === 'editor') {
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
        else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); }
      }
    };
    const onKeyUp = e => {
      if (e.key in KEYS) { down.delete(e.key); S.kb = bitsOf(); if (S.mode === 'play') e.preventDefault(); }
    };
    const onBlur = () => { down.clear(); S.kb = 0; S.touch = 0; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    /* ------------------------------ the frame loop ------------------------------ */
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!S.manual) tick(dt);
    }
    function tick(dt) {
      advance(dt);
      if (S.particles.length) {
        for (const p of S.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt * 1.4; }
        S.particles = S.particles.filter(p => p.life > 0);
      }
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
      if (S.mode !== 'menu' && S.mode !== 'preview') draw();
    }
    function loopStart() { if (raf || dead) return; last = performance.now(); raf = requestAnimationFrame(frame); }
    function loopStop() { cancelAnimationFrame(raf); raf = 0; }
    const onResize = () => { if (S.mode === 'editor') { measure(); } draw(); };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    ro?.observe(el);

    ctx.onScore(cleared());
    {
      /* a level link opened this game: show its preview (nothing runs); otherwise the level select */
      const offered = share.take();
      if (offered) showPreview(offered); else showMenu();
    }

    return {
      stop() {
        dead = true;
        loopStop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onPointerDown);
        sf.cv.removeEventListener('pointermove', onPointerMove);
        sf.cv.removeEventListener('pointerup', onPointerUp);
        sf.cv.removeEventListener('pointercancel', onPointerUp);
        sf.cv.removeEventListener('wheel', onWheel);
        sf.cv.removeEventListener('contextmenu', onContext);
        ro?.disconnect();
        snd.close();
        sf.destroy();
        ui.remove(); style.remove();
        root.classList.remove('pj', 'is-touch');
      },
      pause() { S.paused = true; S.kb = 0; S.touch = 0; down.clear(); loopStop(); draw(); },
      resume() { S.paused = false; if (S.mode === 'play' || S.mode === 'editor') loopStart(); focusStage(); },
      /* a read-only snapshot for automated play-tests */
      peek: () => {
        const s = S.sim;
        return {
          mode: S.mode, paused: S.paused, armed: S.armed, over: S.over, src: S.src ? { ...S.src } : null,
          level: S.src && S.src.kind === 'main' ? S.src.i + 1 : null,
          x: s ? s.x : null, y: s ? s.y : null, vx: s ? s.vx : null, vy: s ? s.vy : null, ground: s ? s.ground : null,
          frame: s ? s.frame : 0, steps: S.steps, deaths: s ? s.deaths : 0, sparks: s ? s.sparks : 0, dead: s ? s.dead : 0, won: !!(s && s.won), cp: s ? s.cp : -1,
          winFrame: s ? s.winFrame : 0, cleared: cleared(), done: JSON.parse(JSON.stringify(done())), cam: S.cam,
          preview: S.mode === 'preview' && S.shared ? { name: S.shared.name, creator: S.shared.creator, w: S.shared.w } : null,
          editor: S.mode === 'editor' && S.ed ? {
            rows: S.ed.rows.slice(), name: S.ed.name, tool: S.ed.tool, undo: S.ed.undo.length, redo: S.ed.redo.length, canShare: edCanShare(), hasRun: !!S.ed.run, id: S.ed.id,
            cam: S.ed.cam, geo: (() => { const gm = geom(); return { k: gm.k, oy: gm.oy, top: S.ed.topH, bot: S.ed.botH, viewW: gm.viewW }; })(),
          } : null,
          mine: mineList().map(m => ({ id: m.id, name: m.name, run: !!m.run })),
          particles: S.particles.length, shake: S.shake, note: S.notes, touchUI: root.classList.contains('is-touch'), mask: mask(),
        };
      },
      /* test hook — nothing in the game calls it:
         input(mask) hold buttons · frames({ n, dt, mask }) run n frames of dt seconds through the real loop code ·
         replay(runs) feed recorded masks at once · open(i) start main level i (0-based, unlocked or not) ·
         manual(bool) stop the real clock, so only frames()/replay() move the game · touch(true) show the touch buttons */
      hook(cmd, arg) {
        if (cmd === 'input') { S.virt = arg | 0; if (S.virt) arm(); }
        else if (cmd === 'frames') {
          const prev = S.forced;
          if (arg.mask !== undefined) S.forced = arg.mask | 0;
          for (let i = 0; i < arg.n; i++) tick(arg.dt);
          S.forced = prev;
        } else if (cmd === 'replay') {
          arm();
          for (const [m, n] of arg.runs) for (let i = 0; i < n && !S.over; i++) stepOnce(m);
          events(); S.sim.ev.length = 0; updateCam(1); hud(); draw();
        } else if (cmd === 'open') { loopStop(); startMain(arg); }
        else if (cmd === 'restart') restart();
        else if (cmd === 'manual') S.manual = !!arg;
        else if (cmd === 'touch') { root.classList.toggle('is-touch', !!arg); }
        else if (cmd === 'edPaint') {
          const ed = S.ed; if (!ed) return false;
          const before = edSnapshot();
          const ch = arg.tool;
          let changed = false;
          for (const [c, r] of arg.cells) changed = stamp(c, r, ch) || changed;
          if (changed) edCommit(before);
          return changed;
        } else if (cmd === 'edRows') { const ed = S.ed; const before = edSnapshot(); ed.rows = arg.rows.slice(); edCommit(before); }
        else return false;
        draw();
        return true;
      },
    };
  },
};
