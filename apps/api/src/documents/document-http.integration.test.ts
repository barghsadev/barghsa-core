import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from '../contract/contract.service.js';
import type { DocumentService } from './document.service.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
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
const headers: Record<string, Record<string, string>> = {};
const pdf = Buffer.from('%PDF-1.7\nDocument fixture\n%%EOF');
type Created = Awaited<ReturnType<DocumentService['create']>>;
type DocumentDto = Awaited<ReturnType<DocumentService['confirm']>>;
type DocumentDetail = Awaited<ReturnType<DocumentService['get']>>;
type DocumentList = Awaited<ReturnType<DocumentService['list']>>;
type DocumentDownload = Awaited<ReturnType<DocumentService['download']>>;
type ContractDto = Awaited<ReturnType<ContractService['get']>>;

beforeAll(async () => {
  minio = await new GenericContainer(
    'quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e'
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
function send(path: string, user: string, method = 'GET', body?: unknown) {
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
