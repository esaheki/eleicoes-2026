import { useState, useEffect } from 'react';
import { fetchTrending } from '../api/client';
import type { TrendingItem } from '../types';

interface Props {
  onHashtagClick?: (tag: string) => void;
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function TrendingPanel({ onHashtagClick }: Props) {
  const [items, setItems] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetchTrending()
        .then(data => setItems(data))
        .catch(() => { /* silent — retry next interval */ })
        .finally(() => setLoading(false));

    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1">
        <span>🕐</span> Trending agora
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-700 rounded animate-pulse" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="text-xs text-gray-600">Sem dados no momento.</p>
      )}

      <ol className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.hashtag}>
            <button
              onClick={() => onHashtagClick?.(item.hashtag)}
              className="w-full text-left text-xs text-gray-300 hover:text-white transition-colors group"
            >
              <span className="text-gray-600 mr-1">#{i + 1}</span>
              <span className="group-hover:underline">{item.hashtag}</span>
              <span className="text-gray-500 ml-1">— {formatCount(item.count)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
