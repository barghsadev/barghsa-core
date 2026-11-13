import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from '@barghsa/db/test';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';
import { currentTraceparent, operatorLogTrace } from '@barghsa/shared/operator-logging';
import { JobHandlerRegistry, PROFILE_EXPORT_JOB_TYPE, runOneAsyncJob } from './async-runner.js';

let db: IsolatedTestDb;
const legacyId = randomUUID();
beforeAll(async () => {
  db = await createIsolatedTestDb('test_async_', 4);
  await db.pool.query('CREATE TABLE users (user_id text PRIMARY KEY)');
  await db.pool.query("INSERT INTO users(user_id) VALUES ('owner')");
  const migration = readFileSync(
    resolve(__dirname, '../../../../packages/db/drizzle/production/0221_async_jobs.sql'),
    'utf8'
  ).replace('"public"."users"', '"users"');
  await db.pool.query(migration);
  await db.pool.query(
    "INSERT INTO async_jobs(id,type,payload,created_by) VALUES($1,'trace-legacy','{}','owner')",
    [legacyId]
  );
  await db.pool.query(
    readFileSync(
      resolve(
        __dirname,
        '../../../../packages/db/drizzle/production/0295_async_job_trace_parent.sql'
      ),
      'utf8'
    )
  );
});
afterAll(async () => {
  await db?.pool.end();
  if (db) await dropTestSchema(db.schemaName);
});

it('keeps queued jobs compatible with the trace migration and restores the exact parent per claim', async () => {
  const traceId = '11'.repeat(16),
    parentId = '22'.repeat(8),
    spanId = '33'.repeat(8);
  const parent = `00-${traceId}-${parentId}-01`;
  const tracedId = randomUUID();
  const insert = (id: string, value: string) =>
    db.pool.query(
      "INSERT INTO async_jobs(id,type,payload,created_by,trace_parent) VALUES($1,'trace-test','{}','owner',$2)",
      [id, value]
    );
  await expect(insert(randomUUID(), `00-${'0'.repeat(32)}-${parentId}-01`)).rejects.toMatchObject({
    code: '23514',
  });
  await expect(insert(randomUUID(), 'invalid')).rejects.toMatchObject({ code: '23514' });
  await insert(tracedId, parent);
  await expect(
    db.pool.query('UPDATE async_jobs SET trace_parent=NULL WHERE id=$1', [tracedId])
  ).rejects.toMatchObject({ code: '23514' });
  const spanContext = { traceId, spanId, traceFlags: 1 };
  const statuses: number[] = [];
  const parents: unknown[] = [];
  const observed: (string | null)[] = [];
  let ended = 0;
  const tracer = {
    startSpan(name, options, context = ROOT_CONTEXT) {
      expect(name).toBe('async.job.process');
      expect(options).toEqual({ kind: SpanKind.CONSUMER });
      parents.push(trace.getSpanContext(context));
      return {
        spanContext: () => spanContext,
        setStatus: ({ code }: { code: number }) => statuses.push(code),
        end: () => ended++,
      } as unknown as ReturnType<Tracer['startSpan']>;
    },
  } satisfies Pick<Tracer, 'startSpan'>;
  const registry = new JobHandlerRegistry();
  registry.register('trace-test', async () => {
    await Promise.resolve();
    observed.push(currentTraceparent());
    throw new Error('Private handler failure');
  });
  registry.register('trace-legacy', async () => undefined);
  await operatorLogTrace.run({ traceId: '44'.repeat(16), spanId, traceFlags: 1 }, async () => {
    expect(await runOneAsyncJob(db.pool, registry, tracer as Tracer)).toBe(true);
    expect(await runOneAsyncJob(db.pool, registry, tracer as Tracer)).toBe(true);
    expect(currentTraceparent()).toBe(`00-${'44'.repeat(16)}-${spanId}-01`);
  });
  expect(parents).toEqual([
    undefined,
    { traceId, spanId: parentId, traceFlags: 1, isRemote: true },
  ]);
  expect(observed).toEqual([`00-${traceId}-${spanId}-01`]);
  expect(statuses).toEqual([SpanStatusCode.ERROR]);
  expect(ended).toBe(2);
  expect(
    (
      await db.pool.query('SELECT trace_parent,status,error_message FROM async_jobs WHERE id=$1', [
        tracedId,
      ])
    ).rows[0]
  ).toEqual({ trace_parent: parent, status: 'failed', error_message: 'JOB_FAILED' });
  expect(
    (await db.pool.query('SELECT trace_parent,status FROM async_jobs WHERE id=$1', [legacyId]))
      .rows[0]
  ).toEqual({ trace_parent: null, status: 'completed' });
});

