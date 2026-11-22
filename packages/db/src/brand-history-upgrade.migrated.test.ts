import { runMigrationPrefix } from './test/migration-prefix';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { createMigratedTestDb } from './test/migrated-db';

it('supersedes only obsolete drafts on upgrade without changing published branding or migration history', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'brand-history-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 278),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_brand_history_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    const old = (await pool.query("SELECT * FROM brand_config WHERE status='draft'")).rows[0];
    const active = (await pool.query("SELECT * FROM brand_config WHERE status='active'")).rows[0];
    expect(old.version).toBeLessThan(active.version);
    const newer = (
      await pool.query(
        "INSERT INTO brand_config(config,version,status,created_by) VALUES ($1::jsonb,$2,'draft','chosen-editor') RETURNING *",
        [
          JSON.stringify({ ...active.config, appTitle: 'Retained private draft' }),
          active.version + 1,
        ]
      )
    ).rows[0];
    const history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrationPrefix('0278_brand_history_repair', { connection })).toEqual({
      ok: true,
      applied: ['0278_brand_history_repair'],
    });
    const repaired = (await pool.query('SELECT * FROM brand_config WHERE id=$1', [old.id])).rows[0];
    expect(repaired).toEqual({ ...old, status: 'superseded', updated_at: repaired.updated_at });
    expect(repaired.updated_at.getTime()).toBeGreaterThanOrEqual(old.updated_at.getTime());
    expect(
      (await pool.query('SELECT * FROM brand_config WHERE id=$1', [active.id])).rows[0]
    ).toEqual(active);
    expect(
      (await pool.query('SELECT * FROM brand_config WHERE id=$1', [newer.id])).rows[0]
    ).toEqual(newer);
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        history.length
      )
    ).toEqual(history);
    expect(await runMigrationPrefix('0278_brand_history_repair', { connection })).toEqual({
      ok: true,
      applied: [],
    });
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 120000);

describe('fresh branding installations', () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDb>>;

  beforeAll(async () => {
    database = await createMigratedTestDb();
  }, 120_000);

  afterAll(async () => {
    await database?.close();
  });

  it('publishes the new default as a revision and retains the earlier seed history', async () => {
    const rows = (
      await database.pool.query(
        `SELECT version, status, config->>'primaryColor' AS primary,
                config->>'darkPrimaryColor' AS dark_primary
         FROM brand_config WHERE version >= 2 ORDER BY version`
      )
    ).rows;
    expect(rows).toEqual([
      { version: 2, status: 'superseded', primary: '#176b5b', dark_primary: null },
      { version: 3, status: 'active', primary: '#204c80', dark_primary: '#a2c7ff' },
    ]);
    expect(
      (await database.pool.query('SELECT status FROM brand_config WHERE version = 1')).rows
    ).toEqual([{ status: 'superseded' }]);
  });

  it.each(['staff publication', 'custom dark palette', 'unpublished draft', 'new default'])(
    'leaves the branding history unchanged for %s',
    async (scenario) => {
      const sql = readFileSync('drizzle/production/0299_default_brand_palette.sql', 'utf8');
      const client = await database.pool.connect();
      const history = 'SELECT * FROM brand_config ORDER BY version';
      try {
        await client.query('BEGIN');
        if (scenario !== 'new default') {
          await client.query('DELETE FROM brand_config WHERE version = 3');
          await client.query("UPDATE brand_config SET status = 'active' WHERE version = 2");
        }
        if (scenario === 'staff publication')
          await client.query("UPDATE brand_config SET created_by = 'editor' WHERE version = 2");
        if (scenario === 'custom dark palette')
          await client.query(
            `UPDATE brand_config SET config = config || '{"darkPrimaryColor":"#89a3bc"}'::jsonb
             WHERE version = 2`
          );
        if (scenario === 'unpublished draft')
          await client.query(
            `INSERT INTO brand_config (config, version, status, created_by)
             VALUES ('{"primaryColor":"#344766"}'::jsonb, 3, 'draft', 'editor')`
          );
        const before = (await client.query(history)).rows;
        await client.query(sql);
        expect((await client.query(history)).rows).toEqual(before);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  );
});
