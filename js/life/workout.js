/* ============================================================
   life/workout.js — the Workout tab: an interval timer.

   Routines (warm-up, work, rest, rounds, cool-down) can be saved. The
   countdown reads the clock, not a tick counter (js/core/workout.js):
   the page redraws four times a second, but what it draws is always
   "where is the workout right now", so a background tab that is
   throttled to one wake-up a second or a minute still shows the right
   part and the right time when you look, and doesn't lose any of it.
   It says nothing about calories or health.

   Cues go through the OS's own pieces: sfx.js for the bell at the
   start of each part and a tick for the last three seconds, and
   speech.js (the browser's voices) for "Work, round 2", "Rest" and so
   on. Both have their own switch here (kept in the saved state), and
   the OS-wide Mute and Settings › Sound apply on top. When the tab
   has been away and several parts went by, only the part you are in
   now is announced, not each one that went by.

   With spoken cues on, the voice also counts the last three seconds of
   a part ("3", "2", "1") and says "Halfway" in a work part of 20
   seconds or more. The voice is the one picked in Settings ›
   Accessibility › Read aloud.

   While a workout runs the window title shows the time left (the same
   visible-timer idea as Focus' top-bar readout) and the screen is kept
   awake where the browser allows. Closing the window, or stopping,
   clears the timer, silences speech and releases the wake lock.

   History: every workout that was started is written down when it
   ends (finished, stopped, or the window closed), with the time
   actually spent in it: the clock time it ran, less pauses and less
   what Skip jumped over. Nothing is estimated from it.
   ============================================================ */
import * as W from '../core/workout.js';
import * as sfx from '../core/sfx.js';
import * as speech from '../core/speech.js';
import { hold } from '../core/wakelock.js';
import { dayKey, shiftDay } from '../core/habits.js';
import { read, write, uid } from './data.js';

