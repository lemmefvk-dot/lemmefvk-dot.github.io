/* ============================================================
   arcade/hostlink.js — a hidden-information duel (Dominoes, Five
   Dice, Crazy Eights) over the Arcade's room (./room.js).

   THE HOST CHECKS MOVES. The host's Arcade holds the whole game —
   the shuffled stock, both hands, the dice — and runs the rules. The
   guest's Arcade is sent only what its player may see (its own hand,
   the table, how many tiles or cards the host holds), and sends back
   the moves its player makes; the host checks every one against the
   rules before it changes anything. So the guest's screen never gets
   the host's hand, in clear or otherwise. The host's own Arcade does
   deal the guest's hand, as a dealer does: the rules card says so.

   PROTOCOL — game data on the room ({ t, … } inside room.js's 'g'):
     vw { q, v, no? }   host → guest: the guest's view at step q, on
                        every change and again every BEAT (a lost one
                        is mended by the next); no = k of a move the
                        rules just refused
     ac { q, a, k }     guest → host: move a, made on view q; k counts
                        the guest's moves so a repeat is applied once.
                        Repeated every RESEND until a view past q comes.
     vq {}              guest → host: "send me the view again"
   A move for any step but the current one is stale and dropped; one the
   rules refuse is counted in `rejected` and dropped; junk too.

     hostLink(NET, { view() -> object, act(a) -> bool, dead() })
       -> { changed(), stop(), rejected, step }
          view(): the guest's view of the game now (small: GAME_MAX)
          act(a): the guest's move a — apply it if the rules allow, return
                  whether it was applied (the link then sends the new view)
     guestLink(NET, { show(v, q), dead() })
       -> { act(a), stop(), step, waiting }
          show(v, q, refused): a new view arrived (the game checks its
                  shape); refused: the host's rules turned my last move down
   ============================================================ */

const BEAT = 1500;
const RESEND = 900;

export function hostLink(NET, game) {
  const L = { step: 0, rejected: 0, last: -1 };
  let beatT = 0, off = null, lastAsk = 0;
  const send = d => { try { return NET.send(d); } catch (err) { return false; } };
  const push = () => { if (!game.dead()) send({ t: 'vw', q: L.step, v: game.view() }); };
  function onNet(d) {
    if (game.dead() || !d || typeof d !== 'object') return;
    if (d.t === 'vq') {
      const t = performance.now();
      if (t - lastAsk < 300) return;
      lastAsk = t;
      push();
    } else if (d.t === 'ac') {
      /* k far ahead of the last move taken is not the friend's counter (which only steps by one per move made) */
      if (!Number.isInteger(d.q) || !Number.isInteger(d.k) || d.k < 0 || d.k > L.last + 1000) { L.rejected++; return; }
      if (d.k <= L.last) { if (d.q < L.step) push(); return; }     /* a repeat of a move already taken: they missed the view */
      if (d.q !== L.step) { push(); return; }                       /* made on an old view */
      let ok = false;
      try { ok = !!game.act(d.a); } catch (err) { ok = false; }
      if (!ok) { L.rejected++; if (!game.dead()) send({ t: 'vw', q: L.step, v: game.view(), no: d.k }); return; }
      L.last = d.k;
      L.step++;
      push();
    }
  }
  off = NET.on?.(onNet) || null;
  beatT = setInterval(push, BEAT);
  return Object.assign(L, {
    /* the host's own move (or a deal) changed the game */
    changed() { L.step++; push(); },
    stop() { clearInterval(beatT); try { off?.(); } catch (err) { /* already off */ } },
  });
}

export function guestLink(NET, game) {
  const L = { step: -1, waiting: null };
  let k = 0, resendT = 0, askT = 0, off = null;
  const send = d => { try { return NET.send(d); } catch (err) { return false; } };
  function onNet(d) {
    if (game.dead() || !d || typeof d !== 'object' || d.t !== 'vw') return;
    if (!Number.isInteger(d.q) || d.q < 0 || !d.v || typeof d.v !== 'object') return;
    if (d.q < L.step) return;                                      /* an older view arriving late */
    const fresh = d.q > L.step;
    L.step = d.q;
    /* the view moved past my move, or the host says the rules refused it: stop sending it */
    const refused = !!L.waiting && d.no === L.waiting.k;
    if (L.waiting && (d.q > L.waiting.q || refused)) { L.waiting = null; clearInterval(resendT); }
    if (fresh || refused || !L.waiting) game.show(d.v, d.q, refused);
  }
  off = NET.on?.(onNet) || null;
  /* until the first view comes, ask for it */
  askT = setInterval(() => { if (L.step < 0 && !game.dead()) send({ t: 'vq' }); else clearInterval(askT); }, 700);
  send({ t: 'vq' });
  return Object.assign(L, {
    /* my move: sent now and again until the host's next view shows it was taken (or refused) */
    act(a) {
      if (game.dead() || L.step < 0) return false;
      const m = { t: 'ac', q: L.step, a, k: k++ };
      L.waiting = m;
      send(m);
      clearInterval(resendT);
      resendT = setInterval(() => { if (L.waiting === m && !game.dead()) send(m); else clearInterval(resendT); }, RESEND);
      return true;
    },
    stop() { clearInterval(resendT); clearInterval(askT); try { off?.(); } catch (err) { /* already off */ } },
  });
}

export default { hostLink, guestLink };
