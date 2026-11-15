/* ============================================================
   sheetmusic.js — Sheet Music: write a tune in ABC notation, see it as
   music, hear it played.

   Type ABC on the left (core/abc.js reads it as you go); the page on the
   right is drawn by core/abcscore.js. Play uses the Static Synth's sound
   engine (core/synth.js) on one AudioContext, so there is no second synth.
   The note that is sounding is coloured on the page; click a note to play
   from there. Repeats and first and second endings are followed.

   Starting points: the Examples menu has a few tunes that are in the public
   domain, typed out for this app (core/abctunes.js). Save keeps the tune as
   ~/Documents/<title>.abc, which is plain text; PNG and SVG put a picture
   of the page in ~/Pictures.

   Keyboard: Ctrl+Enter plays and stops (from the editor too), Esc stops,
   Ctrl+S saves. Everything on the toolbar is a button you can Tab to.

   Not supported, and said so on the page when a tune uses it: lyrics (w:),
   slurs, grace notes, decorations; and a key change in the middle of a tune
   changes the notes that sound but not the key signature drawn.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import { parseABC, events, secondsPerWhole } from '../core/abc.js';
import { layout } from '../core/abcscore.js';
import { TUNES } from '../core/abctunes.js';
import { createSynth, PRESETS } from '../core/synth.js';
import { saveDoc, exportSvg, exportPng, readText } from '../core/diagramout.js';

const SOUNDS = [['soft-keys', 'Soft keys'], ['pluck', 'Pluck'], ['brass', 'Brass'], ['space-bells', 'Bells'], ['warm-pad', 'Warm pad']]
  .filter(([id]) => PRESETS.some(p => p.id === id));
const TEMPLATE = `X:1
T:My tune
C:me
M:4/4
L:1/4
Q:1/4=100
K:C
C D E F | G2 G2 | A A A A | G4 |]
`;

/**
 * Schedule the notes of `evs` that start in [from, to) whole notes onto a synth:
 * note-on at t0 + (start − origin) × spw, off a hair before the next one.
 * Used live in short windows, and by the tests in one go on an offline context.
 */
export function scheduleWindow(synth, evs, from, to, { t0, spw, origin = 0, tag = 'abc' }) {
  let n = 0;
  for (const e of evs) {
    if (e.start < from || e.start >= to) continue;
    const on = t0 + (e.start - origin) * spw;
    const off = on + Math.max(0.05, e.dur * spw * 0.94);
    const src = `${tag}:${e.voice}:${e.item}:${e.midi}:${e.start}`;
    synth.noteOn(e.midi, 0.8, src, on);
    synth.noteOff(e.midi, src, off);
    n++;
  }
  return n;
}

const CSS = `
.sm{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.sm *{box-sizing:border-box}
.sm__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.sm__b,.sm__sel,.sm__num{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.sm__sel{padding:0 4px}
.sm__num{width:64px;padding:0 6px}
.sm__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.sm__b:disabled{opacity:.4;cursor:default}
.sm__b--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
.sm__b--go:hover:not(:disabled){background:var(--accent);color:var(--accent-ink,#fff);filter:brightness(1.08)}
.sm__lbl{display:flex;align-items:center;gap:5px;font-size:var(--fs-11);color:var(--ink-3)}
.sm__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.sm__mid{flex:1;min-height:0;display:flex}
.sm__edit{flex:0 0 38%;min-width:220px;display:flex;flex-direction:column;border-right:1px solid var(--line-1)}
.sm__ta{flex:1;min-height:0;resize:none;border:0;outline:0;padding:var(--sp-4);background:var(--fill-0);color:var(--ink-0);font:var(--fs-13)/1.55 var(--mono);tab-size:2;white-space:pre;overflow:auto}
.sm__ta:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.sm__warn{max-height:28%;overflow:auto;margin:0;padding:6px var(--sp-4);list-style:none;font-size:var(--fs-11);color:var(--ink-2);border-top:1px solid var(--line-1)}
.sm__warn:empty{display:none}
.sm__warn li::before{content:"! ";color:#e0a020;font-weight:700}
.sm__page{flex:1;min-width:0;overflow:auto;background:var(--fill-1);padding:var(--sp-4)}
.sm__paper{background:#fff;border-radius:6px;box-shadow:0 1px 8px rgba(0,0,0,.25);width:max-content;max-width:100%;margin:0 auto}
.sm__paper svg{display:block;max-width:100%;height:auto}
.sm__paper .n{cursor:pointer}
.sm__paper .n.on *{fill:#e0306a!important;stroke:#e0306a!important}
.sm__paper .n.on ellipse[fill=none]{fill:none!important}
.sm__paper .n .hit,.sm__paper .n.on .hit{fill:none!important;stroke:none!important}
.sm__stat{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.sm__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:720px){.sm__mid{flex-direction:column}.sm__edit{flex:0 0 40%;border-right:0;border-bottom:1px solid var(--line-1)}}
`;

