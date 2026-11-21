// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Eyes: an eyeball with a horizontal pupil, a separate cornea that carries the
// reflections (so they ride a little above the iris, as on a real eye), the
// third eyelid at the inner corner, an upper lid that blinks, and a gaze that
// leads head turns and makes small saccades.
//
// Blinks follow what is known of horses at rest: full blinks every few
// seconds, about as many half blinks, an extra blink with a large gaze shift,
// and lids that droop a little when the horse has stood still for a while.

import * as THREE from 'three';
import { EYE, EYE_LID, eyeFrame } from './rig.js';

const DEG = Math.PI / 180;
// Lid shell edge elevation in front of the eye: open, it hides under the
// upper lid margin; closed, it tucks behind the lower one.
const LID_OPEN = EYE_LID.upper + 7 * DEG;
const LID_CLOSED = EYE_LID.lower - 7 * DEG;

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
const smooth = (t) => t * t * (3 - 2 * t);

export class Eyes {
  constructor(horse) {
    const head = horse.bones.head;
    const rest = head.userData.rest;
    const R = EYE.radius;
    this.sides = [];
    this.rand = rng(77);

    const eyeGeo = new THREE.SphereGeometry(R, 64, 40);
    this.eyeMat = new THREE.MeshPhysicalMaterial({ map: makeEyeTexture(), roughness: 0.42, ior: 1.376 });
    // cornea: a clear cap bulging ~1.5 mm in front of the iris; only its
    // reflections are drawn (black, additive)
    const cornea = new THREE.SphereGeometry(R * 0.82, 48, 16, 0, Math.PI * 2, 0, 0.76);
    cornea.rotateX(Math.PI / 2);
    cornea.translate(0, 0, R * 0.18 + 0.0015);
    this.corneaMat = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lidGeo = makeLidGeometry(R);
    this.lidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.lidGeo = lidGeo;
    const caruncleGeo = new THREE.SphereGeometry(1, 16, 12);
    this.caruncleMat = new THREE.MeshStandardMaterial({ color: '#5a2c2a', roughness: 0.3 });

    for (const side of [1, -1]) {
      const F = eyeFrame(side);
      const frame = new THREE.Object3D();
      frame.name = side > 0 ? 'eye_R' : 'eye_L';
      frame.position.set(F.c[0] - rest[0], F.c[1] - rest[1], F.c[2] - rest[2]);
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.x), new THREE.Vector3(...F.u), new THREE.Vector3(...F.z));
      frame.quaternion.setFromRotationMatrix(basis);
      head.add(frame);

      // gaze group: eyeball + cornea
      const gaze = new THREE.Group();
      gaze.rotation.order = 'YXZ';
      frame.add(gaze);
      const ball = new THREE.Mesh(eyeGeo, this.eyeMat);
      // keep the pupil level with the ground in a normal head carriage
      const z = new THREE.Vector3(...F.z), x = new THREE.Vector3(...F.x);
      const hx = new THREE.Vector3(0, 1, 0).cross(z).normalize();
      if (hx.dot(x) < 0) hx.negate();
      ball.rotation.z = Math.atan2(new THREE.Vector3().crossVectors(x, hx).dot(z), x.dot(hx));
      ball.receiveShadow = true;
      gaze.add(ball);
      const cap = new THREE.Mesh(cornea, this.corneaMat);
      cap.renderOrder = 2;
      gaze.add(cap);

      // third eyelid, a small pink fold in the inner corner
      const car = new THREE.Mesh(caruncleGeo, this.caruncleMat);
      const az = EYE_LID.cornerAz - 6 * DEG, el = EYE_LID.innerEl + 2 * DEG;
      car.position.set(Math.sin(az) * Math.cos(el) * R * 0.97, Math.sin(el) * R * 0.97, Math.cos(az) * Math.cos(el) * R * 0.97);
      car.scale.set(0.0042, 0.0032, 0.003);
      frame.add(car);

