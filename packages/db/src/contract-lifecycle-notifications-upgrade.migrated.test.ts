import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'contract-lifecycle-notification-upgrade-'));
const name = `test_lifecycle_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 263),
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
async function create() {
  const actor = randomUUID(),
    profile = randomUUID(),
    id = randomUUID(),
    version = randomUUID(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')",
      [actor]
    );
    await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'savings',$3)",
      [id, profile, version]
    );
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,'Initial',$4)",
      [version, id, JSON.stringify({ text: 'Saved private terms' }), actor]
    );
    await client.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [id]);
    await client.query(
      'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
      [id, version, actor]
    );
    await client.query(
      'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
      [id, version, actor]
    );
    await client.query('COMMIT');
    return { id, version, profile, actor };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function snapshot() {
  const rows: Record<string, unknown> = {};
  for (const table of [
    'contracts',
    'contract_versions',
    'contract_publications',
    'contract_acceptances',
    'contract_activation_requirements',
    'contract_activations',
    'audit_log',
    'notification_outbox',
    'in_app_notifications',
    'notification_job',
    'notification_delivery_log',
  ])
    rows[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  return rows;
}
async function functions() {
  return (
    await pool.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.oid"
    )
  ).rows;
}
it('preserves every old contract, activation, audit and delivery row and every existing function on upgrade and migration replay', async () => {
  const old = await create();
  await pool.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
    old.id,
    old.version,
  ]);
  const saved = await snapshot(),
    definitions = await functions();
  expect(await runMigrations({ connection })).toEqual({
    ok: true,
    applied: ['0263_contract_lifecycle_notifications'],
  });
  expect(await snapshot()).toEqual(saved);
  const current = await functions();
  for (const definition of definitions)
    expect(current.find((row) => row.oid === definition.oid)).toEqual(definition);
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await snapshot()).toEqual(saved);
  const fresh = await create();
  expect(
    (
      await pool.query('SELECT event_key FROM notification_outbox WHERE profile_id=$1', [
        fresh.profile,
      ])
    ).rows
  ).toEqual([{ event_key: 'contract.created' }]);
  await pool.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
    fresh.id,
    fresh.version,
  ]);
  expect(
    (
      await pool.query(
        'SELECT event_key FROM notification_outbox WHERE profile_id=$1 ORDER BY id',
        [fresh.profile]
      )
    ).rows
  ).toEqual([{ event_key: 'contract.created' }, { event_key: 'contract.active' }]);
});
it('can transactionally restore the earlier notification boundary without changing retained history', async () => {
  const before = await snapshot(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER contract_lifecycle_customer_notifications ON contracts; DROP FUNCTION notify_contract_lifecycle_customer()'
    );
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='contract_lifecycle_customer_notifications'"
        )
      ).rows[0].count
    ).toBe(0);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='contract_lifecycle_customer_notifications'"
      )
    ).rows[0].count
  ).toBe(1);
});
