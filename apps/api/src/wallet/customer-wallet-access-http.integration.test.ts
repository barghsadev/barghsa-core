import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
});

async function seed(roles?: string[]) {
  const owner = randomUUID(),
    user = roles ? randomUUID() : owner,
    profile = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  for (const id of new Set([owner, user]))
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'fixture-only')",
      [id]
    );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,$2,'LEGAL','ACTIVE')",
    [profile, owner]
  );
  for (const role of roles ?? [])
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,$3)', [
      profile,
      user,
      role,
    ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [session, user, csrf]
  );
  const headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const read = (suffix = '') => fetch(`${http.base}/api/wallet/${profile}${suffix}`, { headers });
  const create = () =>
    fetch(`${http.base}/api/wallet/${profile}/create`, { method: 'POST', headers, body: '{}' });
  return { owner, user, profile, session, csrf, headers, read, create };
}

it('returns exact transaction amounts beyond safe integers and isolates each wallet', async () => {
  const f = await seed(['Finance']),
    other = await seed();
  for (const x of [f, other]) {
    await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [x.profile]);
    await http.pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key) VALUES($1,'topup',9007199254740993,'Pending',$2)",
      [x.profile, randomUUID()]
    );
  }
  const response = await f.read('/transactions');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { transactions: { id: string; amount: string }[] };
  expect(body.transactions).toHaveLength(1);
  expect(body.transactions[0]!.amount).toBe('9007199254740993');
  await http.pool.query(
    "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key) VALUES($1,'payment',-9007199254740993,'Pending',$2)",
    [f.profile, randomUUID()]
  );
  expect(await (await f.read('/transactions')).json()).toMatchObject({
    transactions: expect.arrayContaining([
      expect.objectContaining({ amount: '-9007199254740993' }),
    ]),
  });
  expect(
    (await fetch(`${http.base}/api/wallet/${other.profile}/transactions`, { headers: f.headers }))
      .status
  ).toBe(404);
});

it.each([
  { roles: undefined, view: 200, create: 201 },
  { roles: ['Finance'], view: 200, create: 201 },
  { roles: ['Manager'], view: 200, create: 404 },
  { roles: ['Legal'], view: 404, create: 404 },
  { roles: ['Legal', 'Finance'], view: 200, create: 201 },
  { roles: ['Owner'], view: 404, create: 404 },
  { roles: [], view: 404, create: 404 },
])(
  'applies current wallet view and creation grants for $roles',
  async ({ roles, view, create }) => {
    const f = await seed(roles);
    expect((await f.read()).status).toBe(view);
    expect((await f.read('/transactions')).status).toBe(view);
    expect((await f.create()).status).toBe(create);
    expect(
      (await http.pool.query('SELECT profile_id FROM wallets WHERE profile_id=$1', [f.profile]))
        .rows
    ).toHaveLength(create === 201 ? 1 : 0);
    if (roles?.length) {
      await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
        f.profile,
        f.user,
      ]);
      expect((await f.read()).status).toBe(404);
      expect((await f.read('/transactions')).status).toBe(404);
      expect((await f.create()).status).toBe(404);
    }
  }
);

it('rejects archived profiles, invalid identifiers and unauthenticated wallet access', async () => {
  const f = await seed();
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  for (const suffix of ['', '/transactions', '/create']) {
    const method = suffix === '/create' ? 'POST' : 'GET';
    expect(
      (await fetch(`${http.base}/api/wallet/${f.profile}${suffix}`, { method, headers: f.headers }))
        .status
    ).toBe(404);
    expect(
      (await fetch(`${http.base}/api/wallet/invalid${suffix}`, { method, headers: f.headers }))
        .status
    ).toBe(400);
    expect((await fetch(`${http.base}/api/wallet/${f.profile}${suffix}`, { method })).status).toBe(
      401
    );
  }
});

it('holds a wallet reader grant through the response and applies removal to the next request', async () => {
  const f = await seed(['Finance']),
    blocker = await http.pool.connect();
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [f.profile]);
  let pending: Promise<Response> | undefined, removal: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE wallets IN ACCESS EXCLUSIVE MODE');
    pending = f.read();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT *, (posted_balance%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    removal = http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
      f.profile,
      f.user,
    ]);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'DELETE FROM profile_agents%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(200);
    await removal;
    expect((await f.read()).status).toBe(404);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
    await removal;
  }
});

it('rejects expired creation at commit and rolls back a new wallet', async () => {
  const f = await seed(),
    blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '2 seconds' WHERE session_id=$1",
      [f.session]
    );
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE wallets IN ACCESS EXCLUSIVE MODE');
    pending = f.create();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'WITH active_profile AS MATERIALIZED%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await http.pool.query('SELECT pg_sleep(2.1)');
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(401);
    expect(
      (await http.pool.query('SELECT profile_id FROM wallets WHERE profile_id=$1', [f.profile]))
        .rows
    ).toHaveLength(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
