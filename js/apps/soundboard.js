/* ============================================================
   soundboard.js — Soundboard: a grid of your own sound buttons.

   A button has a label, a colour, a keyboard key (1–9, Q–P), a
   volume, a play mode and one sound. The sound comes from:
     · a file — any song or recording in ~/Music (Recorder saves
       its takes there) or ~/Recordings, read through core/media.js
     · a quick take on the microphone (up to 10 s). The page says
       why it needs the microphone before the browser asks, the
       take is kept as a real file in ~/Music, and the microphone
       stops the moment the take ends or the window closes
     · a sound effect from Asset Lab's library (IndexedDB 'assets')
   Sounds are decoded once into AudioBuffers and played by
   AudioBufferSourceNodes through one AudioContext, so a press
   starts instantly and the same sound can overlap itself.

   Play modes, per button:
     Overlap  every press starts another copy on top of what plays
     Restart  a press first stops this button's earlier copies
     Cut      a press first stops everything on the board
   Stop all (or Esc) silences every button.

   Per button, too: Loop (press again to stop), a start and end inside the
   sound (trim), a fade in and a fade out, and a pitch in semitones (the
   speed follows the pitch, like a tape). Buttons can be moved, duplicated,
   dropped in from a file dragged onto the board (or from Files), and played
   from a MIDI keyboard or pad controller (js/core/midi.js, off until you
   turn it on): note 36 is the first button, 37 the second, and so on.
   A board can be exported to a file and imported again, taking the sounds
   with it up to a size limit, and a board can be made from a Static Beats
   pattern (each instrument it uses becomes a button, plus its loop).

   Loudness is the OS's own: prefs.volume is the ceiling and
   prefs.muted silences the board (read live, so Settings and
   Control Centre change it immediately). While muted, a press
   starts nothing and the board says so.

   Boards are saved in the OS store (key 'portal.soundboard') — buttons,
   keys, colours and where each sound lives; the audio itself stays
   in the file system / Asset Lab, never copied. Several boards,
   chosen from the title bar.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as db from '../core/db.js';
import { createMidi, describe as describeMidi } from '../core/midi.js';
import { encodeWav } from '../core/wavedit.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-audiotools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audiotools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-audiotools.css';
  document.head.appendChild(l);
}

const KEY = 'portal.soundboard';
const PADDRAG = 'application/x-staticos-pad';
const FXDRAG = 'application/x-staticos-fx';        /* what the Files app puts on a drag */
export const KEYS = '123456789QWERTYUIOP'.split('');
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
const MODES = [
  { id: 'overlap', label: 'Overlap', note: 'Every press starts another copy on top of what is playing.' },
  { id: 'restart', label: 'Restart', note: 'A press stops this button’s earlier copies first.' },
  { id: 'cut', label: 'Cut others', note: 'A press stops everything else on the board first.' },
];
const MAX_PADS = 24;
const MIDI_BASE = 36;                 /* the first button answers to this MIDI note (C2) */
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => `${NOTES[n % 12]}${Math.floor(n / 12) - 1}`;
const MAX_EMBED = 12 * 1024 * 1024;   /* bytes of sound an exported board may carry */
const MAX_TAKE = 10;                  /* seconds of microphone */
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const stemOf = n => { const i = String(n).lastIndexOf('.'); return i > 0 ? String(n).slice(0, i) : String(n); };

function normSrc(s) {
  if (!s || typeof s !== 'object') return null;
  const name = typeof s.name === 'string' ? s.name.slice(0, 80) : '';
  if (s.type === 'file' && typeof s.path === 'string' && s.path) return { type: 'file', path: s.path.slice(0, 600), name };
  if (s.type === 'assetlab' && typeof s.id === 'string' && /^[\w-]{1,80}$/.test(s.id)) return { type: 'assetlab', id: s.id, name };
  return null;
}
function normPad(p, i = 0) {
  p = p && typeof p === 'object' ? p : {};
  return {
    id: typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) ? p.id : uid(),
    label: typeof p.label === 'string' ? p.label.slice(0, 24) : `Button ${i + 1}`,
    color: COLORS.includes(p.color) ? p.color : COLORS[i % COLORS.length],
    key: KEYS.includes(p.key) ? p.key : '',
    mode: MODES.some(m => m.id === p.mode) ? p.mode : 'overlap',
    vol: Number.isFinite(p.vol) ? clamp(Math.round(p.vol), 0, 100) : 100,
    loop: p.loop === true,
    trimIn: Number.isFinite(p.trimIn) ? clamp(p.trimIn, 0, 3600) : 0,
    trimOut: Number.isFinite(p.trimOut) ? clamp(p.trimOut, 0, 3600) : 0,      /* 0 = to the end of the sound */
    fadeIn: Number.isFinite(p.fadeIn) ? clamp(p.fadeIn, 0, 30) : 0,
    fadeOut: Number.isFinite(p.fadeOut) ? clamp(p.fadeOut, 0, 30) : 0,
    pitch: Number.isFinite(p.pitch) ? clamp(Math.round(p.pitch), -12, 12) : 0,
    src: normSrc(p.src),
  };
}
function normBoard(b, i = 0) {
  b = b && typeof b === 'object' ? b : {};
  const pads = (Array.isArray(b.pads) ? b.pads : []).slice(0, MAX_PADS).map(normPad);
  const seen = new Set();
  for (const p of pads) { if (p.key && seen.has(p.key)) p.key = ''; if (p.key) seen.add(p.key); }
  return { id: typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) ? b.id : uid(), name: typeof b.name === 'string' && b.name.trim() ? b.name.slice(0, 40) : `Board ${i + 1}`, pads };
}
function freshBoard(name) {
  return normBoard({ name, pads: Array.from({ length: 8 }, (_, i) => ({ label: `Button ${i + 1}`, color: COLORS[i % COLORS.length], key: KEYS[i] })) });
}
function readData(raw) {
  const boards = (raw && Array.isArray(raw.boards) ? raw.boards : []).slice(0, 20).map(normBoard);
  if (!boards.length) boards.push(freshBoard('My board'));
  const cur = boards.some(b => b.id === raw?.cur) ? raw.cur : boards[0].id;
  return { v: 1, boards, cur };
}

function micProblem(err) {
  const n = err && err.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser blocked the microphone. Allow it for this site (the lock icon beside the address; on a Mac also System Settings › Privacy & Security › Microphone) and try again.';
  if (n === 'NotFoundError') return 'No microphone was found.';
  if (n === 'NotReadableError') return 'The microphone is busy — another app or tab is using it.';
  return `The microphone couldn’t start${err && err.message ? `: ${err.message}` : '.'}`;
}

