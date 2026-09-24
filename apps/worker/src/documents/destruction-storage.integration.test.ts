import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3StorageProvider } from '@barghsa/shared/storage';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const sdk = requireShared('@aws-sdk/client-s3') as Record<string, new (input: object) => object>;
let minio: StartedTestContainer;
let provider: S3StorageProvider;
let client: { send(command: object): Promise<Record<string, unknown>>; destroy(): void };
const bucket = 'test-document-destruction';
const key = 'business-documents/test/exact-key';

beforeAll(async () => {
  minio = await new GenericContainer(
    'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'
  )
    .withEnvironment({ MINIO_ROOT_USER: 'test-only-key', MINIO_ROOT_PASSWORD: 'test-only-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const config = {
    endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    region: 'us-east-1',
    forcePathStyle: true,
    accessKeyId: 'test-only-key',
    secretAccessKey: 'test-only-secret',
  };
  client = new sdk['S3Client']!({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  }) as typeof client;
  await client.send(new sdk['CreateBucketCommand']!({ Bucket: bucket }));
  await client.send(
    new sdk['PutBucketVersioningCommand']!({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    })
  );
  provider = new S3StorageProvider({ ...config, bucket });
}, 60_000);
afterAll(async () => {
  provider?.destroy();
  client?.destroy();
  await minio?.stop();
});

it('refuses provider-held versions, then physically removes every version', async () => {
  await provider.putObject(key, 'first', 'text/plain');
  await provider.putObject(key, 'second', 'text/plain');
  const list = async () =>
    (await client.send(new sdk['ListObjectVersionsCommand']!({ Bucket: bucket, Prefix: key }))) as {
      Versions?: Array<{ Key: string; VersionId: string }>;
      DeleteMarkers?: Array<{ Key: string; VersionId: string }>;
    };
  const before = await list();
  const versions = before.Versions?.filter((version) => version.Key === key) ?? [];
  expect(versions).toHaveLength(2);
  await client.send(
    new sdk['PutObjectTaggingCommand']!({
      Bucket: bucket,
      Key: key,
      VersionId: versions[0]!.VersionId,
      Tagging: { TagSet: [{ Key: 'legal-hold', Value: 'true' }] },
    })
  );
  await expect(provider.deleteObjectVersions(key)).rejects.toThrow('provider hold');
  expect((await list()).Versions?.filter((version) => version.Key === key)).toHaveLength(2);
  await client.send(
    new sdk['PutObjectTaggingCommand']!({
      Bucket: bucket,
      Key: key,
      VersionId: versions[0]!.VersionId,
      Tagging: { TagSet: [{ Key: 'legal-hold', Value: 'false' }] },
    })
  );
  await expect(provider.deleteObjectVersions(key)).resolves.toBe(2);
  const after = await list();
  expect(after.Versions?.filter((version) => version.Key === key) ?? []).toHaveLength(0);
  expect(after.DeleteMarkers?.filter((marker) => marker.Key === key) ?? []).toHaveLength(0);
});
