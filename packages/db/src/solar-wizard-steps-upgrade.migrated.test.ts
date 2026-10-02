import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('adds bounded solar wizard steps to populated drafts without losing data or changing migration history', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'solar-wizard-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 242),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_solar_wizard_' + randomUUID().replaceAll('-', '');
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
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('chosen','chosen','test')"
    );
    const profile = (
      await pool.query(
        "INSERT INTO profiles(user_id,profile_type,status) VALUES ('chosen','INDIVIDUAL','DRAFT') RETURNING id"
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO solar_customer_drafts(user_id,profile_id,data,updated_at) VALUES ('chosen',$1,$2,'2025-01-02T03:04:05Z')",
      [profile, JSON.stringify({ siteDescription: 'Existing incomplete draft' })]
    );
    const before = (await pool.query('SELECT * FROM solar_customer_drafts')).rows;
    const history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: journal.entries
        .filter((entry: { idx: number }) => entry.idx >= 242)
        .map((entry: { tag: string }) => entry.tag),
    });
    expect((await pool.query('SELECT * FROM solar_customer_drafts')).rows).toEqual(
      before.map((row) => ({ ...row, current_step: 1 }))
    );
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        history.length
      )
    ).toEqual(history);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    const updated = (
      await pool.query(
        "UPDATE solar_customer_drafts SET current_step=4 WHERE user_id='chosen' RETURNING *"
      )
    ).rows[0];
    expect(updated.current_step).toBe(4);
    expect(updated.data).toEqual(before[0].data);
    expect(updated.updated_at.getTime()).toBeGreaterThan(before[0].updated_at.getTime());
    expect(updated.created_at).toEqual(before[0].created_at);
    for (const invalid of [0, 5])
      await expect(
        pool.query("UPDATE solar_customer_drafts SET current_step=$1 WHERE user_id='chosen'", [
          invalid,
        ])
      ).rejects.toMatchObject({ code: '23514', constraint: 'solar_customer_drafts_step' });
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
