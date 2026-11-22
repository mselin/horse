// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// The horse sculpt: an ordered list of anatomical primitives.
//
// Every node carries
//   prim   – SDF primitive (Ellipsoid / RoundCone)
//   op, k  – smooth CSG operation and blend radius
//   weights(x,y,z,out) – bone influence of this piece of anatomy
//   hair   – direction the coat lies in (world, rest pose)
//   mat    – material region weights [coat, hoof, bareSkin, points]
//
// Landmarks come from rig.js. Shapes were blocked out against classic
// anatomical plates (Stubbs 1766, Ellenberger/Baum/Dittrich) and conformation
// proportions; see docs/RESOURCES.md.

import { Ellipsoid, RoundCone, Loft, Field, OP_ADD, OP_SUB, basisFromAxis, eulerMatrix, norm, sub, add, scale, lerp3, dot, cross } from './sdf.js';
import { FORE, HIND, SPINE, HEAD, EAR, EYE, EYE_LID, eyeFrame, eyePoint, headPt, headDir, BONE_INDEX } from './rig.js';

const NB = Object.keys(BONE_INDEX).length;

// ---------------------------------------------------------------------------
// Bone-weight helpers
// ---------------------------------------------------------------------------

function constWeights(map) {
  const entries = Object.entries(map).map(([b, w]) => [BONE_INDEX[b], w]);
  for (const [i] of entries) if (i === undefined) throw new Error('unknown bone in ' + JSON.stringify(map));
  return (prim, x, y, z, out, s) => {
    for (const [i, w] of entries) out[i] += w * s;
  };
}

// stops: [[t, boneName], ...] along the primitive's main axis (t in 0..1)
function stopWeights(stops) {
  const st = stops.map(([t, b]) => {
    const i = BONE_INDEX[b];
    if (i === undefined) throw new Error('unknown bone ' + b);
    return [t, i];
  });
  return (prim, x, y, z, out, s) => {
    const t = prim.param(x, y, z);
    if (t <= st[0][0]) return void (out[st[0][1]] += s);
    for (let i = 0; i < st.length - 1; i++) {
      const [t0, b0] = st[i], [t1, b1] = st[i + 1];
      if (t <= t1) {
        let u = (t - t0) / Math.max(1e-6, t1 - t0);
        u = u * u * (3 - 2 * u);
        out[b0] += (1 - u) * s;
        out[b1] += u * s;
        return;
      }
    }
    out[st[st.length - 1][1]] += s;
  };
}

// A chain is a polyline of joints; each segment belongs to one bone. Weights
// are hat functions centred on segment midpoints so joints blend 50/50.
function makeChain(points, bones) {
  const mids = [];
  for (let i = 0; i < points.length - 1; i++) mids.push(lerp3(points[i], points[i + 1], 0.5));
  const segs = [];
  for (let i = 0; i < mids.length - 1; i++) segs.push([mids[i], mids[i + 1], BONE_INDEX[bones[i]], BONE_INDEX[bones[i + 1]]]);
  for (const b of bones) if (BONE_INDEX[b] === undefined) throw new Error('unknown bone ' + b);
  return (prim, x, y, z, out, s) => {
    // find closest segment of the midpoint polyline
    let best = 1e9, bi = 0, bu = 0;
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      let u = ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / l2;
      const uc = Math.min(1, Math.max(0, u));
      const px = a[0] + ab[0] * uc - x, py = a[1] + ab[1] * uc - y, pz = a[2] + ab[2] * uc - z;
      const d = px * px + py * py + pz * pz;
      if (d < best) {
        best = d;
        bi = i;
        bu = u;
      }
    }
    const [, , b0, b1] = segs[bi];
    let u = Math.min(1, Math.max(0, bu));
    u = u * u * (3 - 2 * u);
    out[b0] += (1 - u) * s;
    out[b1] += u * s;
  };
}

const SPINE_CHAIN = makeChain(
  [
    [-1.2, 1.46, 0],
    [-0.62, 1.44, 0],
    [-0.32, 1.4, 0],
    [-0.03, 1.33, 0],
    [0.3, 1.31, 0],
    [0.8, 1.3, 0],
  ],
  ['pelvis', 'pelvis', 'lumbar', 'body', 'thorax', 'thorax']
);

const NECK_CHAIN = makeChain(
  [
    [0.3, 1.24, 0],
    SPINE.neck0,
    SPINE.neck1,
    SPINE.neck2,
    SPINE.neck3,
    SPINE.neck4,
    HEAD.joint,
    headPt(0.3, 0.05),
  ],
  ['thorax', 'neck0', 'neck1', 'neck2', 'neck3', 'neck4', 'head']
);

const TAIL_CHAIN = makeChain(
  [SPINE.pelvis, SPINE.tail0, SPINE.tail1, SPINE.tail2, SPINE.tail3, SPINE.tail4, SPINE.tail5, SPINE.tailTip],
  ['pelvis', 'tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5']
);

// ---------------------------------------------------------------------------
// Node construction
// ---------------------------------------------------------------------------

const MAT = {
  coat: [1, 0, 0, 0],
  hoof: [0, 1, 0, 0],
  skin: [0, 0, 1, 0],
  points: [0, 0, 0, 1], // area that shows "points" colour (lower legs, mane-line, ear rims)
};

function resolveWeights(w) {
  if (typeof w === 'function') return w;
  if (typeof w === 'string') return constWeights({ [w]: 1 });
  if (Array.isArray(w)) return stopWeights(w);
  return constWeights(w);
}

