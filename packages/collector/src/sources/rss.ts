import Parser from 'rss-parser';
import { createHash } from 'crypto';
import { SocialPost, CANDIDATES } from '../types';
import { checkAndMarkSeen } from '../dedup';

const parser = new Parser();

// Fetches raw bytes and decodes using the encoding declared in the XML prolog.
// Needed because some feeds (e.g. Folha) serve ISO-8859-1 without a Content-Type charset,
// causing rss-parser's internal HTTP client to misread accented characters as UTF-8.
async function fetchFeed(url: string): Promise<ReturnType<Parser['parseString']>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const preamble = buf.slice(0, 200).toString('ascii');
  const match = preamble.match(/encoding=["']([^"']+)["']/i);
  const encoding = match?.[1] ?? 'utf-8';
  const xml = new TextDecoder(encoding).decode(buf);
  return parser.parseString(xml);
}

export async function collectRSS(): Promise<SocialPost[]> {
  const feeds = (process.env.RSS_FEEDS ?? '').split(',').map(f => f.trim()).filter(Boolean);
  const keywords = (process.env.KEYWORDS ?? '').split(',').map(k => k.toLowerCase());
  const posts: SocialPost[] = [];

  const results = await Promise.allSettled(feeds.map(url => fetchFeed(url)));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const feedUrl = feeds[i];

    if (result.status === 'rejected') {
      console.error(`RSS feed error (${feedUrl}):`, result.reason);
      continue;
    }

    for (const item of result.value.items) {
      const title = item.title ?? '';
      const snippet = item.contentSnippet ?? item.content ?? '';
      const text = `${title}. ${snippet}`.replace(/\s+/g, ' ').trim().slice(0, 1000);
      const lower = text.toLowerCase();

      const candidateMentions = CANDIDATES.filter(c => lower.includes(c.toLowerCase()));
      const hasKeyword = keywords.some(k => lower.includes(k));
      if (!candidateMentions.length && !hasKeyword) continue;

      const ref = item.link ?? item.guid ?? title;
      const id = `news-${createHash('sha256').update(ref).digest('hex').slice(0, 20)}`;

      const alreadySeen = await checkAndMarkSeen(id);
      if (alreadySeen) continue;

      posts.push({
        id,
        source: 'news',
        text,
        author: item.creator ?? feedUrl,
        timestamp: item.isoDate ?? new Date().toISOString(),
        candidate_mentions: candidateMentions,
        url: item.link,
      });
    }
  }

  console.log(`RSS: collected ${posts.length} articles from ${feeds.length} feeds`);
  return posts;
}
