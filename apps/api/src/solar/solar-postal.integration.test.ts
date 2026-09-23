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
const image = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082',
  'hex'
);
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
async function uploadReceipt() {
  const created = await send('postal-buyer', 'documents', 'POST', {
    profileId,
    businessRecordType: 'solar_request',
    businessRecordId: requestId,
    category: 'image',
    fileName: 'receipt.png',
    contentType: 'image/png',
    fileSize: image.length,
    idempotencyKey: randomUUID(),
  });
  expect(created.status, http.logs()).toBe(201);
  const result = (await created.json()) as {
    document: { id: string };
    upload: { presignedUrl: string; headers: Record<string, string> };
  };
  const uploaded = await fetch(result.upload.presignedUrl, {
    method: 'PUT',
    headers: { ...result.upload.headers, 'Content-Type': 'image/png' },
    body: image,
  });
  expect(uploaded.status, await uploaded.text()).toBe(200);
  const confirmed = await send('postal-buyer', `documents/${result.document.id}/confirm`, 'POST', {
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
  });
  expect(confirmed.status, http.logs()).toBe(200);
  expect(await confirmed.json()).toMatchObject({ state: 'Available' });
  return result.document.id;
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
     VALUES('postal-review-staff','Postal reviewer','Test reviewer','["orders:read","orders:write","contracts:write","admin:catalogue:edit"]')`
  );
  for (const [user, staff] of [
    ['postal-buyer', false],
    ['postal-reviewer', true],
    ['postal-other', false],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'postal-review-staff')",
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
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('postal-buyer','INDIVIDUAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0]!.id;
  const created = await send('postal-buyer', 'solar/requests', 'POST', {
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
  expect(
    (
      await send('postal-buyer', `solar/requests/${requestId}/documents/complete`, 'POST', {
        allDocumentsUploaded: true,
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${requestId}/documents/advance`, 'POST'))
      .status,
    http.logs()
  ).toBe(200);
}, 90_000);

afterAll(async () => {
  try {
    await http?.close();
  } finally {
    s3?.destroy();
    await minio?.stop();
  }
}, 30_000);

