/**
 * live.js
 * DRUM: midi-* events → model. The 3D port of reference/drum/visualizer.js:
 * CSS classes became model.set() / model.light().
 *
 * Direct mappings: CCs (knobs, sliders, pressure buttons), Note Ons (pad hits),
 * sequencer-state SysEx (step pattern, selected samples).
 * Inferred (the DRUM sends no Start/Stop and its clock runs while stopped):
 * play state and playhead, by matching Note Ons against the pattern on the
 * clock grid.
 *
 * Events arrive whenever; LEDs are composed once per frame in update().
 */

import * as THREE from 'three';
import { CC_CONTROLS, NOTE_CONTROLS, STEP_LED_IDS, TRACK_STEP_MAP } from './controls.js';

const PULSES_PER_STEP = 6;          // 24 PPQN, 16th-note steps
const STEPS = 8;
const PULSES_PER_BEAT = 24;
const PAD_HIT_MS = 150;             // LED: 50% → 100% and back over this
const PAD_REST_LEVEL = 0.5;
const PAD_PRESS_MS = 110;
const SELECT_PRESS_MS = 140;
const PLAYHEAD_BLEND = 100 / 255;   // firmware: +100 toward white
const TRACE_MS = 220;               // pad-hit trace on the playhead's empty step
const STOPPED_AFTER_STEPS = 9;      // no pattern note for this long → stopped
const PLAY_PULSE_LOW = 0.39;        // stopped: play LED 100% ↔ 39% on the beat
const FILTER_FLOOR = 0.2;           // Filter dims and desaturates LEDs down to 20%
const CC_FILTER = 74;
const CC_CRUSH = 12;
const WHITE = new THREE.Color(0xffffff);

