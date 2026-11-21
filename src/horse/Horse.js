// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Assembles the baked mesh, skeleton, eyes and hair into a three.js object.

import * as THREE from 'three';
import { BONE_DEFS } from './rig.js';
import { createCoatMaterial, COATS } from './coat.js';
import { Eyes } from './Eyes.js';
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

    this.eyes = new Eyes(this);
    this.setCoatColors(coat);
  }

  // colours of the parts drawn outside the coat shader (the blinking lids)
  setCoatColors(name) {
    const c = COATS[name] ?? COATS.bay;
    this.eyes.setColors(c.body, c.skin);
  }
}
