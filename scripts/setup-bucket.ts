#!/usr/bin/env ts-node
/**
 * Barghsa — S3 Bucket Setup Script
 *
 * Applies versioning and lifecycle policies to a target bucket.
 *
 * Usage:
 *   node_modules/.bin/ts-node scripts/setup-bucket.ts [--bucket <name>] [--region <region>]
 *
 * Or via pnpm:
 *   pnpm run setup:bucket -- --bucket my-bucket
 *
 * Environment vars (fallback when CLI args omitted):
 *   S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   S3_FORCE_PATH_STYLE
 */

import { S3Client } from '@aws-sdk/client-s3';
import { setupBucket } from '@barghsa/shared/storage';

async function main(): Promise<void> {
  const bucket = process.argv.find((_, i) => process.argv[i - 1] === '--bucket')
    ?? process.env['S3_BUCKET'];
  const region = process.argv.find((_, i) => process.argv[i - 1] === '--region')
    ?? process.env['S3_REGION'] ?? 'us-east-1';

  if (!bucket) {
    console.error(
      'Usage: ts-node scripts/setup-bucket.ts --bucket <name> [--region <region>]\n' +
      'Or set S3_BUCKET environment variable.',
    );
    process.exit(1);
  }

  const endpoint = process.env['S3_ENDPOINT'];

  console.log(`\n🔧 Setting up bucket: ${bucket} (region: ${region})${endpoint ? ` @ ${endpoint}` : ''}\n`);

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(process.env['S3_ACCESS_KEY_ID'] && process.env['S3_SECRET_ACCESS_KEY']
      ? {
          credentials: {
            accessKeyId: process.env['S3_ACCESS_KEY_ID'],
            secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'],
          },
        }
      : {}),
  });

  const result = await setupBucket({ bucket, client });

  if (result.versioningConfigured) {
    console.log('  ✅ Bucket versioning — enabled');
  } else {
    console.log('  ⏭️  Bucket versioning — skipped');
  }

  if (result.lifecycleConfigured) {
    console.log('  ✅ Lifecycle policies — applied');
  } else {
    console.log('  ⏭️  Lifecycle policies — skipped');
  }

  console.log('\n✨ Bucket setup complete.\n');
}

main().catch((err: unknown) => {
  console.error('❌ Bucket setup failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});