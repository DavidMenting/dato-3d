/**
 * main.js
 * The viewer: scene + model + one product's live mapping.
 *
 *   ?demo=0   no fake performance while waiting for a device
 *   ?midi=0   don't ask for MIDI access (demo only; nothing is sent anywhere)
 *
 * window.viewer exposes { model, live, demo } for poking from the console.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BACKGROUND, addLights } from './viewer/look.js';
import { loadModel } from './viewer/model.js';
import { initMIDI } from './shared/midi.js';
import { DRUM } from './drum/device.js';
import { createDrumLive } from './drum/live.js';
import { createDrumDemo } from './drum/demo.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKGROUND);
addLights(scene);

// The camera sits on the −Z side (the Repeat / Tempo side), where the
// faceplate lettering reads upright.
const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 5);
camera.position.set(0.08, 0.32, -0.31);
const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 0.03, 0);
orbit.enableDamping = true;
orbit.minDistance = 0.12;
orbit.maxDistance = 1.5;

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const model = await loadModel('drum');
scene.add(model.root);
const live = createDrumLive(model);
const demo = createDrumDemo();
window.viewer = { model, live, demo, scene, camera };

// A real device takes over from the demo; unplugging brings the demo back.
const wantDemo = params.get('demo') !== '0';
document.addEventListener('midi-connected', () => demo.stop());
document.addEventListener('midi-disconnected', e => {
  if (wantDemo && e.detail?.name !== 'demo') demo.start();
});
if (wantDemo) demo.start();
if (params.get('midi') !== '0') initMIDI(statusEl, DRUM);
else statusEl.textContent = 'Demo performance';

let last = performance.now();
renderer.setAnimationLoop(time => {
  const dt = Math.min(time - last, 100);
  last = time;
  live.update(time);
  model.update(dt);
  orbit.update();
  renderer.render(scene, camera);
});
