import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { activateReadyContracts, readContractActivation } from './contract-activation';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
}, 30000);
async function seed(service = 'savings', accepted = true, start?: string, paid = false) {
  const actor = randomUUID(),
    profile = randomUUID(),
    id = randomUUID(),
    version = randomUUID(),
    invoice = randomUUID();
  const c = await fixture.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    await c.query(
      'INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,$3,$4)',
      [id, profile, service, version]
    );
    await c.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,'Initial',$4)",
      [version, id, JSON.stringify({ text: 'Terms' }), actor]
    );
    if (start)
      await c.query(
        'UPDATE contract_activation_requirements SET service_starts_at=$2 WHERE version_id=$1',
        [version, start]
      );
    if (paid) {
      await c.query(
        "INSERT INTO invoices(id,profile_id,contract_id,type,state,total_amount,paid_amount) VALUES($1,$2,$3,'manual','Paid',100,100)",
        [invoice, profile, id]
      );
      await c.query(
        'UPDATE contract_activation_requirements SET initial_invoice_id=$2 WHERE version_id=$1',
        [version, invoice]
      );
    }
    if (accepted) {
      await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [id]);
      await c.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [id, version, actor]
      );
      await c.query(
        'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
        [id, version, actor]
      );
    }
    await c.query('COMMIT');
    return { id, version, profile, actor, invoice };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function state(id: string) {
  return (await fixture.pool.query('SELECT state,activated_at FROM contracts WHERE id=$1', [id]))
    .rows[0];
}
const activate = (f: { id: string; version: string }) =>
  fixture.pool.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
    f.id,
    f.version,
  ]);