it.each(['/\\outside.test', '/%5coutside.test', '/%255coutside.test'])(
  'refuses a handler result that escapes the application: %s',
  async (resultUrl) => {
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'unsafe-link','{}','owner')",
      [id]
    );
    const registry = new JobHandlerRegistry();
    registry.register('unsafe-link', async () => ({ resultUrl }));
    expect(await runOneAsyncJob(db.pool, registry)).toBe(true);
    expect(
      (
        await db.pool.query('SELECT status,result_url,error_message FROM async_jobs WHERE id=$1', [
          id,
        ])
      ).rows[0]
    ).toMatchObject({ status: 'failed', result_url: null, error_message: 'JOB_FAILED' });
  }
);

it('does not complete an expired lease before a successor has reclaimed it', async () => {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'expired-owner','{}','owner')",
    [id]
  );
  const registry = new JobHandlerRegistry();
  registry.register('expired-owner', async () => {
    await db.pool.query("UPDATE async_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [
      id,
    ]);
    return { resultUrl: '/account' };
  });
  expect(await runOneAsyncJob(db.pool, registry)).toBe(true);
  expect(
    (await db.pool.query('SELECT status,result_url,lease_token FROM async_jobs WHERE id=$1', [id]))
      .rows[0]
  ).toMatchObject({ status: 'processing', result_url: null, lease_token: expect.any(String) });
});

it.each(['progress', 'failure'] as const)(
  'leaves an expired lease available for recovery after stale %s',
  async (action) => {
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'stale-owner','{}','owner')",
      [id]
    );
    const registry = new JobHandlerRegistry();
    registry.register('stale-owner', async (_payload, context) => {
      await db.pool.query(
        "UPDATE async_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [id]
      );
      if (action === 'progress')
        await expect(context.setProgress(42)).rejects.toThrow('lease lost');
      else throw new Error('private stale exception');
    });
    expect(await runOneAsyncJob(db.pool, registry)).toBe(true);
    expect(
      (
        await db.pool.query(
          'SELECT status,progress_pct,result_url,error_message,lease_token FROM async_jobs WHERE id=$1',
          [id]
        )
      ).rows[0]
    ).toMatchObject({
      status: 'processing',
      progress_pct: 0,
      result_url: null,
      error_message: null,
      lease_token: expect.any(String),
    });
    const successor = new JobHandlerRegistry();
    successor.register('stale-owner', async () => ({ resultUrl: '/account' }));
    expect(await runOneAsyncJob(db.pool, successor)).toBe(true);
    expect(
      (await db.pool.query('SELECT status,attempts,result_url FROM async_jobs WHERE id=$1', [id]))
        .rows[0]
    ).toMatchObject({ status: 'completed', attempts: 2, result_url: '/account' });
  }
);

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

it('caps profile exports across workers without blocking other jobs or expired-lease recovery', async () => {
  const live = randomUUID();
  const queued = [randomUUID(), randomUUID()];
  const other = randomUUID();
  await db.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by,status,attempts,lease_token,lease_until)
     VALUES ($1,$2,'{}','owner','processing',1,$3,now()+interval '2 minutes')`,
    [live, PROFILE_EXPORT_JOB_TYPE, randomUUID()]
  );
  await db.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by)
     SELECT id,$2,'{}','owner' FROM unnest($1::uuid[]) AS id`,
    [queued, PROFILE_EXPORT_JOB_TYPE]
  );
  await db.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'independent','{}','owner')`,
    [other]
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
  registry.register(PROFILE_EXPORT_JOB_TYPE, async () => {
    entered();
    await gate;
    return { resultUrl: '/account' };
  });
  const claims = [runOneAsyncJob(db.pool, registry), runOneAsyncJob(db.pool, registry)];
  try {
    expect(await Promise.race(claims)).toBe(false);
    await started;
    const mixed = new JobHandlerRegistry();
    mixed.register(PROFILE_EXPORT_JOB_TYPE, async () => {
      throw new Error('Export unexpectedly admitted');
    });
    mixed.register('independent', async () => ({ resultUrl: '/account' }));
    expect(await runOneAsyncJob(db.pool, mixed)).toBe(true);
    expect(
      (
        await db.pool.query(
          'SELECT status,attempts FROM async_jobs WHERE id=ANY($1::uuid[]) ORDER BY status',
          [queued]
        )
      ).rows
    ).toEqual([
      { status: 'processing', attempts: 1 },
      { status: 'queued', attempts: 0 },
    ]);
    expect(
      (await db.pool.query('SELECT status FROM async_jobs WHERE id=$1', [other])).rows
    ).toEqual([{ status: 'completed' }]);
  } finally {
    release();
    await Promise.allSettled(claims);
  }
  expect((await Promise.all(claims)).sort()).toEqual([false, true]);
  expect(await runOneAsyncJob(db.pool, registry)).toBe(true);
  await db.pool.query("UPDATE async_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [
    live,
  ]);
  expect(await runOneAsyncJob(db.pool, registry)).toBe(true);
  expect(
    (await db.pool.query('SELECT status,attempts FROM async_jobs WHERE id=$1', [live])).rows
  ).toEqual([{ status: 'completed', attempts: 2 }]);
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
