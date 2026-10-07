import type { Pool } from 'pg';
import { expect } from 'vitest';
export async function expectCancellationRequestDelivery(
  pool: Pool,
  contract: string,
  request: string,
  owner: string,
  orderNumber: string,
  link: string
) {
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='order.cancellation_requested' AND payload->>'requestId'=$1",
      [request]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row).toMatchObject({
    user_id: owner,
    event_key: 'order.cancellation_requested',
    channels: ['in_app', 'email'],
    idempotency_key: `order.cancellation_requested:${contract}:${request}:${owner}`,
    payload: { contractId: contract, requestId: request, orderNumber, link_route: link },
  });
  const inbox = (
    await pool.query("SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
      row.id,
    ])
  ).rows;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    recipient_user_id: owner,
    profile_id: row.profile_id,
    operating_context: 'customer',
    type: 'order.cancellation_requested',
    link_route: link,
  });
  expect(inbox[0].localized_content.fa.body).toMatch(/[\u0600-\u06ff]/);
  expect(inbox[0].localized_content.en.body).toContain('awaiting staff review');
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [row.id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'queued', attempts: 0, provider_ref: null },
    { channel: 'in_app', status: 'done', attempts: 1, provider_ref: inbox[0].id },
  ]);
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
        [row.id]
      )
    ).rows
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
  ]);
  return row;
}
export async function expectCancellationRequestRollback(
  pool: Pool,
  id: string,
  work: () => Promise<Response>
) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows.map((r) => r.tablename as string);
  const snapshot = async (): Promise<Record<string, Array<Record<string, unknown>>>> =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (
            await pool.query(
              `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${table.replaceAll('"', '""')}" t`
            )
          ).rows[0].rows,
        ])
      )
    );
  const match = `event_key='order.cancellation_requested' AND payload->>'contractId'='${id}'`;
  for (const [table, predicate] of [
    [
      'notification_outbox',
      `NEW.event_key='order.cancellation_requested' AND NEW.payload->>'contractId'='${id}'`,
    ],

    ['in_app_notifications', `NEW.type='order.cancellation_requested'`],
    [
      'notification_job',
      `EXISTS(SELECT 1 FROM notification_outbox WHERE id=NEW.outbox_id AND ${match})`,
    ],
    [
      'notification_delivery_log',
      `EXISTS(SELECT 1 FROM notification_outbox WHERE id=NEW.notification_id AND ${match})`,
    ],
  ])
    for (const mode of ['raise', 'suppress']) {
      const before = await snapshot();
      await pool.query(
        `CREATE FUNCTION fail_cancellation_request_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'cancellation request notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_cancellation_request_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_cancellation_request_notice()`
      );
      try {
        expect((await work()).status).toBe(500);
        const after = await snapshot();
        expect(after).toEqual(before);
      } finally {
        await pool.query(
          `DROP TRIGGER fail_cancellation_request_notice ON ${table}; DROP FUNCTION fail_cancellation_request_notice()`
        );
      }
    }
}
