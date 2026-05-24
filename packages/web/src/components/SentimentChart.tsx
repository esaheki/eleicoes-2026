import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { fetchHistory } from '../api/client';
import { CANDIDATES, CANDIDATE_COLORS } from '../types';

interface ChartRow {
  label: string;
  [candidate: string]: string | number | undefined;
}

export function SentimentChart() {
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const results = await Promise.allSettled(
          CANDIDATES.map(c => fetchHistory(c, 24).then(pts => ({ candidate: c, pts }))),
        );

        const map = new Map<string, ChartRow>();
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const { candidate, pts } = r.value;
          for (const pt of pts) {
            // pt.window is UTC ISO hour ("2026-05-23T14:00") — convert to Brazil local time
            const label = new Date(pt.window + ':00Z').toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Sao_Paulo',
            });
            if (!map.has(pt.window)) map.set(pt.window, { label, _key: pt.window });
            map.get(pt.window)![candidate] = pt.score;
          }
        }

        setRows([...map.values()].sort((a, b) => (a._key! < b._key! ? -1 : 1)));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="h-72 bg-gray-50 animate-pulse rounded-lg" />;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Histórico de sentimento — 24h</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
          <Tooltip
            formatter={(v: number, name: string) => [`${v}%`, name]}
            labelFormatter={l => `Hora: ${l as string}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {CANDIDATES.map(c => (
            <Line
              key={c}
              type="monotone"
              dataKey={c}
              stroke={CANDIDATE_COLORS[c]}
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
