/* ============================================================
   meshfile.js — 3D model files, read and written.

   parseSTL(buffer)   ASCII and binary STL → { pos, count, format }
                      (a binary file can begin with the word "solid", so the
                      byte count the header promises decides, not the word)
   parseOBJ(text)     Wavefront OBJ → { pos, col?, count, skipped }
                      v / f lines only: faces of any size are fanned into
                      triangles, negative indices count back from the end,
                      v/vt/vn forms work, and a vertex written "x y z r g b"
                      gives the triangle its colour. Materials, normals and
                      texture coordinates are ignored.
   bounds(pos)        { min, max, size, center }
   quadsToOBJ(quads)  the OBJ text for coloured quads, as Voxel Studio
                      exports them
   ============================================================ */

export function parseSTL(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) {
      const pos = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50 + 12;                      /* skip the facet normal */
        for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return { pos, count: n, format: 'binary' };
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/i.test(text)) throw new Error('That is not an STL file.');
  const nums = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  const count = Math.floor(nums.length / 9);
  if (!count) throw new Error('That STL has no triangles.');
  const pos = Float32Array.from(nums.slice(0, count * 9));
  if (pos.some(v => !Number.isFinite(v))) throw new Error('That STL has broken numbers in it.');
  return { pos, count, format: 'ascii' };
}

export function parseOBJ(text) {
  const verts = [], cols = [];
  const out = [], outCol = [];
  let skipped = 0, anyColor = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^v\s/.test(line)) {                                          /* v x y z [r g b] */
      const p = line.split(/\s+/).slice(1).map(Number);
      if (p.length < 3 || p.slice(0, 3).some(v => !Number.isFinite(v))) { verts.push(null); cols.push(null); continue; }
      verts.push([p[0], p[1], p[2]]);
      if (p.length >= 6 && p.slice(3, 6).every(Number.isFinite)) { cols.push(p.slice(3, 6).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255))); anyColor = true; } else cols.push(null);
    } else if (/^f\s/.test(line)) {
      const ids = line.split(/\s+/).slice(1).map(tok => {
        const i = parseInt(tok.split('/')[0], 10);
        if (!Number.isInteger(i) || i === 0) return -1;
        return i > 0 ? i - 1 : verts.length + i;
      });
      if (ids.length < 3 || ids.some(i => i < 0 || i >= verts.length || !verts[i])) { skipped++; continue; }
      for (let k = 1; k < ids.length - 1; k++) {
        for (const i of [ids[0], ids[k], ids[k + 1]]) out.push(...verts[i]);
        outCol.push(...(cols[ids[0]] || [200, 205, 220]));
      }
    }
  }
  const count = out.length / 9;
  if (!count) throw new Error(verts.length ? 'That OBJ has no faces I can draw.' : 'That is not an OBJ file.');
  return { pos: Float32Array.from(out), col: anyColor ? Uint8Array.from(outCol) : undefined, count, skipped };
}

export function bounds(pos) {
  if (!pos.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max, size: [0, 1, 2].map(k => max[k] - min[k]), center: [0, 1, 2].map(k => (min[k] + max[k]) / 2) };
}

/** quads: [{ v: [[x,y,z]×4], c: [r,g,b] 0-255 }] → OBJ text, one vertex per corner with its colour */
export function quadsToOBJ(quads, name = 'blocks') {
  const lines = ['# StaticOS Voxel Studio', `o ${String(name).replace(/\s+/g, '_')}`];
  let i = 1;
  const faces = [];
  for (const q of quads) {
    for (const p of q.v) lines.push(`v ${p[0]} ${p[1]} ${p[2]} ${(q.c[0] / 255).toFixed(3)} ${(q.c[1] / 255).toFixed(3)} ${(q.c[2] / 255).toFixed(3)}`);
    faces.push(`f ${i} ${i + 1} ${i + 2} ${i + 3}`);
    i += 4;
  }
  return lines.concat(faces).join('\n') + '\n';
}

export default { parseSTL, parseOBJ, bounds, quadsToOBJ };