it('activates accepted unsigned savings exactly once with atomic system audit', async () => {
  const f = await seed();
  const c = await fixture.pool.connect();
  try {
    expect((await readContractActivation(c, f.id, undefined, true))?.ready).toBe(true);
  } finally {
    c.release();
  }
  const results = await Promise.all([
    activateReadyContracts(fixture.pool),
    activateReadyContracts(fixture.pool),
  ]);
  expect(results.reduce((n, r) => n + r.activated, 0)).toBe(1);
  const row = await state(f.id);
  expect(row.state).toBe('Active');
  expect(row.activated_at).toBeInstanceOf(Date);
  expect(
    (
      await fixture.pool.query(
        "SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='contract.activated' AND metadata::jsonb->>'contractId'=$1",
        [f.id]
      )
    ).rows
  ).toEqual([
    {
      user_id: f.actor,
      metadata: expect.objectContaining({
        contractId: f.id,
        versionId: f.version,
        actorType: 'system',
      }),
    },
  ]);
  expect(await activateReadyContracts(fixture.pool)).toEqual({ activated: 0, skipped: 0 });
  for (const sql of [
    'DELETE FROM contract_activations WHERE contract_id=$1',
    'UPDATE contract_activations SET activated_at=NOW() WHERE contract_id=$1',
    'UPDATE contracts SET activated_at=NOW() WHERE id=$1',
    "UPDATE contracts SET state='Accepted' WHERE id=$1",
  ]) {
    await expect(fixture.pool.query(sql, [f.id])).rejects.toMatchObject({ code: '23514' });
  }
});
it('rejects payment-only activation, missing signature, missing invoice and archived profiles', async () => {
  for (const [service, accepted] of [
    ['savings', false],
    ['solar', true],
    ['electricity', true],
  ] as const) {
    const f = await seed(service, accepted);
    await expect(activate(f)).rejects.toMatchObject({ code: '23514' });
    await expect(
      fixture.pool.query("UPDATE contracts SET state='Active',activated_at=NOW() WHERE id=$1", [
        f.id,
      ])
    ).rejects.toMatchObject({ code: '23514' });
  }
  const f = await seed();
  await fixture.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  await expect(activate(f)).rejects.toMatchObject({ code: '23514' });
  expect((await state(f.id)).state).toBe('Accepted');
});
it('uses the same date requirements for reads and system activation', async () => {
  await fixture.pool.query(
    "UPDATE contract_activation_rules SET service_start_required=true,revision=revision+1 WHERE service_type='savings'"
  );
  const future = await seed('savings', true, '2099-01-01T00:00:00Z'),
    missing = await seed(),
    past = await seed('savings', true, '2000-01-01T00:00:00Z');
  for (const f of [future, missing])
    await expect(activate(f)).rejects.toMatchObject({ code: '23514' });
  await activate(past);
  expect((await state(past.id)).state).toBe('Active');
  await fixture.pool.query(
    "UPDATE contract_activation_rules SET service_start_required=false,revision=revision+1 WHERE service_type='savings'"
  );
});
it('does not block on concurrent profile changes and retries after the lock is released', async () => {
  const f = await seed();
  const c = await fixture.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT 1 FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
    expect(await activateReadyContracts(fixture.pool)).toEqual({ activated: 0, skipped: 1 });
    expect((await state(f.id)).state).toBe('Accepted');
    await c.query('ROLLBACK');
    expect(await activateReadyContracts(fixture.pool)).toEqual({ activated: 1, skipped: 0 });
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('rolls activation back if audit persistence fails', async () => {
  const f = await seed();
  await fixture.pool.query(
    "CREATE FUNCTION fail_activation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contract.activated' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_activation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_activation_audit()"
  );
  try {
    await expect(activateReadyContracts(fixture.pool)).rejects.toThrow('audit unavailable');
    expect((await state(f.id)).state).toBe('Accepted');
    expect(
      (await fixture.pool.query('SELECT * FROM contract_activations WHERE contract_id=$1', [f.id]))
        .rows
    ).toHaveLength(0);
  } finally {
    await fixture.pool.query(
      'DROP TRIGGER test_fail_activation_audit ON audit_log; DROP FUNCTION fail_activation_audit()'
    );
  }
  expect((await activateReadyContracts(fixture.pool)).activated).toBe(1);
});
it('validates batch bounds', async () => {
  for (const limit of [0, 501, 1.5])
    await expect(activateReadyContracts(fixture.pool, limit)).rejects.toThrow(
      'Invalid activation batch size'
    );
});

it('locks linked payment evidence and rejects refunds before activation', async () => {
  const f = await seed('electricity', true, undefined, true),
    paymentOnly = await seed('electricity', false, undefined, true);
  await expect(activate(paymentOnly)).rejects.toMatchObject({ code: '23514' });
  const c = await fixture.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT 1 FROM invoices WHERE id=$1 FOR UPDATE', [f.invoice]);
    expect(await activateReadyContracts(fixture.pool)).toEqual({ activated: 0, skipped: 1 });
    await c.query("UPDATE invoices SET state='PartiallyRefunded',refunded_amount=1 WHERE id=$1", [
      f.invoice,
    ]);
    await c.query('COMMIT');
    await expect(activate(f)).rejects.toMatchObject({ code: '23514' });
    expect((await state(f.id)).state).toBe('Accepted');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  const paid = await seed('electricity', true, undefined, true);
  expect((await activateReadyContracts(fixture.pool)).activated).toBe(1);
  expect((await state(paid.id)).state).toBe('Active');
});
it('rejects other-contract and historical version identities', async () => {
  const f = await seed(),
    other = await seed();
  await expect(activate({ ...f, version: other.version })).rejects.toMatchObject({ code: '23514' });
  await activateReadyContracts(fixture.pool);
});

it('rechecks evidence after candidate selection and skips newly archived profiles', async () => {
  const f = await seed();
  let queried = false;
  const pool = {
    query: async (sql: string, args: unknown[]) => {
      const result = await fixture.pool.query(sql, args);
      if (!queried) {
        queried = true;
        await fixture.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
      }
      return result;
    },
  } as unknown as Pool;
  expect(await activateReadyContracts(pool)).toEqual({ activated: 0, skipped: 1 });
  expect((await state(f.id)).state).toBe('Accepted');
});
