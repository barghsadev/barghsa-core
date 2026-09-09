import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const production = resolve(__dirname, '../drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'preauth-before-'));
const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
const prior = {
  ...journal,
  entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 123),
};
mkdirSync(join(previous, 'meta'));
writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
for (const entry of prior.entries)
  copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
afterAll(() => rmSync(previous, { recursive: true, force: true }));

it('adds anonymous CSRF storage without changing existing accounts or sessions and repeats safely', async () => {
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_preauth_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('owner','owner@example.test','fixture')"
    );
    await pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ('legacy-session','owner','legacy-csrf',NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')"
    );
    const users = (await pool.query('SELECT * FROM users')).rows;
    const sessions = (await pool.query('SELECT * FROM sessions')).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0123_preauth_sessions', '0124_address_soft_delete', '0125_ticket_category'],
    });
    expect((await pool.query('SELECT * FROM users')).rows).toEqual(users);
    expect((await pool.query('SELECT * FROM sessions')).rows).toEqual(sessions);
    for (const [id, csrf, expiry] of [
      ['invalid', 'b'.repeat(64), '30 minutes'],
      ['a'.repeat(64), 'invalid', '30 minutes'],
      ['a'.repeat(64), 'b'.repeat(64), '-1 minute'],
    ]) {
      await expect(
        pool.query(
          'INSERT INTO preauth_sessions(id_hash,csrf_token,expires_at) VALUES ($1,$2,NOW()+$3::interval)',
          [id, csrf, expiry]
        )
      ).rejects.toMatchObject({ code: '23514' });
    }
    await pool.query(
      "INSERT INTO preauth_sessions(id_hash,csrf_token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '30 minutes')",
      ['a'.repeat(64), 'b'.repeat(64)]
    );
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM preauth_sessions')).rows[0].count
    ).toBe(1);
  } finally {
    await pool?.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await management.end();
  }
}, 20000);
