/* ============================================================
   arcade/towerdefense.js — Tower Defense for Static Arcade.

   Enemies walk a path from the left edge to your base. Build
   towers beside the path to stop them; every enemy that gets
   through costs lives.

   Towers (build on any free grass cell; three levels each)
     Dart    fast and cheap: one target, quick shots
     Cannon  splash: slow shells that hurt everything near the hit
     Frost   slow: a pulse that chills every enemy in range
   Upgrading raises damage and range (and speeds the shot up);
   selling returns 70% of everything you spent on that tower.

   Enemies: Grunt (balanced), Runner (fast, fragile), Tank (slow,
   tough, costs 2 lives), Boss (wave 10). A "wave preview" shows
   what the next wave holds. Ten waves per map, two maps.

   The simulation (makeSim, exported) is deterministic: no random
   numbers, a fixed tick of 1/30 s, stepped by sim.step(n). The
   screen runs it at 1×, 2× or 3× speed by stepping several ticks
   per frame; tests step it directly.

   Controls
     mouse / touch  pick a tower then tap a grass cell to build;
                    tap a tower to select it (upgrade / sell)
     keyboard       arrows move the cursor · 1 2 3 choose a tower ·
                    Space / Enter builds or selects · U upgrade ·
                    X sell · N send the next wave · F speed
   Score = 100 per wave cleared + 10 per enemy stopped (+25 per life
   left on a win). Higher is better; best per map is kept
   (portal.arcadePuzzles.towerdefense). Reduced motion: no effects.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { clamp, hsl, FONT, fitView, surface, ownsKey, looper, rr } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';

const GAME = 'towerdefense';
export const COLS = 12, ROWS = 8, CELL = 48, TICK = 1 / 30, WAVES = 10;
const VW = COLS * CELL, VH = ROWS * CELL;

export const MAPS = {
  switchback: { name: 'Switchback', path: [[-1, 1], [9, 1], [9, 3], [2, 3], [2, 5], [12, 5]] },
  spiral: { name: 'Spiral', path: [[-1, 6], [10, 6], [10, 1], [1, 1], [1, 4], [7, 4]] },
};
export const ENEMIES = {
  grunt: { name: 'Grunt', hp: 30, speed: 1.4, bounty: 8, lives: 1, hue: 130, r: 0.28 },
  runner: { name: 'Runner', hp: 18, speed: 2.6, bounty: 6, lives: 1, hue: 50, r: 0.22 },
  tank: { name: 'Tank', hp: 160, speed: 0.8, bounty: 20, lives: 2, hue: 8, r: 0.38 },
  boss: { name: 'Boss', hp: 900, speed: 0.7, bounty: 100, lives: 5, hue: 290, r: 0.44 },
};
export const TOWERS = {
  dart: { name: 'Dart', cost: 50, range: 2.6, dmg: 7, cd: 8, hue: 200, blurb: 'fast single shots' },
  cannon: { name: 'Cannon', cost: 90, range: 2.8, dmg: 20, cd: 36, splash: 1.2, hue: 28, blurb: 'splash damage' },
  frost: { name: 'Frost', cost: 70, range: 2.4, dmg: 2, cd: 24, slow: 0.5, hue: 185, blurb: 'slows everything in range' },
};
const WAVE_DEFS = [
  [['grunt', 6, 1.0]], [['grunt', 8, 0.9]], [['grunt', 6, 0.9], ['runner', 6, 0.6]], [['runner', 10, 0.5]],
  [['tank', 3, 2.0], ['grunt', 8, 0.8]], [['grunt', 12, 0.6], ['runner', 8, 0.5]], [['tank', 6, 1.8]],
  [['runner', 16, 0.4], ['tank', 6, 1.6]], [['tank', 10, 1.4], ['grunt', 10, 0.5]], [['tank', 6, 1.5], ['boss', 1, 1]],
];
/* the groups of wave n (1-based) and its spawn times in ticks */
export const wavePreview = n => (WAVE_DEFS[n - 1] || []).map(([type, count]) => ({ type, count }));
function waveSpawns(n) {
  const out = []; let t = 0;
  for (const [type, count, gap] of WAVE_DEFS[n - 1] || []) {
    for (let i = 0; i < count; i++) { out.push({ type, at: Math.round(t * 30) }); t += gap; }
    t += 1.5;
  }
  return out;
}