      // upper lid shell (rotates about the frame's x axis to blink)
      const lid = new THREE.Mesh(lidGeo, this.lidMat);
      lid.rotation.x = -LID_OPEN;
      lid.receiveShadow = true;
      frame.add(lid);
      // upper lashes ride on this pivot (FacialHairs adds them)
      const lashPivot = new THREE.Object3D();
      frame.add(lashPivot);

      this.sides.push({ side, F, frame, gaze, lid, lashPivot });
    }

    this.blink = { t: -1, amp: 1, next: 1 + 3 * this.rand(), value: 0 };
    this.gazeState = { yaw: 0, pitch: 0, tx: 0, ty: 0, timer: 0.5, lastTYaw: 0 };
    this.stillTime = 0;
  }

  // world-rest point -> eye-frame local coordinates (for things that ride the lid)
  toFrame(sideIndex, p) {
    const { F } = this.sides[sideIndex];
    const d = [p[0] - F.c[0], p[1] - F.c[1], p[2] - F.c[2]];
    const dot = (a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
    return [dot(F.x), dot(F.u), dot(F.z)];
  }

  setColors(body, skin) {
    const c = this.lidGeo.attributes.color;
    const w = this.lidGeo.userData.skinW;
    const a = new THREE.Color(body), b = new THREE.Color(skin), o = new THREE.Color();
    for (let i = 0; i < w.length; i++) {
      o.copy(a).lerp(b, w[i]);
      c.setXYZ(i, o.r, o.g, o.b);
    }
    c.needsUpdate = true;
  }

  triggerBlink(amp = 1) {
    if (this.blink.t >= 0) return;
    this.blink.t = 0;
    this.blink.amp = amp;
  }

  update(dt, loco) {
    const r = this.rand;
    const b = this.blink;
    // spontaneous blinks: full and half blinks, a few seconds apart
    b.next -= dt;
    if (b.next <= 0) {
      this.triggerBlink(r() < 0.45 ? 0.35 + 0.3 * r() : 1);
      b.next = 1.2 + -Math.log(1 - r() * 0.98) * 3.2;
    }
    // gaze: saccades, and the eyes lead the head toward where it turns
    const g = this.gazeState;
    const h = loco.headLook;
    if (Math.abs(h.tYaw - g.lastTYaw) > 0.25 && r() < 0.6) this.triggerBlink(1);
    g.lastTYaw = h.tYaw;
    g.timer -= dt;
    if (g.timer <= 0) {
      g.tx = (r() - 0.5) * 0.07;
      g.ty = (r() - 0.5) * 0.04;
      g.timer = 0.4 + 2.2 * r();
    }
    const lead = THREE.MathUtils.clamp((h.tYaw - h.yaw) * 0.6, -0.2, 0.2);
    const k = 1 - Math.exp(-dt * 28);
    g.yaw += (g.tx + lead - g.yaw) * k;
    g.pitch += (g.ty - g.pitch) * k;

    // blink profile: fast close, short hold, slower opening
    let v = 0;
    if (b.t >= 0) {
      b.t += dt;
      const tc = 0.085, th = 0.035, to = 0.2;
      if (b.t < tc) v = smooth(b.t / tc);
      else if (b.t < tc + th) v = 1;
      else if (b.t < tc + th + to) v = 1 - smooth((b.t - tc - th) / to);
      else b.t = -1;
      v *= b.amp;
    }
    // a relaxed, resting horse lets its upper lids droop a little
    this.stillTime = loco.standing ? this.stillTime + dt : 0;
    const droop = 0.16 * smooth(THREE.MathUtils.clamp((this.stillTime - 6) / 8, 0, 1));
    b.value = Math.max(v, droop);
    const ang = LID_OPEN + (LID_CLOSED - LID_OPEN) * b.value;
    for (const s of this.sides) {
      s.lid.rotation.x = -ang;
      s.lashPivot.rotation.x = (LID_OPEN - ang) * 0.9;
      s.gaze.rotation.set(g.pitch, g.yaw, 0);
    }
  }
}

