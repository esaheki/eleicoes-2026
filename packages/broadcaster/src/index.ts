import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const WS_CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE!;
const WS_ENDPOINT = process.env.WS_ENDPOINT!;

function anonymizeAuthor(raw: string): string {
  return `usuário_${createHash('sha256').update(raw).digest('hex').slice(0, 4)}`;
}

function unmarshallValue(v: Record<string, unknown>): unknown {
  if ('S' in v) return v.S;
  if ('N' in v) return parseFloat(v.N as string);
  if ('BOOL' in v) return v.BOOL;
  if ('NULL' in v) return null;
  if ('L' in v) return (v.L as Array<Record<string, unknown>>).map(unmarshallValue);
  if ('M' in v) {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.M as Record<string, Record<string, unknown>>)) {
      obj[k] = unmarshallValue(val);
    }
    return obj;
  }
  if ('SS' in v) return v.SS;
  if ('NS' in v) return (v.NS as string[]).map(parseFloat);
  return undefined;
}

function unmarshallItem(item: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    result[k] = unmarshallValue(v);
  }
  return result;
}

async function getConnections(): Promise<string[]> {
  const ids: string[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await dynamo.send(new ScanCommand({
      TableName: WS_CONNECTIONS_TABLE,
      ProjectionExpression: 'connectionId',
      ExclusiveStartKey: lastKey as Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined,
    }));
    for (const item of res.Items ?? []) {
      if (item.connectionId) ids.push(item.connectionId as string);
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return ids;
}

async function broadcast(client: ApiGatewayManagementApiClient, payload: unknown): Promise<void> {
  const connections = await getConnections();
  if (!connections.length) return;

  const data = Buffer.from(JSON.stringify(payload));

  await Promise.allSettled(
    connections.map(async (connectionId) => {
      try {
        await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (e) {
        if (e instanceof GoneException) {
          await dynamo.send(new DeleteCommand({ TableName: WS_CONNECTIONS_TABLE, Key: { connectionId } }));
        } else {
          console.warn(`PostToConnection failed for ${connectionId}:`, (e as Error).message);
        }
      }
    }),
  );
}

function computeScore(positive: number, total: number): number {
  if (!total) return 0;
  return Math.round((positive / total) * 100);
}

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const client = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });

  const newSamples: Record<string, unknown>[] = [];
  const scoreUpdates: Record<string, unknown>[] = [];

  for (const record of event.Records) {
    if (!record.dynamodb?.NewImage) continue;
    const newImage = unmarshallItem(
      record.dynamodb.NewImage as Record<string, Record<string, unknown>>,
    );

    if (isCommentSample(record)) {
      // Collect new comment samples for batched push
      newSamples.push(buildSamplePayload(newImage));
    } else if (isSentimentWindow(record)) {
      // Check if score changed by ≥1 point vs old image
      const oldImage = record.dynamodb.OldImage
        ? unmarshallItem(record.dynamodb.OldImage as Record<string, Record<string, unknown>>)
        : undefined;

      const newPositive = (newImage.positive_count as number) ?? 0;
      const newTotal = (newImage.total as number) ?? 0;
      const newScore = computeScore(newPositive, newTotal);

      let oldScore = 0;
      if (oldImage) {
        const oldPositive = (oldImage.positive_count as number) ?? 0;
        const oldTotal = (oldImage.total as number) ?? 0;
        oldScore = computeScore(oldPositive, oldTotal);
      }

      if (Math.abs(newScore - oldScore) >= 1) {
        scoreUpdates.push({
          type: 'score_update',
          candidate: newImage.candidate,
          score: newScore,
          delta: newScore - oldScore,
          positive: newPositive,
          negative: (newImage.negative_count as number) ?? 0,
          neutral: (newImage.neutral_count as number) ?? 0,
          total: newTotal,
          window: '1h',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  const broadcasts: Promise<void>[] = [];

  if (newSamples.length) {
    broadcasts.push(broadcast(client, { type: 'new_sample_batch', samples: newSamples }));
  }

  for (const update of scoreUpdates) {
    broadcasts.push(broadcast(client, update));
  }

  await Promise.allSettled(broadcasts);
};

function isCommentSample(record: DynamoDBRecord): boolean {
  // comment-samples has PK=source, SK=timestamp#id
  const keys = record.dynamodb?.Keys;
  if (!keys) return false;
  const skVal = keys['timestamp#id'];
  return skVal !== undefined;
}

function isSentimentWindow(record: DynamoDBRecord): boolean {
  const keys = record.dynamodb?.Keys;
  if (!keys) return false;
  return keys['window'] !== undefined && keys['candidate'] !== undefined;
}

function buildSamplePayload(item: Record<string, unknown>): Record<string, unknown> {
  return {
    source: item.source,
    candidate: item.candidate,
    sentiment: item.sentiment,
    score: item.score ?? null,
    text: item.text,
    author: item.author ? anonymizeAuthor(item.author as string) : undefined,
    url: item.url,
    video_title: item.video_title ?? undefined,
    timestamp: String(item['timestamp#id'] ?? '').split('#')[0],
    credibility_score: item.credibility_score ?? null,
    credibility_label: item.credibility_label ?? 'UNSCORED',
    flags: item.flags ?? [],
    flag_reasoning: item.flag_reasoning ?? '',
  };
}
