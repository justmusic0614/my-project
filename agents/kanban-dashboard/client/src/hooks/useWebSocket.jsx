import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const listenersRef = useRef(new Map());
  const reconnectDelay = useRef(RECONNECT_DELAY);
  const reconnectTimer = useRef(null);

  const subscribe = useCallback((type, callback) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type).add(callback);
    return () => {
      listenersRef.current.get(type)?.delete(callback);
    };
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_DELAY;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Dispatch to type-specific listeners
        const typeListeners = listenersRef.current.get(msg.type);
        if (typeListeners) {
          typeListeners.forEach(cb => cb(msg.data, msg));
        }
        // Also dispatch to wildcard listeners
        const wildcardListeners = listenersRef.current.get('*');
        if (wildcardListeners) {
          wildcardListeners.forEach(cb => cb(msg.data, msg));
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWS(type, callback) {
  const ctx = useContext(WebSocketContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx) return;
    const handler = (data, msg) => callbackRef.current(data, msg);
    return ctx.subscribe(type, handler);
  }, [ctx, type]);

  return ctx ? ctx.connected : false;
}

export default function useWebSocketStatus() {
  const ctx = useContext(WebSocketContext);
  return ctx ? ctx.connected : false;
}