const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const span = ms => { const s = Math.max(0, Math.round(ms / 1000)), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const MAX_HISTORY = 500;
const MIN_KEEP = 5000;           /* a start that is stopped within 5 s isn't a workout */
const normRun = r => (r && typeof r === 'object' && Number.isFinite(r.at) && Number.isFinite(r.active) && r.active >= 0
  ? { id: String(r.id || '').slice(0, 40), at: r.at, day: /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : dayKey(r.at), name: String(r.name || 'Workout').slice(0, 40),
    active: Math.round(r.active), planned: Math.round(Number(r.planned) || 0), finished: r.finished === true, rounds: Math.max(0, Math.round(Number(r.rounds) || 0)), of: Math.max(0, Math.round(Number(r.of) || 0)) } : null);
const FIELDS = [['warm', 'Warm-up (seconds)'], ['work', 'Work (seconds)'], ['rest', 'Rest (seconds)'], ['rounds', 'Rounds'], ['cool', 'Cool-down (seconds)']];

export function mountWorkout(el, ctx) {
  const { h, icon, confirm } = ctx.api;
  const win = ctx.win;
  const S = { draft: { ...W.DEFAULT_ROUTINE, id: '' }, run: null, routine: null, lastIndex: -1, lastSec: null, half: -1, skipped: 0, logged: false, finished: false, error: '', dead: false, allRuns: false };
  let timer = 0;
  let lock = null;
  let view = {};        /* the live readout's elements while a workout is on screen */

  const cfg = () => { const w = read().workout || {}; return { sound: w.sound !== false, voice: w.voice === true, routines: (Array.isArray(w.routines) ? w.routines : []).map(W.clean).filter(Boolean), history: (Array.isArray(w.history) ? w.history : []).map(normRun).filter(Boolean) }; };
  const saveCfg = patch => write('workout', { ...cfg(), ...patch });

  /* ---------------- history ---------------- */
  function logRun(finished) {
    if (!S.run || S.logged) return;
    const p = S.run.position();
    const active = Math.max(0, p.elapsed - S.skipped);
    if (!finished && active < MIN_KEEP) return;
    S.logged = true;
    const segs = S.run.segs;
    let t = 0, rounds = 0;
    for (const s of segs) { if (s.kind === 'work' && p.elapsed >= t + s.dur) rounds++; t += s.dur; }
    const run = { id: uid('wr'), at: Date.now(), day: dayKey(), name: S.routine.name, active, planned: S.run.total, finished, rounds, of: S.routine.rounds };
    saveCfg({ history: [run, ...cfg().history].slice(0, MAX_HISTORY) });
  }
  const setTitle = t => { try { win && win.setTitle(t); } catch (e) { /* no window */ } };

  /* ---------------- cues ---------------- */
  function say(text) {
    if (!cfg().voice || !speech.supported()) return;
    try { speech.speak(text); } catch (e) { /* speech can throw on odd browsers */ }
  }
  function cue(seg) {
    const c = cfg();
    if (c.sound) sfx.play(seg ? 'phase' : 'notify');
    if (!seg) { say('Workout complete'); return; }
    say(seg.kind === 'work' ? `Work, round ${seg.round}` : seg.kind === 'rest' ? 'Rest' : seg.label);
  }

  /* ---------------- running ---------------- */
  function begin() {
    const r = W.clean({ ...S.draft, name: S.draft.name || 'Workout' });
    S.routine = r;
    S.run = W.runner(r);
    S.lastIndex = -1; S.lastSec = null; S.half = -1; S.skipped = 0; S.logged = false; S.finished = false;
    S.run.start();
    lock = lock || hold();
    timer = timer || setInterval(step, 250);
    render();
    step();
  }

  function finishUp() {
    if (timer) { clearInterval(timer); timer = 0; }
    if (lock) { lock.release(); lock = null; }
    setTitle('Static Life');
  }

  function stop() {
    if (S.run && !S.finished) logRun(false);
    finishUp();
    try { speech.stop(); } catch (e) { /* nothing was speaking */ }
    S.run = null;
    render();
  }

  function step() {
    if (S.dead || !S.run) return;
    const p = S.run.position();
    if (p.status === 'done') {
      if (!S.finished) { S.finished = true; logRun(true); cue(null); finishUp(); render(); }
      return;
    }
    const fresh = p.index !== S.lastIndex;
    if (fresh) { S.lastIndex = p.index; S.lastSec = null; S.half = p.into >= p.seg.dur / 2 ? p.index : -1; cue(p.seg); }
    const secs = Math.ceil(p.left / 1000);
    if (p.status === 'running' && secs <= 3 && secs >= 1 && secs !== S.lastSec && p.seg.dur > 4000) {
      /* a late tick (a throttled tab) that lands in the last seconds says only the second it is now */
      S.lastSec = secs;
      if (cfg().sound) sfx.play('tap');
      if (!fresh) say(String(secs));
    }
    if (p.status === 'running' && p.seg.kind === 'work' && p.seg.dur >= 20000 && S.half !== p.index && p.into >= p.seg.dur / 2 && p.left > 4000) {
      S.half = p.index;
      say('Halfway');
    }
    paintRun(p);
  }

  function paintRun(p) {
    if (!view.time) return;
    view.time.textContent = clock(p.left);
    view.label.textContent = p.seg.label;
    view.round.textContent = p.seg.round ? `Round ${p.seg.round} of ${p.seg.rounds}` : '';
    view.next.textContent = p.next ? `Next: ${p.next.label} · ${clock(p.next.dur)}` : 'Last part';
    view.bar.style.width = `${Math.min(100, Math.floor((p.elapsed * 100) / p.total))}%`;
    view.pp.querySelector('.life-pp').textContent = p.status === 'paused' ? 'Resume' : 'Pause';
    view.pp.replaceChild(icon(p.status === 'paused' ? 'play' : 'pause'), view.pp.querySelector('.icon'));
    view.root.dataset.kind = p.seg.kind;
    view.root.classList.toggle('is-paused', p.status === 'paused');
    setTitle(`${clock(p.left)} ${p.seg.label} · Static Life`);
  }

  const toggleSwitch = (key, label, on) => h('button.btn', { type: 'button', 'aria-pressed': String(on), class: on ? 'is-on' : '', 'data-k': key,
    onclick: () => { saveCfg({ [key]: !on }); if (key === 'voice' && on) { try { speech.stop(); } catch (e) { /* idle */ } } render(); } }, icon(key === 'sound' ? (on ? 'volume-2' : 'volume-x') : 'mic'), h('span', { text: label }));

  function runView() {
    const c = cfg();
    const p = S.run.position();
    const pp = h('button.btn.btn--primary', { type: 'button', 'data-act': 'pause', onclick: () => { const st = S.run.status; if (st === 'running') S.run.pause(); else S.run.resume(); step(); } }, icon('pause'), h('span.life-pp', { text: 'Pause' }));
    view = {
      time: h('div.life-wk__time', { role: 'timer', 'aria-label': 'Time left in this part' }),
      label: h('div.life-wk__label', { 'aria-live': 'polite' }),
      round: h('div.life-wk__round'),
      next: h('div.life-wk__next'),
      bar: h('i'), pp,
    };
    view.root = h('div.life-wk__run', { 'data-kind': p.seg ? p.seg.kind : 'work' },
      view.label, view.round, view.time, view.next,
      h('div.bar', view.bar),
      h('div.life-form__row.life-wk__ctl',
        pp,
        h('button.btn', { type: 'button', 'data-act': 'skip', onclick: () => { const q = S.run.position(); if (q.seg) S.skipped += q.left; S.run.skip(); step(); } }, icon('skip-forward'), h('span', { text: 'Skip' })),
        h('button.btn', { type: 'button', 'data-act': 'stop', onclick: stop }, icon('x'), h('span', { text: 'Stop' }))),
      h('div.life-form__row', toggleSwitch('sound', 'Sound cues', c.sound), toggleSwitch('voice', 'Spoken cues', c.voice),
        c.voice && !speech.supported() ? h('small.life-note', { text: 'This browser can’t speak, so spoken cues are off here.' }) : null));
    return view.root;
  }

  function doneView() {
    return h('div.life-wk__run.is-done',
      h('div.life-wk__label', { text: 'Workout complete' }),
      h('div.life-wk__round', { text: `${S.routine.name}: ${S.routine.rounds} ${S.routine.rounds === 1 ? 'round' : 'rounds'}, ${clock(S.run.total)} in all` }),
      h('div.life-form__row', h('button.btn.btn--primary', { type: 'button', 'data-act': 'again', onclick: begin }, icon('repeat'), h('span', { text: 'Go again' })),
        h('button.btn', { type: 'button', 'data-act': 'back', onclick: stop }, h('span', { text: 'Back to routines' }))));
  }

  /* ---------------- setup ---------------- */
  function setup() {
    const c = cfg();
    const d = S.draft;
    const total = W.totalMs(W.clean({ ...d, name: 'x' }));
    const name = h('input', { type: 'text', maxlength: '40', value: d.name, placeholder: 'Name this routine', 'aria-label': 'Routine name', oninput: () => { d.name = name.value; } });
    const inputs = FIELDS.map(([k, label]) => {
      const [lo, hi] = W.LIMITS[k];
      const input = h('input', { type: 'number', min: String(lo), max: String(hi), step: '1', inputmode: 'numeric', value: String(d[k]), 'aria-label': label, 'data-k': k,
        oninput: () => { d[k] = input.value === '' ? '' : Number(input.value); totalEl.textContent = `Total ${clock(W.totalMs(W.clean({ ...d, name: 'x' })))}`; } });
      return h('label.life-field', h('span', { text: label }), h('div.field', input));
    });
    const totalEl = h('b.life-wk__total', { 'data-k': 'total', text: `Total ${clock(total)}` });
    const save = () => {
      const r = W.clean({ ...d, id: d.id || uid('w') });
      if (!r || !d.name.trim()) { S.error = 'Name the routine to save it.'; render(); return; }
      const list = c.routines;
      if (!d.id && list.length >= W.MAX_ROUTINES) { S.error = `You can save up to ${W.MAX_ROUTINES} routines.`; render(); return; }
      saveCfg({ routines: d.id ? list.map(x => (x.id === r.id ? r : x)) : [...list, r] });
      S.draft = { ...r }; S.error = '';
      render();
    };
    const remove = async () => {
      const yes = await confirm({ title: `Delete “${d.name}”?`, message: 'The saved routine is removed. This can’t be undone.', ok: 'Delete', danger: true });
      if (!yes || S.dead) return;
      saveCfg({ routines: cfg().routines.filter(x => x.id !== d.id) });
      S.draft = { ...W.DEFAULT_ROUTINE, id: '' };
      render();
    };
    return [
      h('div.life-head', h('div', h('h2', { text: 'Workout' }), h('small', { text: 'Interval timer. Keeps true time even when this tab is in the background.' }))),
      c.routines.length ? h('div.life-tags', { role: 'group', 'aria-label': 'Saved routines' }, c.routines.map(r =>
        h('button.chip', { type: 'button', 'data-id': r.id, 'aria-pressed': String(d.id === r.id), class: d.id === r.id ? 'chip--accent' : '', onclick: () => { S.draft = { ...r }; S.error = ''; render(); } },
          h('span', { text: `${r.name} · ${clock(W.totalMs(r))}` })))) : h('p.life-note', { text: 'No saved routines yet. Set one up below and press Save routine.' }),
      h('div.life-card.life-form',
        h('div.life-form__row', h('div.field.life-grow', name)),
        h('div.life-wk__fields', inputs),
        h('div.life-form__row', totalEl, h('small', { text: 'A length of 0 leaves warm-up, rest or cool-down out.' })),
        h('p.life-err', { role: 'alert', text: S.error }),
        h('div.life-form__row',
          h('button.btn.btn--primary', { type: 'button', 'data-act': 'start', onclick: begin }, icon('play'), h('span', { text: 'Start' })),
          h('button.btn', { type: 'button', 'data-act': 'save', onclick: save }, icon('check'), h('span', { text: d.id ? 'Save changes' : 'Save routine' })),
          d.id ? h('button.btn.btn--ghost', { type: 'button', onclick: remove }, icon('trash'), h('span', { text: 'Delete' })) : null,
          d.id ? h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.draft = { ...S.draft, id: '' }; render(); } }, h('span', { text: 'Save as new' })) : null)),
      h('div.life-form__row', toggleSwitch('sound', 'Sound cues', c.sound), toggleSwitch('voice', 'Spoken cues', c.voice),
        c.voice && !speech.supported() ? h('small.life-note', { text: 'This browser can’t speak, so spoken cues are off here.' }) : null),
      c.voice ? h('small.life-note', { text: 'The voice names each part, counts down the last three seconds and says “Halfway” in longer work parts. It uses the voice set in Settings › Accessibility › Read aloud.' }) : null,
      history(c.history),
    ];
  }

  function history(runs) {
    const today = dayKey();
    const since = n => runs.filter(r => r.day > shiftDay(today, -n));
    const sum = list => list.reduce((t, r) => t + r.active, 0);
    const w7 = since(7), w30 = since(30);
    const shown = S.allRuns ? runs : runs.slice(0, 15);
    const when = r => new Date(r.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return h('section.life-history', { 'aria-label': 'Workout history' },
      h('div.life-head', h('h3', { text: 'History' }),
        runs.length ? h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'clear-history', onclick: async () => {
          if (!(await confirm({ title: 'Clear the workout history?', message: `All ${runs.length} ${runs.length === 1 ? 'entry goes' : 'entries go'}. Your routines stay. This can’t be undone.`, ok: 'Clear', danger: true })) || S.dead) return;
          saveCfg({ history: [] }); render();
        } }, icon('trash'), h('span', { text: 'Clear' })) : null),
      !runs.length ? h('p.life-note', { text: 'Each workout you start is listed here when it ends, with the time you actually spent in it.' }) : [
        h('div.life-tiles',
          h('div.life-tile', h('small', { text: 'Last 7 days' }), h('b', { 'data-k': 'wk7', text: `${w7.length} · ${span(sum(w7))}` })),
          h('div.life-tile', h('small', { text: 'Last 30 days' }), h('b', { 'data-k': 'wk30', text: `${w30.length} · ${span(sum(w30))}` })),
          h('div.life-tile', h('small', { text: 'Finished' }), h('b', { 'data-k': 'wkdone', text: `${runs.filter(r => r.finished).length} of ${runs.length}` }))),
        h('small.life-note', { text: 'Workouts and time spent in them: the clock time each one ran, less pauses and anything skipped.' }),
        h('ul.life-entries.life-runs', shown.map(r => h('li', { 'data-run': r.id },
          h('span.life-entries__date', { text: when(r) }),
          h('span.life-entries__cat', { text: r.name }),
          h('span.life-entries__note', { text: r.finished ? `Finished · ${r.rounds} ${r.rounds === 1 ? 'round' : 'rounds'}` : `Stopped · ${r.rounds} of ${r.of || r.rounds} ${(r.of || r.rounds) === 1 ? 'round' : 'rounds'} done` }),
          h('b', { text: span(r.active) }),
          h('button.ibtn', { type: 'button', 'aria-label': `Delete the ${r.name} workout of ${when(r)}`, onclick: () => { saveCfg({ history: cfg().history.filter(x => x.id !== r.id) }); render(); } }, icon('trash'))))),
        runs.length > 15 ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { S.allRuns = !S.allRuns; render(); } }, h('span', { text: S.allRuns ? 'Show fewer' : `Show all ${runs.length}` })) : null,
      ]);
  }

  function render() {
    if (S.dead) return;
    view = {};
    if (S.run && S.finished) el.replaceChildren(doneView());
    else if (S.run) { el.replaceChildren(h('div.life-head', h('div', h('h2', { text: S.routine.name }))), runView()); step(); }
    else el.replaceChildren(...setup().filter(Boolean));
  }

  /* a tab that was hidden catches up the moment it is looked at */
  const vis = () => { if (document.visibilityState === 'visible') step(); };
  document.addEventListener('visibilitychange', vis);
  render();

  return () => {
    if (S.run && !S.finished) logRun(false);        /* the window closed mid-workout: what was done still counts */
    S.dead = true;
    document.removeEventListener('visibilitychange', vis);
    if (timer) { clearInterval(timer); timer = 0; }
    try { speech.stop(); } catch (e) { /* idle */ }
    if (lock) { lock.release(); lock = null; }
    setTitle('Static Life');
  };
}
