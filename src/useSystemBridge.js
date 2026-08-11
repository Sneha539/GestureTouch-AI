/**
 * useSystemBridge.js
 * WebSocket hook that connects React → Python OS controller.
 * Auto-reconnects every 3s on disconnect.
 */
import { useRef, useState, useEffect, useCallback } from 'react';

const WS_URL = 'ws://localhost:8765';

export function useSystemBridge() {
  const wsRef          = useRef(null);
  const reconnectTimer = useRef(null);

  const [wsStatus,    setWsStatus]    = useState('disconnected'); // 'connected'|'disconnected'|'connecting'
  const [lastAction,  setLastAction]  = useState(null);           // { action, status, time }

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setWsStatus('connecting');
      try {
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          if (!cancelled) setWsStatus('connected');
        };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (!cancelled) {
              setLastAction({
                ...data,
                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
              });
            }
          } catch { /* ignore malformed messages */ }
        };

        ws.onclose = () => {
          if (!cancelled) {
            setWsStatus('disconnected');
            reconnectTimer.current = setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => ws.close();
        wsRef.current = ws;
      } catch {
        if (!cancelled) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  /**
   * Send a command to the Python bridge.
   * Returns true if sent, false if not connected.
   */
  const sendCommand = useCallback((action, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, ...payload }));
      return true;
    }
    return false;
  }, []);

  return { wsStatus, lastAction, sendCommand };
}
