import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { runMigrations } from './migrate';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const actor = randomUUID(),
  reviewer = randomUUID();
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  for (const user of [actor, reviewer])
    await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,$1)', [
      user,
    ]);
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});
async function transaction(work: (client: PoolClient) => Promise<void>) {
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function seed(paid = '0', service = 'electricity') {
  const row = {
    id: randomUUID(),
    version: randomUUID(),
    profile: randomUUID(),
    invoice: randomUUID(),
    paid,
  };
  await transaction(async (client) => {
    await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [row.profile, actor]);
    await client.query(
      'INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,$3,$4)',
      [row.id, row.profile, service, row.version]
    );
    await client.query(
      'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,\'{"text":"Terms"}\',\'Initial\',$3)',
      [row.version, row.id, actor]
    );
    if (paid !== '0')
      await client.query(
        "INSERT INTO invoices(id,profile_id,contract_id,state,total_amount,paid_amount) VALUES($1,$2,$3,'Paid',$4,$4)",
        [row.invoice, row.profile, row.id, paid]
      );
  });
  return row;
}
type Row = Awaited<ReturnType<typeof seed>>;
type Decision = { invoiceId: string; amount: string; destination: string };
async function intent(
  row: Row,
  options: {
    id?: string;
    key?: string;
    approval?: string;
    policy?: Record<string, unknown>;
    refunds?: Decision[];
    snapshot?: Record<string, unknown>;
  } = {},
  client: Pool | PoolClient = fixture.pool
) {
  const id = options.id ?? randomUUID();
  const snapshot = options.snapshot ?? {
    contractId: row.id,
    versionId: row.version,
    profileId: row.profile,
    state: 'Draft',
    refundableAmount: row.paid,
    invoices: row.paid === '0' ? [] : [{ id: row.invoice, refundableAmount: row.paid }],
  };
  const refunds =
    options.refunds ??
    (row.paid === '0' ? [] : [{ invoiceId: row.invoice, amount: row.paid, destination: 'wallet' }]);
  await client.query(
    `INSERT INTO contract_cancellation_intents(id,contract_id,version_id,actor_id,reason,refund_decision,financial_snapshot,financial_fingerprint,financial_impact_amount,approval_policy,approval_request_id,idempotency_key,created_at)
    VALUES($1,$2,$3,$4,'Service cancelled',$5,$6,$7,$8,$9,$10,$11,'2000-01-01')`,
    [
      id,
      row.id,
      row.version,
      actor,
      { refunds },
      snapshot,
      'a'.repeat(64),
      row.paid,
      options.policy ?? { enabled: false },
      options.approval ?? null,
      options.key ?? randomUUID(),
    ]
  );
  return id;
}
async function cancel(row: Row, intentId: string, client: Pool | PoolClient = fixture.pool) {
  await client.query(
    "UPDATE contracts SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
    [row.id]
  );
  await client.query(
    "INSERT INTO contract_cancellations(contract_id,intent_id,executed_by,cancelled_at) VALUES($1,$2,$3,'2000-01-01')",
    [row.id, intentId, actor]
  );
}
it('captures immutable version-bound decisions, server timestamps and unique retry identities', async () => {
  const row = await seed(),
    key = randomUUID(),
    id = await intent(row, { key });
  const saved = (
    await fixture.pool.query('SELECT * FROM contract_cancellation_intents WHERE id=$1', [id])
  ).rows[0];
  expect(saved.created_at.getUTCFullYear()).toBeGreaterThan(2000);
  await expect(intent(row, { key })).rejects.toMatchObject({ code: '23505' });
  await expect(
    fixture.pool.query(
      "UPDATE contract_cancellation_intents SET reason='New decision' WHERE id=$1",
      [id]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM contract_cancellation_intents WHERE id=$1', [id])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    intent(row, {
      snapshot: {
        contractId: row.id,
        versionId: randomUUID(),
        profileId: row.profile,
        state: 'Draft',
        refundableAmount: '0',
        invoices: [],
      },
    })
  ).rejects.toMatchObject({ code: '23514' });
});
it('requires the full electricity return to the wallet and rejects duplicate or foreign allocations', async () => {
  const row = await seed('100');
  for (const refunds of [
    [],
    [{ invoiceId: row.invoice, amount: '50', destination: 'wallet' }],
    [{ invoiceId: row.invoice, amount: '100', destination: 'external_bank' }],
    [{ invoiceId: randomUUID(), amount: '100', destination: 'wallet' }],
    [
      { invoiceId: row.invoice, amount: '50', destination: 'wallet' },
      { invoiceId: row.invoice, amount: '50', destination: 'wallet' },
    ],
  ])
    await expect(intent(row, { refunds })).rejects.toMatchObject({ code: '23514' });
  await expect(intent(row)).resolves.toEqual(expect.any(String));
});
it('requires a bound approval at threshold and refuses execution while it is pending', async () => {
  const row = await seed('100'),
    id = randomUUID(),
    approval = randomUUID();
  const policy = { enabled: true, thresholdIrR: '100' };
  await expect(intent(row, { policy })).rejects.toMatchObject({ code: '23514' });
  await fixture.pool.query(
    "INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reason,details) VALUES($1,'contract_cancellation',100,$2,'Review cancellation',$3)",
    [
      approval,
      actor,
      {
        intentId: id,
        contractId: row.id,
        versionId: row.version,
        financialFingerprint: 'a'.repeat(64),
      },
    ]
  );
  await expect(intent(row, { id: randomUUID(), approval, policy })).rejects.toMatchObject({
    code: '23514',
  });
  await intent(row, { id, approval, policy });
  await expect(transaction((client) => cancel(row, id, client))).rejects.toMatchObject({
    code: '23514',
  });
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [row.id])).rows[0].state
  ).toBe('Draft');
  await fixture.pool.query(
    "UPDATE approval_requests SET status='approved',reviewer_id=$2,reviewed_at=now() WHERE id=$1",
    [approval, reviewer]
  );
  await transaction(async (client) => {
    await cancel(row, id, client);
    const refund = randomUUID();
    await client.query(
      "INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,100,'wallet',$4)",
      [refund, row.invoice, row.profile, randomUUID()]
    );
    await client.query(
      'INSERT INTO contract_refund_obligations(refund_id,contract_id,invoice_id) VALUES($1,$2,$3)',
      [refund, row.id, row.invoice]
    );
  });
  const saved = (
    await fixture.pool.query(
      'SELECT cancelled_at FROM contract_cancellations WHERE contract_id=$1',
      [row.id]
    )
  ).rows[0];
  const parent = (
    await fixture.pool.query('SELECT cancelled_at FROM contracts WHERE id=$1', [row.id])
  ).rows[0];
  expect(saved.cancelled_at).toEqual(parent.cancelled_at);
});
it('requires actual cancelled state and keeps execution evidence immutable', async () => {
  const row = await seed(),
    id = await intent(row);
  await expect(
    fixture.pool.query(
      'INSERT INTO contract_cancellations(contract_id,intent_id,executed_by) VALUES($1,$2,$3)',
      [row.id, id, actor]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await transaction((client) => cancel(row, id, client));
  for (const statement of [
    'DELETE FROM contract_cancellations WHERE contract_id=$1',
    'UPDATE contract_cancellations SET cancelled_at=now() WHERE contract_id=$1',
  ])
    await expect(fixture.pool.query(statement, [row.id])).rejects.toMatchObject({ code: '23514' });
  await expect(intent(row)).rejects.toMatchObject({ code: '23514' });
});
it('binds mandatory obligations to the exact system refund and prevents dismissal', async () => {
  const row = await seed('100'),
    id = await intent(row),
    refund = randomUUID();
  await transaction(async (client) => {
    await cancel(row, id, client);
    await client.query(
      "INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,100,'wallet',$4)",
      [refund, row.invoice, row.profile, randomUUID()]
    );
    await client.query(
      'INSERT INTO contract_refund_obligations(refund_id,contract_id,invoice_id) VALUES($1,$2,$3)',
      [refund, row.id, row.invoice]
    );
  });
  for (const state of ['Rejected', 'Cancelled'])
    await expect(
      fixture.pool.query('UPDATE refunds SET state=$2 WHERE id=$1', [refund, state])
    ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM contract_refund_obligations WHERE refund_id=$1', [refund])
  ).rejects.toMatchObject({ code: '23514' });
  const wrong = await seed('100');
  const wrongRefund = (
    await fixture.pool.query(
      "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,100,'wallet',$3) RETURNING id",
      [wrong.invoice, wrong.profile, randomUUID()]
    )
  ).rows[0].id;
  await expect(
    fixture.pool.query(
      'INSERT INTO contract_refund_obligations(refund_id,contract_id,invoice_id) VALUES($1,$2,$3)',
      [wrongRefund, row.id, wrong.invoice]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('rejects archived contexts and malformed policy thresholds', async () => {
  const row = await seed();
  await expect(
    intent(row, { policy: { enabled: true, thresholdIrR: '9999999999999999999' } })
  ).rejects.toMatchObject({ code: '23514' });
  await fixture.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile]);
  await expect(intent(row)).rejects.toMatchObject({ code: '23514' });
});
it('repeats the production migration without rewriting saved decisions', async () => {
  const row = await seed(),
    id = await intent(row);
  expect(await runMigrations({ connection: { pgdirectUrl: fixture.connectionString } })).toEqual({
    ok: true,
    applied: [],
  });
  expect(
    (await fixture.pool.query('SELECT id FROM contract_cancellation_intents WHERE id=$1', [id]))
      .rows
  ).toEqual([{ id }]);
});

it('rejects unbacked cancellation and incomplete obligations at commit', async () => {
  const row = await seed('100');
  await expect(
    fixture.pool.query("UPDATE contracts SET state='Cancelled' WHERE id=$1", [row.id])
  ).rejects.toMatchObject({ code: '23514' });
  const id = await intent(row);
  await expect(transaction((client) => cancel(row, id, client))).rejects.toMatchObject({
    code: '23514',
  });
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [row.id])).rows[0].state
  ).toBe('Draft');
  expect(
    (
      await fixture.pool.query('SELECT * FROM contract_cancellations WHERE contract_id=$1', [
        row.id,
      ])
    ).rows
  ).toEqual([]);
});
it('rejects a fabricated financial snapshot that omits real paid electricity funds', async () => {
  const row = await seed('100'),
    fake = { ...row, paid: '0' },
    id = await intent(fake);
  await expect(transaction((client) => cancel(row, id, client))).rejects.toMatchObject({
    code: '23514',
  });
});

it('enforces pending-payment reconciliation for direct cancellation writes', async () => {
  const row = await seed(),
    id = await intent(row),
    receipt = randomUUID();
  await fixture.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,state,total_amount) VALUES($1,$2,$3,'Unpaid',100)",
    [row.invoice, row.profile, row.id]
  );
  await fixture.pool.query(
    "INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key) VALUES($1,$2,$3,10,'2026-09-01','test',$4)",
    [receipt, row.invoice, row.profile, randomUUID()]
  );
  await expect(transaction((client) => cancel(row, id, client))).rejects.toThrow(
    'payment reconciliation'
  );
  await fixture.pool.query(
    "UPDATE bank_receipts SET state='Rejected',rejection_reason='Duplicate' WHERE id=$1",
    [receipt]
  );
  await transaction(async (client) => {
    await cancel(row, id, client);
    await client.query("UPDATE invoices SET state='Cancelled' WHERE id=$1", [row.invoice]);
  });
  await expect(
    fixture.pool.query('DELETE FROM invoices WHERE id=$1', [row.invoice])
  ).rejects.toMatchObject({ code: '23514' });
});
