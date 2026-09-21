import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { cancelEmptyContract } from './test/cancel-empty-contract';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contractCancellationRequests } from './schema/contract-cancellation-requests';
import {
  contractCancellationIntents,
  contractCancellations,
  contractRefundObligations,
} from './schema/contract-cancellation';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const actor = randomUUID();
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,$1)', [
    actor,
  ]);
}, 60_000);
afterAll(async () => fixture?.close());
it('keeps typed request and refund relationships aligned with the migrated constraints', async () => {
  for (const table of [
    contractCancellationRequests,
    contractCancellationIntents,
    contractCancellations,
    contractRefundObligations,
  ]) {
    const config = getTableConfig(table);
    const constraints = (
      await fixture.pool.query<{ conname: string }>(
        'SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass',
        [config.name]
      )
    ).rows.map((row) => row.conname);
    for (const fk of config.foreignKeys) {
      expect(fk.reference().columns.length).toBe(fk.reference().foreignColumns.length);
      expect(constraints).toContain(fk.getName().slice(0, 63));
    }
    for (const check of config.checks) expect(constraints).toContain(check.name.slice(0, 63));
    const indexes = (
      await fixture.pool.query<{ indexname: string }>(
        'SELECT indexname FROM pg_indexes WHERE tablename=$1',
        [config.name]
      )
    ).rows.map((row) => row.indexname);
    for (const index of config.indexes) expect(indexes).toContain(index.config.name);
  }
});
async function tx(work: (client: PoolClient) => Promise<void>) {
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
async function seed(published = true) {
  const r = { id: randomUUID(), version: randomUUID(), profile: randomUUID() };
  await tx(async (c) => {
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [r.profile, actor]);
    await c.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'electricity',$3)",
      [r.id, r.profile, r.version]
    );
    await c.query(
      `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,'{"text":"Terms"}','Initial',$3)`,
      [r.version, r.id, actor]
    );
    if (published) {
      await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [r.id]);
      await c.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [r.id, r.version, actor]
      );
    }
  });
  return r;
}
type Contract = Awaited<ReturnType<typeof seed>>;
async function request(r: Contract) {
  const id = randomUUID();
  await fixture.pool.query(
    "INSERT INTO contract_cancellation_requests(id,contract_id,version_id,requested_by,reason,preferred_destination,created_at) VALUES($1,$2,$3,$4,'End service','external_bank','2000-01-01')",
    [id, r.id, r.version, actor]
  );
  return id;
}
async function prepare(r: Contract, requestId: string) {
  const id = randomUUID();
  await fixture.pool.query(
    `INSERT INTO contract_cancellation_intents(id,contract_id,version_id,actor_id,reason,customer_request_id,refund_decision,financial_snapshot,financial_fingerprint,financial_impact_amount,approval_policy,idempotency_key)
  VALUES($1,$2,$3,$4,'Approved cancellation',$5,'{"refunds":[]}',$6,$7,0,'{"enabled":false}',$8)`,
    [
      id,
      r.id,
      r.version,
      actor,
      requestId,
      {
        contractId: r.id,
        versionId: r.version,
        profileId: r.profile,
        state: 'AwaitingCustomerAcceptance',
        refundableAmount: '0',
        invoices: [],
      },
      'a'.repeat(64),
      randomUUID(),
    ]
  );
  return id;
}
async function execute(r: Contract, intent: string) {
  await tx(async (c) => {
    await c.query(
      "UPDATE contracts SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
      [r.id]
    );
    await c.query(
      'INSERT INTO contract_cancellations(contract_id,intent_id,executed_by) VALUES($1,$2,$3)',
      [r.id, intent, actor]
    );
  });
}
it('requires publication and retains immutable request evidence with one pending request', async () => {
  await expect(request(await seed(false))).rejects.toMatchObject({ code: '23514' });
  const r = await seed(),
    id = await request(r);
  const saved = (
    await fixture.pool.query('SELECT * FROM contract_cancellation_requests WHERE id=$1', [id])
  ).rows[0];
  expect(saved.created_at.getUTCFullYear()).toBeGreaterThan(2000);
  expect(saved.status).toBe('Pending');
  await expect(request(r)).rejects.toMatchObject({ code: '23505' });
  await expect(
    fixture.pool.query("UPDATE contract_cancellation_requests SET reason='Changed' WHERE id=$1", [
      id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM contract_cancellation_requests WHERE id=$1', [id])
  ).rejects.toMatchObject({ code: '23514' });
});
it('requires a rejection explanation and preserves the contract while allowing a later request', async () => {
  const r = await seed(),
    id = await request(r);
  await expect(
    fixture.pool.query(
      "UPDATE contract_cancellation_requests SET status='Rejected',resolved_by=$2 WHERE id=$1",
      [id, actor]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await fixture.pool.query(
    "UPDATE contract_cancellation_requests SET status='Rejected',resolved_by=$2,resolution_reason='Please contact support' WHERE id=$1",
    [id, actor]
  );
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [r.id])).rows[0].state
  ).toBe('AwaitingCustomerAcceptance');
  await expect(
    fixture.pool.query(
      "UPDATE contract_cancellation_requests SET status='Pending',resolved_by=NULL,resolution_reason=NULL,resolved_at=NULL WHERE id=$1",
      [id]
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(await request(r)).not.toBe(id);
});
it('fulfills only on the bound cancellation execution, in the same transaction', async () => {
  const r = await seed(),
    id = await request(r),
    intent = await prepare(r, id);
  await expect(
    fixture.pool.query(
      "UPDATE contract_cancellation_requests SET status='Fulfilled',resolved_by=$2,resolution_reason='Approved cancellation' WHERE id=$1",
      [id, actor]
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await fixture.pool.query('SELECT status FROM contract_cancellation_requests WHERE id=$1', [
        id,
      ])
    ).rows[0].status
  ).toBe('Pending');
  await execute(r, intent);
  expect(
    (
      await fixture.pool.query(
        'SELECT status,resolved_by,resolution_reason,resolved_at FROM contract_cancellation_requests WHERE id=$1',
        [id]
      )
    ).rows[0]
  ).toMatchObject({
    status: 'Fulfilled',
    resolved_by: actor,
    resolution_reason: 'Approved cancellation',
    resolved_at: expect.any(Date),
  });
});
it('invalidates a prepared decision when the customer request is rejected', async () => {
  const r = await seed(),
    id = await request(r),
    intent = await prepare(r, id);
  await fixture.pool.query(
    "UPDATE contract_cancellation_requests SET status='Rejected',resolved_by=$2,resolution_reason='Declined with explanation' WHERE id=$1",
    [id, actor]
  );
  await expect(execute(r, intent)).rejects.toMatchObject({ code: '23514' });
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [r.id])).rows[0].state
  ).toBe('AwaitingCustomerAcceptance');
  await expect(prepare(r, id)).rejects.toMatchObject({ code: '23514' });
});
it('rejects cross-contract request binding and retains an independently ended request', async () => {
  const r = await seed(),
    other = await seed(),
    id = await request(r);
  await expect(prepare(other, id)).rejects.toMatchObject({ code: '23514' });
  await cancelEmptyContract(fixture.pool, r.id, actor);
  await expect(request(r)).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      "UPDATE contract_cancellation_requests SET status='Rejected',resolved_by=$2,resolution_reason='Too late' WHERE id=$1",
      [id, actor]
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await fixture.pool.query('SELECT status FROM contract_cancellation_requests WHERE id=$1', [
        id,
      ])
    ).rows[0].status
  ).toBe('Pending');
});
