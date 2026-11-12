import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Missing PostgreSQL');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
}, 40_000);

afterAll(async () => {
  await http?.close();
});

it('returns only the active profile’s first three due invoices and totals every unpaid balance', async () => {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const profileId = randomUUID();
  const otherProfileId = randomUUID();
  const sessionId = randomUUID();
  for (const id of [userId, otherUserId]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only')",
      [id]
    );
  }
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,is_default,status) VALUES ($1,$2,'INDIVIDUAL',true,'ACTIVE'),($3,$4,'INDIVIDUAL',true,'ACTIVE')",
    [profileId, userId, otherProfileId, otherUserId]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [sessionId, userId, randomUUID(), randomUUID()]
  );
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES ($1,600,0)',
    [profileId]
  );
  const ids = Array.from({ length: 4 }, () => randomUUID());
  for (const [index, id] of ids.entries()) {
    await http.pool.query(
      `INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,issued_at,payable_from,due_at)
       VALUES ($1,$2,'Unpaid',$3,$4,NOW(),NOW(),NOW()+($5::int * INTERVAL '1 day'))`,
      [id, profileId, (index + 1) * 100, index === 1 ? 50 : 0, index + 1]
    );
  }
  const foreignInvoiceId = randomUUID();
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,issued_at,payable_from,due_at) VALUES ($1,$2,'Unpaid',9999,NOW(),NOW(),NOW())",
    [foreignInvoiceId, otherProfileId]
  );

  const response = await fetch(`${http.base}/api/dashboard`, {
    headers: { Cookie: `barghsa_session=${sessionId}` },
  });
  expect(response.status, http.logs()).toBe(200);
  const dashboard = (await response.json()) as {
    profile: { id: string };
    access: { invoices: boolean; orders: boolean; contracts: boolean };
    wallet: { balance: string; lowBalanceWarning: boolean };
    pendingInvoices: number;
    upcomingInvoices: Array<{
      invoiceId: string;
      dueAt: string;
      payableFrom: string;
      remainingAmount: string;
    }>;
    recentOrders: unknown[];
    activeContracts: unknown[];
  };
  expect(dashboard.profile.id).toBe(profileId);
  expect(dashboard.access.invoices).toBe(true);
  expect(dashboard.access.orders).toBe(true);
  expect(dashboard.access.contracts).toBe(true);
  expect(dashboard.recentOrders).toEqual([]);
  expect(dashboard.activeContracts).toEqual([]);
  expect(dashboard.pendingInvoices).toBe(4);
  expect(dashboard.upcomingInvoices.map((invoice) => invoice.invoiceId)).toEqual(ids.slice(0, 3));
  expect(dashboard.upcomingInvoices.map((invoice) => invoice.remainingAmount)).toEqual([
    '100',
    '150',
    '300',
  ]);
  expect(dashboard.upcomingInvoices.every((invoice) => invoice.dueAt && invoice.payableFrom)).toBe(
    true
  );
  expect(dashboard.wallet.lowBalanceWarning).toBe(true);
  expect(dashboard.wallet.balance).toBe('600');
  expect(dashboard.upcomingInvoices.some((invoice) => invoice.invoiceId === foreignInvoiceId)).toBe(
    false
  );

  const headers = { Cookie: `barghsa_session=${sessionId}` };
  const context = await fetch(`${http.base}/api/dashboard/context`, { headers });
  expect(context.status).toBe(200);
  expect(context.headers.get('cache-control')).toBe('private, no-store');
  expect(await context.json()).toMatchObject({ profile: { id: profileId } });
  for (const [widget, expected] of [
    ['invoices', dashboard.upcomingInvoices],
    ['orders', []],
    ['contracts', []],
  ] as const) {
    const result = await fetch(
      `${http.base}/api/dashboard/widgets/${widget}?profileId=${profileId}`,
      { headers }
    );
    expect(result.status, http.logs()).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(await result.json()).toEqual({ profileId, data: expected });
  }
  const wallet = await fetch(`${http.base}/api/dashboard/widgets/wallet?profileId=${profileId}`, {
    headers,
  });
  expect(await wallet.json()).toEqual({
    profileId,
    data: {
      balance: '600',
      postedBalance: '600',
      reservedBalance: '0',
      currency: 'IRR',
      lowBalanceWarning: true,
      pendingInvoices: 4,
    },
  });
  const counts = await fetch(`${http.base}/api/dashboard/widgets/status?profileId=${profileId}`, {
    headers,
  });
  expect(await counts.json()).toMatchObject({ data: { unpaidInvoices: 4 } });
  expect(
    (
      await fetch(`${http.base}/api/dashboard/widgets/invoices?profileId=${otherProfileId}`, {
        headers,
      })
    ).status
  ).toBe(409);
  expect((await fetch(`${http.base}/api/dashboard/widgets/invoices`, { headers })).status).toBe(
    400
  );
  expect(
    (await fetch(`${http.base}/api/dashboard/widgets/invoices?profileId=invalid`, { headers }))
      .status
  ).toBe(400);
  expect(
    (await fetch(`${http.base}/api/dashboard/widgets/unknown?profileId=${profileId}`, { headers }))
      .status
  ).toBe(400);
  expect(
    (await fetch(`${http.base}/api/dashboard/widgets/invoices?profileId=${profileId}`)).status
  ).toBe(401);
});
