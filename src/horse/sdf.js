// Signed-distance primitives and smooth CSG used to sculpt the horse.
//
// The body is a list of anatomical primitives (ellipsoids and round cones)
// combined in order with smooth union / smooth subtraction. Each primitive also
// carries metadata used later when baking the mesh: which bones it follows,
// which way the hair lies on it and which material region it belongs to.

const DEG = Math.PI / 180;

export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// Rotation matrix (row-major 3x3) from Euler angles in degrees.
// Order: roll about X, then pitch about Z, then yaw about Y  (R = Ry * Rz * Rx).
export function eulerMatrix(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
  const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
  const cz = Math.cos(rz * DEG), sz = Math.sin(rz * DEG);
  // Rx
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Y, mul3(Z, X));
}

export function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

// Matrix whose first column is the unit vector `dir` (local X axis), second
// column is as close as possible to `up` (local Y).
export function basisFromAxis(dir, up = [0, 1, 0]) {
  const x = norm(dir);
  let z = cross(x, up);
  if (len(z) < 1e-6) z = cross(x, [1, 0, 0]);
  z = norm(z);
  const y = cross(z, x);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

export const len = (v) => Math.hypot(v[0], v[1], v[2]);
export const norm = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---------------------------------------------------------------------------
// Primitives. Each implements:
//   eval(x,y,z)  -> signed distance (approximate for ellipsoids)
//   param(x,y,z) -> 0..1 position along the primitive's main axis (for bone blending)
//   bc, br       -> bounding sphere centre / radius
// ---------------------------------------------------------------------------

export class Ellipsoid {
  constructor(c, r, m) {
    this.c = c;
    this.r = r;
    // m: row-major rotation local->world. We store its transpose for world->local.
    this.m = m;
    this.bc = c;
    this.br = Math.max(r[0], r[1], r[2]);
    this.axis = [m[0], m[3], m[6]];
  }
  eval(x, y, z) {
    const m = this.m;
    const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2];
    // world -> local: R^T * d
    const lx = (m[0] * dx + m[3] * dy + m[6] * dz) / this.r[0];
    const ly = (m[1] * dx + m[4] * dy + m[7] * dz) / this.r[1];
    const lz = (m[2] * dx + m[5] * dy + m[8] * dz) / this.r[2];
    const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const k1 = Math.sqrt(
      (lx * lx) / (this.r[0] * this.r[0]) +
        (ly * ly) / (this.r[1] * this.r[1]) +
        (lz * lz) / (this.r[2] * this.r[2])
    );
    if (k1 < 1e-9) return -Math.min(this.r[0], this.r[1], this.r[2]);
    return (k0 * (k0 - 1)) / k1;
  }
  param(x, y, z) {
    const m = this.m;
    const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2];
    const lx = (m[0] * dx + m[3] * dy + m[6] * dz) / this.r[0];
    return Math.min(1, Math.max(0, lx * 0.5 + 0.5));
  }
}

