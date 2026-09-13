import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Client, type Pool } from 'pg';
import {
  Network,
  GenericContainer,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { DbPoolConfig } from './index.js';

let network: StartedNetwork;
let postgres: StartedPostgreSqlContainer;
let bouncer: StartedTestContainer;
let url: string;
const pools: Pool[] = [];

beforeAll(async () => {
  network = await new Network().start();
  postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withNetwork(network)
    .withNetworkAliases('database')
    .start();
  bouncer = await new GenericContainer('bitnamilegacy/pgbouncer:1.23.1')
    .withNetwork(network)
    .withExposedPorts(6432)
    .withEnvironment({
      POSTGRESQL_HOST: 'database',
      POSTGRESQL_PORT: '5432',
      POSTGRESQL_DATABASE: postgres.getDatabase(),
      POSTGRESQL_USERNAME: postgres.getUsername(),
      POSTGRESQL_PASSWORD: postgres.getPassword(),
      PGBOUNCER_DATABASE: postgres.getDatabase(),
      PGBOUNCER_PORT: '6432',
      PGBOUNCER_POOL_MODE: 'transaction',
      PGBOUNCER_DEFAULT_POOL_SIZE: '1',
      PGBOUNCER_RESERVE_POOL_SIZE: '0',
    })
    .withWaitStrategy(Wait.forLogMessage(/process up: PgBouncer/))
    .start();
  const address = new URL(postgres.getConnectionUri());
  address.hostname = bouncer.getHost();
  address.port = String(bouncer.getMappedPort(6432));
  url = address.toString();
}, 60_000);
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});
afterAll(async () => {
  await bouncer?.stop();
  await postgres?.stop();
  await network?.stop();
});
async function pool(config: DbPoolConfig = {}) {
  vi.resetModules();
  const { createDbPool } = await import('./index.js');
  const result = createDbPool({ pgbouncerUrl: url, poolMax: 3, ...config });
  pools.push(result);
  return result;
}

