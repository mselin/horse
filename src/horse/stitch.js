// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Joins two meshes of the same surface at a plane x = X0: a coarse mesh kept
// behind the plane and a fine mesh kept in front of it. The open boundary
// loops left by the cut are zipped together with a strip of triangles, so the
// result is one connected, watertight mesh (skin weights and smoothing then
// run across the join as if it were never there).

// Keep the triangles whose centroid passes `keep`, then trim the teeth of
// the cut (triangles with two open edges) so the boundary runs smoothly,
// and compact the vertices.
function cut(mesh, keep, X0, band) {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const V = P.length / 3;
  const far = [], near = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
    if (!keep(cx)) continue;
    (Math.abs(cx - X0) < band ? near : far).push(a, b, c);
  }
  // only triangles near the cut can be teeth; their neighbours are near too,
  // apart from those at the band's far edge, which are never trimmed
  let tris = near;
  for (let pass = 0; pass < 4; pass++) {
    const edges = new Set();
    for (let t = 0; t < tris.length; t += 3)
      for (let e = 0; e < 3; e++) edges.add(tris[t + e] * V + tris[t + ((e + 1) % 3)]);
    const next = [];
    let removed = 0;
    for (let t = 0; t < tris.length; t += 3) {
      let open = 0;
      for (let e = 0; e < 3; e++) if (!edges.has(tris[t + ((e + 1) % 3)] * V + tris[t + e])) open++;
      const cx = (P[tris[t] * 3] + P[tris[t + 1] * 3] + P[tris[t + 2] * 3]) / 3;
      if (open >= 2 && Math.abs(cx - X0) < band * 0.5) removed++;
      else next.push(tris[t], tris[t + 1], tris[t + 2]);
    }
    tris = next;
    if (!removed) break;
  }
  tris = far.concat(tris);
  const remap = new Int32Array(V).fill(-1);
  const pos = [], nrm = [], idx = [], orig = [];
  for (const v of tris) {
    if (remap[v] < 0) {
      remap[v] = pos.length / 3;
      orig.push(v);
      pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    }
    idx.push(remap[v]);
  }
  return { pos, nrm, idx, orig };
}

// Directed boundary edges (a -> b with no b -> a) chained into loops.
function boundaryLoops(idx, vertCount) {
  const key = (a, b) => a * vertCount + b;
  const edges = new Set();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) edges.add(key(idx[t + e], idx[t + ((e + 1) % 3)]));
  const next = new Map();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      if (!edges.has(key(b, a))) next.set(a, b);
    }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let v = start;
    while (v !== undefined && !seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (v === start && loop.length > 2) loops.push(loop);
  }
  return loops;
}

export function stitchAtX(coarse, fine, X0, { coarseMargin = 0, fineMargin = 0, band = 0.06 } = {}) {
  const A = cut(coarse, (x) => x < X0 - coarseMargin, X0, band);
  const B = cut(fine, (x) => x >= X0 + fineMargin, X0, band);
  const nA = A.pos.length / 3;
  const pos = A.pos.concat(B.pos);
  const nrm = A.nrm.concat(B.nrm);
  const idx = A.idx.concat(B.idx.map((i) => i + nA));
  const V = pos.length / 3;

  // the two loops nearest the cut plane: one from each mesh
  const loops = boundaryLoops(idx, V);
  const meanX = (l) => l.reduce((s, v) => s + pos[v * 3], 0) / l.length;
  const pick = (fromA) =>
    loops
      .filter((l) => (l[0] < nA) === fromA)
      .sort((p, q) => Math.abs(meanX(p) - X0) - Math.abs(meanX(q) - X0) || q.length - p.length)[0];
  const C = pick(true), F = pick(false);
  if (!C || !F) throw new Error(`stitch: expected two boundary loops, found ${loops.length}`);

  // G runs the same way round as C (F runs the opposite way)
  const G = F.slice().reverse();
  const d2 = (a, b) => {
    const x = pos[a * 3] - pos[b * 3], y = pos[a * 3 + 1] - pos[b * 3 + 1], z = pos[a * 3 + 2] - pos[b * 3 + 2];
    return x * x + y * y + z * z;
  };
  let j0 = 0;
  for (let j = 1; j < G.length; j++) if (d2(C[0], G[j]) < d2(C[0], G[j0])) j0 = j;
  const nC = C.length, nG = G.length;
  const c = (i) => C[i % nC];
  const g = (j) => G[(j0 + j) % nG];
  // Merge the loops by angle around the cross-section's centre (in the cut
  // plane): robust where a coarse boundary zigzags, unlike shortest-rung
  // rules. Angles run from C[0]'s direction in the loops' own sense and are
  // made non-decreasing.
  let cy = 0, cz = 0;
  for (const v of C) {
    cy += pos[v * 3 + 1];
    cz += pos[v * 3 + 2];
  }
  cy /= nC;
  cz /= nC;
  const ang = (v) => Math.atan2(pos[v * 3 + 2] - cz, pos[v * 3 + 1] - cy);
  let area = 0;
  for (let i = 0; i < nC; i++) {
    const p = C[i], q = C[(i + 1) % nC];
    area += pos[p * 3 + 1] * pos[q * 3 + 2] - pos[q * 3 + 1] * pos[p * 3 + 2];
  }
  const sense = area >= 0 ? 1 : -1;
  const a0 = ang(C[0]);
  const rel = (v) => {
    let t = sense * (ang(v) - a0);
    t -= 2 * Math.PI * Math.floor(t / (2 * Math.PI));
    return t; // [0, 2π)
  };
  const params = (n, at) => {
    const t = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) {
      let x = rel(at(k));
      if (k === 0 && x > Math.PI) x -= 2 * Math.PI; // just behind the start
      t[k] = k ? Math.max(t[k - 1], x) : x;
    }
    t[n] = t[0] + 2 * Math.PI;
    return t;
  };
  const tC = params(nC, c), tG = params(nG, g);
  const strip = [];
  let i = 0, j = 0;
  while (i < nC || j < nG) {
    const advC = j >= nG || (i < nC && tC[i + 1] <= tG[j + 1]);
    if (advC) {
      strip.push(c(i + 1), c(i), g(j));
      i++;
    } else {
      strip.push(g(j), g(j + 1), c(i));
      j++;
    }
  }
  // orientation check against the vertex normals (flip the strip if needed)
  let agree = 0;
  for (let t = 0; t < strip.length; t += 3) {
    const a = strip[t] * 3, b = strip[t + 1] * 3, q = strip[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    agree += fx * nrm[a] + fy * nrm[a + 1] + fz * nrm[a + 2] > 0 ? 1 : -1;
  }
  if (agree < 0) for (let t = 0; t < strip.length; t += 3) [strip[t], strip[t + 1]] = [strip[t + 1], strip[t]];

  // origin: each vertex's index in the coarse mesh, or -1 for the fine one
  const origin = new Int32Array(V).fill(-1);
  origin.set(A.orig, 0);
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    indices: new Uint32Array(idx.concat(strip)),
    origin,
    stats: { coarseVerts: nA, fineVerts: V - nA, seam: [nC, nG], loops: loops.length, stripFlipped: agree < 0 },
  };
}
