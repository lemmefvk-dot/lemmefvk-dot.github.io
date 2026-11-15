/* ============================================================
   arcade/watchui.js — the screens for spectating (./spectate.js).

     sharer({ notify, linkFor }) -> { btn, panel, setSource(fn), sync(game), stop(), active() }
        The player's side: a "Let friends watch" button and the panel
        under the toolbar. Nothing is shared until "Start sharing" is
        pressed. The panel says who is watching (count and names), and
        that it runs over a free public server.
     watcherView({ code, onLeave }) -> { el, stop() }
        The friend's side: the game, read-only, with who is watching.
        Board games are DOM; the live kinds (Snake, Snake Battle, Air
        Hockey, Breakout, Flap) are a canvas that eases from one picture
        to the next. No listeners on either — nothing here can send a move.
   ============================================================ */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { arcadeById } from './index.js';
import { openBroadcast, openWatcher, MAX_WATCHERS, LIVE_KINDS } from './spectate.js';
import { spaced } from '../core/roomcode.js';

const CSS = `
.arc-spec{display:none;margin:0 var(--sp-5,16px) var(--sp-3,8px);padding:12px 14px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-1);font-size:var(--fs-13,13px);color:var(--ink-1)}
.arc-spec.is-open{display:block}
.arc-spec__row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.arc-spec__code{font:700 22px/1 var(--mono,ui-monospace,monospace);letter-spacing:.18em;color:var(--ink-0);padding:6px 10px;border-radius:8px;background:var(--fill-0);border:1px solid var(--line-1)}
.arc-spec__count{font-weight:700;color:var(--ink-0)}
.arc-spec__note{margin-top:8px;font-size:var(--fs-11,11px);line-height:1.5;color:var(--ink-3)}
.arc-ib.is-sharing{color:#7dffb0;border-color:rgba(125,255,176,.5)}
.arc-wv{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px 16px;overflow:auto;font-family:var(--font,system-ui);color:var(--ink-1)}
.arc-wv[hidden]{display:none}
.arc-wv__top{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.arc-wv__top>.icon,.arc-wv__top>svg{width:20px;height:20px;flex:none;color:var(--ink-2)}
.arc-wv__title{font-weight:700;font-size:var(--fs-15,15px);color:var(--ink-0);flex:1;min-width:0}
.arc-wv__who{font-size:var(--fs-13,13px)}
.arc-wv__who b{color:var(--ink-0)}
.arc-wv__stage{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.arc-wv__msg{padding:14px 16px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-1);max-width:460px;text-align:center}
.arc-wv__msg.is-err{border-color:rgba(255,110,130,.5);background:rgba(255,80,100,.12)}
.arc-wv__txt{font-weight:650;color:var(--ink-0);text-align:center}
.arc-wv__big{font:800 56px/1 var(--font,system-ui);color:var(--ink-0)}
.arc-wv__pl{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;font-size:var(--fs-13,13px)}
.arc-wv__pl span.is-turn{color:var(--ink-0);font-weight:700;text-decoration:underline}
.arc-wvb{display:grid;gap:0;width:min(88%,min(520px,62vh));user-select:none;-webkit-user-select:none;pointer-events:none;font-family:system-ui,sans-serif}
.arc-wvb>i{display:flex;align-items:center;justify-content:center;font-style:normal;aspect-ratio:1;line-height:1;overflow:hidden}
.arc-wvb--chess>i{font-size:min(5.6vw,38px)}
.arc-wvb--chess>i.l{background:#c9d4e8}.arc-wvb--chess>i.d{background:#5b78a8}
.arc-wvb--chess>i.w{color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,0 1px 3px #000}.arc-wvb--chess>i.k{color:#111;text-shadow:0 0 1px #fff}
.arc-wvb--c4{background:#2346e8;padding:2%;border-radius:12px}
.arc-wvb--c4>i::after,.arc-wvb--rev>i::after,.arc-wvb--chk>i::after{content:'';width:78%;height:78%;border-radius:50%;background:rgba(0,0,0,.35)}
.arc-wvb--c4>i.a::after{background:#ffd23f}.arc-wvb--c4>i.b::after{background:#ff4d6d}
.arc-wvb--rev>i{background:#1c7a45;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}
.arc-wvb--rev>i::after{background:transparent}.arc-wvb--rev>i.a::after{background:#111}.arc-wvb--rev>i.b::after{background:#f4f4f4}
.arc-wvb--go>i,.arc-wvb--gomoku>i{background:#c99a55;box-shadow:inset 0 0 0 1px rgba(60,35,10,.55)}
.arc-wvb--go>i::after,.arc-wvb--gomoku>i::after{content:'';width:82%;height:82%;border-radius:50%}
.arc-wvb--go>i.a::after,.arc-wvb--gomoku>i.a::after{background:#111}.arc-wvb--go>i.b::after,.arc-wvb--gomoku>i.b::after{background:#f4f4f4}
.arc-wvb--chk>i.l{background:#e4d2ac}.arc-wvb--chk>i.d{background:#6b4a37}
.arc-wvb--chk>i::after{background:transparent;width:70%;height:70%}.arc-wvb--chk>i.a::after{background:#ff4d5f}.arc-wvb--chk>i.b::after{background:#f1e6c8}
.arc-wvb--chk>i.k::before{content:'\\265B';position:absolute;color:#ffd84d;font-size:calc(16px * var(--fs-k,1));z-index:1}
.arc-wvb--chk>i{position:relative}
.arc-wvb--ttt>i,.arc-wvb--uttt>i{border:1px solid rgba(160,200,255,.4);font-weight:800;font-size:min(9vw,56px)}
.arc-wvb--uttt>i{font-size:min(3.4vw,24px)}
.arc-wvb--ttt>i.a,.arc-wvb--uttt>i.a{color:#4dd2ff}.arc-wvb--ttt>i.b,.arc-wvb--uttt>i.b{color:#ff4d6d}
.arc-wvb--ttt>i.hl,.arc-wvb--uttt>i.hl{background:rgba(255,255,255,.2)}
.arc-wvb--uttt>i.s3{border-right:2px solid rgba(160,200,255,.9)}.arc-wvb--uttt>i.r3{border-bottom:2px solid rgba(160,200,255,.9)}
.arc-wvb--uttt>i.go{background:rgba(255,255,255,.12)}
.arc-wvb--dnb>i{aspect-ratio:auto}
.arc-wvb--dnb>i.dot::after{content:'';width:9px;height:9px;border-radius:50%;background:#e8eeff}
.arc-wvb--dnb>i.eh{height:100%}.arc-wvb--dnb>i.eh::after,.arc-wvb--dnb>i.ev::after{content:'';background:rgba(160,190,255,.14);border-radius:3px}
.arc-wvb--dnb>i.eh::after{width:100%;height:5px}.arc-wvb--dnb>i.ev::after{width:5px;height:100%}
.arc-wvb--dnb>i.on::after{background:rgba(215,228,255,.95)}
.arc-wvb--dnb>i.bx{aspect-ratio:1}.arc-wvb--dnb>i.a{background:rgba(77,210,255,.3)}.arc-wvb--dnb>i.b{background:rgba(255,77,109,.3)}
.arc-wvb--pits{grid-template-columns:repeat(8,1fr);gap:6px;padding:10px;border-radius:18px;background:linear-gradient(180deg,#6b4226,#4a2b16)}
.arc-wvb--pits>i{border-radius:50%;background:rgba(20,10,4,.65);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);color:#ffe9c2;font-weight:800;font-size:min(4.2vw,22px)}
.arc-wvb--pits>i.st{grid-row:span 2;aspect-ratio:auto;border-radius:22px}
.arc-wvb--pits>i.go{box-shadow:inset 0 0 0 2px rgba(255,220,120,.85)}
.arc-wvf{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;width:100%}
.arc-wvf>figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px;flex:1 1 200px;max-width:min(300px,46vh)}
.arc-wvf figcaption{font-size:var(--fs-12,12px);font-weight:700;color:var(--ink-1)}
.arc-wvb--fleet{grid-template-columns:repeat(10,1fr);width:100%;background:#0b2a4a;border-radius:6px;overflow:hidden}
.arc-wvb--fleet>i{box-shadow:inset 0 0 0 1px rgba(120,180,255,.18)}
.arc-wvb--fleet>i.S{background:#8a97a8}.arc-wvb--fleet>i.x{background:#e0533d}.arc-wvb--fleet>i.k{background:#5a1a12}
.arc-wvb--fleet>i.o::after{content:'';width:28%;height:28%;border-radius:50%;background:rgba(220,235,255,.75)}
.arc-wvb--fleet>i.h::after{content:'';width:52%;height:52%;border-radius:50%;background:#ff6a4d}
.arc-wvc{display:block;flex:none;border-radius:12px;background:#04080c;pointer-events:none;user-select:none;-webkit-user-select:none}
`;

