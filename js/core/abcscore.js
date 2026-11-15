/* ============================================================
   abcscore.js — draws a tune from core/abc.js as sheet music (SVG).

   layout(tune, { width, ink }) → { svg, width, height, marks }
     svg    one standalone <svg> string: title, composer, tempo, and each
            voice on its own staff, wrapped into systems that fit `width`
     marks  [{ v, i, x, y, sys }] where each written note sits (voice, item
            number, and its place on the picture), so a player can follow along
   Every note is <g class="n" data-v data-i>, so the page can colour the
   one that is sounding.

   What is drawn: treble and bass clefs, key and time signatures, notes from
   whole to 32nd with stems, flags and beams (notes written with no space
   between them are beamed), dots, accidentals, ledger lines, chords (with
   seconds set side by side), ties, rests, bar lines, repeat signs, first and
   second endings, tuplet numbers and "chord symbols". Not drawn: lyrics,
   slurs, grace notes, decorations and ornaments.
   ============================================================ */

const STEP = 4;                                  /* half a staff space, px */
const SHARP_AT = [38, 35, 39, 36, 33, 37, 34];   /* treble staff steps of F C G D A E B sharps */
const FLAT_AT = [34, 37, 33, 36, 32, 35, 31];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = n => Math.round(n * 10) / 10;

/* which written length a note is drawn as: base (1 = whole … 32), dots */
function glyphOf(gd) {
  const v = gd[0] / gd[1];
  for (const b of [1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32]) {
    if (Math.abs(v - b) < 1e-9) return { base: b, dots: 0 };
    if (Math.abs(v - b * 1.5) < 1e-9) return { base: b, dots: 1 };
    if (Math.abs(v - b * 1.75) < 1e-9) return { base: b, dots: 2 };
  }
  for (const b of [2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32]) if (v >= b - 1e-9) return { base: Math.min(b, 1), dots: 0 };
  return { base: 1 / 32, dots: 0 };
}

const itemWidth = (it) => {
  if (it.t === 'bar') return it.kind === '|:' || it.kind === ':|' || it.kind === '::' || it.kind === ':|]' ? 22 : it.kind === '|' ? 10 : 14;
  const g = glyphOf(it.gd || [1, 4]);
  const w = 12 + 21 * Math.pow(Math.max(0.5, (it.dur || 0.125) * 8), 0.55);
  const acc = it.pitches && it.pitches.some(p => p.shown) ? 11 : 0;
  const dot = g.dots ? 6 : 0;
  const second = it.pitches && it.pitches.length > 1 && it.pitches.some((p, i, a) => i && Math.abs(p.step - a[i - 1].step) === 1) ? 8 : 0;
  return w + acc + dot + second;
};

const TREBLE = `<path d="M 9.2 40.5 C 9.2 45.5 3.5 46 3.5 41.2 C 3.5 37.2 8.8 36.6 10.8 38.8 C 14.2 42.6 11.6 49 6.2 48.6 M 9.2 40.5 C 7.2 33.5 6.8 25 9.6 13 C 11.4 5 14 2.4 15.4 4.6 C 17 7.6 14.6 15.4 6.6 20.2 C -0.2 24.6 0.6 33.4 6.6 35.8 C 12.6 38 17.2 33 15 28.4 C 13 24.6 7.6 26.2 8.4 30.2 C 8.8 32.4 11.4 32.4 11.6 30.6" fill="none" stroke="INK" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`;
const BASS = `<path d="M 3 7.5 C 11 4.5 17.4 8 17 14.6 C 16.6 21.4 10 27 2.6 29.5" fill="none" stroke="INK" stroke-width="2.3" stroke-linecap="round"/><circle cx="3.6" cy="8" r="3.2" fill="INK"/><circle cx="21.6" cy="10.6" r="1.8" fill="INK"/><circle cx="21.6" cy="18.2" r="1.8" fill="INK"/>`;

