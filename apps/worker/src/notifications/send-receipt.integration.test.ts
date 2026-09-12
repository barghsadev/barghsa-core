import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DeliveryRejected } from '@barghsa/shared/notification-delivery';
import { durableDelivery, readDeliveryReceipt, DeliveryOutcomeUnknown } from './send-receipt.js';
import { writeDeliveryLog } from './delivery-log.js';

const database = `test_receipt_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, profileId: string;
const provider = { id: randomUUID(), transport: 'smtp' as const };
let legacy: string, aggregateAttempt: string, untouched: string;
const folder = resolve(__dirname, '../../../../packages/db/drizzle/production');
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries) {
    if (entry.tag === '0127_notification_send_receipts') {
      await pool.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES ('receipt-owner','receipt@example.test','test-only')"
      );
      profileId = (
        await pool.query("INSERT INTO profiles(user_id) VALUES ('receipt-owner') RETURNING id")
      ).rows[0].id;
      legacy = await queue();
      aggregateAttempt = await queue();
      untouched = await queue();
      await pool.query('UPDATE notification_outbox SET attempts=1 WHERE id=$1', [aggregateAttempt]);
      await pool.query(
        "UPDATE notification_job SET attempts=1,status='retrying' WHERE outbox_id=$1",
        [legacy]
      );
    }
    await pool.query(readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8'));
  }
}, 30000);
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}"`);
    await management.end();
  }
});
async function queue() {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO notification_outbox(id,profile_id,event_key,channels,idempotency_key) VALUES ($1::uuid,$2,'invoice.created',ARRAY['email'],$1::text)",
    [id, profileId]
  );
  await pool.query("INSERT INTO notification_job(outbox_id,channel) VALUES ($1,'email')", [id]);
  return id;
}
it('holds uncertain legacy sends without deleting their jobs or touching never-attempted messages', async () => {
  await expect(readDeliveryReceipt(pool, legacy, 'email')).rejects.toBeInstanceOf(
    DeliveryOutcomeUnknown
  );
  await expect(readDeliveryReceipt(pool, aggregateAttempt, 'email')).rejects.toBeInstanceOf(
    DeliveryOutcomeUnknown
  );
  expect(await readDeliveryReceipt(pool, untouched, 'email')).toBeUndefined();
  expect(
    (await pool.query('SELECT status,attempts FROM notification_job WHERE outbox_id=$1', [legacy]))
      .rows[0]
  ).toEqual({ status: 'retrying', attempts: 1 });
});
it('commits a single claim before I/O and recovers acceptance across competing workers', async () => {
  const id = await queue(),
    execute = durableDelivery(pool, id, 'email', 'occurrence');
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = vi.fn(async () => {
    await waiting;
    return 'provider-receipt';
  });
  const first = execute(provider, send);
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(
      (await pool.query('SELECT status FROM notification_send_receipts WHERE outbox_id=$1', [id]))
        .rows[0].status
    ).toBe('sending');
    await expect(execute(provider, send)).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  } finally {
    release();
  }
  expect(await first).toBe('provider-receipt');
  expect(await durableDelivery(pool, id, 'email', 'occurrence')(provider, send)).toBe(
    'provider-receipt'
  );
  expect(send).toHaveBeenCalledOnce();
});
it('keeps an uncertain network outcome held across restarts and administrative retry resets', async () => {
  const id = await queue();
  const send = vi.fn(async (): Promise<string> => {
    throw new Error('timeout token=private-secret');
  });
  await expect(
    durableDelivery(pool, id, 'email', 'occurrence')(provider, send)
  ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  await pool.query("UPDATE notification_job SET attempts=0,status='queued' WHERE outbox_id=$1", [
    id,
  ]);
  await expect(
    durableDelivery(pool, id, 'email', 'occurrence')(provider, send)
  ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  expect(send).toHaveBeenCalledOnce();
  const row = (
    await pool.query(
      'SELECT status,last_error FROM notification_send_receipts WHERE outbox_id=$1',
      [id]
    )
  ).rows[0];
  expect(row.status).toBe('unknown');
  expect(row.last_error).not.toContain('private-secret');
});
it('retries a proven rejection while preserving provider and occurrence identity', async () => {
  const id = await queue();
  const send = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new DeliveryRejected('recipient refused'))
    .mockResolvedValue('accepted-on-retry');
  await expect(
    durableDelivery(pool, id, 'email', 'occurrence')(provider, send)
  ).rejects.toBeInstanceOf(DeliveryRejected);
  await expect(
    durableDelivery(pool, id, 'email', 'different-occurrence')(provider, send)
  ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  await expect(
    durableDelivery(pool, id, 'email', 'occurrence')({ ...provider, id: randomUUID() }, send)
  ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  expect(await durableDelivery(pool, id, 'email', 'occurrence')(provider, send)).toBe(
    'accepted-on-retry'
  );
  expect(send).toHaveBeenCalledTimes(2);
  // No worker bookkeeping ran between attempts, as on a crash after rejection.
  const history = (
    await pool.query(
      'SELECT status,attempt_number,provider_ref,error_detail,send_attempt_token FROM notification_delivery_log WHERE notification_id=$1 ORDER BY attempt_number',
      [id]
    )
  ).rows;
  expect(history).toMatchObject([
    { status: 'failed', attempt_number: 1, provider_ref: null, error_detail: 'recipient refused' },
    {
      status: 'delivered',
      attempt_number: 2,
      provider_ref: 'accepted-on-retry',
      error_detail: null,
    },
  ]);
  expect(new Set(history.map((row) => row.send_attempt_token)).size).toBe(2);
  expect(
    (await pool.query('SELECT attempts FROM notification_job WHERE outbox_id=$1', [id])).rows[0]
      .attempts
  ).toBe(0);
});
for (const committed of [false, true]) {
  it(`never resends when the receipt write ${committed ? 'commits but its response is lost' : 'fails after provider acceptance'}`, async () => {
    const id = await queue(),
      send = vi.fn(async () => 'accepted-receipt');
    const unreliable = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("SET status='accepted'")) {
          if (committed) await pool.query(sql, params);
          throw new Error('connection lost while recording acceptance');
        }
        return pool.query(sql, params);
      },
    };
    await expect(
      durableDelivery(unreliable, id, 'email', 'occurrence')(provider, send)
    ).rejects.toThrow('connection lost');
    const retry = durableDelivery(pool, id, 'email', 'occurrence')(provider, send);
    if (committed) expect(await retry).toBe('accepted-receipt');
    else await expect(retry).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(send).toHaveBeenCalledOnce();
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
          [id]
        )
      ).rows
    ).toEqual([
      {
        status: committed ? 'delivered' : 'sending',
        provider_ref: committed ? 'accepted-receipt' : null,
      },
    ]);
  });
}
it('refuses a new send when its durable claim cannot be written', async () => {
  const send = vi.fn(async () => 'not-sent');
  const unavailable = {
    query: async (sql: string) => {
      if (sql.includes('INSERT INTO notification_send_receipts'))
        throw new Error('claim storage unavailable');
      return { rows: [] };
    },
  };
  await expect(
    durableDelivery(unavailable, randomUUID(), 'email', 'occurrence')(provider, send)
  ).rejects.toThrow('claim storage');
  expect(send).not.toHaveBeenCalled();
});
it('enforces receipt and provider invariants in PostgreSQL', async () => {
  const id = await queue();
  for (const [status, transport, receipt, accepted] of [
    ['accepted', 'smtp', null, null],
    ['accepted', null, 'receipt', new Date()],
    ['sending', 'smsir', null, null],
    ['sending', 'smtp', 'receipt', null],
  ]) {
    await expect(
      pool.query(
        `INSERT INTO notification_send_receipts(outbox_id,channel,status,provider_id,transport,idempotency_key,attempt_token,provider_ref,accepted_at)
      VALUES ($1,'email',$2,$3,$4,'occurrence',$5,$6,$7)`,
        [id, status, provider.id, transport, randomUUID(), receipt, accepted]
      )
    ).rejects.toMatchObject({ code: '23514' });
  }
});

