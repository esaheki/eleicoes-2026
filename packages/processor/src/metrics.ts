import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cw = new CloudWatchClient({});

export async function emitMetric(name: string, value: number): Promise<void> {
  await cw.send(new PutMetricDataCommand({
    Namespace: 'Eleicoes2026',
    MetricData: [{ MetricName: name, Value: value, Unit: 'Count' }],
  }));
}

export async function emitSourceMetrics(
  metricName: string,
  counts: Map<string, number>,
): Promise<void> {
  if (!counts.size) return;
  await cw.send(new PutMetricDataCommand({
    Namespace: 'Eleicoes2026',
    MetricData: [...counts.entries()].map(([source, value]) => ({
      MetricName: metricName,
      Value: value,
      Unit: 'Count' as const,
      Dimensions: [{ Name: 'Source', Value: source }],
    })),
  }));
}
