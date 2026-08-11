@echo off
echo ============================================
echo   GestureOS Python OS Controller
echo ============================================
echo.

:: Install deps if not present
echo [1/2] Checking Python dependencies...
pip install -r requirements.txt --quiet

echo.
echo [2/2] Starting WebSocket server on ws://localhost:8765
echo       Open http://localhost:5173 in your browser.
echo       Press Ctrl+C to stop.
echo.

python server.py
pause
