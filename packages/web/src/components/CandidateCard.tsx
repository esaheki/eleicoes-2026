import { useState, useId, useEffect, useRef } from 'react';
import type { ScoreData, Candidate } from '../types';
import { CANDIDATE_COLORS, CANDIDATE_PARTIES } from '../types';

export function CandidateCard({ candidate, score, delta, positive, negative, neutral, total }: ScoreData) {
  const [showTip, setShowTip] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const tipId = useId();
  const color = CANDIDATE_COLORS[candidate as Candidate];
  const party = CANDIDATE_PARTIES[candidate as Candidate];
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 500);
    return () => clearTimeout(t);
  }, [score]);

  const pctPos = total ? Math.round((positive / total) * 100) : 0;
  const pctNeg = total ? Math.round((negative / total) * 100) : 0;
  const pctNeu = 100 - pctPos - pctNeg;

  return (
    <div
      className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md hover:scale-[1.01] transition-all duration-200 overflow-hidden relative"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div
        className="absolute top-0 right-0 w-24 h-24 rounded-bl-full opacity-[0.04] pointer-events-none"
        style={{ backgroundColor: color }}
      />

      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 text-sm leading-tight truncate">{candidate}</div>
          <span
            className="inline-block text-xs font-bold px-2 py-0.5 rounded-full text-white mt-1.5"
            style={{ backgroundColor: color }}
          >
            {party}
          </span>
        </div>

        <div className="text-right flex-shrink-0 ml-3">
          <div
            className={`text-4xl font-extrabold tabular-nums leading-none ${flashing ? 'animate-score-flash' : ''}`}
            style={{ color }}
          >
            {score}
            <span className="text-base font-normal text-gray-400">%</span>
          </div>
          <div className="flex items-center gap-1.5 justify-end mt-1">
            {delta !== undefined && delta !== 0 && (
              <span
                className="text-xs font-semibold tabular-nums"
                style={{ color: delta > 0 ? '#16a34a' : '#dc2626' }}
              >
                {delta > 0 ? `+${delta}` : delta} {delta > 0 ? '▲' : '▼'}
              </span>
            )}
            <span className="text-xs text-gray-400">positivo</span>
            <div className="relative">
              <button
                className="text-gray-300 hover:text-gray-500 text-xs leading-none focus:outline-none"
                onMouseEnter={() => setShowTip(true)}
                onMouseLeave={() => setShowTip(false)}
                onFocus={() => setShowTip(true)}
                onBlur={() => setShowTip(false)}
                aria-label="Explicação do score"
                aria-describedby={tipId}
              >
                ⓘ
              </button>
              {showTip && (
                <div
                  id={tipId}
                  role="tooltip"
                  className="absolute right-0 bottom-6 w-52 bg-gray-800 text-white text-xs rounded-md p-2 z-10 shadow-lg"
                >
                  Percentagem de menções positivas na última 1 hora.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-3 rounded-full overflow-hidden flex gap-px">
        <div className="bg-green-500 h-full transition-all duration-500 rounded-l-full" style={{ width: `${pctPos}%` }} />
        <div className="bg-gray-100 h-full transition-all duration-500" style={{ width: `${pctNeu}%` }} />
        <div className="bg-red-400 h-full transition-all duration-500 rounded-r-full" style={{ width: `${pctNeg}%` }} />
      </div>

      <div className="flex justify-between mt-2.5">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
          <span className="text-xs text-gray-500">{pctPos}% pos.</span>
        </div>
        <span className="text-xs text-gray-400">{total.toLocaleString('pt-BR')} menções</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">{pctNeg}% neg.</span>
          <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}
