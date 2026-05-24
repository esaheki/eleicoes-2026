import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const WS_CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE!;
const TTL_HOURS = 2;

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const routeKey = event.requestContext.routeKey;

  if (routeKey === '$connect') {
    const ttl = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
    await dynamo.send(new PutCommand({
      TableName: WS_CONNECTIONS_TABLE,
      Item: { connectionId, ttl, connectedAt: new Date().toISOString() },
    }));
  } else if (routeKey === '$disconnect') {
    await dynamo.send(new DeleteCommand({
      TableName: WS_CONNECTIONS_TABLE,
      Key: { connectionId },
    }));
  }

  return { statusCode: 200, body: 'OK' };
};
