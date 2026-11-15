/* ============================================================
   arcade/beatblocks.js — Beat Blocks for Static Arcade.

   Coloured blocks fall into a well seven squares wide. Land them so
   that four or more squares of one colour touch and they clear, and
   the squares above fall into the gap (rules, points and the music's
   notes are in ./beatblocks-logic.js). There are no rows to fill:
   colours clear, not lines. A clear made by a piece you drop with
   Space right on a beat of the music scores double, or triple when
   it is dead on.

   Controls
     keyboard       ← → move · ↑ or X turn clockwise · Z turn back
                    · ↓ soft drop (hold) · Space hard drop
                    (A D W S work too)
     touch / mouse  tap the well to turn the piece · drag sideways
                    to move it · swipe down to drop it, and the
                    buttons under the well on a phone
   Every colour carries a shape as well as its hue, and the Arcade's
   colour-blind colours (ctx.palette 'cb') swap the colours.

   The music is original (Web Audio, written as notes in
   ./beatblocks-logic.js) and is scheduled on the audio clock a little
   ahead of time. The beat is judged on that same clock, never on the
   wall clock. If the browser gives no running audio clock (sound off,
   or blocked) the game keeps time with performance.now() instead,
   stays silent, and says so; the ring and the marker still keep the
   beat. Reduced motion: no screen shake or flashes; the ring that
   closes on every beat stays because it is the timing cue.

   Score = points, higher is better.
   ============================================================ */
import { surface, fitView, looper, ownsKey, prompt, rr, hsl, FONT, clamp, rng, coarse } from './kit.js';
import { PALETTE_CB } from './index.js';
import {
  W, H, PERIOD, BPM, STEPS, spawn, rotated, fits, dropY, place, resolve, pointsOf, judgeBeat, fallTime, levelOf, emptyBoard, songStep, midiHz,
} from './beatblocks-logic.js';

const HUE = 285;
const VW = 380, VH = 520, CELL = 34, WX = 16, WY = 40;
const COLORS = ['#ff4d6d', '#3b9cff', '#2fd36b', '#ffd23f'];
const CB = [PALETTE_CB[5], PALETTE_CB[1], PALETTE_CB[2], PALETTE_CB[3]];
const GLYPH = ['●', '■', '▲', '◆'];
const STEP_S = PERIOD / 4;

/* ---------------- the music: scheduled on the Web Audio clock ---------------- */
function engine(ctx) {
  let ac = null, master = null, noise = null, timer = 0, next = 0, t0 = 0, running = false, dead = false;
  const vol = () => 0.5 * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
  function ensure() {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
      master = ac.createGain();
      master.gain.value = vol();
      master.connect(ac.destination);
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = buf.getChannelData(0);
      let s = 1;
      for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
      noise = buf;
    }
    return ac;
  }
  const tone = (type, hz, at, dur, peak, to = 0) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, at);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at); o.stop(at + dur + 0.03);
  };
  const hit = (at, dur, peak, hp) => {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(master);
    src.start(at); src.stop(at + dur + 0.02);
  };
  function playStep(i, at) {
    const s = songStep(i);
    if (s.kick) tone('sine', 150, at, 0.16, 0.9, 45);
    if (s.snare) hit(at, 0.12, 0.35, 1500);
    if (s.hat) hit(at, 0.035, 0.12, 7000);
    if (s.bass !== null) tone('triangle', midiHz(s.bass), at, STEP_S * 1.8, 0.45);
    if (s.lead !== null) tone('square', midiHz(s.lead), at, STEP_S * 1.4, 0.07);
  }
  function pump() {
    if (!running || !ac) return;
    while (next * STEP_S + t0 < ac.currentTime + 0.18) { playStep(next, t0 + next * STEP_S); next++; }
  }
  return {
    /** start (or restart) the loop; resolves to { t0 } on the audio clock, or null when there is no running audio clock */
    async start() {
      const c = ensure();
      if (!c) return null;
      try { await c.resume(); } catch (err) { /* below */ }
      if (c.state !== 'running') return null;
      const a = c.currentTime;
      await new Promise(r => setTimeout(r, 90));
      if (dead || c.currentTime <= a) return null;           /* a clock that does not move is no clock */
      t0 = c.currentTime + 0.3; next = 0; running = true;
      clearInterval(timer); timer = setInterval(pump, 30);
      pump();
      return { t0 };
    },
    now: () => (ac ? ac.currentTime : 0),
    get ready() { return running; },
    suspend() { running = false; clearInterval(timer); try { ac?.suspend(); } catch (err) { /* nothing */ } },
    async resume() { if (!ac) return; try { await ac.resume(); } catch (err) { return; } running = true; clearInterval(timer); timer = setInterval(pump, 30); pump(); },
    blip(hz, dur = 0.08, type = 'triangle', peak = 0.5, to = 0) { if (ac && ac.state === 'running') { try { tone(type, hz, ac.currentTime, dur, peak * 0.4, to); } catch (err) { /* sound is a bonus */ } } },
    close() { dead = true; running = false; clearInterval(timer); try { ac?.close()?.catch?.(() => {}); } catch (err) { /* closed */ } ac = null; },
  };
}

