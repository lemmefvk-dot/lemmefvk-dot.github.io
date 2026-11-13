/* ============================================================
   drills/morse.js — the Morse tab of Static Drills.

   Three ways in, in the order a learner needs them:
     Learn   the characters of one stage, each with its pattern; click to hear it
     Copy    hear a character (or a short group) and type what you heard
     Send    be shown a character and key it with Space (or by tapping the
             pad); how long each press and gap was decides what you sent

   The stages (js/drills/morse-core.js) start with the shortest letters
   and end with the digits. A letter counts as known once at least 4 of
   its last 8 Copy answers are in and 75% were right; a stage is done
   when all its letters are known. Everything shown is counted from
   answers actually given. Sound is WebAudio at a speed and pitch you
   choose; a light flashes in step with it, and is the only signal for
   anyone who cannot hear it (or if the browser has no audio, or the
   system is muted). Closing the window stops all sound.
   Saved on this device ('portal.drillsMorse').
   ============================================================ */
import * as C from './morse-core.js';
import { addRecent, recentWeight, isKnown, pickWeighted } from './sched.js';

const KEY = 'portal.drillsMorse';
const DEFAULT = { v: 1, chars: {}, p: { mode: 'learn', stage: 0, wpm: C.WPM.def, freq: C.FREQ.def, sound: true, light: true, group: 1, hints: true } };
const now = () => performance.now();
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const dots = pat => [...pat].map(c => (c === '.' ? '•' : '—')).join(' ');
const words = pat => [...pat].map(c => (c === '.' ? 'dit' : 'dah')).join(' ');

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const q = r.p || {};
  const p = {
    mode: ['learn', 'copy', 'send'].includes(q.mode) ? q.mode : 'learn',
    stage: clamp(q.stage, 0, C.STAGES.length - 1, 0) | 0,
    wpm: Math.round(clamp(q.wpm, C.WPM.min, C.WPM.max, C.WPM.def)),
    freq: Math.round(clamp(q.freq, C.FREQ.min, C.FREQ.max, C.FREQ.def)),
    sound: q.sound !== false, light: q.light !== false, group: [1, 3, 5].includes(q.group) ? q.group : 1, hints: q.hints !== false,
  };
  const chars = {};
  for (const ch of C.ALL_CHARS) {
    const c = r.chars && r.chars[ch];
    if (c) chars[ch] = { c: String(c.c || '').slice(-8), s: String(c.s || '').slice(-8), cn: Number(c.cn) || 0, cok: Number(c.cok) || 0, sn: Number(c.sn) || 0, sok: Number(c.sok) || 0 };
  }
  return { v: 1, chars, p };
}

