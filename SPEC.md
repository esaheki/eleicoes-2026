# Eleições 2026 — Real-Time Sentiment Dashboard

## Overview

A public web dashboard that streams social media and news data about the 2026 Brazilian
presidential election, runs Portuguese-language sentiment analysis via AWS Comprehend, and
displays live candidate sentiment scores on a React frontend hosted on AWS.

The first round is **October 4, 2026**; the possible runoff is **October 25, 2026**.
Main candidates as of May 2026: Lula (PT), Flávio Bolsonaro (PL), Romeu Zema (NOVO),
Ronaldo Caiado (PSD).

Data collection continues through **December 31, 2026** to cover the transition period
after the winner takes office. After Dec 31: collector Lambdas stop, dashboard freezes
on a static CloudFront snapshot, DynamoDB data is archived to S3.

---

## Audience & Design Principles

**Primary audience:** General public / curious Brazilian voters.

**Design goals:** Portuguese-first, mobile-first, low cognitive load. The dashboard
presents data without taking political positions. The misinformation panel is informational,
not alarmist.

**Visual style:** News dashboard — dense data layout, dark left sidebar, white content area
(Bloomberg / G1 aesthetic). No election-phase countdown; the dashboard is timeless.

**Candidate color palette (official party colors):**

| Candidate | Party | Color |
|---|---|---|
| Lula | PT | Red (`#CC0000`) |
| Flávio Bolsonaro | PL | Navy blue (`#003580`) |
| Romeu Zema | NOVO | Orange (`#F4801A`) |
| Ronaldo Caiado | PSD | Blue-gray (`#5B7B9A`) |

**Mobile layout:** Single-column stacked. CandidateCards stack vertically.
CommentSampler is full-width below the charts. Tailwind responsive utilities (`md:grid-cols-2`)
handle the breakpoint; no separate mobile components.

**LGPD compliance:** Usernames are stored internally (raw, for operator use) but
anonymized before being sent to any API response. The API Lambda computes
`SHA-256(author)` and replaces the `author` field with `"usuário_<first-4-hex>"` (e.g.,
`"usuário_a3f9"`). Deep-link URLs still point to the original post so users can verify
authorship themselves.

---

## Repository Structure

```
eleicoes2026/
├── infra/                  # AWS CDK stack (TypeScript)
│   ├── bin/
│   │   └── app.ts
│   └── lib/
│       ├── streaming-stack.ts      # Kinesis, Lambda, DynamoDB
│       ├── website-stack.ts        # S3, CloudFront, API Gateway, Route53
│       └── pipeline-stack.ts       # Firehose, S3 archive, Glue
├── packages/
│   ├── collector/          # Lambda: polls APIs → Kinesis
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── sources/
│   │   │   │   ├── rss.ts            # encoding-aware RSS collector
│   │   │   │   ├── apify.ts          # shared Apify REST client
│   │   │   │   ├── xtwitter.ts
│   │   │   │   └── youtube.ts
│   │   │   └── types.ts
│   │   └── package.json
│   ├── processor/          # Lambda: Kinesis trigger → Comprehend → DynamoDB
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── sentiment.ts
│   │   │   └── fakechecker.ts
│   │   └── package.json
│   ├── api/                # Lambda: REST API reads DynamoDB
│   │   ├── src/
│   │   │   ├── scores.ts
│   │   │   └── history.ts
│   │   └── package.json
│   └── web/                # React dashboard
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   └── Metodologia.tsx
│       │   ├── components/
│       │   │   ├── CandidateCard.tsx
│       │   │   ├── SentimentChart.tsx
│       │   │   ├── CommentSampler.tsx
│       │   │   ├── FakeInfoBadge.tsx
│       │   │   ├── MisinfoStats.tsx
│       │   │   └── TrendingPanel.tsx
│       │   ├── hooks/
│       │   │   ├── useScores.ts
│       │   │   ├── useCommentSampler.ts
│       │   │   └── useWebSocket.ts
│       │   └── api/
│       │       └── client.ts
│       ├── public/
│       └── package.json
├── package.json            # Workspace root (npm workspaces)
└── SPEC.md
```

---

## Environment Variables

### Collector Lambda

```env
KINESIS_STREAM_NAME=election-stream
# ── RSS news collector ──
RSS_FEEDS=https://www.cartacapital.com.br/feed/,https://jovempan.com.br/feed/rss/,https://agenciabrasil.ebc.com.br/rss/politica/feed.xml,https://rss.uol.com.br/feed/noticias.xml,https://feeds.folha.uol.com.br/poder/rss091.xml
KEYWORDS=eleições2026,presidente2026,Lula,Flávio,Zema,Caiado,PT,PL,NOVO,PSD
# ── Apify (X/Twitter scraper) ──
APIFY_API_TOKEN=<apify.com API token>
# X/Twitter — actor: xquik/x-tweet-scraper  ($0.15 per 1,000 tweets)
X_SEARCH_TERMS=Lula 2026,Flávio Bolsonaro,eleições2026,Zema presidente,Caiado presidente
X_LANG_FILTER=pt
X_MAX_TWEETS_PER_TERM=100
X_APIFY_ACTOR=xquik~x-tweet-scraper
# ── YouTube ──
YOUTUBE_API_KEY=<google cloud api key with youtube data api v3>
YOUTUBE_SEARCH_TERMS=Lula 2026,Flávio Bolsonaro 2026,eleições presidenciais 2026
YOUTUBE_MAX_COMMENTS_PER_VIDEO=200
YOUTUBE_MAX_VIDEOS_PER_RUN=10
```

### Processor Lambda

```env
DYNAMO_TABLE=election-sentiment
COMPREHEND_LANGUAGE=pt
BEDROCK_MODEL_ID=anthropic.claude-haiku-4-5-20251001
FAKE_INFO_CONFIDENCE_THRESHOLD=0.6   # skip scoring below this Comprehend confidence
FAKE_INFO_SCORE_HIGH=70              # ≥70 → flagged as likely misinformation
FAKE_INFO_SCORE_MEDIUM=40            # 40–69 → marked as suspicious
```

### API Lambda

```env
DYNAMO_TABLE=election-sentiment
CORS_ORIGIN=https://eleicoes-2026.com
```

### Web (build-time)

```env
VITE_API_BASE=https://api.eleicoes-2026.com/v1
VITE_WS_URL=wss://api.eleicoes-2026.com/ws
```

---

## Data Model

### SocialPost (in-flight on Kinesis)

```typescript
interface SocialPost {
  id: string;
  source: 'twitter' | 'news' | 'youtube';
  text: string;                    // max 1000 chars
  author: string;
  timestamp: string;               // ISO 8601
  candidate_mentions: string[];    // e.g. ['Lula', 'Flávio Bolsonaro']
  region?: string;                 // BR state code if detectable, e.g. 'SP'
  url?: string;
  video_id?: string;               // YouTube only: source video ID
  video_title?: string;            // YouTube only: video title for display
}
```

### DynamoDB — `election-sentiment` table

- **Partition key:** `candidate` (String) — e.g. `"Lula"`, `"Flávio Bolsonaro"`
- **Sort key:** `window` (String) — ISO hour bucket, e.g. `"2026-10-04T14:00"`

> There is no `"live"` window item. The live score displayed on the dashboard is computed
> at API response time by summing the last 12 hourly snapshot items (covering the rolling
> 1-hour window). This is more accurate than a pre-aggregated live counter and avoids the
> stale-score risk of a 24-hour TTL rolling total.

| Attribute | Type | Description |
|---|---|---|
| `candidate` | S | Candidate name |
| `window` | S | ISO hour bucket (e.g. `"2026-10-04T14:00"`) |
| `positive_count` | N | Count for this hour window |
| `negative_count` | N | Count for this hour window |
| `neutral_count` | N | Count for this hour window |
| `total` | N | All posts mentioning candidate in this window |
| `score` | N | `round(positive / total * 100)` for this window |
| `last_updated` | S | ISO timestamp of last write |
| `ttl` | N | Unix epoch — **30-hour TTL** on all items (covers 24h history + buffer) |

### DynamoDB — `comment-samples` table

Stores a rolling window of raw comments for display in the live sampler panel.
TTL keeps the table small — only the last 15 minutes of comments are retained.

