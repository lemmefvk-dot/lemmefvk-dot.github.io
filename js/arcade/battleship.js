/* ============================================================
   arcade/battleship.js — Battleship for Static Arcade.

   Two 10 × 10 seas, five ships each (5, 4, 3, 3, 2 long). Take turns
   calling a square; the answer is a miss, a hit, or "sunk". Sink all
   five of theirs first.

   · Place your fleet by dragging each ship onto the grid (or tap /
     press R to turn it), or press Auto-place. Ships may touch but not
     overlap or leave the sea. Keyboard: 1–5 pick a ship, arrows move
     it, R turns it, Enter starts.
   · 1P: the computer at three levels — Easy shoots at random, Medium
     hunts on a checkerboard and finishes what a hit started, Hard
     counts every place a ship could still lie. Score is the number of
     shots you needed (fewer is better), counted on a win.
   · Online: a friend through the Arcade's room, with nothing left to
     trust. Before the first shot each side sends a SHA-256 of its
     fleet and a secret salt, so the fleet can't change afterwards. At
     the end both reveal fleet and salt, and each side replays every
     one of its shots against the other's fleet. A lie, a changed
     fleet or a refusal to reveal ends the game as "No result" with
     "Results couldn't be verified". (Rules and checks: ./battleship-logic.js.)

   Shooting: click or tap a square on the enemy sea, or ← ↑ → ↓ and
   Enter / Space.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton } from './boardkit.js';
import { rng, randomSeed } from './kit.js';
import {
  SIZE, FLEET, canPlace, validFleet, cleanFleet, randomFleet, Waters, cellsOf, inGrid, randomSalt, commitOf, isHash, isSalt, verify,
  newKnow, learn, plausibleSunk, chooseShot, shipOk, LEVELS,
} from './battleship-logic.js';

const PREF = 'portal.arcadeBattleship';
const readLevel = () => { let p = null; try { p = store.get(PREF, null); } catch (err) { p = null; } return [1, 2, 3].includes(p?.level) ? p.level : 2; };
const REVEAL_WAIT = 12000;
const BEAT = 1200;

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    const oppName = mode === 'online' ? peerName : 'The computer';
    let rand = rng(NET ? (NET.seed >>> 0) ^ (host ? 0x5bd1e995 : 0x1b873593) : randomSeed());
    let dead = false;
    let aiDelay = reduced ? 160 : 650;
    const firstIsMe = NET ? (round % 2 === 1) === host : true;

    const S = {
      phase: 'place',                  /* place | wait | play | reveal | over */
      ships: FLEET.map(() => null), sel: 0,
      level: readLevel(),
      mine: null, theirs: null,        /* Waters: my fleet under their fire; their fleet (1P only) under mine */
      know: newKnow(), aiKnow: newKnow(),
      myShots: [], theirShots: [],
      turn: 'me', plies: 0, pending: null, answers: new Map(),
      cursor: { r: 4, c: 4 }, hover: null, drag: null, shake: 0, ripples: [],
      paused: false, aiT: 0, ended: false, over: null, rejected: 0, suspect: false,
      geo: { mine: null, enemy: null, dock: [] },
      salt: '', commit: '', peerCommit: '', peerSaw: false, ackSent: false, peerReveal: null, lie: false, badReveal: false, revealT: 0, verdict: null, overAt: 0,
    };

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#ff6b6b', oppName, '');
    const botStrip = playerStrip('#4cc9f0', 'You', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name, title: LEVELS[id].note })), S.level, id => { if (S.phase === 'place') { S.level = id; try { store.set(PREF, { level: id }); } catch (err) { /* a convenience */ } levelSeg.set(id); paint(); } refocus(); }) : null;
    const autoBtn = button('Auto-place', 'shuffle', () => { autoPlace(); refocus(); }, { title: 'Place the whole fleet at random' });
    const rotBtn = button('Turn ship', 'rotate-ccw', () => { rotateSel(); refocus(); }, { title: 'Turn the selected ship (R)' });
    const clearBtn = button('Clear', 'trash', () => { clearShips(); refocus(); });
    const goBtn = button(mode === 'online' ? 'Ready' : 'Start battle', 'play', () => { start(); refocus(); });
    const resignBtn = confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); });
    const placeRow = h('div.arx-bg__row', autoBtn, rotBtn, clearBtn);
    const fleetNote = h('div.arx-bg__note');
    const note = h('div.arx-bg__note', { text: 'Drag each ship onto the grid. Tap a placed ship (or press R) to turn it.' });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, placeRow, h('div.arx-bg__row', goBtn, resignBtn), fleetNote, note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Battleship seas', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const say = t => { sr.textContent = t; };

    /* ------------------------------ placing ------------------------------ */
    const placedAll = () => S.ships.every(Boolean);
    function bump() { S.shake = performance.now(); snd.blip(140, 0.08, 'sawtooth', 0.4); loop.kick(0.3); }
    function autoPlace() {
      if (S.phase !== 'place' || S.drag) return;
      S.ships = randomFleet(rand);
      snd.blip(420, 0.05, 'triangle', 0.6);
      paint();
    }
    function clearShips() { if (S.phase !== 'place') return; S.ships = FLEET.map(() => null); paint(); }
    function setShip(i, s) { S.ships[i] = s; S.sel = i; paint(); }
    function rotateShip(i) {
      const s = S.ships[i];
      if (!s) return false;
      const d = 1 - s.d, len = s.len;
      const cand = { len, d, r: d ? Math.min(s.r, SIZE - len) : s.r, c: d ? s.c : Math.min(s.c, SIZE - len) };
      if (!canPlace(S.ships, cand, i)) { bump(); return false; }
      setShip(i, cand);
      snd.blip(360, 0.04, 'triangle', 0.5);
      return true;
    }
    function rotateSel() {
      if (S.phase !== 'place') return;
      if (S.drag) { toggleDrag(); return; }
      if (S.ships[S.sel]) rotateShip(S.sel); else bump();
    }
    function nudge(dr, dc) {
      const i = S.sel, s = S.ships[i];
      if (!s) {
        const f = randomFleet(rand, S.ships.map((x, k) => (k === i ? null : x)));
        setShip(i, f[i]);
        return;
      }
      const cand = { ...s, r: s.r + dr, c: s.c + dc };
      if (canPlace(S.ships, cand, i)) setShip(i, cand); else bump();
    }

    /* ------------------------------ starting ------------------------------ */
    async function start() {
      if (S.phase !== 'place' || !placedAll() || dead) return;
      const mine = cleanFleet(S.ships);
      if (!validFleet(mine)) { bump(); return; }
      S.mine = new Waters(mine);
      S.drag = null;
      if (mode === 'cpu') {
        S.theirs = new Waters(randomFleet(rand));
        S.phase = 'play'; S.turn = 'me';
        say('Battle begins. Your shot.');
        paint();
        return;
      }
      S.phase = 'wait';
      S.salt = randomSalt();
      paint();
      const c = await commitOf(mine, S.salt);
      if (dead) return;
      S.commit = c;
      sendCommit();
      maybeBegin();
      paint();
    }
    function maybeBegin() {
      if (S.phase !== 'wait' || !S.commit || !S.peerCommit) return;
      S.phase = 'play';
      S.turn = firstIsMe ? 'me' : 'them';
      say(S.turn === 'me' ? 'Both fleets are locked in. Your shot.' : 'Both fleets are locked in. Waiting for their shot.');
      paint();
    }

    /* ------------------------------ shooting ------------------------------ */
    const canShoot = () => !dead && !S.paused && S.phase === 'play' && S.turn === 'me' && !S.pending;
    function fire(r, c) {
      if (!canShoot() || !inGrid(r, c) || S.know.marks[r * SIZE + c]) return false;
      if (mode === 'cpu') {
        const res = S.theirs.fire(r, c);
        if (!res) return false;
        takeAnswer(r, c, res.res, res.res === 'sunk' ? S.theirs.fleet[res.ship] : null, res.all);
        if (S.phase === 'play') { S.turn = 'them'; paint(); scheduleAI(); }
        return true;
      }
      if (S.pending) return false;
      S.pending = { p: S.plies, r, c };
      S.know.marks[r * SIZE + c] = -1;        /* waiting for the answer */
      sendShot();
      paint();
      return true;
    }
    /* an answer to one of my shots, from the computer or from the friend */
    function takeAnswer(r, c, res, ship, all) {
      S.know.marks[r * SIZE + c] = 0;
      if (res === 'sunk' && !plausibleSunk(S.know, ship, r, c) && mode === 'online') S.suspect = true;
      learn(S.know, r, c, res, ship);
      S.myShots.push({ r, c, res, ship: res === 'sunk' ? ship : null, all: !!all });
      pingAt('enemy', r, c, res);
      sound(res);
      say(`You called ${label(r, c)}: ${res === 'sunk' ? `hit, and you sank their ${ship.len}-long ship` : res}.`);
      ctx.onScore(S.myShots.length);
      if (all) endGame('me');
    }
    function takeTheirShot(r, c, res, all) {
      S.theirShots.push({ r, c, res });
      pingAt('mine', r, c, res);
      sound(res);
      say(`${oppName} called ${label(r, c)}: ${res === 'sunk' ? 'a ship of yours is sunk' : res}.`);
      if (NET) NET.peerScore?.(S.theirShots.length);
      if (all) endGame('them');
    }
    const label = (r, c) => `${'ABCDEFGHIJ'[c]}${r + 1}`;
    function sound(res) {
      if (res === 'miss') snd.blip(260, 0.12, 'sine', 0.7, 150);
      else if (res === 'hit') snd.blip(180, 0.2, 'sawtooth', 0.9, 60);
      else { snd.blip(150, 0.3, 'sawtooth', 1, 40); snd.blip(520, 0.25, 'triangle', 0.6, 220); }
    }
    function pingAt(board, r, c, res) {
      if (reduced) return;
      S.ripples.push({ board, r, c, res, t0: performance.now() });
      loop.kick(0.7);
    }

    /* ------------------------------ the computer ------------------------------ */
    function scheduleAI() {
      clearTimeout(S.aiT);
      if (dead || S.paused || S.phase !== 'play' || S.turn !== 'them' || mode !== 'cpu') return;
      S.aiT = setTimeout(aiShoot, aiDelay);
    }
    function aiShoot() {
      if (dead || S.paused || S.phase !== 'play' || S.turn !== 'them') return;
      const i = chooseShot(S.level, S.aiKnow, rand);
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const res = S.mine.fire(r, c);
      if (!res) { scheduleAI(); return; }
      learn(S.aiKnow, r, c, res.res, res.res === 'sunk' ? S.mine.fleet[res.ship] : null);
      takeTheirShot(r, c, res.res, res.all);
      if (S.phase === 'play') { S.turn = 'me'; paint(); }
    }

    /* ------------------------------ the end ------------------------------ */
    function endGame(winner) {
      if (S.over) return;
      S.over = { winner };
      S.overAt = performance.now();
      if (mode === 'cpu') { S.phase = 'over'; paint(); finishSoon(); return; }
      S.phase = 'reveal';
      paint();
      sendReveal();
      S.revealT = setTimeout(() => {
        if (S.phase !== 'reveal' || S.verdict || dead) return;
        S.verdict = { ok: false, why: 'the other side never revealed their fleet' };
        S.phase = 'over';
        paint();
        finishSoon(200);
      }, REVEAL_WAIT);
      settle();
    }
    async function settle() {
      if (S.phase !== 'reveal' || S.verdict || dead) return;
      if (!S.peerReveal) return;
      S.verdict = 'checking';
      const v = await verify({ commit: S.peerCommit, salt: S.peerReveal.salt, fleet: S.peerReveal.fleet }, S.myShots);
      if (dead) return;
      S.verdict = v;
      clearTimeout(S.revealT);
      S.phase = 'over';
      paint();
      finishSoon(200);
    }
    function resign() {
      if (S.over || dead || S.phase === 'place') return;
      S.over = { winner: 'them', resigned: 'me' };
      clearTimeout(S.aiT);
      if (NET) { send({ t: 'rs' }); setTimeout(() => send({ t: 'rs' }), 700); setTimeout(() => send({ t: 'rs' }), 1800); }
      S.phase = 'over';
      say('You resigned.');
      paint();
      finishSoon();
    }
    let endT = 0;
    function finishSoon(after = 0) {
      clearTimeout(endT);
      endT = setTimeout(finish, after + (reduced ? 300 : 1000));
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const mineWon = S.over.winner === 'me', shots = S.myShots.length;
      const hits = S.myShots.filter(s => s.res !== 'miss').length, theirHits = S.theirShots.filter(s => s.res !== 'miss').length;
      if (mode === 'cpu') {
        const lv = LEVELS[S.level].name;
        if (S.over.resigned) ctx.onEnd({ score: null, won: false, detail: `You resigned against the computer (${lv}).` });
        else if (mineWon) ctx.onEnd({ score: shots, won: true, detail: `You sank all five ships in ${shots} shots against the computer (${lv}).` });
        else ctx.onEnd({ score: null, won: false, detail: `The computer (${lv}) sank your fleet in ${S.theirShots.length} shots. You had hit ${hits} times.` });
        return;
      }
      if (S.over.resigned) {
        const iResigned = S.over.resigned === 'me';
        ctx.onEnd({ score: null, won: !iResigned, versus: { me: iResigned ? 0 : 1, them: iResigned ? 1 : 0 }, detail: iResigned ? 'You resigned.' : `${peerName} resigned.` });
        return;
      }
      if (!S.verdict?.ok) {
        ctx.onEnd({ score: null, won: null, void: true, versus: { me: hits, them: theirHits }, detail: `Results couldn’t be verified: ${S.verdict?.why || 'the other side did not reveal their fleet'}.` });
        return;
      }
      ctx.onEnd({ score: null, won: mineWon, versus: { me: hits, them: theirHits },
        detail: `${mineWon ? 'You sank all five ships' : `${peerName} sank your fleet`} after ${S.plies} shots in all. Their fleet and every answer they gave were checked against what they committed to at the start: verified.` });
    }

    /* ------------------------------ online ------------------------------ */
    const send = d => { try { return NET ? NET.send(d) : false; } catch (err) { return false; } };
    const sendCommit = () => { if (!S.commit) return; const ack = !!S.peerCommit; send({ t: 'cm', h: S.commit, ack }); if (ack) S.ackSent = true; };
    const sendShot = () => { if (S.pending) send({ t: 'sh', p: S.pending.p, r: S.pending.r, c: S.pending.c }); };
    const sendReveal = () => {
      if (!S.over || !S.mine) return;
      const fleet = cleanFleet(S.mine.fleet);
      send({ t: 'rv', salt: S.badReveal ? randomSalt() : S.salt, fleet });
    };
    const shooterOf = p => ((p % 2 === 0) === firstIsMe ? 'me' : 'them');
    function answerFor(r, c) {
      const res = S.mine.fire(r, c);
      if (!res) return null;
      const out = { res: res.res, all: !!res.all };
      if (res.res === 'sunk') out.ship = cleanFleet([S.mine.fleet[res.ship]])[0];
      return { out, res };
    }
    function onNet(d) {
      if (dead || !d || typeof d !== 'object') return;
      switch (d.t) {
        case 'cm': {
          if (!isHash(d.h) || (S.peerCommit && S.peerCommit !== d.h)) { S.rejected++; return; }
          S.peerCommit = d.h;
          if (d.ack === true) S.peerSaw = true;
          if (!S.ackSent) sendCommit();
          maybeBegin();
          break;
        }
        case 'sh': {
          if (S.phase !== 'play' && S.phase !== 'reveal') return;
          if (!Number.isInteger(d.p) || d.p < 0 || d.p > 300) { S.rejected++; return; }
          S.peerSaw = true;
          if (d.p < S.plies) { const a = S.answers.get(d.p); if (a) send(a); return; }
          if (d.p > S.plies || S.phase !== 'play') return;
          if (shooterOf(d.p) !== 'them' || !inGrid(d.r, d.c)) { S.rejected++; return; }
          const a = answerFor(d.r, d.c);
          if (!a) { S.rejected++; return; }
          /* a cheating build of this game could lie here; the test hook below does, once, to prove the check works */
          const wire = { t: 'an', p: d.p, ...a.out };
          if (S.lie && wire.res === 'hit') { wire.res = 'miss'; S.lie = false; }
          S.answers.set(d.p, wire);
          send(wire);
          S.plies++;
          S.turn = 'me';
          takeTheirShot(d.r, d.c, a.res.res, a.res.all);
          if (S.phase === 'play') paint();
          break;
        }
        case 'an': {
          const pd = S.pending;
          if (!pd || d.p !== pd.p || (d.res !== 'miss' && d.res !== 'hit' && d.res !== 'sunk')) return;
          const ship = d.res === 'sunk' ? cleanFleet([d.ship])[0] : null;
          if (d.res === 'sunk' && !shipOk(ship)) { S.rejected++; return; }
          S.pending = null;
          S.plies++;
          S.turn = 'them';
          takeAnswer(pd.r, pd.c, d.res, ship, d.all === true && d.res === 'sunk');
          if (S.phase === 'play') paint();
          break;
        }
        case 'rv': {
          if (S.peerReveal || !isSalt(d.salt) || !Array.isArray(d.fleet)) return;
          S.peerReveal = { salt: d.salt, fleet: d.fleet.slice(0, 5) };
          settle();
          break;
        }
        case 'rs': {
          if (S.over) return;
          S.over = { winner: 'me', resigned: 'them' };
          S.phase = 'over';
          say(`${peerName} resigned.`);
          paint();
          finishSoon();
          break;
        }
        default:
      }
    }
    const offNet = NET?.on?.(onNet) || null;
    const beat = NET ? setInterval(() => {
      if (dead) return;
      if (S.commit && S.plies === 0 && (!S.peerSaw || !S.ackSent)) sendCommit();
      if (S.pending) sendShot();
      if (S.over && S.phase === 'reveal') sendReveal();
    }, BEAT) : 0;

    /* ------------------------------ text ------------------------------ */
    const statusText = () => {
      if (S.phase === 'place') return placedAll() ? 'All ships placed. Press Start when ready.' : 'Place your fleet: drag the ships onto the grid.';
      if (S.phase === 'wait') return `Fleet locked in. Waiting for ${peerName}…`;
      if (S.phase === 'reveal') return 'Revealing fleets and checking every answer…';
      if (S.phase === 'over' || S.over) {
        if (S.over?.resigned) return S.over.resigned === 'me' ? 'You resigned.' : `${peerName} resigned.`;
        if (mode === 'online' && S.verdict && !S.verdict.ok) return 'Results couldn’t be verified.';
        return S.over?.winner === 'me' ? 'You sank the whole enemy fleet!' : `${oppName} sank your fleet.`;
      }
      if (S.paused) return 'Paused';
      if (S.turn === 'me') return S.pending ? 'Waiting for the answer…' : 'Your shot: pick a square on the enemy sea.';
      return mode === 'cpu' ? 'The computer is aiming…' : `${peerName} is aiming…`;
    };
    function paint() {
      if (dead) return;
      const text = statusText();
      statusEl.textContent = text;
      statusEl.classList.toggle('is-done', S.phase === 'over');
      const placing = S.phase === 'place';
      placeRow.style.display = placing ? '' : 'none';
      goBtn.style.display = placing || S.phase === 'wait' ? '' : 'none';
      goBtn.disabled = !placing || !placedAll();
      resignBtn.style.display = placing ? 'none' : '';
      resignBtn.disabled = S.phase === 'over' || S.phase === 'wait' || (S.phase === 'reveal');
      if (S.phase === 'over') resignBtn.reset();
      autoBtn.disabled = !placing; rotBtn.disabled = !placing || !S.ships[S.sel]; clearBtn.disabled = !placing || !S.ships.some(Boolean);
      levelSeg?.disable(S.phase !== 'place');
      const afloatMine = S.mine ? S.mine.afloat() : 5;
      const enemyAfloat = S.know.afloat;
      topStrip.set({ turn: S.phase === 'play' && S.turn === 'them', thinking: mode === 'cpu' && S.phase === 'play' && S.turn === 'them',
        note: mode === 'cpu' ? `${LEVELS[S.level].name} · ${LEVELS[S.level].note}` : (S.phase === 'place' ? 'Placing a fleet' : S.peerCommit ? 'Fleet committed' : 'Not ready yet') });
      botStrip.set({ turn: S.phase === 'play' && S.turn === 'me', note: S.mine ? `${afloatMine} of 5 ships afloat` : `${S.ships.filter(Boolean).length} of 5 placed` });
      fleetNote.textContent = S.phase === 'place' ? '' : `Enemy ships still afloat: ${enemyAfloat.length ? enemyAfloat.join(' · ') : 'none'}`;
      note.style.display = placing ? '' : 'none';
      sf.cv.setAttribute('aria-label', `Battleship seas. ${text}`);
      draw();
    }

    /* ------------------------------ geometry ------------------------------ */
    const PAD = 14;
    function layout() {
      const W = sf.w, H = sf.h;
      const geo = { mine: null, enemy: null, dock: [], wide: W >= H * 1.1, lab: 0 };
      if (S.phase === 'place') {
        let cs, gx, gy, dx, dy, dw;
        if (geo.wide) {
          cs = Math.floor(Math.max(14, Math.min((W - PAD * 2) / 16.4, (H - PAD * 2) / 11.3)));
          geo.lab = Math.round(cs * 1.3);
          gx = PAD; gy = Math.round((H - cs * 10 - geo.lab) / 2 + geo.lab);
          dx = gx + cs * 10 + cs * 0.9; dy = gy; dw = Math.max(cs * 5, W - dx - PAD);
        } else {
          cs = Math.floor(Math.max(14, Math.min((W - PAD * 2) / 10, (H - PAD * 2) / 14.5)));
          geo.lab = Math.round(cs * 1.3);
          gx = Math.round((W - cs * 10) / 2); gy = PAD + geo.lab;
          dx = gx; dy = gy + cs * 10 + cs * 0.6; dw = cs * 10;
        }
        geo.mine = { x: gx, y: gy, cs };
        let x = dx, y = dy;
        S.ships.forEach((s, i) => {
          const len = FLEET[i].len;
          if (x + len * cs > dx + dw + 1 && x > dx) { x = dx; y += cs * 1.25; }
          geo.dock.push({ i, x, y, len, cs });
          x += len * cs + cs * 0.4;
        });
      } else {
        let cs, ax, ay, bx, by;
        if (geo.wide) {
          cs = Math.floor(Math.max(12, Math.min((W - PAD * 3) / 20, (H - PAD * 2) / 11.3)));
          geo.lab = Math.round(cs * 1.3);
          ay = by = Math.round((H - cs * 10 - geo.lab) / 2 + geo.lab);
          const total = cs * 20 + PAD; ax = Math.round((W - total) / 2); bx = ax + cs * 10 + PAD;
        } else {
          cs = Math.floor(Math.max(12, Math.min((W - PAD * 2) / 10, (H - PAD * 2) / 23)));
          geo.lab = Math.round(cs * 1.3);
          ax = bx = Math.round((W - cs * 10) / 2);
          ay = PAD + geo.lab; by = ay + cs * 10 + geo.lab + cs * 0.4;
        }
        geo.enemy = { x: ax, y: ay, cs };
        geo.mine = { x: bx, y: by, cs };
      }
      return geo;
    }
    const cellAt = (G, px, py) => {
      if (!G) return null;
      const c = Math.floor((px - G.x) / G.cs), r = Math.floor((py - G.y) / G.cs);
      return r >= 0 && c >= 0 && r < SIZE && c < SIZE ? { r, c } : null;
    };

    /* ------------------------------ drawing ------------------------------ */
    function seaGrid(g, G, title, glow) {
      const { x, y, cs } = G, s = cs * SIZE;
      g.save();
      if (glow) { g.shadowBlur = 18; g.shadowColor = 'rgba(80,180,255,.45)'; }
      const gr = g.createLinearGradient(0, y, 0, y + s);
      gr.addColorStop(0, '#0d3a63'); gr.addColorStop(1, '#082545');
      g.fillStyle = gr;
      rr(g, x - 3, y - 3, s + 6, s + 6, 8); g.fill();
      g.restore();
      g.strokeStyle = 'rgba(150,210,255,.22)'; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= SIZE; i++) { g.moveTo(x + i * cs, y); g.lineTo(x + i * cs, y + s); g.moveTo(x, y + i * cs); g.lineTo(x + s, y + i * cs); }
      g.stroke();
      g.fillStyle = 'rgba(190,225,255,.55)'; g.font = `600 ${Math.max(9, Math.round(cs * 0.4))}px system-ui,sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i < SIZE; i++) {
        g.fillText('ABCDEFGHIJ'[i], x + (i + 0.5) * cs, y - cs * 0.28);
        if (cs >= 18) g.fillText(String(i + 1), x - cs * 0.3, y + (i + 0.5) * cs);
      }
      g.textAlign = 'left'; g.fillStyle = 'rgba(230,242,255,.9)'; g.font = `700 ${Math.max(10, Math.round(cs * 0.46))}px system-ui,sans-serif`;
      g.fillText(title, x, y - cs * 0.95);
    }
    function shipShape(g, s, x, y, cs, fill, edge, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      g.translate(x, y);
      if (s.d) { g.translate(cs, 0); g.rotate(Math.PI / 2); }
      const w = s.len * cs, p = cs * 0.08;
      g.beginPath();
      g.moveTo(p, cs * 0.2); g.lineTo(w - cs * 0.55, cs * 0.14);
      g.quadraticCurveTo(w - cs * 0.06, cs * 0.2, w - p, cs * 0.5);
      g.quadraticCurveTo(w - cs * 0.06, cs * 0.8, w - cs * 0.55, cs * 0.86);
      g.lineTo(p, cs * 0.8); g.quadraticCurveTo(0, cs * 0.5, p, cs * 0.2);
      g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, cs);
      gr.addColorStop(0, fill[0]); gr.addColorStop(1, fill[1]);
      g.fillStyle = gr; g.fill();
      g.strokeStyle = edge; g.lineWidth = Math.max(1, cs * 0.06); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.28)';
      for (let k = 0; k < s.len; k++) { if (k === 1 || k === s.len - 2) { rr(g, k * cs + cs * 0.22, cs * 0.3, cs * 0.56, cs * 0.4, cs * 0.08); g.fill(); } }
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.arc(cs * 0.5, cs * 0.5, cs * 0.1, 0, 7); g.arc(w - cs * 0.9, cs * 0.5, cs * 0.09, 0, 7); g.fill();
      g.restore();
    }
    const STEEL = ['#8fa6bd', '#52677e'], STEEL_EDGE = '#1d2a3a';
    function peg(g, G, r, c, res) {
      const cx = G.x + (c + 0.5) * G.cs, cy = G.y + (r + 0.5) * G.cs;
      if (res === 'miss') {
        g.strokeStyle = 'rgba(235,245,255,.85)'; g.lineWidth = Math.max(1.5, G.cs * 0.07);
        g.beginPath(); g.arc(cx, cy, G.cs * 0.2, 0, 7); g.stroke();
        g.fillStyle = 'rgba(235,245,255,.35)'; g.beginPath(); g.arc(cx, cy, G.cs * 0.07, 0, 7); g.fill();
      } else {
        const gr = g.createRadialGradient(cx - G.cs * 0.08, cy - G.cs * 0.08, 1, cx, cy, G.cs * 0.3);
        gr.addColorStop(0, '#ffd27a'); gr.addColorStop(0.45, '#ff5a3c'); gr.addColorStop(1, '#8e1020');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, G.cs * 0.29, 0, 7); g.fill();
      }
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const now = performance.now();
      const G = S.geo = layout();
      g.fillStyle = '#04070d'; g.fillRect(0, 0, sf.w, sf.h);
      let sx = 0;
      if (S.shake && now - S.shake < 260) sx = Math.sin((now - S.shake) / 20) * 4 * (1 - (now - S.shake) / 260);
      g.save(); g.translate(sx, 0);
      if (S.phase === 'place') {
        seaGrid(g, G.mine, 'YOUR FLEET', true);
        S.ships.forEach((s, i) => { if (s) shipShape(g, s, G.mine.x + s.c * G.mine.cs, G.mine.y + s.r * G.mine.cs, G.mine.cs, STEEL, i === S.sel ? '#7be0ff' : STEEL_EDGE); });
        for (const d of G.dock) {
          const s = S.ships[d.i];
          g.fillStyle = 'rgba(255,255,255,.05)'; rr(g, d.x - 3, d.y - 3, d.len * d.cs + 6, d.cs + 6, 6); g.fill();
          if (!s && !(S.drag && S.drag.i === d.i)) shipShape(g, { len: d.len, d: 0 }, d.x, d.y, d.cs, STEEL, d.i === S.sel ? '#7be0ff' : STEEL_EDGE);
          else if (S.drag?.i === d.i || s) { g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, d.x, d.y + d.cs * 0.25, d.len * d.cs, d.cs * 0.5, 5); g.fill(); }
        }
        if (S.drag) {
          const D = S.drag, cand = dragShip();
          const ok = cand && canPlace(S.ships, cand, D.i);
          if (cand && inGrid(cand.r, cand.c)) {
            for (const [r, c] of cellsOf(cand)) {
              if (!inGrid(r, c)) continue;
              g.fillStyle = ok ? 'rgba(90,230,150,.28)' : 'rgba(255,90,100,.3)';
              g.fillRect(G.mine.x + c * G.mine.cs, G.mine.y + r * G.mine.cs, G.mine.cs, G.mine.cs);
            }
          }
          shipShape(g, { len: FLEET[D.i].len, d: D.d }, D.x - (D.off.c + 0.5) * G.mine.cs, D.y - (D.off.r + 0.5) * G.mine.cs, G.mine.cs, STEEL, '#7be0ff', 0.85);
        }
      } else {
        seaGrid(g, G.enemy, 'ENEMY WATERS', S.phase === 'play' && S.turn === 'me');
        seaGrid(g, G.mine, 'YOUR FLEET', S.phase === 'play' && S.turn === 'them');
        S.mine?.fleet.forEach((s, i) => shipShape(g, s, G.mine.x + s.c * G.mine.cs, G.mine.y + s.r * G.mine.cs, G.mine.cs, S.mine.hitsOn[i] === s.len ? ['#6b2a2a', '#3c1414'] : STEEL, STEEL_EDGE));
        /* the enemy ships I have sunk, and (once it is over) the whole of their fleet */
        const sunk = new Set(S.myShots.filter(s => s.res === 'sunk').map(s => s.ship.len + '.' + s.ship.r + '.' + s.ship.c));
        for (const s of S.myShots) if (s.res === 'sunk') shipShape(g, s.ship, G.enemy.x + s.ship.c * G.enemy.cs, G.enemy.y + s.ship.r * G.enemy.cs, G.enemy.cs, ['#7a3434', '#431818'], '#220c0c', 0.9);
        if (S.theirs && S.over && S.over.winner === 'them') S.theirs.fleet.forEach(s => { if (!sunk.has(s.len + '.' + s.r + '.' + s.c)) shipShape(g, s, G.enemy.x + s.c * G.enemy.cs, G.enemy.y + s.r * G.enemy.cs, G.enemy.cs, STEEL, STEEL_EDGE, 0.55); });
        for (const s of S.myShots) peg(g, G.enemy, s.r, s.c, s.res);
        for (const s of S.theirShots) peg(g, G.mine, s.r, s.c, s.res);
        if (S.pending) { const q = S.pending; g.strokeStyle = '#ffe08a'; g.lineWidth = 2; g.strokeRect(G.enemy.x + q.c * G.enemy.cs + 2, G.enemy.y + q.r * G.enemy.cs + 2, G.enemy.cs - 4, G.enemy.cs - 4); }
        /* the aim */
        if (canShoot()) {
          const a = S.kb ? S.cursor : S.hover;
          if (a && !S.know.marks[a.r * SIZE + a.c]) {
            const cx = G.enemy.x + (a.c + 0.5) * G.enemy.cs, cy = G.enemy.y + (a.r + 0.5) * G.enemy.cs;
            g.strokeStyle = 'rgba(255,230,140,.95)'; g.lineWidth = 2;
            g.strokeRect(G.enemy.x + a.c * G.enemy.cs + 1.5, G.enemy.y + a.r * G.enemy.cs + 1.5, G.enemy.cs - 3, G.enemy.cs - 3);
            g.beginPath(); g.moveTo(cx - G.enemy.cs * 0.32, cy); g.lineTo(cx + G.enemy.cs * 0.32, cy); g.moveTo(cx, cy - G.enemy.cs * 0.32); g.lineTo(cx, cy + G.enemy.cs * 0.32); g.stroke();
          }
        }
        S.ripples = S.ripples.filter(rp => now - rp.t0 < 650);
        for (const rp of S.ripples) {
          const B = rp.board === 'enemy' ? G.enemy : G.mine, k = (now - rp.t0) / 650;
          g.strokeStyle = rp.res === 'miss' ? `rgba(220,240,255,${1 - k})` : `rgba(255,150,70,${1 - k})`;
          g.lineWidth = 2;
          g.beginPath(); g.arc(B.x + (rp.c + 0.5) * B.cs, B.y + (rp.r + 0.5) * B.cs, B.cs * (0.3 + k * 1.1), 0, 7); g.stroke();
        }
      }
      g.restore();
    }

    /* ------------------------------ pointer ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    /* the ship being dragged, as it would sit under the pointer right now */
    function dragShip() {
      const D = S.drag, G = S.geo.mine;
      if (!D || !G) return null;
      const p = cellPoint(D.x, D.y, G);
      return { len: FLEET[D.i].len, d: D.d, r: p.r - D.off.r, c: p.c - D.off.c };
    }
    const cellPoint = (px, py, G) => ({ r: Math.floor((py - G.y) / G.cs), c: Math.floor((px - G.x) / G.cs) });
    function toggleDrag() {
      const D = S.drag;
      D.d = 1 - D.d;
      D.off = { r: D.off.c, c: D.off.r };
      snd.blip(360, 0.04, 'triangle', 0.5);
      draw();
    }
    function pickUp(p) {
      const G = S.geo;
      /* a placed ship */
      const cell = cellAt(G.mine, p.x, p.y);
      if (cell) {
        const i = S.ships.findIndex(s => s && cellsOf(s).some(([r, c]) => r === cell.r && c === cell.c));
        if (i >= 0) { const s = S.ships[i]; return { i, d: s.d, off: { r: cell.r - s.r, c: cell.c - s.c }, from: s }; }
        return null;
      }
      for (const d of G.dock) {
        if (S.ships[d.i]) continue;
        if (p.x >= d.x && p.x <= d.x + d.len * d.cs && p.y >= d.y - 2 && p.y <= d.y + d.cs + 2) {
          return { i: d.i, d: 0, off: { r: 0, c: Math.min(d.len - 1, Math.floor((p.x - d.x) / d.cs)) }, from: null };
        }
      }
      return null;
    }
    const onDown = e => {
      if (e.button > 0 || dead || S.paused) return;
      snd.wake();
      S.kb = false;
      const p = at(e);
      if (S.phase === 'place') {
        const pk = pickUp(p);
        if (!pk) return;
        S.drag = { ...pk, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, id: e.pointerId };
        S.sel = pk.i;
        S.ships[pk.i] = null;
        try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        paint();
        return;
      }
      const cell = cellAt(S.geo.enemy, p.x, p.y);
      if (cell) { S.hover = cell; fire(cell.r, cell.c); }
    };
    const onMove = e => {
      const p = at(e);
      if (S.drag && e.pointerId === S.drag.id) {
        S.drag.x = p.x; S.drag.y = p.y;
        if (Math.hypot(p.x - S.drag.sx, p.y - S.drag.sy) > 6) S.drag.moved = true;
        draw();
        return;
      }
      if (S.phase !== 'place') {
        const cell = cellAt(S.geo.enemy, p.x, p.y);
        S.kb = false;
        if (cell?.r !== S.hover?.r || cell?.c !== S.hover?.c) { S.hover = cell; sf.cv.style.cursor = cell && canShoot() ? 'crosshair' : 'default'; draw(); }
      }
    };
    const onUp = e => {
      const D = S.drag;
      if (!D || e.pointerId !== D.id) return;
      const cand = D.moved ? dragShip() : null;
      const overGrid = !!cellAt(S.geo.mine, D.x, D.y);
      S.drag = null;
      if (cand && canPlace(S.ships, cand, D.i)) { setShip(D.i, cand); snd.blip(300, 0.05, 'triangle', 0.6); return; }
      if (D.from) {
        S.ships[D.i] = D.from;
        if (!D.moved) rotateShip(D.i);                                  /* a tap turns it */
        else if (overGrid) bump();                                      /* it did not fit: back where it was */
        else S.ships[D.i] = null;                                       /* dropped off the grid: back to the dock */
      } else if (D.moved && overGrid) bump();
      paint();
    };
    const onLeave = () => { if (S.hover) { S.hover = null; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key, DIR = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      if (S.paused) return;
      if (S.phase === 'place') {
        if (/^[1-5]$/.test(k)) { S.sel = Number(k) - 1; e.preventDefault(); paint(); return; }
        if (k === 'r' || k === 'R') { e.preventDefault(); rotateSel(); return; }
        if (DIR) { e.preventDefault(); nudge(DIR[0], DIR[1]); return; }
        if (k === 'Enter') { e.preventDefault(); start(); }
        return;
      }
      if (S.phase !== 'play') return;
      if (DIR) {
        e.preventDefault(); snd.wake();
        S.kb = true;
        S.cursor = { r: Math.max(0, Math.min(SIZE - 1, S.cursor.r + DIR[0])), c: Math.max(0, Math.min(SIZE - 1, S.cursor.c + DIR[1])) };
        draw();
      } else if (k === 'Enter' || k === ' ') { e.preventDefault(); snd.wake(); S.kb = true; fire(S.cursor.r, S.cursor.c); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);
    sf.cv.addEventListener('pointerleave', onLeave);

    ctx.onScore(0);
    NET?.peerScore?.(0);
    paint();

    const rowsOf = k => { const o = []; for (let r = 0; r < SIZE; r++) { let s = ''; for (let c = 0; c < SIZE; c++) { const m = k.marks[r * SIZE + c]; s += m === 1 ? 'o' : m === 2 ? 'x' : m === 3 ? '#' : m === -1 ? '?' : '.'; } o.push(s); } return o; };
    return {
      stop() {
        dead = true;
        clearTimeout(S.aiT); clearTimeout(endT); clearTimeout(S.revealT); clearInterval(beat);
        try { offNet?.(); } catch (err) { /* already off */ }
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      pause() { S.paused = true; clearTimeout(S.aiT); S.drag = null; paint(); },
      resume() { S.paused = false; paint(); scheduleAI(); },
      peek: () => ({
        mode, phase: S.phase, turn: S.turn, level: S.level, paused: S.paused, first: firstIsMe ? 'me' : 'them',
        ships: S.ships.map(s => (s ? { ...s } : null)), sel: S.sel, dragging: !!S.drag, placed: S.ships.filter(Boolean).length,
        myShots: S.myShots.map(s => ({ r: s.r, c: s.c, res: s.res })), theirShots: S.theirShots.map(s => ({ ...s })),
        shots: S.myShots.length, know: rowsOf(S.know), aiKnow: rowsOf(S.aiKnow), enemyAfloat: S.know.afloat.slice(), myAfloat: S.mine ? S.mine.afloat() : 5,
        mineFleet: S.mine ? S.mine.fleet.map(s => ({ ...s })) : null, plies: S.plies, pending: !!S.pending,
        over: S.over ? { winner: S.over.winner, resigned: S.over.resigned || null } : null, ended: S.ended,
        committed: !!S.commit, peerCommitted: !!S.peerCommit, commit: S.commit, peerCommit: S.peerCommit, rejected: S.rejected, suspect: S.suspect,
        verdict: S.verdict && S.verdict !== 'checking' ? { ok: S.verdict.ok, why: S.verdict.why || '' } : null, status: statusEl.textContent,
        geo: { wide: S.geo.wide, mine: S.geo.mine && { ...S.geo.mine }, enemy: S.geo.enemy && { ...S.geo.enemy }, dock: S.geo.dock.map(d => ({ ...d })) },
      }),
      /* test hook — nothing in the game calls it:
         place(fleet) · cpuFleet(fleet) · seed(n) · delay(ms) · shoot({ r, c }) · lie(bool: the next hit is answered as a miss) · badReveal(bool) */
      hook(cmd, arg) {
        if (cmd === 'place' && S.phase === 'place' && validFleet(arg)) { S.ships = cleanFleet(arg); paint(); }
        else if (cmd === 'cpuFleet' && mode === 'cpu' && validFleet(arg) && !S.myShots.length) S.theirs = new Waters(cleanFleet(arg));
        else if (cmd === 'seed') rand = rng(arg >>> 0);
        else if (cmd === 'delay') aiDelay = Math.max(0, +arg || 0);
        else if (cmd === 'shoot') return fire(arg.r, arg.c);
        else if (cmd === 'lie') S.lie = !!arg;
        else if (cmd === 'badReveal') S.badReveal = !!arg;
        else return false;
        return true;
      },
    };
  },
};
