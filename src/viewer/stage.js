/**
 * stage.js
 * The optional "photo" side of the look, all driven from the Look panel:
 * a studio environment for reflections (PBR shader only), tone mapping, a soft
 * shadow from the key light with a shadow-catching floor, and screen-space
 * ambient occlusion. With everything off, render() is a plain renderer.render,
 * so the default toon look costs nothing extra.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The renderer never tone-maps a plain background colour, but a composer's
// OutputPass tone-maps the whole frame. So with the composer on, the scene is
// drawn over transparent black and the background goes in after the OutputPass.
// It is blended in sRGB values, as the canvas does for a direct render, so the
// floor shadow and the antialiased edges match with the composer on or off.
const BackgroundShader = {
  uniforms: { tDiffuse: { value: null }, background: { value: new THREE.Color() } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 background; varying vec2 vUv;
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);   // sRGB, premultiplied by coverage
      gl_FragColor = vec4(c.rgb + toSRGB(background) * (1.0 - c.a), 1.0);
    }`,
};

export const TONE_MAPPINGS = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

const SHADOW_HALF = 0.17;   // metres: the DRUM is 196 mm across
const KEY_DISTANCE = 2;     // aimKey() puts the key light this far from the origin

export function createStage({ renderer, scene, camera, lights, model }) {
  // ---- environment (only MeshStandardMaterial picks up scene.environment) ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // ---- shadow: key light casts, everything receives, a floor catches the rest ----
  renderer.shadowMap.enabled = true;
  const { key } = lights;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF,
    near: KEY_DISTANCE - 0.4, far: KEY_DISTANCE + 0.4,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.0004;
  for (const mesh of model.meshes) mesh.castShadow = mesh.receiveShadow = true;

  const floorMat = new THREE.ShadowMaterial({ opacity: 0.25 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.0002;
  floor.receiveShadow = true;
  floor.visible = false;
  scene.add(floor);

  // ---- ambient occlusion: built on first use ----
  let composer = null, gtao = null, backdrop = null, aoOn = false;
  const size = new THREE.Vector2();

  function buildComposer() {
    renderer.getDrawingBufferSize(size);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);   // the target is already in device pixels
    composer.addPass(new RenderPass(scene, camera, null, 0x000000, 0));
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    composer.addPass(gtao);
    composer.addPass(new OutputPass());   // tone mapping + sRGB, as the renderer would
    backdrop = new ShaderPass(BackgroundShader);
    composer.addPass(backdrop);
  }

  return {
    apply(look) {
      scene.environment = look.envIntensity > 0 ? envMap : null;
      scene.environmentIntensity = look.envIntensity;

      renderer.toneMapping = TONE_MAPPINGS[look.toneMapping] ?? THREE.NoToneMapping;
      renderer.toneMappingExposure = look.exposure;

      key.castShadow = look.shadows;
      key.shadow.radius = look.shadowSoftness;
      floor.visible = look.shadows;
      floorMat.opacity = look.shadowOpacity;

      aoOn = look.ao;
      if (aoOn) {
        if (!composer) buildComposer();
        gtao.blendIntensity = look.aoIntensity;
        gtao.updateGtaoMaterial({ radius: look.aoRadiusMm / 1000, distanceFallOff: 1, thickness: 1, screenSpaceRadius: false, samples: 24 });
      }
    },
    resize() {
      if (!composer) return;
      renderer.getDrawingBufferSize(size);
      composer.setSize(size.x, size.y);
    },
    render() {
      if (!aoOn) { renderer.render(scene, camera); return; }
      const bg = scene.background;
      backdrop.uniforms.background.value.copy(bg);
      scene.background = null;
      composer.render();
      scene.background = bg;
    },
  };
}
