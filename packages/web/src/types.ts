export const CANDIDATES = ['Lula', 'Flávio Bolsonaro', 'Romeu Zema', 'Ronaldo Caiado'] as const;
export type Candidate = (typeof CANDIDATES)[number];

export const CANDIDATE_COLORS: Record<Candidate, string> = {
  'Lula': '#CC0000',
  'Flávio Bolsonaro': '#003580',
  'Romeu Zema': '#F4801A',
  'Ronaldo Caiado': '#5B7B9A',
};

export const CANDIDATE_PARTIES: Record<Candidate, string> = {
  'Lula': 'PT',
  'Flávio Bolsonaro': 'PL',
  'Romeu Zema': 'NOVO',
  'Ronaldo Caiado': 'PSD',
};

export type PostSource = 'reddit' | 'threads' | 'twitter' | 'news' | 'youtube';
export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type CredibilityLabel = 'CREDIBLE' | 'SUSPICIOUS' | 'LIKELY_FALSE' | 'UNSCORED';

export interface ScoreData {
  candidate: Candidate;
  score: number;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
  lastUpdated?: string;
}

export interface HistoryPoint {
  window: string;
  score: number;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

export interface SampleData {
  source: PostSource;
  candidate: Candidate;
  sentiment: Sentiment;
  score: number | null;
  text: string;
  author: string;
  url: string;
  video_title?: string;
  timestamp: string;
  credibility_score: number | null;
  credibility_label: CredibilityLabel;
  flags: string[];
  flag_reasoning: string;
}

export interface TrendingItem {
  hashtag: string;
  count: number;
}

export interface MisinfoData {
  period_hours: number;
  total_scored: number;
  likely_false: number;
  suspicious: number;
  credible: number;
  likely_false_pct: number;
  top_flags: { flag: string; count: number }[];
  by_candidate: { candidate: string; likely_false: number; suspicious: number; total: number }[];
  by_source: { source: string; count: number }[];
}

export type WsMessage =
  | {
      type: 'score_update';
      candidate: Candidate;
      score: number;
      delta: number;
      positive: number;
      negative: number;
      neutral: number;
      total: number;
      window: string;
      timestamp: string;
    }
  | { type: 'new_sample_batch'; samples: SampleData[] };
