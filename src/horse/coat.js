// Coat shader: MeshPhysicalMaterial extended with
//   * coat colour genetics presets (bay, chestnut, black, grey, palomino, buckskin)
//   * "points" (black lower legs / ear rims / mane line) from the baked mask
//   * white markings (star, blaze, socks) placed on the rest-pose skin
//   * anisotropic highlights along the baked hair-flow tangents
//   * baked SDF ambient occlusion & curvature for anatomical definition
//   * procedural hair micro-normal and dapples

import * as THREE from 'three';
import { headPt } from './rig.js';

export const COATS = {
  bay: { body: '#6a3317', dark: '#3a190b', points: '#0f0b0a', sheen: '#c08a6a', dapple: 0.25, skin: '#1d1918', hoof: '#2a2522' },
  'dark bay': { body: '#3d1b0c', dark: '#1f0e07', points: '#0c0908', sheen: '#9a6c54', dapple: 0.15, skin: '#1b1817', hoof: '#26211f' },
  chestnut: { body: '#86401f', dark: '#5a2812', points: '#6e3318', sheen: '#f0b48a', dapple: 0.15, skin: '#3a2a26', hoof: '#3a302a' },
  black: { body: '#16110f', dark: '#0d0a09', points: '#0b0908', sheen: '#7b7a86', dapple: 0.05, skin: '#161413', hoof: '#201c1a' },
  'dapple grey': { body: '#a9a6a1', dark: '#5e5b58', points: '#3a3836', sheen: '#f2efe8', dapple: 1.0, skin: '#2a2626', hoof: '#3a3432' },
  palomino: { body: '#c48f45', dark: '#8f5f28', points: '#b07c38', sheen: '#ffe0a8', dapple: 0.3, skin: '#3a2e2a', hoof: '#5a4a3a' },
  buckskin: { body: '#b0844a', dark: '#6e4a22', points: '#100c0a', sheen: '#f0cc96', dapple: 0.2, skin: '#1d1918', hoof: '#2a2522' },
};

export const MANE_COLORS = {
  bay: '#0c0908',
  'dark bay': '#0a0807',
  chestnut: '#6a2e14',
  black: '#0a0807',
  'dapple grey': '#b9b5ae',
  palomino: '#efe3c4',
  buckskin: '#0c0908',
};

const lin = (hex) => new THREE.Color(hex);

