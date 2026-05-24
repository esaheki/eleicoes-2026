import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({});

// Returns true if already seen (duplicate), false if new (and marks it).
// Uses conditional PutItem for atomicity across concurrent Lambda invocations.
export async function checkAndMarkSeen(id: string): Promise<boolean> {
  if (process.env.DRY_RUN === 'true') return false;

  const ttl = Math.floor(Date.now() / 1000) + 600; // 10-minute TTL
  try {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.SEEN_IDS_TABLE!,
      Item: { id: { S: id }, ttl: { N: String(ttl) } },
      ConditionExpression: 'attribute_not_exists(id)',
    }));
    return false;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return true;
    throw err;
  }
}
