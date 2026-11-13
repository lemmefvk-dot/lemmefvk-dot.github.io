/* Glow Grid — a Static Forge template (original code and art).
   A lights-out puzzle: press a tile and it flips itself and the four
   tiles touching it. Switch every tile off before the move budget runs
   out; five boards grow from 3x3 to 5x5. Each board is made by pressing
   tiles on a dark grid, so every board can be solved. H shows a hint.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const LEVELS = Math.round(K.clamp(N(P.levels, 5), 1, 5));
  const SLACK = Math.round(K.clamp(N(P.slack, 3), 0, 20));      /* spare moves on top of the shortest solution */
  const SIZE = [3, 3, 4, 4, 5];
  const SCRAMBLE = [3, 4, 5, 7, 8];
  const HINT_COST = 25;

  let level, n, cells, need, moves, budget, cur, flip, clearT, hints, hintAt, hintCell, lay;

  const idx = (r, c) => r * n + c;
  function press(r, c) {
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      cells[idx(rr, cc)] ^= 1;
      flip[idx(rr, cc)] = 0;
    }
  }
  function build(lv) {
    n = SIZE[lv];
    cells = new Array(n * n).fill(0);
    flip = new Array(n * n).fill(1);
    need = new Set();
    const want = SCRAMBLE[lv];
    let tries = 0;
    do {
      cells.fill(0); need.clear();
      while (need.size < want) {
        const i = K.ri(0, n * n - 1);
        if (need.has(i)) continue;
        need.add(i);
        press(Math.floor(i / n), i % n);
      }
      tries++;
    } while (cells.every(v => !v) && tries < 20);
    flip.fill(1);
    moves = 0;
    budget = need.size + SLACK;
    cur = { r: Math.floor(n / 2), c: Math.floor(n / 2) };
    hintAt = -9; hintCell = null; hints = 0;
  }
  function geometry() {
    const s = Math.max(60, Math.min(K.W * 0.92, K.H - 170, 520));
    const cell = s / n;
    lay = { cell, x: (K.W - s) / 2, y: Math.max(76, (K.H - s) / 2 + 14), s };
  }
  const lit = () => cells.reduce((a, v) => a + v, 0);
  const hint = () => { for (const i of need) return { r: Math.floor(i / n), c: i % n }; return null; };

  function tryPress(r, c) {
    if (clearT > 0 || K.state !== 'play') return;
    press(r, c);
    if (need.has(idx(r, c))) need.delete(idx(r, c)); else need.add(idx(r, c));
    moves++;
    cur = { r, c };
    hintAt = -9;
    K.sfx('blip');
    K.tone(330 + lit() * 40, 330 + lit() * 40, 0.06, 'triangle', 0.05);
    if (!lit()) {
      const bonus = Math.max(0, (budget - moves) * 10 + 100 - hints * HINT_COST);
      K.add(bonus, K.W / 2, lay.y - 10, '#fde68a');
      K.flash('#ffffff', 0.25);
      K.sfx('power');
      if (level + 1 >= LEVELS) { K.win('Every board cleared!'); return; }
      clearT = 1.1;
      return;
    }
    if (moves >= budget) K.over('Out of moves');
  }
  function cellAt(x, y) {
    const c = Math.floor((x - lay.x) / lay.cell), r = Math.floor((y - lay.y) / lay.cell);
    return r >= 0 && c >= 0 && r < n && c < n ? { r, c } : null;
  }

  return {
    title: 'Glow Grid',
    tagline: 'Switch every tile off. A press flips its neighbours too.',
    controls: ['Arrows or WASD: move   ·   Space or Enter: press', 'Click or tap a tile   ·   H: hint (costs points)', 'Finish before you run out of moves   ·   P: pause'],
    accent: '#a78bfa',
    bg: '#0f0b24',
    resize() { geometry(); },
    reset() { level = 0; clearT = 0; build(0); geometry(); },
    update(dt) {
      for (let i = 0; i < flip.length; i++) flip[i] = Math.min(1, flip[i] + dt * 6);
      if (clearT > 0) {
        clearT -= dt;
        if (clearT <= 0) { level++; build(level); geometry(); }
        return;
      }
      if (K.hit('ArrowLeft', 'KeyA')) cur.c = Math.max(0, cur.c - 1);
      if (K.hit('ArrowRight', 'KeyD')) cur.c = Math.min(n - 1, cur.c + 1);
      if (K.hit('ArrowUp', 'KeyW')) cur.r = Math.max(0, cur.r - 1);
      if (K.hit('ArrowDown', 'KeyS')) cur.r = Math.min(n - 1, cur.r + 1);
      if (K.hit('Space', 'Enter')) tryPress(cur.r, cur.c);
      if (K.hit('KeyH') && K.t - hintAt > 0.3) {
        hints++; K.score = Math.max(0, K.score - HINT_COST);
        hintAt = K.t; hintCell = hint();
        K.float(K.W / 2, lay.y - 16, 'Hint  -' + HINT_COST, '#fca5a5', 16);
      }
    },
    down(p) {
      const hit = cellAt(p.x, p.y);
      if (hit) tryPress(hit.r, hit.c);
      p.used = true;
    },
    draw(g) {
      if (!lay) geometry();
      const { cell, x, y, s } = lay;
      g.fillStyle = 'rgba(167,139,250,.08)';
      K.rr(g, x - 10, y - 10, s + 20, s + 20, 18); g.fill();
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const on = cells[idx(r, c)] === 1;
        const f = flip[idx(r, c)];
        const k = 0.88 + 0.12 * Math.sin(f * Math.PI);
        const w = cell * 0.9 * k;
        const cx = x + (c + 0.5) * cell, cy = y + (r + 0.5) * cell;
        g.save();
        if (on) { g.shadowColor = K.accent; g.shadowBlur = 18; }
        g.fillStyle = on ? K.accent : '#1e1838';
        K.rr(g, cx - w / 2, cy - w / 2, w, w, cell * 0.16); g.fill();
        g.restore();
        if (on) { g.fillStyle = 'rgba(255,255,255,.28)'; K.rr(g, cx - w / 2 + 4, cy - w / 2 + 4, w - 8, w * 0.3, cell * 0.12); g.fill(); }
        else { g.strokeStyle = 'rgba(167,139,250,.25)'; g.lineWidth = 2; K.rr(g, cx - w / 2, cy - w / 2, w, w, cell * 0.16); g.stroke(); }
      }
      if (hintCell && K.t - hintAt < 2.5) {
        const cx = x + (hintCell.c + 0.5) * cell, cy = y + (hintCell.r + 0.5) * cell;
        g.strokeStyle = '#fde68a'; g.lineWidth = 4; g.setLineDash([8, 6]);
        K.rr(g, cx - cell * 0.46, cy - cell * 0.46, cell * 0.92, cell * 0.92, cell * 0.18); g.stroke();
        g.setLineDash([]);
      }
      if (K.state === 'play' || K.state === 'pause') {
        g.strokeStyle = '#fff'; g.lineWidth = 3;
        const cx = x + (cur.c + 0.5) * cell, cy = y + (cur.r + 0.5) * cell;
        K.rr(g, cx - cell * 0.5, cy - cell * 0.5, cell, cell, cell * 0.2); g.stroke();
      }
      K.fx(g);
    },
    hud(g) {
      K.pill(g, 'Board ' + (level + 1) + ' / ' + LEVELS, 12, 12, '#fff');
      K.pill(g, 'Score ' + K.score, K.W - 12, 12, '#fff', 'right');
      const left = budget - moves;
      K.txt(g, 'Moves left ' + left, K.W / 2, 62, 22, left <= 2 ? '#f87171' : K.accent, 'center', 800);
      K.txt(g, lit() + ' lit', K.W / 2, lay.y + lay.s + 34, 16, 'rgba(226,232,255,.75)', 'center', 700);
      if (clearT > 0) K.txt(g, 'Board cleared!', K.W / 2, lay.y + lay.s / 2, 34, '#fde68a', 'center', 900);
    },
    info() {
      return { level: level + 1, size: n, lit: lit(), moves, left: budget - moves, r: cur.r, c: cur.c, hint: hint(), cells: cells.slice(), clearing: clearT > 0 };
    },
  };
}

