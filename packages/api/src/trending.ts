import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function isoHour(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13) + ':00';
}

async function scanHour(hour: string): Promise<{ hashtag: string; count: number; candidate: string }[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await dynamo.send(new ScanCommand({
      TableName: process.env.KEYWORD_COUNTS_TABLE!,
      FilterExpression: 'begins_with(#sk, :hour)',
      ExpressionAttributeNames: { '#sk': 'hour_window#candidate' },
      ExpressionAttributeValues: { ':hour': hour },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items.map(i => {
    const sk = String(i['hour_window#candidate'] ?? '');
    const candidate = sk.substring(sk.indexOf('#') + 1);
    return { hashtag: String(i.hashtag ?? ''), count: Number(i.count ?? 0), candidate };
  });
}

export async function getTrending(candidate?: string) {
  const now = new Date();
  const [curItems, prevItems] = await Promise.all([
    scanHour(isoHour(now)),
    scanHour(isoHour(new Date(now.getTime() - 3600 * 1000))),
  ]);

  const totals = new Map<string, number>();
  for (const item of [...curItems, ...prevItems]) {
    if (candidate && item.candidate !== candidate) continue;
    totals.set(item.hashtag, (totals.get(item.hashtag) ?? 0) + item.count);
  }

  const trending = [...totals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([hashtag, count]) => ({ hashtag, count }));

  return { trending, window_hours: 1, updatedAt: now.toISOString() };
}
