import { cancelEmptyContract } from './test/cancel-empty-contract';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contracts, contractVersions } from './index';
import { createMigratedTestDb } from './test/migrated-db';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
let user: string, profile: string;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  user = randomUUID();
  profile = randomUUID();
  await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,$1)', [
    user,
  ]);
  await fixture.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});
async function transaction(work: (client: PoolClient) => Promise<void>) {
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function create(service = 'electricity') {
  const id = randomUUID(),
    version = randomUUID();
  await transaction(async (client) => {
    await client.query(
      'INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,$4,$3)',
      [id, profile, version, service]
    );
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3,'Initial',$4)",
      [version, id, { price: '100' }, user]
    );
  });
  return { id, version };
}
async function append(id: string, number: number, content = { price: '200' }, advance = true) {
  const version = randomUUID();
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,$3,$4,'Edit',$5)",
      [version, id, number, content, user]
    );
    if (advance)
      await client.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [id, version]);
  });
  return version;
}
it('commits a circular initial reference and reads complete typed immutable snapshots', async () => {
  const contractConfig = getTableConfig(contracts),
    versionConfig = getTableConfig(contractVersions);
  expect(contractConfig.foreignKeys.map((f) => f.reference().foreignTable)).toHaveLength(2);
  expect(versionConfig.foreignKeys.map((f) => f.reference().foreignTable)).toHaveLength(2);
  expect(contractConfig.indexes.map((i) => i.config.name)).toEqual([
    'contracts_profile_created_idx',
    'contracts_order_idx',
    'contracts_state_idx',
  ]);
  expect(versionConfig.checks.map((c) => c.name)).toEqual([
    'contract_versions_positive',
    'contract_versions_object',
    'contract_versions_description',
  ]);
  const row = await create();
  const second = await append(row.id, 2);
  const record = (await fixture.db.select().from(contracts).where(eq(contracts.id, row.id)))[0]!;
  expect(record).toMatchObject({
    profileId: profile,
    currentVersionId: second,
    state: 'Draft',
    serviceType: 'electricity',
    acceptedAt: null,
  });
  expect(record.createdAt).toBeInstanceOf(Date);
  const versions = await fixture.db
    .select()
    .from(contractVersions)
    .where(eq(contractVersions.contractId, row.id));
  expect(versions.map((v) => v.content)).toEqual([{ price: '100' }, { price: '200' }]);
  expect(versions[0]).toMatchObject({
    createdBy: user,
    changeDescription: 'Initial',
    acceptedAt: null,
  });
});
it('rejects a contract without its initial version at commit', async () => {
  await expect(
    fixture.pool.query(
      "INSERT INTO contracts(profile_id,service_type,current_version_id) VALUES($1,'solar',$2)",
      [profile, randomUUID()]
    )
  ).rejects.toMatchObject({ code: expect.stringMatching(/23503|23514/) });
});
it('requires a new version and current pointer to commit together', async () => {
  const row = await create();
  await expect(append(row.id, 2, { price: '200' }, false)).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await fixture.pool.query('SELECT count(*) FROM contract_versions WHERE contract_id=$1', [
        row.id,
      ])
    ).rows[0].count
  ).toBe('1');
});
it('forbids version rollback and cross-contract pointers', async () => {
  const a = await create(),
    b = await create();
  await append(a.id, 2);
  for (const version of [a.version, b.version])
    await expect(
      fixture.pool.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [a.id, version])
    ).rejects.toMatchObject({ code: expect.stringMatching(/23503|23514/) });
});
it.each([0, 1, 3])('rejects nonsequential version number %s', async (number) => {
  const row = await create();
  await expect(append(row.id, number)).rejects.toMatchObject({ code: '23514' });
});
it('rejects unchanged material content and empty snapshots', async () => {
  const row = await create();
  await expect(append(row.id, 2, { price: '100' })).rejects.toMatchObject({ code: '23514' });
  await expect(append(row.id, 2, {} as { price: string })).rejects.toMatchObject({ code: '23514' });
});
it.each([
  "content='{}'",
  "change_description='rewritten'",
  "created_by='another'",
  'version_number=2',
  "created_at=NOW()+INTERVAL '1 day'",
])('preserves version history against %s', async (assignment) => {
  const row = await create();
  await expect(
    fixture.pool.query(`UPDATE contract_versions SET ${assignment} WHERE id=$1`, [row.version])
  ).rejects.toMatchObject({ code: '23514' });
});
it('retains acceptance evidence once recorded', async () => {
  const row = await create();
  await fixture.pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [
    row.id,
  ]);
  await fixture.pool.query(
    'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
    [row.id, row.version, user]
  );
  await fixture.pool.query(
    'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
    [row.id, row.version, user]
  );
  await expect(
    fixture.pool.query('UPDATE contract_versions SET accepted_at=NULL WHERE id=$1', [row.version])
  ).rejects.toMatchObject({ code: '23514' });
});
it.each(['Completed', 'Cancelled'])(
  'prevents reopening or versioning %s contracts',
  async (state) => {
    const row = await create('savings');
    if (state === 'Completed') {
      await fixture.pool.query(
        "UPDATE contract_activation_requirements SET service_ends_at='2000-01-01T00:00:00Z' WHERE version_id=$1",
        [row.version]
      );
      await fixture.pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [
        row.id,
      ]);
      await fixture.pool.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [row.id, row.version, user]
      );
      await fixture.pool.query(
        'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
        [row.id, row.version, user]
      );
      await fixture.pool.query(
        'INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)',
        [row.id, row.version]
      );
      await fixture.pool.query(
        'INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2)',
        [row.id, row.version]
      );
    } else await cancelEmptyContract(fixture.pool, row.id, user);
    await expect(
      fixture.pool.query("UPDATE contracts SET state='Draft' WHERE id=$1", [row.id])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(append(row.id, 2)).rejects.toMatchObject({ code: '23514' });
  }
);
it('forbids deleting contracts and snapshots', async () => {
  const row = await create();
  await expect(
    fixture.pool.query('DELETE FROM contract_versions WHERE id=$1', [row.version])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM contracts WHERE id=$1', [row.id])
  ).rejects.toMatchObject({ code: '23514' });
});
it('allows only one concurrent next version', async () => {
  const row = await create();
  const results = await Promise.allSettled([
    append(row.id, 2, { price: '200' }),
    append(row.id, 2, { price: '300' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    (
      await fixture.pool.query('SELECT count(*) FROM contract_versions WHERE contract_id=$1', [
        row.id,
      ])
    ).rows[0].count
  ).toBe('2');
});

it('upgrades migration 137 without changing existing profiles or opaque invoice contract references', async () => {
  const name = 'contract_upgrade_' + randomUUID().replaceAll('-', '');
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  const folder = mkdtempSync(join(tmpdir(), 'contract-upgrade-'));
  let pool: Pool | undefined;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    pool = new Pool({ connectionString: url.toString() });
    cpSync(resolve(__dirname, '../drizzle/production'), folder, { recursive: true });
    const path = join(folder, 'meta/_journal.json'),
      journal = JSON.parse(readFileSync(path, 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 138);
    writeFileSync(path, JSON.stringify(journal));
    expect(
      (
        await runMigrations({
          connection: { pgdirectUrl: url.toString() },
          migrationsFolder: folder,
        })
      ).ok
    ).toBe(true);
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('legacy','legacy','test')"
    );
    await pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'legacy')", [profile]);
    await pool.query(
      "INSERT INTO invoices(profile_id,contract_id,total_amount) VALUES($1,'contract-001',100)",
      [profile]
    );
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
    expect((await pool.query('SELECT contract_id FROM invoices')).rows).toEqual([
      { contract_id: 'contract-001' },
    ]);
    expect((await pool.query('SELECT id FROM profiles')).rows).toEqual([{ id: profile }]);
    expect((await pool.query('SELECT * FROM contracts')).rows).toEqual([]);
  } finally {
    await pool?.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}"`);
    await management.end();
    rmSync(folder, { recursive: true, force: true });
  }
}, 60_000);
