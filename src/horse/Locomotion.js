// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Procedural locomotion.
//
//  * Legs: footfall-driven stance/swing state machines. Hooves plant in world
//    space; stance length adapts to speed so a leg is never asked to reach
//    past its length; planar two-bone IK with a soft limit near full
//    extension; distal joints (carpus, hock, fetlock, coffin) follow C2-smooth
//    curves, and in stance the hind leg's hock opens together with the stifle
//    (the reciprocal apparatus) when a long stance needs the length; the swing
//    hoof reaches slightly past its landing spot and retracts before
//    touchdown.
//  * Leads: canter and gallop run on the inside lead of a turn, strike off
//    with the outside hind and make flying changes in the air.
//  * Body: loads on the legs drive a sprung trunk (bounce, pitch, roll, sway),
//    a forward surge within each stride, lumbar flexion and lateral bending;
//    at the canter the trunk rocks about a point over the loins.
//  * Neck, head and tail are cascades of springs, so motion travels along them
//    with natural lag and overshoot (follow-through), and they react to the
//    trunk's acceleration. The head is stabilised like a real horse's.

import * as THREE from 'three';
import { GAITS, GAIT_ORDER, GAIT_UP, GAIT_DOWN, LEGS, blendGait } from './gaits.js';
import { FORE, HIND } from './rig.js';

const TAU = Math.PI * 2;
// mirror image of each leg: a left-lead canter is the right-lead pattern with
// the sides swapped
const MIRROR = { LF: 'RF', RF: 'LF', LH: 'RH', RH: 'LH' };
// turn rate (rad/s) above which the horse wants the inside lead, and how long
// (s) a turn against the current lead must last before a flying change
const LEAD_TURN = 0.08;
const LEAD_DELAY = 0.5;
// How far the hock may open beyond its standing angle (~156 deg) in stance:
// to ~172 deg, near the joint's limit
const HOCK_EXT_MAX = 16 * (Math.PI / 180);
const mod1 = (x) => ((x % 1) + 1) % 1;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smootherstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// C2 bump: 0 at w=0 and w=1 with zero slope, 1 at `peak`
const sbump = (w, peak) => (w <= 0 || w >= 1 ? 0 : w < peak ? smootherstep(w / peak) : smootherstep((1 - w) / (1 - peak)));
// bump that is zero outside [a, b] and peaks at `peak`
const sbumpIn = (w, a, peak, b) => (w <= a || w >= b ? 0 : w < peak ? smootherstep((w - a) / (peak - a)) : smootherstep((b - w) / (b - peak)));
// soft limit: identity below `soft`, approaches `hard` asymptotically
const softLimit = (x, soft, hard) => (x <= soft ? x : soft + (hard - soft) * (1 - Math.exp(-(x - soft) / (hard - soft))));
const softClamp = (x, lo, hi) => {
  const m = 0.15;
  if (x > hi - m) return softLimit(x, hi - m, hi);
  if (x < lo + m) return -softLimit(-x, -(lo + m), -lo);
  return x;
};
const Z = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

// Second-order follower (mass-spring-damper), sub-stepped for stability.
class Spring {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }
  step(target, dt, hz, zeta, force = 0) {
    const w = TAU * hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (target - this.x) - 2 * zeta * w * this.v + force;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

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

    // Reach model (root space): the pivot the leg swings about and the longest
    // distance pivot -> coffin it can span.
    const len = (a) => Math.hypot(a[0], a[1]);
    if (this.fore) {
      this.pivot = [L.shoulder[0], L.shoulder[1]];
      const comp = [L.coffin[0] - L.elbow[0], L.coffin[1] - L.elbow[1]];
      this.reach = len(this.v[1]) + len(comp);
      this.reachBonus = 0.13; // the scapula rotates, carrying the shoulder joint with it
    } else {
      this.pivot = [L.hip[0], L.hip[1]];
      // with the hock opened to its limit (see solveLeg): tibia and the
      // cannon-pastern line turned back about the hock by HOCK_EXT_MAX
      const c = Math.cos(-HOCK_EXT_MAX), sn = Math.sin(-HOCK_EXT_MAX);
      const tib = [L.hock[0] - L.stifle[0], L.hock[1] - L.stifle[1]];
      const dist = [L.coffin[0] - L.hock[0], L.coffin[1] - L.hock[1]];
      const comp = [tib[0] + dist[0] * c - dist[1] * sn, tib[1] + dist[0] * sn + dist[1] * c];
      this.reach = len(this.v[0]) + len(comp);
      this.reachBonus = 0.03; // the pelvis rocks (lumbosacral flexion), carrying the hip
    }
    this.restCoffinRel = L.coffin[0] - this.pivot[0];

    this.stance = true;
    this.hold = false;
    this.toe = new THREE.Vector3(); // planted toe (world)
    this.liftCoffin = new THREE.Vector3();
    this.liftRel = new THREE.Vector3(); // lift-off coffin in the root (heading) frame
    this.landRel = new THREE.Vector3(); // planned landing coffin in the root frame
    this.liftPitch = 0;
    this.landToe = new THREE.Vector3();
    this.coffinTarget = new THREE.Vector3();
    this.hoofPitch = 0;
    this.s = 0;
    this.w = 0;
    this.load = 0;
    this.scap = new Spring();
    this.leadOff = 0; // stance shift for leading (+) or trailing (-) at canter and gallop
    this.retime = 0; // swing rate fixed for a flying change, until touchdown
    this.psi = 0; // this leg's own position in its stride cycle (0..1, stance first)
  }
}

