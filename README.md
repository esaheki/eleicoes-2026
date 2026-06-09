# Eleições 2026 — Real-Time Election Sentiment Dashboard

A fully-serverless, event-driven pipeline that ingests social media and news content about the 2026 Brazilian presidential election, runs Portuguese-language AI sentiment analysis and misinformation scoring via Amazon Bedrock, and streams live results to a React dashboard over WebSockets — with sub-second latency from post ingestion to browser update.

**Live:** [eleicoes-2026.com](https://eleicoes-2026.com) · **API:** [api.eleicoes-2026.com/v1](https://api.eleicoes-2026.com/v1)  
**Election dates:** Round 1 October 4, 2026 · Runoff October 25, 2026

---

## What makes this interesting

**End-to-end serverless with zero cold-start tuning.** Every layer — ingest, processing, API, push — runs on Lambda. The fakechecker runs inside the Processor Lambda rather than a separate function specifically to avoid per-comment cold-start overhead. All DynamoDB tables and Kinesis are On-Demand; the system scales to election-day spikes without any provisioned capacity decisions.

**WebSocket-primary, HTTP-fallback real-time delivery.** The frontend holds a single module-level WebSocket singleton with subscription fan-out so all React hooks share one connection. The HTTP polling hook disables itself while the WS is live, then re-enables on disconnect — zero wasted requests during normal operation.

**`new_sample_batch` accumulation.** The Broadcaster Lambda collects individual DynamoDB Stream events for 2 seconds before pushing a single batched WebSocket message, cutting API Gateway message charges ~100× during high-traffic periods.

**Live scores computed at query time, never stored.** There is no `"live"` window in DynamoDB. The rolling 1-hour score is computed at API response time by summing the last 12 hourly items. This avoids an entire class of cache-invalidation bugs and keeps the data model simple.

**LGPD-compliant anonymization.** The `author` field is stored as plaintext internally (needed for dedup). Both the API Lambda and the WebSocket broadcaster apply `SHA-256(author).slice(0,4)` → `"usuário_<hex>"` before any data leaves the backend. Raw usernames never appear in API responses.

**Encoding-aware RSS ingestion.** Brazilian news outlets like Folha serve RSS as ISO-8859-1 without declaring the charset in `Content-Type`. The collector reads raw bytes, sniffs the encoding from the XML prolog, and decodes with `TextDecoder` before parsing — the only way to get correct accents from those feeds.

**Two-tier WAF.** A CloudFront-scoped WebACL (us-east-1) protects both CDN distributions and uses a tighter rate limit (2000 req/5min per IP) because it sees real client IPs. A Regional WebACL on the API Gateway stage uses a higher threshold (3000/5min) because CloudFront PoP IPs aggregate multiple real users. They serve different threat surfaces.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript throughout (Lambda, CDK, frontend) |
| **Runtime** | Node.js 24.x on Lambda; bundled by CDK's `NodejsFunction` (esbuild) |
| **Stream ingest** | Amazon Kinesis Data Streams (On-Demand) |
| **AI / ML** | Amazon Bedrock — Claude Haiku 3 (sentiment + misinformation scoring) |
| **Database** | Amazon DynamoDB (On-Demand) — 7 tables, one with a GSI |
| **Compute** | AWS Lambda — Collector, Processor, API, Broadcaster, Misinfo Aggregator |
| **API** | Amazon API Gateway — REST + WebSocket APIs |
| **Push delivery** | API Gateway WebSockets + DynamoDB Streams trigger |
| **CDN / hosting** | Amazon CloudFront + S3 (SPA + API distributions) |
| **Security** | AWS WAFv2 (CloudFront-scoped + Regional), LGPD anonymization |
| **Infrastructure** | AWS CDK (TypeScript) — 3 stacks, cross-region references |
| **Archive pipeline** | Amazon Kinesis Data Firehose → S3 → Glue catalog |
| **Monitoring** | CloudWatch alarms, custom `YouTubeQuotaUsed` metric |
| **Frontend** | React 18 + Vite + Tailwind CSS + Recharts |
| **Data sources** | RSS feeds, X/Twitter via Apify, YouTube Data API v3 |
| **DNS** | Amazon Route 53 + ACM (TLS) |

---

## Architecture

```
 RSS feeds ──┐
 X (Apify) ──┼──► Collector Lambda ──► Kinesis (On-Demand) ──► Processor Lambda
 YouTube ────┘    (dedup via DynamoDB                         (Bedrock Haiku:
                   seen-ids, 10-min TTL)                       language detect +
                                                               sentiment score +
                                                               misinfo scorer)
                                                                      │
                                                               ┌──────┴───────┐
                                                               │   DynamoDB   │
                                                               │ 7 tables     │
                                                               └──────┬───────┘
                                                                      │ Streams
                                                          Broadcaster Lambda
                                                          (2s batch accumulator)
                                                                      │ WebSocket
                                                         ┌────────────┴──────────────┐
                                                         │    API Gateway             │
                                                         │    REST + WebSocket        │
                                                         └────────────┬──────────────┘
                                              WAF (CloudFront-scoped) │
                                                         React Frontend (CloudFront/S3)
```

### DynamoDB tables

| Table | PK | SK | TTL | Purpose |
|---|---|---|---|---|
| `election-sentiment` | `candidate` | `window` (ISO hour) | 30h | Hourly score windows; live score summed from last 12 at query time |
| `comment-samples` | `source` | `timestamp#id` | 15 min | Raw posts for the live sampler panel |
| `misinfo-events` | `candidate` | `timestamp#id` | 30 days | Per-event misinfo log; GSI on `credibility_label` |
| `misinfo-aggregates` | `period` | `computed_at` | 30 days | Hourly pre-aggregated misinfo stats |
| `keyword-counts` | `hashtag` | `hour_window#candidate` | 48h | Trending hashtag counts (atomic `ADD`) |
| `seen-ids` | `id` | — | 10 min | Cross-collector deduplication |
| `ws-connections` | `connectionId` | — | 2h | Active WebSocket registry |

---

## Repository structure

```
eleicoes-2026/
├── infra/                      # AWS CDK (TypeScript)
│   └── lib/
│       ├── streaming-stack.ts  # Kinesis, Lambda, DynamoDB, WAF Regional
│       ├── website-stack.ts    # S3, CloudFront, WAF CloudFront, Route 53
│       └── pipeline-stack.ts   # Firehose → S3 archive → Glue
├── packages/
│   ├── collector/              # Polls RSS/X/YouTube → Kinesis
│   ├── processor/              # Kinesis trigger → Bedrock → DynamoDB
│   ├── api/                    # 5 REST endpoints + LGPD anonymization
│   ├── broadcaster/            # DDB Streams → WebSocket push (SQS DLQ)
│   └── web/                    # React 18 dashboard
└── docs/
    └── wa-review-2026-05-24.md # AWS Well-Architected review
```

---

## API

| Endpoint | Description |
|---|---|
| `GET /v1/scores` | Rolling 1-hour sentiment per candidate (computed at request time) |
| `GET /v1/history?candidate=&hours=` | Hourly sentiment history |
| `GET /v1/samples` | Recent posts — filter by source, candidate, sentiment, credibility |
| `GET /v1/trending?candidate=` | Top hashtags by count window |
| `GET /v1/misinformation?hours=` | Aggregated misinfo stats |
| `WSS /ws` | Live `score_update` and `new_sample_batch` events |

---

## Data sources

| Source | Method | Approx. cost |
|---|---|---|
| News portals | RSS (Carta Capital, Jovem Pan, Agência Brasil, UOL, Folha) | Free |
| X / Twitter | Apify actor `xquik/x-tweet-scraper` | ~$6.50/month |
| YouTube | YouTube Data API v3 (quota alarm at 9k/10k daily units) | Free tier |

---

## Local development

**Prerequisites:** Node 24+, AWS CLI configured, `nvm` recommended.

```bash
npm install

# Collector dry-run — prints collected posts, skips Kinesis write
cd packages/collector
DRY_RUN=true npm run dev

# Synthesize CDK without deploying
cd infra
npx cdk synth StreamingStack
```

Create `.env.local` in the repo root:

```env
APIFY_API_TOKEN=<apify.com token>
YOUTUBE_API_KEY=<google cloud key with YouTube Data API v3>
```

---

## Deployment

```bash
# Deploy backend
cd infra && npx cdk deploy StreamingStack PipelineStack

# Build and push frontend
cd packages/web
VITE_API_BASE=https://api.eleicoes-2026.com/v1 \
VITE_WS_URL=wss://api.eleicoes-2026.com \
npm run build
aws s3 sync dist/ s3://eleicoes-2026-site --delete
aws cloudfront create-invalidation --distribution-id EF046M9V59Q9C --paths "/*"

# Deploy website stack (us-east-1 for ACM + CloudFront)
cd ../../infra && npx cdk deploy WebsiteStack
```

---

## Candidates

```typescript
const CANDIDATES = ['Lula', 'Flávio Bolsonaro', 'Romeu Zema', 'Ronaldo Caiado'];
```

Colors (`#CC0000` · `#003580` · `#F4801A` · `#5B7B9A`) are defined as Tailwind tokens (`lula`, `flavio`, `zema`, `caiado`) and shared across CDK, API, and frontend.
