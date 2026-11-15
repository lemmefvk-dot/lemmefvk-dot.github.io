/* ============================================================
   mini3d.js — a small software 3D drawer for the 3D viewer and Voxel Studio.

   It draws triangles on a 2D canvas: no WebGL, no library. Every triangle is
   projected through an orbit camera, shaded flat by its angle to a light that
   sits over the camera's shoulder, sorted far to near and filled. That is
   plenty for models of tens of thousands of triangles and works wherever a
   canvas does. While a person is dragging, a very large model is drawn with
   only some of its triangles and filled in again on release.

   A mesh is { pos: Float32Array (9 numbers per triangle), col?: Uint8Array
   (3 per triangle, rgb) }. World is Y up.

     createCamera({ yaw, pitch, dist, target })
     frame(cam, bounds)             aim and back off to fit a bounding box
     orbit(cam, dx, dy)  pan(cam, dx, dy, h)  zoom(cam, factor)
     project(cam, p, w, h)          [sx, sy, depth] or null behind the eye
     ray(cam, sx, sy, w, h)         { o, d } in the world
     draw(ctx, w, h, mesh, cam, opts)
   ============================================================ */

const FOV = 0.9;                         /* vertical field of view, radians */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function createCamera(o = {}) {
  return { yaw: o.yaw ?? 0.7, pitch: o.pitch ?? 0.5, dist: o.dist ?? 6, target: o.target ? o.target.slice() : [0, 0, 0] };
}

/** eye position and the three axes of the camera */
export function basis(cam) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * sp, cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
  const fwd = norm(sub(cam.target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, fwd, right, up };
}

