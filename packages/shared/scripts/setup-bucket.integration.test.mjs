import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import {
  S3Client,
  CreateBucketCommand,
  GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  ListObjectVersionsCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../dist/storage/s3-storage-provider.js';
import { setupBucket } from '../dist/storage/setup-bucket.js';
import { encryptStorageSecret, runtimeStorageProvider } from '../dist/storage/runtime-config.js';

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
        'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372',
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
      assert.match(result.stdout, /MINIO_API_STALE_UPLOADS_EXPIRY=168h/);
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
      await t.test(
        'complete file facade preserves exact bytes, receipts, signed headers and current runtime routing',
        async () => {
          const previous = process.env.STORAGE_CONFIG_ENCRYPTION_KEY;
          process.env.STORAGE_CONFIG_ENCRYPTION_KEY = randomUUID();
          const runtime = runtimeStorageProvider(async () => ({
            endpoint,
            privateEndpointUrl: endpoint,
            publicEndpointUrl: endpoint,
            region: 'us-east-1',
            bucket: Bucket,
            accessKeyId: credentials.accessKeyId,
            forcePathStyle: true,
            encryptedSecret: encryptStorageSecret(credentials.secretAccessKey),
          }));
          try {
            const key = 'facade/فایل #?%.bin';
            const bytes = Buffer.alloc(6 * 1024 * 1024 + 123, 37);
            const receipt = await runtime.upload(
              Readable.from([bytes]),
              key,
              'application/octet-stream',
              bytes.length
            );
            assert.equal(receipt.key, key);
            assert.ok(receipt.etag);
            assert.deepEqual(
              Buffer.from(
                await new Response(Readable.toWeb(await runtime.download(key))).arrayBuffer()
              ),
              bytes
            );
            assert.equal(await runtime.objectExists(key), true);
            await runtime.copy(key, 'facade/copy.bin');
            assert.deepEqual(
              Buffer.from(
                await new Response(
                  Readable.toWeb(await runtime.download('facade/copy.bin'))
                ).arrayBuffer()
              ),
              bytes
            );
            const download = await runtime.getSignedUrl('facade/copy.bin', 'download', 60);
            assert.equal(download.method, 'GET');
            assert.deepEqual(Buffer.from(await (await fetch(download.url)).arrayBuffer()), bytes);
            const upload = await runtime.getSignedUrl('facade/signed.txt', 'upload', 60);
            assert.equal(
              (
                await fetch(upload.url, {
                  method: upload.method,
                  headers: upload.headers,
                  body: 'original',
                })
              ).status,
              200
            );
            assert.equal(
              (
                await fetch(upload.url, {
                  method: upload.method,
                  headers: upload.headers,
                  body: 'changed',
                })
              ).status,
              412
            );
            await runtime.deleteObjects([key, 'facade/copy.bin', 'facade/missing.bin']);
            assert.equal(await runtime.objectExists(key), false);
            assert.equal(await runtime.objectExists('facade/copy.bin'), false);
            await runtime.delete('facade/signed.txt');
            assert.equal(await runtime.objectExists('facade/signed.txt'), false);
            runtime.destroy();
            await assert.rejects(runtime.objectExists(key), /configuration is unavailable/);
          } finally {
            runtime.destroy();
            if (previous === undefined) delete process.env.STORAGE_CONFIG_ENCRYPTION_KEY;
            else process.env.STORAGE_CONFIG_ENCRYPTION_KEY = previous;
          }
        }
      );
      for (const delta of [-1, 1]) {
        await t.test(
          `declared multipart size mismatch ${delta} aborts all unfinished parts without publishing bytes`,
          async () => {
            const key = `size-mismatch-${delta}.bin`;
            let finishPart;
            const firstPart = new Promise((resolve) => {
              finishPart = resolve;
            });
            const commands = [];
            const send = provider.client.send.bind(provider.client);
            const tracked = t.mock.method(provider.client, 'send', async (command, ...args) => {
              commands.push(command.constructor.name);
              const result = await send(command, ...args);
              if (command.constructor.name === 'UploadPartCommand') finishPart();
              return result;
            });
            let started = false;
            const size = 6 * 1024 * 1024 + 1;
            const body = new ReadableStream({
              async pull(controller) {
                if (!started) {
                  started = true;
                  controller.enqueue(Buffer.alloc(5 * 1024 * 1024 + 1, 42));
                } else {
                  let timeout;
                  try {
                    await Promise.race([
                      firstPart,
                      new Promise((_, reject) => {
                        timeout = setTimeout(
                          () => reject(new Error('first multipart part was not sent')),
                          5000
                        );
                      }),
                    ]);
                  } finally {
                    clearTimeout(timeout);
                  }
                  controller.enqueue(Buffer.alloc(1024 * 1024, 42));
                  controller.close();
                }
              },
            });
            try {
              await assert.rejects(
                provider.upload(body, key, 'application/octet-stream', size + delta),
                /not confirmed/
              );
              for (const name of [
                'CreateMultipartUploadCommand',
                'UploadPartCommand',
                'AbortMultipartUploadCommand',
              ])
                assert.ok(commands.includes(name), name);
              assert.ok(!commands.includes('CompleteMultipartUploadCommand'));
            } finally {
              tracked.mock.restore();
            }
            assert.equal(await provider.objectExists(key), false);
            const result = await client.send(
              new ListMultipartUploadsCommand({ Bucket, Prefix: `provider/${key}` })
            );
            assert.equal(result.Uploads?.length ?? 0, 0);
          }
        );
      }
      await t.test(
        'copy retains hold tags and logical batch delete preserves held historical versions',
        async () => {
          const key = 'provider/ops/held.txt';
          const original = await client.send(
            new PutObjectCommand({
              Bucket,
              Key: key,
              Body: 'held source',
              Tagging: 'legal-hold=true',
            })
          );
          await provider.copy('ops/held.txt', 'ops/copied.txt');
          assert.deepEqual(
            (
              await client.send(
                new GetObjectTaggingCommand({ Bucket, Key: 'provider/ops/copied.txt' })
              )
            ).TagSet,
            [{ Key: 'legal-hold', Value: 'true' }]
          );
          await provider.deleteObjects(['ops/held.txt', 'ops/copied.txt']);
          assert.equal(await provider.objectExists('ops/held.txt'), false);
          const history = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: key }));
          assert.ok(
            history.Versions.some((v) => v.Key === key && v.VersionId === original.VersionId)
          );
          const retained = await client.send(
            new GetObjectCommand({ Bucket, Key: key, VersionId: original.VersionId })
          );
          assert.equal(await retained.Body.transformToString(), 'held source');
          assert.deepEqual(
            (
              await client.send(
                new GetObjectTaggingCommand({ Bucket, Key: key, VersionId: original.VersionId })
              )
            ).TagSet,
            [{ Key: 'legal-hold', Value: 'true' }]
          );
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
