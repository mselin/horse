// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Naive Surface Nets polygonizer with sparse block evaluation.
//
// Only blocks that can contain the surface are sampled densely, which keeps a
// ~7 mm grid over the whole horse fast enough to run in a Web Worker at load.

export function polygonize(field, min, max, h, { block = 8, project = 2, onProgress } = {}) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const values = new Float32Array(nx * ny * nz);
  const blockSize = block * h;

  field.buildAccel(min, [min[0] + nx * h + blockSize, min[1] + ny * h + blockSize, min[2] + nz * h + blockSize], blockSize);
  const acc = field.accel;

  // ---- sample the grid block by block --------------------------------------
  const bnx = Math.ceil(nx / block), bny = Math.ceil(ny / block), bnz = Math.ceil(nz / block);
  const skipThresh = 1.7 * acc.rad;
  let dense = 0;
  for (let bk = 0; bk < bnz; bk++) {
    for (let bj = 0; bj < bny; bj++)
      for (let bi = 0; bi < bnx; bi++) {
        const aidx = bi + acc.nx * (bj + acc.ny * bk);
        const dc = acc.centerVal[aidx];
        const list = acc.lists[aidx];
        const i0 = bi * block, j0 = bj * block, k0 = bk * block;
        const i1 = Math.min(nx, i0 + block), j1 = Math.min(ny, j0 + block), k1 = Math.min(nz, k0 + block);
        if (Math.abs(dc) > skipThresh) {
          const v = dc > 0 ? 1 : -1;
          for (let k = k0; k < k1; k++)
            for (let j = j0; j < j1; j++) {
              const row = nx * (j + ny * k);
              for (let i = i0; i < i1; i++) values[i + row] = v;
            }
          continue;
        }
        dense++;
        for (let k = k0; k < k1; k++) {
          const z = min[2] + k * h;
          for (let j = j0; j < j1; j++) {
            const y = min[1] + j * h;
            const row = nx * (j + ny * k);
            for (let i = i0; i < i1; i++) {
              values[i + row] = field.evalList(list, min[0] + i * h, y, z);
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
        pos.push(min[0] + (i + sx / cnt) * h, min[1] + (j + sy / cnt) * h, min[2] + (k + sz / cnt) * h);
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
  const e = h * 0.35;
  for (let v = 0; v < P.length; v += 3) {
    let x = P[v], y = P[v + 1], z = P[v + 2];
    for (let it = 0; it < project; it++) {
      const d = field.eval(x, y, z);
      const gl = field.gradient(x, y, z, e, g);
      const step = d / Math.max(gl, 0.2);
      // never move more than one cell
      const s = Math.max(-h, Math.min(h, step));
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
