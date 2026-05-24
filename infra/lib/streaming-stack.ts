import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { KinesisEventSource, SqsDlq, DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export class StreamingStack extends cdk.Stack {
  public readonly stream: kinesis.Stream;
  public readonly alertTopic: sns.Topic;
  public readonly restApi: apigateway.LambdaRestApi;
  public readonly wsApi: apigatewayv2.WebSocketApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Kinesis Data Stream (On-Demand, auto-scales on election day) ──────
    this.stream = new kinesis.Stream(this, 'ElectionStream', {
      streamName: 'election-stream',
      retentionPeriod: cdk.Duration.days(7),
      streamMode: kinesis.StreamMode.ON_DEMAND,
      encryption: kinesis.StreamEncryption.KMS,
    });

    // ── SNS alert topic (alarms added in Phase 10) ────────────────────────
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'eleicoes2026-alerts',
    });

    // ── DynamoDB tables ───────────────────────────────────────────────────

    // Hourly sentiment windows per candidate (30h TTL, rolling 1h live score)
    const sentimentTable = new dynamodb.Table(this, 'ElectionSentiment', {
      tableName: 'election-sentiment',
      partitionKey: { name: 'candidate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'window', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // 15-minute rolling window of raw comments for the live sampler panel
    const commentSamplesTable = new dynamodb.Table(this, 'CommentSamples', {
      tableName: 'comment-samples',
      partitionKey: { name: 'source', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp#id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // Long-lived misinfo event log (30d TTL) — powers 24h/7d aggregation
    const misinfoEventsTable = new dynamodb.Table(this, 'MisinfoEvents', {
      tableName: 'misinfo-events',
      partitionKey: { name: 'candidate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp#id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });
    misinfoEventsTable.addGlobalSecondaryIndex({
      indexName: 'credibility-label-index',
      partitionKey: { name: 'credibility_label', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp#id', type: dynamodb.AttributeType.STRING },
    });

    // Trending hashtag counts per hour per candidate (48h TTL)
    const keywordCountsTable = new dynamodb.Table(this, 'KeywordCounts', {
      tableName: 'keyword-counts',
      partitionKey: { name: 'hashtag', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'hour_window#candidate', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // Deduplication table for all collectors (10min TTL)
    const seenIdsTable = new dynamodb.Table(this, 'SeenIds', {
      tableName: 'seen-ids',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // Persistent collector state (e.g. YouTube quota disable flag)
    const collectorStateTable = new dynamodb.Table(this, 'CollectorState', {
      tableName: 'collector-state',
      partitionKey: { name: 'source', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Hourly misinfo aggregate snapshots for the stats panel (30d TTL)
    const misinfoAggregatesTable = new dynamodb.Table(this, 'MisinfoAggregates', {
      tableName: 'misinfo-aggregates',
      partitionKey: { name: 'period', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'computed_at', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // Active WebSocket connection IDs (2h TTL)
    const wsConnectionsTable = new dynamodb.Table(this, 'WsConnections', {
      tableName: 'ws-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // ── SQS dead-letter queue for processor poison records ────────────────
    const processorDlq = new sqs.Queue(this, 'ProcessorDlq', {
      queueName: 'processor-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // ── Shared collector env (table names + stream name) ──────────────────
    const collectorCommonEnv: Record<string, string> = {
      KINESIS_STREAM_NAME: this.stream.streamName,
      SEEN_IDS_TABLE: seenIdsTable.tableName,
      COLLECTOR_STATE_TABLE: collectorStateTable.tableName,
      KEYWORDS: 'eleições2026,presidente2026,Lula,Flávio,Zema,Caiado,PT,PL,NOVO,PSD',
      REDDIT_USER_AGENT: 'BR-Election-Monitor/1.0',
    };

    const collectorEntry = path.join(__dirname, '../../packages/collector/src/index.ts');

    // ── Collector Lambda — Reddit + NewsAPI (every 60s) ───────────────────
    const collectorLambda = new NodejsFunction(this, 'Collector', {
      functionName: 'eleicoes2026-collector',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: collectorEntry,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ...collectorCommonEnv,
        COLLECTOR_MODE: 'reddit-news',
        SUBREDDITS: 'brasil,brasilivre,PoliticaBR,BrasildoB',
        REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID ?? '',
        REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET ?? '',
        NEWS_API_KEY_SSM: '/eleicoes2026/news-api-key',
      },
    });

    // ── Apify Collector Lambda — Threads + X/Twitter (every 5 min) ────────
    const apifyCollectorLambda = new NodejsFunction(this, 'ApifyCollector', {
      functionName: 'eleicoes2026-apify-collector',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: collectorEntry,
      handler: 'handler',
      timeout: cdk.Duration.seconds(300),
      memorySize: 256,
      environment: {
        ...collectorCommonEnv,
        COLLECTOR_MODE: 'apify',
        APIFY_API_TOKEN_SSM: '/eleicoes2026/apify-api-token',
        THREADS_SEARCH_TERMS: 'Lula 2026,Flávio Bolsonaro,Zema eleições,Caiado presidente,eleições2026',
        THREADS_MAX_RESULTS_PER_TERM: '100',
        THREADS_APIFY_ACTOR: 'futurizerush~threads-keyword-search',
        X_SEARCH_TERMS: 'Lula 2026,Flávio Bolsonaro,eleições2026,Zema presidente,Caiado presidente',
        X_LANG_FILTER: 'pt',
        X_MAX_TWEETS_PER_TERM: '100',
        X_APIFY_ACTOR: 'xquik~x-tweet-scraper',
      },
    });

    // ── YouTube Collector Lambda (every 5 min, 60s timeout for pagination) ─
    const youtubeCollectorLambda = new NodejsFunction(this, 'YouTubeCollector', {
      functionName: 'eleicoes2026-youtube-collector',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: collectorEntry,
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        ...collectorCommonEnv,
        COLLECTOR_MODE: 'youtube',
        YOUTUBE_API_KEY_SSM: '/eleicoes2026/youtube-api-key',
        YOUTUBE_SEARCH_TERMS: 'Lula 2026,Flávio Bolsonaro 2026,eleições presidenciais 2026',
        YOUTUBE_MAX_VIDEOS_PER_RUN: '10',
        YOUTUBE_MAX_COMMENTS_PER_VIDEO: '200',
      },
    });

    // Placeholder code — replaced with real assets in later phases
    const placeholder = lambda.Code.fromInline(
      'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });',
    );

    // ── Processor Lambda — Kinesis → Comprehend → DynamoDB (1024 MB, 120s) ─
    const processorLambda = new NodejsFunction(this, 'Processor', {
      functionName: 'eleicoes2026-processor',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../packages/processor/src/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: {
        DYNAMO_TABLE: sentimentTable.tableName,
        COMMENT_SAMPLES_TABLE: commentSamplesTable.tableName,
        MISINFO_EVENTS_TABLE: misinfoEventsTable.tableName,
        KEYWORD_COUNTS_TABLE: keywordCountsTable.tableName,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        FAKE_INFO_CONFIDENCE_THRESHOLD: '0.6',
        FAKE_INFO_SCORE_HIGH: '70',
        FAKE_INFO_SCORE_MEDIUM: '40',
      },
    });

    // ── Misinfo Aggregator Lambda (every 60 min) ──────────────────────────
    const misinfoAggregatorLambda = new NodejsFunction(this, 'MisinfoAggregator', {
      functionName: 'eleicoes2026-misinfo-aggregator',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../packages/processor/src/aggregator.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        MISINFO_EVENTS_TABLE: misinfoEventsTable.tableName,
        MISINFO_AGGREGATES_TABLE: misinfoAggregatesTable.tableName,
      },
    });

    // ── WebSocket API Gateway (Phase 7) ──────────────────────────────────
    const wsConnectLambda = new NodejsFunction(this, 'WsConnect', {
      functionName: 'eleicoes2026-ws-connect',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../packages/broadcaster/src/connect.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: { WS_CONNECTIONS_TABLE: wsConnectionsTable.tableName },
    });

    wsConnectionsTable.grantReadWriteData(wsConnectLambda);

    // Placeholder WS API needed before broadcaster Lambda is defined so we can inject the endpoint URL
    this.wsApi = new apigatewayv2.WebSocketApi(this, 'WsApi', {
      apiName: 'eleicoes2026-ws',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', wsConnectLambda),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', wsConnectLambda),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', wsConnectLambda),
      },
    });

    const wsStage = new apigatewayv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: this.wsApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // ── WebSocket Broadcaster Lambda (DynamoDB Streams trigger, Phase 7) ──
    const broadcasterLambda = new NodejsFunction(this, 'WebSocketBroadcaster', {
      functionName: 'eleicoes2026-ws-broadcaster',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../packages/broadcaster/src/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        WS_CONNECTIONS_TABLE: wsConnectionsTable.tableName,
        WS_ENDPOINT: `https://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/prod`,
      },
    });

    // ── Kinesis → Processor event source (bisect + SQS DLQ) ──────────────
    processorLambda.addEventSource(new KinesisEventSource(this.stream, {
      batchSize: 100,
      startingPosition: lambda.StartingPosition.LATEST,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(processorDlq),
      retryAttempts: 3,
    }));

    // ── DynamoDB grants ───────────────────────────────────────────────────
    this.stream.grantWrite(collectorLambda);
    this.stream.grantWrite(apifyCollectorLambda);
    this.stream.grantWrite(youtubeCollectorLambda);

    seenIdsTable.grantReadWriteData(collectorLambda);
    seenIdsTable.grantReadWriteData(apifyCollectorLambda);
    seenIdsTable.grantReadWriteData(youtubeCollectorLambda);

    collectorStateTable.grantReadWriteData(collectorLambda);
    collectorStateTable.grantReadWriteData(youtubeCollectorLambda);

    sentimentTable.grantReadWriteData(processorLambda);
    commentSamplesTable.grantReadWriteData(processorLambda);
    misinfoEventsTable.grantReadWriteData(processorLambda);
    keywordCountsTable.grantReadWriteData(processorLambda);

    misinfoEventsTable.grantReadData(misinfoAggregatorLambda);
    misinfoAggregatesTable.grantReadWriteData(misinfoAggregatorLambda);

    wsConnectionsTable.grantReadWriteData(broadcasterLambda);
    this.wsApi.grantManageConnections(broadcasterLambda);

    // ── DynamoDB Streams → Broadcaster ────────────────────────────────────
    broadcasterLambda.addEventSource(new DynamoEventSource(sentimentTable, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 100,
      bisectBatchOnError: true,
    }));
    broadcasterLambda.addEventSource(new DynamoEventSource(commentSamplesTable, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 100,
      bisectBatchOnError: true,
    }));

    // ── Comprehend IAM for Processor ──────────────────────────────────────
    processorLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'comprehend:DetectDominantLanguage',
        'comprehend:BatchDetectDominantLanguage',
        'comprehend:DetectSentiment',
        'comprehend:BatchDetectSentiment',
      ],
      resources: ['*'],
    }));

    // ── Bedrock IAM for Processor ─────────────────────────────────────────
    // Inference profiles require both the profile ARN and the underlying foundation model ARN
    processorLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    // ── CloudWatch PutMetricData for collectors + processor ───────────────
    const cwMetricPolicy = new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    });
    processorLambda.addToRolePolicy(cwMetricPolicy);
    collectorLambda.addToRolePolicy(cwMetricPolicy);
    apifyCollectorLambda.addToRolePolicy(cwMetricPolicy);
    youtubeCollectorLambda.addToRolePolicy(cwMetricPolicy);

    // ── SSM Parameter Store for API keys ─────────────────────────────────
    const ssmPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/eleicoes2026/*`,
      ],
    });
    collectorLambda.addToRolePolicy(ssmPolicy);
    apifyCollectorLambda.addToRolePolicy(ssmPolicy);
    youtubeCollectorLambda.addToRolePolicy(ssmPolicy);

    // ── EventBridge schedules ─────────────────────────────────────────────
    new events.Rule(this, 'CollectorSchedule', {
      ruleName: 'eleicoes2026-collector-60s',
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(collectorLambda)],
    });

    new events.Rule(this, 'ApifyCollectorSchedule', {
      ruleName: 'eleicoes2026-apify-5min',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(apifyCollectorLambda)],
    });

    new events.Rule(this, 'YouTubeCollectorSchedule', {
      ruleName: 'eleicoes2026-youtube-5min',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(youtubeCollectorLambda)],
    });

    new events.Rule(this, 'MisinfoAggregatorSchedule', {
      ruleName: 'eleicoes2026-misinfo-60min',
      schedule: events.Schedule.rate(cdk.Duration.minutes(60)),
      targets: [new targets.LambdaFunction(misinfoAggregatorLambda)],
    });

    // ── API Lambda + REST API Gateway (Phase 6) ───────────────────────────
    const apiLambda = new NodejsFunction(this, 'Api', {
      functionName: 'eleicoes2026-api',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../packages/api/src/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        ELECTION_SENTIMENT_TABLE: sentimentTable.tableName,
        COMMENT_SAMPLES_TABLE: commentSamplesTable.tableName,
        MISINFO_AGGREGATES_TABLE: misinfoAggregatesTable.tableName,
        KEYWORD_COUNTS_TABLE: keywordCountsTable.tableName,
        CORS_ORIGIN: 'https://eleicoes-2026.com,https://www.eleicoes-2026.com',
      },
    });

    sentimentTable.grantReadData(apiLambda);
    commentSamplesTable.grantReadData(apiLambda);
    misinfoAggregatesTable.grantReadData(apiLambda);
    keywordCountsTable.grantReadData(apiLambda);

    this.restApi = new apigateway.LambdaRestApi(this, 'RestApi', {
      handler: apiLambda,
      proxy: true,
      restApiName: 'eleicoes2026-api',
      deployOptions: { stageName: 'prod' },
    });

    // ── CloudWatch Alarms ─────────────────────────────────────────────────
    const alarmAction = new cloudwatch_actions.SnsAction(this.alertTopic);

    // Optional: subscribe an email address to the alert topic at deploy time
    const alertEmail = process.env.ALERT_EMAIL;
    if (alertEmail) {
      new sns.Subscription(this, 'AlertEmailSubscription', {
        topic: this.alertTopic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: alertEmail,
      });
    }

    // 1. YouTube quota approaching daily cap (9,000 units/day)
    const youtubeQuotaAlarm = new cloudwatch.Alarm(this, 'YouTubeQuotaAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Eleicoes2026',
        metricName: 'YouTubeQuotaUsed',
        statistic: 'Sum',
        period: cdk.Duration.hours(24),
      }),
      threshold: 9000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'YouTube API quota >= 9000 units/day',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    youtubeQuotaAlarm.addAlarmAction(alarmAction);

    // 2. Collector zero-post: 3 consecutive 1-min windows with 0 posts collected
    const collectorZeroPostAlarm = new cloudwatch.Alarm(this, 'CollectorZeroPostAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Eleicoes2026',
        metricName: 'CollectorPostCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Collector emitted 0 posts for 3 consecutive runs',
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    collectorZeroPostAlarm.addAlarmAction(alarmAction);

    // 3. Processor Lambda error rate > 5% over a 5-minute window
    const processorErrorAlarm = new cloudwatch.Alarm(this, 'ProcessorErrorAlarm', {
      metric: new cloudwatch.MathExpression({
        expression: 'errors / invocations',
        usingMetrics: {
          errors: processorLambda.metricErrors({ period: cdk.Duration.minutes(5) }),
          invocations: processorLambda.metricInvocations({ period: cdk.Duration.minutes(5) }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0.05,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Processor Lambda error rate > 5%',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    processorErrorAlarm.addAlarmAction(alarmAction);

    // 4. Fake info spike: FakeInfoDetected / TotalScored > 15% in a 1-hour window
    const fakeInfoSpikeAlarm = new cloudwatch.Alarm(this, 'FakeInfoSpikeAlarm', {
      metric: new cloudwatch.MathExpression({
        expression: 'fakeInfo / totalScored',
        usingMetrics: {
          fakeInfo: new cloudwatch.Metric({
            namespace: 'Eleicoes2026',
            metricName: 'FakeInfoDetected',
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
          }),
          totalScored: new cloudwatch.Metric({
            namespace: 'Eleicoes2026',
            metricName: 'TotalScored',
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
          }),
        },
        period: cdk.Duration.hours(1),
      }),
      threshold: 0.15,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'FakeInfoDetected / TotalScored > 15% in 1 hour',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    fakeInfoSpikeAlarm.addAlarmAction(alarmAction);

    // 5. Score staleness: ScoreAge > 600s (emitted externally during 7am–11pm BRT)
    const scoreStalenessAlarm = new cloudwatch.Alarm(this, 'ScoreStalenessAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Eleicoes2026',
        metricName: 'ScoreAge',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 600,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Score data is stale (age > 600s) during active hours',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    scoreStalenessAlarm.addAlarmAction(alarmAction);

    // 6. DLQ depth: any unprocessed messages in processor-dlq
    const processorDlqDepthAlarm = new cloudwatch.Alarm(this, 'ProcessorDlqDepthAlarm', {
      metric: processorDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Processor DLQ has unprocessed messages',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    processorDlqDepthAlarm.addAlarmAction(alarmAction);

    // ── CloudWatch Dashboard ──────────────────────────────────────────────
    const sources = ['reddit', 'news', 'threads', 'twitter', 'youtube'];

    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: 'eleicoes2026-operations',
    });

    // Row 1: title
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# Eleições 2026 — Operations Dashboard\nPipeline health · Data quality · Infrastructure',
        width: 24,
        height: 2,
      }),
    );

    // Row 2: alarm roll-up
    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarms',
        alarms: [
          youtubeQuotaAlarm,
          collectorZeroPostAlarm,
          processorErrorAlarm,
          fakeInfoSpikeAlarm,
          scoreStalenessAlarm,
          processorDlqDepthAlarm,
        ],
        width: 24,
        height: 3,
      }),
    );

    // Row 3: posts collected vs processed, per source (stacked area)
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Posts Collected — by Source',
        left: sources.map(source => new cloudwatch.Metric({
          namespace: 'Eleicoes2026',
          metricName: 'CollectorPostCount',
          dimensionsMap: { Source: source },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: source,
        })),
        view: cloudwatch.GraphWidgetView.TIME_SERIES,
        stacked: true,
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Posts Processed (PT filter) — by Source',
        left: sources.map(source => new cloudwatch.Metric({
          namespace: 'Eleicoes2026',
          metricName: 'ProcessorPostCount',
          dimensionsMap: { Source: source },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: source,
        })),
        view: cloudwatch.GraphWidgetView.TIME_SERIES,
        stacked: true,
        width: 12,
        height: 6,
      }),
    );

    // Row 4: collector errors | fake-info | YouTube quota
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Collector Lambda Errors',
        left: [
          collectorLambda.metricErrors({ period: cdk.Duration.minutes(5), label: 'reddit-news' }),
          apifyCollectorLambda.metricErrors({ period: cdk.Duration.minutes(5), label: 'apify' }),
          youtubeCollectorLambda.metricErrors({ period: cdk.Duration.minutes(5), label: 'youtube' }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'FakeInfo Detected vs Total Scored',
        left: [
          new cloudwatch.Metric({
            namespace: 'Eleicoes2026',
            metricName: 'TotalScored',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Total Scored',
          }),
          new cloudwatch.Metric({
            namespace: 'Eleicoes2026',
            metricName: 'FakeInfoDetected',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Fake Info Detected',
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'YouTube Quota Used (daily)',
        left: [
          new cloudwatch.Metric({
            namespace: 'Eleicoes2026',
            metricName: 'YouTubeQuotaUsed',
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
            label: 'Units Used',
          }),
        ],
        leftAnnotations: [{ value: 9000, label: 'Alert threshold', color: '#ff6961' }],
        width: 8,
        height: 6,
      }),
    );

    // Row 5: Kinesis | processor duration | DLQ
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Kinesis Incoming Records',
        left: [
          this.stream.metricIncomingRecords({ statistic: 'Sum', period: cdk.Duration.minutes(5), label: 'Records' }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Processor Duration',
        left: [
          processorLambda.metricDuration({ statistic: 'p99', period: cdk.Duration.minutes(5), label: 'p99' }),
          processorLambda.metricDuration({ statistic: 'Average', period: cdk.Duration.minutes(5), label: 'avg' }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Processor DLQ Depth',
        left: [
          processorDlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1), label: 'Queued' }),
        ],
        width: 8,
        height: 6,
      }),
    );

    // Row 6: API Lambda | WebSocket
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Lambda — Invocations & Errors',
        left: [
          apiLambda.metricInvocations({ period: cdk.Duration.minutes(5), label: 'Invocations' }),
          apiLambda.metricErrors({ period: cdk.Duration.minutes(5), label: 'Errors' }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'WebSocket — Connects & Broadcasts',
        left: [
          wsConnectLambda.metricInvocations({ period: cdk.Duration.minutes(5), label: 'Connects' }),
          broadcasterLambda.metricInvocations({ period: cdk.Duration.minutes(5), label: 'Broadcasts' }),
          broadcasterLambda.metricErrors({ period: cdk.Duration.minutes(5), label: 'Broadcaster Errors' }),
        ],
        width: 12,
        height: 6,
      }),
    );

    // ── Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.restApi.url,
      exportName: 'ApiUrl',
    });
    new cdk.CfnOutput(this, 'StreamName', {
      value: this.stream.streamName,
      exportName: 'ElectionStreamName',
    });
    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      exportName: 'AlertTopicArn',
    });
    new cdk.CfnOutput(this, 'ProcessorDlqUrl', {
      value: processorDlq.queueUrl,
      exportName: 'ProcessorDlqUrl',
    });

    new cdk.CfnOutput(this, 'WsApiUrl', {
      value: wsStage.url,
      exportName: 'WsApiUrl',
    });
  }
}
