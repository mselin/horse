// Bakes the horse sculpt into a skinned triangle mesh with per-vertex data.
// Runs in a Web Worker in the browser (and under Node for testing).

import { Field, OP_ADD } from './sdf.js';
import { polygonize } from './mesher.js';
import { HORSE_NODES, NUM_BONES } from './anatomy.js';

export const BOUNDS_MIN = [-1.12, -0.01, -0.36];
export const BOUNDS_MAX = [1.48, 2.1, 0.36];

export function bakeHorse({ cell = 0.0075, onProgress } = {}) {
  const t0 = now();
  const field = new Field(HORSE_NODES, { clipY: 0, clipK: 0.006 });
  const mesh = polygonize(field, BOUNDS_MIN, BOUNDS_MAX, cell, {
    block: 8,
    project: 2,
    onProgress: (p) => onProgress && onProgress(0.75 * p, 'Sculpting'),
  });
  const t1 = now();

  const P = mesh.positions;
  const N = mesh.normals;
  const V = P.length / 3;
  const nodes = HORSE_NODES;

  // ---- per-vertex primitive influence -> bone weights, material, hair flow ----
  const W = new Float32Array(V * NUM_BONES);
  const MATS = new Float32Array(V * 4);
  const HAIR = new Float32Array(V * 3);
  const acc = new Float32Array(NUM_BONES);
  const dvals = new Float64Array(nodes.length);
  for (let v = 0; v < V; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const list = field.listAt(x, y, z);
    const n = list ? list.length : nodes.length;
    let dmin = 1e9;
    for (let i = 0; i < n; i++) {
      const ni = list ? list[i] : i;
      const node = nodes[ni];
      if (node.op !== OP_ADD) continue;
      const d = node.prim.eval(x, y, z);
      dvals[i] = d;
      if (d < dmin) dmin = d;
    }
    acc.fill(0);
    let wsum = 0, m0 = 0, m1 = 0, m2 = 0, m3 = 0, hx = 0, hy = 0, hz = 0;
    for (let i = 0; i < n; i++) {
      const ni = list ? list[i] : i;
      const node = nodes[ni];
      if (node.op !== OP_ADD) continue;
      const r = 1 - (dvals[i] - dmin) / node.wk;
      if (r <= 0) continue;
      const w = r * r;
      node.weights(node.prim, x, y, z, acc, w);
      wsum += w;
      m0 += node.mat[0] * w;
      m1 += node.mat[1] * w;
      m2 += node.mat[2] * w;
      m3 += node.mat[3] * w;
      hx += node.hair[0] * w;
      hy += node.hair[1] * w;
      hz += node.hair[2] * w;
    }
    const inv = wsum > 0 ? 1 / wsum : 0;
    let bs = 0;
    for (let b = 0; b < NUM_BONES; b++) bs += acc[b];
    const binv = bs > 0 ? 1 / bs : 0;
    for (let b = 0; b < NUM_BONES; b++) W[v * NUM_BONES + b] = acc[b] * binv;
    MATS[v * 4] = m0 * inv;
    MATS[v * 4 + 1] = m1 * inv;
    MATS[v * 4 + 2] = m2 * inv;
    MATS[v * 4 + 3] = m3 * inv;
    HAIR[v * 3] = hx;
    HAIR[v * 3 + 1] = hy;
    HAIR[v * 3 + 2] = hz;
    if ((v & 8191) === 0 && onProgress) onProgress(0.75 + 0.1 * (v / V), 'Rigging');
  }

  // ---- smooth across the surface ----
  const adj = buildAdjacency(mesh.indices, V);
  smoothAttr(W, NUM_BONES, adj, 8, 0.5);
  smoothAttr(MATS, 4, adj, 2, 0.5);
  smoothAttr(HAIR, 3, adj, 6, 0.6);

  // ---- top-4 skin weights ----
  const skinIndex = new Uint16Array(V * 4);
  const skinWeight = new Float32Array(V * 4);
  const top = [0, 0, 0, 0], topw = [0, 0, 0, 0];
  for (let v = 0; v < V; v++) {
    topw.fill(-1);
    top.fill(0);
    for (let b = 0; b < NUM_BONES; b++) {
      const w = W[v * NUM_BONES + b];
      if (w <= topw[3]) continue;
      let j = 3;
      while (j > 0 && w > topw[j - 1]) {
        topw[j] = topw[j - 1];
        top[j] = top[j - 1];
        j--;
      }
      topw[j] = w;
      top[j] = b;
    }
    let s = 0;
    for (let j = 0; j < 4; j++) s += Math.max(0, topw[j]);
    for (let j = 0; j < 4; j++) {
      skinIndex[v * 4 + j] = top[j];
      skinWeight[v * 4 + j] = s > 0 ? Math.max(0, topw[j]) / s : j === 0 ? 1 : 0;
    }
  }

  // ---- hair-flow tangents (projected into the tangent plane) ----
  const tangent = new Float32Array(V * 4);
  for (let v = 0; v < V; v++) {
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let hx = HAIR[v * 3], hy = HAIR[v * 3 + 1], hz = HAIR[v * 3 + 2];
    const d = hx * nx + hy * ny + hz * nz;
    hx -= d * nx;
    hy -= d * ny;
    hz -= d * nz;
    let l = Math.hypot(hx, hy, hz);
    if (l < 1e-5) {
      // fall back to "downward" flow
      hx = -ny * nx;
      hy = 1 - ny * ny;
      hz = -ny * nz;
      hx = -hx;
      hy = -hy;
      hz = -hz;
      l = Math.hypot(hx, hy, hz) || 1;
    }
    tangent[v * 4] = hx / l;
    tangent[v * 4 + 1] = hy / l;
    tangent[v * 4 + 2] = hz / l;
    tangent[v * 4 + 3] = 1;
  }

  // ---- ambient occlusion + curvature from the distance field ----
  const aoCurv = new Float32Array(V * 2);
  for (let v = 0; v < V; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    // multi-scale SDF occlusion along the normal
    let occ = 0, wsum = 0;
    for (let i = 1; i <= 6; i++) {
      const h = 0.012 * i * i * 0.5 + 0.004;
      const d = field.eval(x + nx * h, y + ny * h, z + nz * h);
      const w = 1 / (1 + i * 0.6);
      occ += w * Math.max(0, h - d) / h;
      wsum += w;
    }
    // ground contact darkening
    const ground = Math.max(0, 1 - y / 0.25) * 0.25 * Math.max(0, -ny + 0.2);
    const ao = Math.max(0, 1 - 1.35 * (occ / wsum) - ground);
    // mean curvature ~ laplacian of the field
    const e = 0.012;
    const f0 = field.eval(x, y, z);
    const lap =
      field.eval(x + e, y, z) + field.eval(x - e, y, z) +
      field.eval(x, y + e, z) + field.eval(x, y - e, z) +
      field.eval(x, y, z + e) + field.eval(x, y, z - e) - 6 * f0;
    aoCurv[v * 2] = ao;
    aoCurv[v * 2 + 1] = lap / (e * e) * 0.01;
    if ((v & 8191) === 0 && onProgress) onProgress(0.85 + 0.15 * (v / V), 'Shading');
  }
  smoothAttr(aoCurv, 2, adj, 2, 0.5);

  const t2 = now();
  return {
    positions: P,
    normals: N,
    indices: mesh.indices,
    skinIndex,
    skinWeight,
    tangent,
    mats: MATS,
    aoCurv,
    stats: { ...mesh.stats, meshMs: Math.round(t1 - t0), attrMs: Math.round(t2 - t1) },
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function buildAdjacency(indices, V) {
  const deg = new Uint32Array(V);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    deg[a] += 2;
    deg[b] += 2;
    deg[c] += 2;
  }
  const start = new Uint32Array(V + 1);
  for (let v = 0; v < V; v++) start[v + 1] = start[v] + deg[v];
  const fill = start.slice(0, V);
  const nb = new Uint32Array(start[V]);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    nb[fill[a]++] = b;
    nb[fill[a]++] = c;
    nb[fill[b]++] = a;
    nb[fill[b]++] = c;
    nb[fill[c]++] = a;
    nb[fill[c]++] = b;
  }
  return { start, nb };
}

function smoothAttr(A, stride, adj, iters, lambda) {
  const V = A.length / stride;
  const tmp = new Float32Array(A.length);
  const { start, nb } = adj;
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < V; v++) {
      const s = start[v], e = start[v + 1];
      const cnt = e - s;
      const o = v * stride;
      if (cnt === 0) {
        for (let c = 0; c < stride; c++) tmp[o + c] = A[o + c];
        continue;
      }
      for (let c = 0; c < stride; c++) {
        let sum = 0;
        for (let j = s; j < e; j++) sum += A[nb[j] * stride + c];
        tmp[o + c] = A[o + c] + lambda * (sum / cnt - A[o + c]);
      }
    }
    A.set(tmp);
  }
}