defineApp({
  id: 'sheetmusic',
  name: 'Sheet Music',
  icon: 'music',
  g1: '#f2d9a4', g2: '#b5651d',
  category: 'Create',
  keywords: ['abc', 'abc notation', 'sheet music', 'score', 'notes', 'staff', 'melody', 'tune', 'compose', 'play', 'music', 'folk'],
  desc: 'Write a tune in ABC notation, see it as sheet music, and hear it played',
  handles: ['score'],
  exts: ['abc'],
  win: { w: 1000, h: 660, minW: 560, minH: 400 },
  shortcuts: [
    ['Mod+Enter', 'Play or stop'],
    ['Esc', 'Stop'],
    ['Mod+S', 'Save'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'music', actions) => api.notify({ app: 'Sheet Music', icon, title, message, timeout: actions ? 9000 : 4200, actions });

  const st = { path: null, dirty: false, tune: null, evs: [], marks: [], layout: null, bpm: null, sound: SOUNDS[0][0] };
  const play = { on: false, ac: null, synth: null, master: null, timer: 0, raf: 0, t0: 0, origin: 0, spw: 0.5, cursor: 0, end: 0, lit: new Set() };
  let renderT = 0, saveT = 0, lastW = 0;

  /* ---------------- DOM ---------------- */
  const ta = h('textarea.sm__ta', { 'aria-label': 'ABC notation', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', dataset: { fk: 'sm-text' } });
  const warn = h('ul.sm__warn', { 'aria-label': 'Things in the tune that were skipped' });
  const paper = h('div.sm__paper', { dataset: { fk: 'sm-paper' } });
  const page = h('div.sm__page', paper);
  const live = h('div.sm__sr', { role: 'status', 'aria-live': 'polite' });
  const stat = h('div.sm__stat', { role: 'status' });
  const btn = (label, title, fn, extra) => h('button.sm__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const B = {
    play: btn('Play', 'Play the tune (Ctrl+Enter)', () => toggle(), { class: 'sm__b sm__b--go', 'aria-pressed': 'false', dataset: { fk: 'sm-play' } }),
    new: btn('New', 'Start a new tune', () => newTune()),
    save: btn('Save', 'Save the tune to Documents (Ctrl+S)', () => saveFile(false)),
    png: btn('PNG', 'Put a picture of the page (PNG) in Pictures', () => exportPic('png')),
    svg: btn('SVG', 'Put a vector picture of the page (SVG) in Pictures', () => exportPic('svg')),
  };
  const examples = h('select.sm__sel', { 'aria-label': 'Examples', title: 'Public-domain tunes to start from', dataset: { fk: 'sm-examples' }, onchange: e => { const t = TUNES.find(x => x.id === e.target.value); e.target.value = ''; if (t) loadExample(t); } },
    h('option', { value: '', text: 'Examples…' }), ...TUNES.map(t => h('option', { value: t.id, text: t.name })));
  const sound = h('select.sm__sel', { 'aria-label': 'Sound', title: 'The sound it plays with', dataset: { fk: 'sm-sound' }, onchange: e => { st.sound = e.target.value; if (play.synth) play.synth.setPatch(patchOf()); } },
    ...SOUNDS.map(([id, name]) => h('option', { value: id, text: name })));
  const tempo = h('input.sm__num', { type: 'number', min: '30', max: '300', step: '1', placeholder: 'tune', 'aria-label': 'Beats per minute (empty uses the tune’s own)', title: 'Beats per minute; empty uses the tune’s own', dataset: { fk: 'sm-tempo' }, oninput: () => { const v = Math.round(+tempo.value); st.bpm = v >= 30 && v <= 300 ? v : null; paintStat(); if (play.on) restartFromHere(); } });
  const bar = h('div.sm__bar', { role: 'toolbar', 'aria-label': 'Sheet music tools' }, B.play, h('span.sm__sep'), h('label.sm__lbl', { text: 'Tempo ', title: 'Beats per minute' }, tempo), sound, h('span.sm__sep'), B.new, examples, B.save, B.png, B.svg);
  root.appendChild(h('div.sm', h('style', { text: CSS }), bar, h('div.sm__mid', h('div.sm__edit', ta, warn), page), stat, live));
  const announce = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };

  /* ---------------- reading and drawing ---------------- */
  const patchOf = () => (PRESETS.find(p => p.id === st.sound) || PRESETS[0]).p;
  function reparse() {
    st.tune = parseABC(ta.value);
    st.evs = events(st.tune);
    warn.replaceChildren(...st.tune.warnings.slice(0, 12).map(w => h('li', { text: `Line ${w.line}: ${w.text}` })));
    if (st.tune.lyrics) warn.append(h('li', { text: 'Lyrics (w:) are not shown or sung.' }));
    draw();
    paintStat();
  }
  function draw() {
    const w = Math.max(520, Math.min(940, Math.round(page.clientWidth - 40) || 700));
    lastW = w;
    st.layout = layout(st.tune, { width: w });
    st.marks = st.layout.marks;
    paper.innerHTML = st.layout.svg;
    play.lit.clear();
    if (play.on) markNow(true);
  }
  const bpmNow = () => st.bpm || st.tune.tempo.bpm;
  const spwNow = () => secondsPerWhole({ tempo: { beat: st.tune.tempo.beat, bpm: bpmNow() } });
  function paintStat() {
    const t = st.tune, n = st.evs.length;
    const end = st.evs.reduce((m, e) => Math.max(m, e.start + e.dur), 0);
    const secs = Math.round(end * spwNow());
    const bars = t.voices.reduce((m, v) => Math.max(m, v.items.filter(i => i.t === 'bar').length), 0);
    stat.replaceChildren(h('span', { text: `${n} note${n === 1 ? '' : 's'} to play` }), h('span', { text: n ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} at ${bpmNow()} beats a minute` : '' }),
      h('span', { text: `Key ${t.key.tonic}${t.key.mode === 'major' ? '' : ' ' + t.key.mode} · ${t.meter.sym || `${t.meter.num}/${t.meter.den}`}${bars ? ` · ${bars} bar line${bars === 1 ? '' : 's'}` : ''}` }));
    win.setSubtitle(`${st.path ? vfs.baseName(st.path) : t.title || 'Unsaved tune'}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`);
  }
  const edited = () => {
    st.dirty = true;
    clearTimeout(renderT);
    renderT = setTimeout(() => { if (!dead) { reparse(); if (play.on) restartFromHere(); } }, 220);
    paintStat();
    if (st.path) { clearTimeout(saveT); saveT = setTimeout(() => { if (!dead) saveFile(true); }, 900); }
  };
  on(ta, 'input', edited);

  /* ---------------- playing ---------------- */
  const AC = window.AudioContext || window.webkitAudioContext;
  function volume() {
    const sys = Math.max(0, Math.min(100, Number(api.store.get('prefs.volume', 62)) || 0)) / 100;
    return api.store.get('prefs.muted', false) === true ? 0 : sys;
  }
  function ensureAudio() {
    if (play.ac) { if (play.ac.state === 'suspended') play.ac.resume().catch(() => {}); return true; }
    if (!AC) return false;
    try { play.ac = new AC(); } catch (e) { return false; }
    play.master = play.ac.createGain();
    play.master.gain.value = 0.9 * volume();
    play.master.connect(play.ac.destination);
    return true;
  }
  function startSynth() {
    play.synth?.dispose();
    play.synth = createSynth(play.ac, { patch: patchOf(), maxVoices: 20, destination: play.master });
  }
  /* the first note of this written place, so a click can start there */
  const startOfItem = (v, i) => { const e = st.evs.find(x => x.voice === v && x.item === i); return e ? e.start : null; };
  function start(fromWhole = 0) {
    if (!st.evs.length) { say('Nothing to play', 'Write some notes first.', 'alert'); return; }
    if (!ensureAudio()) { say('No sound', 'This browser cannot play audio here.', 'alert'); return; }
    stopSound();
    startSynth();
    play.on = true;
    play.spw = spwNow();
    play.origin = fromWhole;
    play.t0 = play.ac.currentTime + 0.12;
    play.cursor = fromWhole;
    play.end = st.evs.reduce((m, e) => Math.max(m, e.start + e.dur), 0);
    B.play.textContent = 'Stop'; B.play.setAttribute('aria-pressed', 'true'); B.play.title = B.play.ariaLabel = 'Stop (Ctrl+Enter or Esc)';
    announce('Playing');
    pump();
    play.timer = setInterval(pump, 90);
    tick();
  }
  /* hand the synth the notes that start in the next half second */
  function pump() {
    if (!play.on || dead) return;
    const now = (play.ac.currentTime - play.t0) / play.spw + play.origin;
    const to = now + 0.6 / play.spw;
    if (play.cursor < to) { scheduleWindow(play.synth, st.evs, play.cursor, to, { t0: play.t0, spw: play.spw, origin: play.origin }); play.cursor = to; }
    if (now > play.end + 0.6) stop(true);
  }
  function stopSound() {
    clearInterval(play.timer); play.timer = 0;
    cancelAnimationFrame(play.raf); play.raf = 0;
    if (play.synth) { try { play.synth.allNotesOff(); play.synth.dispose(); } catch (e) { /* already gone */ } play.synth = null; }
  }
  function stop(ended) {
    const was = play.on;
    play.on = false;
    stopSound();
    for (const el of paper.querySelectorAll('.n.on')) el.classList.remove('on');
    play.lit.clear();
    B.play.textContent = 'Play'; B.play.setAttribute('aria-pressed', 'false'); B.play.title = B.play.ariaLabel = 'Play the tune (Ctrl+Enter)';
    if (was) announce(ended ? 'Finished' : 'Stopped');
  }
  const toggle = () => (play.on ? stop(false) : start(0));
  /* after an edit or a tempo change while playing: carry on from about where it is */
  function restartFromHere() {
    if (!play.on) return;
    const now = Math.max(0, (play.ac.currentTime - play.t0) / play.spw + play.origin);
    start(now >= st.evs.reduce((m, e) => Math.max(m, e.start + e.dur), 0) ? 0 : now);
  }
  function markNow(force) {
    if (!play.on) return;
    const now = (play.ac.currentTime - play.t0) / play.spw + play.origin;
    const lit = new Set();
    for (const e of st.evs) if (e.start <= now && e.start + e.dur > now) lit.add(`${e.voice}:${e.item}`);
    const key = [...lit].sort().join();
    if (!force && key === [...play.lit].sort().join()) return;
    for (const el of paper.querySelectorAll('.n.on')) el.classList.remove('on');
    for (const k of lit) { const [v, i] = k.split(':'); paper.querySelector(`.n[data-v="${v}"][data-i="${i}"]`)?.classList.add('on'); }
    play.lit = lit;
    /* keep the sounding note in view */
    const first = paper.querySelector('.n.on');
    if (first) {
      const r = first.getBoundingClientRect(), pr = page.getBoundingClientRect();
      if (r.bottom > pr.bottom - 20 || r.top < pr.top + 10) page.scrollTop += r.top - pr.top - pr.height / 3;
    }
  }
  function tick() { if (!play.on || dead) return; markNow(false); play.raf = requestAnimationFrame(tick); }
  on(paper, 'click', e => {
    const g = e.target.closest?.('.n');
    if (!g) return;
    const w = startOfItem(+g.dataset.v, +g.dataset.i);
    if (w !== null) start(w);
  });
  on(root, 'keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); toggle(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(false); }
    else if (e.key === 'Escape' && play.on) { e.preventDefault(); stop(false); }
  });

  /* ---------------- files ---------------- */
  const stem = () => st.tune?.title || 'My tune';
  async function saveFile(auto) {
    clearTimeout(saveT);
    try {
      const p = await saveDoc(st.path, stem(), 'abc', ta.value);
      if (!st.path) { st.path = p; win.state.reopen = { path: p }; }
      st.dirty = false;
      paintStat();
      if (!auto) say('Saved', p.replace(vfs.HOME, '~'), 'save');
    } catch (err) { say('Could not save', String(err.message || err), 'alert'); }
  }
  async function exportPic(kind) {
    if (!st.layout) return;
    const w = 900;
    const big = layout(st.tune, { width: w });
    try {
      const r = kind === 'svg' ? await exportSvg(big.svg, stem()) : await exportPng(big.svg, big.width, big.height, stem(), 2);
      root.dataset.lastExport = JSON.stringify({ kind, path: r.path, w: r.w || big.width, h: r.h || big.height });
      say(`Exported ${kind.toUpperCase()}`, r.path.replace(vfs.HOME, '~'), 'image');
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }
  function setText(text, path = null) {
    stop(false);
    ta.value = text;
    st.path = path; st.dirty = false;
    if (!path) win.state.reopen = undefined;
    reparse();
  }
  function newTune() { setText(TEMPLATE); st.dirty = false; ta.focus(); announce('New tune'); }
  function loadExample(t) { setText(t.abc); st.dirty = false; paintStat(); announce(`${t.name} loaded`); }

  /* what a test (or a curious person) can ask for */
  root.abcPeek = () => ({ text: ta.value, path: st.path, dirty: st.dirty, playing: play.on, lit: [...play.lit], notes: st.evs.length,
    events: st.evs.map(e => ({ midi: e.midi, start: e.start, dur: e.dur, voice: e.voice, item: e.item })), warnings: st.tune.warnings.map(w => `${w.line}: ${w.text}`), title: st.tune.title,
    key: st.tune.key.tonic, meter: st.tune.meter, bpm: bpmNow(), heads: paper.querySelectorAll('.n').length, systems: new Set(st.marks.map(m => m.sys)).size, acState: play.ac ? play.ac.state : null, acTime: play.ac ? play.ac.currentTime : null,
    stat: stat.textContent });

  /* ---------------- open ---------------- */
  (async () => {
    let text = TEMPLATE, path = null;
    if (opts && opts.path) {
      const t = await readText(opts.path);
      if (t !== null) { text = t; path = vfs.norm(opts.path); win.state.reopen = { path }; } else say('Could not open that file', `${vfs.baseName(opts.path)} is not there.`, 'alert');
    }
    if (dead) return;
    ta.value = text; st.path = path;
    reparse();
    st.dirty = false;
    paintStat();
  })();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (st.tune && Math.abs(Math.round(page.clientWidth - 40) - lastW) > 24 && Math.round(page.clientWidth - 40) >= 520) { clearTimeout(renderT); renderT = setTimeout(() => { if (!dead) draw(); }, 150); } }) : null;
  ro?.observe(page);

  return () => {
    dead = true;
    clearTimeout(renderT); clearTimeout(saveT);
    stop(false);
    if (play.ac) { try { play.ac.close(); } catch (e) { /* closing anyway */ } play.ac = null; }
    if (st.path && st.dirty) { try { vfs.write(st.path, ta.value); } catch (e) { /* closing anyway */ } }
    ro?.disconnect();
    offs.splice(0).forEach(f => f());
  };
}
