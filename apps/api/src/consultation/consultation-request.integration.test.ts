import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const profiles: Record<string, string> = {};

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [user, profileType] of [
    ['individual', 'INDIVIDUAL'],
    ['company', 'LEGAL'],
  ] as const) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
      user,
      `${user}@consultation.test`,
      'test-only',
    ]);
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    profiles[user] = (
      await http.pool.query(
        "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES($1,$2,'ACTIVE',true) RETURNING id",
        [user, profileType]
      )
    ).rows[0].id as string;
  }
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

it('lists seeded products by profile, submits without invoicing, and isolates history', async () => {
  const catalogue = async (user: string, profileId: string) => {
    const response = await fetch(`${http.base}/api/consultations/products?profileId=${profileId}`, {
      headers: headers[user]!,
    });
    expect(response.status, http.logs()).toBe(200);
    return (await response.json()) as { products: Array<{ id: string; systemKey: string }> };
  };
  const individualProducts = (await catalogue('individual', profiles.individual!)).products;
  const companyProducts = (await catalogue('company', profiles.company!)).products;
  expect(individualProducts.map((product) => product.systemKey)).toEqual([
    'electricity_generation_station',
  ]);
  expect(companyProducts.map((product) => product.systemKey).sort()).toEqual([
    'electricity_generation_station',
    'electricity_saving_certificate',
  ]);
  const certificateId = companyProducts.find(
    (product) => product.systemKey === 'electricity_saving_certificate'
  )!.id;
  const post = (user: string, profileId: string, productId: string, submissionKey: string) =>
    fetch(`${http.base}/api/consultations/requests`, {
      method: 'POST',
      headers: headers[user]!,
      body: JSON.stringify({ profileId, productId, submissionKey }),
    });
  expect((await post('individual', profiles.individual!, certificateId, randomUUID())).status).toBe(
    400
  );
  const key = randomUUID();
  const submitted = await post('individual', profiles.individual!, individualProducts[0]!.id, key);
  expect(submitted.status, http.logs()).toBe(201);
  const created = (await submitted.json()) as { requestId: string; status: string };
  expect(created.status).toBe('submitted');
  const retry = await post('individual', profiles.individual!, individualProducts[0]!.id, key);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toEqual(created);
  expect((await post('individual', profiles.individual!, certificateId, key)).status).toBe(400);
  const list = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profiles.individual}`,
    { headers: headers.individual! }
  );
  expect(list.status, http.logs()).toBe(200);
  const listed = (await list.json()) as {
    requests: Array<{ id: string; status: string }>;
    nextBefore: string | null;
  };
  expect(listed.requests).toMatchObject([{ id: created.requestId, status: 'submitted' }]);
  expect(listed.nextBefore).toBeNull();
  const after = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profiles.individual}&before=${created.requestId}`,
    { headers: headers.individual! }
  );
  expect(after.status, http.logs()).toBe(200);
  expect((await after.json()) as { requests: unknown[] }).toMatchObject({ requests: [] });
  expect(
    (
      await fetch(
        `${http.base}/api/consultations/requests?profileId=${profiles.individual}&before=bad`,
        {
          headers: headers.individual!,
        }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await fetch(
        `${http.base}/api/consultations/requests?profileId=${profiles.individual}&before=${randomUUID()}`,
        { headers: headers.individual! }
      )
    ).status
  ).toBe(404);
  const detail = await fetch(`${http.base}/api/consultations/requests/${created.requestId}`, {
    headers: headers.individual!,
  });
  expect(detail.status, http.logs()).toBe(200);
  expect(await detail.json()).toMatchObject({
    request: { id: created.requestId, invoice_id: null, fee: null },
    history: [{ status: 'submitted', actor_type: 'customer' }],
  });
  expect(
    (
      await fetch(`${http.base}/api/consultations/requests/${created.requestId}`, {
        headers: headers.company!,
      })
    ).status
  ).toBe(404);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM invoices WHERE consultation_id=$1',
        [created.requestId]
      )
    ).rows[0].count
  ).toBe(0);
  const companyRequest = await post('company', profiles.company!, certificateId, randomUUID());
  expect(companyRequest.status, http.logs()).toBe(201);
  expect(((await companyRequest.json()) as { status: string }).status).toBe('submitted');
});
