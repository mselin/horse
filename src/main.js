import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { loadHorseMesh, Horse } from './horse/Horse.js';
import { Locomotion } from './horse/Locomotion.js';
import { Hair } from './horse/Hair.js';
import { COATS, MANE_COLORS, setCoat } from './horse/coat.js';
import { World } from './world/World.js';
import { addFacialHairs } from './horse/FacialHairs.js';
import { Hoofbeats } from './audio.js';

const params = new URLSearchParams(location.search);
// mesh cell size (m), hair density, grass blades, shadow map, max pixel ratio
const QUALITY = {
  low: { cell: 0.012, hair: 0.5, grass: 30000, shadow: 2048, dpr: 1 },
  medium: { cell: 0.009, hair: 0.8, grass: 60000, shadow: 4096, dpr: 1.5 },
  high: { cell: 0.0075, hair: 1, grass: 90000, shadow: 4096, dpr: 2 },
};
const quality = QUALITY[params.get('quality')] ? params.get('quality') : 'medium';
const Q = QUALITY[quality];
const cell = Q.cell;

// ---------------------------------------------------------------------------
// Renderer & post-processing
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('sim') });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 5000);
camera.position.set(4.5, 1.6, 5.5);

const world = new World(renderer, scene, { grass: Q.grass, shadowSize: Q.shadow });

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.06, 0.4, 4.0);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.025 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // warm, slightly lifted shadows (western film look)
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, c.rgb * vec3(1.05, 1.0, 0.92), 0.6);
      c.rgb += vec3(0.010, 0.006, 0.0) * (1.0 - smoothstep(0.0, 0.3, l));
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      c.rgb += (h(vUv * 1000.0 + uTime) - 0.5) * uGrain * (0.4 + l);
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
const loadFill = document.getElementById('loadFill');
const loadStage = document.getElementById('loadStage');
const baked = await loadHorseMesh(cell, (p, label) => {
  loadFill.style.width = `${Math.round(p * 100)}%`;
  loadStage.textContent = `${label}…`;
});
loadStage.textContent = 'Grooming mane and tail…';
await new Promise((r) => setTimeout(r, 30));

const state = {
  coat: params.get('coat') || 'chestnut',
  mane: MANE_COLORS[params.get('coat') || 'chestnut'],
  star: true,
  blaze: true,
  sockLF: false,
  sockRF: false,
  sockLH: true,
  sockRH: false,
  timeOfDay: 0.045,
  exposure: 0.62,
  camera: params.get('cam') || 'orbit',
  demo: !params.has('nodemo'),
  sound: false,
  skeleton: false,
  hair: true,
  quality,
  dirt: +(params.get('dirt') ?? 0.12),
  sweat: +(params.get('sweat') ?? 0),
  autoCondition: !params.has('dirt') && !params.has('sweat'),
  hairDetail: 1,
  veins: 0.5,
};

const horse = new Horse(baked, { coat: state.coat });
scene.add(horse.group);
const loco = new Locomotion(horse);
const hair = new Hair(horse, { color: state.mane, density: Q.hair });
const facial = addFacialHairs(horse);
scene.add(hair.group);
const skeletonHelper = new THREE.SkeletonHelper(horse.mesh);
skeletonHelper.visible = false;
scene.add(skeletonHelper);
const audio = new Hoofbeats();

loco.onFootfall((leg, pos, speed) => {
  world.emitDust(pos, speed);
  audio.play(speed, leg.fore);
});

function applyMarkings() {
  const u = horse.material.userData.uniforms;
  u.uStar.value.w = state.star ? 0.034 : 0.0;
  u.uBlaze.value = state.blaze ? 1 : 0;
  u.uSocks.value.set(state.sockLF ? 0.27 : 0, state.sockRF ? 0.27 : 0, state.sockLH ? 0.3 : 0, state.sockRH ? 0.3 : 0);
}
applyMarkings();

