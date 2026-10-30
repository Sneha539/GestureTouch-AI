# 🖐️ GestureTouch-AI

<div align="center">

![GestureTouch-AI](https://img.shields.io/badge/GestureTouch--AI-v3.0-FF4D1C?style=for-the-badge&logo=hand-paper&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Hands-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-asyncio-009688?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**AI-powered, touchless human-computer interaction using real-time dual-hand gesture recognition.**  
Track **both hands simultaneously**, recognize 13+ gestures with two-hand combo detection, and control your entire OS — volume, brightness, scrolling, media playback, and app launching — all with natural hand gestures detected through your webcam. No extra hardware required.

[Features](#-key-features) · [Architecture](#-system-architecture) · [Tech Stack](#-technology-stack--role-of-each-library) · [Gestures](#-gesture-reference) · [Setup](#-installation--setup) · [Usage](#-usage-guide) · [File Structure](#-project-structure--file-by-file-breakdown)

</div>

---

## 📖 Project Overview

**GestureTouch-AI** is a full-stack, browser-based gesture control system that uses Google's MediaPipe Hands to track **up to 42 hand landmarks** (21 per hand) in real time via your webcam. A **React 19 + Vite 8** frontend processes both hand skeletons simultaneously, classifies 13+ individual gestures, detects two-hand combo gestures, and triggers hold-to-activate actions. A lightweight **Python asyncio WebSocket server** bridges the browser to the Windows OS, enabling genuine system-level actions — master volume control, display brightness adjustment, system-wide scrolling, media playback, and launching applications like Chrome, Spotify, Excel, and PowerPoint — all without touching your keyboard or mouse.

The system is designed for environments where touchless interaction is essential or preferred: sterile medical settings, accessible computing, presentation control, and futuristic desktop experiences.

---

## 🎯 Problem Statement

Traditional computing interfaces rely entirely on physical input devices — keyboards, mice, or touchscreens. These create friction in scenarios where:

- **Sterile/medical environments** where touching peripherals risks contamination.
- **Accessibility needs** limit fine motor control.
- **Presentation or creative workflows** require hands-free navigation.
- **Novelty & immersion** in interactive exhibits or installations.

GestureTouch-AI eliminates the need for physical contact with input devices by enabling both human hands to become the controller, captured by a standard webcam and interpreted by cutting-edge AI models running entirely in the browser.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🖐🖐 **Dual-Hand Tracking** | Tracks both hands simultaneously with independent landmark sets, gesture classification, and confidence scores |
| 🤙 **Left / Right Identification** | Automatically labels each detected hand as LEFT or RIGHT using MediaPipe handedness data |
| 🎨 **Color-coded Skeleton** | Right hand rendered in **blue** (`rgba(76,141,255)`), left hand in **teal** (`rgba(76,200,220)`) — same design language, visually distinct |
| 🤌 **13+ Gesture Library** | PINCH, PEACE, FIST, OPEN PALM, POINT, THUMBS UP, THUMBS DOWN, OK, ROCK, CALL ME, THREE, FOUR, PINKY |
| ⚡ **Two-Hand Combos** | Combined gestures: DOUBLE THUMBS UP, DOUBLE PEACE, DOUBLE FIST, DOUBLE OPEN PALM, FIST+PALM, PEACE+THUMBS, DOUBLE THUMBS DOWN |
| ⏱️ **Hold-to-Activate** | Gestures must be held stably for a configurable duration (1.2–1.5 s) at ≥ 72% confidence before actions fire — prevents accidents |
| 🔒 **Lock-After-Fire** | After an action triggers, it locks until the gesture is released — no repeated launches |
| 🔊 **Volume Control** | Raise/lower index finger (Point gesture) to set master volume 0–100% via `pycaw` |
| ☀️ **Brightness Control** | Open palm or point gesture + vertical hand movement adjusts display brightness via WMI |
| ↕️ **System-Wide Scrolling** | Point or open palm gesture injects `mouse_event` wheel events via `user32.dll` |
| ⏯️ **Media Playback** | Pinch = Play/Pause, Peace = Next Track, Three = Previous Track, Fist = Mute (via virtual media keys) |
| 📊 **Open Excel** | Hold both Thumbs Up for 1.5 s → opens Excel online (`excel.new`) + tries native Office via `ms-excel:` URI |
| 📊 **Open PowerPoint** | Hold both Peace signs for 1.5 s → opens PowerPoint online (`powerpoint.new`) + tries native Office |
| ✌️ **Peace → Spotify** | Hold the peace sign for 1.2 s → launches Spotify via URI scheme or known install paths |
| ✊ **Fist → Chrome** | Hold a fist for 1.5 s → opens Google Chrome via shell or known install paths |
| ← → ↑ ↓ **Swipe Detection** | Swipe your palm in any direction to log directional events |
| ✊ **Fist Drag-and-Drop** | Make a fist to grab Kanban tiles and drag them across columns |
| 📈 **Live Two-Hand Stats Panel** | Per-hand gesture + confidence display, real landmark count (21 or 42), FPS counter |
| 🔗 **WebSocket OS Bridge** | Python server bridges gestures to real Windows OS actions with auto-reconnect every 3 s |
| 🎛️ **Hold-Progress HUDs** | Inline progress bar with time countdown (e.g., `0.8s / 1.5s`) before actions fire |
| 🩺 **Medical Kanban Demo** | Built-in drag-and-drop board (Queue → In Progress → Done) controlled entirely by hand |
| 🎨 **Hero Landing Page** | Animated hand constellation SVG with mouse parallax, gesture chip gallery, and terminal status display |
| 📱 **4-Mode System Control** | Switchable modes: Volume, Brightness, Scroll, Media — only one active at a time to prevent conflicts |

---

## ⚙️ System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          BROWSER (React 19)                         │
│                                                                      │
│  ┌─────────────┐     ┌──────────────────────────────────────────┐   │
│  │  index.html  │     │           App.jsx (Main Component)       │   │
│  │  MediaPipe   │────▶│  • requestAnimationFrame loop            │   │
│  │  CDN script  │     │  • Dual-hand landmark parsing            │   │
│  └─────────────┘     │  • Centralized hold-to-activate system   │   │
│                       │  • Kanban drag-and-drop logic            │   │
│                       │  • HUD overlays (volume, brightness,     │   │
│                       │    scroll, hold progress)                │   │
│                       └────────────┬────────────┬────────────────┘   │
│                                    │            │                    │
│                    ┌───────────────▼──┐   ┌─────▼──────────────┐    │
│                    │ gestureEngine.js │   │ systemControlEngine│    │
│                    │                  │   │     .js             │    │
│                    │ • EMA smoothing  │   │ • State machine     │    │
│                    │ • classifySingle │   │   (per control mode)│    │
│                    │   Hand() → 13   │   │ • Calibration logic │    │
│                    │   gestures       │   │ • Dead-zone filters │    │
│                    │ • classifyTwo    │   │ • Discrete hold     │    │
│                    │   Hands() →      │   │   tracking          │    │
│                    │   7 combos       │   │ • Throttled dispatch│    │
│                    │ • detectPinch() │   │ • Lock-after-fire   │    │
│                    │ • detectSwipe() │   └──────────┬──────────┘    │
│                    │ • getVolume     │              │               │
│                    │   FromIndex()    │              │               │
│                    └─────────────────┘              │               │
│                                                     │               │
│                    ┌──────────────────┐    ┌────────▼──────────┐    │
│                    │ gestureConfig.js │    │useSystemBridge.js │    │
│                    │                  │    │                    │    │
│                    │ • CONTROL_MODES  │    │ • WebSocket client │    │
│                    │   (VOL/BRIGHT/   │    │   ws://localhost   │    │
│                    │   SCROLL/MEDIA)  │    │   :8765             │    │
│                    │ • CONTROL_STATES │    │ • Auto-reconnect   │    │
│                    │ • DEFAULT_       │    │   every 3 seconds  │    │
│                    │   GESTURE_CONFIG │    │ • Syncs volume,    │    │
│                    │ • Per-mode       │    │   brightness,      │    │
│                    │   gesture →      │    │   mute, caps       │    │
│                    │   action maps    │    └────────┬───────────┘    │
│                    └─────────────────┘             │               │
│                                                     │               │
└─────────────────────────────────────────────────────┼───────────────┘
                                                      │
                                      WebSocket (JSON) │ ws://localhost:8765
                                                      │
┌─────────────────────────────────────────────────────▼───────────────┐
│                      PYTHON BACKEND (server.py)                     │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                 asyncio WebSocket Server                       │  │
│  │                 (websockets library, port 8765)                │  │
│  └──────┬────────┬────────┬────────┬────────┬────────┬───────────┘  │
│         │        │        │        │        │        │              │
│    ┌────▼───┐┌───▼───┐┌───▼──┐┌───▼───┐┌───▼──┐┌───▼─────────┐   │
│    │ Volume ││Bright-││Scroll││ Media ││ App  ││  System     │   │
│    │Control ││ness   ││      ││Control││Launch││  Status     │   │
│    │        ││Control││      ││       ││      ││  Query      │   │
│    │ pycaw  ││ WMI   ││user32││user32 ││      ││             │   │
│    │ COM    ││       ││mouse_││keybd_ ││start-││ get_volume  │   │
│    │ Audio  ││Power- ││event ││event  ││file  ││ get_bright  │   │
│    │Endpoint││Shell  ││      ││       ││subpro││ caps check  │   │
│    │Volume  ││CIM    ││      ││       ││cess  ││             │   │
│    └────────┘└───────┘└──────┘└───────┘└──────┘└─────────────┘   │
│                                                                      │
│  Supported Actions:                                                  │
│    set_volume · get_volume · set_mute · set_brightness               │
│    get_brightness · scroll · media_command (play/pause/next/prev)    │
│    open_spotify · open_chrome · open_excel · open_powerpoint         │
│    get_system_status · get_capabilities                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Gesture Pipeline (per frame, ~30-60 fps)

1. **Capture** — `requestAnimationFrame` loop feeds each video frame to MediaPipe Hands.
2. **Detect** — MediaPipe returns up to 42 normalized (x, y, z) landmarks + handedness labels (`"Left"` / `"Right"`).
3. **Smooth** — Independent EMA filters per hand (`smoothedLeftRef`, `smoothedRightRef`) with α = 0.55 remove jitter from raw MediaPipe output.
4. **Classify (single)** — `classifySingleHand()` computes finger extension states, pinch ratio (with hysteresis), thumb direction, and returns a gesture label + confidence score (0–1).
5. **Classify (combo)** — `classifyTwoHands()` checks if both hands form a known pair (e.g., both `THUMBS_UP` → `DOUBLE_THUMBS_UP`). Uses sorted pair matching for order-independence.
6. **Hold** — `holdRef` accumulates how long the gesture has been stable. Actions only fire after `GESTURE_HOLD_DURATION` (1.5 s) at `confidence ≥ 0.72`.
7. **Lock** — After an action fires, `holdRef.locked = true` prevents re-triggering until the gesture changes or the hand disappears. A per-gesture cooldown of 8 seconds adds additional safety.
8. **Act** — `GESTURE_ACTIONS` map calls `window.open()` (browser) and/or `sendCommand()` (Python bridge).
9. **System Control** — `SystemControlEngine` processes the active control mode (Volume/Brightness/Scroll/Media) with its own calibration, dead-zone, and dispatch logic.
10. **Execute** — `server.py` receives JSON commands and executes system-level operations via Windows APIs.

---

## 🧩 Technology Stack & Role of Each Library

### Frontend Stack

| Technology | Version | Role in the Project |
|---|---|---|
| **React** | 19.2.8 | Core UI framework. Manages component state, re-rendering, and the lifecycle of the entire application. Uses `useRef` extensively for mutable per-frame data (hold timers, smoothed landmarks, FPS counters) to avoid re-renders on every frame — critical for maintaining 60 fps. `useCallback` memoizes the `onResults` handler to prevent MediaPipe re-initialization. `useState` drives UI updates for gesture labels, hand counts, hold progress, and Kanban tiles. |
| **React DOM** | 19.2.8 | Renders the React component tree to the browser DOM. Entry point is `main.jsx` which uses `createRoot()` to mount `<App />` inside `<StrictMode>` for development-time checks. |
| **Vite** | 8.2.0 | Lightning-fast development server with Hot Module Replacement (HMR). Bundles the production build via Rollup. Configured to **externalize** all `@mediapipe/*` packages from the bundle (since MediaPipe ships CJS packages incompatible with Vite's ESM bundler) — MediaPipe is instead loaded as a browser global via CDN `<script>` tag in `index.html`. The `@vitejs/plugin-react` (v6.0.4) enables JSX transformation and Fast Refresh. |
| **@mediapipe/hands** | 0.4.1675469240 | Google's pre-trained hand landmark detection model. Loaded from the **jsDelivr CDN** as a browser global (`window.Hands`). Detects up to **2 hands** simultaneously, producing **21 3D landmarks per hand** (42 total). Configured with `modelComplexity: 0` (fastest), `minDetectionConfidence: 0.65`, and `minTrackingConfidence: 0.55`. The WASM and model files are fetched from CDN on first load (~10–15 MB, cached by the browser). |
| **@mediapipe/camera_utils** | 0.3.1675466862 | Utility for webcam video capture. Listed as a dependency but **not directly used** in the current codebase — the app uses a custom `requestAnimationFrame` loop instead of MediaPipe's `Camera` helper for full control over frame processing cadence. |
| **@mediapipe/drawing_utils** | 0.3.1675466124 | Utility for drawing landmarks and connections. Listed as a dependency but **not directly used** — the app has its own custom `drawHandLandmarks()` and `drawAllHands()` functions for color-coded dual-hand rendering with grab/pointing state indicators. |
| **Space Grotesk** (Google Fonts) | — | Primary UI typeface for headings, labels, and body text. Loaded via `<link>` preconnect in `index.html` with weights 300–700. Provides the clean, geometric aesthetic of the interface. |
| **JetBrains Mono** (Google Fonts) | — | Monospace typeface for technical readouts: FPS counters, landmark counts, confidence percentages, volume levels, and terminal-style status displays. Weights 400–700. |
| **Vanilla CSS** | — | All styling (`index.css` + `App.css`). Design system uses CSS custom properties for theming (dark mode with `#0A0B0F` base), glassmorphism-style floating cards, CSS Grid for layout, animated gradients, pulse animations, and custom scrollbars. No Tailwind, CSS-in-JS, or preprocessors. |
| **OxLint** | 1.75.0 (dev) | Ultra-fast JavaScript/TypeScript linter written in Rust. Used for code quality checks via `npm run lint`. Configured in `.oxlintrc.json`. Replaces ESLint with a significantly faster alternative. |

### Backend Stack

| Technology | Version | Role in the Project |
|---|---|---|
| **Python** | ≥ 3.9 | Runtime for the OS controller server. Uses `asyncio` for non-blocking WebSocket handling so multiple concurrent gesture commands can be processed without blocking volume adjustments or app launches. |
| **websockets** | ≥ 12.0 | Pure Python `asyncio` WebSocket server library. Listens on `ws://localhost:8765` with `ping_interval=20` and `ping_timeout=10` for connection health monitoring. Receives JSON commands from the React frontend and sends JSON responses. Handles connection/disconnection lifecycle with proper exception handling for `ConnectionClosedOK` and `ConnectionClosedError`. |
| **pycaw** | ≥ 20240210 | **Python Core Audio Windows** library. Provides programmatic access to the Windows Audio Endpoint Volume interface (`IAudioEndpointVolume`). Used for **reading and setting the master system volume** (0–100%) and **toggling mute state**. Accesses the Windows audio subsystem through COM interfaces. The code handles multiple pycaw API versions (modern `EndpointVolume` property, legacy `_dev.Activate()`, and direct `Activate()`). Falls back to `nircmd` CLI tool if pycaw initialization fails. |
| **comtypes** | ≥ 1.4.1 | Python COM interface library. Required by `pycaw` for `CLSCTX_ALL` constant and `cast`/`POINTER` operations on the `IAudioEndpointVolume` COM interface. Also used independently to access **WMI (Windows Management Instrumentation)** for display brightness control via `WmiMonitorBrightness` and `WmiMonitorBrightnessMethods` classes. |
| **ctypes** (stdlib) | — | Python standard library for calling C functions in DLLs. Loads **`user32.dll`** from Windows to inject low-level input events: `mouse_event()` with `MOUSEEVENTF_WHEEL` for **system-wide scrolling**, and `keybd_event()` for **media key simulation** (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`, `VK_VOLUME_MUTE`). |
| **subprocess** (stdlib) | — | Launches external applications: Spotify (`spotify:` URI → `os.startfile`, or known `.exe` paths), Chrome (`cmd /c start chrome`, or known install paths), Excel (`ms-excel:` URI, or `EXCEL.EXE` paths for Office 15/16), PowerPoint (`ms-powerpoint:` URI, or `POWERPNT.EXE` paths). Also used as a fallback for brightness control via PowerShell `Get-CimInstance` commands. |
| **asyncio** (stdlib) | — | Python's built-in asynchronous I/O framework. Runs the WebSocket event loop (`asyncio.run(main())`) and uses `async for raw in websocket` to handle incoming commands without blocking. Enables concurrent processing of rapid gesture commands. |
| **json** (stdlib) | — | Serializes and deserializes the JSON command protocol between the browser and Python server. Every command follows the shape `{ "action": "...", ...payload }` and every response includes `{ "action": "...", "status": "ok"|"error"|"throttled", ...result }`. |
| **os** (stdlib) | — | Environment variable expansion for locating application install paths (e.g., `%APPDATA%\Spotify\Spotify.exe`, `%ProgramFiles%\Microsoft Office\...`). Also used for `os.startfile()` to open URI schemes like `spotify:`, `ms-excel:`, and `ms-powerpoint:`. |

### Communication Protocol

| Layer | Technology | Details |
|---|---|---|
| **Browser ↔ Python** | WebSocket | Persistent bi-directional connection on `ws://localhost:8765`. Auto-reconnects every 3 seconds on disconnect. JSON message format. Throttled at 40 ms for volume, 70 ms for brightness, 30 ms for scroll to prevent flooding. |
| **MediaPipe ↔ Browser** | CDN + WASM | MediaPipe Hands loaded from jsDelivr CDN. Runs hand landmark inference using WebAssembly and WebGL inside the browser. Results delivered via `hands.onResults()` callback. |
| **Python ↔ Windows OS** | Win32 API / COM | Direct syscalls via `ctypes.windll.user32` for input injection, COM interfaces via `comtypes`/`pycaw` for audio, WMI for brightness, `subprocess` for app launching. |

---

## 📁 Project Structure & File-by-File Breakdown

```
GestureTouch-AI/
├── index.html                 # Entry HTML — loads Google Fonts, MediaPipe CDN script
├── vite.config.js             # Vite config — externalizes MediaPipe from Rollup bundle
├── package.json               # npm dependencies, scripts (dev/build/lint/preview)
├── package-lock.json          # Exact dependency lock file
├── requirements.txt           # Python dependencies (websockets, pycaw, comtypes)
├── server.py                  # Python asyncio WebSocket OS controller (468 lines)
├── start_server.bat           # Windows helper: installs pip deps & starts server.py
├── .gitignore                 # Ignores: node_modules, __pycache__, venv, dist, .env, etc.
├── .oxlintrc.json             # OxLint linter configuration
├── README.md                  # This file
│
├── public/
│   ├── favicon.svg            # App favicon (hand icon SVG)
│   └── icons.svg              # SVG sprite for UI icons
│
├── src/
│   ├── main.jsx               # React entry — createRoot, StrictMode, mounts <App />
│   ├── App.jsx                # Main component (1831 lines) — full pipeline, UI, and interaction
│   ├── App.css                # Component styles — nav, video panel, kanban, hand sections, HUDs
│   ├── index.css              # Global design tokens, CSS reset, base component styles
│   ├── gestureEngine.js       # Pure gesture math (381 lines) — smoothing, classification, detection
│   ├── gestureConfig.js       # Centralized config — control modes, states, thresholds, mappings
│   ├── systemControlEngine.js # System control state machine (549 lines) — volume/brightness/scroll/media
│   ├── useSystemBridge.js     # React hook — WebSocket client with auto-reconnect & status sync
│   └── assets/
│       ├── hero.png           # Hero section background image
│       ├── react.svg          # React logo
│       └── vite.svg           # Vite logo
│
├── tests/
│   └── test_engine.js         # Unit tests for SystemControlEngine — calibration, movement, safety
│
└── dist/                      # Production build output (generated by `npm run build`)
    ├── index.html
    ├── favicon.svg
    ├── icons.svg
    └── assets/
        ├── index-*.js         # Bundled JavaScript
        └── index-*.css        # Bundled CSS
```

### Detailed File Descriptions

#### `src/gestureEngine.js` — The Gesture Math Core (381 lines)

The pure-function heart of the application. **No React dependencies.** Testable in isolation.

| Export | Type | Purpose |
|---|---|---|
| `smoothLandmarks(prev, curr, α)` | Function | Exponential Moving Average filter on 21-point landmark arrays. Applied independently per hand to remove MediaPipe tracking jitter. Default α = 0.4 (lower = smoother but more lag). |
| `distance(a, b)` | Function | 3D Euclidean distance between two landmarks in normalized [0,1] space. |
| `distance2D(a, b)` | Function | 2D Euclidean distance (ignores Z-axis) — more stable for screen-space gestures. |
| `getPalmCenter(lm)` | Function | Centroid of the four MCP knuckles (landmarks 5, 9, 13, 17). Used for drag-and-drop position tracking. |
| `getHandScale(lm)` | Function | Wrist-to-middle-MCP distance. **All gesture thresholds are normalized against this**, making detection scale-independent — gestures work regardless of hand distance from the camera. |
| `getFingerStates(lm)` | Function | Returns `{ thumb, index, middle, ring, pinky }` booleans. Thumb uses abduction (tip-to-MCP vs IP-to-MCP distance). Other fingers compare tip-to-wrist vs PIP-to-wrist distance. |
| `detectPinch(lm, wasPinched)` | Function | Pinch state machine with **hysteresis** to avoid jitter at threshold boundaries. Close ratio: 0.09 × handScale, open ratio: 0.14 × handScale. Returns `{ pinched, strength, point }`. |
| `detectSwipe(history)` | Function | Detects directional swipes from palm center history buffer. Requires 4 consecutive frames exceeding 0.018 normalized units/frame velocity. Returns `'LEFT'`/`'RIGHT'`/`'UP'`/`'DOWN'`/`null`. |
| `classifySingleHand(lm, wasPinched)` | Function | **Main classifier.** Priority-ordered: Pinch/OK → Fist/Thumbs Up/Thumbs Down → Open Palm → Four → Peace → Three → Point → Pinky → Rock → Call Me → Custom. Returns `{ gesture, confidence, pinchInfo }`. |
| `classifyTwoHands(L, R, lConf, rConf)` | Function | Combo classifier. Sorts gesture pair alphabetically for order-independent matching. Maps: `THUMBS_UP+THUMBS_UP` → `DOUBLE_THUMBS_UP`, `PEACE+PEACE` → `DOUBLE_PEACE`, `FIST+FIST` → `DOUBLE_FIST`, `OPEN_PALM+OPEN_PALM` → `DOUBLE_OPEN_PALM`, `FIST+OPEN_PALM` → `FIST_PALM`, `PEACE+THUMBS_UP` → `PEACE_THUMBS`, `THUMBS_DOWN+THUMBS_DOWN` → `DOUBLE_THUMBS_DOWN`. |
| `getVolumeFromIndex(lm)` | Function | Maps the index fingertip's Y-position to volume 0–100. Uses a calibrated inner range [0.15, 0.85] so the user doesn't need to reach the extreme edges of the frame. |
| Constants: `FIST_HOLD_MS`, `PEACE_HOLD_MS`, `CMD_COOLDOWN_MS`, `VOL_THROTTLE_MS`, `GESTURE_CONFIDENCE_THRESHOLD`, `GESTURE_HOLD_DURATION`, `ACTION_COOLDOWN_MS` | Constants | Exported timing/threshold constants consumed by `App.jsx` and the system control engine. |

#### `src/gestureConfig.js` — Centralized Configuration (86 lines)

Defines the entire configuration schema for the system-wide gesture control engine:

- **`CONTROL_MODES`**: `VOLUME`, `BRIGHTNESS`, `SCROLL`, `MEDIA` — only one active at a time.
- **`CONTROL_STATES`**: `DISABLED`, `READY`, `CALIBRATING`, `ACTIVE`, `PAUSED`, `ERROR`.
- **`DEFAULT_GESTURE_CONFIG`**: Master switches, safety thresholds (confidence: 0.72, hold duration: 900 ms, cooldown: 1500 ms), continuous movement parameters (sensitivity: 1.35×, smoothing α: 0.35, dead zone: 0.02), scrolling parameters (base speed: 120, max multiplier: 4×, dispatch interval: 40 ms), and per-mode gesture-to-action mappings.

#### `src/systemControlEngine.js` — System Control State Machine (549 lines)

A **pure state machine** decoupled from React and MediaPipe rendering. Processes one frame at a time via `processFrame()`.

- **Volume mode**: Open Palm/Point → calibrate → track vertical displacement → dispatch `set_volume`. Fist → hold for mute toggle. Pinch → lock current level.
- **Brightness mode**: Same calibration/movement system, dispatches `set_brightness` via WMI.
- **Scroll mode**: Point/Open Palm → calibrate → track vertical displacement → inject `mouse_event` wheel deltas with speed multiplier up to 4×.
- **Media mode**: Gesture-to-media-key mapping via configurable hold durations: Pinch (Play/Pause), Peace (Next Track), Three (Previous Track), Fist (Toggle Mute).
- **Discrete hold state machine**: Tracks per-action hold start time, progress (0–100%), fired state, and lock-after-fire with per-action cooldown.

#### `src/useSystemBridge.js` — WebSocket React Hook (135 lines)

Custom React hook that maintains a persistent WebSocket connection to the Python backend:

- Connects to `ws://localhost:8765` on mount.
- Auto-reconnects every 3 seconds on disconnect (so the user can start `server.py` after the frontend).
- Queries system status immediately on connect (`get_system_status`).
- Syncs `systemVolume`, `systemMuted`, `systemBrightness`, and `capabilities` from server responses.
- Exposes `sendCommand(action, payload)` for dispatching commands.
- Tracks `wsStatus`: `'connected'` | `'disconnected'` | `'connecting'`.

#### `src/App.jsx` — Main Application Component (1831 lines)

The largest file — orchestrates the entire pipeline:

- **HeroScreen**: Landing page with animated hand constellation SVG (21 points × 2 hands), mouse parallax, gesture chip gallery, terminal status display, and Launch button.
- **HandConstellation**: SVG component rendering two hands as point-and-line constellations with CSS-animated tips and mouse-tracking parallax.
- **HandSection**: Sub-component for per-hand gesture display (left/right) with confidence bar.
- **onResults callback**: The per-frame handler called by MediaPipe. Parses handedness labels, applies EMA smoothing per hand, classifies gestures, manages the centralized hold system, drives volume/swipe/drag logic, feeds the system control engine, and updates all React state.
- **Kanban board**: 3-column drag-and-drop board (Queue / In Progress / Done) with 6 medical-themed tiles. Fist gesture = grab, open hand = drop. Proximity-based tile pickup (130 px radius).
- **System Control card**: UI for enabling/disabling the control engine, selecting modes (Volume/Brightness/Scroll/Media), and displaying real-time telemetry.
- **HUD overlays**: Volume bar, brightness bar, scroll indicator, hold progress with time countdown, and fired confirmation badge.

#### `server.py` — Python OS Controller (468 lines)

The system bridge that translates gesture commands into real Windows actions:

| Subsystem | Windows API | Actions |
|---|---|---|
| **Volume** | `pycaw` → `IAudioEndpointVolume` (COM) | `get_volume`, `set_volume` (0–100%), `set_mute` (toggle) |
| **Brightness** | `comtypes` → WMI `WmiMonitorBrightness` | `get_brightness`, `set_brightness` (0–100%). Falls back to PowerShell `Get-CimInstance` |
| **Scrolling** | `ctypes.windll.user32.mouse_event` | `scroll` — injects `MOUSEEVENTF_WHEEL` events (clamped ±1200) |
| **Media Keys** | `ctypes.windll.user32.keybd_event` | `media_command` — simulates `VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`, `VK_VOLUME_MUTE` |
| **App Launchers** | `os.startfile` / `subprocess.Popen` | `open_spotify`, `open_chrome`, `open_excel`, `open_powerpoint` — tries URI schemes first, then known install paths, then shell fallback |

Throttling prevents command flooding: volume at 40 ms, brightness at 80 ms, scroll at 30 ms.

#### `tests/test_engine.js` — Unit Tests (111 lines)

Tests the `SystemControlEngine` class in isolation with mock `sendCommand`:

1. **Default State**: Verifies engine starts in `DISABLED` state.
2. **Enable & Modes**: Tests state transitions and mode switching.
3. **Volume Calibration & Movement**: Simulates calibration frame followed by upward hand movement, verifying level increases and action label.
4. **Pinch Lock**: Verifies that pinch gesture locks the current level.
5. **Scroll Mode**: Tests calibration and downward hand movement → scroll down.
6. **Hand Disappearance Safety**: Verifies that `null` landmarks trigger `PAUSED` state with `NO_HAND` action.

---

## 🚀 Installation & Setup

### Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | ≥ 18 | JavaScript runtime for the React frontend dev server |
| npm | ≥ 9 | Package manager for frontend dependencies |
| Python | ≥ 3.9 | Runtime for the WebSocket OS controller |
| pip | latest | Package manager for Python dependencies |
| Webcam | Any USB/built-in | Video input for hand tracking |
| OS | Windows 10/11 | Required for system-level OS control features |

> The frontend gesture visualizer works on macOS/Linux too, but OS control (volume, brightness, scrolling, media keys, Spotify, Chrome, Excel, PowerPoint) requires Windows and the Python server.

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/Sneha539/GestureTouch-AI.git
cd GestureTouch-AI
```

### Step 2 — Install Frontend Dependencies

```bash
npm install
```

This installs:
- `react` + `react-dom` — UI framework
- `@mediapipe/hands`, `@mediapipe/camera_utils`, `@mediapipe/drawing_utils` — hand tracking (externalized from bundle, loaded via CDN)
- `@vitejs/plugin-react` — Vite React plugin (dev)
- `vite` — dev server and bundler (dev)
- `oxlint` — fast Rust-based linter (dev)

### Step 3 — Install Python Dependencies

```bash
pip install -r requirements.txt
```

This installs:
- `websockets` — async WebSocket server
- `pycaw` — Windows audio volume control via COM
- `comtypes` — COM interface bindings (required by pycaw + used for WMI brightness)

> If `pycaw` fails to install, volume control falls back to `nircmd` CLI or simulation mode. All other gestures still work.

---

## ▶️ How to Run the Project

You need **two terminals** — one for the Python server, one for the Vite dev server.

### Terminal 1 — Start the Python OS Bridge

**Option A — Double-click (Windows)**
```
start_server.bat
```

**Option B — Manual**
```bash
python server.py
```

Expected output:
```
========================================================
  GestureTouch-AI — System-Wide OS Controller
  WebSocket   ->  ws://localhost:8765
  Volume      ->  pycaw (active)
  Brightness  ->  WMI (active)
  Scroll      ->  user32.mouse_event (active)
  Media Keys  ->  user32.keybd_event (active)
========================================================
  Waiting for browser connection...
  Press Ctrl+C to stop.
```

### Terminal 2 — Start the React Frontend

```bash
npm run dev
```

Then open **http://localhost:5173** in your browser.

> **Allow camera access** when prompted by the browser. MediaPipe models are downloaded from CDN on first load (~10–15 MB, cached afterwards).

### Production Build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

---

## 🎮 Usage Guide

### Status Indicators (top nav bar)

| Badge | Meaning |
|---|---|
| 🟢 **Camera Active** | Webcam is active and MediaPipe is running |
| **N hands** | Number of hands currently tracked (0, 1, or 2) |
| 🟢 **Bridge Online** | Python WebSocket server is connected |
| 🔴 **Bridge Offline** | Run `python server.py` to enable OS actions |
| **N FPS** | Real-time processing speed |
| **MODEL: READY** | MediaPipe WASM model loaded and operational |

### System Control Modes

The System Control panel supports 4 exclusive modes. Only one is active at a time:

| Mode | Icon | Activation Gesture | Action |
|---|---|---|---|
| **Volume** | 🔊 | Open Palm / Point | Move hand vertically to adjust master volume. Pinch to lock. Fist to mute/unmute. |
| **Brightness** | ☀️ | Open Palm / Point | Move hand vertically to adjust display brightness. Pinch to lock. |
| **Scroll** | ↕️ | Point / Open Palm | Move hand up/down to scroll. Speed increases with distance from calibration point (up to 4×). |
| **Media** | ⏯️ | Hold gestures | Pinch → Play/Pause. Peace → Next Track. Three → Previous Track. Fist → Toggle Mute. |

---

## ✋ Gesture Reference

### Single-Hand Gestures (13)

| Gesture | How to do it | Detected Label | Confidence |
|---|---|---|---|
| ✊ **Fist** | Curl all fingers, thumb in | `FIST` | 0.88 |
| 👍 **Thumbs Up** | Fist with thumb pointing up | `THUMBS_UP` | 0.75–0.95 |
| 👎 **Thumbs Down** | Fist with thumb pointing down | `THUMBS_DOWN` | 0.75–0.95 |
| 🖐️ **Open Palm** | Extend all 4 fingers + thumb | `OPEN_PALM` | 0.90 |
| ☝️ **Point** | Extend only index finger | `POINT` | 0.88 |
| ✌️ **Peace** | Extend index + middle | `PEACE` | 0.90 |
| 🤟 **Three** | Extend index + middle + ring | `THREE` | 0.85 |
| 🖖 **Four** | Extend index + middle + ring + pinky (thumb curled) | `FOUR` | 0.82 |
| 🤌 **Pinch** | Touch thumb tip to index tip | `PINCH` | 0–1 (strength) |
| 👌 **OK** | Pinch + other 3 fingers extended | `OK` | 0.85 |
| 🤘 **Rock** | Extend index + pinky, curl middle + ring | `ROCK` | 0.87 |
| 🤙 **Call Me** | Extend thumb + pinky | `CALL_ME` | 0.84 |
| 🤙 **Pinky** | Extend only pinky | `PINKY` | 0.85 |

### Two-Hand Combo Gestures (7)

| Combo | Detection | Label |
|---|---|---|
| 👍👍 **Double Thumbs Up** | Both hands: THUMBS_UP | `DOUBLE_THUMBS_UP` |
| ✌✌ **Double Peace** | Both hands: PEACE | `DOUBLE_PEACE` |
| ✊✊ **Double Fist** | Both hands: FIST | `DOUBLE_FIST` |
| 🖐🖐 **Both Palms** | Both hands: OPEN_PALM | `DOUBLE_OPEN_PALM` |
| ✊🖐 **Fist + Palm** | One FIST + one OPEN_PALM | `FIST_PALM` |
| ✌👍 **Peace + Thumbs** | One PEACE + one THUMBS_UP | `PEACE_THUMBS` |
| 👎👎 **Double Thumbs Down** | Both hands: THUMBS_DOWN | `DOUBLE_THUMBS_DOWN` |

### Gesture → Action Map

| Gesture | Hold Duration | Action | Mechanism |
|---|---|---|---|
| 👍👍 **Double Thumbs Up** | 1.5 s | Open Microsoft Excel | `window.open('excel.new')` + Python `ms-excel:` URI |
| ✌✌ **Double Peace** | 1.5 s | Open Microsoft PowerPoint | `window.open('powerpoint.new')` + Python `ms-powerpoint:` URI |
| ✌️ **Peace** (single hand) | 1.2 s | Open Spotify | Python `spotify:` URI / known install paths |
| ✊ **Fist** (single hand) | 1.5 s | Open Chrome | Python `cmd /c start chrome` / known install paths |
| ☝️ **Point** | continuous | Adjust system volume | Python `pycaw` → `IAudioEndpointVolume` |

---

### Drag-and-Drop (Kanban Board)

1. **Make a fist** near a Kanban tile — the grab cursor turns orange when a tile is picked up (requires 5 consecutive fist frames within 130 px radius).
2. **Keep the fist closed** and move your hand to the target column (highlighted in orange dashes).
3. **Open your hand** over the column to drop the tile.

### Volume Control (Point Gesture)

1. **Extend only your index finger** (Point gesture).
2. **Raise your hand** toward the top of the frame → 100%.
3. **Lower your hand** toward the bottom → 0%.
4. A vertical bar on the video overlay and the System Control card both reflect the current level.
5. Commands throttled at 80 ms to prevent flooding.

### Hold-to-Activate

Application-launching gestures require a deliberate hold:

```
Gesture detected → confidence ≥ 0.72?
      ↓ yes
Hold timer starts
      ↓
Progress bar fills (e.g., 0.8s / 1.5s)
      ↓
Hold threshold reached (1.2–1.5s)
      ↓
Action fires once
      ↓
LOCKED — will not fire again until:
  • gesture changes, OR
  • hand disappears, OR
  • 8-second cooldown expires
```

This prevents accidental launches from brief or shaky gesture detection.

---

## 🗺️ Architecture Decisions

| Decision | Rationale |
|---|---|
| **Two independent smoothing buffers** | Each hand gets its own EMA ref (`smoothedLeftRef`, `smoothedRightRef`), so jitter in one hand doesn't affect the other. |
| **MediaPipe handedness labels** | Uses MediaPipe's built-in `label` field (`"Left"`/`"Right"`) rather than inferring side from position, giving reliable identification regardless of where the hand is in the frame. |
| **MediaPipe via CDN, not bundle** | MediaPipe ships CJS packages incompatible with Vite's ESM bundler. Loading via `<script>` tag from jsDelivr CDN and accessing as `window.Hands` avoids bundler conflicts entirely. |
| **Custom RAF loop, not Camera utility** | MediaPipe's `Camera` helper was dropped in favor of a direct `requestAnimationFrame` loop for full control over processing cadence and frame-skip behavior. |
| **Hold-ref not React state** | The hold timer (`holdRef`) is a plain mutable ref, not React state. This avoids re-renders on every frame and keeps the 60 fps loop smooth. |
| **Lock-after-fire** | `holdRef.locked = true` is set immediately after an action fires. The lock clears only when the gesture changes or the hand disappears, preventing the same action from repeating while the hand is still held. |
| **Centralized action map** | `buildGestureActions()` returns a single `GESTURE_ACTIONS` object. Adding a new gesture → app mapping requires changing exactly one place. |
| **Dual-canvas drawing** | `drawAllHands()` clears the canvas once per frame and iterates all detected hands. Right hand uses blue, left hand uses teal, consistent with the existing design language. |
| **Browser + native dual approach for Office** | `window.open('https://excel.new')` works in any browser immediately; the Python server simultaneously tries `ms-excel:` URI and known install paths for the native app. |
| **Scale-independent geometry** | All distance thresholds are normalized against wrist-to-middle-MCP hand size, so gestures work regardless of hand distance from the camera. |
| **Auto-reconnect WebSocket** | The `useSystemBridge` hook retries every 3 s, so users can start `server.py` after the frontend is open and it connects automatically. |
| **State machine for system control** | `SystemControlEngine` is a pure state machine with no React dependencies, making it testable and preventing accidental side effects from rendering. |
| **Single active mode** | Only one control mode (Volume/Brightness/Scroll/Media) can be active at a time. This prevents conflicting actions (e.g., volume and scroll both responding to vertical hand movement). |
| **Throttled dispatch** | Volume, brightness, and scroll commands are throttled at 40–80 ms intervals to prevent flooding the Windows audio/display APIs. |
| **Pinch hysteresis** | The pinch detector uses separate open/close thresholds (0.14 vs 0.09 × handScale) to prevent rapid toggling when the thumb-index distance hovers near a single threshold. |

---

## 🔧 Configuration Constants

All key thresholds are exported from `gestureEngine.js` and `gestureConfig.js` and easy to adjust:

```js
// gestureEngine.js
export const GESTURE_CONFIDENCE_THRESHOLD = 0.72;  // min confidence to start hold timer
export const GESTURE_HOLD_DURATION = 1500;          // ms to hold before action fires
export const ACTION_COOLDOWN_MS = 8000;             // ms before same action can fire again
export const FIST_HOLD_MS    = 1500;                // fist → Chrome hold duration
export const PEACE_HOLD_MS   = 1200;                // peace → Spotify hold duration
export const VOL_THROTTLE_MS =   80;                // max volume update frequency
export const CMD_COOLDOWN_MS = 8000;                // min ms between same command re-firing

// gestureConfig.js
confidenceThreshold: 0.72,       // minimum confidence for system control
holdDurationMs: 900,             // hold time for discrete media/mute commands
actionCooldownMs: 1500,          // cooldown for discrete actions
movementSensitivity: 1.35,       // vertical displacement multiplier
movementSmoothingAlpha: 0.35,    // smoothing for level updates
deadZoneY: 0.02,                 // noise filter dead zone
scrollSpeed: 120,                // base mouse wheel delta
maxScrollSpeedMultiplier: 4,     // max velocity scaling

// server.py
VOLUME_THROTTLE_S     = 0.04     // 40 ms between volume commands
BRIGHTNESS_THROTTLE_S = 0.08     // 80 ms between brightness commands
SCROLL_THROTTLE_S     = 0.03     // 30 ms between scroll commands
```

### Adding a New Gesture Action

1. **Extend `buildGestureActions()`** in `App.jsx`:

```js
MY_GESTURE: {
  label:  'Open Notepad',
  emoji:  '📝',
  hint:   'My Gesture · Hold 1.5s',
  holdMs: 1500,
  fire:   (wsOpen) => { if (wsOpen) sendCommand('open_notepad'); return 'open_notepad'; },
},
```

2. **Add the handler** in `server.py`:

```python
elif action == "open_notepad":
    subprocess.Popen(["notepad.exe"], creationflags=subprocess.CREATE_NO_WINDOW)
    result = {"status": "ok", "message": "Notepad launched"}
```

---

## 🧪 Running Tests

```bash
node tests/test_engine.js
```

Expected output:
```
--- TEST 1: Default State ---
--- TEST 2: Enable & Modes ---
--- TEST 3: Volume Calibration & Movement ---
--- TEST 4: Scroll Mode ---
--- TEST 5: Hand Disappearance Safety ---
--- ALL UNIT TESTS PASSED SUCCESSFULLY! ---
```

---

## 📊 Performance Characteristics

| Metric | Value |
|---|---|
| **Frame rate** | 30–60 fps (depends on hardware + model complexity) |
| **MediaPipe model complexity** | 0 (fastest) |
| **Detection confidence** | 0.65 minimum |
| **Tracking confidence** | 0.55 minimum |
| **Max simultaneous hands** | 2 (42 landmarks total) |
| **EMA smoothing alpha** | 0.55 (balance of responsiveness and stability) |
| **Model download** | ~10–15 MB (WASM + model weights, cached after first load) |
| **WebSocket latency** | < 5 ms (localhost) |
| **Volume command throttle** | 40 ms (25 commands/sec max) |
| **Brightness command throttle** | 80 ms (12.5 commands/sec max) |
| **Scroll command throttle** | 30 ms (33 commands/sec max) |

---

## 🔮 Future Improvements

- [x] ~~**Multi-hand support**~~ — ✅ Done in v3.0: both hands tracked simultaneously
- [x] ~~**Expanded gesture library**~~ — ✅ Done in v3.0: 13 gestures + combo detection
- [x] ~~**Excel / PowerPoint control**~~ — ✅ Done in v3.0
- [x] ~~**System-wide volume control**~~ — ✅ Done: pycaw integration
- [x] ~~**Display brightness control**~~ — ✅ Done: WMI integration
- [x] ~~**System-wide scrolling**~~ — ✅ Done: user32 mouse_event injection
- [x] ~~**Media playback control**~~ — ✅ Done: virtual media key simulation
- [ ] **Custom gesture trainer** — Record and label personal gestures and train a lightweight classifier.
- [ ] **macOS / Linux OS bridge** — Extend `server.py` with cross-platform audio and app-launch APIs.
- [ ] **Gesture profiles** — Save and switch gesture→action mappings per application context.
- [ ] **3D depth interaction** — Use the Z-axis of landmarks for depth-based selection (push gestures).
- [ ] **Voice + gesture fusion** — Combine speech commands with gesture for richer interaction.
- [ ] **Mobile PWA** — Adapt the frontend for mobile browsers using the rear camera.
- [ ] **Gesture macro recording** — Record sequences of gestures as replayable macros.
- [ ] **Multi-monitor brightness** — Extend WMI brightness control to enumerate and adjust multiple displays.
- [ ] **Gesture-based text input** — Map finger spelling or drawing gestures to text entry.

---

## 👥 Team / Contributors

| Name | Contributions |
|---|---|
| **Sahil Srivastava** ⭐ | Core architecture & majority of implementation — Dual-hand pipeline, Gesture Engine (`gestureEngine.js`), System Control Engine (`systemControlEngine.js`, `gestureConfig.js`), WebSocket OS Bridge (`useSystemBridge.js` + `server.py`), MediaPipe RAF pipeline, EMA landmark smoothing, two-hand combo classification, hold-to-activate system, lock-after-fire logic, Excel/PowerPoint integration, pinch hysteresis, swipe detection, volume control (pycaw), brightness control (WMI), system-wide scrolling (user32), media key simulation, drag-and-drop Kanban logic, hold-progress HUDs, full UI integration (`App.jsx`), Hero landing page with hand constellation SVG, Python backend (volume, brightness, scroll, media, app launchers), Vite build config, `.gitignore`, deployment |
| **Sneha Singh** | Project ideation, UI layout direction, `App.css` component styling, Kanban board design, `index.css` design system tokens, README co-authoring |
| **Riya Raghav** | Testing & QA, gesture accuracy validation, documentation review, demo coordination |

---

## 📄 License

This project is licensed under the **MIT License** — feel free to fork, modify, and use it in your own projects with attribution.

---

<div align="center">
  Made with ❤️ and 🤌 using React 19, MediaPipe Hands, Python, and Vite
</div>
