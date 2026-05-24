import { SocialPost, CANDIDATES } from '../types';
import { checkAndMarkSeen } from '../dedup';
import { runApifyActor } from './apify';

interface XTweetItem {
  id: string;
  text: string;
  author: { userName: string };
  url: string;
  createdAt: string;
  isRetweet?: boolean;
}

export async function collectXTwitter(): Promise<SocialPost[]> {
  const searchTerms = process.env.X_SEARCH_TERMS!.split(',');
  const maxTweets = Number(process.env.X_MAX_TWEETS_PER_TERM ?? '100');
  const actorId = process.env.X_APIFY_ACTOR ?? 'xquik~x-tweet-scraper';
  const langFilter = process.env.X_LANG_FILTER ?? 'pt';
  const keywords = process.env.KEYWORDS!.split(',').map(k => k.toLowerCase());

  let items: XTweetItem[];
  try {
    items = await runApifyActor<XTweetItem>(actorId, {
      searchTerms: searchTerms.map(t => `${t} lang:${langFilter}`),
      maxTweets,
      sort: 'Latest',
    });
  } catch (err) {
    console.error('X/Twitter Apify error:', err);
    return [];
  }

  const maxAgeMs = 4 * 3600 * 1000; // discard tweets older than 4 hours
  const cutoff = Date.now() - maxAgeMs;

  const posts: SocialPost[] = [];
  for (const item of items) {
    if (item.isRetweet || !item.text || !item.id) continue;

    // Normalise to ISO so the DynamoDB SK sorts chronologically
    const tweetTime = item.createdAt ? new Date(item.createdAt).getTime() : NaN;
    if (isNaN(tweetTime) || tweetTime < cutoff) continue;
    const timestamp = new Date(tweetTime).toISOString();

    const text = item.text.slice(0, 1000);
    const lower = text.toLowerCase();

    const candidateMentions = CANDIDATES.filter(c => lower.includes(c.toLowerCase()));
    const hasKeyword = keywords.some(k => lower.includes(k));
    if (!candidateMentions.length && !hasKeyword) continue;

    const alreadySeen = await checkAndMarkSeen(item.id);
    if (alreadySeen) continue;

    posts.push({
      id: item.id,
      source: 'twitter',
      text,
      author: item.author?.userName ?? 'unknown',
      timestamp,
      candidate_mentions: candidateMentions,
      url: item.url,
    });
  }

  console.log(`X/Twitter: collected ${posts.length} tweets`);
  return posts;
}