export class Locomotion {
  constructor(horse) {
    this.horse = horse;
    this.bones = horse.bones;
    this.root = horse.group; // world placement
    this.legs = LEGS.map((n) => new Leg(n, horse.bones));
    this.legByName = Object.fromEntries(this.legs.map((l) => [l.name, l]));

    this.speed = 0; // m/s commanded (smoothed)
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
    this.duty = { F: 0.6, H: 0.6 };
    this.standing = true;
    this.time = 0;
    this.listeners = [];
    // lead at canter and gallop: 1 = right (the right legs lead), -1 = left
    this.lead = 1;
    this.leadTimer = 0;
    this.changeLead = false;
    this.leadChanges = 0;
    this.strikeOff = false;

    // sprung body & chains
    this.s = {
      y: new Spring(),
      pitch: new Spring(),
      roll: new Spring(),
      sway: new Spring(),
      lean: new Spring(),
      lumbar: new Spring(),
      bend: new Spring(),
      neck: [0, 1, 2, 3, 4].map(() => new Spring()),
      neckYaw: [0, 1, 2, 3, 4].map(() => new Spring()),
      head: new Spring(),
      tail: [0, 1, 2, 3, 4, 5].map(() => new Spring()),
      tailYaw: [0, 1, 2, 3, 4, 5].map(() => new Spring()),
    };
    this.prevBodyVy = 0;
    this.bodyAy = 0;
    this.jiggle = new Spring(); // soft tissue (belly, flanks) bouncing after footfalls
    this.headLook = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, timer: 2 };
    this.ears = { l: 0, r: 0, tl: 0, tr: 0, timer: 1 };
    this.breath = 0;
    this.swish = { t: 0, next: 3, dir: 1 };
    // idle: resting (cocked) hind leg after standing a while
    this.idleTime = 0;
    this.cock = 0;
    this.cockLeg = 'LH';

