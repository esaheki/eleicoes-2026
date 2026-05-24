import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import pLimit from 'p-limit';
import type { SocialPost } from '../../collector/src/types';
import { emitMetric } from './metrics';

const bedrock = new BedrockRuntimeClient({});
const limit = pLimit(5);

export interface FakeCheckResult {
  credibility_score: number | null;
  credibility_label: 'CREDIBLE' | 'SUSPICIOUS' | 'LIKELY_FALSE' | 'UNSCORED';
  flags: string[];
  flag_reasoning: string;
}

const UNSCORED: FakeCheckResult = {
  credibility_score: null,
  credibility_label: 'UNSCORED',
  flags: [],
  flag_reasoning: '',
};

const VALID_FLAGS = new Set([
  'urna_fraud', 'candidate_crime', 'vote_buying', 'election_coup',
  'fake_quote', 'health_disinfo', 'economic_disinfo', 'foreign_interference',
]);

function deriveLabel(score: number): FakeCheckResult['credibility_label'] {
  const high = parseInt(process.env.FAKE_INFO_SCORE_HIGH ?? '70', 10);
  const medium = parseInt(process.env.FAKE_INFO_SCORE_MEDIUM ?? '40', 10);
  if (score >= high) return 'LIKELY_FALSE';
  if (score >= medium) return 'SUSPICIOUS';
  return 'CREDIBLE';
}

function buildPrompt(post: SocialPost): string {
  const escapedText = post.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `Você é um verificador de fatos especializado em desinformação eleitoral brasileira.
Analise o comentário abaixo e responda SOMENTE com um objeto JSON, sem texto adicional.

Comentário: "${escapedText}"
Candidatos mencionados: ${post.candidate_mentions.join(', ')}

Responda com:
{
  "credibility_score": <inteiro 0-100, onde 100 = certamente falso>,
  "flags": <array com zero ou mais valores do conjunto: ["urna_fraud", "candidate_crime",
             "vote_buying", "election_coup", "fake_quote", "health_disinfo",
             "economic_disinfo", "foreign_interference"]>,
  "reasoning": "<uma frase em português explicando o score, max 120 caracteres>"
}

Critérios:
- Score 0–39: sem alegações verificáveis problemáticas → CREDIBLE
- Score 40–69: alegações suspeitas ou sem fonte → SUSPICIOUS
- Score 70–100: desinformação provável ou conhecida → LIKELY_FALSE
Se o comentário for opinião pessoal sem alegações factuais, retorne score 0 e flags [].`;
}

async function callBedrock(post: SocialPost): Promise<FakeCheckResult> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: process.env.BEDROCK_MODEL_ID!,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 256,
      messages: [{ role: 'user', content: buildPrompt(post) }],
    }),
  }));

  const responseText = (
    JSON.parse(Buffer.from(res.body).toString('utf-8')) as {
      content: { text: string }[];
    }
  ).content[0].text;

  // Strip accidental markdown fences before parsing
  const cleaned = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();

  const parsed = JSON.parse(cleaned) as {
    credibility_score: number;
    flags?: string[];
    reasoning?: string;
  };

  const score = Math.min(100, Math.max(0, Math.round(parsed.credibility_score)));
  const flags = (parsed.flags ?? []).filter(f => VALID_FLAGS.has(f));
  const label = deriveLabel(score);

  if (label === 'LIKELY_FALSE') {
    await emitMetric('FakeInfoDetected', 1).catch(err =>
      console.error('Failed to emit FakeInfoDetected metric:', err),
    );
  }

  await emitMetric('TotalScored', 1).catch(err =>
    console.error('Failed to emit TotalScored metric:', err),
  );

  console.log(`Bedrock scored post ${post.id}: ${score} (${label}) flags=${flags.join(',')}`);

  return {
    credibility_score: score,
    credibility_label: label,
    flags,
    flag_reasoning: (parsed.reasoning ?? '').slice(0, 120),
  };
}

export async function scorePost(
  post: SocialPost,
  comprehendConfidence: number,
): Promise<FakeCheckResult> {
  // NewsAPI articles come from verified outlets — skip scoring
  if (post.source === 'news') return UNSCORED;

  // Skip low-confidence Comprehend results (emoji-only, mixed language, etc.)
  const threshold = parseFloat(process.env.FAKE_INFO_CONFIDENCE_THRESHOLD ?? '0.6');
  if (comprehendConfidence < threshold) return UNSCORED;

  try {
    return await limit(() => callBedrock(post));
  } catch (err) {
    console.error(`Bedrock scoring failed for post ${post.id}:`, err);
    return UNSCORED;
  }
}
