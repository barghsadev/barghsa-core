import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { contractReviewConfirmation } from '../test/contract-review-confirmation.js';
import { activateReadyContracts } from '@barghsa/db/contract-activation';
import type { ContractSignatureService } from './contract-signature.service.js';
type SignatureView = Awaited<ReturnType<ContractSignatureService['get']>>;
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from '../contract/contract.service.js';
import type { DocumentService } from '../documents/document.service.js';

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
type ContractDto = Awaited<ReturnType<ContractService['get']>>;

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
  await login('signature-legal', 'role-legal-contracts');
  await login('signature-finance', 'role-finance');
  await login('signature-operations', 'role-operations');
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

async function contract(
  accepted = true,
  serviceType = 'electricity',
  content: Record<string, unknown> = { text: 'Exact terms' }
) {
  const f = await owner();
  const response = await send('admin/contracts', 'signature-legal', 'POST', {
    profileId: f.profile,
    serviceType,
    content,
    changeDescription: 'Initial',
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  const row = (await response.json()) as ContractDto;
  if (accepted) {
    for (const action of ['submit', 'publish'])
      expect(
        (
          await send(`admin/contracts/${row.id}/${action}`, 'signature-legal', 'POST', {
            expectedVersionId: row.currentVersionId,
            idempotencyKey: randomUUID(),
          })
        ).status
      ).toBe(200);
    expect(
      (
        await send(`contracts/${row.id}/accept`, f.user, 'POST', {
          expectedVersionId: row.currentVersionId,
          idempotencyKey: randomUUID(),
        })
      ).status
    ).toBe(200);
  }
  return { ...f, row };
}
type Fixture = Awaited<ReturnType<typeof contract>>;
async function documentFor(
  f: Fixture,
  role: 'original' | 'signed',
  staff = true,
  approved = true,
  supersedesDocumentId?: string
) {
  const user = staff ? 'signature-legal' : f.user;
  let doc = await confirm(
    await create(
      user,
      {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: f.row.id,
        contractVersionId: f.row.currentVersionId,
        contractRole: role,
        ...(supersedesDocumentId ? { supersedesDocumentId } : {}),
      },
      staff
    ),
    user,
    staff
  );
  if (approved) {
    doc = await act(doc, 'submit', user, staff);
    doc = await act(doc, 'approve', 'signature-legal', true);
  }
  return doc;
}
const requestInput = (f: Fixture, original: string, expectedRequestId: string | null = null) => ({
  expectedVersionId: f.row.currentVersionId,
  originalDocumentId: original,
  expectedRequestId,
  idempotencyKey: randomUUID(),
});
const recordInput = (f: Fixture, requestId: string, signed: string) => ({
  expectedVersionId: f.row.currentVersionId,
  requestId,
  signedDocumentId: signed,
  idempotencyKey: randomUUID(),
});
async function prepare(f: Fixture, original: string, previous: string | null = null) {
  const body = requestInput(f, original, previous);
  const response = await send(
    `admin/contracts/${f.row.id}/signature-request`,
    'signature-legal',
    'POST',
    body
  );
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  return { body, view: (await response.json()) as SignatureView };
}
function record(f: Fixture, body: ReturnType<typeof recordInput>, staff = false) {
  return send(
    `${staff ? 'admin/' : ''}contracts/${f.row.id}/signature`,
    staff ? 'signature-legal' : f.user,
    'POST',
    body
  );
}
it('generates saved electricity terms for the exact version and resumes the same document', async () => {
  const f = await contract(true, 'electricity', {
    template: {
      name: 'Electricity agreement',
      text: 'Saved agreement for this customer.\nPrice: 100 IRR.',
    },
  });
  const path = `admin/contracts/${f.row.id}/versions/${f.row.currentVersionId}/generate-pdf`;
  const body = { idempotencyKey: f.row.currentVersionId };
  const response = await send(path, 'signature-legal', 'POST', body);
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(201);
  const generated = (await response.json()) as DocumentDto;
  expect(generated).toMatchObject({
    state: 'SubmittedForReview',
    contractVersionId: f.row.currentVersionId,
    contractRole: 'original',
    originalName: expect.stringMatching(/^contract-.*\.pdf$/),
  });
  const download = await send(`admin/documents/${generated.id}/download`, 'signature-legal');
  expect(download.status).toBe(200);
  const bytes = await fetch(((await download.json()) as { url: string }).url);
  expect(bytes.status).toBe(200);
  const pdfBytes = Buffer.from(await bytes.arrayBuffer());
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdfBytes.length).toBeGreaterThan(1000);
  const retry = await send(path, 'signature-legal', 'POST', body);
  expect(retry.status).toBe(201);
  expect(((await retry.json()) as DocumentDto).id).toBe(generated.id);
  await http.pool.query(
    `UPDATE idempotency_keys SET response=jsonb_set(response,'{result,expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text))
     WHERE entity_type='document_create' AND idempotency_key=$1`,
    [`signature-legal:${body.idempotencyKey}`]
  );
  const lateRetry = await send(path, 'signature-legal', 'POST', body);
  expect(lateRetry.status).toBe(201);
  expect(((await lateRetry.json()) as DocumentDto).id).toBe(generated.id);
  const count = await http.pool.query<{ count: string }>(
    'SELECT count(*) FROM contract_documents WHERE contract_id=$1 AND contract_version_id=$2',
    [f.row.id, f.row.currentVersionId]
  );
  expect(count.rows[0]?.count).toBe('1');
  const approved = await act(generated, 'approve', 'signature-legal', true);
  expect((await prepare(f, approved.id)).view.request?.originalDocumentId).toBe(approved.id);
});

it('generates an amendment PDF after customer acceptance and makes it signable', async () => {
  const f = await contract();
  const baseOriginal = await documentFor(f, 'original');
  const baseRequest = await prepare(f, baseOriginal.id);
  const baseSigned = await documentFor(f, 'signed', false);
  expect(
    (await record(f, recordInput(f, baseRequest.view.request!.id, baseSigned.id))).status
  ).toBe(200);
  const originalRule = await http.pool.query<{ signature_required: boolean }>(
    "SELECT signature_required FROM contract_activation_rules WHERE service_type='electricity'"
  );
  await http.pool.query(
    "UPDATE contract_activation_rules SET signature_required=true,revision=revision+1 WHERE service_type='electricity'"
  );
  try {
    const proposed = await send(
      `admin/contracts/${f.row.id}/amendments`,
      'signature-legal',
      'POST',
      {
        expectedVersionId: f.row.currentVersionId,
        content: {
          template: { name: 'Revised agreement', text: 'Revised saved electricity terms.' },
        },
        changeDescription: 'Revised agreement',
        idempotencyKey: randomUUID(),
      }
    );
    expect(proposed.status, await proposed.clone().text()).toBe(201);
    const pendingVersionId = ((await proposed.json()) as ContractDto).pendingAmendment!.versionId;
    expect(
      (
        await send(`admin/contracts/${f.row.id}/amendments/publish`, 'signature-legal', 'POST', {
          expectedVersionId: pendingVersionId,
          idempotencyKey: randomUUID(),
        })
      ).status
    ).toBe(200);
    expect(
      (
        await send(`contracts/${f.row.id}/accept`, f.user, 'POST', {
          expectedVersionId: pendingVersionId,
          idempotencyKey: randomUUID(),
        })
      ).status
    ).toBe(200);
    const generatedResponse = await send(
      `admin/contracts/${f.row.id}/versions/${pendingVersionId}/generate-pdf`,
      'signature-legal',
      'POST',
      { idempotencyKey: pendingVersionId }
    );
    expect(generatedResponse.status, (await generatedResponse.clone().text()) + http.logs()).toBe(
      201
    );
    const generated = (await generatedResponse.json()) as DocumentDto;
    expect(generated).toMatchObject({
      state: 'SubmittedForReview',
      contractRole: 'amendment',
      contractVersionId: pendingVersionId,
    });
    const approved = await act(generated, 'approve', 'signature-legal', true);
    const signing = await send(
      `admin/contracts/${f.row.id}/signature-request`,
      'signature-legal',
      'POST',
      {
        expectedVersionId: pendingVersionId,
        originalDocumentId: approved.id,
        expectedRequestId: null,
        idempotencyKey: randomUUID(),
      }
    );
    expect(signing.status, (await signing.clone().text()) + http.logs()).toBe(200);
  } finally {
    await http.pool.query(
      "UPDATE contract_activation_rules SET signature_required=$1,revision=revision+1 WHERE service_type='electricity'",
      [originalRule.rows[0]!.signature_required]
    );
  }
});

it('records real approved customer bytes once and preserves recorder, uploader and acceptance identities', async () => {
  const f = await contract(),
    original = await documentFor(f, 'original');
  const request = await prepare(f, original.id);
  expect(request.view).toMatchObject({
    state: 'AwaitingSignature',
    request: { requestNumber: 1, originalDocumentId: original.id, requestedBy: 'signature-legal' },
    signature: null,
  });
  const customer = (await (
    await send(`contracts/${f.row.id}/signature`, f.user)
  ).json()) as SignatureView;
  expect(customer.request).not.toHaveProperty('requestedBy');
  expect(customer.canRecord).toBe(true);
  const signed = await documentFor(f, 'signed', false),
    body = recordInput(f, request.view.request!.id, signed.id);
  const response = await record(f, body);
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  const evidence = (await response.json()) as SignatureView;
  expect(evidence).toMatchObject({
    state: 'Signed',
    canRecord: false,
    signature: {
      signedDocumentId: signed.id,
      recordedByType: 'customer',
      uploadedByType: 'customer',
    },
  });
  expect(evidence.signature).not.toHaveProperty('recordedBy');
  expect(await (await record(f, body)).json()).toEqual(evidence);
  const staff = (await (
    await send(
      `admin/contracts/${f.row.id}/signature?versionId=${f.row.currentVersionId}`,
      'signature-legal'
    )
  ).json()) as SignatureView;
  expect(staff.signature).toMatchObject({ recordedBy: f.user, uploadedBy: f.user });
  expect(
    (
      await http.pool.query('SELECT accepted_by FROM contract_acceptances WHERE version_id=$1', [
        f.row.currentVersionId,
      ])
    ).rows[0].accepted_by
  ).toBe(f.user);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE event='contract.signed_copy_recorded' AND metadata::jsonb->>'contractId'=$1",
        [f.row.id]
      )
    ).rows[0].n
  ).toBe(1);
  expect(
    (
      await http.pool.query(
        'SELECT document_id FROM contract_document_locks WHERE contract_version_id=$1',
        [f.row.currentVersionId]
      )
    ).rows
      .map((row) => row.document_id)
      .sort()
  ).toEqual([original.id, signed.id].sort());
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await record(f, body)).status).toBe(404);
});
it('records staff-handled copies without changing the customer acceptance actor', async () => {
  const f = await contract(),
    original = await documentFor(f, 'original'),
    signed = await documentFor(f, 'signed');
  const pending = await prepare(f, original.id),
    body = recordInput(f, pending.view.request!.id, signed.id);
  const response = await record(f, body, true);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    signature: {
      recordedBy: 'signature-legal',
      recordedByType: 'staff',
      uploadedBy: 'signature-legal',
      uploadedByType: 'staff',
    },
  });
  expect(
    (
      await http.pool.query('SELECT accepted_by FROM contract_acceptances WHERE version_id=$1', [
        f.row.currentVersionId,
      ])
    ).rows[0].accepted_by
  ).toBe(f.user);
  expect((await record(f, body, true)).status).toBe(200);
});
it('applies a solar amendment only after its accepted PDF has an approved signed copy', async () => {
  const f = await contract(true, 'solar');
  const baseOriginal = await documentFor(f, 'original');
  const baseRequest = await prepare(f, baseOriginal.id);
  const baseSigned = await documentFor(f, 'signed', false);
  expect(
    (await record(f, recordInput(f, baseRequest.view.request!.id, baseSigned.id))).status
  ).toBe(200);
  const effective = (await (
    await send(`admin/contracts/${f.row.id}`, 'signature-legal')
  ).json()) as ContractDto;
  expect(effective.state).toBe('Signed');
  const proposed = await send(`admin/contracts/${f.row.id}/amendments`, 'signature-legal', 'POST', {
    expectedVersionId: f.row.currentVersionId,
    content: { text: 'Revised solar agreement' },
    changeDescription: 'Updated completion terms',
    idempotencyKey: randomUUID(),
  });
  expect(proposed.status, await proposed.clone().text()).toBe(201);
  const pendingVersionId = ((await proposed.json()) as ContractDto).pendingAmendment!.versionId;
  let amendmentPdf = await confirm(
    await create(
      'signature-legal',
      {
        profileId: f.profile,
        businessRecordType: 'contract',
        businessRecordId: f.row.id,
        contractVersionId: pendingVersionId,
        contractRole: 'amendment',
      },
      true
    ),
    'signature-legal',
    true
  );
  amendmentPdf = await act(amendmentPdf, 'submit', 'signature-legal', true);
  amendmentPdf = await act(amendmentPdf, 'approve', 'signature-legal', true);
  expect((await send(`documents/${amendmentPdf.id}`, f.user)).status).toBe(404);
  expect(
    (
      await send(`admin/contracts/${f.row.id}/amendments/publish`, 'signature-legal', 'POST', {
        expectedVersionId: pendingVersionId,
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(200);
  expect(
    (
      await send(`contracts/${f.row.id}/accept`, f.user, 'POST', {
        expectedVersionId: pendingVersionId,
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(200);
  await expect(
    http.pool.query("UPDATE contract_amendments SET state='Applied' WHERE version_id=$1", [
      pendingVersionId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const beforeSignature = (await (
    await send(`admin/contracts/${f.row.id}`, 'signature-legal')
  ).json()) as ContractDto;
  expect(beforeSignature).toMatchObject({
    state: 'Signed',
    currentVersionId: f.row.currentVersionId,
    pendingAmendment: { state: 'AwaitingSignature', versionId: pendingVersionId },
  });
  const signingReview = await send(
    `admin/contracts/${f.row.id}/signature/review`,
    'signature-legal',
    'POST',
    {
      action: 'request',
      expectedVersionId: pendingVersionId,
      originalDocumentId: amendmentPdf.id,
      expectedRequestId: null,
    }
  );
  expect(signingReview.status, await signingReview.clone().text()).toBe(200);
  const signing = await send(
    `admin/contracts/${f.row.id}/signature-request`,
    'signature-legal',
    'POST',
    {
      expectedVersionId: pendingVersionId,
      originalDocumentId: amendmentPdf.id,
      expectedRequestId: null,
      idempotencyKey: randomUUID(),
    }
  );
  expect(signing.status, await signing.clone().text()).toBe(200);
  const request = (await signing.json()) as SignatureView;
  expect(request).toMatchObject({
    isCurrent: false,
    isAmendment: true,
    canRequest: true,
    request: { originalDocumentId: amendmentPdf.id },
  });
  let signedCopy = await confirm(
    await create(f.user, {
      profileId: f.profile,
      businessRecordType: 'contract',
      businessRecordId: f.row.id,
      contractVersionId: pendingVersionId,
      contractRole: 'signed',
    }),
    f.user
  );
  signedCopy = await act(signedCopy, 'submit', f.user);
  signedCopy = await act(signedCopy, 'approve', 'signature-legal', true);
  const signed = await send(`contracts/${f.row.id}/signature`, f.user, 'POST', {
    expectedVersionId: pendingVersionId,
    requestId: request.request!.id,
    signedDocumentId: signedCopy.id,
    idempotencyKey: randomUUID(),
  });
  expect(signed.status, await signed.clone().text()).toBe(200);
  expect(await signed.json()).toMatchObject({
    state: 'Signed',
    isCurrent: true,
    signature: { signedDocumentId: signedCopy.id, recordedByType: 'customer' },
  });
  expect(
    (await (await send(`admin/contracts/${f.row.id}`, 'signature-legal')).json()) as ContractDto
  ).toMatchObject({
    state: 'Signed',
    currentVersionId: pendingVersionId,
    pendingAmendment: null,
  });
  expect(
    (
      await http.pool.query(
        'SELECT document_id FROM contract_document_locks WHERE contract_version_id=$1',
        [pendingVersionId]
      )
    ).rows
      .map((row) => row.document_id)
      .sort()
  ).toEqual([amendmentPdf.id, signedCopy.id].sort());
  await http.pool.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
    f.row.id,
    pendingVersionId,
  ]);
});
it('keeps draft and other-profile signing evidence private and validates commands', async () => {
  const f = await contract(false),
    original = await documentFor(f, 'original');
  expect((await send(`contracts/${f.row.id}/signature`, f.user)).status).toBe(404);
  expect((await send(`admin/contracts/${f.row.id}/signature`, 'signature-legal')).status).toBe(200);
  expect(
    (
      await send(
        `admin/contracts/${f.row.id}/signature-request`,
        'signature-legal',
        'POST',
        requestInput(f, original.id)
      )
    ).status
  ).toBe(409);
  const other = await owner();
  expect((await send(`contracts/${f.row.id}/signature`, other.user)).status).toBe(404);
  expect((await send(`admin/contracts/${f.row.id}/signature`, 'signature-finance')).status).toBe(
    403
  );
  expect((await send(`admin/contracts/${randomUUID()}/signature`, 'signature-legal')).status).toBe(
    404
  );
  for (const body of [
    {},
    { ...requestInput(f, original.id), expectedVersionId: 'bad' },
    { ...requestInput(f, original.id), extra: true },
  ])
    expect(
      (await send(`admin/contracts/${f.row.id}/signature-request`, 'signature-legal', 'POST', body))
        .status
    ).toBe(400);
  expect((await send(`contracts/${f.row.id}/signature?versionId=bad`, f.user)).status).toBe(400);
  expect((await send(`contracts/${f.row.id}/signature`, f.user, 'POST', {})).status).toBe(400);
});
it('uses a new numbered request to recover from a replaced or quarantined original', async () => {
  const f = await contract(),
    firstOriginal = await documentFor(f, 'original'),
    first = await prepare(f, firstOriginal.id),
    signed = await documentFor(f, 'signed', false);
  const secondOriginal = await documentFor(f, 'original', true, true, firstOriginal.id),
    second = await prepare(f, secondOriginal.id, first.view.request!.id);
  expect(second.view.request?.requestNumber).toBe(2);
  expect((await record(f, recordInput(f, first.view.request!.id, signed.id))).status).toBe(409);
  expect(
    (
      await send(
        `admin/contracts/${f.row.id}/signature-request`,
        'signature-legal',
        'POST',
        requestInput(f, firstOriginal.id, first.view.request!.id)
      )
    ).status
  ).toBe(409);
  await act(
    secondOriginal,
    'quarantine',
    'signature-legal',
    true,
    'Original must be reviewed again'
  );
  expect((await record(f, recordInput(f, second.view.request!.id, signed.id))).status).toBe(409);
  const thirdOriginal = await documentFor(f, 'original', true, true, secondOriginal.id),
    third = await prepare(f, thirdOriginal.id, second.view.request!.id);
  expect(third.view.request?.requestNumber).toBe(3);
  expect((await record(f, recordInput(f, third.view.request!.id, signed.id))).status).toBe(200);
});
it('rejects unapproved, wrong-role, other-contract and stale-version evidence', async () => {
  const f = await contract(),
    original = await documentFor(f, 'original'),
    pending = await prepare(f, original.id),
    signed = await documentFor(f, 'signed', false, false);
  expect((await record(f, recordInput(f, pending.view.request!.id, signed.id))).status).toBe(409);
  expect(
    (await record(f, recordInput(f, pending.view.request!.id, original.id), true)).status
  ).toBe(409);
  const other = await contract(),
    foreign = await documentFor(other, 'signed');
  expect((await record(f, recordInput(f, pending.view.request!.id, foreign.id), true)).status).toBe(
    409
  );
  expect(
    (
      await record(f, {
        ...recordInput(f, pending.view.request!.id, signed.id),
        expectedVersionId: randomUUID(),
      })
    ).status
  ).toBe(404);
  expect(
    (
      await send(
        `admin/contracts/${f.row.id}/signature-request`,
        'signature-legal',
        'POST',
        requestInput(f, signed.id, pending.view.request!.id)
      )
    ).status
  ).toBe(409);
});
it('enforces CSRF, fresh step-up and current staff permission even on request replay', async () => {
  const f = await contract(),
    original = await documentFor(f, 'original'),
    body = requestInput(f, original.id),
    path = `admin/contracts/${f.row.id}/signature-request`;
  const csrf = await fetch(http.base + '/api/' + path, {
    method: 'POST',
    headers: { ...headers['signature-legal'], 'X-CSRF-Token': 'invalid' },
    body: JSON.stringify(body),
  });
  expect(csrf.status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='signature-legal'"
  );
  expect((await send(path, 'signature-legal', 'POST', body)).status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id='signature-legal'"
  );
  expect((await send(path, 'signature-legal', 'POST', body)).status).toBe(200);
  expect(
    (await send(path, 'signature-legal', 'POST', { ...body, originalDocumentId: randomUUID() }))
      .status
  ).toBe(409);
  await http.pool.query(
    "DELETE FROM user_roles WHERE user_id='signature-legal' AND role_id='role-legal-contracts'"
  );
  try {
    expect((await send(path, 'signature-legal', 'POST', body)).status).toBe(403);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('signature-legal','role-legal-contracts')"
    );
  }
});
it('serializes competing signature recordings and preserves exactly one audit event', async () => {
  const f = await contract(),
    original = await documentFor(f, 'original'),
    signed = await documentFor(f, 'signed'),
    pending = await prepare(f, original.id);
  const results = await Promise.all([
    record(f, recordInput(f, pending.view.request!.id, signed.id), true),
    record(f, recordInput(f, pending.view.request!.id, signed.id), true),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE event='contract.signed_copy_recorded' AND metadata::jsonb->>'contractId'=$1",
        [f.row.id]
      )
    ).rows[0].n
  ).toBe(1);
});
it('allows only recording or document replacement to win a race against the same signed copy', async () => {
  const f = await contract(),
    original = await documentFor(f, 'original'),
    signed = await documentFor(f, 'signed', false),
    pending = await prepare(f, original.id);
  const replacement = await create(f.user, {
    profileId: f.profile,
    businessRecordType: 'contract',
    businessRecordId: f.row.id,
    contractVersionId: f.row.currentVersionId,
    contractRole: 'signed',
    supersedesDocumentId: signed.id,
  });
  await upload(replacement);
  const responses = await Promise.all([
    record(f, recordInput(f, pending.view.request!.id, signed.id)),
    send(`documents/${replacement.document.id}/confirm`, f.user, 'POST', command(1)),
  ]);
  expect(responses.map((result) => result.status).sort()).toEqual([200, 409]);
  const stored = (
    await http.pool.query(
      'SELECT c.state AS contract_state,d.state AS document_state FROM contracts c JOIN documents d ON d.business_record_id=c.id WHERE c.id=$1 AND d.id=$2',
      [f.row.id, signed.id]
    )
  ).rows[0];
  if (responses[0]!.status === 200)
    expect(stored).toEqual({ contract_state: 'Signed', document_state: 'Approved' });
  else
    expect(stored).toEqual({ contract_state: 'AwaitingSignature', document_state: 'Superseded' });
});

it('resolves a required solar signature only after recording its approved signed-copy evidence', async () => {
  const f = await contract(true, 'solar');
  const read = async () => {
    const response = await send(`contracts/${f.row.id}/activation`, f.user);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      ready: boolean;
      state: string;
      checks: Array<{ key: string; status: string }>;
    };
  };
  const initial = await read();
  expect(initial.ready).toBe(false);
  expect(initial.checks.find((item) => item.key === 'signature')?.status).toBe('unmet');
  const original = await documentFor(f, 'original'),
    request = await prepare(f, original.id),
    signed = await documentFor(f, 'signed', false);
  expect((await read()).ready).toBe(false);
  expect((await record(f, recordInput(f, request.view.request!.id, signed.id))).status).toBe(200);
  const result = await read();
  expect(result.ready).toBe(true);
  expect(result.state).toBe('Signed');
  expect(result.checks.find((item) => item.key === 'signature')?.status).toBe('met');
  expect((await activateReadyContracts(http.pool)).activated).toBe(1);
  expect((await read()).state).toBe('Active');
  expect((await read()).ready).toBe(false);
});

it('binds signing confirmation to the selected approved documents and saves its review on retries', async () => {
  const f = await contract();
  const original = await documentFor(f, 'original');
  const base = `admin/contracts/${f.row.id}`;
  const input = requestInput(f, original.id);
  const previewResponse = await send(`${base}/signature/review`, 'signature-legal', 'POST', {
    action: 'request',
    expectedVersionId: input.expectedVersionId,
    originalDocumentId: original.id,
    expectedRequestId: null,
  });
  expect(previewResponse.status).toBe(200);
  const preview = (await previewResponse.json()) as ContractFinancialReview;
  expect(preview.data.signature!.originalDocument).toMatchObject({
    id: original.id,
    checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const replacement = await documentFor(f, 'original', true, true, original.id);
  const request = { ...input, expectedReviewHash: preview.hash };
  expect(
    (
      await send(`${base}/signature-request`, 'signature-legal', 'POST', {
        ...request,
        originalDocumentId: replacement.id,
      })
    ).status
  ).toBe(409);
  expect(
    (
      await http.pool.query(
        'SELECT count(*) FROM contract_signature_requests WHERE contract_id=$1',
        [f.row.id]
      )
    ).rows[0].count
  ).toBe('0');
  expect((await send(`${base}/signature-request`, 'signature-legal', 'POST', request)).status).toBe(
    409
  );
  const currentInput = requestInput(f, replacement.id);
  const currentPreviewResponse = await send(`${base}/signature/review`, 'signature-legal', 'POST', {
    action: 'request',
    expectedVersionId: currentInput.expectedVersionId,
    originalDocumentId: replacement.id,
    expectedRequestId: null,
  });
  expect(currentPreviewResponse.status).toBe(200);
  const currentPreview = (await currentPreviewResponse.json()) as ContractFinancialReview;
  const currentRequest = { ...currentInput, expectedReviewHash: currentPreview.hash };
  const response = await send(
    `${base}/signature-request`,
    'signature-legal',
    'POST',
    currentRequest
  );
  expect(response.status).toBe(200);
  const prepared = (await response.json()) as SignatureView & {
    financialReview: ContractFinancialReview;
  };
  expect(prepared.financialReview).toEqual(currentPreview);
  expect(
    await (
      await send(`${base}/signature-request`, 'signature-legal', 'POST', currentRequest)
    ).json()
  ).toEqual(prepared);
  const signed = await documentFor(f, 'signed', false);
  const otherSigned = await documentFor(f, 'signed', false);
  const recordBody = recordInput(f, prepared.request!.id, signed.id);
  const recordPreviewResponse = await send(
    `contracts/${f.row.id}/signature/review`,
    f.user,
    'POST',
    {
      action: 'record',
      expectedVersionId: recordBody.expectedVersionId,
      signedDocumentId: signed.id,
      requestId: prepared.request!.id,
    }
  );
  expect(recordPreviewResponse.status).toBe(200);
  const recordPreview = (await recordPreviewResponse.json()) as ContractFinancialReview;
  expect(recordPreview.data.signature!.signedDocument!.id).toBe(signed.id);
  const confirmed = { ...recordBody, expectedReviewHash: recordPreview.hash };
  expect((await record(f, { ...confirmed, signedDocumentId: otherSigned.id })).status).toBe(409);
  const recorded = await record(f, confirmed);
  expect(recorded.status).toBe(200);
  const result = (await recorded.json()) as SignatureView & {
    financialReview: ContractFinancialReview;
  };
  expect(result.financialReview).toEqual(recordPreview);
  expect(await (await record(f, confirmed)).json()).toEqual(result);
  const audits = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE metadata::jsonb->>'contractId'=$1 AND metadata::jsonb ? 'financialReview'",
      [f.row.id]
    )
  ).rows.map((row) => row.metadata.financialReview);
  expect(audits).toContainEqual(currentPreview);
  expect(audits).toContainEqual(recordPreview);
});
