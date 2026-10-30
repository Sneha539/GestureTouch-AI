/**
 * useSystemBridge.js
 * WebSocket hook that connects React → Python OS controller.
 * Auto-reconnects every 3s on disconnect.
 * Queries and syncs system volume, physical display brightness, and capability status.
 */
import { useRef, useState, useEffect, useCallback } from 'react';

const WS_URL = 'ws://localhost:8765';

export function useSystemBridge() {
  const wsRef          = useRef(null);
  const reconnectTimer = useRef(null);

  const [wsStatus,         setWsStatus]         = useState('disconnected'); // 'connected'|'disconnected'|'connecting'
  const [capabilities,     setCapabilities]     = useState({ volume: false, brightness: false, scroll: false, media: false });
  const [systemVolume,     setSystemVolume]     = useState(null);
  const [systemMuted,      setSystemMuted]      = useState(false);
  const [systemBrightness, setSystemBrightness] = useState(null);
  const [lastAction,       setLastAction]       = useState(null);

  const sendCommand = useCallback((action, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, ...payload }));
      return true;
    }
    return false;
  }, []);

  const refreshStatus = useCallback(() => {
    sendCommand('get_system_status');
  }, [sendCommand]);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setWsStatus('connecting');
      try {
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          if (!cancelled) {
            setWsStatus('connected');
            // Query status & capabilities immediately upon connecting
            ws.send(JSON.stringify({ action: 'get_system_status' }));
          }
        };

        ws.onmessage = (e) => {
          try {
            const data = jsonParse(e.data);
            if (!data || cancelled) return;

            // Handle system status / capabilities sync
            if (data.action === 'get_system_status' && data.capabilities) {
              setCapabilities(data.capabilities);
              if (typeof data.volume === 'number')     setSystemVolume(data.volume);
              if (typeof data.muted === 'boolean')     setSystemMuted(data.muted);
              if (typeof data.brightness === 'number') setSystemBrightness(data.brightness);
            }

            // Sync volume updates
            if (data.action === 'set_volume' || data.action === 'get_volume') {
              if (typeof data.level === 'number')  setSystemVolume(data.level);
              if (typeof data.muted === 'boolean') setSystemMuted(data.muted);
            }

            // Sync mute updates
            if (data.action === 'set_mute') {
              if (typeof data.muted === 'boolean') setSystemMuted(data.muted);
            }

            // Sync brightness updates
            if (data.action === 'set_brightness' || data.action === 'get_brightness') {
              if (typeof data.level === 'number') setSystemBrightness(data.level);
            }

            // Update lastAction log
            if (data.action && data.action !== 'get_system_status' && data.status !== 'throttled') {
              setLastAction({
                ...data,
                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
              });
            }
          } catch {
            /* ignore malformed messages */
          }
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

  return {
    wsStatus,
    capabilities,
    systemVolume,
    systemMuted,
    systemBrightness,
    lastAction,
    sendCommand,
    refreshStatus,
  };
}

function jsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
