/* ============================================================
   arcade/pulserun-music.js — the music of Pulse Run, original, made
   with Web Audio. Nothing here is a sample or anyone's tune.

   songStep(song, i) is plain data: what sounds on sixteenth note i
   (kick, snare, hat, a bass note, a lead note). A song is a root note,
   a mode, one scale degree per bar, a "lead" busyness and a bass
   pattern; the level's speed fixes the tempo so that a sixteenth note
   is exactly one tile of the level.

   createMusic(ctx, song, speed) plays it. Every note is scheduled a
   little ahead on the AUDIO clock (never setTimeout time), and the game
   reads that same clock to run the level, so the music and the level
   cannot drift apart. start(simT) begins the music at level time
   simT, so a restart from a checkpoint is in the right bar. When the
   browser gives no running audio clock (sound off, or blocked) start()
   says so and the game keeps time with performance.now() in silence.
   ============================================================ */

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10],
};
export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

/** the midi note of scale degree d (0 is the root; 7 is an octave up; negatives go below) */
export function degreeNote(song, d) {
  const sc = SCALES[song.mode] || SCALES.minor;
  const oct = Math.floor(d / 7), k = ((d % 7) + 7) % 7;
  return song.root + sc[k] + 12 * oct;
}
const mix = (a, b) => { let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; return (h ^ (h >>> 12)) >>> 0; };
const BASS = [[0, 8], [0, 3, 6, 10], [0, 2, 4, 6, 8, 10, 12, 14], [0, 6, 8, 14]];

/** what sounds on sixteenth note i (a bar is 16 of them) */
export function songStep(song, i) {
  const bar = Math.floor(i / 16), pos = i % 16;
  const chord = song.prog[bar % song.prog.length];
  const kick = pos % 4 === 0, snare = pos === 4 || pos === 12, hat = pos % 2 === 1;
  const bp = BASS[song.arp % BASS.length];
  const bass = bp.includes(pos) ? degreeNote(song, chord) - 12 : null;
  let lead = null;
  if (song.lead > 0) {
    const h = mix(song.root * 31 + song.prog[0], i);
    const on = song.lead === 1 ? pos % 4 === 2 && h % 4 !== 0 : pos % 2 === 0 && h % 4 !== 0;
    if (on) lead = degreeNote(song, chord + [0, 2, 4, 7, 4, 2][(h >>> 8) % 6]) + 12;
  }
  return { kick, snare, hat, bass, lead };
}

export function createMusic(ctx, song, speed) {
  const stepS = 1 / speed;                         /* one tile, one sixteenth */
  let ac = null, bus = null, noise = null, timer = 0, next = 0, t0 = 0, running = false, dead = false;
  const vol = () => 0.5 * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
  function ensure() {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = buf.getChannelData(0);
      let s = 1;
      for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
      noise = buf;
    }
    return ac;
  }
  function newBus() {
    if (bus) { try { bus.gain.setTargetAtTime(0, ac.currentTime, 0.015); const old = bus; setTimeout(() => { try { old.disconnect(); } catch (err) { /* gone */ } }, 200); } catch (err) { /* gone */ } }
    bus = ac.createGain();
    bus.gain.value = vol();
    bus.connect(ac.destination);
  }
  const tone = (type, hz, at, dur, peak, to = 0, out = bus) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, at);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at); o.stop(at + dur + 0.03);
  };
  const hit = (at, dur, peak, hp) => {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(at); src.stop(at + dur + 0.02);
  };
  function playStep(i, at) {
    const s = songStep(song, i);
    if (s.kick) tone('sine', 150, at, 0.15, 0.85, 45);
    if (s.snare) hit(at, 0.11, 0.3, 1600);
    if (s.hat) hit(at, 0.03, 0.1, 7500);
    if (s.bass !== null) tone('triangle', midiHz(s.bass), at, stepS * 1.8, 0.42);
    if (s.lead !== null) tone('square', midiHz(s.lead), at, stepS * 1.5, 0.06);
  }
  function pump() {
    if (!running || !ac) return;
    while (t0 + next * stepS < ac.currentTime + 0.2) { playStep(next, t0 + next * stepS); next++; }
  }
  const outLatency = () => { const l = ac && (ac.outputLatency || ac.baseLatency || 0); return Math.max(0, Math.min(0.15, Number.isFinite(l) ? l : 0)); };
  return {
    /** begin the music so level time simT is `lead` seconds from now; resolves to { t0 } on the audio clock (level time 0), or null when there is no running audio clock */
    async start(simT = 0, lead = 0.3) {
      const c = ensure();
      if (!c) return null;
      try { await c.resume(); } catch (err) { /* checked below */ }
      if (c.state !== 'running') return null;
      const a = c.currentTime;
      await new Promise(r => setTimeout(r, 70));
      if (dead || c.currentTime <= a) return null;           /* a clock that does not move is no clock */
      newBus();
      t0 = c.currentTime + lead - simT;
      next = Math.max(0, Math.ceil(simT / stepS - 1e-9));
      running = true;
      clearInterval(timer); timer = setInterval(pump, 25);
      pump();
      return { t0 };
    },
    /** the audio clock, in seconds (0 before there is one) */
    now: () => (ac ? ac.currentTime : 0),
    latency: outLatency,
    /** how far past the audio clock the music is scheduled, in seconds (a few tenths while it plays) */
    ahead: () => (running && ac ? t0 + next * stepS - ac.currentTime : 0),
    get stepS() { return stepS; },
    get t0() { return t0; },
    get running() { return running; },
    /** silence now (the notes already scheduled are faded out) */
    stop() { running = false; clearInterval(timer); if (ac && bus) { try { bus.gain.setTargetAtTime(0, ac.currentTime, 0.015); } catch (err) { /* gone */ } } },
    suspend() { running = false; clearInterval(timer); try { ac?.suspend(); } catch (err) { /* nothing */ } },
    async resume() { if (!ac) return false; try { await ac.resume(); } catch (err) { return false; } if (ac.state !== 'running') return false; running = true; clearInterval(timer); timer = setInterval(pump, 25); pump(); return true; },
    blip(hz, dur = 0.08, type = 'triangle', peak = 0.5, to = 0) { if (ac && ac.state === 'running' && bus) { try { tone(type, hz, ac.currentTime, dur, peak * 0.4, to); } catch (err) { /* sound is a bonus */ } } },
    noise(dur = 0.25, peak = 0.5, hp = 400) { if (ac && ac.state === 'running' && bus) { try { hit(ac.currentTime, dur, peak * 0.4, hp); } catch (err) { /* sound is a bonus */ } } },
    close() { dead = true; running = false; clearInterval(timer); try { ac?.close()?.catch?.(() => {}); } catch (err) { /* closed */ } ac = null; bus = null; },
  };
}
