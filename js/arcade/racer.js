/* ============================================================
   arcade/racer.js — Neon Lanes for Static Arcade.

   Three lanes, traffic ahead, and a speed that only goes up
   (from ~94 km/h to a cap of ~340). Change lanes with ← → / A D,
   by tapping the left or right half of the road, or with a swipe.
   Score = distance driven, in metres.

   The road is a small pseudo-3D projection: world units are metres,
   a point `z` metres ahead lands on screen at scale Z0 / (Z0 + z)
   below a synthwave horizon. Traffic comes in rows that never block
   all three lanes, and every row travels at the same speed, so rows
   never close up on each other — there is always a way through, and
   rows are spaced so a double lane change fits between them.

   Seeds and ghosts (index.js SHARED OPTIONS): the traffic comes from
   ctx.seed and the clock, never from how you drive, so a seed is a
   course. The road runs in fixed 1/120 s steps and every lane change
   is logged by its step: onEnd({ replay: { v: 1, steer: [[step, ±1],
   …], pk: 1, mode? } }) played back on the same seed and mode is the
   same drive. ctx.ghost.watch plays it back; otherwise a see-through
   ghost car drives it beside you. ctx.speed scales the clock.

   Pick-ups ride along with the traffic, laid out from a stream of the
   seed of their own (so a seed's traffic is what it always was):
     spark   trails of three in an open lane; every 10 sparks earn a
             shield. They are counted in the result, not in the score,
             which stays the distance driven.
     shield  one crash goes through instead of ending the drive (you
             can hold three).
     magnet  for 8 s, sparks in every lane come to you.
   Each car keeps its own pick-ups and shields, so the ghost's drive
   is its own. A replay from before pick-ups (no pk) is raced and
   watched on a road without them, as it was driven.

   Rain (ctx.mode 'rain', its own best and ghost): a wet road where a
   lane change takes longer, spray, and traffic that only shows up out
   of the murk 120 m ahead. Reduced motion keeps the rain still.

   Follows the module contract in ./index.js.
   ============================================================ */

