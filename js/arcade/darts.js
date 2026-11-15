/* ============================================================
   arcade/darts.js — Darts for Static Arcade: three games on one board.

   · Darts (the default export), two modes (ctx.mode):
       501      count 501 down to exactly zero, finishing on a double
                (the bull counts). Three darts a turn; a bust (below
                zero, on 1, or zero without a double) sends the score
                back to where the turn began.
       Cricket  close 15 to 20 and the bull with three marks each;
                marks past three score on a number the other side
                hasn't closed. Alone: close all seven.
     Alone, against the computer (Easy, Medium or Hard — picked on the
     board before the first dart, 0–3, and kept for next time), or two
     players on one screen (the Arcade's 2P), taking turns of three
     darts. Score = your darts thrown, fewer is better; a match the
     computer wins has no score, and the Arcade keeps your won–lost
     record at each level.
   · Around the Clock (the `clock` export): hit 1, 2 … 20 in order,
     then the bull. Score = darts thrown (fewer is better).
   The rules live in ./darts-rules.js, where they are tested alone.

   Checkout hints: in 501, whoever is up sees a finish from what they
   have left once one is in reach (darts-rules checkout()). The
   computer plays the same rules and follows that same route dart by
   dart (cpuTarget()); its darts land around the bed it aims at with a
   spread set by its level (CPU), so it misses like a person does.

   Aim: move the mouse (or ← ↑ ↓ →, Shift for fine steps) and press
   to throw (click, tap or Space). The reticle drifts a few
   millimetres around your aim point and the dart lands where the
   reticle is at the moment you throw, so time it. With reduced
   motion the reticle holds still and the dart lands on your aim.

   The world advances in fixed 1/120 s steps (./fixed.js), so the
   sway runs at the same speed on every screen.
   Follows the module contract in ./index.js.
   ============================================================ */
import { store } from '../core/store.js';
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt, rng, randomSeed } from './kit.js';
import { fixedStepper } from './fixed.js';
import { ORDER, RAD, scoreAt, newMatch, applyDart, checkout, newClock, applyClock, clockName, CLOCK_TARGETS,
  CRICKET, newCricket, applyCricket, spotOf, CPU, cpuTarget } from './darts-rules.js';

const VW = 900, VH = 600, BX = 300, BY = 300, SC = 1.35;     /* the board: centre and pixels per millimetre */
const DT = 1 / 120;
const AMP = 6;                                               /* mm of sway */
const FLIGHT = 0.14, PULL = 1.1;
const KEY_SPEED = 120, KEY_FINE = 30;                        /* mm per second */
const FLIGHTS = ['#3ad6ff', '#ff9a3a'];                      /* each player's flights */
const PREF = 'portal.arcadeDarts';
const OPPS = ['solo', 'easy', 'medium', 'hard'];
const readOpp = () => { let p = null; try { p = store.get(PREF, null); } catch (err) { p = null; } return OPPS.includes(p?.opp) ? p.opp : 'solo'; };
const writeOpp = opp => { try { store.set(PREF, { opp }); } catch (err) { /* a convenience */ } };
const gauss = rnd => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

