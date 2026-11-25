import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { startHttpFixture } from '../test/http-fixture.js';
import { expectSubmissionAudit } from '../test/submission-audit.js';
import {
  expectOrderSubmitted,
  expectSubmissionNotificationRollback,
} from '../test/order-submission-notifications.js';

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

it.each(['catalogue', 'history', 'detail'] as const)(
  'denies consultation %s when its session expires during the data read',
  async (view) => {
    const requestId = randomUUID();
    const session = randomUUID();
    const productId = (
      await http.pool.query<{ id: string }>(
        "SELECT id FROM products WHERE system_key='electricity_generation_station'"
      )
    ).rows[0]!.id;
    if (view !== 'catalogue') {
      await http.pool.query(
        `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,submission_key)
         SELECT $1,$2,id,jsonb_build_object('title',title),'individual',$3 FROM products WHERE id=$4`,
        [requestId, profiles.individual, randomUUID(), productId]
      );
    }
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,'individual',$2,$3,clock_timestamp()+INTERVAL '1 hour',clock_timestamp()+INTERVAL '30 minutes')`,
      [session, randomUUID(), randomUUID()]
    );
    const query = `?profileId=${profiles.individual}`;
    const routes = {
      catalogue: { path: `products${query}`, table: 'products', marker: productId },
      history: { path: `requests${query}`, table: 'invoices', marker: requestId },
      detail: { path: `requests/${requestId}`, table: 'invoices', marker: requestId },
    } as const;
    const { path, table, marker } = routes[view];
    const read = () =>
      fetch(`${http.base}/api/consultations/${path}`, {
        headers: { Cookie: `barghsa_session=${session}` },
      });
    const before = await read();
    expect(before.status, http.logs()).toBe(200);
    const expected = {
      catalogue: { products: expect.arrayContaining([expect.objectContaining({ id: productId })]) },
      history: { requests: expect.arrayContaining([expect.objectContaining({ id: requestId })]) },
      detail: { request: { id: requestId } },
    };
    expect(await before.json()).toMatchObject(expected[view]);
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      const { pid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!;
      const { expires_at: expiresAt } = (
        await http.pool.query<{ expires_at: Date }>(
          `UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '4 seconds'
           WHERE session_id=$1 RETURNING expires_at`,
          [session]
        )
      ).rows[0]!;
      pending = read();
      await expect
        .poll(async () => {
          const waiting = await http.pool.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
               AND query LIKE $2`,
            [pid, view === 'catalogue' ? '%FROM products p%' : '%FROM consultation_requests r%']
          );
          return waiting.rows[0]!.count;
        })
        .toBe(1);
      await expect
        .poll(
          async () => {
            const observed = await http.pool.query<{ expired: boolean }>(
              'SELECT clock_timestamp()>=$1::timestamptz AS expired',
              [expiresAt]
            );
            return observed.rows[0]!.expired;
          },
          { timeout: 6000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      const denied = await pending;
      expect(denied.status, http.logs()).toBe(401);
      expect(await denied.text()).not.toContain(marker);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      if (view !== 'catalogue') {
        await http.pool.query('DELETE FROM consultation_requests WHERE id=$1', [requestId]);
      }
      await http.pool.query('DELETE FROM sessions WHERE session_id=$1', [session]);
    }
  },
  12000
);

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
  const post = (
    user: string,
    profileId: string,
    productId: string,
    submissionKey: string,
    brief?: string
  ) =>
    fetch(`${http.base}/api/consultations/requests`, {
      method: 'POST',
      headers: headers[user]!,
      body: JSON.stringify({ profileId, productId, submissionKey, brief }),
    });
  expect((await post('individual', profiles.individual!, certificateId, randomUUID())).status).toBe(
    400
  );
  const key = randomUUID();
  const productId = individualProducts[0]!.id;
  const brief = 'Could you review my site and advise on suitable generation capacity?';
  const findReceipt = (user: string, profileId: string, selection = productId) =>
    fetch(
      `${http.base}/api/consultations/requests/submissions/${key}?profileId=${profileId}&productId=${selection}`,
      { headers: headers[user]! }
    );
  expect(await (await findReceipt('individual', profiles.individual!)).json()).toEqual({
    receipt: null,
  });
  await expectSubmissionNotificationRollback(http.pool, () =>
    post('individual', profiles.individual!, productId, key, brief)
  );
  expect(await (await findReceipt('individual', profiles.individual!)).json()).toEqual({
    receipt: null,
  });
  const submitted = await post('individual', profiles.individual!, productId, key, ` ${brief} `);
  expect(submitted.status, http.logs()).toBe(201);
  const created = (await submitted.json()) as { requestId: string; status: string };
  expect(created.status).toBe('submitted');
  const retry = await post('individual', profiles.individual!, productId, key, brief);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toEqual(created);
  expect((await post('individual', profiles.individual!, productId, key, 'Changed')).status).toBe(
    409
  );
  expect((await post('individual', profiles.individual!, productId, key)).status).toBe(409);
  const recovered = await findReceipt('individual', profiles.individual!);
  expect(recovered.status, http.logs()).toBe(200);
  expect(recovered.headers.get('cache-control')).toContain('no-store');
  expect(await recovered.json()).toEqual({ receipt: created });
  expect((await findReceipt('company', profiles.individual!)).status).toBe(404);
  expect(await (await findReceipt('company', profiles.company!)).json()).toEqual({ receipt: null });
  expect(
    await (await findReceipt('individual', profiles.individual!, certificateId)).json()
  ).toEqual({
    receipt: null,
  });
  await expectOrderSubmitted(http.pool, {
    service: 'consultation',
    id: created.requestId,
    profileId: profiles.individual!,
    owner: 'individual',
    table: 'consultation_requests',
    route: '/consultations',
  });
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
  await expectSubmissionAudit(http.pool, {
    event: 'consultation.request.submitted',
    actor: 'individual',
    entity: 'consultation_request',
    id: created.requestId,
    state: 'submitted',
  });
  const detail = await fetch(`${http.base}/api/consultations/requests/${created.requestId}`, {
    headers: headers.individual!,
  });
  expect(detail.status, http.logs()).toBe(200);
  expect(await detail.json()).toMatchObject({
    request: { id: created.requestId, invoice_id: null, fee: null },
    history: [{ status: 'submitted', actor_type: 'customer', reason: brief }],
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
  await http.pool.query(
    `INSERT INTO consultation_requests
    (profile_id,product_id,product_snapshot,submitted_by,submission_key,status,submitted_at)
    SELECT profile_id,product_id,product_snapshot,submitted_by,gen_random_uuid(),'completed',submitted_at + n * interval '1 second'
    FROM consultation_requests CROSS JOIN generate_series(1,101) n WHERE id=$1`,
    [created.requestId]
  );
  const filtered = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profiles.individual}&statuses=submitted`,
    { headers: headers.individual! }
  );
  expect(filtered.status, http.logs()).toBe(200);
  expect(await filtered.json()).toMatchObject({
    requests: [{ id: created.requestId }],
    nextBefore: null,
  });
  const completedPage = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profiles.individual}&statuses=completed`,
    { headers: headers.individual! }
  );
  const page = (await completedPage.json()) as {
    requests: { id: string; status: string }[];
    nextBefore: string;
  };
  expect(page.requests).toHaveLength(100);
  expect(page.requests.every((row) => row.status === 'completed')).toBe(true);
  const older = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profiles.individual}&statuses=completed&before=${page.nextBefore}`,
    { headers: headers.individual! }
  );
  expect(((await older.json()) as { requests: unknown[] }).requests).toHaveLength(1);
  expect(
    (
      await fetch(
        `${http.base}/api/consultations/requests?profileId=${profiles.individual}&statuses=completed&before=${created.requestId}`,
        { headers: headers.individual! }
      )
    ).status
  ).toBe(404);
  expect(
    (
      await fetch(
        `${http.base}/api/consultations/requests?profileId=${profiles.individual}&statuses=unknown`,
        { headers: headers.individual! }
      )
    ).status
  ).toBe(400);
  const originalTime = (
    await http.pool.query<{ submitted_at: Date }>(
      'SELECT submitted_at FROM consultation_requests WHERE id=$1',
      [created.requestId]
    )
  ).rows[0]!.submitted_at;
  const start = originalTime.toISOString();
  const end = new Date(originalTime.getTime() + 1000).toISOString();
  // PostgreSQL stores sub-millisecond precision; pin one row to the exact tested boundary.
  await http.pool.query('UPDATE consultation_requests SET submitted_at=$2 WHERE id=$1', [
    created.requestId,
    start,
  ]);
  const range = new URLSearchParams({
    profileId: profiles.individual!,
    from: start,
    to: end,
    statuses: 'submitted,completed',
  });
  const ranged = await fetch(`${http.base}/api/consultations/requests?${range}`, {
    headers: headers.individual!,
  });
  expect(ranged.status, http.logs()).toBe(200);
  expect(await ranged.json()).toMatchObject({
    requests: [{ id: created.requestId }],
    nextBefore: null,
  });
  range.set('to', start);
  expect(
    (
      await fetch(`${http.base}/api/consultations/requests?${range}`, {
        headers: headers.individual!,
      })
    ).status
  ).toBe(400);
  range.delete('from');
  const excluded = await fetch(`${http.base}/api/consultations/requests?${range}`, {
    headers: headers.individual!,
  });
  expect(await excluded.json()).toEqual({ requests: [], nextBefore: null });
  range.set('before', created.requestId);
  expect(
    (
      await fetch(`${http.base}/api/consultations/requests?${range}`, {
        headers: headers.individual!,
      })
    ).status
  ).toBe(404);
  const combined = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profiles.individual}&statuses=submitted,completed`,
    { headers: headers.individual! }
  );
  expect(((await combined.json()) as { requests: unknown[] }).requests).toHaveLength(100);
  // Equal submission times must still paginate deterministically by UUID.
  await http.pool.query(
    "UPDATE consultation_requests SET submitted_at=$2 WHERE profile_id=$1 AND status='completed'",
    [profiles.individual, end]
  );
  const ascending = new URLSearchParams({
    profileId: profiles.individual!,
    sort: 'submitted_at:asc',
    statuses: 'submitted,completed',
  });
  const sorted = await fetch(`${http.base}/api/consultations/requests?${ascending}`, {
    headers: headers.individual!,
  });
  expect(sorted.status, http.logs()).toBe(200);
  const firstPage = (await sorted.json()) as { requests: { id: string }[]; nextBefore: string };
  expect(firstPage.requests).toHaveLength(100);
  expect(firstPage.requests[0]!.id).toBe(created.requestId);
  ascending.set('before', firstPage.nextBefore);
  const nextPage = await fetch(`${http.base}/api/consultations/requests?${ascending}`, {
    headers: headers.individual!,
  });
  expect(nextPage.status, http.logs()).toBe(200);
  const lastPage = (await nextPage.json()) as { requests: { id: string }[]; nextBefore: null };
  expect(lastPage.requests).toHaveLength(2);
  expect(lastPage.nextBefore).toBeNull();
  const expectedIds = (
    await http.pool.query<{ id: string }>(
      'SELECT id FROM consultation_requests WHERE profile_id=$1 ORDER BY submitted_at ASC,id ASC',
      [profiles.individual]
    )
  ).rows.map((r) => r.id);
  expect([...firstPage.requests, ...lastPage.requests].map((r) => r.id)).toEqual(expectedIds);
  const search = new URLSearchParams({
    profileId: profiles.individual!,
    q: created.requestId,
    from: start,
    to: end,
    statuses: 'submitted',
    sort: 'submitted_at:asc',
  });
  const searched = await fetch(`${http.base}/api/consultations/requests?${search}`, {
    headers: headers.individual!,
  });
  expect(searched.status, http.logs()).toBe(200);
  expect(await searched.json()).toMatchObject({
    requests: [{ id: created.requestId }],
    nextBefore: null,
  });
  // Literal wildcard characters must not broaden a customer search.
  search.set('q', '%');
  const literal = await fetch(`${http.base}/api/consultations/requests?${search}`, {
    headers: headers.individual!,
  });
  expect(await literal.json()).toEqual({ requests: [], nextBefore: null });
  search.set('before', created.requestId);
  expect(
    (
      await fetch(`${http.base}/api/consultations/requests?${search}`, {
        headers: headers.individual!,
      })
    ).status
  ).toBe(404);
  search.delete('before');
  await http.pool.query(
    "UPDATE consultation_requests SET product_snapshot=jsonb_set(product_snapshot,'{title}',$2::jsonb) WHERE id=$1",
    [created.requestId, JSON.stringify({ en: '100%_\\ Service', fa: 'مشاوره' })]
  );
  for (const q of ['100%_\\', 'مشاوره']) {
    search.set('q', q);
    const titleMatch = await fetch(`${http.base}/api/consultations/requests?${search}`, {
      headers: headers.individual!,
    });
    expect(titleMatch.status, http.logs()).toBe(200);
    expect(await titleMatch.json()).toMatchObject({
      requests: [{ id: created.requestId }],
      nextBefore: null,
    });
  }
  search.delete('q');
  search.set('sort', 'status:asc');
  expect(
    (
      await fetch(`${http.base}/api/consultations/requests?${search}`, {
        headers: headers.individual!,
      })
    ).status
  ).toBe(400);
});

