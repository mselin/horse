// Eyelashes, muzzle whiskers (vibrissae) and tactile hairs over the eyes.
// Thin line strands parented to the head bone, rooted on the actual skin.

import * as THREE from 'three';
import { EYE, HEAD, headDir } from './rig.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

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

// A curved hair: `segs` line segments, bending from d0 by `bend` per segment toward `toward`.
function hairLine(out, root, d0, len, toward, bend, segs = 4) {
  let p = root, d = nrm(d0);
  for (let i = 0; i < segs; i++) {
    const q = addv(p, sc(d, len / segs));
    out.push(...p, ...q);
    p = q;
    d = nrm(addv(d, sc(toward, bend)));
  }
}

export function addFacialHairs(horse, { color = '#1c130e' } = {}) {
  const head = horse.bones.head;
  const rest = head.userData.rest;
  const r = rng(99);
  const lash = [], whisk = [];
  const up = [0, 1, 0];
  const u = [HEAD.u[0], HEAD.u[1], 0], v = [HEAD.v[0], HEAD.v[1], 0];

  // ---- eyelashes along the upper lid margin (the lid ring from anatomy.js) ----
  for (const side of [1, -1]) {
    const ed = [EYE.dir[0], EYE.dir[1], EYE.dir[2] * side];
    const ec = [EYE.center[0], EYE.center[1], EYE.center[2] * side];
    const f = headDir(1, 0.06);
    const hx = nrm(sub(f, sc(ed, dot(f, ed))));
    const hy = nrm(cross(ed, hx));
    const upSign = Math.sign(hy[1]) || 1;
    const c = addv(ec, sc(ed, EYE.radius * 0.5));
    const R = EYE.radius * 0.98, ys = 0.72;
    for (let i = 0; i < 70; i++) {
      const th = (0.12 + 0.76 * (i / 69)) * Math.PI;
      const ring = addv(c, addv(sc(hx, Math.cos(th) * R), sc(hy, upSign * Math.sin(th) * R * ys)));
      const root = addv(addv(ring, sc(ed, 0.006)), sc(hy, upSign * 0.004));
      const mid = Math.sin(th);
      const len = (0.008 + 0.012 * mid) * (0.8 + 0.4 * r());
      const d0 = addv(addv(sc(ed, 0.75), sc(hy, upSign * 0.55)), sc(hx, Math.cos(th) * 0.25 + (r() - 0.5) * 0.15));
      hairLine(lash, root, d0, len, sc(hy, -upSign), 0.35, 4);
    }
    // a few short lower lashes
    for (let i = 0; i < 14; i++) {
      const th = (1.25 + 0.5 * (i / 13)) * Math.PI;
      const ring = addv(c, addv(sc(hx, Math.cos(th) * R), sc(hy, upSign * Math.sin(th) * R * ys)));
      const root = addv(ring, sc(ed, 0.006));
      hairLine(lash, root, addv(sc(ed, 0.8), sc(hy, -upSign * 0.5)), 0.004 + 0.003 * r(), sc(hy, -upSign), 0.2, 2);
    }
    // supraorbital tactile hairs on the brow
    for (let i = 0; i < 6; i++) {
      const th = (0.3 + 0.4 * r()) * Math.PI;
      const root = addv(addv(c, addv(sc(hx, Math.cos(th) * R * 1.25), sc(hy, upSign * R * 1.25))), sc(ed, 0.004));
      hairLine(whisk, root, addv(sc(ed, 0.8), sc(hy, upSign * 0.6)), 0.03 + 0.015 * r(), [0, -1, 0], 0.08, 5);
    }
  }

  // ---- muzzle whiskers: rooted on skin vertices of the lips, chin and nostrils ----
  const P = horse.geometry.attributes.restPos.array;
  const N = horse.geometry.attributes.normal.array;
  const J = HEAD.joint;
  const cands = [];
  for (let i = 0; i < P.length / 3; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const d = sub(p, J);
    const a = dot(d, u), b = dot(d, v);
    if (a > 0.44 && a < 0.575 && b > 0.0 && b < 0.165 && Math.abs(p[2]) > 0.012) cands.push(i);
  }
  const roots = [];
  for (let k = 0; k < 4000 && roots.length < 110; k++) {
    const i = cands[Math.floor(r() * cands.length)];
    if (i === undefined) break;
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    if (roots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.007)) continue;
    roots.push(p);
    const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
    const d0 = addv(addv(sc(n, 0.75), sc(u, 0.35)), sc(v, 0.25));
    hairLine(whisk, p, d0, 0.022 + 0.035 * r() * r(), [0, -1, 0], 0.12, 5);
  }

  const toLocal = (arr) => {
    const f = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      f[i] = arr[i] - rest[0];
      f[i + 1] = arr[i + 1] - rest[1];
      f[i + 2] = arr[i + 2] - rest[2];
    }
    return f;
  };
  const mats = [];
  const make = (arr, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(toLocal(arr), 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    m.userData.baseOpacity = opacity;
    mats.push(m);
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    head.add(l);
    return l;
  };
  make(lash, 0.95);
  make(whisk, 0.75);
  return {
    // fade out with distance: 1-pixel lines would only add noise far away
    update(camera) {
      const hp = head.getWorldPosition(new THREE.Vector3());
      const d = camera.position.distanceTo(hp);
      const k = THREE.MathUtils.clamp(1.6 - d / 2.5, 0, 1);
      for (const m of mats) m.opacity = m.userData.baseOpacity * k;
    },
    setColor(c) {
      for (const m of mats) m.color.set(c);
    },
  };
}
