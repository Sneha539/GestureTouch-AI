/**
 * systemControlEngine.js
 * Pure state machine and action dispatcher for System-Wide Gesture Control.
 * Decoupled from React and MediaPipe rendering.
 */
import { CONTROL_MODES, CONTROL_STATES, DEFAULT_GESTURE_CONFIG } from './gestureConfig.js';

export class SystemControlEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };

    // Operational State
    this.state = this.config.enabled ? CONTROL_STATES.READY : CONTROL_STATES.DISABLED;
    this.activeMode = this.config.activeMode || CONTROL_MODES.VOLUME;
    this.isLocked = false;

    // Calibration & continuous movement
    this.calibratedY = null;
    this.calibratedLevel = null;
    this.currentSmoothedLevel = null;
    this.lastActionType = 'IDLE'; // 'INCREASING' | 'DECREASING' | 'LOCKED' | 'IDLE' | 'SCROLLING_UP' | 'SCROLLING_DOWN'
    this.lastDispatchTime = 0;

    // Discrete hold tracking (Media, Mute, Launches)
    this.hold = {
      gesture: null,
      startTime: null,
      locked: false,
      lastFired: {},
    };

    // Callback handlers for actions
    this.onActionDispatched = null;
  }

  setEnabled(enabled) {
    this.config.enabled = Boolean(enabled);
    if (!this.config.enabled) {
      this.reset();
      this.state = CONTROL_STATES.DISABLED;
    } else {
      this.state = CONTROL_STATES.READY;
    }
  }

  setMode(mode) {
    if (Object.values(CONTROL_MODES).includes(mode)) {
      this.activeMode = mode;
      this.resetCalibration();
      this.resetHold();
      this.lastActionType = 'IDLE';
    }
  }

  resetCalibration() {
    this.calibratedY = null;
    this.calibratedLevel = null;
    this.isLocked = false;
    this.lastActionType = 'IDLE';
  }

  resetHold() {
    this.hold.gesture = null;
    this.hold.startTime = null;
    this.hold.locked = false;
  }

  reset() {
    this.resetCalibration();
    this.resetHold();
    this.currentSmoothedLevel = null;
    this.lastActionType = 'IDLE';
  }

  /**
   * Main per-frame process function.
   *
   * @param {Object} params
   * @param {Array|null} params.landmarks - 21-point smoothed landmarks for active hand
   * @param {Object|null} params.palmCenter - { x, y } normalized palm center
   * @param {string} params.gesture - current classified gesture
   * @param {number} params.confidence - prediction confidence (0-1)
   * @param {string} params.handSide - 'LEFT' or 'RIGHT'
   * @param {boolean} params.isBridgeOnline - whether WebSocket server is connected
   * @param {Object} params.systemStatus - { volume, brightness, muted, capabilities }
   * @param {Function} params.sendCommand - WebSocket sendCommand function
   * @returns {Object} current telemetry & state report
   */
  processFrame({
    landmarks,
    palmCenter,
    gesture,
    confidence,
    handSide = 'RIGHT',
    isBridgeOnline = false,
    systemStatus = {},
    sendCommand = () => {},
  }) {
    if (!this.config.enabled) {
      this.state = CONTROL_STATES.DISABLED;
      return this._buildReport({
        mode: this.activeMode,
        state: CONTROL_STATES.DISABLED,
        action: 'DISABLED',
        level: null,
        hand: handSide,
      });
    }

    // Safety: If no hand detected or tracking lost
    if (!landmarks || !palmCenter || gesture === 'NONE') {
      if (this.state === CONTROL_STATES.ACTIVE || this.state === CONTROL_STATES.CALIBRATING) {
        this.state = CONTROL_STATES.PAUSED;
      }
      this.resetCalibration();
      this.resetHold();
      return this._buildReport({
        mode: this.activeMode,
        state: this.state === CONTROL_STATES.DISABLED ? CONTROL_STATES.DISABLED : CONTROL_STATES.PAUSED,
        action: 'NO_HAND',
        level: this.currentSmoothedLevel,
        hand: '—',
      });
    }

    // Safety: check confidence threshold
    if (confidence < this.config.confidenceThreshold) {
      this.resetHold();
      return this._buildReport({
        mode: this.activeMode,
        state: CONTROL_STATES.READY,
        action: 'LOW_CONFIDENCE',
        level: this.currentSmoothedLevel,
        hand: handSide,
      });
    }

    const now = performance.now();

    // ── Mode 1: VOLUME ────────────────────────────────────────────────────────
    if (this.activeMode === CONTROL_MODES.VOLUME) {
      return this._handleVolumeMode({
        palmCenter,
        gesture,
        confidence,
        handSide,
        isBridgeOnline,
        systemStatus,
        sendCommand,
        now,
      });
    }

    // ── Mode 2: BRIGHTNESS ────────────────────────────────────────────────────
    if (this.activeMode === CONTROL_MODES.BRIGHTNESS) {
      return this._handleBrightnessMode({
        palmCenter,
        gesture,
        confidence,
        handSide,
        isBridgeOnline,
        systemStatus,
        sendCommand,
        now,
      });
    }

    // ── Mode 3: SCROLL ────────────────────────────────────────────────────────
    if (this.activeMode === CONTROL_MODES.SCROLL) {
      return this._handleScrollMode({
        palmCenter,
        gesture,
        confidence,
        handSide,
        isBridgeOnline,
        sendCommand,
        now,
      });
    }

    // ── Mode 4: MEDIA ─────────────────────────────────────────────────────────
    if (this.activeMode === CONTROL_MODES.MEDIA) {
      return this._handleMediaMode({
        gesture,
        confidence,
        handSide,
        isBridgeOnline,
        sendCommand,
        now,
      });
    }

    return this._buildReport({
      mode: this.activeMode,
      state: CONTROL_STATES.READY,
      action: 'IDLE',
      level: null,
      hand: handSide,
    });
  }

  // ── Mode Handlers ──────────────────────────────────────────────────────────

  _handleVolumeMode({ palmCenter, gesture, handSide, isBridgeOnline, systemStatus, sendCommand, now }) {
    // 1. Fist gesture -> Toggle Mute (discrete hold)
    if (gesture === 'FIST') {
      const muteResult = this._checkDiscreteHold('mute', this.config.holdDurationMs, now);
      if (muteResult.fired) {
        if (isBridgeOnline && this.config.systemWideEnabled) {
          sendCommand('set_mute', { muted: !systemStatus.muted });
        }
        this.lastActionType = systemStatus.muted ? 'UNMUTED' : 'MUTED';
      }
      return this._buildReport({
        mode: CONTROL_MODES.VOLUME,
        state: CONTROL_STATES.ACTIVE,
        action: muteResult.locked ? (systemStatus.muted ? 'MUTED' : 'UNMUTED') : 'HOLD_MUTE',
        level: systemStatus.volume ?? this.currentSmoothedLevel,
        holdProgress: muteResult.progress,
        hand: handSide,
      });
    }

    // 2. Pinch gesture -> Lock current volume
    if (gesture === 'PINCH') {
      this.isLocked = true;
      this.lastActionType = 'LOCKED';
      return this._buildReport({
        mode: CONTROL_MODES.VOLUME,
        state: CONTROL_STATES.ACTIVE,
        action: 'LOCKED',
        level: systemStatus.volume ?? this.currentSmoothedLevel,
        hand: handSide,
        isLocked: true,
      });
    }

    // 3. Open Palm or Point gesture -> Active Volume Adjustment
    const isActiveGesture = gesture === 'OPEN_PALM' || gesture === 'POINT';
    if (isActiveGesture) {
      this.isLocked = false;
      this.state = CONTROL_STATES.ACTIVE;

      // Calibration step on entry
      if (this.calibratedY === null) {
        this.calibratedY = palmCenter.y;
        this.calibratedLevel = systemStatus.volume ?? (this.currentSmoothedLevel ?? 50);
        this.currentSmoothedLevel = this.calibratedLevel;
        return this._buildReport({
          mode: CONTROL_MODES.VOLUME,
          state: CONTROL_STATES.CALIBRATING,
          action: 'CALIBRATED',
          level: this.currentSmoothedLevel,
          hand: handSide,
        });
      }

      // Vertical displacement (screen Y is inverted: top is 0, bottom is 1)
      const dy = this.calibratedY - palmCenter.y; // dy > 0 when hand moves UP
      const deadZone = this.config.deadZoneY;

      if (Math.abs(dy) > deadZone) {
        const effectiveDy = dy > 0 ? dy - deadZone : dy + deadZone;
        const targetLevel = Math.max(0, Math.min(100, Math.round(this.calibratedLevel + effectiveDy * this.config.movementSensitivity * 100)));

        const alpha = this.config.movementSmoothingAlpha;
        const smoothed = Math.round(this.currentSmoothedLevel * (1 - alpha) + targetLevel * alpha);
        this.currentSmoothedLevel = smoothed;
        this.lastActionType = dy > 0 ? 'INCREASING (+)' : 'DECREASING (-)';

        // Dispatch volume command
        if (now - this.lastDispatchTime >= 40) {
          this.lastDispatchTime = now;
          if (isBridgeOnline && this.config.systemWideEnabled) {
            sendCommand('set_volume', { level: smoothed });
          }
        }

        return this._buildReport({
          mode: CONTROL_MODES.VOLUME,
          state: CONTROL_STATES.ACTIVE,
          action: this.lastActionType,
          level: smoothed,
          hand: handSide,
        });
      }

      return this._buildReport({
        mode: CONTROL_MODES.VOLUME,
        state: CONTROL_STATES.ACTIVE,
        action: 'STABLE',
        level: this.currentSmoothedLevel,
        hand: handSide,
      });
    }

    // Ambiguous / unsupported gesture in Volume mode
    this.resetCalibration();
    return this._buildReport({
      mode: CONTROL_MODES.VOLUME,
      state: CONTROL_STATES.READY,
      action: 'AWAITING_GESTURE',
      level: systemStatus.volume ?? this.currentSmoothedLevel,
      hand: handSide,
    });
  }

  _handleBrightnessMode({ palmCenter, gesture, handSide, isBridgeOnline, systemStatus, sendCommand, now }) {
    // 1. Pinch gesture -> Lock current brightness
    if (gesture === 'PINCH') {
      this.isLocked = true;
      this.lastActionType = 'LOCKED';
      return this._buildReport({
        mode: CONTROL_MODES.BRIGHTNESS,
        state: CONTROL_STATES.ACTIVE,
        action: 'LOCKED',
        level: systemStatus.brightness ?? this.currentSmoothedLevel,
        hand: handSide,
        isLocked: true,
      });
    }

    // 2. Open Palm or Point gesture -> Active Brightness Adjustment
    const isActiveGesture = gesture === 'OPEN_PALM' || gesture === 'POINT';
    if (isActiveGesture) {
      this.isLocked = false;
      this.state = CONTROL_STATES.ACTIVE;

      if (this.calibratedY === null) {
        this.calibratedY = palmCenter.y;
        this.calibratedLevel = systemStatus.brightness ?? (this.currentSmoothedLevel ?? 70);
        this.currentSmoothedLevel = this.calibratedLevel;
        return this._buildReport({
          mode: CONTROL_MODES.BRIGHTNESS,
          state: CONTROL_STATES.CALIBRATING,
          action: 'CALIBRATED',
          level: this.currentSmoothedLevel,
          hand: handSide,
        });
      }

      const dy = this.calibratedY - palmCenter.y;
      const deadZone = this.config.deadZoneY;

      if (Math.abs(dy) > deadZone) {
        const effectiveDy = dy > 0 ? dy - deadZone : dy + deadZone;
        const targetLevel = Math.max(0, Math.min(100, Math.round(this.calibratedLevel + effectiveDy * this.config.movementSensitivity * 100)));

        const alpha = this.config.movementSmoothingAlpha;
        const smoothed = Math.round(this.currentSmoothedLevel * (1 - alpha) + targetLevel * alpha);
        this.currentSmoothedLevel = smoothed;
        this.lastActionType = dy > 0 ? 'INCREASING (+)' : 'DECREASING (-)';

        if (now - this.lastDispatchTime >= 70) {
          this.lastDispatchTime = now;
          if (isBridgeOnline && this.config.systemWideEnabled) {
            sendCommand('set_brightness', { level: smoothed });
          }
        }

        return this._buildReport({
          mode: CONTROL_MODES.BRIGHTNESS,
          state: CONTROL_STATES.ACTIVE,
          action: this.lastActionType,
          level: smoothed,
          hand: handSide,
        });
      }

      return this._buildReport({
        mode: CONTROL_MODES.BRIGHTNESS,
        state: CONTROL_STATES.ACTIVE,
        action: 'STABLE',
        level: this.currentSmoothedLevel,
        hand: handSide,
      });
    }

    this.resetCalibration();
    return this._buildReport({
      mode: CONTROL_MODES.BRIGHTNESS,
      state: CONTROL_STATES.READY,
      action: 'AWAITING_GESTURE',
      level: systemStatus.brightness ?? this.currentSmoothedLevel,
      hand: handSide,
    });
  }

  _handleScrollMode({ palmCenter, gesture, handSide, isBridgeOnline, sendCommand, now }) {
    const isScrollGesture = gesture === 'POINT' || gesture === 'OPEN_PALM';

    if (isScrollGesture) {
      this.state = CONTROL_STATES.ACTIVE;

      if (this.calibratedY === null) {
        this.calibratedY = palmCenter.y;
        return this._buildReport({
          mode: CONTROL_MODES.SCROLL,
          state: CONTROL_STATES.CALIBRATING,
          action: 'CALIBRATED',
          level: null,
          hand: handSide,
        });
      }

      const dy = this.calibratedY - palmCenter.y; // dy > 0 when hand moved UP
      const deadZone = this.config.scrollDeadZoneY;

      if (Math.abs(dy) > deadZone) {
        const distance = Math.abs(dy) - deadZone;
        const speedMultiplier = Math.min(this.config.maxScrollSpeedMultiplier, 1 + distance * 10);
        // Wheel delta: positive = scroll up, negative = scroll down
        const rawDelta = Math.round((dy > 0 ? 1 : -1) * this.config.scrollSpeed * speedMultiplier);

        this.lastActionType = dy > 0 ? 'SCROLLING_UP (↑)' : 'SCROLLING_DOWN (↓)';

        if (now - this.lastDispatchTime >= this.config.scrollIntervalMs) {
          this.lastDispatchTime = now;

          if (isBridgeOnline && this.config.systemWideEnabled) {
            // System-wide scroll (mouse wheel injection)
            sendCommand('scroll', { delta: rawDelta });
          } else {
            // Browser-mode fallback: scroll active page
            window.scrollBy({ top: -rawDelta, behavior: 'auto' });
          }
        }

        return this._buildReport({
          mode: CONTROL_MODES.SCROLL,
          state: CONTROL_STATES.ACTIVE,
          action: this.lastActionType,
          level: Math.round(Math.abs(rawDelta)),
          hand: handSide,
        });
      }

      return this._buildReport({
        mode: CONTROL_MODES.SCROLL,
        state: CONTROL_STATES.ACTIVE,
        action: 'STATIONARY',
        level: 0,
        hand: handSide,
      });
    }

    // Hand released scroll gesture -> immediately stop scrolling
    this.resetCalibration();
    return this._buildReport({
      mode: CONTROL_MODES.SCROLL,
      state: CONTROL_STATES.READY,
      action: 'AWAITING_GESTURE',
      level: null,
      hand: handSide,
    });
  }

  _handleMediaMode({ gesture, handSide, isBridgeOnline, sendCommand, now }) {
    const mediaActions = this.config.mappings[CONTROL_MODES.MEDIA].actions;
    let matchedCommand = null;

    for (const [cmdKey, def] of Object.entries(mediaActions)) {
      if (def.gesture === gesture) {
        matchedCommand = cmdKey;
        break;
      }
    }

    if (matchedCommand) {
      const holdRes = this._checkDiscreteHold(matchedCommand, this.config.holdDurationMs, now);

      if (holdRes.fired) {
        if (isBridgeOnline && this.config.systemWideEnabled) {
          sendCommand('media_command', { command: matchedCommand });
        } else if (navigator.mediaSession) {
          // Browser media session fallback where supported
          try {
            if (matchedCommand === 'play_pause') {
              // Simulated action log or browser media
            }
          } catch { /* ignore */ }
        }
        this.lastActionType = `DISPATCHED_${matchedCommand.toUpperCase()}`;
      }

      const actionDef = mediaActions[matchedCommand];
      return this._buildReport({
        mode: CONTROL_MODES.MEDIA,
        state: CONTROL_STATES.ACTIVE,
        action: holdRes.locked ? `✓ ${actionDef.label}` : `HOLD · ${actionDef.label}`,
        level: Math.round(holdRes.progress),
        holdProgress: holdRes.progress,
        hand: handSide,
      });
    }

    // Release/change gesture clears hold
    this.resetHold();
    return this._buildReport({
      mode: CONTROL_MODES.MEDIA,
      state: CONTROL_STATES.READY,
      action: 'AWAITING_GESTURE',
      level: null,
      hand: handSide,
    });
  }

  // ── Helper: Discrete hold state machine ─────────────────────────────────────
  _checkDiscreteHold(actionKey, holdDurationMs, now) {
    const hold = this.hold;

    if (hold.gesture !== actionKey) {
      hold.gesture = actionKey;
      hold.startTime = now;
      hold.locked = false;
    }

    if (hold.locked) {
      return { progress: 100, fired: false, locked: true };
    }

    const elapsed = now - hold.startTime;
    const progress = Math.min(100, (elapsed / holdDurationMs) * 100);

    if (elapsed >= holdDurationMs) {
      const lastFiredTime = hold.lastFired[actionKey] || 0;
      if (now - lastFiredTime >= this.config.actionCooldownMs) {
        hold.lastFired[actionKey] = now;
        hold.locked = true;
        return { progress: 100, fired: true, locked: true };
      }
    }

    return { progress, fired: false, locked: false };
  }

  _buildReport({ mode, state, action, level, hand, isLocked = false, holdProgress = 0 }) {
    return {
      mode,
      state,
      action,
      level,
      hand,
      isLocked,
      holdProgress,
      systemWide: this.config.systemWideEnabled,
    };
  }
}
