// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Mane, forelock and tail: simulated guide strands + thousands of GPU-expanded
// render strands.
//
//  * Guides: Verlet chains whose roots are CPU-skinned to the exact skin
//    vertices they grow from. Each point is pulled toward its rest shape
//    (stiff at the root, free at the tip), feels gravity, wind and air drag
//    from the horse's own motion, and collides with spheres bound to bones.
//  * Render strands: each strand interpolates two neighbouring guides with a
//    random root offset, clumps toward its tip and has a little wave. The
//    vertex shader expands every strand into a camera-facing ribbon; shading is
//    MeshPhysicalMaterial with anisotropic highlights across the fibre
//    direction (Kajiya-Kay-like band), so shadows, fog and IBL all work.

import * as THREE from 'three';
import { HEAD, SPINE } from './rig.js';

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Guide group: a set of Verlet chains sharing a point count.
// ---------------------------------------------------------------------------
class GuideGroup {
  constructor(horse, roots, { points, segLen, stiffRoot, stiffTip, damping, drag, restDir, mass = 1 }) {
    this.horse = horse;
    this.N = points;
    this.G = roots.length;
    this.roots = roots; // { v: vertexIndex, pos: Vector3 (rest), nrm: Vector3, bone: index, len }
    this.damping = damping;
    this.drag = drag;
    this.stiff = new Float32Array(points);
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      this.stiff[i] = stiffTip + (stiffRoot - stiffTip) * Math.pow(1 - t, 2.2);
    }
    this.pos = new Float32Array(this.G * points * 3);
    this.prev = new Float32Array(this.G * points * 3);
    this.rest = new Float32Array(this.G * points * 3); // rest offsets from root (rest pose)
    this.seg = new Float32Array(this.G);
    for (let g = 0; g < this.G; g++) {
      const r = roots[g];
      const L = r.len;
      this.seg[g] = L / (points - 1);
      let p = r.pos.clone();
      for (let i = 0; i < points; i++) {
        const o = (g * points + i) * 3;
        this.rest[o] = p.x - r.pos.x;
        this.rest[o + 1] = p.y - r.pos.y;
        this.rest[o + 2] = p.z - r.pos.z;
        const d = restDir(r, i / (points - 1));
        p = p.clone().addScaledVector(d, this.seg[g]);
      }
    }
    this.colliders = [];
    this.rootWorld = new Float32Array(this.G * 3);
    this.initialised = false;
  }

  skinRoots() {
    const geo = this.horse.geometry;
    const si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array;
    const bones = this.horse.skeleton.bones, inv = this.horse.skeleton.boneInverses;
    for (let g = 0; g < this.G; g++) {
      const r = this.roots[g];
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < 4; j++) {
        const w = sw[r.v * 4 + j];
        if (w < 1e-4) continue;
        const b = si[r.v * 4 + j];
        tmpM.multiplyMatrices(bones[b].matrixWorld, inv[b]);
        tmpV.copy(r.pos).applyMatrix4(tmpM);
        x += tmpV.x * w;
        y += tmpV.y * w;
        z += tmpV.z * w;
      }
      this.rootWorld[g * 3] = x;
      this.rootWorld[g * 3 + 1] = y;
      this.rootWorld[g * 3 + 2] = z;
    }
  }

  reset() {
    this.skinRoots();
    const bones = this.horse.skeleton.bones;
    for (let g = 0; g < this.G; g++) {
      bones[this.roots[g].bone].getWorldQuaternion(tmpQ);
      for (let i = 0; i < this.N; i++) {
        const o = (g * this.N + i) * 3;
        tmpV.set(this.rest[o], this.rest[o + 1], this.rest[o + 2]).applyQuaternion(tmpQ);
        this.pos[o] = this.prev[o] = this.rootWorld[g * 3] + tmpV.x;
        this.pos[o + 1] = this.prev[o + 1] = this.rootWorld[g * 3 + 1] + tmpV.y;
        this.pos[o + 2] = this.prev[o + 2] = this.rootWorld[g * 3 + 2] + tmpV.z;
      }
    }
    this.initialised = true;
  }

  updateColliders() {
    for (const c of this.colliders) {
      c.world.copy(c.local).applyMatrix4(c.bone.matrixWorld);
    }
  }

  step(dt, wind, time = 0) {
    if (!this.initialised) this.reset();
    this.skinRoots();
    this.updateColliders();
    const N = this.N, P = this.pos, Q = this.prev, R = this.rest;
    const bones = this.horse.skeleton.bones;
    const damp = this.damping, drag = this.drag;
    const gy = -9.81 * dt * dt;
    const cols = this.colliders;
    const wl = Math.hypot(wind.x, wind.y, wind.z);
    // flutter direction: across the relative wind, mostly vertical
    const fx = -wind.z / (wl || 1), fz = wind.x / (wl || 1);
    for (let g = 0; g < this.G; g++) {
      const rx = this.rootWorld[g * 3], ry = this.rootWorld[g * 3 + 1], rz = this.rootWorld[g * 3 + 2];
      bones[this.roots[g].bone].getWorldQuaternion(tmpQ);
      const seg = this.seg[g];
      const gust = 1 + 0.35 * Math.sin(time * 1.7 + g * 1.3) * Math.sin(time * 0.6 + g * 0.37);
      const base = g * N * 3;
      // root pinned
      P[base] = Q[base] = rx;
      P[base + 1] = Q[base + 1] = ry;
      P[base + 2] = Q[base + 2] = rz;
      for (let i = 1; i < N; i++) {
        const o = base + i * 3;
        const vx = P[o] - Q[o], vy = P[o + 1] - Q[o + 1], vz = P[o + 2] - Q[o + 2];
        Q[o] = P[o];
        Q[o + 1] = P[o + 1];
        Q[o + 2] = P[o + 2];
        // air drag toward the wind velocity
        const ax = (wind.x * gust * dt - vx) * drag, ay = (wind.y * gust * dt - vy) * drag, az = (wind.z * gust * dt - vz) * drag;
        // air-driven flutter, growing toward the tip and with air speed
        const fl = 0.45 * wl * (i / N) * Math.sin(time * 11 + g * 2.1 + i * 0.8) * dt * dt;
        P[o] += vx * damp + ax * dt * 60 + fx * fl * 0.5;
        P[o + 1] += vy * damp + ay * dt * 60 + gy + fl;
        P[o + 2] += vz * damp + az * dt * 60 + fz * fl * 0.5;
      }
      // constraints
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < N; i++) {
          const o = base + i * 3;
          // shape matching toward the rest pose carried by the root bone
          tmpV.set(R[o], R[o + 1], R[o + 2]).applyQuaternion(tmpQ);
          const k = this.stiff[i] * (it === 0 ? 1 : 0.35);
          P[o] += (rx + tmpV.x - P[o]) * k;
          P[o + 1] += (ry + tmpV.y - P[o + 1]) * k;
          P[o + 2] += (rz + tmpV.z - P[o + 2]) * k;
          // segment length (parent is treated as heavier near the root)
          const p = o - 3;
          let dx = P[o] - P[p], dy = P[o + 1] - P[p + 1], dz = P[o + 2] - P[p + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const diff = (d - seg) / d;
          if (i === 1) {
            P[o] -= dx * diff;
            P[o + 1] -= dy * diff;
            P[o + 2] -= dz * diff;
          } else {
            P[o] -= dx * diff * 0.75;
            P[o + 1] -= dy * diff * 0.75;
            P[o + 2] -= dz * diff * 0.75;
            P[p] += dx * diff * 0.25;
            P[p + 1] += dy * diff * 0.25;
            P[p + 2] += dz * diff * 0.25;
          }
          // collisions
          for (let c = 0; c < cols.length; c++) {
            const C = cols[c];
            dx = P[o] - C.world.x;
            dy = P[o + 1] - C.world.y;
            dz = P[o + 2] - C.world.z;
            const dd = dx * dx + dy * dy + dz * dz;
            const rr = C.r + 0.006;
            if (dd < rr * rr) {
              const l = Math.sqrt(dd) || 1e-6;
              const push = (rr - l) / l;
              P[o] += dx * push;
              P[o + 1] += dy * push;
              P[o + 2] += dz * push;
            }
          }
          if (P[o + 1] < 0.01) P[o + 1] = 0.01;
        }
      }
    }
  }

  addCollider(bone, worldRestPos, r) {
    const rest = bone.userData.rest;
    this.colliders.push({ bone, local: new THREE.Vector3(worldRestPos[0] - rest[0], worldRestPos[1] - rest[1], worldRestPos[2] - rest[2]), world: new THREE.Vector3(), r });
  }
}

