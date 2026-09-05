# 🖐️ GestureTouch-AI

<div align="center">

![GestureTouch-AI](https://img.shields.io/badge/GestureTouch--AI-v3.0-FF4D1C?style=for-the-badge&logo=hand-paper&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Hands-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**AI-powered, touchless human-computer interaction using real-time dual-hand gesture recognition.**  
Track **both hands simultaneously**, recognize 13+ gestures, and launch apps like Excel and PowerPoint — all with natural hand gestures detected through your webcam. No extra hardware required.

[Features](#-key-features) · [How It Works](#-how-the-system-works) · [Gestures](#-gesture-reference) · [Setup](#-installation--setup) · [Usage](#-usage-guide) · [Tech Stack](#-technologies--libraries)

</div>

---

## 📖 Project Overview

**GestureTouch-AI** is a full-stack, browser-based gesture control system that uses Google's MediaPipe Hands to track **up to 42 hand landmarks** (21 per hand) in real time via your webcam. A React + Vite frontend processes both hand skeletons simultaneously, classifies 13+ individual gestures, detects two-hand combo gestures, and triggers hold-to-activate actions. A lightweight Python WebSocket server bridges the browser to the Windows OS, enabling genuine system-level actions like volume control, launching Chrome, Spotify, Excel, and PowerPoint — all without touching your keyboard or mouse.

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
| 🎨 **Color-coded Skeleton** | Right hand rendered in **blue**, left hand in **teal** — same design language, visually distinct |
| 🤌 **13+ Gesture Library** | PINCH, PEACE, FIST, OPEN PALM, POINT, THUMBS UP, THUMBS DOWN, OK, ROCK, CALL ME, THREE, FOUR, PINKY |
| ⚡ **Two-Hand Combos** | Combined gestures: DOUBLE THUMBS UP, DOUBLE PEACE, DOUBLE FIST, FIST+PALM, and more |
| ⏱️ **Hold-to-Activate** | Gestures must be held stably for a configurable duration before actions fire — prevents accidents |
| 🔒 **Lock-After-Fire** | After an action triggers, it locks until the gesture is released — no repeated launches |
| 📊 **Open Excel** | Hold both Thumbs Up for 1.5 s → opens Excel online (`excel.new`) + tries native Office |
| 📊 **Open PowerPoint** | Hold both Peace signs for 1.5 s → opens PowerPoint online (`powerpoint.new`) + tries native Office |
| ✊ **Fist Drag-and-Drop** | Make a fist to grab Kanban tiles and drag them across columns |
| ☝️ **Point-to-Volume** | Raise index finger and move hand up/down to control system volume in real time |
| ✌️ **Peace → Spotify** | Hold the peace sign for 1.2 s to launch Spotify via URI scheme |
| ✊ **Fist → Chrome** | Hold a fist for 1.5 s to open Google Chrome |
| ← → ↑ ↓ **Swipe Detection** | Swipe your palm in any direction to log directional events |
| 📈 **Live Two-Hand Stats Panel** | Per-hand gesture + confidence display, real landmark count (21 or 42), FPS counter |
| 🔗 **WebSocket OS Bridge** | Python server bridges gestures to real Windows OS actions with auto-reconnect |
| 🎛️ **Hold-Progress HUDs** | Inline progress bar with time countdown (e.g. `0.8s / 1.5s`) before actions fire |
| 🩺 **Medical Kanban Demo** | Built-in drag-and-drop board (Queue → In Progress → Done) controlled entirely by hand |

---

## ⚙️ How the System Works

```
Webcam  ──►  MediaPipe Hands (CDN, WASM, maxNumHands=2)
                   │
                   ▼ Up to 42 3D landmarks + handedness labels
          ┌─────────────────────────────────────────┐
          │           gestureEngine.js              │
          │  - EMA smoothing (per hand)             │
          │  - classifySingleHand() → 13 gestures   │
          │  - classifyTwoHands()  → combo gestures │
          │  - detectPinch() / detectSwipe()        │
          │  - getVolumeFromIndex()                 │
          └─────────────────────────────────────────┘
                   │
                   ▼ { gesture, confidence } per hand + combo
          ┌─────────────────────────────────────────┐
          │               App.jsx                   │
          │  - holdRef: centralized hold timer      │
          │  - GESTURE_ACTIONS map (configurable)   │
          │  - Lock-after-fire prevention           │
          │  - Two-hand canvas drawing              │
          │  - Drag-and-drop / volume / swipe       │
          └─────────────────────────────────────────┘
                   │
                   ▼ JSON command (action, payload)
          ┌─────────────────────────────────────────┐
          │         useSystemBridge.js              │
          │  WebSocket client — auto-reconnect 3 s  │
          └─────────────────────────────────────────┘
                   │  ws://localhost:8765
                   ▼
          ┌─────────────────────────────────────────┐
          │             server.py                   │
          │  Python asyncio WebSocket server        │
          │  pycaw volume · Spotify · Chrome        │
          │  ms-excel: URI · ms-powerpoint: URI     │
          │  Office install paths fallback          │
          └─────────────────────────────────────────┘
```

### Gesture Pipeline (per frame, ~30-60 fps)

1. **Capture** — `requestAnimationFrame` loop feeds each video frame to MediaPipe Hands.
2. **Detect** — MediaPipe returns up to 42 normalized (x, y, z) landmarks + handedness labels.
3. **Smooth** — Independent EMA filters per hand remove jitter from raw MediaPipe output.
4. **Classify (single)** — `classifySingleHand()` computes finger extension, pinch ratio, thumb direction, and returns a gesture label + confidence score (0–1).
5. **Classify (combo)** — `classifyTwoHands()` checks if both hands form a known pair (e.g. both THUMBS_UP → DOUBLE_THUMBS_UP).
6. **Hold** — `holdRef` accumulates how long the gesture has been stable. Actions only fire after `GESTURE_HOLD_DURATION` (1.5 s) at `confidence ≥ 0.72`.
7. **Lock** — After an action fires, `holdRef.locked = true` prevents re-triggering until the gesture is released.
8. **Act** — `GESTURE_ACTIONS` map calls `window.open()` (browser) and/or `sendCommand()` (Python bridge).
9. **Execute** — `server.py` receives JSON commands and executes system-level operations.

---

## 🧩 Technologies & Libraries

### Frontend
| Library | Version | Purpose |
|---|---|---|
| **React** | 19 | Component state & rendering |
| **Vite** | 8 | Dev server, HMR, bundler |
| **@mediapipe/hands** | 0.4 (CDN) | Real-time 21-point 3D hand tracking, up to 2 hands |
| **Space Grotesk (Google Fonts)** | — | UI typography |
| **JetBrains Mono (Google Fonts)** | — | Technical readouts |
| **Vanilla CSS** | — | All styling (no Tailwind / CSS-in-JS) |

### Backend
| Library | Version | Purpose |
|---|---|---|
| **Python** | ≥ 3.9 | Runtime |
| **websockets** | ≥ 12.0 | Async WebSocket server |
| **pycaw** | ≥ 20240210 | Windows audio endpoint volume control |
| **comtypes** | ≥ 1.4.1 | COM interface bindings for pycaw |

> **Note:** MediaPipe Hands is loaded from the jsDelivr CDN as a browser global because it ships CommonJS packages incompatible with Vite's ESM bundler. The Python server is Windows-only (pycaw / COM); the frontend works on any OS.

---

## 📁 Project Structure

```
GestureTouch-AI/
├── index.html               # Entry HTML — loads fonts & MediaPipe CDN script
├── vite.config.js           # Vite config — MediaPipe externalized from bundle
├── package.json             # npm dependencies & scripts
├── requirements.txt         # Python dependencies
├── server.py                # Python asyncio WebSocket OS controller
├── start_server.bat         # Windows helper: installs deps & starts server.py
├── .gitignore               # Ignores node_modules, venv, dist, secrets, etc.
│
├── public/
│   ├── favicon.svg          # App favicon (hand icon)
│   └── icons.svg            # SVG sprite for UI icons
│
└── src/
    ├── main.jsx             # React app entry point
    ├── index.css            # Global design tokens, reset, base components
    ├── App.jsx              # Main app — dual-hand pipeline, gesture mapping, UI
    ├── App.css              # Component styles (nav, video, kanban, hand panels)
    ├── gestureEngine.js     # Pure gesture math: EMA, pinch, swipe, classify (13 gestures), combos
    ├── useSystemBridge.js   # WebSocket hook — connects React to Python OS bridge
    └── assets/
        └── react.svg        # React logo
```

---

## 🚀 Installation & Setup

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Python | ≥ 3.9 |
| pip | latest |
| Webcam | Any USB/built-in camera |
| OS | Windows 10/11 (for OS control features) |

> The frontend gesture visualizer works on macOS/Linux too, but OS control (volume, Spotify, Chrome, Excel, PowerPoint) requires Windows and the Python server.

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

### Step 3 — Install Python Dependencies

```bash
pip install -r requirements.txt
```

This installs:
- `websockets` — WebSocket server
- `pycaw` — Windows audio volume control
- `comtypes` — COM bindings required by pycaw

> If `pycaw` fails to install, volume control falls back to simulation mode. All other gestures still work.

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
====================================================
  GestureOS Python OS Controller
  WebSocket  ->  ws://localhost:8765
  Volume     ->  pycaw (real)
====================================================
  Waiting for browser connection...
  Press Ctrl+C to stop.
```

### Terminal 2 — Start the React Frontend

```bash
npm run dev
```

Then open **http://localhost:5173** in your browser.

> **Allow camera access** when prompted by the browser. MediaPipe models are downloaded from CDN on first load (~10–15 MB, cached afterwards).

---

## 🎮 Usage Guide

### Status Indicators (top nav bar)

| Badge | Meaning |
|---|---|
| 🟢 **Camera** | Webcam is active and MediaPipe is running |
| **N hands** | Number of hands currently tracked (0, 1, or 2) |
| 🟢 **Bridge Online** | Python WebSocket server is connected |
| 🔴 **Bridge Offline** | Run `python server.py` to enable OS actions |
| **N fps** | Real-time processing speed |

---

## ✋ Gesture Reference

### Single-Hand Gestures

| Gesture | How to do it | Detected Label |
|---|---|---|
| ✊ **Fist** | Curl all fingers, thumb in | `FIST` |
| 👍 **Thumbs Up** | Fist with thumb pointing up | `THUMBS_UP` |
| 👎 **Thumbs Down** | Fist with thumb pointing down | `THUMBS_DOWN` |
| 🖐️ **Open Palm** | Extend all 4 fingers + thumb | `OPEN_PALM` |
| ☝️ **Point** | Extend only index finger | `POINT` |
| ✌️ **Peace** | Extend index + middle | `PEACE` |
| 🤟 **Three** | Extend index + middle + ring | `THREE` |
| 🖖 **Four** | Extend index + middle + ring + pinky | `FOUR` |
| 🤌 **Pinch** | Touch thumb tip to index tip | `PINCH` |
| 👌 **OK** | Pinch + other 3 fingers extended | `OK` |
| 🤘 **Rock** | Extend index + pinky, curl middle + ring | `ROCK` |
| 🤙 **Call Me** | Extend thumb + pinky | `CALL_ME` |
| 🤙 **Pinky** | Extend only pinky | `PINKY` |

### Two-Hand Combo Gestures

| Combo | Detection | Label |
|---|---|---|
| 👍👍 **Double Thumbs Up** | Both hands: THUMBS_UP | `DOUBLE_THUMBS_UP` |
| ✌✌ **Double Peace** | Both hands: PEACE | `DOUBLE_PEACE` |
| ✊✊ **Double Fist** | Both hands: FIST | `DOUBLE_FIST` |
| 🖐🖐 **Both Palms** | Both hands: OPEN_PALM | `DOUBLE_OPEN_PALM` |
| ✊🖐 **Fist + Palm** | One FIST + one OPEN_PALM | `FIST_PALM` |

### Gesture → Action Map

| Gesture | Hold Duration | Action |
|---|---|---|
| 👍👍 **Double Thumbs Up** | 1.5 s | Open Microsoft Excel (web + native attempt) |
| ✌✌ **Double Peace** | 1.5 s | Open Microsoft PowerPoint (web + native attempt) |
| ✌️ **Peace** (single hand) | 1.2 s | Open Spotify (via Python bridge) |
| ✊ **Fist** (single hand) | 1.5 s | Open Chrome (via Python bridge) |
| ☝️ **Point** | continuous | Adjust system volume (hand height = level) |

---

### Drag-and-Drop (Kanban Board)

1. **Make a fist** near a Kanban tile — the grab cursor turns orange when a tile is picked up.
2. **Keep the fist closed** and move your hand to the target column (highlighted in orange dashes).
3. **Open your hand** over the column to drop the tile.

### Volume Control

1. **Extend only your index finger** (Point gesture).
2. **Raise your hand** toward the top of the frame → 100%.
3. **Lower your hand** toward the bottom → 0%.
4. A vertical bar on the video overlay and the System Control card both reflect the current level.

### Hold-to-Activate

Application-launching gestures require a deliberate hold:

```
Gesture detected
      ↓
Hold timer starts
      ↓
Progress bar fills (e.g. 0.8s / 1.5s)
      ↓
Hold threshold reached
      ↓
Action fires once
      ↓
LOCKED — will not fire again until gesture is released
```

This prevents accidental launches from brief or shaky gesture detection.

---

## 🗺️ Architecture Decisions

- **Two independent smoothing buffers** — Each hand gets its own EMA ref (`smoothedLeftRef`, `smoothedRightRef`), so jitter in one hand doesn't affect the other.
- **MediaPipe handedness labels** — We use MediaPipe's built-in `label` field ("Left"/"Right") rather than inferring side from position, giving reliable identification regardless of where the hand is in the frame.
- **Centralized action map** — `buildGestureActions()` returns a single `GESTURE_ACTIONS` object. Adding a new gesture → app mapping requires changing exactly one place.
- **Hold-ref not React state** — The hold timer (`holdRef`) is a plain mutable ref, not React state. This avoids re-renders on every frame and keeps the 60 fps loop smooth.
- **Lock-after-fire** — `holdRef.locked = true` is set immediately after an action fires. The lock clears only when the gesture changes or the hand disappears, preventing the same action from repeating while the hand is still held.
- **Dual-canvas drawing** — `drawAllHands()` clears the canvas once per frame and iterates all detected hands. Right hand uses blue (`rgba(76,141,255,...)`), left hand uses teal (`rgba(76,200,220,...)`), consistent with the existing design language.
- **Browser + native dual approach for Office** — `window.open('https://excel.new')` works in any browser immediately; the Python server simultaneously tries `ms-excel:` URI and known install paths for the native app.
- **No Camera utility wrapper** — MediaPipe's `Camera` helper was dropped in favor of a direct `requestAnimationFrame` loop for full control over processing cadence.
- **Scale-independent geometry** — All distance thresholds are normalized against wrist-to-middle-MCP hand size, so gestures work regardless of hand distance from the camera.
- **Auto-reconnect WebSocket** — The `useSystemBridge` hook retries every 3 s, so users can start `server.py` after the frontend is open and it connects automatically.

---

## 🔧 Configuration Constants

All key thresholds are exported from `gestureEngine.js` and easy to adjust:

```js
// gestureEngine.js
export const GESTURE_CONFIDENCE_THRESHOLD = 0.72;  // min confidence to start hold timer
export const GESTURE_HOLD_DURATION = 1500;          // ms to hold before action fires
export const ACTION_COOLDOWN_MS = 8000;             // ms before same action can fire again
export const FIST_HOLD_MS    = 1500;                // fist → Chrome hold duration
export const PEACE_HOLD_MS   = 1200;                // peace → Spotify hold duration
export const VOL_THROTTLE_MS =   80;                // max volume update frequency
```

To add a new gesture action, extend `buildGestureActions()` in `App.jsx`:

```js
MY_GESTURE: {
  label:  'Open Notepad',
  emoji:  '📝',
  hint:   'My Gesture · Hold 1.5s',
  holdMs: 1500,
  fire:   (wsOpen) => { if (wsOpen) sendCommand('open_notepad'); return 'open_notepad'; },
},
```

And add the corresponding handler in `server.py`:

```python
elif action == "open_notepad":
    subprocess.Popen(["notepad.exe"], creationflags=subprocess.CREATE_NO_WINDOW)
    result = "Notepad launched"
```

---

## 🔮 Future Improvements

- [x] ~~**Multi-hand support**~~ — ✅ Done in v3.0: both hands tracked simultaneously
- [x] ~~**Expanded gesture library**~~ — ✅ Done in v3.0: 13 gestures + combo detection
- [x] ~~**Excel / PowerPoint control**~~ — ✅ Done in v3.0
- [ ] **Custom gesture trainer** — Record and label personal gestures and train a lightweight classifier.
- [ ] **macOS / Linux OS bridge** — Extend `server.py` with cross-platform audio and app-launch APIs.
- [ ] **Gesture profiles** — Save and switch gesture→action mappings per application context.
- [ ] **3D depth interaction** — Use the Z-axis of landmarks for depth-based selection (push gestures).
- [ ] **Voice + gesture fusion** — Combine speech commands with gesture for richer interaction.
- [ ] **Mobile PWA** — Adapt the frontend for mobile browsers using the rear camera.
- [ ] **Gesture macro recording** — Record sequences of gestures as replayable macros.
- [ ] **Unit tests for gestureEngine** — The pure-function architecture already makes this straightforward.

---

## 👥 Team / Contributors

| Name | Contributions |
|---|---|
| **Sahil Srivastava** ⭐ | Core architecture & majority of implementation — Dual-hand pipeline, Gesture Engine (`gestureEngine.js`), WebSocket OS Bridge (`useSystemBridge.js` + `server.py`), MediaPipe RAF pipeline, landmark smoothing (EMA), two-hand combo detection, hold-to-activate system, lock-after-fire logic, Excel/PowerPoint integration, pinch/swipe/pose detection, volume control, drag-and-drop Kanban logic, hold-progress HUDs, full UI integration (`App.jsx`), Python backend (pycaw, Spotify, Chrome, Excel, PowerPoint), Vite build config, `.gitignore`, deployment |
| **Sneha Singh** | Project ideation, UI layout direction, `App.css` component styling, Kanban board design, `index.css` design system tokens, README co-authoring |
| **Riya Raghav** | Testing & QA, gesture accuracy validation, documentation review, demo coordination |

---

## 📄 License

This project is licensed under the **MIT License** — feel free to fork, modify, and use it in your own projects with attribution.

---

<div align="center">
  Made with ❤️ and 🤌 using React, MediaPipe, and Python
</div>
