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
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('postal-review-staff','Postal reviewer','Test reviewer','["orders:read","orders:write","contracts:write","invoices:write","admin:catalogue:edit"]')`
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

it('creates a linked solar draft and invoice atomically, then replays the same command', async () => {
  const created = await send('postal-buyer', 'solar/requests', 'POST', {
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    propertyForm: 'villa',
    structuralFrame: 'steel',
    buildingCompletionDate: '2019-01-01',
    gridType: 'off_grid',
    agreementAccepted: true,
  });
  expect(created.status, http.logs()).toBe(201);
  const id = ((await created.json()) as { requestId: string }).requestId;
  const templateId = randomUUID(),
    versionId = randomUUID();
  await http.pool.query(
    `INSERT INTO contract_templates(id,name,status,created_by)
     VALUES($1,$2,'active','postal-reviewer')`,
    [templateId, `Solar template ${templateId}`]
  );
  await http.pool.query(
    `INSERT INTO contract_template_versions(id,template_id,version_number,storage_key,file_name,created_by)
     VALUES($1,$2,1,$3,'solar.txt','postal-reviewer')`,
    [versionId, templateId, `contract-templates/${versionId}.txt`]
  );
  const input = {
    profileId,
    idempotencyKey: randomUUID(),
    title: 'Solar construction agreement',
    text: 'The parties agree to construct the station under these terms.',
    changeDescription: 'Initial solar draft',
    commercialValue: { kind: 'fixed', amountIrr: '900000' },
    source: { kind: 'template', templateVersionId: versionId },
    invoiceLines: [
      {
        description: 'Construction deposit',
        quantity: 1,
        unitPrice: '100000',
        vatRate: 0,
        isTaxable: false,
      },
    ],
  };
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', input))
      .status
  ).toBe(409);
  expect(
    (
      await send('postal-buyer', `solar/requests/${id}/documents/complete`, 'POST', {
        allDocumentsUploaded: true,
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/documents/advance`, 'POST')).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send('postal-buyer', `solar/requests/${id}/postal/shipment`, 'POST', {
        courier: 'Parcel Co',
        trackingNumber: 'NEW-123',
        sendDate: '2026-01-02',
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/postal/confirm-received`, 'POST'))
      .status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/start-final-review`, 'POST')).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/final-approve`, 'POST')).status,
    http.logs()
  ).toBe(200);
  const options = await send('postal-reviewer', `admin/solar/requests/${id}/contract-options`);
  expect(options.status, http.logs()).toBe(200);
  expect(await options.json()).toMatchObject({ templates: [{ version_id: versionId }] });
  const bad = await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', {
    ...input,
    idempotencyKey: randomUUID(),
    invoiceLines: [{ ...input.invoiceLines[0], unitPrice: '0' }],
  });
  expect(bad.status, http.logs()).toBe(400);
  for (const commercialValue of [
    undefined,
    { kind: 'fixed', amountIrr: '9223372036854775808' },
    { kind: 'variable', description: '   ' },
  ]) {
    const response = await send(
      'postal-reviewer',
      `admin/solar/requests/${id}/create-contract`,
      'POST',
      {
        ...input,
        idempotencyKey: randomUUID(),
        commercialValue,
      }
    );
    expect(response.status, http.logs()).toBe(400);
  }
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM contracts WHERE profile_id=$1 AND service_type='solar'",
        [profileId]
      )
    ).rows[0]!.count
  ).toBe(0);
  expect(
    (
      await http.pool.query(
        'SELECT status,contract_id FROM solar_construction_requests WHERE id=$1',
        [id]
      )
    ).rows[0]
  ).toMatchObject({ status: 'approved', contract_id: null });
  const contract = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/create-contract`,
    'POST',
    input
  );
  expect(contract.status, http.logs()).toBe(200);
  const result = (await contract.json()) as {
    contractId: string;
    invoiceIds: string[];
    status: string;
  };
  expect(result.status).toBe('contract_created');
  expect(result.invoiceIds).toHaveLength(1);
  expect(
    (
      await http.pool.query<{ content: { commercialValue: unknown } }>(
        'SELECT content FROM contract_versions WHERE contract_id=$1',
        [result.contractId]
      )
    ).rows[0]!.content.commercialValue
  ).toEqual(input.commercialValue);
  expect(
    await (
      await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', input)
    ).json()
  ).toEqual(result);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', {
        ...input,
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(409);
  expect(
    (
      await http.pool.query('SELECT state,service_type FROM contracts WHERE id=$1', [
        result.contractId,
      ])
    ).rows[0]
  ).toMatchObject({ state: 'Draft', service_type: 'solar' });
  expect(
    (
      await http.pool.query('SELECT state,total_amount,contract_id FROM invoices WHERE id=$1', [
        result.invoiceIds[0],
      ])
    ).rows[0]
  ).toMatchObject({ state: 'Unpaid', total_amount: '100000', contract_id: result.contractId });
  const invoice = await send('postal-buyer', `invoices/${result.invoiceIds[0]}`);
  expect(invoice.status, http.logs()).toBe(200);
  expect(await invoice.json()).toMatchObject({ solarRequestId: id });
  expect(await (await send('postal-buyer', `solar/requests/${id}`)).json()).toMatchObject({
    request: {
      status: 'contract_created',
      contract_id: result.contractId,
      initial_invoice_id: result.invoiceIds[0],
      initial_invoice_state: 'Unpaid',
      contract_published: false,
    },
  });
  const detail = (await (await send('postal-buyer', `solar/requests/${id}`)).json()) as {
    history: Array<{ event: string; at: string }>;
  };
  const events = detail.history.map((entry) => entry.event);
  expect(events[0]).toBe('solar.request.submitted');
  expect(events).toContain('solar.final.review_started');
  expect(events).toContain('solar.final.approve');
  expect(events.at(-1)).toBe('solar.contract.created');
  expect(detail.history.every((entry) => Object.keys(entry).sort().join(',') === 'at,event')).toBe(
    true
  );
  expect((await send('postal-other', `solar/requests/${id}`)).status).toBe(404);
  const listed = (await (
    await send('postal-buyer', `solar/requests?profileId=${profileId}`)
  ).json()) as { requests: Array<Record<string, unknown>> };
  expect(listed.requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id,
        initial_invoice_id: result.invoiceIds[0],
        initial_invoice_state: 'Unpaid',
      }),
    ])
  );
  expect((await send('postal-buyer', `contracts/${result.contractId}`)).status).toBe(404);
  const contractVersionId = (
    await http.pool.query<{ current_version_id: string }>(
      'SELECT current_version_id FROM contracts WHERE id=$1',
      [result.contractId]
    )
  ).rows[0]!.current_version_id;
  expect(
    (
      await send('postal-reviewer', `admin/contracts/${result.contractId}/submit`, 'POST', {
        expectedVersionId: contractVersionId,
        idempotencyKey: randomUUID(),
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send('postal-reviewer', `admin/contracts/${result.contractId}/publish`, 'POST', {
        expectedVersionId: contractVersionId,
        idempotencyKey: randomUUID(),
      })
    ).status,
    http.logs()
  ).toBe(200);
  const publishedContract = await send('postal-buyer', `contracts/${result.contractId}`);
  expect(publishedContract.status, http.logs()).toBe(200);
  expect(await publishedContract.json()).toMatchObject({
    version: { content: { commercialValue: input.commercialValue } },
  });
  expect(await (await send('postal-buyer', 'contracts')).json()).toMatchObject({
    contracts: [
      expect.objectContaining({ id: result.contractId, commercialValue: input.commercialValue }),
    ],
  });
  expect(await (await send('postal-buyer', `solar/requests/${id}`)).json()).toMatchObject({
    request: { contract_published: true },
  });
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
    requests: [
      {
        id: requestId,
        profile_name: 'postal-buyer@example.test',
        postal_status: 'shipped',
        receipt_image_id: receiptImageId,
      },
    ],
    nextBefore: null,
  });
  const actionQueue = await send('postal-reviewer', 'admin/solar/postal-queue?lane=needs_staff');
  expect(actionQueue.status, http.logs()).toBe(200);
  expect(await actionQueue.json()).toMatchObject({ requests: [{ id: requestId }] });
  const waitingQueue = await send(
    'postal-reviewer',
    'admin/solar/postal-queue?lane=waiting_customer'
  );
  expect(waitingQueue.status, http.logs()).toBe(200);
  expect(await waitingQueue.json()).toMatchObject({ requests: [] });
  expect((await send('postal-reviewer', 'admin/solar/postal-queue?lane=wrong')).status).toBe(400);
  expect(
    (
      await send(
        'postal-reviewer',
        `admin/solar/postal-queue?lane=waiting_customer&before=${requestId}`
      )
    ).status
  ).toBe(404);
  const afterRequest = await send(
    'postal-reviewer',
    `admin/solar/postal-queue?before=${requestId}`
  );
  expect(afterRequest.status, http.logs()).toBe(200);
  expect(await afterRequest.json()).toMatchObject({ requests: [], nextBefore: null });
  expect((await send('postal-reviewer', 'admin/solar/postal-queue?before=bad')).status).toBe(400);
  expect(
    (await send('postal-reviewer', `admin/solar/postal-queue?before=${randomUUID()}`)).status
  ).toBe(404);
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
  const waitingAfterIssue = await send(
    'postal-reviewer',
    'admin/solar/postal-queue?lane=waiting_customer'
  );
  expect(waitingAfterIssue.status, http.logs()).toBe(200);
  expect(await waitingAfterIssue.json()).toMatchObject({ requests: [{ id: requestId }] });
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
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${requestId}/start-final-review`, 'POST'))
      .status
  ).toBe(409);
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
    await (await send('postal-reviewer', 'admin/solar/postal-queue?lane=needs_staff')).json()
  ).toMatchObject({ requests: [{ id: requestId, request_status: 'postal_documents_received' }] });
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST'))
      .status
  ).toBe(409);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/final-reject`, 'POST', {
        reason: 'Review has not begun',
      })
    ).status
  ).toBe(409);
  expect(
    (await send('postal-buyer', `admin/solar/requests/${requestId}/start-final-review`, 'POST'))
      .status
  ).toBe(403);
  const reviewStarted = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/start-final-review`,
    'POST'
  );
  expect(reviewStarted.status, http.logs()).toBe(200);
  expect(await reviewStarted.json()).toMatchObject({ status: 'final_review' });
  expect(await (await send('postal-buyer', `solar/requests/${requestId}`)).json()).toMatchObject({
    request: { status: 'final_review' },
  });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM in_app_notifications WHERE recipient_user_id='postal-buyer' AND localized_content::text LIKE '%Staff are reviewing your request.%'"
      )
    ).rows[0]!.count
  ).toBeGreaterThanOrEqual(1);
  expect(
    await (await send('postal-reviewer', 'admin/solar/postal-queue?lane=needs_staff')).json()
  ).toMatchObject({ requests: [{ id: requestId, request_status: 'final_review' }] });
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${requestId}/start-final-review`, 'POST'))
      .status
  ).toBe(409);
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
    await (await send('postal-reviewer', 'admin/solar/postal-queue?lane=needs_staff')).json()
  ).toMatchObject({ requests: [{ id: requestId, request_status: 'approved' }] });
  expect(
    (
      await http.pool.query('SELECT contract_id FROM solar_construction_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0]!.contract_id
  ).toBeNull();
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
        "SELECT count(*)::int AS count FROM audit_log WHERE event IN ('solar.final.review_started','solar.final.approve','solar.final.close-no-contract') AND metadata::jsonb->>'requestId'=$1",
        [requestId]
      )
    ).rows[0]!.count
  ).toBe(3);
}, 90_000);

