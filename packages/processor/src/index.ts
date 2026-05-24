import type { KinesisStreamEvent } from 'aws-lambda';
import type { SocialPost } from '../../collector/src/types';
import { filterByLanguage, detectSentimentBatch } from './sentiment';
import { scorePost } from './fakechecker';
import {
  writeHourlyWindow,
  writeCommentSample,
  writeMisinfoEvent,
  writeHashtags,
} from './dynamo';
import { emitSourceMetrics } from './metrics';

function decodeRecord(data: string): SocialPost {
  return JSON.parse(Buffer.from(data, 'base64').toString('utf-8')) as SocialPost;
}

function extractHashtags(text: string): string[] {
  return [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) ?? [])];
}

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  // Step 1: Decode all Kinesis records
  const posts: SocialPost[] = [];
  for (const record of event.Records) {
    try {
      posts.push(decodeRecord(record.kinesis.data));
    } catch (err) {
      console.error(`Failed to decode record ${record.kinesis.sequenceNumber}:`, err);
    }
  }

  if (!posts.length) return;

  // Step 0: Language filter — keep only Portuguese posts (confidence >= 0.7)
  const ptFlags = await filterByLanguage(posts.map(p => p.text));
  const ptPosts = posts.filter((_, i) => ptFlags[i]);
  console.log(`Language filter: ${ptPosts.length}/${posts.length} Portuguese posts`);

  if (!ptPosts.length) return;

  // Step 2: Batch sentiment detection (25 per Comprehend call)
  const sentiments = await detectSentimentBatch(ptPosts.map(p => p.text));

  // Steps 3, 7, 8, 9, 10: Process each post in parallel
  const results = await Promise.allSettled(
    ptPosts.map(async (post, i) => {
      const sentiment = sentiments[i];
      if (!sentiment) {
        console.error(`No sentiment result for post ${post.id}`);
        return;
      }

      // Step 7: Bedrock fake-info scoring (concurrency-5 semaphore inside scorePost)
      const credibility = await scorePost(post, sentiment.confidence);

      // Step 3-4: Atomic increment on the hourly window for each candidate mention
      const windowResults = await Promise.allSettled(
        post.candidate_mentions.map(candidate => writeHourlyWindow(candidate, sentiment)),
      );
      for (const r of windowResults) {
        if (r.status === 'rejected') console.error('writeHourlyWindow failed:', r.reason);
      }

      const primaryCandidate = post.candidate_mentions[0];
      if (!primaryCandidate) return;

      // Step 8: Comment sample (only if Comprehend confidence >= 0.7)
      if (sentiment.confidence >= 0.7) {
        await writeCommentSample(post, primaryCandidate, sentiment, credibility);
      }

      // Step 9: Misinfo event (always, regardless of credibility label)
      await writeMisinfoEvent(post, primaryCandidate, credibility);

      // Step 10: Trending hashtags
      const hashtags = extractHashtags(post.text);
      if (hashtags.length) {
        await writeHashtags(hashtags, primaryCandidate);
      }
    }),
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    console.error(`${failed.length} posts failed:`, failed.map(r => (r as PromiseRejectedResult).reason));
  }

  const sourceCounts = new Map<string, number>();
  for (const post of ptPosts) {
    sourceCounts.set(post.source, (sourceCounts.get(post.source) ?? 0) + 1);
  }
  await emitSourceMetrics('ProcessorPostCount', sourceCounts).catch(err =>
    console.error('Failed to emit per-source processor metrics:', err),
  );

  console.log(`Processed ${ptPosts.length} posts (${failed.length} errors)`);
};
