import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const production = resolve(__dirname, '../drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'provider-proof-before-'));
const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
const prior = {
  ...journal,
  entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 126),
};
mkdirSync(join(previous, 'meta'));
writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
for (const entry of prior.entries)
  copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
let management: Pool;
const databases: string[] = [];
beforeAll(() => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
});
afterAll(async () => {
  try {
    for (const name of databases) await management.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
  }
});

for (const channel of ['email', 'sms']) {
  it(`${channel}: upgrades legacy providers without downtime or invented proof; blocks old writers`, async () => {
    const name = 'test_provider_proof_' + randomUUID().replaceAll('-', '');
    await management.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    const pool = new Pool({ connectionString: url.toString() });
    const table = `${channel}_provider_configs`,
      transport = channel === 'email' ? 'smtp' : 'smsir';
    try {
      await pool.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES ('legacy-provider','legacy@example.test','fixture')"
      );
      const active = randomUUID(),
        draft = randomUUID();
      for (const [id, status] of [
        [active, 'active'],
        [draft, 'draft'],
      ])
        await pool.query(
          `INSERT INTO ${table}(id,transport,label,status,config,created_by,last_test_status,last_test_at)
          VALUES ($1,$2,'Legacy',$3,'{}','legacy-provider','passed',NOW())`,
          [id, transport, status]
        );
      const before = (
        await pool.query(
          `SELECT id,status,config,last_test_status,last_test_at FROM ${table} ORDER BY id`
        )
      ).rows;
      expect(await runMigrations({ connection })).toEqual({
        ok: true,
        applied: ['0126_provider_delivery_proof'],
      });
      expect(
        (
          await pool.query(
            `SELECT id,status,config,last_test_status,last_test_at FROM ${table} ORDER BY id`
          )
        ).rows
      ).toEqual(before);
      expect(
        (await pool.query(`SELECT delivery_verified_at,delivery_config_hash FROM ${table}`)).rows
      ).toEqual([
        { delivery_verified_at: null, delivery_config_hash: null },
        { delivery_verified_at: null, delivery_config_hash: null },
      ]);
      await pool.query(`UPDATE ${table} SET label='Still working' WHERE id=$1`, [active]);
      await expect(
        pool.query(`UPDATE ${table} SET config='{"changed":true}' WHERE id=$1`, [active])
      ).rejects.toMatchObject({ code: '23514', constraint: 'provider_delivery_proof_required' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE ${table} SET status='superseded' WHERE id=$1`, [active]);
        await expect(
          client.query(`UPDATE ${table} SET status='active' WHERE id=$1`, [draft])
        ).rejects.toMatchObject({ code: '23514', constraint: 'provider_delivery_proof_required' });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(
        (await pool.query(`SELECT status FROM ${table} WHERE id=$1`, [active])).rows[0].status
      ).toBe('active');
      await expect(
        pool.query(
          `INSERT INTO ${table}(transport,label,status,config,created_by,last_test_status)
        VALUES ($1,'Old writer','active','{}','legacy-provider','passed')`,
          [transport]
        )
      ).rejects.toMatchObject({ code: '23514' });
      // A trusted sender's evidence is exact to transport, config and test time.
      await pool.query(
        `UPDATE ${table} SET delivery_verified_at=last_test_at,
        delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,config)::text,'UTF8')),'hex') WHERE id=$1`,
        [draft]
      );
      await pool.query(
        `UPDATE ${table} SET last_test_at=last_test_at+INTERVAL '1 microsecond' WHERE id=$1`,
        [draft]
      );
      await expect(
        pool.query(`UPDATE ${table} SET status='active' WHERE id=$1`, [draft])
      ).rejects.toMatchObject({ code: '23514' });
      await pool.query(`UPDATE ${table} SET last_test_at=delivery_verified_at WHERE id=$1`, [
        draft,
      ]);
      await pool.query(`UPDATE ${table} SET status='superseded' WHERE id=$1`, [active]);
      await pool.query(`UPDATE ${table} SET status='active' WHERE id=$1`, [draft]);
      expect((await pool.query(`SELECT id FROM ${table} WHERE status='active'`)).rows).toEqual([
        { id: draft },
      ]);
      expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    } finally {
      await pool.end();
    }
  }, 30000);
}
