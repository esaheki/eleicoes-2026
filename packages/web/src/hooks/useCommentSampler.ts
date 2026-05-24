import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchSamples } from '../api/client';
import { useWebSocket } from './useWebSocket';
import type { SampleData, WsMessage } from '../types';

interface Filters {
  source?: string;
  candidate?: string;
  sentiment?: string;
  credibility?: string;
  paused: boolean;
}

export function useCommentSampler(filters: Filters) {
  const [samples, setSamples] = useState<SampleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bufferedCount, setBufferedCount] = useState(0);
  const buffer = useRef<SampleData[]>([]);
  const pausedRef = useRef(filters.paused);
  pausedRef.current = filters.paused;

  const prepend = useCallback((incoming: SampleData[]) => {
    setSamples(prev => [...incoming, ...prev].slice(0, 50));
  }, []);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== 'new_sample_batch') return;
      if (pausedRef.current) {
        buffer.current = [...msg.samples, ...buffer.current].slice(0, 100);
        setBufferedCount(buffer.current.length);
      } else {
        prepend(msg.samples);
      }
    },
    [prepend],
  );

  useWebSocket(handleMessage);

  const { source, candidate, sentiment, credibility } = filters;

  useEffect(() => {
    buffer.current = [];
    setBufferedCount(0);
    setLoading(true);
    setSamples([]);
    fetchSamples({ source, candidate, sentiment, credibility, limit: 20 })
      .then(data => { setSamples(data); setError(null); })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [source, candidate, sentiment, credibility]);

  const flush = useCallback(() => {
    prepend(buffer.current);
    buffer.current = [];
    setBufferedCount(0);
  }, [prepend]);

  return { samples, loading, error, bufferedCount, flush };
}
