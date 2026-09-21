import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';
it('upgrades existing Completed contracts without rewriting or fabricating completion evidence', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'contract-completion-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 144),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_completion_upgrade_' + randomUUID().replaceAll('-', '');
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
    const actor = randomUUID(),
      profile = randomUUID(),
      id = randomUUID(),
      version = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
        actor,
      ]);
      await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
      await client.query(
        "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'savings',$3)",
        [id, profile, version]
      );
      await client.query(
        "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,'Legacy',$4)",
        [version, id, JSON.stringify({ text: 'Legacy' }), actor]
      );
      await client.query(
        "UPDATE contracts SET state='Completed',completed_at='2026-01-01T00:00:00Z' WHERE id=$1",
        [id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const before = (await pool.query('SELECT * FROM contracts WHERE id=$1', [id])).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0144_contract_term_completion'],
    });
    expect((await pool.query('SELECT * FROM contracts WHERE id=$1', [id])).rows).toEqual(before);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect((await pool.query('SELECT * FROM contract_completions')).rows).toHaveLength(0);
    await expect(
      pool.query('UPDATE contracts SET completed_at=NOW() WHERE id=$1', [id])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE contracts SET state='Active' WHERE id=$1", [id])
    ).rejects.toMatchObject({ code: '23514' });
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
