// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
// Coat shader: MeshPhysicalMaterial extended with
//   * coat colour presets (bay, chestnut, black, grey, palomino, buckskin)
//   * "points" (black lower legs / ear rims / mane line) from the baked mask
//   * white markings (star, blaze, socks) placed on the rest-pose skin
//   * hair micro-detail: triplanar-scattered, tapered hair strands that overlap
//     like shingles and follow the baked hair-flow field, plus coarser hair
//     clumps; both fade out with distance so they never shimmer
//   * superficial veins (baked closest-point field + a fine noise network)
//     as a screen-space bump, more prominent with exertion
//   * dust/dirt build-up and splatter, sweat (dark, glossy, clumped) and lather
//   * anisotropic highlights across the hair, sheen, baked SDF AO & curvature

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

const VERT_PARS = /* glsl */ `
uniform vec3 uJiggle;
attribute vec4 mats;
attribute vec2 aoCurv;
attribute vec3 restPos;
attribute vec4 vein;
varying vec4 vMats;
varying vec2 vAoCurv;
varying vec3 vRest;
varying vec3 vRestN;
varying vec3 vRestT;
varying vec4 vVein;
`;

const VERT_MAIN = /* glsl */ `
vMats = mats;
vAoCurv = aoCurv;
vRest = restPos;
vRestN = normal;
vVein = vein;
#ifdef USE_TANGENT
vRestT = tangent.xyz;
#else
vRestT = vec3(-1.0, 0.0, 0.0);
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uBody, uDark, uPoints, uSkin, uHoof, uHoofPale, uWhite, uDirtColor;
uniform float uDapple, uBlaze, uDetail, uDirt, uSweat, uVeins;
uniform vec4 uStar, uSocks;
uniform vec3 uBlazeA, uBlazeB;
varying vec4 vMats;
varying vec2 vAoCurv;
varying vec3 vRest;
varying vec3 vRestN;
varying vec3 vRestT;
varying vec4 vVein;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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

// ---- hair strands ---------------------------------------------------------
// Scatter one tapered strand per cell (5x5 neighbourhood). The strand whose
// tip is nearest wins (tips lie over the roots of the next row of hair, like
// shingles). Returns (coverage, signed across coordinate, random, along 0..1).
vec4 strandField(vec2 p, vec2 dir, float L, float W) {
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 c0 = floor(p);
  vec4 res = vec4(0.0, 0.0, 0.5, 0.0);
  float best = -1.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 c = c0 + vec2(float(i), float(j));
      vec2 d = p - c - hash22(c);
      float a = dot(d, dir) / L + 0.5;
      if (a < 0.0 || a > 1.0) continue;
      float w = W * (1.0 - 0.7 * a * a);
      float b = dot(d, nrm);
      float cov = 1.0 - smoothstep(0.5 * w, w, abs(b));
      float k = cov * (0.3 + a);
      if (k > best) { best = k; res = vec4(cov, b / w, hash12(c + 17.31), a); }
    }
  }
  return res;
}
// Triplanar in rest space (mm). The hair direction is projected into each
// plane, so orientation is exact everywhere with no parameterisation or seams.
// The across value is signed relative to B = N x T so the strand's cylinder
// shading is consistent.
vec4 strandsTri(vec3 P, vec3 N, vec3 T, float L, float W) {
  vec3 B = cross(N, T);
  vec3 w = pow(abs(N), vec3(8.0));
  w /= (w.x + w.y + w.z);
  vec4 acc = vec4(0.0);
  if (w.x > 0.03) {
    vec2 d = normalize(T.zy + vec2(1e-5));
    vec4 r = strandField(P.zy, d, L, W);
    r.y *= sign(dot(vec3(0.0, d.x, -d.y), B) + 1e-6);
    acc += w.x * r;
  }
  if (w.y > 0.03) {
    vec2 d = normalize(T.xz + vec2(1e-5));
    vec4 r = strandField(P.xz, d, L, W);
    r.y *= sign(dot(vec3(-d.y, 0.0, d.x), B) + 1e-6);
    acc += w.y * r;
  }
  if (w.z > 0.03) {
    vec2 d = normalize(T.xy + vec2(1e-5));
    vec4 r = strandField(P.xy, d, L, W);
    r.y *= sign(dot(vec3(-d.y, d.x, 0.0), B) + 1e-6);
    acc += w.z * r;
  }
  return acc;
}

// Mikkelsen-style bump from a scalar height (metres) via screen derivatives.
vec3 bumpNormal(vec3 n, float h) {
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}
`;

