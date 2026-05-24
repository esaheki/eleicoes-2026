import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getScores } from './scores';
import { getHistory } from './history';
import { getSamples } from './samples';
import { getTrending } from './trending';
import { getMisinfo } from './misinfo';

// Comma-separated list of allowed origins from env — supports apex + www
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN ?? '*').split(',').map(o => o.trim()),
);

function corsHeaders(event: APIGatewayProxyEvent): Record<string, string> {
  const origin = event.headers['origin'] ?? event.headers['Origin'] ?? '';
  const allowed = ALLOWED_ORIGINS.has('*') || ALLOWED_ORIGINS.has(origin)
    ? origin || '*'
    : [...ALLOWED_ORIGINS][0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };
}

function ok(body: unknown, event: APIGatewayProxyEvent, extra?: Record<string, string>): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event), ...extra },
    body: JSON.stringify(body),
  };
}

function err(status: number, message: string, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify({ error: message }),
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }

  const path = event.path;
  const q = event.queryStringParameters ?? {};

  try {
    if (path === '/v1/scores') {
      const data = await getScores();
      return ok(data, event, { 'Cache-Control': 'max-age=30' });
    }

    if (path === '/v1/history') {
      const candidate = q.candidate;
      if (!candidate) return err(400, 'candidate parameter required', event);
      const data = await getHistory(candidate, parseInt(q.hours ?? '24', 10));
      return ok(data, event);
    }

    if (path === '/v1/samples') {
      const data = await getSamples({
        source: q.source ?? undefined,
        candidate: q.candidate ?? undefined,
        sentiment: q.sentiment ?? undefined,
        credibility: q.credibility ?? undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      return ok(data, event);
    }

    if (path === '/v1/trending') {
      const data = await getTrending(q.candidate ?? undefined);
      return ok(data, event);
    }

    if (path === '/v1/misinformation') {
      const data = await getMisinfo(parseInt(q.hours ?? '24', 10));
      return ok(data, event);
    }

    return err(404, 'Not found', event);
  } catch (e) {
    const statusCode = (e as { statusCode?: number }).statusCode;
    if (statusCode === 400) return err(400, (e as Error).message, event);
    console.error('Unhandled error:', e);
    return err(500, 'Internal server error', event);
  }
};
