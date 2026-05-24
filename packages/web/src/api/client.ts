import type { ScoreData, HistoryPoint, SampleData, TrendingItem, MisinfoData } from '../types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/v1';
export const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? '';

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  let url = `${BASE}${path}`;
  if (params) {
    const filtered = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
    if (filtered.length) url += '?' + new URLSearchParams(filtered).toString();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const fetchScores = () =>
  get<{ scores: ScoreData[] }>('/scores').then(r => r.scores);

export const fetchHistory = (candidate: string, hours = 24) =>
  get<{ windows: HistoryPoint[] }>('/history', { candidate, hours: String(hours) }).then(r => r.windows);

export const fetchSamples = (params: {
  source?: string;
  candidate?: string;
  sentiment?: string;
  credibility?: string;
  limit?: number;
}) =>
  get<{ samples: SampleData[] }>('/samples', {
    source: params.source,
    candidate: params.candidate,
    sentiment: params.sentiment,
    credibility: params.credibility,
    limit: params.limit !== undefined ? String(params.limit) : undefined,
  }).then(r => r.samples);

export const fetchTrending = (candidate?: string) =>
  get<{ trending: TrendingItem[] }>('/trending', { candidate }).then(r => r.trending);

export const fetchMisinfo = (hours = 24) =>
  get<MisinfoData>('/misinformation', { hours: String(hours) });
