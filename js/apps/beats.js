/* ============================================================
   beats.js — Static Beats: a step-sequencer drum machine.

   Every voice is synthesised at play time from oscillators and a
   single reusable white-noise buffer — there are no samples. Eight
   instruments (kick, snare, clap, closed/open hi-hat, tom, rim,
   cowbell) run down a 16-step grid; click a cell to toggle a hit,
   or drag to paint a run.

   Timing is real. A lookahead scheduler (Chris Wilson's "two clocks"
   pattern) reads the AudioContext's own clock: every 25 ms it queues
   any 16th-notes that fall inside the next ~120 ms, so the groove
   stays rock-steady no matter how busy the main thread is. BPM, swing
   and per-row volume/mute feed that scheduler live. A requestAnimation-
   Frame loop lights the playhead from the same audio clock, so the
   moving column is what you actually hear, not a guess.

   Output honestly follows the system Volume and Mute (prefs.volume /
   prefs.muted); a DynamicsCompressor on the bus keeps a full pattern
   from clipping. Export bounces the loop through an OfflineAudioContext
   and writes a real 16-bit WAV into ~/Music via core/media.js — it then
   opens in the Music app for real. Patterns save to store 'portal.beats'.

   Song mode chains saved patterns into a whole song: an ordered list
   of { pattern, times }, edited with add / remove / move up and down /
   duplicate and a repeat count per entry. Each pattern keeps its own
   tempo, swing, levels and mutes. The song plays through the same
   lookahead scheduler, one 16-step bar at a time, with a marker on the
   entry being heard (from the audio clock, like the playhead) and a
   bar over the whole song; it stops at the end. Export song renders it
   through the same OfflineAudioContext path as the loop, exactly as
   long as the song: the sum of every pattern's bar length × its
   repeats. A pattern deleted from the library stays in the song by
   name, says so, and is skipped. The song is saved with the patterns
   ('portal.beats'.song); older saves without one load as before.

   Teardown stops the scheduler + the draw loop, cancels the store
   subscriptions and the autosave timer, and closes the AudioContext.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-beats-css')) {
  const l = document.createElement('link');
  l.id = 'feat-beats-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-beats.css';
  document.head.appendChild(l);
}

const STEPS = 16;
const LOOKAHEAD_MS = 25;      /* how often the scheduler wakes */
const AHEAD_S = 0.12;         /* how far ahead it queues notes */

/* The eight voices, in row order. `peak` balances one voice against the
   others before the per-row gain and the bus compressor. */
const INSTRUMENTS = [
  { id: 'kick',    name: 'Kick',     peak: 1.0 },
  { id: 'snare',   name: 'Snare',    peak: 0.9 },
  { id: 'clap',    name: 'Clap',     peak: 0.9 },
  { id: 'hat',     name: 'Hi-Hat',   peak: 0.7 },
  { id: 'ohat',    name: 'Open Hat', peak: 0.6 },
  { id: 'tom',     name: 'Tom',      peak: 0.85 },
  { id: 'rim',     name: 'Rim',      peak: 0.7 },
  { id: 'cowbell', name: 'Cowbell',  peak: 0.6 },
];
const IDS = INSTRUMENTS.map(i => i.id);

/* --- the synthesis. Each voice is context-agnostic: it builds its
   nodes on whichever AudioContext it is handed (live or offline) and
   plays into `out` (a per-row gain). `nb` is that context's noise buffer. */
const VOICES = {
  kick(ac, t, out, nb, v) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.45);
  },
  snare(ac, t, out, nb, v) {
    const n = noise(ac, nb), hp = ac.createBiquadFilter(), ng = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = 1400;
    ng.gain.setValueAtTime(v * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(hp).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.22);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(185, t);
    og.gain.setValueAtTime(v * 0.55, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.14);
  },
  clap(ac, t, out, nb, v) {
    const bp = ac.createBiquadFilter(), busg = ac.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 0.7;
    bp.connect(busg).connect(out);
    const bursts = [0, 0.012, 0.024, 0.04];
    bursts.forEach((d, i) => {
      const n = noise(ac, nb), ng = ac.createGain();
      const last = i === bursts.length - 1;
      ng.gain.setValueAtTime(0.0001, t + d);
      ng.gain.exponentialRampToValueAtTime(v * (last ? 0.8 : 0.55), t + d + 0.001);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + d + (last ? 0.18 : 0.02));
      n.connect(ng).connect(bp);
      n.start(t + d); n.stop(t + d + 0.2);
    });
  },
  hat(ac, t, out, nb, v) { hatVoice(ac, t, out, nb, v, 0.045, 7200); },
  ohat(ac, t, out, nb, v) { hatVoice(ac, t, out, nb, v, 0.34, 6200); },
  tom(ac, t, out, nb, v) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(98, t + 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.33);
  },
  rim(ac, t, out, nb, v) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(1700, t);
    g.gain.setValueAtTime(v * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.04);
    const n = noise(ac, nb), hp = ac.createBiquadFilter(), ng = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    ng.gain.setValueAtTime(v * 0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.connect(hp).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.03);
  },
  cowbell(ac, t, out, nb, v) {
    const bp = ac.createBiquadFilter(), g = ac.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 560; bp.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * 0.6, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    bp.connect(g).connect(out);
    for (const f of [540, 800]) {
      const o = ac.createOscillator();
      o.type = 'square'; o.frequency.setValueAtTime(f, t);
      o.connect(bp); o.start(t); o.stop(t + 0.28);
    }
  },
};

