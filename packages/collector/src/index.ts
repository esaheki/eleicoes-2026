import { SocialPost } from './types';
import { putToKinesis } from './kinesis';
import { emitMetric, emitSourceMetrics } from './metrics';
import { loadSecrets } from './secrets';
import { collectRSS } from './sources/rss';
import { collectXTwitter } from './sources/xtwitter';
import { collectYouTube } from './sources/youtube';

export const handler = async (): Promise<void> => {
  await loadSecrets();
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const MODE = process.env.COLLECTOR_MODE ?? 'news';
  const posts: SocialPost[] = [];

  if (MODE === 'news') {
    const results = await Promise.allSettled([collectRSS()]);
    for (const r of results) {
      if (r.status === 'fulfilled') posts.push(...r.value);
      else console.error('Source failed:', r.reason);
    }
  } else if (MODE === 'apify') {
    const results = await Promise.allSettled([collectXTwitter()]);
    for (const r of results) {
      if (r.status === 'fulfilled') posts.push(...r.value);
      else console.error('Source failed:', r.reason);
    }
  } else if (MODE === 'youtube') {
    const yt = await collectYouTube();
    posts.push(...yt);
  } else {
    console.error(`Unknown COLLECTOR_MODE: ${MODE}`);
    return;
  }

  console.log(`Total posts collected: ${posts.length}`);

  if (DRY_RUN) {
    console.log(JSON.stringify(posts, null, 2));
    return;
  }

  await putToKinesis(posts);
  await emitMetric('CollectorPostCount', posts.length);

  const sourceCounts = new Map<string, number>();
  for (const post of posts) {
    sourceCounts.set(post.source, (sourceCounts.get(post.source) ?? 0) + 1);
  }
  await emitSourceMetrics('CollectorPostCount', sourceCounts).catch(err =>
    console.error('Failed to emit per-source collector metrics:', err),
  );

  console.log(`Wrote ${posts.length} records to Kinesis`);
};
