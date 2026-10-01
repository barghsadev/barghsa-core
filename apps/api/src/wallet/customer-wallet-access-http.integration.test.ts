import type { WalletBankReceiptHistory } from '@barghsa/shared/finance';
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
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
    user,
    profile,
  ]);
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

it('paginates timestamp ties in both directions, filters, and binds cursors to the active profile', async () => {
  const f = await seed();
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [f.profile]);
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  for (const id of ids)
    await http.pool.query(
      "INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,created_at) VALUES($1::uuid,$2,'topup',100,'Pending',$1::text,'2026-09-01T12:00:00.123456Z')",
      [id, f.profile]
    );
  for (const sort of ['asc', 'desc']) {
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await f.read(
        `/transactions?limit=1&sort=${sort}&type=topup&state=Pending&from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z${cursor ? `&cursor=${cursor}` : ''}`
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        transactions: { id: string; createdAt: string }[];
        nextCursor: string | null;
      };
      expect(body.transactions).toHaveLength(1);
      expect(body.transactions[0]!.createdAt).toBe('2026-09-01T12:00:00.123456Z');
      found.push(body.transactions[0]!.id);
      cursor = body.nextCursor;
      expect(found.length).toBeLessThanOrEqual(3);
    } while (cursor);
    expect(found).toEqual(sort === 'asc' ? ids : [...ids].reverse());
  }
  for (const filter of [
    'type=payment',
    'state=Failed',
    'from=2026-09-02T00:00:00Z',
    'to=2026-08-31T00:00:00Z',
  ]) {
    expect(await (await f.read(`/transactions?${filter}`)).json()).toEqual({
      transactions: [],
      nextCursor: null,
    });
  }
  const first = (await (await f.read('/transactions?limit=1')).json()) as { nextCursor: string };
  expect((await f.read(`/transactions?sort=asc&cursor=${first.nextCursor}`)).status).toBe(400);
  const other = await seed();
  expect((await other.read(`/transactions?cursor=${first.nextCursor}`)).status).toBe(400);
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=1.5',
    'type=unknown',
    'state=unknown',
    'sort=invalid',
    'from=invalid',
    'from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z',
    'cursor=broken',
    'unknown=1',
    'type=topup&type=payment',
  ]) {
    expect((await f.read(`/transactions?${query}`)).status).toBe(400);
  }
  const secondProfile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES($1,$2,'LEGAL','ACTIVE')",
    [secondProfile, f.user]
  );
  await http.pool.query('UPDATE user_profile_contexts SET profile_id=$1 WHERE user_id=$2', [
    secondProfile,
    f.user,
  ]);
  expect((await f.read('/transactions')).status).toBe(404);
});

