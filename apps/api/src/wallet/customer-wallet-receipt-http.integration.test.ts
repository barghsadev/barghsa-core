import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const { S3Client, CreateBucketCommand, PutObjectCommand } = requireShared('@aws-sdk/client-s3') as {
  S3Client: new (config: Record<string, unknown>) => {
    send(command: unknown): Promise<unknown>;
    destroy(): void;
  };
  CreateBucketCommand: new (input: { Bucket: string }) => unknown;
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
  }) => unknown;
};
let minio: StartedTestContainer;
let s3: InstanceType<typeof S3Client>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let image: Buffer;
const pdfAvailable = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' }).status === 0;

beforeAll(async () => {
  minio = await new GenericContainer(
    'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'
  )
    .withEnvironment({ MINIO_ROOT_USER: 'test-only-key', MINIO_ROOT_PASSWORD: 'test-only-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'test-evidence' }));
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, endpoint);
  image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();
}, 60000);
afterAll(async () => {
  try {
    await http?.close();
  } finally {
    s3?.destroy();
    await minio?.stop();
  }
}, 30000);

async function seed(roles?: string[]) {
  const owner = randomUUID(),
    user = roles ? randomUUID() : owner,
    profile = randomUUID(),
    session = randomUUID();
  for (const id of new Set([owner, user]))
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture-only')",
      [id]
    );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES($1,$2,'LEGAL','ACTIVE')",
    [profile, owner]
  );
  for (const role of roles ?? [])
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,$3)', [
      profile,
      user,
      role,
    ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$1,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [session, user]
  );
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
    user,
    profile,
  ]);
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  const headers = { Cookie: `barghsa_session=${session}` };
  const read = (id: string, kind = 'preview', scope: string = profile) =>
    fetch(`${http.base}/api/wallet/${scope}/bank-receipt-top-ups/${id}/${kind}`, {
      headers,
      redirect: 'manual',
    });
  return { user, profile, session, headers, read };
}
async function receipt(
  f: Awaited<ReturnType<typeof seed>>,
  options: {
    mime?: string | null;
    bytes?: Buffer | null;
    storageStatus?: string;
    state?: string;
    type?: string;
    channel?: string;
    credit?: boolean;
    legacy?: boolean;
  } = {}
) {
  const id = randomUUID(),
    key = `sealed-receipts/${id}`;
  const mime = options.mime === undefined ? 'image/png' : options.mime;
  const bytes = options.bytes === undefined ? image : options.bytes;
  if (bytes)
    await s3.send(
      new PutObjectCommand({
        Bucket: 'test-evidence',
        Key: key,
        Body: bytes,
        ContentType: mime ?? 'application/octet-stream',
      })
    );
  await http.pool.query(
    'INSERT INTO storage_records(storage_key,status,content_type) VALUES($1,$2,$3)',
    [key, options.storageStatus ?? 'immutable', mime]
  );
  const metadata = {
    channel: options.channel ?? 'bank_receipt',
    receipt: {
      attachmentKey: options.legacy ? key : 'unsealed-original-do-not-read',
      paymentDate: '2026-09-01',
    },
    ...(options.credit ? { pendingTransactionId: randomUUID() } : {}),
  };
  await http.pool.query(
    'INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,receipt_attachment_key,metadata) VALUES($1::uuid,$2,$3,100,$4,$1::text,$5,$6::jsonb)',
    [
      id,
      f.profile,
      options.type ?? 'topup',
      options.state ?? 'Pending',
      options.legacy ? null : key,
      JSON.stringify(metadata),
    ]
  );
  return { id, key, bytes };
}

it.each(['image/png', 'image/jpeg', 'image/webp'])(
  'serves bounded private PNG bytes and the exact sealed original: %s',
  async (mime) => {
    const f = await seed();
    const bytes =
      mime === 'image/png'
        ? image
        : mime === 'image/jpeg'
          ? await sharp(image).jpeg().toBuffer()
          : await sharp(image).webp().toBuffer();
    const r = await receipt(f, { mime, bytes });
    const response = await f.read(r.id);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('location')).toBeNull();
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const dimensions = await sharp(png).metadata();
    expect(Math.max(dimensions.width!, dimensions.height!)).toBeLessThanOrEqual(640);
    expect(Buffer.from(await (await f.read(r.id)).arrayBuffer())).toEqual(png);
    const original = await f.read(r.id, 'attachment');
    expect(original.status).toBe(302);
    expect(original.headers.get('cache-control')).toContain('private');
    expect(original.headers.get('cache-control')).toContain('no-store');
    expect(original.headers.get('referrer-policy')).toBe('no-referrer');
    const url = new URL(original.headers.get('location')!);
    expect(url.pathname).toContain(r.key);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(Buffer.from(await (await fetch(url)).arrayBuffer())).toEqual(bytes);
    const foreign = await seed();
    for (const kind of ['preview', 'attachment'])
      expect((await foreign.read(r.id, kind)).status).toBe(404);
  }
);

