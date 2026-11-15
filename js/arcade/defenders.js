/* ============================================================
   arcade/defenders.js — Space Defenders for Static Arcade.

   A formation of aliens marches across the sky, drops a row each
   time it reaches an edge, and marches faster the fewer are left.
   Your cannon sits at the bottom behind four shields.

   · One shot of yours in the air at a time. Aliens drop bombs.
   · Shields are made of small blocks: every shot, yours or theirs,
     bites a chunk out of them, and an alien walking through one
     wipes it away.
   · A mystery ship crosses the top now and then: 50–300 points.
   · Three lives. The round ends when they are gone, or when the
     formation reaches the ground. Clear the formation for the
     next wave, which starts lower and moves faster.
   · Score: 30 / 20 / 10 for the top / middle / bottom aliens.
   · Every fifth wave is a boss: one mothership with a health bar that
     sweeps the sky and fires spreads of three (and, every third time,
     one aimed at you). Beating it pays 500 × (wave ÷ 5).
   · Weapon pick-ups: a destroyed alien now and then drops a capsule.
     Catch it with the cannon for 12 s of
       D  double shot: two shots side by side
       R  rapid fire: up to three shots in the air
       P  piercing shot: one shot goes through up to three aliens
     (a new one replaces the last; losing a life ends it).

   Keys: ← → / A D move, Space / ↑ / W fire. Touch: drag to steer,
   hold a finger down to keep firing.
   ============================================================ */
