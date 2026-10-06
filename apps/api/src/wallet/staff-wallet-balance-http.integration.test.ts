import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profile: string, empty: string;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(`INSERT INTO staff_roles(role_id,name,description,permissions) VALUES
    ('wallet-balance-finance','Wallet finance','Test','["admin:financial:edit"]'),
    ('wallet-balance-legal','Wallet legal','Test','["contracts:write"]')`);
  for (const [user, role, context] of [
    ['balance-finance', 'wallet-balance-finance', 'staff'],
    ['balance-legal', 'wallet-balance-legal', 'staff'],
    ['balance-customer-finance', 'wallet-balance-finance', 'customer'],
    ['balance-customer', null, 'customer'],
  ] as const) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, user + '@wallet-balance.test', 'test-only', !!role]
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    const session = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',$5)",
      [session, user, randomUUID(), randomUUID(), context]
    );
    headers[user] = { Cookie: `barghsa_session=${session}` };
  }
  for (const name of ['main', 'empty']) {
    const row = (
      await http.pool.query(
        "INSERT INTO profiles(user_id,profile_type,status,title,is_default) VALUES('balance-customer','LEGAL','ACTIVE',$1,$2) RETURNING id",
        [name, name === 'main']
      )
    ).rows[0];
    if (name === 'main') profile = row.id;
    else empty = row.id;
  }
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,$2,10)',
    [profile, '9007199254740999']
  );
}, 30000);
afterAll(async () => {
  await http?.close();
});
function get(id = profile, user = 'balance-finance') {
  return fetch(`${http.base}/api/staff/profiles/${id}/wallet-balance`, { headers: headers[user]! });
}

it('reads exact available balance for the target profile without changing financial records', async () => {
  const before = (await http.pool.query('SELECT * FROM wallets ORDER BY profile_id')).rows;
  const transactions = (await http.pool.query('SELECT * FROM wallet_transactions')).rows;
  const response = await get();
  expect(response.status, http.logs()).toBe(200);
  expect(response.headers.get('cache-control')).toBe(
    'private, no-cache, no-store, must-revalidate'
  );
  expect(await response.json()).toEqual({
    profileId: profile,
    currency: 'IRR',
    balance: '9007199254740989',
  });
  expect((await http.pool.query('SELECT * FROM wallets ORDER BY profile_id')).rows).toEqual(before);
  expect((await http.pool.query('SELECT * FROM wallet_transactions')).rows).toEqual(transactions);
});
it('shows zero for an existing profile without creating a missing wallet', async () => {
  const response = await get(empty);
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toEqual({ profileId: empty, currency: 'IRR', balance: '0' });
  expect(
    (await http.pool.query('SELECT * FROM wallets WHERE profile_id=$1', [empty])).rows
  ).toEqual([]);
});
it.each(['balance-legal', 'balance-customer-finance', 'balance-customer'])(
  'denies %s without disclosing the balance',
  async (user) => {
    const response = await get(profile, user);
    expect(response.status, http.logs()).toBe(403);
    const body = await response.json();
    expect(body).not.toHaveProperty('balance');
    expect(JSON.stringify(body)).not.toContain('9007199254740989');
  }
);
it('returns no financial data for unknown profiles', async () => {
  const response = await get(randomUUID());
  expect(response.status, http.logs()).toBe(404);
  expect(await response.json()).not.toHaveProperty('balance');
});
it('withdraws cached finance authority revoked while the actual wallet read is blocked', async () => {
  const locker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE wallets IN ACCESS EXCLUSIVE MODE');
    pending = get();
    const deadline = Date.now() + 4000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked =
        (
          await http.pool.query(
            "SELECT pid FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM wallets WHERE profile_id = $1%'"
          )
        ).rows.length > 0;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(blocked).toBe(true);
    await http.pool.query("DELETE FROM user_roles WHERE user_id='balance-finance'");
    await locker.query('COMMIT');
    const response = await pending;
    expect(response.status, http.logs()).toBe(403);
    expect(await response.json()).not.toHaveProperty('balance');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
    await pending?.catch(() => {});
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('balance-finance','wallet-balance-finance') ON CONFLICT DO NOTHING"
    );
  }
});
