import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import {
  S3Client,
  CreateBucketCommand,
  GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  GetObjectTaggingCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { setupBucket } from '../dist/storage/setup-bucket.js';

// Isolated synthetic bucket. No ambient AWS credentials or persistent Docker volume.
test('bucket setup against real MinIO', { timeout: 90_000 }, async (t) => {
  const name = `barghsa-storage-audit-${randomUUID()}`;
  const credentials = { accessKeyId: 'audit-access', secretAccessKey: randomUUID() };
  let client;
  try {
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        name,
        '-p',
        '127.0.0.1::9000',
        '-e',
        `MINIO_ROOT_USER=${credentials.accessKeyId}`,
        '-e',
        `MINIO_ROOT_PASSWORD=${credentials.secretAccessKey}`,
        'minio/minio:latest',
        'server',
        '/data',
      ],
      { stdio: 'pipe' }
    );
    const port = execFileSync('docker', ['port', name, '9000/tcp'], { encoding: 'utf8' })
      .trim()
      .split(':')
      .at(-1);
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        ready = (
          await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(500) })
        ).ok;
      } catch {
        /* container starting */
      }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'isolated MinIO started');
    client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
    const Bucket = 'audit-retention';
    await client.send(new CreateBucketCommand({ Bucket }));
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-uploads-1d',
              Status: 'Enabled',
              Filter: { Prefix: 'uploads/' },
              Expiration: { Days: 1 },
            },
          ],
        },
      })
    );

    await t.test('CLI applies policy using declared package dependencies', () => {
      const result = spawnSync(
        process.execPath,
        ['packages/shared/scripts/setup-bucket.mjs', '--bucket', Bucket, '--backend', 'minio'],
        {
          cwd: new URL('../../../', import.meta.url),
          encoding: 'utf8',
          timeout: 20_000,
          env: {
            PATH: process.env.PATH,
            S3_REGION: 'us-east-1',
            S3_ENDPOINT: endpoint,
            S3_ACCESS_KEY_ID: credentials.accessKeyId,
            S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
            S3_FORCE_PATH_STYLE: 'true',
          },
        }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /policy applied/);
      assert.match(result.stdout, /MINIO_API_STALE_UPLOADS_EXPIRY=24h/);
    });
    await t.test('repeat setup preserves versioning and exact safe expiry filters', async () => {
      await setupBucket({ bucket: Bucket, client, backend: 'minio' });
      assert.equal(
        (await client.send(new GetBucketVersioningCommand({ Bucket }))).Status,
        'Enabled'
      );
      const { Rules } = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
      assert.equal(Rules.length, 4);
      for (const [prefix, days] of [
        ['tmp/', 1],
        ['uploads/', 1],
        ['previews/', 7],
        ['superseded/', 90],
      ]) {
        const rule = Rules.find((r) => r.Filter?.And?.Prefix === prefix);
        assert.deepEqual(rule.Filter.And.Tags, [{ Key: 'legal-hold', Value: 'false' }]);
        assert.equal(rule.Expiration.Days, days);
        assert.equal(rule.NoncurrentVersionExpiration.NoncurrentDays, days);
        assert.equal(rule.NoncurrentVersionExpiration.NewerNoncurrentVersions, 5);
      }
      assert.ok(Rules.every((r) => !r.Transitions && !r.NoncurrentVersionTransitions));
    });
    await t.test(
      'tags are version-specific and setup does not reclassify existing versions',
      async () => {
        const Key = 'uploads/history.txt';
        const held = await client.send(
          new PutObjectCommand({ Bucket, Key, Body: 'held', Tagging: 'legal-hold=true' })
        );
        const eligible = await client.send(
          new PutObjectCommand({ Bucket, Key, Body: 'eligible', Tagging: 'legal-hold=false' })
        );
        const unknown = await client.send(
          new PutObjectCommand({ Bucket, Key, Body: 'unclassified' })
        );
        await setupBucket({ bucket: Bucket, client, backend: 'minio' });
        for (const [version, tags] of [
          [held, [{ Key: 'legal-hold', Value: 'true' }]],
          [eligible, [{ Key: 'legal-hold', Value: 'false' }]],
          [unknown, []],
        ]) {
          assert.deepEqual(
            (
              await client.send(
                new GetObjectTaggingCommand({ Bucket, Key, VersionId: version.VersionId })
              )
            ).TagSet,
            tags
          );
        }
        assert.equal(
          (await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: Key }))).Versions
            .length,
          3
        );
      }
    );
  } finally {
    client?.destroy();
    spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' });
  }
});
