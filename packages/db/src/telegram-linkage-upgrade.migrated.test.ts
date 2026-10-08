import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'telegram-prior-'));
const name = 'test_telegram_upgrade_' + randomUUID().replaceAll('-', '');
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const entries = journal.entries.filter((e: { idx: number }) => e.idx <= 272);
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect(await runMigrations({ connection, migrationsFolder: previous })).toMatchObject({
    ok: true,
  });
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
async function rows(tables: string[]) {
  const result: Record<string, unknown> = {};
  for (const table of tables)
    result[table] = (
      await pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${table.replaceAll('"', '""')}" t`
      )
    ).rows[0].rows;
  return result;
}
async function functions() {
  return (
    await pool.query(`SELECT p.oid::regprocedure::text AS name,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
    ORDER BY p.oid::regprocedure::text`)
  ).rows;
}
it('expands a populated prior database without changing existing rows/functions and safely replays', async () => {
  const user = randomUUID(),
    profile = randomUUID(),
    session = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await pool.query('INSERT INTO profiles(id,user_id,is_default) VALUES($1,$2,true)', [
    profile,
    user,
  ]);
  await pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,operating_context,expires_at,idle_deadline)
    VALUES($1,$2,'fixture-csrf','customer',NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, user]
  );
  const tables = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows.map((r) => r.tablename);
  const beforeRows = await rows(tables),
    beforeFunctions = await functions();
  expect(await runMigrations({ connection })).toEqual({
    ok: true,
    applied: ['0273_telegram_profile_linkage'],
  });
  expect(await rows(tables)).toEqual(beforeRows);
  const afterFunctions = await functions();
  expect(afterFunctions.filter((f) => beforeFunctions.some((b) => b.name === f.name))).toEqual(
    beforeFunctions
  );
  expect(
    afterFunctions.filter((f) => !beforeFunctions.some((b) => b.name === f.name)).map((f) => f.name)
  ).toEqual(['guard_telegram_intent()', 'guard_telegram_link()', 'guard_telegram_update()']);
  const afterTables = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows.map((r) => r.tablename);
  expect(afterTables.filter((t) => !tables.includes(t))).toEqual([
    'telegram_link_intents',
    'telegram_links',
    'telegram_updates',
  ]);
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await rows(afterTables)).toEqual({
    ...beforeRows,
    telegram_link_intents: [],
    telegram_links: [],
    telegram_updates: [],
  });
  expect(await functions()).toEqual(afterFunctions);
});
