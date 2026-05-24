import { useState, useId } from 'react';
import type { ScoreData, Candidate } from '../types';
import { CANDIDATE_COLORS, CANDIDATE_PARTIES } from '../types';

function scoreColor(score: number) {
  if (score >= 60) return 'text-green-600';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-500';
}

export function CandidateCard({ candidate, score, positive, negative, neutral, total }: ScoreData) {
  const [showTip, setShowTip] = useState(false);
  const tipId = useId();
  const color = CANDIDATE_COLORS[candidate as Candidate];
  const party = CANDIDATE_PARTIES[candidate as Candidate];

  const pctPos = total ? Math.round((positive / total) * 100) : 0;
  const pctNeg = total ? Math.round((negative / total) * 100) : 0;
  const pctNeu = 100 - pctPos - pctNeg;

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 text-sm leading-tight truncate">{candidate}</div>
          <span
            className="inline-block text-xs font-bold px-2 py-0.5 rounded-full text-white mt-1"
            style={{ backgroundColor: color }}
          >
            {party}
          </span>
        </div>

        <div className="text-right flex-shrink-0 ml-2">
          <div className={`text-3xl font-bold tabular-nums ${scoreColor(score)}`}>
            {score}<span className="text-sm font-normal text-gray-400">%</span>
          </div>
          <div className="flex items-center gap-1 justify-end mt-0.5">
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
                  Percentagem de menções positivas nas últimas 1 hora.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-2 rounded-full overflow-hidden flex">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${pctPos}%` }} />
        <div className="bg-gray-200 h-full transition-all" style={{ width: `${pctNeu}%` }} />
        <div className="bg-red-400 h-full transition-all" style={{ width: `${pctNeg}%` }} />
      </div>

      <div className="flex justify-between text-xs text-gray-400 mt-1.5">
        <span>{positive.toLocaleString('pt-BR')} pos.</span>
        <span>{total.toLocaleString('pt-BR')} total</span>
        <span>{negative.toLocaleString('pt-BR')} neg.</span>
      </div>
    </div>
  );
}
