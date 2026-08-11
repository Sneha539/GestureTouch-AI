# 🖐️ GestureTouch-AI

<div align="center">

![GestureTouch-AI](https://img.shields.io/badge/GestureTouch--AI-v2.0-FF4D1C?style=for-the-badge&logo=hand-paper&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Hands-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**AI-powered, touchless human-computer interaction using real-time 3D hand gesture recognition.**  
Control your OS, drag-and-drop UI elements, adjust volume, and launch apps — all with hand gestures detected through your webcam. No extra hardware required.

[Features](#-key-features) · [How It Works](#-how-the-system-works) · [Setup](#-installation--setup) · [Usage](#-usage-guide) · [Tech Stack](#-technologies--libraries)

</div>

---

## 📖 Project Overview

**GestureTouch-AI** is a full-stack, browser-based gesture control system that uses Google's MediaPipe Hands to track 21 hand landmarks in real time via your webcam. A React + Vite frontend processes the hand skeleton and classifies gestures frame-by-frame. A lightweight Python WebSocket server bridges the browser to the Windows OS, enabling genuine system-level actions like volume control, launching Chrome, and opening Spotify — all without touching your keyboard or mouse.

The system is designed for environments where touchless interaction is essential or preferred: sterile medical settings, accessible computing, presentation control, and futuristic desktop experiences.

---

## 🎯 Problem Statement

Traditional computing interfaces rely entirely on physical input devices — keyboards, mice, or touchscreens. These create friction in scenarios where:

- **Sterile/medical environments** where touching peripherals risks contamination.
- **Accessibility needs** limit fine motor control.
- **Presentation or creative workflows** require hands-free navigation.
- **Novelty & immersion** in interactive exhibits or installations.

GestureTouch-AI eliminates the need for physical contact with input devices by enabling the human hand itself to become the controller, captured by a standard webcam and interpreted by cutting-edge AI models running entirely in the browser.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🤌 **Pinch-to-Select** | Touch thumb and index finger together to select or initiate drag |
| ✊ **Fist Drag-and-Drop** | Make a fist to grab Kanban tiles and drag them across columns |
| ☝️ **Point-to-Volume** | Raise index finger and move hand up/down to control system volume in real time |
| ✌️ **Peace → Spotify** | Hold the peace sign for 1.2 s to launch Spotify via URI scheme |
| ✊ **Fist → Chrome** | Hold a fist for 1.5 s to open Google Chrome |
| ← → ↑ ↓ **Swipe Detection** | Swipe your palm in any direction to log directional events |
| 📊 **Live Stats Panel** | Displays detected gesture, FPS, pinch strength, and landmark count |
| 🔗 **WebSocket OS Bridge** | Python server bridges gestures to real Windows OS actions with auto-reconnect |
| 🎛️ **Hold-Progress HUDs** | Visual arc/bar indicators show how long you've held a gesture before it fires |
| 🩺 **Medical Kanban Demo** | Built-in drag-and-drop board (Queue → In Progress → Done) controlled entirely by hand |

---

## ⚙️ How the System Works

```
Webcam  ──►  MediaPipe Hands (CDN, WASM)
                   │
                   ▼ 21 3D landmarks (x, y, z)
          ┌─────────────────────┐
          │  gestureEngine.js   │  ← EMA smoothing, geometry helpers,
          │  (pure functions)   │    finger extension, pinch detection,
          └─────────────────────┘    swipe detection, pose classification
                   │
                   ▼ Gesture label + metadata
          ┌─────────────────────┐
          │     App.jsx         │  ← React state, RAF loop, drag-and-drop,
          │   (main UI loop)    │    landmark drawing on Canvas overlay
          └─────────────────────┘
                   │
                   ▼ JSON command (action, payload)
          ┌─────────────────────┐
          │  useSystemBridge.js │  ← WebSocket client, auto-reconnect (3 s)
          └─────────────────────┘
                   │  ws://localhost:8765
                   ▼
          ┌─────────────────────┐
          │    server.py        │  ← Python asyncio WebSocket server
          │  (Windows OS ctrl)  │    pycaw volume, Spotify URI, Chrome launch
          └─────────────────────┘
```

### Gesture Pipeline (per frame, ~30 fps)

1. **Capture** — `requestAnimationFrame` loop feeds each video frame to MediaPipe Hands.
2. **Detect** — MediaPipe returns 21 normalized (x, y, z) landmarks for each visible hand.
3. **Smooth** — An Exponential Moving Average (EMA) filter removes jitter from raw MediaPipe output.
4. **Classify** — `gestureEngine.js` computes finger extension states, pinch ratio, palm velocity, and returns a gesture label (`PINCH`, `PEACE`, `FIST`, `OPEN_HAND`, `POINT`, `PINKY`, `CUSTOM`, `NONE`).
5. **Act** — `App.jsx` maps each label to UI actions (drag, swipe log, hold timer) and/or OS commands sent over WebSocket.
6. **Execute** — `server.py` receives JSON commands and executes system-level operations (pycaw volume, `os.startfile`, `subprocess`).

---

## 🧩 Technologies & Libraries

### Frontend
| Library | Version | Purpose |
|---|---|---|
| **React** | 19 | Component state & rendering |
| **Vite** | 8 | Dev server, HMR, bundler |
| **@mediapipe/hands** | 0.4 (CDN) | Real-time 21-point 3D hand tracking |
| **@mediapipe/camera_utils** | 0.3 | Camera stream helpers |
| **@mediapipe/drawing_utils** | 0.3 | Landmark drawing utilities |
| **Inter (Google Fonts)** | — | UI typography |
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
├── index.html               # Entry HTML — loads Inter font & MediaPipe CDN script
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
    ├── App.jsx              # Main application — MediaPipe loop, gesture mapping, UI
    ├── App.css              # Component-level styles (nav, video, kanban, sys cards)
    ├── gestureEngine.js     # Pure gesture math: EMA, pinch, swipe, classify, volume
    ├── useSystemBridge.js   # WebSocket hook — connects React to Python OS bridge
    └── assets/
        ├── hero.png         # Hero image asset
        ├── react.svg        # React logo
        └── vite.svg         # Vite logo
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

> The frontend gesture visualizer works on macOS/Linux too, but OS control (volume, Spotify, Chrome) requires Windows and the Python server.

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

> If `pycaw` fails to install, volume control falls back to simulation mode (a log message is shown). All other gestures still work.

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
| 🟢 **Bridge Online** | Python WebSocket server is connected |
| 🔴 **Bridge Offline** | Run `python server.py` to enable OS actions |
| **N fps** | Real-time processing speed |

### Gesture Reference

| Gesture | How to do it | Action |
|---|---|---|
| ☝️ **Point** | Extend only your index finger, curl others | Move hand **up/down** to control system volume |
| ✌️ **Peace** | Extend index + middle finger | **Hold for 1.2 s** → Opens Spotify |
| ✊ **Fist** | Curl all fingers into a fist | **Hold for 1.5 s** → Opens Chrome (or grab tile) |
| 🤌 **Pinch** | Touch thumb tip to index tip | Selects / prepares drag |
| 🖐️ **Open Hand** | Extend all 4 fingers + thumb | Releases dragged tile to hovered column |
| ← → ↑ ↓ **Swipe** | Move open hand quickly in any direction | Logged in Event Log panel |

### Drag-and-Drop (Kanban Board)

1. **Make a fist** near a Kanban tile — the grab cursor turns orange when a tile is picked up.
2. **Keep the fist closed** and move your hand to the target column (highlighted in orange dashes).
3. **Open your hand** over the column to drop the tile.

### Volume Control

1. **Extend only your index finger** (Point gesture).
2. **Raise your hand** toward the top of the frame → 100%.
3. **Lower your hand** toward the bottom → 0%.
4. A vertical bar on the video overlay and the System Control card both reflect the current level.

### Launching Apps (OS Bridge required)

- **Spotify:** Hold the ✌️ Peace sign. A progress bar fills over 1.2 s, then fires once and cools down for 5 s.
- **Chrome:** Hold ✊ Fist (without grabbing a tile). A progress bar fills over 1.5 s, then fires.

---

## 🗺️ Architecture Decisions

- **No Camera utility wrapper** — MediaPipe's `Camera` helper was dropped in favor of a direct `requestAnimationFrame` loop. This avoids timing conflicts and gives full control over processing cadence.
- **EMA smoothing** — Raw MediaPipe output jitters between frames. An Exponential Moving Average (alpha ≈ 0.55) stabilizes landmarks without adding perceptible lag.
- **Hysteresis for pinch** — The pinch detector uses two thresholds (open/closed ratio vs hand scale) to prevent rapid toggling at boundary values.
- **Scale-independent geometry** — All distance thresholds are normalized against wrist-to-middle-MCP hand size, so the system works regardless of how close or far the hand is from the camera.
- **Throttle & cooldown** — Volume commands are throttled to max 1 per 80 ms on the frontend and 50 ms on the Python side. App-launch commands enforce a 5 s cooldown to prevent accidental re-fires.
- **Auto-reconnect WebSocket** — The `useSystemBridge` hook retries the WebSocket connection every 3 s, so users can start `server.py` after the frontend is open and it connects automatically.

---

## 🔮 Future Improvements

- [ ] **Multi-hand support** — Map two-hand gestures (e.g., pinch zoom with both hands).
- [ ] **Custom gesture trainer** — Record and label personal gestures and train a lightweight classifier.
- [ ] **macOS / Linux OS bridge** — Extend `server.py` with cross-platform audio and app-launch APIs.
- [ ] **Gesture profiles** — Save and switch gesture→action mappings per application context.
- [ ] **3D depth interaction** — Use the Z-axis of landmarks for depth-based selection (push gestures).
- [ ] **Voice + gesture fusion** — Combine speech commands with gesture for richer interaction.
- [ ] **Mobile PWA** — Adapt the frontend for mobile browsers using the rear camera.
- [ ] **Gesture macro recording** — Record sequences of gestures as replayable macros.
- [ ] **Confidence heatmap** — Visualize per-landmark tracking confidence in the overlay.
- [ ] **Unit tests for gestureEngine** — The pure-function architecture already makes this straightforward.

---

## 👥 Team / Contributors

| Name | Role |
|---|---|
| **Sneha** | Project Lead, Frontend Architect |
| **Sahil** | Gesture Engine & OS Bridge Engineer |

---

## 📄 License

This project is licensed under the **MIT License** — feel free to fork, modify, and use it in your own projects with attribution.

---

<div align="center">
  Made with ❤️ and 🤌 using React, MediaPipe, and Python
</div>
