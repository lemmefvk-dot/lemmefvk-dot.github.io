/* ============================================================
   music-tuner.js — the Tuner page in Music: a guitar, ukulele and
   chromatic tuner that listens through the microphone.

   The page explains why it needs the microphone BEFORE asking —
   nothing is asked on opening the page; "Turn on microphone" is
   the only thing that calls getUserMedia, and then the browser
   shows its own permission prompt. Echo cancellation, noise
   suppression and auto-gain are switched off (they are made for
   speech and would fight a sustained note).

   Pitch is found by YIN (core/pitch.js) on the latest 4096
   samples, 25 times a second. A median of the last five readings
   steadies the note, an exponential average steadies the needle,
   and a sound quieter than −40 dBFS, or one that doesn't repeat,
   shows "Listening…" instead of a note. Nothing is recorded or
   kept; the samples are analysed and dropped.

   The microphone light is a promise: every track stops when the
   page is left, the window is minimised or closed, or the browser
   tab is hidden. Music calls stop() / destroy() for the first
   three; this module listens for the last itself.

   createTuner({ h, icon, store }) -> { el, start(), stop(why), destroy(), running }
   ============================================================ */
import { yin, rms, noteOf, targetOf, makeSmoother, TUNINGS, customTuning, freqOfMidi } from '../core/pitch.js';
import { t } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-audiotools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audiotools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-audiotools.css';
  document.head.appendChild(l);
}

const KEY = 'portal.tuner';
const FFT = 4096;
const EVERY = 40;                 /* ms between readings */
const QUIET = 0.01;               /* rms below this (−40 dBFS) is silence */
const IN_TUNE = 5;                /* cents either side that count as in tune */
const MODES = [...Object.values(TUNINGS).map(t => ({ id: t.id, label: t.label, sub: t.sub })), { id: 'chromatic', label: t('Chromatic'), sub: t('any note') }, { id: 'custom', label: t('Custom'), sub: t('your own notes') }];
const HOLD = 12;                  /* in-tune readings in a row (about half a second) before a string gets its tick */
const A4_MIN = 415, A4_MAX = 466;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function micProblem(err) {
  const n = err && err.name;
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') {
    return 'The browser blocked the microphone, so the tuner can’t hear anything. Allow the microphone for this site (the lock or camera icon beside the address), and on a Mac check System Settings › Privacy & Security › Microphone, then press the button again.';
  }
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found. Plug one in (or pick one in your system’s sound settings) and press the button again.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The microphone is busy or stopped responding. Close any other app or tab that is using it (video calls hold on to it), then try again.';
  return `The microphone couldn’t start${err && err.message ? `: ${err.message}` : '.'}`;
}