const COLOR_MAIN = /* glsl */ `
float mCoat = vMats.x, mHoof = vMats.y, mSkin = vMats.z, mPts = vMats.w;
vec3 rp = vRest;
vec3 rN = normalize(vRestN);
vec3 rT = normalize(vRestT - rN * dot(vRestT, rN) + 1e-6);
float hairy = clamp(mCoat + mPts, 0.0, 1.0) * (1.0 - clamp(mHoof * 1.5, 0.0, 1.0));

// ---- base coat colour ----
float topShade = smoothstep(1.2, 1.6, rp.y) * smoothstep(0.75, 0.3, rp.x);
float var1 = fbm(rp * 3.0);
vec3 coat = mix(uBody, uDark, clamp(0.55 * topShade + 0.35 * (var1 - 0.5) + 0.15, 0.0, 1.0));
// slightly paler belly, flanks and inner legs (counter-shading)
coat *= 1.0 + 0.1 * smoothstep(1.05, 0.82, rp.y) * smoothstep(0.2, -0.5, rN.y);
if (uDapple > 0.01) {
  float dp = dapples(rp * 9.0);
  float dap = smoothstep(0.35, 0.75, dp) * (1.0 - smoothstep(0.75, 1.1, dp));
  float dMask = smoothstep(0.75, 1.1, rp.y) * smoothstep(1.2, 0.2, rp.x);
  coat = mix(coat, uDark, uDapple * dMask * (1.0 - dap) * 0.55);
  coat = mix(coat, uBody * 1.12, uDapple * dMask * dap * 0.35);
}
vec3 col = mix(coat, uPoints, clamp(mPts * 1.15, 0.0, 1.0));
col = mix(col, uSkin, clamp(mSkin, 0.0, 1.0));

// ---- white markings ----
float star = 1.0 - smoothstep(uStar.w * 0.75, uStar.w, length(rp - uStar.xyz) + 0.01 * (fbm(rp * 40.0) - 0.5));
float blaze = uBlaze * (1.0 - smoothstep(0.022, 0.032, segDist(rp, uBlazeA, uBlazeB) + 0.008 * (fbm(rp * 30.0) - 0.5)));
float socks = legSock(rp, vec2(0.48, -0.12), uSocks.x) + legSock(rp, vec2(0.48, 0.12), uSocks.y)
            + legSock(rp, vec2(-0.74, -0.115), uSocks.z) + legSock(rp, vec2(-0.74, 0.115), uSocks.w);
float white = clamp(max(max(star, blaze), socks), 0.0, 1.0);
col = mix(col, mix(uWhite, vec3(0.62, 0.48, 0.44), mSkin * 0.6), white * (1.0 - mHoof));

// ---- hair micro-detail ----
vec3 Pmm = rp * 1000.0;
float pxMM = length(fwidth(Pmm));               // millimetres per pixel
float fineFade = (1.0 - smoothstep(0.12, 0.38, pxMM / 1.5)) * hairy * uDetail;
float clumpFade = (1.0 - smoothstep(0.5, 1.6, pxMM / 6.0)) * hairy * uDetail;
float hairAlb = 1.0, hairOcc = 1.0, hairTilt = 0.0, hairGloss = 0.0;
if (clumpFade > 0.001) {
  vec4 c = strandsTri(Pmm / 6.0, rN, rT, 3.0, 0.38);
  float wet = 1.0 + 1.5 * uSweat;
  hairAlb *= mix(1.0, 0.94 + 0.12 * c.z, clumpFade);
  hairOcc *= mix(1.0, mix(0.9, 1.0, c.x), clumpFade * min(1.0, wet));
  hairTilt += c.y * c.x * 0.22 * clumpFade * wet;
}
if (fineFade > 0.001) {
  vec4 f = strandsTri(Pmm / 1.5, rN, rT, 3.2, 0.1);
  // gaps between strands expose deeper, shadowed hair; each strand varies a
  // little in colour; tips are slightly paler
  hairAlb *= mix(1.0, (0.94 + 0.12 * f.z) * (1.0 + 0.05 * f.w * f.x), fineFade);
  hairOcc *= mix(1.0, mix(0.86, 1.03, f.x), fineFade);
  hairTilt += f.y * f.x * 0.45 * fineFade;
  hairGloss = f.x * fineFade;
}
col *= hairAlb * hairOcc;

// ---- hoof horn: growth rings & pigment stripes ----
float stripes = fbm(vec3(atan(rp.z, rp.x) * 6.0, rp.y * 60.0, 0.0));
vec3 hoof = mix(uHoof, uHoofPale, clamp(socks * 1.5, 0.0, 1.0)) * (0.8 + 0.35 * stripes);
col = mix(col, hoof, clamp(mHoof, 0.0, 1.0));

// ---- dust & dirt ----
float lowLeg = smoothstep(0.62, 0.06, rp.y);
float under = smoothstep(1.08, 0.86, rp.y) * smoothstep(0.1, -0.6, rN.y);
float dn = fbm(rp * 16.0);
vec3 sc = floor(rp * 70.0);
float splat = step(0.82, hash13(sc)) * (1.0 - smoothstep(0.15, 0.45, length(fract(rp * 70.0) - 0.5 - (vec3(hash13(sc + 3.1), hash13(sc + 5.7), hash13(sc + 9.2)) - 0.5) * 0.4)));
float dirt = uDirt * clamp(lowLeg * (0.6 + 1.0 * dn) + under * 0.7 * dn + splat * (lowLeg + under * 0.6) * 0.9, 0.0, 1.0);
dirt = max(dirt, uDirt * mHoof * smoothstep(0.08, 0.0, rp.y) * 0.8);
col = mix(col, uDirtColor * (0.85 + 0.3 * dn), dirt * 0.85);

// ---- sweat & lather ----
float neckZ = smoothstep(0.42, 0.6, rp.x) * smoothstep(1.2, 1.35, rp.y) * smoothstep(1.98, 1.85, rp.y) * smoothstep(1.12, 1.0, rp.x);
float chest = smoothstep(0.3, 0.45, rp.x) * smoothstep(0.8, 0.85, rp.x) * smoothstep(0.85, 1.0, rp.y) * smoothstep(1.45, 1.3, rp.y);
float girth = smoothstep(0.05, 0.15, rp.x) * smoothstep(0.45, 0.35, rp.x) * smoothstep(1.2, 1.05, rp.y);
float innerThigh = smoothstep(-0.55, -0.65, rp.x) * smoothstep(-1.0, -0.88, rp.x) * smoothstep(0.13, 0.07, abs(rp.z)) * smoothstep(0.7, 0.85, rp.y) * smoothstep(1.3, 1.15, rp.y);
float flank = smoothstep(-0.55, -0.35, rp.x) * smoothstep(0.1, -0.15, rp.x) * smoothstep(1.35, 1.15, rp.y);
float sweatRegion = clamp(max(max(neckZ, chest * 0.8), max(max(girth, innerThigh), flank * 0.6)), 0.0, 1.0);
float sweat = uSweat * clamp(sweatRegion * (0.45 + 0.8 * fbm(rp * 7.0 + 4.0)), 0.0, 1.0) * hairy;
col *= mix(1.0, 0.66, sweat);
float foamRegion = max(innerThigh, max(girth * 0.7, neckZ * smoothstep(1.6, 1.85, rp.y) * smoothstep(0.03, 0.0, abs(rp.z) - 0.05)));
float bubbles = smoothstep(0.35, 0.8, fbm(rp * 260.0)) * 0.6 + smoothstep(0.45, 0.7, fbm(rp * 40.0)) * 0.6;
float lather = smoothstep(0.55, 0.9, uSweat) * foamRegion * bubbles;
col = mix(col, vec3(0.9, 0.88, 0.83), clamp(lather, 0.0, 1.0));

// ---- baked occlusion & curvature ----
float ao = vAoCurv.x;
float curv = clamp(vAoCurv.y, -1.0, 1.0);
col *= mix(1.0, 0.55 + 0.45 * ao, 0.8);
col *= 1.0 + 0.3 * curv * mCoat;
diffuseColor.rgb = col;
`;

