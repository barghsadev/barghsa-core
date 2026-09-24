import { contractReviewConfirmation } from '../test/contract-review-confirmation.js';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { StorageProvider } from '@barghsa/shared/storage';
import PDFDocument from 'pdfkit';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from '../contract/contract.service.js';
import type { DocumentService } from './document.service.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const requireWorker = createRequire(resolve(__dirname, '../../../worker/package.json'));
const { S3Client, CreateBucketCommand } = requireShared('@aws-sdk/client-s3') as {
  S3Client: new (config: Record<string, unknown>) => {
    send(command: unknown): Promise<unknown>;
    destroy(): void;
  };
  CreateBucketCommand: new (input: { Bucket: string }) => unknown;
};
let minio: StartedTestContainer;
let s3: InstanceType<typeof S3Client>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let storageEndpoint: string;
const headers: Record<string, Record<string, string>> = {};
let pdf: Buffer;
const pdfRendererAvailable = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' }).status === 0;
type Created = Awaited<ReturnType<DocumentService['create']>> & {
  upload: { presignedUrl: string; headers: Record<string, string> };
};
type DocumentDto = Awaited<ReturnType<DocumentService['confirm']>>;
type DocumentDetail = Awaited<ReturnType<DocumentService['get']>>;
type DocumentList = Awaited<ReturnType<DocumentService['list']>>;
type DocumentDownload = Awaited<ReturnType<DocumentService['download']>>;
type ContractDto = Awaited<ReturnType<ContractService['get']>>;

beforeAll(async () => {
  const pdfDocument = new PDFDocument();
  const chunks: Buffer[] = [];
  pdfDocument.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve) =>
    pdfDocument.on('end', () => resolve(Buffer.concat(chunks)))
  );
  pdfDocument.text('Document fixture');
  pdfDocument.end();
  pdf = await complete;
  minio = await new GenericContainer(
    'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'
  )
    .withEnvironment({ MINIO_ROOT_USER: 'test-only-key', MINIO_ROOT_PASSWORD: 'test-only-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  storageEndpoint = endpoint;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'test-evidence' }));
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, endpoint);
  await login('document-legal', 'role-legal-contracts');
  await login('document-finance', 'role-finance');
  await login('document-operations', 'role-operations');
}, 60000);
afterAll(async () => {
  try {
    await http?.close();
  } finally {
    s3?.destroy();
    await minio?.stop();
  }
}, 30000);

