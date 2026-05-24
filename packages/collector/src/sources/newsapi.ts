import { createHash } from 'crypto';
import { SocialPost, CANDIDATES } from '../types';
import { checkAndMarkSeen } from '../dedup';

export async function collectNewsAPI(): Promise<SocialPost[]> {
  const keywords = process.env.KEYWORDS!.split(',').map(k => k.toLowerCase());
  const posts: SocialPost[] = [];

  const params = new URLSearchParams({
    q: 'Lula Bolsonaro eleições 2026',
    language: 'pt',
    sortBy: 'publishedAt',
    pageSize: '50',
  });

  let data: { articles?: Record<string, unknown>[] };
  try {
    const res = await fetch(`https://newsapi.org/v2/everything?${params}`, {
      headers: { 'X-Api-Key': process.env.NEWS_API_KEY! },
    });
    if (!res.ok) {
      console.error(`NewsAPI HTTP ${res.status}`);
      return [];
    }
    data = await res.json() as typeof data;
  } catch (err) {
    console.error('NewsAPI error:', err);
    return [];
  }

  for (const article of data.articles ?? []) {
    const title = String(article.title ?? '');
    const description = String(article.description ?? '');
    const text = `${title} ${description}`.trim().slice(0, 1000);
    const lower = text.toLowerCase();

    const candidateMentions = CANDIDATES.filter(c => lower.includes(c.toLowerCase()));
    const hasKeyword = keywords.some(k => lower.includes(k));
    if (!candidateMentions.length && !hasKeyword) continue;

    const url = String(article.url ?? text);
    const id = `news-${createHash('sha256').update(url).digest('hex').slice(0, 20)}`;

    const alreadySeen = await checkAndMarkSeen(id);
    if (alreadySeen) continue;

    const source = article.source as Record<string, unknown> | undefined;
    posts.push({
      id,
      source: 'news',
      text,
      author: String(source?.name ?? 'unknown'),
      timestamp: String(article.publishedAt ?? new Date().toISOString()),
      candidate_mentions: candidateMentions,
      url: String(article.url ?? ''),
    });
  }

  console.log(`NewsAPI: collected ${posts.length} articles`);
  return posts;
}
