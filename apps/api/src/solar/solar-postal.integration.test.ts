import {
  expectSolarAudit,
  expectSolarPostalAudit,
  expectSolarAuditRollback,
} from '../test/solar-audit.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  expectSolarStatusDeliveries,
  expectSolarStatusRollback,
  solarDeliverySnapshot,
} from '../test/solar-status-notification-proof.js';
import { renderContractPdf } from '../contract/contract-pdf.js';
import type { ContractService } from '../contract/contract.service.js';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';
import { ErrorCodes } from '@barghsa/shared/errors';

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
const image = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082',
  'hex'
);
let minio: StartedTestContainer;
let s3: InstanceType<typeof S3Client>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
let siteAddressId: string;
let requestId: string;
const headers: Record<string, Record<string, string>> = {};

function send(user: string, path: string, method = 'GET', body?: unknown) {
  return fetch(`${http.base}/api/${path}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function storeTemplate(
  versionId: string,
  content = 'Solar terms for {{customerName}} dated {{date}}; deposit {{amount}} IRR.'
) {
  const bytes = Buffer.from(content);
  const key = `contract-templates/${versionId}.txt`;
  await s3.send(
    new PutObjectCommand({
      Bucket: 'test-evidence',
      Key: key,
      Body: bytes,
      ContentType: 'text/plain',
    })
  );
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,file_size,content_type,category,file_name,
    signed_at,signed_by,metadata) VALUES($1,'immutable',$2,'text/plain','document','solar.txt',NOW(),'postal-reviewer',$3::jsonb)`,
    [
      key,
      bytes.length,
      JSON.stringify({
        purpose: 'contract_template',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    ]
  );
  await http.pool.query(
    'UPDATE contract_template_versions SET file_size=$2,content_type=$3 WHERE id=$1',
    [versionId, bytes.length, 'text/plain']
  );
  return bytes;
}
const staleReviewHash = '0'.repeat(64);
async function reviewFinal(
  id: string,
  decision: 'approve' | 'reject' | 'close-no-contract',
  reason?: string
) {
  const response = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/final-decision/review`,
    'POST',
    { decision, ...(reason === undefined ? {} : { reason }) }
  );
  expect(response.status, http.logs()).toBe(200);
  return (await response.json()) as {
    hash: string;
    data: {
      currentStatus: string;
      postalStatus: string;
      reason: string | null;
      outcome: string;
      createsContract: boolean;
      createsInvoice: boolean;
    };
  };
}
async function reviewPostal(
  id: string,
  decision: 'received' | 'incomplete' | 'not_received',
  reason?: string
) {
  const response = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/postal/review`,
    'POST',
    { decision, ...(reason === undefined ? {} : { reason }) }
  );
  expect(response.status, http.logs()).toBe(200);
  return (await response.json()) as {
    hash: string;
    data: {
      currentPostalStatus: string;
      trackingNumber: string;
      reason: string | null;
      postalOutcome: string;
      requestOutcome: string;
    };
  };
}
async function advanceDocuments(id: string) {
  const reviewed = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/documents/review-set-decision`,
    'POST',
    { decision: 'advance' }
  );
  expect(reviewed.status, http.logs()).toBe(200);
  const { hash } = (await reviewed.json()) as { hash: string };
  return send('postal-reviewer', `admin/solar/requests/${id}/documents/advance`, 'POST', {
    expectedReviewHash: hash,
  });
}
async function submitSolar(body: Record<string, unknown>) {
  const review = await send('postal-buyer', 'solar/requests/review', 'POST', body);
  expect(review.status, http.logs()).toBe(201);
  const { hash } = (await review.json()) as { hash: string };
  return send('postal-buyer', 'solar/requests', 'POST', { ...body, expectedReviewHash: hash });
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
     VALUES('postal-review-staff','Postal reviewer','Test reviewer','["orders:read","orders:write","contracts:write","contracts:read","invoices:write","admin:catalogue:edit"]')`
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
  siteAddressId = (
    await http.pool.query<{ id: string }>(
      `WITH p AS (INSERT INTO provinces(name_fa,name_en) VALUES('استان نصب','Installation Province') RETURNING id),
     c AS (INSERT INTO cities(province_id,name_fa,name_en) SELECT id,'شهر نصب','Installation City' FROM p RETURNING id,province_id)
     INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
     SELECT $1,province_id,id,'Installation site','1234567890',true FROM c RETURNING id`,
      [profileId]
    )
  ).rows[0]!.id;
  const created = await submitSolar({
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    siteAddressId,
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
  expect((await advanceDocuments(requestId)).status, http.logs()).toBe(200);
}, 90_000);

it('returns only owned form fields while rejected bodies leave workflow, config, audit and notification state intact', async () => {
  const shipmentPath = `solar/requests/${requestId}/postal/shipment`;
  const postalBase = `admin/solar/requests/${requestId}/postal`;
  const finalBase = `admin/solar/requests/${requestId}`;
  const guidancePath = 'admin/solar/postal-guidance';
  const guidance = {
    fa: 'مدارک',
    en: 'Documents',
    destinationAddress: '',
    contactDetails: '',
    originals: [],
  };
  const shipment = { courier: 'Courier', trackingNumber: 'TRACK-1', sendDate: '2026-01-02' };
  const state = async () => ({
    request: (
      await http.pool.query(
        'SELECT status,updated_at FROM solar_construction_requests WHERE id=$1',
        [requestId]
      )
    ).rows,
    postal: (
      await http.pool.query('SELECT * FROM solar_construction_postal WHERE request_id=$1', [
        requestId,
      ])
    ).rows,
    config: (await http.pool.query('SELECT key,value,version FROM app_config ORDER BY key')).rows,
    version: (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows,
    audit: (await http.pool.query('SELECT id,event,metadata FROM audit_log ORDER BY id')).rows,
    notifications: (await http.pool.query('SELECT id FROM in_app_notifications ORDER BY id')).rows,
  });
  const before = await state();
  try {
    for (const [path, body, fields] of [
      [
        shipmentPath,
        {
          ...shipment,
          courier: '',
          trackingNumber: 'PRIVATE'.repeat(29),
          sendDate: '2026-02-30',
          receiptImageId: 'PRIVATE',
        },
        ['courier', 'trackingNumber', 'sendDate', 'receiptImageId'],
      ],
      [shipmentPath, { ...shipment, courier: '', secret: 'PRIVATE' }, null],
    ] as const) {
      const response = await send('postal-buyer', path, 'POST', body);
      expect(response.status, http.logs()).toBe(400);
      const result = await response.json();
      if (fields)
        expect(result).toMatchObject({ error: { code: 'VALIDATION:INPUT:INVALID', fields } });
      else expect(result).not.toHaveProperty('error.fields');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    for (const [path, method, body, fields] of [
      [
        guidancePath,
        'PUT',
        {
          ...guidance,
          fa: 'ف'.repeat(4001),
          en: 'e'.repeat(4001),
          destinationAddress: 'a'.repeat(2001),
          contactDetails: 'c'.repeat(1001),
          originals: Array.from({ length: 31 }, () => ({ fa: 'مدرک', en: 'Document' })),
        },
        ['fa', 'en', 'destinationAddress', 'contactDetails', 'originalsFa', 'originalsEn'],
      ],
      [
        guidancePath,
        'PUT',
        { ...guidance, originals: [{ fa: '', en: 'PRIVATE'.repeat(29) }] },
        ['originalsFa', 'originalsEn'],
      ],
      [guidancePath, 'PUT', { ...guidance, fa: '', secret: 'PRIVATE' }, null],
      [guidancePath, 'PUT', { ...guidance, originals: 'PRIVATE' }, null],
      [`${postalBase}/review`, 'POST', { decision: 'incomplete' }, ['reason']],
      [
        `${postalBase}/review`,
        'POST',
        { decision: 'not_received', reason: 'PRIVATE'.repeat(143) },
        ['reason'],
      ],
      [
        `${postalBase}/mark-incomplete`,
        'POST',
        { reason: '', expectedReviewHash: staleReviewHash },
        ['reason'],
      ],
      [
        `${postalBase}/mark-not-received`,
        'POST',
        { reason: 'PRIVATE'.repeat(143), expectedReviewHash: staleReviewHash },
        ['reason'],
      ],
      [
        `${postalBase}/mark-incomplete`,
        'POST',
        { reason: '', expectedReviewHash: 'PRIVATE' },
        null,
      ],
      [`${finalBase}/final-decision/review`, 'POST', { decision: 'reject' }, ['reason']],
      [`${finalBase}/final-decision/review`, 'POST', { decision: 'close-no-contract' }, ['reason']],
      [
        `${finalBase}/final-reject`,
        'POST',
        { reason: '', expectedReviewHash: staleReviewHash },
        ['reason'],
      ],
      [
        `${finalBase}/close-no-contract`,
        'POST',
        { reason: 'PRIVATE'.repeat(143), expectedReviewHash: staleReviewHash },
        ['reason'],
      ],
      [
        `${finalBase}/close-no-contract`,
        'POST',
        { reason: '', expectedReviewHash: 'PRIVATE' },
        null,
      ],
    ] as const) {
      const response = await send('postal-reviewer', path, method, body);
      expect(response.status, http.logs()).toBe(400);
      const result = await response.json();
      if (fields)
        expect(result).toMatchObject({ error: { code: 'VALIDATION:INPUT:INVALID', fields } });
      else expect(result).not.toHaveProperty('error.fields');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    for (const [path, method, body] of [
      [guidancePath, 'PUT', { fa: '' }],
      [`${postalBase}/review`, 'POST', { decision: 'incomplete' }],
      [`${postalBase}/mark-incomplete`, 'POST', { reason: '' }],
      [`${finalBase}/final-decision/review`, 'POST', { decision: 'close-no-contract' }],
      [`${finalBase}/final-reject`, 'POST', { reason: '' }],
      [`${finalBase}/close-no-contract`, 'POST', { reason: '' }],
    ] as const) {
      const denied = await send('postal-buyer', path, method, body);
      expect(denied.status, http.logs()).toBe(403);
      expect(await denied.json()).not.toHaveProperty('error.fields');
    }
    const permissions = (
      await http.pool.query<{ permissions: string }>(
        "SELECT permissions FROM staff_roles WHERE role_id='postal-review-staff'"
      )
    ).rows[0]!.permissions;
    try {
      for (const [grant, allowedDecision, deniedDecision] of [
        ['orders:write', 'reject', 'close-no-contract'],
        ['contracts:write', 'close-no-contract', 'reject'],
      ] as const) {
        await http.pool.query(
          "UPDATE staff_roles SET permissions=$1 WHERE role_id='postal-review-staff'",
          [JSON.stringify([grant])]
        );
        const denied = await send('postal-reviewer', `${finalBase}/final-decision/review`, 'POST', {
          decision: deniedDecision,
        });
        expect(denied.status, http.logs()).toBe(403);
        expect(await denied.json()).not.toHaveProperty('error.fields');
        const owned = await send('postal-reviewer', `${finalBase}/final-decision/review`, 'POST', {
          decision: allowedDecision,
        });
        expect(owned.status, http.logs()).toBe(400);
        expect(await owned.json()).toMatchObject({ error: { fields: ['reason'] } });
      }
    } finally {
      await http.pool.query(
        "UPDATE staff_roles SET permissions=$1 WHERE role_id='postal-review-staff'",
        [permissions]
      );
    }
    const verifiedAt = (
      await http.pool.query<{ verified_at: string }>(
        "SELECT step_up_verified_at::text AS verified_at FROM sessions WHERE user_id='postal-reviewer'"
      )
    ).rows[0]!.verified_at;
    try {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='postal-reviewer'"
      );
      const denied = await send('postal-reviewer', guidancePath, 'PUT', guidance);
      expect(denied.status, http.logs()).toBe(403);
      expect(await denied.json()).toMatchObject({
        error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
      });
    } finally {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=$1::timestamptz WHERE user_id='postal-reviewer'",
        [verifiedAt]
      );
    }
    expect(await state()).toEqual(before);
  } finally {
    // Added validation requests must not consume the following journey fixture's transport quota.
    await http.pool.query(
      "DELETE FROM rate_limit_windows WHERE NOT security AND key LIKE 'solar:postal:shipment:%'"
    );
    await http.pool.query(
      "DELETE FROM rate_limit_counters WHERE key LIKE 'solar:postal:shipment:%'"
    );
  }
});

it('returns safe shipment semantic fields only after current request authority and preserves the waiting parcel', async () => {
  const path = `solar/requests/${requestId}/postal/shipment`;
  const nextDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const snapshot = async () => ({
    postal: (
      await http.pool.query('SELECT * FROM solar_construction_postal WHERE request_id=$1', [
        requestId,
      ])
    ).rows,
    audit: (await http.pool.query('SELECT id FROM audit_log ORDER BY id')).rows,
    notifications: (await http.pool.query('SELECT id FROM in_app_notifications ORDER BY id')).rows,
  });
  const before = await snapshot();
  try {
    for (const [body, field] of [
      [{ courier: 'Courier', trackingNumber: 'TRACK-1', sendDate: nextDay }, 'sendDate'],
      [
        {
          courier: 'Courier',
          trackingNumber: 'TRACK-1',
          sendDate: '2026-01-02',
          receiptImageId: randomUUID(),
        },
        'receiptImageId',
      ],
    ] as const) {
      const rejected = await send('postal-buyer', path, 'POST', body);
      expect(rejected.status, http.logs()).toBe(400);
      expect(await rejected.json()).toMatchObject({
        error: { code: 'VALIDATION:INPUT:INVALID', fields: [field] },
      });
      const denied = await send('postal-other', path, 'POST', body);
      expect(denied.status, http.logs()).toBe(404);
      expect(await denied.json()).not.toHaveProperty('error.fields');
    }
    expect(await snapshot()).toEqual(before);
  } finally {
    await http.pool.query(
      "DELETE FROM rate_limit_windows WHERE NOT security AND key LIKE 'solar:postal:shipment:%'"
    );
    await http.pool.query(
      "DELETE FROM rate_limit_counters WHERE key LIKE 'solar:postal:shipment:%'"
    );
  }
});

it('creates a linked solar draft and invoice atomically, then replays the same command', async () => {
  const created = await submitSolar({
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    siteAddressId,
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
  const templateBytes = await storeTemplate(versionId);
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
    (
      await send(
        'postal-reviewer',
        `admin/solar/requests/${id}/create-contract/review`,
        'POST',
        input
      )
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
  expect((await advanceDocuments(id)).status, http.logs()).toBe(200);
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
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/postal/confirm-received`, 'POST', {
        expectedReviewHash: (await reviewPostal(id, 'received')).hash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/start-final-review`, 'POST')).status,
    http.logs()
  ).toBe(200);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/final-approve`, 'POST', {
        expectedReviewHash: (await reviewFinal(id, 'approve')).hash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  const options = await send('postal-reviewer', `admin/solar/requests/${id}/contract-options`);
  expect(options.status, http.logs()).toBe(200);
  expect(await options.json()).toMatchObject({ templates: [{ version_id: versionId }] });
  const solarContractEffects = async () => ({
    request: (await http.pool.query('SELECT * FROM solar_construction_requests WHERE id=$1', [id]))
      .rows,
    contracts: (
      await http.pool.query(
        "SELECT * FROM contracts WHERE profile_id=$1 AND service_type='solar' ORDER BY id",
        [profileId]
      )
    ).rows,
    versions: (
      await http.pool.query(
        "SELECT v.* FROM contract_versions v JOIN contracts c ON c.id=v.contract_id WHERE c.profile_id=$1 AND c.service_type='solar' ORDER BY v.id",
        [profileId]
      )
    ).rows,
    invoices: (
      await http.pool.query('SELECT * FROM invoices WHERE profile_id=$1 ORDER BY id', [profileId])
    ).rows,
    keys: (
      await http.pool.query(
        "SELECT * FROM idempotency_keys WHERE entity_type='solar_contract_create' ORDER BY idempotency_key"
      )
    ).rows,
    audit: (
      await http.pool.query(
        "SELECT id,event,metadata FROM audit_log WHERE metadata::jsonb->>'requestId'=$1 OR metadata::jsonb->>'solarRequestId'=$1 OR metadata::jsonb->>'contractId' IN (SELECT id::text FROM contracts WHERE profile_id=$2 AND service_type='solar') OR metadata::jsonb->>'invoiceId' IN (SELECT id::text FROM invoices WHERE profile_id=$2) ORDER BY id",
        [id, profileId]
      )
    ).rows,
    notices: (
      await http.pool.query('SELECT * FROM in_app_notifications WHERE profile_id=$1 ORDER BY id', [
        profileId,
      ])
    ).rows,
  });
  const beforeRejectedContract = await solarContractEffects();
  const contractBase = `admin/solar/requests/${id}/create-contract`;
  for (const write of [false, true]) {
    const path = contractBase + (write ? '' : '/review');
    const body = { ...input, ...(write ? { expectedReviewHash: 'a'.repeat(64) } : {}) };
    for (const [patch, fields] of [
      [
        { title: '', text: null, changeDescription: 'PRIVATE'.repeat(200) },
        ['title', 'text', 'changeDescription'],
      ],
      [
        { commercialValue: { kind: 'fixed', amountIrr: '9223372036854775808' } },
        ['commercialValueAmountIrr'],
      ],
      [
        { commercialValue: { kind: 'variable', description: '  ' } },
        ['commercialValueDescription'],
      ],
      [{ source: { kind: 'template', templateVersionId: 'PRIVATE' } }, ['sourceTemplateVersionId']],
      [{ source: { kind: 'document', documentId: 'PRIVATE' } }, ['sourceDocumentId']],
      [
        { invoiceLines: [{ ...input.invoiceLines[0], unitPrice: 'PRIVATE' }] },
        ['invoiceLine0UnitPrice'],
      ],
      [
        { invoiceLines: [{ ...input.invoiceLines[0], unitPrice: '1.25' }] },
        ['invoiceLine0UnitPrice'],
      ],
      [
        { invoiceLines: [{ ...input.invoiceLines[0], unitPrice: '۱۲۳' }] },
        ['invoiceLine0UnitPrice'],
      ],
      [{ invoiceLines: [] }, ['invoiceLines']],
    ] as const) {
      const response = await send('postal-reviewer', path, 'POST', { ...body, ...patch });
      expect(response.status, http.logs()).toBe(400);
      const error = await response.json();
      expect(error).toMatchObject({
        error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields },
      });
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
    }
    for (const rejected of [
      null,
      { ...body, title: '', profileId: 'PRIVATE' },
      { ...body, commercialValue: { kind: 'PRIVATE', secret: 'PRIVATE' } },
      { ...body, commercialValue: { kind: 'PRIVATE', amountIrr: '0', description: 'PRIVATE' } },
      { ...body, source: { kind: 'PRIVATE', expectedReviewHash: 'PRIVATE' } },
      { ...body, source: { kind: 'PRIVATE', templateVersionId: versionId, documentId: versionId } },
      { ...body, title: '', secret: 'PRIVATE' },
      {
        ...body,
        invoiceLines: [{ ...input.invoiceLines[0], unitPrice: 'PRIVATE', secret: 'PRIVATE' }],
      },
      ...(write ? [{ ...body, title: '', expectedReviewHash: 'PRIVATE' }] : []),
    ]) {
      const response = await send('postal-reviewer', path, 'POST', rejected);
      expect(response.status, http.logs()).toBe(400);
      const error = await response.json();
      expect(error).not.toHaveProperty('error.fields');
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
    }
    for (const [user, target, status] of [
      ['postal-buyer', path, 403],
      [
        'postal-reviewer',
        `admin/solar/requests/${randomUUID()}/create-contract${write ? '' : '/review'}`,
        404,
      ],
    ] as const) {
      const response = await send(user, target, 'POST', { ...body, title: '' });
      expect(response.status, http.logs()).toBe(status);
      expect(await response.json()).not.toHaveProperty('error.fields');
    }
  }
  const originalContractPermissions = (
    await http.pool.query<{ permissions: string }>(
      "SELECT permissions FROM staff_roles WHERE role_id='postal-review-staff'"
    )
  ).rows[0]!.permissions;
  const originalContractStepUp = (
    await http.pool.query<{ verified_at: string }>(
      "SELECT step_up_verified_at::text AS verified_at FROM sessions WHERE user_id='postal-reviewer'"
    )
  ).rows[0]!.verified_at;
  try {
    await http.pool.query(
      "UPDATE staff_roles SET permissions='[\"contracts:write\"]' WHERE role_id='postal-review-staff'"
    );
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='postal-reviewer'"
    );
    // Actual preview remains contracts-only/current-session, including its invalid-owned branch.
    const contractsOnlyPreview = await send(
      'postal-reviewer',
      `${contractBase}/review`,
      'POST',
      input
    );
    expect(contractsOnlyPreview.status, http.logs()).toBe(200);
    const contractsOnlyOwned = await send('postal-reviewer', `${contractBase}/review`, 'POST', {
      ...input,
      title: '',
    });
    expect(contractsOnlyOwned.status, http.logs()).toBe(400);
    expect(await contractsOnlyOwned.json()).toMatchObject({ error: { fields: ['title'] } });
    const stepUpDenied = await send('postal-reviewer', contractBase, 'POST', {
      ...input,
      title: '',
      expectedReviewHash: 'a'.repeat(64),
    });
    expect(stepUpDenied.status, http.logs()).toBe(403);
    expect(await stepUpDenied.json()).toMatchObject({
      requiresStepUp: true,
      error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
    });
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=$1::timestamptz WHERE user_id='postal-reviewer'",
      [originalContractStepUp]
    );
    const invoiceDenied = await send('postal-reviewer', contractBase, 'POST', {
      ...input,
      title: '',
      expectedReviewHash: 'a'.repeat(64),
    });
    expect(invoiceDenied.status, http.logs()).toBe(403);
    expect(await invoiceDenied.json()).not.toHaveProperty('error.fields');
    await http.pool.query(
      "UPDATE staff_roles SET permissions='[\"invoices:write\"]' WHERE role_id='postal-review-staff'"
    );
    for (const suffix of ['', '/review']) {
      const denied = await send('postal-reviewer', contractBase + suffix, 'POST', {
        ...input,
        title: '',
        ...(suffix ? {} : { expectedReviewHash: 'a'.repeat(64) }),
      });
      expect(denied.status, http.logs()).toBe(403);
      expect(await denied.json()).not.toHaveProperty('error.fields');
    }
  } finally {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1 WHERE role_id='postal-review-staff'",
      [originalContractPermissions]
    );
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=$1::timestamptz WHERE user_id='postal-reviewer'",
      [originalContractStepUp]
    );
  }
  try {
    await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
    const archived = await send('postal-reviewer', `${contractBase}/review`, 'POST', {
      ...input,
      title: '',
    });
    expect(archived.status, http.logs()).toBe(409);
    expect(await archived.json()).not.toHaveProperty('error.fields');
  } finally {
    await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [profileId]);
  }
  const otherContractProfile = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('postal-other','INDIVIDUAL','ACTIVE') RETURNING id"
    )
  ).rows[0]!.id;
  const foreignScope = await send('postal-reviewer', `${contractBase}/review`, 'POST', {
    ...input,
    profileId: otherContractProfile,
    title: '',
  });
  expect(foreignScope.status, http.logs()).toBe(404);
  expect(await foreignScope.json()).not.toHaveProperty('error.fields');
  try {
    await http.pool.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id='postal-reviewer'");
    for (const suffix of ['', '/review']) {
      const revoked = await send('postal-reviewer', contractBase + suffix, 'POST', {
        ...input,
        title: '',
        ...(suffix ? {} : { expectedReviewHash: 'a'.repeat(64) }),
      });
      expect(revoked.status, http.logs()).toBe(401);
      expect(await revoked.json()).not.toHaveProperty('error.fields');
    }
  } finally {
    await http.pool.query("UPDATE sessions SET revoked_at=NULL WHERE user_id='postal-reviewer'");
  }
  expect(await solarContractEffects()).toEqual(beforeRejectedContract);
  const bad = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/create-contract/review`,
    'POST',
    {
      ...input,
      idempotencyKey: randomUUID(),
      invoiceLines: [{ ...input.invoiceLines[0], unitPrice: '0' }],
    }
  );
  expect(bad.status, http.logs()).toBe(400);
  for (const commercialValue of [
    undefined,
    { kind: 'fixed', amountIrr: '9223372036854775808' },
    { kind: 'variable', description: '   ' },
  ]) {
    const response = await send(
      'postal-reviewer',
      `admin/solar/requests/${id}/create-contract/review`,
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
  const duePeriodId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO service_due_periods(service_type,default_days,effective_from,created_by) VALUES('manual',7,NOW()-INTERVAL '1 day','postal-reviewer') RETURNING id"
    )
  ).rows[0]!.id;
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', input))
      .status
  ).toBe(400);
  const previewResponse = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/create-contract/review`,
    'POST',
    input
  );
  expect(previewResponse.status, http.logs()).toBe(200);
  const preview = (await previewResponse.json()) as {
    hash: string;
    data: { totals: { total: string }; outcome: string };
  };
  expect(preview.data).toMatchObject({
    totals: { total: '100000' },
    outcome: 'draft_contract_and_unpaid_invoice',
  });
  const command = { ...input, expectedReviewHash: preview.hash };
  await http.pool.query('UPDATE service_due_periods SET default_days=8 WHERE id=$1', [duePeriodId]);
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', command))
      .status
  ).toBe(409);
  await http.pool.query('UPDATE service_due_periods SET default_days=7 WHERE id=$1', [duePeriodId]);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', {
        ...command,
        invoiceLines: [{ ...input.invoiceLines[0], unitPrice: '200000' }],
      })
    ).status
  ).toBe(409);
  const alteredTemplate = Buffer.from(templateBytes);
  alteredTemplate[0] = alteredTemplate[0] === 65 ? 66 : 65;
  await s3.send(
    new PutObjectCommand({
      Bucket: 'test-evidence',
      Key: `contract-templates/${versionId}.txt`,
      Body: alteredTemplate,
      ContentType: 'text/plain',
    })
  );
  expect(
    (await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', command))
      .status
  ).toBe(409);
  await s3.send(
    new PutObjectCommand({
      Bucket: 'test-evidence',
      Key: `contract-templates/${versionId}.txt`,
      Body: templateBytes,
      ContentType: 'text/plain',
    })
  );
  await expectSolarStatusRollback(
    http.pool,
    id,
    'contract_created',
    () => send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', command),
    true
  );
  const contract = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/create-contract`,
    'POST',
    command
  );
  expect(contract.status, http.logs()).toBe(200);
  const result = (await contract.json()) as {
    contractId: string;
    invoiceIds: string[];
    status: string;
  };
  expect(result.status).toBe('contract_created');
  await expectSolarStatusDeliveries(http.pool, id, 'postal-buyer', [
    'documents_under_review',
    'waiting_for_postal_submission',
    'postal_documents_received',
    'final_review',
    'approved',
    'contract_created',
  ]);
  const statusDeliveryBeforeReplay = await solarDeliverySnapshot(http.pool, id);
  const sourceAttachment = (
    await http.pool.query(
      `SELECT d.*,v.content FROM contract_documents cd
    JOIN documents d ON d.id=cd.document_id JOIN contract_versions v ON v.id=cd.contract_version_id
    WHERE cd.contract_id=$1 AND cd.role='original'`,
      [result.contractId]
    )
  ).rows;
  expect(sourceAttachment).toHaveLength(1);
  expect(sourceAttachment[0]).toMatchObject({
    state: 'SubmittedForReview',
    scan_state: 'Available',
    detected_mime: 'application/pdf',
    content: {
      solarSource: {
        kind: 'template',
        templateVersionId: versionId,
        checksum: createHash('sha256').update(templateBytes).digest('hex'),
      },
      template: { text: expect.stringContaining('deposit 100000 IRR.') },
    },
  });
  expect(sourceAttachment[0].content.template.text).toContain(input.text);
  expect(sourceAttachment[0].content.template.text).not.toContain('{{');
  expect((await send('postal-buyer', `documents/${sourceAttachment[0].id}/download`)).status).toBe(
    404
  );
  const sourceDownload = await send(
    'postal-reviewer',
    `admin/documents/${sourceAttachment[0].id}/download`
  );
  expect(sourceDownload.status, http.logs()).toBe(200);
  const sourceFile = await fetch(((await sourceDownload.json()) as { url: string }).url);
  expect(sourceFile.status).toBe(200);
  const pdf = Buffer.from(await sourceFile.arrayBuffer());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(sourceAttachment[0].checksum);

  expect(result.invoiceIds).toHaveLength(1);
  expect(Object.keys(result).sort()).toEqual(['contractId', 'invoiceIds', 'status']);
  expect(result.contractId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  expect(result.invoiceIds[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  const storedSolarCommand = (
    await http.pool.query<{
      idempotency_key: string;
      response: { request: unknown; result: unknown };
    }>(
      "SELECT idempotency_key,response FROM idempotency_keys WHERE entity_type='solar_contract_create' AND idempotency_key=$1",
      [`postal-reviewer:${input.idempotencyKey}`]
    )
  ).rows[0]!;
  expect(storedSolarCommand.response.request).toEqual({ ...command, requestId: id });
  expect(storedSolarCommand.response.result).toEqual(result);
  const recordedReview = (
    await http.pool.query<{ review: { hash: string; data: { totals: { total: string } } } }>(
      "SELECT metadata::jsonb->'financialReview' AS review FROM audit_log WHERE event='solar.contract.created' AND metadata::jsonb->>'requestId'=$1",
      [id]
    )
  ).rows[0]!.review;
  expect(recordedReview).toMatchObject({
    hash: preview.hash,
    data: { totals: { total: '100000' } },
  });
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
      await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', command)
    ).json()
  ).toEqual(result);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/create-contract`, 'POST', {
        ...input,
        idempotencyKey: randomUUID(),
        expectedReviewHash: preview.hash,
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
    history: Array<{ event: string; at: string; actorContext: 'customer' | 'staff' | 'unknown' }>;
  };
  const events = detail.history.map((entry) => entry.event);
  expect(events[0]).toBe('solar.request.submitted');
  expect(events).toContain('solar.final.review_started');
  expect(events).toContain('solar.final.approve');
  expect(events.at(-1)).toBe('solar.contract.created');
  expect(
    detail.history.every((entry) => Object.keys(entry).sort().join(',') === 'actorContext,at,event')
  ).toBe(true);
  expect(detail.history[0]).toMatchObject({ actorContext: 'customer' });
  expect(detail.history.at(-1)).toMatchObject({ actorContext: 'staff' });
  expect(
    detail.history.every((entry) => ['customer', 'staff', 'unknown'].includes(entry.actorContext))
  ).toBe(true);
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
  const afterPublishedContract = await solarContractEffects();
  // A real lifecycle advance cannot recreate or change the saved original creation receipt.
  const progressedReplay = await send('postal-reviewer', contractBase, 'POST', command);
  expect(await solarDeliverySnapshot(http.pool, id)).toEqual(statusDeliveryBeforeReplay);
  expect(progressedReplay.status, http.logs()).toBe(200);
  expect(await progressedReplay.json()).toEqual(result);
  const alteredReplay = await send('postal-reviewer', contractBase, 'POST', {
    ...command,
    text: 'Changed captured terms',
  });
  expect(alteredReplay.status, http.logs()).toBe(409);
  const otherStaff = 'solar-contract-other-staff',
    otherSession = randomUUID(),
    otherCsrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',true)",
    [otherStaff, `${otherStaff}@example.test`]
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES($1,'postal-review-staff')",
    [otherStaff]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [otherSession, otherStaff, otherCsrf, randomUUID()]
  );
  headers[otherStaff] = {
    Cookie: `barghsa_session=${otherSession}`,
    'X-CSRF-Token': otherCsrf,
    'Content-Type': 'application/json',
  };
  const foreignActorReplay = await send(otherStaff, contractBase, 'POST', command);
  expect(foreignActorReplay.status, http.logs()).toBe(409);
  expect(await solarContractEffects()).toEqual(afterPublishedContract);
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
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST', {
        expectedReviewHash: staleReviewHash,
      })
    ).status
  ).toBe(409);
  expect(
    (
      await send('postal-buyer', `admin/solar/requests/${requestId}/close-no-contract`, 'POST', {
        reason: 'No',
        expectedReviewHash: staleReviewHash,
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
  await expectSolarAuditRollback(http.pool, 'solar.postal_guidance.updated', () =>
    send('postal-reviewer', 'admin/solar/postal-guidance', 'PUT', guidance)
  );
  expect(
    (await send('postal-reviewer', 'admin/solar/postal-guidance', 'PUT', guidance)).status,
    http.logs()
  ).toBe(200);
  await expectSolarAudit(http.pool, 'solar.postal_guidance.updated', 'solar.postal_guidance', {
    entity: 'app_config',
    fromState: null,
    toState: 1,
    reason: null,
    actor: 'postal-reviewer',
    originals: 1,
  });
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
  expect(await (await send('postal-buyer', `documents/${receiptImageId}`)).json()).toMatchObject({
    permissions: { download: true, write: true, remove: true, replace: false },
  });
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
  await expectSolarAuditRollback(http.pool, 'solar.postal.shipped', () =>
    send('postal-buyer', `solar/requests/${requestId}/postal/shipment`, 'POST', shipment)
  );
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
  const incompleteReview = await reviewPostal(
    requestId,
    'incomplete',
    'Please send the signed original.'
  );
  expect(incompleteReview.data).toMatchObject({
    trackingNumber: 'TRACK-123',
    reason: 'Please send the signed original.',
    requestOutcome: 'waiting_for_postal_submission',
  });
  expect(
    (
      await send(
        'postal-reviewer',
        `admin/solar/requests/${requestId}/postal/mark-incomplete`,
        'POST',
        {
          reason: 'Different reason',
          expectedReviewHash: incompleteReview.hash,
        }
      )
    ).status
  ).toBe(409);
  await expectSolarAuditRollback(http.pool, 'solar.postal.incomplete', () =>
    send('postal-reviewer', `admin/solar/requests/${requestId}/postal/mark-incomplete`, 'POST', {
      reason: 'Please send the signed original.',
      expectedReviewHash: incompleteReview.hash,
    })
  );
  const incomplete = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/postal/mark-incomplete`,
    'POST',
    { reason: 'Please send the signed original.', expectedReviewHash: incompleteReview.hash }
  );
  expect(incomplete.status, http.logs()).toBe(200);
  await expectSolarPostalAudit(http.pool, 'solar.postal.incomplete', requestId, {
    fromState: 'shipped',
    toState: 'incomplete',
    reason: 'Please send the signed original.',
    actor: 'postal-reviewer',
    profileId,
    requestFromState: 'waiting_for_postal_submission',
    requestToState: 'waiting_for_postal_submission',
  });
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
  const receivedBeforeIssue = await reviewPostal(requestId, 'received');
  const missingReview = await reviewPostal(
    requestId,
    'not_received',
    'Courier could not locate it.'
  );
  expect(missingReview.data.trackingNumber).toBe('TRACK-456');
  expect(
    (
      await send(
        'postal-reviewer',
        `admin/solar/requests/${requestId}/postal/mark-not-received`,
        'POST',
        { reason: 'Courier could not locate it.', expectedReviewHash: missingReview.hash }
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
  expect(
    (
      await send(
        'postal-reviewer',
        `admin/solar/requests/${requestId}/postal/confirm-received`,
        'POST',
        {
          expectedReviewHash: receivedBeforeIssue.hash,
        }
      )
    ).status
  ).toBe(409);
  const receivedReview = await reviewPostal(requestId, 'received');
  expect(receivedReview.data).toMatchObject({
    trackingNumber: 'TRACK-789',
    requestOutcome: 'postal_documents_received',
  });
  await expectSolarAuditRollback(http.pool, 'solar.postal.received', () =>
    send('postal-reviewer', `admin/solar/requests/${requestId}/postal/confirm-received`, 'POST', {
      expectedReviewHash: receivedReview.hash,
    })
  );
  const received = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/postal/confirm-received`,
    'POST',
    { expectedReviewHash: receivedReview.hash }
  );
  expect(received.status, http.logs()).toBe(200);
  await expectSolarPostalAudit(http.pool, 'solar.postal.received', requestId, {
    fromState: 'shipped',
    toState: 'received',
    reason: null,
    actor: 'postal-reviewer',
    profileId,
    requestFromState: 'waiting_for_postal_submission',
    requestToState: 'postal_documents_received',
  });
  await expectSolarPostalAudit(http.pool, 'solar.postal.not_received', requestId, {
    fromState: 'shipped',
    toState: 'not_received',
    reason: 'Courier could not locate it.',
    actor: 'postal-reviewer',
  });
  for (const [fromState, trackingNumber] of [
    ['waiting_for_shipment', 'TRACK-123'],
    ['incomplete', 'TRACK-456'],
    ['not_received', 'TRACK-789'],
  ])
    await expectSolarPostalAudit(http.pool, 'solar.postal.shipped', requestId, {
      fromState,
      toState: 'shipped',
      reason: null,
      actor: 'postal-buyer',
      trackingNumber,
      profileId,
      requestFromState: 'waiting_for_postal_submission',
      requestToState: 'waiting_for_postal_submission',
    });
  expect(await received.json()).toMatchObject({
    status: 'received',
    requestStatus: 'postal_documents_received',
  });
  const postalAudit = await http.pool.query<{ event: string; hash: string }>(
    `SELECT event,metadata::jsonb->'financialReview'->>'hash' AS hash FROM audit_log
     WHERE metadata::jsonb->>'requestId'=$1 AND event IN
       ('solar.postal.incomplete','solar.postal.not_received','solar.postal.received')
     ORDER BY created_at`,
    [requestId]
  );
  expect(postalAudit.rows).toEqual([
    { event: 'solar.postal.incomplete', hash: incompleteReview.hash },
    { event: 'solar.postal.not_received', hash: missingReview.hash },
    { event: 'solar.postal.received', hash: receivedReview.hash },
  ]);
  expect(
    await (await send('postal-reviewer', 'admin/solar/postal-queue?lane=needs_staff')).json()
  ).toMatchObject({ requests: [{ id: requestId, request_status: 'postal_documents_received' }] });
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST', {
        expectedReviewHash: staleReviewHash,
      })
    ).status
  ).toBe(409);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/final-reject`, 'POST', {
        reason: 'Review has not begun',
        expectedReviewHash: staleReviewHash,
      })
    ).status
  ).toBe(409);
  expect(
    (await send('postal-buyer', `admin/solar/requests/${requestId}/start-final-review`, 'POST'))
      .status
  ).toBe(403);
  await expectSolarAuditRollback(http.pool, 'solar.final.review_started', () =>
    send('postal-reviewer', `admin/solar/requests/${requestId}/start-final-review`, 'POST')
  );
  const reviewStarted = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/start-final-review`,
    'POST'
  );
  expect(reviewStarted.status, http.logs()).toBe(200);
  await expectSolarAudit(http.pool, 'solar.final.review_started', requestId, {
    entity: 'solar_construction_request',
    fromState: 'postal_documents_received',
    toState: 'final_review',
    reason: null,
    actor: 'postal-reviewer',
  });
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
  expect(
    (
      await send(
        'postal-buyer',
        `admin/solar/requests/${requestId}/final-decision/review`,
        'POST',
        { decision: 'approve' }
      )
    ).status
  ).toBe(403);
  const approvalReview = await reviewFinal(requestId, 'approve');
  expect(approvalReview.data).toMatchObject({
    currentStatus: 'final_review',
    postalStatus: 'received',
    outcome: 'approved',
    createsContract: false,
    createsInvoice: false,
  });
  const staleClose = await reviewFinal(requestId, 'close-no-contract', 'Site cannot proceed.');
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST', {
        expectedReviewHash: staleReviewHash,
      })
    ).status
  ).toBe(409);
  await expectSolarAuditRollback(http.pool, 'solar.final.approve', () =>
    send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST', {
      expectedReviewHash: approvalReview.hash,
    })
  );
  const approved = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/final-approve`,
    'POST',
    { expectedReviewHash: approvalReview.hash }
  );
  expect(approved.status, http.logs()).toBe(200);
  await expectSolarAudit(http.pool, 'solar.final.approve', requestId, {
    entity: 'solar_construction_request',
    fromState: 'final_review',
    toState: 'approved',
    reason: null,
    actor: 'postal-reviewer',
  });
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
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/final-approve`, 'POST', {
        expectedReviewHash: approvalReview.hash,
      })
    ).status
  ).toBe(409);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/close-no-contract`, 'POST', {
        reason: '',
        expectedReviewHash: staleClose.hash,
      })
    ).status
  ).toBe(400);
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${requestId}/close-no-contract`, 'POST', {
        reason: 'Site cannot proceed.',
        expectedReviewHash: staleClose.hash,
      })
    ).status
  ).toBe(409);
  const closeReview = await reviewFinal(requestId, 'close-no-contract', 'Site cannot proceed.');
  expect(closeReview.data).toMatchObject({ currentStatus: 'approved', outcome: 'cancelled' });
  await expectSolarAuditRollback(http.pool, 'solar.final.close-no-contract', () =>
    send('postal-reviewer', `admin/solar/requests/${requestId}/close-no-contract`, 'POST', {
      reason: 'Site cannot proceed.',
      expectedReviewHash: closeReview.hash,
    })
  );
  const closed = await send(
    'postal-reviewer',
    `admin/solar/requests/${requestId}/close-no-contract`,
    'POST',
    { reason: 'Site cannot proceed.', expectedReviewHash: closeReview.hash }
  );
  expect(closed.status, http.logs()).toBe(200);
  await expectSolarAudit(http.pool, 'solar.final.close-no-contract', requestId, {
    entity: 'solar_construction_request',
    fromState: 'approved',
    toState: 'cancelled',
    reason: 'Site cannot proceed.',
    actor: 'postal-reviewer',
  });
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
  const decisionAudits = await http.pool.query<{ event: string; hash: string }>(
    `SELECT event,metadata::jsonb->'financialReview'->>'hash' AS hash FROM audit_log
     WHERE event IN ('solar.final.approve','solar.final.close-no-contract')
       AND metadata::jsonb->>'requestId'=$1`,
    [requestId]
  );
  expect(Object.fromEntries(decisionAudits.rows.map((row) => [row.event, row.hash]))).toEqual({
    'solar.final.approve': approvalReview.hash,
    'solar.final.close-no-contract': closeReview.hash,
  });
}, 90_000);

it('rejects a final solar request with a customer-visible reason after postal receipt', async () => {
  const created = await submitSolar({
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    siteAddressId,
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
        expectedReviewHash: staleReviewHash,
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
  expect((await advanceDocuments(id)).status, http.logs()).toBe(200);
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
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/postal/confirm-received`, 'POST', {
        expectedReviewHash: (await reviewPostal(id, 'received')).hash,
      })
    ).status,
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
        expectedReviewHash: staleReviewHash,
      })
    ).status
  ).toBe(400);
  expect(
    (
      await send('postal-other', `admin/solar/requests/${id}/final-reject`, 'POST', {
        reason: 'Unauthorized',
        expectedReviewHash: staleReviewHash,
      })
    ).status
  ).toBe(403);
  const rejectionReview = await reviewFinal(id, 'reject', 'The project cannot proceed.');
  expect(rejectionReview.data).toMatchObject({
    currentStatus: 'final_review',
    reason: 'The project cannot proceed.',
    outcome: 'rejected',
  });
  expect(
    (
      await send('postal-reviewer', `admin/solar/requests/${id}/final-reject`, 'POST', {
        reason: 'A different reason',
        expectedReviewHash: rejectionReview.hash,
      })
    ).status
  ).toBe(409);
  await expectSolarAuditRollback(http.pool, 'solar.final.reject', () =>
    send('postal-reviewer', `admin/solar/requests/${id}/final-reject`, 'POST', {
      reason: '  The project cannot proceed.  ',
      expectedReviewHash: rejectionReview.hash,
    })
  );
  const rejected = await send(
    'postal-reviewer',
    `admin/solar/requests/${id}/final-reject`,
    'POST',
    {
      reason: '  The project cannot proceed.  ',
      expectedReviewHash: rejectionReview.hash,
    }
  );
  expect(rejected.status, http.logs()).toBe(200);
  await expectSolarAudit(http.pool, 'solar.final.reject', id, {
    entity: 'solar_construction_request',
    fromState: 'final_review',
    toState: 'rejected',
    reason: 'The project cannot proceed.',
    actor: 'postal-reviewer',
  });
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
      await http.pool.query<{ hash: string }>(
        "SELECT metadata::jsonb->'financialReview'->>'hash' AS hash FROM audit_log WHERE event='solar.final.reject' AND metadata::jsonb->>'requestId'=$1",
        [id]
      )
    ).rows[0]!.hash
  ).toBe(rejectionReview.hash);
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
        expectedReviewHash: rejectionReview.hash,
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