async function login(user: string = randomUUID(), role?: string) {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',$2)",
    [user, !!role]
  );
  if (role)
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')`,
    [session, user, csrf, randomUUID()]
  );
  headers[user] = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  return user;
}
async function send(path: string, user: string, method = 'GET', body?: unknown) {
  if (method === 'POST')
    body = await contractReviewConfirmation(http.base, path, headers[user]!, body);
  return fetch(http.base + '/api/' + path, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function owner() {
  const user = await login(),
    profile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,is_default) VALUES($1,$2,'LEGAL',true)",
    [profile, user]
  );
  return { user, profile };
}
async function create(user: string, extra: Record<string, unknown> = {}, staff = false) {
  const response = await send(staff ? 'admin/documents' : 'documents', user, 'POST', {
    businessRecordType: 'standalone',
    category: 'document',
    fileName: 'evidence.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    idempotencyKey: randomUUID(),
    ...extra,
  });
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(201);
  return (await response.json()) as Created;
}
async function upload(created: Created) {
  const result = await fetch(created.upload.presignedUrl, {
    method: 'PUT',
    headers: { ...created.upload.headers, 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  expect(result.status, await result.text()).toBe(200);
}
const command = (revision: number) => ({
  expectedRevision: revision,
  idempotencyKey: randomUUID(),
});
async function confirm(created: Created, user: string, staff = false) {
  await upload(created);
  const response = await send(
    `${staff ? 'admin/' : ''}documents/${created.document.id}/confirm`,
    user,
    'POST',
    command(1)
  );
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  return (await response.json()) as DocumentDto;
}
async function act(
  document: DocumentDto,
  action: string,
  user: string,
  staff = false,
  reason?: string
) {
  const response = await send(
    `${staff ? 'admin/' : ''}documents/${document.id}/${action}`,
    user,
    'POST',
    { ...command(document.revision), ...(reason ? { reason } : {}) }
  );
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  return (await response.json()) as DocumentDto;
}

it('resumes a large document upload and confirms the sealed document', async () => {
  const person = await owner();
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 83, 65);
  pdf.copy(bytes, 0, 0, Math.min(pdf.length, bytes.length));
  const response = await send('documents', person.user, 'POST', {
    businessRecordType: 'standalone',
    profileId: person.profile,
    category: 'document',
    fileName: 'large.pdf',
    contentType: 'application/pdf',
    fileSize: bytes.length,
    idempotencyKey: randomUUID(),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const created = (await response.json()) as {
    document: { id: string };
    upload: { uploadId: string; partSize: number; partCount: number };
  };
  expect(created.upload.partCount).toBe(2);
  const base = `v1/files/upload/${created.upload.uploadId}`;
  for (let number = 1; number <= 2; number++) {
    const part = await send(`${base}/part?partNumber=${number}`, person.user, 'PUT');
    expect(part.status, await part.clone().text()).toBe(200);
    const signed = (await part.json()) as { url: string };
    const start = (number - 1) * created.upload.partSize;
    const put = await fetch(signed.url, {
      method: 'PUT',
      body: bytes.subarray(start, Math.min(bytes.length, start + created.upload.partSize)),
    });
    expect(put.status, await put.text()).toBe(200);
  }
  expect((await send(`${base}/complete`, person.user, 'POST')).status).toBe(200);
  const confirmed = await send(
    `documents/${created.document.id}/confirm`,
    person.user,
    'POST',
    command(1)
  );
  expect(confirmed.status, await confirmed.clone().text()).toBe(200);
  expect(await confirmed.json()).toMatchObject({ state: 'Available' });
});

it('uploads real bytes, reviews a document, preserves replacement history and retains removed evidence', async () => {
  const f = await owner(),
    created = await create(f.user);
  expect(created.document).toMatchObject({
    state: 'Uploading',
    revision: 1,
    uploadedBy: f.user,
    uploadedByType: 'customer',
  });
  let document = await confirm(created, f.user);
  expect(document).toMatchObject({
    state: 'Available',
    revision: 3,
    scanState: 'Available',
    scanSkippedReason: 'not_configured',
    checksum: createHash('sha256').update(pdf).digest('hex'),
  });
  const download = (await (
    await send(`documents/${document.id}/download`, f.user)
  ).json()) as DocumentDownload;
  expect(await (await fetch(download.url)).text()).toBe(pdf.toString());
  if (pdfRendererAvailable) {
    const preview = (await (
      await send(`documents/${document.id}/preview`, f.user)
    ).json()) as DocumentDownload;
    expect((await fetch(preview.url)).headers.get('content-type')).toContain('image/png');
  }
  expect(
    (
      await fetch(created.upload.presignedUrl, {
        method: 'PUT',
        headers: created.upload.headers,
        body: Buffer.from('replacement'),
      })
    ).status
  ).toBe(412);
  document = await act(document, 'submit', f.user);
  document = await act(document, 'approve', 'document-legal', true);
  expect(document.state).toBe('Approved');
  const replacement = await create(f.user, { supersedesDocumentId: document.id });
  const current = await confirm(replacement, f.user);
  expect(current.supersedesDocumentId).toBe(document.id);
  const superseded = (await (
    await send(`documents/${document.id}`, f.user)
  ).json()) as DocumentDetail;
  expect(superseded.state).toBe('Superseded');
  expect(superseded.history.map((event: { state: string }) => event.state)).toEqual([
    'Uploading',
    'PendingScan',
    'Available',
    'SubmittedForReview',
    'Approved',
    'Superseded',
  ]);
  await act(superseded, 'remove', f.user);
  expect((await send(`documents/${document.id}`, f.user)).status).toBe(404);
  const retained = (await (
    await send(`admin/documents/${document.id}`, 'document-legal')
  ).json()) as DocumentDetail;
  expect(retained.state).toBe('Removed');
  const archive = (await (
    await send(`admin/documents/${document.id}/download`, 'document-legal')
  ).json()) as DocumentDownload;
  expect(await (await fetch(archive.url)).text()).toBe(pdf.toString());
  expect((await send(`admin/documents/${document.id}/preview`, 'document-legal')).status).toBe(409);
});

it('holds a configured-scanner upload in PendingScan with a durable worker job', async () => {
  const { runDocumentScans } = requireWorker('./dist/documents/scan-runner.js') as {
    runDocumentScans: (
      pool: typeof http.pool,
      storage: StorageProvider,
      endpoint: { host: string; port: number },
      scan: () => Promise<'clean' | 'infected'>
    ) => Promise<{ clean: number; infected: number; retrying: number }>;
  };
  const original = http;
  process.env['DOCUMENT_CLAMAV_HOST'] = '127.0.0.1';
  const configured = await startHttpFixture(process.env.TEST_DATABASE_URL!, storageEndpoint);
  http = configured;
  try {
    const admin = await login();
    await http.pool.query('UPDATE users SET is_staff=true,is_admin=true WHERE user_id=$1', [admin]);
    const f = await owner();
    const created = await create(f.user);
    const pending = await confirm(created, f.user);
    expect(pending).toMatchObject({
      state: 'PendingScan',
      scanState: 'Pending',
      scanSkippedReason: null,
      checksum: createHash('sha256').update(pdf).digest('hex'),
    });
    expect((await send(`documents/${pending.id}/download`, f.user)).status).toBe(409);
    const job = await http.pool.query(
      'SELECT attempts,completed_at FROM document_scan_jobs WHERE document_id=$1',
      [pending.id]
    );
    expect(job.rows).toMatchObject([{ attempts: 0, completed_at: null }]);
    const storage = {
      getObject: async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(pdf);
            controller.close();
          },
        }),
        contentLength: pdf.length,
      }),
    } as unknown as StorageProvider;
    const endpoint = { host: '127.0.0.1', port: 3310 };
    expect(await runDocumentScans(http.pool, storage, endpoint, async () => 'clean')).toMatchObject(
      {
        clean: 1,
      }
    );
    const available = (await (
      await send(`documents/${pending.id}`, f.user)
    ).json()) as DocumentDetail;
    expect(available).toMatchObject({ state: 'Available', scanState: 'Available' });
    expect((await send(`documents/${pending.id}/download`, f.user)).status).toBe(200);
    expect(
      (
        await http.pool.query(
          'SELECT verdict,attempts FROM document_scan_jobs WHERE document_id=$1',
          [pending.id]
        )
      ).rows
    ).toMatchObject([{ verdict: 'clean', attempts: 1 }]);
    const successor = await confirm(
      await create(f.user, { supersedesDocumentId: pending.id }),
      f.user
    );
    expect(await runDocumentScans(http.pool, storage, endpoint, async () => 'clean')).toMatchObject(
      {
        clean: 1,
      }
    );
    expect(
      ((await (await send(`documents/${pending.id}`, f.user)).json()) as DocumentDetail).state
    ).toBe('Superseded');
    expect(
      ((await (await send(`documents/${successor.id}`, f.user)).json()) as DocumentDetail).state
    ).toBe('Available');
    const infected = await confirm(await create(f.user), f.user);
    expect(
      await runDocumentScans(http.pool, storage, endpoint, async () => 'infected')
    ).toMatchObject({
      infected: 1,
    });
    const quarantined = (await (
      await send(`documents/${infected.id}`, f.user)
    ).json()) as DocumentDetail;
    expect(quarantined).toMatchObject({ state: 'Quarantined', scanState: 'Quarantined' });
    expect((await send(`documents/${infected.id}/download`, f.user)).status).toBe(409);
    expect(
      (
        await http.pool.query(
          "SELECT event_key FROM notification_outbox WHERE user_id=$1 AND event_key='document.quarantined'",
          [admin]
        )
      ).rows
    ).toHaveLength(1);
    const retrying = await confirm(await create(f.user), f.user);
    expect(
      await runDocumentScans(http.pool, storage, endpoint, async () => {
        throw new Error('scanner disconnected');
      })
    ).toMatchObject({ retrying: 1 });
    const retryJob = await http.pool.query(
      'SELECT attempts,completed_at,next_attempt_at>NOW() AS delayed FROM document_scan_jobs WHERE document_id=$1',
      [retrying.id]
    );
    expect(retryJob.rows).toMatchObject([{ attempts: 1, completed_at: null, delayed: true }]);
    expect((await send(`documents/${retrying.id}/download`, f.user)).status).toBe(409);
    for (let attempt = 0; attempt < 2; attempt++) {
      await http.pool.query(
        "UPDATE document_scan_jobs SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE document_id=$1",
        [retrying.id]
      );
      expect(
        await runDocumentScans(http.pool, storage, endpoint, async () => {
          throw new Error('scanner disconnected');
        })
      ).toMatchObject({ retrying: 1 });
    }
    expect(
      (
        await http.pool.query(
          "SELECT event_key FROM notification_outbox WHERE user_id=$1 AND event_key='document.scan_failed'",
          [admin]
        )
      ).rows
    ).toHaveLength(1);
  } finally {
    http = original;
    await configured.close();
    delete process.env['DOCUMENT_CLAMAV_HOST'];
  }
}, 60_000);

