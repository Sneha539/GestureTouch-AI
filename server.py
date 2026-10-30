"""
server.py — GestureOS Python OS Controller
==========================================
WebSocket server that receives gesture commands from the React frontend
and executes system-level actions on Windows:
  1. Master Volume Control & Mute (pycaw / Windows Audio Endpoint)
  2. Display Brightness (WMI Monitor Brightness)
  3. System-Wide Scrolling (user32 mouse_event)
  4. Media Playback Control (user32 keybd_event virtual media keys)
  5. Application Launchers (Spotify, Chrome, Excel, PowerPoint)

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

# ── Windows User32 (Mouse & Keyboard injection) ───────────────────────────────
_user32 = None
try:
    import ctypes
    _user32 = ctypes.windll.user32
except Exception as e:
    print(f"[WARN] user32 not available: {e}")

MOUSEEVENTF_WHEEL   = 0x0800
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_PLAY_PAUSE = 0xCD
VK_VOLUME_MUTE      = 0xAD
KEYEVENTF_KEYUP     = 0x0002

MEDIA_COMMANDS = {
    "play_pause": VK_MEDIA_PLAY_PAUSE,
    "next_track": VK_MEDIA_NEXT_TRACK,
    "prev_track": VK_MEDIA_PREV_TRACK,
    "mute":       VK_VOLUME_MUTE,
}

# ── Windows Volume (pycaw) ────────────────────────────────────────────────────
PYCAW_OK = False
_volume_interface = None

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
            speakers = AudioUtilities.GetSpeakers()
            # Modern pycaw (2024+)
            if hasattr(speakers, "EndpointVolume") and speakers.EndpointVolume:
                _volume_interface = speakers.EndpointVolume
            elif hasattr(speakers, "_dev") and hasattr(speakers._dev, "Activate"):
                interface = speakers._dev.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                _volume_interface = cast(interface, POINTER(IAudioEndpointVolume))
            elif hasattr(speakers, "Activate"):
                interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                _volume_interface = cast(interface, POINTER(IAudioEndpointVolume))
        except Exception as e:
            print(f"[ERROR] Could not init audio interface: {e}")
    return _volume_interface

def get_volume_info() -> dict:
    """Get current master volume (0-100) and mute status."""
    vol = _get_volume_interface()
    if vol:
        try:
            scalar = vol.GetMasterVolumeLevelScalar()
            muted = bool(vol.GetMute())
            return {"level": round(scalar * 100), "muted": muted, "supported": True}
        except Exception as e:
            return {"error": str(e), "supported": False}
    return {"level": 50, "muted": False, "supported": False, "simulated": True}

def set_volume(level: int) -> dict:
    """Set Windows master volume. level = 0-100."""
    scalar = max(0.0, min(1.0, level / 100.0))
    vol = _get_volume_interface()
    if vol:
        try:
            vol.SetMasterVolumeLevelScalar(scalar, None)
            muted = bool(vol.GetMute())
            return {"status": "ok", "level": level, "muted": muted, "message": f"Volume -> {level}%"}
        except Exception as e:
            return {"status": "error", "message": f"Volume error: {e}"}
    else:
        try:
            nircmd_level = int(scalar * 65535)
            subprocess.Popen(
                ['nircmd', 'setsysvolume', str(nircmd_level)],
                creationflags=subprocess.CREATE_NO_WINDOW,
                stderr=subprocess.DEVNULL,
            )
            return {"status": "ok", "level": level, "simulated": True, "message": f"Volume (nircmd) -> {level}%"}
        except FileNotFoundError:
            return {"status": "simulated", "level": level, "message": f"Volume simulated -> {level}%"}

def toggle_mute(state=None) -> dict:
    """Toggle or set master mute state."""
    vol = _get_volume_interface()
    if vol:
        try:
            current = bool(vol.GetMute())
            new_state = (not current) if state is None else bool(state)
            vol.SetMute(int(new_state), None)
            return {"status": "ok", "muted": new_state, "message": f"Mute -> {new_state}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return {"status": "simulated", "muted": not state if state is not None else False}

# ── Windows Brightness (WMI Monitor Brightness) ───────────────────────────────
_wmi_interface = None
_brightness_tested = False
_brightness_supported = False

def _get_wmi():
    global _wmi_interface
    if _wmi_interface is None:
        try:
            import comtypes.client
            _wmi_interface = comtypes.client.CoGetObject(r'winmgmts:\\.\root\wmi')
        except Exception as e:
            print(f"[WARN] WMI init failed: {e}")
    return _wmi_interface

def get_brightness_info() -> dict:
    """Read physical/internal display brightness (0-100)."""
    global _brightness_tested, _brightness_supported
    wmi = _get_wmi()
    if wmi:
        try:
            q = wmi.ExecQuery('SELECT CurrentBrightness FROM WmiMonitorBrightness')
            for m in q:
                val = int(m.Properties_['CurrentBrightness'].Value)
                _brightness_tested = True
                _brightness_supported = True
                return {"level": val, "supported": True}
        except Exception:
            pass

    # Fallback to PowerShell CIM instance
    try:
        res = subprocess.run(
            ['powershell', '-NoProfile', '-Command', '(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop).CurrentBrightness'],
            capture_output=True, text=True, timeout=3
        )
        val = res.stdout.strip()
        if val.isdigit():
            _brightness_tested = True
            _brightness_supported = True
            return {"level": int(val), "supported": True}
    except Exception:
        pass

    _brightness_tested = True
    _brightness_supported = False
    return {"level": None, "supported": False, "message": "Display does not support WMI brightness control"}

def set_brightness(level: int) -> dict:
    """Set physical display brightness (0-100)."""
    level = max(0, min(100, int(level)))
    wmi = _get_wmi()
    if wmi:
        try:
            for m in wmi.InstancesOf('WmiMonitorBrightnessMethods'):
                in_params = m.Methods_['WmiSetBrightness'].InParameters.SpawnInstance_()
                in_params.Properties_['Timeout'].Value = 1
                in_params.Properties_['Brightness'].Value = level
                m.ExecMethod_('WmiSetBrightness', in_params)
                return {"status": "ok", "level": level, "supported": True, "message": f"Brightness -> {level}%"}
        except Exception:
            pass

    # Fallback via PowerShell
    try:
        cmd = f"(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods).WmiSetBrightness(1, {level})"
        subprocess.run(['powershell', '-NoProfile', '-Command', cmd], capture_output=True, timeout=3)
        return {"status": "ok", "level": level, "supported": True, "message": f"Brightness -> {level}%"}
    except Exception as e:
        return {"status": "error", "message": f"Brightness adjustment failed: {e}", "supported": False}

# ── Scrolling (user32.mouse_event) ───────────────────────────────────────────
def send_scroll(delta: int) -> dict:
    """Send mouse wheel scroll. delta > 0 = UP, delta < 0 = DOWN."""
    if _user32:
        clamped = max(-1200, min(1200, int(delta)))
        _user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, clamped, 0)
        return {"status": "ok", "delta": clamped, "message": f"Scroll -> {clamped}"}
    return {"status": "error", "message": "mouse_event unavailable", "supported": False}

# ── Media Playback (user32.keybd_event) ───────────────────────────────────────
def send_media_command(command: str) -> dict:
    """Trigger system-wide media key."""
    vk = MEDIA_COMMANDS.get(command)
    if not vk:
        return {"status": "error", "message": f"Unknown media command: {command}"}
    if _user32:
        _user32.keybd_event(vk, 0, 0, 0)
        time.sleep(0.02)
        _user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        return {"status": "ok", "command": command, "message": f"Media -> {command}"}
    return {"status": "error", "message": "keybd_event unavailable", "supported": False}

# ── System Capabilities & Status ─────────────────────────────────────────────
def get_system_status() -> dict:
    vol_info = get_volume_info()
    br_info = get_brightness_info()
    return {
        "status": "ok",
        "os": sys.platform,
        "capabilities": {
            "volume": vol_info.get("supported", False),
            "brightness": br_info.get("supported", False),
            "scroll": bool(_user32),
            "media": bool(_user32),
        },
        "volume": vol_info.get("level", 50),
        "muted": vol_info.get("muted", False),
        "brightness": br_info.get("level", 70),
    }

# ── App launchers ─────────────────────────────────────────────────────────────
def open_spotify() -> str:
    try:
        os.startfile("spotify:")
        return "Spotify launched (URI)"
    except Exception:
        pass

    candidates = [
        os.path.expandvars(r"%APPDATA%\Spotify\Spotify.exe"),
        r"C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_*\Spotify.exe",
        r"C:\Users\Public\Desktop\Spotify.lnk",
    ]
    for path in candidates:
        if os.path.exists(path):
            subprocess.Popen([path], creationflags=subprocess.CREATE_NO_WINDOW)
            return f"Spotify launched ({path})"

    try:
        subprocess.Popen(["cmd", "/c", "start", "spotify:"], creationflags=subprocess.CREATE_NO_WINDOW)
        return "Spotify launched (shell)"
    except Exception as e:
        return f"Spotify launch failed: {e}"

def open_chrome() -> str:
    try:
        subprocess.Popen(["cmd", "/c", "start", "chrome"], creationflags=subprocess.CREATE_NO_WINDOW)
        return "Chrome launched (shell)"
    except Exception:
        pass

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

def open_excel() -> str:
    try:
        os.startfile("ms-excel:")
        return "Excel launched (ms-excel URI)"
    except Exception:
        pass

    excel_paths = [
        os.path.expandvars(r"%ProgramFiles%\Microsoft Office\root\Office16\EXCEL.EXE"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft Office\root\Office16\EXCEL.EXE"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft Office\Office16\EXCEL.EXE"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft Office\Office15\EXCEL.EXE"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft Office\Office16\EXCEL.EXE"),
    ]
    for path in excel_paths:
        if os.path.exists(path):
            subprocess.Popen([path], creationflags=subprocess.CREATE_NO_WINDOW)
            return f"Excel launched ({path})"

    try:
        subprocess.Popen(["cmd", "/c", "start", "excel"], creationflags=subprocess.CREATE_NO_WINDOW)
        return "Excel launched (shell)"
    except Exception as e:
        return f"Excel not found — browser will open excel.new ({e})"

def open_powerpoint() -> str:
    try:
        os.startfile("ms-powerpoint:")
        return "PowerPoint launched (ms-powerpoint URI)"
    except Exception:
        pass

    ppt_paths = [
        os.path.expandvars(r"%ProgramFiles%\Microsoft Office\root\Office16\POWERPNT.EXE"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft Office\root\Office16\POWERPNT.EXE"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft Office\Office16\POWERPNT.EXE"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft Office\Office15\POWERPNT.EXE"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft Office\Office16\POWERPNT.EXE"),
    ]
    for path in ppt_paths:
        if os.path.exists(path):
            subprocess.Popen([path], creationflags=subprocess.CREATE_NO_WINDOW)
            return f"PowerPoint launched ({path})"

    try:
        subprocess.Popen(["cmd", "/c", "start", "powerpnt"], creationflags=subprocess.CREATE_NO_WINDOW)
        return "PowerPoint launched (shell)"
    except Exception as e:
        return f"PowerPoint not found — browser will open powerpoint.new ({e})"

# ── Throttles ─────────────────────────────────────────────────────────────────
_last_volume_call     = 0.0
_last_brightness_call = 0.0
_last_scroll_call     = 0.0
VOLUME_THROTTLE_S     = 0.04
BRIGHTNESS_THROTTLE_S = 0.08
SCROLL_THROTTLE_S     = 0.03

# ── WebSocket handler ─────────────────────────────────────────────────────────
async def handler(websocket):
    global _last_volume_call, _last_brightness_call, _last_scroll_call
    remote = websocket.remote_address
    print(f"[+] Connected: {remote[0]}:{remote[1]}")

    try:
        async for raw in websocket:
            try:
                data   = json.loads(raw)
                action = data.get("action", "")
                result = {"status": "error", "message": "unknown action"}

                if action == "get_system_status" or action == "get_capabilities":
                    result = get_system_status()

                elif action == "get_volume":
                    result = get_volume_info()

                elif action == "set_volume":
                    now = time.monotonic()
                    if now - _last_volume_call >= VOLUME_THROTTLE_S:
                        _last_volume_call = now
                        level = max(0, min(100, int(data.get("level", 50))))
                        result = set_volume(level)
                    else:
                        result = {"status": "throttled", "action": action}

                elif action == "set_mute":
                    state = data.get("muted")
                    result = toggle_mute(state)

                elif action == "get_brightness":
                    result = get_brightness_info()

                elif action == "set_brightness":
                    now = time.monotonic()
                    if now - _last_brightness_call >= BRIGHTNESS_THROTTLE_S:
                        _last_brightness_call = now
                        level = max(0, min(100, int(data.get("level", 70))))
                        result = set_brightness(level)
                    else:
                        result = {"status": "throttled", "action": action}

                elif action == "scroll":
                    now = time.monotonic()
                    if now - _last_scroll_call >= SCROLL_THROTTLE_S:
                        _last_scroll_call = now
                        delta = int(data.get("delta", 0))
                        result = send_scroll(delta)
                    else:
                        result = {"status": "throttled", "action": action}

                elif action == "media_command":
                    cmd = data.get("command", "")
                    result = send_media_command(cmd)

                elif action == "open_spotify":
                    res_str = open_spotify()
                    result = {"status": "ok", "message": res_str}

                elif action == "open_chrome":
                    res_str = open_chrome()
                    result = {"status": "ok", "message": res_str}

                elif action == "open_excel":
                    res_str = open_excel()
                    result = {"status": "ok", "message": res_str}

                elif action == "open_powerpoint":
                    res_str = open_powerpoint()
                    result = {"status": "ok", "message": res_str}

                # Log non-continuous or completed actions
                if action not in ("scroll", "set_volume") or result.get("status") != "throttled":
                    msg = result.get("message") or result.get("status", "ok")
                    print(f"  [{action}] {msg}")

                response_payload = {
                    "action": action,
                    **result
                }
                await websocket.send(json.dumps(response_payload))

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
    vol_info = get_volume_info()
    br_info = get_brightness_info()
    print("=" * 56)
    print("  GestureTouch-AI — System-Wide OS Controller")
    print(f"  WebSocket   ->  ws://{HOST}:{PORT}")
    print(f"  Volume      ->  {'pycaw (active)' if vol_info.get('supported') else 'simulated'}")
    print(f"  Brightness  ->  {'WMI (active)' if br_info.get('supported') else 'unsupported'}")
    print(f"  Scroll      ->  {'user32.mouse_event (active)' if _user32 else 'unavailable'}")
    print(f"  Media Keys  ->  {'user32.keybd_event (active)' if _user32 else 'unavailable'}")
    print("=" * 56)
    print("  Waiting for browser connection...")
    print("  Press Ctrl+C to stop.\n")

    async with websockets.serve(handler, HOST, PORT,
                                 ping_interval=20,
                                 ping_timeout=10):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[GestureOS] Server stopped.")
