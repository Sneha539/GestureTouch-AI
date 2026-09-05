import { useRef, useEffect, useState, useCallback } from 'react';
import './App.css';
import {
  smoothLandmarks,
  getPalmCenter,
  detectPinch,
  detectSwipe,
  classifyPose,
  classifySingleHand,
  classifyTwoHands,
  getFingerStates,
  getVolumeFromIndex,
  FIST_HOLD_MS,
  PEACE_HOLD_MS,
  CMD_COOLDOWN_MS,
  VOL_THROTTLE_MS,
  GESTURE_CONFIDENCE_THRESHOLD,
  GESTURE_HOLD_DURATION,
  ACTION_COOLDOWN_MS,
} from './gestureEngine';
import { useSystemBridge } from './useSystemBridge';

// ─── Constants ────────────────────────────────────────────────────────────────
const SWIPE_HISTORY_LEN   = 10;
const SWIPE_COOLDOWN_MS   = 650;
const MAX_LOG_ENTRIES     = 4;
const EMA_ALPHA           = 0.55;
const GRAB_CONFIRM_FRAMES = 5;
const GRAB_PICK_RADIUS_PX = 130;

// ─── Gesture metadata — covers all 13 single-hand + NONE + combos ─────────────
const GESTURE_META = {
  PINCH:            { emoji: '🤌', label: 'Pinch',        sub: 'Thumb + Index close' },
  PEACE:            { emoji: '✌️', label: 'Peace',        sub: 'Hold 1.2s → Spotify' },
  FIST:             { emoji: '✊', label: 'Fist',          sub: 'Hold 1.5s → Chrome' },
  OPEN_PALM:        { emoji: '🖐️', label: 'Open Palm',    sub: 'All fingers extended' },
  OPEN_HAND:        { emoji: '🖐️', label: 'Open Palm',    sub: 'All fingers extended' },
  POINT:            { emoji: '☝️', label: 'Point',        sub: 'Move up/down → Volume' },
  THUMBS_UP:        { emoji: '👍', label: 'Thumbs Up',    sub: 'Confirm / select' },
  THUMBS_DOWN:      { emoji: '👎', label: 'Thumbs Down',  sub: 'Cancel / back' },
  OK:               { emoji: '👌', label: 'OK Sign',      sub: 'Pinch + 3 extended' },
  ROCK:             { emoji: '🤘', label: 'Rock',         sub: 'Index + Pinky' },
  CALL_ME:          { emoji: '🤙', label: 'Call Me',      sub: 'Thumb + Pinky' },
  THREE:            { emoji: '🤟', label: 'Three',        sub: 'Index + Middle + Ring' },
  FOUR:             { emoji: '🖖', label: 'Four',         sub: '4 fingers extended' },
  PINKY:            { emoji: '🤙', label: 'Pinky',        sub: 'Pinky extended' },
  CUSTOM:           { emoji: '✦',  label: 'Custom',       sub: 'Mixed pose' },
  NONE:             { emoji: '—',  label: 'No Hand',      sub: 'Move hand into view' },
  DOUBLE_THUMBS_UP: { emoji: '👍👍', label: 'Double Thumbs Up', sub: 'Hold 1.5s → Excel' },
  DOUBLE_PEACE:     { emoji: '✌✌',  label: 'Double Peace',     sub: 'Hold 1.5s → PowerPoint' },
  DOUBLE_FIST:      { emoji: '✊✊',  label: 'Double Fist',      sub: 'Both fists' },
  DOUBLE_OPEN_PALM: { emoji: '🖐🖐', label: 'Both Palms',       sub: 'Both palms open' },
  FIST_PALM:        { emoji: '✊🖐', label: 'Fist + Palm',      sub: 'Mixed combo' },
  PEACE_THUMBS:     { emoji: '✌👍', label: 'Peace + Thumbs',   sub: 'Mixed combo' },
};

const SWIPE_ICONS = { LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓' };

const ACTION_META = {
  open_spotify:    { emoji: '🎵', label: 'Spotify opened' },
  open_chrome:     { emoji: '🌐', label: 'Chrome opened' },
  open_excel:      { emoji: '📊', label: 'Excel opened' },
  open_powerpoint: { emoji: '📊', label: 'PowerPoint opened' },
  set_volume:      { emoji: '🔊', label: 'Volume set' },
};

// ─── Centralized Gesture → Action Map ─────────────────────────────────────────
// Keys match gesture strings returned by classifySingleHand / classifyTwoHands.
// Each entry has: label, emoji, hint, holdMs, fire(sendCommand, wsOpen)
const buildGestureActions = (sendCommand) => ({
  // Two-hand combos (highest priority)
  DOUBLE_THUMBS_UP: {
    label:  'Open Excel',
    emoji:  '📊',
    hint:   'Both Thumbs Up · Hold 1.5s',
    holdMs: GESTURE_HOLD_DURATION,
    fire:   (wsOpen) => {
      window.open('https://excel.new', '_blank', 'noopener');
      if (wsOpen) sendCommand('open_excel');
      return 'open_excel';
    },
  },
  DOUBLE_PEACE: {
    label:  'Open PowerPoint',
    emoji:  '📊',
    hint:   'Both Peace · Hold 1.5s',
    holdMs: GESTURE_HOLD_DURATION,
    fire:   (wsOpen) => {
      window.open('https://powerpoint.new', '_blank', 'noopener');
      if (wsOpen) sendCommand('open_powerpoint');
      return 'open_powerpoint';
    },
  },
  // Single-hand actions
  PEACE: {
    label:  'Open Spotify',
    emoji:  '🎵',
    hint:   'Peace · Hold 1.2s',
    holdMs: PEACE_HOLD_MS,
    fire:   (wsOpen) => { if (wsOpen) sendCommand('open_spotify'); return 'open_spotify'; },
  },
  FIST: {
    label:  'Open Chrome',
    emoji:  '🌐',
    hint:   'Fist · Hold 1.5s',
    holdMs: FIST_HOLD_MS,
    fire:   (wsOpen) => { if (wsOpen) sendCommand('open_chrome'); return 'open_chrome'; },
  },
});

// ─── Kanban tiles ─────────────────────────────────────────────────────────────
const INIT_TILES = [
  { id: 'A', label: 'Patient Scan',    sub: 'Pending review', col: 0 },
  { id: 'B', label: 'Med Records',     sub: 'Updated today',  col: 0 },
  { id: 'C', label: 'Blood Panel',     sub: 'Processing',     col: 1 },
  { id: 'D', label: 'MRI Report',      sub: 'In progress',    col: 1 },
  { id: 'E', label: 'Discharge Notes', sub: 'Complete',       col: 2 },
  { id: 'F', label: 'Vitals Check',    sub: 'Scheduled',      col: 0 },
];

const COLS = [
  { label: 'Queue',       color: '#5F646B' },
  { label: 'In Progress', color: '#F0A429' },
  { label: 'Done',        color: '#3DD68C' },
];

// ─── Landmark drawing ─────────────────────────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

/**
 * Draw landmarks for a single hand on ctx.
 * Does NOT clearRect — caller handles clearing once per frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} lm         - 21-point landmark array
 * @param {boolean} isGrabbing
 * @param {boolean} isPointing
 * @param {number|null} volume
 * @param {'left'|'right'} side - controls color tint
 */
function drawHandLandmarks(ctx, lm, isGrabbing, isPointing, volume, side = 'right') {
  if (!ctx || !lm) return;

  const px = (l) => (1 - l.x) * ctx.canvas.width;
  const py = (l) => l.y * ctx.canvas.height;

  // Right hand: classic blue. Left hand: teal-shifted blue.
  const baseColor = side === 'left'
    ? { r: 76, g: 200, b: 220 }
    : { r: 76, g: 141, b: 255 };

  const lineColor = isGrabbing
    ? 'rgba(255,122,69,0.85)'
    : isPointing
    ? `rgba(${baseColor.r},${baseColor.g},${baseColor.b},0.9)`
    : `rgba(${baseColor.r},${baseColor.g},${baseColor.b},0.55)`;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = lineColor;
  CONNECTIONS.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(px(lm[a]), py(lm[a]));
    ctx.lineTo(px(lm[b]), py(lm[b]));
    ctx.stroke();
  });

  lm.forEach((l, i) => {
    const isTip     = [4, 8, 12, 16, 20].includes(i);
    const isIndexTip = i === 8;
    ctx.beginPath();
    ctx.arc(px(l), py(l), isTip ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isIndexTip && isPointing ? '#FF7A45'
                  : isTip && isGrabbing      ? '#FF7A45'
                  : isTip                    ? `rgba(${baseColor.r},${baseColor.g},${baseColor.b},1)`
                  : `rgba(${baseColor.r},${baseColor.g},${baseColor.b},0.4)`;
    ctx.fill();
    if (isTip) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = isGrabbing
        ? 'rgba(255,122,69,0.6)'
        : `rgba(${baseColor.r},${baseColor.g},${baseColor.b},0.6)`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });

  // Volume guide line when pointing (right hand only)
  if (isPointing && volume !== null && side === 'right') {
    const tipX = px(lm[8]);
    const tipY = py(lm[8]);
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(255,122,69,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX, ctx.canvas.height * 0.85);
    ctx.stroke();
    ctx.restore();
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.fillStyle = '#FF7A45';
    ctx.fillText(`${volume}%`, tipX + 10, tipY - 8);
  }
}

