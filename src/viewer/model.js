/**
 * model.js
 * Loads <product>.glb + <product>-motion.json and exposes the two things a
 * product's live.js needs:
 *
 *   model.set(id, t)              move a control: t in 0…1 between motion min and max
 *   model.light(id, color, level) light a lit part: THREE.Color, level 0…1
 *
 * GLB object names are the control IDs (the contract with controls.js).
 * motion.json says how each ID moves, in GLB space. Nothing here knows MIDI.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonMaterial, makeMaterial, LOOK_DEFAULTS } from './look.js';

// Pot hysteresis sends steps of 2: smooth over about 30 ms so moves don't look stepped.
const SMOOTH_MS = 30;
// Material that takes LED light on a lit part.
const LIT_MATERIAL = 'silicone';
// How an LED shows through light-grey silicone: tint the body, add some glow.
// The tint saturates early (a half-bright LED still reads as its colour, not
// as a pastel); the glow carries the brightness.
const ledTint = level => 1 - (1 - level) ** 3;

export async function loadModel(product, base = `${import.meta.env.BASE_URL}models/`) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, motion] = await Promise.all([
    loader.loadAsync(`${base}${product}.glb`),
    fetch(`${base}${product}-motion.json`).then(r => r.json()),
  ]);
  return new Model(gltf.scene, motion);
}

export class Model {
  constructor(root, motion) {
    this.root = root;
    this.controls = new Map();
    this.ledGlow = LOOK_DEFAULTS.ledGlow;
    root.updateMatrixWorld(true);

    const motionById = new Map(motion.controls.map(m => [m.id, m]));
    const shared = new Map(); // palette name → shared toon material

    // Collect first: we re-parent while wiring up.
    const meshes = [];
    root.traverse(o => { if (o.isMesh) meshes.push(o); });
    this.meshes = meshes;

    for (const mesh of meshes) {
      const owner = ownerId(mesh, motionById);
      const lit = owner && motionById.get(owner).lit;
      const name = mesh.material.name;
      let mat;
      if (lit && name === LIT_MATERIAL) {
        mat = toonMaterial(mesh.material.color); // own instance: its colour changes
        mat.userData.base = mat.color.clone();
        (this._litMats(owner)).push(mat);
      } else {
        if (!shared.has(name)) shared.set(name, toonMaterial(mesh.material.color));
        mat = shared.get(name);
      }
      mat.name = name;
      mesh.material = mat;
    }

    // Each control gets a pivot group at motion.pivot. The node is attached
    // under it keeping its world transform, so the GLB's own node transforms
    // (which mesh quantisation rewrites) never matter.
    for (const m of motion.controls) {
      const node = root.getObjectByName(m.id);
      if (!node) { console.warn(`model: no object named "${m.id}"`); continue; }
      const pivot = new THREE.Group();
      pivot.name = `${m.id}:pivot`;
      pivot.position.fromArray(m.pivot);
      root.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(node);
      const c = this._control(m.id);
      Object.assign(c, {
        motion: m, pivot, home: pivot.position.clone(),
        axis: new THREE.Vector3().fromArray(m.axis).normalize(),
        value: restValue(m), target: restValue(m),
      });
      this._apply(c);
    }
  }

  has(id) { return this.controls.has(id) && !!this.controls.get(id).motion; }

  /** Move a control to t (0…1 between motion min and max). Smoothed unless immediate. */
  set(id, t, immediate = false) {
    const c = this.controls.get(id);
    if (!c?.motion) return;
    c.target = THREE.MathUtils.clamp(t, 0, 1);
    if (immediate) { c.value = c.target; this._apply(c); }
  }

  /** Light a lit part. level 0 = unlit silicone. */
  light(id, color, level) {
    const c = this.controls.get(id);
    if (!c?.litMats) return;
    for (const mat of c.litMats) {
      mat.color.lerpColors(mat.userData.base, color, ledTint(level));
      mat.emissive.copy(color).multiplyScalar(level * this.ledGlow);
    }
  }

  /** Swap every material for one from makeMaterial(color, look), keeping colours, LED state and sharing. */
  restyle(look) {
    const swap = new Map();
    for (const mesh of this.meshes) {
      const old = mesh.material;
      if (!swap.has(old)) {
        const mat = makeMaterial(old.color, look, old.name);
        mat.name = old.name;
        mat.userData = old.userData;
        mat.emissive.copy(old.emissive);
        swap.set(old, mat);
      }
      mesh.material = swap.get(old);
    }
    for (const c of this.controls.values()) {
      if (c.litMats) c.litMats = c.litMats.map(m => swap.get(m) ?? m);
    }
    for (const old of swap.keys()) old.dispose();
  }

  /** Apply fn to each distinct material. */
  eachMaterial(fn) {
    new Set(this.meshes.map(m => m.material)).forEach(fn);
  }

  update(dtMs) {
    const k = 1 - Math.exp(-dtMs / SMOOTH_MS);
    for (const c of this.controls.values()) {
      if (!c.motion || c.value === c.target) continue;
      c.value += (c.target - c.value) * k;
      if (Math.abs(c.target - c.value) < 1e-4) c.value = c.target;
      this._apply(c);
    }
  }

  _apply(c) {
    const { motion: m, pivot, axis, home } = c;
    const x = m.min + (m.max - m.min) * c.value;
    if (m.type === 'rotate') {
      pivot.quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(x - (m.rest ?? 0)));
    } else {
      pivot.position.copy(home).addScaledVector(axis, x);
    }
  }

  _control(id) {
    if (!this.controls.has(id)) this.controls.set(id, {});
    return this.controls.get(id);
  }

  _litMats(id) {
    const c = this._control(id);
    return (c.litMats ??= []);
  }
}

// Value (0…1) that reproduces the pose the CAD was exported in.
function restValue(m) {
  if (m.type === 'press') return 0;
  const rest = m.type === 'rotate' ? (m.rest ?? 0) : 0;
  return (rest - m.min) / (m.max - m.min);
}

// The control a mesh belongs to: itself or the nearest named ancestor.
// (Multi-material objects load as a Group of meshes named id, id_1, …)
function ownerId(mesh, motionById) {
  for (let o = mesh; o; o = o.parent) {
    if (motionById.has(o.name)) return o.name;
  }
  return null;
}