export function layout(tune, { width = 760, ink = '#1d1a26' } = {}) {
  const W = Math.max(320, width);
  const M = 24;                                   /* page margin */
  const out = [];
  const marks = [];
  const L = (x1, y1, x2, y2, w = 1.2) => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${ink}" stroke-width="${w}"/>`;
  const T = (x, y, s, o = {}) => `<text x="${f1(x)}" y="${f1(y)}" fill="${ink}" font-family="${o.serif ? 'Georgia, Times New Roman, serif' : 'Inter, system-ui, sans-serif'}" font-size="${o.size || 12}" ${o.bold ? 'font-weight="700"' : ''} ${o.italic ? 'font-style="italic"' : ''} text-anchor="${o.anchor || 'start'}">${esc(s)}</text>`;

  let y = 20;
  /* title block */
  if (tune.title) { out.push(T(W / 2, y + 16, tune.title, { size: 22, bold: true, serif: true, anchor: 'middle' })); y += 30; }
  if (tune.composer) { out.push(T(W - M, y + 2, tune.composer, { size: 12, italic: true, serif: true, anchor: 'end' })); y += 8; }
  /* tempo: a small note, = bpm */
  {
    const tb = tune.tempo.beat, g = glyphOf(tb);
    const tx = M, ty = y + 14;
    out.push(`<ellipse cx="${tx + 4}" cy="${ty}" rx="3.6" ry="2.7" transform="rotate(-20 ${tx + 4} ${ty})" fill="${g.base >= 0.5 ? 'none' : ink}" stroke="${ink}" stroke-width="1.2"/>`);
    if (g.base < 1) out.push(L(tx + 7.2, ty, tx + 7.2, ty - 14, 1.2));
    if (g.dots) out.push(`<circle cx="${tx + 12}" cy="${ty}" r="1.2" fill="${ink}"/>`);
    out.push(T(tx + 18, ty + 4, `= ${tune.tempo.bpm}`, { size: 12, bold: true }));
    y += 26;
  }
  y += 18;

  const meterSym = tune.meter.sym;
  tune.voices.forEach((voice, vi) => {
    const clef = voice.clef === 'bass' ? 'bass' : 'treble';
    const bottomStep = clef === 'bass' ? 18 : 30;
    const fifths = (tune.firstKey || tune.key).fifths || 0;
    const shift = clef === 'bass' ? -14 : 0;
    const keyW = Math.abs(fifths) * 9 + (fifths ? 6 : 0);
    const headW = (first) => 30 + keyW + (first ? 24 : 0);

    /* the items, cut into segments at bar lines: [notes…, bar] */
    const segs = [];
    let cur = [];
    voice.items.forEach((it, idx) => {
      cur.push({ it, idx });
      if (it.t === 'bar') { segs.push(cur); cur = []; }
    });
    if (cur.length) segs.push(cur);
    if (voice.name && tune.voices.length > 1) { out.push(T(M, y - 2, voice.name, { size: 11, italic: true })); }

    /* wrap into systems */
    const systems = [];
    let sys = [], used = 0;
    const segW = seg => seg.reduce((s, x) => s + itemWidth(x.it), 0);
    for (const seg of segs) {
      const w = segW(seg);
      const avail = W - 2 * M - headW(systems.length === 0) - 4;
      if (sys.length && used + w > avail) { systems.push(sys); sys = []; used = 0; }
      sys.push(seg); used += w;
    }
    if (sys.length) systems.push(sys);
    if (!systems.length) systems.push([]);

    let carry = 0;
    systems.forEach((segsHere, si) => {
      const first = si === 0;
      const top = y + 26;                          /* the staff's top line (room above for tall notes) */
      const bottom = top + 32;
      const yOf = step => bottom - (step - bottomStep) * STEP;
      const midY = top + 16;
      const x0 = M, x1 = W - M;
      const isLast = si === systems.length - 1;

      /* staff lines */
      for (let k = 0; k < 5; k++) out.push(L(x0, top + k * 8, x1, top + k * 8, 1));
      out.push(L(x0, top, x0, bottom, 1.4));
      /* clef, key, time */
      let x = x0 + 4;
      out.push(`<g transform="translate(${x} ${clef === 'bass' ? top + 2 : top - 6})">${(clef === 'bass' ? BASS : TREBLE).replace(/INK/g, ink)}</g>`);
      x += 26;
      const order = fifths > 0 ? SHARP_AT : FLAT_AT;
      for (let k = 0; k < Math.abs(fifths); k++) {
        out.push(accGlyph(fifths > 0 ? 1 : -1, x + 4, yOf(order[k] + shift), ink));
        x += 9;
      }
      if (fifths) x += 6;
      if (first) {
        if (meterSym === 'C' || meterSym === 'C|') {
          out.push(T(x + 8, top + 24, 'C', { size: 28, bold: true, serif: true, anchor: 'middle' }));
          if (meterSym === 'C|') out.push(L(x + 8, top + 4, x + 8, top + 28, 1.4));
        } else {
          out.push(T(x + 8, top + 15.5, String(tune.meter.num), { size: 22, bold: true, serif: true, anchor: 'middle' }));
          out.push(T(x + 8, top + 31.5, String(tune.meter.den), { size: 22, bold: true, serif: true, anchor: 'middle' }));
        }
        x += 24;
      }
      const startX = x + 4;
      const natural = segsHere.reduce((s, seg) => s + segW(seg), 0);
      const room = x1 - startX - 6;
      const k = natural <= 0 ? 1 : isLast ? Math.max(0.6, Math.min(1.25, room / natural)) : Math.max(0.6, room / natural);

      /* place every item */
      const placed = [];
      let px = startX;
      for (const seg of segsHere) for (const e of seg) {
        const w = itemWidth(e.it) * k;
        placed.push({ ...e, x: px + w * 0.5, w, left: px });
        px += w;
      }
      /* bars sit at the left edge of their slot's right end */
      for (const p of placed) if (p.it.t === 'bar') p.x = p.left + p.w * (p.it.kind === '|:' ? 0.35 : p.it.kind === ':|' || p.it.kind === ':|]' || p.it.kind === '::' ? 0.65 : 0.5);

      /* bar lines and repeats */
      for (const p of placed) {
        if (p.it.t !== 'bar') continue;
        const bx = p.x, kd = p.it.kind || '|';
        const dots = (cx) => `<circle cx="${f1(cx)}" cy="${top + 12}" r="1.7" fill="${ink}"/><circle cx="${f1(cx)}" cy="${top + 20}" r="1.7" fill="${ink}"/>`;
        if (kd === '|') out.push(L(bx, top, bx, bottom, 1.3));
        else if (kd === '||' || kd === '[|') { out.push(L(bx - 2.5, top, bx - 2.5, bottom, 1.3)); out.push(L(bx + 2.5, top, bx + 2.5, bottom, 1.3)); }
        else if (kd === '|]') { out.push(L(bx - 3, top, bx - 3, bottom, 1.3)); out.push(L(bx + 1.5, top, bx + 1.5, bottom, 4)); }
        else if (kd === '|:') { out.push(L(bx - 3, top, bx - 3, bottom, 4)); out.push(L(bx + 1.8, top, bx + 1.8, bottom, 1.3)); out.push(dots(bx + 7)); }
        else if (kd === ':|' || kd === ':|]') { out.push(dots(bx - 7)); out.push(L(bx - 1.8, top, bx - 1.8, bottom, 1.3)); out.push(L(bx + 3, top, bx + 3, bottom, 4)); }
        else if (kd === '::') { out.push(dots(bx - 9)); out.push(L(bx - 2, top, bx - 2, bottom, 1.3)); out.push(L(bx + 2, top, bx + 2, bottom, 1.3)); out.push(dots(bx + 9)); }
        else out.push(L(bx, top, bx, bottom, 1.3));
      }
      /* first and second endings: a bracket with its number, to the next bar that closes it */
      const bracket = (bx, endX, num) => {
        out.push(`<path d="M ${f1(bx)} ${top - 4} L ${f1(bx)} ${top - 16} L ${f1(endX)} ${top - 16}" fill="none" stroke="${ink}" stroke-width="1.1"/>`);
        out.push(T(bx + 4, top - 7, `${num}.`, { size: 11 }));
      };
      const firstBar = placed.find(q => q.it.t === 'bar');
      if (carry && firstBar) bracket(startX - 2, firstBar.x, carry);
      carry = 0;
      placed.forEach((p, n) => {
        if (p.it.t !== 'bar' || !p.it.ending) return;
        if (n === placed.length - 1) { carry = p.it.ending; return; }       /* it starts the next line */
        let endX = x1 - 4;
        for (let j = n + 1; j < placed.length; j++) if (placed[j].it.t === 'bar') { endX = placed[j].x; break; }
        bracket(p.x + (p.it.kind === '|' ? 0 : 6), endX, p.it.ending);
      });

      /* notes, rests */
      const beamed = new Set();
      const groups = [];
      for (let n = 0; n < placed.length; n++) {
        const p = placed[n];
        if (p.it.t !== 'note' || !p.it.beam || beamed.has(p.idx)) continue;
        const g = [p];
        let m = n;
        while (placed[m].it.beam && placed[m + 1] && placed[m + 1].it.t === 'note' && placed[m + 1].idx === placed[m].idx + 1) { g.push(placed[m + 1]); m++; }
        if (g.length > 1) { g.forEach(q => beamed.add(q.idx)); groups.push(g); }
      }
      const gOf = new Map();
      groups.forEach(g => g.forEach(q => gOf.set(q.idx, g)));
      /* stem direction and the beam's height for each group */
      const info = new Map();
      for (const g of groups) {
        const steps = g.flatMap(q => q.it.pitches.map(pp => pp.step));
        const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
        const up = avg <= bottomStep + 4;
        const tips = g.map(q => { const st = q.it.pitches.map(pp => pp.step); return up ? yOf(Math.max(...st)) - 27 : yOf(Math.min(...st)) + 27; });
        info.set(g, { up, tip: up ? Math.min(...tips) : Math.max(...tips) });
      }

      const noteSvg = [];
      const ties = [];
      for (const p of placed) {
        const it = p.it;
        if (it.t === 'bar') continue;
        const cx = p.x;
        let s = '';
        if (it.t === 'rest') {
          if (!it.hidden) s += restGlyph(it, cx, top, ink);
        } else {
          const g = glyphOf(it.gd);
          const steps = it.pitches.map(pp => pp.step);
          const lo = Math.min(...steps), hi = Math.max(...steps);
          const grp = gOf.get(p.idx);
          const up = grp ? info.get(grp).up : (lo + hi) / 2 < bottomStep + 4;
          /* heads */
          const sorted = it.pitches.slice().sort((a, b) => a.step - b.step);
          const flip = new Set();
          if (up) for (let a = 1; a < sorted.length; a++) { if (sorted[a].step - sorted[a - 1].step === 1 && !flip.has(a - 1)) flip.add(a); }
          else for (let a = sorted.length - 2; a >= 0; a--) { if (sorted[a + 1].step - sorted[a].step === 1 && !flip.has(a + 1)) flip.add(a); }
          const open = g.base >= 0.5;
          const stemX = up ? cx + 4.9 : cx - 4.9;
          sorted.forEach((pp, a) => {
            const hy = yOf(pp.step + (clef === 'bass' ? 0 : 0));
            const hx = flip.has(a) ? (up ? cx + 9.6 : cx - 9.6) : cx;
            /* ledger lines */
            const off = pp.step - bottomStep;
            if (off <= -2) for (let o = -2; o >= off; o -= 2) s += L(hx - 8, bottom - o * STEP, hx + 8, bottom - o * STEP, 1.2);
            if (off >= 10) for (let o = 10; o <= off; o += 2) s += L(hx - 8, bottom - o * STEP, hx + 8, bottom - o * STEP, 1.2);
            if (g.base >= 1) s += `<ellipse cx="${f1(hx)}" cy="${f1(hy)}" rx="6.2" ry="4.1" fill="none" stroke="${ink}" stroke-width="2.1"/>`;
            else s += `<ellipse cx="${f1(hx)}" cy="${f1(hy)}" rx="5.4" ry="3.9" transform="rotate(-20 ${f1(hx)} ${f1(hy)})" fill="${open ? 'none' : ink}" stroke="${ink}" stroke-width="${open ? 1.6 : 1}"/>`;
            if (pp.shown) s += accGlyph(pp.acc, hx - 12 - (a % 2 ? 0 : 0) - (sorted.length > 1 && a > 0 && Math.abs(pp.step - sorted[a - 1].step) < 4 ? 9 : 0), hy, ink);
            if (g.dots) { const online = (pp.step - bottomStep) % 2 === 0; for (let d = 0; d < g.dots; d++) s += `<circle cx="${f1(hx + 9.5 + d * 4.5)}" cy="${f1(hy - (online ? 3.5 : 0))}" r="1.4" fill="${ink}"/>`; }
          });
          /* stem */
          if (g.base < 1) {
            const yLo = yOf(lo), yHi = yOf(hi);
            let tipY;
            if (grp) tipY = info.get(grp).tip; else tipY = up ? Math.min(yHi - 27, midY) : Math.max(yLo + 27, midY);
            const y0 = up ? yLo : yHi;
            s += L(stemX, y0, stemX, tipY, 1.3);
            if (!grp && g.base <= 1 / 8) {
              const nfl = g.base <= 1 / 32 ? 3 : g.base <= 1 / 16 ? 2 : 1;
              for (let q = 0; q < nfl; q++) {
                const fy = up ? tipY + q * 5.5 : tipY - q * 5.5;
                s += up
                  ? `<path d="M ${f1(stemX)} ${f1(fy)} c 0.5 7 9 9 6.5 19 c 1 -7 -4 -9 -6.5 -11 z" fill="${ink}" stroke="${ink}" stroke-width="0.8"/>`
                  : `<path d="M ${f1(stemX)} ${f1(fy)} c 0.5 -7 9 -9 6.5 -19 c 1 7 -4 9 -6.5 11 z" fill="${ink}" stroke="${ink}" stroke-width="0.8"/>`;
              }
            }
            info.set(p, { up, tipY, stemX });
          }
          if (it.chord) out.push(T(cx - 4, top - 22 - (tune.voices.length > 1 ? 0 : 0), it.chord, { size: 12, bold: true }));
          if (it.tie) ties.push({ x: cx, y: up ? yOf(lo) + 7 : yOf(hi) - 7, up: !up, idx: p.idx });
          s += `<rect class="hit" x="${f1(cx - 10)}" y="${f1(yOf(hi) - 7)}" width="20" height="${f1(yOf(lo) - yOf(hi) + 14)}" fill="none" stroke="none" pointer-events="all"/>`;
          marks.push({ v: vi, i: p.idx, x: cx, y: yOf(hi), sys: si, svgY: top });
        }
        noteSvg.push(`<g class="n" data-v="${vi}" data-i="${p.idx}">${s}</g>`);
      }
      out.push(...noteSvg);

      /* beams */
      for (const g of groups) {
        const { up, tip } = info.get(g);
        const stem = q => (info.get(q) || {}).stemX;
        const levels = q => (glyphOf(q.it.gd).base <= 1 / 16 ? (glyphOf(q.it.gd).base <= 1 / 32 ? 3 : 2) : 1);
        const dir = up ? 1 : -1;
        const x1b = stem(g[0]) - 0.65, x2b = stem(g[g.length - 1]) + 0.65;
        for (let lv = 0; lv < 3; lv++) {
          const by = tip + dir * lv * 5.5;
          let run = null;
          const flush = () => { if (run) { out.push(`<line x1="${f1(run[0])}" y1="${f1(by)}" x2="${f1(run[1])}" y2="${f1(by)}" stroke="${ink}" stroke-width="3.6"/>`); run = null; } };
          if (lv === 0) { out.push(`<line x1="${f1(x1b)}" y1="${f1(by)}" x2="${f1(x2b)}" y2="${f1(by)}" stroke="${ink}" stroke-width="3.6"/>`); continue; }
          g.forEach((q, n) => {
            if (levels(q) <= lv) { flush(); return; }
            const sx = stem(q);
            const nextHas = g[n + 1] && levels(g[n + 1]) > lv;
            const prevHas = g[n - 1] && levels(g[n - 1]) > lv;
            if (nextHas) { run = run || [sx - 0.65, sx]; run[1] = stem(g[n + 1]) + 0.65; }
            else if (prevHas) { run = run || [stem(g[n - 1]) - 0.65, sx]; run[1] = sx + 0.65; flush(); }
            else { flush(); const left = n === g.length - 1; out.push(`<line x1="${f1(left ? sx - 8 : sx - 0.65)}" y1="${f1(by)}" x2="${f1(left ? sx + 0.65 : sx + 8)}" y2="${f1(by)}" stroke="${ink}" stroke-width="3.6"/>`); }
          });
          flush();
        }
      }
      /* tuplet numbers */
      let run = [];
      const flushTup = () => {
        if (run.length > 1) {
          const a = run[0], b = run[run.length - 1];
          const tipTop = Math.min(top - 4, ...run.map(q => (info.get(q) || {}).tipY ?? top).filter(v => v < top + 16));
          out.push(T((a.x + b.x) / 2, tipTop - 6, String(run.length), { size: 11, italic: true, anchor: 'middle' }));
        }
        run = [];
      };
      for (const p of placed) { if (p.it.tup) run.push(p); else if (run.length) flushTup(); }
      flushTup();
      /* ties: arcs to the next note */
      ties.forEach(tp => {
        const next = placed.find(q => q.it.t === 'note' && q.idx > tp.idx);
        const nx = next && next.left >= 0 && next.idx > tp.idx ? next.x : tp.x + 26;
        const x2 = Math.min(nx, x1 - 4);
        out.push(`<path d="M ${f1(tp.x)} ${f1(tp.y)} Q ${f1((tp.x + x2) / 2)} ${f1(tp.y + (tp.up ? -8 : 8))} ${f1(x2)} ${f1(tp.y)}" fill="none" stroke="${ink}" stroke-width="1.3"/>`);
      });
      y = bottom + 34;
    });
    y += 6;
  });

  const H = Math.ceil(y + 6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tune.title || 'Sheet music')}"><rect width="${W}" height="${H}" fill="#ffffff"/>${out.join('')}</svg>`;
  return { svg, width: W, height: H, marks };
}

