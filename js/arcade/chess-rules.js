/* ============================================================
   arcade/chess-rules.js — the rules of chess, and a small engine.

   Pure: no DOM, no timers, so the Arcade's chess (./chess.js), its
   thinking worker (./think.js) and the play-tests all run the same
   code. Nothing is downloaded: the engine is the search below.

   BOARD. 0x88: square = rank * 16 + file, rank 0 = White's back rank,
   so a1 = 0, h1 = 7, a8 = 112. A piece is its type (1 pawn … 6 king),
   positive for White and negative for Black.

   MOVES are integers: from | to << 7 | promo << 14 | flags << 17
   (mFrom / mTo / mPromo / mFlags read them back). Every rule is here:
   castling (through no attacked square, rights lost when a king or
   rook moves or a rook is taken), en passant, promotion to Q R B N,
   check, checkmate, stalemate, the 50-move rule, threefold repetition
   (a position = placement + side to move + castling + an en passant
   capture that is really possible) and dead positions where neither
   side can mate (K v K, K+minor v K, bishops all on one colour).
   perft() is the standard move-generator check (tests/suites/
   chess-connect4.mjs runs it from the start position and Kiwipete).

   ENGINE. think(): iterative deepening negamax with alpha-beta, a
   capture-only quiescence search, a small transposition table, killer
   and history move ordering, a check extension, and a time limit — it
   always finishes depth 1, then keeps the last depth it completed.
   The evaluation is material + piece-square tables (the well-known
   "simplified evaluation function"), a king table that blends from
   middle game to end game, and a mop-up term so a won ending is
   actually won. `noise` (centipawns) makes the easier levels human:
   every root move is scored with a full window, then jittered.
   ============================================================ */

export const WHITE = 1, BLACK = -1;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

export const F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8, F_PROMO = 16;
const mk = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);
export const mFrom = m => m & 127;
export const mTo = m => (m >> 7) & 127;
export const mPromo = m => (m >> 14) & 7;
export const mFlags = m => (m >> 17) & 31;

const N_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
const B_DIRS = [17, 15, -17, -15];
const R_DIRS = [16, 1, -16, -1];
const K_DIRS = [17, 16, 15, 1, -1, -15, -16, -17];
const LETTERS = ' pnbrqk';
const SAN_LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K'];

const WK = 1, WQ = 2, BK = 4, BQ = 8;
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~WQ;
CASTLE_MASK[0x07] = 15 & ~WK;
CASTLE_MASK[0x04] = 15 & ~(WK | WQ);
CASTLE_MASK[0x70] = 15 & ~BQ;
CASTLE_MASK[0x77] = 15 & ~BK;
CASTLE_MASK[0x74] = 15 & ~(BK | BQ);

export const sqName = sq => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
export const sqOf = name => {
  const m = /^([a-h])([1-8])$/.exec(String(name || ''));
  return m ? (m[2].charCodeAt(0) - 49) * 16 + (m[1].charCodeAt(0) - 97) : -1;
};
export const fileOf = sq => sq & 7;
export const rankOf = sq => sq >> 4;
/** a move as UCI text: e2e4, e7e8q */
export const uci = m => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? LETTERS[mPromo(m)] : '');

/* ---------- Zobrist keys, from a fixed seed so every thread agrees ---------- */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}
const Z = (() => {
  const r = mulberry(0x5eed1e55);
  const fill = n => { const lo = new Int32Array(n), hi = new Int32Array(n); for (let i = 0; i < n; i++) { lo[i] = r(); hi[i] = r(); } return { lo, hi }; };
  return { p: fill(13 * 128), c: fill(16), e: fill(8), s: fill(1) };
})();
const zi = (piece, sq) => (piece + 6) * 128 + sq;

export class Position {
  constructor(fen = START_FEN) {
    this.b = new Int8Array(128);
    this.turn = WHITE;
    this.castle = 0;
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.kw = -1;
    this.kb = -1;
    this.lo = 0;
    this.hi = 0;
    this.st = [];
    this.load(fen);
  }