it('returns receipt details and recorded verification events without exposing private metadata or duplicate credits', async () => {
  const f = await seed(['Finance']),
    other = await seed();
  const receiptId = randomUUID(),
    creditId = randomUUID(),
    legacyCreditId = randomUUID();
  const submittedAt = '2026-09-01T23:30:00.123456Z';
  const metadata = {
    channel: 'bank_receipt',
    receipt: {
      paymentDate: '2026-09-01',
      payerReference: 'TRK-123',
      bankName: 'بانک ملی',
      customerNote: 'Branch transfer',
      attachmentKey: 'private-receipt-key',
    },
    dualApproval: {
      requestId: 'private-request',
      initiatorId: 'private-initiator',
      fingerprint: 'private-fingerprint',
      invoiceId: null,
      requestedAt: '2026-09-02T10:00:00.000Z',
    },
    staffDecision: {
      decision: 'confirmed',
      actorUserId: 'private-actor',
      decidedAt: '2026-09-03T10:00:00.000Z',
      reason: 'private-reason',
      customerVisible: false,
      creditTransactionId: creditId,
    },
    financialReview: { privateReview: true },
    sessionId: 'private-session',
  };
  for (const profile of [f.profile, other.profile])
    await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  for (const [id, profile, state, evidence] of [
    [receiptId, f.profile, 'Released', metadata],
    [creditId, f.profile, 'Completed', { ...metadata, pendingTransactionId: receiptId }],
    [legacyCreditId, f.profile, 'Completed', metadata],
    [randomUUID(), other.profile, 'Released', metadata],
  ] as const)
    await http.pool.query(
      "INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata,created_at) VALUES($1::uuid,$2,'topup',9007199254740993,$3,$1::text,$4::jsonb,$5::timestamptz)",
      [id, profile, state, JSON.stringify(evidence), submittedAt]
    );
  const response = await f.read('/transactions');
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    transactions: { id: string; amount: string; createdAt: string; bankReceipt?: unknown }[];
    nextCursor: string | null;
  };
  expect(body.transactions).toHaveLength(3);
  expect(body.transactions.find((tx) => tx.id === receiptId)).toEqual({
    id: receiptId,
    type: 'topup',
    amount: '9007199254740993',
    state: 'Released',
    refId: null,
    description: null,
    createdAt: submittedAt,
    bankReceipt: {
      paymentDate: '2026-09-01',
      payerReference: 'TRK-123',
      bankName: 'بانک ملی',
      customerNote: 'Branch transfer',
      rejectionReason: null,
      timeline: {
        events: [
          { state: 'submitted', occurredAt: submittedAt },
          { state: 'approval_requested', occurredAt: '2026-09-02T10:00:00.000Z' },
          { state: 'confirmed', occurredAt: '2026-09-03T10:00:00.000Z' },
        ],
        awaiting: null,
      },
    },
  });
  expect(body.transactions.find((tx) => tx.id === creditId)).not.toHaveProperty('bankReceipt');
  expect(body.transactions.find((tx) => tx.id === legacyCreditId)).not.toHaveProperty(
    'bankReceipt'
  );
  expect(JSON.stringify(body)).not.toMatch(
    /private-|financialReview|actorUserId|attachmentKey|pendingTransactionId/
  );
  expect(
    (await fetch(`${http.base}/api/wallet/${other.profile}/transactions`, { headers: f.headers }))
      .status
  ).toBe(404);
  await http.pool.query(
    "UPDATE wallet_transactions SET state='Rejected',metadata=metadata||$2::jsonb WHERE id=$1",
    [
      receiptId,
      JSON.stringify({
        staffDecision: {
          ...metadata.staffDecision,
          decision: 'rejected',
          customerVisible: true,
          reason: 'Please provide a readable deposit reference',
        },
      }),
    ]
  );
  const rejected = (await (await f.read('/transactions?state=Rejected')).json()) as {
    transactions: { bankReceipt: WalletBankReceiptHistory }[];
  };
  expect(rejected.transactions[0]!.bankReceipt.rejectionReason).toBe(
    'Please provide a readable deposit reference'
  );
  expect(rejected.transactions[0]!.bankReceipt.timeline.events.at(-1)).toEqual({
    state: 'rejected',
    occurredAt: '2026-09-03T10:00:00.000Z',
  });
});

