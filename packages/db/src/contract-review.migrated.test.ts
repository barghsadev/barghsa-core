import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { contractPublications, contractAcceptances } from './schema/contract-review';
let pool: Pool, management: Pool;
const database = 'contract_review_' + randomUUID().replaceAll('-', ''),
  user = randomUUID(),
  profile = randomUUID(),
  legacy = randomUUID(),
  legacyVersion = randomUUID();
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + database;
  pool = new Pool({ connectionString: url.toString() });
  const folder = mkdtempSync(join(tmpdir(), 'contract-review-upgrade-'));
  try {
    cpSync(resolve(__dirname, '../drizzle/production'), folder, { recursive: true });
    const file = join(folder, 'meta/_journal.json'),
      journal = JSON.parse(readFileSync(file, 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 139);
    writeFileSync(file, JSON.stringify(journal));
    expect(
      (
        await runMigrations({
          connection: { pgdirectUrl: url.toString() },
          migrationsFolder: folder,
        })
      ).ok
    ).toBe(true);
    await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      user,
    ]);
    await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'savings',$3)",
        [legacy, profile, legacyVersion]
      );
      await client.query(
        "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3,'Legacy',$4)",
        [legacyVersion, legacy, { legacy: true }, user]
      );
      await client.query("UPDATE contract_versions SET accepted_at='2026-09-01' WHERE id=$1", [
        legacyVersion,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 60000);
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}"`);
    await management.end();
  }
});
async function draft() {
  const id = randomUUID(),
    version = randomUUID(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'solar',$3)",
      [id, profile, version]
    );
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3,'Initial',$4)",
      [version, id, { terms: 'Test' }, user]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { id, version };
}
it('upgrades without inventing publication or customer identity for legacy timestamps', async () => {
  expect((await pool.query('SELECT * FROM contract_publications')).rows).toEqual([]);
  expect((await pool.query('SELECT * FROM contract_acceptances')).rows).toEqual([]);
  expect(
    (
      await pool.query('SELECT content,accepted_at FROM contract_versions WHERE id=$1', [
        legacyVersion,
      ])
    ).rows[0]
  ).toEqual({ content: { legacy: true }, accepted_at: new Date('2026-09-01T00:00:00Z') });
  for (const table of [contractPublications, contractAcceptances]) {
    const config = getTableConfig(table);
    expect(config.foreignKeys.map((f) => f.reference().foreignColumns.length).sort()).toEqual([
      1, 2,
    ]);
    expect(config.indexes).toHaveLength(1);
  }
});
it('atomically applies typed publication and acceptance evidence to the current version', async () => {
  const f = await draft();
  await pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [f.id]);
  await pool.query(
    'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
    [f.id, f.version, user]
  );
  const publication = (
    await drizzle(pool)
      .select()
      .from(contractPublications)
      .where(eq(contractPublications.versionId, f.version))
  )[0]!;
  expect(publication).toMatchObject({
    contractId: f.id,
    publishedBy: user,
    publishedAt: expect.any(Date),
  });
  expect((await pool.query('SELECT state FROM contracts WHERE id=$1', [f.id])).rows[0].state).toBe(
    'AwaitingCustomerAcceptance'
  );
  await pool.query(
    'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
    [f.id, f.version, user]
  );
  const acceptance = (
    await drizzle(pool)
      .select()
      .from(contractAcceptances)
      .where(eq(contractAcceptances.versionId, f.version))
  )[0]!;
  expect(acceptance).toMatchObject({
    contractId: f.id,
    acceptedBy: user,
    acceptedAt: expect.any(Date),
  });
  const row = (
    await pool.query(
      'SELECT c.state,c.accepted_at,v.accepted_at AS version_accepted_at FROM contracts c JOIN contract_versions v ON v.id=c.current_version_id WHERE c.id=$1',
      [f.id]
    )
  ).rows[0];
  expect(row).toEqual({
    state: 'Accepted',
    accepted_at: acceptance.acceptedAt,
    version_accepted_at: acceptance.acceptedAt,
  });
});
it('rejects missing and cross-contract version evidence', async () => {
  const a = await draft(),
    b = await draft();
  await pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [a.id]);
  for (const [id, version] of [
    [randomUUID(), a.version],
    [a.id, b.version],
  ]) {
    await expect(
      pool.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [id, version, user]
      )
    ).rejects.toMatchObject({ code: '23514' });
  }
});
it('cannot commit a customer-visible state without publication or acceptance evidence', async () => {
  const f = await draft();
  for (const state of ['AwaitingCustomerAcceptance', 'Accepted'])
    await expect(
      pool.query('UPDATE contracts SET state=$2 WHERE id=$1', [f.id, state])
    ).rejects.toMatchObject({ code: '23514' });
});
it('rolls back publication when a surrounding transaction fails', async () => {
  const f = await draft();
  await pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [f.id]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
      [f.id, f.version, user]
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  expect((await pool.query('SELECT state FROM contracts WHERE id=$1', [f.id])).rows[0].state).toBe(
    'AwaitingStaffReview'
  );
  expect(
    (await pool.query('SELECT * FROM contract_publications WHERE contract_id=$1', [f.id])).rows
  ).toEqual([]);
});