/**
 * Main canvas drawing function — clears and draws all detected hands.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} handsData - [{ lm, isGrabbing, isPointing, volume, side }]
 */
function drawAllHands(ctx, handsData) {
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const h of handsData) {
    drawHandLandmarks(ctx, h.lm, h.isGrabbing, h.isPointing, h.volume, h.side);
  }
}

// Backward-compatible single-hand wrapper
function drawLandmarks(ctx, lm, isGrabbing, isPointing, volume) {
  if (!ctx || !lm) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawHandLandmarks(ctx, lm, isGrabbing, isPointing, volume, 'right');
}

// ─── Hero: Two-hand constellation ─────────────────────────────────────────────
// Primary hand points (open right hand, palm facing camera)
const HAND_POINTS = [
  { x: 0.50, y: 0.88 },  // 0 WRIST
  { x: 0.36, y: 0.75 },  // 1 THUMB_CMC
  { x: 0.26, y: 0.64 },  // 2
  { x: 0.18, y: 0.55 },  // 3
  { x: 0.11, y: 0.45 },  // 4 THUMB_TIP
  { x: 0.42, y: 0.60 },  // 5 INDEX_MCP
  { x: 0.40, y: 0.44 },  // 6
  { x: 0.40, y: 0.31 },  // 7
  { x: 0.40, y: 0.18 },  // 8 INDEX_TIP
  { x: 0.52, y: 0.57 },  // 9 MIDDLE_MCP
  { x: 0.52, y: 0.40 },  // 10
  { x: 0.52, y: 0.26 },  // 11
  { x: 0.52, y: 0.13 },  // 12 MIDDLE_TIP
  { x: 0.62, y: 0.59 },  // 13 RING_MCP
  { x: 0.63, y: 0.43 },  // 14
  { x: 0.63, y: 0.29 },  // 15
  { x: 0.63, y: 0.17 },  // 16 RING_TIP
  { x: 0.71, y: 0.63 },  // 17 PINKY_MCP
  { x: 0.73, y: 0.50 },  // 18
  { x: 0.74, y: 0.38 },  // 19
  { x: 0.75, y: 0.27 },  // 20 PINKY_TIP
];

// Second hand: mirrored + horizontally offset for two-hand visual
const HAND_POINTS_LEFT = HAND_POINTS.map(pt => ({
  x: (1 - pt.x) * 0.75 + 0.60,  // mirror and push right
  y: pt.y + 0.04,                 // slight vertical offset
}));

const TIP_INDICES = new Set([4, 8, 12, 16, 20]);

