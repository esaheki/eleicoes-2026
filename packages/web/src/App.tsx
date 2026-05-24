import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { MdDashboard, MdOutlineArticle } from 'react-icons/md';
import { useScores } from './hooks/useScores';
import { CandidateCard } from './components/CandidateCard';
import { SentimentChart } from './components/SentimentChart';
import { CommentSampler } from './components/CommentSampler';
import { MisinfoStats } from './components/MisinfoStats';
import { TrendingPanel } from './components/TrendingPanel';
import { Metodologia } from './pages/Metodologia';
import { CANDIDATE_COLORS } from './types';
import type { Candidate } from './types';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">
        {children}
      </span>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2 text-sm px-3 py-1.5 rounded transition-colors ${
    isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
  }`;
}

function Dashboard({
  scores,
  loading,
  wsConnected,
  hashtagFilter,
}: {
  scores: ReturnType<typeof useScores>['scores'];
  loading: boolean;
  wsConnected: boolean;
  hashtagFilter: string | undefined;
}) {

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 h-5">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            wsConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-300'
          }`}
        />
        <span className="text-xs text-gray-400">
          {wsConnected ? 'Atualizações em tempo real' : 'Atualizando a cada 30s'}
        </span>
      </div>

      <SectionLabel>Placar dos candidatos</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-gray-50 rounded-lg animate-pulse" />
            ))
          : scores.map(s => <CandidateCard key={s.candidate} {...s} />)}
      </div>

      <SectionLabel>Evolução do sentimento</SectionLabel>
      <SentimentChart />

      <SectionLabel>Desinformação</SectionLabel>
      <MisinfoStats />

      <SectionLabel>Comentários ao vivo</SectionLabel>
      <CommentSampler hashtagFilter={hashtagFilter} />
    </div>
  );
}

export default function App() {
  const { scores, loading, wsConnected } = useScores();
  const [hashtagFilter, setHashtagFilter] = useState<string | undefined>();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className="hidden md:flex md:w-60 flex-col bg-gradient-to-b from-gray-900 via-gray-900 to-slate-950 text-white flex-shrink-0 min-h-screen">
        <div className="px-4 py-4 border-b border-gray-800 flex items-center gap-3">
          <img src="/favicon.svg" alt="Logo" className="w-8 h-8 flex-shrink-0" />
          <h1 className="text-sm font-bold leading-snug">
            Eleições 2026
            <br />
            <span className="text-gray-400 font-normal text-xs">Monitor de Sentimento</span>
          </h1>
        </div>

        <nav className="px-3 py-3 border-b border-gray-800 space-y-0.5">
          <NavLink to="/" end className={navClass}><MdDashboard size={16} />Painel</NavLink>
          <NavLink to="/metodologia" className={navClass}><MdOutlineArticle size={16} />Metodologia</NavLink>
        </nav>

        {/* Candidate legend with live scores */}
        {scores.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-800">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Candidatos
            </div>
            <div className="space-y-2">
              {scores.map(s => (
                <div key={s.candidate} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CANDIDATE_COLORS[s.candidate as Candidate] }}
                    />
                    <span className="text-xs text-gray-300 truncate">{s.candidate}</span>
                  </div>
                  <span className="text-xs font-bold text-gray-200 tabular-nums flex-shrink-0">
                    {s.score}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trending panel */}
        <div className="px-4 py-3 flex-1 overflow-y-auto">
          <TrendingPanel onHashtagClick={tag => setHashtagFilter(tag)} />
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden bg-gradient-to-r from-gray-900 to-slate-950 text-white px-4 py-3 flex-shrink-0">
          <p className="text-sm font-bold">
            Eleições 2026{' '}
            <span className="text-gray-400 font-normal">— Monitor de Sentimento</span>
          </p>
          <nav className="flex gap-4 mt-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-xs ${isActive ? 'text-white' : 'text-gray-400 hover:text-white'}`
              }
            >
              Painel
            </NavLink>
            <NavLink
              to="/metodologia"
              className={({ isActive }) =>
                `text-xs ${isActive ? 'text-white' : 'text-gray-400 hover:text-white'}`
              }
            >
              Metodologia
            </NavLink>
          </nav>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 py-5 md:px-6">
            <Routes>
              <Route path="/" element={<Dashboard scores={scores} loading={loading} wsConnected={wsConnected} hashtagFilter={hashtagFilter} />} />
              <Route path="/metodologia" element={<Metodologia />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
