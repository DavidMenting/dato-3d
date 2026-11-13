/**
 * main.js
 * The viewer: scene + model + one product's live mapping.
 *
 *   ?demo=0   no fake performance while waiting for a device (also: Demo button, D key)
 *   ?midi=0   don't ask for MIDI access (demo only; nothing is sent anywhere)
 *   H         hide all on-screen UI (Look panel, Demo button, status)
 *
 * window.viewer exposes { model, live, demo } for poking from the console.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BACKGROUND, addLights } from './viewer/look.js';
import { loadModel } from './viewer/model.js';
import { createTweaks } from './viewer/tweaks.js';
import { createStage } from './viewer/stage.js';
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
const lights = addLights(scene);

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
  stage?.resize();
}
let stage = null;
window.addEventListener('resize', resize);
resize();

const model = await loadModel('drum');
scene.add(model.root);
const live = createDrumLive(model);
const demo = createDrumDemo();
stage = createStage({ renderer, scene, camera, lights, model });
const tweaks = createTweaks({ model, scene, lights, stage, orbit });
window.viewer = { model, live, demo, scene, camera, tweaks, stage, renderer };

// A real device takes over from the demo; unplugging brings the demo back,
// unless the demo is switched off (button, D key, or ?demo=0). The choice is
// remembered per browser; ?demo= in the URL overrides it.
const DEMO_KEY = 'dato-3d.demo';
const midiOn = params.get('midi') !== '0';
const demoBtn = document.getElementById('demo-toggle');
let deviceConnected = false;
let wantDemo = params.has('demo') ? params.get('demo') !== '0' : readDemoPref();

function readDemoPref() {
  try { return localStorage.getItem(DEMO_KEY) !== '0'; } catch { return true; }
}

function syncDemo() {
  if (wantDemo && !deviceConnected) demo.start();
  else demo.stop();
  demoBtn.textContent = wantDemo ? 'Demo on' : 'Demo off';
  demoBtn.setAttribute('aria-pressed', String(wantDemo));
  demoBtn.disabled = deviceConnected;
  demoBtn.title = deviceConnected ? 'A device is connected' : 'Toggle the demo performance (D)';
  if (!midiOn) statusEl.textContent = wantDemo ? 'Demo performance' : 'Demo off';
}

function setDemo(on) {
  wantDemo = on;
  try { localStorage.setItem(DEMO_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  syncDemo();
}

demoBtn.addEventListener('click', () => setDemo(!wantDemo));
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'd' && !deviceConnected) setDemo(!wantDemo);
  if (k === 'h') document.body.classList.toggle('no-ui');   // clean frame for captures
});
document.addEventListener('midi-connected', () => { deviceConnected = true; syncDemo(); });
document.addEventListener('midi-disconnected', e => {
  if (e.detail?.name === 'demo') return;
  deviceConnected = false;
  syncDemo();
});
syncDemo();
if (midiOn) initMIDI(statusEl, DRUM);

let last = performance.now();
renderer.setAnimationLoop(time => {
  const dt = Math.min(time - last, 100);
  last = time;
  live.update(time);
  model.update(dt);
  orbit.update();
  stage.render();
});
