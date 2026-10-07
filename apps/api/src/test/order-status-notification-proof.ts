import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectCancelledOrderNotification(
  pool: Pool,
  orderId: string,
  profileId: string,
  commandKey: string
) {
  const rows = (
    await pool.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [
      `order.status_changed:electricity:${orderId}:cancel:${commandKey}:buyer`,
    ])
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    profile_id: profileId,
    user_id: 'buyer',
    event_key: 'order.status_changed',
    channels: ['in_app', 'email'],
    payload: {
      orderNumber: orderId,
      newStatus: 'لغو شده / Cancelled',
      status: 'cancelled',
      link_route: `/electricity/orders/${orderId}`,
    },
  });
  const inbox = (
    await pool.query("SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
      rows[0].id,
    ])
  ).rows;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    recipient_user_id: 'buyer',
    profile_id: profileId,
    operating_context: 'customer',
    type: 'order.status_changed',
    link_route: `/electricity/orders/${orderId}`,
    localized_content: {
      fa: {
        title: 'سفارش لغو شد',
        body: 'سفارش شما لغو شد. وضعیت بازپرداخت جداگانه پیگیری می‌شود.',
      },
      en: {
        title: 'Order cancelled',
        body: 'Your order has been cancelled. Refund progress is tracked separately.',
      },
    },
  });
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [rows[0].id]
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
        [rows[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
  ]);
  return { outboxId: rows[0].id as string, inboxId: inbox[0].id as string };
}
export async function orderDeliverySnapshot(pool: Pool, id: string) {
  return {
    outbox: (await pool.query('SELECT * FROM notification_outbox WHERE id=$1', [id])).rows,
    inbox: (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [id]
      )
    ).rows,
    jobs: (
      await pool.query('SELECT * FROM notification_job WHERE outbox_id=$1 ORDER BY channel', [id])
    ).rows,
    logs: (
      await pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=$1 ORDER BY id',
        [id]
      )
    ).rows,
  };
}
export async function expectOrderStatusRollback(pool: Pool, cancel: () => Promise<Response>) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows.map((r) => r.tablename as string);
  async function snapshot() {
    return Object.fromEntries(
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
  }
  for (const [table, predicate] of [
    ['notification_outbox', "NEW.event_key='order.status_changed'"],
    ['in_app_notifications', "NEW.type='order.status_changed'"],
    [
      'notification_job',
      "EXISTS (SELECT 1 FROM notification_outbox WHERE id=NEW.outbox_id AND event_key='order.status_changed')",
    ],
    [
      'notification_delivery_log',
      "EXISTS (SELECT 1 FROM notification_outbox WHERE id=NEW.notification_id AND event_key='order.status_changed')",
    ],
  ])
    for (const mode of ['raise', 'suppress']) {
      const before = await snapshot();
      await pool.query(
        `CREATE FUNCTION fail_order_status_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'order status notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_order_status_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_order_status_notice()`
      );
      try {
        expect((await cancel()).status).toBe(500);
        expect(await snapshot()).toEqual(before);
      } finally {
        await pool.query(
          `DROP TRIGGER fail_order_status_notice ON ${table}; DROP FUNCTION fail_order_status_notice()`
        );
      }
    }
}
