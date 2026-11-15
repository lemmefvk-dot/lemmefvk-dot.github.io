/* ============================================================
   arcade/aim.js — Aim Trainer: 30 targets, one at a time.

   Hit the start target and the clock starts. Each of the 30 targets
   after it appears somewhere new, at least a fair distance from the
   last one so every shot is a real flick. The clock stops on the
   30th hit. Score = total time in ms, lower is better; clicks that
   land off the target are counted as misses and shown with the
   accuracy, but they only cost you the time they took.

   Hits are judged by geometry, not by which element caught the
   event: distance from the target's centre against its radius (with
   a few extra px of slack for a fingertip). Positions are stored as
   fractions of the play area, so resizing the window mid-round keeps
   every target on screen.

   This one needs a pointer: a keyboard cannot aim. The start screen
   says so; the start target itself is a real button so the game can
   still be reached and started from the keyboard.

   Presets are the Arcade's modes (ctx.mode), each with its own best:
     Standard   30 targets, as above
     Small      30 targets at 60% of the size
     Precision  30 targets, and every miss adds a second to the time
     Tracking   one target that keeps moving for 30 seconds: keep the
                pointer on it (a finger held on the screen). Score =
                the share of the 30 s the pointer was on it, in %,
                higher is better; how long the longest unbroken hold
                was and how often it slipped off are shown too. Time
                on target is summed frame by frame from where the
                pointer really was, on the performance.now() clock.
   ============================================================ */
import { h } from '../core/dom.js';

const TARGETS = 30;
export const PRESETS = {
  classic: { size: 1, pen: 0 },
  small: { size: 0.6, pen: 0 },
  precision: { size: 1, pen: 1000 },
  tracking: { size: 1, pen: 0, track: true },
};
const TRACK_MS = 30000;

