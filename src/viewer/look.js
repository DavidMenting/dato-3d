/**
 * look.js
 * The look: MeshToonMaterial with a 3-step gradient, flat palette colours, one
 * key light plus one hemisphere light, plain background. No outlines (David
 * dropped the inverted hull on 2026-11-12) and no post-processing.
 *
 * PHOTO_PRESET is the second look: PBR materials with per-part roughness and
 * metalness, studio reflections, tone mapping, soft shadow, ambient occlusion
 * (the machinery is in stage.js).
 *
 * LOOK_DEFAULTS is the shipped look. The tweak panel (src/viewer/tweaks.js)
 * edits a copy of it live; "Copy settings" there gives JSON to paste back here.
 */

import * as THREE from 'three';

export const LOOK_DEFAULTS = {
  shader: 'toon',        // toon | lambert | standard
  toonSteps: 3,          // bands in the toon gradient
  toonShadow: 0.59,      // brightness of the darkest band (0…1)
  roughnessScale: 1,     // standard only: multiplies each material's roughness in PBR
  envIntensity: 0,       // standard only: studio reflections; 0 = off
  toneMapping: 'none',   // none | aces | agx | neutral
  exposure: 1,
  shadows: false,        // key light casts a soft shadow, onto the floor too
  shadowSoftness: 4,
  shadowOpacity: 0.25,   // of the shadow on the floor
  ao: false,             // screen-space ambient occlusion (GTAO)
  aoIntensity: 1.5,      // above about 1.5 it gets grainy
  aoRadiusMm: 15,
  keyIntensity: 1.9,
  keyAzimuth: -149,      // degrees around Y; 180 = from the −Z (camera) side
  keyElevation: 60,      // degrees above the faceplate
  ambient: 1.6,          // hemisphere light intensity
  ledGlow: 0.35,         // emissive strength of lit silicone at full level
  background: '#f4f4f2',
};

/** Overrides on top of LOOK_DEFAULTS for the "Photo" preset button. */
export const PHOTO_PRESET = {
  shader: 'standard',
  envIntensity: 0.6,
  keyIntensity: 2.5,
  ambient: 0.25,
  toneMapping: 'neutral',   // keeps the palette colours true; AgX and ACES wash them out
  exposure: 1,
  shadows: true,
  ao: true,
  ledGlow: 0.8,
};

/** Surface per palette material (the GLB material name), for the standard shader. Guesses, by eye. */
export const PBR = {
  white:    { roughness: 0.55, metalness: 0 },   // powder-coated faceplate
  print:    { roughness: 0.6,  metalness: 0 },
  silicone: { roughness: 0.75, metalness: 0 },
  dark:     { roughness: 0.6,  metalness: 0 },
  knob:     { roughness: 0.4,  metalness: 0 },   // semi-gloss plastic shafts and levers
  case:     { roughness: 0.7,  metalness: 0 },
  felt:     { roughness: 1.0,  metalness: 0 },
  metal:    { roughness: 0.35, metalness: 1 },   // pot cans, screws, connector shells
  pcb:      { roughness: 0.5,  metalness: 0 },
  green:    { roughness: 0.75, metalness: 0 },   // effect buttons: silicone
  yellow:   { roughness: 0.75, metalness: 0 },
  red:      { roughness: 0.75, metalness: 0 },
  blue:     { roughness: 0.75, metalness: 0 },
};
const PBR_FALLBACK = { roughness: 0.6, metalness: 0 };

export const pbrOf = name => PBR[name] ?? PBR_FALLBACK;

export const BACKGROUND = LOOK_DEFAULTS.background;

export function toonGradient(steps, shadow) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    const v = steps === 1 ? 1 : shadow + (1 - shadow) * (i / (steps - 1));
    data[i] = Math.round(255 * v);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

let gradientMap = toonGradient(LOOK_DEFAULTS.toonSteps, LOOK_DEFAULTS.toonShadow);

/** Make a material of the given shader with a flat colour. name = palette name, for the PBR surface. */
export function makeMaterial(color, look = LOOK_DEFAULTS, name = '') {
  switch (look.shader) {
    case 'lambert': return new THREE.MeshLambertMaterial({ color });
    case 'standard': {
      const { roughness, metalness } = pbrOf(name);
      return new THREE.MeshStandardMaterial({ color, roughness: Math.min(1, roughness * look.roughnessScale), metalness });
    }
    default: return new THREE.MeshToonMaterial({ color, gradientMap });
  }
}

export const toonMaterial = color => makeMaterial(color);

/** New gradient for every toon material (same shader program, no recompile). */
export function setToonGradient(steps, shadow) {
  const old = gradientMap;
  gradientMap = toonGradient(steps, shadow);
  old.dispose();
  return gradientMap;
}

export function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b8b0, LOOK_DEFAULTS.ambient);
  const key = new THREE.DirectionalLight(0xffffff, LOOK_DEFAULTS.keyIntensity);
  scene.add(hemi, key);
  aimKey(key, LOOK_DEFAULTS.keyAzimuth, LOOK_DEFAULTS.keyElevation);
  return { hemi, key };
}

/** Point a directional light from azimuth/elevation (degrees) at the origin. */
export function aimKey(key, azimuth, elevation) {
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(elevation);
  key.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(2);
}