it('rejects a final solar request with a customer-visible reason after postal receipt', async () => {
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
  const id = ((await created.json()) as { requestId: string }).requestId;
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/final-reject`, 'POST', {
        reason: 'The project cannot proceed.',
      })
    ).status
  ).toBe(409);
  expect(
    (
      await send('postal-buyer', `solar/requests/${id}/documents/complete`, 'POST', {
        allDocumentsUploaded: true,
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/documents/advance`, 'POST')).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send('postal-buyer', `solar/requests/${id}/postal/shipment`, 'POST', {
        courier: 'Parcel Co',
        trackingNumber: 'REJECT-123',
        sendDate: '2026-09-23',
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/postal/confirm-received`, 'POST'))
      .status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/start-final-review`, 'POST')).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/final-reject`, 'POST', {
        reason: '',
      })
    ).status
  ).toBe(400);
  expect(
    (
      await send('postal-other', `admin/solar/requests/${id}/final-reject`, 'POST', {
        reason: 'Unauthorized',
      })
    ).status
  ).toBe(403);
  const rejected = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/final-reject`,
    'POST',
    {
      reason: '  The project cannot proceed.  ',
    }
  );
  expect(rejected.status, http.logs()).toBe(200);
  expect(await rejected.json()).toMatchObject({ status: 'rejected' });
  expect(await (await send('postal-buyer', `solar/requests/${id}`)).json()).toMatchObject({
    request: {
      status: 'rejected',
      status_reason: 'The project cannot proceed.',
      support_path: '/tickets',
      contract_id: null,
    },
  });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='solar.final.reject' AND metadata::jsonb->>'requestId'=$1",
        [id]
      )
    ).rows[0]!.count
  ).toBe(1);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM in_app_notifications WHERE recipient_user_id='postal-buyer' AND localized_content::text LIKE '%The project cannot proceed.%'"
      )
    ).rows[0]!.count
  ).toBeGreaterThanOrEqual(1);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/final-reject`, 'POST', {
        reason: 'The project cannot proceed.',
      })
    ).status
  ).toBe(409);
}, 90_000);

it('pages more than 100 postal requests without repeating tied timestamps', async () => {
  const inserted = await http.pool.query<{ id: string }>(
    `INSERT INTO solar_construction_requests
       (id,profile_id,submitted_by,submission_key,status,building_type,grid_type,
        property_form,structural_frame,building_completion_date,agreement_accepted,
        agreement_version,agreement_snapshot,agreement_accepted_at,created_at)
     SELECT gen_random_uuid(),profile_id,submitted_by,gen_random_uuid(),
            'waiting_for_postal_submission',building_type,grid_type,property_form,
            structural_frame,building_completion_date,agreement_accepted,
            agreement_version,agreement_snapshot,agreement_accepted_at,
            NOW()+INTERVAL '1 minute'
     FROM solar_construction_requests CROSS JOIN generate_series(1,101)
     WHERE id=$1 RETURNING id`,
    [requestId]
  );
  expect(inserted.rowCount).toBe(101);
  await http.pool.query(
    `INSERT INTO solar_construction_postal(id,request_id)
     SELECT gen_random_uuid(),unnest($1::uuid[])`,
    [inserted.rows.map((row) => row.id)]
  );
  const first = await send('postal-reviewer', 'admin/solar/postal-queue');
  expect(first.status, http.logs()).toBe(200);
  const firstPage = (await first.json()) as {
    requests: Array<{ id: string }>;
    nextBefore: string | null;
  };
  expect(firstPage.requests).toHaveLength(100);
  expect(firstPage.nextBefore).toBe(firstPage.requests[99]!.id);
  const next = await send(
    'postal-reviewer',
    `admin/solar/postal-queue?before=${firstPage.nextBefore}`
  );
  expect(next.status, http.logs()).toBe(200);
  const secondPage = (await next.json()) as typeof firstPage;
  expect(secondPage.requests).toHaveLength(1);
  expect(secondPage.nextBefore).toBeNull();
  expect(firstPage.requests.some((row) => row.id === secondPage.requests[0]!.id)).toBe(false);
}, 90_000);