function makeNode(prim, o) {
  return {
    prim,
    op: o.op ?? OP_ADD,
    k: o.k ?? 0.05,
    stage: o.stage ?? (o.op === OP_SUB ? 1 : 0),
    weights: resolveWeights(o.bone),
    hair: norm(o.hair ?? [-1, -0.3, 0]),
    mat: o.mat ?? MAT.coat,
    name: o.name ?? '',
    // per-node blend sharpness for weights/material (defaults to k)
    wk: o.wk ?? Math.max(0.012, o.k ?? 0.05),
    side: o.side ?? 0,
  };
}

const nodes = [];

function ell(c, r, o = {}) {
  let m;
  if (o.axis) m = basisFromAxis(o.axis, o.up ?? [0, 1, 0]);
  else m = eulerMatrix(...(o.rot ?? [0, 0, 0]));
  const n = makeNode(new Ellipsoid(c, r, m), o);
  n.def = { type: 'ell', c, r, o };
  nodes.push(n);
  return n;
}

function cone(a, b, ra, rb, o = {}) {
  const n = makeNode(new RoundCone(a, b, ra, rb, o.flat ?? 1, o.flatAxis ?? [0, 0, 1]), o);
  n.def = { type: 'cone', a, b, ra, rb, o };
  nodes.push(n);
  return n;
}

// Mirror helpers ------------------------------------------------------------
const M = (p) => [p[0], p[1], -p[2]];
function mirrorBone(b) {
  if (typeof b === 'string') return b.replace(/_R$/, '_L');
  if (typeof b === 'function') return b;
  if (Array.isArray(b)) return b.map(([t, n]) => [t, n.replace(/_R$/, '_L')]);
  const o = {};
  for (const [k, v] of Object.entries(b)) o[k.replace(/_R$/, '_L')] = v;
  return o;
}
function mirrorOpts(o) {
  const r = { ...o, side: -1 };
  if (o.bone) r.bone = mirrorBone(o.bone);
  if (o.axis) r.axis = M(o.axis);
  if (o.up) r.up = M(o.up);
  if (o.hair) r.hair = M(o.hair);
  if (o.flatAxis) r.flatAxis = M(o.flatAxis);
  if (o.rot) r.rot = [-o.rot[0], -o.rot[1], o.rot[2]];
  return r;
}
// Bilateral ellipsoid / cone: define the right side, get both.
function ell2(c, r, o = {}) {
  ell(c, r, { ...o, side: 1 });
  ell(M(c), r, mirrorOpts(o));
}
function cone2(a, b, ra, rb, o = {}) {
  cone(a, b, ra, rb, { ...o, side: 1 });
  cone(M(a), M(b), ra, rb, mirrorOpts(o));
}

// Head-frame helpers: positions/dirs given as (a, b, z)
const DEG = Math.PI / 180;
// Right nostril frame (filled in by the head sculpt below)
export const NOSTRIL = {};
const H = (a, b, z = 0) => headPt(a, b, z);
const HD = (a, b, z = 0) => headDir(a, b, z);

// ===========================================================================
//  TRUNK  – lofted from cross-section stations (Thoroughbred conformation:
//  deep girth, tucked-up waist, high withers, short strong back)
// ===========================================================================
const trunkHair = [-1, -0.22, 0];
{
  // Cross-section stations: x, top, widest level (mid), bottom, half-width
  const ST = [
    [0.68, 1.3, 1.15, 1.05, 0.09],
    [0.57, 1.42, 1.17, 0.975, 0.165],
    [0.44, 1.5, 1.18, 0.915, 0.205],
    [0.3, 1.535, 1.17, 0.887, 0.232],
    [0.15, 1.53, 1.17, 0.882, 0.247],
    [0.0, 1.515, 1.18, 0.896, 0.254],
    [-0.15, 1.515, 1.2, 0.935, 0.252],
    [-0.3, 1.53, 1.23, 0.99, 0.243],
    [-0.45, 1.555, 1.27, 1.05, 0.236],
    [-0.6, 1.572, 1.3, 1.09, 0.236],
    [-0.74, 1.556, 1.32, 1.12, 0.215],
    [-0.86, 1.505, 1.32, 1.15, 0.165],
    [-0.95, 1.43, 1.32, 1.2, 0.085],
  ].map(([x, top, mid, bot, hw]) => ({ x, top, mid, bot, hw }));
  const n = makeNode(new Loft(ST), { k: 0.06, bone: SPINE_CHAIN, hair: trunkHair, name: 'trunk' });
  nodes.push(n);
}
// Withers ridge (thoracic spinous processes)
ell([0.27, 1.5, 0], [0.27, 0.115, 0.06], { rot: [0, 0, -10], k: 0.1, bone: SPINE_CHAIN, hair: [-1, -0.6, 0], name: 'withers' });
// Longissimus: flat, broad, well-muscled back
ell2([-0.14, 1.455, 0.085], [0.4, 0.06, 0.09], { k: 0.1, bone: SPINE_CHAIN, hair: trunkHair, name: 'longissimus' });
// Middle gluteals: rounded top of the croup
ell2([-0.62, 1.478, 0.085], [0.3, 0.085, 0.12], { rot: [0, 0, -7], k: 0.12, bone: SPINE_CHAIN, hair: [-1, -0.35, 0], name: 'gluteal' });
// Point of hip (tuber coxae)
ell2([-0.45, 1.41, 0.17], [0.07, 0.055, 0.045], { k: 0.1, bone: 'pelvis', hair: [-1, -0.6, 0.3], name: 'hipPoint' });
// Spring of rib / serratus behind the shoulder
// External oblique over the flank
// Flank fold toward the stifle
ell2([-0.48, 1.07, 0.15], [0.12, 0.1, 0.09], { rot: [0, 0, -25], k: 0.1, bone: { lumbar: 0.5, femur_R: 0.5 }, hair: [-1, -0.2, 0], name: 'flankFold' });

