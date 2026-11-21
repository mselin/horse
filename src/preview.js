// Debug page: bakes the horse and renders it from fixed views (?view=side|front|back|top|q34|head|legs)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bakeInWorker, Horse } from './horse/Horse.js';
import { Locomotion } from './horse/Locomotion.js';
import { Hair } from './horse/Hair.js';
import { MANE_COLORS } from './horse/coat.js';

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
  head: [[1.9, 1.75, 1.3], [1.1, 1.6, 0.0]],
  headside: [[1.15, 1.65, 1.6], [1.12, 1.62, 0.0]],
  headfront: [[2.6, 1.7, 0.0], [1.15, 1.6, 0.0]],
  legs: [[0.6, 0.5, 2.6], [0.0, 0.45, 0]],
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
const hair = params.has('nohair') ? null : new Hair(horse, { color: MANE_COLORS[params.get('coat') || 'chestnut'] });
if (hair) scene.add(hair.group);
const sunDir = new THREE.Vector3().copy(sun.position).normalize().negate();
let loco = null;
if (params.has('gait')) {
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
}

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
if (hair && !params.has('gait')) {
  horse.group.updateMatrixWorld(true);
  for (let i = 0; i < 120; i++) hair.update(1 / 60, new THREE.Vector3(), sunDir);
}
window.__ready = true;