// ---------------------------------------------------------------------------
// Render strands for one guide group.
// ---------------------------------------------------------------------------
function buildStrands(group, { count, width, seed, neighbours, spread, clumpTip, wave, lenJitter, colorJitter }) {
  const N = group.N;
  const rand = rng(seed);
  const verts = count * N * 2;
  const aStrand = new Float32Array(verts * 4);
  const aOffset = new Float32Array(verts * 4);
  const aParam = new Float32Array(verts * 4);
  const index = new Uint32Array(count * (N - 1) * 6);
  let vi = 0, ii = 0;
  for (let s = 0; s < count; s++) {
    const gA = Math.floor(rand() * group.G);
    const nb = neighbours(gA, rand);
    const b = rand() * 0.5;
    const lenF = 1 - rand() * lenJitter;
    // offset within a disc, clumped
    const ang = rand() * Math.PI * 2, rad = Math.sqrt(rand()) * spread;
    const ox = Math.cos(ang) * rad, oy = Math.sin(ang) * rad;
    const clump = clumpTip * (0.6 + rand() * 0.8);
    const phase = rand() * Math.PI * 2;
    const col = 1 - colorJitter * 0.5 + rand() * colorJitter;
    const w = width * (0.7 + rand() * 0.6);
    const start = vi;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      for (const side of [-1, 1]) {
        aStrand.set([gA, nb, b, lenF], vi * 4);
        aOffset.set([ox, oy, clump, phase], vi * 4);
        aParam.set([t, side, col, w], vi * 4);
        vi++;
      }
    }
    for (let i = 0; i < N - 1; i++) {
      const a = start + i * 2;
      index[ii++] = a;
      index[ii++] = a + 1;
      index[ii++] = a + 2;
      index[ii++] = a + 1;
      index[ii++] = a + 3;
      index[ii++] = a + 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  // placeholder tangent: real tangents are computed in the vertex shader, but
  // three.js reads tangent.w for the bitangent sign, so it must be 1.
  const tan = new Float32Array(verts * 4);
  for (let i = 3; i < tan.length; i += 4) tan[i] = 1;
  geo.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  geo.setAttribute('aStrand', new THREE.BufferAttribute(aStrand, 4));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(aOffset, 4));
  geo.setAttribute('aParam', new THREE.BufferAttribute(aParam, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return geo;
}

const HAIR_VERT_PARS = /* glsl */ `
uniform sampler2D uGuides;
uniform float uN;
uniform float uWave;
uniform vec3 uExpandDir;
uniform float uUseDir;
uniform float uPixelK;   // pixels per metre at 1 m distance (0 = off)
uniform float uSpread;
attribute vec4 aStrand;
attribute vec4 aOffset;
attribute vec4 aParam;
varying float vHairT;
varying float vHairCol;
varying float vHairAcross;
varying float vHairCover;
varying float vHairOuter;
vec3 gp(int g, float f) {
  float n = uN - 1.0;
  f = clamp(f, 0.0, n - 0.0001);
  float i0 = floor(f);
  float fr = f - i0;
  vec3 a = texelFetch(uGuides, ivec2(int(i0), g * 2), 0).xyz;
  vec3 b = texelFetch(uGuides, ivec2(int(i0) + 1, g * 2), 0).xyz;
  return mix(a, b, fr);
}
vec3 gs(int g, float f) {
  float n = uN - 1.0;
  f = clamp(f, 0.0, n);
  return texelFetch(uGuides, ivec2(int(f + 0.5), g * 2 + 1), 0).xyz;
}
void hairPoint(float t, out vec3 P, out vec3 T, out vec3 S) {
  int gA = int(aStrand.x + 0.5), gB = int(aStrand.y + 0.5);
  float f = t * aStrand.w * (uN - 1.0);
  vec3 pa = gp(gA, f), pb = gp(gB, f);
  vec3 ta = gp(gA, f + 0.5) - gp(gA, f - 0.5);
  vec3 tb = gp(gB, f + 0.5) - gp(gB, f - 0.5);
  T = normalize(mix(ta, tb, aStrand.z) + 1e-6);
  S = normalize(mix(gs(gA, f), gs(gB, f), aStrand.z));
  vec3 B = normalize(cross(T, S));
  S = cross(B, T);
  float spread = mix(1.0, aOffset.z, smoothstep(0.0, 1.0, t));
  float wv = uWave * sin(t * 9.0 + aOffset.w) * smoothstep(0.0, 0.3, t);
  P = mix(pa, pb, aStrand.z) + S * (aOffset.x * spread + wv) + B * (aOffset.y * spread + wv * 0.6);
}
`;

const HAIR_VERT_MAIN = /* glsl */ `
  float hT = aParam.x;
  vec3 hP, hT3, hS;
  hairPoint(hT, hP, hT3, hS);
  vec3 toEye = uUseDir > 0.5 ? -uExpandDir : normalize(cameraPosition - hP);
  vec3 across = normalize(cross(hT3, toEye) + 1e-6);
  float width = aParam.w * mix(1.0, 0.18, pow(hT, 1.4));
  // Pixel coverage: a strand thinner than a pixel is drawn one pixel wide and
  // made proportionally transparent (alpha-to-coverage turns that into
  // sub-pixel coverage) instead of flickering in and out.
  vHairCover = 1.0;
  if (uPixelK > 0.0 && uUseDir < 0.5) {
    float minW = 1.0 * length(cameraPosition - hP) / uPixelK;
    if (width < minW) {
      // each drawn strand stands for several real hairs behind it, so its
      // coverage is boosted; the core of a lock stays opaque at a distance
      vHairCover = clamp(2.4 * width / minW + 0.12, 0.0, 1.0);
      width = minW;
    }
  }
  hP += across * aParam.y * width * 0.5;
  vHairT = hT;
  vHairCol = aParam.z;
  vHairAcross = aParam.y;
  vHairOuter = clamp(length(aOffset.xy) / max(uSpread, 1e-4), 0.0, 1.0);
`;

export class Hair {
  constructor(horse, { color = '#120d0b', density = 1 } = {}) {
    this.horse = horse;
    this.group = new THREE.Group();
    this.group.name = 'Hair';
    this.wind = new THREE.Vector3(0.6, 0, 0.3);
    this.time = 0;
    this.pixelK = { value: 0 };
    this.tipLight = { value: 0.08 };

    const roots = this.findRoots();
    // --- mane ---
    this.mane = new GuideGroup(horse, roots.mane, {
      points: 12,
      segLen: 0.03,
      stiffRoot: 0.34,
      stiffTip: 0.004,
      damping: 0.96,
      drag: 0.05,
      restDir: (r, t) => {
        // lies over to the off (right) side and falls down the neck
        const d0 = new THREE.Vector3().copy(r.nrm).multiplyScalar(0.35).add(new THREE.Vector3(-0.2, 0.0, 1.0)).normalize();
        const d1 = new THREE.Vector3(-0.18, -1, 0.22).normalize();
        return d0.lerp(d1, Math.pow(t, 0.55)).normalize();
      },
    });
    // --- forelock ---
    const u = new THREE.Vector3(HEAD.u[0], HEAD.u[1], 0);
    this.forelock = new GuideGroup(horse, roots.forelock, {
      points: 10,
      segLen: 0.025,
      stiffRoot: 0.22,
      stiffTip: 0.01,
      damping: 0.96,
      drag: 0.05,
      restDir: (r, t) => {
        // up over the poll, then lying down the forehead
        const d0 = r.nrm.clone().multiplyScalar(0.7).add(u.clone().multiplyScalar(0.6)).normalize();
        const d1 = u.clone().multiplyScalar(0.8).add(new THREE.Vector3(HEAD.v[0], HEAD.v[1], 0).multiplyScalar(-0.25)).add(new THREE.Vector3(0, 0, r.pos.z * 3)).normalize();
        return d0.lerp(d1, Math.pow(t, 0.4)).normalize();
      },
    });
    // --- tail ---
    this.tail = new GuideGroup(horse, roots.tail, {
      points: 20,
      segLen: 0.05,
      stiffRoot: 0.3,
      stiffTip: 0.002,
      damping: 0.98,
      drag: 0.035,
      restDir: (r, t) => {
        const d0 = r.dock.clone().multiplyScalar(0.8).add(r.nrm.clone().multiplyScalar(0.3)).normalize();
        const d1 = new THREE.Vector3(-0.03, -1, 0).normalize();
        return d0.lerp(d1, Math.pow(t, 0.35)).normalize();
      },
    });
    this.addColliders();
    this.groups = [this.mane, this.forelock, this.tail];

    // --- render strands ---
    this.material = this.createMaterial(color);
    this.meshes = [];
    const makeMesh = (g, opts) => {
      const geo = buildStrands(g, opts);
      const tex = new THREE.DataTexture(new Float32Array(g.N * g.G * 2 * 4), g.N, g.G * 2, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      const mat = this.material.clone();
      mat.userData.uniforms = {
        uGuides: { value: tex },
        uN: { value: g.N },
        uWave: { value: opts.wave },
        uExpandDir: { value: new THREE.Vector3(0, -1, 0) },
        uUseDir: { value: 0 },
        uPixelK: this.pixelK,
        uSpread: { value: opts.spread },
        uTipLight: this.tipLight,
        uHairR: { value: 0.11 },
        uHairTRT: { value: 0.12 },
        uHairTT: { value: 0.22 },
      };
      this.patch(mat, false);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.userData.uniforms = { ...mat.userData.uniforms, uUseDir: { value: 1 } };
      this.patch(depth, true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.group = g;
      mesh.userData.tex = tex;
      this.group.add(mesh);
      this.meshes.push(mesh);
    };
    const seqNeighbour = (G) => (g, r) => Math.min(G - 1, Math.max(0, g + (r() < 0.5 ? -1 : 1)));
    makeMesh(this.mane, { count: Math.round(8500 * density), width: 0.003, seed: 1, neighbours: seqNeighbour(this.mane.G), spread: 0.012, clumpTip: 0.25, wave: 0.004, lenJitter: 0.3, colorJitter: 0.35 });
    makeMesh(this.forelock, { count: Math.round(700 * density), width: 0.002, seed: 2, neighbours: seqNeighbour(this.forelock.G), spread: 0.012, clumpTip: 0.3, wave: 0.003, lenJitter: 0.35, colorJitter: 0.35 });
    const tailNb = this.tailNeighbours();
    makeMesh(this.tail, { count: Math.round(11000 * density), width: 0.0034, seed: 3, neighbours: (g, r) => tailNb[g][Math.floor(r() * tailNb[g].length)], spread: 0.02, clumpTip: 0.22, wave: 0.006, lenJitter: 0.35, colorJitter: 0.3 });
  }

  setColor(hex) {
    for (const m of this.meshes) {
      m.material.color.set(hex);
      m.material.sheenColor.set(hex).lerp(new THREE.Color('#ffffff'), 0.25);
    }
  }

  findRoots() {
    const geo = this.horse.geometry;
    const P = geo.attributes.restPos.array, Nn = geo.attributes.normal.array;
    const si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array;
    const V = P.length / 3;
    const domBone = (v) => si[v * 4];
    const mk = (v, extra = {}) => ({
      v,
      pos: new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]),
      nrm: new THREE.Vector3(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]),
      bone: domBone(v),
      ...extra,
    });

    // ---- mane: along the crest from just behind the poll to the withers ----
    const A = new THREE.Vector2(0.36, 1.6), Bp = new THREE.Vector2(1.04, 2.02);
    const ax = Bp.clone().sub(A);
    const axLen = ax.length();
    ax.normalize();
    const nrm2 = new THREE.Vector2(-ax.y, ax.x);
    const bins = 44;
    const best = new Array(bins).fill(-1), bestD = new Array(bins).fill(-1e9);
    for (let v = 0; v < V; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (Math.abs(z - 0.006) > 0.012 || y < 1.45) continue;
      const t = ((x - A.x) * ax.x + (y - A.y) * ax.y) / axLen;
      if (t < 0 || t >= 1) continue;
      const b = Math.floor(t * bins);
      const d = (x - A.x) * nrm2.x + (y - A.y) * nrm2.y;
      if (d > bestD[b]) {
        bestD[b] = d;
        best[b] = v;
      }
    }
    const mane = [];
    for (let b = 0; b < bins; b++) {
      if (best[b] < 0) continue;
      const t = b / bins;
      if (t > 0.93) continue; // bridle path behind the ears
      const len = 0.24 + 0.12 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.035 * Math.sin(b * 2.7);
      mane.push(mk(best[b], { len }));
    }

    // ---- forelock: between the ears ----
    const fl = [];
    const fc = new THREE.Vector3(...[HEAD.joint[0] + 0.02 * HEAD.u[0] - 0.068 * HEAD.v[0], HEAD.joint[1] + 0.02 * HEAD.u[1] - 0.068 * HEAD.v[1], 0]);
    const cands = [];
    for (let v = 0; v < V; v++) {
      const dx = P[v * 3] - fc.x, dy = P[v * 3 + 1] - fc.y, dz = P[v * 3 + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.05 && Math.abs(dz) < 0.04 && Nn[v * 3 + 1] > 0.2) cands.push([d, v]);
    }
    // spread roots across the poll between the ears
    const rr = rng(5);
    for (let i = 0; i < 9 && cands.length; i++) {
      const [, v] = cands[Math.floor(rr() * cands.length)];
      if (fl.some((f) => Math.abs(f.pos.z - P[v * 3 + 2]) < 0.006 && Math.abs(f.pos.y - P[v * 3 + 1]) < 0.006)) continue;
      fl.push(mk(v, { len: 0.13 + 0.05 * rr() }));
    }

    // ---- tail: around the top and sides of the dock ----
    const tailBones = new Set(['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'].map((n) => this.horse.skeleton.bones.findIndex((b) => b.name === n)));
    const dockPts = [SPINE.tail0, SPINE.tail1, SPINE.tail2, SPINE.tail3, SPINE.tail4, SPINE.tail5, SPINE.tailTip];
    const tailCands = [];
    for (let v = 0; v < V; v++) {
      if (!tailBones.has(si[v * 4]) || sw[v * 4] < 0.45) continue;
      const x = P[v * 3], y = P[v * 3 + 1];
      if (x > -0.93) continue;
      tailCands.push(v);
    }
    const tail = [];
    const rand = rng(7);
    const want = 46;
    for (let i = 0; i < want * 6 && tail.length < want; i++) {
      const v = tailCands[Math.floor(rand() * tailCands.length)];
      const p = new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      // dock direction at this height
      let k = 0;
      while (k < dockPts.length - 2 && p.y < dockPts[k + 1][1]) k++;
      const dock = new THREE.Vector3(dockPts[k + 1][0] - dockPts[k][0], dockPts[k + 1][1] - dockPts[k][1], 0).normalize();
      const n = new THREE.Vector3(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]);
      if (n.x > 0.4) continue; // not from the underside facing the buttocks
      if (tail.some((t) => t.pos.distanceTo(p) < 0.025)) continue;
      const along = (dockPts[0][1] - p.y) / (dockPts[0][1] - dockPts[6][1]);
      const len = 1.02 - along * 0.32 + rand() * 0.08;
      tail.push(mk(v, { len, dock }));
    }
    return { mane, forelock: fl, tail };
  }

  tailNeighbours() {
    const r = this.tail.roots;
    return r.map((a, i) => {
      const d = r.map((b, j) => [a.pos.distanceTo(b.pos), j]).filter(([, j]) => j !== i);
      d.sort((x, y) => x[0] - y[0]);
      return d.slice(0, 3).map(([, j]) => j);
    });
  }

  addColliders() {
    const B = this.horse.bones;
    // neck: the cross-section is a tall oval, so stack spheres from the neck
    // axis up toward the crest, each sized to the local half-width
    const base = [0.56, 1.36], top = [1.0, 1.9];
    const d = [top[0] - base[0], top[1] - base[1]];
    const L = Math.hypot(d[0], d[1]);
    d[0] /= L;
    d[1] /= L;
    const n = [-d[1], d[0]];
    const st = [
      [0.05, 0.29, 0.175, 'neck0'],
      [0.22, 0.235, 0.148, 'neck1'],
      [0.4, 0.195, 0.126, 'neck2'],
      [0.58, 0.165, 0.11, 'neck3'],
      [0.76, 0.142, 0.097, 'neck4'],
      [0.92, 0.128, 0.088, 'neck4'],
    ];
    for (const [s, ht, hw, b] of st) {
      for (const f of [0.0, 0.35, 0.62]) {
        const off = f * ht + 0.01;
        const c = [base[0] + d[0] * s * L + n[0] * off, base[1] + d[1] * s * L + n[1] * off, 0];
        this.mane.addCollider(B[b], c, hw * (f === 0.62 ? 0.82 : 1.0) + 0.004);
      }
    }
    this.mane.addCollider(B.thorax, [0.4, 1.42, 0], 0.21);
    this.mane.addCollider(B.thorax, [0.5, 1.33, 0.0], 0.2);
    this.forelock.addCollider(B.head, [HEAD.joint[0] + 0.15 * HEAD.u[0] - 0.0 * HEAD.v[0], HEAD.joint[1] + 0.15 * HEAD.u[1], 0], 0.075);
    this.forelock.addCollider(B.head, [HEAD.joint[0] + 0.3 * HEAD.u[0] - 0.05 * HEAD.v[0], HEAD.joint[1] + 0.3 * HEAD.u[1] - 0.05 * HEAD.v[1], 0], 0.075);
    // tail: buttocks, thighs, hocks
    const tc = [
      ['pelvis', [-0.84, 1.3, 0.1], 0.14],
      ['pelvis', [-0.84, 1.3, -0.1], 0.14],
      ['femur_R', [-0.82, 1.05, 0.1], 0.12],
      ['femur_L', [-0.82, 1.05, -0.1], 0.12],
      ['tibia_R', [-0.76, 0.8, 0.13], 0.08],
      ['tibia_L', [-0.76, 0.8, -0.13], 0.08],
      ['hcannon_R', [-0.79, 0.6, 0.12], 0.055],
      ['hcannon_L', [-0.79, 0.6, -0.12], 0.055],
    ];
    for (const [b, p, r] of tc) this.tail.addCollider(B[b], p, r);
  }

  createMaterial(color) {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness: 0.46,
      metalness: 0,
      anisotropy: 0.85,
      anisotropyRotation: Math.PI / 2,
      sheen: 0.25,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.25),
      side: THREE.DoubleSide,
      alphaToCoverage: true,
      transparent: false,
      specularIntensity: 0.55,
    });
  }

  patch(mat, isDepth) {
    const u = mat.userData.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + HAIR_VERT_PARS);
      if (!isDepth) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_physical_pars_fragment>',
          `#include <lights_physical_pars_fragment>
          // Hair: Kajiya-Kay style lobes after Marschner et al. – a white
          // primary highlight (R) shifted toward the root, a broader secondary
          // highlight tinted by the hair (TRT) shifted toward the tip, and light
          // transmitted through backlit strands (TT). Shadows arrive through
          // directLight.color as for any other material.
          uniform float uHairR, uHairTRT, uHairTT;
          void RE_Direct_Hair(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
                              const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
                              const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
            vec3 T = normalize(vTangent);
            vec3 L = directLight.direction;
            vec3 V = geometryViewDir;
            vec3 N = geometryNormal;
            float TL = dot(T, L);
            float sinTL = sqrt(max(0.0, 1.0 - TL * TL));
            float wrapNL = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);
            reflectedLight.directDiffuse += directLight.color * mix(sinTL, wrapNL, 0.55) * BRDF_Lambert(material.diffuseColor);
            vec3 H = normalize(L + V);
            vec3 T1 = normalize(T - N * 0.08);
            vec3 T2 = normalize(T + N * 0.12);
            float h1 = dot(T1, H), h2 = dot(T2, H);
            float r = pow(sqrt(max(0.0, 1.0 - h1 * h1)), 160.0);
            float trt = pow(sqrt(max(0.0, 1.0 - h2 * h2)), 30.0);
            float lit = smoothstep(0.0, 0.35, wrapNL);
            vec3 spec = (uHairR * r * vec3(1.0) + uHairTRT * trt * material.diffuseColor * 3.0) * lit;
            spec += uHairTT * pow(clamp(dot(-V, L), 0.0, 1.0), 5.0) * material.diffuseColor * 2.5;
            reflectedLight.directSpecular += directLight.color * spec;
          }
          #undef RE_Direct
          #define RE_Direct RE_Direct_Hair`
        );
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <beginnormal_vertex>',
            `${HAIR_VERT_MAIN}
            vec3 objectNormal = normalize(toEye - hT3 * dot(toEye, hT3));
            objectNormal = normalize(objectNormal + across * aParam.y * 0.6);
            #ifdef USE_TANGENT
            vec3 objectTangent = hT3;
            #endif`
          )
          .replace('#include <begin_vertex>', 'vec3 transformed = hP;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying float vHairT;
            varying float vHairCol;
            varying float vHairAcross;
            varying float vHairCover;
            varying float vHairOuter;
            uniform float uTipLight;`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            // deep in the lock and near the roots the hair is shadowed by its neighbours
            diffuseColor.rgb *= vHairCol * mix(0.45, 1.0, smoothstep(0.0, 0.3, vHairT)) * mix(0.7, 1.05, vHairOuter);
            // sun-bleached tips
            diffuseColor.rgb *= 1.0 + uTipLight * smoothstep(0.55, 1.0, vHairT);
            diffuseColor.a = (1.0 - smoothstep(0.85, 1.0, vHairT)) * (1.0 - 0.6 * pow(abs(vHairAcross), 6.0)) * vHairCover;`
          );
      } else {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `${HAIR_VERT_MAIN}\nvec3 transformed = hP;`);
      }
    };
    mat.customProgramCacheKey = () => (isDepth ? 'hair-depth' : 'hair-main');
  }

  update(dt, horseVelocity, sunDir, camera = null, viewportHeight = 0) {
    if (camera && viewportHeight) this.pixelK.value = (camera.projectionMatrix.elements[5] * viewportHeight) / 2;
    this.time += dt;
    const gust = 1 + 0.6 * Math.sin(this.time * 0.7) * Math.sin(this.time * 1.9 + 1.3);
    const w = this.wind.clone().multiplyScalar(gust).sub(horseVelocity);
    const sub = dt > 1 / 50 ? 2 : 1;
    for (const g of this.groups) for (let i = 0; i < sub; i++) g.step(dt / sub, w, this.time);
    for (const mesh of this.meshes) {
      const g = mesh.userData.group;
      const tex = mesh.userData.tex;
      const data = tex.image.data;
      const N = g.N;
      for (let gi = 0; gi < g.G; gi++) {
        // positions row, then side-vector row (parallel transported)
        let sx = 0, sy = 0, sz = 1;
        const r = g.roots[gi];
        sx = r.nrm.x;
        sy = r.nrm.y;
        sz = r.nrm.z;
        for (let i = 0; i < N; i++) {
          const o = (gi * N + i) * 3;
          const po = (gi * 2 * N + i) * 4;
          data[po] = g.pos[o];
          data[po + 1] = g.pos[o + 1];
          data[po + 2] = g.pos[o + 2];
          data[po + 3] = 1;
          // tangent
          const o2 = i < N - 1 ? o + 3 : o;
          const o1 = i < N - 1 ? o : o - 3;
          let tx = g.pos[o2] - g.pos[o1], ty = g.pos[o2 + 1] - g.pos[o1 + 1], tz = g.pos[o2 + 2] - g.pos[o1 + 2];
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl;
          ty /= tl;
          tz /= tl;
          const d = sx * tx + sy * ty + sz * tz;
          sx -= d * tx;
          sy -= d * ty;
          sz -= d * tz;
          const sl = Math.hypot(sx, sy, sz) || 1;
          sx /= sl;
          sy /= sl;
          sz /= sl;
          const so = ((gi * 2 + 1) * N + i) * 4;
          data[so] = sx;
          data[so + 1] = sy;
          data[so + 2] = sz;
          data[so + 3] = 1;
        }
      }
      tex.needsUpdate = true;
      if (sunDir) mesh.customDepthMaterial.userData.uniforms.uExpandDir.value.copy(sunDir);
    }
  }
}
