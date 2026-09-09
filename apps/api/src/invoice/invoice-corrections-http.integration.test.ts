import { SessionService } from '../session/session.service.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { replayInvoiceCalculation } from './invoice-calculation-snapshot.js';
import type { InvoiceCorrectionsController } from './invoice-corrections.controller.js';

type Kind = 'replacement' | 'adjustment';
type Result = Awaited<ReturnType<InvoiceCorrectionsController['create']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const profileId = randomUUID();
const lines = [
  {
    description: 'Corrected usage',
    quantity: 1,
    unitPrice: '55055',
    vatRate: 1000,
    isTaxable: true,
  },
  { description: 'Service', quantity: 2, unitPrice: '100', vatRate: 0, isTaxable: false },
];

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES
    ('correction-finance','correction-finance@example.test','test-only',true),
    ('correction-customer','correction-customer@example.test','test-only',false)`);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('correction-finance','role-finance')"
  );
  await http.pool.query("INSERT INTO profiles(id,user_id) VALUES ($1,'correction-customer')", [
    profileId,
  ]);
}, 40_000);
afterAll(async () => {
  await http?.close();
});

async function actor(userId = 'correction-finance') {
  const sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, userId, csrf, randomUUID()]
  );
  return {
    sessionId,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}
async function original(kind: Kind) {
  const id = randomUUID();
  await http.pool.query(
    `INSERT INTO invoices(id,profile_id,type,state,total_amount,paid_amount,issued_at,payable_from,due_at)
    VALUES ($1,$2,'manual',$3,100000,$4,NOW(),NOW(),NOW()+INTERVAL '7 days')`,
    [id, profileId, kind === 'replacement' ? 'Unpaid' : 'Paid', kind === 'replacement' ? 0 : 100000]
  );
  await http.pool.query(
    `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,vat_rate,vat_amount,is_taxable,position)
    VALUES ($1,$2,'Original usage',1,100000,100000,0,0,false,0)`,
    [randomUUID(), id]
  );
  return id;
}
function payload(kind: Kind) {
  return {
    kind,
    reason: 'Customer correction',
    idempotencyKey: randomUUID(),
    ...(kind === 'replacement' ? { lines } : { amount: '-25000' }),
  };
}
function create(id: string, body: unknown, headers: Record<string, string>) {
  return fetch(`${http.base}/api/admin/invoices/${id}/corrections`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
async function snapshot(id: string) {
  return {
    invoice: (await http.pool.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0],
    lines: (
      await http.pool.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id', [id])
    ).rows,
  };
}
async function linkedCount(id: string) {
  return Number(
    (
      await http.pool.query(
        'SELECT count(*) FROM invoices WHERE replaces_invoice_id=$1 OR adjustment_for_invoice_id=$1',
        [id]
      )
    ).rows[0].count
  );
}

it.each(['replacement', 'adjustment'] as const)(
  '%s reads the source, commits once for concurrent retries, and replays exact snapshot money',
  async (kind) => {
    const who = await actor(),
      id = await original(kind),
      body = payload(kind),
      before = await snapshot(id);
    const context = await fetch(`${http.base}/api/admin/invoices/${id}/corrections`, {
      headers: who.headers,
    });
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      invoiceId: id,
      profileId,
      totalAmount: '100000',
      lines: [{ description: 'Original usage', unitPrice: '100000' }],
    });
    const replies = await Promise.all([
      create(id, body, who.headers),
      create(id, body, who.headers),
    ]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    const [first, retry] = await Promise.all(replies.map((r) => r.json() as Promise<Result>));
    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      originalInvoiceId: id,
      profileId,
      kind,
      idempotencyKey: body.idempotencyKey,
      totalAmount: kind === 'replacement' ? '60761' : '25000',
      amount: kind === 'replacement' ? '60761' : '-25000',
    });
    expect(await linkedCount(id)).toBe(1);
    const after = await snapshot(id);
    expect(after.lines).toEqual(before.lines);
    expect(after.invoice.total_amount).toBe(before.invoice.total_amount);
    expect(after.invoice.paid_amount).toBe(before.invoice.paid_amount);
    expect(after.invoice.state).toBe(kind === 'replacement' ? 'Cancelled' : 'Paid');
    const created = (await snapshot(first!.invoiceId)).invoice;
    expect(
      replayInvoiceCalculation(created.invoice_calculation_snapshot).totalAmount.toString()
    ).toBe(first!.totalAmount);
    expect(
      created[kind === 'replacement' ? 'replaces_invoice_id' : 'adjustment_for_invoice_id']
    ).toBe(id);
    if (kind === 'adjustment') {
      expect(created.accounting_amount).toBe('-25000');
      expect(created.payable_from).toBeNull();
      expect(created.due_at).toBeNull();
    }
    const audit = await http.pool.query(
      "SELECT user_id FROM audit_log WHERE event='invoice.issue' AND metadata::jsonb->>'invoiceId'=$1",
      [first!.invoiceId]
    );
    expect(audit.rows).toEqual([{ user_id: 'correction-finance' }]);
    expect(
      (await create(id, { ...body, reason: 'Different correction' }, who.headers)).status
    ).toBe(409);
    expect(await linkedCount(id)).toBe(1);
    // Successful keys never bypass fresh authority.
    await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
      who.sessionId,
    ]);
    expect((await create(id, body, who.headers)).status).toBe(401);
  }
);

it('issues an additional charge with exact int8 money above Number precision', async () => {
  const who = await actor(),
    id = await original('adjustment');
  const response = await create(
    id,
    { ...payload('adjustment'), amount: '9007199254740993' },
    who.headers
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    amount: '9007199254740993',
    totalAmount: '9007199254740993',
    payableFrom: expect.any(String),
    dueAt: expect.any(String),
  });
});

it.each(['replacement', 'adjustment'] as const)(
  '%s requires session, CSRF, Finance authority and step-up',
  async (kind) => {
    const who = await actor(),
      customer = await actor('correction-customer'),
      id = await original(kind),
      body = payload(kind);
    expect((await create(id, body, { ...who.headers, Cookie: '' })).status).toBe(401);
    expect((await create(id, body, { ...who.headers, 'X-CSRF-Token': 'wrong' })).status).toBe(403);
    expect((await create(id, body, customer.headers)).status).toBe(403);
    expect(
      (
        await fetch(`${http.base}/api/admin/invoices/${id}/corrections`, {
          headers: customer.headers,
        })
      ).status
    ).toBe(403);
    await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
      who.sessionId,
    ]);
    expect((await create(id, body, who.headers)).status).toBe(403);
    expect(await linkedCount(id)).toBe(0);
  }
);

it('rejects malformed, zero, overflowing and forged correction payloads without writes', async () => {
  const who = await actor(),
    unpaid = await original('replacement'),
    paid = await original('adjustment');
  for (const amount of [
    'abc',
    '1.5',
    '0',
    '-0',
    '9223372036854775808',
    '-9223372036854775808',
    123,
  ])
    expect((await create(paid, { ...payload('adjustment'), amount }, who.headers)).status).toBe(
      400
    );
  for (const unitPrice of ['abc', '-1', '9223372036854775808', 123])
    expect(
      (
        await create(
          unpaid,
          { ...payload('replacement'), lines: [{ ...lines[0], unitPrice }] },
          who.headers
        )
      ).status
    ).toBe(400);
  for (const extra of [
    { actorUserId: 'correction-customer' },
    { totalAmount: '1' },
    { profileId },
    { dueAt: '2026-01-01' },
  ])
    expect(
      (await create(unpaid, { ...payload('replacement'), ...extra }, who.headers)).status
    ).toBe(400);
  expect(
    (
      await create(
        unpaid,
        {
          ...payload('replacement'),
          lines: [{ ...lines[0], quantity: 2, unitPrice: '9223372036854775807', vatRate: 0 }],
        },
        who.headers
      )
    ).status
  ).toBe(400);
  expect((await create(unpaid, payload('adjustment'), who.headers)).status).toBe(409);
  expect((await create(paid, payload('replacement'), who.headers)).status).toBe(409);
  expect(await linkedCount(unpaid)).toBe(0);
  expect(await linkedCount(paid)).toBe(0);
});

it.each(['replacement', 'adjustment'] as const)(
  '%s rolls back after audit failure',
  async (kind) => {
    const who = await actor(),
      id = await original(kind),
      body = payload(kind),
      before = await snapshot(id);
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test correction audit failure'; END $$; CREATE TRIGGER reject_correction_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='invoice.issue') EXECUTE FUNCTION reject_correction_audit()"
    );
    try {
      expect((await create(id, body, who.headers)).status).toBe(500);
      expect(await snapshot(id)).toEqual(before);
      expect(await linkedCount(id)).toBe(0);
    } finally {
      await http.pool.query('DROP TRIGGER reject_correction_audit ON audit_log');
    }
    expect((await create(id, body, who.headers)).status).toBe(201);
    expect(await linkedCount(id)).toBe(1);
  }
);

it.each(['replacement', 'adjustment'] as const)(
  '%s rejects permission revoked while waiting on its profile',
  async (kind) => {
    const who = await actor(),
      id = await original(kind),
      body = payload(kind),
      blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      pending = create(id, body, who.headers);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id, archived FROM profiles%' "
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await http.pool.query("DELETE FROM user_roles WHERE user_id='correction-finance'");
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(await linkedCount(id)).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('correction-finance','role-finance') ON CONFLICT DO NOTHING"
      );
    }
  }
);

it.each([
  ['replacement', 'session'],
  ['replacement', 'step-up'],
  ['adjustment', 'session'],
  ['adjustment', 'step-up'],
] as const)('%s rolls back when %s expires during the audit write', async (kind, expiry) => {
  const who = await actor(),
    id = await original(kind),
    body = payload(kind),
    before = await snapshot(id),
    blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
    await http.pool.query(
      expiry === 'session'
        ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1"
        : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-($2::double precision*INTERVAL '1 millisecond')+INTERVAL '2 seconds' WHERE session_id=$1",
      expiry === 'session' ? [who.sessionId] : [who.sessionId, SessionService.STEP_UP_WINDOW_MS]
    );
    pending = create(id, body, who.headers);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO audit_log%' "
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
              expiry === 'session'
                ? 'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1'
                : "SELECT step_up_verified_at+($2::double precision*INTERVAL '1 millisecond')<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1",
              expiry === 'session'
                ? [who.sessionId]
                : [who.sessionId, SessionService.STEP_UP_WINDOW_MS]
            )
          ).rows[0].expired,
        { timeout: 5000 }
      )
      .toBe(true);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(expiry === 'session' ? 401 : 403);
    expect(await snapshot(id)).toEqual(before);
    expect(await linkedCount(id)).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
