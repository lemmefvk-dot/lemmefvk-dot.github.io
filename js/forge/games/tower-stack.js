/* Tower Stack — a Static Forge template (original code and art).
   One button: drop the sliding block onto the tower. Whatever hangs
   over the edge is sliced off; perfect drops build a streak that
   grows the block back. The sky climbs from day to space.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const START = K.clamp(N(P.startWidth, 220), 40, 520);
  const SLIDE = Math.max(40, N(P.slideSpeed, 260));
  const SPEEDUP = Math.max(0, N(P.speedUp, 8));
  const PERFECT = Math.max(0, N(P.perfect, 5));
  const BH = 30;          /* block height, world units */
  const D = 16;           /* depth of the top face */
  const LIM = 300;        /* how far the sliding block travels from the middle */
  const SKY = [           /* [height, top colour, bottom colour] */
    [0, '#2b8fd6', '#bfe6fb'], [18, '#5b48c9', '#f6a05a'], [36, '#1b1446', '#a43f6d'],
    [55, '#040714', '#1c1c4a'], [80, '#000000', '#070b1f'],
  ];
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: Math.random() * 2 - 1, y: 120 + i * 70 + Math.random() * 40, w: 60 + Math.random() * 70, sp: 6 + Math.random() * 10 }));
  const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.5 + 0.4 }));

  let blocks, cur, debris, rings, streak, cam, zoom, s = 1, idleDir = 1;

  const hexHue = hex => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return 200;
    const r = parseInt(m[1], 16) / 255, gg = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx === mn) return 200;
    const d = mx - mn;
    let h = mx === r ? (gg - b) / d + (gg < b ? 6 : 0) : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
    return Math.round(h * 60);
  };
  const hueAt = lv => (hexHue(K.accent) + lv * 9) % 360;
  const mix = (a, b, t) => {
    const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
    return 'rgb(' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',') + ')';
  };
  function skyAt(h) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const a = SKY[i], b = SKY[i + 1];
      if (h <= b[0]) { const t = K.clamp((h - a[0]) / (b[0] - a[0]), 0, 1); return [mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
    }
    return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]];
  }

  const height = () => blocks.length - 1;
  const top = () => blocks[blocks.length - 1];
  const speed = () => Math.min(900, SLIDE + SPEEDUP * height());
  function next() {
    const lv = blocks.length;
    const t = top();
    if (lv === 1) cur = { x: t.x - 60, w: t.w, dir: 1, hue: hueAt(lv) };   /* the first block starts over the base */
    else {
      const fromLeft = lv % 2 === 1;
      cur = { x: fromLeft ? -LIM : LIM, w: t.w, dir: fromLeft ? 1 : -1, hue: hueAt(lv) };
    }
  }

  function drop() {
    const t = top();
    const lv = blocks.length;
    const a0 = cur.x - cur.w / 2, a1 = cur.x + cur.w / 2;
    const b0 = t.x - t.w / 2, b1 = t.x + t.w / 2;
    const left = Math.max(a0, b0), right = Math.min(a1, b1);
    const over = right - left;
    if (over <= 0) {
      debris.push({ x: cur.x, w: cur.w, y: lv * BH, vx: cur.dir * 60, vy: 0, rot: 0, vr: cur.dir * 1.6, hue: cur.hue });
      K.shake(8);
      K.sfx('thud');
      K.over(height() === 1 ? 'One block high' : height() + ' blocks high');
      cur = null;
      return;
    }
    if (Math.abs(cur.x - t.x) <= PERFECT) {
      streak++;
      let w = t.w;
      if (streak % 3 === 0) w = Math.min(START, w + 18);
      blocks.push({ x: t.x, w, hue: cur.hue });
      rings.push({ x: t.x, w, y: lv * BH, t: 0 });
      K.add(2, t.x, -(lv * BH + 40), '#fff');
      K.float(t.x, -(lv * BH + 70), streak >= 2 ? 'Perfect x' + streak + '!' : 'Perfect!', K.accent, 22);
      if (w > t.w) K.float(t.x, -(lv * BH + 100), 'Wider!', '#fde68a', 18);
      K.sfx('perfect');
      K.burst(t.x, -(lv * BH + BH / 2), ['#fff', K.accent], 18, 220, { life: 0.5 });
    } else {
      streak = 0;
      blocks.push({ x: (left + right) / 2, w: over, hue: cur.hue });
      const cut = cur.x > t.x ? { x: (right + a1) / 2, w: a1 - right, dir: 1 } : { x: (a0 + left) / 2, w: left - a0, dir: -1 };
      debris.push({ x: cut.x, w: cut.w, y: lv * BH, vx: cut.dir * K.rnd(40, 110), vy: K.rnd(40, 120), rot: 0, vr: cut.dir * K.rnd(1.5, 3.5), hue: cur.hue });
      K.add(1, (left + right) / 2, -(lv * BH + 40), '#fff');
      K.sfx('drop');
      K.shake(2);
    }
    next();
  }

  function stepWorld(dt) {
    for (const d of debris) { d.vy -= 1600 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.rot += d.vr * dt; }
    debris = debris.filter(d => d.y > cam - 900);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.6);
    for (const c of clouds) { c.x += c.sp * dt / 600; if (c.x > 1.4) c.x = -1.4; }
    const lv = blocks.length;
    const base = K.H * 0.74;
    let want = 0, z = 1;
    if (K.state === 'over') {
      const tall = (height() + 4) * BH;
      z = K.clamp((K.H * 0.62) / (tall * s), 0.12, 1);
      want = 0;
    } else {
      want = Math.max(0, lv * BH - (base - K.H * 0.36) / s);
    }
    cam = K.lerp(cam, want, Math.min(1, dt * 4));
    zoom = K.lerp(zoom, z, Math.min(1, dt * 2.5));
  }

  function face(g, x, y, w, hue, alpha) {
    /* a block whose front face is x-w/2..x+w/2, y-BH..y (y is negative up) */
    const x0 = x - w / 2;
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.fillStyle = 'hsl(' + hue + ',62%,52%)';
    g.fillRect(x0, y - BH, w, BH);
    g.fillStyle = 'hsl(' + hue + ',70%,70%)';
    g.beginPath(); g.moveTo(x0, y - BH); g.lineTo(x0 + D * 0.8, y - BH - D); g.lineTo(x0 + w + D * 0.8, y - BH - D); g.lineTo(x0 + w, y - BH); g.closePath(); g.fill();
    g.fillStyle = 'hsl(' + hue + ',58%,36%)';
    g.beginPath(); g.moveTo(x0 + w, y - BH); g.lineTo(x0 + w + D * 0.8, y - BH - D); g.lineTo(x0 + w + D * 0.8, y - D); g.lineTo(x0 + w, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.14)';
    g.fillRect(x0, y - BH, w, 4);
    g.globalAlpha = 1;
  }

  return {
    title: 'Tower Stack',
    tagline: 'Drop each block right on top. How high can you go?',
    controls: ['Space, Enter, a click or a tap: drop the block', 'Overhangs are sliced off   ·   P: pause'],
    accent: '#22d3ee',
    bg: '#0b1020',
    resize() { s = K.clamp(Math.min(K.W / 620, K.H / 600), 0.42, 2.2); },
    reset() {
      s = K.clamp(Math.min(K.W / 620, K.H / 600), 0.42, 2.2);
      blocks = [{ x: 0, w: START, hue: hueAt(0) }];
      debris = []; rings = []; streak = 0; cam = 0; zoom = 1;
      next();
    },
    idle(dt) {
      stepWorld(dt);
      if (K.state === 'start' && cur) {
        cur.x += idleDir * 120 * dt;
        if (Math.abs(cur.x) > 160) { idleDir = -idleDir; cur.x = K.clamp(cur.x, -160, 160); }
      }
    },
    update(dt) {
      if (cur) {
        cur.x += cur.dir * speed() * dt;
        if (cur.x > LIM) { cur.x = LIM; cur.dir = -1; }
        if (cur.x < -LIM) { cur.x = -LIM; cur.dir = 1; }
        if (K.hit('Space', 'Enter', 'ArrowDown', 'KeyS')) drop();
      }
      stepWorld(dt);
    },
    down() { if (cur && K.state === 'play') drop(); },
    draw(g) {
      const S = s * zoom;
      const base = K.state === 'over' ? K.lerp(K.H * 0.74, K.H * 0.9, 1 - (zoom - 0.12) / 0.88) : K.H * 0.74;
      const skyH = (cam / BH) + 4;
      const [c0, c1] = skyAt(skyH);
      const sky = g.createLinearGradient(0, 0, 0, K.H);
      sky.addColorStop(0, c0); sky.addColorStop(1, c1);
      g.fillStyle = sky;
      g.fillRect(0, 0, K.W, K.H);
      const starA = K.clamp((skyH - 30) / 30, 0, 1);
      if (starA > 0) {
        g.fillStyle = '#e0e7ff';
        for (const st of stars) {
          g.globalAlpha = starA * (0.4 + 0.4 * Math.sin(K.t * 2 + st.x * 30));
          g.fillRect(st.x * K.W, ((st.y * K.H + cam * 0.05 * S) % K.H + K.H) % K.H, st.s, st.s);
        }
        g.globalAlpha = 1;
      }
      const cx = K.W / 2 - D * 0.4 * S;
      g.save();
      g.translate(cx, base + cam * S);
      g.scale(S, S);
      /* clouds drift past at low altitude (a little parallax) */
      const cloudA = K.clamp(1 - (skyH - 20) / 25, 0, 1);
      if (cloudA > 0) {
        g.fillStyle = 'rgba(255,255,255,' + 0.55 * cloudA + ')';
        for (const c of clouds) {
          const y = -(c.y + cam * 0.5);
          const x = c.x * 520;
          g.beginPath();
          g.ellipse(x, y, c.w, 14, 0, 0, 7);
          g.ellipse(x - c.w * 0.4, y + 2, c.w * 0.45, 11, 0, 0, 7);
          g.ellipse(x + c.w * 0.35, y - 6, c.w * 0.5, 15, 0, 0, 7);
          g.fill();
        }
      }
      /* the pedestal and the tower */
      const b0 = blocks[0];
      g.fillStyle = 'hsl(' + b0.hue + ',30%,22%)';
      g.fillRect(b0.x - b0.w / 2, 0, b0.w, 4000);
      g.fillStyle = 'hsl(' + b0.hue + ',30%,16%)';
      g.beginPath(); g.moveTo(b0.x + b0.w / 2, 0); g.lineTo(b0.x + b0.w / 2 + D * 0.8, -D); g.lineTo(b0.x + b0.w / 2 + D * 0.8, 4000); g.lineTo(b0.x + b0.w / 2, 4000); g.closePath(); g.fill();
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        face(g, b.x, -i * BH, b.w, b.hue);
      }
      for (const r of rings) {
        const k = r.t / 0.6;
        g.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')';
        g.lineWidth = 3 / S;
        const grow = 6 + k * 26;
        g.strokeRect(r.x - r.w / 2 - grow, -r.y - BH - grow, r.w + grow * 2, BH + grow * 2);
      }
      /* the sliding block, with a faint guide down to the tower */
      if (cur) {
        const y = -blocks.length * BH;
        g.fillStyle = 'rgba(255,255,255,.07)';
        g.fillRect(cur.x - cur.w / 2, y, cur.w, BH * 0.4);
        face(g, cur.x, y, cur.w, cur.hue);
      }
      for (const d of debris) {
        g.save();
        g.translate(d.x, -d.y - BH / 2);
        g.rotate(d.rot);
        face(g, 0, BH / 2, d.w, d.hue, 0.95);
        g.restore();
      }
      K.fx(g);
      g.restore();
    },
    hud(g) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,.45)';
      g.shadowBlur = 12;
      K.txt(g, String(height()), K.W / 2, Math.max(40, K.H * 0.11), K.clamp(K.H * 0.11, 34, 84), '#fff', 'center', 900);
      g.restore();
      K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      if (streak >= 2) K.pill(g, 'Perfect streak ' + streak, K.W - 12, 12, K.accent, 'right');
    },
    info() {
      return { height: height(), w: top().w, x: cur ? cur.x : null, streak, speed: speed() };
    },
  };
}