// ---------------------------------------------------------------------------
// Camera rig
// ---------------------------------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 1.2, 0);
const focus = new THREE.Vector3(0, 1.2, 0);
const lastFocus = focus.clone();
const cine = { shot: +(params.get('shot') ?? 0), t: 0, off: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, cut: true };
const SHOTS = [
  { dur: 7, off: [0.6, 0.9, 4.2], look: [0.2, 1.1, 0], fov: 32 }, // low side tracking
  { dur: 6, off: [5.5, 1.3, 2.2], look: [0.3, 1.2, 0], fov: 30 }, // leading 3/4 front
  { dur: 6, off: [-6.0, 2.0, -1.8], look: [0.0, 1.2, 0], fov: 34 }, // chase
  { dur: 5, off: [1.9, 1.75, 1.2], look: [1.0, 1.65, 0], fov: 28 }, // head close-up
  { dur: 7, off: [2.0, 0.45, -3.4], look: [0, 0.6, 0], fov: 36 }, // legs, low
];
// Close-ups (not in the automatic cycle; ?shot=5..9)
const CLOSE = [
  { off: [1.5, 1.95, 0.5], look: [1.2, 1.87, 0.07], fov: 24 }, // eye
  { off: [1.15, 1.35, 1.05], look: [0.42, 1.18, 0.12], fov: 26 }, // shoulder & barrel
  { off: [1.05, 0.45, 0.85], look: [0.45, 0.32, 0.1], fov: 26 }, // fore legs & hooves
  { off: [-1.6, 1.15, 0.55], look: [-0.85, 1.0, 0.0], fov: 26 }, // hindquarters from behind
  { off: [1.75, 1.55, 0.9], look: [1.28, 1.55, 0.05], fov: 24 }, // muzzle
];
function updateCamera(dt) {
  const body = horse.bones.body.getWorldPosition(new THREE.Vector3());
  const target = body.clone();
  target.y = 1.15;
  // follow exactly in the ground plane, smooth only the vertical bob
  focus.x = target.x;
  focus.z = target.z;
  focus.y += (target.y - focus.y) * Math.min(1, dt * 4);
  if (state.camera === 'orbit') {
    const delta = focus.clone().sub(lastFocus);
    camera.position.add(delta);
    controls.target.copy(focus);
    controls.enabled = true;
    controls.update();
  } else {
    controls.enabled = false;
    // camera offsets live in the horse's frame; smooth the offset and the
    // heading separately so the horse never runs out of shot
    let dy = loco.yaw - cine.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    let shot;
    if (state.camera === 'side') shot = SHOTS[0];
    else {
      cine.t += dt;
      if (!params.has('shot') && cine.t > SHOTS[cine.shot].dur) {
        cine.t = 0;
        cine.shot = (cine.shot + 1) % SHOTS.length;
        cine.cut = true;
      }
      shot = cine.shot >= SHOTS.length ? { ...CLOSE[cine.shot - SHOTS.length], dur: 6 } : SHOTS[cine.shot];
    }
    const drift = Math.sin(cine.t * 0.3) * 0.4;
    const off = new THREE.Vector3(shot.off[0] + drift, shot.off[1], shot.off[2]);
    const lk = new THREE.Vector3(...shot.look);
    if (cine.cut) {
      cine.off.copy(off);
      cine.look.copy(lk);
      cine.yaw = loco.yaw;
      cine.cut = false;
    }
    cine.yaw += dy * Math.min(1, dt * 1.5);
    cine.off.lerp(off, Math.min(1, dt * 1.5));
    cine.look.lerp(lk, Math.min(1, dt * 3));
    const up = new THREE.Vector3(0, 1, 0);
    const base = new THREE.Vector3(focus.x, 0, focus.z);
    camera.position.copy(cine.off).applyAxisAngle(up, cine.yaw).add(base);
    const lookW = cine.look.clone().applyAxisAngle(up, cine.yaw).add(base);
    camera.position.y = Math.max(0.25, camera.position.y);
    camera.lookAt(lookW);
    camera.fov += (shot.fov - camera.fov) * Math.min(1, dt * 2);
    camera.updateProjectionMatrix();
    controls.target.copy(lookW);
  }
  lastFocus.copy(focus);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const GAIT_SPEEDS = [0, 1.6, 3.8, 6.8, 13.5];
const GAIT_LABEL = ['Standing', 'Walk', 'Trot', 'Canter', 'Gallop'];
let gaitIndex = 0;
const keys = new Set();
function setGaitIndex(i) {
  gaitIndex = Math.max(0, Math.min(4, i));
  loco.forcedGait = null;
  loco.targetSpeed = GAIT_SPEEDS[gaitIndex];
}
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('.lil-gui')) return;
  keys.add(e.code);
  const stopDemo = () => {
    if (state.demo) {
      state.demo = false;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  };
  if (e.code === 'KeyW' || e.code === 'ArrowUp') (stopDemo(), setGaitIndex(gaitIndex + 1));
  if (e.code === 'KeyS' || e.code === 'ArrowDown') (stopDemo(), setGaitIndex(gaitIndex - 1));
  if (e.code === 'Space') (stopDemo(), setGaitIndex(0));
  if (/Digit[1-5]/.test(e.code)) (stopDemo(), setGaitIndex(+e.code.slice(5) - 1));
  if (e.code === 'KeyC') {
    const modes = ['orbit', 'cinematic', 'side'];
    state.camera = modes[(modes.indexOf(state.camera) + 1) % modes.length];
    cine.cut = true;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  if (e.code === 'KeyH') {
    document.getElementById('hud').classList.toggle('hidden');
    gui.show(gui._hidden);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));

// Demo: cycle through the gaits on a gentle curving route
const demo = { t: 0, seq: [[1, 4], [2, 6], [3, 7], [4, 8], [3, 4], [2, 4], [1, 4], [0, 4]], i: 0 };
function updateDemo(dt) {
  demo.t += dt;
  if (demo.t > demo.seq[demo.i][1]) {
    demo.t = 0;
    demo.i = (demo.i + 1) % demo.seq.length;
  }
  setGaitIndex(demo.seq[demo.i][0]);
  loco.steer = demo.seq[demo.i][0] === 0 ? 0 : Math.sin(performance.now() * 0.00012) * 0.35;
}

// ---------------------------------------------------------------------------
// GUI
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'Horse' });
const fMove = gui.addFolder('Movement');
fMove.add(state, 'demo').name('Demo tour');
fMove
  .add({ gait: 'Standing' }, 'gait', GAIT_LABEL)
  .name('Gait')
  .onChange((v) => {
    state.demo = false;
    setGaitIndex(GAIT_LABEL.indexOf(v));
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  });
fMove.add(state, 'camera', ['orbit', 'cinematic', 'side']).name('Camera').onChange(() => (cine.cut = true));
fMove.add(state, 'sound').name('Hoofbeats').onChange((v) => audio.enable(v));
const fCoat = gui.addFolder('Coat & markings');
fCoat
  .add(state, 'coat', Object.keys(COATS))
  .name('Coat colour')
  .onChange((v) => {
    setCoat(horse.material, v);
    state.mane = MANE_COLORS[v];
    hair.setColor(state.mane);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  });