/* ---------- the map ---------- */
function layout(mapId) {
  const pts = MAPS[mapId].path.map(([c, r]) => [c + 0.5, r + 0.5]);
  const segs = []; let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push({ a: pts[i - 1], b: pts[i], len, from: total }); total += len;
  }
  const blocked = new Set();
  const wp = MAPS[mapId].path;
  for (let i = 1; i < wp.length; i++) {
    const [c0, r0] = wp[i - 1], [c1, r1] = wp[i];
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) blocked.add(r * COLS + c);
    }
  }
  const at = d => {
    const s = segs.find(g => d <= g.from + g.len) || segs[segs.length - 1];
    const f = clamp((d - s.from) / s.len, 0, 1);
    return [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f];
  };
  return { pts, total, blocked, at };
}

const level = (t, lv) => {
  const d = TOWERS[t];
  return { dmg: d.dmg * Math.pow(1.6, lv - 1), range: d.range + 0.25 * (lv - 1), cd: Math.max(3, Math.round(d.cd * Math.pow(0.85, lv - 1))), slow: d.slow ? [0.5, 0.4, 0.3][lv - 1] : 0, splash: d.splash || 0 };
};
export const upgradeCost = (type, lv) => (lv >= 3 ? null : Math.round(TOWERS[type].cost * (lv === 1 ? 0.8 : 1.2)));

export function makeSim(mapId = 'switchback') {
  const M = layout(mapId);
  const S = { tick: 0, money: 150, lives: 20, wave: 0, status: 'idle', spawns: [], waveStart: 0, enemies: [], towers: [], fx: [], kills: 0, nextId: 1, cleared: 0, leaked: 0, bonus: 0 };
  const ePos = e => M.at(e.p);
  const sellValue = t => Math.floor(t.spent * 0.7);
  const canBuild = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS && !M.blocked.has(r * COLS + c) && !S.towers.some(t => t.c === c && t.r === r);
  const sim = {
    S, map: M, mapId,
    place(type, c, r) {
      const d = TOWERS[type];
      if (!d) return { ok: false, reason: 'unknown tower' };
      if (S.status === 'won' || S.status === 'lost') return { ok: false, reason: 'the game is over' };
      if (!canBuild(c, r)) return { ok: false, reason: 'that cell is not free' };
      if (S.money < d.cost) return { ok: false, reason: `needs $${d.cost}` };
      S.money -= d.cost;
      const t = { id: S.nextId++, type, c, r, lv: 1, cd: 0, spent: d.cost };
      S.towers.push(t);
      return { ok: true, tower: t };
    },
    upgrade(id) {
      const t = S.towers.find(x => x.id === id);
      if (!t) return { ok: false, reason: 'no tower' };
      const cost = upgradeCost(t.type, t.lv);
      if (cost === null) return { ok: false, reason: 'already level 3' };
      if (S.money < cost) return { ok: false, reason: `needs $${cost}` };
      S.money -= cost; t.spent += cost; t.lv++;
      return { ok: true };
    },
    sell(id) {
      const i = S.towers.findIndex(x => x.id === id);
      if (i < 0) return { ok: false, reason: 'no tower' };
      const v = sellValue(S.towers[i]);
      S.money += v; S.towers.splice(i, 1);
      return { ok: true, refund: v };
    },
    sellValue, canBuild,
    startWave() {
      if (S.status !== 'idle' || S.wave >= WAVES) return false;
      S.wave++; S.status = 'wave'; S.spawns = waveSpawns(S.wave); S.waveStart = S.tick;
      return true;
    },
    step(n = 1) {
      for (let k = 0; k < n; k++) {
        if (S.status === 'won' || S.status === 'lost') return;
        S.tick++;
        /* spawns */
        while (S.spawns.length && S.tick - S.waveStart >= S.spawns[0].at) {
          const sp = S.spawns.shift(), d = ENEMIES[sp.type];
          const hp = Math.round(d.hp * (1 + 0.08 * (S.wave - 1)));
          S.enemies.push({ id: S.nextId++, type: sp.type, hp, max: hp, p: 0, slowUntil: 0, slow: 1 });
        }
        /* enemies move */
        for (const e of S.enemies) {
          const f = S.tick < e.slowUntil ? e.slow : 1;
          e.p += ENEMIES[e.type].speed * f * TICK;
        }
        for (const e of S.enemies) if (e.p >= M.total) { e.gone = true; S.lives -= ENEMIES[e.type].lives; S.leaked++; }
        S.enemies = S.enemies.filter(e => !e.gone);
        /* towers fire */
        for (const t of S.towers) {
          if (t.cd > 0) { t.cd--; continue; }
          const st = level(t.type, t.lv), tx = t.c + 0.5, ty = t.r + 0.5;
          const inRange = S.enemies.filter(e => e.hp > 0 && Math.hypot(ePos(e)[0] - tx, ePos(e)[1] - ty) <= st.range);
          if (!inRange.length) continue;
          t.cd = st.cd;
          if (t.type === 'frost') {
            for (const e of inRange) { e.hp -= st.dmg; e.slow = st.slow; e.slowUntil = S.tick + 45; }
            S.fx.push({ k: 'pulse', x: tx, y: ty, r: st.range, ttl: 6, hue: TOWERS.frost.hue });
          } else {
            let tgt = inRange[0];
            for (const e of inRange) if (e.p > tgt.p) tgt = e;           /* the one furthest along (ties: lowest id) */
            const [px, py] = ePos(tgt);
            tgt.hp -= st.dmg;
            if (st.splash) {
              for (const e of inRange) if (e !== tgt && Math.hypot(ePos(e)[0] - px, ePos(e)[1] - py) <= st.splash) e.hp -= st.dmg * 0.7;
              // enemies just outside this tower's range can still be hit by the blast
              for (const e of S.enemies) if (e !== tgt && !inRange.includes(e) && e.hp > 0 && Math.hypot(ePos(e)[0] - px, ePos(e)[1] - py) <= st.splash) e.hp -= st.dmg * 0.7;
              S.fx.push({ k: 'boom', x: px, y: py, r: st.splash, ttl: 8, hue: TOWERS.cannon.hue });
            }
            S.fx.push({ k: 'shot', x: tx, y: ty, x2: px, y2: py, ttl: 4, hue: TOWERS[t.type].hue });
          }
        }
        /* the fallen */
        for (const e of S.enemies) if (e.hp <= 0) { S.money += ENEMIES[e.type].bounty; S.kills++; e.gone = true; }
        S.enemies = S.enemies.filter(e => !e.gone);
        if (S.fx.length) { for (const f of S.fx) f.ttl--; S.fx = S.fx.filter(f => f.ttl > 0).slice(-60); }
        if (S.lives <= 0) { S.lives = 0; S.status = 'lost'; return; }
        if (S.status === 'wave' && !S.spawns.length && !S.enemies.length) {
          S.cleared = S.wave;
          const bonus = 20 + S.wave * 5;
          S.money += bonus; S.bonus = bonus;
          S.status = S.wave >= WAVES ? 'won' : 'idle';
        }
      }
    },
    score() { return S.cleared * 100 + S.kills * 10 + (S.status === 'won' ? S.lives * 25 : 0); },
    enemyPos: ePos,
  };
  return sim;
}