defineApp({
  id: 'soundboard',
  name: 'Soundboard',
  icon: 'grid',
  g1: '#ff9a62', g2: '#c2255c',
  category: 'Media',
  keywords: ['sound', 'sounds', 'buttons', 'sfx', 'sample', 'samples', 'effects', 'meme', 'play sounds', 'keys', 'pads', 'jingle', 'record sound'],
  desc: 'Buttons for your own sounds, played with a click or a key',
  singleton: true,
  win: { w: 860, h: 600, minW: 420, minH: 360 },
  shortcuts: [
    ['1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / Q / W / E / R / T / Y / U / I / O / P', 'Play the button with that key'],
    ['Esc', 'Stop all sounds'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store, vfs, bus } = api;

    let data = readData(store.get(KEY));
    const S = { editing: null, tab: 'file', msg: '', dead: false };
    const board = () => data.boards.find(b => b.id === data.cur) || data.boards[0];
    const padOf = id => board().pads.find(p => p.id === id);
    function save() { store.set(KEY, { v: 1, cur: data.cur, boards: data.boards }); }

    /* ---------------- audio ---------------- */
    const AC = window.AudioContext || window.webkitAudioContext;
    let ac = null;
    const buffers = new Map();            /* source key -> Promise<AudioBuffer> */
    const voices = new Set();             /* { padId, src, gain } */
    const sysVol = () => clamp(Number(store.get('prefs.volume', 62)) || 0, 0, 100) / 100;
    const sysMuted = () => store.get('prefs.muted', false) === true;
    const audible = () => !sysMuted() && sysVol() > 0;
    function context() {
      if (!AC) return null;
      if (!ac || ac.state === 'closed') ac = new AC();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    const srcKey = s => (s ? `${s.type}:${s.type === 'file' ? s.path : s.id}` : '');

    async function bytesOf(s) {
      if (s.type === 'file') {
        const n = vfs.node(s.path);
        if (!n) throw new Error('That file is no longer there.');
        const blob = await media.blobOf(s.path);
        if (!blob) throw new Error('That file has no audio in this browser.');
        return blob.arrayBuffer();
      }
      const rec = await db.kv('assets').get(`assetlab:${s.id}`);
      if (!rec || !rec.wav) throw new Error('That Asset Lab sound is no longer in its library.');
      const res = await fetch(rec.wav);
      return res.arrayBuffer();
    }
    function bufferFor(s) {
      const k = srcKey(s);
      if (!buffers.has(k)) {
        const c = context();
        if (!c) return Promise.reject(new Error('This browser has no Web Audio.'));
        buffers.set(k, bytesOf(s).then(ab => new Promise((res, rej) => {
          const p = c.decodeAudioData(ab, res, rej);
          if (p && typeof p.then === 'function') p.then(res, rej);
        })).catch(err => { buffers.delete(k); throw err; }));
      }
      return buffers.get(k);
    }

    const pads = new Map();               /* pad id -> { el, main, name, key } */
    function stopVoices(filter) {
      for (const v of [...voices]) {
        if (filter && !filter(v)) continue;
        voices.delete(v);
        try { v.src.onended = null; v.src.stop(); } catch (e) { /* not started */ }
        try { v.src.disconnect(); v.gain.disconnect(); } catch (e) { /* gone */ }
      }
      paintPlaying();
    }
    function paintPlaying() {
      const on = new Set([...voices].map(v => v.padId));
      for (const [id, r] of pads) r.el.classList.toggle('is-playing', on.has(id));
      stopAll.disabled = !voices.size;
    }
    const say = text => { S.msg = text; status.textContent = text; };

    /* let one voice go: a short fade, then stop (a looping button stops this way) */
    function release(v, fade) {
      if (v.releasing) return;
      v.releasing = true;
      const t = ac.currentTime, f = Math.max(0.015, fade || 0);
      try { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(0, t + f); v.src.stop(t + f + 0.01); } catch (e) { stopVoices(x => x === v); }
      paintPlaying();
    }
    async function fire(pad, vel = 1) {
      const r = pads.get(pad.id);
      if (r) { r.el.classList.add('is-hit'); setTimeout(() => r.el.classList.remove('is-hit'), 140); }
      if (!pad.src) { say(`“${pad.label}” has no sound yet. Open its settings (the gear) to choose one.`); return; }
      if (!audible()) { say(sysMuted() ? 'StaticOS is muted, so nothing plays. Unmute it in Control Centre or Settings.' : 'The StaticOS volume is at zero, so nothing plays.'); return; }
      if (pad.loop) {                       /* a looping button is a switch: press again to stop it */
        const live = [...voices].filter(v => v.padId === pad.id && !v.releasing);
        if (live.length) { live.forEach(v => release(v, pad.fadeOut)); say(''); return; }
      }
      if (pad.mode === 'cut') stopVoices(v => true);
      else if (pad.mode === 'restart') stopVoices(v => v.padId === pad.id);
      let buf;
      try { buf = await bufferFor(pad.src); } catch (err) { say(`“${pad.label}” can’t play: ${err?.message || err}`); return; }
      if (S.dead || !audible()) return;
      const from = clamp(pad.trimIn, 0, Math.max(0, buf.duration - 0.01));
      const to = pad.trimOut > 0 ? Math.min(buf.duration, pad.trimOut) : buf.duration;
      if (to - from < 0.005) { say(`“${pad.label}” starts at ${from.toFixed(2)} s but ends at ${to.toFixed(2)} s. Change its start or end in settings.`); return; }
      const c = context();
      const src = c.createBufferSource();
      src.buffer = buf;
      const rate = Math.pow(2, pad.pitch / 12);
      src.playbackRate.value = rate;
      if (pad.loop) { src.loop = true; src.loopStart = from; src.loopEnd = to; }
      const gain = c.createGain();
      /* the OS volume is the ceiling; the button's own volume sits under it */
      const peak = (pad.vol / 100) * sysVol() * vel;
      const t = c.currentTime, wall = (to - from) / rate;
      const fi = Math.min(pad.fadeIn, pad.loop ? 30 : wall / 2), fo = pad.loop ? 0 : Math.min(pad.fadeOut, wall / 2);
      gain.gain.value = fi > 0 ? 0 : peak;           /* set first: the value is what a fade starts from and what tests read */
      if (fi > 0) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(peak, t + fi); } else gain.gain.setValueAtTime(peak, t);
      if (fo > 0) { gain.gain.setValueAtTime(peak, t + Math.max(fi, wall - fo)); gain.gain.linearRampToValueAtTime(0, t + wall); }
      src.connect(gain).connect(c.destination);
      const v = { padId: pad.id, src, gain, vel, releasing: false };
      voices.add(v);
      src.onended = () => { voices.delete(v); try { gain.disconnect(); } catch (e) { /* gone */ } if (!S.dead) paintPlaying(); };
      if (pad.loop) src.start(t, from); else src.start(t, from, to - from);
      bus.emit('soundboard:play', { pad: pad.id });
      say(pad.loop ? `“${pad.label}” loops until you press it again.` : '');
      paintPlaying();
    }
    /* the OS volume changing mid-sound changes what is playing */
    const retune = () => {
      for (const v of voices) { const p = padOf(v.padId); if (p && !v.releasing) { v.gain.gain.cancelScheduledValues(0); v.gain.gain.value = (p.vol / 100) * sysVol() * v.vel; } }
      if (!audible()) stopVoices();
      paintHead();
    };

    /* ---------------- layout ---------------- */
    const boardSel = h('select.select.sb-board', { 'aria-label': 'Board', onchange: e => { data.cur = e.target.value; S.editing = null; save(); paintAll(); } });
    const addPadBtn = h('button.btn.btn--sm.sb-add', { type: 'button', onclick: () => addPad() }, icon('plus'), h('span', { text: 'Add button' }));
    const boardMenu = h('button.btn.btn--sm.sb-boards', { type: 'button', 'aria-label': 'Board options', title: 'Board options', onclick: e => boardOptions(e) }, icon('more-horizontal'));
    const stopAll = h('button.btn.btn--sm.sb-stop', { type: 'button', title: 'Stop all sounds (Esc)', onclick: () => stopVoices() }, icon('square', { fill: true }), h('span', { text: 'Stop all' }));
    const muteChip = h('span.sb-mute', { role: 'status' }, icon('volume-x'), h('span'));
    const midiBtn = h('button.btn.btn--sm.sb-midi', { type: 'button', 'aria-pressed': 'false', title: 'Play the buttons from a MIDI keyboard or pad controller', onclick: () => toggleMidi() }, icon('keyboard'), h('span', { text: 'MIDI' }));
    const bar = h('div.app__bar.sb-bar', icon('grid'), boardSel, boardMenu, h('span.grow'), muteChip, midiBtn, addPadBtn, stopAll);
    const grid = h('div.sb-grid', { role: 'group', 'aria-label': 'Sound buttons' });
    const status = h('div.sb-status', { role: 'status', 'aria-live': 'polite' });
    const side = h('aside.sb-edit', { 'aria-label': 'Button settings', hidden: true });
    const body = h('div.sb-body', h('div.sb-main', grid, status), side);
    const dropHint = h('div.sb-drop', { hidden: true, 'aria-hidden': 'true', text: 'Drop sound files to make buttons' });
    const app = h('div.app.sb', bar, body, dropHint);
    root.appendChild(app);

    function paintHead() {
      boardSel.replaceChildren(...data.boards.map(b => h('option', { value: b.id, text: b.name, selected: b.id === data.cur })));
      const off = !audible();
      muteChip.hidden = !off;
      muteChip.lastChild.textContent = sysMuted() ? 'Muted' : 'Volume is 0';
      addPadBtn.disabled = board().pads.length >= MAX_PADS;
    }

    function padEl(p) {
      let r = pads.get(p.id);
      if (!r) {
        const name = h('b.sb-pad__name');
        const sub = h('small.sb-pad__sub');
        const key = h('kbd.sb-pad__key');
        const main = h('button.sb-pad__main', { type: 'button', onclick: () => { const q = padOf(p.id); if (q) fire(q); } }, key, name, sub);
        const gear = h('button.sb-pad__gear', { type: 'button', 'aria-label': 'Settings', onclick: () => openEditor(p.id) }, icon('settings'));
        const el = h('div.sb-pad', { dataset: { pad: p.id }, draggable: 'true' }, main, gear);
        el.addEventListener('dragstart', e => { try { e.dataTransfer.setData(PADDRAG, p.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* no drag data */ } el.classList.add('is-dragging'); });
        el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); grid.querySelectorAll('.is-over').forEach(n => n.classList.remove('is-over')); });
        el.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes(PADDRAG)) { e.preventDefault(); e.stopPropagation(); el.classList.add('is-over'); } });
        el.addEventListener('dragleave', () => el.classList.remove('is-over'));
        el.addEventListener('drop', e => {
          const id = e.dataTransfer && e.dataTransfer.getData(PADDRAG);
          el.classList.remove('is-over');
          if (!id) return;
          e.preventDefault(); e.stopPropagation();
          movePadTo(id, p.id);
        });
        r = { el, main, name, sub, key, gear };
        pads.set(p.id, r);
      }
      return r;
    }
    function paintPad(p) {
      const r = padEl(p);
      r.el.style.setProperty('--pad', p.color);
      r.name.textContent = p.label || '(no name)';
      r.sub.textContent = p.src ? (p.src.name || stemOf(p.src.path || '') || 'Asset Lab sound') : 'No sound yet';
      r.key.textContent = p.key || '';
      r.key.hidden = !p.key;
      const bi = board().pads.indexOf(p);
      r.el.dataset.midi = String(MIDI_BASE + bi);
      r.el.title = `MIDI note ${MIDI_BASE + bi} (${noteName(MIDI_BASE + bi)})`;
      r.el.classList.toggle('is-loop', !!p.loop);
      r.el.classList.toggle('is-empty', !p.src);
      r.el.classList.toggle('is-editing', S.editing === p.id);
      r.main.setAttribute('aria-label', `${p.label || 'Button'}${p.key ? `, key ${p.key}` : ''}${p.src ? '' : ', no sound yet'}`);
      r.gear.setAttribute('aria-label', `Settings for ${p.label || 'button'}`);
      return r.el;
    }
    function paintGrid() {
      const list = board().pads;
      for (const id of [...pads.keys()]) if (!list.some(p => p.id === id)) pads.delete(id);
      grid.replaceChildren(...list.map(paintPad));
      paintPlaying();
    }
    function paintAll() { paintHead(); paintGrid(); paintEditor(); }

    /* ---------------- boards ---------------- */
    function addPad() {
      const b = board();
      if (b.pads.length >= MAX_PADS) return;
      const used = new Set(b.pads.map(p => p.key));
      const p = normPad({ label: `Button ${b.pads.length + 1}`, color: COLORS[b.pads.length % COLORS.length], key: KEYS.find(k => !used.has(k)) || '' }, b.pads.length);
      b.pads.push(p);
      save();
      paintAll();
      openEditor(p.id);
    }
    function movePadTo(fromId, toId) {
      const list = board().pads, i = list.findIndex(p => p.id === fromId), j = list.findIndex(p => p.id === toId);
      if (i < 0 || j < 0 || i === j) return;
      const [p] = list.splice(i, 1);
      list.splice(j, 0, p);
      save(); paintGrid(); say(`Moved “${p.label}” to place ${j + 1}.`);
    }
    function nudgePad(pad, d) {
      const list = board().pads, i = list.indexOf(pad), j = i + d;
      if (j < 0 || j >= list.length) return;
      list.splice(i, 1); list.splice(j, 0, pad);
      save(); paintGrid(); paintEditor(); say(`“${pad.label}” is now button ${j + 1}.`);
    }
    function duplicatePad(pad) {
      const b = board();
      if (b.pads.length >= MAX_PADS) { say(`A board holds ${MAX_PADS} buttons.`); return; }
      const copy = normPad({ ...pad, id: uid(), key: '', label: `${pad.label} copy`.slice(0, 24) }, b.pads.length);
      b.pads.splice(b.pads.indexOf(pad) + 1, 0, copy);
      save(); paintAll(); openEditor(copy.id);
      say(`Copied “${pad.label}”. The copy has no key yet; pick one in its settings.`);
    }

    /* ---- sound files dropped on the board (from the computer, or dragged out of Files) ---- */
    const isAudioFile = f => /^audio\//.test(f.type) || media.kindOf(f.name) === 'audio';
    async function addDropped({ files, paths }) {
      const b = board();
      let added = 0, skipped = 0, full = 0, bad = 0;
      const room = () => MAX_PADS - b.pads.length;
      const make = (src, name) => {
        const p = normPad({ label: stemOf(name).slice(0, 24), color: COLORS[b.pads.length % COLORS.length], key: KEYS.find(k => !b.pads.some(q => q.key === k)) || '', src }, b.pads.length);
        b.pads.push(p); added++;
      };
      for (const path of paths) {
        const n = vfs.node(path);
        if (!n || n.type !== 'file' || !(n.kind === 'audio' || media.kindOf(n.name) === 'audio')) { bad++; continue; }
        if (!room()) { full++; continue; }
        make({ type: 'file', path: vfs.norm(path), name: stemOf(n.name) }, n.name);
      }
      for (const f of files) {
        if (!isAudioFile(f)) { bad++; continue; }
        if (!room()) { full++; continue; }
        try {
          const saved = await media.save(`${vfs.HOME}/Music`, f.name, f);
          if (saved.node && saved.node.kind !== 'audio') { saved.node.kind = 'audio'; bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
          make({ type: 'file', path: saved.path, name: stemOf(vfs.baseName(saved.path)) }, f.name);
        } catch (err) { skipped++; }
      }
      if (S.dead) return;
      if (added) { save(); paintAll(); }
      say(added ? `Added ${added} button${added === 1 ? '' : 's'}${files.length ? ' (the dropped files were copied into Music)' : ''}.${full ? ` The board is full, so ${full} more did not fit.` : ''}${bad ? ` ${bad} item${bad === 1 ? ' was' : 's were'} not sound files.` : ''}` : full ? `The board is full (${MAX_PADS} buttons).` : skipped ? 'Those files could not be saved.' : 'Those are not sound files, so nothing was added.');
    }
    const dropTypes = e => e.dataTransfer ? [...e.dataTransfer.types] : [];
    const dropOk = e => { const t = dropTypes(e); return t.includes('Files') || t.includes(FXDRAG); };
    let dragDepth = 0;
    app.addEventListener('dragenter', e => { if (dropOk(e)) { dragDepth++; dropHint.hidden = false; } });
    app.addEventListener('dragover', e => { if (dropOk(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    app.addEventListener('dragleave', e => { if (dropOk(e) && --dragDepth <= 0) { dragDepth = 0; dropHint.hidden = true; } });
    app.addEventListener('drop', e => {
      dragDepth = 0; dropHint.hidden = true;
      if (!dropOk(e)) return;
      e.preventDefault();
      const files = [...(e.dataTransfer.files || [])];
      let paths = [];
      try { const raw = e.dataTransfer.getData(FXDRAG); if (raw) paths = (JSON.parse(raw).paths || []).filter(x => typeof x === 'string'); } catch (err) { /* not ours */ }
      addDropped({ files, paths });
    });

    /* ---- export and import ---- */
    const blobToDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    function dataUrlToBlob(url) {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
      if (!m) throw new Error('bad data');
      const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new Blob([u], { type: m[1] || 'application/octet-stream' });
    }
    async function exportBoard() {
      const b = board();
      say('Packing the board…');
      const sounds = {};
      let bytes = 0, packed = 0, left = 0;
      for (const p of b.pads) {
        const s = p.src;
        if (!s) continue;
        if (s.type !== 'file') { left++; continue; }
        if (sounds[s.path]) { continue; }
        try {
          const blob = vfs.node(s.path) ? await media.blobOf(s.path) : null;
          if (!blob || bytes + blob.size > MAX_EMBED) { left++; continue; }
          sounds[s.path] = { name: vfs.baseName(s.path), data: await blobToDataUrl(blob) };
          bytes += blob.size; packed++;
        } catch (err) { left++; }
      }
      if (S.dead) return;
      const doc = { format: 'staticos-soundboard', v: 1, board: { name: b.name, pads: b.pads }, sounds };
      const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${b.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'board'}.staticboard.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say(`Exported “${b.name}”: ${b.pads.length} button${b.pads.length === 1 ? '' : 's'}, ${packed} sound${packed === 1 ? '' : 's'} inside the file (${(bytes / 1048576).toFixed(1)} MB).${left ? ` ${left} sound${left === 1 ? ' is' : 's are'} not inside it (Asset Lab sounds, missing files, or past the ${MAX_EMBED / 1048576} MB limit); those buttons keep their place and will say so when pressed.` : ''}`);
    }
    async function importBoardFile(file) {
      if (!file) return;
      if (data.boards.length >= 20) { say('There are already 20 boards. Delete one first.'); return; }
      if (file.size > 60 * 1048576) { say('That file is too big to be a board.'); return; }
      let doc;
      try { doc = JSON.parse(await file.text()); } catch (err) { say('That file is not a Soundboard export.'); return; }
      if (!doc || doc.format !== 'staticos-soundboard' || !doc.board || !Array.isArray(doc.board.pads)) { say('That file is not a Soundboard export.'); return; }
      const nb = normBoard({ ...doc.board, id: uid(), pads: doc.board.pads.map(p => ({ ...(p || {}), id: uid() })) }, data.boards.length);
      const sounds = doc.sounds && typeof doc.sounds === 'object' ? doc.sounds : {};
      const map = new Map();
      let kept = 0, missing = 0;
      for (const p of nb.pads) {
        const sr = p.src;
        if (!sr || sr.type !== 'file') { if (sr) missing++; continue; }
        const orig = (doc.board.pads.find(q => q && q.src && q.src.path === sr.path) || {}).src;
        const entry = orig && sounds[orig.path];
        if (!entry || typeof entry.data !== 'string') { missing++; continue; }
        if (!map.has(orig.path)) {
          try {
            const blob = dataUrlToBlob(entry.data);
            const nm = String(entry.name || 'sound').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'sound';
            const saved = await media.save(`${vfs.HOME}/Music`, nm, blob);
            if (saved.node && saved.node.kind !== 'audio') { saved.node.kind = 'audio'; bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
            map.set(orig.path, saved.path); kept++;
          } catch (err) { map.set(orig.path, null); }
        }
        const np = map.get(orig.path);
        if (np) p.src = { type: 'file', path: np, name: sr.name }; else missing++;
      }
      if (S.dead) return;
      data.boards.push(nb); data.cur = nb.id; S.editing = null;
      save(); paintAll();
      say(`Imported “${nb.name}” with ${nb.pads.length} button${nb.pads.length === 1 ? '' : 's'}; ${kept} sound${kept === 1 ? ' was' : 's were'} saved into Music.${missing ? ` ${missing} button${missing === 1 ? ' has' : 's have'} no sound with it: choose one in its settings.` : ''}`);
    }
    const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Choose a board file', onchange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importBoardFile(f); } });
    app.appendChild(importInput);

    /* ---- a board from a Static Beats pattern ---- */
    function beatsPatterns() {
      const d = store.get('portal.beats');
      const list = d && Array.isArray(d.patterns) ? d.patterns.filter(p => p && typeof p.id === 'string') : [];
      const out = list.map(p => ({ name: String(p.name || 'Pattern').slice(0, 40), pat: p }));
      if (d && d.last && typeof d.last === 'object' && d.last.steps) out.push({ name: 'Beats, as you left it', pat: { ...d.last, id: 'last' } });
      return out;
    }
    function beatsBoardMenu(e) {
      if (data.boards.length >= 20) { say('There are already 20 boards. Delete one first.'); return; }
      const items = beatsPatterns();
      if (!items.length) { say('There are no Beats patterns yet. Make one in Static Beats and press Save, then come back.'); return; }
      const r = (e && e.currentTarget && e.currentTarget.getBoundingClientRect) ? e.currentTarget.getBoundingClientRect() : boardMenu.getBoundingClientRect();
      api.menu(items.map(it => ({ label: it.name, icon: 'grid', onClick: () => boardFromBeats(it) })), r.left, r.bottom + 4);
    }
    async function boardFromBeats(it) {
      say('Drawing the sounds…');
      try {
        const R = await import('../core/beatsrender.js');
        const used = await R.instrumentsOf(it.pat);
        if (!used.length) { say(`“${it.name}” has no hits to turn into buttons.`); return; }
        const rate = 44100, stampN = it.name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 30) || 'Beats';
        const save1 = async (clip, fname) => {
          const saved = await media.save(`${vfs.HOME}/Music`, fname, new Blob([encodeWav({ rate, ch: [clip] })], { type: 'audio/wav' }));
          if (saved.node && saved.node.kind !== 'audio') { saved.node.kind = 'audio'; bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
          return saved.path;
        };
        const nb = freshBoard(`Beats: ${it.name}`.slice(0, 40));
        nb.pads = [];
        const bar = await R.renderPattern(it.pat, 0.01, rate);                  /* only for its bar length, used below */
        const loop = await R.renderPattern(it.pat, bar.barSeconds, rate);
        nb.pads.push(normPad({ label: 'Loop', color: COLORS[0], key: KEYS[0], loop: true, mode: 'overlap', src: { type: 'file', path: await save1(loop.data, `Beats ${stampN} - loop.wav`), name: `${stampN} loop` } }, 0));
        for (const inst of used) {
          if (nb.pads.length >= MAX_PADS) break;
          const k = nb.pads.length;
          const clip = await R.renderVoice(inst.id, rate);
          nb.pads.push(normPad({ label: inst.name, color: COLORS[k % COLORS.length], key: KEYS[k], mode: 'restart', src: { type: 'file', path: await save1(clip, `Beats ${stampN} - ${inst.name}.wav`), name: `${stampN} ${inst.name}` } }, k));
        }
        if (S.dead) return;
        data.boards.push(nb); data.cur = nb.id; S.editing = null; save(); paintAll();
        say(`Made “${nb.name}”: a Loop button (one bar at ${loop.bpm} BPM) and one button for each of ${used.length} instrument${used.length === 1 ? '' : 's'}. The sounds are WAV files in Music.`);
      } catch (err) { say('Could not make the board: ' + (err && err.message || err)); }
    }

    /* ---- MIDI ---- */
    let midiState = { status: 'off', inputs: [], reason: '' };
    const midi = createMidi({
      onEvent: ev => {
        if (S.dead) return;
        if (ev.type === 'on') {
          const pad = board().pads[ev.note - MIDI_BASE];
          if (pad) fire(pad, 0.12 + 0.88 * ev.vel);
        } else if (ev.type === 'allOff') stopVoices();
      },
      onChange: st => {
        midiState = st;
        midiBtn.setAttribute('aria-pressed', String(st.status === 'on' || st.status === 'asking'));
        midiBtn.classList.toggle('is-on', st.status === 'on');
        say(describeMidi(st) + (st.status === 'on' ? ` Notes ${MIDI_BASE} to ${MIDI_BASE + board().pads.length - 1} play the buttons in order.` : ''));
      },
    });
    function toggleMidi() { if (midiState.status === 'on' || midiState.status === 'asking') midi.disable(); else midi.enable(); }

    function boardOptions(e) {
      const r = e.currentTarget.getBoundingClientRect();
      api.menu([
        { label: 'New board', icon: 'plus', onClick: () => { const b = freshBoard(`Board ${data.boards.length + 1}`); data.boards.push(b); data.cur = b.id; S.editing = null; save(); paintAll(); } },
        { label: 'Rename board…', icon: 'edit-3', onClick: () => renameBoard() },
        { label: 'Export board…', icon: 'download', onClick: () => exportBoard() },
        { label: 'Import board…', icon: 'upload', onClick: () => importInput.click() },
        { label: 'New board from a Beats pattern…', icon: 'grid', onClick: () => beatsBoardMenu({ currentTarget: boardMenu }) },
        { label: 'Delete board', icon: 'trash', danger: true, disabled: data.boards.length < 2, onClick: () => {
          const gone = board();
          stopVoices();
          data.boards = data.boards.filter(b => b !== gone);
          data.cur = data.boards[0].id;
          S.editing = null;
          save();
          paintAll();
          say(`Deleted “${gone.name}”. The sounds themselves are still in your files.`);
        } },
      ], r.left, r.bottom + 4);
    }
    function renameBoard() {
      const inp = h('input.input.sb-board__rename', { type: 'text', value: board().name, maxlength: '40', 'aria-label': 'Board name' });
      const done = ok => {
        if (!inp.isConnected) return;
        const v = inp.value.trim();
        if (ok && v) { board().name = v.slice(0, 40); save(); }
        inp.replaceWith(boardSel);
        paintHead();
        boardSel.focus();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
      inp.addEventListener('blur', () => done(true));
      boardSel.replaceWith(inp);
      inp.focus(); inp.select();
    }

    /* ---------------- the settings panel ---------------- */
    let take = null;                       /* the microphone take in progress */
    function endTake() {
      if (!take) return;
      const t = take;
      take = null;
      clearInterval(t.timer);
      try { if (t.mr.state !== 'inactive') t.mr.stop(); } catch (e) { /* stopped */ }
      t.stream.getTracks().forEach(tr => { try { tr.stop(); } catch (e) { /* stopped */ } });
    }
    function openEditor(id) {
      if (S.editing !== id) { endTake(); S.tab = 'file'; }
      S.editing = id;
      paintGrid();
      paintEditor();
      side.querySelector('input.sb-label')?.focus();
    }
    function closeEditor() { endTake(); S.editing = null; paintGrid(); paintEditor(); }

    function audioFiles() {
      const out = [];
      for (const dir of [`${vfs.HOME}/Music`, `${vfs.HOME}/Recordings`]) {
        if (!vfs.node(dir)) continue;
        vfs.walk(dir, (n, path) => { if (n.type === 'file' && (media.kindOf(n.name) === 'audio' || n.kind === 'audio')) out.push({ name: n.name, path }); }, 4);
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    function setSource(pad, src) {
      pad.src = src;
      if (src && (!pad.label || /^Button \d+$/.test(pad.label))) pad.label = stemOf(src.name || '').slice(0, 24) || pad.label;
      save();
      paintGrid();
      paintEditor();
    }

    function paintEditor() {
      const pad = S.editing ? padOf(S.editing) : null;
      side.hidden = !pad;
      app.classList.toggle('has-edit', !!pad);
      if (!pad) { side.replaceChildren(); return; }

      const label = h('input.input.sb-label', { type: 'text', value: pad.label, maxlength: '24', 'aria-label': 'Label',
        oninput: e => { pad.label = e.target.value; save(); paintPad(pad); } });
      const colors = h('div.sb-colors', { role: 'radiogroup', 'aria-label': 'Colour' }, COLORS.map(c => h('button.sb-color', {
        type: 'button', role: 'radio', 'aria-checked': String(pad.color === c), 'aria-label': c, style: { background: c },
        onclick: () => { pad.color = c; save(); paintPad(pad); paintEditor(); },
      })));
      const keySel = h('select.select.sb-key', { 'aria-label': 'Keyboard key', onchange: e => {
        const k = e.target.value;
        if (k) for (const p of board().pads) if (p !== pad && p.key === k) p.key = '';   /* a key plays one button */
        pad.key = k; save(); paintGrid();
      } }, h('option', { value: '', text: 'No key' }), KEYS.map(k => h('option', { value: k, text: k, selected: pad.key === k })));
      const modeBtns = h('div.sb-modes', { role: 'radiogroup', 'aria-label': 'When pressed again' }, MODES.map(m => h('button.sb-modebtn', {
        type: 'button', role: 'radio', 'aria-checked': String(pad.mode === m.id), title: m.note, dataset: { mode: m.id },
        onclick: () => { pad.mode = m.id; save(); paintEditor(); },
      }, m.label)));
      const vol = h('input.slider.sb-vol', { type: 'range', min: '0', max: '100', step: '1', value: String(pad.vol), 'aria-label': 'Button volume',
        oninput: e => { pad.vol = Number(e.target.value); volOut.textContent = `${pad.vol}%`; for (const v of voices) if (v.padId === pad.id && !v.releasing) { v.gain.gain.cancelScheduledValues(0); v.gain.gain.value = (pad.vol / 100) * sysVol() * v.vel; } },
        onchange: () => save() });
      const volOut = h('span.sb-volout', { text: `${pad.vol}%` });

      const stop = e => e.stopPropagation();
      const secField = (label, key, max, hint) => h('label.sb-field.sb-sec', h('span', { text: label }), h('input.input', {
        type: 'number', min: '0', max: String(max), step: '0.05', value: pad[key] ? String(pad[key]) : '', placeholder: hint, 'aria-label': label, onkeydown: stop,
        onchange: e => { const v = Number(e.target.value); pad[key] = Number.isFinite(v) && v > 0 ? clamp(v, 0, max) : 0; e.target.value = pad[key] ? String(pad[key]) : ''; save(); } }));
      const loopSw = h('button.switch' + (pad.loop ? '.is-on' : ''), { type: 'button', role: 'switch', 'aria-checked': String(pad.loop), 'aria-label': 'Loop', onclick: () => { pad.loop = !pad.loop; if (!pad.loop) stopVoices(v => v.padId === pad.id); save(); paintGrid(); paintEditor(); } });
      const pitchOut = h('span.sb-volout', { text: `${pad.pitch > 0 ? '+' : ''}${pad.pitch} st` });
      const pitch = h('input.slider.sb-pitch', { type: 'range', min: '-12', max: '12', step: '1', value: String(pad.pitch), 'aria-label': 'Pitch in semitones',
        oninput: e => { pad.pitch = Number(e.target.value); pitchOut.textContent = `${pad.pitch > 0 ? '+' : ''}${pad.pitch} st`; for (const v of voices) if (v.padId === pad.id) v.src.playbackRate.value = Math.pow(2, pad.pitch / 12); },
        onchange: () => save() });
      const durOut = h('small.sb-dur');
      if (pad.src) bufferFor(pad.src).then(b => { if (durOut.isConnected) durOut.textContent = `The sound is ${b.duration.toFixed(2)} s long.`; }).catch(() => {});
      const shape = h('div.sb-shape', { role: 'group', 'aria-label': 'Loop, trim, fade and pitch' },
        h('div.sb-field', h('span', { text: 'Loop' }), h('span.sb-volrow', loopSw, h('small', { text: pad.loop ? 'Press the button again to stop it.' : 'Off: plays once.' }))),
        h('div.sb-two', secField('Start (s)', 'trimIn', 3600, '0'), secField('End (s)', 'trimOut', 3600, 'the end')),
        h('div.sb-two', secField('Fade in (s)', 'fadeIn', 30, '0'), secField('Fade out (s)', 'fadeOut', 30, '0')),
        durOut,
        h('label.sb-field', h('span', { text: 'Pitch' }), h('span.sb-volrow', pitch, pitchOut), h('small', { text: 'Speed follows pitch, like a tape.' })));
      const tabs = h('div.sb-tabs', { role: 'tablist', 'aria-label': 'Where the sound comes from' }, [['file', 'folder', 'File'], ['mic', 'mic', 'Record'], ['assetlab', 'sparkles', 'Asset Lab']].map(([id, ic, name]) =>
        h('button.sb-tab', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), dataset: { tab: id }, onclick: () => { endTake(); S.tab = id; paintEditor(); } }, icon(ic), h('span', { text: name }))));
      const pane = h('div.sb-pane', { role: 'tabpanel' });
      if (S.tab === 'file') filePane(pane, pad);
      else if (S.tab === 'mic') micPane(pane, pad);
      else assetPane(pane, pad);

      const test = h('button.btn.btn--sm', { type: 'button', onclick: () => fire(pad), disabled: !pad.src }, icon('play', { fill: true }), h('span', { text: 'Test' }));
      const del = h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => {
        stopVoices(v => v.padId === pad.id);
        board().pads = board().pads.filter(p => p !== pad);
        S.editing = null; endTake(); save(); paintAll();
      } }, icon('trash'), h('span', { text: 'Delete' }));
      side.replaceChildren(
        h('div.sb-edit__head', h('b', { text: 'Button settings' }), h('button.ibtn', { type: 'button', 'aria-label': 'Close settings', onclick: closeEditor }, icon('x'))),
        h('label.sb-field', h('span', { text: 'Label' }), label),
        h('div.sb-field', h('span', { text: 'Colour' }), colors),
        h('label.sb-field', h('span', { text: 'Key' }), keySel),
        h('div.sb-field', h('span', { text: 'Sound' }), h('div.sb-cur', pad.src ? [icon(pad.src.type === 'assetlab' ? 'sparkles' : 'music'), h('span', { text: pad.src.name || stemOf(pad.src.path || '') })] : h('i', { text: 'None yet — choose one below' }))),
        tabs, pane,
        h('div.sb-field', h('span', { text: 'When pressed' }), modeBtns, h('small', { text: MODES.find(m => m.id === pad.mode).note })),
        h('label.sb-field', h('span', { text: 'Volume' }), h('span.sb-volrow', vol, volOut)),
        shape,
        h('div.sb-field', h('span', { text: 'MIDI note' }), h('small', { text: `Played by note ${MIDI_BASE + board().pads.indexOf(pad)} (${noteName(MIDI_BASE + board().pads.indexOf(pad))}) when MIDI is on.` })),
        h('div.sb-edit__acts', test, h('span.grow'), del),
        h('div.sb-edit__acts', h('button.btn.btn--sm.sb-dup', { type: 'button', onclick: () => duplicatePad(pad) }, icon('copy'), h('span', { text: 'Duplicate' })),
          h('button.btn.btn--sm.sb-earlier', { type: 'button', disabled: board().pads.indexOf(pad) === 0, 'aria-label': 'Move earlier', onclick: () => nudgePad(pad, -1) }, icon('chevron-left'), h('span', { text: 'Earlier' })),
          h('button.btn.btn--sm.sb-later', { type: 'button', disabled: board().pads.indexOf(pad) === board().pads.length - 1, 'aria-label': 'Move later', onclick: () => nudgePad(pad, 1) }, h('span', { text: 'Later' }), icon('chevron-right'))));
      colors.querySelectorAll('.sb-color').forEach((b, i) => b.setAttribute('aria-checked', String(COLORS[i] === pad.color)));
    }

    function filePane(pane, pad) {
      const files = audioFiles();
      if (!files.length) {
        pane.append(h('p.sb-hint', { text: 'No songs or recordings yet. Record something in Static Recorder, or import songs in Music — they’re kept in ~/Music and show up here.' }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('recorder') }, icon('mic'), h('span', { text: 'Open Recorder' })));
        return;
      }
      pane.append(h('div.sb-list', { role: 'listbox', 'aria-label': 'Sounds in your files' }, files.map(f => h('button.sb-item', {
        type: 'button', role: 'option', 'aria-selected': String(pad.src?.type === 'file' && pad.src.path === f.path), dataset: { path: f.path },
        title: f.path, onclick: () => setSource(pad, { type: 'file', path: f.path, name: stemOf(f.name) }),
      }, icon('music'), h('span.trunc', { text: stemOf(f.name) })))));
    }

    function assetPane(pane, pad) {
      const list = h('div.sb-list', { role: 'listbox', 'aria-label': 'Asset Lab sounds' }, h('p.sb-hint', { text: 'Looking in Asset Lab…' }));
      pane.append(list);
      db.kv('assets').all().then(all => {
        if (S.dead || !list.isConnected) return;
        const sounds = (all || []).filter(v => v && v.app === 'assetlab' && v.kind === 'sound' && v.wav).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (!sounds.length) {
          list.replaceChildren(h('p.sb-hint', { text: 'No Asset Lab sounds yet. Make one in the Sound tab and press Save — it appears here.' }),
            h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('assetlab', { tab: 'sound' }) }, icon('sparkles'), h('span', { text: 'Open Asset Lab' })));
          return;
        }
        list.replaceChildren(...sounds.map(s => h('button.sb-item', {
          type: 'button', role: 'option', 'aria-selected': String(pad.src?.type === 'assetlab' && pad.src.id === s.id), dataset: { asset: s.id },
          onclick: () => setSource(pad, { type: 'assetlab', id: s.id, name: s.name || 'sound' }),
        }, icon('sparkles'), h('span.trunc', { text: s.name || 'sound' }), h('small', { text: `${(s.dur || 0).toFixed(2)} s` }))));
      }).catch(() => { if (list.isConnected) list.replaceChildren(h('p.sb-hint', { text: 'Asset Lab’s library couldn’t be read.' })); });
    }

    function micPane(pane, pad) {
      const out = h('div.sb-take', { role: 'status' });
      const btn = h('button.btn.btn--sm.sb-rec', { type: 'button' });
      const paintBtn = () => { btn.replaceChildren(icon(take ? 'square' : 'mic', { fill: !!take }), h('span', { text: take ? 'Stop' : 'Record a sound' })); };
      paintBtn();
      pane.append(
        h('p.sb-hint', { text: `Record up to ${MAX_TAKE} seconds on your microphone. Your browser asks for permission when you press the button; the microphone turns off when the take ends, and the take is kept as a file in ~/Music.` }),
        btn, out);
      btn.onclick = async () => {
        if (take) { take.mr.stop(); return; }
        const md = navigator.mediaDevices;
        if (!md || !md.getUserMedia || typeof MediaRecorder === 'undefined') { out.textContent = 'This browser can’t record from a microphone here.'; return; }
        btn.disabled = true;
        out.textContent = 'Waiting for the browser’s microphone question…';
        let stream;
        try { stream = await md.getUserMedia({ audio: true }); } catch (err) { btn.disabled = false; if (!S.dead) out.textContent = micProblem(err); return; }
        if (S.dead || !btn.isConnected || S.editing !== pad.id) { stream.getTracks().forEach(t => t.stop()); return; }
        const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
        /* a recorder that won't take this stream (or won't start) used to throw
           out of this handler: the microphone stayed on, the button stayed
           disabled and the board said "Waiting…" for ever */
        const giveUp = err => {
          stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* stopped */ } });
          if (take && take.stream === stream) { clearInterval(take.timer); take = null; }
          btn.disabled = false; paintBtn();
          out.textContent = `The recording couldn’t start${err && err.message ? `: ${err.message}` : '.'}`;
        };
        let mr;
        try { mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (err) { giveUp(err); return; }
        const chunks = [];
        const t0 = Date.now();
        take = { mr, stream, timer: 0 };
        const mine = take;
        mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = async () => {
          clearInterval(mine.timer);
          stream.getTracks().forEach(t => t.stop());               /* the microphone light goes off here */
          if (take === mine) take = null;
          if (S.dead) return;
          if (btn.isConnected) { btn.disabled = false; paintBtn(); }
          const blob = new Blob(chunks, { type: mr.mimeType || type });
          if (!blob.size) { out.textContent = 'Nothing was recorded.'; return; }
          try {
            const ext = /ogg/.test(blob.type) ? 'ogg' : /mp4/.test(blob.type) ? 'm4a' : 'weba';
            const name = `Soundboard ${pad.label || 'sound'} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`;
            const saved = await media.save(`${vfs.HOME}/Music`, name, blob);
            if (saved.node && saved.node.kind !== 'audio') { saved.node.kind = 'audio'; bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
            if (S.dead) return;
            setSource(pad, { type: 'file', path: saved.path, name: stemOf(vfs.baseName(saved.path)) });
            say(`Saved the take as ${vfs.baseName(saved.path)} in Music.`);
          } catch (err) { if (!S.dead) { const o = side.querySelector('.sb-take'); if (o) o.textContent = `The take couldn’t be saved: ${err?.message || err}`; } }
        };
        try { mr.start(); } catch (err) { giveUp(err); return; }
        btn.disabled = false;
        paintBtn();
        const tick = () => {
          const s = (Date.now() - t0) / 1000;
          out.textContent = `Recording… ${s.toFixed(1)} s`;
          if (s >= MAX_TAKE && mr.state !== 'inactive') mr.stop();
        };
        tick();
        mine.timer = setInterval(tick, 100);
      };
    }

    /* ---------------- keys ---------------- */
    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { if (voices.size) { e.preventDefault(); stopVoices(); } return; }
      const k = e.key.length === 1 ? e.key.toUpperCase() : '';
      if (!k || !KEYS.includes(k)) return;
      const pad = board().pads.find(p => p.key === k);
      if (!pad) return;
      e.preventDefault();
      if (e.repeat) return;
      fire(pad);
    };
    window.addEventListener('keydown', onKey);

    const offs = [store.sub('prefs', retune)];
    offs.push(store.sub(KEY, () => {                 /* another Soundboard window, or a restore */
      const raw = store.get(KEY);
      if (JSON.stringify(raw?.boards) === JSON.stringify(data.boards) && raw?.cur === data.cur) return;
      data = readData(raw);
      if (S.editing && !padOf(S.editing)) S.editing = null;
      paintAll();
    }));
    /* a file renamed or deleted in Files: the button keeps its path, so play() says it is gone */
    paintAll();
    if (!store.get(KEY)) save();

    /* another app hands a file over (Static Beats' "Send to Soundboard"): it becomes a button, once */
    function addFromFile(path) {
      const b = board();
      if (typeof path !== 'string' || !vfs.node(path)) return;
      const have = b.pads.find(p => p.src && p.src.type === 'file' && p.src.path === path);
      if (have) { openEditor(have.id); return; }
      if (b.pads.length >= MAX_PADS) { say('This board is full. Delete a button or start a new board first.'); return; }
      const used = new Set(b.pads.map(p => p.key));
      const p = normPad({ label: stemOf(vfs.baseName(path)).slice(0, 24), color: COLORS[b.pads.length % COLORS.length], key: KEYS.find(k => !used.has(k)) || '', src: { type: 'file', path, name: stemOf(vfs.baseName(path)) } }, b.pads.length);
      b.pads.push(p);
      save(); paintAll(); openEditor(p.id);
    }
    if (win.onReopen) win.onReopen(o => { if (o && o.addFile) addFromFile(o.addFile); });
    if (ctx.opts && ctx.opts.addFile) addFromFile(ctx.opts.addFile);

    return () => {
      S.dead = true;
      window.removeEventListener('keydown', onKey);
      offs.forEach(off => { try { off(); } catch (e) { /* off */ } });
      endTake();
      try { midi.disable(); } catch (e) { /* off */ }
      stopVoices();
      if (ac) { try { ac.close(); } catch (e) { /* closed */ } ac = null; }
      buffers.clear();
    };
  },
});
