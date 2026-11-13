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

if (typeof document !== 'undefined' && !document.getElementById('feat-audiotools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audiotools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-audiotools.css';
  document.head.appendChild(l);
}

const KEY = 'portal.soundboard';
export const KEYS = '123456789QWERTYUIOP'.split('');
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
const MODES = [
  { id: 'overlap', label: 'Overlap', note: 'Every press starts another copy on top of what is playing.' },
  { id: 'restart', label: 'Restart', note: 'A press stops this button’s earlier copies first.' },
  { id: 'cut', label: 'Cut others', note: 'A press stops everything else on the board first.' },
];
const MAX_PADS = 24;
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

    async function fire(pad) {
      const r = pads.get(pad.id);
      if (r) { r.el.classList.add('is-hit'); setTimeout(() => r.el.classList.remove('is-hit'), 140); }
      if (!pad.src) { say(`“${pad.label}” has no sound yet. Open its settings (the gear) to choose one.`); return; }
      if (!audible()) { say(sysMuted() ? 'StaticOS is muted, so nothing plays. Unmute it in Control Centre or Settings.' : 'The StaticOS volume is at zero, so nothing plays.'); return; }
      if (pad.mode === 'cut') stopVoices(v => true);
      else if (pad.mode === 'restart') stopVoices(v => v.padId === pad.id);
      let buf;
      try { buf = await bufferFor(pad.src); } catch (err) { say(`“${pad.label}” can’t play: ${err?.message || err}`); return; }
      if (S.dead || !audible()) return;
      const c = context();
      const src = c.createBufferSource();
      src.buffer = buf;
      const gain = c.createGain();
      /* the OS volume is the ceiling; the button's own volume sits under it */
      gain.gain.value = (pad.vol / 100) * sysVol();
      src.connect(gain).connect(c.destination);
      const v = { padId: pad.id, src, gain };
      voices.add(v);
      src.onended = () => { voices.delete(v); try { gain.disconnect(); } catch (e) { /* gone */ } if (!S.dead) paintPlaying(); };
      src.start();
      bus.emit('soundboard:play', { pad: pad.id });
      say('');
      paintPlaying();
    }
    /* the OS volume changing mid-sound changes what is playing */
    const retune = () => {
      for (const v of voices) { const p = padOf(v.padId); if (p) v.gain.gain.value = (p.vol / 100) * sysVol(); }
      if (!audible()) stopVoices();
      paintHead();
    };

    /* ---------------- layout ---------------- */
    const boardSel = h('select.select.sb-board', { 'aria-label': 'Board', onchange: e => { data.cur = e.target.value; S.editing = null; save(); paintAll(); } });
    const addPadBtn = h('button.btn.btn--sm.sb-add', { type: 'button', onclick: () => addPad() }, icon('plus'), h('span', { text: 'Add button' }));
    const boardMenu = h('button.btn.btn--sm.sb-boards', { type: 'button', 'aria-label': 'Board options', title: 'Board options', onclick: e => boardOptions(e) }, icon('more-horizontal'));
    const stopAll = h('button.btn.btn--sm.sb-stop', { type: 'button', title: 'Stop all sounds (Esc)', onclick: () => stopVoices() }, icon('square', { fill: true }), h('span', { text: 'Stop all' }));
    const muteChip = h('span.sb-mute', { role: 'status' }, icon('volume-x'), h('span'));
    const bar = h('div.app__bar.sb-bar', icon('grid'), boardSel, boardMenu, h('span.grow'), muteChip, addPadBtn, stopAll);
    const grid = h('div.sb-grid', { role: 'group', 'aria-label': 'Sound buttons' });
    const status = h('div.sb-status', { role: 'status', 'aria-live': 'polite' });
    const side = h('aside.sb-edit', { 'aria-label': 'Button settings', hidden: true });
    const body = h('div.sb-body', h('div.sb-main', grid, status), side);
    const app = h('div.app.sb', bar, body);
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
        const el = h('div.sb-pad', { dataset: { pad: p.id } }, main, gear);
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
    function boardOptions(e) {
      const r = e.currentTarget.getBoundingClientRect();
      api.menu([
        { label: 'New board', icon: 'plus', onClick: () => { const b = freshBoard(`Board ${data.boards.length + 1}`); data.boards.push(b); data.cur = b.id; S.editing = null; save(); paintAll(); } },
        { label: 'Rename board…', icon: 'edit-3', onClick: () => renameBoard() },
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
        oninput: e => { pad.vol = Number(e.target.value); volOut.textContent = `${pad.vol}%`; for (const v of voices) if (v.padId === pad.id) v.gain.gain.value = (pad.vol / 100) * sysVol(); },
        onchange: () => save() });
      const volOut = h('span.sb-volout', { text: `${pad.vol}%` });

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
        h('div.sb-edit__acts', test, h('span.grow'), del));
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

    return () => {
      S.dead = true;
      window.removeEventListener('keydown', onKey);
      offs.forEach(off => { try { off(); } catch (e) { /* off */ } });
      endTake();
      stopVoices();
      if (ac) { try { ac.close(); } catch (e) { /* closed */ } ac = null; }
      buffers.clear();
    };
  },
});
