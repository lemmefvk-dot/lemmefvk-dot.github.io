/* ============================================================
   circuit.js — solves a DC circuit of batteries, resistors, bulbs
   and switches by modified nodal analysis. No DOM; unit-tested
   against worked answers.

   A circuit is a list of parts joined at numbered nodes; node 0 is
   the ground (0 V):
     { id, type: 'battery', a, b, value }   volts; the + side is node a
     { id, type: 'resistor', a, b, value }  ohms
     { id, type: 'bulb', a, b, value, rated } ohms (hot), rated watts
     { id, type: 'switch', a, b, closed }
   A closed switch is a plain wire (its two nodes become one); an open one
   is left out. Bulbs are treated as fixed resistors: real filaments
   change resistance as they heat, which is not modelled.

   Method: for every node but ground, the currents leaving it add up to
   zero (Kirchhoff's current law), with conductance 1/R per resistor;
   each battery adds an unknown current and the equation V(a) - V(b) = E.
   The system is solved by Gaussian elimination with partial pivoting.
   Nodes with no path to ground are reported as floating, not solved.
   ============================================================ */

export const TYPES = { battery: 'Battery', resistor: 'Resistor', bulb: 'Bulb', switch: 'Switch' };

/** Solve it. Returns { ok, error?, volts: {node: V}, parts: {id: { v, i, p, glow? }}, floating: [nodes] }
    where for each part v is the drop from node a to node b and i the current
    from a to b through it. A battery is the exception: its i is the current it
    pushes out of its + side (positive while it is supplying power) and its p
    the power it supplies. */
export function solve(parts) {
  /* closed switches merge nodes */
  const parent = new Map();
  const find = n => { while (parent.has(n) && parent.get(n) !== n) n = parent.get(n); return n; };
  const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent.set(Math.max(rx, ry), Math.min(rx, ry)); };
  for (const p of parts) if (p.type === 'switch' && p.closed) union(p.a, p.b);
  const N = n => find(n);

  const live = parts.filter(p => p.type !== 'switch');
  for (const p of live) {
    if (!Number.isFinite(p.value)) return { ok: false, error: `${TYPES[p.type]} ${p.id} needs a number.` };
    if ((p.type === 'resistor' || p.type === 'bulb') && !(p.value > 0)) return { ok: false, error: `${TYPES[p.type]} ${p.id} must be more than 0 ohms.` };
  }
  /* which nodes are connected to ground through live parts and closed switches */
  const adj = new Map();
  const link = (x, y) => { (adj.get(x) || adj.set(x, []).get(x)).push(y); (adj.get(y) || adj.set(y, []).get(y)).push(x); };
  for (const p of live) link(N(p.a), N(p.b));
  const reach = new Set([0]);
  const queue = [0];
  while (queue.length) for (const m of adj.get(queue.pop()) || []) if (!reach.has(m)) { reach.add(m); queue.push(m); }
  const allNodes = [...new Set(parts.flatMap(p => [p.a, p.b]))].sort((x, y) => x - y);
  const floating = allNodes.filter(n => !reach.has(N(n)));

  const nodes = [...new Set(live.flatMap(p => [N(p.a), N(p.b)]))].filter(n => n !== 0 && reach.has(n)).sort((x, y) => x - y);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const bats = live.filter(p => p.type === 'battery' && reach.has(N(p.a)));
  const size = nodes.length + bats.length;
  const M = Array.from({ length: size }, () => new Array(size + 1).fill(0));
  for (const p of live) {
    if (p.type === 'battery' || !reach.has(N(p.a))) continue;
    const g = 1 / p.value, ia = idx.get(N(p.a)), ib = idx.get(N(p.b));
    if (ia !== undefined) { M[ia][ia] += g; if (ib !== undefined) M[ia][ib] -= g; }
    if (ib !== undefined) { M[ib][ib] += g; if (ia !== undefined) M[ib][ia] -= g; }
  }
  bats.forEach((p, k) => {
    const row = nodes.length + k, ia = idx.get(N(p.a)), ib = idx.get(N(p.b));
    /* the unknown is the current leaving node a through the battery */
    if (ia !== undefined) { M[ia][nodes.length + k] += 1; M[row][ia] += 1; }
    if (ib !== undefined) { M[ib][nodes.length + k] -= 1; M[row][ib] -= 1; }
    M[row][size] = p.value;
  });

  let x = [];
  if (size) {
    for (let c = 0; c < size; c++) {
      let piv = c;
      for (let r = c + 1; r < size; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return { ok: false, error: 'This circuit has no single answer: a battery is joined straight across another battery or a bare wire.', floating };
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < size; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (f) for (let k = c; k <= size; k++) M[r][k] -= f * M[c][k];
      }
    }
    x = M.map((row, i) => row[size] / row[i]);
  }
  const V = n => { const m = N(n); return m === 0 || !idx.has(m) ? 0 : x[idx.get(m)]; };
  const volts = {};
  for (const n of allNodes) volts[n] = reach.has(N(n)) ? V(n) : null;

  const out = {};
  for (const p of parts) {
    if (p.type === 'switch') {
      /* the current through a closed switch is whatever flows in the merged node; not solved separately */
      out[p.id] = { v: 0, i: null, p: null, closed: !!p.closed };
      continue;
    }
    if (!reach.has(N(p.a))) { out[p.id] = { v: null, i: 0, p: 0, glow: 0, floating: true }; continue; }
    const v = V(p.a) - V(p.b);
    if (p.type === 'battery') {
      /* x is the current into the + side; delivered into the circuit is its opposite */
      const i = -x[nodes.length + bats.indexOf(p)];
      out[p.id] = { v, i, p: v * i, delivering: i > 0 };
      continue;
    }
    const i = v / p.value;
    const r = { v, i, p: v * i };
    if (p.type === 'bulb') r.glow = Math.min(1, r.p / (p.rated || 1));
    out[p.id] = r;
  }
  return { ok: true, volts, parts: out, floating };
}

export const EXAMPLES = {
  series: { name: 'Two resistors in series', parts: [
    { id: 'B1', type: 'battery', a: 1, b: 0, value: 9 },
    { id: 'R1', type: 'resistor', a: 1, b: 2, value: 100 },
    { id: 'R2', type: 'resistor', a: 2, b: 0, value: 200 },
  ] },
  parallel: { name: 'Two resistors in parallel', parts: [
    { id: 'B1', type: 'battery', a: 1, b: 0, value: 12 },
    { id: 'R1', type: 'resistor', a: 1, b: 0, value: 4 },
    { id: 'R2', type: 'resistor', a: 1, b: 0, value: 6 },
  ] },
  bulbs: { name: 'Two bulbs, one switch', parts: [
    { id: 'B1', type: 'battery', a: 1, b: 0, value: 6 },
    { id: 'S1', type: 'switch', a: 1, b: 2, closed: true },
    { id: 'L1', type: 'bulb', a: 2, b: 0, value: 12, rated: 3 },
    { id: 'L2', type: 'bulb', a: 2, b: 0, value: 12, rated: 3 },
  ] },
  bridge: { name: 'Bridge circuit', parts: [
    { id: 'B1', type: 'battery', a: 1, b: 0, value: 10 },
    { id: 'R1', type: 'resistor', a: 1, b: 2, value: 100 },
    { id: 'R2', type: 'resistor', a: 2, b: 0, value: 200 },
    { id: 'R3', type: 'resistor', a: 1, b: 3, value: 300 },
    { id: 'R4', type: 'resistor', a: 3, b: 0, value: 100 },
    { id: 'R5', type: 'resistor', a: 2, b: 3, value: 100 },
  ] },
};