const GLYPH = { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔', p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

/** a snapshot's board as read-only DOM (no handlers: it cannot be played) */
export function renderBoard(s) {
  const n = s.w, m = s.h;
  if (s.st === 'dnb') {
    const side = 2 * n + 1;
    const wrap = h('div.arc-wvb.arc-wvb--dnb', { role: 'img', 'aria-label': 'Dots and Boxes board', style: { gridTemplateColumns: Array.from({ length: side }, (_x, c) => (c % 2 ? '1fr' : '12px')).join(' '), gridTemplateRows: Array.from({ length: side }, (_x, r) => (r % 2 ? '1fr' : '12px')).join(' ') } });
    for (let i = 0; i < s.cells.length; i++) {
      const r = Math.floor(i / side), c = i % side, ch = s.cells[i];
      let cls = '';
      if (r % 2 === 0 && c % 2 === 0) cls = 'dot';
      else if (r % 2 === 0) cls = 'eh' + (ch === '-' ? ' on' : '');
      else if (c % 2 === 0) cls = 'ev' + (ch === '|' ? ' on' : '');
      else cls = 'bx' + (ch === '1' ? ' a' : ch === '2' ? ' b' : '');
      wrap.append(h('i', { class: cls }));
    }
    return wrap;
  }
  const wrap = h('div.arc-wvb', { class: `arc-wvb--${s.st}`, role: 'img', 'aria-label': `${s.st} board`, style: { gridTemplateColumns: `repeat(${n}, 1fr)` } });
  const hl = new Set(s.hl);
  for (let i = 0; i < s.cells.length; i++) {
    const ch = s.cells[i], r = Math.floor(i / n), c = i % n;
    const cls = [];
    let text = '';
    if (s.st === 'chess') { cls.push((r + c) % 2 ? 'd' : 'l'); if (GLYPH[ch]) { text = GLYPH[ch]; cls.push(ch === ch.toUpperCase() ? 'w' : 'k'); } }
    else if (s.st === 'c4') { if (ch === '1') cls.push('a'); else if (ch === '2') cls.push('b'); }
    else if (s.st === 'rev' || s.st === 'go' || s.st === 'gomoku') { if (ch === 'B') cls.push('a'); else if (ch === 'W') cls.push('b'); }
    else if (s.st === 'chk') { cls.push((r + c) % 2 ? 'd' : 'l'); if (ch === 'r' || ch === 'R') cls.push('a'); else if (ch === 'c' || ch === 'C') cls.push('b'); if (ch === 'R' || ch === 'C') cls.push('k'); }
    else { /* ttt, uttt */
      if (ch === 'X') { text = 'X'; cls.push('a'); } else if (ch === 'O') { text = 'O'; cls.push('b'); }
      if (s.st === 'uttt') {
        if (c % 3 === 2 && c < 8) cls.push('s3');
        if (r % 3 === 2 && r < 8) cls.push('r3');
        const sb = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        if (s.x && !s.over && (s.x.nx === -1 ? s.x.sub[sb] === '.' : s.x.nx === sb)) cls.push('go');
      }
      if (s.st === 'ttt' && hl.has(i)) cls.push('hl');
    }
    wrap.append(h('i', { class: cls.join(' '), text }));
  }
  return wrap;
}

/* the player's own "You" reads as their name on a watcher's screen */
const who = (n, host) => (n === 'You' && host ? host : n);

/** Mancala: the bottom row is the sharing player's side, as on their screen (stores at the ends) */
export function renderPits(s, host) {
  const wrap = h('div.arc-wvb.arc-wvb--pits', { role: 'img', 'aria-label': `Mancala: ${s.pl.map((p, i) => `${who(p.n, host)} ${s.b[i * 7 + 6]} ${s.ow ? 'taken' : 'in store'}`).join(', ')}` });
  const top = 1 - s.bs;
  const pit = (side, k) => h('i', { class: s.turn === side ? 'go' : '', dataset: { i: String(side * 7 + k) }, text: String(s.b[side * 7 + k]) });
  wrap.append(h('i.st', { dataset: { i: String(top * 7 + 6) }, text: String(s.b[top * 7 + 6]) }));
  for (let k = PITS_N - 1; k >= 0; k--) wrap.append(pit(top, k));
  wrap.append(h('i.st', { dataset: { i: String(s.bs * 7 + 6) }, text: String(s.b[s.bs * 7 + 6]) }));
  for (let k = 0; k < PITS_N; k++) wrap.append(pit(s.bs, k));
  return wrap;
}
const PITS_N = 6;

/** Battleship: the sharing player's own fleet (with the shots it took) and their shots — never the other fleet */
export function renderFleet(s, host) {
  const me = who(s.pl[0]?.n || 'You', host), them = s.pl[1]?.n || 'Opponent';
  const grid = (str, label, own) => {
    const g = h('div.arc-wvb.arc-wvb--fleet', { role: 'img', 'aria-label': label, dataset: { k: own ? 'own' : 'shots' } });
    for (const ch of str) g.append(h('i', { class: own ? { S: 'S', x: 'x', '#': 'x k', o: 'o' }[ch] || '' : { x: 'h', '#': 'h k', o: 'o' }[ch] || '' }));
    return g;
  };
  return h('div.arc-wvf',
    h('figure', h('figcaption', { text: `${me}’s fleet` }), grid(s.own, `${me}’s fleet and the shots it has taken`, true)),
    h('figure', h('figcaption', { text: `${me}’s shots at ${them}` }), grid(s.shots, `${me}’s shots: hits and misses`, false)));
}

/* ---------- the live kinds: one canvas, eased between pictures, no input ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
const LIVE_GEO = {
  hockey: { w: 800, h: 440, label: 'Air hockey table' },
  bricks: { w: 800, h: 600, label: 'Breakout table' },
  flap: { w: 800, h: 600, label: 'Flap course' },
  snakes: { w: 0, h: 0, label: 'Snake board' },
};
const BR = { COLS: 10, MARGIN: 36, GAP: 6, BH: 22, TOP: 78, HUES: [330, 345, 0, 14, 28, 40, 52, 64] };
const SNAKE_HUES = [140, 330];
export function liveView(kind) {
  const cv = h('canvas.arc-wvc', { role: 'img', 'aria-label': LIVE_GEO[kind].label, dataset: { kind } });
  const g = cv.getContext('2d');
  let prev = null, cur = null, raf = 0, dead = false;
  /* as large as the stage allows (up to 680 wide), keeping the game's shape */
  function size(w, hh) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = cv.parentElement;
    const maxW = Math.min(680, Math.max(120, (box?.clientWidth || 480) - 8));
    const maxH = Math.max(120, Math.min(window.innerHeight * 0.6, (box?.clientHeight || 400) - 70));
    const k0 = Math.min(maxW / w, maxH / hh);
    const cw = Math.round(w * k0), ch = Math.round(hh * k0);
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      cv.style.width = `${cw}px`; cv.style.height = `${ch}px`;
    }
    const k = cv.width / w;
    g.setTransform(k, 0, 0, k, 0, 0);
  }
  function frame() {
    raf = 0;
    if (dead || !cur) return;
    const dur = prev ? Math.max(60, Math.min(500, cur.at - prev.at)) : 1;
    const t = prev ? Math.min(1, (performance.now() - cur.at) / dur) : 1;
    const A = prev ? prev.s : cur.s, B = cur.s;
    if (kind === 'hockey') drawHockey(A, B, t);
    else if (kind === 'bricks') drawBricks(A, B, t);
    else if (kind === 'flap') drawFlap(A, B, t);
    else drawSnakes(B);
    if (t < 1 && kind !== 'snakes') raf = requestAnimationFrame(frame);
  }
  function drawHockey(A, B, t) {
    size(800, 440);
    g.fillStyle = '#071019'; g.fillRect(0, 0, 800, 440);
    g.strokeStyle = 'rgba(120,200,255,.35)'; g.lineWidth = 3;
    g.strokeRect(4, 4, 792, 432);
    g.beginPath(); g.moveTo(400, 4); g.lineTo(400, 436); g.stroke();
    g.beginPath(); g.arc(400, 220, 60, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(120,200,255,.5)'; g.fillRect(0, 120, 6, 200); g.fillRect(794, 120, 6, 200);
    [[200, 0], [22, 1]].forEach(([hue, i]) => {
      const a = A.m[i], b = B.m[i];
      g.fillStyle = `hsl(${hue} 95% 60%)`;
      g.beginPath(); g.arc(lerp(a[0], b[0], t), lerp(a[1], b[1], t), 30, 0, Math.PI * 2); g.fill();
    });
    if (B.pk) {
      const a = A.pk || B.pk;
      g.fillStyle = '#f4f7ff';
      g.beginPath(); g.arc(lerp(a[0], B.pk[0], t), lerp(a[1], B.pk[1], t), 16, 0, Math.PI * 2); g.fill();
    }
  }
  function drawBricks(A, B, t) {
    const H = B.h;
    size(800, H);
    g.fillStyle = '#07040a'; g.fillRect(0, 0, 800, H);
    const bw = (800 - BR.MARGIN * 2 - BR.GAP * (BR.COLS - 1)) / BR.COLS;
    for (let i = 0; i < B.wall.length; i++) {
      const hp = +B.wall[i];
      if (!hp) continue;
      const r = Math.floor(i / BR.COLS), c = i % BR.COLS;
      g.fillStyle = `hsl(${BR.HUES[r % BR.HUES.length]} 90% ${hp > 1 ? 70 : 56}%)`;
      g.fillRect(BR.MARGIN + c * (bw + BR.GAP), BR.TOP + r * (BR.BH + BR.GAP), bw, BR.BH);
    }
    const px = lerp(A.pad[0], B.pad[0], t);
    g.fillStyle = 'hsl(20 100% 62%)';
    g.fillRect(px - B.pad[1] / 2, H - 52, B.pad[1], 14);
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(lerp(A.ball[0], B.ball[0], t), lerp(A.ball[1], B.ball[1], t), 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '700 22px system-ui,sans-serif'; g.textBaseline = 'middle';
    g.fillText(`Level ${B.lv} · ${B.lives} ${B.lives === 1 ? 'life' : 'lives'} · ${B.score.toLocaleString()}`, 36, 38);
  }
  function drawFlap(A, B, t) {
    size(800, 600);
    g.fillStyle = '#0a0a1f'; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#1d1630'; g.fillRect(0, 548, 800, 52);
    /* the course eases forward; the pipes are drawn from the newer picture, moved back by what is left to go */
    const cd = lerp(A.cd, B.cd, t), shift = B.cd - cd;
    g.fillStyle = 'hsl(140 70% 42%)';
    for (const [ahead, top, bot] of B.p) {
      const x = 200 + ahead + shift;
      if (x > 820 || x + 74 < -20) continue;
      g.fillRect(x, 0, 74, top);
      g.fillRect(x, bot, 74, 548 - bot);
    }
    g.fillStyle = 'hsl(50 100% 60%)';
    g.beginPath(); g.ellipse(200, lerp(A.y, B.y, t), 17, 14, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '800 40px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(B.sc), 400, 60); g.textAlign = 'start';
  }
  function drawSnakes(B) {
    const c = Math.max(4, Math.floor(680 / B.w));
    size(B.w * c, B.h * c);
    g.fillStyle = '#04080c'; g.fillRect(0, 0, B.w * c, B.h * c);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    for (let x = 0; x <= B.w; x++) { g.beginPath(); g.moveTo(x * c, 0); g.lineTo(x * c, B.h * c); g.stroke(); }
    for (let y = 0; y <= B.h; y++) { g.beginPath(); g.moveTo(0, y * c); g.lineTo(B.w * c, y * c); g.stroke(); }
    if (B.f >= 0) { g.fillStyle = '#ff4d5e'; g.beginPath(); g.arc((B.f % B.w + 0.5) * c, (Math.floor(B.f / B.w) + 0.5) * c, c * 0.38, 0, Math.PI * 2); g.fill(); }
    for (const sn of B.sn) {
      const hue = SNAKE_HUES[sn.c] ?? 140;
      for (let i = sn.b.length - 2; i >= 0; i -= 2) {
        const cell = parseInt(sn.b.slice(i, i + 2), 36);
        g.fillStyle = `hsl(${hue} ${sn.a ? 85 : 20}% ${i === 0 ? 66 : sn.a ? 50 : 34}%)`;
        g.fillRect((cell % B.w) * c + 1, Math.floor(cell / B.w) * c + 1, c - 2, c - 2);
      }
    }
  }
  return {
    el: cv,
    feed(s) {
      if (dead) return;
      prev = cur;
      cur = { s, at: performance.now() };
      /* a new course, round or table: no easing across it */
      if (prev && (prev.s.k !== s.k || (kind === 'flap' && s.cd < prev.s.cd) || (kind === 'bricks' && s.h !== prev.s.h))) prev = null;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() { dead = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

const ERR = {
  invalid: ['That isn’t a watch code', 'Watch codes are 6 letters and numbers, like K7QM2X.'],
  nobody: ['Nobody is sharing that game', 'No game is being shared with that code right now. Check the code, and that your friend pressed “Start sharing”. A game that isn’t shared can’t be watched.'],
  full: ['That game has enough watchers', `At most ${MAX_WATCHERS} people can watch one game.`],
  secure: ['Can’t watch here', 'This browser can’t do the secure part of watching.'],
  quiet: ['Lost touch', 'Nothing has come from the player for a while. They may have left or lost their connection.'],
  ended: ['The player stopped sharing', 'This game isn’t being shared any more.'],
};

/* ---------------------------------------------------------- the friend's side */
export function watcherView({ code, onLeave }) {
  const W = openWatcher({ code });
  const titleEl = h('div.arc-wv__title', { text: 'Watching…' });
  const whoEl = h('div.arc-wv__who', { 'aria-live': 'polite' });
  const stageEl = h('div.arc-wv__stage', { 'aria-live': 'polite' });
  const leaveBtn = h('button.btn', { type: 'button', onclick: () => { stop(); onLeave?.(); } }, icon('chevron-left'), h('span', { text: 'Stop watching' }));
  const el = h('section.arc-wv', { 'aria-label': 'Watching a friend’s game' }, h('style', { text: CSS }),
    h('div.arc-wv__top', icon('eye'), titleEl, leaveBtn), whoEl, stageEl,
    h('div.arc-spec__note', { text: 'Watching runs over a free public server (StaticOS’s live connection). You see the game but can’t play or change anything. Names aren’t verified, and anyone with the code can watch.' }));
  let off = null, stopped = false;
  /* the last picture as received and cleaned, read-only, for automated play-tests */
  el.watchPeek = () => (W.snap ? JSON.parse(JSON.stringify(W.snap)) : null);
  /* a live kind's canvas lives across pictures (it eases from one to the next) */
  let live = null;
  const liveTxt = h('div.arc-wv__txt'), livePl = h('div.arc-wv__pl');
  const dropLive = () => { live?.stop(); live = null; };

  function paint() {
    if (stopped) return;
    const g = W.game ? arcadeById(W.game) : null;
    const snap = W.snap;
    const host = W.host?.name || '';
    /* a live picture, while watching: only the canvas and the lines over it change */
    if (snap && LIVE_KINDS.has(snap.k) && W.phase === 'watching') {
      if (!live || live.kind !== snap.k || !stageEl.contains(live.el)) {
        dropLive();
        live = { kind: snap.k, ...liveView(snap.k) };
        clear(stageEl);
        stageEl.append(liveTxt, livePl, live.el);
      }
      titleEl.textContent = `${host || 'A friend'} is playing ${g ? g.title : 'a game'}`;
      clear(whoEl);
      whoEl.append(h('b.arc-spec__count', { text: `${W.watchers.count} watching` }), h('span', { text: W.watchers.names.length ? `: ${W.watchers.names.join(', ')}` : '' }));
      liveTxt.textContent = snap.txt;
      const sc = snap.k === 'snakes' && snap.sn.length < 2 ? [] : snap.sc || [];
      livePl.replaceChildren(...(snap.pl || []).map((p, i) => h('span', { text: `${who(p.n, host)}${Number.isFinite(sc[i]) ? ` · ${sc[i]}` : ''}` })));
      live.el.setAttribute('aria-label', `${LIVE_GEO[snap.k].label}: ${snap.txt}`);
      live.feed(snap);
      return;
    }
    dropLive();
    clear(whoEl);
    if (W.phase === 'watching' || W.phase === 'ended') {
      const { count, names } = W.watchers;
      titleEl.textContent = `${W.host?.name || 'A friend'} is playing ${g ? g.title : 'a game'}`;
      whoEl.append(h('b.arc-spec__count', { text: `${count} watching` }), h('span', { text: names.length ? `: ${names.join(', ')}` : '' }));
    } else titleEl.textContent = W.error ? 'Can’t watch' : 'Watching…';
    clear(stageEl);
    if (W.phase === 'connecting' || W.phase === 'joining') {
      stageEl.append(h('div.arc-wv__msg', h('i.arc-spin'), h('span', { text: W.phase === 'connecting' ? ' Connecting…' : ` Looking for ${W.code}…` })));
      return;
    }
    if (W.phase === 'closed' && W.error && !snap) {
      const [t, x] = ERR[W.error] || ERR.nobody;
      stageEl.append(h('div.arc-wv__msg.is-err', { role: 'alert' }, h('b', { text: `${t}. ` }), h('span', { text: x })));
      return;
    }
    if (!snap) return;
    if (W.phase === 'ended' && W.error) { const [t, x] = ERR[W.error] || ERR.ended; stageEl.append(h('div.arc-wv__msg.is-err', { role: 'status' }, h('b', { text: `${t}. ` }), h('span', { text: x }))); }
    if (snap.k === 'board') {
      stageEl.append(h('div.arc-wv__txt', { text: snap.txt }));
      if (snap.pl.length) stageEl.append(h('div.arc-wv__pl', snap.pl.map((p, i) => h('span', { class: snap.turn === (i === 0 ? 1 : -1) ? 'is-turn' : '', text: `${p.n}${p.m ? ' · ' + p.m : ''}` }))));
      stageEl.append(renderBoard(snap));
    } else if (snap.k === 'pits') {
      stageEl.append(h('div.arc-wv__txt', { text: snap.txt }),
        h('div.arc-wv__pl', [1 - snap.bs, snap.bs].map(i => h('span', { class: snap.turn === i ? 'is-turn' : '', text: `${who(snap.pl[i]?.n || 'Player', host)} · ${snap.b[i * 7 + 6]}` }))),
        renderPits(snap, host));
    } else if (snap.k === 'fleet') {
      stageEl.append(h('div.arc-wv__txt', { text: snap.txt }), renderFleet(snap, host));
    } else if (LIVE_KINDS.has(snap.k)) {
      /* the last picture, still (the player stopped or went quiet) */
      const v = liveView(snap.k);
      stageEl.append(h('div.arc-wv__txt', { text: snap.txt }), v.el);
      v.feed(snap);
    } else {
      stageEl.append(h('div.arc-wv__txt', { text: snap.st === 'over' ? 'Round over' : snap.st === 'paused' ? 'Paused' : 'Playing now' }),
        h('div.arc-wv__big', { text: snap.score === null ? '—' : snap.score.toLocaleString() }),
        h('div.arc-wv__txt', { text: snap.unit ? `${snap.unit} so far` : 'score so far' }),
        snap.txt ? h('div.arc-spec__note', { text: snap.txt }) : null);
    }
  }
  off = W.on(() => paint());
  paint();
  function stop() {
    if (stopped) return;
    try { off?.(); } catch (e) { /* gone */ }
    dropLive();
    W.leave();
    stopped = true;
  }
  return { el, stop, W };
}

/* ---------------------------------------------------------- the player's side */
export function sharer({ notify, linkFor }) {
  let B = null, offB = null, poll = 0, source = null, gameId = null, open = false;
  const btn = h('button.arc-ib', { type: 'button', 'aria-expanded': 'false', 'aria-label': 'Let friends watch', title: 'Let friends watch this game live', onclick: () => { open = !open; paint(); } }, icon('eye'));
  btn.hidden = true;
  const panel = h('section.arc-spec', { 'aria-label': 'Let friends watch' }, h('style', { text: CSS }));
  const body = h('div.arc-spec__body');
  panel.append(body);

  function paint() {
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-sharing', !!B);
    panel.classList.toggle('is-open', open && !btn.hidden);
    clear(body);
    if (!open) return;
    const note = h('div.arc-spec__note', { text: `Watching runs over a free public server (StaticOS’s live connection). Watchers see this game but can’t play or change anything. Up to ${MAX_WATCHERS} can watch, anyone with the code can look, and names aren’t verified. Sharing stops when you leave this game.` });
    if (!B) {
      body.append(h('div.arc-spec__row', h('b', { text: 'Let friends watch this game live?' }),
        h('button.btn.btn--primary.arc-spec__start', { type: 'button', onclick: start }, icon('eye'), h('span', { text: 'Start sharing' }))), note);
      return;
    }
    const ws = B.watchers();
    body.append(
      h('div.arc-spec__row',
        h('span.arc-spec__code', { 'aria-label': `Watch code ${spaced(B.code)}`, dataset: { code: B.code }, text: B.code }),
        h('button.btn.btn--primary', { type: 'button', onclick: copy }, icon('copy'), h('span', { text: 'Copy watch link' })),
        h('button.btn.arc-spec__stop', { type: 'button', onclick: () => { stop(); } }, h('span', { text: 'Stop sharing' }))),
      h('div.arc-spec__row', { style: { marginTop: '8px' }, role: 'status', 'aria-live': 'polite' },
        h('span.arc-spec__count', { text: `${ws.length} watching` }),
        h('span.arc-spec__names', { text: ws.length ? ws.map(w => w.name).join(', ') : B.phase === 'open' ? 'Nobody yet — send them the code.' : 'Connecting…' })),
      note);
  }
  function start() {
    if (B || !gameId) return;
    B = openBroadcast({ game: gameId });
    offB = B.on(() => paint());
    push();
    /* a board changes when someone moves; a live kind every frame, so it is read more often */
    let n = 0;
    poll = setInterval(() => { n++; if (fast || n % 3 === 0) push(); }, 130);
    paint();
  }
  let fast = false;
  const push = () => { if (B && source) { const s = source(); fast = !!s && LIVE_KINDS.has(s.k); if (s) B.update(s); } };
  async function copy() {
    if (!B) return;
    const link = linkFor(gameId, B.code);
    const text = `Watch my ${gameId} game live in Static Arcade — watch code ${B.code}${link ? ` · ${link}` : ''}`;
    try { await navigator.clipboard.writeText(text); notify({ icon: 'copy', title: 'Watch link copied', message: `Watch code ${B.code}.` }); }
    catch (err) { notify({ icon: 'info', title: `Watch code ${B.code}`, message: 'Copying was blocked here — read the code out to your friend.' }); }
  }
  function stop() {
    clearInterval(poll);
    try { offB?.(); } catch (e) { /* gone */ }
    B?.stop();
    B = offB = null;
    paint();
  }
  return {
    btn, panel,
    setSource(fn) { source = fn; },
    /* the game on screen (or null): sharing belongs to one game session, so a different game ends it */
    sync(id) {
      if (id !== gameId) { if (B) stop(); open = false; }
      gameId = id;
      btn.hidden = !id;
      paint();
    },
    stop() { stop(); open = false; gameId = null; btn.hidden = true; paint(); },
    active: () => !!B,
    code: () => B?.code || null,
    stats: () => (B ? B.stats() : null),
  };
}
