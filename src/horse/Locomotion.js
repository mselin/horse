// Procedural locomotion: footfall-driven leg state machines, planar two-bone
// IK with gait-dependent distal joint folding, load-driven body motion, neck
// nodding, spine flexion, tail carriage and ear "attention".

import * as THREE from 'three';
import { GAITS, GAIT_ORDER, GAIT_UP, GAIT_DOWN, LEGS, blendGait } from './gaits.js';
import { FORE, HIND } from './rig.js';

const TAU = Math.PI * 2;
const mod1 = (x) => ((x % 1) + 1) % 1;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => t * t * (3 - 2 * t);
const bump = (w, p, q = 1) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp(w, 0, 1), p))), q);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

class Leg {
  constructor(name, bones) {
    this.name = name;
    this.side = name[0] === 'L' ? -1 : 1;
    this.fore = name[1] === 'F';
    this.key = this.fore ? 'F' : 'H';
    const s = this.side === 1 ? 'R' : 'L';
    const names = this.fore
      ? ['scap_', 'humerus_', 'radius_', 'fcannon_', 'fpastern_', 'fhoof_']
      : ['femur_', 'tibia_', 'hcannon_', 'hpastern_', 'hhoof_'];
    this.bones = names.map((n) => bones[n + s]);
    this.parent = bones[this.fore ? 'thorax' : 'pelvis'];
    const pr = this.parent.userData.rest;
    this.P = this.bones.map((b) => [b.userData.rest[0] - pr[0], b.userData.rest[1] - pr[1], b.userData.rest[2] - pr[2]]);
    this.v = [];
    for (let i = 0; i < this.P.length - 1; i++) this.v.push([this.P[i + 1][0] - this.P[i][0], this.P[i + 1][1] - this.P[i][1]]);
    const L = this.fore ? FORE : HIND;
    this.restToe = new THREE.Vector3(L.toe[0], 0, L.toe[2] * this.side); // root space
    this.toeToCoffin = [L.coffin[0] - L.toe[0], L.coffin[1] - L.toe[1]];
    this.restCoffinLocal = new THREE.Vector3(L.coffin[0] - pr[0], L.coffin[1] - pr[1], L.coffin[2] * this.side - pr[2]);

    this.stance = true;
    this.hold = false;
    this.toe = new THREE.Vector3(); // planted toe (world)
    this.liftCoffin = new THREE.Vector3();
    this.liftPitch = 0;
    this.landToe = new THREE.Vector3();
    this.coffinTarget = new THREE.Vector3();
    this.hoofPitch = 0; // desired world pitch of the hoof (stance)
    this.s = 0;
    this.w = 0;
    this.load = 0;
  }
}

export class Locomotion {
  constructor(horse) {
    this.horse = horse;
    this.bones = horse.bones;
    this.root = horse.group; // world placement
    this.legs = LEGS.map((n) => new Leg(n, horse.bones));
    this.legByName = Object.fromEntries(this.legs.map((l) => [l.name, l]));

    this.speed = 0; // m/s actual
    this.targetSpeed = 0;
    this.steer = 0; // -1..1
    this.yaw = 0;
    this.yawRate = 0;
    this.phase = 0;
    this.freq = 1;
    this.gaitName = 'walk';
    this.prevGait = GAITS.walk;
    this.gaitBlend = 1;
    this.params = blendGait(GAITS.walk, GAITS.walk, 1);
    this.standing = true;
    this.time = 0;
    this.listeners = [];

    // secondary motion state
    this.tailState = { a: 0, v: 0 };
    this.headLook = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, timer: 2 };
    this.ears = { l: 0, r: 0, tl: 0, tr: 0, timer: 1 };
    this.lean = 0;
    this.prevBodyY = 0;