    for (const leg of this.legs) leg.psi = mod1(-GAITS.walk.phase[leg.name]);
    this.resetFeet();
  }

  // the leg whose footfall timing this leg follows: at canter and gallop on
  // the left lead, the mirror-image leg of the (right-lead) footfall table
  role(leg, g) {
    return this.lead < 0 && g.rockPeak !== undefined ? MIRROR[leg.name] : leg.name;
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
      this.prevGait = { ...this.params, duty: { ...this.params.duty }, dutyFast: { ...this.params.dutyFast }, phase: { ...this.params.phase }, swingH: { ...this.params.swingH }, stanceShift: { ...this.params.stanceShift } };
      // striking off into canter or gallop from a symmetric gait
      this.strikeOff = GAITS[name].rockPeak !== undefined && GAITS[this.gaitName].rockPeak === undefined;
      this.gaitName = name;
      this.gaitBlend = 0;
    }
  }

  // Longest horizontal stance excursion (each way) a leg can make, given the
  // trunk height. Fore legs gain a little from scapular rotation.
  legReach(leg, drop) {
    const h = leg.pivot[1] - drop - 0.055;
    const R = leg.reach * 0.985;
    return Math.sqrt(Math.max(0.01, R * R - h * h)) + leg.reachBonus;
  }

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const B = this.bones;
    const S = this.s;

    // ---- speed / heading ----
    const accel = this.targetSpeed > this.speed ? 3.0 : 4.2;
    this.speed += clamp(this.targetSpeed - this.speed, -accel * dt, accel * dt);
    if (this.speed < 0.02 && this.targetSpeed === 0) this.speed = 0;
    const v = this.speed;
    const maxTurn = 1.3 / Math.max(1, v * 0.35);
    const targetYawRate = this.steer * maxTurn * clamp(v / 1.2, 0.35, 1);
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, dt * 2.5);
    this.chooseGait(Math.max(v, 0.6));

    // ---- gait parameters ----
    const g = GAITS[this.gaitName];
    this.gaitBlend = Math.min(1, this.gaitBlend + dt * 1.25);
    const p = blendGait(this.prevGait, g, smootherstep(this.gaitBlend), this.params);
    // ---- lead: on a turn, canter and gallop on the inside lead ----
    // (positive yaw rate turns left). The lead is picked as the horse strikes
    // off from a symmetric gait; at canter and gallop a turn against the lead
    // asks for a flying change, made in the next suspension (below).
    const asym = g.rockPeak !== undefined;
    const turnLead = Math.abs(this.yawRate) > LEAD_TURN ? (this.yawRate > 0 ? -1 : 1) : 0;
    if (!asym) {
      if (turnLead) this.lead = turnLead;
      this.leadTimer = 0;
      this.changeLead = false;
    } else if (turnLead && turnLead !== this.lead) {
      this.leadTimer += dt;
      if (this.leadTimer > LEAD_DELAY) this.changeLead = true;
    } else {
      this.leadTimer = 0;
      this.changeLead = false;
    }
    // Strike-off: the first beat of the canter is the outside hind (the
    // trailing hind of the new lead). Anchor the stride phase on that leg, so
    // it keeps its rhythm and the others re-time around it.
    if (this.strikeOff) {
      this.strikeOff = false;
      const trailing = this.legs.find((l) => this.role(l, g) === 'LH');
      this.phase = trailing.psi;
    }
    const fTarget = g.freq(clamp(Math.max(v, 0.9), g.speed[0], g.speed[1]));
    this.freq += (fTarget - this.freq) * Math.min(1, dt * 3);

    // stance length that the legs can actually span at this speed
    // the trunk settles lower once the horse is moving: the legs compress
    // under load, which is also what gives them the reach for a long stance
    const drop = p.bodyDrop * clamp(v / 2, 0, 1);
    // duty factor falls across the gait's speed range
    const sv = clamp((v - g.speed[0]) / (g.speed[1] - g.speed[0]), 0, 1);
    for (const key of ['F', 'H']) {
      const leg = key === 'F' ? this.legs[0] : this.legs[2];
      const X = this.legReach(leg, drop);
      const maxStance = 2 * X * 0.9;
      const Dmax = v > 0.1 ? (maxStance * this.freq) / v : 1;
      const want = Math.min(p.duty[key] + (p.dutyFast[key] - p.duty[key]) * sv, Dmax);
      this.duty[key] += (want - this.duty[key]) * Math.min(1, dt * 4);
    }
    const duty = this.duty;

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
      // Each leg runs its own cycle. The footfall pattern of the current gait
      // sets where it should be; a leg only catches up (or waits) while it is
      // in the air, never while planted. Gait changes therefore happen within
      // about one stride, leg by leg, instead of cross-fading two patterns.
      // Flying change: swap the lead while all four hooves are off the
      // ground. Each leg (all in swing) is retimed to land exactly on the new
      // pattern: the old leading hind lands first, then the new leading pair.
      // The change waits for a suspension early enough that every leg can be
      // retimed within its limits.
      if (this.changeLead && asym && this.legs.every((l) => !l.stance)) {
        this.lead = -this.lead;
        const rates = this.legs.map((leg) => {
          let err = mod1(this.phase - g.phase[this.role(leg, g)]) - leg.psi;
          err -= Math.round(err);
          const rem = 1 - leg.psi;
          return rem - err > 0.02 ? rem / (rem - err) : Infinity;
        });
        if (rates.every((r) => r >= 0.4 && r <= 2.5)) {
          this.legs.forEach((leg, i) => (leg.retime = rates[i]));
          this.changeLead = false;
          this.leadTimer = 0;
          this.leadChanges++;
        } else this.lead = -this.lead;
      }
      for (const leg of this.legs) {
        const target = mod1(this.phase - g.phase[this.role(leg, g)]);
        let err = target - leg.psi;
        err -= Math.round(err);
        const inSwing = leg.psi >= this.duty[leg.key];
        let rate = inSwing ? clamp(1 + 2.5 * err, 0.55, 1.9) : 1;
        if (leg.retime) {
          if (inSwing) rate = leg.retime;
          else leg.retime = 0;
        }
        leg.psi = mod1(leg.psi + this.freq * rate * dt);
      }
    } else {
      this.standing = true;
      for (const leg of this.legs) if (leg.stance) leg.hold = true;
    }
    const mv = moving ? clamp(v / 1.0, 0, 1) : 0;
    this.mv = mv;

    // ---- root motion, with a small forward surge inside each stride ----
    const surge = 1 + p.surge * mv * Math.sin(TAU * p.surgeHarm * (this.phase - 0.15));
    this.yaw += this.yawRate * dt;
    this.root.rotation.y = this.yaw;
    const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.root.position.addScaledVector(fwd, v * surge * dt);
    this.root.updateMatrixWorld(true);

    // ---- landing plans (root frame): centre each stance where the leg can span it ----
    for (const leg of this.legs) {
      const X = this.legReach(leg, drop);
      const travel = moving ? (v * duty[leg.key]) / this.freq : 0;
      // at canter and gallop the leading legs reach further forward and the
      // trailing legs further back (Back et al. 1997)
      leg.leadOff += ((leg.side === this.lead ? 1 : -1) * p.leadReach - leg.leadOff) * Math.min(1, dt * 3);
      const wantCentre = leg.restCoffinRel + (stopping ? 0 : (p.stanceShift[leg.key] + leg.leadOff) * mv);
      const half = Math.min(travel / 2, X * 0.95);
      const centre = clamp(wantCentre, -X + half, X - half);
      leg.landRel.set(leg.pivot[0] + centre + half, leg.toeToCoffin[1], leg.restToe.z);
      leg.landToe.set(leg.landRel.x - leg.toeToCoffin[0], 0, leg.restToe.z).applyMatrix4(this.root.matrixWorld);
    }

    // ---- leg phases, footfalls and loads ----
    const loads = { F: 0, H: 0, L: 0, R: 0, all: 0 };
    for (const leg of this.legs) {
      const D = duty[leg.key];
      const psi = leg.psi;
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
            leg.liftRel.copy(leg.coffinTarget);
            this.root.worldToLocal(leg.liftRel);
            leg.liftPitch = leg.hoofPitch;
          }
        }
        leg.w = (psi - D) / (1 - D);
      }
      // smooth (sin^2) load kernel: no kinks at touchdown or lift-off
      const ld = inStance && moving ? Math.sin(Math.PI * leg.s) ** 2 : 0;
      leg.load = ld;
      loads[leg.key] += ld;
      loads[leg.side < 0 ? 'L' : 'R'] += ld;
      loads.all += ld;
    }
    const meanF = duty.F, meanH = duty.H; // two legs x mean(sin^2)=0.5 x duty
    const meanAll = meanF + meanH;

    // ---- idle: cock a hind leg after a few seconds at rest ----
    if (this.standing) {
      if (this.idleTime === 0) this.cockLeg = Math.random() < 0.5 ? 'LH' : 'RH';
      this.idleTime += dt;
    } else this.idleTime = 0;
    const wantCock = this.idleTime > 3 ? 1 : 0;
    this.cock += (wantCock - this.cock) * Math.min(1, dt * (wantCock ? 1.2 : 6));
    const cockSide = this.cockLeg === 'LH' ? -1 : 1;

    // ---- sprung trunk ----
    const yT = -p.bob * 1.6 * (loads.all - meanAll) * mv - drop;
    // Asymmetric gaits (canter, gallop) rock: footage of cantering horses
    // (docs/VIDEO-REFERENCE.md) shows the forehand lowest as the trailing hind
    // lands and highest late in the leading fore's stance, as the hinds' push
    // behind the centre of mass tips the nose down and the leading fore vaults
    // the forehand up. That rocking is locked to the stride; symmetric gaits
    // keep the load-driven pitch.
    const locked = p.surgeHarm < 1.5 ? mv : 0;
    const rock = Math.cos(TAU * (this.phase - (g.rockPeak ?? 0.6)));
    const pitchT = (1 - locked) * p.pitch * (loads.H - meanH - (loads.F - meanF)) * mv + locked * p.pitch * rock;
    const rollT = p.roll * (loads.R - loads.L) * mv;
    const swayT = 0.012 * (loads.R - loads.L) * mv * (p.surgeHarm > 1 ? 1 : 0.4);
    const leanT = -clamp((v * this.yawRate) / 9.81, -0.5, 0.5) * 0.55;
    const y = S.y.step(yT, dt, 3.2, 0.42);
    const pitch = S.pitch.step(pitchT, dt, 2.6, 0.5);
    const roll = S.roll.step(rollT, dt, 2.2, 0.5);
    const sway = S.sway.step(swayT, dt, 1.8, 0.6);
    const lean = S.lean.step(leanT, dt, 1.2, 0.8);
    this.dbg = { pitch, y };
    this.bodyAy = (S.y.v - this.prevBodyVy) / Math.max(dt, 1e-3);
    this.prevBodyVy = S.y.v;
    // breathing: free at rest and slow gaits, locked one breath per stride at
    // canter and gallop (the gut acts as a piston on the diaphragm)
    // breath: -1..1, positive while breathing in (drives the nostril flare)
    this.breath = this.standing
      ? Math.sin(this.time * 1.6)
      : (1 - locked) * Math.sin(this.time * (4 + v * 0.3)) + locked * Math.sin(TAU * (this.phase - 0.25));
    const breathe = this.standing
      ? this.breath * 0.0025
      : (1 - locked) * Math.sin(this.time * (4 + v * 0.3)) * 0.0015 + locked * Math.sin(TAU * (this.phase - 0.25)) * 0.003;
    this.jiggle.step(0, dt, 5.5, 0.22, -this.bodyAy * 0.35);
    const body = B.body;
    // rock about a point behind the trunk's centre (p.rockPivot metres back),
    // so the croup moves much less than the withers
    const pivotLift = p.rockPivot * Math.sin(pitch) * mv;
    body.position.set(body.userData.restLocal.x, body.userData.restLocal.y + y + breathe + pivotLift, body.userData.restLocal.z + sway);
    _e.set(roll + lean, 0, pitch, 'XYZ');
    body.quaternion.setFromEuler(_e);

    // spine: lumbosacral flexion (flexed as the hinds come under) and lateral
    // bending into turns
    const lumbT = p.lumbar * Math.cos(TAU * (this.phase - 0.02)) * mv;
    const lumb = S.lumbar.step(lumbT, dt, 3.0, 0.6);
    const bend = S.bend.step(clamp(this.yawRate * 0.12, -0.12, 0.12) + 0.6 * (rollT - roll) * (p.surgeHarm > 1 ? 1 : 0), dt, 1.6, 0.7);
    _e.set(0, bend * 0.5, lumb * 0.4, 'XYZ');
    B.lumbar.quaternion.setFromEuler(_e);
    _e.set(cockSide * 0.06 * this.cock, bend * 0.3, lumb * 0.6, 'XYZ');
    B.pelvis.quaternion.setFromEuler(_e);
    _e.set(0, bend * 0.4, -lumb * 0.25, 'XYZ');
    B.thorax.quaternion.setFromEuler(_e);

    // ---- neck & head: spring cascade (a wave runs down the neck) ----
    this.updateHeadLook(dt, v);
    // the neck swings down as the forehand rises (head lowest, relative to the
    // withers, late in the leading fore's stance), up as it falls
    const nod = (1 - locked) * -p.nod * (loads.F - meanF) * mv - locked * p.nod * Math.cos(TAU * (this.phase - (g.nodPeak ?? 0.56)));
    const carriage = p.neckCarriage * clamp(v / 6, 0, 1) - 0.04 * mv;
    const inertia = -0.004 * this.bodyAy; // neck lags the trunk's vertical acceleration
    let target = carriage + nod + this.headLook.pitch + inertia;
    let yawTarget = this.headLook.yaw + clamp(this.yawRate * 0.35, -0.35, 0.35) * clamp(v / 3, 0, 1);
    const nw = [0.34, 0.24, 0.17, 0.13, 0.12];
    const ny = [0.1, 0.2, 0.25, 0.25, 0.2];
    const hz = [3.4, 3.0, 2.7, 2.5, 2.3];
    let neckSum = 0;
    for (let i = 0; i < 5; i++) {
      target = S.neck[i].step(target, dt, hz[i], 0.42);
      yawTarget = S.neckYaw[i].step(yawTarget, dt, hz[i] * 0.7, 0.6);
      neckSum += target * nw[i];
      _e.set(0, yawTarget * ny[i], target * nw[i], 'YZX');
      B['neck' + i].quaternion.setFromEuler(_e);
    }
    // the head is stabilised: it counter-rotates most of the neck and trunk pitch
    const comp = 0.62 - 0.32 * clamp((v - 5) / 8, 0, 1);
    // The head cancels the neck's static lowering in full (only the stride's
    // nod is partly let through), and opens at speed: a galloping horse
    // stretches its neck long and low with the nose pushed out in front.
    const open = 0.3 * clamp((v - 6) / 8, 0, 1) + p.headOpen * mv;
    const headT = -(neckSum + pitch) * comp - carriage * (1 - comp) + nod * 0.25 + open;
    const head = S.head.step(headT, dt, 3.2, 0.55);
    _e.set(0, yawTarget * 0.1, head, 'YZX');
    B.head.quaternion.setFromEuler(_e);

    this.updateEars(dt, v);
    this.updateTail(dt, v, p, pitch);

    this.root.updateMatrixWorld(true);

    // ---- legs ----
    const yaw = this.yaw;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    for (const leg of this.legs) {
      const D = duty[leg.key];
      const Tst = D / this.freq;
      let hoofAbs = 0;
      let blendRel = 0; // 0 = hoof pitch held in world space, 1 = relative swing flexion
      if (leg.stance) {
        const cocked = leg.name === this.cockLeg ? this.cock : 0;
        const bo = leg.hold ? -0.6 * cocked : -p.breakover * smootherstep((leg.s - 0.6) / 0.4);
        leg.hoofPitch = bo;
        const cx = leg.toeToCoffin[0] * Math.cos(bo) - leg.toeToCoffin[1] * Math.sin(bo);
        const cy = leg.toeToCoffin[0] * Math.sin(bo) + leg.toeToCoffin[1] * Math.cos(bo);
        leg.coffinTarget.set(leg.toe.x + cx * cosY, leg.toe.y + cy, leg.toe.z - cx * sinY);
        hoofAbs = bo;
      } else {
        const w = leg.w;
        // swing planned in the root (heading) frame, from lift-off to the
        // planned landing: both ends lie within the leg's reach
        const e = smootherstep(w);
        _v.lerpVectors(leg.liftRel, leg.landRel, e);
        // Fore-aft: cubic Hermite whose end tangents carry part of the stance
        // velocity (the hoof moves back at -v relative to the body while
        // planted). The hoof follows through backward after lift-off, swings
        // forward, overshoots and retracts onto the landing spot, so it meets
        // the ground with little speed: swing-phase retraction.
        const Tsw = (1 - duty[leg.key]) / this.freq;
        const m = -v * Tsw * 0.55;
        const w2 = w * w, w3 = w2 * w;
        _v.x = (2 * w3 - 3 * w2 + 1) * leg.liftRel.x + (w3 - 2 * w2 + w) * m + (-2 * w3 + 3 * w2) * leg.landRel.x + (w3 - w2) * m;
        // Canter and gallop: the hind follows through behind first. Until
        // w = lag the hoof keeps moving back, starting at the stance speed
        // (so lift-off is smooth in world space) and easing to rest; then it
        // swings forward fast and retracts onto its landing spot.
        const lag = leg.fore ? 0 : p.hindLag * mv;
        if (lag > 0.005) {
          // how far back the raised hoof can still be reached from the hip
          const hy = leg.liftRel.y + p.swingH.H * sbump(lag, 0.46 + 0.2 * lag);
          const h = leg.pivot[1] - drop - hy;
          const R = leg.reach * 0.95;
          const back = leg.pivot[0] - Math.sqrt(Math.max(0.01, R * R - h * h)) - leg.reachBonus;
          const B = clamp((v * Tsw * lag) / 3, 0, Math.max(0, leg.liftRel.x - back));
          let x;
          if (w < lag) x = leg.liftRel.x - B * (1 - (1 - w / lag) ** 3);
          else {
            const t = (w - lag) / (1 - lag), t2 = t * t, t3 = t2 * t;
            x = (2 * t3 - 3 * t2 + 1) * (leg.liftRel.x - B) + (-2 * t3 + 3 * t2) * leg.landRel.x + (t3 - t2) * m * (1 - lag);
          }
          _v.x += (x - _v.x) * clamp(lag / 0.1, 0, 1);
        }
        _v.y += p.swingH[leg.key] * sbump(w, leg.fore ? 0.36 : 0.46 + 0.2 * lag) * clamp(v / 1.2 + 0.4, 0.4, 1);
        leg.coffinTarget.copy(_v).applyMatrix4(this.root.matrixWorld);
        // hoof pitch: from its lift-off angle to flat at touchdown, with the
        // relative swing flexion blended in through mid-swing
        hoofAbs = leg.liftPitch * (1 - smootherstep(w / 0.5)) + 0.05 * sbumpIn(w, 0.6, 0.85, 1);
        blendRel = smootherstep(w / 0.2) * (1 - smootherstep((w - 0.7) / 0.25));
        leg.hoofPitch = hoofAbs;
      }

      this.solveLeg(leg, p, hoofAbs, blendRel);
    }
  }

  solveLeg(leg, p, hoofAbs, blendRel) {
    leg.parent.updateWorldMatrix(true, false);
    _m.copy(leg.parent.matrixWorld).invert();
    const T = _v.copy(leg.coffinTarget).applyMatrix4(_m);
    const e = leg.parent.matrixWorld.elements;
    const ax = new THREE.Vector3(e[0], e[1], e[2]).normalize();
    const parentPitch = Math.asin(clamp(ax.y, -1, 1));

    const st = leg.stance;
    const s = leg.s, w = leg.w;
    const P = leg.P, V = leg.v;
    const hold = leg.hold;

    // distal joint curves (C2-smooth through touchdown and lift-off)
    const cocked = leg.name === this.cockLeg ? this.cock : 0;
    const fetlock = st
      ? hold
        ? -0.55 * cocked
        : p.fetlockExt * Math.sin(Math.PI * s) ** 2
      : -p.fetlockFlex * sbump(w, 0.36);
    const roll = clamp(-Math.atan2(T.z - leg.restCoffinLocal.z, Math.max(0.3, P[0][1] - T.y)), -0.25, 0.25);
    const relCoffin = -p.coffinFlex * sbump(w, 0.32);

    if (leg.fore) {
      const carpus = st ? 0 : -p.carpusFlex * sbump(w, 0.42);
      const dxN = T.x - leg.restCoffinLocal.x;
      const scap = leg.scap.step(clamp((p.scap * dxN) / 0.65, -0.4, 0.45), 1 / 60, 6, 0.9);
      const A0 = scap;
      const [v0, v1, v2, v3, v4] = V;
      const Sx = P[0][0] + v0[0] * Math.cos(A0) - v0[1] * Math.sin(A0);
      const Sy = P[0][1] + v0[0] * Math.sin(A0) + v0[1] * Math.cos(A0);
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
      const abs = hoofAbs - parentPitch - (a2 + carpus + fetlock);
      setZ(leg.bones[5], softClamp(abs * (1 - blendRel) + relCoffin * blendRel, -1.7, 0.6));
    } else {
      let hock = st ? (hold ? 0 : 0.14 * p.hockFlex * Math.sin(Math.PI * s) ** 2) : p.hockFlex * sbump(w, 0.46 + 0.25 * p.hindLag * this.mv);
      const [v0, v1, v2, v3] = V;
      // stifle -> coffin for a hock angle (the fetlock as it is)
      const comp = (h) => {
        const c1 = Math.cos(h), s1 = Math.sin(h);
        const c2 = Math.cos(h + fetlock), s2 = Math.sin(h + fetlock);
        return [v1[0] + v2[0] * c1 - v2[1] * s1 + v3[0] * c2 - v3[1] * s2, v1[1] + v2[0] * s1 + v2[1] * c1 + v3[0] * s2 + v3[1] * c2];
      };
      if (st && !hold) {
        // Reciprocal apparatus: the stifle and hock open together. When the
        // planted hoof is beyond what the leg spans with its standing hock
        // angle (start and end of a long stance), open the hock just enough,
        // up to HOCK_EXT_MAX; the two-bone solve then opens the stifle.
        const L1 = Math.hypot(v0[0], v0[1]);
        const need = Math.hypot(T.x - P[0][0], T.y - P[0][1]) / 0.965 - L1;
        const lenAt = (h) => Math.hypot(...comp(h));
        if (lenAt(hock) < need) {
          let lo = 0, hi = HOCK_EXT_MAX;
          if (lenAt(hock - hi) <= need) lo = hi;
          else
            for (let it = 0; it < 10; it++) {
              const mid = (lo + hi) / 2;
              if (lenAt(hock - mid) < need) lo = mid;
              else hi = mid;
            }
          hock -= lo;
        }
      }
      const [Ex, Ey] = comp(hock);
      const { a1, a2 } = twoBone(P[0][0], P[0][1], T.x, T.y, v0, [Ex, Ey], 1);
      setZ(leg.bones[0], a1, roll);
      setZ(leg.bones[1], a2 - a1);
      setZ(leg.bones[2], hock);
      setZ(leg.bones[3], fetlock);
      const abs = hoofAbs - parentPitch - (a2 + hock + fetlock);
      setZ(leg.bones[4], softClamp(abs * (1 - blendRel) + relCoffin * blendRel, -1.7, 0.6));
    }
  }

  // Tail: a cascade of springs (pitch and yaw) so it trails and whips; it is
  // carried higher with speed, bounces with the trunk and swishes at rest.
  updateTail(dt, v, p, bodyPitch) {
    const S = this.s;
    const sw = this.swish;
    sw.next -= dt;
    let swishT = 0;
    if (this.standing && sw.next <= 0) {
      sw.t = 1.1;
      sw.dir = Math.random() < 0.5 ? -1 : 1;
      sw.next = 3 + Math.random() * 6;
    }
    if (sw.t > 0) {
      sw.t -= dt;
      swishT = sw.dir * 0.55 * Math.sin(Math.PI * (1 - sw.t / 1.1)) * Math.sin(TAU * (1 - sw.t / 1.1) * 0.9);
    }
    const lift = -p.tailLift * clamp(v / 8, 0, 1);
    let tgt = lift - bodyPitch * 0.8;
    const walkSway = p.surgeHarm > 1.5 ? 0.1 * clamp(v / 1.2, 0, 1) * (1 - clamp((v - 2) / 3, 0, 1)) : 0;
    let ytgt = swishT - this.yawRate * 0.25 * clamp(v / 4, 0, 1) + walkSway * Math.sin(TAU * this.phase);
    const force = 0.06 * this.bodyAy; // trunk bounce kicks the tail
    for (let i = 0; i < 6; i++) {
      const hz = 3.0 - i * 0.3;
      const k = i === 0 ? 0.6 : 0.12;
      tgt = S.tail[i].step(tgt, dt, hz, 0.35, i === 0 ? force : 0);
      ytgt = S.tailYaw[i].step(ytgt, dt, hz * 0.8, 0.4);
      _e.set(0, ytgt * (i === 0 ? 0.35 : 0.13), tgt * k, 'XYZ');
      this.bones['tail' + i].quaternion.setFromEuler(_e);
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
    const k = Math.min(1, dt * 1.2);
    h.yaw += (h.tYaw - h.yaw) * k;
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
// (elbow), +1 in front (stifle). Near full extension the reach is softened so
// the limb eases straight instead of snapping. Returns absolute rotations.
function twoBone(sx, sy, tx, ty, v1, e2, bend) {
  const L1 = Math.hypot(v1[0], v1[1]);
  const L2 = Math.hypot(e2[0], e2[1]);
  const dx = tx - sx, dy = ty - sy;
  const d = Math.hypot(dx, dy);
  const dmin = Math.abs(L1 - L2) + 1e-4, dmax = L1 + L2 - 1e-4;
  const dc = Math.max(dmin, softLimit(d, dmax * 0.965, dmax));
  const phi = Math.atan2(dy, dx);
  const cosA = clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1);
  const alpha = Math.acos(cosA);
  const b1 = phi + bend * alpha;
  const a1 = b1 - Math.atan2(v1[1], v1[0]);
  const mx = sx + L1 * Math.cos(b1), my = sy + L1 * Math.sin(b1);
  const ex = sx + dx * (dc / Math.max(d, 1e-6)), ey = sy + dy * (dc / Math.max(d, 1e-6));
  const b2 = Math.atan2(ey - my, ex - mx);
  const a2 = b2 - Math.atan2(e2[1], e2[0]);
  return { a1, a2 };
}