fCoat.addColor(state, 'mane').name('Mane & tail').onChange((v) => hair.setColor(v));
for (const [k, n] of [['star', 'Star'], ['blaze', 'Blaze'], ['sockLF', 'Sock near fore'], ['sockRF', 'Sock off fore'], ['sockLH', 'Sock near hind'], ['sockRH', 'Sock off hind']])
  fCoat.add(state, k).name(n).onChange(applyMarkings);
const fCond = gui.addFolder('Condition');
fCond.add(state, 'autoCondition').name('Auto (sweat & dust)');
fCond.add(state, 'dirt', 0, 1, 0.01).name('Dust & dirt').listen();
fCond.add(state, 'sweat', 0, 1, 0.01).name('Sweat').listen();
fCond.add(state, 'veins', 0, 1, 0.01).name('Veins');
fCond.add(state, 'hairDetail', 0, 1, 0.01).name('Coat hair detail');
const fLook = gui.addFolder('Light & render');
fLook.add(state, 'timeOfDay', 0.04, 0.96, 0.01).name('Time of day').onFinishChange((v) => world.setTimeOfDay(v));
fLook.add(state, 'exposure', 0.4, 2, 0.01).name('Exposure').onChange((v) => (renderer.toneMappingExposure = v));
fLook.add(state, 'hair').name('Mane & tail').onChange((v) => (hair.group.visible = v));
fLook.add(state, 'skeleton').name('Show skeleton').onChange((v) => (skeletonHelper.visible = v));
fLook
  .add(state, 'quality', Object.keys(QUALITY))
  .name('Mesh detail (reload)')
  .onChange((v) => {
    params.set('quality', v);
    location.search = params.toString();
  });
