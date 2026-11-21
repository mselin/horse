// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Footfall timing of the procedural gaits, measured the way the reference
// footage was (docs/VIDEO-REFERENCE.md): each leg's touchdown and lift-off as
// a fraction of the stride from the trailing hind's touchdown, duty factors
// and the fraction of the stride with all four hooves off the ground; for the
// asymmetric gaits also where in the stride the trunk pitches forehand-up most
// and where the head is lowest relative to the withers.
// usage: node tools/gait-timing.mjs [gait speed]...
import * as THREE from 'three';
import { buildSkeleton } from '../src/horse/Horse.js';
import { Locomotion } from '../src/horse/Locomotion.js';

const runs = process.argv.length > 2
  ? process.argv.slice(2).reduce((a, x, i, all) => (i % 2 ? a : [...a, [all[i], +all[i + 1]]]), [])
  : [['walk', 1.6], ['trot', 3.8], ['canter', 4.6], ['canter', 5.6], ['canter', 7.5], ['gallop', 10], ['gallop', 13.5], ['gallop', 16]];

for (const [gait, speed] of runs) {
  const { byName } = buildSkeleton();
  const loco = new Locomotion({ bones: byName, group: new THREE.Group() });
  loco.setGait(gait);
  loco.targetSpeed = speed;
  loco.speed = speed;
  const dt = 1 / 240;
  for (let t = 0; t < 4; t += dt) loco.update(dt); // settle
  const names = loco.legs.map((l) => l.name);
  const ev = Object.fromEntries(names.map((n) => [n, []]));
  let prev = loco.legs.map((l) => l.stance);
  let air = 0, total = 0;
  const rows = [];
  const nose = new THREE.Vector3(), withers = new THREE.Vector3();
  const T = 6;
  for (let i = 0; i < T / dt; i++) {
    loco.update(dt);
    const st = loco.legs.map((l) => l.stance);
    st.forEach((s, k) => {
      if (s && !prev[k]) ev[names[k]].push(['on', i]);
      if (!s && prev[k]) ev[names[k]].push(['off', i]);
    });
    if (!st.some(Boolean)) air++;
    byName.head.updateMatrixWorld(true);
    nose.set(0.3, -0.45, 0).applyMatrix4(byName.head.matrixWorld);
    byName.neck0.getWorldPosition(withers);
    rows.push([i, loco.dbg.pitch, nose.y - withers.y]);
    total++;
    prev = st;
  }
  const on = ev.LH.filter((e) => e[0] === 'on').map((e) => e[1]);
  const P = (on[on.length - 1] - on[0]) / (on.length - 1);
  const rel = (i) => ((((i - on[0]) / P) % 1) + 1) % 1;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const circ = (a) => { const s = mean(a.map((x) => Math.sin(2 * Math.PI * x))), c = mean(a.map((x) => Math.cos(2 * Math.PI * x))); return ((Math.atan2(s, c) / (2 * Math.PI)) + 1) % 1; };
  const parts = names.map((n) => {
    const ons = ev[n].filter((e) => e[0] === 'on').map((e) => rel(e[1]));
    const offs = ev[n].filter((e) => e[0] === 'off').map((e) => rel(e[1]));
    const a = circ(ons), b = circ(offs);
    return `${n} ${a.toFixed(2)}–${b.toFixed(2)} (duty ${(((b - a) % 1) + 1) % 1 > 0 ? ((((b - a) % 1) + 1) % 1).toFixed(2) : '?'})`;
  });
  // phase of the largest forehand-up pitch and of the lowest head (10 bins)
  const bins = Array.from({ length: 20 }, () => [0, 0, 0]);
  for (const [i, p, h] of rows) {
    const b = bins[Math.min(19, Math.floor(rel(i) * 20))];
    b[0] += p; b[1] += h; b[2]++;
  }
  const pk = (k, sign) => bins.reduce((best, b, j) => (sign * b[k] / b[2] > sign * bins[best][k] / bins[best][2] ? j : best), 0) / 20 + 0.025;
  const amp = (k) => { const v = bins.map((b) => b[k] / b[2]); return (Math.max(...v) - Math.min(...v)) / 2; };
  const rock = `pitch up at ${pk(0, 1).toFixed(2)} (±${(amp(0) * 57.3).toFixed(1)}°), head low at ${pk(1, -1).toFixed(2)} (±${(amp(1) * 100).toFixed(1)} cm)`;
  console.log(`${gait.padEnd(6)} ${speed.toFixed(1).padStart(4)} m/s  ${(1 / (P * dt)).toFixed(2)} Hz  ${parts.join('  ')}  airborne ${(air / total).toFixed(2)}  ${rock}`);
}
