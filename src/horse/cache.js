// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// IndexedDB cache for baked meshes, keyed by a hash of the sculpt definition,
// so the multi-second bake only runs when the anatomy actually changes.

import { HORSE_NODES, VEINS, WHORL } from './anatomy.js';
import { BONE_DEFS } from './rig.js';

const DB = 'horse-bake-cache';
const STORE = 'meshes';
const FIELDS = ['positions', 'normals', 'indices', 'skinIndex', 'skinWeight', 'tangent', 'mats', 'aoCurv', 'vein'];

export function sculptKey(cell) {
  const json = JSON.stringify({
    cell,
    v: 6, // bump whenever bake.js output changes
    bones: BONE_DEFS,
    nodes: HORSE_NODES.map((n) => [n.def, n.k, n.op, n.stage, n.mat, n.hair, n.wk, n.name]),
    veins: VEINS,
    whorl: WHORL,
  });
  // FNV-1a 32 bit, twice with different seeds
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet(key) {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result && FIELDS.every((f) => r.result[f]) ? r.result : null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function cachePut(key, data) {
  try {
    const db = await open();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      st.clear();
      const rec = {};
      for (const f of FIELDS) rec[f] = data[f];
      st.put(rec, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    /* caching is best-effort */
  }
}
