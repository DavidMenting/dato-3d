/**
 * device.js
 * DRUM SysEx dialect: the device profile for shared/midi.js, plus the
 * sequencer-state polling the step LEDs need.
 *
 * Copied from dato-production-tests@e728a8d drum/js/device.js; the bootloader
 * and settings calls are dropped (the 3D viewer only listens).
 *
 * Extra events dispatched:
 *   'midi-sequencer-state'  detail: { stepVelocities: number[] } (36 bytes: 4 tracks × 8 steps + 4 active notes)
 */

import { sendMessage, dispatch } from '../shared/midi.js';

// SysEx header: F0 + Dato manufacturer ID (00 22 01) + DRUM device ID (65)
const SYSEX_HEADER = [0xF0, 0x00, 0x22, 0x01, 0x65];
const TAG_FIRMWARE_VERSION_REQUEST = 0x01;
const TAG_SEQUENCER_STATE_REQUEST  = 0x30;
const TAG_SEQUENCER_STATE_RESPONSE = 0x31;

const SEQUENCER_POLL_INTERVAL_MS = 200;

let pollTimer = null;

function send(bytes) {
  sendMessage([...SYSEX_HEADER, ...bytes, 0xF7]);
}

export function requestSequencerState() {
  send([TAG_SEQUENCER_STATE_REQUEST]);
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(requestSequencerState, SEQUENCER_POLL_INTERVAL_MS);
  requestSequencerState();
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Firmware version payload may be an ASCII string ("v0.2.0") or 3 raw bytes
// (major, minor, patch) — handle both.
function decodeVersion(payload) {
  const bytes = Array.from(payload);
  const isAscii = bytes.length > 0 && bytes.every(b => b >= 0x20 && b < 0x7F);
  if (isAscii && bytes.length > 3) {
    return String.fromCharCode(...bytes).replace(/\0+$/, '').trim();
  }
  if (bytes.length >= 3) {
    return `v${bytes[0]}.${bytes[1]}.${bytes[2]}`;
  }
  if (isAscii) return String.fromCharCode(...bytes);
  return `v? (${bytes.join(' ')})`;
}

export const DRUM = {
  id: 'drum',
  name: 'DRUM',

  matches(data) {
    return data.length > SYSEX_HEADER.length && SYSEX_HEADER.every((b, i) => data[i] === b);
  },

  requestFirmwareVersion() {
    send([TAG_FIRMWARE_VERSION_REQUEST]);
  },

  onConnected() {
    startPolling();
  },

  onDisconnected() {
    stopPolling();
  },

  parseSysEx(data) {
    if (!this.matches(data)) return;
    const tag = data[SYSEX_HEADER.length];
    const payloadStart = SYSEX_HEADER.length + 1;
    const payload = data.slice(payloadStart, data.length - 1); // strip trailing F7

    if (tag === TAG_SEQUENCER_STATE_RESPONSE) {
      if (payload.length < 36) {
        console.warn(`sysex: SequencerStateResponse too short (${payload.length} payload bytes, need 36)`);
        return;
      }
      const stepVelocities = Array.from(payload.slice(0, 36));
      dispatch('midi-sequencer-state', { stepVelocities });
    } else if (tag === TAG_FIRMWARE_VERSION_REQUEST) {
      return decodeVersion(payload);
    } else {
      console.log(`sysex: unhandled tag 0x${tag.toString(16).padStart(2, '0')} (${data.length} bytes)`);
    }
  },
};
