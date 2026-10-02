import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { runMigrations } from './migrate.js';
import { seedSolarConstruction } from './test/solar-construction-fixture.js';
import { solarConstructionProgressEvents } from './schema/solar-construction.js';
it('upgrades populated solar records without inventing progress, and enforces ordered immutable physical evidence', async () => {
  const production = resolve('drizzle/production'),
    previous = mkdtempSync(join(tmpdir(), 'solar-progress-upgrade-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 238),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const e of prior.entries)
    copyFileSync(join(production, e.tag + '.sql'), join(previous, e.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    database = 'test_solar_progress_' + randomUUID().replaceAll('-', '');
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
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('solar-owner','private-owner','test',false),('solar-staff','private-staff','test',true)"
    );
    const legacy = await seedSolarConstruction(pool, 'solar-owner', 'solar-staff');
    const oldRequests = (await pool.query('SELECT * FROM solar_construction_requests ORDER BY id'))
      .rows;
    const oldContracts = (await pool.query('SELECT * FROM contracts ORDER BY id')).rows;
    const oldChecksums = (
      await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')
    ).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: journal.entries
        .filter((e: { idx: number }) => e.idx >= 238)
        .map((e: { tag: string }) => e.tag),
    });
    expect(
      (await pool.query('SELECT * FROM solar_construction_requests ORDER BY id')).rows
    ).toEqual(oldRequests);
    expect((await pool.query('SELECT * FROM contracts ORDER BY id')).rows).toEqual(oldContracts);
    expect((await pool.query('SELECT * FROM solar_construction_progress_events')).rows).toEqual([]);
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        oldChecksums.length
      )
    ).toEqual(oldChecksums);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    const config = getTableConfig(solarConstructionProgressEvents);
    const constraints = (
      await pool.query('SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass', [
        config.name,
      ])
    ).rows.map((r) => r.conname);
    for (const check of config.checks) expect(constraints).toContain(check.name);
    for (const fk of config.foreignKeys) expect(constraints).toContain(fk.getName().slice(0, 63));
    const indexes = (
      await pool.query('SELECT indexname FROM pg_indexes WHERE tablename=$1', [config.name])
    ).rows.map((r) => r.indexname);
    for (const index of config.indexes) expect(indexes).toContain(index.config.name);
    const insert =
      "INSERT INTO solar_construction_progress_events(request_id,contract_id,stage,revision,operation_id,actor_user_id,note,review,recorded_at) VALUES($1,$2,$3,$4,$5,'solar-staff',$6,'{}','2000-01-01') RETURNING *";
    const params = (stage: string, revision: number, note = 'Physical work verified') => [
      legacy.request,
      legacy.contract,
      stage,
      revision,
      randomUUID(),
      note,
    ];
    await expect(pool.query(insert, params('installed', 3))).rejects.toMatchObject({
      code: '23514',
    });
    await expect(pool.query(insert, params('in_progress', 1, ' '))).rejects.toMatchObject({
      code: '23514',
    });
    const results = await Promise.allSettled([
      pool.query(insert, params('in_progress', 1)),
      pool.query(insert, params('in_progress', 1)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const first = (await pool.query('SELECT * FROM solar_construction_progress_events')).rows[0];
    expect(first.recorded_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await expect(
      pool.query("UPDATE solar_construction_progress_events SET note='Rewritten' WHERE id=$1", [
        first.id,
      ])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM solar_construction_progress_events WHERE id=$1', [first.id])
    ).rejects.toMatchObject({ code: '23514' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(insert, params('delivered', 2));
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (await pool.query('SELECT max(revision) AS n FROM solar_construction_progress_events'))
        .rows[0].n
    ).toBe(1);
    await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [legacy.profile]);
    await expect(pool.query(insert, params('delivered', 2))).rejects.toMatchObject({
      code: '23514',
    });
    await pool.query('UPDATE profiles SET archived=false WHERE id=$1', [legacy.profile]);
    await pool.query(insert, params('delivered', 2));
    await pool.query(insert, params('installed', 3));
    expect(
      (
        await pool.query('SELECT stage FROM solar_construction_progress_events ORDER BY revision')
      ).rows.map((r) => r.stage)
    ).toEqual(['in_progress', 'delivered', 'installed']);
    await pool.query(
      'UPDATE solar_construction_progress_events SET actor_user_id=NULL WHERE id=$1',
      [first.id]
    );
    expect(
      (
        await pool.query(
          'SELECT note,actor_user_id FROM solar_construction_progress_events WHERE id=$1',
          [first.id]
        )
      ).rows[0]
    ).toEqual({ note: first.note, actor_user_id: null });
    const unsigned = await seedSolarConstruction(pool, 'solar-owner', 'solar-staff', {
      activate: false,
    });
    await expect(
      pool.query(insert, [
        unsigned.request,
        unsigned.contract,
        'in_progress',
        1,
        randomUUID(),
        'Verified work',
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
