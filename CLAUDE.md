# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (all workspaces)
```bash
npm install           # install all workspace deps
npm run typecheck     # tsc --noEmit across all packages
npm run build         # build all packages
```

### Collector Lambda (`packages/collector`)
```bash
DRY_RUN=true npm run dev   # local dry-run via tsx — prints posts, skips Kinesis write
npm run build              # tsc compile to dist/
npm run typecheck
```
Requires `.env.local` in the repo root with `NEWS_API_KEY`, `APIFY_API_TOKEN`, `YOUTUBE_API_KEY`.

### Processor / API / Broadcaster Lambdas
```bash
npm run build        # tsc compile (no test runner — verify by deploying or using DRY_RUN)
npm run typecheck
```

### Web frontend (`packages/web`)
```bash
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # tsc + vite build → dist/
npm run typecheck
```
Set `VITE_API_BASE` and `VITE_WS_URL` env vars for the dev server to point at a real API.

### CDK infra (`infra`)
```bash
npx cdk synth StreamingStack    # synthesize — no deploy
npx cdk diff                    # compare with deployed state
npx cdk deploy StreamingStack   # deploy backend
npx cdk deploy WebsiteStack     # deploy frontend CDK stack (after S3 sync)
```

### Full deployment sequence
```bash
npx cdk deploy StreamingStack PipelineStack
cd packages/web
VITE_API_BASE=https://api.eleicoes-2026.com/v1 VITE_WS_URL=wss://api.eleicoes-2026.com npm run build
aws s3 sync dist/ s3://eleicoes-2026-site --delete
aws cloudfront create-invalidation --distribution-id $SPA_CF_ID --paths "/*"
cd ../../infra && npx cdk deploy WebsiteStack
```

## Architecture

```
Social APIs ──► Collector Lambda ──► Kinesis (On-Demand) ──► Processor Lambda ──► DynamoDB
(Reddit, NewsAPI,                                             (Comprehend pt +
 Threads, X via Apify,                                        Bedrock Haiku fakechecker)
 YouTube Data API v3)                                                 │
                                                         Broadcaster Lambda (DDB Streams)
                                                                      │
                                                         API Lambda (REST) + API GW WebSocket
                                                                      │
                                                         React Frontend (CloudFront/S3)
```

All Lambda runtimes are **Node.js 20.x** (dev machine uses Node 24 via nvm). Lambda code is bundled by CDK's `NodejsFunction` construct using **esbuild** — no `tsc` compile step needed for deployment.

## Package structure

| Package | Purpose |
|---|---|
| `packages/collector` | Lambda polling Reddit/NewsAPI/Threads/X/YouTube → Kinesis. `COLLECTOR_MODE` env var routes to the right source. Shared dedup via `seen-ids` DynamoDB table (10-min TTL). |
| `packages/processor` | Kinesis-triggered Lambda. Language filter (`DetectDominantLanguage`, PT≥0.7), sentiment (`DetectSentiment`), Bedrock fakechecker (concurrency-5 via `p-limit`), then writes to 4 DynamoDB tables. |
| `packages/api` | API Gateway REST Lambda. 5 endpoints: `/v1/scores`, `/v1/history`, `/v1/samples`, `/v1/trending`, `/v1/misinformation`. LGPD anonymization via SHA-256 on `author` field. |
| `packages/broadcaster` | DynamoDB Streams-triggered Lambda. Pushes `score_update` and batched `new_sample_batch` events to all WebSocket connections. |
| `packages/web` | React 18 + Vite + Tailwind + Recharts dashboard. Portuguese-only, mobile-first. |
| `infra` | AWS CDK TypeScript app with 3 stacks: `StreamingStack` (core backend), `PipelineStack` (Firehose → S3 → Glue), `WebsiteStack` (CloudFront, ACM, Route 53). |

## DynamoDB tables

| Table | PK | SK | TTL | Notes |
|---|---|---|---|---|
| `election-sentiment` | `candidate` | `window` (ISO hour) | 30h | Rolling score windows; live score is computed at query time from last 12 items |
| `comment-samples` | `source` | `timestamp#id` | 15 min | Raw comments for the live sampler panel |
| `misinfo-events` | `candidate` | `timestamp#id` | 30 days | Long-lived misinfo log; GSI `credibility-label-index` (PK: `credibility_label`) |
| `keyword-counts` | `hashtag` | `hour_window#candidate` | 48h | Trending hashtag counts, atomic ADD increments |
| `misinfo-aggregates` | `period` | `computed_at` | 30 days | Hourly pre-aggregated misinfo stats written by Misinformation Aggregator Lambda |
| `seen-ids` | `id` | — | 10 min | Deduplication across all collectors |
| `collector-state` | `source` | — | — | YouTube quota-disable flag (`disabled_until`) |
| `ws-connections` | `connectionId` | — | 2h | Active WebSocket connection registry |

