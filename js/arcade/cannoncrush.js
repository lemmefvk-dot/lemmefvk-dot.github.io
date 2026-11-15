/* ============================================================
   arcade/cannoncrush.js — Cannon Crush for Static Arcade.

   Two cannons on a hill. On your turn set the angle and the power,
   mind the wind, and fire: the shell digs a crater where it lands,
   and the cannons settle onto what is left of the hill. A direct hit
   takes 34 of 100 health, a near miss up to 20, so three direct hits
   win; after 12 shots each, more health wins. The rules, the physics
   and the computer are in ./cannoncrush-rules.js (a shot is decided
   by the hill, the angle and the power alone, so two devices stay in
   step).

   · 1P: against the computer (Easy, Medium, Hard), you or the
     computer firing first — remembered in portal.arcadeCannoncrush.
     You are the left cannon. A win scores the shots you needed
     (fewer is better).
   · 2P: both cannons on one screen, the same keys for whoever's turn
     it is.
   · Online: a friend on another device through the Arcade's room.
     The host is the left cannon, the guest the right; the hill comes
     from the room's seed; the first shot swaps every rematch. Every
     arriving shot is checked (whose turn, an angle 5–85 and a power
     10–100, whole numbers) before it is fired on this screen.

   Controls
     ↑ ↓            angle (Shift: 5 at a time)
     ← →            power (Shift: 5 at a time)
     Space / Enter  fire
     mouse / touch  drag from the cannon to aim: the direction sets the
                    angle and the length the power (the sliders show
                    it); Fire shoots
   With reduced motion the shell isn't animated: its path is drawn at
   once and the crater appears.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { W, H, MAX_SHOTS, HP, LEVELS, newGame, fire, aiShot, legalShot, muzzle, dirOf, hillHash } from './cannoncrush-rules.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeCannoncrush';
const COLORS = ['#38c9e8', '#ff6b81'];
const NAMES = ['Left', 'Right'];
const THINK_MS = 700;
const SIM_SPEED = 2.2;
const SEG_CSS = `
.cc__sl{display:flex;align-items:center;gap:8px}
.cc__sl label{flex:0 0 54px;font-size:11px;font-weight:650;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px}
.cc__sl input{flex:1;min-width:0;accent-color:hsl(var(--h,200) 90% 65%)}
.cc__sl output{flex:0 0 34px;text-align:right;font:700 13px/1 var(--font,system-ui);color:var(--ink-0);font-variant-numeric:tabular-nums}
.cc__fire{height:42px;font-size:14px;font-weight:700;background:color-mix(in srgb,var(--accent,#ff456d) 35%,transparent);border-color:var(--accent,#ff456d)}
.cc__wind{font:650 12px/1.3 var(--font,system-ui);color:var(--ink-2)}
`;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', a: Number.isInteger(p?.a) ? Math.max(5, Math.min(85, p.a)) : 45, p: Number.isInteger(p?.p) ? Math.max(10, Math.min(100, p.p)) : 60 };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const mix = (a, b) => (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35)) >>> 0;
const randomSeed = () => { try { return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0; } catch (err) { return (Math.random() * 2 ** 32) >>> 0; } };

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    /* my cannon: the host is the left one online, always the left against the computer */
    const me = mode === 'online' ? (host ? 0 : 1) : 0;
    let dead = false, paused = false, thinkTimer = 0, flightEnd = 0;
    const firstShooter = () => (mode === 'online' ? ((round % 2 === 1) === host ? me : 1 - me) : mode === 'cpu' ? (S.first === 'cpu' ? 1 : 0) : 0);

    const S = {
      g: null, over: null, level: prefs.level, first: prefs.first, angle: prefs.a, power: prefs.p, shot: null, boom: null, thinking: false, thinkId: 0,
      rejected: 0, myShots: 0, ended: false, endT: 0, seed: 0, geo: { s: 1, ox: 0, oy: 0 }, aiming: false, pending: null, flash: [0, 0], cap: 0,
    };
    const nameOf = i => (mode === '2p' ? NAMES[i] : i === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(COLORS[1], '', '');
    const botStrip = playerStrip(COLORS[0], '', '');
    const windEl = h('div.cc__wind', { 'aria-live': 'off' });
    const angIn = h('input', { type: 'range', min: '5', max: '85', step: '1', value: String(S.angle), 'aria-label': 'Angle', oninput: () => setAim(+angIn.value, S.power) });
    const powIn = h('input', { type: 'range', min: '10', max: '100', step: '1', value: String(S.power), 'aria-label': 'Power', oninput: () => setAim(S.angle, +powIn.value) });
    const angOut = h('output', { text: '' }), powOut = h('output', { text: '' });
    /* a slider let go of with the mouse or a finger gives the keys back to the game (Space fires) */
    for (const sl of [angIn, powIn]) sl.addEventListener('pointerup', () => sl.blur());
    const sliders = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('div.cc__sl', h('label', { text: 'Angle' }), angIn, angOut), h('div.cc__sl', h('label', { text: 'Power' }), powIn, powOut));
    const fireBtn = button('Fire', 'flame', () => { shoot(); refocus(); }, { title: 'Fire (Space)' });
    fireBtn.classList.add('cc__fire');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: (mode === 'online' ? 'Every shot is checked on both screens. ' : mode === '2p' ? 'Two players on this screen: the left cannon shoots first, then take turns. ' : 'Set angle and power, then Fire. ')
        + 'Up/Down angle, Left/Right power, Space fires. Three direct hits win; after 12 shots each, more health wins.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, windEl, sliders, h('div.arx-bg__row', fireBtn, resignBtn), levelSeg?.el, firstSeg?.el, note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS + SEG_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Cannon Crush hill', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    const link = NET ? duelLink(NET, {
      plies: () => S.g.log.length,
      mine: i => S.g.log[i][0] === me,
      wire: i => ({ a: S.g.log[i][1], p: S.g.log[i][2] }),
      take: d => {
        if (S.over || S.g.turn !== 1 - me || !legalShot(d.a, d.p)) return false;
        launch(d.a, d.p, 'peer');
        return true;
      },
      reject: () => { S.rejected++; },
      resigned: () => {
        if (S.over) return;
        S.over = { winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`); ctx.announce?.(`${peerName} resigned.`);
        paint(); finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ the game ------------------------------ */
    function newRound() {
      clearTimeout(thinkTimer); clearTimeout(S.endT); clearTimeout(flightEnd);
      S.thinkId++;
      S.seed = mode === 'online' ? mix(NET.seed >>> 0, round) : randomSeed();
      S.g = newGame(S.seed, firstShooter());
      Object.assign(S, { over: null, shot: null, boom: null, thinking: false, myShots: 0, ended: false, pending: null, flash: [0, 0] });
      ctx.onScore(0); NET?.peerScore?.(0);
      paint();
      say(`New hill. ${nameOf(S.g.turn)} ${S.g.turn === me || mode === '2p' ? 'shoot' : 'shoots'} first.`);
      if (mode === 'cpu' && S.g.turn !== me) computerTurn();
    }
    const myTurn = () => !S.over && !S.shot && !S.thinking && (mode === '2p' || S.g.turn === me);
    const canAct = () => !dead && !paused && myTurn();

    function setAim(a, p) {
      S.angle = Math.max(5, Math.min(85, Math.round(a))); S.power = Math.max(10, Math.min(100, Math.round(p)));
      angIn.value = String(S.angle); powIn.value = String(S.power);
      angOut.textContent = `${S.angle}°`; powOut.textContent = String(S.power);
      if (myTurn()) writePrefs({ a: S.angle, p: S.power });
      draw();
    }
    function shoot() {
      if (!canAct()) return false;
      launch(S.angle, S.power, 'me');
      link?.sendMove(S.g.log.length - 1);
      return true;
    }
    /* fire on the world now; the picture follows the shell */
    function launch(a, p, by) {
      const g = S.g, i = g.turn;
      const before = g.cannons.map(c => c.hp);
      const r = fire(g, a, p);
      if (!r) return false;
      if (by === 'me') S.myShots++;
      S.shot = { r, a, p, i, t0: performance.now(), by, hp: before, shown: false };
      S.flash = [0, 0];
      snd.wake(); snd.blip(140, 0.12, 'sawtooth', 0.7, 60);
      const told = `${nameOf(i)} fired at ${a} degrees, power ${p}.`;
      say(told);
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (reduced) endFlight(); else loop.kick(flightTime(r) / 1000 + 0.3);
      return true;
    }
    const flightTime = r => (r.flight.steps / 120) / SIM_SPEED * 1000 + 40;
    function tickShot(now) {
      const s = S.shot;
      if (!s || paused) return;
      if (now - s.t0 >= flightTime(s.r) && !s.shown) endFlight();
    }
    function endFlight() {
      const s = S.shot;
      if (!s || s.shown) return;
      s.shown = true;
      const { r } = s, f = r.flight;
      S.boom = { x: f.x, y: f.y, t0: performance.now(), kind: f.kind, dmg: r.dmg };
      if (f.kind !== 'out') { snd.blip(r.dmg.some(d => d > 0) ? 90 : 120, 0.25, 'sawtooth', 0.9, 40); }
      else snd.blip(260, 0.1, 'triangle', 0.4, 140);
      r.dmg.forEach((d, k) => { if (d > 0) S.flash[k] = performance.now(); });
      const g = S.g;
      const told = r.dmg.some(d => d > 0)
        ? `Hit: ${r.dmg.map((d, k) => (d ? `${nameOf(k)} lose${mode === '2p' || k !== me ? 's' : ''} ${d} health` : '')).filter(Boolean).join(', ')}.`
        : f.kind === 'out' ? 'The shell flew off the hill: a miss.' : 'A miss: the shell dug a crater.';
      say(`${told}${g.over ? ' ' + overText() : ''}`);
      ctx.announce?.(told);
      S.shot = null;
      loop.kick(reduced ? 0.05 : 1.2);
      if (g.over) { S.over = g.over; paint(); snd.blip(520, 0.12, 'triangle', 0.8, 780); finishSoon(); return; }
      paint();
      if (mode === 'cpu' && g.turn !== me) computerTurn();
    }

    function computerTurn() {
      const id = ++S.thinkId;
      S.thinking = true; paint();
      const t0 = performance.now();
      thinkTimer = setTimeout(() => {
        if (dead || id !== S.thinkId) return;
        let sh = null;
        try { sh = aiShot(S.g, S.level); } catch (err) { console.error('[cannoncrush]', err); }
        const wait = THINK_MS - (performance.now() - t0);
        thinkTimer = setTimeout(() => {
          if (dead || id !== S.thinkId) return;
          S.thinking = false;
          if (paused) { S.pending = sh; return; }
          if (!sh || !launch(sh.a, sh.p, 'cpu')) { statusEl.textContent = 'The computer could not fire. Start a new round.'; statusEl.classList.add('is-alert'); }
        }, Math.max(0, wait));
      }, 40);
    }

    function resign() {
      if (S.over || dead) return;
      clearTimeout(thinkTimer); S.thinkId++; S.thinking = false;
      S.over = { winner: 1 - me, reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.'); paint(); finishSoon();
    }
    function finishSoon() { clearTimeout(S.endT); S.endT = setTimeout(finish, reduced ? 300 : 1100); }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true; paint();
      const o = S.over, g = S.g;
      const hp = `${g.cannons[0].hp}–${g.cannons[1].hp}`;
      const how = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
        : o.reason === 'shots' ? `After ${MAX_SHOTS} shots each, health ${hp}.` : o.reason === 'both' ? 'Both cannons were destroyed.' : `A cannon was destroyed (health ${hp}).`;
      if (mode === 'online') {
        const won = o.winner === -1 ? null : o.winner === me;
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail: how });
        return;
      }
      if (mode === '2p') { ctx.onEnd({ score: null, detail: o.winner === -1 ? `A draw. ${how}` : `${NAMES[o.winner]} wins. ${how}` }); return; }
      const lv = LEVELS[S.level].name, vs = { key: String(S.level), label: lv, result: o.winner === -1 ? 'draw' : o.winner === me ? 'win' : 'loss' };
      if (o.winner === me) ctx.onEnd({ score: Math.max(1, S.myShots), won: true, detail: `Won in ${S.myShots} shots against the computer (${lv}). ${how}`, vs });
      else ctx.onEnd({ score: null, won: false, detail: `${o.winner === -1 ? 'A draw' : 'The computer won'} (${lv}). ${how}`, vs });
    }
    function setLevel(v) { S.level = v; writePrefs({ level: v }); levelSeg.set(v); paint(); refocus(); }
    function setFirst(v) { S.first = v; writePrefs({ first: v }); firstSeg.set(v); newRound(); refocus(); }

    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.winner === -1) return 'A draw.';
      if (mode === '2p') return `${NAMES[o.winner]} wins!`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? 'You win!' : `${nameOf(o.winner)} wins.`;
    }
    function say(t) { sr.textContent = t; }
    function paint() {
      if (dead) return;
      const g = S.g;
      let text;
      if (S.over) text = overText();
      else if (S.shot) text = 'Shell in the air…';
      else if (mode === 'cpu') text = g.turn === me ? 'Your shot' : 'The computer is aiming…';
      else if (mode === '2p') text = `${NAMES[g.turn]} cannon to fire`;
      else text = g.turn === me ? 'Your shot' : `${peerName} is aiming…`;
      statusEl.textContent = text; statusEl.classList.remove('is-alert'); statusEl.classList.toggle('is-done', !!S.over);
      const topI = mode === '2p' ? 1 : 1 - me, botI = mode === '2p' ? 0 : me;
      const note_ = i => `${g.cannons[i].hp} health · ${g.shots[i]}/${MAX_SHOTS} shots`;
      topStrip.set({ name: mode === '2p' ? 'Right cannon' : mode === 'cpu' ? `Computer (${LEVELS[S.level].name})` : peerName, note: note_(topI), color: COLORS[topI], turn: !S.over && g.turn === topI, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Left cannon' : 'You', note: note_(botI), color: COLORS[botI], turn: !S.over && g.turn === botI });
      windEl.textContent = `Wind ${g.wind === 0 ? 'calm' : `${g.wind < 0 ? '←' : '→'} ${Math.abs(g.wind)}`}`;
      fireBtn.disabled = !canAct();
      angIn.disabled = powIn.disabled = !(myTurn()) || paused;
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      angOut.textContent = `${S.angle}°`; powOut.textContent = String(S.power);
      sf.cv.setAttribute('aria-label', `Cannon Crush hill. ${text}. Wind ${windEl.textContent.slice(5)}. Health ${g.cannons[0].hp} to ${g.cannons[1].hp}.`);
      ctx.onScore(mode === '2p' ? g.log.length : S.myShots);
      if (NET) NET.peerScore?.(g.log.filter(l => l[0] !== me).length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    const sx = x => S.geo.ox + x * S.geo.s, sy = y => S.geo.oy + y * S.geo.s;
    function draw() {
      if (dead || !S.g) return;
      const g = sf.g, G = S.g;
      sf.begin();
      const now = performance.now();
      const s = Math.min(sf.w / W, sf.h / H);
      S.geo = { s, ox: (sf.w - W * s) / 2, oy: sf.h - H * s };   /* the hill sits on the bottom edge; any spare height is sky */
      tickShot(now);
      /* sky */
      const sky = g.createLinearGradient(0, 0, 0, sf.h);
      sky.addColorStop(0, '#0a1230'); sky.addColorStop(1, '#27305e');
      g.fillStyle = sky; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.beginPath(); g.rect(S.geo.ox, 0, W * s, sf.h); g.clip();
      g.fillStyle = 'rgba(255,255,255,.5)';
      for (let k = 0; k < 28; k++) { const x = (k * 197) % W, y = (k * 71) % 150; g.fillRect(sx(x), sy(y), 1.5, 1.5); }
      /* the hill */
      g.beginPath(); g.moveTo(sx(0), sy(H));
      for (let x = 0; x < W; x += 2) g.lineTo(sx(x), sy(G.top[x]));
      g.lineTo(sx(W - 1), sy(H)); g.closePath();
      const hill = g.createLinearGradient(0, sy(170), 0, sy(H));
      hill.addColorStop(0, '#4f7a46'); hill.addColorStop(0.18, '#5d6b4a'); hill.addColorStop(1, '#2d2f40');
      g.fillStyle = hill; g.fill();
      g.strokeStyle = '#8fd172'; g.lineWidth = Math.max(2, 3 * s); g.beginPath();
      for (let x = 0; x < W; x += 2) { const px = sx(x), py = sy(G.top[x]); x ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
      /* the cannons */
      G.cannons.forEach((c, i) => {
        if (c.hp <= 0) { g.fillStyle = '#222'; g.beginPath(); g.arc(sx(c.x), sy(c.y - 4), 12 * s, 0, Math.PI * 2); g.fill(); return; }
        const d = dirOf(i);
        const aim = i === G.turn && !S.over ? S.angle : 40;
        const a = (aim * Math.PI) / 180;
        const flash = now - S.flash[i] < 400 && !reduced;
        g.save(); g.translate(sx(c.x), sy(c.y - 4));
        g.fillStyle = flash ? '#fff' : COLORS[i];
        g.beginPath(); g.arc(0, 0, 11 * s, Math.PI, 0); g.rect(-11 * s, 0, 22 * s, 6 * s); g.fill();
        g.rotate(-d * a + (d < 0 ? Math.PI : 0)); g.fillRect(0, -3.5 * s, 21 * s, 7 * s);
        g.restore();
        /* health bar */
        const bw = 44 * s, bx = sx(c.x) - bw / 2, by = sy(c.y) - 40 * s;
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(bx, by, bw, 6 * s);
        g.fillStyle = c.hp > 60 ? '#5bd37a' : c.hp > 30 ? '#ffd23f' : '#ff5a6e'; g.fillRect(bx, by, bw * (c.hp / HP), 6 * s);
      });
      /* the aim guide: a short dotted line for whoever is aiming on this screen */
      if (myTurn() && !paused) {
        const i = G.turn, [mx, my] = muzzle(G, i, S.angle), d = dirOf(i), a = (S.angle * Math.PI) / 180, len = 20 + S.power * 0.9;
        g.setLineDash([3 * s, 6 * s]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2 * s;
        g.beginPath(); g.moveTo(sx(mx), sy(my)); g.lineTo(sx(mx + d * Math.cos(a) * len), sy(my - Math.sin(a) * len)); g.stroke(); g.setLineDash([]);
      }
      /* the shell */
      const sh = S.shot;
      if (sh) {
        const f = sh.r.flight, k = Math.min(1, (now - sh.t0) / Math.max(1, flightTime(sh.r) - 40));
        const idx = Math.min(f.path.length - 1, Math.floor(k * (f.path.length - 1)));
        g.strokeStyle = 'rgba(255,220,120,.55)'; g.lineWidth = 2 * s; g.beginPath();
        for (let n = 0; n <= idx; n++) { const [x, y] = f.path[n]; n ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y)); }
        g.stroke();
        const [bx, by] = f.path[idx];
        g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(sx(bx), sy(by), 4 * s + 1, 0, Math.PI * 2); g.fill();
        loop.kick(0.1);
      }
      /* the burst */
      const bm = S.boom;
      if (bm) {
        const k = reduced ? 1 : Math.min(1, (now - bm.t0) / 450);
        if (k < 1 || reduced) {
          g.strokeStyle = `rgba(255,170,60,${reduced ? 0.7 : 1 - k})`; g.lineWidth = Math.max(2, 4 * s * (1 - k * 0.5));
          g.beginPath(); g.arc(sx(bm.x), sy(bm.y), (6 + 36 * k) * s, 0, Math.PI * 2); g.stroke();
          if (bm.dmg.some(d => d > 0)) g.fillStyle = `rgba(255,255,255,${0.5 * (1 - k)})`, g.beginPath(), g.arc(sx(bm.x), sy(bm.y), 22 * s * (0.4 + k), 0, Math.PI * 2), g.fill();
          if (!reduced) loop.kick(0.05);
        } else S.boom = null;
      }
      /* the wind */
      g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `700 ${Math.max(11, 13 * s)}px Inter,system-ui,sans-serif`; g.textAlign = 'center';
      g.fillText(G.wind === 0 ? 'calm' : `${G.wind < 0 ? '←' : '→'} wind ${Math.abs(G.wind)}`, sx(W / 2), sy(24));
      g.restore();
      if (paused) {
        g.fillStyle = 'rgba(6,8,16,.7)'; g.fillRect(0, 0, sf.w, sf.h);
        g.fillStyle = '#fff'; g.font = '800 28px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('Paused', sf.w / 2, sf.h / 2);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const aimTo = p => {
      const i = S.g.turn, c = S.g.cannons[i], d = dirOf(i);
      const wx = (p.x - S.geo.ox) / S.geo.s, wy = (p.y - S.geo.oy) / S.geo.s;
      const dx = (wx - c.x) * d, dy = (c.y - 8) - wy;
      const a = Math.atan2(Math.max(0.0001, dy), Math.max(0.0001, dx)) * 180 / Math.PI;
      const len = Math.hypot(dx, dy);
      setAim(Math.max(5, Math.min(85, a)), Math.max(10, Math.min(100, len / 3.4)));
    };
    const onDown = e => {
      if (e.button > 0 || dead || !canAct()) return;
      snd.wake(); S.aiming = true;
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      aimTo(at(e));
    };
    const onMove = e => { if (S.aiming && canAct()) aimTo(at(e)); };
    const onUp = () => { S.aiming = false; };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || paused || S.ended) return;
      const k = e.key, big = e.shiftKey ? 5 : 1;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault(); snd.wake();
        if (!myTurn()) return;
        if (k === 'ArrowUp') setAim(S.angle + big, S.power);
        else if (k === 'ArrowDown') setAim(S.angle - big, S.power);
        else if (k === 'ArrowRight') setAim(S.angle, S.power + big);
        else setAim(S.angle, S.power - big);
        return;
      }
      if (k === ' ' || k === 'Enter') {
        if (document.activeElement && document.activeElement !== document.body && el.contains(document.activeElement) && /BUTTON|INPUT/.test(document.activeElement.tagName)) {
          if (document.activeElement.tagName === 'BUTTON') return;
        }
        e.preventDefault(); if (e.repeat) return; snd.wake(); shoot();
      }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    newRound();
    setAim(S.angle, S.power);

    return {
      stop() {
        dead = true;
        clearTimeout(S.endT); clearTimeout(thinkTimer); clearTimeout(flightEnd);
        link?.stop(); loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown); sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp); sf.cv.removeEventListener('pointercancel', onUp);
        resignBtn?.reset(); snd.close(); sf.destroy(); root.remove();
      },
      pause() { if (dead || paused) return; paused = true; if (S.shot) S.shot.pausedAt = performance.now(); paint(); },
      resume() {
        if (dead || !paused) return;
        paused = false;
        if (S.shot?.pausedAt) { S.shot.t0 += performance.now() - S.shot.pausedAt; S.shot.pausedAt = 0; }
        if (S.pending) { const sh = S.pending; S.pending = null; if (!S.over) launch(sh.a, sh.p, 'cpu'); }
        paint(); loop.kick(0.2);
      },
      /* test hooks (inert unless a test calls them): 'setHp' [hp0, hp1]; 'solve' -> the angle and power that would burst on the other cannon's spot, found by the computer at its best */
      hook(cmd, arg) {
        if (cmd === 'setHp') { S.g.cannons[0].hp = arg[0]; S.g.cannons[1].hp = arg[1]; paint(); return true; }
        if (cmd === 'solve') { const sh = aiShot(S.g, 3, () => 0.5); return sh; }
        if (cmd === 'aim') { setAim(arg[0], arg[1]); return true; }
        return false;
      },
      peek: () => {
        const g = S.g;
        return {
          mode, me: mode === '2p' ? null : me, turn: g.turn, hp: g.cannons.map(c => c.hp), shots: g.shots.slice(), wind: g.wind, angle: S.angle, power: S.power, over: S.over ? { winner: S.over.winner, reason: S.over.reason } : null,
          flying: !!S.shot, thinking: S.thinking, rejected: S.rejected, myShots: S.myShots, ended: S.ended, paused, level: S.level, first: S.first, hill: hillHash(g), seed: S.seed,
          cannons: g.cannons.map(c => ({ x: c.x, y: c.y })), log: g.log.map(l => l.slice()), status: statusEl.textContent, geo: { ...S.geo }, canvas: { w: sf.w, h: sf.h },
          boom: S.boom ? { x: S.boom.x, y: S.boom.y } : null, top: Array.from(g.top.slice(0, W)).map(v => Math.round(v)),
        };
      },
    };
  },
};