    this.resetFeet();
  }

  onFootfall(fn) {
    this.listeners.push(fn);
  }

  resetFeet() {
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) {
      leg.toe.copy(leg.restToe).applyMatrix4(this.root.matrixWorld);
      leg.stance = true;
      leg.hold = true;
      leg.coffinTarget.set(leg.toe.x + leg.toeToCoffin[0], leg.toeToCoffin[1], leg.toe.z);
    }
  }

  // ---- gait selection ------------------------------------------------------
  chooseGait(v) {
    const idx = GAIT_ORDER.indexOf(this.gaitName);
    let name = this.gaitName;
    if (idx < 3 && v > GAIT_UP[this.gaitName]) name = GAIT_ORDER[idx + 1];
    else if (idx > 0 && v < GAIT_DOWN[this.gaitName]) name = GAIT_ORDER[idx - 1];
    if (this.forcedGait) name = this.forcedGait;
    if (name !== this.gaitName) {
      // freeze the current blended parameters as the start of the new blend
      this.prevGait = { ...this.params, duty: { ...this.params.duty }, phase: { ...this.params.phase }, swingH: { ...this.params.swingH }, stanceShift: { ...this.params.stanceShift } };
      this.gaitName = name;
      this.gaitBlend = 0;
    }
  }

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const B = this.bones;

    // ---- speed / heading ----
    const accel = this.targetSpeed > this.speed ? 3.2 : 4.5;
    this.speed += clamp(this.targetSpeed - this.speed, -accel * dt, accel * dt);
    if (this.speed < 0.02 && this.targetSpeed === 0) this.speed = 0;
    const v = this.speed;
    const maxTurn = 1.3 / Math.max(1, v * 0.35);
    const targetYawRate = this.steer * maxTurn * clamp(v / 1.2, 0.35, 1);
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, dt * 3);
    this.chooseGait(Math.max(v, 0.6));

    // ---- gait parameters ----
    const g = GAITS[this.gaitName];
    this.gaitBlend = Math.min(1, this.gaitBlend + dt * 1.6);
    const p = blendGait(this.prevGait, g, smooth(this.gaitBlend), this.params);
    const fTarget = g.freq(clamp(Math.max(v, 0.9), g.speed[0], g.speed[1]));
    this.freq += (fTarget - this.freq) * Math.min(1, dt * 4);

    // standing / stopping logic
    const stopping = this.targetSpeed < 0.05 && v < 0.6;
    let anyFar = false;
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) {
      const n = _v.copy(leg.restToe).applyMatrix4(this.root.matrixWorld);
      leg.neutralDist = Math.hypot(n.x - leg.toe.x, n.z - leg.toe.z);
      if (!leg.stance || leg.neutralDist > 0.07) anyFar = true;
    }
    const moving = !stopping || anyFar;
    if (moving) {
      this.standing = false;
      this.phase = mod1(this.phase + this.freq * dt);
    } else {
      this.standing = true;
      for (const leg of this.legs) if (leg.stance) leg.hold = true;
    }

    // ---- root motion ----
    this.yaw += this.yawRate * dt;
    this.root.rotation.y = this.yaw;
    const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.root.position.addScaledVector(fwd, v * dt);
    this.root.updateMatrixWorld(true);

    // ---- leg phases and footfalls ----
    const loads = { F: 0, H: 0, L: 0, R: 0, all: 0 };
    const lagPhase = this.phase - 0.04;
    for (const leg of this.legs) {
      const D = p.duty[leg.key];
      const psi = mod1(this.phase - p.phase[leg.name]);
      const inStance = psi < D;
      if (inStance) {
        if (!leg.stance) {
          leg.stance = true;
          leg.toe.copy(leg.landToe);
          leg.toe.y = 0;
          for (const fn of this.listeners) fn(leg, leg.toe, v);
        }
        leg.hold = false;
        leg.s = psi / D;
      } else {
        if (leg.stance) {
          leg.hold = stopping && leg.neutralDist < 0.07;
          if (!leg.hold) {
            leg.stance = false;
            leg.liftCoffin.copy(leg.coffinTarget);
            leg.liftPitch = leg.hoofPitch;
          }
        }
        leg.w = (psi - D) / (1 - D);
      }
      // lagged load signal for body dynamics
      const pl = mod1(lagPhase - p.phase[leg.name]);
      const ld = pl < D && moving ? Math.sin((Math.PI * pl) / D) : 0;
      leg.load = ld;
      loads[leg.key] += ld;
      loads[leg.side < 0 ? 'L' : 'R'] += ld;
      loads.all += ld;
    }
    const meanAll = (2 / Math.PI) * 2 * (p.duty.F + p.duty.H);
    const meanF = (2 / Math.PI) * 2 * p.duty.F;
    const meanH = (2 / Math.PI) * 2 * p.duty.H;

    // ---- body pose ----
    const mv = moving ? clamp(v / 1.0, 0, 1) : 0;
    const bodyY = -p.bob * (loads.all - meanAll) * mv - p.bodyDrop * clamp(v / 10, 0, 1);
    const pitch = p.pitch * (loads.H - meanH - (loads.F - meanF)) * 0.5 * mv;
    const roll = p.roll * (loads.R - loads.L) * 0.5 * mv;
    const turnLean = -clamp((v * this.yawRate) / 9.81, -0.5, 0.5) * 0.55;
    this.lean += (turnLean - this.lean) * Math.min(1, dt * 4);
    const breathe = Math.sin(this.time * (this.standing ? 1.6 : 4)) * 0.0025;
    const body = B.body;
    body.position.set(body.userData.restLocal.x, body.userData.restLocal.y + bodyY + breathe, body.userData.restLocal.z + roll * 0.4);
    _e.set(roll + this.lean, 0, pitch, 'XYZ');
    body.quaternion.setFromEuler(_e);

    // spine flexion (lumbosacral) – flexed as the hinds land, extended in fore stance
    const lumb = p.lumbar * Math.cos(TAU * (this.phase - 0.02)) * mv;
    B.lumbar.quaternion.setFromAxisAngle(Z, lumb * 0.4);
    B.pelvis.quaternion.setFromAxisAngle(Z, lumb * 0.6);
    B.thorax.quaternion.setFromAxisAngle(Z, -lumb * 0.25);

    // ---- neck & head ----
    this.updateHeadLook(dt, v);
    const nod = -p.nod * (loads.F - meanF) * 0.5 * mv;
    const carriage = p.neckCarriage * clamp(v / 6, 0, 1) - 0.04 * mv;
    const neckPitch = carriage + nod + this.headLook.pitch;
    const nw = [0.34, 0.24, 0.17, 0.13, 0.12];
    const ny = [0.1, 0.2, 0.25, 0.25, 0.2];
    for (let i = 0; i < 5; i++) {
      _e.set(0, this.headLook.yaw * ny[i], neckPitch * nw[i], 'YZX');
      B['neck' + i].quaternion.setFromEuler(_e);
    }
    const comp = 0.55 - 0.3 * clamp((v - 5) / 8, 0, 1);
    _e.set(0, this.headLook.yaw * 0.1, -neckPitch * comp + nod * 0.3 + 0.1 * clamp((v - 6) / 8, 0, 1), 'YZX');
    B.head.quaternion.setFromEuler(_e);

    // ears
    this.updateEars(dt, v);

    // tail carriage + spring
    const ts = this.tailState;
    const bodyVy = (bodyY - this.prevBodyY) / Math.max(dt, 1e-3);
    this.prevBodyY = bodyY;
    const tailTarget = -p.tailLift * clamp(v / 8, 0, 1) + (this.standing ? 0.04 * Math.sin(this.time * 0.7) : 0);
    ts.v += ((tailTarget - ts.a) * 60 - ts.v * 9 + bodyVy * 6) * dt;
    ts.a += ts.v * dt;
    for (let i = 0; i < 6; i++) {
      const k = i === 0 ? 0.6 : 0.12;
      _e.set(0, Math.sin(this.time * 1.3 + i * 0.6) * 0.03 * (this.standing ? 1 : 0.3), ts.a * k - i * 0.01 * ts.v * 0.02, 'XYZ');
      B['tail' + i].quaternion.setFromEuler(_e);
    }

    this.root.updateMatrixWorld(true);

    // ---- legs ----
    const yaw = this.yaw;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    for (const leg of this.legs) {
      const D = p.duty[leg.key];
      const Tst = D / this.freq;
      // predicted landing spot
      if (!leg.stance) {
        const tRem = ((1 - leg.w) * (1 - D)) / this.freq;
        const yawF = yaw + this.yawRate * tRem;
        const ahead = (moving ? v * Tst * 0.5 : 0) + (stopping ? 0 : p.stanceShift[leg.key] * mv);
        const lx = leg.restToe.x + ahead, lz = leg.restToe.z;
        const cf = Math.cos(yawF), sf = Math.sin(yawF);
        leg.landToe.set(
          this.root.position.x + fwd.x * v * tRem + lx * cf + lz * sf,
          0,
          this.root.position.z + fwd.z * v * tRem - lx * sf + lz * cf
        );
      }

      // coffin target + desired hoof pitch
      let hoofAbs = null;
      let swingRelCoffin = 0;
      if (leg.stance) {
        const bo = leg.hold ? 0 : -p.breakover * smooth(clamp((leg.s - 0.62) / 0.38, 0, 1));
        leg.hoofPitch = bo;
        const cx = leg.toeToCoffin[0] * Math.cos(bo) - leg.toeToCoffin[1] * Math.sin(bo);
        const cy = leg.toeToCoffin[0] * Math.sin(bo) + leg.toeToCoffin[1] * Math.cos(bo);
        leg.coffinTarget.set(leg.toe.x + cx * cosY, leg.toe.y + cy, leg.toe.z - cx * sinY);
        hoofAbs = bo;
      } else {
        const w = leg.w;
        const landCoffin = _v.set(leg.landToe.x + leg.toeToCoffin[0] * cosY, leg.toeToCoffin[1], leg.landToe.z - leg.toeToCoffin[0] * sinY);
        const e = smooth(clamp((w - 0.04) / 0.9, 0, 1));
        leg.coffinTarget.lerpVectors(leg.liftCoffin, landCoffin, e);
        leg.coffinTarget.y += p.swingH[leg.key] * bump(w, 0.75, 1.1) * clamp(v / 1.2 + 0.4, 0.4, 1);
        swingRelCoffin = -p.coffinFlex * bump(w, 0.6);
        if (w > 0.78) hoofAbs = 0.06 * bump((w - 0.78) / 0.22, 1);
        if (w < 0.12) hoofAbs = leg.liftPitch * (1 - w / 0.12) - 0.4 * (w / 0.12);
        leg.hoofPitch = hoofAbs ?? 0;
      }

      this.solveLeg(leg, p, hoofAbs, swingRelCoffin);
    }
  }

  solveLeg(leg, p, hoofAbs, swingRelCoffin) {
    // target into parent-local space
    leg.parent.updateWorldMatrix(true, false);
    _m.copy(leg.parent.matrixWorld).invert();
    const T = _v.copy(leg.coffinTarget).applyMatrix4(_m);
    // parent world pitch (rotation of its X axis in the vertical plane)
    const e = leg.parent.matrixWorld.elements;
    const ax = new THREE.Vector3(e[0], e[1], e[2]).normalize();
    const parentPitch = Math.asin(clamp(ax.y, -1, 1));

    const st = leg.stance;
    const s = leg.s, w = leg.w;
    const P = leg.P, V = leg.v;
    const hold = leg.hold;

    // distal joint curves
    const fetlock = st ? (hold ? 0 : p.fetlockExt * Math.pow(Math.sin(Math.PI * s), 1.4)) : -p.fetlockFlex * bump(w, 0.55, 1.2);
    const roll = clamp(-Math.atan2(T.z - leg.restCoffinLocal.z, Math.max(0.3, P[0][1] - T.y)), -0.25, 0.25);

    if (leg.fore) {
      const carpus = st ? 0 : -p.carpusFlex * bump(w, 0.62, 1.25);
      const dxN = T.x - leg.restCoffinLocal.x;
      const scap = clamp((p.scap * dxN) / 0.65, -0.4, 0.45);
      const A0 = scap;
      const [v0, v1, v2, v3, v4] = V;
      const Sx = P[0][0] + v0[0] * Math.cos(A0) - v0[1] * Math.sin(A0);
      const Sy = P[0][1] + v0[0] * Math.sin(A0) + v0[1] * Math.cos(A0);
      // composite elbow -> coffin in radius frame
      const c1 = Math.cos(carpus), s1 = Math.sin(carpus);
      const c2 = Math.cos(carpus + fetlock), s2 = Math.sin(carpus + fetlock);
      const Ex = v2[0] + v3[0] * c1 - v3[1] * s1 + v4[0] * c2 - v4[1] * s2;
      const Ey = v2[1] + v3[0] * s1 + v3[1] * c1 + v4[0] * s2 + v4[1] * c2;
      const { a1, a2 } = twoBone(Sx, Sy, T.x, T.y, v1, [Ex, Ey], -1);
      setZ(leg.bones[0], A0, roll);
      setZ(leg.bones[1], a1 - A0);
      setZ(leg.bones[2], a2 - a1);
      setZ(leg.bones[3], carpus);
      setZ(leg.bones[4], fetlock);
      const absBeforeHoof = a2 + carpus + fetlock;
      let coffin;
      if (hoofAbs !== null) coffin = hoofAbs - parentPitch - absBeforeHoof;
      if (!st) {
        const rel = swingRelCoffin;
        coffin = hoofAbs === null ? rel : coffin;
      }
      setZ(leg.bones[5], clamp(coffin, -1.7, 0.6));
    } else {
      const hockStance = st && !hold ? 0.14 * p.hockFlex * Math.sin(Math.PI * s) : 0;
      const hock = st ? hockStance : p.hockFlex * bump(w, 0.62, 1.1);
      const [v0, v1, v2, v3] = V;
      const c1 = Math.cos(hock), s1 = Math.sin(hock);
      const c2 = Math.cos(hock + fetlock), s2 = Math.sin(hock + fetlock);
      const Ex = v1[0] + v2[0] * c1 - v2[1] * s1 + v3[0] * c2 - v3[1] * s2;
      const Ey = v1[1] + v2[0] * s1 + v2[1] * c1 + v3[0] * s2 + v3[1] * c2;
      const { a1, a2 } = twoBone(P[0][0], P[0][1], T.x, T.y, v0, [Ex, Ey], 1);
      setZ(leg.bones[0], a1, roll);
      setZ(leg.bones[1], a2 - a1);
      setZ(leg.bones[2], hock);
      setZ(leg.bones[3], fetlock);
      const absBeforeHoof = a2 + hock + fetlock;
      let coffin = hoofAbs !== null ? hoofAbs - parentPitch - absBeforeHoof : swingRelCoffin;
      setZ(leg.bones[4], clamp(coffin, -1.7, 0.6));
    }
  }

  updateHeadLook(dt, v) {
    const h = this.headLook;
    h.timer -= dt;
    if (h.timer <= 0) {
      const idle = v < 0.5;
      h.tYaw = idle ? (Math.random() - 0.5) * 0.9 : (Math.random() - 0.5) * 0.12;
      h.tPitch = idle ? (Math.random() - 0.6) * 0.25 : (Math.random() - 0.5) * 0.05;
      h.timer = idle ? 2 + Math.random() * 4 : 1.5 + Math.random() * 2;
    }
    const steerLook = this.steer * 0.25 * clamp(v / 3, 0, 1);
    const k = Math.min(1, dt * 1.6);
    h.yaw += (h.tYaw + steerLook - h.yaw) * k;
    h.pitch += (h.tPitch - h.pitch) * k;
  }

  updateEars(dt, v) {
    const e = this.ears;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.tl = (Math.random() - 0.4) * 0.9;
      e.tr = Math.random() < 0.6 ? e.tl + (Math.random() - 0.5) * 0.3 : (Math.random() - 0.4) * 0.9;
      e.timer = 0.6 + Math.random() * 2.5;
    }
    const pinned = clamp((v - 8) / 6, 0, 1) * 0.5;
    const k = Math.min(1, dt * 7);
    e.l += (e.tl + pinned - e.l) * k;
    e.r += (e.tr + pinned - e.r) * k;
    // positive = ear turns its opening outward/back and tips back
    _e.set(0, -e.r * 1.0, e.r * 0.45, 'YXZ');
    this.bones.ear_R.quaternion.setFromEuler(_e);
    _e.set(0, e.l * 1.0, e.l * 0.45, 'YXZ');
    this.bones.ear_L.quaternion.setFromEuler(_e);
  }

  setGait(name) {
    this.forcedGait = name;
    if (name) {
      const [a, b] = GAITS[name].speed;
      this.targetSpeed = (a + b) / 2;
    }
  }
}