import { clamp, hsl, FONT, coarse, rng, randomSeed, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const W = 360, H = 480;
const PY = H - 40;                       /* the cannon's y */
const ROWS = 5, COLS = 9, GX = 30, GY = 26, STEP_PX = 6, DROP_PX = 14;
const EDGE = 14;
const SH_Y = 358, SH_CELL = 3, SH_W = 12, SH_H = 8;      /* a shield is 12 × 8 blocks of 3 px */
const SH_X = [38, 117, 195, 274];
const ROW_TYPE = [0, 1, 1, 2, 2], ROW_POINTS = [30, 20, 20, 10, 10], ROW_HUE = [300, 175, 175, 95, 95];
const UFO_POINTS = [50, 100, 150, 300];
const BOSS_EVERY = 5, BOSS_W = 88, BOSS_H = 30, BOSS_Y = 92;
const WEAPONS = {
  double: { letter: 'D', hue: 190, name: 'double shot' },
  rapid: { letter: 'R', hue: 50, name: 'rapid fire' },
  pierce: { letter: 'P', hue: 300, name: 'piercing shot' },
};
const WEAPON_SECS = 12, CAP_CHANCE = 0.08, CAP_V = 95;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                         /* ready | play | wave | dying | over */
      paused: false,
      rand: rng(randomSeed()),
      score: 0, lives: 3, wave: 1, time: 0,
      x: W / 2, held: new Set(), touch: null,
      shots: [], reload: 0, weapon: null, weaponT: 0, caps: [], boss: null, bosses: 0, gotCaps: 0,
      bombs: [], bombT: 1, hitT: 0, invuln: 0, waveT: 0, dieT: 0,
      alive: [], fx: 0, fy: 0, dir: 1, stepT: 0, frame: 0, freeze: false,
      shields: [], ufo: null, ufoT: 12, ufoN: 0,
      parts: [], pops: [],
    };
    const sf = surface(el, 'Space Defenders field', () => draw());
    let V = fitView(sf, W, H);

    const bossWave = () => S.wave % BOSS_EVERY === 0;
    function newWave() {
      const boss = bossWave();
      S.alive = Array.from({ length: ROWS }, () => Array(COLS).fill(!boss));
      S.fx = 50; S.fy = 66 + Math.min(S.wave - 1, 6) * 10;
      S.dir = 1; S.stepT = 0; S.shots = []; S.bombs = []; S.bombT = 1.2; S.caps = [];
      const hp = 24 + S.wave * 3;
      S.boss = boss ? { x: W / 2, dir: 1, hp, max: hp, fireT: 1.4, volley: 0, flash: 0 } : null;
    }
    function newShields() {
      S.shields = SH_X.map(() => {
        const g = new Uint8Array(SH_W * SH_H);
        for (let r = 0; r < SH_H; r++) for (let c = 0; c < SH_W; c++) {
          const notch = r >= SH_H - 3 && c >= 4 && c < SH_W - 4;
          const corner = r === 0 && (c < 2 || c >= SH_W - 2);
          g[r * SH_W + c] = notch || corner ? 0 : 1;
        }
        return g;
      });
    }
    newWave(); newShields();
    ctx.onScore(0);

    const count = () => S.alive.reduce((n, row) => n + row.filter(Boolean).length, 0);
    const ax = c => S.fx + c * GX, ay = r => S.fy + r * GY;
    const stepEvery = () => Math.max(0.04, (0.05 + 0.011 * count()) * Math.max(0.5, Math.pow(0.9, S.wave - 1)));

    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
    }

    /* ------------------------------ rules ------------------------------ */
    /* one shot in the air at a time — two side by side with double shot, three with rapid fire */
    function fire() {
      if (S.state !== 'play' || S.paused || S.hitT > 0 || S.reload > 0) return;
      const w = S.weapon;
      if (w === 'double') {
        if (S.shots.length) return;
        S.shots.push({ x: S.x - 6, y: PY - 14, left: 1 }, { x: S.x + 6, y: PY - 14, left: 1 });
      } else if (w === 'rapid') {
        if (S.shots.length >= 3) return;
        S.shots.push({ x: S.x, y: PY - 14, left: 1 });
        S.reload = 0.14;
      } else {
        if (S.shots.length) return;
        S.shots.push({ x: S.x, y: PY - 14, left: w === 'pierce' ? 3 : 1, pierce: w === 'pierce' });
      }
      snd.blip(w === 'pierce' ? 620 : 880, 0.07, 'square', 0.6, 300);
    }

    function march() {
      let minC = COLS, maxC = -1;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (S.alive[r][c]) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
      if (maxC < 0) return;
      const left = ax(minC) - 10 + S.dir * STEP_PX, right = ax(maxC) + 10 + S.dir * STEP_PX;
      if (left < EDGE || right > W - EDGE) { S.fy += DROP_PX; S.dir = -S.dir; }
      else S.fx += S.dir * STEP_PX;
      S.frame ^= 1;
      snd.blip(90 + (S.frame ? 0 : 25), 0.05, 'square', 0.5);
      /* walking through a shield wipes the blocks it touches */
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (!S.alive[r][c]) continue;
        const x0 = ax(c) - 10, x1 = ax(c) + 10, y0 = ay(r) - 8, y1 = ay(r) + 8;
        S.shields.forEach((g, i) => {
          for (let q = 0; q < SH_H; q++) for (let p = 0; p < SH_W; p++) {
            if (!g[q * SH_W + p]) continue;
            const bx = SH_X[i] + p * SH_CELL, by = SH_Y + q * SH_CELL;
            if (bx < x1 && bx + SH_CELL > x0 && by < y1 && by + SH_CELL > y0) g[q * SH_W + p] = 0;
          }
        });
      }
      /* reaching the cannon's row ends the round */
      for (let r = ROWS - 1; r >= 0; r--) if (S.alive[r].some(Boolean)) { if (ay(r) + 8 >= PY - 12) lose('invaded'); break; }
    }

    /* does a point hit a shield block? if so bite a chunk out of it */
    function shieldHit(x, y, up) {
      for (let i = 0; i < SH_X.length; i++) {
        const g = S.shields[i];
        const p = Math.floor((x - SH_X[i]) / SH_CELL), q = Math.floor((y - SH_Y) / SH_CELL);
        if (p < 0 || p >= SH_W || q < 0 || q >= SH_H || !g[q * SH_W + p]) continue;
        const deep = up ? 1 : 2;                        /* their bombs bite harder from above */
        for (let dq = -deep; dq <= deep; dq++) for (let dp = -1; dp <= 1; dp++) {
          const a = p + dp, b = q + (up ? -dq : dq);
          if (a >= 0 && a < SH_W && b >= 0 && b < SH_H && (Math.abs(dp) + Math.abs(dq) < 3 || S.rand() < 0.5)) g[b * SH_W + a] = 0;
        }
        return true;
      }
      return false;
    }

    function boom(x, y, hue, n) {
      if (reduced) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 90;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, hue });
      }
    }

    function lose(why) {
      if (why === 'invaded') { S.lives = 0; kill(); return; }
    }
    function kill() {
      boom(S.x, PY, 40, 26);
      snd.blip(180, 0.4, 'sawtooth', 1, 40);
      S.hitT = 1.1;
      S.shots = [];
      S.weapon = null; S.weaponT = 0;
      if (S.lives <= 0) { S.state = 'dying'; S.dieT = 0; S.hitT = 0; }
    }

    function update(dt) {
      S.time += dt;
      const playing = S.state === 'play';
      if (playing) {
        /* the cannon */
        if (S.hitT <= 0) {
          const dir = (S.held.has('l') ? -1 : 0) + (S.held.has('r') ? 1 : 0);
          if (dir) S.x += dir * 230 * dt;
          else if (S.touch) S.x += clamp(S.touch.x - S.x, -300 * dt, 300 * dt);
          S.x = clamp(S.x, 18, W - 18);
          if (S.held.has('f') || S.touch) fire();
        } else {
          S.hitT -= dt;
          if (S.hitT <= 0) S.invuln = 1.5;
        }
        if (S.invuln > 0) S.invuln -= dt;

        /* the formation */
        if (!S.freeze) {
          S.stepT += dt;
          let guard = 0;
          while (S.stepT >= stepEvery() && S.state === 'play' && guard++ < 8) { S.stepT -= stepEvery(); march(); }
          S.bombT -= dt;
          if (S.bombT <= 0 && S.state === 'play') {
            S.bombT = Math.max(0.35, (0.5 + S.rand() * 0.9) * Math.pow(0.92, S.wave - 1));
            dropBomb();
          }
        }

        /* mystery ship */
        if (!S.ufo) {
          S.ufoT -= dt;
          if (S.ufoT <= 0 && count() > 8) {
            const ltr = S.ufoN % 2 === 0;
            S.ufo = { x: ltr ? -20 : W + 20, v: ltr ? 80 : -80, pts: UFO_POINTS[Math.floor(S.rand() * UFO_POINTS.length)] };
            S.ufoN++;
          }
        } else {
          S.ufo.x += S.ufo.v * dt;
          if (S.ufo.x < -30 || S.ufo.x > W + 30) { S.ufo = null; S.ufoT = 18 + S.rand() * 10; }
        }

        /* the weapon running out */
        if (S.reload > 0) S.reload = Math.max(0, S.reload - dt);
        if (S.weaponT > 0) { S.weaponT -= dt; if (S.weaponT <= 0) { S.weaponT = 0; S.weapon = null; } }

        /* the boss: it sweeps the sky and fires spreads */
        const B = S.boss;
        if (B && !S.freeze) {
          B.x += B.dir * (55 + S.wave * 4) * dt;
          if (B.x < BOSS_W / 2 + 10) { B.x = BOSS_W / 2 + 10; B.dir = 1; } else if (B.x > W - BOSS_W / 2 - 10) { B.x = W - BOSS_W / 2 - 10; B.dir = -1; }
          B.fireT -= dt;
          if (B.fireT <= 0) {
            B.fireT = Math.max(0.65, 1.45 - S.wave * 0.04);
            B.volley++;
            if (B.volley % 3 === 0) {
              const dx = S.x - B.x, dy = PY - (BOSS_Y + 14), len = Math.hypot(dx, dy) || 1, v = 175;
              S.bombs.push({ x: B.x, y: BOSS_Y + 14, v: dy / len * v, vx: dx / len * v });
            } else for (const vx of [-70, 0, 70]) S.bombs.push({ x: B.x, y: BOSS_Y + 14, v: 150 + S.wave * 4, vx });
            snd.blip(160, 0.12, 'square', 0.6, 90);
          }
        }
        if (B && B.flash > 0) B.flash -= dt;

        /* my shots */
        for (const b of S.shots) {
          b.y -= 460 * dt;
          let gone = b.y < 20;
          if (!gone && shieldHit(b.x, b.y, true)) gone = true;
          if (!gone && S.ufo && Math.abs(b.x - S.ufo.x) < 16 && Math.abs(b.y - 36) < 10) {
            addScore(S.ufo.pts, S.ufo.x, 36, 330);
            snd.blip(1200, 0.3, 'triangle', 1, 300);
            S.ufo = null; S.ufoT = 18 + S.rand() * 10; gone = true;
          }
          if (!gone && B && Math.abs(b.x - B.x) < BOSS_W / 2 && Math.abs(b.y - BOSS_Y) < BOSS_H / 2) {
            B.hp--; B.flash = 0.08; gone = true;
            addScore(10, b.x, BOSS_Y + 18, 0);
            snd.blip(240, 0.05, 'square', 0.6, 160);
            if (B.hp <= 0) {
              S.bosses++;
              addScore(500 * (S.wave / BOSS_EVERY), B.x, BOSS_Y, 50);
              for (let i = 0; i < 4; i++) boom(B.x + (i - 1.5) * 20, BOSS_Y, [0, 50, 300, 190][i], 16);
              snd.blip(90, 0.6, 'sawtooth', 1, 40);
              S.boss = null;
            }
          }
          if (!gone) {
            for (let r = ROWS - 1; r >= 0 && !gone; r--) for (let c = 0; c < COLS; c++) {
              if (S.alive[r][c] && Math.abs(b.x - ax(c)) < 10 && Math.abs(b.y - ay(r)) < 9 && !(b.hit && b.hit.has(r * COLS + c))) {
                S.alive[r][c] = false;
                addScore(ROW_POINTS[r], ax(c), ay(r), ROW_HUE[r]);
                boom(ax(c), ay(r), ROW_HUE[r], 12);
                snd.blip(300, 0.1, 'sawtooth', 0.8, 90);
                if (S.rand() < CAP_CHANCE) S.caps.push({ x: ax(c), y: ay(r), kind: Object.keys(WEAPONS)[Math.floor(S.rand() * 3)] });
                /* a piercing shot carries on through */
                if (--b.left <= 0) gone = true;
                else (b.hit || (b.hit = new Set())).add(r * COLS + c);
                break;
              }
            }
          }
          if (gone) b.dead = true;
        }
        S.shots = S.shots.filter(b => !b.dead);
        /* capsules: catch one with the cannon */
        for (const cp of S.caps) {
          cp.y += CAP_V * dt;
          if (S.hitT <= 0 && Math.abs(cp.x - S.x) < 18 && cp.y > PY - 12 && cp.y < PY + 12) {
            cp.dead = true; S.weapon = cp.kind; S.weaponT = WEAPON_SECS; S.gotCaps++;
            snd.blip(660, 0.15, 'triangle', 0.8, 1320);
            S.pops.push({ x: S.x, y: PY - 20, n: WEAPONS[cp.kind].name, t: 0.9, hue: WEAPONS[cp.kind].hue });
          } else if (cp.y > H - 14) cp.dead = true;
        }
        S.caps = S.caps.filter(cp => !cp.dead);
        /* their bombs */
        for (const m of S.bombs) {
          m.y += m.v * dt;
          if (m.vx) m.x += m.vx * dt;
          if (shieldHit(m.x, m.y, false)) { m.dead = true; continue; }
          if (S.hitT <= 0 && S.invuln <= 0 && Math.abs(m.x - S.x) < 13 && m.y > PY - 8 && m.y < PY + 10) {
            m.dead = true; S.lives--; ctx.onScore(S.score); kill();
          } else if (m.y > H - 14) m.dead = true;
        }
        S.bombs = S.bombs.filter(m => !m.dead);

        if (S.state === 'play' && count() === 0 && !S.boss) { S.state = 'wave'; S.waveT = 1.6; S.shots = []; S.bombs = []; S.caps = []; snd.blip(660, 0.3, 'triangle', 0.9, 1320); }
      } else if (S.state === 'wave') {
        S.waveT -= dt;
        if (S.waveT <= 0) { S.wave++; newWave(); S.state = 'play'; }
      } else if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT >= 1) {
          S.state = 'over';
          ctx.onEnd({ score: S.score, won: false, detail: `Wave ${S.wave}${S.boss ? ' · the boss had ' + S.boss.hp + ' hits left' : count() ? ` · ${count()} aliens left` : ''}${S.bosses ? ` · ${S.bosses} boss${S.bosses === 1 ? '' : 'es'} beaten` : ''}` });
        }
      }
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
      for (const q of S.pops) q.t -= dt;
      S.pops = S.pops.filter(q => q.t > 0);
    }

    function dropBomb() {
      if (S.bombs.length >= 3 + Math.min(3, S.wave)) return;
      const cols = [];
      for (let c = 0; c < COLS; c++) for (let r = ROWS - 1; r >= 0; r--) if (S.alive[r][c]) { cols.push([r, c]); break; }
      if (!cols.length) return;
      /* a bomb aimed near the cannon every other time keeps the pressure on */
      let pick = cols[Math.floor(S.rand() * cols.length)];
      if (S.rand() < 0.5) pick = cols.reduce((b, q) => (Math.abs(ax(q[1]) - S.x) < Math.abs(ax(b[1]) - S.x) ? q : b), cols[0]);
      S.bombs.push({ x: ax(pick[1]), y: ay(pick[0]) + 10, v: 150 + S.wave * 10 });
    }
    function addScore(n, x, y, hue) {
      S.score += n; ctx.onScore(S.score);
      S.pops.push({ x, y, n, t: 0.7, hue });
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      update(dt);
      draw();
      if (S.state === 'over' && !S.parts.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function alien(g, type, x, y, hue, f) {
      g.fillStyle = hsl(hue, 85, 62);
      if (type === 0) {                                   /* a pod with feelers */
        g.beginPath(); g.ellipse(x, y, 9, 7, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = hsl(hue, 85, 62); g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 4, y - 6); g.lineTo(x - 7, y - 10 - f * 2); g.moveTo(x + 4, y - 6); g.lineTo(x + 7, y - 10 - f * 2);
        g.moveTo(x - 5, y + 5); g.lineTo(x - 6 - f * 2, y + 9); g.moveTo(x + 5, y + 5); g.lineTo(x + 6 + f * 2, y + 9); g.stroke();
      } else if (type === 1) {                            /* a crab */
        rr(g, x - 9, y - 5, 18, 10, 3); g.fill();
        g.strokeStyle = hsl(hue, 85, 62); g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x - 13, y - 3 + f * 6); g.moveTo(x + 9, y); g.lineTo(x + 13, y - 3 + f * 6);
        g.moveTo(x - 4, y + 5); g.lineTo(x - 5 - f * 2, y + 9); g.moveTo(x + 4, y + 5); g.lineTo(x + 5 + f * 2, y + 9); g.stroke();
      } else {                                            /* a jelly */
        g.beginPath(); g.arc(x, y - 1, 9, Math.PI, 0); g.lineTo(x + 9, y + 5);
        for (let i = 0; i < 4; i++) g.lineTo(x + 9 - (i + 1) * 4.5, y + 5 + ((i + f) % 2 ? 4 : 0));
        g.closePath(); g.fill();
      }
      g.fillStyle = '#0a0612';
      g.beginPath(); g.arc(x - 3.2, y - 1, 1.6, 0, Math.PI * 2); g.arc(x + 3.2, y - 1, 1.6, 0, Math.PI * 2); g.fill();
    }
    function cannon(g, x, y, hue, a = 1) {
      g.fillStyle = hsl(hue, 80, 62, a);
      rr(g, x - 14, y, 28, 9, 3); g.fill();
      rr(g, x - 8, y - 5, 16, 8, 3); g.fill();
      g.fillRect(x - 2, y - 12, 4, 9);
    }
    function ufo(g, x, y) {
      g.fillStyle = hsl(330, 90, 62);
      g.beginPath(); g.ellipse(x, y, 16, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = hsl(330, 90, 80);
      g.beginPath(); g.ellipse(x, y - 4, 8, 6, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#fff6c8';
      for (let i = -1; i <= 1; i++) g.fillRect(x + i * 8 - 1.5, y - 0.5, 3, 3);
    }

    /* the boss: a wide saucer with a dome, a row of lights and two cannons (flashes white when hit) */
    function mothership(g, B) {
      const x = B.x, y = BOSS_Y, hit = B.flash > 0 && !reduced;
      g.save();
      g.shadowBlur = reduced ? 0 : 16; g.shadowColor = hsl(0, 90, 55, 0.8);
      g.fillStyle = hit ? '#ffffff' : hsl(350, 70, 45);
      g.beginPath(); g.ellipse(x, y + 2, BOSS_W / 2, BOSS_H / 2 - 4, 0, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = hit ? '#ffe' : hsl(190, 80, 70, 0.9);
      g.beginPath(); g.ellipse(x, y - 6, 18, 12, 0, Math.PI, 0); g.fill();
      g.fillStyle = hsl(350, 60, 28);
      g.fillRect(x - 30, y + 8, 8, 8); g.fillRect(x + 22, y + 8, 8, 8);
      for (let i = -3; i <= 3; i++) {
        const on = reduced ? true : Math.floor(S.time * 6 + i) % 2 === 0;
        g.fillStyle = on ? '#ffe28a' : '#7a3a20';
        g.beginPath(); g.arc(x + i * 10, y + 4, 2.4, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }

    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, W, H);
      g.fillStyle = '#04050d';
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy);
      g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, W, H); g.clip();
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#080a24'); sky.addColorStop(1, '#14102e');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(220,230,255,.5)';
      for (let i = 0; i < 40; i++) g.fillRect((i * 97) % W, (i * 53) % (H - 80), 1.4, 1.4);
      g.strokeStyle = hsl(260, 60, 50, 0.6); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, H - 18); g.lineTo(W, H - 18); g.stroke();

      /* shields */
      g.fillStyle = hsl(140, 70, 52);
      S.shields.forEach((sh, i) => {
        for (let q = 0; q < SH_H; q++) for (let p = 0; p < SH_W; p++) if (sh[q * SH_W + p]) g.fillRect(SH_X[i] + p * SH_CELL, SH_Y + q * SH_CELL, SH_CELL, SH_CELL);
      });
      /* aliens */
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (S.alive[r][c]) alien(g, ROW_TYPE[r], ax(c), ay(r), ROW_HUE[r], S.frame);
      if (S.ufo) ufo(g, S.ufo.x, 36);
      if (S.boss) mothership(g, S.boss);
      /* shots (a piercing one is a longer, violet beam) */
      for (const b of S.shots) {
        g.fillStyle = b.pierce ? hsl(300, 100, 80) : '#f4fbff';
        g.fillRect(b.x - (b.pierce ? 2 : 1.5), b.y - (b.pierce ? 11 : 7), b.pierce ? 4 : 3, b.pierce ? 18 : 12);
      }
      /* weapon capsules on their way down */
      for (const cp of S.caps) {
        const wp = WEAPONS[cp.kind];
        g.fillStyle = hsl(wp.hue, 90, 55); rr(g, cp.x - 9, cp.y - 6, 18, 12, 6); g.fill();
        g.fillStyle = '#0a0612'; g.font = `800 9px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(wp.letter, cp.x, cp.y + 0.5);
        g.textBaseline = 'alphabetic';
      }
      g.strokeStyle = hsl(30, 100, 62); g.lineWidth = 2.4;
      for (const m of S.bombs) {
        g.beginPath(); g.moveTo(m.x - 3, m.y - 6); g.lineTo(m.x + 3, m.y - 2); g.lineTo(m.x - 3, m.y + 2); g.lineTo(m.x + 3, m.y + 6); g.stroke();
      }
      /* the cannon */
      if (S.hitT <= 0 && S.state !== 'dying' && S.state !== 'over') {
        const blink = S.invuln > 0 && !reduced && Math.floor(S.time * 10) % 2 === 0;
        if (!blink) cannon(g, S.x, PY, 200);
      } else if (S.state !== 'over' && !reduced) {
        g.fillStyle = hsl(30, 100, 60, 0.8);
        for (let i = 0; i < 6; i++) g.fillRect(S.x - 14 + ((i * 11 + S.time * 90) % 28), PY - ((i * 7 + S.time * 40) % 12), 4, 4);
      }
      for (const p of S.parts) { g.fillStyle = hsl(p.hue, 100, 65, clamp(p.life * 2.5, 0, 1)); g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
      g.font = `700 12px ${FONT}`; g.textAlign = 'center';
      for (const q of S.pops) { g.fillStyle = hsl(q.hue, 100, 80, clamp(q.t * 2, 0, 1)); g.fillText(String(q.n), q.x, q.y - (0.7 - q.t) * 24); }
      /* hud */
      g.textAlign = 'left'; g.fillStyle = hsl(260, 40, 78); g.font = `600 12px ${FONT}`;
      g.fillText(`WAVE ${S.wave}${bossWave() ? ' · BOSS' : ''}`, 10, 18);
      for (let i = 0; i < Math.max(0, S.lives); i++) cannon(g, W - 24 - i * 34, 8, 200, 0.9);
      if (S.weapon) {
        const wp = WEAPONS[S.weapon];
        g.fillStyle = hsl(wp.hue, 90, 70); g.font = `700 11px ${FONT}`; g.textAlign = 'left';
        g.fillText(wp.name.toUpperCase(), 10, H - 4);
        g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(110, H - 10, 60, 3);
        g.fillStyle = hsl(wp.hue, 90, 60); g.fillRect(110, H - 10, 60 * S.weaponT / WEAPON_SECS, 3);
      }
      if (S.boss) {
        const B = S.boss;
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(W / 2 - 80, 26, 160, 5);
        g.fillStyle = hsl(0, 90, 58); g.fillRect(W / 2 - 80, 26, 160 * B.hp / B.max, 5);
      }
      if (S.state === 'wave') {
        g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `800 22px ${FONT}`;
        g.fillText(bossWave() ? `Boss beaten · +${500 * S.wave / BOSS_EVERY}` : `Wave ${S.wave} cleared`, W / 2, H / 2 - 20);
      }
      g.restore();
      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Touch and drag to start' : 'Press Space or an arrow to start', coarse() ? 'Drag to steer; hold to keep firing' : '← → move · Space fire', 260, sf.h * 0.62);
    }

    /* ------------------------------ input ------------------------------ */
    const KEY = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ' ': 'f', ArrowUp: 'f', w: 'f' };
    const keyOf = e => KEY[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      if (S.paused) return;
      snd.wake();
      begin();
      S.held.add(k);
      if (k === 'f') fire();
    };
    const onKeyUp = e => { const k = keyOf(e); if (k) S.held.delete(k); };
    const releaseAll = () => { S.held.clear(); S.touch = null; };
    const place = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - V.ox) / V.s };
    };
    const onDown = e => {
      if (S.paused) return;
      snd.wake(); begin();
      S.touch = place(e);
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    };
    const onMove = e => { if (S.touch) S.touch = place(e); };
    const onUp = () => { S.touch = null; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    draw();
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', releaseAll);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; releaseAll(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests */
      peek: () => {
        const aliens = [];
        S.alive.forEach((row, r) => row.forEach((on, c) => { if (on) aliens.push({ r, c, x: ax(c), y: ay(r) }); }));
        return {
          state: S.state, paused: S.paused, score: S.score, lives: S.lives, wave: S.wave, x: S.x, time: S.time,
          alive: aliens.length, aliens, bullet: S.shots[0] ? { x: S.shots[0].x, y: S.shots[0].y } : null, shots: S.shots.length, bombs: S.bombs.length,
          weapon: S.weapon, weaponT: S.weaponT, caps: S.caps.map(c => ({ kind: c.kind, x: c.x, y: c.y })), gotCaps: S.gotCaps,
          boss: S.boss ? { x: S.boss.x, hp: S.boss.hp, max: S.boss.max } : null, bosses: S.bosses, bossWave: bossWave(),
          shields: S.shields.map(g => g.reduce((n, v) => n + v, 0)), shieldX: SH_X.slice(), ufo: S.ufo ? { x: S.ufo.x, pts: S.ufo.pts } : null,
          stepEvery: stepEvery(), freeze: S.freeze,
        };
      },
      /* test hook — nothing in the game calls it:
         step(seconds) · freeze(bool: the formation and its bombs stand still) · ship(x) · ufo() */
      hook(cmd, arg) {
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'freeze') S.freeze = !!arg;
        else if (cmd === 'ship') S.x = clamp(arg, 18, W - 18);
        else if (cmd === 'ufo') S.ufo = { x: arg, v: 0, pts: 150 };
        else if (cmd === 'wave') { S.wave = arg; newWave(); S.state = 'play'; }      /* jump to wave n (5, 10…: a boss) */
        else if (cmd === 'cap') S.caps.push({ x: arg.x, y: arg.y ?? PY - 60, kind: arg.kind });
        else if (cmd === 'bosshp') { if (S.boss) S.boss.hp = arg; }
        else if (cmd === 'bossx') { if (S.boss) S.boss.x = arg; }
        draw();
        return true;
      },
    };
  },
};