it('keeps document and profile legal holds auditable and applies versioned retention policies', async () => {
  const f = await owner();
  const document = await confirm(await create(f.user), f.user);
  expect((await send('admin/document-retention/policies', f.user)).status).toBe(403);
  expect(
    (
      await send('admin/document-retention/holds', f.user, 'POST', {
        documentId: document.id,
        reason: 'Unauthorized hold',
      })
    ).status
  ).toBe(403);
  const initial = await send('admin/document-retention/policies', 'document-legal');
  expect(initial.status).toBe(200);
  const defaults = (await initial.json()) as {
    canManage: boolean;
    policies: Array<{ businessRecordType: string; retentionYears: number }>;
  };
  expect(defaults.canManage).toBe(true);
  expect(
    defaults.policies.find((policy) => policy.businessRecordType === 'standalone')
  ).toMatchObject({
    retentionYears: 5,
  });
  const createDocumentHold = await send(
    'admin/document-retention/holds',
    'document-legal',
    'POST',
    {
      documentId: document.id,
      reason: 'Litigation preservation request',
    }
  );
  expect(createDocumentHold.status, await createDocumentHold.clone().text()).toBe(201);
  const directHold = (await createDocumentHold.json()) as { id: string; active: boolean };
  expect(directHold.active).toBe(true);
  await expect(
    http.pool.query('UPDATE document_legal_holds SET reason=$2 WHERE id=$1', [
      directHold.id,
      'Changed after creation',
    ])
  ).rejects.toThrow('Only a recorded release may change a legal hold');
  const holdsPath = `admin/document-retention/holds?documentId=${document.id}`;
  expect((await (await send(holdsPath, 'document-legal')).json()) as object).toMatchObject({
    held: true,
  });
  const release = await send(
    `admin/document-retention/holds/${directHold.id}/release`,
    'document-legal',
    'POST',
    { note: 'Litigation hold was lifted' }
  );
  expect(release.status, await release.clone().text()).toBe(200);
  expect((await (await send(holdsPath, 'document-legal')).json()) as object).toMatchObject({
    held: false,
  });
  const profileHold = await send('admin/document-retention/holds', 'document-legal', 'POST', {
    profileId: f.profile,
    reason: 'Profile-wide regulatory inquiry',
  });
  expect(profileHold.status, await profileHold.clone().text()).toBe(201);
  expect((await (await send(holdsPath, 'document-legal')).json()) as object).toMatchObject({
    held: true,
  });
  const profileHoldId = ((await profileHold.json()) as { id: string }).id;
  expect(
    (
      await send(
        `admin/document-retention/holds/${profileHoldId}/release`,
        'document-legal',
        'POST',
        {
          note: 'Inquiry completed',
        }
      )
    ).status
  ).toBe(200);
  const change = await send(
    'admin/document-retention/policies/standalone',
    'document-legal',
    'PUT',
    {
      retentionYears: 7,
      legalHold: true,
      approvalNote: 'Approved by legal for open records',
    }
  );
  expect(change.status, await change.clone().text()).toBe(200);
  const active = (await (
    await send('admin/document-retention/policies', 'document-legal')
  ).json()) as {
    policies: Array<{ businessRecordType: string; retentionYears: number; legalHold: boolean }>;
  };
  expect(
    active.policies.find((policy) => policy.businessRecordType === 'standalone')
  ).toMatchObject({
    retentionYears: 7,
    legalHold: true,
  });
  expect((await (await send(holdsPath, 'document-legal')).json()) as object).toMatchObject({
    held: true,
  });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM document_retention_policies WHERE business_record_type='standalone'"
      )
    ).rows[0].count
  ).toBe(2);
  expect(
    (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE event LIKE 'document_legal_hold_%' OR event='document_retention_policy_changed' ORDER BY created_at DESC LIMIT 5"
      )
    ).rows.map((row) => row.event)
  ).toContain('document_retention_policy_changed');
}, 60_000);

it('requires legal approval of an eligible destruction manifest and rechecks active holds', async () => {
  const f = await owner();
  const policy = await send(
    'admin/document-retention/policies/standalone',
    'document-legal',
    'PUT',
    { retentionYears: 5, legalHold: false, approvalNote: 'Approved default for closure test' }
  );
  expect(policy.status, await policy.clone().text()).toBe(200);
  const documentId = randomUUID();
  const uploadKey = `uploads/${documentId}`;
  const storageKey = `business-documents/${documentId}/hash`;
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status) VALUES($1,'active'),($2,'immutable')`,
    [uploadKey, storageKey]
  );
  const client = await http.pool.connect();
  try {
    await client.query('ALTER TABLE documents DISABLE TRIGGER document_lifecycle_guard');
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO documents(id,profile_id,business_record_type,category,state,scan_state,
        upload_key,storage_key,original_name,size_bytes,uploaded_by,uploaded_by_type,removed_at)
       VALUES($1,$2,'standalone','document','Removed','Available',$3,$4,'Old proof.pdf',123,$5,'customer',
         NOW()-INTERVAL '6 years')`,
      [documentId, f.profile, uploadKey, storageKey, f.user]
    );
    await client.query(
      `INSERT INTO document_events(document_id,revision,state,actor_id,reason)
       VALUES($1,1,'Removed',$2,'historical_fixture')`,
      [documentId, f.user]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query('ALTER TABLE documents ENABLE TRIGGER document_lifecycle_guard');
    client.release();
  }
  const manifest = await http.pool.query<{ id: string }>(
    `INSERT INTO document_destruction_items
      (document_id,profile_id,policy_id,storage_key,upload_key,retention_deadline)
     SELECT d.id,d.profile_id,e.policy_id,d.storage_key,d.upload_key,e.retention_deadline
     FROM documents d CROSS JOIN LATERAL document_retention_eligibility(d.id) e
     WHERE d.id=$1 RETURNING id`,
    [documentId]
  );
  const itemId = manifest.rows[0]!.id;
  const path = `admin/document-retention/destruction/${itemId}/approve`;
  expect((await send(path, f.user, 'POST', { note: 'Unauthorized' })).status).toBe(403);
  const hold = await send('admin/document-retention/holds', 'document-legal', 'POST', {
    documentId,
    reason: 'Preserve during a legal inquiry',
  });
  expect(hold.status).toBe(201);
  expect(
    (await send(path, 'document-legal', 'POST', { note: 'Legal review complete' })).status
  ).toBe(409);
  const holdId = ((await hold.json()) as { id: string }).id;
  expect(
    (
      await send(`admin/document-retention/holds/${holdId}/release`, 'document-legal', 'POST', {
        note: 'Inquiry closed',
      })
    ).status
  ).toBe(200);
  const approved = await send(path, 'document-legal', 'POST', {
    note: 'Expired evidence approved for destruction',
  });
  expect(approved.status, await approved.clone().text()).toBe(200);
  expect((await approved.json()) as object).toMatchObject({ id: itemId, status: 'approved' });
  expect((await send(path, 'document-legal', 'POST', { note: 'Repeated approval' })).status).toBe(
    409
  );
  const queue = await send('admin/document-retention/destruction', 'document-legal');
  expect(queue.status).toBe(200);
  expect((await queue.json()) as { items: Array<{ id: string; status: string }> }).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ id: itemId, status: 'approved' })]),
  });
}, 60_000);

