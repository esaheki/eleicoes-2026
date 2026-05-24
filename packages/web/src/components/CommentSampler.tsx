import { useState, useCallback } from 'react';
import { useCommentSampler } from '../hooks/useCommentSampler';
import { FakeInfoBadge } from './FakeInfoBadge';
import { SourceIcon } from './SourceIcon';
import { CANDIDATES, CANDIDATE_COLORS } from '../types';
import type { SampleData, Candidate } from '../types';

const SOURCES = ['Todos', 'YouTube', 'X/Twitter', 'Notícias'] as const;
const SOURCE_MAP: Record<string, string> = {
  YouTube: 'youtube', 'X/Twitter': 'twitter', Notícias: 'news',
};
const SENTIMENTS = ['Todos', 'Positivo', 'Negativo', 'Neutro'] as const;
const SENTIMENT_MAP: Record<string, string> = {
  Positivo: 'POSITIVE', Negativo: 'NEGATIVE', Neutro: 'NEUTRAL',
};
const CREDIBILITIES = ['Todos', 'Verificável', 'Suspeito', 'Falso provável'] as const;
const CRED_MAP: Record<string, string> = {
  Verificável: 'CREDIBLE', Suspeito: 'SUSPICIOUS', 'Falso provável': 'LIKELY_FALSE',
};
const CANDIDATE_OPTIONS = ['Todos', ...CANDIDATES] as const;

function relative(ts: string): string {
  const t = new Date(ts).getTime();
  if (!ts || isNaN(t)) return '—';
  const diff = Math.round((Date.now() - t) / 60_000);
  if (diff < 1) return 'agora';
  if (diff < 60) return `há ${diff} min`;
  return `há ${Math.round(diff / 60)}h`;
}

function sentimentBar(s: string) {
  if (s === 'POSITIVE') return 'bg-green-500';
  if (s === 'NEGATIVE') return 'bg-red-400';
  return 'bg-gray-300';
}

interface PillGroupProps {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  renderLabel?: (opt: string, active: boolean) => React.ReactNode;
}

function PillGroup({ options, value, onChange, renderLabel }: PillGroupProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => {
        const active = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors ${
              active
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
            }`}
          >
            {renderLabel ? renderLabel(opt, active) : opt}
          </button>
        );
      })}
    </div>
  );
}

interface CardProps {
  sample: SampleData;
  hashtagFilter?: string;
}

function CommentCard({ sample, hashtagFilter }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = CANDIDATE_COLORS[sample.candidate as Candidate];
  const isFalse = sample.credibility_label === 'LIKELY_FALSE';

  if (hashtagFilter && !sample.text.toLowerCase().includes(hashtagFilter.toLowerCase())) {
    return null;
  }

  return (
    <div
      className={`flex gap-3 p-3.5 rounded-lg border animate-slide-in ${
        isFalse
          ? 'border-t-2 border-t-red-400 bg-amber-50 border-x-gray-100 border-b-gray-100'
          : 'border-gray-100 bg-white'
      }`}
    >
      <div className={`w-1 rounded-full flex-shrink-0 self-stretch ${sentimentBar(sample.sentiment)}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
          <SourceIcon source={sample.source} />
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: color }}
          >
            {sample.candidate}
          </span>
        </div>

        {sample.video_title && (
          <a
            href={sample.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline block mb-1.5 truncate"
          >
            ▶ {sample.video_title}
          </a>
        )}

        <p className={`text-sm text-gray-800 leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`}>
          {sample.text}
        </p>

        {isFalse && sample.flag_reasoning && expanded && (
          <p className="text-xs text-amber-700 italic mt-2">
            ⚠ Alegação não verificada: {sample.flag_reasoning}
          </p>
        )}

        <button
          className="text-xs text-blue-400 hover:text-blue-600 mt-1.5"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'ver menos' : 'ver mais'}
        </button>

        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          <span className="text-xs text-gray-400">{relative(sample.timestamp)}</span>
          {sample.url && (
            <a
              href={sample.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
              title="Ver publicação original"
            >
              ↗ original
            </a>
          )}
          <FakeInfoBadge
            credibility_label={sample.credibility_label}
            credibility_score={sample.credibility_score}
            flags={sample.flags}
            flag_reasoning={sample.flag_reasoning}
          />
        </div>
      </div>
    </div>
  );
}

interface Props {
  hashtagFilter?: string;
}

export function CommentSampler({ hashtagFilter }: Props) {
  const [source, setSource] = useState('Todos');
  const [candidate, setCandidate] = useState('Todos');
  const [sentiment, setSentiment] = useState('Todos');
  const [credibility, setCredibility] = useState('Todos');
  const [paused, setPaused] = useState(false);

  const { samples, loading, error, bufferedCount, flush } = useCommentSampler({
    source: source === 'Todos' ? undefined : SOURCE_MAP[source],
    candidate: candidate === 'Todos' ? undefined : candidate,
    sentiment: sentiment === 'Todos' ? undefined : SENTIMENT_MAP[sentiment],
    credibility: credibility === 'Todos' ? undefined : CRED_MAP[credibility],
    paused,
  });

  const handleResume = useCallback(() => {
    flush();
    setPaused(false);
  }, [flush]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
          Amostra ao vivo de comentários
        </h3>
        <button
          onClick={() => (paused ? handleResume() : setPaused(true))}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            paused
              ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400'
          }`}
        >
          {paused
            ? `▶ Retomar${bufferedCount > 0 ? ` · ${bufferedCount} novos` : ''}`
            : '⏸ Pausar'}
        </button>
      </div>

      <div className="space-y-2 mb-4">
        <PillGroup
          options={SOURCES}
          value={source}
          onChange={setSource}
          renderLabel={(opt, active) =>
            opt === 'Todos'
              ? opt
              : <SourceIcon source={SOURCE_MAP[opt] ?? opt} className={active ? '!text-white' : ''} />
          }
        />
        <PillGroup options={CANDIDATE_OPTIONS} value={candidate} onChange={setCandidate} />
        <PillGroup options={SENTIMENTS} value={sentiment} onChange={setSentiment} />
        <PillGroup options={CREDIBILITIES} value={credibility} onChange={setCredibility} />
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-50 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-500 py-4">{error}</p>}

      {!loading && !error && samples.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">
          👻 Nenhum comentário encontrado para estes filtros.
        </p>
      )}

      {!loading && samples.length > 0 && (
        <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
          {samples.map((s, i) => (
            <CommentCard
              key={`${s.timestamp}-${i}`}
              sample={s}
              hashtagFilter={hashtagFilter}
            />
          ))}
        </div>
      )}
    </div>
  );
}