export default {
  id: 'tower-stack',
  name: 'Tower Stack',
  icon: 'layers',
  genre: 'timing',
  desc: 'A one-button tower builder: drop each sliding block onto the last one. Overhangs get sliced off, perfect drops grow it back, and the sky climbs from day into space.',
  controls: 'Space, Enter, a click or a tap to drop the block · P pauses',
  season: null,
  colors: ['#0b1020', '#22d3ee'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Tower Stack' },
    { k: 'startWidth', label: 'Block width', type: 'range', min: 80, max: 400, step: 10, value: 220 },
    { k: 'slideSpeed', label: 'Slide speed', type: 'range', min: 100, max: 600, step: 10, value: 260 },
    { k: 'speedUp', label: 'Speed-up per block', type: 'range', min: 0, max: 30, step: 1, value: 8 },
    { k: 'perfect', label: 'Perfect drop margin (px)', type: 'range', min: 0, max: 12, step: 1, value: 5 },
    { k: 'accent', label: 'Block colour', type: 'color', value: '#22d3ee' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'Space', ms: 60, field: 'height', dir: 1, tap: { field: 'height', dir: 1 } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#5b48c9'); sky.addColorStop(1, '#f6a05a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.beginPath(); g.ellipse(60, 40, 34, 9, 0, 0, 7); g.ellipse(250, 70, 40, 10, 0, 0, 7); g.fill();
    const bh = 14, d = 7;
    const rows = [[0, 120], [3, 116], [1, 110], [-4, 104], [0, 104], [5, 98], [2, 92], [-2, 92]];
    let y = h - 6;
    g.fillStyle = '#26324a'; g.fillRect(w / 2 - 62, y - 4, 124, 10);
    rows.forEach(([dx, bw], i) => {
      const x = w / 2 - bw / 2 + dx;
      const hue = (190 + i * 9) % 360;
      g.fillStyle = 'hsl(' + hue + ',62%,52%)'; g.fillRect(x, y - bh, bw, bh);
      g.fillStyle = 'hsl(' + hue + ',70%,70%)';
      g.beginPath(); g.moveTo(x, y - bh); g.lineTo(x + d, y - bh - d); g.lineTo(x + bw + d, y - bh - d); g.lineTo(x + bw, y - bh); g.closePath(); g.fill();
      g.fillStyle = 'hsl(' + hue + ',58%,36%)';
      g.beginPath(); g.moveTo(x + bw, y - bh); g.lineTo(x + bw + d, y - bh - d); g.lineTo(x + bw + d, y - d); g.lineTo(x + bw, y); g.closePath(); g.fill();
      y -= bh;
    });
    const hue = (190 + rows.length * 9) % 360;
    g.fillStyle = 'hsl(' + hue + ',62%,52%)'; g.fillRect(w / 2 + 30, y - bh - 18, 92, bh);
    g.fillStyle = 'hsl(' + hue + ',70%,70%)';
    g.beginPath(); g.moveTo(w / 2 + 30, y - bh - 18); g.lineTo(w / 2 + 30 + d, y - bh - 18 - d); g.lineTo(w / 2 + 122 + d, y - bh - 18 - d); g.lineTo(w / 2 + 122, y - bh - 18); g.closePath(); g.fill();
  },
};