export function mountMorse(host, ctx) {
  const { api } = ctx;
  const { h, icon, store } = api;
  const S = { data: normalize(store.get(KEY)), dead: false, timers: new Set(), run: null, lit: false, press: null, presses: [], idle: null, keyDown: false };
  const p = S.data.p;

  const save = () => store.set(KEY, { v: 1, chars: { ...S.data.chars }, p: { ...p } });
  const muted = () => store.get('prefs.muted', false) === true;
  const sysVolume = () => (muted() ? 0 : clamp(store.get('prefs.volume', 62), 0, 100, 62) / 100);
  const tone = C.createSidetone({ volume: sysVolume, freq: () => p.freq });
  const soundOn = () => p.sound && tone.available() && !muted();
  const lightOn = () => p.light || !soundOn();
  const unit = () => C.unitMs(p.wpm);
  const later = (fn, ms) => { const t = setTimeout(() => { S.timers.delete(t); if (!S.dead) fn(); }, ms); S.timers.add(t); return t; };
  const clearTimers = () => { for (const t of S.timers) clearTimeout(t); S.timers.clear(); };

  const root = h('div.dr-morse', { dataset: { fk: 'morse' } });
  host.appendChild(root);
  const lamp = h('div.dr-lamp', { 'aria-hidden': 'true', dataset: { fk: 'morse-lamp', lit: '0' } });
  const setLamp = on => { S.lit = on; lamp.dataset.lit = on ? '1' : '0'; lamp.classList.toggle('is-lit', on); };

  /* what is known, from the record */
  const rec = ch => S.data.chars[ch] || { c: '', s: '', cn: 0, cok: 0, sn: 0, sok: 0 };
  const stageKnown = st => [...st.chars].filter(ch => isKnown(rec(ch).c)).length;
  const recommended = () => { const i = C.STAGES.findIndex(st => stageKnown(st) < st.chars.length); return i < 0 ? C.STAGES.length - 1 : i; };
  function note(ch, kind, ok) {
    const c = { ...rec(ch) };
    if (kind === 'c') { c.c = addRecent(c.c, ok); c.cn++; if (ok) c.cok++; } else { c.s = addRecent(c.s, ok); c.sn++; if (ok) c.sok++; }
    S.data.chars[ch] = c;
    save();
    refreshSide();
  }

  /* ---- playing a text: sound + light, both from the same schedule ---- */
  function stopAll() {
    clearTimers();
    tone.stop();
    setLamp(false);
    S.playing = false;
  }
  function playText(text, onDone) {
    stopAll();
    const sched = C.schedule(text);
    const u = unit();
    const lead = soundOn() ? 60 : 0;
    S.playing = true;
    if (soundOn()) tone.play(text, p.wpm);
    for (const s of sched.on) {
      if (lightOn()) { later(() => setLamp(true), lead + s.start * u); later(() => setLamp(false), lead + (s.start + s.dur) * u); }
    }
    later(() => { S.playing = false; setLamp(false); if (onDone) onDone(); }, lead + sched.total * u + 20);
  }

  /* ---------------- chrome: tabs, settings ---------------- */
  const modeBtn = (id, label) => h('button.dr-chip', { type: 'button', class: p.mode === id ? 'is-on' : '', 'aria-pressed': p.mode === id ? 'true' : 'false', dataset: { fk: `morse-mode-${id}` }, onclick: () => { stopAll(); S.run = null; p.mode = id; save(); paint(); } }, label);
  function settingsBar() {
    const wpm = h('input', { type: 'range', min: String(C.WPM.min), max: String(C.WPM.max), step: '1', value: String(p.wpm), 'aria-label': 'Speed in words per minute', dataset: { fk: 'morse-wpm' } });
    const wl = h('b', { dataset: { fk: 'morse-wpm-val' }, text: `${p.wpm} wpm` });
    wpm.oninput = () => { p.wpm = Math.round(clamp(wpm.value, C.WPM.min, C.WPM.max, C.WPM.def)); wl.textContent = `${p.wpm} wpm`; ul.textContent = `a dit lasts ${Math.round(unit())} ms`; save(); };
    const ul = h('small.dim', { text: `a dit lasts ${Math.round(unit())} ms` });
    const fq = h('input', { type: 'range', min: String(C.FREQ.min), max: String(C.FREQ.max), step: '10', value: String(p.freq), 'aria-label': 'Tone pitch in hertz', dataset: { fk: 'morse-freq' } });
    const fl = h('b', { dataset: { fk: 'morse-freq-val' }, text: `${p.freq} Hz` });
    fq.oninput = () => { p.freq = Math.round(clamp(fq.value, C.FREQ.min, C.FREQ.max, C.FREQ.def)); fl.textContent = `${p.freq} Hz`; save(); };
    const canHear = tone.available();
    const snd = h('input', { type: 'checkbox', checked: p.sound && canHear, disabled: !canHear, dataset: { fk: 'morse-sound' }, onchange: e => { p.sound = e.target.checked; stopAll(); save(); paint(); } });
    const lt = h('input', { type: 'checkbox', checked: lightOn(), disabled: !soundOn(), dataset: { fk: 'morse-light' }, onchange: e => { p.light = e.target.checked; save(); } });
    return h('div.dr-card.dr-set',
      h('label.dr-set__i', h('span', { text: 'Speed' }), wpm, wl, ul),
      h('label.dr-set__i', h('span', { text: 'Pitch' }), fq, fl),
      h('label.dr-set__c', snd, h('span', { text: 'Sound' })),
      h('label.dr-set__c', lt, h('span', { text: 'Light' })),
      !canHear ? h('small.dr-warn', { dataset: { fk: 'morse-nosound' }, text: 'This browser has no Web Audio, so there is no sound: the light is the signal.' })
        : muted() ? h('small.dr-warn', { dataset: { fk: 'morse-muted' }, text: 'StaticOS is muted, so nothing will play: the light shows the signal.' }) : null);
  }

  function stageBar() {
    const rec0 = recommended();
    return h('div.dr-stages', { role: 'group', 'aria-label': 'Stage' }, ...C.STAGES.map((st, i) => {
      const k = stageKnown(st);
      return h('button.dr-stage', { type: 'button', class: (p.stage === i ? 'is-on ' : '') + (i === rec0 ? 'is-next' : ''), 'aria-pressed': p.stage === i ? 'true' : 'false', dataset: { fk: `stage-${i}`, known: String(k) },
        onclick: () => { stopAll(); S.run = null; p.stage = i; save(); paint(); } },
      h('b', { text: `Stage ${st.id}` }), h('span', { text: st.name }),
      h('small', { text: `${k} of ${st.chars.length} known${i === rec0 ? ' · next up' : ''}` }));
    }));
  }

  /* ---------------- learn ---------------- */
  function learnView() {
    const st = C.STAGES[p.stage];
    return h('div.dr-card', h('h3.dr-h', { text: `Stage ${st.id}: ${st.name}` }), h('div.dr-stagebox', lamp), h('p.dr-sub', { text: st.hint + ' Click a letter to hear it; say it as dit and dah, not as dots and dashes.' }),
      h('div.dr-learn', ...[...st.chars].map(ch => h('button.dr-char', { type: 'button', dataset: { fk: `learn-${ch}`, pattern: C.MORSE[ch] }, 'aria-label': `${ch}: ${words(C.MORSE[ch])}`, onclick: () => playText(ch) },
        h('b', { text: ch }), h('span.dr-pat', { text: dots(C.MORSE[ch]) }), h('small', { text: words(C.MORSE[ch]) })))),
      h('div.dr-row', h('button.btn', { type: 'button', dataset: { fk: 'learn-all' }, onclick: () => playText([...st.chars].join(' ')) }, icon('play'), h('span', { text: 'Hear all of them' })),
        h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'to-copy' }, onclick: () => { p.mode = 'copy'; save(); paint(); } }, 'Now copy them')));
  }

  /* ---------------- copy / send ---------------- */
  const pickChar = avoid => {
    const chars = [...C.STAGES[p.stage].chars];
    return pickWeighted(chars, ch => recentWeight(rec(ch)[p.mode === 'copy' ? 'c' : 's']), Math.random, avoid);
  };
  function newTarget(fresh) {
    const n = p.mode === 'copy' ? p.group : 1;
    let target = '';
    let last = S.run && S.run.target ? S.run.target.slice(-1) : undefined;
    for (let i = 0; i < n; i++) { last = pickChar(last); target += last; }
    const keep = S.run && !fresh ? S.run : { n: 0, ok: 0 };
    S.run = { mode: p.mode, target, over: false, n: keep.n, ok: keep.ok, fb: null };
    S.presses = [];
    S.press = null;
    paint();
    if (p.mode === 'copy') later(() => playText(target.split('').join(' ')), 150);
  }

  function resultBox() {
    const fb = S.run && S.run.fb;
    return h('div.dr-fb', { class: fb ? fb.cls : '', dataset: { fk: 'morse-feedback' }, role: 'status', text: fb ? fb.text : '' });
  }
  function setFb(cls, text) {
    const el = root.querySelector('[data-fk="morse-feedback"]');
    if (el) { el.className = `dr-fb ${cls}`; el.textContent = text; }
    S.run.fb = { cls, text };
  }
  const tally = () => (S.run && S.run.n ? `${S.run.ok} of ${S.run.n} right this time` : '');

  function copyView() {
    const R = S.run;
    const inp = h('input.dr-in', { type: 'text', maxlength: String(p.group), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'What you heard', dataset: { fk: 'copy-in' },
      oninput: () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (inp.value.length >= R.target.length && !R.over) judgeCopy(inp.value); },
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); if (R.over) newTarget(); else if (!inp.value) playText(R.target.split('').join(' ')); else judgeCopy(inp.value); }
      } });
    queueMicrotask(() => { if (!S.dead && document.contains(inp)) inp.focus(); });
    return h('div.dr-card', h('h3.dr-h', { text: `Copy: stage ${C.STAGES[p.stage].id}` }),
      h('p.dr-sub', { text: `Listen and type what you heard (${p.group === 1 ? 'one character' : `${p.group} characters`}). Enter with nothing typed plays it again.` }),
      h('div.dr-stagebox', lamp),
      inp,
      h('div.dr-row', h('button.btn', { type: 'button', dataset: { fk: 'copy-again' }, onclick: () => playText(R.target.split('').join(' ')) }, icon('refresh'), h('span', { text: 'Hear it again' })),
        h('small.dim', { text: 'Group' }), ...[1, 3, 5].map(n => h('button.dr-chip', { type: 'button', class: p.group === n ? 'is-on' : '', 'aria-pressed': p.group === n ? 'true' : 'false', dataset: { fk: `group-${n}` }, onclick: () => { p.group = n; save(); stopAll(); newTarget(true); } }, String(n)))),
      resultBox(), h('small.dim', { dataset: { fk: 'morse-tally' }, text: tally() }));
  }
  function judgeCopy(typed) {
    const R = S.run;
    if (R.over) return;
    R.over = true;
    let right = 0;
    [...R.target].forEach((ch, i) => { const ok = typed[i] === ch; if (ok) right++; note(ch, 'c', ok); });
    const all = right === R.target.length;
    R.n++; if (all) R.ok++;
    const pats = [...R.target].map(ch => `${ch} = ${dots(C.MORSE[ch])}`).join('   ');
    setFb(all ? 'is-ok' : 'is-bad', all ? `Right: ${R.target}. ${pats}` : `It was ${R.target}, you typed ${typed || 'nothing'}. ${pats}`);
    const t = root.querySelector('[data-fk="morse-tally"]'); if (t) t.textContent = tally();
    later(() => { if (S.run === R && R.over) newTarget(); }, all ? 700 : 2200);
  }

  function sendView() {
    const R = S.run;
    const pad = h('button.dr-key', { type: 'button', dataset: { fk: 'send-key' }, 'aria-label': 'Morse key: hold for a dah, tap for a dit. You can also press Space.',
      onpointerdown: e => { e.preventDefault(); keyDown(); }, onpointerup: () => keyUp(), onpointerleave: () => { if (S.keyDown) keyUp(); },
      onkeydown: e => { if (e.key === ' ') { e.preventDefault(); if (!e.repeat) keyDown(); } },
      onkeyup: e => { if (e.key === ' ') { e.preventDefault(); keyUp(); } } }, 'Tap here, or press Space');
    queueMicrotask(() => { if (!S.dead && document.contains(pad)) pad.focus(); });
    return h('div.dr-card', h('h3.dr-h', { text: `Send: stage ${C.STAGES[p.stage].id}` }),
      h('p.dr-sub', { text: `Key the letter below at ${p.wpm} wpm: a press shorter than ${Math.round(2 * unit())} ms is a dit, longer is a dah, and a pause of ${Math.round(2 * unit())} ms ends the letter.` }),
      h('div.dr-stagebox', lamp, h('div.dr-big', { dataset: { fk: 'send-target' }, text: R.target }),
        h('div.dr-pat', { dataset: { fk: 'send-pattern' }, text: p.hints ? dots(C.MORSE[R.target]) : '' }),
        h('div.dr-pat', { dataset: { fk: 'send-sent' }, 'aria-label': 'What you have keyed so far' })),
      pad,
      h('div.dr-row', h('label.dr-set__c', h('input', { type: 'checkbox', checked: p.hints, dataset: { fk: 'send-hints' }, onchange: e => { p.hints = e.target.checked; save(); paint(); } }), h('span', { text: 'Show the dits and dahs' })),
        h('button.btn', { type: 'button', dataset: { fk: 'send-hear' }, onclick: () => playText(R.target) }, icon('play'), h('span', { text: 'Hear it' }))),
      resultBox(), h('small.dim', { dataset: { fk: 'morse-tally' }, text: tally() }));
  }
  function keyDown() {
    const R = S.run;
    if (!R || R.over || S.keyDown) return;
    S.keyDown = true;
    if (S.idle) { clearTimeout(S.idle); S.timers.delete(S.idle); S.idle = null; }
    S.press = now();
    if (soundOn()) tone.on();
    if (lightOn()) setLamp(true);
  }
  function keyUp() {
    const R = S.run;
    if (!S.keyDown) return;
    S.keyDown = false;
    tone.off();
    setLamp(false);
    if (!R || R.over || S.press == null) return;
    S.presses.push({ down: S.press, up: now() });
    S.press = null;
    const sym = C.decodePresses(S.presses, unit()).symbols;
    const el = root.querySelector('[data-fk="send-sent"]');
    if (el) el.textContent = sym;
    /* the letter is over once the silence is longer than a gap inside a letter */
    S.idle = later(() => judgeSend(), 2 * unit() + 1);
  }
  function judgeSend() {
    const R = S.run;
    if (!R || R.over || !S.presses.length) return;
    R.over = true;
    const { symbols, text } = C.decodePresses(S.presses, unit());
    const u = unit();
    const sent = S.presses.map(x => `${C.classifyPress(x.up - x.down, u) === '.' ? 'dit' : 'dah'} ${((x.up - x.down) / u).toFixed(1)}`).join(', ');
    const ok = symbols === C.MORSE[R.target];
    note(R.target, 's', ok);
    R.n++; if (ok) R.ok++;
    setFb(ok ? 'is-ok' : 'is-bad', ok ? `Right: ${R.target} is ${dots(symbols)} (${sent} units).`
      : `You sent ${dots(symbols) || 'nothing'}${text ? ` (that reads ${text})` : ''}; ${R.target} is ${dots(C.MORSE[R.target])} (${words(C.MORSE[R.target])}). Your presses: ${sent} units.`);
    const t = root.querySelector('[data-fk="morse-tally"]'); if (t) t.textContent = tally();
    later(() => { if (S.run === R) newTarget(); }, ok ? 800 : 2200);
  }

  /* ---------------- progress, from the record ---------------- */
  function progress() {
    const rows = [...C.ALL_CHARS].map(ch => {
      const c = rec(ch);
      return h('div.dr-pc', { dataset: { fk: `pc-${ch}`, cn: String(c.cn), cok: String(c.cok), sn: String(c.sn), sok: String(c.sok) }, class: isKnown(c.c) ? 'is-known' : '' },
        h('b', { text: ch }),
        h('small', { text: c.cn ? `copy ${Math.round(100 * c.cok / c.cn)}% of ${c.cn}` : 'copy: not tried' }),
        h('small', { text: c.sn ? `send ${Math.round(100 * c.sok / c.sn)}% of ${c.sn}` : 'send: not tried' }));
    });
    return h('div.dr-card', { dataset: { fk: 'morse-progress' } }, h('h3.dr-h', { text: 'Your progress' }),
      h('p.dr-sub', { text: 'Counted from your answers. Green means known: at least 4 of the last 8 copy answers, 75% or more right.' }),
      h('div.dr-pcs', ...rows));
  }

  /* the stage bar and the progress card follow each answer, the rest of the page stays put */
  function refreshSide() {
    const sb = root.querySelector('.dr-stages'), pg = root.querySelector('[data-fk="morse-progress"]');
    if (sb) sb.replaceWith(stageBar());
    if (pg) pg.replaceWith(progress());
  }

  function paint() {
    S.keyDown = false;
    const kids = [h('div.dr-card.dr-modes', h('div.dr-chips', { role: 'group', 'aria-label': 'Mode' }, modeBtn('learn', 'Learn'), modeBtn('copy', 'Copy (hear, type)'), modeBtn('send', 'Send (key it)'))), stageBar(), settingsBar()];
    if (p.mode === 'learn') kids.push(learnView());
    else {
      if (!S.run || S.run.mode !== p.mode) { newTarget(true); return; }
      kids.push(p.mode === 'copy' ? copyView() : sendView());
    }
    kids.push(progress());
    root.replaceChildren(...kids);
    /* the lamp is one element moved between views */
    setLamp(S.lit);
  }

  paint();

  return {
    teardown() {
      S.dead = true;
      clearTimers();
      tone.close();
    },
    open() { /* nothing to open */ },
  };
}
