import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
const session = randomUUID();
const csrf = randomUUID();
const headers = {
  Cookie: `barghsa_session=${session}`,
  'X-CSRF-Token': csrf,
  'Content-Type': 'application/json',
};
const payload = { verified: true, data: { meter: 'PRIVATE_PROVIDER_METER', consumption: 120 } };
let mode: 'success' | 'hold' | 'timeout' | 'auth_error' | 'invalid_data' = 'success';
let arrived: (() => void) | undefined;
let held: ServerResponse | undefined;
const calls: Array<{ url: string; authorization: string | undefined }> = [];
const gateway = createServer((request, response) => {
  calls.push({ url: request.url!, authorization: request.headers.authorization });
  response.setHeader('content-type', 'application/json');
  if (mode === 'hold') {
    held = response;
    arrived?.();
  } else if (mode === 'timeout') {
    // Exercise the real provider's bounded timeout and retry.
  } else if (mode === 'auth_error') response.writeHead(401).end('{}');
  else response.end(JSON.stringify(mode === 'invalid_data' ? { verified: 'yes' } : payload));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const address = gateway.address();
  if (!address || typeof address === 'string') throw new Error('Provider port unavailable');
  vi.stubEnv('SAVING_BILL_VERIFICATION_URL', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('SAVING_BILL_VERIFICATION_TOKEN', 'test-provider-token');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await seedAuthority();
}, 40000);

async function seedAuthority() {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('saving-bill-owner','saving-bill-owner@example.test','test-only'),('saving-bill-other','saving-bill-other@example.test','test-only')"
  );
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('saving-bill-owner','INDIVIDUAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES($1,'saving-bill-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, csrf, randomUUID()]
  );
}

afterAll(async () => {
  held?.end('{}');
  gateway.closeAllConnections();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  await http?.close();
  vi.unstubAllEnvs();
}, 15000);

const verify = () =>
  fetch(`${http.base}/api/saving/orders/verify-bill`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileId, billIdentifier: '1234567890123' }),
  });

it('returns an authenticated provider result only to the current individual profile owner', async () => {
  const response = await verify();
  expect(response.status, http.logs()).toBe(201);
  expect(await response.json()).toMatchObject({
    source: 'configured_bill_provider',
    status: 'verified',
    attemptedAt: expect.any(String),
    data: payload.data,
  });
  expect(calls.at(-1)).toEqual({
    url: '/bills/1234567890123/verify',
    authorization: 'Bearer test-provider-token',
  });
});

it.each([
  ['ownership', 404],
  ['session', 401],
  ['archival', 404],
  ['suspension', 403],
] as const)(
  'withdraws private verification after %s changes during the provider call',
  async (change, status) => {
    mode = 'hold';
    const gate = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pending = verify();
    try {
      await gate;
      if (change === 'ownership')
        await http.pool.query("UPDATE profiles SET user_id='saving-bill-other' WHERE id=$1", [
          profileId,
        ]);
      else if (change === 'session')
        await http.pool.query(
          "UPDATE sessions SET idle_deadline=NOW()-INTERVAL '1 second' WHERE session_id=$1",
          [session]
        );
      else if (change === 'archival')
        await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
      else await http.pool.query("UPDATE profiles SET status='SUSPENDED' WHERE id=$1", [profileId]);
      held!.end(JSON.stringify(payload));
      const response = await pending;
      expect(response.status, http.logs()).toBe(status);
      const body = await response.json();
      expect(body).not.toHaveProperty('data');
      expect(JSON.stringify(body)).not.toContain(payload.data.meter);
      expect(body).not.toHaveProperty('attemptedAt');
    } finally {
      held?.end('{}');
      await pending;
      mode = 'success';
      await http.pool.query(
        "UPDATE profiles SET user_id='saving-bill-owner',archived=false,status='ACTIVE' WHERE id=$1",
        [profileId]
      );
      await http.pool.query(
        "UPDATE sessions SET idle_deadline=NOW()+INTERVAL '30 minutes' WHERE session_id=$1",
        [session]
      );
    }
  }
);

it.each(['timeout', 'auth_error', 'invalid_data'] as const)(
  'returns a bounded manual-review fallback after actual provider %s',
  async (failure) => {
    mode = failure;
    const before = calls.length;
    const response = await verify();
    expect(response.status, http.logs()).toBe(201);
    expect(await response.json()).toMatchObject({
      source: 'configured_bill_provider',
      status: 'unavailable',
      reason: failure,
      attemptedAt: expect.any(String),
    });
    expect(calls.length - before).toBe(failure === 'timeout' ? 2 : 1);
  },
  10000
);

