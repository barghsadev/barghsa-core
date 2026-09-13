import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createDbPool, dbHealth } from './index.js';
import { runMigrations } from './migrate.js';

const database = 'test_foundations_' + randomUUID().replaceAll('-', '');
let management: Pool;
let pool: Pool;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + database;
  pool = createDbPool({ databaseUrl: url.toString(), poolMax: 4, poolMin: 0 });
  expect((await dbHealth()).ok).toBe(true);
  expect((await dbHealth({ verifySchema: true })).ok).toBe(false);
  expect(await runMigrations({ connection: { pgdirectUrl: url.toString() } })).toMatchObject({
    ok: true,
  });
}, 30000);
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await management.end();
  }
});

it('checks the packaged schema head and rejects changed, older, newer or absent metadata', async () => {
  expect((await dbHealth({ verifySchema: true })).ok).toBe(true);
  const latest = (
    await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1')
  ).rows[0];
  try {
    for (const [hash, timestamp] of [
      ['changed', latest.created_at],
      [latest.hash, String(Number(latest.created_at) - 1)],
      [latest.hash, String(Number(latest.created_at) + 1)],
    ]) {
      await pool.query(
        'UPDATE drizzle.__drizzle_migrations SET hash=$1,created_at=$2 WHERE id=$3',
        [hash, timestamp, latest.id]
      );
      expect((await dbHealth({ verifySchema: true })).ok).toBe(false);
      expect((await dbHealth()).ok).toBe(true);
    }
    await pool.query('DELETE FROM drizzle.__drizzle_migrations WHERE id=$1', [latest.id]);
    expect((await dbHealth({ verifySchema: true })).ok).toBe(false);
  } finally {
    await pool.query(
      'INSERT INTO drizzle.__drizzle_migrations(id,hash,created_at) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,created_at=excluded.created_at',
      [latest.id, latest.hash, latest.created_at]
    );
  }
  expect((await dbHealth({ verifySchema: true })).ok).toBe(true);
});

it('shares schema probes without treating a connectivity probe as schema validation', async () => {
  await pool.query('ALTER TABLE drizzle.__drizzle_migrations RENAME TO saved_migrations');
  const connect = vi.spyOn(pool, 'connect');
  try {
    const results = await Promise.all([
      dbHealth(),
      ...Array.from({ length: 20 }, () => dbHealth({ verifySchema: true })),
    ]);
    expect(results[0]?.ok).toBe(true);
    expect(results.slice(1).every((result) => !result.ok)).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(pool.waitingCount).toBe(0);
  } finally {
    connect.mockRestore();
    await pool.query('ALTER TABLE drizzle.saved_migrations RENAME TO __drizzle_migrations');
  }
});

it('attaches the timestamp trigger to every current public table with updated_at', async () => {
  const missing = await pool.query(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='updated_at' AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind='r' AND NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid=c.oid AND pg_get_functiondef(p.oid) ~* 'NEW\\.updated_at' AND t.tgenabled='O'
    )`);
  expect(missing.rows).toEqual([]);
});

it('stamps raw updates, preserves creation and explicit writer timestamps, and rolls back atomically', async () => {
  const original = (
    await pool.query(`INSERT INTO staff_teams(name,created_at,updated_at)
    VALUES ('Before','2020-01-01','2020-01-02') RETURNING *`)
  ).rows[0];
  const updated = (
    await pool.query("UPDATE staff_teams SET name='After' WHERE id=$1 RETURNING *", [original.id])
  ).rows[0];
  expect(updated.updated_at.getTime()).toBeGreaterThan(original.updated_at.getTime());
  expect(updated.created_at).toEqual(original.created_at);
  const explicit = new Date('2025-01-02T03:04:05.000Z');
  expect(
    (
      await pool.query('UPDATE staff_teams SET updated_at=$1 WHERE id=$2 RETURNING updated_at', [
        explicit,
        original.id,
      ])
    ).rows[0].updated_at
  ).toEqual(explicit);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inside = (
      await client.query(
        "UPDATE staff_teams SET name='Rolled back' WHERE id=$1 RETURNING updated_at",
        [original.id]
      )
    ).rows[0];
    expect(inside.updated_at.getTime()).toBeGreaterThan(explicit.getTime());
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  expect(
    (await pool.query('SELECT name,updated_at FROM staff_teams WHERE id=$1', [original.id])).rows[0]
  ).toEqual({ name: 'After', updated_at: explicit });
});

it('generates unique UUIDv7 values with valid timestamp bits across concurrent production connections', async () => {
  const start = Date.now();
  const batches = await Promise.all(
    Array.from({ length: 4 }, () =>
      pool.query('SELECT uuid_generate_v7() AS id FROM generate_series(1,250)')
    )
  );
  const end = Date.now();
  const ids = batches.flatMap((batch) => batch.rows.map((row: { id: string }) => row.id));
  expect(new Set(ids).size).toBe(1000);
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const timestamp = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    expect(timestamp).toBeGreaterThanOrEqual(start - 1000);
    expect(timestamp).toBeLessThanOrEqual(end + 1000);
  }
});
