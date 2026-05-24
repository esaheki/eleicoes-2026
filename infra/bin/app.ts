import * as cdk from 'aws-cdk-lib';
import { StreamingStack } from '../lib/streaming-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { WebsiteStack } from '../lib/website-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const streaming = new StreamingStack(app, 'StreamingStack', { env });

new PipelineStack(app, 'PipelineStack', {
  env,
  stream: streaming.stream,
});

new WebsiteStack(app, 'WebsiteStack', {
  // WebsiteStack MUST deploy to us-east-1 — ACM cert required for CloudFront
  env: { ...env, region: 'us-east-1' },
  restApi: streaming.restApi,
  wsApi: streaming.wsApi,
  crossRegionReferences: true,
});