it('stores the attempt before I/O and never duplicates it during recovered bookkeeping', async () => {
  const id = await queue();
  await durableDelivery(
    pool,
    id,
    'email',
    'occurrence'
  )(provider, async () => {
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref,latency_ms FROM notification_delivery_log WHERE notification_id=$1',
          [id]
        )
      ).rows
    ).toEqual([{ status: 'sending', provider_ref: null, latency_ms: null }]);
    return 'durable-reference';
  });
  const before = (
    await pool.query('SELECT * FROM notification_delivery_log WHERE notification_id=$1', [id])
  ).rows;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeDeliveryLog(client, {
      notificationId: id,
      channel: 'email',
      delivered: true,
      attemptNumber: 1,
      providerRef: 'durable-reference',
      latencyMs: null,
    });
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  await writeDeliveryLog(pool, {
    notificationId: id,
    channel: 'email',
    delivered: true,
    attemptNumber: 1,
    providerRef: 'durable-reference',
    latencyMs: null,
  });
  expect(
    (await pool.query('SELECT * FROM notification_delivery_log WHERE notification_id=$1', [id]))
      .rows
  ).toEqual(before);
});
for (const suppressed of [false, true]) {
  it(`prevents I/O if durable history insertion ${suppressed ? 'is suppressed' : 'fails'}`, async () => {
    const id = await queue(),
      send = vi.fn(async () => 'must-not-send');
    await pool.query(`CREATE FUNCTION fail_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${suppressed ? 'RETURN NULL;' : "RAISE EXCEPTION 'history storage unavailable';"} END $$;
      CREATE TRIGGER fail_history_insert BEFORE INSERT ON notification_delivery_log FOR EACH ROW EXECUTE FUNCTION fail_history_insert()`);
    try {
      await expect(
        durableDelivery(pool, id, 'email', 'occurrence')(provider, send)
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(
        (await pool.query('SELECT status FROM notification_send_receipts WHERE outbox_id=$1', [id]))
          .rows
      ).toEqual(suppressed ? [{ status: 'sending' }] : []);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_history_insert ON notification_delivery_log; DROP FUNCTION fail_history_insert()'
      );
    }
  });
}
it('keeps acceptance and history unresolved together if the history update is suppressed', async () => {
  const id = await queue(),
    send = vi.fn(async () => 'provider-accepted');
  await pool.query(`CREATE FUNCTION suppress_history_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER suppress_history_update BEFORE UPDATE ON notification_delivery_log FOR EACH ROW EXECUTE FUNCTION suppress_history_update()`);
  try {
    await expect(
      durableDelivery(pool, id, 'email', 'occurrence')(provider, send)
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  } finally {
    await pool.query(
      'DROP TRIGGER suppress_history_update ON notification_delivery_log; DROP FUNCTION suppress_history_update()'
    );
  }
  await expect(
    durableDelivery(pool, id, 'email', 'occurrence')(provider, send)
  ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
  expect(send).toHaveBeenCalledOnce();
  for (const table of ['notification_send_receipts', 'notification_delivery_log']) {
    const column = table === 'notification_send_receipts' ? 'outbox_id' : 'notification_id';
    expect((await pool.query(`SELECT status FROM ${table} WHERE ${column}=$1`, [id])).rows).toEqual(
      [{ status: 'sending' }]
    );
  }
});
it('preserves legacy hold evidence with unknown duration and leaves untouched jobs without history', async () => {
  for (const id of [legacy, aggregateAttempt]) {
    expect(
      (
        await pool.query(
          'SELECT status,latency_ms,send_attempt_token FROM notification_delivery_log WHERE notification_id=$1',
          [id]
        )
      ).rows
    ).toEqual([{ status: 'unknown', latency_ms: null, send_attempt_token: expect.any(String) }]);
  }
  expect(
    (
      await pool.query('SELECT id FROM notification_delivery_log WHERE notification_id=$1', [
        untouched,
      ])
    ).rows
  ).toEqual([]);
});
