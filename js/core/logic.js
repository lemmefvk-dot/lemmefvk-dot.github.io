/* ============================================================
   logic.js — a logic-gate network and its truth tables. No DOM;
   unit-tested.

   A network is a list of parts, each with an id:
     { id, type: 'in', name, value }              a switch
     { id, type: 'and'|'or'|'nand'|'nor'|'xor'|'xnor', a, b }   a gate: a and b are ids
     { id, type: 'not', a }
     { id, type: 'out', name, a }                 a lamp
   Wires are those ids. A part may only read parts that do not read it
   back (no loops), which `wouldLoop` checks.
   ============================================================ */

export const GATES = {
  and: { name: 'AND', f: (a, b) => a & b },
  or: { name: 'OR', f: (a, b) => a | b },
  nand: { name: 'NAND', f: (a, b) => (a & b) ^ 1 },
  nor: { name: 'NOR', f: (a, b) => (a | b) ^ 1 },
  xor: { name: 'XOR', f: (a, b) => a ^ b },
  xnor: { name: 'XNOR', f: (a, b) => (a ^ b) ^ 1 },
  not: { name: 'NOT', f: a => a ^ 1, one: true },
};

/** The ids a part reads from. */
export const inputsOf = p => (p.type === 'in' ? [] : p.type === 'not' || p.type === 'out' ? [p.a] : [p.a, p.b]).filter(x => x != null && x !== '');

/** Would wiring `from` into `to` make a loop (does `from` depend on `to`)? */
export function wouldLoop(parts, from, to) {
  if (from === to) return true;
  const byId = new Map(parts.map(p => [p.id, p]));
  const seen = new Set();
  const walk = id => {
    if (id === to) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const p = byId.get(id);
    return p ? inputsOf(p).some(walk) : false;
  };
  return walk(from);
}

/** Work out every part's value. `overrides` replaces switch values
    ({ id: 0|1 }). An input left unwired reads as 0. Returns { id: 0|1 }. */
export function evaluate(parts, overrides = {}) {
  const byId = new Map(parts.map(p => [p.id, p]));
  const val = {};
  const get = id => {
    if (id == null || id === '') return 0;
    if (id in val) return val[id];
    const p = byId.get(id);
    if (!p) return 0;
    val[id] = 0;                                    /* a loop, if one slipped in, reads 0 */
    let v;
    if (p.type === 'in') v = id in overrides ? overrides[id] : p.value ? 1 : 0;
    else if (p.type === 'out') v = get(p.a);
    else if (p.type === 'not') v = GATES.not.f(get(p.a));
    else v = GATES[p.type].f(get(p.a), get(p.b));
    return (val[id] = v);
  };
  for (const p of parts) get(p.id);
  return val;
}

/** The full truth table: one row per combination of the switches (first
    switch is the leftmost, most significant column, counting up from all
    zeros), with each lamp's value. Up to 8 switches. */
export function truthTable(parts) {
  const ins = parts.filter(p => p.type === 'in'), outs = parts.filter(p => p.type === 'out');
  if (ins.length > 8) return null;
  const rows = [];
  for (let k = 0; k < 1 << ins.length; k++) {
    const o = {};
    const inputs = ins.map((p, i) => { const b = (k >> (ins.length - 1 - i)) & 1; o[p.id] = b; return b; });
    const v = evaluate(parts, o);
    rows.push({ inputs, outputs: outs.map(p => v[p.id]) });
  }
  return { inputs: ins.map(p => p.name), outputs: outs.map(p => p.name), rows };
}

/** The two-input (or one-input) table of a single gate. */
export function gateTable(type) {
  const g = GATES[type];
  if (g.one) return [[0, g.f(0)], [1, g.f(1)]];
  return [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => [a, b, g.f(a, b)]);
}

/** Ready-made networks. */
export const EXAMPLES = {
  half: { name: 'Half adder', parts: [
    { id: 'A', type: 'in', name: 'A', value: 0 }, { id: 'B', type: 'in', name: 'B', value: 0 },
    { id: 'g1', type: 'xor', a: 'A', b: 'B' }, { id: 'g2', type: 'and', a: 'A', b: 'B' },
    { id: 'S', type: 'out', name: 'Sum', a: 'g1' }, { id: 'C', type: 'out', name: 'Carry', a: 'g2' },
  ] },
  full: { name: 'Full adder', parts: [
    { id: 'A', type: 'in', name: 'A', value: 0 }, { id: 'B', type: 'in', name: 'B', value: 0 }, { id: 'Ci', type: 'in', name: 'Cin', value: 0 },
    { id: 'x1', type: 'xor', a: 'A', b: 'B' }, { id: 'x2', type: 'xor', a: 'x1', b: 'Ci' },
    { id: 'a1', type: 'and', a: 'A', b: 'B' }, { id: 'a2', type: 'and', a: 'x1', b: 'Ci' }, { id: 'o1', type: 'or', a: 'a1', b: 'a2' },
    { id: 'S', type: 'out', name: 'Sum', a: 'x2' }, { id: 'Co', type: 'out', name: 'Cout', a: 'o1' },
  ] },
  xorNand: { name: 'XOR from four NANDs', parts: [
    { id: 'A', type: 'in', name: 'A', value: 0 }, { id: 'B', type: 'in', name: 'B', value: 0 },
    { id: 'n1', type: 'nand', a: 'A', b: 'B' }, { id: 'n2', type: 'nand', a: 'A', b: 'n1' }, { id: 'n3', type: 'nand', a: 'B', b: 'n1' },
    { id: 'n4', type: 'nand', a: 'n2', b: 'n3' }, { id: 'Q', type: 'out', name: 'Q', a: 'n4' },
  ] },
};
