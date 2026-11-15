/* ============================================================
   arcade/simkit.js — the screen half of the batch-newgames4 score
   games (Slab Tower, Soft Touchdown, Peg Drop, Sky Guard, Rock Drift).

   simGame(def) -> a game module { mount(el, ctx) } for Static Arcade.
   The rules are the def's (a ./sim-core.js rules module); this file
   does what every one of these games does the same way:

     · a canvas with a fixed logical view (def.VW × def.VH), letterboxed,
       and the pointer mapped into it;
     · fixed 1/60 s steps from whatever time a frame took, so the round
       plays the same on any screen, with ctx.speed slowing the clock
       (and keeping the round from setting a best);
     · every input becomes a logged event [step, code, …]; the log is
       what onEnd({ replay }) returns, and what the ghost and Watch it
       play back (ctx.ghost: a see-through run beside yours, or the run
       on its own);
     · pause()/resume() stop the frame loop altogether; a hidden window
       stops it too, and nothing is drawn while it is stopped;
     · ctx.reduced: no screen shake (the def's draw reads X.reduced).

   Per frame this allocates nothing of its own: one reused view object,
   no arrays built in the loop.

   The def: { title, hue, VW, VH, bg, create(seed), step(s), act(s, code,
   …args), score(s), detail(s), hint(isTouch), draw(g, s, X),
   keyEvent(s, code, down, ui) -> event | null, pointerEvent(s, kind, x,
   y, ui) -> event | null, sfx(ev, snd) -> true to shake, peek(s),
   consumeFirst, announce(ev) }.
   ============================================================ */
import { surface, looper, ownsKey, prompt, clamp, rng, coarse, sounder } from './kit.js';
import { DT, cleanLog } from './sim-core.js';