// ===========================================================================
//  HINDQUARTERS & HIND LIMBS
// ===========================================================================

// Biceps femoris: the big muscle on the side of the quarter
ell2([-0.74, 1.17, 0.13], [0.3, 0.2, 0.12], {
  axis: [-0.15, -1, 0],
  up: [1, 0, 0],
  k: 0.1,
  bone: [
    [0.2, 'pelvis'],
    [0.6, 'femur_R'],
  ],
  hair: [-0.45, -1, 0],
  name: 'bicepsFemoris',
});
// Semitendinosus: back line of the thigh, from the point of buttock to the gaskin
cone2([-0.925, 1.26, 0.075], [-0.795, 0.73, 0.1], 0.075, 0.042, {
  k: 0.08,
  bone: [
    [0.0, 'pelvis'],
    [0.3, 'femur_R'],
    [0.95, 'tibia_R'],
  ],
  hair: [-0.2, -1, 0],
  name: 'semitendinosus',
});
// Point of buttock (tuber ischii)
ell2([-0.92, 1.255, 0.075], [0.055, 0.055, 0.05], { k: 0.05, bone: 'pelvis', hair: [-0.4, -1, 0], name: 'pointOfButtock' });
// Tensor fasciae latae: ridge from the point of hip down the front of the thigh
cone2([-0.47, 1.36, 0.18], [-0.525, 0.98, 0.18], 0.045, 0.045, {
  k: 0.1,
  bone: [
    [0.1, 'pelvis'],
    [0.45, 'femur_R'],
  ],
  hair: [-0.4, -1, 0],
  name: 'tensorFascia',
});
// Quadriceps
ell2([-0.6, 1.08, 0.16], [0.2, 0.125, 0.1], {
  axis: norm(sub(HIND.stifle, HIND.hip)),
  up: [1, 0, 0],
  k: 0.1,
  bone: [
    [0.05, 'pelvis'],
    [0.35, 'femur_R'],
  ],
  hair: [-0.3, -1, 0],
  name: 'quadriceps',
});
// Stifle and patella
ell2([-0.535, 0.935, 0.168], [0.068, 0.078, 0.058], { k: 0.08, bone: { femur_R: 0.6, tibia_R: 0.4 }, hair: [-0.4, -1, 0.2], name: 'stifle' });
ell2([-0.51, 0.955, 0.155], [0.03, 0.036, 0.03], { k: 0.05, bone: 'femur_R', hair: [-0.2, -1, 0], name: 'patella' });
// Gaskin (second thigh)
cone2([-0.6, 0.88, 0.15], [-0.728, 0.61, 0.123], 0.085, 0.04, {
  k: 0.07,
  bone: [
    [0.0, 'femur_R'],
    [0.2, 'tibia_R'],
  ],
  hair: [-0.2, -1, 0],
  name: 'gaskin',
});
ell2([-0.7, 0.775, 0.132], [0.14, 0.07, 0.054], {
  axis: norm(sub(HIND.hock, HIND.stifle)),
  up: [1, 0, 0],
  k: 0.045,
  bone: 'tibia_R',
  hair: [-0.2, -1, 0],
  name: 'gastrocnemius',
});
// Achilles / gastrocnemius tendon to the point of hock
cone2([-0.762, 0.785, 0.125], [-0.814, 0.635, 0.12], 0.029, 0.025, {
  k: 0.035,
  bone: [
    [0.75, 'tibia_R'],
    [1.0, 'hcannon_R'],
  ],
  hair: [0, -1, 0],
  name: 'achilles',
});
// Hock
ell2([-0.735, 0.555, 0.12], [0.06, 0.05, 0.044], {
  axis: [0, -1, 0],
  up: [1, 0, 0],
  k: 0.04,
  bone: [
    [0.2, 'tibia_R'],
    [0.6, 'hcannon_R'],
  ],
  hair: [0, -1, 0],
  mat: MAT.points,
  name: 'hock',
});
// Point of hock: a bony point no wider than the tendon above it, with the
// back of the hock running straight on down the back of the cannon (the
// plantar ligament) rather than a knob over an undercut
ell2([-0.806, 0.632, 0.12], [0.022, 0.025, 0.021], { k: 0.04, bone: 'hcannon_R', hair: [0, -1, 0], mat: MAT.points, name: 'pointOfHock' });
cone2([-0.804, 0.612, 0.12], [-0.772, 0.47, 0.118], 0.021, 0.018, { k: 0.03, bone: 'hcannon_R', hair: [0, -1, 0], mat: MAT.points, name: 'plantarLigament' });
// Hind cannon: bone + flexor tendons behind
cone2([-0.728, 0.5, 0.12], [-0.738, 0.24, 0.115], 0.03, 0.028, { k: 0.026, bone: 'hcannon_R', hair: [0, -1, 0], mat: MAT.points, name: 'hcannonBone' });
cone2([-0.766, 0.52, 0.12], [-0.771, 0.25, 0.115], 0.019, 0.021, { flat: 0.75, k: 0.026, bone: 'hcannon_R', hair: [0, -1, 0], mat: MAT.points, name: 'htendon' });
// Hind fetlock
ell2([-0.742, 0.205, 0.115], [0.044, 0.042, 0.038], {
  axis: [0, -1, 0],
  up: [1, 0, 0],
  k: 0.032,
  bone: [
    [0.35, 'hcannon_R'],
    [0.65, 'hpastern_R'],
  ],
  hair: [0.15, -1, 0],
  mat: MAT.points,
  name: 'hfetlock',
});
ell2([-0.776, 0.215, 0.115], [0.033, 0.036, 0.032], { k: 0.028, bone: { hcannon_R: 0.5, hpastern_R: 0.5 }, hair: [0, -1, 0], mat: MAT.points, name: 'hsesamoid' });
// Ergot: a small horny nub at the back of the fetlock, mostly hidden in the
// hair; bound like the fetlock so it folds with the joint instead of popping
// out behind it like an extra toe
ell2([-0.78, 0.176, 0.115], [0.008, 0.007, 0.008], { k: 0.012, bone: { hcannon_R: 0.4, hpastern_R: 0.6 }, hair: [0, -1, 0], mat: MAT.points, name: 'hergot' });
// Hind pastern
cone2([-0.738, 0.19, 0.115], [-0.667, 0.075, 0.115], 0.033, 0.037, {
  k: 0.024,
  bone: [
    [0.0, 'hpastern_R'],
    [0.85, 'hpastern_R'],
    [1.0, 'hhoof_R'],
  ],
  hair: [0.5, -1, 0],
  mat: MAT.points,
  name: 'hpastern',
});
// Hind hoof
cone2([-0.664, 0.072, 0.115], [-0.626, -0.03, 0.115], 0.036, 0.062, { k: 0.011, wk: 0.008, bone: 'hhoof_R', hair: [0.6, -1, 0], mat: MAT.hoof, name: 'hhoof' });
// Heel bulbs: soft, only a little proud of the hoof wall's heels and merged
// into the back of the pastern (they read as a ball stuck on the heel when the
// sole turns back in swing if they stand out further)
ell2([-0.678, 0.04, 0.115], [0.016, 0.02, 0.036], { k: 0.02, wk: 0.008, bone: 'hhoof_R', hair: [0, -1, 0], mat: MAT.skin, name: 'hheelBulb' });

