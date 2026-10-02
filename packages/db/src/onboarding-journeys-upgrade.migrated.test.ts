import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { runMigrations } from './migrate.js';
import { profileOnboardingJourneys } from './schema/onboarding-journeys.js';
it('upgrades existing profiles without creating setup records and enforces retry, open setup, and completion constraints', async () => {
  const production = resolve('drizzle/production'),
    previous = mkdtempSync(join(tmpdir(), 'onboarding-upgrade-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 240),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const e of prior.entries)
    copyFileSync(join(production, e.tag + '.sql'), join(previous, e.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    database = 'test_onboarding_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    created = false;
  try {
    await management.query(`CREATE DATABASE "${database}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + database;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('upgrade-owner','upgrade-owner','test-only')"
    );
    const profile = (
      await pool.query(
        "INSERT INTO profiles(user_id,profile_type,status,is_default,first_name,last_name) VALUES('upgrade-owner','INDIVIDUAL','ACTIVE',true,'Existing','Owner') RETURNING *"
      )
    ).rows[0];
    const checksums = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: journal.entries
        .filter((e: { idx: number }) => e.idx >= 240)
        .map((e: { tag: string }) => e.tag),
    });
    expect((await pool.query('SELECT * FROM profiles WHERE id=$1', [profile.id])).rows[0]).toEqual(
      profile
    );
    expect((await pool.query('SELECT * FROM profile_onboarding_journeys')).rows).toEqual([]);
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        checksums.length
      )
    ).toEqual(checksums);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    const constraints = (
      await pool.query(
        "SELECT conname FROM pg_constraint WHERE conrelid='profile_onboarding_journeys'::regclass"
      )
    ).rows.map((r) => r.conname);
    for (const check of getTableConfig(profileOnboardingJourneys).checks)
      expect(constraints).toContain(check.name);
    await expect(
      pool.query(
        "INSERT INTO profile_onboarding_journeys(user_id,request_id) VALUES('upgrade-owner',$1)",
        [randomUUID()]
      )
    ).rejects.toMatchObject({ code: '23514' });
    const requestId = randomUUID();
    const journey = (
      await pool.query(
        "INSERT INTO profile_onboarding_journeys(user_id,request_id,individual_profile_id) VALUES('upgrade-owner',$1,$2) RETURNING id",
        [requestId, profile.id]
      )
    ).rows[0].id;
    await expect(
      pool.query(
        'UPDATE profile_onboarding_journeys SET completed_at=NOW(),selected_profile_id=$1 WHERE id=$2',
        [randomUUID(), journey]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE profile_onboarding_journeys SET completed_at=NOW() WHERE id=$1', [journey])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        'UPDATE profile_onboarding_journeys SET legal_profile_id=individual_profile_id WHERE id=$1',
        [journey]
      )
    ).rejects.toMatchObject({ code: '23514' });
    const legal = (
      await pool.query(
        "INSERT INTO profiles(user_id,profile_type,status) VALUES('upgrade-owner','LEGAL','DRAFT') RETURNING id"
      )
    ).rows[0].id;
    await expect(
      pool.query(
        "INSERT INTO profile_onboarding_journeys(user_id,request_id,legal_profile_id) VALUES('upgrade-owner',$1,$2)",
        [randomUUID(), legal]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(
      'UPDATE profile_onboarding_journeys SET completed_at=NOW(),selected_profile_id=$1 WHERE id=$2',
      [profile.id, journey]
    );
    await expect(
      pool.query(
        "INSERT INTO profile_onboarding_journeys(user_id,request_id,legal_profile_id) VALUES('upgrade-owner',$1,$2)",
        [requestId, legal]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(
      "INSERT INTO profile_onboarding_journeys(user_id,request_id,legal_profile_id) VALUES('upgrade-owner',$1,$2)",
      [randomUUID(), legal]
    );
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${database}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 120000);
