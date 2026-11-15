/* ============================================================
   arcade/cliptrim.js — trim a saved Static Replay clip.

   clipTrimmer({ h, icon, clip, onSave, onClose }) -> { el, destroy() }

   A preview of the clip, a Start and an End slider (tenths of a
   second; the arrow keys step them), Preview (plays Start → End), and
   Save. Saving re-encodes the part between Start and End through
   core/videocut.js (the same path Videos' trimmer and Recorder use:
   the clip plays once, out of sight, into a canvas + MediaRecorder),
   so it takes as long as the trimmed part lasts and gives a WebM.
   onSave({ blob, mime, ms }, replace) stores it: as a new clip, or in
   place of the original when "Replace the original" is ticked.
   ============================================================ */
import * as VC from '../core/videocut.js';

const clock = s => { const t = Math.max(0, s || 0); return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`; };

export function clipTrimmer({ h, icon, clip, onSave, onClose }) {
  const url = URL.createObjectURL(clip.blob);
  const canCut = VC.canCut();
  const T = { dur: Math.max(0.1, (clip.durationMs || 0) / 1000), a: 0, b: Math.max(0.1, (clip.durationMs || 0) / 1000), busy: null, stopAt: null };
  const video = h('video.arc-trim__video', { src: url, preload: 'auto', playsinline: true, muted: true, 'aria-label': `${clip.title} clip` });
  video.muted = true;
  const out = h('div.arc-trim__len', { role: 'status', 'aria-live': 'polite' });
  const mk = (id, label) => {
    const inp = h('input.arc-opt__range', { type: 'range', min: '0', max: String(T.dur), step: '0.1', dataset: { trim: id }, 'aria-label': label });
    const lab = h('output.arc-trim__at');
    return { inp, lab, row: h('label.arc-trim__row', h('span.arc-trim__name', { text: label }), inp, lab) };
  };
  const A = mk('a', 'Start'), B = mk('b', 'End');
  const paint = () => {
    A.inp.max = B.inp.max = String(T.dur);
    A.inp.value = String(T.a); B.inp.value = String(T.b);
    A.lab.textContent = clock(T.a); B.lab.textContent = clock(T.b);
    A.inp.setAttribute('aria-valuetext', clock(T.a)); B.inp.setAttribute('aria-valuetext', clock(T.b));
    out.textContent = `Keeps ${clock(T.b - T.a)} of ${clock(T.dur)}`;
    save.disabled = !canCut || !!T.busy || !(T.b - T.a >= 0.3) || (T.a <= 0.05 && T.b >= T.dur - 0.05);
  };
  A.inp.addEventListener('input', () => { T.a = Math.min(Number(A.inp.value), T.b - 0.3); if (T.a < 0) T.a = 0; seek(T.a); paint(); });
  B.inp.addEventListener('input', () => { T.b = Math.max(Number(B.inp.value), T.a + 0.3); if (T.b > T.dur) T.b = T.dur; seek(T.b); paint(); });
  const seek = t => { try { video.pause(); video.currentTime = t; } catch (e) { /* not ready yet */ } };
  /* the real length, once the browser knows it (an old clip may lack it in its header) */
  video.addEventListener('loadedmetadata', () => {
    const d = video.duration;
    if (Number.isFinite(d) && d > 0 && Math.abs(d - T.dur) > 0.05) { const wasEnd = T.b >= T.dur - 0.05; T.dur = d; if (wasEnd || T.b > d) T.b = d; if (T.a > T.b - 0.3) T.a = Math.max(0, T.b - 0.3); paint(); }
  });
  video.addEventListener('timeupdate', () => { if (T.stopAt !== null && video.currentTime >= T.stopAt) { video.pause(); T.stopAt = null; } });

  const preview = h('button.btn.btn--sm', { type: 'button', dataset: { act: 'preview' }, onclick: () => {
    try { video.currentTime = T.a; T.stopAt = T.b; video.play().catch(() => {}); } catch (e) { /* not ready */ }
  } }, icon('play', { fill: true }), h('span', { text: 'Preview' }));
  const replace = h('input', { type: 'checkbox', dataset: { k: 'replace' } });
  const bar = h('div.arc-trim__bar', { hidden: true, role: 'progressbar', 'aria-label': 'Trimming', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i'));
  const msg = h('div.arc-trim__msg', { role: 'status', 'aria-live': 'polite' });
  const save = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'savetrim' }, onclick: async () => {
    if (T.busy) return;
    const ctl = new AbortController();
    T.busy = ctl;
    paint();
    bar.hidden = false;
    msg.textContent = `Trimming — this takes as long as the part you keep (${clock(T.b - T.a)}).`;
    try {
      video.pause();
      const r = await VC.exportCut({ url, a: T.a, b: T.b, signal: ctl.signal,
        onProgress: f => { bar.firstChild.style.width = `${Math.round(f * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(f * 100))); } });
      if (T.busy !== ctl) return;
      await onSave({ blob: r.blob, mime: r.mime, ms: Math.round(r.ms) }, replace.checked);
    } catch (e) {
      if (T.busy === ctl) msg.textContent = e?.code === 'abort' ? 'Trimming stopped. Nothing was saved.' : `The clip couldn’t be trimmed: ${e?.message || e}`;
    } finally {
      if (T.busy === ctl) { T.busy = null; bar.hidden = true; paint(); }
    }
  } }, icon('crop'), h('span', { text: 'Save trimmed clip' }));
  const cancel = h('button.btn.btn--ghost', { type: 'button', dataset: { act: 'canceltrim' }, onclick: () => { if (T.busy) { T.busy.abort(); T.busy = null; } onClose(); } },
    h('span', { text: 'Cancel' }));
  const el = h('section.arc-trim', { 'aria-label': `Trim ${clip.title}` },
    h('div.arc-clips__title', { text: `Trim “${clip.title}”` }),
    h('div.arc-clips__sub', { text: 'Pick where the clip should start and end. The original stays as it is unless you tick Replace.' }),
    h('div.arc-trim__frame', video),
    h('div.arc-trim__ctl', A.row, B.row, out),
    h('label.arc-trim__rep', replace, h('span', { text: 'Replace the original clip' })),
    canCut ? null : h('div.arc-note', icon('alert'), h('span', { text: 'This browser can’t write video, so clips can’t be trimmed here.' })),
    bar, msg,
    h('div.arc-card__row', preview, save, cancel));
  paint();
  return {
    el,
    destroy() { if (T.busy) { T.busy.abort(); T.busy = null; } try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* gone */ } URL.revokeObjectURL(url); },
  };
}

export default { clipTrimmer };
