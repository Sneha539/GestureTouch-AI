"""
server.py — GestureOS Python OS Controller
==========================================
WebSocket server that receives gesture commands from the React frontend
and executes system-level actions on Windows.

Commands accepted (JSON):
  {"action": "set_volume", "level": 0-100}
  {"action": "open_spotify"}
  {"action": "open_chrome"}

Usage:
  pip install -r requirements.txt
  python server.py
"""

import asyncio
import json
import os
import subprocess
import sys
import time

# ── Dependency check ──────────────────────────────────────────────────────────
try:
    import websockets
except ImportError:
    print("[ERROR] websockets not installed. Run: pip install -r requirements.txt")
    sys.exit(1)

# ── Windows Volume (pycaw) ────────────────────────────────────────────────────
PYCAW_OK = False
_volume_interface = None  # cached to avoid re-initializing every call

try:
    from ctypes import cast, POINTER
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    PYCAW_OK = True
except ImportError:
    print("[WARN] pycaw / comtypes not installed. Volume control will be simulated.")
    print("       Run: pip install pycaw comtypes")

def _get_volume_interface():
    """Lazily initialize and cache the pycaw IAudioEndpointVolume interface."""
    global _volume_interface
    if _volume_interface is None and PYCAW_OK:
        try:
            devices   = AudioUtilities.GetSpeakers()
            interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            _volume_interface = cast(interface, POINTER(IAudioEndpointVolume))
        except Exception as e:
            print(f"[ERROR] Could not init audio interface: {e}")
    return _volume_interface

def set_volume(level: int) -> str:
    """Set Windows master volume. level = 0-100."""
    scalar = max(0.0, min(1.0, level / 100.0))
    vol = _get_volume_interface()
    if vol:
        try:
            vol.SetMasterVolumeLevelScalar(scalar, None)
            return f"Volume → {level}%"
        except Exception as e:
            return f"Volume error: {e}"
    else:
        # Fallback: nircmd (if installed) or just log
        try:
            nircmd_level = int(scalar * 65535)
            subprocess.Popen(
                ['nircmd', 'setsysvolume', str(nircmd_level)],
                creationflags=subprocess.CREATE_NO_WINDOW,
                stderr=subprocess.DEVNULL,
            )
            return f"Volume (nircmd) → {level}%"
        except FileNotFoundError:
            print(f"[Volume] Simulated → {level}%  (install pycaw for real control)")
            return f"Volume simulated → {level}%"

# ── App launchers ─────────────────────────────────────────────────────────────

def open_spotify() -> str:
    """Open Spotify via URI scheme (works if Spotify is installed)."""
    # Method 1: URI scheme — opens Spotify to home screen
    try:
        os.startfile("spotify:")
        return "Spotify launched (URI)"
    except Exception:
        pass

    # Method 2: Direct executable
    candidates = [
        os.path.expandvars(r"%APPDATA%\Spotify\Spotify.exe"),
        r"C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_*\Spotify.exe",  # MS Store version
        r"C:\Users\Public\Desktop\Spotify.lnk",
    ]
    for path in candidates:
        if os.path.exists(path):
            subprocess.Popen([path], creationflags=subprocess.CREATE_NO_WINDOW)
            return f"Spotify launched ({path})"

    # Method 3: Shell command
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "spotify:"],
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return "Spotify launched (shell)"
    except Exception as e:
        return f"Spotify launch failed: {e}"

def open_chrome() -> str:
    """Open Google Chrome."""
    # Method 1: Shell "start chrome" (works if chrome is in PATH / registry)
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "chrome"],
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return "Chrome launched (shell)"
    except Exception:
        pass

    # Method 2: Known install paths
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for path in chrome_paths:
        if os.path.exists(path):
            subprocess.Popen([path], creationflags=subprocess.CREATE_NO_WINDOW)
            return f"Chrome launched ({path})"

    return "Chrome not found — add chrome.exe to PATH"

# ── Throttle: prevent volume spam flooding the OS ─────────────────────────────
_last_volume_call  = 0.0
VOLUME_THROTTLE_S  = 0.05   # max one volume change per 50ms at server side

# ── WebSocket handler ─────────────────────────────────────────────────────────
async def handler(websocket):
    global _last_volume_call
    remote = websocket.remote_address
    print(f"[+] Connected: {remote[0]}:{remote[1]}")

    try:
        async for raw in websocket:
            try:
                data   = json.loads(raw)
                action = data.get("action", "")
                result = "unknown action"

                if action == "set_volume":
                    now = time.monotonic()
                    if now - _last_volume_call >= VOLUME_THROTTLE_S:
                        _last_volume_call = now
                        level  = max(0, min(100, int(data.get("level", 50))))
                        result = set_volume(level)
                    else:
                        result = "throttled"

                elif action == "open_spotify":
                    result = open_spotify()

                elif action == "open_chrome":
                    result = open_chrome()

                print(f"  [{action}] {result}")
                await websocket.send(json.dumps({"status": "ok", "action": action, "result": result}))

            except json.JSONDecodeError:
                await websocket.send(json.dumps({"status": "error", "message": "invalid JSON"}))
            except Exception as e:
                await websocket.send(json.dumps({"status": "error", "message": str(e)}))

    except websockets.exceptions.ConnectionClosedOK:
        pass
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        print(f"[-] Disconnected: {remote[0]}:{remote[1]}")

# ── Main ──────────────────────────────────────────────────────────────────────
HOST = "localhost"
PORT = 8765

async def main():
    print("=" * 52)
    print("  GestureOS Python OS Controller")
    print(f"  WebSocket  ->  ws://{HOST}:{PORT}")
    print(f"  Volume     ->  {'pycaw (real)' if PYCAW_OK else 'simulated (install pycaw)'}")
    print("=" * 52)
    print("  Waiting for browser connection...")
    print("  Press Ctrl+C to stop.\n")

    async with websockets.serve(handler, HOST, PORT,
                                 ping_interval=20,
                                 ping_timeout=10):
        await asyncio.Future()   # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[GestureOS] Server stopped.")