function setZ(bone, angle, roll = 0) {
  if (roll) {
    _e.set(roll, 0, angle, 'XYZ');
    bone.quaternion.setFromEuler(_e);
  } else bone.quaternion.setFromAxisAngle(Z, angle);
}

// Planar two-bone IK. Bone 1 rest vector v1 starts at (sx,sy); bone 2's rest
// vector (composite) is e2. bend = -1 puts the middle joint behind the line
// (elbow), +1 in front (stifle). Returns absolute rotations of both bones.
function twoBone(sx, sy, tx, ty, v1, e2, bend) {
  const L1 = Math.hypot(v1[0], v1[1]);
  const L2 = Math.hypot(e2[0], e2[1]);
  let dx = tx - sx, dy = ty - sy;
  let d = Math.hypot(dx, dy);
  const dmin = Math.abs(L1 - L2) + 1e-4, dmax = L1 + L2 - 1e-4;
  const dc = clamp(d, dmin, dmax);
  const phi = Math.atan2(dy, dx);
  const cosA = clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1);
  const alpha = Math.acos(cosA);
  const b1 = phi + bend * alpha;
  const a1 = b1 - Math.atan2(v1[1], v1[0]);
  const mx = sx + L1 * Math.cos(b1), my = sy + L1 * Math.sin(b1);
  // aim bone 2 at the (possibly clamped) target
  const ex = sx + dx * (dc / Math.max(d, 1e-6)), ey = sy + dy * (dc / Math.max(d, 1e-6));
  const b2 = Math.atan2(ey - my, ex - mx);
  const a2 = b2 - Math.atan2(e2[1], e2[0]);
  return { a1, a2 };
}
