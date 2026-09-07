import { Client } from 'pg';
import { expect, it, vi } from 'vitest';
import { wrapClientQuery } from './index.js';

it('cancels a running query without breaking its database connection', async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
    statement_timeout: 2000,
  });
  const errors: Error[] = [];
  client.on('error', (error) => errors.push(error));
  await client.connect();
  try {
    client.query = wrapClientQuery(client, 100);
    const start = performance.now();
    const result = await client.query('SELECT pg_sleep(1)').catch((error: unknown) => error);
    expect(result).toMatchObject({ code: '57014' });
    expect(performance.now() - start).toBeLessThan(800);
    expect((await client.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
    expect(errors).toEqual([]);
  } finally {
    await client.end();
  }
});

it('expires a queued query without cancelling the different running query', async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
    statement_timeout: 2000,
  });
  await client.connect();
  try {
    const running = client.query('SELECT pg_sleep(0.4), 17 AS answer');
    const wrapped = wrapClientQuery(client, 75);
    const queued = wrapped('SELECT 99 AS answer');
    await expect(queued).rejects.toMatchObject({ code: '57014' });
    expect((await running).rows[0].answer).toBe(17);
    expect((await client.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
  } finally {
    await client.end();
  }
});

it('cancels callback queries and delivers exactly one callback', async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
    statement_timeout: 2000,
  });
  await client.connect();
  let callbacks = 0;
  try {
    client.query = wrapClientQuery(client, 100);
    const failure = await new Promise<Error | null>((resolve) => {
      client.query('SELECT pg_sleep(1)', (error) => {
        callbacks++;
        resolve(error);
      });
    });
    expect(failure).toMatchObject({ code: '57014' });
    expect((await client.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
    expect(callbacks).toBe(1);
  } finally {
    await client.end();
  }
});

it('leaves a cancelled transaction abortable without committing its writes', async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
    statement_timeout: 2000,
  });
  await client.connect();
  try {
    await client.query('CREATE TEMP TABLE cancellation_writes(value integer)');
    client.query = wrapClientQuery(client, 100);
    await client.query('BEGIN');
    await client.query('INSERT INTO cancellation_writes VALUES (1)');
    await expect(client.query('SELECT pg_sleep(1)')).rejects.toMatchObject({ code: '57014' });
    await expect(client.query('SELECT 42')).rejects.toMatchObject({ code: '25P02' });
    await client.query('ROLLBACK');
    expect(
      (await client.query('SELECT count(*)::int AS count FROM cancellation_writes')).rows[0].count
    ).toBe(0);
  } finally {
    await client.end();
  }
});

for (const callback of [false, true]) {
  it(`emits structured production warnings for slow ${callback ? 'callback' : 'Promise'} queries`, async () => {
    const client = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
      statement_timeout: 2000,
    });
    await client.connect();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    try {
      client.query = wrapClientQuery(client, 1000);
      if (callback)
        await new Promise<void>((resolve, reject) => {
          client.query('SELECT pg_sleep(0.25)', (error) => (error ? reject(error) : resolve()));
        });
      else await client.query('SELECT pg_sleep(0.25)');
      const warnings = output.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(warnings).toContainEqual({
        level: 'warn',
        event: 'slow_query',
        query: 'SELECT pg_sleep(0.25)',
        durationMs: expect.any(Number),
      });
      expect(warnings.find((value) => value.event === 'slow_query').durationMs).toBeGreaterThan(
        200
      );
    } finally {
      vi.unstubAllEnvs();
      output.mockRestore();
      await client.end();
    }
  });
}