## Key non-obvious decisions

**No `"live"` window in `election-sentiment`:** The live score shown in the dashboard is computed at API response time by summing the last 12 hourly items (rolling 1h). Never write a pre-aggregated live counter.

**Fakechecker runs inside Processor Lambda** (not a separate Lambda) to avoid cold-start overhead per comment. Skip scoring for `source === 'news'` (NewsAPI articles are from verified outlets).

**WebSocket primary, HTTP polling fallback:** `useScores` disables its 30s poll interval while WS is connected. `useWebSocket` is a module-level singleton with subscription fan-out so multiple hooks share one WS connection.

**`new_sample_batch` batching:** The broadcaster accumulates sample events for 2 seconds before pushing one batched WebSocket message — reduces API Gateway message charges ~100× during high-traffic periods.

**LGPD anonymization:** The `author` field is stored as plaintext internally. The API Lambda and WebSocket broadcaster both apply `SHA-256(author).slice(0,4)` → `"usuário_<hex>"` before sending to any client. Never expose raw usernames in API responses.

**`comment-samples` has no GSI** — the `credibility-label-index` originally proposed there was moved to `misinfo-events` (30-day TTL) because the 15-min TTL on `comment-samples` means data is gone before the hourly Misinfo Aggregator Lambda can query 24h windows.

**Kinesis On-Demand mode:** Auto-scales for election-day traffic spikes. Do not switch to provisioned shards.

**YouTube quota:** 10k units/day free quota (or 100k after a Google Cloud increase request). CloudWatch alarm at 9k units/day triggers quota-disable via `collector-state` table. The `YouTubeQuotaUsed` CloudWatch metric is emitted per run.

## Candidate data

```typescript
// packages/collector/src/types.ts
const CANDIDATES = ['Lula', 'Flávio Bolsonaro', 'Romeu Zema', 'Ronaldo Caiado'];
const CANDIDATE_COLORS = { Lula: '#CC0000', 'Flávio Bolsonaro': '#003580', 'Romeu Zema': '#F4801A', 'Ronaldo Caiado': '#5B7B9A' };
```

These colors are used in Tailwind's `tailwind.config.js` as `lula`, `flavio`, `zema`, `caiado` tokens and must match across CDK, API, and frontend.

## Environment variables

### `.env.local` (repo root, for local dev)
```
NEWS_API_KEY=
APIFY_API_TOKEN=
YOUTUBE_API_KEY=
```

### Lambda env vars set in `streaming-stack.ts` (CDK)
- Collector: `KINESIS_STREAM_NAME`, `REDDIT_USER_AGENT`, `NEWS_API_KEY`, `APIFY_API_TOKEN`, `THREADS_*`, `X_*`, `YOUTUBE_*`, `KEYWORDS`, `SUBREDDITS`
- Processor: `DYNAMO_TABLE`, `COMPREHEND_LANGUAGE`, `BEDROCK_MODEL_ID`, `FAKE_INFO_CONFIDENCE_THRESHOLD`, `FAKE_INFO_SCORE_HIGH`, `FAKE_INFO_SCORE_MEDIUM`
- API: `DYNAMO_TABLE`, `CORS_ORIGIN`

### Web (build-time)
- `VITE_API_BASE` — e.g. `https://api.eleicoes-2026.com/v1`
- `VITE_WS_URL` — e.g. `wss://api.eleicoes-2026.com/ws`

## CDK notes

- `WebsiteStack` must be deployed to `us-east-1` (ACM cert required by CloudFront). This is enforced in `bin/app.ts`.
- The Route 53 hosted zone for `eleicoes-2026.com` already exists — CDK uses `HostedZone.fromLookup()`. Do not create a new hosted zone.
- `crossRegionReferences: true` is set in the CDK app to allow `WebsiteStack` to reference the API URLs from `StreamingStack`.
- Lambda code is bundled at deploy time by `NodejsFunction` (esbuild) — the `dist/` folders of Lambda packages are not used in production.
