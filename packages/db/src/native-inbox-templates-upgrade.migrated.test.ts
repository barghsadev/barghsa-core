import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'native-inbox-template-upgrade-'));
const scoped = mkdtempSync(join(tmpdir(), 'migration-270-scope-'));
const name = `test_native_inbox_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 270),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  // Keep this historical upgrade/replay proof bound to its original target.
  const own = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 270),
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

it('adds only fresh rendering functions/hook and preserves all existing rows,function OIDs and historical read receipts', async () => {
  const user = randomUUID(),
    profile = randomUUID(),
    outbox = randomUUID(),
    notice = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await pool.query(
    "INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key) VALUES($1,$2,$3,'wallet.credit_received','{\"amount\":\"40\"}',ARRAY['in_app'],'delivered',$4)",
    [outbox, profile, user, randomUUID()]
  );
  await pool.query(
    "INSERT INTO in_app_notifications(id,profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,delivery_key,is_read,read_at) VALUES($1,$2,$3,'customer','wallet.credit_received','notifications.legacy.title','notifications.legacy.body',$4,'outbox:'||$5::text,true,now())",
    [
      notice,
      profile,
      user,
      { fa: { title: 'قدیمی', body: 'قدیمی' }, en: { title: 'Old', body: 'Old' } },
      outbox,
    ]
  );
  await pool.query(
    "INSERT INTO notification_templates(event_key,channel,locale,body_template,variables,status,is_active) VALUES('wallet.credit_received','in_app','en','Missing {{unavailable}}','[\"unavailable\"]','active',true)"
  );
  const before = await snapshot(),
    defs = await functions();
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: ['0270_native_inbox_templates'],
  });
  expect(await snapshot()).toEqual(before);
  const current = await functions();
  for (const definition of defs)
    expect(current.find((r) => r.oid === definition.oid)).toEqual(definition);
  expect(current).toHaveLength(defs.length + 3);
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: [],
  });
  expect(await snapshot()).toEqual(before);
  await pool.query(
    "INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,delivery_key) VALUES($1,$2,'customer','wallet.credit_received','notifications.legacy.title','notifications.legacy.body','{}','outbox:'||$3::text) ON CONFLICT(delivery_key) DO NOTHING",
    [profile, user, outbox]
  );
  expect(await snapshot()).toEqual(before);
});
it('transactionally removes only the new hook/functions and restores them on rollback without touching history', async () => {
  const before = await snapshot(),
    defs = await functions(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER native_inbox_active_templates ON in_app_notifications;DROP FUNCTION apply_native_inbox_templates();DROP FUNCTION render_native_inbox_content(text,jsonb,jsonb);DROP FUNCTION render_native_inbox_text(text,jsonb,jsonb)'
    );
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%native_inbox%'"
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await functions()).toEqual(defs);
  expect(await snapshot()).toEqual(before);
});
