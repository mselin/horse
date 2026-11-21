// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Naive Surface Nets polygonizer with sparse block evaluation.
//
// Only blocks that can contain the surface are sampled densely, which keeps a
// ~7 mm grid over the whole horse fast enough to run in a Web Worker at load.

const axisNodes = (lo, hi, h) => {
  const n = Math.ceil((hi - lo) / h) + 1;
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lo + i * h;
  return xs;
};

export function polygonize(field, min, max, h, { block = 8, project = 2, onProgress } = {}) {
  const xs = axisNodes(min[0], max[0], h);
  const ys = axisNodes(min[1], max[1], h);
  const zs = axisNodes(min[2], max[2], h);
  const nx = xs.length, ny = ys.length, nz = zs.length;
  const values = new Float32Array(nx * ny * nz);
  const blockSize = block * h;

  field.buildAccel(min, [xs[nx - 1] + blockSize, ys[ny - 1] + blockSize, zs[nz - 1] + blockSize], blockSize);
  const acc = field.accel;
  const skipThresh = 1.7 * acc.rad;
  // accel cell index of a point (clamped)
  const cellOf = (x, y, z) => {
    const i = Math.min(acc.nx - 1, Math.max(0, Math.floor((x - acc.min[0]) / acc.cell)));
    const j = Math.min(acc.ny - 1, Math.max(0, Math.floor((y - acc.min[1]) / acc.cell)));
    const k = Math.min(acc.nz - 1, Math.max(0, Math.floor((z - acc.min[2]) / acc.cell)));
    return i + acc.nx * (j + acc.ny * k);
  };

  // ---- sample the grid block by block --------------------------------------
  // A block is skipped when every accel cell it touches is certainly inside
  // or certainly outside. Blocks are never larger than an accel cell, so the
  // cells holding the block's corners are all the cells it touches.
  const bnx = Math.ceil(nx / block), bny = Math.ceil(ny / block), bnz = Math.ceil(nz / block);
  let dense = 0;
  for (let bk = 0; bk < bnz; bk++) {
    for (let bj = 0; bj < bny; bj++)
      for (let bi = 0; bi < bnx; bi++) {
        const i0 = bi * block, j0 = bj * block, k0 = bk * block;
        const i1 = Math.min(nx, i0 + block), j1 = Math.min(ny, j0 + block), k1 = Math.min(nz, k0 + block);
        let sign = 0;
        for (let c = 0; c < 8 && sign !== 2; c++) {
          const x = xs[c & 1 ? i1 - 1 : i0], y = ys[c & 2 ? j1 - 1 : j0], z = zs[c & 4 ? k1 - 1 : k0];
          const dc = acc.centerVal[cellOf(x, y, z)];
          const s = Math.abs(dc) > skipThresh ? (dc > 0 ? 1 : -1) : 2;
          if (sign === 0) sign = s;
          else if (s !== sign) sign = 2;
        }
        if (sign !== 2) {
          for (let k = k0; k < k1; k++)
            for (let j = j0; j < j1; j++) {
              const row = nx * (j + ny * k);
              for (let i = i0; i < i1; i++) values[i + row] = sign;
            }
          continue;
        }
        dense++;
        for (let k = k0; k < k1; k++) {
          const z = zs[k];
          for (let j = j0; j < j1; j++) {
            const y = ys[j];
            const row = nx * (j + ny * k);
            for (let i = i0; i < i1; i++) {
              const x = xs[i];
              values[i + row] = field.evalList(acc.lists[cellOf(x, y, z)], x, y, z);
            }
          }
        }
      }
    if (onProgress) onProgress((bk + 1) / bnz);
  }

  // ---- one vertex per surface cell ----------------------------------------
  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellVert = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const cellH = []; // smallest spacing of each vertex's cell (for projection)
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x edges
    [0, 2], [1, 3], [4, 6], [5, 7], // y edges
    [0, 4], [1, 5], [2, 6], [3, 7], // z edges
  ];
  const off = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  for (let k = 0; k < cnz; k++)
    for (let j = 0; j < cny; j++)
      for (let i = 0; i < cnx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = off[c];
          const v = values[i + o[0] + nx * (j + o[1] + ny * (k + o[2]))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const [a, b] = EDGES[e];
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const oa = off[a], ob = off[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          cnt++;
        }
        cellVert[i + cnx * (j + cny * k)] = pos.length / 3;
        const fx = sx / cnt, fy = sy / cnt, fz = sz / cnt;
        const dx = xs[i + 1] - xs[i], dy = ys[j + 1] - ys[j], dz = zs[k + 1] - zs[k];
        pos.push(xs[i] + fx * dx, ys[j] + fy * dy, zs[k] + fz * dz);
        cellH.push(Math.min(dx, dy, dz));
      }

  // ---- quads across every sign-changing grid edge ----------------------------
  const idx = [];
  const cv = (i, j, k) => cellVert[i + cnx * (j + cny * k)];
  for (let k = 1; k < cnz; k++)
    for (let j = 1; j < cny; j++)
      for (let i = 1; i < cnx; i++) {
        const v0 = values[i + nx * (j + ny * k)];
        const inside = v0 < 0;
        // edge along x from (i,j,k) to (i+1,j,k)
        const vx = values[i + 1 + nx * (j + ny * k)];
        if (inside !== vx < 0) {
          const a = cv(i, j - 1, k - 1), b = cv(i, j, k - 1), c = cv(i, j, k), d = cv(i, j - 1, k);
          quad(idx, a, b, c, d, inside);
        }
        const vy = values[i + nx * (j + 1 + ny * k)];
        if (inside !== vy < 0) {
          const a = cv(i - 1, j, k - 1), b = cv(i - 1, j, k), c = cv(i, j, k), d = cv(i, j, k - 1);
          quad(idx, a, b, c, d, inside);
        }
        const vz = values[i + nx * (j + ny * (k + 1))];
        if (inside !== vz < 0) {
          const a = cv(i - 1, j - 1, k), b = cv(i, j - 1, k), c = cv(i, j, k), d = cv(i - 1, j, k);
          quad(idx, a, b, c, d, inside);
        }
      }

  // ---- project vertices onto the true surface, compute normals -------------
  const P = new Float32Array(pos);
  const N = new Float32Array(P.length);
  const g = [0, 0, 0];
  for (let v = 0; v < P.length; v += 3) {
    const hv = cellH[v / 3];
    const e = hv * 0.35;
    let x = P[v], y = P[v + 1], z = P[v + 2];
    for (let it = 0; it < project; it++) {
      const d = field.eval(x, y, z);
      const gl = field.gradient(x, y, z, e, g);
      const step = d / Math.max(gl, 0.2);
      // never move more than one cell
      const s = Math.max(-hv, Math.min(hv, step));
      x -= g[0] * s;
      y -= g[1] * s;
      z -= g[2] * s;
    }
    P[v] = x;
    P[v + 1] = y;
    P[v + 2] = z;
    field.gradient(x, y, z, e, g);
    N[v] = g[0];
    N[v + 1] = g[1];
    N[v + 2] = g[2];
  }

  return { positions: P, normals: N, indices: new Uint32Array(idx), stats: { nx, ny, nz, dense, verts: P.length / 3, tris: idx.length / 3 } };
}

function quad(out, a, b, c, d, flip) {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  if (flip) out.push(a, b, c, a, c, d);
  else out.push(a, c, b, a, d, c);
}
