// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Debug page: bakes the horse and renders it from fixed views (?view=side|front|back|top|q34|head|legs)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bakeInWorker, Horse } from './horse/Horse.js';
import { Locomotion } from './horse/Locomotion.js';
import { GAITS } from './horse/gaits.js';
import { Hair } from './horse/Hair.js';
import { MANE_COLORS } from './horse/coat.js';
import { addFacialHairs } from './horse/FacialHairs.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'side';
const cell = parseFloat(params.get('cell') || '0.009');
const wire = params.has('wire');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9aa3ad');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const sun = new THREE.DirectionalLight('#fff3e0', 2.6);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -0.5, near: 0.1, far: 12 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight('#cfe0ff', '#6b5a48', 0.5));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#7d725f', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
const views = {
  side: [[0.15, 1.05, 6.2], [0.15, 1.0, 0]],
  left: [[0.15, 1.05, -6.2], [0.15, 1.0, 0]],
  front: [[6.0, 1.2, 0.0], [0, 1.0, 0]],
  back: [[-6.0, 1.3, 0.0], [0, 1.0, 0]],
  top: [[0.15, 7.5, 0.01], [0.15, 1.0, 0]],
  q34: [[3.6, 1.7, 4.2], [0.15, 1.0, 0]],
  rq34: [[-3.8, 1.8, 3.8], [-0.1, 1.0, 0]],
  head: [[2.05, 1.95, 1.05], [1.2, 1.78, 0.0]],
  headside: [[1.2, 1.8, 1.45], [1.2, 1.78, 0.0]],
  headfront: [[2.7, 1.9, 0.0], [1.25, 1.76, 0.0]],
  eye: [[1.45, 1.92, 0.55], [1.2, 1.9, 0.08]],
  eyeclose: [[1.3, 1.83, 0.36], [1.187, 1.847, 0.074]],
  muzzle: [[1.62, 1.6, 0.42], [1.3, 1.52, 0.0]],
  muzzleside: [[1.3, 1.55, 0.62], [1.29, 1.53, 0.0]],
  muzzlefront: [[1.85, 1.5, 0.0], [1.31, 1.53, 0.0]],
  ear: [[1.45, 2.15, 0.35], [1.12, 2.1, 0.06]],
  legs: [[0.6, 0.5, 2.6], [0.0, 0.45, 0]],
  hindlegs: [[-0.45, 0.6, 1.35], [-0.75, 0.45, 0.1]],
  hindhoof: [[-0.55, 0.32, 0.85], [-0.8, 0.22, 0.12]],
  hoof: [[1.2, 0.25, 0.9], [0.55, 0.1, 0.13]],
};
const [cp, ct] = views[view] || views.side;
camera.position.set(...cp);
controls.target.set(...ct);
controls.update();

const status = document.createElement('div');
status.style.cssText = 'position:fixed;left:8px;top:8px;font:12px monospace;color:#000';
document.body.appendChild(status);

const baked = await bakeInWorker(cell, (p, l) => (status.textContent = `${l} ${(p * 100) | 0}%`));
status.textContent = `verts ${baked.positions.length / 3}`;
const horse = new Horse(baked, { coat: params.get('coat') || 'chestnut' });
if (wire) horse.material.wireframe = true;
scene.add(horse.group);
if (params.has('skel')) {
  const helper = new THREE.SkeletonHelper(horse.mesh);
  scene.add(helper);
}
window.__horse = horse;
// ?flare=0..1 holds the nostrils flared
if (params.has('flare')) horse.material.userData.uniforms.uFlare.value = parseFloat(params.get('flare'));
// ?blink=0..1 holds the upper lids part-closed (0 open, 1 closed)
if (params.has('blink')) {
  const b = parseFloat(params.get('blink'));
  horse.eyes.update(0, { headLook: { yaw: 0, tYaw: 0 }, standing: false });
  horse.eyes.blink.next = 1e9;
  horse.eyes.blink.t = 0.085;
  horse.eyes.blink.amp = b;
  horse.eyes.update(0.001, { headLook: { yaw: 0, tYaw: 0 }, standing: false });
}
const hair = params.has('nohair') ? null : new Hair(horse, { color: MANE_COLORS[params.get('coat') || 'chestnut'] });
if (hair) scene.add(hair.group);
const facial = params.has('nohair') ? null : addFacialHairs(horse);
const sunDir = new THREE.Vector3().copy(sun.position).normalize().negate();
let loco = null;
if (params.has('gait')) {
  // ?gp=nod:0.3,nodPeak:0.5 overrides the gait's numeric parameters (tuning)
  for (const kv of (params.get('gp') || '').split(',').filter(Boolean)) {
    const [k, val] = kv.split(':');
    GAITS[params.get('gait')][k] = parseFloat(val);
  }
  loco = new Locomotion(horse);
  loco.setGait(params.get('gait'));
  if (params.has('speed')) loco.targetSpeed = parseFloat(params.get('speed'));
  loco.speed = loco.targetSpeed;
  const T = parseFloat(params.get('t') || '3');
  const vel = new THREE.Vector3();
  for (let t = 0; t < T; t += 1 / 60) {
    loco.update(1 / 60);
    vel.set(Math.cos(loco.yaw), 0, -Math.sin(loco.yaw)).multiplyScalar(loco.speed);
    horse.group.updateMatrixWorld(true);
    if (hair) hair.update(1 / 60, vel, sunDir);
  }
  // keep the camera framing relative to the horse
  const off = horse.group.position.clone();
  camera.position.add(off);
  controls.target.add(off);
  ground.position.x = off.x;
  ground.position.z = off.z;
  sun.position.add(off);
  sun.target.position.copy(off);
  scene.add(sun.target);
  window.__loco = loco;
  // window.__step(dt): advance the animation, keep the camera framing, render,
  // and return the frame (for gait captures compared against footage)
  const last = horse.group.position.clone();
  window.__step = (dt) => {
    loco.update(dt);
    horse.group.updateMatrixWorld(true);
    vel.set(Math.cos(loco.yaw), 0, -Math.sin(loco.yaw)).multiplyScalar(loco.speed);
    if (hair) hair.update(dt, vel, sunDir);
    const d = horse.group.position.clone().sub(last);
    last.copy(horse.group.position);
    camera.position.add(d);
    controls.target.add(d);
    ground.position.x += d.x;
    ground.position.z += d.z;
    sun.position.add(d);
    sun.target.position.add(d);
    controls.update();
    renderer.render(scene, camera);
    return {
      img: renderer.domElement.toDataURL('image/png'),
      phase: loco.phase,
      stance: Object.fromEntries(loco.legs.map((l) => [l.name, l.stance])),
    };
  };
}

function frame() {
  controls.update();
  if (facial) facial.update(camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
if (hair && !params.has('gait')) {
  horse.group.updateMatrixWorld(true);
  for (let i = 0; i < 120; i++) hair.update(1 / 60, new THREE.Vector3(), sunDir);
}
window.__ready = true;
