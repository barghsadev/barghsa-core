import { cancelEmptyContract } from './test/cancel-empty-contract';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'saving-cancellation-notification-upgrade-'));
const name = `test_saving_notice_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 264),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
}, 40000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
  }
});
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
    const contract = randomUUID(),
      version = randomUUID();
    await c.query(
      "INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id) VALUES($1,$2,$3,'savings',$4)",
      [contract, profile, order, version]
    );
    await c.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$4::jsonb,'Initial',$3)",
      [version, contract, actor, { text: 'Retained saving terms' }]
    );
    await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [contract]);
    await c.query('COMMIT');
    return { actor, profile, order, id, hardware, contract, version };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function snapshot() {
  const tables = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  const values: Record<string, unknown> = {};
  for (const { tablename } of tables)
    values[tablename] = (
      await pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename.replaceAll('"', '""')}" t`
      )
    ).rows[0].rows;
  return values;
}
async function functions() {
  return (
    await pool.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.oid"
    )
  ).rows;
}
it('preserves every old saving, inventory, financial, delivery and public business row and every old function on upgrade/replay', async () => {
  await seed();
  const cancelled = await seed();
  await cancelEmptyContract(pool, cancelled.contract, cancelled.actor);
  const before = await snapshot(),
    oldFunctions = await functions();
  expect(await runMigrations({ connection })).toEqual({
    ok: true,
    applied: ['0264_saving_cancellation_notifications'],
  });
  expect(await snapshot()).toEqual(before);
  const current = await functions();
  for (const old of oldFunctions) expect(current.find((row) => row.oid === old.oid)).toEqual(old);
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await snapshot()).toEqual(before);
  const fresh = await seed();
  await cancelEmptyContract(pool, fresh.contract, fresh.actor);
  const notices = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1",
      [fresh.id]
    )
  ).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    user_id: fresh.actor,
    profile_id: fresh.profile,
    payload: {
      status: 'cancelled',
      orderNumber: fresh.id,
      contractId: fresh.contract,
      link_route: '/savings/orders/' + fresh.id,
    },
  });
  expect(
    (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1",
        [cancelled.id]
      )
    ).rows
  ).toEqual([]);
  const transferred = await seed(),
    currentOwner = randomUUID();
  const oldCreation = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='contract.created' AND profile_id=$1",
      [transferred.profile]
    )
  ).rows;
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    currentOwner,
  ]);
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [
    transferred.profile,
    currentOwner,
  ]);
  await cancelEmptyContract(pool, transferred.contract, transferred.actor);
  expect(
    (
      await pool.query(
        "SELECT user_id,idempotency_key FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1",
        [transferred.id]
      )
    ).rows
  ).toEqual([
    {
      user_id: currentOwner,
      idempotency_key: `order.status_changed:saving:${transferred.id}:contract_cancel:${transferred.version}:${currentOwner}`,
    },
  ]);
  expect(
    (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key='contract.created' AND profile_id=$1",
        [transferred.profile]
      )
    ).rows
  ).toEqual(oldCreation);
});
it('can transactionally remove and restore the new trigger/function while retaining exact history', async () => {
  const before = await snapshot(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER saving_cancellation_customer_notifications ON saving_orders; DROP FUNCTION notify_saving_cancellation_customer()'
    );
    expect(
      (
        await client.query(
          "SELECT * FROM pg_trigger WHERE tgname='saving_cancellation_customer_notifications'"
        )
      ).rows
    ).toEqual([]);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query(
        "SELECT * FROM pg_trigger WHERE tgname='saving_cancellation_customer_notifications'"
      )
    ).rows
  ).toHaveLength(1);
});
