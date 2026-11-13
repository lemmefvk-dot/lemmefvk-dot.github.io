/* ============================================================
   arcade/reaction.js — Reaction: wait for green, then hit it.

   Five rounds. Each round the panel goes red for a random 1.5–4 s,
   then turns green; the time from the green frame to your click, tap
   or Space is the round. Pressing while it is still red is a foul:
   that round does not count and simply starts again.

   Timing is as honest as a page can make it. The start is the
   timestamp of the animation frame that first paints the green, and
   the end is the input event's own timestamp (not when our handler
   happened to run), both on the performance.now() clock. What no page
   can remove is your screen's and your mouse's own latency, so the
   finished screen says that out loud. Score = the average of the five
   rounds in ms, lower is better.

   The green switch is deliberately instant (no colour transition,
   reduced motion or not): a fade would put the start of the round in
   the middle of an animation.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

const ROUNDS = 5;
const MIN_WAIT = 1500;
const MAX_WAIT = 4000;
const CONTINUE_GUARD = 320; // ms: a double-click on green must not skip the result

const CSS = `
.arx-rt{position:relative;width:100%;height:100%;min-height:300px;display:flex;flex-direction:column;gap:var(--sp-4,12px);
  padding:var(--sp-5,16px);box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);user-select:none;-webkit-user-select:none}
.arx-rt *{box-sizing:border-box}
.arx-rt__stage{position:relative;flex:1;min-height:200px;border-radius:var(--r-xl,20px);display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:var(--sp-3,8px);padding:var(--sp-6,20px);text-align:center;cursor:pointer;overflow:hidden;touch-action:manipulation;outline:none;
  border:1px solid var(--line-1,rgba(255,255,255,.08));
  background:radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--ga) 26%,transparent),transparent 70%),var(--fill-1,rgba(255,255,255,.06));
  color:var(--ink-0,#fff)}
.arx-rt__stage:focus-visible{outline:2px solid color-mix(in srgb,var(--ga) 55%,transparent);outline-offset:3px}
.arx-rt__glyph{width:clamp(34px,7cqmin,56px);height:clamp(34px,7cqmin,56px);opacity:.92}
.arx-rt__glyph .icon{width:100%;height:100%}
.arx-rt__big{font-size:clamp(34px,11cqmin,92px);font-weight:800;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}
.arx-rt__big small{font-size:.42em;font-weight:700;letter-spacing:0;margin-left:.12em;opacity:.8}
.arx-rt__sub{font-size:clamp(13px,2.6cqmin,17px);color:inherit;opacity:.82;max-width:46ch;line-height:1.45;text-wrap:balance}
.arx-rt__hint{position:absolute;bottom:var(--sp-5,16px);left:var(--sp-4,12px);right:var(--sp-4,12px);font-size:var(--fs-12,12px);letter-spacing:.02em;opacity:.7}
.arx-rt__hint kbd{display:inline-block;font:600 calc(11px * var(--fs-k,1))/1 var(--mono,ui-monospace,monospace);padding:4px 7px;margin:0 3px;border-radius:6px;
  border:1px solid color-mix(in srgb,currentColor 30%,transparent);border-bottom-width:2px;background:color-mix(in srgb,currentColor 8%,transparent)}
.arx-rt__stage.is-wait{background:linear-gradient(160deg,#9f1239,#5b0b22);border-color:transparent;color:#fff}
.arx-rt__stage.is-go{background:linear-gradient(160deg,#22c55e,#15803d);border-color:transparent;color:#03230f}
.arx-rt__stage.is-foul{background:linear-gradient(160deg,#d97706,#92400e);border-color:transparent;color:#fff}
.arx-rt__stage.is-go .arx-rt__big{font-size:clamp(44px,15cqmin,128px)}
.arx-rt__rounds{display:grid;grid-template-columns:repeat(${ROUNDS},minmax(0,1fr));gap:var(--sp-3,8px);margin:0;padding:0;list-style:none}
.arx-rt__round{display:flex;flex-direction:column;align-items:center;gap:2px;padding:var(--sp-3,8px) var(--sp-2,6px);border-radius:var(--r-md,11px);
  background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-0,rgba(255,255,255,.05));min-width:0}
.arx-rt__round b{font-size:clamp(14px,3cqmin,20px);font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink-0,#fff);white-space:nowrap}
.arx-rt__round span{font-size:var(--fs-10,10px);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#888)}
.arx-rt__round.is-now{border-color:color-mix(in srgb,var(--ga) 60%,transparent);background:color-mix(in srgb,var(--ga) 12%,transparent)}
.arx-rt__round.is-best b{color:var(--ga)}
.arx-rt__round.is-empty b{color:var(--ink-4,#555)}
.arx-rt__sum{width:min(100%,440px);display:flex;flex-direction:column;gap:6px;margin-top:var(--sp-4,12px)}
.arx-rt__bar{display:grid;grid-template-columns:52px 1fr 64px;align-items:center;gap:var(--sp-3,8px);font-size:var(--fs-12,12px);color:var(--ink-2,#aaa)}
.arx-rt__bar i{display:block;height:8px;border-radius:99px;background:color-mix(in srgb,var(--ink-0,#fff) 22%,transparent)}
.arx-rt__bar.is-best i{background:var(--ga)}
.arx-rt__bar b{font-variant-numeric:tabular-nums;text-align:right;color:var(--ink-1,#ddd);font-weight:600}
.arx-rt__note{font-size:var(--fs-12,12px);color:var(--ink-3,#888);max-width:42ch;line-height:1.5;margin-top:var(--sp-2,6px)}
.arx-rt__live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.arx-rt{container-type:size}
@container (max-width:520px){.arx-rt__stage{padding:var(--sp-4,12px)}.arx-rt__round span{display:none}.arx-rt__round{padding:var(--sp-2,6px)}}
`;

/* Keys reach the game only while its window is the active one and focus
   is not parked on some other control (a shell button, a text field).
   The controller bridge (core/padmap.js) dispatches its synthetic keys
   straight to window, so for those the focused element stands in for
   the target (Node.contains(window) would throw). */