const CSS = `
.arx-aim{position:relative;width:100%;height:100%;min-height:300px;display:flex;flex-direction:column;gap:var(--sp-4,12px);padding:var(--sp-5,16px);
  box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);user-select:none;-webkit-user-select:none;container-type:size}
.arx-aim *{box-sizing:border-box}
.arx-aim__stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--sp-3,8px)}
.arx-aim__stat{padding:var(--sp-3,8px) var(--sp-4,12px);border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-0,rgba(255,255,255,.05));min-width:0}
.arx-aim__stat span{display:block;font-size:var(--fs-10,10px);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3,#888)}
.arx-aim__stat b{display:block;font-size:clamp(15px,3.4cqmin,22px);font-weight:700;color:var(--ink-0,#fff);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arx-aim__stat b small{font-size:.62em;font-weight:600;color:var(--ink-2,#aaa);margin-left:2px}
.arx-aim__stage{position:relative;flex:1;min-height:180px;border-radius:var(--r-xl,20px);overflow:hidden;cursor:crosshair;touch-action:none;
  border:1px solid var(--line-1,rgba(255,255,255,.08));
  background:
    radial-gradient(circle at 50% 50%,color-mix(in srgb,var(--ga) 10%,transparent),transparent 65%),
    linear-gradient(var(--line-0,rgba(255,255,255,.05)) 1px,transparent 1px) 0 0/40px 40px,
    linear-gradient(90deg,var(--line-0,rgba(255,255,255,.05)) 1px,transparent 1px) 0 0/40px 40px,
    var(--fill-0,rgba(255,255,255,.03))}
.arx-aim__target{position:absolute;width:calc(var(--r)*2);height:calc(var(--r)*2);margin:calc(var(--r)*-1) 0 0 calc(var(--r)*-1);border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,var(--ga) 0 18%,#fff 19% 38%,var(--ga) 39% 62%,#fff 63% 78%,var(--ga) 79%);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--ga) 40%,transparent),0 8px 24px -6px color-mix(in srgb,var(--ga) 70%,transparent)}
.arx-aim__target.is-in{animation:arx-aim-pop .14s cubic-bezier(.34,1.46,.64,1)}
.arx-aim__target.is-track{transition:box-shadow .08s}
.arx-aim__target.is-on{box-shadow:0 0 0 4px #fff,0 0 26px 4px color-mix(in srgb,var(--ga) 80%,transparent)}
.arx-aim.is-reduced .arx-aim__target.is-track{transition:none}
@keyframes arx-aim-pop{from{transform:scale(.4);opacity:.3}to{transform:scale(1);opacity:1}}
.arx-aim__burst{position:absolute;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;border:3px solid var(--ga);pointer-events:none;animation:arx-aim-burst .38s ease-out forwards}
@keyframes arx-aim-burst{from{transform:scale(.4);opacity:.9}to{transform:scale(1.5);opacity:0}}
.arx-aim__miss{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;pointer-events:none;color:var(--ink-2,#aaa);animation:arx-aim-fade .6s ease-out forwards}
.arx-aim__miss::before,.arx-aim__miss::after{content:"";position:absolute;left:6px;top:0;width:2px;height:14px;border-radius:2px;background:currentColor;transform:rotate(45deg)}
.arx-aim__miss::after{transform:rotate(-45deg)}
@keyframes arx-aim-fade{from{opacity:1}to{opacity:0}}
.arx-aim.is-reduced .arx-aim__target.is-in,.arx-aim.is-reduced .arx-aim__burst,.arx-aim.is-reduced .arx-aim__miss{animation:none}
.arx-aim.is-reduced .arx-aim__burst{display:none}
.arx-aim__card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-3,8px);padding:var(--sp-6,20px);text-align:center;cursor:default}
.arx-aim__start{--r:clamp(34px,9cqmin,54px);position:relative;width:calc(var(--r)*2);height:calc(var(--r)*2);border-radius:50%;border:0;padding:0;cursor:pointer;margin-bottom:var(--sp-4,12px);
  background:radial-gradient(circle,var(--ga) 0 18%,#fff 19% 38%,var(--ga) 39% 62%,#fff 63% 78%,var(--ga) 79%);
  box-shadow:0 0 0 6px color-mix(in srgb,var(--ga) 18%,transparent),0 12px 32px -8px color-mix(in srgb,var(--ga) 80%,transparent);transition:transform .12s}
@media (hover:hover){.arx-aim__start:hover{transform:scale(1.05)}}
.arx-aim__start:focus-visible{outline:3px solid var(--ink-0,#fff);outline-offset:6px}
.arx-aim.is-reduced .arx-aim__start{transition:none}
.arx-aim__title{font-size:clamp(28px,7cqmin,52px);font-weight:800;letter-spacing:-.03em;color:var(--ink-0,#fff);line-height:1.05;font-variant-numeric:tabular-nums}
.arx-aim__title small{font-size:.45em;font-weight:700;letter-spacing:0;margin-left:.12em;color:var(--ink-2,#aaa)}
.arx-aim__text{font-size:clamp(13px,2.4cqmin,16px);color:var(--ink-2,#aaa);max-width:52ch;line-height:1.5;text-wrap:balance}
.arx-aim__card.is-done .arx-aim__title{font-size:clamp(44px,13cqmin,96px)}
.arx-aim__kicker{font-size:var(--fs-11,11px);letter-spacing:.12em;text-transform:uppercase;color:var(--ga);font-weight:700}
.arx-aim__note{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-12,12px);color:var(--ink-3,#888);padding:5px 10px;border-radius:99px;background:var(--fill-1,rgba(255,255,255,.06))}
.arx-aim__spark{display:flex;align-items:flex-end;gap:3px;height:64px;width:min(100%,480px);margin:var(--sp-4,12px) 0 var(--sp-2,6px)}
.arx-aim__spark i{flex:1;border-radius:2px 2px 0 0;background:color-mix(in srgb,var(--ink-0,#fff) 22%,transparent);min-height:3px}
.arx-aim__spark i.is-best{background:var(--ga)}
.arx-aim__legend{font-size:var(--fs-11,11px);color:var(--ink-3,#888)}
.arx-aim__paused{position:absolute;inset:0;display:grid;place-items:center;font-size:clamp(22px,5cqmin,34px);font-weight:800;color:#fff;background:rgba(6,4,10,.62)}
@container (max-width:520px){.arx-aim{padding:var(--sp-3,8px);gap:var(--sp-3,8px)}.arx-aim__stat{padding:6px 8px}.arx-aim__stats{gap:6px}}
`;

