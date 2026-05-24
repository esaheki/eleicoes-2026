export async function runApifyActor<T>(
  actorId: string,
  input: Record<string, unknown>,
  timeoutSecs = 120,
): Promise<T[]> {
  // timeout: hard actor execution limit; waitSecs: how long to block synchronously
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeoutSecs}&waitSecs=${timeoutSecs + 10}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeoutSecs + 15) * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify ${actorId} failed: ${res.status} — ${body.slice(0, 300)}`);
    }
    return res.json() as Promise<T[]>;
  } finally {
    clearTimeout(timer);
  }
}