it('audits guidance version changes and rolls back skipped writes and audit failures before a corrected retry', async () => {
  const guidance = {
    fa: 'ارسال اصل مدارک',
    en: 'Send original documents',
    destinationAddress: 'Updated office',
    contactDetails: 'Support',
    originals: [{ fa: 'اصل سند', en: 'Original deed' }],
  };
  const snapshot = async () =>
    (
      await http.pool.query(
        `SELECT (SELECT to_jsonb(c) FROM app_config c WHERE key='solar.postal_guidance') AS guidance,(SELECT to_jsonb(c) FROM config_version c WHERE id='global') AS global,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE event='solar.postal_guidance.updated') AS audits`
      )
    ).rows[0];
  const before = await snapshot();
  await http.pool.query(
    `CREATE FUNCTION skip_postal_guidance_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='solar.postal_guidance' THEN RETURN NULL; END IF; RETURN NEW; END $$;CREATE TRIGGER skip_postal_guidance_write BEFORE INSERT ON app_config FOR EACH ROW EXECUTE FUNCTION skip_postal_guidance_write()`
  );
  try {
    const response = await send('postal-reviewer', 'admin/solar/postal-guidance', 'PUT', guidance);
    expect(response.status, http.logs()).toBe(409);
    expect(await snapshot()).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER skip_postal_guidance_write ON app_config;DROP FUNCTION skip_postal_guidance_write()'
    );
  }
  await expectSolarAuditRollback(http.pool, 'solar.postal_guidance.updated', () =>
    send('postal-reviewer', 'admin/solar/postal-guidance', 'PUT', guidance)
  );
  expect(
    (await send('postal-reviewer', 'admin/solar/postal-guidance', 'PUT', guidance)).status,
    http.logs()
  ).toBe(200);
  await expectSolarAudit(http.pool, 'solar.postal_guidance.updated', 'solar.postal_guidance', {
    entity: 'app_config',
    fromState: before.guidance.version,
    toState: before.guidance.version + 1,
    reason: null,
    actor: 'postal-reviewer',
    originals: 1,
  });
  const after = await snapshot();
  expect(after.guidance.value).toEqual(guidance);
  expect(after.global.version).toBe(before.global.version + 1);
  expect(after.audits.slice(0, -1)).toEqual(before.audits);
});

