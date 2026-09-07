import { Client } from 'pg';
import { expect, it } from 'vitest';
import { createDirectDbPool, wrapClientQuery } from './index.js';

it('restores the write deadline for transaction completion after a read', async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const inspect = client.query.bind(client);
  try {
    client.query = wrapClientQuery(client, { read: 100, write: 1000 });
    await client.query('BEGIN');
    await client.query('SELECT 1');
    await client.query('COMMIT');
    expect((await inspect('SHOW statement_timeout')).rows[0].statement_timeout).toBe('1s');
  } finally {
    await client.end();
  }
});

it('applies 10-second read and 30-second write server defaults through the pool', async () => {
  const pool = createDirectDbPool(
    { pgdirectUrl: process.env.TEST_DATABASE_URL! },
    { shared: false }
  );
  const client = await pool.connect();
  try {
    await client.query('CREATE TEMP TABLE timeout_policy(value text)');
    // Concurrent submissions must keep SET/query pairs together on one client.
    const [read, write, cte, readCte] = await Promise.all([
      client.query("SELECT current_setting('statement_timeout') AS value"),
      client.query(
        "INSERT INTO timeout_policy VALUES(current_setting('statement_timeout')) RETURNING value"
      ),
      client.query(
        "WITH inserted AS (INSERT INTO timeout_policy VALUES(current_setting('statement_timeout')) RETURNING value) SELECT value FROM inserted"
      ),
      client.query(
        "/* comment */ WITH value AS (SELECT current_setting('statement_timeout') AS value) SELECT * FROM value"
      ),
    ]);
    expect(read.rows[0].value).toBe('10s');
    expect(write.rows[0].value).toBe('30s');
    expect(cte.rows[0].value).toBe('30s');
    expect(readCte.rows[0].value).toBe('10s');
  } finally {
    client.release();
    await pool.end();
  }
});

it('cancels reads at their shorter server deadline and allows a longer write', async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE TEMP TABLE timeout_policy(value integer)');
    client.query = wrapClientQuery(client, { read: 100, write: 1000 });
    await expect(client.query('SELECT pg_sleep(0.5)')).rejects.toMatchObject({ code: '57014' });
    await client.query('INSERT INTO timeout_policy SELECT 1 FROM pg_sleep(0.2)');
    expect((await client.query('TABLE timeout_policy')).rows).toEqual([{ value: 1 }]);
    await client.query('BEGIN');
    await expect(client.query('SELECT pg_sleep(0.5)')).rejects.toMatchObject({ code: '57014' });
    await client.query('/* recovery after cancellation */ ROLLBACK');
    expect((await client.query('SELECT 1 AS value')).rows).toEqual([{ value: 1 }]);
  } finally {
    await client.end();
  }
});

it('preserves explicit uniform server overrides and callback semantics', async () => {
  const pool = createDirectDbPool(
    {
      pgdirectUrl: process.env.TEST_DATABASE_URL!,
      statementTimeout: '2s',
    },
    { shared: false }
  );
  const client = await pool.connect();
  try {
    const value = await new Promise<string>((resolve, reject) => {
      client.query("SELECT current_setting('statement_timeout') AS value", (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0].value);
      });
    });
    expect(value).toBe('2s');
  } finally {
    client.release();
    await pool.end();
  }
});
