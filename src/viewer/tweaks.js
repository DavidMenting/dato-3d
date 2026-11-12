/**
 * tweaks.js
 * A small lil-gui panel to play with the look live: shader, toon bands, lights,
 * LED glow, background. Settings are kept in localStorage; "Copy settings"
 * puts JSON on the clipboard to paste into LOOK_DEFAULTS in look.js.
 * H hides all on-screen UI (for clean captures).
 */

import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { LOOK_DEFAULTS, setToonGradient, aimKey } from './look.js';

const KEY = 'dato-3d.look';

export function createTweaks({ model, scene, lights }) {
  const look = { ...LOOK_DEFAULTS, ...load() };
  const gui = new GUI({ title: 'Look' });
  gui.close();

  const applyShader = () => { model.restyle(look); applyToon(); applyRoughness(); };
  const applyToon = () => {
    const tex = setToonGradient(look.toonSteps, look.toonShadow);
    model.eachMaterial(m => { if (m.isMeshToonMaterial) { m.gradientMap = tex; } });
  };
  const applyRoughness = () => model.eachMaterial(m => { if (m.isMeshStandardMaterial) m.roughness = look.roughness; });
  const applyLights = () => {
    lights.key.intensity = look.keyIntensity;
    lights.hemi.intensity = look.ambient;
    aimKey(lights.key, look.keyAzimuth, look.keyElevation);
  };
  const applyAll = () => {
    applyShader();
    applyLights();
    model.ledGlow = look.ledGlow;
    scene.background = new THREE.Color(look.background);
  };

  const on = fn => () => { fn(); save(look); };
  gui.add(look, 'shader', { Toon: 'toon', Lambert: 'lambert', 'Standard (PBR)': 'standard' }).name('Shader').onChange(on(applyShader));
  const toon = gui.addFolder('Toon');
  toon.add(look, 'toonSteps', 2, 6, 1).name('Bands').onChange(on(applyToon));
  toon.add(look, 'toonShadow', 0, 1, 0.01).name('Shadow level').onChange(on(applyToon));
  gui.add(look, 'roughness', 0, 1, 0.01).name('Roughness (PBR)').onChange(on(applyRoughness));
  const light = gui.addFolder('Light');
  light.add(look, 'keyIntensity', 0, 5, 0.05).name('Key').onChange(on(applyLights));
  light.add(look, 'keyAzimuth', -180, 180, 1).name('Key direction').onChange(on(applyLights));
  light.add(look, 'keyElevation', 5, 90, 1).name('Key height').onChange(on(applyLights));
  light.add(look, 'ambient', 0, 5, 0.05).name('Ambient').onChange(on(applyLights));
  gui.add(look, 'ledGlow', 0, 1.5, 0.01).name('LED glow').onChange(on(() => { model.ledGlow = look.ledGlow; }));
  gui.addColor(look, 'background').name('Background').onChange(on(() => { scene.background = new THREE.Color(look.background); }));

  gui.add({
    copy() {
      const text = JSON.stringify(look, null, 2);
      navigator.clipboard?.writeText(text).catch(() => {});
      console.log('Look settings:\n' + text);
    },
  }, 'copy').name('Copy settings');
  gui.add({
    reset() {
      Object.assign(look, LOOK_DEFAULTS);
      save(null);
      gui.controllersRecursive().forEach(c => c.updateDisplay());
      applyAll();
    },
  }, 'reset').name('Reset');

  applyAll();
  return { gui, look };
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

function save(look) {
  try {
    if (look) localStorage.setItem(KEY, JSON.stringify(look));
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}