it('owns product and brief errors and rejects protected or unauthorized submissions without writes', async () => {
  const productId = (
    await http.pool.query(
      "SELECT id FROM products WHERE system_key='electricity_generation_station'"
    )
  ).rows[0].id as string;
  const body = { profileId: profiles.individual!, productId, submissionKey: randomUUID() };
  const snapshot = async () =>
    (
      await http.pool.query(
        `SELECT
         (SELECT count(*)::int FROM consultation_requests) AS requests,
         (SELECT count(*)::int FROM consultation_request_events) AS events,
         (SELECT count(*)::int FROM invoices) AS invoices,
         (SELECT count(*)::int FROM audit_log WHERE event LIKE 'consultation.%') AS audits,
         (SELECT count(*)::int FROM in_app_notifications) AS notifications`
      )
    ).rows[0];
  const before = await snapshot();
  for (const [input, fields] of [
    [{ ...body, productId: 'PRIVATE' }, ['productId']],
    [{ ...body, productId: null }, ['productId']],
    [{ ...body, brief: { value: 'PRIVATE' } }, ['brief']],
    [{ ...body, brief: 'PRIVATE'.repeat(300) }, ['brief']],
    [{ ...body, profileId: 'PRIVATE' }, undefined],
    [{ ...body, submissionKey: 'PRIVATE' }, undefined],
    [{ ...body, productId: 'PRIVATE', profileId: 'PRIVATE' }, undefined],
    [{ ...body, productId: 'PRIVATE', privateKey: 'PRIVATE' }, undefined],
    [[], undefined],
  ] as Array<[unknown, string[] | undefined]>) {
    const response = await fetch(`${http.base}/api/consultations/requests`, {
      method: 'POST',
      headers: headers.individual!,
      body: JSON.stringify(input),
    });
    expect(response.status, http.logs()).toBe(400);
    const receipt = (await response.json()) as { error: { code: string; fields?: string[] } };
    expect(receipt.error.code).toBe(
      fields ? ErrorCodes.VALIDATION_INPUT_INVALID.code : 'VALIDATION:INPUT_INVALID'
    );
    expect(receipt.error.fields).toEqual(fields);
    expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE|privateKey|submissionKey/);
  }
  const denied = await fetch(`${http.base}/api/consultations/requests`, {
    method: 'POST',
    headers: headers.company!,
    body: JSON.stringify(body),
  });
  expect(denied.status, http.logs()).toBe(404);
  expect((await denied.json()) as { error: { fields?: string[] } }).toMatchObject({
    error: expect.not.objectContaining({ fields: expect.anything() }),
  });
  expect(await snapshot()).toEqual(before);
});

