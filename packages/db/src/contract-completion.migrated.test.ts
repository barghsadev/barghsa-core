import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { completeDueContracts } from './contract-completion';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
}, 30000);
async function seed(end: string | null = '2000-02-01T00:00:00Z', active = true) {
  const user = randomUUID(),
    profile = randomUUID(),
    id = randomUUID(),
    version = randomUUID();
  const c = await fixture.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [user]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
    await c.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'savings',$3)",
      [id, profile, version]
    );
    await c.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,'Initial',$4)",
      [version, id, JSON.stringify({ text: 'Terms' }), user]
    );
    await c.query(
      "UPDATE contract_activation_requirements SET service_starts_at='2000-01-01T00:00:00Z',service_ends_at=$2 WHERE version_id=$1",
      [version, end]
    );
    await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [id]);
    await c.query(
      'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
      [id, version, user]
    );
    await c.query(
      'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
      [id, version, user]
    );
    if (active)
      await c.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
        id,
        version,
      ]);
    await c.query('COMMIT');
    return { id, version, user, profile };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
const complete = (f: { id: string; version: string }) =>
  fixture.pool.query('INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2)', [
    f.id,
    f.version,
  ]);
it('completes a due active version exactly once with an atomic system audit and immutable evidence', async () => {
  const f = await seed();
  const outcomes = await Promise.all([
    completeDueContracts(fixture.pool),
    completeDueContracts(fixture.pool),
  ]);
  expect(outcomes.reduce((n, r) => n + r.completed, 0)).toBe(1);
  expect(await completeDueContracts(fixture.pool)).toEqual({ completed: 0, skipped: 0 });
  expect(
    (await fixture.pool.query('SELECT state,completed_at FROM contracts WHERE id=$1', [f.id]))
      .rows[0]
  ).toEqual({ state: 'Completed', completed_at: expect.any(Date) });
  expect(
    (
      await fixture.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='contract.completed' AND metadata::jsonb->>'contractId'=$1",
        [f.id]
      )
    ).rows
  ).toEqual([
    {
      metadata: expect.objectContaining({
        versionId: f.version,
        actorType: 'system',
        financialClosure: false,
      }),
    },
  ]);
  for (const sql of [
    "UPDATE contracts SET state='Active' WHERE id=$1",
    'UPDATE contracts SET completed_at=NOW() WHERE id=$1',
    'DELETE FROM contract_completions WHERE contract_id=$1',
    'UPDATE contract_completions SET completed_at=NOW() WHERE contract_id=$1',
  ])
    await expect(fixture.pool.query(sql, [f.id])).rejects.toMatchObject({ code: '23514' });
});
it('rejects early, missing-date, nonactive and mismatched-version completion', async () => {
  for (const f of [
    await seed('2099-01-01T00:00:00Z'),
    await seed(null),
    await seed(undefined, false),
  ]) {
    await expect(complete(f)).rejects.toMatchObject({ code: '23514' });
    await expect(
      fixture.pool.query("UPDATE contracts SET state='Completed',completed_at=NOW() WHERE id=$1", [
        f.id,
      ])
    ).rejects.toMatchObject({ code: '23514' });
  }
  const a = await seed(),
    b = await seed();
  await expect(complete({ ...a, version: b.version })).rejects.toMatchObject({ code: '23514' });
  await completeDueContracts(fixture.pool);
});
it('retains independent outstanding refund and invoice records after the service term ends', async () => {
  const f = await seed(),
    invoice = randomUUID(),
    refund = randomUUID();
  await fixture.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,type,state,total_amount,paid_amount) VALUES($1,$2,$3,'manual','Paid',100,100)",
    [invoice, f.profile, f.id]
  );
  await fixture.pool.query(
    "INSERT INTO refunds(id,invoice_id,profile_id,amount,state,destination,idempotency_key) VALUES($1::uuid,$2,$3,50,'Requested','wallet',$1::text)",
    [refund, invoice, f.profile]
  );
  const before = (await fixture.pool.query('SELECT * FROM invoices WHERE id=$1', [invoice])).rows;
  await complete(f);
  expect((await fixture.pool.query('SELECT * FROM invoices WHERE id=$1', [invoice])).rows).toEqual(
    before
  );
  expect(
    (await fixture.pool.query('SELECT state FROM refunds WHERE id=$1', [refund])).rows[0].state
  ).toBe('Requested');
});
it('retries locked contracts and rechecks cancellation after candidate selection', async () => {
  const f = await seed(),
    c = await fixture.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT 1 FROM contracts WHERE id=$1 FOR UPDATE', [f.id]);
    expect(await completeDueContracts(fixture.pool)).toEqual({ completed: 0, skipped: 1 });
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  let selected = false;
  const pool = {
    query: async (sql: string, args: unknown[]) => {
      const result = await fixture.pool.query(sql, args);
      if (!selected) {
        selected = true;
        await fixture.pool.query("UPDATE contracts SET state='Cancelled' WHERE id=$1", [f.id]);
      }
      return result;
    },
  } as unknown as Pool;
  expect(await completeDueContracts(pool)).toEqual({ completed: 0, skipped: 1 });
});
it('rolls back completion when the audit write fails and resumes on retry', async () => {
  const f = await seed();
  await fixture.pool.query(
    "CREATE FUNCTION fail_term_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contract.completed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_term_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_term_audit()"
  );
  try {
    await expect(completeDueContracts(fixture.pool)).rejects.toThrow('audit unavailable');
    expect(
      (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [f.id])).rows[0].state
    ).toBe('Active');
    expect(
      (await fixture.pool.query('SELECT * FROM contract_completions WHERE contract_id=$1', [f.id]))
        .rows
    ).toHaveLength(0);
  } finally {
    await fixture.pool.query(
      'DROP TRIGGER fail_term_audit ON audit_log; DROP FUNCTION fail_term_audit()'
    );
  }
  expect((await completeDueContracts(fixture.pool)).completed).toBe(1);
});
it('does not change dates after publication and validates batch bounds', async () => {
  const f = await seed();
  await expect(
    fixture.pool.query(
      'UPDATE contract_activation_requirements SET service_ends_at=NULL WHERE version_id=$1',
      [f.version]
    )
  ).rejects.toMatchObject({ code: '23514' });
  for (const limit of [0, 501, 1.5])
    await expect(completeDueContracts(fixture.pool, limit)).rejects.toThrow(
      'Invalid completion batch size'
    );
  await completeDueContracts(fixture.pool);
});

it('rejects invalid stored service intervals', async () => {
  await expect(seed('1999-01-01T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
});
