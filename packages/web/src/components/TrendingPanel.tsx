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

  const maxCount = items[0]?.count ?? 1;

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

      <ol className="space-y-0.5">
        {items.map((item, i) => {
          const barWidth = Math.round((item.count / maxCount) * 100);
          const rankColor = i === 0 ? '#f59e0b' : i === 1 ? '#9ca3af' : i === 2 ? '#b45309' : '#4b5563';
          return (
            <li key={item.hashtag} className="relative">
              {/* Volume bar behind the row */}
              <div
                className="absolute inset-y-0 left-0 rounded-md opacity-[0.12] pointer-events-none transition-all duration-500"
                style={{ width: `${barWidth}%`, backgroundColor: rankColor }}
              />
              <button
                onClick={() => onHashtagClick?.(item.hashtag)}
                className="relative w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-800 transition-colors group"
              >
                <span
                  className="text-xs font-bold tabular-nums w-4 text-right flex-shrink-0"
                  style={{ color: rankColor }}
                >
                  {i + 1}
                </span>
                <span className="text-xs text-gray-300 group-hover:text-white transition-colors truncate flex-1">
                  {item.hashtag}
                </span>
                <span className="text-xs text-gray-500 flex-shrink-0">{formatCount(item.count)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
