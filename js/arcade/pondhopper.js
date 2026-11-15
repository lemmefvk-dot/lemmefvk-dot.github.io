/* ============================================================
   arcade/pondhopper.js — Pond Hopper for Static Arcade.

   A frog on a lily pad. It hops like a chess knight (two squares one
   way, one across) onto a pad it has not used; a pad it leaves
   sinks. Visit every pad once. Pads grow in number from level to
   level, in four packs of ten ponds (Shallows 5×5, Reeds 6×6, Lake
   7×7, Marsh 8×8). Every pond is made from a real tour and the
   play-tests solve each one with a separate search (./pond-logic.js),
   so there is always a way through.

   TODAY: one pond a day, 7×7, the same for everyone on the date
   (dailykit.js); the streak is kept on this device.

   Controls
     mouse / touch  tap a ringed pad to hop to it
     keyboard       arrows move the cursor · Space / Enter hops there ·
                    U or Z undo · H hint · R restart
   Hint: the search looks for a way to finish from where the frog is
   and marks the next pad; if none is left it says so, and you undo.
   A pond solved with a hint finishes but sets no best time.

   Score = seconds, lower is better. The best time of each pond and the
   pond you are on are kept on this device (portal.arcadePuzzles.pondhopper).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, surface, FONT } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import * as daily from './dailykit.js';
import { PACKS, PER_PACK, packLevel, dailyLevel, hopsFrom, solve } from './pond-logic.js';

const GAME = 'pondhopper';
const CSS = `${BASE}
.pz-ph__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-ph__stage{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);border-radius:14px;overflow:hidden;border:2px solid var(--line-2,rgba(255,255,255,.22));background:#0b2a35;outline:none}
.pz-ph__stage:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-ph__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(6,16,20,.8);text-align:center;padding:16px}
.pz-ph__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-ph__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz-ph__stuck{position:absolute;left:8px;right:8px;bottom:8px;z-index:3;padding:8px 10px;border-radius:10px;background:rgba(255,80,100,.9);color:#fff;font-size:13px;font-weight:650;text-align:center}
`;

const keyOf = (p, l) => `${p}:${l}`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let dead = false, paused = false;
    let pack = PACKS.some(p => p.id === sv.pack) ? sv.pack : 'shallows';
    let level = Math.max(1, Math.min(PER_PACK, Number(sv.level) || 1));
    let day = '';
    let lv = null, path = [], done = false, hints = 0, hintCell = -1, cur = 0, kbd = false, msg = '', ended = false, hopT = 0, raf = 0, from = -1;
    const clk = clock(secs => { timeV.textContent = fmtTime(secs); });

    /* ---------- chrome ---------- */
    const packBtns = PACKS.map(p => h('button', { type: 'button', dataset: { pack: p.id }, 'aria-pressed': 'false', title: `${p.n}×${p.n} ponds` }, p.label));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Pond pack' }, packBtns);
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous pond' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next pond' }, icon('chevron-right'));
    const levelV = h('span', { text: '1' });
    const levelRead = h('div.pz__read', { title: 'Pond', 'aria-label': 'Pond' }, icon('layers'), levelV);
    const dayStreak = h('small');
    const dayBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'daily' }, title: 'Today’s pond: the same one for everyone today' }, icon('calendar'), h('span', { text: 'Today' }), dayStreak);
    const hopsV = h('span', { text: '0' });
    const hopsRead = h('div.pz__read', { title: 'Pads visited', 'aria-label': 'Pads' }, icon('grid'), hopsV);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Take back the last hop (U)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
    const hintBtn = h('button.pz__btn', { type: 'button', title: 'Mark the next pad of a way to finish (H). A pond solved with a hint sets no best time.' }, icon('sparkles'), h('span.pz__long', { text: 'Hint' }));
    const resetBtn = h('button.pz__btn', { type: 'button', title: 'Start this pond again (R)' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', seg, prevBtn, levelRead, nextBtn, dayBtn);
    const bar = h('div.pz__bar', hopsRead, timeRead, bestV, undoBtn, hintBtn, resetBtn);
    const stage = h('div.pz-ph__stage', { tabindex: '0', role: 'application', 'aria-label': 'Pond Hopper pond' });
    const bw = h('div.pz-ph__bw', stage);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, bar, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Pond Hopper pond', () => draw());

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'hop like a knight to a pad you have not used · <kbd>←↑↓→</kbd> + <kbd>Space</kbd> · <kbd>U</kbd> undo · <kbd>H</kbd> hint' }));

    const here = () => path[path.length - 1];
    const legal = () => (lv && !done ? hopsFrom(here(), lv.n).filter(j => lv.pads.includes(j) && !path.includes(j)) : []);
    const left = () => (lv ? lv.pads.length - path.length : 0);
    const stuck = () => !!lv && !done && left() > 0 && legal().length === 0;
    const label = () => (day ? `Today’s pond (${daily.weekday(day)})` : `${PACKS.find(p => p.id === pack).label} ${level}`);

    /* ---------- drawing ---------- */
    const geom = () => { const n = lv.n, s = Math.min(sf.w, sf.h), pad = s * 0.04, c = (s - pad * 2) / n; return { n, c, ox: (sf.w - s) / 2 + pad, oy: (sf.h - s) / 2 + pad }; };
    const centre = (i, G = geom()) => [G.ox + (i % G.n + 0.5) * G.c, G.oy + (Math.floor(i / G.n) + 0.5) * G.c];
    function lily(g, x, y, r, fill, rot) {
      g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, rot + 0.28, rot + Math.PI * 2 - 0.28); g.lineTo(x, y); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = Math.max(1, r * 0.06); g.stroke();
    }
    function frog(g, x, y, r) {
      g.fillStyle = '#9be564'; g.beginPath(); g.ellipse(x, y + r * 0.12, r * 0.55, r * 0.46, 0, 0, 7); g.fill();
      g.fillStyle = '#7fd04a'; g.beginPath(); g.ellipse(x - r * 0.5, y + r * 0.42, r * 0.2, r * 0.12, 0.5, 0, 7); g.ellipse(x + r * 0.5, y + r * 0.42, r * 0.2, r * 0.12, -0.5, 0, 7); g.fill();
      g.fillStyle = '#9be564'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.3, r * 0.2, 0, 7); g.arc(x + r * 0.25, y - r * 0.3, r * 0.2, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.32, r * 0.11, 0, 7); g.arc(x + r * 0.25, y - r * 0.32, r * 0.11, 0, 7); g.fill();
      g.fillStyle = '#10200a'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.3, r * 0.055, 0, 7); g.arc(x + r * 0.25, y - r * 0.3, r * 0.055, 0, 7); g.fill();
    }
    function draw() {
      if (!lv || !sf.g) return;
      const g = sf.g, G = geom(), r = G.c * 0.4;
      sf.begin();
      const bg = g.createLinearGradient(0, 0, 0, sf.h);
      bg.addColorStop(0, '#0f3d4c'); bg.addColorStop(1, '#082029');
      g.fillStyle = bg; g.fillRect(0, 0, sf.w, sf.h);
      /* open water: a faint ripple where a pad is not */
      g.strokeStyle = 'rgba(160,220,240,.10)'; g.lineWidth = 1;
      for (let i = 0; i < G.n * G.n; i++) if (!lv.padSet.has(i)) { const [x, y] = centre(i, G); g.beginPath(); g.arc(x, y, G.c * 0.12, 0, 7); g.stroke(); }
      /* the trail */
      if (path.length > 1) {
        g.strokeStyle = 'rgba(255,255,255,.32)'; g.lineWidth = Math.max(2, G.c * 0.05); g.setLineDash([G.c * 0.1, G.c * 0.1]); g.lineCap = 'round'; g.beginPath();
        path.forEach((c, k) => { const [x, y] = centre(c, G); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
      }
      const targets = new Set(legal());
      lv.pads.forEach(i => {
        const [x, y] = centre(i, G), order = path.indexOf(i), used = order >= 0;
        lily(g, x, y, r, used ? '#1d5a45' : i === hintCell ? '#8dff9a' : '#3fbf6d', (i * 1.7) % 6.28);
        if (!used) { g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.28, r * 0.35, r * 0.14, -0.4, 0, 7); g.fill(); }
        if (used && i !== here()) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `700 ${Math.round(G.c * 0.3)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(order + 1), x, y); }
        if (targets.has(i)) {
          g.strokeStyle = ctx.accent || '#ffd24a'; g.lineWidth = Math.max(2, G.c * 0.07); g.beginPath(); g.arc(x, y, r * 1.12, 0, 7); g.stroke();
        }
        if (i === hintCell) { g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, G.c * 0.06); g.setLineDash([G.c * 0.1, G.c * 0.08]); g.beginPath(); g.arc(x, y, r * 1.28, 0, 7); g.stroke(); g.setLineDash([]); }
      });
      /* the frog, mid-hop while it moves */
      const [fx, fy] = centre(here(), G);
      let px = fx, py = fy, lift = 0;
      if (hopT > 0 && from >= 0) {
        const [ax, ay] = centre(from, G), t = 1 - hopT;
        px = ax + (fx - ax) * t; py = ay + (fy - ay) * t; lift = Math.sin(t * Math.PI) * G.c * 0.35;
      }
      if (lift) { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(px, py + r * 0.4, r * 0.5, r * 0.18, 0, 0, 7); g.fill(); }
      frog(g, px, py - lift, r);
      if (kbd && !done) {
        const [kx, ky] = centre(cur, G);
        g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.strokeRect(kx - G.c * 0.46, ky - G.c * 0.46, G.c * 0.92, G.c * 0.92);
      }
    }
    function tick(now) {
      raf = 0;
      if (dead) return;
      hopT = Math.max(0, hopT - 0.075);
      draw();
      if (hopT > 0) raf = requestAnimationFrame(tick);
    }
    const kick = () => { if (reduced) { hopT = 0; draw(); return; } hopT = 1; if (!raf) raf = requestAnimationFrame(tick); };

    function paint() {
      const st = daily.status(GAME);
      packBtns.forEach(b => b.setAttribute('aria-pressed', String(!day && b.dataset.pack === pack)));
      levelV.textContent = day ? 'Today' : `${level}/${PER_PACK}`;
      hopsV.textContent = `${path.length}/${lv.pads.length}`;
      const bk = day ? '' : keyOf(pack, level);
      bestV.textContent = bk && bests[bk] != null ? `Best: ${fmtTime(bests[bk])}` : '';
      prevBtn.disabled = !!day || (level <= 1 && pack === PACKS[0].id);
      nextBtn.disabled = !!day;
      dayBtn.setAttribute('aria-pressed', String(!!day));
      const sk = st.streak ? `s${st.streak}` : st.solved ? 'ok' : '';
      if (dayStreak.dataset.k !== sk) { dayStreak.dataset.k = sk; dayStreak.replaceChildren(...(st.streak ? [icon('flame'), String(st.streak)] : st.solved ? [icon('check')] : [])); }
      dayBtn.title = `Today’s pond: the same one for everyone today${st.solved ? ' · solved' : ''}${st.streak ? ` · ${st.streak}-day streak on this device` : ''}${st.best ? ` · best streak ${st.best}` : ''}`;
      undoBtn.disabled = path.length < 2 || done;
      hintBtn.disabled = done;
      stage.querySelector('.pz-ph__stuck')?.remove();
      if (stuck()) stage.appendChild(h('div.pz-ph__stuck', { text: 'No hops left from here. Undo a few, or start again.' }));
      draw();
    }

    /* ---------- play ---------- */
    function open(level0, dayKey = '') {
      day = dayKey;
      if (day) lv = dailyLevel(daily.daySeed(GAME, day), daily.parseDay(day).getDay());
      else lv = packLevel(pack, level0);
      lv = { ...lv, padSet: new Set(lv.pads) };
      path = [lv.start]; done = false; ended = false; paused = false; hints = 0; hintCell = -1; hopT = 0; from = -1; msg = '';
      cur = lv.start;
      bw.querySelector('.pz__cover')?.remove(); stage.querySelector('.pz-ph__card')?.remove();
      clk.dispose(); clk.secs = 0; timeV.textContent = '0:00';
      if (!day) save(GAME, { pack, level });
      onScore(0);
      paint();
      say(`${label()}: ${lv.pads.length} pads on a ${lv.n}×${lv.n} pond. Hop to every one, once each.`);
    }
    const goto = (p, l) => { if (dead) return; pack = p; level = l; open(l); };
    function nextPond() {
      const i = PACKS.findIndex(p => p.id === pack);
      if (level < PER_PACK) return [pack, level + 1];
      return i < PACKS.length - 1 ? [PACKS[i + 1].id, 1] : [pack, PER_PACK];
    }
    const can = () => !dead && !paused && !done && !!lv;
    function hop(to) {
      if (!can() || !legal().includes(to)) return false;
      if (path.length === 1) clk.start();
      from = here(); path.push(to); hintCell = -1; cur = to;
      hopsV.textContent = `${path.length}/${lv.pads.length}`;
      onScore(path.length - 1);
      kick();
      if (left() === 0) win(); else { paint(); say(stuck() ? 'No hops left from here.' : `${left()} pad${left() === 1 ? '' : 's'} to go.`); }
      return true;
    }
    function win() {
      done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      let extra = '', fresh = false;
      const bk = keyOf(pack, level), prev = bests[bk];
      if (!day && hints === 0 && (prev == null || secs < prev)) { fresh = true; bests[bk] = secs; save(GAME, { best: bests }); }
      if (day) {
        const r = daily.solved(GAME, day, secs, hints);
        extra = r.already ? ' You had already solved today’s pond, so the streak stays as it was.' : ` Streak: ${r.streak} day${r.streak === 1 ? '' : 's'}.`;
      } else {
        const nx = nextPond();
        if (nx[0] !== pack || nx[1] !== level) save(GAME, { pack: nx[0], level: nx[1] });
      }
      paint();
      stage.appendChild(h('div.pz-ph__card', h('div', h('b', { text: 'Every pad visited!' }),
        h('span', { text: `${label()} in ${fmtTime(secs)}${fresh && prev != null ? ' — a new best' : ''}${hints ? `, with ${hints} hint${hints === 1 ? '' : 's'} (no best time)` : ''}.${extra}${day ? '' : ' Play again for the next pond.'}` }))));
      say(`Every pad visited in ${fmtTime(secs)}.${extra}`);
      onScore(secs);
      if (!ended) { ended = true; onEnd({ score: secs, won: true, detail: `${label()} · ${lv.pads.length} pads${hints ? ` · ${hints} hint${hints === 1 ? '' : 's'}` : ''}`, ...(hints ? { assisted: true } : day ? { assisted: 'Today’s pond counts for your streak, not your best' } : {}) }); }
    }
    function undo() {
      if (!can() || path.length < 2) return;
      path.pop(); hintCell = -1; cur = here(); hopT = 0;
      onScore(path.length - 1);
      paint(); say('Hop taken back.');
    }
    function hint() {
      if (!can()) return;
      const way = solve(lv, path, here());
      hints++;
      if (!way) { hintCell = -1; paint(); say(solve.lastBlown ? 'The search could not tell from here. Try undoing a few hops.' : 'No way to finish from here: undo a few hops.'); return; }
      hintCell = way[0]; paint(); say('A ringed pad marks a way on that can still be finished.');
    }
    const restart = () => { if (!dead) open(level, day); };

    /* ---------- input ---------- */
    const cellAt = ev => {
      const b = sf.cv.getBoundingClientRect(), G = geom();
      const x = Math.floor((ev.clientX - b.left - G.ox) / G.c), y = Math.floor((ev.clientY - b.top - G.oy) / G.c);
      return x >= 0 && y >= 0 && x < G.n && y < G.n ? y * G.n + x : -1;
    };
    L.on(sf.cv, 'pointerdown', e => {
      if (e.button > 0) return;
      const c = cellAt(e);
      if (c < 0) return;
      kbd = false; cur = c; hop(c); draw();
      stage.focus({ preventScroll: true });
    });
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || !lv || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        if (!can()) return;
        e.preventDefault(); kbd = true;
        const n = lv.n, x = cur % n + MOVE[k][0], y = Math.floor(cur / n) + MOVE[k][1];
        if (x >= 0 && y >= 0 && x < n && y < n) cur = y * n + x;
        draw();
      } else if (k === ' ' || k === 'Enter') { if (!can()) return; e.preventDefault(); unfocus(); if (!e.repeat) { kbd = true; hop(cur); draw(); } }
      else if (k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
      else if (k === 'h' || k === 'H') { e.preventDefault(); hint(); }
      else if (k === 'r' || k === 'R') { e.preventDefault(); restart(); }
    });
    packBtns.forEach(b => L.on(b, 'click', () => goto(b.dataset.pack, 1)));
    L.on(prevBtn, 'click', () => { if (level > 1) goto(pack, level - 1); else { const i = PACKS.findIndex(p => p.id === pack); if (i > 0) goto(PACKS[i - 1].id, PER_PACK); } });
    L.on(nextBtn, 'click', () => { const nx = nextPond(); goto(nx[0], nx[1]); });
    L.on(dayBtn, 'click', () => { if (!dead) open(level, daily.dayKey()); });
    L.on(undoBtn, 'click', undo);
    L.on(hintBtn, 'click', hint);
    L.on(resetBtn, 'click', restart);

    open(level);
    requestAnimationFrame(() => { if (!dead) stage.focus({ preventScroll: true }); });

    return {
      stop() { if (dead) return; dead = true; cancelAnimationFrame(raf); clk.dispose(); L.clear(); sf.destroy(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; clk.stop(); if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (path.length > 1 && !done) clk.start(); },
      peek: () => lv && ({
        pack, level, day: day || null, n: lv.n, pads: lv.pads.slice(), start: lv.start, path: path.slice(), here: here(), legal: legal(), left: left(), done, stuck: stuck(),
        paused, hints, hint: hintCell, secs: clk.secs, best: { ...bests }, daily: daily.status(GAME),
        /* where the board is on the page, in CSS pixels: a pad's centre is (left + ox + (x + .5) c, top + oy + (y + .5) c) */
        geo: (() => { const G = geom(), b = sf.cv.getBoundingClientRect(); return { left: b.left, top: b.top, ox: G.ox, oy: G.oy, c: G.c, n: G.n }; })(),
      }),
      /* test hook — nothing in the game calls it: level(pack, n) */
      hook(cmd, a, b) { if (cmd === 'level') goto(a, b); return true; },
    };
  },
};
