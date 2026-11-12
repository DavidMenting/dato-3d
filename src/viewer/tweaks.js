/**
 * tweaks.js
 * A small lil-gui panel to play with the look live: shader, toon bands, lights,
 * LED glow, background, and the photo options (reflections, tone mapping,
 * shadow, ambient occlusion). "Photo preset" switches them all on; Reset goes
 * back to the toon look. Settings are kept in localStorage; "Copy settings"
 * puts JSON on the clipboard to paste into LOOK_DEFAULTS in look.js.
 * H hides all on-screen UI (for clean captures).
 */

import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { LOOK_DEFAULTS, PHOTO_PRESET, setToonGradient, aimKey, pbrOf } from './look.js';

const KEY = 'dato-3d.look';

export function createTweaks({ model, scene, lights, stage }) {
  const look = { ...LOOK_DEFAULTS, ...load() };
  const gui = new GUI({ title: 'Look' });
  gui.close();

  const applyShader = () => { model.restyle(look); applyToon(); applyRoughness(); };
  const applyToon = () => {
    const tex = setToonGradient(look.toonSteps, look.toonShadow);
    model.eachMaterial(m => { if (m.isMeshToonMaterial) { m.gradientMap = tex; } });
  };
  const applyRoughness = () => model.eachMaterial(m => {
    if (m.isMeshStandardMaterial) m.roughness = Math.min(1, pbrOf(m.name).roughness * look.roughnessScale);
  });
  const applyStage = () => stage.apply(look);
  const applyLights = () => {
    lights.key.intensity = look.keyIntensity;
    lights.hemi.intensity = look.ambient;
    aimKey(lights.key, look.keyAzimuth, look.keyElevation);
  };
  const applyAll = () => {
    applyShader();
    applyLights();
    applyStage();
    model.ledGlow = look.ledGlow;
    scene.background = new THREE.Color(look.background);
  };

  const on = fn => () => { fn(); save(look); };
  gui.add(look, 'shader', { Toon: 'toon', Lambert: 'lambert', 'Standard (PBR)': 'standard' }).name('Shader').onChange(on(applyShader));
  const toon = gui.addFolder('Toon');
  toon.add(look, 'toonSteps', 2, 6, 1).name('Bands').onChange(on(applyToon));
  toon.add(look, 'toonShadow', 0, 1, 0.01).name('Shadow level').onChange(on(applyToon));
  const pbr = gui.addFolder('PBR');
  pbr.add(look, 'roughnessScale', 0, 2, 0.01).name('Roughness ×').onChange(on(applyRoughness));
  pbr.add(look, 'envIntensity', 0, 3, 0.05).name('Reflections').onChange(on(applyStage));
  const tone = gui.addFolder('Tone');
  tone.add(look, 'toneMapping', { None: 'none', AgX: 'agx', ACES: 'aces', Neutral: 'neutral' }).name('Tone mapping').onChange(on(applyStage));
  tone.add(look, 'exposure', 0.3, 3, 0.01).name('Exposure').onChange(on(applyStage));
  const shade = gui.addFolder('Shadow + occlusion');
  shade.add(look, 'shadows').name('Shadow').onChange(on(applyStage));
  shade.add(look, 'shadowSoftness', 0, 12, 0.1).name('Softness').onChange(on(applyStage));
  shade.add(look, 'shadowOpacity', 0, 1, 0.01).name('Floor shadow').onChange(on(applyStage));
  shade.add(look, 'ao').name('Ambient occlusion').onChange(on(applyStage));
  shade.add(look, 'aoIntensity', 0, 2, 0.01).name('AO strength').onChange(on(applyStage));
  shade.add(look, 'aoRadiusMm', 1, 30, 0.5).name('AO radius (mm)').onChange(on(applyStage));
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
  const preset = (values, keep) => () => {
    Object.assign(look, LOOK_DEFAULTS, values);
    save(keep ? look : null);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    applyAll();
  };
  gui.add({ photo: preset(PHOTO_PRESET, true) }, 'photo').name('Photo preset');
  gui.add({ reset: preset({}, false) }, 'reset').name('Reset (toon)');

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
