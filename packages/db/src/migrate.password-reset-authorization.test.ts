import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const production = resolve(__dirname, '../drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'reset-authorization-before-'));
const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
const prior = {
  ...journal,
  entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 122),
};
mkdirSync(join(previous, 'meta'));
writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
for (const entry of prior.entries)
  copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
afterAll(() => rmSync(previous, { recursive: true, force: true }));

it('upgrades existing OTPs without consuming them, enforces grant state and repeats safely', async () => {
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_reset_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('reset-owner','reset@example.test','fixture-only')"
    );
    const id = randomUUID();
    await pool.query(
      `INSERT INTO otp_challenges(challenge_id,user_id,destination,otp_hash,purpose,expires_at)
      VALUES ($1,'reset-owner','reset@example.test','fixture-code','password_reset',NOW()+INTERVAL '5 minutes')`,
      [id]
    );
    const before = (await pool.query('SELECT * FROM otp_challenges')).rows[0];
    const account = (await pool.query('SELECT * FROM users')).rows[0];
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0122_password_reset_authorization'],
    });
    expect((await pool.query('SELECT * FROM otp_challenges')).rows).toEqual([
      { ...before, reset_token_hash: null, reset_consumed_at: null },
    ]);
    expect((await pool.query('SELECT * FROM users')).rows).toEqual([
      { ...account, password_reset_challenge_id: null },
    ]);
    for (const update of [
      'reset_consumed_at=NOW()',
      "reset_token_hash=repeat('a',64)",
      "reset_token_hash='invalid',consumed_at=NOW()",
      "reset_token_hash=repeat('a',64),consumed_at=NOW(),purpose='login'",
    ])
      await expect(
        pool.query(`UPDATE otp_challenges SET ${update} WHERE challenge_id=$1`, [id])
      ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      "UPDATE otp_challenges SET reset_token_hash=repeat('a',64),consumed_at=NOW(),attempts_remaining=0 WHERE challenge_id=$1",
      [id]
    );
    await expect(
      pool.query(
        `INSERT INTO otp_challenges(challenge_id,user_id,destination,otp_hash,purpose,expires_at,consumed_at,reset_token_hash)
      VALUES ($1,'reset-owner','reset@example.test','fixture-code','password_reset',NOW()+INTERVAL '5 minutes',NOW(),repeat('a',64))`,
        [randomUUID()]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query('UPDATE otp_challenges SET reset_consumed_at=NOW() WHERE challenge_id=$1', [
      id,
    ]);
    const completed = (await pool.query('SELECT * FROM otp_challenges')).rows;
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect((await pool.query('SELECT * FROM otp_challenges')).rows).toEqual(completed);
  } finally {
    await pool?.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await management.end();
  }
}, 20000);
