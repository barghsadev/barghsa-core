import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { WalletService } from './wallet.service.js';
import type { StaffWalletLedgerController } from './staff-wallet-ledger.controller.js';
type LedgerPage = Awaited<ReturnType<StaffWalletLedgerController['transactions']>>;

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@barghsa/db')>()),
  getDbPool: () => {
    if (!holder.pool) throw new Error('Ledger fixture not initialized');
    return holder.pool;
  },
}));

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const profile = randomUUID();
const other = randomUUID();
const empty = randomUUID();
const headers: Record<string, Record<string, string>> = {};
const sessions: Record<string, string> = {};
const credits: string[] = [];

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  holder.pool = http.pool;
  await http.pool.query(`INSERT INTO staff_roles(role_id,name,description,permissions) VALUES
    ('ledger-reconciler','Ledger reconciler','Test','["admin:reconciliation:view"]'),
    ('ledger-unrelated','Ledger unrelated','Test','["contracts:write"]')`);
  for (const [user, role, context] of [
    ['ledger-staff', 'ledger-reconciler', 'staff'],
    ['ledger-unrelated', 'ledger-unrelated', 'staff'],
    ['ledger-customer-grant', 'ledger-reconciler', 'customer'],
    ['ledger-customer', null, 'customer'],
  ] as const) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, `${user}@ledger.test`, 'test-only', !!role]
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    const session = randomUUID();
    sessions[user] = session;
    headers[user] = { Cookie: `barghsa_session=${session}` };
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',$5)`,
      [session, user, randomUUID(), randomUUID(), context]
    );
  }
  await http.pool.query(
    "INSERT INTO profiles(id,user_id) VALUES($1,'ledger-customer'),($2,'ledger-customer'),($3,'ledger-customer')",
    [profile, other, empty]
  );
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1),($2)', [profile, other]);
  const wallets = new WalletService();
  for (const [id, amount, description] of [
    [profile, 9007199254740993n, 'Exact principal'],
    [profile, 10n, 'Second credit'],
    [other, 5n, 'Other profile private credit'],
  ] as const) {
    const tx = await wallets.credit(
      id,
      amount,
      {
        type: 'topup',
        refId: randomUUID(),
        description,
        metadata: { providerSecret: 'private-ledger-fixture' },
      },
      randomUUID()
    );
    credits.push(tx.id);
  }
}, 60000);

afterAll(async () => {
  holder.pool = null;
  await http?.close();
});

function get(id = profile, user = 'ledger-staff', query = '') {
  return fetch(`${http.base}/api/admin/reconciliation/wallets/${id}/transactions${query}`, {
    headers: headers[user] ?? {},
  });
}

it('reads exact profile-scoped financial history without private metadata or financial mutations', async () => {
  const balances = (await http.pool.query('SELECT * FROM wallets ORDER BY profile_id')).rows;
  const ledger = (await http.pool.query('SELECT * FROM wallet_transactions ORDER BY id')).rows;
  const response = await get();
  expect(response.status, http.logs()).toBe(200);
  expect(response.headers.get('cache-control')).toBe(
    'private, no-cache, no-store, must-revalidate'
  );
  const body = (await response.json()) as LedgerPage;
  expect(body.profileId).toBe(profile);
  expect(body.nextCursor).toBeNull();
  expect(body.transactions).toHaveLength(2);
  expect(body.transactions.map((tx: { id: string }) => tx.id)).toEqual([credits[1], credits[0]]);
  expect(body.transactions[1]).toEqual({
    id: credits[0],
    type: 'topup',
    amount: '9007199254740993',
    state: 'Completed',
    refId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    description: 'Exact principal',
    createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*\.\d{6}Z$/),
  });
  expect(JSON.stringify(body)).not.toContain('private-ledger-fixture');
  expect(JSON.stringify(body)).not.toContain('Other profile private credit');
  expect(body.transactions[0]).not.toHaveProperty('bankReceipt');
  expect((await http.pool.query('SELECT * FROM wallets ORDER BY profile_id')).rows).toEqual(
    balances
  );
  expect((await http.pool.query('SELECT * FROM wallet_transactions ORDER BY id')).rows).toEqual(
    ledger
  );
});

