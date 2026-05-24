import { useEffect, useRef, useState } from 'react';
import type { WsMessage } from '../types';
import { WS_URL } from '../api/client';

type Handler = (msg: WsMessage) => void;

// Module-level singleton — one WS connection shared across all hook instances
const handlers = new Set<Handler>();
const connectedListeners = new Set<(c: boolean) => void>();
let isConnected = false;
let retryDelay = 1000;

function notifyConnected(c: boolean) {
  isConnected = c;
  connectedListeners.forEach(fn => fn(c));
}

function startWs() {
  if (!WS_URL) {
    console.warn('[useWebSocket] VITE_WS_URL is not set — WebSocket disabled, polling active');
    return;
  }
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    retryDelay = 1000;
    notifyConnected(true);
  };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data as string) as WsMessage;
      handlers.forEach(h => h(msg));
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    notifyConnected(false);
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, 30_000);
      startWs();
    }, retryDelay);
  };

  ws.onerror = () => ws.close();
}

if (typeof window !== 'undefined') startWs();

export function useWebSocket(onMessage?: Handler): { connected: boolean } {
  const [connected, setConnected] = useState(isConnected);
  const ref = useRef(onMessage);
  ref.current = onMessage;

  useEffect(() => {
    const connListener = (c: boolean) => setConnected(c);
    connectedListeners.add(connListener);

    // Stable handler wrapper — always calls the latest onMessage via ref
    const handler: Handler = (msg) => ref.current?.(msg);
    if (onMessage !== undefined) handlers.add(handler);

    return () => {
      connectedListeners.delete(connListener);
      handlers.delete(handler);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { connected };
}
