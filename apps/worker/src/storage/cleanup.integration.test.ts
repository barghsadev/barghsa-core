import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import type { StorageProvider } from '@barghsa/shared/storage';
import { runMigrations } from '../../../../packages/db/src/migrate';
import { cleanupStorageObjects } from './cleanup.js';
let pool: Pool, management: Pool;
const database = `test_cleanup_${randomUUID().replaceAll('-', '')}`;
const deleteObject = vi.fn(async (_key: string) => {});
const storage = { deleteObject } as unknown as StorageProvider;
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  if (!migration.ok) throw new Error(JSON.stringify(migration));
  pool = new Pool({ connectionString: url.toString() });
}, 40000);
afterAll(async () => {
  await pool?.end();
  await management.query(`DROP DATABASE "${database}"`);
  await management.end();
});
beforeEach(async () => {
  await pool.query('DELETE FROM storage_records');
  deleteObject.mockReset();
});
async function seed(key: string, status = 'removed', requested = true, signed = false, old = true) {
  await pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,signed_at,updated_at) VALUES ($1,$2,jsonb_build_object('deletionRequested',$3::boolean),CASE WHEN $4 THEN NOW() ELSE NULL END,CASE WHEN $5 THEN NOW()-INTERVAL '2 minutes' ELSE NOW() END)`,
    [key, status, requested, signed, old]
  );
}
async function pending(key: string) {
  return (await pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [key]))
    .rows[0].metadata.deletionRequested;
}
it('deletes only due explicit unsigned removal requests and preserves their history', async () => {
  await seed('eligible');
  await seed('active', 'active');
  await seed('immutable', 'immutable');
  await seed('signed', 'removed', true, true);
  await seed('legacy', 'removed', false);
  await seed('fresh', 'removed', true, false, false);
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 1, failed: 0 });
  expect(deleteObject.mock.calls).toEqual([['eligible']]);
  expect(await pending('eligible')).toBe(false);
  expect((await pool.query('SELECT * FROM storage_records')).rows).toHaveLength(6);
});
it('backs off transport failure and succeeds on a later retry', async () => {
  await seed('retry');
  deleteObject.mockRejectedValueOnce(new Error('provider unavailable'));
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 0, failed: 1 });
  expect(await pending('retry')).toBe(true);
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 0, failed: 0 });
  await pool.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 1, failed: 0 });
});
it('serializes simultaneous workers without duplicate deletion', async () => {
  await seed('parallel');
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  deleteObject.mockImplementationOnce(async () => {
    entered();
    await gate;
  });
  const first = cleanupStorageObjects(pool, storage);
  await started;
  try {
    expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 0, failed: 0 });
  } finally {
    release();
  }
  expect(await first).toEqual({ deleted: 1, failed: 0 });
  expect(deleteObject).toHaveBeenCalledTimes(1);
});
it('keeps a durable request when database completion fails after object deletion', async () => {
  await seed('commit-failure');
  await pool.query(
    "CREATE FUNCTION reject_cleanup_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->>'deletionRequested'='false' THEN RAISE EXCEPTION 'test completion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cleanup_completion BEFORE UPDATE ON storage_records FOR EACH ROW EXECUTE FUNCTION reject_cleanup_completion()"
  );
  try {
    expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 0, failed: 1 });
    expect(await pending('commit-failure')).toBe(true);
  } finally {
    await pool.query('DROP TRIGGER reject_cleanup_completion ON storage_records');
  }
  await pool.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 1, failed: 0 });
  expect(deleteObject).toHaveBeenCalledTimes(2);
});
it('reports missing provider only when there is eligible work', async () => {
  expect(await cleanupStorageObjects(pool, null)).toEqual({ deleted: 0, failed: 0 });
  await seed('no-provider');
  await expect(cleanupStorageObjects(pool, null)).rejects.toThrow('without an available provider');
  expect(await pending('no-provider')).toBe(true);
});

it('waits beyond the one-hour browser upload URL before deleting a removed upload', async () => {
  await seed('uploads/document/pending.pdf');
  await pool.query('UPDATE storage_records SET removed_at=NOW()');
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 0, failed: 0 });
  await pool.query("UPDATE storage_records SET removed_at=NOW()-INTERVAL '66 minutes'");
  expect(await cleanupStorageObjects(pool, storage)).toEqual({ deleted: 1, failed: 0 });
});