function accGlyph(a, x, y, ink) {
  if (a === 1) return `<g stroke="${ink}" fill="none"><path d="M ${f1(x - 1.6)} ${f1(y - 8)} V ${f1(y + 8)} M ${f1(x + 1.8)} ${f1(y - 9)} V ${f1(y + 7)}" stroke-width="1.1"/><path d="M ${f1(x - 3.5)} ${f1(y - 2.2)} L ${f1(x + 3.8)} ${f1(y - 4)} M ${f1(x - 3.5)} ${f1(y + 4.2)} L ${f1(x + 3.8)} ${f1(y + 2.4)}" stroke-width="2.2"/></g>`;
  if (a === -1) return `<path d="M ${f1(x - 2.5)} ${f1(y - 10)} V ${f1(y + 4)} C ${f1(x + 5)} ${f1(y + 1)} ${f1(x + 5.5)} ${f1(y - 6)} ${f1(x - 2.5)} ${f1(y - 1.5)}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
  if (a === 2) return `<g stroke="${ink}" stroke-width="1.8"><path d="M ${f1(x - 3.5)} ${f1(y - 3.5)} L ${f1(x + 3.5)} ${f1(y + 3.5)} M ${f1(x - 3.5)} ${f1(y + 3.5)} L ${f1(x + 3.5)} ${f1(y - 3.5)}"/></g>`;
  if (a === -2) return accGlyph(-1, x - 3, y, ink) + accGlyph(-1, x + 3, y, ink);
  return `<g stroke="${ink}" fill="none"><path d="M ${f1(x - 2.6)} ${f1(y - 9)} V ${f1(y + 3)} M ${f1(x + 2.6)} ${f1(y - 3)} V ${f1(y + 9)}" stroke-width="1.1"/><path d="M ${f1(x - 2.6)} ${f1(y - 2.6)} L ${f1(x + 2.6)} ${f1(y - 4)} M ${f1(x - 2.6)} ${f1(y + 4)} L ${f1(x + 2.6)} ${f1(y + 2.6)}" stroke-width="2"/></g>`;
}

function restGlyph(it, cx, top, ink) {
  const g = glyphOf(it.gd);
  if (it.bars || g.base >= 1) return `<rect x="${f1(cx - 5)}" y="${top + 8}" width="10" height="4.4" fill="${ink}"/>`;
  if (g.base === 1 / 2) return `<rect x="${f1(cx - 5)}" y="${top + 11.6}" width="10" height="4.4" fill="${ink}"/>`;
  if (g.base === 1 / 4) return `<path d="M ${f1(cx - 2)} ${top + 7} L ${f1(cx + 3)} ${top + 13} L ${f1(cx - 2)} ${top + 18.5} L ${f1(cx + 3)} ${top + 24.5} C ${f1(cx - 4)} ${top + 22.5} ${f1(cx - 4)} ${top + 27} ${f1(cx + 2)} ${top + 28.5}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const n = g.base <= 1 / 32 ? 3 : g.base <= 1 / 16 ? 2 : 1;
  let s = `<path d="M ${f1(cx + 3)} ${top + 9} L ${f1(cx - 2 - (n - 1) * 1.5)} ${top + 9 + 8 + n * 6}" fill="none" stroke="${ink}" stroke-width="1.4"/>`;
  for (let k = 0; k < n; k++) s += `<circle cx="${f1(cx - 1 - k * 1.5 + 1)}" cy="${top + 10 + k * 6}" r="2.1" fill="${ink}"/>`;
  return s;
}

export default { layout };
