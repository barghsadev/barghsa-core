import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let legalId: string;
let individualId: string;
let productId: string;
let versionId: string;
let headers: Record<string, string>;

beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('terms-owner','terms@example.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'terms-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
    'Accept-Language': 'en',
  };
  for (const kind of ['LEGAL', 'INDIVIDUAL']) {
    const row = await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('terms-owner',$1,'VERIFIED') RETURNING id",
      [kind]
    );
    if (kind === 'LEGAL') legalId = row.rows[0].id;
    else individualId = row.rows[0].id;
  }
  await http.pool.query('UPDATE profiles SET is_default=true WHERE id=$1', [legalId]);
  productId = (
    await http.pool.query(
      "INSERT INTO products(type,system_key,title,status,price) VALUES ('consultation','general_consultation','{\"en\":\"General consultation\"}','active',0) RETURNING id"
    )
  ).rows[0].id;
  versionId = await publish('major', 'initial');
});
afterEach(async () => {
  await http?.close();
}, 15000);

async function publish(change: 'major' | 'minor', name: string) {
  await http.pool.query('UPDATE tos_versions SET is_active=false WHERE is_active');
  return (
    await http.pool.query(
      "INSERT INTO tos_versions(version_id,content_fa,content_en,status,is_active,published_at,change_type) VALUES ($1,'شرایط','Terms','published',true,clock_timestamp(),$2) RETURNING id",
      [name, change]
    )
  ).rows[0].id as string;
}
const request = (path: string, method = 'GET', body?: unknown) =>
  fetch(http.base + '/api/' + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const accept = () => request(`tos/accept/${versionId}`, 'POST');

it('requires current consent across all four commercial entrypoints while existing records remain accessible', async () => {
  const commercial = [
    () =>
      request('orders', 'POST', {
        profileId: legalId,
        productId,
        orderType: 'electricity',
        address: {
          provinceId: randomUUID(),
          cityId: randomUUID(),
          fullAddress: 'Terms Street',
          postalCode: '1234567890',
        },
      }),
    () => request(`saving/orders/draft?profileId=${individualId}`),
    () => request(`solar/requests/draft?profileId=${legalId}`),
    () =>
      request('consultations/requests', 'POST', {
        profileId: legalId,
        productId,
        submissionKey: randomUUID(),
      }),
  ];
  for (const send of commercial) {
    const res = await send();
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'AUTHZ:TOS_ACCEPTANCE_REQUIRED' } });
  }
  for (const path of [
    `orders?profileId=${legalId}`,
    `solar/requests?profileId=${legalId}`,
    `consultations/requests?profileId=${legalId}`,
    'auth/sessions',
  ]) {
    const res = await request(path);
    expect(res.status, path + ': ' + (await res.clone().text())).toBe(200);
  }
  expect((await http.pool.query('SELECT id FROM orders')).rows).toHaveLength(0);
  expect((await http.pool.query('SELECT id FROM consultation_requests')).rows).toHaveLength(0);
  const accepted = await accept();
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect(await accepted.json()).toMatchObject({ acceptedVersionId: versionId });
  for (const path of [
    `saving/orders/draft?profileId=${individualId}`,
    `solar/requests/draft?profileId=${legalId}`,
  ]) {
    const res = await request(path);
    expect(res.status, path + ': ' + (await res.clone().text())).toBe(200);
  }
});

it('allows minor publication, blocks new requests after a major change, and preserves exact committed consultation replay', async () => {
  expect((await accept()).status).toBe(200);
  const body = { profileId: legalId, productId, submissionKey: randomUUID() };
  const submit = () => request('consultations/requests', 'POST', body);
  const first = await submit();
  expect(first.status, await first.clone().text()).toBe(201);
  const receipt = await first.json();
  await publish('minor', 'minor');
  expect((await request(`solar/requests/draft?profileId=${legalId}`)).status).toBe(200);
  await publish('major', 'next-major');
  const replay = await submit();
  expect(replay.status, await replay.clone().text()).toBe(201);
  expect(await replay.json()).toEqual(receipt);
  const denied = await request('consultations/requests', 'POST', {
    ...body,
    submissionKey: randomUUID(),
  });
  expect(denied.status, await denied.clone().text()).toBe(403);
  expect((await http.pool.query('SELECT id FROM consultation_requests')).rows).toHaveLength(1);
});

it('checks the material boundary after an account lock wait and returns the Persian recovery message', async () => {
  expect((await accept()).status).toBe(200);
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT user_id FROM users WHERE user_id='terms-owner' FOR UPDATE");
    headers['Accept-Language'] = 'fa';
    pending = request(`solar/requests/draft?profileId=${legalId}`);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%users%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await publish('major', 'published-while-waiting');
    await blocker.query('COMMIT');
    const res = await pending;
    expect(res.status, await res.clone().text()).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('AUTHZ:TOS_ACCEPTANCE_REQUIRED');
    expect(body.error.message).toContain('شرایط');
    expect((await http.pool.query('SELECT user_id FROM solar_customer_drafts')).rows).toHaveLength(
      0
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
