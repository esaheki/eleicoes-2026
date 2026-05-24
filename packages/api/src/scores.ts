import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CANDIDATES } from '../../collector/src/types';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function isoHour(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13) + ':00';
}

export async function getScores() {
  const now = new Date();
  const low = isoHour(new Date(now.getTime() - 11 * 3600 * 1000));
  const high = isoHour(now);

  const candidateScores = await Promise.all(
    CANDIDATES.map(async candidate => {
      const res = await dynamo.send(new QueryCommand({
        TableName: process.env.ELECTION_SENTIMENT_TABLE!,
        KeyConditionExpression: 'candidate = :c AND #w BETWEEN :low AND :high',
        ExpressionAttributeNames: { '#w': 'window' },
        ExpressionAttributeValues: { ':c': candidate, ':low': low, ':high': high },
      }));

      const items = res.Items ?? [];
      const positive = items.reduce((s, i) => s + (i.positive_count ?? 0), 0);
      const negative = items.reduce((s, i) => s + (i.negative_count ?? 0), 0);
      const neutral = items.reduce((s, i) => s + (i.neutral_count ?? 0), 0);
      const total = items.reduce((s, i) => s + (i.total ?? 0), 0);
      const last_updated = items.reduce((latest, i) =>
        (i.last_updated ?? '') > latest ? i.last_updated : latest, '');

      return {
        candidate,
        positive,
        negative,
        neutral,
        total,
        score: total > 0 ? Math.round(positive / total * 100) : 0,
        last_updated: last_updated || null,
      };
    }),
  );

  return { scores: candidateScores, window: '1h', updatedAt: now.toISOString() };
}
