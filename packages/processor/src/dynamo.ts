import {
  DynamoDBClient,
  UpdateItemCommand,
  PutItemCommand,
  ConditionalCheckFailedException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import type { SocialPost } from '../../collector/src/types';
import type { SentimentResult } from './sentiment';
import type { FakeCheckResult } from './fakechecker';

const dynamo = new DynamoDBClient({});

function isoHour(date: Date = new Date()): string {
  // e.g. "2026-10-04T14:00"
  return date.toISOString().slice(0, 13) + ':00';
}

export async function writeHourlyWindow(
  candidate: string,
  sentiment: SentimentResult,
): Promise<void> {
  const window = isoHour();
  const ttl = Math.floor(Date.now() / 1000) + 30 * 3600;

  const sentimentAttr =
    sentiment.sentiment === 'POSITIVE' ? 'positive_count' :
    sentiment.sentiment === 'NEGATIVE' ? 'negative_count' : 'neutral_count';

  await dynamo.send(new UpdateItemCommand({
    TableName: process.env.DYNAMO_TABLE!,
    Key: {
      candidate: { S: candidate },
      window: { S: window },
    },
    UpdateExpression: 'SET #lu = :lu, #ttl = if_not_exists(#ttl, :ttl) ADD #tot :one, #cnt :one',
    ExpressionAttributeNames: {
      '#lu': 'last_updated',
      '#ttl': 'ttl',
      '#tot': 'total',
      '#cnt': sentimentAttr,
    },
    ExpressionAttributeValues: {
      ':lu': { S: new Date().toISOString() },
      ':ttl': { N: String(ttl) },
      ':one': { N: '1' },
    },
  }));
}

export async function writeCommentSample(
  post: SocialPost,
  candidate: string,
  sentiment: SentimentResult,
  credibility: FakeCheckResult,
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 2 * 3600;
  const sk = `${post.timestamp}#${post.id}`;

  const scoreValue = {
    POSITIVE: sentiment.positiveScore,
    NEGATIVE: sentiment.negativeScore,
    NEUTRAL: sentiment.neutralScore,
    MIXED: sentiment.mixedScore,
  }[sentiment.sentiment];

  const item: Record<string, AttributeValue> = {
    source: { S: post.source },
    'timestamp#id': { S: sk },
    candidate: { S: candidate },
    sentiment: { S: sentiment.sentiment },
    text: { S: post.text.slice(0, 280) },
    author: { S: post.author },
    url: { S: post.url ?? '' },
    score: { N: String(Math.round(scoreValue * 100)) },
    credibility_label: { S: credibility.credibility_label },
    flags: { L: credibility.flags.map(f => ({ S: f })) },
    flag_reasoning: { S: credibility.flag_reasoning },
    ttl: { N: String(ttl) },
  };

  if (post.video_title) item.video_title = { S: post.video_title };
  if (credibility.credibility_score !== null) {
    item.credibility_score = { N: String(credibility.credibility_score) };
  }

  try {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.COMMENT_SAMPLES_TABLE!,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#src)',
      ExpressionAttributeNames: { '#src': 'source' },
    }));
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

export async function writeMisinfoEvent(
  post: SocialPost,
  candidate: string,
  credibility: FakeCheckResult,
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const sk = `${post.timestamp}#${post.id}`;

  const item: Record<string, AttributeValue> = {
    candidate: { S: candidate },
    'timestamp#id': { S: sk },
    credibility_label: { S: credibility.credibility_label },
    flags: { L: credibility.flags.map(f => ({ S: f })) },
    flag_reasoning: { S: credibility.flag_reasoning },
    source: { S: post.source },
    ttl: { N: String(ttl) },
  };

  if (credibility.credibility_score !== null) {
    item.credibility_score = { N: String(credibility.credibility_score) };
  }

  try {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.MISINFO_EVENTS_TABLE!,
      Item: item,
      ConditionExpression: 'attribute_not_exists(candidate)',
    }));
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

export async function writeHashtags(hashtags: string[], candidate: string): Promise<void> {
  const sk = `${isoHour()}#${candidate}`;
  const ttl = Math.floor(Date.now() / 1000) + 48 * 3600;

  await Promise.allSettled(
    hashtags.map(hashtag =>
      dynamo.send(new UpdateItemCommand({
        TableName: process.env.KEYWORD_COUNTS_TABLE!,
        Key: {
          hashtag: { S: hashtag },
          'hour_window#candidate': { S: sk },
        },
        UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':ttl': { N: String(ttl) },
        },
      })),
    ),
  );
}
