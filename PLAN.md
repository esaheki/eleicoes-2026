# Eleições 2026 — Build Plan

## Legend
- `[ ]` not started
- `[~]` in progress
- `[x]` done

---

## Phase 1 — Workspace & Shared Types ✅
`[x]` `package.json` — workspace root (`workspaces: ["packages/*", "infra"]`)  
`[x]` `tsconfig.base.json` — shared TS config (ES2022, commonjs, strict)  
`[x]` `packages/collector/package.json` + `tsconfig.json`  
`[x]` `packages/processor/package.json` + `tsconfig.json`  
`[x]` `packages/api/package.json` + `tsconfig.json`  
`[x]` `packages/collector/src/types.ts` — `SocialPost` interface, `CANDIDATES` constant, `CANDIDATE_COLORS` + `CANDIDATE_PARTIES` maps  
`[x]` `.nvmrc` + `.node-version` — pins to Node 20 for when nvm/fnm is set up  

**Verify:** `npx tsc --noEmit` ✅ zero errors (using Node 16.18.0 locally; Lambda targets Node 20 in AWS)

> **Note:** System Node is 12, but Node 16.18.0 is already installed via Homebrew
> (`/usr/local/Cellar/node@16/16.18.0/bin`). Run commands with
> `PATH="/usr/local/Cellar/node@16/16.18.0/bin:$PATH" <command>` until Node 20 is set up.
> Recommended: `brew install fnm && fnm install 20 && fnm use 20`

---

## Phase 2 — CDK Infrastructure (Core Backend) ✅
`[x]` `infra/package.json` + `tsconfig.json`  
`[x]` `infra/cdk.json` — uses `ts-node` to run the CDK app  
`[x]` `infra/bin/app.ts` — CDK app entry, instantiates all 3 stacks  
`[x]` `infra/lib/streaming-stack.ts` — all DynamoDB tables, Kinesis On-Demand, SQS DLQ, Lambda placeholders, EventBridge rules, Kinesis event source mapping, IAM grants  
`[x]` `infra/lib/pipeline-stack.ts` — skeleton only  
`[x]` `infra/lib/website-stack.ts` — skeleton only  
`[x]` `.gitignore` added  

**DynamoDB tables:** `election-sentiment`, `comment-samples`, `misinfo-events` (+GSI), `keyword-counts`, `seen-ids`, `collector-state`, `misinfo-aggregates`, `ws-connections`  

**Verify:** `npx cdk synth StreamingStack` ✅  
Resources confirmed: 8× DynamoDB, 1× Kinesis, 1× SNS, 1× SQS, 6× Lambda, 4× EventBridge rules

> **Node:** Now using Node 24.16.0 via nvm. `.nvmrc` + `.node-version` updated to 24.

---

## Phase 3 — Collector Lambda ✅
`[x]` `packages/collector/src/index.ts` — handler, `Promise.allSettled` fan-out  
`[x]` `packages/collector/src/dedup.ts` — atomic `checkAndMarkSeen()` (seen-ids table, 10min TTL)  
`[x]` `packages/collector/src/sources/reddit.ts`  
`[x]` `packages/collector/src/sources/newsapi.ts`  
`[x]` `packages/collector/src/sources/apify.ts` — shared `runApifyActor<T>()` client  
`[x]` `packages/collector/src/sources/xtwitter.ts`  
`[x]` `packages/collector/src/sources/threads.ts`  
`[x]` `packages/collector/src/sources/youtube.ts` — search → enrich → comments → map (4-phase per SPEC)  
`[x]` Updated `streaming-stack.ts`: `NodejsFunction` with esbuild bundling, `COLLECTOR_MODE` routing  

**Verify:** `DRY_RUN=true npm run dev` ✅ — 130 Reddit posts collected + printed (NewsAPI 401 expected without key)  

**Verify:**
1. `DRY_RUN=true npm run dev` locally → ≥1 post per source printed  
2. `cdk deploy StreamingStack` → CloudWatch logs show posts after first EventBridge trigger  
3. Kinesis Data Viewer in AWS console confirms records  

---

## Phase 4 — Processor Lambda (no Bedrock) ✅
`[x]` `packages/processor/src/index.ts` — Kinesis batch handler, language filter, parallel post processing  
`[x]` `packages/processor/src/sentiment.ts` — `BatchDetectDominantLanguage` + `BatchDetectSentiment` (25/call)  
`[x]` `packages/processor/src/dynamo.ts` — `writeHourlyWindow()`, `writeCommentSample()`, `writeMisinfoEvent()`, `writeHashtags()`  
`[x]` `packages/processor/src/fakechecker.ts` — stub returning `UNSCORED`  
`[x]` Updated `streaming-stack.ts`: `NodejsFunction` with esbuild bundling, added `BatchDetectDominantLanguage` IAM  

**Verify:** `npx cdk synth StreamingStack` ✅ — Processor asset bundled, Kinesis event source with bisect+DLQ confirmed  

**Verify:**
1. Manually PutRecord a test SocialPost JSON to Kinesis in AWS console  
2. `election-sentiment` table → new hourly window item with counts  
3. `comment-samples` table → sample row with TTL ~15min from now  
4. `keyword-counts` table → increment if test post had a hashtag  

