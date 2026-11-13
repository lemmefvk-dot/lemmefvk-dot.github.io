/* ============================================================
   arcade/jigsaw.js — Photo Jigsaw for Static Arcade.

   Pick a picture from your Pictures folder (or one of the wallpapers
   StaticOS ships with), pick a piece count, and the picture is cut
   into real interlocking pieces and scattered. Drag a piece near its
   place and it snaps in; fill the board to finish.

   Your photo stays on this device. The bytes are read from the
   browser's own storage, shrunk to at most 1280 px on the long side
   (so a 40-megapixel photo is as light as a small one), and cut into
   pieces in a canvas. Nothing is uploaded, and the saved progress is
   only the picture's path, the piece count, a seed and where each
   piece sits — never the picture.

   Controls
     mouse / touch  drag a piece; drop it near its place to snap it
     keyboard       N / P choose the next / previous loose piece (the
                    game says which row and column it belongs in) ·
                    arrows move along the board's squares · Space /
                    Enter put the chosen piece on that square (it
                    only stays if it belongs there) · V preview
   Score = seconds to finish, lower is better. The unfinished puzzle
   survives a reload (portal.arcadePuzzles.jigsaw).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import media from '../core/media.js';
import { listPictures, bitmapOf, sizeOfBitmap, picturesDir } from '../photos/pt-common.js';
import { ownsKey, sounder, randomSeed } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag, clock, fmtTime } from './puzzlekit.js';
import { COUNTS, MARGIN, gridFor, workSize, makeEdges, piecePath, geometry, home, snaps, scatter, packState, unpackState, placedCount } from './jigsaw-logic.js';

const GAME = 'jigsaw';
const BUNDLED = [
  { name: 'Canopy', ref: 'assets/wallpapers/canopy.jpg' },
  { name: 'Earthrise', ref: 'assets/wallpapers/earthrise.jpg' },
  { name: 'Lamplight', ref: 'assets/wallpapers/lamplight.jpg' },
  { name: 'Sakura Moon', ref: 'assets/wallpapers/sakura-moon.jpg' },
];

const CSS = `${BASE}
.pz-jg__stage{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;border-radius:12px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));overflow:hidden}
.pz-jg__cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;cursor:grab}
.pz-jg__cv:focus-visible{box-shadow:inset 0 0 0 2px var(--ga)}
.pz-jg__pick{position:absolute;inset:0;overflow:auto;padding:var(--sp-4,12px);display:flex;flex-direction:column;gap:10px;z-index:3;background:#0d0f16}
.pz-jg__pick h3{margin:0;font-size:16px;color:#fff}
.pz-jg__pick h4{margin:6px 0 0;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3,#999)}
.pz-jg__pick p{margin:0;font-size:12px;color:var(--ink-2,#bbb)}
.pz-jg__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.pz-jg__thumb{display:flex;flex-direction:column;gap:4px;padding:5px;border-radius:10px;background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.1));color:var(--ink-1,#ddd);cursor:pointer;text-align:left;font:600 11px/1.2 var(--font,system-ui)}
.pz-jg__thumb:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
@media (hover:hover){.pz-jg__thumb:hover{background:var(--fill-2,rgba(255,255,255,.12))}}
.pz-jg__thumb img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:7px;background:#181b27;display:block}
.pz-jg__thumb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pz-jg__row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.pz-jg__msg{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.8);text-align:center;padding:16px;color:#fff}
.pz-jg__msg span{display:block;font-size:13px;color:var(--ink-2,#bbb);margin-top:6px}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    const best = { ...(sv.best || {}) };
    let wantCount = COUNTS.includes(Number(sv.count)) ? Number(sv.count) : 24;

    /* the puzzle in play */
    let P = null;               /* { src, count, cols, rows, seed, aspect, geo, edges, work, pieces, mPx, scale0 } */
    let phase = 'pick', done = false, preview = false, kbd = false, sel = -1, slotCur = 0, z = 0, msg = '';
    let drawMs = 0, prepMs = 0, drag = null, token = 0, saveTimer = 0, raf = 0, flashUntil = 0, lastSecs = -1;
    let view = { w: 0, h: 0, dpr: 1, S: 1, bx: 0, by: 0 };

    const clk = clock(t => { const s = Math.floor(t); if (s !== lastSecs) { lastSecs = s; timeV.textContent = fmtTime(t); onScore(s); } });
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const placedV = h('span', { text: '0/0' });
    const placedRead = h('div.pz__read', { title: 'Pieces in place', 'aria-label': 'Pieces in place' }, icon('layers'), placedV);
    const bestV = h('small', { text: '' });
    const previewBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Show the whole picture (V)' }, icon('eye'), h('span.pz__long', { text: 'Preview' }));
    const restartBtn = h('button.pz__btn', { type: 'button', title: 'Scatter the pieces and start again' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Choose a different picture' }, icon('image'), h('span.pz__long', { text: 'New picture' }));
    const top = h('div.pz__top', placedRead, timeRead, bestV, previewBtn, restartBtn, newBtn);
    const cv = h('canvas.pz-jg__cv', { tabindex: '0', role: 'application', 'aria-label': 'Jigsaw board' });
    const g = cv.getContext('2d');
    const hit = document.createElement('canvas').getContext('2d');
    const stage = h('div.pz-jg__stage', cv);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, stage, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'drag a piece next to where it belongs · keyboard: <kbd>N</kbd>/<kbd>P</kbd> choose a piece · <kbd>←↑↓→</kbd> pick a square · <kbd>Space</kbd> place · <kbd>V</kbd> preview' }));

    /* ---------- drawing ---------- */
    const dirty = () => { if (!raf && !dead) raf = requestAnimationFrame(draw); };
    function layout() {
      const r = stage.getBoundingClientRect();
      const w = Math.max(60, Math.floor(r.width - 4)), hh = Math.max(60, Math.floor(r.height - 4));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      view.w = w; view.h = hh; view.dpr = dpr;
      if (P) {
        const bh = P.geo.boardH;
        view.S = Math.max(40, Math.min(w * 0.6, hh * 0.6 / bh));
        view.bx = (w - view.S) / 2; view.by = (hh - view.S * bh) / 2;
        keepInside();
      }
      dirty();
    }
    const area = () => {
      const { S, bx, by, w, h: hh } = view, geo = P.geo;
      return { x0: (-bx) / S + 0.01, y0: (-by) / S + 0.01, x1: (w - bx) / S - geo.pw - 0.01, y1: (hh - by) / S - geo.ph - 0.01 };
    };
    function keepInside() {
      const a = area();
      for (const p of P.pieces) if (!p.locked) { p.x = Math.max(a.x0, Math.min(a.x1, p.x)); p.y = Math.max(a.y0, Math.min(a.y1, p.y)); }
    }
    function pathOf(p) {
      const q = new Path2D();
      q.moveTo(...p.start);
      for (const s of p.segs) q.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.to[0], s.to[1]);
      q.closePath();
      return q;
    }
    function draw() {
      raf = 0;
      if (dead) return;
      const t0 = performance.now();
      g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      g.clearRect(0, 0, view.w, view.h);
      if (!P) return;
      const { S, bx, by } = view, geo = P.geo, bh = S * geo.boardH, now = performance.now();
      g.fillStyle = 'rgba(255,255,255,.05)';
      g.fillRect(bx, by, S, bh);
      g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
      g.beginPath();
      for (let c = 0; c <= geo.cols; c++) { g.moveTo(bx + c * geo.pw * S, by); g.lineTo(bx + c * geo.pw * S, by + bh); }
      for (let r = 0; r <= geo.rows; r++) { g.moveTo(bx, by + r * geo.ph * S); g.lineTo(bx + S, by + r * geo.ph * S); }
      g.stroke();
      if (preview) { g.globalAlpha = 0.45; g.drawImage(P.work, bx, by, S, bh); g.globalAlpha = 1; }
      const k = S / P.work.width, mp = P.mPx * k;
      const put = p => {
        const c = P.canvases[p.id];
        g.drawImage(c, bx + p.x * S - mp, by + p.y * S - mp, c.width * k, c.height * k);
      };
      for (const p of P.pieces) if (p.locked) put(p);
      const loose = P.pieces.filter(p => !p.locked).sort((a, b) => a.z - b.z);
      for (const p of loose) {
        if (drag && drag.p === p) { g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 14; g.shadowOffsetY = 5; put(p); g.restore(); }
        else put(p);
      }
      if (kbd && !done) {
        const hs = home(geo, slotCur);
        g.strokeStyle = getComputedStyle(root).getPropertyValue('--ga') || '#fff'; g.lineWidth = 3; g.setLineDash([6, 4]);
        g.strokeRect(bx + hs.x * S + 1.5, by + hs.y * S + 1.5, geo.pw * S - 3, geo.ph * S - 3); g.setLineDash([]);
        const sp = sel >= 0 ? P.pieces[sel] : null;
        if (sp && !sp.locked) {
          g.save(); g.translate(bx + sp.x * S - mp, by + sp.y * S - mp); g.scale(k, k);
          g.lineWidth = 3 / k; g.strokeStyle = '#fff'; g.stroke(P.paths[sp.id]); g.restore();
        }
      }
      if (!reduced) {
        for (const p of P.pieces) {
          if (p.flash && now < p.flash) {
            const a = (p.flash - now) / 300;
            g.save(); g.translate(bx + p.x * S - mp, by + p.y * S - mp); g.scale(k, k);
            g.lineWidth = 4 / k; g.strokeStyle = `rgba(255,255,255,${a})`; g.stroke(P.paths[p.id]); g.restore();
          }
        }
        if (now < flashUntil) dirty();
      }
      drawMs = drawMs ? drawMs * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0;
    }

    /* ---------- the picture ---------- */
    async function blobOfSource(src) {
      if (src.kind === 'asset') {
        const res = await fetch(src.ref);
        if (!res.ok) throw new Error('That wallpaper could not be read.');
        return res.blob();
      }
      const b = await media.blobOf(src.ref);
      if (!b) throw new Error('That picture is no longer in this browser. Choose another.');
      return b;
    }
    /* the longest side is cut to MAX_SIDE here, in memory: the full-size photo is dropped straight away */
    async function makeWork(blob) {
      const bmp = await bitmapOf(blob);
      try {
        const { w, h: hh } = sizeOfBitmap(bmp);
        if (!w || !hh) throw new Error('That file is not a picture the browser can open.');
        const ws = workSize(w, hh);
        const c = document.createElement('canvas');
        c.width = ws.w; c.height = ws.h;
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(bmp, ws.sx, ws.sy, ws.sw, ws.sh, 0, 0, ws.w, ws.h);
        return { canvas: c, source: { w, h: hh } };
      } finally { try { bmp.close?.(); } catch (err) { /* an <img> has no close */ } }
    }
    function buildPieces(work, cols, rows, seed) {
      const aspect = work.width / work.height;
      const geo = geometry(cols, rows, aspect), edges = makeEdges(cols, rows, seed);
      const pwPx = work.width / cols, phPx = work.height / rows, mPx = MARGIN * Math.min(pwPx, phPx);
      const canvases = [], paths = [];
      for (let id = 0; id < cols * rows; id++) {
        const c = id % cols, r = Math.floor(id / cols);
        const path2d = pathOf(piecePath(edges, c, r, pwPx, phPx, mPx, mPx));
        const cnv = document.createElement('canvas');
        cnv.width = Math.ceil(pwPx + 2 * mPx); cnv.height = Math.ceil(phPx + 2 * mPx);
        const x = cnv.getContext('2d');
        x.save(); x.clip(path2d);
        x.drawImage(work, mPx - c * pwPx, mPx - r * phPx);
        x.restore();
        x.lineJoin = 'round';
        x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = Math.max(1.2, pwPx / 40); x.stroke(path2d);
        x.save(); x.clip(path2d); x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = Math.max(1, pwPx / 55); x.translate(-0.6, -0.6); x.stroke(path2d); x.restore();
        canvases.push(cnv); paths.push(path2d);
      }
      return { aspect, geo, edges, canvases, paths, mPx };
    }

    async function startPuzzle(src, count, resume = null) {
      const mine = ++token, began = performance.now();
      phase = 'loading'; done = false; drag = null;
      showMsg('Cutting the picture…');
      try {
        const blob = await blobOfSource(src);
        const { canvas: work } = await makeWork(blob);
        if (mine !== token || dead) return;
        const grid = resume ? { cols: resume.cols, rows: resume.rows } : gridFor(count, work.width / work.height);
        const seed = resume ? resume.seed : randomSeed();
        const built = buildPieces(work, grid.cols, grid.rows, seed);
        P = { src, count, cols: grid.cols, rows: grid.rows, seed, work, ...built, pieces: [], workSize: { w: work.width, h: work.height } };
        const total = grid.cols * grid.rows;
        if (resume && Math.abs(resume.aspect - built.aspect) < 0.02) {
          P.pieces = resume.pieces.map((p, id) => ({ id, x: p.x, y: p.y, locked: p.locked, z: ++z, flash: 0 }));
          P.pieces.forEach(p => { if (p.locked) { const hm = home(P.geo, p.id); p.x = hm.x; p.y = hm.y; } });
        } else {
          P.pieces = Array.from({ length: total }, (_, id) => ({ id, x: 0, y: 0, locked: false, z: ++z, flash: 0 }));
          layout();
          scatterAll();
        }
        prepMs = performance.now() - began;
        phase = 'play'; sel = -1; slotCur = 0; kbd = false; preview = false; paused = false;
        clk.stop(); clk.secs = resume ? resume.elapsed : 0; lastSecs = -1; timeV.textContent = fmtTime(clk.secs);
        clearOverlay();
        layout();
        persistNow();
        paintReads();
        say(`${total} pieces. Drag them onto the board, or press N to choose one with the keyboard.`);
        onScore(Math.floor(clk.secs));
        if (placedCount(P.pieces) === total) win();
        cv.focus({ preventScroll: true });
      } catch (err) {
        if (mine !== token || dead) return;
        phase = 'error';
        showMsg(err?.message || 'That picture could not be opened.', true);
      }
    }
    function scatterAll() {
      const spots = scatter(P.geo, P.seed, area());
      P.pieces.forEach((p, i) => { p.x = spots[i].x; p.y = spots[i].y; p.locked = false; p.z = ++z; p.flash = 0; });
    }

    /* ---------- overlays: the chooser and messages ---------- */
    const clearOverlay = () => stage.querySelectorAll('.pz-jg__pick,.pz-jg__msg').forEach(n => n.remove());
    function showMsg(text, withPicker = false) {
      clearOverlay();
      const box = h('div.pz-jg__msg', h('div', h('b', { text }), withPicker ? h('div', { style: { marginTop: '10px' } },
        h('button.pz__btn', { type: 'button', onclick: () => showPicker() }, icon('image'), h('span', { text: 'Choose a picture' }))) : null));
      stage.appendChild(box);
    }
    function thumb(name, ref, kind, url) {
      const img = h('img', { alt: '', draggable: 'false', loading: 'lazy' });
      if (url) img.src = url;
      const b = h('button.pz-jg__thumb', { type: 'button', title: name, dataset: { kind, ref, name } }, img, h('span', { text: name }));
      L.on(b, 'click', () => { if (!dead) startPuzzle({ kind, ref }, wantCount); });
      return { b, img };
    }
    function showPicker() {
      clearOverlay(); clk.stop(); token++;
      phase = 'pick'; P = null; dirty();
      const grid = h('div.pz-jg__grid', { role: 'group', 'aria-label': 'Your pictures' });
      const wall = h('div.pz-jg__grid', { role: 'group', 'aria-label': 'Wallpapers that come with StaticOS' });
      const mine = listPictures();
      for (const pic of mine) {
        const t = thumb(pic.name, pic.path, 'path', null);
        media.urlOf(pic.path).then(u => { if (u && !dead) t.img.src = u; }).catch(() => {});
        grid.appendChild(t.b);
      }
      for (const wp of BUNDLED) wall.appendChild(thumb(wp.name, wp.ref, 'asset', wp.ref).b);
      const countBtns = COUNTS.map(n => h('button', { type: 'button', dataset: { count: n }, 'aria-pressed': String(n === wantCount), text: String(n) }));
      const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Pieces' }, ...countBtns);
      countBtns.forEach(b => L.on(b, 'click', () => {
        wantCount = Number(b.dataset.count); save(GAME, { count: wantCount });
        countBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }));
      const input = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Add a photo from this computer' });
      L.on(input, 'change', async () => {
        const f = input.files && input.files[0];
        input.value = '';
        if (!f || dead) return;
        try {
          const saved = await media.save(picturesDir(), f.name, f);
          if (!dead) startPuzzle({ kind: 'path', ref: saved.path }, wantCount);
        } catch (err) { say(err?.message || 'That file could not be added.'); }
      });
      const addBtn = h('button.pz__btn', { type: 'button' }, icon('image'), h('span', { text: 'Add a photo…' }));
      L.on(addBtn, 'click', () => input.click());
      stage.appendChild(h('div.pz-jg__pick',
        h('h3', { text: 'Choose a picture for your jigsaw' }),
        h('div.pz-jg__row', h('span.pz__note', { text: 'Pieces' }), seg, addBtn, input),
        h('p', { text: 'The picture is read from this browser, shrunk, and cut up right here. It is never uploaded. “Add a photo…” keeps a copy in your Pictures folder, on this device.' }),
        h('h4', { text: 'Your pictures' }),
        mine.length ? grid : h('p', { text: 'No pictures in your Pictures folder yet. Use “Add a photo…”, or Camera / Files.' }),
        h('h4', { text: 'Wallpapers' }), wall));
      paintReads();
      say('Choose a picture to begin.');
      onScore(0);
    }

    function paintReads() {
      const total = P ? P.pieces.length : 0, n = P ? placedCount(P.pieces) : 0;
      placedV.textContent = `${n}/${total}`;
      const b = P ? best[P.pieces.length] : null;
      bestV.textContent = b != null ? `Best: ${fmtTime(b)}` : '';
      previewBtn.setAttribute('aria-pressed', String(preview));
      previewBtn.disabled = !P; restartBtn.disabled = !P;
      cv.setAttribute('aria-label', P ? `Jigsaw board, ${P.cols} by ${P.rows}. ${n} of ${total} pieces in place.` : 'Jigsaw board');
    }

    /* ---------- saving ---------- */
    function snapshot() {
      return P && !done ? packState({ src: P.src, count: P.count, cols: P.cols, rows: P.rows, seed: P.seed, aspect: P.aspect, elapsed: clk.secs, pieces: P.pieces }) : null;
    }
    function persistNow() { clearTimeout(saveTimer); saveTimer = 0; save(GAME, { puzzle: snapshot(), count: wantCount, best: { ...best } }); }
    function persistSoon() { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; if (!dead) persistNow(); }, 500); }

    /* ---------- playing ---------- */
    const can = () => !dead && !paused && !done && phase === 'play' && !!P;
    const toBoard = e => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) - view.bx) / view.S, y: ((e.clientY - r.top) - view.by) / view.S }; };
    function pieceAt(bx, by) {
      const k = view.S / P.work.width;
      const loose = P.pieces.filter(p => !p.locked).sort((a, b) => b.z - a.z);
      for (const p of loose) {
        const lx = (bx - p.x) * view.S / k + P.mPx, ly = (by - p.y) * view.S / k + P.mPx;
        if (lx < 0 || ly < 0 || lx > P.canvases[p.id].width || ly > P.canvases[p.id].height) continue;
        if (hit.isPointInPath(P.paths[p.id], lx, ly)) return p;
      }
      return null;
    }
    function lock(p, how) {
      const hm = home(P.geo, p.id);
      p.x = hm.x; p.y = hm.y; p.locked = true; p.flash = performance.now() + 300; flashUntil = p.flash;
      snd.wake(); snd.blip(740, 0.07, 'triangle', 0.8); snd.blip(1110, 0.09, 'sine', 0.5);
      paintReads(); persistSoon(); dirty();
      const n = placedCount(P.pieces), total = P.pieces.length;
      say(`${how}Piece ${p.id + 1} is in place. ${n} of ${total}.`);
      if (n === total) win();
    }
    function win() {
      if (done) return;
      done = true; clk.stop(); drag = null;
      const secs = Math.round(clk.secs * 10) / 10, total = P.pieces.length;
      const prev = best[total], fresh = prev == null || secs < prev;
      if (fresh) best[total] = secs;
      save(GAME, { puzzle: null, best: { ...best } });
      clearTimeout(saveTimer); saveTimer = 0;
      paintReads(); dirty();
      stage.appendChild(h('div.pz-jg__msg', { style: { pointerEvents: 'none' } }, h('div', h('b', { text: 'Finished!' }), h('span', { text: `${total} pieces in ${fmtTime(secs)}${fresh && prev != null ? ' — a new best' : ''}.` }))));
      say(`Puzzle finished: ${total} pieces in ${fmtTime(secs)}.`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(659, 0.1, 'triangle', 0.8), 110); setTimeout(() => !dead && snd.blip(784, 0.18, 'triangle', 0.8), 220);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${total} pieces` });
    }

    L.on(cv, 'pointerdown', e => {
      if (!can() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const b = toBoard(e), p = pieceAt(b.x, b.y);
      kbd = false;
      cv.focus({ preventScroll: true });
      if (!p) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      p.z = ++z; drag = { p, dx: b.x - p.x, dy: b.y - p.y, id: e.pointerId };
      sel = p.id;
      if (!clk.running) clk.start();
      snd.wake(); snd.blip(360, 0.04, 'sine', 0.4);
      cv.style.cursor = 'grabbing';
      dirty();
    });
    L.on(cv, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const b = toBoard(e), a = area();
      drag.p.x = Math.max(a.x0, Math.min(a.x1, b.x - drag.dx));
      drag.p.y = Math.max(a.y0, Math.min(a.y1, b.y - drag.dy));
      dirty();
    });
    const drop = e => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const p = drag.p; drag = null; cv.style.cursor = '';
      if (snaps(P.geo, p.id, p.x, p.y)) lock(p, '');
      else { persistSoon(); dirty(); }
    };
    L.on(cv, 'pointerup', drop);
    L.on(cv, 'pointercancel', drop);

    /* keyboard */
    const loose = () => P.pieces.filter(p => !p.locked);
    function choose(dir) {
      const list = loose();
      if (!list.length) return;
      const i = list.findIndex(p => p.id === sel);
      const next = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)];
      sel = next.id; kbd = true; next.z = ++z;
      const r = Math.floor(next.id / P.cols) + 1, c = (next.id % P.cols) + 1;
      say(`Piece ${next.id + 1} of ${P.pieces.length} chosen. It belongs in row ${r}, column ${c} of the picture.`);
      dirty();
    }
    function placeSelected() {
      if (sel < 0) return choose(1);
      const p = P.pieces[sel];
      if (!p || p.locked) return choose(1);
      if (!clk.running) clk.start();
      if (slotCur === p.id) {
        lock(p, 'Correct. ');
        const rest = loose();
        sel = rest.length ? (rest.find(q => q.id > p.id) || rest[0]).id : -1;
        if (sel >= 0 && !done) say(`${msg} Next: piece ${sel + 1}, row ${Math.floor(sel / P.cols) + 1}, column ${(sel % P.cols) + 1}.`);
      } else {
        const hm = home(P.geo, slotCur);
        p.x = hm.x; p.y = hm.y; p.z = ++z;
        snd.blip(200, 0.08, 'sawtooth', 0.4);
        say(`Piece ${p.id + 1} does not belong in row ${Math.floor(slotCur / P.cols) + 1}, column ${(slotCur % P.cols) + 1}. It stays loose there; it belongs in row ${Math.floor(p.id / P.cols) + 1}, column ${(p.id % P.cols) + 1}.`);
        persistSoon(); dirty();
      }
    }
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    L.on(window, 'keydown', e => {
      if (!can() || !ownsKey(root, e)) return;
      const k = e.key;
      if (k === 'n' || k === 'N') { e.preventDefault(); choose(1); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); choose(-1); }
      else if (k.startsWith('Arrow')) {
        e.preventDefault(); unfocus(); kbd = true;
        const c = slotCur % P.cols, r = Math.floor(slotCur / P.cols);
        const nc = k === 'ArrowLeft' ? c - 1 : k === 'ArrowRight' ? c + 1 : c, nr = k === 'ArrowUp' ? r - 1 : k === 'ArrowDown' ? r + 1 : r;
        if (nc >= 0 && nc < P.cols && nr >= 0 && nr < P.rows) slotCur = nr * P.cols + nc;
        if (sel < 0) { const f = loose()[0]; if (f) sel = f.id; }
        say(`Row ${Math.floor(slotCur / P.cols) + 1}, column ${(slotCur % P.cols) + 1}.`);
        dirty();
      } else if (k === ' ' || k === 'Enter') {
        e.preventDefault(); unfocus();
        if (!e.repeat) { kbd = true; placeSelected(); }
      } else if (k === 'v' || k === 'V') { e.preventDefault(); togglePreview(); }
    });
    function togglePreview() { if (!P) return; preview = !preview; paintReads(); dirty(); say(preview ? 'Preview on.' : 'Preview off.'); }
    L.on(previewBtn, 'click', togglePreview);
    L.on(restartBtn, 'click', () => {
      if (dead || !P) return;
      done = false; clk.stop(); clk.secs = 0; lastSecs = -1; timeV.textContent = '0:00';
      stage.querySelectorAll('.pz-jg__msg').forEach(n => n.remove());
      layout(); scatterAll(); sel = -1; paintReads(); persistNow(); dirty();
      say('Pieces scattered. Start again.');
    });
    L.on(newBtn, 'click', () => { if (dead) return; save(GAME, { puzzle: null }); done = false; showPicker(); });

    /* the stage changes size with the window */
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => layout());
      ro.observe(stage);
      L.add(() => ro.disconnect());
    } else L.on(window, 'resize', layout);

    /* ---------- go ---------- */
    layout();
    const resume = unpackState(sv.puzzle);
    if (resume) startPuzzle(resume.src, resume.count, resume);
    else showPicker();

    return {
      stop() {
        if (dead) return;
        if (P && !done && phase === 'play') persistNow();
        dead = true; token++; clearTimeout(saveTimer); cancelAnimationFrame(raf); raf = 0;
        clk.dispose(); L.clear(); snd.close(); root.remove();
      },
      pause() { if (dead || paused) return; paused = true; drag = null; clk.stop(); if (phase === 'play' && !done) stage.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; stage.querySelector('.pz__cover')?.remove(); if (phase === 'play' && !done && P && placedCount(P.pieces) > 0) clk.start(); },
      peek: () => {
        const r = cv.getBoundingClientRect();
        const base = { phase, paused, done, preview, sel, slotCur, best: { ...best }, wantCount, seconds: clk.secs, running: clk.running, msg, drawMs, prepMs };
        if (!P) return base;
        const S = view.S;
        return {
          ...base, src: { ...P.src }, cols: P.cols, rows: P.rows, count: P.pieces.length, aspect: P.aspect, seed: P.seed,
          work: { ...P.workSize }, placed: placedCount(P.pieces), total: P.pieces.length,
          geom: { x: r.left, y: r.top, bx: view.bx, by: view.by, S, pw: P.geo.pw, ph: P.geo.ph, boardH: P.geo.boardH, w: view.w, h: view.h },
          pieces: P.pieces.map(p => ({
            id: p.id, locked: p.locked, x: p.x, y: p.y, z: p.z,
            cx: r.left + view.bx + (p.x + P.geo.pw / 2) * S, cy: r.top + view.by + (p.y + P.geo.ph / 2) * S,
            hx: r.left + view.bx + (home(P.geo, p.id).x + P.geo.pw / 2) * S, hy: r.top + view.by + (home(P.geo, p.id).y + P.geo.ph / 2) * S,
          })),
        };
      },
      /* test hook — nothing in the game calls it: start(kind, ref, count) */
      hook(cmd, a, b, c) {
        if (cmd === 'start') startPuzzle({ kind: a, ref: b }, c || wantCount);
        return true;
      },
    };
  },
};
