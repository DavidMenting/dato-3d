/**
 * demo.js
 * A fake DRUM performance for when no device is plugged in. It dispatches the
 * same midi-* events a real DRUM produces (through midi.js dispatch), so the
 * whole live path is exercised. It also behaves like the firmware: a clock that
 * always runs, Note Ons without Note Offs, the pattern only via sequencer-state.
 */

import { dispatch } from '../shared/midi.js';

const BPM = 112;
const PULSE_MS = 60000 / BPM / 24;
const CH = 9;

// 4 tracks × 8 steps of velocities (0 = off)
const PATTERNS = [
  [[100, 0, 0, 0, 100, 0, 0, 60], [0, 0, 100, 0, 0, 0, 100, 0], [0, 80, 0, 0, 0, 80, 0, 90], [90, 0, 90, 90, 0, 90, 90, 0]],
  [[100, 0, 0, 100, 0, 0, 100, 0], [0, 0, 100, 0, 0, 0, 100, 40], [0, 0, 0, 80, 0, 0, 0, 0], [90, 90, 0, 90, 90, 0, 90, 90]],
  [[100, 0, 100, 0, 100, 0, 0, 0], [0, 0, 100, 0, 0, 100, 0, 0], [70, 0, 0, 0, 0, 0, 70, 0], [0, 90, 90, 0, 0, 90, 90, 0]],
];
const BASE_NOTE = [30, 38, 46, 54];

export function createDrumDemo() {
  let timer = null;
  let pulse = 0;
  let bar = 0;
  let pattern = PATTERNS[0];
  const sample = [0, 3, 1, 5];
  const cc = (n, v) => dispatch('midi-cc', { channel: CH, cc: n, value: Math.max(0, Math.min(127, Math.round(v))) });

  function sendState() {
    const stepVelocities = [...pattern.flat(), ...sample.map((s, t) => BASE_NOTE[t] + s)];
    dispatch('midi-sequencer-state', { stepVelocities });
  }

  // A press-shaped envelope: 0 → 1 → 0 over [start, start + len) bars
  const pressAt = (bars, start, len) => {
    const x = (bars - start) / len;
    return x > 0 && x < 1 ? Math.sin(Math.PI * x) ** 0.6 : 0;
  };

  function tick() {
    const time = performance.now();
    dispatch('midi-clock', { time });
    const step = Math.floor(pulse / 6) % 8;
    const bars = pulse / 48;            // one loop of 8 steps = one "bar" here

    if (pulse % 6 === 0) {
      if (step === 0) {
        bar++;
        if (bar % 4 === 0) pattern = PATTERNS[(bar / 4) % PATTERNS.length];
        if (bar % 3 === 0) { const t = bar % 4; sample[t] = (sample[t] + (bar % 2 ? 1 : 7)) % 8; }
        sendState();
      }
      for (let t = 0; t < 4; t++) {
        const velocity = pattern[t][step];
        if (velocity) dispatch('midi-note-on', { channel: CH, note: BASE_NOTE[t] + sample[t], velocity, time });
      }
    }

    // Hands on the controls: slow sweeps, 2-step quantised like the pots
    if (pulse % 2 === 0) {
      const s = (period, phase = 0) => 0.5 + 0.5 * Math.sin((bars / period + phase) * 2 * Math.PI);
      cc(21, 127 * s(5));
      cc(22, 127 * s(7, 0.3));
      cc(23, 127 * s(9, 0.6));
      cc(24, 127 * s(6, 0.8));
      cc(15, 40 + 50 * s(16));
      cc(7, 80 + 40 * s(11, 0.2));
      cc(9, [0, 64, 127][Math.floor(bars / 6) % 3]);
      const loop = bars % 16;
      cc(74, 127 * pressAt(loop, 6, 1.5));
      cc(75, 127 - 127 * pressAt(loop, 6, 1.5));
      cc(12, 127 * pressAt(loop, 10, 1));
      cc(17, 127 * pressAt(loop, 13, 0.5));
      cc(16, 127 * pressAt(loop, 14.5, 0.75));
    }
    pulse++;
  }

  return {
    get running() { return timer !== null; },
    start() {
      if (timer !== null) return;
      sendState();
      timer = setInterval(tick, PULSE_MS);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      dispatch('midi-disconnected', { name: 'demo' });
    },
  };
}
