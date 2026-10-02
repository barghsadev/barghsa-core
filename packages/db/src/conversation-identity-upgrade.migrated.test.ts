import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('adds opt-in identities to an existing production database without publishing login identifiers and reruns safely', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'conversation-identity-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 234),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_identity_upgrade_' + randomUUID().replaceAll('-', '');
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
      "INSERT INTO users(user_id,username,email,mobile,password_hash) VALUES ('legacy','private@example.test','private@example.test','+989121234567','test')"
    );
    const before = (await pool.query('SELECT * FROM users')).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: [
        '0234_conversation_identities',
        '0235_conversation_identity_timestamps',
        '0236_activity_identity_consent',
      ],
    });
    expect((await pool.query('SELECT * FROM users')).rows).toEqual(before);
    expect((await pool.query('SELECT * FROM conversation_identities')).rows).toEqual([]);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    for (const displayName of ['', 'x'.repeat(81), ' padded ', 'name\nline'])
      await expect(
        pool.query('INSERT INTO conversation_identities(user_id,display_name) VALUES ($1,$2)', [
          'legacy',
          displayName,
        ])
      ).rejects.toMatchObject({ code: '23514', constraint: 'conversation_identity_name' });
    await expect(
      pool.query(
        "INSERT INTO conversation_identities(user_id,avatar_key) VALUES ('legacy','https://external.example.test/photo')"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'conversation_identity_avatar' });
    await expect(
      pool.query("INSERT INTO conversation_identities(user_id,revision) VALUES ('legacy',0)")
    ).rejects.toMatchObject({ code: '23514', constraint: 'conversation_identity_revision' });
    await expect(
      pool.query(
        "INSERT INTO conversation_identities(user_id,display_name) VALUES ('missing','Chosen')"
      )
    ).rejects.toMatchObject({ code: '23503' });
    await pool.query(
      "INSERT INTO conversation_identities(user_id,display_name) VALUES ('legacy','نام‌نمایشی')"
    );
    const explicit = new Date('2025-01-02T03:04:05.000Z');
    await pool.query('UPDATE conversation_identities SET updated_at=$1 WHERE user_id=$2', [
      explicit,
      'legacy',
    ]);
    expect(
      (await pool.query("SELECT updated_at FROM conversation_identities WHERE user_id='legacy'"))
        .rows[0].updated_at
    ).toEqual(explicit);
    const stamped = (
      await pool.query(
        "UPDATE conversation_identities SET display_name='Changed' WHERE user_id='legacy' RETURNING updated_at"
      )
    ).rows[0].updated_at;
    expect(stamped.getTime()).toBeGreaterThan(explicit.getTime());
    await expect(
      pool.query(
        "INSERT INTO conversation_identities(user_id,display_name) VALUES ('legacy','Duplicate')"
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query("DELETE FROM users WHERE user_id='legacy'");
    expect((await pool.query('SELECT * FROM conversation_identities')).rows).toEqual([]);
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
