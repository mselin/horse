// Assembles the baked mesh, skeleton, eyes and hair into a three.js object.

import * as THREE from 'three';
import { BONE_DEFS, EYE } from './rig.js';
import { createCoatMaterial } from './coat.js';
import { sculptKey, cacheGet, cachePut } from './cache.js';

// Bake (or fetch from the IndexedDB cache) the horse mesh.
export async function loadHorseMesh(cell, onProgress, { useCache = true } = {}) {
  const key = sculptKey(cell);
  if (useCache) {
    const hit = await cacheGet(key);
    if (hit) {
      onProgress && onProgress(1, 'Loaded from cache');
      return hit;
    }
  }
  const baked = await bakeInWorker(cell, onProgress);
  if (useCache) {
    // store copies: the originals are handed to WebGL
    const copy = {};
    for (const k of Object.keys(baked)) copy[k] = baked[k] && baked[k].slice ? baked[k].slice() : baked[k];
    cachePut(key, copy);
  }
  return baked;
}

export function bakeInWorker(cell, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./horse.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress && onProgress(e.data.p, e.data.label);
      else if (e.data.type === 'done') {
        worker.terminate();
        resolve(e.data.result);
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ cell });
  });
}

export function buildSkeleton() {
  const bones = [];
  const byName = {};
  for (const def of BONE_DEFS) {
    const b = new THREE.Bone();
    b.name = def.name;
    const parent = def.parent ? byName[def.parent] : null;
    const pp = parent ? parent.userData.rest : [0, 0, 0];
    b.position.set(def.pos[0] - pp[0], def.pos[1] - pp[1], def.pos[2] - pp[2]);
    b.userData.rest = def.pos;
    b.userData.restLocal = b.position.clone();
    if (parent) parent.add(b);
    bones.push(b);
    byName[def.name] = b;
  }
  return { bones, byName, skeleton: new THREE.Skeleton(bones) };
}

export class Horse {
  constructor(baked, { coat } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'Horse';

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(baked.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(baked.normals, 3));
    g.setAttribute('tangent', new THREE.BufferAttribute(baked.tangent, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(baked.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(baked.skinWeight, 4));
    g.setAttribute('mats', new THREE.BufferAttribute(baked.mats, 4));
    g.setAttribute('aoCurv', new THREE.BufferAttribute(baked.aoCurv, 2));
    g.setAttribute('vein', new THREE.BufferAttribute(baked.vein, 4));
    g.setAttribute('restPos', new THREE.BufferAttribute(baked.positions.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(baked.indices, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius += 1.5; // room for animation
    this.geometry = g;

    const { bones, byName, skeleton } = buildSkeleton();
    this.bones = byName;
    this.skeleton = skeleton;

    this.material = createCoatMaterial(coat);
    const mesh = new THREE.SkinnedMesh(g, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.add(bones[0]);
    mesh.bind(skeleton);
    this.mesh = mesh;
    this.group.add(mesh);

    this.addEyes();
  }

  addEyes() {
    const head = this.bones.head;
    const rest = head.userData.rest;
    const eyeGeo = new THREE.SphereGeometry(EYE.radius, 48, 32);
    // Eyeball: very dark brown iris with a horizontal pupil, glossy cornea.
    const tex = makeEyeTexture();
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      ior: 1.376,
    });
    for (const s of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, mat);
      eye.position.set(EYE.center[0] - rest[0], EYE.center[1] - rest[1], s * EYE.center[2] - rest[2]);
      const dir = new THREE.Vector3(EYE.dir[0], EYE.dir[1], s * EYE.dir[2]);
      // sphere UV: texture centre (u=0.5) faces -Z by default after this rotation
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      eye.castShadow = false;
      eye.receiveShadow = true;
      head.add(eye);
    }
  }
}

function makeEyeTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  // Sphere UVs: u wraps around Y; the +Z pole region maps to u=0.25 (three.js default).
  g.fillStyle = '#1a0f0a';
  g.fillRect(0, 0, 512, 256);
  const cx = 512 * 0.25, cy = 128;
  const grad = g.createRadialGradient(cx, cy, 4, cx, cy, 90);
  grad.addColorStop(0, '#050302');
  grad.addColorStop(0.35, '#2b170c');
  grad.addColorStop(0.75, '#3a2111');
  grad.addColorStop(1, '#120a06');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(cx, cy, 95, 80, 0, 0, Math.PI * 2);
  g.fill();
  // iris fibres
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 20 + Math.random() * 20, r1 = 60 + Math.random() * 30;
    g.strokeStyle = `rgba(${70 + Math.random() * 40},${40 + Math.random() * 20},${20},0.25)`;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.85);
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.85);
    g.stroke();
  }
  // horizontal oval pupil
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(cx, cy, 40, 16, 0, 0, Math.PI * 2);
  g.fill();
  // corpora nigra along the top of the pupil
  g.fillStyle = '#0b0603';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.ellipse(cx - 14 + i * 14, cy - 15, 9, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