/* kind: 'darts' (501 or Cricket, by ctx.mode) or 'clock' */
const make = kind => ({
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const mode = kind === 'clock' ? 'clock' : ctx.mode === 'cricket' ? 'cricket' : '501';
    const two = kind !== 'clock' && ctx.players === 2;
    let rnd = rng(randomSeed());
    const S = {
      mode, state: 'aim',                         /* aim | cpu | flight | stuck | pull | done */
      paused: false, over: false, time: 0, t: 0,
      opp: two ? 'p2' : kind === 'clock' ? 'solo' : readOpp(),
      who: 0, darts: [0, 0], winner: null,
      ms: null, cr: null, c: null,
      aim: { x: 0, y: -70 }, kx: 0, ky: 0, fine: false,
      turn: [], pend: null, flightT: 0, stuckT: 0, pullT: 0, endT: 0,
      msg: '', msgT: -9, last: null, calm: reduced, usedInput: false, hits: [],
      cpuT: 0, cpuAim: null, cpuFrom: { x: 0, y: -70 }, pills: [],
    };
    const players = () => (S.opp === 'solo' ? 1 : 2);
    const isCpu = who => who === 1 && CPU[S.opp] !== undefined;
    const name = who => (S.opp === 'p2' ? `Player ${who + 1}` : who === 0 ? 'You' : 'The computer');
    const short = who => (S.opp === 'p2' ? `P${who + 1}` : who === 0 ? 'You' : 'CPU');
    function resetMatch() {
      S.ms = [newMatch(501), newMatch(501)]; S.cr = newCricket(players()); S.c = newClock();
      S.darts = [0, 0]; S.who = 0; S.turn = []; S.hits = []; S.winner = null; S.state = 'aim';
    }
    resetMatch();
    const title = mode === '501' ? 'Darts board, 501' : mode === 'cricket' ? 'Darts board, Cricket' : 'Darts board, Around the Clock';
    const sf = surface(el, title, () => draw());
    let V = fitView(sf, VW, VH, 6);
    let dead = false;

    const sway = () => {
      if (S.calm) return { x: 0, y: 0 };
      return { x: AMP * Math.sin(S.time * 1.25 + 0.7), y: AMP * Math.cos(S.time * 1.55) };
    };
    const thrown = () => S.darts[0];
    const started = () => S.darts[0] + S.darts[1] > 0;
    function report() {
      if (S.opp === 'p2') ctx.onScore(mode === '501' ? `${S.ms[0].remaining} – ${S.ms[1].remaining}` : `${S.cr.points[0]} – ${S.cr.points[1]}`);
      else ctx.onScore(thrown());
    }

    /* ------------------------------ rules glue ------------------------------ */
    function say(t) { S.msg = t; S.msgT = S.time; }
    function release(x, y) {
      if ((S.state !== 'aim' && S.state !== 'cpu') || S.paused || S.over) return false;
      const lx = clamp(x, -240, 240), ly = clamp(y, -240, 240);
      S.pend = { x: lx, y: ly, d: scoreAt(lx, ly) };
      S.state = 'flight'; S.flightT = 0;
      snd.blip(200, 0.06, 'square', 0.5, 120);
      if (reduced) land();
      return true;
    }
    const marksWord = m => `${m} mark${m === 1 ? '' : 's'}`;
    const numName = n => (n === 25 ? 'the bull' : `the ${n}`);
    function land() {
      const p = S.pend;
      if (!p) return;
      S.pend = null;
      const d = p.d, who = S.who;
      S.turn.push({ x: p.x, y: p.y, d, who });
      S.hits.push({ x: p.x, y: p.y, label: d.label });
      S.last = d.label;
      S.darts[who]++;
      S.state = 'stuck'; S.stuckT = 0;
      snd.blip(d.ring === 'miss' ? 110 : 150 + d.points * 4, 0.07, 'triangle', 0.7);
      const pre = players() === 2 ? `${name(who)}: ` : '';
      if (mode === '501') {
        const r = applyDart(S.ms[who], d);
        S.ms[who] = r.m;
        S.turnOverNow = r.turnOver;
        if (r.event === 'bust') { say(`${pre}Bust! Back to ${S.ms[who].remaining}`); snd.blip(140, 0.3, 'sawtooth', 0.6, 70); }
        else if (r.event === 'win') { say(`${pre}${d.label}: finished!`); S.winner = who; win(); }
        else say(`${pre}${d.points ? `${d.label}  ·  ${d.points}` : 'Miss'}`);
      } else if (mode === 'cricket') {
        const r = applyCricket(S.cr, who, d);
        S.cr = r.c;
        S.turnOverNow = S.turn.length >= 3 || r.win;
        if (r.marks) say(`${pre}${d.label}: ${marksWord(r.marks)}${r.closed ? `, ${numName(r.n)} closed` : ''}${r.scored ? ` · +${r.scored}` : ''}`);
        else say(`${pre}${d.points ? `${d.label}: no use in Cricket` : 'Miss'}`);
        if (r.closed) snd.blip(620, 0.1, 'sine', 0.8, 820);
        if (r.win) { S.winner = who; win(); }
      } else {
        const r = applyClock(S.c, d);
        S.c = r.c;
        S.turnOverNow = S.turn.length >= 3;
        if (r.hit) { say(`${d.label}: ${r.c.over ? 'the bull, round complete!' : `on to ${clockName(r.c.target)}`}`); snd.blip(520, 0.1, 'sine', 0.8, 760); if (r.c.over) { S.winner = 0; win(); } }
        else say(d.points ? `${d.label}: not the ${clockName(S.c.target)}` : 'Miss');
      }
      report();
    }
    function win() {
      S.state = 'done'; S.endT = 0;
      snd.blip(660, 0.18, 'triangle', 1, 990); snd.blip(990, 0.3, 'sine', 0.8, 1320);
    }
    function finish() {
      if (S.over || dead) return;
      S.over = true;
      const n = thrown();
      const pts = mode === 'cricket' && players() === 2 ? ` Points ${S.cr.points[0]}–${S.cr.points[1]}.` : '';
      if (players() === 1) {
        ctx.onEnd(mode === '501' ? { score: n, won: true, detail: `Down from 501 to zero in ${n} darts, finishing on a double.` }
          : mode === 'cricket' ? { score: n, won: true, detail: `Every Cricket number closed, 15 to 20 and the bull, in ${n} darts.` }
            : { score: n, won: true, detail: `Every number from 1 to 20 and then the bull, in ${n} darts.` });
        return;
      }
      const game = mode === '501' ? 'the leg of 501' : 'at Cricket';
      if (S.opp === 'p2') {
        ctx.onEnd({ score: null, won: true, winner: S.winner + 1, detail: `Player ${S.winner + 1} wins ${game} in ${S.darts[S.winner]} darts.${pts}` });
        return;
      }
      const L = CPU[S.opp], won = S.winner === 0;
      ctx.onEnd({
        score: won ? n : null, won,
        vs: { key: `${mode}-${S.opp}`, label: `${mode === '501' ? '501' : 'Cricket'}, ${L.name}`, result: won ? 'win' : 'loss' },
        detail: won ? `You beat the computer (${L.name}) ${game} in ${n} darts.${pts}` : `The computer (${L.name}) won ${game} in ${S.darts[1]} darts.${pts}`,
      });
    }
    /* the next turn: the other player's in a match; the computer's throws on their own */
    function nextTurn() {
      S.turn = []; S.turnOverNow = false;
      if (mode === '501') S.ms[S.who] = { ...S.ms[S.who], dartsInTurn: 0 };
      if (players() === 2) {
        S.who = 1 - S.who;
        if (S.opp === 'p2') say(`${name(S.who)} to throw`);
      }
      toThrow();
    }
    function toThrow() {
      if (isCpu(S.who)) { S.state = 'cpu'; S.cpuT = 0; S.cpuAim = null; }
      else S.state = 'aim';
    }
    function setOpp(id) {
      if (two || kind === 'clock' || !OPPS.includes(id) || started() || S.over) return false;
      S.opp = id;
      writeOpp(id);
      resetMatch();
      say(id === 'solo' ? 'Playing alone' : `Against the computer: ${CPU[id].name}`);
      report();
      return true;
    }

    /* ------------------------------ the world, one fixed step ------------------------------ */
    function step(dt) {
      S.time += dt;
      if (S.state === 'aim') {
        const sp = (S.fine ? KEY_FINE : KEY_SPEED) * dt;
        if (S.kx || S.ky) { S.aim.x = clamp(S.aim.x + S.kx * sp, -230, 230); S.aim.y = clamp(S.aim.y + S.ky * sp, -230, 230); S.usedInput = true; }
      } else if (S.state === 'cpu') {
        S.cpuT += dt;
        if (!S.cpuAim) {
          const label = cpuTarget(mode, mode === '501' ? S.ms[1] : S.cr, 1, 3 - S.turn.length);
          S.cpuAim = { label, ...spotOf(label) };
          say(`The computer goes for ${label}`);
        }
        if (S.cpuT >= (reduced ? 0.35 : 0.9)) {
          const sd = CPU[S.opp].spread, a = S.cpuAim;
          S.cpuFrom = { x: a.x, y: a.y };
          release(a.x + gauss(rnd) * sd, a.y + gauss(rnd) * sd);
        }
      } else if (S.state === 'flight') {
        S.flightT += dt;
        if (S.flightT >= FLIGHT) land();
      } else if (S.state === 'stuck') {
        S.stuckT += dt;
        if (S.stuckT >= (reduced ? 0.15 : 0.35)) {
          if (S.turnOverNow) { S.state = 'pull'; S.pullT = 0; }
          else toThrow();
        }
      } else if (S.state === 'pull') {
        S.pullT += dt;
        if (S.pullT >= (reduced ? 0.45 : PULL)) nextTurn();
      } else if (S.state === 'done') {
        S.endT += dt;
        if (S.endT >= (reduced ? 0.4 : 1.4)) finish();
      }
    }
    const stepper = fixedStepper(DT, step);
    const loop = looper(dt => {
      if (S.paused) return;
      stepper.advance(dt);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    function wedge(g, a0, a1, r0, r1) {
      g.beginPath();
      g.arc(BX, BY, r1 * SC, a0, a1);
      g.arc(BX, BY, r0 * SC, a1, a0, true);
      g.closePath();
    }
    function drawBoard(g) {
      g.fillStyle = '#0b0d12'; g.beginPath(); g.arc(BX, BY, (RAD.doubleOut + 32) * SC, 0, 7); g.fill();
      g.fillStyle = '#16181f'; g.beginPath(); g.arc(BX, BY, (RAD.doubleOut + 28) * SC, 0, 7); g.fill();
      const lit = new Set();
      if (mode === 'clock' && !S.c.over) lit.add(S.c.target);
      /* Cricket: the numbers still in play are lit; the ones the player up has closed are dimmed */
      const cricketOn = mode === 'cricket';
      for (let i = 0; i < 20; i++) {
        const n = ORDER[i];
        const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180, a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
        const even = i % 2 === 0;
        const dark = even ? '#15171c' : '#eadfc4', ring = even ? '#c8312f' : '#1f8a4a';
        const glow = lit.has(n);
        g.fillStyle = dark; wedge(g, a0, a1, RAD.outer, RAD.doubleIn); g.fill();
        g.fillStyle = ring; wedge(g, a0, a1, RAD.trebleIn, RAD.trebleOut); g.fill(); wedge(g, a0, a1, RAD.doubleIn, RAD.doubleOut); g.fill();
        if (glow) { g.fillStyle = 'rgba(255,230,120,.38)'; wedge(g, a0, a1, RAD.outer, RAD.doubleOut); g.fill(); }
        if (cricketOn && !CRICKET.includes(n)) { g.fillStyle = 'rgba(8,10,14,.55)'; wedge(g, a0, a1, RAD.outer, RAD.doubleOut); g.fill(); }
        /* the number */
        const am = (a0 + a1) / 2;
        const inPlay = cricketOn && CRICKET.includes(n);
        g.fillStyle = glow ? '#ffe28a' : inPlay ? (S.cr.marks[S.who]?.[n] >= 3 ? 'rgba(244,241,232,.45)' : '#ffe28a') : cricketOn ? 'rgba(244,241,232,.35)' : '#f4f1e8';
        g.font = `700 ${Math.round(15 * SC / 1.2)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(n), BX + Math.cos(am) * (RAD.doubleOut + 15) * SC, BY + Math.sin(am) * (RAD.doubleOut + 15) * SC);
      }
      /* the wires */
      g.strokeStyle = 'rgba(210,214,224,.55)'; g.lineWidth = 1;
      for (const r of [RAD.trebleIn, RAD.trebleOut, RAD.doubleIn, RAD.doubleOut, RAD.outer, RAD.bull]) { g.beginPath(); g.arc(BX, BY, r * SC, 0, 7); g.stroke(); }
      for (let i = 0; i < 20; i++) {
        const a = ((i * 18 - 9 - 90) * Math.PI) / 180;
        g.beginPath(); g.moveTo(BX + Math.cos(a) * RAD.outer * SC, BY + Math.sin(a) * RAD.outer * SC); g.lineTo(BX + Math.cos(a) * RAD.doubleOut * SC, BY + Math.sin(a) * RAD.doubleOut * SC); g.stroke();
      }
      g.fillStyle = '#1f8a4a'; g.beginPath(); g.arc(BX, BY, RAD.outer * SC, 0, 7); g.fill();
      g.fillStyle = '#c8312f'; g.beginPath(); g.arc(BX, BY, RAD.bull * SC, 0, 7); g.fill();
      g.strokeStyle = 'rgba(210,214,224,.55)'; g.beginPath(); g.arc(BX, BY, RAD.outer * SC, 0, 7); g.stroke(); g.beginPath(); g.arc(BX, BY, RAD.bull * SC, 0, 7); g.stroke();
      if (mode === 'clock' && !S.c.over && S.c.target > 20) { g.strokeStyle = 'rgba(255,230,120,.9)'; g.lineWidth = 3; g.beginPath(); g.arc(BX, BY, RAD.outer * SC + 2, 0, 7); g.stroke(); }
    }
    function dartSprite(g, x, y, k = 1, ghost = false, color = FLIGHTS[0]) {
      /* seen from the front: the flight and the barrel's tip */
      g.save(); g.translate(x, y); g.scale(k, k);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(2, 2, 3.4, 0, 7); g.fill();
      g.fillStyle = ghost ? 'rgba(255,255,255,.5)' : '#e9eef7'; g.beginPath(); g.arc(0, 0, 2.4, 0, 7); g.fill();
      g.strokeStyle = color; g.lineWidth = 2.2; g.lineCap = 'round';
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; g.beginPath(); g.moveTo(Math.cos(a) * 2, Math.sin(a) * 2); g.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); g.stroke(); }
      g.restore();
    }
    /* a Cricket mark: / for one, X for two, a circled X for a closed number */
    function mark(g, cx, cy, m, col) {
      if (!m) return;
      g.save(); g.strokeStyle = col; g.lineWidth = 2.2; g.lineCap = 'round';
      const r = 7;
      g.beginPath(); g.moveTo(cx - r, cy + r); g.lineTo(cx + r, cy - r);
      if (m >= 2) { g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r); }
      g.stroke();
      if (m >= 3) { g.beginPath(); g.arc(cx, cy, r + 3, 0, 7); g.stroke(); }
      g.restore();
    }
    function scoreBox(g, x, y, w, h, who) {
      const up = S.who === who && !S.over && S.state !== 'done';
      g.fillStyle = up ? 'rgba(255,226,138,.12)' : 'rgba(255,255,255,.04)'; rr(g, x, y, w, h, 10); g.fill();
      g.strokeStyle = up ? 'rgba(255,226,138,.75)' : 'rgba(255,255,255,.12)'; g.lineWidth = up ? 2 : 1; rr(g, x, y, w, h, 10); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = FLIGHTS[who]; g.font = `700 12px ${FONT}`; g.fillText(name(who).toUpperCase(), x + w / 2, y + 16, w - 10);
      g.fillStyle = '#f6f3ea'; g.font = `800 40px ${FONT}`; g.fillText(String(S.ms[who].remaining), x + w / 2, y + 56);
      g.fillStyle = hsl(40, 15, 65); g.font = `500 12px ${FONT}`; g.fillText(`${S.darts[who]} dart${S.darts[who] === 1 ? '' : 's'}`, x + w / 2, y + 92);
    }
    function panel(g) {
      const x = 600, w = 280, two2 = players() === 2;
      g.fillStyle = 'rgba(255,255,255,.04)'; rr(g, x, 40, w, 520, 14); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; rr(g, x, 40, w, 520, 14); g.stroke();
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = hsl(40, 30, 72); g.font = `650 12px ${FONT}`;
      g.fillText(mode === '501' ? 'DARTS 501' : mode === 'cricket' ? 'CRICKET' : 'AROUND THE CLOCK', x + 20, 72);
      if (kind !== 'clock') {
        g.textAlign = 'right'; g.fillStyle = hsl(40, 15, 60); g.font = `500 11.5px ${FONT}`;
        g.fillText(S.opp === 'p2' ? 'Two players' : S.opp === 'solo' ? 'Alone' : `vs computer · ${CPU[S.opp].name}`, x + w - 20, 72);
        g.textAlign = 'left';
      }
      if (mode === '501' && !two2) {
        g.fillStyle = '#f6f3ea'; g.font = `800 76px ${FONT}`; g.textAlign = 'center';
        g.fillText(String(S.ms[0].remaining), x + w / 2, 150);
        g.font = `500 13px ${FONT}`; g.fillStyle = hsl(40, 25, 70); g.fillText('REMAINING', x + w / 2, 196);
      } else if (mode === '501') {
        scoreBox(g, x + 16, 92, 120, 110, 0); scoreBox(g, x + 144, 92, 120, 110, 1);
      }
      if (mode === '501') {
        const m = S.ms[S.who];
        const co = m.remaining <= 170 ? checkout(m.remaining, 3 - m.dartsInTurn) : null;
        g.font = `600 14px ${FONT}`; g.fillStyle = co ? '#9be8a8' : hsl(40, 15, 60); g.textAlign = 'center';
        const who = two2 ? `${short(S.who)}: ` : '';
        g.fillText(co ? `${who}Finish: ${co.join('  ')}` : m.remaining <= 170 ? `${who}No finish in reach` : `${who}Build towards a double`, x + w / 2, 232, w - 24);
      } else if (mode === 'cricket') {
        /* the marks: one column alone, the number in the middle of two in a match */
        const y0 = 112, rh = 22, cx = x + w / 2;
        g.textAlign = 'center';
        if (two2) {
          for (const who of [0, 1]) { g.fillStyle = FLIGHTS[who]; g.font = `700 12px ${FONT}`; g.fillText(short(who).toUpperCase(), who ? cx + 78 : cx - 78, y0 - 16); }
        }
        CRICKET.forEach((n, i) => {
          const y = y0 + i * rh;
          const shut = S.cr.marks.every(m => m[n] >= 3);
          g.fillStyle = shut ? 'rgba(255,255,255,.3)' : '#f6f3ea'; g.font = `800 15px ${FONT}`;
          g.fillText(n === 25 ? 'Bull' : String(n), two2 ? cx : cx - 40, y);
          if (two2) { mark(g, cx - 78, y, S.cr.marks[0][n], FLIGHTS[0]); mark(g, cx + 78, y, S.cr.marks[1][n], FLIGHTS[1]); }
          else mark(g, cx + 30, y, S.cr.marks[0][n], FLIGHTS[0]);
        });
        const py = y0 + CRICKET.length * rh + 8;
        g.font = `700 14px ${FONT}`;
        if (two2) {
          g.fillStyle = hsl(40, 25, 70); g.fillText('POINTS', cx, py);
          g.fillStyle = '#f6f3ea'; g.font = `800 20px ${FONT}`; g.fillText(String(S.cr.points[0]), cx - 78, py); g.fillText(String(S.cr.points[1]), cx + 78, py);
        } else {
          const done = CRICKET.filter(n => S.cr.marks[0][n] >= 3).length;
          g.fillStyle = hsl(40, 25, 70); g.fillText(`Closed ${done} of 7`, cx, py);
        }
      } else {
        g.fillStyle = '#f6f3ea'; g.font = `800 76px ${FONT}`; g.textAlign = 'center';
        g.fillText(S.c.over ? '✓' : clockName(S.c.target), x + w / 2, 150);
        g.font = `500 13px ${FONT}`; g.fillStyle = hsl(40, 25, 70); g.fillText(S.c.over ? 'ALL DONE' : 'NEXT TARGET', x + w / 2, 196);
        /* the 21 targets */
        const cw = 36, ch = 26, x0 = x + (w - cw * 7) / 2, y0 = 218;
        g.font = `700 12px ${FONT}`;
        for (let t = 1; t <= CLOCK_TARGETS; t++) {
          const i = t - 1, cx = x0 + (i % 7) * cw, cy = y0 + Math.floor(i / 7) * ch;
          const done = t < S.c.target || S.c.over, cur = t === S.c.target && !S.c.over;
          g.fillStyle = done ? 'rgba(80,200,120,.32)' : cur ? 'rgba(255,226,138,.3)' : 'rgba(255,255,255,.05)';
          rr(g, cx + 2, cy + 2, cw - 4, ch - 4, 6); g.fill();
          g.fillStyle = done ? '#b7f2c4' : cur ? '#ffe28a' : 'rgba(255,255,255,.55)';
          g.fillText(t === 21 ? 'Bull' : String(t), cx + cw / 2, cy + ch / 2 + 1);
        }
      }
      g.textAlign = 'left';
      /* this turn's darts */
      const ty = 330;
      g.fillStyle = hsl(40, 25, 70); g.font = `600 12px ${FONT}`; g.fillText(two2 ? `THIS TURN · ${name(S.who).toUpperCase()}` : 'THIS TURN', x + 20, ty, w - 40);
      for (let i = 0; i < 3; i++) {
        const dx = x + 20 + i * 82, d = S.turn[i];
        g.fillStyle = d ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)'; rr(g, dx, ty + 14, 74, 40, 9); g.fill();
        g.textAlign = 'center'; g.fillStyle = d ? '#fff' : 'rgba(255,255,255,.3)'; g.font = `700 16px ${FONT}`;
        g.fillText(d ? d.d.label : '·', dx + 37, ty + 35);
      }
      g.textAlign = 'left';
      g.fillStyle = hsl(40, 25, 70); g.font = `600 12px ${FONT}`; g.fillText(two2 ? `${short(S.who).toUpperCase()} · DARTS THROWN` : 'DARTS THROWN', x + 20, 420);
      g.fillStyle = '#f6f3ea'; g.font = `800 34px ${FONT}`; g.fillText(String(S.darts[S.who]), x + 20, 452);
      /* who to play: picked before the first dart (alone, or the computer at a level) */
      S.pills = [];
      if (kind !== 'clock' && !two && !started() && !S.over) {
        const pw = 56, gap = 6, px0 = x + w - 20 - (pw * 4 + gap * 3), py = 470;
        OPPS.forEach((id, i) => {
          const px = px0 + i * (pw + gap), on = S.opp === id;
          g.fillStyle = on ? 'rgba(255,226,138,.25)' : 'rgba(255,255,255,.06)'; rr(g, px, py, pw, 24, 8); g.fill();
          g.strokeStyle = on ? 'rgba(255,226,138,.8)' : 'rgba(255,255,255,.14)'; rr(g, px, py, pw, 24, 8); g.stroke();
          g.fillStyle = on ? '#ffe28a' : 'rgba(255,255,255,.75)'; g.font = `700 11px ${FONT}`; g.textAlign = 'center';
          g.fillText(`${i} ${id === 'solo' ? 'Alone' : CPU[id].name}`, px + pw / 2, py + 12.5, pw - 4);
          S.pills.push({ id, x: px, y: py, w: pw, h: 24 });
        });
        g.textAlign = 'left';
      }
      if (S.msg && S.time - S.msgT < 3) {
        g.fillStyle = /Bust/.test(S.msg) ? '#ff9a8a' : '#ffe28a'; g.font = `700 16px ${FONT}`;
        g.fillText(S.msg, x + 20, 512, w - 40);
      }
      g.fillStyle = 'rgba(255,255,255,.42)'; g.font = `500 11.5px ${FONT}`;
      g.fillText(S.calm ? 'Steady aim: the dart lands on your aim' : `The reticle drifts about ±${AMP} mm: time your throw`, x + 20, 542, w - 40);
    }
    function reticle(g, ax, ay, col) {
      g.strokeStyle = col; g.lineWidth = 1.6;
      g.beginPath(); g.arc(ax, ay, 9, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(ax - 15, ay); g.lineTo(ax - 4, ay); g.moveTo(ax + 4, ay); g.lineTo(ax + 15, ay); g.moveTo(ax, ay - 15); g.lineTo(ax, ay - 4); g.moveTo(ax, ay + 4); g.lineTo(ax, ay + 15); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(ax, ay, 1.6, 0, 7); g.fill();
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#0a0b10'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      drawBoard(g);
      /* the darts in the board */
      S.turn.forEach(t => dartSprite(g, BX + t.x * SC, BY + t.y * SC, 1, S.state === 'pull', FLIGHTS[t.who]));
      if (S.state === 'flight' && S.pend) {
        const k = reduced ? 1 : 1 + 1.8 * (1 - S.flightT / FLIGHT);
        dartSprite(g, BX + S.pend.x * SC, BY + S.pend.y * SC, k, false, FLIGHTS[S.who]);
      }
      if (S.state === 'aim' && !S.paused) {
        const sw = sway();
        reticle(g, BX + (S.aim.x + sw.x) * SC, BY + (S.aim.y + sw.y) * SC, 'rgba(255,255,255,.9)');
      } else if (S.state === 'cpu' && S.cpuAim && !S.paused) {
        /* the computer's reticle glides from its last throw to the bed it goes for */
        const k = reduced ? 1 : clamp(S.cpuT / 0.6, 0, 1), e = k * k * (3 - 2 * k);
        const ax = S.cpuFrom.x + (S.cpuAim.x - S.cpuFrom.x) * e, ay = S.cpuFrom.y + (S.cpuAim.y - S.cpuFrom.y) * e;
        reticle(g, BX + ax * SC, BY + ay * SC, 'rgba(255,170,90,.95)');
      }
      panel(g);
      if (S.state === 'pull') { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 14px ${FONT}`; g.textAlign = 'center'; g.fillText('Collecting darts…', BX, 580); }
      g.restore();
      if (!S.usedInput && !started() && S.state === 'aim' && !S.paused) {
        const what = mode === '501' ? 'Count 501 down to zero, finishing on a double' : mode === 'cricket' ? 'Close 15 to 20 and the bull: three marks each' : 'Hit 1 to 20 in order, then the bull';
        prompt(g, sf, coarse() ? 'Tap the board to throw' : 'Aim with the mouse, click to throw', what, 40, sf.h * 0.9);
      }
      if (S.paused) prompt(g, sf, 'Paused', null, 40);
    }

    /* ------------------------------ input ------------------------------ */
    const toMm = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left - V.ox) / V.s - BX) / SC, y: ((e.clientY - r.top - V.oy) / V.s - BY) / SC };
    };
    const toView = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - V.ox) / V.s, y: (e.clientY - r.top - V.oy) / V.s };
    };
    const throwNow = () => { const sw = sway(); return release(S.aim.x + sw.x, S.aim.y + sw.y); };
    const onMove = e => {
      if (S.state !== 'aim' || S.paused) return;
      const p = toMm(e); S.aim.x = clamp(p.x, -230, 230); S.aim.y = clamp(p.y, -230, 230); S.usedInput = true;
      if (!loop.on) draw();
    };
    const onDown = e => {
      if (e.button > 0 || S.paused) return;
      snd.wake();
      const v = toView(e);
      const pill = S.pills.find(q => v.x >= q.x && v.x <= q.x + q.w && v.y >= q.y && v.y <= q.y + q.h);
      if (pill) { setOpp(pill.id); return; }
      if (S.state === 'pull' && !isCpu(1 - S.who)) { nextTurn(); return; }
      if (S.state !== 'aim') return;
      /* a touch has no hover: the press itself sets the aim */
      if (e.pointerType === 'touch' || e.pointerType === 'pen') { const p = toMm(e); S.aim.x = clamp(p.x, -230, 230); S.aim.y = clamp(p.y, -230, 230); }
      S.usedInput = true;
      throwNow();
    };
    const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      const k = KEYS[e.key];
      if (k) {
        e.preventDefault(); snd.wake();
        if (S.paused) return;
        if (k[0]) S.kx = k[0]; else S.ky = k[1];
        S.fine = e.shiftKey;
        return;
      }
      if (/^[0-3]$/.test(e.key) && !S.paused && !e.repeat && S.pills.length) { e.preventDefault(); setOpp(OPPS[Number(e.key)]); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        if (S.over || S.state === 'done') return;           /* Enter plays again: the Arcade's */
        e.preventDefault(); snd.wake();
        if (S.paused || e.repeat) return;
        S.usedInput = true;
        if (S.state === 'pull') { if (!isCpu(1 - S.who)) nextTurn(); } else if (S.state === 'aim') throwNow();
      }
    };
    const onKeyUp = e => {
      const k = KEYS[e.key];
      if (!k) return;
      if (k[0] && S.kx === k[0]) S.kx = 0;
      if (k[1] && S.ky === k[1]) S.ky = 0;
    };
    const onBlur = () => { S.kx = S.ky = 0; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerdown', onDown);

    report();
    draw();
    loop.start();

    return {
      stop() {
        dead = true;
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerdown', onDown);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.kx = S.ky = 0; loop.stop(); draw(); },
      resume() { S.paused = false; stepper.reset(); if (!S.over) loop.start(); },
      peek: () => {
        const m = S.ms[S.who];
        return {
          mode, state: S.state, paused: S.paused, over: S.over, time: S.time,
          remaining: m.remaining, turnStart: m.turnStart, dartsInTurn: m.dartsInTurn, target: S.c.target, clockDone: S.c.over, matchOver: m.over,
          thrown: thrown(), turn: S.turn.map(t => ({ label: t.d.label, points: t.d.points, x: t.x, y: t.y, who: t.who })), last: S.last, msg: S.msg,
          aim: { ...S.aim }, sway: sway(), amp: S.calm ? 0 : AMP, checkout: mode === '501' ? checkout(m.remaining, 3 - m.dartsInTurn) : null,
          view: { ox: V.ox, oy: V.oy, s: V.s, bx: BX, by: BY, sc: SC },
          opp: S.opp, players: players(), who: S.who, darts: S.darts.slice(), winner: S.winner,
          scores: S.ms.map(q => q.remaining), cricket: { marks: S.cr.marks.map(q => ({ ...q })), points: S.cr.points.slice() },
          cpuAim: S.cpuAim ? { ...S.cpuAim } : null, pills: S.pills.map(q => ({ ...q })),
        };
      },
      /* test hook — nothing in the game calls it:
         throwAt({ x, y } mm) · step(seconds) · set({ remaining, who? }) · target(n 1..21) · calm(bool) · skip()
         · opp(id) · seed(n) (the computer's throws) · marks({ who, n, m }) */
      hook(cmd, arg) {
        if (cmd === 'throwAt') return release(arg.x, arg.y);
        if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += DT) step(DT); }
        else if (cmd === 'set') { const w = arg.who ?? S.who; S.ms[w] = { ...S.ms[w], remaining: arg.remaining, turnStart: arg.remaining, dartsInTurn: 0 }; if (w === S.who) S.turn = []; report(); }
        else if (cmd === 'target') S.c = { ...S.c, target: arg };
        else if (cmd === 'calm') S.calm = !!arg;
        else if (cmd === 'skip') { if (S.state === 'pull') nextTurn(); }
        else if (cmd === 'opp') return setOpp(arg);
        else if (cmd === 'seed') rnd = rng(arg);
        else if (cmd === 'marks') { S.cr = { ...S.cr, marks: S.cr.marks.map((q, i) => (i === arg.who ? { ...q, [arg.n]: arg.m } : q)) }; }
        else return false;
        draw();
        return true;
      },
    };
  },
});

export default make('darts');
export const clock = make('clock');