const fmtS = ms => (ms / 1000).toFixed(2);

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const MODE = PRESETS[ctx.mode] ? ctx.mode : 'classic', P = PRESETS[MODE];
    let trackMs = TRACK_MS;

    let dead = false, paused = false;
    let state = 'idle';            // idle | play | done
    let hits = 0, misses = 0;
    let runStart = 0, banked = 0;   // clock: banked ms + (now - runStart) while running
    let lastAt = 0, splitSoFar = 0;
    let frame = 0;
    let target = null;              // { x, y } as fractions of the stage
    const splits = [];
    const timers = new Set();
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

    const stat = (label, val) => { const b = h('b', val); return [h('div.arx-aim__stat', h('span', { text: label }), b), b]; };
    const [sTargets, vTargets] = stat(P.track ? 'Time left' : 'Targets', `0 / ${TARGETS}`);
    const [sTime, vTime] = stat(P.track ? 'On target' : 'Time', '0.00');
    const [sAcc, vAcc] = stat(P.track ? 'Longest hold' : 'Accuracy', '—');
    const [sMiss, vMiss] = stat(P.track ? 'Slipped off' : 'Misses', '0');
    const stats = h('div.arx-aim__stats', { 'aria-live': 'off' }, sTargets, sTime, sAcc, sMiss);
    const stage = h('div.arx-aim__stage', { role: 'application', 'aria-label': 'Aim trainer play area' });
    const live = h('div', { 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } });
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const root = h('div.arx-aim' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), stats, stage, live);
    el.appendChild(root);

    const elapsed = () => banked + (state === 'play' && !paused ? performance.now() - runStart : 0);
    const radius = () => {
      const r = stage.getBoundingClientRect();
      return Math.max(18 * P.size, Math.min(34, Math.min(r.width, r.height) * 0.045) * P.size);
    };

    function paintStats() {
      if (P.track) {
        const ms = Math.min(trackMs, elapsed());
        vTargets.replaceChildren(fmtS(Math.max(0, trackMs - ms)), h('small', { text: 's' }));
        vTime.textContent = ms > 0 ? `${Math.round((T.onMs / ms) * 100)}%` : '—';
        vAcc.replaceChildren(fmtS(T.best), h('small', { text: 's' }));
        vMiss.textContent = String(T.slips);
        return;
      }
      vTargets.replaceChildren(`${hits}`, h('small', { text: `/ ${TARGETS}` }));
      vTime.replaceChildren(fmtS(elapsed()), h('small', { text: 's' }));
      const shots = hits + misses;
      vAcc.textContent = shots ? `${Math.round((hits / shots) * 100)}%` : '—';
      vMiss.textContent = P.pen && misses ? `${misses} (+${misses * P.pen / 1000} s)` : String(misses);
    }

    function tick() {
      frame = 0;
      if (dead || paused || state !== 'play') return;
      vTime.firstChild.textContent = fmtS(elapsed());
      frame = requestAnimationFrame(tick);
    }

    /* ---- Tracking: one target that keeps moving; the pointer's time on it is the score ---- */
    const T = { ptr: null, on: false, onMs: 0, hold: 0, best: 0, slips: 0, last: 0, wp: null, shown: -1 };
    const seen = e => { T.ptr = { x: e.clientX, y: e.clientY }; };
    /* a waypoint at least a quarter of the area's diagonal away */
    function waypoint() {
      const r = stage.getBoundingClientRect(), rad = radius();
      const padX = Math.min(0.45, (rad + 10) / Math.max(1, r.width)), padY = Math.min(0.45, (rad + 10) / Math.max(1, r.height));
      let p = null;
      for (let i = 0; i < 30; i++) {
        p = { x: padX + Math.random() * (1 - padX * 2), y: padY + Math.random() * (1 - padY * 2) };
        if (!target || Math.hypot((p.x - target.x) * r.width, (p.y - target.y) * r.height) > Math.hypot(r.width, r.height) * 0.25) break;
      }
      return p;
    }
    function trackFrame(ts) {
      frame = 0;
      if (dead || paused || state !== 'play') return;
      const now = Number.isFinite(ts) ? Math.max(ts, T.last) : performance.now();
      /* this frame covers (T.last, now]; only the part inside the round counts */
      const dms = Math.max(0, now - T.last);
      const before = banked + (T.last - runStart);
      T.last = now;
      const add = Math.max(0, Math.min(dms, trackMs - before));
      const r = stage.getBoundingClientRect();
      const dot = stage.querySelector('.arx-aim__target');
      /* the move: toward the waypoint at a steady speed, a new one on arrival (a stall doesn't jump it) */
      const sp = Math.min(r.width, r.height) * 0.42;
      let px = target.x * r.width, py = target.y * r.height;
      const dx = T.wp.x * r.width - px, dy = T.wp.y * r.height - py, d = Math.hypot(dx, dy);
      if (d < 6) T.wp = waypoint();
      else { const k = Math.min(d, sp * Math.min(0.05, dms / 1000)) / d; px += dx * k; py += dy * k; }
      target.x = px / Math.max(1, r.width); target.y = py / Math.max(1, r.height); target.r = radius();
      if (dot) { dot.style.left = `${target.x * 100}%`; dot.style.top = `${target.y * 100}%`; dot.style.setProperty('--r', `${target.r}px`); }
      /* the judge: where the pointer really is, against the target as it is now */
      const inside = !!T.ptr && Math.hypot(T.ptr.x - r.left - px, T.ptr.y - r.top - py) <= target.r + 2;
      if (inside) { T.onMs += add; T.hold += add; T.best = Math.max(T.best, T.hold); }
      else { if (T.on) T.slips++; T.hold = 0; }
      T.on = inside;
      dot?.classList.toggle('is-on', inside);
      if (banked + (now - runStart) >= trackMs) return finishTrack();
      paintStats();
      const pct = Math.round((T.onMs / Math.max(1, elapsed())) * 100);
      if (pct !== T.shown) { T.shown = pct; onScore(pct); }
      frame = requestAnimationFrame(trackFrame);
    }
    function startTrack() {
      Object.assign(T, { on: false, onMs: 0, hold: 0, best: 0, slips: 0, last: performance.now(), shown: -1 });
      target = { x: 0.5, y: 0.5, r: radius() };
      T.wp = waypoint();
      stage.appendChild(h('div.arx-aim__target.is-track', { style: { left: '50%', top: '50%', '--r': `${target.r}px` } }));
      frame = requestAnimationFrame(trackFrame);
    }
    function finishTrack() {
      state = 'done';
      banked = trackMs;
      cancelAnimationFrame(frame); frame = 0;
      const pct = Math.round((T.onMs / trackMs) * 100);
      paintStats();
      onScore(pct);
      const secs = Math.round(trackMs / 1000);
      stage.replaceChildren(h('div.arx-aim__card.is-done',
        h('div.arx-aim__kicker', { text: 'Finished' }),
        h('div.arx-aim__title', `${pct}`, h('small', { text: '%' })),
        h('div.arx-aim__text', { text: `On target for ${fmtS(T.onMs)} s of ${secs} · longest hold ${fmtS(T.best)} s · slipped off ${T.slips} ${T.slips === 1 ? 'time' : 'times'}` })));
      live.textContent = `Done. On target ${pct} percent of the time.`;
      onEnd({
        score: pct, won: true,
        detail: `On target ${pct}% of ${secs} s (${fmtS(T.onMs)} s) · longest hold ${fmtS(T.best)} s · slipped off ${T.slips} ${T.slips === 1 ? 'time' : 'times'}`,
        onMs: Math.round(T.onMs), longest: Math.round(T.best), slips: T.slips,
      });
    }

    /* a new spot at least ~30% of the area's diagonal away from the last */
    function place() {
      const r = stage.getBoundingClientRect();
      const rad = radius();
      const padX = Math.min(0.45, (rad + 8) / Math.max(1, r.width));
      const padY = Math.min(0.45, (rad + 8) / Math.max(1, r.height));
      const minD = Math.hypot(r.width, r.height) * 0.3;
      /* only where a click can actually land: not under something that
         floats over the window (a phone's account chip, a toast) */
      const reachable = p => {
        const top = document.elementFromPoint(r.left + p.x * r.width, r.top + p.y * r.height);
        return !!top && stage.contains(top);
      };
      let best = null;
      for (let i = 0; i < 40; i++) {
        const p = { x: padX + Math.random() * (1 - padX * 2), y: padY + Math.random() * (1 - padY * 2) };
        const d = target ? Math.hypot((p.x - target.x) * r.width, (p.y - target.y) * r.height) : Infinity;
        const reach = reachable(p);
        const rank = (reach ? 1e7 : 0) + Math.min(d, minD);
        if (!best || rank > best.rank) best = { ...p, rank };
        if (reach && d >= minD) break;
      }
      target = { x: best.x, y: best.y, r: rad };
      const dot = h('div.arx-aim__target.is-in', {
        style: { left: `${target.x * 100}%`, top: `${target.y * 100}%`, '--r': `${rad}px` },
      });
      stage.querySelector('.arx-aim__target')?.remove();
      stage.appendChild(dot);
    }

    function fx(cls, x, y, ms) {
      const n = h(cls, { style: { left: `${x}px`, top: `${y}px` } });
      stage.appendChild(n);
      later(() => n.remove(), ms);
    }

    function start(stamp) {
      if (state !== 'idle' || dead) return;
      state = 'play';
      stage.replaceChildren();
      hits = 0; misses = 0; banked = 0; splits.length = 0;
      runStart = lastAt = Number.isFinite(stamp) && stamp > 0 && Math.abs(performance.now() - stamp) < 1000 ? stamp : performance.now();
      if (P.track) {
        target = null;
        startTrack();
        paintStats();
        live.textContent = `Started. Keep the pointer on the moving target for ${Math.round(trackMs / 1000)} seconds.`;
        return;
      }
      place();
      paintStats();
      frame = requestAnimationFrame(tick);
      live.textContent = 'Started. Hit the targets.';
    }

    function shoot(e) {
      if (state !== 'play' || paused || dead) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      if (P.track) { seen(e); return; }            /* tracking: a touch puts the finger down; nothing to shoot */
      const now = Number.isFinite(e.timeStamp) && e.timeStamp > 0 && Math.abs(performance.now() - e.timeStamp) < 1000 ? e.timeStamp : performance.now();
      if (!target) return;
      /* judged from the stored geometry, not the element's box, which is
         still scaling up during the pop-in */
      const sr = stage.getBoundingClientRect();
      const x = e.clientX - sr.left, y = e.clientY - sr.top;
      const cx = target.x * sr.width, cy = target.y * sr.height;
      const slack = e.pointerType === 'touch' ? 10 : 2;
      if (Math.hypot(x - cx, y - cy) <= target.r + slack) {
        hits++;
        splits.push(now - lastAt);
        lastAt = now;
        if (!reduced) fx('div.arx-aim__burst', cx, cy, 400);
        if (hits >= TARGETS) return finish(now);
        place();
        onScore(Math.round(elapsed() + misses * P.pen));
      } else {
        misses++;
        fx('div.arx-aim__miss', x, y, 620);
      }
      paintStats();
    }

    function finish(now) {
      state = 'done';
      banked = banked + (now - runStart);
      cancelAnimationFrame(frame); frame = 0;
      const clockMs = Math.round(banked);
      /* Precision: every miss adds its penalty to the time */
      const penalty = misses * P.pen;
      const total = clockMs + penalty;
      const shots = hits + misses;
      const accuracy = Math.round((hits / shots) * 100);
      const avgMs = Math.round(clockMs / TARGETS);
      const fastest = Math.min(...splits), slowest = Math.max(...splits);
      paintStats();
      vTime.replaceChildren(fmtS(total), h('small', { text: 's' }));
      onScore(total);
      stage.replaceChildren(h('div.arx-aim__card.is-done',
        h('div.arx-aim__kicker', { text: 'Finished' }),
        h('div.arx-aim__title', `${fmtS(total)}`, h('small', { text: 's' })),
        h('div.arx-aim__text', { text: `${TARGETS} targets · ${avgMs} ms per target on average · ${accuracy}% accuracy${misses ? ` (${misses} ${misses === 1 ? 'miss' : 'misses'})` : ''}${penalty ? ` · ${fmtS(clockMs)} s on the clock + ${penalty / 1000} s for misses` : ''}` }),
        h('div.arx-aim__spark', { 'aria-hidden': 'true' }, splits.map(s =>
          h('i' + (s === fastest ? '.is-best' : ''), { style: { height: `${Math.max(6, (s / slowest) * 100)}%` } }))),
        h('div.arx-aim__legend', { text: `Time per target · fastest ${Math.round(fastest)} ms · slowest ${Math.round(slowest)} ms` })));
      live.textContent = `Done in ${fmtS(total)} seconds, ${accuracy} percent accuracy.`;
      onEnd({
        score: total, won: true,
        detail: `${fmtS(total)} s for ${TARGETS} targets (score in ms) · ${avgMs} ms each · ${accuracy}% accuracy${misses ? ` · ${misses} missed` : ''}${penalty ? ` (+${penalty / 1000} s)` : ''}`,
        hits, misses, accuracy,
      });
    }

    const INTRO = {
      classic: `Hit the target to start the clock, then hit ${TARGETS} more as fast as you can. Misses count against your accuracy.`,
      small: `Hit the target to start the clock, then hit ${TARGETS} small ones as fast as you can. Misses count against your accuracy.`,
      precision: `Hit the target to start the clock, then hit ${TARGETS} more. Every miss adds a second to your time, so aim before you click.`,
      tracking: `Hit the target to start, then keep the pointer on it as it moves for ${Math.round(TRACK_MS / 1000)} seconds. On a touch screen, keep your finger on it.`,
    };

    function intro() {
      const btn = h('button.arx-aim__start', { type: 'button', 'aria-label': 'Start. The clock begins when you hit this target.' });
      listen(btn, 'click', e => start(e.timeStamp));
      stage.replaceChildren(h('div.arx-aim__card',
        btn,
        h('div.arx-aim__title', { text: 'Aim Trainer' }),
        h('div.arx-aim__text', { text: INTRO[MODE] }),
        h('div.arx-aim__note', { text: 'Needs a mouse, trackpad or touch screen' })));
      paintStats();
      requestAnimationFrame(() => { if (!dead) btn.focus({ preventScroll: true }); });
    }

    listen(stage, 'pointerdown', shoot);
    listen(stage, 'contextmenu', e => { if (state === 'play') e.preventDefault(); });
    if (P.track) {
      /* where the pointer is: a mouse while it is over the area, a finger while it is down */
      listen(stage, 'pointermove', seen);
      listen(stage, 'pointerleave', () => { T.ptr = null; });
      listen(stage, 'pointerup', e => { if (e.pointerType === 'touch' || e.pointerType === 'pen') T.ptr = null; });
      listen(stage, 'pointercancel', () => { T.ptr = null; });
    }
    intro();

    return {
      stop() {
        if (dead) return;
        dead = true;
        cancelAnimationFrame(frame);
        timers.forEach(clearTimeout); timers.clear();
        offs.splice(0).forEach(off => off());
        root.remove();
      },
      pause() {
        if (dead || paused || state !== 'play') return;
        const now = performance.now();
        banked += now - runStart;
        splitSoFar = now - lastAt;
        paused = true;
        cancelAnimationFrame(frame); frame = 0;
        const dot = stage.querySelector('.arx-aim__target');
        if (dot) dot.hidden = true;
        stage.appendChild(h('div.arx-aim__paused', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        stage.querySelector('.arx-aim__paused')?.remove();
        const dot = stage.querySelector('.arx-aim__target');
        if (dot) dot.hidden = false;
        if (state === 'play') {
          /* the clock and the current target's split carry on from where
             they stopped, so a pause never counts */
          runStart = performance.now();
          lastAt = runStart - splitSoFar;
          T.last = runStart;
          frame = requestAnimationFrame(P.track ? trackFrame : tick);
        }
      },
      /* a read-only snapshot for automated play-tests (target in stage fractions) */
      peek: () => ({ mode: MODE, state, paused, hits, misses, ms: Math.round(elapsed()), target: target ? { ...target } : null,
        track: P.track ? { onMs: Math.round(T.onMs), best: Math.round(T.best), slips: T.slips, on: T.on, ms: trackMs } : null }),
      /* test hook — nothing in the game calls it: length(ms) shortens a tracking round before it starts */
      hook(cmd, arg) {
        if (cmd === 'length' && state === 'idle' && Number.isFinite(arg) && arg >= 1000) { trackMs = arg; return true; }
        return false;
      },
    };
  },
};
