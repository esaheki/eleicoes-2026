import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SocialPost, CANDIDATES } from '../types';
import { checkAndMarkSeen } from '../dedup';
import { emitMetric } from '../metrics';

const dynamo = new DynamoDBClient({});
const BASE = 'https://www.googleapis.com/youtube/v3';

class YouTubeApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`YouTube ${endpoint} failed with HTTP ${status}: ${body}`);
    this.name = 'YouTubeApiError';
  }
}

interface YouTubeSearchResult {
  id: { kind: string; videoId: string };
  snippet: { publishedAt: string; title: string; channelTitle: string };
}

interface YouTubeVideoDetails {
  id: string;
  snippet: {
    title: string;
    publishedAt: string;
    channelTitle: string;
    defaultAudioLanguage?: string;
  };
  statistics: { viewCount: string; commentCount: string };
}

interface YouTubeCommentThread {
  id: string;
  snippet: {
    videoId: string;
    topLevelComment: {
      id: string;
      snippet: {
        textDisplay: string;
        textOriginal: string;
        authorDisplayName: string;
        publishedAt: string;
      };
    };
  };
}

async function checkQuotaDisabled(): Promise<boolean> {
  if (process.env.DRY_RUN === 'true') return false;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: process.env.COLLECTOR_STATE_TABLE!,
      Key: { source: { S: 'youtube' } },
    }));
    const disabledUntil = result.Item?.disabled_until?.S;
    if (disabledUntil && new Date() < new Date(disabledUntil)) {
      console.log(`YouTube collector disabled until ${disabledUntil} — quota protection`);
      return true;
    }
  } catch (err) {
    console.error('Failed to check YouTube quota state:', err);
  }
  return false;
}

async function searchVideos(term: string): Promise<YouTubeSearchResult[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    part: 'snippet',
    q: term,
    type: 'video',
    relevanceLanguage: 'pt',
    regionCode: 'BR',
    order: 'date',
    publishedAfter: since,
    maxResults: String(process.env.YOUTUBE_MAX_VIDEOS_PER_RUN ?? '10'),
    key: process.env.YOUTUBE_API_KEY!,
  });

  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new YouTubeApiError('search.list', res.status, await res.text());
  const data = await res.json() as { items?: YouTubeSearchResult[] };
  return data.items ?? [];
}

async function enrichVideos(videoIds: string[]): Promise<Map<string, YouTubeVideoDetails>> {
  if (!videoIds.length) return new Map();
  const params = new URLSearchParams({
    part: 'snippet,statistics',
    id: videoIds.join(','),
    key: process.env.YOUTUBE_API_KEY!,
  });

  const res = await fetch(`${BASE}/videos?${params}`);
  if (!res.ok) throw new YouTubeApiError('videos.list', res.status, await res.text());
  const data = await res.json() as { items?: YouTubeVideoDetails[] };
  const map = new Map<string, YouTubeVideoDetails>();
  for (const item of data.items ?? []) map.set(item.id, item);
  return map;
}

async function fetchComments(videoId: string, maxComments: number): Promise<YouTubeCommentThread[]> {
  const comments: YouTubeCommentThread[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: '100',
      textFormat: 'plainText',
      key: process.env.YOUTUBE_API_KEY!,
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(`${BASE}/commentThreads?${params}`);

    if (res.status === 403) {
      const body = await res.json() as { error?: { errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason;
      if (reason === 'commentsDisabled') break;
      if (reason === 'quotaExceeded') throw new YouTubeApiError('commentThreads.list', res.status, JSON.stringify(body));
      throw new YouTubeApiError('commentThreads.list', res.status, JSON.stringify(body));
    }

    if (!res.ok) throw new YouTubeApiError('commentThreads.list', res.status, await res.text());

    const data = await res.json() as { items?: YouTubeCommentThread[]; nextPageToken?: string };
    comments.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken && comments.length < maxComments);

  return comments.slice(0, maxComments);
}

function mapCommentToPost(
  comment: YouTubeCommentThread,
  video: YouTubeVideoDetails,
  keywords: string[],
): SocialPost | null {
  const s = comment.snippet.topLevelComment.snippet;
  const text = (s.textOriginal ?? s.textDisplay).slice(0, 280);
  if (text.replace(/\s/g, '').length < 15) return null;

  const lower = text.toLowerCase();
  const candidateMentions = CANDIDATES.filter(c => lower.includes(c.toLowerCase()));
  const hasKeyword = keywords.some(k => lower.includes(k));
  if (!candidateMentions.length && !hasKeyword) return null;

  const commentUrl = `https://www.youtube.com/watch?v=${video.id}&lc=${comment.snippet.topLevelComment.id}`;

  return {
    id: comment.snippet.topLevelComment.id,
    source: 'youtube',
    text,
    author: s.authorDisplayName,
    timestamp: s.publishedAt,
    candidate_mentions: candidateMentions,
    url: commentUrl,
    video_id: video.id,
    video_title: video.snippet.title,
  };
}

export async function collectYouTube(): Promise<SocialPost[]> {
  if (await checkQuotaDisabled()) return [];

  const searchTerms = process.env.YOUTUBE_SEARCH_TERMS!.split(',');
  const maxVideos = Number(process.env.YOUTUBE_MAX_VIDEOS_PER_RUN ?? '10');
  const maxComments = Number(process.env.YOUTUBE_MAX_COMMENTS_PER_VIDEO ?? '50');
  const keywords = process.env.KEYWORDS!.split(',').map(k => k.toLowerCase());

  let totalUnitsUsed = 0;
  const allPosts: SocialPost[] = [];
  const seenVideoIds = new Set<string>();

  for (const term of searchTerms) {
    try {
      const searchResults = await searchVideos(term);
      totalUnitsUsed += 100;

      const newVideoIds = searchResults
        .map(r => r.id.videoId)
        .filter((id): id is string => !!id && !seenVideoIds.has(id));
      newVideoIds.forEach(id => seenVideoIds.add(id));
      if (!newVideoIds.length) continue;

      const videoMap = await enrichVideos(newVideoIds);
      totalUnitsUsed += 1;

      const eligible = [...videoMap.values()]
        .filter(v =>
          Number(v.statistics.commentCount) > 0 &&
          Number(v.statistics.viewCount) >= 500 &&
          (!v.snippet.defaultAudioLanguage ||
            ['pt', 'pt-BR'].includes(v.snippet.defaultAudioLanguage)),
        )
        .slice(0, maxVideos);

      for (const video of eligible) {
        const threads = await fetchComments(video.id, maxComments);
        totalUnitsUsed += 1;

        for (const thread of threads) {
          const commentId = thread.snippet.topLevelComment.id;
          const alreadySeen = await checkAndMarkSeen(commentId);
          if (alreadySeen) continue;

          const post = mapCommentToPost(thread, video, keywords);
          if (post) allPosts.push(post);
        }
      }
    } catch (err) {
      if (err instanceof YouTubeApiError && err.status === 429) {
        console.error('YouTube rate limited, waiting 30s then retrying once');
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        console.error(`YouTube error for term "${term}":`, err);
      }
    }
  }

  await emitMetric('YouTubeQuotaUsed', totalUnitsUsed);
  console.log(`YouTube: collected ${allPosts.length} comments, used ${totalUnitsUsed} quota units`);
  return allPosts;
}