- **Partition key:** `source` (String) — e.g. `"youtube"`, `"twitter"`, `"news"`
- **Sort key:** `timestamp#id` (String) — allows range queries by recency

| Attribute | Type | Description |
|---|---|---|
| `source` | S | Origin platform |
| `timestamp#id` | S | ISO timestamp + `#` + post ID for uniqueness |
| `candidate` | S | Primary candidate mentioned |
| `sentiment` | S | `POSITIVE`, `NEGATIVE`, or `NEUTRAL` |
| `text` | S | Raw comment text, max 280 chars (truncated) |
| `author` | S | Username / channel name |
| `url` | S | Deep link to original comment |
| `video_title` | S | YouTube only: title of the source video |
| `score` | N | Comprehend sentiment score 0–100 |
| `credibility_score` | N | Bedrock fake-info score 0–100 (higher = more likely false) |
| `credibility_label` | S | `CREDIBLE`, `SUSPICIOUS`, or `LIKELY_FALSE` |
| `flags` | L | List of detected claim types, e.g. `["urna_fraud", "candidate_crime"]` |
| `flag_reasoning` | S | One-sentence Portuguese explanation from Bedrock (shown on expand) |
| `ttl` | N | Unix epoch — 15-minute TTL |

**LGPD anonymization:** The `author` field is stored as plaintext internally but is replaced by
`"usuário_<first-4-hex-of-SHA256(author)>"` in all API responses before sending to clients.

> **No GSI on this table.** The `credibility-label-index` GSI originally proposed here is
> unnecessary — the Misinfo Aggregator now reads from `misinfo-events` (30-day TTL) instead
> of `comment-samples` (15-min TTL).

### DynamoDB — `misinfo-events` table

Long-lived misinformation event log that powers the 24h and 7d aggregation in the
Misinfo Aggregator. Keeps data alive well past the 15-minute comment-samples TTL.

- **Partition key:** `candidate` (String)
- **Sort key:** `timestamp#id` (String)

| Attribute | Type | Description |
|---|---|---|
| `candidate` | S | Primary candidate mentioned |
| `timestamp#id` | S | ISO timestamp + `#` + post ID |
| `credibility_label` | S | `CREDIBLE`, `SUSPICIOUS`, `LIKELY_FALSE`, or `UNSCORED` |
| `credibility_score` | N | Bedrock score 0–100 (null if UNSCORED) |
| `flags` | L | List of detected claim type keys |
| `flag_reasoning` | S | One-sentence Portuguese reasoning |
| `source` | S | Origin platform |
| `ttl` | N | Unix epoch — **30-day TTL** |

**GSI: `credibility-label-index`**
- PK: `credibility_label`, SK: `timestamp#id`
- Enables efficient scans of all `LIKELY_FALSE` items for the Misinfo Aggregator without full table scans.

### DynamoDB — `keyword-counts` table

Stores trending hashtag counts per hourly window per candidate, written by the Processor Lambda.

- **Partition key:** `hashtag` (String) — e.g. `"#eleicoes2026"`
- **Sort key:** `hour_window#candidate` (String) — e.g. `"2026-10-04T14:00#Lula"`

| Attribute | Type | Description |
|---|---|---|
| `hashtag` | S | Hashtag string including `#` prefix |
| `hour_window#candidate` | S | ISO hour + `#` + candidate name |
| `count` | N | Atomic increment counter |
| `ttl` | N | Unix epoch — **48-hour TTL** |

**Write pattern:** Processor Lambda extracts `/#\w+/g` tokens from each post's text.
For each unique hashtag, calls `UpdateItem` with `ADD #count :one`. One write per unique
hashtag per post. At 100 posts/min × 3 avg hashtags = ~300 writes/min (on-demand cost: ~$0.30/month).

### Fake Information Claim Taxonomy

The Bedrock scoring prompt instructs the model to classify detected claims into a
predefined taxonomy of common Brazilian election misinformation tropes. Flags are
drawn from this fixed list (enables frontend filtering and aggregate stats):

| Flag key | Description |
|---|---|
| `urna_fraud` | Claims the electronic voting machine (urna eletrônica) is rigged or hackable |
| `candidate_crime` | Unverified criminal allegations against a candidate |
| `vote_buying` | Allegations of voter bribery without sourcing |
| `election_coup` | Claims of planned electoral fraud or coup post-result |
| `fake_quote` | Attributed quote with no verifiable source |
| `health_disinfo` | False health/age claims about a candidate |
| `economic_disinfo` | False or misleading economic statistics |
| `foreign_interference` | Unsubstantiated claims of foreign election meddling |

The model may return an empty `flags` array for comments with no detectable claims.
A non-empty `flags` array does not guarantee the comment is false — it triggers human
review framing in the UI ("alegação não verificada").

### S3 Raw Archive

```
s3://eleicoes2026-raw/
  year=2026/
    month=10/
      day=04/
        hour=14/
          firehose-1-2026-10-04-14-00-00-abc123.parquet
```

---

## Lambda: Collector

**Trigger:** EventBridge rule — every 60 seconds (RSS feeds)
**Runtime:** Node.js 24.x  
**Timeout:** 30s  
**Memory:** 256 MB

> **Apify source (X/Twitter)** runs on a **separate EventBridge rule every 5 minutes**
> via the `apify-collector` Lambda. It calls the Apify REST API synchronously and shares
> the same seen-IDs DynamoDB table.


### Logic

1. Read `KEYWORDS` and `RSS_FEEDS` from env.
2. Fetch from all enabled sources in parallel (`Promise.allSettled`).
3. For each post, extract `candidate_mentions` by matching against the candidates list (case-insensitive).
4. Filter out posts with no keyword or candidate match.
5. Batch records into groups of 500 and call `kinesis:PutRecords`.
6. Log counts per source to CloudWatch.

### RSS news source (`sources/rss.ts`)

Fetches Brazilian political news from a configurable list of RSS feeds every 60 seconds.

- Feeds configured via `RSS_FEEDS` env var (comma-separated URLs).
- Uses a custom `fetchFeed()` function that reads raw bytes, sniffs encoding from the XML prolog
  (e.g. `<?xml encoding="ISO-8859-1"?>`), decodes with `TextDecoder`, then calls
  `rss-parser.parseString()`. Required for feeds like Folha that declare ISO-8859-1 without
  a `Content-Type` charset header.
- All feeds fetched in parallel via `Promise.allSettled`; individual feed failures are logged and skipped.
- Stable post ID: `news-${sha256(item.link ?? item.guid ?? title).slice(0, 20)}`.
- Deduplicate via seen-IDs DynamoDB table (10-min TTL).
- Parse `title + contentSnippet`, truncate to 1000 chars.
- `author` falls back to the feed URL when `item.creator` is absent.

### X/Twitter source (via Apify)

Uses the **Apify actor `xquik/x-tweet-scraper`** — $0.15 per 1,000 tweets, no X API key needed.
At 100 tweets × 5 terms per run every 5 minutes, ~$6.50/month.

**Strategy** (`apify-collector` Lambda, every 5 minutes):
- POST to `https://api.apify.com/v2/acts/xquik~x-tweet-scraper/run-sync-get-dataset-items`
- Body:
  ```json
  {
    "searchTerms": ["Lula 2026 lang:pt", "Flávio Bolsonaro lang:pt", "eleições2026 lang:pt",
                    "Zema presidente lang:pt", "Caiado presidente lang:pt"],
    "maxTweets": 100,
    "sort": "Latest"
  }
  ```
- Auth: `Authorization: Bearer <APIFY_API_TOKEN>`
- Deduplicate tweet IDs via seen-IDs DynamoDB table (10-min TTL).
- Map response fields: `id`, `text`, `author.userName`, `url`, `createdAt` → `SocialPost`.
- Skip retweets: filter out items where `isRetweet === true`.

**Shared Apify client (`sources/apify.ts`):**

