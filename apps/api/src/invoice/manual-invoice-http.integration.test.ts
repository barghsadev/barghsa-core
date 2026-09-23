import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '@barghsa/shared/errors';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ManualInvoiceController } from './manual-invoice.controller.js';

type IssuedInvoice = Awaited<ReturnType<ManualInvoiceController['create']>>;

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const profileId = randomUUID();
const archivedId = randomUUID();
const legalId = randomUUID();
const sessionId = randomUUID();
const csrf = randomUUID();
const headers: Record<string, string> = {
  Cookie: `barghsa_session=${sessionId}`,
  'X-CSRF-Token': csrf,
  'Content-Type': 'application/json',
};
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES
    ('manual-finance','manual-finance@example.test','test-only',true),
    ('manual-customer','manual-customer@example.test','test-only',false)`);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('manual-finance','role-finance')"
  );
  await http.pool.query(
    `INSERT INTO profiles(id,user_id,archived) VALUES ($1,'manual-customer',false),($2,'manual-customer',true)`,
    [profileId, archivedId]
  );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,archived) VALUES($1,'manual-customer','LEGAL',false)",
    [legalId]
  );
  await http.pool.query(
    `INSERT INTO legal_profiles(id,legal_name,national_identifier,registration_number,
       representative_title,representative_relationship)
     VALUES($1,'Acme Solar Ltd','12345678901','REG-1','Director','Authorized')`,
    [legalId]
  );
  await http.pool.query("UPDATE profiles SET title='Invoice customer' WHERE id=ANY($1::uuid[])", [
    [profileId, archivedId],
  ]);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'manual-finance',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID()]
  );
}, 40_000);
afterAll(async () => {
  await http?.close();
});

function payload() {
  return {
    profileId,
    idempotencyKey: randomUUID(),
    lines: [
      { description: 'برق مصرفی', quantity: 1, unitPrice: '55055', vatRate: 1000, isTaxable: true },
      {
        description: 'Service fee',
        quantity: 2,
        unitPrice: '100',
        vatRate: 1000,
        isTaxable: false,
      },
    ],
  };
}
function create(body: unknown, requestHeaders = headers) {
  return fetch(`${http.base}/api/admin/invoices/manual`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}
async function invoiceCount(key: string) {
  return Number(
    (
      await http.pool.query("SELECT count(*) FROM invoices WHERE metadata->>'idempotencyKey'=$1", [
        key,
      ])
    ).rows[0].count
  );
}

it('offers only matching active profiles to current Finance staff', async () => {
  const url = `${http.base}/api/admin/invoices/manual/profiles?search=Invoice`;
  const response = await fetch(url, { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    items: [{ id: profileId, title: 'Invoice customer', profileType: 'INDIVIDUAL' }],
    nextBefore: null,
  });
  const legal = await fetch(`${http.base}/api/admin/invoices/manual/profiles?search=Acme`, {
    headers,
  });
  expect(legal.status).toBe(200);
  expect(await legal.json()).toEqual({
    items: [{ id: legalId, title: 'Acme Solar Ltd', profileType: 'LEGAL' }],
    nextBefore: null,
  });
  expect((await fetch(url)).status).toBe(401);
  try {
    await http.pool.query("DELETE FROM user_roles WHERE user_id='manual-finance'");
    expect((await fetch(url, { headers })).status).toBe(403);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('manual-finance','role-finance') ON CONFLICT DO NOTHING"
    );
  }
});

it('pages matching profiles with a stable cursor and rejects invalid boundaries', async () => {
  const inserted = await http.pool.query<{ id: string }>(
    `INSERT INTO profiles(id,user_id,title,created_at)
     SELECT gen_random_uuid(),'manual-customer','Pageable customer',NOW()+INTERVAL '5 minutes'
     FROM generate_series(1,51) RETURNING id`
  );
  expect(inserted.rowCount).toBe(51);
  const path = `${http.base}/api/admin/invoices/manual/profiles?search=Pageable`;
  const first = await fetch(path, { headers });
  expect(first.status).toBe(200);
  const firstPage = (await first.json()) as {
    items: Array<{ id: string }>;
    nextBefore: string | null;
  };
  expect(firstPage.items).toHaveLength(50);
  expect(firstPage.nextBefore).toBe(firstPage.items[49]!.id);
  const next = await fetch(`${path}&before=${firstPage.nextBefore}`, { headers });
  expect(next.status).toBe(200);
  const secondPage = (await next.json()) as typeof firstPage;
  expect(secondPage.items).toHaveLength(1);
  expect(secondPage.nextBefore).toBeNull();
  expect(firstPage.items.some((row) => row.id === secondPage.items[0]!.id)).toBe(false);
  expect((await fetch(`${path}&before=bad`, { headers })).status).toBe(400);
  expect((await fetch(`${path}&before=${randomUUID()}`, { headers })).status).toBe(404);
});

it('Finance issues exact amounts and one audit; concurrent identical retries return one invoice', async () => {
  const body = payload();
  const responses = await Promise.all([create(body), create(body)]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const [first, replay] = await Promise.all([
    responses[0]!.json() as Promise<IssuedInvoice>,
    responses[1]!.json() as Promise<IssuedInvoice>,
  ]);
  expect(first).toEqual(replay);
  expect(first).toMatchObject({
    profileId,
    state: 'Unpaid',
    totalAmount: '60761',
    lines: [
      { lineTotal: '55055', vatAmount: '5506', position: 0 },
      { lineTotal: '200', vatAmount: '0', position: 1 },
    ],
  });
  expect(await invoiceCount(body.idempotencyKey)).toBe(1);
  const audit = await http.pool.query(
    "SELECT user_id, metadata FROM audit_log WHERE event='invoice.issue' AND metadata::jsonb->>'invoiceId'=$1",
    [first.invoiceId]
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0].user_id).toBe('manual-finance');
  expect(first.dueAt).not.toBeNull();
  expect(new Date(first.dueAt!).getTime()).toBeGreaterThan(new Date(first.issuedAt).getTime());
  const changed = { ...body, lines: [{ ...body.lines[0]!, unitPrice: '999' }] };
  expect((await create(changed)).status).toBe(409);
  expect(await invoiceCount(body.idempotencyKey)).toBe(1);
});

it.each(['abc', '-1', '1.5', '9223372036854775808', 123])(
  'rejects invalid IRR %s without creating an invoice',
  async (amount) => {
    const body = payload();
    expect(
      (await create({ ...body, lines: [{ ...body.lines[0], unitPrice: amount }] })).status
    ).toBe(400);
    expect(await invoiceCount(body.idempotencyKey)).toBe(0);
  }
);

it('rejects total overflow while preserving valid int8 money above JavaScript safe integer', async () => {
  const body = payload();
  const line = { ...body.lines[0], unitPrice: '9223372036854775807', vatRate: 0, isTaxable: false };
  expect((await create({ ...body, lines: [{ ...line, quantity: 2 }] })).status).toBe(400);
  expect(await invoiceCount(body.idempotencyKey)).toBe(0);
  const valid = await create({ ...body, lines: [{ ...line, quantity: 1 }] });
  expect(valid.status).toBe(201);
  expect(((await valid.json()) as IssuedInvoice).totalAmount).toBe('9223372036854775807');
});

it('rejects archived targets and client-supplied totals or actors', async () => {
  const body = payload();
  expect((await create({ ...body, profileId: archivedId })).status).toBe(409);
  expect((await create({ ...body, totalAmount: '1' })).status).toBe(400);
  expect((await create({ ...body, actorUserId: 'manual-customer' })).status).toBe(400);
  expect(await invoiceCount(body.idempotencyKey)).toBe(0);
});

it('requires session, CSRF, current Finance permission and recent step-up', async () => {
  const body = payload();
  expect((await create(body, { ...headers, Cookie: '' })).status).toBe(401);
  expect((await create(body, { ...headers, 'X-CSRF-Token': 'wrong' })).status).toBe(403);
  try {
    await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
      sessionId,
    ]);
    const stepUpResponse = await create(body);
    expect(stepUpResponse.status).toBe(403);
    expect(await stepUpResponse.json()).toMatchObject({
      error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
    });
    await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
      sessionId,
    ]);
    await http.pool.query("DELETE FROM user_roles WHERE user_id='manual-finance'");
    expect((await create(body)).status).toBe(403);
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('manual-finance','role-finance')"
    );
    await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [sessionId]);
    expect((await create(body)).status).toBe(401);
    expect(await invoiceCount(body.idempotencyKey)).toBe(0);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('manual-finance','role-finance') ON CONFLICT DO NOTHING"
    );
    await http.pool.query(
      'UPDATE sessions SET revoked_at=NULL,step_up_verified_at=NOW() WHERE session_id=$1',
      [sessionId]
    );
  }
});

it('rechecks session expiry after waiting to write and rolls the invoice back', async () => {
  const body = payload();
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE invoices IN SHARE MODE');
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '2 seconds' WHERE session_id=$1",
      [sessionId]
    );
    pending = create(body);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO invoices%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1',
              [sessionId]
            )
          ).rows[0].expired,
        { timeout: 5000 }
      )
      .toBe(true);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(401);
    expect(await invoiceCount(body.idempotencyKey)).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE session_id=$1",
      [sessionId]
    );
  }
});

it('rejects staff permission removed while the target profile lock is pending', async () => {
  const body = payload();
  // Use a new session; the previous case deliberately expired its session.
  const freshSession = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     VALUES ($1,'manual-finance',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [freshSession, csrf, randomUUID()]
  );
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
    pending = create(body, { ...headers, Cookie: `barghsa_session=${freshSession}` });
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id, archived FROM profiles%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await http.pool.query("DELETE FROM user_roles WHERE user_id='manual-finance'");
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect(await invoiceCount(body.idempotencyKey)).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('manual-finance','role-finance') ON CONFLICT DO NOTHING"
    );
  }
});