it.skipIf(!pdfAvailable)(
  'renders the first PDF page and retains all original pages',
  async () => {
    const f = await seed();
    const pdf = new PDFDocument();
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) =>
      pdf.on('end', () => resolve(Buffer.concat(chunks)))
    );
    pdf.text('First receipt page');
    pdf.addPage().text('Second receipt page');
    pdf.end();
    const bytes = await done;
    const r = await receipt(f, { mime: 'application/pdf', bytes });
    const response = await f.read(r.id);
    expect(response.status).toBe(200);
    const dimensions = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(dimensions.format).toBe('png');
    expect(Math.max(dimensions.width!, dimensions.height!)).toBeLessThanOrEqual(640);
    const original = await f.read(r.id, 'attachment');
    expect(original.status).toBe(302);
    expect(
      Buffer.from(await (await fetch(original.headers.get('location')!)).arrayBuffer())
    ).toEqual(bytes);
  },
  15000
);

it.each(['Pending', 'Released', 'Rejected'])(
  'keeps the original receipt readable after its decision: %s',
  async (state) => {
    const f = await seed();
    const r = await receipt(f, { state });
    for (const kind of ['preview', 'attachment'])
      expect((await f.read(r.id, kind)).status).toBe(kind === 'preview' ? 200 : 302);
  }
);
it.each([{ state: 'Completed' }, { credit: true }, { type: 'payment' }, { channel: 'online' }])(
  'never treats other ledger entries as bank receipts: %s',
  async (options) => {
    const f = await seed();
    const r = await receipt(f, options);
    for (const kind of ['preview', 'attachment'])
      expect((await f.read(r.id, kind)).status).toBe(404);
  }
);
it.each(['Finance', 'Manager', 'Legal'])(
  'uses the current wallet-view grant and honors its removal: %s',
  async (role) => {
    const f = await seed([role]);
    const r = await receipt(f);
    const allowed = role !== 'Legal';
    for (const kind of ['preview', 'attachment'])
      expect((await f.read(r.id, kind)).status).toBe(
        allowed ? (kind === 'preview' ? 200 : 302) : 404
      );
    await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
      f.profile,
      f.user,
    ]);
    for (const kind of ['preview', 'attachment'])
      expect((await f.read(r.id, kind)).status).toBe(404);
  }
);
it('rejects wrong profiles, inactive context, archived profiles, missing/invalid IDs and expired sessions', async () => {
  const f = await seed(),
    other = await seed();
  const r = await receipt(f);
  for (const kind of ['preview', 'attachment']) {
    expect((await f.read(r.id, kind, other.profile)).status).toBe(404);
    expect((await f.read(randomUUID(), kind)).status).toBe(404);
    expect((await f.read('invalid', kind)).status).toBe(400);
    expect((await f.read(r.id, kind, 'invalid')).status).toBe(400);
    expect(
      (await fetch(`${http.base}/api/wallet/${f.profile}/bank-receipt-top-ups/${r.id}/${kind}`))
        .status
    ).toBe(401);
    expect((await f.read(r.id.toUpperCase(), kind, f.profile.toUpperCase())).status).toBe(
      kind === 'preview' ? 200 : 302
    );
  }
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Finance')",
    [other.profile, f.user]
  );
  await http.pool.query('UPDATE user_profile_contexts SET profile_id=$2 WHERE user_id=$1', [
    f.user,
    other.profile,
  ]);
  for (const kind of ['preview', 'attachment']) expect((await f.read(r.id, kind)).status).toBe(404);
  await http.pool.query('UPDATE user_profile_contexts SET profile_id=$2 WHERE user_id=$1', [
    f.user,
    f.profile,
  ]);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  for (const kind of ['preview', 'attachment']) expect((await f.read(r.id, kind)).status).toBe(404);
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [f.profile]);
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1",
    [f.session]
  );
  for (const kind of ['preview', 'attachment']) expect((await f.read(r.id, kind)).status).toBe(401);
});
it('supports legacy sealed metadata and keeps missing MIME original files available', async () => {
  const f = await seed();
  const r = await receipt(f, { legacy: true, mime: null });
  expect((await f.read(r.id)).status).toBe(503);
  expect((await f.read(r.id, 'attachment')).status).toBe(302);
  await http.pool.query("UPDATE storage_records SET status='removed' WHERE storage_key=$1", [
    r.key,
  ]);
  for (const kind of ['preview', 'attachment']) expect((await f.read(r.id, kind)).status).toBe(503);
});
it.each([
  { mime: 'text/plain' },
  { bytes: Buffer.from('corrupt receipt') },
  { bytes: null },
  { storageStatus: 'active' },
])(
  'returns a controlled unavailable preview for invalid or unavailable evidence: %s',
  async (options) => {
    const f = await seed();
    const r = await receipt(f, options);
    const response = await f.read(r.id);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(r.key);
  }
);
it('caps cached PNG reads even when a stored derivative is oversized', async () => {
  const f = await seed();
  const r = await receipt(f);
  const hash = createHash('sha256').update(r.key).digest('hex');
  const cache = `previews/wallet-receipt-${r.id}/${hash}-${Math.floor(Date.now() / 86400000)}.png`;
  await s3.send(
    new PutObjectCommand({
      Bucket: 'test-evidence',
      Key: cache,
      Body: Buffer.alloc(5 * 1024 * 1024 + 1),
      ContentType: 'image/png',
    })
  );
  expect((await f.read(r.id)).status).toBe(503);
});
