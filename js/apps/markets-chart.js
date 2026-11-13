/* ============================================================
   markets-chart.js — Static Markets' own canvas chart. No library.

   Panels stacked on one canvas: price (line or candles, optional SMA,
   EMA and Bollinger overlays), volume, and optional RSI and MACD.
   A crosshair follows the pointer or the arrow keys, and the values
   under it are written as text beside the chart (readout), so nothing
   is only a colour or a picture.

     const c = createChart(canvas, { readout, live });
     c.set({ bars, I, type, ind, tz, daily, range })   I = indicator arrays aligned to bars
     c.destroy()
   canvas.dataset.bars / .draws say what was last drawn (tests read them).
   ============================================================ */
import { h } from '../core/dom.js';

/* colours per theme: the light set is darker so lines, red and green keep their contrast on a light background */
const DARK = { up: '#2fbf71', down: '#ef5b5b', sma20: '#f5a524', sma50: '#4da3ff', ema20: '#c084fc', bb: '#8fa0b5', rsi: '#4dd0e1', macd: '#4da3ff', sig: '#f5a524' };
const LIGHT = { up: '#137a43', down: '#c4262e', sma20: '#b86e00', sma50: '#1f6fd1', ema20: '#8e3fd1', bb: '#5d6b7e', rsi: '#0b8da0', macd: '#1f6fd1', sig: '#b86e00' };
export const palette = () => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? LIGHT : DARK);
const hexA = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

function niceStep(range, target) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
export const fmtPrice = v => (v == null ? 'n/a' : Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4));
const fmtVol = v => (v == null ? 'n/a' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v * 100) / 100));

