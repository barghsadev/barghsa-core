import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const { S3Client, CreateBucketCommand } = requireShared('@aws-sdk/client-s3') as {
  S3Client: new (config: Record<string, unknown>) => {
    send(command: unknown): Promise<unknown>;
    destroy(): void;
  };
  CreateBucketCommand: new (input: { Bucket: string }) => unknown;
};
const pdf = Buffer.from('%PDF-1.7\nSolar evidence\n%%EOF');
let minio: StartedTestContainer;
let s3: InstanceType<typeof S3Client>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
let requestId: string;
const headers: Record<string, Record<string, string>> = {};

function send(user: string, path: string, method = 'GET', body?: unknown) {
  return fetch(`${http.base}/api/${path}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function documentCreate(replaces?: string) {
  const response = await send('solar-buyer', 'documents', 'POST', {
    profileId,
    businessRecordType: 'solar_request',
    businessRecordId: requestId,
    category: 'document',
    fileName: 'solar-evidence.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    idempotencyKey: randomUUID(),
    ...(replaces ? { supersedesDocumentId: replaces } : {}),
  });
  expect(response.status, http.logs()).toBe(201);
  const result = (await response.json()) as {
    document: { id: string; revision: number };
    upload: { presignedUrl: string; headers: Record<string, string> };
  };
  const uploaded = await fetch(result.upload.presignedUrl, {
    method: 'PUT',
    headers: { ...result.upload.headers, 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  expect(uploaded.status, await uploaded.text()).toBe(200);
  const confirmed = await send('solar-buyer', `documents/${result.document.id}/confirm`, 'POST', {
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
  });
  expect(confirmed.status, http.logs()).toBe(200);
  return (await confirmed.json()) as { id: string; state: string; revision: number };
}

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
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('solar-review-staff','Solar reviewer','Test reviewer','["orders:read","orders:write","admin:catalogue:edit"]')`
  );
  for (const [user, staff] of [
    ['solar-buyer', false],
    ['solar-reviewer', true],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'solar-review-staff')",
        [user]
      );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  profileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('solar-buyer','INDIVIDUAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0]!.id;
  const created = await send('solar-buyer', 'solar/requests', 'POST', {
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    propertyForm: 'villa',
    structuralFrame: 'concrete',
    buildingCompletionDate: '2020-01-01',
    gridType: 'off_grid',
    agreementAccepted: true,
  });
  expect(created.status, http.logs()).toBe(201);
  requestId = ((await created.json()) as { requestId: string }).requestId;
}, 90_000);

afterAll(async () => {
  try {
    await http?.close();
  } finally {
    s3?.destroy();
    await minio?.stop();
  }
}, 30_000);

