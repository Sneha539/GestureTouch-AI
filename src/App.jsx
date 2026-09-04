import { useRef, useEffect, useState, useCallback } from 'react';
import './App.css';
import {
  smoothLandmarks,
  getPalmCenter,
  detectPinch,
  detectSwipe,
  classifyPose,
  getFingerStates,
  getVolumeFromIndex,
  FIST_HOLD_MS,
  PEACE_HOLD_MS,
  CMD_COOLDOWN_MS,
  VOL_THROTTLE_MS,
} from './gestureEngine';
import { useSystemBridge } from './useSystemBridge';

// ─── Constants ────────────────────────────────────────────────────────────────
const SWIPE_HISTORY_LEN   = 10;
const SWIPE_COOLDOWN_MS   = 650;
const MAX_LOG_ENTRIES     = 4;
const EMA_ALPHA           = 0.55;
const GRAB_CONFIRM_FRAMES = 5;
const GRAB_PICK_RADIUS_PX = 130;

// ─── Gesture metadata ─────────────────────────────────────────────────────────
const GESTURE_META = {
  PINCH:     { emoji: '🤌', label: 'Pinch',      sub: 'Thumb + Index' },
  PEACE:     { emoji: '✌️', label: 'Peace',      sub: 'Hold 1.2s → Spotify' },
  FIST:      { emoji: '✊', label: 'Fist',        sub: 'Hold 1.5s → Chrome' },
  OPEN_HAND: { emoji: '🖐️', label: 'Open Hand',  sub: 'Release to drop' },
  POINT:     { emoji: '☝️', label: 'Volume',     sub: 'Move up/down to adjust' },
  PINKY:     { emoji: '🤙', label: 'Pinky',      sub: 'Pinky extended' },
  CUSTOM:    { emoji: '🖐️', label: 'Custom',     sub: 'Mixed pose' },
  NONE:      { emoji: '—',  label: 'No Hand',    sub: 'Move hand into view' },
};

const SWIPE_ICONS = { LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓' };

const ACTION_META = {
  open_spotify: { emoji: '🎵', label: 'Spotify opened' },
  open_chrome:  { emoji: '🌐', label: 'Chrome opened' },
  set_volume:   { emoji: '🔊', label: 'Volume set' },
};

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

function drawLandmarks(ctx, lm, isGrabbing, isPointing, volume) {
  if (!ctx || !lm) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const px = (l) => (1 - l.x) * ctx.canvas.width;
  const py = (l) => l.y * ctx.canvas.height;

  const lineColor = isGrabbing  ? 'rgba(255,122,69,0.85)'
                  : isPointing  ? 'rgba(76,141,255,0.9)'
                  : 'rgba(76,141,255,0.55)';

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
                  : isTip                    ? '#4C8DFF'
                  : 'rgba(76,141,255,0.4)';
    ctx.fill();
    if (isTip) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = isGrabbing ? 'rgba(255,122,69,0.6)' : 'rgba(76,141,255,0.6)';
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });

  // Volume guide line when pointing
  if (isPointing && volume !== null) {
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

    // Volume label
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.fillStyle = '#FF7A45';
    ctx.fillText(`${volume}%`, tipX + 10, tipY - 8);
  }
}

// ─── Hero: MediaPipe-accurate 21-point hand skeleton coordinates ───────────────
// Normalized [0,1] space, shaped as an open right hand, palm facing camera.
// Points ordered 0-20 matching MediaPipe Hand landmark indices.
const HAND_POINTS = [
  // 0 - WRIST
  { x: 0.50, y: 0.88 },
  // 1-4 - THUMB
  { x: 0.36, y: 0.75 },
  { x: 0.26, y: 0.64 },
  { x: 0.18, y: 0.55 },
  { x: 0.11, y: 0.45 },
  // 5-8 - INDEX
  { x: 0.42, y: 0.60 },
  { x: 0.40, y: 0.44 },
  { x: 0.40, y: 0.31 },
  { x: 0.40, y: 0.18 },
  // 9-12 - MIDDLE
  { x: 0.52, y: 0.57 },
  { x: 0.52, y: 0.40 },
  { x: 0.52, y: 0.26 },
  { x: 0.52, y: 0.13 },
  // 13-16 - RING
  { x: 0.62, y: 0.59 },
  { x: 0.63, y: 0.43 },
  { x: 0.63, y: 0.29 },
  { x: 0.63, y: 0.17 },
  // 17-20 - PINKY
  { x: 0.71, y: 0.63 },
  { x: 0.73, y: 0.50 },
  { x: 0.74, y: 0.38 },
  { x: 0.75, y: 0.27 },
];

