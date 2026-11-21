// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Eyelashes, muzzle whiskers (vibrissae) and tactile hairs over the eyes.
// Thin line strands parented to the head bone, rooted on the actual skin.

import * as THREE from 'three';
import { EAR, EYE, EYE_LID, HEAD, eyeFrame, eyePoint } from './rig.js';

const DEG = Math.PI / 180;
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

  // ---- eyelashes on the lid margins (EYE_LID, as sculpted in anatomy.js) ----
  // Upper lashes ride the blinking lid when there is one (horse.eyes).
  const upperLash = [[], []];
  const R = EYE.radius;
  [1, -1].forEach((side, si) => {
    const F = eyeFrame(side);
    const dirAt = (az, el) => {
      // outward normal of the eye sphere at (az, el)
      const p = eyePoint(F, az, el, 1);
      return sub(p, F.c);
    };
    for (let i = 0; i < 56; i++) {
      const t = 0.08 + 0.88 * (i / 55) + (r() - 0.5) * 0.008;
      const az = EYE_LID.az(t), el = EYE_LID.el(t, true);
      // rooted on the outer edge of the lid margin
      const root = eyePoint(F, az, el + 1 * DEG, R + 0.0036);
      // longest a little behind the middle, reaching out over the eye and
      // curving down
      const len = (0.006 + 0.015 * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.2)), 0.8)) * (0.75 + 0.5 * r());
      const d0 = addv(addv(sc(F.z, 0.9), sc(F.u, 0.3)), sc(F.x, F.side * Math.cos(Math.PI * t) * 0.35 + (r() - 0.5) * 0.15));
      hairLine(upperLash[si], root, d0, len, sc(F.u, -1), 0.28, 4);
    }
    // short lower lashes
    for (let i = 0; i < 18; i++) {
      const t = 0.25 + 0.6 * (i / 17);
      const az = EYE_LID.az(t), el = EYE_LID.el(t, false);
      const root = eyePoint(F, az, el - 1 * DEG, R + 0.0026);
      hairLine(lash, root, addv(sc(F.z, 0.85), sc(F.u, -0.45)), 0.0035 + 0.003 * r(), sc(F.u, -1), 0.2, 2);
    }
    // supraorbital tactile hairs above the lid
    for (let i = 0; i < 7; i++) {
      const t = 0.25 + 0.55 * r();
      const az = EYE_LID.az(t), el = EYE_LID.el(t, true) + 32 * DEG;
      const root = eyePoint(F, az, el, R + 0.0075);
      hairLine(whisk, root, addv(sc(dirAt(az, el), 0.8), sc(F.u, 0.6)), 0.03 + 0.015 * r(), [0, -1, 0], 0.08, 5);
    }
  });

  // ---- muzzle whiskers: rooted on skin vertices of the lips, chin and nostrils ----
  const P = horse.geometry.attributes.restPos.array;
  const N = horse.geometry.attributes.normal.array;
  const AO = horse.geometry.attributes.aoCurv?.array;
  const J = HEAD.joint;
  const cands = [];
  for (let i = 0; i < P.length / 3; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const d = sub(p, J);
    const a = dot(d, u), b = dot(d, v);
    if (!(a > 0.44 && a < 0.575 && b > 0.0 && b < 0.165 && Math.abs(p[2]) > 0.012)) continue;
    if (Math.abs(b - 0.106 + 0.1 * (a - 0.51)) < 0.008) continue; // the mouth line
    if (AO && AO[i * 2] < 0.7) continue; // inside the nostrils and the mouth
    cands.push(i);
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

  // ---- ear hair: pale tufts filling the hollow of each ear ----
  const earHair = { R: [], L: [] };
  {
    const SI = horse.geometry.attributes.skinIndex.array;
    const SW = horse.geometry.attributes.skinWeight.array;
    const bonesList = horse.skeleton.bones;
    for (const sd of ['R', 'L']) {
      const z = sd === 'R' ? 1 : -1;
      const bi = bonesList.findIndex((b) => b.name === 'ear_' + sd);
      const fwd = nrm([1, -0.2, 0.3 * z]);
      const edir = nrm([EAR.dir[0], EAR.dir[1], EAR.dir[2] * z]);
      const ec = [];
      for (let i = 0; i < P.length / 3; i++) {
        if (SI[i * 4] !== bi || SW[i * 4] < 0.85) continue;
        const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
        if (dot(n, fwd) < 0.35 || (AO && AO[i * 2] > 0.86)) continue;
        ec.push(i);
      }
      const er = rng(sd === 'R' ? 31 : 32);
      const roots = [];
      for (let k = 0; k < 4000 && roots.length < 90; k++) {
        const i = ec[Math.floor(er() * ec.length)];
        if (i === undefined) break;
        const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
        if (roots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.003)) continue;
        roots.push(p);
        const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
        const d0 = addv(addv(sc(n, 0.3), sc(edir, 0.9)), [(er() - 0.5) * 0.25, (er() - 0.5) * 0.1, (er() - 0.5) * 0.25]);
        hairLine(earHair[sd], p, d0, 0.007 + 0.011 * er(), sc(fwd, 1), 0.1, 3);
      }
    }
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
  for (const sd of ['R', 'L']) {
    const bone = horse.bones['ear_' + sd];
    const br = bone.userData.rest;
    const arr = earHair[sd];
    const f = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      f[i] = arr[i] - br[0];
      f[i + 1] = arr[i + 1] - br[1];
      f[i + 2] = arr[i + 2] - br[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(f, 3));
    // pale, not tinted with the coat: ear hair is light on most horses
    const m = new THREE.LineBasicMaterial({ color: '#b9a48c', transparent: true, opacity: 0.6, depthWrite: false });
    m.userData.baseOpacity = 0.6;
    m.userData.keepColor = true;
    mats.push(m);
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    bone.add(l);
  }
  make(lash, 0.95);
  make(whisk, 0.4);
  // upper lashes: on the lid pivots when the eyes have blinking lids
  [0, 1].forEach((si) => {
    const pts = upperLash[si];
    if (!horse.eyes) {
      make(pts, 0.95);
      return;
    }
    const f = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 3) f.set(horse.eyes.toFrame(si, [pts[i], pts[i + 1], pts[i + 2]]), i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(f, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    m.userData.baseOpacity = 0.8;
    mats.push(m);
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    horse.eyes.sides[si].lashPivot.add(l);
  });
  return {
    // fade out with distance: 1-pixel lines would only add noise far away
    update(camera) {
      const hp = head.getWorldPosition(new THREE.Vector3());
      const d = camera.position.distanceTo(hp);
      const k = THREE.MathUtils.clamp(1.6 - d / 2.5, 0, 1);
      for (const m of mats) m.opacity = m.userData.baseOpacity * k;
    },
    setColor(c) {
      for (const m of mats) if (!m.userData.keepColor) m.color.set(c);
    },
  };
}