it('supports empty submission, editable guidance, per-file decisions, replacement lineage and postal handoff', async () => {
  const guidance = await send('solar-reviewer', 'admin/solar/document-guidance', 'PUT', {
    fa: 'مدارک محل را بارگذاری کنید.',
    en: 'Upload site documents.',
    suggestions: [{ fa: 'سند ملک', en: 'Property deed' }],
  });
  expect(guidance.status, http.logs()).toBe(200);
  expect(await (await send('solar-buyer', 'solar/document-guidance')).json()).toMatchObject({
    suggestions: [{ en: 'Property deed' }],
  });
  const empty = await send(
    'solar-buyer',
    `solar/requests/${requestId}/documents/complete`,
    'POST',
    {
      allDocumentsUploaded: true,
    }
  );
  expect(empty.status, http.logs()).toBe(200);
  expect(await empty.json()).toMatchObject({ status: 'documents_under_review' });
  const ask = await send(
    'solar-reviewer',
    `admin/solar/requests/${requestId}/documents/request-additional`,
    'POST',
    {
      description: 'Please upload a site ownership document.',
    }
  );
  expect(ask.status, http.logs()).toBe(200);
  const state = await send('solar-buyer', `solar/requests/${requestId}/documents`);
  expect(
    ((await state.json()) as { requestedDocuments: Array<{ description: string }> })
      .requestedDocuments
  ).toMatchObject([{ description: 'Please upload a site ownership document.' }]);
  const first = await documentCreate();
  expect(first.state).toBe('Available');
  const submitted = await send(
    'solar-buyer',
    `solar/requests/${requestId}/documents/complete`,
    'POST',
    {
      allDocumentsUploaded: true,
    }
  );
  expect(submitted.status, http.logs()).toBe(200);
  const staffList = await send('solar-reviewer', `admin/solar/requests/${requestId}/documents`);
  expect(staffList.status, http.logs()).toBe(200);
  const listed = (await staffList.json()) as {
    documents: Array<{ document_id: string; state: string; revision: number }>;
  };
  expect(listed.documents).toMatchObject([{ document_id: first.id, state: 'SubmittedForReview' }]);
  const rejected = await send(
    'solar-reviewer',
    `admin/solar/requests/${requestId}/documents/${first.id}/reject`,
    'POST',
    {
      expectedRevision: listed.documents[0]!.revision,
      reason: 'The scan is unclear',
    }
  );
  expect(rejected.status, http.logs()).toBe(200);
  const review = await send('solar-reviewer', `admin/solar/requests/${requestId}/documents`);
  expect(
    ((await review.json()) as { documents: Array<{ staff_status: string }> }).documents[0]!
      .staff_status
  ).toBe('rejected');
  expect(
    (
      await http.pool.query('SELECT status FROM solar_construction_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0]!.status
  ).toBe('documents_under_review');
  const replacement = await documentCreate(first.id);
  expect(replacement.state).toBe('Available');
  expect(
    (await http.pool.query('SELECT state FROM documents WHERE id=$1', [first.id])).rows[0]!.state
  ).toBe('Superseded');
  const removable = await documentCreate();
  await send('solar-buyer', `solar/requests/${requestId}/documents/complete`, 'POST', {
    allDocumentsUploaded: true,
  });
  const secondList = await send('solar-reviewer', `admin/solar/requests/${requestId}/documents`);
  const secondRows = (
    (await secondList.json()) as { documents: Array<{ document_id: string; revision: number }> }
  ).documents;
  const removableRow = secondRows.find((item) => item.document_id === removable.id)!;
  const removed = await send('solar-buyer', `documents/${removable.id}/remove`, 'POST', {
    expectedRevision: removableRow.revision,
    idempotencyKey: randomUUID(),
  });
  expect(removed.status, http.logs()).toBe(200);
  expect(((await removed.json()) as { state: string }).state).toBe('Removed');
  const second = secondRows.find((item) => item.document_id === replacement.id)!;
  const approved = await send(
    'solar-reviewer',
    `admin/solar/requests/${requestId}/documents/${replacement.id}/approve`,
    'POST',
    {
      expectedRevision: second.revision,
    }
  );
  expect(approved.status, http.logs()).toBe(200);
  const afterApproval = await send('solar-reviewer', `admin/solar/requests/${requestId}/documents`);
  expect(
    (
      (await afterApproval.json()) as {
        documents: Array<{ document_id: string; staff_status: string }>;
      }
    ).documents.find((item) => item.document_id === replacement.id)!.staff_status
  ).toBe('approved');
  const advanced = await send(
    'solar-reviewer',
    `admin/solar/requests/${requestId}/documents/advance`,
    'POST'
  );
  expect(advanced.status, http.logs()).toBe(200);
  expect(await advanced.json()).toMatchObject({ status: 'waiting_for_postal_submission' });
  expect(
    (
      await http.pool.query('SELECT status FROM solar_construction_postal WHERE request_id=$1', [
        requestId,
      ])
    ).rows[0]!.status
  ).toBe('waiting_for_shipment');
  expect(
    (
      await http.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM in_app_notifications WHERE recipient_user_id='solar-buyer'"
      )
    ).rows[0]!.count
  ).toBeGreaterThanOrEqual(4);
}, 90_000);
