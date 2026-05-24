import { SocialPost, CANDIDATES } from '../types';
import { checkAndMarkSeen } from '../dedup';
import { runApifyActor } from './apify';

interface ThreadsItem {
  id: string;
  text: string;
  username: string;
  url: string;
  timestamp: string;
}

export async function collectThreads(): Promise<SocialPost[]> {
  const searchTerms = process.env.THREADS_SEARCH_TERMS!.split(',');
  const maxResults = Number(process.env.THREADS_MAX_RESULTS_PER_TERM ?? '100');
  const actorId = process.env.THREADS_APIFY_ACTOR ?? 'futurizerush~threads-keyword-search';
  const keywords = process.env.KEYWORDS!.split(',').map(k => k.toLowerCase());

  // Actor allows only one keyword per run — run in parallel, one per search term
  const allowedMax = [10, 20, 30];
  const clampedMax = String(allowedMax.reduce((prev, cur) =>
    Math.abs(cur - maxResults) < Math.abs(prev - maxResults) ? cur : prev,
  ));

  const results = await Promise.allSettled(
    searchTerms.map(term =>
      runApifyActor<ThreadsItem>(actorId, { keywords: [term], maxResults: clampedMax }, 60),
    ),
  );

  const items: ThreadsItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else console.error('Threads Apify error:', r.reason);
  }

  const posts: SocialPost[] = [];
  for (const item of items) {
    if (!item.text || !item.id) continue;
    const text = item.text.slice(0, 1000);
    const lower = text.toLowerCase();

    const candidateMentions = CANDIDATES.filter(c => lower.includes(c.toLowerCase()));
    const hasKeyword = keywords.some(k => lower.includes(k));
    if (!candidateMentions.length && !hasKeyword) continue;

    const alreadySeen = await checkAndMarkSeen(item.id);
    if (alreadySeen) continue;

    posts.push({
      id: item.id,
      source: 'threads',
      text,
      author: item.username,
      timestamp: item.timestamp ?? new Date().toISOString(),
      candidate_mentions: candidateMentions,
      url: item.url,
    });
  }

  console.log(`Threads: collected ${posts.length} posts`);
  return posts;
}