const HUE = 300;
const LANE = 3.5;                  /* metres */
const Z0 = 6;                      /* camera focal distance */
const PZ = 4.5;                    /* the player's car, metres ahead of the lens */
const FAR = 220;
const CAR_W = 2.0, CAR_L = 4.2;
const TRAFFIC = 6;                 /* m/s — everyone else */
const V0 = 26, VMAX = 95;          /* m/s */
const TRAFFIC_HUES = [185, 150, 45, 210];
const STEP = 1 / 120;
const MAGNET_SECS = 8, SPARKS_PER_SHIELD = 10, MAX_SHIELDS = 3;
const FOG = 120;                   /* Rain: metres you can see ahead */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const rand = rng(seed);
    const speedK = clamp(Number(ctx.speed) || 1, 0.5, 1);
    const MODE = ctx.mode === 'rain' ? 'rain' : 'clear', rain = MODE === 'rain';
    /* a replay this module wrote (see the header): watched on its own, or driven by a ghost car — in its own mode */
    const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 && Array.isArray(ctx.ghost.data.steer) && ctx.ghost.data.steer.length < 50000
      && (ctx.ghost.data.mode || 'clear') === MODE ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);
    /* pick-ups are on the road unless this round replays a drive from before they were */
    const PK = !GH || GH.data.pk === 1;
    const randP = rng((seed ^ 0x9e3779b9) >>> 0);
    const kit = () => ({ shields: 0, sparks: 0, toShield: 0, magnet: 0, used: 0 });
    const S = {
      state: 'ready',          /* ready | play | crash | over */
      paused: false,
      lane: 1, x: 0,
      v: V0, vTop: V0, dist: 0, t: 0, time: 0,
      cars: [], lastRowZ: 0, picks: [],
      crashT: 0, shake: 0, flash: 0, shieldFx: 0,
      parts: [], reported: -1,
      roll: 0, n: 0, acc: 0, want: [], li: 0, watchT: 0,   /* the waiting roll (drawing only), steps, queued lane changes */
      ...kit(),
    };
    const log = [];            /* [step, ±1] for every lane change: the replay */
    const G = GH && !watch ? { lane: 1, x: 0, li: 0, dead: false, deadT: 0, ...kit() } : null;
    const sf = surface(el, 'Neon Lanes road', () => draw());
    ctx.onScore(0);
    /* the first rows are already on the road, waiting */
    for (let z = 70; z < FAR; z += 32) spawnRow(z);

    /* ------------------------------ projection ------------------------------ */
    function cam() {
      const W = sf.w, H = sf.h;
      const hz = Math.round(H * 0.44);
      const M = Math.min(W, H * 1.7) * 0.44 / (1.5 * LANE);   /* px per metre at z = 0 */
      const sx = S.shake > 0 ? (Math.random() - 0.5) * 10 * S.shake : 0;
      return { W, H, hz, gh: H - hz, M, cx: W / 2 + sx - S.x * M * 0.12 };
    }
    const P = z => Z0 / (Z0 + Math.max(-Z0 * 0.9, z));
    const sy = (c, z) => c.hz + c.gh * P(z);
    const sxm = (c, xm, z) => c.cx + xm * c.M * P(z);

    /* ------------------------------ rules ------------------------------ */
    function spawnRow(z) {
      const twoBlocked = rand() < Math.min(0.55, 0.18 + S.t * 0.008);
      /* a fair shuffle of the three lanes, from the seed */
      const order = [0, 1, 2];
      for (let i = 2; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const lanes = order.slice(0, twoBlocked ? 2 : 1);
      for (const l of lanes) {
        S.cars.push({ lane: l, x: (l - 1) * LANE, z: z + rand() * 3, hue: TRAFFIC_HUES[Math.floor(rand() * TRAFFIC_HUES.length)] });
      }
      S.lastRowZ = z;
      if (PK) spawnPicks(z, order.slice(twoBlocked ? 2 : 1));
    }
    /* after a row, in one of its open lanes: now and then a trail of sparks, a shield or a magnet (their own stream of the seed) */
    function spawnPicks(z, open) {
      const r = randP(), lane = open[Math.floor(randP() * open.length)];
      const x = (lane - 1) * LANE;
      if (r < 0.32) for (let i = 0; i < 3; i++) S.picks.push({ kind: 'spark', lane, x, z: z + 9 + i * 4 });
      else if (r < 0.355) S.picks.push({ kind: 'shield', lane, x, z: z + 14 });
      else if (r < 0.39) S.picks.push({ kind: 'magnet', lane, x, z: z + 14 });
    }
    /* what a car picks up as it passes (yours, or the ghost's own copy: `who` marks it taken for that car only) */
    function collect(car, who) {
      for (const p of S.picks) {
        if (p[who] || Math.abs(p.z - PZ) > CAR_L * 0.6) continue;
        const reach = p.kind === 'spark' && car.magnet > 0 ? LANE * 3 : CAR_W * 0.9;
        if (Math.abs(p.x - car.x) > reach) continue;
        p[who] = true;
        if (p.kind === 'spark') {
          car.sparks++;
          if (++car.toShield >= SPARKS_PER_SHIELD) { car.toShield = 0; car.shields = Math.min(MAX_SHIELDS, car.shields + 1); }
          if (car === S) { snd.blip(1180, 0.04, 'triangle', 0.4, 1560); if (car.magnet > 0 && Math.abs(p.x - car.x) > CAR_W && !reduced) S.parts.push({ x: (p.x - car.x) * 20, y: -20, vx: 0, vy: 0, life: 0.25, hue: 55, pull: true }); }
        } else if (p.kind === 'shield') {
          car.shields = Math.min(MAX_SHIELDS, car.shields + 1);
          if (car === S) snd.blip(660, 0.12, 'sine', 0.7, 990);
        } else {
          car.magnet = MAGNET_SECS;
          if (car === S) snd.blip(420, 0.15, 'triangle', 0.7, 840);
        }
      }
    }
    /* a crash with a shield up: the shield goes, and that car is gone for this driver only */
    function shielded(car, hit, who) {
      if (car.shields <= 0) return false;
      car.shields--; car.used++;
      hit[who] = true;
      if (car === S) { S.shieldFx = 0.5; S.flash = reduced ? 0 : 0.12; snd.blip(300, 0.2, 'square', 0.8, 900); }
      return true;
    }

    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
      S.n = 0;
      S.acc = 0;
    }

    /* a press is taken at the next step (and logged there), so a replay can make it at the same one */
    function steer(d) {
      if (watch || S.paused || S.state === 'crash' || S.state === 'over') return;
      if (S.state === 'ready') { begin(); }
      if (S.want.length < 4) S.want.push(d);
    }
    function change(car, d) {
      const next = clamp(car.lane + d, 0, 2);
      if (next === car.lane) return;
      car.lane = next;
      if (car === S) snd.blip(d < 0 ? 440 : 520, 0.04, 'square', 0.5);
    }
    /* the lane changes a replay made at this step */
    function replayed(car, list) {
      while (car.li < list.length && list[car.li][0] < S.n) car.li++;
      while (car.li < list.length && list[car.li][0] === S.n) change(car, Math.sign(list[car.li++][1]) || 0);
    }

    function crash(car) {
      S.state = 'crash';
      S.crashT = 0;
      S.shake = reduced ? 0 : 1;
      S.flash = reduced ? 0 : 0.2;
      snd.blip(160, 0.45, 'sawtooth', 1, 40);
      if (!reduced) {
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
          S.parts.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.6 + Math.random() * 0.4, hue: Math.random() < 0.5 ? HUE : car.hue });
        }
      }
    }

    /* ------------------------------ loop ------------------------------ */
    /* one fixed step of the road: the same steps, the same drive */
    /* a lane change takes 0.13 s, or (Rain, on a wet road) 0.24 s */
    const SHIFT = rain ? 0.24 : 0.13;
    const glide = (car, dt) => { const target = (car.lane - 1) * LANE; car.x += clamp(target - car.x, -LANE / SHIFT * dt, LANE / SHIFT * dt); };
    /* `who` is the driver ('s' you, 'g' the ghost): a car one of them went through with a shield is gone for that one */
    const hitBy = (car, who = 's') => S.cars.find(c => !c[who] && Math.abs(c.z - PZ) < CAR_L * 0.92 && Math.abs(c.x - car.x) < CAR_W * 0.92) || null;
    function step(dt) {
      if (S.state === 'play') {
        if (watch) replayed(S, GH.data.steer);
        else for (const d of S.want.splice(0)) { log.push([S.n, d]); change(S, d); }
        if (G && !G.dead) replayed(G, GH.data.steer);
      }
      glide(S, dt);
      if (G && !G.dead) glide(G, dt);
      if (S.state === 'play') {
        S.t += dt;
        S.v = Math.min(VMAX, V0 + S.t * 1.05);
        S.vTop = Math.max(S.vTop, S.v);
        S.dist += S.v * dt;
        const rel = S.v - TRAFFIC;
        for (const c of S.cars) c.z -= rel * dt;
        S.cars = S.cars.filter(c => c.z > -8);
        for (const p of S.picks) p.z -= rel * dt;
        S.picks = S.picks.filter(p => p.z > -8);
        S.lastRowZ -= rel * dt;
        const gap = Math.max(30, rel * 0.95);
        if (S.lastRowZ < FAR - gap) spawnRow(FAR);
        if (S.magnet > 0) S.magnet = Math.max(0, S.magnet - dt);
        collect(S, 's');
        if (G && !G.dead) {
          if (G.magnet > 0) G.magnet = Math.max(0, G.magnet - dt);
          collect(G, 'g');
          const gh = hitBy(G, 'g');
          if (gh && !shielded(G, gh, 'g')) { G.dead = true; G.deadAt = S.n; }
        }
        const hit = hitBy(S, 's');
        if (hit && !shielded(S, hit, 's')) crash(hit);
        const m = Math.floor(S.dist);
        if (m !== S.reported) { S.reported = m; ctx.onScore(m); }
        S.n++;
      } else if (S.state === 'crash') {
        S.crashT += dt;
        S.v = Math.max(0, S.v - 120 * dt);
        S.dist += S.v * dt * 0.2;
        if (S.crashT > 1.1) {
          S.state = 'over';
          draw();
          const got = PK ? ` · ${S.sparks} spark${S.sparks === 1 ? '' : 's'}${S.used ? ` · ${S.used} crash${S.used === 1 ? '' : 'es'} shielded` : ''}` : '';
          ctx.onEnd({
            score: Math.floor(S.dist), won: false,
            detail: `Top speed ${Math.round(S.vTop * 3.6)} km/h${got}`,
            replay: watch ? undefined : { v: 1, steer: log.slice(), ...(PK ? { pk: 1 } : {}), ...(rain ? { mode: 'rain' } : {}) },
          });
        }
      }
      if (G && G.dead) G.deadT += dt;
    }

    const loop = looper(raw => {
      const dt = raw * speedK;
      S.time += dt;
      if (S.state === 'ready') {
        glide(S, dt);
        S.roll += 6 * dt;                   /* a slow roll so the road is alive (the drive starts at 0 m) */
        if (watch) { S.watchT += raw; if (S.watchT > 0.7) begin(); }
      } else if (S.state === 'play' || S.state === 'crash') {
        S.acc += dt;
        let k = 0;
        while (S.acc >= STEP - 1e-9 && k < 12 && S.state !== 'over') { step(STEP); S.acc -= STEP; k++; }
        if (k >= 12) S.acc = 0;               /* a stalled tab doesn't fast-forward */
      }
      for (const q of S.parts) { if (q.pull) { q.x *= 0.7; q.y *= 0.7; } else { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 400 * dt; } q.life -= dt; }
      S.parts = S.parts.filter(q => q.life > 0);
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 1.6);
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
      if (S.shieldFx > 0) S.shieldFx = Math.max(0, S.shieldFx - dt);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      const g = sf.g;
      sf.begin();
      const c = cam();
      const { W, H, hz } = c;

      /* sky */
      const sky = g.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, '#07021a');
      sky.addColorStop(0.55, '#260a3d');
      sky.addColorStop(1, hsl(HUE + 20, 85, 32));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, hz + 1);
      /* stars */
      g.fillStyle = 'rgba(255,230,255,.5)';
      for (let i = 0; i < 40; i++) {
        const x = (i * 97.3) % W, y = ((i * 53.7) % (hz * 0.6));
        g.fillRect(x, y, 1.4, 1.4);
      }
      /* sun with slats cut out of it */
      const R = Math.min(W, H) * 0.2;
      const sunY = hz - R * 0.25;
      const sun = g.createLinearGradient(0, sunY - R, 0, sunY + R);
      sun.addColorStop(0, '#ffe46b');
      sun.addColorStop(0.55, '#ff7a59');
      sun.addColorStop(1, hsl(HUE + 25, 100, 55));
      g.save();
      g.beginPath();
      g.rect(0, 0, W, hz);
      g.clip();
      g.shadowBlur = 40;
      g.shadowColor = hsl(HUE + 30, 100, 60, 0.6);
      g.fillStyle = sun;
      g.beginPath(); g.arc(W / 2, sunY, R, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = sky;
      for (let i = 0; i < 6; i++) {
        const y = sunY + R * (0.05 + i * 0.17);
        g.fillRect(W / 2 - R - 2, y, R * 2 + 4, 1.5 + i * 1.6);
      }
      g.restore();
      /* mountains */
      g.fillStyle = '#12041f';
      g.strokeStyle = hsl(HUE, 100, 65, 0.55);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, hz);
      const shift = S.x * 6;
      const ridge = [0, 0.3, 0.08, 0.55, 0.15, 0.42, 0.05, 0.62, 0.2, 0.35, 0.02, 0.5, 0.12, 0.3, 0];
      ridge.forEach((r, i) => g.lineTo((i / (ridge.length - 1)) * (W + 60) - 30 - shift, hz - r * H * 0.12));
      g.lineTo(W, hz);
      g.closePath();
      g.fill();
      g.stroke();

      /* ground */
      const ground = g.createLinearGradient(0, hz, 0, H);
      ground.addColorStop(0, '#1a0526');
      ground.addColorStop(1, '#06010c');
      g.fillStyle = ground;
      g.fillRect(0, hz, W, H - hz);

      /* the grid either side of the road */
      g.strokeStyle = hsl(HUE, 100, 60, 0.28);
      g.lineWidth = 1;
      g.beginPath();
      const step = 10, off = (S.dist + S.roll) % step;
      for (let z = step - off; z < FAR; z += step) {
        const y = sy(c, z);
        g.moveTo(0, y); g.lineTo(W, y);
      }
      for (let n = -14; n <= 14; n++) {
        const xm = n * 5;
        g.moveTo(sxm(c, xm, -Z0 * 0.6), sy(c, -Z0 * 0.6));
        g.lineTo(sxm(c, xm, FAR * 4), sy(c, FAR * 4));
      }
      g.stroke();

      /* road */
      const half = 1.5 * LANE + 0.4;
      const zn = -Z0 * 0.6, zf = FAR * 4;
      g.fillStyle = '#0b0413';
      g.beginPath();
      g.moveTo(sxm(c, -half, zn), sy(c, zn));
      g.lineTo(sxm(c, -half, zf), sy(c, zf));
      g.lineTo(sxm(c, half, zf), sy(c, zf));
      g.lineTo(sxm(c, half, zn), sy(c, zn));
      g.closePath();
      g.fill();
      /* neon edges */
      g.save();
      g.shadowBlur = 16;
      g.shadowColor = hsl(HUE, 100, 60, 0.95);
      g.strokeStyle = hsl(HUE, 100, 68);
      g.lineWidth = 3;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(sxm(c, s * half, zn), sy(c, zn));
        g.lineTo(sxm(c, s * half, zf), sy(c, zf));
        g.stroke();
      }
      g.restore();
      /* lane dashes */
      g.fillStyle = 'rgba(255,220,250,.75)';
      const dash = 12, doff = (S.dist + S.roll) % dash;
      for (const lx of [-LANE / 2, LANE / 2]) {
        for (let z = -doff - dash; z < FAR; z += dash) {
          const z1 = Math.max(zn, z), z2 = z + 5;
          if (z2 <= zn) continue;
          const w = 0.12;
          g.beginPath();
          g.moveTo(sxm(c, lx - w, z1), sy(c, z1));
          g.lineTo(sxm(c, lx - w, z2), sy(c, z2));
          g.lineTo(sxm(c, lx + w, z2), sy(c, z2));
          g.lineTo(sxm(c, lx + w, z1), sy(c, z1));
          g.closePath();
          g.fill();
        }
      }
      /* horizon haze */
      const haze = g.createLinearGradient(0, hz - 6, 0, hz + 40);
      haze.addColorStop(0, hsl(HUE + 20, 100, 60, 0.35));
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = haze;
      g.fillRect(0, hz - 6, W, 46);

      /* Rain: what is far off fades into the murk */
      const seen = z => (rain ? clamp((FOG - z) / (FOG * 0.45), 0, 1) : 1);
      /* pick-ups lie on the road (far first); the ones you took are gone */
      for (const p of S.picks.slice().sort((a, b) => b.z - a.z)) {
        if (p.s || p.z > FAR || p.z < -Z0 * 0.5 || seen(p.z) <= 0) continue;
        g.save();
        g.globalAlpha = seen(p.z);
        pickup(g, c, p);
        g.restore();
      }
      /* traffic (far first), with the player slotted in by depth */
      const list = S.cars.slice().sort((a, b) => b.z - a.z);
      let drewPlayer = false;
      for (const car of list) {
        if (!drewPlayer && car.z < PZ) { player(g, c); drewPlayer = true; }
        if (car.z > FAR || seen(car.z) <= 0) continue;
        g.save();
        g.globalAlpha = seen(car.z) * (car.s ? 0.3 : 1);       /* a car you went through on a shield */
        vehicle(g, c, car.x, car.z, car.hue, false);
        g.restore();
      }
      if (!drewPlayer) player(g, c);
      if (rain) weather(g, c);

      /* speed streaks */
      if (!reduced && S.state === 'play' && S.v > 45) {
        const a = clamp((S.v - 45) / 50, 0, 1) * 0.35;
        g.strokeStyle = `rgba(255,200,255,${a})`;
        g.lineWidth = 1.5;
        for (let i = 0; i < 10; i++) {
          const side = i % 2 ? 1 : -1;
          const z = ((i * 23 + (S.dist + S.roll) * 2.2) % 60);
          const x1 = sxm(c, side * (half + 1 + (i % 3)), 60 - z), y1 = sy(c, 60 - z);
          const x2 = sxm(c, side * (half + 1 + (i % 3)), 60 - z - 8), y2 = sy(c, 60 - z - 8);
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
      }

      /* crash sparks */
      if (S.parts.length) {
        const px = sxm(c, S.x, PZ), py = sy(c, PZ) - CAR_W * c.M * P(PZ) * 0.3;
        for (const q of S.parts) {
          g.fillStyle = hsl(q.hue, 100, 70, clamp(q.life * 1.8, 0, 1));
          g.fillRect(px + q.x - 2, py + q.y - 2, 4, 4);
        }
      }

      /* speedo */
      const kmh = Math.round(S.v * 3.6);
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.font = `800 ${Math.round(clamp(W / 22, 18, 30))}px ${MONO}`;
      g.fillStyle = '#ffe9ff';
      g.shadowBlur = 12;
      g.shadowColor = hsl(HUE, 100, 60, 0.9);
      g.fillText(String(kmh), 16, H - 18);
      const tw = g.measureText(String(kmh)).width;
      g.shadowBlur = 0;
      g.font = `600 11px ${FONT}`;
      g.fillStyle = 'rgba(255,220,255,.6)';
      g.fillText('km/h', 22 + tw, H - 20);
      /* shields held, sparks towards the next one, and the magnet's time left */
      if (PK) {
        g.textAlign = 'right';
        let rx = W - 16;
        for (let i = 0; i < MAX_SHIELDS; i++) { shieldIcon(g, rx - 9, H - 26, 8, i < S.shields); rx -= 22; }
        g.font = `700 12px ${MONO}`;
        g.fillStyle = 'rgba(255,240,170,.9)';
        g.fillText(`✦ ${S.toShield}/${SPARKS_PER_SHIELD}`, rx - 4, H - 21);
        if (S.magnet > 0) {
          const bw = 70;
          g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(W - 16 - bw, H - 44, bw, 4);
          g.fillStyle = hsl(10, 100, 62); g.fillRect(W - 16 - bw, H - 44, bw * S.magnet / MAGNET_SECS, 4);
          g.font = `600 10px ${FONT}`; g.fillStyle = 'rgba(255,220,210,.85)'; g.fillText('MAGNET', W - 16, H - 50);
        }
        g.textAlign = 'left';
      }

      if (S.flash > 0) {
        g.fillStyle = `rgba(255,255,255,${S.flash * 2.5})`;
        g.fillRect(0, 0, W, H);
      }

      if (S.state === 'ready') {
        if (watch) prompt(g, sf, 'Replay of your best run', 'Played back from the lane changes it made', HUE, hz + (H - hz) * 0.42);
        else prompt(g, sf, coarse() ? 'Tap a side or swipe to change lanes' : '← → or tap a side to change lanes', G ? 'Race your ghost — the pale car is your best run'
          : rain ? 'Rain: a slippery road, and traffic shows up late' : PK ? 'Dodge the traffic · 10 sparks make a shield' : 'Dodge the traffic — it only gets faster', HUE, hz + (H - hz) * 0.42);
      }
    }

    /* a pick-up on the road: a spark (a gold diamond), a shield (a blue crest) or a magnet (a red horseshoe) */
    function pickup(g, c, p) {
      const k = P(p.z), s = c.M * k;
      const x = sxm(c, p.x, p.z), y = sy(c, p.z) - s * 0.7;
      if (s < 1) return;
      const bob = reduced ? 0 : Math.sin(S.time * 5 + p.z) * s * 0.08;
      if (p.kind === 'spark') {
        g.fillStyle = 'rgba(255,220,90,.25)'; g.beginPath(); g.arc(x, y + bob, s * 0.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffd34d';
        g.beginPath(); g.moveTo(x, y + bob - s * 0.35); g.lineTo(x + s * 0.24, y + bob); g.lineTo(x, y + bob + s * 0.35); g.lineTo(x - s * 0.24, y + bob); g.closePath(); g.fill();
      } else if (p.kind === 'shield') shieldIcon(g, x, y + bob, s * 0.45, true);
      else {
        g.strokeStyle = hsl(5, 95, 60); g.lineWidth = Math.max(1.5, s * 0.16); g.lineCap = 'butt';
        g.beginPath(); g.arc(x, y + bob, s * 0.3, Math.PI, 0, true); g.stroke();
        g.strokeStyle = '#e8eef8';
        g.beginPath(); g.moveTo(x - s * 0.3, y + bob); g.lineTo(x - s * 0.3, y + bob - s * 0.12); g.moveTo(x + s * 0.3, y + bob); g.lineTo(x + s * 0.3, y + bob - s * 0.12); g.stroke();
      }
    }
    function shieldIcon(g, x, y, r, on) {
      g.beginPath();
      g.moveTo(x, y - r); g.lineTo(x + r * 0.85, y - r * 0.6); g.lineTo(x + r * 0.7, y + r * 0.35); g.lineTo(x, y + r); g.lineTo(x - r * 0.7, y + r * 0.35); g.lineTo(x - r * 0.85, y - r * 0.6); g.closePath();
      g.fillStyle = on ? hsl(195, 100, 60, 0.9) : 'rgba(255,255,255,.12)';
      g.fill();
      g.strokeStyle = on ? '#dff7ff' : 'rgba(255,255,255,.25)'; g.lineWidth = 1.2; g.stroke();
    }
    /* Rain: a murky band over the horizon, and streaks (still under reduced motion) */
    function weather(g, c) {
      const { W, H, hz } = c;
      const murk = g.createLinearGradient(0, hz - 30, 0, hz + (H - hz) * 0.35);
      murk.addColorStop(0, 'rgba(70,60,100,.55)'); murk.addColorStop(1, 'rgba(70,60,100,0)');
      g.fillStyle = murk; g.fillRect(0, hz - 30, W, (H - hz) * 0.35 + 30);
      g.strokeStyle = 'rgba(200,215,255,.32)'; g.lineWidth = 1;
      g.beginPath();
      const t = reduced ? 0 : S.time;
      for (let i = 0; i < 70; i++) {
        const x = ((i * 137.5 + t * 90) % (W + 40)) - 20, y = ((i * 71.3 + t * (520 + (i % 5) * 40)) % (H + 30)) - 15;
        g.moveTo(x, y); g.lineTo(x - 3, y + 13);
      }
      g.stroke();
    }

    function player(g, c) {
      /* the ghost: your best run's car, see-through, at the same distance (the traffic is the same for both) */
      if (G && S.state !== 'ready' && !(G.dead && G.deadT > 0.9)) {
        g.save();
        g.globalAlpha = 0.42 * (G.dead ? clamp(1 - G.deadT / 0.9, 0, 1) : 1);
        vehicle(g, c, G.x, PZ, 200, false);
        g.restore();
      }
      vehicle(g, c, S.x, PZ, HUE, true);
      /* a shield up: a ring round the car (bright just after it took a crash); a magnet: a red glow under it */
      if (S.shields > 0 || S.shieldFx > 0 || S.magnet > 0) {
        const w = CAR_W * c.M * P(PZ), x = sxm(c, S.x, PZ), y = sy(c, PZ) - w * 0.28;
        g.save();
        if (S.magnet > 0) { g.fillStyle = hsl(5, 100, 55, 0.18); g.beginPath(); g.ellipse(x, y + w * 0.25, w * 0.85, w * 0.2, 0, 0, Math.PI * 2); g.fill(); }
        if (S.shields > 0 || S.shieldFx > 0) {
          g.strokeStyle = hsl(195, 100, 70, S.shieldFx > 0 ? 0.95 : 0.45);
          g.lineWidth = S.shieldFx > 0 ? 3 : 1.5;
          g.beginPath(); g.ellipse(x, y, w * 0.72, w * 0.42, 0, 0, Math.PI * 2); g.stroke();
        }
        g.restore();
      }
    }

    /* a car seen from behind: body, rear glass, tail lights */
    function vehicle(g, c, xm, z, hue, me) {
      const p = P(z);
      const w = CAR_W * c.M * p;
      if (w < 1.5) return;
      const h = w * 0.52;
      const x = sxm(c, xm, z) - w / 2;
      const y = sy(c, z) - h;
      const spin = me && S.state !== 'play' && S.state !== 'ready' && !reduced ? Math.sin(S.crashT * 18) * 0.08 * (1 - clamp(S.crashT, 0, 1)) : 0;
      g.save();
      if (spin) { g.translate(x + w / 2, y + h); g.rotate(spin); g.translate(-(x + w / 2), -(y + h)); }
      /* shadow */
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.beginPath(); g.ellipse(x + w / 2, y + h, w * 0.58, h * 0.14, 0, 0, Math.PI * 2); g.fill();
      /* body */
      g.shadowBlur = me ? 22 : 12 * Math.min(1, p * 3);
      g.shadowColor = hsl(hue, 100, 55, 0.8);
      const body = g.createLinearGradient(0, y, 0, y + h);
      body.addColorStop(0, hsl(hue, me ? 70 : 55, me ? 26 : 20));
      body.addColorStop(1, hsl(hue, me ? 80 : 60, me ? 12 : 9));
      g.fillStyle = body;
      rr(g, x, y + h * 0.28, w, h * 0.72, w * 0.08);
      g.fill();
      g.shadowBlur = 0;
      /* cabin + glass */
      g.fillStyle = hsl(hue, 50, 14);
      g.beginPath();
      g.moveTo(x + w * 0.16, y + h * 0.3);
      g.lineTo(x + w * 0.26, y);
      g.lineTo(x + w * 0.74, y);
      g.lineTo(x + w * 0.84, y + h * 0.3);
      g.closePath();
      g.fill();
      g.fillStyle = me ? 'rgba(120,230,255,.55)' : 'rgba(180,200,255,.28)';
      g.beginPath();
      g.moveTo(x + w * 0.22, y + h * 0.27);
      g.lineTo(x + w * 0.3, y + h * 0.05);
      g.lineTo(x + w * 0.7, y + h * 0.05);
      g.lineTo(x + w * 0.78, y + h * 0.27);
      g.closePath();
      g.fill();
      /* neon outline */
      g.strokeStyle = hsl(hue, 100, 65, me ? 1 : 0.8);
      g.lineWidth = Math.max(1, w * 0.02);
      rr(g, x, y + h * 0.28, w, h * 0.72, w * 0.08);
      g.stroke();
      /* tail lights */
      g.shadowBlur = 10 * Math.min(1, p * 3);
      g.shadowColor = '#ff2d55';
      g.fillStyle = '#ff4d6d';
      g.fillRect(x + w * 0.06, y + h * 0.45, w * 0.22, h * 0.12);
      g.fillRect(x + w * 0.72, y + h * 0.45, w * 0.22, h * 0.12);
      g.shadowBlur = 0;
      /* plate strip */
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(x + w * 0.38, y + h * 0.62, w * 0.24, h * 0.1);
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); snd.wake(); steer(-1); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); snd.wake(); steer(1); }
      else if (e.code === 'Space' && S.state === 'ready') { e.preventDefault(); snd.wake(); begin(); }
    };
    let sw = null;
    const onDown = e => {
      if (e.button > 0) return;
      snd.wake();
      sw = { x: e.clientX, y: e.clientY, id: e.pointerId, used: false };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    };
    const onMove = e => {
      if (!sw || sw.id !== e.pointerId || sw.used) return;
      const dx = e.clientX - sw.x;
      if (Math.abs(dx) > 30) { sw.used = true; steer(Math.sign(dx)); }
    };
    const onUp = e => {
      if (!sw || sw.id !== e.pointerId) return;
      if (!sw.used && e.type === 'pointerup') {
        const r = sf.cv.getBoundingClientRect();
        steer(e.clientX - r.left < r.width / 2 ? -1 : 1);
      }
      sw = null;
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (metres) */
      peek: () => ({
        state: S.state, paused: S.paused, lane: S.lane, x: S.x, v: S.v, dist: S.dist,
        cars: S.cars.map(c => ({ lane: c.lane, x: c.x, z: c.z, through: !!c.s })), playerZ: PZ, carL: CAR_L,
        seed, steps: S.n, logged: log.length, watch, speed: speedK, time: S.time,
        mode: MODE, pickups: PK, shift: SHIFT, fog: rain ? FOG : null,
        picks: S.picks.filter(p => !p.s).map(p => ({ kind: p.kind, lane: p.lane, z: p.z })),
        shields: S.shields, sparks: S.sparks, toShield: S.toShield, magnet: S.magnet, shielded: S.used,
        ghost: G ? { lane: G.lane, x: G.x, dead: G.dead, deadAt: G.deadAt ?? null, shields: G.shields, sparks: G.sparks } : null,
      }),
      /* test hook — nothing in the game calls it (a round it touches is not a fair one):
         give({ shields, magnet }) · pick({ kind, lane, z }) puts a pick-up on the road */
      hook(cmd, arg) {
        if (cmd === 'give') { if (Number.isFinite(arg.shields)) S.shields = arg.shields; if (Number.isFinite(arg.magnet)) S.magnet = arg.magnet; }
        else if (cmd === 'pick') S.picks.push({ kind: arg.kind, lane: arg.lane, x: (arg.lane - 1) * LANE, z: arg.z });
        else return false;
        return true;
      },
    };
  },
};

