/* ============================================================
   arcade/boardkit.js — what Chess (./chess.js) and Connect Four
   (./connect4.js) share: the board canvas, the side panel, a few
   synth sounds, and the online move link.

   LAYOUT. .arx-bgc is the size container; inside it .arx-bg is the board (a canvas, so Static Replay can
   record it) beside a panel: the opponent's strip on top, your
   strip at the bottom — on your screen your side is always the one
   at the bottom — and between them the status line, the computer's
   level, the move list and the buttons. When the window is taller
   than wide the panel moves under the board.

   ONLINE (duelLink). Moves travel as { t:'mv', n, … } where n is the
   move's number in the game (0 = the first). The receiving game
   checks every one with its rules engine before it touches the
   board: a move for the wrong turn, an illegal one, or junk is
   counted in `rejected` and ignored. A move from further ahead
   means one was lost on the way: { t:'need', n } asks for it again,
   and a beat { t:'st', n } every 1.5 s lets a lost LAST move be
   noticed too. { t:'rs' } resigns. Only the friend's own messages
   reach a game (./room.js drops everyone else's).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

export const KIT_CSS = `
.arx-bgc{position:absolute;inset:0;container-type:size}
.arx-bgc *{box-sizing:border-box}
.arx-bg{position:absolute;inset:0;display:flex;gap:var(--sp-5,16px);padding:var(--sp-5,16px);
  font-family:var(--font,system-ui);color:var(--ink-1,#ddd);user-select:none;-webkit-user-select:none}
.arx-bg__board{position:relative;flex:1 1 auto;min-width:0;min-height:0}
.arx-bg__side{flex:0 0 248px;min-width:0;min-height:0;display:flex;flex-direction:column;gap:var(--sp-3,8px)}
.arx-bg__pl{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-1)}
.arx-bg__pl.is-turn{border-color:hsl(var(--h) 90% 66% / .7);box-shadow:0 0 0 1px hsl(var(--h) 90% 60% / .25),0 0 18px -6px hsl(var(--h) 95% 60% / .8)}
.arx-bg__sw{flex:0 0 auto;width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.18)}
.arx-bg__who{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.arx-bg__who b{font-size:var(--fs-13,13px);font-weight:700;color:var(--ink-0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arx-bg__who small{font-size:var(--fs-11,11px);color:var(--ink-3)}
.arx-bg__think{display:none;width:14px;height:14px;border-radius:50%;border:2px solid hsl(var(--h) 90% 70% / .3);border-top-color:hsl(var(--h) 90% 75%);animation:arx-bg-spin .8s linear infinite}
.arx-bg__pl.is-thinking .arx-bg__think{display:block}
@keyframes arx-bg-spin{to{transform:rotate(1turn)}}
.arx-bg__status{min-height:38px;display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:var(--r-md,11px);font-size:var(--fs-13,13px);font-weight:650;color:var(--ink-0);
  background:hsl(var(--h) 60% 40% / .14);border:1px solid hsl(var(--h) 80% 60% / .22)}
.arx-bg__status.is-alert{background:rgba(255,80,100,.14);border-color:rgba(255,110,130,.4)}
.arx-bg__status.is-done{background:hsl(var(--h) 80% 50% / .22);border-color:hsl(var(--h) 90% 66% / .55)}
.arx-bg__row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.arx-bg__lab{font-size:var(--fs-11,11px);font-weight:650;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;min-width:52px}
.arx-bg__seg{display:inline-flex;flex:1;padding:3px;border-radius:var(--r-md,11px);background:var(--fill-1);border:1px solid var(--line-0)}
.arx-bg__seg button{flex:1;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-2);background:none;border:0;padding:7px 6px;border-radius:8px;cursor:pointer;white-space:nowrap}
.arx-bg__seg button[aria-pressed="true"]{background:var(--fill-3);color:var(--ink-0);box-shadow:0 1px 2px rgba(0,0,0,.3)}
.arx-bg__seg button:disabled{opacity:.45;cursor:default}
.arx-bg__btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1;height:34px;padding:0 10px;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1);
  background:var(--fill-1);border:1px solid var(--line-1);border-radius:var(--r-md,11px);cursor:pointer;white-space:nowrap}
.arx-bg__btn .icon{width:14px;height:14px}
.arx-bg__btn:disabled{opacity:.45;cursor:default}
@media (hover:hover){.arx-bg__btn:not(:disabled):hover,.arx-bg__seg button:not(:disabled):hover{background:var(--fill-2);color:var(--ink-0)}}
.arx-bg__btn.is-warn{color:#ffd6dc;border-color:rgba(255,110,130,.55);background:rgba(255,80,100,.16)}
.arx-bg__btn:focus-visible,.arx-bg__seg button:focus-visible{outline:2px solid hsl(var(--h) 100% 72%);outline-offset:2px}
.arx-bg__moves{flex:1 1 auto;min-height:48px;overflow:auto;margin:0;padding:6px 4px;list-style:none;border-radius:var(--r-md,11px);background:var(--fill-0);border:1px solid var(--line-0);
  font:500 var(--fs-12,12px)/1.6 var(--mono,ui-monospace,monospace);color:var(--ink-1);counter-reset:mv;user-select:text;-webkit-user-select:text}
.arx-bg__moves li{display:grid;grid-template-columns:30px 1fr 1fr;padding:0 6px;border-radius:6px}
.arx-bg__moves li:nth-child(odd){background:rgba(255,255,255,.025)}
.arx-bg__moves li span:first-child{color:var(--ink-3)}
.arx-bg__moves li .is-last{color:hsl(var(--h) 100% 80%);font-weight:700}
.arx-bg__moves:empty::before{content:attr(data-empty);display:block;padding:4px 6px;font-family:var(--font,system-ui);color:var(--ink-3)}
.arx-bg__note{font-size:var(--fs-11,11px);line-height:1.45;color:var(--ink-3)}
.arx-bg__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.arx-bg__promo{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:rgba(6,5,10,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.arx-bg__promo .arc-ov__card{width:min(360px,100%)}
.arx-bg__promo .arc-ov__row button{display:inline-flex;flex-direction:column;align-items:center;gap:4px;height:auto;padding:8px 10px 7px;min-width:64px}
.arx-bg__promo canvas{width:44px;height:44px}
@container (max-aspect-ratio: 11/10){
  .arx-bg{flex-direction:column;padding:var(--sp-3,8px);gap:var(--sp-3,8px)}
  .arx-bg__side{flex:0 0 auto;display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .arx-bg__side > *{grid-column:1 / -1;order:1}
  .arx-bg__side > .arx-bg__pl{grid-column:auto;order:0;padding:6px 9px}
  .arx-bg__moves,.arx-bg__note{display:none}
  .arx-bg__status{min-height:32px;padding:6px 10px}
}
@container (max-aspect-ratio: 11/10) and (max-height: 520px){.arx-bg__row--opt{display:none}}
`;

/* A canvas that fills `el`, backed at devicePixelRatio, refit on resize. */
export function surface(el, label, onFit) {
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', label);
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(cv);
  const s = { cv, g: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  let armed = false;
  const fit = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === s.w && h === s.h && dpr === s.dpr) return;
    s.w = w; s.h = h; s.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    if (armed) onFit?.(s);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(el);
  window.addEventListener('resize', fit);
  fit();
  armed = true;
  s.begin = () => s.g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  s.destroy = () => { ro?.disconnect(); window.removeEventListener('resize', fit); cv.remove(); };
  return s;
}

