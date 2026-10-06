import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'saving-system-audit-upgrade-'));
const name = 'test_saving_system_audit_' + randomUUID().replaceAll('-', '');
let pool: Pool, management: Pool, connection: { pgdirectUrl: string };
let legacy: Awaited<ReturnType<typeof seed>>, history: Awaited<ReturnType<typeof snapshot>>;
let migration: Awaited<ReturnType<typeof runMigrations>>;
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 252),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const e of prior.entries)
    copyFileSync(join(production, e.tag + '.sql'), join(previous, e.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
  legacy = await seed();
  history = await snapshot(legacy);
  migration = await runMigrations({ connection });
}, 30000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
  }
}, 30000);
async function seed(tracked = true) {
  const actor = randomUUID(),
    profile = randomUUID(),
    order = randomUUID(),
    id = randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    const province = (
      await c.query("INSERT INTO provinces(name_fa,name_en) VALUES('استان',$1) RETURNING id", [
        actor,
      ])
    ).rows[0].id;
    const city = (
      await c.query(
        "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر',$2) RETURNING id",
        [province, actor]
      )
    ).rows[0].id;
    const address = (
      await c.query(
        "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES($1,$2,$3,'Address','1234567890',true) RETURNING id",
        [profile, province, city]
      )
    ).rows[0].id;
    const hardware = (
      await c.query(
        `INSERT INTO products(type,title,status,price,stock_tracking,stock_count,reservation_minutes) VALUES('hardware','{"en":"Device"}','active',200000,$1,2,5) RETURNING id`,
        [tracked]
      )
    ).rows[0].id;
    const plan = (
      await c.query(
        `INSERT INTO products(type,title,status,price) VALUES('saving_plan','{"en":"Plan"}','inactive',100000) RETURNING id`
      )
    ).rows[0].id;
    await c.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
      plan,
      hardware,
    ]);
    const agreement = (
      await c.query(
        "INSERT INTO saving_plan_agreement_versions(plan_id,title,body,created_by) VALUES($1,'Terms','Customer agrees',$2) RETURNING id",
        [plan, actor]
      )
    ).rows[0].id;
    await c.query(
      "UPDATE saving_plan_agreement_versions SET status='active',effective_from=NOW() WHERE id=$1",
      [agreement]
    );
    await c.query("UPDATE products SET status='active' WHERE id=$1", [plan]);
    await c.query(
      "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'savings','PENDING',$5,$6,'Address','1234567890')",
      [order, actor, profile, plan, province, city]
    );
    await c.query(
      `INSERT INTO saving_orders(id,order_id,profile_id,saving_plan_id,hardware_product_id,bill_identifier,installation_address_id,agreement_version_id,agreement_snapshot,address_snapshot,pricing_snapshot,verification_result) VALUES($1,$2,$3,$4,$5,'1234567890123',$6,$7,'Customer agrees','{}','{}','{}')`,
      [id, order, profile, plan, hardware, address, agreement]
    );
    await c.query('COMMIT');
    return { actor, profile, order, id, hardware };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function snapshot(f: Awaited<ReturnType<typeof seed>>, executor: Pool | PoolClient = pool) {
  return {
    order: (await executor.query('SELECT * FROM saving_orders WHERE id=$1', [f.id])).rows,
    reservation: (
      await executor.query('SELECT * FROM saving_inventory_reservations WHERE order_id=$1', [f.id])
    ).rows,
    hardware: (await executor.query('SELECT * FROM products WHERE id=$1', [f.hardware])).rows,
    audits: (
      await executor.query(
        'SELECT *,metadata::jsonb AS parsed FROM audit_log WHERE user_id=$1 ORDER BY created_at,id',
        [f.actor]
      )
    ).rows,
  };
}
const apply = (
  f: { id: string },
  kind: 'allocate' | 'release',
  executor: Pool | PoolClient = pool
) => executor.query(`SELECT ${kind}_saving_inventory($1)`, [f.id]);
function check(
  row: Awaited<ReturnType<typeof snapshot>>['audits'][number],
  f: Awaited<ReturnType<typeof seed>>,
  from: string | null,
  to: string
) {
  expect(row).toMatchObject({
    user_id: f.actor,
    operating_context: null,
    event: 'saving.inventory.' + to,
  });
  expect(row.created_at).toBeInstanceOf(Date);
  expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.parsed).toMatchObject({
    entity: 'saving_inventory_reservation',
    entityId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    savingOrderId: f.id,
    profileId: f.profile,
    affectedUserId: f.actor,
    fromState: from,
    toState: to,
    reason: null,
    actor: 'system',
    actorType: 'system',
    kind: 'reservation_change',
    hardwareProductId: f.hardware,
  });
  expect(row.parsed.entityId).toBe(row.parsed.reservationId);
}
it('upgrades251 without rewriting historical rows or stock and replays safely', async () => {
  expect(migration).toEqual({ ok: true, applied: ['0252_saving_inventory_upgrade_audit'] });
  expect(await snapshot(legacy)).toEqual(history);
  expect(history.audits).toHaveLength(1);
  expect(history.audits[0].parsed).not.toHaveProperty('entity');
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await snapshot(legacy)).toEqual(history);
});
it('reserves, allocates and releases once with exact states and unchanged stock semantics', async () => {
  const f = await seed();
  let s = await snapshot(f);
  expect(s.audits).toHaveLength(1);
  check(s.audits[0], f, null, 'reserved');
  expect(s.hardware[0]).toMatchObject({ stock_count: 2, reserved_count: 1 });
  await apply(f, 'allocate');
  s = await snapshot(f);
  expect(s.audits).toHaveLength(2);
  check(s.audits[1], f, 'reserved', 'allocated');
  expect(s.hardware[0]).toMatchObject({ stock_count: 1, reserved_count: 0 });
  await apply(f, 'allocate');
  expect(await snapshot(f)).toEqual(s);
  await apply(f, 'release');
  s = await snapshot(f);
  expect(s.audits).toHaveLength(3);
  check(s.audits[2], f, 'allocated', 'released');
  expect(s.hardware[0]).toMatchObject({ stock_count: 2, reserved_count: 0 });
  await apply(f, 'release');
  expect(await snapshot(f)).toEqual(s);
});
it('records expiry before fallback allocation in the same transaction without false reserved-to-allocated history', async () => {
  const f = await seed();
  await pool.query(
    "UPDATE saving_inventory_reservations SET expires_at=NOW()-INTERVAL '1 minute' WHERE order_id=$1",
    [f.id]
  );
  expect((await snapshot(f)).audits).toHaveLength(1);
  await apply(f, 'allocate');
  const s = await snapshot(f);
  expect(s.audits).toHaveLength(3);
  check(s.audits[1], f, 'reserved', 'expired');
  check(s.audits[2], f, 'expired', 'allocated');
  expect(s.audits[1].parsed.transactionId).toBe(s.audits[2].parsed.transactionId);
  expect(s.hardware[0]).toMatchObject({ stock_count: 1, reserved_count: 0 });
});
it.each(['allocated', 'released', 'expired'] as const)(
  'rolls back stock, reservation and audits when %s audit fails then retries',
  async (kind) => {
    const f = await seed();
    if (kind === 'released') await apply(f, 'allocate');
    if (kind === 'expired')
      await pool.query(
        "UPDATE saving_inventory_reservations SET expires_at=NOW()-INTERVAL '1 minute' WHERE order_id=$1",
        [f.id]
      );
    const before = await snapshot(f);
    const run = () =>
      kind === 'expired'
        ? pool.query('SELECT expire_saving_inventory_reservations(100)')
        : apply(f, kind === 'released' ? 'release' : 'allocate');
    await pool.query(
      `CREATE FUNCTION test_reject_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='saving.inventory.${kind}' THEN RAISE EXCEPTION 'inventory audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_reject_inventory_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_reject_inventory_audit()`
    );
    try {
      await expect(run()).rejects.toThrow('inventory audit unavailable');
      expect(await snapshot(f)).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER test_reject_inventory_audit ON audit_log;DROP FUNCTION test_reject_inventory_audit()'
      );
    }
    await run();
    const after = await snapshot(f);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    check(after.audits.at(-1)!, f, kind === 'released' ? 'allocated' : 'reserved', kind);
  }
);
it('retains legacy observations and rejects unrelated reservation ids without an audit', async () => {
  const f = await seed(),
    other = await seed();
  const before = await snapshot(f);
  await expect(
    pool.query("SELECT audit_saving_inventory($1,$2,'swapped')", [
      f.id,
      (await snapshot(other)).reservation[0].id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  expect(await snapshot(f)).toEqual(before);
  await pool.query("SELECT audit_saving_inventory($1,$2,'swapped')", [
    f.id,
    before.reservation[0].id,
  ]);
  const after = await snapshot(f);
  expect(after.reservation).toEqual(before.reservation);
  expect(after.hardware).toEqual(before.hardware);
  expect(after.audits.at(-1)!.parsed).toMatchObject({
    entity: 'saving_inventory_reservation',
    entityId: before.reservation[0].id,
    fromState: 'reserved',
    toState: 'reserved',
    action: 'swapped',
    kind: 'inventory_action',
    actor: 'system',
  });
});
it('attributes an untracked stock observation to the actual order instead of a nonexistent reservation', async () => {
  const f = await seed(false),
    before = await snapshot(f);
  expect(before.reservation).toHaveLength(0);
  expect(before.audits).toHaveLength(0);
  await pool.query("SELECT audit_saving_inventory($1,NULL,'swapped')", [f.id]);
  const after = await snapshot(f);
  expect(after.reservation).toHaveLength(0);
  expect(after.hardware).toEqual(before.hardware);
  expect(after.audits).toHaveLength(1);
  expect(after.audits[0].parsed).toMatchObject({
    entity: 'saving_order',
    entityId: f.id,
    reservationId: null,
    fromState: 'submitted',
    toState: 'submitted',
    action: 'swapped',
    kind: 'inventory_action',
    actor: 'system',
    profileId: f.profile,
    affectedUserId: f.actor,
  });
});
it('restores prior functions transactionally while retaining immutable history and forward compatibility', async () => {
  const f = await seed(),
    before = await snapshot(f),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'DROP TRIGGER saving_inventory_reservation_audit ON saving_inventory_reservations;DROP FUNCTION audit_saving_inventory_row_change()'
    );
    for (const [file, func] of [
      ['0164_saving_inventory.sql', 'audit_saving_inventory'],
      ['0178_saving_hardware_upgrades.sql', 'settle_saving_hardware_upgrade'],
    ]) {
      const sql = readFileSync(join(production, file!), 'utf8');
      const start = sql.indexOf('FUNCTION ' + func + '('),
        first = sql.lastIndexOf('CREATE', start),
        end = sql.indexOf('END $$;', start) + 'END $$;'.length;
      await c.query(
        sql
          .slice(first, end)
          .replace(/^CREATE(?: OR REPLACE)? FUNCTION/, 'CREATE OR REPLACE FUNCTION')
      );
    }
    await apply(f, 'allocate', c);
    const rolled = await snapshot(f, c);
    expect(rolled.hardware[0]).toMatchObject({ stock_count: 1, reserved_count: 0 });
    expect(rolled.audits).toHaveLength(2);
    expect(rolled.audits[1].parsed).not.toHaveProperty('entity');
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  expect(await snapshot(f)).toEqual(before);
  await apply(f, 'allocate');
  check((await snapshot(f)).audits.at(-1)!, f, 'reserved', 'allocated');
  expect(await snapshot(legacy)).toEqual(history);
});