it('opens the circuit after repeated failures without calling the provider again', async () => {
  mode = 'success';
  const before = calls.length;
  const response = await verify();
  expect(response.status, http.logs()).toBe(201);
  expect(await response.json()).toMatchObject({ status: 'unavailable', reason: 'circuit_open' });
  expect(calls).toHaveLength(before);
});

it('persists provider failure only through an explicit staff-review submission and preserves its receipt', async () => {
  // The preceding circuit test deliberately leaves its API instance open.
  // This independent submission scenario owns a fresh provider and database.
  await http.close();
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await seedAuthority();
  const hardware = (
    await http.pool.query(
      `INSERT INTO products(type,title,price,status)
       VALUES('hardware','{"fa":"دستگاه","en":"Device"}',200000,'active') RETURNING id`
    )
  ).rows[0].id;
  const plan = (
    await http.pool.query(
      `INSERT INTO products(type,title,price,status)
       VALUES('saving_plan','{"fa":"طرح","en":"Plan"}',100000,'inactive') RETURNING id`
    )
  ).rows[0].id;
  await http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
    plan,
    hardware,
  ]);
  const agreement = (
    await http.pool.query(
      `INSERT INTO saving_plan_agreement_versions(plan_id,title,body,created_by)
       VALUES($1,'Test agreement','Accepted provider-failure terms','saving-bill-owner') RETURNING id`,
      [plan]
    )
  ).rows[0].id;
  await http.pool.query(
    "UPDATE saving_plan_agreement_versions SET status='active',effective_from=NOW() WHERE id=$1",
    [agreement]
  );
  await http.pool.query("UPDATE products SET status='active' WHERE id=$1", [plan]);
  const province = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  const city = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id",
      [province]
    )
  ).rows[0].id;
  const address = (
    await http.pool.query(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code)
       VALUES($1,$2,$3,'Provider failure installation','1234567890') RETURNING id`,
      [profileId, province, city]
    )
  ).rows[0].id;
  const post = (path: string, body: unknown, method = 'POST') =>
    fetch(`${http.base}/api/saving/orders${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
  const draft = {
    profileId,
    currentStep: 3,
    data: {
      planId: plan,
      hardwareId: hardware,
      billIdentifier: '1234567890123',
      addressId: '',
      giftCode: '',
    },
  };
  expect((await post(`/draft?profileId=${profileId}`, draft, 'PUT')).status, http.logs()).toBe(200);
  const input = {
    profileId,
    savingPlanId: plan,
    hardwareProductId: hardware,
    billIdentifier: draft.data.billIdentifier,
    installationAddressId: address,
    agreementVersionId: agreement,
  };
  const quoteResponse = await post('/quote', input);
  expect(quoteResponse.status, http.logs()).toBe(201);
  const quote = (await quoteResponse.json()) as { reviewDigest: string };
  const command = {
    ...input,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
  };
  mode = 'auth_error';
  const denied = await post('', command);
  expect(denied.status).toBe(400);
  const saved = await fetch(`${http.base}/api/saving/orders/draft?profileId=${profileId}`, {
    headers,
  });
  expect(await saved.json()).toMatchObject({ currentStep: draft.currentStep, data: draft.data });
  expect((await http.pool.query('SELECT id FROM saving_orders')).rows).toEqual([]);
  const submitted = await post('', { ...command, submitForStaffReview: true });
  expect(submitted.status, http.logs()).toBe(201);
  const receipt = (await submitted.json()) as {
    savingOrderId: string;
    contractId: string;
    invoiceId: string;
  };
  const stored = (
    await http.pool.query('SELECT status,verification_result FROM saving_orders WHERE id=$1', [
      receipt.savingOrderId,
    ])
  ).rows[0];
  expect(stored).toMatchObject({
    status: 'awaiting_staff_review',
    verification_result: {
      status: 'unavailable',
      reason: 'auth_error',
      source: 'configured_bill_provider',
      attemptedAt: expect.any(String),
    },
  });
  mode = 'success';
  const replay = await post('', { ...command, submitForStaffReview: true });
  expect(replay.status, http.logs()).toBe(201);
  expect(await replay.json()).toEqual(receipt);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM saving_orders')).rows[0].count
  ).toBe(1);
  expect(
    (
      await http.pool.query('SELECT verification_result FROM saving_orders WHERE id=$1', [
        receipt.savingOrderId,
      ])
    ).rows[0].verification_result
  ).toEqual(stored.verification_result);
});
