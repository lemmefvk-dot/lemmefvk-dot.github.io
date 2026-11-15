/* ============================================================
   arcade/crate-levels.js — the twelve warehouses of Crate Shift.

   Made by a generator that runs the pushes backwards from a solved
   board (so every level can be solved), and each par is the fewest
   moves a search over every walker-and-crate position finds. The
   suite solves every level again with ./crate-logic.js and checks the
   par and that a way through exists.
   #  wall · space · .  goal · $  crate · *  crate on a goal · @  walker · +  walker on a goal
   ============================================================ */
export const LEVELS = [
  { par: 4, rows: ["#####", "# .@#", "# $ #", "##  #", "#####"] },
  { par: 12, rows: ["######", "#  #@#", "#  $ #", "#  .##", "######"] },
  { par: 17, rows: ["######", "#@ ###", "#  $ #", "#  . #", "######"] },
  { par: 25, rows: ["######", "##   #", "# .#$#", "#@ $.#", "#    #", "######"] },
  { par: 33, rows: ["######", "#  #.#", "# $$+#", "# $  #", "# . ##", "######"] },
  { par: 34, rows: ["#######", "#  . .#", "# $ $ #", "# @## #", "#######"] },
  { par: 34, rows: ["######", "#  + #", "##$. #", "#  $ #", "#   ##", "######"] },
  { par: 38, rows: ["#######", "#    ##", "##.$$@#", "# . # #", "#     #", "#######"] },
  { par: 38, rows: ["#######", "## # @#", "# $ $ #", "# .   #", "#. ## #", "#######"] },
  { par: 45, rows: ["#######", "#  ..@#", "#  # ##", "# $$  #", "# $. ##", "#######"] },
  { par: 55, rows: ["#######", "#    ##", "# #  .#", "# #$ ##", "# @$ .#", "#  .$ #", "#######"] },
  { par: 76, rows: ["#######", "#  ## #", "#.$ $ #", "# .   #", "#$##  #", "#@  . #", "#######"] },
];