it('searches only public wallet fields and original receipt metadata literally, with exact magnitude/date bounds', async () => {
  const f = await seed(['Finance']),
    other = await seed();
  for (const fixture of [f, other])
    await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [fixture.profile]);
  const token = randomUUID(),
    bank = `${token}_%\\بانک`,
    reference = `${token}-TRANSFER`,
    receipt = randomUUID(),
    debit = randomUUID(),
    second = randomUUID(),
    credit = randomUUID(),
    legacyCredit = randomUUID();
  const metadata = {
    channel: 'bank_receipt',
    receipt: { bankName: bank, payerReference: reference, paymentDate: '2026-09-01' },
    staffDecision: {
      actorUserId: 'private-search-sentinel',
      reason: 'private-search-sentinel',
      customerVisible: false,
    },
  };
  for (const [id, profile, type, amount, state, date, evidence, description] of [
    [
      receipt,
      f.profile,
      'topup',
      '9007199254740993',
      'Pending',
      '2026-09-01T00:00:00.000001Z',
      metadata,
      null,
    ],
    [
      debit,
      f.profile,
      'payment',
      '-9007199254740993',
      'Completed',
      '2026-09-01T00:00:00.000002Z',
      {},
      `${token} public payment`,
    ],
    [
      second,
      f.profile,
      'topup',
      '9007199254740994',
      'Released',
      '2026-09-02T00:00:00.000000Z',
      metadata,
      null,
    ],
    [
      credit,
      f.profile,
      'topup',
      '9007199254740993',
      'Completed',
      '2026-09-01T00:00:00.000003Z',
      { ...metadata, pendingTransactionId: receipt },
      null,
    ],
    [
      legacyCredit,
      f.profile,
      'topup',
      '9007199254740993',
      'Completed',
      '2026-09-01T00:00:00.000003Z',
      metadata,
      null,
    ],
    [
      randomUUID(),
      other.profile,
      'topup',
      '9007199254740993',
      'Pending',
      '2026-09-01T00:00:00Z',
      metadata,
      null,
    ],
  ] as const)
    await http.pool.query(
      'INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata,created_at,description,ref_id) VALUES($1::uuid,$2,$3,$4::bigint,$5,$1::text,$6::jsonb,$7::timestamptz,$8,$9)',
      [
        id,
        profile,
        type,
        amount,
        state,
        JSON.stringify(evidence),
        date,
        description,
        id === debit ? reference : null,
      ]
    );
  const readQuery = async (query: Record<string, string>) => {
    const response = await f.read(`/transactions?${new URLSearchParams(query)}`);
    expect(response.status, http.logs()).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    return (await response.json()) as { transactions: { id: string; amount: string }[] };
  };
  expect((await readQuery({ q: bank })).transactions.map((row) => row.id)).toEqual([
    second,
    receipt,
  ]);
  expect(
    (await readQuery({ q: reference.toLowerCase() })).transactions.map((row) => row.id)
  ).toEqual([second, debit, receipt]);
  expect((await readQuery({ q: debit })).transactions.map((row) => row.id)).toEqual([debit]);
  expect((await readQuery({ q: 'public payment' })).transactions.map((row) => row.id)).toEqual([
    debit,
  ]);
  expect((await readQuery({ q: 'private-search-sentinel' })).transactions).toEqual([]);
  expect(
    (
      await readQuery({
        q: token,
        min: '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳',
        max: '9007199254740993',
        from: '2026-09-01T00:00:00.000Z',
        until: '2026-09-02T00:00:00.000Z',
        sort: 'asc',
      })
    ).transactions.map((row) => row.id)
  ).toEqual([receipt, debit]);
  expect(
    (
      await readQuery({
        q: bank,
        type: 'topup',
        state: 'Pending',
        min: '9007199254740993',
        max: '9007199254740993',
      })
    ).transactions.map((row) => row.id)
  ).toEqual([receipt]);
  expect(
    (await readQuery({ q: bank, until: '2026-09-02T00:00:00.000Z' })).transactions.map(
      (row) => row.id
    )
  ).toEqual([receipt]);
  expect(
    (await readQuery({ q: bank, to: '2026-09-02T00:00:00.000Z' })).transactions.map((row) => row.id)
  ).toEqual([second, receipt]);
  // abs(bigint) would overflow for the minimum stored debit; numeric magnitude does not.
  const minimumDebit = randomUUID();
  await http.pool.query(
    "INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,description) VALUES($1::uuid,$2,'payment',-9223372036854775808,'Completed',$1::text,$3)",
    [minimumDebit, f.profile, 'minimum-debit-' + token]
  );
  expect(
    (await readQuery({ q: 'minimum-debit-' + token, min: '9223372036854775807' })).transactions.map(
      (row) => row.amount
    )
  ).toEqual(['-9223372036854775808']);
  expect(
    (await readQuery({ q: 'minimum-debit-' + token, max: '9223372036854775807' })).transactions
  ).toEqual([]);
  for (const query of [
    'q=one&q=two',
    'q=' + 'x'.repeat(121),
    'q=bad%0Aquery',
    'min=2&max=1',
    'min=-1',
    'max=9223372036854775808',
    'until=2026-02-30T00%3A00%3A00Z',
    'from=2026-09-02T00%3A00%3A00Z&until=2026-09-02T00%3A00%3A00Z',
    'to=2026-09-02T00%3A00%3A00Z&until=2026-09-02T00%3A00%3A00Z',
  ])
    expect((await f.read(`/transactions?${query}`)).status).toBe(400);
});
it('binds new wallet search/amount/date cursors to every criterion while retaining tied exact pagination', async () => {
  const f = await seed();
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [f.profile]);
  const token = randomUUID(),
    ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  for (const id of ids)
    await http.pool.query(
      "INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,created_at,description) VALUES($1::uuid,$2,'topup',9007199254740993,'Pending',$1::text,'2026-09-01T00:00:00.123456Z',$3)",
      [id, f.profile, token]
    );
  const criteria = {
    q: token,
    min: '9007199254740993',
    max: '9007199254740993',
    until: '2026-09-02T00:00:00.000Z',
    limit: '1',
  };
  let original = '';
  for (const sort of ['asc', 'desc']) {
    let cursor = '',
      count = 0;
    const seen: string[] = [];
    do {
      const response = await f.read(
        `/transactions?${new URLSearchParams({ ...criteria, sort, ...(cursor ? { cursor } : {}) })}`
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        transactions: { id: string; createdAt: string }[];
        nextCursor: string | null;
      };
      seen.push(...result.transactions.map((row) => row.id));
      expect(result.transactions[0]!.createdAt).toBe('2026-09-01T00:00:00.123456Z');
      cursor = result.nextCursor ?? '';
      if (sort === 'desc' && count === 0) original = cursor;
      expect(++count).toBeLessThan(5);
    } while (cursor);
    expect(seen).toEqual(sort === 'asc' ? ids : [...ids].reverse());
  }
  for (const patch of [
    { q: 'different' },
    { min: '0' },
    { max: '9223372036854775807' },
    { until: '2026-09-03T00:00:00.000Z' },
  ])
    expect(
      (
        await f.read(
          `/transactions?${new URLSearchParams({ ...criteria, sort: 'desc', cursor: original, ...patch })}`
        )
      ).status
    ).toBe(400);
});
