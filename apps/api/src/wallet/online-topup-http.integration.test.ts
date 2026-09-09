import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { onlineTopUpCallbackLockKeys } from './online-topup-callback.service.js';
import { onlineTopUpAdvisoryLockKeys } from './online-topup.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  vi.stubEnv('PAYMENT_GATEWAY_ADAPTER', 'redirect');
  vi.stubEnv('PAYMENT_GATEWAY_START_URL', 'https://pay.example.test/start');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
  vi.unstubAllEnvs();
});
async function seed() {
  const userId = randomUUID(),
    profileId = randomUUID(),
    sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only')",
    [userId]
  );
  await http.pool.query("INSERT INTO profiles(id,user_id,status) VALUES ($1,$2,'ACTIVE')", [
    profileId,
    userId,
  ]);
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ($1,$2)', [
    userId,
    profileId,
  ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [sessionId, userId, csrf]
  );
  const correlationId = randomUUID(),
    key = randomUUID();
  const submit = () =>
    fetch(`${http.base}/api/wallet/${profileId}/top-ups`, {
      method: 'POST',
      headers: {
        Cookie: `barghsa_session=${sessionId}`,
        'X-CSRF-Token': csrf,
        'X-Correlation-ID': correlationId,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 1000 }),
    });
  return { userId, profileId, sessionId, csrf, correlationId, key, submit };
}

it('online HTTP initiation binds the authenticated actor and persists one Pending intent on retry', async () => {
  const input = await seed();
  const response = await input.submit();
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { transactionId: string; redirectUrl: string };
  expect(body).toMatchObject({ amount: 1000, state: 'Pending' });
  expect(new URL(body.redirectUrl).origin).toBe('https://pay.example.test');
  expect(await (await input.submit()).json()).toEqual(body);
  expect(
    (
      await http.pool.query(
        'SELECT user_id,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE user_id=$1',
        [input.userId]
      )
    ).rows
  ).toMatchObject([
    {
      user_id: input.userId,
      metadata: { sessionId: input.sessionId, transactionId: body.transactionId },
      correlation_id: input.correlationId,
    },
  ]);
});

it('online HTTP initiation rechecks a session revoked after the guard while waiting on its identity', async () => {
  const input = await seed(),
    blocker = await http.pool.connect(),
    keys = onlineTopUpAdvisoryLockKeys(input.key);
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('SELECT pg_advisory_lock($1,$2)', keys);
    pending = input.submit();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_lock%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
      input.sessionId,
    ]);
    await blocker.query('SELECT pg_advisory_unlock($1,$2)', keys);
    expect((await pending).status).toBe(401);
    expect(
      (
        await http.pool.query('SELECT profile_id FROM wallets WHERE profile_id=$1', [
          input.profileId,
        ])
      ).rows
    ).toEqual([]);
    expect(
      (
        await http.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [
          input.profileId,
        ])
      ).rows
    ).toEqual([]);
  } finally {
    await blocker.query('SELECT pg_advisory_unlock_all()');
    blocker.release();
    await pending;
  }
});

it('browser payment GET only redirects to confirmation and never changes the intent or claims an event', async () => {
  const input = await seed();
  expect((await input.submit()).status).toBe(201);
  const row = (
    await http.pool.query('SELECT id,ref_id FROM wallet_transactions WHERE wallet_id=$1', [
      input.profileId,
    ])
  ).rows[0];
  const response = await fetch(
    `${http.base}/api/wallet/top-ups/callback?orderId=${row.id}&Authority=${encodeURIComponent(row.ref_id)}&Status=NOK`,
    { redirect: 'manual' }
  );
  expect(
    (await http.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [row.id])).rows[0]
  ).toEqual({ state: 'Pending' });
  expect(
    (
      await http.pool.query(
        'SELECT event_id FROM wallet_topup_callback_events WHERE pending_transaction_id=$1',
        [row.id]
      )
    ).rows
  ).toEqual([]);
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get('location')!);
  expect(location.origin).toBe('https://app.example.test');
  expect(location.pathname).toBe('/wallet');
  expect(location.searchParams.get('paymentOrderId')).toBe(row.id);
  expect(location.searchParams.get('paymentAuthority')).toBe(row.ref_id);
  expect(response.headers.get('cache-control')).toContain('no-store');
});

it('browser confirmation requires a current session/CSRF/profile and credits only its bound order once', async () => {
  const input = await seed();
  expect((await input.submit()).status).toBe(201);
  const row = (
    await http.pool.query('SELECT id,ref_id FROM wallet_transactions WHERE wallet_id=$1', [
      input.profileId,
    ])
  ).rows[0];
  const body = { orderId: row.id, authority: row.ref_id };
  const post = (headers: Record<string, string>, payload = body) =>
    fetch(`${http.base}/api/wallet/top-ups/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  expect((await post({})).status).toBe(401);
  expect((await post({ Cookie: `barghsa_session=${input.sessionId}` })).status).toBe(403);
  expect(
    (await post({ Cookie: `barghsa_session=${input.sessionId}`, 'X-CSRF-Token': 'wrong' })).status
  ).toBe(403);
  const other = await seed();
  expect(
    (await post({ Cookie: `barghsa_session=${other.sessionId}`, 'X-CSRF-Token': other.csrf }))
      .status
  ).toBe(404);
  const headers = { Cookie: `barghsa_session=${input.sessionId}`, 'X-CSRF-Token': input.csrf };
  expect((await post(headers, { ...body, authority: 'wrong' })).status).toBe(401);
  expect(
    (await http.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [row.id])).rows[0]
  ).toEqual({ state: 'Pending' });
  const success = await post(headers);
  expect(success.status, await success.clone().text()).toBe(200);
  expect(await success.json()).toMatchObject({ credited: true, transactionId: row.id });
  expect(await (await post(headers)).json()).toMatchObject({ credited: true, processed: false });
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        input.profileId,
      ])
    ).rows[0]
  ).toEqual({ posted_balance: '1000' });
});

it('browser confirmation rechecks a session revoked while waiting on callback identity', async () => {
  const input = await seed();
  expect((await input.submit()).status).toBe(201);
  const row = (
    await http.pool.query('SELECT id,ref_id FROM wallet_transactions WHERE wallet_id=$1', [
      input.profileId,
    ])
  ).rows[0];
  const blocker = await http.pool.connect(),
    keys = onlineTopUpCallbackLockKeys(row.id);
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('SELECT pg_advisory_lock($1,$2)', keys);
    pending = fetch(`${http.base}/api/wallet/top-ups/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `barghsa_session=${input.sessionId}`,
        'X-CSRF-Token': input.csrf,
      },
      body: JSON.stringify({ orderId: row.id, authority: row.ref_id }),
    });
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_lock%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
      input.sessionId,
    ]);
    await blocker.query('SELECT pg_advisory_unlock($1,$2)', keys);
    expect((await pending).status).toBe(401);
    expect(
      (
        await http.pool.query(
          'SELECT event_id FROM wallet_topup_callback_events WHERE pending_transaction_id=$1',
          [row.id]
        )
      ).rows
    ).toEqual([]);
    expect(
      (
        await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
          input.profileId,
        ])
      ).rows[0]
    ).toEqual({ posted_balance: '0' });
  } finally {
    await blocker.query('SELECT pg_advisory_unlock_all()');
    blocker.release();
    await pending;
  }
});
