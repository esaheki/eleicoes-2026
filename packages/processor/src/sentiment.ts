import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({});

export interface SentimentResult {
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  positiveScore: number;
  negativeScore: number;
  neutralScore: number;
  mixedScore: number;
  confidence: number;
}

interface BatchItem {
  is_portuguese: boolean;
  sentiment: SentimentResult['sentiment'] | null;
  scores: { positive: number; negative: number; neutral: number; mixed: number } | null;
}

function buildPrompt(texts: string[]): string {
  const numbered = texts.map((t, i) => `${i + 1}. ${t.slice(0, 300)}`).join('\n');
  return `For each text below, classify language and sentiment. Return ONLY a JSON array (no explanation) with one object per text in the same order:
{"is_portuguese":boolean,"sentiment":"POSITIVE"|"NEGATIVE"|"NEUTRAL"|"MIXED"|null,"scores":{"positive":float,"negative":float,"neutral":float,"mixed":float}|null}

Set "is_portuguese" to true only if the text is primarily written in Portuguese.
Set "sentiment" and "scores" to null if not Portuguese.
Scores must sum to approximately 1.0.

Texts:
${numbered}`;
}

export async function detectLanguageAndSentiment(
  texts: string[],
): Promise<Array<{ isPortuguese: boolean; result: SentimentResult | null }>> {
  const output: Array<{ isPortuguese: boolean; result: SentimentResult | null }> = texts.map(() => ({
    isPortuguese: false,
    result: null,
  }));

  for (let i = 0; i < texts.length; i += 25) {
    const batch = texts.slice(i, i + 25);
    try {
      const res = await bedrock.send(new InvokeModelCommand({
        modelId: process.env.BEDROCK_MODEL_ID!,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1536,
          messages: [{ role: 'user', content: buildPrompt(batch) }],
        }),
      }));

      const responseText = (
        JSON.parse(Buffer.from(res.body).toString('utf-8')) as { content: { text: string }[] }
      ).content[0].text;

      const cleaned = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned) as BatchItem[];

      for (let j = 0; j < parsed.length; j++) {
        const item = parsed[j];
        if (!item) continue;
        const idx = i + j;
        if (!item.is_portuguese || !item.sentiment || !item.scores) {
          output[idx] = { isPortuguese: false, result: null };
          continue;
        }
        const s = item.scores;
        output[idx] = {
          isPortuguese: true,
          result: {
            sentiment: item.sentiment,
            positiveScore: s.positive,
            negativeScore: s.negative,
            neutralScore: s.neutral,
            mixedScore: s.mixed,
            confidence: Math.max(s.positive, s.negative, s.neutral, s.mixed),
          },
        };
      }
    } catch (err) {
      console.error(`Bedrock sentiment batch failed for offset ${i}:`, err);
      // Entries remain as isPortuguese: false, result: null — same behavior as a Comprehend error
    }
  }

  return output;
}