```typescript
export async function runApifyActor<T>(
  actorId: string,
  input: Record<string, unknown>
): Promise<T[]> {
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify ${actorId} failed: ${res.status}`);
  return res.json() as Promise<T[]>;
}
```

### YouTube source

**File:** `packages/collector/src/sources/youtube.ts`  
**Trigger:** Separate EventBridge rule — every 5 minutes (`youtube-collector` Lambda)  
**Runtime:** Node.js 24.x | **Timeout:** 60s | **Memory:** 256 MB  
**API:** YouTube Data API v3 (Google Cloud project, free, 10,000 units/day quota)

---

#### Quota budget

| API call | Units/call | Calls/run | Units/run |
|---|---|---|---|
| `search.list` (per search term) | 100 | 3 terms | 300 |
| `videos.list` (batch enrich, all IDs) | 1 | 1 batch | 1 |
| `commentThreads.list` (per video) | 1 | up to 10 videos | ≤10 |
| **Total per run** | | | **~311** |
| **Runs/day** (every 5 min) | | 288 | **~89,568** |

> 89,568 units/day is under the 10,000/day free quota **only if** capped to **1 search term per run**
> on rotation, or the quota is raised to 100,000 units via Google Cloud quota increase request
> (free, takes ~1 business day). The spec uses the **quota increase** path. If not granted, fall
> back to 1 search term per run in round-robin order (store current index in `collector-state` table).

CloudWatch custom metric `YouTubeQuotaUsed` (incremented per run by units consumed).
Alarm at 90,000 units/day → SNS alert + auto-skip YouTube for the rest of the day.

---

#### Typed interfaces

```typescript
// packages/collector/src/sources/youtube.ts

interface YouTubeSearchResult {
  kind: 'youtube#searchResult';
  id: { kind: string; videoId: string };
  snippet: {
    publishedAt: string;
    title: string;
    description: string;
    channelTitle: string;
    channelId: string;
  };
}

interface YouTubeVideoDetails {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelTitle: string;
    defaultAudioLanguage?: string;
    tags?: string[];
  };
  statistics: {
    viewCount: string;
    commentCount: string;
  };
}

interface YouTubeCommentThread {
  id: string;
  snippet: {
    videoId: string;
    totalReplyCount: number;
    topLevelComment: {
      id: string;
      snippet: {
        textDisplay: string;
        textOriginal: string;
        authorDisplayName: string;
        authorChannelUrl: string;
        likeCount: number;
        publishedAt: string;
        updatedAt: string;
      };
    };
  };
}

interface VideoWithComments {
  videoId: string;
  videoTitle: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number;
  commentCount: number;
  comments: YouTubeCommentThread[];
}
```

---

#### Phase 1 — Video discovery (`search.list`)

```typescript
const BASE = 'https://www.googleapis.com/youtube/v3';

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

  const data = await res.json();
  return (data.items ?? []) as YouTubeSearchResult[];
}
```

---

#### Phase 2 — Video enrichment (`videos.list`)

Batch all video IDs from phase 1 into a single call (costs only 1 unit regardless of batch size
up to 50) to retrieve statistics and confirm language before fetching comments.

```typescript
async function enrichVideos(videoIds: string[]): Promise<Map<string, YouTubeVideoDetails>> {
  if (!videoIds.length) return new Map();

  const params = new URLSearchParams({
    part: 'snippet,statistics',
    id: videoIds.join(','),        // up to 50 IDs in one call
    key: process.env.YOUTUBE_API_KEY!,
  });

  const res = await fetch(`${BASE}/videos?${params}`);
  if (!res.ok) throw new YouTubeApiError('videos.list', res.status, await res.text());

  const data = await res.json();
  const map = new Map<string, YouTubeVideoDetails>();
  for (const item of data.items ?? []) map.set(item.id, item);
  return map;
}
```

**Filtering after enrichment:**
- Skip videos where `defaultAudioLanguage` is set and is not `pt` or `pt-BR`.
- Skip videos where `commentCount === '0'` or comments are disabled.
- Skip videos with `viewCount < 500` (low-signal noise reduction).

---

#### Phase 3 — Comment collection (`commentThreads.list`)

```typescript
async function fetchComments(
  videoId: string,
  maxComments: number
): Promise<YouTubeCommentThread[]> {
  const comments: YouTubeCommentThread[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      videoId,
      order: 'relevance',          // 'time' for chronological; 'relevance' for higher signal
      maxResults: '100',           // max per page
      textFormat: 'plainText',
      key: process.env.YOUTUBE_API_KEY!,
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(`${BASE}/commentThreads?${params}`);

    // Comments disabled on this video — not an error, just skip
    if (res.status === 403) {
      const body = await res.json();
      if (body.error?.errors?.[0]?.reason === 'commentsDisabled') break;
      throw new YouTubeApiError('commentThreads.list', res.status, JSON.stringify(body));
    }

    if (!res.ok) throw new YouTubeApiError('commentThreads.list', res.status, await res.text());

    const data = await res.json();
    comments.push(...(data.items ?? []));
    pageToken = data.nextPageToken;

  } while (pageToken && comments.length < maxComments);

  return comments.slice(0, maxComments);
}
```

---

#### Phase 4 — Mapping to `SocialPost`

```typescript
function mapCommentToPost(
  comment: YouTubeCommentThread,
  video: YouTubeVideoDetails,
  candidates: string[],
  keywords: string[]
): SocialPost | null {
  const s = comment.snippet.topLevelComment.snippet;
  const text = s.textOriginal ?? s.textDisplay;
  const truncated = text.slice(0, 280);

  // Must match at least one keyword or candidate (case-insensitive)
  const lowerText = truncated.toLowerCase();
  const candidateMentions = candidates.filter(c => lowerText.includes(c.toLowerCase()));
  const hasKeyword = keywords.some(k => lowerText.includes(k.toLowerCase()));
  if (!candidateMentions.length && !hasKeyword) return null;

  // Skip very short comments — low signal (e.g. "kkk", "😂", single emoji)
  if (truncated.replace(/\s/g, '').length < 15) return null;

  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const commentUrl = `${videoUrl}&lc=${comment.snippet.topLevelComment.id}`;

  return {
    id: comment.snippet.topLevelComment.id,
    source: 'youtube',
    text: truncated,
    author: s.authorDisplayName,
    timestamp: s.publishedAt,
    candidate_mentions: candidateMentions,
    url: commentUrl,
    video_id: video.id,
    video_title: video.snippet.title,
  };
}
```

---

#### Main collector function

```typescript
export async function collectYouTube(): Promise<SocialPost[]> {
  const searchTerms = process.env.YOUTUBE_SEARCH_TERMS!.split(',');
  const maxVideos = Number(process.env.YOUTUBE_MAX_VIDEOS_PER_RUN ?? '10');
  const maxComments = Number(process.env.YOUTUBE_MAX_COMMENTS_PER_VIDEO ?? '200');
  const candidates = CANDIDATES;
  const keywords = process.env.KEYWORDS!.split(',');

  let totalUnitsUsed = 0;
  const allPosts: SocialPost[] = [];
  const seenVideoIds = new Set<string>();

  for (const term of searchTerms) {
    // Phase 1: search
    const searchResults = await searchVideos(term);
    totalUnitsUsed += 100;

    const newVideoIds = searchResults
      .map(r => r.id.videoId)
      .filter(id => !seenVideoIds.has(id));
    newVideoIds.forEach(id => seenVideoIds.add(id));

    if (!newVideoIds.length) continue;

    // Phase 2: enrich (1 unit per batch)
    const videoMap = await enrichVideos(newVideoIds);
    totalUnitsUsed += 1;

    // Filter to eligible videos
    const eligible = [...videoMap.values()].filter(v =>
      Number(v.statistics.commentCount) > 0 &&
      Number(v.statistics.viewCount) >= 500 &&
      (!v.snippet.defaultAudioLanguage ||
       ['pt', 'pt-BR'].includes(v.snippet.defaultAudioLanguage))
    ).slice(0, maxVideos);

    // Phase 3: fetch comments per video
    for (const video of eligible) {
      const threads = await fetchComments(video.id, maxComments);
      totalUnitsUsed += 1;

      // Phase 4: map + deduplicate via seen-IDs table
      for (const thread of threads) {
        const commentId = thread.snippet.topLevelComment.id;
        const alreadySeen = await checkSeenId(commentId);  // DynamoDB seen-IDs table
        if (alreadySeen) continue;
        await markSeenId(commentId);

        const post = mapCommentToPost(thread, video, candidates, keywords);
        if (post) allPosts.push(post);
      }
    }
  }

  // Emit quota metric to CloudWatch
  await emitMetric('YouTubeQuotaUsed', totalUnitsUsed);

  return allPosts;
}
```

---

#### Error class

```typescript
class YouTubeApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(`YouTube ${endpoint} failed with HTTP ${status}: ${body}`);
    this.name = 'YouTubeApiError';
  }
}
```

**Error handling policy:**

| Scenario | Behaviour |
|---|---|
| HTTP 403 `commentsDisabled` | Skip video silently, continue |
| HTTP 403 `quotaExceeded` | Log to CloudWatch, throw — Lambda fails, EventBridge retries after 1 min |
| HTTP 429 | Exponential backoff: wait 30s, retry once, then skip term |
| HTTP 5xx | Retry once after 5s; if still failing, skip and log |
| Comment text empty | Skip comment |
| Video has 0 comments | Skip video before fetching (caught in enrichment phase) |

---

#### Quota-exceeded auto-disable

A CloudWatch alarm on `YouTubeQuotaUsed` with threshold 9,000 units/day triggers an SNS topic.
An SNS Lambda subscriber sets a `YOUTUBE_DISABLED_UNTIL` flag in the `collector-state` DynamoDB table
(value: ISO timestamp of midnight UTC). The YouTube collector checks this flag at startup and
exits early if the current time is before `YOUTUBE_DISABLED_UNTIL`.

```typescript
// At top of youtube-collector Lambda handler
const state = await dynamo.send(new GetItemCommand({
  TableName: process.env.COLLECTOR_STATE_TABLE!,
  Key: { source: { S: 'youtube' } },
}));
const disabledUntil = state.Item?.disabled_until?.S;
if (disabledUntil && new Date() < new Date(disabledUntil)) {
  console.log(`YouTube collector disabled until ${disabledUntil} — quota protection`);
  return;
}
```

---

#### CDK construct additions (`streaming-stack.ts`)

```typescript
// YouTube collector Lambda
const youtubeCollector = new lambda.Function(this, 'YouTubeCollector', {
  runtime: lambda.Runtime.NODEJS_24_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('../packages/collector'),
  timeout: cdk.Duration.seconds(60),
  memorySize: 256,
  environment: {
    KINESIS_STREAM_NAME: stream.streamName,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY!,
    YOUTUBE_SEARCH_TERMS: 'Lula 2026,Flávio Bolsonaro 2026,eleições presidenciais 2026',
    YOUTUBE_MAX_VIDEOS_PER_RUN: '10',
    YOUTUBE_MAX_COMMENTS_PER_VIDEO: '200',
    KEYWORDS: process.env.KEYWORDS!,
    COLLECTOR_STATE_TABLE: collectorStateTable.tableName,
    SEEN_IDS_TABLE: seenIdsTable.tableName,
  },
});

