import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const production = resolve(__dirname, '../drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'email-corrections-before-'));
const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
const prior = {
  ...journal,
  entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 131),
};
mkdirSync(join(previous, 'meta'));
writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
for (const entry of prior.entries)
  copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
afterAll(() => rmSync(previous, { recursive: true, force: true }));

it('upgrades legacy complaints into open tasks without clearing suppressions or guessing missing profile identity', async () => {
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_corrections_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('complaint-owner','complaint-owner','fixture')"
    );
    const profile = (
      await pool.query("INSERT INTO profiles(user_id) VALUES ('complaint-owner') RETURNING id")
    ).rows[0].id;
    await pool.query(
      `INSERT INTO email_suppressions(address,reason,profile_id,created_at) VALUES
      ('known@example.test','complaint',$1,'2026-01-01'),('unknown@example.test','complaint',NULL,'2026-01-02'),('bounce@example.test','hard_bounce',$1,'2026-01-03')`,
      [profile]
    );
    expect((await runMigrations({ connection })).ok).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT address,profile_id,resolved_at FROM email_customer_corrections ORDER BY address'
        )
      ).rows
    ).toEqual([
      { address: 'known@example.test', profile_id: profile, resolved_at: null },
      { address: 'unknown@example.test', profile_id: null, resolved_at: null },
    ]);
    expect((await runMigrations({ connection })).ok).toBe(true);
    expect((await pool.query('SELECT id FROM email_customer_corrections')).rowCount).toBe(2);
    await pool.query('DELETE FROM profiles WHERE id=$1', [profile]);
    expect((await pool.query('SELECT profile_id FROM email_suppressions')).rows).toEqual([
      { profile_id: null },
      { profile_id: null },
      { profile_id: null },
    ]);
    expect(
      (
        await pool.query(
          "SELECT created_at FROM email_customer_corrections WHERE address='known@example.test'"
        )
      ).rows[0].created_at.toISOString()
    ).toBe('2026-01-01T00:00:00.000Z');
  } finally {
    await pool?.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await management.end();
  }
}, 30000);