// Round cone (capsule with different end radii), exact SDF by I. Quilez.
// Optional lateral flattening: `flat` scales the distance across the axis in
// the direction `flatAxis` (e.g. 0.7 makes a cannon bone oval front-to-back).
export class RoundCone {
  constructor(a, b, ra, rb, flat = 1, flatAxis = [0, 0, 1]) {
    this.a = a;
    this.b = b;
    this.ra = ra;
    this.rb = rb;
    const ba = sub(b, a);
    this.ba = ba;
    this.l2 = dot(ba, ba);
    this.rr = ra - rb;
    this.a2 = this.l2 - this.rr * this.rr;
    this.il2 = 1 / this.l2;
    this.bc = lerp3(a, b, 0.5);
    this.br = Math.sqrt(this.l2) * 0.5 + Math.max(ra, rb);
    this.axis = norm(ba);
    this.flat = flat;
    if (flat !== 1) {
      // component of flatAxis perpendicular to the cone axis
      const fa = norm(sub(flatAxis, scale(this.axis, dot(flatAxis, this.axis))));
      this.fa = fa;
    }
  }
  eval(x, y, z) {
    let px = x - this.a[0], py = y - this.a[1], pz = z - this.a[2];
    if (this.flat !== 1) {
      const fa = this.fa;
      const d = px * fa[0] + py * fa[1] + pz * fa[2];
      const s = d / this.flat - d;
      px += fa[0] * s;
      py += fa[1] * s;
      pz += fa[2] * s;
    }
    const ba = this.ba, l2 = this.l2, rr = this.rr, a2 = this.a2, il2 = this.il2;
    const yv = px * ba[0] + py * ba[1] + pz * ba[2];
    const zv = yv - l2;
    const qx = px * l2 - ba[0] * yv, qy = py * l2 - ba[1] * yv, qz = pz * l2 - ba[2] * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    let d;
    if (Math.sign(zv) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - this.rb;
    else if (Math.sign(yv) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - this.ra;
    else d = (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - this.ra;
    return this.flat < 1 ? d * this.flat : d;
  }
  param(x, y, z) {
    const px = x - this.a[0], py = y - this.a[1], pz = z - this.a[2];
    const t = (px * this.ba[0] + py * this.ba[1] + pz * this.ba[2]) * this.il2;
    return Math.min(1, Math.max(0, t));
  }
}

// ---------------------------------------------------------------------------
// Field: ordered list of primitive "nodes" combined with smooth CSG, plus a
// block acceleration grid so each evaluation only touches nearby primitives.
// ---------------------------------------------------------------------------

export const OP_ADD = 0, OP_SUB = 1, OP_INT = 2;

export class Field {
  constructor(nodes, { clipY = 0, clipK = 0.006 } = {}) {
    this.nodes = nodes; // { prim, op, k, ... }
    this.clipY = clipY;
    this.clipK = clipK;
    this.accel = null;
  }

  // Full evaluation over a node list (array of node indices or null = all).
  evalList(list, x, y, z) {
    const nodes = this.nodes;
    let d = 1e9;
    const n = list ? list.length : nodes.length;
    for (let i = 0; i < n; i++) {
      const node = list ? nodes[list[i]] : nodes[i];
      const v = node.prim.eval(x, y, z);
      if (node.op === OP_ADD) d = smin(d, v, node.k);
      else if (node.op === OP_SUB) d = smax(d, -v, node.k);
      else d = smax(d, v, node.k);
    }
    // flat soles: clip everything below the ground plane
    return smax(d, this.clipY - y, this.clipK);
  }

  buildAccel(min, max, cell) {
    const nx = Math.ceil((max[0] - min[0]) / cell);
    const ny = Math.ceil((max[1] - min[1]) / cell);
    const nz = Math.ceil((max[2] - min[2]) / cell);
    const rad = (Math.sqrt(3) * cell) / 2;
    const lists = new Array(nx * ny * nz);
    const centerVal = new Float32Array(nx * ny * nz);
    const nodes = this.nodes;
    const vals = new Float64Array(nodes.length);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const cx = min[0] + (i + 0.5) * cell;
          const cy = min[1] + (j + 0.5) * cell;
          const cz = min[2] + (k + 0.5) * cell;
          let d = 1e9;
          for (let n = 0; n < nodes.length; n++) {
            const node = nodes[n];
            // cheap bounding-sphere reject for far primitives
            const bx = cx - node.prim.bc[0], by = cy - node.prim.bc[1], bz = cz - node.prim.bc[2];
            const bd = Math.sqrt(bx * bx + by * by + bz * bz) - node.prim.br;
            if (bd > 0.6) {
              vals[n] = bd;
            } else vals[n] = node.prim.eval(cx, cy, cz);
            const v = vals[n];
            if (node.op === OP_ADD) d = smin(d, v, node.k);
            else if (node.op === OP_SUB) d = smax(d, -v, node.k);
            else d = smax(d, v, node.k);
          }
          d = smax(d, this.clipY - cy, this.clipK);
          const list = [];
          const margin = 2.6 * rad;
          for (let n = 0; n < nodes.length; n++) {
            const node = nodes[n];
            const v = vals[n];
            if (node.op === OP_ADD) {
              if (v < d + margin + node.k) list.push(n);
            } else if (node.op === OP_SUB) {
              if (v < -d + margin + node.k) list.push(n);
            } else list.push(n);
          }
          const idx = i + nx * (j + ny * k);
          lists[idx] = Int32Array.from(list);
          centerVal[idx] = d;
        }
    this.accel = { min, max, cell, nx, ny, nz, lists, centerVal, rad };
  }

  listAt(x, y, z) {
    const a = this.accel;
    let i = Math.floor((x - a.min[0]) / a.cell);
    let j = Math.floor((y - a.min[1]) / a.cell);
    let k = Math.floor((z - a.min[2]) / a.cell);
    if (i < 0 || j < 0 || k < 0 || i >= a.nx || j >= a.ny || k >= a.nz) return null;
    return a.lists[i + a.nx * (j + a.ny * k)];
  }

  eval(x, y, z) {
    const list = this.accel ? this.listAt(x, y, z) : null;
    if (this.accel && !list) {
      // outside the accelerated volume: crude but monotone estimate
      return this.evalList(null, x, y, z);
    }
    return this.evalList(list, x, y, z);
  }

  gradient(x, y, z, e, out) {
    out[0] = this.eval(x + e, y, z) - this.eval(x - e, y, z);
    out[1] = this.eval(x, y + e, z) - this.eval(x, y - e, z);
    out[2] = this.eval(x, y, z + e) - this.eval(x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l;
    out[1] /= l;
    out[2] /= l;
    return l / (2 * e);
  }
}

// Lofted body: a smooth tube along X whose cross-section (egg shape: upper and
// lower half-ellipses meeting at `mid`) is interpolated through stations with
// Catmull-Rom splines. Gives exact control over topline, underline and width.
// stations: [{ x, top, mid, bot, hw }] in ascending x.
export class Loft {
  constructor(stations) {
    this.st = stations.slice().sort((a, b) => a.x - b.x);
    const xs = this.st.map((s) => s.x);
    this.x0 = xs[0];
    this.x1 = xs[xs.length - 1];
    let ymin = 1e9, ymax = -1e9, zmax = 0;
    for (const s of this.st) {
      ymin = Math.min(ymin, s.bot);
      ymax = Math.max(ymax, s.top);
      zmax = Math.max(zmax, s.hw);
    }
    this.bc = [(this.x0 + this.x1) / 2, (ymin + ymax) / 2, 0];
    this.br = Math.hypot((this.x1 - this.x0) / 2, (ymax - ymin) / 2, zmax) + 0.02;
    this.axis = [1, 0, 0];
    this._s = { top: 0, mid: 0, bot: 0, hw: 0 };
  }
  sample(x) {
    const st = this.st, n = st.length;
    let i = 0;
    while (i < n - 2 && x > st[i + 1].x) i++;
    const t = Math.min(1, Math.max(0, (x - st[i].x) / (st[i + 1].x - st[i].x)));
    const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(n - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    const o = this._s;
    o.top = cr(p0.top, p1.top, p2.top, p3.top);
    o.mid = cr(p0.mid, p1.mid, p2.mid, p3.mid);
    o.bot = cr(p0.bot, p1.bot, p2.bot, p3.bot);
    o.hw = cr(p0.hw, p1.hw, p2.hw, p3.hw);
    return o;
  }
  eval(x, y, z) {
    const xc = x < this.x0 ? this.x0 : x > this.x1 ? this.x1 : x;
    const s = this.sample(xc);
    const dy = y - s.mid;
    const ry = dy > 0 ? s.top - s.mid : s.mid - s.bot;
    const rz = s.hw;
    // ellipse distance approximation (I. Quilez)
    const a = dy / ry, b = z / rz;
    const k0 = Math.sqrt(a * a + b * b);
    const k1 = Math.sqrt((a * a) / (ry * ry) + (b * b) / (rz * rz));
    const d2 = k1 < 1e-9 ? -Math.min(ry, rz) : (k0 * (k0 - 1)) / k1;
    const dx = Math.abs(x - xc);
    if (dx === 0) return d2;
    return d2 > 0 ? Math.hypot(d2, dx) : Math.max(d2, dx);
  }
  param(x) {
    return Math.min(1, Math.max(0, (x - this.x0) / (this.x1 - this.x0)));
  }
}

// Elliptical torus (ring) – used for the rolled eyelid rim around the eyeball.
// Local frame: x/y span the ring plane (y squashed by `yScale`), z is the ring
// axis (gaze direction). m: row-major local->world basis.
export class Torus {
  constructor(c, m, R, r, yScale = 1) {
    this.c = c;
    this.m = m;
    this.R = R;
    this.r = r;
    this.ys = yScale;
    this.bc = c;
    this.br = R + r;
    this.axis = [m[0], m[3], m[6]];
  }
  eval(x, y, z) {
    const m = this.m;
    const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2];
    const lx = m[0] * dx + m[3] * dy + m[6] * dz;
    const ly = (m[1] * dx + m[4] * dy + m[7] * dz) / this.ys;
    const lz = m[2] * dx + m[5] * dy + m[8] * dz;
    const qx = Math.hypot(lx, ly) - this.R;
    return (Math.hypot(qx, lz) - this.r) * Math.min(1, this.ys);
  }
  param(x, y, z) {
    return 0.5;
  }
}