export function simGame(def) {
  return {
    mount(el, ctx = {}) {
      const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion');
      const snd = sounder(ctx);
      const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (rng(Date.now() >>> 0)() * 2 ** 32) >>> 0;
      const speedK = clamp(Number(ctx.speed) || 1, 0.5, 1);
      const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 ? ctx.ghost : null;
      const glog = GH ? cleanLog(GH.data.log) : null;
      const watch = !!(GH && GH.watch && glog);
      const G = glog && !watch ? def.create(seed) : null;
      let gk = 0, wk = 0, lastScore = -1;
      const S = def.create(seed);
      const log = [];
      const ui = {};
      const st = { state: watch ? 'watch' : 'ready', paused: false, acc: 0, shake: 0, time: 0, dt: 0, ended: false, endT: 0 };
      let dead = false;
      const sf = surface(el, def.title, () => draw());
      const V = { k: 1, ox: 0, oy: 0 };
      const view = () => {
        V.k = Math.min(sf.w / def.VW, sf.h / def.VH);
        V.ox = (sf.w - def.VW * V.k) / 2; V.oy = (sf.h - def.VH * V.k) / 2;
        return V;
      };
      const X = { G, time: 0, reduced, ui, shake: 0, speed: speedK, watch, state: st.state, ghostOn: !!G, seed, paused: false };
      ctx.onScore?.(0);

      const apply = ev => { log.push([S.t, ...ev]); def.act(S, ...ev); };
      function begin() {
        if (st.state !== 'ready') return;
        st.state = 'play';
        snd.wake();
      }
      function feed(s, lg, which) {
        let k = which === 'w' ? wk : gk;
        while (k < lg.length && lg[k][0] <= s.t) { def.act(s, ...lg[k].slice(1)); k++; }
        if (which === 'w') wk = k; else gk = k;
      }
      function events() {
        for (let i = 0; i < S.ev.length; i++) {
          const ev = S.ev[i];
          if (def.sfx?.(ev, snd, ui) && !reduced) st.shake = 0.25;
          const say = def.announce?.(ev);
          if (say) ctx.announce?.(say);
        }
        S.ev.length = 0;
      }

      const loop = looper(raw => {
        if (st.paused) return;
        st.time += raw; st.dt = raw;
        if (st.shake > 0) st.shake = Math.max(0, st.shake - raw);
        if (st.state === 'play' || st.state === 'watch') {
          st.acc += raw * speedK;
          let n = 0;
          while (st.acc >= DT && n++ < 8 && !S.over) {
            st.acc -= DT;
            if (watch) feed(S, glog, 'w');
            def.step(S);
            if (G) { feed(G, glog, 'g'); def.step(G); G.ev.length = 0; }
            events();
          }
          if (n >= 8) st.acc = 0;
          const sc = def.score(S);
          if (sc !== lastScore) { lastScore = sc; ctx.onScore?.(sc); }
          if (S.over) finish();
        }
        draw();
      });

      function finish() {
        if (st.ended) return;
        st.ended = true; st.state = 'over';
        draw();
        const score = def.score(S);
        ctx.onScore?.(score);
        st.endT = setTimeout(() => {
          if (dead) return;
          ctx.onEnd?.({
            score, won: false, detail: def.detail(S),
            ...(watch ? {} : { replay: { v: 1, log: log.map(a => a.slice()) } }), ...(speedK < 1 ? { assisted: true } : {}),
          });
        }, reduced ? 100 : 600);
      }

      function draw() {
        if (dead) return;
        sf.begin();
        const g = sf.g, v = view();
        g.fillStyle = def.bg || '#0b0f1a';
        g.fillRect(0, 0, sf.w, sf.h);
        const sx = st.shake > 0 && !reduced ? (Math.random() - 0.5) * 6 : 0;
        g.save(); g.translate(v.ox + sx, v.oy); g.scale(v.k, v.k);
        g.beginPath(); g.rect(0, 0, def.VW, def.VH); g.clip();
        X.time = st.time; X.dt = st.dt; X.state = st.state; X.paused = st.paused;
        def.draw(g, S, X);
        g.restore();
        if (st.state === 'ready') prompt(g, sf, def.title, def.hint(coarse()), def.hue);
        else if (st.paused) prompt(g, sf, 'Paused', 'Esc or P to carry on', def.hue);
        else if (st.state === 'over') prompt(g, sf, def.over || 'Round over', `${def.score(S)} points`, def.hue);
      }

      /* ------------------------------ input ------------------------------ */
      const onKey = e => {
        if (!ownsKey(el, e) || watch) return;
        /* a key that only moves the game's own cursor: nothing to log */
        if (def.uiKey?.(e.code, true, ui)) { e.preventDefault(); return; }
        const ev = def.keyEvent?.(S, e.code, true, ui);
        if (!ev && !(e.code === 'Space' && st.state === 'ready')) return;
        e.preventDefault();
        if (e.repeat) return;
        if (st.paused) return;
        if (st.state === 'ready') { begin(); if (def.consumeFirst || !ev) return; }
        if (st.state === 'play' && ev) apply(ev);
      };
      const onKeyUp = e => {
        if (watch) return;
        if (def.uiKey?.(e.code, false, ui)) return;
        const ev = def.keyEvent?.(S, e.code, false, ui);
        if (ev && st.state === 'play') apply(ev);
      };
      const pos = e => {
        const v = view(), r = sf.cv.getBoundingClientRect();
        return [clamp((e.clientX - r.left - v.ox) / v.k, 0, def.VW), clamp((e.clientY - r.top - v.oy) / v.k, 0, def.VH)];
      };
      const pointer = (kind, e) => {
        const p = pos(e);
        const ev = def.pointerEvent?.(S, kind, p[0], p[1], ui);
        if (ev && st.state === 'play' && !st.paused) apply(ev);
      };
      const onDown = e => {
        if (e.button > 0 || watch) return;
        e.preventDefault();
        if (st.paused) return;
        if (st.state === 'ready') { begin(); if (def.consumeFirst) { pointer('move', e); return; } }
        pointer('down', e);
        try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      };
      const onMove = e => { if (!watch) pointer('move', e); };
      const onUp = e => { if (!watch) pointer('up', e); };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKeyUp);
      sf.cv.addEventListener('pointerdown', onDown);
      sf.cv.addEventListener('pointermove', onMove);
      sf.cv.addEventListener('pointerup', onUp);
      sf.cv.addEventListener('pointercancel', onUp);
      const onVis = () => {
        if (dead || st.paused) return;
        if (document.hidden) loop.stop(); else { st.acc = 0; loop.start(); }
      };
      document.addEventListener('visibilitychange', onVis);
      draw();
      loop.start();

      return {
        stop() {
          if (dead) return; dead = true; clearTimeout(st.endT); loop.stop();
          window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
          document.removeEventListener('visibilitychange', onVis);
          sf.cv.removeEventListener('pointerdown', onDown); sf.cv.removeEventListener('pointermove', onMove);
          sf.cv.removeEventListener('pointerup', onUp); sf.cv.removeEventListener('pointercancel', onUp);
          snd.close(); sf.destroy();
        },
        pause() { if (dead || st.paused) return; st.paused = true; loop.stop(); draw(); },
        resume() { if (dead || !st.paused) return; st.paused = false; st.acc = 0; if (!document.hidden) loop.start(); },
        peek: () => ({
          state: st.state, paused: st.paused, seed, steps: S.t, score: def.score(S), over: S.over, speed: speedK, watch,
          logged: log.length, log: log.map(a => a.slice()), looping: loop.on,
          ghost: G ? { t: G.t, score: def.score(G), over: G.over } : null,
          ...(def.peek ? def.peek(S, ui) : {}),
        }),
        /* test hook — nothing in the game calls it: skip(seconds) plays on with the input as it is */
        hook(cmd, a) {
          if (cmd === 'skip') {
            const n = Math.round(Math.max(0, Number(a) || 0) / DT);
            for (let i = 0; i < n && !S.over; i++) {
              if (watch) feed(S, glog, 'w');
              def.step(S);
              if (G) { feed(G, glog, 'g'); def.step(G); G.ev.length = 0; }
              S.ev.length = 0;
            }
            if (S.over) finish();
            return true;
          }
          return false;
        },
      };
    },
  };
}
