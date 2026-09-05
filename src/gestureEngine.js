/**
 * gestureEngine.js
 * Pure functions for keypoint math, gesture recognition, and smoothing.
 * No React dependencies. Testable in isolation.
 *
 * MediaPipe Hand Landmark indices (21 points):
 *   0  = WRIST
 *   1  = THUMB_CMC
 *   2  = THUMB_MCP
 *   3  = THUMB_IP
 *   4  = THUMB_TIP
 *   5  = INDEX_MCP  (knuckle base)
 *   6  = INDEX_PIP
 *   7  = INDEX_DIP
 *   8  = INDEX_TIP
 *   9  = MIDDLE_MCP
 *   10 = MIDDLE_PIP
 *   11 = MIDDLE_DIP
 *   12 = MIDDLE_TIP
 *   13 = RING_MCP
 *   14 = RING_PIP
 *   15 = RING_DIP
 *   16 = RING_TIP
 *   17 = PINKY_MCP
 *   18 = PINKY_PIP
 *   19 = PINKY_DIP
 *   20 = PINKY_TIP
 */

// ─── EMA Smoothing ────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average filter applied to a landmarks array.
 * @param {Array|null} prev - previous smoothed landmarks (same shape as curr)
 * @param {Array}      curr - current raw landmarks from MediaPipe
 * @param {number}   alpha  - smoothing factor [0..1]; lower = smoother but more lag
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
 * Thumb direction: returns positive if tip is above MCP (screen y is inverted),
 * negative if below. Used to distinguish thumbs-up vs thumbs-down.
 */