export function frame(cam, b) {
  cam.target = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.max(0.0001, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
  cam.dist = r / Math.sin(FOV / 2) * 1.05;
  return cam;
}
export function orbit(cam, dx, dy) {
  cam.yaw -= dx * 0.01;
  cam.pitch = clamp(cam.pitch + dy * 0.01, -1.5, 1.5);
}
export function pan(cam, dx, dy, h) {
  const { right, up } = basis(cam);
  const k = (2 * cam.dist * Math.tan(FOV / 2)) / (h || 500);
  for (let i = 0; i < 3; i++) cam.target[i] += (-dx * right[i] + dy * up[i]) * k;
}
export function zoom(cam, f) { cam.dist = clamp(cam.dist * f, 0.01, 1e6); }

export function project(cam, p, w, h, B) {
  const { eye, fwd, right, up } = B || basis(cam);
  const d = sub(p, eye);
  const z = dot(d, fwd);
  if (z < 0.01) return null;
  const f = (h / 2) / Math.tan(FOV / 2);
  return [w / 2 + f * dot(d, right) / z, h / 2 - f * dot(d, up) / z, z];
}

export function ray(cam, sx, sy, w, h) {
  const { eye, fwd, right, up } = basis(cam);
  const f = (h / 2) / Math.tan(FOV / 2);
  const x = (sx - w / 2) / f, y = -(sy - h / 2) / f;
  return { o: eye, d: norm([fwd[0] + right[0] * x + up[0] * y, fwd[1] + right[1] * x + up[1] * y, fwd[2] + right[2] * x + up[2] * y]) };
}

const styleCache = new Map();
function shadeStyle(rgb, level) {
  const key = (rgb[0] << 16 | rgb[1] << 8 | rgb[2]) * 64 + level;
  let s = styleCache.get(key);
  if (!s) {
    const k = 0.32 + 0.68 * (level / 31);
    s = `rgb(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)})`;
    if (styleCache.size > 60000) styleCache.clear();
    styleCache.set(key, s);
  }
  return s;
}

/**
 * Draw a mesh. opts: { color: [r,g,b] default, wire: bool, maxTris: number
 * (draw only a spread of this many when the mesh is larger) }.
 * Returns how many triangles it filled.
 */
export function draw(ctx, w, h, mesh, cam, opts = {}) {
  const pos = mesh.pos, n = Math.floor(pos.length / 9);
  if (!n) return 0;
  const { eye, fwd, right, up } = basis(cam);
  const f = (h / 2) / Math.tan(FOV / 2);
  const step = opts.maxTris && n > opts.maxTris ? Math.ceil(n / opts.maxTris) : 1;
  const lx = eye[0] - cam.target[0] + right[0] * cam.dist * 0.5 + up[0] * cam.dist * 0.6;
  const ly = eye[1] - cam.target[1] + right[1] * cam.dist * 0.5 + up[1] * cam.dist * 0.6;
  const lz = eye[2] - cam.target[2] + right[2] * cam.dist * 0.5 + up[2] * cam.dist * 0.6;
  const ll = Math.hypot(lx, ly, lz) || 1;
  const light = [lx / ll, ly / ll, lz / ll];
  const base = opts.color || [150, 170, 255];
  const sx = new Float32Array(3), sy = new Float32Array(3);
  const cap = Math.ceil(n / step);
  const keep = new Uint32Array(cap);
  const depth = new Float32Array(cap);
  const screen = new Float32Array(cap * 6);
  const shade = new Uint8Array(cap);
  let m = 0;
  for (let t = 0; t < n; t += step) {
    const o = t * 9;
    let zsum = 0, ok = true;
    for (let v = 0; v < 3; v++) {
      const dx = pos[o + v * 3] - eye[0], dy = pos[o + v * 3 + 1] - eye[1], dz = pos[o + v * 3 + 2] - eye[2];
      const z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
      if (z < 0.01) { ok = false; break; }
      sx[v] = w / 2 + f * (dx * right[0] + dy * right[1] + dz * right[2]) / z;
      sy[v] = h / 2 - f * (dx * up[0] + dy * up[1] + dz * up[2]) / z;
      zsum += z;
    }
    if (!ok) continue;
    /* off screen entirely */
    if ((sx[0] < 0 && sx[1] < 0 && sx[2] < 0) || (sx[0] > w && sx[1] > w && sx[2] > w) || (sy[0] < 0 && sy[1] < 0 && sy[2] < 0) || (sy[0] > h && sy[1] > h && sy[2] > h)) continue;
    /* flat shade from the face normal, lit from both sides so open meshes read */
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
    const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) continue;                       /* a sliver with no area */
    const lam = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / nl);
    const s = m * 6;
    screen[s] = sx[0]; screen[s + 1] = sy[0]; screen[s + 2] = sx[1]; screen[s + 3] = sy[1]; screen[s + 4] = sx[2]; screen[s + 5] = sy[2];
    shade[m] = Math.round(lam * 31);
    keep[m] = t;
    depth[m] = zsum / 3;
    m++;
  }
  const order = new Uint32Array(m);
  for (let i = 0; i < m; i++) order[i] = i;
  order.sort((a, b) => depth[b] - depth[a]);
  ctx.lineJoin = 'round';
  const wire = !!opts.wire;
  if (wire) { ctx.lineWidth = 1; ctx.strokeStyle = shadeStyle(base, 28); ctx.beginPath(); }
  else ctx.lineWidth = 0.8;
  const c = [0, 0, 0];
  for (let k = 0; k < m; k++) {
    const i = order[k], s = i * 6;
    if (wire) { ctx.moveTo(screen[s], screen[s + 1]); ctx.lineTo(screen[s + 2], screen[s + 3]); ctx.lineTo(screen[s + 4], screen[s + 5]); ctx.closePath(); continue; }
    let rgb = base;
    if (mesh.col) { c[0] = mesh.col[keep[i] * 3]; c[1] = mesh.col[keep[i] * 3 + 1]; c[2] = mesh.col[keep[i] * 3 + 2]; rgb = c; }
    const st = shadeStyle(rgb, shade[i]);
    ctx.fillStyle = st; ctx.strokeStyle = st;
    ctx.beginPath();
    ctx.moveTo(screen[s], screen[s + 1]); ctx.lineTo(screen[s + 2], screen[s + 3]); ctx.lineTo(screen[s + 4], screen[s + 5]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (wire) ctx.stroke();
  return m;
}

export default { createCamera, basis, frame, orbit, pan, zoom, project, ray, draw };