it('applies read/write defaults without leaking settings across pooled transactions', async () => {
  const db = await pool();
  await db.query('CREATE TABLE pooled_deadlines(value text)');
  const [read, write, cte] = await Promise.all([
    db.query("SELECT current_setting('statement_timeout') AS value"),
    db.query(
      "INSERT INTO pooled_deadlines VALUES(current_setting('statement_timeout')) RETURNING value"
    ),
    db.query(
      "WITH saved AS (INSERT INTO pooled_deadlines VALUES(current_setting('statement_timeout')) RETURNING value) SELECT value FROM saved"
    ),
  ]);
  expect(read.rows[0].value).toBe('10s');
  expect(write.rows[0].value).toBe('30s');
  expect(cte.rows[0].value).toBe('30s');
  const raw = new Client({ connectionString: url });
  await raw.connect();
  try {
    expect((await raw.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('0');
  } finally {
    await raw.end();
  }
});

it('times out reads, permits longer writes and preserves explicit rollback', async () => {
  const db = await pool({ readTimeoutMs: 100, writeTimeoutMs: 1000 });
  await db.query('CREATE TABLE pooled_atomic(value integer)');
  await expect(db.query('SELECT pg_sleep(0.3)')).rejects.toMatchObject({ code: '57014' });
  await db.query('INSERT INTO pooled_atomic SELECT 1 FROM pg_sleep(0.2)');
  const client = await db.connect();
  try {
    await client.query('/* explicit transaction */ BEGIN');
    await client.query('INSERT INTO pooled_atomic VALUES(2)');
    await expect(client.query('SELECT pg_sleep(0.3)')).rejects.toMatchObject({ code: '57014' });
    await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' });
    await client.query('/* recovery */ ROLLBACK');
    expect((await client.query('TABLE pooled_atomic')).rows).toEqual([{ value: 1 }]);
  } finally {
    client.release();
  }
});

it('preserves callbacks, query configs and explicit uniform settings', async () => {
  const db = await pool({
    statementTimeout: '200ms',
    queryTimeout: 0,
    lockTimeout: '50ms',
    idleTransactionTimeout: '2s',
  });
  const result = await new Promise((resolve, reject) => {
    db.query(
      {
        text: "SELECT $1::int, current_setting('statement_timeout'), current_setting('lock_timeout'), current_setting('idle_in_transaction_session_timeout')",
        values: [7],
        rowMode: 'array',
      },
      (error, value) => (error ? reject(error) : resolve(value.rows))
    );
  });
  expect(result).toEqual([[7, '200ms', '50ms', '2s']]);
  await expect(db.query('SELECT pg_sleep(0.4)')).rejects.toMatchObject({ code: '57014' });
  expect((await db.query('SELECT 1 AS value')).rows).toEqual([{ value: 1 }]);
});

it('expires queued reads without executing their side effects', async () => {
  const db = await pool({ readTimeoutMs: 100, writeTimeoutMs: 1000 });
  await db.query('CREATE SEQUENCE pooled_queue_effect');
  await db.query('CREATE TABLE pooled_queue_write(value integer)');
  const client = await db.connect();
  try {
    const write = client.query('INSERT INTO pooled_queue_write SELECT 3 FROM pg_sleep(0.4)');
    const queued = client.query("SELECT setval('pooled_queue_effect', 123)");
    await expect(queued).rejects.toMatchObject({ code: '57014' });
    await write;
    expect(
      (await client.query('SELECT last_value FROM pooled_queue_effect')).rows[0].last_value
    ).toBe('1');
  } finally {
    client.release();
  }
});

it('rejects unsupported caller startup options instead of silently ignoring them', async () => {
  await expect(pool({ pgbouncerUrl: url + '?options=-c%20search_path%3Dprivate' })).rejects.toThrow(
    /startup options/
  );
});

it('keeps session locks on direct connections across transactions', async () => {
  const db = await pool({ pgdirectUrl: postgres.getConnectionUri() });
  const { getDbPool } = await import('./index.js');
  const direct = getDbPool({ session: true });
  pools.push(direct);
  expect(direct).not.toBe(db);
  const owner = await direct.connect();
  try {
    await owner.query('SELECT pg_advisory_lock(924731)');
    for (let index = 0; index < 2; index++) {
      await owner.query('BEGIN');
      await owner.query('SELECT 1');
      await owner.query('COMMIT');
      expect(
        (await db.query('SELECT pg_try_advisory_lock(924731) AS acquired')).rows[0].acquired
      ).toBe(false);
    }
  } finally {
    await owner.query('SELECT pg_advisory_unlock_all()');
    owner.release();
  }
});

it('attempts direct-pool shutdown even when main-pool shutdown fails', async () => {
  const db = await pool({ pgdirectUrl: postgres.getConnectionUri() });
  const { getDbPool, closeDbPools } = await import('./index.js');
  const direct = getDbPool({ session: true });
  await direct.query('SELECT 1');
  const end = vi.spyOn(db, 'end').mockRejectedValueOnce(new Error('main close failed'));
  await expect(closeDbPools()).rejects.toThrow('Database pool close failed');
  expect(direct.ended).toBe(true);
  end.mockRestore();
});

it('bounds waiting for a backend and recovers with a new connection', async () => {
  const db = await pool({ connectionTimeoutMillis: 200 });
  const owner = await db.connect();
  try {
    await owner.query('BEGIN');
    const started = Date.now();
    await expect(db.query('SELECT 1')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
    await owner.query('ROLLBACK');
    expect((await db.query('SELECT 2 AS value')).rows[0].value).toBe(2);
  } finally {
    owner.release();
  }
});

it('rejects mixed transaction batches before their first write', async () => {
  const db = await pool();
  await db.query('CREATE TABLE pooled_mixed(value integer)');
  await expect(db.query('INSERT INTO pooled_mixed VALUES(1); COMMIT; SELECT 1')).rejects.toThrow(
    /separately/
  );
  expect((await db.query('TABLE pooled_mixed')).rows).toEqual([]);
});

it('preserves transaction-local settings when COMMIT starts another transaction', async () => {
  const db = await pool({ lockTimeout: '70ms', idleTransactionTimeout: '2s' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1');
    await client.query('COMMIT AND CHAIN');
    expect(
      (await client.query("SELECT current_setting('lock_timeout') AS value")).rows[0].value
    ).toBe('70ms');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

it('refuses session operations without a configured direct destination', async () => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PGDIRECT_URL', '');
  try {
    await pool();
    const { getDbPool } = await import('./index.js');
    expect(() => getDbPool({ session: true })).toThrow(/require PGDIRECT_URL/);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('gives COMMIT its write budget rather than the backend acquisition timeout', async () => {
  const db = await pool({ connectionTimeoutMillis: 300, readTimeoutMs: 100, writeTimeoutMs: 2000 });
  await db.query(`
    CREATE TABLE pooled_commit(value integer);
    CREATE FUNCTION pooled_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.6); RETURN NEW; END; $$;
    CREATE CONSTRAINT TRIGGER pooled_commit_delay AFTER INSERT ON pooled_commit
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pooled_commit_delay();
  `);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO pooled_commit VALUES(1)');
    await client.query('SELECT 1');
    await client.query('COMMIT');
    expect((await client.query('TABLE pooled_commit')).rows).toEqual([{ value: 1 }]);
  } finally {
    client.release();
  }
});