/* ---- module kit (the same few helpers in every built-in Arcade game) ---- */

/* small seeded generator (mulberry32, as in ./kit.js): the same seed gives the same traffic */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A canvas that fills `el`, backed at devicePixelRatio, refit on resize. */
function surface(el, label, onFit) {
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', label);
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(cv);
  const s = { cv, g: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  let armed = false;                 /* the first fit happens before the game exists */
  const fit = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === s.w && h === s.h && dpr === s.dpr) return;
    s.w = w; s.h = h; s.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    if (armed) onFit?.(s);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(el);
  window.addEventListener('resize', fit);
  fit();
  armed = true;
  s.begin = () => s.g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  s.destroy = () => { ro?.disconnect(); window.removeEventListener('resize', fit); cv.remove(); };
  return s;
}

/* Should this keydown drive the game? Not while another window is in
   front, not while typing in a field, and a Space/Enter aimed at a
   button outside the game belongs to that button. */
function ownsKey(el, e) {
  if (!el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const win = el.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
    if ((e.key === ' ' || e.key === 'Enter') && !el.contains(t) && t.closest('button,a,[role="button"]')) return false;
  }
  return true;
}

/* Tiny synth blips, made on the first input (browsers only start audio
   from a gesture) and closed in stop(). Silent while ctx.sound is off. */