export function createTuner({ h, icon, store }) {
  const saved = (store && store.get(KEY)) || {};
  const S = { mode: MODES.some(m => m.id === saved.mode) ? saved.mode : 'guitar', phase: 'off', problem: '', why: '', shown: 0, has: false, dead: false,
    a4: clamp(Math.round(Number(saved.a4)) || 440, A4_MIN, A4_MAX), custom: typeof saved.custom === 'string' ? saved.custom.slice(0, 60) : 'D2 A2 D3 G3 B3 E4',
    done: new Set(), streak: 0, streakOf: -1 };
  const keep = () => { try { store && store.set(KEY, { mode: S.mode, a4: S.a4, custom: S.custom }); } catch (e) { /* not saved */ } };
  const tuningNow = () => (S.mode === 'custom' ? customTuning(S.custom) : TUNINGS[S.mode] || null);
  let tone = null;                  /* the reference tone that is sounding: { ac, osc, timer } */
  let stream = null, ac = null, an = null, timer = 0, buf = null, gen = 0;
  const smoother = makeSmoother();

  /* ---- layout ---- */
  const askBtn = h('button.btn.btn--primary.tu-ask', { type: 'button', onclick: () => start() }, icon('mic'), h('span', { text: t('Turn on microphone') }));
  const offBtn = h('button.btn.tu-off', { type: 'button', onclick: () => stop('You turned the microphone off.') }, icon('x'), h('span', { text: t('Turn off microphone') }));
  const intro = h('div.mu-intro.tu-intro',
    h('div.mu-intro__ic', icon('gauge')),
    h('div.mu-intro__txt',
      h('h3', { text: t('Tune a guitar or ukulele with your microphone') }),
      h('p', { text: t('The tuner has to listen to the string you pluck to tell how in tune it is, so it needs your microphone. Your browser will ask before it starts. The sound is analysed live in this window and never recorded, saved or sent anywhere, and the microphone turns off when you leave this page, minimise or close the window.') })),
    h('div.mu-intro__acts', askBtn));
  const problem = h('div.mu-banner.tu-problem', { role: 'alert', hidden: true }, icon('alert'), h('span'));
  const modeBtns = new Map();
  const modes = h('div.tu-modes', { role: 'radiogroup', 'aria-label': t('Tuning') }, MODES.map(m => {
    const b = h('button.tu-mode', { type: 'button', role: 'radio', dataset: { mode: m.id }, onclick: () => setMode(m.id) },
      h('b', { text: m.label }), h('small', { text: m.sub }));
    modeBtns.set(m.id, b);
    return b;
  }));
  const stringsEl = h('div.tu-strings', { role: 'group', 'aria-label': t('Strings') });
  const a4In = h('input', { type: 'number', min: String(A4_MIN), max: String(A4_MAX), step: '1', value: String(S.a4), 'aria-label': t('Reference pitch, the frequency of A4 in hertz'), dataset: { role: 'a4' },
    onchange: ev => { const v = clamp(Math.round(Number(ev.target.value)) || 440, A4_MIN, A4_MAX); ev.target.value = String(v); if (v === S.a4) return; S.a4 = v; keep(); resetDone(); paintStatic(); } });
  const a4Btn = h('button.btn.btn--sm', { type: 'button', dataset: { role: 'a4-tone' }, title: t('Play A4 at the reference pitch'), onclick: () => playTone(69, 'A4') }, icon('play'), h('span', { text: t('Play A') }));
  const customIn = h('input', { type: 'text', value: S.custom, maxlength: '60', spellcheck: 'false', 'aria-label': t('Custom tuning, note names from the lowest string, e.g. D2 A2 D3 G3'), placeholder: 'D2 A2 D3 G3', dataset: { role: 'custom' },
    oninput: ev => { S.custom = ev.target.value; keep(); resetDone(); paintStatic(); } });
  const customErr = h('small.tu-customerr', { role: 'alert' });
  const customRow = h('div.tu-custom', h('label.field', customIn), customErr);
  const resetBtn = h('button.btn.btn--sm.btn--ghost.tu-reset', { type: 'button', dataset: { role: 'ticks-reset' }, onclick: () => { resetDone(); paintStatic(); } }, icon('rotate-ccw'), h('span', { text: t('Start the ticks again') }));
  const refRow = h('div.tu-ref', h('label.tu-ref__lbl', h('span', { text: 'A4 =' }), h('span.field', a4In), h('span', { text: t('Hz') })), a4Btn);
  const doneEl = h('div.tu-alldone', { role: 'status', dataset: { role: 'alldone' }, hidden: true }, icon('check'), h('b', { text: t('All strings in tune') }));
  const noteEl = h('div.tu-note', { 'aria-hidden': 'true' });
  const hzEl = h('div.tu-hz');
  const targetEl = h('div.tu-target');
  const centsEl = h('div.tu-cents');
  const needle = h('i.tu-needle');
  const ticks = h('span.tu-ticks', { 'aria-hidden': 'true' }, [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map(c =>
    h('i', { class: c === 0 ? 'is-zero' : null, style: { left: `${50 + c}%` } })));
  const meter = h('div.tu-meter', { role: 'meter', 'aria-label': t('Cents sharp or flat'), 'aria-valuemin': '-50', 'aria-valuemax': '50', 'aria-valuenow': '0', 'aria-valuetext': 'Listening' },
    ticks, needle,
    h('span.tu-flat', { 'aria-hidden': 'true', text: t('♭ flat') }), h('span.tu-sharp', { 'aria-hidden': 'true', text: t('sharp ♯') }));
  const live = h('div.sr', { 'aria-live': 'polite' });
  const status = h('div.tu-status', { role: 'status' });
  const stage = h('div.tu-stage', noteEl, hzEl, meter, centsEl, targetEl, stringsEl, doneEl);
  const el = h('div.tu', { dataset: { mic: 'off', mode: S.mode, note: '', cents: '', target: '', a4: String(S.a4), tone: '' } },
    intro, problem, modes, customRow, refRow, stage, h('div.tu-foot', status, resetBtn, offBtn), live);

  /* ---- paint ---- */
  function paintStatic() {
    el.dataset.mode = S.mode;
    el.dataset.a4 = String(S.a4);
    for (const [id, b] of modeBtns) b.setAttribute('aria-checked', String(id === S.mode));
    stringsEl.replaceChildren();
    const t = tuningNow();
    customRow.hidden = S.mode !== 'custom';
    customErr.textContent = S.mode === 'custom' && !t ? 'Type note names from the lowest string, like D2 A2 D3 G3 (up to 8; use # or b for sharps and flats).' : '';
    stringsEl.hidden = !t;
    if (t) t.strings.forEach((s, i) => {
      const f = freqOfMidi(s.midi, S.a4);
      const done = S.done.has(i);
      stringsEl.append(h('button.tu-str', { type: 'button', class: done ? 'is-done' : null, dataset: { i: String(i), done: done ? '1' : '' },
        title: `${s.label} · ${Math.round(f * 10) / 10} Hz — press to hear it`, 'aria-label': `${s.label}, ${Math.round(f * 10) / 10} hertz${done ? ', in tune' : ''}. Press to hear it`,
        onclick: () => playTone(s.midi, s.label) },
        h('b', { text: s.name }), h('small', { text: String(Math.floor(s.midi / 12) - 1) }), done ? h('i.tu-tick', { 'aria-hidden': 'true', text: '✓' }) : null));
    });
    const all = !!t && S.done.size === t.strings.length;
    doneEl.hidden = !all;
    el.dataset.alldone = all ? '1' : '';
    resetBtn.hidden = !S.done.size;
  }
  function paintPhase() {
    const on = S.phase === 'on';
    el.dataset.mic = S.phase === 'asking' ? 'asking' : on ? 'on' : 'off';
    intro.hidden = on || S.phase === 'asking' ? true : false;
    askBtn.disabled = S.phase === 'asking';
    offBtn.hidden = !on;
    stage.classList.toggle('is-off', !on);
    problem.hidden = !S.problem;
    if (S.problem) problem.lastChild.textContent = S.problem;
    status.textContent = S.phase === 'asking' ? 'Waiting for the browser’s microphone question…'
      : on ? (S.has ? '' : 'Listening… play a string.')
      : S.why;
  }
  function resetDone() { S.done = new Set(); S.streak = 0; S.streakOf = -1; }
  /** a string that stays in tune for HOLD readings in a row earns a tick; the ticks stay until you start them again */
  function tick(r) {
    if (!r || r.index < 0 || Math.abs(r.cents) >= IN_TUNE) { S.streak = 0; S.streakOf = -1; return; }
    if (S.streakOf !== r.index) { S.streakOf = r.index; S.streak = 0; }
    if (++S.streak >= HOLD && !S.done.has(r.index)) { S.done.add(r.index); paintStatic(); }
  }
  /* ---- the reference tone: a plain sine wave, made here, with a soft start and end so it doesn't click ---- */
  function playTone(midi, label) {
    stopTone();
    const f = freqOfMidi(midi, S.a4);
    el.dataset.tone = String(Math.round(f * 100) / 100);
    status.textContent = `Playing ${label} — ${Math.round(f * 10) / 10} Hz`;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const t0 = ac.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.03);
      g.gain.setValueAtTime(0.25, t0 + 1.6);
      g.gain.linearRampToValueAtTime(0, t0 + 2);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(t0 + 2.05);
      ac.resume && ac.resume().catch(() => {});
      tone = { ac, osc, timer: setTimeout(stopTone, 2200) };
    } catch (e) { tone = { ac: null, osc: null, timer: setTimeout(stopTone, 2200) }; }
  }
  function stopTone() {
    if (!tone) return;
    clearTimeout(tone.timer);
    try { tone.osc && tone.osc.stop(); } catch (e) { /* already stopped */ }
    try { tone.ac && tone.ac.close(); } catch (e) { /* closed */ }
    tone = null;
    el.dataset.tone = '';
  }

  function paintReading(r) {
    S.has = !!r;
    const a11y = r => {
      const c = Math.round(Math.abs(r.cents));
      return r.cents > -IN_TUNE && r.cents < IN_TUNE ? `${r.label}, in tune` : `${r.label}, ${c} cents ${r.cents > 0 ? 'sharp' : 'flat'}`;
    };
    if (!r) {
      S.shown *= 0.6;
      if (Math.abs(S.shown) < 0.5) S.shown = 0;
      el.dataset.note = ''; el.dataset.cents = ''; el.dataset.target = '';
      noteEl.textContent = '–';
      hzEl.textContent = '';
      centsEl.textContent = '';
      targetEl.textContent = '';
      centsEl.dataset.state = '';
      needle.style.left = `${50 + S.shown}%`;
      stage.classList.add('is-quiet');
      meter.setAttribute('aria-valuenow', '0');
      meter.setAttribute('aria-valuetext', 'Listening');
      stringsEl.querySelectorAll('.tu-str').forEach(s => { s.classList.remove('is-target', 'is-ok'); });
      status.textContent = S.phase === 'on' ? 'Listening… play a string.' : status.textContent;
      return;
    }
    S.shown += (r.cents - S.shown) * 0.4;
    stage.classList.remove('is-quiet');
    const c = clamp(S.shown, -50, 50);
    const ok = Math.abs(r.cents) < IN_TUNE;
    el.dataset.note = r.label;
    el.dataset.cents = String(Math.round(S.shown * 10) / 10);
    el.dataset.target = r.target || '';
    noteEl.textContent = r.label;
    noteEl.dataset.state = ok ? 'ok' : '';
    hzEl.textContent = `${r.freq.toFixed(1)} Hz`;
    centsEl.dataset.state = ok ? 'ok' : r.cents > 0 ? 'sharp' : 'flat';
    centsEl.textContent = ok ? 'In tune' : Math.abs(r.cents) > 100 ? 'Far from this string' : `${Math.round(Math.abs(r.cents))} cents ${r.cents > 0 ? 'sharp' : 'flat'}`;
    targetEl.textContent = r.target ? `Target string: ${r.target}` : '';
    needle.style.left = `${50 + c}%`;
    needle.dataset.state = ok ? 'ok' : '';
    meter.setAttribute('aria-valuenow', String(Math.round(c)));
    meter.setAttribute('aria-valuetext', a11y(r));
    stringsEl.querySelectorAll('.tu-str').forEach(s => {
      const on = r.index === Number(s.dataset.i);
      s.classList.toggle('is-target', on);
      s.classList.toggle('is-ok', on && ok);
    });
    status.textContent = '';
  }

  /* ---- reading ---- */
  function readOnce() {
    if (!an || S.dead) return;
    an.getFloatTimeDomainData(buf);
    let raw = null;
    if (rms(buf) >= QUIET) {
      /* a bass string can sit below 50 Hz: look as low as the tuning's lowest string needs */
      const tnLow = tuningNow();
      const lowHz = tnLow ? Math.min(...tnLow.strings.map(x => freqOfMidi(x.midi, S.a4))) : 50;
      const y = yin(buf, ac.sampleRate, { minHz: Math.max(25, Math.min(50, lowHz * 0.8)) });
      if (y && y.clarity >= 0.8) raw = y;
    }
    const sm = smoother.push(raw);
    if (!sm) { paintReading(null); return; }
    const tn = tuningNow();
    if (S.mode === 'chromatic' || !tn) {
      paintReading({ ...noteOf(sm.freq, S.a4), target: '', index: -1 });
    } else {
      const nn = noteOf(sm.freq, S.a4);
      const t = targetOf(sm.freq, tn, S.a4);
      const r = { ...nn, cents: t.cents, target: `${t.string.label} (${Math.round(freqOfMidi(t.string.midi, S.a4) * 10) / 10} Hz)`, index: t.index, freq: sm.freq };
      paintReading(r);
      tick(r);
    }
  }

  function setMode(id) {
    if (S.mode === id) return;
    S.mode = id;
    S.shown = 0;
    smoother.reset();
    resetDone();
    keep();
    paintStatic();
    paintReading(null);
  }

  /* ---- the microphone ---- */
  async function start() {
    if (S.dead || S.phase !== 'off') return;
    S.problem = '';
    S.why = '';
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || !md.getUserMedia) {
      S.problem = typeof isSecureContext !== 'undefined' && !isSecureContext
        ? 'Browsers only allow microphones on secure (https) pages, and this page isn’t one.'
        : 'This browser has no microphone support, so the tuner can’t work here.';
      paintPhase();
      return;
    }
    const mine = ++gen;
    S.phase = 'asking';
    paintPhase();
    let s;
    try {
      s = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (err) {
      if (S.dead || mine !== gen) return;
      S.phase = 'off';
      S.problem = micProblem(err);
      paintPhase();
      return;
    }
    if (S.dead || mine !== gen) { s.getTracks().forEach(t => t.stop()); return; }   /* left the page while the prompt was open */
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      an = ac.createAnalyser();
      an.fftSize = FFT;
      an.smoothingTimeConstant = 0;
      ac.createMediaStreamSource(s).connect(an);
      ac.resume().catch(() => {});
    } catch (err) {
      s.getTracks().forEach(t => t.stop());
      try { ac && ac.close(); } catch (e) { /* closed */ }
      ac = an = null;
      S.phase = 'off';
      S.problem = 'This browser can’t analyse audio, so the tuner can’t work here.';
      paintPhase();
      return;
    }
    stream = s;
    buf = new Float32Array(FFT);
    smoother.reset();
    S.shown = 0;
    S.phase = 'on';
    /* the browser, or the person, ending the microphone from outside */
    s.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (stream === s) stop('The microphone stopped. Press the button to turn it back on.'); }));
    paintPhase();
    paintReading(null);
    timer = setInterval(readOnce, EVERY);
  }

  function stop(why = '') {
    gen++;                                           /* a prompt still open is void */
    clearInterval(timer);
    timer = 0;
    if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* already stopped */ } });
    stream = null;
    if (ac) { try { ac.close(); } catch (e) { /* closed */ } }
    ac = an = buf = null;
    S.streak = 0; S.streakOf = -1;
    if (S.phase === 'off') return;
    S.phase = 'off';
    S.why = why;
    S.has = false;
    if (!S.dead) { paintPhase(); paintReading(null); }
  }

  const onVis = () => { if (document.hidden && S.phase !== 'off') stop('The microphone was turned off because this tab was hidden. Press the button to turn it back on.'); };
  document.addEventListener('visibilitychange', onVis);

  paintStatic();
  paintPhase();
  paintReading(null);

  return {
    el,
    get running() { return S.phase === 'on'; },
    start, stop,
    destroy() { S.dead = true; stop(); stopTone(); document.removeEventListener('visibilitychange', onVis); },
  };
}
