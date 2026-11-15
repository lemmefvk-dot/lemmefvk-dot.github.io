/* ============================================================
   arcade/chess-puzzles.js — ten mate-in-two puzzles for the Arcade's
   chess (./chess.js, Puzzles).

   White to move and mate in two, every time. These positions were
   found for StaticOS by a search over random positions (not copied
   from any collection), and each one was kept only because the rules
   engine proves it: no mate in one, a forced mate in two, and exactly
   one first move (the key) that forces it. tests/suites/
   boardcards-chess.mjs proves all three again with mateKeys() in
   ./chess-rules.js, so a puzzle that stopped being one would fail.
   Roughly easiest first: the first two start with a check.
   ============================================================ */
export const PUZZLES = [
  { id: 'p1', fen: '6k1/3q1ppp/p5B1/8/1R1b1P2/8/3N4/5N1K w - - 0 1' },
  { id: 'p2', fen: '8/p4k2/5pp1/R1N5/8/8/7Q/3K4 w - - 0 1' },
  { id: 'p3', fen: '1k6/pp1p4/8/8/3QB3/8/6K1/8 w - - 0 1' },
  { id: 'p4', fen: '4k3/5ppR/R3p3/8/8/1P6/7K/8 w - - 0 1' },
  { id: 'p5', fen: '6k1/8/1P2pp1p/3R4/8/R7/3K4/8 w - - 0 1' },
  { id: 'p6', fen: 'r1k5/ppp5/3pR3/8/8/2Q5/6K1/8 w - - 0 1' },
  { id: 'p7', fen: '7k/2p4B/3p2p1/8/8/5QP1/6K1/8 w - - 0 1' },
  { id: 'p8', fen: 'k7/pp4B1/8/1P6/Q4p2/P7/2K2P2/8 w - - 0 1' },
  { id: 'p9', fen: '3B2Nk/4R2p/2b3p1/3p3P/8/8/K7/8 w - - 0 1' },
  { id: 'p10', fen: 'N6k/6pp/4N3/8/5b1p/8/5Q2/5K2 w - - 0 1' },
];

export default PUZZLES;
