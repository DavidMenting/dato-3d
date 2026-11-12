/**
 * look.js
 * The look: MeshToonMaterial with a 3-step gradient, flat palette colours, one
 * key light plus one hemisphere light, plain background. No outlines (David
 * dropped the inverted hull on 2026-11-12) and no post-processing.
 *
 * LOOK_DEFAULTS is the shipped look. The tweak panel (src/viewer/tweaks.js)
 * edits a copy of it live; "Copy settings" there gives JSON to paste back here.
 */

import * as THREE from 'three';

export const LOOK_DEFAULTS = {
  shader: 'toon',        // toon | lambert | standard
  toonSteps: 3,          // bands in the toon gradient
  toonShadow: 0.59,      // brightness of the darkest band (0…1)
  roughness: 0.6,        // standard only
  keyIntensity: 1.9,
  keyAzimuth: -149,      // degrees around Y; 180 = from the −Z (camera) side
  keyElevation: 60,      // degrees above the faceplate
  ambient: 1.6,          // hemisphere light intensity
  ledGlow: 0.35,         // emissive strength of lit silicone at full level
  background: '#f4f4f2',
};

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

/** Make a material of the given shader with a flat colour. */
export function makeMaterial(color, look = LOOK_DEFAULTS) {
  switch (look.shader) {
    case 'lambert': return new THREE.MeshLambertMaterial({ color });
    case 'standard': return new THREE.MeshStandardMaterial({ color, roughness: look.roughness, metalness: 0 });
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
