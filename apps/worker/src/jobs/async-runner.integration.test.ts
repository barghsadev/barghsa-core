import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from '@barghsa/db/test';
import { JobHandlerRegistry, runOneAsyncJob } from './async-runner.js';

let db: IsolatedTestDb;
beforeAll(async () => {
  db = await createIsolatedTestDb('test_async_', 4);
  await db.pool.query('CREATE TABLE users (user_id text PRIMARY KEY)');
  await db.pool.query("INSERT INTO users(user_id) VALUES ('owner')");
  const migration = readFileSync(
    resolve(__dirname, '../../../../packages/db/drizzle/production/0221_async_jobs.sql'),
    'utf8'
  ).replace('"public"."users"', '"users"');
  await db.pool.query(migration);
});
afterAll(async () => {
  await db?.pool.end();
  if (db) await dropTestSchema(db.schemaName);
});

it('claims a job once across competing workers, records progress, and completes with a safe URL', async () => {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'test-export','{"key":"value"}','owner')`,
    [id]
  );
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const registry = new JobHandlerRegistry();
  let calls = 0;
  registry.register('test-export', async (payload, context) => {
    calls += 1;
    expect(payload).toEqual({ key: 'value' });
    await context.setProgress(42);
    entered();
    await gate;
    return { resultUrl: '/account' };
  });
  const first = runOneAsyncJob(db.pool, registry);
  await started;
  expect(await runOneAsyncJob(db.pool, registry)).toBe(false);
  expect(
    (await db.pool.query('SELECT progress_pct FROM async_jobs WHERE id=$1', [id])).rows[0]
      .progress_pct
  ).toBe(42);
  release();
  expect(await first).toBe(true);
  expect(calls).toBe(1);
  expect(
    (
      await db.pool.query(
        'SELECT status,progress_pct,result_url,lease_token FROM async_jobs WHERE id=$1',
        [id]
      )
    ).rows[0]
  ).toMatchObject({
    status: 'completed',
    progress_pct: 100,
    result_url: '/account',
    lease_token: null,
  });
});

it('reclaims an expired lease and stores only a safe failure code', async () => {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by,status,attempts,lease_token,lease_until)
     VALUES ($1,'broken','{}','owner','processing',1,$2,now()-interval '1 minute')`,
    [id, randomUUID()]
  );
  const registry = new JobHandlerRegistry();
  registry.register('broken', async () => {
    throw new Error('private customer data');
  });
  expect(await runOneAsyncJob(db.pool, registry)).toBe(true);
  expect(
    (
      await db.pool.query(
        'SELECT status,attempts,error_message,lease_token FROM async_jobs WHERE id=$1',
        [id]
      )
    ).rows[0]
  ).toMatchObject({
    status: 'failed',
    attempts: 2,
    error_message: 'JOB_FAILED',
    lease_token: null,
  });
});

it('leaves jobs queued until a worker with their handler is deployed', async () => {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'future-export','{}','owner')`,
    [id]
  );
  expect(await runOneAsyncJob(db.pool, new JobHandlerRegistry())).toBe(false);
  expect(
    (await db.pool.query('SELECT status FROM async_jobs WHERE id=$1', [id])).rows[0].status
  ).toBe('queued');
});
