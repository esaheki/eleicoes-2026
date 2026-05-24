export const CANDIDATES = [
  'Lula',
  'Flávio Bolsonaro',
  'Romeu Zema',
  'Ronaldo Caiado',
] as const;

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

export type PostSource = 'twitter' | 'news' | 'youtube';

export interface SocialPost {
  id: string;
  source: PostSource;
  text: string;
  author: string;
  timestamp: string;
  candidate_mentions: string[];
  region?: string;
  url?: string;
  video_id?: string;
  video_title?: string;
}