it('handles guidance, receipt upload, shipment issues, resubmission and staff receipt', async () => {
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST'))
      .status
  ).toBe(409);
  expect(
    (
      await send('postal-buyer', `admin/solar/requests/${requestId}/close-no-contract`, 'POST', {
        reason: 'No',
      })
    ).status
  ).toBe(403);
  const guidance = {
    fa: 'اصل سند را پست کنید.',
    en: 'Post the original deed.',
    destinationAddress: 'Central Office',
    contactDetails: '+1 555 0100',
    originals: [{ fa: 'سند', en: 'Deed' }],
  };
  expect(
    (await send('postal-reviewer', 'admin/solar/postal-guidance', 'PUT', guidance)).status,
    http.logs()
  ).toBe(200);
  expect(
    await (await send('postal-buyer', `solar/requests/${requestId}/postal`)).json()
  ).toMatchObject({ guidance, postal: { status: 'waiting_for_shipment' } });
  expect((await send('postal-other', `solar/requests/${requestId}/postal`)).status).toBe(404);
  const wrongCategory = await send('postal-buyer', 'documents', 'POST', {
    profileId,
    businessRecordType: 'solar_request',
    businessRecordId: requestId,
    category: 'document',
    fileName: 'late.pdf',
    contentType: 'application/pdf',
    fileSize: 4,
    idempotencyKey: randomUUID(),
  });
  expect(wrongCategory.status).toBe(409);
  const receiptImageId = await uploadReceipt();
  expect(
    (
      await send('postal-buyer', 'documents', 'POST', {
        profileId,
        businessRecordType: 'solar_request',
        businessRecordId: requestId,
        category: 'image',
        fileName: 'replacement.png',
        contentType: 'image/png',
        fileSize: image.length,
        idempotencyKey: randomUUID(),
        supersedesDocumentId: receiptImageId,
      })
    ).status
  ).toBe(409);
  const shipment = {
    courier: 'Parcel Co',
    trackingNumber: 'TRACK-123',
    sendDate: '2026-01-02',
    receiptImageId,
  };
  expect(
    (
      await send('postal-buyer', `solar/requests/${requestId}/postal/shipment`, 'POST', {
        ...shipment,
        receiptImageId: randomUUID(),
      })
    ).status
  ).toBe(400);
  const shipped = await send(
    'postal-buyer',
    `solar/requests/${requestId}/postal/shipment`,
    'POST',
    shipment
  );
  expect(shipped.status, http.logs()).toBe(200);
  expect(await shipped.json()).toMatchObject({ status: 'shipped' });
  expect(
    (await send('postal-buyer', `solar/requests/${requestId}/postal/shipment`, 'POST', shipment))
      .status
  ).toBe(409);
  const queue = await send('postal-reviewer', 'admin/solar/postal-queue');
  expect(queue.status, http.logs()).toBe(200);
  expect(await queue.json()).toMatchObject({
    requests: [{ id: requestId, postal_status: 'shipped', receipt_image_id: receiptImageId }],
  });
  const incomplete = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/postal/mark-incomplete`,
    'POST',
    { reason: 'Please send the signed original.' }
  );
  expect(incomplete.status, http.logs()).toBe(200);
  expect(
    await (await send('postal-buyer', `solar/requests/${requestId}/postal`)).json()
  ).toMatchObject({
    requestStatus: 'waiting_for_postal_submission',
    postal: { status: 'incomplete', staff_notes: 'Please send the signed original.' },
  });
  expect(
    (
      await send('postal-buyer', `solar/requests/${requestId}/postal/shipment`, 'POST', {
        ...shipment,
        trackingNumber: 'TRACK-456',
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send(
        'postal-reviewer',
        `admin/solar/requests/${requestId}/postal/mark-not-received`,
        'POST',
        { reason: 'Courier could not locate it.' }
      )
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send('postal-buyer', `solar/requests/${requestId}/postal/shipment`, 'POST', {
        ...shipment,
        trackingNumber: 'TRACK-789',
      })
    ).status,
    http.logs()
  ).toBe(200);
  const received = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/postal/confirm-received`,
    'POST'
  );
  expect(received.status, http.logs()).toBe(200);
  expect(await received.json()).toMatchObject({
    status: 'received',
    requestStatus: 'postal_documents_received',
  });
  expect(
    (await send('postal-buyer', `solar/requests/${requestId}/postal/shipment`, 'POST', shipment))
      .status
  ).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM in_app_notifications WHERE recipient_user_id='postal-buyer'"
      )
    ).rows[0]!.count
  ).toBeGreaterThanOrEqual(3);
  const approved = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/final-approve`,
    'POST'
  );
  expect(approved.status, http.logs()).toBe(200);
  expect(await approved.json()).toMatchObject({ status: 'approved' });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM contracts WHERE profile_id=$1 AND service_type='solar'",
        [profileId]
      )
    ).rows[0]!.count
  ).toBe(0);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST'))
      .status
  ).toBe(409);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/close-no-contract`, 'POST', {
        reason: '',
      })
    ).status
  ).toBe(400);
  const closed = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/close-no-contract`,
    'POST',
    { reason: 'Site cannot proceed.' }
  );
  expect(closed.status, http.logs()).toBe(200);
  expect(await closed.json()).toMatchObject({ status: 'cancelled' });
  expect(await (await send('postal-buyer', `solar/requests/${requestId}`)).json()).toMatchObject({
    request: {
      status: 'cancelled',
      status_reason: 'Site cannot proceed.',
      support_path: '/tickets',
    },
  });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event IN ('solar.final.approve','solar.final.close-no-contract')"
      )
    ).rows[0]!.count
  ).toBe(2);
}, 90_000);
