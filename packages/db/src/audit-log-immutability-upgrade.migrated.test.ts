import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';
it('protects existing audit history on upgrade and leaves migration replay harmless', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'audit-immutability-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 249),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_audit_upgrade_' + randomUUID().replaceAll('-', '');
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
    const id = randomUUID(),
      actor = randomUUID();
    await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await pool.query(
      "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at) VALUES($1,$2,'legacy.audit','{\"legacy\":true}',$3,'2026-01-01T00:00:00Z')",
      [id, actor, randomUUID()]
    );
    const before = (await pool.query('SELECT * FROM audit_log ORDER BY id')).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0249_audit_log_immutability'],
    });
    expect((await pool.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(before);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    await expect(pool.query('DELETE FROM audit_log WHERE id=$1', [id])).rejects.toMatchObject({
      code: '55000',
    });
    expect((await pool.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(before);
    await pool.query("INSERT INTO audit_log(id,user_id,event) VALUES($1,$2,'new.audit')", [
      randomUUID(),
      actor,
    ]);
    expect(
      (await pool.query("SELECT id FROM audit_log WHERE event='new.audit'")).rows
    ).toHaveLength(1);
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 30000);
