import { KinesisClient, PutRecordsCommand } from '@aws-sdk/client-kinesis';
import { SocialPost } from './types';

const kinesis = new KinesisClient({});

export async function putToKinesis(posts: SocialPost[]): Promise<void> {
  if (!posts.length) return;

  // Kinesis PutRecords limit is 500 records per call
  for (let i = 0; i < posts.length; i += 500) {
    const batch = posts.slice(i, i + 500);
    await kinesis.send(new PutRecordsCommand({
      StreamName: process.env.KINESIS_STREAM_NAME!,
      Records: batch.map(post => ({
        Data: Buffer.from(JSON.stringify(post)),
        PartitionKey: post.candidate_mentions[0] ?? 'unknown',
      })),
    }));
  }
}
