/* Beat Lanes — a Static Forge template (original code and art).
   A four-lane rhythm game: glowing notes slide down towards the hit
   line in time with a steady beat; press the matching key (or tap the
   lane) as each one lands. Perfect and good hits build a combo, misses
   drain the crowd's energy. Play the whole short chart and keep the
   energy above zero to win. The chart is made in code from the tempo and
   length settings, and a "timing window" setting widens the hit zone.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const BPM = K.clamp(N(P.bpm, 120), 50, 200);
  const BARS = Math.round(K.clamp(N(P.bars, 8), 1, 32));
  const FALL = K.clamp(N(P.fallTime, 1.5), 0.6, 3.5);          /* seconds from the top to the hit line */
  const FORGIVE = K.clamp(N(P.window, 1), 0.5, 5);             /* multiplies the hit window */
  const GOOD = 0.12 * FORGIVE, PERFECT = 0.06 * FORGIVE;
  const LEAD = 2.0;
  const BEAT = 60 / BPM;
  const KEYS = [['KeyD', 'ArrowLeft'], ['KeyF', 'ArrowDown'], ['KeyJ', 'ArrowUp'], ['KeyK', 'ArrowRight']];
  const LABEL = ['D', 'F', 'J', 'K'];
  const COLORS = ['#f472b6', '#facc15', '#34d399', '#60a5fa'];
  const SCALE = [262, 330, 392, 523];     /* a major-ish arpeggio, one tone per lane */
  /* rhythm cells in eighth notes within a bar (0..7); later bars use busier cells */
  const CELLS = [[0, 4], [0, 2, 4, 6], [0, 3, 4, 6], [0, 2, 3, 4, 6, 7], [0, 1, 2, 4, 5, 6]];

  let notes, t, health, combo, best, hits, misses, perfect, presses, stray, lastBeat, endAt, pulse, flash, grade, lay;

  function chart() {
    const out = [];
    let lane = 0, dir = 1;
    for (let b = 0; b < BARS; b++) {
      const busy = Math.min(CELLS.length - 1, Math.floor(b * CELLS.length / Math.max(2, BARS)));
      for (const e of CELLS[b === BARS - 1 ? 0 : busy]) {
        out.push({ time: LEAD + (b * 4 + e / 2) * BEAT, lane, state: 0 });
        lane += dir;
        if (lane > 3 || lane < 0) { dir = -dir; lane += dir * 2; }
        if (e % 3 === 2) lane = (lane + 2) % 4;
      }
    }
    return out;
  }
  function geometry() {
    const w = Math.min(K.W * 0.92, 440);
    lay = { x: (K.W - w) / 2, w, lw: w / 4, top: 74, hy: K.H * 0.8 };
    lay.hy = Math.max(lay.top + 160, lay.hy);
  }
  const yOf = dt => lay.hy - (dt / FALL) * (lay.hy - lay.top);

  function judge(lane) {
    presses++;
    let n = null;
    for (const c of notes) if (c.lane === lane && c.state === 0 && Math.abs(c.time - t) <= GOOD && (!n || c.time < n.time)) n = c;
    flash[lane] = 1;
    if (!n) {
      stray++;
      health = Math.max(0, health - 3);
      combo = 0;
      K.tone(120, 90, 0.08, 'sawtooth', 0.04);
      if (health <= 0) K.over('The crowd left');
      return;
    }
    const d = Math.abs(n.time - t);
    const great = d <= PERFECT;
    n.state = great ? 2 : 1;
    combo++; best = Math.max(best, combo); hits++; if (great) perfect++;
    health = Math.min(100, health + 2);
    const mult = 1 + Math.min(3, Math.floor(combo / 10));
    K.add((great ? 100 : 60) * mult, lay.x + (lane + 0.5) * lay.lw, lay.hy - 40, great ? '#fde68a' : '#bae6fd');
    K.tone(SCALE[lane], SCALE[lane], 0.14, 'triangle', 0.08);
    K.burst(lay.x + (lane + 0.5) * lay.lw, lay.hy, [COLORS[lane], '#fff'], great ? 14 : 8, 180, { life: 0.4 });
    pulse = 1;
  }

  return {
    title: 'Beat Lanes',
    tagline: 'Hit each note as it lands on the line.',
    controls: ['D F J K  (or the arrow keys): hit the four lanes', 'Touch or click: tap a lane   ·   P: pause', 'Misses drain the crowd; empty means the show is over'],
    accent: '#f472b6',
    bg: '#0b0a1a',
    resize() { geometry(); },
    reset() {
      geometry();
      notes = chart();
      t = 0; health = 100; combo = 0; best = 0; hits = 0; misses = 0; perfect = 0; presses = 0; stray = 0;
      lastBeat = -1; pulse = 0; flash = [0, 0, 0, 0]; grade = '';
      endAt = notes[notes.length - 1].time + 1.2;
    },
    update(dt) {
      t += dt;
      pulse = Math.max(0, pulse - dt * 3);
      for (let i = 0; i < 4; i++) flash[i] = Math.max(0, flash[i] - dt * 5);
      /* the backing beat: a kick on every beat once the song has started */
      const beat = Math.floor((t - LEAD + BEAT * 2) / BEAT);
      if (beat !== lastBeat) { lastBeat = beat; K.tone(110, 48, 0.16, 'sine', beat % 4 === 0 ? 0.16 : 0.09); }
      for (let i = 0; i < 4; i++) if (K.hit(...KEYS[i])) { judge(i); if (K.state !== 'play') return; }
      for (const c of notes) {
        if (c.state === 0 && t - c.time > GOOD) {
          c.state = -1; misses++; combo = 0;
          health = Math.max(0, health - 8);
          K.shake(3);
          if (health <= 0) { K.over('The crowd left'); return; }
        }
      }
      if (t >= endAt) {
        const acc = hits / notes.length;
        grade = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : 'C';
        K.win('Song complete! Grade ' + grade);
      }
    },
    down(p) {
      if (p.x < lay.x || p.x > lay.x + lay.w) return;
      judge(K.clamp(Math.floor((p.x - lay.x) / lay.lw), 0, 3));
      p.used = true;
    },
    draw(g) {
      if (!lay) geometry();
      const { x, w, lw, top, hy } = lay;
      const bg = g.createLinearGradient(0, 0, 0, K.H);
      bg.addColorStop(0, '#0b0a1a'); bg.addColorStop(1, '#1c1038');
      g.fillStyle = bg; g.fillRect(0, 0, K.W, K.H);
      /* the lanes */
      for (let i = 0; i < 4; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (0.035 + flash[i] * 0.16) + ')';
        g.fillRect(x + i * lw + 2, top, lw - 4, hy - top + 60);
        g.fillStyle = COLORS[i];
        g.globalAlpha = 0.25 + flash[i] * 0.6;
        g.fillRect(x + i * lw + 2, hy - 4, lw - 4, 8);
        g.globalAlpha = 1;
      }
      /* the hit line pulses with the beat */
      g.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.4 * pulse) + ')';
      g.fillRect(x, hy - 2, w, 4);
      for (let i = 0; i < 4; i++) K.txt(g, LABEL[i], x + (i + 0.5) * lw, hy + 36, 22, COLORS[i], 'center', 800);
      /* the notes */
      for (const c of notes) {
        if (c.state > 0) continue;
        const dt = c.time - t;
        if (dt > FALL + 0.05 || dt < -0.4) continue;
        const y = yOf(dt);
        const cx = x + (c.lane + 0.5) * lw;
        g.globalAlpha = c.state < 0 ? 0.3 : 1;
        g.save();
        g.shadowColor = COLORS[c.lane]; g.shadowBlur = 14;
        g.fillStyle = COLORS[c.lane];
        K.rr(g, cx - lw * 0.4, y - 13, lw * 0.8, 26, 9); g.fill();
        g.restore();
        g.fillStyle = 'rgba(255,255,255,.4)';
        K.rr(g, cx - lw * 0.34, y - 10, lw * 0.68, 7, 4); g.fill();
        g.globalAlpha = 1;
      }
      K.fx(g);
    },
    hud(g) {
      K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      K.pill(g, 'Combo ' + combo, K.W - 12, 12, combo >= 10 ? '#fde68a' : '#fff', 'right');
      /* the crowd's energy */
      const bx = K.W / 2 - 70;
      g.fillStyle = 'rgba(6,8,16,.55)'; K.rr(g, bx, 22, 140, 12, 6); g.fill();
      g.fillStyle = health > 35 ? '#34d399' : '#f87171';
      if (health > 0) { K.rr(g, bx, 22, Math.max(8, 140 * health / 100), 12, 6); g.fill(); }
      if (t < LEAD - 0.2 && K.state === 'play') K.txt(g, 'Get ready…', K.W / 2, K.H * 0.45, 30, '#fff', 'center', 800);
    },
    info() {
      const near = notes.filter(c => c.state === 0 && c.time - t < FALL).map(c => ({ lane: c.lane, dt: c.time - t })).slice(0, 8);
      return { t, health, combo, best, hits, misses, perfect, presses, stray, total: notes.length, window: GOOD, near };
    },
  };
}

