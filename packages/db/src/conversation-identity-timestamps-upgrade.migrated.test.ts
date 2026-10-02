import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('adds the standard timestamp trigger to populated identity tables without changing their rows or earlier migration checksums', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'identity-timestamps-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 235),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_identity_timestamps_' + randomUUID().replaceAll('-', '');
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
    await pool.query(
      "INSERT INTO conversation_identities(user_id,display_name,revision,updated_at) VALUES ('chosen','نام‌نمایشی',7,'2025-01-02T03:04:05Z')"
    );
    const before = (await pool.query('SELECT * FROM conversation_identities')).rows;
    const history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0235_conversation_identity_timestamps', '0236_activity_identity_consent'],
    });
    expect((await pool.query('SELECT * FROM conversation_identities')).rows).toEqual(
      before.map((row) => ({ ...row, share_in_activity: false }))
    );
    await expect(
      pool.query(
        "UPDATE conversation_identities SET display_name=NULL,share_in_activity=true WHERE user_id='chosen'"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'conversation_identity_activity_name' });
    await pool.query(
      "UPDATE conversation_identities SET share_in_activity=true WHERE user_id='chosen'"
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
        "UPDATE conversation_identities SET display_name='Changed' WHERE user_id='chosen' RETURNING *"
      )
    ).rows[0];
    expect(updated.updated_at.getTime()).toBeGreaterThan(before[0].updated_at.getTime());
    expect(updated.revision).toBe(7);
    const explicit = new Date('2025-02-03T04:05:06Z');
    expect(
      (
        await pool.query(
          "UPDATE conversation_identities SET updated_at=$1 WHERE user_id='chosen' RETURNING updated_at",
          [explicit]
        )
      ).rows[0].updated_at
    ).toEqual(explicit);
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
