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

beforeAll(async () => {
  storage = createServer((request, response) => {
    storageRequests.push(`${request.method} ${request.url}`);
    if (
      request.method === 'GET' &&
      new URL(request.url!, 'http://localhost').pathname.endsWith('/electricity-agreement.txt')
    ) {
      const text = 'Agreement for {{ customerName }}: {{amount}} IRR on {{date}}.';
      response
        .writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(text),
        })
        .end(text);
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
  const quote = (await preview.json()) as { reviewDigest: string; totalIrR: string };
  const submitted = await fetch(`${http.base}/api/electricity/orders/simple`, {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify({
      profileId,
      period: 'next_week',
      totalKwh: '10',
      idempotencyKey: randomUUID(),
      expectedQuoteDigest: quote.reviewDigest,
      address: { provinceId, cityId, fullAddress: 'Electricity Street', postalCode: '1234567890' },
    }),
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
  expect(content.template.text).toContain(`Agreement for Ada Example: ${quote.totalIrR} IRR on `);
  expect(content.template.text).not.toContain('{{');
});