it('keeps the specified staff postal and final routes bound to current shipment and financial reviews', async () => {
  const createTarget = async () =>
    (
      await http.pool.query<{ id: string }>(
        `INSERT INTO solar_construction_requests
         (id,profile_id,submitted_by,submission_key,status,building_type,grid_type,
          property_form,structural_frame,building_completion_date,agreement_accepted,
          agreement_version,agreement_snapshot,agreement_accepted_at)
         SELECT uuid_generate_v7(),profile_id,submitted_by,uuid_generate_v7(),
          'waiting_for_postal_submission',building_type,grid_type,property_form,
          structural_frame,building_completion_date,agreement_accepted,agreement_version,
          agreement_snapshot,agreement_accepted_at
         FROM solar_construction_requests WHERE id=$1 RETURNING id`,
        [requestId]
      )
    ).rows[0]!.id;
  const target = await createTarget();
  await http.pool.query('INSERT INTO solar_construction_postal(request_id) VALUES($1)', [target]);
  const base = `staff/solar/requests/${target}`;
  const counts = async () =>
    (
      await http.pool.query(
        'SELECT (SELECT count(*) FROM contracts)::int AS contracts,(SELECT count(*) FROM invoices)::int AS invoices'
      )
    ).rows[0];
  const before = await counts();
  for (const [decision, action] of [
    ['incomplete', 'mark-incomplete'],
    ['not_received', 'mark-not-received'],
    ['received', 'confirm-received'],
  ] as const) {
    // Isolate the staff-route fixture from the shared customer's shipment IP quota.
    // Existing cases above exercise actual shipment submission and resubmission.
    await http.pool.query(
      `UPDATE solar_construction_postal SET status='shipped',courier=$2,
       tracking_number=$3,send_date='2026-01-02' WHERE request_id=$1`,
      [target, 'Alias parcel company', `ALIAS-${decision}`]
    );
    const reason = decision === 'received' ? undefined : `Parcel ${decision}`;
    const review = await send('postal-reviewer', `${base}/postal/review`, 'POST', {
      decision,
      ...(reason ? { reason } : {}),
    });
    expect(review.status, http.logs()).toBe(200);
    const body = {
      expectedReviewHash: ((await review.json()) as { hash: string }).hash,
      ...(reason ? { reason } : {}),
    };
    expect((await send('postal-buyer', `${base}/postal/${action}`, 'POST', body)).status).toBe(403);
    const result = await send('postal-reviewer', `${base}/postal/${action}`, 'POST', body);
    expect(result.status, http.logs()).toBe(200);
    expect(await result.json()).toEqual({
      status: decision,
      requestStatus:
        decision === 'received' ? 'postal_documents_received' : 'waiting_for_postal_submission',
    });
    expect((await send('postal-reviewer', `${base}/postal/${action}`, 'POST', body)).status).toBe(
      409
    );
  }
  expect((await send('postal-reviewer', `${base}/start-final-review`, 'POST', {})).status).toBe(
    200
  );
  const approvalReview = await send('postal-reviewer', `${base}/final-decision/review`, 'POST', {
    decision: 'approve',
  });
  expect(approvalReview.status, http.logs()).toBe(200);
  const approved = await send('postal-reviewer', `${base}/final-approve`, 'POST', {
    expectedReviewHash: ((await approvalReview.json()) as { hash: string }).hash,
  });
  expect(approved.status, http.logs()).toBe(200);
  expect(await approved.json()).toEqual({ status: 'approved' });
  expect(await counts()).toEqual(before);
  const template = randomUUID(),
    version = randomUUID();
  await http.pool.query(
    "INSERT INTO contract_templates(id,name,status,created_by) VALUES($1,'Staff route template','active','postal-reviewer')",
    [template]
  );
  await http.pool.query(
    "INSERT INTO contract_template_versions(id,template_id,version_number,storage_key,file_name,created_by) VALUES($1,$2,1,$3,'solar.txt','postal-reviewer')",
    [version, template, `contract-templates/${version}.txt`]
  );
  await storeTemplate(version);
  const input = {
    profileId,
    idempotencyKey: randomUUID(),
    title: 'Staff route solar contract',
    text: 'Reviewed solar terms',
    changeDescription: 'Initial solar draft',
    commercialValue: { kind: 'fixed', amountIrr: '100000' },
    source: { kind: 'template', templateVersionId: version },
    invoiceLines: [
      { description: 'Deposit', quantity: 1, unitPrice: '100000', vatRate: 0, isTaxable: false },
    ],
  };
  const contractReview = await send(
    'postal-reviewer',
    `${base}/create-contract/review`,
    'POST',
    input
  );
  expect(contractReview.status, http.logs()).toBe(200);
  const body = {
    ...input,
    expectedReviewHash: ((await contractReview.json()) as { hash: string }).hash,
  };
  expect((await send('postal-buyer', `${base}/create-contract`, 'POST', body)).status).toBe(403);
  const creation = await send('postal-reviewer', `${base}/create-contract`, 'POST', body);
  expect(creation.status, http.logs()).toBe(200);
  const receipt = (await creation.json()) as { contractId: string; invoiceIds: string[] };
  expect(receipt).toMatchObject({
    status: 'contract_created',
    contractId: expect.any(String),
    invoiceIds: [expect.any(String)],
  });
  const replay = await send('postal-reviewer', `${base}/create-contract`, 'POST', body);
  expect(replay.status, http.logs()).toBe(200);
  expect(await replay.json()).toEqual(receipt);
  expect(await counts()).toEqual({
    contracts: before.contracts + 1,
    invoices: before.invoices + 1,
  });
  const closedTarget = await createTarget();
  await http.pool.query("UPDATE solar_construction_requests SET status='approved' WHERE id=$1", [
    closedTarget,
  ]);
  const closeBase = `staff/solar/requests/${closedTarget}`;
  const reason = 'Owner chose not to proceed';
  const closeReview = await send('postal-reviewer', `${closeBase}/final-decision/review`, 'POST', {
    decision: 'close-no-contract',
    reason,
  });
  expect(closeReview.status, http.logs()).toBe(200);
  const closeBody = {
    reason,
    expectedReviewHash: ((await closeReview.json()) as { hash: string }).hash,
  };
  expect(
    (await send('postal-buyer', `${closeBase}/close-no-contract`, 'POST', closeBody)).status
  ).toBe(403);
  const closed = await send('postal-reviewer', `${closeBase}/close-no-contract`, 'POST', closeBody);
  expect(closed.status, http.logs()).toBe(200);
  expect(await closed.json()).toEqual({ status: 'cancelled' });
  expect(await counts()).toEqual({
    contracts: before.contracts + 1,
    invoices: before.invoices + 1,
  });
}, 90_000);

