// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Headless motion check: drives the locomotion on the real skeleton through
// every gait, transitions, turns and a halt, and measures what makes motion
// look smooth or broken. Exits non-zero if a threshold is exceeded.
//
//   node tools/motion-check.mjs            report + thresholds
//   node tools/motion-check.mjs --json     machine-readable report

import * as THREE from 'three';
import { buildSkeleton } from '../src/horse/Horse.js';
import { Locomotion } from '../src/horse/Locomotion.js';

const LIMITS = {
  ikErrMean: 0.02, // m: hoof vs its target, averaged
  ikErrMax: 0.3, // m
  stanceSlipMax: 0.06, // m per frame a planted hoof may move
  trunkAccelMax: 60, // m/s^2 vertical acceleration of the trunk
};

const { bones, byName } = buildSkeleton();
const group = new THREE.Group();
group.add(bones[0]);
const loco = new Locomotion({ bones: byName, group });
const dt = 1 / 60;
// [speed m/s, steer, seconds]
const plan = [[0, 0, 1], [1.6, 0, 4], [3.8, 0, 4], [6.8, 0, 4], [13.5, 0, 5], [6.8, 0.6, 4], [3.8, -0.6, 3], [1.6, 0, 3], [0, 0, 6]];
const v = new THREE.Vector3();
const prevHoof = loco.legs.map(() => new THREE.Vector3());
const prevStance = loco.legs.map(() => false); // no comparison on the first frame
const stats = {};
const stat = (g) => (stats[g] ??= { frames: 0, ikSum: 0, ikMax: 0, slipMax: 0 });
let nan = 0, trunkAccelMax = 0, prevVy = 0, prevY = 0, frame = 0;
for (const [speed, steer, secs] of plan) {
  loco.targetSpeed = speed;
  loco.steer = steer;
  for (let i = 0; i < secs / dt; i++, frame++) {
    loco.update(dt);
    group.updateMatrixWorld(true);
    const st = stat(loco.standing ? 'stand' : loco.gaitName);
    st.frames++;
    loco.legs.forEach((leg, k) => {
      leg.bones[leg.bones.length - 1].getWorldPosition(v);
      const err = v.distanceTo(leg.coffinTarget);
      st.ikSum += err;
      st.ikMax = Math.max(st.ikMax, err);
      if (leg.stance && prevStance[k]) st.slipMax = Math.max(st.slipMax, Math.hypot(v.x - prevHoof[k].x, v.z - prevHoof[k].z));
      prevHoof[k].copy(v);
      prevStance[k] = leg.stance;
    });
    for (const b of bones) for (const e of b.matrixWorld.elements) if (!Number.isFinite(e)) nan++;
    const y = byName.body.position.y;
    const vy = (y - prevY) / dt;
    if (frame > 2) trunkAccelMax = Math.max(trunkAccelMax, Math.abs(vy - prevVy) / dt);
    prevY = y;
    prevVy = vy;
  }
}
const all = Object.values(stats).reduce((a, s) => ({ frames: a.frames + s.frames, ikSum: a.ikSum + s.ikSum, ikMax: Math.max(a.ikMax, s.ikMax), slipMax: Math.max(a.slipMax, s.slipMax) }), { frames: 0, ikSum: 0, ikMax: 0, slipMax: 0 });
const report = {
  perGait: Object.fromEntries(Object.entries(stats).map(([g, s]) => [g, { ikErrMean: +(s.ikSum / (s.frames * 4)).toFixed(4), ikErrMax: +s.ikMax.toFixed(3), stanceSlipMax: +s.slipMax.toFixed(3) }])),
  ikErrMean: +(all.ikSum / (all.frames * 4)).toFixed(4),
  ikErrMax: +all.ikMax.toFixed(3),
  stanceSlipMax: +all.slipMax.toFixed(3),
  trunkAccelMax: +trunkAccelMax.toFixed(1),
  nonFinite: nan,
  settledAfterHalt: loco.standing,
};
const failures = [];
for (const [k, lim] of Object.entries(LIMITS)) if (report[k] > lim) failures.push(`${k} = ${report[k]} exceeds ${lim}`);
if (nan) failures.push(`${nan} non-finite bone matrix entries`);
if (!report.settledAfterHalt) failures.push('the horse did not settle after the halt');
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log('gait      ik mean   ik max   stance slip');
  for (const [g, s] of Object.entries(report.perGait)) console.log(`${g.padEnd(8)} ${(s.ikErrMean * 100).toFixed(2).padStart(6)} cm ${(s.ikErrMax * 100).toFixed(1).padStart(6)} cm ${(s.stanceSlipMax * 100).toFixed(1).padStart(8)} cm`);
  console.log(`trunk vertical acceleration max ${report.trunkAccelMax} m/s², settled after halt: ${report.settledAfterHalt}`);
}
if (failures.length) {
  console.error('motion check failed:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('motion check passed');