// ─── Constellation component ───────────────────────────────────────────────────
function HandConstellation({ parallaxRef }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const handleMouse = (e) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const dx = (e.clientX - cx) / cx;
      const dy = (e.clientY - cy) / cy;
      svg.style.transform = `translate(${dx * -8}px, ${dy * -6}px)`;
    };

    window.addEventListener('mousemove', handleMouse, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouse);
  }, []);

  const W = 420;
  const H = 400;
  const toSVG = (pt) => ({ x: pt.x * W, y: pt.y * H });

  return (
    <div className="constellation-wrap" ref={parallaxRef}>
      <div className="constellation-corner tl" />
      <div className="constellation-corner tr" />
      <div className="constellation-corner bl" />
      <div className="constellation-corner br" />

      <svg
        ref={svgRef}
        className="constellation-svg"
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden="true"
        style={{ transition: 'transform 0.12s ease-out', willChange: 'transform' }}
      >
        {/* ── Second hand (left, ghost) ── */}
        {CONNECTIONS.map(([a, b], idx) => {
          const pa = toSVG(HAND_POINTS_LEFT[a]);
          const pb = toSVG(HAND_POINTS_LEFT[b]);
          return (
            <line
              key={`l2-${idx}`}
              className="c-line c-line-secondary"
              x1={pa.x} y1={pa.y}
              x2={pb.x} y2={pb.y}
            />
          );
        })}
        {HAND_POINTS_LEFT.map((pt, i) => {
          const { x, y } = toSVG(pt);
          const isTip = TIP_INDICES.has(i);
          return (
            <circle
              key={`ld-${i}`}
              className={`c-dot c-dot-secondary${isTip ? ' tip' : ''}`}
              cx={x}
              cy={y}
              r={isTip ? 3.5 : 2}
            />
          );
        })}

        {/* ── Primary hand (right) ── */}
        {CONNECTIONS.map(([a, b], idx) => {
          const pa = toSVG(HAND_POINTS[a]);
          const pb = toSVG(HAND_POINTS[b]);
          const isPalm = (a >= 5 && b >= 5 && a <= 17 && b <= 17 && Math.abs(a - b) > 2);
          return (
            <line
              key={idx}
              className={`c-line ${isPalm ? 'palm' : ''}`}
              x1={pa.x} y1={pa.y}
              x2={pb.x} y2={pb.y}
            />
          );
        })}
        {HAND_POINTS.map((pt, i) => {
          const { x, y } = toSVG(pt);
          const isTip = TIP_INDICES.has(i);
          const isWrist = i === 0;
          return (
            <circle
              key={i}
              className={`c-dot${isTip ? ' tip' : ''}${isWrist ? ' wrist' : ''}`}
              cx={x}
              cy={y}
              r={isTip ? 4.5 : isWrist ? 4 : 2.5}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ─── Hero screen ───────────────────────────────────────────────────────────────
function HeroScreen({ fps, camActive, onLaunch }) {
  const [gesturesOpen, setGesturesOpen] = useState(false);
  const parallaxRef = useRef(null);

  const landmarkCount = camActive && fps > 0 ? 'up to 42' : '42';
  const statusText = camActive && fps > 0
    ? `dual-hand tracking · ${landmarkCount} landmarks · ${fps} fps · READY`
    : camActive
    ? `model loading · camera active · standby`
    : `camera idle · awaiting launch`;

  return (
    <div className="hero">
      {/* ── Navigation ── */}
      <nav className="hero-nav" aria-label="Main navigation">
        <a className="hero-nav-logo" href="#" id="hero-logo">
          <div className="hero-nav-logo-mark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
              <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
              <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
              <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
            </svg>
          </div>
          <span className="hero-nav-logo-text">GestureTouch-AI</span>
        </a>

        <div className="hero-nav-links" role="navigation">
          <a href="#gestures" className="hero-nav-link" id="nav-link-gestures">Gestures</a>
          <a href="#how-it-works" className="hero-nav-link" id="nav-link-how">How it works</a>
          <a href="#technology" className="hero-nav-link" id="nav-link-tech">Technology</a>
          <a
            href="https://github.com"
            className="hero-nav-link"
            id="nav-link-github"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <button
            className="hero-nav-cta"
            onClick={onLaunch}
            id="nav-launch-btn"
            aria-label="Launch the gesture tracking application"
          >
            Launch App →
          </button>
        </div>
      </nav>

      {/* ── Body ── */}
      <div className="hero-body">

        {/* Left: content */}
        <div className="hero-content">

          <div className="hero-micro-label" aria-label="System identifier">
            [ DUAL-HAND TRACKING / REAL-TIME CV ]
          </div>

          <h1 className="hero-headline">
            See the gesture.<br />
            Skip the touch.
          </h1>

          <p className="hero-description">
            Real-time two-hand tracking that turns natural gestures into touch-free controls. Up to 42 landmarks. Zero hardware.
          </p>

          {/* Terminal status */}
          <div
            className="hero-terminal"
            role="status"
            aria-live="polite"
            aria-label="System status"
            id="hero-terminal"
          >
            <span className="hero-terminal-prompt">&gt;</span>
            <span className="hero-terminal-text" id="hero-terminal-text">
              {statusText}
            </span>
            <span className="hero-terminal-cursor" aria-hidden="true" />
          </div>

          {/* CTAs */}
          <div className="hero-cta-row">
            <button
              className="btn btn-primary"
              onClick={onLaunch}
              id="hero-launch-btn"
              aria-label="Launch the gesture tracking application"
            >
              Launch App →
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setGesturesOpen(o => !o)}
              id="hero-gestures-btn"
              aria-expanded={gesturesOpen}
              aria-controls="hero-gestures-reveal"
            >
              {gesturesOpen ? 'Hide gestures' : 'See supported gestures'}
            </button>
          </div>

          {/* Gestures reveal */}
          <div
            id="hero-gestures-reveal"
            className={`hero-gestures-reveal ${gesturesOpen ? 'open' : ''}`}
            aria-hidden={!gesturesOpen}
          >
            <div className="hero-gestures-label">[ SUPPORTED GESTURES ]</div>
            <div className="hero-gestures-list">
              {[
                ['🤌', 'Pinch'],
                ['✌️', 'Peace'],
                ['✊', 'Fist'],
                ['🖐️', 'Open Palm'],
                ['☝️', 'Point'],
                ['👍', 'Thumbs Up'],
                ['👎', 'Thumbs Down'],
                ['👌', 'OK'],
                ['🤘', 'Rock'],
                ['🤙', 'Call Me'],
                ['🤟', 'Three'],
                ['🖖', 'Four'],
                ['👍👍', 'Double Thumbs'],
                ['✌✌', 'Double Peace'],
              ].map(([emoji, name]) => (
                <div key={name} className="hero-gesture-chip" id={`gesture-chip-${name.toLowerCase().replace(/ /g, '-')}`}>
                  <span aria-hidden="true">{emoji}</span>
                  {name}
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="hero-stats" id="hero-stats" role="list" aria-label="Technical specifications">
            <div className="hero-stat" role="listitem">
              <span className="hero-stat-value">42</span>
              <span className="hero-stat-label">Max Landmarks</span>
            </div>
            <div className="hero-stat" role="listitem">
              <span className="hero-stat-value">13+</span>
              <span className="hero-stat-label">Gestures</span>
            </div>
            <div className="hero-stat" role="listitem">
              <span className="hero-stat-value">2</span>
              <span className="hero-stat-label">Hands</span>
            </div>
            <div className="hero-stat" role="listitem">
              <span className="hero-stat-value" style={{ fontSize: '1rem', paddingTop: '0.2rem' }}>MediaPipe</span>
              <span className="hero-stat-label">Engine</span>
            </div>
          </div>

          {/* Built with */}
          <div className="hero-built-with" id="hero-built-with" aria-label="Built with">
            BUILT WITH &nbsp;
            <span>MediaPipe Hands · React · Vite</span>
          </div>

        </div>

        {/* Right: constellation */}
        <div className="hero-visual" aria-hidden="true">
          <HandConstellation parallaxRef={parallaxRef} />
        </div>

      </div>
    </div>
  );
}

// ─── Hand Section sub-component ───────────────────────────────────────────────
function HandSection({ side, detected, gesture, confidence }) {
  const meta = GESTURE_META[gesture] || GESTURE_META.NONE;
  return (
    <div className={`hand-section ${detected ? 'detected' : ''}`} id={`hand-section-${side}`}>
      <div className="hand-section-label">
        <span className={`status-dot ${detected ? 'active' : ''}`} aria-hidden="true" />
        {side.toUpperCase()} HAND
      </div>
      <div className="hand-section-gesture" aria-live="polite">
        {detected ? meta.label.toUpperCase() : '—'}
      </div>
      {detected && (
        <div className="hand-section-conf">
          CONF {Math.round(confidence * 100)}%
          <div className="hand-conf-bar">
            <div className="hand-conf-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const videoPanelRef = useRef(null);
  const handsRef      = useRef(null);
  const rafRef        = useRef(null);
  const processingRef = useRef(false);

  // ── Per-hand smoothed landmark refs ──────────────────────────────────────
  const smoothedLeftRef  = useRef(null);
  const smoothedRightRef = useRef(null);
  const wasPinchedLeftRef  = useRef(false);
  const wasPinchedRightRef = useRef(false);

  // ── Legacy single-hand refs (for existing drag/swipe/volume) ─────────────
  const palmHistoryRef  = useRef([]);
  const lastSwipeRef    = useRef(0);
  const fpsRef          = useRef({ frames: 0, last: performance.now() });
  const grabFramesRef   = useRef(0);
  const dragRef         = useRef({ active: false, tileId: null });

  // ── Hold system refs (centralized) ────────────────────────────────────────
  const holdRef = useRef({
    gesture:    null,    // gesture key being held
    startTime:  null,    // timestamp when hold started
    locked:     false,   // true after action fires, prevents re-fire
    lastFired:  {},      // { gestureKey: timestamp } — per-gesture cooldown
  });

  // ── Legacy hold refs (kept for backward compat display logic) ─────────────
  const fistHoldStartRef  = useRef(null);
  const peaceHoldStartRef = useRef(null);
  const lastCmdTimeRef    = useRef({});
  const lastVolSentRef    = useRef(0);

  // ── React state ───────────────────────────────────────────────────────────
  const [screen,       setScreen]       = useState('hero');
  const [camActive,    setCamActive]    = useState(false);
  const [camError,     setCamError]     = useState(null);

  // Primary (single-hand) gesture state — used for Kanban & volume (backward compat)
  const [gesture,      setGesture]      = useState('NONE');
  const [prevGesture,  setPrevGesture]  = useState('NONE');
  const [pinchStr,     setPinchStr]     = useState(0);
  const [isPinched,    setIsPinched]    = useState(false);

  // Two-hand state
  const [leftHand,     setLeftHand]     = useState({ detected: false, gesture: 'NONE', confidence: 0 });
  const [rightHand,    setRightHand]    = useState({ detected: false, gesture: 'NONE', confidence: 0 });
  const [comboGesture, setComboGesture] = useState(null);   // combined gesture string or null

  // Hold progress
  const [holdState,    setHoldState]    = useState({ gesture: null, progress: 0, locked: false, actionLabel: '' });

  // Misc
  const [fps,          setFps]          = useState(0);
  const [handCount,    setHandCount]    = useState(0);
  const [swipeLog,     setSwipeLog]     = useState([]);
  const [tiles,        setTiles]        = useState(INIT_TILES);
  const [dragState,    setDragState]    = useState({ active: false, tileId: null, x: 0, y: 0 });
  const [hoverCol,     setHoverCol]     = useState(null);
  const [volume,       setVolume]       = useState(null);
  const [fistProg,     setFistProg]     = useState(0);
  const [peaceProg,    setPeaceProg]    = useState(0);
  const [sentAction,   setSentAction]   = useState(null);
  const [gestureFlash, setGestureFlash] = useState(false);

  // System bridge
  const { wsStatus, lastAction, sendCommand } = useSystemBridge();
  const isBridgeUp = wsStatus === 'connected';

  // Gesture actions (memoized so sendCommand reference is stable)
  const gestureActionsRef = useRef(null);
  useEffect(() => {
    gestureActionsRef.current = buildGestureActions(sendCommand);
  }, [sendCommand]);

  // ── FPS ───────────────────────────────────────────────────────────────────
  const tickFps = useCallback(() => {
    const f = fpsRef.current;
    f.frames++;
    const now = performance.now();
    if (now - f.last >= 500) {
      setFps(Math.round(f.frames / ((now - f.last) / 1000)));
      f.frames = 0;
      f.last = now;
    }
  }, []);

  // ── Per-frame handler ─────────────────────────────────────────────────────
  const onResults = useCallback((results) => {
    tickFps();

    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video) return;

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');

    const multiHands     = results.multiHandLandmarks  || [];
    const multiHandedness = results.multiHandedness    || [];
    const count = multiHands.length;
    setHandCount(count);

    // ── Reset when no hands ──────────────────────────────────────────────
    if (!count) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      smoothedLeftRef.current  = null;
      smoothedRightRef.current = null;
      wasPinchedLeftRef.current  = false;
      wasPinchedRightRef.current = false;
      palmHistoryRef.current = [];
      grabFramesRef.current  = 0;
      fistHoldStartRef.current  = null;
      peaceHoldStartRef.current = null;

      if (dragRef.current.active) {
        dragRef.current = { active: false, tileId: null };
        setDragState({ active: false, tileId: null, x: 0, y: 0 });
        setHoverCol(null);
      }

      setGesture('NONE');
      setPinchStr(0);
      setIsPinched(false);
      setVolume(null);
      setFistProg(0);
      setPeaceProg(0);
      setLeftHand({ detected: false, gesture: 'NONE', confidence: 0 });
      setRightHand({ detected: false, gesture: 'NONE', confidence: 0 });
      setComboGesture(null);

      // Reset hold system
      holdRef.current.gesture   = null;
      holdRef.current.startTime = null;
      holdRef.current.locked    = false;
      setHoldState({ gesture: null, progress: 0, locked: false, actionLabel: '' });
      return;
    }

    // ── Parse hands — assign left/right from MediaPipe handedness ───────
    // MediaPipe label is from the model's perspective (front camera = mirrored).
    // We store as-is. UI labels match what MediaPipe reports.
    let leftLm = null, rightLm = null;
    let leftConf = 0, rightConf = 0;

    for (let i = 0; i < count; i++) {
      const rawLabel = multiHandedness[i]?.label ?? 'Right';
      const score    = multiHandedness[i]?.score  ?? 0.9;
      const rawLm    = multiHands[i];

      if (rawLabel === 'Left') {
        leftLm   = rawLm;
        leftConf = score;
      } else {
        rightLm   = rawLm;
        rightConf = score;
      }
    }

    // ── Smooth landmarks independently per hand ───────────────────────────
    if (leftLm) {
      smoothedLeftRef.current = smoothLandmarks(smoothedLeftRef.current, leftLm, EMA_ALPHA);
    } else {
      smoothedLeftRef.current  = null;
      wasPinchedLeftRef.current = false;
    }
    if (rightLm) {
      smoothedRightRef.current = smoothLandmarks(smoothedRightRef.current, rightLm, EMA_ALPHA);
    } else {
      smoothedRightRef.current  = null;
      wasPinchedRightRef.current = false;
    }

    const leftSmoothed  = smoothedLeftRef.current;
    const rightSmoothed = smoothedRightRef.current;

    // ── Classify each hand ────────────────────────────────────────────────
    let leftResult  = { gesture: 'NONE', confidence: 0, pinchInfo: { pinched: false, strength: 0 } };
    let rightResult = { gesture: 'NONE', confidence: 0, pinchInfo: { pinched: false, strength: 0 } };

    if (leftSmoothed) {
      leftResult = classifySingleHand(leftSmoothed, wasPinchedLeftRef.current);
      wasPinchedLeftRef.current = leftResult.pinchInfo.pinched;
    }
    if (rightSmoothed) {
      rightResult = classifySingleHand(rightSmoothed, wasPinchedRightRef.current);
      wasPinchedRightRef.current = rightResult.pinchInfo.pinched;
    }

    // ── Update per-hand state ─────────────────────────────────────────────
    setLeftHand({
      detected:   !!leftSmoothed,
      gesture:    leftResult.gesture,
      confidence: leftResult.confidence,
    });
    setRightHand({
      detected:   !!rightSmoothed,
      gesture:    rightResult.gesture,
      confidence: rightResult.confidence,
    });

    // ── Two-hand combo classification ─────────────────────────────────────
    let combo = null;
    if (leftSmoothed && rightSmoothed) {
      const { combo: c, confidence: cc } = classifyTwoHands(
        leftResult.gesture, rightResult.gesture,
        leftResult.confidence, rightResult.confidence
      );
      combo = c;
      if (c) setComboGesture(c);
      else    setComboGesture(null);
    } else {
      setComboGesture(null);
    }

    // ── Primary hand logic (for backward-compat: drag, volume, swipe) ────
    // Use right hand if present, otherwise left. Mirrors previous single-hand behavior.
    const primaryLm     = rightSmoothed || leftSmoothed;
    const primaryResult = rightSmoothed ? rightResult : leftResult;
    const primarySide   = rightSmoothed ? 'right' : 'left';

    const isFist     = primaryResult.gesture === 'FIST';
    const isPointing = primaryResult.gesture === 'POINT';
    const currentVol = isPointing ? getVolumeFromIndex(primaryLm) : null;

    // ── Draw all hands ────────────────────────────────────────────────────
    const handsDrawData = [];
    if (leftSmoothed) {
      handsDrawData.push({
        lm: leftSmoothed, isGrabbing: false,
        isPointing: leftResult.gesture === 'POINT',
        volume: null, side: 'left',
      });
    }
    if (rightSmoothed) {
      handsDrawData.push({
        lm: rightSmoothed,
        isGrabbing: dragRef.current.active || isFist,
        isPointing,
        volume: currentVol, side: 'right',
      });
    }
    drawAllHands(ctx, handsDrawData);

    // ── Update primary gesture state ──────────────────────────────────────
    setPinchStr(primaryResult.pinchInfo.strength);
    setIsPinched(primaryResult.pinchInfo.pinched);
    setGesture(prev => {
      const newGesture = combo || primaryResult.gesture;
      if (prev !== newGesture) {
        setPrevGesture(prev);
        setGestureFlash(true);
        setTimeout(() => setGestureFlash(false), 350);
      }
      return newGesture;
    });

    // ── Palm → screen coords (primary hand) ──────────────────────────────
    const palm    = getPalmCenter(primaryLm);
    const panelEl = videoPanelRef.current;
    let screenX = 0, screenY = 0;
    if (panelEl) {
      const rect = panelEl.getBoundingClientRect();
      screenX = rect.left + (1 - palm.x) * rect.width;
      screenY = rect.top  + palm.y * rect.height;
    }

    const now = Date.now();

    // ═════════════════════════════════════════════════════════════════════
    // CENTRALIZED HOLD-TO-ACTIVATE SYSTEM
    // ═════════════════════════════════════════════════════════════════════

    const activeGestureKey = combo || primaryResult.gesture;
    const activeConf       = combo
      ? Math.min(leftResult.confidence, rightResult.confidence)
      : primaryResult.confidence;

    const actions   = gestureActionsRef.current;
    const actionDef = actions ? actions[activeGestureKey] : null;

    if (
      actionDef &&
      activeConf >= GESTURE_CONFIDENCE_THRESHOLD &&
      !dragRef.current.active    // don't trigger during kanban drag
    ) {
      const hold = holdRef.current;

      // If gesture changed, reset hold
      if (hold.gesture !== activeGestureKey) {
        hold.gesture   = activeGestureKey;
        hold.startTime = now;
        hold.locked    = false;
      }

      if (!hold.locked && hold.startTime !== null) {
        const elapsed  = now - hold.startTime;
        const holdMs   = actionDef.holdMs ?? GESTURE_HOLD_DURATION;
        const progress = Math.min(100, (elapsed / holdMs) * 100);

        setHoldState({
          gesture:     activeGestureKey,
          progress,
          locked:      false,
          actionLabel: actionDef.label,
        });

        if (elapsed >= holdMs) {
          const lastFired = hold.lastFired[activeGestureKey] ?? 0;
          if (now - lastFired > ACTION_COOLDOWN_MS) {
            // Fire the action
            const actionKey = actionDef.fire(isBridgeUp);
            hold.lastFired[activeGestureKey] = now;
            hold.locked    = true;
            hold.startTime = null;

            setSentAction({
              action: actionKey,
              time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            });
            setHoldState({ gesture: activeGestureKey, progress: 100, locked: true, actionLabel: actionDef.label });
          }
        }
      }
    } else {
      // Gesture not in action map, or confidence too low — reset hold
      if (holdRef.current.gesture !== null) {
        holdRef.current.gesture   = null;
        holdRef.current.startTime = null;
        holdRef.current.locked    = false;
        setHoldState({ gesture: null, progress: 0, locked: false, actionLabel: '' });
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // LEGACY HOLD TRACKERS (for the side panel progress bars: fistProg, peaceProg)
    // These maintain backward compatibility with the OS Control panel display.
    // ═════════════════════════════════════════════════════════════════════

    if (primaryResult.gesture === 'POINT') {
      const vol = getVolumeFromIndex(primaryLm);
      setVolume(vol);
      if (now - lastVolSentRef.current > VOL_THROTTLE_MS) {
        sendCommand('set_volume', { level: vol });
        lastVolSentRef.current = now;
      }
      fistHoldStartRef.current  = null;
      peaceHoldStartRef.current = null;
      setFistProg(0);
      setPeaceProg(0);
    } else {
      setVolume(null);
    }

    if (primaryResult.gesture === 'PEACE') {
      if (!peaceHoldStartRef.current) peaceHoldStartRef.current = now;
      const held     = now - peaceHoldStartRef.current;
      const progress = Math.min(100, (held / PEACE_HOLD_MS) * 100);
      setPeaceProg(progress);
      fistHoldStartRef.current = null;
      setFistProg(0);
    } else {
      peaceHoldStartRef.current = null;
      setPeaceProg(0);
    }

    if (isFist && !dragRef.current.active) {
      if (!fistHoldStartRef.current) fistHoldStartRef.current = now;
      const held     = now - fistHoldStartRef.current;
      const progress = Math.min(100, (held / FIST_HOLD_MS) * 100);
      setFistProg(progress);
    } else if (!isFist || dragRef.current.active) {
      fistHoldStartRef.current = null;
      setFistProg(0);
    }

    // ═════════════════════════════════════════════════════════════════════
    // DRAG & DROP (primary hand)
    // ═════════════════════════════════════════════════════════════════════

    if (isFist) {
      grabFramesRef.current = Math.min(grabFramesRef.current + 1, GRAB_CONFIRM_FRAMES + 10);
    } else {
      grabFramesRef.current = 0;
    }

    const confirmed = grabFramesRef.current >= GRAB_CONFIRM_FRAMES;

    if (!dragRef.current.active && confirmed) {
      const tileEls = document.querySelectorAll('[data-tile-id]');
      let nearestId = null, nearestDist = Infinity;
      tileEls.forEach(el => {
        const r  = el.getBoundingClientRect();
        const cx = r.left + r.width  / 2;
        const cy = r.top  + r.height / 2;
        const d  = Math.hypot(screenX - cx, screenY - cy);
        if (d < nearestDist && d < GRAB_PICK_RADIUS_PX) { nearestDist = d; nearestId = el.dataset.tileId; }
      });
      if (nearestId) {
        dragRef.current = { active: true, tileId: nearestId };
        setDragState({ active: true, tileId: nearestId, x: screenX, y: screenY });
      }

    } else if (dragRef.current.active && isFist) {
      setDragState(prev => ({ ...prev, x: screenX, y: screenY }));
      let hoveredCol = null;
      document.querySelectorAll('[data-col-idx]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (screenX >= r.left && screenX <= r.right) hoveredCol = parseInt(el.dataset.colIdx);
      });
      setHoverCol(hoveredCol);

    } else if (dragRef.current.active && !isFist) {
      let targetCol = null;
      document.querySelectorAll('[data-col-idx]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (screenX >= r.left && screenX <= r.right) targetCol = parseInt(el.dataset.colIdx);
      });
      const droppedId = dragRef.current.tileId;
      dragRef.current = { active: false, tileId: null };
      setDragState({ active: false, tileId: null, x: 0, y: 0 });
      setHoverCol(null);
      if (targetCol !== null) setTiles(prev => prev.map(t => t.id === droppedId ? { ...t, col: targetCol } : t));
    }

    // ── Swipe ─────────────────────────────────────────────────────────────
    if (!dragRef.current.active && !isPointing) {
      palmHistoryRef.current.push({ x: palm.x, y: palm.y });
      if (palmHistoryRef.current.length > SWIPE_HISTORY_LEN) palmHistoryRef.current.shift();
      if (now - lastSwipeRef.current > SWIPE_COOLDOWN_MS) {
        const swipe = detectSwipe(palmHistoryRef.current);
        if (swipe) {
          lastSwipeRef.current = now;
          palmHistoryRef.current = [];
          const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
          setSwipeLog(prev => [{ swipe, timestamp: ts, id: now }, ...prev.slice(0, MAX_LOG_ENTRIES - 1)]);
        }
      }
    }
  }, [tickFps, sendCommand, isBridgeUp]);

  // ── MediaPipe init — direct RAF, no Camera util ──────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        let attempts = 0;
        while (!window.Hands && attempts++ < 30) await new Promise(r => setTimeout(r, 200));
        if (!window.Hands) throw new Error('MediaPipe failed to load from CDN');
        if (cancelled) return;

        const hands = new window.Hands({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        // ← KEY CHANGE: maxNumHands now 2
        hands.setOptions({
          maxNumHands: 2, modelComplexity: 0,
          minDetectionConfidence: 0.65, minTrackingConfidence: 0.55,
        });
        hands.onResults(onResults);
        handsRef.current = hands;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setCamActive(true);

        const loop = async () => {
          if (!cancelled) {
            if (video.readyState >= 2 && !processingRef.current) {
              processingRef.current = true;
              try { await hands.send({ image: video }); } catch {}
              finally { processingRef.current = false; }
            }
            rafRef.current = requestAnimationFrame(loop);
          }
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (!cancelled) { console.error(err); setCamError(err.message || 'Camera error'); }
      }
    }

    init();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      handsRef.current?.close();
      const v = videoRef.current;
      if (v?.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
    };
  }, [onResults]);

  // ── Screen transition ─────────────────────────────────────────────────────
  const handleLaunch = useCallback(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setScreen('app'); return; }
    setScreen('transitioning');
    setTimeout(() => setScreen('app'), 700);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  const displayGesture   = comboGesture || gesture;
  const meta             = GESTURE_META[displayGesture] || GESTURE_META.NONE;
  const draggedTile      = tiles.find(t => t.id === dragState.tileId);
  const displayedAction  = sentAction || lastAction;
  const actionMeta       = displayedAction ? ACTION_META[displayedAction.action] : null;
  const totalLandmarks   = handCount * 21;
  const gestureActions   = gestureActionsRef.current || {};

  return (
    <div className="app">

      {/* ── Transition overlay ── */}
      <div
        className={`transition-overlay ${screen === 'transitioning' ? 'active' : ''}`}
        aria-hidden="true"
      />

      {/* ── Screen 1: Hero ── */}
      {(screen === 'hero' || screen === 'transitioning') && (
        <HeroScreen fps={fps} camActive={camActive} onLaunch={handleLaunch} />
      )}

      {/* ── Screen 2: App ── */}
      <div
        className={`app-screen ${screen === 'app' ? 'visible' : ''}`}
        style={{ display: screen === 'hero' ? 'none' : 'flex' }}
        aria-hidden={screen !== 'app'}
      >

        {/* ── Nav ── */}
        <nav className="nav" aria-label="Application navigation">
          <button
            className="nav-logo"
            onClick={() => setScreen('hero')}
            id="nav-logo"
            aria-label="GestureTouch-AI — go back to home"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <div className="nav-logo-mark">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
                <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
                <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
              </svg>
            </div>
            <div className="nav-logo-text">
              <span className="nav-logo-name">GESTURETOUCH-AI</span>
              <span className="nav-logo-tag">[ DUAL-HAND TRACKING ]</span>
            </div>
          </button>

          <div className="nav-center-badges">
            <span className={`badge ${camActive ? 'active' : ''}`} id="cam-status-badge">
              <span className={`status-dot ${camActive ? 'active' : 'warning'}`} />
              {camActive ? 'Camera Active' : 'No Camera'}
            </span>
            <span className={`badge ${handCount === 2 ? 'active' : handCount === 1 ? 'accent' : ''}`} id="hand-count-badge-nav">
              <span className={`status-dot ${handCount > 0 ? 'active' : ''}`} aria-hidden="true" />
              {handCount} hand{handCount !== 1 ? 's' : ''}
            </span>
            <span className={`badge ${isBridgeUp ? 'active' : ''}`} id="bridge-status-badge">
              <span className={`status-dot ${isBridgeUp ? 'active' : 'error'}`} />
              {isBridgeUp ? 'Bridge Online' : wsStatus === 'connecting' ? 'Connecting…' : 'Bridge Offline'}
            </span>
          </div>

          <div className="nav-sys-state" aria-label="System state">
            <span className={`nav-sys-item ${camActive ? 'active' : ''}`} id="nav-model-state">
              MODEL: {camActive ? 'READY' : 'LOADING'}
            </span>
            <span className={`nav-sys-item ${camActive ? 'accent' : ''}`} id="nav-cam-state">
              CAMERA: {camActive ? 'ACTIVE' : 'INIT'}
            </span>
            {fps > 0 && (
              <span className="nav-sys-item accent" id="fps-nav-badge">
                {fps} FPS
              </span>
            )}
          </div>
        </nav>

        {/* ── Main grid ── */}
        <main className="main-grid">

          {/* ── Left column ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Camera */}
            <div className="video-panel" ref={videoPanelRef} id="video-panel">

              <div className="reticle-tr" aria-hidden="true" />
              <div className="reticle-bl" aria-hidden="true" />

              {camActive && (
                <div className="video-label" id="video-label">
                  <span className="status-dot active" aria-hidden="true" />
                  LIVE · 640P · {handCount > 0 ? `${handCount} HAND${handCount > 1 ? 'S' : ''}` : 'NO HANDS'}
                </div>
              )}
              {camActive && <div className="fps-badge" id="fps-badge">{fps}</div>}

              {/* Volume HUD overlay */}
              {volume !== null && (
                <div className="vol-hud" id="vol-hud" role="status" aria-label={`Volume: ${volume}%`}>
                  <div className="vol-hud-track">
                    <div className="vol-hud-fill" style={{ height: `${volume}%` }} />
                  </div>
                  <span className="vol-hud-label">{volume}%</span>
                </div>
              )}

              {/* Hold progress HUD — centralized new system */}
              {holdState.gesture && !holdState.locked && holdState.progress > 0 && (
                <div className="hold-hud" id="hold-hud" role="status">
                  <div className="hold-hud-label">
                    HOLD · {holdState.actionLabel.toUpperCase()}
                  </div>
                  <div className="hold-bar-track">
                    <div
                      className="hold-bar-fill"
                      style={{ width: `${holdState.progress}%` }}
                    />
                  </div>
                  <div className="hold-hud-time">
                    {((holdState.progress / 100) * (gestureActions[holdState.gesture]?.holdMs ?? GESTURE_HOLD_DURATION) / 1000).toFixed(1)}s
                    {' / '}
                    {((gestureActions[holdState.gesture]?.holdMs ?? GESTURE_HOLD_DURATION) / 1000).toFixed(1)}s
                  </div>
                </div>
              )}

              {/* Fired confirmation */}
              {holdState.locked && (
                <div className="hold-hud hold-hud-fired" id="hold-hud-fired" role="status">
                  <div className="hold-hud-label">✓ {holdState.actionLabel.toUpperCase()}</div>
                </div>
              )}

              {/* Legacy hold HUD for Spotify/Chrome (fistProg/peaceProg pathway — kept for compat) */}
              {!holdState.gesture && (fistProg > 0 || peaceProg > 0) && (
                <div className="hold-hud hold-hud-legacy" id="hold-hud-legacy" role="status">
                  <div className="hold-hud-label">
                    {fistProg > 0 ? 'CHROME HOLD' : 'SPOTIFY HOLD'}
                  </div>
                  <div className="hold-bar-track">
                    <div
                      className="hold-bar-fill"
                      style={{ width: `${fistProg > 0 ? fistProg : peaceProg}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Grab cursor */}
              <div
                id="grab-cursor"
                className={`grab-cursor ${dragState.active ? 'grabbing' : ''}`}
                aria-hidden="true"
                style={{
                  display: camActive && handCount > 0 ? 'block' : 'none',
                  left: dragState.active ? `${((dragState.x - (videoPanelRef.current?.getBoundingClientRect().left ?? 0)) / (videoPanelRef.current?.getBoundingClientRect().width ?? 1)) * 100}%` : '50%',
                  top:  dragState.active ? `${((dragState.y - (videoPanelRef.current?.getBoundingClientRect().top  ?? 0)) / (videoPanelRef.current?.getBoundingClientRect().height ?? 1)) * 100}%` : '50%',
                }}
              />

              <video ref={videoRef} id="webcam-feed" playsInline muted aria-label="Webcam feed" />
              <canvas ref={canvasRef} id="landmark-canvas" className="landmark-canvas" aria-hidden="true" />

              <div id="video-overlay" className={`video-overlay ${camActive ? 'hidden' : ''}`} role="status">
                <div className="overlay-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
                    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
                    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
                  </svg>
                </div>
                {camError
                  ? <><span className="overlay-title">Camera Unavailable</span><span className="overlay-sub">{camError}</span></>
                  : <><span className="overlay-title">Initializing…</span><span className="overlay-sub">Loading MediaPipe · Allow camera access</span></>
                }
              </div>
            </div>

            {/* Controls bar */}
            <div className="controls-bar" role="toolbar" aria-label="Camera controls">
              <button
                className="btn btn-primary btn-sm"
                id="btn-reset"
                onClick={() => {
                  setGesture('NONE');
                  setPinchStr(0);
                  setHandCount(0);
                  setSwipeLog([]);
                  setVolume(null);
                  setFistProg(0);
                  setPeaceProg(0);
                  setSentAction(null);
                  setTiles(INIT_TILES);
                  setLeftHand({ detected: false, gesture: 'NONE', confidence: 0 });
                  setRightHand({ detected: false, gesture: 'NONE', confidence: 0 });
                  setComboGesture(null);
                  setHoldState({ gesture: null, progress: 0, locked: false, actionLabel: '' });
                  holdRef.current = { gesture: null, startTime: null, locked: false, lastFired: {} };
                }}
                aria-label="Reset gesture state and event log"
              >
                Reset
              </button>
              <div
                className="hero-terminal"
                style={{ flex: 1, fontSize: '0.7rem', padding: '7px 12px' }}
                role="status"
                aria-live="polite"
                aria-label="Live detection status"
              >
                <span className="hero-terminal-prompt">&gt;</span>
                <span className="hero-terminal-text" style={{ fontSize: '0.7rem' }}>
                  {handCount > 0
                    ? `${handCount > 1 ? `L:${leftHand.gesture} R:${rightHand.gesture}` : displayGesture.replace('_', ' ')} · ${handCount} hand${handCount > 1 ? 's' : ''} · ${fps} fps`
                    : camActive
                    ? `tracking active · awaiting hand · ${fps} fps`
                    : `camera initializing…`
                  }
                </span>
              </div>
            </div>

            {/* Kanban */}
            <div className="float-card kanban-card" id="kanban-zone">
              <div className="kanban-header">
                <span className="kanban-title">[ DRAG WORKSPACE ]</span>
                <span className="badge accent">✊ Grab · Open hand to drop</span>
              </div>
              <div className="kanban-board">
                {COLS.map((col, colIdx) => (
                  <div key={colIdx} data-col-idx={colIdx}
                    className={`kanban-col ${hoverCol === colIdx && dragState.active ? 'drop-target' : ''}`}>
                    <div className="kanban-col-header" style={{ color: col.color }}>
                      <span className="col-dot" style={{ background: col.color }} />
                      {col.label}
                      <span className="col-count">{tiles.filter(t => t.col === colIdx && t.id !== dragState.tileId).length}</span>
                    </div>
                    {tiles.filter(t => t.col === colIdx && t.id !== dragState.tileId).map(tile => (
                      <div key={tile.id} data-tile-id={tile.id} className="kanban-tile" id={`tile-${tile.id}`}>
                        <div className="tile-label">{tile.label}</div>
                        <div className="tile-sub">{tile.sub}</div>
                      </div>
                    ))}
                    {dragState.active && tiles.find(t => t.id === dragState.tileId)?.col === colIdx && <div className="kanban-placeholder" />}
                    {hoverCol === colIdx && dragState.active && tiles.find(t => t.id === dragState.tileId)?.col !== colIdx && <div className="kanban-drop-zone">Drop here</div>}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Side panel ── */}
          <aside className="side-panel" aria-label="Gesture status and controls">

            {/* ── LIVE TRACKING card — two-hand readout ── */}
            <div className="float-card status-card" id="gesture-status-card">
              <div className="status-card-header">
                <span className="status-label">[ LIVE TRACKING ]</span>
                <span className={`badge ${handCount > 0 ? 'active' : ''}`} id="hand-count-badge">
                  <span className={`status-dot ${handCount > 0 ? 'active' : ''}`} aria-hidden="true" />
                  {handCount} hand{handCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Per-hand sections */}
              <div className="hands-row" id="hands-row">
                <HandSection
                  side="left"
                  detected={leftHand.detected}
                  gesture={leftHand.gesture}
                  confidence={leftHand.confidence}
                />
                <HandSection
                  side="right"
                  detected={rightHand.detected}
                  gesture={rightHand.gesture}
                  confidence={rightHand.confidence}
                />
              </div>

              {/* Combo badge */}
              {comboGesture && (
                <div className="combo-badge" id="combo-badge" role="status" aria-live="polite">
                  <span className="combo-icon" aria-hidden="true">⚡</span>
                  <span className="combo-label">{(GESTURE_META[comboGesture]?.label || comboGesture).toUpperCase()}</span>
                </div>
              )}

              {/* Legacy big gesture display (single-hand mode) */}
              {!comboGesture && (
                <div className={`gesture-display ${dragState.active ? 'grabbing' : ''}`} id="gesture-display">
                  <span className="gesture-emoji" id="gesture-emoji" aria-hidden="true">{meta.emoji}</span>
                  <div
                    className={`gesture-name ${gestureFlash ? 'flash' : ''}`}
                    id="gesture-name"
                    aria-live="polite"
                    aria-label={`Current gesture: ${dragState.active ? `Dragging ${draggedTile?.label}` : meta.label}`}
                  >
                    {dragState.active ? `DRAG / ${draggedTile?.label?.toUpperCase()}` : meta.label.toUpperCase()}
                  </div>
                  <div className="gesture-sub" id="gesture-sub">
                    {dragState.active ? 'Open hand to drop' : meta.sub}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div style={{ marginTop: 14 }}>
                <div className="stat-row">
                  <span className="stat-key">HANDS</span>
                  <span className="stat-val" id="hand-count-stat">{handCount}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">LANDMARKS</span>
                  <span className="stat-val" id="landmark-stat">{totalLandmarks}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">FPS</span>
                  <span className="stat-val" id="fps-stat">{fps}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">MODEL</span>
                  <span className="stat-val">MediaPipe</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">STATUS</span>
                  <span className="stat-val" style={{ color: camActive && handCount > 0 ? 'var(--green)' : camActive ? 'var(--accent)' : 'var(--text-dim)' }}>
                    {camActive && handCount > 0 ? 'TRACKING' : camActive ? 'READY' : 'INIT'}
                  </span>
                </div>
              </div>
            </div>

            {/* ── OS CONTROL card ── */}
            <div className="float-card sys-card" id="sys-control-card">
              <div className="sys-card-header">
                <span className="status-label">[ OS CONTROL ]</span>
                <span className={`badge ${isBridgeUp ? 'active' : 'danger'}`}>
                  <span className={`status-dot ${isBridgeUp ? 'active' : 'error'}`} aria-hidden="true" />
                  {isBridgeUp ? 'Online' : 'Offline'}
                </span>
              </div>

              {!isBridgeUp && (
                <div className="bridge-offline-hint" id="bridge-offline-hint" role="note">
                  Run <code>python server.py</code> to enable OS control
                </div>
              )}

              {/* Volume display */}
              <div className="sys-vol-row">
                <div className="sys-vol-bar-wrap">
                  <div className="sys-vol-bar-track">
                    <div
                      className="sys-vol-bar-fill"
                      id="sys-vol-bar"
                      style={{ height: volume !== null ? `${volume}%` : '0%' }}
                    />
                  </div>
                </div>
                <div className="sys-vol-info">
                  <div className="sys-vol-num" id="sys-vol-num" aria-live="polite" aria-label={`Volume: ${volume !== null ? volume + '%' : 'inactive'}`}>
                    {volume !== null ? `${volume}%` : '—'}
                  </div>
                  <div className="sys-vol-label-text">VOLUME</div>
                  <div className="sys-vol-hint">☝ Point up/down</div>
                </div>
              </div>

              <div className="divider" style={{ margin: '12px 0' }} />

              {/* OS Actions */}
              <div className="sys-actions" id="sys-actions">
                {/* Excel */}
                <div
                  className={`sys-action-row ${holdState.gesture === 'DOUBLE_THUMBS_UP' && !holdState.locked ? 'primed' : ''}`}
                  id="action-excel" role="status"
                >
                  <span className="sys-action-emoji" aria-hidden="true">📊</span>
                  <div className="sys-action-body">
                    <div className="sys-action-name">Open Excel</div>
                    <div className="sys-action-hint">👍👍 Both Thumbs Up · 1.5s</div>
                    <div className="hold-track">
                      <div className="hold-fill" style={{ width: holdState.gesture === 'DOUBLE_THUMBS_UP' ? `${holdState.progress}%` : '0%' }} />
                    </div>
                  </div>
                  {holdState.gesture === 'DOUBLE_THUMBS_UP' && holdState.locked && <span className="sys-action-sent" aria-label="Command sent">✓</span>}
                </div>

                {/* PowerPoint */}
                <div
                  className={`sys-action-row ${holdState.gesture === 'DOUBLE_PEACE' && !holdState.locked ? 'primed' : ''}`}
                  id="action-powerpoint" role="status"
                >
                  <span className="sys-action-emoji" aria-hidden="true">📊</span>
                  <div className="sys-action-body">
                    <div className="sys-action-name">Open PowerPoint</div>
                    <div className="sys-action-hint">✌✌ Both Peace · 1.5s</div>
                    <div className="hold-track">
                      <div className="hold-fill" style={{ width: holdState.gesture === 'DOUBLE_PEACE' ? `${holdState.progress}%` : '0%' }} />
                    </div>
                  </div>
                  {holdState.gesture === 'DOUBLE_PEACE' && holdState.locked && <span className="sys-action-sent" aria-label="Command sent">✓</span>}
                </div>

                {/* Chrome */}
                <div className={`sys-action-row ${fistProg > 0 ? 'primed' : ''}`} id="action-chrome" role="status">
                  <span className="sys-action-emoji" aria-hidden="true">🌐</span>
                  <div className="sys-action-body">
                    <div className="sys-action-name">Open Chrome</div>
                    <div className="sys-action-hint">✊ Hold fist 1.5s</div>
                    <div className="hold-track">
                      <div className="hold-fill" style={{ width: `${fistProg}%` }} />
                    </div>
                  </div>
                  {fistProg >= 100 && <span className="sys-action-sent" aria-label="Command sent">✓</span>}
                </div>

                {/* Spotify */}
                <div className={`sys-action-row ${peaceProg > 0 ? 'primed' : ''}`} id="action-spotify" role="status">
                  <span className="sys-action-emoji" aria-hidden="true">🎵</span>
                  <div className="sys-action-body">
                    <div className="sys-action-name">Open Spotify</div>
                    <div className="sys-action-hint">✌ Hold peace 1.2s</div>
                    <div className="hold-track">
                      <div className="hold-fill" style={{ width: `${peaceProg}%` }} />
                    </div>
                  </div>
                  {peaceProg >= 100 && <span className="sys-action-sent" aria-label="Command sent">✓</span>}
                </div>
              </div>

              {/* Last dispatched action */}
              {displayedAction && actionMeta && (
                <div className="sys-last-action" id="sys-last-action" role="status" aria-live="polite">
                  <span aria-hidden="true">{actionMeta.emoji}</span>
                  <span>{actionMeta.label}</span>
                  <span className="sys-last-time">{displayedAction.time}</span>
                </div>
              )}
            </div>

            {/* ── GESTURE COMMANDS card ── */}
            <div className="float-card controls-card" id="gesture-commands-card">
              <div className="controls-title">[ GESTURE COMMANDS ]</div>
              <div className="controls-grid">
                {[
                  ['👍👍', 'DOUBLE THUMBS UP', '→ Excel'],
                  ['✌✌',  'DOUBLE PEACE',      '→ PowerPoint'],
                  ['✌',   'PEACE',             '→ Spotify'],
                  ['✊',   'FIST',              '→ Chrome'],
                  ['☝',   'POINT',             '→ Volume'],
                  ['👍',   'THUMBS UP',         '→ Confirm'],
                  ['👎',   'THUMBS DOWN',       '→ Cancel'],
                  ['🖐',   'OPEN PALM',         '→ Stop'],
                  ['🤘',   'ROCK',              '→ Rock on'],
                ].map(([emoji, name, hint]) => (
                  <div key={name} className="control-item" id={`ref-${name.toLowerCase().replace(/ /g, '-')}`}>
                    <span className="control-label">{emoji} {name}</span>
                    <span className="control-kbd">{hint}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── EVENT LOG ── */}
            <div className="float-card log-card" id="swipe-log-card">
              <div className="log-card-title">[ EVENT LOG ]</div>
              <div className="log-list" id="swipe-log-list" role="log" aria-live="polite" aria-label="Swipe events">
                {swipeLog.length === 0
                  ? <div className="log-empty">no events yet</div>
                  : swipeLog.map(e => (
                      <div key={e.id} className="log-entry" id={`log-entry-${e.id}`}>
                        <span className="log-entry-icon" aria-hidden="true">{SWIPE_ICONS[e.swipe]}</span>
                        <span className="log-entry-text">SWIPE {e.swipe}</span>
                        <span className="log-entry-time">{e.timestamp}</span>
                      </div>
                    ))
                }
              </div>
            </div>

          </aside>
        </main>

        {/* Floating dragged ghost */}
        {dragState.active && draggedTile && (
          <div id="dragged-tile-ghost" className="kanban-tile dragging-ghost"
            style={{ position: 'fixed', left: dragState.x, top: dragState.y,
                     transform: 'translate(-50%,-50%) rotate(2deg) scale(1.06)',
                     zIndex: 1000, pointerEvents: 'none', minWidth: 160 }}
            aria-hidden="true">
            <div className="tile-label">{draggedTile.label}</div>
            <div className="tile-sub">{draggedTile.sub}</div>
          </div>
        )}

      </div>
    </div>
  );
}
