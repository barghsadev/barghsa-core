import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('expands consultation cursors without changing existing routing positions or migration history', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'consultation-routing-upgrade-'));
  const production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 243),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_consultation_routing_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    databaseCreated = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    databaseCreated = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('assigned','assigned','test')"
    );
    const team = (await pool.query("INSERT INTO staff_teams(name) VALUES('Existing') RETURNING id"))
      .rows[0].id;
    for (const type of ['ticket', 'verification_case'])
      await pool.query(
        "INSERT INTO staff_assignment_cursors(team_id,work_type,last_user_id,updated_at) VALUES($1,$2,'assigned','2025-01-02T03:04:05Z')",
        [team, type]
      );
    const before = (await pool.query('SELECT * FROM staff_assignment_cursors ORDER BY work_type'))
      .rows;
    const history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: journal.entries
        .filter((entry: { idx: number }) => entry.idx >= 243)
        .map((entry: { tag: string }) => entry.tag),
    });
    expect(
      (await pool.query('SELECT * FROM staff_assignment_cursors ORDER BY work_type')).rows
    ).toEqual(before);
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        history.length
      )
    ).toEqual(history);
    await pool.query(
      "INSERT INTO staff_assignment_cursors(team_id,work_type,last_user_id) VALUES($1,'consultation','assigned')",
      [team]
    );
    await expect(
      pool.query(
        "INSERT INTO staff_assignment_cursors(team_id,work_type) VALUES($1,'unsupported')",
        [team]
      )
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'staff_assignment_cursors_work_type_check',
    });
    expect(
      (
        await pool.query(
          "SELECT indexdef FROM pg_indexes WHERE indexname='consultation_open_owner_idx'"
        )
      ).rows[0].indexdef
    ).toContain('staff_owner_id');
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  } finally {
    await pool?.end();
    try {
      if (databaseCreated) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 120000);