// ===========================================================================
//  FOREHAND & FORE LIMBS
// ===========================================================================

// Shoulder blade plate (supra/infraspinatus) – long, sloping ~47 degrees
ell2(lerp3(FORE.scapTop, FORE.shoulder, 0.48).map((v, i) => (i === 2 ? 0.16 : v)), [0.25, 0.115, 0.055], {
  axis: norm(sub(FORE.shoulder, FORE.scapTop)),
  up: [1, 0.6, 0],
  k: 0.1,
  bone: [
    [0.0, 'thorax'],
    [0.2, 'thorax'],
    [0.55, 'scap_R'],
    [0.85, 'scap_R'],
    [1.0, 'humerus_R'],
  ],
  hair: [-0.35, -1, 0],
  name: 'shoulder',
});
// Serratus ventralis cervicis: fills in front of the shoulder blade at the neck base
ell2([0.56, 1.4, 0.115], [0.14, 0.11, 0.07], { rot: [0, 0, 40], k: 0.1, bone: { thorax: 0.6, neck0: 0.4 }, hair: [-0.4, -1, 0], name: 'serratusCervicis' });
// Point of shoulder
ell2([0.685, 1.15, 0.135], [0.06, 0.066, 0.056], { k: 0.08, bone: { humerus_R: 0.6, scap_R: 0.4 }, hair: [-0.3, -1, 0], name: 'pointOfShoulder' });
// Descending pectorals (the "V" of the chest between the forelegs)
ell2([0.665, 1.07, 0.07], [0.07, 0.11, 0.07], { rot: [0, 0, 12], k: 0.09, bone: { thorax: 0.6, humerus_R: 0.4 }, hair: [-0.3, -1, 0.2], name: 'pectoral' });
// Deep pectoral under the chest
ell([0.5, 0.97, 0], [0.15, 0.07, 0.13], { k: 0.08, bone: SPINE_CHAIN, hair: [-1, 0, 0], name: 'deepPectoral' });
// Arm (humerus + brachialis / biceps)
ell2([0.57, 1.05, 0.155], [0.155, 0.08, 0.063], {
  axis: norm(sub(FORE.elbow, FORE.shoulder)),
  up: [1, 0, 0],
  k: 0.09,
  bone: 'humerus_R',
  hair: [-0.2, -1, 0],
  name: 'arm',
});
// Triceps – the big triangular mass behind the shoulder above the elbow
ell2([0.435, 1.06, 0.16], [0.17, 0.115, 0.075], {
  axis: [0.15, -1, 0],
  up: [1, 0, 0],
  k: 0.09,
  bone: [
    [0.0, 'scap_R'],
    [0.45, 'humerus_R'],
  ],
  hair: [-0.2, -1, 0],
  name: 'triceps',
});
// Elbow (olecranon) and elbow joint
ell2([0.395, 0.965, 0.162], [0.045, 0.046, 0.042], { k: 0.045, bone: 'radius_R', hair: [-0.2, -1, 0], name: 'olecranon' });
ell2([0.46, 0.93, 0.158], [0.055, 0.055, 0.05], { k: 0.045, bone: { humerus_R: 0.35, radius_R: 0.65 }, hair: [0, -1, 0], name: 'elbowJoint' });
// Forearm – long, muscular at the top, tapering to a flat knee
cone2([0.46, 0.92, 0.148], [0.483, 0.53, 0.128], 0.07, 0.038, { flat: 0.85, k: 0.06, bone: 'radius_R', hair: [0, -1, 0], name: 'forearm' });
ell2([0.505, 0.8, 0.145], [0.14, 0.046, 0.048], { axis: [0.05, -1, 0], up: [1, 0, 0], k: 0.06, bone: 'radius_R', hair: [0, -1, 0], name: 'extensorCarpi' });
ell2([0.43, 0.83, 0.145], [0.11, 0.04, 0.045], { axis: [-0.06, -1, 0], up: [1, 0, 0], k: 0.06, bone: 'radius_R', hair: [0, -1, 0], name: 'forearmFlexors' });
// Chestnut (horny callosity, inside of forearm)
ell2([0.478, 0.63, 0.086], [0.02, 0.028, 0.007], { k: 0.014, wk: 0.01, bone: 'radius_R', hair: [0, -1, 0], mat: MAT.skin, name: 'chestnut', stage: 2 });
// Knee (carpus)
ell2([0.485, 0.488, 0.125], [0.05, 0.046, 0.041], {
  axis: [0, -1, 0],
  up: [1, 0, 0],
  k: 0.035,
  bone: [
    [0.25, 'radius_R'],
    [0.7, 'fcannon_R'],
  ],
  hair: [0, -1, 0],
  mat: MAT.points,
  name: 'knee',
});
ell2([0.442, 0.51, 0.125], [0.028, 0.028, 0.026], { k: 0.028, bone: 'radius_R', hair: [0, -1, 0], mat: MAT.points, name: 'accessoryCarpal' });
// Fore cannon: bone + tendons
cone2([0.49, 0.45, 0.125], [0.49, 0.24, 0.12], 0.029, 0.028, { k: 0.025, bone: 'fcannon_R', hair: [0, -1, 0], mat: MAT.points, name: 'fcannonBone' });
cone2([0.458, 0.455, 0.125], [0.458, 0.245, 0.12], 0.019, 0.021, { flat: 0.75, k: 0.025, bone: 'fcannon_R', hair: [0, -1, 0], mat: MAT.points, name: 'ftendon' });
// Fore fetlock
ell2([0.49, 0.205, 0.12], [0.044, 0.043, 0.039], {
  axis: [0, -1, 0],
  up: [1, 0, 0],
  k: 0.032,
  bone: [
    [0.35, 'fcannon_R'],
    [0.65, 'fpastern_R'],
  ],
  hair: [0.15, -1, 0],
  mat: MAT.points,
  name: 'ffetlock',
});
ell2([0.455, 0.215, 0.12], [0.033, 0.036, 0.032], { k: 0.028, bone: { fcannon_R: 0.5, fpastern_R: 0.5 }, hair: [0, -1, 0], mat: MAT.points, name: 'fsesamoid' });
ell2([0.449, 0.178, 0.12], [0.008, 0.007, 0.008], { k: 0.012, bone: { fcannon_R: 0.4, fpastern_R: 0.6 }, hair: [0, -1, 0], mat: MAT.points, name: 'fergot' });
// Fore pastern
cone2([0.495, 0.19, 0.12], [0.57, 0.077, 0.12], 0.033, 0.038, {
  k: 0.024,
  bone: [
    [0.0, 'fpastern_R'],
    [0.85, 'fpastern_R'],
    [1.0, 'fhoof_R'],
  ],
  hair: [0.5, -1, 0],
  mat: MAT.points,
  name: 'fpastern',
});
// Fore hoof (rounder and larger than the hind)
cone2([0.567, 0.074, 0.12], [0.61, -0.032, 0.12], 0.038, 0.067, { k: 0.011, wk: 0.008, bone: 'fhoof_R', hair: [0.6, -1, 0], mat: MAT.hoof, name: 'fhoof' });
ell2([0.552, 0.04, 0.12], [0.016, 0.02, 0.039], { k: 0.02, wk: 0.008, bone: 'fhoof_R', hair: [0, -1, 0], mat: MAT.skin, name: 'fheelBulb' });

