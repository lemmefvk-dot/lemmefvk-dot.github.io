/* ============================================================
   arcade/rhythm.js — Rhythm Tap for Static Arcade.

   Notes fall down four lanes; tap each one as it crosses the hit
   line. Three original songs (written below as note sequences)
   are synthesized live in Web Audio — no audio files.

   Controls
     keyboard       D F J K are the four lanes · Space starts
     mouse / touch  tap a lane (tap anywhere on the board to start)
   Timing windows (seconds from the note's time, after the audio
   offset): Perfect ±0.045, Good ±0.100, Miss ±0.160 (a press that
   close to a note spends it as a miss). A note nobody pressed
   by 0.160 s after its time is a miss too. Perfect = 100 points,
   Good = 60, both times a combo multiplier (+0.25 per 10 in a row,
   up to ×2). Accuracy = (Perfect + 0.6 × Good) / notes.

   Timing: the notes and the music are scheduled on the
   AudioContext's own clock (oscillators start at exact
   `ctx.currentTime` stamps, not from timers), and the falling notes
   are drawn from that same clock, so they cannot drift from what
   you hear. Before a song starts the clock is probed: if the
   AudioContext does not advance (headless, blocked, suspended) or
   does not exist, the game falls back to performance.now(), says
   "Sound unavailable" and plays silently rather than freezing.
   Settings holds an audio offset in ms (positive = you tap late)
   and a Calibrate button: tap along with eight clicks and the
   median gap becomes the offset.

   Score = points, higher is better. The best per song is kept on
   this device (portal.arcadePuzzles.rhythm). Reduced motion: no
   flashes or sparks.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { clamp, hsl, FONT, fitView, surface, ownsKey, looper, rr, prompt, coarse } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';

const GAME = 'rhythm';
const LANES = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], LABELS = ['D', 'F', 'J', 'K'];
const HUES = [350, 42, 140, 205];
const PERFECT = 0.045, GOOD = 0.10, MISS = 0.16;
const LEAD = 1.8, FALL = 1.5;
const VW = 360, VH = 600, LX = 20, LW = 80, HIT_Y = 500;
const CAL_CLICKS = Array.from({ length: 8 }, (_, i) => 0.8 + i * 0.6);
const SPEED = (HIT_Y + 30) / FALL;

/* ---------- the songs ----------
   A song is a scale, a tempo and a form. Each pattern is two bars of
   eight eighth-note steps: a letter is a scale degree (a = lowest,
   o = highest), '.' a rest, '-' holds the note before. The falling
   note's lane is its pitch band (a–d, e–h, i–l, m–o, spread over 4). */
const MINOR_PENT = [0, 3, 5, 7, 10], MAJOR = [0, 2, 4, 5, 7, 9, 11], DORIAN = [0, 2, 3, 5, 7, 9, 10];
const degree = (scale, i) => 12 * Math.floor(i / scale.length) + scale[i % scale.length];
export const SONGS = [
  { id: 'neon', name: 'Neon Drive', bpm: 112, root: 57, scale: MINOR_PENT, wave: 'sawtooth', kick: [0, 4],
    pats: { A: 'e.gi.ige' + 'c.eg.gec', B: 'i.lk.ihg' + 'g.ig.ec-', C: 'l.nl.kig' + 'i.lni.l-' },
    bass: { A: [0, 8], B: [3, 7], C: [8, 10] }, form: 'ABABCCAB' },
  { id: 'pixel', name: 'Pixel Parade', bpm: 128, root: 60, scale: MAJOR, wave: 'square', kick: [0, 3, 4],
    pats: { D: 'a.cea.ce' + 'g.egc.a-', A: 'e.fg.gfe' + 'd.eg.ed-', B: 'g.ij.gfe' + 'f.gj.gf-', C: 'i.kmk.ig' + 'j.lnl.j-' },
    bass: { D: [0, 0], A: [0, 5], B: [7, 5], C: [9, 7] }, form: 'DABACCBA' },
  { id: 'static', name: 'Midnight Static', bpm: 140, root: 50, scale: DORIAN, wave: 'triangle', kick: [0, 4, 5],
    pats: { D: 'a.cdf.da' + 'c.fhf.c-', A: 'c.cef.fe' + 'c.ceh.hg', B: 'h.hjk.kj' + 'h.fhj.k-', C: 'k.mon.mk' + 'j.hjk.h-' },
    bass: { D: [0, 0], A: [0, 5], B: [3, 5], C: [7, 3] }, form: 'DABACCABA' },
];
export const songById = id => SONGS.find(s => s.id === id) || SONGS[0];

