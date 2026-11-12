import { randomUUID } from 'node:crypto';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { wrapClientQuery } from './index';
import { wrapTransactionPoolClient } from './transaction-pool';
import { runMigrationPrefix } from './test/migration-prefix';
import { postWalletCredit } from './wallet-credit';

const database = `test_outbox_trace_${randomUUID().replaceAll('-', '')}`;
const user = 'outbox-trace-fixture';
const context = {
  traceId: 'a11a11a11a11a11a11a11a11a11a11a1',
  spanId: 'b22b22b22b22b22b',
  traceFlags: 1,
};
const traceparent = `00-${context.traceId}-${context.spanId}-01`;
let management: Pool;
let pool: Pool;
let pgdirectUrl: string;
let oldNoticeId: string;

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  pgdirectUrl = url.toString();
  const connection = { pgdirectUrl };
  expect(
    await runMigrationPrefix('0290_operations_alert_p3_priority', { connection })
  ).toMatchObject({ ok: true });
  pool = new Pool({ connectionString: pgdirectUrl });
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  const inserted = await pool.query(
    `INSERT INTO notification_outbox(user_id,event_key,channels,idempotency_key)
     VALUES($1,'trace.fixture',ARRAY['in_app'],'trace:old') RETURNING id`,
    [user]
  );
  oldNoticeId = inserted.rows[0].id;
  const target = '0291_notification_outbox_trace_parent';
  expect(await runMigrationPrefix(target, { connection })).toEqual({ ok: true, applied: [target] });
  expect(await runMigrationPrefix(target, { connection })).toEqual({ ok: true, applied: [] });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  if (!management) return;
  try {
    await management.query(`DROP DATABASE IF EXISTS "${database}"`);
  } finally {
    await management.end();
  }
});

it('preserves the legacy row, rejects malformed metadata and prevents overwrites', async () => {
  expect(
    (await pool.query('SELECT trace_parent FROM notification_outbox WHERE id=$1', [oldNoticeId]))
      .rows
  ).toEqual([{ trace_parent: null }]);
  await expect(
    pool.query('UPDATE notification_outbox SET trace_parent=$1 WHERE id=$2', [
      traceparent,
      oldNoticeId,
    ])
  ).rejects.toMatchObject({ code: '23514', message: 'Notification trace context is immutable' });
  for (const invalid of [
    'private-raw-header',
    `00-${'0'.repeat(32)}-${context.spanId}-01`,
    `00-${context.traceId}-${'0'.repeat(16)}-01`,
  ]) {
    await expect(
      pool.query(
        `INSERT INTO notification_outbox(user_id,event_key,channels,idempotency_key,trace_parent)
       VALUES($1,'trace.fixture',ARRAY['in_app'],'trace:invalid',$2)`,
        [user, invalid]
      )
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'notification_outbox_trace_parent_valid',
    });
  }
});

it.each(['direct', 'transaction-pooled'] as const)(
  'preserves trigger-written trace metadata and clears transaction context in %s mode',
  async (mode) => {
    const client = new Client({ connectionString: pgdirectUrl });
    await client.connect();
    const transactionLocal = mode === 'transaction-pooled';
    const query = wrapClientQuery(client, 5000, transactionLocal);
    client.query = transactionLocal
      ? wrapTransactionPoolClient(client, query, {
          statementTimeout: '5000',
          lockTimeout: '5000',
          idleTransactionTimeout: '5000',
          connectionTimeout: 5000,
          queueTimeout: () => 5000,
        })
      : query;
    const profile = randomUUID();
    try {
      await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
      await client.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
      const credit = async (key: string) => {
        await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profile]);
        await postWalletCredit(
          client,
          { id: profile, archived: false },
          profile,
          25000n,
          {
            type: 'refund',
          },
          key
        );
      };
      await operatorLogTrace.run(context, async () => {
        await new Promise<void>((resolve, reject) => {
          client.query('START TRANSACTION', (error) => (error ? reject(error) : resolve()));
        });
        await credit(`trace:${mode}:commit`);
        await client.query('COMMIT');
        await client.query('BEGIN');
        await credit(`trace:${mode}:rollback`);
        await client.query('ROLLBACK');
      });
      await client.query('BEGIN');
      await credit(`trace:${mode}:untraced`);
      await client.query('COMMIT');
      expect(
        (
          await client.query(
            `SELECT trace_parent FROM notification_outbox
         WHERE profile_id=$1 AND event_key='wallet.credit_received' ORDER BY trace_parent NULLS LAST`,
            [profile]
          )
        ).rows
      ).toEqual([{ trace_parent: traceparent }, { trace_parent: null }]);
    } finally {
      await client.end();
    }
  }
);