export function createCoatMaterial(coatName = 'chestnut') {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0,
    sheen: 1.0,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color('#9a6c54'),
    anisotropy: 0.55,
    anisotropyRotation: Math.PI / 2, // highlight band runs across the hair direction
    clearcoat: 0.0,
    specularIntensity: 0.6,
  });

  const u = {
    uBody: { value: new THREE.Color() },
    uDark: { value: new THREE.Color() },
    uPoints: { value: new THREE.Color() },
    uSkin: { value: new THREE.Color() },
    uHoof: { value: new THREE.Color() },
    uHoofPale: { value: new THREE.Color('#b9a586') },
    uWhite: { value: new THREE.Color('#e9e4dc') },
    uDapple: { value: 0.2 },
    uStar: { value: new THREE.Vector4(...headPt(0.215, -0.072), 0.034) },
    uBlaze: { value: 1.0 },
    uBlazeA: { value: new THREE.Vector3(...headPt(0.24, -0.072)) },
    uBlazeB: { value: new THREE.Vector3(...headPt(0.6, 0.02)) },
    uSocks: { value: new THREE.Vector4(0, 0, 0.27, 0) }, // heights: LF, RF, LH, RH (0 = none)
    uDetail: { value: 1.0 },
  };
  mat.userData.uniforms = u;
  setCoat(mat, coatName);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 mats;
        attribute vec2 aoCurv;
        attribute vec3 restPos;
        varying vec4 vMats;
        varying vec2 vAoCurv;
        varying vec3 vRest;
        varying vec3 vRestN;
        varying vec3 vRestT;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vMats = mats;
        vAoCurv = aoCurv;
        vRest = restPos;
        vRestN = normal;
        #ifdef USE_TANGENT
        vRestT = tangent.xyz;
        #else
        vRestT = vec3(-1.0, 0.0, 0.0);
        #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBody, uDark, uPoints, uSkin, uHoof, uHoofPale, uWhite;
        uniform float uDapple, uBlaze, uDetail;
        uniform vec4 uStar, uSocks;
        uniform vec3 uBlazeA, uBlazeB;
        varying vec4 vMats;
        varying vec2 vAoCurv;
        varying vec3 vRest;
        varying vec3 vRestN;
        varying vec3 vRestT;

        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }
        float vnoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                         mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                         mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
          return s;
        }
        // Worley-ish dapple rings
        float dapples(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          float d1 = 9.0;
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 g = vec3(float(x), float(y), float(z));
            vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 41.7));
            vec3 r = g + o - f;
            d1 = min(d1, dot(r, r));
          }
          return sqrt(d1);
        }
        float segDist(vec3 p, vec3 a, vec3 b) {
          vec3 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }
        float legSock(vec3 p, vec2 col, float h) {
          if (h <= 0.0) return 0.0;
          float inCol = 1.0 - smoothstep(0.09, 0.12, length(p.xz - col));
          float edge = h + 0.025 * (fbm(p * 30.0) - 0.5);
          return inCol * (1.0 - smoothstep(edge - 0.012, edge + 0.012, p.y));
        }
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float mCoat = vMats.x, mHoof = vMats.y, mSkin = vMats.z, mPts = vMats.w;
        vec3 rp = vRest;
        // large-scale tonal variation: darker topline, lighter flank & muzzle ring
        float topShade = smoothstep(1.2, 1.6, rp.y) * smoothstep(0.75, 0.3, rp.x);
        float var1 = fbm(rp * 3.0);
        vec3 coat = mix(uBody, uDark, clamp(0.55 * topShade + 0.35 * (var1 - 0.5) + 0.15, 0.0, 1.0));
        // dapples (rings slightly lighter than the surrounding coat)
        float dp = dapples(rp * vec3(9.0, 9.0, 9.0));
        float dap = smoothstep(0.35, 0.75, dp) * (1.0 - smoothstep(0.75, 1.1, dp));
        float dMask = smoothstep(0.75, 1.1, rp.y) * smoothstep(1.2, 0.2, rp.x);
        coat = mix(coat, uDark, uDapple * dMask * (1.0 - dap) * 0.55);
        coat = mix(coat, uBody * 1.12, uDapple * dMask * dap * 0.35);
        // points (black legs etc.)
        vec3 col = mix(coat, uPoints, clamp(mPts * 1.15, 0.0, 1.0));
        // bare-skin areas (muzzle, lids, heel bulbs)
        col = mix(col, uSkin, clamp(mSkin, 0.0, 1.0));
        // white markings
        float star = 1.0 - smoothstep(uStar.w * 0.75, uStar.w, length(rp - uStar.xyz) + 0.01 * (fbm(rp * 40.0) - 0.5));
        float blaze = uBlaze * (1.0 - smoothstep(0.022, 0.032, segDist(rp, uBlazeA, uBlazeB) + 0.008 * (fbm(rp * 30.0) - 0.5)));
        float socks = legSock(rp, vec2(0.48, -0.135), uSocks.x) + legSock(rp, vec2(0.48, 0.135), uSocks.y)
                    + legSock(rp, vec2(-0.75, -0.13), uSocks.z) + legSock(rp, vec2(-0.75, 0.13), uSocks.w);
        float white = clamp(max(max(star, blaze), socks), 0.0, 1.0);
        col = mix(col, mix(uWhite, vec3(0.62, 0.48, 0.44), mSkin * 0.6), white * (1.0 - mHoof));
        // hoof horn, with growth rings & stripes
        float stripes = fbm(vec3(atan(rp.z, rp.x) * 6.0, rp.y * 60.0, 0.0));
        vec3 hoof = mix(uHoof, uHoofPale, clamp(socks * 1.5, 0.0, 1.0)) * (0.8 + 0.35 * stripes);
        col = mix(col, hoof, clamp(mHoof, 0.0, 1.0));
        // baked occlusion & curvature
        float ao = vAoCurv.x;
        float curv = clamp(vAoCurv.y, -1.0, 1.0);
        col *= mix(1.0, 0.55 + 0.45 * ao, 0.8);
        col *= 1.0 + 0.18 * curv * mCoat;
        diffuseColor.rgb = col;
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, clamp(vMats.y, 0.0, 1.0));
        roughnessFactor = mix(roughnessFactor, 0.42, clamp(vMats.z, 0.0, 1.0));
        roughnessFactor = mix(roughnessFactor, roughnessFactor + 0.12, clamp(vMats.w, 0.0, 1.0));
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // fine hair micro-relief: streaks along the hair direction
          vec3 T = normalize(vRestT - vRestN * dot(vRestT, vRestN));
          vec3 B = cross(vRestN, T);
          vec3 q = vec3(dot(vRest, T) * 60.0, dot(vRest, B) * 900.0, 0.0);
          float fw = clamp(1.0 - length(fwidth(q)) * 0.25, 0.0, 1.0);
          float n1 = vnoise(q) - 0.5;
          float n2 = vnoise(q * vec3(0.5, 0.25, 1.0) + 7.3) - 0.5;
          vec3 bend = (n1 * 0.12 + n2 * 0.08) * fw * uDetail * (vMats.x + vMats.w) * vec3(0.0, 1.0, 0.0);
          // bend the normal across the hair direction (view space via tbn if available)
          #ifdef USE_TANGENT
          vec3 vT = normalize(vTangent);
          vec3 vB = normalize(cross(normal, vT));
          normal = normalize(normal + vB * bend.y);
          #endif
        }
        `
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_SHEEN
        material.sheenColor *= clamp(vMats.x + vMats.w * 0.6, 0.0, 1.0) * (0.6 + 0.4 * vAoCurv.x);
        #endif
        `
      )
      .replace(
        '#include <aomap_fragment>',
        `{
          float ambientOcclusion = vAoCurv.x;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_CLEARCOAT )
          clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_SHEEN )
          sheenSpecularIndirect *= ambientOcclusion;
          #endif
          reflectedLight.indirectSpecular *= ambientOcclusion * ambientOcclusion;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'horse-coat-v1';
  return mat;
}

export function setCoat(mat, name) {
  const c = COATS[name] ?? COATS.bay;
  const u = mat.userData.uniforms;
  u.uBody.value.set(c.body);
  u.uDark.value.set(c.dark);
  u.uPoints.value.set(c.points);
  u.uSkin.value.set(c.skin);
  u.uHoof.value.set(c.hoof);
  u.uDapple.value = c.dapple;
  mat.sheenColor.set(c.sheen).multiplyScalar(0.55);
}
