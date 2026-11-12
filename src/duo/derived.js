/**
 * derived.js
 * DUO sequencer knobs that send no CC: Speed and Length positions rebuilt from
 * timing. Lifted from dato-production-tests@e728a8d duo/js/test.js (bpmToPot,
 * gateToPot, clock and gate measuring); the maths is unchanged.
 *
 * Speed: tempo from MIDI clock (24 per beat). USB delivers pulses in bursts
 * (0–16 ms apart at a steady 600 BPM), so the period is a least-squares fit
 * over the last CLOCK_WINDOW_MS, used once the pulses span CLOCK_MIN_SPAN_MS.
 *
 * Length: note length (gate) measured while the sequencer runs. A note cut
 * short by the next note (off and on within NOTE_CUT_MS) shows the step length
 * or a retrigger, not the gate, so it is ignored.
 */

export const CC_MAX = 127;

export const CLOCK_PPQN = 24;
export const CLOCK_WINDOW_MS = 1000;
export const CLOCK_MIN_SPAN_MS = 600;
export const CLOCK_MIN_PULSES = 4;

export const NOTE_CUT_MS = 3;
export const NOTE_SETTLE_MS = 20;
export const GATE_MIN_MS = 10;
export const GATE_MAX_MS = 200;

/**
 * Tempo pot (0–1023) → clock period, copied from the firmware (tempo.cpp):
 * three linear segments of the period, 30–60, 60–200 and 200–603 BPM.
 */
const period = bpm => 2500000 / bpm;
const TEMPO_SEGMENTS = [ // [pot from, pot to, period from, period to]
  [0, 128, period(30), period(60)],
  [128, 895, period(60), period(200)],
  [895, 1023, period(200), period(603)],
];

export function bpmToPot(bpm) {
  const p = period(bpm);
  const seg = TEMPO_SEGMENTS.find(([, , , p1]) => p >= p1) ?? TEMPO_SEGMENTS.at(-1);
  const [pot0, pot1, p0, p1] = seg;
  return pot0 + (p - p0) / (p1 - p0) * (pot1 - pot0);
}

export function potToBpm(pot) {
  const [pot0, pot1, p0, p1] = TEMPO_SEGMENTS.find(([, to]) => pot <= to) ?? TEMPO_SEGMENTS.at(-1);
  return 2500000 / (p0 + (pot - pot0) / (pot1 - pot0) * (p1 - p0));
}

/** A 10-bit pot reading as a 0–127 value (like the CCs: >> 3). */
export const potToCC = pot => Math.max(0, Math.min(CC_MAX, Math.floor(pot / 8)));
export const ccToPot = cc => cc / CC_MAX * 1023;

export const gateToPot = ms => (ms - GATE_MIN_MS) / (GATE_MAX_MS - GATE_MIN_MS) * 1023;
export const potToGate = pot => GATE_MIN_MS + pot / 1023 * (GATE_MAX_MS - GATE_MIN_MS);

/** Clock period (ms) as the slope of a least-squares line through pulse index → time. */
export function clockPeriod(times) {
  const n = times.length;
  const meanI = (n - 1) / 2;
  const meanT = times.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  times.forEach((t, i) => { num += (i - meanI) * (t - meanT); den += (i - meanI) ** 2; });
  return num / den;
}

/**
 * Speed knob from MIDI clock. Feed it every 'midi-clock' time; it returns the
 * knob's CC (0–127) when that changes, else null.
 */
export function createSpeedTracker() {
  let times = [];
  let last = null;
  return {
    clock(now) {
      times.push(now);
      while (times.length && times[0] < now - CLOCK_WINDOW_MS) times.shift();
      if (times.length < CLOCK_MIN_PULSES || now - times[0] < CLOCK_MIN_SPAN_MS) return null;
      const bpm = 60000 / (clockPeriod(times) * CLOCK_PPQN);
      const cc = potToCC(bpmToPot(bpm));
      if (cc === last) return null;
      last = cc;
      return cc;
    },
    reset() { times = []; last = null; },
  };
}

/**
 * Length knob from note on/off while the sequencer runs. onChange(cc) fires
 * NOTE_SETTLE_MS after a note off, unless the next note cut it short.
 */
export function createLengthTracker(onChange) {
  let noteOn = null;
  let pendingGate = null;
  return {
    noteOn(time, running) {
      if (pendingGate && time - pendingGate.time < NOTE_CUT_MS) pendingGate = null;
      noteOn = running ? { time } : null;
    },
    noteOff(time) {
      if (!noteOn) return;
      const gate = { ms: time - noteOn.time, time };
      noteOn = null;
      pendingGate = gate;
      setTimeout(() => {
        if (pendingGate !== gate) return;
        pendingGate = null;
        onChange(potToCC(gateToPot(gate.ms)));
      }, NOTE_SETTLE_MS);
    },
    reset() { noteOn = null; pendingGate = null; },
  };
}
