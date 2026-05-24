import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CANDIDATES = ['Lula', 'Flávio Bolsonaro', 'Romeu Zema', 'Ronaldo Caiado'];

interface MisinfoEvent {
  candidate: string;
  'timestamp#id': string;
  credibility_label: string;
  flags: string[];
  source: string;
  credibility_score?: number;
}

async function fetchEventsForPeriod(startIso: string): Promise<MisinfoEvent[]> {
  const endIso = new Date().toISOString();
  const all: MisinfoEvent[] = [];

  await Promise.all(
    CANDIDATES.map(async candidate => {
      let lastKey: Record<string, unknown> | undefined;
      do {
        const res = await dynamo.send(new QueryCommand({
          TableName: process.env.MISINFO_EVENTS_TABLE!,
          KeyConditionExpression: 'candidate = :c AND #sk BETWEEN :start AND :end',
          ExpressionAttributeNames: { '#sk': 'timestamp#id' },
          ExpressionAttributeValues: { ':c': candidate, ':start': startIso, ':end': endIso },
          ExclusiveStartKey: lastKey,
        }));
        for (const item of res.Items ?? []) all.push(item as MisinfoEvent);
        lastKey = res.LastEvaluatedKey;
      } while (lastKey);
    }),
  );

  return all;
}

function aggregate(events: MisinfoEvent[], hours: number) {
  const scored = events.filter(e => e.credibility_label !== 'UNSCORED');
  const total_scored = scored.length;
  const likely_false = scored.filter(e => e.credibility_label === 'LIKELY_FALSE').length;
  const suspicious = scored.filter(e => e.credibility_label === 'SUSPICIOUS').length;
  const credible = scored.filter(e => e.credibility_label === 'CREDIBLE').length;
  const likely_false_pct = total_scored > 0 ? Math.round((likely_false / total_scored) * 100) : 0;

  const flagCounts = new Map<string, number>();
  for (const e of scored) {
    for (const f of e.flags ?? []) {
      flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const byCandidate = new Map<string, { total: number; likely_false: number; suspicious: number }>();
  for (const e of scored) {
    const c = byCandidate.get(e.candidate) ?? { total: 0, likely_false: 0, suspicious: 0 };
    c.total++;
    if (e.credibility_label === 'LIKELY_FALSE') c.likely_false++;
    if (e.credibility_label === 'SUSPICIOUS') c.suspicious++;
    byCandidate.set(e.candidate, c);
  }
  const by_candidate = [...byCandidate.entries()].map(([candidate, s]) => ({ candidate, ...s }));

  const bySource = new Map<string, { total: number; likely_false: number }>();
  for (const e of scored) {
    const s = bySource.get(e.source) ?? { total: 0, likely_false: 0 };
    s.total++;
    if (e.credibility_label === 'LIKELY_FALSE') s.likely_false++;
    bySource.set(e.source, s);
  }
  const by_source = [...bySource.entries()].map(([source, s]) => ({ source, ...s }));

  return {
    period_hours: hours,
    total_scored,
    likely_false,
    suspicious,
    credible,
    likely_false_pct,
    top_flags,
    by_candidate,
    by_source,
  };
}

export const handler = async (): Promise<void> => {
  const now = new Date();
  const computed_at = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + 30 * 24 * 3600;

  const periods: { label: string; hours: number; startIso: string }[] = [
    { label: 'live', hours: 1, startIso: new Date(now.getTime() - 3600_000).toISOString() },
    { label: '24h', hours: 24, startIso: new Date(now.getTime() - 86400_000).toISOString() },
    { label: '7d', hours: 168, startIso: new Date(now.getTime() - 7 * 86400_000).toISOString() },
  ];

  for (const { label, hours, startIso } of periods) {
    const events = await fetchEventsForPeriod(startIso);
    const stats = aggregate(events, hours);

    await dynamo.send(new PutCommand({
      TableName: process.env.MISINFO_AGGREGATES_TABLE!,
      Item: { period: label, computed_at, ttl, ...stats },
    }));

    console.log(`Aggregated period=${label}: total_scored=${stats.total_scored} likely_false=${stats.likely_false}`);
  }
};
