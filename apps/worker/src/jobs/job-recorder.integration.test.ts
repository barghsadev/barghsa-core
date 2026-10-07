import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db.js';
import { recordJobFailure, recordJobSuccess } from './job-recorder.js';

let database: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  database = await createMigratedTestDb();
}, 40000);
beforeEach(async () => {
  await database.pool.query('DELETE FROM background_jobs');
});
afterAll(async () => {
  await database?.close();
}, 15000);

it('dead-letters the first failure when its one-attempt budget is exhausted', async () => {
  await recordJobFailure(
    { jobType: 'storage_cleanup', error: 'Storage unavailable', maxAttempts: 1 },
    database.pool
  );
  const rows = (
    await database.pool.query(
      'SELECT status,attempts,max_attempts,next_run_at FROM background_jobs'
    )
  ).rows;
  expect(rows).toEqual([
    { status: 'dead_letter', attempts: 1, max_attempts: 1, next_run_at: null },
  ]);
});

it('preserves the default budget, concurrent increments, recovery history and a fresh later failure', async () => {
  const failure = () =>
    recordJobFailure(
      {
        jobType: 'storage_cleanup',
        error: 'postgres://worker:private-secret@db.example.test/main',
      },
      database.pool
    );
  await failure();
  const first = (await database.pool.query('SELECT * FROM background_jobs')).rows[0];
  expect(first).toMatchObject({ status: 'failed', attempts: 1, max_attempts: 5 });
  expect(first.next_run_at).toBeInstanceOf(Date);
  expect(first.error).not.toContain('private-secret');
  await Promise.all(Array.from({ length: 4 }, failure));
  expect(
    (await database.pool.query('SELECT id,status,attempts,next_run_at FROM background_jobs')).rows
  ).toEqual([{ id: first.id, status: 'dead_letter', attempts: 5, next_run_at: null }]);
  await recordJobSuccess('storage_cleanup', database.pool);
  const resolved = (await database.pool.query('SELECT * FROM background_jobs')).rows[0];
  expect(resolved).toMatchObject({
    id: first.id,
    status: 'resolved',
    attempts: 5,
    next_run_at: null,
  });
  expect(resolved.resolved_at).toBeInstanceOf(Date);
  await failure();
  const history = (
    await database.pool.query(
      'SELECT id,status,attempts,max_attempts FROM background_jobs ORDER BY created_at,id'
    )
  ).rows;
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({ id: first.id, status: 'resolved', attempts: 5 });
  expect(history[1]).toMatchObject({ status: 'failed', attempts: 1, max_attempts: 5 });
  expect(history[1].id).not.toBe(first.id);
});