export default {
  id: 'beat-lanes',
  name: 'Beat Lanes',
  icon: 'music',
  genre: 'rhythm',
  desc: 'A four-lane rhythm game: hit each glowing note as it reaches the line, build a combo and keep the crowd happy to the end of the song. Tempo, length, speed and timing window are all settings.',
  controls: 'D F J K or the arrow keys hit the lanes · tap a lane on touch · P pauses',
  season: null,
  colors: ['#0b0a1a', '#f472b6'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Beat Lanes' },
    { k: 'bpm', label: 'Tempo (BPM)', type: 'range', min: 60, max: 180, step: 5, value: 120 },
    { k: 'bars', label: 'Song length (bars)', type: 'range', min: 2, max: 24, step: 1, value: 8 },
    { k: 'fallTime', label: 'Note fall time (s)', type: 'range', min: 0.8, max: 3, step: 0.1, value: 1.5 },
    { k: 'window', label: 'Timing window (x)', type: 'range', min: 0.5, max: 4, step: 0.5, value: 1 },
    { k: 'accent', label: 'Accent colour', type: 'color', value: '#f472b6' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'KeyD', ms: 60, field: 'presses', dir: 1, tap: { field: 'presses', dir: 1 } },
  game,
  art(g, w, h) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b0a1a'); bg.addColorStop(1, '#1c1038');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const C = ['#f472b6', '#facc15', '#34d399', '#60a5fa'];
    const lw = 62, x0 = (w - lw * 4) / 2;
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x0 + i * lw + 2, 0, lw - 4, h); }
    const notes = [[0, 30], [2, 52], [1, 84], [3, 20], [2, 120], [0, 96], [3, 70]];
    for (const [l, y] of notes) {
      g.save(); g.shadowColor = C[l]; g.shadowBlur = 12; g.fillStyle = C[l];
      g.beginPath(); g.roundRect(x0 + l * lw + 8, y, lw - 16, 22, 8); g.fill(); g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x0, h - 30, lw * 4, 4);
  },
};
