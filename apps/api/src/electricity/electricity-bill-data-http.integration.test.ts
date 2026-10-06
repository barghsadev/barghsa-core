import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
const session = randomUUID();
const csrf = randomUUID();
const headers = { Cookie: `barghsa_session=${session}`, 'X-CSRF-Token': csrf };
const readings = [
  { hour: '2026-09-01T00:00:00Z', kwh: 2 },
  { hour: '2026-09-01T01:00:00Z', kwh: 4 },
];
let mode: 'success' | 'hold' | 'timeout' | 'auth_error' | 'no_data' = 'success';
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
    // The real provider's AbortSignal must stop this unfinished response.
  } else if (mode === 'auth_error') {
    response.writeHead(401).end('{}');
  } else response.end(JSON.stringify(mode === 'no_data' ? [] : readings));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const address = gateway.address();
  if (!address || typeof address === 'string') throw new Error('Provider port unavailable');
  vi.stubEnv('ELECTRICITY_BILL_DATA_URL', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('ELECTRICITY_BILL_DATA_TOKEN', 'test-provider-token');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('bill-owner','bill-owner@example.test','test-only'),('bill-other','bill-other@example.test','test-only')"
  );
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('bill-owner','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES($1,'bill-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, csrf, randomUUID()]
  );
}, 40000);

afterAll(async () => {
  held?.end('[]');
  gateway.closeAllConnections();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  await http?.close();
  vi.unstubAllEnvs();
}, 15000);

const get = () =>
  fetch(`${http.base}/api/electricity/bill-data/${profileId}?period=next_week`, { headers });

it('returns a real authenticated provider estimate with hourly source and coverage', async () => {
  const response = await get();
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({
    available: true,
    hourlyKwh: readings,
    suggestedKwh: '504',
    dataSource: 'configured_bill_provider',
    dataTimestamp: '2026-09-01T01:00:00.000Z',
    coverage: 1,
    manualEntryAllowed: true,
  });
  expect(calls.at(-1)).toEqual({
    url: `/profiles/${profileId}/hourly-consumption`,
    authorization: 'Bearer test-provider-token',
  });
});

it.each(['ownership', 'session'] as const)(
  'withdraws private bill readings when %s changes during the provider request',
  async (change) => {
    mode = 'hold';
    const gate = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pending = get();
    try {
      await gate;
      if (change === 'ownership')
        await http.pool.query("UPDATE profiles SET user_id='bill-other' WHERE id=$1", [profileId]);
      else
        await http.pool.query(
          "UPDATE sessions SET idle_deadline=NOW()-INTERVAL '1 second' WHERE session_id=$1",
          [session]
        );
      held!.end(JSON.stringify(readings));
      const response = await pending;
      expect(response.status).toBe(change === 'ownership' ? 404 : 401);
      const body = await response.json();
      expect(body).not.toHaveProperty('hourlyKwh');
      expect(JSON.stringify(body)).not.toContain(readings[0]!.hour);
      expect(body).not.toHaveProperty('suggestedKwh');
    } finally {
      held?.end('[]');
      await pending;
      mode = 'success';
      await http.pool.query("UPDATE profiles SET user_id='bill-owner' WHERE id=$1", [profileId]);
      await http.pool.query(
        "UPDATE sessions SET idle_deadline=NOW()+INTERVAL '30 minutes' WHERE session_id=$1",
        [session]
      );
    }
  }
);

it.each(['timeout', 'auth_error', 'no_data'] as const)(
  'keeps manual entry available after actual provider %s',
  async (failure) => {
    mode = failure;
    const response = await get();
    expect(response.status, http.logs()).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      hourlyKwh: [],
      reason: failure,
      manualEntryAllowed: true,
    });
    mode = 'success';
  },
  10000
);