const CSS = `${BASE}
.pz-td__stage{touch-action:none}
.pz-td__bar{width:min(100%,760px);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;flex:0 0 auto}
.pz-td__prev{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.04));border:1px solid var(--line-0,rgba(255,255,255,.06));font-size:12px;color:var(--ink-2,#bbb)}
.pz-td__prev i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:3px;vertical-align:middle}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false, ended = false;
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let mapId = MAPS[sv.map] ? sv.map : 'switchback';
    let sim = makeSim(mapId);
    let speed = 1, acc = 0, buildType = 'dart', selected = null, cursor = [5, 5], kbd = false, hover = null, msg = '';

    /* ---------- chrome ---------- */
    const mapBtns = Object.entries(MAPS).map(([k, m]) => h('button', { type: 'button', dataset: { map: k }, 'aria-pressed': 'false' }, m.name));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Map' }, mapBtns);
    const moneyV = h('span', { text: '' }), livesV = h('span', { text: '' }), waveV = h('span', { text: '' });
    const moneyRead = h('div.pz__read', { title: 'Money', 'aria-label': 'Money' }, icon('star'), moneyV);
    const livesRead = h('div.pz__read', { title: 'Lives left', 'aria-label': 'Lives' }, icon('heart'), livesV);
    const waveRead = h('div.pz__read', { title: 'Wave', 'aria-label': 'Wave' }, icon('flame'), waveV);
    const bestV = h('small', { text: '' });
    const speedBtn = h('button.pz__btn', { type: 'button', title: 'Game speed (F)' }, icon('chevrons-right'), h('span', { text: '1×' }));
    const waveBtn = h('button.pz__btn', { type: 'button', title: 'Send the next wave (N)' }, icon('play'), h('span', { text: 'Send wave' }));
    const top = h('div.pz__top', seg, moneyRead, livesRead, waveRead, bestV, speedBtn, waveBtn);
    const stage = h('div.pz__stage.pz-td__stage');
    const towerBtns = Object.entries(TOWERS).map(([k, t], i) => h('button.pz__btn', { type: 'button', dataset: { tower: k }, 'aria-pressed': 'false', title: `${t.name}: ${t.blurb} (${i + 1})` }, `${t.name} $${t.cost}`));
    const upBtn = h('button.pz__btn', { type: 'button', title: 'Upgrade the selected tower (U)' }, icon('arrow-up'), h('span', { text: 'Upgrade' }));
    const sellBtn = h('button.pz__btn', { type: 'button', title: 'Sell the selected tower (X)' }, icon('trash'), h('span', { text: 'Sell' }));
    const prev = h('div.pz-td__prev');
    const bar = h('div.pz-td__bar', ...towerBtns, upBtn, sellBtn, prev);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), h('style', { text: CSS }), top, stage, bar, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Tower Defense map', () => draw());
    let V = fitView(sf, VW, VH, 4);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'pick a tower, tap a grass cell · <kbd>←↑↓→</kbd> <kbd>Space</kbd> · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> towers · <kbd>U</kbd> upgrade · <kbd>X</kbd> sell · <kbd>N</kbd> next wave · <kbd>F</kbd> speed' }));
    const selTower = () => sim.S.towers.find(t => t.id === selected) || null;

    function paintUI() {
      const S = sim.S;
      moneyV.textContent = `$${S.money}`;
      livesV.textContent = String(S.lives);
      waveV.textContent = `${S.wave}/${WAVES}`;
      const b = bests[mapId];
      bestV.textContent = b != null ? `Best ${MAPS[mapId].name}: ${b}` : '';
      mapBtns.forEach(x => x.setAttribute('aria-pressed', String(x.dataset.map === mapId)));
      towerBtns.forEach(x => { x.setAttribute('aria-pressed', String(x.dataset.tower === buildType && !selected)); x.disabled = S.money < TOWERS[x.dataset.tower].cost && x.dataset.tower !== buildType; });
      const t = selTower();
      const uc = t ? upgradeCost(t.type, t.lv) : null;
      upBtn.disabled = !t || uc === null || S.money < uc;
      upBtn.querySelector('span').textContent = t ? (uc === null ? 'Max level' : `Upgrade $${uc}`) : 'Upgrade';
      sellBtn.disabled = !t;
      sellBtn.querySelector('span').textContent = t ? `Sell +$${sim.sellValue(t)}` : 'Sell';
      speedBtn.querySelector('span').textContent = `${speed}×`;
      waveBtn.disabled = S.status !== 'idle' || S.wave >= WAVES;
      waveBtn.querySelector('span').textContent = S.wave === 0 ? 'Send wave 1' : S.status === 'idle' ? `Send wave ${S.wave + 1}` : S.status === 'wave' ? 'Wave in progress' : 'Send wave';
      const nx = S.status === 'wave' ? null : S.wave + 1;
      prev.replaceChildren();
      if (nx && nx <= WAVES) {
        prev.append(h('b', { text: `Wave ${nx}:` }));
        for (const g of wavePreview(nx)) prev.append(h('span', h('i', { style: { background: hsl(ENEMIES[g.type].hue, 80, 55) } }), `${g.count} ${ENEMIES[g.type].name}`));
      } else if (S.status === 'wave') prev.append(h('span', { text: `${S.enemies.length + S.spawns.length} enemies left` }));
      else prev.append(h('span', { text: S.status === 'won' ? 'All waves cleared' : S.status === 'lost' ? 'Overrun' : '' }));
      onScore(sim.score());
    }

    /* ---------- actions ---------- */
    function cellAct(c, r) {
      if (dead || paused || ended) return;
      const t = sim.S.towers.find(x => x.c === c && x.r === r);
      if (t) { selected = t.id; say(`${TOWERS[t.type].name}, level ${t.lv}. ${upgradeCost(t.type, t.lv) === null ? 'Fully upgraded.' : `Upgrade for $${upgradeCost(t.type, t.lv)}.`} Sells for $${sim.sellValue(t)}.`); }
      else {
        selected = null;
        const res = sim.place(buildType, c, r);
        say(res.ok ? `${TOWERS[buildType].name} built.` : `Can't build here: ${res.reason}.`);
      }
      paintUI(); draw();
    }
    function doUpgrade() {
      const t = selTower();
      if (!t || paused || ended) return;
      const r = sim.upgrade(t.id);
      say(r.ok ? `${TOWERS[t.type].name} is now level ${t.lv}.` : `Can't upgrade: ${r.reason}.`);
      paintUI(); draw();
    }
    function doSell() {
      const t = selTower();
      if (!t || paused || ended) return;
      const r = sim.sell(t.id);
      if (r.ok) { selected = null; say(`Sold for $${r.refund}.`); }
      paintUI(); draw();
    }
    function sendWave() {
      if (dead || paused || ended) return;
      if (sim.startWave()) say(`Wave ${sim.S.wave} is coming.`);
      paintUI(); draw();
      if (!loop.on) loop.start();
    }
    function setSpeed(s) { speed = s; paintUI(); }
    function newMap(id) {
      mapId = id; save(GAME, { map: id });
      sim = makeSim(id); selected = null; ended = false; acc = 0; paused = false; msg = '';
      say(`${MAPS[id].name}: build towers beside the path, then send wave 1.`);
      paintUI(); draw();
    }
    function checkEnd() {
      const st = sim.S.status;
      if (ended || (st !== 'won' && st !== 'lost')) return;
      ended = true; loop.stop();
      const score = sim.score();
      if (bests[mapId] == null || score > bests[mapId]) { bests[mapId] = score; save(GAME, { best: bests }); }
      say(st === 'won' ? `Defended! ${score} points.` : `Overrun on wave ${sim.S.wave}. ${score} points.`);
      paintUI(); draw();
      onEnd({ score, won: st === 'won', detail: `${MAPS[mapId].name} · wave ${sim.S.cleared}/${WAVES} · ${sim.S.kills} stopped` });
    }
    function advance(ticks) {
      const before = sim.S.status;
      sim.step(ticks);
      if (sim.S.status !== before || sim.S.tick % 15 === 0) paintUI();
      checkEnd();
    }

    /* ---------- drawing ---------- */
    function draw() {
      if (dead) return;
      sf.begin();
      V = fitView(sf, VW, VH, 4);
      const g = sf.g, S = sim.S;
      g.clearRect(0, 0, sf.w, sf.h);
      g.fillStyle = '#080a12'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const path = sim.map.blocked.has(r * COLS + c);
        g.fillStyle = path ? '#6b5a3c' : (r + c) % 2 ? '#2c5a34' : '#2f6138';
        g.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
      /* the road's edge and the base */
      g.strokeStyle = 'rgba(30,20,8,.55)'; g.lineWidth = 3; g.lineJoin = 'round';
      g.beginPath(); sim.map.pts.forEach(([x, y], i) => (i ? g.lineTo(x * CELL, y * CELL) : g.moveTo(x * CELL, y * CELL))); g.stroke();
      const end = sim.map.pts[sim.map.pts.length - 1];
      g.fillStyle = '#e8d56b'; g.beginPath(); g.arc(Math.min(end[0], COLS - 0.5) * CELL, end[1] * CELL, 12, 0, 7); g.fill();
      g.fillStyle = '#3a2d10'; g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('HQ', Math.min(end[0], COLS - 0.5) * CELL, end[1] * CELL);
      /* range of the selected tower, or of the one being placed */
      const showRange = (c, r, range, hue) => { g.fillStyle = hsl(hue, 80, 60, 0.15); g.strokeStyle = hsl(hue, 80, 70, 0.6); g.lineWidth = 2; g.beginPath(); g.arc((c + 0.5) * CELL, (r + 0.5) * CELL, range * CELL, 0, 7); g.fill(); g.stroke(); };
      const st = selTower();
      if (st) showRange(st.c, st.r, level(st.type, st.lv).range, TOWERS[st.type].hue);
      else { const hc = hover || (kbd ? cursor : null); if (hc && sim.canBuild(hc[0], hc[1])) showRange(hc[0], hc[1], TOWERS[buildType].range, TOWERS[buildType].hue); }
      for (const t of S.towers) drawTower(g, t, t.id === selected);
      for (const e of S.enemies) {
        const [x, y] = sim.enemyPos(e), d = ENEMIES[e.type], px = x * CELL, py = y * CELL, rad = d.r * CELL;
        const slowed = S.tick < e.slowUntil;
        g.fillStyle = hsl(d.hue, 70, slowed ? 70 : 52); g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke();
        g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(px - rad * 0.3, py - rad * 0.3, rad * 0.2, 0, 7); g.fill();
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(px - rad, py - rad - 7, rad * 2, 4);
        g.fillStyle = '#6dff8f'; g.fillRect(px - rad, py - rad - 7, rad * 2 * clamp(e.hp / e.max, 0, 1), 4);
      }
      if (!reduced) for (const f of S.fx) {
        const a = f.ttl / 8;
        if (f.k === 'shot') { g.strokeStyle = hsl(f.hue, 90, 70, a + 0.3); g.lineWidth = 3; g.beginPath(); g.moveTo(f.x * CELL, f.y * CELL); g.lineTo(f.x2 * CELL, f.y2 * CELL); g.stroke(); }
        else if (f.k === 'boom') { g.fillStyle = hsl(f.hue, 90, 60, a * 0.6); g.beginPath(); g.arc(f.x * CELL, f.y * CELL, f.r * CELL, 0, 7); g.fill(); }
        else if (f.k === 'pulse') { g.strokeStyle = hsl(f.hue, 90, 75, a); g.lineWidth = 3; g.beginPath(); g.arc(f.x * CELL, f.y * CELL, f.r * CELL * (1 - a * 0.3), 0, 7); g.stroke(); }
      }
      if (kbd && !ended) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(cursor[0] * CELL + 2, cursor[1] * CELL + 2, CELL - 4, CELL - 4); }
      g.restore();
      if (ended || paused) {
        g.fillStyle = 'rgba(6,8,14,.6)'; g.fillRect(0, 0, sf.w, sf.h);
        if (ended) { g.fillStyle = '#fff'; g.font = `800 26px ${FONT}`; g.textAlign = 'center'; g.fillText(S.status === 'won' ? 'Defended!' : 'Overrun', sf.w / 2, sf.h / 2); }
      }
    }
    function drawTower(g, t, sel) {
      const x = (t.c + 0.5) * CELL, y = (t.r + 0.5) * CELL, hue = TOWERS[t.type].hue;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x, y + 3, 18, 0, 7); g.fill();
      g.fillStyle = hsl(hue, 45, 28); g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill();
      g.fillStyle = hsl(hue, 80, 58);
      if (t.type === 'dart') { g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x + 11, y + 10); g.lineTo(x - 11, y + 10); g.closePath(); g.fill(); }
      else if (t.type === 'cannon') { g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill(); g.fillStyle = hsl(hue, 30, 22); g.fillRect(x - 4, y - 18, 8, 16); }
      else { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); } g.closePath(); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
      g.fillStyle = '#fff'; for (let i = 0; i < t.lv; i++) { g.beginPath(); g.arc(x - (t.lv - 1) * 4 + i * 8, y + 22, 2.4, 0, 7); g.fill(); }
      if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 2.5; rr(g, t.c * CELL + 2, t.r * CELL + 2, CELL - 4, CELL - 4, 8); g.stroke(); }
    }
    const loop = looper(dt => {
      if (paused || ended) return;
      const S = sim.S;
      if (S.status !== 'wave') { loop.stop(); draw(); return; }
      acc += dt * speed;
      let n = 0;
      while (acc >= TICK && n < 8) { acc -= TICK; n++; }
      if (n) advance(n);
      draw();
    });

    /* ---------- input ---------- */
    const cellOf = e => {
      const r = sf.cv.getBoundingClientRect();
      const c = Math.floor((e.clientX - r.left - V.ox) / V.s / CELL), rr2 = Math.floor((e.clientY - r.top - V.oy) / V.s / CELL);
      return c >= 0 && c < COLS && rr2 >= 0 && rr2 < ROWS ? [c, rr2] : null;
    };
    L.on(stage, 'pointerdown', e => {
      if (dead || e.button > 0) return;
      const c = cellOf(e);
      kbd = false;
      if (c) { e.preventDefault(); cellAct(c[0], c[1]); }
    });
    L.on(stage, 'pointermove', e => { if (dead || e.pointerType === 'touch') return; const c = cellOf(e); if (!hover || !c || hover[0] !== c[0] || hover[1] !== c[1]) { hover = c; if (!loop.on) draw(); } });
    L.on(stage, 'pointerleave', () => { hover = null; if (!loop.on) draw(); });
    const chooseTower = k => { buildType = k; selected = null; say(`${TOWERS[k].name}: ${TOWERS[k].blurb}, $${TOWERS[k].cost}.`); paintUI(); draw(); };
    towerBtns.forEach(b => L.on(b, 'click', () => { if (!dead) chooseTower(b.dataset.tower); }));
    L.on(upBtn, 'click', doUpgrade);
    L.on(sellBtn, 'click', doSell);
    L.on(waveBtn, 'click', sendWave);
    L.on(speedBtn, 'click', () => { if (!dead) setSpeed(speed === 1 ? 2 : speed === 2 ? 3 : 1); });
    L.on(seg, 'click', e => { const b = e.target.closest?.('button[data-map]'); if (b && !dead) newMap(b.dataset.map); });
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };   /* a Space aimed at the game must not also click the button you last used */
    const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const k = e.key;
      if (KEYS[k]) { e.preventDefault(); kbd = true; cursor = [clamp(cursor[0] + KEYS[k][0], 0, COLS - 1), clamp(cursor[1] + KEYS[k][1], 0, ROWS - 1)]; draw(); }
      else if (k === ' ' || k === 'Enter') { if (ended) return; e.preventDefault(); unfocus(); if (!e.repeat) { kbd = true; cellAct(cursor[0], cursor[1]); } }
      else if (k === '1' || k === '2' || k === '3') chooseTower(Object.keys(TOWERS)[Number(k) - 1]);
      else if (k === 'u' || k === 'U') doUpgrade();
      else if (k === 'x' || k === 'X' || k === 'Delete') doSell();
      else if (k === 'n' || k === 'N') sendWave();
      else if (k === 'f' || k === 'F') setSpeed(speed === 1 ? 2 : speed === 2 ? 3 : 1);
    });

    say(`${MAPS[mapId].name}: build towers beside the path, then send wave 1.`);
    paintUI(); draw();
    onScore(0);

    return {
      stop() { if (dead) return; dead = true; loop.stop(); L.clear(); sf.destroy(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; loop.stop(); draw(); },
      resume() { if (dead || !paused) return; paused = false; if (sim.S.status === 'wave' && !ended) loop.start(); draw(); },
      peek: () => {
        const S = sim.S;
        return {
          map: mapId, tick: S.tick, money: S.money, lives: S.lives, wave: S.wave, cleared: S.cleared, status: S.status, kills: S.kills, leaked: S.leaked, score: sim.score(),
          towers: S.towers.map(t => ({ id: t.id, type: t.type, c: t.c, r: t.r, lv: t.lv, spent: t.spent, sell: sim.sellValue(t) })),
          enemies: S.enemies.map(e => ({ id: e.id, type: e.type, hp: e.hp, p: e.p })), spawnsLeft: S.spawns.length,
          selected, buildType, speed, paused, ended, best: { ...bests },
          path: [...sim.map.blocked], free: [[1, 2], [3, 2], [3, 4], [8, 2], [4, 6], [6, 2]].filter(([c, r]) => sim.canBuild(c, r)),
          preview: S.status === 'wave' ? [] : wavePreview(S.wave + 1),
          geom: { ox: V.ox, oy: V.oy, cell: CELL * V.s },
        };
      },
      /* test hook — nothing in the game calls it:
         map(id) · step(ticks) · wave() · money(n) · place({ type, c, r }) · upgrade(id) · sell(id) · speed(n) */
      hook(cmd, arg) {
        if (cmd === 'map') newMap(arg);
        else if (cmd === 'step') advance(arg);
        else if (cmd === 'wave') { sim.startWave(); paintUI(); }
        else if (cmd === 'money') { sim.S.money = arg; }
        else if (cmd === 'place') sim.place(arg.type, arg.c, arg.r);
        else if (cmd === 'upgrade') sim.upgrade(arg);
        else if (cmd === 'sell') sim.sell(arg);
        else if (cmd === 'speed') speed = arg;
        paintUI(); draw();
        return true;
      },
    };
  },
};