// Grant permissions
stream.grantWrite(youtubeCollector);
seenIdsTable.grantReadWriteData(youtubeCollector);
collectorStateTable.grantReadWriteData(youtubeCollector);

// CloudWatch custom metric alarm → quota protection
const quotaAlarm = new cloudwatch.Alarm(this, 'YouTubeQuotaAlarm', {
  metric: new cloudwatch.Metric({
    namespace: 'Eleicoes2026',
    metricName: 'YouTubeQuotaUsed',
    statistic: 'Sum',
    period: cdk.Duration.hours(24),
  }),
  threshold: 9000,
  evaluationPeriods: 1,
  alarmDescription: 'YouTube Data API v3 daily quota approaching limit',
});
quotaAlarm.addAlarmAction(new cwActions.SnsAction(alertTopic));

// EventBridge rule — every 5 minutes
new events.Rule(this, 'YouTubeCollectorSchedule', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
  targets: [new targets.LambdaFunction(youtubeCollector)],
});
```

---

## Lambda: Fake Information Scorer (`packages/processor/src/fakechecker.ts`)

Called from inside the Processor Lambda — not a separate Lambda. Runs after Comprehend
sentiment scoring, before the DynamoDB write, for every post that passes the confidence
threshold (`FAKE_INFO_CONFIDENCE_THRESHOLD`).

### Bedrock prompt (Portuguese)

Sent to `anthropic.claude-haiku-4-5-20251001` via `bedrock-runtime:InvokeModel`:

```
Você é um verificador de fatos especializado em desinformação eleitoral brasileira.
Analise o comentário abaixo e responda SOMENTE com um objeto JSON, sem texto adicional.

Comentário: "{text}"
Candidatos mencionados: {candidates}

Responda com:
{
  "credibility_score": <inteiro 0-100, onde 100 = certamente falso>,
  "flags": <array com zero ou mais valores do conjunto: ["urna_fraud", "candidate_crime",
             "vote_buying", "election_coup", "fake_quote", "health_disinfo",
             "economic_disinfo", "foreign_interference"]>,
  "reasoning": "<uma frase em português explicando o score, max 120 caracteres>"
}

