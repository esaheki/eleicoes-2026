# Eleições 2026 — Real-Time Sentiment Dashboard

A public web dashboard that streams social media and news data about the 2026 Brazilian presidential election, runs Portuguese-language sentiment analysis via AWS Comprehend, and displays live candidate sentiment scores on a React frontend.

**First round:** October 4, 2026 · **Runoff:** October 25, 2026  
**Candidates:** Lula (PT), Flávio Bolsonaro (PL), Romeu Zema (NOVO), Ronaldo Caiado (PSD)

---

## Architecture

```
Social APIs ──► Collector Lambda ──► Kinesis ──► Processor Lambda ──► DynamoDB
                (Reddit, NewsAPI,                (Comprehend +
                 Threads, X, YouTube)             Bedrock Haiku)
                                                        │
                                               API Lambda + WS Broadcaster
                                                        │
                                               React Frontend (CloudFront/S3)
```

| Service | Purpose |
|---|---|
| Amazon Kinesis (On-Demand) | Real-time post stream |
| AWS Lambda (Node 20.x) | Collector, Processor, API, Broadcaster |
| Amazon DynamoDB (On-Demand) | Sentiment windows, comment samples, misinfo events |
| AWS Comprehend | Portuguese language detection + sentiment |
| Amazon Bedrock (Claude Haiku) | Misinformation scoring |
| API Gateway (REST + WebSocket) | REST endpoints + live push |
| CloudFront + S3 | Static frontend hosting |
| Route 53 | `eleicoes-2026.com` / `api.eleicoes-2026.com` |

---

## Repository Structure

```
eleicoes-2026/
├── infra/                    # AWS CDK stacks (TypeScript)
│   ├── bin/app.ts
│   └── lib/
│       ├── streaming-stack.ts   # Kinesis, Lambda, DynamoDB
│       ├── website-stack.ts     # S3, CloudFront, API Gateway, Route 53
│       └── pipeline-stack.ts    # Firehose, S3 archive, Glue
├── packages/
│   ├── collector/            # Collector Lambda — polls APIs → Kinesis
│   │   └── src/
│   │       ├── index.ts      # Handler, routes by COLLECTOR_MODE
│   │       ├── dedup.ts      # DynamoDB-backed deduplication (10-min TTL)
│   │       ├── kinesis.ts    # Batched PutRecords helper
│   │       ├── metrics.ts    # CloudWatch PutMetricData helper
│   │       └── sources/
│   │           ├── reddit.ts
│   │           ├── newsapi.ts
│   │           ├── apify.ts     # Shared Apify REST client
│   │           ├── threads.ts
│   │           ├── xtwitter.ts
│   │           └── youtube.ts   # 4-phase: search → enrich → comments → map
│   ├── processor/            # Processor Lambda — Kinesis → Comprehend → DynamoDB
│   ├── api/                  # API Lambda — 5 REST endpoints
│   └── web/                  # React dashboard (Vite + Tailwind + Recharts)
├── package.json              # npm workspaces root
├── tsconfig.base.json        # Shared TypeScript config
├── SPEC.md                   # Full technical specification
└── PLAN.md                   # Incremental build plan with progress tracking
```

---

## Getting Started

**Prerequisites:** Node 20+, AWS CLI configured, nvm recommended.

```bash
# Install dependencies
npm install

# Local collector dry-run (Reddit + NewsAPI)
cd packages/collector
npm run dev          # prints collected posts to stdout, no Kinesis write

# Synthesize CDK (no deploy)
cd infra
npx cdk synth StreamingStack
```

### Environment Variables

Copy `.env.local` to the repo root and fill in your API keys:

```env
NEWS_API_KEY=<newsapi.org key>
APIFY_API_TOKEN=<apify.com token>
YOUTUBE_API_KEY=<google cloud key with YouTube Data API v3>
```

---

## Deployment

```bash
# Deploy backend infrastructure
cd infra
npx cdk deploy StreamingStack

# (Later phases) Deploy full stack
npx cdk deploy --all
```

---

## Data Sources

| Source | Method | Cost |
|---|---|---|
| Reddit | Public JSON API (no key) | Free |
| NewsAPI | REST API | Free tier (1,000 req/day) |
| Threads | Apify actor `futurizerush/threads-keyword-search` | ~$13/month |
| X/Twitter | Apify actor `xquik/x-tweet-scraper` | ~$6.50/month |
| YouTube | YouTube Data API v3 | Free (10k units/day) |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /v1/scores` | Rolling 1-hour sentiment score per candidate |
| `GET /v1/history?candidate=&hours=` | Hourly sentiment history |
| `GET /v1/samples` | Recent comment samples with filters |
| `GET /v1/trending?candidate=` | Top hashtags by count |
| `GET /v1/misinformation?hours=` | Misinfo aggregate stats |
| `WSS /ws` | Live `score_update` and `new_sample_batch` events |

---

## Build Progress

See [PLAN.md](PLAN.md) for the full 10-phase build plan.

| Phase | Status | Description |
|---|---|---|
| 1 — Workspace & Types | ✅ | npm workspaces, shared `SocialPost` types |
| 2 — CDK Infrastructure | ✅ | All DynamoDB tables, Kinesis, Lambda placeholders |
| 3 — Collector Lambda | ✅ | All 5 sources, dedup, Kinesis write, esbuild bundle |
| 4 — Processor Lambda | pending | Comprehend sentiment → DynamoDB |
| 5 — Fake Info Scorer | pending | Bedrock Claude Haiku misinfo scoring |
| 6 — API Lambda | pending | 5 REST endpoints |
| 7 — WebSocket Broadcaster | pending | DynamoDB Streams → live push |
| 8 — React Frontend | pending | Vite + Tailwind + Recharts dashboard |
| 9 — Website Infrastructure | pending | CloudFront, S3, ACM, Route 53 |
| 10 — Pipeline + Monitoring | pending | Firehose archive, CloudWatch alarms |