it('lets a saving customer replace or soft-delete only their available order files', async () => {
  const f = await owner();
  const products = await http.pool.query<{ id: string; type: string }>(
    `INSERT INTO products(type,title,price,status)
     VALUES ('saving_plan','{"fa":"طرح","en":"Plan"}',100000,'active'),
            ('hardware','{"fa":"دستگاه","en":"Device"}',100000,'active')
     RETURNING id,type`
  );
  const plan = products.rows.find((row) => row.type === 'saving_plan')!.id;
  const hardware = products.rows.find((row) => row.type === 'hardware')!.id;
  const agreement = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO saving_plan_agreement_versions(plan_id,title,body,created_by)
     VALUES($1,'Terms','Agreement','document-legal') RETURNING id`,
      [plan]
    )
  ).rows[0]!.id;
  const province = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان آزمایشی','Test Province') RETURNING id"
    )
  ).rows[0]!.id;
  const city = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر آزمایشی','Test City') RETURNING id",
      [province]
    )
  ).rows[0]!.id;
  const address = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code)
     VALUES($1,$2,$3,'Test address','1234567890') RETURNING id`,
      [f.profile, province, city]
    )
  ).rows[0]!.id;
  const order = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO orders(user_id,profile_id,product_id,order_type,status,
       snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
     VALUES($1,$2,$3,'savings','PENDING',$4,$5,'Test address','1234567890') RETURNING id`,
      [f.user, f.profile, plan, province, city]
    )
  ).rows[0]!.id;
  await http.pool.query(
    `INSERT INTO saving_orders(order_id,profile_id,saving_plan_id,hardware_product_id,
       bill_identifier,installation_address_id,agreement_version_id,agreement_snapshot,
       address_snapshot,pricing_snapshot,verification_result,status)
     VALUES($1,$2,$3,$4,'1234567890123',$5,$6,'Agreement','{}','{}','{}','in_progress')`,
    [order, f.profile, plan, hardware, address, agreement]
  );

  const context = { profileId: f.profile, businessRecordType: 'order', businessRecordId: order };
  const first = await confirm(await create(f.user, context), f.user);
  const other = await confirm(await create(f.user, context), f.user);
  const video = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  const videoUpload = await create(f.user, {
    ...context,
    category: 'video',
    fileName: 'handover.mp4',
    contentType: 'video/mp4',
    fileSize: video.length,
  });
  const videoPut = await fetch(videoUpload.upload.presignedUrl, {
    method: 'PUT',
    headers: { ...videoUpload.upload.headers, 'Content-Type': 'video/mp4' },
    body: video,
  });
  expect(videoPut.status, await videoPut.text()).toBe(200);
  const videoConfirm = await send(
    `documents/${videoUpload.document.id}/confirm`,
    f.user,
    'POST',
    command(1)
  );
  expect(videoConfirm.status, (await videoConfirm.clone().text()) + http.logs()).toBe(200);
  expect(await videoConfirm.json()).toMatchObject({ category: 'video', state: 'Available' });
  const staffList = await send(
    `admin/documents?businessRecordType=order&businessRecordId=${order}&profileId=${f.profile}`,
    'document-legal'
  );
  expect(staffList.status, (await staffList.clone().text()) + http.logs()).toBe(200);
  expect((await send('admin/documents?businessRecordType=order', 'document-legal')).status).toBe(
    403
  );
  const staffUpload = await create('document-legal', context, true);
  expect((await confirm(staffUpload, 'document-legal', true)).state).toBe('Available');
  expect(first.state).toBe('Available');
  expect(other.state).toBe('Available');
  const replacement = await confirm(
    await create(f.user, {
      ...context,
      supersedesDocumentId: first.id,
    }),
    f.user
  );
  expect(replacement.supersedesDocumentId).toBe(first.id);
  expect((await send(`documents/${first.id}`, f.user)).status).toBe(200);
  const removed = await act(other, 'remove', f.user);
  expect(removed.state).toBe('Removed');
  expect((await send(`documents/${other.id}`, f.user)).status).toBe(404);
  expect((await send(`admin/documents/${other.id}`, 'document-operations')).status).toBe(200);
  const submitted = await act(replacement, 'submit', f.user);
  expect(
    (await send(`documents/${submitted.id}/remove`, f.user, 'POST', command(submitted.revision)))
      .status
  ).toBe(409);
});

it('requires a rejection reason, permits changes and resubmission, and blocks stale actions', async () => {
  const f = await owner();
  let document = await confirm(await create(f.user), f.user);
  const availableRevision = document.revision;
  document = await act(document, 'submit', f.user);
  expect(
    (
      await send(
        `admin/documents/${document.id}/reject`,
        'document-legal',
        'POST',
        command(document.revision)
      )
    ).status
  ).toBe(400);
  expect(
    (await send(`documents/${document.id}/submit`, f.user, 'POST', command(availableRevision)))
      .status
  ).toBe(409);
  document = await act(
    document,
    'request-changes',
    'document-legal',
    true,
    'Please check the attachment'
  );
  expect(document).toMatchObject({
    state: 'Available',
    reviewComment: 'Please check the attachment',
  });
  document = await act(document, 'submit', f.user);
  document = await act(document, 'reject', 'document-legal', true, 'Unreadable copy');
  expect(document).toMatchObject({ state: 'Rejected', rejectionReason: 'Unreadable copy' });
});

it('isolates profiles, enforces staff capabilities and blocks quarantined downloads', async () => {
  const f = await owner(),
    other = await owner();
  const document = await confirm(await create(f.user), f.user);
  expect((await send(`documents/${document.id}`, other.user)).status).toBe(404);
  expect((await send(`documents/${document.id}/download`, other.user)).status).toBe(404);
  expect((await send(`documents/${document.id}/preview`, other.user)).status).toBe(404);
  expect((await send(`admin/documents/${document.id}`, 'document-finance')).status).toBe(403);
  expect(
    (await send(`documents/${document.id}/approve`, f.user, 'POST', command(document.revision)))
      .status
  ).toBe(400);
  const quarantined = await act(
    document,
    'quarantine',
    'document-legal',
    true,
    'Suspicious content'
  );
  expect(quarantined).toMatchObject({ state: 'Quarantined', scanState: 'Quarantined' });
  expect((await send(`documents/${document.id}/download`, f.user)).status).toBe(409);
  expect((await send(`admin/documents/${document.id}/download`, 'document-legal')).status).toBe(
    409
  );
  const visible = (await (await send(`documents/${document.id}`, f.user)).json()) as DocumentDetail;
  expect(visible.reviewComment).toBeNull();
  expect(visible.history.at(-1)!.reason).toBeNull();
});

it('retries incomplete upload confirmation without duplicating records, events or copies', async () => {
  const f = await owner(),
    key = randomUUID();
  const first = await create(f.user, { idempotencyKey: key });
  expect(await create(f.user, { idempotencyKey: key })).toEqual(first);
  const request = command(1),
    path = `documents/${first.document.id}/confirm`;
  expect((await send(path, f.user, 'POST', request)).status).toBe(400);
  expect(await (await send(`documents/${first.document.id}`, f.user)).json()).toMatchObject({
    state: 'PendingScan',
    revision: 2,
  });
  await upload(first);
  const confirmed = await send(path, f.user, 'POST', request);
  expect(confirmed.status, await confirmed.clone().text()).toBe(200);
  const result = await confirmed.json();
  expect(await (await send(path, f.user, 'POST', request)).json()).toEqual(result);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM document_events WHERE document_id=$1',
        [first.document.id]
      )
    ).rows[0].count
  ).toBe(3);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM storage_records WHERE metadata->>'sourceKey'=$1",
        [first.upload.key]
      )
    ).rows[0].count
  ).toBe(1);
  expect(
    (await send(path, f.user, 'POST', { ...request, reason: 'different request' })).status
  ).toBe(409);
});

it('serializes original contract uploads and requires replacements to keep the document history', async () => {
  const f = await owner();
  const draft = await send('admin/contracts', 'document-legal', 'POST', {
    profileId: f.profile,
    serviceType: 'electricity',
    content: { text: 'Original terms' },
    changeDescription: 'Initial',
    idempotencyKey: randomUUID(),
  });
  expect(draft.status).toBe(201);
  const contract = (await draft.json()) as ContractDto;
  const input = {
    profileId: f.profile,
    businessRecordType: 'contract',
    businessRecordId: contract.id,
    contractVersionId: contract.currentVersionId,
    contractRole: 'original',
    category: 'document',
    fileName: 'original.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
  };
  const firstKey = randomUUID();
  const secondKey = randomUUID();
  const [first, competing] = await Promise.all([
    send('admin/documents', 'document-legal', 'POST', { ...input, idempotencyKey: firstKey }),
    send('admin/documents', 'document-legal', 'POST', {
      ...input,
      idempotencyKey: secondKey,
    }),
  ]);
  expect([first.status, competing.status].sort()).toEqual([201, 409]);
  const created = first.status === 201 ? first : competing;
  const root = (await created.json()) as Created;
  expect(
    (
      await http.pool.query(
        `SELECT count(*)::int AS count FROM contract_documents cd
         JOIN documents d ON d.id=cd.document_id
         WHERE cd.contract_version_id=$1 AND cd.role='original'
           AND d.supersedes_document_id IS NULL`,
        [contract.currentVersionId]
      )
    ).rows[0].count
  ).toBe(1);
  const replay = await send('admin/documents', 'document-legal', 'POST', {
    ...input,
    idempotencyKey: first.status === 201 ? firstKey : secondKey,
  });
  expect(replay.status).toBe(201);
  expect(((await replay.json()) as Created).document.id).toBe(root.document.id);
  const removed = await send(
    `admin/documents/${root.document.id}/remove`,
    'document-legal',
    'POST',
    command(1)
  );
  expect(removed.status, await removed.clone().text()).toBe(200);
  const nextRoot = await create('document-legal', input, true);
  expect(nextRoot.document.id).not.toBe(root.document.id);
  let original = await confirm(nextRoot, 'document-legal', true);
  original = await act(original, 'submit', 'document-legal', true);
  original = await act(original, 'reject', 'document-legal', true, 'Replace this copy');
  expect(original.state).toBe('Rejected');
  const replacement = await send('admin/documents', 'document-legal', 'POST', {
    ...input,
    idempotencyKey: randomUUID(),
    supersedesDocumentId: nextRoot.document.id,
  });
  expect(replacement.status, await replacement.clone().text()).toBe(201);
  expect(((await replacement.json()) as Created).document.supersedesDocumentId).toBe(
    nextRoot.document.id
  );
});

it('keeps internal contract documents private through reads, downloads and notifications', async () => {
  const f = await owner();
  const draft = await send('admin/contracts', 'document-legal', 'POST', {
    profileId: f.profile,
    serviceType: 'electricity',
    content: { text: 'Private draft' },
    changeDescription: 'Initial',
    idempotencyKey: randomUUID(),
  });
  expect(draft.status).toBe(201);
  const contract = (await draft.json()) as ContractDto;
  let original = await confirm(
    await create(
      'document-legal',
      {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: contract.id,
        contractVersionId: contract.currentVersionId,
        contractRole: 'original',
      },
      true
    ),
    'document-legal',
    true
  );
  original = await act(original, 'submit', 'document-legal', true);
  original = await act(original, 'approve', 'document-legal', true);
  expect((await send(`documents/${original.id}`, f.user)).status).toBe(404);
  expect((await send(`documents/${original.id}/download`, f.user)).status).toBe(404);
  expect(
    ((await (await send('documents?businessRecordType=contract', f.user)).json()) as DocumentList)
      .documents
  ).toEqual([]);
  expect(
    (
      await http.pool.query(
        'SELECT id FROM in_app_notifications WHERE recipient_user_id=$1 AND localized_content::text LIKE $2',
        [f.user, `%${original.id}%`]
      )
    ).rows
  ).toEqual([]);
  const versionCommand = () => ({
    expectedVersionId: contract.currentVersionId,
    idempotencyKey: randomUUID(),
  });
  expect(
    (
      await send(
        `admin/contracts/${contract.id}/submit`,
        'document-legal',
        'POST',
        versionCommand()
      )
    ).status
  ).toBe(200);
  expect(
    (
      await send(
        `admin/contracts/${contract.id}/publish`,
        'document-legal',
        'POST',
        versionCommand()
      )
    ).status
  ).toBe(200);
  expect((await send(`documents/${original.id}`, f.user)).status).toBe(200);
  const input = {
    profileId: f.profile,
    businessRecordType: 'contract',
    businessRecordId: contract.id,
    contractVersionId: contract.currentVersionId,
    contractRole: 'signed',
    category: 'document',
    fileName: 'signed.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    idempotencyKey: randomUUID(),
  };
  expect((await send('documents', f.user, 'POST', input)).status).toBe(409);
  expect(
    (await send(`contracts/${contract.id}/accept`, f.user, 'POST', versionCommand())).status
  ).toBe(200);
  let signedCopy = await confirm(await create(f.user, input), f.user);
  signedCopy = await act(signedCopy, 'submit', f.user);
  await act(signedCopy, 'approve', 'document-legal', true);
  expect(
    (await http.pool.query('SELECT state,signed_at FROM contracts WHERE id=$1', [contract.id]))
      .rows[0]
  ).toEqual({ state: 'Accepted', signed_at: null });

  // A replacement must keep both the exact version and document role.
  for (const [actor, staff, predecessor, role] of [
    ['document-legal', true, signedCopy.id, 'original'],
    [f.user, false, original.id, 'signed'],
  ] as const) {
    expect(
      (
        await send(staff ? 'admin/documents' : 'documents', actor, 'POST', {
          ...input,
          idempotencyKey: randomUUID(),
          contractRole: role,
          supersedesDocumentId: predecessor,
        })
      ).status
    ).toBe(409);
  }
  const nextVersion = randomUUID();
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE contracts SET state='Draft' WHERE id=$1", [contract.id]);
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,2,$3,'Amendment','document-legal')",
      [nextVersion, contract.id, JSON.stringify({ text: 'Amended contract' })]
    );
    await client.query(
      "UPDATE contracts SET current_version_id=$2,state='AwaitingStaffReview' WHERE id=$1",
      [contract.id, nextVersion]
    );
    await client.query(
      "INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,'document-legal')",
      [contract.id, nextVersion]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const nextDocument = await confirm(
    await create(
      'document-legal',
      {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: contract.id,
        contractVersionId: nextVersion,
        contractRole: 'original',
      },
      true
    ),
    'document-legal',
    true
  );
  for (const [actor, prefix] of [
    [f.user, 'documents'],
    ['document-legal', 'admin/documents'],
  ] as const) {
    const page = (await (
      await send(
        `${prefix}?businessRecordType=contract&businessRecordId=${contract.id}&contractVersionId=${nextVersion}`,
        actor
      )
    ).json()) as DocumentList;
    expect(page.documents.map((row) => row.id)).toEqual([nextDocument.id]);
    const previous = (await (
      await send(
        `${prefix}?businessRecordType=contract&businessRecordId=${contract.id}&contractVersionId=${contract.currentVersionId}`,
        actor
      )
    ).json()) as DocumentList;
    expect(previous.documents.map((row) => row.id).sort()).toEqual(
      [original.id, signedCopy.id].sort()
    );
    expect(
      (await send(`${prefix}?businessRecordType=contract&contractVersionId=invalid`, actor)).status
    ).toBe(400);
  }
  expect(
    (
      await send(`contracts/${contract.id}/accept`, f.user, 'POST', {
        expectedVersionId: nextVersion,
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(200);
  for (const [actor, staff] of [
    ['document-legal', true],
    [f.user, false],
  ] as const) {
    expect(
      (
        await send(staff ? 'admin/documents' : 'documents', actor, 'POST', {
          ...input,
          idempotencyKey: randomUUID(),
          contractVersionId: nextVersion,
          supersedesDocumentId: signedCopy.id,
        })
      ).status
    ).toBe(409);
  }
  expect(
    (await http.pool.query('SELECT state FROM documents WHERE id=$1', [signedCopy.id])).rows[0]
  ).toEqual({ state: 'Approved' });
  expect(
    (
      await http.pool.query('SELECT id FROM documents WHERE supersedes_document_id=$1', [
        signedCopy.id,
      ])
    ).rows
  ).toEqual([]);
});

it('attaches an amendment document to the pending version while locking the active base', async () => {
  const f = await owner();
  const draft = await send('admin/contracts', 'document-legal', 'POST', {
    profileId: f.profile,
    serviceType: 'savings',
    content: { text: 'Original agreement' },
    changeDescription: 'Initial',
    idempotencyKey: randomUUID(),
  });
  expect(draft.status).toBe(201);
  const contract = (await draft.json()) as ContractDto;
  const baseDocument = await confirm(
    await create(
      'document-legal',
      {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: contract.id,
        contractVersionId: contract.currentVersionId,
        contractRole: 'original',
      },
      true
    ),
    'document-legal',
    true
  );
  const versionCommand = (versionId: string) => ({
    expectedVersionId: versionId,
    idempotencyKey: randomUUID(),
  });
  expect(
    (
      await send(
        `admin/contracts/${contract.id}/submit`,
        'document-legal',
        'POST',
        versionCommand(contract.currentVersionId)
      )
    ).status
  ).toBe(200);
  expect(
    (
      await send(
        `admin/contracts/${contract.id}/publish`,
        'document-legal',
        'POST',
        versionCommand(contract.currentVersionId)
      )
    ).status
  ).toBe(200);
  expect(
    (
      await send(
        `contracts/${contract.id}/accept`,
        f.user,
        'POST',
        versionCommand(contract.currentVersionId)
      )
    ).status
  ).toBe(200);
  await http.pool.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
    contract.id,
    contract.currentVersionId,
  ]);
  expect(
    (
      await send('admin/documents', 'document-legal', 'POST', {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: contract.id,
        contractVersionId: contract.currentVersionId,
        contractRole: 'original',
        category: 'document',
        fileName: 'late.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(409);
  const proposal = await send(
    `admin/contracts/${contract.id}/amendments`,
    'document-legal',
    'POST',
    {
      ...versionCommand(contract.currentVersionId),
      content: { text: 'Revised agreement' },
      changeDescription: 'Updated term',
    }
  );
  expect(proposal.status, await proposal.clone().text()).toBe(201);
  const pending = ((await proposal.json()) as ContractDto).pendingAmendment!;
  let amendmentDocument = await confirm(
    await create(
      'document-legal',
      {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: contract.id,
        contractVersionId: pending.versionId,
        contractRole: 'amendment',
      },
      true
    ),
    'document-legal',
    true
  );
  amendmentDocument = await act(amendmentDocument, 'submit', 'document-legal', true);
  amendmentDocument = await act(amendmentDocument, 'approve', 'document-legal', true);
  expect((await send(`documents/${amendmentDocument.id}`, f.user)).status).toBe(404);
  expect((await send(`documents/${baseDocument.id}`, f.user)).status).toBe(200);
  expect(
    (
      await send(
        `admin/contracts/${contract.id}/amendments/publish`,
        'document-legal',
        'POST',
        versionCommand(pending.versionId)
      )
    ).status
  ).toBe(200);
  expect((await send(`documents/${amendmentDocument.id}`, f.user)).status).toBe(200);
  expect(
    (
      await send(
        `contracts/${contract.id}/accept`,
        f.user,
        'POST',
        versionCommand(pending.versionId)
      )
    ).status
  ).toBe(200);
  expect(
    (
      await http.pool.query(
        'SELECT document_id FROM contract_document_locks WHERE document_id=$1',
        [amendmentDocument.id]
      )
    ).rowCount
  ).toBe(1);
  expect(
    (
      await send('admin/documents', 'document-legal', 'POST', {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: contract.id,
        contractVersionId: pending.versionId,
        contractRole: 'amendment',
        category: 'document',
        fileName: 'late-amendment.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(409);
});

it('filters names and categories across authorized documents without treating search text as a wildcard', async () => {
  const f = await owner();
  const other = await owner();
  const named = await create(f.user, { fileName: 'Alpha 100% evidence.pdf' });
  await create(f.user, { fileName: 'Beta.pdf' });
  await create(f.user, {
    fileName: 'Alpha image.png',
    category: 'image',
    contentType: 'image/png',
  });
  await create(other.user, { fileName: 'Alpha 100% hidden.pdf' });
  const query = async (path: string, user = f.user) =>
    (await (await send(path, user)).json()) as DocumentList;
  expect((await query('documents?q=%25')).documents.map((row) => row.id)).toEqual([
    named.document.id,
  ]);
  expect(
    (await query('documents?q=ALPHA&category=document')).documents.map((row) => row.id)
  ).toEqual([named.document.id]);
  expect(
    (
      await query(
        `admin/documents?profileId=${f.profile}&q=alpha&category=document`,
        'document-legal'
      )
    ).documents.map((row) => row.id)
  ).toEqual([named.document.id]);
  expect((await query('documents?q=alpha&category=image')).documents).toHaveLength(1);
  expect((await send('documents?category=script', f.user)).status).toBe(400);
  expect((await send(`documents?q=${'x'.repeat(129)}`, f.user)).status).toBe(400);
});

it('exposes a staff queue across profiles and preserves customer pagination and archived audit access', async () => {
  const f = await owner();
  const one = await confirm(await create(f.user), f.user);
  await create(f.user);
  const submitted = await act(one, 'submit', f.user);
  const queue = (await (
    await send('admin/documents?state=SubmittedForReview', 'document-legal')
  ).json()) as DocumentList;
  expect(queue.documents.map((row: { id: string }) => row.id)).toContain(submitted.id);
  expect((await send('admin/documents', 'document-finance')).status).toBe(403);
  const page1 = (await (await send('documents?limit=1', f.user)).json()) as DocumentList;
  expect(page1.documents).toHaveLength(1);
  expect(page1.nextBefore).toEqual(expect.any(String));
  const page2 = (await (
    await send(`documents?limit=1&before=${page1.nextBefore}`, f.user)
  ).json()) as DocumentList;
  expect(page2.documents).toHaveLength(1);
  expect(page2.documents[0]!.id).not.toBe(page1.documents[0]!.id);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await send(`documents/${one.id}`, f.user)).status).toBe(404);
  expect((await send(`admin/documents/${one.id}`, 'document-legal')).status).toBe(200);
  expect(
    (
      await send(
        `admin/documents/${one.id}/approve`,
        'document-legal',
        'POST',
        command(submitted.revision)
      )
    ).status
  ).toBe(404);
});

it('rolls back review state, audit and notices when the notification write fails', async () => {
  const f = await owner();
  const document = await act(await confirm(await create(f.user), f.user), 'submit', f.user);
  await http.pool
    .query(`CREATE FUNCTION fail_document_notice() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected document notification failure'; END $$;
    CREATE TRIGGER fail_document_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_document_notice()`);
  try {
    expect(
      (
        await send(
          `admin/documents/${document.id}/approve`,
          'document-legal',
          'POST',
          command(document.revision)
        )
      ).status
    ).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_document_notice ON in_app_notifications; DROP FUNCTION fail_document_notice()'
    );
  }
  const current = (await (await send(`documents/${document.id}`, f.user)).json()) as DocumentDetail;
  expect(current).toMatchObject({ state: 'SubmittedForReview', revision: document.revision });
  expect(current.history.map((event: { state: string }) => event.state)).not.toContain('Approved');
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE metadata::jsonb->>'documentId'=$1 AND metadata::jsonb->>'state'='Approved'",
        [document.id]
      )
    ).rows
  ).toEqual([]);
  expect((await act(document, 'approve', 'document-legal', true)).state).toBe('Approved');
});

it('requires CSRF and fresh step-up before reserving document uploads', async () => {
  const f = await owner();
  const input = {
    businessRecordType: 'standalone',
    fileName: 'proof.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    idempotencyKey: randomUUID(),
  };
  const badHeaders = { ...headers[f.user] };
  delete badHeaders['X-CSRF-Token'];
  expect(
    (
      await fetch(http.base + '/api/documents', {
        method: 'POST',
        headers: badHeaders,
        body: JSON.stringify(input),
      })
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 day' WHERE user_id=$1",
    [f.user]
  );
  expect((await send('documents', f.user, 'POST', input)).status).toBe(403);
  expect(
    (
      await http.pool.query(
        "SELECT storage_key FROM storage_records WHERE metadata->>'uploadedBy'=$1",
        [f.user]
      )
    ).rows
  ).toEqual([]);
});

async function manager(profile: string) {
  const actor = await owner();
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Manager')",
    [profile, actor.user]
  );
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
    actor.user,
    profile,
  ]);
  return actor;
}

it('preserves the generic verification API and rejects changed upload context or declared bytes', async () => {
  const f = await owner(),
    created = await create(f.user);
  const key = encodeURIComponent(created.upload.key);
  expect(await (await send(`upload/${key}/verify`, f.user, 'POST', {})).json()).toMatchObject({
    exists: false,
    status: 'not_found',
  });
  await upload(created);
  expect(await (await send(`upload/${key}/verify`, f.user, 'POST', {})).json()).toMatchObject({
    exists: true,
    status: 'confirmed',
    detectedContentType: 'application/pdf',
  });
  expect(
    (await send(`upload/${key}/record`, f.user, 'POST', { purpose: 'ticket_attachment' })).status
  ).toBe(409);
  expect(
    (await send(`upload/${key}/record`, f.user, 'POST', { fileSize: pdf.length + 1 })).status
  ).toBe(400);
  expect(
    (await send(`upload/${key}/record`, f.user, 'POST', { profileId: randomUUID() })).status
  ).toBe(409);
  expect(
    (await send(`upload/${key}/record`, f.user, 'POST', { fileSize: pdf.length })).status
  ).toBe(200);
  expect((await send(`upload/${key}/record`, f.user, 'POST', {})).status).toBe(200);
  expect(
    (await send(`documents/${created.document.id}/confirm`, f.user, 'POST', command(1))).status
  ).toBe(200);
  for (const invalid of ['outside.pdf', 'uploads/unknown/x.pdf', 'uploads/document/a/b.pdf'])
    expect(
      (await send(`upload/${encodeURIComponent(invalid)}/verify`, f.user, 'POST', {})).status
    ).toBe(400);
});

it('rejects malformed business links, forged upload identity and unsupported categories before reservation', async () => {
  const f = await owner();
  const input = {
    businessRecordType: 'standalone',
    fileName: 'proof.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    idempotencyKey: randomUUID(),
  };
  for (const extra of [
    { businessRecordId: randomUUID() },
    { contractVersionId: randomUUID() },
    { businessRecordType: 'contract', businessRecordId: randomUUID() },
    { uploadedByType: 'staff' },
    { category: 'video' },
    { fileName: '' },
  ])
    expect((await send('documents', f.user, 'POST', { ...input, ...extra })).status).toBe(400);
  const uploadInput = {
    fileName: 'proof.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    category: 'document',
  };
  expect(
    (
      await send('upload/presigned-url', f.user, 'POST', {
        ...uploadInput,
        purpose: 'business_document',
      })
    ).status
  ).toBe(400);
  expect(
    (
      await send('upload/presigned-url', f.user, 'POST', {
        ...uploadInput,
        purpose: 'staff_business_document',
        profileId: f.profile,
      })
    ).status
  ).toBe(403);
  expect(
    (
      await send('upload/presigned-url', f.user, 'POST', {
        ...uploadInput,
        metadata: { recordId: randomUUID() },
      })
    ).status
  ).toBe(400);
  expect(
    (
      await send('upload/presigned-url', f.user, 'POST', {
        ...uploadInput,
        contentType: 'image/png',
      })
    ).status
  ).toBe(400);
  expect(
    (
      await send('upload/presigned-url', f.user, 'POST', {
        ...uploadInput,
        fileSize: 40 * 1024 * 1024,
      })
    ).status
  ).toBe(400);
  expect(
    (await http.pool.query('SELECT id FROM documents WHERE profile_id=$1', [f.profile])).rows
  ).toEqual([]);
});

it.each(['invoice', 'order'] as const)(
  'binds %s documents to the owning profile and the correct staff capability',
  async (kind) => {
    const f = await owner(),
      other = await owner(),
      recordId = randomUUID();
    if (kind === 'invoice') {
      await http.pool.query(
        "INSERT INTO invoices(id,profile_id,state,total_amount,issued_at,payable_from) VALUES($1,$2,'Unpaid',1000,NOW(),NOW())",
        [recordId, f.profile]
      );
    } else {
      const product = (
        await http.pool.query(
          `INSERT INTO products(type,title) VALUES('hardware','{"fa":"تست","en":"Test"}') RETURNING id`
        )
      ).rows[0].id;
      await http.pool.query(
        "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','p','c','address','1234567890')",
        [recordId, f.user, f.profile, product]
      );
    }
    const body = {
      businessRecordType: kind,
      businessRecordId: recordId,
      fileName: 'evidence.pdf',
      contentType: 'application/pdf',
      fileSize: pdf.length,
      idempotencyKey: randomUUID(),
    };
    expect((await send('documents', other.user, 'POST', body)).status).toBe(404);
    let document = await confirm(await create(f.user, body), f.user);
    expect((await send(`admin/documents/${document.id}`, 'document-legal')).status).toBe(403);
    document = await act(document, 'submit', f.user);
    const reviewer = kind === 'invoice' ? 'document-finance' : 'document-operations';
    expect((await act(document, 'approve', reviewer, true)).state).toBe('Approved');
    const listed = (await (
      await send(`documents?businessRecordType=${kind}&businessRecordId=${recordId}`, f.user)
    ).json()) as DocumentList;
    expect(listed.documents.map((row) => row.id)).toEqual([document.id]);
  }
);

it.each(['membership removed', 'profile archived'])(
  'rejects a submission after %s during a profile lock wait',
  async (change) => {
    const f = await owner(),
      agent = await manager(f.profile);
    const document = await confirm(await create(f.user), f.user);
    const blocker = await http.pool.connect();
    let response: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
      if (change === 'membership removed')
        await blocker.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
          f.profile,
          agent.user,
        ]);
      else await blocker.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      response = send(
        `documents/${document.id}/submit`,
        agent.user,
        'POST',
        command(document.revision)
      );
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pg_blocking_pids(pid) @> ARRAY[$1]::integer[] AND query LIKE '%archived FROM profiles%'",
                [pid]
              )
            ).rows.length,
          { timeout: 5000 }
        )
        .toBeGreaterThan(0);
      await blocker.query('COMMIT');
      expect((await response).status).toBe(404);
      expect(
        (await http.pool.query('SELECT state FROM documents WHERE id=$1', [document.id])).rows[0]
          .state
      ).toBe('Available');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await response;
    }
  }
);

it('rechecks original profile access before returning a cached confirmation', async () => {
  const f = await owner(),
    agent = await manager(f.profile);
  const created = await create(agent.user);
  await upload(created);
  const request = command(1),
    path = `documents/${created.document.id}/confirm`;
  expect((await send(path, agent.user, 'POST', request)).status).toBe(200);
  await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
    f.profile,
    agent.user,
  ]);
  await http.pool.query('UPDATE user_profile_contexts SET profile_id=$2 WHERE user_id=$1', [
    agent.user,
    agent.profile,
  ]);
  expect((await send(path, agent.user, 'POST', request)).status).toBe(404);
});

it('permits only one verified successor when different authorized uploaders race replacements', async () => {
  const f = await owner(),
    agent = await manager(f.profile);
  const original = await confirm(await create(f.user), f.user);
  const first = await create(f.user, { supersedesDocumentId: original.id });
  const second = await create(agent.user, { supersedesDocumentId: original.id });
  await Promise.all([upload(first), upload(second)]);
  const responses = await Promise.all([
    send(`documents/${first.document.id}/confirm`, f.user, 'POST', command(1)),
    send(`documents/${second.document.id}/confirm`, agent.user, 'POST', command(1)),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(
    (
      await http.pool.query(
        'SELECT id FROM documents WHERE supersedes_document_id=$1 AND storage_key IS NOT NULL',
        [original.id]
      )
    ).rows
  ).toHaveLength(1);
  expect(
    (await http.pool.query('SELECT state FROM documents WHERE id=$1', [original.id])).rows[0].state
  ).toBe('Superseded');
});

it('rejects mismatched bytes and permits abandoning the pending upload without creating a copy', async () => {
  const f = await owner(),
    created = await create(f.user);
  expect(
    (
      await fetch(created.upload.presignedUrl, {
        method: 'PUT',
        headers: created.upload.headers,
        body: Buffer.alloc(pdf.length),
      })
    ).status
  ).toBe(200);
  expect(
    (await send(`documents/${created.document.id}/confirm`, f.user, 'POST', command(1))).status
  ).toBe(400);
  const pending = (await (
    await send(`documents/${created.document.id}`, f.user)
  ).json()) as DocumentDetail;
  expect(pending.state).toBe('PendingScan');
  expect(
    (await http.pool.query('SELECT storage_key FROM documents WHERE id=$1', [pending.id])).rows[0]
      .storage_key
  ).toBeNull();
  expect((await act(pending, 'remove', f.user)).state).toBe('Removed');
});

it('retains cleanup intent after copy rollback and completes the same confirmation retry', async () => {
  const f = await owner(),
    created = await create(f.user);
  await upload(created);
  const request = command(1),
    path = `documents/${created.document.id}/confirm`;
  await http.pool
    .query(`CREATE FUNCTION fail_document_ready_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='document_state_changed' AND NEW.metadata::jsonb->>'state'='Available' THEN RAISE EXCEPTION 'injected ready audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_document_ready_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_document_ready_audit()`);
  try {
    expect((await send(path, f.user, 'POST', request)).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_document_ready_audit ON audit_log; DROP FUNCTION fail_document_ready_audit()'
    );
  }
  expect(
    (
      await http.pool.query('SELECT state,storage_key FROM documents WHERE id=$1', [
        created.document.id,
      ])
    ).rows[0]
  ).toEqual({ state: 'PendingScan', storage_key: null });
  const abandoned = (
    await http.pool.query(
      "SELECT status,metadata FROM storage_records WHERE metadata->>'sourceKey'=$1",
      [created.upload.key]
    )
  ).rows;
  expect(abandoned).toHaveLength(1);
  expect(abandoned[0]).toMatchObject({
    status: 'removed',
    metadata: { provisionalCopy: true, deletionRequested: true },
  });
  expect((await send(path, f.user, 'POST', request)).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT status FROM storage_records WHERE metadata->>'sourceKey'=$1 ORDER BY status",
        [created.upload.key]
      )
    ).rows
  ).toEqual([{ status: 'immutable' }, { status: 'removed' }]);
});