function ownsKey(root, e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!root.isConnected || !root.getClientRects().length) return false;
  const win = root.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target instanceof Element ? e.target : document.activeElement;
  if (!t || t === document.body || t === document.documentElement || root.contains(t)) return true;
  if (t.closest('input,textarea,select,button,a[href],[contenteditable="true"],[role="button"]')) return false;
  return !win || win.contains(t);
}

/* 'press Space to …' → the word Space drawn as a keycap */
const keyHint = text => text.split(/(Space)/).map(part =>
  part === 'Space' ? h('kbd', { text: 'Space' }) : document.createTextNode(part));

const avg = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};

    let dead = false;
    let paused = false;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let state = 'idle';            // idle | wait | go | foul | paused | result | done
    let timer = 0, frame = 0;
    let t0 = 0, goAt = 0, resultAt = 0;
    let fouls = 0;
    const times = [];
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };

    const style = h('style', { text: CSS });
    const glyph = h('div.arx-rt__glyph');
    const big = h('div.arx-rt__big');
    const sub = h('div.arx-rt__sub');
    const extra = h('div');
    const hint = h('div.arx-rt__hint');
    const live = h('div.arx-rt__live', { 'aria-live': 'assertive' });
    const stage = h('div.arx-rt__stage', { tabindex: '0', role: 'button', 'aria-label': 'Reaction test' },
      glyph, big, sub, extra, hint);
    const pills = Array.from({ length: ROUNDS }, (_, i) =>
      h('li.arx-rt__round', h('b', { text: '—' }), h('span', { text: `Round ${i + 1}` })));
    const rounds = h('ol.arx-rt__rounds', { 'aria-label': 'Round times' }, pills);
    const root = h('div.arx-rt', { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, style, stage, rounds, live);
    el.appendChild(root);

    const say = msg => { live.textContent = msg; };
    const setGlyph = name => { glyph.replaceChildren(name ? icon(name) : ''); glyph.hidden = !name; };

    function paintRounds() {
      const best = times.length ? Math.min(...times) : null;
      pills.forEach((li, i) => {
        const v = times[i];
        li.firstChild.textContent = v == null ? '—' : `${v}`;
        li.classList.toggle('is-empty', v == null);
        li.classList.toggle('is-now', v == null && i === times.length && state !== 'done');
        li.classList.toggle('is-best', v != null && v === best && times.length > 1);
      });
    }

    function view(next, { g, title, text, foot, label, body } = {}) {
      state = next;
      stage.className = 'arx-rt__stage' + (['wait', 'go', 'foul'].includes(next) ? ` is-${next}` : '');
      setGlyph(g);
      big.replaceChildren(...(Array.isArray(title) ? title : [title || '']));
      sub.textContent = text || '';
      sub.hidden = !text;
      extra.replaceChildren(...(body ? [body] : []));
      hint.replaceChildren(...(foot ? keyHint(foot) : []));
      stage.setAttribute('aria-label', label || (typeof title === 'string' ? title : 'Reaction test'));
      paintRounds();
    }

    const ms = n => [document.createTextNode(String(n)), h('small', { text: 'ms' })];

    function showIdle() {
      view('idle', {
        g: 'gauge', title: 'Reaction',
        text: 'When the panel turns green, click, tap or press Space as fast as you can. Five rounds.',
        foot: 'Click, tap or press Space to start',
        label: 'Reaction test. Press Space to start.',
      });
    }

    function startWait() {
      clearTimeout(timer); cancelAnimationFrame(frame);
      view('wait', { title: 'Wait for green…', text: `Round ${times.length + 1} of ${ROUNDS}`, label: 'Wait for green' });
      say('Wait for green');
      const wait = MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);
      timer = setTimeout(goGreen, wait);
    }

    function goGreen() {
      timer = 0;
      if (dead || paused || state !== 'wait') return;
      t0 = 0;
      goAt = performance.now();
      view('go', { title: coarse ? 'Tap!' : 'Click!', label: 'Green. Press now.' });
      /* the round starts on the frame that paints the green */
      frame = requestAnimationFrame(ts => { frame = 0; t0 = ts; });
      say('Green, go');
    }

    function foul() {
      clearTimeout(timer); timer = 0;
      fouls++;
      view('foul', {
        g: 'alert', title: 'Too soon!',
        text: 'That was before the green, so this round does not count.',
        foot: 'Click, tap or press Space to try the round again',
        label: 'Too soon. Press Space to try the round again.',
      });
      say('Too soon. That round does not count.');
    }

    function hit(stamp) {
      cancelAnimationFrame(frame); frame = 0;
      const start = t0 || goAt;
      let dt = stamp - start;
      if (!Number.isFinite(dt) || dt < 0 || dt > 60000) dt = performance.now() - start;
      dt = Math.max(1, Math.round(dt));
      times.push(dt);
      const running = avg(times);
      onScore(running);
      resultAt = performance.now();
      if (times.length >= ROUNDS) return finish();
      view('result', {
        g: 'zap', title: ms(dt),
        text: `Round ${times.length} of ${ROUNDS} · average so far ${running} ms`,
        foot: 'Click, tap or press Space for the next round',
        label: `${dt} milliseconds. Press Space for the next round.`,
      });
      say(`${dt} milliseconds`);
    }

    function finish() {
      const score = avg(times);
      const fastest = Math.min(...times);
      const slowest = Math.max(...times);
      const bars = h('div.arx-rt__sum', times.map((t, i) =>
        h('div.arx-rt__bar' + (t === fastest ? '.is-best' : ''),
          h('span', { text: `Round ${i + 1}` }),
          h('i', { style: { width: `${Math.max(6, Math.round((t / slowest) * 100))}%` } }),
          h('b', { text: `${t} ms` }))));
      const note = h('p.arx-rt__note', {
        text: 'Most people land somewhere around 200–300 ms. These times include your screen’s and your mouse’s own delay, which no web page can subtract.',
      });
      view('done', {
        g: 'gauge', title: ms(score),
        text: `Average of ${ROUNDS} rounds · fastest ${fastest} ms${fouls ? ` · ${fouls} early ${fouls === 1 ? 'click' : 'clicks'}` : ''}`,
        body: h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, bars, note),
        label: `Finished. Average ${score} milliseconds.`,
      });
      say(`Finished. Average ${score} milliseconds.`);
      onEnd({
        score, won: true,
        detail: `Average ${score} ms over ${ROUNDS} rounds · fastest ${fastest} ms · slowest ${slowest} ms${fouls ? ` · ${fouls} too soon` : ''}`,
        rounds: times.slice(), fouls,
      });
    }

    function press(stamp) {
      if (dead || paused) return;
      switch (state) {
        case 'idle': case 'foul': case 'paused': return startWait();
        case 'wait': return foul();
        case 'go': return hit(stamp);
        case 'result':
          if (performance.now() - resultAt < CONTINUE_GUARD) return;
          return startWait();
        default: return; // done: the shell takes it from here
      }
    }

    listen(stage, 'pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();          // keep focus on the stage, no text selection
      stage.focus({ preventScroll: true });
      press(e.timeStamp);
    });
    listen(stage, 'contextmenu', e => e.preventDefault());
    /* Space / Enter (a controller's A / Start arrive as these too, through
       the bridge). Once the five rounds are done the keys are left alone,
       so the Arcade's "Enter to play again" still reaches the shell. */
    listen(window, 'keydown', e => {
      if (e.key !== ' ' && e.key !== 'Enter' && e.code !== 'Space') return;
      if (dead || paused || state === 'done' || !ownsKey(root, e)) return;
      e.preventDefault();
      if (e.repeat) return;
      press(e.timeStamp);
    });

    showIdle();
    requestAnimationFrame(() => { if (!dead) stage.focus({ preventScroll: true }); });

    return {
      stop() {
        if (dead) return;
        dead = true;
        clearTimeout(timer); cancelAnimationFrame(frame);
        offs.splice(0).forEach(off => off());
        root.remove();
      },
      /* A pause mid-round throws that round's wait away rather than
         letting the green fire while nobody is looking. */
      pause() {
        if (dead || paused) return;
        paused = true;
        clearTimeout(timer); timer = 0;
        cancelAnimationFrame(frame); frame = 0;
        if (state === 'wait' || state === 'go') {
          view('paused', { g: 'pause', title: 'Paused', text: 'This round will start over.', foot: 'Click, tap or press Space to go on', label: 'Paused. Press Space to go on.' });
        }
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        stage.focus({ preventScroll: true });
      },
    };
  },
};
