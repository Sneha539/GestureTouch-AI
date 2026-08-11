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
  { label: 'Queue',       color: '#6B7280' },
  { label: 'In Progress', color: '#D97706' },
  { label: 'Done',        color: '#16A34A' },
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

  const lineColor = isGrabbing  ? 'rgba(255,77,28,0.9)'
                  : isPointing  ? 'rgba(255,255,255,0.9)'
                  : 'rgba(255,255,255,0.7)';

  ctx.lineWidth = 2;
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
    ctx.arc(px(l), py(l), isTip ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isIndexTip && isPointing ? '#FF4D1C'
                  : isTip && isGrabbing      ? '#FF4D1C'
                  : isTip                    ? '#FFFFFF'
                  : 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.strokeStyle = (isIndexTip && isPointing) || (isTip && isGrabbing)
      ? '#FF4D1C' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Volume guide line when pointing
  if (isPointing && volume !== null) {
    const tipX = px(lm[8]);
    const tipY = py(lm[8]);
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(255,77,28,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX, ctx.canvas.height * 0.85);
    ctx.stroke();
    ctx.restore();

    // Volume label
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillStyle = '#FF4D1C';
    ctx.fillText(`${volume}%`, tipX + 10, tipY - 8);
  }
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
  const [camActive,  setCamActive]  = useState(false);
  const [camError,   setCamError]   = useState(null);
  const [gesture,    setGesture]    = useState('NONE');
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
    setGesture(pose);

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

  // ─── Render ───────────────────────────────────────────────────────────────
  const meta        = GESTURE_META[gesture] || GESTURE_META.NONE;
  const draggedTile = tiles.find(t => t.id === dragState.tileId);
  const isBridgeUp  = wsStatus === 'connected';

  const displayedAction = sentAction || lastAction;
  const actionMeta      = displayedAction ? ACTION_META[displayedAction.action] : null;

  return (
    <div className="app">

      {/* ── Nav ── */}
      <nav className="nav">
        <a className="nav-logo" href="#" id="nav-logo">
          <div className="nav-logo-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
              <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
              <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
              <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
            </svg>
          </div>
          <span className="nav-logo-text">GestureOS</span>
        </a>

        <div className="nav-center-badges">
          <span className={`badge ${camActive ? 'active' : ''}`} id="cam-status-badge">
            <span className={`status-dot ${camActive ? 'active' : 'warning'}`} />
            {camActive ? 'Camera' : 'No Camera'}
          </span>
          <span className={`badge ${isBridgeUp ? 'active' : ''}`} id="bridge-status-badge">
            <span className={`status-dot ${isBridgeUp ? 'active' : 'error'}`} />
            {isBridgeUp ? 'Bridge Online' : wsStatus === 'connecting' ? 'Connecting…' : 'Bridge Offline'}
          </span>
          {fps > 0 && <span className="badge" id="fps-nav-badge">{fps} fps</span>}
        </div>

        <span className="badge accent" id="nav-version-badge">v2.0 · OS Control</span>
      </nav>

      {/* ── Main grid ── */}
      <main className="main-grid">

        {/* ── Left column ── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Video */}
          <div className="video-panel" ref={videoPanelRef} id="video-panel">
            {camActive && (
              <div className="video-label" id="video-label">
                <span className="status-dot active" />
                Live · 640p
              </div>
            )}
            {camActive && <div className="fps-badge" id="fps-badge">{fps} fps</div>}

            {/* Volume HUD overlay */}
            {volume !== null && (
              <div className="vol-hud" id="vol-hud">
                <div className="vol-hud-track">
                  <div className="vol-hud-fill" style={{ height: `${volume}%` }} />
                </div>
                <span className="vol-hud-label">{volume}%</span>
              </div>
            )}

            {/* Hold progress arc when relevant */}
            {(fistProg > 0 || peaceProg > 0) && (
              <div className="hold-hud" id="hold-hud">
                <div className="hold-hud-label">
                  {fistProg > 0 ? '✊ Chrome' : '✌️ Spotify'}
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
              style={{
                display: camActive && handCount > 0 ? 'block' : 'none',
                left: dragState.active ? `${((dragState.x - (videoPanelRef.current?.getBoundingClientRect().left ?? 0)) / (videoPanelRef.current?.getBoundingClientRect().width ?? 1)) * 100}%` : '50%',
                top:  dragState.active ? `${((dragState.y - (videoPanelRef.current?.getBoundingClientRect().top  ?? 0)) / (videoPanelRef.current?.getBoundingClientRect().height ?? 1)) * 100}%` : '50%',
              }}
            />

            <video ref={videoRef} id="webcam-feed" playsInline muted />
            <canvas ref={canvasRef} id="landmark-canvas" className="landmark-canvas" />

            <div id="video-overlay" className={`video-overlay ${camActive ? 'hidden' : ''}`}>
              <div className="overlay-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                  <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
                  <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
                  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
                </svg>
              </div>
              {camError
                ? <><span className="overlay-title">Camera Unavailable</span><span className="overlay-sub">{camError}</span></>
                : <><span className="overlay-title">Starting Camera…</span><span className="overlay-sub">Loading MediaPipe · Allow access</span></>
              }
            </div>
          </div>

          {/* Kanban */}
          <div className="float-card kanban-card" id="kanban-zone">
            <div className="kanban-header">
              <span className="kanban-title">Drag &amp; Drop</span>
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
        <aside className="side-panel" aria-label="Gesture status">

          {/* ── System Control card ── */}
          <div className="float-card sys-card" id="sys-control-card">
            <div className="sys-card-header">
              <span className="status-label">System Control</span>
              <span className={`badge ${isBridgeUp ? 'active' : ''}`}>
                <span className={`status-dot ${isBridgeUp ? 'active' : 'error'}`} />
                {isBridgeUp ? 'Online' : 'Offline'}
              </span>
            </div>

            {!isBridgeUp && (
              <div className="bridge-offline-hint" id="bridge-offline-hint">
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
                <div className="sys-vol-num" id="sys-vol-num">
                  {volume !== null ? `${volume}%` : '—'}
                </div>
                <div className="sys-vol-label-text">Volume</div>
                <div className="sys-vol-hint">☝️ Point up/down</div>
              </div>
            </div>

            <hr className="divider" style={{ margin: '16px 0' }} />

            {/* OS Actions */}
            <div className="sys-actions" id="sys-actions">

              {/* Chrome */}
              <div className={`sys-action-row ${fistProg > 0 ? 'primed' : ''}`} id="action-chrome">
                <span className="sys-action-emoji">🌐</span>
                <div className="sys-action-body">
                  <div className="sys-action-name">Open Chrome</div>
                  <div className="sys-action-hint">✊ Hold fist 1.5s</div>
                  <div className="hold-track">
                    <div className="hold-fill" style={{ width: `${fistProg}%` }} />
                  </div>
                </div>
                {fistProg >= 100 && <span className="sys-action-sent">✓</span>}
              </div>

              {/* Spotify */}
              <div className={`sys-action-row ${peaceProg > 0 ? 'primed' : ''}`} id="action-spotify">
                <span className="sys-action-emoji">🎵</span>
                <div className="sys-action-body">
                  <div className="sys-action-name">Open Spotify</div>
                  <div className="sys-action-hint">✌️ Hold peace 1.2s</div>
                  <div className="hold-track">
                    <div className="hold-fill" style={{ width: `${peaceProg}%` }} />
                  </div>
                </div>
                {peaceProg >= 100 && <span className="sys-action-sent">✓</span>}
              </div>
            </div>

            {/* Last dispatched action */}
            {displayedAction && actionMeta && (
              <div className="sys-last-action" id="sys-last-action">
                <span>{actionMeta.emoji}</span>
                <span>{actionMeta.label}</span>
                <span className="sys-last-time">{displayedAction.time}</span>
              </div>
            )}
          </div>

          {/* ── Gesture status card ── */}
          <div className="float-card status-card" id="gesture-status-card">
            <div className="status-card-header">
              <span className="status-label">Detected Gesture</span>
              <span className={`badge ${handCount > 0 ? 'active' : ''}`} id="hand-count-badge">
                <span className={`status-dot ${handCount > 0 ? 'active' : ''}`} />
                {handCount} hand{handCount !== 1 ? 's' : ''}
              </span>
            </div>

            <div className={`gesture-display ${dragState.active ? 'grabbing' : ''}`} id="gesture-display">
              <span className="gesture-emoji" id="gesture-emoji">{meta.emoji}</span>
              <div className="gesture-name" id="gesture-name">
                {dragState.active ? `Dragging "${draggedTile?.label}"` : meta.label}
              </div>
              <div className="gesture-sub" id="gesture-sub">
                {dragState.active ? 'Open hand to drop' : meta.sub}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div className="stat-row">
                <span className="stat-key">Pinch</span>
                <span className="stat-val">{Math.round(pinchStr * 100)}%</span>
              </div>
              <div className="strength-bar-track">
                <div className="strength-bar-fill" style={{ width: `${pinchStr * 100}%` }} />
              </div>
              <div className="stat-row">
                <span className="stat-key">FPS</span>
                <span className="stat-val" id="fps-stat">{fps}</span>
              </div>
              <div className="stat-row">
                <span className="stat-key">Landmarks</span>
                <span className="stat-val">{handCount > 0 ? '21/21' : '0/21'}</span>
              </div>
            </div>
          </div>

          {/* ── Event log ── */}
          <div className="float-card log-card" id="swipe-log-card">
            <div className="log-card-title">Event Log</div>
            <div className="log-list" id="swipe-log-list">
              {swipeLog.length === 0
                ? <div className="log-empty">No swipes yet</div>
                : swipeLog.map(e => (
                    <div key={e.id} className="log-entry" id={`log-entry-${e.id}`}>
                      <span className="log-entry-icon">{SWIPE_ICONS[e.swipe]}</span>
                      <span className="log-entry-text">Swipe {e.swipe}</span>
                      <span className="log-entry-time">{e.timestamp}</span>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* ── Gesture reference ── */}
          <div className="float-card controls-card" id="gesture-ref-card">
            <div className="controls-title">Gesture Map</div>
            <div className="controls-grid">
              {[
                ['☝️', 'Point',     '→ Volume'],
                ['✌️', 'Peace',     '→ Spotify (hold)'],
                ['✊', 'Fist',      '→ Chrome (hold)'],
                ['🤌', 'Pinch',     '→ Select / Drag'],
                ['🖐️','Open Hand', '→ Drop'],
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
                   zIndex: 1000, pointerEvents: 'none', minWidth: 180 }}>
          <div className="tile-label">{draggedTile.label}</div>
          <div className="tile-sub">{draggedTile.sub}</div>
        </div>
      )}
    </div>
  );
}