// Upper lid: a hemispherical shell just outside the cornea whose rim rolls
// inward onto the eye, so the closing lid shows a rounded margin. Built like
// three.js's SphereGeometry (cap around +y) so the faces point outward.
function makeLidGeometry(R) {
  const Rl = R + 0.0028, Rin = R + 0.0019;
  const segs = 48, rings = 22;
  const tEnd = Math.PI / 2 + 0.32;
  const pos = [], skinW = [], idx = [];
  for (let iy = 0; iy <= rings; iy++) {
    const th = (iy / rings) * tEnd;
    const tuck = smooth(THREE.MathUtils.clamp((th - (Math.PI / 2 - 0.06)) / 0.38, 0, 1));
    const r = Rl + (Rin - Rl) * tuck;
    const w = smooth(THREE.MathUtils.clamp((th - (Math.PI / 2 - 0.3)) / 0.26, 0, 1));
    for (let ix = 0; ix <= segs; ix++) {
      const ph = (ix / segs) * Math.PI * 2;
      pos.push(-r * Math.cos(ph) * Math.sin(th), r * Math.cos(th), r * Math.sin(ph) * Math.sin(th));
      skinW.push(w);
    }
  }
  for (let iy = 0; iy < rings; iy++)
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * (segs + 1) + ix + 1, b = iy * (segs + 1) + ix;
      const c = (iy + 1) * (segs + 1) + ix, d = (iy + 1) * (segs + 1) + ix + 1;
      if (iy !== 0) idx.push(a, b, d);
      idx.push(b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0.5), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.skinW = skinW;
  return g;
}

function makeEyeTexture() {
  const W = 1024, Hh = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d');
  const r = rng(11);
  // Sphere UVs: u wraps around y and the +z pole (the front) is at u = 0.25;
  // 1 px = 2π/1024 rad both ways.
  g.fillStyle = '#2a1a12';
  g.fillRect(0, 0, W, Hh);
  const cx = W * 0.25, cy = Hh / 2;
  // iris: warm dark brown, lighter in a band around the pupil
  const grad = g.createRadialGradient(cx, cy, 20, cx, cy, 190);
  grad.addColorStop(0, '#1a0d06');
  grad.addColorStop(0.3, '#4a2a14');
  grad.addColorStop(0.55, '#3c2210');
  grad.addColorStop(0.85, '#24140a');
  grad.addColorStop(1, '#140b06');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(cx, cy, 190, 165, 0, 0, Math.PI * 2);
  g.fill();
  // radial fibres
  for (let i = 0; i < 1400; i++) {
    const a = r() * Math.PI * 2;
    const r0 = 45 + r() * 40, r1 = 110 + r() * 75;
    const l = 0.12 + r() * 0.2;
    g.strokeStyle = r() < 0.6 ? `rgba(${110 + r() * 50},${66 + r() * 30},${30 + r() * 15},${l})` : `rgba(8,4,2,${l})`;
    g.lineWidth = 0.8 + r() * 1.4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.87);
    g.lineTo(cx + Math.cos(a + (r() - 0.5) * 0.08) * r1, cy + Math.sin(a) * r1 * 0.87);
    g.stroke();
  }
  // darker limbal ring
  g.strokeStyle = 'rgba(10,5,2,0.55)';
  g.lineWidth = 16;
  g.beginPath();
  g.ellipse(cx, cy, 182, 158, 0, 0, Math.PI * 2);
  g.stroke();
  // horizontal oval pupil with soft edge
  const pg = g.createRadialGradient(cx, cy, 10, cx, cy, 80);
  pg.addColorStop(0, '#000');
  pg.addColorStop(0.85, '#020100');
  pg.addColorStop(1, 'rgba(2,1,0,0)');
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.42);
  g.fillStyle = pg;
  g.beginPath();
  g.arc(0, 0, 82, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // corpora nigra: dark grape-like bodies along the top of the pupil
  for (let i = 0; i < 5; i++) {
    const x = cx - 36 + i * 18 + (r() - 0.5) * 6;
    const rr = 9 + r() * 6;
    const cg = g.createRadialGradient(x - 2, cy - 33 - 2, 1, x, cy - 33, rr);
    cg.addColorStop(0, '#2e1a0e');
    cg.addColorStop(1, '#0a0503');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(x, cy - 32, rr, rr * 0.7, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