function hatVoice(ac, t, out, nb, v, dur, hz) {
  const n = noise(ac, nb), hp = ac.createBiquadFilter(), g = ac.createGain();
  hp.type = 'highpass'; hp.frequency.value = hz;
  g.gain.setValueAtTime(v * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(hp).connect(g).connect(out);
  n.start(t); n.stop(t + dur + 0.02);
}

function noise(ac, buf) { const s = ac.createBufferSource(); s.buffer = buf; return s; }
function makeNoise(ac) {
  const len = Math.floor(ac.sampleRate * 1.5);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/* --- preset grooves. "x" = hit, anything else = rest, 16 chars. --- */
const P = s => Array.from({ length: STEPS }, (_, i) => s[i] === 'x');
const PRESETS = [
  { name: 'Four on the Floor', bpm: 124, swing: 0, rows: {
    kick:'x...x...x...x...', clap:'....x.......x...', ohat:'..x...x...x...x.', hat:'x.x.x.x.x.x.x.x.' } },
  { name: 'Boom Bap', bpm: 90, swing: 0.16, rows: {
    kick:'x.....x...x.....', snare:'....x.......x...', hat:'x.x.x.x.x.x.x.x.' } },
  { name: 'Trap', bpm: 140, swing: 0, rows: {
    kick:'x.......x..x....', snare:'....x.......x...', hat:'x.x.xxx.x.x.xxxx' } },
  { name: 'Rock', bpm: 120, swing: 0, rows: {
    kick:'x...x...x...x...', snare:'....x.......x...', hat:'x.x.x.x.x.x.x.x.' } },
  { name: 'Breakbeat', bpm: 166, swing: 0, rows: {
    kick:'x......x..x.....', snare:'....x..x....x..x', hat:'x.x.x.x.x.x.x.x.' } },
  { name: 'Techno', bpm: 130, swing: 0, rows: {
    kick:'x...x...x...x...', clap:'....x.......x...', ohat:'..x...x...x...x.', rim:'..x.x...x...x.x.' } },
  { name: 'Half-Time', bpm: 84, swing: 0.2, rows: {
    kick:'x.......x..x....', snare:'........x.......', hat:'x.x.x.x.x.x.x.x.', tom:'..............x.' } },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const emptyRow = () => Array.from({ length: STEPS }, () => false);

/* --- song mode: pure helpers, shared by playback and export --- */
const SONG_MAX = 64;          /* entries in a song */
const TIMES_MAX = 16;         /* repeats of one entry */
const stepDurOf = bpm => 60 / bpm / 4;

/** A saved pattern, read defensively (the same rules as loading one into the grid). */
function normPattern(p) {
  const out = { bpm: clamp(Number(p?.bpm) || 120, 40, 240), swing: clamp(Number(p?.swing) || 0, 0, 0.5), steps: {}, vols: {}, mutes: {} };
  for (const id of IDS) {
    const src = Array.isArray(p?.steps?.[id]) ? p.steps[id] : [];
    out.steps[id] = Array.from({ length: STEPS }, (_, i) => !!src[i]);
    out.vols[id] = typeof p?.vols?.[id] === 'number' ? clamp(p.vols[id], 0, 1) : 0.8;
    out.mutes[id] = p?.mutes?.[id] === true;
  }
  return out;
}

/** Song entries + the pattern library → one bar per repeat, back to back. */
function songPlan(items, patterns) {
  const byId = new Map((patterns || []).map(p => [p.id, p]));
  const bars = [];
  let t = 0;
  (items || []).forEach((it, idx) => {
    const p = byId.get(it.pat);
    if (!p) return;                                /* deleted from the library: skipped */
    const snap = normPattern(p);
    const sd = stepDurOf(snap.bpm);
    for (let r = 0; r < it.times; r++) {
      bars.push({ idx, rep: r, of: it.times, start: t, dur: sd * STEPS, sd, snap });
      t += sd * STEPS;
    }
  });
  return { bars, total: t };
}

/** The hits of one step of one bar: when (song time), which voice, how loud. */
function stepHits(bar, step) {
  let t = bar.start + step * bar.sd;
  if (step % 2 === 1) t += bar.sd * bar.snap.swing;
  const out = [];
  for (const inst of INSTRUMENTS) {
    const vol = bar.snap.vols[inst.id];
    if (!bar.snap.steps[inst.id][step] || bar.snap.mutes[inst.id] || !(vol > 0.001)) continue;
    out.push({ t, id: inst.id, v: inst.peak * vol });
  }
  return out;
}

const fmtLen = s => { const v = Math.max(0, Math.round(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

defineApp({
  id: 'beats',
  name: 'Static Beats',
  icon: 'grid',
  g1: '#ff9234', g2: '#d94407',
  category: 'Media',
  keywords: ['drum', 'machine', 'sequencer', 'beat', 'rhythm', '808', 'synth', 'loop', 'pattern', 'metronome', 'step', 'groove',
    'song', 'arrange', 'arrangement', 'wav'],
  desc: 'A step-sequencer drum machine — synthesised drums, no samples',
  singleton: true,
  win: { w: 780, h: 624, minW: 380, minH: 440 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space', 'Play or stop'],
    ['Up / Down', 'Tempo up / down (with Shift, by 5)'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, notify, confirm, menu, vfs } = api;

    /* ------------------------------ state ------------------------------ */
    const S = {
      bpm: 120,
      swing: 0,                       /* 0..0.5, fraction of a 16th */
      steps: {},                      /* id -> bool[16] */
      vols: {},                       /* id -> 0..1 */
      mutes: {},                      /* id -> bool */
      playing: false,
      view: 'pattern',                /* 'pattern' (the grid) | 'song' (the arrangement) */
      playMode: null,                 /* what is playing: 'pattern' | 'song' */
      sp: null,                       /* song playback: { plan, t0, bar, step, drawBar } */
      song: [],                       /* [{ id, pat, name, times }] */
      ac: null, master: null, comp: null, noiseBuf: null, rowGain: {}, songBus: null,
      currentStep: 0, nextNoteTime: 0, drawStep: -1,
      timer: 0, rafId: 0, queue: [],
      tap: [],                        /* tap-tempo timestamps */
      paint: null,                    /* drag-paint target state */
      dead: false, saveTimer: 0, unsub: [], noAudio: false,
    };
    for (const inst of INSTRUMENTS) { S.steps[inst.id] = emptyRow(); S.vols[inst.id] = 0.8; S.mutes[inst.id] = false; }

    /* cell + header refs, indexed [id][step] and [step] */
    const cellOf = {};                /* id -> [buttonEl x16] */
    const colHead = [];               /* [numEl x16] */

    /* ------------------------------ audio ------------------------------ */
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

    function ensureAudio() {
      if (S.ac || S.noAudio) return S.ac;
      if (!AC) { S.noAudio = true; return null; }
      try {
        const ac = new AC();
        const comp = ac.createDynamicsCompressor();  /* honest peak control, not fake loudness */
        comp.threshold.value = -6; comp.knee.value = 8; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.14;
        const master = ac.createGain();
        master.connect(comp).connect(ac.destination);
        S.ac = ac; S.comp = comp; S.master = master; S.noiseBuf = makeNoise(ac);
        for (const inst of INSTRUMENTS) {
          const g = ac.createGain();
          g.connect(master);
          S.rowGain[inst.id] = g;
        }
        /* a song's patterns bring their own levels: they arrive in each hit */
        S.songBus = ac.createGain();
        S.songBus.connect(master);
        applyMaster(); IDS.forEach(applyRowGain);
      } catch (err) { S.noAudio = true; S.ac = null; }
      return S.ac;
    }

    const sysVol = () => clamp((Number(store.get('prefs.volume', 62)) || 0) / 100, 0, 1);
    const sysMuted = () => store.get('prefs.muted', false) === true;

    function applyMaster() {
      if (!S.master || !S.ac) return;
      const target = sysMuted() ? 0.0001 : Math.max(0.0001, sysVol());
      try { S.master.gain.setTargetAtTime(target, S.ac.currentTime, 0.015); } catch (e) {}
    }
    function applyRowGain(id) {
      const g = S.rowGain[id];
      if (!g || !S.ac) return;
      const target = S.mutes[id] ? 0.0001 : Math.max(0.0001, S.vols[id]);
      try { g.gain.setTargetAtTime(target, S.ac.currentTime, 0.012); } catch (e) {}
    }

    function playHit(id, t) {
      const inst = INSTRUMENTS.find(i => i.id === id);
      VOICES[id](S.ac, t, S.rowGain[id], S.noiseBuf, inst.peak);
    }

    /* ---------------------------- scheduler ---------------------------- */
    const sec16 = () => 60 / S.bpm / 4;
    function scheduleStep(step, t) {
      for (const inst of INSTRUMENTS) if (S.steps[inst.id][step]) playHit(inst.id, t);
    }
    function scheduler() {
      const ac = S.ac;
      if (!ac) return;
      while (S.nextNoteTime < ac.currentTime + AHEAD_S) {
        const step = S.currentStep;
        let when = S.nextNoteTime;
        if (step % 2 === 1) when += sec16() * S.swing;   /* swing pushes the off-16ths late */
        scheduleStep(step, when);
        S.queue.push({ step, time: when });
        S.nextNoteTime += sec16();
        S.currentStep = (S.currentStep + 1) % STEPS;
      }
    }
    /* the song: step by step through its bars, each in its own pattern's
       tempo and swing; done once the last bar has rung out */
    function songScheduler() {
      const ac = S.ac, sp = S.sp;
      if (!ac || !sp) return;
      const bars = sp.plan.bars;
      while (sp.bar < bars.length) {
        const bar = bars[sp.bar];
        const base = sp.t0 + bar.start + sp.step * bar.sd;
        if (base >= ac.currentTime + AHEAD_S) break;
        for (const hit of stepHits(bar, sp.step)) VOICES[hit.id](ac, sp.t0 + hit.t, S.songBus, S.noiseBuf, hit.v);
        S.queue.push({ bar: sp.bar, step: sp.step, time: base });
        sp.step++;
        if (sp.step >= STEPS) { sp.step = 0; sp.bar++; }
      }
      if (sp.bar >= bars.length && ac.currentTime >= sp.t0 + sp.plan.total + 0.05) stop();
    }

    function draw() {
      if (!S.playing) { S.rafId = 0; return; }
      const ac = S.ac;
      if (S.playMode === 'song') {
        let at = null;
        while (S.queue.length && S.queue[0].time <= ac.currentTime) at = S.queue.shift();
        if (at) paintSongPos(at.bar, at.step);
        S.rafId = requestAnimationFrame(draw);
        return;
      }
      let step = S.drawStep;
      while (S.queue.length && S.queue[0].time <= ac.currentTime) step = S.queue.shift().step;
      if (step !== S.drawStep) {
        S.drawStep = step;
        paintPlayhead(step);
        if (step >= 0) posEl.textContent = `Step ${step + 1} / ${STEPS}`;
      }
      S.rafId = requestAnimationFrame(draw);
    }

    async function openAudio() {
      const ac = ensureAudio();
      if (!ac) { notify({ app: 'Static Beats', icon: 'alert', title: 'No audio here', message: 'This browser has no Web Audio, so Static Beats cannot make sound.' }); return null; }
      try { if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
      return S.dead ? null : ac;
    }

    async function start() {
      const ac = await openAudio();
      if (!ac || S.playing) return;
      S.playing = true;
      S.playMode = 'pattern';
      S.currentStep = 0; S.drawStep = -1; S.queue = [];
      S.nextNoteTime = ac.currentTime + 0.06;
      scheduler();
      S.timer = setInterval(scheduler, LOOKAHEAD_MS);
      S.rafId = requestAnimationFrame(draw);
      paintTransport();
    }

    async function startSong() {
      const plan = songPlan(S.song, savedPatterns());
      if (!plan.bars.length) {
        notify({ app: 'Static Beats', icon: 'list-music', title: 'The song is empty',
          message: S.song.length ? 'Its patterns were deleted from your library.' : 'Add a saved pattern to the song first.', timeout: 3200 });
        return;
      }
      const ac = await openAudio();
      if (!ac || S.playing) return;
      S.playing = true;
      S.playMode = 'song';
      S.queue = [];
      S.sp = { plan, t0: ac.currentTime + 0.08, bar: 0, step: 0, drawBar: -1 };
      songScheduler();
      S.timer = setInterval(songScheduler, LOOKAHEAD_MS);
      S.rafId = requestAnimationFrame(draw);
      paintTransport();
      paintSongPos(-1, 0);
    }

    function stop() {
      const wasSong = S.playMode === 'song';
      S.playing = false;
      S.playMode = null;
      if (S.timer) { clearInterval(S.timer); S.timer = 0; }
      if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
      S.queue = []; S.drawStep = -1;
      if (wasSong) { S.sp = null; paintSongPos(-1, 0); }
      clearPlayhead();
      paintTransport();
    }
    const togglePlay = () => (S.playing ? stop() : S.view === 'song' ? startSong() : start());

    /* ----------------------------- painting ---------------------------- */
    function paintPlayhead(step) {
      clearPlayhead();
      if (step < 0) return;
      colHead[step]?.classList.add('is-play');
      for (const id of IDS) cellOf[id][step]?.classList.add('is-play');
    }
    function clearPlayhead() {
      for (const el of colHead) el?.classList.remove('is-play');
      for (const id of IDS) for (const el of cellOf[id]) el?.classList.remove('is-play');
    }

    function setCell(id, step, on) {
      if (S.steps[id][step] === on) return;
      const row = S.steps[id].slice();
      row[step] = on;
      S.steps[id] = row;
      cellOf[id][step]?.classList.toggle('is-on', on);
      cellOf[id][step]?.setAttribute('aria-pressed', on ? 'true' : 'false');
      queueSave();
    }
    function repaintCells() {
      for (const id of IDS) for (let s = 0; s < STEPS; s++) {
        const on = S.steps[id][s];
        cellOf[id][s].classList.toggle('is-on', on);
        cellOf[id][s].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    /* --------------------------- persistence --------------------------- */
    function snapshot() {
      const steps = {};
      for (const id of IDS) steps[id] = S.steps[id].slice();
      return { bpm: S.bpm, swing: S.swing, steps, vols: { ...S.vols }, mutes: { ...S.mutes } };
    }
    function loadSnapshot(snap) {
      if (!snap) return;
      S.bpm = clamp(Number(snap.bpm) || 120, 40, 240);
      S.swing = clamp(Number(snap.swing) || 0, 0, 0.5);
      for (const id of IDS) {
        const src = Array.isArray(snap.steps?.[id]) ? snap.steps[id] : [];
        S.steps[id] = Array.from({ length: STEPS }, (_, i) => !!src[i]);
        if (typeof snap.vols?.[id] === 'number') S.vols[id] = clamp(snap.vols[id], 0, 1);
        if (typeof snap.mutes?.[id] === 'boolean') S.mutes[id] = snap.mutes[id];
      }
    }
    function loadPreset(preset) {
      S.bpm = clamp(preset.bpm || 120, 40, 240);
      S.swing = clamp(preset.swing || 0, 0, 0.5);
      for (const id of IDS) S.steps[id] = preset.rows[id] ? P(preset.rows[id].padEnd(STEPS, '.')) : emptyRow();
      afterLoad();
    }
    function afterLoad() {
      repaintCells();
      for (const id of IDS) { applyRowGain(id); syncRowUI(id); }
      paintTransport(); syncTempoUI(); syncSwingUI();
      queueSave();
    }

    const beatsData = () => {
      const d = store.get('portal.beats');
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    };
    /* every write keeps what it doesn't change (the song, the library) */
    const writeBeats = patch => store.set('portal.beats', { ...beatsData(), ...patch });
    function queueSave() {
      if (S.saveTimer) clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(() => {
        S.saveTimer = 0;
        const d = beatsData();
        writeBeats({ patterns: Array.isArray(d.patterns) ? d.patterns : [], last: snapshot() });
      }, 400);
    }
    function savedPatterns() { const d = beatsData(); return Array.isArray(d.patterns) ? d.patterns.filter(p => p && typeof p.id === 'string') : []; }
    function savePattern(name) {
      const list = savedPatterns();
      const entry = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, at: Date.now(), ...snapshot() };
      writeBeats({ patterns: [entry, ...list].slice(0, 40), last: snapshot() });
      notify({ app: 'Static Beats', icon: 'save', title: 'Pattern saved', message: `“${name}” is in your library.`, timeout: 2600 });
      return entry;
    }
    function deletePattern(id) {
      const d = beatsData();
      writeBeats({ patterns: savedPatterns().filter(p => p.id !== id), last: d.last || snapshot() });
      paintSong();
    }

    /* ---- the song ---- */
    function readSong() {
      const raw = beatsData().song;
      const list = raw && Array.isArray(raw.items) ? raw.items : [];
      const seen = new Set();
      return list.filter(it => it && typeof it.pat === 'string' && typeof it.id === 'string' && !seen.has(it.id) && seen.add(it.id))
        .slice(0, SONG_MAX)
        .map(it => ({ id: it.id, pat: it.pat, name: String(it.name || 'Pattern').slice(0, 40), times: clamp(Math.round(Number(it.times) || 1), 1, TIMES_MAX) }));
    }
    function setSong(items) {
      S.song = items.slice(0, SONG_MAX);
      writeBeats({ song: { v: 1, items: S.song.map(it => ({ ...it })) } });
      if (S.playMode === 'song') stop();            /* an edit mid-song: the marker would point at the wrong place */
      paintSong();
    }
    const songUid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    function songAdd(p) {
      if (S.song.length >= SONG_MAX) { notify({ app: 'Static Beats', icon: 'alert', title: 'That’s a long song', message: `A song holds up to ${SONG_MAX} parts.` }); return; }
      setSong([...S.song, { id: songUid(), pat: p.id, name: String(p.name || 'Pattern').slice(0, 40), times: 1 }]);
      focusSongRow(S.song.length - 1, 'more');
    }
    function songRemove(i) {
      const next = S.song.slice(); next.splice(i, 1);
      setSong(next);
      focusSongRow(Math.min(i, S.song.length - 1), 'remove');
    }
    function songMove(i, d) {
      const j = i + d;
      if (j < 0 || j >= S.song.length) return;
      const next = S.song.slice();
      [next[i], next[j]] = [next[j], next[i]];
      setSong(next);
      focusSongRow(j, d < 0 ? 'up' : 'down');
    }
    function songDup(i) {
      if (S.song.length >= SONG_MAX) return;
      const next = S.song.slice();
      next.splice(i + 1, 0, { ...S.song[i], id: songUid() });
      setSong(next);
      focusSongRow(i + 1, 'dup');
    }
    function songTimes(i, d) {
      const it = S.song[i];
      const n = clamp(it.times + d, 1, TIMES_MAX);
      if (n === it.times) return;
      const next = S.song.slice();
      next[i] = { ...it, times: n };
      setSong(next);
      focusSongRow(i, d < 0 ? 'fewer' : 'more');
    }

    /* ------------------------------ tempo ------------------------------ */
    function setBpm(v) { S.bpm = clamp(Math.round(v), 40, 240); syncTempoUI(); queueSave(); }
    function setSwing(v) { S.swing = clamp(v, 0, 0.5); syncSwingUI(); queueSave(); }
    function tapTempo() {
      const now = performance.now();
      S.tap = S.tap.filter(t => now - t < 2200);
      S.tap.push(now);
      if (S.tap.length >= 2) {
        const gaps = [];
        for (let i = 1; i < S.tap.length; i++) gaps.push(S.tap[i] - S.tap[i - 1]);
        const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (avg > 0) setBpm(60000 / avg);
      }
    }

    /* ------------------------------ export ----------------------------- */
    /* One path for both exports: an OfflineAudioContext `seconds` long
       (to the sample), the same compressor as the live bus, `schedule`
       puts the hits in, and the result is a 16-bit WAV in ~/Music. */
    let exporting = false;
    async function bounce({ seconds, name, title, schedule, tailFadeMs = 0 }) {
      if (exporting) return null;
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) { notify({ app: 'Static Beats', icon: 'alert', title: 'Export unavailable', message: 'This browser has no OfflineAudioContext to render a file.' }); return null; }
      exporting = true; syncTools(); paintSong();
      try {
        const rate = 44100;
        const oac = new Offline(2, Math.max(1, Math.round(seconds * rate)), rate);
        const comp = oac.createDynamicsCompressor();
        comp.threshold.value = -6; comp.knee.value = 8; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.14;
        const master = oac.createGain();
        master.gain.value = Math.max(0.15, sysMuted() ? 0.7 : sysVol());  /* export at an audible level */
        master.connect(comp).connect(oac.destination);
        const nb = makeNoise(oac);
        schedule(oac, master, nb);
        const rendered = await oac.startRendering();
        if (tailFadeMs > 0) {                       /* a song stops on its last sample: no click there */
          const n = Math.min(rendered.length, Math.round(rate * tailFadeMs / 1000));
          for (let c = 0; c < rendered.numberOfChannels; c++) {
            const d = rendered.getChannelData(c);
            for (let i = 0; i < n; i++) d[rendered.length - 1 - i] *= i / n;
          }
        }
        const wav = encodeWav(rendered);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const { path } = await media.save(`${vfs.HOME}/Music`, name, blob);
        if (S.dead) return { path, samples: rendered.length };
        notify({
          app: 'Static Beats', icon: 'music', title,
          message: `${name} (${(blob.size / 1024).toFixed(0)} KB, ${fmtLen(rendered.length / rate)}) in ~/Music.`,
          actions: [{ label: 'Open in Music', onClick: () => api.openFile(path) }], timeout: 7000,
        });
        return { path, samples: rendered.length };
      } catch (err) {
        notify({ app: 'Static Beats', icon: 'alert', title: 'Export failed', message: String(err && err.message || err) });
        return null;
      } finally {
        exporting = false; if (!S.dead) { syncTools(); paintSong(); }
      }
    }
    const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');

    /* the loop: twice round the grid, and a little tail for the last hit */
    function exportWav() {
      const loops = 2;
      const stepDur = stepDurOf(S.bpm);
      const barDur = stepDur * STEPS;
      return bounce({
        seconds: barDur * loops + 0.6,
        name: `Beat ${S.bpm}bpm ${stamp()}.wav`,
        title: 'Loop saved to Music',
        schedule(oac, master, nb) {
          const rowG = {};
          for (const inst of INSTRUMENTS) {
            const g = oac.createGain();
            g.gain.value = S.mutes[inst.id] ? 0.0001 : Math.max(0.0001, S.vols[inst.id]);
            g.connect(master); rowG[inst.id] = g;
          }
          for (let loop = 0; loop < loops; loop++) {
            for (let step = 0; step < STEPS; step++) {
              let t = loop * barDur + step * stepDur;
              if (step % 2 === 1) t += stepDur * S.swing;
              for (const inst of INSTRUMENTS) {
                if (S.steps[inst.id][step]) VOICES[inst.id](oac, t + 0.02, rowG[inst.id], nb, inst.peak);
              }
            }
          }
        },
      });
    }

    /* the song: exactly as long as its bars, each pattern at its own tempo */
    function exportSong() {
      const plan = songPlan(S.song, savedPatterns());
      if (!plan.bars.length) {
        notify({ app: 'Static Beats', icon: 'list-music', title: 'Nothing to export', message: 'Add a saved pattern to the song first.', timeout: 3200 });
        return null;
      }
      return bounce({
        seconds: plan.total,
        name: `Song ${plan.bars.length} bars ${stamp()}.wav`,
        title: 'Song saved to Music',
        tailFadeMs: 6,
        schedule(oac, master, nb) {
          for (const bar of plan.bars) {
            for (let step = 0; step < STEPS; step++) {
              for (const hit of stepHits(bar, step)) VOICES[hit.id](oac, hit.t, master, nb, hit.v);
            }
          }
        },
      });
    }

    /* 16-bit PCM stereo WAV from an AudioBuffer, little-endian. */
    function encodeWav(buf) {
      const chs = Math.min(2, buf.numberOfChannels);
      const n = buf.length, rate = buf.sampleRate;
      const data = new ArrayBuffer(44 + n * chs * 2);
      const v = new DataView(data);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * chs * 2, true); str(8, 'WAVE');
      str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * chs * 2, true); v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, n * chs * 2, true);
      const ch = [];
      for (let c = 0; c < chs; c++) ch.push(buf.getChannelData(c));
      let off = 44;
      for (let i = 0; i < n; i++) for (let c = 0; c < chs; c++) {
        const s = clamp(ch[c][i] || 0, -1, 1);
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
      }
      return data;
    }

    /* ============================= UI ============================= */

    /* --- transport --- */
    const playBtn = h('button.btn.btn--primary.beats__play', { type: 'button', 'aria-label': 'Play', onclick: togglePlay });
    const bpmVal = h('span.beats__bpmnum', { 'aria-hidden': 'true' });
    const bpmRange = h('input.slider.beats__bpmrange', {
      type: 'range', min: '40', max: '240', step: '1', 'aria-label': 'Tempo in beats per minute',
      oninput: e => setBpm(+e.target.value),
    });
    const swVal = h('span.beats__swnum', { 'aria-hidden': 'true' });
    const swRange = h('input.slider.beats__swrange', {
      type: 'range', min: '0', max: '50', step: '1', 'aria-label': 'Swing amount, percent',
      oninput: e => setSwing((+e.target.value) / 100),
    });

    const tempoCtl = h('div.beats__ctl',
      h('div.beats__ctlhead',
        h('span.beats__ctllabel', icon('gauge'), h('span', { text: 'Tempo' })),
        h('div.beats__stepper',
          h('button.ibtn', { type: 'button', 'aria-label': 'Slower', onclick: () => setBpm(S.bpm - 1) }, icon('minus')),
          bpmVal,
          h('button.ibtn', { type: 'button', 'aria-label': 'Faster', onclick: () => setBpm(S.bpm + 1) }, icon('plus')),
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Tap tempo', 'aria-label': 'Tap tempo', onclick: tapTempo }, icon('clock')))),
      bpmRange);

    const swingCtl = h('div.beats__ctl',
      h('div.beats__ctlhead',
        h('span.beats__ctllabel', icon('zap'), h('span', { text: 'Swing' })),
        swVal),
      swRange);

    const posEl = h('span.beats__posnum', { 'aria-live': 'off' });
    const bar = h('div.beats__bar',
      h('div.beats__transport', playBtn, h('div.beats__pos', posEl)),
      tempoCtl, swingCtl);

    /* --- tools bar --- */
    const presetBtn = h('button.btn.btn--sm', { type: 'button', onclick: e => openPresetMenu(e) }, icon('layers'), h('span', { text: 'Presets' }), icon('chevron-down'));
    const loadBtn = h('button.btn.btn--sm', { type: 'button', onclick: e => openLibraryMenu(e) }, icon('folder-open'), h('span', { text: 'Load' }), icon('chevron-down'));
    const saveBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => openSaveSheet() }, icon('save'), h('span', { text: 'Save' }));
    const randBtn = h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': 'Randomise pattern', 'aria-label': 'Randomise', onclick: () => randomise() }, icon('shuffle'), h('span', { text: 'Random' }));
    const clearBtn = h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': 'Clear all steps', 'aria-label': 'Clear', onclick: () => clearAll() }, icon('rotate-ccw'), h('span', { text: 'Clear' }));
    /* Pattern | Song: what the window shows, and what Play plays */
    const segBtn = (v, ic, label) => h('button.beats__segbtn', { type: 'button', dataset: { view: v }, 'aria-pressed': 'false', onclick: () => setView(v) },
      icon(ic), h('span', { text: label }));
    const segs = [segBtn('pattern', 'grid', 'Pattern'), segBtn('song', 'list-music', 'Song')];
    const patTools = h('div.beats__ptools', presetBtn, loadBtn, saveBtn, randBtn, clearBtn);
    const toolbar = h('div.beats__tools', h('div.beats__seg', { role: 'group', 'aria-label': 'Show' }, segs), patTools);

    /* --- sequencer grid --- */
    const headSteps = h('div.beats__headsteps');
    for (let s = 0; s < STEPS; s++) {
      const num = h('div.beats__num' + (s % 4 === 0 ? '.is-down' : ''), { text: String(s + 1) });
      if (s % 4 === 0 && s > 0) num.classList.add('is-group');
      colHead[s] = num;
      headSteps.appendChild(num);
    }
    const seqHead = h('div.beats__seqhead', h('div.beats__headspace', h('span', { text: 'Track' })), headSteps);

    const rowsWrap = h('div.beats__rows');
    for (const inst of INSTRUMENTS) {
      cellOf[inst.id] = [];
      const muteBtn = h('button.beats__mute', {
        type: 'button', 'aria-label': `Mute ${inst.name}`, 'aria-pressed': 'false',
        onclick: () => { S.mutes[inst.id] = !S.mutes[inst.id]; applyRowGain(inst.id); syncRowUI(inst.id); queueSave(); },
      }, icon('volume'), h('span.beats__mutename', { text: inst.name }));
      const volRange = h('input.slider.beats__vol', {
        type: 'range', min: '0', max: '100', step: '1', 'aria-label': `${inst.name} volume`,
        oninput: e => { S.vols[inst.id] = clamp((+e.target.value) / 100, 0, 1); if (S.mutes[inst.id]) { S.mutes[inst.id] = false; syncRowUI(inst.id); } applyRowGain(inst.id); queueSave(); },
      });
      const rowHead = h('div.beats__rowhead', muteBtn, volRange);
      rowHead._mute = muteBtn; rowHead._vol = volRange;

      const cells = h('div.beats__cells', { dataset: { inst: inst.id } });
      for (let s = 0; s < STEPS; s++) {
        const cell = h('button.beats__cell' + (s % 4 === 0 && s > 0 ? '.is-group' : ''), {
          type: 'button', 'aria-pressed': 'false',
          'aria-label': `${inst.name} step ${s + 1}`,
          dataset: { step: String(s), inst: inst.id },
        });
        cellOf[inst.id][s] = cell;
        cells.appendChild(cell);
      }
      const row = h('div.beats__row', rowHead, cells);
      row._head = rowHead;
      rowsWrap.appendChild(row);
    }

    /* drag-to-paint across a row: pointerdown sets the target state,
       pointer moving over more cells applies it. Works for touch + mouse. */
    function cellFromPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      const cell = el && el.closest && el.closest('.beats__cell');
      if (!cell || !rowsWrap.contains(cell)) return null;
      return cell;
    }
    const onCellDown = e => {
      const cell = e.target.closest && e.target.closest('.beats__cell');
      if (!cell) return;
      e.preventDefault();
      const id = cell.dataset.inst, step = +cell.dataset.step;
      S.paint = !S.steps[id][step];
      setCell(id, step, S.paint);
      try { rowsWrap.setPointerCapture(e.pointerId); } catch (err) {}
    };
    const onCellMove = e => {
      if (S.paint === null) return;
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (!cell) return;
      setCell(cell.dataset.inst, +cell.dataset.step, S.paint);
    };
    const onCellUp = () => { S.paint = null; };
    rowsWrap.addEventListener('pointerdown', onCellDown);
    rowsWrap.addEventListener('pointermove', onCellMove);
    window.addEventListener('pointerup', onCellUp);
    /* keyboard: a cell is a real button, so Enter/Space toggles it */
    rowsWrap.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const cell = e.target.closest && e.target.closest('.beats__cell');
      if (!cell) return;
      e.preventDefault();
      const id = cell.dataset.inst, step = +cell.dataset.step;
      setCell(id, step, !S.steps[id][step]);
    });

    const seq = h('div.beats__seq', seqHead, rowsWrap);

    /* --- song mode: the arrangement --- */
    const songSum = h('div.beats__songsum');
    const addBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-haspopup': 'menu', onclick: e => openAddMenu(e) },
      icon('plus'), h('span', { text: 'Add pattern' }), icon('chevron-down'));
    const songExportBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => exportSong() });
    const songClearBtn = h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => clearSong() }, icon('trash'), h('span', { text: 'Clear song' }));
    const songProgFill = h('i');
    const songProg = h('div.beats__songprog', { role: 'progressbar', 'aria-label': 'Position in the song', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, songProgFill);
    const songList = h('ol.beats__songlist', { 'aria-label': 'Song, in playing order' });
    const songEmpty = h('div.beats__songempty',
      icon('list-music'),
      h('b', { text: 'Chain your patterns into a song' }),
      h('small', { text: 'A song plays saved patterns in order, each as many times as you like, at its own tempo. Save a pattern from the grid, then add it here.' }));
    const songPanel = h('div.beats__song.hidden',
      h('div.beats__songhead', songSum, h('div.grow'), addBtn, songExportBtn, songClearBtn),
      songProg, songList, songEmpty);
    /* Alt+↑ / Alt+↓ on a part moves it */
    songList.addEventListener('keydown', e => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const row = e.target.closest && e.target.closest('.beats__songrow');
      if (!row) return;
      e.preventDefault();
      songMove(Number(row.dataset.i), e.key === 'ArrowUp' ? -1 : 1);
    });

    /* an instrument: Settings › Sound's click sounds stay out of it */
    root.appendChild(h('div.app.app--col', { 'data-sfx': 'off' }, h('div.beats', bar, toolbar, seq, songPanel)));

    function setView(v) {
      if (v !== 'pattern' && v !== 'song') return;
      S.view = v;
      const song = v === 'song';
      seq.classList.toggle('hidden', song);
      songPanel.classList.toggle('hidden', !song);
      patTools.classList.toggle('hidden', song);
      tempoCtl.classList.toggle('hidden', song);
      swingCtl.classList.toggle('hidden', song);
      for (const b of segs) {
        const on = b.dataset.view === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      if (beatsData().view !== v) writeBeats({ view: v });
      paintTransport();
      paintSong();
    }

    const sib = (ic, label, fn, disabled, role) => h('button.ibtn.beats__sib', {
      type: 'button', 'aria-label': label, title: label, disabled: !!disabled, dataset: { role }, onclick: fn,
    }, icon(ic));

    function paintSong() {
      const lib = savedPatterns();
      const pats = new Map(lib.map(p => [p.id, p]));
      const plan = songPlan(S.song, lib);
      const nb = plan.bars.length;
      songSum.textContent = nb ? `${S.song.length} part${S.song.length === 1 ? '' : 's'} · ${nb} bar${nb === 1 ? '' : 's'} · ${fmtLen(plan.total)}` : 'No bars yet';
      clear(songList);
      S.song.forEach((it, i) => {
        const p = pats.get(it.pat);
        const snap = p ? normPattern(p) : null;
        const barLen = snap ? stepDurOf(snap.bpm) * STEPS : 0;
        songList.appendChild(h('li.beats__songrow', { class: p ? null : 'is-missing', dataset: { i: String(i), id: it.id } },
          h('span.beats__songnum', { text: String(i + 1), 'aria-hidden': 'true' }),
          h('span.beats__songname',
            h('b', { text: it.name }),
            h('small', { text: p ? `${snap.bpm} BPM · ${barLen.toFixed(2)} s a bar` : 'Deleted from your library — skipped' })),
          h('span.beats__songtimes',
            sib('minus', `Fewer repeats of ${it.name}`, () => songTimes(i, -1), it.times <= 1, 'fewer'),
            h('span.beats__songx', { text: `×${it.times}`, title: `Plays ${it.times} time${it.times === 1 ? '' : 's'}` }),
            sib('plus', `More repeats of ${it.name}`, () => songTimes(i, 1), it.times >= TIMES_MAX, 'more')),
          h('span.beats__songnow'),
          h('span.beats__songacts',
            sib('arrow-up', `Move ${it.name} earlier`, () => songMove(i, -1), i === 0, 'up'),
            sib('arrow-down', `Move ${it.name} later`, () => songMove(i, 1), i === S.song.length - 1, 'down'),
            sib('copy', `Duplicate ${it.name}`, () => songDup(i), S.song.length >= SONG_MAX, 'dup'),
            sib('trash', `Remove ${it.name} from the song`, () => songRemove(i), false, 'remove'))));
      });
      songEmpty.classList.toggle('hidden', S.song.length > 0);
      songList.classList.toggle('hidden', !S.song.length);
      clear(songExportBtn);
      songExportBtn.append(exporting ? h('span.spinner') : icon('download'), h('span', { text: 'Export song' }));
      songExportBtn.disabled = exporting || !nb;
      songExportBtn.setAttribute('aria-busy', exporting ? 'true' : 'false');
      songExportBtn.title = nb ? `Save the whole song (${fmtLen(plan.total)}) to Music as a WAV file` : 'Add a pattern first';
      songClearBtn.disabled = !S.song.length;
      if (S.playMode === 'song' && S.sp) { S.sp.drawBar = -1; } else paintSongPos(-1, 0);
    }

    /* the marker: which part is sounding (and which repeat), and how far into the song */
    function paintSongPos(barIx, step) {
      const sp = S.sp;
      const bar = sp && barIx >= 0 ? sp.plan.bars[barIx] : null;
      for (const row of songList.children) {
        const on = !!bar && Number(row.dataset.i) === bar.idx;
        row.classList.toggle('is-now', on);
        if (on) row.setAttribute('aria-current', 'step'); else row.removeAttribute('aria-current');
        const now = row.querySelector('.beats__songnow');
        if (now) now.textContent = on ? `${bar.rep + 1} of ${bar.of}` : '';
      }
      const pct = bar ? Math.min(100, ((bar.start + (step + 1) * bar.sd) / sp.plan.total) * 100) : 0;
      songProgFill.style.width = `${pct}%`;
      songProg.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (bar) {
        posEl.textContent = `Bar ${barIx + 1} / ${sp.plan.bars.length}`;
        if (sp.drawBar !== barIx) {
          sp.drawBar = barIx;
          songList.querySelector(`.beats__songrow[data-i="${bar.idx}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    /* after an edit the list is rebuilt: keep the keyboard on the same control */
    function focusSongRow(i, role) {
      if (i < 0) { addBtn.focus(); return; }
      const row = songList.querySelector(`.beats__songrow[data-i="${i}"]`);
      const b = row && (row.querySelector(`[data-role="${role}"]:not(:disabled)`) || row.querySelector('button:not(:disabled)'));
      (b || addBtn).focus();
    }

    function openAddMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const items = savedPatterns().map(p => ({ label: p.name, icon: 'list-music', hint: `${normPattern(p).bpm} BPM`, onClick: () => songAdd(p) }));
      if (items.length) items.push('-');
      items.push({ label: 'The grid as it is now…', icon: 'save', onClick: () => openSaveSheet({ add: true }) });
      menu(items, r.left, r.bottom + 4, { label: 'Add to the song' });
    }

    async function clearSong() {
      if (!S.song.length) return;
      const ok = await confirm({ title: 'Clear the song?', message: 'Every part comes off the song. Your saved patterns stay in the library.', ok: 'Clear song', danger: true });
      if (ok) setSong([]);
    }

    /* --- window tools: output state + export --- */
    const exportBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Export loop to Music (WAV)', 'aria-label': 'Export loop as WAV', onclick: () => exportWav() }, icon('download'));
    const volTool = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Output', 'aria-label': 'Open sound settings', onclick: () => api.openApp('settings', { section: 'sound' }) });
    function syncTools() {
      clear(exportBtn);
      exportBtn.appendChild(exporting ? h('span.spinner') : icon('download'));
      exportBtn.setAttribute('aria-busy', exporting ? 'true' : 'false');
      clear(volTool);
      const muted = sysMuted();
      volTool.appendChild(icon(muted ? 'volume-x' : 'volume'));
      volTool.setAttribute('data-tip', muted ? 'System muted' : `Output ${Math.round(sysVol() * 100)}%`);
      volTool.classList.toggle('is-warn', muted);
    }
    win.setTools(volTool, exportBtn);

    /* ----------------------------- menus ------------------------------- */
    function openPresetMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      menu(PRESETS.map(p => ({
        label: p.name, icon: 'music', hint: `${p.bpm} BPM`,
        onClick: () => loadPreset(p),
      })), r.left, r.bottom + 4);
    }
    function openLibraryMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const list = savedPatterns();
      if (!list.length) { menu([{ label: 'No saved patterns yet', disabled: true }], r.left, r.bottom + 4); return; }
      const items = [];
      for (const p of list) {
        items.push({ label: p.name, icon: 'list-music', hint: `${p.bpm} BPM`, onClick: () => { loadSnapshot(p); afterLoad(); } });
      }
      items.push('-');
      /* the click is long over when this row is chosen: hand on where the button was */
      items.push({ label: 'Delete a pattern…', icon: 'trash', danger: true, onClick: () => openDeleteMenu(r) });
      menu(items, r.left, r.bottom + 4);
    }
    function openDeleteMenu(r) {
      const items = savedPatterns().map(p => ({
        label: p.name, icon: 'trash', danger: true,
        onClick: async () => {
          const uses = S.song.filter(it => it.pat === p.id).length;
          const ok = await confirm({ title: 'Delete pattern?', ok: 'Delete', danger: true,
            message: `“${p.name}” will be removed from your library.${uses ? ` It is in your song ${uses === 1 ? 'once' : `${uses} times`}; those parts will be skipped.` : ''}` });
          if (ok) deletePattern(p.id);
        },
      }));
      menu(items.length ? items : [{ label: 'Nothing saved', disabled: true }], r.left, r.bottom + 4);
    }

    /* --- save sheet: a small inline name prompt (confirm() is yes/no) --- */
    let sheet = null;
    function openSaveSheet(opts = {}) {
      if (sheet) return;
      const input = h('input.beats__sheetin', { type: 'text', placeholder: 'Pattern name', 'aria-label': 'Pattern name', maxlength: '40', value: suggestName() });
      /* from the song's Add menu: saved, then added to the end of the song */
      const doSave = () => { const name = input.value.trim() || suggestName(); const entry = savePattern(name); closeSheet(); if (opts.add && entry) songAdd(entry); };
      const card = h('div.beats__sheet', { role: 'dialog', 'aria-label': opts.add ? 'Save the grid and add it to the song' : 'Save pattern' },
        h('div.beats__sheettitle', { text: opts.add ? 'Save the grid, then add it to the song' : 'Save pattern' }),
        input,
        h('div.beats__sheetrow',
          h('button.btn.btn--sm', { type: 'button', onclick: closeSheet }, h('span', { text: 'Cancel' })),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: doSave }, h('span', { text: 'Save' }))));
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); doSave(); } else if (ev.key === 'Escape') { ev.preventDefault(); closeSheet(); } });
      sheet = h('div.beats__scrim', { onpointerdown: ev => { if (ev.target === sheet) closeSheet(); } }, card);
      root.querySelector('.beats').appendChild(sheet);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    }
    function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
    function suggestName() {
      const active = INSTRUMENTS.filter(i => S.steps[i.id].some(Boolean)).map(i => i.name);
      return `${active[0] || 'Empty'} ${S.bpm}bpm`;
    }

    /* --------------------------- destructive --------------------------- */
    function clearAll() {
      for (const id of IDS) S.steps[id] = emptyRow();
      repaintCells(); queueSave();
    }
    function randomise() {
      /* musically-weighted random: kick on strong beats, hats busy, etc. */
      const density = { kick: 0.28, snare: 0.14, clap: 0.1, hat: 0.55, ohat: 0.12, tom: 0.08, rim: 0.14, cowbell: 0.06 };
      for (const inst of INSTRUMENTS) {
        const row = emptyRow();
        for (let s = 0; s < STEPS; s++) {
          let p = density[inst.id];
          if (inst.id === 'kick' && s % 4 === 0) p = 0.85;
          if (inst.id === 'snare' && s % 8 === 4) p = 0.9;
          row[s] = Math.random() < p;
        }
        S.steps[inst.id] = row;
      }
      repaintCells(); queueSave();
    }

    /* ------------------------------ sync UI ---------------------------- */
    function paintTransport() {
      clear(playBtn);
      playBtn.appendChild(icon(S.playing ? 'square' : 'play', { fill: !S.playing }));
      const what = S.playing ? 'Stop' : S.view === 'song' ? 'Play song' : 'Play';
      playBtn.appendChild(h('span', { text: what }));
      playBtn.setAttribute('aria-label', S.playing && S.playMode === 'song' ? 'Stop the song' : what);
      playBtn.classList.toggle('is-playing', S.playing);
      posEl.textContent = !S.playing ? 'Stopped'
        : S.playMode === 'song' ? (S.sp && S.sp.drawBar >= 0 ? `Bar ${S.sp.drawBar + 1} / ${S.sp.plan.bars.length}` : 'Starting…')
        : `Step ${Math.max(1, S.drawStep + 1)} / ${STEPS}`;
    }
    function syncTempoUI() { bpmVal.textContent = `${S.bpm}`; bpmRange.value = String(S.bpm); }
    function syncSwingUI() { swVal.textContent = `${Math.round(S.swing * 100)}%`; swRange.value = String(Math.round(S.swing * 100)); }
    function syncRowUI(id) {
      const row = [...rowsWrap.children].find(r => r._head?._mute && r.querySelector(`.beats__cells[data-inst="${id}"]`));
      if (!row) return;
      const head = row._head;
      head.classList.toggle('is-muted', S.mutes[id]);
      head._mute.setAttribute('aria-pressed', S.mutes[id] ? 'true' : 'false');
      clear(head._mute);
      head._mute.appendChild(icon(S.mutes[id] ? 'volume-x' : 'volume'));
      head._mute.appendChild(h('span.beats__mutename', { text: INSTRUMENTS.find(i => i.id === id).name }));
      head._vol.value = String(Math.round(S.vols[id] * 100));
    }

    /* ----------------------------- keyboard ---------------------------- */
    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (S.view !== 'pattern') return;           /* the arrows are the grid's tempo */
      else if (e.key === 'ArrowUp') { e.preventDefault(); setBpm(S.bpm + (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setBpm(S.bpm - (e.shiftKey ? 5 : 1)); }
    };
    window.addEventListener('keydown', onKey);

    /* prefs → output */
    S.unsub.push(store.sub('prefs.volume', applyMaster));
    S.unsub.push(store.sub('prefs.muted', () => { applyMaster(); syncTools(); }));

    /* ------------------------------ boot ------------------------------- */
    const saved = beatsData();
    if (saved.last) loadSnapshot(saved.last); else loadPreset(PRESETS[0]);
    S.song = readSong();
    repaintCells();
    for (const id of IDS) syncRowUI(id);
    syncTempoUI(); syncSwingUI(); syncTools();
    setView(saved.view === 'song' ? 'song' : 'pattern');
    /* the library changed in another Beats window or by a backup restore */
    S.unsub.push(store.sub('portal.beats', () => {
      if (S.dead) return;
      const now = readSong();
      if (JSON.stringify(now) !== JSON.stringify(S.song)) { if (S.playMode === 'song') stop(); S.song = now; }
      if (S.view === 'song' && !sheet) paintSong();
    }));

    /* ----------------------------- teardown ---------------------------- */
    return () => {
      S.dead = true;
      stop();
      if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = 0; /* flush the last edit */
        const d = beatsData();
        writeBeats({ patterns: Array.isArray(d.patterns) ? d.patterns : [], last: snapshot() });
      }
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onCellUp);
      S.unsub.forEach(fn => { try { fn(); } catch (e) {} });
      S.unsub = [];
      closeSheet();
      if (S.ac) { try { S.ac.close(); } catch (e) {} S.ac = null; }
    };
  },
});
