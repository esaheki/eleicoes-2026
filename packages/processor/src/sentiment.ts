import {
  ComprehendClient,
  BatchDetectDominantLanguageCommand,
  BatchDetectSentimentCommand,
} from '@aws-sdk/client-comprehend';

const comprehend = new ComprehendClient({});

export async function filterByLanguage(texts: string[]): Promise<boolean[]> {
  const results = new Array<boolean>(texts.length).fill(false);

  for (let i = 0; i < texts.length; i += 25) {
    const batch = texts.slice(i, i + 25);
    const res = await comprehend.send(
      new BatchDetectDominantLanguageCommand({ TextList: batch }),
    );
    for (const item of res.ResultList ?? []) {
      const ptScore = item.Languages?.find(l => l.LanguageCode === 'pt')?.Score ?? 0;
      results[i + item.Index!] = ptScore >= 0.7;
    }
  }

  return results;
}

export interface SentimentResult {
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  positiveScore: number;
  negativeScore: number;
  neutralScore: number;
  mixedScore: number;
  confidence: number;
}

export async function detectSentimentBatch(texts: string[]): Promise<(SentimentResult | null)[]> {
  const results = new Array<SentimentResult | null>(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += 25) {
    const batch = texts.slice(i, i + 25);
    const res = await comprehend.send(
      new BatchDetectSentimentCommand({ TextList: batch, LanguageCode: 'pt' }),
    );
    for (const item of res.ResultList ?? []) {
      const s = item.SentimentScore ?? {};
      const sentiment = item.Sentiment as SentimentResult['sentiment'];
      results[i + item.Index!] = {
        sentiment,
        positiveScore: s.Positive ?? 0,
        negativeScore: s.Negative ?? 0,
        neutralScore: s.Neutral ?? 0,
        mixedScore: s.Mixed ?? 0,
        confidence: Math.max(s.Positive ?? 0, s.Negative ?? 0, s.Neutral ?? 0, s.Mixed ?? 0),
      };
    }
  }

  return results;
}