export function createChart(canvas, { readout, live } = {}) {
  const ctx = canvas.getContext('2d');
  let D = null, idx = null, W = 0, H = 0, dpr = 1, draws = 0, raf = 0;
  const ro = new ResizeObserver(() => { size(); draw(); });
  ro.observe(canvas);

  function size() {
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const css = (n, d) => getComputedStyle(canvas).getPropertyValue(n).trim() || d;
  const dateLabel = (b, long) => {
    if (D.daily) return new Date(b.t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: long || D.range === '5Y' || D.range === '1Y' ? 'numeric' : undefined });
    return new Date(b.t).toLocaleString('en-US', { timeZone: D.tz, month: D.range === '1D' && !long ? undefined : 'short', day: D.range === '1D' && !long ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  function layout() {
    const left = 8, right = 72, top = 8, bottom = 20;
    const parts = [['price', 3.2], ['vol', 0.8]];
    if (D.ind.rsi) parts.push(['rsi', 1]);
    if (D.ind.macd) parts.push(['macd', 1.2]);
    const gap = 8, total = parts.reduce((s, p) => s + p[1], 0);
    const avail = H - top - bottom - gap * (parts.length - 1);
    let y = top;
    const panels = {};
    for (const [k, w] of parts) { const ph = Math.max(24, avail * w / total); panels[k] = { y, h: ph }; y += ph + gap; }
    return { left, right: W - right, top, bottom: H - bottom, panels, cw: (W - right - left) / D.bars.length };
  }

  function draw() {
    raf = 0;
    if (D && W < 40) return;                       /* hidden (a view that is not showing) */
    if (!D || !D.bars.length) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); canvas.dataset.bars = '0'; return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { bars, I, ind } = D, n = bars.length;
    const L = layout();
    const COL = palette(), UP = COL.up, DOWN = COL.down;
    const ink = css('--ink-2', '#9aa4b2'), grid = css('--line-1', 'rgba(255,255,255,.08)'), ink0 = css('--ink-0', '#fff'), accent = css('--accent', '#4da3ff');
    const X = i => L.left + (i + 0.5) * L.cw;
    ctx.font = '11px ' + (css('--font', 'system-ui')); ctx.textBaseline = 'middle';

    const axis = (p, lo, hi, fmt, ticks = 4) => {
      const step = niceStep(hi - lo, ticks);
      ctx.strokeStyle = grid; ctx.fillStyle = ink; ctx.lineWidth = 1; ctx.textAlign = 'left';
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const y = Math.round(p.y + p.h - (v - lo) / (hi - lo) * p.h) + .5;
        ctx.beginPath(); ctx.moveTo(L.left, y); ctx.lineTo(L.right, y); ctx.stroke();
        ctx.fillText(fmt(v), L.right + 6, y);
      }
    };
    const line = (arr, p, lo, hi, color, w = 1.5) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      let on = false;
      for (let i = 0; i < n; i++) {
        const v = arr[i];
        if (v == null) { on = false; continue; }
        const y = p.y + p.h - (v - lo) / (hi - lo) * p.h;
        if (on) ctx.lineTo(X(i), y); else { ctx.moveTo(X(i), y); on = true; }
      }
      ctx.stroke();
    };

    /* price */
    const P = L.panels.price;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      lo = Math.min(lo, D.type === 'candle' ? b.l : b.c); hi = Math.max(hi, D.type === 'candle' ? b.h : b.c);
      if (ind.bb) { if (I.bb.lo[i] != null) lo = Math.min(lo, I.bb.lo[i]); if (I.bb.up[i] != null) hi = Math.max(hi, I.bb.up[i]); }
    }
    if (hi === lo) { hi += 1; lo -= 1; }
    const padv = (hi - lo) * 0.05; lo -= padv; hi += padv;
    const Y = v => P.y + P.h - (v - lo) / (hi - lo) * P.h;
    axis(P, lo, hi, fmtPrice, 5);
    if (ind.bb) {
      ctx.fillStyle = hexA(COL.bb, .12); ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) if (I.bb.up[i] != null) { started ? ctx.lineTo(X(i), Y(I.bb.up[i])) : ctx.moveTo(X(i), Y(I.bb.up[i])); started = true; }
      for (let i = n - 1; i >= 0; i--) if (I.bb.lo[i] != null) ctx.lineTo(X(i), Y(I.bb.lo[i]));
      ctx.closePath(); ctx.fill();
      line(I.bb.up, P, lo, hi, COL.bb, 1); line(I.bb.lo, P, lo, hi, COL.bb, 1); line(I.bb.mid, P, lo, hi, COL.bb, 1);
    }
    const up = bars[n - 1].c >= bars[0].c;
    if (D.type === 'candle') {
      const bw = Math.max(1, Math.min(14, L.cw * 0.7));
      for (let i = 0; i < n; i++) {
        const b = bars[i], col = b.c >= b.o ? UP : DOWN;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        const x = Math.round(X(i)) + .5;
        ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
        const yo = Y(b.o), yc = Y(b.c);
        ctx.fillRect(Math.round(X(i) - bw / 2), Math.min(yo, yc), Math.max(1, Math.round(bw)), Math.max(1, Math.abs(yc - yo)));
      }
    } else {
      const col = up ? UP : DOWN;
      const g = ctx.createLinearGradient(0, P.y, 0, P.y + P.h);
      g.addColorStop(0, hexA(up ? UP : DOWN, .28)); g.addColorStop(1, hexA(up ? UP : DOWN, 0));
      ctx.beginPath(); ctx.moveTo(X(0), P.y + P.h);
      for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(bars[i].c));
      ctx.lineTo(X(n - 1), P.y + P.h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      line(bars.map(b => b.c), P, lo, hi, col, 2);
    }
    if (ind.sma) { line(I.sma20, P, lo, hi, COL.sma20); line(I.sma50, P, lo, hi, COL.sma50); }
    if (ind.ema) line(I.ema20, P, lo, hi, COL.ema20);
    /* last price marker */
    ctx.fillStyle = up ? UP : DOWN; const ly = Math.round(Y(bars[n - 1].c));
    ctx.fillRect(L.right + 2, ly - 8, W - L.right - 4, 16);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(fmtPrice(bars[n - 1].c), L.right + 5, ly);

    /* volume */
    const V = L.panels.vol;
    const vs = bars.map(b => b.v);
    if (vs.some(v => v != null)) {
      const vmax = Math.max(...vs.map(v => v || 0)) || 1;
      for (let i = 0; i < n; i++) {
        if (vs[i] == null) continue;
        ctx.fillStyle = hexA(bars[i].c >= bars[i].o ? UP : DOWN, .55);
        const bh = vs[i] / vmax * V.h;
        ctx.fillRect(Math.round(X(i) - Math.max(1, L.cw * 0.35)), V.y + V.h - bh, Math.max(1, Math.round(L.cw * 0.7)), bh);
      }
      ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText('Vol ' + fmtVol(vmax), L.right + 6, V.y + 6);
    } else { ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText('No volume for this symbol', L.left + 4, V.y + V.h / 2); }

    /* RSI */
    if (ind.rsi) {
      const p = L.panels.rsi;
      ctx.strokeStyle = grid; ctx.fillStyle = ink; ctx.textAlign = 'left';
      for (const v of [30, 70]) { const y = Math.round(p.y + p.h - v / 100 * p.h) + .5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(L.left, y); ctx.lineTo(L.right, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(String(v), L.right + 6, y); }
      line(I.rsi, p, 0, 100, COL.rsi);
      ctx.fillStyle = COL.rsi; ctx.fillText('RSI 14', L.right + 6, p.y + 6);
    }
    /* MACD */
    if (ind.macd) {
      const p = L.panels.macd, m = I.macd;
      const all = [...m.line, ...m.signal, ...m.hist].filter(v => v != null);
      let a = Math.min(0, ...all), b = Math.max(0, ...all);
      if (a === b) { a = -1; b = 1; }
      const zy = Math.round(p.y + p.h - (0 - a) / (b - a) * p.h) + .5;
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(L.left, zy); ctx.lineTo(L.right, zy); ctx.stroke();
      for (let i = 0; i < n; i++) {
        const v = m.hist[i]; if (v == null) continue;
        const y = p.y + p.h - (v - a) / (b - a) * p.h;
        ctx.fillStyle = hexA(v >= 0 ? UP : DOWN, .55);
        ctx.fillRect(Math.round(X(i) - Math.max(1, L.cw * 0.35)), Math.min(y, zy), Math.max(1, Math.round(L.cw * 0.7)), Math.max(1, Math.abs(zy - y)));
      }
      line(m.line, p, a, b, COL.macd); line(m.signal, p, a, b, COL.sig);
      ctx.fillStyle = COL.macd; ctx.textAlign = 'left'; ctx.fillText('MACD', L.right + 6, p.y + 6);
    }

    /* dates */
    ctx.fillStyle = ink; ctx.textAlign = 'center';
    const marks = Math.max(2, Math.min(6, Math.floor((L.right - L.left) / 90)));
    for (let k = 0; k < marks; k++) {
      const i = Math.round(k * (n - 1) / (marks - 1));
      ctx.fillText(dateLabel(bars[i]), Math.min(L.right - 26, Math.max(L.left + 26, X(i))), H - 8);
    }

    /* crosshair */
    if (idx != null) {
      const x = Math.round(X(idx)) + .5;
      ctx.strokeStyle = ink0; ctx.globalAlpha = .55; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.bottom); ctx.stroke();
      const cy = Math.round(Y(bars[idx].c)) + .5;
      ctx.beginPath(); ctx.moveTo(L.left, cy); ctx.lineTo(L.right, cy); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(X(idx), Y(bars[idx].c), 3.5, 0, 7); ctx.fill();
      /* chips on the axes: the close at the crosshair, and its date */
      if (Math.abs(cy - Math.round(Y(bars[n - 1].c))) > 18) {
        const pv = fmtPrice(bars[idx].c), pw = ctx.measureText(pv).width + 10;
        ctx.fillStyle = accent; ctx.fillRect(L.right + 2, cy - 8, pw, 16);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(pv, L.right + 7, cy);
      }
      const dl = dateLabel(bars[idx]), dw = ctx.measureText(dl).width + 10;
      ctx.fillStyle = accent; ctx.fillRect(Math.min(W - dw, Math.max(0, x - dw / 2)), H - 18, dw, 16);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(dl, Math.min(W - dw, Math.max(0, x - dw / 2)) + 5, H - 10);
    }
    canvas.dataset.bars = String(n); canvas.dataset.draws = String(++draws);
    canvas.dataset.last = String(bars[n - 1].c);
    paintReadout();
  }

  function paintReadout() {
    if (!readout || !D || !D.bars.length) return;
    const i = idx == null ? D.bars.length - 1 : idx;
    const b = D.bars[i], { I, ind } = D;
    const COL = palette();
    const item = (label, val, color) => h('span.mkc__it', color ? h('i', { style: { background: color } }) : null, h('span', { text: `${label} ${val}` }));
    const kids = [h('b.mkc__date', { text: (idx == null ? 'Latest bar ' : '') + dateLabel(b, true) }),
      item('O', fmtPrice(b.o)), item('H', fmtPrice(b.h)), item('L', fmtPrice(b.l)), item('C', fmtPrice(b.c)), item('Vol', fmtVol(b.v))];
    if (ind.sma) kids.push(item('SMA 20', fmtPrice(I.sma20[i]), COL.sma20), item('SMA 50', fmtPrice(I.sma50[i]), COL.sma50));
    if (ind.ema) kids.push(item('EMA 20', fmtPrice(I.ema20[i]), COL.ema20));
    if (ind.bb) kids.push(item('Bollinger 20,2 lower/upper', `${fmtPrice(I.bb.lo[i])} / ${fmtPrice(I.bb.up[i])}`, COL.bb));
    if (ind.rsi) kids.push(item('RSI 14', I.rsi[i] == null ? 'n/a' : I.rsi[i].toFixed(1), COL.rsi));
    if (ind.macd) kids.push(item('MACD', `${I.macd.line[i] == null ? 'n/a' : I.macd.line[i].toFixed(3)} signal ${I.macd.signal[i] == null ? 'n/a' : I.macd.signal[i].toFixed(3)} hist ${I.macd.hist[i] == null ? 'n/a' : I.macd.hist[i].toFixed(3)}`, COL.macd));
    readout.replaceChildren(...kids);
    readout.dataset.idx = String(i);
  }
  const queue = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const at = e => {
    if (!D) return;
    const L = layout();
    const r = canvas.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - L.left) / L.cw);
    idx = Math.max(0, Math.min(D.bars.length - 1, i)); queue();
  };
  const onMove = e => at(e);
  const onLeave = () => { idx = null; queue(); };
  const onKey = e => {
    if (!D) return;
    const n = D.bars.length;
    const cur = idx == null ? n - 1 : idx;
    let nx = null;
    if (e.key === 'ArrowLeft') nx = cur - 1; else if (e.key === 'ArrowRight') nx = cur + 1;
    else if (e.key === 'Home') nx = 0; else if (e.key === 'End') nx = n - 1; else if (e.key === 'Escape') { idx = null; queue(); return; }
    if (nx == null) return;
    e.preventDefault();
    idx = Math.max(0, Math.min(n - 1, nx)); queue();
    const b = D.bars[idx];
    if (live) live.textContent = `${dateLabel(b, true)}: open ${fmtPrice(b.o)}, high ${fmtPrice(b.h)}, low ${fmtPrice(b.l)}, close ${fmtPrice(b.c)}`;
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('blur', onLeave);
  size();

  return {
    set(d) { D = d; if (idx != null && D && idx >= D.bars.length) idx = null; size(); draw(); },
    redraw() { size(); draw(); },
    destroy() {
      ro.disconnect(); if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onMove);
      canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('blur', onLeave);
    },
  };
}
