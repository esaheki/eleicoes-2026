import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CANDIDATES } from '../../collector/src/types';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function isoHour(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13) + ':00';
}

function sumField(items: Record<string, unknown>[], field: string): number {
  return items.reduce((s, i) => s + (((i[field] as number) ?? 0)), 0);
}

function computeScore(positive: number, total: number): number {
  return total > 0 ? Math.round((positive / total) * 100) : 0;
}

export async function getScores() {
  const now = new Date();
  // Fetch 13 windows so we can compute both current and previous 12-window scores
  const queryLow  = isoHour(new Date(now.getTime() - 12 * 3_600_000)); // 13h ago (window start)
  const queryHigh = isoHour(now);
  const currentLow = isoHour(new Date(now.getTime() - 11 * 3_600_000)); // 12h ago
  const prevHigh   = isoHour(new Date(now.getTime() -  1 * 3_600_000)); // 1h ago

  const candidateScores = await Promise.all(
    CANDIDATES.map(async candidate => {
      const res = await dynamo.send(new QueryCommand({
        TableName: process.env.ELECTION_SENTIMENT_TABLE!,
        KeyConditionExpression: 'candidate = :c AND #w BETWEEN :low AND :high',
        ExpressionAttributeNames: { '#w': 'window' },
        ExpressionAttributeValues: { ':c': candidate, ':low': queryLow, ':high': queryHigh },
      }));

      const items = res.Items ?? [];

      // Current score: windows from now-11h to now (12 windows)
      const current = items.filter(i => (i.window as string) >= currentLow);
      const positive = sumField(current, 'positive_count');
      const negative = sumField(current, 'negative_count');
      const neutral  = sumField(current, 'neutral_count');
      const total    = sumField(current, 'total');
      const score    = computeScore(positive, total);

      // Previous score: windows from now-12h to now-1h (same 12-window width, shifted back 1h)
      const prev = items.filter(i => (i.window as string) <= prevHigh);
      const prevPositive = sumField(prev, 'positive_count');
      const prevTotal    = sumField(prev, 'total');
      const prevScore    = computeScore(prevPositive, prevTotal);

      const delta = total > 0 && prevTotal > 0 ? score - prevScore : 0;

      const last_updated = current.reduce((latest, i) =>
        (i.last_updated ?? '') > latest ? i.last_updated : latest, '');

      return {
        candidate,
        positive,
        negative,
        neutral,
        total,
        score,
        delta,
        last_updated: last_updated || null,
      };
    }),
  );

  return { scores: candidateScores, window: '1h', updatedAt: now.toISOString() };
}