export default {
  mount(el, ctx = {}) {
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion');
    const music = engine(ctx);
    const rand = rng((Date.now() ^ 0x5bd1e995) >>> 0);
    const sf = surface(el, 'Beat Blocks', () => draw());
    const cb = () => ctx.palette === 'cb';
    /* the beat clock: the audio clock when it runs, performance.now() when it does not; a test may put a made-up one in front */
    const clk = { mode: 'none', t0: 0, fake: null, silent: false };
    const realNow = () => (clk.mode === 'audio' ? music.now() : performance.now() / 1000);
    const nowT = () => (clk.fake ? clk.fake.t : realNow());
    const t0Of = () => (clk.fake ? clk.fake.t0 : clk.t0);
    const sinceBeat = () => nowT() - t0Of();

    const S = {
      state: 'ready', paused: false, board: emptyBoard(), piece: null, next: spawn(rand), score: 0, cleared: 0, level: 1, acc: 0, soft: false,
      last: null, floats: [], flash: 0, shake: 0, pauseAt: 0, drops: 0, beatDrops: 0, chains: 0, bestChain: 0, over: null,
    };
    ctx.onScore?.(0);

    /* ------------------------------ rules glue ------------------------------ */
    function newPiece() {
      S.piece = S.next; S.next = spawn(rand);
      if (!fits(S.board, S.piece)) return gameOver();
      S.acc = 0;
    }
    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play'; S.board = emptyBoard(); S.score = 0; S.cleared = 0; S.level = 1; S.last = null; S.floats = [];
      clk.mode = 'perf'; clk.t0 = performance.now() / 1000 + 0.4; clk.silent = ctx.sound === false;
      newPiece();
      ctx.onScore?.(0);
      /* the music asks the browser for a running audio clock; if it gets one the beat moves onto it */
      music.start().then(r => {
        if (dead || !r) { if (!dead) clk.silent = true; return; }
        clk.mode = 'audio'; clk.t0 = r.t0; clk.silent = false;
        if (S.paused) music.suspend();
      });
      loop.start();
    }
    function lock(beat) {
      const p = S.piece;
      S.piece = null;
      place(S.board, p);
      const steps = resolve(S.board);
      const n = steps.reduce((a, s) => a + s.n, 0);
      const mult = steps.length && beat ? beat.mult : 1;
      const pts = pointsOf(steps, mult);
      S.last = beat ? { grade: steps.length ? beat.grade : null, dist: Math.round(beat.dist * 1000) / 1000, mult, cleared: n, points: pts, chain: steps.length, hard: true }
        : { grade: null, dist: null, mult: 1, cleared: n, points: pts, chain: steps.length, hard: false };
      if (steps.length) {
        S.score += pts; S.cleared += n; S.level = levelOf(S.cleared); S.chains += steps.length > 1 ? 1 : 0; S.bestChain = Math.max(S.bestChain, steps.length);
        if (beat?.grade) S.beatDrops++;
        S.floats.push({ t: 0, text: `+${pts}${beat?.grade ? ` ${beat.grade === 'perfect' ? 'ON THE BEAT ×3' : 'on the beat ×2'}` : ''}${steps.length > 1 ? ` · chain ${steps.length}` : ''}`, grade: beat?.grade || null });
        if (!reduced) S.flash = 0.15;
        music.blip(520 + 80 * steps.length, 0.12, 'triangle', 0.8, 900 + 80 * steps.length);
        ctx.onScore?.(S.score);
      } else music.blip(180, 0.05, 'sine', 0.5);
      if (!reduced && !steps.length) S.shake = 0.08;
      newPiece();
    }
    function gameOver() {
      S.state = 'over'; S.piece = null;
      loop.stop(); music.suspend();
      draw();
      S.over = { score: S.score };
      ctx.onEnd?.({ score: S.score, won: false, detail: `${S.score} points · ${S.cleared} squares cleared${S.beatDrops ? ` · ${S.beatDrops} clears on the beat` : ''}${S.bestChain > 1 ? ` · best chain ${S.bestChain}` : ''}` });
    }
    const move = dx => { if (S.piece && fits(S.board, S.piece, S.piece.x + dx, S.piece.y)) { S.piece.x += dx; return true; } return false; };
    function turn(dir) {
      if (!S.piece) return;
      const r = rotated(S.piece, dir);
      for (const k of [0, -1, 1, -2, 2]) if (fits(S.board, r, S.piece.x + k, S.piece.y)) { S.piece = { ...r, x: S.piece.x + k, y: S.piece.y }; music.blip(440, 0.03, 'square', 0.3); return; }
    }
    function hardDrop() {
      if (!S.piece) return;
      const beat = judgeBeat(sinceBeat());
      S.drops++;
      S.piece.y = dropY(S.board, S.piece);
      lock(beat);
    }
    function stepDown() {
      if (!S.piece) return;
      if (fits(S.board, S.piece, S.piece.x, S.piece.y + 1)) S.piece.y++;
      else lock(null);
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(raw => {
      if (S.paused) return;
      const dt = Math.min(0.05, raw * clamp(Number(ctx.speed) || 1, 0.5, 1));
      if (S.state === 'play' && !S.frozen) {
        S.acc += dt;
        const every = S.soft ? Math.min(0.045, fallTime(S.level)) : fallTime(S.level);
        let k = 0;
        while (S.acc >= every && S.piece && k++ < 6) { S.acc -= every; stepDown(); }
      }
      S.floats.forEach(f => { f.t += raw; });
      S.floats = S.floats.filter(f => f.t < 1.4);
      S.flash = Math.max(0, S.flash - raw);
      S.shake = Math.max(0, S.shake - raw);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    function block(g, x, y, c, a = 1, size = CELL) {
      const col = (cb() ? CB : COLORS)[c];
      g.globalAlpha = a;
      g.fillStyle = col; rr(g, x + 1, y + 1, size - 2, size - 2, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,.22)'; rr(g, x + 3, y + 3, size - 6, (size - 6) * 0.38, 4); g.fill();
      g.fillStyle = 'rgba(0,0,0,.5)'; g.font = `800 ${Math.round(size * 0.42)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(GLYPH[c], x + size / 2, y + size / 2 + 1);
      g.globalAlpha = 1;
    }
    function draw() {
      sf.begin();
      const g = sf.g;
      g.clearRect(0, 0, sf.w, sf.h);
      g.fillStyle = '#0b0912'; g.fillRect(0, 0, sf.w, sf.h);
      const v = fitView(sf, VW, VH, 6);
      const sx = S.shake > 0 && !reduced ? (Math.random() - 0.5) * 4 : 0;
      g.save(); g.translate(v.ox + sx, v.oy); g.scale(v.s, v.s);
      /* the well */
      g.fillStyle = '#14101f'; rr(g, WX - 6, WY - 6, W * CELL + 12, H * CELL + 12, 12); g.fill();
      g.strokeStyle = hsl(HUE, 70, 60, 0.4); g.lineWidth = 2; g.stroke();
      g.fillStyle = 'rgba(255,255,255,.03)';
      for (let x = 0; x < W; x += 2) g.fillRect(WX + x * CELL, WY, CELL, H * CELL);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (S.board[y][x] >= 0) block(g, WX + x * CELL, WY + y * CELL, S.board[y][x]);
      if (S.piece) {
        const gy = dropY(S.board, S.piece);
        for (const c of S.piece.cells) {
          g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.5; rr(g, WX + (S.piece.x + c.dx) * CELL + 3, WY + (gy + c.dy) * CELL + 3, CELL - 6, CELL - 6, 5); g.stroke();
        }
        for (const c of S.piece.cells) block(g, WX + (S.piece.x + c.dx) * CELL, WY + (S.piece.y + c.dy) * CELL, c.c);
      }
      if (S.flash > 0) { g.fillStyle = `rgba(255,255,255,${S.flash})`; g.fillRect(WX, WY, W * CELL, H * CELL); }
      /* the side: next piece, level, the beat ring */
      const px = WX + W * CELL + 26;
      g.fillStyle = '#d8d2ea'; g.font = `700 13px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('NEXT', px, WY + 8);
      for (const c of S.next.cells) block(g, px + c.dx * 24, WY + 18 + c.dy * 24, c.c, 1, 24);
      g.fillStyle = '#9a93ad'; g.font = `600 12px ${FONT}`; g.textAlign = 'left';
      g.fillText(`Level ${S.level}`, px, WY + 120);
      g.fillText(`${S.cleared} squares`, px, WY + 140);
      g.fillText(`${BPM} beats a minute`, px, WY + 160);
      const rcx = px + 46, rcy = WY + 270;
      const ph = S.state === 'play' || S.fakeOn ? (((sinceBeat() / PERIOD) % 1) + 1) % 1 : 0;
      const near = Math.min(ph, 1 - ph) * PERIOD;
      const inGood = S.state === 'play' && sinceBeat() > 0 && near <= 0.11;
      g.lineWidth = 4;
      g.strokeStyle = inGood ? '#3dff9a' : 'rgba(255,255,255,.35)';
      g.beginPath(); g.arc(rcx, rcy, 26, 0, 7); g.stroke();
      if (S.state === 'play' && sinceBeat() > -PERIOD) {
        const r = 26 + 34 * (1 - ph);
        g.strokeStyle = hsl(HUE, 90, 70, 0.9); g.lineWidth = 3;
        g.beginPath(); g.arc(rcx, rcy, ph === 0 ? 26 : r, 0, 7); g.stroke();
      }
      g.fillStyle = '#d8d2ea'; g.font = `700 12px ${FONT}`; g.textAlign = 'center';
      g.fillText('Space on the beat', rcx, rcy + 78);
      if (clk.silent && S.state === 'play') { g.fillStyle = '#ffb46b'; g.font = `600 11px ${FONT}`; g.fillText('no sound here: watch the ring', rcx, rcy + 96, 120); }
      /* what the last drop earned */
      for (const f of S.floats) {
        g.globalAlpha = clamp(1.4 - f.t, 0, 1); g.fillStyle = f.grade === 'perfect' ? '#3dff9a' : f.grade ? '#ffd23f' : '#ffffff';
        g.font = `800 15px ${FONT}`; g.textAlign = 'center';
        g.fillText(f.text, WX + (W * CELL) / 2, WY + 40 - (reduced ? 0 : f.t * 24), W * CELL);
        g.globalAlpha = 1;
      }
      g.restore();
      const k = v.s;
      if (S.state === 'ready') prompt(g, sf, 'Beat Blocks', coarse() ? 'tap to start · drop blocks on the beat' : 'Space to start · drop blocks with Space on the beat', HUE, v.oy + (WY + H * CELL / 2) * k);
      else if (S.paused) prompt(g, sf, 'Paused', 'Esc or P to carry on', HUE, v.oy + (WY + H * CELL / 2) * k);
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const c = e.code;
      const mine = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyX', 'KeyZ'].includes(c);
      if (!mine) return;
      e.preventDefault();
      if (S.paused) return;
      if (S.state === 'ready') { if (c === 'Space' || c === 'ArrowUp') begin(); return; }
      if (S.state !== 'play') return;
      if (c === 'ArrowLeft' || c === 'KeyA') move(-1);
      else if (c === 'ArrowRight' || c === 'KeyD') move(1);
      else if (c === 'ArrowUp' || c === 'KeyW' || c === 'KeyX') { if (!e.repeat) turn(1); }
      else if (c === 'KeyZ') { if (!e.repeat) turn(-1); }
      else if (c === 'ArrowDown' || c === 'KeyS') S.soft = true;
      else if (c === 'Space') { if (!e.repeat) hardDrop(); }
      draw();
    };
    const onKeyUp = e => { if (e.code === 'ArrowDown' || e.code === 'KeyS') S.soft = false; };
    let ptr = null;
    const onDown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      if (S.state === 'ready') { begin(); return; }
      ptr = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
    };
    const onMove = e => {
      if (!ptr || e.pointerId !== ptr.id || S.state !== 'play' || S.paused) return;
      const cell = CELL * fitView(sf, VW, VH, 6).s;
      const steps = Math.trunc((e.clientX - ptr.x) / cell);
      if (steps) { for (let i = 0; i < Math.abs(steps); i++) move(Math.sign(steps)); ptr.x += steps * cell; ptr.moved += Math.abs(steps); draw(); }
    };
    const onUp = e => {
      if (!ptr || e.pointerId !== ptr.id) return;
      const p = ptr; ptr = null;
      if (S.state !== 'play' || S.paused) return;
      const dy = e.clientY - p.y;
      if (dy > 48 && !p.moved) hardDrop();
      else if (!p.moved && Math.abs(dy) < 12) turn(1);
      draw();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', () => { ptr = null; });

    let dead = false;
    draw();

    return {
      stop() {
        if (dead) return; dead = true;
        loop.stop();
        window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
        sf.cv.removeEventListener('pointerdown', onDown); sf.cv.removeEventListener('pointermove', onMove); sf.cv.removeEventListener('pointerup', onUp);
        music.close(); sf.destroy();
      },
      pause() {
        if (dead || S.paused) return;
        S.paused = true; S.soft = false; S.pauseAt = performance.now() / 1000;
        loop.stop(); music.suspend(); draw();
      },
      resume() {
        if (dead || !S.paused) return;
        S.paused = false;
        /* the audio clock stood still while suspended; the performance clock did not, so move its beat grid by the pause */
        if (clk.mode !== 'audio') clk.t0 += performance.now() / 1000 - S.pauseAt;
        if (S.state === 'play') { if (clk.mode === 'audio') music.resume(); loop.start(); } else draw();
      },
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, cleared: S.cleared, level: S.level, board: S.board.map(r => r.slice()),
        piece: S.piece ? { k: S.piece.k, x: S.piece.x, y: S.piece.y, cells: S.piece.cells.map(c => ({ ...c })) } : null,
        next: S.next.k, last: S.last ? { ...S.last } : null, drops: S.drops, beatDrops: S.beatDrops, bestChain: S.bestChain,
        clock: { mode: clk.fake ? 'fake' : clk.mode, t0: t0Of(), now: nowT(), since: sinceBeat(), silent: clk.silent }, period: PERIOD, bpm: BPM,
        musicRunning: music.ready, palette: cb() ? 'cb' : 'standard', floats: S.floats.length, soft: S.soft,
      }),
      /* test hooks — nothing in the game calls them:
         clock({ t0, t }) puts a made-up clock in front of the beat (t = now, t0 = the first beat); clock(null) takes it away
         board(rows) fills the well (rows: strings of . and 0-3, top to bottom) · piece({ k, x, y, colors }) sets the falling piece
         freeze(true) stops gravity so a test can place things */
      hook(cmd, a) {
        if (cmd === 'clock') { clk.fake = a && Number.isFinite(a.t) ? { t0: Number(a.t0) || 0, t: Number(a.t) } : null; S.fakeOn = !!clk.fake; draw(); return true; }
        if (cmd === 'board') { S.board = emptyBoard(); (a || []).forEach((row, i) => { const y = H - (a.length - i); [...String(row)].forEach((ch, x) => { if (/[0-3]/.test(ch) && y >= 0 && x < W) S.board[y][x] = Number(ch); }); }); draw(); return true; }
        if (cmd === 'piece') {
          const p = spawn(() => 0.0);               /* a bar */
          const shapes = { bar: [[0, 0], [1, 0], [2, 0]], corner: [[0, 0], [1, 0], [0, 1]], pair: [[0, 0], [1, 0]] };
          const cells = (shapes[a.k] || shapes.bar).map(([dx, dy], i) => ({ dx, dy, c: (a.colors || [0, 0, 0])[i] ?? 0 }));
          S.piece = { k: a.k || p.k, cells, x: a.x ?? 2, y: a.y ?? 0 }; S.acc = 0; draw(); return true;
        }
        if (cmd === 'freeze') { S.frozen = !!a; return true; }
        return false;
      },
    };
  },
};
