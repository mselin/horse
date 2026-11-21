// Open-range environment: physical sky + sun, IBL, fog, procedural ground,
// instanced wind-blown grass that follows the horse, distant hills and dust.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const GROUND_FN = /* glsl */ `
float wHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float wNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), f.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), f.x), f.y); }
float wFbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*wNoise(p); p*=2.07; a*=0.5; } return s; }
`;

export class World {
  constructor(renderer, scene, { grass = 70000, shadowSize = 4096 } = {}) {
    this.opts = { grass, shadowSize };
    this.renderer = renderer;
    this.scene = scene;
    this.center = new THREE.Vector3();
    this.time = 0;

    // ---- sky & sun ----
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 9;
    su.rayleigh.value = 2.4;
    su.mieCoefficient.value = 0.006;
    su.mieDirectionalG.value = 0.82;
    // no hard sun disc: its radiance (~6e4) would bloom over the whole frame;
    // the Mie glow around the sun remains
    if (su.showSunDisc) su.showSunDisc.value = 0;
    if (su.cloudCoverage) {
      su.cloudCoverage.value = 0.32;
      su.cloudDensity.value = 0.5;
      su.cloudElevation.value = 0.6;
    }
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight('#ffd9a8', 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -4;
    sc.right = 4;
    sc.top = 4;
    sc.bottom = -4;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#6b5236', 0.25);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    // the sun disc carries enormous radiance: keep it out of the IBL (the
    // directional light provides the sun)
    if (this.envSky.material.uniforms.showSunDisc) this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: '#5a4a35' }));
    envGround.rotation.x = -Math.PI / 2;
    envGround.position.y = -2;
    this.envScene.add(envGround);
    this.envTarget = null;

    this.fogColor = new THREE.Color('#d8b991');
    scene.fog = new THREE.FogExp2(this.fogColor, 0.0021);

    this.buildGround();
    this.buildGrass();
    this.buildHills();
    this.buildDust();
    this.setTimeOfDay(0.045);
  }

  // t: 0 = sunrise, 0.5 = noon, 1 = sunset
  setTimeOfDay(t) {
    this.tod = t;
    const elev = Math.sin(Math.PI * t) * 58 + 2; // degrees
    const az = 70 + t * 100; // low sun ahead of the default heading: raking light on the flanks
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(az);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity', 'cloudElevation'])
      if (this.envSky.material.uniforms[k]) this.envSky.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    // warm low sun, whiter high sun
    const warm = THREE.MathUtils.clamp(1 - (elev - 4) / 40, 0, 1);
    this.sun.color.setRGB(1, 0.93 - 0.2 * warm, 0.84 - 0.36 * warm);
    this.sun.intensity = 1.2 + 2.6 * THREE.MathUtils.clamp(elev / 25, 0, 1);
    this.fogColor.setRGB(0.8 - 0.04 * warm, 0.74 - 0.06 * warm, 0.66 - 0.12 * warm);
    this.scene.fog.color.copy(this.fogColor);
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.35;
  }

  buildGround() {
    const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + GROUND_FN)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 wp = vWPos.xz;
          float n1 = wFbm(wp * 0.08);
          float n2 = wFbm(wp * 0.9);
          float n3 = wNoise(wp * 9.0);
          vec3 dirt = mix(vec3(0.24, 0.17, 0.11), vec3(0.33, 0.25, 0.16), n2);
          vec3 dryGrass = mix(vec3(0.3, 0.24, 0.11), vec3(0.4, 0.32, 0.15), n2);
          vec3 green = vec3(0.17, 0.19, 0.08);
          float grassMask = 0.55 + 0.45 * smoothstep(0.3, 0.62, n1);
          vec3 c = mix(dirt, mix(dryGrass, green, smoothstep(0.55, 0.85, n1) * 0.5), grassMask);
          c *= 0.85 + 0.3 * n3;
          diffuseColor.rgb = c;`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float e = 0.03;
            float h0 = wFbm(vWPos.xz * 6.0);
            float hx = wFbm((vWPos.xz + vec2(e, 0.0)) * 6.0);
            float hz = wFbm((vWPos.xz + vec2(0.0, e)) * 6.0);
            vec3 bump = vec3(h0 - hx, 0.0, h0 - hz) * 1.4;
            normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
          }`
        );
    };
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  buildGrass() {
    const COUNT = this.opts.grass;
    const R = 26; // tile half-size around the camera focus
    const blade = new THREE.PlaneGeometry(0.022, 0.34, 1, 4);
    blade.translate(0, 0.16, 0);
    const offsets = new Float32Array(COUNT * 4);
    const r = mulberry(11);
    for (let i = 0; i < COUNT; i++) {
      offsets[i * 4] = (r() * 2 - 1) * R;
      offsets[i * 4 + 1] = (r() * 2 - 1) * R;
      offsets[i * 4 + 2] = r() * Math.PI * 2;
      offsets[i * 4 + 3] = 0.5 + r() * 0.9;
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.attributes.position = blade.attributes.position;
    geo.attributes.normal = blade.attributes.normal;
    geo.attributes.uv = blade.attributes.uv;
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(offsets, 4));
    geo.instanceCount = COUNT;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    this.grassUniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uR: { value: R }, uHorse: { value: new THREE.Vector3() } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.grassUniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aOff;
          uniform float uTime, uR;
          uniform vec3 uCenter, uHorse;
          varying float vGH;
          varying vec2 vGW;
          ${GROUND_FN}`
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 base = aOff.xy;
          vec2 wpos = uCenter.xz + mod(base - uCenter.xz + uR, 2.0 * uR) - uR;
          float dens = 0.45 + 0.55 * smoothstep(0.3, 0.62, wFbm(wpos * 0.08));
          float h = aOff.w * dens * (0.6 + 0.8 * wNoise(wpos * 0.5));
          float t = position.y / 0.34;
          float c = cos(aOff.z), s = sin(aOff.z);
          vec3 p = vec3(position.x * (1.0 - t * 0.85), position.y * h, 0.0);
          p = vec3(c * p.x, p.y, s * p.x);
          // per-blade lean and curvature
          float leanA = wHash(wpos * 3.1) * 6.2831;
          float lean = (0.15 + 0.55 * wHash(wpos * 7.7)) * t * t * h * 0.34;
          p.xz += vec2(cos(leanA), sin(leanA)) * lean;
          p.y -= lean * lean * 1.2;
          float wind = sin(uTime * 1.7 + wpos.x * 0.35 + wpos.y * 0.2) * 0.5 + sin(uTime * 3.1 + wpos.x * 1.3) * 0.2;
          vec2 bend = vec2(0.6, 0.25) * wind * 0.18 * t * t * h;
          // horse pushes grass aside
          vec2 dh = wpos - uHorse.xz;
          float pushd = length(dh);
          bend += normalize(dh + 1e-4) * smoothstep(1.4, 0.3, pushd) * 0.25 * t * h;
          float fade = 1.0 - smoothstep(uR * 0.7, uR, length(wpos - uCenter.xz));
          p.y *= fade;
          vec3 transformed = vec3(wpos.x + p.x + bend.x, p.y, wpos.y + p.z + bend.y);
          vGH = t;
          vGW = wpos;`
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + vec3(cos(aOff.z), 0.0, sin(aOff.z)) * 0.3);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vGH;\nvarying vec2 vGW;\n${GROUND_FN}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float n = wNoise(vGW * 0.7);
          vec3 base = mix(vec3(0.26, 0.22, 0.1), vec3(0.32, 0.28, 0.12), n);
          vec3 tip = mix(vec3(0.7, 0.56, 0.3), vec3(0.52, 0.48, 0.22), n);
          diffuseColor.rgb = mix(base, tip, smoothstep(0.0, 1.0, vGH));`
        );
    };
    this.grass = new THREE.Mesh(geo, mat);
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.grass.castShadow = false;
    this.scene.add(this.grass);
  }

  buildHills() {
    const geo = new THREE.RingGeometry(180, 1400, 160, 24);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const r = mulberry(5);
    const ph = [r() * 10, r() * 10, r() * 10];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const rise = THREE.MathUtils.smoothstep(d, 180, 600);
      const h =
        rise * (40 + 70 * Math.max(0, Math.sin(a * 3 + ph[0])) + 35 * Math.sin(a * 7 + ph[1]) + 18 * Math.sin(a * 17 + ph[2])) *
        (0.6 + 0.4 * Math.sin(d * 0.006 + a * 2));
      pos.setY(i, Math.max(0, h) - 1);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvHP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHP;\n' + GROUND_FN)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float n = wFbm(vHP.xz * 0.01);
          float scrub = smoothstep(0.55, 0.75, wFbm(vHP.xz * 0.05 + 3.0));
          vec3 c = mix(vec3(0.42, 0.34, 0.2), vec3(0.5, 0.42, 0.26), n);
          c = mix(c, vec3(0.2, 0.2, 0.12), scrub * 0.6);
          c *= 0.85 + 0.25 * smoothstep(0.0, 120.0, vHP.y);
          diffuseColor.rgb = c;`
        );
    };
    this.hills = new THREE.Mesh(geo, mat);
    this.scene.add(this.hills);
  }

  buildDust() {
    const MAX = 1500;
    this.dustMax = MAX;
    this.dustPos = new Float32Array(MAX * 3);
    this.dustVel = new Float32Array(MAX * 3);
    this.dustLife = new Float32Array(MAX);
    this.dustSize = new Float32Array(MAX);
    this.dustHead = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.dustLife, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.dustSize, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.dustUniforms = { uSunColor: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uScale: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aLife; attribute float aSize; varying float vLife; uniform float uScale;
        void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * (1.0 + (1.0 - aLife) * 2.5) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying float vLife; uniform vec3 uSunColor;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5 || vLife <= 0.0) discard;
          float a = smoothstep(0.5, 0.0, d) * vLife * 0.22;
          gl_FragColor = vec4(mix(vec3(0.55,0.45,0.33), uSunColor, 0.35), a); }`,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  emitDust(pos, speed) {
    if (speed < 2.5) return;
    const n = Math.min(14, Math.floor(speed * 0.9));
    for (let k = 0; k < n; k++) {
      const i = this.dustHead;
      this.dustHead = (this.dustHead + 1) % this.dustMax;
      this.dustPos[i * 3] = pos.x + (Math.random() - 0.5) * 0.15;
      this.dustPos[i * 3 + 1] = 0.03 + Math.random() * 0.05;
      this.dustPos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.15;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.8;
      this.dustVel[i * 3 + 1] = 0.3 + Math.random() * 0.6;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      this.dustLife[i] = 1;
      this.dustSize[i] = 40 + Math.random() * 60;
    }
  }

  update(dt, focus, horsePos, camera) {
    this.time += dt;
    this.grassUniforms.uTime.value = this.time;
    if (this.sky.material.uniforms.time) this.sky.material.uniforms.time.value = this.time;
    this.grassUniforms.uCenter.value.copy(focus);
    this.grassUniforms.uHorse.value.copy(horsePos);
    // keep big meshes centred on the action
    this.ground.position.set(Math.round(focus.x / 50) * 50, 0, Math.round(focus.z / 50) * 50);
    this.hills.position.set(focus.x, 0, focus.z);
    this.sky.position.copy(camera.position);
    // shadow frustum follows the horse
    this.sun.position.copy(horsePos).addScaledVector(this.sunDir, 30);
    this.sun.target.position.copy(horsePos);
    // dust
    for (let i = 0; i < this.dustMax; i++) {
      if (this.dustLife[i] <= 0) continue;
      this.dustLife[i] -= dt * 0.55;
      this.dustVel[i * 3 + 1] -= dt * 0.15;
      this.dustPos[i * 3] += this.dustVel[i * 3] * dt;
      this.dustPos[i * 3 + 1] = Math.max(0.02, this.dustPos[i * 3 + 1] + this.dustVel[i * 3 + 1] * dt);
      this.dustPos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
      this.dustVel[i * 3] *= 0.98;
      this.dustVel[i * 3 + 2] *= 0.98;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.aLife.needsUpdate = true;
    this.dust.geometry.attributes.aSize.needsUpdate = true;
    this.dustUniforms.uSunColor.value.copy(this.sun.color);
    this.dustUniforms.uScale.value = this.renderer.domElement.height / 900;
  }
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