// ===========================================================================
//  NECK – long, light, gently arched
// ===========================================================================
{
  const base = [0.56, 1.36, 0];
  const top = [1.0, 1.9, 0];
  const d = norm(sub(top, base));
  const n = [-d[1], d[0], 0]; // in-plane perpendicular toward the crest
  const st = [
    [0.0, 0.29, 0.175, 0.0],
    [0.2, 0.235, 0.148, 0.01],
    [0.4, 0.195, 0.126, 0.018],
    [0.6, 0.165, 0.11, 0.022],
    [0.8, 0.142, 0.097, 0.02],
    [1.0, 0.126, 0.088, 0.012],
  ];
  const L = Math.hypot(top[0] - base[0], top[1] - base[1]);
  for (const [s, ht, hw, off] of st) {
    const c = add(add(base, scale(d, s * L)), scale(n, off));
    ell(c, [0.16, ht, hw], { axis: d, up: n, k: 0.1, bone: NECK_CHAIN, hair: [-0.25, -1, 0], name: 'neck' });
  }
  // Crest (nuchal ligament + rhomboideus under the mane)
  cone([0.4, 1.6, 0], [0.98, 1.99, 0], 0.055, 0.04, { k: 0.09, bone: NECK_CHAIN, hair: [-0.25, -1, 0], name: 'crest', mat: [0.6, 0, 0, 0.4] });
  // Splenius: upper side of the neck
  ell2([0.75, 1.68, 0.05], [0.26, 0.1, 0.07], { axis: d, up: n, k: 0.08, bone: NECK_CHAIN, hair: [-0.25, -1, 0], name: 'splenius' });
  // Brachiocephalicus: point of shoulder up to behind the jaw; borders the jugular groove
  cone2([0.7, 1.16, 0.118], [1.03, 1.8, 0.065], 0.055, 0.038, { k: 0.06, bone: NECK_CHAIN, hair: [-0.25, -1, 0], name: 'brachiocephalicus' });
  // Trachea / underline of the neck
  cone([0.78, 1.2, 0], [1.03, 1.77, 0], 0.052, 0.043, { k: 0.08, bone: NECK_CHAIN, hair: [-0.4, -1, 0], name: 'trachea' });
}

