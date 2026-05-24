import { SocialPost, CANDIDATES } from '../types';
import { checkAndMarkSeen } from '../dedup';

// Module-level token cache — reused across warm invocations
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.value;
  }

  const clientId = process.env.REDDIT_CLIENT_ID!;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET!;
  const userAgent = process.env.REDDIT_USER_AGENT ?? 'BR-Election-Monitor/1.0';

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Reddit OAuth token request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cachedToken.value;
}

export async function collectReddit(): Promise<SocialPost[]> {
  const subreddits = process.env.SUBREDDITS!.split(',');
  const keywords = process.env.KEYWORDS!.split(',').map(k => k.toLowerCase());
  const userAgent = process.env.REDDIT_USER_AGENT ?? 'BR-Election-Monitor/1.0';
  const allPosts: SocialPost[] = [];

  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    console.log('Reddit: REDDIT_CLIENT_ID/SECRET not set, skipping');
    return [];
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error('Reddit: failed to obtain OAuth token:', err);
    return [];
  }

  for (const sub of subreddits) {
    let data: { data?: { children?: { data: Record<string, unknown> }[] } };
    try {
      const res = await fetch(`https://oauth.reddit.com/r/${sub}/new.json?limit=100`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': userAgent,
        },
      });
      if (!res.ok) {
        console.error(`Reddit r/${sub} HTTP ${res.status}`);
        continue;
      }
      data = await res.json() as typeof data;
    } catch (err) {
      console.error(`Reddit r/${sub} error:`, err);
      continue;
    }

    for (const { data: p } of data.data?.children ?? []) {
      const id = String(p.id ?? '');
      const title = String(p.title ?? '');
      const selftext = String(p.selftext ?? '');
      const text = `${title} ${selftext}`.trim().slice(0, 1000);
      const lower = text.toLowerCase();

      const candidateMentions = CANDIDATES.filter(c => lower.includes(c.toLowerCase()));
      const hasKeyword = keywords.some(k => lower.includes(k));
      if (!candidateMentions.length && !hasKeyword) continue;

      const alreadySeen = await checkAndMarkSeen(id);
      if (alreadySeen) continue;

      allPosts.push({
        id,
        source: 'reddit',
        text,
        author: String(p.author ?? 'unknown'),
        timestamp: new Date(Number(p.created_utc) * 1000).toISOString(),
        candidate_mentions: candidateMentions,
        url: `https://reddit.com${String(p.permalink ?? '')}`,
      });
    }
  }

  console.log(`Reddit: collected ${allPosts.length} posts`);
  return allPosts;
}
