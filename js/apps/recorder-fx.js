/* ============================================================
   recorder-fx.js — the "Voice effects" card under a voice
   recording in Static Recorder. The DSP is core/voicefx.js; this
   is the card: pick an effect, Preview it, Save it as WAV or as
   WebM/Opus. Saving makes a NEW file next to the recording (the
   recording is only read) — Recorder's own save() lists it.

   createFxPanel({ h, icon, blobOf, save, onPreview })
     el              the card
     show(item)      point it at a recording (resets when it changes)
     hide()          stop any preview and hide the card
     destroy()       same, for good
   ============================================================ */
import * as FX from '../core/voicefx.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-audiotools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audiotools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-audiotools.css';
  document.head.appendChild(l);
}

export function createFxPanel({ h, icon, blobOf, save, onPreview }) {
  const S = { item: null, fx: 'robot', orig: null, made: null, busy: '', prev: null, gen: 0, dead: false };
  const opusType = FX.canOpus();

  const buttons = new Map();
  const group = h('div.rec-fx__set', { role: 'radiogroup', 'aria-label': 'Effect' }, FX.EFFECTS.map(e => {
    const b = h('button.rec-fx__btn', { type: 'button', role: 'radio', dataset: { fx: e.id }, onclick: () => pick(e.id) },
      icon(e.icon), h('span', { text: e.label }));
    buttons.set(e.id, b);
    return b;
  }));
  const note = h('p.rec-fx__note');
  const status = h('div.rec-fx__status', { role: 'status', 'aria-live': 'polite' });
  const prevBtn = h('button.btn.btn--sm.rec-fx__prev', { type: 'button', onclick: () => preview() }, icon('play', { fill: true }), h('span', { text: 'Preview' }));
  const wavBtn = h('button.btn.btn--sm.btn--primary.rec-fx__wav', { type: 'button', onclick: () => saveAs('wav') }, icon('save'), h('span', { text: 'Save as WAV' }));
  const opusBtn = h('button.btn.btn--sm.rec-fx__opus', { type: 'button', hidden: !opusType,
    title: 'Encodes with the browser’s Opus encoder as the effect plays through once, in real time.', onclick: () => saveAs('opus') },
  icon('save'), h('span', { text: opusType.includes('ogg') ? 'Save as Ogg/Opus' : 'Save as WebM/Opus' }));
  const el = h('section.rec-fx', { 'aria-label': 'Voice effects', hidden: true },
    h('div.rec-fx__head', icon('sparkles'), h('b', { text: 'Voice effects' }),
      h('small', { text: 'Try one, then keep it as a new recording. This one is not changed.' })),
    group, note, h('div.rec-fx__acts', prevBtn, wavBtn, opusBtn), status);

  const say = (text, tone = '') => { status.textContent = text; status.dataset.tone = tone; };

  function paint() {
    for (const [id, b] of buttons) b.setAttribute('aria-checked', String(id === S.fx));
    note.textContent = FX.EFFECTS.find(e => e.id === S.fx)?.note || '';
    const busy = !!S.busy;
    group.querySelectorAll('button').forEach(b => { b.disabled = busy && b.dataset.fx !== S.fx ? true : false; });
    prevBtn.disabled = busy && S.busy !== 'preview';
    wavBtn.disabled = busy;
    opusBtn.disabled = busy;
    const playing = !!S.prev;
    prevBtn.replaceChildren(icon(playing ? 'pause' : 'play', { fill: true }), h('span', { text: playing ? 'Stop preview' : 'Preview' }));
    prevBtn.classList.toggle('is-playing', playing);
  }

  function stopPreview() {
    const p = S.prev;
    S.prev = null;
    p?.stop();
  }

  function pick(id) {
    if (S.fx === id) return;
    stopPreview();
    S.fx = id;
    S.made = null;
    say('');
    paint();
  }

  async function original() {
    if (S.orig && S.orig.id === S.item.id) return S.orig.buf;
    const blob = await blobOf(S.item);
    if (!blob) throw new Error('The audio for this recording isn’t in this browser any more.');
    let buf;
    try { buf = await FX.decode(blob); } catch (e) { throw new Error('This browser can’t decode this recording to change it.'); }
    S.orig = { id: S.item.id, buf };
    return buf;
  }
  async function made() {
    const key = `${S.item.id}|${S.fx}`;
    if (S.made?.key === key) return S.made.buf;
    const buf = await FX.render(await original(), S.fx);
    S.made = { key, buf };
    return buf;
  }

  async function preview() {
    if (S.prev) { stopPreview(); paint(); say(''); return; }
    if (!S.item || S.busy) return;
    const gen = ++S.gen;
    S.busy = 'preview';
    say('Making the effect…');
    paint();
    try {
      const buf = await made();
      if (S.dead || gen !== S.gen) return;
      onPreview?.();                                  /* the recording's own player stops */
      S.busy = '';
      const p = FX.playBuffer(buf, () => { if (S.prev === p) { S.prev = null; if (!S.dead) { paint(); say(''); } } });
      S.prev = p;
      say(`Playing with ${FX.EFFECTS.find(e => e.id === S.fx).label.toLowerCase()}…`);
    } catch (err) {
      if (S.dead || gen !== S.gen) return;
      say(err?.message || String(err), 'err');
    } finally {
      if (!S.dead && gen === S.gen) { S.busy = ''; paint(); }
    }
  }

  async function saveAs(kind) {
    if (!S.item || S.busy) return;
    stopPreview();
    const gen = ++S.gen;
    const item = S.item;
    const label = FX.EFFECTS.find(e => e.id === S.fx).label.toLowerCase();
    S.busy = kind;
    say(kind === 'opus' ? 'Encoding in real time — keep this window open…' : 'Saving…');
    paint();
    try {
      const buf = await made();
      if (S.dead || gen !== S.gen) return;
      let blob, ext;
      if (kind === 'wav') { blob = FX.encodeWav(buf); ext = 'wav'; }
      else { blob = (await FX.encodeOpus(buf)).blob; ext = 'opus'; }
      if (S.dead) return;
      const out = await save({ blob, ext, label, item, seconds: buf.duration });
      if (S.dead) return;
      say(`Saved “${out.name}” — a new recording. “${item.name}” is unchanged.`, 'ok');
    } catch (err) {
      if (!S.dead) say(`Couldn’t save it: ${err?.message || err}`, 'err');
    } finally {
      if (!S.dead) { S.busy = ''; paint(); }
    }
  }

  return {
    el,
    show(item) {
      if (S.item?.id !== item.id) { stopPreview(); S.gen++; S.busy = ''; S.orig = null; S.made = null; say(''); }
      S.item = item;
      el.hidden = false;
      paint();
    },
    hide() { stopPreview(); S.gen++; S.busy = ''; S.item = null; el.hidden = true; },
    destroy() { S.dead = true; stopPreview(); S.gen++; },
  };
}