Critérios:
- Score 0–39: sem alegações verificáveis problemáticas → CREDIBLE
- Score 40–69: alegações suspeitas ou sem fonte → SUSPICIOUS  
- Score 70–100: desinformação provável ou conhecida → LIKELY_FALSE
Se o comentário for opinião pessoal sem alegações factuais, retorne score 0 e flags [].
```

### Logic

1. Skip if `source === 'news'` (RSS news articles are from verified outlets — do not score).
2. Skip if Comprehend confidence < `FAKE_INFO_CONFIDENCE_THRESHOLD`.
3. Call `bedrock-runtime:InvokeModel` with the prompt above.
4. Parse JSON response; strip any accidental markdown fences before `JSON.parse`.
5. Derive `credibility_label`:
   - score < 40 → `CREDIBLE`
   - score 40–69 → `SUSPICIOUS`
   - score ≥ 70 → `LIKELY_FALSE`
6. On Bedrock error or JSON parse failure: set `credibility_score: null`,
   `credibility_label: "UNSCORED"`, `flags: []`. Never let scorer failure block the write.
7. Log score + flags to CloudWatch. Emit a custom metric
   `FakeInfoDetected` (count=1) when `credibility_label === "LIKELY_FALSE"`.

### Batching

Bedrock `InvokeModel` is called per-post (no batching API for Haiku). To avoid
timeout, process Bedrock calls with concurrency capped at **5 in-flight requests**
using a semaphore (e.g. `p-limit` library). Remaining posts in the Kinesis batch
are processed sequentially in groups of 5.

### Cost note

Claude Haiku input/output is priced at ~$0.25/$1.25 per million tokens.
A 280-char comment + prompt ≈ 200 input tokens + 60 output tokens.
At 100,000 scored comments/month: ~$7/month additional cost.

---

## Lambda: Processor

**Trigger:** Kinesis Data Streams (`election-stream`), batch size 100, starting position LATEST  
**Runtime:** Node.js 24.x  
**Timeout:** 120s  
**Memory:** 1024 MB

> **Why 1024 MB / 120s:** Each batch of 100 posts requires: language detection (Comprehend),
> sentiment analysis (Comprehend), Bedrock fake-info scoring (concurrency-5 semaphore, up to
> 20 rounds), plus 4 DynamoDB writes per post (election-sentiment, comment-samples,
> misinfo-events, keyword-counts). Higher memory also means a faster vCPU, reducing wall-clock time.

**Kinesis error handling:** `bisect-on-error: true` with a max retry of 3. After 3 retries,
poison records are sent to an **SQS Dead Letter Queue** (`processor-dlq`). The shard never
blocks — bad records are isolated and the batch continues.

### Logic

0. **Language filter (new):** Call `comprehend:DetectDominantLanguage` on each post. Skip
   the post if the Portuguese confidence score is < 0.7. This filters English tweets,
   Spanish comments, and emoji-only posts before any further processing.
1. Decode each base64 Kinesis record into `SocialPost`.
2. Call `comprehend:DetectSentiment` with `LanguageCode: 'pt'` for each post text.
3. For each `candidate_mention` in the post, call DynamoDB `UpdateItem` with atomic counters
   on the current ISO-hour window item:
   - Increment `positive_count`, `negative_count`, or `neutral_count` based on Comprehend result.
   - Increment `total`.
   - Recompute `score = round(positive / total * 100)`.
   - Set `last_updated`.
4. Write or update the hourly snapshot item using the current ISO hour as `window` (TTL = 30h).
5. Batch Comprehend calls to stay under 25 units/request limit.
6. On partial failure, use `bisect-on-error: true` — isolate bad records via bisect, send to DLQ.
7. Call `fakechecker.scorePost(post)` for each post (see Fake Information Scorer section).
   - Returns `{ credibility_score, credibility_label, flags, flag_reasoning }`.
   - Runs after Comprehend, before DynamoDB writes. Never blocks on failure.
8. For every processed post, write a trimmed record to `comment-samples` DynamoDB table:
   - Include `source`, `candidate`, `sentiment`, `text` (≤280 chars), `author` (raw, internal),
     `url`, `video_title` (YouTube only), `score`, `credibility_score`, `credibility_label`,
     `flags`, `flag_reasoning`.
   - Set `ttl` to now + 15 minutes.
   - Use `PutItem` with condition `attribute_not_exists(#id)` to avoid duplicates.
   - Only write posts where Comprehend confidence score ≥ 0.7 (filters low-quality noise).
9. **Write to `misinfo-events` (new):** For every post processed by the fakechecker
   (regardless of credibility label), write one item to `misinfo-events`:
   - PK=`candidate`, SK=`timestamp#id`, plus `credibility_label`, `credibility_score`,
     `flags`, `flag_reasoning`, `source`.
   - TTL = now + 30 days.
   - Use `PutItem` with condition `attribute_not_exists(candidate)` to avoid duplicates.
10. **Write trending hashtags (new):** Extract all `/#\w+/g` tokens from `post.text`.
    For each unique hashtag, call `UpdateItem` on `keyword-counts`:
    - PK=`hashtag`, SK=`<ISO-hour>#<candidate>`, atomic `ADD #count :one`.
    - TTL = now + 48 hours.

---

## Lambda: API

**Trigger:** API Gateway REST  
**Runtime:** Node.js 24.x  
**Timeout:** 10s  
**Memory:** 128 MB

### Endpoints

#### `GET /v1/scores`

Returns the rolling 1-hour live sentiment scores for all candidates.

**Implementation:** For each candidate, Query the `election-sentiment` table with
`SK BETWEEN <current-ISO-hour minus 11 hours> AND <current-ISO-hour>` (12 hourly windows).
Sum `positive_count`, `negative_count`, `neutral_count`, and `total` across all returned items.
Recompute `score = round(positive_sum / total_sum * 100)`. This computes a true rolling
1-hour window at query time — no pre-aggregated `"live"` item is stored.

**Caching:** Response includes `Cache-Control: max-age=30`. CloudFront caches this path
with a 30-second TTL, so up to 1,000 concurrent users share a single Lambda invocation.

```json
{
  "scores": [
    {
      "candidate": "Lula",
      "positive": 1240,
      "negative": 830,
      "neutral": 410,
      "total": 2480,
      "score": 50,
      "last_updated": "2026-10-04T14:32:00Z"
    }
  ],
  "window": "1h",
  "updatedAt": "2026-10-04T14:32:05Z"
}
```

#### `GET /v1/history?candidate=Lula&hours=24`

Returns hourly sentiment snapshots for the last N hours from DynamoDB (up to 30 hours,
matching the TTL of hourly items).

#### `GET /v1/samples?source=youtube&candidate=Lula&limit=20`

Returns recent raw comments from the `comment-samples` table for display in the live sampler panel.

Query params (all optional):
- `source` — filter by platform (`youtube`, `twitter`, `news`). Omit for all sources.
- `candidate` — filter by candidate mention.
- `sentiment` — filter by `POSITIVE`, `NEGATIVE`, or `NEUTRAL`.
- `limit` — number of items (default 20, max 50).

Response:

```json
{
  "samples": [
    {
      "source": "youtube",
      "candidate": "Lula",
      "sentiment": "POSITIVE",
      "score": 87,
      "text": "Lula tem experiência de sobra pra isso...",
      "author": "usuario_brasil",
      "url": "https://youtube.com/watch?v=abc123&lc=xyz",
      "video_title": "Debate presidencial 2026 ao vivo",
      "timestamp": "2026-10-04T14:31:00Z",
      "credibility_score": 72,
      "credibility_label": "LIKELY_FALSE",
      "flags": ["urna_fraud"],
      "flag_reasoning": "Alegação sobre fraude na urna sem fonte verificável"
    }
  ],
  "updatedAt": "2026-10-04T14:32:05Z"
}
```

Add optional filter param `credibility=LIKELY_FALSE|SUSPICIOUS|CREDIBLE` to scope
the sampler to flagged content only.

**LGPD anonymization:** The `author` field in every sample response is replaced by
`"usuário_<first-4-hex-of-SHA256(raw_author)>"` before sending. The original username is
never exposed to the client.

#### `GET /v1/trending`

Returns the top 10 trending hashtags from the last 1 hour across all candidates (or filtered
by `candidate` query param).

**Implementation:** Query `keyword-counts` table for the current and previous ISO-hour windows.
Aggregate counts per hashtag, sort descending, return top 10.

```json
{
  "trending": [
    { "hashtag": "#eleicoes2026", "count": 4200 },
    { "hashtag": "#Lula2026", "count": 1800 },
    { "hashtag": "#DebatePresidencial", "count": 970 }
  ],
  "window_hours": 1,
  "updatedAt": "2026-10-04T14:32:05Z"
}
```

Optional query params:
- `candidate` — filter hashtags attributed to a specific candidate mention.

#### `GET /v1/misinformation?hours=24`

Returns aggregate fake-info stats for the dashboard misinformation panel.

```json
{
  "period_hours": 24,
  "total_scored": 48200,
  "likely_false": 3100,
  "suspicious": 8400,
  "credible": 36700,
  "likely_false_pct": 6.4,
  "top_flags": [
    { "flag": "urna_fraud", "count": 1420 },
    { "flag": "candidate_crime", "count": 890 },
    { "flag": "fake_quote", "count": 560 }
  ],
  "by_candidate": [
    { "candidate": "Lula", "likely_false": 1200, "suspicious": 3100 },
    { "candidate": "Flávio Bolsonaro", "likely_false": 1900, "suspicious": 5300 }
  ],
  "by_source": [
    { "source": "youtube", "likely_false": 2100 },
    { "source": "twitter", "likely_false": 1000 }
  ]
}
```

This endpoint reads from a separate `misinfo-aggregates` DynamoDB table updated
hourly by a scheduled Lambda (`misinfo-aggregator`).

#### `GET /v1/trending`

Returns top 10 keywords co-occurring with candidate mentions in the last hour (computed from DynamoDB aggregates).

### CORS

Allow `CORS_ORIGIN` env var. In development allow `http://localhost:5173`.

---

## Lambda: Misinformation Aggregator

**Trigger:** EventBridge rule — every 60 minutes  
**Runtime:** Node.js 24.x  
**Timeout:** 30s  
**Memory:** 256 MB

Scans the **`misinfo-events` table** (GSI on `credibility_label`, 30-day TTL) and computes:
- Total scored, counts per label, percentage `LIKELY_FALSE`
- Top 8 flags by frequency
- Per-candidate and per-source breakdown

> **Why `misinfo-events` and not `comment-samples`:** `comment-samples` has a 15-minute TTL —
> data is gone before the aggregator can query 24h or 7d windows. `misinfo-events` is a
> dedicated long-lived log written by the Processor Lambda for exactly this purpose.

Writes results to `misinfo-aggregates` DynamoDB table:
- **PK:** `period` = `"24h"` | `"7d"` | `"live"` (last 60 min)
- **SK:** `computed_at` (ISO hour)
- TTL: 30 days

Powered by a GSI on **`misinfo-events`**:
- **GSI name:** `credibility-label-index`
- **PK:** `credibility_label`, **SK:** `timestamp#id`
- Allows efficient scan of all `LIKELY_FALSE` items without full table scan.

---

## React Dashboard (`packages/web`)

**Stack:** React 18, TypeScript, Vite, Recharts, Tailwind CSS

### Pages / Components

#### `App.tsx`
- Layout: dark left sidebar (nav + candidate legend) + white main content area (G1/Bloomberg style).
- Header: "Eleições 2026 — Monitor de Sentimento" title, live indicator pulsing dot.
- Routes: `/` (main dashboard), `/metodologia` (methodology page).
- Score updates: **WebSocket primary, polling fallback.** The `useScores` hook's 30-second
  polling interval is disabled while the WebSocket connection is alive; it re-enables
  automatically when the connection drops. This avoids redundant HTTP requests during
  normal operation while maintaining a fallback for users behind WebSocket-blocking proxies.

#### `CandidateCard.tsx`
- Props: `candidate`, `score`, `positive`, `negative`, `total`, `lastUpdated`
- Displays candidate name, party badge (using official party colors from the palette above),
  sentiment score (0–100), and a horizontal bar split into green (positive) / gray (neutral) / red (negative).
- Score formula: `round(positive / total × 100)` — positive percentage only, intuitive for general public.
- Color-codes the score: ≥60 green, 40–59 yellow, <40 red.
- Score label includes a small `ⓘ` icon; hover/tap shows tooltip: "Percentagem de menções
  positivas nas últimas 1 hora."
- **Mobile:** Cards stack vertically in a single column on screens < `md` breakpoint.

#### `SentimentChart.tsx`
- Line chart (Recharts `LineChart`) showing score over time for all candidates.
- X-axis: last 24 hours in hourly buckets.
- Each candidate gets a distinct color line.
- Tooltip shows exact values on hover.

#### `TrendingPanel.tsx`

Compact panel displayed in the sidebar below the candidate legend.
Title: "Trending agora" with a clock icon.

- Fetches `GET /v1/trending` every 60 seconds.
- Displays top 10 hashtags as a ranked list: `#1 #eleicoes2026 — 4.2k`.
- Each hashtag is a clickable pill that filters the CommentSampler by appending the hashtag
  as a search term (frontend-only filter on the visible card text, no new API call).
- Skeleton placeholder while loading.

#### `CommentSampler.tsx`

A dedicated panel showing a live, filterable stream of raw comments — primarily YouTube
comments since they tend to be longer and more expressive than tweet-length posts.

**Layout:** Full-width panel below the `SentimentChart`.
Title: "Amostra ao vivo de comentários" with a pulsing green dot when streaming.

**Controls (top of panel):**
- Source toggle pills: `Todos` · `YouTube` · `X/Twitter` · `Notícias` — single-select, **default `Todos`**.
- Candidate filter pills: `Todos` · one per candidate — single-select, default `Todos`.
- Sentiment filter: `Todos` · `Positivo` · `Negativo` · `Neutro` — single-select, default `Todos`.
- Credibility filter: `Todos` · `Verificável` · `Suspeito` · `Falso provável` — single-select, default `Todos`.
- Pause/Resume toggle button — stops new comments sliding in while the user reads.

**Comment card** (rendered per sample):
- Left accent bar colored by sentiment: green (positive), red (negative), gray (neutral).
- Source platform icon (YouTube play icon, X bird, newspaper) + platform name.
- Candidate badge (colored per candidate, matches `CandidateCard` palette).
- Comment text, max 3 lines with "ver mais" expand toggle if truncated.
- Author name + timestamp (relative: "há 2 min").
- For YouTube: video title as a linked subtitle below the comment text (opens original video in new tab).
- Comprehend confidence score shown as a small pill on hover (e.g. "87% confiança").
- `FakeInfoBadge` component rendered inline after the author line (see below).
- When `credibility_label === "LIKELY_FALSE"`: card gains a top border `2px solid #E24B4A` and a
  subtle amber background tint. Does not hide or collapse the comment — the text remains
  readable so users can judge for themselves.
- Expanded view ("ver mais"): shows `flag_reasoning` text in italics below the comment body,
  prefixed with "⚠ Alegação não verificada:".

**Behavior:**
- On mount: fetch `GET /v1/samples` with active filters, populate with up to 20 cards.
- WebSocket messages with `type: "new_sample_batch"` prepend the array of new cards at the top.
- Maximum 50 cards rendered at a time; oldest cards are removed from the bottom.
- New cards animate in with a slide-down + fade (CSS `@keyframes`, respects `prefers-reduced-motion`).
- When paused: buffer incoming WebSocket sample batches (max 100 total samples); show "X novos comentários" badge on Resume button.
- On filter change: refetch `GET /v1/samples` with updated query params; clear current cards.

**Empty state:** "Nenhum comentário encontrado para estes filtros." with a ghost icon.

#### `FakeInfoBadge.tsx`

Inline badge rendered inside each comment card.

Props: `credibility_label`, `credibility_score`, `flags`

- `CREDIBLE` (score < 40): no badge rendered.
- `SUSPICIOUS` (score 40–69): small amber pill "Suspeito" with a warning triangle icon.
  Tooltip on hover: list of flag labels translated to Portuguese.
- `LIKELY_FALSE` (score ≥ 70): red pill "Provável desinformação" with an X-circle icon.
  Tooltip: flag labels + `flag_reasoning`.
- `UNSCORED`: gray pill "Não analisado" — shown only when `credibility_score === null`.

All tooltips are keyboard-accessible (`role="tooltip"`, `aria-describedby`).
Flag labels rendered in Portuguese:

| Flag key | PT label |
|---|---|
| `urna_fraud` | Fraude na urna |
| `candidate_crime` | Crime atribuído sem fonte |
| `vote_buying` | Compra de votos |
| `election_coup` | Golpe eleitoral |
| `fake_quote` | Citação falsa |
| `health_disinfo` | Desinformação de saúde |
| `economic_disinfo` | Dado econômico falso |
| `foreign_interference` | Interferência estrangeira |

#### `MisinfoStats.tsx`

A **collapsible** secondary section rendered between `SentimentChart` and `CommentSampler`.
**Collapsed by default** — the expand button shows a small badge with the current
`likely_false_pct` (e.g., "6.4% ⚠") so users can assess relevance before expanding.

When collapsed: only the section header and expand button are visible. This keeps the
main view focused on sentiment scores and the comment feed without alarming general-public
users with misinformation statistics upfront.

Title (when expanded): "Radar de desinformação — últimas 24h"

Layout (when expanded): 3-column metric grid + horizontal flag bar chart.

Metric cards (fetched from `GET /v1/misinformation?hours=24`):
- "Comentários analisados" — total scored, formatted with `toLocaleString('pt-BR')`
- "Provável desinformação" — `likely_false_pct`% in red if > 5%, amber if > 2%
- "Tema mais frequente" — top flag translated to Portuguese

Flag frequency bar chart (Recharts `BarChart`, horizontal):
- Y-axis: Portuguese flag labels
- X-axis: count
- Bars colored red for top flag, amber for rest
- Shows all detected flags (up to 8); chart height scales dynamically with flag count

Per-candidate breakdown table (below bar chart):
- Columns: Candidate · Provável falso · Suspeito · Taxa falso%
- Sorted by `likely_false` descending
- "Taxa falso" cell colored red if > 8%, amber if > 4%

Data refreshes every 5 minutes. Skeleton placeholder shown while loading.

#### `Metodologia.tsx` (`/metodologia` route)

A dedicated static page — no live data fetching. Required for responsible publication
of a public political data tool; important for journalists who may cite the dashboard.

Sections:
1. **Sobre o projeto** — who built it, why, and what it is not (not affiliated with any campaign or party).
2. **Fontes de dados** — list of sources (RSS feeds from Brazilian news portals, X/Twitter via Apify, YouTube Data API), with data collection frequency and language filters.
3. **Como o sentimento é calculado** — Comprehend for Portuguese, formula (`positive / total × 100`), 1-hour rolling window, confidence threshold (≥ 0.7), multi-candidate attribution note.
4. **Desinformação** — what the Bedrock scorer does, the claim taxonomy table, what `SUSPICIOUS` vs `LIKELY_FALSE` mean, and the explicit caveat that a flag is not a verdict.
5. **Limitações** — social media is not a poll; volume ≠ votes; bot activity not filtered; Comprehend sentiment is imperfect on slang and irony; regional data unavailable.
6. **Privacidade** — LGPD: usernames are anonymized in the public UI; raw data is retained internally for 30 days then deleted; no user tracking on the dashboard itself.

### `useScores` hook

```typescript
// WebSocket-primary, polling fallback.
// When wsConnected=true: interval is null (no polling — WS delivers score_update events).
// When wsConnected=false: polls GET /v1/scores every 30s.
// Returns { scores, loading, error, wsConnected }
```

### `useCommentSampler` hook

```typescript
// Manages comment sampler state
// Parameters: { source, candidate, sentiment, credibility, paused }
// On mount / filter change: fetches GET /v1/samples with params
// Subscribes to WebSocket messages with type === 'new_sample_batch'
//   (broadcaster batches new samples every 2 seconds and pushes as an array)
// When paused=true: buffers incoming sample arrays, exposes bufferedCount
// Returns: { samples, loading, error, bufferedCount, flush }
// flush(): moves buffered samples into live list (called on Resume)
// Caps live list at 50 items, drops oldest on overflow
```

### `useWebSocket` hook

```typescript
// Connects to VITE_WS_URL
// On message: parse JSON, update scores state
// Reconnects with exponential backoff on disconnect
```

---

## Infrastructure (CDK)

### `streaming-stack.ts`

- **Kinesis Data Streams:** **On-Demand mode** (`StreamMode.ON_DEMAND`), 7-day retention,
  `encryption: StreamEncryption.KMS`. Auto-scales to handle election-day traffic spikes
  without scheduled shard management. Replaces the original 2-shard provisioned configuration.
- **DynamoDB:** `election-sentiment` table, on-demand billing, TTL on `ttl` attribute (30h on hourly items), point-in-time recovery enabled
- **Collector Lambda (`news` mode):** EventBridge rule every 60 seconds; reads RSS feeds from `RSS_FEEDS` env var
- **Apify collector Lambda (`apify` mode):** EventBridge rule every 5 minutes (X/Twitter via Apify REST API); `APIFY_API_TOKEN` in env
- **YouTube collector Lambda (`youtube` mode):** separate EventBridge rule every 5 minutes; higher timeout (60s) for comment pagination
- **Processor Lambda:** Kinesis event source, batch size 100, `bisect-on-error: true`,
  max retries 3, **SQS DLQ** (`processor-dlq`) for poison records. Memory 1024 MB, timeout 120s.
- **SQS Dead Letter Queue (`processor-dlq`):** receives records that failed after 3 retries.
  Alarm on queue depth > 0 → SNS email notification.
- **Broadcaster Lambda:** DynamoDB Streams on `election-sentiment` and `comment-samples`; both sources have `onFailure: SqsDlq(broadcaster-dlq), retryAttempts: 3`.
- **SQS Dead Letter Queue (`broadcaster-dlq`):** prevents poison records from blocking Streams shards.
- **Regional WAF (`RegionalWaf`):** attached to API Gateway stage. Rules: AWS Common Rule Set, Known Bad Inputs, rate limit 3000/5min per IP.
- **Seen-IDs table:** DynamoDB, TTL 10 minutes (X/Twitter, YouTube, RSS dedup)
- **Comment-samples table:** DynamoDB, on-demand, TTL 15 minutes, `source` PK + `timestamp#id` SK.
  **No GSI** (credibility-label-index moved to misinfo-events table).
- **Misinfo-events table:** DynamoDB, on-demand, TTL 30 days, `candidate` PK + `timestamp#id` SK;
  GSI `credibility-label-index` (PK: `credibility_label`, SK: `timestamp#id`)
- **Keyword-counts table:** DynamoDB, on-demand, TTL 48 hours, `hashtag` PK + `hour_window#candidate` SK
- **Misinfo-aggregates table:** DynamoDB, on-demand, TTL 30 days, `period` PK + `computed_at` SK
- **Misinformation Aggregator Lambda:** EventBridge rule every 60 minutes; reads from `misinfo-events`
- **Bedrock IAM policy:** `bedrock:InvokeModel` on `anthropic.claude-haiku-4-5-20251001` ARN
- **Apify token:** stored in Lambda env var `APIFY_API_TOKEN` (no Secrets Manager needed — read-only token, low risk)
- **Comprehend IAM policy:** add `comprehend:DetectDominantLanguage` alongside existing `comprehend:DetectSentiment`

**CloudWatch Alarms (additions to existing YouTube quota alarm):**

| Alarm | Metric / Condition | Action |
|---|---|---|
| Collector zero-post | Any source Lambda logs 0 records for 3 consecutive runs | SNS email |
| Processor error rate | Lambda error rate > 5% over 5 minutes | SNS email |
| Fake info spike | `FakeInfoDetected` > 15% of `TotalScored` in any 1-hour window | SNS email |
| Score staleness | Any candidate `last_updated` > 10 min during 7am–11pm BRT | SNS email |
| Processor DLQ depth | `processor-dlq` ApproximateNumberOfMessagesVisible > 0 | SNS email |
| Broadcaster DLQ depth | `broadcaster-dlq` ApproximateNumberOfMessagesVisible > 0 | SNS email |

### `pipeline-stack.ts`

- **Kinesis Firehose:** source = Kinesis Data Streams, destination = S3
- **S3 raw bucket:** `eleicoes2026-raw`, versioning on, lifecycle → Glacier after 90 days
- **Buffer:** 60 seconds or 128 MB, whichever comes first
- **Glue crawler:** runs daily, catalogs the Parquet files for Athena

### `website-stack.ts`

- **S3 site bucket:** static website, `index.html` default
- **Domain:** `eleicoes-2026.com` (dashboard) and `api.eleicoes-2026.com` (API + WebSocket).
  The Route 53 public hosted zone already exists — CDK looks it up with
  `HostedZone.fromLookup(this, 'Zone', { domainName: 'eleicoes-2026.com' })`.
  Do **not** create a new hosted zone in CDK.
- **ACM certificate:** `us-east-1` region (required for CloudFront). Use
  `DnsValidatedCertificate` with the existing hosted zone to auto-create and validate the
  cert for `eleicoes-2026.com` and `*.eleicoes-2026.com` in one resource.
- **CloudFront WAF (`CloudFrontWaf`):** CLOUDFRONT-scoped WebACL (must be in us-east-1). Rules: AWS Common Rule Set, Known Bad Inputs, rate limit 2000/5min per IP. Applied to both CloudFront distributions.
- **CloudFront distribution (SPA, ID `EF046M9V59Q9C`):**
  - Aliases: `eleicoes-2026.com`, `www.eleicoes-2026.com`
  - Default behavior: S3 origin, HTTPS redirect, `CACHING_OPTIMIZED`
  - `/api/v1/scores` behavior: API Gateway origin (`api.eleicoes-2026.com`), **30-second TTL** (`Cache-Control: max-age=30`).
    All concurrent users share one cached response, reducing Lambda invocations by ~99% during peak.
  - `/api/*` behavior (all other paths): API Gateway origin, `CACHING_DISABLED`
  - `/ws` behavior: API Gateway WebSocket origin (`api.eleicoes-2026.com/ws`)
  - Error response: 404 → 200 `/index.html` (SPA routing)
- **API Gateway REST:** custom domain `api.eleicoes-2026.com`, base path `/v1`.
  Endpoints: `GET /v1/scores`, `GET /v1/history`, `GET /v1/trending`, `GET /v1/samples`, `GET /v1/misinformation`
- **API Gateway WebSocket:** custom domain `api.eleicoes-2026.com/ws`.
  Routes: `$connect`, `$disconnect`, `$default`
- **Route 53 records:**
  - `eleicoes-2026.com` → A alias → CloudFront distribution
  - `www.eleicoes-2026.com` → A alias → CloudFront distribution (redirect to apex)
  - `api.eleicoes-2026.com` → A alias → API Gateway custom domain

---

## WebSocket Push

A separate Lambda (`websocket-broadcaster`) is triggered by DynamoDB Streams on
`election-sentiment`. When any candidate's `score` changes by ≥1 point, it:

1. Calls `ApiGatewayManagementApi:PostToConnection` for all active WebSocket connections.
2. Stores active connection IDs in a `ws-connections` DynamoDB table (TTL 2 hours).
3. Cleans up stale connections on `GoneException`.
4. Additionally, for **every processed post** written to `comment-samples`, the broadcaster
   **accumulates new_sample events for 2 seconds**, then pushes a single batched message
   containing an array of samples. This reduces API Gateway message charges by ~100× during
   high-traffic periods (debates, election day) compared to one message per comment.

Payload pushed to clients (batched, every 2 seconds):

```json
{
  "type": "new_sample_batch",
  "samples": [
    {
      "source": "youtube",
      "candidate": "Lula",
      "sentiment": "POSITIVE",
      "score": 87,
      "text": "Lula tem experiência de sobra pra isso...",
      "author": "usuário_a3f9",
      "url": "https://youtube.com/watch?v=abc123&lc=xyz",
      "video_title": "Debate presidencial 2026 ao vivo",
      "timestamp": "2026-10-04T14:33:00Z",
      "credibility_score": 72,
      "credibility_label": "LIKELY_FALSE",
      "flags": ["urna_fraud"],
      "flag_reasoning": "Alegação sobre fraude na urna sem fonte verificável"
    }
  ]
}
```

> **Author anonymization in WS payloads:** The broadcaster reads the raw author from
> DynamoDB Streams and applies the same SHA-256 truncation before pushing to clients.

```json
{
  "type": "score_update",
  "candidate": "Lula",
  "score": 51,
  "delta": 1,
  "positive": 1290,
  "negative": 830,
  "neutral": 410,
  "total": 2530,
  "window": "1h",
  "timestamp": "2026-10-04T14:33:00Z"
}
```

> When the frontend receives a `score_update` event, `useScores` applies the update directly
> to its local state without triggering an HTTP poll, keeping the display in sync with minimal latency.

---

## Cost Estimate (monthly, steady state)

| Service | Est. cost |
|---|---|
| Kinesis Data Streams (On-Demand) | ~$22 (similar to 2 provisioned shards at normal load; auto-scales on election day) |
| Lambda (all functions, 1024 MB processor) | ~$5 |
| Amazon Comprehend (DetectSentiment + DetectDominantLanguage, 1M units each) | ~$20 |
| DynamoDB (on-demand, 5 tables) | ~$5 |
| Kinesis Firehose | $2 |
| S3 (site + archive) | $2 |
| CloudFront (10 GB transfer) | $1 |
| API Gateway (5M requests, reduced by CloudFront /v1/scores cache) | ~$10 |
| SQS (processor-dlq, minimal traffic) | <$1 |
| YouTube Data API v3 | $0 (free quota) |
| Apify — X/Twitter scraper (~50K tweets/mo) | ~$8 |
| Amazon Bedrock (Haiku, 100K comments) | ~$7 |
| **Total** | **~$96** |

> **DetectDominantLanguage** adds ~$10/month at 100K posts (1M units at $0.0001/unit) but filters
> non-Portuguese content before it reaches Comprehend sentiment scoring and Bedrock, avoiding
> wasted cost on those more expensive calls.

> Apify costs scale linearly with volume. To reduce cost, increase polling interval to 10 minutes
> off-peak or lower `X_MAX_TWEETS_PER_TERM`.

> Bedrock Haiku fake-info scoring costs ~$0.07 per 1,000 comments scored. Disable scoring
> during off-peak by setting `FAKE_INFO_CONFIDENCE_THRESHOLD=1.0` — no comments will qualify
> and Bedrock is never called.

> API Gateway cost reduced from ~$18 to ~$10 because `GET /v1/scores` is now cached at
> CloudFront with a 30-second TTL — this is the highest-traffic endpoint.

Off-peak reduction (lower Apify polling to 10 min, disable Bedrock): **~$60/month**.

---

## Deployment

```bash
# 1. Bootstrap CDK (first time only)
cd infra
npm install
npx cdk bootstrap aws://ACCOUNT/us-east-1

# 2. Deploy backend stacks
npx cdk deploy StreamingStack PipelineStack

# 3. Build and deploy frontend
cd ../packages/web
npm install
VITE_API_BASE=https://api.eleicoes-2026.com/v1 \
VITE_WS_URL=wss://api.eleicoes-2026.com/ws \
npm run build
aws s3 sync dist/ s3://eleicoes-2026-site --delete
aws cloudfront create-invalidation --distribution-id EF046M9V59Q9C --paths "/*"

# 4. Deploy website stack (after frontend is in S3)
# The existing Route53 hosted zone for eleicoes-2026.com is looked up automatically.
# CDK will create the ACM cert (us-east-1), validate it via DNS, and create alias records.
cd ../../infra
npx cdk deploy WebsiteStack
```

---

## Development Setup

```bash
# Prerequisites: Node 24+, AWS CLI configured, CDK CLI installed

git clone <repo>
cd eleicoes2026
npm install          # installs all workspaces

# Run collector locally (uses .env.local)
cd packages/collector
npm run dev

# Run web dev server
cd packages/web
npm run dev          # http://localhost:5173

# Run CDK diff
cd infra
npx cdk diff
```

---

## Out of Scope (v1)

- User authentication or login
- Storing raw post text (only aggregated counts in DynamoDB)
- Multi-language support (Portuguese only)
- Bluesky integration
- Mobile app
- Regional / state-level sentiment map (no reliable geolocation signal from social APIs)
- Election-phase countdown or timer display
- Kinesis manual shard scaling on election day (replaced by On-Demand mode)
- BuzzFeed component (replaced by CommentSampler with all-sources default)

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sentiment engine | Amazon Comprehend | Native `pt` support, no model training needed |
| Language filter | Comprehend `DetectDominantLanguage` (PT confidence ≥ 0.7) | Filters English/Spanish/emoji-only posts before expensive sentiment + Bedrock calls |
| X/Twitter source | Apify actor `xquik/x-tweet-scraper` | $0.15/1K tweets vs $42K/year official streaming; no API key needed |
| News source | RSS feeds (5 Brazilian portals) | Free, directly controlled feed list, no API key or quota; encoding handled via XML prolog sniffing |
| Frontend | React + Vite + Recharts | Fast build, good charting ecosystem |
| IaC | AWS CDK (TypeScript) | Consistent with Lambda/API code language |
| Database | DynamoDB | Sub-millisecond reads for live dashboard |
| Historical queries | S3 + Athena | Cost-effective for cold data; no warehouse needed |
| YouTube comments | Data API v3 (`commentThreads.list`) | Free quota, richer text than tweets, strong PT signal |
| Comment sampler | DynamoDB 15-min TTL table | Fast reads, self-cleaning, no extra infra |
| Fake info scorer | Amazon Bedrock (Haiku) | Native PT understanding, fixed taxonomy prompt, cheap at low volume |
| Scorer placement | Inside Processor Lambda | Avoids cold-start overhead of a separate Lambda per comment |
| News source exemption | Skip scoring for RSS news | Verified outlets don't need LLM fact-checking; reduces cost and false positives |
| Apify as scraping layer | Single token for X/Twitter | One `APIFY_API_TOKEN`; no per-platform OAuth to manage |
| Live score computation | Sum last 12 hourly windows at API response time | Avoids stale 24h rolling total; rolling 1h window reflects current public mood |
| Misinfo long-term storage | Separate `misinfo-events` table (30-day TTL) | `comment-samples` 15-min TTL is gone before the hourly aggregator can query 24h periods |
| Kinesis capacity | On-Demand mode | Auto-scales for election-day traffic spikes without scheduled shard management |
| Kinesis error handling | `bisect-on-error: true` + SQS DLQ | Prevents bad records from blocking shards; poison records go to DLQ for inspection |
| WS score updates | WebSocket primary, 30s HTTP poll as fallback | Eliminates redundant polling when WS is connected; maintains fallback for WS-blocking proxies |
| WS new_sample | Batched every 2 seconds as array | Reduces API Gateway message charges ~100× during peak traffic (debates, election day) |
| Username display | SHA-256 → first 4 hex chars anonymization in API Lambda | LGPD compliance without breaking deep-link URLs; raw usernames stored internally only |
| Misinfo panel | Collapsible, collapsed by default | General-public audience: misinformation data is available but not alarmist by default |
| Trending keywords | Hashtags only, keyword-counts DynamoDB table | High signal, user-normalized format; simpler than NLP-based keyword extraction |
| Regional map | Out of scope (v1) | No reliable geolocation signal from RSS, X, or YouTube sources |
| Visual style | News dashboard (dark sidebar + white content) | Familiar to Brazilian news readers; information-dense layout suits a data tool |
| Candidate palette | Official party colors | Immediately recognizable to Brazilian voters; no editorial ambiguity |
| Post-election lifecycle | Continue through Dec 31 2026, then static freeze | Covers presidential transition period; static CloudFront freeze costs ~$3/month |
