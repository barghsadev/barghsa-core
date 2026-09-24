import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let storage: Server;
let staffHeaders: Record<string, string>;
let buyerHeaders: Record<string, string>;
let profileId: string;
let provinceId: string;
let cityId: string;
const storageRequests: string[] = [];
const storedObjects = new Map<string, Buffer>();
let rejectGeneratedPuts = false;

beforeAll(async () => {
  storage = createServer((request, response) => {
    storageRequests.push(`${request.method} ${request.url}`);
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (request.method === 'PUT') {
      if (rejectGeneratedPuts) {
        request.resume();
        response.writeHead(503).end();
        return;
      }
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        storedObjects.set(path, Buffer.concat(chunks));
        response.writeHead(200).end();
      })();
      return;
    }
    if (request.method === 'GET' && path.endsWith('/electricity-agreement.txt')) {
      const text = 'Agreement for {{ customerName }}: {{amount}} IRR on {{date}}.';
      response
        .writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(text),
        })
        .end(text);
      return;
    }
    const stored = storedObjects.get(path);
    if (request.method === 'GET' && stored) {
      response
        .writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': stored.length })
        .end(stored);
      return;
    }
    response.writeHead(404).end();
  });
  storage.listen(0, '127.0.0.1');
  await once(storage, 'listening');
  const address = storage.address() as { port: number };
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, `http://127.0.0.1:${address.port}`);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('electricity-template-editor','Editor','Test','["admin:catalogue:edit"]')`
  );
  for (const [user, staff] of [
    ['buyer', false],
    ['editor', true],
  ] as const) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, `${user}@electricity-template.test`, 'test-only', staff]
    );
    if (staff) {
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES('editor','electricity-template-editor')"
      );
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES('editor','role-legal-contracts')"
      );
    }
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (staff) staffHeaders = headers;
    else buyerHeaders = headers;
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default,first_name,last_name) VALUES('buyer','LEGAL','ACTIVE',true,'Ada','Example') RETURNING id"
    )
  ).rows[0].id as string;
  for (const [key, price] of [
    ['thermal', 100000],
    ['green', 200000],
  ] as const) {
    await http.pool.query(
      `INSERT INTO products(type,system_key,title,status,price) VALUES('electricity',$1,$2::jsonb,'active',$3)
       ON CONFLICT(system_key) DO UPDATE SET status='active',price=EXCLUDED.price`,
      [key, JSON.stringify({ en: key }), price]
    );
  }
  provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان','Province') RETURNING id"
    )
  ).rows[0].id as string;
  cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id as string;
}, 40000);

afterAll(async () => {
  await http?.close();
  if (storage) await new Promise<void>((resolve) => storage.close(() => resolve()));
}, 15000);

it('embeds the selected template version and rendered text in a new preliminary contract', async () => {
  const templateId = (
    await http.pool.query(
      "INSERT INTO contract_templates(name,created_by) VALUES('Electricity agreement','editor') RETURNING id"
    )
  ).rows[0].id as string;
  const versionId = (
    await http.pool.query(
      `INSERT INTO contract_template_versions(template_id,version_number,storage_key,file_name,
        file_size,placeholders,created_by)
       VALUES($1,1,'contract-templates/electricity-agreement.txt','electricity-agreement.txt',
        71,ARRAY['customerName','amount','date']::text[],'editor') RETURNING id`,
      [templateId]
    )
  ).rows[0].id as string;
  const selection = await fetch(`${http.base}/api/admin/config/electricity-contract-template`, {
    method: 'PUT',
    headers: staffHeaders,
    body: JSON.stringify({ versionId }),
  });
  expect(selection.status, http.logs()).toBe(200);
  const preview = await fetch(`${http.base}/api/electricity/preview/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify({ profileId, period: 'next_week', totalKwh: '10' }),
  });
  expect(preview.status, http.logs()).toBe(200);
  const quote = (await preview.json()) as {
    reviewDigest: string;
    totalIrR: string;
    contractTemplate: { versionId: string; versionNumber: number; name: string; text: string };
  };
  expect(quote.contractTemplate).toMatchObject({
    versionId,
    versionNumber: 1,
    name: 'Electricity agreement',
  });
  expect(quote.contractTemplate.text).toContain(
    `Agreement for Ada Example: ${quote.totalIrR} IRR on `
  );
  const submissionInput = {
    profileId,
    period: 'next_week',
    totalKwh: '10',
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    address: { provinceId, cityId, fullAddress: 'Electricity Street', postalCode: '1234567890' },
  };
  const newerVersionId = (
    await http.pool.query(
      `INSERT INTO contract_template_versions(template_id,version_number,storage_key,file_name,
        file_size,placeholders,created_by)
       VALUES($1,2,'contract-templates/v2/electricity-agreement.txt','electricity-agreement.txt',
        71,ARRAY['customerName','amount','date']::text[],'editor') RETURNING id`,
      [templateId]
    )
  ).rows[0].id as string;
  const switchTemplate = async (selectedVersionId: string) =>
    fetch(`${http.base}/api/admin/config/electricity-contract-template`, {
      method: 'PUT',
      headers: staffHeaders,
      body: JSON.stringify({ versionId: selectedVersionId }),
    });
  expect((await switchTemplate(newerVersionId)).status).toBe(200);
  const staleSubmission = await fetch(`${http.base}/api/electricity/orders/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify(submissionInput),
  });
  expect(staleSubmission.status, await staleSubmission.clone().text()).toBe(409);
  expect((await switchTemplate(versionId)).status).toBe(200);
  const submitted = await fetch(`${http.base}/api/electricity/orders/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify(submissionInput),
  });
  expect(
    submitted.status,
    JSON.stringify({ storageRequests, response: await submitted.clone().json() })
  ).toBe(201);
  const { contractId } = (await submitted.json()) as { contractId: string };
  const content = (
    await http.pool.query<{
      content: {
        template: {
          versionId: string;
          text: string;
        };
      };
    }>('SELECT content FROM contract_versions WHERE contract_id=$1', [contractId])
  ).rows[0]!.content;
  expect(content.template.versionId).toBe(versionId);
  expect(content.template.text).toBe(quote.contractTemplate.text);
  expect(content.template.text).not.toContain('{{');
  const linked = await http.pool.query<{
    id: string;
    state: string;
    revision: number;
    uploaded_by_type: string;
    storage_key: string;
    role: string;
    contract_version_id: string;
  }>(
    `SELECT d.id,d.state,d.revision,d.uploaded_by_type,d.storage_key,cd.role,cd.contract_version_id
     FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
     WHERE cd.contract_id=$1`,
    [contractId]
  );
  expect(linked.rows).toHaveLength(1);
  const document = linked.rows[0]!;
  expect(document).toMatchObject({
    state: 'SubmittedForReview',
    revision: 4,
    uploaded_by_type: 'system',
    role: 'original',
  });
  const version = await http.pool.query<{ id: string }>(
    'SELECT id FROM contract_versions WHERE contract_id=$1',
    [contractId]
  );
  expect(document.contract_version_id).toBe(version.rows[0]!.id);
  const pdfBytes = [...storedObjects].find(([path]) => path.endsWith(document.storage_key))?.[1];
  expect(pdfBytes?.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdfBytes?.length).toBeGreaterThan(1000);
  const events = await http.pool.query<{ state: string }>(
    'SELECT state FROM document_events WHERE document_id=$1 ORDER BY revision',
    [document.id]
  );
  expect(events.rows.map((event) => event.state)).toEqual([
    'Uploading',
    'PendingScan',
    'Available',
    'SubmittedForReview',
  ]);
  const approval = await fetch(`${http.base}/api/admin/documents/${document.id}/approve`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ expectedRevision: 4, idempotencyKey: randomUUID() }),
  });
  expect(approval.status, await approval.clone().text()).toBe(200);
  expect((await approval.json()) as { state: string }).toMatchObject({ state: 'Approved' });
  const manualRetry = await fetch(
    `${http.base}/api/admin/contracts/${contractId}/versions/${document.contract_version_id}/generate-pdf`,
    {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({ idempotencyKey: document.contract_version_id }),
    }
  );
  expect(manualRetry.status, await manualRetry.clone().text()).toBe(201);
  expect((await manualRetry.json()) as { id: string }).toMatchObject({ id: document.id });
  const retry = await fetch(`${http.base}/api/electricity/orders/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify(submissionInput),
  });
  expect(retry.status, http.logs()).toBe(201);
  expect(((await retry.json()) as { contractId: string }).contractId).toBe(contractId);
  expect(
    (await http.pool.query('SELECT id FROM contract_documents WHERE contract_id=$1', [contractId]))
      .rows
  ).toHaveLength(1);
});

it('rolls back an order when automatic PDF storage fails and succeeds on retry', async () => {
  const preview = await fetch(`${http.base}/api/electricity/preview/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify({ profileId, period: 'next_week', totalKwh: '10' }),
  });
  expect(preview.status).toBe(200);
  const quote = (await preview.json()) as { reviewDigest: string };
  const idempotencyKey = randomUUID();
  const body = JSON.stringify({
    profileId,
    period: 'next_week',
    totalKwh: '10',
    idempotencyKey,
    expectedQuoteDigest: quote.reviewDigest,
    address: { provinceId, cityId, fullAddress: 'Retry Street', postalCode: '1234567890' },
  });
  rejectGeneratedPuts = true;
  try {
    const failed = await fetch(`${http.base}/api/electricity/orders/simple`, {
      method: 'POST',
      headers: buyerHeaders,
      body,
    });
    expect(failed.status).toBeGreaterThanOrEqual(500);
  } finally {
    rejectGeneratedPuts = false;
  }
  expect(
    (
      await http.pool.query(
        'SELECT order_id FROM electricity_order_submissions WHERE user_id=$1 AND idempotency_key=$2',
        ['buyer', idempotencyKey]
      )
    ).rows
  ).toHaveLength(0);
  const cleanup = await http.pool.query<{ count: string }>(
    `SELECT count(*) FROM storage_records WHERE status='removed'
     AND metadata->>'uploadedBy'='buyer' AND metadata->>'provisionalUpload'='true'
     AND metadata->>'deletionRequested'='true'`
  );
  expect(Number(cleanup.rows[0]!.count)).toBeGreaterThanOrEqual(1);
  const retry = await fetch(`${http.base}/api/electricity/orders/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body,
  });
  expect(retry.status, http.logs()).toBe(201);
  const { contractId } = (await retry.json()) as { contractId: string };
  expect(
    (
      await http.pool.query(
        'SELECT d.id FROM documents d JOIN contract_documents cd ON cd.document_id=d.id WHERE cd.contract_id=$1',
        [contractId]
      )
    ).rows
  ).toHaveLength(1);
});
