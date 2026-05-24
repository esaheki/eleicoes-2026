import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { fetchMisinfo } from '../api/client';
import type { MisinfoData } from '../types';

const FLAG_LABELS: Record<string, string> = {
  urna_fraud: 'Fraude na urna',
  candidate_crime: 'Crime s/ fonte',
  vote_buying: 'Compra de votos',
  election_coup: 'Golpe eleitoral',
  fake_quote: 'Citação falsa',
  health_disinfo: 'Desinfo. saúde',
  economic_disinfo: 'Dado econ. falso',
  foreign_interference: 'Interf. estrangeira',
};

function pctColor(pct: number) {
  if (pct > 5) return 'text-red-600';
  if (pct > 2) return 'text-amber-600';
  return 'text-gray-600';
}

function taxaColor(pct: number) {
  if (pct > 8) return 'text-red-600 font-semibold';
  if (pct > 4) return 'text-amber-600 font-semibold';
  return 'text-gray-600';
}

export function MisinfoStats() {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<MisinfoData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetchMisinfo(24)
        .then(d => setData(d))
        .catch(() => { /* silent */ })
        .finally(() => setLoading(false));

    void load();
    const id = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const pct = data?.likely_false_pct ?? 0;
  const topFlags = (data?.top_flags ?? []).map(f => ({
    name: FLAG_LABELS[f.flag] ?? f.flag,
    count: f.count,
  }));
  const topFlagName = data?.top_flags[0]
    ? (FLAG_LABELS[data.top_flags[0].flag] ?? data.top_flags[0].flag)
    : '—';

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-gray-700">
          {expanded ? 'Radar de desinformação — últimas 24h' : 'Desinformação'}
        </span>
        <span className="flex items-center gap-2">
          {!loading && data && (
            <span className={`text-sm font-bold ${pctColor(pct)}`}>
              {pct.toFixed(1)}%{pct > 2 ? ' ⚠' : ''}
            </span>
          )}
          <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4">
          {loading && (
            <div className="space-y-3 pt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-50 rounded animate-pulse" />
              ))}
            </div>
          )}

          {data && !loading && (
            <>
              <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-800">
                    {data.total_scored.toLocaleString('pt-BR')}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Comentários analisados</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold ${pctColor(pct)}`}>
                    {pct.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Provável desinformação</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-gray-800 leading-snug">{topFlagName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Tema mais frequente</div>
                </div>
              </div>

              {topFlags.length > 0 && (
                <div className="mt-4">
                  <ResponsiveContainer width="100%" height={Math.max(140, topFlags.length * 30)}>
                    <BarChart data={topFlags} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} interval={0} />
                      <Tooltip formatter={(v: number) => [v.toLocaleString('pt-BR'), 'ocorrências']} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                        {topFlags.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? '#E24B4A' : '#F59E0B'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {data.by_candidate.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-gray-400 text-left border-b border-gray-100">
                        <th className="pb-2 font-medium">Candidato</th>
                        <th className="pb-2 font-medium text-right">Prov. falso</th>
                        <th className="pb-2 font-medium text-right">Suspeito</th>
                        <th className="pb-2 font-medium text-right">Taxa%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.by_candidate]
                        .sort((a, b) => b.likely_false - a.likely_false)
                        .map(row => {
                          const taxa = row.total ? (row.likely_false / row.total) * 100 : 0;
                          return (
                            <tr key={row.candidate} className="border-b border-gray-50">
                              <td className="py-1.5">{row.candidate}</td>
                              <td className="py-1.5 text-right text-red-500">
                                {row.likely_false.toLocaleString('pt-BR')}
                              </td>
                              <td className="py-1.5 text-right text-amber-500">
                                {row.suspicious.toLocaleString('pt-BR')}
                              </td>
                              <td className={`py-1.5 text-right ${taxaColor(taxa)}`}>
                                {taxa.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
