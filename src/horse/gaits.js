// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Gait definitions. Footfall timing (touchdown phase of each limb as a
// fraction of the stride), duty factors and stride frequencies follow the
// equine locomotion literature summarised in docs/RESOURCES.md:
//   walk   – 4-beat lateral sequence LH, LF, RH, RF; duty ~0.6; 0.8–1.1 strides/s
//   trot   – 2-beat diagonal (LH+RF, RH+LF), small hind-first advanced placement;
//            duty ~0.35–0.45; 1.5–2.0 strides/s; aerial phase
//   canter – 3-beat (right lead: LH, then RH+LF, then RF) + suspension
//            (footfall offsets, duty ~0.46 and a short suspension ~0.15 at a
//            working canter measured frame by frame from documentary footage
//            of brumbies, see docs/VIDEO-REFERENCE.md)
//   gallop – 4-beat transverse (right lead: LH, RH, LF, RF) + one aerial phase;
//            hind duty ~0.2–0.3; ~2.1–2.4 strides/s; stride 6–7 m at race pace
//
// Angles in radians. "Flex" amplitudes are for the swing phase; "ext" for the
// stance phase (fetlock hyper-extension under load). Duty factors fall with
// speed: `duty` holds at the slow end of a gait's speed range, `dutyFast` at
// the fast end.

export const LEGS = ['LF', 'RF', 'LH', 'RH'];

export const GAITS = {
  walk: {
    speed: [0.6, 2.1],
    freq: (v) => 0.82 + 0.12 * v, // ~1.0 Hz at 1.5 m/s
    duty: { F: 0.6, H: 0.6 },
    dutyFast: { F: 0.6, H: 0.6 },
    phase: { LH: 0.0, LF: 0.25, RH: 0.5, RF: 0.75 },
    swingH: { F: 0.1, H: 0.085 },
    carpusFlex: 0.85,
    fetlockFlex: 0.55,
    fetlockExt: 0.12,
    hockFlex: 0.55,
    coffinFlex: 0.35,
    breakover: 0.35,
    scap: 0.22,
    bob: 0.014,
    pitch: 0.012,
    roll: 0.02,
    nod: 0.05,
    neckCarriage: 0.0,
    lumbar: 0.015,
    bodyDrop: 0.02,
    tailLift: 0.0,
    surge: 0.03,
    surgeHarm: 2,
    stanceShift: { F: 0.03, H: 0.03 },
  },
  trot: {
    speed: [2.6, 5.2],
    freq: (v) => 1.3 + 0.07 * v, // ~1.55 Hz at 3.8 m/s
    duty: { F: 0.45, H: 0.44 },
    dutyFast: { F: 0.38, H: 0.37 },
    phase: { LH: 0.0, RF: 0.015, RH: 0.5, LF: 0.515 },
    swingH: { F: 0.22, H: 0.17 },
    carpusFlex: 1.2,
    fetlockFlex: 0.85,
    fetlockExt: 0.3,
    hockFlex: 0.85,
    coffinFlex: 0.5,
    breakover: 0.5,
    scap: 0.26,
    bob: 0.032,
    pitch: 0.01,
    roll: 0.012,
    nod: 0.02,
    neckCarriage: 0.05,
    lumbar: 0.02,
    bodyDrop: 0.03,
    tailLift: 0.25,
    surge: 0.025,
    surgeHarm: 2,
    stanceShift: { F: 0.04, H: 0.03 },
  },
  canter: {
    speed: [4.2, 8.5],
    freq: (v) => 1.55 + 0.035 * v, // ~1.75 Hz at a working canter
    duty: { F: 0.46, H: 0.45 },
    dutyFast: { F: 0.34, H: 0.35 },
    phase: { LH: 0.0, RH: 0.13, LF: 0.17, RF: 0.38 },
    swingH: { F: 0.26, H: 0.16 },
    carpusFlex: 1.55,
    fetlockFlex: 1.15,
    fetlockExt: 0.38,
    hockFlex: 0.95,
    coffinFlex: 0.55,
    breakover: 0.55,
    scap: 0.3,
    bob: 0.035,
    pitch: 0.075,
    roll: 0.02,
    nod: 0.16,
    neckCarriage: -0.28,
    lumbar: 0.09,
    bodyDrop: 0.07,
    tailLift: 0.58,
    surge: 0.05,
    surgeHarm: 1,
    // stride phases (from the trailing hind's touchdown) where the rocking
    // pitch and the neck swing are aimed; the springs add ~0.1 of lag, so the
    // forehand peaks at ~0.7 and the head is lowest at ~0.65, as measured
    rockPeak: 0.6,
    nodPeak: 0.56,
    stanceShift: { F: 0.07, H: 0.1 },
  },
  gallop: {
    speed: [9.0, 17.0],
    freq: (v) => 1.85 + 0.03 * v, // ~2.25 Hz at 13 m/s
    duty: { F: 0.3, H: 0.3 },
    dutyFast: { F: 0.21, H: 0.22 },
    phase: { LH: 0.0, RH: 0.12, LF: 0.33, RF: 0.46 },
    swingH: { F: 0.32, H: 0.18 },
    carpusFlex: 1.75,
    fetlockFlex: 1.4,
    fetlockExt: 0.5,
    hockFlex: 1.0,
    coffinFlex: 0.6,
    breakover: 0.6,
    scap: 0.36,
    bob: 0.05,
    pitch: 0.055,
    roll: 0.015,
    nod: 0.16,
    neckCarriage: -0.45,
    lumbar: 0.13,
    bodyDrop: 0.09,
    tailLift: 0.6,
    surge: 0.045,
    surgeHarm: 1,
    // as the canter, moved earlier with the leading fore's earlier lift-off
    // (by analogy: no gallop footage was measured)
    rockPeak: 0.46,
    nodPeak: 0.42,
    stanceShift: { F: 0.1, H: 0.18 },
  },
};

export const GAIT_ORDER = ['walk', 'trot', 'canter', 'gallop'];

// Speed thresholds (m/s) for automatic gait selection, with hysteresis.
export const GAIT_UP = { walk: 2.3, trot: 4.8, canter: 9.0 };
export const GAIT_DOWN = { trot: 1.9, canter: 4.3, gallop: 8.0 };

const NUMERIC_KEYS = [
  'carpusFlex', 'fetlockFlex', 'fetlockExt', 'hockFlex', 'coffinFlex', 'breakover', 'scap',
  'bob', 'pitch', 'roll', 'nod', 'neckCarriage', 'lumbar', 'bodyDrop', 'tailLift', 'surge', 'surgeHarm',
];

// Blend two gait parameter sets (phases blend along the shortest circular path).
export function blendGait(a, b, t, out = {}) {
  for (const k of NUMERIC_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  out.duty = { F: lerp(a.duty.F, b.duty.F, t), H: lerp(a.duty.H, b.duty.H, t) };
  out.dutyFast = { F: lerp(a.dutyFast.F, b.dutyFast.F, t), H: lerp(a.dutyFast.H, b.dutyFast.H, t) };
  out.swingH = { F: lerp(a.swingH.F, b.swingH.F, t), H: lerp(a.swingH.H, b.swingH.H, t) };
  out.stanceShift = { F: lerp(a.stanceShift.F, b.stanceShift.F, t), H: lerp(a.stanceShift.H, b.stanceShift.H, t) };
  out.phase = {};
  for (const l of LEGS) {
    let d = b.phase[l] - a.phase[l];
    d -= Math.round(d);
    out.phase[l] = (((a.phase[l] + d * t) % 1) + 1) % 1;
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;
