import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { runMigrations } from './migrate.js';
import { solarConstructionPostal } from './schema/solar-construction.js';
it('upgrades populated postal records without estimates, preserves old checksums, and guards tracking revisions and shipment resets', async () => {
  const production = resolve('drizzle/production'),
    previous = mkdtempSync(join(tmpdir(), 'solar-postal-upgrade-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 239),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const e of prior.entries)
    copyFileSync(join(production, e.tag + '.sql'), join(previous, e.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    database = 'test_postal_tracking_' + randomUUID().replaceAll('-', '');
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
      "INSERT INTO users(user_id,username,password_hash) VALUES('postal-owner','postal-upgrade-owner','test-only')"
    );
    const profile = (
      await pool.query(
        "INSERT INTO profiles(user_id,profile_type,status) VALUES('postal-owner','INDIVIDUAL','ACTIVE') RETURNING id"
      )
    ).rows[0].id;
    const request = (
      await pool.query(
        "INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at) VALUES($1,'postal-owner',$2,'waiting_for_postal_submission','building_apartment','off_grid','villa','concrete','2020-01-01',true,'test-v1','Accepted terms',NOW()) RETURNING id",
        [profile, randomUUID()]
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO solar_construction_postal(request_id,status,courier,tracking_number,send_date) VALUES($1,'shipped','Parcel Co','LEGACY-123','2026-01-02')",
      [request]
    );
    const old = (await pool.query('SELECT * FROM solar_construction_postal')).rows[0],
      checksums = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: journal.entries
        .filter((e: { idx: number }) => e.idx >= 239)
        .map((e: { tag: string }) => e.tag),
    });
    const row = async () => (await pool!.query('SELECT * FROM solar_construction_postal')).rows[0];
    expect(await row()).toMatchObject({
      ...old,
      estimated_arrival_date: null,
      tracking_url: null,
      tracking_note: null,
      tracking_revision: 0,
      tracking_recorded_at: null,
    });
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        checksums.length
      )
    ).toEqual(checksums);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    const constraints = (
      await pool.query(
        "SELECT conname FROM pg_constraint WHERE conrelid='solar_construction_postal'::regclass"
      )
    ).rows.map((r) => r.conname);
    for (const check of getTableConfig(solarConstructionPostal).checks)
      expect(constraints).toContain(check.name);
    await expect(
      pool.query(
        "UPDATE solar_construction_postal SET estimated_arrival_date='2026-01-05',tracking_note='Unreviewed' WHERE request_id=$1",
        [request]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE solar_construction_postal SET tracking_revision=99 WHERE request_id=$1', [
        request,
      ])
    ).rejects.toMatchObject({ code: '23514' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('barghsa.solar_postal_tracking',$1,true)", [request]);
      await client.query(
        "UPDATE solar_construction_postal SET estimated_arrival_date='2026-01-05',tracking_note='Recorded update',tracking_url='https://courier.example.org/parcel',tracking_recorded_at='2000-01-01',tracking_revision=99 WHERE request_id=$1",
        [request]
      );
      await client.query('COMMIT');
      expect(await row()).toMatchObject({ tracking_revision: 1, tracking_note: 'Recorded update' });
      expect((await row()).tracking_recorded_at.getTime()).toBeGreaterThan(Date.now() - 60000);
      await client.query('BEGIN');
      await client.query("SELECT set_config('barghsa.solar_postal_tracking',$1,true)", [request]);
      await expect(
        client.query(
          "UPDATE solar_construction_postal SET estimated_arrival_date='2026-01-01' WHERE request_id=$1",
          [request]
        )
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT set_config('barghsa.solar_postal_tracking',$1,true)", [request]);
      await client.query(
        "UPDATE solar_construction_postal SET tracking_note='Rolled back' WHERE request_id=$1",
        [request]
      );
      await client.query('ROLLBACK');
      expect((await row()).tracking_revision).toBe(1);
    } finally {
      client.release();
    }
    await pool.query(
      "UPDATE solar_construction_postal SET status='not_received' WHERE request_id=$1",
      [request]
    );
    expect(await row()).toMatchObject({
      estimated_arrival_date: null,
      tracking_note: null,
      tracking_recorded_at: null,
      tracking_revision: 2,
    });
    await pool.query(
      "UPDATE solar_construction_postal SET status='shipped',tracking_number='RESEND-456' WHERE request_id=$1",
      [request]
    );
    expect(await row()).toMatchObject({
      estimated_arrival_date: null,
      tracking_url: null,
      tracking_note: null,
      tracking_recorded_at: null,
      tracking_revision: 3,
    });
    await expect(
      pool.query('UPDATE solar_construction_postal SET request_id=$1 WHERE request_id=$2', [
        randomUUID(),
        request,
      ])
    ).rejects.toMatchObject({ code: '23514' });
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