/* turn a song into { notes: [{t, lane, dur, midi}], bass: [{t, dur, midi}], drums: [{t, k}], length } (times in seconds) */
export function build(song) {
  const step = 60 / song.bpm / 2, notes = [], bass = [], drums = [];
  let s = 0;
  for (const key of song.form) {
    const pat = song.pats[key];
    for (let i = 0; i < pat.length;) {
      const ch = pat[i];
      if (ch === '.' || ch === '-') { i++; continue; }
      let len = 1;
      while (pat[i + len] === '-') len++;
      const idx = ch.charCodeAt(0) - 97;
      notes.push({ t: (s + i) * step, lane: Math.min(3, Math.floor(idx * 4 / 15)), dur: len * step * 0.92, midi: song.root + degree(song.scale, idx) });
      i += len;
    }
    for (let bar = 0; bar < 2; bar++) {
      const root = song.root - 12 + song.bass[key][bar];
      for (const st of [0, 3, 4, 7]) bass.push({ t: (s + bar * 8 + st) * step, dur: step * 1.6, midi: root + (st === 3 || st === 7 ? 7 : 0) });
      for (let st = 0; st < 8; st++) {
        const t = (s + bar * 8 + st) * step;
        if (song.kick.includes(st)) drums.push({ t, k: 'kick' });
        if (st === 2 || st === 6) drums.push({ t, k: 'snare' });
        drums.push({ t, k: st % 2 ? 'hat2' : 'hat' });
      }
    }
    s += pat.length;
  }
  return { notes, bass, drums, length: s * step };
}

