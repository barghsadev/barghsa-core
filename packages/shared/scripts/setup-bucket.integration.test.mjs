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
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../dist/storage/s3-storage-provider.js';
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
    const provider = new S3StorageProvider({
      bucket: Bucket,
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      prefix: 'provider/',
      maxRetries: 1,
      requestTimeoutMs: 5000,
    });
    try {
      await t.test(
        'retention classification preserves held versions and unrelated keys across pages',
        async () => {
          await setupBucket({ bucket: Bucket, client, backend: 'minio', prefix: 'provider/' });
          const Key = 'provider/uploads/abandoned.txt';
          const held = [];
          for (const value of ['true', 'review']) {
            held.push(
              await client.send(
                new PutObjectCommand({
                  Bucket,
                  Key,
                  Body: value,
                  Tagging: `legal-hold=${value}&owner=audit`,
                })
              )
            );
          }
          for (let n = 0; n < 100; n++)
            await client.send(
              new PutObjectCommand({ Bucket, Key, Body: 'ordinary', Tagging: 'owner=audit' })
            );
          const sibling = Key + '.other';
          await client.send(new PutObjectCommand({ Bucket, Key: sibling, Body: 'keep' }));
          assert.deepEqual(await provider.scheduleExpiration('uploads/abandoned.txt'), {
            eligibleVersions: 100,
            heldVersions: 2,
          });
          assert.deepEqual(await provider.scheduleExpiration('uploads/abandoned.txt'), {
            eligibleVersions: 100,
            heldVersions: 2,
          });
          for (let i = 0; i < held.length; i++) {
            const tags = (
              await client.send(
                new GetObjectTaggingCommand({ Bucket, Key, VersionId: held[i].VersionId })
              )
            ).TagSet;
            assert.ok(
              tags.some((tag) => tag.Key === 'legal-hold' && tag.Value === ['true', 'review'][i])
            );
            assert.ok(tags.some((tag) => tag.Key === 'owner' && tag.Value === 'audit'));
          }
          const tags = (await client.send(new GetObjectTaggingCommand({ Bucket, Key }))).TagSet;
          assert.ok(tags.some((tag) => tag.Key === 'legal-hold' && tag.Value === 'false'));
          assert.ok(tags.some((tag) => tag.Key === 'owner' && tag.Value === 'audit'));
          assert.deepEqual(
            (await client.send(new GetObjectTaggingCommand({ Bucket, Key: sibling }))).TagSet,
            []
          );
          assert.equal(
            await new Response((await provider.getObject('uploads/abandoned.txt')).body).text(),
            'ordinary'
          );
          assert.equal(
            (await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: Key }))).Versions
              .length,
            103
          );
          await assert.rejects(
            provider.scheduleExpiration('contracts/protected.pdf'),
            /no configured expiration policy/
          );
          const rules = (await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket })))
            .Rules;
          assert.deepEqual(
            rules.map((r) => r.Filter.And.Prefix),
            ['provider/tmp/', 'provider/uploads/', 'provider/previews/', 'provider/superseded/']
          );
        }
      );
      for (const [kind, body] of [
        ['string', 'storage payload'],
        ['bytes', new TextEncoder().encode('storage payload')],
        ['blob', new Blob(['storage payload'])],
        ['stream', new Blob(['storage payload']).stream()],
      ]) {
        await t.test(`provider uploads and reads ${kind} bodies`, async () => {
          const key = `body-${kind}.txt`;
          await provider.putObject(key, body, 'text/plain', { purpose: 'audit' });
          const stored = await provider.getObject(key);
          assert.equal(await new Response(stored.body).text(), 'storage payload');
          assert.equal(stored.contentLength, 15);
          assert.equal(stored.metadata.purpose, 'audit');
        });
      }
      await t.test('unknown-length stream spans multiple parts without data loss', async () => {
        const bytes = new Uint8Array(6 * 1024 * 1024 + 123).fill(37);
        const body = new ReadableStream({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 65536)
              controller.enqueue(bytes.subarray(offset, offset + 65536));
            controller.close();
          },
        });
        await provider.putObject('multipart.bin', body, 'application/octet-stream');
        const result = await provider.getObject('multipart.bin');
        assert.deepEqual(new Uint8Array(await new Response(result.body).arrayBuffer()), bytes);
      });
      await t.test('failed source streams leave no incomplete multipart upload', async () => {
        let chunks = 0;
        const body = new ReadableStream({
          pull(controller) {
            if (++chunks > 7) controller.error(new Error('synthetic source failure'));
            else controller.enqueue(new Uint8Array(1024 * 1024));
          },
        });
        await assert.rejects(
          provider.putObject('failed.bin', body, 'application/octet-stream'),
          /synthetic source failure/
        );
        const result = await client.send(
          new ListMultipartUploadsCommand({ Bucket, Prefix: 'provider/failed.bin' })
        );
        assert.equal(result.Uploads?.length ?? 0, 0);
      });
      await t.test(
        'upload URL cannot replace bytes by replaying or stripping its condition',
        async () => {
          const url = await provider.presignedPutUrl('write-once.txt', 60);
          const write = (body, headers) => fetch(url, { method: 'PUT', body, headers });
          assert.equal((await write('original', { 'If-None-Match': '*' })).status, 200);
          assert.equal((await write('changed', { 'If-None-Match': '*' })).status, 412);
          assert.match(new URL(url).searchParams.get('X-Amz-SignedHeaders'), /if-none-match/);
          // MinIO reports a missing signed header as BadRequest.
          assert.equal((await write('changed', {})).status, 400);
          assert.equal((await write('changed', { 'If-None-Match': 'wrong' })).status, 403);
          assert.equal(
            await new Response((await provider.getObject('write-once.txt')).body).text(),
            'original'
          );
        }
      );
      await t.test(
        'private scoped direct PUT/GET and pagination work against storage',
        async () => {
          const put = await fetch(await provider.presignedPutUrl('direct.txt', 60), {
            method: 'PUT',
            headers: { 'If-None-Match': '*' },
            body: 'direct',
          });
          assert.equal(put.status, 200);
          const signed = await provider.presignedGetUrl('direct.txt', 60);
          assert.equal(await (await fetch(signed)).text(), 'direct');
          const anonymous = new URL(signed);
          anonymous.search = '';
          assert.equal((await fetch(anonymous)).status, 403);
          const tampered = new URL(signed);
          tampered.pathname = tampered.pathname.replace('direct.txt', 'body-string.txt');
          assert.equal((await fetch(tampered)).status, 403);
          const page = await provider.listObjects('', 1);
          assert.equal(page.items.length, 1);
          assert.equal(page.isTruncated, true);
          const next = await provider.listObjects('', 1, page.continuationToken);
          assert.notEqual(next.items[0].key, page.items[0].key);
          assert.ok(!page.items[0].key.startsWith('provider/'));
          await provider.deleteObject('direct.txt');
          await assert.rejects(provider.getObject('direct.txt'), { name: 'StorageObjectNotFound' });
        }
      );
    } finally {
      provider.destroy();
    }
  } finally {
    client?.destroy();
    spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' });
  }
});
