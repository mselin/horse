// Skeleton of a ~16 hh (1.62 m at the withers) riding horse in a square
// standing pose. Units: metres. Axes: +X forward, +Y up, +Z to the horse's
// right side. All bones have identity rest rotation, so a bone's rest frame is
// the world frame and its child offset vectors are plain position differences.
//
// Proportions follow common conformation references (see docs/RESOURCES.md):
//   * withers height ~= body length (point of shoulder -> point of buttock)
//   * head length ~= 0.4 x withers height, neck topline ~= 1.5 head lengths
//   * shoulder / back / hip ~= equal thirds in side view
//   * standing joint angles (measured literature): stifle ~128 deg,
//     hock ~160 deg, hind fetlock ~155 deg, hoof-pastern axis ~55 deg.

const DEG = Math.PI / 180;

export const WITHERS_HEIGHT = 1.63;

// ---------------------------------------------------------------------------
// Head frame. The head is sculpted in its own 2D frame: `a` runs from the poll
// along the face toward the muzzle, `b` runs from the face line toward the
// jaw (ventral), `z` is lateral.
// ---------------------------------------------------------------------------
export const HEAD = {
  joint: [1.08, 1.99, 0], // atlanto-occipital joint (head bone pivot)
  angle: -57 * DEG, // face line inclination below horizontal
};
const hu = [Math.cos(HEAD.angle), Math.sin(HEAD.angle), 0];
const hv = [hu[1], -hu[0], 0];
HEAD.u = hu;
HEAD.v = hv;
export function headPt(a, b, z = 0) {
  return [HEAD.joint[0] + a * hu[0] + b * hv[0], HEAD.joint[1] + a * hu[1] + b * hv[1], z];
}
// Convert a direction given in head frame (a, b, z) to world.
export function headDir(a, b, z = 0) {
  const d = [a * hu[0] + b * hv[0], a * hu[1] + b * hv[1], z];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

// ---------------------------------------------------------------------------
// Limb joint landmarks (right side, z > 0). Left side mirrors z.
// ---------------------------------------------------------------------------
export const FORE = {
  scapTop: [0.33, 1.5, 0.075], // dorsal border of the scapula (under the withers)
  scapPivot: [0.4, 1.42, 0.1], // scapula rotates about its upper third
  shoulder: [0.65, 1.15, 0.15], // scapulohumeral joint (point of shoulder just in front)
  elbow: [0.46, 0.93, 0.155],
  carpus: [0.485, 0.485, 0.125], // "knee"
  fetlock: [0.49, 0.205, 0.12],
  coffin: [0.58, 0.055, 0.12],
  toe: [0.665, 0, 0.12],
  heel: [0.515, 0, 0.12],
};

export const HIND = {
  hip: [-0.76, 1.27, 0.18], // coxofemoral joint
  stifle: [-0.55, 0.92, 0.175],
  hock: [-0.73, 0.55, 0.12], // tarsocrural joint
  pointOfHock: [-0.815, 0.635, 0.12],
  fetlock: [-0.74, 0.205, 0.115],
  coffin: [-0.655, 0.05, 0.115],
  toe: [-0.575, 0, 0.115],
  heel: [-0.71, 0, 0.115],
};

export const SPINE = {
  body: [0.0, 1.33, 0], // centre of the trunk; carries bob / pitch / roll
  thorax: [0.12, 1.34, 0],
  neck0: [0.56, 1.36, 0],
  neck1: [0.65, 1.47, 0],
  neck2: [0.74, 1.58, 0],
  neck3: [0.83, 1.69, 0],
  neck4: [0.92, 1.8, 0],
  lumbar: [-0.18, 1.41, 0],
  pelvis: [-0.46, 1.45, 0], // lumbosacral joint
  tail0: [-0.89, 1.5, 0],
  tail1: [-0.96, 1.47, 0],
  tail2: [-1.01, 1.4, 0],
  tail3: [-1.04, 1.315, 0],
  tail4: [-1.055, 1.225, 0],
  tail5: [-1.062, 1.135, 0],
  tailTip: [-1.065, 1.05, 0],
};

// Ear base & direction in world (right side).
export const EAR = {
  base: headPt(-0.012, -0.054, 0.048),
  dir: [0.22, 0.95, 0.2],
  length: 0.16,
};

export const EYE = {
  center: headPt(0.178, -0.012, 0.074),
  radius: 0.026,
  // gaze direction (world, right eye)
  dir: (() => {
    const d = headDir(0.35, -0.12, 0.93);
    return d;
  })(),
};

const mirror = (p) => [p[0], p[1], -p[2]];

// ---------------------------------------------------------------------------
// Bone list. Order matters: parents before children.
// ---------------------------------------------------------------------------
export function buildBoneDefs() {
  const bones = [];
  const add = (name, parent, pos) => bones.push({ name, parent, pos });
  add('root', null, [0, 0, 0]);
  add('body', 'root', SPINE.body);
  add('thorax', 'body', SPINE.thorax);
  add('neck0', 'thorax', SPINE.neck0);
  add('neck1', 'neck0', SPINE.neck1);
  add('neck2', 'neck1', SPINE.neck2);
  add('neck3', 'neck2', SPINE.neck3);
  add('neck4', 'neck3', SPINE.neck4);
  add('head', 'neck4', HEAD.joint);
  add('ear_R', 'head', EAR.base);
  add('ear_L', 'head', mirror(EAR.base));
  add('lumbar', 'body', SPINE.lumbar);
  add('pelvis', 'lumbar', SPINE.pelvis);
  add('tail0', 'pelvis', SPINE.tail0);
  add('tail1', 'tail0', SPINE.tail1);
  add('tail2', 'tail1', SPINE.tail2);
  add('tail3', 'tail2', SPINE.tail3);
  add('tail4', 'tail3', SPINE.tail4);
  add('tail5', 'tail4', SPINE.tail5);
  for (const s of ['R', 'L']) {
    const m = s === 'R' ? (p) => p : mirror;
    add(`scap_${s}`, 'thorax', m(FORE.scapPivot));
    add(`humerus_${s}`, `scap_${s}`, m(FORE.shoulder));
    add(`radius_${s}`, `humerus_${s}`, m(FORE.elbow));
    add(`fcannon_${s}`, `radius_${s}`, m(FORE.carpus));
    add(`fpastern_${s}`, `fcannon_${s}`, m(FORE.fetlock));
    add(`fhoof_${s}`, `fpastern_${s}`, m(FORE.coffin));
    add(`femur_${s}`, 'pelvis', m(HIND.hip));
    add(`tibia_${s}`, `femur_${s}`, m(HIND.stifle));
    add(`hcannon_${s}`, `tibia_${s}`, m(HIND.hock));
    add(`hpastern_${s}`, `hcannon_${s}`, m(HIND.fetlock));
    add(`hhoof_${s}`, `hpastern_${s}`, m(HIND.coffin));
  }
  return bones;
}

export const BONE_DEFS = buildBoneDefs();
export const BONE_INDEX = Object.fromEntries(BONE_DEFS.map((b, i) => [b.name, i]));