const CSS = `${BASE}
.pz-rh__stage{touch-action:none}
.pz-rh__set{position:absolute;inset:0;z-index:6;display:grid;place-items:center;background:rgba(6,8,14,.82);padding:12px}
.pz-rh__set[hidden]{display:none}
.pz-rh__panel{width:min(100%,360px);display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:14px;background:var(--bg-2,#171a24);border:1px solid var(--line-2,rgba(255,255,255,.14));color:var(--ink-1,#eee)}
.pz-rh__panel h3{margin:0;font-size:15px}
.pz-rh__panel p{margin:0;font-size:12px;color:var(--ink-3,#aaa);line-height:1.4}
.pz-rh__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pz-rh__row input{width:90px;font:600 14px var(--font,system-ui);padding:6px 8px;border-radius:8px;border:1px solid var(--line-2,rgba(255,255,255,.2));background:var(--fill-1,rgba(255,255,255,.06));color:inherit}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let dead = false;
    let song = songById(sv.song);
    let offsetMs = clamp(Number(sv.offset) || 0, -300, 300);

    /* the run: state idle | starting | playing | calib | over */
    const S = {
      state: 'idle', paused: false, chart: build(song), notes: [], t0: 0, mode: 'auto', force: 'auto', soundOk: false,
      manualT: 0, pausedAt: 0, score: 0, combo: 0, maxCombo: 0, counts: { perfect: 0, good: 0, miss: 0 }, resolved: 0,
      msg: '', flash: [0, 0, 0, 0], judge: null, calib: null, ac: null, master: null, noise: null, result: null, probeTimer: 0, token: 0,
    };

    /* ---------- chrome ---------- */
    const songBtns = SONGS.map(s => h('button', { type: 'button', dataset: { song: s.id }, 'aria-pressed': 'false', title: `${s.name}, ${s.bpm} BPM` }, s.name));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Song' }, songBtns);
    const scoreV = h('span', { text: '0' });
    const scoreRead = h('div.pz__read', { title: 'Score', 'aria-label': 'Score' }, icon('star'), scoreV);
    const bestV = h('small', { text: '' });
    const startBtn = h('button.pz__btn', { type: 'button', title: 'Start the song (Space)' }, icon('play'), h('span.pz__long', { text: 'Start' }));
    const setBtn = h('button.pz__btn', { type: 'button', title: 'Settings: audio offset' }, icon('sliders'), h('span.pz__long', { text: 'Settings' }));
    const top = h('div.pz__top', seg, scoreRead, bestV, startBtn, setBtn);
    const stage = h('div.pz__stage.pz-rh__stage');
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const offIn = h('input', { type: 'number', min: '-300', max: '300', step: '5', value: String(offsetMs), 'aria-label': 'Audio offset in milliseconds' });
    const calBtn = h('button.pz__btn', { type: 'button' }, icon('music'), h('span', { text: 'Calibrate' }));
    const closeBtn = h('button.pz__btn', { type: 'button' }, 'Done');
    const panel = h('div.pz-rh__set', { hidden: true },
      h('div.pz-rh__panel', { role: 'dialog', 'aria-label': 'Rhythm Tap settings' },
        h('h3', { text: 'Audio offset' }),
        h('p', { text: 'If every note feels late, raise the offset; if early, lower it. Positive means you tap late. Calibrate: tap Space, a lane key or the board along with eight clicks, and the median gap is used.' }),
        h('div.pz-rh__row', h('label', { text: 'Offset (ms)' }), offIn, calBtn),
        h('div.pz-rh__row', closeBtn)));
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), h('style', { text: CSS }), top, stage, foot, live);
    el.appendChild(root);
    stage.appendChild(panel);
    const sf = surface(stage, 'Rhythm Tap board: four lanes of falling notes', () => draw());
    let V = fitView(sf, VW, VH, 4);

    const say = m => { S.msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(S.msg ? h('span', { text: S.msg })
      : h('span.pz__hint', { html: coarse() ? 'tap the lanes as the notes arrive' : 'lanes <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> · <kbd>Space</kbd> starts · or tap the lanes' }));

    /* ---------- the clock ---------- */
    const now = () => (S.mode === 'audio' && S.ac ? S.ac.currentTime : S.mode === 'manual' ? S.manualT : performance.now() / 1000);
    const songT = () => now() - S.t0;
    const offS = () => offsetMs / 1000;
    const effT = () => songT() - offS();

    /* ---------- the synth: every sound is scheduled on S.ac's clock ---------- */
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    function tone(t, dur, freq, type, vol, to = 0) {
      const c = S.ac, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
      o.connect(g).connect(S.master);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(t, dur, vol, hp) {
      const c = S.ac, src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      src.buffer = S.noise; f.type = 'highpass'; f.frequency.value = hp;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(S.master);
      src.start(t); src.stop(t + dur + 0.02);
    }
    function scheduleSong(start) {
      const ch = S.chart;
      for (const n of ch.notes) tone(start + n.t, n.dur, mtof(n.midi), song.wave, 0.16);
      for (const b of ch.bass) tone(start + b.t, b.dur, mtof(b.midi), 'triangle', 0.3);
      for (const d of ch.drums) {
        const t = start + d.t;
        if (d.k === 'kick') tone(t, 0.16, 150, 'sine', 0.55, 45);
        else if (d.k === 'snare') noise(t, 0.12, 0.28, 1500);
        else noise(t, 0.04, d.k === 'hat' ? 0.1 : 0.05, 7000);
      }
    }
    function scheduleCalib(start) {
      for (const c of CAL_CLICKS) tone(start + c, 0.06, 1200, 'square', 0.2);
    }
    function closeAudio() {
      clearTimeout(S.probeTimer);
      try { S.ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      S.ac = null; S.master = null;
    }

    /* Pick the clock: the AudioContext's if it really runs, else performance.now() */
    function openClock() {
      return new Promise(resolve => {
        if (S.force === 'manual') { S.mode = 'manual'; S.soundOk = false; return resolve(); }
        const fallback = why => {
          closeAudio();
          S.mode = 'perf'; S.soundOk = false;
          say(`Sound unavailable (${why}) — playing silently on the system clock. Timing still works.`);
          resolve();
        };
        const AC = window.AudioContext || window.webkitAudioContext;
        if (S.force === 'perf' || !AC) return fallback('no audio');
        closeAudio();
        try { S.ac = new AC(); } catch (err) { return fallback('blocked'); }
        const ac = S.ac;
        S.master = ac.createGain();
        S.master.gain.value = ctx.sound === false ? 0 : 0.5 * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
        S.master.connect(ac.destination);
        S.noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.3), ac.sampleRate);
        const d = S.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const token = S.token;
        Promise.resolve(ac.state === 'suspended' ? ac.resume() : null).catch(() => {});
        /* did the clock move? compare ac.currentTime with real time over 200 ms */
        const c0 = ac.currentTime, p0 = performance.now();
        S.probeTimer = setTimeout(() => {
          if (dead || token !== S.token) return resolve();
          const adv = ac.currentTime - c0, real = (performance.now() - p0) / 1000;
          if (S.force === 'stall' || ac.state !== 'running' || adv < real * 0.5) return fallback('the audio clock is not running');
          S.mode = 'audio'; S.soundOk = true;
          resolve();
        }, 200);
      });
    }

    /* ---------- a song ---------- */
    function reset() {
      S.token++;
      closeAudio();
      Object.assign(S, { state: 'idle', paused: false, score: 0, combo: 0, maxCombo: 0, counts: { perfect: 0, good: 0, miss: 0 }, resolved: 0, flash: [0, 0, 0, 0], judge: null, calib: null, result: null, msg: '' });
      S.chart = build(song);
      S.notes = S.chart.notes.map(n => ({ ...n, res: null }));
      scoreV.textContent = '0';
      paintTop();
    }
    function paintTop() {
      songBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.song === song.id)));
      const b = bests[song.id];
      bestV.textContent = b ? `Best ${song.name}: ${b.score} (${b.acc}%)` : '';
      const busy = S.state === 'starting' || S.state === 'playing' || S.state === 'calib';
      setBtn.disabled = busy;
      songBtns.forEach(x => { x.disabled = busy; });
      startBtn.querySelector('span').textContent = busy ? 'Restart' : 'Start';
    }
    async function start() {
      if (dead || S.state === 'starting') return;
      reset();
      S.state = 'starting';
      const token = S.token;
      paintTop();
      say('Getting the audio clock ready…');
      await openClock();
      if (dead || token !== S.token) return;
      /* songT() starts at -LEAD: the notes need time to fall into view */
      S.t0 = (S.mode === 'audio' ? S.ac.currentTime + 0.12 : now()) + LEAD;
      if (S.mode === 'audio') scheduleSong(S.t0);
      S.state = 'playing';
      if (S.soundOk || S.mode === 'manual') say(`${song.name}: here we go.`);
      paintTop();
      loop.start();
    }
    async function beginCalib() {
      if (S.state === 'starting') return;
      reset();
      S.state = 'starting';
      const token = S.token;
      paintTop();
      await openClock();
      if (dead || token !== S.token) return;
      S.calib = { clicks: CAL_CLICKS, taps: [] };
      S.t0 = S.mode === 'audio' ? S.ac.currentTime + 0.12 + LEAD : S.mode === 'manual' ? S.manualT + LEAD : now() + LEAD;
      if (S.mode === 'audio') scheduleCalib(S.t0);
      S.state = 'calib';
      closePanel();
      say(S.soundOk ? 'Tap Space, a lane key or the board with each click.' : 'Sound unavailable — tap along with the flashes instead.');
      paintTop();
      loop.start();
    }
    function judge(kind, lane) {
      const n = S.counts;
      n[kind]++; S.resolved++;
      if (kind === 'miss') S.combo = 0;
      else {
        S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
        S.score += Math.round((kind === 'perfect' ? 100 : 60) * (1 + Math.min(4, Math.floor(S.combo / 10)) * 0.25));
      }
      S.judge = { kind, lane, at: performance.now() };
      scoreV.textContent = String(S.score);
      onScore(S.score);
    }
    const accuracy = () => (S.resolved ? (S.counts.perfect + 0.6 * S.counts.good) / S.resolved * 100 : 100);
    function press(lane) {
      if (dead || S.paused) return;
      if (S.state === 'idle' || S.state === 'over') { start(); return; }
      if (S.state === 'calib') { if (S.calib) S.calib.taps.push(songT()); S.flash[lane] = performance.now(); return; }
      if (S.state !== 'playing') return;
      S.flash[lane] = performance.now();
      const e = effT();
      let best = null, bd = 9;
      for (const n of S.notes) {
        if (n.res || n.lane !== lane) continue;
        const d = Math.abs(n.t - e);
        if (d < bd) { bd = d; best = n; }
        if (n.t - e > MISS) break;
      }
      if (!best || bd > MISS) return;           /* a stray tap costs nothing */
      best.res = bd <= PERFECT ? 'perfect' : bd <= GOOD ? 'good' : 'miss';
      best.err = e - best.t;
      judge(best.res, lane);
      if (!reduced && best.res !== 'miss') S.flash[lane] = performance.now();
    }
    function update() {
      if (S.paused || dead) return;
      if (S.state === 'playing') {
        const e = effT();
        for (const n of S.notes) {
          if (n.res) continue;
          if (e - n.t > MISS) { n.res = 'miss'; judge('miss', n.lane); } else if (n.t > e) break;
        }
        if (e > S.chart.length + 1.2) finish();
      } else if (S.state === 'calib' && S.calib) {
        if (songT() > S.calib.clicks[S.calib.clicks.length - 1] + 0.8) finishCalib();
      }
    }
    function finish() {
      if (S.state !== 'playing') return;
      for (const n of S.notes) if (!n.res) { n.res = 'miss'; judge('miss', n.lane); }
      S.state = 'over'; loop.stop();
      const acc = Math.round(accuracy() * 10) / 10;
      const grade = acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 70 ? 'B' : 'C';
      S.result = { score: S.score, acc, grade, maxCombo: S.maxCombo, counts: { ...S.counts } };
      const prev = bests[song.id];
      if (!prev || S.score > prev.score) { bests[song.id] = { score: S.score, acc }; save(GAME, { best: bests }); }
      closeAudio();
      paintTop(); draw();
      say(`${song.name}: grade ${grade}, ${acc}% accuracy, best combo ${S.maxCombo}.`);
      onEnd({ score: S.score, won: acc >= 60, detail: `${song.name} · ${grade} · ${acc}% · combo ${S.maxCombo}` });
    }
    function finishCalib() {
      const diffs = [];
      for (const c of S.calib.clicks) {
        let b = null;
        for (const t of S.calib.taps) if (Math.abs(t - c) < 0.35 && (b === null || Math.abs(t - c) < Math.abs(b - c))) b = t;
        if (b !== null) diffs.push(b - c);
      }
      S.state = 'idle'; S.calib = null; loop.stop(); closeAudio();
      if (diffs.length >= 3) {
        diffs.sort((a, b) => a - b);
        const med = diffs.length % 2 ? diffs[(diffs.length - 1) / 2] : (diffs[diffs.length / 2 - 1] + diffs[diffs.length / 2]) / 2;
        setOffset(Math.round(med * 1000));
        say(`Calibrated: audio offset ${offsetMs} ms (from ${diffs.length} taps).`);
      } else say('Not enough taps to calibrate — the offset is unchanged.');
      paintTop(); draw();
      openPanel();
    }
    function setOffset(ms) {
      offsetMs = clamp(Math.round(Number(ms) || 0), -300, 300);
      offIn.value = String(offsetMs);
      save(GAME, { offset: offsetMs });
    }
    const openPanel = () => { if (S.state === 'idle' || S.state === 'over') panel.hidden = false; };
    const closePanel = () => { panel.hidden = true; };

    /* ---------- drawing ---------- */
    function draw() {
      if (dead) return;
      sf.begin();
      V = fitView(sf, VW, VH, 4);
      const g = sf.g;
      g.clearRect(0, 0, sf.w, sf.h);
      g.fillStyle = '#080a12'; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.fillStyle = '#0c0f1a'; g.fillRect(0, 0, VW, VH);
      const t = S.state === 'playing' || S.state === 'calib' ? songT() : -LEAD, ts = performance.now();
      for (let i = 0; i < 4; i++) {
        const x = LX + i * LW;
        g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.06)';
        g.fillRect(x, 0, LW, VH);
        const f = reduced ? 0 : Math.max(0, 1 - (ts - S.flash[i]) / 160);
        if (f) { g.fillStyle = hsl(HUES[i], 90, 60, 0.35 * f); g.fillRect(x, 0, LW, HIT_Y + 30); }
        g.fillStyle = hsl(HUES[i], 80, 60, 0.9); g.font = `700 18px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(LABELS[i], x + LW / 2, HIT_Y + 52);
      }
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(LX + i * LW, 0); g.lineTo(LX + i * LW, VH); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(LX, HIT_Y); g.lineTo(LX + 4 * LW, HIT_Y); g.stroke();
      if (S.state === 'playing' || S.state === 'over' || S.paused) {
        const e = (S.state === 'over' ? 1e9 : t - offS());
        for (const n of S.notes) {
          if (n.res && n.res !== 'miss') continue;
          const y = HIT_Y - (n.t - (t)) * SPEED;
          if (y < -30 || y > VH + 30) continue;
          g.fillStyle = n.res === 'miss' ? 'rgba(140,140,150,.5)' : hsl(HUES[n.lane], 85, 58);
          rr(g, LX + n.lane * LW + 8, y - 11, LW - 16, 22, 8); g.fill();
          if (!n.res) { g.fillStyle = 'rgba(255,255,255,.35)'; rr(g, LX + n.lane * LW + 12, y - 8, LW - 24, 6, 3); g.fill(); }
        }
        void e;
      }
      if (S.state === 'calib' && S.calib) {
        for (const c of S.calib.clicks) {
          const d = t - c;
          if (d > -0.02 && d < 0.18 && !reduced) { g.strokeStyle = 'rgba(255,255,255,' + (1 - d / 0.18) * 0.9 + ')'; g.lineWidth = 4; g.beginPath(); g.arc(VW / 2, 250, 30 + d * 120, 0, Math.PI * 2); g.stroke(); }
        }
        const left = S.calib.clicks.filter(c => c > t).length;
        g.fillStyle = '#fff'; g.font = `700 20px ${FONT}`; g.textAlign = 'center';
        g.fillText(left ? `${left} clicks to go` : 'done', VW / 2, 250);
      }
      /* HUD on the board */
      g.textAlign = 'center'; g.fillStyle = '#fff';
      if (S.combo > 1) { g.font = `800 38px ${FONT}`; g.fillText(String(S.combo), VW / 2, 120); g.font = `600 12px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText('COMBO', VW / 2, 144); }
      if (S.judge && ts - S.judge.at < 600) {
        const a = reduced ? 1 : 1 - (ts - S.judge.at) / 600;
        g.globalAlpha = Math.max(0, a);
        g.font = `800 22px ${FONT}`; g.fillStyle = S.judge.kind === 'perfect' ? '#ffe36b' : S.judge.kind === 'good' ? '#6be0ff' : '#ff6b81';
        g.fillText(S.judge.kind.toUpperCase(), VW / 2, 200 - (reduced ? 0 : (ts - S.judge.at) / 40));
        g.globalAlpha = 1;
      }
      if (S.state !== 'idle' && S.state !== 'starting') {
        g.textAlign = 'left'; g.font = `600 12px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.7)';
        g.fillText(`${accuracy().toFixed(1)}%`, 8, 16);
        g.textAlign = 'right'; g.fillText(`P ${S.counts.perfect}  G ${S.counts.good}  M ${S.counts.miss}`, VW - 8, 16);
        const prog = clamp((t + LEAD) / (S.chart.length + LEAD), 0, 1);
        g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, VH - 4, VW, 4);
        g.fillStyle = hsl(HUES[0], 90, 62); g.fillRect(0, VH - 4, VW * prog, 4);
      }
      g.restore();
      const w = { w: sf.w, h: sf.h };
      if (S.state === 'idle') prompt(g, w, song.name, coarse() ? 'Tap the board to start' : 'Press Space, or tap, to start', HUES[3]);
      else if (S.state === 'starting') prompt(g, w, 'Getting ready…', null, HUES[3]);
      else if (S.state === 'over' && S.result) prompt(g, w, `${S.result.grade} · ${S.result.score} points`, `${S.result.acc}% · best combo ${S.result.maxCombo} · Space to replay`, HUES[1]);
      if (!S.soundOk && S.mode !== 'auto' && S.mode !== 'manual' && (S.state === 'playing' || S.state === 'calib')) {
        g.fillStyle = 'rgba(255,200,80,.95)'; g.font = `600 12px ${FONT}`; g.textAlign = 'center';
        g.fillText('Sound unavailable', sf.w / 2, sf.h - 10);
      }
    }
    const loop = looper(() => { update(); draw(); });

    /* ---------- input ---------- */
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };   /* a Space aimed at the game must not also click the button you last used */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const lane = LANES.indexOf(e.code);
      if (lane >= 0) { e.preventDefault(); if (!e.repeat) { if (!panel.hidden) return; press(lane); } }
      else if (e.key === ' ') {
        unfocus();
        e.preventDefault();
        if (e.repeat || !panel.hidden) return;
        if (S.state === 'idle' || S.state === 'over') start(); else if (S.state === 'calib') press(0);
      }
    });
    L.on(stage, 'pointerdown', e => {
      if (dead || e.button > 0 || !panel.hidden || e.target.closest('.pz-rh__set')) return;
      e.preventDefault();
      const r = sf.cv.getBoundingClientRect();
      const x = (e.clientX - r.left - V.ox) / V.s;
      press(clamp(Math.floor((x - LX) / LW), 0, 3));
    });
    L.on(seg, 'click', e => {
      const b = e.target.closest?.('button[data-song]');
      if (b && !dead && (S.state === 'idle' || S.state === 'over')) { song = songById(b.dataset.song); save(GAME, { song: song.id }); reset(); paintFoot(); draw(); }
    });
    L.on(startBtn, 'click', () => { if (!dead) { closePanel(); start(); } });
    L.on(setBtn, 'click', () => { if (!dead) openPanel(); });
    L.on(closeBtn, 'click', closePanel);
    L.on(calBtn, 'click', () => { if (!dead) beginCalib(); });
    L.on(offIn, 'change', () => setOffset(offIn.value));

    reset(); paintFoot(); draw();
    onScore(0);

    return {
      stop() {
        if (dead) return;
        dead = true; S.token++;
        loop.stop(); closeAudio(); L.clear(); sf.destroy(); root.remove();
      },
      pause() {
        if (dead || S.paused) return;
        S.paused = true; S.pausedAt = now();
        loop.stop();
        if (S.mode === 'audio') S.ac?.suspend?.().catch?.(() => {});
        draw();
      },
      resume() {
        if (dead || !S.paused) return;
        S.paused = false;
        if (S.mode === 'audio') S.ac?.resume?.().catch?.(() => {});
        else if (S.mode === 'perf') S.t0 += now() - S.pausedAt;
        if (S.state === 'playing' || S.state === 'calib') loop.start();
        draw();
      },
      peek: () => ({
        state: S.state, paused: S.paused, mode: S.mode, soundOk: S.soundOk, songT: S.state === 'playing' || S.state === 'calib' ? (S.paused && S.mode !== 'audio' ? S.pausedAt - S.t0 : songT()) : null,
        song: song.id, length: S.chart.length, score: S.score, combo: S.combo, maxCombo: S.maxCombo, counts: { ...S.counts }, accuracy: accuracy(),
        offset: offsetMs, msg: S.msg, result: S.result, best: JSON.parse(JSON.stringify(bests)), settingsOpen: !panel.hidden,
        notes: S.notes.map(n => ({ t: n.t, lane: n.lane, res: n.res })), calibrating: S.state === 'calib',
        windows: { perfect: PERFECT, good: GOOD, miss: MISS }, geom: { ox: V.ox, oy: V.oy, s: V.s, lx: LX, lw: LW },
      }),
      /* test hook — nothing in the game calls it:
         clock('auto'|'manual'|'perf'|'stall') · song(id) · start() · seek(songSeconds) · step(seconds) · offset(ms) · calibrate() */
      hook(cmd, arg) {
        if (cmd === 'clock') S.force = arg;
        else if (cmd === 'song') { song = songById(arg); save(GAME, { song: song.id }); reset(); draw(); }
        else if (cmd === 'start') start();
        else if (cmd === 'seek') { S.t0 = now() - arg; update(); draw(); }
        else if (cmd === 'step') { if (S.mode === 'manual' && !S.paused) { S.manualT += arg; update(); draw(); } }
        else if (cmd === 'offset') setOffset(arg);
        else if (cmd === 'calibrate') beginCalib();
        return true;
      },
    };
  },
};