export default {
  id: 'glow-grid',
  name: 'Glow Grid',
  icon: 'grid-9',
  genre: 'puzzle',
  desc: 'A lights-out puzzle: every press flips a tile and its neighbours. Switch the whole board off within your move budget across five growing boards. Every board is solvable, and H gives a hint.',
  controls: 'Arrows/WASD move, Space presses · click or tap a tile · H hint · P pauses',
  season: null,
  colors: ['#0f0b24', '#a78bfa'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Glow Grid' },
    { k: 'levels', label: 'Boards to clear', type: 'range', min: 1, max: 5, step: 1, value: 5 },
    { k: 'slack', label: 'Spare moves', type: 'range', min: 0, max: 12, step: 1, value: 3 },
    { k: 'accent', label: 'Glow colour', type: 'color', value: '#a78bfa' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowRight', ms: 80, field: 'c', dir: 1, tap: { field: 'moves', dir: 1 } },
  game,
  art(g, w, h) {
    g.fillStyle = '#0f0b24'; g.fillRect(0, 0, w, h);
    const n = 4, cs = 38, x0 = (w - n * cs) / 2, y0 = (h - n * cs) / 2;
    const on = [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [3, 3]];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const lit = on.some(([a, b]) => a === r && b === c);
      g.save();
      if (lit) { g.shadowColor = '#a78bfa'; g.shadowBlur = 14; }
      g.fillStyle = lit ? '#a78bfa' : '#1e1838';
      g.beginPath(); g.roundRect(x0 + c * cs + 3, y0 + r * cs + 3, cs - 6, cs - 6, 7); g.fill();
      g.restore();
    }
  },
};
