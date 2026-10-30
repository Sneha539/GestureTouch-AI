/**
 * gestureConfig.js
 * Centralized configuration module for GestureTouch-AI System-Wide Control.
 * Defines control modes, states, thresholds, smoothing factors, and gesture-to-action mappings.
 */

// ── Control Modes ────────────────────────────────────────────────────────────
export const CONTROL_MODES = {
  VOLUME:     'VOLUME',
  BRIGHTNESS: 'BRIGHTNESS',
  SCROLL:     'SCROLL',
  MEDIA:      'MEDIA',
};

// ── Control States ───────────────────────────────────────────────────────────
export const CONTROL_STATES = {
  DISABLED:    'DISABLED',
  READY:       'READY',
  CALIBRATING: 'CALIBRATING',
  ACTIVE:      'ACTIVE',
  PAUSED:      'PAUSED',
  ERROR:       'ERROR',
};

// ── Default System Configuration ─────────────────────────────────────────────
export const DEFAULT_GESTURE_CONFIG = {
  // Master Switches
  enabled: false,              // Default is DISABLED until user explicitly enables
  systemWideEnabled: true,     // When true & bridge online -> real OS actions; otherwise browser mode

  // Active Mode (only 1 mode active at a time to prevent conflicting actions)
  activeMode: CONTROL_MODES.VOLUME,

  // Safety & Reliability
  confidenceThreshold: 0.72,   // Minimum prediction confidence required to trigger/hold actions
  holdDurationMs: 900,         // Hold time for discrete commands (Play/Pause, Next, Prev, Mute)
  actionCooldownMs: 1500,      // Minimum cooldown before the same discrete action can fire again
  lockAfterFire: true,         // Lock until gesture is released before allowing re-activation

  // Continuous Movement (Volume & Brightness)
  movementSensitivity: 1.35,   // Multiplier for vertical hand displacement
  movementSmoothingAlpha: 0.35,// Smoothing alpha for level updates (0.1 = heavy smoothing, 1.0 = raw)
  deadZoneY: 0.02,             // Normalized vertical movement dead-zone to filter tracking noise

  // Scrolling
  scrollSpeed: 120,            // Base wheel notch step (120 is standard WHEEL_DELTA)
  scrollDeadZoneY: 0.035,      // Dead-zone distance around calibration point
  scrollIntervalMs: 40,        // Max scroll dispatch frequency
  maxScrollSpeedMultiplier: 4, // Max velocity multiplier for fast hand movement

  // Gesture Mappings per Mode
  mappings: {
    [CONTROL_MODES.VOLUME]: {
      label: 'Volume Control',
      icon: '🔊',
      activationGesture: 'OPEN_PALM',  // Hand open enters volume active adjustment
      lockGesture: 'PINCH',            // Pinch to lock current volume level
      muteGesture: 'FIST',             // Fist to mute/unmute
      description: 'Move hand vertically to adjust master volume. Pinch to lock. Fist to mute/unmute.',
    },
    [CONTROL_MODES.BRIGHTNESS]: {
      label: 'Display Brightness',
      icon: '☀️',
      activationGesture: 'OPEN_PALM',  // Hand open enters brightness adjustment
      lockGesture: 'PINCH',            // Pinch to lock current brightness
      description: 'Move hand vertically to adjust screen brightness. Pinch to lock level.',
    },
    [CONTROL_MODES.SCROLL]: {
      label: 'System Scrolling',
      icon: '↕️',
      activationGestures: ['POINT', 'OPEN_PALM'], // Point or open palm initiates scroll
      description: 'Raise index finger (Point) or open palm. Move up to scroll up, down to scroll down.',
    },
    [CONTROL_MODES.MEDIA]: {
      label: 'Media Playback',
      icon: '⏯️',
      actions: {
        play_pause: { gesture: 'PINCH', label: 'Play / Pause',     emoji: '⏯️' },
        next_track: { gesture: 'PEACE', label: 'Next Track',       emoji: '⏭️' },
        prev_track: { gesture: 'THREE', label: 'Previous Track',   emoji: '⏮️' },
        mute:       { gesture: 'FIST',  label: 'Toggle Mute',      emoji: '🔇' },
      },
      description: 'Hold gestures: Pinch (Play/Pause) · Peace (Next Track) · Three (Prev Track) · Fist (Mute).',
    },
  },
};