it('paginates without duplicates and rejects cursors belonging to another profile or filter', async () => {
  const first = await get(profile, 'ledger-staff', '?limit=1');
  expect(first.status, http.logs()).toBe(200);
  const page = (await first.json()) as LedgerPage;
  expect(page.transactions.map((tx: { id: string }) => tx.id)).toEqual([credits[1]]);
  expect(page.nextCursor).toEqual(expect.any(String));
  const query = `?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`;
  const second = await get(profile, 'ledger-staff', query);
  expect(second.status, http.logs()).toBe(200);
  expect(await second.json()).toEqual({
    profileId: profile,
    transactions: [expect.objectContaining({ id: credits[0], amount: '9007199254740993' })],
    nextCursor: null,
  });
  expect((await get(other, 'ledger-staff', query)).status).toBe(400);
  expect((await get(profile, 'ledger-staff', `${query}&type=refund`)).status).toBe(400);
});

it('filters exact amounts and literal descriptions through the existing history parser', async () => {
  const response = await get(
    profile,
    'ledger-staff',
    '?min=9007199254740993&q=Exact&type=topup&state=Completed&sort=asc'
  );
  expect(response.status, http.logs()).toBe(200);
  const body = (await response.json()) as LedgerPage;
  expect(body.transactions).toEqual([
    expect.objectContaining({ id: credits[0], amount: '9007199254740993' }),
  ]);
  expect(body.nextCursor).toBeNull();
});

it('returns an empty history without creating a wallet, and 404 for an unknown profile', async () => {
  const response = await get(empty);
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toEqual({ profileId: empty, transactions: [], nextCursor: null });
  expect(
    (await http.pool.query('SELECT * FROM wallets WHERE profile_id=$1', [empty])).rows
  ).toEqual([]);
  expect((await get(randomUUID())).status).toBe(404);
});

it.each(['ledger-unrelated', 'ledger-customer-grant', 'ledger-customer', 'anonymous'])(
  'denies %s without revealing financial history',
  async (user) => {
    const response = await get(profile, user);
    expect(response.status, http.logs()).toBe(user === 'anonymous' ? 401 : 403);
    const body = await response.json();
    expect(body).not.toHaveProperty('transactions');
    expect(JSON.stringify(body)).not.toContain('9007199254740993');
    expect(JSON.stringify(body)).not.toContain('private-ledger-fixture');
  }
);

it.each([
  '?limit=101',
  '?limit=0',
  '?unknown=1',
  '?cursor=broken',
  '?min=1.1',
  '?from=2026-02-30T00:00:00Z',
])('rejects invalid history query %s', async (query) => {
  const response = await get(profile, 'ledger-staff', query);
  expect(response.status, http.logs()).toBe(400);
  expect(await response.json()).not.toHaveProperty('transactions');
});

async function waitForLock(fragment: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await http.pool.query(
      "SELECT pid FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1",
      [`%${fragment}%`]
    );
    if (result.rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Ledger request did not block on ${fragment}`);
}

it('denies grants revoked during the authentication actor lock wait', async () => {
  const locker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await locker.query('BEGIN');
    await locker.query("SELECT user_id FROM users WHERE user_id='ledger-staff' FOR UPDATE");
    pending = get();
    await waitForLock('WHERE s.session_id=$1 FOR UPDATE OF u');
    await locker.query("DELETE FROM user_roles WHERE user_id='ledger-staff'");
    await locker.query('COMMIT');
    const response = await pending;
    expect(response.status, http.logs()).toBe(403);
    expect(await response.json()).not.toHaveProperty('transactions');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
    await pending?.catch(() => {});
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('ledger-staff','ledger-reconciler') ON CONFLICT DO NOTHING"
    );
  }
});

it('withholds history if the locked session expires while its read is blocked', async () => {
  const locker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
      [sessions['ledger-staff']]
    );
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE wallet_transactions IN ACCESS EXCLUSIVE MODE');
    pending = get();
    await waitForLock('FROM wallet_transactions');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await locker.query('COMMIT');
    const response = await pending;
    expect(response.status, http.logs()).toBe(401);
    expect(await response.json()).not.toHaveProperty('transactions');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
    await pending?.catch(() => {});
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE session_id=$1",
      [sessions['ledger-staff']]
    );
  }
});
