import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSetupOptions } from './setup-bucket.mjs';

test('help needs neither a bucket nor credentials', () => {
  assert.equal(parseSetupOptions(['--', '--help'], {}), null);
});
test('CLI bucket and region override environment and path-style false is respected', () => {
  assert.deepEqual(
    parseSetupOptions(['--bucket', 'synthetic', '--region', 'us-east-2'], {
      S3_BUCKET: 'unused',
      S3_REGION: 'unused',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: 'false',
      S3_ACCESS_KEY_ID: 'audit-key',
      S3_SECRET_ACCESS_KEY: 'audit-secret',
    }),
    {
      bucket: 'synthetic',
      backend: 's3',
      client: {
        region: 'us-east-2',
        endpoint: 'http://localhost:9000',
        forcePathStyle: false,
        credentials: { accessKeyId: 'audit-key', secretAccessKey: 'audit-secret' },
      },
    }
  );
});
test('missing bucket, unknown flags and incomplete credentials fail before SDK access', () => {
  assert.throws(() => parseSetupOptions([], {}), /Bucket is required/);
  assert.throws(() => parseSetupOptions(['--buckte', 'wrong'], {}));
  assert.throws(
    () => parseSetupOptions([], { S3_BUCKET: 'test', S3_ACCESS_KEY_ID: 'key' }),
    /Incomplete/
  );
  assert.throws(
    () => parseSetupOptions([], { S3_BUCKET: 'test', S3_FORCE_PATH_STYLE: 'no' }),
    /path style/
  );
});