function getThumbDirection(lm) {
  // lm[4] = THUMB_TIP, lm[2] = THUMB_MCP
  // In MediaPipe normalized coords: y=0 is top, y=1 is bottom
  // Thumb pointing UP means tip.y < wrist.y
  return lm[4].y - lm[0].y; // negative = up, positive = down
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
 * @param {Array}   lm         - smoothed landmarks
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

// ─── Single-Hand Gesture Classification ──────────────────────────────────────

/**
 * Classify a single hand's gesture from smoothed landmarks.
 *
 * Returns { gesture: string, confidence: number (0-1) }
 *
 * Gesture keys (expanded from original 7 to 13):
 *   PINCH, PEACE, FIST, OPEN_PALM, POINT, THUMBS_UP, THUMBS_DOWN,
 *   OK, ROCK, CALL_ME, THREE, FOUR, PINKY, CUSTOM
 *
 * Confidence is computed as a normalized margin score (how clearly the
 * detected gesture stands apart from the next-best candidate).
 *
 * @param {Array}   lm            - smoothed 21-point landmark array
 * @param {boolean} [wasPinched]  - previous pinch state for hysteresis
 * @returns {{ gesture: string, confidence: number, pinchInfo: object }}
 */
export function classifySingleHand(lm, wasPinched = false) {
  const fingerStates = getFingerStates(lm);
  const pinchInfo    = detectPinch(lm, wasPinched);
  const { thumb, index, middle, ring, pinky } = fingerStates;
  const thumbDir = getThumbDirection(lm);
  const scale    = getHandScale(lm);

  // ── Pinch (highest priority — thumb+index very close) ─────────────────────
  if (pinchInfo.pinched) {
    // OK sign: pinch + other 3 fingers extended
    if (middle && ring && pinky) {
      return { gesture: 'OK', confidence: 0.85, pinchInfo };
    }
    return { gesture: 'PINCH', confidence: pinchInfo.strength, pinchInfo };
  }

  // ── All 4 fingers curled (fist family) ────────────────────────────────────
  const allCurled = !index && !middle && !ring && !pinky;
  if (allCurled) {
    // Distinguish FIST vs THUMBS_UP vs THUMBS_DOWN by thumb direction + extension
    const thumbExtended = thumb;
    const thumbTipVsWristY = thumbDir; // negative = up, positive = down

    if (thumbExtended && thumbTipVsWristY < -0.08) {
      // Thumb tip clearly above wrist → THUMBS_UP
      const margin = Math.min(1, Math.abs(thumbTipVsWristY) * 6);
      return { gesture: 'THUMBS_UP', confidence: 0.75 + margin * 0.2, pinchInfo };
    }
    if (thumbExtended && thumbTipVsWristY > 0.08) {
      // Thumb tip clearly below wrist → THUMBS_DOWN
      const margin = Math.min(1, thumbTipVsWristY * 6);
      return { gesture: 'THUMBS_DOWN', confidence: 0.75 + margin * 0.2, pinchInfo };
    }
    // FIST (thumb in or ambiguous)
    const fistConf = allCurled ? 0.88 : 0.7;
    return { gesture: 'FIST', confidence: fistConf, pinchInfo };
  }

  // ── All 4 fingers extended ────────────────────────────────────────────────
  if (index && middle && ring && pinky) {
    return { gesture: 'OPEN_PALM', confidence: 0.90, pinchInfo };
  }

  // ── FOUR fingers (no thumb) ────────────────────────────────────────────────
  if (index && middle && ring && pinky && !thumb) {
    // Already caught above — but note: FOUR differs from OPEN_PALM only in thumb
    // The above catches both since thumb doesn't gate the check.
    // We need a separate check with thumb explicitly curled:
  }
  // Explicit FOUR: index+middle+ring+pinky, thumb clearly NOT abducted
  if (index && middle && ring && pinky && distance2D(lm[4], lm[2]) < distance2D(lm[3], lm[2]) * 1.1) {
    return { gesture: 'FOUR', confidence: 0.82, pinchInfo };
  }

  // ── Peace / V-sign ────────────────────────────────────────────────────────
  if (index && middle && !ring && !pinky) {
    return { gesture: 'PEACE', confidence: 0.90, pinchInfo };
  }

  // ── THREE fingers ─────────────────────────────────────────────────────────
  if (index && middle && ring && !pinky) {
    return { gesture: 'THREE', confidence: 0.85, pinchInfo };
  }

  // ── POINT (index only) ────────────────────────────────────────────────────
  if (index && !middle && !ring && !pinky) {
    return { gesture: 'POINT', confidence: 0.88, pinchInfo };
  }

  // ── PINKY only ────────────────────────────────────────────────────────────
  if (!index && !middle && !ring && pinky) {
    return { gesture: 'PINKY', confidence: 0.85, pinchInfo };
  }

  // ── ROCK (index + pinky, middle + ring curled) ────────────────────────────
  if (index && !middle && !ring && pinky) {
    return { gesture: 'ROCK', confidence: 0.87, pinchInfo };
  }

  // ── CALL ME / SHAKA (thumb + pinky extended) ─────────────────────────────
  if (!index && !middle && !ring && pinky && thumb) {
    return { gesture: 'CALL_ME', confidence: 0.84, pinchInfo };
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return { gesture: 'CUSTOM', confidence: 0.50, pinchInfo };
}

/**
 * Legacy wrapper for backward compatibility with existing App.jsx code.
 * Returns just the gesture string (no confidence).
 */
export function classifyPose(fingerStates, pinchInfo) {
  const { thumb, index, middle, ring, pinky } = fingerStates;
  if (pinchInfo.pinched) return 'PINCH';
  if (index && middle && !ring && !pinky) return 'PEACE';
  if (!index && !middle && !ring && !pinky) return 'FIST';
  if (index && middle && ring && pinky) return 'OPEN_PALM';
  if (index && !middle && !ring && !pinky) return 'POINT';
  if (!index && !middle && !ring && pinky) return 'PINKY';
  return 'CUSTOM';
}

// ─── Two-Hand Combo Classification ───────────────────────────────────────────

/**
 * Classify a combined gesture from two hands.
 *
 * @param {string|null} leftGesture  - gesture key from left hand (or null)
 * @param {string|null} rightGesture - gesture key from right hand (or null)
 * @param {number}      leftConf     - confidence for left gesture
 * @param {number}      rightConf    - confidence for right gesture
 * @returns {{ combo: string|null, confidence: number }}
 */
export function classifyTwoHands(leftGesture, rightGesture, leftConf = 0, rightConf = 0) {
  if (!leftGesture || !rightGesture) return { combo: null, confidence: 0 };

  const minConf = Math.min(leftConf, rightConf);

  // Normalize: treat OPEN_HAND as OPEN_PALM for combos
  const L = leftGesture  === 'OPEN_HAND' ? 'OPEN_PALM' : leftGesture;
  const R = rightGesture === 'OPEN_HAND' ? 'OPEN_PALM' : rightGesture;

  // Symmetric combos (order-independent pairs)
  const pair = [L, R].sort().join('+');

  const COMBO_MAP = {
    'THUMBS_UP+THUMBS_UP':   'DOUBLE_THUMBS_UP',
    'PEACE+PEACE':            'DOUBLE_PEACE',
    'FIST+FIST':              'DOUBLE_FIST',
    'OPEN_PALM+OPEN_PALM':    'DOUBLE_OPEN_PALM',
    'FIST+OPEN_PALM':         'FIST_PALM',
    'PEACE+THUMBS_UP':        'PEACE_THUMBS',
    'THUMBS_DOWN+THUMBS_DOWN':'DOUBLE_THUMBS_DOWN',
  };

  const combo = COMBO_MAP[pair] || null;
  return { combo, confidence: combo ? minConf : 0 };
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

/** Hold FIST this long to trigger Chrome */
export const FIST_HOLD_MS    = 1500;
/** Hold PEACE this long to trigger Spotify */
export const PEACE_HOLD_MS   = 1200;
/** Min ms between same command re-firing */
export const CMD_COOLDOWN_MS = 8000;
/** Max volume WS send frequency (ms) */
export const VOL_THROTTLE_MS =   80;

// ─── New hold-system constants ────────────────────────────────────────────────

/** Minimum confidence for an action gesture to be considered */
export const GESTURE_CONFIDENCE_THRESHOLD = 0.72;
/** Duration to hold a gesture before an action fires (ms) */
export const GESTURE_HOLD_DURATION = 1500;
/** Cooldown between same action firing again (ms) */
export const ACTION_COOLDOWN_MS = 8000;