export function createDrumLive(model) {
  const pattern = new Uint8Array(32);       // [track 0–3][step 0–7] velocities
  const activeNote = [30, 38, 46, 54];      // selected sample per track
  const padHitAt = [-1e9, -1e9, -1e9, -1e9];
  const padVel = [0, 0, 0, 0];
  const selectAt = new Map();               // select id → time pressed
  const trace = new Map();                  // step LED id → { at, color }
  const cc = new Uint8Array(128);
  let havePattern = false;
  let pulse = 0;                            // clock pulses, free-running
  let stepOffset = 0;                       // pulse → step alignment (inferred)
  let lastMatchPulse = -1e9;
  let lastClockAt = -1e9;
  let now = 0;

  const color = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const noteColor = note => NOTE_CONTROLS[note]?.color ?? '#ffffff';
  const ledId = (track, step) => STEP_LED_IDS[TRACK_STEP_MAP[track + 1][0] + step];
  const currentStep = () => ((Math.floor(pulse / PULSES_PER_STEP) + stepOffset) % STEPS + STEPS) % STEPS;
  const playing = () => pulse - lastMatchPulse < STOPPED_AFTER_STEPS * PULSES_PER_STEP;

  // ---- events ---------------------------------------------------------------

  function onCC({ cc: n, value }) {
    cc[n] = value;
    const ctrl = CC_CONTROLS[n];
    if (ctrl) model.set(ctrl.id, value / 127);
  }

  function onNoteOn({ note, velocity }) {
    const ctrl = NOTE_CONTROLS[note];
    if (!ctrl) return;
    const t = ctrl.track - 1;
    activeNote[t] = note;
    padHitAt[t] = now;
    padVel[t] = velocity / 127;
    alignPlayhead(t);
    if (!pattern[t * STEPS + currentStep()]) {
      trace.set(ledId(t, currentStep()), { at: now, color: noteColor(note) });
    }
  }

  // A sequenced note lands on a step that is set for its track. Snap the
  // playhead to the nearest such step; a note that fits none was played by hand.
  function alignPlayhead(t) {
    if (!havePattern) return;
    const here = currentStep();
    // Notes fire at the start of a step; allow one step of slack either way.
    for (const d of [0, 1, -1]) {
      const s = ((here + d) % STEPS + STEPS) % STEPS;
      if (pattern[t * STEPS + s]) {
        if (d !== 0 && !playing()) {
          stepOffset += d;
          pulse -= pulse % PULSES_PER_STEP; // this note is the step's first pulse
        }
        lastMatchPulse = pulse;
        return;
      }
    }
  }

  function onClock() {
    pulse++;
    lastClockAt = now;
  }

  function onSequencerState({ stepVelocities: sv }) {
    pattern.set(sv.slice(0, 32));
    havePattern = true;
    for (let t = 0; t < 4; t++) {
      const note = sv[32 + t];
      const prev = activeNote[t];
      if (NOTE_CONTROLS[note] && note !== prev) {
        // 8 samples per track, wrapping: +1 = up, −1 = down
        const d = ((note - prev) % 8 + 8) % 8;
        selectAt.set(`select-${t + 1}-${d <= 4 ? 'up' : 'down'}`, now);
        activeNote[t] = note;
      }
    }
  }

  function onDisconnected() {
    pattern.fill(0);
    havePattern = false;
    lastMatchPulse = -1e9;
    cc.fill(0);
  }

  const listeners = [
    ['midi-cc', e => onCC(e.detail)],
    ['midi-note-on', e => onNoteOn(e.detail)],
    ['midi-clock', () => onClock()],
    ['midi-sequencer-state', e => onSequencerState(e.detail)],
    ['midi-disconnected', () => onDisconnected()],
  ];
  for (const [name, fn] of listeners) document.addEventListener(name, fn);

  // ---- per frame --------------------------------------------------------------

  // Global LED effects, as in the firmware: Filter dims + desaturates, Crush adds noise.
  function led(id, hex, level, whiten = 0) {
    color.set(hex);
    if (whiten) color.lerp(WHITE, whiten);
    const f = cc[CC_FILTER] / 127;
    if (f > 0) {
      color.getHSL(hsl);
      color.setHSL(hsl.h, hsl.s * (1 - f), hsl.l);
      level *= 1 - f * (1 - FILTER_FLOOR);
    }
    const crush = cc[CC_CRUSH] / 127;
    if (crush > 0 && level > 0) {
      color.r = THREE.MathUtils.clamp(color.r + (Math.random() - 0.5) * crush, 0, 1);
      color.g = THREE.MathUtils.clamp(color.g + (Math.random() - 0.5) * crush, 0, 1);
      color.b = THREE.MathUtils.clamp(color.b + (Math.random() - 0.5) * crush, 0, 1);
    }
    model.light(id, color, level);
  }

  function update(timeMs) {
    now = timeMs;
    const isPlaying = playing();
    const head = currentStep();

    // Step LEDs
    for (let t = 0; t < 4; t++) {
      const hex = noteColor(activeNote[t]);
      for (let s = 0; s < STEPS; s++) {
        const id = ledId(t, s);
        const vel = pattern[t * STEPS + s];
        const onHead = isPlaying && s === head;
        if (vel > 0) {
          led(id, hex, Math.min(vel * 2, 255) / 255, onHead ? PLAYHEAD_BLEND : 0);
        } else {
          const tr = trace.get(id);
          const age = tr ? (now - tr.at) / TRACE_MS : 1;
          if (age < 1) led(id, tr.color, 1 - age);
          else led(id, '#ffffff', onHead ? PLAYHEAD_BLEND : 0);
        }
      }
    }

    // Pads: LED in the selected sample's colour, a hit flashes and presses
    for (let t = 0; t < 4; t++) {
      const age = now - padHitAt[t];
      const flash = age < PAD_HIT_MS ? 1 - age / PAD_HIT_MS : 0;
      led(`drumpad-${t + 1}`, noteColor(activeNote[t]), PAD_REST_LEVEL + (1 - PAD_REST_LEVEL) * flash);
      model.set(`drumpad-${t + 1}`, age < PAD_PRESS_MS ? 0.4 + 0.6 * padVel[t] : 0);
    }

    // Sample-select triangles: brief press
    for (const [id, at] of selectAt) {
      const down = now - at < SELECT_PRESS_MS;
      model.set(id, down ? 1 : 0);
      if (!down) selectAt.delete(id);
    }

    // Play LED: solid while playing, pulses on the beat while stopped
    const clockAlive = now - lastClockAt < 500;
    let level = 0;
    if (isPlaying) level = 1;
    else if (clockAlive) {
      const beat = (pulse % PULSES_PER_BEAT) / PULSES_PER_BEAT;
      level = PLAY_PULSE_LOW + (1 - PLAY_PULSE_LOW) * (1 - beat);
    }
    led('play-outer', '#ffffff', level);
  }

  function dispose() {
    for (const [name, fn] of listeners) document.removeEventListener(name, fn);
  }

  return { update, dispose };
}