/* Should this keydown drive the game? Not while another window is in
   front, not while typing in a field, and a Space/Enter aimed at a
   button (ours or not) belongs to that button. */
export function ownsKey(el, e) {
  if (!el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const win = el.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
    if ((e.key === ' ' || e.key === 'Enter') && t.closest('button,a,[role="button"]')) return false;
  }
  return true;
}

/* Tiny synth blips, made on the first input and closed in stop(). */
export function sounder(ctx) {
  let ac = null, dead = false;
  const get = () => {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  return {
    wake() { get(); },
    blip(freq, dur = 0.07, type = 'square', vol = 1, to = 0) {
      const c = get();
      if (!c || c.state !== 'running') return;
      try {
        const t = c.currentTime, o = c.createOscillator(), gn = c.createGain();
        const peak = 0.05 * vol * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(peak, t + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn).connect(c.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (err) { /* audio can fail at any point; the game goes on */ }
    },
    close() {
      dead = true;
      try { ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      ac = null;
    },
  };
}

/* requestAnimationFrame loop that runs until `until` (seconds, performance clock) */
export function looper(step) {
  let raf = 0, on = false, until = 0;
  const tick = () => {
    raf = 0;
    step();
    if (performance.now() / 1000 < until) raf = requestAnimationFrame(tick); else on = false;
  };
  return {
    kick(sec = 0.05) {
      until = Math.max(until, performance.now() / 1000 + sec);
      if (!on) { on = true; raf = requestAnimationFrame(tick); }
    },
    stop() { on = false; until = 0; if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

export function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

/* ---------------------------- the panel ---------------------------- */
export function playerStrip(color, name, note) {
  const sw = h('span.arx-bg__sw', { style: { background: color } });
  const nm = h('b', { text: name });
  const sub = h('small', { text: note || '' });
  const el = h('div.arx-bg__pl', sw, h('span.arx-bg__who', nm, sub), h('i.arx-bg__think', { 'aria-hidden': 'true' }));
  return {
    el,
    set({ name: n, note: s, color: c, turn, thinking } = {}) {
      if (n !== undefined) nm.textContent = n;
      if (s !== undefined) sub.textContent = s;
      if (c !== undefined) sw.style.background = c;
      if (turn !== undefined) el.classList.toggle('is-turn', !!turn);
      if (thinking !== undefined) el.classList.toggle('is-thinking', !!thinking);
    },
  };
}

/* a labelled segmented control: options [{ id, label, title }] */
export function segment(label, options, value, onPick) {
  const btns = options.map(o => h('button', {
    type: 'button', dataset: { id: String(o.id) }, title: o.title || null, 'aria-pressed': String(o.id === value),
    onclick: () => onPick(o.id),
  }, h('span', { text: o.label })));
  const el = h('div.arx-bg__row.arx-bg__row--opt', h('span.arx-bg__lab', { text: label }),
    h('div.arx-bg__seg', { role: 'group', 'aria-label': label }, btns));
  return {
    el,
    set(v) { btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === String(v)))); },
    disable(off) { btns.forEach(b => { b.disabled = !!off; }); },
  };
}

export function button(label, iconName, onClick, extra = {}) {
  const txt = h('span', { text: label });
  const b = h('button.arx-bg__btn', { type: 'button', onclick: onClick, ...extra }, iconName ? icon(iconName) : null, txt);
  b.setLabel = t => { txt.textContent = t; };
  return b;
}

/* a two-step button: the first press asks, a second within 3 s does it */
export function confirmButton(label, ask, iconName, onConfirm) {
  let armed = 0;
  const b = button(label, iconName, () => {
    if (armed) { clearTimeout(armed); armed = 0; b.classList.remove('is-warn'); b.setLabel(label); onConfirm(); return; }
    b.classList.add('is-warn');
    b.setLabel(ask);
    armed = setTimeout(() => { armed = 0; b.classList.remove('is-warn'); b.setLabel(label); }, 3000);
  });
  b.reset = () => { clearTimeout(armed); armed = 0; b.classList.remove('is-warn'); b.setLabel(label); };
  return b;
}

/* ---------------------------- online ---------------------------- */
/**
 * The move link between the two screens of an online game.
 *   game: { plies() -> moves so far, mine(i) -> was move i made here,
 *           wire(i) -> that move's fields, take(d) -> apply the friend's
 *           move d (d.n === plies()) after checking it; return false to
 *           reject, resigned() -> the friend resigned, dead() }
 */
export function duelLink(NET, game) {
  let lastNeed = 0, lastReply = 0, off = null, beat = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const send = d => { try { return NET.send(d); } catch (err) { return false; } };
  const need = () => {
    const t = performance.now();
    if (t - lastNeed < 700) return;
    lastNeed = t;
    send({ t: 'need', n: game.plies() });
  };
  function onNet(d) {
    if (game.dead() || !d || typeof d !== 'object') return;
    if (d.t === 'mv') {
      if (!Number.isInteger(d.n) || d.n < 0 || d.n > 6000) { game.reject('bad'); return; }
      const have = game.plies();
      if (d.n < have) return;                       /* a repeat of a move already here */
      if (d.n > have) { need(); return; }           /* one went missing on the way */
      if (!game.take(d)) game.reject('illegal');
    } else if (d.t === 'need') {
      if (!Number.isInteger(d.n) || d.n < 0) return;
      const t = performance.now();
      if (t - lastReply < 300) return;
      lastReply = t;
      for (let i = d.n, sent = 0; i < game.plies() && sent < 4; i++) if (game.mine(i)) { send({ t: 'mv', n: i, ...game.wire(i) }); sent++; }
    } else if (d.t === 'st') {
      if (Number.isInteger(d.n) && d.n > game.plies()) need();
    } else if (d.t === 'rs') {
      game.resigned();
    }
  }
  off = NET.on?.(onNet) || null;
  beat = setInterval(() => { if (!game.dead()) send({ t: 'st', n: game.plies() }); }, 1500);
  return {
    sendMove(i) { send({ t: 'mv', n: i, ...game.wire(i) }); },
    resign() {
      const n = game.plies();
      send({ t: 'rs', n });
      later(() => send({ t: 'rs', n }), 700);
      later(() => send({ t: 'rs', n }), 1800);
    },
    stop() {
      try { off?.(); } catch (err) { /* already off */ }
      clearInterval(beat);
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