// ===========================================================================
//  HEAD (head frame: a along the face from the poll, b toward the jaw)
//  Refined Thoroughbred head: flat forehead, straight profile, big round jowl,
//  fine muzzle with large nostrils.
// ===========================================================================
{
  const u = HEAD.u;
  const v = HEAD.v;
  const up = scale(v, -1);
  const hb = 'head';
  const faceHair = HD(1, 0.15);
  // ---- skull ----
  ell(H(0.065, 0.03), [0.11, 0.092, 0.078], { axis: u, up, k: 0.055, bone: hb, hair: faceHair, name: 'cranium' });
  ell(H(0.0, -0.022), [0.06, 0.05, 0.068], { axis: u, up, k: 0.045, bone: hb, hair: faceHair, name: 'poll' });
  ell(H(0.18, 0.0), [0.105, 0.06, 0.088], { axis: u, up, k: 0.045, bone: hb, hair: faceHair, name: 'forehead' });
  // Brow (supraorbital process) – a soft bony shelf over the eye
  ell2(H(0.168, -0.036, 0.068), [0.04, 0.017, 0.025], { axis: HD(1, 0.25), up, k: 0.035, bone: hb, hair: faceHair, name: 'brow' });
  // Jowl: big flat round masseter disc with a readable rim
  ell2(H(0.2, 0.112, 0.054), [0.1, 0.095, 0.042], { axis: HD(1, 0.1), up, k: 0.026, bone: hb, hair: HD(0.6, 1), name: 'jowl' });
  ell2(H(0.075, 0.035, 0.052), [0.06, 0.06, 0.036], { axis: u, up, k: 0.045, bone: hb, hair: faceHair, name: 'temporal' });
  // Facial crest (zygomatic ridge): a sharp bony ridge running forward and
  // down from under the eye, the upper border of the cheek
  cone2(H(0.215, 0.036, 0.076), H(0.345, 0.066, 0.066), 0.0085, 0.0055, { k: 0.016, bone: hb, hair: faceHair, name: 'facialCrest' });
  // Face and nose: long, straight nasal line, narrowing toward the muzzle
  ell(H(0.295, 0.045), [0.115, 0.08, 0.07], { axis: u, up, k: 0.055, bone: hb, hair: faceHair, name: 'face' });
  ell(H(0.41, 0.045), [0.095, 0.068, 0.054], { axis: u, up, k: 0.05, bone: hb, hair: faceHair, name: 'nose' });
  // Mandible branches and the ganache between them
  cone2(H(0.22, 0.15, 0.033), H(0.46, 0.115, 0.019), 0.036, 0.026, { k: 0.04, bone: hb, hair: HD(0.8, 0.6), name: 'mandible' });
  ell(H(0.24, 0.158), [0.085, 0.038, 0.038], { axis: u, up, k: 0.04, bone: hb, hair: HD(0.5, 1), name: 'ganache' });

  // ---- muzzle ----
  ell(H(0.5, 0.058), [0.064, 0.062, 0.054], { axis: u, up, k: 0.04, bone: hb, hair: faceHair, mat: [0.35, 0, 0.65, 0], name: 'muzzle' });
  // soft nose over and between the nostrils (the nasal bone ends near a = 0.42)
  ell(H(0.53, 0.014), [0.034, 0.028, 0.034], { axis: u, up, k: 0.03, bone: hb, hair: faceHair, mat: [0.45, 0, 0.55, 0], name: 'softNose' });
  // upper lip: broad and prehensile, overhanging the lower lip a little
  ell(H(0.548, 0.084), [0.034, 0.04, 0.05], { axis: HD(1, 0.25), up, k: 0.026, bone: hb, hair: faceHair, mat: MAT.skin, name: 'upperLip' });
  // lower lip, smaller, set back under the upper lip
  ell(H(0.512, 0.125), [0.036, 0.022, 0.034], { axis: HD(1, -0.1), up, k: 0.02, bone: hb, hair: HD(0.6, 1), mat: MAT.skin, name: 'lowerLip' });
  // chin: a round fleshy pad behind the lower lip
  ell(H(0.468, 0.143), [0.042, 0.027, 0.03], { axis: HD(1, 0.2), up, k: 0.018, bone: hb, hair: HD(0.6, 1), mat: [0.5, 0, 0.5, 0], name: 'chin' });

  // ---- mouth ----
  ell(H(0.51, 0.106), [0.054, 0.0026, 0.06], { axis: HD(1, -0.1), up, op: OP_SUB, k: 0.008, bone: hb, mat: MAT.skin, name: 'mouth' });

  // ---- nostrils: a large comma on each side of the muzzle ----
  // (NOSTRIL keeps the right side's frame for the breathing flare in coat.js)
  // Laid out on the muzzle surface as sculpted so far: O, the centre of the
  // opening, and the rim are projected onto it. n: the way the opening faces
  // (out and forward of the surface normal); L: its long axis (up and back
  // toward the eye); W: across it, forward.
  {
    const base = new Field(nodes.filter((q) => q.op === OP_ADD && q.stage === 0));
    const g = [0, 0, 0];
    const onSkin = (p, depth = 0) => {
      let q = p.slice();
      for (let it = 0; it < 4; it++) {
        const d = base.evalList(null, q[0], q[1], q[2]);
        base.gradient(q[0], q[1], q[2], 0.0005, g);
        q = sub(q, scale(g, d + depth));
      }
      base.gradient(q[0], q[1], q[2], 0.0005, g);
      return [q, g.slice()];
    };
    const [O, ns] = onSkin(H(0.536, 0.03, 0.05));
    const n = norm(add(ns, scale(u, 0.45)));
    let L = HD(-0.55, -0.85);
    L = norm(sub(L, scale(n, dot(L, n))));
    let W = norm(cross(n, L));
    if (dot(W, u) < 0) W = scale(W, -1);
    const P = (l, w, d) => add(O, add(scale(L, l), add(scale(W, w), scale(n, d))));
    Object.assign(NOSTRIL, { O, n, L, W, size: [0.023, 0.0128] });
    const skinIn = [0.1, 0, 0.9, 0];
    // the opening, then the passage running in and back toward the nasal cavity
    ell2(P(0, 0, -0.008), [0.022, 0.012, 0.02], { axis: L, up: W, op: OP_SUB, k: 0.006, bone: hb, mat: skinIn, name: 'nostril' });
    cone2(P(0, 0, -0.012), add(P(0.004, 0, -0.03), scale(u, -0.035)), 0.011, 0.008, { op: OP_SUB, k: 0.008, bone: hb, mat: skinIn, name: 'nostrilPassage' });
    // false nostril: the slit that carries on up and back
    ell2(P(0.03, -0.002, -0.002), [0.02, 0.0035, 0.008], { axis: L, up: W, op: OP_SUB, k: 0.004, bone: hb, mat: skinIn, name: 'falseNostril' });
    // alar fold: the rolled rim round the front of the opening, curling into
    // the false nostril at the top, lying on the skin
    const rim = [];
    for (let i = 0; i <= 6; i++) {
      const th = (-80 + (180 * i) / 6) * DEG;
      const r = 0.0026 + 0.0012 * Math.cos(th * 0.85);
      rim.push([onSkin(P(0.023 * Math.sin(th), 0.0128 * Math.cos(th), 0), r * 0.55)[0], r]);
    }
    for (let i = 0; i < rim.length - 1; i++)
      cone2(rim[i][0], rim[i + 1][0], rim[i][1], rim[i + 1][1], { stage: 2, k: 0.01, bone: hb, hair: faceHair, mat: [0.35, 0, 0.65, 0], name: 'alarFold' });
  }

  // ---- eyes: an almond opening framed by rolled lid margins ----
  // The globe is first wrapped in a thin skin shell (stage 2), and the almond
  // is carved out of that shell (stage 3), so the opening shows nothing but
  // the eyeball: whatever the carve removes inside the globe is hidden by it.
  // The lid margins and the lid fold come after (stage 4).
  {
    const F = eyeFrame(1);
    const R = EYE.radius;
    const at = (x, u, z) => add(EYE.center, add(scale(F.x, x), add(scale(F.u, u), scale(F.z, z))));
    ell2(EYE.center, [R + 0.0032, R + 0.0032, R + 0.0032], { stage: 2, k: 0.01, bone: hb, hair: faceHair, name: 'eyeShell' });
    ell2(at(0, 0.0017, 0.012), [0.023, 0.0164, 0.03], { axis: F.x, up: F.u, op: OP_SUB, stage: 3, k: 0.002, bone: hb, mat: MAT.skin, name: 'eyeOpening' });
    // lid margins: chains of round cones hugging the eyeball, thick on the
    // upper lid, thinner below
    const lid = (name, upper, tube, rOff, elOff, t0, t1, n, o) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        const tr = tube(t);
        pts.push([eyePoint(F, EYE_LID.az(t), EYE_LID.el(t, upper) + elOff, R + rOff(tr)), tr]);
      }
      for (let i = 0; i < n; i++) cone2(pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1], { bone: hb, hair: faceHair, name, ...o });
    };
    const bump = (t) => Math.pow(Math.sin(Math.PI * t), 0.7);
    lid('upperLid', true, (t) => 0.0018 + 0.0022 * bump(t), (tr) => 0.45 * tr, 0, 0, 1, 10, { stage: 4, k: 0.004, mat: [0.3, 0, 0.7, 0] });
    lid('lowerLid', false, (t) => 0.0015 + 0.0012 * bump(t), (tr) => 0.4 * tr, 0, 0, 1, 10, { stage: 4, k: 0.004, mat: [0.3, 0, 0.7, 0] });
    // the body of the upper lid: a soft roll of skin over the top of the globe
    lid('upperLidFold', true, (t) => 0.002 + 0.0022 * bump(t), () => 0.0035, 15 * DEG, 0.1, 0.9, 8, { stage: 4, k: 0.008 });
  }

  // ---- ears: leaf shaped, cupped only on the front ----
  const eb = EAR.base, edir = norm(EAR.dir), el = EAR.length;
  const fwd = norm([1, -0.2, 0.3]);
  ell2(add(eb, scale(edir, 0.062)), [0.076, 0.032, 0.022], { axis: edir, up: fwd, k: 0.026, bone: 'ear_R', hair: edir, mat: [0.6, 0, 0, 0.4], name: 'ear' });
  cone2(add(eb, scale(edir, 0.09)), add(add(eb, scale(edir, el)), [0.006, 0, -0.012]), 0.02, 0.003, { flat: 0.55, flatAxis: fwd, k: 0.022, bone: 'ear_R', hair: edir, mat: [0.5, 0, 0, 0.5], name: 'earTip' });
  ell2(add(add(eb, scale(edir, 0.075)), scale(fwd, 0.03)), [0.058, 0.014, 0.016], { axis: edir, up: fwd, op: OP_SUB, stage: 3, k: 0.008, bone: 'ear_R', mat: MAT.skin, name: 'concha' });
}

