import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
let loaded = false;

const SECRET_ENV_VARS: { envKey: string; ssmEnv: string }[] = [
  { envKey: 'NEWS_API_KEY',      ssmEnv: 'NEWS_API_KEY_SSM' },
  { envKey: 'APIFY_API_TOKEN',   ssmEnv: 'APIFY_API_TOKEN_SSM' },
  { envKey: 'YOUTUBE_API_KEY',   ssmEnv: 'YOUTUBE_API_KEY_SSM' },
];

export async function loadSecrets(): Promise<void> {
  if (loaded) return;

  const toFetch = SECRET_ENV_VARS.filter(({ ssmEnv }) => process.env[ssmEnv]);
  if (!toFetch.length) { loaded = true; return; }

  const res = await ssm.send(new GetParametersCommand({
    Names: toFetch.map(({ ssmEnv }) => process.env[ssmEnv]!),
    WithDecryption: true,
  }));

  for (const param of res.Parameters ?? []) {
    const entry = toFetch.find(({ ssmEnv }) => process.env[ssmEnv] === param.Name);
    if (entry && param.Value) {
      process.env[entry.envKey] = param.Value;
    }
  }

  if (res.InvalidParameters?.length) {
    console.warn('SSM: could not resolve parameters:', res.InvalidParameters);
  }

  loaded = true;
}