if (innerWidth < 700) gui.close();

// ---------------------------------------------------------------------------
// Condition: dust builds with distance travelled; sweat builds with sustained
// canter/gallop and dries at rest; veins stand out with exertion.
// ---------------------------------------------------------------------------
function updateCondition(dt) {
  const v = loco.speed;
  if (state.autoCondition) {
    state.dirt = Math.min(0.85, state.dirt + v * dt * 0.0007);
    if (v > 5) state.sweat = Math.min(1, state.sweat + dt * ((v - 5) / 9) / 35);
    else state.sweat = Math.max(0, state.sweat - dt / (v < 0.5 ? 70 : 110));
  }
  const u = horse.material.userData.uniforms;
  u.uDirt.value = state.dirt;
  u.uSweat.value = state.sweat;
  u.uVeins.value = Math.min(1, state.veins + 0.6 * state.sweat);
  u.uDetail.value = state.hairDetail;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
const hudGait = document.getElementById('hudGait');
const hudSpeed = document.getElementById('hudSpeed');
const clock = new THREE.Timer();
const vel = new THREE.Vector3();

// settle hair before the first frame
horse.group.updateMatrixWorld(true);
for (let i = 0; i < 90; i++) hair.update(1 / 60, vel, world.sunDir.clone().negate());

// Deterministic pre-roll (used for automated screenshots): ?sim=<seconds>&gait=<0..4>
if (params.has('sim')) {
  state.demo = false;
  setGaitIndex(+(params.get('gait') ?? 4));
  loco.speed = loco.targetSpeed;
  const T = +params.get('sim');
  for (let t = 0; t < T; t += 1 / 60) {
    loco.update(1 / 60);
    horse.group.updateMatrixWorld(true);
    vel.set(Math.cos(loco.yaw), 0, -Math.sin(loco.yaw)).multiplyScalar(loco.speed);
    hair.update(1 / 60, vel, world.sunDir.clone().negate());
    updateCondition(1 / 60);
    updateCamera(1 / 60);
    world.update(1 / 60, focus, horse.group.position, camera);
  }
  if (params.has('freeze')) loco.update = () => {};
}
document.getElementById('loader').classList.add('done');
hud.classList.remove('hidden');
window.__ready = true;
window.__app = { horse, loco, hair, world, camera, state, renderer, scene, composer };

function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (state.demo) updateDemo(dt);
  let steer = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer += 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer -= 1;
  if (!state.demo) loco.steer += (steer - loco.steer) * Math.min(1, dt * 5);

  loco.update(dt);
  horse.group.updateMatrixWorld(true);
  vel.set(Math.cos(loco.yaw), 0, -Math.sin(loco.yaw)).multiplyScalar(loco.speed);
  if (state.hair) hair.update(dt, vel, world.sunDir.clone().negate());
  updateCondition(dt);
  facial.update(camera);
  updateCamera(dt);
  world.update(dt, focus, horse.group.position, camera);
  grade.uniforms.uTime.value = clock.getElapsed();

  hudGait.textContent = loco.standing ? 'Standing' : loco.gaitName;
  hudSpeed.textContent = `${(loco.speed * 3.6).toFixed(0)} km/h`;

  composer.render();
  if (params.has('still')) {
    window.__stillDone = true;
    return;
  }
  requestAnimationFrame(frame);
}
frame();