// ===========================================================================
//  TAIL DOCK
// ===========================================================================
{
  const pts = [SPINE.tail0, SPINE.tail1, SPINE.tail2, SPINE.tail3, SPINE.tail4, SPINE.tail5, SPINE.tailTip];
  const rads = [0.05, 0.043, 0.038, 0.034, 0.03, 0.026, 0.021];
  for (let i = 0; i < pts.length - 1; i++) {
    cone(pts[i], pts[i + 1], rads[i], rads[i + 1], { k: i === 0 ? 0.08 : 0.02, bone: TAIL_CHAIN, hair: norm(sub(pts[i + 1], pts[i])), mat: MAT.points, name: 'dock' });
  }
}

// Order: additive (stage 0), carve (1), post-add (2), post-carve (3), and the
// eyelids after those (4)
nodes.sort((a, b) => a.stage - b.stage);

export const HORSE_NODES = nodes;
export const NUM_BONES = NB;
export { MAT };

// ===========================================================================
//  SUPERFICIAL VEINS (right side; mirrored). Control points are rough – the
//  bake snaps them onto the skin. r = visible radius (m).
// ===========================================================================
const veinDefs = [
  // facial vein: jaw angle up along the front of the masseter toward the eye
  { r: 0.0042, pts: [H(0.12, 0.2, 0.06), H(0.19, 0.16, 0.085), H(0.25, 0.1, 0.085), H(0.31, 0.07, 0.075), H(0.37, 0.062, 0.066)] },
  // transverse facial branch under the facial crest
  { r: 0.0032, pts: [H(0.22, 0.09, 0.09), H(0.17, 0.065, 0.09), H(0.12, 0.06, 0.08)] },
  // jugular vein in the jugular groove
  { r: 0.0045, pts: [[1.0, 1.72, 0.07], [0.93, 1.56, 0.11], [0.85, 1.42, 0.13], [0.78, 1.3, 0.14], [0.72, 1.2, 0.14]] },
  // superficial thoracic ("spur") vein along the lower barrel
  { r: 0.0042, pts: [[0.36, 0.98, 0.2], [0.22, 0.95, 0.23], [0.06, 0.95, 0.25], [-0.1, 0.99, 0.25], [-0.26, 1.04, 0.23], [-0.38, 1.08, 0.2]] },
  // lateral thoracic branch over the ribs behind the elbow
  { r: 0.0028, pts: [[0.3, 1.02, 0.22], [0.24, 1.1, 0.24], [0.14, 1.16, 0.25], [0.02, 1.2, 0.26]] },
  // cephalic vein, front-inside of the forearm
  { r: 0.0035, pts: [[0.58, 1.0, 0.1], [0.53, 0.88, 0.1], [0.505, 0.76, 0.1], [0.495, 0.64, 0.1], [0.49, 0.53, 0.1]] },
  // accessory cephalic on the front of the forearm
  { r: 0.0025, pts: [[0.52, 0.86, 0.15], [0.515, 0.74, 0.16], [0.5, 0.6, 0.15]] },
  // medial saphenous vein, inside of the hind leg
  { r: 0.0035, pts: [[-0.58, 0.9, 0.1], [-0.63, 0.8, 0.09], [-0.68, 0.7, 0.09], [-0.71, 0.6, 0.1], [-0.725, 0.52, 0.1]] },
  // lateral saphenous over the gaskin
  { r: 0.0026, pts: [[-0.66, 0.86, 0.19], [-0.7, 0.76, 0.17], [-0.74, 0.65, 0.15]] },
  // small vein over the point of shoulder toward the neck
  { r: 0.0024, pts: [[0.7, 1.16, 0.15], [0.66, 1.26, 0.16], [0.62, 1.36, 0.15]] },
];
export const VEINS = [];
for (const v of veinDefs) {
  VEINS.push({ r: v.r, pts: v.pts });
  VEINS.push({ r: v.r, pts: v.pts.map(M) });
}
// Forehead hair whorl (cowlick) – centre on the skin of the forehead
export const WHORL = { center: headPt(0.2, -0.068, 0), radius: 0.045 };