const TIP_INDICES = new Set([4, 8, 12, 16, 20]);

// ─── Constellation component ───────────────────────────────────────────────────
function HandConstellation({ parallaxRef }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Parallax via mouse
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

  const W = 360;
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
        {/* Connection lines */}
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

        {/* Landmark dots */}
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

  const statusText = camActive && fps > 0
    ? `tracking 21 landmarks · ${fps} fps · READY`
    : camActive
    ? `model loading · camera active · standby`
    : `camera idle · awaiting launch`;

  const handleLaunch = () => {
    onLaunch();
  };

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
            onClick={handleLaunch}
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
            [ HAND TRACKING / REAL-TIME CV ]
          </div>

          <h1 className="hero-headline">
            See the gesture.<br />
            Skip the touch.
          </h1>

          <p className="hero-description">
            Real-time hand tracking that turns natural gestures into touch-free controls. 21 landmarks. Zero hardware.
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
              onClick={handleLaunch}
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
                ['🖐️', 'Open Hand'],
                ['☝️', 'Point'],
                ['🤙', 'Pinky'],
                ['✦',  'Custom'],
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
              <span className="hero-stat-value">21</span>
              <span className="hero-stat-label">Hand Landmarks</span>
            </div>
            <div className="hero-stat" role="listitem">
              <span className="hero-stat-value">7</span>
              <span className="hero-stat-label">Gestures</span>
            </div>
            <div className="hero-stat" role="listitem">
              <span className="hero-stat-value">Real-Time</span>
              <span className="hero-stat-label">Detection</span>
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const videoPanelRef = useRef(null);
  const handsRef      = useRef(null);
  const rafRef        = useRef(null);
  const processingRef = useRef(false);

  // Gesture state refs
  const smoothedLmRef   = useRef(null);
  const wasPinchedRef   = useRef(false);
  const palmHistoryRef  = useRef([]);
  const lastSwipeRef    = useRef(0);
  const fpsRef          = useRef({ frames: 0, last: performance.now() });
  const grabFramesRef   = useRef(0);
  const dragRef         = useRef({ active: false, tileId: null });

  // OS command refs (mutable — avoid re-render on every frame)
  const fistHoldStartRef    = useRef(null);
  const peaceHoldStartRef   = useRef(null);
  const lastCmdTimeRef      = useRef({});   // { action: timestamp }
  const lastVolSentRef      = useRef(0);

  // React state
  const [screen,     setScreen]     = useState('hero');  // 'hero' | 'transitioning' | 'app'
  const [camActive,  setCamActive]  = useState(false);
  const [camError,   setCamError]   = useState(null);
  const [gesture,    setGesture]    = useState('NONE');
  const [prevGesture, setPrevGesture] = useState('NONE');
  const [pinchStr,   setPinchStr]   = useState(0);
  const [isPinched,  setIsPinched]  = useState(false);
  const [fps,        setFps]        = useState(0);
  const [handCount,  setHandCount]  = useState(0);
  const [swipeLog,   setSwipeLog]   = useState([]);
  const [tiles,      setTiles]      = useState(INIT_TILES);
  const [dragState,  setDragState]  = useState({ active: false, tileId: null, x: 0, y: 0 });
  const [hoverCol,   setHoverCol]   = useState(null);
  const [volume,     setVolume]     = useState(null);       // 0-100 or null
  const [fistProg,   setFistProg]   = useState(0);          // 0-100 hold progress
  const [peaceProg,  setPeaceProg]  = useState(0);          // 0-100 hold progress
  const [sentAction, setSentAction] = useState(null);       // last OS action dispatched
  const [gestureFlash, setGestureFlash] = useState(false);  // brief emphasis on gesture change

  // System bridge
  const { wsStatus, lastAction, sendCommand } = useSystemBridge();

  // ── FPS ───────────────────────────────────────────────────────────
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

  // ── Per-frame handler ─────────────────────────────────────────────
  const onResults = useCallback((results) => {
    tickFps();

    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video) return;

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');

    const multiHands = results.multiHandLandmarks;
    const count      = multiHands?.length ?? 0;
    setHandCount(count);

    if (!count) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      smoothedLmRef.current = null;
      wasPinchedRef.current = false;
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
      return;
    }

    // Smooth landmarks
    const lm = smoothLandmarks(smoothedLmRef.current, multiHands[0], EMA_ALPHA);
    smoothedLmRef.current = lm;

    // Detect
    const fingerStates = getFingerStates(lm);
    const pinchInfo    = detectPinch(lm, wasPinchedRef.current);
    wasPinchedRef.current = pinchInfo.pinched;
    const pose = classifyPose(fingerStates, pinchInfo);
    const isFist = !fingerStates.index && !fingerStates.middle
                && !fingerStates.ring  && !fingerStates.pinky;
    const isPointing = pose === 'POINT';

    // Current volume for drawing
    const currentVol = isPointing ? getVolumeFromIndex(lm) : null;
    drawLandmarks(ctx, lm, dragRef.current.active || isFist, isPointing, currentVol);

    setPinchStr(pinchInfo.strength);
    setIsPinched(pinchInfo.pinched);
    setGesture(prev => {
      if (prev !== pose) {
        setPrevGesture(prev);
        setGestureFlash(true);
        setTimeout(() => setGestureFlash(false), 350);
      }
      return pose;
    });

    // ── Palm → screen coords ─────────────────────────────────────
    const palm    = getPalmCenter(lm);
    const panelEl = videoPanelRef.current;
    let screenX = 0, screenY = 0;
    if (panelEl) {
      const rect = panelEl.getBoundingClientRect();
      screenX = rect.left + (1 - palm.x) * rect.width;
      screenY = rect.top  + palm.y * rect.height;
    }

    const now = Date.now();

    // ══════════════════════════════════════════════════════════════
    // OS COMMAND MAPPING
    // ══════════════════════════════════════════════════════════════

    // ── ☝️ POINT → Volume control ────────────────────────────────
    if (isPointing) {
      const vol = getVolumeFromIndex(lm);
      setVolume(vol);
      if (now - lastVolSentRef.current > VOL_THROTTLE_MS) {
        sendCommand('set_volume', { level: vol });
        lastVolSentRef.current = now;
      }
      // Reset hold timers when switching gesture
      fistHoldStartRef.current  = null;
      peaceHoldStartRef.current = null;
      setFistProg(0);
      setPeaceProg(0);
    } else {
      setVolume(null);
    }

    // ── ✌️ PEACE → Launch Spotify (hold 1.2s) ───────────────────
    if (pose === 'PEACE') {
      if (!peaceHoldStartRef.current) peaceHoldStartRef.current = now;
      const held     = now - peaceHoldStartRef.current;
      const progress = Math.min(100, (held / PEACE_HOLD_MS) * 100);
      setPeaceProg(progress);

      if (held >= PEACE_HOLD_MS) {
        const lastFired = lastCmdTimeRef.current['open_spotify'] ?? 0;
        if (now - lastFired > CMD_COOLDOWN_MS) {
          sendCommand('open_spotify');
          lastCmdTimeRef.current['open_spotify'] = now;
          peaceHoldStartRef.current = null;
          setSentAction({ action: 'open_spotify', time: new Date().toLocaleTimeString('en-US', { hour12: false }) });
        }
      }
      fistHoldStartRef.current = null;
      setFistProg(0);

    } else {
      peaceHoldStartRef.current = null;
      setPeaceProg(0);
    }

    // ── ✊ FIST → Launch Chrome (hold 1.5s, only if not dragging) ─
    if (isFist && !dragRef.current.active) {
      if (!fistHoldStartRef.current) fistHoldStartRef.current = now;
      const held     = now - fistHoldStartRef.current;
      const progress = Math.min(100, (held / FIST_HOLD_MS) * 100);
      setFistProg(progress);

      if (held >= FIST_HOLD_MS) {
        const lastFired = lastCmdTimeRef.current['open_chrome'] ?? 0;
        if (now - lastFired > CMD_COOLDOWN_MS) {
          sendCommand('open_chrome');
          lastCmdTimeRef.current['open_chrome'] = now;
          fistHoldStartRef.current = null;
          setSentAction({ action: 'open_chrome', time: new Date().toLocaleTimeString('en-US', { hour12: false }) });
        }
      }
    } else if (dragRef.current.active) {
      // Dragging — don't accumulate chrome hold
      fistHoldStartRef.current = null;
      setFistProg(0);
    } else if (!isFist) {
      fistHoldStartRef.current = null;
      setFistProg(0);
    }

    // ══════════════════════════════════════════════════════════════
    // DRAG & DROP
    // ══════════════════════════════════════════════════════════════

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

    // ── Swipe (disabled while dragging or pointing) ────────────────
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
  }, [tickFps, sendCommand]);

  // ── MediaPipe init — direct RAF, no Camera util ──────────────────
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
        hands.setOptions({
          maxNumHands: 1, modelComplexity: 0,
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

  // ── Screen transition ─────────────────────────────────────────────
  const handleLaunch = useCallback(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setScreen('app');
      return;
    }
    setScreen('transitioning');
    setTimeout(() => setScreen('app'), 700);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  const meta        = GESTURE_META[gesture] || GESTURE_META.NONE;
  const draggedTile = tiles.find(t => t.id === dragState.tileId);
  const isBridgeUp  = wsStatus === 'connected';

  const displayedAction = sentAction || lastAction;
  const actionMeta      = displayedAction ? ACTION_META[displayedAction.action] : null;

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
              <span className="nav-logo-tag">[ LIVE TRACKING ]</span>
            </div>
          </button>

          <div className="nav-center-badges">
            <span className={`badge ${camActive ? 'active' : ''}`} id="cam-status-badge">
              <span className={`status-dot ${camActive ? 'active' : 'warning'}`} />
              {camActive ? 'Camera Active' : 'No Camera'}
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

              {/* Reticle corners */}
              <div className="reticle-tr" aria-hidden="true" />
              <div className="reticle-bl" aria-hidden="true" />

              {camActive && (
                <div className="video-label" id="video-label">
                  <span className="status-dot active" aria-hidden="true" />
                  LIVE · 640P
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

              {/* Hold progress HUD */}
              {(fistProg > 0 || peaceProg > 0) && (
                <div className="hold-hud" id="hold-hud" role="status">
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
                    ? `${gesture.replace('_', ' ')} detected · ${handCount} hand · ${fps} fps`
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

            {/* Gesture readout */}
            <div className="float-card status-card" id="gesture-status-card">
              <div className="status-card-header">
                <span className="status-label">[ GESTURE ]</span>
                <span className={`badge ${handCount > 0 ? 'active' : ''}`} id="hand-count-badge">
                  <span className={`status-dot ${handCount > 0 ? 'active' : ''}`} aria-hidden="true" />
                  {handCount} hand{handCount !== 1 ? 's' : ''}
                </span>
              </div>

              <div className={`gesture-display ${dragState.active ? 'grabbing' : ''}`} id="gesture-display">
                {/* emoji hidden in dark design — kept for DOM compat */}
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

              <div style={{ marginTop: 16 }}>
                <div className="stat-row">
                  <span className="stat-key">CONFIDENCE</span>
                  <span className="stat-val" id="pinch-stat">{Math.round(pinchStr * 100)}%</span>
                </div>
                <div className="strength-bar-track">
                  <div className="strength-bar-fill" style={{ width: `${pinchStr * 100}%` }} />
                </div>
                <div className="stat-row">
                  <span className="stat-key">FPS</span>
                  <span className="stat-val" id="fps-stat">{fps}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">LANDMARKS</span>
                  <span className="stat-val">{handCount > 0 ? '21 / 21' : '0 / 21'}</span>
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

            {/* System Control card */}
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

            {/* Event log */}
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

            {/* Gesture map */}
            <div className="float-card controls-card" id="gesture-ref-card">
              <div className="controls-title">[ GESTURE MAP ]</div>
              <div className="controls-grid">
                {[
                  ['☝', 'POINT',     '→ Volume'],
                  ['✌', 'PEACE',     '→ Spotify'],
                  ['✊', 'FIST',      '→ Chrome'],
                  ['🤌', 'PINCH',    '→ Select'],
                  ['🖐', 'OPEN HAND', '→ Drop'],
                ].map(([emoji, name, hint]) => (
                  <div key={name} className="control-item" id={`ref-${name.toLowerCase().replace(/ /g, '-')}`}>
                    <span className="control-label">{emoji} {name}</span>
                    <span className="control-kbd">{hint}</span>
                  </div>
                ))}
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
