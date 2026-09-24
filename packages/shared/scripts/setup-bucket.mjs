#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import { setupBucket } from '../dist/storage/setup-bucket.js';

const usage = `Usage: pnpm setup:bucket --bucket <name> [--region <region>] [--backend s3|minio] [--prefix <physical-key-prefix>]
Enables versioning and replaces the bucket lifecycle policy.
Expiration requires legal-hold=false; unclassified and held versions remain.
Environment: S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID,
S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE (true or false).
Existing object tags are not changed. See docs/operations/storage-retention.md.`;

export function parseSetupOptions(args, env) {
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: {
      bucket: { type: 'string' },
      region: { type: 'string' },
      help: { type: 'boolean' },
      backend: { type: 'string' },
      prefix: { type: 'string' },
    },
  });
  if (values.help) return null;
  const backend = values.backend ?? 's3';
  if (!['s3', 'minio'].includes(backend)) throw new Error('Invalid storage backend');
  const bucket = values.bucket ?? env.S3_BUCKET;
  if (!bucket?.trim()) throw new Error('Bucket is required');
  const pathStyle = env.S3_FORCE_PATH_STYLE;
  if (pathStyle && !['true', 'false'].includes(pathStyle)) throw new Error('Invalid path style');
  if (!!env.S3_ACCESS_KEY_ID !== !!env.S3_SECRET_ACCESS_KEY)
    throw new Error('Incomplete credentials');
  return {
    bucket,
    backend,
    prefix: values.prefix ?? '',
    client: {
      region: values.region ?? env.S3_REGION ?? 'us-east-1',
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: pathStyle ? pathStyle === 'true' : !!env.S3_ENDPOINT,
      ...(env.S3_ACCESS_KEY_ID
        ? {
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    },
  };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseSetupOptions(args, env);
  if (!options) {
    console.log(usage);
    return;
  }
  const client = new S3Client(options.client);
  try {
    const result = await setupBucket({
      bucket: options.bucket,
      backend: options.backend,
      prefix: options.prefix,
      client,
    });
    console.log('Bucket versioning enabled; tagged lifecycle policy applied.');
    if (result.multipartCleanup === 'server-config-required') {
      console.log(
        'MinIO multipart cleanup requires server settings: MINIO_API_STALE_UPLOADS_EXPIRY=168h and MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL=1h. Verify these separately.'
      );
    }
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // SDK errors can contain credential-bearing URLs. Keep the operator output bounded.
    console.error('Bucket setup failed. Check arguments, credentials and bucket permissions.');
    process.exitCode = 1;
  });
}
