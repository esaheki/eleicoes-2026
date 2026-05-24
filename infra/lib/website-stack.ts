import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

const DOMAIN = 'eleicoes-2026.com';

interface WebsiteStackProps extends cdk.StackProps {
  restApi: apigateway.LambdaRestApi;
  wsApi: apigatewayv2.WebSocketApi;
}

export class WebsiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    // ── Hosted zone (pre-existing, do not create) ─────────────────────────
    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: DOMAIN });

    // ── ACM certificate — us-east-1 required for CloudFront ───────────────
    const cert = new acm.Certificate(this, 'Certificate', {
      domainName: DOMAIN,
      subjectAlternativeNames: [`*.${DOMAIN}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // ── WAF WebACL for CloudFront (CLOUDFRONT scope — must be us-east-1) ──
    // Covers both the SPA distribution and the API+WebSocket distribution.
    // Rate limit uses real client IPs (CloudFront resolves X-Forwarded-For
    // before the WAF rule runs at the edge).
    const cloudfrontWaf = new wafv2.CfnWebACL(this, 'CloudFrontWaf', {
      name: 'eleicoes2026-cf-waf',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'eleicoes2026-cf-waf',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
          },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'CommonRuleSet', sampledRequestsEnabled: true },
        },
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesKnownBadInputsRuleSet' },
          },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'KnownBadInputs', sampledRequestsEnabled: true },
        },
        {
          name: 'CFRateLimit',
          priority: 3,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'CFRateLimit', sampledRequestsEnabled: true },
        },
      ],
    });

    // ── S3 site bucket ────────────────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: 'eleicoes-2026-site',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
    });

    // ── CloudFront Distribution 1 — SPA (eleicoes-2026.com + www) ─────────
    const spaDistribution = new cloudfront.Distribution(this, 'SpaDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      domainNames: [DOMAIN, `www.${DOMAIN}`],
      certificate: cert,
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      webAclId: cloudfrontWaf.attrArn,
    });

    // ── CloudFront Distribution 2 — API (api.eleicoes-2026.com) ───────────
    //
    // Architecture: WebSocket is the DEFAULT behavior (connects to root path),
    // REST API endpoints are ADDITIONAL behaviors matched on /v1/*.
    //
    // This avoids CloudFront Functions entirely — CF Functions don't support
    // WebSocket connections, so path-rewriting /ws → / is not an option.
    // Instead, browsers connect to wss://api.eleicoes-2026.com (no extra path),
    // which hits the default behavior → WebSocket API at originPath /prod.

    // REST API origin — originPath /prod maps /v1/... → stage /prod/v1/...
    const restApiOrigin = new origins.HttpOrigin(
      `${props.restApi.restApiId}.execute-api.${this.region}.amazonaws.com`,
      {
        originPath: '/prod',
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      },
    );

    // WebSocket API origin — originPath /prod, viewer path / → origin /prod/
    const wsApiOrigin = new origins.HttpOrigin(
      `${props.wsApi.apiId}.execute-api.${this.region}.amazonaws.com`,
      {
        originPath: '/prod',
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      },
    );

    // 30-second cache policy for /v1/scores
    const scoresCachePolicy = new cloudfront.CachePolicy(this, 'ScoresCachePolicy', {
      cachePolicyName: 'eleicoes2026-scores-30s',
      defaultTtl: cdk.Duration.seconds(30),
      maxTtl: cdk.Duration.seconds(30),
      minTtl: cdk.Duration.seconds(0),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const apiDistribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      // Default behavior → WebSocket API at /prod (stage root)
      // Browsers connecting wss://api.eleicoes-2026.com send path /, which
      // CloudFront forwards to origin as /prod/ — accepted by API GW WebSocket.
      defaultBehavior: {
        origin: wsApiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      additionalBehaviors: {
        // All REST endpoints — OPTIONS needed for CORS preflight
        '/v1/*': {
          origin: restApiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
        // /v1/scores: 30s shared cache — more specific than /v1/* so takes priority
        '/v1/scores': {
          origin: restApiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: scoresCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
      },
      domainNames: [`api.${DOMAIN}`],
      certificate: cert,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      webAclId: cloudfrontWaf.attrArn,
    });

    // ── Route 53 records ──────────────────────────────────────────────────

    new route53.ARecord(this, 'ApexRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(spaDistribution)),
    });

    new route53.ARecord(this, 'WwwRecord', {
      zone,
      recordName: 'www',
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(spaDistribution)),
    });

    new route53.ARecord(this, 'ApiRecord', {
      zone,
      recordName: 'api',
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(apiDistribution)),
    });

    new route53.AaaaRecord(this, 'ApexAaaaRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(spaDistribution)),
    });
    new route53.AaaaRecord(this, 'ApiAaaaRecord', {
      zone,
      recordName: 'api',
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(apiDistribution)),
    });

    // ── Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${DOMAIN}`,
      exportName: 'SiteUrl',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://api.${DOMAIN}/v1`,
      exportName: 'ApiPublicUrl',
    });

    // WebSocket connects to the root of the API distribution — no /ws suffix
    new cdk.CfnOutput(this, 'WsUrl', {
      value: `wss://api.${DOMAIN}`,
      exportName: 'WsPublicUrl',
    });

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: siteBucket.bucketName,
      exportName: 'SiteBucketName',
    });

    new cdk.CfnOutput(this, 'SpaDistributionId', {
      value: spaDistribution.distributionId,
      exportName: 'SpaDistributionId',
    });
  }
}