---

## Phase 5 — Fake Info Scorer (Bedrock) ✅
`[x]` `packages/processor/src/fakechecker.ts` — real Bedrock Claude Haiku implementation: skip `news`, skip below confidence threshold, concurrency-5 p-limit, UNSCORED on any error, `FakeInfoDetected` CloudWatch metric  
`[x]` `packages/processor/src/metrics.ts` — `emitMetric()` helper (CloudWatch PutMetricData)  
`[x]` `writeMisinfoEvent()` was already fully implemented in Phase 4  

**Verify:** `npx cdk synth StreamingStack` ✅ — Processor bundle includes Bedrock runtime + p-limit  

**Verify:**
1. Send known-bad test post (Brazilian election misinformation text) to Kinesis  
2. `misinfo-events` table → row with non-zero `credibility_score` and flags  
3. `comment-samples` → `credibility_label` populated  
4. CloudWatch → `FakeInfoDetected` metric emitted for LIKELY_FALSE items  

---

## Phase 6 — API Lambda (5 Endpoints) ✅
`[x]` `packages/api/src/anonymize.ts` — SHA-256 → `usuário_<first-4-hex>`  
`[x]` `packages/api/src/scores.ts` — rolling 1h score via last 12 hourly windows, `Cache-Control: max-age=30`  
`[x]` `packages/api/src/history.ts` — hourly snapshots, up to 30h, candidate validation  
`[x]` `packages/api/src/samples.ts` — per-source queries with filter + author anonymization  
`[x]` `packages/api/src/trending.ts` — scan keyword-counts for current+prev hour, top 10  
`[x]` `packages/api/src/misinfo.ts` — reads latest aggregate from misinfo-aggregates by period  
`[x]` `packages/api/src/index.ts` — CORS-aware router, OPTIONS preflight, structured errors  
`[x]` Updated `streaming-stack.ts`: `NodejsFunction` API Lambda (128MB/10s) + `LambdaRestApi` (proxy mode, stage=prod)  

**Verify:** `npx cdk synth StreamingStack` ✅ — Api Lambda + RestApi + ApiUrl output confirmed  

**Verify:** `curl` each endpoint — all return valid JSON with expected shape.

---

## Phase 7 — WebSocket Broadcaster ✅
`[x]` `packages/broadcaster/package.json` + `tsconfig.json`  
`[x]` `packages/broadcaster/src/connect.ts` — $connect/$disconnect/$default handler, writes/deletes `ws-connections` row with 2h TTL  
`[x]` `packages/broadcaster/src/index.ts` — DynamoDB Streams trigger, batched `new_sample_batch` push, `score_update` on score change ≥1, `anonymizeAuthor()` before send, `GoneException` cleanup  
`[x]` Updated `streaming-stack.ts`: DynamoDB Streams on `election-sentiment` (NEW_AND_OLD_IMAGES) + `comment-samples` (NEW_IMAGE), API Gateway WebSocket ($connect, $disconnect, $default), broadcaster NodejsFunction, `ws-connections` grants, WsApiUrl output  

**Verify:** `npx cdk synth StreamingStack` ✅ — WebSocket API + Stage, 3 routes, 3 event sources (Kinesis + 2 DDB streams)

**Verify (post-deploy):** `npx wscat -c wss://<ws-api-id>.execute-api.us-east-1.amazonaws.com/prod`  
→ Receive `score_update` and `new_sample_batch` events within ~2s of a Kinesis record.

---

## Phase 8 — React Frontend ✅

### 8a — Scaffold ✅
`[x]` `packages/web/` — Vite + React + TypeScript (manual scaffold, no interactive CLI)  
`[x]` Tailwind CSS v3, Recharts, React Router v6 installed  
`[x]` Tailwind config with candidate color tokens (lula, flavio, zema, caiado)  
`[x]` `packages/web/src/api/client.ts` — typed fetch wrappers for all 5 endpoints + WS_URL export  

### 8b — App Layout + CandidateCards ✅
`[x]` `App.tsx` — dark sidebar (md:w-60 bg-gray-900) + white main area, mobile header, single `useScores` call  
`[x]` `CandidateCard.tsx` — name, party badge (party color), 3-segment bar, score color coding, `ⓘ` tooltip  

### 8c — Live Scores + Chart ✅
`[x]` `hooks/useWebSocket.ts` — module-level singleton WS, exponential backoff reconnect, subscription fan-out  
`[x]` `hooks/useScores.ts` — WS-primary (`score_update` handler), 30s poll fallback only when disconnected  
`[x]` `SentimentChart.tsx` — Recharts `LineChart`, 24h history, all candidates, `Promise.allSettled`  

### 8d — CommentSampler ✅
`[x]` `hooks/useCommentSampler.ts` — fetch on mount/filter change, WS `new_sample_batch` subscription, pause buffer (cap 100), 50-item live list  
`[x]` `CommentSampler.tsx` — source/candidate/sentiment/credibility pills, slide-in animation, pause/resume with buffered count, max-h scroll  
`[x]` `FakeInfoBadge.tsx` — CREDIBLE=hidden, SUSPICIOUS=amber, LIKELY_FALSE=red, UNSCORED=gray, 8 flag PT labels  

