/* ============================================================
   clipeditor.js — "Make a movie", opened from Videos (#952).

   openClipEditor({ api, host, first, onOpenFile, onClose }) lays a panel
   over the Videos window:

   · a list of pieces, in order: video clips (each with its own start and
     end, m:ss.s) and title cards (words, how long, a colour). Move them
     up and down, remove them.
   · music: only the person's own sound — a file in ~/Music (which is
     where Static Beats and Synth exports are saved, and Recorder's voice
     memos) or one picked from their computer — with a volume. Nothing
     is offered from anywhere else.
   · "Make the movie" joins it all with core/moviecut.js. That re-encodes
     in real time, as the movie plays through once out of sight, so it
     takes as long as the movie is, and the result is a new WebM in
     ~/Videos. The originals are only read.
   ============================================================ */
import * as VC from '../core/videocut.js';
import * as MC from '../core/moviecut.js';
import * as media from '../core/media.js';
import vfs from '../core/vfs.js';

const pad = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
let uid = 0;

export function openClipEditor({ api, host, first, onOpenFile, onClose }) {
  const { h, icon, clear } = api;
  const fmtBytes = api.fmt.fmtBytes;
  const S = { pieces: [], music: null, vol: 0.6, ctl: null, alive: true };
  const lenOf = p => (p.type === 'title' ? p.secs : Math.max(0, p.b - p.a));

  const list = h('ol.vclip__list', { 'aria-label': 'Pieces of the movie, in order' });
  const empty = h('p.vclip__empty', { text: 'Add a clip from your videos, or a title card, to begin.' });
  const total = h('output.mono.vclip__total', { 'aria-label': 'Length of the movie' });
  const status = h('div.vclip__status', { role: 'status', 'aria-live': 'polite' });
  const prog = h('progress.vclip__prog', { max: 1, value: 0, hidden: true, 'aria-label': 'Making the movie' });

  /* ---- adding pieces ---- */
  const videos = () => {
    const out = [];
    vfs.walk(vfs.HOME, (n, p) => {
      if (n.type === 'file' && media.isMedia(n) && media.kindOf(n.name) === 'video' && !p.startsWith(`${vfs.HOME}/Trash`)) out.push({ n, p });
    });
    return out.sort((a, b) => a.n.name.localeCompare(b.n.name, undefined, { numeric: true }));
  };
  const clipSel = h('select.select', { 'aria-label': 'Video to add' });
  const fillClips = () => {
    clear(clipSel);
    const vs = videos();
    if (!vs.length) clipSel.append(h('option', { value: '', text: 'No videos yet — import some in the library' }));
    vs.forEach(({ n, p }) => clipSel.append(h('option', { value: p, text: `${n.name} — ${vfs.parentPath(p).replace(vfs.HOME, '~')}` })));
    addClipBtn.disabled = !vs.length;
  };
  const addClipBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => addClip(clipSel.value) }, icon('plus'), h('span', { text: 'Add clip' }));
  const addTitleBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => addTitle() }, icon('type'), h('span', { text: 'Add title card' }));

  async function addClip(path) {
    const n = path && vfs.node(path);
    if (!n) return;
    status.classList.remove('is-err');
    status.textContent = `Reading ${n.name}…`;
    try {
      const url = await media.urlOf(path);
      const info = url ? await VC.probe(url) : null;
      if (!S.alive) return;
      if (!info || !(info.dur > 0)) throw new Error('its length can’t be read — this browser may not play it');
      S.pieces.push({ id: ++uid, type: 'video', path, name: n.name, url, dur: info.dur, a: 0, b: info.dur });
      status.textContent = '';
      paint();
    } catch (e) {
      status.textContent = `“${n.name}” can’t be added: ${e?.message || e}`;
      status.classList.add('is-err');
    }
  }
  function addTitle() {
    S.pieces.push({ id: ++uid, type: 'title', text: 'My movie', secs: 2, bg: MC.titleColors[0].bg, fg: MC.titleColors[0].fg });
    paint();
  }

  /* ---- music ---- */
  const musicSel = h('select.select', { 'aria-label': 'Music from your Music folder', onchange: () => pickMusic(musicSel.value) });
  function fillMusic() {
    clear(musicSel);
    musicSel.append(h('option', { value: '', text: 'No music' }));
    const mine = [];
    vfs.walk(`${vfs.HOME}/Music`, (n, p) => { if (n.type === 'file' && media.isMedia(n) && media.kindOf(n.name) === 'audio') mine.push({ n, p }); });
    mine.sort((a, b) => a.n.name.localeCompare(b.n.name, undefined, { numeric: true }));
    mine.forEach(({ n, p }) => musicSel.append(h('option', { value: p, text: n.name })));
    if (S.music?.file) musicSel.append(h('option', { value: '#file', text: `${S.music.name} (from your computer)` }));
    musicSel.value = S.music ? (S.music.file ? '#file' : S.music.path) : '';
  }
  async function pickMusic(path) {
    if (!path) { S.music = null; paint(); return; }
    if (path === '#file') return;
    const blob = await media.blobOf(path);
    if (!S.alive) return;
    if (!blob) { status.textContent = 'That music file has no sound data.'; status.classList.add('is-err'); musicSel.value = ''; return; }
    S.music = { path, name: vfs.baseName(path), blob };
    paint();
  }
  const musicFile = h('input.sr', { type: 'file', accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.weba,.flac,.opus', tabindex: '-1', 'aria-hidden': 'true',
    onchange: e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f && media.kindOf(f.name) !== 'audio' && !String(f.type).startsWith('audio/')) { status.textContent = 'That isn’t a sound file.'; status.classList.add('is-err'); return; }
      if (f) { S.music = { file: true, name: f.name, blob: f }; paint(); }
    } });
  const volIn = h('input', { type: 'range', min: '0', max: '100', value: '60', 'aria-label': 'Music volume', oninput: () => { S.vol = Number(volIn.value) / 100; volOut.textContent = `${volIn.value}%`; } });
  const volOut = h('output.mono', { text: '60%' });

  /* ---- the list ---- */
  const field = (label, value, onSet, cls = '') => {
    const input = h(`input${cls}`, { type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': label, value, autocomplete: 'off',
      onchange: () => { if (!onSet(input.value)) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); } });
    return h('label.vclip__f', h('span', { text: label.split(' ')[0] }), input);
  };
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= S.pieces.length) return;
    [S.pieces[i], S.pieces[j]] = [S.pieces[j], S.pieces[i]];
    paint();
  }
  function row(p, i) {
    const acts = h('div.vclip__acts',
      h('button.ibtn', { type: 'button', 'aria-label': `Move piece ${i + 1} up`, disabled: i === 0, onclick: () => move(i, -1) }, icon('arrow-up')),
      h('button.ibtn', { type: 'button', 'aria-label': `Move piece ${i + 1} down`, disabled: i === S.pieces.length - 1, onclick: () => move(i, 1) }, icon('arrow-down')),
      h('button.ibtn', { type: 'button', 'aria-label': `Remove piece ${i + 1}`, onclick: () => { S.pieces.splice(i, 1); paint(); } }, icon('trash')));
    if (p.type === 'title') {
      const txt = h('input.vclip__text', { type: 'text', maxlength: '120', 'aria-label': `Title words, piece ${i + 1}`, value: p.text, oninput: () => { p.text = txt.value; updateTotal(); } });
      const sw = h('select.select', { 'aria-label': `Title colours, piece ${i + 1}`, onchange: () => { const c = MC.titleColors.find(x => x.id === sw.value); p.bg = c.bg; p.fg = c.fg; } },
        MC.titleColors.map(c => h('option', { value: c.id, text: c.label, selected: c.bg === p.bg })));
      return h('li.vclip__row', { dataset: { kind: 'title' } }, icon('type'), txt, sw,
        field(`Seconds, piece ${i + 1}`, String(p.secs), v => { const n = Number(v); if (!(n >= 0.5 && n <= 30)) return false; p.secs = n; updateTotal(); return true; }), acts);
    }
    return h('li.vclip__row', { dataset: { kind: 'video' } }, icon('film'),
      h('span.vclip__name', { text: p.name, title: p.path }),
      field(`In, piece ${i + 1}`, VC.clockText(p.a, true), v => { const t = VC.parseClock(v); if (!(t >= 0 && t < p.b - 0.1)) return false; p.a = Math.min(t, p.dur); updateTotal(); return true; }),
      field(`Out, piece ${i + 1}`, VC.clockText(p.b, true), v => { const t = VC.parseClock(v); if (!(t > p.a + 0.1)) return false; p.b = Math.min(t, p.dur); updateTotal(); return true; }),
      h('span.vclip__of.mono', { text: `of ${VC.clockText(p.dur, true)}` }), acts);
  }
  const lengthSum = () => S.pieces.reduce((n, p) => n + lenOf(p), 0);
  function updateTotal() {
    total.textContent = S.pieces.length ? VC.clockText(lengthSum(), true) : '0:00.0';
    makeBtn.disabled = !S.pieces.length || !!S.ctl || !VC.canCut();
  }
  function paint() {
    clear(list);
    S.pieces.forEach((p, i) => list.append(row(p, i)));
    empty.hidden = S.pieces.length > 0;
    fillMusic();
    updateTotal();
  }

  /* ---- make it ---- */
  const makeBtn = h('button.btn.btn--primary', { type: 'button', disabled: true, onclick: () => make() }, icon('film'), h('span', { text: 'Make the movie' }));
  const cancelBtn = h('button.btn', { type: 'button', hidden: true, onclick: () => S.ctl?.abort() }, h('span', { text: 'Cancel' }));
  async function make() {
    if (S.ctl || !S.pieces.length) return;
    const ctl = new AbortController();
    S.ctl = ctl;
    cancelBtn.hidden = false;
    prog.hidden = false;
    prog.value = 0;
    status.classList.remove('is-err');
    status.textContent = `Making ${VC.clockText(lengthSum(), true)} of movie — it plays through once, out of sight, while it is re-encoded in real time. Keep this tab open.`;
    updateTotal();
    let res = null;
    try {
      res = await MC.exportMovie({
        segments: S.pieces.map(p => (p.type === 'title' ? { type: 'title', text: p.text, secs: p.secs, bg: p.bg, fg: p.fg } : { type: 'video', url: p.url, a: p.a, b: p.b })),
        music: S.music ? S.music.blob : null, musicVol: S.vol, signal: ctl.signal, onProgress: f => { prog.value = f; },
      });
    } catch (err) {
      if (!S.alive) return;
      status.textContent = err.code === 'abort' ? 'Cancelled. Nothing was saved.' : `The movie didn’t finish: ${err.message || err}`;
      if (err.code !== 'abort') status.classList.add('is-err');
      finish();
      return;
    }
    if (!S.alive) return;
    try {
      const saved = await media.save(`${vfs.HOME}/Videos`, `Movie ${stamp()}.webm`, res.blob);
      if (saved.node && saved.node.kind !== 'video') { saved.node.kind = 'video'; api.bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
      panel.dataset.saved = saved.path;
      status.textContent = `Saved ${vfs.baseName(saved.path)} in Videos — ${VC.clockText(res.ms / 1000, true)}, ${res.w}×${res.h}, ${fmtBytes(res.blob.size)}${res.music ? ', with your music' : ''}.`;
      api.notify({ app: 'Videos', icon: 'film', title: 'Movie saved', message: `${vfs.baseName(saved.path)} · ${fmtBytes(res.blob.size)}`, actions: [{ label: 'Play', onClick: () => onOpenFile?.(saved.path) }] });
    } catch (err) {
      status.textContent = `The movie couldn’t be saved: ${err?.message || err}`;
      status.classList.add('is-err');
    }
    finish();
  }
  function finish() { S.ctl = null; cancelBtn.hidden = true; prog.hidden = true; updateTotal(); }

  function close() {
    if (!S.alive) return;
    S.alive = false;
    S.ctl?.abort();
    panel.remove();
    onClose?.();
  }

  const closeBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Close the movie maker', onclick: () => close() }, icon('x'));
  const panel = h('div.vclip', { role: 'dialog', 'aria-label': 'Make a movie',
    onkeydown: e => { if (e.key === 'Escape' && !S.ctl && !(e.target.matches?.('input[type=text]'))) { e.stopPropagation(); close(); } } },
    h('div.vclip__head', icon('film'), h('b', { text: 'Make a movie' }), closeBtn),
    h('div.vclip__body',
      h('div.vclip__row2', clipSel, addClipBtn, addTitleBtn),
      list, empty,
      h('div.vclip__music', icon('music'), h('b', { text: 'Music' }), musicSel,
        h('button.btn.btn--sm', { type: 'button', onclick: () => musicFile.click() }, icon('upload'), h('span', { text: 'Choose a file…' })),
        h('label.vclip__vol', h('span', { text: 'Volume' }), volIn, volOut)),
      h('small.vclip__fine', { text: 'Music is only ever your own: a file in ~/Music (Static Beats and Synth exports are saved there) or one you pick from your computer.' }),
      h('div.vclip__row2', h('span', { text: 'Length ' }), total, h('span.grow'), cancelBtn, makeBtn),
      prog, status,
      h('div.vclip__note', { text: 'The movie is made in real time: the pieces play through once, out of sight, while this browser re-encodes them, so it takes as long as the movie. The result is a new WebM in ~/Videos; your clips and music are not changed.' })),
    musicFile);
  host.appendChild(panel);
  fillClips();
  paint();
  if (first) addClip(first);
  return { close, el: panel };
}
