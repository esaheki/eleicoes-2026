# Eleições 2026 — Real-Time Sentiment Dashboard

A public web dashboard that streams social media and news data about the 2026 Brazilian presidential election, runs Portuguese-language sentiment analysis via AWS Comprehend, and displays live candidate sentiment scores on a React frontend.

**First round:** October 4, 2026 · **Runoff:** October 25, 2026  
**Candidates:** Lula (PT), Flávio Bolsonaro (PL), Romeu Zema (NOVO), Ronaldo Caiado (PSD)

---

## Architecture

```
Social APIs ──► Collector Lambda ──► Kinesis ──► Processor Lambda ──► DynamoDB
                (RSS feeds,                       (Comprehend pt +
                 X via Apify,                      Bedrock Haiku fakechecker)
                 YouTube Data API v3)                     │
                                             API Lambda + WS Broadcaster
                                                          │
                                           WAF ──► React Frontend (CloudFront/S3)
```

| Service | Purpose |
|---|---|
| Amazon Kinesis (On-Demand) | Real-time post stream |
| AWS Lambda (Node 24.x) | Collector, Processor, API, Broadcaster |
| Amazon DynamoDB (On-Demand) | Sentiment windows, comment samples, misinfo events |
| AWS Comprehend | Portuguese language detection + sentiment |
| Amazon Bedrock (Claude Haiku) | Misinformation scoring |
| AWS WAFv2 | Rate limiting + managed rules on CloudFront and API Gateway |
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
│       ├── streaming-stack.ts   # Kinesis, Lambda, DynamoDB, WAF (Regional)
│       ├── website-stack.ts     # S3, CloudFront, WAF (CloudFront), Route 53
│       └── pipeline-stack.ts    # Firehose, S3 archive, Glue
├── packages/
│   ├── collector/            # Collector Lambda — polls sources → Kinesis
│   │   └── src/
│   │       ├── index.ts      # Handler, routes by COLLECTOR_MODE
│   │       ├── dedup.ts      # DynamoDB-backed deduplication (10-min TTL)
│   │       ├── kinesis.ts    # Batched PutRecords helper
│   │       ├── metrics.ts    # CloudWatch PutMetricData helper
│   │       └── sources/
│   │           ├── rss.ts       # RSS feed collector (encoding-aware)
│   │           ├── apify.ts     # Shared Apify REST client
│   │           ├── xtwitter.ts
│   │           └── youtube.ts   # 4-phase: search → enrich → comments → map
│   ├── processor/            # Processor Lambda — Kinesis → Comprehend → DynamoDB
│   ├── api/                  # API Lambda — 5 REST endpoints
│   └── web/                  # React dashboard (Vite + Tailwind + Recharts)
├── docs/
│   └── wa-review-2026-05-24.md  # AWS Well-Architected review findings
├── package.json              # npm workspaces root
├── tsconfig.base.json        # Shared TypeScript config
└── SPEC.md                   # Full technical specification
```

---

## Getting Started

**Prerequisites:** Node 24+, AWS CLI configured, nvm recommended.

```bash
# Install dependencies
npm install

# Local collector dry-run (RSS feeds)
cd packages/collector
DRY_RUN=true npm run dev    # prints collected posts to stdout, no Kinesis write

# Synthesize CDK (no deploy)
cd infra
npx cdk synth StreamingStack
```

### Environment Variables

Copy `.env.local` to the repo root and fill in your API keys:

```env
APIFY_API_TOKEN=<apify.com token>
YOUTUBE_API_KEY=<google cloud key with YouTube Data API v3>
```

RSS feed URLs are configured in `packages/collector/src/dev.ts` (or via `RSS_FEEDS` env var, comma-separated).

---

## Deployment

```bash
# Deploy backend + pipeline stacks
cd infra
npx cdk deploy StreamingStack PipelineStack

# Build and deploy frontend
cd ../packages/web
VITE_API_BASE=https://api.eleicoes-2026.com/v1 \
VITE_WS_URL=wss://api.eleicoes-2026.com \
npm run build
aws s3 sync dist/ s3://eleicoes-2026-site --delete
aws cloudfront create-invalidation --distribution-id EF046M9V59Q9C --paths "/*"

# Deploy website stack
cd ../../infra
npx cdk deploy WebsiteStack
```

---

## Data Sources

| Source | Method | Cost |
|---|---|---|
| News / portais | RSS feeds (Carta Capital, Jovem Pan, Agência Brasil, UOL, Folha) | Free |
| X/Twitter | Apify actor `xquik/x-tweet-scraper` | ~$6.50/month |
| YouTube | YouTube Data API v3 | Free (10k units/day) |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /v1/scores` | Rolling 1-hour sentiment score per candidate |
| `GET /v1/history?candidate=&hours=` | Hourly sentiment history |
| `GET /v1/samples` | Recent comment samples with filters (source, candidate, sentiment, credibility) |
| `GET /v1/trending?candidate=` | Top hashtags by count |
| `GET /v1/misinformation?hours=` | Misinfo aggregate stats |
| `WSS /ws` | Live `score_update` and `new_sample_batch` events |

---

## Build Status

All phases complete and deployed.

| Phase | Status | Description |
|---|---|---|
| 1 — Workspace & Types | ✅ | npm workspaces, shared `SocialPost` types |
| 2 — CDK Infrastructure | ✅ | All DynamoDB tables, Kinesis, Lambda placeholders |
| 3 — Collector Lambda | ✅ | RSS/X/YouTube sources, dedup, Kinesis write |
| 4 — Processor Lambda | ✅ | Comprehend sentiment → DynamoDB |
| 5 — Fake Info Scorer | ✅ | Bedrock Claude Haiku misinfo scoring |
| 6 — API Lambda | ✅ | 5 REST endpoints |
| 7 — WebSocket Broadcaster | ✅ | DynamoDB Streams → live push, SQS DLQ |
| 8 — React Frontend | ✅ | Vite + Tailwind + Recharts dashboard |
| 9 — Website Infrastructure | ✅ | CloudFront, S3, ACM, Route 53, WAFv2 |
| 10 — Pipeline + Monitoring | ✅ | Firehose archive, CloudWatch alarms |