it('keeps foreign financial rows out of an owned consultation even when their references match', async () => {
  const requestId = randomUUID();
  const invoiceId = randomUUID();
  await http.pool.query(
    `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,submission_key)
     SELECT $1,$2,id,jsonb_build_object('title',title),'individual',$3
     FROM products WHERE system_key='electricity_generation_station'`,
    [requestId, profiles.individual, randomUUID()]
  );
  await http.pool.query(
    `INSERT INTO invoices(id,profile_id,consultation_id,type,state,total_amount,paid_amount,issued_at,payable_from)
     VALUES($1,$2,$3,'manual','Paid',500,500,NOW(),NOW())`,
    [invoiceId, profiles.company, requestId]
  );
  await http.pool.query(
    `INSERT INTO invoices(profile_id,consultation_id,type,total_amount,adjustment_kind,adjustment_for_invoice_id)
     VALUES($1,$2,'manual',50,'charge',$3)`,
    [profiles.company, requestId, invoiceId]
  );
  await http.pool.query(
    `INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key)
     VALUES($1,$2,100,'wallet',$3)`,
    [invoiceId, profiles.company, randomUUID()]
  );
  await http.pool.query('UPDATE consultation_requests SET invoice_id=$2 WHERE id=$1', [
    requestId,
    invoiceId,
  ]);
  const detail = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers.individual!,
  });
  expect(detail.status, http.logs()).toBe(200);
  expect(await detail.json()).toMatchObject({
    request: { id: requestId, invoice_id: null, invoice_state: null, has_paid_invoice: false },
    adjustments: [],
    refunds: [],
  });

  const search = new URLSearchParams({ profileId: profiles.individual!, q: requestId });
  const list = await fetch(`${http.base}/api/consultations/requests?${search}`, {
    headers: headers.individual!,
  });
  expect(list.status, http.logs()).toBe(200);
  expect(await list.json()).toMatchObject({
    requests: [
      {
        id: requestId,
        invoice_id: null,
        invoice_state: null,
        refund_pending: false,
      },
    ],
    nextBefore: null,
  });

  const invoice = await fetch(`${http.base}/api/invoices/${invoiceId}`, {
    headers: headers.company!,
  });
  expect(invoice.status, http.logs()).toBe(200);
  expect(await invoice.json()).toMatchObject({ consultationId: null });

  const staffSession = randomUUID();
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff)
       VALUES('consultation-reader','reader@consultation.test','test-only',true);
     INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES('consultation-reader','Consultation reader','Fixture','["orders:read"]');
     INSERT INTO user_roles(user_id,role_id) VALUES('consultation-reader','consultation-reader')`
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
     VALUES($1,'consultation-reader',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','staff')`,
    [staffSession, randomUUID(), randomUUID()]
  );
  const staffDetail = await fetch(`${http.base}/api/staff/consultations/${requestId}`, {
    headers: { Cookie: `barghsa_session=${staffSession}` },
  });
  expect(staffDetail.status, http.logs()).toBe(200);
  expect(await staffDetail.json()).toMatchObject({
    request: {
      id: requestId,
      invoice_id: null,
      invoice_state: null,
      has_paid_invoice: false,
      uncovered_credit: '0',
    },
  });

  const { id: standaloneInvoice } = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO invoices(profile_id,type,total_amount) VALUES($1,'manual',500) RETURNING id`,
      [profiles.individual]
    )
  ).rows[0]!;
  await http.pool.query('UPDATE consultation_requests SET invoice_id=$2 WHERE id=$1', [
    requestId,
    standaloneInvoice,
  ]);
  const standaloneDetail = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers.individual!,
  });
  expect(standaloneDetail.status, http.logs()).toBe(200);
  expect(await standaloneDetail.json()).toMatchObject({
    request: { id: requestId, invoice_id: null, invoice_state: null },
  });

  const held = await http.pool.connect();
  try {
    await held.query('BEGIN');
    await held.query('SELECT id FROM consultation_requests WHERE id=$1 FOR UPDATE', [requestId]);
    const denied = await fetch(
      `${http.base}/api/consultations/requests/${requestId}/provide-info`,
      {
        method: 'POST',
        headers: headers.company!,
        body: JSON.stringify({ reason: 'Additional fixture information' }),
        signal: AbortSignal.timeout(3000),
      }
    );
    expect(denied.status, http.logs()).toBe(404);
  } finally {
    await held.query('ROLLBACK');
    held.release();
  }
});
