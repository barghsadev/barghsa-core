import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'wallet-low-balance-signal-upgrade-'));
const scoped = mkdtempSync(join(tmpdir(), 'migration-269-scope-'));
const name = `test_wallet_low_balance_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 269),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  // Keep this historical upgrade/replay proof bound to its original target.
  const own = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 269),
  };
  mkdirSync(join(scoped, 'meta'));
  writeFileSync(join(scoped, 'meta/_journal.json'), JSON.stringify(own));
  for (const entry of own.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(scoped, entry.tag + '.sql'));
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
    rmSync(scoped, { recursive: true, force: true });
  }
});
async function snapshot() {
  const tables = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  const rows: Record<string, unknown> = {};
  for (const { tablename } of tables)
    rows[tablename] = (
      await pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename.replaceAll('"', '""')}" t`
      )
    ).rows[0].rows;
  return rows;
}
async function functions() {
  return (
    await pool.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.oid"
    )
  ).rows;
}

async function seed(balance: number, amount: number, archived = false, state = 'Unpaid') {
  const user = randomUUID(),
    profile = randomUUID(),
    invoice = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await pool.query('INSERT INTO profiles(id,user_id,archived) VALUES($1,$2,$3)', [
    profile,
    user,
    archived,
  ]);
  await pool.query('INSERT INTO wallets(profile_id,posted_balance) VALUES($1,$2)', [
    profile,
    balance,
  ]);
  await pool.query(
    'INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,$3,$4,0)',
    [invoice, profile, state, amount]
  );
  return { user, profile, invoice };
}
it('expands only new signal/episode tables and preserves every old row/function while initializing current deficits once', async () => {
  const low = await seed(40, 100),
    funded = await seed(100, 100),
    archived = await seed(0, 100, true),
    draft = await seed(0, 100, false, 'Draft');
  const before = await snapshot(),
    defs = await functions();
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: ['0269_wallet_low_balance_signals'],
  });
  const after = await snapshot();
  for (const [table, rows] of Object.entries(before)) expect(after[table]).toEqual(rows);
  expect((await pool.query('SELECT profile_id,source FROM wallet_alert_signals')).rows).toEqual([
    { profile_id: low.profile, source: 'profile' },
  ]);
  expect((await pool.query('SELECT * FROM wallet_low_balance_states')).rows).toEqual([]);
  const current = await functions();
  for (const definition of defs)
    expect(current.find((r) => r.oid === definition.oid)).toEqual(definition);
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: [],
  });
  expect(await snapshot()).toEqual(after);
  for (const profile of [funded.profile, archived.profile, draft.profile])
    expect(
      (await pool.query('SELECT * FROM wallet_alert_signals WHERE profile_id=$1', [profile])).rows
    ).toEqual([]);
});
it('records only relevant balance/invoice/owner changes and preserves old financial values in the same transaction', async () => {
  const f = await seed(100, 100);
  await pool.query('DELETE FROM wallet_alert_signals WHERE profile_id=$1', [f.profile]);
  await pool.query('UPDATE wallets SET version=version+1 WHERE profile_id=$1', [f.profile]);
  await pool.query('UPDATE invoices SET state=state,total_amount=total_amount WHERE id=$1', [
    f.invoice,
  ]);
  await pool.query('UPDATE profiles SET archived=archived WHERE id=$1', [f.profile]);
  expect(
    (await pool.query('SELECT * FROM wallet_alert_signals WHERE profile_id=$1', [f.profile])).rows
  ).toEqual([]);
  await pool.query('UPDATE wallets SET reserved_balance=1 WHERE profile_id=$1', [f.profile]);
  await pool.query('UPDATE invoices SET total_amount=120 WHERE id=$1', [f.invoice]);
  await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect(
    (
      await pool.query(
        'SELECT source FROM wallet_alert_signals WHERE profile_id=$1 ORDER BY created_at,id',
        [f.profile]
      )
    ).rows
  ).toEqual([{ source: 'wallet' }, { source: 'invoice' }, { source: 'profile' }]);
  expect(
    (
      await pool.query('SELECT posted_balance,reserved_balance FROM wallets WHERE profile_id=$1', [
        f.profile,
      ])
    ).rows
  ).toEqual([{ posted_balance: '100', reserved_balance: '1' }]);
  expect(
    (await pool.query('SELECT total_amount FROM invoices WHERE id=$1', [f.invoice])).rows
  ).toEqual([{ total_amount: '120' }]);
});
it('retains original rows on transactional removal/restoration of the new capture triggers', async () => {
  const before = await snapshot(),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'DROP TRIGGER wallet_low_balance_change ON wallets;DROP TRIGGER invoice_wallet_low_balance_change ON invoices;DROP TRIGGER profile_wallet_low_balance_change ON profiles;DROP FUNCTION signal_wallet_low_balance_change()'
    );
    expect(
      (
        await c.query(
          "SELECT 1 FROM pg_trigger WHERE tgname IN ('wallet_low_balance_change','invoice_wallet_low_balance_change','profile_wallet_low_balance_change')"
        )
      ).rows
    ).toEqual([]);
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM pg_trigger WHERE tgname IN ('wallet_low_balance_change','invoice_wallet_low_balance_change','profile_wallet_low_balance_change')"
      )
    ).rows
  ).toHaveLength(3);
});