### 8e — TrendingPanel + MisinfoStats ✅
`[x]` `TrendingPanel.tsx` — top hashtags, 60s refresh, clickable pills filter CommentSampler  
`[x]` `MisinfoStats.tsx` — collapsed by default, `likely_false_pct` badge, metric grid, Recharts `BarChart` (top 5 flags), per-candidate table  

### 8f — /metodologia Page ✅
`[x]` `pages/Metodologia.tsx` — 6 sections: Sobre, Fontes, Cálculo, Desinformação, Limitações, Privacidade  
`[x]` React Router `<Routes>` in `App.tsx`, mobile + desktop nav links  

### 8g — Mobile + Accessibility ✅
`[x]` Single-column stacked layout on mobile (sidebar hidden, stacked header shown)  
`[x]` `prefers-reduced-motion` disables `.animate-slide-in` and `.animate-pulse` in `index.css`  
`[x]` FakeInfoBadge tooltips: `role="tooltip"`, `aria-describedby`, keyboard focus handlers  

**Verify:** `npx tsc --noEmit` ✅ — zero TypeScript errors

---

## Phase 9 — Website Infrastructure + Full Deployment ✅
`[x]` Complete `infra/lib/website-stack.ts`:  
  - `HostedZone.fromLookup()` — existing hosted zone, not re-created  
  - `Certificate` (`acm`) covering `eleicoes-2026.com` + `*.eleicoes-2026.com`, DNS validated, us-east-1  
  - S3 bucket `eleicoes-2026-site` (block all public access, RETAIN)  
  - **Distribution 1** (SPA) — aliases `eleicoes-2026.com` + `www`, default → S3 + OAI, 404/403 → `/index.html`  
  - **Distribution 2** (API) — alias `api.eleicoes-2026.com`, default → REST API origin (`originPath:/prod`, CACHING_DISABLED), `/v1/scores` → 30s cache, `/ws` → WebSocket API origin + CloudFront Function strips `/ws` prefix  
  - Route 53 A + AAAA alias records: apex + www → Distribution 1, api → Distribution 2  
  - `crossRegionReferences: true` in CDK app for cross-region stack refs  
`[x]` Updated `streaming-stack.ts`: exposed `restApi` and `wsApi` as public readonly properties  
`[x]` Updated `pipeline-stack.ts`: accepts `stream` prop (ready for Phase 10)  
`[x]` Updated `bin/app.ts`: passes `restApi`, `wsApi` to WebsiteStack; enforces `us-east-1` for WebsiteStack  

**Verify:** `npx cdk synth WebsiteStack` ✅ — 2× CloudFront, 1× S3, 1× ACM cert, 1× CF Function, 5× Route53, cache policy confirmed

**Verify (post-deploy):**
```bash
curl https://eleicoes-2026.com                   # → HTML
curl https://api.eleicoes-2026.com/v1/scores     # → JSON
npx wscat -c wss://api.eleicoes-2026.com/ws      # → connects
# Second curl on /v1/scores → X-Cache: Hit from cloudfront
```

**Deploy sequence:**
```bash
npx cdk deploy StreamingStack
cd packages/web && VITE_API_BASE=https://api.eleicoes-2026.com/v1 VITE_WS_URL=wss://api.eleicoes-2026.com/ws npm run build
aws s3 sync dist/ s3://eleicoes-2026-site --delete
aws cloudfront create-invalidation --distribution-id $SPA_CF_ID --paths "/*"
npx cdk deploy WebsiteStack
```

---

## Phase 10 — Pipeline Stack + Monitoring ✅
`[x]` Complete `infra/lib/pipeline-stack.ts`:  
  - Kinesis Firehose (`election-stream` → S3 `eleicoes2026-raw`, Parquet, 60s buffer)  
  - S3 lifecycle → Glacier after 90 days  
  - Glue crawler (daily)  
`[x]` CloudWatch alarms in `streaming-stack.ts`:  
  - YouTube quota: 9,000 units/day  
  - Collector zero-post: `CollectorPostCount` = 0 for 3 runs  
  - Processor error rate: Lambda errors > 5% over 5min  
  - Fake info spike: `FakeInfoDetected / TotalScored` > 15% in 1h  
  - Score staleness: `ScoreAge` > 600s during 7am–11pm BRT  
  - DLQ depth: `processor-dlq` visible messages > 0  
`[x]` `packages/processor/src/fakechecker.ts` — added `emitMetric('TotalScored', 1)` so the fake-info spike alarm has a denominator

**Verify:** `npx cdk synth StreamingStack` ✅ — 6× CloudWatch alarms confirmed  
**Verify:** `npx cdk synth PipelineStack` ✅ — S3 bucket, Glue DB+table, CfnDeliveryStream (Parquet), Glue crawler confirmed  

**Verify:**
- S3 `eleicoes2026-raw/` has Parquet files after 60s  
- Manually emit zero-post metric → SNS email arrives  