  load(fen) {
    const parts = String(fen).trim().split(/\s+/);
    const rows = (parts[0] || '').split('/');
    if (rows.length !== 8) throw new Error('A FEN needs 8 ranks');
    this.b.fill(0);
    this.kw = this.kb = -1;
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) { f += Number(ch); continue; }
        const t = LETTERS.indexOf(ch.toLowerCase());
        if (t < 1 || f > 7) throw new Error(`Bad FEN piece "${ch}"`);
        const sq = (7 - r) * 16 + f;
        const p = ch === ch.toUpperCase() ? t : -t;
        this.b[sq] = p;
        if (p === KING) { if (this.kw >= 0) throw new Error('Two white kings'); this.kw = sq; }
        if (p === -KING) { if (this.kb >= 0) throw new Error('Two black kings'); this.kb = sq; }
        f++;
      }
      if (f !== 8) throw new Error('A FEN rank needs 8 squares');
    }
    if (this.kw < 0 || this.kb < 0) throw new Error('Each side needs a king');
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    const c = parts[2] || '-';
    this.castle = 0;
    if (c.includes('K') && this.b[4] === KING && this.b[7] === ROOK) this.castle |= WK;
    if (c.includes('Q') && this.b[4] === KING && this.b[0] === ROOK) this.castle |= WQ;
    if (c.includes('k') && this.b[0x74] === -KING && this.b[0x77] === -ROOK) this.castle |= BK;
    if (c.includes('q') && this.b[0x74] === -KING && this.b[0x70] === -ROOK) this.castle |= BQ;
    const e = sqOf(parts[3]);
    this.ep = e >= 0 && this.epUsable(e, this.turn) ? e : -1;
    this.half = Math.max(0, parseInt(parts[4], 10) || 0);
    this.full = Math.max(1, parseInt(parts[5], 10) || 1);
    this.st = [];
    this.rehash();
    return this;
  }

  /* can the side to move (us) capture en passant on e at all? (an enemy pawn
     just passed e, and one of ours stands beside it) */
  epUsable(e, us) {
    const pawnSq = e - 16 * us;            /* the pawn that just moved two */
    if (this.b[pawnSq] !== -us * PAWN) return false;
    for (const d of [-1, 1]) {
      const s = pawnSq + d;
      if (!(s & 0x88) && this.b[s] === us * PAWN) return true;
    }
    return false;
  }

  rehash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.b[sq];
      if (p) { lo ^= Z.p.lo[zi(p, sq)]; hi ^= Z.p.hi[zi(p, sq)]; }
    }
    lo ^= Z.c.lo[this.castle]; hi ^= Z.c.hi[this.castle];
    if (this.ep >= 0) { lo ^= Z.e.lo[this.ep & 7]; hi ^= Z.e.hi[this.ep & 7]; }
    if (this.turn === BLACK) { lo ^= Z.s.lo[0]; hi ^= Z.s.hi[0]; }
    this.lo = lo; this.hi = hi;
  }

  /** the position's identity as a 53-bit number (repetition, tables) */
  key() { return (this.hi & 0x1FFFFF) * 4294967296 + (this.lo >>> 0); }

  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        const ch = LETTERS[Math.abs(p)];
        s += p > 0 ? ch.toUpperCase() : ch;
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    let c = '';
    if (this.castle & WK) c += 'K';
    if (this.castle & WQ) c += 'Q';
    if (this.castle & BK) c += 'k';
    if (this.castle & BQ) c += 'q';
    return `${s} ${this.turn === WHITE ? 'w' : 'b'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
  }

  clone() {
    const p = Object.create(Position.prototype);
    p.b = this.b.slice();
    p.turn = this.turn; p.castle = this.castle; p.ep = this.ep; p.half = this.half; p.full = this.full;
    p.kw = this.kw; p.kb = this.kb; p.lo = this.lo; p.hi = this.hi;
    p.st = this.st.slice();
    return p;
  }

  piece(sq) { return sq >= 0 && !(sq & 0x88) ? this.b[sq] : 0; }
  kingSq(color) { return color === WHITE ? this.kw : this.kb; }

  /** is sq attacked by `by` (WHITE | BLACK)? */
  attacked(sq, by) {
    const b = this.b;
    if (by === WHITE) {
      let s = sq - 15; if (!(s & 0x88) && b[s] === PAWN) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === PAWN) return true;
    } else {
      let s = sq + 15; if (!(s & 0x88) && b[s] === -PAWN) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === -PAWN) return true;
    }
    const kn = by * KNIGHT, ki = by * KING, bi = by * BISHOP, ro = by * ROOK, qu = by * QUEEN;
    for (let i = 0; i < 8; i++) {
      let s = sq + N_DIRS[i];
      if (!(s & 0x88) && b[s] === kn) return true;
      s = sq + K_DIRS[i];
      if (!(s & 0x88) && b[s] === ki) return true;
    }
    for (let i = 0; i < 4; i++) {
      const d = B_DIRS[i];
      for (let s = sq + d; !(s & 0x88); s += d) {
        const p = b[s];
        if (p) { if (p === bi || p === qu) return true; break; }
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = R_DIRS[i];
      for (let s = sq + d; !(s & 0x88); s += d) {
        const p = b[s];
        if (p) { if (p === ro || p === qu) return true; break; }
      }
    }
    return false;
  }

  inCheck() { return this.attacked(this.kingSq(this.turn), -this.turn); }

  /** pseudo-legal moves into `out` (only captures and promotions when `noisy`) */
  gen(out, noisy = false) {
    const b = this.b, us = this.turn;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (p * us <= 0) continue;
      const t = p * us;
      if (t === PAWN) {
        const fwd = 16 * us;
        const last = us === WHITE ? 7 : 0;
        const to = sq + fwd;
        if (!(to & 0x88) && !b[to]) {
          if ((to >> 4) === last) {
            out.push(mk(sq, to, QUEEN, F_PROMO), mk(sq, to, ROOK, F_PROMO), mk(sq, to, BISHOP, F_PROMO), mk(sq, to, KNIGHT, F_PROMO));
          } else if (!noisy) {
            out.push(mk(sq, to, 0, 0));
            const start = us === WHITE ? 1 : 6;
            if ((sq >> 4) === start && !b[to + fwd]) out.push(mk(sq, to + fwd, 0, F_DOUBLE));
          }
        }
        for (const cd of [fwd - 1, fwd + 1]) {
          const c = sq + cd;
          if (c & 0x88) continue;
          if (b[c] * us < 0) {
            if ((c >> 4) === last) {
              const f = F_CAPTURE | F_PROMO;
              out.push(mk(sq, c, QUEEN, f), mk(sq, c, ROOK, f), mk(sq, c, BISHOP, f), mk(sq, c, KNIGHT, f));
            } else out.push(mk(sq, c, 0, F_CAPTURE));
          } else if (c === this.ep) out.push(mk(sq, c, 0, F_CAPTURE | F_EP));
        }
        continue;
      }
      if (t === KNIGHT || t === KING) {
        const dirs = t === KNIGHT ? N_DIRS : K_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = sq + dirs[i];
          if (to & 0x88) continue;
          const q = b[to];
          if (!q) { if (!noisy) out.push(mk(sq, to, 0, 0)); } else if (q * us < 0) out.push(mk(sq, to, 0, F_CAPTURE));
        }
        if (t === KING && !noisy) this.genCastles(out, sq);
        continue;
      }
      const dirs = t === BISHOP ? B_DIRS : t === ROOK ? R_DIRS : K_DIRS;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        for (let to = sq + d; !(to & 0x88); to += d) {
          const q = b[to];
          if (!q) { if (!noisy) out.push(mk(sq, to, 0, 0)); continue; }
          if (q * us < 0) out.push(mk(sq, to, 0, F_CAPTURE));
          break;
        }
      }
    }
    return out;
  }

  genCastles(out, sq) {
    const b = this.b, us = this.turn, them = -us;
    if (us === WHITE) {
      if (sq !== 4) return;
      if ((this.castle & WK) && !b[5] && !b[6] && b[7] === ROOK && !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them)) out.push(mk(4, 6, 0, F_CASTLE));
      if ((this.castle & WQ) && !b[3] && !b[2] && !b[1] && b[0] === ROOK && !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them)) out.push(mk(4, 2, 0, F_CASTLE));
    } else {
      if (sq !== 0x74) return;
      if ((this.castle & BK) && !b[0x75] && !b[0x76] && b[0x77] === -ROOK && !this.attacked(0x74, them) && !this.attacked(0x75, them) && !this.attacked(0x76, them)) out.push(mk(0x74, 0x76, 0, F_CASTLE));
      if ((this.castle & BQ) && !b[0x73] && !b[0x72] && !b[0x71] && b[0x70] === -ROOK && !this.attacked(0x74, them) && !this.attacked(0x73, them) && !this.attacked(0x72, them)) out.push(mk(0x74, 0x72, 0, F_CASTLE));
    }
  }

  /** play m (pseudo-legal); returns false and takes it back when it leaves the mover in check */
  make(m) {
    const b = this.b, us = this.turn;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 31;
    const p = b[from];
    const capSq = flags & F_EP ? to - 16 * us : to;
    const cap = b[capSq];
    this.st.push(m, cap, this.castle, this.ep, this.half, this.lo, this.hi);
    let lo = this.lo, hi = this.hi;
    lo ^= Z.p.lo[zi(p, from)]; hi ^= Z.p.hi[zi(p, from)];
    if (cap) { lo ^= Z.p.lo[zi(cap, capSq)]; hi ^= Z.p.hi[zi(cap, capSq)]; b[capSq] = 0; }
    const np = promo ? promo * us : p;
    b[from] = 0;
    b[to] = np;
    lo ^= Z.p.lo[zi(np, to)]; hi ^= Z.p.hi[zi(np, to)];
    if (flags & F_CASTLE) {
      const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1, r = us * ROOK;
      b[rt] = r; b[rf] = 0;
      lo ^= Z.p.lo[zi(r, rf)] ^ Z.p.lo[zi(r, rt)]; hi ^= Z.p.hi[zi(r, rf)] ^ Z.p.hi[zi(r, rt)];
    }
    if (p === KING) this.kw = to; else if (p === -KING) this.kb = to;
    const nc = this.castle & CASTLE_MASK[from] & CASTLE_MASK[to];
    if (nc !== this.castle) { lo ^= Z.c.lo[this.castle] ^ Z.c.lo[nc]; hi ^= Z.c.hi[this.castle] ^ Z.c.hi[nc]; this.castle = nc; }
    if (this.ep >= 0) { lo ^= Z.e.lo[this.ep & 7]; hi ^= Z.e.hi[this.ep & 7]; }
    this.ep = -1;
    if (flags & F_DOUBLE) {
      const e = from + 16 * us;
      for (const d of [-1, 1]) {
        const s = to + d;
        if (!(s & 0x88) && b[s] === -us * PAWN) { this.ep = e; break; }
      }
      if (this.ep >= 0) { lo ^= Z.e.lo[this.ep & 7]; hi ^= Z.e.hi[this.ep & 7]; }
    }
    this.half = (p === PAWN || p === -PAWN || cap) ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.turn = -us;
    lo ^= Z.s.lo[0]; hi ^= Z.s.hi[0];
    this.lo = lo; this.hi = hi;
    if (this.attacked(us === WHITE ? this.kw : this.kb, -us)) { this.unmake(); return false; }
    return true;
  }

  unmake() {
    const st = this.st, b = this.b;
    const hi = st.pop(), lo = st.pop(), half = st.pop(), ep = st.pop(), castle = st.pop(), cap = st.pop(), m = st.pop();
    const us = -this.turn;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = (m >> 17) & 31;
    const p = promo ? us * PAWN : b[to];
    b[from] = p;
    if (flags & F_EP) { b[to] = 0; b[to - 16 * us] = cap; } else b[to] = cap;
    if (flags & F_CASTLE) {
      const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1;
      b[rf] = us * ROOK; b[rt] = 0;
    }
    if (p === KING) this.kw = from; else if (p === -KING) this.kb = from;
    if (us === BLACK) this.full--;
    this.turn = us; this.castle = castle; this.ep = ep; this.half = half; this.lo = lo; this.hi = hi;
  }

  /** every legal move, as move integers */
  legalMoves() {
    const out = [];
    for (const m of this.gen([])) if (this.make(m)) { this.unmake(); out.push(m); }
    return out;
  }

  /** the legal move from → to (with promo for a promotion), or 0 */
  findMove(from, to, promo = 0) {
    for (const m of this.legalMoves()) {
      if (mFrom(m) !== from || mTo(m) !== to) continue;
      if (mFlags(m) & F_PROMO) { if (mPromo(m) === (promo || QUEEN)) return m; } else return m;
    }
    return 0;
  }

  /** a move given as UCI text, only if it is legal here; else 0 */
  fromUci(text) {
    const s = String(text || '');
    const ma = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(s);
    if (!ma) return 0;
    const from = sqOf(ma[1]), to = sqOf(ma[2]);
    const promo = ma[3] ? LETTERS.indexOf(ma[3]) : 0;
    const m = this.findMove(from, to, promo);
    if (!m) return 0;
    if ((mFlags(m) & F_PROMO) && !ma[3]) return 0;           /* a promotion must say what it becomes */
    if (!(mFlags(m) & F_PROMO) && ma[3]) return 0;
    return m;
  }

  /** Standard Algebraic Notation for a legal move m (call before playing it) */
  san(m) {
    const from = mFrom(m), to = mTo(m), flags = mFlags(m), p = Math.abs(this.b[from]);
    let s;
    if (flags & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else if (p === PAWN) {
      s = (flags & F_CAPTURE ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to);
      if (flags & F_PROMO) s += '=' + SAN_LETTER[mPromo(m)];
    } else {
      let sameFile = false, sameRank = false, other = false;
      for (const o of this.legalMoves()) {
        if (o === m || mTo(o) !== to || mFrom(o) === from || Math.abs(this.b[mFrom(o)]) !== p) continue;
        other = true;
        if ((mFrom(o) & 7) === (from & 7)) sameFile = true;
        if ((mFrom(o) >> 4) === (from >> 4)) sameRank = true;
      }
      let dis = '';
      if (other) dis = !sameFile ? 'abcdefgh'[from & 7] : !sameRank ? String((from >> 4) + 1) : sqName(from);
      s = SAN_LETTER[p] + dis + (flags & F_CAPTURE ? 'x' : '') + sqName(to);
    }
    if (this.make(m)) {
      if (this.inCheck()) s += this.legalMoves().length ? '+' : '#';
      this.unmake();
    }
    return s;
  }

  /** neither side has the material to ever mate */
  deadPosition() {
    let minors = 0, bishops = [0, 0], knights = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const t = Math.abs(this.b[sq]);
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) knights++;
      else bishops[((sq >> 4) + (sq & 7)) & 1]++;
    }
    if (minors <= 1) return true;
    return knights === 0 && (bishops[0] === 0 || bishops[1] === 0);
  }

  /** Is the game over here? keys = every position's key so far, this one included.
      { over, winner: WHITE | BLACK | 0, reason: 'checkmate' | 'stalemate' | 'threefold' | 'fifty' | 'material' } */
  outcome(keys = []) {
    if (!this.legalMoves().length) return this.inCheck() ? { over: true, winner: -this.turn, reason: 'checkmate' } : { over: true, winner: 0, reason: 'stalemate' };
    if (this.deadPosition()) return { over: true, winner: 0, reason: 'material' };
    if (this.half >= 100) return { over: true, winner: 0, reason: 'fifty' };
    const k = this.key();
    let n = 0;
    for (const x of keys) if (x === k) n++;
    if (n >= 3) return { over: true, winner: 0, reason: 'threefold' };
    return { over: false, winner: 0, reason: '' };
  }
}

/** count the leaf nodes of the legal move tree to `depth` (the move generator's standard test) */
export function perft(pos, depth) {
  if (depth === 0) return 1;
  const list = pos.gen([]);
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (!pos.make(list[i])) continue;
    n += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake();
  }
  return n;
}

/* ============================== the engine ============================== */
const VAL = [0, 100, 320, 330, 500, 900, 0];
/* a8 … h8 first, as White sees the board */
const PST = [null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
];
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const pstIx = (sq, white) => (white ? (7 - (sq >> 4)) * 8 : (sq >> 4) * 8) + (sq & 7);
const centerDist = sq => Math.max(3 - (sq >> 4), (sq >> 4) - 4) + Math.max(3 - (sq & 7), (sq & 7) - 4);

/** static evaluation, in centipawns, for the side to move */
export function evaluate(pos) {
  const b = pos.b;
  let mg = 0, phase = 0, matW = 0, matB = 0, pawnsW = 0, pawnsB = 0, kingMg = 0, kingEg = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const t = p > 0 ? p : -p, white = p > 0, sign = white ? 1 : -1;
    phase += PHASE[t];
    if (t === KING) {
      kingMg += sign * PST[KING][pstIx(sq, white)];
      kingEg += sign * KING_END[pstIx(sq, white)];
      continue;
    }
    mg += sign * (VAL[t] + PST[t][pstIx(sq, white)]);
    if (white) { matW += VAL[t]; if (t === PAWN) pawnsW++; } else { matB += VAL[t]; if (t === PAWN) pawnsB++; }
  }
  const ph = Math.min(24, phase);
  let score = mg + (kingMg * ph + kingEg * (24 - ph)) / 24;
  /* mop-up: the stronger side, with nothing left to fight it, herds the lone king to the edge */
  const lead = matW - matB;
  if (Math.abs(lead) >= 400 && ph <= 8) {
    const strong = lead > 0 ? WHITE : BLACK;
    const loser = strong === WHITE ? pos.kb : pos.kw, winner = strong === WHITE ? pos.kw : pos.kb;
    const weakPawns = strong === WHITE ? pawnsB : pawnsW;
    if (!weakPawns) {
      const near = 14 - (Math.abs((loser >> 4) - (winner >> 4)) + Math.abs((loser & 7) - (winner & 7)));
      score += strong * (10 * centerDist(loser) + 4 * near);
    }
  }
  return Math.round(score) * pos.turn;
}

const MATE = 100000;
const INF = 1e9;
class Stop extends Error {}

/**
 * Pick a move. opts: { maxDepth, timeMs, noise, history: [keys of earlier positions], rnd, nodes }
 * Returns { move, uci, score, depth, nodes, ms } (move 0 when there is no legal move).
 */
export function think(pos, opts = {}) {
  const maxDepth = Math.max(1, Math.min(64, opts.maxDepth || 64));
  const timeMs = Math.max(30, opts.timeMs || 1000);
  const noise = Math.max(0, opts.noise || 0);
  const rnd = typeof opts.rnd === 'function' ? opts.rnd : Math.random;
  const nodeCap = opts.nodes || Infinity;
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const t0 = clock();
  const deadline = t0 + timeMs;
  let nodes = 0, armed = false;
  const tt = new Map();
  const killers = [];
  const hist = new Int32Array(128 * 128);
  /* positions since the last pawn move or capture, for repetition */
  const path = (Array.isArray(opts.history) ? opts.history : []).slice(-Math.max(0, pos.half + 1));

  const root = pos.legalMoves();
  if (!root.length) return { move: 0, uci: '', score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0, ms: 0 };
  if (root.length === 1) return { move: root[0], uci: uci(root[0]), score: 0, depth: 0, nodes: 0, ms: Math.round(clock() - t0) };

  /* the clock is read only in search(), whose finally blocks put the board back
     when time runs out — quiescence never throws */
  let checks = 0;
  const tick = () => { nodes++; };
  const timeUp = () => {
    if (armed && (++checks & 127) === 0 && (clock() > deadline || nodes > nodeCap)) throw new Stop();
  };
  const order = (list, ttMove, ply) => {
    const k = killers[ply] || [0, 0];
    const scores = list.map(m => {
      if (m === ttMove) return 1e7;
      const f = mFlags(m);
      if (f & F_CAPTURE) {
        const victim = f & F_EP ? PAWN : Math.abs(pos.b[mTo(m)]);
        return 1e6 + VAL[victim] * 10 - VAL[Math.abs(pos.b[mFrom(m)])] / 10 + (f & F_PROMO ? VAL[mPromo(m)] : 0);
      }
      if (f & F_PROMO) return 9e5 + VAL[mPromo(m)];
      if (m === k[0]) return 8e5;
      if (m === k[1]) return 7e5;
      return hist[(m & 127) * 128 + ((m >> 7) & 127)];
    });
    const ix = list.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    return ix.map(i => list[i]);
  };

  function quiesce(alpha, beta, ply) {
    tick();
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 40) return stand;
    const list = order(pos.gen([], true), 0, ply);
    for (const m of list) {
      if (!pos.make(m)) continue;
      const s = -quiesce(-beta, -alpha, ply + 1);
      pos.unmake();
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function search(depth, alpha, beta, ply) {
    tick();
    timeUp();
    const key = pos.key();
    if (ply > 0) {
      if (pos.half >= 100) return 0;
      for (let i = path.length - 2; i >= 0 && i >= path.length - 1 - pos.half; i -= 2) if (path[i] === key) return 0;
    }
    const check = pos.inCheck();
    if (check && ply < 30) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    const e = tt.get(key);
    let ttMove = 0;
    if (e) {
      ttMove = e.move;
      if (ply > 0 && e.depth >= depth) {
        if (e.flag === 0) return e.score;
        if (e.flag === 1 && e.score >= beta) return e.score;
        if (e.flag === 2 && e.score <= alpha) return e.score;
      }
    }
    const a0 = alpha;
    let best = -INF, bestMove = 0, legal = 0;
    for (const m of order(pos.gen([]), ttMove, ply)) {
      if (!pos.make(m)) continue;
      legal++;
      path.push(key);
      let s;
      try { s = -search(depth - 1, -beta, -alpha, ply + 1); } finally { path.pop(); pos.unmake(); }
      if (s > best) { best = s; bestMove = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!(mFlags(m) & (F_CAPTURE | F_PROMO))) {
          const k = killers[ply] || (killers[ply] = [0, 0]);
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
          hist[(m & 127) * 128 + ((m >> 7) & 127)] += depth * depth;
        }
        break;
      }
    }
    if (!legal) return check ? -MATE + ply : 0;
    if (Math.abs(best) < MATE - 1000 && tt.size < 400000) {
      tt.set(key, { depth, score: best, move: bestMove, flag: best <= a0 ? 2 : best >= beta ? 1 : 0 });
    }
    return best;
  }

  let bestMove = root[0], bestScore = -INF, done = 0;
  let rootList = order(root, 0, 0);
  for (let depth = 1; depth <= maxDepth; depth++) {
    armed = depth > 1;
    try {
      const scored = [];
      let alpha = -INF;
      const rootKey = pos.key();
      for (const m of rootList) {
        pos.make(m);
        path.push(rootKey);
        let s;
        try { s = -search(depth - 1, -INF, noise ? INF : -alpha, 1); } finally { path.pop(); pos.unmake(); }
        scored.push({ m, s });
        if (s > alpha) alpha = s;
      }
      let pick = scored[0];
      if (noise) {
        let top = -INF;
        for (const x of scored) {
          const v = x.s + (Math.abs(x.s) < MATE - 1000 ? (rnd() * 2 - 1) * noise : 0);
          if (v > top) { top = v; pick = x; }
        }
      } else for (const x of scored) if (x.s > pick.s) pick = x;
      bestMove = pick.m;
      bestScore = pick.s;
      done = depth;
      /* the next depth looks at this one's best first */
      rootList = [bestMove, ...rootList.filter(m => m !== bestMove)];
      if (Math.abs(bestScore) >= MATE - 1000 && !noise) break;     /* a forced mate is found */
      if (clock() > t0 + timeMs * 0.55) break;                       /* the next depth would not finish */
    } catch (err) {
      if (!(err instanceof Stop)) throw err;
      break;
    }
  }
  return { move: bestMove, uci: uci(bestMove), score: bestScore, depth: done, nodes, ms: Math.round(clock() - t0) };
}

/** the three computer levels (the same everywhere: worker, fallback, tests) */
export const LEVELS = {
  1: { name: 'Easy', maxDepth: 1, timeMs: 400, noise: 120 },
  2: { name: 'Medium', maxDepth: 3, timeMs: 1000, noise: 25 },
  3: { name: 'Hard', maxDepth: 64, timeMs: 2200, noise: 0 },
};

export default { Position, perft, think, evaluate, START_FEN, KIWIPETE, LEVELS, uci, sqName, sqOf };
