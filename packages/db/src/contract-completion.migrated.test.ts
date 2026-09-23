import { cancelEmptyContract } from './test/cancel-empty-contract';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { completeDueContracts } from './contract-completion';
import { runMigrations } from './migrate';
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

async function seedElectricity(pool: Pool = fixture.pool) {
  const user = randomUUID(),
    profile = randomUUID(),
    order = randomUUID(),
    contract = randomUUID(),
    version = randomUUID(),
    invoice = randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [user]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
    const product = (
      await c.query(
        `INSERT INTO products(type,system_key,title,status,price)
         VALUES('electricity','thermal','{"en":"Thermal"}','active',100)
         ON CONFLICT (system_key) DO UPDATE SET price=100 RETURNING id`
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,
       snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
       VALUES($1,$2,$3,$4,'electricity','CONFIRMED','province','city','Address','1234567890')`,
      [order, user, profile, product]
    );
    await c.query(
      `INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot,period_start,
       period_end,submitted_at,pricing_snapshot,total_kwh,average_power_kw,green_rule_applied,submitted_by)
       VALUES($1,$2,'approved','{}','2000-01-01T00:00:00Z','2000-02-01T00:00:00Z',
       '2000-01-01T00:00:00Z','{}',10,1,false,$3)`,
      [order, profile, user]
    );
    await c.query(
      `INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id)
       VALUES($1,$2,$3,'electricity',$4)`,
      [contract, profile, order, version]
    );
    await c.query(
      `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by)
       VALUES($1,$2,1,$3::jsonb,'Initial',$4)`,
      [version, contract, JSON.stringify({ text: 'Terms' }), user]
    );
    await c.query(
      `INSERT INTO invoices(id,profile_id,contract_id,order_id,type,state,total_amount,paid_amount)
       VALUES($1,$2,$3,$4,'auto','Paid',100,100)`,
      [invoice, profile, contract, order]
    );
    await c.query(
      `UPDATE contract_activation_requirements SET initial_invoice_id=$2,
       service_starts_at='2000-01-01T00:00:00Z',service_ends_at='2000-02-01T00:00:00Z'
       WHERE version_id=$1`,
      [version, invoice]
    );
    await c.query('INSERT INTO electricity_contracts(order_id,contract_id) VALUES($1,$2)', [
      order,
      contract,
    ]);
    await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [contract]);
    await c.query(
      'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
      [contract, version, user]
    );
    await c.query(
      'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
      [contract, version, user]
    );
    await c.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
      contract,
      version,
    ]);
    await c.query('COMMIT');
    return { order, contract, version, invoice };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
const complete = (f: { id: string; version: string }) =>
  fixture.pool.query('INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2)', [
    f.id,
    f.version,
  ]);

it('completes the linked electricity order and contract with the service term', async () => {
  const f = await seedElectricity();
  expect(
    (await fixture.pool.query('SELECT status FROM electricity_orders WHERE id=$1', [f.order]))
      .rows[0].status
  ).toBe('active');
  await complete({ id: f.contract, version: f.version });
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract])).rows[0]
  ).toEqual({ state: 'Completed' });
  expect(
    (await fixture.pool.query('SELECT status FROM electricity_orders WHERE id=$1', [f.order]))
      .rows[0]
  ).toEqual({ status: 'completed' });
  expect(
    (
      await fixture.pool.query('SELECT status FROM electricity_contracts WHERE contract_id=$1', [
        f.contract,
      ])
    ).rows[0]
  ).toEqual({ status: 'completed' });
  expect(
    (await fixture.pool.query('SELECT state,paid_amount FROM invoices WHERE id=$1', [f.invoice]))
      .rows[0]
  ).toEqual({ state: 'Paid', paid_amount: '100' });
  expect(await completeDueContracts(fixture.pool)).toEqual({ completed: 0, skipped: 0 });
});

it('rolls back electricity completion if its linked status is inconsistent', async () => {
  const f = await seedElectricity();
  await fixture.pool.query(
    "UPDATE electricity_contracts SET status='cancelled' WHERE contract_id=$1",
    [f.contract]
  );
  await expect(complete({ id: f.contract, version: f.version })).rejects.toMatchObject({
    code: '23514',
    constraint: 'electricity_completion_prerequisites',
  });
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract])).rows[0]
  ).toEqual({ state: 'Active' });
  expect(
    (await fixture.pool.query('SELECT status FROM electricity_orders WHERE id=$1', [f.order]))
      .rows[0]
  ).toEqual({ status: 'active' });
  expect(
    (
      await fixture.pool.query('SELECT * FROM contract_completions WHERE contract_id=$1', [
        f.contract,
      ])
    ).rows
  ).toHaveLength(0);
  await fixture.pool.query(
    "UPDATE electricity_contracts SET status='active' WHERE contract_id=$1",
    [f.contract]
  );
  await complete({ id: f.contract, version: f.version });
});

it('refuses completion when the electricity order has lost its contract link', async () => {
  const f = await seedElectricity();
  await fixture.pool.query('DELETE FROM electricity_contracts WHERE contract_id=$1', [f.contract]);
  await expect(complete({ id: f.contract, version: f.version })).rejects.toMatchObject({
    code: '23514',
    constraint: 'electricity_completion_prerequisites',
  });
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract])).rows[0]
  ).toEqual({ state: 'Active' });
  expect(
    (await fixture.pool.query('SELECT status FROM electricity_orders WHERE id=$1', [f.order]))
      .rows[0]
  ).toEqual({ status: 'active' });
  await fixture.pool.query(
    "INSERT INTO electricity_contracts(order_id,contract_id,status) VALUES($1,$2,'active')",
    [f.order, f.contract]
  );
  await complete({ id: f.contract, version: f.version });
});

it('reconciles electricity orders completed before the status-sync migration', async () => {
  const production = resolve('drizzle/production');
  const previous = mkdtempSync(join(tmpdir(), 'electricity-completion-upgrade-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 171),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_electricity_completion_upgrade_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  let created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    const f = await seedElectricity(pool);
    await pool.query('INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2)', [
      f.contract,
      f.version,
    ]);
    expect(
      (await pool.query('SELECT status FROM electricity_orders WHERE id=$1', [f.order])).rows[0]
    ).toEqual({ status: 'active' });
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0171_electricity_term_completion'],
    });
    expect(
      (await pool.query('SELECT status FROM electricity_orders WHERE id=$1', [f.order])).rows[0]
    ).toEqual({ status: 'completed' });
    expect(
      (
        await pool.query('SELECT status FROM electricity_contracts WHERE contract_id=$1', [
          f.contract,
        ])
      ).rows[0]
    ).toEqual({ status: 'completed' });
    expect(
      (
        await pool.query(
          `SELECT metadata FROM audit_log
           WHERE event='electricity.order_completion_reconciled'
            AND metadata::jsonb->>'orderId'=$1`,
          [f.order]
        )
      ).rows
    ).toHaveLength(1);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 30000);
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
        await cancelEmptyContract(fixture.pool, f.id, f.user);
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
