/**
 * gestureEngine.js
 * Pure functions for keypoint math, gesture recognition, and smoothing.
 * No React dependencies. Testable in isolation.
 *
 * MediaPipe Hand Landmark indices (21 points):
 *   0  = WRIST
 *   4  = THUMB_TIP
 *   8  = INDEX_FINGER_TIP
 *   12 = MIDDLE_FINGER_TIP
 *   16 = RING_FINGER_TIP
 *   20 = PINKY_TIP
 *   5  = INDEX_MCP  (knuckle base)
 *   5  = INDEX_FINGER_MCP  (knuckle)
 *   9  = MIDDLE_FINGER_MCP
 *   13 = RING_FINGER_MCP
 *   17 = PINKY_MCP
 */

// ─── EMA Smoothing ────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average filter applied to a landmarks array.
 * @param {Array} prev   - previous smoothed landmarks (same shape as curr)
 * @param {Array} curr   - current raw landmarks from MediaPipe
 * @param {number} alpha - smoothing factor [0..1]; lower = smoother but more lag
 * @returns {Array} smoothed landmarks
 */
export function smoothLandmarks(prev, curr, alpha = 0.4) {
  if (!prev || prev.length !== curr.length) return curr;
  return curr.map((lm, i) => ({
    x: prev[i].x * (1 - alpha) + lm.x * alpha,
    y: prev[i].y * (1 - alpha) + lm.y * alpha,
    z: prev[i].z * (1 - alpha) + lm.z * alpha,
    visibility: lm.visibility,
  }));
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Euclidean distance between two landmarks (normalized 0..1 space).
 */
export function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * 2D Euclidean distance (ignores Z — more stable for screen-space gestures).
 */
export function distance2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Palm center: centroid of the four MCP knuckles (5, 9, 13, 17).
 */
export function getPalmCenter(lm) {
  const pts = [lm[5], lm[9], lm[13], lm[17]];
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
  };
}

/**
 * Rough hand size: wrist-to-middle-MCP distance.
 * Used to normalize thresholds so they're scale-independent.
 */
export function getHandScale(lm) {
  return distance(lm[0], lm[9]);
}

// ─── Finger extension helpers ─────────────────────────────────────────────────

/**
 * Returns true if the finger (defined by tip and pip landmark indices)
 * is "extended" — tip is further from wrist than the pip joint.
 */
function isFingerExtended(lm, tipIdx, pipIdx) {
  return distance(lm[0], lm[tipIdx]) > distance(lm[0], lm[pipIdx]);
}

/**
 * Returns an object { thumb, index, middle, ring, pinky } with boolean extension state.
 */
export function getFingerStates(lm) {
  return {
    thumb:  distance2D(lm[4], lm[2]) > distance2D(lm[3], lm[2]),  // thumb abduction
    index:  isFingerExtended(lm, 8,  6),
    middle: isFingerExtended(lm, 12, 10),
    ring:   isFingerExtended(lm, 16, 14),
    pinky:  isFingerExtended(lm, 20, 18),
  };
}

// ─── Pinch Detection ─────────────────────────────────────────────────────────

const PINCH_CLOSED_RATIO = 0.09;   // fraction of hand scale
const PINCH_OPEN_RATIO   = 0.14;

/**
 * Pinch state machine (avoids jitter at the threshold boundary).
 * @param {Array}  lm          - smoothed landmarks
 * @param {boolean} wasPinched - previous pinch state
 * @returns {{ pinched: boolean, strength: number, point: {x,y} }}
 */
export function detectPinch(lm, wasPinched) {
  const thumbTip = lm[4];
  const indexTip = lm[8];
  const d = distance2D(thumbTip, indexTip);
  const scale = getHandScale(lm);
  const ratio = d / scale;

  const strength = Math.max(0, Math.min(1, 1 - (ratio - PINCH_CLOSED_RATIO) / (PINCH_OPEN_RATIO - PINCH_CLOSED_RATIO)));

  let pinched;
  if (wasPinched) {
    pinched = ratio < PINCH_OPEN_RATIO;    // hysteresis: stay pinched until clearly open
  } else {
    pinched = ratio < PINCH_CLOSED_RATIO;  // only snap closed if very close
  }

  return {
    pinched,
    strength,
    point: {
      x: (thumbTip.x + indexTip.x) / 2,
      y: (thumbTip.y + indexTip.y) / 2,
    },
  };
}

// ─── Swipe Detection ─────────────────────────────────────────────────────────

const SWIPE_VELOCITY_THRESH = 0.018;  // Δ normalized units per frame
const SWIPE_CONFIRM_FRAMES  = 4;      // consecutive frames needed to confirm

/**
 * Maintains swipe state given palm center history.
 * Call this once per frame with the running history buffer.
 *
 * @param {Array<{x,y}>} history - ring buffer of recent palm centers (last N frames)
 * @returns {'LEFT'|'RIGHT'|'UP'|'DOWN'|null}
 */
export function detectSwipe(history) {
  if (history.length < SWIPE_CONFIRM_FRAMES) return null;

  const recent = history.slice(-SWIPE_CONFIRM_FRAMES);
  const dx = recent[recent.length - 1].x - recent[0].x;
  const dy = recent[recent.length - 1].y - recent[0].y;

  const avgVx = dx / SWIPE_CONFIRM_FRAMES;
  const avgVy = dy / SWIPE_CONFIRM_FRAMES;

  if (Math.abs(avgVx) > Math.abs(avgVy)) {
    if (Math.abs(avgVx) > SWIPE_VELOCITY_THRESH) {
      return avgVx > 0 ? 'RIGHT' : 'LEFT';
    }
  } else {
    if (Math.abs(avgVy) > SWIPE_VELOCITY_THRESH) {
      return avgVy > 0 ? 'DOWN' : 'UP';
    }
  }
  return null;
}

// ─── Pose Classification ─────────────────────────────────────────────────────

/**
 * High-level gesture pose from finger states.
 * Returns a string label consumed by the UI.
 */
export function classifyPose(fingerStates, pinchInfo) {
  const { thumb, index, middle, ring, pinky } = fingerStates;

  if (pinchInfo.pinched) return 'PINCH';
  if (index && middle && !ring && !pinky) return 'PEACE';
  if (!index && !middle && !ring && !pinky) return 'FIST';
  if (index && middle && ring && pinky) return 'OPEN_HAND';
  if (index && !middle && !ring && !pinky) return 'POINT';
  if (!index && !middle && !ring && pinky) return 'PINKY';
  return 'CUSTOM';
}

// ─── Volume mapping ───────────────────────────────────────────────────────────

/**
 * Map the index fingertip's Y-position to a volume level 0–100.
 * Raising the hand (Y→0) = 100%, lowering (Y→1) = 0%.
 * Uses a calibrated inner range [0.15, 0.85] for comfortable motion.
 * @param {Array} lm - smoothed landmarks
 * @returns {number} integer 0–100
 */
export function getVolumeFromIndex(lm) {
  const tipY = lm[8].y;                            // INDEX_FINGER_TIP
  const normalized = (0.85 - tipY) / (0.85 - 0.15); // map [0.85..0.15] → [0..1]
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

// ─── OS command timing constants (exported for App.jsx) ───────────────────────
export const FIST_HOLD_MS    = 1500;  // hold FIST this long to launch Chrome
export const PEACE_HOLD_MS   = 1200;  // hold PEACE this long to launch Spotify
export const CMD_COOLDOWN_MS = 5000;  // min ms between same command re-firing
export const VOL_THROTTLE_MS =   80;  // max volume WS send frequency (ms)