const ROUGH_MAIN = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.32, clamp(vMats.y, 0.0, 1.0));
roughnessFactor = mix(roughnessFactor, 0.42, clamp(vMats.z, 0.0, 1.0));
roughnessFactor = mix(roughnessFactor, roughnessFactor + 0.12, clamp(vMats.w, 0.0, 1.0));
roughnessFactor -= 0.08 * hairGloss;                // individual hairs are glossy
roughnessFactor = mix(roughnessFactor, 0.2, sweat);  // wet coat
roughnessFactor = mix(roughnessFactor, 0.9, clamp(dirt + lather, 0.0, 1.0));
roughnessFactor = clamp(roughnessFactor, 0.08, 1.0);
`;

const NORMAL_MAIN = /* glsl */ `
#ifdef USE_TANGENT
{
  vec3 vT = normalize(vTangent);
  vec3 vB = normalize(cross(normal, vT));
  // each strand is a cylinder: its normal swings across the hair direction
  normal = normalize(normal + vB * hairTilt * (1.0 - clamp(dirt, 0.0, 1.0)));
}
#endif
{
  // superficial veins: baked nearest-vein point + a fine noise network
  float h = 0.0;
  float r = vVein.w * (0.9 + 0.6 * uVeins);
  if (r > 0.0) {
    // soft bell profile: a vein is a rounded ridge under the skin
    float d = length(vRest - vVein.xyz) + 0.0006 * (vnoise(vRest * 300.0) - 0.5);
    float x = d / r;
    h = r * 0.45 * exp(-2.2 * x * x);
  }
  vec3 wp = vRest * 55.0 + vec3(fbm(vRest * 9.0), fbm(vRest * 9.0 + 7.0), 0.0) * 1.5;
  float rid = 1.0 - abs(vnoise(wp) * 2.0 - 1.0);
  float netMask = max(smoothstep(1.05, 0.85, vRest.y) * smoothstep(0.45, 0.1, abs(vRest.x + 0.05)),   // belly
                      smoothstep(0.75, 0.55, vRest.y) * smoothstep(0.13, 0.09, abs(abs(vRest.z) - 0.02)) * 0.8); // inner legs
  netMask = max(netMask, smoothstep(1.0, 1.12, vRest.x) * 0.6);                                          // face
  h += smoothstep(0.86, 1.0, rid) * 0.0006 * netMask;
  h *= uVeins * hairy;
  float fadeV = 1.0 - smoothstep(1.5, 5.0, length(fwidth(vRest)) * 1000.0);
  if (fadeV > 0.0) normal = bumpNormal(normal, h * fadeV);
  // lather sits proud of the coat
  if (lather > 0.01) normal = bumpNormal(normal, lather * 0.0015 * fbm(vRest * 300.0));
}
`;

const LIGHTS_MAIN = /* glsl */ `
#ifdef USE_SHEEN
material.sheenColor *= clamp(vMats.x + vMats.w * 0.6, 0.0, 1.0) * (0.6 + 0.4 * vAoCurv.x) * (1.0 - 0.7 * sweat) * (1.0 - clamp(dirt, 0.0, 1.0));
#endif
material.specularF90 = mix(material.specularF90, 1.0, sweat);
#ifdef USE_ANISOTROPY
material.anisotropy *= (1.0 - 0.5 * sweat) * (1.0 - clamp(dirt, 0.0, 1.0));
material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy));
#endif
`;

const AO_MAIN = /* glsl */ `
{
  float ambientOcclusion = vAoCurv.x * hairOcc;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
  clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_SHEEN )
  sheenSpecularIndirect *= ambientOcclusion;
  #endif
  reflectedLight.indirectSpecular *= ambientOcclusion * ambientOcclusion;
  // sweat adds a wet sheen, mostly visible in reflections
  reflectedLight.indirectSpecular *= 1.0 + 1.5 * sweat;
}
`;

export function createCoatMaterial(coatName = 'chestnut') {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.47,
    metalness: 0,
    sheen: 1.0,
    sheenRoughness: 0.38,
    sheenColor: new THREE.Color('#9a6c54'),
    anisotropy: 0.55,
    anisotropyRotation: Math.PI / 2, // highlight band runs across the hair direction
    clearcoat: 0.0,
    specularIntensity: 0.7,
  });

  const u = {
    uBody: { value: new THREE.Color() },
    uDark: { value: new THREE.Color() },
    uPoints: { value: new THREE.Color() },
    uSkin: { value: new THREE.Color() },
    uHoof: { value: new THREE.Color() },
    uHoofPale: { value: new THREE.Color('#b9a586') },
    uWhite: { value: new THREE.Color('#e9e4dc') },
    uDirtColor: { value: new THREE.Color('#7d6a52') },
    uDapple: { value: 0.2 },
    uStar: { value: new THREE.Vector4(...headPt(0.215, -0.072), 0.034) },
    uBlaze: { value: 1.0 },
    uBlazeA: { value: new THREE.Vector3(...headPt(0.24, -0.072)) },
    uBlazeB: { value: new THREE.Vector3(...headPt(0.6, 0.02)) },
    uSocks: { value: new THREE.Vector4(0, 0, 0.27, 0) }, // heights: LF, RF, LH, RH (0 = none)
    uDetail: { value: 1.0 },
    uDirt: { value: 0.15 },
    uSweat: { value: 0.0 },
    uVeins: { value: 0.5 },
    uJiggle: { value: new THREE.Vector3() },
  };
  mat.userData.uniforms = u;
  setCoat(mat, coatName);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN)
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
        {
          // soft tissue: belly and flanks lag the trunk's vertical motion
          vec3 rp = restPos;
          float belly = smoothstep(1.12, 0.9, rp.y) * smoothstep(0.42, 0.1, abs(rp.x + 0.05)) * smoothstep(0.05, -0.4, normal.y);
          float flank = smoothstep(1.3, 1.0, rp.y) * smoothstep(-0.75, -0.45, rp.x) * smoothstep(-0.2, -0.35, rp.x) * 0.5;
          float quarter = smoothstep(1.25, 1.05, rp.y) * smoothstep(-0.6, -0.8, rp.x) * smoothstep(0.3, 0.05, abs(rp.y - 1.1)) * 0.25;
          transformed += uJiggle * max(belly, max(flank, quarter));
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + COLOR_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + ROUGH_MAIN)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + NORMAL_MAIN)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + LIGHTS_MAIN)
      .replace('#include <aomap_fragment>', AO_MAIN);
  };
  mat.customProgramCacheKey = () => 'horse-coat-v2';
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
