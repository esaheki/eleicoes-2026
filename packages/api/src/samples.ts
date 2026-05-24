import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { anonymizeAuthor } from './anonymize';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ALL_SOURCES = ['twitter', 'news', 'youtube'] as const;

interface SampleParams {
  source?: string;
  candidate?: string;
  sentiment?: string;
  credibility?: string;
  limit?: number;
}

export async function getSamples(params: SampleParams) {
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const sources = params.source ? [params.source] : [...ALL_SOURCES];

  // Build optional FilterExpression for non-key attributes
  const filterParts: string[] = [];
  const exprValues: Record<string, unknown> = {};

  if (params.candidate) {
    filterParts.push('candidate = :candidate');
    exprValues[':candidate'] = params.candidate;
  }
  if (params.sentiment) {
    filterParts.push('sentiment = :sentiment');
    exprValues[':sentiment'] = params.sentiment.toUpperCase();
  }
  if (params.credibility) {
    filterParts.push('credibility_label = :credibility');
    exprValues[':credibility'] = params.credibility.toUpperCase();
  }

  const filterExpression = filterParts.length ? filterParts.join(' AND ') : undefined;

  // Query each source in parallel (newest first via ScanIndexForward: false)
  const perSource = await Promise.all(
    sources.map(async source => {
      const res = await dynamo.send(new QueryCommand({
        TableName: process.env.COMMENT_SAMPLES_TABLE!,
        KeyConditionExpression: '#src = :src',
        ExpressionAttributeNames: { '#src': 'source' },
        ExpressionAttributeValues: { ':src': source, ...exprValues },
        FilterExpression: filterExpression,
        ScanIndexForward: false,
        Limit: limit * 3, // over-fetch to compensate for filter rejection
      }));
      return res.Items ?? [];
    }),
  );

  const merged = perSource
    .flat()
    .sort((a, b) => String(b['timestamp#id']).localeCompare(String(a['timestamp#id'])))
    .slice(0, limit);

  const samples = merged.map(i => ({
    source: i.source,
    candidate: i.candidate,
    sentiment: i.sentiment,
    score: i.score ?? null,
    text: i.text,
    author: anonymizeAuthor(String(i.author ?? '')),
    url: i.url || undefined,
    video_title: i.video_title || undefined,
    timestamp: String(i['timestamp#id'] ?? '').split('#')[0],
    credibility_score: i.credibility_score ?? null,
    credibility_label: i.credibility_label,
    flags: i.flags ?? [],
    flag_reasoning: i.flag_reasoning || undefined,
  }));

  return { samples, updatedAt: new Date().toISOString() };
}