it('copies an owned uploaded source immutably with audit rollback and an exact replay', async () => {
  const target = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO solar_construction_requests
    (id,profile_id,submitted_by,submission_key,status,building_type,grid_type,property_form,
     structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at)
    SELECT uuid_generate_v7(),profile_id,submitted_by,uuid_generate_v7(),'uploading_documents',
      building_type,grid_type,property_form,structural_frame,building_completion_date,
      agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at
    FROM solar_construction_requests WHERE id=$1 RETURNING id`,
      [requestId]
    )
  ).rows[0]!.id;
  const bytes = await renderContractPdf({
    contractNumber: '123',
    versionNumber: 1,
    templateName: 'Uploaded solar terms',
    text: 'Retained uploaded agreement bytes',
    createdAt: new Date('2026-01-02T00:00:00Z'),
  });
  const create = await send('postal-buyer', 'documents', 'POST', {
    profileId,
    businessRecordType: 'solar_request',
    businessRecordId: target,
    category: 'document',
    fileName: 'solar-agreement.pdf',
    contentType: 'application/pdf',
    fileSize: bytes.length,
    idempotencyKey: randomUUID(),
  });
  expect(create.status, http.logs()).toBe(201);
  const document = (await create.json()) as {
    document: { id: string };
    upload: { presignedUrl: string; headers: Record<string, string> };
  };
  expect(
    (
      await fetch(document.upload.presignedUrl, {
        method: 'PUT',
        headers: { ...document.upload.headers, 'Content-Type': 'application/pdf' },
        body: bytes,
      })
    ).status
  ).toBe(200);
  const confirmed = await send(
    'postal-buyer',
    `documents/${document.document.id}/confirm`,
    'POST',
    {
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    }
  );
  expect(confirmed.status, http.logs()).toBe(200);
  expect(await confirmed.json()).toMatchObject({ state: 'Available' });
  await http.pool.query("UPDATE solar_construction_requests SET status='approved' WHERE id=$1", [
    target,
  ]);
  await http.pool.query(
    "UPDATE contract_activation_rules SET payment_required=true,revision=revision+1 WHERE service_type='solar'"
  );
  const base = `staff/solar/requests/${target}/create-contract`;
  const input = {
    profileId,
    idempotencyKey: randomUUID(),
    title: 'Uploaded terms contract',
    text: 'Staff supplemental terms',
    changeDescription: 'Initial uploaded-source draft',
    commercialValue: { kind: 'fixed', amountIrr: '100000' },
    source: { kind: 'document', documentId: document.document.id },
    invoiceLines: [
      {
        description: 'Deposit',
        quantity: 1,
        unitPrice: '100000',
        vatRate: 0,
        isTaxable: false,
      },
    ],
  };
  const preview = await send('postal-reviewer', base + '/review', 'POST', input);
  expect(preview.status, http.logs()).toBe(200);
  const review = (await preview.json()) as Awaited<ReturnType<ContractService['reviewSolar']>>;
  expect(review.data.source).toMatchObject({
    kind: 'document',
    documentId: document.document.id,
    checksum: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  });
  expect(review.data.activationRequirements.payment_required).toBe(true);
  const command = { ...input, expectedReviewHash: review.hash };
  const effects = async () => ({
    request: (
      await http.pool.query(
        'SELECT status,contract_id FROM solar_construction_requests WHERE id=$1',
        [target]
      )
    ).rows,
    contracts: (await http.pool.query('SELECT id FROM contracts ORDER BY id')).rows,
    invoices: (await http.pool.query('SELECT id FROM invoices ORDER BY id')).rows,
    documents: (await http.pool.query('SELECT id,state,checksum FROM documents ORDER BY id')).rows,
    notices: (await http.pool.query('SELECT id FROM in_app_notifications ORDER BY id')).rows,
    audits: (await http.pool.query('SELECT id FROM audit_log ORDER BY id')).rows,
  });
  const before = await effects();
  await expectSolarAuditRollback(http.pool, 'solar.contract.created', () =>
    send('postal-reviewer', base, 'POST', command)
  );
  expect(await effects()).toEqual(before);
  const retained = (
    await http.pool.query(
      `SELECT status,metadata FROM storage_records
    WHERE metadata->>'purpose'='solar_contract_source' AND metadata->'selectedSource'->>'documentId'=$1`,
      [document.document.id]
    )
  ).rows;
  expect(retained.length).toBeGreaterThan(0);
  expect(
    retained.every((row) => row.status === 'removed' && row.metadata.deletionRequested === true)
  ).toBe(true);
  const creation = await send('postal-reviewer', base, 'POST', command);
  expect(creation.status, http.logs()).toBe(200);
  const receipt = (await creation.json()) as { contractId: string; invoiceIds: string[] };
  expect(
    (
      await http.pool.query(
        `SELECT ar.initial_invoice_id,ar.payment_required FROM contract_activation_requirements ar
    JOIN contracts c ON c.current_version_id=ar.version_id WHERE c.id=$1`,
        [receipt.contractId]
      )
    ).rows[0]
  ).toMatchObject({ initial_invoice_id: receipt.invoiceIds[0], payment_required: true });
  const activation = await send(
    'postal-reviewer',
    `admin/contracts/${receipt.contractId}/activation`
  );
  expect(activation.status, http.logs()).toBe(200);
  expect(await activation.json()).toMatchObject({
    ready: false,
    checks: expect.arrayContaining([
      expect.objectContaining({ key: 'initialPayment', status: 'unmet' }),
      expect.objectContaining({ key: 'staffApproval', status: 'unmet' }),
    ]),
  });
  const copy = (
    await http.pool.query(
      `SELECT d.*,s.metadata FROM contract_documents cd
    JOIN documents d ON d.id=cd.document_id JOIN storage_records s ON s.storage_key=d.storage_key
    WHERE cd.contract_id=$1`,
      [receipt.contractId]
    )
  ).rows;
  expect(copy).toHaveLength(1);
  expect(copy[0]).toMatchObject({
    business_record_type: 'contract',
    original_name: 'solar-agreement.pdf',
    state: 'SubmittedForReview',
    checksum: createHash('sha256').update(bytes).digest('hex'),
    metadata: { selectedSource: { documentId: document.document.id } },
  });
  const downloaded = await send('postal-reviewer', `admin/documents/${copy[0].id}/download`);
  expect(downloaded.status, http.logs()).toBe(200);
  expect(
    Buffer.from(
      await (await fetch(((await downloaded.json()) as { url: string }).url)).arrayBuffer()
    )
  ).toEqual(bytes);
  const after = await effects();
  const replay = await send('postal-reviewer', base, 'POST', command);
  expect(replay.status, http.logs()).toBe(200);
  expect(await replay.json()).toEqual(receipt);
  expect(await effects()).toEqual(after);
  expect(
    (
      await http.pool.query('SELECT state,business_record_id FROM documents WHERE id=$1', [
        document.document.id,
      ])
    ).rows[0]
  ).toMatchObject({ state: 'Available', business_record_id: target });
}, 90000);

it('keeps generated solar originals pending with a durable job when scanning is configured', async () => {
  const child = fork(resolve(__dirname, '../../scripts/http-test-server.cjs'), [], {
    silent: true,
    env: {
      ...process.env,
      DATABASE_URL: http.pool.options.connectionString!,
      PGDIRECT_URL: http.pool.options.connectionString!,
      NODE_ENV: 'test',
      APP_PUBLIC_URL: 'https://app.example.test',
      DOCUMENT_CLAMAV_HOST: 'test-clamav.invalid',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'http-fixture-delivery-key-only',
      STORAGE_CONFIG_ENCRYPTION_KEY: 'http-fixture-storage-key-only',
      AI_MODEL_ENCRYPTION_KEY: 'http-fixture-ai-key-only',
      REDIS_URL: '',
      REDIS_HOST: '',
      S3_BUCKET: 'test-evidence',
      S3_REGION: 'us-east-1',
      S3_PRIVATE_ENDPOINT: '',
      S3_PUBLIC_ENDPOINT: '',
      S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: 'test-only-key',
      S3_SECRET_ACCESS_KEY: 'test-only-secret',
    },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (data) => {
      output = (output + String(data)).slice(-10000);
    });
  try {
    const port = await new Promise<number>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Scan fixture startup: ' + output)), 20000);
      child.once('message', (message) => {
        clearTimeout(timer);
        done((message as { port: number }).port);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error('Scan fixture exited ' + code + ': ' + output));
      });
    });
    const target = (
      await http.pool.query<{ id: string }>(
        `INSERT INTO solar_construction_requests
      (id,profile_id,submitted_by,submission_key,status,building_type,grid_type,property_form,
       structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at)
      SELECT uuid_generate_v7(),profile_id,submitted_by,uuid_generate_v7(),'approved',building_type,grid_type,
       property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,
       agreement_snapshot,agreement_accepted_at FROM solar_construction_requests WHERE id=$1 RETURNING id`,
        [requestId]
      )
    ).rows[0]!.id;
    const template = randomUUID(),
      version = randomUUID();
    await http.pool.query(
      "INSERT INTO contract_templates(id,name,status,created_by) VALUES($1,'Scan template','active','postal-reviewer')",
      [template]
    );
    await http.pool.query(
      "INSERT INTO contract_template_versions(id,template_id,version_number,storage_key,file_name,created_by) VALUES($1,$2,1,$3,'solar.txt','postal-reviewer')",
      [version, template, `contract-templates/${version}.txt`]
    );
    await storeTemplate(version);
    const base = `http://127.0.0.1:${port}/api/staff/solar/requests/${target}/create-contract`;
    const input = {
      profileId,
      idempotencyKey: randomUUID(),
      title: 'Scanned solar original',
      text: 'Scan-protected terms',
      changeDescription: 'Initial scan-protected draft',
      commercialValue: { kind: 'fixed', amountIrr: '100000' },
      source: { kind: 'template', templateVersionId: version },
      invoiceLines: [
        {
          description: 'Deposit',
          quantity: 1,
          unitPrice: '100000',
          vatRate: 0,
          isTaxable: false,
        },
      ],
    };
    const preview = await fetch(base + '/review', {
      method: 'POST',
      headers: headers['postal-reviewer']!,
      body: JSON.stringify(input),
    });
    expect(preview.status, output).toBe(200);
    const command = {
      ...input,
      expectedReviewHash: ((await preview.json()) as { hash: string }).hash,
    };
    const create = await fetch(base, {
      method: 'POST',
      headers: headers['postal-reviewer']!,
      body: JSON.stringify(command),
    });
    expect(create.status, output).toBe(200);
    const result = (await create.json()) as { contractId: string };
    const documents = (
      await http.pool.query(
        `SELECT d.* FROM contract_documents cd JOIN documents d ON d.id=cd.document_id
      WHERE cd.contract_id=$1`,
        [result.contractId]
      )
    ).rows;
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      state: 'PendingScan',
      scan_state: 'Pending',
      scan_skipped_reason: null,
    });
    expect(
      (
        await http.pool.query(
          'SELECT document_id,attempts,verdict,completed_at FROM document_scan_jobs WHERE document_id=$1',
          [documents[0].id]
        )
      ).rows
    ).toEqual([{ document_id: documents[0].id, attempts: 0, verdict: null, completed_at: null }]);
    const download = await fetch(
      `http://127.0.0.1:${port}/api/admin/documents/${documents[0].id}/download`,
      {
        headers: headers['postal-reviewer']!,
      }
    );
    expect(download.status, output).toBe(409);
    expect(
      (
        await http.pool.query(
          'SELECT state FROM document_events WHERE document_id=$1 ORDER BY revision',
          [documents[0].id]
        )
      ).rows.map((row) => row.state)
    ).not.toContain('SubmittedForReview');
    const replay = await fetch(base, {
      method: 'POST',
      headers: headers['postal-reviewer']!,
      body: JSON.stringify(command),
    });
    expect(replay.status, output).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(
      (
        await http.pool.query(
          'SELECT count(*)::int AS n FROM document_scan_jobs WHERE document_id=$1',
          [documents[0].id]
        )
      ).rows[0].n
    ).toBe(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((done) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
        child.send('stop');
      });
  }
}, 90000);
