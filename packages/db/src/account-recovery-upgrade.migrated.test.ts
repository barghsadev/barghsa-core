import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production'),
  prior = mkdtempSync(join(tmpdir(), 'account-recovery-upgrade-'));
const name = 'test_recovery_upgrade_' + randomUUID().replaceAll('-', '');
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 274);
  mkdirSync(join(prior, 'meta'));
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(prior, entry.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: prior })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
}, 40000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(prior, { recursive: true, force: true });
  }
});
it('expands only recovery schema/purpose and preserves every existing public row/function through upgrade and replay', async () => {
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('recovery-upgrade-owner','upgrade@example.test','fixture');INSERT INTO profiles(user_id) VALUES('recovery-upgrade-owner')"
  );
  const legacy = randomUUID();
  await pool.query(
    "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,purpose,user_id,expires_at) VALUES($1,'upgrade@example.test','fixture','login','recovery-upgrade-owner',NOW()+INTERVAL '5 minutes')",
    [legacy]
  );
  const tables = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows as Array<{ tablename: string }>;
  const rows = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async ({ tablename }) => [
          tablename,
          (
            await pool.query(
              `SELECT row_to_json(t)::text AS row FROM public."${tablename}" t ORDER BY row_to_json(t)::text`
            )
          ).rows,
        ])
      )
    );
  const before = await rows();
  const functions = (
    await pool.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.oid"
    )
  ).rows;
  expect((await runMigrations({ connection, migrationsFolder: production })).ok).toBe(true);
  expect(await rows()).toEqual(before);
  for (const fn of functions)
    expect(
      (await pool.query('SELECT pg_get_functiondef($1::oid) AS definition', [fn.oid])).rows[0]
        .definition
    ).toBe(fn.definition);
  expect((await runMigrations({ connection, migrationsFolder: production })).ok).toBe(true);
  expect(await rows()).toEqual(before);
  expect(
    (await pool.query("SELECT to_regclass('public.account_recovery_cases') AS table")).rows[0].table
  ).toBe('account_recovery_cases');
  await expect(
    pool.query(
      "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,purpose,expires_at) VALUES($1,'new@example.test','fixture','account_recovery',NOW()+INTERVAL '5 minutes')",
      [randomUUID()]
    )
  ).rejects.toThrow('otp_challenge_purpose_binding');
  const id = randomUUID();
  await pool.query(
    "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,purpose,user_id,expires_at) VALUES($1,'new@example.test','fixture','account_recovery','recovery-upgrade-owner',NOW()+INTERVAL '5 minutes')",
    [id]
  );
  expect(
    (await pool.query('SELECT auth_version FROM otp_challenges WHERE challenge_id=$1', [id]))
      .rows[0].auth_version
  ).toBe(0);
});
