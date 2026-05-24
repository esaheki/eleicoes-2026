import { useState, useId } from 'react';
import type { CredibilityLabel } from '../types';

const FLAG_LABELS: Record<string, string> = {
  urna_fraud: 'Fraude na urna',
  candidate_crime: 'Crime atribuído sem fonte',
  vote_buying: 'Compra de votos',
  election_coup: 'Golpe eleitoral',
  fake_quote: 'Citação falsa',
  health_disinfo: 'Desinformação de saúde',
  economic_disinfo: 'Dado econômico falso',
  foreign_interference: 'Interferência estrangeira',
};

interface Props {
  credibility_label: CredibilityLabel;
  credibility_score: number | null;
  flags: string[];
  flag_reasoning?: string;
}

export function FakeInfoBadge({ credibility_label, credibility_score, flags, flag_reasoning }: Props) {
  const [open, setOpen] = useState(false);
  const tipId = useId();

  if (credibility_label === 'CREDIBLE') return null;

  if (credibility_label === 'UNSCORED' || credibility_score === null) {
    return (
      <span className="inline-flex items-center text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
        Não analisado
      </span>
    );
  }

  const flagLabels = flags.map(f => FLAG_LABELS[f] ?? f).join(', ');
  const isFalse = credibility_label === 'LIKELY_FALSE';

  return (
    <span className="relative inline-flex">
      <button
        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full focus:outline-none focus:ring-2 ${
          isFalse
            ? 'bg-red-100 text-red-700 focus:ring-red-300'
            : 'bg-amber-100 text-amber-700 focus:ring-amber-300'
        }`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-describedby={tipId}
      >
        {isFalse ? '✕ Provável desinformação' : '⚠ Suspeito'}
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute bottom-7 left-0 w-56 bg-gray-900 text-white text-xs rounded-md p-2.5 z-20 shadow-xl"
        >
          {flagLabels || 'Conteúdo suspeito'}
          {isFalse && flag_reasoning && (
            <span className="block mt-1 text-gray-300 italic">{flag_reasoning}</span>
          )}
        </span>
      )}
    </span>
  );
}
