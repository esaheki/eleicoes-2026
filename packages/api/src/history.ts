import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CANDIDATES, type Candidate } from '../../collector/src/types';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function isoHour(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13) + ':00';
}

export async function getHistory(candidate: string, hours: number) {
  if (!CANDIDATES.includes(candidate as Candidate)) {
    throw Object.assign(new Error(`Invalid candidate: ${candidate}`), { statusCode: 400 });
  }
  const clampedHours = Math.min(30, Math.max(1, Math.round(hours)));

  const now = new Date();
  const low = isoHour(new Date(now.getTime() - (clampedHours - 1) * 3600 * 1000));
  const high = isoHour(now);

  const res = await dynamo.send(new QueryCommand({
    TableName: process.env.ELECTION_SENTIMENT_TABLE!,
    KeyConditionExpression: 'candidate = :c AND #w BETWEEN :low AND :high',
    ExpressionAttributeNames: { '#w': 'window' },
    ExpressionAttributeValues: { ':c': candidate, ':low': low, ':high': high },
    ScanIndexForward: true,
  }));

  const windows = (res.Items ?? []).map(i => {
    const total: number = i.total ?? 0;
    const positive: number = i.positive_count ?? 0;
    return {
      window: i.window,
      positive,
      negative: i.negative_count ?? 0,
      neutral: i.neutral_count ?? 0,
      total,
      score: total > 0 ? Math.round(positive / total * 100) : 0,
    };
  });

  return { candidate, hours: clampedHours, windows, updatedAt: now.toISOString() };
}
