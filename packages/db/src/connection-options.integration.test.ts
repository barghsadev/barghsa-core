import { Client } from 'pg';
import { expect, it } from 'vitest';
import { buildConnectionString } from './index.js';

for (const fragment of [false, true]) {
  it(`preserves startup options and enforces timeouts with fragment=${fragment}`, async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL test setup did not run');
    const source = new URL(process.env.TEST_DATABASE_URL);
    source.searchParams.set(
      'options',
      '-c search_path=pg_catalog -c application_name=audit-options -c statement_timeout=0'
    );
    if (fragment) source.hash = 'client-label';
    const client = new Client({
      connectionString: buildConnectionString(source.toString(), {
        statementTimeout: '250ms',
        lockTimeout: '100ms',
        idleTransactionTimeout: '2s',
      }),
    });
    await client.connect();
    try {
      const settings = await client.query(`SELECT
        current_setting('search_path') AS path,
        current_setting('application_name') AS application,
        current_setting('statement_timeout') AS statement,
        current_setting('lock_timeout') AS lock,
        current_setting('idle_in_transaction_session_timeout') AS idle`);
      expect(settings.rows).toEqual([
        {
          path: 'pg_catalog',
          application: 'audit-options',
          statement: '250ms',
          lock: '100ms',
          idle: '2s',
        },
      ]);
      await expect(client.query('SELECT pg_sleep(1)')).rejects.toMatchObject({ code: '57014' });
      expect((await client.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
    } finally {
      await client.end();
    }
  });
}

it('retains the last existing options value and unrelated encoded URL fields', () => {
  const source = new URL('postgresql://user:p%40ss@localhost:5432/test?sslmode=require#label');
  source.searchParams.append('options', '-c application_name=first');
  source.searchParams.append('options', '-c application_name=last');
  const result = new URL(buildConnectionString(source.toString(), {}));
  expect(result.username).toBe(source.username);
  expect(result.password).toBe(source.password);
  expect(result.hash).toBe('#label');
  expect(result.searchParams.get('sslmode')).toBe('require');
  expect(result.searchParams.getAll('options')).toEqual([
    '-c application_name=last -c statement_timeout=30s -c lock_timeout=5s -c idle_in_transaction_session_timeout=60s',
  ]);
});
