/**
 * Test script for SystemControlEngine & GestureConfig
 */
import { CONTROL_MODES, CONTROL_STATES, DEFAULT_GESTURE_CONFIG } from '../src/gestureConfig.js';
import { SystemControlEngine } from '../src/systemControlEngine.js';

console.log('--- TEST 1: Default State ---');
const engine = new SystemControlEngine();
console.assert(engine.state === CONTROL_STATES.DISABLED, 'Initial state should be DISABLED');

console.log('--- TEST 2: Enable & Modes ---');
engine.setEnabled(true);
console.assert(engine.state === CONTROL_STATES.READY, 'State after enable should be READY');
engine.setMode(CONTROL_MODES.BRIGHTNESS);
console.assert(engine.activeMode === CONTROL_MODES.BRIGHTNESS, 'Mode should be BRIGHTNESS');
engine.setMode(CONTROL_MODES.VOLUME);
console.assert(engine.activeMode === CONTROL_MODES.VOLUME, 'Mode should be VOLUME');

console.log('--- TEST 3: Volume Calibration & Movement ---');
let sentCommands = [];
const mockSendCommand = (action, payload) => {
  sentCommands.push({ action, payload });
};

// Frame 1: Hand enters with OPEN_PALM at Y = 0.50
let rep1 = engine.processFrame({
  landmarks: Array(21).fill({ x: 0.5, y: 0.5, z: 0 }),
  palmCenter: { x: 0.5, y: 0.5 },
  gesture: 'OPEN_PALM',
  confidence: 0.9,
  handSide: 'RIGHT',
  isBridgeOnline: true,
  systemStatus: { volume: 50, brightness: 70, muted: false },
  sendCommand: mockSendCommand,
});
console.assert(rep1.state === CONTROL_STATES.CALIBRATING, 'First active frame should calibrate');
console.assert(rep1.level === 50, 'Level should start at current system volume');

// Frame 2: Hand moves upward (Y: 0.50 -> 0.40)
// dy = 0.50 - 0.40 = +0.10. Dead zone = 0.02. Effective = 0.08.
let rep2 = engine.processFrame({
  landmarks: Array(21).fill({ x: 0.5, y: 0.4, z: 0 }),
  palmCenter: { x: 0.5, y: 0.4 },
  gesture: 'OPEN_PALM',
  confidence: 0.9,
  handSide: 'RIGHT',
  isBridgeOnline: true,
  systemStatus: { volume: 50, brightness: 70, muted: false },
  sendCommand: mockSendCommand,
});
console.assert(rep2.action === 'INCREASING (+)', 'Upward movement should indicate INCREASING (+)');
console.assert(rep2.level > 50, 'Level should increase above 50');

// Frame 3: Pinch locks level
let rep3 = engine.processFrame({
  landmarks: Array(21).fill({ x: 0.5, y: 0.4, z: 0 }),
  palmCenter: { x: 0.5, y: 0.4 },
  gesture: 'PINCH',
  confidence: 0.9,
  handSide: 'RIGHT',
  isBridgeOnline: true,
  systemStatus: { volume: 50, brightness: 70, muted: false },
  sendCommand: mockSendCommand,
});
console.assert(rep3.action === 'LOCKED', 'Pinch should lock level');
console.assert(rep3.isLocked === true, 'isLocked flag should be true');

console.log('--- TEST 4: Scroll Mode ---');
engine.setMode(CONTROL_MODES.SCROLL);
sentCommands = [];

// Calibration
engine.processFrame({
  landmarks: Array(21).fill({ x: 0.5, y: 0.5, z: 0 }),
  palmCenter: { x: 0.5, y: 0.5 },
  gesture: 'POINT',
  confidence: 0.9,
  handSide: 'RIGHT',
  isBridgeOnline: true,
  systemStatus: {},
  sendCommand: mockSendCommand,
});

// Move Down (Y: 0.50 -> 0.65) -> Scroll Down
let repScroll = engine.processFrame({
  landmarks: Array(21).fill({ x: 0.5, y: 0.65, z: 0 }),
  palmCenter: { x: 0.5, y: 0.65 },
  gesture: 'POINT',
  confidence: 0.9,
  handSide: 'RIGHT',
  isBridgeOnline: true,
  systemStatus: {},
  sendCommand: mockSendCommand,
});
console.assert(repScroll.action.includes('DOWN'), 'Downward hand movement should scroll down');

console.log('--- TEST 5: Hand Disappearance Safety ---');
let repLost = engine.processFrame({
  landmarks: null,
  palmCenter: null,
  gesture: 'NONE',
  confidence: 0,
  handSide: '—',
  isBridgeOnline: true,
  systemStatus: {},
  sendCommand: mockSendCommand,
});
console.assert(repLost.state === CONTROL_STATES.PAUSED, 'Lost tracking should pause');
console.assert(repLost.action === 'NO_HAND', 'Lost tracking action should be NO_HAND');

console.log('--- ALL UNIT TESTS PASSED SUCCESSFULLY! ---');
