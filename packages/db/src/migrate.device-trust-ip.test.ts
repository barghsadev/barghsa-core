import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const production = resolve(__dirname, '../drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'device-trust-before-'));
const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
const prior = {
  ...journal,
  entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 121),
};
mkdirSync(join(previous, 'meta'));
writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
for (const entry of prior.entries)
  copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
afterAll(() => rmSync(previous, { recursive: true, force: true }));

it('preserves existing trust on upgrade with unknown IP, supports IPv4/IPv6 and repeats safely', async () => {
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_trust_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('trust-owner','trust@example.test','fixture-only')"
    );
    await pool.query(
      "INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at) VALUES ('trust-record','trust-owner','opaque-cookie-hash',NOW()+INTERVAL '1 day')"
    );
    const before = (await pool.query('SELECT * FROM device_trusts')).rows[0];
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0121_device_trust_ip', '0122_password_reset_authorization'],
    });
    expect((await pool.query('SELECT * FROM device_trusts')).rows).toEqual([
      { ...before, ip_address: null },
    ]);
    // PostgreSQL stores addresses rather than arbitrary headers or text hints.
    for (const address of ['192.0.2.1', '2001:db8:0:0:0:0:0:1']) {
      await pool.query('UPDATE device_trusts SET ip_address=$1::inet', [address]);
      expect(
        (
          await pool.query('SELECT ip_address=$1::inet AS matches FROM device_trusts', [
            address.includes(':') ? '2001:db8::1' : address,
          ])
        ).rows[0].matches
      ).toBe(true);
    }
    await expect(pool.query("UPDATE device_trusts SET ip_address='unknown'")).rejects.toMatchObject(
      { code: '22P02' }
    );
    const upgraded = (await pool.query('SELECT * FROM device_trusts')).rows;
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect((await pool.query('SELECT * FROM device_trusts')).rows).toEqual(upgraded);
  } finally {
    await pool?.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await management.end();
  }
}, 20000);
