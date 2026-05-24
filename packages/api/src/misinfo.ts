import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function periodKey(hours: number): string {
  if (hours <= 1) return 'live';
  if (hours <= 24) return '24h';
  return '7d';
}

export async function getMisinfo(hours: number) {
  const period = periodKey(hours);

  const res = await dynamo.send(new QueryCommand({
    TableName: process.env.MISINFO_AGGREGATES_TABLE!,
    KeyConditionExpression: '#p = :p',
    ExpressionAttributeNames: { '#p': 'period' },
    ExpressionAttributeValues: { ':p': period },
    ScanIndexForward: false,
    Limit: 1,
  }));

  if (!res.Items?.length) {
    return {
      period_hours: hours,
      total_scored: 0,
      likely_false: 0,
      suspicious: 0,
      credible: 0,
      likely_false_pct: 0,
      top_flags: [],
      by_candidate: [],
      by_source: [],
    };
  }

  const item = res.Items[0];
  return { period_hours: hours, ...item };
}
