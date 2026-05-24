import { useState, useEffect, useCallback } from 'react';
import { fetchScores } from '../api/client';
import { useWebSocket } from './useWebSocket';
import type { ScoreData, WsMessage } from '../types';

export function useScores() {
  const [scores, setScores] = useState<ScoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchScores();
      setScores(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'score_update') return;
    setScores(prev =>
      prev.map(s =>
        s.candidate === msg.candidate
          ? { ...s, score: msg.score, positive: msg.positive, negative: msg.negative, neutral: msg.neutral, total: msg.total }
          : s,
      ),
    );
  }, []);

  const { connected } = useWebSocket(handleMessage);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling fallback — only active when WS is disconnected
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [connected, load]);

  return { scores, loading, error, wsConnected: connected };
}
