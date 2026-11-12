/**
 * look.js
 * The look: MeshToonMaterial with a 3-step gradient, flat palette colours, one
 * key light plus one hemisphere light, plain background. No outlines (David
 * dropped the inverted hull on 2026-11-12) and no post-processing.
 */

import * as THREE from 'three';

export const BACKGROUND = 0xf4f4f2;

const gradientMap = new THREE.DataTexture(new Uint8Array([150, 205, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

export function toonMaterial(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap });
}

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b8b0, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-0.6, 2, -1);
  scene.add(key);
}
