import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations, verifyMigrationVersion, type MigrationOptions } from './migrate';

const resources: { folder: string; schema: string }[] = [];

function fixture(): MigrationOptions & { migrationsFolder: string; migrationsSchema: string } {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('PostgreSQL test setup did not provide a database URL');
  const folder = mkdtempSync(join(tmpdir(), 'barghsa-migrations-'));
  const schema = `test_migration_${randomUUID().replaceAll('-', '')}`;
  resources.push({ folder, schema });
  mkdirSync(join(folder, 'meta'));
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [{ idx: 0, version: '7', when: 1000, tag: '0000_foundation', breakpoints: true }],
    })
  );
  writeFileSync(
    join(folder, '0000_foundation.sql'),
    `CREATE TABLE "${schema}".example (id integer PRIMARY KEY);`
  );
  return {
    migrationsFolder: folder,
    migrationsSchema: schema,
    connection: { pgdirectUrl: connectionString },
  };
}

afterEach(async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    for (const { folder, schema } of resources.splice(0)) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      rmSync(folder, { recursive: true, force: true });
    }
  } finally {
    await pool.end();
  }
});

describe('production migration runner', () => {
  it('reports actual journal tags, verifies schema-qualified metadata, and can run twice', async () => {
    const options = fixture();
    expect(await verifyMigrationVersion('0000', options)).toBe(false);
    expect(await runMigrations(options)).toEqual({ ok: true, applied: ['0000_foundation'] });
    expect(await verifyMigrationVersion('0000_foundation', options)).toBe(true);
    expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    writeFileSync(join(options.migrationsFolder, '0000_foundation.sql'), 'SELECT 1;');
    expect(await verifyMigrationVersion('0000', options)).toBe(false);
  });

  it('serializes competing deploys so a migration is applied exactly once', async () => {
    const options = fixture();
    const results = await Promise.all([runMigrations(options), runMigrations(options)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.flatMap((result) => result.applied)).toEqual(['0000_foundation']);
  });

  it('rolls back a failed migration and allows retry on a fresh owned connection', async () => {
    const options = fixture();
    const path = join(options.migrationsFolder, '0000_foundation.sql');
    writeFileSync(
      path,
      `CREATE TABLE "${options.migrationsSchema}".example (id integer); SELECT * FROM missing_relation;`
    );
    expect((await runMigrations(options)).ok).toBe(false);
    expect(await verifyMigrationVersion('0000', options)).toBe(false);
    writeFileSync(path, `CREATE TABLE "${options.migrationsSchema}".example (id integer);`);
    expect((await runMigrations(options)).ok).toBe(true);
  });

  it('blocks stale generated timestamps before applying any SQL', async () => {
    const options = fixture();
    expect((await runMigrations(options)).ok).toBe(true);
    const journalPath = join(options.migrationsFolder, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries.push({ idx: 1, version: '7', when: 900, tag: '0001_next', breakpoints: true });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(options.migrationsFolder, '0001_next.sql'), 'SELECT 1;');
    expect(await runMigrations(options)).toMatchObject({
      ok: false,
      error: expect.stringContaining('strictly increasing'),
    });
    journal.entries[1].when = 1001;
    writeFileSync(journalPath, JSON.stringify(journal));
    expect(await runMigrations(options)).toEqual({ ok: true, applied: ['0001_next'] });
  });

  it('rejects changed applied SQL and metadata gaps instead of reporting success', async () => {
    const options = fixture();
    const originalSql = readFileSync(join(options.migrationsFolder, '0000_foundation.sql'), 'utf8');
    expect((await runMigrations(options)).ok).toBe(true);
    writeFileSync(join(options.migrationsFolder, '0000_foundation.sql'), 'SELECT 1;');
    expect(await runMigrations(options)).toMatchObject({
      ok: false,
      error: expect.stringContaining('checksum/history mismatch'),
    });
    writeFileSync(join(options.migrationsFolder, '0000_foundation.sql'), originalSql);
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const journalPath = join(options.migrationsFolder, 'meta/_journal.json');
      const originalJournal = readFileSync(journalPath, 'utf8');
      const journal = JSON.parse(originalJournal);
      journal.entries.unshift({
        idx: -1,
        version: '7',
        when: 900,
        tag: 'missing_prior',
        breakpoints: true,
      });
      writeFileSync(journalPath, JSON.stringify(journal));
      writeFileSync(join(options.migrationsFolder, 'missing_prior.sql'), 'SELECT 1;');
      expect(await runMigrations(options)).toMatchObject({
        ok: false,
        error: expect.stringContaining('missing behind'),
      });
      writeFileSync(journalPath, originalJournal);
      await pool.query(
        `UPDATE "${options.migrationsSchema}".__drizzle_migrations SET created_at=1001`
      );
      expect(await runMigrations(options)).toMatchObject({
        ok: false,
        error: expect.stringContaining('newer than this journal'),
      });
      await pool.query(
        `UPDATE "${options.migrationsSchema}".__drizzle_migrations SET created_at=1000`
      );
      expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    } finally {
      await pool.end();
    }
  });

  it('does not disguise connection failures as an empty migration history', async () => {
    const options = fixture();
    options.connection = {
      pgdirectUrl: 'postgresql://127.0.0.1:1/unavailable',
      connectionTimeoutMillis: 100,
    };
    await expect(verifyMigrationVersion('0000', options)).rejects.toThrow();
    expect((await runMigrations(options)).ok).toBe(false);
  });
});