function sounder(ctx) {
  let ac = null, dead = false;
  const get = () => {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  return {
    wake() { get(); },
    blip(freq, dur = 0.07, type = 'square', vol = 1, to = 0) {
      const c = get();
      if (!c || c.state !== 'running') return;
      try {
        const t = c.currentTime, o = c.createOscillator(), gn = c.createGain();
        const peak = 0.05 * vol * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(peak, t + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn).connect(c.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (err) { /* audio can fail at any point; the game goes on */ }
    },
    close() {
      dead = true;
      try { ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      ac = null;
    },
  };
}

/* requestAnimationFrame loop with a clamped dt; start/stop for pause. */
function looper(step) {
  let raf = 0, last = 0, on = false;
  const tick = now => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt, now);
  };
  return {
    start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { on = false; cancelAnimationFrame(raf); },
    get on() { return on; },
  };
}

function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

/* A two-line hint on a dark pill, centred on (sf.w/2, cy). */
function prompt(g, sf, line1, line2, hue, cy = sf.h / 2) {
  const k = Math.min(1, sf.w / 520);
  const f1 = Math.round(15 * Math.max(0.8, k)), f2 = Math.round(12 * Math.max(0.85, k));
  g.font = `650 ${f1}px ${FONT}`;
  const w1 = g.measureText(line1).width;
  g.font = `500 ${f2}px ${FONT}`;
  const w2 = line2 ? g.measureText(line2).width : 0;
  const w = Math.min(sf.w - 24, Math.max(w1, w2) + 40), h = line2 ? f1 + f2 + 34 : f1 + 26;
  const x = (sf.w - w) / 2, y = cy - h / 2;
  g.save();
  g.fillStyle = 'rgba(4,6,10,.78)';
  g.strokeStyle = hsl(hue, 100, 65, 0.45);
  g.lineWidth = 1;
  rr(g, x, y, w, h, 12);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f7f5';
  g.font = `650 ${f1}px ${FONT}`;
  g.fillText(line1, sf.w / 2, y + 13 + f1 / 2, w - 20);
  if (line2) {
    g.fillStyle = hsl(hue, 60, 78, 0.85);
    g.font = `500 ${f2}px ${FONT}`;
    g.fillText(line2, sf.w / 2, y + 21 + f1 + f2 / 2, w - 20);
  }
  g.restore();
}
