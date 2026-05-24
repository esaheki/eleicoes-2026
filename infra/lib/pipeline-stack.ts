import * as cdk from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import { Construct } from 'constructs';

interface PipelineStackProps extends cdk.StackProps {
  stream: kinesis.Stream;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // ── S3 raw archive bucket ─────────────────────────────────────────────
    // No explicit name — auto-generated to avoid naming conflicts on re-deploy
    const rawBucket = new s3.Bucket(this, 'RawBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // ── Glue Data Catalog ─────────────────────────────────────────────────
    const glueDb = new glue.CfnDatabase(this, 'GlueDb', {
      catalogId: this.account,
      databaseInput: { name: 'eleicoes2026' },
    });

    // Schema mirrors SocialPost — used by Firehose for Parquet conversion
    const glueTable = new glue.CfnTable(this, 'GlueTable', {
      catalogId: this.account,
      databaseName: 'eleicoes2026',
      tableInput: {
        name: 'election_stream_raw',
        tableType: 'EXTERNAL_TABLE',
        storageDescriptor: {
          location: `s3://${rawBucket.bucketName}/stream/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'id', type: 'string' },
            { name: 'source', type: 'string' },
            { name: 'text', type: 'string' },
            { name: 'author', type: 'string' },
            { name: 'timestamp', type: 'string' },
            { name: 'candidate_mentions', type: 'array<string>' },
            { name: 'region', type: 'string' },
            { name: 'url', type: 'string' },
            { name: 'video_id', type: 'string' },
            { name: 'video_title', type: 'string' },
          ],
        },
        parameters: { classification: 'parquet' },
      },
    });
    glueTable.addDependency(glueDb);

    // ── Firehose IAM role ─────────────────────────────────────────────────
    // All permissions are INLINE on the role so they're available immediately
    // when Firehose validates the role at creation time (no IAM propagation lag)
    const kmsStatements: iam.PolicyStatement[] = props.stream.encryptionKey
      ? [
          new iam.PolicyStatement({
            actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
            resources: [props.stream.encryptionKey.keyArn],
          }),
        ]
      : [];

    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      inlinePolicies: {
        KinesisAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'kinesis:GetRecords',
                'kinesis:GetShardIterator',
                'kinesis:DescribeStream',
                'kinesis:DescribeStreamSummary',
                'kinesis:ListShards',
              ],
              resources: [props.stream.streamArn],
            }),
            ...kmsStatements,
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject',
              ],
              resources: [rawBucket.bucketArn, `${rawBucket.bucketArn}/*`],
            }),
          ],
        }),
        GlueAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'glue:GetTable',
                'glue:GetTableVersion',
                'glue:GetTableVersions',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // ── Kinesis Firehose → S3 (Parquet via Glue schema, 60s/128MB buffer) ─
    const deliveryStream = new firehose.CfnDeliveryStream(this, 'FirehoseDeliveryStream', {
      deliveryStreamName: 'eleicoes2026-firehose',
      deliveryStreamType: 'KinesisStreamAsSource',
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: props.stream.streamArn,
        roleArn: firehoseRole.roleArn,
      },
      extendedS3DestinationConfiguration: {
        bucketArn: rawBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        prefix: 'stream/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 128,
        },
        // UNCOMPRESSED here — ParquetSerDe handles Snappy compression internally
        compressionFormat: 'UNCOMPRESSED',
        dataFormatConversionConfiguration: {
          enabled: true,
          inputFormatConfiguration: {
            deserializer: { hiveJsonSerDe: {} },
          },
          outputFormatConfiguration: {
            serializer: { parquetSerDe: { compression: 'SNAPPY' } },
          },
          schemaConfiguration: {
            catalogId: this.account,
            databaseName: 'eleicoes2026',
            tableName: 'election_stream_raw',
            region: this.region,
            roleArn: firehoseRole.roleArn,
            versionId: 'LATEST',
          },
        },
      },
    });
    deliveryStream.addDependency(glueTable);

    // ── Glue Crawler IAM role ─────────────────────────────────────────────
    const crawlerRole = new iam.Role(this, 'CrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });
    rawBucket.grantRead(crawlerRole);

    // Daily at 06:00 UTC — keeps Glue catalog in sync with Firehose partitions
    new glue.CfnCrawler(this, 'GlueCrawler', {
      name: 'eleicoes2026-crawler',
      role: crawlerRole.roleArn,
      databaseName: 'eleicoes2026',
      targets: {
        s3Targets: [{ path: `s3://${rawBucket.bucketName}/stream/` }],
      },
      schedule: { scheduleExpression: 'cron(0 6 * * ? *)' },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
    });

    new cdk.CfnOutput(this, 'RawBucketName', {
      value: rawBucket.bucketName,
      exportName: 'RawBucketName',
    });
  }
}
